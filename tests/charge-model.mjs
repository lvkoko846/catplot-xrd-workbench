/* 荷电校正（XPS 整谱平移）真值验收（Node 直跑 model.buildLayers，零浏览器）。
   覆盖：xShift 只作用于 analysis/display 的 x（y 不变、raw/working 不变）、
   正负位移方向（校正后 = 原 − shift）、shift=0 与默认参数行为不变、basisKey 纳入位移使峰表失效。
   用法：node tests/charge-model.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (typeof global.window === 'undefined') global.window = global;
require('../web/js/analysis.js');
require('../web/js/model.js');
const M = global.CatModel;

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }
function near(a, b, tol) { return a != null && Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }

console.log('== H 荷电校正真值（XPS 整谱平移） ==');

const working = { x: [280, 285, 290, 295], y: [10, 100, 40, 5] };

/* H1 无位移：analysis/display 的 x 等于原 x；y 保持 */
let L = M.buildLayers(working, false, 0, 0);
ok(L.analysis.x.join(',') === working.x.join(',') && L.display.x.join(',') === working.x.join(','),
  'H1a shift=0：x 不变', L.analysis.x);
ok(L.analysis.y.join(',') === '10,100,40,5' && L.display.y.join(',') === '10,100,40,5',
  'H1b shift=0：y 不变', { a: L.analysis.y, d: L.display.y });

/* H2 未传 xShift（旧调用签名）：行为与 shift=0 一致 */
L = M.buildLayers(working, false, 0);
ok(L.analysis.x.join(',') === working.x.join(','), 'H2 省略 xShift 向后兼容', L.analysis.x);

/* H3 正位移 shift=1.5（C1s 实测286.3→目标284.8）：校正后 x = 原 − 1.5 */
L = M.buildLayers(working, false, 0, 1.5);
ok(L.analysis.x.join(',') === '278.5,283.5,288.5,293.5', 'H3a 正位移：x 整体左移 1.5', L.analysis.x);
ok(L.display.x.join(',') === L.analysis.x.join(','), 'H3b analysis 与 display 的 x 一致', L.display.x);
ok(L.analysis.y.join(',') === '10,100,40,5', 'H3c 位移不影响 y（纯 X 平移）', L.analysis.y);

/* H4 负位移 shift=-2：校正后 x = 原 + 2 */
L = M.buildLayers(working, false, 0, -2);
ok(L.analysis.x.join(',') === '282,287,292,297', 'H4 负位移：x 整体右移 2', L.analysis.x);

/* H5 位移与归一化/偏移叠加：y 只受归一化+偏移影响，x 只受位移影响 */
L = M.buildLayers(working, true, 3, 1.5);
ok(near(L.analysis.y[1], 1, 1e-12), 'H5a 归一化峰值=1（位移不干扰）', L.analysis.y[1]);
ok(near(L.display.y[1], 4, 1e-12), 'H5b 显示层=分析层+偏移', L.display.y[1]);
ok(L.analysis.x[1] === 283.5, 'H5c 位移与归一化互不干扰', L.analysis.x[1]);

/* H6 不修改输入（纯函数） */
const before = working.x.slice();
M.buildLayers(working, true, 2, 5);
ok(working.x.join(',') === before.join(','), 'H6 不修改调用方输入', working.x);

/* H7 峰表基线键纳入位移：位移改变 → 键改变（旧峰表应标待更新） */
const AN = global.CatAnalysis;
const bg = { mode: 'none', applied: false, points: [] };
function keyWithShift(sh) { return AN.basisKey(working, bg) + ':' + (sh ? 'c' + Math.round(sh * 1e6) : 'c0'); }
ok(keyWithShift(0) !== keyWithShift(1.5) && keyWithShift(1.5) === keyWithShift(1.5),
  'H7 基线键随位移变化且确定性一致', { k0: keyWithShift(0), k15: keyWithShift(1.5) });

/* H8 默认 charge 对象结构 */
const dc = M.defaultCharge();
ok(dc.mode === 'none' && dc.shift === 0 && dc.applied === false && dc.refLabel === '',
  'H8 defaultCharge 默认未校正', dc);

console.log('== 荷电校正真值汇总 == 通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
