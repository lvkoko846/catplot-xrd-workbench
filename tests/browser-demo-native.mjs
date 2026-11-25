import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XRDML_LIST, XRDML_RANGE, XRDML_COMMON_ONLY, XRDML_BAD_LENGTH, XRDML_BAD_XML, XRDML_ENTITY, RAS_TEXT, makeSPA } from './vendor-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:4173';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9343;
try { await (await fetch(BASE + '/')).text(); } catch { console.error('前置失败：4173 静态服务未运行'); process.exit(1); }

const profile = mkdtempSync(join(tmpdir(), 'catplot-demo-native-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT, '--window-size=1280,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pass = 0, fail = 0;
function ok(condition, name, extra) {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
async function getTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
      const page = list.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 未就绪');
}
let id = 0;
const pending = new Map();
const consoleErrors = [];
function send(ws, method, params) {
  return new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params: params || {} }));
  });
}
async function ev(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception || result.exceptionDetails));
  return result.result.value;
}
async function upload(ws, filePath) {
  const document = await send(ws, 'DOM.getDocument', { depth: -1 });
  const node = await send(ws, 'DOM.querySelector', { nodeId: document.root.nodeId, selector: '#fileInput' });
  await send(ws, 'DOM.setFileInputFiles', { nodeId: node.nodeId, files: [filePath] });
}

let ws;
try {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
  };
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'DOM.enable');
  await send(ws, 'Page.navigate', { url: BASE + '/' });
  await sleep(1800);
  const HELP = `const $ = id => document.getElementById(id); const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));`;
  await ev(ws, `(() => { window.confirm = () => true; return true; })()`);
  console.log('== DN 四表征演示 + 原生格式浏览器验收 ==');

  let result = await ev(ws, `(async () => { ${HELP}
    const deadline = Date.now() + 10000;
    while ((!window.CatApp || !CatApp.state.samples.length) && Date.now() < deadline) await sleep(100);
    $('btnSampleTop').click();
    const ready = Date.now() + 10000;
    while (!$('demoStatus').textContent.includes('当前：') && Date.now() < ready) await sleep(100);
    const tabs = [...$('demoTechTabs').querySelectorAll('button')];
    const counts = tabs.map(tab => { tab.click(); return { label: tab.textContent, cards: $('demoList').querySelectorAll('.demo-card').length, sources: $('demoList').querySelectorAll('a[href^="https://"]').length }; });
    tabs.find(tab => tab.textContent === '拉曼').click();
    $('demoList').querySelector('.demo-card button').click();
    await sleep(400);
    const sample = CatApp.state.samples[0];
    return { tabs: tabs.length, counts, technique: CatApp.state.technique, source: sample.source, points: sample.raw.x.length, license: sample.importMeta.license, dataset: sample.importMeta.datasetId, bg: sample.bg.mode, undo: !$('btnUndo').disabled, closed: $('demoModal').hidden };
  })()`);
  ok(result.tabs === 4 && result.counts.every(item => item.cards > 0 && item.sources > 0), 'DN1 四表征均有可加载演示且保留来源链接', result);
  ok(result.technique === 'raman' && result.source === 'demo' && result.points === 1941 && result.license === 'MIT' && result.bg === 'snip' && result.undo && result.closed, 'DN2 拉曼真实实验谱一键加载：许可/点数/推荐背景/可撤销', result);

  result = await ev(ws, `(async () => { ${HELP}
    $('btnUndo').click(); await sleep(350);
    const restored = { count: CatApp.state.samples.length, technique: CatApp.state.technique };
    $('btnSampleTop').click(); await sleep(250);
    $('demoList').querySelector('.demo-card button').click(); await sleep(350);
    return { restored, count: CatApp.state.samples.length, technique: CatApp.state.technique };
  })()`);
  ok(result.restored.count === 3 && result.restored.technique === 'xrd' && result.count === 3 && result.technique === 'xrd', 'DN3 演示替换可撤销；模拟系列仍明确为 XRD', result);

  await upload(ws, join(ROOT, 'tests/fixtures/real/MiniDIFDUP.JDX'));
  result = await ev(ws, `(async () => { ${HELP}
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const meta = $('impNativeMeta').textContent;
    const warnings = $('impWarnings').textContent;
    const physical = $('impTable').querySelector('tbody tr td').textContent;
    const controlsHidden = ['impDelimField','impSkipField','impXField','impYField'].every(id => $(id).hidden);
    $('impConfirm').click(); await sleep(500);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    const payload = CatModel.serializeProject(CatApp.state);
    const validation = CatModel.validateProject(JSON.parse(JSON.stringify(payload)));
    return { meta, warnings, physical, controlsHidden, count: CatApp.state.samples.length, source: sample.source, raw: sample.raw.x.length,
      firstX: sample.raw.x[0], lastX: sample.raw.x[sample.raw.x.length - 1], firstSource: sample.raw.sourceLineNos[0], lastLogical: sample.raw.lineNos[sample.raw.lineNos.length - 1],
      sortApplied: sample.importMeta.sortApplied, native: sample.importMeta.native, valid: validation.ok, errors: validation.errors };
  })()`);
  ok(result.meta.includes('JCAMP-DX') && result.meta.includes('0.00048828125') && result.meta.includes('0.01220703125') && result.meta.includes('按首末点重建') && result.controlsHidden, 'DN4 JCAMP 元数据、因子与 X 重建策略在预览可见', result);
  ok(result.warnings.includes('DELTAX') && result.warnings.includes('MAXY') && result.warnings.includes('MINY') && result.physical === '17', 'DN5 冲突元数据明确告警；预览显示原文件物理行', result);
  ok(result.count === 4 && result.source === 'file' && result.raw === 584 && Math.abs(result.firstX - 2373.973) < 1e-9 && Math.abs(result.lastX - 1804.104) < 1e-6 && result.firstSource === 17 && result.lastLogical === 584 && result.sortApplied === 'asc' && result.valid, 'DN6 真实 JCAMP 导入：584 点、X 端点、物理/逻辑行号、raw 独立排序与项目校验', result);

  await upload(ws, join(ROOT, 'tests/fixtures/real/BT86_.UXD'));
  result = await ev(ws, `(async () => { ${HELP}
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const meta = $('impNativeMeta').textContent;
    $('impConfirm').click(); await sleep(500);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    const validation = CatModel.validateProject(JSON.parse(JSON.stringify(CatModel.serializeProject(CatApp.state))));
    return { meta, format: sample.importMeta.format, count: CatApp.state.samples.length, raw: sample.raw.x.length, firstX: sample.raw.x[0], lastX: sample.raw.x[sample.raw.x.length - 1], sourceLines: sample.raw.sourceLineNos.length, nativeSample: sample.importMeta.native.sample, anode: sample.importMeta.native.anode, valid: validation.ok, errors: validation.errors };
  })()`);
  ok(result.meta.includes('Bruker UXD') && result.meta.includes('BT86') && result.format === 'uxd' && result.count === 5 && result.raw === 2374 && result.firstX === 3 && result.lastX === 40 && result.sourceLines === 2374 && result.nativeSample === 'BT86' && result.anode === 'Cu' && result.valid, 'DN7 真实 Bruker UXD：2374 点、仪器元数据与项目校验完整通过', result);

  result = await ev(ws, `(async () => { ${HELP}
    const file = new File(['_SAMPLE=bad\\n_2THETACOUNTS\\n10 1\\nbroken\\n12 3\\n'], 'bad.uxd', { type: 'text/plain' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const before = { disabled: $('impConfirm').disabled, errors: $('impErrorList').textContent, summary: $('impSummary').textContent };
    $('impAck').click(); await sleep(150);
    const afterAck = !$('impConfirm').disabled;
    $('impConfirm').click(); await sleep(400);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    return { before, afterAck, raw: sample.raw.x.length, sourceLines: sample.raw.sourceLineNos, skipped: sample.importMeta.skippedRows.length };
  })()`);
  ok(result.before.disabled && result.before.errors.includes('第 4 行') && result.before.summary.includes('有效数据点 2') && result.afterAck, 'DN8 UXD 坏行必须显式确认才能导入，错误定位到物理行 4', result);
  ok(result.raw === 2 && result.sourceLines.join(',') === '3,5' && result.skipped === 1, 'DN9 确认后仅导入合法点，原始物理行映射与跳过记录保留', result);

  result = await ev(ws, `(async () => { ${HELP}
    const count = CatApp.state.samples.length;
    const file = new File(['##TITLE=bad\\n##JCAMP-DX=5.00\\n##XYDATA=(X++(Y..Y))\\n0 A ? B\\n##END=\\n'], 'bad.jdx', { type: 'text/plain' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    return { count: CatApp.state.samples.length, added: CatApp.state.samples.length - count, fatalHidden: $('impFatal').hidden, fatal: $('impFatal').textContent, disabled: $('impConfirm').disabled };
  })()`);
  ok(result.added === 0 && !result.fatalHidden && result.fatal.includes('无法识别') && result.disabled, 'DN10 损坏 JCAMP 明确失败，不产生部分谱', result);

  result = await ev(ws, `(async () => { ${HELP}
    $('impCancel').click();
    const file = new File([${JSON.stringify(XRDML_LIST)}], 'synthetic-list.xrdml', { type: 'application/xml' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const before = { meta: $('impNativeMeta').textContent, summary: $('impSummary').textContent, header: $('impTable').querySelector('thead th').textContent, firstRecord: $('impTable').querySelector('tbody tr td').textContent };
    $('impConfirm').click(); await sleep(450);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    const validation = CatModel.validateProject(JSON.parse(JSON.stringify(CatModel.serializeProject(CatApp.state))));
    return { before, format: sample.importMeta.format, x: sample.raw.x, y: sample.raw.y, lineNos: sample.raw.lineNos, sourceLines: sample.raw.sourceLineNos,
      native: sample.importMeta.native, trace: $('smpTraceBody').textContent, valid: validation.ok, errors: validation.errors };
  })()`);
  ok(result.before.meta.includes('PANalytical XRDML') && result.before.meta.includes('Synthetic XRD list') && result.before.meta.includes('45 kV') && result.before.header === '记录序号' && result.before.firstRecord === '1' && result.before.summary.includes('逻辑记录'), 'DN14 XRDML 列表轴、扫描轴选择与元数据在预览可见', result);
  ok(result.format === 'xrdml' && result.x.join(',') === '10,11,12,13' && result.y.join(',') === '20,80,60,40' && result.lineNos.join(',') === '1,2,3,4' && result.sourceLines === undefined && result.native.selectedAxis === '2Theta' && result.native.scanCount === 1 && result.native.attenuationApplied && result.native.commonPositions[0].value === 0.25 && result.trace.includes('不伪造物理文本行号') && result.valid, 'DN15 XRDML counts×衰减、commonPosition 与逻辑记录追溯完整通过', result);

  result = await ev(ws, `(async () => { ${HELP}
    const file = new File([${JSON.stringify(XRDML_RANGE)}], 'synthetic-range.xrdml', { type: 'application/xml' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const direct = CatParser.analyzeNative(${JSON.stringify(XRDML_RANGE)}, 'xrdml', { duplicateMode: 'keep', sortMode: 'sort' });
    const before = { warnings: $('impWarnings').textContent, fatal: $('impFatal').textContent, summary: $('impSummary').textContent, file: $('impFileMeta').textContent, hidden: $('importModal').hidden, disabled: $('impConfirm').disabled };
    $('impConfirm').click(); await sleep(400);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    return { before, direct: { fatal: direct.fatal, warnings: direct.warnings, points: direct.points }, warnings: $('impWarnings').textContent, x: sample.raw.x, y: sample.raw.y, axis: sample.importMeta.native.selectedAxis, mode: sample.importMeta.native.intensityMode };
  })()`);
  ok(result.warnings.includes('优先采用 intensities') && result.x.join(',') === '20,22,24' && result.y.join(',') === '5,6,7' && result.axis === 'Omega' && result.mode === 'intensities', 'DN16 XRDML 前缀命名空间、起止轴重建与 intensities 优先级通过', result);

  result = await ev(ws, `(async () => { ${HELP}
    const count = CatApp.state.samples.length;
    const cases = [
      ['only-common', ${JSON.stringify(XRDML_COMMON_ONLY)}, '变化轴'],
      ['bad-length', ${JSON.stringify(XRDML_BAD_LENGTH)}, '长度不一致'],
      ['bad-xml', ${JSON.stringify(XRDML_BAD_XML)}, '语法损坏'],
      ['entity', ${JSON.stringify(XRDML_ENTITY)}, 'DOCTYPE/ENTITY']
    ];
    const outcomes = [];
    for (const [name, text, expected] of cases) {
      const file = new File([text], name + '.xrdml', { type: 'application/xml' });
      Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
      $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
      const deadline = Date.now() + 10000;
      while ($('importModal').hidden && Date.now() < deadline) await sleep(50);
      outcomes.push({ name, fatal: $('impFatal').textContent, meta: $('impNativeMeta').textContent, disabled: $('impConfirm').disabled, added: CatApp.state.samples.length - count });
      $('impCancel').click();
    }
    return outcomes;
  })()`);
  ok(result.length === 4 && result.every(item => item.disabled && item.fatal.length > 0 && item.added === 0 && !/NaN|undefined/.test(item.meta)), 'DN17 全 common、长度冲突、坏 XML 与实体声明均明确失败且不导入', result);

  result = await ev(ws, `(async () => { ${HELP}
    const file = new File([${JSON.stringify(RAS_TEXT)}], 'synthetic.ras', { type: 'text/plain' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const before = { meta: $('impNativeMeta').textContent, summary: $('impSummary').textContent, header: $('impTable').querySelector('thead th').textContent, errors: $('impErrorList').textContent, disabled: $('impConfirm').disabled };
    $('impAck').click(); await sleep(120);
    const afterAck = !$('impConfirm').disabled;
    $('impConfirm').click(); await sleep(450);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    const validation = CatModel.validateProject(JSON.parse(JSON.stringify(CatModel.serializeProject(CatApp.state))));
    return { before, afterAck, format: sample.importMeta.format, x: sample.raw.x, y: sample.raw.y, lineNos: sample.raw.lineNos, sourceLines: sample.raw.sourceLineNos, skipped: sample.importMeta.skippedRows.length, valid: validation.ok, errors: validation.errors };
  })()`);
  ok(result.before.meta.includes('Rigaku RAS') && result.before.meta.includes('第 2 列 ÷ 第 3 列') && result.before.header === '文件行号' && result.before.errors.includes('第 28 行') && result.before.disabled && result.afterAck, 'DN18 RAS Y 列策略、物理行错误定位与显式坏行确认通过', result);
  ok(result.format === 'ras' && result.x.join(',') === '10,11,13' && result.y.join(',') === '50,30,80' && result.lineNos.join(',') === '1,2,5' && result.sourceLines.join(',') === '26,27,30' && result.skipped === 2 && result.valid, 'DN19 RAS 合法点、原始物理行映射与项目校验完整通过', result);

  const spaTimestamp = Math.floor(Date.UTC(2020, 0, 2, 3, 4, 5) / 1000) + 2209075200;
  const spaBase64 = Buffer.from(makeSPA({ firstX: 100, lastX: 400, values: [4, 3, 2, 1], timestamp: spaTimestamp, title: 'Browser SPA fixture' })).toString('base64');
  result = await ev(ws, `(async () => { ${HELP}
    const bytes = Uint8Array.from(atob('${spaBase64}'), c => c.charCodeAt(0));
    const file = new File([bytes], 'synthetic.spa', { type: 'application/octet-stream' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    const before = { meta: $('impNativeMeta').textContent, summary: $('impSummary').textContent, header: $('impTable').querySelector('thead th').textContent, hidden: $('importModal').hidden, fatal: $('impFatal').textContent };
    $('impConfirm').click(); await sleep(450);
    const sample = CatApp.state.samples[CatApp.state.samples.length - 1];
    const validation = CatModel.validateProject(JSON.parse(JSON.stringify(CatModel.serializeProject(CatApp.state))));
    return { before, format: sample.importMeta.format, rawX: sample.raw.x, rawY: sample.raw.y, workX: sample.working.x, workY: sample.working.y,
      sourceLines: sample.raw.sourceLineNos, sortApplied: sample.importMeta.sortApplied, native: sample.importMeta.native, valid: validation.ok, errors: validation.errors };
  })()`);
  ok(result.before.meta.includes('OMNIC/OPUS SPA') && result.before.meta.includes('Browser SPA fixture') && result.before.meta.includes('Absorbance') && result.before.header === '记录序号' && result.before.summary.includes('逻辑记录'), 'DN20 SPA 二进制上传、单位/标题元数据与记录序号预览通过', result);
  ok(result.format === 'spa' && result.rawX.join(',') === '400,300,200,100' && result.rawY.join(',') === '4,3,2,1' && result.workX.join(',') === '100,200,300,400' && result.workY.join(',') === '1,2,3,4' && result.sourceLines === undefined && result.sortApplied === 'asc' && result.native.dateMeasured === '2020-01-02T03:04:05.000Z' && result.valid, 'DN21 SPA 载荷方向、raw 不变、独立升序副本与项目校验完整通过', result);

  const ifgBase64 = Buffer.from(makeSPA({ xUnit: 0x02, yUnit: 0x16 })).toString('base64');
  result = await ev(ws, `(async () => { ${HELP}
    const bytes = Uint8Array.from(atob('${ifgBase64}'), c => c.charCodeAt(0));
    const file = new File([bytes], 'interferogram.spa', { type: 'application/octet-stream' });
    Object.defineProperty($('fileInput'), 'files', { value: [file], configurable: true });
    $('fileInput').dispatchEvent(new Event('change', { bubbles: true }));
    const deadline = Date.now() + 10000;
    while ($('importModal').hidden && Date.now() < deadline) await sleep(100);
    return { count: CatApp.state.samples.length, fatal: $('impFatal').textContent, meta: $('impNativeMeta').textContent, disabled: $('impConfirm').disabled, hidden: $('importModal').hidden };
  })()`);
  ok(result.fatal.includes('干涉图') && result.disabled && !/NaN|undefined/.test(result.meta), 'DN22 SPA 独立干涉图明确拒绝，不伪装为光谱', result);
  await ev(ws, `(() => { document.getElementById('impCancel').click(); return true; })()`);
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  result = await ev(ws, `(async () => { ${HELP}
    $('btnSampleTop').click(); await sleep(350);
    const modal = document.querySelector('#demoModal .demo-modal').getBoundingClientRect();
    const tabs = $('demoTechTabs').getBoundingClientRect();
    return { width: modal.width, viewport: innerWidth, left: modal.left, right: modal.right, tabsVisible: tabs.width > 0 && tabs.right <= innerWidth + 1, bodyFits: document.documentElement.scrollWidth <= innerWidth + 1 };
  })()`);
  ok(result.width <= result.viewport && result.left >= 0 && result.right <= result.viewport + 1 && result.tabsVisible && result.bodyFits, 'DN11 390px 移动端演示弹窗不横向溢出且表征标签可用', result);

  result = await ev(ws, `(() => { const external = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => !url.startsWith(location.origin)); return { count: external.length, urls: external }; })()`);
  ok(result.count === 0, 'DN12 演示与原生导入零外部资源请求', result);
  ok(consoleErrors.length === 0, 'DN13 全程零控制台错误', consoleErrors.slice(0, 3));
  console.log('== 演示与原生格式浏览器验收汇总 == 通过 ' + pass + ' / ' + (pass + fail));
  if (fail) process.exitCode = 1;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill();
}
