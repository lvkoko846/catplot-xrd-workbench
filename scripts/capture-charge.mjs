/* XPS 荷电校正视觉取证：注入 C1s 谱（286.3 偏移）→ 按参考峰校正到 284.8 → 截图。
   输出 scripts/shots/xps-charge-before.png / xps-charge-after.png
   用法：node scripts/capture-charge.mjs（需 4173 常驻） */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9358;
const profile = mkdtempSync(join(tmpdir(), 'catplot-chargeshot-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1440,1000', '--user-data-dir=' + profile, 'http://127.0.0.1:4173/'], { stdio: 'ignore' });
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
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
await sleep(1800);
async function shot(name) { const r = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(ROOT, 'scripts', 'shots', name), Buffer.from(r.data, 'base64')); }

/* 注入 XPS C1s 谱（主峰 286.3，偏移 +1.5 eV）并切到 XPS */
let r = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(3));return x;}
  const x = grid(278, 292, 0.05);
  const y = x.map(v => 800 + (v-278)*60 + 8000*Math.exp(-4*Math.LN2*Math.pow((v-286.3)/1.2,2)) + 2500*Math.exp(-4*Math.LN2*Math.pow((v-287.8)/1.3,2)));
  CatApp.state.samples = [{ id:'xps1', name:'催化剂 A（XPS C1s）', color:'#4a90c4', lineWidth:1.5, visible:true, offset:0, normalize:false, source:'sim',
    raw:{x,y,lineNos:x.map((_,i)=>i+1)}, working:{x,y:y.slice(),lineNos:x.map((_,i)=>i+1)},
    peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null},
    bg:{mode:'none',iterations:24,points:[],applied:false,preview:true},
    charge:{mode:'none',shift:0,refMeasured:null,refTarget:null,refLabel:'',applied:false} }];
  CatApp.state.selectedId='xps1';
  $('techSelect').value='xps'; $('techSelect').dispatchEvent(new Event('change')); await sleep(300);
  document.querySelector('.tool-tab[data-tool="display"]').click(); await sleep(200);
  return { panel: !$('chargePanel').hidden };
})()`);
if (!r.panel) { console.error('荷电校正面板未显示'); process.exit(1); }
await shot('xps-charge-before.png');

/* 按参考峰校正：286.3 → 284.8（Δ=1.5 eV） */
r = await ev(ws, `(async () => {
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  $('chargeMode').value='reference'; $('chargeMode').dispatchEvent(new Event('change')); await sleep(150);
  $('chargeRefMeasured').value='286.3'; $('chargeRefMeasured').dispatchEvent(new Event('input'));
  $('chargeRefTarget').value='284.8'; $('chargeRefTarget').dispatchEvent(new Event('input'));
  $('chargeRefLabel').value='C1s (C–C/C–H)'; $('chargeRefLabel').dispatchEvent(new Event('input'));
  $('btnChargeApply').click(); await sleep(500);
  const s = CatApp.getSelected();
  return { shift: s.charge.shift, applied: s.charge.applied, status: $('chargeStatus').textContent };
})()`);
console.log('校正结果:', JSON.stringify(r));
await shot('xps-charge-after.png');
console.log('控制台错误:', consoleErrors.length);
ws.close(); chrome.kill();
process.exit(consoleErrors.length ? 1 : 0);
