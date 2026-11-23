/* 趋势线性回归 + 误差棒真值验收（Node 直跑 batchcore，零浏览器）。
   覆盖：OLS 斜率/截距/R²/标准误正确性（已知真值）、退化场景(n<2/x全同/非有限)、
   置信带随 x 远离均值增大、批量对齐点携带 seC/seW、回归 CSV。
   用法：node tests/regress-model.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../web/js/fitcore.js');
const Batch = require('../web/js/batchcore.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }
function near(a, b, tol) { return a != null && Math.abs(a - b) <= tol; }

console.log('== G 趋势回归真值（batch-1） ==');

/* G1 完美线性 y=2x+1，无噪声：斜率2、截距1、R²=1、残差0 → 标准误0 */
let xs = [0, 1, 2, 3, 4], ys = [1, 3, 5, 7, 9];
let r = Batch.linearRegression(xs, ys);
ok(r.ok && near(r.slope, 2, 1e-9) && near(r.intercept, 1, 1e-9) && near(r.r2, 1, 1e-12) && r.df === 3 && r.slopeSe === 0,
  'G1 完美线性：斜率2/截距1/R²=1/SE=0', { slope: r.slope, int: r.intercept, r2: r.r2, se: r.slopeSe });

/* G2 已知斜率+对称噪声：斜率应接近真值，R²<1，SE>0 */
xs = [1, 2, 3, 4, 5]; ys = [2.1, 3.9, 6.2, 7.8, 10.1]; // ≈ y=2x, 有噪声
r = Batch.linearRegression(xs, ys);
ok(r.ok && near(r.slope, 2, 0.3) && r.r2 > 0.95 && r.slopeSe > 0 && r.df === 3,
  'G2 带噪线性：斜率≈2、R²>0.95、SE>0', { slope: +r.slope.toFixed(4), r2: +r.r2.toFixed(4), se: +r.slopeSe.toFixed(4) });

/* G3 标准误手算校验：x=[0,1,2], y=[0,1,3]
   x̄=1, ȳ=4/3, Sxx=2, Sxy=3 → slope=1.5, intercept=4/3-1.5=-1/6
   ŷ=[-1/6, 4/3, 17/6], res=[1/6,-1/3,1/6], SSE=1/6, df=1, s²=1/6
   slopeSe=√(s²/Sxx)=√(1/12)=0.288675 */
r = Batch.linearRegression([0, 1, 2], [0, 1, 3]);
ok(r.ok && near(r.slope, 1.5, 1e-9) && near(r.intercept, -1 / 6, 1e-9) && near(r.slopeSe, Math.sqrt(1 / 12), 1e-9) && r.df === 1,
  'G3 标准误手算一致(斜率1.5/截距-1/6/SE=√(1/12))', { slope: r.slope, int: r.intercept, se: r.slopeSe, df: r.df });

/* G4 n=2：无残差自由度，标准误 null，R² 仍可算(=1 完美) */
r = Batch.linearRegression([0, 1], [0, 2]);
ok(r.ok && near(r.slope, 2, 1e-9) && r.df === 0 && r.slopeSe === null && r.note && /n=2/.test(r.note),
  'G4 n=2 无自由度：SE=null+说明', { slope: r.slope, df: r.df, se: r.slopeSe, note: r.note });

/* G5 退化：n<2 */
r = Batch.linearRegression([1], [2]);
ok(!r.ok && /不足/.test(r.reason), 'G5 n<2 拒绝并给原因', r.reason);

/* G6 退化：x 全同 */
r = Batch.linearRegression([3, 3, 3], [1, 2, 3]);
ok(!r.ok && /全部相同/.test(r.reason), 'G6 x全同拒绝并给原因', r.reason);

/* G7 退化：含非有限值 */
r = Batch.linearRegression([0, 1, 2], [1, NaN, 3]);
ok(!r.ok && /非有限/.test(r.reason), 'G7 非有限值拒绝', r.reason);

/* G8 长度不一致 */
r = Batch.linearRegression([0, 1, 2], [1, 2]);
ok(!r.ok && /长度不一致/.test(r.reason), 'G8 长度不一致拒绝', r.reason);

/* G9 置信带：随 x 远离均值增大，且在均值处最小 */
const reg = Batch.linearRegression([1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1]);
const line = Batch.regressionLine(reg, 1, 5, 1);
const bMean = line.band(3);   // xbar=3
const bEdge = line.band(5);
ok(line && line.at(3) != null && bMean >= 0 && bEdge > bMean,
  'G9 置信带在均值处最小、边缘更大', { bMean: +bMean.toFixed(4), bEdge: +bEdge.toFixed(4) });

/* G10 regressionLine 端点值正确 */
ok(line && near(line.p0.y, reg.intercept + reg.slope * 1, 1e-9) && near(line.p1.y, reg.intercept + reg.slope * 5, 1e-9),
  'G10 回归直线端点= intercept+slope·x', { p0: +line.p0.y.toFixed(3), p1: +line.p1.y.toFixed(3) });

/* G11 批量对齐点携带标准误 seC/seW */
function grid(a, b, s) { const x = []; for (let v = a; v <= b + 1e-9; v += s) x.push(+v.toFixed(4)); return x; }
function synth(x, peaks, seed) { let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; const mid = (x[0] + x[x.length - 1]) / 2, half = (x[x.length - 1] - x[0]) / 2; const st = { peaks, shape: 'pseudoVoigt', bgModel: 'linear', bgCoeffs: [40, 20], anchors: null, mid, half }; return x.map(v => Core.modelY(v, st) + (rnd() + rnd() + rnd() - 1.5) * 25); }
const samples = [];
for (let i = 0; i < 5; i++) { const c = 30 + 0.15 * i, w = 0.18 + 0.03 * i; const x = grid(28, 33, 0.01); const y = synth(x, [{ c, w, h: 1000, sp: 0.5 }], 100 + i); samples.push({ id: 's' + i, name: 'S' + i, raw: { x, y }, working: { x, y }, normalize: false, offset: 0 }); }
const settings = { region: { min: 28, max: 33 }, shape: 'pseudoVoigt', bg: { model: 'linear' }, init: 'auto', minHeight: 100, minDist: 0.3, lambda: 1.5406, K: 0.89, instrument: { mode: 'none' }, xMode: 'value', xValues: [0, 0.1, 0.2, 0.3, 0.4] };
const batch = await Batch.runBatch(samples, settings, {});
const aligned = Batch.alignPeaks(batch, { tol: 1.0 });
const pt = aligned.anchors[0].points[0];
ok(pt.seC != null && isFinite(pt.seC) && pt.seC > 0 && pt.seW != null && pt.seW > 0,
  'G11 对齐点携带 seC/seW 标准误', { seC: pt.seC, seW: pt.seW });

/* G12 对峰位序列回归：c=30+0.15i，xValue 步长0.1 → 斜率=0.15/0.1=1.5 每单位，R²高 */
const cxs = aligned.anchors[0].points.map(p => p.xValue);
const cys = aligned.anchors[0].points.map(p => p.c);
const cr = Batch.linearRegression(cxs, cys);
ok(cr.ok && near(cr.slope, 1.5, 0.05) && cr.r2 > 0.99,
  'G12 峰位趋势回归：斜率≈1.5/单位、R²>0.99', { slope: +cr.slope.toFixed(4), r2: +cr.r2.toFixed(5), se: +cr.slopeSe.toFixed(4) });

/* G13 回归 CSV 结构 */
const csv = Batch.regressionCSV([{ label: '峰 1', ref: 30, metric: '峰位', n: cr.n, slope: cr.slope, slopeSe: cr.slopeSe, intercept: cr.intercept, r2: cr.r2, note: cr.note }]);
const clines = csv.trim().split('\n');
ok(clines.length === 2 && /slope_se/.test(clines[0]) && /r2/.test(clines[0]),
  'G13 回归CSV表头与行数', { rows: clines.length - 1, head: clines[0] });

/* G14 趋势CSV含标准误列 */
const tcsv = Batch.trendCSV(aligned);
ok(/se_center/.test(tcsv.split('\n')[0]) && /se_fwhm/.test(tcsv.split('\n')[0]),
  'G14 趋势CSV含 se_center/se_fwhm 列', tcsv.split('\n')[0]);

console.log('== 趋势回归真值汇总 == 通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
