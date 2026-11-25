import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {}, console, Map, Set, Math, Number, String, Array, Object, JSON, isFinite, Infinity, NaN, Date, RegExp };
vm.createContext(sandbox);
for (const file of ['js/model.js', 'js/parser.js']) vm.runInContext(readFileSync(join(ROOT, 'web', file), 'utf8'), sandbox, { filename: file });
const M = sandbox.window.CatModel, P = sandbox.window.CatParser;
const opts = { duplicateMode: 'keep', sortMode: 'sort' };
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + ' 实际 ' + JSON.stringify(a));
}
function ok(value, msg) { if (!value) throw new Error(msg || '断言失败'); }
function closeArray(a, b, tolerance = 1e-9) {
  eq(a.length, b.length, '数组长度');
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tolerance * Math.max(1, Math.abs(a[i]), Math.abs(b[i]))) throw new Error(`索引 ${i}: ${a[i]} != ${b[i]}`);
}
function header(extra = '') {
  return '##TITLE=Native fixture\n##JCAMP-DX=5.00\n##XUNITS=2theta (deg)\n##YUNITS=Intensity\n' + extra;
}

console.log('\n== 原生格式真值与边界 ==');
t('N1 格式识别：内容优先，扩展名兜底', () => {
  eq(P.detectFormat('10 1\n11 2', 'a.csv'), 'table');
  eq(P.detectFormat(header(), 'unknown.bin'), 'jcamp');
  eq(P.detectFormat('_2THETACOUNTS\n10 1', 'unknown.bin'), 'uxd');
  eq(P.detectFormat('', 'a.JCAMP'), 'jcamp');
  eq(P.detectFormat('', 'a.UXD'), 'uxd');
});

t('N2 真实 Bruker UXD：2374 点与独立提取文本逐点一致', () => {
  const text = readFileSync(join(ROOT, 'tests/fixtures/real/BT86_.UXD'), 'utf8');
  const truth = readFileSync(join(ROOT, 'tests/fixtures/real/BT86_xrd.txt'), 'utf8').trim().split(/\r?\n/).map(line => line.trim().split(/\s+/).map(Number));
  const r = P.analyzeNative(text, 'uxd', opts);
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.length, 2374);
  closeArray(r.rawPoints.map(p => p.x), truth.map(p => p[0]));
  closeArray(r.rawPoints.map(p => p.y), truth.map(p => p[1]));
  eq(r.native.sample, 'BT86');
  eq(r.native.anode, 'Cu');
  eq(r.native.wavelength, 1.5406);
  ok(r.rawPoints[0].sourceLine > 0, 'UXD 首点应保留物理行号');
  eq(r.rawPoints.map(p => p.lineNo), Array.from({ length: 2374 }, (_, i) => i + 1));
});

t('N3 JCAMP AFFN X++(Y..Y)：DELTAX 重建全部 X', () => {
  const text = header('##FIRSTX=10\n##LASTX=14\n##DELTAX=1\n##NPOINTS=5\n##XYDATA=(X++(Y..Y))\n') + '10 1 2 3\n13 4 5\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.map(p => p.x), [10, 11, 12, 13, 14]);
  eq(r.rawPoints.map(p => p.y), [1, 2, 3, 4, 5]);
  eq(r.native.nPoints, 5);
  eq(r.warnings, []);
});

t('N4 JCAMP PAC XYPOINTS 与 PEAK TABLE 支持科学计数法', () => {
  for (const guide of ['XYPOINTS=(XY..XY)', 'PEAK TABLE=(XY..XY)']) {
    const text = header('##NPOINTS=3\n##' + guide + '\n') + '1e1 1E2 1.1e1 -2.5e-1 12 +3\n##END=\n';
    const r = P.analyzeNative(text, 'jcamp', opts);
    ok(!r.fatal, r.fatal);
    eq(r.rawPoints.map(p => p.x), [10, 11, 12]);
    eq(r.rawPoints.map(p => p.y), [100, -0.25, 3]);
  }
});

t('N4b JCAMP XFACTOR/YFACTOR：XYPOINTS 与 X++(Y..Y) 均按元数据缩放', () => {
  const pair = header('##XFACTOR=0.1\n##YFACTOR=10\n##FIRSTY=100\n##XYPOINTS=(XY..XY)\n') + '10 10 11 20\n##END=\n';
  const pr = P.analyzeNative(pair, 'jcamp', opts);
  ok(!pr.fatal, pr.fatal);
  eq(pr.rawPoints.map(p => [p.x, p.y]), [[1, 100], [1.1, 200]]);
  eq(pr.native.xFactor, 0.1);
  eq(pr.native.yFactor, 10);

  const xyy = header('##FIRSTX=1\n##LASTX=1.1\n##DELTAX=0.1\n##NPOINTS=2\n##XFACTOR=0.1\n##YFACTOR=10\n##FIRSTY=100\n##MAXY=110\n##MINY=100\n##XYDATA=(X++(Y..Y))\n') + '10 A@ J\n##END=\n';
  const xr = P.analyzeNative(xyy, 'jcamp', opts);
  ok(!xr.fatal, xr.fatal);
  eq(xr.rawPoints.map(p => [p.x, p.y]), [[1, 100], [1.1, 110]]);
  eq(xr.warnings, []);

  const rawFirstY = xyy.replace('##FIRSTY=100', '##FIRSTY=10');
  const rr = P.analyzeNative(rawFirstY, 'jcamp', opts);
  eq(rr.rawPoints[0].y, 100);
  ok(!rr.warnings.some(w => w.startsWith('FIRSTY')), 'FIRSTY 元数据可为未缩放值');
});

t('N4c JCAMP X++(Y..Y)：FIRSTX/LASTX/NPOINTS 优先重建规则 X', () => {
  const text = header('##FIRSTX=1\n##LASTX=1.1\n##NPOINTS=2\n##XYDATA=(X++(Y..Y))\n') + '10 A A\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  ok(!r.fatal, r.fatal);
  closeArray(r.rawPoints.map(p => p.x), [1, 1.1]);
  ok(Math.abs(r.native.xStep - 0.1) < 1e-12, 'X 重建步长');
  eq(r.warnings, []);
});

t('N5 SQZ：正负伪数字与首位映射', () => {
  const text = header('##DELTAX=1\n##NPOINTS=7\n##XYDATA=(X++(Y..Y))\n') + '0 @ A a B b A@ AA AB\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.map(p => p.y), [0, 1, -1, 2, -2, 10, 11, 12]);
  ok(r.warnings.some(w => w.includes('实际导入 8')), '声明点数不一致需警告');
});

t('N6 DIF 与 DIFDUP：差分累加，DUP 计数包含原值', () => {
  const text = header('##DELTAX=1\n##NPOINTS=5\n##XYDATA=(X++(Y..Y))\n') + '0 A@ J T % J\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.map(p => p.y), [10, 11, 12, 12, 13]);
  eq(r.rawPoints.map(p => p.x), [0, 1, 2, 3, 4]);
});

t('N7 DIF 行尾 literal 校验策略与校验值比较', () => {
  const text = header('##DELTAX=1\n##NPOINTS=5\n##XYDATA=(X++(Y..Y))\n') + '10 A@ J J j\n13 AB AC\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.map(p => p.y), [10, 11, 12, 12, 13]);
  ok(r.warnings.some(w => w.includes('校验值')), '应显示 DIF 校验策略');
  ok(r.warnings.some(w => w.includes('不一致')), '末项 11 与下一行首值 12 不一致');
});

t('N8 DIF relayed 校验策略：按 NPOINTS 选择', () => {
  const text = header('##DELTAX=1\n##NPOINTS=5\n##XYDATA=(X++(Y..Y))\n') + '10 A@ J J %\n13 AB AC\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.map(p => p.y), [10, 11, 12, 12, 13]);
  ok(r.warnings.some(w => w.includes('DIF 行尾校验值')), '应说明 relayed 校验策略');
  ok(!r.warnings.some(w => w.includes('不一致')), 'relayed 校验值不应误报');
});

t('N9 原生物理行号与逻辑行号分离', () => {
  const text = header('##DELTAX=1\n##NPOINTS=3\n##XYDATA=(X++(Y..Y))\n') + '0 A A A\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', opts);
  eq(r.rawPoints.map(p => p.lineNo), [1, 2, 3]);
  eq(r.rawPoints.map(p => p.sourceLine), [8, 8, 8]);
  eq(r.preview.length, 3);
  eq(r.preview[0].sourceLine, 8);
});

t('N10 原生解析仍执行重复 X 检测、显式合并与 raw 不变', () => {
  const text = header('##NPOINTS=4\n##XYPOINTS=(XY..XY)\n') + '2 4 1 2 2 8 3 10\n##END=\n';
  const r = P.analyzeNative(text, 'jcamp', { duplicateMode: 'merge', sortMode: 'sort' });
  eq(r.rawPoints.map(p => p.x), [2, 1, 2, 3]);
  eq(r.points.map(p => p.x), [1, 2, 3]);
  eq(r.points.map(p => p.y), [2, 6, 10]);
  eq(r.sortApplied, 'asc');
  eq(r.merged.length, 1);
  eq(r.merged[0].lineNos, [1, 3]);
});

t('N11 损坏输入明确失败，不静默产出部分谱', () => {
  const cases = [
    ['未知压缩字符', header('##DELTAX=1\n##XYDATA=(X++(Y..Y))\n') + '0 A ? B\n##END=\n'],
    ['缺少 DELTAX', header('##XYDATA=(X++(Y..Y))\n') + '0 A B\n##END=\n'],
    ['DIF 首值', header('##DELTAX=1\n##XYDATA=(X++(Y..Y))\n') + '0 J A\n##END=\n'],
    ['DUP 无前值', header('##DELTAX=1\n##XYDATA=(X++(Y..Y))\n') + '0 T\n##END=\n'],
    ['UXD 缺少数据段', '_SAMPLE=x\n'],
    ['多区块', header() + '##XYPOINTS=(XY..XY)\n1 2\n##END=\n##TITLE=second\n##XYPOINTS=(XY..XY)\n2 3\n##END=\n']
  ];
  for (const [name, text] of cases) {
    const r = P.analyzeNative(text, name.includes('UXD') ? 'uxd' : 'jcamp', opts);
    ok(r.fatal, name + ' 应 fatal');
    eq(r.points.length, 0, name + ' 不应导入部分点');
  }
});

t('N12 UXD 无效物理行需确认，合法行保留独立映射', () => {
  const text = '_SAMPLE=bad\n_2THETACOUNTS\n10 1\nbroken\n12 3\n';
  const r = P.analyzeNative(text, 'uxd', opts);
  eq(r.errors.length, 1);
  eq(r.errors[0].lineNo, 4);
  eq(r.rawPoints.map(p => p.sourceLine), [3, 5]);
  const sample = {
    id: 's1', name: 'bad', color: '#2563eb', lineWidth: 1.5, visible: true, offset: 0, normalize: false, source: 'file', note: '',
    raw: { x: r.rawPoints.map(p => p.x), y: r.rawPoints.map(p => p.y), lineNos: r.rawPoints.map(p => p.lineNo), sourceLineNos: r.rawPoints.map(p => p.sourceLine) },
    working: { x: r.points.map(p => p.x), y: r.points.map(p => p.y), lineNos: r.points.map(p => p.lineNo), sourceLineNos: r.points.map(p => p.sourceLine) },
    importMeta: { format: 'uxd', skippedRows: r.errors, merged: [], duplicateMode: 'keep', sortMode: 'sort', sortApplied: 'none', xCol: 0, yCol: 1 },
    bg: M.defaultBg(), peaks: M.defaultPeaks(), charge: M.defaultCharge()
  };
  const settings = { title: 'Native', xMin: null, xMax: null, yMin: null, yMax: null, showLegend: true, showGrid: true, stack: true, stackGap: 1.15, stackScale: 0.8 };
  const v = M.validateProject(M.serializeProject({ samples: [sample], settings, refs: [], lib: { wavelength: null, sticksOn: false }, history: [], phases: [], fit: null, technique: 'xrd' }));
  ok(v.ok, v.errors.join('；'));
});

t('N13 公开演示包：四表征、许可、来源、点数与有限数值', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'web/data/demo-spectra.json'), 'utf8'));
  eq(doc.schema, 'catplot-demo-spectra/v1');
  eq([...new Set(doc.datasets.map(d => d.technique))].sort(), ['ftir', 'raman', 'xps', 'xrd']);
  eq(doc.datasets.length, 5);
  for (const d of doc.datasets) {
    ok(['MIT', 'CC-BY-4.0'].includes(d.license), d.id + ' 许可');
    ok(/^https:\/\//.test(d.source_url) && d.citation.length > 20, d.id + ' 来源/引用');
    eq(d.x.length, d.y.length, d.id + ' 数组长度');
    ok(d.x.every(Number.isFinite) && d.y.every(Number.isFinite), d.id + ' 有限数值');
  }
});

t('N14 真实 MiniDIFDUP：584 点、压缩解码、因子缩放、X 重建与过期极值告警', () => {
  const text = readFileSync(join(ROOT, 'tests/fixtures/real/MiniDIFDUP.JDX'), 'utf8');
  const r = P.analyzeNative(text, 'jcamp', { duplicateMode: 'keep', sortMode: 'keep' });
  ok(!r.fatal, r.fatal);
  eq(r.rawPoints.length, 584);
  eq(r.native.nPoints, 584);
  eq(r.native.xFactor, 4.882812500e-4);
  eq(r.native.yFactor, 1.220703125e-2);
  const firstX = 2373.973, lastX = 1804.104, dx = (lastX - firstX) / 583;
  closeArray(r.rawPoints.slice(0, 3).map(p => p.x), [firstX, firstX + dx, firstX + 2 * dx], 1e-9);
  closeArray(r.rawPoints.slice(0, 3).map(p => p.y), [91.46728515625, 91.455078125, 91.4306640625], 1e-7);
  const first = r.rawPoints[0], last = r.rawPoints[r.rawPoints.length - 1];
  ok(Math.abs(first.x - 2373.973) < 1e-9, 'FIRSTX 重建');
  ok(Math.abs(last.x - 1804.104) < 1e-6, 'LASTX 重建');
  ok(Math.abs(first.y - 91.46729) < 1e-5, 'FIRSTY 缩放后应为 91.46729');
  ok(r.warnings.some(w => w.includes('DIF 行尾校验值')), '应报告采用的 DIF 校验策略');
  ok(r.warnings.some(w => w.includes('DELTAX') && w.includes('已按首末点重建 X')), 'DELTAX 与元数据端点冲突时应明确报告采用的 X 策略');
  ok(r.warnings.some(w => w.startsWith('MAXY=')), '过期 MAXY 应告警而非静默改值');
  ok(r.warnings.some(w => w.startsWith('MINY=')), '过期 MINY 应告警而非静默改值');
  ok(!r.warnings.some(w => /^(FIRSTX|LASTX|FIRSTY)=/.test(w)), '已按标准元数据重建的首末与首值不应误报');
  eq(r.rawPoints[0].sourceLine, 17);
  eq(r.rawPoints.map(p => p.lineNo), Array.from({ length: 584 }, (_, i) => i + 1));
});

console.log(`\n== 结果汇总 ==\n通过 ${pass} / ${pass + fail}`);
if (fail) process.exitCode = 1;
