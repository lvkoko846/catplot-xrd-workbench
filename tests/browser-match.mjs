/* 物相匹配浏览器验收（pm-2-lite UI，headless Chrome CDP 9338，静态服务 4173 常驻）。
   用真实 XRED 双相谱（MIT）跑完整闭环：上传→寻峰→载入示例参考→匹配→确认锐钛矿→
   剩余峰续匹配→确认金红石→覆盖6+；候选排序/可靠性/得分非概率声明/移除/390px/零错误。
   用法：node tests/browser-match.mjs（需 4173 静态服务常驻） */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:4173';
try { await (await fetch(API + '/')).text(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const profile = mkdtempSync(join(tmpdir(), 'catplot-match-'));
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
await ev(ws, `(() => { window.confirm = () => true; return true; })()`);

console.log('== BM 物相匹配浏览器验收（真实 XRED 双相谱） ==');

/* BM1 面板 + 声明 */
let r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(250);
  return { pane: !$('toolMatch').hidden, scope: $('matchScope').textContent };
})()`);
ok(r.pane && r.scope.includes('不是物相存在概率') && r.scope.includes('剩余'), 'BM1 匹配面板可用+得分非概率+闭环声明', r);

/* 上传真实双相谱 + 寻峰 */
const csv = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'tio2-rutile-anatase.csv'), 'utf8');
r = await ev(ws, `(async () => { ${HELP}
  const f = new File([${JSON.stringify(csv)}], 'xred-mix.csv', { type: 'text/csv' });
  Object.defineProperty($('fileInput'), 'files', { value: [f], configurable: true });
  $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 60; i++) { await sleep(80); if (!$('impConfirm').disabled && $('impTable').querySelectorAll('tbody tr').length > 1) break; }
  $('impConfirm').click(); await sleep(350);
  const item = [...$('sampleList').querySelectorAll('.sample-item')].find(x => x.textContent.includes('xred-mix'));
  item.click(); await sleep(250);
  /* 寻峰：绝对峰高下限 50 抑制噪声 */
  const s = CatApp.getSelected();
  s.peaks.params.minHeight = 50; s.peaks.params.smooth = 9; s.peaks.params.minDist = 0.3;
  const AN = window.CatAnalysis;
  const pr = AN.findPeaks(s.working.x, s.working.y, s.peaks.params);
  s.peaks.list = pr.peaks.map((p, i) => ({ id: 'p' + i, x: p.x, height: p.height, source: 'auto', index: p.i }));
  CatApp.renderAll(); await sleep(200);
  return { nPeaks: s.peaks.list.length, top: s.peaks.list.slice(0, 3).map(p => +p.x.toFixed(2)) };
})()`);
ok(r.nPeaks >= 6, 'BM2 真实谱上传+寻峰（≥6峰）', r);

/* BM3 载入示例参考 + 运行匹配 */
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(200);
  $('btnMatchExample').click(); await sleep(200);
  $('btnMatchRun').click(); await sleep(300);
  const c = CatMatchUI.ui.last.candidates;
  return { refs: CatMatchUI.ui.refs.length, cands: c.map(x => ({ name: x.name, score: x.score, matched: x.matched, reliable: x.reliable })), rows: $('matchCandTable').querySelectorAll('tbody tr').length };
})()`);
ok(r.refs === 2 && r.rows === 2 && r.cands.some(x => x.name === '锐钛矿' && x.matched >= 3), 'BM3 示例双参考匹配出候选（锐钛矿≥3峰）', r);

/* BM4 确认锐钛矿 → 覆盖核算 */
r = await ev(ws, `(async () => { ${HELP}
  const idx = CatMatchUI.ui.last.candidates.findIndex(x => x.name === '锐钛矿');
  $('matchCandTable').querySelector('[data-mconfirm="' + idx + '"]').click(); await sleep(250);
  return { phases: CatMatchUI.ui.phases.map(p => p.name), cov: $('matchCoverage').textContent };
})()`);
ok(r.phases.includes('锐钛矿') && /剩余未解释 [1-9]/.test(r.cov), 'BM4 确认锐钛矿+剩余峰核算', r);

/* BM5 剩余峰续匹配 → 金红石置顶 → 确认 → 覆盖叠加 */
r = await ev(ws, `(async () => { ${HELP}
  $('btnMatchRemaining').click(); await sleep(300);
  const c = CatMatchUI.ui.last.candidates;
  const top = c[0];
  const idx = c.findIndex(x => x.name === '金红石');
  $('matchCandTable').querySelector('[data-mconfirm="' + idx + '"]').click(); await sleep(250);
  return { topName: top.name, topMatched: top.matched, phases: CatMatchUI.ui.phases.map(p => p.name), cov: $('matchCoverage').textContent };
})()`);
ok(r.topName === '金红石' && r.topMatched >= 2 && r.phases.includes('金红石') && /已解释 [4-9]/.test(r.cov), 'BM5 剩余峰续匹配金红石置顶+确认+覆盖叠加', r);

/* BM6 移除物相 → 覆盖回退 */
r = await ev(ws, `(async () => { ${HELP}
  const before = CatMatchUI.ui.phases.length;
  $('matchPhaseList').querySelector('[data-mphdel="1"]').click(); await sleep(200);
  return { before, after: CatMatchUI.ui.phases.length, cov: $('matchCoverage').textContent };
})()`);
ok(r.after === r.before - 1, 'BM6 移除物相覆盖回退', r);

/* BM7 粘贴自定义参考解析（坏行报错） */
r = await ev(ws, `(async () => { ${HELP}
  $('matchRefText').value = '# name=自定义\\n25.28,100\\nbad,row\\n';
  $('btnMatchAddRef').click(); await sleep(200);
  return { status: $('matchStatus').textContent, refs: CatMatchUI.ui.refs.length };
})()`);
ok(/行3|非数值/.test(r.status), 'BM7 粘贴坏行给具体原因', r);

/* BM8 390px 无溢出 */
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
r = await ev(ws, `(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(250);
  return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 };
})()`);
ok(!r.overflow, 'BM8 移动端390匹配面板无溢出', r);
await send(ws, 'Emulation.clearDeviceMetricsOverride');

/* BM9 零控制台错误 */
ok(consoleErrors.length === 0, 'BM9 全程零控制台错误', consoleErrors.slice(0, 3));

console.log('== 物相匹配浏览器验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
