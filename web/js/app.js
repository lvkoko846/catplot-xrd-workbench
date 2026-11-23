/* CatPlot 分析工作台：三层数据（原始/分析/显示）、背景扣除、寻峰、参考轨道、
   处理历史与撤销重做、项目 JSON v2、导出。偏移与归一化不进入寻峰输入。 */
(function () {
  'use strict';

  var STORE_KEY = 'catplot.state.v1';
  var PALETTE = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
  var MAX_FILE_MB = 15;
  var M = window.CatModel;
  var AN = window.CatAnalysis;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    samples: [],
    settings: { title: 'XRD 图谱对比', xMin: null, xMax: null, yMin: null, yMax: null, showLegend: true, showGrid: true, stack: true, stackGap: 1.15, stackScale: 0.8 },
    selectedId: null,
    technique: 'xrd',
    refs: [],
    lib: { wavelength: null, sticksOn: false },
    history: [],
    phases: [],
    fit: null,
    batch: null,
    match: null,
    projectVersion: null
  };
  var uiTool = 'display';
  var uiDataTab = 'peaks';
  var pickMode = null; /* 'bg' | 'peak' | null */
  var highlightPeakId = null;
  var undoStack = [], redoStack = [];

  /* ---------- 工具 ---------- */
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function stamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  function clock() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function nextColor() {
    var used = state.samples.map(function (s) { return s.color; });
    for (var i = 0; i < PALETTE.length; i++) if (used.indexOf(PALETTE[i]) === -1) return PALETTE[i];
    return PALETTE[state.samples.length % PALETTE.length];
  }
  function getSelected() {
    return state.samples.find(function (s) { return s.id === state.selectedId; }) || null;
  }
  function visibleSamples() { return state.samples.filter(function (s) { return s.visible; }); }
  function exportSamples() {
    return $('exportScope').value === 'all' ? state.samples.slice() : visibleSamples();
  }
  function pointsToArrays(pts) {
    return {
      x: pts.map(function (p) { return p.x; }),
      y: pts.map(function (p) { return p.y; }),
      lineNos: pts.map(function (p) { return p.lineNo; })
    };
  }

  var toastTimer = null;
  function toast(msg, kind, actionLabel, actionFn) {
    var el = $('toast');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = '';
    el.appendChild(document.createTextNode(msg));
    if (actionLabel && actionFn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', function () { actionFn(); hideToast(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 6500 : 4200);
  }
  function hideToast() { $('toast').hidden = true; clearTimeout(toastTimer); }

  /* ---------- 三层数据：raw 只读 / 分析 = 工作副本 − 已确认背景 + 归一化 / 显示 = 分析 + 偏移 ---------- */
  function bgName(bg) {
    if (!bg) return '无';
    if (bg.mode === 'snip') return 'SNIP(' + bg.iterations + ')';
    if (bg.mode === 'shirley') return 'Shirley(' + bg.iterations + ')';
    if (bg.mode === 'manual') return '手动(' + bg.points.length + '点)';
    return '无';
  }
  function computeBgY(s) {
    if (!s.bg || s.bg.mode === 'none') return null;
    if (s.bg.mode === 'snip') return AN.snipBackground(s.working.y, s.bg.iterations);
    if (s.bg.mode === 'shirley') return AN.shirleyBackground(s.working.y, s.bg.iterations);
    if (s.bg.mode === 'manual') return AN.manualBackground(s.working.x, s.bg.points);
    return null;
  }
  function recomputeLayers(s) {
    var blocked = null;
    s.bgY = computeBgY(s);
    var base = s.working.y;
    if (s.bg && s.bg.applied && s.bgY) {
      base = new Array(s.working.y.length);
      for (var i = 0; i < base.length; i++) base[i] = s.working.y[i] - s.bgY[i];
    }
    /* 荷电校正（XPS）：整谱 X 轴平移，校正后坐标 = 原坐标 − shift。作用于 corrected/analysis/display；raw/working 不变。 */
    var sh = (s.charge && isFinite(s.charge.shift)) ? s.charge.shift : 0;
    var cx = new Array(s.working.x.length);
    for (var j = 0; j < cx.length; j++) cx[j] = sh ? s.working.x[j] - sh : s.working.x[j];
    s.corrected = { x: cx, y: base };
    if (s.normalize && !M.canNormalize(base)) {
      blocked = M.normalizeBlockReason(base);
      s.normalize = false;
    }
    var layers = M.buildLayers({ x: s.working.x, y: base }, s.normalize, s.offset, sh);
    s.analysis = layers.analysis;
    s.display = layers.display;
    s.xExtent = [M.minOf(s.display.x), M.maxOf(s.display.x)];
    s.q = M.buildQueryIndex(s.display.x);
    var parts = [];
    if (sh) parts.push('荷电校正(−' + M.formatNum(sh) + ')');
    if (s.bg && s.bg.applied) parts.push('背景扣除' + bgName(s.bg));
    parts.push(s.normalize ? '归一化(最强峰=1)' : '无归一化');
    s.processDesc = parts.join(' + ');
    return blocked;
  }
  function recomputeAll() { state.samples.forEach(recomputeLayers); }

  /* 峰表基线键：工作副本 + 背景 + 荷电位移。任一改变则旧峰表标为待更新。 */
  function sampleBasisKey(s) {
    var sh = (s.charge && s.charge.applied && isFinite(s.charge.shift)) ? s.charge.shift : 0;
    return AN.basisKey(s.working, s.bg) + ':' + (sh ? 'c' + Math.round(sh * 1e6) : 'c0');
  }
  function peaksStale(s) {
    return !!(s.peaks && s.peaks.list.length && s.peaks.basisKey !== sampleBasisKey(s));
  }

  function makeSample(opts) {
    var s = {
      id: uid(),
      name: opts.name,
      color: opts.color || nextColor(),
      lineWidth: 1.5,
      visible: true,
      offset: 0,
      normalize: false,
      source: opts.source || 'file',
      note: opts.note || '',
      raw: pointsToArrays(opts.rawPoints),
      working: pointsToArrays(opts.workingPoints || opts.rawPoints),
      importMeta: opts.importMeta || null,
      bg: opts.bg || M.defaultBg(),
      peaks: opts.peaks || M.defaultPeaks(),
      charge: opts.charge || M.defaultCharge()
    };
    recomputeLayers(s);
    state.samples.push(s);
    state.selectedId = s.id;
    return s;
  }

  /* ---------- 保存状态指示与持久化 ---------- */
  function sanitizeFit(f) {
    if (!f || typeof f !== 'object' || !Array.isArray(f.regions)) return null;
    var c = JSON.parse(JSON.stringify(f));
    c.regions = c.regions.slice(0, 8);
    return c;
  }
  function buildSlim() {
    return {
      samples: state.samples.map(function (s) {
        return {
          id: s.id, name: s.name, color: s.color, lineWidth: s.lineWidth, visible: s.visible,
          offset: s.offset, normalize: s.normalize, source: s.source, note: s.note || '',
          raw: s.raw, working: s.working, importMeta: s.importMeta,
          bg: s.bg, peaks: s.peaks
        };
      }),
      settings: state.settings,
      selectedId: state.selectedId,
      refs: state.refs,
      lib: state.lib,
      history: state.history,
      phases: state.phases,
      fit: state.fit
    };
  }
  var saveTimer = null, saveFailed = false;
  function setSaveStatus(kind, text) {
    var el = $('saveState');
    el.className = 'save-state ' + kind;
    el.textContent = text;
  }
  function save() {
    setSaveStatus('pending', '● 有未保存更改…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          format: 'catplot-local', version: 5, savedAt: new Date().toISOString(), state: buildSlim()
        }));
        saveFailed = false;
        setSaveStatus('ok', '● 已保存于本机 ' + clock());
      } catch (e) {
        saveFailed = true;
        setSaveStatus('fail', '● 保存失败：' + (e && e.name === 'QuotaExceededError' ? '浏览器存储空间不足' : (e.message || e)) + '（数据未持久化，请导出项目 JSON）');
        toast('本地保存失败，刷新后改动将丢失。请立即导出项目 JSON 备份。', 'err');
      }
    }, 350);
  }

  function hydrateSavedSample(s) {
    var rawPts = s.raw.x.map(function (x, i) {
      return { x: x, y: s.raw.y[i], lineNo: (s.raw.lineNos && s.raw.lineNos[i]) || i + 1 };
    });
    var w = s.working || s.raw;
    var wLineNos = w.lineNos || (w.x.length === s.raw.x.length ? rawPts.map(function (p) { return p.lineNo; }) : null);
    if (!wLineNos) return null;
    var workPts = w.x.map(function (x, i) { return { x: x, y: w.y[i], lineNo: wLineNos[i] }; });
    var bg = M.defaultBg(), peaks = M.defaultPeaks(), charge = M.defaultCharge();
    if (s.bg && typeof s.bg === 'object') {
      bg.mode = ['none', 'snip', 'shirley', 'manual'].indexOf(s.bg.mode) !== -1 ? s.bg.mode : 'none';
      bg.iterations = s.bg.iterations > 0 ? Math.min(500, Math.round(s.bg.iterations)) : 24;
      bg.points = Array.isArray(s.bg.points) ? s.bg.points.filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); }).map(function (p) { return { x: p.x, y: p.y }; }) : [];
      bg.applied = !!s.bg.applied && bg.mode !== 'none';
      bg.preview = s.bg.preview !== false;
    }
    if (s.peaks && typeof s.peaks === 'object') {
      peaks.params = Object.assign(M.defaultPeakParams(), s.peaks.params || {});
      peaks.list = Array.isArray(s.peaks.list) ? s.peaks.list.filter(function (p) { return p && typeof p.id === 'string' && isFinite(p.x) && isFinite(p.height); }) : [];
      peaks.basisKey = typeof s.peaks.basisKey === 'string' ? s.peaks.basisKey : null;
      peaks.sigma = isFinite(s.peaks.sigma) ? s.peaks.sigma : null;
    }
    if (s.charge && typeof s.charge === 'object') {
      charge.mode = ['none', 'manual', 'reference'].indexOf(s.charge.mode) !== -1 ? s.charge.mode : 'none';
      charge.shift = isFinite(s.charge.shift) ? s.charge.shift : 0;
      charge.refMeasured = isFinite(s.charge.refMeasured) ? s.charge.refMeasured : null;
      charge.refTarget = isFinite(s.charge.refTarget) ? s.charge.refTarget : null;
      charge.refLabel = typeof s.charge.refLabel === 'string' ? s.charge.refLabel : '';
      charge.applied = !!s.charge.applied && charge.mode !== 'none';
    }
    return {
      id: s.id || uid(), name: s.name, color: s.color, lineWidth: s.lineWidth, visible: s.visible,
      offset: s.offset, normalize: s.normalize, source: s.source, note: s.note || '',
      raw: pointsToArrays(rawPts), working: pointsToArrays(workPts), importMeta: s.importMeta || null,
      bg: bg, peaks: peaks, charge: charge
    };
  }

  /* 返回 'first' | 'restored' | 'corrupt'：用户保存的空项目不得重新播种模拟样品 */
  function load() {
    var txt = null;
    try { txt = localStorage.getItem(STORE_KEY); } catch (e) { return 'corrupt'; }
    if (txt === null) return 'first';
    try {
      var data = JSON.parse(txt);
      var inner = data && data.format === 'catplot-local' && (data.version === 1 || data.version === 2 || data.version === 3 || data.version === 4 || data.version === 5) ? data.state : data;
      if (!inner || !Array.isArray(inner.samples)) return 'corrupt';
      var rebuilt = [];
      inner.samples.forEach(function (s) {
        if (!s || !s.raw || !Array.isArray(s.raw.x) || !s.raw.x.length) return;
        var h = hydrateSavedSample(s);
        if (h) rebuilt.push(h);
      });
      state.samples = rebuilt;
      state.settings = Object.assign(state.settings, inner.settings || {});
      state.selectedId = inner.selectedId || (rebuilt[0] && rebuilt[0].id) || null;
      if (Array.isArray(inner.refs) && window.CatCards && !window.CatCards.validateRefs(inner.refs).length) state.refs = inner.refs;
      if (inner.lib && typeof inner.lib === 'object') {
        state.lib.wavelength = inner.lib.wavelength > 0 ? inner.lib.wavelength : null;
        state.lib.sticksOn = !!inner.lib.sticksOn;
      }
      state.history = Array.isArray(inner.history) ? inner.history.filter(function (h) { return h && typeof h.text === 'string'; }).slice(-200) : [];
      state.phases = Array.isArray(inner.phases) ? inner.phases.filter(function (p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; }) : [];
      state.fit = sanitizeFit(inner.fit);
      state.projectVersion = inner.version || 3;
      return 'restored';
    } catch (e) { return 'corrupt'; }
  }

  /* ---------- 处理历史与撤销重做 ---------- */
  function logHistory(text) {
    state.history.push({ at: new Date().toISOString(), text: text });
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
  }
  function checkpoint(label) {
    undoStack.push({ label: label, snap: JSON.stringify(buildSlim()) });
    if (undoStack.length > 25) undoStack.shift();
    redoStack = [];
    logHistory(label);
  }
  function applySnapshot(snap) {
    var inner = JSON.parse(snap);
    var rebuilt = [];
    inner.samples.forEach(function (s) {
      var h = hydrateSavedSample(s);
      if (h) rebuilt.push(h);
    });
    state.samples = rebuilt;
    state.settings = Object.assign({ title: 'XRD 图谱对比', xMin: null, xMax: null, yMin: null, yMax: null, showLegend: true, showGrid: true, stack: true, stackGap: 1.15, stackScale: 0.8 }, inner.settings || {});
    state.technique = inner.technique || 'xrd';
    state.selectedId = inner.selectedId || (rebuilt[0] && rebuilt[0].id) || null;
    state.refs = Array.isArray(inner.refs) ? inner.refs : [];
    state.lib = inner.lib && typeof inner.lib === 'object' ? { wavelength: inner.lib.wavelength > 0 ? inner.lib.wavelength : null, sticksOn: !!inner.lib.sticksOn } : { wavelength: null, sticksOn: false };
    state.history = Array.isArray(inner.history) ? inner.history : [];
    state.phases = Array.isArray(inner.phases) ? inner.phases : [];
    state.fit = sanitizeFit(inner.fit);
    state.projectVersion = inner.version || 3;
    highlightPeakId = null;
    renderAll();
    if (window.CatCardsUI) window.CatCardsUI.resolveSticks().then(function () { renderAll(); });
  }
  function doUndo() {
    if (!undoStack.length) { toast('没有可撤销的操作。'); return; }
    var entry = undoStack.pop();
    redoStack.push({ label: entry.label, snap: JSON.stringify(buildSlim()) });
    applySnapshot(entry.snap);
    toast('已撤销：' + entry.label);
  }
  function doRedo() {
    if (!redoStack.length) { toast('没有可重做的操作。'); return; }
    var entry = redoStack.pop();
    undoStack.push({ label: entry.label, snap: JSON.stringify(buildSlim()) });
    applySnapshot(entry.snap);
    toast('已重做：' + entry.label);
  }
  function renderUndoRedo() {
    $('btnUndo').disabled = !undoStack.length;
    $('btnRedo').disabled = !redoStack.length;
    $('btnUndo').title = undoStack.length ? '撤销：' + undoStack[undoStack.length - 1].label + ' (Ctrl+Z)' : '撤销 (Ctrl+Z)';
    $('btnRedo').title = redoStack.length ? '重做：' + redoStack[redoStack.length - 1].label + ' (Ctrl+Shift+Z)' : '重做 (Ctrl+Shift+Z)';
  }
  function renderHistory() {
    var box = $('historyList');
    box.innerHTML = '';
    if (!state.history.length) {
      box.innerHTML = '<div class="hist-empty">暂无处理记录。导入、背景、寻峰等操作会记录在这里并随项目保存。</div>';
      return;
    }
    state.history.slice(-60).reverse().forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'hist-item';
      var t = document.createElement('time');
      var dt = new Date(h.at);
      t.textContent = isFinite(dt.getTime()) ? String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') : '';
      var s = document.createElement('span');
      s.textContent = h.text;
      d.appendChild(t); d.appendChild(s);
      box.appendChild(d);
    });
  }

  /* ---------- 样品操作 ---------- */
  function loadSimSamples() {
    var defs = window.CatSamples.makeSimSamples();
    var pending = defs.filter(function (d) {
      return !state.samples.some(function (s) { return s.source === 'sim' && s.name === d.name; });
    });
    if (pending.length) checkpoint('加载模拟示例');
    pending.forEach(function (d) {
      var pts = d.raw.x.map(function (x, i) { return { x: x, y: d.raw.y[i], lineNo: i + 1 }; });
      makeSample({
        name: d.name, rawPoints: pts, source: 'sim', note: d.note,
        importMeta: { source: 'sim', generator: 'CatPlot 内置模拟生成器（种子固定）', importedAt: new Date().toISOString(), skippedRows: [], merged: [], sortApplied: 'none' }
      });
    });
    renderAll();
    if (pending.length) toast('已加载 ' + pending.length + ' 条模拟示例曲线（程序生成，非真实实验数据）。', 'ok');
    else toast('模拟示例已在列表中。');
  }

  function deleteSample(id) {
    var idx = state.samples.findIndex(function (s) { return s.id === id; });
    if (idx === -1) return;
    checkpoint('删除样品「' + state.samples[idx].name + '」');
    var removed = state.samples.splice(idx, 1)[0];
    if (state.selectedId === id) {
      var nxt = state.samples[Math.min(idx, state.samples.length - 1)];
      state.selectedId = nxt ? nxt.id : null;
    }
    renderAll();
    toast('已删除「' + removed.name + '」（可用顶部撤销恢复）', 'ok');
  }

  /* ---------- 渲染 ---------- */
  /* 表征切换：XRD 专属 UI（物相匹配/卡片库/参考棒图/d列）仅 XRD 显示；轴提示按配置 */
  function applyTechnique() {
    var T = window.CatModel.tech(state.technique);
    var isX = T.xrd;
    var mt = document.querySelector('.tool-tab[data-tool="match"]'); if (mt) mt.hidden = !isX;
    var bc = $('btnCards'); if (bc) bc.hidden = !isX;
    var so = $('sticksOn'); if (so && so.closest('label')) so.closest('label').hidden = !isX;
    var thd = document.querySelector('#peakTable th:nth-child(3)'); if (thd) thd.hidden = !isX;
    var hint = $('techHint'); if (hint) hint.textContent = isX ? '' : '通用分析；d值/晶粒尺寸/卡片/匹配仅 XRD';
    var sel = $('techSelect'); if (sel && sel.value !== state.technique) sel.value = state.technique;
    if (!isX && state.tool === 'match') setTool('display');
  }

  function renderAll() {
    recomputeAll();
    applyTechnique();
    renderChart();
    renderSampleList();
    renderBadges();
    renderScaleWarn();
    renderSettingsPanel();
    renderBgPanel();
    renderPeaksPanel();
    renderPeakTable();
    renderPhases();
    renderTracksTab();
    renderHistory();
    renderUndoRedo();
    renderPickHint();
    renderStatus();
    save();
    if (window.CatFitUI) window.CatFitUI.refresh();
  }

  function viewOf(s) {
    var meta = $('chart')._meta;
    if (!meta || !meta.views) return null;
    var i = meta.samples.indexOf(s);
    return i === -1 ? null : meta.views[i];
  }

  function renderSampleList() {
    var list = $('sampleList');
    list.innerHTML = '';
    $('sampleCount').textContent = String(state.samples.length);
    if (!state.samples.length) {
      var d = document.createElement('div');
      d.className = 'list-empty';
      d.textContent = '暂无样品。上传 CSV / TXT 数据，或加载模拟示例。';
      list.appendChild(d);
      return;
    }
    state.samples.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'sample-item' + (s.id === state.selectedId ? ' selected' : '') + (s.visible ? '' : ' hidden-curve');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      var dot = document.createElement('span');
      dot.className = 'smp-dot';
      dot.style.background = s.color;

      var info = document.createElement('div');
      info.className = 'smp-info';
      var nm = document.createElement('div');
      nm.className = 'smp-name';
      nm.textContent = s.name;
      nm.title = s.name;
      var meta = document.createElement('div');
      meta.className = 'smp-meta';
      var pts = document.createElement('span');
      pts.textContent = s.raw.x.length + ' 点';
      meta.appendChild(pts);
      if (s.source === 'sim') {
        var t = document.createElement('span'); t.className = 'tag sim'; t.textContent = '模拟数据'; meta.appendChild(t);
      } else {
        var tf = document.createElement('span'); tf.className = 'tag'; tf.textContent = '文件';
        tf.title = (s.importMeta && s.importMeta.fileName) || '';
        meta.appendChild(tf);
      }
      if (s.normalize || s.offset > 0) {
        var tp = document.createElement('span'); tp.className = 'tag proc';
        tp.textContent = (s.normalize ? '归一化' : '') + (s.normalize && s.offset > 0 ? '+' : '') + (s.offset > 0 ? '偏移' + s.offset : '');
        meta.appendChild(tp);
      }
      var vw = viewOf(s);
      if (vw && vw.mode === 'dec') {
        var td = document.createElement('span'); td.className = 'tag'; td.textContent = '显示简化';
        td.title = '当前可见范围显示 ' + vw.kept + ' / 窗口内 ' + vw.inWindow + ' 点（min-max 降采样，极窄局部峰可能遗漏；悬停/分析/导出用全量）';
        meta.appendChild(td);
      }
      info.appendChild(nm); info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'smp-actions';
      var eye = document.createElement('button');
      eye.type = 'button'; eye.className = 'icon-btn';
      eye.textContent = s.visible ? '👁' : '─';
      eye.title = s.visible ? '隐藏曲线' : '显示曲线';
      eye.addEventListener('click', function (ev) { ev.stopPropagation(); s.visible = !s.visible; renderAll(); });
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'icon-btn'; del.textContent = '✕'; del.title = '删除样品';
      del.addEventListener('click', function (ev) { ev.stopPropagation(); deleteSample(s.id); });
      actions.appendChild(eye); actions.appendChild(del);

      item.appendChild(dot); item.appendChild(info); item.appendChild(actions);
      item.addEventListener('click', function () { state.selectedId = s.id; renderAll(); });
      item.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); state.selectedId = s.id; renderAll(); } });
      list.appendChild(item);
    });
  }

  function activeTracks() {
    /* 卡片棒图轨道为 XRD 专属；其他表征不显示 */
    if (state.technique && state.technique !== 'xrd') return [];
    return state.lib.sticksOn && window.CatCards ? window.CatCards.rt.sticks : [];
  }

  /* 背景预览 / 原始对照 / 峰标记：仅当前选中样品，显示层坐标（偏移只影响显示） */
  function chartOverlay() {
    var s = getSelected();
    var ov = { bg: null, ghost: null, peaks: [], highlightId: highlightPeakId };
    if (!s || !s.visible) return ov;
    var off = s.offset || 0;
    var normK = s.normalize ? (function () { var m = M.maxOf(s.corrected.y); return m > 0 ? m : 1; })() : 1;
    if (s.bg && s.bg.mode !== 'none' && s.bgY && (s.bg.preview || s.bg.applied)) {
      ov.bg = { x: s.working.x, y: s.bgY.map(function (v) { return v / normK + off; }) };
    }
    if (s.bg && s.bg.applied && $('bgGhost').checked) {
      ov.ghost = { x: s.working.x, y: s.working.y.map(function (v) { return v / normK + off; }) };
    }
    if (s.peaks && s.peaks.list.length) {
      s.peaks.list.forEach(function (p, i) {
        var idx = p.index != null && p.index < s.display.y.length ? p.index : null;
        if (idx == null) return;
        ov.peaks.push({ id: p.id, x: s.display.x[idx], y: s.display.y[idx], n: i + 1 });
      });
    }
    return ov;
  }
  function chartNoteExtra() {
    var s = getSelected();
    var notes = [];
    if (s) {
      if (s.bg && s.bg.applied) notes.push('背景 ' + bgName(s.bg) + ' 已扣除');
      else if (s.bg && s.bg.mode !== 'none' && s.bg.preview) notes.push('背景预览中（未扣除）');
      if (s.peaks && s.peaks.list.length) {
        notes.push('实验峰 ' + s.peaks.list.length + ' 个' + (peaksStale(s) ? '（待更新）' : ''));
      }
    }
    var tr = activeTracks();
    if (tr.some(function (t) { return t.originalOnly; })) notes.push('部分轨道按原始波长显示');
    return notes;
  }

  function renderChart() {
    var svg = $('chart');
    hideReadout();
    var vis = visibleSamples();
    if (!vis.length) {
      window.CatChart.renderEmpty(svg);
      $('emptyState').hidden = false;
      hideTooltip();
      return;
    }
    $('emptyState').hidden = true;
    var rs = Object.assign({}, state.settings, { technique: state.technique });
    window.CatChart.render(svg, vis, rs, { tracks: activeTracks(), overlay: chartOverlay(), noteExtra: chartNoteExtra() });
  }

  function renderBadges() {
    var box = $('processBadges');
    box.innerHTML = '';
    var vis = visibleSamples();
    function add(text, cls, title) {
      var b = document.createElement('span');
      b.className = 'badge' + (cls ? ' ' + cls : '');
      b.textContent = text;
      if (title) b.title = title;
      box.appendChild(b);
    }
    if (!vis.length) { add('无显示曲线'); return; }
    var n = vis.filter(function (s) { return s.normalize; }).length;
    var o = vis.filter(function (s) { return s.offset > 0; }).length;
    var r = vis.length - vis.filter(function (s) { return s.normalize || s.offset > 0; }).length;
    if (n) add('归一化(最强峰=1) × ' + n, 'norm');
    if (o) add('纵向偏移(仅显示) × ' + o, 'offset');
    if (r) add('原始强度 × ' + r);
    var nb = vis.filter(function (s) { return s.bg && s.bg.applied; }).length;
    if (nb) add('背景已扣除 × ' + nb, 'bg');
    var np = vis.filter(function (s) { return s.peaks && s.peaks.list.length; }).length;
    if (np) add('含峰表样品 × ' + np, 'peaks');
    var staleN = vis.filter(peaksStale).length;
    if (staleN) add('峰表待更新 × ' + staleN, 'stale', '上游处理（背景/工作副本）已改变，请重新寻峰或手动修订');
    var decPairs = vis.map(function (s) { return { name: s.name, v: viewOf(s) }; }).filter(function (p) { return p.v && p.v.mode === 'dec'; });
    if (decPairs.length) add('显示简化 × ' + decPairs.length + ' · 悬停/分析/导出全量', 'dec', decPairs.map(function (p) { return p.name + ': 显示 ' + p.v.kept + '/' + p.v.inWindow; }).join('\n'));
    if (vis.some(function (s) { return s.source === 'sim'; })) add('含模拟数据 · 仅供演示', 'sim');
    var tracks = activeTracks();
    if (state.lib.sticksOn && tracks.length) add('参考轨道 × ' + tracks.length + ' · 公开示例（CC0/MIT）', 'stick', tracks.map(function (s) { return s.label + (s.withdrawn ? '（作废）' : ''); }).join('\n'));
    else if (state.lib.sticksOn && state.refs.length) {
      add(state.lib.wavelength ? '参考轨道无已启用示例卡' : '参考轨道待确认波长', 'dec');
    }
  }

  function renderScaleWarn() {
    var vis = visibleSamples();
    var n = vis.filter(function (s) { return s.normalize; }).length;
    var r = vis.length - n;
    var bar = $('scaleWarn');
    if (n > 0 && r > 0) {
      bar.hidden = false;
      $('scaleWarnText').textContent = '尺度不同：' + n + ' 条曲线已归一化（0–1），' + r + ' 条仍为原始强度，同图纵轴不可直接比较。';
    } else {
      bar.hidden = true;
    }
  }

  function renderStatus() {
    var vis = visibleSamples();
    var el = $('chartStatus');
    if (!vis.length) { el.textContent = '数据仅存于本机浏览器 · 上传文件不会离开你的设备'; return; }
    var lo = Infinity, hi = -Infinity;
    vis.forEach(function (s) {
      if (s.xExtent[0] < lo) lo = s.xExtent[0];
      if (s.xExtent[1] > hi) hi = s.xExtent[1];
    });
    el.textContent = '共 ' + state.samples.length + ' 个样品 · 显示 ' + vis.length + ' 条曲线 · 2θ 数据范围 ' +
      window.CatChart.fmtNum(lo) + '–' + window.CatChart.fmtNum(hi) + '° · 数据仅存于本机浏览器';
  }

  function setInputValue(el, v) {
    if (document.activeElement !== el) el.value = v;
  }

  function offsetMaxFor(s) {
    if (s.normalize) return 2;
    var m = M.maxOf(s.raw.y);
    return Math.max(1, Math.ceil(m * 2));
  }

  /* 荷电校正面板（XPS）：仅 XPS 表征显示；shift = 实测 − 目标（校正后 = 原 − shift）。 */
  function renderChargePanel(s) {
    var panel = $('chargePanel');
    if (!panel) return;
    if (state.technique !== 'xps' || !s) { panel.hidden = true; return; }
    panel.hidden = false;
    var c = s.charge || M.defaultCharge();
    $('chargeMode').value = c.mode;
    $('chargeRefOpts').hidden = c.mode !== 'reference';
    $('chargeManualOpts').hidden = c.mode !== 'manual';
    setInputValue($('chargeRefMeasured'), c.refMeasured == null ? '' : c.refMeasured);
    setInputValue($('chargeRefTarget'), c.refTarget == null ? 284.8 : c.refTarget);
    setInputValue($('chargeRefLabel'), c.refLabel || '');
    setInputValue($('chargeShift'), c.shift == null ? '' : c.shift);
    var st = $('chargeStatus');
    if (c.applied && isFinite(c.shift)) {
      st.textContent = '已校正：整谱平移 −' + M.formatNum(c.shift) + ' eV' +
        (c.mode === 'reference' && c.refMeasured != null ? '（' + (c.refLabel || '参考峰') + ' ' + M.formatNum(c.refMeasured) + '→' + M.formatNum(c.refTarget) + ' eV）' : '') +
        '。原始数据未改动。';
      st.className = 'hint process-note';
    } else {
      st.textContent = '未校正：结合能可能整体偏移，化学态归属需谨慎。';
      st.className = 'hint';
    }
  }

  function renderStats(s) {
    var stats = $('smpStats');
    stats.innerHTML = '';
    var rows = [
      ['原始点数', s.raw.x.length],
      ['分析点数', s.working.x.length],
      ['2θ 范围', window.CatChart.fmtNum(s.xExtent[0]) + ' – ' + window.CatChart.fmtNum(s.xExtent[1]) + '°'],
      ['原始最强峰', window.CatChart.fmtNum(M.maxOf(s.raw.y))],
      ['分析最大值', window.CatChart.fmtNum(M.maxOf(s.analysis.y))],
      ['显示最大值', window.CatChart.fmtNum(M.maxOf(s.display.y))],
      ['显示点数', (function () { var v = viewOf(s); return v ? v.kept + (v.mode === 'dec' ? '（窗口 ' + v.inWindow + ' 点降采样）' : '（全量）') : '未显示'; })()],
      ['背景', s.bg && s.bg.applied ? bgName(s.bg) + ' 已扣除' : (s.bg && s.bg.mode !== 'none' ? '预览中（未扣除）' : '无')],
      ['实验峰', s.peaks ? s.peaks.list.length + (peaksStale(s) ? '（待更新）' : '') : '0'],
      ['来源', s.source === 'sim' ? '内置模拟数据' : ((s.importMeta && s.importMeta.fileName) || '上传文件')]
    ];
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1]; dd.title = String(r[1]);
      stats.appendChild(dt); stats.appendChild(dd);
    });
  }

  /* 视图相关 UI（简化标签/徽标/显示点数）依赖当前可见范围，范围变化后必须同步 */
  function renderViewDependent() {
    renderSampleList();
    renderBadges();
    var s = getSelected();
    if (s) renderStats(s);
  }

  function renderSettingsPanel() {
    var st = state.settings;
    setInputValue($('setTitle'), st.title);
    setInputValue($('setXMin'), st.xMin != null ? st.xMin : '');
    setInputValue($('setXMax'), st.xMax != null ? st.xMax : '');
    setInputValue($('setYMin'), st.yMin != null ? st.yMin : '');
    setInputValue($('setYMax'), st.yMax != null ? st.yMax : '');
    $('setLegend').checked = st.showLegend;
    $('setGrid').checked = st.showGrid;
    $('setStack').checked = st.stack !== false;
    setInputValue($('setStackGap'), st.stackGap != null ? st.stackGap : 1.15);
    setInputValue($('setStackScale'), st.stackScale != null ? st.stackScale : 0.8);

    var s = getSelected();
    $('noSelection').hidden = !!s;
    $('sampleControls').hidden = !s;
    if (!s) return;

    setInputValue($('smpName'), s.name);
    setInputValue($('smpColor'), s.color);
    setInputValue($('smpWidth'), s.lineWidth);
    $('smpWidthOut').textContent = s.lineWidth;
    var om = offsetMaxFor(s);
    var rng = $('smpOffsetRange');
    rng.max = om;
    rng.step = s.normalize ? 0.01 : Math.max(0.5, Math.round(om / 200));
    setInputValue(rng, Math.min(s.offset, om));
    setInputValue($('smpOffsetNum'), s.offset);
    $('smpOffsetOut').textContent = s.offset;
    $('smpNormalize').checked = s.normalize;
    $('smpProcessNote').textContent = '分析层：' + s.processDesc + '；显示层 = 分析层 + 偏移 ' + s.offset + '（偏移不进入分析与导出分析值）';

    renderStats(s);

    renderChargePanel(s);

    renderTrace(s);

    var sw = $('smpSwatches');
    sw.innerHTML = '';
    PALETTE.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c.toLowerCase() === s.color.toLowerCase() ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', '颜色 ' + c);
      b.addEventListener('click', function () { s.color = c; renderAll(); });
      sw.appendChild(b);
    });
  }

  function renderTrace(s) {
    var body = $('smpTraceBody');
    body.innerHTML = '';
    var meta = s.importMeta;
    function line(text) {
      var p = document.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    }
    if (!meta) { line('无导入追溯记录（旧版存档迁移）。'); return; }
    if (meta.source === 'sim') {
      line('来源：' + (meta.generator || '内置模拟生成器'));
      line('生成时间：' + (meta.importedAt || '—'));
      return;
    }
    line('文件：' + (meta.fileName || '—'));
    line('分隔符：' + (meta.delimiter === 'ws' ? '空白' : meta.delimiter === '\t' ? '制表符' : meta.delimiter) +
      ' · 跳过文件头 ' + meta.skipRows + ' 行 · X 第 ' + (meta.xCol + 1) + ' 列 · Y 第 ' + (meta.yCol + 1) + ' 列');
    line('导入时间：' + (meta.importedAt || '—'));
    line('排序：' + (meta.sortApplied === 'asc' ? '已生成 2θ 升序独立副本（原始顺序保留于 raw）' : '未排序（保持文件顺序）'));
    line('重复 X：' + (meta.duplicateMode === 'merge' ? '按 X 平均合并 ' + (meta.merged || []).length + ' 组' : '保留全部重复点'));
    (meta.merged || []).slice(0, 10).forEach(function (g) {
      line('　合并 X=' + g.x + '：行 ' + g.lineNos.join(',') + ' → 平均 ' + M.formatNum(g.mean));
    });
    if ((meta.merged || []).length > 10) line('　……其余 ' + (meta.merged.length - 10) + ' 组见项目 JSON');
    var sk = meta.skippedRows || [];
    line('跳过无效行：' + sk.length + ' 行' + (sk.length ? '（经用户确认）' : ''));
    sk.slice(0, 20).forEach(function (e) { line('　第 ' + e.lineNo + ' 行：' + e.reason); });
    if (sk.length > 20) line('　……其余 ' + (sk.length - 20) + ' 行见项目 JSON');
  }

  /* ---------- 工具切换与数据标签 ---------- */
  var TOOL_PANES = { display: 'toolDisplay', bg: 'toolBg', peaks: 'toolPeaks', fit: 'toolFit', batch: 'toolBatch', match: 'toolMatch' };
  var DT_PANES = { peaks: 'dtPeaks', phases: 'dtPhases', tracks: 'dtTracks' };
  function setTechnique(id) {
    state.technique = (window.CatModel.TECHNIQUES[id] ? id : 'xrd');
    /* 未设背景的样品套用该表征推荐背景（XPS→Shirley 等），已设的不覆盖 */
    var rec = window.CatModel.guide(state.technique).bg;
    state.samples.forEach(function (s) { if (s.bg && s.bg.mode === 'none') { s.bg.mode = rec; s.bg.preview = true; } });
    renderAll(); save();
    toast('已切换表征：' + window.CatModel.tech(state.technique).name + '（推荐背景 ' + rec + '）', 'ok');
  }
  function setTool(t) {
    if (t === 'match' && state.technique !== 'xrd') { toast('物相匹配仅 XRD 表征可用', 'err'); t = 'display'; }
    uiTool = t;
    document.querySelectorAll('.tool-tab').forEach(function (b) {
      var on = b.getAttribute('data-tool') === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(TOOL_PANES).forEach(function (k) { $(TOOL_PANES[k]).hidden = k !== t; });
    if (t !== 'bg' && pickMode === 'bg') setPickMode(null);
    if (t !== 'peaks' && pickMode === 'peak') setPickMode(null);
    if (t === 'fit' && window.CatFitUI) window.CatFitUI.onShow();
    if (t === 'batch' && window.CatBatchUI) window.CatBatchUI.onShow();
    if (t === 'match' && window.CatMatchUI) window.CatMatchUI.onShow();
  }
  function setDataTab(t) {
    uiDataTab = t;
    document.querySelectorAll('.dt-tab').forEach(function (b) {
      var on = b.getAttribute('data-dt') === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(DT_PANES).forEach(function (k) { $(DT_PANES[k]).hidden = k !== t; });
  }
  document.querySelectorAll('.tool-tab').forEach(function (b) {
    b.addEventListener('click', function () { setTool(this.getAttribute('data-tool')); });
  });
  document.querySelectorAll('.dt-tab').forEach(function (b) {
    b.addEventListener('click', function () { setDataTab(this.getAttribute('data-dt')); });
  });
  $('btnOpenCardsFromTracks').addEventListener('click', function () { window.CatCardsUI.openDrawer(); });
  $('btnUndo').addEventListener('click', doUndo);
  $('btnRedo').addEventListener('click', doRedo);
  document.addEventListener('keydown', function (ev) {
    if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) doRedo(); else doUndo();
    }
    if (ev.key === 'Escape' && pickMode) setPickMode(null);
  });

  /* ---------- 图上点击取点（背景点 / 手动加峰） ---------- */
  function setPickMode(mode) {
    pickMode = mode;
    renderPickHint();
    $('chart').classList.toggle('pick-mode', !!mode);
  }
  function renderPickHint() {
    var el = $('pickHint');
    if (!pickMode) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '';
    var s = document.createElement('span');
    s.textContent = pickMode === 'bg'
      ? '背景点模式：点击主谱图曲线附近添加背景点（吸附到最近数据点，线性插值）。'
      : '手动加峰模式：点击主谱图在光标最近数据点处添加实验峰。';
    var b = document.createElement('button');
    b.className = 'btn tiny ghost'; b.type = 'button'; b.textContent = '退出 (Esc)';
    b.addEventListener('click', function () { setPickMode(null); });
    el.appendChild(s); el.appendChild(b);
  }
  function chartDataX(ev) {
    var svg = $('chart');
    var meta = svg._meta;
    if (!meta) return null;
    var rect = svg.getBoundingClientRect();
    var scale = Math.min(rect.width / meta.W, rect.height / meta.H);
    var offX = (rect.width - meta.W * scale) / 2;
    var lx = (ev.clientX - rect.left - offX) / scale;
    var ly = (ev.clientY - rect.top - (rect.height - meta.H * scale) / 2) / scale;
    var pl = meta.plot;
    if (lx < pl.x || lx > pl.x + pl.w || ly < pl.y || ly > pl.y + pl.h) return null;
    return meta.xMin + (lx - pl.x) / pl.w * (meta.xMax - meta.xMin);
  }
  /* ---------- 峰点击读数：实验峰 / 参考棒 → 数值 + 最近峰偏差（分析坐标，不含显示偏移） ---------- */
  function readoutLam() { var v = state.lib.wavelength; return (typeof v === 'number' && isFinite(v) && v > 0) ? v : null; }
  function dFromT(t, lam) { var r = lam / (2 * Math.sin(t * Math.PI / 360)); return isFinite(r) && r > 0 ? r : null; }
  function sgn(v, dec) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(dec); }
  function hideReadout() { var el = $('peakReadout'); if (el) { el.hidden = true; el.innerHTML = ''; } }
  function showReadout(title, bodyHtml) {
    var el = $('peakReadout');
    el.innerHTML = '<div class="pr-head"><strong>' + title + '</strong>' +
      '<button class="btn tiny ghost pr-close" type="button" data-act="pr-close">关闭</button></div>' +
      '<div class="pr-body">' + bodyHtml + '</div>';
    el.hidden = false;
  }
  function nearestRefPeak(t) {
    var lam = readoutLam(), d = lam != null ? dFromT(t, lam) : null, best = null;
    activeTracks().forEach(function (tr) {
      tr.peaks.forEach(function (pp) {
        if (pp.d == null) return;
        var key = d != null ? Math.abs(d - pp.d) : Math.abs(t - pp.t);
        if (!best || key < best.key) best = { tr: tr, pp: pp, key: key };
      });
    });
    return best;
  }
  function nearestExpPeak(t) {
    var s = getSelected();
    if (!s || !s.peaks.list.length) return null;
    var lam = readoutLam(), d = lam != null ? dFromT(t, lam) : null, best = null;
    s.peaks.list.forEach(function (p) {
      var pd = lam != null ? dFromT(p.x, lam) : null;
      var key = (d != null && pd != null) ? Math.abs(pd - d) : Math.abs(p.x - t);
      if (!best || key < best.key) best = { p: p, key: key, d: pd };
    });
    return best;
  }
  function diffHtml(expD, expT, refD, refT, trLam) {
    var lam = readoutLam();
    if (lam == null) return '<span class="hint">未设置波长 λ：无法换算 d 与偏差（请在参考面板设置 λ）。</span>';
    var h = '<b>Δd = ' + sgn(expD - refD, 4) + ' Å</b>';
    if (trLam === lam) h += ' · <b>Δ2θ = ' + sgn(expT - refT, 3) + '°</b>';
    else h += ' <span class="hint">（参考 λ=' + trLam + 'Å 与当前 λ=' + lam + 'Å 不同，角度不可直接比，偏差以 d 给出）</span>';
    return h + ' <span class="hint">偏差 = 实验 − 参考</span>';
  }
  function expReadout(pid) {
    var s = getSelected(); if (!s) return;
    var pi = -1;
    s.peaks.list.forEach(function (p, i) { if (p.id === pid) pi = i; });
    if (pi < 0) return;
    var p = s.peaks.list[pi], lam = readoutLam();
    var d = lam != null ? dFromT(p.x, lam) : null;
    var html = '<div class="pr-grid">' +
      '<span>2θ = <b>' + p.x.toFixed(3) + '°</b>（分析坐标）</span>' +
      '<span>d = <b>' + (d == null ? '—' : d.toFixed(4) + ' Å') + '</b></span>' +
      '<span>I = <b>' + M.formatNum(p.height) + '</b></span>' +
      '<span>来源：' + (p.source === 'manual' ? '手动' : '自动寻峰') + '</span></div>';
    var tracks = activeTracks();
    if (!tracks.length) {
      html += '<p class="hint">无参考轨道：预览参考卡片或确认物相后，点击可给出与最近参考峰的偏差。</p>';
    } else {
      var best = nearestRefPeak(p.x);
      if (best) {
        html += '<div class="pr-grid"><span>最近参考峰：<b>' + window.CatChart.esc(best.tr.label) + '</b>' +
          (best.tr.withdrawn ? '（作废）' : '') +
          ' · d=' + best.pp.d.toFixed(4) + 'Å · 2θ=' + best.pp.t.toFixed(3) + '° · I=' + best.pp.i +
          (best.pp.hkl ? ' · hkl ' + best.pp.hkl.join(' ') : '') + '</span></div>' +
          '<div>' + diffHtml(d, p.x, best.pp.d, best.pp.t, best.tr.lambda) + '</div>';
      }
    }
    showReadout('实验峰 #' + (pi + 1) + '（' + window.CatChart.esc(s.name) + '）', html);
  }
  function stickReadout(sid) {
    var parts = String(sid).split(':');
    var tr = activeTracks()[Number(parts[0])];
    if (!tr) return;
    var pp = tr.peaks[Number(parts[1])];
    if (!pp) return;
    var html = '<div class="pr-grid">' +
      '<span>d = <b>' + (pp.d != null ? pp.d.toFixed(4) + ' Å' : '—') + '</b></span>' +
      '<span>2θ = <b>' + pp.t.toFixed(3) + '°</b>（参考 λ=' + tr.lambda + 'Å）</span>' +
      '<span>I = <b>' + pp.i + '</b></span>' +
      (pp.hkl ? '<span>hkl = <b>' + pp.hkl.join(' ') + '</b></span>' : '') + '</div>';
    var best = nearestExpPeak(pp.t);
    var s = getSelected();
    if (!s || !s.peaks.list.length) {
      html += '<p class="hint">当前样品无分析峰表：寻峰或手动加峰后，点击可给出与最近实验峰的偏差。</p>';
    } else if (best) {
      html += '<div class="pr-grid"><span>最近实验峰：<b>' + best.p.x.toFixed(3) + '°</b>' +
        (best.d != null ? ' · d=' + best.d.toFixed(4) + 'Å' : '') +
        ' · I=' + M.formatNum(best.p.height) + '（' + (best.p.source === 'manual' ? '手动' : '自动') + '）</span></div>' +
        '<div>' + diffHtml(best.d, best.p.x, pp.d, pp.t, tr.lambda) + '</div>';
    }
    html += '<p class="hint">参考数值为卡片峰位（待核验参考），非实测值；棒图为参考峰表，不是拟合曲线。</p>';
    showReadout('参考峰 · ' + window.CatChart.esc(tr.label) + (tr.withdrawn ? '（作废）' : ''), html);
  }
  $('peakReadout').addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-act="pr-close"]')) hideReadout();
  });

  $('chart').addEventListener('click', function (ev) {
    var stk = ev.target.closest ? ev.target.closest('[data-sid]') : null;
    if (stk) { stickReadout(stk.getAttribute('data-sid')); return; }
    var g = ev.target.closest ? ev.target.closest('[data-pid]') : null;
    if (g) {
      highlightPeakId = g.getAttribute('data-pid');
      setDataTab('peaks');
      renderChart();
      markPeakRowHighlight();
      expReadout(highlightPeakId);
      return;
    }
    if (!pickMode) return;
    var s = getSelected();
    if (!s) { toast('请先选择一个样品。', 'err'); return; }
    var dataX = chartDataX(ev);
    if (dataX == null) return;
    var i = pickedIndex(s, dataX);
    if (i < 0) return;
    if (pickMode === 'bg') {
      var x = s.working.x[i], y = s.working.y[i];
      if (s.bg.points.some(function (p) { return p.x === x; })) { toast('该 2θ 处已有背景点。'); return; }
      checkpoint('添加背景点 x=' + M.formatNum(x) + '（' + s.name + '）');
      s.bg.points.push({ x: x, y: y });
      s.bg.points.sort(function (a, b) { return a.x - b.x; });
      if (s.bg.mode !== 'manual') s.bg.mode = 'manual';
      renderAll();
    } else if (pickMode === 'peak') {
      checkpoint('手动加峰 x=' + M.formatNum(s.corrected.x[i]) + '（' + s.name + '）');
      s.peaks.list.push({ id: uid(), x: s.corrected.x[i], height: s.corrected.y[i], prominence: null, index: i, source: 'manual' });
      s.peaks.list.sort(function (a, b) { return a.x - b.x; });
      s.peaks.basisKey = sampleBasisKey(s);
      renderAll();
      setDataTab('peaks');
    }
  });

  /* ---------- 背景面板 ---------- */
  function renderBgPanel() {
    var s = getSelected();
    $('bgNoSel').hidden = !!s;
    $('bgControls').hidden = !s;
    if (!s) return;
    setInputValue($('bgMode'), s.bg.mode);
    $('bgSnipOpts').hidden = s.bg.mode !== 'snip';
    $('bgManualOpts').hidden = s.bg.mode !== 'manual';
    setInputValue($('bgIter'), s.bg.iterations);
    $('bgIterOut').textContent = s.bg.iterations;
    $('bgPreview').checked = s.bg.preview;
    $('btnBgApply').disabled = s.bg.mode === 'none' || s.bg.applied;
    $('btnBgRestore').disabled = !s.bg.applied;
    $('btnBgPointMode').classList.toggle('primary', pickMode === 'bg');
    var box = $('bgPointsList');
    box.innerHTML = '';
    if (!s.bg.points.length) box.innerHTML = '<p class="hint">尚无背景点。点击上方按钮后在图上点击，至少 2 个点。</p>';
    s.bg.points.forEach(function (p, pi) {
      var row = document.createElement('div');
      row.className = 'bg-point-row';
      var ix = document.createElement('input');
      ix.type = 'number'; ix.step = 'any'; ix.value = p.x; ix.title = '2θ (°)';
      var iy = document.createElement('input');
      iy.type = 'number'; iy.step = 'any'; iy.value = p.y; iy.title = '背景强度';
      function edit() {
        var nx = Number(ix.value), ny = Number(iy.value);
        if (!isFinite(nx) || !isFinite(ny)) { toast('背景点需为有限数值。', 'err'); ix.value = p.x; iy.value = p.y; return; }
        checkpoint('修改背景点 #' + (pi + 1) + '（' + s.name + '）');
        p.x = nx; p.y = ny;
        s.bg.points.sort(function (a, b) { return a.x - b.x; });
        renderAll();
      }
      ix.addEventListener('change', edit);
      iy.addEventListener('change', edit);
      var del = document.createElement('button');
      del.className = 'icon-btn'; del.type = 'button'; del.textContent = '✕'; del.title = '删除背景点';
      del.addEventListener('click', function () {
        checkpoint('删除背景点 x=' + M.formatNum(p.x) + '（' + s.name + '）');
        s.bg.points.splice(s.bg.points.indexOf(p), 1);
        if (s.bg.applied && !s.bg.points.length) s.bg.applied = false;
        renderAll();
      });
      row.appendChild(ix); row.appendChild(iy); row.appendChild(del);
      box.appendChild(row);
    });
    var st = $('bgStatus');
    if (s.bg.applied) st.textContent = '已扣除：分析层 = 工作副本 − 背景（' + bgName(s.bg) + '）。原始数据未改动；峰表如基于旧背景将标为待更新。';
    else if (s.bg.mode !== 'none') st.textContent = '预览中（未扣除）：橙色虚线为估计背景。确认扣除后才进入分析层。';
    else st.textContent = '未设置背景。选择 SNIP 自动估计或手动背景点。';
  }
  $('bgMode').addEventListener('change', function () {
    var s = getSelected(); if (!s) return;
    s.bg.mode = this.value;
    if (s.bg.mode === 'none') s.bg.applied = false;
    renderAll();
  });
  $('bgIter').addEventListener('input', function () {
    var s = getSelected(); if (!s) return;
    s.bg.iterations = Number(this.value);
    $('bgIterOut').textContent = this.value;
    recomputeLayers(s);
    renderAll();
  });
  $('bgPreview').addEventListener('change', function () {
    var s = getSelected(); if (!s) return;
    s.bg.preview = this.checked;
    renderChart(); save();
  });
  $('bgGhost').addEventListener('change', function () { renderChart(); });
  $('btnBgApply').addEventListener('click', function () {
    var s = getSelected(); if (!s) return;
    if (s.bg.mode === 'none') { toast('请先选择背景方式。', 'err'); return; }
    if (s.bg.mode === 'manual' && s.bg.points.length < 2) { toast('手动背景至少需要 2 个背景点。', 'err'); return; }
    checkpoint('确认背景扣除（' + bgName(s.bg) + '，' + s.name + '）');
    s.bg.applied = true;
    renderAll();
    toast('背景已扣除。原始数据保留，可用「恢复原始」或撤销回退。', 'ok');
  });
  $('btnBgRestore').addEventListener('click', function () {
    var s = getSelected(); if (!s || !s.bg.applied) return;
    checkpoint('恢复原始（取消背景扣除，' + s.name + '）');
    s.bg.applied = false;
    renderAll();
    toast('已恢复原始强度（背景配置保留，可再次确认扣除）。');
  });
  $('btnBgPointMode').addEventListener('click', function () {
    var s = getSelected();
    if (!s) { toast('请先选择一个样品。', 'err'); return; }
    if (s.bg.mode !== 'manual') { s.bg.mode = 'manual'; renderAll(); }
    setPickMode(pickMode === 'bg' ? null : 'bg');
  });
  $('btnBgPointsClear').addEventListener('click', function () {
    var s = getSelected(); if (!s || !s.bg.points.length) return;
    checkpoint('清空背景点（' + s.name + '）');
    s.bg.points = [];
    if (s.bg.applied) s.bg.applied = false;
    renderAll();
  });

  /* ---------- 寻峰面板与峰表 ---------- */
  function pkParamInputs() {
    return [
      ['pkSmooth', 'smooth', true], ['pkNoiseK', 'noiseK', true], ['pkMinProm', 'minProm', true],
      ['pkMinDist', 'minDist', true], ['pkLo', 'lo', false], ['pkHi', 'hi', false], ['pkMinHeight', 'minHeight', false]
    ];
  }
  function renderPeaksPanel() {
    var s = getSelected();
    $('pkNoSel').hidden = !!s;
    $('pkControls').hidden = !s;
    if (!s) return;
    var pp = s.peaks.params;
    pkParamInputs().forEach(function (d) {
      var v = pp[d[1]];
      setInputValue($(d[0]), v != null ? v : '');
    });
    $('pkSmoothOut').textContent = pp.smooth;
    $('pkNoiseKOut').textContent = pp.noiseK;
    $('btnPeakAddMode').classList.toggle('primary', pickMode === 'peak');
    var sigma = AN.estimateNoise(s.corrected.y);
    var lam = state.lib.wavelength;
    $('pkStatus').textContent = '当前校正曲线 σ≈' + M.formatNum(Math.round(sigma * 100) / 100) +
      ' · 峰表 ' + s.peaks.list.length + ' 个' + (peaksStale(s) ? '（待更新）' : '') +
      ' · d 值：' + (lam ? 'λ=' + lam + ' Å' : '未确认波长（卡片库面板确认后可算 d）');
  }
  pkParamInputs().forEach(function (d) {
    $(d[0]).addEventListener('input', function () {
      var s = getSelected(); if (!s) return;
      var v = this.value === '' ? null : Number(this.value);
      if (v != null && !isFinite(v)) return;
      if (d[2] && (v == null || v < 0)) return;
      s.peaks.params[d[1]] = v;
      if (d[0] === 'pkSmooth') $('pkSmoothOut').textContent = v;
      if (d[0] === 'pkNoiseK') $('pkNoiseKOut').textContent = v;
      save();
    });
  });
  $('btnAutoPeaks').addEventListener('click', function () {
    var s = getSelected();
    if (!s) { toast('请先选择一个样品。', 'err'); return; }
    var pp = s.peaks.params;
    if (pp.lo != null && pp.hi != null && pp.lo >= pp.hi) { toast('寻峰范围起始值必须小于终止值。', 'err'); return; }
    var t0 = performance.now();
    var res = AN.findPeaks(s.corrected.x, s.corrected.y, pp);
    var ms = Math.round(performance.now() - t0);
    checkpoint('自动寻峰（' + s.name + '，平滑' + pp.smooth + '，阈值' + (pp.minHeight != null ? pp.minHeight : pp.noiseK + 'σ') + '）');
    s.peaks.list = res.peaks.map(function (p) {
      return { id: uid(), x: p.x, height: p.height, prominence: p.prominence, index: p.i, source: 'auto' };
    });
    s.peaks.basisKey = sampleBasisKey(s);
    s.peaks.sigma = res.sigma;
    highlightPeakId = null;
    renderAll();
    setDataTab('peaks');
    toast('寻峰完成：' + res.peaks.length + ' 个峰（' + ms + ' ms）', 'ok');
  });
  $('btnPeakAddMode').addEventListener('click', function () {
    if (!getSelected()) { toast('请先选择一个样品。', 'err'); return; }
    setPickMode(pickMode === 'peak' ? null : 'peak');
  });
  $('btnClearPeaks').addEventListener('click', function () {
    var s = getSelected();
    if (!s || !s.peaks.list.length) { toast('当前样品峰表为空。'); return; }
    checkpoint('清空峰表（' + s.name + '，' + s.peaks.list.length + ' 峰）');
    s.peaks.list = [];
    s.peaks.basisKey = null;
    highlightPeakId = null;
    renderAll();
  });

  function markPeakRowHighlight() {
    document.querySelectorAll('#peakTable tbody tr').forEach(function (tr) {
      var on = tr.getAttribute('data-pid') === highlightPeakId;
      tr.classList.toggle('hl', on);
      if (on && tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest' });
    });
  }
  function renderPeakTable() {
    var s = getSelected();
    var table = $('peakTable');
    table.innerHTML = '';
    var n = s ? s.peaks.list.length : 0;
    $('peakCountPill').textContent = String(n);
    $('peakStaleWarn').hidden = !(s && peaksStale(s));
    $('peakBasisNote').textContent = s
      ? '样品「' + s.name + '」· 输入=工作副本−已确认背景 · 峰高为校正强度' + (state.lib.wavelength ? ' · λ=' + state.lib.wavelength + ' Å' : ' · d 值待确认波长')
      : '选择样品后显示其实验峰表。';
    $('btnPeakCsv').disabled = !n;
    $('btnClearPeaks').disabled = !n;
    var T = window.CatModel.tech(state.technique);
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>' + T.xLabel + '</th><th' + (T.xrd ? '' : ' hidden') + '>d (Å)</th><th>峰高</th><th>突出度</th><th>来源</th><th>文件行号</th><th></th></tr>';
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    if (!s || !n) {
      var tr0 = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.colSpan = 8;
      td0.textContent = s ? '峰表为空。使用右侧「寻峰」工具自动检测或手动加峰。' : '未选择样品。';
      td0.style.color = 'var(--site-muted)';
      tr0.appendChild(td0); tbody.appendChild(tr0);
    }
    var stale = s && peaksStale(s);
    var lam = state.lib.wavelength;
    if (s) s.peaks.list.forEach(function (p, i) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-pid', p.id);
      if (stale) tr.className = 'stale-row';
      if (p.id === highlightPeakId) tr.classList.add('hl');
      var d = lam ? AN.dSpacing(p.x, lam) : null;
      var lineNo = p.index != null && s.working.lineNos && s.working.lineNos[p.index] != null ? s.working.lineNos[p.index] : '—';
      var cells = [
        String(i + 1),
        p.x.toFixed(3),
        d != null ? d.toFixed(4) : '—',
        M.formatNum(Math.round(p.height * 1000) / 1000),
        p.prominence != null ? M.formatNum(Math.round(p.prominence * 1000) / 1000) : '—',
        '', '', ''
      ];
      cells.forEach(function (c, ci) {
        var td = document.createElement('td');
        if (ci === 5) {
          var b = document.createElement('span');
          b.className = 'pk-src' + (p.source === 'manual' ? ' manual' : '');
          b.textContent = p.source === 'manual' ? '手动' : '自动';
          td.appendChild(b);
        } else if (ci === 6) {
          td.textContent = String(lineNo);
          td.title = '工作副本行号追溯（原始文件行号）';
        } else if (ci === 7) {
          var del = document.createElement('button');
          del.className = 'pk-del'; del.type = 'button'; del.textContent = '✕'; del.title = '删除此峰';
          del.addEventListener('click', function (ev) {
            ev.stopPropagation();
            checkpoint('删除峰 #' + (i + 1) + ' x=' + p.x.toFixed(3) + '（' + s.name + '）');
            s.peaks.list.splice(s.peaks.list.indexOf(p), 1);
            if (highlightPeakId === p.id) highlightPeakId = null;
            renderAll();
          });
          td.appendChild(del);
        } else {
          td.textContent = c;
          if (ci === 2 && d == null) td.title = '未确认实验波长，无法计算 d 值';
        }
        if (ci === 2 && !T.xrd) td.hidden = true;
        tr.appendChild(td);
      });
      tr.addEventListener('click', function () {
        highlightPeakId = p.id;
        renderChart();
        markPeakRowHighlight();
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  /* ---------- 已选物相（独立数据对象） ---------- */
  function renderPhases() {
    var box = $('phaseList');
    box.innerHTML = '';
    $('phaseCountPill').textContent = String(state.phases.length);
    if (!state.phases.length) {
      box.innerHTML = '<div class="hist-empty">暂无已选物相。在「参考轨道」将示例卡手动标记为物相（标注来源）。已选物相与参考卡片、实验峰表是相互独立的数据对象。</div>';
    }
    state.phases.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'phase-row';
      var dot = document.createElement('span');
      dot.className = 'ref-dot';
      dot.style.background = 'var(--amber)';
      var main = document.createElement('div');
      main.className = 'phase-main';
      var nm = document.createElement('b'); nm.textContent = p.name;
      var meta = document.createElement('div');
      meta.className = 'muted';
      var tag = document.createElement('span');
      tag.className = 'badge sim';
      tag.textContent = p.source === 'match' ? '旧档检索确认（功能已剥离）' : '手动标记';
      meta.appendChild(tag);
      var note = document.createElement('span');
      note.textContent = p.note || '';
      meta.appendChild(note);
      main.appendChild(nm); main.appendChild(meta);
      var acts = document.createElement('div');
      acts.className = 'phase-acts';
      var del = document.createElement('button');
      del.className = 'btn tiny ghost'; del.type = 'button'; del.textContent = '移除';
      del.addEventListener('click', function () {
        checkpoint('移除已选物相「' + p.name + '」');
        state.phases = state.phases.filter(function (x) { return x.id !== p.id; });
        renderAll();
      });
      acts.appendChild(del);
      row.appendChild(dot); row.appendChild(main); row.appendChild(acts);
      box.appendChild(row);
    });
  }  function addPhaseFromTrack(r) {
    if (state.phases.some(function (p) { return p.refKey === r.key; })) { toast('该卡片已标记为物相。'); return; }
    checkpoint('标记物相「' + r.label + '」（手动，来自参考轨道）');
    state.phases.push({
      id: uid(), name: r.label, refKey: r.key, source: 'manual',
      note: '由参考轨道手动标记（公开示例卡），非物相鉴定结论', at: new Date().toISOString()
    });
    renderAll();
    setDataTab('phases');
    toast('已标记为已选物相（手动来源已标注，非物相鉴定结论）。', 'ok');
  }

  /* ---------- 参考轨道标签（排序 / 显隐 / 移除 / 标记物相） ---------- */
  function renderTracksTab() {
    var box = $('trackList');
    box.innerHTML = '';
    $('trackCountPill').textContent = String(state.refs.length);
    $('trackLambdaNote').textContent = state.lib.wavelength
      ? '实验波长 λ=' + state.lib.wavelength + ' Å · 轨道顺序即图中从上到下顺序'
      : '未确认实验波长：二进制卡片无法换算角度。在卡片库面板确认波长。';
    if (!state.refs.length) {
      box.innerHTML = '<div class="hist-empty">尚未加入参考卡片。打开「参考卡片库」检索并加入，每张卡片一条独立轨道，与主谱图共用 X 轴。</div>';
      return;
    }
    var resolvedKeys = {};
    (window.CatCards ? window.CatCards.rt.sticks : []).forEach(function (t) { resolvedKeys[t.key] = t; });
    state.refs.forEach(function (r, ri) {
      var row = document.createElement('div');
      row.className = 'track-row' + (r.enabled === false ? ' off' : '');
      var dot = document.createElement('span');
      dot.className = 'ref-dot';
      dot.style.background = r.color;
      var main = document.createElement('div');
      main.className = 'track-main';
      var nm = document.createElement('b'); nm.textContent = r.label || r.name || r.key;
      var meta = document.createElement('div');
      meta.className = 'muted';
      meta.appendChild(document.createTextNode((r.source || 'example') + ' · ' + (r.uid || r.id || r.key)));
      if (r.withdrawn) { var bw = document.createElement('span'); bw.className = 'badge wdraw'; bw.textContent = '作废'; meta.appendChild(bw); }
      if (r.source === 'example') { var br = document.createElement('span'); br.className = 'badge dec'; br.textContent = '公开示例'; meta.appendChild(br); }
      var t = resolvedKeys[r.key];
      if (t && t.converted) { var bc = document.createElement('span'); bc.className = 'badge dec'; bc.textContent = '已换算λ'; meta.appendChild(bc); }
      if (t && t.originalOnly) { var bo = document.createElement('span'); bo.className = 'badge dec'; bo.textContent = '原始λ显示'; meta.appendChild(bo); }
      if (!t) {
        var fail = window.CatCardsUI ? window.CatCardsUI.ui.refFail[r.key] : null;
        var bs = document.createElement('span'); bs.className = 'badge dec';
        bs.textContent = r.origin === 'remote'
          ? (!state.lib.sticksOn ? '未启用' : fail === 'service' ? '服务不可用' : fail === 'noLambda' ? '待确认波长' : fail ? '加载失败' : '未解析')
          : (!window.CatCards.rt.index ? '待连接库' : (!state.lib.sticksOn ? '未启用' : (fail === 'noLambda' ? '待确认波长' : (fail ? '加载失败/不在当前库' : '未解析'))));
        meta.appendChild(bs);
      }
      main.appendChild(nm); main.appendChild(meta);
      var acts = document.createElement('div');
      acts.className = 'track-acts';
      function icon(txt, title, fn, disabled) {
        var b = document.createElement('button');
        b.className = 'icon-btn'; b.type = 'button'; b.textContent = txt; b.title = title; b.disabled = !!disabled;
        b.addEventListener('click', fn);
        return b;
      }
      acts.appendChild(icon('↑', '上移轨道', function () { moveRef(ri, -1); }, ri === 0));
      acts.appendChild(icon('↓', '下移轨道', function () { moveRef(ri, 1); }, ri === state.refs.length - 1));
      var tg = document.createElement('input');
      tg.type = 'checkbox'; tg.checked = r.enabled !== false; tg.title = '显示/隐藏该轨道';
      tg.addEventListener('change', function () {
        checkpoint((tg.checked ? '显示' : '隐藏') + '参考轨道「' + r.label + '」');
        r.enabled = tg.checked;
        renderAll();
        if (window.CatCardsUI) window.CatCardsUI.resolveSticks().then(function () { renderAll(); });
      });
      acts.appendChild(tg);
      var ph = document.createElement('button');
      ph.className = 'btn tiny ghost'; ph.type = 'button'; ph.textContent = '标记物相'; ph.title = '将此卡片手动标记为已选物相（标注来源）';
      ph.addEventListener('click', function () { addPhaseFromTrack(r); });
      acts.appendChild(ph);
      acts.appendChild(icon('✕', '移除卡片', function () {
        checkpoint('移除参考卡片「' + r.label + '」');
        state.refs = state.refs.filter(function (x) { return x.key !== r.key; });
        renderAll();
        if (window.CatCardsUI) window.CatCardsUI.resolveSticks().then(function () { renderAll(); });
      }));
      row.appendChild(dot); row.appendChild(main); row.appendChild(acts);
      box.appendChild(row);
    });
  }
  function moveRef(ri, dir) {
    var j = ri + dir;
    if (j < 0 || j >= state.refs.length) return;
    checkpoint('调整参考轨道顺序（' + state.refs[ri].label + '）');
    var tmp = state.refs[ri];
    state.refs[ri] = state.refs[j];
    state.refs[j] = tmp;
    renderAll();
    if (window.CatCardsUI) window.CatCardsUI.resolveSticks().then(function () { renderAll(); });
  }

  /* ---------- 峰表 CSV 导出 ---------- */
  function doPeakCSV() {
    var s = getSelected();
    if (!s || !s.peaks.list.length) { toast('当前样品峰表为空。', 'err'); return; }
    var lam = state.lib.wavelength;
    var lines = ['样品,序号,2theta(deg),d(angstrom),峰高(扣背景),突出度,来源,文件行号,实验波长(angstrom),峰表状态'];
    var stale = peaksStale(s);
    s.peaks.list.forEach(function (p, i) {
      var d = lam ? AN.dSpacing(p.x, lam) : null;
      var lineNo = p.index != null && s.working.lineNos[p.index] != null ? s.working.lineNos[p.index] : '';
      lines.push([
        csvCell(s.name), i + 1, M.formatNum(p.x), d != null ? M.formatNum(d) : '',
        M.formatNum(p.height), p.prominence != null ? M.formatNum(p.prominence) : '',
        p.source === 'manual' ? '手动' : '自动', lineNo, lam != null ? M.formatNum(lam) : '',
        stale ? '待更新(上游已改变)' : '当前有效'
      ].join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    window.CatChart.download(blob, 'CatPlot_峰表_' + s.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') + '_' + stamp() + '.csv');
    toast('峰表 CSV 已导出：' + s.peaks.list.length + ' 峰，含来源、文件行号与波长' + (lam ? '' : '（未确认波长，d 列为空）') + '。', 'ok');
  }
  $('btnPeakCsv').addEventListener('click', doPeakCSV);

  /* ---------- 图表设置事件 ---------- */
  function numOrNull(v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? n : null; }
  function bindRange(id, key) {
    function onEdit() {
      var v = numOrNull(this.value);
      var isMin = key === 'xMin' || key === 'yMin';
      var other = key === 'xMin' ? state.settings.xMax : key === 'xMax' ? state.settings.xMin : key === 'yMin' ? state.settings.yMax : state.settings.yMin;
      if (v != null && other != null && (isMin ? v >= other : v <= other)) {
        toast('范围无效：' + (key.indexOf('x') === 0 ? 'X' : 'Y') + ' 最小值必须小于最大值，已忽略本次输入。', 'err');
        return;
      }
      state.settings[key] = v;
      renderChart(); renderViewDependent(); renderStatus(); save();
    }
    $(id).addEventListener('input', onEdit);
    $(id).addEventListener('change', onEdit);
  }
  $('setTitle').addEventListener('input', function () { state.settings.title = this.value; renderChart(); save(); });
  bindRange('setXMin', 'xMin'); bindRange('setXMax', 'xMax');
  bindRange('setYMin', 'yMin'); bindRange('setYMax', 'yMax');
  $('setLegend').addEventListener('change', function () { state.settings.showLegend = this.checked; renderChart(); save(); });
  $('setGrid').addEventListener('change', function () { state.settings.showGrid = this.checked; renderChart(); save(); });
  $('setStack').addEventListener('change', function () { state.settings.stack = this.checked; renderChart(); save(); });
  $('setStackGap').addEventListener('input', function () { var v = +this.value; if (isFinite(v) && v > 0) { state.settings.stackGap = v; renderChart(); save(); } });
  $('setStackScale').addEventListener('input', function () { var v = +this.value; if (isFinite(v) && v > 0) { state.settings.stackScale = v; renderChart(); save(); } });
  $('techSelect').addEventListener('change', function () { setTechnique(this.value); });

  /* ---------- 荷电校正（XPS） ---------- */
  $('chargeMode').addEventListener('change', function () {
    var s = getSelected(); if (!s) return;
    s.charge.mode = this.value;
    $('chargeRefOpts').hidden = this.value !== 'reference';
    $('chargeManualOpts').hidden = this.value !== 'manual';
    if (this.value === 'none') s.charge.applied = false;
    renderAll();
  });
  ['chargeRefMeasured', 'chargeRefTarget', 'chargeShift', 'chargeRefLabel'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var s = getSelected(); if (!s) return;
      var v = parseFloat(this.value);
      if (id === 'chargeRefMeasured') s.charge.refMeasured = isFinite(v) ? v : null;
      else if (id === 'chargeRefTarget') s.charge.refTarget = isFinite(v) ? v : null;
      else if (id === 'chargeShift') s.charge.shift = isFinite(v) ? v : 0;
      else s.charge.refLabel = this.value;
    });
  });
  $('btnChargeApply').addEventListener('click', function () {
    var s = getSelected(); if (!s) return;
    var c = s.charge;
    if (c.mode === 'none') { toast('请先选择校正方式。', 'err'); return; }
    var shift;
    if (c.mode === 'reference') {
      if (!isFinite(c.refMeasured) || !isFinite(c.refTarget)) { toast('按参考峰校正需填写实测值与目标值。', 'err'); return; }
      shift = c.refMeasured - c.refTarget;
      if (Math.abs(shift) < 1e-6) { toast('实测与目标一致，无需校正。'); c.applied = false; }
    } else {
      shift = c.shift;
      if (!isFinite(shift)) { toast('请填写有效位移量。', 'err'); return; }
    }
    c.shift = shift; c.applied = true;
    var sh = (c.applied && isFinite(c.shift)) ? c.shift : 0;
    checkpoint('荷电校正 ' + (sh ? '−' + M.formatNum(sh) + ' eV' : '0') + '（' + s.name + '）');
    renderAll(); save();
    toast('荷电校正已应用：整谱平移 −' + M.formatNum(sh) + ' eV（原始数据不变）', 'ok');
  });
  $('btnChargeReset').addEventListener('click', function () {
    var s = getSelected(); if (!s) return;
    if (!s.charge.applied && !s.charge.shift) { toast('当前未应用校正。'); return; }
    checkpoint('撤销荷电校正（' + s.name + '）');
    s.charge.applied = false; s.charge.shift = 0; s.charge.mode = 'none';
    renderAll(); save();
    toast('已撤销荷电校正。');
  });

  $('btnResetRange').addEventListener('click', function () {
    state.settings.xMin = state.settings.xMax = state.settings.yMin = state.settings.yMax = null;
    ['setXMin', 'setXMax', 'setYMin', 'setYMax'].forEach(function (id) { $(id).value = ''; });
    renderChart(); renderViewDependent(); renderStatus(); save();
    toast('坐标轴已恢复自动范围。');
  });

  /* ---------- 样品设置事件 ---------- */
  $('smpName').addEventListener('input', function () {
    var s = getSelected(); if (!s) return;
    s.name = this.value || '未命名样品';
    renderSampleList(); renderChart(); save();
  });
  $('smpColor').addEventListener('input', function () {
    var s = getSelected(); if (!s) return;
    s.color = this.value;
    renderSampleList(); renderChart(); renderSettingsPanel(); save();
  });
  $('smpWidth').addEventListener('input', function () {
    var s = getSelected(); if (!s) return;
    s.lineWidth = Number(this.value);
    $('smpWidthOut').textContent = this.value;
    renderChart(); save();
  });
  function applyOffset(v) {
    var s = getSelected(); if (!s) return;
    var n = Number(v);
    if (!isFinite(n) || n < 0) n = 0;
    s.offset = Math.round(n * 1000) / 1000;
    recomputeLayers(s);
    $('smpOffsetOut').textContent = s.offset;
    setInputValue($('smpOffsetRange'), Math.min(s.offset, offsetMaxFor(s)));
    setInputValue($('smpOffsetNum'), s.offset);
    renderSampleList(); renderChart(); renderBadges(); renderSettingsPanel(); renderStatus(); save();
  }
  $('smpOffsetRange').addEventListener('input', function () { applyOffset(this.value); });
  $('smpOffsetNum').addEventListener('input', function () { if (this.value !== '') applyOffset(this.value); });
  $('smpOffsetNum').addEventListener('change', function () { if (this.value !== '') applyOffset(this.value); });
  $('smpNormalize').addEventListener('change', function () {
    var s = getSelected(); if (!s) return;
    if (this.checked && !M.canNormalize(s.corrected.y)) {
      this.checked = false;
      toast('无法归一化「' + s.name + '」：' + M.normalizeBlockReason(s.corrected.y), 'err');
      return;
    }
    s.normalize = this.checked;
    var om = offsetMaxFor(s);
    if (s.offset > om) { s.offset = om; toast('归一化后偏移量已自动调整为新量程上限 ' + om + '。'); }
    renderAll();
  });
  $('btnUnify').addEventListener('click', function () {
    var vis = visibleSamples();
    var applied = 0, blocked = [];
    vis.forEach(function (s) {
      if (s.normalize) { applied++; return; }
      if (M.canNormalize(s.corrected.y)) { s.normalize = true; applied++; }
      else blocked.push(s.name);
    });
    renderAll();
    if (blocked.length) {
      toast('统一归一化完成 ' + applied + ' 条；' + blocked.length + ' 条因最强峰 <= 0 被跳过：' + blocked.join('、') + '。', 'err');
    } else {
      toast('已将 ' + applied + ' 条可见曲线统一归一化（最强峰 = 1）。', 'ok');
    }
  });
  $('btnDeleteSample').addEventListener('click', function () {
    var s = getSelected(); if (s) deleteSample(s.id);
  });

  /* ---------- 悬停读数：实际取点 X/Y，超范围显示无数据 ---------- */
  var tooltip = $('tooltip');
  function hideTooltip() {
    tooltip.hidden = true;
    var g = $('chart').querySelector('#hoverGuide');
    if (g) g.setAttribute('visibility', 'hidden');
  }
  function pickedIndex(s, dataX) {
    var pos = M.nearestSorted(s.q.xs, dataX);
    return pos < 0 ? -1 : s.q.idx[pos];
  }
  $('chart').addEventListener('mousemove', function (ev) {
    var svg = $('chart');
    var meta = svg._meta;
    if (!meta || !meta.samples.length) { hideTooltip(); return; }
    var rect = svg.getBoundingClientRect();
    var scale = Math.min(rect.width / meta.W, rect.height / meta.H);
    var offX = (rect.width - meta.W * scale) / 2;
    var offY = (rect.height - meta.H * scale) / 2;
    var lx = (ev.clientX - rect.left - offX) / scale;
    var ly = (ev.clientY - rect.top - offY) / scale;
    var pl = meta.plot;
    if (lx < pl.x || lx > pl.x + pl.w || ly < pl.y || ly > pl.y + pl.h) { hideTooltip(); return; }
    var dataX = meta.xMin + (lx - pl.x) / pl.w * (meta.xMax - meta.xMin);
    var guide = svg.querySelector('#hoverGuide');
    var rows = [];
    meta.samples.forEach(function (s) {
      var head = '<div class="tt-row"><span class="tt-dot" style="background:' + window.CatChart.esc(s.color) + '"></span>' + window.CatChart.esc(s.name) + '：';
      if (dataX < s.xExtent[0] || dataX > s.xExtent[1]) {
        rows.push(head + '<span class="tt-none">无数据（范围 ' + window.CatChart.fmtNum(s.xExtent[0]) + '–' + window.CatChart.fmtNum(s.xExtent[1]) + '°）</span></div>');
        return;
      }
      var i = pickedIndex(s, dataX);
      if (i < 0) { rows.push(head + '<span class="tt-none">无数据</span></div>'); return; }
      var px = s.display.x[i], py = s.display.y[i];
      var txt = 'X=' + window.CatChart.fmtNum(px) + '° · Y=' + window.CatChart.fmtNum(py);
      if (s.offset > 0) txt += '<span class="tt-sub">（分析 ' + window.CatChart.fmtNum(s.analysis.y[i]) + ' + 偏移 ' + s.offset + '）</span>';
      rows.push(head + '<b>' + txt + '</b></div>');
    });
    if (!rows.length) { hideTooltip(); return; }
    if (guide) {
      guide.setAttribute('x1', lx); guide.setAttribute('x2', lx);
      guide.setAttribute('visibility', 'visible');
    }
    tooltip.innerHTML = '<div class="tt-x">光标 2θ = ' + window.CatChart.fmtNum(dataX) + '°</div>' + rows.join('');
    tooltip.hidden = false;
    var wrap = $('chartWrap').getBoundingClientRect();
    var tx = ev.clientX - wrap.left + 16;
    var ty = ev.clientY - wrap.top + 14;
    if (tx + tooltip.offsetWidth > wrap.width - 8) tx = ev.clientX - wrap.left - tooltip.offsetWidth - 14;
    if (ty + tooltip.offsetHeight > wrap.height - 8) ty = wrap.height - tooltip.offsetHeight - 8;
    tooltip.style.left = Math.max(4, tx) + 'px';
    tooltip.style.top = Math.max(4, ty) + 'px';
  });
  $('chart').addEventListener('mouseleave', hideTooltip);

  /* ---------- 导出：范围 / 尺寸 / 字号 ---------- */
  function exportFontScale() {
    var v = Number($('exportFont').value);
    return isFinite(v) && v >= 0.5 && v <= 3 ? v : 1;
  }
  function exportWidth() {
    var v = Math.round(Number($('exportWidth').value));
    return isFinite(v) && v >= 480 && v <= 8000 ? v : 1920;
  }
  function ensureExportSamples() {
    var list = exportSamples();
    if (!list.length) { toast('当前导出范围内没有样品，请切换范围或先导入数据。', 'err'); return null; }
    return list;
  }
  function doPNG() {
    var list = ensureExportSamples(); if (!list) return;
    hideTooltip();
    var svg = window.CatChart.renderExport(list, Object.assign({}, state.settings, { technique: state.technique }), { fontScale: exportFontScale(), logicalH: 560, tracks: activeTracks(), overlay: chartOverlay(), noteExtra: chartNoteExtra() });
    var w = exportWidth();
    window.CatChart.exportPNG(svg, 'CatPlot_' + window.CatModel.tech(state.technique).name + '_' + stamp() + '.png', w)
      .then(function (d) { toast('PNG 已导出：' + d.outW + ' × ' + d.outH + ' px。', 'ok'); })
      .catch(function (e) { toast('PNG 导出失败：' + e.message, 'err'); });
  }
  function doSVG() {
    var list = ensureExportSamples(); if (!list) return;
    hideTooltip();
    var svg = window.CatChart.renderExport(list, Object.assign({}, state.settings, { technique: state.technique }), { fontScale: exportFontScale(), logicalH: 560, tracks: activeTracks(), overlay: chartOverlay(), noteExtra: chartNoteExtra() });
    var d = window.CatChart.exportSVG(svg, 'CatPlot_' + window.CatModel.tech(state.technique).name + '_' + stamp() + '.svg', exportWidth());
    toast('SVG 已导出：宽度 ' + d.outW + ' px。', 'ok');
  }
  function csvCell(v) {
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function doCSV() {
    var list = exportSamples();
    if (!list.length) { toast('当前导出范围内没有数据。', 'err'); return; }
    var lines = ['样品名称,原始行号,2theta(deg),原始强度,分析强度,显示偏移,显示强度,处理方式,数据来源'];
    list.forEach(function (s) {
      var src = s.source === 'sim' ? '模拟数据(程序生成)' : '上传文件:' + ((s.importMeta && s.importMeta.fileName) || '');
      var idxByLine = new Map();
      s.working.lineNos.forEach(function (ln, i) { idxByLine.set(ln, i); });
      if (s.importMeta && s.importMeta.merged) {
        s.importMeta.merged.forEach(function (g) {
          var wi = idxByLine.get(g.lineNos[0]);
          if (wi != null) g.lineNos.forEach(function (ln) { idxByLine.set(ln, wi); });
        });
      }
      for (var i = 0; i < s.raw.x.length; i++) {
        var ln = s.raw.lineNos[i];
        var wi = idxByLine.has(ln) ? idxByLine.get(ln) : null;
        var ay = wi == null ? '' : M.formatNum(s.analysis.y[wi]);
        var dy = wi == null ? '' : M.formatNum(s.display.y[wi]);
        lines.push([
          csvCell(s.name), ln, M.formatNum(s.raw.x[i]), M.formatNum(s.raw.y[i]),
          ay, M.formatNum(s.offset), dy,
          csvCell(s.processDesc), csvCell(src)
        ].join(','));
      }
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    window.CatChart.download(blob, 'CatPlot_' + window.CatModel.tech(state.technique).name + '_数据_' + stamp() + '.csv');
    toast('CSV 已导出：' + list.length + ' 个样品，三层数据全精度。', 'ok');
  }
  ['btnPng', 'btnPng2'].forEach(function (id) { $(id).addEventListener('click', doPNG); });
  ['btnSvg', 'btnSvg2'].forEach(function (id) { $(id).addEventListener('click', doSVG); });
  ['btnCsv', 'btnCsv2'].forEach(function (id) { $(id).addEventListener('click', doCSV); });
  $('exportFont').addEventListener('input', function () { $('exportFontOut').textContent = this.value; });
  $('exportWidth').addEventListener('change', function () {
    var v = Number(this.value);
    if (!isFinite(v) || v < 480 || v > 8000) { this.value = 1920; toast('导出宽度需在 480–8000 px，已恢复 1920。', 'err'); }
  });

  /* ---------- 项目 JSON 导出 / 恢复 ---------- */
  $('btnExportProject').addEventListener('click', function () {
    if (!state.samples.length) { toast('当前项目为空，无可导出内容。', 'err'); return; }
    var payload = M.serializeProject(state);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    window.CatChart.download(blob, 'CatPlot_项目_' + stamp() + '.json');
    toast('项目 JSON 已导出。', 'ok');
  });
  $('btnRestoreProject').addEventListener('click', function () { $('projectInput').click(); });
  $('projectInput').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    f.text().then(function (txt) {
      var obj;
      try { obj = JSON.parse(txt); }
      catch (e) { toast('恢复失败：文件不是合法 JSON（' + e.message + '）。', 'err'); return; }
      var v = M.validateProject(obj);
      if (!v.ok) {
        toast('恢复失败，校验未通过：' + v.errors.slice(0, 3).join('；') + (v.errors.length > 3 ? '……共 ' + v.errors.length + ' 项' : ''), 'err');
        return;
      }
      if (!window.confirm('恢复项目将覆盖当前 ' + state.samples.length + ' 个样品、处理历史与设置，确定继续？')) return;
      var rebuilt = [], blocked = [];
      for (var i = 0; i < v.samples.length; i++) {
        var s = v.samples[i];
        var h = hydrateSavedSample(s);
        if (!h) { toast('恢复失败：samples[' + i + '] 的 working 缺少行号且长度与 raw 不一致，无法对齐三层数据。', 'err'); return; }
        recomputeLayers(h);
        if (h.normalize && !M.canNormalize(h.corrected.y)) { h.normalize = false; blocked.push(h.name); }
        rebuilt.push(h);
      }
      state.samples = rebuilt;
      state.settings = Object.assign({ title: 'XRD 图谱对比', xMin: null, xMax: null, yMin: null, yMax: null, showLegend: true, showGrid: true, stack: true, stackGap: 1.15, stackScale: 0.8 }, v.settings);
      state.technique = v.technique || 'xrd';
      state.selectedId = rebuilt[0] ? rebuilt[0].id : null;
      state.refs = Array.isArray(v.refs) ? v.refs : [];
      state.lib = { wavelength: v.lib && v.lib.wavelength > 0 ? v.lib.wavelength : null, sticksOn: !!(v.lib && v.lib.sticksOn) };
      state.history = Array.isArray(v.history) ? v.history.slice(-200) : [];
      state.phases = Array.isArray(v.phases) ? v.phases : [];
      state.fit = sanitizeFit(v.fit);
      undoStack = []; redoStack = [];
      highlightPeakId = null; pickMode = null;
      logHistory('恢复项目 JSON（' + rebuilt.length + ' 个样品）');
      if (window.CatCardsUI) window.CatCardsUI.resolveSticks().then(function () { renderAll(); });
      renderAll();
      toast('项目已恢复：' + rebuilt.length + ' 个样品，背景/峰表/历史/物相一并还原' + (blocked.length ? '；' + blocked.length + ' 条归一化因最强峰 <= 0 被重置：' + blocked.join('、') : '') + '。', 'ok');
    }).catch(function (e) { toast('恢复失败：' + e.message, 'err'); });
  });

  $('btnClearAll').addEventListener('click', function () {
    if (!state.samples.length && !state.phases.length && !state.refs.length) { toast('当前没有数据。'); return; }
    if (!window.confirm('确定清空全部样品、参考轨道、物相与设置？可用顶部撤销恢复，建议先导出项目 JSON 备份。')) return;
    checkpoint('清空全部数据');
    state.samples = [];
    state.selectedId = null;
    state.refs = [];
    state.phases = [];
    state.fit = null;
    state.lib.sticksOn = false;
    state.technique = 'xrd';
    state.settings = { title: 'XRD 图谱对比', xMin: null, xMax: null, yMin: null, yMax: null, showLegend: true, showGrid: true, stack: true, stackGap: 1.15, stackScale: 0.8 };
    highlightPeakId = null; pickMode = null;
    if (window.CatCardsUI) window.CatCardsUI.resolveSticks().then(function () { renderAll(); });
    renderAll();
    toast('已清空全部数据（可用顶部撤销恢复；空项目已保存）。', 'ok');
  });

  /* ---------- 导入对话框 ---------- */
  var imp = { queue: [], index: 0, text: '', fileName: '', result: null, ackSig: null };

  function delimValue() {
    var v = $('impDelim').value;
    if (v === '\\t') return '\t';
    return v;
  }
  function impOpts() {
    return {
      delimiter: delimValue(),
      skipRows: Number($('impSkip').value) || 0,
      xCol: Number($('impX').value) || 0,
      yCol: Number($('impY').value) || 0,
      duplicateMode: document.querySelector('input[name="dupMode"]:checked').value,
      sortMode: document.querySelector('input[name="sortMode"]:checked').value
    };
  }

  function openImportQueue(files) {
    imp.queue = files;
    imp.index = 0;
    openImportCurrent();
  }
  function openImportCurrent() {
    var f = imp.queue[imp.index];
    imp.text = f.text;
    imp.fileName = f.name;
    imp.ackSig = null;
    $('impFileMeta').textContent = f.name + ' · ' + (f.size / 1024).toFixed(1) + ' KB' +
      (imp.queue.length > 1 ? ' · 文件 ' + (imp.index + 1) + ' / ' + imp.queue.length : '');
    $('impQueue').textContent = imp.queue.length > 1 ? '多文件导入：' + (imp.index + 1) + ' / ' + imp.queue.length : '';
    $('impName').value = f.name.replace(/\.[^.]+$/, '');
    $('impDelim').value = 'auto';
    var d = window.CatParser.detectDelimiter(imp.text);
    $('impSkip').value = window.CatParser.suggestSkip(imp.text, d, 0, 1);
    document.querySelector('input[name="dupMode"][value="keep"]').checked = true;
    document.querySelector('input[name="sortMode"][value="sort"]').checked = true;
    $('impAck').checked = false;
    $('importModal').hidden = false;
    updateImportPreview(true);
  }
  function closeImport() {
    $('importModal').hidden = true;
    imp.queue = []; imp.index = 0; imp.text = ''; imp.result = null; imp.ackSig = null;
  }

  function fillColumnSelects(maxCols, keep) {
    var prevX = $('impX').value, prevY = $('impY').value;
    ['impX', 'impY'].forEach(function (id) {
      var sel = $(id);
      sel.innerHTML = '';
      for (var i = 0; i < maxCols; i++) {
        var o = document.createElement('option');
        o.value = i;
        o.textContent = '第 ' + (i + 1) + ' 列';
        sel.appendChild(o);
      }
    });
    $('impX').value = keep && Number(prevX) < maxCols ? prevX : '0';
    $('impY').value = keep && Number(prevY) < maxCols ? prevY : (maxCols > 1 ? '1' : '0');
    if ($('impX').value === $('impY').value && maxCols > 1) {
      $('impY').value = $('impX').value === '0' ? '1' : '0';
    }
  }

  function updateImportPreview(rebuildCols) {
    var opts = impOpts();
    var r = window.CatParser.analyze(imp.text, opts);
    imp.result = r;

    if (rebuildCols || $('impX').options.length !== Math.max(1, r.maxCols)) {
      fillColumnSelects(Math.max(1, r.maxCols), !rebuildCols);
      opts = impOpts();
      r = window.CatParser.analyze(imp.text, opts);
      imp.result = r;
    }

    var xCol = opts.xCol, yCol = opts.yCol;
    var table = $('impTable');
    table.innerHTML = '';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var th0 = document.createElement('th'); th0.textContent = '文件行号'; hr.appendChild(th0);
    for (var c = 0; c < r.maxCols; c++) {
      var th = document.createElement('th');
      th.textContent = '列 ' + (c + 1) + (c === xCol ? ' (X)' : c === yCol ? ' (Y)' : '');
      if (c === xCol) th.className = 'col-x';
      if (c === yCol) th.className = 'col-y';
      hr.appendChild(th);
    }
    thead.appendChild(hr); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    r.preview.forEach(function (row) {
      var tr = document.createElement('tr');
      var td0 = document.createElement('td'); td0.textContent = row.lineNo; tr.appendChild(td0);
      for (var c2 = 0; c2 < r.maxCols; c2++) {
        var td = document.createElement('td');
        var v = row.cells[c2];
        td.textContent = v === undefined ? '' : v;
        if (c2 === xCol) td.className = 'col-x';
        if (c2 === yCol) td.className = 'col-y';
        if ((c2 === xCol || c2 === yCol) && !window.CatParser.isNumeric(v)) td.classList.add('bad-cell');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var sum = $('impSummary');
    var detected = r.delimiter === 'ws' ? '空白' : r.delimiter === '\t' ? '制表符' : r.delimiter === ',' ? '逗号' : r.delimiter;
    var html = '分隔符：<b>' + window.CatChart.esc(detected) + '</b> · 跳过文件头 <b>' + r.skippedHeader +
      '</b> 行 · 数据行 <b>' + r.dataRows + '</b> · 空行 ' + r.blankRows +
      ' · <span class="ok">有效数据点 ' + r.points.length + '</span>';
    if (r.errors.length) html += ' · <span class="warn">无效行 ' + r.errors.length + '</span>';
    if (r.sortApplied === 'asc') html += ' · 将生成升序独立副本（原始顺序保留）';
    if (opts.duplicateMode === 'merge' && r.merged.length) html += ' · 合并重复 X ' + r.merged.length + ' 组';
    sum.innerHTML = html;

    /* 数据检查块：重复 X / 非单调，显式选项 */
    var q = r.quality;
    $('qDup').hidden = !(q.duplicateExtra > 0);
    if (q.duplicateExtra > 0) {
      $('qDupText').textContent = '检测到重复 X：' + q.duplicates.length + ' 组、多余 ' + q.duplicateExtra + ' 点（例如 X=' + q.duplicates[0].x + ' 出现在行 ' + q.duplicates[0].lineNos.join(',') + '）。';
    }
    $('qSort').hidden = !q.nonMonotonic;
    $('impQuality').hidden = !(q.duplicateExtra > 0 || q.nonMonotonic);

    var errBox = $('impErrors');
    var sig = M.errorSignature(r.errors);
    if (sig !== imp.ackSig) {
      $('impAck').checked = false;
      imp.ackSig = null;
    }
    if (r.errors.length) {
      errBox.hidden = false;
      var ul = $('impErrorList');
      ul.innerHTML = '';
      r.errors.slice(0, 50).forEach(function (e) {
        var li = document.createElement('li');
        li.textContent = '第 ' + e.lineNo + ' 行：' + e.reason + '　内容：' + e.text;
        ul.appendChild(li);
      });
      if (r.errors.length > 50) {
        var more = document.createElement('li');
        more.textContent = '…… 其余 ' + (r.errors.length - 50) + ' 行问题类似，导入时将一并跳过（需勾选确认）。';
        ul.appendChild(more);
      }
    } else {
      errBox.hidden = true;
    }

    var fatal = $('impFatal');
    if (r.fatal) { fatal.hidden = false; fatal.textContent = r.fatal; }
    else fatal.hidden = true;

    var canImport = !r.fatal && r.points.length > 0 && (!r.errors.length || $('impAck').checked);
    $('impConfirm').disabled = !canImport;
    $('impConfirm').textContent = r.points.length ? '导入 ' + r.points.length + ' 个数据点' : '导入';
  }

  ['impDelim', 'impSkip', 'impX', 'impY'].forEach(function (id) {
    $(id).addEventListener('input', function () { updateImportPreview(false); });
    $(id).addEventListener('change', function () { updateImportPreview(false); });
  });
  document.querySelectorAll('input[name="dupMode"], input[name="sortMode"]').forEach(function (el) {
    el.addEventListener('change', function () { updateImportPreview(false); });
  });
  $('impAck').addEventListener('change', function () {
    if (this.checked && imp.result) imp.ackSig = M.errorSignature(imp.result.errors);
    else imp.ackSig = null;
    updateImportPreview(false);
  });
  $('impCancel').addEventListener('click', closeImport);
  $('impClose').addEventListener('click', closeImport);
  $('importModal').addEventListener('click', function (ev) { if (ev.target === this) closeImport(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('importModal').hidden) closeImport(); });

  $('impConfirm').addEventListener('click', function () {
    var r = imp.result;
    if (!r || !r.points.length) return;
    var opts = impOpts();
    var name = $('impName').value.trim() || imp.fileName.replace(/\.[^.]+$/, '');
    checkpoint('导入「' + name + '」');
    makeSample({
      name: name,
      rawPoints: r.rawPoints,
      workingPoints: r.points,
      source: 'file',
      importMeta: {
        fileName: imp.fileName,
        delimiter: r.delimiter,
        skipRows: opts.skipRows,
        xCol: opts.xCol,
        yCol: opts.yCol,
        duplicateMode: opts.duplicateMode,
        sortMode: opts.sortMode,
        sortApplied: r.sortApplied,
        merged: r.merged,
        skippedRows: r.errors,
        rawRecordCount: r.rawPoints.length,
        importedAt: new Date().toISOString()
      }
    });
    renderAll();
    var extra = [];
    if (r.errors.length) extra.push('按确认跳过 ' + r.errors.length + ' 行无效数据');
    if (r.merged.length) extra.push('合并重复 X ' + r.merged.length + ' 组');
    if (r.sortApplied === 'asc') extra.push('生成升序独立副本');
    toast('已导入「' + name + '」：' + r.points.length + ' 个分析点' + (extra.length ? '，' + extra.join('，') : '') + '。', 'ok');
    if (imp.index < imp.queue.length - 1) {
      imp.index++;
      openImportCurrent();
    } else {
      closeImport();
    }
  });

  $('btnDemoFile').addEventListener('click', function () {
    var text = window.CatSamples.buildDemoFileText();
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    window.CatChart.download(blob, 'CatPlot_示例数据_模拟.txt');
    toast('示例 TXT 已下载：含 3 行文件头，可用来测试“跳过文件头”和列选择。', 'ok');
  });

  /* ---------- 文件上传 ---------- */
  var ALLOWED = /\.(csv|txt|tsv|dat)$/i;
  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    var ok = [], rejected = [];
    files.forEach(function (f) {
      if (!ALLOWED.test(f.name)) { rejected.push(f.name + '（不支持的格式，仅接受 CSV / TXT / TSV / DAT）'); return; }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { rejected.push(f.name + '（超过 ' + MAX_FILE_MB + ' MB 上限）'); return; }
      if (f.size === 0) { rejected.push(f.name + '（文件为空）'); return; }
      ok.push(f);
    });
    if (rejected.length) toast('以下文件未读取：' + rejected.join('；'), 'err');
    if (!ok.length) return;
    Promise.all(ok.map(function (f) {
      return f.text().then(function (text) { return { name: f.name, size: f.size, text: text }; });
    })).then(function (loaded) {
      openImportQueue(loaded);
    }).catch(function (e) {
      toast('文件读取失败：' + e.message, 'err');
    });
  }

  $('fileInput').addEventListener('change', function () {
    if (this.files.length) handleFiles(this.files);
    this.value = '';
  });
  ['btnUploadTop', 'btnUploadSide', 'btnUploadEmpty'].forEach(function (id) {
    $(id).addEventListener('click', function () { $('fileInput').click(); });
  });
  ['btnSampleTop', 'btnSampleSide', 'btnSampleEmpty'].forEach(function (id) {
    $(id).addEventListener('click', loadSimSamples);
  });

  /* 拖拽导入 */
  var dragDepth = 0;
  document.addEventListener('dragenter', function (ev) {
    if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') !== -1) {
      dragDepth++;
      $('dropOverlay').hidden = false;
    }
  });
  document.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropOverlay').hidden = true;
  });
  document.addEventListener('dragover', function (ev) { ev.preventDefault(); });
  document.addEventListener('drop', function (ev) {
    ev.preventDefault();
    dragDepth = 0;
    $('dropOverlay').hidden = true;
    if (ev.dataTransfer && ev.dataTransfer.files.length) handleFiles(ev.dataTransfer.files);
  });

  /* ---------- 启动 ---------- */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 150);
  });

  var boot = load();
  if (boot === 'first') {
    var defs = window.CatSamples.makeSimSamples();
    defs.forEach(function (d) {
      var pts = d.raw.x.map(function (x, i) { return { x: x, y: d.raw.y[i], lineNo: i + 1 }; });
      makeSample({
        name: d.name, rawPoints: pts, source: 'sim', note: d.note,
        importMeta: { source: 'sim', generator: 'CatPlot 内置模拟生成器（种子固定）', importedAt: new Date().toISOString(), skippedRows: [], merged: [], sortApplied: 'none' }
      });
    });
    state.selectedId = state.samples[0].id;
    logHistory('首次启动：加载模拟示例（非真实实验数据）');
    renderAll();
  } else if (boot === 'corrupt') {
    renderAll();
    toast('本地存档损坏或不可读，已忽略（不会自动恢复模拟样品）。可恢复项目 JSON 备份。', 'err');
  } else {
    var blockedNames = [];
    state.samples.forEach(function (s) {
      recomputeLayers(s);
      if (s.normalize && !M.canNormalize(s.corrected.y)) { s.normalize = false; blockedNames.push(s.name); }
    });
    renderAll();
    if (blockedNames.length) toast('存档中 ' + blockedNames.length + ' 条归一化因最强峰 <= 0 被重置：' + blockedNames.join('、') + '。', 'err');
  }

  window.CatApp = {
    state: state, toast: toast, save: save, renderAll: renderAll, renderChart: renderChart,
    activeTracks: activeTracks, checkpoint: checkpoint, logHistory: logHistory,
    getSelected: getSelected, setTool: setTool, setTechnique: setTechnique, setDataTab: setDataTab, renderPhases: renderPhases
  };
})();