/* CatPlot 数据解析：CSV/TXT、JCAMP-DX（AFFN/PAC/SQZ/DIF/DUP）与 Bruker UXD。 */
(function () {
  'use strict';

  var NUM_RE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/;
  var SQZ_POS = '@ABCDEFGHI';
  var SQZ_NEG = 'abcdefghi';
  var DIF_POS = '%JKLMNOPQR';
  var DIF_NEG = 'jklmnopqr';
  var DUP_POS = 'STUVWXYZs';

  function splitLines(text) {
    return text.split(/\r\n|\r|\n/);
  }

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

  function baseResult(extra) {
    return Object.assign({
      delimiter: 'native', totalRecords: 0, skippedHeader: 0, preview: [], maxCols: 2,
      dataRows: 0, blankRows: 0, rawPoints: [], points: [], errors: [],
      quality: { nonMonotonic: false, duplicates: [], duplicateExtra: 0 },
      merged: [], sortApplied: 'none', fatal: null, warnings: [], native: null
    }, extra || {});
  }

  function finishRecords(records, opts, extra) {
    var M = window.CatModel;
    var xCol = Math.max(0, opts.xCol || 0);
    var yCol = Math.max(0, opts.yCol || 0);
    var duplicateMode = opts.duplicateMode === 'merge' ? 'merge' : 'keep';
    var sortMode = opts.sortMode === 'keep' ? 'keep' : 'sort';
    var logical = !!(extra && extra.logicalLines);
    var result = baseResult(extra);
    result.dataRows = records.length;
    result.totalRecords = records.length + result.skippedHeader + result.blankRows;

    if (!records.length) {
      result.fatal = '文件中没有可读取的数值数据行。';
      return result;
    }
    if (xCol === yCol) {
      result.fatal = 'X 与 Y 选择了同一列（第 ' + (xCol + 1) + ' 列），请选择不同的列。';
      return result;
    }

    var logicalNo = 0;
    records.forEach(function (r) {
      logicalNo++;
      result.maxCols = Math.max(result.maxCols, r.cells.length);
      if (result.preview.length < 8) result.preview.push(r);
      var reason = r.nativeError || null;
      if (!reason && r.cells.length <= Math.max(xCol, yCol)) {
        reason = '列数不足：该行只有 ' + r.cells.length + ' 列，需要至少 ' + (Math.max(xCol, yCol) + 1) + ' 列';
      } else if (!reason && !isNumeric(r.cells[xCol])) {
        reason = r.cells[xCol] == null || r.cells[xCol].trim() === '' ? 'X 值是空值' : 'X 值 "' + r.cells[xCol] + '" 不是有效数字';
      } else if (!reason && !isNumeric(r.cells[yCol])) {
        reason = r.cells[yCol] == null || r.cells[yCol].trim() === '' ? 'Y 值是空值' : 'Y 值 "' + r.cells[yCol] + '" 不是有效数字';
      }
      if (reason) {
        result.errors.push({ lineNo: r.sourceLine || r.lineNo, reason: reason, text: r.cells.join(' | ') });
      } else {
        var p = { x: Number(r.cells[xCol]), y: Number(r.cells[yCol]), lineNo: logical ? logicalNo : r.lineNo };
        if (r.sourceLine) p.sourceLine = r.sourceLine;
        result.rawPoints.push(p);
      }
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
    if (!result.points.length) result.fatal = '所选 X / Y 列下没有任何有效数值行，无法导入。';
    return result;
  }

  function analyze(text, opts) {
    var delimiter = opts.delimiter === 'auto' ? detectDelimiter(text) : opts.delimiter;
    var skipRows = Math.max(0, Math.floor(opts.skipRows || 0));
    var all = tokenize(text, delimiter);
    var records = all.slice(skipRows);
    var nonBlank = records.filter(function (r) { return r.cells.length; });
    var result = finishRecords(nonBlank, opts, {
      delimiter: delimiter,
      skippedHeader: Math.min(skipRows, all.length),
      blankRows: records.length - nonBlank.length,
      totalRecords: all.length,
      sourceFormat: 'table'
    });
    if (!result.dataRows && !result.fatal) {
      result.fatal = skipRows > 0
        ? '跳过 ' + skipRows + ' 行文件头后没有任何数据行（文件共 ' + all.length + ' 条记录）。请减少跳过行数。'
        : '文件中没有数据行。请确认上传的是数值谱图文件。';
    } else if (result.maxCols < Math.max(opts.xCol || 0, opts.yCol || 0) + 1 && !result.fatal) {
      result.fatal = '当前分隔符下每行最多 ' + result.maxCols + ' 列，无法选择第 ' + (Math.max(opts.xCol || 0, opts.yCol || 0) + 1) + ' 列。请更换分隔符或数据列。';
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

  function detectFormat(text, fileName) {
    if (/^\s*##(?:TITLE|JCAMP-DX|XUNITS|YUNITS|XYPOINTS|XYDATA|DATA\s+TABLE|PEAK\s+TABLE)\s*=/mi.test(text)) return 'jcamp';
    if (/^\s*_2THETACOUNTS\s*$/mi.test(text)) return 'uxd';
    if (/\.(?:jdx|dx|jcamp)$/i.test(fileName || '')) return 'jcamp';
    if (/\.uxd$/i.test(fileName || '')) return 'uxd';
    return 'table';
  }

  function numValue(s) {
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  function metaNumber(meta, key) {
    var v = numValue(meta[key]);
    return v == null ? null : v;
  }

  function pseudoDigits(rest, positive, negative) {
    var out = '';
    for (var i = 0; i < rest.length; i++) {
      var c = rest.charAt(i);
      var pi = positive.indexOf(c), ni = negative.indexOf(c);
      if (c === '@' || c === '%') out += '0';
      else if (pi >= 0) out += String(pi);
      else if (ni >= 0) out += String(ni + 1);
      else out += c;
    }
    return out;
  }

  function decodePseudo(token) {
    var first = token.charAt(0), rest = token.slice(1), value;
    var pi = SQZ_POS.indexOf(first), ni = SQZ_NEG.indexOf(first);
    if (pi >= 0 || ni >= 0) {
      var digits = String(pi >= 0 ? pi : ni + 1) + pseudoDigits(rest, SQZ_POS, SQZ_NEG);
      return { type: 'sqz', value: (pi >= 0 ? 1 : -1) * Number(digits) };
    }
    pi = DIF_POS.indexOf(first); ni = DIF_NEG.indexOf(first);
    if (pi >= 0 || ni >= 0) {
      digits = String(pi >= 0 ? pi : ni + 1) + rest;
      return { type: 'dif', value: (pi >= 0 ? 1 : -1) * Number(digits) };
    }
    pi = DUP_POS.indexOf(first);
    if (pi >= 0) return { type: 'dup', value: Number(String(pi + 1) + rest) };
    return null;
  }

  function tokenizeCompressed(text, lineNo) {
    var out = [], i = 0;
    while (i < text.length) {
      var c = text.charAt(i);
      if (/[\s,;]/.test(c)) { i++; continue; }
      var m = text.slice(i).match(NUM_RE);
      if (m) {
        out.push({ type: 'num', value: Number(m[0]) });
        i += m[0].length;
        continue;
      }
      m = text.slice(i).match(/^([@A-Ia-i][0-9@A-Ia-i]*|[%J-Rj-r]\d*|[S-Zs]\d*)/);
      if (!m) throw new Error('JCAMP 第 ' + lineNo + ' 行包含无法识别的压缩字符「' + c + '」');
      var token = decodePseudo(m[1]);
      if (!token || !isFinite(token.value)) throw new Error('JCAMP 第 ' + lineNo + ' 行压缩数值无效');
      out.push(token);
      i += m[0].length;
    }
    return out;
  }

  function expandDuplicates(tokens, lineNo) {
    var out = [];
    tokens.forEach(function (t) {
      if (t.type !== 'dup') { out.push(t); return; }
      if (!out.length) throw new Error('JCAMP 第 ' + lineNo + ' 行的 DUP 前没有可重复数值');
      if (t.value < 1 || t.value > 1000000 || Math.floor(t.value) !== t.value) throw new Error('JCAMP 第 ' + lineNo + ' 行 DUP 次数无效');
      for (var k = 1; k < t.value; k++) out.push({ type: out[out.length - 1].type, value: out[out.length - 1].value });
    });
    return out;
  }

  function decodeYLine(text, lineNo) {
    var tokens = expandDuplicates(tokenizeCompressed(text, lineNo), lineNo);
    if (!tokens.length) throw new Error('JCAMP 第 ' + lineNo + ' 行没有 Y 数据');
    var values = [], previous = null, hasDif = false;
    tokens.forEach(function (t) {
      if (t.type === 'dif') {
        if (previous == null) throw new Error('JCAMP 第 ' + lineNo + ' 行首个 Y 值不能是 DIF 差分');
        previous += t.value;
        hasDif = true;
      } else previous = t.value;
      if (!isFinite(previous)) throw new Error('JCAMP 第 ' + lineNo + ' 行解码后出现非有限数值');
      values.push(previous);
    });
    return { values: values, hasDif: hasDif, lastType: tokens[tokens.length - 1].type };
  }

  function pairRecords(text, startLine, xFactor, yFactor) {
    var records = [], lines = splitLines(text);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].split('$$')[0].trim();
      if (!line || /^##/.test(line)) continue;
      var tokens = line.match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/g) || [];
      if (!tokens.length) continue;
      if (tokens.length % 2) {
        records.push({ cells: tokens, lineNo: records.length + 1, sourceLine: startLine + i, nativeError: 'XY 点数不成对：该行有 ' + tokens.length + ' 个数值' });
      } else {
        for (var j = 0; j < tokens.length; j += 2) {
          records.push({ cells: [String(Number(tokens[j]) * xFactor), String(Number(tokens[j + 1]) * yFactor)], lineNo: records.length + 1, sourceLine: startLine + i });
        }
      }
    }
    return records;
  }

  function parseJCAMP(text) {
    if ((text.match(/^##TITLE\s*=/gmi) || []).length > 1) throw new Error('检测到多区 JCAMP-DX；当前一次导入一个谱图块，请先拆分文件');
    var lines = splitLines(text), meta = {}, guide = '', start = -1, ended = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i], trim = raw.trim();
      var m = trim.match(/^##([^=]+)=(.*)$/);
      if (m) {
        var key = m[1].trim().toUpperCase(), value = m[2].trim();
        if (start < 0 && /^(XYDATA|DATA TABLE|PEAK TABLE|XYPOINTS)$/.test(key)) {
          guide = key + '=' + value;
          meta.dataGuide = guide;
          start = i + 1;
          continue;
        }
        if (start >= 0) { ended = true; break; }
        meta[key] = value;
      }
    }
    if (start < 0) throw new Error('未找到 JCAMP-DX 数据区（XYDATA / XYPOINTS / PEAK TABLE / DATA TABLE）');
    var dataText = lines.slice(start, ended ? i : lines.length).join('\n');
    var warnings = [], records, derivedStep = null;
    var expected = metaNumber(meta, 'NPOINTS'), firstX = metaNumber(meta, 'FIRSTX'), lastX = metaNumber(meta, 'LASTX');
    var xFactor = metaNumber(meta, 'XFACTOR'), yFactor = metaNumber(meta, 'YFACTOR');
    if (xFactor == null) xFactor = 1;
    if (yFactor == null) yFactor = 1;
    if (!isFinite(xFactor) || xFactor === 0) throw new Error('JCAMP XFACTOR 必须是非零有限数值');
    if (!isFinite(yFactor) || yFactor === 0) throw new Error('JCAMP YFACTOR 必须是非零有限数值');
    if (/^(XYPOINTS|PEAK TABLE)/.test(guide) || /\((?:XI|XY)\.\./.test(guide)) {
      records = pairRecords(dataText, start + 1, xFactor, yFactor);
    } else {
      var dataLines = splitLines(dataText), decoded = [], delta = metaNumber(meta, 'DELTAX');
      var canRebuildX = expected != null && expected > 1 && firstX != null && lastX != null;
      for (var li = 0; li < dataLines.length; li++) {
        var line = dataLines[li].split('$$')[0].trim();
        if (!line || /^##/.test(line)) continue;
        var xm = line.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)(.*)$/);
        if (!xm || xm[2].trim() === '') throw new Error('JCAMP 第 ' + (start + li + 1) + ' 行应为「X 值 + Y 序列」');
        var x = Number(xm[1]) * xFactor, y = decodeYLine(xm[2], start + li + 1);
        if (!isFinite(x)) throw new Error('JCAMP 第 ' + (start + li + 1) + ' 行 X 值无效');
        decoded.push({ x: x, values: y.values, hasDif: y.hasDif, lastType: y.lastType, sourceLine: start + li + 1 });
      }
      if (!decoded.length) throw new Error('JCAMP-DX 数据区为空');
      var expected = metaNumber(meta, 'NPOINTS'), mode = 'none';
      if (decoded.some(function (d) { return d.hasDif; })) {
        var modes = ['literal', 'relayed', 'none'];
        function countFor(mm) {
          return decoded.reduce(function (sum, d, di) {
            var drop = di < decoded.length - 1 && (mm === 'relayed' ? d.hasDif : (mm === 'literal' && d.lastType === 'dif'));
            return sum + d.values.length - (drop ? 1 : 0);
          }, 0);
        }
        if (expected != null) {
          var matches = modes.filter(function (mm) { return countFor(mm) === expected; });
          if (matches.length) mode = matches[0];
          else warnings.push('NPOINTS=' + expected + ' 与解码点数不一致，已按常见 DIF 行尾校验规则导入');
        } else mode = decoded[0].lastType === 'dif' ? 'literal' : 'relayed';
        if (mode !== 'none' && decoded.length > 1) warnings.push('DIF 行尾校验值：' + (mode === 'literal' ? '末项为差分时' : '该行含差分时') + '丢弃校验点');
      }
      records = [];
      decoded.forEach(function (d, di) {
        var drop = di < decoded.length - 1 && (mode === 'relayed' ? d.hasDif : (mode === 'literal' && d.lastType === 'dif'));
        var vals = drop ? d.values.slice(0, -1) : d.values;
        if (drop && di + 1 < decoded.length) {
          var a = d.values[d.values.length - 1], b = decoded[di + 1].values[0];
          if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) warnings.push('第 ' + d.sourceLine + ' 行 DIF 校验值 ' + a + ' 与下一行首值 ' + b + ' 不一致');
        }
        if (vals.length > 1 && delta == null && !canRebuildX) throw new Error('JCAMP X++(Y..Y) 数据缺少 DELTAX，无法重建每点 X 坐标');
        vals.forEach(function (v, j) {
          var x = j === 0 ? d.x : d.x + j * delta;
          records.push({ cells: [String(x), String(v * yFactor)], lineNo: records.length + 1, sourceLine: d.sourceLine });
        });
      });
      if (canRebuildX && records.length === expected) {
        derivedStep = (lastX - firstX) / (expected - 1);
        records.forEach(function (record, i) { record.cells[0] = String(firstX + i * derivedStep); });
        if (delta != null && Math.abs(delta - derivedStep) > Math.max(metaTolerance(meta.DELTAX), 1e-10 * Math.max(1, Math.abs(delta), Math.abs(derivedStep)))) {
          warnings.push('DELTAX=' + delta + ' 与 FIRSTX/LASTX/NPOINTS 重建步长 ' + derivedStep + ' 不一致，已按首末点重建 X');
        }
      }
      if (expected != null && records.length !== expected) warnings.push('声明 NPOINTS=' + expected + '，实际导入 ' + records.length + ' 点');
    }
    function metaTolerance(raw) {
      var parts = String(raw).trim().toUpperCase().split('E');
      var mantissa = parts[0], dot = mantissa.indexOf('.');
      var decimals = dot >= 0 ? mantissa.length - dot - 1 : 0;
      return 0.5 * Math.pow(10, Number(parts[1] || 0) - decimals);
    }
    function checkMeta(label, declared, actual) {
      if (declared == null || actual == null) return;
      var tolerance = Math.max(metaTolerance(meta[label]), 1e-10 * Math.max(1, Math.abs(declared), Math.abs(actual)));
      if (Math.abs(declared - actual) > tolerance) warnings.push(label + '=' + declared + ' 与实际首末/极值 ' + actual + ' 不一致');
    }
    if (records.length) {
      var actualFirstX = Number(records[0].cells[0]), actualLastX = Number(records[records.length - 1].cells[0]);
      var actualFirstY = Number(records[0].cells[1]) / yFactor;
      checkMeta('FIRSTX', metaNumber(meta, 'FIRSTX'), actualFirstX);
      checkMeta('LASTX', metaNumber(meta, 'LASTX'), actualLastX);
      var declaredFirstY = metaNumber(meta, 'FIRSTY');
      if (declaredFirstY != null) {
        var scaledFirstY = actualFirstY * yFactor;
        var tolY = Math.max(metaTolerance(meta.FIRSTY), 1e-10 * Math.max(1, Math.abs(declaredFirstY)));
        if (Math.abs(scaledFirstY - declaredFirstY) > tolY && Math.abs(actualFirstY - declaredFirstY) > tolY) {
          warnings.push('FIRSTY=' + declaredFirstY + ' 与解码首值（原始 ' + actualFirstY + '，缩放后 ' + scaledFirstY + '）不一致');
        }
      }
      var ys = records.map(function (r) { return Number(r.cells[1]); });
      checkMeta('MAXY', metaNumber(meta, 'MAXY'), window.CatModel.maxOf(ys));
      checkMeta('MINY', metaNumber(meta, 'MINY'), window.CatModel.minOf(ys));
    }
    var native = {
      format: 'jcamp', title: meta.TITLE || '', xUnits: meta.XUNITS || '', yUnits: meta.YUNITS || '',
      dataGuide: guide, compression: meta['DATA CLASS'] || guide.split('=')[1] || '',
      firstX: metaNumber(meta, 'FIRSTX'), lastX: metaNumber(meta, 'LASTX'), deltaX: metaNumber(meta, 'DELTAX'), xStep: derivedStep,
      firstY: metaNumber(meta, 'FIRSTY'), minY: metaNumber(meta, 'MINY'), maxY: metaNumber(meta, 'MAXY'),
      xFactor: xFactor, yFactor: yFactor, nPoints: metaNumber(meta, 'NPOINTS'), owner: meta.OWNER || '', vendor: meta.$VENDOR || meta.VENDOR || ''
    };
    return { records: records, native: native, warnings: warnings };
  }

  function parseUXD(text) {
    var lines = splitLines(text), meta = {}, start = -1;
    for (var i = 0; i < lines.length; i++) {
      var trim = lines[i].trim();
      if (/^_2THETACOUNTS$/i.test(trim)) { start = i + 1; break; }
      var m = trim.match(/^_([A-Z0-9_]+)=(.*)$/i);
      if (m) meta[m[1].toUpperCase()] = m[2].replace(/^'|'$/g, '');
    }
    if (start < 0) throw new Error('UXD 中未找到 _2THETACOUNTS 数据段');
    var records = [];
    for (var j = start; j < lines.length; j++) {
      var line = lines[j].trim();
      if (!line || line.charAt(0) === ';') continue;
      var cells = line.split(/\s+/);
      if (cells.length < 2) {
        records.push({ cells: cells, lineNo: records.length + 1, sourceLine: j + 1, nativeError: 'UXD 数据行应包含 2θ 与计数两列' });
      } else records.push({ cells: cells.slice(0, 2), lineNo: records.length + 1, sourceLine: j + 1 });
    }
    return {
      records: records,
      native: {
        format: 'uxd', sample: meta.SAMPLE || '', anode: meta.ANODE || '', wavelength: metaNumber(meta, 'WL1'),
        wavelength2: metaNumber(meta, 'WL2'), dateMeasured: meta.DATEMEASURED || '', user: meta.USER || '',
        stepSize: metaNumber(meta, 'STEPSIZE'), stepTime: metaNumber(meta, 'STEPTIME'),
        voltage: metaNumber(meta, 'KV'), current: metaNumber(meta, 'MA'), drive: meta.DRIVE || '',
        divergenceSlit: metaNumber(meta, 'FIXED_DIVSLIT'), antiScatterSlit: metaNumber(meta, 'FIXED_ANTISLIT')
      },
      warnings: []
    };
  }

  function analyzeNative(text, format, opts) {
    var parsed;
    try {
      parsed = format === 'jcamp' ? parseJCAMP(text) : parseUXD(text);
    } catch (e) {
      var failed = baseResult({ sourceFormat: format, fatal: e.message });
      return failed;
    }
    var result = finishRecords(parsed.records, Object.assign({}, opts, { xCol: 0, yCol: 1 }), {
      sourceFormat: format, logicalLines: true, native: parsed.native, warnings: parsed.warnings
    });
    return result;
  }

  window.CatParser = {
    detectDelimiter: detectDelimiter,
    tokenize: tokenize,
    analyze: analyze,
    suggestSkip: suggestSkip,
    isNumeric: isNumeric,
    detectFormat: detectFormat,
    analyzeNative: analyzeNative
  };
})();
