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

    sheet.getRange(sheet.getLastRow() + 2, 1, rows.length, rows[0].length)
      .setValues(rows);

    return ContentService.createTextOutput("OK");

  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err.message);
  }
}