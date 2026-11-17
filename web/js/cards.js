/* CatPlot 公开示例参考卡（离线内置，无数据库、无外部服务）。
   数据：web/data/example-cards.json（CC0 COD 计算图谱 ×2 + MIT XRED 实验峰表 ×1，scripts/build-examples.py 生成）。
   仅提供棒图叠加与拟合对照所需的峰表/换算；不含检索、元素筛选、匹配评分。 */
(function () {
  'use strict';
  var STICK_PALETTE = ['#b45309', '#7c3aed', '#0d9488', '#dc2626', '#0369a1', '#db2777', '#4d7c0f', '#9333ea'];
  function braggTwoTheta(d, lambda) {
    var r = lambda / (2 * d);
    if (!(r > 0 && r <= 1)) return null;
    return 2 * Math.asin(r) * 180 / Math.PI;
  }
  var rt = { sticks: [], cards: [], doc: null, index: false, loading: null };
  function loadExamples() {
    if (rt.doc) return Promise.resolve(rt.doc);
    if (rt.loading) return rt.loading;
    rt.loading = fetch('data/example-cards.json').then(function (r) {
      if (!r.ok) throw new Error('示例卡加载失败 HTTP ' + r.status);
      return r.json();
    }).then(function (doc) {
      rt.doc = doc; rt.cards = doc.cards || []; rt.index = true; rt.loading = null;
      return doc;
    }).catch(function (e) { rt.loading = null; throw e; });
    return rt.loading;
  }
  function makeStick(card, lambda, color) {
    var peaks = (card.peaks || []).map(function (p) {
      var t = p.t != null ? p.t : (lambda != null ? braggTwoTheta(p.d, lambda) : null);
      return { d: p.d, i: p.i, t: t, hkl: p.hkl ? String(p.hkl).trim().split(/s+/).map(Number) : null };
    }).filter(function (p) { return p.t != null; });
    return {
      key: 'ex:' + card.uid, uid: card.uid, label: card.name, color: color, lambda: lambda,
      peaks: peaks, withdrawn: false, converted: false,
      license: card.license, pattern_type: card.pattern_type, source: card.source,
      source_url: card.source_url, citation: card.citation, n_peaks: card.n_peaks
    };
  }
  function validateRefs(refs) {
    var errs = [];
    (refs || []).forEach(function (r, i) {
      if (!r || typeof r.key !== 'string' || r.key.indexOf('ex:') !== 0) errs.push('refs[' + i + '] 键无效');
    });
    return errs;
  }
  window.CatCards = {
    STICK_PALETTE: STICK_PALETTE, braggTwoTheta: braggTwoTheta, rt: rt,
    loadExamples: loadExamples, makeStick: makeStick, validateRefs: validateRefs
  };
})();