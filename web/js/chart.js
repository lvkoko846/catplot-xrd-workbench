/* CatPlot 绘图引擎：显示层自绘 SVG（出版级白底）。
   预览模式按可见范围+绘图区宽度做 min-max 显示简化（不保证所有局部峰）；
   导出模式(dataMode=full)使用完整显示层数据。字号倍率同步缩放边距/图例/脚注。 */
(function () {
  'use strict';

  var W = 960;
  var FONT = "'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  var PREVIEW_MIN_TARGET = 600;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function niceTicks(min, max, target) {
    if (!(max > min)) { max = min + 1; }
    var span = max - min;
    var rawStep = span / Math.max(2, target);
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var norm = rawStep / mag;
    var step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    var ticks = [];
    var start = Math.ceil(min / step) * step;
    for (var v = start; v <= max + step * 1e-9; v += step) {
      ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return { ticks: ticks, step: step };
  }

  function fmtTick(v, step) {
    var dec = Math.max(0, -Math.floor(Math.log(step) / Math.LN10 + 1e-9));
    return v.toFixed(Math.min(6, dec));
  }

  function fmtNum(v) {
    if (Math.abs(v) >= 10000) return v.toExponential(2);
    return String(Math.round(v * 1000) / 1000);
  }

  function wrapNotes(notes, maxUnits) {
    var lines = [], cur = '';
    notes.forEach(function (n) {
      var add = cur ? cur + ' · ' + n : n;
      if (window.CatModel.textUnits(add) > maxUnits && cur) { lines.push(cur); cur = n; }
      else cur = add;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /* samples 携带 display（分析+偏移）与 q（升序查询索引）。
     opts: fontScale, fixedH, dataMode('preview'|'full'),
       tracks: 独立参考棒图轨道（共用 X 轴，逐条轨道，排序=数组顺序）,
       overlay: { bg:{x,y}, ghost:{x,y}, peaks:[{id,x,y,n}], highlightId },
       noteExtra: 追加脚注行 */
  function render(svg, samples, settings, opts) {
    opts = opts || {};
    var Mdl = window.CatModel;
    var k = opts.fontScale || 1;
    var full = opts.dataMode === 'full';
    var fs = function (n) { return Math.round(n * k * 100) / 100; };
    var rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { width: 0, height: 0 };
    var H = opts.fixedH
      ? opts.fixedH
      : (rect.width > 0 && rect.height > 0
        ? Math.round(Math.min(1100, Math.max(430, W * rect.height / rect.width)))
        : 560);

    var tracks = opts.tracks || [];
    var overlay = opts.overlay || {};
    var laneH = 48 * k;
    var lanesH = tracks.length * laneH;

    var xMin = Infinity, xMax = -Infinity, yLo = Infinity, yHi = -Infinity;
    samples.forEach(function (s) {
      var d = s.display;
      var a = Mdl.minOf(d.x), b = Mdl.maxOf(d.x);
      var c = Mdl.minOf(d.y), e = Mdl.maxOf(d.y);
      if (a < xMin) xMin = a;
      if (b > xMax) xMax = b;
      if (c < yLo) yLo = c;
      if (e > yHi) yHi = e;
    });
    if (overlay.bg) {
      var bc = Mdl.minOf(overlay.bg.y), be = Mdl.maxOf(overlay.bg.y);
      if (bc < yLo) yLo = bc;
      if (be > yHi) yHi = be;
    }
    if (settings.xMin != null) xMin = settings.xMin;
    if (settings.xMax != null) xMax = settings.xMax;
    if (!(xMax > xMin)) xMax = xMin + 1;
    var yd = Mdl.autoYDomain(yLo, yHi, settings.yMin, settings.yMax);
    var yMin = yd[0], yMax = yd[1];

    /* 堆叠瀑布（出版风格，参考用户论文图）：多样品纵向错开、隐藏Y刻度、粗黑框、底部卡片轨道 */
    var stack = settings.stack === true && samples.length > 1;
    /* 间距下限 1.0：统一间距=最高峰×缩放×间距，<1 时最高峰必越过上一条基线 */
    var stackGap = Math.max(1, settings.stackGap != null ? settings.stackGap : 1.15);
    var stackScale = settings.stackScale != null ? settings.stackScale : 0.8;
    /* 统一间距基准=所有样品最大峰高×缩放：保证任意样品峰顶不越过上一条基线（峰高差异大时也不重叠） */
    var stackSpan = 0;
    if (stack) {
      samples.forEach(function (s) {
        var lo = Mdl.minOf(s.display.y), hi = Mdl.maxOf(s.display.y);
        var sp = ((hi - lo) || Math.abs(hi) || 1) * stackScale;
        if (sp > stackSpan) stackSpan = sp;
      });
      stackSpan = stackSpan || 1;
    }
    var stackShift = samples.map(function (s, si) {
      return stack ? si * stackSpan * stackGap : 0;
    });
    if (stack) {
      var sLo = Infinity, sHi = -Infinity;
      samples.forEach(function (s, si) {
        var lo = Mdl.minOf(s.display.y) + stackShift[si], hi = Mdl.maxOf(s.display.y) + stackShift[si];
        if (lo < sLo) sLo = lo; if (hi > sHi) sHi = hi;
      });
      var sSpan = (sHi - sLo) || 1;
      yMin = sLo - sSpan * 0.05; yMax = sHi + sSpan * 0.05;
    }

    var ml = 76 * k, mr = 26 * k, mt = 58 * k;
    var pw = W - ml - mr;
    var target = Math.max(PREVIEW_MIN_TARGET, Math.round(pw * 2));

    var views = samples.map(function (s) {
      if (full) return { x: s.display.x, y: s.display.y, mode: 'full', kept: s.display.x.length, inWindow: s.display.x.length };
      return Mdl.decimateWindow(s.display.x, s.display.y, xMin, xMax, target);
    });

    var anyNorm = samples.some(function (s) { return s.normalize; });
    var anyOffset = samples.some(function (s) { return s.offset > 0; });
    var anySim = samples.some(function (s) { return s.source === 'sim'; });
    var anyDec = views.some(function (v) { return v.mode === 'dec'; });
    var yLabel = anyNorm ? '强度 (a.u. / 归一化)' : '强度 (a.u.)';

    var notes = [];
    if (anyNorm || anyOffset) {
      var parts2 = [];
      if (anyNorm) parts2.push('归一化(最强峰=1)');
      if (anyOffset) parts2.push('纵向偏移(仅显示)');
      notes.push('数据处理: ' + parts2.join(' + '));
    } else {
      notes.push('数据处理: 无（原始强度）');
    }
    (opts.noteExtra || []).forEach(function (t) { notes.push(t); });
    if (full) notes.push('图像导出: 全量显示层数据');
    else if (anyDec) notes.push('显示降采样(min-max, 不保证所有局部峰) · 悬停/分析/导出全量');
    if (tracks.length) {
      var lam0 = tracks[0].lambda;
      var lamTxt = tracks.every(function (t) { return t.lambda === lam0; }) ? (lam0 || '?') : '混合';
      var sn = '参考轨道 ' + tracks.length + ' 条 · λ=' + lamTxt + 'Å · 待核验参考（非物相结论）';
      if (tracks.some(function (s) { return s.withdrawn; })) sn += ' · 含作废卡片';
      if (tracks.some(function (s) { return s.converted; })) sn += ' · TXT 已由原始波长换算';
      notes.push(sn);
    }
    if (anySim) notes.push('含模拟数据，仅供演示');
    if (stack) notes.push('纵向堆叠(仅显示, 间距×' + stackGap + ', 缩放×' + stackScale + ') · 强度轴无刻度');
    var noteLines = wrapNotes(notes, (W - 150) / (10.5 * k));
    var mb = (74 + 12 * (noteLines.length - 1)) * k;
    var minH = mt + 150 * k + lanesH + mb;
    if (H < minH) H = minH;
    var ph = H - mt - mb - lanesH;
    var axisY = mt + ph + lanesH;

    function sx(v) { return ml + (v - xMin) / (xMax - xMin) * pw; }
    function sy(v) { return mt + ph - (v - yMin) / (yMax - yMin) * ph; }

    var p = [];
    p.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>');
    if (settings.title) {
      p.push('<text x="' + (W / 2) + '" y="' + fs(32) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + fs(19) + '" font-weight="700" fill="#0f172a">' + esc(Mdl.fitText(settings.title, (W - 40) / (19 * k))) + '</text>');
    }

    var xt = niceTicks(xMin, xMax, 9);
    var yt = niceTicks(yMin, yMax, 7);

    if (settings.showGrid) {
      xt.ticks.forEach(function (v) {
        p.push('<line x1="' + sx(v) + '" y1="' + mt + '" x2="' + sx(v) + '" y2="' + axisY + '" stroke="#eef2f7" stroke-width="1"/>');
      });
      yt.ticks.forEach(function (v) {
        p.push('<line x1="' + ml + '" y1="' + sy(v) + '" x2="' + (ml + pw) + '" y2="' + sy(v) + '" stroke="#eef2f7" stroke-width="1"/>');
      });
    }

    xt.ticks.forEach(function (v) {
      var X = sx(v);
      p.push('<line x1="' + X + '" y1="' + axisY + '" x2="' + X + '" y2="' + (axisY + 5 * k) + '" stroke="#64748b" stroke-width="1"/>');
      p.push('<text x="' + X + '" y="' + (axisY + 20 * k) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + fs(12) + '" fill="#475569">' + fmtTick(v, xt.step) + '</text>');
    });
    if (!stack) {
      yt.ticks.forEach(function (v) {
        var Y = sy(v);
        p.push('<line x1="' + (ml - 5 * k) + '" y1="' + Y + '" x2="' + ml + '" y2="' + Y + '" stroke="#64748b" stroke-width="1"/>');
        p.push('<text x="' + (ml - 9 * k) + '" y="' + (Y + 4 * k) + '" text-anchor="end" font-family="' + FONT + '" font-size="' + fs(12) + '" fill="#475569">' + fmtTick(v, yt.step) + '</text>');
      });
    }

    p.push('<rect x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + (ph + lanesH) + '" fill="none" stroke="' + (stack ? '#0f172a' : '#94a3b8') + '" stroke-width="' + (stack ? 2.6 * k : 1.2) + '"/>');
    p.push('<text x="' + (ml + pw / 2) + '" y="' + (H - 36 * k - 12 * k * (noteLines.length - 1)) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + fs(13.5) + '" fill="#334155">2θ (°)</text>');
    p.push('<text x="' + (20 * k) + '" y="' + (mt + ph / 2) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + fs(13.5) + '" fill="#334155" transform="rotate(-90 ' + (20 * k) + ' ' + (mt + ph / 2) + ')">' + esc(stack ? 'Intensity (a.u.)' : yLabel) + '</text>');
    function syS(si, v) { return stack ? sy(v * stackScale + stackShift[si]) : sy(v); }

    p.push('<clipPath id="plotClip"><rect x="' + ml + '" y="' + mt + '" width="' + pw + '" height="' + ph + '"/></clipPath>');
    p.push('<g clip-path="url(#plotClip)">');

    /* 原始曲线对照（背景扣除后显示，浅灰） */
    if (overlay.ghost) {
      var gv = full ? overlay.ghost : Mdl.decimateWindow(overlay.ghost.x, overlay.ghost.y, xMin, xMax, target);
      var gp = [];
      for (var gi = 0; gi < gv.x.length; gi++) {
        if (gv.x[gi] < xMin || gv.x[gi] > xMax) continue;
        gp.push((gp.length ? 'L' : 'M') + sx(gv.x[gi]).toFixed(2) + ' ' + sy(gv.y[gi]).toFixed(2));
      }
      if (gp.length) p.push('<path d="' + gp.join('') + '" fill="none" stroke="#cbd5e1" stroke-width="' + (1.1 * k) + '"/>');
    }

    samples.forEach(function (s, si) {
      var d = views[si];
      var px = d.x, py = d.y;
      var pad = (xMax - xMin) * 0.02;
      var parts = [];
      for (var i = 0; i < px.length; i++) {
        if (px[i] < xMin - pad || px[i] > xMax + pad) continue;
        parts.push((parts.length ? 'L' : 'M') + sx(px[i]).toFixed(2) + ' ' + syS(si, py[i]).toFixed(2));
      }
      if (parts.length) {
        p.push('<path d="' + parts.join('') + '" fill="none" stroke="' + esc(s.color) + '" stroke-width="' + (stack ? Math.max(1.8, s.lineWidth) : s.lineWidth) + '" stroke-linejoin="round" stroke-linecap="round"/>');
      }
    });

    /* 背景预览线（橙色虚线，显示层坐标） */
    if (overlay.bg) {
      var bv = full ? overlay.bg : Mdl.decimateWindow(overlay.bg.x, overlay.bg.y, xMin, xMax, target);
      var bp = [];
      for (var bi = 0; bi < bv.x.length; bi++) {
        if (bv.x[bi] < xMin || bv.x[bi] > xMax) continue;
        bp.push((bp.length ? 'L' : 'M') + sx(bv.x[bi]).toFixed(2) + ' ' + sy(bv.y[bi]).toFixed(2));
      }
      if (bp.length) p.push('<path d="' + bp.join('') + '" fill="none" stroke="#f59e0b" stroke-width="' + (1.6 * k) + '" stroke-dasharray="' + (6 * k) + ' ' + (4 * k) + '"/>');
    }
    p.push('</g>');

    /* 实验峰标记：可点击（data-pid），与峰表双向联动 */
    var pk = overlay.peaks || [];
    if (pk.length) {
      p.push('<g clip-path="url(#plotClip)">');
      pk.forEach(function (m) {
        if (m.x < xMin || m.x > xMax) return;
        var X = sx(m.x), Y = sy(m.y);
        var hl = overlay.highlightId === m.id;
        var col = hl ? '#e11d48' : '#0d9488';
        if (hl) p.push('<line x1="' + X.toFixed(2) + '" y1="' + mt + '" x2="' + X.toFixed(2) + '" y2="' + (mt + ph) + '" stroke="#e11d48" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>');
        p.push('<g data-pid="' + esc(m.id) + '" style="cursor:pointer">');
        p.push('<circle cx="' + X.toFixed(2) + '" cy="' + Y.toFixed(2) + '" r="' + (hl ? 6.5 : 4.5) * k + '" fill="#ffffff" stroke="' + col + '" stroke-width="' + (hl ? 2.4 : 1.6) * k + '"/>');
        p.push('<text x="' + X.toFixed(2) + '" y="' + (Y - 9 * k).toFixed(2) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + fs(10.5) + '" font-weight="' + (hl ? 700 : 400) + '" fill="' + col + '">' + m.n + '</text>');
        p.push('<circle cx="' + X.toFixed(2) + '" cy="' + Y.toFixed(2) + '" r="' + (11 * k) + '" fill="transparent"/>');
        p.push('</g>');
      });
      p.push('</g>');
    }

    /* 独立参考棒图轨道：共用 X 轴，每条卡片一个轨道，顺序=tracks 数组顺序 */
    tracks.forEach(function (st, ti) {
      var ly = mt + ph + ti * laneH;
      var base = ly + laneH - 6 * k;
      var hmax = laneH - 16 * k;
      p.push('<rect x="' + ml + '" y="' + ly + '" width="' + pw + '" height="' + laneH + '" fill="#ffffff" stroke="' + (stack ? '#0f172a' : '#e2e8f0') + '" stroke-width="' + (stack ? 1.8 * k : 0.8) + '"/>');
      var im = 0;
      st.peaks.forEach(function (pp2) { if (pp2.i > im) im = pp2.i; });
      var spad = (xMax - xMin) * 0.02;
      p.push('<clipPath id="laneClip' + ti + '"><rect x="' + ml + '" y="' + ly + '" width="' + pw + '" height="' + laneH + '"/></clipPath>');
      p.push('<g clip-path="url(#laneClip' + ti + ')">');
      st.peaks.forEach(function (pp2, pi) {
        if (pp2.t < xMin - spad || pp2.t > xMax + spad) return;
        var X = sx(pp2.t);
        var h = im > 0 ? (pp2.i / im) * hmax : 0;
        var Y = base - h;
        var dash = st.withdrawn ? ' stroke-dasharray="5 4"' : '';
        var tip = esc(st.label + (st.withdrawn ? '（作废）' : '') + ' · 2θ=' + pp2.t.toFixed(3) + '° · d=' + (pp2.d != null ? pp2.d.toFixed(4) : '—') + 'Å · I=' + pp2.i + (pp2.hkl ? ' · hkl ' + pp2.hkl.join(' ') : ''));
        var sid = ti + ':' + pi;
        p.push('<line x1="' + X.toFixed(2) + '" y1="' + base + '" x2="' + X.toFixed(2) + '" y2="' + Y.toFixed(2) + '" stroke="' + esc(st.color) + '" stroke-width="' + (1.5 * k) + '"' + dash + ' data-sid="' + sid + '"><title>' + tip + '</title></line>');
        p.push('<line x1="' + X.toFixed(2) + '" y1="' + base + '" x2="' + X.toFixed(2) + '" y2="' + Math.min(Y, base - 6 * k).toFixed(2) + '" stroke="transparent" stroke-width="' + (9 * k) + '" pointer-events="stroke" style="cursor:pointer" data-sid="' + sid + '" data-interactive="1"><title>' + tip + '</title></line>');
      });
      p.push('</g>');
      var lbl = Mdl.fitText(st.label + (st.withdrawn ? '（作废）' : ''), (pw * 0.4) / (10.5 * k));
      p.push('<text x="' + (ml + 6 * k) + '" y="' + (ly + 12 * k) + '" font-family="' + FONT + '" font-size="' + fs(10.5) + '" font-weight="600" fill="' + esc(st.color) + '">' + esc(lbl) + '</text>');
    });

    var legend = null;
    if (settings.showLegend && samples.length) {
      legend = Mdl.legendLayout(samples.map(function (s) { return s.name; }), pw, ph, k);
      var bx = ml + pw - legend.boxW - 10 * k, by = mt + 10 * k;
      p.push('<rect x="' + bx + '" y="' + by + '" width="' + legend.boxW + '" height="' + legend.lh + '" rx="' + (5 * k) + '" fill="#ffffff" fill-opacity="0.92" stroke="#cbd5e1"/>');
      legend.rows.forEach(function (nm, i) {
        var ly2 = by + 20 * k + i * legend.rowH;
        p.push('<line x1="' + (bx + 10 * k) + '" y1="' + (ly2 - 4 * k) + '" x2="' + (bx + 32 * k) + '" y2="' + (ly2 - 4 * k) + '" stroke="' + esc(samples[i].color) + '" stroke-width="' + Math.max(1.5, samples[i].lineWidth) + '"/>');
        p.push('<text x="' + (bx + 39 * k) + '" y="' + ly2 + '" font-family="' + FONT + '" font-size="' + fs(12) + '" fill="#1e293b">' + esc(nm) + '</text>');
      });
      if (legend.extra) {
        var ey = by + 20 * k + legend.rows.length * legend.rowH;
        p.push('<text x="' + (bx + 39 * k) + '" y="' + ey + '" font-family="' + FONT + '" font-size="' + fs(11) + '" fill="#64748b">… 其余 ' + legend.extra + ' 条样品</text>');
      }
    }

    noteLines.forEach(function (ln, i) {
      var ny = H - 16 * k - 12 * k * (noteLines.length - 1 - i);
      p.push('<text x="' + ml + '" y="' + ny + '" font-family="' + FONT + '" font-size="' + fs(10.5) + '" fill="#94a3b8">' + esc(ln) + '</text>');
    });
    p.push('<text x="' + (W - mr) + '" y="' + (H - 16 * k) + '" text-anchor="end" font-family="' + FONT + '" font-size="' + fs(10.5) + '" fill="#cbd5e1">CatPlot</text>');

    p.push('<line id="hoverGuide" data-interactive="1" x1="0" y1="' + mt + '" x2="0" y2="' + axisY + '" stroke="#0ea5e9" stroke-width="1" stroke-dasharray="4 3" visibility="hidden"/>');

    svg.innerHTML = p.join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg._meta = {
      W: W, H: H, k: k, dataMode: full ? 'full' : 'preview',
      xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax,
      plot: { x: ml, y: mt, w: pw, h: ph }, axisY: axisY, laneH: laneH,
      sx: sx, sy: sy, syS: syS, stack: stack, stackShift: stackShift, stackScale: stackScale,
      samples: samples, views: views, legend: legend, tracks: tracks,
      noteLines: noteLines.length
    };
    return svg._meta;
  }

  function renderEmpty(svg) {
    var rect = svg.getBoundingClientRect();
    var H = rect.width > 0 && rect.height > 0
      ? Math.round(Math.min(1100, Math.max(430, W * rect.height / rect.width)))
      : 560;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    svg._meta = null;
  }

  /* 导出用独立 SVG：固定逻辑画布 + 全量显示层数据，不读取视口 */
  function renderExport(samples, settings, opts) {
    opts = opts || {};
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var tracks = opts.tracks || [];
    var baseH = opts.logicalH || 560;
    render(svg, samples, settings, {
      fontScale: opts.fontScale || 1,
      fixedH: baseH + tracks.length * 48 * (opts.fontScale || 1),
      dataMode: 'full', tracks: tracks, overlay: opts.overlay || null, noteExtra: opts.noteExtra || []
    });
    return svg;
  }

  function exportDims(svg, width) {
    var vb = svg.viewBox.baseVal;
    var w = vb && vb.width ? vb.width : W;
    var h = vb && vb.height ? vb.height : 560;
    var outW = width || w;
    return { w: w, h: h, outW: outW, outH: Math.round(outW * h / w) };
  }

  function serializeForExport(svg, width) {
    var clone = svg.cloneNode(true);
    clone.querySelectorAll('[data-interactive]').forEach(function (n) { n.remove(); });
    clone.removeAttribute('style');
    var d = exportDims(svg, width);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', d.outW);
    clone.setAttribute('height', d.outH);
    clone.setAttribute('viewBox', '0 0 ' + d.w + ' ' + d.h);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportSVG(svg, filename, width) {
    var text = serializeForExport(svg, width);
    download(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), filename);
    return exportDims(svg, width);
  }

  function exportPNG(svg, filename, width) {
    return new Promise(function (resolve, reject) {
      var d = exportDims(svg, width);
      var text = serializeForExport(svg, width);
      var blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = d.outW;
          canvas.height = d.outH;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (b) {
            if (!b) { reject(new Error('PNG 编码失败')); return; }
            download(b, filename);
            resolve(d);
          }, 'image/png');
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('SVG 渲染失败，无法生成 PNG')); };
      img.src = url;
    });
  }

  window.CatChart = {
    W: W,
    PREVIEW_MIN_TARGET: PREVIEW_MIN_TARGET,
    render: render,
    renderEmpty: renderEmpty,
    renderExport: renderExport,
    serializeForExport: serializeForExport,
    exportDims: exportDims,
    exportSVG: exportSVG,
    exportPNG: exportPNG,
    download: download,
    fmtNum: fmtNum,
    esc: esc
  };
})();