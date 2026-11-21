/* CatPlot 分析算法（纯函数，可在 Node 中回归测试）：
   SNIP 背景估计、手动背景点插值、Savitzky-Golay 平滑、稳健噪声估计、
   突出度寻峰、抛物线峰位细化、d 值换算、分析基准键（下游失效判定）。
   所有函数不修改输入数组。 */
(function () {
  'use strict';

  /* SNIP（Statistics-sensitive Non-linear Iterative Peak-clipping）。
     在 log(log(y+1)+1) 空间迭代取邻域均值的最小值，再反变换。
     适用：连续缓变背景 + 相对窄的衍射峰；iterations 应大于最宽峰的半宽（点数），
     过大会把宽峰也当背景削掉。负值按 0 参与估计（不修改原始数据）。 */
  function snipBackground(y, iterations) {
    var n = y.length;
    var v = new Array(n);
    for (var i = 0; i < n; i++) {
      var yi = y[i] > 0 ? y[i] : 0;
      v[i] = Math.log(Math.log(yi + 1) + 1);
    }
    var its = Math.max(1, Math.min(500, Math.floor(iterations || 24)));
    for (var p = 1; p <= its; p++) {
      for (var j = p; j < n - p; j++) {
        var avg = (v[j - p] + v[j + p]) / 2;
        if (avg < v[j]) v[j] = avg;
      }
    }
    var out = new Array(n);
    for (var k = 0; k < n; k++) out[k] = Math.exp(Math.exp(v[k]) - 1) - 1;
    return out;
  }

  /* 手动背景点：按 x 升序线性插值，范围外取端点值（水平延拓）。
     points: [{x,y}]，至少 2 个点才有意义；1 个点视为常数背景。 */
  function manualBackground(x, points) {
    var pts = (points || []).slice().sort(function (a, b) { return a.x - b.x; });
    var out = new Array(x.length);
    if (!pts.length) { for (var z = 0; z < x.length; z++) out[z] = 0; return out; }
    if (pts.length === 1) { for (var c = 0; c < x.length; c++) out[c] = pts[0].y; return out; }
    var seg = 0;
    for (var i = 0; i < x.length; i++) {
      var xi = x[i];
      if (xi <= pts[0].x) { out[i] = pts[0].y; continue; }
      if (xi >= pts[pts.length - 1].x) { out[i] = pts[pts.length - 1].y; continue; }
      while (seg < pts.length - 2 && xi > pts[seg + 1].x) seg++;
      var a = pts[seg], b = pts[seg + 1];
      var t = (xi - a.x) / (b.x - a.x);
      out[i] = a.y + (b.y - a.y) * t;
    }
    return out;
  }

  /* Savitzky-Golay 二次平滑，窗口 2m+1（奇数 3–31），边缘镜像延拓。
     仅用于寻峰前的检测副本，不改变分析数据。 */
  function sgSmooth(y, window) {
    var n = y.length;
    var w = Math.floor(window || 0);
    if (w < 3 || n < 3) return y.slice();
    if (w % 2 === 0) w += 1;
    if (w > 31) w = 31;
    var m = (w - 1) / 2;
    if (n < w) return y.slice();
    var denom = (2 * m - 1) * (2 * m + 1) * (2 * m + 3);
    var coef = new Array(w);
    for (var i = -m; i <= m; i++) coef[i + m] = 3 * (3 * m * m + 3 * m - 1 - 5 * i * i) / denom;
    var out = new Array(n);
    for (var j = 0; j < n; j++) {
      var s = 0;
      for (var k = -m; k <= m; k++) {
        var idx = j + k;
        if (idx < 0) idx = -idx;
        if (idx >= n) idx = 2 * n - 2 - idx;
        s += coef[k + m] * y[idx];
      }
      out[j] = s;
    }
    return out;
  }

  /* 稳健噪声 σ：一阶差分的中位绝对偏差 / (0.6745·√2)。
     对计数统计噪声随强度变化的谱，这是全局近似，弱峰区可能偏保守。 */
  function estimateNoise(y) {
    var n = y.length;
    if (n < 4) return 0;
    var d = new Array(n - 1);
    for (var i = 1; i < n; i++) d[i - 1] = (y[i] - y[i - 1]) / Math.SQRT2;
    d.sort(function (a, b) { return a - b; });
    var med = d[Math.floor(d.length / 2)];
    var dev = d.map(function (v) { return Math.abs(v - med); });
    dev.sort(function (a, b) { return a - b; });
    return dev[Math.floor(dev.length / 2)] / 0.6745;
  }

  /* 抛物线细化：平滑副本上峰顶三点拟合顶点偏移（|dx|<=1 点）。 */
  function refineCenter(x, ys, i) {
    if (i <= 0 || i >= x.length - 1) return x[i];
    var a = ys[i - 1], b = ys[i], c = ys[i + 1];
    var den = a - 2 * b + c;
    if (den === 0) return x[i];
    var dx = 0.5 * (a - c) / den;
    if (dx > 1) dx = 1; if (dx < -1) dx = -1;
    var step = dx >= 0 ? (x[i + 1] - x[i]) : (x[i] - x[i - 1]);
    return x[i] + dx * step;
  }

  /* 寻峰：输入为扣除已确认背景后的校正曲线（不含归一化与显示偏移）。
     opts: { smooth, noiseK, minHeight, minProm, minDist, lo, hi }
     - smooth: SG 窗口（0/1 = 不平滑）
     - noiseK: 峰高阈值 = noiseK × σ（minHeight 为绝对值时优先）
     - minProm: 最小突出度（绝对强度）；未设绝对峰高时突出度还须 ≥ noiseK×σ，
       防止宽峰肩部噪声涟漪（高度过阈但突出度极小）被误判为峰
     - minDist: 峰间最小距离（°），冲突时保留更高者
     返回峰位（细化）、峰高（校正曲线原始值）、突出度、数据索引。 */
  function findPeaks(x, y, opts) {
    opts = opts || {};
    var n = x.length;
    if (n < 3) return { peaks: [], sigma: 0 };
    var sigma = estimateNoise(y);
    var ys = sgSmooth(y, opts.smooth || 0);
    var lo = opts.lo != null ? opts.lo : -Infinity;
    var hi = opts.hi != null ? opts.hi : Infinity;
    var noiseFloor = (opts.noiseK != null ? opts.noiseK : 3) * sigma;
    var minH = opts.minHeight != null ? opts.minHeight : noiseFloor;
    var minProm = opts.minProm != null ? opts.minProm : 0;
    var promFloor = opts.minHeight != null ? 0 : noiseFloor;
    /* 数值守卫：无噪声数据 σ≈0 时，浮点涟漪（~1e-13）会形成伪局部极大。
       突出度低于信号量级 1e-9 倍的候选一律视为数值噪声。 */
    var scale = 0;
    for (var q = 0; q < n; q++) { var av = Math.abs(y[q]); if (av > scale) scale = av; }
    var eps = 1e-9 * Math.max(1, scale);
    var cands = [];
    for (var i = 1; i < n - 1; i++) {
      if (x[i] < lo || x[i] > hi) continue;
      if (!(ys[i] >= ys[i - 1] && ys[i] > ys[i + 1])) continue;
      if (ys[i] < minH) continue;
      var mL = ys[i], mR = ys[i];
      for (var l = i - 1; l >= 0; l--) { if (ys[l] > ys[i]) break; if (ys[l] < mL) mL = ys[l]; }
      for (var r = i + 1; r < n; r++) { if (ys[r] > ys[i]) break; if (ys[r] < mR) mR = ys[r]; }
      var prom = ys[i] - Math.max(mL, mR);
      if (prom < minProm || prom < promFloor || prom <= eps) continue;
      cands.push({ i: i, x: refineCenter(x, ys, i), height: y[i], prominence: prom, sm: ys[i] });
    }
    cands.sort(function (a, b) { return b.sm - a.sm; });
    var kept = [];
    var minDist = opts.minDist != null ? opts.minDist : 0;
    cands.forEach(function (c) {
      for (var j = 0; j < kept.length; j++) {
        if (Math.abs(kept[j].x - c.x) < minDist) return;
      }
      kept.push(c);
    });
    kept.sort(function (a, b) { return a.x - b.x; });
    return { peaks: kept, sigma: sigma };
  }

  /* Bragg d 值：d = λ / (2 sin θ)，输入 2θ（度）。 */
  function dSpacing(twoTheta, lambda) {
    if (!(lambda > 0) || !(twoTheta > 0) || twoTheta >= 180) return null;
    return lambda / (2 * Math.sin(twoTheta * Math.PI / 360));
  }

  /* 分析基准键：工作副本指纹 + 背景配置。寻峰结果记录此键，
     上游（工作副本/背景）变化后键不一致 → 下游结果标为待更新。 */
  function basisKey(working, bg) {
    var y = working.y, n = y.length;
    var h = 5381, sum = 0;
    var stride = Math.max(1, Math.floor(n / 512));
    for (var i = 0; i < n; i += stride) {
      var v = Math.round(y[i] * 1000);
      h = ((h << 5) + h + v) | 0;
      sum += y[i];
    }
    var b = bg && bg.applied ? (bg.mode === 'snip' ? 's' + bg.iterations : 'm' + (bg.points || []).map(function (p) { return p.x + ',' + p.y; }).join(';')) : 'n';
    return n + ':' + (h >>> 0).toString(16) + ':' + Math.round(sum * 100) + ':' + b;
  }

  /* Shirley 背景（XPS 标准）：背底正比于左侧累积峰面积（非弹性散射电子出现在更高结合能侧）。
     B(i)=y0+(yN-y0)*Q_left(i)/Q(total)，端点贴合谱两端；迭代至收敛。
     假设谱端点为纯背底；适合 XPS 单峰/窄区，宽区或多峰需谨慎。不修改输入。 */
  function shirleyBackground(y, iterations) {
    var n = y.length;
    if (n < 3) return y.slice();
    var its = Math.max(1, Math.min(200, Math.floor(iterations || 50)));
    var B = new Array(n).fill(0);
    var y0 = y[0], yN = y[n - 1];
    for (var it = 0; it < its; it++) {
      var Q = new Array(n).fill(0);
      var acc = 0;
      for (var i = 0; i < n; i++) { Q[i] = acc; var s = y[i] - B[i]; acc += s > 0 ? s : 0; }
      var Qt = acc || 1;
      var maxDiff = 0;
      for (var j = 0; j < n; j++) {
        var nb = y0 + (yN - y0) * (Q[j] / Qt);
        var d = Math.abs(nb - B[j]); if (d > maxDiff) maxDiff = d;
        B[j] = nb;
      }
      if (maxDiff < 1e-6 * (Math.abs(y0) + Math.abs(yN) + 1)) break;
    }
    return B;
  }

  window.CatAnalysis = {
    snipBackground: snipBackground, shirleyBackground: shirleyBackground, manualBackground: manualBackground,
    sgSmooth: sgSmooth, estimateNoise: estimateNoise, refineCenter: refineCenter,
    findPeaks: findPeaks, dSpacing: dSpacing, basisKey: basisKey
  };
})();