self.window = self;
importScripts('analysis.js', 'fitcore.js', 'batchcore.js');

var cancelled = false;
self.onmessage = function (event) {
  var message = event.data || {};
  if (message.cancel) { cancelled = true; return; }
  if (!message.id) return;
  cancelled = false;
  self.CatBatchCore.fitSample(message.sample, message.settings, {
    isCancelled: function () { return cancelled; }
  }).then(function (result) {
    self.postMessage({ id: message.id, res: result });
  }).catch(function (error) {
    self.postMessage({ id: message.id, res: { ok: false, reason: 'worker-error: ' + (error && error.message || String(error)) } });
  });
};
