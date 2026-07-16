function importFrontData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Notification");

  // Read links from C5:P5
  const links = sheet.getRange("C5:P5").getValues()[0];

  links.forEach((link, i) => {
    if (!link) return;

    try {
      const fileId = String(link).match(/[-\w]{25,}/)[0];

      const sourceSS = SpreadsheetApp.openById(fileId);
      const frontSheet = sourceSS.getSheetByName("Front");

      if (!frontSheet) return;

      // Front!E5:E100 → Notification!C7:P102
      const eValues = frontSheet.getRange("E5:E100").getValues();
      sheet.getRange(7, i + 3, eValues.length, 1).setValues(eValues);

      // Front!O5:O100 → Notification!C106:P201
      const oValues = frontSheet.getRange("O5:O100").getValues();
      sheet.getRange(106, i + 3, oValues.length, 1).setValues(oValues);

    } catch (e) {
      Logger.log(`Failed processing ${link}`);
      Logger.log(e);
    }
  });
}