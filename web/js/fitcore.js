/* CatPlot 峰拟合核心（fit-1，纯 JS 零依赖，双模式：浏览器经典脚本 / Worker / Node require）。
   Levenberg–Marquardt + 解析 Jacobian + 参数缩放；峰型 Gauss/Lorentz/pseudo-Voigt/Pearson VII；
   背景 none/linear/poly2/poly3/手动锚点折线（锚点固定不参与优化）。
   约束：中心∈区间、FWHM>数据步长、峰高≥0、η∈[0,1]、m∈[0.5,50]；单参数可锁。
   失败给具体原因：不收敛(迭代数+代价)/强相关(指出两峰)/欠定/点数不足/初值离谱/仪器宽化≥实测。
   取消：fit 为 async，每 5 次迭代让出并检查 cancel()；Worker 侧 terminate 兜底 ≤2s。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CatFitCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LN2 = Math.LN2, A_G = 4 * LN2;
  function gamma(z) {
    var g = 7, C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    var x = C[0];
    for (var i = 1; i < g + 2; i++) x += C[i] / (z + i);
    var t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }
  function shapeVal(shape, u, sp) {
    if (shape === 'gauss') return Math.exp(-A_G * u * u);
    if (shape === 'lorentz') return 1 / (1 + 4 * u * u);
    if (shape === 'pearson7') { var q = Math.pow(2, 1 / sp) - 1; return Math.pow(1 + 4 * u * u * q, -sp); }
    var g = Math.exp(-A_G * u * u), l = 1 / (1 + 4 * u * u);
    return sp * l + (1 - sp) * g;
  }
  /* 返回 [值, ∂/∂c, ∂/∂w, ∂/∂h, ∂/∂sp]（u=(x-c)/w） */
  function shapeDer(shape, x, c, w, h, sp) {
    var u = (x - c) / w, v, dc, dw, dh, ds;
    if (shape === 'gauss') {
      v = Math.exp(-A_G * u * u);
      dc = v * (2 * A_G * u / w); dw = v * (2 * A_G * u * u / w); dh = v; ds = 0;
    } else if (shape === 'lorentz') {
      var d = 1 + 4 * u * u; v = 1 / d;
      dc = (8 * u / w) / (d * d); dw = (8 * u * u / w) / (d * d); dh = v; ds = 0;
    } else if (shape === 'pearson7') {
      var q = Math.pow(2, 1 / sp) - 1, t = 4 * u * u * q, b = Math.pow(1 + t, -sp);
      v = b;
      var dt_dm = 4 * u * u * Math.pow(2, 1 / sp) * LN2 * (-1 / (sp * sp));
      dc = b * sp * (8 * u * q / w) / (1 + t);
      dw = b * sp * (8 * u * u * q / w) / (1 + t);
      dh = b;
      ds = -b * sp * dt_dm / (1 + t) - b * Math.log(1 + t);
    } else {
      var g = Math.exp(-A_G * u * u), l = 1 / (1 + 4 * u * u), dl = 1 + 4 * u * u;
      v = sp * l + (1 - sp) * g;
      dc = sp * (8 * u / w) / (dl * dl) + (1 - sp) * g * (2 * A_G * u / w);
      dw = sp * (8 * u * u / w) / (dl * dl) + (1 - sp) * g * (2 * A_G * u * u / w);
      dh = v;
      ds = l - g;
    }
    return [h * v, h * dc, h * dw, v, h * ds];
  }
  function peakArea(shape, h, w, sp) {
    if (shape === 'gauss') return h * w * Math.sqrt(Math.PI / A_G);
    if (shape === 'lorentz') return h * w * Math.PI / 2;
    if (shape === 'pearson7') { var q = Math.pow(2, 1 / sp) - 1; return h * w * Math.sqrt(Math.PI / q) * gamma(sp - 0.5) / gamma(sp); }
    return sp * h * w * Math.PI / 2 + (1 - sp) * h * w * Math.sqrt(Math.PI / A_G);
  }
  function bgVal(model, coeffs, t, anchors, x) {
    if (model === 'none') return 0;
    if (model === 'anchors') {
      if (!anchors || anchors.length < 2) return 0;
      if (x <= anchors[0].x) return anchors[0].y;
      for (var i = 1; i < anchors.length; i++) {
        if (x <= anchors[i].x) {
          var a = anchors[i - 1], b = anchors[i];
          return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
        }
      }
      return anchors[anchors.length - 1].y;
    }
    var v = 0;
    for (var k = 0; k < coeffs.length; k++) v += coeffs[k] * Math.pow(t, k);
    return v;
  }
  function bgNP(model) { return model === 'none' || model === 'anchors' ? 0 : model === 'linear' ? 2 : model === 'poly2' ? 3 : 4; }
  function modelY(x, st) {
    var t = (x - st.mid) / st.half;
    var y = bgVal(st.bgModel, st.bgCoeffs, t, st.anchors, x);
    for (var i = 0; i < st.peaks.length; i++) {
      var p = st.peaks[i];
      y += p.h * shapeVal(st.shape, (x - p.c) / p.w, p.sp);
    }
    return y;
  }
  function step(x) { var s = Infinity; for (var i = 1; i < x.length; i++) { var d = x[i] - x[i - 1]; if (d > 0 && d < s) s = d; } return isFinite(s) ? s : 0.02; }
  function validate(cfg, x) {
    var r = cfg.region, st = step(x);
    if (!(r.max > r.min)) return '区间逆序或为空';
    var n = 0;
    for (var i = 0; i < x.length; i++) if (x[i] >= r.min && x[i] <= r.max) n++;
    if (n < 10) return '区间内数据点不足（' + n + ' < 10）';
    if (!cfg.peaks.length) return '未设置任何峰';
    for (var j = 0; j < cfg.peaks.length; j++) {
      var p = cfg.peaks[j];
      if (!(p.c >= r.min && p.c <= r.max)) return '峰 ' + (j + 1) + ' 初值中心 ' + p.c + ' 超出区间';
      if (!(p.w > st)) return '峰 ' + (j + 1) + ' FWHM 初值须大于数据步长 ' + st.toFixed(4);
      if (!(p.h >= 0)) return '峰 ' + (j + 1) + ' 峰高初值须非负';
      if (cfg.shape === 'pseudoVoigt' && !(p.sp >= 0 && p.sp <= 1)) return '峰 ' + (j + 1) + ' η 初值须在 [0,1]';
      if (cfg.shape === 'pearson7' && !(p.sp >= 0.5 && p.sp <= 50)) return '峰 ' + (j + 1) + ' m 初值须在 [0.5,50]';
    }
    return null;
  }
  function solve(A, b, n) {
    var M = [], i, j, k;
    for (i = 0; i < n; i++) { M.push(A[i].slice()); M[i].push(b[i]); }
    for (i = 0; i < n; i++) {
      var piv = i;
      for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      if (Math.abs(M[piv][i]) < 1e-14) return null;
      var tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (k = i + 1; k < n; k++) {
        var f = M[k][i] / M[i][i];
        for (j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    var out = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (j = i + 1; j < n; j++) s -= M[i][j] * out[j];
      out[i] = s / M[i][i];
    }
    return out;
  }
  function invert(A, n) {
    var cols = [];
    for (var c = 0; c < n; c++) {
      var e = new Array(n).fill(0); e[c] = 1;
      var col = solve(A, e, n);
      if (!col) return null;
      cols.push(col);
    }
    var inv = [];
    for (var i = 0; i < n; i++) { inv.push([]); for (var j = 0; j < n; j++) inv[i].push(cols[j][i]); }
    return inv;
  }
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  async function fit(cfg, hooks) {
    hooks = hooks || {};
    var x = cfg.x, y = cfg.y, r = cfg.region;
    var err = validate(cfg, x);
    if (err) return { ok: false, reason: 'bad-init: ' + err };
    var idx = [];
    for (var i = 0; i < x.length; i++) if (x[i] >= r.min && x[i] <= r.max) idx.push(i);
    if (idx.length > 20000) {
      var keep = [], stride = idx.length / 20000;
      for (var s = 0; s < 20000; s++) keep.push(idx[Math.floor(s * stride)]);
      idx = keep;
    }
    var N = idx.length;
    var fullX = idx.map(function (i) { return x[i]; }), fullY = idx.map(function (i) { return y[i]; });
    /* 优化用分层抽样 ≤6000 点（控制 JᵀJ 规模）；质量指标与残差在全区间点上计算 */
    var optIdx = idx;
    if (idx.length > 6000) {
      optIdx = [];
      var str = idx.length / 6000;
      for (var s2 = 0; s2 < 6000; s2++) optIdx.push(idx[Math.floor(s2 * str)]);
    }
    var xs = optIdx.map(function (i) { return x[i]; }), ys = optIdx.map(function (i) { return y[i]; });
    N = xs.length;
    var st0 = step(xs);
    var mid = (r.min + r.max) / 2, half = (r.max - r.min) / 2 || 1;
    var ymax = Math.max.apply(null, ys.map(Math.abs)) || 1;
    var shape = cfg.shape || 'pseudoVoigt';
    var bgModel = (cfg.bg && cfg.bg.model) || 'none';
    var anchors = (cfg.bg && cfg.bg.anchors) || null;
    var peaks = cfg.peaks.map(function (p) {
      return { c: p.c, w: p.w, h: p.h, sp: shape === 'pseudoVoigt' ? (p.sp == null ? 0.5 : p.sp) : shape === 'pearson7' ? (p.sp == null ? 2 : p.sp) : (shape === 'lorentz' ? 1 : 0), locks: p.locks || {} };
    });
    var bgCoeffs = (cfg.bg && cfg.bg.coeffs && cfg.bg.coeffs.length === bgNP(bgModel)) ? cfg.bg.coeffs.slice() : new Array(bgNP(bgModel)).fill(0);
    if (bgModel !== 'none' && bgModel !== 'anchors' && (!cfg.bg || !cfg.bg.coeffs)) bgCoeffs[0] = ys.reduce(function (a, b) { return a + b; }, 0) / N;
    /* 自由参数打包 + 缩放 */
    var free = [], scales = [], bounds = [];
    peaks.forEach(function (p, pi) {
      [['c', 1, [r.min, r.max]], ['w', Math.max(p.w, st0 * 2), [st0 * 1.0001, half * 2]], ['h', Math.max(p.h, ymax * 0.05, 1), [0, Infinity]], ['sp', shape === 'pearson7' ? 0.5 : 0.1, shape === 'pseudoVoigt' ? [0, 1] : shape === 'pearson7' ? [0.5, 50] : [0, 1]]].forEach(function (d) {
        var key = d[0];
        if (shape !== 'pseudoVoigt' && shape !== 'pearson7' && key === 'sp') return;
        if (p.locks[key]) return;
        free.push({ kind: 'peak', pi: pi, key: key });
        scales.push(d[1]); bounds.push(d[2]);
      });
    });
    for (var k = 0; k < bgCoeffs.length; k++) { free.push({ kind: 'bg', k: k }); scales.push(ymax); bounds.push([-Infinity, Infinity]); }
    var P = free.length;
    if (P === 0) return { ok: false, reason: 'no-free-params: 所有参数均被锁定' };
    if (P > N / 3) return { ok: false, reason: 'underdetermined: 自由参数 ' + P + ' > 数据点 ' + N + ' / 3（峰数过多）' };
    function getPar(f) { return f.kind === 'bg' ? bgCoeffs[f.k] : peaks[f.pi][f.key]; }
    function setPar(f, v) { if (f.kind === 'bg') bgCoeffs[f.k] = v; else peaks[f.pi][f.key] = v; }
    var q = free.map(function (f, i) { return getPar(f) / scales[i]; });
    var colsOfPeak = peaks.map(function () { return []; });
    free.forEach(function (f, j) { if (f.kind === 'peak') colsOfPeak[f.pi].push({ key: f.key, j: j }); });
    var bgCols = [];
    free.forEach(function (f, j) { if (f.kind === 'bg') bgCols.push({ k: f.k, j: j }); });
    function state() { return { peaks: peaks, bgModel: bgModel, bgCoeffs: bgCoeffs, anchors: anchors, shape: shape, mid: mid, half: half }; }
    function evalAll(qv) {
      for (var i = 0; i < P; i++) setPar(free[i], qv[i] * scales[i]);
      var st = state(), f = new Array(N), J = [];
      for (var j = 0; j < P; j++) J.push(new Array(N).fill(0));
      var dkey = { c: 1, w: 2, h: 3, sp: 4 };
      for (var n = 0; n < N; n++) {
        var xv = xs[n], t = (xv - mid) / half;
        var mv = bgVal(bgModel, bgCoeffs, t, anchors, xv);
        for (var bc = 0; bc < bgCols.length; bc++) J[bgCols[bc].j][n] = Math.pow(t, bgCols[bc].k) * scales[bgCols[bc].j];
        for (var pi = 0; pi < peaks.length; pi++) {
          var p = peaks[pi];
          var d = shapeDer(shape, xv, p.c, p.w, p.h, p.sp);
          mv += d[0];
          var cols = colsOfPeak[pi];
          for (var c2 = 0; c2 < cols.length; c2++) J[cols[c2].j][n] = d[dkey[cols[c2].key]] * scales[cols[c2].j];
        }
        f[n] = mv;
      }
      return { f: f, J: J };
    }
    var ev = evalAll(q);
    var res = ys.map(function (v, n) { return v - ev.f[n]; });
    var cost = res.reduce(function (a, b) { return a + b * b; }, 0);
    var lambda = 1e-3, iter = 0, maxIter = cfg.maxIter || 120;
    var converged = false, singular = false, lastRel = Infinity;
    var epsFloor = 1e-16 * ymax * ymax * N; // RMS 残差 < 1e-8·ymax 视为机器精度收敛
    var cancelled = false;
    if (hooks.isCancelled) cancelled = hooks.isCancelled();
    while (iter < maxIter && !cancelled && !converged) {
      var A = [], g = new Array(P).fill(0);
      for (var a = 0; a < P; a++) { A.push(new Array(P).fill(0)); }
      for (var n2 = 0; n2 < N; n2++) {
        for (var a2 = 0; a2 < P; a2++) {
          var ja = ev.J[a2][n2];
          g[a2] += ja * res[n2];
          for (var b2 = a2; b2 < P; b2++) A[a2][b2] += ja * ev.J[b2][n2];
        }
      }
      for (var a3 = 0; a3 < P; a3++) for (var b3 = 0; b3 < a3; b3++) A[a3][b3] = A[b3][a3];
      var accepted = false, tries = 0, delta = null;
      while (!accepted && tries < 12 && !cancelled) {
        var M = A.map(function (row, i2) { return row.map(function (v, j3) { return i2 === j3 ? v + lambda * (v || 1e-9) : v; }); });
        delta = solve(M, g, P);
        if (!delta) { lambda *= 10; tries++; continue; }
        var qn = q.map(function (v, i2) {
          var nv = v + delta[i2];
          var lo = bounds[i2][0] / scales[i2], hi = bounds[i2][1] / scales[i2];
          return Math.min(hi, Math.max(lo, nv));
        });
        var evn = evalAll(qn);
        var resn = ys.map(function (v, n3) { return v - evn.f[n3]; });
        var costn = resn.reduce(function (a4, b4) { return a4 + b4 * b4; }, 0);
        if (costn <= cost) {
          var dq = Math.max.apply(null, qn.map(function (v, i2) { return Math.abs(v - q[i2]); }));
          var rel = (cost - costn) / Math.max(cost, 1e-300);
          lastRel = rel;
          q = qn; ev = evn; res = resn;
          cost = costn;
          lambda = Math.max(lambda / 3, 1e-12);
          accepted = true;
          if (rel < 1e-9 && dq < 1e-7) converged = true;
          if (cost <= epsFloor) converged = true;
        } else { lambda *= 3; tries++; }
      }
      iter++;
      await tick();
      if (hooks.isCancelled) cancelled = hooks.isCancelled();
      if (!accepted && tries >= 12) { singular = true; break; }
    }
    if (cancelled) return { ok: false, reason: 'cancelled', iterations: iter, cost: cost };
    if (!converged) {
      if (singular) return { ok: false, reason: 'ill-conditioned: 法矩阵奇异或步长连续被拒（可能存在零高/完全重叠峰），迭代 ' + iter + ' 次，代价 ' + cost.toExponential(3), iterations: iter, cost: cost };
      return { ok: false, reason: 'not-converged: 迭代 ' + iter + ' 次仍未满足双阈值（相对代价变化 ' + lastRel.toExponential(2) + '），最终代价 ' + cost.toExponential(3), iterations: iter, cost: cost };
    }
    /* 协方差 / 强相关检查 */
    var A2 = [];
    for (var a6 = 0; a6 < P; a6++) { A2.push(new Array(P).fill(0)); }
    for (var n5 = 0; n5 < N; n5++) for (var a7 = 0; a7 < P; a7++) for (var b7 = a7; b7 < P; b7++) A2[a7][b7] += ev.J[a7][n5] * ev.J[b7][n5];
    for (var a8 = 0; a8 < P; a8++) for (var b8 = 0; b8 < a8; b8++) A2[a8][b8] = A2[b8][a8];
    var chi2red = cost / Math.max(1, N - P);
    var cov = invert(A2, P);
    var se = new Array(P).fill(null), corrPair = null;
    if (cov) {
      for (var i3 = 0; i3 < P; i3++) se[i3] = Math.sqrt(Math.max(0, cov[i3][i3] * chi2red)) * scales[i3];
      for (var i4 = 0; i4 < P && !corrPair; i4++) {
        for (var j4 = i4 + 1; j4 < P; j4++) {
          var f1 = free[i4], f2 = free[j4];
          if (f1.kind !== 'peak' || f2.kind !== 'peak' || f1.pi === f2.pi) continue;
          var d1 = cov[i4][i4] * chi2red, d2 = cov[j4][j4] * chi2red;
          if (d1 <= 0 || d2 <= 0) continue;
          var corr = cov[i4][j4] * chi2red / Math.sqrt(d1 * d2);
          if (Math.abs(corr) > 0.999) { corrPair = [f1.pi + 1, f2.pi + 1, +corr.toFixed(5)]; break; }
        }
      }
    }
    if (corrPair) return { ok: false, reason: 'strong-correlation: 峰 ' + corrPair[0] + ' 与峰 ' + corrPair[1] + ' 参数强相关（r=' + corrPair[2] + '），Jacobian 病态；请减少峰数或锁定/合并初值', iterations: iter, cost: cost };
    for (var dp = 0; dp < peaks.length; dp++) {
      if (peaks[dp].h <= 1e-9 * ymax) return { ok: false, reason: 'degenerate-peaks: 峰 ' + (dp + 1) + ' 高度≈0（峰数远超实际或初值重复），请减少峰数', iterations: iter, cost: cost };
    }
    /* 全区间质量指标（全部区域点，非优化抽样子集） */
    var stF = state();
    var rwpNum = 0, rwpDen = 0, rpNum = 0, rpDen = 0;
    for (var n6 = 0; n6 < fullX.length; n6++) {
      var fv = modelY(fullX[n6], stF), dv = fullY[n6] - fv;
      rwpNum += dv * dv; rwpDen += fullY[n6] * fullY[n6];
      rpNum += Math.abs(dv); rpDen += Math.abs(fullY[n6]);
    }
    var params = peaks.map(function (p, pi) {
      var o = { c: p.c, w: p.w, h: p.h, sp: p.sp, area: peakArea(shape, p.h, p.w, p.sp), locks: p.locks };
      o.se = {};
      free.forEach(function (f, i5) { if (f.kind === 'peak' && f.pi === pi) o.se[f.key] = se[i5]; });
      return o;
    });
    var bgSe = [];
    free.forEach(function (f, i6) { if (f.kind === 'bg') bgSe[f.k] = se[i6]; });
    return {
      ok: true, algo: 'fit-1', shape: shape, bgModel: bgModel, bgCoeffs: bgCoeffs, bgSe: bgSe, anchors: anchors,
      region: r, params: params, iterations: iter, cost: cost,
      quality: { rwp: Math.sqrt(rwpNum / (rwpDen || 1)), rp: rpNum / (rpDen || 1), chi2red: cost / Math.max(1, fullX.length - P), n: fullX.length, freeParams: P },
      note: '标准误为 Jacobian 协方差线性近似；Rwp/Rp 权重均匀（w=1）。'
    };
  }
  function scherrer(o) {
    var beta = o.fwhm;
    var apparent = o.instFwhm == null;
    if (!apparent) {
      if (o.instFwhm >= o.fwhm) return { ok: false, reason: '仪器宽化 ≥ 实测 FWHM，无法扣除（检查标样或仪器值）' };
      beta = Math.sqrt(o.fwhm * o.fwhm - o.instFwhm * o.instFwhm);
    }
    var th = o.center * Math.PI / 360;
    var D = (o.K == null ? 0.89 : o.K) * o.lambda / (beta * Math.PI / 180 * Math.cos(th));
    return { ok: true, D: D, beta: beta, apparent: apparent, note: apparent ? '表观值，未扣除仪器宽化，系统性偏小' : '已扣除仪器宽化（Gauss 假设平方差）' };
  }
  function dFromT(t, lam) { var r = lam / (2 * Math.sin(t * Math.PI / 360)); return isFinite(r) && r > 0 ? r : null; }
  /* 卡片峰表对照口径：Δd 恒给（需实验波长）；Δ2θ 仅当参考与实验波长一致，否则只给 d 偏差并声明 */
  function cardDiff(o) {
    var d = o.lambda != null ? dFromT(o.center, o.lambda) : null;
    if (d == null || o.refD == null) return { ok: false, reason: '波长未设置或参考 d 缺失，无法换算偏差' };
    var out = { ok: true, deltaD: +(o.refD - d).toFixed(5), deltaT: null, note: '' };
    if (o.refT != null && o.refLambda != null && o.lambda != null && Math.abs(o.refLambda - o.lambda) < 1e-9) out.deltaT = +(o.refT - o.center).toFixed(4);
    else out.note = '参考 λ=' + o.refLambda + 'Å 与实验 λ=' + o.lambda + 'Å 不同，角度不可直接比，仅给 d 偏差';
    return out;
  }
  return {
    fit: fit, modelY: modelY, peakArea: peakArea, shapeVal: shapeVal, scherrer: scherrer, cardDiff: cardDiff, dFromT: dFromT,
    bgNP: bgNP, validate: validate, step: step, gamma: gamma,
    shapes: ['gauss', 'lorentz', 'pseudoVoigt', 'pearson7'],
    bgModels: ['none', 'linear', 'poly2', 'poly3', 'anchors']
  };
});