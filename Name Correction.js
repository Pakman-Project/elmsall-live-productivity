function formatColumnCPeriodically() {
  const sheetName = 'Data';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);

  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return;

  const range = sheet.getRange(1, 3, lastRow, 1);
  const values = range.getDisplayValues();

  const timeMap = {
    // AM
    '00:00': '0AM',
    '12:00': '0PM',
    '01:00': '1AM', '1:00': '1AM',
    '02:00': '2AM', '2:00': '2AM',
    '03:00': '3AM', '3:00': '3AM',
    '04:00': '4AM', '4:00': '4AM',
    '05:00': '5AM', '5:00': '5AM',
    '06:00': '6AM', '6:00': '6AM',
    '07:00': '7AM', '7:00': '7AM',
    '08:00': '8AM', '8:00': '8AM',
    '09:00': '9AM', '9:00': '9AM',
    // PM
    '12:00 PM': '0PM', '12:00PM': '0PM',
    '13:00': '1PM', '1:00 PM': '1PM', '1:00PM': '1PM',
    '14:00': '2PM', '2:00 PM': '2PM', '2:00PM': '2PM',
    '15:00': '3PM', '3:00 PM': '3PM', '3:00PM': '3PM',
    '16:00': '4PM', '4:00 PM': '4PM', '4:00PM': '4PM',
    '17:00': '5PM', '5:00 PM': '5PM', '5:00PM': '5PM',
    '18:00': '6PM', '6:00 PM': '6PM', '6:00PM': '6PM',
    '19:00': '7PM', '7:00 PM': '7PM', '7:00PM': '7PM',
    '20:00': '8PM', '8:00 PM': '8PM', '8:00PM': '8PM',
    '21:00': '9PM', '9:00 PM': '9PM', '9:00PM': '9PM'
  };

  const corrected = values.map(row => {
    // Trim whitespace AND convert to ALL CAPS
    let v = String(row[0]).trim().toUpperCase();

    if (!v) return [''];

    // IMPROVED: Fix scientific notation (e.g., 3.00E+03 -> 3E3)
    // This regex looks for numbers, an optional decimal, "E", an optional "+", and the exponent
    const sciMatch = v.match(/^(\d+(?:\.\d+)?)E\+?(\d+)$/i);
    if (sciMatch) {
      let base = sciMatch[1];
      // Strip the decimal point and any trailing zeros (e.g. "3.00" becomes "3")
      base = base.replace(/\.?0+$/, ''); 
      
      // Convert exponent to a number to drop leading zeros (e.g. "03" becomes 3)
      const exponent = Number(sciMatch[2]); 
      return [`${base}E${exponent}`];
    }

    // Fix time conversions
    if (timeMap[v]) {
      return [timeMap[v]];
    }

    return [v];
  });

  // Write the values first
  range.setValues(corrected);
  // THEN force the column to Plain Text to stop Sheets from reverting 3E3 back to 3.00E+03
  range.setNumberFormat('@'); 
}