/************************************************************
 * CLAIMS EMAIL — 07:00, THE DAY BEFORE YESTERDAY
 *
 * Entry points:
 *   sendClaimsEmail()             on a daily 07:00 trigger
 *   installClaimsEmailTrigger()   run once to put it there
 *
 * On day D this sends the Potential Fraudulent Claims page for the archive
 * dated D-2 - on 24/09 it is "..._Archive_22/09/2026", the production day
 * 22/09 06:00 to 23/09 06:00. Recipients are the live file's
 * 'Claims Email'!A2:A, with the rows attached as a CSV; the same rows are
 * written into that archive's own 'Claims Email' tab from C2 down, headings
 * in C1.
 *
 * The page is not re-implemented here. Its own client files are loaded into a
 * function scope and fraudEmailReportPak_ (Web - JsPageFraud) is called with
 * exactly what the dashboard itself fetches for that archive - so the email
 * says what the page says, and a change to the scan changes both.
 ************************************************************/

var CLAIMS_EMAIL_SHEET_ = 'Claims Email';
var CLAIMS_EMAIL_DAYS_BACK_ = 2;
var CLAIMS_EMAIL_HOUR_ = 7;

// In Index.html's order: each leans on the ones before it. Web - JsState is
// cut before applyConfigToCSSPak (the DOM starts there) and Web - JsInit is
// cut down to decodeSideRowsPak_ alone - the same two cuts the tools/ suites
// make to run these files outside a browser.
var CLAIMS_EMAIL_SOURCES_ = [
  { file: 'Web - JsHelpers' },
  { file: 'Web - JsState', to: 'function applyConfigToCSSPak' },
  { file: 'Web - JsInit', from: 'function decodeSideRowsPak_', to: 'var PAYLOAD_CACHE_KEY' },
  { file: 'Web - JsPageOs' },
  { file: 'Web - JsPageNpl' },
  { file: 'Web - JsPageFraud' }
];

function sendClaimsEmail() {
  sendClaimsEmailFor_(new Date());
}

function sendClaimsEmailFor_(now) {
  var tz = Session.getScriptTimeZone();
  var dayKey = Utilities.formatDate(
    new Date(now.getTime() - CLAIMS_EMAIL_DAYS_BACK_ * 86400000), tz, 'dd/MM/yyyy');

  var url = null;
  var links = getArchiveLinks();
  for (var i = 0; i < links.length; i++) {
    if (links[i].name === dayKey) { url = links[i].url; break; }
  }
  // Thrown, not skipped: a missing archive is the daily automation having not
  // run, and a trigger that fails emails its owner.
  if (!url) throw new Error('Claims email: no archive for ' + dayKey + ' in the Links sheet');

  var os = getOsLogRows([dayKey], url);
  var npl = getNplLogRows([dayKey], url);
  if (os.error) throw new Error('Claims email: OS log - ' + os.error);
  if (npl.error) throw new Error('Claims email: NPL log - ' + npl.error);

  var report = claimsEmailReport_()(dayKey, getDashboardData(url), os.rows, npl.rows);

  var archive = SpreadsheetApp.openByUrl(url);
  var sheet = archive.getSheetByName(CLAIMS_EMAIL_SHEET_) ||
              archive.insertSheet(CLAIMS_EMAIL_SHEET_);
  var width = report.header.length;
  // Cleared first, so a re-run on a day with fewer rows leaves none behind.
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 3, sheet.getLastRow() - 1, width).clearContent();
  }
  sheet.getRange(1, 3, 1, width).setValues([report.header]);
  if (report.rows.length) {
    sheet.getRange(2, 3, report.rows.length, width).setValues(report.rows);
  }

  var recipients = claimsEmailRecipients_();
  if (!recipients.length) {
    throw new Error('Claims email: no recipients in ' + CLAIMS_EMAIL_SHEET_ + '!A2:A');
  }
  MailApp.sendEmail({
    to: recipients.join(','), subject: report.subject, htmlBody: report.html,
    // Dashes, not slashes: a slash in an attachment's name is a folder to
    // some mail clients.
    attachments: [Utilities.newBlob(claimsEmailCsv_([report.header].concat(report.rows)),
                                    'text/csv', report.subject.replace(/\//g, '-') + '.csv')]
  });
  Logger.log('Claims email: ' + report.rows.length + ' rows for ' + dayKey +
             ' to ' + recipients.length + ' recipient(s)');
}

// RFC 4180: a field is quoted when it holds a comma, a quote or a line
// break, and a quote inside one is doubled. Work Areas and TM names both
// carry commas.
function claimsEmailCsv_(rows) {
  return rows.map(function (r) {
    return r.map(function (v) {
      v = String(v == null ? '' : v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',');
  }).join('\r\n');
}

function claimsEmailRecipients_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CLAIMS_EMAIL_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (v) { return v; });
}

// The page's own code, in a scope of its own. new Function rather than eval
// in this file's scope: the client files declare hundreds of globals, and
// here they stay local to this call instead of landing beside the server's.
// `document` is passed as undefined so the files' own typeof guards take the
// no-DOM path. The state the report sets but Web - JsState declares past its
// cut is declared up front, or those assignments would leak onto the
// server's global object.
function claimsEmailReport_() {
  var src = CLAIMS_EMAIL_SOURCES_.map(function (s) {
    var text = HtmlService.createHtmlOutputFromFile(s.file).getContent()
      .replace(/<\/?script>/g, '');
    if (s.from) text = text.slice(text.indexOf(s.from));
    if (s.to) text = text.slice(0, text.indexOf(s.to));
    return text;
  }).join('\n;\n');
  src = 'var timeRanges = [], rawSideData = [], fraudOsRows = [], fraudNplRows = [];\n' + src;
  return new Function('document', src + '\n;return fraudEmailReportPak_;')(undefined);
}

function installClaimsEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendClaimsEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendClaimsEmail').timeBased()
    .everyDays(1).atHour(CLAIMS_EMAIL_HOUR_).nearMinute(0).create();
}
