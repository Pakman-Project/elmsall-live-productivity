/************************************************************
 * 'Data' TAB CORRECTION — column C names, column F hours
 *
 * This used to run only from a 5-minute time trigger, which left a window of
 * up to five minutes where rows had landed on the Data tab but had NOT been
 * corrected. Anything reading the tab in that window — the dashboard, or the
 * processed-data build — saw raw column C values ("3.00E+03" instead of "3E3",
 * "14:00" instead of "2PM"), so the same operator appeared as two different
 * people and the numbers were wrong until the next tick.
 *
 * The fix is to correct rows as they land. Databricks delivers via doPost, so
 * doPost calls correctDataRows_ on the block it has just written, inside the
 * same lock as the append — there is no window at all any more.
 *
 * Everything here therefore comes in two forms:
 *
 *   correctDataRows_(sheet, startRow, numRows)  one block, for doPost
 *   formatColumnCPeriodically()                 the whole tab, for a manual
 *                                               run or a slow safety-net trigger
 *
 * The block form is what makes running on every POST affordable: its cost is
 * set by the size of the batch, not by the size of the tab, so it stays
 * constant as the day fills up.
 ************************************************************/

var DATA_SHEET_NAME_ = 'Data';
var PROC_SHEET_NAME_ = 'Processed Data (15mins)';
// Column C (1-based) holds the bonus number / name being corrected, on both
// sheets — Processed Data's own column C is a straight copy of the bonus that
// produced each pivoted row (see PROC_AREAS in the Databricks notebook).
var NAME_COLUMN_ = 3;
// Column F is derived, column G is its source: F = G / 60.
var HOURS_OUT_COLUMN_ = 6;
var HOURS_IN_COLUMN_ = 7;

/**
 * Written-out clock times that should be stored as the short shift codes the
 * rest of the pipeline groups on. Hoisted to module scope: it used to be
 * rebuilt on every call, which was invisible at one call per five minutes and
 * is worth avoiding now that a correction runs on every delivery.
 */
var NAME_TIME_MAP_ = {
  // AM
  '00:00': '0AM',
  '12:00': '0PM',
  '01:00': '1AM', '1:00': '1AM',
  '02:00': '2AM', '2:00': '2AM',
  '03:00': '3AM', '3:00': '3AM',
  '04:00': '4AM', '4:00': '4AM',
  '05:00': '5AM', '5:00': '5AM',
  '06:00': '6AM', '6:00': '6AM',
  '07:00': '7AM', '7:00': '7AM',
  '08:00': '8AM', '8:00': '8AM',
  '09:00': '9AM', '9:00': '9AM',
  // PM
  '12:00 PM': '0PM', '12:00PM': '0PM',
  '13:00': '1PM', '1:00 PM': '1PM', '1:00PM': '1PM',
  '14:00': '2PM', '2:00 PM': '2PM', '2:00PM': '2PM',
  '15:00': '3PM', '3:00 PM': '3PM', '3:00PM': '3PM',
  '16:00': '4PM', '4:00 PM': '4PM', '4:00PM': '4PM',
  '17:00': '5PM', '5:00 PM': '5PM', '5:00PM': '5PM',
  '18:00': '6PM', '6:00 PM': '6PM', '6:00PM': '6PM',
  '19:00': '7PM', '7:00 PM': '7PM', '7:00PM': '7PM',
  '20:00': '8PM', '8:00 PM': '8PM', '8:00PM': '8PM',
  '21:00': '9PM', '9:00 PM': '9PM', '9:00PM': '9PM'
};

/**
 * One displayed column C cell -> its corrected value.
 */
function correctNameValue_(display) {
  // Trim whitespace AND convert to ALL CAPS.
  var v = String(display === null || display === undefined ? '' : display).trim().toUpperCase();
  if (!v) return '';

  // Fix scientific notation (e.g. 3.00E+03 -> 3E3). Sheets renders a bonus
  // number that looks like a number in whatever notation it prefers, and the
  // pipeline groups on the string, so "3E3" and "3.00E+03" would be two people.
  var sciMatch = v.match(/^(\d+(?:\.\d+)?)E\+?(\d+)$/i);
  if (sciMatch) {
    // Strip the decimal point and any trailing zeros ("3.00" -> "3").
    var base = sciMatch[1].replace(/\.?0+$/, '');
    // Number() drops leading zeros from the exponent ("03" -> 3).
    return base + 'E' + Number(sciMatch[2]);
  }

  if (NAME_TIME_MAP_[v]) return NAME_TIME_MAP_[v];

  return v;
}

/**
 * Corrects column C for a block of rows.
 *
 * The number format is forced to plain text AFTER the write. Without it Sheets
 * re-reads "3E3" as a number and renders it straight back as 3.00E+03, undoing
 * the correction on the way in.
 */
function correctNameColumn_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  var range = sheet.getRange(startRow, NAME_COLUMN_, numRows, 1);
  var display = range.getDisplayValues();

  var corrected = display.map(function (row) {
    return [correctNameValue_(row[0])];
  });

  range.setValues(corrected);
  range.setNumberFormat('@');
}

/**
 * Recomputes column F (= G / 60, to 4 significant figures) for a block of rows.
 */
function calculateHoursColumn_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  var gValues = sheet.getRange(startRow, HOURS_IN_COLUMN_, numRows, 1).getValues();

  var fValues = gValues.map(function (row) {
    var g = row[0];
    if (g === '' || g === null || g === undefined) return [''];

    var num = Number(g);
    if (isNaN(num)) return [''];

    return [Number((num / 60).toPrecision(4))];
  });

  var outRange = sheet.getRange(startRow, HOURS_OUT_COLUMN_, numRows, 1);
  outRange.setValues(fValues);
  // Up to 4 decimal places, without trailing zeros.
  outRange.setNumberFormat('0.####');
}

/**
 * Corrects one freshly-landed block. This is what doPost calls, and it is the
 * whole point of the file: the block is corrected before the response returns,
 * so nothing downstream can ever read it uncorrected.
 *
 * Safe to call again on the same rows — every step is idempotent, so a retry
 * or an overlapping delivery cannot corrupt anything.
 */
function correctDataRows_(sheet, startRow, numRows) {
  if (!sheet || numRows < 1) return;
  // Row 1 is the header. A block starting there would be uppercased into a
  // corrupted header, so clamp to the first data row.
  if (startRow < 2) {
    numRows -= (2 - startRow);
    startRow = 2;
    if (numRows < 1) return;
  }
  correctNameColumn_(sheet, startRow, numRows);
  calculateHoursColumn_(sheet, startRow, numRows);
}

/**
 * Whole-tab correction.
 *
 * Kept under its original name so an existing time trigger keeps working. It
 * is no longer needed every 5 minutes — doPost corrects each delivery as it
 * lands — but it remains useful as an occasional safety net, and as the repair
 * for rows that arrived some other way (a manual paste, an import).
 *
 * Also corrects Processed Data (15mins)!C2:C. Databricks writes that tab RAW
 * now, so its column C should already be correct — this is a second safety
 * net, not a load-bearing step, for the same reason the Data-tab pass below
 * is one: a name correction here can never be undone by a later write the way
 * it used to be when the pivot read Data back through USER_ENTERED.
 *
 * Hours are NOT recalculated on Processed Data — D:L are the Databricks pivot
 * output (standard hours per work area), not a G/60 derivation like Data's
 * column F, so calculateHoursColumn_ does not apply here.
 */
function formatColumnCPeriodically() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var dataSheet = ss.getSheetByName(DATA_SHEET_NAME_);
  if (dataSheet) {
    var dataLastRow = dataSheet.getLastRow();
    if (dataLastRow >= 2) {
      correctDataRows_(dataSheet, 2, dataLastRow - 1);
    }
  }

  var procSheet = ss.getSheetByName(PROC_SHEET_NAME_);
  if (procSheet) {
    var procLastRow = procSheet.getLastRow();
    if (procLastRow >= 2) {
      correctNameColumn_(procSheet, 2, procLastRow - 1);
    }
  }
}

/**
 * Menu entry point: correct the whole tab now, and say what happened. Gives the
 * user a way to repair rows that did not arrive through doPost without going
 * to the script editor.
 */
function confirmFormatDataTab() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'Correct the Data tab',
    'Re-applies the column C name corrections and recalculates column F across ' +
    'the whole Data tab, and re-applies the same column C name correction to ' +
    'Processed Data (15mins).\n\nBoth are already correct as Databricks writes ' +
    'them — this is a safety net for rows added another way. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  formatColumnCPeriodically();
  ui.alert('Data tab corrected.');
}
