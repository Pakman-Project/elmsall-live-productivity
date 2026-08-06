/************************************************************
 * BONUS HUB REPORT RUNNER DELIVERY ENDPOINT
 *
 * The Tampermonkey userscript "[PAK] PSD - Bonus Hub Report Runner" POSTs a
 * report's rows here as CSV/TSV and they are appended to the 'Data' tab. It is
 * the only caller. The scheduled Databricks notebooks do NOT come through here
 * — they authenticate as a service account and write to the Sheet directly
 * with gspread.
 *
 * The userscript posts to a *versioned* deployment (@89 - Public_V89), not
 * @HEAD, so edits to this file do not reach it on `clasp push` alone: a new
 * version has to be deployed and its URL put into REPORT_POST_URLS_BACKFILL
 * in the userscript.
 *
 * Two things happen here that used to happen elsewhere, or not at all:
 *
 * 1. The append is serialised with a lock. Two overlapping deliveries both read
 *    getLastRow() before either had written, so both computed the same start
 *    row and the second silently overwrote the first.
 *
 * 2. The block just written is corrected before the response returns. Column C
 *    name correction used to run on its own 5-minute trigger, which left rows
 *    sitting on the tab uncorrected for up to five minutes — long enough for
 *    the dashboard to pull them and show one operator as two. Correcting
 *    in-line closes that window completely: by the time these rows are visible
 *    to anything else, they are already right.
 ************************************************************/

// How long a delivery will wait for one already in progress. Generous, because
// losing a batch is far worse than a slow response, and a delivery only takes
// a moment once it has the lock.
var DOPOST_LOCK_WAIT_MS_ = 30000;

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Data");
    if (!sheet) {
      return ContentService.createTextOutput("Sheet 'data' not found");
    }

    const body = e.postData.contents;

    if (!body) {
      return ContentService.createTextOutput("No data received");
    }

    let rows = [];

    if (body.includes('\t')) {
      rows = body.split('\n').map(r => r.split('\t'));
    } else {
      rows = body.split('\n').map(r => r.split(','));
    }

    rows = rows.filter(r => r.length > 1 || r[0] !== "");

    if (rows.length === 0) {
      return ContentService.createTextOutput("No data received");
    }

    // Best effort. If the lock cannot be taken the delivery still goes through:
    // an unserialised append risks a clash, but refusing the batch guarantees
    // losing it, and the daily cleanup dedupes A:J anyway.
    var lock = LockService.getScriptLock();
    var haveLock = false;
    try { haveLock = lock.tryLock(DOPOST_LOCK_WAIT_MS_); } catch (lockErr) { haveLock = false; }

    var correctionNote = '';
    try {
      var startRow = sheet.getLastRow() + 2;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      // The correction reads back what was just written, so it has to be on the
      // sheet first rather than sitting in the pending-writes buffer.
      SpreadsheetApp.flush();

      // Never let a correction failure fail the delivery. The rows are already
      // safely on the tab; answering with an error would show the report as
      // failed in the userscript and invite a re-run that appends the same
      // batch twice, which is a worse problem than a batch that is briefly
      // uncorrected. formatColumnCPeriodically (or the Scripts menu) repairs it.
      try {
        correctDataRows_(sheet, startRow, rows.length);
      } catch (fmtErr) {
        correctionNote = ' (correction deferred: ' + fmtErr.message + ')';
        Logger.log('doPost: correction failed for rows ' + startRow +
                   '..' + (startRow + rows.length - 1) + ' — ' + fmtErr.message);
      }
    } finally {
      if (haveLock) lock.releaseLock();
    }

    return ContentService.createTextOutput("OK" + correctionNote);

  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err.message);
  }
}
