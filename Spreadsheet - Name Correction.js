/************************************************************
 * 'Data' TAB CORRECTION — column C names, column G hours
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
 * import, a hand edit.
 *
 * Except that for a while it was doing the damage itself. correctNameColumn_
 * wrote the corrected values and set the plain-text format AFTERWARDS, and
 * setValues parses a string the way typing it would unless the cell is already
 * text — so the repaired "1AM" was stored as the time serial 1/24, and the
 * format change then froze that number as the text "0.04166666667". Running
 * hourly over the whole tab, it destroyed exactly the codes it exists to
 * protect, on rows Databricks had written perfectly. See correctNameColumn_
 * for the order, and recoverMangledNameValue_ for the clean-up.
 *
 * Hand-added rows are rare, so an hourly trigger is plenty; the
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
 * A second writer editing its column C while the notebook is writing that tab can
 * pair one row's bonus code with another row's figures — and since the pivot
 * key now folds case itself, there is nothing there to gain in exchange.
 ************************************************************/

var DATA_SHEET_NAME_ = 'Data';

// The OS log's own bonus column, which needs exactly the same treatment for
// exactly the same reason. "Spreadsheet - OS Log.js" rebuilds A7:T with one
// setValues, and setValues parses a string the way typing it would unless the
// cell is already text - so "1AM" was being stored as the time serial 1/24 and
// "1E8" as 100000000, on every refresh, in the column the whole OS feature
// joins on. A mangled code there does not fail: it silently matches no
// operator, and that person's indirect work simply is not on the dashboard.
//
// Fixed at BOTH ends, because either alone is not enough. The OS Log script
// now formats the column as text before it writes, so nothing new is mangled;
// this corrects what previous runs already damaged.
var OS_LOG_SHEET_NAME_NC_ = 'OS log';
var OS_LOG_FIRST_ROW_NC_ = 7;
var OS_LOG_BONUS_COL_ = 2;   // column B
// Column C (1-based) holds the bonus number / name being corrected.
var NAME_COLUMN_ = 3;
// Standard Hours is derived, SMV is its source: StandardHours = SMV / 60.
// Columns G and H since Attribute was inserted after Event Type; F and G before.
var HOURS_OUT_COLUMN_ = 7;
var HOURS_IN_COLUMN_ = 8;

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
 * "0" IS NOT REPAIRED, deliberately, and this is the reason.
 *
 * There used to be a map here turning "0" back into "000", on the assumption
 * that an all-zero code was the only thing that could collapse to it. It is
 * not: "0AM" is a real bonus code at this site, and Sheets parses it as
 * midnight, whose time serial is also 0. Both codes arrive as the same "0"
 * and nothing in the cell distinguishes them — the number format would have,
 * but the old write order overwrote that with plain text on every pass, so
 * that evidence is gone from any row already touched.
 *
 * Guessing therefore means attributing one real operator's hours to another
 * real operator, roughly half the time, with nothing on screen to show it
 * happened. Leaving "0" alone is worse-looking and better: it shows up as an
 * operator called "0", which is visibly wrong and can be fixed by hand by
 * somebody who knows which shift it was.
 *
 * Nothing NEW collapses any more. Databricks writes with RAW and
 * correctNameColumn_ formats before it writes, so "0AM" and "000" both survive
 * intact from here on. This only concerns rows damaged before that.
 */

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

  // Last, so an exact lookup always beats a reconstruction.
  var recovered = recoverMangledNameValue_(v);
  if (recovered) return recovered;

  return v;
}

function pad2Name_(n) { return (n < 10 ? '0' : '') + n; }

/**
 * A value Sheets already destroyed -> the code it came from, or '' when the
 * shape is not recognisable damage.
 *
 * This repairs cells that were wrecked before the write order in
 * correctNameColumn_ was fixed, and it has to work off a NUMBER rather than a
 * rendered clock time, because a number is what was frozen into the cell:
 * "1AM" was parsed to the time serial 1/24 and then given a text format, so
 * the cell reads "0.04166666667" and no lookup in NAME_TIME_MAP_ will ever
 * find it.
 *
 * Deliberately narrow. Every rule here has to match a shape a real bonus code
 * cannot have, because a false repair invents an operator who was never on
 * shift:
 *
 *   a fraction of a day      0.75 -> 18:00 -> "6PM". A code cannot contain a
 *                            decimal point, so nothing legitimate looks like
 *                            this. Whole hours only, and only the hours that
 *                            HAVE a code - 10:00 and 11:00 do not, so they are
 *                            left alone rather than guessed at. Midnight is
 *                            excluded by the n > 0 test: its serial is 0, and
 *                            "0AM" cannot be told from "000" there.
 *
 *   a power of ten >= 1000   100000000 -> "1E8", 3000 -> "3E3" - the same
 *                            notation correctNameValue_ already normalises
 *                            "3.00E+03" to. The floor at 1000 keeps
 *                            three-digit numeric codes safe, which costs the
 *                            recovery of "1E2"; that is the right way round.
 *
 * NOT recovered: "0". Both "000" and "0AM" collapse to it and nothing tells
 * them apart, so neither this nor anything else may guess — see the note where
 * the zero map used to be.
 */
function recoverMangledNameValue_(v) {
  // Digits and at most one decimal point. Anything else is either a real code
  // or damage of a shape this does not claim to understand.
  if (!/^\d+(?:\.\d+)?$/.test(v)) return '';
  var n = Number(v);
  if (!isFinite(n)) return '';

  if (n > 0 && n < 1) {
    var hours = n * 24;
    var h = Math.round(hours);
    // 0.04166666667 is a rounded rendering of 1/24, so the comparison has to
    // tolerate what the cell lost.
    if (Math.abs(hours - h) > 1e-6) return '';
    return NAME_TIME_MAP_[pad2Name_(h) + ':00'] || '';
  }

  if (n >= 1000 && Math.floor(n) === n) {
    var exp = 0, base = n;
    while (base % 10 === 0) { base /= 10; exp++; }
    if (base >= 1 && base <= 9) return base + 'E' + exp;
  }

  return '';
}

/**
 * Corrects column C for a block of rows.
 *
 * The plain-text format goes on BEFORE the write, and the order is the whole
 * correctness of this function.
 *
 * setValues does not store a string verbatim: it parses each one the way
 * typing it into the cell would, unless the cell is already formatted as text.
 * So with the format applied afterwards, writing the corrected "1AM" stored
 * the time serial 1/24, and setNumberFormat then froze that number as the text
 * "0.04166666667". "1E8" became 100000000 and "000" became 0 the same way.
 * Every correction this file made was undone by the act of making it, and
 * because the result no longer looks like a clock time, correctNameValue_
 * could not recognise it on the next pass either - so the damage was
 * permanent, and it accumulated hourly across rows Databricks had written
 * correctly with RAW.
 *
 * Formatting first, setValues has nothing left to interpret.
 */
function correctNameColumn_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  var range = sheet.getRange(startRow, NAME_COLUMN_, numRows, 1);
  var display = range.getDisplayValues();

  var corrected = display.map(function (row) {
    return [correctNameValue_(row[0])];
  });

  range.setNumberFormat('@');
  range.setValues(corrected);
}

/**
 * Recomputes column G (= H / 60, to 4 significant figures) for a block of rows.
 */
function calculateHoursColumn_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  var smvValues = sheet.getRange(startRow, HOURS_IN_COLUMN_, numRows, 1).getValues();

  var hourValues = smvValues.map(function (row) {
    var smv = row[0];
    if (smv === '' || smv === null || smv === undefined) return [''];

    var num = Number(smv);
    if (isNaN(num)) return [''];

    return [Number((num / 60).toPrecision(4))];
  });

  var outRange = sheet.getRange(startRow, HOURS_OUT_COLUMN_, numRows, 1);
  outRange.setValues(hourValues);
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
 * The OS log's bonus column, B7 down.
 *
 * Called from updateOSLog() the moment it finishes writing, so it needs no
 * trigger of its own and cannot race the thing it is correcting - the two run
 * in one execution, in order. That is the one ordering guarantee available
 * here, and it is why this is called rather than scheduled.
 *
 * Resolved case-insensitively: the tab is "OS log" in the script and "OS Log"
 * in conversation, and getSheetByName matches exactly.
 */
function correctOsLogNames() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheet = null;
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName().trim().toLowerCase() === OS_LOG_SHEET_NAME_NC_.toLowerCase()) {
      sheet = sheets[s];
      break;
    }
  }
  if (!sheet) return 0;

  var lastRow = sheet.getLastRow();
  if (lastRow < OS_LOG_FIRST_ROW_NC_) return 0;
  var numRows = lastRow - OS_LOG_FIRST_ROW_NC_ + 1;

  var range = sheet.getRange(OS_LOG_FIRST_ROW_NC_, OS_LOG_BONUS_COL_, numRows, 1);
  var display = range.getDisplayValues();
  var corrected = display.map(function (row) {
    return [correctNameValue_(row[0])];
  });

  // Format BEFORE the write, for the reason spelled out at length on
  // correctNameColumn_: the other order undoes every correction as it makes
  // it, and the result no longer looks like a clock time, so the damage is
  // permanent and accumulates.
  range.setNumberFormat('@');
  range.setValues(corrected);

  var changed = 0;
  for (var i = 0; i < corrected.length; i++) {
    if (corrected[i][0] !== display[i][0]) changed++;
  }
  return changed;
}

/**
 * Menu entry point: correct the whole tab now, and say what happened. Gives
 * the user a way to repair hand-added rows without going to the script editor.
 */
function confirmFormatDataTab() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'Correct the Data tab',
    'Re-applies the column C name corrections and recalculates column G across ' +
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
