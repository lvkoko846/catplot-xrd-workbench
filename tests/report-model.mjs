/* 组会报告真值验收（report-1，Node 直跑 report.js，零浏览器）。
   断言自包含 HTML 含各章节、诚实口径（非概率/非含量/表观值）、模拟标注、溯源、未做清单、HTML 转义。
   用法：node tests/report-model.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../web/js/report.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } }

console.log('== R 组会报告真值（report-1） ==');
const payload = {
  title: 'TiO2 系列组会', generatedAt: '2026-11-19T00:00:00Z',
  mainSvg: '<svg viewBox="0 0 960 560"><path d="M0 0"/></svg>',
  trendSvg: '<svg viewBox="0 0 960 420"><path d="M0 0"/></svg>',
  samples: [{ name: '样品<x>', source: 'file', points: 2501, workingPoints: 2499, format: 'ras', skippedRows: 2, warnings: ['因子列已换算', '非单调已排序'], normalize: false, offset: 0 }, { name: '模拟演示', source: 'sim', points: 501, normalize: true, offset: 5 }],
  fitRegions: [{ min: 24, max: 27, shape: 'pseudoVoigt', params: [{ c: 25.27, d: 3.52, w: 0.4, area: 400, sp: 0.5 }], quality: { rwp: 0.04 } }],
  batchResults: [{ name: 'x=0', xValue: 0, ok: true, params: [{ c: 25.27, d: 3.52, w: 0.4, area: 400, D: 20, Dapparent: true }, { c: 27.4, d: 3.25, w: 0.3, area: 300, D: 27, Dapparent: true }], quality: { rwp: 0.04 } }, { name: '坏', xValue: 1, ok: false, reason: 'no-peaks: 区间无峰' }, { name: '取消', xValue: 2, ok: false, skipped: true, reason: 'cancelled: 批量已取消' }],
  match: { candidates: [{ name: '锐钛矿', score: 88, reliable: true, matched: 3, usableExp: 6, composition: { matchFrac: 0.5, devScore: 0.9 } }], phases: [{ name: '锐钛矿', score: 88, coveredT: [25.3], reliable: true }], coverage: '已解释 3 · 剩余 3' },
  provenance: [{ name: 'XRED', license: 'MIT', source: 'github', url: 'https://github.com/WPEM/XRED', note: '实验谱' }]
};
const html = R.buildReport(payload);

ok(html.startsWith('<!DOCTYPE html>') && html.includes('</html>'), 'R1 自包含完整HTML文档');
ok(html.includes('一、样品与数据来源') && html.includes('二、多样品对比图') && html.includes('三、峰拟合参数') && html.includes('四、系列样品批量趋势') && html.includes('五、物相匹配') && html.includes('六、方法脚注') && html.includes('七、未做'), 'R2 七章节齐全');
ok(html.includes('不是物相存在概率') && html.includes('非物相含量') && html.includes('表观晶粒尺寸') && html.includes('不与 TEM 粒径等价'), 'R3 诚实口径（非概率/非含量/表观值）');
ok(html.includes('模拟（演示）') && html.includes('不代表真实实验结果'), 'R4 模拟数据明确标注');
ok(html.includes('MIT') && html.includes('https://github.com/WPEM/XRED'), 'R5 溯源许可与链接');
ok(html.includes('Rietveld') && html.includes('物相定量'), 'R6 未做清单含Rietveld/定量');
ok(html.includes('样品&lt;x&gt;') && !html.includes('样品<x>'), 'R7 HTML转义防注入');
ok(html.includes('no-peaks: 区间无峰'), 'R8 失败样品原因入报告');
ok(html.includes('<svg') && html.includes('M0 0'), 'R9 内嵌对比/趋势SVG');
ok(html.includes('每样品全部特征峰（2 行）') && html.includes('27.4'), 'R10 多峰样品全峰表不截断', html.includes('每样品全部特征峰'));
ok(html.includes('导入质量与警告') && html.includes('2501 / 2499') && html.includes('因子列已换算'), 'R11 报告含导入格式、原始/分析点与警告');
ok(html.includes('成功 1 · 失败 1 · 取消/跳过 1') && html.includes('取消/跳过'), 'R12 批量结果区分成功、失败与取消');

console.log('== 组会报告真值汇总 == 通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
