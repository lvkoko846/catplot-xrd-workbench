/* CatPlot 物相匹配面板（pm-2-lite）：粘贴自有参考峰表 → 与当前样品实验峰（寻峰/拟合）证据匹配 →
   候选排序 → 确认物相（covered 按峰位入档）→ 覆盖核算（剩余/重叠）→ 剩余峰续匹配（多物相闭环）。
   公开版无数据库；得分非存在概率；参考<1%弱峰不配对；一对一占用。状态随项目存档。 */
(function () {
  'use strict';
  var App = window.CatApp, MC = window.CatMatchCore;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(v, d) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 3 : d); }
  var ui = { refs: [], phases: [], last: null };

  function MS() { if (!App.state.match) App.state.match = { refs: [], phases: [] }; return App.state.match; }
  function status(msg, kind) { var el = $('matchStatus'); el.textContent = msg; el.className = 'hint ' + (kind === 'err' ? 'mt-err' : kind === 'ok' ? 'mt-ok' : 'process-note'); }
  function sample() { return App.getSelected(); }
  function lambda() { var v = +$('matchLambda').value; return isFinite(v) && v > 0 ? v : 1.5406; }
  function tol() { var v = +$('matchTol').value; return isFinite(v) && v > 0 ? v : 0.2; }

  /* 实验峰：寻峰峰表（working 层）或拟合峰（raw 层结果，更抗噪） */
  function expPeaks() {
    var s = sample(); if (!s) return [];
    var lam = lambda();
    if ($('matchExpSrc').value === 'fit') {
      var fs = App.state.fit;
      if (fs && fs.regions) {
        var out = [];
        fs.regions.forEach(function (r) { if (r.result && r.result.ok !== false && r.result.params) r.result.params.forEach(function (p) { out.push({ t: p.c, i: p.h }); }); });
        if (out.length) return MC.expFromPeaks(out, lam);
      }
      status('当前无拟合结果，回退寻峰峰表。', 'err');
    }
    var pk = (s.peaks && s.peaks.list) || [];
    return MC.expFromPeaks(pk.map(function (p) { return { t: p.x, i: p.height }; }), lam);
  }

  /* ---------- 参考管理 ---------- */
  function addRef(text, mode) {
    var r = MC.parseRefTable(text, { mode: mode || $('matchMode').value, lambda: lambda() });
    if (!r.ok) { status('参考解析失败：' + r.errors.join('；'), 'err'); return false; }
    ui.refs.push(r.card); MS().refs = ui.refs;
    renderRefs();
    status('已加入参考「' + r.card.name + '」（' + r.card.peaks.length + ' 峰）。' + (r.errors.length ? ' 提示：' + r.errors.join('；') : ''), 'ok');
    App.toast('已加入参考「' + r.card.name + '」（' + r.card.peaks.length + ' 峰），可运行匹配', 'ok');
    App.save();
    return true;
  }
  function renderRefs() {
    $('matchRefList').innerHTML = ui.refs.map(function (r, i) {
      return '<span class="match-ref-chip">' + esc(r.name) + (r.formula ? ' (' + esc(r.formula) + ')' : '') + ' · ' + r.peaks.length + '峰 · ' + esc(r.source) +
        ' <button class="btn tiny ghost" type="button" data-mrefdel="' + i + '">移除</button></span>';
    }).join('') || '<p class="hint">尚未加入参考。</p>';
    $('matchRefList').querySelectorAll('[data-mrefdel]').forEach(function (b) {
      b.addEventListener('click', function () { ui.refs.splice(+this.getAttribute('data-mrefdel'), 1); MS().refs = ui.refs; renderRefs(); App.save(); });
    });
  }
  var EXAMPLE = '# name=锐钛矿\n# formula=TiO2\n# wavelength=1.5406\n# source=XRED随附COD结构计算示例\n25.28,100,101\n37.80,40,004\n48.05,50,200\n54.0,15,105\n62.7,12,204\n# name=金红石\n# formula=TiO2\n# wavelength=1.5406\n# source=XRED随附COD结构计算示例\n27.45,100,110\n36.09,50,101\n41.25,25,111\n54.32,60,211\n';
  function loadExample() {
    /* 示例含两张卡：按 '# name=' 分段 */
    var blocks = EXAMPLE.split(/(?=# name=)/).filter(function (b) { return b.trim(); });
    ui.refs = [];
    blocks.forEach(function (b) { var r = MC.parseRefTable(b, { mode: 't', lambda: lambda() }); if (r.ok) ui.refs.push(r.card); });
    MS().refs = ui.refs; renderRefs();
    status('已载入 TiO2 双相示例参考（锐钛矿+金红石，计算示例峰表，仅供演示）。', 'ok');
    App.toast('已载入 TiO2 双相示例参考（2 张），可运行匹配', 'ok');
    App.save();
  }

  /* ---------- 匹配 ---------- */
  function runMatch(expOverride) {
    var s = sample();
    if (!s) { status('请先选择样品。', 'err'); return; }
    if (!ui.refs.length) { status('请先加入至少一个参考峰表。', 'err'); return; }
    var exp = expOverride || expPeaks();
    if (!exp.length) { status('当前样品无实验峰：先寻峰或拟合。', 'err'); return; }
    var res = MC.match(exp, ui.refs, lambda(), tol(), null);
    ui.last = res;
    renderCands(res);
    status('匹配完成：' + exp.length + ' 实验峰 × ' + ui.refs.length + ' 参考。得分非存在概率。', 'ok');
    App.toast('匹配完成：' + res.candidates.length + ' 个候选，首位 ' + (res.candidates[0] ? res.candidates[0].name + ' ' + res.candidates[0].score + ' 分' : '—'), 'ok');
  }
  function renderCands(res) {
    var box = $('matchCandTable');
    if (!res || !res.candidates.length) { box.innerHTML = '<p class="hint">运行匹配后显示候选。</p>'; return; }
    box.innerHTML = '<table class="preview-table mt-table"><thead><tr><th>参考</th><th>得分</th><th>可靠</th><th>匹配/实验</th><th>比例</th><th>偏差</th><th>证据峰(Δ2θ)</th><th></th></tr></thead><tbody>' +
      res.candidates.map(function (c, i) {
        var ev = c.pairs.slice(0, 4).map(function (p) { return f(p.expT, 2) + '(' + (p.deltaT != null ? (p.deltaT > 0 ? '+' : '') + p.deltaT : '—') + ')'; }).join(', ');
        return '<tr><td>' + esc(c.name) + '</td><td><b>' + c.score + '</b></td><td>' + (c.reliable ? '<span class="mt-ok">可靠</span>' : '<span class="mt-err">不足</span>') + '</td><td>' + c.matched + '/' + c.usableExp + '</td><td>' + f(c.composition.matchFrac, 2) + '</td><td>' + f(c.composition.devScore, 2) + '</td><td class="hint">' + esc(ev) + '</td><td><button class="btn tiny" type="button" data-mconfirm="' + i + '">确认</button></td></tr>';
      }).join('') + '</tbody></table><p class="hint">' + esc(res.scoreNote) + '</p>';
    box.querySelectorAll('[data-mconfirm]').forEach(function (b) {
      b.addEventListener('click', function () { confirmPhase(res.candidates[+this.getAttribute('data-mconfirm')]); });
    });
  }

  /* ---------- 确认闭环 ---------- */
  function confirmPhase(c) {
    if (!c) return;
    if (ui.phases.some(function (p) { return p.name === c.name; })) { status('「' + c.name + '」已确认。', 'err'); return; }
    ui.phases.push({ name: c.name, formula: c.formula, source: c.source, score: c.score, reliable: c.reliable, coveredT: c.coveredT.slice(), at: new Date().toISOString() });
    MS().phases = ui.phases;
    App.checkpoint('确认物相「' + c.name + '」（得分 ' + c.score + '，覆盖 ' + c.coveredT.length + ' 峰，pm-2-lite）');
    App.save();
    renderPhases();
    status('已确认「' + c.name + '」。可用剩余未解释峰续匹配下一物相。', 'ok');
  }
  function renderPhases() {
    var exp = expPeaks();
    var cov = MC.coverage(exp, ui.phases, tol());
    $('matchPhaseList').innerHTML = ui.phases.map(function (p, i) {
      return '<div class="match-phase-row"><b>' + esc(p.name) + '</b> · 得分 ' + p.score + ' · 覆盖 ' + p.coveredT.length + ' 峰 · ' + (p.reliable ? '可靠' : '证据不足') +
        ' <button class="btn tiny ghost" type="button" data-mphdel="' + i + '">移除</button></div>';
    }).join('') || '<p class="hint">尚未确认物相。</p>';
    $('matchPhaseList').querySelectorAll('[data-mphdel]').forEach(function (b) {
      b.addEventListener('click', function () { ui.phases.splice(+this.getAttribute('data-mphdel'), 1); MS().phases = ui.phases; renderPhases(); App.save(); });
    });
    $('matchCoverage').textContent = '实验峰 ' + exp.length + ' · 已解释 ' + cov.covered.length + ' · 重叠 ' + cov.overlap.length + ' · 剩余未解释 ' + cov.remaining.length;
    $('btnMatchRemaining').disabled = !cov.remaining.length;
    ui.remaining = cov.remaining;
  }
  function runRemaining() {
    if (!ui.remaining || !ui.remaining.length) { status('无剩余未解释峰。', 'err'); return; }
    runMatch(ui.remaining);
    status('以剩余 ' + ui.remaining.length + ' 个未解释峰续匹配；确认后将叠加覆盖。', 'ok');
  }

  /* ---------- 刷新/接线 ---------- */
  function onShow() {
    var ms = MS();
    ui.refs = ms.refs || []; ui.phases = ms.phases || [];
    /* 当前样品无峰表时自动寻峰预填，避免"运行匹配报无实验峰"的门槛 */
    var s = sample();
    if (s && (!s.peaks || !s.peaks.list || !s.peaks.list.length) && window.CatAnalysis && s.working && s.working.x && s.working.x.length) {
      var pr = window.CatAnalysis.findPeaks(s.working.x, s.working.y, { smooth: 9, noiseK: 3, minHeight: 50, minDist: 0.3 });
      if (pr.peaks.length) {
        s.peaks = s.peaks || { params: { smooth: 9, noiseK: 3, minHeight: 50, minProm: 0, minDist: 0.3, lo: null, hi: null }, list: [], basisKey: null, sigma: null };
        s.peaks.list = pr.peaks.map(function (p, i) { return { id: 'mp' + i, x: p.x, height: p.height, source: 'auto', index: p.i }; });
        App.save();
        status('已为「' + s.name + '」自动寻峰 ' + pr.peaks.length + ' 个作为实验峰；加入参考后即可运行匹配。', 'ok');
      }
    }
    renderRefs(); renderPhases();
    if (ui.last) renderCands(ui.last);
  }
  function init() {
    $('btnMatchAddRef').addEventListener('click', function () { addRef($('matchRefText').value); });
    $('btnMatchExample').addEventListener('click', loadExample);
    $('btnMatchRun').addEventListener('click', function () { runMatch(); });
    $('btnMatchRemaining').addEventListener('click', runRemaining);
    $('btnMatchClearPhases').addEventListener('click', function () { ui.phases = []; MS().phases = []; renderPhases(); App.save(); });
    $('matchExpSrc').addEventListener('change', function () { renderPhases(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.CatMatchUI = { onShow: onShow, ui: ui, runMatch: runMatch, addRef: addRef };
})();
