/* 堆叠出版风格 + 上传卡片轨道 浏览器验收（headless Chrome CDP 9341，4173 常驻）。
   覆盖：≥2样品默认堆叠（Intensity(a.u.)、无Y刻度、粗黑框、脚注声明）；单样品回退普通；
   堆叠开关/间距/缩放生效；上传卡片峰表（多卡分段/坏行报错）→ 底部棒图轨道 + 徽标 + 随导出。
   用法：node tests/browser-stack-upload.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 未运行'); process.exit(1); }
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const profile = mkdtempSync(join(tmpdir(), 'catplot-stack-'));
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
console.log('== SU 堆叠风格 + 上传卡片验收 ==');

/* SU1 默认3模拟样品 → 堆叠出版风格 */
let r = await ev(ws, `(async () => { ${HELP}
  await sleep(300);
  const svg = $('chart').innerHTML; const meta = $('chart')._meta;
  return { n: CatApp.state.samples.length, stack: meta && meta.stack, hasInt: svg.includes('Intensity (a.u.)'),
    yTicks: (svg.match(/text-anchor="end"/g) || []).length, frame: svg.includes('stroke-width="2.6'), note: svg.includes('纵向堆叠') };
})()`);
ok(r.n >= 2 && r.stack && r.hasInt && r.yTicks <= 1 && r.frame && r.note, 'SU1 多样品默认堆叠：Intensity标签/无Y刻度(仅轴标题)/粗黑框/脚注', r);

/* SU2 上传卡片（双卡分段）→ 轨道 */
const cardTxt = '# name=ZnAl2O4\n# formula=ZnAl2O4\n# card=PDF#82-1043\n# wavelength=1.5406\n19.0,40\n31.3,60\n36.8,100\n44.8,20\n55.6,30\n59.3,40\n65.2,50\n# name=ZnO\n# formula=ZnO\n# card=PDF#75-0576\n31.7,60\n34.4,50\n36.2,100\n47.5,30\n56.6,40\n62.8,50\n67.9,40\n';
r = await ev(ws, `(async () => { ${HELP}
  $('btnCards').click(); await sleep(200);
  const f = new File([${JSON.stringify(cardTxt)}], 'mycards.txt', { type: 'text/plain' });
  Object.defineProperty($('cardUpload'), 'files', { value: [f], configurable: true });
  $('cardUpload').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(600);
  const refs = CatApp.state.refs.filter(x => x.source === 'upload');
  const sticks = CatCards.rt.sticks.length;
  const svg = $('chart').innerHTML;
  return { upRefs: refs.length, sticks, lanes: (svg.match(/laneClip/g) || []).length, status: $('cardUploadStatus').textContent,
    labelZn: svg.includes('ZnAl2O4'), sticksOn: CatApp.state.lib.sticksOn };
})()`);
ok(r.upRefs === 2 && r.sticks >= 2 && r.lanes >= 2 && r.labelZn && r.sticksOn, 'SU2 上传双卡→2条棒图轨道+标签+自动开启', r);

/* SU3 上传卡片随导出（renderExport 含轨道） */
r = await ev(ws, `(async () => { ${HELP}
  const ex = CatChart.renderExport(CatApp.state.samples.filter(s=>s.visible), CatApp.state.settings, { tracks: CatCards.rt.sticks, fontScale: 1 });
  const html = ex.outerHTML || ex.innerHTML;
  return { hasLanes: html.includes('laneClip'), hasZn: html.includes('ZnAl2O4'), stack: html.includes('Intensity (a.u.)') };
})()`);
ok(r.hasLanes && r.hasZn && r.stack, 'SU3 导出SVG含堆叠+上传卡片轨道', r);

/* SU4 坏行上传报错具体 */
r = await ev(ws, `(async () => { ${HELP}
  const before = CatApp.state.refs.length;
  const f = new File([${JSON.stringify('# name=坏卡\nbad,row\n12,xx\n')}], 'bad.txt', { type: 'text/plain' });
  Object.defineProperty($('cardUpload'), 'files', { value: [f], configurable: true });
  $('cardUpload').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(400);
  return { added: CatApp.state.refs.length - before, status: $('cardUploadStatus').textContent };
})()`);
ok(r.added === 0 && /行2|行3|非数值/.test(r.status), 'SU4 坏行上传不入库+具体原因', r);

/* SU4b 真实标准衍射卡片(PDF#)上传 → 轨道标 化学式+PDF#卡号；改名生效 */
const pdfTxt = readFileSync('F:/XRD/PDF#82-1043.txt', 'utf8');
r = await ev(ws, `(async () => { ${HELP}
  const f = new File([${JSON.stringify(pdfTxt)}], 'PDF#82-1043.txt', { type: 'text/plain' });
  Object.defineProperty($('cardUpload'), 'files', { value: [f], configurable: true });
  $('cardUpload').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(600);
  const ref = CatApp.state.refs.find(x => x.source === 'upload' && /82-1043/.test(x.name));
  const svg = $('chart').innerHTML;
  const hasLabel = svg.includes('ZnAl2O4 PDF#82-1043');
  /* 改名 */
  window.prompt = () => '锌铝尖晶石 PDF#82-1043';
  const renBtn = [...$('refList').querySelectorAll('[data-ren]')].find(b => /82-1043/.test(b.getAttribute('data-ren')) || true);
  const target = [...$('refList').querySelectorAll('[data-ren]')].pop();
  if (target) target.click(); await sleep(400);
  const svg2 = $('chart').innerHTML;
  return { hasRef: !!ref, nPeaks: ref && ref.card.peaks.length, hasLabel, renamed: svg2.includes('锌铝尖晶石 PDF#82-1043') };
})()`);
ok(r.hasRef && r.nPeaks === 16 && r.hasLabel && r.renamed, 'SU4b 真实PDF卡片成轨道标卡号+改名', r);

/* SU5 堆叠开关回退普通 */
r = await ev(ws, `(async () => { ${HELP}
  $('cardsClose').click(); await sleep(150);
  $('setStack').checked = false; $('setStack').dispatchEvent(new Event('change')); await sleep(250);
  const meta = $('chart')._meta; const svg = $('chart').innerHTML;
  const off = !meta.stack && svg.includes('强度 (a.u.)');
  $('setStack').checked = true; $('setStack').dispatchEvent(new Event('change')); await sleep(250);
  const on = $('chart')._meta.stack;
  return { off, on };
})()`);
ok(r.off && r.on, 'SU5 堆叠开关可回退/恢复', r);

/* SU6 间距/缩放生效 */
r = await ev(ws, `(async () => { ${HELP}
  $('setStackGap').value = '1.4'; $('setStackGap').dispatchEvent(new Event('input')); await sleep(200);
  const g = $('chart')._meta.stackShift[1];
  $('setStackGap').value = '0.9'; $('setStackGap').dispatchEvent(new Event('input')); await sleep(200);
  const g2 = $('chart')._meta.stackShift[1];
  return { bigger: g > g2 };
})()`);
ok(r.bigger, 'SU6 堆叠间距控件生效', r);

/* SU6b 峰高差异大也不重叠：统一间距≥最高峰×缩放，上一条基线高于下一条峰顶 */
r = await ev(ws, `(async () => { ${HELP}
  function grid(a,b,s){const x=[];for(let v=a;v<=b+1e-9;v+=s)x.push(+v.toFixed(4));return x;}
  const mk=(h,seed)=>{const x=grid(20,40,0.05);const y=x.map(v=>h*Math.exp(-4*Math.LN2*Math.pow((v-30)/0.3,2))+5);return {x,y};};
  const A=mk(1000),B=mk(100),C=mk(500);
  CatApp.state.samples=[
    {id:'h1',name:'高',color:'#2563eb',lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',raw:A,working:A,peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null},bg:{mode:'none',iterations:24,points:[],applied:false,preview:true}},
    {id:'h2',name:'低',color:'#e11d48',lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',raw:B,working:B,peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null},bg:{mode:'none',iterations:24,points:[],applied:false,preview:true}},
    {id:'h3',name:'中',color:'#059669',lineWidth:1.5,visible:true,offset:0,normalize:false,source:'sim',raw:C,working:C,peaks:{params:{smooth:9,noiseK:3,minHeight:null,minProm:0,minDist:0.15,lo:null,hi:null},list:[],basisKey:null,sigma:null},bg:{mode:'none',iterations:24,points:[],applied:false,preview:true}}
  ];
  CatApp.state.selectedId='h1'; CatApp.renderAll(); await sleep(300);
  const m=$('chart')._meta;
  const gap=m.stackShift[1]-m.stackShift[0];
  const maxScaled=1000*m.stackScale;
  return { uniform: Math.abs((m.stackShift[2]-m.stackShift[1])-gap)<1e-9, noOverlap: gap>=maxScaled, gap, maxScaled };
})()`);
ok(r.uniform && r.noOverlap, 'SU6b 峰高差异大统一间距不重叠', r);

/* SU7 零控制台错误 */
ok(consoleErrors.length === 0, 'SU7 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 堆叠+上传卡片验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
