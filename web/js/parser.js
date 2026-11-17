/* CatPlot 数据解析：引号感知 CSV 状态机、行号追溯、数据检查与显式处理选项 */
(function () {
  'use strict';

  function splitLines(text) {
    return text.split(/\r\n|\r|\n/);
  }

  /* 记录级 tokenizer：支持引号字段、引号内分隔符、"" 转义、引号内换行。
     每条记录携带起始物理行号。空白分隔符退化为按行 split。 */
  function tokenize(text, delimiter) {
    var records = [];
    if (delimiter === 'ws') {
      var lines = splitLines(text);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        records.push({ cells: t === '' ? [] : t.split(/\s+/), lineNo: i + 1 });
      }
      return records;
    }
    var cell = '', cells = [], inQ = false, line = 1, recStart = 1;
    function endCell() { cells.push(cell); cell = ''; }
    function endRecord() {
      endCell();
      if (cells.length === 1 && cells[0] === '') cells = [];
      records.push({ cells: cells, lineNo: recStart });
      cells = [];
    }
    for (var k = 0; k < text.length; k++) {
      var c = text[k];
      if (inQ) {
        if (c === '"') {
          if (text[k + 1] === '"') { cell += '"'; k++; }
          else inQ = false;
        } else {
          cell += c;
          if (c === '\n') line++;
        }
        continue;
      }
      if (c === '"' && cell === '') { inQ = true; continue; }
      if (c === delimiter) { endCell(); continue; }
      if (c === '\n') { endRecord(); line++; recStart = line; continue; }
      if (c === '\r') continue;
      cell += c;
    }
    if (cell !== '' || cells.length) endRecord();
    return records;
  }

  function detectDelimiter(text) {
    var lines = splitLines(text).filter(function (l) { return l.trim() !== ''; }).slice(0, 12);
    if (!lines.length) return ',';
    var candidates = [',', '\t', ';'];
    var best = null, bestScore = 0;
    candidates.forEach(function (d) {
      var counts = lines.map(function (l) { return l.split(d).length - 1; });
      var positive = counts.filter(function (c) { return c > 0; });
      if (!positive.length) return;
      var min = positive[0];
      for (var i = 1; i < positive.length; i++) if (positive[i] < min) min = positive[i];
      var consistent = positive.filter(function (c) { return c === min; }).length;
      var score = (consistent / lines.length) * min;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    if (best) return best;
    var wsMin = Infinity;
    lines.forEach(function (l) {
      var n = l.trim().split(/\s+/).length;
      if (n < wsMin) wsMin = n;
    });
    if (wsMin >= 2) return 'ws';
    return ',';
  }

  function isNumeric(s) {
    if (s === undefined || s === null || String(s).trim() === '') return false;
    return isFinite(Number(s));
  }

  /* opts: delimiter, skipRows, xCol, yCol, duplicateMode('keep'|'merge'), sortMode('sort'|'keep') */
  function analyze(text, opts) {
    var M = window.CatModel;
    var delimiter = opts.delimiter === 'auto' ? detectDelimiter(text) : opts.delimiter;
    var skipRows = Math.max(0, Math.floor(opts.skipRows || 0));
    var xCol = Math.max(0, opts.xCol || 0);
    var yCol = Math.max(0, opts.yCol || 0);
    var duplicateMode = opts.duplicateMode === 'merge' ? 'merge' : 'keep';
    var sortMode = opts.sortMode === 'keep' ? 'keep' : 'sort';
    var all = tokenize(text, delimiter);
    var result = {
      delimiter: delimiter,
      totalRecords: all.length,
      skippedHeader: Math.min(skipRows, all.length),
      preview: [],
      maxCols: 0,
      dataRows: 0,
      blankRows: 0,
      rawPoints: [],
      points: [],
      errors: [],
      quality: { nonMonotonic: false, duplicates: [], duplicateExtra: 0 },
      merged: [],
      sortApplied: 'none',
      fatal: null
    };

    var records = all.slice(skipRows);
    records.forEach(function (r) {
      if (!r.cells.length) { result.blankRows++; return; }
      result.dataRows++;
      if (r.cells.length > result.maxCols) result.maxCols = r.cells.length;
      if (result.preview.length < 8) result.preview.push(r);
    });

    if (!result.dataRows) {
      result.fatal = skipRows > 0
        ? '跳过 ' + skipRows + ' 行文件头后没有任何数据行（文件共 ' + all.length + ' 条记录）。请减少跳过行数。'
        : '文件中没有数据行。请确认上传的是 XRD 数值数据文件（CSV / TXT）。';
      return result;
    }
    if (xCol === yCol) {
      result.fatal = 'X 与 Y 选择了同一列（第 ' + (xCol + 1) + ' 列）。请用同一列作 X 和 Y 无意义，请选择不同的列。';
      return result;
    }
    if (result.maxCols < Math.max(xCol, yCol) + 1) {
      result.fatal = '当前分隔符下每行最多 ' + result.maxCols + ' 列，无法选择第 ' + (Math.max(xCol, yCol) + 1) + ' 列。请更换分隔符或数据列。';
      return result;
    }

    records.forEach(function (r) {
      if (!r.cells.length) return;
      var xc = r.cells[xCol], yc = r.cells[yCol];
      var reason = null;
      if (r.cells.length <= Math.max(xCol, yCol)) {
        reason = '列数不足：该行只有 ' + r.cells.length + ' 列，需要至少 ' + (Math.max(xCol, yCol) + 1) + ' 列';
      } else if (!isNumeric(xc)) {
        reason = 'X 值 "' + (xc === undefined ? '' : xc) + '" 不是有效数字' + (xc === '' ? '（空值）' : '');
      } else if (!isNumeric(yc)) {
        reason = 'Y 值 "' + (yc === undefined ? '' : yc) + '" 不是有效数字' + (yc === '' ? '（空值）' : '');
      }
      if (reason) result.errors.push({ lineNo: r.lineNo, reason: reason, text: r.cells.join(' | ') });
      else result.rawPoints.push({ x: Number(xc), y: Number(yc), lineNo: r.lineNo });
    });

    result.quality = M.detectQuality(result.rawPoints);

    var working = result.rawPoints.slice();
    if (duplicateMode === 'merge' && result.quality.duplicateExtra > 0) {
      var mg = M.mergeDuplicates(working);
      working = mg.points;
      result.merged = mg.merged;
    }
    if (sortMode === 'sort' && result.quality.nonMonotonic) {
      working = M.sortPoints(working);
      result.sortApplied = 'asc';
    }
    result.points = working;

    if (!result.points.length && !result.fatal) {
      result.fatal = '所选 X / Y 列下没有任何有效数值行，无法导入。请检查分隔符、跳过行数与列选择。';
    }
    return result;
  }

  function suggestSkip(text, delimiter, xCol, yCol) {
    var d = delimiter === 'auto' ? detectDelimiter(text) : delimiter;
    var records = tokenize(text, d);
    var skip = 0;
    for (var i = 0; i < Math.min(records.length, 10); i++) {
      var cells = records[i].cells;
      if (!cells.length) { skip++; continue; }
      if (!isNumeric(cells[xCol]) || !isNumeric(cells[yCol])) skip++;
      else break;
    }
    return skip;
  }

  window.CatParser = {
    detectDelimiter: detectDelimiter,
    tokenize: tokenize,
    analyze: analyze,
    suggestSkip: suggestSkip,
    isNumeric: isNumeric
  };
})();