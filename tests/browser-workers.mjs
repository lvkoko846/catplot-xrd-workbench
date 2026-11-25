/* Worker 与大文件浏览器验收（headless Chrome CDP 9345，静态服务 4173）。
   覆盖：表格 Worker 预览、列设置稳定更新、20 万点响应、取消/陈旧结果、导入与批量主线程回退、批量取消。 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:4173';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9345;
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'catplot-workers-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1280,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pass = 0, fail = 0;
function ok(condition, name, extra) { if (condition) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }
async function getTarget() {
  for (let i = 0; i < 80; i++) {
    try { const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); const page = list.find(target => target.type === 'page' && target.webSocketDebuggerUrl); if (page) return page; } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 未就绪');
}
let id = 0;
const pending = new Map();
const consoleErrors = [];
function send(ws, method, params) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }
async function ev(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(message.params.exceptionDetails));
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
};
await send(ws, 'Page.enable');
await send(ws, 'Runtime.enable');
await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const NativeWorker = window.Worker;
  window.__nativeWorker = NativeWorker;
  window.__workerStarts = [];
  window.Worker = function (url) { window.__workerStarts.push(String(url)); return new NativeWorker(url); };
  window.Worker.prototype = NativeWorker.prototype;
})()` });
await send(ws, 'Page.navigate', { url: API + '/' });
await sleep(1600);
const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitImport(state = 'ready') { const deadline = Date.now() + 30000; while ($('impStatus').dataset.state !== state && Date.now() < deadline) await sleep(50); return $('impStatus').dataset.state; }
  function upload(text, name) { const f = new File([text], name, { type: 'text/plain' }); Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true }); $('fileInput').dispatchEvent(new Event('change', { bubbles: true })); }`;

console.log('== WK Worker 与大文件验收 ==');
let result = await ev(ws, `(async () => { ${HELP}
  const rows = ['x,other,y']; for (let i = 0; i < 100; i++) rows.push((10 + i / 10) + ',' + (1000 + i) + ',' + (i * 2));
  upload(rows.join('\\n'), 'worker-columns.csv');
  const firstState = await waitImport();
  const first = { state: firstState, engine: $('impStatus').dataset.engine, points: CatApp.state.samples.length, starts: window.__workerStarts.slice() };
  $('impY').value = '2'; $('impY').dispatchEvent(new Event('input', { bubbles: true }));
  const secondState = await waitImport();
  $('impConfirm').click(); await sleep(300);
  const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
  return { first, secondState, engine: $('impStatus').dataset.engine, count: sample.raw.x.length, y0: sample.raw.y[0], y99: sample.raw.y[99] };
})()`);
ok(result.first.state === 'ready' && result.first.engine === 'worker' && result.first.starts.some(url => url.includes('parserworker.js')), 'WK1 表格预览实际由 parser Worker 执行', result.first);
ok(result.secondState === 'ready' && result.count === 100 && result.y0 === 0 && result.y99 === 198, 'WK2 列设置异步更新后仅导入最新 Y 列', result);

result = await ev(ws, `(async () => { ${HELP}
  const lines = new Array(200001); lines[0] = 'x,y'; for (let i = 1; i <= 200000; i++) lines[i] = (20 + i / 1000) + ',' + (100 + Math.sin(i / 20));
  const text = lines.join('\\n');
  window.__heartbeat = []; let beating = true;
  const timer = setInterval(() => window.__heartbeat.push(performance.now()), 20);
  upload(text, 'large-200k.csv');
  const state = await waitImport();
  beating = false; clearInterval(timer);
  const beats = window.__heartbeat, gaps = beats.slice(1).map((v, i) => v - beats[i]);
  return { state, engine: $('impStatus').dataset.engine, summary: $('impSummary').textContent, maxGap: Math.max.apply(null, gaps), beats: beats.length };
})()`);
ok(result.state === 'ready' && result.engine === 'worker' && result.summary.includes('200000') && result.maxGap < 1000 && result.beats > 5, 'WK3 20 万点 Worker 预览保持界面心跳（最大间隔<1s）', result);

result = await ev(ws, `(async () => { ${HELP}
  const before = CatApp.state.samples.length;
  $('impSkip').value = '1'; $('impSkip').dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(180); $('impCancel').click(); await sleep(800);
  const afterCancel = { hidden: $('importModal').hidden, count: CatApp.state.samples.length, state: $('impStatus').dataset.state };
  upload('10,1\\n11,2\\n12,3\\n', 'after-cancel.csv');
  const state = await waitImport();
  return { before, afterCancel, state, engine: $('impStatus').dataset.engine, summary: $('impSummary').textContent };
})()`);
ok(result.afterCancel.hidden && result.afterCancel.count === result.before && result.afterCancel.state === 'idle', 'WK4 取消终止在途解析且不产生样品或陈旧结果', result.afterCancel);
ok(result.state === 'ready' && result.engine === 'worker' && result.summary.includes('有效数据点 3'), 'WK5 取消后可立即重新导入，Worker 正常重建', result);
await ev(ws, `document.getElementById('impCancel').click()`);

result = await ev(ws, `(async () => { ${HELP}
  window.Worker = function () { throw new Error('Worker disabled for fallback test'); };
  upload('20,5\\n21,6\\n22,7\\n', 'fallback.csv');
  const state = await waitImport();
  const out = { state, engine: $('impStatus').dataset.engine, summary: $('impSummary').textContent, disabled: $('impConfirm').disabled };
  window.Worker = window.__nativeWorker;
  return out;
})()`);
ok(result.state === 'ready' && result.engine === 'main' && result.summary.includes('有效数据点 3') && !result.disabled, 'WK6 Worker 不可用时导入自动回退主线程并给出提示', result);
await ev(ws, `document.getElementById('impCancel').click()`);

await ev(ws, 'location.reload(); true');
await sleep(1500);
const SAMPLES = `(() => {
  const Core = window.CatFitCore;
  function grid(a, b, step) { const x = []; for (let v = a; v <= b + 1e-9; v += step) x.push(+v.toFixed(5)); return x; }
  function synth(x, peaks, seed) { let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; const mid = (x[0] + x[x.length - 1]) / 2, half = (x[x.length - 1] - x[0]) / 2; const st = { peaks, shape: 'pseudoVoigt', bgModel: 'linear', bgCoeffs: [40, 20], anchors: null, mid, half }; return x.map(v => Core.modelY(v, st) + (rnd() + rnd() + rnd() - 1.5) * 25); }
  const samples = [];
  for (let i = 0; i < 6; i++) { const x = grid(28, 33, 0.00125), y = synth(x, [{ c: 30 + 0.12 * i, w: 0.2 + 0.02 * i, h: 1000, sp: 0.5 }], 100 + i); samples.push({ id: 'w' + i, name: 'Worker-' + i, color: '#2563eb', lineWidth: 1.5, visible: true, offset: 0, normalize: false, source: 'sim', note: '', raw: { x, y }, working: { x, y: y.slice() }, importMeta: null, bg: { mode: 'none', iterations: 24, points: [], applied: false, preview: true }, peaks: { params: { smooth: 9, noiseK: 3, minHeight: null, minProm: 0, minDist: 0.15, lo: null, hi: null }, list: [], basisKey: null, sigma: null } }); }
  CatApp.state.samples = samples; CatApp.state.selectedId = samples[0].id; CatApp.renderAll();
})()`;
result = await ev(ws, `(async () => { ${HELP} ${SAMPLES}
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(150);
  $('btnBatchSelAll').click(); $('batchRMin').value = '28'; $('batchRMax').value = '33'; $('batchMinHeight').value = '100'; $('batchMinDist').value = '0.3'; $('batchTol').value = '1';
  $('btnBatchRun').click();
  const deadline = Date.now() + 30000; while (CatBatchUI.ui.running && $('batchProgressBar').style.width === '0%' && Date.now() < deadline) await sleep(20);
  $('btnBatchCancel').click();
  while (CatBatchUI.ui.running && Date.now() < deadline) await sleep(50);
  const rs = CatBatchUI.ui.results;
  return { engine: $('batchStatus').dataset.engine, starts: window.__workerStarts.slice(), n: rs.length, ok: rs.filter(r => r.ok).length, skipped: rs.filter(r => r.skipped).length, status: $('batchStatus').textContent };
})()`);
ok(result.engine === 'worker' && result.starts.some(url => url.includes('batchworker.js')), 'WK7 批量拟合实际由 batch Worker 执行', result);
ok(result.n === 6 && result.ok > 0 && result.skipped > 0 && result.status.includes('已取消'), 'WK8 批量取消保留已完成结果并标记其余样品跳过', result);

await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `window.Worker = function () { throw new Error('Worker disabled for batch fallback test'); };` });
await ev(ws, 'location.reload(); true');
await sleep(1500);
result = await ev(ws, `(async () => { ${HELP} ${SAMPLES}
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(150);
  $('btnBatchSelNone').click(); document.querySelector('[data-bsel]').click();
  $('batchRMin').value = '28'; $('batchRMax').value = '33'; $('batchMinHeight').value = '100'; $('batchMinDist').value = '0.3';
  $('btnBatchRun').click(); const deadline = Date.now() + 30000; while (CatBatchUI.ui.running && Date.now() < deadline) await sleep(50);
  const rs = CatBatchUI.ui.results;
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(100);
  $('fitRMin').value = '28'; $('fitRMax').value = '33'; $('btnFitAddRegion').click(); await sleep(100);
  const region = CatApp.state.fit.regions[0];
  region.peaks = [{ c: 30, w: 0.2, h: 1000, sp: 0.5, locks: {} }];
  region.bg.coeffs = [40, 20];
  $('btnFitRun').click();
  const fitDeadline = Date.now() + 30000; while (CatFitUI.ui.running && Date.now() < fitDeadline) await sleep(50);
  const fitOk = !!(CatApp.state.fit.regions[0] && CatApp.state.fit.regions[0].result);
  return { engine: $('batchStatus').dataset.engine, n: rs.length, ok: rs.filter(r => r.ok).length, status: $('batchStatus').textContent, fitOk, fitMain: CatFitUI.ui.workerDisabled && !CatFitUI.ui.worker, fitStatus: $('fitStatus').textContent, fitReason: CatApp.state.fit.regions[0] && CatApp.state.fit.regions[0].result && CatApp.state.fit.regions[0].result.reason };
})()`);
ok(result.engine === 'main' && result.n === 1 && result.ok === 1, 'WK9 批量 Worker 不可用时自动回退主线程且结果正确', result);
ok(result.fitOk && result.fitMain, 'WK9b 峰拟合 Worker 不可用时同样可回退主线程', result);

ok(consoleErrors.length === 0, 'WK10 全程零控制台错误', consoleErrors.slice(0, 3));
console.log('== Worker 与大文件验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
