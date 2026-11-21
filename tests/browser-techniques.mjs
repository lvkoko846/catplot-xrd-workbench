/* 多表征通用引擎验收（headless Chrome CDP 9342，4173 常驻）。
   覆盖：表征切换轴标签；非XRD隐藏物相匹配/卡片/d列/Scherrer/d-D指标；拉曼寻峰+拟合+批量趋势通用可用；切回XRD恢复。
   用法：node tests/browser-techniques.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 未运行'); process.exit(1); }
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9342;
const profile = mkdtempSync(tmpdir() + '/catplot-tech-');
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
console.log('== TC 多表征通用引擎验收 ==');

/* TC1 默认 XRD：match 可见、轴 2θ */
let r = await ev(ws, `(async () => { ${HELP}
  await sleep(300);
  return { tech: CatApp.state.technique, matchHidden: document.querySelector('.tool-tab[data-tool="match"]').hidden, x2t: $('chart').innerHTML.includes('2θ (°)') };
})()`);
ok(r.tech === 'xrd' && !r.matchHidden && r.x2t, 'TC1 默认XRD：match可见+2θ轴', r);

/* TC2 切换拉曼：轴 cm⁻¹、match/卡片/d列 隐藏 */
r = await ev(ws, `(async () => { ${HELP}
  $('techSelect').value = 'raman'; $('techSelect').dispatchEvent(new Event('change')); await sleep(300);
  const svg = $('chart').innerHTML;
  return { tech: CatApp.state.technique, xRaman: svg.includes('拉曼位移 (cm⁻¹)'), no2t: !svg.includes('2θ (°)'),
    matchHidden: document.querySelector('.tool-tab[data-tool="match"]').hidden, cardsHidden: $('btnCards').hidden,
    dThHidden: document.querySelector('#peakTable th:nth-child(3)').hidden };
})()`);
ok(r.tech === 'raman' && r.xRaman && r.no2t && r.matchHidden && r.cardsHidden && r.dThHidden, 'TC2 拉曼：cm⁻¹轴+隐藏match/卡片/d列', r);

/* TC3 拉曼寻峰+拟合通用可用（合成拉曼峰） */
r = await ev(ws, `(async () => { ${HELP}
  const Core = window.CatFitCore;
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(4));return x;}
  const x = grid(100, 1800, 1);
  const y = x.map(v => 500*Math.exp(-4*Math.LN2*Math.pow((v-520)/12,2)) + 300*Math.exp(-4*Math.LN2*Math.pow((v-1350)/15,2)) + 20);
  CatApp.state.samples = [{ id:'rm', name:'拉曼样品', color:'#2563eb', lineWidth:1.5, visible:true, offset:0, normalize:false, source:'sim', raw:{x,y,lineNos:x.map((_,i)=>i+1)}, working:{x,y:y.slice(),lineNos:x.map((_,i)=>i+1)}, peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:5,lo:null,hi:null},list:[],basisKey:null,sigma:null}, bg:{mode:'none',iterations:24,points:[],applied:false,preview:true} }];
  CatApp.state.selectedId='rm'; CatApp.renderAll(); await sleep(200);
  const s = CatApp.getSelected();
  const pr = CatAnalysis.findPeaks(s.working.x, s.working.y, { smooth:9, noiseK:3, minHeight:50, minDist:5 });
  s.peaks.list = pr.peaks.map((p,i)=>({id:'p'+i,x:p.x,height:p.height,source:'auto',index:p.i}));
  CatApp.renderAll(); await sleep(200);
  /* 拟合 */
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(200);
  $('fitRMin').value='480'; $('fitRMax').value='560'; $('btnFitAddRegion').click(); await sleep(150);
  $('btnFitInitPeaks').click(); await sleep(250); $('btnFitRun').click();
  const t0=Date.now(); while(CatFitUI.ui.running && Date.now()-t0<15000) await sleep(60); await sleep(200);
  const rg = CatApp.state.fit.regions[0];
  const schNote = $('fitScherrerTable').textContent;
  return { nPeaks: pr.peaks.length, fitOk: !!(rg.result && rg.result.ok!==false), c: rg.result&&+rg.result.params[0].c.toFixed(1), schGated: schNote.includes('XRD 专属') };
})()`);
ok(r.nPeaks >= 2 && r.fitOk && Math.abs(r.c - 520) < 3 && r.schGated, 'TC3 拉曼寻峰+拟合通用+Scherrer门控', r);

/* TC4 拉曼批量趋势通用（d/D 指标隐藏） */
r = await ev(ws, `(async () => { ${HELP}
  const Core = window.CatFitCore;
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(4));return x;}
  const ss=[];
  for(let i=0;i<4;i++){const c=520+5*i;const x=grid(400,700,1);const y=x.map(v=>500*Math.exp(-4*Math.LN2*Math.pow((v-c)/12,2))+20);
    ss.push({id:'r'+i,name:'拉曼'+i,color:['#2563eb','#e11d48','#059669','#d97706'][i],lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',raw:{x,y,lineNos:x.map((_,k)=>k+1)},working:{x,y:y.slice(),lineNos:x.map((_,k)=>k+1)},peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:5,lo:null,hi:null},list:[],basisKey:null,sigma:null},bg:{mode:'none',iterations:24,points:[],applied:false,preview:true}});}
  CatApp.state.samples=ss; CatApp.state.selectedId=ss[0].id; CatApp.renderAll(); await sleep(200);
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(200);
  const dOptHidden = [...$('batchMetric').options].find(o=>o.value==='d').hidden;
  const DOptHidden = [...$('batchMetric').options].find(o=>o.value==='D').hidden;
  $('btnBatchSelAll').click(); await sleep(120);
  $('batchRMin').value='480'; $('batchRMax').value='580'; $('batchMinHeight').value='50'; $('batchTol').value='30';
  $('btnBatchRun').click(); const t0=Date.now(); while(CatBatchUI.ui.running && Date.now()-t0<30000) await sleep(80); await sleep(300);
  const okN = CatBatchUI.ui.results.filter(x=>x.ok).length;
  const centers = CatBatchUI.ui.results.map(x=>x.ok?+x.params[0].c.toFixed(1):null);
  return { dOptHidden, DOptHidden, okN, centers };
})()`);
ok(r.dOptHidden && r.DOptHidden && r.okN === 4 && r.centers.every((c,i)=>Math.abs(c-(520+5*i))<3), 'TC4 拉曼批量趋势通用+d/D隐藏', r);

/* TC5 切回 XRD 恢复 */
r = await ev(ws, `(async () => { ${HELP}
  $('techSelect').value='xrd'; $('techSelect').dispatchEvent(new Event('change')); await sleep(300);
  return { tech: CatApp.state.technique, matchVisible: !document.querySelector('.tool-tab[data-tool="match"]').hidden, x2t: $('chart').innerHTML.includes('2θ (°)') };
})()`);
ok(r.tech === 'xrd' && r.matchVisible && r.x2t, 'TC5 切回XRD恢复match+2θ轴', r);

/* TC6 XPS：切换自动套用 Shirley 推荐背景 + 扣除生效（背底左高右低单调） */
r = await ev(ws, `(async () => { ${HELP}
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(4));return x;}
  const x = grid(278, 292, 0.05);
  const y = x.map(v => 800 + (v - 278) * 60 + 8000*Math.exp(-4*Math.LN2*Math.pow((v-284.8)/1.2,2)) + 2500*Math.exp(-4*Math.LN2*Math.pow((v-286.3)/1.3,2)));
  CatApp.state.samples = [{ id:'xp', name:'C1s', color:'#2563eb', lineWidth:1.5, visible:true, offset:0, normalize:false, source:'sim',
    raw:{x,y,lineNos:x.map((_,i)=>i+1)}, working:{x,y:y.slice(),lineNos:x.map((_,i)=>i+1)},
    peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null},
    bg:{mode:'none',iterations:24,points:[],applied:false,preview:true} }];
  CatApp.state.selectedId='xp';
  $('techSelect').value='xps'; $('techSelect').dispatchEvent(new Event('change')); await sleep(300);
  const s = CatApp.getSelected();
  const autoMode = s.bg.mode;
  s.bg.iterations = 50; CatApp.renderAll(); await sleep(200);
  document.querySelector('.tool-tab[data-tool="bg"]').click(); await sleep(200);
  $('btnBgApply').click(); await sleep(300);
  const applied = s.bg.applied;
  const b = s.bgY || [];
  const mono = b.length ? b.every((v,i)=>i===0||v>=b[i-1]-1e-6) : false;
  return { autoMode, applied, bgLen: b.length, mono, bgLeft: b.length?+b[0].toFixed(0):null, bgRight: b.length?+b[b.length-1].toFixed(0):null };
})()`);
ok(r.autoMode === 'shirley' && r.applied && r.mono && r.bgLeft < r.bgRight, 'TC6 XPS自动套用Shirley+扣除生效（背底左低右高单调，端点贴合谱端）', r);

/* TC6b XPS 双峰拟合 + 面积比 + XPS 指南文案 */
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  $('fitRMin').value='282'; $('fitRMax').value='288'; $('btnFitAddRegion').click(); await sleep(150);
  $('btnFitInitPeaks').click(); await sleep(250);
  const rg = CatApp.state.fit.regions.find(x=>x.id===CatApp.state.fit.active);
  rg.peaks.push({ c: 286.3, w: 0.6, h: 1500, sp: 0.5, locks: {} });
  CatFitUI.refresh(); await sleep(100);
  $('btnFitRun').click();
  const t0=Date.now(); while(CatFitUI.ui.running && Date.now()-t0<15000) await sleep(60); await sleep(250);
  const res = rg.result;
  const guide = $('fitGuide').textContent;
  const ratioTxt = $('fitRatioOut').textContent;
  const ratioSel = $('fitRatioA').options.length;
  return { ok: !!(res && res.ok !== false), nPeaks: res ? res.params.length : 0,
    guideXps: guide.includes('Shirley') && guide.includes('化学态'), ratioHasVal: /面积比 A\\/B = [0-9.]+/.test(ratioTxt), ratioSel };
})()`);
ok(r.ok && r.nPeaks >= 2 && r.guideXps && r.ratioHasVal && r.ratioSel >= 2, 'TC6b XPS双峰拟合+面积比+XPS指南', r);

/* TC6c 拉曼指南含 ID/IG+荧光；红外指南含基线+官能团 */
r = await ev(ws, `(async () => { ${HELP}
  $('techSelect').value='raman'; $('techSelect').dispatchEvent(new Event('change')); await sleep(250);
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(200);
  const ramanGuide = $('fitGuide').textContent;
  $('techSelect').value='ftir'; $('techSelect').dispatchEvent(new Event('change')); await sleep(250);
  const ftirGuide = $('fitGuide').textContent;
  return { ramanOk: ramanGuide.includes('ID/IG') && ramanGuide.includes('荧光'),
    ftirOk: ftirGuide.includes('基线') && ftirGuide.includes('官能团') };
})()`);
ok(r.ramanOk && r.ftirOk, 'TC6c 拉曼指南(ID/IG+荧光背底)+红外指南(基线+官能团)', r);

/* TC7 零控制台错误 */
ok(consoleErrors.length === 0, 'TC7 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 多表征验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
