function updateOSLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const osLogSheet = ss.getSheetByName('OS log');
  
  if (!osLogSheet) {
    SpreadsheetApp.getUi().alert("Sheet 'OS log' was not found.");
    return;
  }
  
  const rawUrl1 = osLogSheet.getRange('B1').getValue();
  const rawUrl2 = osLogSheet.getRange('B2').getValue();
  
  const sourceUrls = [rawUrl1, rawUrl2].filter(val => {
    return typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'));
  });

  if (sourceUrls.length === 0) {
    Logger.log("No valid URLs starting with http:// or https:// were found in 'OS log'!B1 or 'OS log'!B2.");
    return;
  }
  
  // Sheets date epoch: serial 0 = 1899-12-30
  const EPOCH_MS = Date.UTC(1899, 11, 30);
  
  // Convert a Date object back to its underlying numeric serial.
  // e.g. Date(1900-01-05) -> 6 ; Date(1900-01-05 12:00) -> 6.5
  function dateToSerial(v) {
    const ms = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(),
                        v.getHours(), v.getMinutes(), v.getSeconds());
    return Math.round((ms - EPOCH_MS) / 86400000 * 1e6) / 1e6; // round to avoid float drift
  }
  
  // Output row layout (20 columns, A:T):
  //   A–K (idx 0–10) : base mapped columns
  //   L   (idx 11)   : =IF(B, IF(J>=6.5, J-0.5, J), "")
  //   M   (idx 12)   : =IF(L, L*60, "")
  //   N–T (idx 13–19): extra mapped columns
  //
  // A number in baseSelect/extraSelect is a source column INDEX (0 = firstCol);
  // anything else is written through as a literal. calcSelect overrides the two
  // computed columns with literals where a tab has no hours to compute from.
  const SHEET_CONFIGS = [
    {
      sheetName: 'OS Form',
      startRow: 8,
      firstCol: 4,
      numCols: 27,   // D:AD
      baseSelect: [0, 3, 11, 'Indirect', 4, 5, ' ', 7, 9, 20, 25],
      extraSelect: [13, 14, 26, 15, 11, 12, 19],  // Q, R, AD, S, O, P, W
      hourIdx: 20   // source col X -> output J (may arrive Date-formatted)
    },
    {
      sheetName: 'Manual Log',
      startRow: 6,
      firstCol: 4,
      numCols: 23,   // D:Z
      baseSelect: [0, 3, 11, 'Indirect', 4, 5, ' ', 6, 7, 15, 9],
      extraSelect: [9, 10, 22, 13, 11, 12, 14],   // M, N, Z, Q, O, P, R
      hourIdx: 15    // source col S -> output J
    },
    {
      // Spells an operative has STARTED and not yet finished. They carry no
      // finish time by definition, so they can never be placed on a clock and
      // never reach the dashboard's figures - the OS page lists them on a card
      // of their own instead, to be chased. The literal 'Open' in output T is
      // what identifies them there: it is written for every row from this tab
      // whatever the operative typed, which is the only marker that cannot be
      // wrong.
      sheetName: 'Open',
      startRow: 8,
      firstCol: 4,
      numCols: 16,   // D:S
      baseSelect: [0, 3, 11, 'Indirect', 4, 5, '', 7, 9, 10, '-'],
      calcSelect: ['-', '-'],                       // no hours to compute from
      extraSelect: [13, 14, '', 15, 11, 12, 'Open'],  // Q, R, '', S, O, P, 'Open'
      hourIdx: 10    // source col N -> output J
    }
  ];

  let combinedResults = [];
  
  sourceUrls.forEach(url => {
    try {
      const sourceSS = SpreadsheetApp.openByUrl(url);

      SHEET_CONFIGS.forEach(cfg => {
        const sourceSheet = sourceSS.getSheetByName(cfg.sheetName);
        
        if (!sourceSheet) {
          Logger.log("Sheet '" + cfg.sheetName + "' not found in document: " + url);
          return;
        }
        
        const lastRow = sourceSheet.getLastRow();
        if (lastRow < cfg.startRow) return;

        const numRows = lastRow - cfg.startRow + 1;
        const data = sourceSheet.getRange(cfg.startRow, cfg.firstCol, numRows, cfg.numCols).getValues();
        
        const mapped = data
          .filter(row => row[0] !== "" && row[0] !== null && row[0] !== undefined)
          .map(rawRow => {
            // Normalize the hours column: Date -> numeric serial (fixes 05/01/1900)
            const row = rawRow.slice();
            if (row[cfg.hourIdx] instanceof Date) {
              row[cfg.hourIdx] = dateToSerial(row[cfg.hourIdx]);
            }
            
            const pick = spec => typeof spec === 'number' ? row[spec] : spec;
            const base = cfg.baseSelect.map(pick);    // A:K
            const extra = cfg.extraSelect.map(pick);  // N:T

            // L = IFERROR(IF(B<>, IF(J>=6.5, J-0.5, J), ""), "")
            let l = "";
            if (base[1]) {                    // output column B
              const rawJ = base[9];           // output column J (now numeric)
              if (rawJ !== "" && rawJ !== null && rawJ !== undefined) {
                const j = Number(rawJ);
                if (!isNaN(j)) l = (j >= 6.5) ? j - 0.5 : j;
              }
            }

            // M = IF(L<>, L*60, "")
            const m = l ? l * 60 : "";

            const calc = cfg.calcSelect ? cfg.calcSelect.slice() : [l, m];
            return base.concat(calc, extra);
          });
        
        combinedResults = combinedResults.concat(mapped);
      });
    } catch (e) {
      Logger.log("Error processing URL (" + url + "): " + e.message);
    }
  });

  // Clear existing output starting at 'OS log'!A7 (25 cols wide to wipe legacy layout)
  const lastTargetRow = osLogSheet.getLastRow();
  if (lastTargetRow >= 7) {
    osLogSheet.getRange(7, 1, lastTargetRow - 6, 25).clearContent();
  }
  
  if (combinedResults.length > 0) {
    // Column B is the bonus code, and setValues PARSES a string the way typing
    // it would unless the cell is already formatted as text. Left to itself it
    // stored "1AM" as the time serial 1/24 and "1E8" as 100000000, on every
    // refresh, in the one column the whole OS feature joins on - and a mangled
    // code there does not fail. It silently matches no operator, and that
    // person's indirect work is simply absent from the dashboard.
    //
    // Formatted first, so nothing new is mangled. The same fix, for the same
    // reason, as correctNameColumn_ in 'Spreadsheet - Name Correction.js'.
    osLogSheet.getRange(7, 2, combinedResults.length, 1).setNumberFormat('@');
    osLogSheet.getRange(7, 1, combinedResults.length, 20).setValues(combinedResults);

    // And repair what earlier runs already damaged. Called here rather than
    // put on a trigger of its own: this way the two run in one execution, in
    // order, which is the only ordering guarantee available - a scheduled
    // correction could land mid-rewrite.
    try {
      var fixed = correctOsLogNames();
      if (fixed) Logger.log('OS log: ' + fixed + ' bonus code(s) corrected');
    } catch (e) {
      // Never fail the rebuild for the correction: a mangled code costs one
      // operator's band, an exception here costs the whole log.
      Logger.log('OS log name correction failed: ' + e.message);
    }
  }
}