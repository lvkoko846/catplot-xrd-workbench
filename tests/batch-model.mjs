/* 系列样品批量分析合成真值验收（batch-1，Node 直跑 batchcore，零浏览器）。
   合成系列：6 个样品，主峰中心随组分线性偏移 c=30+0.15·i，FWHM 随 i 增大（晶粒减小）。
   断言批量逐样品恢复峰位/FWHM 趋势、跨样品对齐、失败具体原因、取消、CSV。
   用法：node tests/batch-model.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Core = require('../web/js/fitcore.js');
const Batch = require('../web/js/batchcore.js');

let pass = 0, fail = 0; const MEAS = {};
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
function grid(min, max, step) { const x = []; for (let v = min; v <= max + 1e-9; v += step) x.push(+v.toFixed(4)); return x; }
function synth(x, peaks, shape, bg, noiseSigma, seed) {
  let s = seed || 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const mid = (x[0] + x[x.length - 1]) / 2, half = (x[x.length - 1] - x[0]) / 2;
  const st = { peaks, shape, bgModel: bg ? bg.model : 'none', bgCoeffs: bg ? bg.coeffs : [], anchors: null, mid, half };
  return x.map(v => Core.modelY(v, st) + (noiseSigma ? (rnd() + rnd() + rnd() - 1.5) * noiseSigma : 0));
}
const P = (c, w, h, sp) => ({ c, w, h, sp });

console.log('== B 系列样品批量分析合成真值（batch-1） ==');

/* 构造 6 样品系列：c=30+0.15i，w=0.18+0.03i，h=1000，η=0.5，线性背景[40,20]，SNR≈40 */
const N = 6;
const samples = [];
const truthC = [], truthW = [];
for (let i = 0; i < N; i++) {
  const c = 30 + 0.15 * i, w = 0.18 + 0.03 * i;
  truthC.push(c); truthW.push(w);
  const x = grid(28, 33, 0.01);
  const y = synth(x, [P(c, w, 1000, 0.5)], 'pseudoVoigt', { model: 'linear', coeffs: [40, 20] }, 25, 100 + i);
  samples.push({ id: 's' + i, name: '样品-' + i, raw: { x, y }, working: { x, y }, normalize: false, offset: 0 });
}
const settings = {
  region: { min: 28, max: 33 }, shape: 'pseudoVoigt', bg: { model: 'linear' },
  init: 'auto', minHeight: 100, minDist: 0.3, lambda: 1.5406, K: 0.89,
  instrument: { mode: 'none' }, xMode: 'index'
};

let prog = [];
let batch = await Batch.runBatch(samples, settings, { onProgress: (d, t) => prog.push(d + '/' + t) });
MEAS.B1 = batch.results.map(r => r.ok ? { c: +r.params[0].c.toFixed(4), w: +r.params[0].w.toFixed(4), rwp: +r.quality.rwp.toFixed(4) } : r.reason);
ok(batch.results.length === N && batch.results.every(r => r.ok),
  'B1 批量 6 样品全部拟合成功', batch.results.map(r => r.ok ? 'ok' : r.reason));
ok(prog.length === N && prog[N - 1] === N + '/' + N, 'B1b 进度回调逐样品触发', prog);

/* 峰位趋势恢复：每样品中心误差 < 0.03° */
const cErrs = batch.results.map((r, i) => r.ok ? Math.abs(r.params[0].c - truthC[i]) : Infinity);
MEAS.B2 = cErrs.map(v => +v.toFixed(4));
ok(cErrs.every(e => e < 0.03), 'B2 峰位随组分线性偏移恢复：各样品中心误差<0.03°', cErrs.map(v => +v.toFixed(4)));

/* FWHM 趋势恢复：相对误差 < 8%，且单调递增 */
const wErrs = batch.results.map((r, i) => r.ok ? Math.abs(r.params[0].w - truthW[i]) / truthW[i] : Infinity);
const ws = batch.results.map(r => r.ok ? r.params[0].w : NaN);
const monoW = ws.every((v, i) => i === 0 || v > ws[i - 1]);
MEAS.B3 = { wErrPct: wErrs.map(v => +(100 * v).toFixed(2)), monoW };
ok(wErrs.every(e => e < 0.08) && monoW, 'B3 FWHM 趋势恢复：相对误差<8% 且单调递增', MEAS.B3);

/* 晶粒尺寸趋势：D 随 FWHM 增大而减小（表观值，未扣仪器宽化） */
const Ds = batch.results.map(r => r.ok ? r.params[0].D : NaN);
const monoD = Ds.every((v, i) => i === 0 || v < Ds[i - 1]);
const allApparent = batch.results.every(r => r.ok && r.params[0].Dapparent === true);
MEAS.B4 = { D: Ds.map(v => +v.toFixed(3)), monoD, allApparent };
ok(monoD && allApparent, 'B4 表观晶粒尺寸随 FWHM 增大而减小，且全部标注表观值', MEAS.B4);

/* 跨样品对齐：单锚点，6 个观测，中心序列与真值一致。
   容差须 ≥ 系列总漂移（0.15×5=0.75°），取 1.0°；峰间距远大于此，无歧义。 */
let aligned = Batch.alignPeaks(batch, { tol: 1.0 });
MEAS.B5 = { anchors: aligned.anchors.length, pts: aligned.anchors[0] ? aligned.anchors[0].points.length : 0 };
ok(aligned.anchors.length === 1 && aligned.anchors[0].points.length === N,
  'B5 跨样品峰对齐：1 锚点 × 6 观测', MEAS.B5);
const alignedC = aligned.anchors[0].points.map(p => p.c);
ok(alignedC.every((c, i) => Math.abs(c - truthC[i]) < 0.03),
  'B5b 对齐后中心序列恢复线性趋势', alignedC.map(v => +v.toFixed(4)));

/* 自定义 x 轴（组分值） */
const settingsVal = Object.assign({}, settings, { xMode: 'value', xValues: [0, 0.1, 0.2, 0.3, 0.4, 0.5] });
const batchVal = await Batch.runBatch(samples, settingsVal, {});
const alignedVal = Batch.alignPeaks(batchVal, { tol: 1.0 });
ok(alignedVal.anchors[0].points.every((p, i) => Math.abs(p.xValue - i * 0.1) < 1e-9),
  'B6 自定义组分 x 轴正确映射', alignedVal.anchors[0].points.map(p => p.xValue));

/* 失败样品：无数据 + 区间无峰，给具体原因，不中断整批 */
const badSamples = samples.slice(0, 2).concat([
  { id: 'bad1', name: '空样品', raw: { x: [], y: [] } },
  { id: 'bad2', name: '无峰样品', raw: { x: grid(28, 33, 0.01), y: grid(28, 33, 0.01).map(() => 5) } }
]);
const batchBad = await Batch.runBatch(badSamples, settings, {});
const rEmpty = batchBad.results.find(r => r.id === 'bad1');
const rNoPeak = batchBad.results.find(r => r.id === 'bad2');
MEAS.B7 = { empty: rEmpty.reason, noPeak: rNoPeak.reason, okCount: batchBad.results.filter(r => r.ok).length };
ok(!rEmpty.ok && /no-data/.test(rEmpty.reason) && !rNoPeak.ok && /no-peaks/.test(rNoPeak.reason) && batchBad.results.filter(r => r.ok).length === 2,
  'B7 失败样品给具体原因且不中断整批（2 成功 + 2 失败）', MEAS.B7);

/* 取消：第 2 个样品后取消，后续标 cancelled */
let cancelFlag = false;
const batchCancel = await Batch.runBatch(samples, settings, {
  isCancelled: () => cancelFlag,
  onProgress: (d) => { if (d >= 2) cancelFlag = true; }
});
const cancelledCount = batchCancel.results.filter(r => r.skipped && /cancelled/.test(r.reason)).length;
MEAS.B8 = { done: batchCancel.results.filter(r => r.ok).length, cancelled: cancelledCount };
ok(cancelledCount >= N - 2 && batchCancel.results.filter(r => r.ok).length <= 2,
  'B8 取消后后续样品标记 cancelled 且停止计算', MEAS.B8);

/* CSV 导出 */
const tcsv = Batch.trendCSV(aligned);
const scsv = Batch.summaryCSV(batch);
const tLines = tcsv.trim().split('\n');
const sLines = scsv.trim().split('\n');
MEAS.B9 = { trendRows: tLines.length - 1, summaryRows: sLines.length - 1, trendHead: tLines[0] };
ok(tLines.length - 1 === N && /center_2theta/.test(tLines[0]) && /D_apparent/.test(tLines[0]) && sLines.length - 1 === N,
  'B9 趋势/汇总 CSV 行数与表头正确', MEAS.B9);

/* 固定初值模式 */
const settingsFixed = Object.assign({}, settings, { init: 'fixed', peaks: [{ c: 30, w: 0.2, h: 1000, sp: 0.5, locks: {} }] });
const batchFixed = await Batch.runBatch(samples.slice(0, 1), settingsFixed, {});
ok(batchFixed.results[0].ok && Math.abs(batchFixed.results[0].params[0].c - 30) < 0.03,
  'B10 固定初值模式可用', batchFixed.results[0].ok ? +batchFixed.results[0].params[0].c.toFixed(4) : batchFixed.results[0].reason);

console.log('== 实测表 ==');
console.log(JSON.stringify(MEAS, null, 1));
console.log('== 系列批量真值汇总 == 通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
