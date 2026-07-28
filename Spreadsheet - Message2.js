function sendGoogleChatMessage2() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Notification2');
  const props = PropertiesService.getScriptProperties();

  // Skip first 5 minutes of each quarter hour
  const minute = new Date().getMinutes();

  if (
    (minute >= 0 && minute < 5) ||
    (minute >= 15 && minute < 30) ||
    (minute >= 30 && minute < 35) ||
    (minute >= 45 && minute < 59)
  ) {
    return;
  }

  // Only send when C1 = ON and D6 = Y
  const c1 = String(sheet.getRange('C1').getDisplayValue()).trim().toUpperCase();
  const d6 = String(sheet.getRange('D6').getDisplayValue()).trim().toUpperCase();

  if (c1 !== 'ON' || d6 !== 'Y') return;

  const today = sheet.getRange('C5').getDisplayValue();
  const updatedBlock = sheet.getRange('F5').getDisplayValue();

  // Prevent duplicate sends
  const signature = `${today}||${updatedBlock}`;
  const lastSignature = props.getProperty('LAST_NOTIFICATION2_SIGNATURE');
  if (signature === lastSignature) return;

  // TopUp Volume values
  const actualOutputRaw = sheet.getRange('D7').getValue();
  const capacityRaw = sheet.getRange('E7').getValue();
  const varianceRaw = sheet.getRange('F7').getValue();

  const actualOutputDisplay = sheet.getRange('D7').getDisplayValue();
  const capacityDisplay = sheet.getRange('E7').getDisplayValue();
  const varianceDisplay = sheet.getRange('F7').getDisplayValue();

  const webAppUrl =
    'https://script.google.com/a/macros/next.co.uk/s/AKfycbwUatgWaCOfsdPiHLV-WgTRN_CqJH9P4eHE7V0ONgQnYU1xoNXIDV4fb1oz8-RJioIF/exec';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-GB') : String(value);
  }

  function isNegative(rawValue, displayValue) {
    const n = Number(rawValue);
    return (!Number.isNaN(n) && n < 0) || String(displayValue).trim().startsWith('-');
  }

  const subtitle = 'Automated live update • ' + today;

  const varianceHtml = isNegative(varianceRaw, varianceDisplay)
    ? '<font color="#D93025"><b>' + escapeHtml(varianceDisplay) + '</b></font>'
    : '<b>' + escapeHtml(varianceDisplay) + '</b>';

  const topUpHtml =
    '<font color="#5F6368">Actual Output</font><br>' +
    '<font color="#D93025"><b>' +
    escapeHtml(formatNumber(actualOutputRaw)) +
    '</b></font>' +
    '<br><br>' +
    '<font color="#5F6368">Capacity</font><br>' +
    '<b>' +
    escapeHtml(formatNumber(Math.ceil(Number(capacityRaw)))) +
    '</b>' +
    '<br><br>' +
    '<font color="#5F6368">Variance</font><br>' +
    varianceHtml;

  const payload = {
    cardsV2: [
      {
        cardId: 'topup-productivity-notification',
        card: {
          header: {
            title: 'E3 TopUp LOW Productivity Notification',
            subtitle: subtitle
          },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text:
                      '<b>TopUp Volume</b> • ' +
                      escapeHtml(updatedBlock)
                  }
                },
                {
                  textParagraph: {
                    text: topUpHtml
                  }
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'OPEN INTERFACE',
                        onClick: {
                          openLink: {
                            url: webAppUrl
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    ]
  };

  // Read webhooks from A2:A
  const urls = sheet
    .getRange('A2:A' + sheet.getLastRow())
    .getDisplayValues()
    .flat()
    .map(v => String(v).trim())
    .filter(v => v);

  if (urls.length === 0) return;

  // Send to all webhooks
  urls.forEach(url => {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  });

  // Log successful send
  logNotification2_(ss, [
    today,
    updatedBlock,
    actualOutputDisplay,
    capacityDisplay,
    varianceDisplay
  ]);

  // Save signature
  props.setProperty('LAST_NOTIFICATION2_SIGNATURE', signature);
}

function logNotification2_(ss, rowValues) {
  const logSheetName = 'Notification2 Log';
  let logSheet = ss.getSheetByName(logSheetName);

  if (!logSheet) {
    logSheet = ss.insertSheet(logSheetName);
    logSheet.getRange(1, 1, 1, 6).setValues([[
      'Logged At',
      'C5',
      'F5',
      'D7',
      'E7',
      'F7'
    ]]);
  }

  logSheet.appendRow([new Date(), ...rowValues]);
}