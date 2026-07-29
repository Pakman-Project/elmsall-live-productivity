/************************************************************
 * 'Pipeline State' — the coverage record
 *
 * Two tools live here, both about the tab the Databricks gap-scan reads to
 * decide which 15-minute windows still need fetching:
 *
 *   reconcilePipelineStateWithData_()   re-opens windows a whole-tab rewrite
 *                                       erased. Called by the archive and the
 *                                       cleanup, immediately after each one
 *                                       rewrites 'Data'.
 *   confirmBackfillPipelineState()      menu tool to fill in past days that
 *                                       predate the tab existing.
 *
 * ── BACKFILL ─────────────────────────────────────────────────────────────
 *
 * 'Pipeline State' is the record of which 15-min windows have
 * already been fetched. It only exists from the day it was introduced: it
 * seeds itself once from whatever the live job's first run found sitting on
 * 'Data', which only ever holds TODAY's rows - Archive.js trims everything
 * older at 01:00. Days before the tab existed are simply absent from it.
 *
 * That absence is harmless for the live job itself: the gap-scan (cell 6 of
 * the notebook) never looks past today's local midnight anyway, so a past day
 * missing from 'Pipeline State' can never cause a re-fetch. This backfill is
 * for a complete record, not a fix for a live bug.
 *
 * Rows Written is written as 0 for every entry this produces. 0 never appears
 * on a row the live job wrote for a real fetch - the minimum for a window
 * with no data at all is 1 (the placeholder row) - so it stays a visible,
 * unambiguous marker that the row was backfilled rather than recorded live.
 *
 * Entries are generated from the calendar, not read out of the archive
 * files. A day that was "actually all run" has all 96 of its windows
 * present by definition, so there is nothing to discover by opening each
 * archive spreadsheet - only the window boundaries themselves, which are
 * fully determined by the date. Windows are walked in absolute UTC time by
 * stepping in milliseconds from local midnight to local midnight, so a
 * British Summer Time transition day correctly produces 92 or 100 windows
 * instead of 96, rather than silently drifting.
 ************************************************************/

var PIPELINE_STATE_TAB_ = 'Pipeline State';
var PIPELINE_STATE_HEADER_ = ['Window End (UTC)', 'Date Time Range', 'Rows Written', 'Recorded At (UTC)'];
var PIPELINE_STATE_TZ_ = 'Europe/London';
var PIPELINE_STATE_WINDOW_MS_ = 15 * 60 * 1000;
// Column I of 'Data' holds the Date Time Range — the join key between a row
// and the window it belongs to, and the same string 'Pipeline State' records
// in its column B. Both are written from one value in the notebook, so they
// match exactly rather than approximately.
var PIPELINE_STATE_DATA_RANGE_COL_ = 9;

/**
 * Re-opens any of TODAY's windows that a whole-tab rewrite has erased.
 *
 * Both archivePastDatesAndTrimLive_ and dailyDataCleanup read every row of
 * 'Data' into memory, filter it, and write the survivors back over the top. A
 * Databricks append landing between that read and that write is erased with no
 * trace of it having existed.
 *
 * That used to be survivable. Coverage was inferred from 'Data' itself, so an
 * erased window simply looked unfetched and the next run refilled it. Since
 * coverage moved to its own tab, an erased window stays marked as covered and
 * is never fetched again — a permanent hole, silently, with nothing in the
 * Failures tab because from Databricks' side the write succeeded.
 *
 * The repair is to run this straight after each rewrite, in the same script
 * that did it. Because the erasure and the repair are in one execution, the
 * ordering between Apps Script and Databricks stops mattering entirely: no
 * lock, no waiting, and nothing to do on the days a collision does not happen.
 *
 * Two classes of row are deliberately left alone:
 *
 *   Windows that do not START today. The archive removes yesterday's rows on
 *   purpose; their absence from 'Data' is correct, not a loss.
 *
 *   Windows with Rows Written <= 1. A window that found no data is recorded
 *   with a single '(no data this window)' placeholder, and that placeholder
 *   has a blank date so dailyDataCleanup drops it as "not today" — every time.
 *   Reopening those would make the pipeline refetch every empty window of the
 *   day, find nothing, write the placeholder again, and repeat tomorrow. 0
 *   likewise means a row this file's own backfill wrote, which never had data
 *   behind it.
 *
 * The rare real window holding exactly one row is therefore not repaired. That
 * is the safe direction to miss in: this only ever DELETES coverage rows, so a
 * false positive costs a refetch and a duplicate the 04:00 dedupe clears,
 * while a false negative costs nothing at all.
 *
 * @return {number} how many windows were reopened.
 */
function reconcilePipelineStateWithData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stateSheet = ss.getSheetByName(PIPELINE_STATE_TAB_);
  var dataSheet = ss.getSheetByName(DATA_SHEET_NAME_);
  if (!stateSheet || !dataSheet) return 0;

  var stateLastRow = stateSheet.getLastRow();
  if (stateLastRow < 2) return 0;

  // Which windows still have at least one row on 'Data'.
  var present = {};
  var dataLastRow = dataSheet.getLastRow();
  if (dataLastRow >= 2) {
    var ranges = dataSheet
      .getRange(2, PIPELINE_STATE_DATA_RANGE_COL_, dataLastRow - 1, 1)
      .getDisplayValues();
    for (var i = 0; i < ranges.length; i++) {
      var seen = String(ranges[i][0]).trim();
      if (seen) present[seen] = true;
    }
  }

  var todayPrefix = Utilities.formatDate(new Date(), PIPELINE_STATE_TZ_, 'dd/MM/yyyy') + ' ';

  var stateValues = stateSheet
    .getRange(2, 1, stateLastRow - 1, PIPELINE_STATE_HEADER_.length)
    .getValues();

  var kept = [];
  var reopened = [];

  for (var s = 0; s < stateValues.length; s++) {
    var row = stateValues[s];
    var dtr = String(row[1] === null || row[1] === undefined ? '' : row[1]).trim();
    var rowsWritten = Number(row[2]);

    var startsToday = dtr.indexOf(todayPrefix) === 0;
    var hadRealData = rowsWritten > 1;

    if (startsToday && hadRealData && !present[dtr]) {
      reopened.push(dtr);
      continue; // dropped, so the gap-scan sees this window as unfetched again
    }
    kept.push(row);
  }

  if (reopened.length === 0) return 0;

  // Write the survivors first, then clear the tail — never leave the coverage
  // record empty or half-written between two calls. A Databricks run reading it
  // in that gap would see no coverage at all and refetch the entire day.
  if (kept.length > 0) {
    stateSheet.getRange(2, 1, kept.length, PIPELINE_STATE_HEADER_.length).setValues(kept);
  }
  var newLastRow = kept.length + 1;
  if (stateLastRow > newLastRow) {
    stateSheet
      .getRange(newLastRow + 1, 1, stateLastRow - newLastRow, PIPELINE_STATE_HEADER_.length)
      .clearContent();
  }

  Logger.log('reconcilePipelineStateWithData_: reopened ' + reopened.length +
             ' window(s) erased by the rewrite — ' + reopened.join(', '));
  return reopened.length;
}

/**
 * Every 15-min window end, in UTC, for the local calendar day fromDateStr..
 * toDateStr inclusive (both 'dd/MM/yyyy', in PIPELINE_STATE_TZ_).
 *
 * Walked as absolute time from local midnight to local midnight rather than
 * by incrementing a wall-clock field, so a DST transition inside the range
 * changes how many windows the day contains instead of silently misaligning
 * them against the grid Databricks actually fetches on.
 */
function pipelineStateWindowsForRange_(fromDateStr, toDateStr) {
  var rangeStartUtc = Utilities.parseDate(fromDateStr + ' 00:00', PIPELINE_STATE_TZ_, 'dd/MM/yyyy HH:mm');
  var toDayStart = Utilities.parseDate(toDateStr + ' 00:00', PIPELINE_STATE_TZ_, 'dd/MM/yyyy HH:mm');
  var rangeEndUtc = new Date(toDayStart.getTime() + 24 * 60 * 60 * 1000); // exclusive: start of the day AFTER toDateStr

  var windows = [];
  for (var startMs = rangeStartUtc.getTime(); startMs < rangeEndUtc.getTime(); startMs += PIPELINE_STATE_WINDOW_MS_) {
    var blockStart = new Date(startMs);
    var blockEnd = new Date(startMs + PIPELINE_STATE_WINDOW_MS_);
    windows.push({
      endUtcKey: Utilities.formatDate(blockEnd, 'Etc/UTC', 'yyyy-MM-dd HH:mm:ss'),
      dateTimeRange:
        Utilities.formatDate(blockStart, PIPELINE_STATE_TZ_, 'dd/MM/yyyy HH:mm') + ' - ' +
        Utilities.formatDate(blockEnd, PIPELINE_STATE_TZ_, 'dd/MM/yyyy HH:mm'),
    });
  }
  return windows;
}

function ensurePipelineStateSheet_(ss) {
  var sheet = ss.getSheetByName(PIPELINE_STATE_TAB_);
  if (!sheet) {
    sheet = ss.insertSheet(PIPELINE_STATE_TAB_);
    sheet.getRange(1, 1, 1, PIPELINE_STATE_HEADER_.length).setValues([PIPELINE_STATE_HEADER_]);
  }
  return sheet;
}

/**
 * Backfills dummy coverage rows for fromDateStr..toDateStr inclusive
 * ('dd/MM/yyyy', local UK dates). Skips any window already present, so this
 * is safe to run again over an overlapping or wider range.
 */
function backfillPipelineStateDummy_(fromDateStr, toDateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensurePipelineStateSheet_(ss);

  var existing = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var existingKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < existingKeys.length; i++) {
      var key = String(existingKeys[i][0]).trim();
      if (key) existing[key] = true;
    }
  }

  var windows = pipelineStateWindowsForRange_(fromDateStr, toDateStr);
  var stamp = Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyy-MM-dd HH:mm:ss');

  var toAppend = [];
  var skipped = 0;
  for (var w = 0; w < windows.length; w++) {
    if (existing[windows[w].endUtcKey]) { skipped++; continue; }
    // Rows Written = 0: a deliberate, unmistakable "backfilled, not measured"
    // marker - see the file header comment for why 0 can never collide with
    // a value the live job would have written itself.
    toAppend.push([windows[w].endUtcKey, windows[w].dateTimeRange, 0, stamp]);
  }

  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, PIPELINE_STATE_HEADER_.length).setValues(toAppend);
  }

  var summary = 'Windows in range: ' + windows.length +
    '\nAlready present (skipped): ' + skipped +
    '\nBackfilled: ' + toAppend.length;
  Logger.log('backfillPipelineStateDummy_: ' + fromDateStr + '..' + toDateStr + ' — ' + summary.replace(/\n/g, ' | '));
  return summary;
}

/**
 * Menu entry point. Two short prompts rather than one, since Apps Script's
 * built-in UI has no multi-field dialog - a custom HTML one would be a lot of
 * ceremony for a function that gets run rarely, if ever, more than once.
 */
function confirmBackfillPipelineState() {
  var ui = SpreadsheetApp.getUi();

  var fromResp = ui.prompt(
    'Backfill Pipeline State — from date',
    'First date to backfill, dd/MM/yyyy (local UK date). Leave blank for yesterday.',
    ui.ButtonSet.OK_CANCEL
  );
  if (fromResp.getSelectedButton() !== ui.Button.OK) return;

  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var yesterdayStr = Utilities.formatDate(yesterday, PIPELINE_STATE_TZ_, 'dd/MM/yyyy');

  var fromDateStr = fromResp.getResponseText().trim() || yesterdayStr;

  var toResp = ui.prompt(
    'Backfill Pipeline State — to date',
    'Last date to backfill, dd/MM/yyyy, inclusive. Leave blank to match the from date (' + fromDateStr + ').',
    ui.ButtonSet.OK_CANCEL
  );
  if (toResp.getSelectedButton() !== ui.Button.OK) return;

  var toDateStr = toResp.getResponseText().trim() || fromDateStr;

  var dateFormatCheck = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
  if (!dateFormatCheck.test(fromDateStr) || !dateFormatCheck.test(toDateStr)) {
    ui.alert('Dates must be in dd/MM/yyyy format. Nothing was changed.');
    return;
  }

  var confirmResp = ui.alert(
    'Backfill Pipeline State',
    'Add coverage entries for every 15-minute window from ' + fromDateStr + ' to ' + toDateStr +
    ' (inclusive).\n\nOnly use this for days that were genuinely fetched in full - it marks every ' +
    'window in range as covered without checking. Rows Written is set to 0 to mark these as ' +
    'backfilled rather than measured.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (confirmResp !== ui.Button.YES) return;

  var summary;
  try {
    summary = backfillPipelineStateDummy_(fromDateStr, toDateStr);
  } catch (err) {
    ui.alert('Backfill failed: ' + err.message);
    return;
  }

  ui.alert('Pipeline State backfill complete.\n\n' + summary);
}
