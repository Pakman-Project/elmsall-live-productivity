/************************************************************
 * DAILY 'Data' TAB CLEANUP
 *
 * Intended for a time-driven trigger at 04:00. In order:
 *   1. Drop every row in A2:A whose date is not today (dd/mm/yyyy).
 *   2. Drop duplicate rows - identical across A:J.
 *   3. Sort what remains by column I.
 *   4. Rebuild 'Processed Data (15mins)' from the result.
 *
 * Notes on how this is written:
 *
 * Rows are filtered in memory and written back in one go rather than removed
 * with deleteRow(). Deleting scattered rows one at a time costs a sheet call
 * each and the row indices shift underneath you as you go; a single read,
 * filter and write is both faster and much harder to get wrong.
 *
 * Comparisons use DISPLAY values, not raw ones. Column A may hold a real Date
 * or the text "28/07/2026" depending on what Sheets made of the CSV that doPost
 * wrote, and a Date object never equals a string. What the user sees is what is
 * being matched, so that is what gets compared - and it also makes the duplicate
 * check immune to floating-point noise in the numeric columns.
 *
 * doPost appends at getLastRow() + 2, which leaves a blank row between every
 * batch. Those accumulate, and this clears them out as a side effect.
 ************************************************************/

// Columns A:J - what to dedupe on, and what the pipeline reads.
var CLEANUP_KEY_COLUMNS_ = 10;
// Column I (1-based), the time-block key everything downstream orders by.
var CLEANUP_SORT_COLUMN_ = 9;
/**
 * Identity of a row for duplicate detection: its first ten displayed cells.
 *
 * JSON.stringify rather than join(separator). Joining on any printable
 * character lets two different rows collide - ['a|b','c'] and ['a','b|c']
 * both become "a|b|c" - and the usual answer, a control character, is
 * awkward to keep intact through editors and source control. Stringify
 * quotes and escapes each cell, so distinct rows always give distinct keys.
 */
function cleanupRowKey_(displayRow) {
  return JSON.stringify(displayRow.slice(0, CLEANUP_KEY_COLUMNS_));
}

/**
 * Reduces a displayed cell to a dd/MM/yyyy string, or '' if it holds no date.
 * Accepts a bare date, a date followed by a time, and an ISO date, so a change
 * to the sheet's display format cannot silently wipe everything.
 */
function cleanupDateKey_(display) {
  var s = String(display == null ? '' : display).trim();
  if (!s) return '';

  var pad = function (n) { return (n.length === 1 ? '0' : '') + n; };

  // dd/mm/yyyy, optionally followed by a time - the format on this sheet.
  var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmy) return pad(dmy[1]) + '/' + pad(dmy[2]) + '/' + dmy[3];

  // yyyy-mm-dd, in case anything upstream ever starts sending ISO.
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return pad(iso[3]) + '/' + pad(iso[2]) + '/' + iso[1];

  return '';
}

function dailyDataCleanup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Data');
  if (!sheet) {
    Logger.log("dailyDataCleanup: no 'Data' sheet - nothing to do.");
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('dailyDataCleanup: Data is empty.');
    return;
  }

  // Read the full used width, not just A:J. If anything ever lands in K or
  // beyond, rewriting only the first ten columns would leave it attached to
  // whichever row ended up in its place - silent corruption. The duplicate key
  // and the sort still only look at A:J.
  var width = Math.max(CLEANUP_KEY_COLUMNS_, sheet.getLastColumn());
  var range = sheet.getRange(2, 1, lastRow - 1, width);
  var values = range.getValues();
  var disps = range.getDisplayValues();

  var today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');

  var kept = [];
  var seen = {};
  var blank = 0, notToday = 0, dupes = 0, unreadable = 0, readable = 0;

  for (var i = 0; i < values.length; i++) {
    var disp = disps[i];

    // Entirely empty rows, including the spacers doPost leaves behind.
    var hasContent = false;
    for (var c = 0; c < width; c++) {
      if (String(disp[c] == null ? '' : disp[c]).trim() !== '') { hasContent = true; break; }
    }
    if (!hasContent) { blank++; continue; }

    var dateKey = cleanupDateKey_(disp[0]);
    if (!dateKey) { unreadable++; notToday++; continue; }
    readable++;
    if (dateKey !== today) { notToday++; continue; }

    var key = cleanupRowKey_(disp);
    if (seen[key]) { dupes++; continue; }
    seen[key] = true;

    kept.push(values[i]);
  }

  // Guard against a format change quietly emptying the sheet. If not one row
  // anywhere held a readable date, column A has changed shape rather than aged
  // out, and wiping everything would be the wrong response to that.
  if (readable === 0 && unreadable > 0) {
    Logger.log('dailyDataCleanup: ABORTED - no row in column A held a readable date ' +
               '(checked ' + unreadable + ' rows). Column A may have changed format. ' +
               'Nothing was deleted.');
    return;
  }

  sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  if (kept.length > 0) {
    sheet.getRange(2, 1, kept.length, width).setValues(kept);
    // Sorted after writing, by column I, exactly as the sheet's own sort would.
    // This is a value sort: if column I holds TEXT rather than real datetimes,
    // the order is lexicographic, which for dd/mm/yyyy strings is not
    // chronological. That is already how the rest of the pipeline orders these
    // (see computeProcessedAggregates_ in Code.js), so it is left consistent
    // rather than quietly made different here.
    sheet.getRange(2, 1, kept.length, width)
         .sort({ column: CLEANUP_SORT_COLUMN_, ascending: true });
  }

  Logger.log('dailyDataCleanup: kept ' + kept.length + ' row(s) for ' + today +
             '; removed ' + notToday + ' not-today (' + unreadable + ' unreadable), ' +
             dupes + ' duplicate, ' + blank + ' blank.');

  forceRebuildProcessedData();
}

/** Menu wrapper - confirms first, since this deletes rows. */
function confirmDailyDataCleanup() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Clean up Data tab',
    'This deletes every row in Data that is not dated today, removes duplicate ' +
    'rows, sorts by column I, and rebuilds Processed Data.\n\nContinue?',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  dailyDataCleanup();
  ui.alert('Data cleanup complete. See Extensions > Apps Script > Executions for the row counts.');
}
