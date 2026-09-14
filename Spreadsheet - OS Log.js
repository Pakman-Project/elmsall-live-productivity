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
  
  // Output row layout (25 columns, A:Y):
  //   A–M   (idx 0–12) : base mapped columns
  //   N, O  (idx 13–14): left empty
  //   P     (idx 15)   : =IF(B, IF(L>=6.5, L-0.5, L), "")
  //   Q     (idx 16)   : =IF(P, P*60, "")
  //   R     (idx 17)   : left empty
  //   S–Y   (idx 18–24): extra mapped columns
  const SHEET_CONFIGS = [
    {
      sheetName: 'OS Form',
      startRow: 8,
      firstCol: 4,
      numCols: 27,   // D:AD
      baseSelect: [0, 1, 2, 3, 11, 'Indirect', 4, 5, ' ', 7, 9, 20, 25],
      extraSelect: [13, 14, 26, 15, 11, 12, 19]  // Q, R, AD, S, O, P, W
    },
    {
      sheetName: 'Manual Log',
      startRow: 6,
      firstCol: 4,
      numCols: 23,   // D:Z
      baseSelect: [0, 1, 2, 3, 11, 'Indirect', 4, 5, ' ', 6, 7, 15, 9],
      extraSelect: [9, 10, 22, 13, 11, 12, 14]   // M, N, Z, Q, O, P, R
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
          .map(row => {
            const base = cfg.baseSelect.map(spec => typeof spec === 'number' ? row[spec] : spec); // A:M
            const extra = cfg.extraSelect.map(i => row[i]);                                       // S:Y
            
            // P = IFERROR(IF(B<>, IF(L>=6.5, L-0.5, L), ""), "")
            let p = "";
            if (base[1]) {                    // output column B
              const rawL = base[11];          // output column L  <-- was base[12] (M)
              if (rawL !== "" && rawL !== null && rawL !== undefined) {
                const l = Number(rawL);
                if (!isNaN(l)) p = (l >= 6.5) ? l - 0.5 : l;
              }
            }
            
            // Q = IF(P<>, P*60, "")
            const q = p ? p * 60 : "";
            
            return base.concat(["", "", p, q, ""], extra);
          });
        
        combinedResults = combinedResults.concat(mapped);
      });
    } catch (e) {
      Logger.log("Error processing URL (" + url + "): " + e.message);
    }
  });

  // Clear existing output starting at 'OS log'!A7 (25 columns)
  const lastTargetRow = osLogSheet.getLastRow();
  if (lastTargetRow >= 7) {
    osLogSheet.getRange(7, 1, lastTargetRow - 6, 25).clearContent();
  }
  
  if (combinedResults.length > 0) {
    osLogSheet.getRange(7, 1, combinedResults.length, 25).setValues(combinedResults);
  }
}