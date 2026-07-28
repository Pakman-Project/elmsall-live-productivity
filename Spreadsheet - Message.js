function sendGoogleChatMessage() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Notification');
  const props = PropertiesService.getScriptProperties();
  // Skip first 5 minutes of each quarter hour
const minute = new Date().getMinutes();

if (
  (minute >= 0  && minute < 5)  ||
  (minute >= 15 && minute < 20) ||
  (minute >= 30 && minute < 35) ||
  (minute >= 45 && minute < 50)
) {
  return;
}

  // Only send when T1 = ON and U8 = Y
  const t1 = String(sheet.getRange('T1').getDisplayValue()).trim().toUpperCase();
  const u8 = String(sheet.getRange('U8').getDisplayValue()).trim().toUpperCase();
  if (t1 !== 'ON' || u8 !== 'Y') return;

  const today = sheet.getRange('T7').getDisplayValue();
  const updatedBlock = sheet.getRange('U7').getDisplayValue();

  // Prevent duplicate sends if T7 + U7 have not changed since last successful run
  const signature = `${today}||${updatedBlock}`;
  const lastSignature = props.getProperty('LAST_NOTIFICATION_SIGNATURE');
  if (signature === lastSignature) return;

  // PiE Volume values
  const actualOutputRaw = sheet.getRange('U9').getValue();
  const typicalOutputRaw = sheet.getRange('V9').getValue();
  const underTypicalRaw = sheet.getRange('W9').getValue();

  const actualOutputDisplay = sheet.getRange('U9').getDisplayValue();
  const typicalOutputDisplay = sheet.getRange('V9').getDisplayValue();
  const underTypicalDisplay = sheet.getRange('W9').getDisplayValue();

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

  const underTypicalHtml = isNegative(underTypicalRaw, underTypicalDisplay)
    ? '<font color="#D93025"><b>' + escapeHtml(underTypicalDisplay) + '</b></font>'
    : '<b>' + escapeHtml(underTypicalDisplay) + '</b>';

  // Mobile-friendly stacked layout
  const pieVolumeHtml =
    '<font color="#5F6368">Actual Output</font><br>' +
    '<font color="#D93025"><b>' +
    escapeHtml(formatNumber(actualOutputRaw)) +
    '</b></font>' +
    '<br><br>' +
    '<font color="#5F6368">Typical Output</font><br>' +
    '<b>' + escapeHtml(formatNumber(Math.ceil(Number(typicalOutputRaw)))) + '</b>' +
    '<br><br>' +
    '<font color="#5F6368">% Under Typical</font><br>' +
    underTypicalHtml;

  const payload = {
    cardsV2: [
      {
        cardId: 'osr-productivity-notification',
        card: {
          header: {
            title: 'OSR LOW Productivity Notification',
            subtitle: subtitle
          },
          sections: [
            {
              widgets: [
                {
                  textParagraph: {
                    text:
                      '<b>PiE Volume</b></font>' +
                      ' • ' +
                      escapeHtml(updatedBlock)
                  }
                },
                {
                  textParagraph: {
                    text: pieVolumeHtml
                  }
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'OPEN DASHBOARD',
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

  const urls = sheet
    .getRange('Y6:Y' + sheet.getLastRow())
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

  // Log successful send to "Notification Log"
  logNotification_(ss, [
    today,
    updatedBlock,
    actualOutputDisplay,
    typicalOutputDisplay,
    underTypicalDisplay
  ]);

  // Save last successful run signature
  props.setProperty('LAST_NOTIFICATION_SIGNATURE', signature);
}

function logNotification_(ss, rowValues) {
  const logSheetName = 'Notification Log';
  let logSheet = ss.getSheetByName(logSheetName);

  if (!logSheet) {
    logSheet = ss.insertSheet(logSheetName);
    logSheet.getRange(1, 1, 1, 6).setValues([[
      'Logged At',
      'T7',
      'U7',
      'U9',
      'V9',
      'W9'
    ]]);
  }

  const now = new Date();
  logSheet.appendRow([now, ...rowValues]);
}