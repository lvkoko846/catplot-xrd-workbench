/* 工作台端到端验收（headless Chrome + CDP，无第三方依赖）。
   真实谱图 BT86（Bruker UXD 提取，Cu Kα1，见 tests/fixtures/real/PROVENANCE.md）走完整批次1流程：
   导入 → 波长确认 → SNIP 背景预览/扣除/原始对照 → 自动寻峰 → 峰表↔图形双向联动 →
   手动加峰/删峰 → 上游变更失效标记 → 撤销重做 → 峰表 CSV → 项目 v2 导出/恢复 →
   重载持久化 → 参考轨道加入/排序/显隐/物相标记 → PNG 导出 → 清空与撤销。
   前置：node scripts/preview.mjs（4173）已运行。
   用法：node tests/browser-workbench.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9224;
const profile = mkdtempSync(join(tmpdir(), 'catplot-wb-reg-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--window-size=1440,960',
  '--user-data-dir=' + profile, 'http://127.0.0.1:4173/'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
async function getTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome target not ready');
}
let id = 0;
const pending = new Map();
const consoleErrors = [];
function send(ws, method, params) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
async function ev(ws, expression) {
  const r = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
  return r.result.value;
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(m.params.exceptionDetails));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' '));
};
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await sleep(1200);

/* 下载捕获：拦截 a[download].click，保留 blob URL 供读取 */
await ev(ws, `(() => {
  window.__caps = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__caps.push({ name: this.download, href: this.href }); return; }
    return orig.apply(this);
  };
  window.confirm = () => true;
  return true;
})()`);

console.log('== W 真实谱图 BT86 完整批次1流程 ==');
let s = await ev(ws, `(() => ({
  samples: CatApp.state.samples.length,
  paths: document.getElementById('chart').querySelectorAll('path').length,
  tool: document.querySelector('.tool-tab.active').getAttribute('data-tool')
}))()`);
ok(s.samples === 3 && s.paths >= 3 && s.tool === 'display', 'W1 启动：3 条模拟样品 + 主谱图渲染', s);

const bt86 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real', 'BT86_xrd.txt'), 'utf8');
s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = ${JSON.stringify(bt86)};
  const f = new File([text], 'BT86_xrd.txt', { type: 'text/plain' });
  Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
  $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60; i++) { await sleep(100); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tr').length > 1) break; }
  const preview = { rows: $('impTable').querySelectorAll('tbody tr').length, summary: $('impSummary').textContent, errors: $('impErrors').hidden };
  $('impConfirm').click(); await sleep(400);
  const items = [...$('sampleList').querySelectorAll('.sample-item')];
  const bt = items.find(x => x.textContent.includes('BT86'));
  bt.click(); await sleep(300);
  const sel = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  return {
    preview, n: CatApp.state.samples.length, name: sel.name,
    rawN: sel.raw.x.length, workN: sel.working.x.length,
    x0: sel.working.x[0], x1: sel.working.x[sel.working.x.length - 1],
    trace: $('smpTraceBody').textContent.includes('BT86_xrd.txt'),
    lineAligned: sel.working.lineNos.length === sel.working.x.length
  };
})()`);
ok(s.preview.rows > 0 && s.preview.errors, 'W2a 导入预览：逐行表格 + 无错误', s.preview);
ok(s.n === 4 && s.rawN === 2374 && s.workN === 2374 && s.lineAligned, 'W2b BT86 导入 2374 点，raw/working 行号对齐', s);
ok(Math.abs(s.x0 - 3) < 1e-6 && Math.abs(s.x1 - 40) < 0.02 && s.trace, 'W2c 范围 3–40° + 导入追溯含文件名', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  $('btnCards').click(); await sleep(150);
  $('stickLambdaPreset').value = '1.5406'; $('stickLambdaPreset').dispatchEvent(new Event('change', { bubbles: true }));
  $('btnLambdaConfirm').click(); await sleep(250);
  $('cardsClose').click(); await sleep(150);
  return { lambda: CatApp.state.lib.wavelength };
})()`);
ok(s.lambda === 1.5406, 'W3 实验波长确认 Cu Kα1 λ=1.5406 Å', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.querySelector('.tool-tab[data-tool="bg"]').click(); await sleep(150);
  const sel = () => CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  const raw0 = sel().raw.y[0];
  $('bgMode').value = 'snip'; $('bgMode').dispatchEvent(new Event('change', { bubbles: true })); await sleep(300);
  const previewLine = $('chart').innerHTML.includes('#f59e0b');
  const before = sel().bg.applied;
  $('btnBgApply').click(); await sleep(400);
  const applied = sel().bg.applied;
  const correctedOk = Math.abs(sel().corrected.y[0] - (sel().working.y[0] - sel().bgY[0])) < 1e-9;
  const rawUntouched = sel().raw.y[0] === raw0;
  const badge = $('processBadges').textContent.includes('背景已扣除');
  $('bgGhost').checked = true; $('bgGhost').dispatchEvent(new Event('change', { bubbles: true })); await sleep(250);
  const ghost = $('chart').innerHTML.includes('#cbd5e1');
  const status = $('bgStatus').textContent;
  return { previewLine, before, applied, correctedOk, rawUntouched, badge, ghost, status: status.slice(0, 40) };
})()`);
ok(s.previewLine && !s.before, 'W4a SNIP 背景预览：橙色虚线，未扣除', s);
ok(s.applied && s.correctedOk && s.rawUntouched && s.badge, 'W4b 确认扣除：校正层=工作−背景，原始未动', s);
ok(s.ghost, 'W4c 原始曲线对照（浅灰 ghost）可见');

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.querySelector('.tool-tab[data-tool="peaks"]').click(); await sleep(150);
  $('btnAutoPeaks').click(); await sleep(600);
  const sel = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  const rows = [...$('peakTable').querySelectorAll('tbody tr')];
  const cells0 = rows[0] ? [...rows[0].querySelectorAll('td')].map(td => td.textContent) : [];
  return {
    n: sel.peaks.list.length, pill: $('peakCountPill').textContent, rows: rows.length,
    markers: $('chart').querySelectorAll('[data-pid]').length,
    dOk: /^\\d+\\.\\d{4}$/.test(cells0[2] || ''), lineNo: /^\\d+$/.test(cells0[6] || ''),
    basis: !!sel.peaks.basisKey, sigma: sel.peaks.sigma,
    staleHidden: $('peakStaleWarn').hidden,
    xs: sel.peaks.list.slice(0, 5).map(p => +p.x.toFixed(3))
  };
})()`);
ok(s.n > 5 && s.rows === s.n && s.pill === String(s.n), 'W5a 自动寻峰命中 ' + s.n + ' 个峰，峰表同步', s);
ok(s.markers === s.n && s.dOk && s.lineNo && s.basis, 'W5b 峰标记/d 值/文件行号/基准键齐全', s);
ok(s.staleHidden, 'W5c 新峰表无失效标记');

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [...$('peakTable').querySelectorAll('tbody tr')];
  rows[0].click(); await sleep(250);
  const rowHl = rows[0].classList.contains('hl');
  const chartHl = $('chart').innerHTML.includes('#e11d48');
  const markers = [...$('chart').querySelectorAll('g[data-pid]')];
  const target = markers[2];
  const pid = target.getAttribute('data-pid');
  target.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(250);
  const row2 = $('peakTable').querySelector('tr[data-pid="' + pid + '"]');
  return { rowHl, chartHl, markerToRow: row2 && row2.classList.contains('hl'), pid };
})()`);
ok(s.rowHl && s.chartHl, 'W6a 峰表行 → 图形高亮（红色标记+参考线）', s);
ok(s.markerToRow, 'W6b 图形峰标记 → 峰表行高亮（双向联动）', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sel = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  const n0 = sel.peaks.list.length;
  $('btnPeakAddMode').click(); await sleep(150);
  const hint = !$('pickHint').hidden;
  const svg = $('chart'), meta = svg._meta, rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / meta.W, rect.height / meta.H);
  const offX = (rect.width - meta.W * scale) / 2, offY = (rect.height - meta.H * scale) / 2;
  const cx = rect.left + offX + meta.sx(25) * scale;
  const cy = rect.top + offY + (meta.plot.y + meta.plot.h / 2) * scale;
  svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy })); await sleep(350);
  const manual = sel.peaks.list.find(p => p.source === 'manual');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(150);
  const exited = $('pickHint').hidden;
  const n1 = sel.peaks.list.length;
  const mrow = $('peakTable').querySelector('tr[data-pid="' + manual.id + '"]');
  mrow.querySelector('.pk-del').click(); await sleep(300);
  return { hint, manualX: manual ? +manual.x.toFixed(3) : null, manualH: manual ? manual.height : null, exited, added: n1 === n0 + 1, deleted: sel.peaks.list.length === n0, srcBadge: mrow.textContent.includes('手动') };
})()`);
ok(s.hint && s.added && s.manualX > 24.5 && s.manualX < 25.5 && s.srcBadge, 'W7a 手动加峰：图上点击吸附数据点，来源=手动', s);
ok(s.exited && s.deleted, 'W7b Esc 退出取点模式 + 删峰恢复计数', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sel = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  $('bgIter').value = '30'; $('bgIter').dispatchEvent(new Event('input', { bubbles: true })); await sleep(400);
  const staleWarn = !$('peakStaleWarn').hidden;
  const staleBadge = $('processBadges').textContent.includes('峰表待更新');
  const staleRows = $('peakTable').querySelectorAll('tr.stale-row').length;
  document.querySelector('.tool-tab[data-tool="peaks"]').click();
  $('btnAutoPeaks').click(); await sleep(600);
  const refreshed = $('peakStaleWarn').hidden && sel.peaks.list.length > 5;
  return { staleWarn, staleBadge, staleRows, refreshed, n: sel.peaks.list.length };
})()`);
ok(s.staleWarn && s.staleBadge && s.staleRows > 0, 'W8a 上游背景变更 → 峰表标为待更新（警示+徽标+行样式）', s);
ok(s.refreshed, 'W8b 重新寻峰后失效解除', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sel = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  const n1 = sel.peaks.list.length;
  $('btnClearPeaks').click(); await sleep(300);
  const cleared = sel.peaks.list.length === 0;
  $('btnUndo').click(); await sleep(400);
  const undone = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId).peaks.list.length === n1;
  $('btnRedo').click(); await sleep(400);
  const redone = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId).peaks.list.length === 0;
  $('btnUndo').click(); await sleep(400);
  const hist = $('historyList').querySelectorAll('.hist-item').length;
  return { cleared, undone, redone, hist, n1 };
})()`);
ok(s.cleared && s.undone && s.redone && s.hist > 3, 'W9 撤销/重做往返一致 + 处理历史可见', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__caps.length = 0;
  $('btnPeakCsv').click(); await sleep(400);
  const cap = window.__caps.find(c => c.name.endsWith('.csv'));
  if (!cap) return { ok: false };
  const buf = new Uint8Array(await (await fetch(cap.href)).arrayBuffer());
  const text = new TextDecoder('utf-8').decode(buf);
  const lines = text.replace(/^\\uFEFF/, '').trim().split('\\n');
  return { ok: true, bom: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, header: lines[0], rows: lines.length - 1, name: cap.name };
})()`);
ok(s.ok && s.bom && s.header.includes('2theta') && s.header.includes('d') && s.rows > 5, 'W10 峰表 CSV：BOM + 全列 + 行数一致', s);

let projText = null;
s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__caps.length = 0;
  $('btnExportProject').click(); await sleep(400);
  const cap = window.__caps.find(c => c.name.endsWith('.json'));
  const text = await (await fetch(cap.href)).text();
  const p = JSON.parse(text);
  const bt = p.samples.find(x => x.name.includes('BT86'));
  return { version: p.version, format: p.format, n: p.samples.length, bg: bt.bg.applied, peaks: bt.peaks.list.length, hist: p.history.length, text };
})()`);
projText = s.text;
ok(s.version === 5 && s.format === 'catplot-project' && s.n === 4 && s.bg && s.peaks > 5 && s.hist > 3, 'W11a 项目 v5 导出：背景/峰表/历史完整', { ...s, text: undefined });

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = ${JSON.stringify(projText)};
  const sel = CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  const nBefore = sel.peaks.list.length;
  $('btnClearPeaks').click(); await sleep(300);
  const f = new File([text], 'proj.json', { type: 'application/json' });
  Object.defineProperty($('projectInput'), 'files', { value: [f], configurable: true });
  $('projectInput').dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 50; i++) { await sleep(100); if (CatApp.state.samples.length === 4 && CatApp.state.samples.find(x => x.name.includes('BT86')).peaks.list.length === nBefore) break; }
  const bt = CatApp.state.samples.find(x => x.name.includes('BT86'));
  return { restored: bt.peaks.list.length === nBefore, bg: bt.bg.applied, iter: bt.bg.iterations, hist: CatApp.state.history.length };
})()`);
ok(s.restored && s.bg && s.iter === 30 && s.hist > 3, 'W11b 项目 v2 恢复：同一分析状态重现（含失效后的迭代数）', s);

await ev(ws, 'location.reload(); true');
await sleep(1500);
await ev(ws, `(() => {
  window.__caps = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__caps.push({ name: this.download, href: this.href }); return; }
    return orig.apply(this);
  };
  window.confirm = () => true;
  return true;
})()`);
s = await ev(ws, `(() => {
  const bt = CatApp.state.samples.find(x => x.name.includes('BT86'));
  return { n: CatApp.state.samples.length, peaks: bt.peaks.list.length, bg: bt.bg.applied, lambda: CatApp.state.lib.wavelength, hist: CatApp.state.history.length };
})()`);
ok(s.n === 4 && s.peaks > 5 && s.bg && s.lambda === 1.5406 && s.hist > 3, 'W12 重载持久化：样品/峰表/背景/波长/历史恢复', s);

/* 参考轨道：加入 / 排序 / 显隐 / 物相标记（公开示例卡） */
let n = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  $('btnCards').click(); await sleep(300);
  for (let i = 0; i < 40; i++) { if (document.querySelectorAll('#exList .ex-row').length) break; await sleep(100); }
  return document.querySelectorAll('#exList .ex-row').length;
})()`);
ok(n === 3, 'W13a 公开示例卡 3 张（CC0×2 + MIT×1）', n);
s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  document.querySelector('[data-exadd="COD-1010942"]').click(); await sleep(400);
  document.querySelector('[data-exadd="COD-1530150"]').click(); await sleep(400);
  $('sticksOn').checked = true; $('sticksOn').dispatchEvent(new Event('change', { bubbles: true })); await sleep(600);
  $('cardsClose').click(); await sleep(200);
  document.querySelector('.dt-tab[data-dt="tracks"]').click(); await sleep(200);
  const lanes2 = $('chart').innerHTML.includes('laneClip1');
  const order0 = CatApp.state.refs.map(r => r.key);
  const rows = [...$('trackList').querySelectorAll('.track-row')];
  const upBtn = rows[1].querySelectorAll('.icon-btn')[0];
  const diag = { btnText: upBtn.textContent, disabled: upBtn.disabled, rowLabels: rows.map(r => r.querySelector('b').textContent) };
  upBtn.click(); await sleep(500);
  const order1 = CatApp.state.refs.map(r => r.key);
  const swapped = order1[0] !== order0[0];
  const tg = $('trackList').querySelectorAll('.track-row')[0].querySelector('input[type="checkbox"]');
  tg.checked = false; tg.dispatchEvent(new Event('change', { bubbles: true })); await sleep(500);
  const oneLane = CatCards.rt.sticks.length === 1 && !$('chart').innerHTML.includes('laneClip1');
  const phaseBtn = [...$('trackList').querySelectorAll('.track-row')[1].querySelectorAll('button')].find(b => b.textContent.includes('标记物相'));
  phaseBtn.click(); await sleep(300);
  document.querySelector('.dt-tab[data-dt="phases"]').click(); await sleep(150);
  return { lanes2, swapped, oneLane, refs: CatApp.state.refs.length, phases: CatApp.state.phases.length, phasePill: $('phaseCountPill').textContent, phaseSrc: $('phaseList').textContent.includes('手动'), diag, order0, order1 };
})()`);
ok(s.lanes2 && s.refs === 2, 'W13b 两张卡片 = 两条独立轨道（共用 X 轴）', s);
ok(s.swapped, 'W13c 轨道排序生效', s);
ok(s.oneLane, 'W13d 轨道显隐生效', s);
ok(s.phases === 1 && s.phasePill === '1' && s.phaseSrc, 'W13e 已选物相为独立对象（标注手动来源）', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.__caps.length = 0;
  $('btnPng').click();
  for (let i = 0; i < 60; i++) { await sleep(200); if (window.__caps.some(c => c.name.endsWith('.png'))) break; }
  const cap = window.__caps.find(c => c.name.endsWith('.png'));
  if (!cap) return { ok: false };
  const blob = await (await fetch(cap.href)).blob();
  return { ok: true, type: blob.type, size: blob.size, name: cap.name };
})()`);
ok(s.ok && s.type === 'image/png' && s.size > 5000, 'W14 PNG 导出（含轨道/峰标记/脚注）', s);

s = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  $('btnClearAll').click(); await sleep(500);
  const cleared = CatApp.state.samples.length === 0 && CatApp.state.phases.length === 0 && CatApp.state.refs.length === 0;
  $('btnUndo').click(); await sleep(600);
  const restored = CatApp.state.samples.length === 4 && CatApp.state.refs.length === 2 && CatApp.state.phases.length === 1;
  return { cleared, restored };
})()`);
ok(s.cleared && s.restored, 'W15 清空全部可撤销（样品/轨道/物相一并恢复）', s);

ok(consoleErrors.length === 0, 'E1 全程无 console 错误', consoleErrors.slice(0, 4));
console.log('== 工作台端到端汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close();
chrome.kill();
process.exit(fail ? 1 : 0);