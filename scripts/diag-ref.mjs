/* 诊断"加入参考"：粘贴+上传两条路径，捕获控制台/页面错误与状态。 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const API = 'http://127.0.0.1:4173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const profile = mkdtempSync(tmpdir() + '/diag-ref-');
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--window-size=1400,1000', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target; for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json(); target = l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (target) break; } catch {} await sleep(250); }
let id = 0; const pend = new Map(); const errs = [];
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('CON ' + m.params.args.map(a => a.value || a.description).join(' ')); };
const send = (me, pa) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: me, params: pa || {} })); });
const ev = async ex => { const r = await send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { PAGE_ERR: JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails) }; return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: API + '/' }); await sleep(1600);
const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(r => setTimeout(r, ms));`;

console.log('modules:', await ev(`({MC:!!window.CatMatchCore, MUI:!!window.CatMatchUI, CUI:!!window.CatCardsUI})`));

/* 路径1：物相匹配页 粘贴 → 加入参考 */
let r = await ev(`(async () => { ${HELP}
  document.querySelector('.tool-tab[data-tool="match"]').click(); await sleep(250);
  $('matchRefText').value = '# name=锐钛矿\\n25.28,100,101\\n37.80,40\\n48.05,50\\n';
  $('btnMatchAddRef').click(); await sleep(300);
  return { status: $('matchStatus').textContent, refs: (window.CatMatchUI?CatMatchUI.ui.refs.length:-1), refList: $('matchRefList').textContent.slice(0,60) };
})()`);
console.log('paste-add:', JSON.stringify(r));

/* 路径2：卡片抽屉 上传 → 轨道 */
r = await ev(`(async () => { ${HELP}
  $('btnCards').click(); await sleep(250);
  const f = new File(['# name=ZnO\\n31.7,60\\n34.4,50\\n36.2,100\\n'], 'zno.txt', { type: 'text/plain' });
  Object.defineProperty($('cardUpload'), 'files', { value: [f], configurable: true });
  $('cardUpload').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(600);
  return { upStatus: $('cardUploadStatus').textContent, sticks: window.CatCards.rt.sticks.length, refs: CatApp.state.refs.length };
})()`);
console.log('upload-add:', JSON.stringify(r));

/* 路径3：示例卡加入 */
r = await ev(`(async () => { ${HELP}
  const addBtn = document.querySelector('[data-exadd]');
  if (addBtn) addBtn.click(); await sleep(400);
  return { hasAddBtn: !!addBtn, sticks: window.CatCards.rt.sticks.length, refList: $('refList').textContent.slice(0,80) };
})()`);
console.log('example-add:', JSON.stringify(r));

console.log('errors:', errs.slice(0, 6));
ws.close(); chrome.kill(); process.exit(0);
