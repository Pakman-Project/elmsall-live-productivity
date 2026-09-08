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
// Mirrors SITES in JsState. A link can only ask for a building that exists.
var DEEP_LINK_SITES_ = ['all', 'e3', 'e1e2'];

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

  // ?site=all|e3|e1e2 — which building the dashboard is scoped to.
  var site = sanitizeParam_(e, 'site').toLowerCase();
  t.deepSite = (DEEP_LINK_SITES_.indexOf(site) !== -1) ? site : '';

  // The page lives in a sandboxed iframe and cannot see the address bar, so the
  // "Copy link" button needs the real web-app URL handed to it.
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  t.webAppUrl = url;

  return t.evaluate()
    .setTitle('Elmsall Live Productivity')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

var CONFIG = {
  SHEET_NAME: 'Front',
  SOURCE_SHEET_NAME: 'Processed Data (15mins)',
  THRESHOLD_CELL: 'A2',
  DATETIME_CELL: 'B2',
  LINKS_SHEET_NAME: 'Links',
  TM_SHEET_NAME: 'TM List'
};

// 'TM List' holds one row per operator from row 3 down: B = bonus number,
// C = their team manager, D = that manager's email.
var TM_FIRST_ROW_ = 3;
var TM_FIRST_COL_ = 2;   // column B
var TM_NUM_COLS_ = 3;    // B:D

/**
 * Bonus number -> { tm, email }, for the hover tooltip on every bonus number
 * in the dashboard.
 *
 * Keys are upper-cased and trimmed to match how bonus codes are canonicalised
 * everywhere else in the pipeline (upper(trim(...)) in the notebook's SQL, and
 * correctNameValue_ on the Data tab). A directory keyed on "mf5" would simply
 * never match a dashboard showing "MF5".
 *
 * Returns {} rather than throwing if the tab is absent - the tooltip is a nice
 * thing to have, not a reason for the whole dashboard to fail to load.
 */
function readTmDirectory_(ss) {
  try {
    var sheet = ss.getSheetByName(CONFIG.TM_SHEET_NAME);
    if (!sheet) return {};

    var lastRow = sheet.getLastRow();
    if (lastRow < TM_FIRST_ROW_) return {};

    var rows = sheet
      .getRange(TM_FIRST_ROW_, TM_FIRST_COL_, lastRow - TM_FIRST_ROW_ + 1, TM_NUM_COLS_)
      .getDisplayValues();

    var out = {};
    for (var i = 0; i < rows.length; i++) {
      var bonus = String(rows[i][0] === null || rows[i][0] === undefined ? '' : rows[i][0]).trim().toUpperCase();
      if (!bonus) continue;
      var tm = String(rows[i][1] === null || rows[i][1] === undefined ? '' : rows[i][1]).trim();
      var email = String(rows[i][2] === null || rows[i][2] === undefined ? '' : rows[i][2]).trim();
      if (!tm && !email) continue;
      // First entry wins. A duplicated bonus number is a data-entry slip, and
      // silently taking the last one makes which manager is shown depend on row
      // order, which nobody would think to check.
      if (out[bonus]) continue;
      out[bonus] = { tm: tm, email: email };
    }
    return out;
  } catch (err) {
    Logger.log('readTmDirectory_: ' + err.message);
    return {};
  }
}

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

  // Called twice per dashboard load (once by the client for the date picker,
  // once internally by getDashboardData to find yesterday's archive), and the
  // Links sheet changes at most once a day — so a short cache removes the
  // duplicate read entirely. The payload grows by one entry per archived day
  // and has no ceiling, hence the chunked cache helpers.
  var _hit = cacheGetLarge_('archiveLinks_v2');
  if (_hit) {
    try { return JSON.parse(_hit); } catch (e) {}
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

    // Every dated link the sheet holds, however old. This used to stop at 14
    // days, which quietly put a fortnight's ceiling on how far back anyone
    // could look even when the archive itself went back further.
    if (dateObj && formattedName && url && !seenNames[formattedName]) {
      uniqueLinks.push({ name: formattedName, url: url, date: dateObj });
      seenNames[formattedName] = true;
    }
  }

  uniqueLinks.sort(function(a, b) {
    return b.date.getTime() - a.date.getTime();
  });

  var _out = uniqueLinks.map(function(l) {
    return { name: l.name, url: l.url };
  });
  cachePutLarge_('archiveLinks_v2', JSON.stringify(_out), 300);
  return _out;
}

// ─────────────────────────────────────────────
// Processed Data (15mins) column mapping.
//
// The tab has grown twice — 7 work areas, then 9, now 10 — and every archive is
// a frozen copy of whichever layout was current the day it was cut. Offsets
// were previously hard-coded per version and chosen by sniffing L1, which meant
// each new area needed a third set of magic numbers and left the sniff test
// increasingly arbitrary.
//
// The header row is the sheet's own description of its layout, so it is read
// and each area located by name instead. A file holding any subset of these
// columns, in any order, is then read correctly, and the next new area needs
// one line here rather than a new layout version.
//
// stdHeader is the report name the notebook writes into the standard-hours
// block; volHeader is that area's volume column. An area whose columns are
// absent from a file reads as 0 — which is what a pre-BCR archive should show.
// ─────────────────────────────────────────────
var PROC_TOTAL_HEADER_ = 'Sum of Std hrs';

var PROC_AREA_COLUMNS_ = [
  { key: 'pie',              stdHeader: 'D.Analysis - OSR PiE',            volHeader: 'Volume - PiE' },
  { key: 'topUp',            stdHeader: 'D.Analysis - OSR Topup',          volHeader: 'Volume - Top Up' },
  { key: 'e3Packing',        stdHeader: 'D.Analysis - E3 Packing',         volHeader: 'Volume - E3 Packing' },
  { key: 'parcelSortation',  stdHeader: 'D.Analysis - Parcel Sortation',   volHeader: 'Volume - Parcel Sortation' },
  { key: 'parcelInduct',     stdHeader: 'D.Analysis - Parcel Induct',      volHeader: 'Volume - Parcel Induct' },
  { key: 'inboundDecanting', stdHeader: 'D.Analysis - Inbound Decanting',  volHeader: 'Volume - Inbound Decanting' },
  { key: 'osrDecanting',     stdHeader: 'D.Analysis - OSR Decanting',      volHeader: 'Volume - OSR Decanting' },
  { key: 'bcrInducting',     stdHeader: 'D.Analysis - BCR Inducting',      volHeader: 'Volume - BCR Inducting' },
  { key: 'e1e2Inducting',    stdHeader: 'D.Analysis - E1/E2 Inducting',    volHeader: 'Volume - E1/E2 Inducting' },
  { key: 'sorter6Packing',   stdHeader: 'D.Analysis - Sorter 6 Packing',   volHeader: 'Volume - Sorter 6 Packing' },
  // Three zones of one Online Picking source; separate areas on the dashboard.
  // volHeaderWas: the volume header follows the display label, and these three
  // were renamed "Online Picking - X" -> "X - Online Picking". Archives are
  // frozen copies carrying the old header, so the old spelling is still
  // accepted — without it every archived day would show these areas as zero.
  { key: 'onlinePickingDrive', stdHeader: 'D.Analysis - Online Picking - Drive', volHeader: 'Volume - Drive - Online Picking',
    volHeaderWas: ['Volume - Online Picking - Drive'] },
  { key: 'onlinePickingWay',   stdHeader: 'D.Analysis - Online Picking - Way',   volHeader: 'Volume - Way - Online Picking',
    volHeaderWas: ['Volume - Online Picking - Way'] },
  { key: 'onlinePickingE3',    stdHeader: 'D.Analysis - Online Picking - E3',    volHeader: 'Volume - E3 - Online Picking',
    volHeaderWas: ['Volume - Online Picking - E3'] },
  { key: 'e3Bpp',              stdHeader: 'D.Analysis - E3 BPP',                 volHeader: 'Volume - E3 BPP' },
  { key: 'e1e2Bpp',            stdHeader: 'D.Analysis - E1/E2 BPP',              volHeader: 'Volume - E1/E2 BPP' },
  { key: 'rspsTopUp',        stdHeader: 'D.Analysis - RSPS Top Up',        volHeader: 'Volume - RSPS Top Up' },
  { key: 'rspsPick',         stdHeader: 'D.Analysis - RSPS Pick',          volHeader: 'Volume - RSPS Pick' },
  { key: 'ispsTopUp',        stdHeader: 'D.Analysis - ISPS Top Up',        volHeader: 'Volume - ISPS Top Up' },
  { key: 'ispsPick',         stdHeader: 'D.Analysis - ISPS Pick',          volHeader: 'Volume - ISPS Pick' },
  { key: 'sorter6ItemInduct',   stdHeader: 'D.Analysis - Sorter 6 Item Induct',   volHeader: 'Volume - Sorter 6 Item Induct' },
  { key: 'sorter6ParcelInduct', stdHeader: 'D.Analysis - Sorter 6 Parcel Induct', volHeader: 'Volume - Sorter 6 Parcel Induct' },
  { key: 'forwardTpa',         stdHeader: 'D.Analysis - Forward TPA',            volHeader: 'Volume - Forward TPA' },
  { key: 'tpRetail',           stdHeader: 'D.Analysis - TP Retail',              volHeader: 'Volume - TP Retail' },
  { key: 'rtf',                stdHeader: 'D.Analysis - RTF',                    volHeader: 'Volume - RTF' }
];

// Headers are typed and re-typed by hand on ten-odd archive files, so they are
// matched on a normalised form rather than exactly: stray double spaces and
// casing differences should not silently zero a column.
function normaliseProcHeader_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildProcColumnMap_(headerRow) {
  var idx = {};
  for (var c = 0; c < headerRow.length; c++) {
    var name = normaliseProcHeader_(headerRow[c]);
    // First occurrence wins: a duplicated header is far more likely to be a
    // stray copy off to the right than the real column.
    if (name && !idx.hasOwnProperty(name)) idx[name] = c;
  }

  var totalIdx = idx[normaliseProcHeader_(PROC_TOTAL_HEADER_)];
  var map = { total: (totalIdx === undefined) ? -1 : totalIdx, areas: [] };

  // The current name first, then any it used to go by — so renaming an area
  // does not blank it out on every archive cut before the rename.
  function locate(primary, formerly) {
    var hit = idx[normaliseProcHeader_(primary)];
    if (hit !== undefined) return hit;
    for (var f = 0; formerly && f < formerly.length; f++) {
      hit = idx[normaliseProcHeader_(formerly[f])];
      if (hit !== undefined) return hit;
    }
    return -1;
  }

  for (var i = 0; i < PROC_AREA_COLUMNS_.length; i++) {
    var a = PROC_AREA_COLUMNS_[i];
    map.areas.push({
      key: a.key,
      std: locate(a.stdHeader, a.stdHeaderWas),
      vol: locate(a.volHeader, a.volHeaderWas)
    });
  }
  return map;
}

// Fallback for a file whose header row is missing or has been renamed past
// recognition. Reproduces exactly what the old positional reader did, so such a
// file keeps rendering as it did before rather than coming back empty.
// v2: std D:L (3-11), total M (12), volumes N:V (13-21).
// v1: std D:J (3-9),  total K (10), volumes L:R (11-17).
function legacyProcColumnMap_(isV2) {
  var positional = ['pie', 'topUp', 'e3Packing', 'parcelSortation', 'parcelInduct',
                    'inboundDecanting', 'osrDecanting', 'bcrInducting', 'e1e2Inducting'];
  var n = isV2 ? 9 : 7;
  var total = 3 + n;
  var map = { total: total, areas: [] };

  for (var i = 0; i < PROC_AREA_COLUMNS_.length; i++) {
    var key = PROC_AREA_COLUMNS_[i].key;
    var pos = positional.indexOf(key);
    var present = pos !== -1 && pos < n;
    map.areas.push({
      key: key,
      std: present ? (3 + pos) : -1,
      vol: present ? (total + 1 + pos) : -1
    });
  }
  return map;
}

function readProcRows_(sheet, lastRow) {
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  var map = buildProcColumnMap_(header);

  if (map.total < 0) {
    // No recognisable total column: fall back to the old L1 sniff.
    map = legacyProcColumnMap_(String(header[11] || '').indexOf('D.Analysis') === 0);
  }

  return {
    vals: sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, map.total + 1)).getValues(),
    // Only columns A:C are ever needed as display values — buildSideEntry_ reads
    // dispsRow[0] (time range) and dispsRow[2] (bonus) and takes every other
    // field from vals. Reading 3 columns instead of the full width removes most
    // of a second full-sheet read per call.
    disps: sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues(),
    map: map
  };
}

function buildSideEntry_(valsRow, dispsRow, map) {
  var entry = {
    timeRange: String(dispsRow[0]).trim(),
    bonus: String(dispsRow[2]).trim(),
    value: map.total >= 0 ? toNumber_(valsRow[map.total]) : 0
  };
  for (var i = 0; i < map.areas.length; i++) {
    var a = map.areas[i];
    entry[a.key + 'Std'] = a.std >= 0 ? toNumber_(valsRow[a.std]) : 0;
    entry[a.key] = a.vol >= 0 ? toNumber_(valsRow[a.vol]) : 0;
  }
  return entry;
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
        // The area COUNT is in the key, not a hand-bumped version number.
        // Entries cached by a previous build carry no field for an area added
        // since, so yesterday's rows read as blank for it until they expired -
        // which happened when Sorter 6 Packing arrived, and again when the two
        // Sorter 6 inducts did, because bumping v1 to v2 was a step someone had
        // to remember. Keying on the count makes adding an area invalidate the
        // cache by itself.
        yCacheKey = 'ydayArch_v3_' + PROC_AREA_COLUMNS_.length + '_' + yesterdayStr +
                    '_' + yKeys.length + '_' + yKeys[0] + '_' + yKeys[yKeys.length - 1];
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
              var aEntry = buildSideEntry_(aRead.vals[i], aRead.disps[i], aRead.map);
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
        var lEntry = buildSideEntry_(lRead.vals[i], lRead.disps[i], lRead.map);
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
        var entry = buildSideEntry_(sRead.vals[i], sRead.disps[i], sRead.map);
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
    note: noteVal,
    tmDirectory: readTmDirectory_(ss)
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
