/* CatPlot 回归测试（Node，vm 沙箱加载纯逻辑模块）：数据正确性 / 导入 / 项目 v2 / 渲染辅助 / 卡片库 / 背景与寻峰算法。
   运行：node tests/run-tests.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const sandbox = { window: {}, console, Map, Set, Math, Number, String, Array, Object, JSON, isFinite, Infinity, NaN, Date, RegExp };
vm.createContext(sandbox);
for (const f of ['js/model.js', 'js/parser.js', 'js/samples.js', 'js/analysis.js', 'js/cards.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const M = sandbox.window.CatModel;
const P = sandbox.window.CatParser;
const S = sandbox.window.CatSamples;
const AN = sandbox.window.CatAnalysis;

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || '') + ' 期望 ' + sb + ' 实际 ' + sa);
}
function ok(c, msg) { if (!c) throw new Error(msg || '断言失败'); }

console.log('\n== 一、数据正确性（问题 1–4、9）==');

t('1a 三层分离：偏移只进入显示层，分析层不含偏移', () => {
  const w = { x: [10, 20, 30], y: [100, 500, 200] };
  const L = M.buildLayers(w, false, 250);
  eq(L.analysis.y, [100, 500, 200]);
  eq(L.display.y, [350, 750, 450]);
  eq(w.y, [100, 500, 200], '工作副本不被修改');
});

t('1b 归一化+偏移：分析层最大值=1，显示层=分析+偏移', () => {
  const w = { x: [1, 2, 3], y: [0, 800, 400] };
  const L = M.buildLayers(w, true, 0.5);
  eq(L.analysis.y, [0, 1, 0.5]);
  eq(L.display.y, [0.5, 1.5, 1]);
});

t('2a 全零数据阻止归一化并给出除零原因', () => {
  ok(!M.canNormalize([0, 0, 0]));
  ok(M.normalizeBlockReason([0, 0, 0]).includes('除零'));
});

t('2b 全负数据阻止归一化并给出无意义原因', () => {
  ok(!M.canNormalize([-5, -1, -9]));
  ok(M.normalizeBlockReason([-5, -1, -9]).includes('<= 0'));
  ok(M.canNormalize([-5, 0.001, -9]), '含正峰值即可归一化');
});

t('2c 空数据阻止归一化', () => {
  ok(!M.canNormalize([]));
  ok(M.normalizeBlockReason([]).includes('为空'));
});

t('9 大数组 min/max 不使用 apply（300k 点不抛 RangeError）', () => {
  const n = 300000, arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = Math.sin(i) * 1000;
  arr[123456] = 99999; arr[654321] = -99999;
  eq(M.maxOf(arr), 99999);
  eq(M.minOf(arr), -99999);
});

t('10a min-max 降采样保留单点尖峰（200k 点，峰宽 1 点）', () => {
  const n = 200000, x = new Array(n), y = new Array(n);
  for (let i = 0; i < n; i++) { x[i] = 10 + i * 70 / n; y[i] = 5 + Math.sin(i / 500); }
  const spikeIdx = 137777;
  y[spikeIdx] = 100000;
  const d = M.decimateMinMax(x, y, 2400);
  ok(d.factor > 1, '应触发降采样');
  ok(d.kept <= 2402, '保留点数受控: ' + d.kept);
  const si = d.x.indexOf(x[spikeIdx]);
  ok(si !== -1, '尖峰 X 必须保留');
  eq(d.y[si], 100000, '尖峰 Y 必须保留');
  eq(d.x[0], x[0], '首点保留');
  eq(d.x[d.x.length - 1], x[n - 1], '末点保留');
});

t('10b 小数据不降采样，原样返回', () => {
  const d = M.decimateMinMax([1, 2, 3], [4, 5, 6], 2400);
  eq(d.factor, 1); eq(d.kept, 3); eq(d.y, [4, 5, 6]);
});

t('10c 降采样不修改输入数组（分析/导出全量保留）', () => {
  const x = Array.from({ length: 10000 }, (_, i) => i);
  const y = x.map(v => v % 97);
  const d = M.decimateMinMax(x, y, 2400);
  eq(x.length, 10000); eq(y.length, 10000);
  ok(d.kept < 10000);
});

console.log('\n== 二、导入与追溯（问题 5–8）==');

t('6a 带引号 CSV：引号内逗号不切分', () => {
  const r = P.analyze('"name,with,comma",10,100\nplain,20,200\n', { delimiter: ',', skipRows: 0, xCol: 1, yCol: 2 });
  eq(r.points.length, 2);
  eq(r.points[0], { x: 10, y: 100, lineNo: 1 });
  eq(r.preview[0].cells[0], 'name,with,comma');
});

t('6b 双引号转义 "" 还原为单个引号', () => {
  const recs = P.tokenize('a,"say ""hi""",3\n', ',');
  eq(recs[0].cells[1], 'say "hi"');
});

t('6c 引号内换行：记录跨行且行号追溯正确', () => {
  const text = 'a,10,100\n"multi\nline",20,200\nb,30,300\n';
  const r = P.analyze(text, { delimiter: ',', skipRows: 0, xCol: 1, yCol: 2 });
  eq(r.errors.length, 0);
  eq(r.points.map(p => p.lineNo), [1, 2, 4], '跨行记录后的行号应跳到 4');
  eq(r.preview[1].cells[0], 'multi\nline');
  const bad = P.analyze('a,10,100\n"multi\nline",oops,200\n', { delimiter: ',', skipRows: 0, xCol: 1, yCol: 2 });
  eq(bad.errors.length, 1);
  eq(bad.errors[0].lineNo, 2, '跨行记录的错误行号应为记录起始行');
});

t('6d 引号包裹的数值字段正常解析', () => {
  const r = P.analyze('"10.5","1234.5"\n"20.25","99"\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1 });
  eq(r.points.length, 2);
  eq(r.points[1], { x: 20.25, y: 99, lineNo: 2 });
});

t('5a 原始行号保留：跳过文件头后行号仍为物理行号', () => {
  const r = P.analyze('# header\n# meta\n10,100\n20,200\n', { delimiter: ',', skipRows: 2, xCol: 0, yCol: 1 });
  eq(r.rawPoints.map(p => p.lineNo), [3, 4]);
  eq(r.skippedHeader, 2);
});

t('5b 排序生成独立副本，rawPoints 保持文件顺序', () => {
  const text = '30,300\n10,100\n20,200\n';
  const r = P.analyze(text, { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1, sortMode: 'sort' });
  eq(r.sortApplied, 'asc');
  eq(r.rawPoints.map(p => p.x), [30, 10, 20], 'raw 不被排序覆盖');
  eq(r.points.map(p => p.x), [10, 20, 30]);
  eq(r.rawPoints.map(p => p.lineNo), [1, 2, 3]);
});

t('5c sortMode=keep 时不排序且记录 none', () => {
  const r = P.analyze('30,300\n10,100\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1, sortMode: 'keep' });
  eq(r.sortApplied, 'none');
  eq(r.points.map(p => p.x), [30, 10]);
});

t('7a 重复 X 检测：组数、多余点数、行号明细', () => {
  const r = P.analyze('10,1\n10,3\n20,5\n10,7\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1, duplicateMode: 'keep' });
  eq(r.quality.duplicates.length, 1);
  eq(r.quality.duplicateExtra, 2);
  eq(r.quality.duplicates[0].lineNos, [1, 2, 4]);
  eq(r.points.length, 4, 'keep 模式不静默合并');
});

t('7b 显式 merge：按 X 平均，记录被合并行号', () => {
  const r = P.analyze('10,1\n10,3\n20,5\n10,7\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1, duplicateMode: 'merge' });
  eq(r.points.length, 2);
  eq(r.points[0].y, (1 + 3 + 7) / 3);
  eq(r.merged.length, 1);
  eq(r.merged[0].lineNos, [1, 2, 4]);
  eq(r.rawPoints.length, 4, 'raw 保留全部重复点');
});

t('7c 非单调 X 检测', () => {
  const r = P.analyze('10,1\n30,2\n20,3\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1, sortMode: 'keep' });
  ok(r.quality.nonMonotonic);
});

t('7d X/Y 同一列：fatal 明确提示', () => {
  const r = P.analyze('10,100\n20,200\n', { delimiter: ',', skipRows: 0, xCol: 1, yCol: 1 });
  ok(r.fatal && r.fatal.includes('同一列'));
  eq(r.points.length, 0);
});

t('7e 列数不足：fatal 提示更换分隔符/列', () => {
  const r = P.analyze('10\n20\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1 });
  ok(r.fatal && r.fatal.includes('列'));
});

t('3/8 无效行具体到行号与原因，不静默丢弃', () => {
  const r = P.analyze('10,100\nabc,200\n30,\n40,400\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1 });
  eq(r.errors.length, 2);
  eq(r.errors[0].lineNo, 2);
  ok(r.errors[0].reason.includes('abc'));
  eq(r.errors[1].lineNo, 3);
  ok(r.errors[1].reason.includes('空值'));
  eq(r.points.length, 2);
});

t('8 错误签名：无效行集合变化时签名变化（触发重新确认）', () => {
  const a = P.analyze('10,1\nabc,2\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1 });
  const b = P.analyze('10,1\nabc,2\n', { delimiter: ',', skipRows: 0, xCol: 1, yCol: 0 });
  ok(a.errors.length > 0 && b.errors.length > 0);
  ok(M.errorSignature(a.errors) !== M.errorSignature(b.errors), '参数改变导致无效行集合变化时签名必须变化');
  const c = P.analyze('10,1\nabc,2\n', { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1 });
  eq(M.errorSignature(a.errors), M.errorSignature(c.errors), '相同集合签名稳定');
});

t('分隔符自动检测：逗号/分号/Tab/空白', () => {
  eq(P.detectDelimiter('10,100\n20,200\n'), ',');
  eq(P.detectDelimiter('10;100\n20;200\n'), ';');
  eq(P.detectDelimiter('10\t100\n20\t200\n'), '\t');
  eq(P.detectDelimiter('10 100\n20 200\n'), 'ws');
});

console.log('\n== 三、保存与项目 JSON（问题 11–13、15）==');

function validState() {
  return {
    settings: { title: 'T', xMin: null, xMax: null, yMin: null, yMax: null, showLegend: true, showGrid: true },
    samples: [{
      name: 'S1', color: '#2563eb', lineWidth: 1.5, visible: true, offset: 0.5, normalize: false,
      source: 'file', note: '',
      raw: { x: [10, 20], y: [100, 200], lineNos: [3, 4] },
      working: { x: [10, 20], y: [100, 200], lineNos: [3, 4] },
      importMeta: { fileName: 'a.csv', skippedRows: [] }
    }]
  };
}

t('11a 项目 JSON 往返：serialize → validate 通过且数据一致（v5 含 fit 字段、无 match）', () => {
  const st = validState();
  const payload = M.serializeProject(st);
  eq(payload.format, 'catplot-project');
  eq(payload.version, 5);
  ok('fit' in payload, 'v4 应携带 fit 字段（可为 null）');
  const round = JSON.parse(JSON.stringify(payload));
  const v = M.validateProject(round);
  ok(v.ok, v.errors.join(';'));
  eq(v.samples[0].raw.y, [100, 200]);
  eq(v.samples[0].raw.lineNos, [3, 4]);
  ok(round.samples[0].bg && round.samples[0].peaks, 'v2 起应携带 bg/peaks');
  const old = JSON.parse(JSON.stringify(payload));
  old.version = 2; delete old.match;
  ok(M.validateProject(old).ok, 'v2 旧档（无 match）仍接受');
});

t('11b 校验拒绝：错误 format / 不支持版本 / 坏 match / 坏 fit；v1 旧档仍接受', () => {
  const p = M.serializeProject(validState());
  ok(!M.validateProject({ ...p, format: 'other' }).ok);
  ok(!M.validateProject({ ...p, version: 6 }).ok);
  ok(M.validateProject({ ...p, version: 4 }).ok, 'v4 旧档应可恢复');
  ok(M.validateProject({ ...p, version: 3 }).ok, 'v3 旧档应可恢复');
  ok(!M.validateProject({ ...p, fit: { regions: [{ min: 5, max: 1, peaks: [] }] } }).ok, '坏 fit 区间拒绝');
  ok(!M.validateProject({ ...p, fit: { regions: 'x' } }).ok, '坏 fit 结构拒绝');
  ok(M.validateProject({ ...p, version: 1 }).ok, 'v1 项目应可恢复');
  ok(!M.validateProject(null).ok);
});

t('11c 校验拒绝：NaN / 非数值 / 长度不一致', () => {
  const p = M.serializeProject(validState());
  p.samples[0].raw.y = [100, NaN];
  ok(!M.validateProject(JSON.parse(JSON.stringify(p))).ok, 'NaN 经 JSON 变 null 应被拒');
  const p2 = M.serializeProject(validState());
  p2.samples[0].raw.x = [10];
  ok(!M.validateProject(p2).ok, 'x/y 长度不一致应被拒');
});

t('11d 校验拒绝：非法颜色 / 负偏移 / 非法线宽 / 空名称', () => {
  const mk = (mut) => { const p = M.serializeProject(validState()); mut(p.samples[0]); return M.validateProject(p); };
  ok(!mk(s => { s.color = 'red'; }).ok);
  ok(!mk(s => { s.offset = -1; }).ok);
  ok(!mk(s => { s.lineWidth = 99; }).ok);
  ok(!mk(s => { s.name = '  '; }).ok);
  ok(!mk(s => { s.normalize = 'yes'; }).ok);
});

t('11e 校验拒绝：超过 200 样品', () => {
  const p = M.serializeProject(validState());
  p.samples = Array.from({ length: 201 }, () => p.samples[0]);
  ok(!M.validateProject(p).ok);
});

t('15 formatNum 全精度：小数值不被六位小数截断', () => {
  eq(M.formatNum(0.000000123), '1.23e-7');
  eq(M.formatNum(1e-12), '1e-12');
  eq(M.formatNum(0.123456789), '0.123456789');
  eq(Number(M.formatNum(1234.567890123)), 1234.567890123, '往返一致');
});

t('12 内置模拟样品：3 条、明确模拟来源、点数一致', () => {
  const sims = S.makeSimSamples();
  eq(sims.length, 3);
  sims.forEach(s => {
    ok(s.name.includes('模拟'));
    eq(s.raw.x.length, s.raw.y.length);
    ok(s.raw.x.length > 1000);
  });
});

console.log('\n== 四、大数据量性能实测（问题 9–10）==');

const perf = {};
t('P1 200k 行 CSV 解析（含行号/质量检查）', () => {
  const n = 200000;
  const lines = new Array(n);
  for (let i = 0; i < n; i++) lines[i] = (10 + i * 70 / n).toFixed(4) + ',' + (Math.random() * 1000).toFixed(2);
  const text = lines.join('\n');
  const t0 = performance.now();
  const r = P.analyze(text, { delimiter: ',', skipRows: 0, xCol: 0, yCol: 1 });
  perf.parse200k = Math.round(performance.now() - t0);
  eq(r.points.length, n);
  eq(r.errors.length, 0);
  ok(perf.parse200k < 10000, '解析应在 10s 内: ' + perf.parse200k + 'ms');
});

t('P2 200k 点三层构建 + 降采样', () => {
  const n = 200000;
  const x = new Array(n), y = new Array(n);
  for (let i = 0; i < n; i++) { x[i] = 10 + i * 70 / n; y[i] = Math.random() * 1000; }
  y[99999] = 99999;
  const t0 = performance.now();
  const L = M.buildLayers({ x, y }, true, 0.3);
  const d = M.decimateMinMax(L.display.x, L.display.y, 2400);
  perf.layers200k = Math.round(performance.now() - t0);
  ok(d.y.includes(99999 / 99999 + 0.3) || d.y.some(v => Math.abs(v - (1 + 0.3)) < 1e-9), '归一化尖峰保留');
  ok(perf.layers200k < 5000);
});

t('P3 500k 点 min/max（apply 会在此规模崩溃）', () => {
  const n = 500000, arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = i - 250000;
  const t0 = performance.now();
  eq(M.maxOf(arr), 249999);
  eq(M.minOf(arr), -250000);
  perf.minmax500k = Math.round(performance.now() - t0);
});

t('P4 100k 点重复 X 检测 + 合并', () => {
  const pts = Array.from({ length: 100000 }, (_, i) => ({ x: i % 50000, y: i, lineNo: i + 1 }));
  const t0 = performance.now();
  const q = M.detectQuality(pts);
  const mg = M.mergeDuplicates(pts);
  perf.dup100k = Math.round(performance.now() - t0);
  eq(q.duplicateExtra, 50000);
  eq(mg.points.length, 50000);
});

console.log('\n== 五、本轮修正：模型层回归 ==');

function bruteNearest(x, v) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - v);
    if (d < bd - 1e-12) { bd = d; best = i; }
  }
  return best;
}

t('R2a 降序数据：升序查询索引返回真实最近点（原顺序不变）', () => {
  const x = [80, 70, 60, 50, 40, 30, 20, 10];
  const q = M.buildQueryIndex(x);
  eq(x, [80, 70, 60, 50, 40, 30, 20, 10], '输入不被修改');
  for (const v of [10, 25, 44.9, 45.1, 67, 80, 5, 90]) {
    const i = q.idx[M.nearestSorted(q.xs, v)];
    const b = bruteNearest(x, v);
    eq(Math.abs(x[i] - v), Math.abs(x[b] - v), 'v=' + v);
  }
});

t('R2b 乱序数据：最近点查询与暴力搜索一致', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const x = Array.from({ length: 2000 }, () => Math.round(rnd() * 7000) / 100 + 10);
  const q = M.buildQueryIndex(x);
  for (let t = 0; t < 200; t++) {
    const v = 10 + rnd() * 70;
    const i = q.idx[M.nearestSorted(q.xs, v)];
    const b = bruteNearest(x, v);
    ok(Math.abs(x[i] - v) <= Math.abs(x[b] - v) + 1e-9, 'v=' + v);
  }
});

t('R2c 重复 X：查询确定性取原始顺序第一个，且为真实点', () => {
  const x = [30, 10, 20, 10, 20, 10];
  const q = M.buildQueryIndex(x);
  const i = q.idx[M.nearestSorted(q.xs, 10)];
  eq(i, 1, '重复 X=10 取文件顺序第一个(索引1)');
  eq(x[i], 10);
  const j = q.idx[M.nearestSorted(q.xs, 19.9)];
  ok(x[j] === 20);
});

t('R2d 绘图原顺序保留：path 序列应等于文件顺序（模型不重排 display）', () => {
  const w = { x: [30, 10, 20], y: [3, 1, 2] };
  const L = M.buildLayers(w, false, 0);
  eq(L.display.x, [30, 10, 20]);
  const q = M.buildQueryIndex(L.display.x);
  eq(q.xs, [10, 20, 30], '仅查询副本排序');
});

t('R3a 全负数据自动 Y 轴完整包围（不再 maxY*1.08 裁剪）', () => {
  const [lo, hi] = M.autoYDomain(-900, -100, null, null);
  ok(lo <= -900, '下界包围: ' + lo);
  ok(hi >= -100, '上界包围: ' + hi);
  ok(hi < 0, '全负数据轴保持负区间');
});

t('R3b 全零与常数曲线自动轴不退化', () => {
  const z = M.autoYDomain(0, 0, null, null);
  ok(z[0] < 0 && z[1] > 0, '全零: ' + z);
  const c = M.autoYDomain(5, 5, null, null);
  ok(c[0] <= 0 && c[1] > 5, '正常数: ' + c);
  const cn = M.autoYDomain(-5, -5, null, null);
  ok(cn[0] <= -5 && cn[1] >= -5 && cn[1] > cn[0], '负常数: ' + cn);
  const tiny = M.autoYDomain(1e-12, 1e-12, null, null);
  ok(tiny[1] > tiny[0] && tiny[0] <= 1e-12 && tiny[1] >= 1e-12, '极小常数: ' + tiny);
});

t('R3c 常规数据按跨度留白 8%', () => {
  const [lo, hi] = M.autoYDomain(0, 1000, null, null);
  ok(Math.abs(hi - 1080) < 1e-9, 'hi=' + hi);
  ok(lo < 0, 'lo=' + lo);
});

t('R4a 窗口内点数不足目标时恢复全量显示', () => {
  const x = Array.from({ length: 20000 }, (_, i) => 10 + i * 70 / 20000);
  const y = x.map(v => Math.sin(v));
  const v = M.decimateWindow(x, y, 30, 32, 1716);
  eq(v.mode, 'full');
  ok(v.inWindow <= 1716);
  eq(v.kept, v.inWindow);
  ok(v.x.every(xx => xx >= 30 && xx <= 32));
});

t('R4b 同桶双峰：全局固定降采样可能丢第二峰（不声称保证）', () => {
  const n = 20000, x = new Array(n), y = new Array(n);
  for (let i = 0; i < n; i++) { x[i] = 10 + i * 70 / n; y[i] = 1; }
  y[10000] = 100; y[10001] = 90;
  const g = M.decimateMinMax(x, y, 100);
  const keptSecond = g.x.includes(x[10001]);
  ok(!keptSecond, '宽范围粗目标下第二峰确实可能丢失（限制被测试证实）');
  ok(g.x.includes(x[10000]), '最高峰保留');
});

t('R4c 局部范围重采样：缩窄可见范围后双峰均保留', () => {
  const n = 20000, x = new Array(n), y = new Array(n);
  for (let i = 0; i < n; i++) { x[i] = 10 + i * 70 / n; y[i] = 1; }
  y[10000] = 100; y[10001] = 90;
  const v = M.decimateWindow(x, y, x[10000] - 0.2, x[10001] + 0.2, 1716);
  eq(v.mode, 'full', '局部点数少 → 全量');
  ok(v.x.includes(x[10000]) && v.x.includes(x[10001]), '双峰均在');
  const mid = M.decimateWindow(x, y, 44.9, 45.1, 200);
  eq(mid.mode, 'full', '中窄窗口点数不足 → 全量');
  ok(mid.x.includes(x[10000]) && mid.x.includes(x[10001]), '中窄窗口双峰均在');
  const wide = M.decimateWindow(x, y, 10, 80, 200);
  eq(wide.mode, 'dec', '宽范围超目标 → 降采样');
});

t('R4d 显示简化不修改分析/显示层数组', () => {
  const x = Array.from({ length: 50000 }, (_, i) => i / 100);
  const y = x.map(v => Math.sin(v) * 10);
  const before = y.slice(0, 100);
  M.decimateWindow(x, y, 0, 500, 1000);
  eq(y.slice(0, 100), before);
  eq(x.length, 50000);
});

t('R6a 图例布局：2 倍字号 + 长名称 + 20 样品不溢出绘图区', () => {
  const names = Array.from({ length: 20 }, (_, i) => '超长样品名称测试_' + i + '_锐钛矿参考谱');
  const L = M.legendLayout(names, 858, 428, 2);
  ok(L.boxW <= 858 - 20, 'boxW=' + L.boxW);
  ok(L.lh <= 428 - 10, 'lh=' + L.lh);
  ok(L.extra > 0, '行数上限生效 extra=' + L.extra);
  ok(L.rows.every(r => r.endsWith('…') || M.textUnits(r) <= (L.boxW - 98) / 25), '名称截断');
  const S = M.legendLayout(['A', 'B'], 858, 428, 1);
  eq(S.extra, 0); eq(S.rows, ['A', 'B']);
});

t('R6b fitText 按字号无关的字符宽度截断', () => {
  eq(M.fitText('abc', 10), 'abc');
  const t = M.fitText('催化表征绘图与分析助手超长标题', 8);
  ok(t.endsWith('…') && M.textUnits(t) <= 8);
});

function tamperState(mut) {
  const p = M.serializeProject(validState());
  p.samples[0].raw = { x: [10, 20, 20], y: [100, 200, 400], lineNos: [3, 4, 5] };
  p.samples[0].working = { x: [10, 20], y: [100, 300], lineNos: [3, 4] };
  p.samples[0].importMeta = {
    fileName: 'a.csv', delimiter: ',', skipRows: 2, xCol: 0, yCol: 1,
    duplicateMode: 'merge', sortMode: 'sort', sortApplied: 'none',
    merged: [{ x: 20, count: 2, lineNos: [4, 5], mean: 300 }],
    skippedRows: [{ lineNo: 1, reason: 'X 值 "h" 不是有效数字' }]
  };
  mut(p);
  return M.validateProject(p);
}

t('R5a 一致的项目映射通过加强校验', () => {
  const v = tamperState(() => {});
  ok(v.ok, v.errors.join(';'));
});

t('R5b 轴上下界关系：xMin>=xMax / yMin>=yMax 拒绝', () => {
  ok(!tamperState(p => { p.settings.xMin = 60; p.settings.xMax = 20; }).ok);
  ok(!tamperState(p => { p.settings.yMin = 5; p.settings.yMax = 5; }).ok);
});

t('R5c working 行号不在 raw 中 / 重复行号 拒绝', () => {
  ok(!tamperState(p => { p.samples[0].working.lineNos = [3, 99]; }).ok);
  ok(!tamperState(p => { p.samples[0].working.lineNos = [3, 3]; }).ok);
});

t('R5d raw 行号非递增 / 非正整数 拒绝', () => {
  ok(!tamperState(p => { p.samples[0].raw.lineNos = [3, 5, 4]; }).ok);
  ok(!tamperState(p => { p.samples[0].raw.lineNos = [3, 4, 0]; }).ok);
});

t('R5e 合并映射篡改：均值不符 / 被合并行仍在 working / 首行缺失 拒绝', () => {
  ok(!tamperState(p => { p.samples[0].importMeta.merged[0].mean = 350; }).ok);
  ok(!tamperState(p => { p.samples[0].working = { x: [10, 20, 20], y: [100, 300, 400], lineNos: [3, 4, 5] }; }).ok);
  ok(!tamperState(p => { p.samples[0].working = { x: [10], y: [100], lineNos: [3] }; }).ok);
  ok(!tamperState(p => { p.samples[0].importMeta.merged[0].lineNos = [4, 77]; }).ok);
});

t('R5f 处理记录矛盾：merge 但 working 有重复 X / keep 但有合并记录 / asc 但乱序 / none 但重排 拒绝', () => {
  ok(!tamperState(p => { p.samples[0].working = { x: [10, 20, 20], y: [100, 300, 300], lineNos: [3, 4, 4] }; }).ok);
  ok(!tamperState(p => { p.samples[0].importMeta.duplicateMode = 'keep'; }).ok);
  ok(!tamperState(p => { p.samples[0].importMeta.sortApplied = 'asc'; p.samples[0].working = { x: [20, 10], y: [300, 100], lineNos: [4, 3] }; }).ok);
  ok(!tamperState(p => { p.samples[0].working = { x: [20, 10], y: [300, 100], lineNos: [4, 3] }; }).ok);
});

t('R5g 跳过行与 raw 矛盾 / xCol=yCol 拒绝', () => {
  ok(!tamperState(p => { p.samples[0].importMeta.skippedRows = [{ lineNo: 3, reason: 'x' }]; }).ok);
  ok(!tamperState(p => { p.samples[0].importMeta.xCol = 1; p.samples[0].importMeta.yCol = 1; }).ok);
});

console.log('\n== 六、浏览器测试留档 fixture 复核（真实导出的项目 JSON）==');
{
  const fdir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const load = n => JSON.parse(readFileSync(join(fdir, n), 'utf8'));
  const v = M.validateProject(load('proj-valid.json'));
  t('F0 真实导出项目（7 样品含 60k 点）通过加强校验', () => ok(v.ok, v.errors.join('；')));
  for (const [file, label] of [
    ['proj-tamper-axis.json', '轴上下界颠倒'],
    ['proj-tamper-mean.json', '合并均值篡改'],
    ['proj-tamper-line.json', 'working 行号越界'],
    ['proj-tamper-dupline.json', 'working 行号重复'],
    ['proj-tamper-sort.json', '排序记录与 working 顺序矛盾']
  ]) {
    t('F1 拒绝：' + label, () => {
      const r = M.validateProject(load(file));
      ok(!r.ok, '应拒绝但通过了');
    });
  }
}

console.log('\n== 七、公开示例卡核心（离线内置）==');
{
  const C = sandbox.window.CatCards;
  const doc = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'data', 'example-cards.json'), 'utf8'));
  t('C1 示例卡许可与类型白名单', () => {
    ok(doc.cards.length >= 2);
    doc.cards.forEach(c => {
      ok(['CC0-1.0', 'MIT'].includes(c.license), 'license ' + c.license);
      ok(['computed', 'experimental'].includes(c.pattern_type));
      ok(c.source_url && c.citation, '溯源齐全 ' + c.uid);
      c.peaks.forEach(p => ok(p.d > 0 && p.i >= 0, '峰合法'));
    });
  });
  t('C2 Bragg 换算与 makeStick', () => {
    const t2 = C.braggTwoTheta(2.86, 1.5406);
    ok(Math.abs(t2 - 31.25) < 0.1, 'd=2.86 → 2θ≈31.25');
    ok(C.braggTwoTheta(0.5, 1.5406) === null, 'd<λ/2 返回 null');
    const st = C.makeStick(doc.cards[0], 1.5406, '#0d9488');
    ok(st.key === 'ex:' + doc.cards[0].uid && st.peaks.length === doc.cards[0].peaks.length);
    ok(st.peaks.every(p => p.t != null));
  });
  t('C3 validateRefs 语法校验', () => {
    ok(C.validateRefs([{ key: 'ex:COD-1010942' }]).length === 0);
    ok(C.validateRefs([{ key: 'remote:x' }]).length === 1);
    ok(C.validateRefs([null]).length === 1);
  });
}

console.log('\n== 八、背景与寻峰算法（合成已知参数，批次1）==');
{
  const gauss = (x, c, s, a) => a * Math.exp(-((x - c) ** 2) / (2 * s * s));
  function synth() {
    const x = [], bg = [], y = [];
    for (let i = 0; i <= 1200; i++) {
      const xi = 5 + i * 0.05;
      const b = 200 + 2.5 * xi;
      x.push(xi); bg.push(b);
      y.push(b + gauss(xi, 15, 0.25, 5000) + gauss(xi, 30, 0.5, 2500) + gauss(xi, 50, 0.2, 8000));
    }
    return { x, bg, y };
  }
  const nearPeak = xv => [15, 30, 50].some(c => Math.abs(xv - c) < 2.5);

  t('A1 SNIP 恢复线性背景：远离峰区误差 <4%，扣背景后峰高误差 <8%', () => {
    const { x, bg, y } = synth();
    const est = AN.snipBackground(y, 40);
    let err = 0, cnt = 0;
    for (let i = 0; i < x.length; i++) {
      if (nearPeak(x[i])) continue;
      err += Math.abs(est[i] - bg[i]) / bg[i]; cnt++;
    }
    ok(err / cnt < 0.04, '背景平均相对误差 ' + (err / cnt).toFixed(4));
    [[15, 5000], [30, 2500], [50, 8000]].forEach(([c, a]) => {
      let m = 0;
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - c) < 0.6) m = Math.max(m, y[i] - est[i]);
      ok(Math.abs(m - a) / a < 0.08, '峰 ' + c + ' 扣背景峰高 ' + m.toFixed(1) + ' 期望≈' + a);
    });
  });
  t('A2 SNIP 不修改输入；负值仅按 0 参与估计', () => {
    const y = [10, -5, 300, 20, -1, 15];
    const copy = y.slice();
    const est = AN.snipBackground(y, 3);
    eq(y, copy, '输入不被修改');
    ok(est.every(v => isFinite(v) && v >= -1e-9), '估计值有限且非负');
  });
  t('A3 手动背景：线性插值精确、端点水平延拓、单点常数、空点零', () => {
    const x = [0, 1, 2, 3, 4];
    eq(AN.manualBackground(x, [{ x: 3, y: 30 }, { x: 1, y: 10 }]), [10, 10, 20, 30, 30]);
    eq(AN.manualBackground(x, [{ x: 2, y: 7 }]), [7, 7, 7, 7, 7]);
    eq(AN.manualBackground(x, []), [0, 0, 0, 0, 0]);
  });
  t('A4 SG 平滑：常数精确、内部线性精确保留（镜像边缘不保多项式），窗口归一', () => {
    const c = new Array(50).fill(42);
    AN.sgSmooth(c, 9).forEach(v => ok(Math.abs(v - 42) < 1e-9, '常数保留'));
    const lin = Array.from({ length: 50 }, (_, i) => 2 * i + 1);
    const sm = AN.sgSmooth(lin, 11);
    for (let i = 5; i < 45; i++) ok(Math.abs(sm[i] - lin[i]) < 1e-9, '内部线性保留 i=' + i);
    ok(sm.every(isFinite), '边缘镜像值有限');
    eq(AN.sgSmooth(lin, 8), AN.sgSmooth(lin, 9), '偶数窗 → 相邻奇数窗');
    eq(AN.sgSmooth(lin, 99), AN.sgSmooth(lin, 31), '窗口上限 31');
    eq(AN.sgSmooth([1, 2], 9), [1, 2], 'n<窗 原样返回');
    const src = [1, 2, 3, 4, 5];
    AN.sgSmooth(src, 3);
    eq(src, [1, 2, 3, 4, 5], '不修改输入');
  });
  t('A5 噪声估计：常数=0；种子高斯噪声 σ=5 估回 3–8', () => {
    eq(AN.estimateNoise(new Array(100).fill(9)), 0);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const y = [];
    for (let i = 0; i < 5000; i++) {
      const u1 = rnd() || 1e-9, u2 = rnd();
      y.push(100 + 5 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
    }
    const s = AN.estimateNoise(y);
    ok(s > 3 && s < 8, 'σ 估计 ' + s.toFixed(3));
  });
  function peakSynth() {
    const x = [], y = [];
    for (let i = 0; i <= 2000; i++) {
      const xi = 5 + i * 0.02;
      x.push(xi);
      y.push(gauss(xi, 10, 0.15, 1000) + gauss(xi, 20, 0.3, 600) + gauss(xi, 30, 0.1, 2000));
    }
    return { x, y };
  }
  t('A6 寻峰：3 个已知峰全部命中，峰位误差 <0.03°，峰高/突出度误差 <5%，无浮点伪峰', () => {
    const { x, y } = peakSynth();
    const r = AN.findPeaks(x, y, { smooth: 5, noiseK: 3, minDist: 0.5 });
    eq(r.peaks.length, 3);
    [[10, 1000], [20, 600], [30, 2000]].forEach(([c, a], i) => {
      const p = r.peaks[i];
      ok(Math.abs(p.x - c) < 0.03, '峰位 ' + p.x + ' 期望 ' + c);
      ok(Math.abs(p.height - a) / a < 0.05, '峰高 ' + p.height + ' 期望 ' + a);
      ok(Math.abs(p.prominence - a) / a < 0.05, '突出度 ' + p.prominence + ' 期望≈' + a);
      ok(p.i >= 0 && p.i < x.length && Math.abs(x[p.i] - c) < 0.03, '索引对应原始数据');
    });
  });
  t('A7 minDist 冲突保留更高者', () => {
    const x = [], y = [];
    for (let i = 0; i <= 1000; i++) {
      const xi = 18 + i * 0.01;
      x.push(xi);
      y.push(gauss(xi, 20, 0.1, 1000) + gauss(xi, 20.4, 0.1, 800));
    }
    const r = AN.findPeaks(x, y, { smooth: 3, minDist: 0.5, minHeight: 100 });
    eq(r.peaks.length, 1);
    ok(Math.abs(r.peaks[0].x - 20) < 0.05, '保留更高峰 ' + r.peaks[0].x);
  });
  t('A8 范围/阈值参数：lo-hi 限定、绝对峰高阈值、noiseK 抑制（含噪声数据）', () => {
    const { x, y } = peakSynth();
    eq(AN.findPeaks(x, y, { smooth: 5, lo: 15, hi: 25, minHeight: 100 }).peaks.length, 1);
    eq(AN.findPeaks(x, y, { smooth: 5, minHeight: 1500 }).peaks.length, 1);
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ny = y.map(v => v + (rnd() * 2 - 1) * 15);
    const r3 = AN.findPeaks(x, ny, { smooth: 5, noiseK: 3, minDist: 0.5 });
    eq(r3.peaks.length, 3, '噪声 ±15 下 3σ 阈值仍命中 3 峰');
    ok(r3.sigma > 3 && r3.sigma < 20, 'σ 估计合理: ' + r3.sigma.toFixed(2));
    eq(AN.findPeaks(x, ny, { smooth: 5, noiseK: 1e9 }).peaks.length, 0, '极高 noiseK 抑制全部');
    eq(AN.findPeaks([1, 2], [3, 4], {}).peaks.length, 0);
    const copy = y.slice();
    AN.findPeaks(x, y, { smooth: 5 });
    eq(y, copy, '寻峰不修改输入');
  });
  t('A9 抛物线细化：顶点 10.3 从网格 10.2 精确恢复', () => {
    const x = [10, 10.2, 10.4];
    const ys = x.map(v => -((v - 10.3) ** 2));
    ok(Math.abs(AN.refineCenter(x, ys, 1) - 10.3) < 1e-9);
    eq(AN.refineCenter(x, ys, 0), 10, '端点不细化');
  });
  t('A10 d 值：26.385°@Cu → 3.3752Å；90° → λ/√2；非法输入 null', () => {
    ok(Math.abs(AN.dSpacing(26.385, 1.5406) - 3.3752) < 1e-3);
    ok(Math.abs(AN.dSpacing(90, 1.5406) - 1.5406 / Math.SQRT2) < 1e-9);
    eq(AN.dSpacing(0, 1.5406), null);
    eq(AN.dSpacing(180, 1.5406), null);
    eq(AN.dSpacing(20, 0), null);
  });
  t('A11 基准键：数据/背景配置变化即失效，未扣除的配置不影响', () => {
    const w = { x: [1, 2, 3], y: [10, 20, 30] };
    const none = { mode: 'none', applied: false, iterations: 24, points: [] };
    const k0 = AN.basisKey(w, none);
    eq(AN.basisKey(w, { ...none }), k0, '同输入稳定');
    eq(AN.basisKey(w, { mode: 'snip', applied: false, iterations: 99, points: [] }), k0, '未扣除时配置无关');
    ok(AN.basisKey({ x: w.x, y: [10, 21, 30] }, none) !== k0, '工作副本变化 → 失效');
    ok(AN.basisKey(w, { mode: 'snip', applied: true, iterations: 24, points: [] }) !== k0, '扣除背景 → 失效');
    ok(AN.basisKey(w, { mode: 'snip', applied: true, iterations: 30, points: [] }) !== AN.basisKey(w, { mode: 'snip', applied: true, iterations: 24, points: [] }), '迭代数变化 → 失效');
    const m1 = { mode: 'manual', applied: true, iterations: 24, points: [{ x: 1, y: 5 }] };
    const m2 = { mode: 'manual', applied: true, iterations: 24, points: [{ x: 1, y: 6 }] };
    ok(AN.basisKey(w, m1) !== AN.basisKey(w, m2), '手动点变化 → 失效');
  });
}

console.log('\n== 九、项目 v2：背景/峰表/历史/物相校验与深拷贝 ==');
{
  const errsOf = (mut) => {
    const st = validState();
    mut(st);
    const p = M.serializeProject(st);
    return M.validateProject(p);
  };
  t('V1 bg 校验：非法 mode/迭代数/已扣除但无点/非有限点 拒绝', () => {
    const withBg = bg => errsOf(st => { st.samples[0].bg = bg; });
    ok(!withBg({ ...M.defaultBg(), mode: 'auto' }).ok);
    ok(!withBg({ ...M.defaultBg(), iterations: 0 }).ok);
    ok(!withBg({ ...M.defaultBg(), iterations: 501 }).ok);
    ok(withBg({ ...M.defaultBg(), mode: 'snip', applied: true, iterations: 24 }).ok, 'snip 已扣除合法');
    ok(!withBg({ ...M.defaultBg(), applied: true }).ok, 'applied 但 mode=none 拒绝');
    ok(!withBg({ ...M.defaultBg(), mode: 'manual', applied: true }).ok, '手动已扣除但无点拒绝');
    ok(!withBg({ ...M.defaultBg(), points: [{ x: NaN, y: 1 }] }).ok);
    ok(withBg({ ...M.defaultBg(), mode: 'manual', applied: true, points: [{ x: 10, y: 5 }, { x: 20, y: 8 }] }).ok);
  });
  t('V2 peaks 校验：参数范围/重复 id/非法来源/负索引 拒绝', () => {
    const pk = () => ({ ...M.defaultPeaks(), list: [{ id: 'p1', x: 15, height: 100, prominence: 90, index: 3, source: 'auto' }] });
    const withPk = f => errsOf(st => { st.samples[0].peaks = f(); });
    ok(withPk(pk).ok);
    ok(!withPk(() => ({ ...pk(), params: { ...M.defaultPeakParams(), smooth: 32 } })).ok);
    ok(!withPk(() => ({ ...pk(), params: { ...M.defaultPeakParams(), lo: 30, hi: 10 } })).ok);
    ok(!withPk(() => { const p = pk(); p.list.push({ ...p.list[0] }); return p; }).ok, '重复 id');
    ok(!withPk(() => { const p = pk(); p.list[0].source = 'jade'; return p; }).ok);
    ok(!withPk(() => { const p = pk(); p.list[0].index = -1; return p; }).ok);
    ok(!withPk(() => { const p = pk(); p.list[0].x = Infinity; return p; }).ok);
  });
  t('V3 序列化深拷贝：修改导出对象不污染运行 state', () => {
    const st = validState();
    st.samples[0].bg = { ...M.defaultBg(), mode: 'manual', points: [{ x: 10, y: 5 }] };
    st.history = [{ text: 'h', at: '2026-01-01T00:00:00.000Z' }];
    const p = M.serializeProject(st);
    p.samples[0].raw.y[0] = 99999;
    p.samples[0].bg.points.push({ x: 1, y: 1 });
    p.history.push({ text: 'x', at: 'y' });
    eq(st.samples[0].raw.y[0], 100);
    eq(st.samples[0].bg.points.length, 1);
    eq(st.history.length, 1);
  });
  t('V4 v2 往返：背景/峰表/历史/物相完整保留', () => {
    const st = validState();
    st.samples[0].bg = { mode: 'snip', iterations: 30, points: [], applied: true, preview: true };
    st.samples[0].peaks = { params: M.defaultPeakParams(), list: [{ id: 'p1', x: 15.2, height: 800, prominence: 750, index: 1, source: 'auto' }], basisKey: '2:abc:100:s30', sigma: 3.2 };
    st.history = [{ text: '扣除背景', at: '2026-11-16T08:00:00.000Z' }];
    st.phases = [{ id: 'ph1', name: 'Al2O3', refKey: 'k', source: 'manual', note: '手动标记', at: '2026-11-16T08:01:00.000Z' }];
    const v = M.validateProject(JSON.parse(JSON.stringify(M.serializeProject(st))));
    ok(v.ok, v.errors.join(';'));
    eq(v.samples[0].bg.iterations, 30);
    eq(v.samples[0].peaks.list[0].x, 15.2);
    eq(v.samples[0].peaks.basisKey, '2:abc:100:s30');
    eq(v.history.length, 1); eq(v.phases[0].name, 'Al2O3');
  });
  t('V5 history/phases 篡改拒绝：缺 at / 非法 source / 超量', () => {
    ok(!errsOf(s => { s.history = [{ text: 'x' }]; }).ok);
    ok(!errsOf(s => { s.phases = [{ id: 'p', name: 'X', source: 'jade' }]; }).ok);
    ok(!errsOf(s => { s.phases = Array.from({ length: 101 }, (_, i) => ({ id: 'p' + i, name: 'X', source: 'manual' })); }).ok);
    ok(!errsOf(s => { s.phases = [{ id: 'p', name: '  ', source: 'manual' }]; }).ok);
  });
}

console.log('\n== 结果汇总 ==');
console.log('通过 ' + pass + ' / ' + (pass + fail));
console.log('性能实测: 200k行解析 ' + perf.parse200k + 'ms · 200k点三层+降采样 ' + perf.layers200k + 'ms · 500k点min/max ' + perf.minmax500k + 'ms · 100k点重复检测+合并 ' + perf.dup100k + 'ms');
if (fail) {
  console.log('失败明细:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}