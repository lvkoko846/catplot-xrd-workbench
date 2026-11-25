/* 组会报告浏览器验收（report-1 UI，headless Chrome CDP 9339，静态服务 4173 常驻）。
   真实 XRED 双相谱：上传→寻峰→拟合→匹配确认 → 一键报告导出；断言下载触发且 HTML 含关键章节与诚实口径。
   用法：node tests/browser-report.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const profile = mkdtempSync(join(tmpdir(), 'catplot-report-'));
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
const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(r => setTimeout(r, ms));`;
/* 捕获下载 + 拦截 Blob 内容 */
await ev(ws, `(() => { window.__caps = []; window.__blobs = {}; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__caps.push(this.download); return; } return oc.apply(this); }; const ob = URL.createObjectURL; URL.createObjectURL = function (b) { if (b && b.type && b.type.includes('html')) { b.text().then(t => { window.__blobs['report'] = t; }); } return ob.apply(this, arguments); }; window.confirm = () => true; return true; })()`);

console.log('== BR 组会报告浏览器验收 ==');
const csv = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'tio2-rutile-anatase.csv'), 'utf8');
let r = await ev(ws, `(async () => { ${HELP}
  const f = new File([${JSON.stringify(csv)}], 'xred-rep.csv', { type: 'text/csv' });
  Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
  $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60; i++) { await sleep(80); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tbody tr').length > 1) break; }
  $('impConfirm').click(); await sleep(350);
  [...$('sampleList').querySelectorAll('.sample-item')].find(x => x.textContent.includes('xred-rep')).click(); await sleep(250);
  const s = CatApp.getSelected(); s.peaks.params.minHeight = 50; s.peaks.params.smooth = 9; s.peaks.params.minDist = 0.3;
  const pr = CatAnalysis.findPeaks(s.working.x, s.working.y, s.peaks.params);
  s.peaks.list = pr.peaks.map((p, i) => ({ id: 'p' + i, x: p.x, height: p.height, source: 'auto', index: p.i }));
  CatApp.renderAll(); await sleep(200);
  /* 拟合主峰 */
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(200);
  $('fitRMin').value = '24.4'; $('fitRMax').value = '26.3'; $('btnFitAddRegion').click(); await sleep(150);
  $('btnFitInitPeaks').click(); await sleep(250); $('btnFitRun').click();
  const t0 = Date.now(); while (CatFitUI.ui.running && Date.now() - t0 < 15000) await sleep(60); await sleep(150);
  /* 匹配确认 */
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(200);
  $('btnMatchExample').click(); await sleep(150); $('btnMatchRun').click(); await sleep(250);
  const idx = CatMatchUI.ui.last.candidates.findIndex(x => x.name === '锐钛矿');
  if (idx >= 0) $('matchCandTable').querySelector('[data-mconfirm="' + idx + '"]').click(); await sleep(200);
  return { fitOk: !!(CatApp.state.fit.regions[0].result), phases: CatMatchUI.ui.phases.length };
})()`);
ok(r.fitOk && r.phases >= 1, 'BR1 真实谱拟合+匹配确认就绪', r);

/* BR2 一键报告导出 + 内容断言 */
r = await ev(ws, `(async () => { ${HELP}
  const top = $('btnReportTop'); const topVisible = !!top && top.getBoundingClientRect().top < 120;
  top.click(); await sleep(600);
  const html = window.__blobs['report'] || '';
  return { caps: window.__caps.slice(), len: html.length, topVisible,
    hasSections: html.includes('峰拟合参数') && html.includes('物相匹配') && html.includes('未做'),
    honest: html.includes('不是物相存在概率') && html.includes('非物相含量'),
    hasSvg: html.includes('<svg'), prov: html.includes('MIT') };
})()`);
ok(r.topVisible && r.caps.includes('catplot-report.html') && r.len > 2000 && r.hasSections && r.honest && r.hasSvg && r.prov, 'BR2 顶栏报告按钮可见+导出含章节/诚实口径/SVG/溯源', r);

/* BR3 零控制台错误 */
ok(consoleErrors.length === 0, 'BR3 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 组会报告浏览器验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
