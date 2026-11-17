/* 峰拟合视觉取证（私人版 4275）：分峰+残差+峰参数表+Scherrer 警示+卡片对照。
   输出 scripts/shots/fit-desktop.png / fit-tables-desktop.png / fit-mobile.png
   用法：node scripts/capture-fit.mjs（需 4275 常驻） */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), 'catplot-fitshot-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1440,960', '--user-data-dir=' + profile, 'http://127.0.0.1:4173/'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getTarget() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); const p = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (p) return p; } catch {} await sleep(250); } throw new Error('chrome not ready'); }
let id = 0; const pending = new Map(); const consoleErrors = [];
function send(ws, method, params) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }
async function ev(ws, expression) { const r = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails)); return r.result.value; }
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(m.params.exceptionDetails)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' ')); };
await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
await sleep(1800);
const csv = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'tio2-rutile-anatase.csv'), 'utf8');
const r = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const f = new File([${JSON.stringify(csv)}], 'fit-shot.csv', { type: 'text/csv' });
  Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
  $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60; i++) { await sleep(80); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tbody tr').length > 1) break; }
  $('impConfirm').click(); await sleep(400);
  const item = [...$('sampleList').querySelectorAll('.sample-item')].find(x => x.textContent.includes('fit-shot'));
  item.click(); await sleep(250);
  $('btnCards').click(); await sleep(150);
  $('stickLambdaPreset').value = '1.5406'; $('stickLambdaPreset').dispatchEvent(new Event('change', { bubbles: true }));
  $('btnLambdaConfirm').click(); await sleep(200); $('cardsClose').click(); await sleep(120);
  await CatCardsUI.previewRemoteUid('COD-1010942'); await sleep(400);
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  $('fitRMin').value = '24.4'; $('fitRMax').value = '28.3'; $('btnFitAddRegion').click(); await sleep(200);
  $('fitMinHeight').value = '80'; $('btnFitInitPeaks').click(); await sleep(300);
  const t0 = Date.now(); $('btnFitRun').click();
  while (CatFitUI.ui.finishedAt <= t0 && Date.now() - t0 < 20000) await sleep(60);
  await sleep(400);
  const rg = CatApp.state.fit.regions[0];
  $('fitChart').scrollIntoView({ block: 'center' }); await sleep(250);
  return {
    peaks: rg.peaks.length, ok: !!rg.result, rwp: rg.result && +rg.result.quality.rwp.toFixed(4),
    warn: !$('fitScherrerWarn').hidden, cardRows: $('fitCardTable').querySelectorAll('tbody tr').length,
    paramRows: $('fitParamTable').querySelectorAll('tbody tr').length,
    hScroll: document.documentElement.scrollWidth > innerWidth
  };
})()`);
console.log('FIT', JSON.stringify(r));
const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shots/fit-desktop.png', import.meta.url), Buffer.from(shot.data, 'base64'));
await ev(ws, `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('fitScherrerTable').scrollIntoView({ block: 'center' }); await sleep(250); return true; })()`);
const shot2 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shots/fit-tables-desktop.png', import.meta.url), Buffer.from(shot2.data, 'base64'));
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(500);
const m = await ev(ws, `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('fitChart').scrollIntoView({ block: 'center' }); await sleep(250); return { hScroll: document.documentElement.scrollWidth > innerWidth }; })()`);
console.log('MOBILE', JSON.stringify(m));
const shot3 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shots/fit-mobile.png', import.meta.url), Buffer.from(shot3.data, 'base64'));
console.log('consoleErrors', consoleErrors.length, consoleErrors.slice(0, 3));
ws.close(); chrome.kill();
process.exit(r.ok && r.warn && r.cardRows >= 1 && r.paramRows >= 2 && !r.hScroll && !m.hScroll && !consoleErrors.length ? 0 : 1);