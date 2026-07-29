function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Deep-link + tour parameters are read here and sanitised at this boundary, so
// nothing straight off the URL is ever interpolated into the page. Each is
// exposed to the template as its own plain string rather than as JSON, which
// avoids any escaping question inside the <script> block.
var DEEP_LINK_PAGES_ = ['overall', 'volume', 'bonus', 'data'];
// Mirrors the <option> values on the Hours Range and Time Window dropdowns. A
// link cannot request a setting the UI does not offer.
var DEEP_LINK_HOURS_ = ['3', '6', '9', '12', '24'];
var DEEP_LINK_WINDOWS_ = ['15', '30', '60'];

function sanitizeParam_(e, name) {
  return (e && e.parameter && e.parameter[name]) ? String(e.parameter[name]) : '';
}

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Web - Index');

  // ?tour=1 forces the guided tour to run; ?tour=reset also clears the stored
  // "already seen" flag first, reproducing a genuine first visit.
  t.forceTour = sanitizeParam_(e, 'tour');

  // ?page=overall|volume|bonus|data — anything else is ignored.
  var page = sanitizeParam_(e, 'page').toLowerCase();
  t.deepPage = (DEEP_LINK_PAGES_.indexOf(page) !== -1) ? page : '';

  // ?bonus=A1B,C2D — bonus codes are alphanumeric, so everything else is
  // stripped rather than trusted.
  t.deepBonus = sanitizeParam_(e, 'bonus').toUpperCase().replace(/[^A-Z0-9,]/g, '');

  // ?date=YYYY-MM-DD — must match exactly, or it is dropped.
  var date = sanitizeParam_(e, 'date');
  t.deepDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';

  // ?hours= and ?window= — the two time controls. Whitelisted against the exact
  // option values rather than range-checked, so a link can only ever ask for a
  // setting the dropdowns actually offer.
  var hours = sanitizeParam_(e, 'hours');
  t.deepHours = (DEEP_LINK_HOURS_.indexOf(hours) !== -1) ? hours : '';

  var win = sanitizeParam_(e, 'window');
  t.deepWindow = (DEEP_LINK_WINDOWS_.indexOf(win) !== -1) ? win : '';

  // The page lives in a sandboxed iframe and cannot see the address bar, so the
  // "Copy link" button needs the real web-app URL handed to it.
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  t.webAppUrl = url;

  return t.evaluate()
    .setTitle('E3 Live Productivity')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var CONFIG = {
  SHEET_NAME: 'Front',
  SOURCE_SHEET_NAME: 'Processed Data (15mins)',
  THRESHOLD_CELL: 'A2',
  DATETIME_CELL: 'B2',
  LINKS_SHEET_NAME: 'Links'
};

// ─────────────────────────────────────────────
// CacheService helpers.
// A single cache value is capped at 100KB, so larger JSON payloads are split
// across numbered chunk keys. Everything is wrapped in try/catch and fails
// SOFT: a cache miss or error just falls back to reading the sheet, so caching
// can never break a load — worst case it's as slow as before.
// ─────────────────────────────────────────────
var CACHE_CHUNK_SIZE_ = 90000;
var CACHE_MAX_TOTAL_ = 1800000;  // don't attempt to cache absurdly large payloads

function cachePutLarge_(key, str, ttlSeconds) {
  try {
    if (!str || str.length > CACHE_MAX_TOTAL_) return false;
    var cache = CacheService.getScriptCache();
    var n = Math.ceil(str.length / CACHE_CHUNK_SIZE_);
    var map = {};
    for (var i = 0; i < n; i++) {
      map[key + '_' + i] = str.substring(i * CACHE_CHUNK_SIZE_, (i + 1) * CACHE_CHUNK_SIZE_);
    }
    map[key + '_n'] = String(n);
    cache.putAll(map, ttlSeconds);
    return true;
  } catch (e) {
    Logger.log('cachePutLarge_ failed: ' + e.message);
    return false;
  }
}

function cacheGetLarge_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key + '_n'));
    if (!n || isNaN(n)) return null;
    var keys = [];
    for (var i = 0; i < n; i++) { keys.push(key + '_' + i); }
    var got = cache.getAll(keys);
    var out = '';
    for (var j = 0; j < n; j++) {
      var part = got[key + '_' + j];
      // Chunks can expire independently — if any is gone the payload is
      // unusable, so treat it as a miss rather than returning truncated JSON.
      if (part === null || part === undefined) return null;
      out += part;
    }
    return out;
  } catch (e) {
    return null;
  }
}



function getArchiveLinks() {

  // Called twice per dashboard load (once by the client for the History
  // dropdown, once internally by getDashboardData to find yesterday's archive),
  // and the Links sheet changes at most once a day — so a short cache removes
  // the duplicate read entirely. Payload is small (≤14 links), no chunking.
  var _linksCache = null;
  try { _linksCache = CacheService.getScriptCache(); } catch (e) {}
  if (_linksCache) {
    var _hit = _linksCache.get('archiveLinks_v1');
    if (_hit) {
      try {
        var _parsed = JSON.parse(_hit);
        return _parsed;
      } catch (e) {}
    }
  }

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

  var _out = uniqueLinks.map(function(l) {
    return { name: l.name, url: l.url };
  });
  if (_linksCache) {
    try { _linksCache.put('archiveLinks_v1', JSON.stringify(_out), 300); } catch (e) {}
  }
  return _out;
}

// ─────────────────────────────────────────────
// Helpers: read Processed Data (15mins) rows, handling both layouts.
// v2 (current): std D:L (idx 3-11), total M (idx 12), volumes N:V (idx 13-21).
// v1 (legacy archives, pre BCR/E1-E2): std D:J (3-9), total K (10), volumes L:R (11-17).
// Detected via L1: in v2 it is the last "D.Analysis - ..." header.
// ─────────────────────────────────────────────
function readProcRows_(sheet, lastRow) {
  var l1 = String(sheet.getRange('L1').getDisplayValue() || '');
  var isV2 = l1.indexOf('D.Analysis') === 0;
  var cols = isV2 ? 22 : 18;
  return {
    vals: sheet.getRange(2, 1, lastRow - 1, cols).getValues(),
    // Only columns A:C are ever needed as display values — buildSideEntry_ reads
    // dispsRow[0] (time range) and dispsRow[2] (bonus) and takes every other
    // field from vals, in BOTH the v1 and v2 layouts. Reading 3 columns instead
    // of the full 18/22 removes most of a second full-sheet read per call.
    disps: sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues(),
    isV2: isV2
  };
}

function buildSideEntry_(valsRow, dispsRow, isV2) {
  if (isV2) {
    return {
      timeRange: String(dispsRow[0]).trim(),
      bonus: String(dispsRow[2]).trim(),
      value: toNumber_(valsRow[12]),
      pieStd: toNumber_(valsRow[3]),
      topUpStd: toNumber_(valsRow[4]),
      e3PackingStd: toNumber_(valsRow[5]),
      parcelSortationStd: toNumber_(valsRow[6]),
      parcelInductStd: toNumber_(valsRow[7]),
      inboundDecantingStd: toNumber_(valsRow[8]),
      osrDecantingStd: toNumber_(valsRow[9]),
      bcrInductingStd: toNumber_(valsRow[10]),
      e1e2InductingStd: toNumber_(valsRow[11]),
      pie: toNumber_(valsRow[13]),
      topUp: toNumber_(valsRow[14]),
      e3Packing: toNumber_(valsRow[15]),
      parcelSortation: toNumber_(valsRow[16]),
      parcelInduct: toNumber_(valsRow[17]),
      inboundDecanting: toNumber_(valsRow[18]),
      osrDecanting: toNumber_(valsRow[19]),
      bcrInducting: toNumber_(valsRow[20]),
      e1e2Inducting: toNumber_(valsRow[21])
    };
  }
  return {
    timeRange: String(dispsRow[0]).trim(),
    bonus: String(dispsRow[2]).trim(),
    value: toNumber_(valsRow[10]),
    pieStd: toNumber_(valsRow[3]),
    topUpStd: toNumber_(valsRow[4]),
    e3PackingStd: toNumber_(valsRow[5]),
    parcelSortationStd: toNumber_(valsRow[6]),
    parcelInductStd: toNumber_(valsRow[7]),
    inboundDecantingStd: toNumber_(valsRow[8]),
    osrDecantingStd: toNumber_(valsRow[9]),
    bcrInductingStd: 0,
    e1e2InductingStd: 0,
    pie: toNumber_(valsRow[11]),
    topUp: toNumber_(valsRow[12]),
    e3Packing: toNumber_(valsRow[13]),
    parcelSortation: toNumber_(valsRow[14]),
    parcelInduct: toNumber_(valsRow[15]),
    inboundDecanting: toNumber_(valsRow[16]),
    osrDecanting: toNumber_(valsRow[17]),
    bcrInducting: 0,
    e1e2Inducting: 0
  };
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
    // An attempt to derive lastRefresh from the last data row used to sit here,
    // guarded by a parse that could never succeed — so an archive's lastRefresh
    // has always come from Front!B2 below. Removed rather than fixed: making it
    // parse would change which 24h window every archive view loads.
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
    // The instanceof test is what the removed block above used to imply. Without
    // it, a truthy non-Date in Front!B2 (a stray string, say) would reach
    // .getTime() and throw rather than falling back to now.
    if (!lastRefresh || !(lastRefresh instanceof Date) || isNaN(lastRefresh.getTime())) {
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
      // Opening + fully parsing yesterday's archive spreadsheet is the single
      // most expensive thing in this function, and it is pure waste: that file
      // is already archived (immutable), and every viewer/auto-refresh inside
      // the same 15-minute window needs the exact same slice of it.
      //
      // So cache the FILTERED entries. The key pins both the archive date and
      // the exact yesterday-window bounds, so when the rolling 24h window moves
      // the key changes and a stale slice can never be reused. TTL is kept to
      // 15 min so that an archive still being written just after midnight
      // self-heals quickly rather than being pinned all day.
      var yKeys = Object.keys(yesterdayTRSet);
      var yEntries = null;
      var yCacheKey = null;

      if (yKeys.length) {
        yKeys.sort();
        yCacheKey = 'ydayArch_v1_' + yesterdayStr + '_' + yKeys.length +
                    '_' + yKeys[0] + '_' + yKeys[yKeys.length - 1];
        var yCached = cacheGetLarge_(yCacheKey);
        if (yCached) {
          try {
            yEntries = JSON.parse(yCached);
          } catch (e) { yEntries = null; }
        }
      }

      if (!yEntries) {
        yEntries = [];
        try {
          var archiveSS = SpreadsheetApp.openByUrl(yesterdayArchiveUrl);
          var archiveSource = archiveSS.getSheetByName(CONFIG.SOURCE_SHEET_NAME);
          if (archiveSource && archiveSource.getLastRow() >= 2) {
            var aRead = readProcRows_(archiveSource, archiveSource.getLastRow());

            for (var i = 0; i < aRead.vals.length; i++) {
              var aEntry = buildSideEntry_(aRead.vals[i], aRead.disps[i], aRead.isV2);
              if (!yesterdayTRSet[aEntry.timeRange]) continue;
              if (!aEntry.bonus || aEntry.value <= 0) continue;
              yEntries.push(aEntry);
            }
          }
          if (yCacheKey) { cachePutLarge_(yCacheKey, JSON.stringify(yEntries), 900); }
        } catch (e) {
          Logger.log('Yesterday archive read failed (' + yesterdayStr + '): ' + e.message);
        }
      }

      for (var yi = 0; yi < yEntries.length; yi++) {
        var yEnt = yEntries[yi];
        archiveDataMap[yEnt.timeRange + '||' + yEnt.bonus] = yEnt;
        bonusSet[yEnt.bonus] = true;
      }
    }

    // ── Step 2: Read from live file ──
    if (sourceSheet.getLastRow() >= 2) {
      var lRead = readProcRows_(sourceSheet, sourceSheet.getLastRow());

      for (var i = 0; i < lRead.vals.length; i++) {
        var lEntry = buildSideEntry_(lRead.vals[i], lRead.disps[i], lRead.isV2);
        if (!lEntry.bonus || lEntry.value <= 0) continue;

        var lKey = lEntry.timeRange + '||' + lEntry.bonus;

        if (yesterdayTRSet[lEntry.timeRange]) {
          // For yesterday ranges: only use live if archive does NOT have this row
          if (!archiveDataMap[lKey]) {
            rawSideData.push(lEntry);
            bonusSet[lEntry.bonus] = true;
          }
          // If archive has it, archive wins — skip the live row
        } else if (todayTRSet[lEntry.timeRange]) {
          // Today ranges: always take from live
          rawSideData.push(lEntry);
          bonusSet[lEntry.bonus] = true;
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
      var sRead = readProcRows_(sourceSheet, sourceSheet.getLastRow());
      var timeSet = {};

      for (var t = 0; t < timeRanges.length; t++) {
        timeSet[timeRanges[t]] = true;
      }

      for (var i = 0; i < sRead.vals.length; i++) {
        var entry = buildSideEntry_(sRead.vals[i], sRead.disps[i], sRead.isV2);
        if (timeSet[entry.timeRange] && entry.bonus && entry.value > 0) {
          rawSideData.push(entry);
          bonusSet[entry.bonus] = true;
        }
      }
    }
  }

  // ── Hold the timeline to the newest block that actually HAS data ──────────
  // timeRanges is generated from Front!B2 / wall-clock, which runs ahead of the
  // database: the upstream pipeline publishes a 15-min block roughly 15-30 min
  // after it closes. That made the whole dashboard's time axis roll forward into
  // blocks with no rows yet — empty tail on every chart, empty rows in the data
  // table, and (worst) the "last hour" KPIs silently averaging over empty blocks,
  // which dragged the numbers and their trends down.
  //
  // Trimming the trailing empty blocks here fixes all of those at once and keeps
  // every consumer consistent, because they all derive their windows from
  // timeRanges. Blocks earlier in the day with no data are left in place — only
  // the unpublished tail is removed.
  var presentTR = {};
  for (var pi = 0; pi < rawSideData.length; pi++) { presentTR[rawSideData[pi].timeRange] = true; }
  var newestWithData = -1;
  for (var ti2 = timeRanges.length - 1; ti2 >= 0; ti2--) {
    if (presentTR[timeRanges[ti2]]) { newestWithData = ti2; break; }
  }
  if (newestWithData >= 0 && newestWithData < timeRanges.length - 1) {
    timeRanges = timeRanges.slice(0, newestWithData + 1);
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

// 'Processed Data (15mins)' is built by the Databricks notebook, which derives
// it from the 'Data' tab at the end of every delivery. Apps Script used to
// compute it too - computeProcessedAggregates_, buildProcessedRows_,
// updateProcessedData15mins and forceRebuildProcessedData, around 250 lines -
// which made two independent implementations of the same pivot, and two
// writers of the same tab. Both are gone; git history has them if the
// arrangement is ever reversed.
//
// This stub is NOT dead code: it stays so that a leftover time trigger still
// pointing at the old name fails harmlessly instead of erroring daily, and so
// that an accidental manual run cannot race the notebook.
function updateProcessedData15mins() {
  Logger.log('updateProcessedData15mins: no-op — Processed Data is built by Databricks.');
}
