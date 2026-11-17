/* CatPlot 内置示例：程序生成的模拟 XRD 数据（明确标注，非真实实验） */
(function () {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(x, mu, sigma, amp) {
    var d = (x - mu) / sigma;
    return amp * Math.exp(-0.5 * d * d);
  }

  /* 峰位参考常见锐钛矿型 TiO2 文献值，但强度、噪声、背底均为程序模拟 */
  var BASE_PEAKS = [
    [25.3, 100], [37.8, 22], [48.0, 32], [53.9, 20], [55.1, 24],
    [62.7, 16], [68.8, 9], [70.3, 11], [75.0, 12]
  ];

  function buildPattern(opts) {
    var rand = mulberry32(opts.seed);
    var x = [], y = [];
    for (var t = 10; t <= 80.0001; t += 0.05) {
      var xv = Math.round(t * 100) / 100;
      var bg = 14 + 9 * Math.exp(-Math.pow((xv - 22) / 9, 2)) + 0.015 * xv;
      var v = bg;
      BASE_PEAKS.forEach(function (p) {
        v += gauss(xv, p[0] + (opts.shift || 0), opts.sigma, p[1] * (opts.scale || 1));
      });
      if (opts.extraPeak) v += gauss(xv, opts.extraPeak[0], opts.sigma, opts.extraPeak[1]);
      v += (rand() - 0.5) * 2.4;
      x.push(xv);
      y.push(Math.round(Math.max(0, v) * 100) / 100);
    }
    return { x: x, y: y };
  }

  function makeSimSamples() {
    return [
      {
        name: '模拟 A · 锐钛矿参考',
        raw: buildPattern({ seed: 20260101, sigma: 0.13, scale: 1 }),
        note: '模拟数据：峰形与噪声由程序生成，仅用于演示'
      },
      {
        name: '模拟 B · 高温煅烧',
        raw: buildPattern({ seed: 20260102, sigma: 0.10, scale: 1.18, extraPeak: [30.2, 10] }),
        note: '模拟数据：演示峰形变锐与微量新峰'
      },
      {
        name: '模拟 C · 掺杂改性',
        raw: buildPattern({ seed: 20260103, sigma: 0.19, scale: 0.82, shift: 0.28 }),
        note: '模拟数据：演示峰位偏移与宽化'
      }
    ];
  }

  /* 生成带文件头的示例 TXT（空格分隔），用于测试导入流程 */
  function buildDemoFileText() {
    var p = buildPattern({ seed: 424242, sigma: 0.14, scale: 1 });
    var lines = [
      '# CatPlot 示例文件（模拟数据，非真实实验）',
      '# 空格分隔；第一列为 2theta (deg)，第二列为强度 (a.u.)',
      '2theta intensity'
    ];
    for (var i = 0; i < p.x.length; i += 2) {
      lines.push(p.x[i].toFixed(2) + ' ' + p.y[i].toFixed(2));
    }
    return lines.join('\n');
  }

  window.CatSamples = {
    makeSimSamples: makeSimSamples,
    buildDemoFileText: buildDemoFileText
  };
})();