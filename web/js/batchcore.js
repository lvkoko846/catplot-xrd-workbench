/* CatPlot 系列样品批量分析核心（batch-1，纯函数，UMD：浏览器经典脚本 / Node require）。
   对一组样品在共享 2θ 区间内逐一样品拟合（恒用 raw 原始层），汇总每峰的中心/FWHM/面积/
   表观晶粒尺寸/Rwp，并按参考峰位跨样品对齐成趋势序列。失败给具体原因，不静默跳过。
   不做物相定量；晶粒尺寸为 Scherrer 表观值（未扣仪器宽化时系统性偏小，强制标注）。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    /* Node：analysis.js 以 window.* 挂载，先置 shim 再 require */
    if (typeof global.window === 'undefined') global.window = global;
    require('./analysis.js');
    module.exports = factory(require('./fitcore.js'), global.CatAnalysis);
  } else {
    root.CatBatchCore = factory(root.CatFitCore, root.CatAnalysis);
  }
})(typeof self !== 'undefined' ? self : this, function (Core, AN) {
  'use strict';

  /* 寻峰：复用主分析模块 findPeaks（SG 平滑 + 稳健噪声阈值 + 突出度过滤 + 抛物线细化），
     抑制倾斜背景与噪声涟漪造成的伪峰。返回 {c,h} 列表。 */
  function detectPeaks(x, y, opts) {
    opts = opts || {};
    var noiseK = opts.noiseK != null ? opts.noiseK : 3;
    /* 批量初值须抗噪：即使设了绝对峰高下限，也强制突出度 ≥ noiseK·σ，
       否则宽峰旁的噪声涟漪（高度过阈但突出度极小）会被误判为峰，导致多峰拟合病态。 */
    var sigma = AN.estimateNoise(y);
    var minProm = opts.minProm != null ? opts.minProm : noiseK * sigma;
    var r = AN.findPeaks(x, y, {
      smooth: opts.smooth != null ? opts.smooth : 9,
      noiseK: noiseK,
      minHeight: opts.minHeight != null ? opts.minHeight : null,
      minProm: minProm,
      minDist: opts.minDist != null ? opts.minDist : 0.15,
      lo: opts.lo != null ? opts.lo : -Infinity,
      hi: opts.hi != null ? opts.hi : Infinity
    });
    return r.peaks.map(function (p) { return { c: p.x, h: p.height }; });
  }

  /* 由检测峰构建拟合初值：FWHM 用区间内数据步长的若干倍估计，η 默认 0.5。 */
  function buildInitPeaks(x, detected, region, shape) {
    var st = Core.step(x);
    var w0 = Math.max(st * 4, (region.max - region.min) / 40);
    return detected.map(function (p) {
      var sp = shape === 'pseudoVoigt' ? 0.5 : shape === 'pearson7' ? 2 : shape === 'lorentz' ? 1 : 0;
      return { c: p.c, w: w0, h: p.h, sp: sp, locks: {} };
    });
  }

  /* 单样品批量拟合：恒用 raw 层。返回 {ok, params, quality, reason, ...}。 */
  async function fitSample(sample, settings, hooks) {
    hooks = hooks || {};
    var raw = sample && sample.raw;
    if (!raw || !Array.isArray(raw.x) || !Array.isArray(raw.y) || raw.x.length < 10) {
      return { ok: false, reason: 'no-data: 样品无有效原始数据（raw 层点数不足）' };
    }
    var region = { min: settings.region.min, max: settings.region.max };
    var shape = settings.shape || 'pseudoVoigt';
    var bgModel = (settings.bg && settings.bg.model) || 'linear';
    var peaks;
    if (settings.init === 'fixed' && Array.isArray(settings.peaks) && settings.peaks.length) {
      peaks = settings.peaks.map(function (p) { return { c: p.c, w: p.w, h: p.h, sp: p.sp, locks: p.locks || {} }; });
    } else {
      var detected = detectPeaks(raw.x, raw.y, {
        minHeight: settings.minHeight != null ? settings.minHeight : 0,
        minDist: settings.minDist != null ? settings.minDist : 0.15,
        lo: region.min, hi: region.max
      });
      if (!detected.length) return { ok: false, reason: 'no-peaks: 区间内未检测到峰（绝对峰高下限 ' + (settings.minHeight != null ? settings.minHeight : 0) + ' 可能过高）' };
      peaks = buildInitPeaks(raw.x, detected, region, shape);
    }
    if (!peaks.length) return { ok: false, reason: 'no-peaks: 未设置任何峰初值' };
    var bgCfg = { model: bgModel, coeffs: (settings.bg && settings.bg.coeffs) || null, anchors: (settings.bg && settings.bg.anchors) || null };
    var maxIter = settings.maxIter || 120;
    /* 确定性多初值重试：LM 在噪声数据的病态边缘对浮点舍入敏感（不同 JS 引擎 Math.exp/sin
       末位差异可致同一初值在一处收敛、另一处奇异）。auto 模式按 FWHM 初值倍数依次重试，
       任一次收敛即成功；全部失败才报具体原因。固定初值模式尊重用户设置，不重试。 */
    var widthFactors = settings.init === 'fixed' ? [1] : [1, 1.8, 0.6, 2.6];
    var res = null, lastReason = null;
    for (var wf = 0; wf < widthFactors.length; wf++) {
      if (hooks.isCancelled && hooks.isCancelled()) { res = { ok: false, reason: 'cancelled' }; break; }
      var tryPeaks = peaks.map(function (p) { return { c: p.c, w: p.w * widthFactors[wf], h: p.h, sp: p.sp, locks: p.locks || {} }; });
      var cfg = { x: raw.x, y: raw.y, region: region, shape: shape, bg: bgCfg, peaks: tryPeaks, maxIter: maxIter };
      res = await Core.fit(cfg, hooks);
      if (res.ok) break;
      lastReason = res.reason;
      if (res.reason === 'cancelled' || /^no-|^bad-init|^underdetermined|^no-free/.test(res.reason)) break;
    }
    if (!res.ok) return { ok: false, reason: lastReason || res.reason, iterations: res.iterations };
    /* d 值/Scherrer 为 XRD 专属（settings.xrd!==false）；其他表征仅通用峰参数 */
    var isXrd = settings.xrd !== false;
    var lambda = settings.lambda != null ? settings.lambda : 1.5406;
    var inst = settings.instrument && settings.instrument.mode === 'fixed' ? settings.instrument.fwhm : null;
    var K = settings.K != null ? settings.K : 0.89;
    var params = res.params.map(function (p) {
      var sch = isXrd ? Core.scherrer({ center: p.c, fwhm: p.w, lambda: lambda, instFwhm: inst, K: K }) : { ok: false };
      return {
        c: p.c, w: p.w, h: p.h, sp: p.sp, area: p.area,
        se: p.se || null,
        d: isXrd ? Core.dFromT(p.c, lambda) : null,
        D: sch.ok ? sch.D : null, Dapparent: sch.ok ? sch.apparent : null, Dreason: sch.ok ? null : sch.reason
      };
    });
    return { ok: true, params: params, quality: res.quality, iterations: res.iterations, shape: shape, bgModel: res.bgModel };
  }

  /* 批量运行：逐样品串行拟合，支持取消与进度回调。失败样品记录原因，不中断整批。 */
  async function runBatch(samples, settings, hooks) {
    hooks = hooks || {};
    var results = [];
    for (var i = 0; i < samples.length; i++) {
      if (hooks.isCancelled && hooks.isCancelled()) {
        results.push({ id: samples[i].id, name: samples[i].name, ok: false, reason: 'cancelled: 批量已取消', skipped: true });
        continue;
      }
      var s = samples[i];
      var r = await fitSample(s, settings, hooks);
      r.id = s.id; r.name = s.name; r.index = i;
      r.xValue = settings.xMode === 'value' && Array.isArray(settings.xValues) ? settings.xValues[i] : i + 1;
      results.push(r);
      if (hooks.onProgress) hooks.onProgress(i + 1, samples.length, r);
    }
    return { results: results, settings: settings, at: new Date().toISOString(), algo: 'batch-1' };
  }

  /* 跨样品峰对齐：以参考峰位（默认首个成功样品的峰中心）为锚，容差内贪心最近匹配。
     返回每锚点的趋势序列 {ref, label, points:[{xValue,name,c,w,area,D,Dapparent,d,rwp}]}。 */
  function alignPeaks(batch, opts) {
    opts = opts || {};
    var tol = opts.tol != null ? opts.tol : 0.5;
    var okResults = batch.results.filter(function (r) { return r.ok && r.params && r.params.length; });
    if (!okResults.length) return { anchors: [], tol: tol };
    var refIdx = opts.refIndex != null ? opts.refIndex : 0;
    var ref = okResults[Math.min(refIdx, okResults.length - 1)];
    var anchors = ref.params.map(function (p, i) { return { ref: p.c, label: '峰 ' + (i + 1), points: [] }; });
    okResults.forEach(function (r) {
      var used = {};
      anchors.forEach(function (a) {
        var best = null, bestD = Infinity;
        r.params.forEach(function (p, pi) {
          if (used[pi]) return;
          var dd = Math.abs(p.c - a.ref);
          if (dd <= tol && dd < bestD) { bestD = dd; best = { p: p, pi: pi }; }
        });
        if (best) {
          used[best.pi] = true;
          a.points.push({
            xValue: r.xValue, name: r.name, index: r.index,
            c: best.p.c, w: best.p.w, area: best.p.area, D: best.p.D, Dapparent: best.p.Dapparent,
            d: best.p.d, rwp: r.quality ? r.quality.rwp : null,
            seC: best.p.se ? best.p.se.c : null, seW: best.p.se ? best.p.se.w : null
          });
        }
      });
    });
    anchors.forEach(function (a) { a.points.sort(function (p, q) { return p.xValue - q.xValue; }); });
    return { anchors: anchors, tol: tol, refName: ref.name };
  }

  /* 最小二乘线性回归（OLS）：斜率/截距/R²/标准误。
     n<3 时无残差自由度，标准误为 null（如实标注，不假装可估）。
     注意：OLS 未按各点标准误加权；若各点 SE 差异大，加权拟合更严谨。 */
  function linearRegression(xs, ys) {
    var n = xs.length;
    if (n !== ys.length) return { ok: false, reason: 'x/y 长度不一致' };
    if (n < 2) return { ok: false, n: n, reason: '观测点不足（' + n + ' < 2），无法回归' };
    var i, sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (i = 0; i < n; i++) {
      if (!isFinite(xs[i]) || !isFinite(ys[i])) return { ok: false, n: n, reason: '含非有限数值' };
      sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i];
    }
    var xbar = sx / n, ybar = sy / n;
    var Sxx = sxx - sx * sx / n;
    if (!(Sxx > 0)) return { ok: false, n: n, reason: 'x 全部相同，无自变量变化' };
    var slope = (sxy - sx * sy / n) / Sxx;
    var intercept = ybar - slope * xbar;
    var SST = 0, SSE = 0;
    for (i = 0; i < n; i++) {
      var yh = intercept + slope * xs[i];
      SSE += (ys[i] - yh) * (ys[i] - yh);
      SST += (ys[i] - ybar) * (ys[i] - ybar);
    }
    var r2 = SST > 0 ? 1 - SSE / SST : (SSE <= 1e-12 ? 1 : null);
    var df = n - 2, slopeSe = null, interceptSe = null;
    if (df >= 1) {
      var s2 = SSE / df;
      slopeSe = Math.sqrt(s2 / Sxx);
      interceptSe = Math.sqrt(s2 * (1 / n + xbar * xbar / Sxx));
    }
    return {
      ok: true, n: n, slope: slope, intercept: intercept, r2: r2,
      slopeSe: slopeSe, interceptSe: interceptSe, df: df,
      sse: SSE, xbar: xbar, ybar: ybar,
      note: df < 1 ? 'n=2 无残差自由度，斜率无标准误' : '标准误基于残差方差（OLS 未加权）'
    };
  }

  /* 回归直线在 [x0,x1] 的取值（用于画线）；±k·σ 为置信带（k 默认 1，σ 为预测标准差）。 */
  function regressionLine(reg, x0, x1, k) {
    if (!reg || !reg.ok) return null;
    var kk = k != null ? k : 1;
    function y(x) { return reg.intercept + reg.slope * x; }
    /* 均值响应标准误：σ·sqrt(1/n + (x-x̄)²/Sxx)，Sxx 由 slopeSe 反推 */
    var n = reg.n, s2 = reg.df >= 1 ? reg.sse / reg.df : 0;
    function band(x) {
      if (!(reg.df >= 1) || !(s2 > 0) || !reg.slopeSe) return 0;
      var S = s2 / (reg.slopeSe * reg.slopeSe);
      return kk * Math.sqrt(s2 * (1 / n + (x - reg.xbar) * (x - reg.xbar) / S));
    }
    return {
      at: y, band: band,
      p0: { x: x0, y: y(x0), lo: y(x0) - band(x0), hi: y(x0) + band(x0) },
      p1: { x: x1, y: y(x1), lo: y(x1) - band(x1), hi: y(x1) + band(x1) }
    };
  }

  /* 趋势 CSV：长表，每行一个 (样品, 锚峰) 观测 + 每锚峰回归参数。 */
  function trendCSV(aligned, metricLabels) {
    var head = ['series', 'ref_2theta', 'x_value', 'sample', 'center_2theta', 'd_angstrom', 'fwhm_deg', 'area', 'D_nm', 'D_apparent', 'rwp', 'se_center', 'se_fwhm'];
    var lines = [head.join(',')];
    aligned.anchors.forEach(function (a) {
      a.points.forEach(function (p) {
        lines.push([
          a.label, a.ref, p.xValue, csvCell(p.name), p.c, p.d, p.w, p.area,
          p.D == null ? '' : p.D, p.Dapparent == null ? '' : p.Dapparent, p.rwp == null ? '' : p.rwp,
          p.seC == null ? '' : p.seC, p.seW == null ? '' : p.seW
        ].join(','));
      });
    });
    return lines.join('\n');
  }

  /* 回归汇总 CSV：每行一个 (锚峰, 指标) 的 OLS 结果。 */
  function regressionCSV(regs) {
    var head = ['series', 'ref_2theta', 'metric', 'n', 'slope', 'slope_se', 'intercept', 'r2', 'note'];
    var lines = [head.join(',')];
    (regs || []).forEach(function (r) {
      lines.push([csvCell(r.label), r.ref, csvCell(r.metric), r.n,
        r.slope == null ? '' : r.slope, r.slopeSe == null ? '' : r.slopeSe,
        r.intercept == null ? '' : r.intercept, r.r2 == null ? '' : r.r2,
        csvCell(r.note || '')].join(','));
    });
    return lines.join('\n');
  }
  function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  /* 批量结果汇总 CSV：每行一个样品（含失败原因）。 */
  function summaryCSV(batch) {
    var head = ['index', 'sample', 'x_value', 'ok', 'n_peaks', 'rwp', 'reason'];
    var lines = [head.join(',')];
    batch.results.forEach(function (r) {
      lines.push([r.index, csvCell(r.name), r.xValue, r.ok ? 1 : 0, r.ok ? r.params.length : 0,
        r.ok && r.quality ? r.quality.rwp : '', csvCell(r.ok ? '' : r.reason)].join(','));
    });
    return lines.join('\n');
  }

  return {
    detectPeaks: detectPeaks, buildInitPeaks: buildInitPeaks,
    fitSample: fitSample, runBatch: runBatch, alignPeaks: alignPeaks,
    linearRegression: linearRegression, regressionLine: regressionLine,
    trendCSV: trendCSV, regressionCSV: regressionCSV, summaryCSV: summaryCSV, csvCell: csvCell
  };
});
