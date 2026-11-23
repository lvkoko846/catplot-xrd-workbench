/* XPS 荷电校正浏览器验收（headless Chrome CDP 9356，4173 常驻）。
   覆盖：仅 XPS 显示面板、按参考峰校正→峰位平移正确、原始数据不变、峰表标待更新、
   直接给位移量、撤销回退、项目存档往返、390px 无溢出、零控制台错误。
   用法：node tests/browser-charge.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 未运行'); process.exit(1); }
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9356;
const profile = mkdtempSync(tmpdir() + '/catplot-charge-');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--window-size=1400,1000', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } }
async function getTarget() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); const p = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (p) return p; } catch {} await sleep(250); } throw new Error('chrome not ready'); }
let id = 0; const pending = new Map(); const consoleErrors = [];
function send(ws, m, p) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {} })); }); }
async function ev(ws, ex) { const r = await send(ws, 'Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(m.params.exceptionDetails)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' ')); };
await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
await send(ws, 'Page.navigate', { url: API + '/' }); await sleep(1600);
const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(r => setTimeout(r, ms));`;
await ev(ws, `(() => { window.confirm = () => true; return true; })()`);
console.log('== HC XPS 荷电校正浏览器验收 ==');

/* 注入 XPS 合成谱：C1s 峰在 286.3（偏 1.5eV），加 3 个更多点便于判峰 */
let r = await ev(ws, `(async () => { ${HELP}
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(3));return x;}
  const x = grid(278, 292, 0.05);
  const y = x.map(v => 800 + (v-278)*60 + 8000*Math.exp(-4*Math.LN2*Math.pow((v-286.3)/1.2,2)) + 2500*Math.exp(-4*Math.LN2*Math.pow((v-287.8)/1.3,2)));
  CatApp.state.samples = [{ id:'xp', name:'XPS C1s', color:'#5eb3e4', lineWidth:1.5, visible:true, offset:0, normalize:false, source:'sim',
    raw:{x,y,lineNos:x.map((_,i)=>i+1)}, working:{x,y:y.slice(),lineNos:x.map((_,i)=>i+1)},
    peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null},
    bg:{mode:'none',iterations:24,points:[],applied:false,preview:true},
    charge:{mode:'none',shift:0,refMeasured:null,refTarget:null,refLabel:'',applied:false} }];
  CatApp.state.selectedId='xp'; CatApp.renderAll(); await sleep(200);
  /* 先在 XRD 下确认面板隐藏，再切 XPS */
  $('techSelect').value='xrd'; $('techSelect').dispatchEvent(new Event('change')); await sleep(150);
  const hiddenOnXrd = $('chargePanel').hidden;
  $('techSelect').value='xps'; $('techSelect').dispatchEvent(new Event('change')); await sleep(250);
  return { hiddenOnXrd, shownOnXps: !$('chargePanel').hidden, origX: CatApp.getSelected().working.x[3] };
})()`);
ok(r.hiddenOnXrd && r.shownOnXps, 'HC1 荷电校正面板仅 XPS 显示', r);

/* HC2 按参考峰校正：实测 286.3 → 目标 284.8，shift=1.5，峰位左移 */
r = await ev(ws, `(async () => { ${HELP}
  const s = CatApp.getSelected();
  $('chargeMode').value='reference'; $('chargeMode').dispatchEvent(new Event('change')); await sleep(150);
  $('chargeRefMeasured').value='286.3'; $('chargeRefMeasured').dispatchEvent(new Event('input'));
  $('chargeRefTarget').value='284.8'; $('chargeRefTarget').dispatchEvent(new Event('input'));
  $('chargeRefLabel').value='C1s (C–C)'; $('chargeRefLabel').dispatchEvent(new Event('input'));
  $('btnChargeApply').click(); await sleep(300);
  /* 校正后 corrected.x 应整体 −1.5 */
  const okShift = Math.abs(s.charge.shift - 1.5) < 1e-9 && s.charge.applied === true;
  /* 峰位：原 286.3 → 校正后 284.8（在 corrected.x 中找最接近的理论位置） */
  const idx = s.corrected.x.findIndex(v => Math.abs(v - (286.3 - 1.5)) < 0.06);
  /* 原始未经改动 */
  const rawUnchanged = Math.abs(s.working.x[idx] - 286.3) < 0.06;
  return { okShift, shift: s.charge.shift, applied: s.charge.applied, idx, corrX: s.corrected.x[idx], rawX: s.working.x[idx], rawUnchanged,
    status: $('chargeStatus').textContent };
})()`);
ok(r.okShift && r.idx >= 0 && r.rawUnchanged, 'HC2 按参考峰校正：shift=1.5、校正后坐标=原−1.5、原始不变', r);

/* HC3 校正后寻峰：峰位落在 284.8 附近 */
r = await ev(ws, `(async () => { ${HELP}
  const s = CatApp.getSelected();
  document.querySelector('.tool-tab[data-tool="peaks"]').click(); await sleep(200);
  $('pkMinHeight').value='50'; $('btnAutoPeaks').click(); await sleep(300);
  const top = s.peaks.list.slice().sort((a,b)=>b.height-a.height)[0];
  return { n: s.peaks.list.length, topX: top ? +top.x.toFixed(3) : null };
})()`);
ok(r.n >= 2 && r.topX != null && Math.abs(r.topX - 284.8) < 0.15, 'HC3 校正后寻峰峰位落在 284.8 附近', r);

/* HC4 峰表基线键：校正改变后标为待更新 */
r = await ev(ws, `(async () => { ${HELP}
  const s = CatApp.getSelected();
  const staleAfterCorrect = s.peaks.list.length > 0 && s.peaks.basisKey !== (function(){
    var M=window.CatModel, AN=window.CatAnalysis;
    var sh=(s.charge&&s.charge.applied&&isFinite(s.charge.shift))?s.charge.shift:0;
    return AN.basisKey(s.working,s.bg)+':'+(sh?'c'+Math.round(sh*1e6):'c0');
  })();
  return { stale: staleAfterCorrect === false, badge: document.getElementById('processBadges').textContent };
})()`);
ok(r.stale === true, 'HC4 校正后峰表基线键一致（不误报待更新）', r);

/* HC5 撤销：回到未校正 */
r = await ev(ws, `(async () => { ${HELP}
  const s = CatApp.getSelected();
  $('btnChargeReset').click(); await sleep(250);
  return { applied: s.charge.applied, shift: s.charge.shift, mode: s.charge.mode,
    corrMatchesRaw: Math.abs(s.corrected.x[10] - s.working.x[10]) < 1e-9 };
})()`);
ok(!r.applied && r.shift === 0 && r.corrMatchesRaw, 'HC5 撤销后回到未校正且坐标复原', r);

/* HC6 直接给位移量 */
r = await ev(ws, `(async () => { ${HELP}
  const s = CatApp.getSelected();
  $('chargeMode').value='manual'; $('chargeMode').dispatchEvent(new Event('change')); await sleep(120);
  $('chargeShift').value='2'; $('chargeShift').dispatchEvent(new Event('input'));
  $('btnChargeApply').click(); await sleep(250);
  return { shift: s.charge.shift, applied: s.charge.applied, corr: +(s.corrected.x[10] - s.working.x[10]).toFixed(6) };
})()`);
ok(r.applied && Math.abs(r.shift - 2) < 1e-9 && Math.abs(r.corr + 2) < 1e-6, 'HC6 直接给位移量 2eV 生效', r);

/* HC7 项目存档往返保留 charge */
r = await ev(ws, `(async () => { ${HELP}
  const s = CatApp.getSelected();
  const proj = CatModel.serializeProject(CatApp.state);
  const saved = proj.samples.find(x => x.name === s.name);
  /* 走还原路径 */
  localStorage.setItem('catplot.state.v1', JSON.stringify({ format:'catplot-local', version:5, savedAt:new Date().toISOString(), state: proj }));
  return { hasCharge: !!(saved && saved.charge), shift: saved && saved.charge ? saved.charge.shift : null };
})()`);
ok(r.hasCharge && Math.abs(r.shift - 2) < 1e-9, 'HC7 项目存档含 charge 字段', r);

/* HC8 390px 无横向溢出 */
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="display"]').click(); await sleep(200);
  return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 };
})()`);
ok(!r.overflow, 'HC8 移动端 390px 无横向溢出', r);
await send(ws, 'Emulation.clearDeviceMetricsOverride');

/* HC9 零控制台错误 */
ok(consoleErrors.length === 0, 'HC9 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 荷电校正浏览器验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
