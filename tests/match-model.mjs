/* 粘贴峰表轻量匹配真值验收（pm-2-lite，Node 直跑 matchcore，零浏览器）。
   覆盖：峰表解析(d/2θ/错误行)、评分口径(权重/1%抑制/一对一)、可靠性判定、
   覆盖核算按峰位跨轮对齐、剩余峰续匹配置顶第二相。
   用法：node tests/match-model.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../web/js/matchcore.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }
const LAM = 1.5406;

console.log('== M 粘贴峰表匹配真值（pm-2-lite） ==');

/* M1 解析 2θ 模式 + 注释元数据 */
let r = M.parseRefTable('# name=锐钛矿\n# formula=TiO2\n# wavelength=1.5406\n25.28,100,101\n37.80,40,004\n48.05,50,200\n', {});
ok(r.ok && r.card.peaks.length === 3 && r.card.name === '锐钛矿' && Math.abs(r.card.peaks[0].d - M.tToD(25.28, LAM)) < 1e-6, 'M1 2θ模式解析+元数据', r.ok ? r.card.peaks.map(p => +p.d.toFixed(4)) : r.errors);

/* M2 解析 d 模式 + 错误行具体原因 */
r = M.parseRefTable('# wavelength=1.5406\n3.52,100\n2.38,40\nbad,x\n-1,5\n', { mode: 'd' });
ok(r.ok && r.card.peaks.length === 2 && r.errors.length === 2 && /行4/.test(r.errors[0]) && /行5/.test(r.errors[1]), 'M2 d模式解析+坏行具体原因', r.errors);

/* M3 评分：实验峰=参考峰(微小偏差) → 高分可靠 */
const refA = M.parseRefTable('# name=A\n25.28,100\n37.80,40\n48.05,50\n', { lambda: LAM }).card;
const exp = M.expFromPeaks([{ t: 25.30, i: 100 }, { t: 37.82, i: 40 }, { t: 48.07, i: 50 }], LAM);
let c = M.scoreCandidate(exp, refA, LAM, 0.2, null);
ok(c.score >= 90 && c.reliable && c.matched === 3, 'M3 全匹配高分可靠', { score: c.score, matched: c.matched, comp: c.composition });

/* M4 1% 弱峰抑制：参考含极弱峰，实验有对应位置也不计入 */
const refWeak = M.parseRefTable('# name=W\n25.28,100\n30.00,0.5\n', { lambda: LAM }).card;
const expW = M.expFromPeaks([{ t: 25.30, i: 100 }, { t: 30.00, i: 5 }], LAM);
c = M.scoreCandidate(expW, refWeak, LAM, 0.2, null);
ok(c.matched === 1 && c.pairs.every(p => Math.abs(p.expT - 25.30) < 0.01), 'M4 参考<1%弱峰不参与配对', { matched: c.matched });

/* M5 一对一占用：两个实验峰靠近同一参考峰，只计一次 */
const refOne = M.parseRefTable('# name=O\n25.28,100\n', { lambda: LAM }).card;
const expTwo = M.expFromPeaks([{ t: 25.26, i: 100 }, { t: 25.30, i: 90 }], LAM);
c = M.scoreCandidate(expTwo, refOne, LAM, 0.2, null);
ok(c.matched === 1, 'M5 参考峰一对一占用不重复计数', { matched: c.matched });

/* M6 可靠性判定：匹配比例不足 → 不可靠 */
const expPartial = M.expFromPeaks([{ t: 25.30, i: 100 }, { t: 60.0, i: 50 }, { t: 70.0, i: 40 }], LAM);
c = M.scoreCandidate(expPartial, refA, LAM, 0.2, null);
ok(!c.reliable && c.matched === 1, 'M6 匹配比例不足判不可靠', { score: c.score, reliable: c.reliable });

/* M7 多参考排序 + 剩余峰续匹配闭环（双相）。锐钛矿参考含 4 个自身峰（实验出现 3 个），
   金红石 3 个；首候选由匹配比例证据决定（3/6 > 2/6），不靠输入顺序。 */
const refA4 = M.parseRefTable('# name=锐钛矿\n25.28,100\n37.80,40\n48.05,50\n62.70,20\n', { lambda: LAM }).card;
const refR = M.parseRefTable('# name=金红石\n27.45,100\n36.09,50\n54.32,60\n', { lambda: LAM }).card;
/* 偏差方向交错（真实实验峰位偏差非单侧系统偏移）：锐钛矿平均|Δ|更小 → 偏差证据置顶 */
const expMix = M.expFromPeaks([{ t: 25.29, i: 100 }, { t: 37.78, i: 40 }, { t: 48.06, i: 50 }, { t: 27.49, i: 90 }, { t: 36.05, i: 45 }, { t: 54.36, i: 55 }], LAM);
let mm = M.match(expMix, [refR, refA4], LAM, 0.2, null);
ok(mm.candidates[0].name === '锐钛矿' && mm.candidates[0].matched === 3, 'M7 双相混合物首候选锐钛矿（证据排序，输入金红石在前）', mm.candidates.map(x => x.name + ':' + x.score));
/* 确认锐钛矿 → 覆盖核算 → 剩余峰续匹配金红石置顶 */
const phaseA = { name: '锐钛矿', coveredT: mm.candidates[0].coveredT };
let cov = M.coverage(expMix, [phaseA], 0.2);
ok(cov.covered.length === 3 && cov.remaining.length === 3, 'M7b 覆盖核算按峰位：3覆盖+3剩余', { covered: cov.covered.length, remaining: cov.remaining.length });
const mm2 = M.match(cov.remaining, [refA4, refR], LAM, 0.2, null);
ok(mm2.candidates[0].name === '金红石' && mm2.candidates[0].matched === 3 && mm2.candidates[0].reliable, 'M7c 剩余峰续匹配金红石置顶且可靠', mm2.candidates.map(x => x.name + ':' + x.score + ':' + x.matched));
/* 第二轮确认后总覆盖 6/6 */
const phaseR = { name: '金红石', coveredT: mm2.candidates[0].coveredT };
cov = M.coverage(expMix, [phaseA, phaseR], 0.2);
ok(cov.covered.length === 6 && cov.remaining.length === 0, 'M7d 两轮闭环覆盖6/6无剩余', { covered: cov.covered.length });

/* M8 重叠证据：两相共享峰位 → overlap 标记 */
const refShare = M.parseRefTable('# name=S\n25.28,100\n', { lambda: LAM }).card;
const covOv = M.coverage(expMix, [{ coveredT: [25.30] }, { coveredT: [25.31] }], 0.2);
ok(covOv.overlap.length >= 1, 'M8 跨轮共享峰记为重叠证据', covOv.overlap);

/* M9 扫描范围 refCov 权重生效 */
c = M.scoreCandidate(exp, refA, LAM, 0.2, { min: 20, max: 60 });
ok(c.composition.refCov != null && c.composition.weights.ref === 0.2, 'M9 有扫描范围时强峰覆盖权重0.2', c.composition);

console.log('== 粘贴峰表匹配真值汇总 == 通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
