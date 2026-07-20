function forceRebuildProcessedData() {
  // NO-OP: "Processed Data (15mins)" is now written directly by the Databricks
  // pipeline. Neutered so a manual run can't overwrite the tab and race Databricks.
  // To rebuild historical data, re-run the Databricks Backfill notebook instead.
  // Original implementation preserved below under *_LEGACY_UNUSED_ (never called).
  Logger.log('forceRebuildProcessedData: no-op — processing handled by Databricks.');
}

function forceRebuildProcessedData_LEGACY_UNUSED_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var frontSheet = ss.getSheetByName('Front');
  var procSheet = ss.getSheetByName('Processed Data (15mins)');
  var dataSheet = ss.getSheetByName('Data');

  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();

  // 1. Clear existing data in Processed sheet (Row 2 down to Columns A:R)
  var lastProcRow = procSheet.getLastRow();
  if (lastProcRow > 1) {
    procSheet.getRange(2, 1, lastProcRow - 1, 22).clearContent();
  }

  // 2. Clear cached properties so the automated script knows it's a fresh start
  props.deleteProperty('PROC_A2_LAST');
  scriptProps.deleteProperty('LAST_RUN_TIMESTAMP'); 
  props.setProperty('DATA_LAST_ROW', '1');

  var lastDataRow = dataSheet.getLastRow();
  if (lastDataRow < 2) {
    Logger.log("No data found in 'Data' sheet to process.");
    return;
  }

  // 3. Fetch data and setup variables
  var divisor = Number(frontSheet.getRange('C2').getValue()) || 1;
  var dataValues = dataSheet.getRange(2, 1, lastDataRow - 1, 10).getValues();

  var norm = function(v) { return String(v === null || v === undefined ? '' : v).trim(); };

  // 4. Group and calculate data exactly like the normal script
  var aggregates = computeProcessedAggregates_(dataValues);
  var sortedAC = aggregates.sortedAC;
  var sumF = aggregates.sumF;
  var sumE = aggregates.sumE;

  if (sortedAC.length === 0) return;

  var headers = procSheet.getRange('D1:L1').getDisplayValues()[0].map(function(v) { return norm(v); });

  // 5. Build the output rows
  var outputDR = buildProcessedRows_(sortedAC, null, true, sumF, sumE, divisor, headers);

  // 6. Bulk write back to the sheet
  procSheet.getRange(2, 1, sortedAC.length, 3).setValues(sortedAC);
  procSheet.getRange(2, 4, outputDR.length, 19).setValues(outputDR);

  // 7. Update properties to current state
  props.setProperty('PROC_A2_LAST', norm(sortedAC[0][0]));
  props.setProperty('DATA_LAST_ROW', String(lastDataRow));

  Logger.log('Force rebuild complete. Processed and wrote ' + sortedAC.length + ' rows.');
}