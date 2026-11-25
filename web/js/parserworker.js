self.window = self;
importScripts('model.js', 'parser.js');

self.onmessage = function (event) {
  var message = event.data || {};
  if (!message.id) return;
  try {
    var format = !message.format || message.format === 'auto'
      ? self.CatParser.detectFormat(message.data, message.fileName)
      : message.format;
    if (format === 'xrdml' && typeof DOMParser === 'undefined') {
      self.postMessage({ id: message.id, ok: true, result: null, meta: { format: format, requiresMain: true } });
      return;
    }
    var opts = Object.assign({
      delimiter: 'auto', skipRows: 0, xCol: 0, yCol: 1,
      duplicateMode: 'keep', sortMode: 'sort'
    }, message.opts || {});
    if (format === 'table' && message.initial) {
      opts.skipRows = self.CatParser.suggestSkip(message.data, opts.delimiter, opts.xCol, opts.yCol);
    }
    var result = format === 'table'
      ? self.CatParser.analyze(message.data, opts)
      : self.CatParser.analyzeNative(message.data, format, opts);
    self.postMessage({
      id: message.id,
      ok: true,
      result: result,
      meta: { format: format, delimiter: result.delimiter, skipRows: result.skippedHeader }
    });
  } catch (error) {
    self.postMessage({ id: message.id, ok: false, error: error && error.message || String(error) });
  }
};
