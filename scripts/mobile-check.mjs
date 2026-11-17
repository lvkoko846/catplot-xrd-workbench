/* 移动端 390×844 检查（公开版，静态 4173）：主图/示例抽屉/拟合页无横向溢出、零控制台错误。
   输出 scripts/shots/mobile-390.png / mobile-390-drawer.png / mobile-390-fit.png
   用法：node scripts/mobile-check.mjs（需 node scripts/preview.mjs 常驻 4173） */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const profile = mkdtempSync(join(tmpdir(), 'catplot-mobile-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=390,844', '--user-data-dir=' + profile, 'http://127.0.0.1:4173/'], { stdio: 'ignore' });
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
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(1800);
const probe = `(() => { const bad=[...document.querySelectorAll("body *")].map(el=>({t:el.tagName+"."+String(el.className).slice(0,40),r:Math.round(el.getBoundingClientRect().right)})).filter(o=>o.r>391).slice(0,12); return {bad, iw:innerWidth, sw:document.documentElement.scrollWidth}; })()`;
let r = await ev(ws, probe);
console.log('MAIN', JSON.stringify(r));
const shot1 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shots/mobile-390.png', import.meta.url), Buffer.from(shot1.data, 'base64'));
const mainBad = r.sw > 390;
r = await ev(ws, `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('btnCards').click(); await sleep(400); for (let i = 0; i < 40; i++) { if (document.querySelectorAll('#exList .ex-row').length) break; await sleep(100); } return { rows: document.querySelectorAll('#exList .ex-row').length }; })()`);
const drawerRows = r.rows;
r = await ev(ws, probe);
console.log('DRAWER', JSON.stringify(r));
const shot2 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shots/mobile-390-drawer.png', import.meta.url), Buffer.from(shot2.data, 'base64'));
const drawerBad = r.sw > 390;
r = await ev(ws, `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('cardsClose').click(); await sleep(200); document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(300); document.getElementById('fitRMin').value='24.4'; document.getElementById('fitRMax').value='26.3'; document.getElementById('btnFitAddRegion').click(); await sleep(200); document.getElementById('btnFitInitPeaks').click(); await sleep(300); const t0=Date.now(); document.getElementById('btnFitRun').click(); while (CatFitUI.ui.finishedAt <= t0 && Date.now()-t0 < 15000) await sleep(60); await sleep(300); document.getElementById('fitChart').scrollIntoView({block:'center'}); await sleep(200); return { fitOk: !!(CatApp.state.fit.regions[0] && CatApp.state.fit.regions[0].result) }; })()`);
const fitOk = r.fitOk;
r = await ev(ws, probe);
console.log('FIT', JSON.stringify({ ...r, fitOk }));
const shot3 = await send(ws, 'Page.captureScreenshot', { format: 'png' });
writeFileSync(new URL('./shots/mobile-390-fit.png', import.meta.url), Buffer.from(shot3.data, 'base64'));
const fitBad = r.sw > 390;
console.log('consoleErrors', consoleErrors.length, consoleErrors.slice(0, 3));
console.log('RESULT', JSON.stringify({ mainBad, drawerBad, fitBad, drawerRows, fitOk, consoleErrors: consoleErrors.length }));
ws.close(); chrome.kill();
process.exit(mainBad || drawerBad || fitBad || consoleErrors.length || drawerRows !== 3 || !fitOk ? 1 : 0);