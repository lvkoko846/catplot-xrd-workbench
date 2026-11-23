/* 参赛帖图文取证：驱动公开站点完成 XRD/拉曼/红外/XPS 全功能演示并截图到 docs/post/images/。
   数据：XRED(MIT) / FormicAcid Raman(MIT) / h-BN DRIFT+XPS(CC BY 4.0, Zenodo 15180744) / 模拟系列(标注)。
   用法：node scripts/capture-post.mjs（公开站点已发布对应 commit） */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'docs', 'post', 'images');
const URL0 = 'https://catplot-xrd-ahzrkmiqf3h.qoder.website/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9345;
const profile = mkdtempSync(join(tmpdir(), 'catplot-post-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1440,960', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
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
await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: "window.__caps=[];const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__caps.push({name:this.download,href:this.href});return;}return oc.apply(this);};window.confirm=()=>true;" });
await send(ws, 'Page.navigate', { url: URL0 });
await sleep(2000);
async function shot(name, sel) {
  if (sel) await ev(ws, `document.querySelector('${sel}').scrollIntoView({block:'center'}); true`);
  await sleep(350);
  const s = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(IMG, name), Buffer.from(s.data, 'base64'));
  console.log('shot', name);
}
const HELP = `
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function upload(text, name) {
    const f = new File([text], name, { type: 'text/csv' });
    Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 60; i++) { await sleep(80); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tbody tr').length > 1) break; }
    $('impConfirm').click(); await sleep(400);
    const item = [...$('sampleList').querySelectorAll('.sample-item')].find(x => x.textContent.includes(name.replace(/\\.[a-z]+$/, '')));
    if (item) { item.click(); await sleep(300); }
  }
  function tech(v) { const s = $('techSelect'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }
  async function peaks(minH) {
    document.querySelector('.tool-tab[data-tool="peaks"]').click(); await sleep(200);
    const mh = $('pkMinHeight'); mh.value = minH == null ? '' : String(minH);
    mh.dispatchEvent(new Event('input', { bubbles: true })); mh.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120); $('btnAutoPeaks').click(); await sleep(900);
    return CatApp.getSelected().peaks.list.map(p => ({ x: p.x, h: p.height }));
  }
  async function fitRegion(min, max, minH) {
    document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
    $('fitRMin').value = String(min); $('fitRMax').value = String(max);
    $('btnFitAddRegion').click(); await sleep(200);
    if (minH != null) { $('fitMinHeight').value = String(minH); }
    $('btnFitInitPeaks').click(); await sleep(350);
    const t0 = Date.now(); $('btnFitRun').click();
    while (CatFitUI.ui.finishedAt <= t0 && Date.now() - t0 < 20000) await sleep(60);
    await sleep(300);
    return CatApp.state.fit.regions[CatApp.state.fit.regions.length - 1];
  }
`;
const xred = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'tio2-rutile-anatase.csv'), 'utf8');
const raman = readFileSync(join(ROOT, 'docs', 'post', 'data', 'raman-formic-acid.csv'), 'utf8');
const drift = readFileSync(join(ROOT, 'docs', 'post', 'data', 'ftir-drift-spent-hbn.csv'), 'utf8');
const c1s = readFileSync(join(ROOT, 'docs', 'post', 'data', 'xps-c1s-vs58.csv'), 'utf8');
const b1s = readFileSync(join(ROOT, 'docs', 'post', 'data', 'xps-b1s.csv'), 'utf8');

/* 01 XRD 堆叠 + 示例卡轨道 */
let r = await ev(ws, `(async () => { ${HELP}
  await upload(${JSON.stringify(xred)}, 'xred-tio2.csv');
  $('btnCards').click(); await sleep(400);
  document.querySelector('[data-exadd="COD-1010942"]').click(); await sleep(400);
  document.querySelector('[data-exadd="COD-1530150"]').click(); await sleep(400);
  $('stickLambdaPreset').value = '1.5406'; $('stickLambdaPreset').dispatchEvent(new Event('change', { bubbles: true }));
  $('btnLambdaConfirm').click(); await sleep(400);
  $('cardsClose').click(); await sleep(300);
  return { samples: CatApp.state.samples.length, sticks: CatCards.rt.sticks.length, stack: $('chart')._meta.stack };
})()`);
console.log('XRD', JSON.stringify(r));
await shot('01-xrd-stack-cards.png', '#chart');

/* 02 XRD 拟合 + 残差 */
r = await ev(ws, `(async () => { ${HELP}
  const rg = await fitRegion(24.4, 26.3, 60);
  return { ok: !!rg.result, rwp: rg.result && +rg.result.quality.rwp.toFixed(4), peaks: rg.peaks.length };
})()`);
console.log('XRD-FIT', JSON.stringify(r));
await shot('02-xrd-fit-residual.png', '#fitChart');

/* 03 XRD 粘贴峰表匹配 + 确认闭环 */
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(250);
  $('btnMatchExample').click(); await sleep(500);
  let t0 = Date.now(); $('btnMatchRun').click();
  while (CatMatchUI.ui.finishedAt <= t0 && Date.now() - t0 < 20000) await sleep(60);
  await sleep(300);
  const res = CatMatchUI.ui.result;
  const row = [...document.querySelectorAll('#toolMatch .mt-row')][0];
  const cb = row && row.querySelector('[data-act="confirm"]');
  if (cb) { cb.click(); await sleep(500); }
  const rb = $('btnMatchRemaining');
  if (rb && !rb.disabled) { rb.click(); await sleep(400); t0 = Date.now(); $('btnMatchRun').click(); while (CatMatchUI.ui.finishedAt <= t0 && Date.now() - t0 < 20000) await sleep(60); await sleep(300); }
  return { cands: res ? res.candidates.length : 0, phases: CatApp.state.phases.length, cov: $('matchCoverage').textContent.slice(0, 60) };
})()`);
console.log('XRD-MATCH', JSON.stringify(r));
await shot('03-xrd-match-loop.png', '#toolMatch');

/* 04 拉曼：拟合 + 面积比 */
r = await ev(ws, `(async () => { ${HELP}
  await upload(${JSON.stringify(raman)}, 'raman-formic.csv');
  tech('raman'); await sleep(400);
  document.querySelector('.tool-tab[data-tool="bg"]').click(); await sleep(200);
  $('btnBgApply').click(); await sleep(400);
  const pk = await peaks(null);
  const top = pk.slice().sort((a, b) => b.h - a.h).slice(0, 2).sort((a, b) => a.x - b.x);
  const rg = await fitRegion(top[0].x - 6, top[1].x + 6, null);
  const selA = $('fitRatioA'), selB = $('fitRatioB');
  if (selA.options.length >= 2) { selA.value = selA.options[0].value; selB.value = selB.options[1].value; selA.dispatchEvent(new Event('change', { bubbles: true })); selB.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); }
  return { peaks: pk.length, ok: !!rg.result, ratio: ($('fitRatioOut') || {}).textContent || null, guide: (CatModel.guide('raman') || {}).steps };
})()`);
console.log('RAMAN', JSON.stringify(r));
await shot('04-raman-fit-ratio.png', '#fitChart');

/* 05 红外 DRIFT：寻峰 + 流程指南 */
r = await ev(ws, `(async () => { ${HELP}
  await upload(${JSON.stringify(drift)}, 'ftir-drift-hbn.csv');
  tech('ftir'); await sleep(400);
  const pk = await peaks(null);
  return { peaks: pk.length, guide: (CatModel.guide('ftir') || {}).steps, bg: $('bgMode').value };
})()`);
console.log('FTIR', JSON.stringify(r));
await shot('05-ftir-drift-peaks.png', '#chart');

/* 06 XPS 荷电校正 */
r = await ev(ws, `(async () => { ${HELP}
  await upload(${JSON.stringify(c1s)}, 'xps-c1s.csv');
  tech('xps'); await sleep(500);
  $('chargeMode').value = 'reference'; $('chargeMode').dispatchEvent(new Event('change', { bubbles: true })); await sleep(200);
  $('chargeRefMeasured').value = '284.971'; $('chargeRefMeasured').dispatchEvent(new Event('input', { bubbles: true }));
  $('chargeRefTarget').value = '284.8'; $('chargeRefTarget').dispatchEvent(new Event('input', { bubbles: true }));
  $('btnChargeApply').click(); await sleep(500);
  return { status: $('chargeStatus').textContent, bg: $('bgMode').value };
})()`);
console.log('XPS-CHARGE', JSON.stringify(r));
await shot('06-xps-charge-shirley.png', '#chargePanel');

/* 07 XPS B1s 分峰 + 化学态面积比 */
r = await ev(ws, `(async () => { ${HELP}
  await upload(${JSON.stringify(b1s)}, 'xps-b1s.csv');
  tech('xps'); await sleep(400);
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  $('fitRMin').value = '189'; $('fitRMax').value = '195';
  $('btnFitAddRegion').click(); await sleep(200);
  const rg0 = CatApp.state.fit.regions[CatApp.state.fit.regions.length - 1];
  rg0.peaks = [{ c: 190.5, w: 1.2, h: 1800, sp: 0.5, locks: {} }, { c: 192.5, w: 1.5, h: 400, sp: 0.5, locks: {} }];
  const t1 = Date.now(); $('btnFitRun').click();
  while (CatFitUI.ui.finishedAt <= t1 && Date.now() - t1 < 20000) await sleep(60);
  await sleep(300);
  const rg = CatApp.state.fit.regions[CatApp.state.fit.regions.length - 1];
  const selA = $('fitRatioA'), selB = $('fitRatioB');
  if (selA.options.length >= 2) { selA.value = selA.options[0].value; selB.value = selB.options[1].value; selA.dispatchEvent(new Event('change', { bubbles: true })); selB.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); }
  return { ok: !!rg.result, peaks: rg.peaks.length, rwp: rg.result && +rg.result.quality.rwp.toFixed(4) };
})()`);
console.log('XPS-B1S', JSON.stringify(r));
await shot('07-xps-b1s-states.png', '#fitChart');

/* 08 组会报告 */
r = await ev(ws, `(async () => { ${HELP}
  window.__caps.length = 0;
  $('btnReportTop').click(); await sleep(900);
  return { caps: window.__caps.map(c => c.name) };
})()`);
console.log('REPORT', JSON.stringify(r));
const href = await ev(ws, `(window.__caps.find(c => /report/.test(c.name)) || {}).href || null`);
if (href) {
  await send(ws, 'Page.navigate', { url: href });
  await sleep(1200);
  await shot('08-report.png', null);
  await send(ws, 'Page.navigate', { url: URL0 });
  await sleep(1500);
}

/* 09 批量趋势（模拟系列，标注） */
r = await ev(ws, `(async () => { ${HELP}
  const base = ${JSON.stringify(xred)};
  const lines = base.trim().split(/\\r?\\n/).map(l => l.split(',').map(Number));
  for (let k = 0; k < 3; k++) {
    const shift = k * 0.12;
    const txt = lines.map(([x, y]) => (x + shift).toFixed(2) + ',' + y.toFixed(2)).join('\\n');
    await upload(txt, 'syn-series-' + k + '.csv');
  }
  document.querySelector('.tool-tab[data-tool="batch"]').click(); await sleep(300);
  $('btnBatchSelAll').click(); await sleep(200);
  $('batchRMin').value = '24'; $('batchRMax').value = '29';
  const t0 = Date.now(); $('btnBatchRun').click();
  while (Date.now() - t0 < 30000) { await sleep(200); if ($('batchTrendChart') && $('batchTrendChart').innerHTML.includes('path')) break; }
  await sleep(500);
  return { sel: $('batchSelCount').textContent, trend: !!($('batchTrendChart') || {}).innerHTML };
})()`);
console.log('BATCH', JSON.stringify(r));
await shot('09-batch-trend.png', '#toolBatch');

console.log('consoleErrors', consoleErrors.length, consoleErrors.slice(0, 3));
ws.close(); chrome.kill();
process.exit(consoleErrors.length ? 1 : 0);