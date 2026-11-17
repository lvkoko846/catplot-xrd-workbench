/* CatPlot 示例参考卡面板（公开版）：内置公开示例卡列表 + 波长确认 + 参考轨道启用。
   无检索/元素筛选/匹配/外部服务；许可与图谱类型逐卡徽标展示。 */
(function () {
  'use strict';
  var App = window.CatApp, Cards = window.CatCards;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var ui = { remote: { status: null, err: null }, refFail: {} };
  function openDrawer() { $('cardsDrawer').hidden = false; refreshStatus(); renderRefs(); renderLambda(); }
  function closeDrawer() { $('cardsDrawer').hidden = true; }
  function refreshStatus() {
    Cards.loadExamples().then(function (doc) {
      ui.remote.err = null;
      ui.remote.status = { dbVersion: doc.library_version, records: doc.cards.length, offline: true, published: true };
      var cc = doc.cards.filter(function (c) { return c.license === 'CC0-1.0'; }).length;
      var mm = doc.cards.filter(function (c) { return c.license === 'MIT'; }).length;
      $('exStatus').textContent = '公开示例卡 ' + doc.cards.length + ' 张（CC0 计算 ×' + cc + ' · MIT 实验 ×' + mm + '）· 离线内置，无外部服务、无数据库';
      renderExList(doc);
      if (App.state.lib.sticksOn) resolveSticks().then(function () { App.renderAll(); });
    }).catch(function (e) {
      ui.remote.err = String(e && e.message || e);
      $('exStatus').textContent = '示例卡加载失败：' + ui.remote.err;
    });
  }
  function renderExList(doc) {
    var box = $('exList');
    box.innerHTML = (doc.cards || []).map(function (c) {
      var added = App.state.refs.some(function (r) { return r.key === 'ex:' + c.uid; });
      return '<div class="ex-row">' +
        '<div class="ex-head"><b>' + esc(c.name) + '</b><span class="muted">' + esc(c.formula) + '</span>' +
        '<span class="badge ' + (c.pattern_type === 'computed' ? 'sim' : 'offset') + '">' + (c.pattern_type === 'computed' ? '计算图谱' : '实验谱') + '</span>' +
        '<span class="badge offset">' + esc(c.license) + '</span></div>' +
        '<div class="muted ex-sub">' + esc(c.source) + ' ' + esc(c.source_id) + ' · 峰 ' + c.n_peaks + ' · λ=' + c.wavelength + 'Å' +
        (c.source_url ? ' · <a href="' + esc(c.source_url) + '" target="_blank" rel="noopener">来源</a>' : '') + '</div>' +
        '<div class="muted ex-sub">' + esc(c.citation) + '</div>' +
        (c.note ? '<div class="muted ex-sub">' + esc(c.note) + '</div>' : '') +
        '<div class="drow"><button class="btn tiny" type="button" data-exadd="' + esc(c.uid) + '"' + (added ? ' disabled' : '') + '>' + (added ? '已加入轨道' : '加入参考轨道') + '</button></div>' +
        '</div>';
    }).join('');
  }
  function addExample(uid) {
    var card = Cards.rt.cards.find(function (c) { return c.uid === uid; });
    if (!card) return Promise.reject(new Error('示例卡不存在：' + uid));
    var key = 'ex:' + uid;
    if (!App.state.refs.some(function (r) { return r.key === key; })) {
      App.state.refs.push({ key: key, uid: uid, source: 'example', label: card.name, name: card.name, formula: card.formula, license: card.license, pattern_type: card.pattern_type, enabled: true });
    }
    if (!App.state.lib.sticksOn) {
      App.state.lib.sticksOn = true;
      var cb = $('sticksOn'); if (cb) cb.checked = true;
    }
    App.save();
    return resolveSticks().then(function () { App.renderAll(); renderRefs(); return card; });
  }
  function resolveSticks() {
    return Cards.loadExamples().then(function () {
      var lam = App.state.lib.wavelength;
      ui.refFail = {};
      var sticks = [];
      App.state.refs.forEach(function (r, i) {
        if (r.enabled === false) return;
        var card = Cards.rt.cards.find(function (c) { return 'ex:' + c.uid === r.key; });
        if (!card) { ui.refFail[r.key] = 'missing'; return; }
        var useLam = lam != null ? lam : card.wavelength;
        sticks.push(Cards.makeStick(card, useLam, Cards.STICK_PALETTE[i % Cards.STICK_PALETTE.length]));
      });
      Cards.rt.sticks = sticks;
      renderRefs();
      return sticks;
    }).catch(function (e) {
      ui.remote.err = String(e && e.message || e);
      Cards.rt.sticks = [];
      return [];
    });
  }
  function renderRefs() {
    var box = $('refList');
    if (!box) return;
    if (!App.state.refs.length) { box.innerHTML = '<p class="muted">未加入示例卡：在上方列表加入。</p>'; return; }
    box.innerHTML = App.state.refs.map(function (r) {
      var card = Cards.rt.cards.find(function (c) { return 'ex:' + c.uid === r.key; });
      var fail = ui.refFail[r.key];
      return '<div class="drow ref-row"><span class="muted">' + esc(r.name || r.key) + '</span>' +
        (card ? '<span class="badge ' + (card.pattern_type === 'computed' ? 'sim' : 'offset') + '">' + (card.pattern_type === 'computed' ? '计算图谱' : '实验谱') + '</span><span class="badge offset">' + esc(card.license) + '</span>' : '') +
        (fail === 'noLambda' ? '<span class="badge stale">待确认波长</span>' : fail ? '<span class="badge stale">不在示例集</span>' : '') +
        '<button class="btn tiny ghost" type="button" data-exdel="' + esc(r.key) + '">移除</button></div>';
    }).join('');
  }
  function renderLambda() {
    var lam = App.state.lib.wavelength;
    $('stickLambda').value = lam == null ? '' : lam;
    var preset = $('stickLambdaPreset');
    var match = [...preset.options].some(function (o) { return o.value && Number(o.value) === lam; });
    preset.value = lam == null ? '' : (match ? String(lam) : 'custom');
    $('lambdaStatus').textContent = lam == null ? '未确认实验波长：示例卡含 d 与 2θ，确认波长后按实验波长换算叠加。' : '实验波长 λ=' + lam + ' Å（示例卡 2θ 按此波长换算）';
    $('stickLockNote').textContent = '示例卡为公开许可数据（CC0/MIT），叠加仅供演示与拟合对照，非物相鉴定结论。';
    var cb = $('sticksOn'); if (cb) cb.checked = !!App.state.lib.sticksOn;
  }
  $('btnCards').addEventListener('click', openDrawer);
  $('cardsClose').addEventListener('click', closeDrawer);
  $('stickLambdaPreset').addEventListener('change', function () {
    if (this.value === 'custom') { $('stickLambda').focus(); return; }
    if (this.value) $('stickLambda').value = this.value;
  });
  $('btnLambdaConfirm').addEventListener('click', function () {
    var v = Number($('stickLambda').value);
    if (!(v >= 0.1 && v <= 10)) { App.toast('波长须在 0.1–10 Å。', 'err'); return; }
    App.checkpoint('确认实验波长 λ=' + v + ' Å');
    App.state.lib.wavelength = v;
    App.save(); renderLambda();
    resolveSticks().then(function () { App.renderAll(); });
    App.toast('实验波长已确认：λ=' + v + ' Å', 'ok');
  });
  $('sticksOn').addEventListener('change', function () {
    App.state.lib.sticksOn = this.checked;
    App.save();
    resolveSticks().then(function () { App.renderAll(); });
  });
  $('exList').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-exadd]') : null;
    if (!b) return;
    addExample(b.getAttribute('data-exadd')).then(function (card) {
      App.toast('已加入参考轨道：' + card.name + '（' + card.license + ' · ' + (card.pattern_type === 'computed' ? '计算图谱' : '实验谱') + '）', 'ok');
    }).catch(function (e) { App.toast(String(e.message || e), 'err'); });
  });
  $('refList').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-exdel]') : null;
    if (!b) return;
    var key = b.getAttribute('data-exdel');
    App.checkpoint('移除参考轨道「' + key + '」');
    App.state.refs = App.state.refs.filter(function (r) { return r.key !== key; });
    App.save();
    resolveSticks().then(function () { App.renderAll(); });
  });
  window.CatCardsUI = {
    openDrawer: openDrawer, closeDrawer: closeDrawer, resolveSticks: resolveSticks,
    renderRefs: renderRefs, renderLambda: renderLambda, refreshStatus: refreshStatus,
    previewRemoteUid: addExample, ui: ui
  };
  renderLambda();
  refreshStatus();
})();