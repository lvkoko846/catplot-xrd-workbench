/* CatPlot 系列样品批量分析面板（batch-1）：样品选择 + 共享区间/峰型/背景/寻峰设置 →
   Worker 逐样品拟合（复用 fitworker/fitcore）→ 跨样品峰对齐 → 趋势图（峰位/d/FWHM/面积/晶粒尺寸）
   + 结果汇总表 + 趋势/汇总 CSV + 趋势 PNG/SVG。恒用 raw 原始层；失败给具体原因；可取消。
   晶粒尺寸为 Scherrer 表观值，未扣仪器宽化时强制警示。不做物相定量。 */
(function () {
  'use strict';
  var App = window.CatApp, Core = window.CatFitCore, Batch = window.CatBatchCore, Chart = window.CatChart;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(v, d) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 3 : d); }
  var PALETTE = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  var ui = { worker: null, seq: 0, pending: {}, running: false, cancelFlag: false, results: null, aligned: null, selected: {} };

  function status(msg, kind) { var el = $('batchStatus'); el.textContent = msg; el.className = 'hint ' + (kind === 'err' ? 'mt-err' : kind === 'ok' ? 'mt-ok' : 'process-note'); }
  function samples() { return App.state.samples; }
  function selIds() { return samples().filter(function (s) { return ui.selected[s.id]; }).map(function (s) { return s.id; }); }

  /* ---------- 样品选择 ---------- */
  function renderSampleList() {
    var box = $('batchSampleList'), ss = samples();
    if (!ss.length) { box.innerHTML = '<p class="hint">暂无样品：先上传或加载示例。</p>'; $('batchSelCount').textContent = '已选 0'; return; }
    box.innerHTML = ss.map(function (s, i) {
      var xv = ui.xValues && ui.xValues[s.id] != null ? String(Math.round(ui.xValues[s.id] * 1e6) / 1e6) : '';
      return '<label class="batch-sample-row"><input type="checkbox" data-bsel="' + esc(s.id) + '"' + (ui.selected[s.id] ? ' checked' : '') + '>' +
        '<span class="batch-swatch" style="background:' + esc(s.color) + '"></span>' +
        '<span class="batch-sname">' + esc(s.name) + '</span>' +
        '<input type="number" step="any" class="input batch-xval" data-bxval="' + esc(s.id) + '" placeholder="组分" value="' + esc(xv) + '"' + ($('batchXMode').value === 'value' ? '' : ' hidden') + '></label>';
    }).join('');
    $('batchSelCount').textContent = '已选 ' + selIds().length;
    box.querySelectorAll('[data-bsel]').forEach(function (cb) {
      cb.addEventListener('change', function () { ui.selected[this.getAttribute('data-bsel')] = this.checked; $('batchSelCount').textContent = '已选 ' + selIds().length; });
    });
    box.querySelectorAll('[data-bxval]').forEach(function (inp) {
      inp.addEventListener('input', function () { ui.xValues = ui.xValues || {}; ui.xValues[this.getAttribute('data-bxval')] = this.value === '' ? null : +this.value; });
    });
  }
  function setAll(fn) { samples().forEach(function (s) { ui.selected[s.id] = fn(s); }); renderSampleList(); }

  /* ---------- 设置读取 ---------- */
  function readSettings() {
    var ids = selIds(), ss = samples().filter(function (s) { return ui.selected[s.id]; });
    var xMode = $('batchXMode').value;
    var xValues = ss.map(function (s) { var v = ui.xValues && ui.xValues[s.id]; return v == null || !isFinite(v) ? null : v; });
    return {
      region: { min: +$('batchRMin').value, max: +$('batchRMax').value },
      shape: $('batchShape').value, bg: { model: $('batchBg').value },
      init: 'auto', minHeight: +$('batchMinHeight').value, minDist: +$('batchMinDist').value,
      lambda: +$('batchLambda').value || 1.5406, K: +$('batchK').value || 0.89,
      instrument: { mode: $('batchInstMode').value, fwhm: $('batchInstFwhm').value === '' ? null : +$('batchInstFwhm').value },
      xMode: xMode, xValues: xValues, _samples: ss
    };
  }

  /* ---------- Worker 批量 ---------- */
  function ensureWorker() {
    if (ui.worker) return ui.worker;
    ui.worker = new Worker('js/fitworker.js');
    ui.worker.onmessage = function (e) { var m = e.data, cb = ui.pending[m.id]; if (!cb) return; delete ui.pending[m.id]; cb(m.res); };
    ui.worker.onerror = function (e) { status('批量 Worker 出错：' + (e.message || '未知'), 'err'); ui.running = false; $('btnBatchCancel').hidden = true; $('btnBatchRun').disabled = false; };
    return ui.worker;
  }
  /* 复用 batchcore.fitSample（与 Node 真值测试同路径）：auto 寻峰初值（突出度抗噪）+ raw 层 +
     Scherrer 表观值。fitSample 内部 await Core.fit；Worker 仅用于取消时 terminate 兜底。 */
  function fitOne(w, sample, settings) {
    return Batch.fitSample(sample, settings, { isCancelled: function () { return ui.cancelFlag; } });
  }
  async function runBatch() {
    var settings = readSettings(), ss = settings._samples;
    if (!ss.length) { status('请先选择至少一个样品。', 'err'); return; }
    if (!(settings.region.max > settings.region.min)) { status('区间无效：止须大于起。', 'err'); return; }
    if (settings.xMode === 'value' && settings.xValues.some(function (v) { return v == null; })) { status('组分值模式：请为每个选中样品填写组分值。', 'err'); return; }
    var w = ensureWorker();
    ui.running = true; ui.cancelFlag = false; ui.results = [];
    $('btnBatchRun').disabled = true; $('btnBatchCancel').hidden = false; $('batchProgress').hidden = false;
    status('批量分析中（0/' + ss.length + '）…');
    for (var i = 0; i < ss.length; i++) {
      if (ui.cancelFlag) { ui.results.push({ id: ss[i].id, name: ss[i].name, index: i, ok: false, reason: 'cancelled: 批量已取消', skipped: true, xValue: settings.xMode === 'value' ? settings.xValues[i] : i + 1 }); continue; }
      var s = ss[i];
      var res = await fitOne(w, s, settings);
      var r = Object.assign({}, res, { id: s.id, name: s.name, index: i, xValue: settings.xMode === 'value' ? settings.xValues[i] : i + 1 });
      ui.results.push(r);
      $('batchProgressBar').style.width = (100 * (i + 1) / ss.length) + '%';
      status('批量分析中（' + (i + 1) + '/' + ss.length + '）…' + (r.ok ? '' : ' ' + s.name + '：' + r.reason));
    }
    ui.running = false; $('btnBatchCancel').hidden = true; $('btnBatchRun').disabled = false;
    var batch = { results: ui.results, settings: settings, at: new Date().toISOString(), algo: 'batch-1' };
    ui.aligned = Batch.alignPeaks(batch, { tol: +$('batchTol').value || 1.0 });
    App.state.batch = { settings: { region: settings.region, shape: settings.shape, bg: settings.bg, minHeight: settings.minHeight, minDist: settings.minDist, lambda: settings.lambda, K: settings.K, instrument: settings.instrument, xMode: settings.xMode, xValues: settings.xValues, tol: +$('batchTol').value || 1.0 }, results: ui.results, at: batch.at };
    App.checkpoint('系列批量分析 ' + ss.length + ' 样品（' + ui.results.filter(function (r) { return r.ok; }).length + ' 成功，batch-1）');
    App.save();
    var okN = ui.results.filter(function (r) { return r.ok; }).length;
    status('批量完成：' + okN + '/' + ss.length + ' 成功。' + (okN < ss.length ? ' 失败样品见汇总表（含具体原因）。' : '') + ' 晶粒尺寸为表观值（未扣仪器宽化时偏小）。', okN === ss.length ? 'ok' : 'err');
    renderAnchorSelect(); renderTrend(); renderSummary();
    /* 趋势图在右侧滚动面板下方，运行后自动滚入视，避免"看不到趋势" */
    try { $('batchTrendChart').scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
  }
  function cancelBatch() {
    if (!ui.running) return;
    ui.cancelFlag = true;
    if (ui.worker) { ui.worker.postMessage({ cancel: true }); setTimeout(function () { if (ui.running && ui.worker) { ui.worker.terminate(); ui.worker = null; } }, 1500); }
    status('取消中…当前样品完成后停止。');
  }

  /* ---------- 趋势图 ---------- */
  var METRICS = { c: { label: '峰位 2θ (°)', get: function (p) { return p.c; } }, d: { label: 'd 值 (Å)', get: function (p) { return p.d; } }, w: { label: 'FWHM (°)', get: function (p) { return p.w; } }, area: { label: '积分面积', get: function (p) { return p.area; } }, D: { label: '表观晶粒尺寸 (nm)', get: function (p) { return p.D; } } };
  function renderAnchorSelect() {
    var sel = $('batchAnchor'), a = ui.aligned;
    if (!a || !a.anchors.length) { sel.innerHTML = '<option value="">（无结果）</option>'; return; }
    sel.innerHTML = '<option value="all">全部锚峰（多系列）</option>' + a.anchors.map(function (an, i) { return '<option value="' + i + '">' + esc(an.label) + ' @ ' + f(an.ref, 2) + '°（' + an.points.length + ' 样品）</option>'; }).join('');
    /* 多峰样品默认看全部锚峰；单锚时选观测最多者 */
    sel.value = a.anchors.length > 1 ? 'all' : '0';
  }
  function renderTrend() {
    var svg = $('batchTrendChart'), a = ui.aligned;
    var metric = $('batchMetric').value, M = METRICS[metric];
    $('batchScherrerWarn').hidden = !(metric === 'D');
    if (!a || !a.anchors.length) { svg.innerHTML = '<text x="480" y="210" text-anchor="middle" fill="#94a3b8" font-size="16">运行批量分析后显示趋势</text>'; $('batchTrendLegend').innerHTML = ''; $('batchTrendNote').textContent = ''; return; }
    var selVal = $('batchAnchor').value;
    var relOn = $('batchRel') && $('batchRel').checked;
    var series = [];
    if (selVal === 'all') {
      a.anchors.forEach(function (an, i) { if (an.points.length >= 2) series.push({ an: an, ci: i }); });
      if (!series.length) a.anchors.forEach(function (an, i) { series.push({ an: an, ci: i }); });
    } else {
      var ai0 = +selVal || 0; series.push({ an: a.anchors[Math.min(ai0, a.anchors.length - 1)], ci: ai0 });
    }
    /* 每系列：相对偏移模式以首观测为基准（多峰同图可比）；否则绝对值 */
    series.forEach(function (s) {
      s.pts = s.an.points.filter(function (p) { var v = M.get(p); return v != null && isFinite(v); });
      s.base = s.pts.length ? M.get(s.pts[0]) : 0;
      s.val = function (p) { return relOn ? M.get(p) - s.base : M.get(p); };
    });
    var allPts = []; series.forEach(function (s) { allPts = allPts.concat(s.pts); });
    var W = 960, H = 420, mL = 70, mR = 30, mT = 30, mB = 60, pw = W - mL - mR, ph = H - mT - mB;
    if (!allPts.length) { svg.innerHTML = '<text x="480" y="210" text-anchor="middle" fill="#94a3b8" font-size="16">该指标无有效数据</text>'; return; }
    var xs = allPts.map(function (p) { return p.xValue; });
    var ys = []; series.forEach(function (s) { s.pts.forEach(function (p) { ys.push(s.val(p)); }); });
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs); if (xMax === xMin) { xMin -= 1; xMax += 1; }
    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys); var pad = (yMax - yMin) * 0.1 || Math.abs(yMax) * 0.1 || 1; yMin -= pad; yMax += pad;
    function X(v) { return mL + (v - xMin) / (xMax - xMin) * pw; }
    function Y(v) { return mT + ph - (v - yMin) / (yMax - yMin) * ph; }
    var parts = ['<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>'];
    for (var g = 0; g <= 5; g++) {
      var yv = yMin + (yMax - yMin) * g / 5, yy = Y(yv);
      parts.push('<line x1="' + mL + '" y1="' + yy + '" x2="' + (W - mR) + '" y2="' + yy + '" stroke="#e2e8f0" stroke-width="1"/>');
      parts.push('<text x="' + (mL - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#64748b" font-size="12">' + f(yv, metric === 'area' ? 0 : 3) + '</text>');
    }
    var uniqX = xs.filter(function (v, i) { return xs.indexOf(v) === i; });
    var xticks = Math.min(uniqX.length, 8);
    for (var t = 0; t < xticks; t++) {
      var xv = xMin + (xMax - xMin) * t / Math.max(1, xticks - 1), xx = X(xv);
      parts.push('<line x1="' + xx + '" y1="' + (mT + ph) + '" x2="' + xx + '" y2="' + (mT + ph + 5) + '" stroke="#94a3b8"/>');
      parts.push('<text x="' + xx + '" y="' + (mT + ph + 20) + '" text-anchor="middle" fill="#64748b" font-size="12">' + f(xv, 2) + '</text>');
    }
    parts.push('<line x1="' + mL + '" y1="' + mT + '" x2="' + mL + '" y2="' + (mT + ph) + '" stroke="#94a3b8"/>');
    parts.push('<line x1="' + mL + '" y1="' + (mT + ph) + '" x2="' + (W - mR) + '" y2="' + (mT + ph) + '" stroke="#94a3b8"/>');
    /* 多系列折线 + 点 */
    var legend = [];
    series.forEach(function (s) {
      var color = PALETTE[s.ci % PALETTE.length];
      var sorted = s.pts.slice().sort(function (p, q) { return p.xValue - q.xValue; });
      if (sorted.length >= 2) {
        var path = sorted.map(function (p, i) { return (i ? 'L' : 'M') + X(p.xValue).toFixed(1) + ' ' + Y(s.val(p)).toFixed(1); }).join(' ');
        parts.push('<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2"/>');
      }
      sorted.forEach(function (p) {
        parts.push('<circle cx="' + X(p.xValue).toFixed(1) + '" cy="' + Y(s.val(p)).toFixed(1) + '" r="4" fill="' + color + '"><title>' + esc(s.an.label) + ' · ' + esc(p.name) + '：' + f(s.val(p), 4) + '</title></circle>');
      });
      legend.push('<span class="fit-legend-item"><span class="batch-swatch" style="background:' + color + '"></span>' + esc(s.an.label) + ' @' + f(s.an.ref, 2) + '°（' + s.pts.length + '）</span>');
    });
    var xLabel = $('batchXMode').value === 'value' ? '组分值' : '样品序号';
    var yLabel = (relOn ? 'Δ' : '') + M.label + (relOn ? '（相对首样品）' : '');
    parts.push('<text x="' + (mL + pw / 2) + '" y="' + (H - 12) + '" text-anchor="middle" fill="#334155" font-size="14">' + xLabel + '</text>');
    parts.push('<text x="18" y="' + (mT + ph / 2) + '" text-anchor="middle" fill="#334155" font-size="14" transform="rotate(-90 18 ' + (mT + ph / 2) + ')">' + esc(yLabel) + '</text>');
    parts.push('<text x="' + mL + '" y="18" fill="#334155" font-size="14">' + (selVal === 'all' ? '全部锚峰趋势（' + series.length + ' 系列）' : esc(series[0].an.label) + ' 趋势 · 参考 ' + f(series[0].an.ref, 2) + '°') + '</text>');
    svg.innerHTML = parts.join('');
    $('batchTrendLegend').innerHTML = legend.join('');
    var maxPts = Math.max.apply(null, series.map(function (s) { return s.pts.length; }));
    var note;
    if (maxPts < 2) {
      note = '锚峰观测不足（最多 ' + maxPts + ' 个样品），不足以构成趋势。原因：各样品在此区间不含同一物相峰，或峰位漂移超出容差（' + f(a.tol, 2) + '°）——不同峰不会被硬连成趋势。请增大容差、改选含共同峰的区间，或换用同一物相的梯度系列样品（如掺杂/温度系列）。';
    } else if (metric === 'D') {
      note = '晶粒尺寸由 Scherrer 公式估算，为表观值；未扣仪器宽化时系统性偏小。多峰同图建议勾选"相对首样品偏移"。';
    } else {
      note = '趋势基于跨样品峰对齐（容差 ' + f(a.tol, 2) + '°，参考样品 ' + esc(a.refName || '') + '）；多峰样品各锚峰独立成系列；面积占比非物相含量。';
    }
    $('batchTrendNote').textContent = note;
    $('batchTrendNote').className = 'hint ' + (maxPts < 2 ? 'mt-warn' : '');
  }

  /* ---------- 汇总表 ---------- */
  function renderSummary() {
    var box = $('batchSummaryTable'), rs = ui.results;
    if (!rs || !rs.length) { box.innerHTML = '<p class="hint">运行批量分析后显示汇总。</p>'; return; }
    box.innerHTML = '<table class="preview-table mt-table"><thead><tr><th>#</th><th>样品</th><th>X</th><th>状态</th><th>峰数</th><th>Rwp</th><th>首峰 2θ</th><th>首峰 FWHM</th><th>首峰 D(nm)</th><th>原因</th></tr></thead><tbody>' +
      rs.map(function (r) {
        var p0 = r.ok && r.params && r.params[0];
        return '<tr><td>' + (r.index + 1) + '</td><td>' + esc(r.name) + '</td><td>' + f(r.xValue, 2) + '</td><td>' + (r.ok ? '<span class="mt-ok">成功</span>' : '<span class="mt-err">失败</span>') + '</td><td>' + (r.ok ? r.params.length : 0) + '</td><td>' + (r.ok && r.quality ? f(r.quality.rwp, 4) : '—') + '</td><td>' + (p0 ? f(p0.c, 3) : '—') + '</td><td>' + (p0 ? f(p0.w, 4) : '—') + '</td><td>' + (p0 && p0.D != null ? f(p0.D, 2) + (p0.Dapparent ? '*' : '') : '—') + '</td><td class="hint">' + esc(r.ok ? '' : r.reason) + '</td></tr>';
      }).join('') + '</tbody></table><p class="hint">* 表观晶粒尺寸（未扣仪器宽化，系统性偏小）。失败样品保留具体原因，不静默跳过。首峰仅为速览，全部特征峰见下表与「全峰 CSV」。</p>' + allPeaksTable(rs);
  }
  function allPeaksTable(rs) {
    var rows = [];
    rs.forEach(function (r) {
      if (!r.ok || !r.params) return;
      r.params.forEach(function (p, pi) {
        rows.push('<tr><td>' + esc(r.name) + '</td><td>' + f(r.xValue, 2) + '</td><td>' + (pi + 1) + '</td><td>' + f(p.c, 3) + '</td><td>' + f(p.d, 4) + '</td><td>' + f(p.w, 4) + '</td><td>' + f(p.area, 1) + '</td><td>' + (p.D != null ? f(p.D, 2) + (p.Dapparent ? '*' : '') : '—') + '</td></tr>');
      });
    });
    if (!rows.length) return '';
    return '<h4 class="batch-subhead">每样品全部特征峰（' + rows.length + ' 行）</h4><div class="table-scroll fit-scroll"><table class="preview-table mt-table"><thead><tr><th>样品</th><th>X</th><th>峰#</th><th>中心2θ</th><th>d(Å)</th><th>FWHM(°)</th><th>面积</th><th>D(nm)</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  /* ---------- 导出 ---------- */
  function exportTrendCsv() { if (!ui.aligned) { status('无结果可导出。', 'err'); return; } Chart.download(new Blob([Batch.trendCSV(ui.aligned)], { type: 'text/csv;charset=utf-8' }), 'catplot-trend.csv'); }
  function exportSummaryCsv() { if (!ui.results) { status('无结果可导出。', 'err'); return; } Chart.download(new Blob([Batch.summaryCSV({ results: ui.results })], { type: 'text/csv;charset=utf-8' }), 'catplot-batch-summary.csv'); }
  function exportPeaksCsv() {
    if (!ui.results) { status('无结果可导出。', 'err'); return; }
    var lines = ['sample,x_value,peak,center_2theta,d_angstrom,fwhm_deg,area,D_nm,D_apparent'];
    ui.results.forEach(function (r) {
      if (!r.ok || !r.params) return;
      r.params.forEach(function (p, pi) {
        lines.push([Batch.csvCell(r.name), r.xValue, pi + 1, p.c, p.d, p.w, p.area, p.D == null ? '' : p.D, p.Dapparent == null ? '' : p.Dapparent].join(','));
      });
    });
    Chart.download(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), 'catplot-batch-allpeaks.csv');
  }
  function exportPng() { if (!ui.aligned) { status('无结果可导出。', 'err'); return; } Chart.exportPNG($('batchTrendChart'), 'catplot-trend.png', 1920); }
  function exportSvg() { if (!ui.aligned) { status('无结果可导出。', 'err'); return; } Chart.exportSVG($('batchTrendChart'), 'catplot-trend.svg', 1920); }

  /* ---------- 刷新与接线 ---------- */
  function refresh() { renderSampleList(); if (ui.aligned) { renderAnchorSelect(); renderTrend(); renderSummary(); } }
  function onShow() {
    /* 默认选中可见样品 */
    if (!Object.keys(ui.selected).length) samples().forEach(function (s) { ui.selected[s.id] = s.visible; });
    renderSampleList();
    if (App.state.batch && App.state.batch.results && !ui.results) {
      ui.results = App.state.batch.results;
      ui.aligned = Batch.alignPeaks({ results: ui.results }, { tol: (App.state.batch.settings && App.state.batch.settings.tol) || 1.0 });
      renderAnchorSelect(); renderTrend(); renderSummary();
    }
  }
  function init() {
    $('btnBatchSelVisible').addEventListener('click', function () { setAll(function (s) { return s.visible; }); });
    $('btnBatchSelAll').addEventListener('click', function () { setAll(function () { return true; }); });
    $('btnBatchSelNone').addEventListener('click', function () { setAll(function () { return false; }); });
    $('btnBatchRun').addEventListener('click', runBatch);
    $('btnBatchCancel').addEventListener('click', cancelBatch);
    $('batchMetric').addEventListener('change', renderTrend);
    $('batchAnchor').addEventListener('change', renderTrend);
    if ($('batchRel')) $('batchRel').addEventListener('change', renderTrend);
    $('batchXMode').addEventListener('change', function () { var v = this.value === 'value'; $('batchXValues').hidden = !v; renderSampleList(); });
    $('btnBatchTrendCsv').addEventListener('click', exportTrendCsv);
    $('btnBatchSummaryCsv').addEventListener('click', exportSummaryCsv);
    if ($('btnBatchPeaksCsv')) $('btnBatchPeaksCsv').addEventListener('click', exportPeaksCsv);
    $('btnBatchPng').addEventListener('click', exportPng);
    $('btnBatchSvg').addEventListener('click', exportSvg);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CatBatchUI = { refresh: refresh, onShow: onShow, ui: ui };
})();
