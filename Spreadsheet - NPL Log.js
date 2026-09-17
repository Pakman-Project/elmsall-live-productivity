/************************************************************
 * NPL LOG BUILDER
 *
 * Entry point:
 *   updateNPLLog()
 *
 * Collects Non-Productive Labour records from up to four source workbooks
 * into 'NPL Log'!A7:P. The sibling of 'Spreadsheet - OS Log.js', and
 * deliberately the same shape: read the control cells, map columns, clear,
 * write, then repair the bonus column.
 *
 * Control cells on the NPL Log sheet:
 *
 *   B1, B2   daily workbook links     C1, C2   the tab name inside each
 *   B3, B4   weekly workbook links    C3, C4   the date to filter each to
 *
 * The weekly pair always reads a tab called 'NPL' and keeps only the rows
 * whose Date matches the date beside the link - those two cells point at
 * ROLLING files, so they are frequently the same workbook asked two
 * different questions.
 ************************************************************/

var NPL_LOG_SHEET_NAME_ = 'NPL Log';
var NPL_LOG_FIRST_ROW_ = 7;        // 1-6 are the control cells and headings
var NPL_WEEKLY_TAB_ = 'NPL';
var NPL_SOURCE_FIRST_ROW_ = 5;     // every source tab starts its data at row 5
var NPL_SOURCE_FIRST_COL_ = 2;     // B
var NPL_SOURCE_NUM_COLS_ = 18;     // B:S

// Source B:S with C and D dropped, as indices from B. 16 columns in, 16 out:
//
//   src  B     E      F     G     H     I       J       K      L       M
//   dst  A     B      C     D     E     F       G       H      I       J
//        Date  Bonus  Dept  Task  Prot  Site    Strict  Start  Finish  Dur
//
//   src  N     O      P      Q      R      S
//   dst  K     L      M      N      O      P
//        TM    Exc    Check  Allow  Total  Unprod
var NPL_SELECT_ = [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

// Where the date lives in a SOURCE row, as an index from B - so the weekly
// filter reads the same cell that becomes output column A.
var NPL_SOURCE_DATE_IDX_ = 0;

function updateNPLLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = nplLogSheet_(ss);

  if (!sheet) {
    Logger.log("Sheet '" + NPL_LOG_SHEET_NAME_ + "' was not found.");
    return;
  }

  // One read for all eight control cells rather than eight reads.
  var control = sheet.getRange('B1:C4').getValues();

  // Each job is one tab of one workbook, plus an optional date to keep. The
  // two kinds differ only in where the tab name comes from and whether there
  // is a date filter, so they are built into one list and run through one
  // loop - two loops would be two places for the column mapping to drift.
  var jobs = [];
  for (var i = 0; i < 2; i++) {
    var dailyUrl = nplUrlPak_(control[i][0]);
    var tab = String(control[i][1] == null ? '' : control[i][1]).trim();
    if (dailyUrl && tab) jobs.push({ url: dailyUrl, tab: tab, onDate: '' });
  }
  for (var w = 2; w < 4; w++) {
    var weeklyUrl = nplUrlPak_(control[w][0]);
    var onDate = nplDateKey_(control[w][1]);
    // A weekly link with no date beside it would pull the whole rolling file,
    // which is months of rows. Skipped rather than guessed at.
    if (weeklyUrl && onDate) {
      jobs.push({ url: weeklyUrl, tab: NPL_WEEKLY_TAB_, onDate: onDate });
    }
  }

  if (jobs.length === 0) {
    Logger.log('No usable link/tab pairs in ' + NPL_LOG_SHEET_NAME_ + '!B1:C4.');
    return;
  }

  // B3 and B4 are rolling-file links and are routinely the SAME workbook, so
  // the same tab gets opened twice to ask it about two different dates. Read
  // once, filter twice. Identical (url, tab, date) triples collapse entirely -
  // otherwise B3 === B4 with C3 === C4 would write every row out twice.
  var seen = {};
  var unique = [];
  jobs.forEach(function (job) {
    // JSON rather than a delimiter: a separator character has to be one
    // that cannot appear in a URL, a tab name or a date, and picking one
    // is a bet. This cannot collide at all.
    var key = JSON.stringify([job.url, job.tab.toLowerCase(), job.onDate]);
    if (seen[key]) return;
    seen[key] = true;
    unique.push(job);
  });

  var byWorkbook = {};
  unique.forEach(function (job) {
    var key = JSON.stringify([job.url, job.tab.toLowerCase()]);
    if (!byWorkbook[key]) byWorkbook[key] = { url: job.url, tab: job.tab, dates: [] };
    byWorkbook[key].dates.push(job.onDate);
  });

  var combined = [];
  Object.keys(byWorkbook).forEach(function (key) {
    var read = byWorkbook[key];
    try {
      combined = combined.concat(nplReadTabPak_(read.url, read.tab, read.dates));
    } catch (e) {
      // One unreachable link must not cost the other three. Same reasoning as
      // updateOSLog: a partial log is recoverable, an exception is not.
      Logger.log('NPL Log: could not read ' + read.tab + ' from ' + read.url +
                 ' - ' + e.message);
    }
  });

  nplWriteRowsPak_(sheet, combined);
}

function nplLogSheet_(ss) {
  // Resolved case-insensitively, for the reason correctOsLogNames spells out:
  // the tab is written one way in the script and another in conversation, and
  // getSheetByName matches exactly.
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName().trim().toLowerCase() === NPL_LOG_SHEET_NAME_.toLowerCase()) {
      return sheets[s];
    }
  }
  return null;
}

function nplUrlPak_(v) {
  var s = String(v == null ? '' : v).trim();
  return (s.indexOf('http://') === 0 || s.indexOf('https://') === 0) ? s : '';
}

// A date cell -> "dd/mm/yyyy", or '' when it is not a date this understands.
//
// Matched on the PARSED value rather than on the cell's text, exactly as
// osLogDateKey_ does: the display format is a formatting choice somebody can
// change, and a column reformatted to "9/9/2026" would otherwise match
// nothing and the weekly links would contribute no rows at all - silently,
// because an empty result here looks the same as a quiet week.
function nplDateKey_(v) {
  if (v instanceof Date) {
    return nplPad2_(v.getDate()) + '/' + nplPad2_(v.getMonth() + 1) + '/' + v.getFullYear();
  }
  var m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(String(v == null ? '' : v).trim());
  return m ? nplPad2_(Number(m[1])) + '/' + nplPad2_(Number(m[2])) + '/' + m[3] : '';
}

function nplPad2_(n) { return (n < 10 ? '0' : '') + n; }

/**
 * One tab, mapped to output rows.
 *
 * `dates` is the set of dd/mm/yyyy keys to keep. A list containing '' means
 * "no filter" - that is how a daily tab asks for all of its rows - so an
 * empty string among real dates would quietly widen a weekly read to the
 * whole rolling file, and the two never mix: a job carries a date or it does
 * not.
 */
function nplReadTabPak_(url, tabName, dates) {
  var sourceSS = SpreadsheetApp.openByUrl(url);
  var sheets = sourceSS.getSheets();
  var sheet = null;
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName().trim().toLowerCase() === tabName.trim().toLowerCase()) {
      sheet = sheets[s];
      break;
    }
  }
  if (!sheet) {
    Logger.log("NPL Log: tab '" + tabName + "' not found in " + url);
    return [];
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < NPL_SOURCE_FIRST_ROW_) return [];

  var vals = sheet.getRange(NPL_SOURCE_FIRST_ROW_, NPL_SOURCE_FIRST_COL_,
                            lastRow - NPL_SOURCE_FIRST_ROW_ + 1,
                            NPL_SOURCE_NUM_COLS_).getValues();

  var wantAll = dates.some(function (d) { return !d; });
  var wanted = {};
  dates.forEach(function (d) { if (d) wanted[d] = true; });

  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    // A blank Date is a spacer row, not a record.
    var key = nplDateKey_(row[NPL_SOURCE_DATE_IDX_]);
    if (!key) continue;
    if (!wantAll && !wanted[key]) continue;

    var mapped = [];
    for (var c = 0; c < NPL_SELECT_.length; c++) {
      mapped.push(row[NPL_SELECT_[c]]);
    }
    out.push(mapped);
  }
  return out;
}

function nplWriteRowsPak_(sheet, rows) {
  // Cleared across the full 16 columns whether or not there is anything to
  // put back, so a day with no records empties the log rather than leaving
  // yesterday's on screen.
  var lastRow = sheet.getLastRow();
  if (lastRow >= NPL_LOG_FIRST_ROW_) {
    sheet.getRange(NPL_LOG_FIRST_ROW_, 1,
                   lastRow - NPL_LOG_FIRST_ROW_ + 1, NPL_SELECT_.length).clearContent();
  }
  if (rows.length === 0) {
    Logger.log('NPL Log: no rows matched.');
    return;
  }

  // Column B is the bonus code, and setValues PARSES a string the way typing
  // it would unless the cell is already formatted as text. Left to itself it
  // stores "1AM" as the time serial 1/24 and "1E8" as 100000000, on every
  // refresh, in the one column the whole feature joins on - and a mangled
  // code there does not fail. It silently matches no operator, and that
  // person's non-productive time is simply absent from the dashboard.
  //
  // Formatted FIRST, so nothing new is mangled. The same fix, for the same
  // reason, as correctNameColumn_ in 'Spreadsheet - Name Correction.js'.
  sheet.getRange(NPL_LOG_FIRST_ROW_, 2, rows.length, 1).setNumberFormat('@');
  sheet.getRange(NPL_LOG_FIRST_ROW_, 1, rows.length, NPL_SELECT_.length).setValues(rows);

  // And repair what earlier runs already damaged. Called here rather than put
  // on a trigger of its own: this way the two run in one execution, in order,
  // which is the only ordering guarantee available - a scheduled correction
  // could land mid-rewrite.
  try {
    var fixed = correctNplLogNames();
    if (fixed) Logger.log('NPL Log: ' + fixed + ' bonus code(s) corrected');
  } catch (e) {
    // Never fail the rebuild for the correction: a mangled code costs one
    // operator's rows, an exception here costs the whole log.
    Logger.log('NPL log name correction failed: ' + e.message);
  }
}
