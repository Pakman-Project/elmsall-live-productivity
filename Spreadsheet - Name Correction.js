/************************************************************
 * 'Data' TAB CORRECTION — column C names, column F hours
 *
 * A SAFETY NET, not a step in the live pipeline. Read that first, because it
 * used to be the opposite and the difference matters.
 *
 * Column C holds the bonus code. It used to arrive damaged: Databricks wrote
 * the Data tab through the Sheets API with USER_ENTERED, which asks Sheets to
 * INTERPRET each value, so "3E3" was stored as the number 3000 and read back
 * as "3.00E+03", and "2PM" was stored as a time and read back as "14:00". One
 * operator became two. This file existed to repair that afterwards, on a
 * 5-minute trigger.
 *
 * It could never repair it in time. The Databricks notebook pivots the Data
 * tab into 'Processed Data (15mins)' seconds after appending to it, so the
 * newest 15-minute block — the one the live dashboard shows — was always
 * pivoted before any trigger could fire.
 *
 * Both causes are now fixed where the value enters, in the notebook:
 *
 *   value_input_option='RAW'          stores exactly what is sent
 *   upper(trim(PAYLOAD_BONUSCODE))    folds "mf5" and "MF5" together in SQL
 *
 * so nothing arriving through Databricks needs correcting at all. What is left
 * for this file is rows that arrive some OTHER way — a manual paste, an
 * import, a hand edit. Those are rare, so an hourly trigger is plenty; the
 * 5-minute cadence was sized for a job this no longer does, and rewriting
 * every cell of column C 288 times a day is pure overhead.
 *
 * Two forms:
 *
 *   correctDataRows_(sheet, startRow, numRows)  one block
 *   formatColumnCPeriodically()                 the whole Data tab
 *
 * NOTE: this deliberately does NOT touch 'Processed Data (15mins)'. Databricks
 * is the sole writer of that tab, and it rebuilds it in full every 15 minutes.
 * A second writer editing its column C while the notebook is writing A2:V can
 * pair one row's bonus code with another row's figures — and since the pivot
 * key now folds case itself, there is nothing there to gain in exchange.
 ************************************************************/

var DATA_SHEET_NAME_ = 'Data';
// Column C (1-based) holds the bonus number / name being corrected.
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
 * Bonus codes made only of zeros lose their width on the way in: Sheets stores
 * "000" as the number 0 and reads it back as "0". Same damage as the "3E3"
 * case, different shape, so it gets the same treatment — an exact lookup back
 * to the intended code.
 *
 * Only one width can be recovered, because every all-zero code arrives as the
 * same "0". If genuine "00" or "0000" codes ever appear, fix it at the source
 * (write the cell as text) rather than here.
 */
var NAME_ZERO_MAP_ = {
  '0': '000'
};

/**
 * One displayed column C cell -> its corrected value.
 */
function correctNameValue_(display) {
  // Trim whitespace AND convert to ALL CAPS.
  var v = String(display === null || display === undefined ? '' : display).trim().toUpperCase();
  if (!v) return '';

  // Restore all-zero codes collapsed to "0" by Sheets.
  if (NAME_ZERO_MAP_[v]) return NAME_ZERO_MAP_[v];

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
 * the correction on the way in. The same applies to "000", which would
 * otherwise collapse straight back to 0.
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
 * Whole-tab correction, over 'Data' only. See the file header for why
 * 'Processed Data (15mins)' is deliberately left alone.
 *
 * Kept under its original name so an existing time trigger keeps working.
 * Hourly is the right cadence: nothing arriving through Databricks needs this
 * any more, so it exists for the occasional hand-added row.
 */
function formatColumnCPeriodically() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET_NAME_);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  correctDataRows_(sheet, 2, lastRow - 1);
}

/**
 * Menu entry point: correct the whole tab now, and say what happened. Gives
 * the user a way to repair hand-added rows without going to the script editor.
 */
function confirmFormatDataTab() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'Correct the Data tab',
    'Re-applies the column C name corrections and recalculates column F across ' +
    'the whole Data tab.\n\nRows delivered by Databricks are already correct as ' +
    'they arrive — this is a safety net for rows added another way, such as a ' +
    'manual paste. Processed Data is not touched; Databricks rebuilds it.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  formatColumnCPeriodically();
  ui.alert('Data tab corrected.');
}
