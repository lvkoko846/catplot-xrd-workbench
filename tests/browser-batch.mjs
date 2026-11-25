/* 系列批量分析浏览器验收（batch-1 UI 侧，headless Chrome CDP 9337，静态服务 4173 常驻）。
   覆盖：面板可用与范围声明、样品选择、批量运行+进度、趋势图(峰位/FWHM/晶粒尺寸)、Scherrer 警示、
   汇总表(含失败原因)、趋势/汇总 CSV 与 PNG/SVG 导出、移动端390、零控制台错误。
   用法：node tests/browser-batch.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), 'catplot-batch-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1280,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }
async function getTarget() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); const p = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (p) return p; } catch {} await sleep(250); } throw new Error('chrome not ready'); }
let id = 0; const pending = new Map(); const consoleErrors = [];
function send(ws, method, params) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }
async function ev(ws, expression) { const r = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails)); return r.result.value; }
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(m.params.exceptionDetails)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' ')); };
await send(ws, 'Page.enable'); await send(ws, 'Runtime.enable');
await send(ws, 'Page.navigate', { url: API + '/' });
await sleep(1600);

/* 注入合成系列：6 样品 c=30+0.15i, w=0.18+0.03i, h=1000, η=0.5, 线性背景[40,20], 噪声25 */
const INJECT = `
  const Core = window.CatFitCore;
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(4));return x;}
  function synth(x,peaks,seed){let s=seed;const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;const mid=(x[0]+x[x.length-1])/2,half=(x[x.length-1]-x[0])/2;const st={peaks,shape:'pseudoVoigt',bgModel:'linear',bgCoeffs:[40,20],anchors:null,mid,half};return x.map(v=>Core.modelY(v,st)+(rnd()+rnd()+rnd()-1.5)*25);}
  const ss=[];
  for(let i=0;i<6;i++){const c=30+0.15*i,w=0.18+0.03*i;const x=grid(28,33,0.01);const y=synth(x,[{c,w,h:1000,sp:0.5}],100+i);
    ss.push({id:'bs'+i,name:'系列-'+i,color:['#2563eb','#e11d48','#059669','#d97706','#7c3aed','#0891b2'][i],lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',note:'',raw:{x,y},working:{x,y:y.slice()},importMeta:null,bg:{mode:'none',iterations:24,points:[],applied:false,preview:true},peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null}});}
  CatApp.state.samples = ss; CatApp.state.selectedId = ss[0].id; CatApp.renderAll();
`;
const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(r => setTimeout(r, ms));`;
await ev(ws, `(() => { window.__caps = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__caps.push(this.download); return; } return orig.apply(this); }; window.confirm = () => true; return true; })()`);

console.log('== BB 系列批量分析浏览器验收 ==');

/* BB1 面板可用 + 范围声明 */
let r = await ev(ws, `(async () => { ${HELP}
  const tab = [...document.querySelectorAll('.tool-tab')].find(b => b.dataset.tool === 'batch');
  tab.click(); await sleep(250);
  return { pane: !$('toolBatch').hidden, scope: $('batchScope').textContent, hasTrend: !!$('batchTrendChart') };
})()`);
ok(r.pane && r.scope.includes('表观') && r.scope.includes('不做物相定量') && r.hasTrend, 'BB1 批量面板可用，范围声明含表观晶粒尺寸与不做定量', r);

/* 注入样品 + 全选 + 设置区间 */
r = await ev(ws, `(async () => { ${HELP} ${INJECT}
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(200);
  $('btnBatchSelAll').click(); await sleep(150);
  $('batchRMin').value='28'; $('batchRMax').value='33'; $('batchMinHeight').value='100'; $('batchMinDist').value='0.3'; $('batchTol').value='1.0';
  return { selCount: $('batchSelCount').textContent, rows: $('batchSampleList').querySelectorAll('[data-bsel]').length };
})()`);
ok(r.selCount.includes('6') && r.rows === 6, 'BB2 样品选择：全选 6 个', r);

/* BB3 运行批量 + 进度 + 结果 */
r = await ev(ws, `(async () => { ${HELP}
  $('btnBatchRun').click();
  const t0=Date.now(); while(CatBatchUI.ui.running && Date.now()-t0<30000) await sleep(80);
  await sleep(200);
  const rs=CatBatchUI.ui.results;
  return { n: rs.length, okN: rs.filter(x=>x.ok).length, ms: Date.now()-t0,
    centers: rs.map(x=>x.ok?+x.params[0].c.toFixed(3):null),
    summaryRows: $('batchSummaryTable').querySelector('table').querySelectorAll('tbody tr').length,
    status: $('batchStatus').textContent, engine: $('batchStatus').dataset.engine };
})()`);
ok(r.n === 6 && r.okN === 6 && r.summaryRows === 6, 'BB3 批量运行 6 样品全成功，汇总表 6 行', r);
ok(r.engine === 'worker', 'BB3c 批量拟合实际由 Worker 执行', r.engine);
const cExp = [30, 30.15, 30.3, 30.45, 30.6, 30.75];
ok(r.centers.every((c, i) => c != null && Math.abs(c - cExp[i]) < 0.05), 'BB3b 各样品峰位恢复线性偏移（误差<0.05°）', r.centers);

/* BB4 趋势图：峰位指标有折线与点 */
r = await ev(ws, `(async () => { ${HELP}
  $('batchMetric').value='c'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(150);
  const svg=$('batchTrendChart').innerHTML;
  return { circles: (svg.match(/<circle/g)||[]).length, path: svg.includes('<path'), note: $('batchTrendNote').textContent };
})()`);
ok(r.circles === 6 && r.path, 'BB4 峰位趋势图：6 点 + 折线', r);

/* BB5 FWHM 趋势单调递增 */
r = await ev(ws, `(async () => { ${HELP}
  $('batchMetric').value='w'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(150);
  const a=CatBatchUI.ui.aligned.anchors[0]; const ws=a.points.map(p=>p.w);
  return { ws: ws.map(v=>+v.toFixed(4)), mono: ws.every((v,i)=>i===0||v>ws[i-1]) };
})()`);
ok(r.mono, 'BB5 FWHM 趋势单调递增', r);

/* BB6 晶粒尺寸指标 + 表观警示 */
r = await ev(ws, `(async () => { ${HELP}
  $('batchMetric').value='D'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(150);
  const a=CatBatchUI.ui.aligned.anchors[0]; const Ds=a.points.map(p=>p.D);
  return { warn: !$('batchScherrerWarn').hidden, warnTxt: $('batchScherrerWarn').textContent, monoD: Ds.every((v,i)=>i===0||v<Ds[i-1]), apparent: a.points.every(p=>p.Dapparent===true) };
})()`);
ok(r.warn && r.warnTxt.includes('表观') && r.monoD && r.apparent, 'BB6 晶粒尺寸趋势递减 + 表观警示显示', r);

/* BB6b 单观测锚峰：明示"不足以构成趋势"+原因+建议，而非沉默单点 */
r = await ev(ws, `(async () => { ${HELP}
  CatBatchUI.ui.aligned.anchors.push({ ref: 31.5, label: '峰 2', points: [{ xValue: 1, name: '仅一样品', c: 31.5, w: 0.2, area: 100, D: 40, Dapparent: true, d: 2.8, rwp: 0.05 }] });
  $('batchAnchor').innerHTML += '<option value="1">峰 2（1 样品）</option>';
  $('batchAnchor').value = '1'; $('batchMetric').value = 'c'; $('batchMetric').dispatchEvent(new Event('change')); await sleep(150);
  const note = $('batchTrendNote').textContent;
  return { note: note.slice(0, 40), warn: note.includes('不足以构成趋势') && note.includes('容差') && note.includes('系列'), cls: $('batchTrendNote').className };
})()`);
ok(r.warn && /mt-warn/.test(r.cls), 'BB6b 单观测锚峰明示不足两点+原因+建议', r);

/* BB6c 多锚峰默认"全部"多系列 + 相对偏移 + 全峰表 */
r = await ev(ws, `(async () => { ${HELP}
  const mk = (ref, label, off) => ({ ref, label, points: [0,1,2,3,4,5].map(i => ({ xValue: i+1, name: 's'+i, c: ref+off*i, w: 0.2+0.01*i, area: 100, D: 40-2*i, Dapparent: true, d: 3, rwp: 0.05 })) });
  CatBatchUI.ui.aligned = { anchors: [mk(30,'峰 1',0.15), mk(32,'峰 2',0.1)], tol: 1.5, refName: 's0' };
  CatBatchUI.refresh(); await sleep(150);
  const defAll = $('batchAnchor').value === 'all';
  const legendN = $('batchTrendLegend').querySelectorAll('.fit-legend-item').length;
  $('batchRel').checked = true; $('batchRel').dispatchEvent(new Event('change')); await sleep(150);
  const paths = ($('batchTrendChart').innerHTML.match(/<path/g) || []).length;
  const ylab = $('batchTrendChart').innerHTML.includes('相对首样品');
  return { defAll, legendN, paths, ylab };
})()`);
ok(r.defAll && r.legendN === 2 && r.paths === 2 && r.ylab, 'BB6c 多锚峰默认全部多系列+相对偏移双折线', r);

/* BB7 失败样品入汇总表（注入空样品重跑） */
r = await ev(ws, `(async () => { ${HELP}
  CatApp.state.samples.push({id:'bad',name:'空样品',color:'#65a30d',lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',note:'',raw:{x:[],y:[]},working:{x:[],y:[]},importMeta:null,bg:{mode:'none',iterations:24,points:[],applied:false,preview:true},peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null}});
  CatApp.renderAll(); document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(150);
  $('btnBatchSelAll').click(); await sleep(120);
  $('btnBatchRun').click(); const t0=Date.now(); while(CatBatchUI.ui.running && Date.now()-t0<30000) await sleep(80); await sleep(200);
  const bad=CatBatchUI.ui.results.find(x=>x.id==='bad');
  const rowTxt=$('batchSummaryTable').textContent;
  const allPeakRows=[...document.querySelectorAll('#batchSummaryTable table')].pop().querySelectorAll('tbody tr').length;
  return { badOk: bad.ok, badReason: bad.reason, hasReasonInTable: rowTxt.includes('no-data'), hasAllPeaks: rowTxt.includes('每样品全部特征峰'), allPeakRows };
})()`);
ok(!r.badOk && /no-data/.test(r.badReason) && r.hasReasonInTable && r.hasAllPeaks && r.allPeakRows >= 6, 'BB7 失败原因入表+每样品全峰参数表', r);

/* BB8 导出触发 */
r = await ev(ws, `(async () => { ${HELP}
  window.__caps=[];
  $('btnBatchTrendCsv').click(); await sleep(120);
  $('btnBatchSummaryCsv').click(); await sleep(120);
  $('btnBatchPeaksCsv').click(); await sleep(120);
  $('btnBatchSvg').click(); await sleep(200);
  $('btnBatchPng').click(); await sleep(600);
  return { caps: window.__caps.slice() };
})()`);
ok(r.caps.includes('catplot-trend.csv') && r.caps.includes('catplot-batch-summary.csv') && r.caps.includes('catplot-batch-allpeaks.csv') && r.caps.includes('catplot-trend.svg') && r.caps.includes('catplot-trend.png'), 'BB8 五类导出触发（趋势/汇总/全峰CSV/SVG/PNG）', r);

/* BB9 移动端 390 无横向溢出 */
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(250);
  return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
})()`);
ok(!r.overflow, 'BB9 移动端 390px 批量面板无横向溢出', r);
await send(ws, 'Emulation.clearDeviceMetricsOverride');

/* BB10 零控制台错误 */
ok(consoleErrors.length === 0, 'BB10 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 系列批量浏览器验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
