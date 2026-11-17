/* 峰拟合 Worker：隔离计算，取消=置标志（每迭代检查）+ 主线程 terminate 兜底 ≤2s。 */
importScripts('fitcore.js');
var flag = false;
self.onmessage = function (e) {
  var m = e.data || {};
  if (m.cancel) { flag = true; return; }
  flag = false;
  var id = m.id;
  self.CatFitCore.fit(m.cfg, { isCancelled: function () { return flag; } }).then(function (res) {
    self.postMessage({ id: id, res: res });
  }).catch(function (err) {
    self.postMessage({ id: id, res: { ok: false, reason: 'worker-error: ' + (err && err.message || err) } });
  });
};