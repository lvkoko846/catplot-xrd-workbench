/* 峰拟合浏览器验收（任务2.6 UI 侧，headless Chrome CDP 9336，静态服务 4173 常驻）。
   覆盖：面板可用与范围声明、归一化→原始数据、区间/候选峰/拟合/残差图、Scherrer 表观警示与扣宽化、
   取消≤2s、卡片对照(波长一致/不一致)、v3 打开+v4 往返、导出、库版本待更新、移动端390、零控制台错误。
   用法：node tests/browser-fit.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/data/example-cards.json')).json(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const profile = mkdtempSync(join(tmpdir(), 'catplot-fit-'));
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
await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: "window.CATPLOT_API_BASE='" + API + "/api';" });
await send(ws, 'Page.navigate', { url: API + '/' });
await sleep(1600);
const HELP = `
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const FU = () => CatFitUI.ui;
  const sel = () => CatApp.state.samples.find(x => x.id === CatApp.state.selectedId);
  async function waitFit() { const t0 = Date.now(); while (FU().finishedAt <= t0 && Date.now() - t0 < 20000) await sleep(50); await sleep(120); }
  async function upload(csv, name) {
    const f = new File([csv], name, { type: 'text/csv' });
    Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 60; i++) { await sleep(80); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tbody tr').length > 1) break; }
    $('impConfirm').click(); await sleep(350);
    const item = [...$('sampleList').querySelectorAll('.sample-item')].find(x => x.textContent.includes(name.replace('.csv', '')));
    item.click(); await sleep(250);
  }
`;
await ev(ws, `(() => { window.__caps = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__caps.push(this.download); return; } return orig.apply(this); }; window.confirm = () => true; return true; })()`);

console.log('== BF 峰拟合浏览器验收 ==');
let r = await ev(ws, `(async () => { ${HELP}
  const tab = [...document.querySelectorAll('.tool-tab')].find(b => b.dataset.tool === 'fit');
  tab.click(); await sleep(250);
  return { soon: !!tab.querySelector('.soon'), pane: !$('toolFit').hidden, scope: $('fitScope').textContent };
})()`);
ok(!r.soon && r.pane && r.scope.includes('非物相含量') && r.scope.includes('Rietveld'), 'BF1 拟合页可用（无待交付），范围声明含不支持项与面积占比口径', r);

const csv = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'tio2-rutile-anatase.csv'), 'utf8');
r = await ev(ws, `(async () => { ${HELP}
  await upload(${JSON.stringify(csv)}, 'fit-xred.csv');
  $('btnCards').click(); await sleep(150);
  $('stickLambdaPreset').value = '1.5406'; $('stickLambdaPreset').dispatchEvent(new Event('change', { bubbles: true }));
  $('btnLambdaConfirm').click(); await sleep(200); $('cardsClose').click(); await sleep(120);
  const s = sel(); s.normalize = true; s.offset = 5; CatApp.renderAll(); await sleep(200);
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  const warn = !$('fitNormWarn').hidden && $('fitNormWarn').textContent.includes('原始上传数据');
  $('fitRMin').value = '24.4'; $('fitRMax').value = '26.3'; $('btnFitAddRegion').click(); await sleep(200);
  $('btnFitInitPeaks').click(); await sleep(300);
  const nPeaks = CatApp.state.fit.regions[0].peaks.length;
  const t0 = Date.now(); $('btnFitRun').click(); await waitFit();
  const rg = CatApp.state.fit.regions[0];
  return { warn, nPeaks, ok: !!(rg.result && rg.result.ok !== false), h: rg.result && rg.result.params[0].h, rwp: rg.result && rg.result.quality.rwp, fwhm: rg.result && rg.result.params[0].w, center: rg.result && rg.result.params[0].c, ms: Date.now() - t0,
    qualityTxt: $('fitQuality').textContent, paramRows: $('fitParamTable').querySelectorAll('tbody tr').length,
    residual: $('fitChart').innerHTML.includes('残差'), legend: $('fitLegend').querySelectorAll('input').length };
})()`);
ok(r.warn && r.nPeaks >= 1 && r.ok && r.h > 100, 'BF2 归一化+偏移样品：警示提示且拟合用原始数据（峰高为原始量级）', r);
if (!r.ok) console.log('    DEBUG consoleErrors:', JSON.stringify(consoleErrors.slice(0, 4)));
ok(r.ok && r.paramRows === r.nPeaks && r.residual && r.legend >= 1 && /Rwp=/.test(r.qualityTxt), 'BF3 拟合完成：参数表行数=峰数、残差子图与分峰图例可见、Rwp 显示', { rwp: r.rwp, fwhm: r.fwhm, center: r.center, ms: r.ms });
console.log('    XRED 锐钛矿主峰 UI 拟合: 中心 ' + r.center + '° FWHM ' + r.fwhm + '° Rwp ' + r.rwp + ' 耗时 ' + r.ms + 'ms');

r = await ev(ws, `(async () => { ${HELP}
  const warnShown = !$('fitScherrerWarn').hidden && $('fitScherrerWarn').textContent.includes('表观值，未扣除仪器宽化，系统性偏小');
  const dApparent = parseFloat($('fitScherrerTable').querySelector('tbody tr td:nth-child(2)').textContent);
  $('fitInstMode').value = 'fixed'; $('fitInstMode').dispatchEvent(new Event('change', { bubbles: true }));
  $('fitInstFwhm').value = '0.08'; $('fitInstFwhm').dispatchEvent(new Event('input', { bubbles: true })); await sleep(150);
  const warnHidden = $('fitScherrerWarn').hidden;
  const dCorr = parseFloat($('fitScherrerTable').querySelector('tbody tr td:nth-child(2)').textContent);
  return { warnShown, warnHidden, dApparent, dCorr };
})()`);
ok(r.warnShown && r.warnHidden && r.dCorr > r.dApparent, 'BF4 未填仪器宽化→表观值警示；填仪器 FWHM 后警示消失且 D 增大', r);

r = await ev(ws, `(async () => { ${HELP}
  $('fitRMin').value = '10'; $('fitRMax').value = '60'; $('btnFitAddRegion').click(); await sleep(200);
  $('fitMinHeight').value = '80'; $('btnFitInitPeaks').click(); await sleep(300);
  const n = CatApp.state.fit.regions[1].peaks.length;
  const t0 = Date.now();
  $('btnFitRun').click(); await sleep(40);
  const cancelVisible = !$('btnFitCancel').hidden;
  $('btnFitCancel').click();
  await waitFit();
  return { n, cancelVisible, ms: Date.now() - t0, status: $('fitStatus').textContent, running: FU().running };
})()`);
ok(r.n >= 6 && r.cancelVisible && r.ms <= 2000 && /已取消/.test(r.status) && !r.running, 'BF5 多峰大区间中途取消：≤2s 终态、计算停止', r);

r = await ev(ws, `(async () => { ${HELP}
  await CatCardsUI.previewRemoteUid('COD-1010942'); await sleep(400);
  CatApp.state.fit.active = CatApp.state.fit.regions[0].id;
  CatFitUI.refresh(); await sleep(200);
  const rows1 = [...$('fitCardTable').querySelectorAll('tbody tr')];
  const same = rows1.length >= 1 && rows1[0].textContent.includes('Anatase');
  const dT1 = rows1[0] ? rows1[0].querySelectorAll('td')[4].textContent : '';
  CatCards.rt.sticks[0].lambda = 1.5418;
  CatFitUI.refresh(); await sleep(200);
  const rows2 = [...$('fitCardTable').querySelectorAll('tbody tr')];
  const dT2 = rows2[0] ? rows2[0].querySelectorAll('td')[4].textContent : '';
  const note2 = rows2[0] ? rows2[0].querySelectorAll('td')[5].textContent : '';
  const dD2 = rows2[0] ? rows2[0].querySelectorAll('td')[3].textContent : '';
  CatCards.rt.sticks[0].lambda = 1.5406; CatFitUI.refresh();
  return { same, dT1, dT2, note2, dD2 };
})()`);
ok(r.same && r.dT1 !== '—' && r.dT2 === '—' && /仅给 d 偏差/.test(r.note2) && r.dD2 !== '—', 'BF6 卡片对照：波长一致给 Δd+Δ2θ；不一致只给 d 偏差并声明', r);

r = await ev(ws, `(async () => { ${HELP}
  $('btnFitCsvParams').click(); await sleep(150);
  $('btnFitCsvCurves').click(); await sleep(150);
  $('btnFitJson').click(); await sleep(150);
  $('btnFitSvg').click(); await sleep(200);
  $('btnFitPng').click(); await sleep(900);
  return { caps: window.__caps.slice() };
})()`);
ok(r.caps.some(n => /fit_params.*\.csv/.test(n)) && r.caps.some(n => /fit_curves.*\.csv/.test(n)) && r.caps.some(n => /\.json$/.test(n)) && r.caps.some(n => /\.svg$/.test(n)) && r.caps.some(n => /\.png$/.test(n)), 'BF7 四类导出触发（参数CSV/曲线CSV/JSON/SVG/PNG）', r);

/* v3 打开 + v4 往返 */
r = await ev(ws, `(async () => { ${HELP}
  const payload = CatModel.serializeProject(CatApp.state);
  const v4ok = CatModel.validateProject(JSON.parse(JSON.stringify(payload))).ok;
  const v3 = JSON.parse(JSON.stringify(payload)); v3.version = 3; delete v3.fit;
  localStorage.setItem('catplot.state.v1', JSON.stringify({ format: 'catplot-local', version: 3, savedAt: new Date().toISOString(), state: v3 }));
  return { v4ok, version: payload.version, hasFit: !!payload.fit, regions: payload.fit && payload.fit.regions.length };
})()`);
ok(r.v4ok && r.version === 5 && r.hasFit && r.regions >= 1, 'BF8a v5 序列化含拟合并校验通过', r);
await send(ws, 'Page.navigate', { url: API + '/' });
await sleep(1800);
r = await ev(ws, `(async () => { ${HELP}
  const t0 = Date.now(); while ((!window.CatApp || !CatApp.state.samples.length) && Date.now() - t0 < 10000) await sleep(100);
  await sleep(300);
  const item = [...$('sampleList').querySelectorAll('.sample-item')].find(x => x.textContent.includes('fit-xred'));
  if (item) { item.click(); await sleep(250); }
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  const v3note = !$('fitV3Note').hidden;
  const noFit = !CatApp.state.fit || !CatApp.state.fit.regions.length;
  const samples = CatApp.state.samples.length;
  $('fitRMin').value = '24.4'; $('fitRMax').value = '26.3'; $('btnFitAddRegion').click(); await sleep(150);
  $('btnFitInitPeaks').click(); await sleep(250);
  $('btnFitRun').click(); await waitFit();
  await sleep(600); // save 防抖 350ms 落盘
  const saved = JSON.parse(localStorage.getItem('catplot.state.v1'));
  return { v3note, noFit, samples, savedVersion: saved.version, savedFit: !!(saved.state.fit && saved.state.fit.regions.length), fitStatus: $('fitStatus').textContent, hasResult: !!(CatApp.state.fit.regions[0] && CatApp.state.fit.regions[0].result) };
})()`);
ok(r.v3note && r.noFit && r.samples >= 1 && r.savedVersion === 5 && r.savedFit, 'BF8b v3 项目可打开（拟合为空+升级提示），拟合保存后升级 v5', r);
console.log('    BF8b detail:', JSON.stringify(r));
await send(ws, 'Page.navigate', { url: API + '/' });
await sleep(1800);
r = await ev(ws, `(async () => { ${HELP}
  const t0 = Date.now(); while ((!window.CatApp || !CatApp.state.samples.length) && Date.now() - t0 < 10000) await sleep(100);
  await sleep(300);
  const rg = CatApp.state.fit && CatApp.state.fit.regions[0];
  const dbg = { n: CatApp.state.fit ? CatApp.state.fit.regions.length : -1, res: CatApp.state.fit ? CatApp.state.fit.regions.map(x => !!x.result) : [], lv: (JSON.parse(localStorage.getItem('catplot.state.v1') || '{}').version) || null, pv: CatApp.state.projectVersion };
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  const restored = !!(rg && rg.result && rg.result.params.length);
  const rows = $('fitParamTable').querySelectorAll('tbody tr').length;
  CatApp.state.fit.dbVersion = 99; CatFitUI.refresh(); await sleep(120);
  const stale = !$('fitStaleBadge').hidden;
  CatApp.state.fit.dbVersion = 3; CatFitUI.refresh();
  return { restored, rows, stale, dbg };
})()`);
ok(r.restored && r.rows >= 1 && r.stale, 'BF9 刷新恢复拟合结果；库版本不一致→待更新标记', r);

await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(500);
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(300);
  $('toolFit').scrollIntoView({ block: 'start' }); await sleep(200);
  return { hScroll: document.documentElement.scrollWidth > innerWidth, iw: innerWidth, sw: document.documentElement.scrollWidth, chartW: $('fitChart').getBoundingClientRect().width };
})()`);
ok(!r.hScroll && r.chartW <= 390, 'BF10 移动端 390：拟合页无横向溢出', r);
ok(consoleErrors.length === 0, 'BF11 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 峰拟合浏览器验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
chrome.kill();
process.exit(fail ? 1 : 0);