function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Deep-link + tour parameters are read here and sanitised at this boundary, so
// nothing straight off the URL is ever interpolated into the page. Each is
// exposed to the template as its own plain string rather than as JSON, which
// avoids any escaping question inside the <script> block.
var DEEP_LINK_PAGES_ = ['overall', 'volume', 'bonus', 'os', 'data'];
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
// Cached for six hours. Measured at 1,031ms on the live file - 23% of what a
// load costs once the wide-tab reads are gone - for a bonus-to-manager
// directory that is edited by hand and changes daily at most. There is no
// window to pin in the key, unlike the archive slice, so a plain version is
// enough; bump it if the shape of an entry ever changes.
var TM_CACHE_KEY_ = 'tmDirectory_v1';
var TM_CACHE_TTL_ = 6 * 60 * 60;

function readTmDirectory_(ss) {
  var cached = cacheGetLarge_(TM_CACHE_KEY_);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  var built = readTmDirectoryUncached_(ss);
  // Only cache a directory that actually has something in it. An empty {} is
  // what a missing tab returns, and pinning that for six hours would turn a
  // transient read failure into an afternoon with no manager names.
  for (var probe in built) {
    if (built.hasOwnProperty(probe)) {
      cachePutLarge_(TM_CACHE_KEY_, JSON.stringify(built), TM_CACHE_TTL_);
      break;
    }
  }
  return built;
}

function readTmDirectoryUncached_(ss) {
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
// Raised from 1,800,000, which was refusing every write it was ever asked to
// make. Yesterday's slice of a 24h window on this site is ~20,000 rows, and
// even joined by '|' that is 2.16MB - so the archive cache had never once
// populated, and every load paid to re-open and re-read yesterday's whole
// archive file. 3,000,000 is 34 chunks, which putAll handles in one call.
var CACHE_MAX_TOTAL_ = 3000000;

// ── Load timing ─────────────────────────────────────────────────────────────
// There was no instrumentation of any kind in here, which made "the dashboard
// feels slow - what is it doing?" a question nobody could answer, so every
// answer was a guess. One line per read into Logger.log: visible in Apps
// Script > Executions, invisible to anybody using the dashboard, and the same
// mechanism this file already uses for its error logs.
//
// CELLS are reported alongside the milliseconds on purpose. getValues() costs
// roughly in proportion to the cells it marshals across the Sheets boundary
// rather than to the rows, so rows alone cannot tell a wide tab from a slow
// one - and "is it worth reading one column instead of fifty-four" is exactly
// the question this has to answer.
function loadTimer_() {
  var t0 = Date.now();
  var last = t0;
  var parts = [];
  var line = '';
  return {
    // A read that just finished. `cells` optional - omit it for anything that
    // is not a range read.
    mark: function (label, cells) {
      var now = Date.now();
      parts.push(label + '=' + (now - last) + 'ms' +
                 (cells ? '/' + cells + 'c' : ''));
      last = now;
      return now;
    },
    // Something worth recording that is not a duration: a cache verdict, a
    // row count, a branch not taken.
    note: function (text) { parts.push(text); },
    // Swallowed on purpose. Instrumentation that can break the thing it
    // measures is worse than no instrumentation, and there is nothing a
    // logging failure could tell the caller that is worth failing a load for.
    done: function (label) {
      line = 'TIMING ' + label + ' TOTAL=' + (Date.now() - t0) + 'ms  ' + parts.join('  ');
      try { Logger.log(line); } catch (e) {}
      return line;
    },
    // The same line, for the payload. Reading Executions means opening the
    // script editor and hunting for the right run; the person actually
    // waiting on a slow load is the one who should be able to see why it was
    // slow, so it goes to their console too.
    line: function () { return line; }
  };
}

function cachePutLarge_(key, str, ttlSeconds) {
  try {
    if (!str) return false;
    // The refusal above this limit used to be silent, which is how a cache
    // that has never once populated looks exactly like a cache that is
    // working: the caller gets `false`, ignores it, and does the expensive
    // thing again on every single load. Logged with BOTH numbers so the size
    // of the gap is visible rather than inferred.
    if (str.length > CACHE_MAX_TOTAL_) {
      Logger.log('CACHE REFUSED ' + key + ': ' + str.length + ' chars, limit ' +
                 CACHE_MAX_TOTAL_ + ' (over by ' + (str.length - CACHE_MAX_TOTAL_) + ')');
      return false;
    }
    Logger.log('CACHE PUT ' + key + ': ' + str.length + ' chars (' +
               Math.round(str.length / CACHE_MAX_TOTAL_ * 100) + '% of limit)');
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

  // B and K in one round trip rather than two. The columns between them are
  // read and discarded, which costs far less than a second call.
  var bk = linksSheet.getRange(2, 2, lastRow - 1, 10).getValues();
  var kValues = bk.map(function (r) { return r[9]; });   // K
  var bValues = bk.map(function (r) { return r[0]; });   // B

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

// OS is not a work area: it carries no volume and no standard hours, so it gets
// no entry above. It is a per-row annotation saying the block was spent on an
// indirect task, which is why a bonus can show 0% and still have been working.
// The spelling — including the space after the slash — must match the notebook's
// PROC_HEADER exactly. Typed differently there, this resolves to -1, every row
// reads os:false, and the feature disappears with no error anywhere.
var PROC_OS_HEADER_ = 'OS/ Indirect';

// The same spell, clipped to the 15-minute block the row is about, as ONE cell
// reading "07:26 - 07:30": a 07:26-08:06 spell reads 07:26-07:30 on the 07:15
// row and 08:00-08:06 on the 08:00 one. The band can then start and stop where
// the indirect work really did, instead of on the quarter-hour either side of
// it, and say the times outright on hover.
//
// One column rather than a pair, because the two halves are never read apart -
// every consumer wants the range - and two columns invited a row carrying a
// start with no finish, which is half a fact and cannot be drawn.
//
// Optional, unlike the two above: every archive cut before this column existed
// has no header to match, it resolves to -1, and a band from such a day simply
// carries no times. Nothing else changes.
var PROC_OS_TIME_HEADER_ = 'OS Time';

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
  var osIdx = idx[normaliseProcHeader_(PROC_OS_HEADER_)];
  var osTimeIdx = idx[normaliseProcHeader_(PROC_OS_TIME_HEADER_)];
  var map = {
    total: (totalIdx === undefined) ? -1 : totalIdx,
    os: (osIdx === undefined) ? -1 : osIdx,
    osTime: (osTimeIdx === undefined) ? -1 : osTimeIdx,
    areas: []
  };

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
  // No OS columns at all on a file old enough to need this fallback.
  var map = { total: total, os: -1, osTime: -1, areas: [] };

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

// ─────────────────────────────────────────────
// The 'Backend' tab — the same rows, one column
//
// Every dashboard read used to come off 'Processed Data (15mins)', 54 columns
// wide. Measured on the live file, that cost FORTY SECONDS of a forty-three
// second load: 2.9 million cells across two spreadsheets, because live mode
// reads yesterday's archive as well. Apps Script's Sheets bridge costs per
// CELL rather than per byte, and 23 of every 24 area columns on a row are
// zero, so nearly all of it was marshalling noughts.
//
// The notebook now writes the identical rows joined by '|' into one column.
// 57× fewer cells for the same information — and the separate A:C
// getDisplayValues read disappears too, because a joined row is already text,
// so what is displayed IS the value.
//
// Row 1 is the header, joined the same way, so this feeds the SAME
// buildProcColumnMap_ as the wide tab. Mapping by header name is what makes
// inserting a work area safe; a positional reader here would have thrown that
// away for no extra gain.
// ─────────────────────────────────────────────
var BACKEND_SHEET_NAME_ = 'backend';   // matched lower-cased
var BACKEND_DELIM_ = '|';

// Reads the Backend tab, or returns null if it cannot be used — in which case
// the caller reads the wide tab exactly as before.
//
// null rather than an exception for three real cases: an archive cut before
// this tab existed, a live file whose notebook has not run since the change,
// and a tab whose header no longer maps. All three have to degrade to the old
// path rather than to an empty dashboard.
function readBackendRows_(ss) {
  var sheets = ss.getSheets();
  var sheet = null;
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName().trim().toLowerCase() === BACKEND_SHEET_NAME_) {
      sheet = sheets[s];
      break;
    }
  }
  if (!sheet) return null;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  // One range, one column, header included. Everything after this is string
  // work in V8, which is orders of magnitude cheaper than a round trip.
  var col = sheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  var map = buildProcColumnMap_(String(col[0][0] || '').split(BACKEND_DELIM_));
  // No recognisable total column means the header is not what this expects.
  // Deliberately NOT falling through to legacyProcColumnMap_: that reader is
  // positional, and guessing positions from a tab we have just failed to
  // understand is how you get a plausible-looking wrong dashboard.
  if (map.total < 0) return null;

  var vals = [];
  for (var r = 1; r < col.length; r++) {
    var line = col[r][0];
    if (!line) continue;
    vals.push(String(line).split(BACKEND_DELIM_));
  }
  return {
    vals: vals,
    // The same array serves as both: a joined row is text throughout, so the
    // display value and the value are the same thing. This is the second
    // full-height read the wide tab needed and this one does not.
    disps: vals,
    map: map,
    header: String(col[0][0] || '').split(BACKEND_DELIM_),
    cells: lastRow
  };
}

// One row -> one delimited line, for the archive cache. Sanitised the same way
// the notebook sanitises: a stray delimiter would shift every field after it
// when the line is split back, and a cache that returns subtly wrong rows is
// far worse than one that misses.
function backendJoin_(row) {
  var out = [];
  for (var i = 0; i < row.length; i++) {
    var s = (row[i] === null || row[i] === undefined) ? '' : String(row[i]);
    out.push(s.indexOf(BACKEND_DELIM_) === -1 ? s : s.split(BACKEND_DELIM_).join('/'));
  }
  return out.join(BACKEND_DELIM_);
}

// Whichever source is available, with the fast one preferred. Every caller of
// readProcRows_ goes through this so the fallback cannot be forgotten at one
// of the three call sites.
function readSourceRows_(ss, sheet, lastRow) {
  var fast = readBackendRows_(ss);
  if (fast) return fast;
  var slow = readProcRows_(sheet, lastRow);
  slow.cells = procCells_(slow);
  slow.fallback = true;
  return slow;
}

function readProcRows_(sheet, lastRow) {
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  var map = buildProcColumnMap_(header);

  if (map.total < 0) {
    // No recognisable total column: fall back to the old L1 sniff.
    // (header is returned below either way, for the archive cache.)
    map = legacyProcColumnMap_(String(header[11] || '').indexOf('D.Analysis') === 0);
  }

  return {
    header: header,
    vals: sheet.getRange(2, 1, lastRow - 1,
                         Math.max(lastCol, map.total + 1, map.os + 1,
                                  map.osTime + 1)).getValues(),
    // Only columns A:C are ever needed as display values — buildSideEntry_ reads
    // dispsRow[0] (time range) and dispsRow[2] (bonus) and takes every other
    // field from vals. Reading 3 columns instead of the full width removes most
    // of a second full-sheet read per call.
    disps: sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues(),
    map: map
  };
}

// The OS column held YES or NO until the approval status moved into it. It now
// carries the status itself - "Approved", "Awaiting Approval", "Rejected", and
// whatever the approval form grows next - with YES still written for a spell
// logged without a verdict against it.
//
// So the test is "anything that is not NO", and deliberately not a match on a
// list of known statuses. Read the other way round, every status nobody
// thought to enumerate here would silently read as "not on OS" and lose the
// band that exists to explain the zero underneath it - which is exactly how
// this column behaved for "Rejected" before today.
//
// Returns the status, or '' for a block that was not on OS at all.
function procOsStatus_(raw) {
  var v = String(raw == null ? '' : raw).trim();
  return (!v || v.toUpperCase() === 'NO') ? '' : v;
}

// The OS Time cell -> { from, to }, or null if it holds nothing usable.
//
// Both halves or neither: half a range cannot be drawn as one, and a tooltip
// reading "07:26 - " is worse than no tooltip. A cell that is empty, or that
// holds something this does not recognise, reads as no times at all - which is
// what an archive cut before the column existed also reads as, so the two
// cases need no separate handling.
function procOsSpan_(raw) {
  if (raw == null) return null;
  var m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  return {
    from: ('0' + m[1]).slice(-2) + ':' + m[2],
    to: ('0' + m[3]).slice(-2) + ':' + m[4]
  };
}

// ─────────────────────────────────────────────
// The OS log -> the OS page
//
// Read straight from the log rather than from the pivot. The pivot keeps only
// that a block WAS indirect and what was decided about it; the OS page is
// about everything else the form captured - which department, which job, who
// authorised it, who deployed them, who they report to.
//
// Columns, A-indexed, into the 20 that "Spreadsheet - OS Log.js" writes:
//
//   A Date   B Bonus   E Department   F Job Type   H Start   I Finish
//   K TM Authorising   N Deployed by   O Reports to   Q Record Status
//   R Site   S Zone
//
// Those positions are NOT stable across edits to that script: it selects
// source columns by index into a list, so dropping one shifts every output
// column after it - which has happened once already, when the log went from
// 25 columns to 20. A wrong index here reads a POPULATED cell, so the failure
// is a page of plausible nonsense rather than an error anybody sees. The same
// indices are pinned from the other side in tools/test_oslog.js.
// ─────────────────────────────────────────────
var OS_LOG_SHEET_NAME_ = 'os log';   // matched lower-cased; see readOsLogRows_
var OS_LOG_FIRST_ROW_ = 7;           // 1-6 are the source URLs and headings
var OS_LOG_WIDTH_ = 20;              // A:T
var OS_LOG_COLS_ = {
  date: 0, bonus: 1, dept: 4, job: 5, start: 7, finish: 8,
  auth: 10, deployedBy: 13, reportsTo: 14, status: 16, site: 17, zone: 18,
  // Which tab of the source workbook the row came from, written as a literal
  // by 'Spreadsheet - OS Log.js'. Only the Open tab marks itself - the two
  // that produce finishable spells leave it as whatever they mapped there -
  // so this is read as "is it the string Open", not as a name to display.
  source: 19
};
// A spell the operative started and has not finished. No finish time, so it
// can never be placed on a clock; the OS page lists these to be chased rather
// than filing them with the rows that are simply wrong.
var OS_SOURCE_OPEN_ = 'Open';

// Cells the last readOsLogRows_ call marshalled. A module-level count rather
// than a return value, because the function's contract is rows and skips and
// this is only here to be measured - see loadTimer_.
var osLogCellsRead_ = 0;

function pad2Os_(n) { return ('0' + n).slice(-2); }

// The Date cell -> "dd/mm/yyyy", or '' when it is not a date this understands.
//
// Matched on the PARSED value rather than on the cell's text, because the
// display format is a formatting choice somebody can change: a column showing
// "9/9/2026" instead of "09/09/2026" would otherwise drop every row, and the
// page would come back empty with nothing to say why.
function osLogDateKey_(v) {
  if (v instanceof Date) {
    return pad2Os_(v.getDate()) + '/' + pad2Os_(v.getMonth() + 1) + '/' + v.getFullYear();
  }
  var m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(String(v == null ? '' : v).trim());
  return m ? pad2Os_(Number(m[1])) + '/' + pad2Os_(Number(m[2])) + '/' + m[3] : '';
}

// A Start / Finish cell -> "HH:MM", or '' when it holds no usable time.
function osLogTime_(v) {
  if (v instanceof Date) return pad2Os_(v.getHours()) + ':' + pad2Os_(v.getMinutes());
  var m = /^(\d{1,2}):(\d{2})/.exec(String(v == null ? '' : v).trim());
  if (!m) return '';
  var h = Number(m[1]);
  return (h >= 0 && h < 24) ? pad2Os_(h) + ':' + m[2] : '';
}

function osLogCell_(row, i) {
  return String(row.length > i && row[i] != null ? row[i] : '').trim();
}

// Every logged spell on the dates the dashboard's own axis covers.
//
// Filtered to those dates because the log is rebuilt whole from the approval
// forms and holds every day they do: unfiltered, the payload would carry
// months of history to draw one shift. The date BEFORE each is admitted too,
// since the Date column is the PRODUCTION day - which runs 06:00 to 06:00 - so
// a spell starting at 02:00 on the 9th is logged against the 8th.
//
// Returns { rows, skipped, bad }. `bad` NAMES the rows it could not read -
// their sheet row number and what was actually in the cells - because "7
// records could not be read" with no way to find out which seven is a dead
// end. The whole point of saying it is so somebody can go and fix those rows.
//
// Capped, because a log whose Date column has changed shape entirely would
// otherwise return every row as a complaint.
var OS_LOG_MAX_BAD_ = 50;
// The OS page's own entry point, called the first time that page is opened
// rather than on every dashboard load.
//
// Measured at 431ms - about 1% of the old load and 10% of the new one - and
// paid by everyone, including the majority who never open the page. Small, but
// it is the only read on the critical path that nothing on screen needs.
//
// The client passes the dd/mm/yyyy keys it wants, taken from its own
// timeRanges, so this needs no read of its own to work out the window.
function getOsLogRows(dateKeys, archiveUrl) {
  var tm = loadTimer_();
  var want = {};
  var keys = [];
  for (var i = 0; dateKeys && i < dateKeys.length; i++) {
    var k = osLogDateKey_(dateKeys[i]);
    if (k && !want[k]) { want[k] = true; keys.push(k); }
  }
  keys.sort();

  // Keyed on the dates asked for, so a different window cannot be served a
  // stale answer. Short TTL: the log is edited by hand all shift, and somebody
  // checking whether their own spell has been approved yet is exactly who
  // opens this page.
  var cacheKey = 'osLog_v1_' + (archiveUrl ? 'a' : 'l') + '_' + keys.join(',');
  var cached = cacheGetLarge_(cacheKey);
  if (cached) {
    try {
      tm.note('osLogCache=HIT');
      tm.done('OSLOG');
      return JSON.parse(cached);
    } catch (e) {}
  }

  var ss;
  try {
    ss = archiveUrl ? SpreadsheetApp.openByUrl(archiveUrl)
                    : SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    return { rows: [], skipped: 0, bad: [], error: 'Could not open the spreadsheet' };
  }
  tm.mark('open');

  var out = readOsLogRows_(ss, want);
  tm.mark('osLog', osLogCellsRead_);
  tm.note('rows=' + out.rows.length);
  out.timing = tm.done('OSLOG');
  cachePutLarge_(cacheKey, JSON.stringify(out), 300);
  return out;
}

// `want` is a set of dd/mm/yyyy keys, already including the production day
// before each - see osLogWantDates_ on the client, which builds it.
function readOsLogRows_(ss, want) {
  try {
    // "OS log" in the script and "OS Log" in conversation, and getSheetByName
    // matches exactly. Resolved case-insensitively so a capital L one way or
    // the other cannot silently empty the whole page.
    var sheets = ss.getSheets();
    var sheet = null;
    for (var s = 0; s < sheets.length; s++) {
      if (sheets[s].getName().trim().toLowerCase() === OS_LOG_SHEET_NAME_) {
        sheet = sheets[s];
        break;
      }
    }
    if (!sheet) { osLogCellsRead_ = 0; return { rows: [], skipped: 0, bad: [] }; }

    var lastRow = sheet.getLastRow();
    if (lastRow < OS_LOG_FIRST_ROW_) { osLogCellsRead_ = 0; return { rows: [], skipped: 0, bad: [] }; }

    var vals = sheet.getRange(OS_LOG_FIRST_ROW_, 1,
                              lastRow - OS_LOG_FIRST_ROW_ + 1,
                              OS_LOG_WIDTH_).getDisplayValues();
    // The whole log, every load: this is the number that says how much of it
    // is history nobody asked for.
    osLogCellsRead_ = vals.length * OS_LOG_WIDTH_;
    var rows = [];
    var skipped = 0;
    var bad = [];
    // The sheet row, so somebody can go and look at it. Named rather than
    // counted: a count alone cannot be acted on.
    function note(i, r, why) {
      skipped++;
      if (bad.length >= OS_LOG_MAX_BAD_) return;
      // The same shape as a GOOD record, minus what could not be parsed. The
      // page lists these beside the ones the client itself could not place, in
      // one table, and a server reject that came back with half the columns
      // blank looked like a second, worse kind of fault rather than the same
      // kind found earlier.
      bad.push({
        row: OS_LOG_FIRST_ROW_ + i,
        bonus: osLogCell_(r, OS_LOG_COLS_.bonus),
        date: osLogCell_(r, OS_LOG_COLS_.date),
        from: osLogCell_(r, OS_LOG_COLS_.start),
        to: osLogCell_(r, OS_LOG_COLS_.finish),
        job: osLogCell_(r, OS_LOG_COLS_.job),
        auth: osLogCell_(r, OS_LOG_COLS_.auth),
        deployedBy: osLogCell_(r, OS_LOG_COLS_.deployedBy),
        status: osLogCell_(r, OS_LOG_COLS_.status),
        site: osLogCell_(r, OS_LOG_COLS_.site),
        zone: osLogCell_(r, OS_LOG_COLS_.zone),
        source: osLogCell_(r, OS_LOG_COLS_.source),
        why: why
      });
    }
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      var bonus = osLogCell_(r, OS_LOG_COLS_.bonus).toUpperCase();
      var dateKey = osLogDateKey_(osLogCell_(r, OS_LOG_COLS_.date));
      // A blank line in the log is a spacer, not a loss.
      if (!bonus && !dateKey) continue;
      if (!dateKey || !want[dateKey]) {
        // Out of the window is not a failure; unreadable is.
        if (!dateKey) note(i, r, 'the date is not a date');
        continue;
      }
      var from = osLogTime_(osLogCell_(r, OS_LOG_COLS_.start));
      var to = osLogTime_(osLogCell_(r, OS_LOG_COLS_.finish));
      if (!bonus) { note(i, r, 'no bonus number'); continue; }
      if (!from || !to) { note(i, r, !from && !to ? 'no start or finish' : (!from ? 'the start is not a time' : 'the finish is not a time')); continue; }
      rows.push({
        // The sheet row, on EVERY record rather than only on the ones the
        // server itself rejected. The CLIENT drops records too - a shift over
        // 16 hours, a date that parses but is not real - and without this it
        // could count them but not name them, which is how the page came to
        // say "the server could not say which". A record nobody can find is a
        // record nobody can chase.
        row: OS_LOG_FIRST_ROW_ + i,
        date: dateKey,
        bonus: bonus,
        dept: osLogCell_(r, OS_LOG_COLS_.dept),
        job: osLogCell_(r, OS_LOG_COLS_.job),
        from: from,
        to: to,
        auth: osLogCell_(r, OS_LOG_COLS_.auth),
        deployedBy: osLogCell_(r, OS_LOG_COLS_.deployedBy),
        reportsTo: osLogCell_(r, OS_LOG_COLS_.reportsTo),
        status: osLogCell_(r, OS_LOG_COLS_.status),
        site: osLogCell_(r, OS_LOG_COLS_.site),
        zone: osLogCell_(r, OS_LOG_COLS_.zone),
        source: osLogCell_(r, OS_LOG_COLS_.source)
      });
    }
    return { rows: rows, skipped: skipped, bad: bad };
  } catch (e) {
    // Degrade, never fail the load: an unreadable OS log costs the OS page,
    // not the dashboard.
    Logger.log('OS log unreadable: ' + e.message);
    osLogCellsRead_ = 0;
    return { rows: [], skipped: 0, bad: [] };
  }
}

function buildSideEntry_(valsRow, dispsRow, map) {
  var osStatus = map.os >= 0 ? procOsStatus_(valsRow[map.os]) : '';
  var entry = {
    timeRange: String(dispsRow[0]).trim(),
    bonus: String(dispsRow[2]).trim(),
    value: map.total >= 0 ? toNumber_(valsRow[map.total]) : 0,
    os: osStatus !== ''
  };
  // Set only on the rows that have one. This object is JSON-stringified for
  // every row of a full day, so a field on the 99% of rows that are not OS is
  // payload paid for on every poll. YES says nothing that os:true has not
  // already said, so it is not repeated either - and a band with no status to
  // show then renders exactly as it did before statuses existed.
  if (osStatus && osStatus.toUpperCase() !== 'YES') entry.osStatus = osStatus;
  // Same bargain as the status: carried only on the rows that have one, and
  // only when the row is actually on OS. A clip time on a row reading NO would
  // be a leftover from a previous run rather than a fact about this block.
  //
  // Split into two fields here rather than passed on as the one string the
  // sheet holds, because the front end needs the ends apart: the band's left
  // edge is placed from one and its right edge from the other.
  if (entry.os && map.osTime >= 0) {
    var span = procOsSpan_(valsRow[map.osTime]);
    if (span) { entry.osFrom = span.from; entry.osTo = span.to; }
  }
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
  var tm = loadTimer_();

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
  tm.mark('open');

  var threshold = sheet.getRange(CONFIG.THRESHOLD_CELL).getValue();
  var lastRefresh = sheet.getRange(CONFIG.DATETIME_CELL).getValue();
  tm.mark('front');

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
    // Cached 300s, so a slow mark here means the cache missed.
    tm.mark('links');
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
      // The lines to cache, collected as the rows are filtered. Null until a
      // read actually happens, so a cache hit never rewrites what it just read.
      var yLines_ = null;

      if (yKeys.length) {
        yKeys.sort();
        // The area COUNT is in the key, not a hand-bumped version number.
        // Entries cached by a previous build carry no field for an area added
        // since, so yesterday's rows read as blank for it until they expired -
        // which happened when Sorter 6 Packing arrived, and again when the two
        // Sorter 6 inducts did, because bumping v1 to v2 was a step someone had
        // to remember. Keying on the count makes adding an area invalidate the
        // cache by itself.
        // v4: entries gained an `os` field. The area count in the key does not
        // move when a FIELD is added, so without the bump yesterday's cached
        // rows would come back missing it for up to fifteen minutes.
        // v5: and an `osStatus` field, for the same reason. Cached v4 rows
        // carry the flag but no status, so the band would draw unlabelled on
        // yesterday's half of the window and labelled on today's - which reads
        // as the status having changed at midnight.
        // v6: and the two clip times. Same failure shape: a band spanning
        // midnight would report a start and end for its second half only.
        // v7: the FORMAT changed, not a field - this now holds delimited
        // lines rather than entry objects, because the objects ran to ~19MB
        // and the write was refused every time. A v6 entry fed to the line
        // splitter would come back as garbage rather than as a miss.
        yCacheKey = 'ydayArch_v7_' + PROC_AREA_COLUMNS_.length + '_' + yesterdayStr +
                    '_' + yKeys.length + '_' + yKeys[0] + '_' + yKeys[yKeys.length - 1];
        var yCached = cacheGetLarge_(yCacheKey);
        if (yCached) {
          try {
            // Stored as delimited LINES, not as the expanded entry objects it
            // used to hold. Those ran to ~19MB for this site's yesterday
            // slice, so the write was refused every single time and the cache
            // had never once populated - see CACHE_MAX_TOTAL_. The same rows
            // as text are about a tenth of that.
            //
            // The header travels with them and is re-mapped by NAME on the
            // way out, so a cache entry written before an area was added
            // cannot silently read one column short.
            var yLines = yCached.split('\n');
            var yMap = buildProcColumnMap_(yLines[0].split(BACKEND_DELIM_));
            if (yMap.total >= 0) {
              yEntries = [];
              for (var yl = 1; yl < yLines.length; yl++) {
                if (!yLines[yl]) continue;
                var yCols = yLines[yl].split(BACKEND_DELIM_);
                yEntries.push(buildSideEntry_(yCols, yCols, yMap));
              }
            }
          } catch (e) { yEntries = null; }
        }
        tm.mark('ydayCacheGet');
        tm.note('ydayCache=' + (yEntries ? 'HIT/' + yCached.length + 'chars' : 'MISS'));
      }

      if (!yEntries) {
        yEntries = [];
        try {
          var archiveSS = SpreadsheetApp.openByUrl(yesterdayArchiveUrl);
          var archiveSource = archiveSS.getSheetByName(CONFIG.SOURCE_SHEET_NAME);
          // The single most expensive call in this function, measured on its
          // own so it is not hidden inside the read that follows it.
          tm.mark('ydayOpen');
          // Once, not twice: getLastRow() is its own round trip.
          var aLastRow = archiveSource ? archiveSource.getLastRow() : 0;
          if (archiveSource && aLastRow >= 2) {
            var aRead = readSourceRows_(archiveSS, archiveSource, aLastRow);
            tm.mark('ydayRead', aRead.cells);
            if (aRead.fallback) tm.note('ydayFELLBACK');

            // The header first, so a cache entry can be re-mapped by NAME on
            // the way out rather than trusting its positions.
            yLines_ = [backendJoin_(aRead.header)];
            for (var i = 0; i < aRead.vals.length; i++) {
              var aEntry = buildSideEntry_(aRead.vals[i], aRead.disps[i], aRead.map);
              if (!yesterdayTRSet[aEntry.timeRange]) continue;
              // An OS block has no standard hours by definition, so the value
              // test alone would drop exactly the rows the OS band needs.
              if (!aEntry.bonus || (aEntry.value <= 0 && !aEntry.os)) continue;
              yEntries.push(aEntry);
              yLines_.push(backendJoin_(aRead.vals[i]));
            }
          }
          // Cached as the lines themselves rather than as the objects built
          // from them. Only the rows that survived the window filter are
          // kept, which is most of the saving.
          if (yCacheKey && yLines_) {
            cachePutLarge_(yCacheKey, yLines_.join('\n'), 900);
          }
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
    var lLastRow = sourceSheet.getLastRow();
    if (lLastRow >= 2) {
      var lRead = readSourceRows_(ss, sourceSheet, lLastRow);
      tm.mark('liveRead', lRead.cells);
      if (lRead.fallback) tm.note('liveFELLBACK');

      for (var i = 0; i < lRead.vals.length; i++) {
        var lEntry = buildSideEntry_(lRead.vals[i], lRead.disps[i], lRead.map);
        if (!lEntry.bonus || (lEntry.value <= 0 && !lEntry.os)) continue;

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
    var sLastRow = sourceSheet.getLastRow();
    if (sLastRow >= 2) {
      var sRead = readSourceRows_(ss, sourceSheet, sLastRow);
      tm.mark('archiveRead', sRead.cells);
      if (sRead.fallback) tm.note('archiveFELLBACK');
      var timeSet = {};

      for (var t = 0; t < timeRanges.length; t++) {
        timeSet[timeRanges[t]] = true;
      }

      for (var i = 0; i < sRead.vals.length; i++) {
        var entry = buildSideEntry_(sRead.vals[i], sRead.disps[i], sRead.map);
        if (timeSet[entry.timeRange] && entry.bonus && (entry.value > 0 || entry.os)) {
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
  //
  // Judged on rows with hours, NOT on every row. An OS Log entry is typed ahead
  // of time — a shift logged to 18:00 exists in the sheet at 09:00 — so counting
  // OS-only rows as "data" would roll the axis forward into empty blocks, which
  // is the exact failure described above. Every row admitted before OS existed
  // had value > 0, so this leaves the trim byte-identical to what it was.
  var presentTR = {};
  for (var pi = 0; pi < rawSideData.length; pi++) {
    if (rawSideData[pi].value > 0) { presentTR[rawSideData[pi].timeRange] = true; }
  }
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

  tm.mark('build');

  // The OS log is NOT read here any more. It cost 431ms of every load for a
  // page most viewers never open, and it is the only read on this path that
  // nothing on screen needs - so the OS page fetches it itself, once, on
  // first open. See getOsLogRows.

  var payload = {
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
  tm.mark('tmList');

  // The payload size probe that used to sit here has been removed. It cost
  // 468ms of every load to stringify 31MB twice, and it has answered the
  // question it was added for: 33,742,320 chars against a 3,000,000 ceiling,
  // so the client's localStorage cache has certainly never once populated.
  // The client logs its own size on every load anyway - see
  // savePayloadCache_ - so nothing was lost by dropping it.

  tm.note('rows=' + rawSideData.length + ' bonuses=' + payload.bonusList.length +
          ' blocks=' + timeRanges.length);
  payload.timing = tm.done(isLiveMode ? 'LIVE' : 'ARCHIVE');
  return payload;
}

// Cells actually marshalled by one readProcRows_ call: the full-width body
// plus the A:C display read beside it. Both cross the Sheets boundary, and
// the second one exists only because column A and C are needed as DISPLAY
// values - which is the read a single-column tab would remove outright.
function procCells_(read) {
  if (!read || !read.vals) return 0;
  var rows = read.vals.length;
  var cols = rows ? read.vals[0].length : 0;
  return rows * cols + rows * 3;
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
