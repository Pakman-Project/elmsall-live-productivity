function updateOSLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const osLogSheet = ss.getSheetByName('OS log');
  
  if (!osLogSheet) {
    SpreadsheetApp.getUi().alert("Sheet 'OS log' was not found.");
    return;
  }
  
  // Read URLs/IDs directly from 'OS log'!B1 and 'OS log'!B2
  const rawUrl1 = osLogSheet.getRange('B1').getValue();
  const rawUrl2 = osLogSheet.getRange('B2').getValue();
  
  // Filter out empty cells and non-URL values
  const sourceUrls = [rawUrl1, rawUrl2].filter(val => {
    return typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'));
  });

  if (sourceUrls.length === 0) {
    Logger.log("No valid URLs starting with http:// or https:// were found in 'OS log'!B1 or 'OS log'!B2.");
    return;
  }
  
  let combinedResults = [];
  
  sourceUrls.forEach(url => {
    try {
      const sourceSS = SpreadsheetApp.openByUrl(url);
      const sourceSheet = sourceSS.getSheetByName('Approved Records');
      
      if (!sourceSheet) {
        Logger.log("Sheet 'Approved Records' not found in document: " + url);
        return;
      }
      
      const lastRow = sourceSheet.getLastRow();
      if (lastRow < 6) return; // Skip if no data below row 5
      
      // Range B6:Z (Columns 2 to 26 -> 25 columns total)
      // Column B = index 0 (Col1)
      // Column W = index 21 (Col22)
      const data = sourceSheet.getRange(6, 2, lastRow - 5, 25).getValues();
      
      const filtered = data.filter(row => {
        const colB = row[0];   // Column B (Col1)
        const colW = row[21];  // Column W (Col22)
        
        const isBNotNull = colB !== "" && colB !== null && colB !== undefined;
        const isWOK = String(colW).trim().toLowerCase() === 'ok';
        
        return isBNotNull && isWOK;
      });
      
      combinedResults = combinedResults.concat(filtered);
    } catch (e) {
      Logger.log("Error processing URL (" + url + "): " + e.message);
    }
  });

  // Clear existing old output starting at 'OS log'!A7 downwards across 25 columns
  const lastTargetRow = osLogSheet.getLastRow();
  if (lastTargetRow >= 7) {
    osLogSheet.getRange(7, 1, lastTargetRow - 6, 25).clearContent();
  }
  
  // Write the combined results starting at 'OS log'!A7
  if (combinedResults.length > 0) {
    osLogSheet.getRange(7, 1, combinedResults.length, combinedResults[0].length).setValues(combinedResults);
  }
}