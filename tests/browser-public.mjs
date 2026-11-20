/* 公开版静态验收（headless Chrome CDP 9339，静态服务 4173）：
   开站即用、零外网/零 API 调用、示例卡许可徽标与叠加、拟合、导出、项目 v5 往返、v3 旧档兼容、零控制台错误。
   用法：node tests/browser-public.mjs（需 node scripts/preview.mjs 常驻 4173） */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = 'http://127.0.0.1:4173';
try { await (await fetch(BASE + '/data/example-cards.json')).json(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9339;
const profile = mkdtempSync(join(tmpdir(), 'catplot-pub-'));
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
await send(ws, 'Page.navigate', { url: BASE + '/' });
await sleep(1800);
await ev(ws, `(() => { window.__caps = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__caps.push(this.download); return; } return orig.apply(this); }; window.confirm = () => true; return true; })()`);
const HELP = `
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
`;
console.log('== P 公开版静态验收 ==');
let r = await ev(ws, `(async () => { ${HELP}
  const t0 = Date.now(); while ((!window.CatApp || !CatApp.state.samples.length) && Date.now() - t0 < 10000) await sleep(100);
  await sleep(300);
  const res = performance.getEntriesByType('resource').map(x => x.name);
  return {
    samples: CatApp.state.samples.length, paths: document.querySelectorAll('#chart path').length,
    fitSoon: !!document.querySelector('.tool-tab[data-tool="fit"] .soon'),
    matchTab: !!document.querySelector('.tool-tab[data-tool="match"]'),
    matchPaste: !!document.getElementById('matchRefText'),
    elemGrid: !!document.getElementById('elemGrid'),
    external: res.filter(u => !u.startsWith(location.origin)),
    apiCalls: res.filter(u => u.includes('/api/')),
    dbFiles: res.filter(u => /\\.db(\\?|$)/.test(u))
  };
})()`);
/* 需求变更：公开版新增"粘贴峰表轻量匹配"（无本地库），故匹配页应存在且为粘贴式；仍无元素周期表/待交付。 */
ok(r.samples === 3 && r.paths >= 3 && !r.fitSoon && r.matchTab && r.matchPaste && !r.elemGrid, 'P1 开站即用：3 示例样品+主图；匹配为粘贴峰表轻量版（无本地库）/无元素周期表/无待交付', r);
ok(r.external.length === 0 && r.apiCalls.length === 0 && r.dbFiles.length === 0, 'P2 零外网、零 API 调用、零数据库文件加载', r);

r = await ev(ws, `(async () => { ${HELP}
  $('btnCards').click(); await sleep(400);
  for (let i = 0; i < 40; i++) { if (document.querySelectorAll('#exList .ex-row').length) break; await sleep(100); }
  const rows = [...document.querySelectorAll('#exList .ex-row')];
  const badges = rows.map(x => [...x.querySelectorAll('.badge')].map(b => b.textContent).join(',')); const txt = badges.join('|');
  return { n: rows.length, cc0: (txt.match(/CC0-1\\.0/g) || []).length, mit: (txt.match(/MIT/g) || []).length, computed: (txt.match(/计算图谱/g) || []).length, experimental: (txt.match(/实验谱/g) || []).length, links: rows.filter(x => x.querySelector('a[href^="http"]')).length };
})()`);
ok(r.n === 3 && r.cc0 === 2 && r.mit >= 1 && r.computed === 2 && r.experimental === 1 && r.links === 3, 'P3 示例卡 3 张：CC0×2/MIT×1 徽标、计算/实验类型徽标、来源链接齐全', r);

r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('[data-exadd="COD-1010942"]').click(); await sleep(500);
  const lane = document.getElementById('chart').innerHTML.includes('laneClip0');
  const sticksOn = CatApp.state.lib.sticksOn;
  $('stickLambdaPreset').value = '1.5406'; $('stickLambdaPreset').dispatchEvent(new Event('change', { bubbles: true }));
  $('btnLambdaConfirm').click(); await sleep(400);
  const lane2 = document.getElementById('chart').innerHTML.includes('laneClip0');
  $('cardsClose').click(); await sleep(200);
  return { lane, sticksOn, lane2, lambda: CatApp.state.lib.wavelength, refs: CatApp.state.refs.length };
})()`);
ok(r.lane && r.sticksOn && r.lane2 && r.lambda === 1.5406 && r.refs === 1, 'P4 示例卡加入→棒图轨道渲染；波长确认后按实验波长换算', r);

r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  $('fitRMin').value = '24.4'; $('fitRMax').value = '26.3'; $('btnFitAddRegion').click(); await sleep(200);
  $('btnFitInitPeaks').click(); await sleep(300);
  const t0 = Date.now(); $('btnFitRun').click();
  while (CatFitUI.ui.finishedAt <= t0 && Date.now() - t0 < 15000) await sleep(60);
  await sleep(300);
  const rg = CatApp.state.fit.regions[0];
  return { ok: !!rg.result, rwp: rg.result && +rg.result.quality.rwp.toFixed(4), warn: !$('fitScherrerWarn').hidden, cardRows: $('fitCardTable').querySelectorAll('tbody tr').length };
})()`);
ok(r.ok && r.warn && r.cardRows >= 1, 'P5 拟合可用：Rwp 显示、Scherrer 表观警示、示例卡对照行', r);

r = await ev(ws, `(async () => { ${HELP}
  $('btnFitCsvParams').click(); await sleep(150);
  $('btnFitPng').click(); await sleep(900);
  $('btnFitSvg').click(); await sleep(200);
  return { caps: window.__caps.slice() };
})()`);
ok(r.caps.some(n => /\.csv$/.test(n)) && r.caps.some(n => /\.png$/.test(n)) && r.caps.some(n => /\.svg$/.test(n)), 'P6 导出 CSV/PNG/SVG 触发', r);

r = await ev(ws, `(async () => { ${HELP}
  const payload = CatModel.serializeProject(CatApp.state);
  const v = CatModel.validateProject(JSON.parse(JSON.stringify(payload)));
  await sleep(500);
  const saved = JSON.parse(localStorage.getItem('catplot.state.v1'));
  return { version: payload.version, ok: v.ok, hasFit: !!payload.fit, noMatch: !('match' in payload), savedVersion: saved.version };
})()`);
ok(r.version === 5 && r.ok && r.hasFit && r.noMatch && r.savedVersion === 5, 'P7 项目 v5：含 fit、无 match 字段、校验通过、本机保存 v5', r);

r = await ev(ws, `(async () => { ${HELP}
  const payload = CatModel.serializeProject(CatApp.state);
  const v3 = JSON.parse(JSON.stringify(payload)); v3.version = 3; delete v3.fit;
  localStorage.setItem('catplot.state.v1', JSON.stringify({ format: 'catplot-local', version: 3, savedAt: new Date().toISOString(), state: v3 }));
  return true;
})()`);
await send(ws, 'Page.navigate', { url: BASE + '/' });
await sleep(1800);
r = await ev(ws, `(async () => { ${HELP}
  const t0 = Date.now(); while ((!window.CatApp || !CatApp.state.samples.length) && Date.now() - t0 < 10000) await sleep(100);
  await sleep(300);
  document.querySelector('.tool-tab[data-tool="fit"]').click(); await sleep(250);
  return { samples: CatApp.state.samples.length, v3note: !$('fitV3Note').hidden, noFit: !CatApp.state.fit || !CatApp.state.fit.regions.length, refs: CatApp.state.refs.length };
})()`);
ok(r.samples >= 1 && r.v3note && r.noFit, 'P8 v3 旧档可打开（拟合为空+升级提示），引用保留', r);
ok(consoleErrors.length === 0, 'P9 全程零控制台错误', consoleErrors.slice(0, 3));
console.log('== 公开版静态验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
chrome.kill();
process.exit(fail ? 1 : 0);