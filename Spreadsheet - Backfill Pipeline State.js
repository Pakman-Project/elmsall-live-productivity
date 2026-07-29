/************************************************************
 * BACKFILL 'Pipeline State' FOR PAST DAYS
 *
 * 'Pipeline State' (see Web - Code.js's rebuildProcessedFromData_ era notes,
 * and the Databricks notebook) is the record of which 15-min windows have
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
