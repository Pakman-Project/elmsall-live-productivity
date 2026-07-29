/************************************************************
 * DATABRICKS DELIVERY ENDPOINT
 *
 * Databricks POSTs a CSV/TSV body here every 15 minutes. One call now carries
 * the whole pipeline through to the tab the dashboard actually reads:
 *
 *   1. append the batch to 'Data'
 *   2. correct it        (column C names, column F hours)
 *   3. derive 'Processed Data (15mins)' from the corrected 'Data'
 *
 * all inside one lock, in one execution.
 *
 * It used to stop after step 1. Correction ran on its own 5-minute trigger,
 * and Databricks then read 'Data' BACK out of the sheet to build 'Processed
 * Data (15mins)' itself. That made the whole thing depend on two independent
 * schedules lining up: if Databricks read before the trigger had fired, it
 * read raw column C values ("3.00E+03" rather than "3E3", "14:00" rather than
 * "2PM"), split one operator into two, and published the result. Nothing
 * detected it, because from Databricks' side the read succeeded.
 *
 * Doing all three steps here removes the round trip rather than tightening its
 * timing. There is no window left to get wrong: the processed tab is built
 * from rows this same execution corrected a few lines earlier.
 *
 * Databricks must therefore no longer write 'Processed Data (15mins)' itself.
 * Two writers on one tab is the same class of race in a new place.
 ************************************************************/

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

    var note = withPipelineLock_('doPost', function () {
      // Inside the lock. Two overlapping deliveries both used to read
      // getLastRow() before either had written, compute the same start row,
      // and the second would overwrite the first.
      var startRow = sheet.getLastRow() + 2;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      // The correction reads back what was just written, so it has to be on
      // the sheet rather than sitting in the pending-writes buffer.
      SpreadsheetApp.flush();

      // Neither of the steps below may fail the delivery. The rows are already
      // safely on 'Data' by this point; answering with an error would invite
      // Databricks to retry and append the same batch twice, which is a worse
      // problem than a tab that is briefly stale. Both are recoverable from
      // the Scripts menu, and the next delivery fixes them anyway.
      var problems = [];

      try {
        correctDataRows_(sheet, startRow, rows.length);
      } catch (fmtErr) {
        problems.push('correction: ' + fmtErr.message);
        Logger.log('doPost: correction failed for rows ' + startRow + '..' +
                   (startRow + rows.length - 1) + ' — ' + fmtErr.message);
      }

      try {
        rebuildProcessedFromData_();
      } catch (procErr) {
        problems.push('processed data: ' + procErr.message);
        Logger.log('doPost: processed-data rebuild failed — ' + procErr.message);
      }

      return problems.length ? ' (deferred — ' + problems.join('; ') + ')' : '';
    });

    return ContentService.createTextOutput("OK" + note);

  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err.message);
  }
}
