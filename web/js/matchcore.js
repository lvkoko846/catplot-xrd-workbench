/* CatPlot 粘贴峰表轻量匹配核心（pm-2-lite，UMD：浏览器/Node，零依赖）。
   公开版无数据库：用户粘贴自有参考峰表（d-I-hkl 或 2θ-I-hkl），与实验峰做证据评分匹配。
   评分口径移植自私人版 pm-2：参考峰相对强度 <1% 不参与配对；实验峰一对一占用；
   权重 匹配比例0.5/偏差0.3/强峰覆盖0.2（有扫描范围时）否则 0.625/0.375；
   可靠判定 matched≥2 且 matchFrac≥0.6 且 devScore≥0.5 且 (refCov≥0.5 或无范围)。
   得分是证据合成，不是物相存在概率。确认闭环：covered 按峰位（2θ）跨轮对齐；剩余峰续匹配。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CatMatchCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var REF_I_FLOOR = 0.01;
  function rad(d) { return d * Math.PI / 180; }
  function dToT(d, lam) { var s = lam / (2 * d); if (!(s > 0 && s < 1)) return null; return 2 * Math.asin(s) * 180 / Math.PI; }
  function tToD(t, lam) { var s = Math.sin(rad(t) / 2); return s > 0 ? lam / (2 * s) : null; }
  /* 2θ 容差 → d 容差（|dd/dt| = λ·cosθ/(4·sin²θ)） */
  function tolDFromT(t, lam, tolT) { var th = rad(t) / 2, s = Math.sin(th); if (!(s > 0)) return null; return lam * Math.cos(th) / (4 * s * s) * rad(tolT); }

  /* 解析粘贴参考峰表。格式：[# 注释] [name=..] [formula=..] [wavelength=..] [card=..] [source=..]
     数据行：d,I[,hkl] 或 2theta,I[,hkl]（mode 指定；auto 时首列 >15 视为 2θ）。
     返回 {ok, card:{name,formula,lambda,source,peaks:[{d,t,i,hkl}]}, errors:[具体行号原因]}。 */
  function parseRefTable(text, opts) {
    opts = opts || {};
    var errors = [], meta = { name: opts.name || '粘贴参考', formula: '', lambda: opts.lambda != null ? opts.lambda : null, source: opts.source || '用户粘贴', card: '' };
    var mode = opts.mode || 'auto';
    var peaks = [], lines = String(text || '').split(/\r?\n/);
    var firstVals = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      if (line[0] === '#' || line[0] === ';') {
        var kv = line.slice(1).split('=');
        if (kv.length >= 2) { var k = kv[0].trim().toLowerCase(), v = kv.slice(1).join('=').trim();
          if (k === 'name') meta.name = v; else if (k === 'formula') meta.formula = v;
          else if (k === 'wavelength' || k === 'lambda') { var lv = +v; if (lv > 0 && lv <= 10) meta.lambda = lv; else errors.push('行' + (li + 1) + ': 波长非法 ' + v); }
          else if (k === 'card') meta.card = v; else if (k === 'source') meta.source = v; }
        continue;
      }
      var parts = line.split(/[\s,;\t]+/).filter(function (p) { return p !== ''; });
      if (parts.length < 2) { errors.push('行' + (li + 1) + ': 至少需两列（位置,强度），实际 ' + parts.length + ' 列'); continue; }
      var a = +parts[0], b = +parts[1];
      if (!isFinite(a) || !isFinite(b)) { errors.push('行' + (li + 1) + ': 非数值 "' + parts[0] + ',' + parts[1] + '"'); continue; }
      if (b < 0) { errors.push('行' + (li + 1) + ': 强度为负 ' + b); continue; }
      firstVals.push(a);
      peaks.push({ a: a, i: b, hkl: parts[2] || null, line: li + 1 });
    }
    if (!peaks.length) return { ok: false, card: null, errors: errors.length ? errors : ['未解析到任何峰行'] };
    if (mode === 'auto') mode = firstVals[0] > 15 ? 't' : 'd';
    var lam = meta.lambda;
    var out = [];
    for (var pi = 0; pi < peaks.length; pi++) {
      var p = peaks[pi], d, t;
      if (mode === 'd') { d = p.a; if (!(d > 0)) { errors.push('行' + p.line + ': d 须为正 ' + p.a); continue; } t = lam != null ? dToT(d, lam) : null; }
      else { t = p.a; if (!(t > 0 && t < 180)) { errors.push('行' + p.line + ': 2θ 须在 (0,180) ' + p.a); continue; } d = lam != null ? tToD(t, lam) : null; }
      out.push({ d: d, t: t, i: p.i, hkl: p.hkl });
    }
    if (!out.length) return { ok: false, card: null, errors: errors };
    if (mode === 'd' && lam == null) errors.push('提示：d 模式未给波长，无法换算 2θ（匹配需实验波长或 2θ 模式）');
    return { ok: true, card: { name: meta.name, formula: meta.formula, lambda: lam, source: meta.source, card: meta.card, mode: mode, peaks: out }, errors: errors };
  }

  /* 实验峰表构建：从寻峰/拟合峰（2θ+强度）→ {idx,t,d,i}。lam 必需。 */
  function expFromPeaks(peaks2theta, lam) {
    var out = [];
    (peaks2theta || []).forEach(function (p, i) {
      var t = p.t != null ? p.t : p.c != null ? p.c : p.x;
      var inten = p.i != null ? p.i : p.h != null ? p.h : p.height;
      if (t == null || !isFinite(t)) return;
      out.push({ idx: i, t: t, d: tToD(t, lam), i: inten != null ? inten : 0 });
    });
    return out.filter(function (e) { return e.d != null && e.d > 0; });
  }

  /* 单参考卡评分（pm-2-lite）。exp: [{idx,t,d,i}]；ref: parseRefTable 的 card；tolT: 2θ 容差。 */
  function scoreCandidate(exp, ref, lam, tolT, scan) {
    var usable = exp.filter(function (e) { return !scan || (e.t >= scan.min && e.t <= scan.max); });
    var refP = ref.peaks.map(function (q) { return { d: q.d != null ? q.d : (lam != null ? tToD(q.t, lam) : null), t: q.t != null ? q.t : (lam != null && q.d != null ? dToT(q.d, lam) : null), i: q.i, hkl: q.hkl }; })
      .filter(function (q) { return q.d != null && q.d > 0; });
    var pool = scan ? refP.filter(function (q) { return q.t != null && q.t >= scan.min && q.t <= scan.max; }) : refP;
    var maxRefI = refP.reduce(function (m, q) { return isFinite(q.i) && q.i > m ? q.i : m; }, 0);
    var elig = pool.map(function (q) { return maxRefI > 0 && isFinite(q.i) ? q.i >= maxRefI * REF_I_FLOOR : true; });
    var strong = pool.slice().sort(function (a, b) { return (b.i || 0) - (a.i || 0); }).slice(0, 5);
    var usedRef = {}, pairs = [];
    var order = usable.slice().sort(function (a, b) { return (b.i || 0) - (a.i || 0) || a.d - b.d; });
    order.forEach(function (e) {
      var tolD = tolDFromT(e.t, lam, tolT);
      if (tolD == null) return;
      var best = -1, bestDev = Infinity;
      for (var k = 0; k < pool.length; k++) {
        if (usedRef[k] || !elig[k]) continue;
        var dev = Math.abs(pool[k].d - e.d);
        if (dev <= tolD && dev < bestDev) { bestDev = dev; best = k; }
      }
      if (best >= 0) {
        usedRef[best] = true;
        var q = pool[best];
        pairs.push({ exp: e.idx, expT: e.t, expD: e.d, expI: e.i, refD: q.d, refT: q.t, refI: q.i, hkl: q.hkl,
          deltaD: +(q.d - e.d).toFixed(5), deltaT: (q.t != null && e.t != null) ? +(q.t - e.t).toFixed(4) : null, tolD: +tolD.toFixed(5) });
      }
    });
    var matched = pairs.length;
    var matchFrac = usable.length ? matched / usable.length : 0;
    var devScore = matched ? pairs.reduce(function (s, q) { return s + (1 - Math.min(1, Math.abs(q.deltaD) / q.tolD)); }, 0) / matched : 0;
    var matchedStrong = strong.filter(function (q) { var idx = pool.indexOf(q); return usedRef[idx]; }).length;
    var refCov = scan ? (strong.length ? matchedStrong / strong.length : 1) : null;
    var w = refCov == null ? { frac: 0.625, dev: 0.375, ref: 0 } : { frac: 0.5, dev: 0.3, ref: 0.2 };
    var score = Math.round(100 * (w.frac * matchFrac + w.dev * devScore + w.ref * (refCov || 0)));
    var reliable = matched >= 2 && matchFrac >= 0.6 && devScore >= 0.5 && (refCov == null || refCov >= 0.5);
    var matchedIdx = {}; pairs.forEach(function (q) { matchedIdx[q.exp] = true; });
    var unexplained = usable.filter(function (e) { return !matchedIdx[e.idx]; });
    var missingRef = strong.filter(function (q) { return !usedRef[pool.indexOf(q)]; });
    return {
      name: ref.name, formula: ref.formula, source: ref.source, card: ref.card,
      score: score, reliable: reliable, matched: matched, usableExp: usable.length, nPeaks: refP.length,
      composition: { matchFrac: +matchFrac.toFixed(3), devScore: +devScore.toFixed(3), refCov: refCov == null ? null : +refCov.toFixed(3), weights: w },
      pairs: pairs, unexplained: unexplained, missingRef: missingRef,
      coveredT: pairs.map(function (q) { return q.expT; })
    };
  }

  /* 多参考匹配：refs 为 card 数组，返回按分排序候选。 */
  function match(exp, refs, lam, tolT, scan) {
    var cands = (refs || []).map(function (r) { return scoreCandidate(exp, r, lam, tolT, scan); });
    /* 同分按匹配比例（而非绝对峰数，避免偏向峰表更长的参考），再按绝对峰数 */
    cands.sort(function (a, b) { return b.score - a.score || b.composition.matchFrac - a.composition.matchFrac || b.matched - a.matched; });
    return { algo: 'pm-2-lite', wavelength: lam, tolerance: tolT, scan: scan || null, candidates: cands,
      scoreNote: '得分为证据合成，非存在概率；<1% 弱峰不配对，一对一占用。' };
  }

  /* 覆盖核算：跨轮按峰位（2θ，容差 tolT）对齐，而非索引。
     phases: [{coveredT:[...]}]；exp 全峰。返回 {covered:[idx], overlap:[idx], remaining:[{idx,t,d,i}]}。 */
  function coverage(exp, phases, tolT) {
    var covered = {}, overlapCount = {};
    (phases || []).forEach(function (ph) {
      (ph.coveredT || []).forEach(function (ct) {
        exp.forEach(function (e) {
          if (Math.abs(e.t - ct) <= tolT) {
            if (covered[e.idx]) overlapCount[e.idx] = (overlapCount[e.idx] || 1) + 1;
            covered[e.idx] = true;
          }
        });
      });
    });
    var coveredIdx = Object.keys(covered).map(Number);
    var overlapIdx = Object.keys(overlapCount).map(Number);
    var remaining = exp.filter(function (e) { return !covered[e.idx]; });
    return { covered: coveredIdx, overlap: overlapIdx, remaining: remaining };
  }

  return {
    parseRefTable: parseRefTable, expFromPeaks: expFromPeaks, scoreCandidate: scoreCandidate,
    match: match, coverage: coverage, dToT: dToT, tToD: tToD, tolDFromT: tolDFromT,
    REF_I_FLOOR: REF_I_FLOOR, parsePDFCard: parsePDFCard
  };

  /* 标准衍射卡片文本(PDF#)解析：头部卡号(PDF#xx-xxxx)/矿物名/化学式/波长 + 数据表(2θ d I (h k l) ...)。
     返回 {ok, card:{cardNo,name,formula,lambda,peaks[{t,d,i,hkl}]}, errors}。不做匹配分析。 */
  function parsePDFCard(text) {
    var lines = String(text || '').split(/\r?\n/);
    var cardNo = null, lambda = null, mineral = null, formula = null;
    var peaks = [], errors = [], headerDone = false;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var t = line.trim();
      if (!t) continue;
      if (!headerDone) {
        var mNo = t.match(/PDF\s*#\s*([0-9]{2}-[0-9]{4})/i);
        if (mNo && !cardNo) cardNo = mNo[1];
        var mLam = t.match(/Lambda\s*=\s*([0-9.]+)/i);
        if (mLam && !lambda) lambda = +mLam[1];
        if (/^2-Theta/i.test(t)) { headerDone = true; continue; }
        /* 矿物名/化学式：头部前几行非键值行 */
        if (!mNo && !mLam && !/[:=]/.test(t) && !/^(Ref|CELL|Strong|Cubic|Density|Calc|FIZ|ITF|See|Temperature)/i.test(t)) {
          if (!mineral) mineral = t;
          else if (!formula && /^[A-Z][A-Za-z0-9 ]*$/.test(t) && /[A-Za-z]\s*[0-9]/.test(t)) formula = t.replace(/\s+/g, '');
        }
        continue;
      }
      /* 数据行：2θ d I(f) (h k l) ... */
      var parts = t.split(/\s+/);
      if (parts.length < 3) continue;
      var tt = +parts[0], dd = +parts[1], ii = +parts[2];
      if (!isFinite(tt) || !isFinite(dd) || !isFinite(ii)) { continue; }
      if (!(tt > 0 && tt < 180) || !(dd > 0)) { errors.push('行' + (li + 1) + ': 2θ/d 越界'); continue; }
      var hklM = t.match(/\(\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*\)/);
      peaks.push({ t: tt, d: dd, i: ii, hkl: hklM ? hklM.slice(1).join(' ') : null });
    }
    if (!peaks.length) return { ok: false, card: null, errors: errors.length ? errors : ['未解析到卡片峰表（需含 2-Theta 表头与数据行）'] };
    return { ok: true, errors: errors, card: {
      cardNo: cardNo, name: mineral || (cardNo ? 'PDF#' + cardNo : 'PDF卡片'),
      formula: formula || '', lambda: lambda, peaks: peaks
    } };
  }
});
