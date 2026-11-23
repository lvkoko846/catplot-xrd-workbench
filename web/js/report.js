/* CatPlot 一键组会报告（report-1，UMD：浏览器/Node，零依赖）。
   生成自包含 HTML：对比图 + 趋势图 + 峰参数/批量汇总 + 匹配闭环 + 方法脚注 + 数据溯源 + 未做/待核验清单。
   诚实口径：得分非存在概率；面积占比非含量；Scherrer 表观值警示；模拟数据明确标注；不做项显式列出。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CatReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function f(v, d) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(d == null ? 3 : d); }

  function table(headers, rows) {
    if (!rows || !rows.length) return '<p class="note">（无）</p>';
    return '<table><thead><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }

  /* payload: {title, generatedAt, mainSvg, trendSvg, samples:[{name,source,points,normalize,offset}],
     fitRegions:[{min,max,shape,params,quality}], batchResults, aligned, match:{candidates,phases,coverage},
     provenance:[{name,license,source,url,note}], limitations:[..], notDone:[..]} */
  function buildReport(p) {
    p = p || {};
    var H = [];
    H.push('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
    H.push('<title>' + esc(p.title || 'CatPlot 组会报告') + '</title><style>' + CSS + '</style></head><body>');
    H.push('<header><h1>' + esc(p.title || 'CatPlot 组会报告') + '</h1><p class="note">生成时间 ' + esc(p.generatedAt || '') + ' · 表征：' + esc(p.techniqueName || 'XRD') + ' · CatPlot 多表征分析工作台 · 数据仅在本地处理</p></header>');

    /* 样品与溯源 */
    H.push('<section><h2>一、样品与数据来源</h2>');
    var anyCharge = (p.samples || []).some(function (s) { return s.charge; });
    var head1 = ['样品', '来源', '数据点', '归一化', '显示偏移'];
    if (anyCharge) head1.push('荷电校正');
    H.push(table(head1, (p.samples || []).map(function (s) {
      var row = [s.name, s.source === 'sim' ? '模拟（演示）' : '上传（实验）', s.points, s.normalize ? '是' : '否', f(s.offset, 1)];
      if (anyCharge) row.push(s.charge ? ('−' + f(s.charge.shift, 2) + ' eV' + (s.charge.refMeasured != null ? '（' + (s.charge.refLabel || '参考峰') + ' ' + f(s.charge.refMeasured, 1) + '→' + f(s.charge.refTarget, 1) + '）' : '')) : '未校正');
      return row;
    })));
    if (p.provenance && p.provenance.length) {
      H.push('<h3>参考/示例数据溯源</h3>');
      H.push(table(['名称', '许可', '来源', '链接', '说明'], p.provenance.map(function (q) { return [q.name, q.license, q.source, q.url || '—', q.note || '']; })));
    }
    H.push('</section>');

    /* 对比图 */
    if (p.mainSvg) H.push('<section><h2>二、多样品对比图</h2><div class="fig">' + p.mainSvg + '</div><p class="note">显示层（含偏移/归一化）；原始数据保留于项目存档。</p></section>');

    /* 拟合 */
    if (p.fitRegions && p.fitRegions.length) {
      H.push('<section><h2>三、峰拟合参数</h2>');
      p.fitRegions.forEach(function (r) {
        H.push('<h3>区间 ' + f(r.min, 2) + '–' + f(r.max, 2) + '° · ' + esc(r.shape || '') + ' · Rwp=' + f(r.quality && r.quality.rwp, 4) + '</h3>');
        var tot = (r.params || []).reduce(function (a, q) { return a + (q.area || 0); }, 0) || 1;
        H.push(table(['#', '中心2θ', 'd(Å)', 'FWHM(°)', '面积', '面积相对占比', 'η/m'], (r.params || []).map(function (q, i) {
          return [i + 1, f(q.c, 3), f(q.d, 4), f(q.w, 4), f(q.area, 1), f(100 * q.area / tot, 1) + '%', f(q.sp, 2)];
        })));
      });
      H.push('<p class="warn">面积相对占比 = 峰面积相对占比，<b>非物相含量</b>；标准误为线性近似。</p></section>');
    }

    /* 批量趋势 */
    if (p.batchResults && p.batchResults.length) {
      H.push('<section><h2>四、系列样品批量趋势</h2>');
      if (p.trendSvg) H.push('<div class="fig">' + p.trendSvg + '</div>');
      H.push(table(['样品', 'X', '状态', '峰数', 'Rwp', '原因'], p.batchResults.map(function (r) {
        return [r.name, f(r.xValue, 2), r.ok ? '成功' : '失败', r.ok ? r.params.length : 0, r.ok && r.quality ? f(r.quality.rwp, 4) : '—', r.ok ? '' : r.reason];
      })));
      /* 每样品全部特征峰（多峰样品不截断）；d/D 仅 XRD */
      var isX = p.xrd !== false;
      var xu = p.xUnit || '°';
      var allRows = [];
      p.batchResults.forEach(function (r) {
        if (!r.ok || !r.params) return;
        r.params.forEach(function (q, qi) {
          var row = [r.name, f(r.xValue, 2), qi + 1, f(q.c, 3)];
          if (isX) row.push(f(q.d, 4));
          row.push(f(q.w, 4), f(q.area, 1));
          if (isX) row.push(q.D != null ? f(q.D, 2) + (q.Dapparent ? '*' : '') : '—');
          allRows.push(row);
        });
      });
      var hd = ['样品', 'X', '峰#', '中心(' + xu + ')']; if (isX) hd.push('d(Å)'); hd.push('FWHM(' + xu + ')', '面积'); if (isX) hd.push('D(nm)');
      if (allRows.length) H.push('<h3>每样品全部特征峰（' + allRows.length + ' 行）</h3>' + table(hd, allRows));
      if (isX) H.push('<p class="warn">* 表观晶粒尺寸（Scherrer，未扣仪器宽化时系统性偏小；忽略应变宽化；不与 TEM 粒径等价）。</p>');
      H.push('</section>');
    }

    /* 匹配闭环 */
    if (p.match && (p.match.candidates || p.match.phases)) {
      H.push('<section><h2>五、物相匹配与多物相闭环</h2>');
      if (p.match.candidates && p.match.candidates.length) {
        H.push(table(['参考', '得分', '可靠', '匹配/实验', '比例', '偏差'], p.match.candidates.map(function (c) {
          return [c.name, c.score, c.reliable ? '可靠' : '不足', c.matched + '/' + c.usableExp, f(c.composition.matchFrac, 2), f(c.composition.devScore, 2)];
        })));
      }
      if (p.match.phases && p.match.phases.length) {
        H.push('<h3>已确认物相</h3>');
        H.push(table(['物相', '得分', '覆盖峰数', '可靠性'], p.match.phases.map(function (ph) { return [ph.name, ph.score, ph.coveredT.length, ph.reliable ? '可靠' : '证据不足']; })));
      }
      if (p.match.coverage) H.push('<p class="note">覆盖核算：' + esc(p.match.coverage) + '</p>');
      H.push('<p class="warn">得分为证据合成，<b>不是物相存在概率</b>；&lt;1% 弱峰不配对，重叠峰不自动归属。</p></section>');
    }

    /* 方法与诚实清单 */
    H.push('<section><h2>六、方法脚注</h2><ul class="note">' +
      '<li>三层数据分离：raw（原始）/ working（分析）/ display（显示）；偏移与归一化仅显示，不参与拟合/寻峰/匹配。</li>' +
      '<li>峰拟合：Levenberg–Marquardt + 解析 Jacobian + 参数缩放；pseudo-Voigt 等峰型；背景联合优化；Rwp/Rp/χ² 全区间计算。</li>' +
      '<li>批量：逐样品 raw 层拟合，auto 多初值重试抗跨平台浮点差异；跨样品按参考峰位贪心对齐（容差内）。</li>' +
      '<li>匹配：pm-2-lite 证据评分；一对一占用；确认闭环 covered 按峰位跨轮对齐。</li>' +
      '<li>荷电校正（XPS）：以参考峰（如 C1s=284.8 eV）为基准整谱平移 X 轴，作用于分析/显示层，原始数据不变；基准选错会使化学态归属整体偏移。</li></ul></section>');
    H.push('<section><h2>七、未做 / 待核验（诚实清单）</h2><ul class="warn">' +
      (p.notDone || ['全谱 Rietveld 精修', '物相定量（RIR/内标）与峰面积→质量分数', '结构精修', '仪器宽化未提供时晶粒尺寸为表观值', '二进制/计算参考未经独立科学核验']).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
      (p.limitations || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>');
    H.push('<footer class="note">本报告由 CatPlot 自动生成；数值以项目存档与导出 CSV 为准。模拟数据不代表真实实验结果。</footer>');
    H.push('</body></html>');
    return H.join('\n');
  }

  var CSS = 'body{font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;margin:0 auto;max-width:1000px;padding:24px;color:#1e293b;line-height:1.55}' +
    'header h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin-top:28px}h3{font-size:14px;margin:14px 0 6px}' +
    'table{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}th,td{border:1px solid #e2e8f0;padding:5px 8px;text-align:left}th{background:#f8fafc}' +
    '.fig{border:1px solid #e2e8f0;border-radius:8px;padding:8px;margin:8px 0;background:#fff}.fig svg{width:100%;height:auto}' +
    '.note{color:#64748b;font-size:12.5px}.warn{color:#b45309;font-size:12.5px}ul{margin:6px 0;padding-left:20px}footer{margin-top:28px;border-top:1px solid #e2e8f0;padding-top:10px}';

  return { buildReport: buildReport, esc: esc };
});
