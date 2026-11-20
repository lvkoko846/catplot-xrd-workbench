/* CatPlot 组会报告接线（report-1）：采集当前项目状态（样品/拟合/批量/匹配/示例溯源）→
   CatReport.buildReport 生成自包含 HTML → 下载。对比图用 CatChart.serializeForExport，趋势图取批量面板 SVG。 */
(function () {
  'use strict';
  var App = window.CatApp, Chart = window.CatChart, Report = window.CatReport;
  function $(id) { return document.getElementById(id); }

  function collect() {
    var st = App.state;
    var samples = st.samples.map(function (s) {
      return { name: s.name, source: s.source, points: s.raw && s.raw.x ? s.raw.x.length : 0, normalize: !!s.normalize, offset: s.offset || 0 };
    });
    /* 对比图 SVG（显示层，含参考轨道） */
    var mainSvg = null;
    try { mainSvg = Chart.serializeForExport($('chart'), 1200); } catch (e) { mainSvg = null; }
    /* 拟合区域 */
    var fitRegions = [];
    if (st.fit && st.fit.regions) st.fit.regions.forEach(function (r) {
      if (r.result && r.result.ok !== false) fitRegions.push({ min: r.min, max: r.max, shape: r.result.shape, params: r.result.params, quality: r.result.quality });
    });
    /* 批量 + 趋势 */
    var batchResults = (st.batch && st.batch.results) || (window.CatBatchUI && CatBatchUI.ui.results) || null;
    var trendSvg = null, aligned = null;
    if (window.CatBatchUI && CatBatchUI.ui.aligned) {
      aligned = CatBatchUI.ui.aligned;
      var ts = $('batchTrendChart'); if (ts && ts.innerHTML.includes('<path')) trendSvg = ts.outerHTML;
    }
    /* 匹配 */
    var match = null;
    if (window.CatMatchUI) {
      var mu = CatMatchUI.ui;
      var covTxt = $('matchCoverage') ? $('matchCoverage').textContent : '';
      if ((mu.last && mu.last.candidates) || (mu.phases && mu.phases.length)) match = { candidates: mu.last ? mu.last.candidates : [], phases: mu.phases, coverage: covTxt };
    }
    /* 示例卡溯源 */
    var provenance = [];
    if (window.CatCards && CatCards.rt && CatCards.rt.doc && CatCards.rt.doc.cards) {
      CatCards.rt.doc.cards.forEach(function (c) { provenance.push({ name: c.name, license: c.license, source: c.source, url: c.source_url, note: c.pattern_type === 'computed' ? '计算图谱' : '实验谱' }); });
    }
    return {
      title: (st.settings && st.settings.title) || 'CatPlot 组会报告',
      generatedAt: new Date().toISOString(),
      mainSvg: mainSvg, trendSvg: trendSvg, samples: samples, fitRegions: fitRegions,
      batchResults: batchResults, aligned: aligned, match: match, provenance: provenance
    };
  }

  function exportReport() {
    var payload = collect();
    var html = Report.buildReport(payload);
    Chart.download(new Blob([html], { type: 'text/html;charset=utf-8' }), 'catplot-report.html');
    App.toast('组会报告已导出（自包含 HTML，含溯源与诚实清单）。', 'ok');
  }

  function init() { ['btnReport', 'btnReportTop'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', exportReport); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CatReportUI = { collect: collect, exportReport: exportReport };
})();
