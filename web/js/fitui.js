/* CatPlot 峰拟合面板（fit-1）：区间/背景/峰型/初值/锁定 → Worker LM 拟合 →
   分峰+残差图、峰参数表(标准误/锁)、Rwp/Rp/χ²、Scherrer(仪器宽化三模式+表观警示)、
   卡片峰表对照(Δd/Δ2θ，波长不一致只给 d)、四类导出、项目 v4 存档。
   输入恒为原始上传数据（raw 层）；归一化/偏移仅显示，不参与拟合。 */
(function () {
  'use strict';
  var App = window.CatApp, Core = window.CatFitCore, Cards = window.CatCards, CardsUI = window.CatCardsUI, AN = window.CatAnalysis;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(v, d) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 3 : d); }
  var ui = { worker: null, seq: 0, pending: {}, running: false, dragMode: false, dragPeak: null, regionDrag: null, legend: {}, finishedAt: 0 };
  function FS() {
    if (!App.state.fit) App.state.fit = { regions: [], active: null, instrument: { mode: 'none', fwhm: null, std: null }, K: 0.89, dbVersion: null };
    return App.state.fit;
  }
  function region() { var fs = FS(); return fs.regions.find(function (r) { return r.id === fs.active; }) || null; }
  function sample() { return App.getSelected(); }
  function libLambda() { var v = App.state.lib.wavelength; return typeof v === 'number' && isFinite(v) && v > 0 ? v : null; }
  function status(msg, kind) { var el = $('fitStatus'); el.textContent = msg; el.className = 'hint ' + (kind === 'err' ? 'mt-err' : kind === 'ok' ? 'mt-ok' : 'process-note'); }
  function newId() { return 'fr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function ensureWorker() {
    if (ui.worker) return ui.worker;
    ui.worker = new Worker('js/fitworker.js');
    ui.worker.onmessage = function (e) {
      var m = e.data, cb = ui.pending[m.id];
      if (!cb) return;
      delete ui.pending[m.id];
      ui.running = false; ui.finishedAt = Date.now();
      $('btnFitCancel').hidden = true; $('btnFitRun').disabled = false;
      cb(m.res);
    };
    ui.worker.onerror = function (e) {
      ui.running = false; ui.finishedAt = Date.now();
      $('btnFitCancel').hidden = true; $('btnFitRun').disabled = false;
      status('拟合 Worker 出错：' + (e.message || '未知'), 'err');
    };
    return ui.worker;
  }
  function runFit(bgOnly) {
    var r = region(), s = sample();
    if (!s) { status('请先选择样品。', 'err'); return; }
    if (!r) { status('请先添加拟合区间。', 'err'); return; }
    if (!r.peaks.length && !bgOnly) { status('区间内无峰：先生成候选峰或手动加峰。', 'err'); return; }
    var peaks = r.peaks.map(function (p) {
      return { c: p.c, w: p.w, h: p.h, sp: p.sp, locks: bgOnly ? { c: true, w: true, h: true, sp: true } : (p.locks || {}) };
    });
    var cfg = {
      x: s.raw.x, y: s.raw.y, region: { min: r.min, max: r.max }, shape: r.shape,
      bg: { model: r.bg.model, coeffs: r.bg.coeffs, anchors: r.bg.anchors }, peaks: peaks, maxIter: 120
    };
    var w = ensureWorker(), id = ++ui.seq;
    ui.running = true;
    $('btnFitCancel').hidden = false; $('btnFitRun').disabled = true;
    status(bgOnly ? '背景拟合中…' : '拟合中…');
    ui.pending[id] = function (res) {
      if (res.reason === 'cancelled') { status('已取消拟合。', 'ok'); renderResults(); return; }
      if (!res.ok) { status('拟合失败：' + res.reason, 'err'); renderResults(); return; }
      if (bgOnly) {
        r.bg.coeffs = res.bgCoeffs;
        status('背景拟合完成：系数 [' + res.bgCoeffs.map(function (v) { return f(v, 2); }).join(', ') + ']，Rwp=' + f(res.quality.rwp, 4), 'ok');
      } else {
        r.result = res;
        r.bg.coeffs = res.bgCoeffs;
        r.peaks = res.params.map(function (p, i) { return { c: p.c, w: p.w, h: p.h, sp: p.sp, locks: (r.peaks[i] && r.peaks[i].locks) || {} }; });
        FS().dbVersion = CardsUI.ui.remote.status ? CardsUI.ui.remote.status.dbVersion : null;
        FS().at = new Date().toISOString();
        App.checkpoint('峰拟合 ' + f(r.min, 1) + '–' + f(r.max, 1) + '°（' + res.params.length + ' 峰，Rwp=' + f(res.quality.rwp, 4) + '，fit-1）');
        App.save();
        status('拟合完成：' + res.params.length + ' 峰，Rwp=' + f(res.quality.rwp, 4), 'ok');
      }
      renderAllFit();
    };
    w.postMessage({ id: id, cfg: cfg });
  }
  function cancelFit() {
    if (!ui.running) return;
    if (ui.worker) { ui.worker.postMessage({ cancel: true }); setTimeout(function () { if (ui.running && ui.worker) { ui.worker.terminate(); ui.worker = null; ui.running = false; ui.finishedAt = Date.now(); $('btnFitCancel').hidden = true; $('btnFitRun').disabled = false; status('已取消拟合。', 'ok'); } }, 1500); }
    status('取消中…');
  }

  /* ---------- 渲染 ---------- */
  function refresh() {
    var s = sample(), fs = FS();
    var nw = $('fitNormWarn');
    if (s && (s.normalize || s.offset > 0)) { nw.hidden = false; nw.textContent = '样品「' + s.name + '」已施加归一化/显示偏移：拟合使用原始上传数据（raw 层），归一化与偏移不参与。'; }
    else nw.hidden = true;
    var st = CardsUI.ui.remote.status;
    $('fitStaleBadge').hidden = !(fs.dbVersion != null && st && st.dbVersion !== fs.dbVersion);
    $('fitV3Note').hidden = !(App.state.projectVersion != null && App.state.projectVersion < 4 && !fs.regions.length);
    var sel = $('fitRegionList');
    sel.innerHTML = fs.regions.map(function (r) { return '<option value="' + r.id + '"' + (r.id === fs.active ? ' selected' : '') + '>' + f(r.min, 2) + '–' + f(r.max, 2) + '°（' + r.peaks.length + ' 峰）</option>'; }).join('') || '<option value="">（无区间）</option>';
    var r = region();
    $('fitBgModel').value = r ? r.bg.model : 'linear';
    $('fitShape').value = r ? r.shape : 'pseudoVoigt';
    $('fitInstMode').value = fs.instrument.mode;
    $('fitInstFwhm').value = fs.instrument.fwhm == null ? '' : fs.instrument.fwhm;
    $('fitK').value = fs.K;
    renderPeakRows(); renderResults(); renderChart();
  }
  function renderPeakRows() {
    var r = region(), box = $('fitPeakRows');
    if (!r) { box.innerHTML = '<tr><td colspan="6" class="hint">无区间</td></tr>'; return; }
    box.innerHTML = r.peaks.map(function (p, i) {
      function lk(key) { return '<label class="fit-lock"><input type="checkbox" data-flock="' + i + ':' + key + '"' + (p.locks && p.locks[key] ? ' checked' : '') + '>锁</label>'; }
      return '<tr>' +
        '<td><input class="input fit-num" data-fp="' + i + ':c" type="number" step="0.01" value="' + f(p.c, 3) + '">' + lk('c') + '</td>' +
        '<td><input class="input fit-num" data-fp="' + i + ':w" type="number" step="0.01" value="' + f(p.w, 3) + '">' + lk('w') + '</td>' +
        '<td><input class="input fit-num" data-fp="' + i + ':h" type="number" step="1" value="' + f(p.h, 1) + '">' + lk('h') + '</td>' +
        '<td><input class="input fit-num" data-fp="' + i + ':sp" type="number" step="0.05" value="' + f(p.sp, 2) + '">' + lk('sp') + '</td>' +
        '<td><button class="btn tiny ghost" type="button" data-fdel="' + i + '">删</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="5" class="hint">无峰：生成候选峰或手动加峰</td></tr>';
  }
  function renderGuide() {
    var g = window.CatModel.guide(App.state.technique);
    var el = $('fitGuide');
    if (el) el.textContent = '推荐流程（' + window.CatModel.tech(App.state.technique).name + '）：' + g.steps + '。' + g.note;
  }
  function renderAreaRatio(res) {
    var a = $('fitRatioA'), b = $('fitRatioB'), out = $('fitRatioOut');
    if (!a || !b || !out) return;
    if (!res || !res.params || res.params.length < 2) { a.innerHTML = ''; b.innerHTML = ''; out.textContent = '需≥2个拟合峰。'; return; }
    var opts = res.params.map(function (p, i) { return '<option value="' + i + '">峰' + (i + 1) + ' @' + f(p.c, 1) + '</option>'; }).join('');
    var av = a.value, bv = b.value;
    a.innerHTML = opts; b.innerHTML = opts;
    a.value = av && av < res.params.length ? av : 0;
    b.value = bv && bv < res.params.length ? bv : 1;
    function upd() {
      var i = +a.value, j = +b.value;
      var A = res.params[i], B = res.params[j];
      if (!A || !B || !B.area) { out.textContent = '—'; return; }
      out.textContent = '面积比 A/B = ' + f(A.area / B.area, 3) + '（A=' + f(A.area, 1) + ', B=' + f(B.area, 1) + '）· 相对占比，非绝对含量';
    }
    a.onchange = upd; b.onchange = upd; upd();
  }
  function renderResults() {
    var r = region(), q = $('fitQuality'), pt = $('fitParamTable'), sc = $('fitScherrerTable'), cc = $('fitCardTable');
    renderGuide();
    if (!r || !r.result) {
      q.textContent = '尚未拟合：设置区间/背景/峰型/初值后运行。';
      pt.innerHTML = ''; sc.innerHTML = ''; cc.innerHTML = '';
      $('fitScherrerWarn').hidden = true;
      renderAreaRatio(null);
      return;
    }
    var res = r.result, Q = res.quality;
    renderAreaRatio(res);
    var T = (window.CatModel && window.CatModel.tech) ? window.CatModel.tech(App.state.technique) : { xrd: true, xLabel: '2θ (°)', xUnit: '°' };
    q.innerHTML = 'Rwp=<b>' + f(Q.rwp, 4) + '</b> · Rp=' + f(Q.rp, 4) + ' · χ²(red)=' + f(Q.chi2red, 3) + ' · 数据点 ' + Q.n + ' · 自由参数 ' + Q.freeParams + ' · 迭代 ' + res.iterations + ' · ' + esc(res.note || '');
    var totArea = res.params.reduce(function (a, p) { return a + p.area; }, 0) || 1;
    pt.innerHTML = '<table class="preview-table mt-table"><thead><tr><th>#</th><th>中心 (' + esc(T.xUnit) + ')</th><th' + (T.xrd ? '' : ' hidden') + '>d (Å)</th><th>峰高</th><th>FWHM (' + esc(T.xUnit) + ')</th><th>积分面积</th><th>面积相对占比</th><th>η/m</th><th>SE(中心/FWHM/峰高)</th><th>锁定</th></tr></thead><tbody>' +
      res.params.map(function (p, i) {
        var lam = libLambda(), d = (T.xrd && lam) ? Core.dFromT(p.c, lam) : null;
        var locks = Object.keys(p.locks || {}).filter(function (k) { return p.locks[k]; }).join(',') || '—';
        return '<tr><td>' + (i + 1) + '</td><td>' + f(p.c, 3) + '</td><td' + (T.xrd ? '' : ' hidden') + '>' + f(d, 4) + '</td><td>' + f(p.h, 1) + '</td><td>' + f(p.w, 4) + '</td><td>' + f(p.area, 1) + '</td><td>' + f(100 * p.area / totArea, 1) + '%</td><td>' + f(p.sp, 2) + '</td><td>' + f(p.se && p.se.c, 4) + ' / ' + f(p.se && p.se.w, 4) + ' / ' + f(p.se && p.se.h, 1) + '</td><td>' + locks + '</td></tr>';
      }).join('') + '</tbody></table><p class="hint">面积相对占比 = 峰面积相对占比，非物相含量；标准误为线性近似。</p>';
    /* Scherrer / 卡片对照 仅 XRD */
    if (!T.xrd) { sc.innerHTML = '<p class="hint">Scherrer 晶粒尺寸与卡片对照为 XRD 专属，当前表征不适用。</p>'; cc.innerHTML = ''; $('fitScherrerWarn').hidden = true; return; }
    var fs = FS(), lam = libLambda(), anyApparent = false, rows = '';
    res.params.forEach(function (p, i) {
      var inst = null;
      if (fs.instrument.mode === 'fixed') inst = fs.instrument.fwhm;
      else if (fs.instrument.mode === 'standard' && fs.instrument.std && fs.instrument.std.length) {
        var std = fs.instrument.std.slice().sort(function (a, b) { return a.c - b.c; });
        if (p.c <= std[0].c) inst = std[0].w;
        else if (p.c >= std[std.length - 1].c) inst = std[std.length - 1].w;
        else for (var k = 1; k < std.length; k++) if (p.c <= std[k].c) { var a = std[k - 1], b = std[k]; inst = a.w + (b.w - a.w) * (p.c - a.c) / (b.c - a.c); break; }
      }
      if (lam == null) { rows += '<tr><td>' + (i + 1) + '</td><td colspan="3" class="hint">未确认实验波长，无法计算 Scherrer</td></tr>'; return; }
      var sh = Core.scherrer({ fwhm: p.w, center: p.c, lambda: lam, K: fs.K, instFwhm: inst });
      if (!sh.ok) { rows += '<tr><td>' + (i + 1) + '</td><td colspan="3" class="mt-err">' + esc(sh.reason) + '</td></tr>'; return; }
      if (sh.apparent) anyApparent = true;
      rows += '<tr><td>' + (i + 1) + '</td><td>' + f(sh.D / 10, 1) + ' nm</td><td>' + f(sh.beta, 4) + '°</td><td>' + (sh.apparent ? '<span class="badge stale">表观值</span>' : '已扣仪器宽化') + '</td></tr>';
    });
    sc.innerHTML = '<table class="preview-table mt-table"><thead><tr><th>峰</th><th>表观晶粒尺寸 D</th><th>β (°)</th><th>口径</th></tr></thead><tbody>' + rows + '</tbody></table>';
    $('fitScherrerWarn').hidden = !anyApparent;
    /* 卡片对照 */
    var tracks = App.state.lib.sticksOn && Cards ? Cards.rt.sticks : [];
    if (!tracks.length || lam == null) {
      cc.innerHTML = '<p class="hint">卡片对照需参考轨道与实验波长：在搜索匹配/卡片库加入参考后显示 Δd/Δ2θ。</p>';
    } else {
      var crows = '';
      res.params.forEach(function (p, i) {
        var d = Core.dFromT(p.c, lam), best = null;
        tracks.forEach(function (tr) {
          tr.peaks.forEach(function (pp) {
            if (pp.d == null) return;
            var dev = Math.abs(pp.d - d);
            if (!best || dev < best.dev) best = { tr: tr, pp: pp, dev: dev };
          });
        });
        if (!best) return;
        var cd = Core.cardDiff({ center: p.c, lambda: lam, refD: best.pp.d, refT: best.pp.t, refLambda: best.tr.lambda });
        crows += '<tr><td>' + (i + 1) + '</td><td>' + esc(best.tr.label) + '</td><td>' + f(best.pp.d, 4) + (best.pp.hkl ? ' (' + esc(Array.isArray(best.pp.hkl) ? best.pp.hkl.join(' ') : best.pp.hkl) + ')' : '') + '</td><td>' + (cd.ok ? (cd.deltaD > 0 ? '+' : '') + cd.deltaD : '—') + '</td><td>' + (cd.ok && cd.deltaT != null ? (cd.deltaT > 0 ? '+' : '') + cd.deltaT : '—') + '</td><td class="hint">' + esc(cd.ok ? (cd.note || '波长一致') : cd.reason) + '</td></tr>';
      });
      cc.innerHTML = '<table class="preview-table mt-table"><thead><tr><th>拟合峰</th><th>最近卡片峰</th><th>卡片 d (hkl)</th><th>Δd (Å)</th><th>Δ2θ (°)</th><th>口径</th></tr></thead><tbody>' + crows + '</tbody></table>';
    }
  }
  function renderChart() {
    var svg = $('fitChart'), r = region(), s = sample();
    if (!r || !s) { svg.innerHTML = '<rect width="960" height="420" fill="#fff"/><text x="480" y="210" text-anchor="middle" fill="#64748b" font-size="14">添加区间并选择样品后显示拟合图</text>'; svg.setAttribute('viewBox', '0 0 960 420'); return; }
    var W = 960, H = 420, ml = 60, mr = 16, mt = 16, ph = 260, rh = 80, gap = 26;
    var xs = [], ys = [];
    for (var i = 0; i < s.raw.x.length; i++) if (s.raw.x[i] >= r.min && s.raw.x[i] <= r.max) { xs.push(s.raw.x[i]); ys.push(s.raw.y[i]); }
    if (!xs.length) { svg.innerHTML = '<rect width="960" height="420" fill="#fff"/><text x="480" y="210" text-anchor="middle" fill="#64748b" font-size="14">区间内无数据点</text>'; svg.setAttribute('viewBox', '0 0 960 420'); return; }
    var xMin = r.min, xMax = r.max;
    var st = { peaks: r.peaks, shape: r.shape, bgModel: r.bg.model, bgCoeffs: r.bg.coeffs || [], anchors: r.bg.anchors, mid: (xMin + xMax) / 2, half: (xMax - xMin) / 2 || 1 };
    var fitY = xs.map(function (x) { return Core.modelY(x, st); });
    var yMax = Math.max.apply(null, ys.concat(fitY)) * 1.08 || 1, yMin = Math.min(0, Math.min.apply(null, ys));
    function sx(v) { return ml + (v - xMin) / (xMax - xMin) * (W - ml - mr); }
    function sy(v) { return mt + ph - (v - yMin) / (yMax - yMin) * ph; }
    var resMax = 1;
    var resid = xs.map(function (x, k) { return ys[k] - fitY[k]; });
    resid.forEach(function (v) { resMax = Math.max(resMax, Math.abs(v)); });
    function ry(v) { return mt + ph + gap + rh / 2 - v / resMax * (rh / 2 - 4); }
    var p = ['<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>'];
    var stride = Math.max(1, Math.floor(xs.length / 1200));
    function path(arr, fy) { var d = []; for (var k = 0; k < xs.length; k += stride) d.push((d.length ? 'L' : 'M') + sx(xs[k]).toFixed(1) + ' ' + fy(arr[k]).toFixed(1)); return d.join(''); }
    p.push('<path d="' + path(ys, sy) + '" fill="none" stroke="#0f172a" stroke-width="1.1"/>');
    if (r.bg.model !== 'none') {
      var bgY = xs.map(function (x) { return Core.modelY(x, { peaks: [], shape: r.shape, bgModel: r.bg.model, bgCoeffs: r.bg.coeffs || [], anchors: r.bg.anchors, mid: st.mid, half: st.half }); });
      p.push('<path d="' + path(bgY, sy) + '" fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="5 4"/>');
    }
    r.peaks.forEach(function (pk, pi) {
      if (ui.legend['p' + pi] === false) return;
      var py = xs.map(function (x) { return pk.h * Core.shapeVal(r.shape, (x - pk.c) / pk.w, pk.sp); });
      var d = path(py, sy) + 'L' + sx(xs[xs.length - 1]).toFixed(1) + ' ' + sy(0).toFixed(1) + 'L' + sx(xs[0]).toFixed(1) + ' ' + sy(0).toFixed(1) + 'Z';
      p.push('<path d="' + d + '" fill="hsla(' + (pi * 47) % 360 + ',70%,55%,0.25)" stroke="hsl(' + (pi * 47) % 360 + ',70%,45%)" stroke-width="0.8"/>');
    });
    if (r.result) p.push('<path d="' + path(fitY, sy) + '" fill="none" stroke="#e11d48" stroke-width="1.4"/>');
    r.peaks.forEach(function (pk, pi) {
      p.push('<g data-fpi="' + pi + '" style="cursor:ew-resize"><circle cx="' + sx(pk.c).toFixed(1) + '" cy="' + sy(pk.h).toFixed(1) + '" r="5" fill="#fff" stroke="#0d9488" stroke-width="1.6"/><circle cx="' + sx(pk.c).toFixed(1) + '" cy="' + sy(pk.h).toFixed(1) + '" r="11" fill="transparent"/></g>');
    });
    p.push('<line x1="' + ml + '" y1="' + ry(0) + '" x2="' + (W - mr) + '" y2="' + ry(0) + '" stroke="#94a3b8" stroke-width="0.8"/>');
    p.push('<path d="' + path(resid, ry) + '" fill="none" stroke="#64748b" stroke-width="1"/>');
    p.push('<text x="' + ml + '" y="' + (mt + ph + gap - 8) + '" font-size="11" fill="#64748b">残差（实验−拟合）</text>');
    for (var t = 0; t <= 4; t++) {
      var xv = xMin + (xMax - xMin) * t / 4;
      p.push('<text x="' + sx(xv) + '" y="' + (mt + ph + gap + rh + 14) + '" text-anchor="middle" font-size="11" fill="#475569">' + xv.toFixed(1) + '</text>');
    }
    var FT = (window.CatModel && window.CatModel.tech) ? window.CatModel.tech(App.state.technique) : { xLabel: '2θ (°)' };
    p.push('<text x="' + (W - mr) + '" y="' + (H - 4) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + esc(FT.xLabel) + ' · 原始数据 · fit-1</text>');
    if (ui.regionDrag) p.push('<rect x="' + sx(Math.min(ui.regionDrag.a, ui.regionDrag.b)) + '" y="' + mt + '" width="' + Math.abs(sx(ui.regionDrag.b) - sx(ui.regionDrag.a)) + '" height="' + ph + '" fill="rgba(13,148,136,0.12)" stroke="#0d9488" stroke-dasharray="4 3"/>');
    svg.innerHTML = p.join('');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg._fit = { sx: sx, xMin: xMin, xMax: xMax, ml: ml, mr: mr, mt: mt, ph: ph, W: W };
    var lg = $('fitLegend');
    lg.innerHTML = r.peaks.map(function (pk, pi) { return '<label class="check"><input type="checkbox" data-fleg="' + pi + '"' + (ui.legend['p' + pi] === false ? '' : ' checked') + '>峰' + (pi + 1) + '</label>'; }).join('') + '<span class="hint">黑=实验 · 红=总拟合 · 橙虚=背景 · 填充=分峰</span>';
  }
  function renderAllFit() { renderPeakRows(); renderResults(); renderChart(); }

  /* ---------- 交互 ---------- */
  function addRegion(min, max) {
    var fs = FS();
    if (!(max > min)) { status('区间须起<止。', 'err'); return; }
    var r = { id: newId(), min: min, max: max, bg: { model: 'linear', coeffs: null, anchors: null }, shape: 'pseudoVoigt', peaks: [], result: null };
    fs.regions.push(r); fs.active = r.id;
    App.save(); refresh();
    status('已添加区间 ' + f(min, 2) + '–' + f(max, 2) + '°。生成候选峰后运行拟合。');
  }
  function initPeaks() {
    var r = region(), s = sample();
    if (!r || !s) { status('先选样品与区间。', 'err'); return; }
    var mh = parseFloat($('fitMinHeight').value);
    /* 步长自适应：XRD(0.02°)→minDist≈0.15/w≈0.2；拉曼(1cm⁻¹)→minDist≈1.5/w≈8，通用 */
    var st = Core.step(s.raw.x) || 0.02;
    var found = AN.findPeaks(s.raw.x, s.raw.y, { minHeight: isFinite(mh) ? mh : 50, noiseK: 3, smooth: 9, minDist: st * 7.5 });
    var inR = found.peaks.filter(function (p) { return p.x >= r.min && p.x <= r.max; }).slice(0, 30);
    if (!inR.length) { status('区间内未检到峰（绝对峰高下限 ' + (isFinite(mh) ? mh : 50) + '）：可降低下限或手动加峰。', 'err'); return; }
    r.peaks = inR.map(function (p) { return { c: p.x, w: st * 10, h: p.height, sp: 0.5, locks: {} }; });
    r.result = null;
    App.save(); renderAllFit();
    status('已从原始数据寻峰生成 ' + r.peaks.length + ' 个候选峰（绝对峰高下限生效）。可拖动/锁定/增删后拟合。', 'ok');
  }
  function chartX(ev) {
    var svg = $('fitChart'), m = svg._fit;
    if (!m) return null;
    var rect = svg.getBoundingClientRect();
    var scale = Math.min(rect.width / m.W, rect.height / 420);
    var offX = (rect.width - m.W * scale) / 2;
    var lx = (ev.clientX - rect.left - offX) / scale;
    if (lx < m.ml || lx > m.W - m.mr) return null;
    return m.xMin + (lx - m.ml) / (m.W - m.ml - m.mr) * (m.xMax - m.xMin);
  }
  $('fitChart').addEventListener('pointerdown', function (ev) {
    var g = ev.target.closest ? ev.target.closest('[data-fpi]') : null;
    var r = region();
    if (!r) return;
    if (g) { ui.dragPeak = +g.getAttribute('data-fpi'); ev.preventDefault(); return; }
    if (ui.dragMode) { var x = chartX(ev); if (x != null) { ui.regionDrag = { a: x, b: x }; ev.preventDefault(); } }
  });
  window.addEventListener('pointermove', function (ev) {
    var r = region();
    if (!r) return;
    if (ui.dragPeak != null) {
      var x = chartX(ev);
      if (x != null) { r.peaks[ui.dragPeak].c = Math.min(r.max, Math.max(r.min, x)); r.result = null; renderChart(); renderPeakRows(); }
    } else if (ui.regionDrag) {
      var x2 = chartX(ev);
      if (x2 != null) { ui.regionDrag.b = x2; renderChart(); }
    }
  });
  window.addEventListener('pointerup', function (ev) {
    if (ui.dragPeak != null) { ui.dragPeak = null; App.save(); renderResults(); }
    if (ui.regionDrag) {
      var a = Math.min(ui.regionDrag.a, ui.regionDrag.b), b = Math.max(ui.regionDrag.a, ui.regionDrag.b);
      ui.regionDrag = null;
      if (b - a > 0.05) addRegion(+a.toFixed(2), +b.toFixed(2));
      else renderChart();
    }
  });
  $('fitRegionList').addEventListener('change', function () { FS().active = this.value || null; refresh(); });
  $('btnFitAddRegion').addEventListener('click', function () { addRegion(parseFloat($('fitRMin').value), parseFloat($('fitRMax').value)); });
  $('btnFitDelRegion').addEventListener('click', function () {
    var fs = FS();
    fs.regions = fs.regions.filter(function (r) { return r.id !== fs.active; });
    fs.active = fs.regions.length ? fs.regions[0].id : null;
    App.save(); refresh();
  });
  $('btnFitDragRegion').addEventListener('click', function () {
    ui.dragMode = !ui.dragMode;
    this.classList.toggle('primary', ui.dragMode);
    status(ui.dragMode ? '框选模式：在拟合图上拖拽选择 2θ 区间。' : '框选模式已关闭。');
  });
  $('fitBgModel').addEventListener('change', function () { var r = region(); if (r) { r.bg.model = this.value; r.bg.coeffs = null; r.result = null; App.save(); renderAllFit(); } });
  $('fitShape').addEventListener('change', function () { var r = region(); if (r) { r.shape = this.value; r.result = null; App.save(); renderAllFit(); } });
  $('btnFitBgOnly').addEventListener('click', function () { runFit(true); });
  $('btnFitInitPeaks').addEventListener('click', initPeaks);
  $('btnFitAddPeak').addEventListener('click', function () {
    var r = region(); if (!r) return;
    if (r.peaks.length >= 30) { status('单区间最多 30 峰。', 'err'); return; }
    r.peaks.push({ c: (r.min + r.max) / 2, w: 0.2, h: 100, sp: 0.5, locks: {} });
    r.result = null; App.save(); renderAllFit();
  });
  $('fitPeakRows').addEventListener('input', function (ev) {
    var t = ev.target, r = region(); if (!r) return;
    if (t.dataset.fp) {
      var parts = t.dataset.fp.split(':'), v = parseFloat(t.value);
      if (isFinite(v)) { r.peaks[+parts[0]][parts[1]] = v; r.result = null; renderChart(); }
    }
  });
  $('fitPeakRows').addEventListener('change', function (ev) {
    var t = ev.target, r = region(); if (!r) return;
    if (t.dataset.flock) {
      var parts = t.dataset.flock.split(':');
      r.peaks[+parts[0]].locks = r.peaks[+parts[0]].locks || {};
      r.peaks[+parts[0]].locks[parts[1]] = t.checked;
      App.save();
    }
  });
  $('fitPeakRows').addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-fdel]') : null;
    var r = region(); if (!t || !r) return;
    r.peaks.splice(+t.getAttribute('data-fdel'), 1); r.result = null; App.save(); renderAllFit();
  });
  $('fitLegend').addEventListener('change', function (ev) {
    if (ev.target.dataset.fleg != null) { ui.legend['p' + ev.target.dataset.fleg] = ev.target.checked; renderChart(); }
  });
  $('btnFitRun').addEventListener('click', function () { runFit(false); });
  $('btnFitCancel').addEventListener('click', cancelFit);
  $('fitInstMode').addEventListener('change', function () { FS().instrument.mode = this.value; App.save(); renderResults(); });
  $('fitInstFwhm').addEventListener('input', function () { var v = parseFloat(this.value); FS().instrument.fwhm = isFinite(v) ? v : null; App.save(); renderResults(); });
  $('fitK').addEventListener('input', function () { var v = parseFloat(this.value); FS().K = isFinite(v) && v > 0 ? v : 0.89; App.save(); renderResults(); });
  $('fitInstFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var pts = String(reader.result).trim().split(/\r?\n/).map(function (l) { return l.split(/[,;\s]+/).map(Number); }).filter(function (p) { return p.length >= 2 && isFinite(p[0]) && isFinite(p[1]); });
      if (pts.length < 20) { status('标样谱点数不足。', 'err'); return; }
      var x = pts.map(function (p) { return p[0]; }), y = pts.map(function (p) { return p[1]; });
      var found = AN.findPeaks(x, y, { minHeight: Math.max.apply(null, y) * 0.1, noiseK: 3, smooth: 9, minDist: 0.3 });
      var std = [];
      var chain = Promise.resolve();
      found.peaks.slice(0, 12).forEach(function (pk) {
        chain = chain.then(function () {
          var w = 0.6;
          return Core.fit({ x: x, y: y, region: { min: pk.x - w, max: pk.x + w }, shape: 'pseudoVoigt', bg: { model: 'linear' }, peaks: [{ c: pk.x, w: 0.1, h: pk.height, sp: 0.5, locks: {} }] }).then(function (res) {
            if (res.ok) std.push({ c: res.params[0].c, w: res.params[0].w });
          });
        });
      });
      chain.then(function () {
        FS().instrument.std = std; FS().instrument.mode = 'standard';
        $('fitInstMode').value = 'standard';
        App.save(); renderResults();
        status('标样仪器宽化曲线已拟合：' + std.length + ' 个标样峰（FWHM 随 2θ 插值）。', 'ok');
      });
    };
    reader.readAsText(file);
    this.value = '';
  });

  /* ---------- 导出 ---------- */
  function dl(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); }
  function csvParams() {
    var r = region(); if (!r || !r.result) { status('无拟合结果可导出。', 'err'); return; }
    var tot = r.result.params.reduce(function (a, p) { return a + p.area; }, 0) || 1;
    var lines = ['peak,center_2theta,d_angstrom,height,fwhm_deg,area,area_relative_percent,eta_or_m,se_center,se_fwhm,se_height,locked'];
    r.result.params.forEach(function (p, i) {
      var lam = libLambda();
      lines.push([i + 1, p.c.toFixed(4), lam ? Core.dFromT(p.c, lam).toFixed(5) : '', p.h.toFixed(2), p.w.toFixed(5), p.area.toFixed(2), (100 * p.area / tot).toFixed(2), p.sp.toFixed(3), p.se && p.se.c != null ? p.se.c.toFixed(5) : '', p.se && p.se.w != null ? p.se.w.toFixed(5) : '', p.se && p.se.h != null ? p.se.h.toFixed(2) : '', Object.keys(p.locks || {}).filter(function (k) { return p.locks[k]; }).join('|')].join(','));
    });
    dl(new Blob([lines.join('\n')], { type: 'text/csv' }), 'CatPlot_fit_params_' + Date.now() + '.csv');
  }
  function csvCurves() {
    var r = region(), s = sample(); if (!r || !s) { status('无区间/样品。', 'err'); return; }
    var st = { peaks: r.peaks, shape: r.shape, bgModel: r.bg.model, bgCoeffs: r.bg.coeffs || [], anchors: r.bg.anchors, mid: (r.min + r.max) / 2, half: (r.max - r.min) / 2 || 1 };
    var lines = ['x_2theta,raw,bg,total_fit,residual'];
    for (var i = 0; i < s.raw.x.length; i++) {
      var x = s.raw.x[i];
      if (x < r.min || x > r.max) continue;
      var fv = Core.modelY(x, st);
      lines.push([x, s.raw.y[i], (fv - r.peaks.reduce(function (a, p) { return a + p.h * Core.shapeVal(r.shape, (x - p.c) / p.w, p.sp); }, 0)).toFixed(3), fv.toFixed(3), (s.raw.y[i] - fv).toFixed(3)].join(','));
    }
    dl(new Blob([lines.join('\n')], { type: 'text/csv' }), 'CatPlot_fit_curves_' + Date.now() + '.csv');
  }
  function footnote() {
    var fs = FS(), r = region();
    return 'CatPlot fit-1 · 本机 PDF 参考库 dbVersion=' + (fs.dbVersion == null ? '?' : fs.dbVersion) + ' · K=' + fs.K + ' · 仪器宽化=' + fs.instrument.mode + ' · Rwp=' + (r && r.result ? f(r.result.quality.rwp, 4) : '—') + ' · 面积占比为峰面积相对占比，非物相含量 · 不支持 Rietveld/物相定量';
  }
  function exportSvgPng(png) {
    var svg = $('fitChart');
    if (!region()) { status('无拟合图可导出。', 'err'); return; }
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', 1920); clone.setAttribute('height', 840);
    var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', 60); txt.setAttribute('y', 412); txt.setAttribute('font-size', 10); txt.setAttribute('fill', '#64748b');
    txt.textContent = footnote();
    clone.appendChild(txt);
    var src = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    if (!png) { dl(new Blob([src], { type: 'image/svg+xml' }), 'CatPlot_fit_' + Date.now() + '.svg'); return; }
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = 1920; c.height = 840;
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1920, 840); ctx.drawImage(img, 0, 0, 1920, 840);
      c.toBlob(function (b) { dl(b, 'CatPlot_fit_' + Date.now() + '.png'); }, 'image/png');
    };
    img.src = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
  }
  function exportJson() {
    var fs = FS(), r = region();
    if (!r) { status('无区间可导出。', 'err'); return; }
    dl(new Blob([JSON.stringify({ format: 'catplot-fit', version: 1, algo: 'fit-1', library_dbVersion: fs.dbVersion, instrument: fs.instrument, K: fs.K, region: r, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }), 'CatPlot_fit_' + Date.now() + '.json');
  }
  $('btnFitCsvParams').addEventListener('click', csvParams);
  $('btnFitCsvCurves').addEventListener('click', csvCurves);
  $('btnFitPng').addEventListener('click', function () { exportSvgPng(true); });
  $('btnFitSvg').addEventListener('click', function () { exportSvgPng(false); });
  $('btnFitJson').addEventListener('click', exportJson);

  window.CatFitUI = { refresh: refresh, onShow: refresh, run: runFit, ui: ui };
  ensureWorker();
  refresh();
})();