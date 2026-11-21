/* CatPlot 数据模型：原始 / 分析 / 显示 三层分离，纯函数，可在 Node 中回归测试 */
(function () {
  'use strict';

  function maxOf(arr) {
    var m = -Infinity;
    for (var i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return arr.length ? m : NaN;
  }
  function minOf(arr) {
    var m = Infinity;
    for (var i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
    return arr.length ? m : NaN;
  }

  /* 归一化守卫：最强峰 <= 0 时不允许（除零或无物理意义） */
  function canNormalize(y) {
    var m = maxOf(y);
    return isFinite(m) && m > 0;
  }
  function normalizeBlockReason(y) {
    var m = maxOf(y);
    if (!isFinite(m)) return '数据为空，无法归一化。';
    if (m === 0) return '最强峰为 0（全零数据），归一化将导致除零，已阻止。';
    return '最强峰为 ' + m + '（<= 0，全负或零数据），归一化无物理意义，已阻止。';
  }

  /* 分析层 = 原始工作副本 + 明确处理（归一化）；显示层 = 分析层 + 纵向偏移。
     偏移只存在于显示层，绝不进入分析层。 */
  function buildLayers(working, normalize, offset) {
    var n = working.y.length;
    var ay = new Array(n), dy = new Array(n);
    var m = normalize ? maxOf(working.y) : 1;
    for (var i = 0; i < n; i++) {
      ay[i] = normalize ? working.y[i] / m : working.y[i];
      dy[i] = ay[i] + (offset || 0);
    }
    return {
      analysis: { x: working.x.slice(), y: ay },
      display: { x: working.x.slice(), y: dy }
    };
  }

  /* min-max 桶降采样：每桶保留最小与最大点。
     注意：这是显示简化，不保证保留所有局部峰（同桶双峰可能只留其一）。 */
  function decimateMinMax(x, y, maxPoints) {
    var n = x.length;
    if (n <= maxPoints) return { x: x, y: y, factor: 1, kept: n };
    var buckets = Math.max(2, Math.floor(maxPoints / 2));
    var ox = [], oy = [];
    var per = n / buckets;
    var lastIdx = -1;
    function push(i) {
      if (i === lastIdx) return;
      ox.push(x[i]); oy.push(y[i]); lastIdx = i;
    }
    push(0);
    for (var b = 0; b < buckets; b++) {
      var i0 = Math.floor(b * per);
      var i1 = Math.min(n, Math.floor((b + 1) * per));
      if (i1 <= i0) i1 = Math.min(n, i0 + 1);
      var iMin = i0, iMax = i0;
      for (var i = i0 + 1; i < i1; i++) {
        if (y[i] < y[iMin]) iMin = i;
        if (y[i] > y[iMax]) iMax = i;
      }
      push(Math.min(iMin, iMax));
      push(Math.max(iMin, iMax));
    }
    push(n - 1);
    return { x: ox, y: oy, factor: n / ox.length, kept: ox.length };
  }

  /* 按当前可见范围与目标点数重采样：窗口内点数不足时恢复全量。
     只作用于显示层副本，分析数据不受影响。 */
  function decimateWindow(x, y, lo, hi, target) {
    var ix = [], iy = [];
    for (var i = 0; i < x.length; i++) {
      if (x[i] >= lo && x[i] <= hi) { ix.push(x[i]); iy.push(y[i]); }
    }
    var n = ix.length;
    if (n <= target) return { x: ix, y: iy, mode: 'full', kept: n, inWindow: n };
    var d = decimateMinMax(ix, iy, target);
    return { x: d.x, y: d.y, mode: 'dec', kept: d.kept, inWindow: n };
  }

  /* 独立升序查询索引：绘图保持原顺序，最近点查询走排序副本。
     重复 X 按原始顺序取第一个，保证确定性。 */
  function buildQueryIndex(x) {
    var idx = new Array(x.length);
    for (var i = 0; i < x.length; i++) idx[i] = i;
    idx.sort(function (a, b) { return x[a] - x[b] || a - b; });
    var xs = new Array(x.length);
    for (var k = 0; k < idx.length; k++) xs[k] = x[idx[k]];
    return { xs: xs, idx: idx };
  }
  function nearestSorted(xs, v) {
    var lo = 0, hi = xs.length - 1;
    if (hi < 0) return -1;
    if (v <= xs[0]) return 0;
    if (v >= xs[hi]) return hi;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (xs[mid] <= v) lo = mid; else hi = mid;
    }
    return v - xs[lo] <= xs[hi] - v ? lo : hi;
  }

  /* 自动 Y 轴：按跨度加留白，全负/全零/常数曲线均完整包围 */
  function autoYDomain(lo, hi, sMin, sMax) {
    var base = Math.min(0, lo);
    var span = hi - base;
    var pad = span > 0 ? span * 0.08 : Math.max(1, Math.abs(hi) * 0.1);
    var yMin = sMin != null ? sMin : base - pad;
    var yMax = sMax != null ? sMax : hi + pad;
    if (!(yMax > yMin)) yMax = yMin + 1;
    return [yMin, yMax];
  }

  function textUnits(s) {
    var u = 0;
    for (var i = 0; i < s.length; i++) u += s.charCodeAt(i) > 0x2e80 ? 1 : 0.55;
    return u;
  }
  function fitText(s, maxUnits) {
    if (textUnits(s) <= maxUnits) return s;
    var u = 0, out = '';
    for (var i = 0; i < s.length; i++) {
      var w = s.charCodeAt(i) > 0x2e80 ? 1 : 0.55;
      if (u + w > maxUnits - 1) break;
      u += w; out += s[i];
    }
    return out + '…';
  }

  /* 图例布局随字号倍率同步：行高、盒宽、截断与行数上限 */
  function legendLayout(names, pw, ph, k) {
    var rowH = 19 * k;
    var maxRows = Math.max(1, Math.floor((ph - 20 - 12 * k) / rowH));
    var extra = 0, shown = names.length;
    if (shown > maxRows) { extra = shown - (maxRows - 1); shown = maxRows - 1; }
    if (shown < 1) { shown = 1; extra = names.length - 1; }
    var maxLen = 0;
    for (var i = 0; i < shown; i++) maxLen = Math.max(maxLen, textUnits(names[i]));
    var boxW = Math.min(pw - 20, 46 * k + maxLen * 12.5 * k);
    var maxChars = Math.max(4, (boxW - 49 * k) / (12.5 * k));
    var rows = [];
    for (var j = 0; j < shown; j++) rows.push(fitText(names[j], maxChars));
    return { boxW: boxW, rowH: rowH, rows: rows, extra: extra, lh: (shown + (extra ? 1 : 0)) * rowH + 12 * k };
  }

  /* 数据质量检查：重复 X、非单调 X */
  function detectQuality(points) {
    var groups = new Map();
    var nonMonotonic = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (i > 0 && p.x < points[i - 1].x) nonMonotonic = true;
      var g = groups.get(p.x);
      if (g) g.lineNos.push(p.lineNo);
      else groups.set(p.x, { x: p.x, lineNos: [p.lineNo] });
    }
    var duplicates = [];
    var extra = 0;
    groups.forEach(function (g) {
      if (g.lineNos.length > 1) { duplicates.push(g); extra += g.lineNos.length - 1; }
    });
    return { nonMonotonic: nonMonotonic, duplicates: duplicates, duplicateExtra: extra };
  }

  /* 显式选择“合并重复X”时才执行：取平均，保留被合并行号明细 */
  function mergeDuplicates(points) {
    var groups = new Map();
    var order = [];
    points.forEach(function (p) {
      var g = groups.get(p.x);
      if (!g) { g = { x: p.x, ys: [], lineNos: [] }; groups.set(p.x, g); order.push(g); }
      g.ys.push(p.y); g.lineNos.push(p.lineNo);
    });
    var merged = [];
    var out = order.map(function (g) {
      var sum = 0;
      for (var i = 0; i < g.ys.length; i++) sum += g.ys[i];
      var mean = sum / g.ys.length;
      if (g.lineNos.length > 1) merged.push({ x: g.x, count: g.lineNos.length, lineNos: g.lineNos.slice(), mean: mean });
      return { x: g.x, y: mean, lineNo: g.lineNos[0], mergedLineNos: g.lineNos.slice() };
    });
    return { points: out, merged: merged };
  }

  /* 排序生成独立副本，绝不修改输入 */
  function sortPoints(points) {
    return points.slice().sort(function (a, b) { return a.x - b.x; });
  }

  /* CSV 数值：最短往返表示，不做固定小数位截断 */
  function formatNum(v) {
    return String(v);
  }

  function errorSignature(errors) {
    return errors.map(function (e) { return e.lineNo + ':' + e.reason; }).join('|');
  }

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  function checkPointArray(obj, key, errors, label) {
    var a = obj && obj[key];
    if (!Array.isArray(a) || a.length === 0) { errors.push(label + '.' + key + ' 必须是非空数组'); return null; }
    for (var i = 0; i < a.length; i++) {
      if (!isFiniteNum(a[i])) { errors.push(label + '.' + key + '[' + i + '] 不是有限数值'); return null; }
    }
    return a;
  }

  /* ---------- v2：背景 / 峰表 / 历史 / 已选物相 ---------- */
  function defaultBg() {
    return { mode: 'none', iterations: 24, points: [], applied: false, preview: true };
  }
  function defaultPeakParams() {
    return { smooth: 9, noiseK: 3, minHeight: null, minProm: 0, minDist: 0.15, lo: null, hi: null };
  }
  function defaultPeaks() {
    return { params: defaultPeakParams(), list: [], basisKey: null, sigma: null };
  }

  function validateBg(bg, label, errors) {
    if (bg == null) return;
    if (typeof bg !== 'object') { errors.push(label + '.bg 必须是对象'); return; }
    if (['none', 'snip', 'shirley', 'manual'].indexOf(bg.mode) === -1) errors.push(label + '.bg.mode 必须是 none/snip/shirley/manual');
    if (!isFiniteNum(bg.iterations) || bg.iterations < 1 || bg.iterations > 500) errors.push(label + '.bg.iterations 必须在 1–500');
    if (typeof bg.applied !== 'boolean' || typeof bg.preview !== 'boolean') errors.push(label + '.bg.applied/preview 必须是布尔值');
    if (!Array.isArray(bg.points)) errors.push(label + '.bg.points 必须是数组');
    else {
      if (bg.points.length > 200) errors.push(label + '.bg.points 超过 200 个上限');
      for (var i = 0; i < bg.points.length; i++) {
        var p = bg.points[i];
        if (!p || !isFiniteNum(p.x) || !isFiniteNum(p.y)) { errors.push(label + '.bg.points[' + i + '] 缺少有限数值 x/y'); break; }
      }
    }
    if (bg.applied && bg.mode === 'none') errors.push(label + '.bg.applied=true 但 mode=none');
    if (bg.applied && bg.mode === 'manual' && (!Array.isArray(bg.points) || !bg.points.length)) errors.push(label + '.bg 手动模式已扣除但无背景点');
  }

  function validatePeaks(pk, label, errors) {
    if (pk == null) return;
    if (typeof pk !== 'object') { errors.push(label + '.peaks 必须是对象'); return; }
    var pp = pk.params;
    if (!pp || typeof pp !== 'object') errors.push(label + '.peaks.params 缺失');
    else {
      if (!isFiniteNum(pp.smooth) || pp.smooth < 0 || pp.smooth > 31) errors.push(label + '.peaks.params.smooth 必须在 0–31');
      if (!isFiniteNum(pp.noiseK) || pp.noiseK < 0) errors.push(label + '.peaks.params.noiseK 必须 >= 0');
      if (pp.minHeight != null && !isFiniteNum(pp.minHeight)) errors.push(label + '.peaks.params.minHeight 必须是有限数值或 null');
      if (!isFiniteNum(pp.minProm) || pp.minProm < 0) errors.push(label + '.peaks.params.minProm 必须 >= 0');
      if (!isFiniteNum(pp.minDist) || pp.minDist < 0) errors.push(label + '.peaks.params.minDist 必须 >= 0');
      ['lo', 'hi'].forEach(function (k) { if (pp[k] != null && !isFiniteNum(pp[k])) errors.push(label + '.peaks.params.' + k + ' 必须是有限数值或 null'); });
      if (isFiniteNum(pp.lo) && isFiniteNum(pp.hi) && pp.lo >= pp.hi) errors.push(label + '.peaks.params.lo 必须小于 hi');
    }
    if (!Array.isArray(pk.list)) errors.push(label + '.peaks.list 必须是数组');
    else {
      if (pk.list.length > 2000) errors.push(label + '.peaks.list 超过 2000 峰上限');
      var ids = new Set();
      for (var i = 0; i < pk.list.length; i++) {
        var p = pk.list[i], at = label + '.peaks.list[' + i + ']';
        if (!p || typeof p !== 'object') { errors.push(at + ' 不是对象'); break; }
        if (typeof p.id !== 'string' || !p.id || ids.has(p.id)) { errors.push(at + '.id 无效或重复'); break; }
        ids.add(p.id);
        if (!isFiniteNum(p.x) || !isFiniteNum(p.height)) { errors.push(at + ' 缺少有限数值 x/height'); break; }
        if (p.source !== 'auto' && p.source !== 'manual') { errors.push(at + '.source 必须是 auto/manual'); break; }
        if (p.index != null && (!isFiniteNum(p.index) || p.index < 0 || Math.floor(p.index) !== p.index)) { errors.push(at + '.index 必须是非负整数'); break; }
      }
    }
    if (pk.basisKey != null && typeof pk.basisKey !== 'string') errors.push(label + '.peaks.basisKey 必须是字符串或 null');
  }

  /* 项目 JSON 恢复校验：结构、版本、数值逐一检查（v1 兼容，v2 增加分析状态） */
  function validateProject(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['文件内容不是 JSON 对象'] };
    if (obj.format !== 'catplot-project') errors.push('format 必须为 "catplot-project"，实际为 ' + JSON.stringify(obj.format));
    if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3 && obj.version !== 4 && obj.version !== 5) errors.push('不支持的版本：' + JSON.stringify(obj.version) + '（当前支持 1/2/3/4/5）');
    if (!obj.settings || typeof obj.settings !== 'object') errors.push('缺少 settings 对象');
    else {
      if (typeof obj.settings.title !== 'string') errors.push('settings.title 必须是字符串');
      ['xMin', 'xMax', 'yMin', 'yMax'].forEach(function (k) {
        var v = obj.settings[k];
        if (v !== null && !isFiniteNum(v)) errors.push('settings.' + k + ' 必须是有限数值或 null');
      });
      if (isFiniteNum(obj.settings.xMin) && isFiniteNum(obj.settings.xMax) && obj.settings.xMin >= obj.settings.xMax) errors.push('settings.xMin 必须小于 xMax');
      if (isFiniteNum(obj.settings.yMin) && isFiniteNum(obj.settings.yMax) && obj.settings.yMin >= obj.settings.yMax) errors.push('settings.yMin 必须小于 yMax');
      ['showLegend', 'showGrid'].forEach(function (k) {
        if (typeof obj.settings[k] !== 'boolean') errors.push('settings.' + k + ' 必须是布尔值');
      });
    }
    if (obj.refs != null) {
      if (window.CatCards) errors.push.apply(errors, window.CatCards.validateRefs(obj.refs));
      else if (!Array.isArray(obj.refs)) errors.push('refs 必须是数组');
    }
    if (obj.lib != null) {
      if (typeof obj.lib !== 'object') errors.push('lib 必须是对象');
      else {
        if (obj.lib.wavelength != null && !(obj.lib.wavelength > 0 && obj.lib.wavelength <= 10)) errors.push('lib.wavelength 必须是 0–10 Å 正数或 null');
        if (typeof obj.lib.sticksOn !== 'boolean') errors.push('lib.sticksOn 必须是布尔值');
      }
    }
    if (!Array.isArray(obj.samples)) errors.push('samples 必须是数组');
    var samples = [];
    var totalPoints = 0;
    if (Array.isArray(obj.samples)) {
      if (obj.samples.length > 200) errors.push('样品数 ' + obj.samples.length + ' 超过上限 200');
      obj.samples.forEach(function (s, idx) {
        var label = 'samples[' + idx + ']';
        if (!s || typeof s !== 'object') { errors.push(label + ' 不是对象'); return; }
        if (typeof s.name !== 'string' || !s.name.trim()) errors.push(label + '.name 必须是非空字符串');
        if (typeof s.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.color)) errors.push(label + '.color 必须是 #rrggbb');
        if (!isFiniteNum(s.lineWidth) || s.lineWidth < 0.1 || s.lineWidth > 20) errors.push(label + '.lineWidth 必须在 0.1–20');
        if (!isFiniteNum(s.offset) || s.offset < 0) errors.push(label + '.offset 必须是 >= 0 的有限数值');
        if (typeof s.normalize !== 'boolean') errors.push(label + '.normalize 必须是布尔值');
        if (typeof s.visible !== 'boolean') errors.push(label + '.visible 必须是布尔值');
        if (s.source !== 'file' && s.source !== 'sim') errors.push(label + '.source 必须是 file 或 sim');
        var rx = checkPointArray(s.raw, 'x', errors, label + '.raw');
        var ry = checkPointArray(s.raw, 'y', errors, label + '.raw');
        if (rx && ry && rx.length !== ry.length) errors.push(label + '.raw.x 与 raw.y 长度不一致');
        if (rx) totalPoints += rx.length;
        if (s.raw && s.raw.lineNos != null) {
          if (!Array.isArray(s.raw.lineNos) || s.raw.lineNos.length !== (rx || []).length) errors.push(label + '.raw.lineNos 长度必须与 raw.x 一致');
          else {
            for (var li = 0; li < s.raw.lineNos.length; li++) {
              var ln = s.raw.lineNos[li];
              if (!isFiniteNum(ln) || ln < 1 || Math.floor(ln) !== ln) { errors.push(label + '.raw.lineNos[' + li + '] 必须是正整数行号'); break; }
              if (li > 0 && ln <= s.raw.lineNos[li - 1]) { errors.push(label + '.raw.lineNos 必须按文件顺序严格递增'); break; }
            }
          }
        }
        var rawLineSet = null, rawByLine = null;
        if (rx && s.raw && Array.isArray(s.raw.lineNos) && s.raw.lineNos.length === rx.length) {
          rawLineSet = new Set(s.raw.lineNos);
          rawByLine = new Map();
          s.raw.lineNos.forEach(function (ln, i) { rawByLine.set(ln, i); });
        }
        var wLineArr = null;
        if (s.working != null) {
          var wx = checkPointArray(s.working, 'x', errors, label + '.working');
          var wy = checkPointArray(s.working, 'y', errors, label + '.working');
          if (wx && wy && wx.length !== wy.length) errors.push(label + '.working.x 与 working.y 长度不一致');
          if (wx && rx && wx.length > rx.length) errors.push(label + '.working 点数不得多于 raw');
          if (s.working.lineNos != null) {
            if (!Array.isArray(s.working.lineNos) || s.working.lineNos.length !== (wx || []).length) errors.push(label + '.working.lineNos 长度必须与 working.x 一致');
            else wLineArr = s.working.lineNos;
          } else if (wx && rx && wx.length !== rx.length) {
            errors.push(label + '.working 缺少 lineNos 且长度与 raw 不一致，无法对齐三层数据');
          }
          if (wLineArr && rawLineSet) {
            var seen = new Set();
            for (var wi = 0; wi < wLineArr.length; wi++) {
              var wl = wLineArr[wi];
              if (!rawLineSet.has(wl)) { errors.push(label + '.working.lineNos[' + wi + ']=' + wl + ' 不存在于 raw 行号中'); break; }
              if (seen.has(wl)) { errors.push(label + '.working.lineNos 存在重复行号 ' + wl); break; }
              seen.add(wl);
            }
          }
        }
        if (s.importMeta != null && typeof s.importMeta !== 'object') errors.push(label + '.importMeta 必须是对象');
        if (s.importMeta && typeof s.importMeta === 'object' && rawByLine && wx && wy) {
          var meta = s.importMeta;
          var wByLine = new Map();
          if (wLineArr) wLineArr.forEach(function (ln, i) { wByLine.set(ln, i); });
          var wDup = new Set();
          var wNonMono = false;
          for (var q = 0; q < wx.length; q++) {
            wDup.add(wx[q]);
            if (q > 0 && wx[q] < wx[q - 1]) wNonMono = true;
          }
          var hasDupX = wDup.size !== wx.length;
          if (meta.duplicateMode === 'merge' && hasDupX) errors.push(label + '.importMeta.duplicateMode=merge 但 working 仍存在重复 X');
          if (meta.duplicateMode === 'keep' && Array.isArray(meta.merged) && meta.merged.length) errors.push(label + '.importMeta.duplicateMode=keep 但存在合并记录');
          if (meta.sortApplied === 'asc' && wNonMono) errors.push(label + '.importMeta.sortApplied=asc 但 working 非升序');
          if (meta.sortApplied !== 'asc' && wLineArr && rawByLine) {
            for (var so = 1; so < wLineArr.length; so++) {
              if (rawByLine.get(wLineArr[so]) <= rawByLine.get(wLineArr[so - 1])) { errors.push(label + '.importMeta.sortApplied=none 但 working 未保持文件顺序'); break; }
            }
          }
          if (Array.isArray(meta.merged)) {
            meta.merged.forEach(function (g, gi) {
              var gl = label + '.importMeta.merged[' + gi + ']';
              if (!g || !Array.isArray(g.lineNos) || !g.lineNos.length) { errors.push(gl + ' 缺少行号明细'); return; }
              var sum = 0, okLines = true;
              g.lineNos.forEach(function (ln) {
                var ri = rawByLine.get(ln);
                if (ri == null) { okLines = false; return; }
                sum += ry[ri];
              });
              if (!okLines) { errors.push(gl + '.lineNos 含不在 raw 中的行号'); return; }
              var mean = sum / g.lineNos.length;
              if (!isFiniteNum(g.mean) || Math.abs(g.mean - mean) > 1e-6 * Math.max(1, Math.abs(mean))) errors.push(gl + '.mean 与 raw 行均值不一致');
              var ri0 = rawByLine.get(g.lineNos[0]);
              if (g.x !== rx[ri0]) errors.push(gl + '.x 与 raw 对应行 X 不一致');
              var w0 = wByLine.get(g.lineNos[0]);
              if (w0 == null) errors.push(gl + ' 的首行号未出现在 working 中');
              else {
                if (Math.abs(wy[w0] - mean) > 1e-6 * Math.max(1, Math.abs(mean))) errors.push(gl + ' 合并后的 working 值与均值不一致');
                for (var mi = 1; mi < g.lineNos.length; mi++) {
                  if (wByLine.has(g.lineNos[mi])) { errors.push(gl + ' 被合并行 ' + g.lineNos[mi] + ' 仍存在于 working'); break; }
                }
              }
            });
          }
          if (Array.isArray(meta.skippedRows)) {
            for (var sk = 0; sk < meta.skippedRows.length; sk++) {
              var e = meta.skippedRows[sk];
              if (!e || !isFiniteNum(e.lineNo) || typeof e.reason !== 'string' || !e.reason) { errors.push(label + '.importMeta.skippedRows[' + sk + '] 结构无效'); break; }
              if (rawLineSet.has(e.lineNo)) { errors.push(label + '.importMeta.skippedRows 行 ' + e.lineNo + ' 同时存在于 raw，记录矛盾'); break; }
            }
          }
          if (meta.xCol != null && meta.yCol != null && meta.xCol === meta.yCol) errors.push(label + '.importMeta.xCol 与 yCol 不得相同');
        }
        validateBg(s.bg, label, errors);
        validatePeaks(s.peaks, label, errors);
        samples.push(s);
      });
    }
    if (totalPoints > 5000000) errors.push('总数据点 ' + totalPoints + ' 超过本地上限 5,000,000');
    if (obj.history != null) {
      if (!Array.isArray(obj.history)) errors.push('history 必须是数组');
      else obj.history.forEach(function (h, i) {
        if (!h || typeof h.text !== 'string' || typeof h.at !== 'string') errors.push('history[' + i + '] 缺少 text/at');
      });
    }
    if (obj.phases != null) {
      if (!Array.isArray(obj.phases)) errors.push('phases 必须是数组');
      else {
        if (obj.phases.length > 100) errors.push('phases 超过 100 个上限');
        obj.phases.forEach(function (p, i) {
          if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim()) errors.push('phases[' + i + '] 缺少 id/name');
          if (p && p.source !== 'manual' && p.source !== 'match') errors.push('phases[' + i + '].source 必须是 manual/match');
        });
      }
    }
    if (obj.fit != null) {
      var ft = obj.fit;
      if (typeof ft !== 'object' || !Array.isArray(ft.regions)) errors.push('fit 必须是含 regions 的对象或 null');
      else {
        if (ft.regions.length > 8) errors.push('fit.regions 存档上限 8');
        ft.regions.forEach(function (rg, i) {
          if (!rg || !isFiniteNum(rg.min) || !isFiniteNum(rg.max) || !(rg.max > rg.min)) errors.push('fit.regions[' + i + '] 区间无效');
          if (rg && rg.peaks && (!Array.isArray(rg.peaks) || rg.peaks.length > 30)) errors.push('fit.regions[' + i + '].peaks 上限 30');
          if (rg && Array.isArray(rg.peaks)) rg.peaks.forEach(function (p, j) {
            if (!p || !isFiniteNum(p.c) || !isFiniteNum(p.w) || !isFiniteNum(p.h) || p.w <= 0 || p.h < 0) errors.push('fit.regions[' + i + '].peaks[' + j + '] 参数无效');
          });
        });
      }
    }
    return { ok: errors.length === 0, errors: errors, samples: samples, settings: obj.settings, refs: obj.refs || [], lib: obj.lib || null, history: obj.history || [], phases: obj.phases || [], fit: obj.fit || null };
  }

  /* 深拷贝序列化：返回独立对象，调用方修改不会污染运行中的 state */
  function serializeProject(state) {
    var payload = {
      format: 'catplot-project',
      version: 5,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      technique: state.technique || 'xrd',
      selectedId: state.selectedId || null,
      refs: state.refs || [],
      lib: state.lib || null,
      history: state.history || [],
      phases: state.phases || [],
      fit: state.fit || null,
      samples: state.samples.map(function (s) {
        return {
          name: s.name, color: s.color, lineWidth: s.lineWidth, visible: s.visible,
          offset: s.offset, normalize: s.normalize, source: s.source, note: s.note || '',
          raw: s.raw, working: s.working, importMeta: s.importMeta || null,
          bg: s.bg || defaultBg(), peaks: s.peaks || defaultPeaks()
        };
      })
    };
    return JSON.parse(JSON.stringify(payload));
  }

  /* 表征配置：通用谱图引擎（绘图/寻峰/拟合/批量/报告）按配置切换轴标签与专属功能。
     xrd 保留 d值/Scherrer/卡片/物相匹配；其余表征仅通用绘图+寻峰+拟合+批量趋势。
     注意：须在 window.CatModel 导出之前声明（var 不提升初始化）。 */
  var TECHNIQUES = {
    xrd:    { id: 'xrd',    name: 'XRD',  xLabel: '2θ (°)',            xUnit: '°',        yLabel: '强度 (a.u.)',        yStack: 'Intensity (a.u.)',     xrd: true  },
    raman:  { id: 'raman',  name: '拉曼', xLabel: '拉曼位移 (cm⁻¹)',   xUnit: 'cm⁻¹',     yLabel: '强度 (a.u.)',        yStack: 'Intensity (a.u.)',     xrd: false },
    ftir:   { id: 'ftir',   name: '红外', xLabel: '波数 (cm⁻¹)',       xUnit: 'cm⁻¹',     yLabel: '吸光度 (a.u.)',      yStack: 'Absorbance (a.u.)',    xrd: false },
    xps:    { id: 'xps',    name: 'XPS',  xLabel: '结合能 (eV)',       xUnit: 'eV',       yLabel: '强度 (counts/s)',    yStack: 'Intensity (cps)',      xrd: false }
  };
  function tech(id) { return TECHNIQUES[id] || TECHNIQUES.xrd; }

  /* 每表征推荐分析流程（简单：扣背景→寻峰→分峰→峰面积/比），含科学口径与默认背景 */
  var GUIDE = {
    xrd:   { bg: 'snip',    steps: '扣背景(SNIP/手动) → 寻峰 → 分峰拟合 → 峰面积/FWHM → Scherrer 晶粒尺寸 / 卡片对照', note: '面积占比非物相含量；Scherrer 为表观值。' },
    raman: { bg: 'snip',    steps: '扣荧光背底(SNIP/手动) → 寻峰 → 分峰(如 D/G/2D) → 峰面积比 ID/IG、峰位偏移', note: 'ID/IG 为面积比，反映缺陷/石墨化程度，非绝对含量。' },
    ftir:  { bg: 'manual',  steps: '基线校正(手动/自动) → 寻峰 → 分峰(官能团区) → 峰面积相对占比(如 C=O/C–O)', note: '面积为相对占比，非绝对浓度；基线影响面积，需统一方法。' },
    xps:   { bg: 'shirley', steps: 'Shirley 背底扣除 → 寻峰 → 分峰(化学态) → 峰面积相对占比', note: '面积为化学态相对占比；绝对定量需灵敏度因子，本工具不做。' }
  };
  function guide(id) { return GUIDE[id] || GUIDE.xrd; }

  window.CatModel = {
    maxOf: maxOf, minOf: minOf,
    canNormalize: canNormalize, normalizeBlockReason: normalizeBlockReason,
    buildLayers: buildLayers, decimateMinMax: decimateMinMax, decimateWindow: decimateWindow,
    buildQueryIndex: buildQueryIndex, nearestSorted: nearestSorted, autoYDomain: autoYDomain,
    textUnits: textUnits, fitText: fitText, legendLayout: legendLayout,
    detectQuality: detectQuality, mergeDuplicates: mergeDuplicates, sortPoints: sortPoints,
    formatNum: formatNum, errorSignature: errorSignature,
    defaultBg: defaultBg, defaultPeakParams: defaultPeakParams, defaultPeaks: defaultPeaks,
    validateBg: validateBg, validatePeaks: validatePeaks,
    validateProject: validateProject, serializeProject: serializeProject,
    TECHNIQUES: TECHNIQUES, tech: tech, GUIDE: GUIDE, guide: guide
  };
})();