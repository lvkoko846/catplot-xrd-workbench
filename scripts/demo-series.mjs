/* 公开真实 XRD 系列全功能演示 + 取证（scripts/demo-series.mjs，headless Chrome CDP 9340，4173 常驻）。
   数据：XRED（MIT）3 组真实双相 TiO2 实验谱（不同样品/配比），非模拟。
   流程：上传3样品→对比图→单样品拟合→系列批量+趋势→真实谱匹配闭环→一键组会报告。
   产出：scripts/shots/demo-*.png + scripts/shots/demo-report.html + 控制台实测摘要。
   用法：node scripts/demo-series.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:4173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9340;
const profile = mkdtempSync(join(tmpdir(), 'catplot-demo-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1400,1000', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getTarget() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); const p = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (p) return p; } catch {} await sleep(250); } throw new Error('chrome not ready'); }
let id = 0; const pending = new Map();
function send(ws, m, p) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {} })); }); }
async function ev(ws, ex) { const r = await send(ws, 'Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function shot(ws, name) { const s = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(ROOT, 'scripts', 'shots', name), Buffer.from(s.data, 'base64')); console.log('shot', name); }
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
await send(ws, 'Page.navigate', { url: API + '/' }); await sleep(1600);
const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(r => setTimeout(r, ms));`;
await ev(ws, `(() => { window.__blobs = {}; const ob = URL.createObjectURL; URL.createObjectURL = function (b) { if (b && b.type && b.type.includes('html')) b.text().then(t => { window.__blobs['report'] = t; }); return ob.apply(this, arguments); }; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return oc.apply(this); }; window.confirm = () => true; return true; })()`);

const files = [
  ['tio2-rutile-anatase.csv', 'XRED 双相样品1'],
  ['series/Ti-alpha-beta.csv', 'XRED 双相样品2'],
  ['series/Ti2448-alpha-beta.csv', 'XRED 双相样品3']
];
/* 上传 3 真实样品 */
for (const [rel, name] of files) {
  const csv = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', rel), 'utf8');
  await ev(ws, `(async () => { ${HELP}
    const f = new File([${JSON.stringify(csv)}], ${JSON.stringify(name + '.csv')}, { type: 'text/csv' });
    Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 60; i++) { await sleep(80); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tbody tr').length > 1) break; }
    $('impConfirm').click(); await sleep(300); return true; })()`);
}
/* 清除首启自动加载的模拟样品，仅保留 3 个真实 XRD 样品；设波长 + 选真实样品1 + 寻峰 */
let r = await ev(ws, `(async () => { ${HELP}
  CatApp.state.samples = CatApp.state.samples.filter(s => s.source === 'file');
  CatApp.state.lib.wavelength = 1.5406;
  const s0 = CatApp.state.samples[0]; CatApp.state.selectedId = s0.id;
  s0.peaks.params.minHeight = 50; s0.peaks.params.smooth = 9; s0.peaks.params.minDist = 0.3;
  const pr = CatAnalysis.findPeaks(s0.working.x, s0.working.y, s0.peaks.params);
  s0.peaks.list = pr.peaks.map((p, i) => ({ id: 'p' + i, x: p.x, height: p.height, source: 'auto', index: p.i }));
  CatApp.renderAll(); await sleep(300);
  return { samples: CatApp.state.samples.length, peaks: s0.peaks.list.length };
})()`);
console.log('上传真实样品', r.samples, '样品1寻峰', r.peaks);
await shot(ws, 'demo-compare.png');

/* 上传参考卡片（锐钛矿/金红石 PDF 峰表）→ 堆叠+底部棒图轨道（出版风格，对照用户论文图） */
const pdfCard = readFileSync('F:/XRD/PDF#82-1043.txt', 'utf8');
const cardTxt2 = '# name=Rutile TiO2\n# formula=TiO2\n# card=PDF#21-1276\n# wavelength=1.5406\n27.45,100,110\n36.09,50,101\n41.25,25,111\n54.32,60,211\n56.64,20,220\n62.74,15,002\n69.01,20,301\n';
r = await ev(ws, `(async () => { ${HELP}
  $('btnCards').click(); await sleep(200);
  const f1 = new File([${JSON.stringify(pdfCard)}], 'PDF#82-1043.txt', { type: 'text/plain' });
  const f2 = new File([${JSON.stringify(cardTxt2)}], 'rutile.txt', { type: 'text/plain' });
  Object.defineProperty($('cardUpload'), 'files', { value: [f1, f2], configurable: true });
  $('cardUpload').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(700); $('cardsClose').click(); await sleep(200);
  return { sticks: CatCards.rt.sticks.length, stack: $('chart')._meta.stack, labels: CatCards.rt.sticks.map(s=>s.label) };
})()`);
console.log('堆叠+上传卡片轨道', JSON.stringify(r));
await shot(ws, 'demo-stack-cards.png');

/* 单样品拟合（样品1 锐钛矿主峰） */
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(200);
  $('fitRMin').value = '24.4'; $('fitRMax').value = '26.3'; $('btnFitAddRegion').click(); await sleep(150);
  $('btnFitInitPeaks').click(); await sleep(250); $('btnFitRun').click();
  const t0 = Date.now(); while (CatFitUI.ui.running && Date.now() - t0 < 15000) await sleep(60); await sleep(200);
  const rg = CatApp.state.fit.regions[0];
  return { ok: !!(rg.result && rg.result.ok !== false), c: rg.result && +rg.result.params[0].c.toFixed(3), rwp: rg.result && +rg.result.quality.rwp.toFixed(4) };
})()`);
console.log('单样品拟合', JSON.stringify(r));
await shot(ws, 'demo-fit.png');

/* 系列批量 + 趋势（3 真实样品，锐钛矿(101) 区间） */
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(200);
  $('btnBatchSelAll').click(); await sleep(150);
  $('batchRMin').value = '24'; $('batchRMax').value = '27'; $('batchMinHeight').value = '50'; $('batchTol').value = '1.0';
  $('btnBatchRun').click(); const t0 = Date.now(); while (CatBatchUI.ui.running && Date.now() - t0 < 30000) await sleep(80); await sleep(300);
  const rs = CatBatchUI.ui.results;
  $('batchMetric').value = 'c'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(200);
  return { okN: rs.filter(x => x.ok).length, centers: rs.map(x => x.ok ? +x.params[0].c.toFixed(3) : null), fwhm: rs.map(x => x.ok ? +x.params[0].w.toFixed(3) : null) };
})()`);
console.log('系列批量(真实trio·警示态)', JSON.stringify(r));
await shot(ws, 'demo-trend-real-warn.png');

/* 真实谱匹配闭环（样品1） */
r = await ev(ws, `(async () => { ${HELP}
  CatApp.state.selectedId = CatApp.state.samples[0].id; CatApp.renderAll(); await sleep(150);
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(200);
  $('btnMatchExample').click(); await sleep(150); $('btnMatchRun').click(); await sleep(250);
  const ia = CatMatchUI.ui.last.candidates.findIndex(x => x.name === '锐钛矿');
  $('matchCandTable').querySelector('[data-mconfirm="' + ia + '"]').click(); await sleep(200);
  $('btnMatchRemaining').click(); await sleep(250);
  const ir = CatMatchUI.ui.last.candidates.findIndex(x => x.name === '金红石');
  const top = CatMatchUI.ui.last.candidates[0];
  if (ir >= 0) $('matchCandTable').querySelector('[data-mconfirm="' + ir + '"]').click(); await sleep(200);
  return { phases: CatMatchUI.ui.phases.map(p => p.name), contTop: top.name, cov: $('matchCoverage').textContent };
})()`);
console.log('真实谱匹配闭环', JSON.stringify(r));
await shot(ws, 'demo-match.png');

/* 模拟 8 样品梯度系列（明确标注"模拟"）：展示批量趋势的真实用途——峰位随组分线性偏移、FWHM 增大、晶粒尺寸减小 */
r = await ev(ws, `(async () => { ${HELP}
  const Core = window.CatFitCore;
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(4));return x;}
  function synth(x,peaks,seed){let s=seed;const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;const mid=(x[0]+x[x.length-1])/2,half=(x[x.length-1]-x[0])/2;const st={peaks,shape:'pseudoVoigt',bgModel:'linear',bgCoeffs:[40,20],anchors:null,mid,half};return x.map(v=>Core.modelY(v,st)+(rnd()+rnd()+rnd()-1.5)*25);}
  const ss=[];
  for(let i=0;i<8;i++){const c=30+0.15*i,w=0.18+0.03*i,c2=32+0.1*i,w2=0.2+0.02*i;const x=grid(28,33.8,0.01);const y=synth(x,[{c,w,h:1000,sp:0.5},{c:c2,w:w2,h:600,sp:0.5}],100+i);
    ss.push({id:'sim'+i,name:'模拟 x='+ (i*0.1).toFixed(1),color:['#2563eb','#e11d48','#059669','#d97706','#7c3aed','#0891b2','#db2777','#65a30d'][i],lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',note:'',raw:{x,y},working:{x,y:y.slice()},importMeta:null,bg:{mode:'none',iterations:24,points:[],applied:false,preview:true},peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null}});}
  CatApp.state.samples=ss; CatApp.state.selectedId=ss[0].id; CatApp.renderAll(); await sleep(200);
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(200);
  CatBatchUI.ui.selected={}; $('btnBatchSelAll').click(); await sleep(150);
  $('batchRMin').value='28'; $('batchRMax').value='33.8'; $('batchMinHeight').value='100'; $('batchMinDist').value='0.3'; $('batchTol').value='1.5';
  $('batchXMode').value='value'; $('batchXMode').dispatchEvent(new Event('change')); await sleep(150);
  /* 组分值逐样品填写 */
  ss.forEach((s,i)=>{ const inp=[...document.querySelectorAll('[data-bxval]')].find(e=>e.getAttribute('data-bxval')===s.id); if(inp){ inp.value=String(i*0.1); inp.dispatchEvent(new Event('input')); } });
  $('btnBatchRun').click(); const t0=Date.now(); while(CatBatchUI.ui.running && Date.now()-t0<30000) await sleep(80); await sleep(300);
  $('batchMetric').value='c'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(150);
  $('batchRel').checked=true; $('batchRel').dispatchEvent(new Event('change')); await sleep(200);
  const al=CatBatchUI.ui.aligned;
  const allPeakRows=[...document.querySelectorAll('#batchSummaryTable table')].pop().querySelectorAll('tbody tr').length;
  return { okN: CatBatchUI.ui.results.filter(x=>x.ok).length, anchors: al.anchors.length, trendPts: al.anchors[0].points.length, allPeakRows, legend: $('batchTrendLegend').querySelectorAll('.fit-legend-item').length };
})()`);
console.log('模拟8样品系列趋势', JSON.stringify(r));
await shot(ws, 'demo-trend.png');
/* 晶粒尺寸趋势视图 */
await ev(ws, `(async () => { ${HELP} $('batchMetric').value='D'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(200); return true; })()`);
await shot(ws, 'demo-trend-D.png');

/* 一键组会报告 */
r = await ev(ws, `(async () => { ${HELP} $('btnReport').click(); await sleep(700); return { len: (window.__blobs['report'] || '').length }; })()`);
const html = await ev(ws, `window.__blobs['report'] || ''`);
writeFileSync(join(ROOT, 'scripts', 'shots', 'demo-report.html'), html);
console.log('组会报告 HTML 字节', r.len, '已存 scripts/shots/demo-report.html');

ws.close(); chrome.kill(); process.exit(0);
