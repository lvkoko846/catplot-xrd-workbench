/* 峰拟合合成真值验收（任务2.6，Node 直跑 fitcore，零浏览器）。
   阈值依据：SNR≈20 时中心标准误 ≈ FWHM/(SNR·√峰内点数) ≈ 0.2/(20·√20) ≈ 0.002°，
   FWHM 相对标准误 ≈ 1/(SNR·√点数) ≈ 1%；断言阈值 0.05°/10% 留约 20 倍裕量覆盖优化器偏差与噪声实现差异。
   用法：node tests/fit-model.mjs */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const Core = require('../web/js/fitcore.js');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
const init = (c, w, h, sp) => ({ c, w, h, sp, locks: {} });

console.log('== F 峰拟合合成真值（fit-1） ==');
let x = grid(28, 32, 0.01);
let truth = [P(30, 0.2, 1000, 0.5)];
let y = synth(x, truth, 'pseudoVoigt', null, 0);
let r = await Core.fit({ x, y, region: { min: 28, max: 32 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: [init(30.05, 0.25, 900, 0.3)] });
let areaTrue = Core.peakArea('pseudoVoigt', 1000, 0.2, 0.5);
MEAS.F1 = r.ok ? { cErr: +Math.abs(r.params[0].c - 30).toFixed(5), wErrPct: +(100 * Math.abs(r.params[0].w - 0.2) / 0.2).toFixed(3), areaErrPct: +(100 * Math.abs(r.params[0].area - areaTrue) / areaTrue).toFixed(3), rwp: +r.quality.rwp.toFixed(6) } : r.reason;
ok(r.ok && Math.abs(r.params[0].c - 30) < 0.01 && Math.abs(r.params[0].w - 0.2) / 0.2 < 0.01 && Math.abs(r.params[0].area - areaTrue) / areaTrue < 0.01,
  'F1 单 pseudo-Voigt 无噪声：中心<0.01°、FWHM<1%、面积<1%', r.ok ? { c: r.params[0].c, w: r.params[0].w, areaErr: +(Math.abs(r.params[0].area - areaTrue) / areaTrue).toFixed(5), rwp: r.quality.rwp } : r.reason);

x = grid(28.5, 31.5, 0.01);
truth = [P(30, 0.2, 1000, 0.5), P(30.2, 0.2, 800, 0.5)];
y = synth(x, truth, 'pseudoVoigt', null, 0);
r = await Core.fit({ x, y, region: { min: 28.5, max: 31.5 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: [init(29.97, 0.22, 950, 0.5), init(30.24, 0.18, 750, 0.5)] });
const aT = truth.map(p => Core.peakArea('pseudoVoigt', p.h, p.w, p.sp));
MEAS.F2 = r.ok ? r.params.map((p, i) => ({ cErr: +Math.abs(p.c - truth[i].c).toFixed(4), areaErrPct: +(100 * Math.abs(p.area - aT[i]) / aT[i]).toFixed(2) })) : r.reason;
ok(r.ok && r.params.every((p, i) => Math.abs(p.c - truth[i].c) < 0.05 && Math.abs(p.area - aT[i]) / aT[i] < 0.08),
  'F2 双峰重叠（间距=1×FWHM）：中心<0.05°、面积<8%', r.ok ? r.params.map(p => ({ c: +p.c.toFixed(4), areaErr: +((p.area - aT[r.params.indexOf(p)]) / aT[r.params.indexOf(p)]).toFixed(4) })) : r.reason);

x = grid(28, 32, 0.01);
truth = [P(30, 0.2, 1000, 0.5)];
y = synth(x, truth, 'pseudoVoigt', null, 50, 11); // SNR = 1000/50 = 20
r = await Core.fit({ x, y, region: { min: 28, max: 32 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: [init(30.04, 0.24, 900, 0.4)] });
MEAS.F3 = r.ok ? { cErr: +Math.abs(r.params[0].c - 30).toFixed(4), wErrPct: +(100 * Math.abs(r.params[0].w - 0.2) / 0.2).toFixed(2), rwp: +r.quality.rwp.toFixed(4) } : r.reason;
ok(r.ok && Math.abs(r.params[0].c - 30) < 0.05 && Math.abs(r.params[0].w - 0.2) / 0.2 < 0.10,
  'F3 噪声 SNR≈20：中心<0.05°、FWHM<10%（阈值依据见文件头注释）', r.ok ? { c: +r.params[0].c.toFixed(4), w: +r.params[0].w.toFixed(4), rwp: +r.quality.rwp.toFixed(4) } : r.reason);

x = grid(22, 38, 0.02);
truth = [P(25, 0.15, 800, 0.4), P(30, 0.2, 600, 0.6), P(35, 0.25, 400, 0.5)];
y = synth(x, truth, 'pseudoVoigt', { model: 'linear', coeffs: [50, 30] }, 0);
r = await Core.fit({ x, y, region: { min: 22, max: 38 }, shape: 'pseudoVoigt', bg: { model: 'linear' }, peaks: [init(25.03, 0.18, 750, 0.5), init(29.96, 0.22, 550, 0.5), init(35.04, 0.28, 380, 0.5)] });
MEAS.F4 = r.ok ? { bg: r.bgCoeffs.map(v => +v.toFixed(3)), rwp: +r.quality.rwp.toFixed(6) } : r.reason;
ok(r.ok && Math.abs(r.bgCoeffs[0] - 50) < 2 && Math.abs(r.bgCoeffs[1] - 30) < 2 && r.params.every((p, i) => Math.abs(p.c - truth[i].c) < 0.02) && r.quality.rwp < 0.02,
  'F4 倾斜线性背景+3峰：背景系数与峰参数同恢复，Rwp<0.02', r.ok ? { bg: r.bgCoeffs.map(v => +v.toFixed(3)), rwp: +r.quality.rwp.toFixed(5) } : r.reason);

x = grid(28, 32, 0.01);
y = synth(x, [P(30, 0.2, 1000, 0)], 'gauss', null, 0);
let rg = await Core.fit({ x, y, region: { min: 28, max: 32 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: [init(30.03, 0.23, 950, 0.5)] });
y = synth(x, [P(30, 0.2, 1000, 1)], 'lorentz', null, 0);
let rl = await Core.fit({ x, y, region: { min: 28, max: 32 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: [init(30.03, 0.23, 950, 0.5)] });
ok(rg.ok && rg.params[0].sp < 0.05 && Math.abs(rg.params[0].w - 0.2) / 0.2 < 0.01 && rl.ok && rl.params[0].sp > 0.95 && Math.abs(rl.params[0].w - 0.2) / 0.2 < 0.01,
  'F5 纯 Gauss/纯 Lorentz 极限：η 恢复 0/1，FWHM<1%', { gaussEta: rg.ok ? +rg.params[0].sp.toFixed(4) : rg.reason, lorentzEta: rl.ok ? +rl.params[0].sp.toFixed(4) : rl.reason });

x = grid(28, 32, 0.01);
y = synth(x, [P(30, 0.2, 1000, 0.5)], 'pseudoVoigt', null, 0);
r = await Core.fit({ x, y, region: { min: 28, max: 32 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: [29, 29.6, 30.2, 30.8, 31.4, 28.4].map(c => init(c, 0.2, 300, 0.5)) });
ok(!r.ok && /underdetermined|strong-correlation|not-converged|degenerate-peaks|ill-conditioned/.test(r.reason) && r.reason.length > 20,
  'F6 峰数远超实际：报错且原因具体（不返回成功）', r.reason);

x = grid(20, 60, 0.002); // 20001 点
truth = Array.from({ length: 30 }, (_, i) => P(22 + i * 1.2, 0.15, 500 + (i % 5) * 100, 0.5));
y = synth(x, truth, 'pseudoVoigt', null, 0);
const t0 = Date.now();
r = await Core.fit({ x, y, region: { min: 20, max: 60 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: truth.map(p => init(p.c + 0.02, p.w * 1.1, p.h * 0.9, 0.5)) }, { isCancelled: () => Date.now() - t0 > 120 });
const cancelMs = Date.now() - t0;
ok(!r.ok && r.reason === 'cancelled' && cancelMs <= 2000, 'F7 中途取消：≤2s 终态、reason=cancelled', { cancelMs, reason: r.reason });

let sch = Core.scherrer({ fwhm: 0.2, center: 30, lambda: 1.5406, K: 0.89 });
ok(sch.ok && sch.apparent && /表观值，未扣除仪器宽化，系统性偏小/.test(sch.note), 'F8a 未填仪器宽化：Scherrer 标表观值+警示文案', sch);
let sch2 = Core.scherrer({ fwhm: 0.2, center: 30, lambda: 1.5406, K: 0.89, instFwhm: 0.1 });
let sch3 = Core.scherrer({ fwhm: 0.2, center: 30, lambda: 1.5406, instFwhm: 0.25 });
ok(sch2.ok && !sch2.apparent && sch2.D > sch.D && !sch3.ok && /仪器宽化/.test(sch3.reason), 'F8b 扣仪器宽化后 D 增大；仪器≥实测报错', { apparentD: +sch.D.toFixed(2), correctedD: +sch2.D.toFixed(2), bad: sch3.reason });

let cd1 = Core.cardDiff({ center: 31.25, lambda: 1.5406, refD: 2.86, refT: 31.28, refLambda: 1.5406 });
let cd2 = Core.cardDiff({ center: 31.25, lambda: 1.5406, refD: 2.86, refT: 31.28, refLambda: 1.5418 });
let dExpect = 1.5406 / (2 * Math.sin(31.25 * Math.PI / 360));
ok(cd1.ok && Math.abs(cd1.deltaD - (2.86 - dExpect)) < 1e-4 && cd1.deltaT !== null && cd2.ok && cd2.deltaT === null && /仅给 d 偏差/.test(cd2.note),
  'F11 卡片对照：Δd/Δ2θ 正确；波长不一致只给 d 偏差', { cd1, cd2 });

/* 性能：30 峰 × 20000 点单次拟合 <2s */
const tp = Date.now();
r = await Core.fit({ x, y, region: { min: 20, max: 60 }, shape: 'pseudoVoigt', bg: { model: 'none' }, peaks: truth.map(p => init(p.c + 0.02, p.w * 1.1, p.h * 0.9, 0.5)) });
const fitMs = Date.now() - tp;
MEAS.perf = { fitMs, iter: r.ok ? r.iterations : null, peaks: 30, points: 20001 };
ok(r.ok && fitMs < 2000, 'F-perf 30峰×20000点单次拟合<2s', r.ok ? { fitMs, iter: r.iterations, rwp: +r.quality.rwp.toFixed(5) } : { fitMs, reason: r.reason });

/* 真实数据：XRED 主峰拟合，峰位对照溯源文件已有数值（不凭记忆） */
const prov = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'PROVENANCE.json'), 'utf8'));
const nums = (prov.dataset.measurement.wavelengthBasis.match(/(\d+\.\d+)°/g) || []).map(s => parseFloat(s));
const csv = readFileSync(join(ROOT, 'tests', 'fixtures', 'real-xred', 'tio2-rutile-anatase.csv'), 'utf8').trim().split(/\r?\n/).map(l => l.split(',').map(Number));
const rx = csv.map(p => p[0]), ry = csv.map(p => p[1]);
const regions = [[24.4, 26.3, nums[0]], [26.7, 28.3, nums[1]], [47.0, 49.1, nums[2]]];
const realReport = [];
let realOk = true;
for (const [mn, mx, refC] of regions) {
  const rr = await Core.fit({ x: rx, y: ry, region: { min: mn, max: mx }, shape: 'pseudoVoigt', bg: { model: 'linear' }, peaks: [init(refC, 0.12, 300, 0.5)] });
  if (!rr.ok) { realOk = false; realReport.push({ region: [mn, mx], reason: rr.reason }); continue; }
  const dev = Math.abs(rr.params[0].c - refC);
  realReport.push({ region: [mn, mx], refFromProvenance: refC, fitted: +rr.params[0].c.toFixed(3), dev: +dev.toFixed(3), fwhm: +rr.params[0].w.toFixed(4), rwp: +rr.quality.rwp.toFixed(4) });
  if (dev > 0.1) realOk = false;
}
MEAS.real = realReport;
ok(realOk, 'F-real XRED 三主峰拟合：峰位与溯源文件数值偏差<0.1°，报告 FWHM/Rwp（不做含量推断）', realReport);

console.log('mem_heapUsed_MB=' + (process.memoryUsage().heapUsed / 1048576).toFixed(1) + ' rss_MB=' + (process.memoryUsage().rss / 1048576).toFixed(1));
console.log('== 实测表 ==');
console.log(JSON.stringify(MEAS, null, 1));
console.log('== 峰拟合真值汇总 == 通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);