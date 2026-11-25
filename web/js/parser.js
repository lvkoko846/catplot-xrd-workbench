/* CatPlot 数据解析：表格、JCAMP-DX、Bruker UXD、PANalytical XRDML、Rigaku RAS 与 OMNIC SPA。 */
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

  var NATIVE_NAMES = {
    jcamp: 'JCAMP-DX', uxd: 'Bruker UXD', xrdml: 'PANalytical XRDML',
    ras: 'Rigaku RAS', spa: 'OMNIC/OPUS SPA'
  };
  var SPA_SIGNATURE = 'Spectral Data File';

  function formatName(format) {
    return NATIVE_NAMES[format] || format || '未知格式';
  }

  function isNativeFormat(format) {
    return Object.prototype.hasOwnProperty.call(NATIVE_NAMES, format);
  }

  function isArrayBuffer(data) {
    return data instanceof ArrayBuffer || Object.prototype.toString.call(data) === '[object ArrayBuffer]';
  }

  function asBytes(data) {
    if (isArrayBuffer(data)) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error('SPA 解析需要 ArrayBuffer、Uint8Array 或 Buffer');
  }

  function hasSPASignature(bytes) {
    if (bytes.length < SPA_SIGNATURE.length) return false;
    for (var i = 0; i < SPA_SIGNATURE.length; i++) if (bytes[i] !== SPA_SIGNATURE.charCodeAt(i)) return false;
    return true;
  }

  function detectFormat(data, fileName) {
    var binary = isArrayBuffer(data) || ArrayBuffer.isView(data);
    var bytes = null;
    if (binary) {
      bytes = asBytes(data);
      if (hasSPASignature(bytes)) return 'spa';
    }
    var text = binary ? '' : String(data || '');
    if (!binary && /<(?:[A-Za-z_][\w.-]*:)?xrdMeasurements?\b/i.test(text)) return 'xrdml';
    if (!binary && /^\s*\*RAS_DATA_START\s*$/mi.test(text)) return 'ras';
    if (!binary && /^\s*##(?:TITLE|JCAMP-DX|XUNITS|YUNITS|XYPOINTS|XYDATA|DATA\s+TABLE|PEAK\s+TABLE)\s*=/mi.test(text)) return 'jcamp';
    if (!binary && /^\s*_2THETACOUNTS\s*$/mi.test(text)) return 'uxd';
    if (/\.spa$/i.test(fileName || '')) return 'spa';
    if (/\.(?:jdx|dx|jcamp)$/i.test(fileName || '')) return 'jcamp';
    if (/\.uxd$/i.test(fileName || '')) return 'uxd';
    if (/\.xrdml$/i.test(fileName || '')) return 'xrdml';
    if (/\.ras$/i.test(fileName || '')) return 'ras';
    return 'table';
  }

  function numValue(s) {
    if (s == null || String(s).trim() === '') return null;
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

  function xmlLocalName(node) {
    return String(node.localName || node.nodeName || '').replace(/^.*:/, '');
  }

  function xmlChildren(node, name) {
    return Array.prototype.slice.call(node.children || []).filter(function (child) { return xmlLocalName(child) === name; });
  }

  function xmlChild(node, name) {
    return xmlChildren(node, name)[0] || null;
  }

  function xmlDescendant(node, path) {
    var current = node;
    for (var i = 0; current && i < path.length; i++) current = xmlChild(current, path[i]);
    return current;
  }

  function xmlValue(node, path) {
    var found = xmlDescendant(node, path);
    return found ? String(found.textContent || '').trim() : '';
  }

  function xmlNumber(node, path) {
    return numValue(xmlValue(node, path));
  }

  function xmlNumericList(node, label) {
    var text = String(node.textContent || '').trim();
    if (!text) throw new Error(label + ' 为空');
    var tokens = text.split(/[\s,]+/), values = [];
    for (var i = 0; i < tokens.length; i++) {
      var value = numValue(tokens[i]);
      if (value == null) throw new Error(label + ' 第 ' + (i + 1) + ' 个值「' + tokens[i] + '」不是有限数字');
      values.push(value);
    }
    return values;
  }

  function axisKey(axis) {
    var key = String(axis || '').toLowerCase().replace(/θ/g, 'theta').replace(/[\s_-]/g, '');
    return key === 'twotheta' ? '2theta' : key;
  }

  function parseXRDML(text) {
    if (typeof text !== 'string') throw new Error('XRDML 解析需要 XML 文本');
    if (typeof DOMParser === 'undefined') throw new Error('当前环境不提供浏览器 DOMParser，无法解析 XRDML');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XRDML 含 DOCTYPE/ENTITY，已阻止解析');
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var parserErrors = doc.getElementsByTagName('parsererror');
    if (parserErrors.length) throw new Error('XRDML XML 语法损坏，无法导入');
    var root = doc.documentElement, rootName = root && xmlLocalName(root);
    if (!root || (rootName !== 'xrdMeasurements' && rootName !== 'xrdMeasurement')) throw new Error('XRDML 根元素无效，应为 xrdMeasurements 或 xrdMeasurement');

    var measurements = rootName === 'xrdMeasurement' ? [root] : xmlChildren(root, 'xrdMeasurement');
    var scans = [];
    measurements.forEach(function (measurement, index) {
      var scan = xmlChild(measurement, 'scan'), dataPoints = scan && xmlChild(scan, 'dataPoints');
      if (scan && dataPoints) scans.push({ measurement: measurement, scan: scan, dataPoints: dataPoints, index: index + 1 });
    });
    if (!scans.length) throw new Error('XRDML 中未找到含 dataPoints 的扫描');
    var selected = scans[0], scan = selected.scan, dataPoints = selected.dataPoints;
    var warnings = [];
    if (scans.length > 1) warnings.push('XRDML 含 ' + scans.length + ' 个数据扫描，本次仅导入第 ' + selected.index + ' 个扫描');

    var intensityNode = xmlChild(dataPoints, 'intensities');
    var countsNode = xmlChild(dataPoints, 'counts');
    var attenuationNode = xmlChild(dataPoints, 'beamAttenuationFactors');
    var yNode, yValues, intensityMode, yUnits;
    if (intensityNode) {
      yNode = xmlChild(intensityNode, 'listIntensities') || xmlChild(intensityNode, 'counts') || intensityNode;
      yValues = xmlNumericList(yNode, 'XRDML 强度');
      intensityMode = 'intensities';
      yUnits = intensityNode.getAttribute('unit') || yNode.getAttribute('unit') || '';
      if (countsNode) warnings.push('XRDML 同时提供 intensities 与 counts，已优先采用 intensities');
    } else if (countsNode) {
      yValues = xmlNumericList(countsNode, 'XRDML counts');
      intensityMode = 'counts × beamAttenuationFactors';
      yUnits = countsNode.getAttribute('unit') || '';
      if (attenuationNode) {
        var factors = xmlNumericList(attenuationNode, 'XRDML 束衰减因子');
        if (factors.length !== yValues.length) throw new Error('XRDML 束衰减因子与 counts 长度不一致：' + factors.length + ' / ' + yValues.length);
        for (var fi = 0; fi < factors.length; fi++) {
          if (factors[fi] <= 0) throw new Error('XRDML 第 ' + (fi + 1) + ' 个束衰减因子必须为正数');
          yValues[fi] *= factors[fi];
          if (!isFinite(yValues[fi])) throw new Error('XRDML 衰减校正后出现非有限强度');
        }
      }
    } else throw new Error('XRDML dataPoints 缺少 intensities 或 counts');
    if (yValues.length > 5000000) throw new Error('XRDML 单谱超过 5,000,000 点上限');

    function positionKind(node) {
      var list = xmlChild(node, 'listPositions'), start = xmlChild(node, 'startPosition');
      var end = xmlChild(node, 'endPosition'), common = xmlChild(node, 'commonPosition');
      var representations = (list ? 1 : 0) + (common ? 1 : 0) + ((start || end) ? 1 : 0);
      if (representations !== 1 || !!(start && !end) || !!(end && !start)) {
        throw new Error('XRDML positions axis="' + node.getAttribute('axis') + '" 的位置表示不明确');
      }
      return list ? 'list' : common ? 'common' : 'range';
    }
    var positionNodes = xmlChildren(dataPoints, 'positions'), varying = [], commonPositions = [];
    positionNodes.forEach(function (node) {
      var kind = positionKind(node), info = { node: node, kind: kind, axis: node.getAttribute('axis') || '', unit: node.getAttribute('unit') || '' };
      if (kind === 'common') {
        info.value = numValue(String(node.textContent || '').trim());
        commonPositions.push({ axis: info.axis, unit: info.unit, value: info.value });
      } else varying.push(info);
    });
    if (!varying.length) throw new Error('XRDML 没有可绘制的变化轴，只有 commonPosition');
    var chosen = null;
    if (varying.length === 1) chosen = varying[0];
    else {
      var scanAxis = String(scan.getAttribute('scanAxis') || '');
      var expectedAxis = axisKey(scanAxis.split(/[-+]/)[0]);
      var matches = varying.filter(function (item) { return expectedAxis && axisKey(item.axis) === expectedAxis; });
      if (matches.length === 1) chosen = matches[0];
      else throw new Error('XRDML 含多个变化轴且无法按 scanAxis="' + scanAxis + '" 唯一选择，请拆分扫描');
    }
    var xValues;
    if (chosen.kind === 'list') xValues = xmlNumericList(xmlChild(chosen.node, 'listPositions'), 'XRDML 轴位置');
    else {
      var start = xmlNumericList(xmlChild(chosen.node, 'startPosition'), 'XRDML 起始位置')[0];
      var end = xmlNumericList(xmlChild(chosen.node, 'endPosition'), 'XRDML 终止位置')[0];
      if (yValues.length === 1 && Math.abs(start - end) > 1e-12 * Math.max(1, Math.abs(start), Math.abs(end))) throw new Error('XRDML 单点扫描的起止位置不一致');
      xValues = [];
      for (var xi = 0; xi < yValues.length; xi++) xValues.push(yValues.length === 1 ? start : start + (end - start) * xi / (yValues.length - 1));
    }
    if (xValues.length !== yValues.length) throw new Error('XRDML 轴位置与强度长度不一致：' + xValues.length + ' / ' + yValues.length);

    var records = [];
    for (var i = 0; i < xValues.length; i++) {
      if (!isFinite(xValues[i])) throw new Error('XRDML 重建 X 后出现非有限坐标');
      records.push({ cells: [String(xValues[i]), String(yValues[i])], lineNo: i + 1 });
    }
    var sample = xmlChild(selected.measurement, 'sample') || (selected.index === 1 ? xmlChild(root, 'sample') : null);
    var tube = xmlDescendant(selected.measurement, ['incidentBeamPath', 'xRayTube']);
    var wavelengthNode = xmlChild(selected.measurement, 'usedWavelength');
    var native = {
      format: 'xrdml', trace: 'record', namespace: root.namespaceURI || '',
      sampleId: sample ? xmlValue(sample, ['id']) : '', sample: sample ? xmlValue(sample, ['name']) || xmlValue(sample, ['id']) : '',
      xUnits: chosen.unit, yUnits: yUnits, scanAxis: scan.getAttribute('scanAxis') || chosen.axis,
      selectedAxis: chosen.axis, scanMode: scan.getAttribute('mode') || '', measurementType: selected.measurement.getAttribute('measurementType') || '',
      scanStatus: scan.getAttribute('status') || '', appendNumber: scan.getAttribute('appendNumber') || '',
      scanCount: scans.length, selectedScan: selected.index, nPoints: records.length,
      firstX: xValues[0], lastX: xValues[xValues.length - 1], xStep: xValues.length > 1 ? (xValues[xValues.length - 1] - xValues[0]) / (xValues.length - 1) : 0,
      anode: tube ? xmlValue(tube, ['anodeMaterial']) : '', wavelength: wavelengthNode ? xmlNumber(wavelengthNode, ['kAlpha1']) : null,
      wavelength2: wavelengthNode ? xmlNumber(wavelengthNode, ['kAlpha2']) : null, wavelengthRatio: wavelengthNode ? xmlNumber(wavelengthNode, ['ratioKAlpha2KAlpha1']) : null,
      voltage: tube ? xmlNumber(tube, ['tension']) : null, current: tube ? xmlNumber(tube, ['current']) : null,
      dateMeasured: xmlValue(scan, ['header', 'startTimeStamp']), endTime: xmlValue(scan, ['header', 'endTimeStamp']),
      author: xmlValue(scan, ['header', 'author', 'name']), instrumentId: xmlValue(scan, ['header', 'source', 'instrumentID']),
      intensityMode: intensityMode, attenuationApplied: !!(countsNode && attenuationNode && !intensityNode), commonPositions: commonPositions
    };
    return { records: records, native: native, warnings: warnings };
  }

  function parseRAS(text) {
    if (typeof text !== 'string') throw new Error('RAS 解析需要文本');
    var lines = splitLines(text), markers = {};
    ['RAS_DATA_START', 'RAS_HEADER_START', 'RAS_HEADER_END', 'RAS_INT_START', 'RAS_INT_END', 'RAS_DATA_END'].forEach(function (name) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim().toUpperCase() === '*' + name) { markers[name] = i; break; }
      }
    });
    var required = ['RAS_DATA_START', 'RAS_HEADER_START', 'RAS_HEADER_END', 'RAS_INT_START', 'RAS_INT_END', 'RAS_DATA_END'];
    for (var ri = 0; ri < required.length; ri++) if (markers[required[ri]] == null) throw new Error('RAS 缺少 *' + required[ri] + ' 标记');
    var order = ['RAS_DATA_START', 'RAS_HEADER_START', 'RAS_HEADER_END', 'RAS_INT_START', 'RAS_INT_END', 'RAS_DATA_END'];
    for (var oi = 1; oi < order.length; oi++) if (markers[order[oi]] <= markers[order[oi - 1]]) throw new Error('RAS 区段标记顺序无效：*' + order[oi]);

    var meta = {}, warnings = [];
    for (var hi = markers.RAS_HEADER_START + 1; hi < markers.RAS_HEADER_END; hi++) {
      var headerLine = lines[hi].trim(), hm = headerLine.match(/^\*([A-Z0-9_-]+)\s+"((?:[^"]|"")*)"\s*$/i);
      if (hm) meta[hm[1].toUpperCase()] = hm[2].replace(/""/g, '"');
      else if (headerLine) warnings.push('RAS 文件头第 ' + (hi + 1) + ' 行不是可识别的键值，已忽略');
    }
    var dataLines = lines.slice(markers.RAS_INT_START + 1, markers.RAS_INT_END);
    var hasFactorColumn = dataLines.some(function (line) {
      return line.trim() !== '' && line.trim().split(/\s+/).length >= 3;
    });
    var records = [], blankRows = 0, extraColumns = false;
    dataLines.forEach(function (line, index) {
      var sourceLine = markers.RAS_INT_START + index + 2, trim = line.trim();
      if (!trim) { blankRows++; return; }
      var cells = trim.split(/\s+/);
      if (cells.length > (hasFactorColumn ? 3 : 2)) extraColumns = true;
      var reason = null, y = null;
      if (cells.length < 2) reason = 'RAS 数据行应包含角度与强度至少两列';
      else if (hasFactorColumn && cells.length < 3) reason = 'RAS 文件使用第 3 列计数因子，但该行缺少因子';
      else if (!isNumeric(cells[0])) reason = 'RAS X 值不是有效数字';
      else if (!isNumeric(cells[1])) reason = 'RAS 显示强度不是有效数字';
      else if (hasFactorColumn && (!isNumeric(cells[2]) || Number(cells[2]) <= 0)) reason = 'RAS 第 3 列计数因子必须为正数';
      else y = hasFactorColumn ? Number(cells[1]) / Number(cells[2]) : Number(cells[1]);
      if (!reason && !isFinite(y)) reason = 'RAS 解码后强度不是有限数值';
      records.push({ cells: [cells[0], String(y == null ? cells[1] : y)], lineNo: records.length + 1, sourceLine: sourceLine, nativeError: reason });
    });
    if (extraColumns) warnings.push('RAS 数据行含额外列；仅使用 X、显示强度' + (hasFactorColumn ? '与第 3 列计数因子' : ''));
    if (hasFactorColumn) warnings.push('RAS 检测到第 3 列计数因子，已按「测量强度 = 第 2 列显示强度 ÷ 第 3 列」解码');
    var expected = metaNumber(meta, 'MEAS_DATA_COUNT');
    if (expected != null && expected !== records.length) warnings.push('MEAS_DATA_COUNT=' + expected + '，实际数据记录 ' + records.length + ' 条');
    var yColumn = hasFactorColumn ? '第 2 列 ÷ 第 3 列计数因子（测量强度）' : '第 2 列显示强度';
    return {
      records: records,
      native: {
        format: 'ras', trace: 'line', sample: meta.FILE_SAMPLE || '', title: meta.DISP_NOTE || '', note: meta.FILE_MEMO || '',
        xUnits: meta.MEAS_SCAN_UNIT_X || '', yUnits: meta.MEAS_SCAN_UNIT_Y || meta.DISP_UNIT_Y || '',
        displayedYUnits: meta.DISP_UNIT_Y || '', yColumn: yColumn, factorColumn: hasFactorColumn ? 3 : null,
        anode: meta.HW_XG_TARGET_NAME || '', wavelength: metaNumber(meta, 'HW_XG_WAVE_LENGTH_ALPHA1'),
        wavelength2: metaNumber(meta, 'HW_XG_WAVE_LENGTH_ALPHA2'), wavelengthBeta: metaNumber(meta, 'HW_XG_WAVE_LENGTH_BETA'),
        voltage: metaNumber(meta, 'MEAS_COND_XG_VOLTAGE'), current: metaNumber(meta, 'MEAS_COND_XG_CURRENT'),
        scanAxis: meta.MEAS_SCAN_AXIS_X || '', scanMode: meta.MEAS_SCAN_MODE || '',
        scanStart: metaNumber(meta, 'MEAS_SCAN_START'), scanStop: metaNumber(meta, 'MEAS_SCAN_STOP'), stepSize: metaNumber(meta, 'MEAS_SCAN_STEP'),
        scanSpeed: metaNumber(meta, 'MEAS_SCAN_SPEED'), scanSpeedUnit: meta.MEAS_SCAN_SPEED_UNIT || '',
        dateMeasured: meta.MEAS_SCAN_START_TIME || '', endTime: meta.MEAS_SCAN_END_TIME || '',
        operator: meta.FILE_OPERATOR || '', nPoints: expected, blankRows: blankRows
      },
      warnings: warnings
    };
  }

  var WIN_1252 = ['€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž', '', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ'];

  function bytesText(bytes, start, length) {
    var end = Math.min(bytes.length, start + length), out = '';
    for (var i = start; i < end; i++) {
      var b = bytes[i];
      if (b === 0) break;
      out += b >= 32 && b < 127 ? String.fromCharCode(b) : b >= 128 ? (WIN_1252[b - 128] || String.fromCharCode(b)) : (b === 9 || b === 10 || b === 13 ? String.fromCharCode(b) : '');
    }
    return out.trim();
  }

  function parseSPA(data) {
    var bytes = asBytes(data);
    if (!hasSPASignature(bytes)) throw new Error('SPA 文件签名无效，应为 Spectral Data File');
    if (bytes.length < 304) throw new Error('SPA 文件头被截断');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var keyCount = view.getUint16(294, true), tableEnd = 304 + keyCount * 16;
    if (!keyCount || tableEnd > bytes.length) throw new Error('SPA 键表数量或长度无效，文件可能被截断');
    var keys = [];
    for (var i = 0; i < keyCount; i++) {
      var offset = 304 + i * 16, key = bytes[offset], subtype = bytes[offset + 1];
      var position = view.getUint32(offset + 2, true), length = view.getUint32(offset + 6, true);
      if (length && (position < tableEnd || position > bytes.length || length > bytes.length - position)) throw new Error('SPA 键表第 ' + (i + 1) + ' 条记录指向越界或与文件头重叠的数据块');
      keys.push({ key: key, subtype: subtype, position: position, length: length });
    }
    function singleKey(wanted) {
      var found = keys.filter(function (entry) { return entry.key === wanted; });
      if (found.length > 1) throw new Error('SPA 含多个 0x' + wanted.toString(16) + ' 数据块，无法唯一确定光谱');
      return found[0] || null;
    }
    var header = singleKey(0x02), payload = singleKey(0x03);
    if (!header || !payload) throw new Error('SPA 缺少唯一的数据头 0x02 或主数据块 0x03');
    if (payload.position < header.position + header.length && header.position < payload.position + payload.length) throw new Error('SPA 数据头与主数据块重叠，无法保证载荷完整');
    if (keys.some(function (entry) { return entry.key === 0x53; })) throw new Error('SPA 库/检索谱变体尚未验证，未导入以免误判载荷方向');
    if (header.length < 24) throw new Error('SPA 数据头不足 24 字节，无法读取点数、单位与 X 端点');
    var count = view.getUint32(header.position + 4, true);
    if (!count || count > 5000000) throw new Error('SPA 点数无效或超过 5,000,000 点上限');
    if (payload.length !== count * 4) throw new Error('SPA 数据头声明 ' + count + ' 点，但主数据块为 ' + payload.length + ' 字节，无法保证完整光谱');
    var xCode = bytes[header.position + 8], yCode = bytes[header.position + 12];
    if (xCode === 0x02) throw new Error('SPA X 单位为 data points，通常是独立干涉图；当前不将其作为光谱导入');
    var xUnits = { 1: 'cm⁻¹', 3: 'nm', 4: 'µm', 32: 'cm⁻¹' }[xCode];
    var yUnits = { 11: 'Reflectance', 12: 'log(1/R)', 15: 'Single beam', 16: '% Transmittance', 17: 'Absorbance', 20: 'Kubelka–Munk', 21: 'Reflectance', 23: 'Transmittance', 26: 'Photoacoustic', 31: 'Raman intensity' }[yCode];
    if (!xUnits) throw new Error('SPA X 单位码 0x' + xCode.toString(16) + ' 尚未验证，未导入');
    if (yCode === 0x16) throw new Error('SPA Volts 标签见于独立干涉图，当前不按光谱导入');
    if (!yUnits) throw new Error('SPA Y 单位码 0x' + yCode.toString(16) + ' 尚未验证，未导入');
    if ((xCode === 0x20) !== (yCode === 0x1f)) throw new Error('SPA 拉曼位移/拉曼强度单位组合不匹配，未导入');
    var lastX = view.getFloat32(header.position + 16, true), firstX = view.getFloat32(header.position + 20, true);
    if (!isFinite(lastX) || !isFinite(firstX)) throw new Error('SPA X 端点不是有限数值');
    if (count > 1 && lastX === firstX) throw new Error('SPA 多点光谱的 X 起止端点相同');
    if (count === 1 && lastX !== firstX) throw new Error('SPA 单点光谱的 X 起止端点不一致');

    var yValues = [], records = [], warnings = [];
    if ([3, 4, 11, 12, 15, 20, 21, 23, 26].indexOf(xCode) !== -1 || [11, 12, 15, 20, 21, 23, 26].indexOf(yCode) !== -1) warnings.push('SPA 使用共享文件头已观察、但尚未覆盖全部厂商变体的单位码；坐标与载荷按已验证端点规则解码');
    if (header.length !== 140) warnings.push('SPA 数据头长度为 ' + header.length + ' 字节；仅使用已验证的前 24 字节字段');
    for (var pi = 0; pi < count; pi++) {
      var y = view.getFloat32(payload.position + pi * 4, true);
      if (!isFinite(y)) throw new Error('SPA 第 ' + (pi + 1) + ' 个强度不是有限数值');
      var x = count === 1 ? lastX : lastX + (firstX - lastX) * pi / (count - 1);
      if (!isFinite(x)) throw new Error('SPA 第 ' + (pi + 1) + ' 个重建坐标不是有限数值');
      yValues.push(y);
      records.push({ cells: [String(x), String(y)], lineNo: pi + 1 });
    }
    var comments = keys.filter(function (entry) { return entry.key === 0x04; }).map(function (entry) { return bytesText(bytes, entry.position, entry.length); }).filter(Boolean);
    var comment = comments.join('\n');
    if (comment.length > 4000) { comment = comment.slice(0, 4000); warnings.push('SPA 注释超过 4000 字符，元数据中仅保留前 4000 字符'); }
    var experiments = keys.filter(function (entry) { return entry.key === 0x82 && entry.subtype === 0x79; });
    if (experiments.length > 1) warnings.push('SPA 含多个 0x82/0x79 实验信息块，元数据采用第一个');
    var experiment = experiments[0], experimentPath = '', experimentTitle = '', description = '', accessory = '';
    if (experiment) {
      if (experiment.length > 10) experimentPath = bytesText(bytes, experiment.position + 10, Math.min(80, experiment.length - 10));
      if (experiment.length > 90) experimentTitle = bytesText(bytes, experiment.position + 90, Math.min(64, experiment.length - 90));
      if (experiment.length > 154) description = bytesText(bytes, experiment.position + 154, Math.min(259, experiment.length - 154));
      if (experiment.length > 413) accessory = bytesText(bytes, experiment.position + 413, Math.min(257, experiment.length - 413));
    }
    var rawTimestamp = view.getUint32(296, true), dateMeasured = '';
    if (rawTimestamp) {
      var timestamp = new Date(-2209075200000 + rawTimestamp * 1000);
      if (!isNaN(timestamp.getTime())) dateMeasured = timestamp.toISOString();
    }
    var laserWavenumber = xCode === 0x20 && header.length >= 100 ? view.getFloat32(header.position + 96, true) : null;
    if (laserWavenumber != null && (!isFinite(laserWavenumber) || laserWavenumber <= 0)) laserWavenumber = null;
    var native = {
      format: 'spa', trace: 'record', title: experimentTitle || bytesText(bytes, 30, 256), sample: '',
      experimentPath: experimentPath, description: description, accessory: accessory, comment: comment,
      xUnits: xUnits, yUnits: yUnits, xUnitCode: xCode, yUnitCode: yCode,
      firstX: firstX, lastX: lastX, storedFirstX: lastX, storedLastX: firstX,
      orientation: 'payload[0] = Last X；payload[N-1] = First X', nPoints: count,
      dateMeasured: dateMeasured, timestampEncoding: 'uint32 seconds since 1899-12-31 UTC',
      laserWavenumber: laserWavenumber, laserWavelengthNm: laserWavenumber ? 1e7 / laserWavenumber : null,
      keyCount: keyCount, dataHeaderLength: header.length, payloadOffset: payload.position, payloadBytes: payload.length,
      textEncoding: 'Windows-1252（单字节元数据）'
    };
    return { records: records, native: native, warnings: warnings };
  }

  function analyzeNative(data, format, opts) {
    var parsed;
    try {
      if (format === 'jcamp') parsed = parseJCAMP(data);
      else if (format === 'uxd') parsed = parseUXD(data);
      else if (format === 'xrdml') parsed = parseXRDML(data);
      else if (format === 'ras') parsed = parseRAS(data);
      else if (format === 'spa') parsed = parseSPA(data);
      else throw new Error('不支持的原生格式：' + format);
    } catch (e) {
      var failed = baseResult({ sourceFormat: format, fatal: e.message });
      return failed;
    }
    var result = finishRecords(parsed.records, Object.assign({}, opts, { xCol: 0, yCol: 1 }), {
      sourceFormat: format, logicalLines: true, native: parsed.native, warnings: parsed.warnings,
      blankRows: parsed.native.blankRows || 0
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
    formatName: formatName,
    isNativeFormat: isNativeFormat,
    analyzeNative: analyzeNative
  };
})();
