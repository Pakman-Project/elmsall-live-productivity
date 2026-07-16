function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('E3 Live Productivity')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var CONFIG = {
  SHEET_NAME: 'Front',
  SOURCE_SHEET_NAME: 'Processed Data (15mins)',
  THRESHOLD_CELL: 'A2',
  DATETIME_CELL: 'B2',
  LINKS_SHEET_NAME: 'Links'
};



function updateThreshold(value) {
  var num = parseFloat(value);
  if (isNaN(num) || num >= 1 || num < 0) {
    throw new Error("Invalid Threshold: Please enter a number between 0 and 0.99.");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Sheet not found: " + CONFIG.SHEET_NAME);

  sheet.getRange(CONFIG.THRESHOLD_CELL).setValue(num);
  return true;
}

function getArchiveLinks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var linksSheet = ss.getSheetByName(CONFIG.LINKS_SHEET_NAME);
  if (!linksSheet) return [];

  var lastRow = linksSheet.getLastRow();
  if (lastRow < 2) return [];

  var kValues = linksSheet.getRange(2, 11, lastRow - 1, 1).getValues().flat();
  var bValues = linksSheet.getRange(2, 2, lastRow - 1, 1).getValues().flat();

  var uniqueLinks = [];
  var seenNames = {};

  var now = new Date();
  var cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14, 0, 0, 0, 0);

  for (var i = 0; i < kValues.length; i++) {
    var rawName = kValues[i];
    var url = String(bValues[i] || '').trim();

    var formattedName = "";
    var dateObj = null;

    if (rawName instanceof Date) {
      dateObj = rawName;
      formattedName = Utilities.formatDate(rawName, Session.getScriptTimeZone(), "dd/MM/yyyy");
    } else if (rawName) {
      formattedName = String(rawName).trim();
      var parts = formattedName.split('/');
      if (parts.length === 3) {
        dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
      }
    }

    if (dateObj && dateObj >= cutoffDate) {
      if (formattedName && url && !seenNames[formattedName]) {
        uniqueLinks.push({ name: formattedName, url: url, date: dateObj });
        seenNames[formattedName] = true;
      }
    }
  }

  uniqueLinks.sort(function(a, b) {
    return b.date.getTime() - a.date.getTime();
  });

  return uniqueLinks.map(function(l) {
    return { name: l.name, url: l.url };
  });
}

// ─────────────────────────────────────────────
// Helper: parse start datetime from a range string
// e.g. "14/06/2026 23:15 - 15/06/2026 23:30" → Date
// ─────────────────────────────────────────────
function parseTimeRangeStart_(tr) {
  if (!tr || typeof tr !== 'string' || tr.indexOf('-') === -1) return null;
  var startPart = tr.split('-')[0].trim();
  var sp = startPart.split(' ');
  if (sp.length !== 2) return null;
  var dp = sp[0].split('/');
  if (dp.length !== 3) return null;
  var tp = sp[1].split(':');
  if (tp.length < 2) return null;
  return new Date(Number(dp[2]), Number(dp[1]) - 1, Number(dp[0]), Number(tp[0]), Number(tp[1]), 0);
}

function getDashboardData(archiveUrl) {
  var ss;
  var isLiveMode = !archiveUrl;

  if (archiveUrl) {
    try {
      ss = SpreadsheetApp.openByUrl(archiveUrl);
    } catch (e) {
      throw new Error("Could not open the selected spreadsheet. Please check permissions.");
    }
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Sheet not found: " + CONFIG.SHEET_NAME);

  var sourceSheet = ss.getSheetByName(CONFIG.SOURCE_SHEET_NAME);
  if (!sourceSheet) throw new Error('Source sheet not found');

  var threshold = sheet.getRange(CONFIG.THRESHOLD_CELL).getValue();
  var lastRefresh = sheet.getRange(CONFIG.DATETIME_CELL).getValue();

  if (archiveUrl) {
    var lastRow = sourceSheet.getLastRow();
    if (lastRow >= 2) {
      var lastTimeRangeStr = sourceSheet.getRange(lastRow, 1).getDisplayValue();
      if (typeof lastTimeRangeStr === 'string' && lastTimeRangeStr.indexOf('-') !== -1) {
        var parts = lastTimeRangeStr.split('-');
        if (parts.length === 2) {
          var endDateStr = parts[1].trim();
          var endParts = endDateStr.split(' ');
          if (endParts.length === 4) {
            var d = endParts[0], m = endParts[1], y = endParts[2], time = endParts[3];
            var timeParts = time.split(':');
            var h = timeParts[0], min = timeParts[1];
            var lastDataPoint = new Date(y + '-' + m + '-' + d + 'T' + h + ':' + min + ':00');
            lastRefresh = new Date(lastDataPoint.getFullYear(), lastDataPoint.getMonth(), lastDataPoint.getDate() + 1, 0, 0, 0);
          }
        }
      }
    }

    if (!lastRefresh || !(lastRefresh instanceof Date)) {
      lastRefresh = sheet.getRange(CONFIG.DATETIME_CELL).getValue();
      if (lastRefresh && (lastRefresh instanceof Date)) {
        if (lastRefresh.getHours() !== 0 || lastRefresh.getMinutes() !== 0) {
          lastRefresh = new Date(lastRefresh.getFullYear(), lastRefresh.getMonth(), lastRefresh.getDate() + 1, 0, 0, 0);
        }
      } else {
        lastRefresh = new Date();
      }
    }
  } else {
    if (!lastRefresh || !(lastRefresh instanceof Date)) {
      var lastRow2 = sourceSheet.getLastRow();
      if (lastRow2 >= 2) {
        var lastTimeRangeStr2 = sourceSheet.getRange(lastRow2, 1).getValue();
        if (typeof lastTimeRangeStr2 === 'string' && lastTimeRangeStr2.indexOf('-') !== -1) {
          var parts2 = lastTimeRangeStr2.split('-');
          if (parts2.length === 2) {
            var endDateStr2 = parts2[1].trim();
            var endParts2 = endDateStr2.split(' ');
            if (endParts2.length === 4) {
              var d2 = endParts2[0], m2 = endParts2[1], y2 = endParts2[2], time2 = endParts2[3];
              var timeParts2 = time2.split(':');
              var h2 = timeParts2[0], min2 = timeParts2[1];
              lastRefresh = new Date(y2 + '-' + m2 + '-' + d2 + 'T' + h2 + ':' + min2 + ':00');
            }
          }
        }
      }
    }

    if (!lastRefresh || isNaN(lastRefresh.getTime())) {
      lastRefresh = new Date();
    }
  }

  var timeRanges = generateTimeRanges_(lastRefresh, 96);
  var rawSideData = [];
  var bonusSet = {};

  // ═══════════════════════════════════════════════
  // MERGED MODE — Live = Yesterday archive + Today live
  // ═══════════════════════════════════════════════
  if (isLiveMode) {
    var tz = Session.getScriptTimeZone();

    // Determine "start of today" using the SAME script timezone
    // so it aligns with the date strings inside the time ranges
    var todayFormatted = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy");
    var todayParts = todayFormatted.split('/');
    var todayStart = new Date(Number(todayParts[2]), Number(todayParts[1]) - 1, Number(todayParts[0]), 0, 0, 0);

    // Classify every generated time range as "yesterday" or "today"
    var yesterdayTRSet = {};
    var todayTRSet = {};
    for (var t = 0; t < timeRanges.length; t++) {
      var tr = timeRanges[t];
      var parsedStart = parseTimeRangeStart_(tr);
      if (parsedStart && parsedStart.getTime() < todayStart.getTime()) {
        yesterdayTRSet[tr] = true;
      } else {
        todayTRSet[tr] = true;
      }
    }

    // Find yesterday's archive link
    var yesterdayDate = new Date(Number(todayParts[2]), Number(todayParts[1]) - 1, Number(todayParts[0]) - 1, 0, 0, 0);
    var yesterdayStr = Utilities.formatDate(yesterdayDate, tz, "dd/MM/yyyy");

    var archiveLinks = getArchiveLinks();
    var yesterdayArchiveUrl = null;
    for (var a = 0; a < archiveLinks.length; a++) {
      if (archiveLinks[a].name === yesterdayStr) {
        yesterdayArchiveUrl = archiveLinks[a].url;
        break;
      }
    }

    // ── Step 1: Read yesterday's data from archive (authoritative) ──
    var archiveDataMap = {};   // key = "timeRange||bonus"

    if (yesterdayArchiveUrl) {
      try {
        var archiveSS = SpreadsheetApp.openByUrl(yesterdayArchiveUrl);
        var archiveSource = archiveSS.getSheetByName(CONFIG.SOURCE_SHEET_NAME);
        if (archiveSource && archiveSource.getLastRow() >= 2) {
          var aLR = archiveSource.getLastRow();
          var aV = archiveSource.getRange(2, 1, aLR - 1, 18).getValues();
          var aD = archiveSource.getRange(2, 1, aLR - 1, 18).getDisplayValues();

          for (var i = 0; i < aV.length; i++) {
            var aTR = String(aD[i][0]).trim();
            if (!yesterdayTRSet[aTR]) continue;

            var aBonus = String(aD[i][2]).trim();
            var aVal = toNumber_(aV[i][10]);
            if (!aBonus || aVal <= 0) continue;

            archiveDataMap[aTR + '||' + aBonus] = {
              timeRange: aTR,
              bonus: aBonus,
              value: toNumber_(aV[i][10]),
              pieStd: toNumber_(aV[i][3]),
              topUpStd: toNumber_(aV[i][4]),
              e3PackingStd: toNumber_(aV[i][5]),
              parcelSortationStd: toNumber_(aV[i][6]),
              parcelInductStd: toNumber_(aV[i][7]),
              inboundDecantingStd: toNumber_(aV[i][8]),
              osrDecantingStd: toNumber_(aV[i][9]),
              pie: toNumber_(aV[i][11]),
              topUp: toNumber_(aV[i][12]),
              e3Packing: toNumber_(aV[i][13]),
              parcelSortation: toNumber_(aV[i][14]),
              parcelInduct: toNumber_(aV[i][15]),
              inboundDecanting: toNumber_(aV[i][16]),
              osrDecanting: toNumber_(aV[i][17])
            };
            bonusSet[aBonus] = true;
          }
        }
      } catch (e) {
        Logger.log('Yesterday archive read failed (' + yesterdayStr + '): ' + e.message);
      }
    }

    // ── Step 2: Read from live file ──
    if (sourceSheet.getLastRow() >= 2) {
      var lastRow3 = sourceSheet.getLastRow();
      var vals = sourceSheet.getRange(2, 1, lastRow3 - 1, 18).getValues();
      var disps = sourceSheet.getRange(2, 1, lastRow3 - 1, 18).getDisplayValues();

      for (var i = 0; i < vals.length; i++) {
        var lTR = String(disps[i][0]).trim();
        var lBonus = String(disps[i][2]).trim();
        var lVal = toNumber_(vals[i][10]);
        if (!lBonus || lVal <= 0) continue;

        var lKey = lTR + '||' + lBonus;

        if (yesterdayTRSet[lTR]) {
          // For yesterday ranges: only use live if archive does NOT have this row
          if (!archiveDataMap[lKey]) {
            rawSideData.push({
              timeRange: lTR,
              bonus: lBonus,
              value: lVal,
              pieStd: toNumber_(vals[i][3]),
              topUpStd: toNumber_(vals[i][4]),
              e3PackingStd: toNumber_(vals[i][5]),
              parcelSortationStd: toNumber_(vals[i][6]),
              parcelInductStd: toNumber_(vals[i][7]),
              inboundDecantingStd: toNumber_(vals[i][8]),
              osrDecantingStd: toNumber_(vals[i][9]),
              pie: toNumber_(vals[i][11]),
              topUp: toNumber_(vals[i][12]),
              e3Packing: toNumber_(vals[i][13]),
              parcelSortation: toNumber_(vals[i][14]),
              parcelInduct: toNumber_(vals[i][15]),
              inboundDecanting: toNumber_(vals[i][16]),
              osrDecanting: toNumber_(vals[i][17])
            });
            bonusSet[lBonus] = true;
          }
          // If archive has it, archive wins — skip the live row
        } else if (todayTRSet[lTR]) {
          // Today ranges: always take from live
          rawSideData.push({
            timeRange: lTR,
            bonus: lBonus,
            value: lVal,
            pieStd: toNumber_(vals[i][3]),
            topUpStd: toNumber_(vals[i][4]),
            e3PackingStd: toNumber_(vals[i][5]),
            parcelSortationStd: toNumber_(vals[i][6]),
            parcelInductStd: toNumber_(vals[i][7]),
            inboundDecantingStd: toNumber_(vals[i][8]),
            osrDecantingStd: toNumber_(vals[i][9]),
            pie: toNumber_(vals[i][11]),
            topUp: toNumber_(vals[i][12]),
            e3Packing: toNumber_(vals[i][13]),
            parcelSortation: toNumber_(vals[i][14]),
            parcelInduct: toNumber_(vals[i][15]),
            inboundDecanting: toNumber_(vals[i][16]),
            osrDecanting: toNumber_(vals[i][17])
          });
          bonusSet[lBonus] = true;
        }
      }
    }

    // ── Step 3: Merge archive data into the result ──
    var aKeys = Object.keys(archiveDataMap);
    for (var k = 0; k < aKeys.length; k++) {
      rawSideData.push(archiveDataMap[aKeys[k]]);
    }

  } else {
    // ═══════════════════════════════════════════════
    // ARCHIVE MODE — Single source (unchanged)
    // ═══════════════════════════════════════════════
    if (sourceSheet.getLastRow() >= 2) {
      var lastRow3 = sourceSheet.getLastRow();
      var vals = sourceSheet.getRange(2, 1, lastRow3 - 1, 18).getValues();
      var disps = sourceSheet.getRange(2, 1, lastRow3 - 1, 18).getDisplayValues();
      var timeSet = {};

      for (var t = 0; t < timeRanges.length; t++) {
        timeSet[timeRanges[t]] = true;
      }

      for (var i = 0; i < vals.length; i++) {
        var tr = String(disps[i][0]).trim();
        var bonus = String(disps[i][2]).trim();

        var val = toNumber_(vals[i][10]);
        var pie = toNumber_(vals[i][11]);
        var topUp = toNumber_(vals[i][12]);
        var e3Packing = toNumber_(vals[i][13]);
        var parcelSortation = toNumber_(vals[i][14]);
        var parcelInduct = toNumber_(vals[i][15]);
        var inboundDecanting = toNumber_(vals[i][16]);
        var osrDecanting = toNumber_(vals[i][17]);

        if (timeSet[tr] && bonus && val > 0) {
          rawSideData.push({
            timeRange: tr,
            bonus: bonus,
            value: val,
            pieStd: toNumber_(vals[i][3]),
            topUpStd: toNumber_(vals[i][4]),
            e3PackingStd: toNumber_(vals[i][5]),
            parcelSortationStd: toNumber_(vals[i][6]),
            parcelInductStd: toNumber_(vals[i][7]),
            inboundDecantingStd: toNumber_(vals[i][8]),
            osrDecantingStd: toNumber_(vals[i][9]),
            pie: pie,
            topUp: topUp,
            e3Packing: e3Packing,
            parcelSortation: parcelSortation,
            parcelInduct: parcelInduct,
            inboundDecanting: inboundDecanting,
            osrDecanting: osrDecanting
          });
          bonusSet[bonus] = true;
        }
      }
    }
  }

  var displayTime = sheet.getRange(CONFIG.DATETIME_CELL).getDisplayValue();
  if (archiveUrl) {
    var archiveDateObj = new Date(lastRefresh.getFullYear(), lastRefresh.getMonth(), lastRefresh.getDate() - 1);
    displayTime = Utilities.formatDate(archiveDateObj, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }

  var b2Val = sheet.getRange(CONFIG.DATETIME_CELL).getValue();
  var noteVal = sheet.getRange('G3').getValue();

  return {
    threshold: threshold,
    lastRefresh: displayTime || Utilities.formatDate(lastRefresh, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
    archiveBaseTime: lastRefresh.getTime(),
    timeRanges: timeRanges,
    rawSideData: rawSideData,
    bonusList: Object.keys(bonusSet).sort(),
    currentTimestamp: (b2Val instanceof Date) ? b2Val.getTime() : null,
    note: noteVal
  };
}

function generateTimeRanges_(baseDateTime, count) {
  var ranges = [];
  var intervalMs = 15 * 60 * 1000;
  var flooredMs = Math.floor(baseDateTime.getTime() / intervalMs) * intervalMs;

  for (var i = 0; i < count; i++) {
    var startOffset = (count - i) * intervalMs;
    var endOffset = (count - i - 1) * intervalMs;
    ranges.push(formatDateTimeRange_(new Date(flooredMs - startOffset), new Date(flooredMs - endOffset)));
  }

  return ranges;
}

function formatDateTimeRange_(start, end) {
  var fmt = function(d) {
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    var hh = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min;
  };

  return fmt(start) + ' - ' + fmt(end);
}

function toNumber_(v) {
  var n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function getLastRefreshTimestamp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return null;

  var val = sheet.getRange(CONFIG.DATETIME_CELL).getValue();
  return (val instanceof Date) ? val.getTime() : null;
}

// ==========================================
// SHARED PROCESSING HELPERS
// Used by both updateProcessedData15mins() and forceRebuildProcessedData()
// ==========================================
function computeProcessedAggregates_(dataValues) {
  var norm = function(v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var isBlank = function(v) { return v === '' || v === null || v === undefined; };
  var makeKey = function(a, b, c, j) { return norm(a) + '|' + norm(b) + '|' + norm(c) + '|' + norm(j); };

  var uniqueACMap = {};
  var sumF = {};
  var sumE = {};

  for (var idx = 0; idx < dataValues.length; idx++) {
    var row = dataValues[idx];
    var a = norm(row[8]);
    var b = norm(row[1]);
    var c = norm(row[2]);
    var j = norm(row[9]);

    if (!isBlank(b)) {
      var acKey = a + '|' + b + '|' + c;
      if (!uniqueACMap[acKey]) {
        uniqueACMap[acKey] = [a, b, c];
      }
    }

    var key = makeKey(a, b, c, j);
    sumF[key] = (sumF[key] || 0) + (Number(row[5]) || 0);

    var eVal = Number(row[4]) || 0;
    var bucket = '';
    var dType = norm(row[3]);

    if (dType === 'MSKU' || dType === 'PSKU') {
      bucket = 'MSKU_PSKU';
    } else if (
      dType === 'TPUT' ||
      dType === 'PackingItemScannedEvent' ||
      dType === 'ParcelSortedToSack' ||
      dType === 'SPAR' ||
      dType === 'DECN' ||
      dType === 'ODEC'
    ) {
      bucket = dType;
    }

    if (bucket) {
      var bucketKey = key + '|' + bucket;
      sumE[bucketKey] = (sumE[bucketKey] || 0) + eVal;
    }
  }

  var sortedAC = [];
  var acKeys = Object.keys(uniqueACMap);
  for (var k = 0; k < acKeys.length; k++) {
    sortedAC.push(uniqueACMap[acKeys[k]]);
  }
  sortedAC.sort(function(x, y) {
    if (x[0] < y[0]) return -1;
    if (x[0] > y[0]) return 1;
    return 0;
  });

  return { sortedAC: sortedAC, sumF: sumF, sumE: sumE };
}

function buildProcessedRows_(procData, existingRows, fullRebuild, sumF, sumE, divisor, headers) {
  var norm = function(v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var isBlank = function(v) { return v === '' || v === null || v === undefined; };
  var output = [];

  for (var i = 0; i < procData.length; i++) {
    var r = procData[i];
    var a = norm(r[0]);
    var b = norm(r[1]);
    var c = norm(r[2]);

    var rowOut = new Array(15).fill('');

    if (!a) {
      if (existingRows) {
        for (var col = 0; col < 15; col++) rowOut[col] = existingRows[i][col];
      }
      output.push(rowOut);
      continue;
    }

    var rowDJ = headers.map(function(h) {
      var k = a + '|' + b + '|' + c + '|' + norm(h);
      return (sumF[k] || 0) / divisor;
    });

    var totalK = rowDJ.reduce(function(s, v) { return s + (Number(v) || 0); }, 0);

    var rowLR = [
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[0]) + '|MSKU_PSKU'] || 0),
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[1]) + '|TPUT'] || 0),
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[2]) + '|PackingItemScannedEvent'] || 0),
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[3]) + '|ParcelSortedToSack'] || 0),
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[4]) + '|SPAR'] || 0),
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[5]) + '|DECN'] || 0),
      (sumE[a + '|' + b + '|' + c + '|' + norm(headers[6]) + '|ODEC'] || 0)
    ];

    if (fullRebuild) {
      for (var col = 0; col < 7; col++) rowOut[col] = rowDJ[col];
      rowOut[7] = totalK;
      for (var col = 0; col < 7; col++) rowOut[8 + col] = rowLR[col];
    } else {
      for (var col = 0; col < 7; col++) {
        rowOut[col] = isBlank(existingRows[i][col]) ? rowDJ[col] : existingRows[i][col];
      }
      rowOut[7] = isBlank(existingRows[i][7]) ? totalK : existingRows[i][7];
      for (var col = 0; col < 7; col++) {
        var targetIndex = 8 + col;
        rowOut[targetIndex] = isBlank(existingRows[i][targetIndex])
          ? rowLR[col]
          : existingRows[i][targetIndex];
      }
    }

    output.push(rowOut);
  }

  return output;
}

function updateProcessedData15mins() {
  // ==========================================
  // GATEKEEPER LOGIC
  // ==========================================
  var now = new Date();
  var minute = now.getMinutes();
  var rem = minute % 15;

  if (rem < 3 || rem > 10) return;

  var scriptProps = PropertiesService.getScriptProperties();
  var lastRunTime = Number(scriptProps.getProperty('LAST_RUN_TIMESTAMP')) || 0;
  var currentTimeMs = now.getTime();

  if (currentTimeMs - lastRunTime < 1 * 60 * 1000) return;

  scriptProps.setProperty('LAST_RUN_TIMESTAMP', String(currentTimeMs));
  // ==========================================
  // END GATEKEEPER LOGIC
  // ==========================================

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var frontSheet = ss.getSheetByName('Front');
  var procSheet = ss.getSheetByName('Processed Data (15mins)');
  var dataSheet = ss.getSheetByName('Data');

  var props = PropertiesService.getDocumentProperties();

  var norm = function(v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var isBlank = function(v) { return v === '' || v === null || v === undefined; };

  var lastProcRow = procSheet.getLastRow();
  var lastDataRow = dataSheet.getLastRow();

  if (lastDataRow < 2) {
    if (lastProcRow > 1) procSheet.getRange(2, 1, lastProcRow - 1, 18).clearContent();
    props.setProperty('PROC_A2_LAST', '');
    props.setProperty('DATA_LAST_ROW', '1');
    return;
  }

  var divisor = Number(frontSheet.getRange('C2').getValue()) || 1;

  var dataValues = dataSheet.getRange(2, 1, lastDataRow - 1, 10).getValues();

  var aggregates = computeProcessedAggregates_(dataValues);
  var sortedAC = aggregates.sortedAC;
  var sumF = aggregates.sumF;
  var sumE = aggregates.sumE;

  var oldProcRowCount = lastProcRow > 1 ? lastProcRow - 1 : 0;
  var newProcRowCount = sortedAC.length;

  var currentA2 = newProcRowCount > 0 ? norm(sortedAC[0][0]) : '';
  var storedA2 = props.getProperty('PROC_A2_LAST') || '';
  var forceRecalc = currentA2 !== storedA2 || newProcRowCount !== oldProcRowCount;

  var storedLastDataRow = Number(props.getProperty('DATA_LAST_ROW')) || 0;
  if (lastDataRow > storedLastDataRow) {
    Logger.log('New data detected (Row ' + storedLastDataRow + ' -> ' + lastDataRow + '). A:C rebuilt.');
  }

  props.setProperty('DATA_LAST_ROW', String(lastDataRow));

  if (newProcRowCount === 0) {
    if (oldProcRowCount > 0) {
      procSheet.getRange(2, 1, oldProcRowCount, 18).clearContent();
    }
    props.setProperty('PROC_A2_LAST', currentA2);
    return;
  }

  var headers = procSheet.getRange('D1:J1').getDisplayValues()[0].map(function(v) { return norm(v); });

  // ==========================================
  // WRITE-FIRST PATTERN: Write BEFORE clearing
  // ==========================================

  if (forceRecalc) {
    var outputDR = buildProcessedRows_(sortedAC, null, true, sumF, sumE, divisor, headers);

    if (newProcRowCount > 0) {
      procSheet.getRange(2, 1, newProcRowCount, 3).setValues(sortedAC);
    }

    if (outputDR.length > 0) {
      procSheet.getRange(2, 4, outputDR.length, 15).setValues(outputDR);
    }

    if (newProcRowCount < oldProcRowCount) {
      var orphanedRows = oldProcRowCount - newProcRowCount;
      if (orphanedRows > 0) {
        procSheet.getRange(newProcRowCount + 2, 1, orphanedRows, 18).clearContent();
      }
    }

    props.setProperty('PROC_A2_LAST', currentA2);
    Logger.log('A2 changed or row count shifted. Rebuilt D2:R for ' + outputDR.length + ' rows.');
    return;
  }

  var existingRows = procSheet.getRange(2, 4, newProcRowCount, 15).getValues();

  var rowsToUpdate = [];
  for (var i = 0; i < newProcRowCount; i++) {
    var a = norm(sortedAC[i][0]);
    if (!a) continue;

    var rowHasBlank = false;
    for (var col = 0; col < existingRows[i].length; col++) {
      if (isBlank(existingRows[i][col])) {
        rowHasBlank = true;
        break;
      }
    }
    if (rowHasBlank) rowsToUpdate.push(i);
  }

  if (rowsToUpdate.length === 0) {
    props.setProperty('PROC_A2_LAST', currentA2);
    Logger.log('No blank rows to process.');
    return;
  }

  var blocks = [];
  var blockStart = rowsToUpdate[0];
  var blockPrev = rowsToUpdate[0];

  for (var i = 1; i < rowsToUpdate.length; i++) {
    var idx = rowsToUpdate[i];
    if (idx === blockPrev + 1) {
      blockPrev = idx;
    } else {
      blocks.push([blockStart, blockPrev]);
      blockStart = idx;
      blockPrev = idx;
    }
  }
  blocks.push([blockStart, blockPrev]);

  for (var b = 0; b < blocks.length; b++) {
    var startIdx = blocks[b][0];
    var endIdx = blocks[b][1];
    var blockLen = endIdx - startIdx + 1;
    var blockProcData = sortedAC.slice(startIdx, endIdx + 1);
    var blockExisting = existingRows.slice(startIdx, endIdx + 1);

    var output = buildProcessedRows_(blockProcData, blockExisting, false, sumF, sumE, divisor, headers);
    procSheet.getRange(startIdx + 2, 4, blockLen, 15).setValues(output);
  }

  props.setProperty('PROC_A2_LAST', currentA2);
  Logger.log('Processed only rows with blanks in D:R. Updated ' + rowsToUpdate.length + ' rows in ' + blocks.length + ' block(s).');
}