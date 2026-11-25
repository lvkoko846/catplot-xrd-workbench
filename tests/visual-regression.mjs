import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const BASELINE = join(ROOT, 'tests', 'visual-baseline.json');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = process.env.CATPLOT_BASE_URL || 'http://127.0.0.1:4173/';
const PORT = 9355;
const profile = mkdtempSync(join(tmpdir(), 'catplot-visual-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let id = 0;
const pending = new Map();
const consoleErrors = [];
let ws;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(response.exceptionDetails.exception || {}));
  }
  return response.result.value;
}

async function waitFor(expression, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error('visual condition timed out: ' + expression);
}

async function getTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome target not ready');
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function captureExpression(overlaySelector) {
  return `(() => {
    const round = value => Math.round(value * 100) / 100;
    const box = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
    };
    const chart = document.getElementById('chart');
    const overlay = ${overlaySelector ? `document.querySelector(${JSON.stringify(overlaySelector)})` : 'null'};
    return {
      viewport: [innerWidth, innerHeight],
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      layout: {
        topbar: box('.topbar'),
        workbench: box('.layout.workbench'),
        samples: box('.samples-panel'),
        chartPanel: box('.chart-panel'),
        settings: box('.settings-panel'),
        chart: box('#chart')
      },
      chart: {
        viewBox: chart.getAttribute('viewBox'),
        ariaLabel: chart.getAttribute('aria-label'),
        paths: Array.from(chart.querySelectorAll('path[fill="none"]')).map(path => ({
          stroke: path.getAttribute('stroke'),
          width: path.getAttribute('stroke-width'),
          d: path.getAttribute('d')
        })),
        labels: Array.from(chart.querySelectorAll('text')).map(text => text.textContent.trim())
      },
      overlay: overlay ? {
        box: (() => { const r = overlay.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }; })(),
        hidden: overlay.hidden,
        heading: (overlay.querySelector('h2') || {}).textContent || '',
        cards: overlay.querySelectorAll('.ex-row, .demo-card').length,
        tabs: overlay.querySelectorAll('[role="tab"]').length,
        overflow: overlay.scrollWidth > overlay.clientWidth + 1
      } : null
    };
  })()`;
}

const scenarios = [
  { name: 'desktop-main', width: 1440, height: 960 },
  { name: 'mobile-main', width: 390, height: 844 },
  {
    name: 'mobile-drawer', width: 390, height: 844, overlay: '#cardsDrawer',
    prepare: `(async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      document.getElementById('btnCards').click();
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('#exList .ex-row').length === 3) return true;
        await sleep(50);
      }
      return false;
    })()`
  },
  {
    name: 'mobile-demo', width: 390, height: 844, overlay: '#demoModal .demo-modal',
    prepare: `(async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      document.getElementById('btnSampleTop').click();
      for (let i = 0; i < 100; i++) {
        const status = document.getElementById('demoStatus').textContent;
        if (!status.includes('正在读取') && document.querySelectorAll('#demoList .demo-card').length === 2) return true;
        await sleep(50);
      }
      return false;
    })()`
  }
];

function compare(actual, expected, path = '') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const exact = /viewport|scrollWidth|clientWidth|cards|tabs/.test(path);
    if (exact ? actual !== expected : Math.abs(actual - expected) > 2) {
      return path + ': expected ' + expected + ', got ' + actual;
    }
    return null;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return path + ': array length mismatch';
    for (let i = 0; i < expected.length; i++) {
      const diff = compare(actual[i], expected[i], path + '[' + i + ']');
      if (diff) return diff;
    }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return path + ': object mismatch';
    const keys = Object.keys(expected);
    for (const key of keys) {
      const diff = compare(actual[key], expected[key], path ? path + '.' + key : key);
      if (diff) return diff;
    }
    return null;
  }
  return actual === expected ? null : path + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual);
}

try {
  const target = await getTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(message.params.exceptionDetails));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  const observed = {};
  for (const scenario of scenarios) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: scenario.width < 500
    });
    await send('Page.navigate', { url: BASE_URL });
    await waitFor(`typeof CatApp !== 'undefined' && document.querySelectorAll('#chart path[fill="none"]').length >= 3`);
    if (scenario.prepare) await waitFor(scenario.prepare);
    const raw = await evaluate(captureExpression(scenario.overlay));
    raw.chart.paths = raw.chart.paths.map(path => ({ stroke: path.stroke, width: path.width, hash: hash(path.d) }));
    observed[scenario.name] = raw;
    if (scenario.width < 500 && raw.scrollWidth > scenario.width) {
      throw new Error(scenario.name + ': horizontal overflow ' + raw.scrollWidth + ' > ' + scenario.width);
    }
    if (raw.overlay && (raw.overlay.hidden || raw.overlay.overflow)) {
      throw new Error(scenario.name + ': overlay hidden or overflowing');
    }
    console.log('CAPTURE ' + scenario.name + ': ' + raw.chart.paths.length + ' chart paths');
  }

  const payload = { schema: 'catplot-visual-baseline/v1', scenarios: observed };
  if (process.env.VISUAL_UPDATE === '1') {
    writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n');
    console.log('UPDATED ' + BASELINE);
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    if (baseline.schema !== payload.schema) throw new Error('visual baseline schema mismatch');
    const names = Object.keys(baseline.scenarios);
    if (JSON.stringify(names) !== JSON.stringify(Object.keys(observed))) throw new Error('visual scenario list mismatch');
    for (const name of names) {
      const diff = compare(observed[name], baseline.scenarios[name], name);
      if (diff) throw new Error('visual regression: ' + diff);
      console.log('PASS ' + name);
    }
  }
  if (consoleErrors.length) throw new Error('console errors: ' + consoleErrors.slice(0, 3).join(' | '));
  console.log('VISUAL RESULT PASS');
} finally {
  if (ws) ws.close();
  chrome.kill();
}
