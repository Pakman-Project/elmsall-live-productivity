/************************************************************
 * CUSTOM MENU
 ************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Scripts')
    .addItem('Manual Archive', 'confirmRunDailyAutomation')
    .addItem('Clean Up Data Tab (today only)', 'confirmDailyDataCleanup')
    .addItem('Import Archive Links', 'refreshArchiveLinks')
    .addItem('Preview Dashboard (Dev)', 'previewDashboard')
    .addItem('Preview Dashboard (Mobile)', 'previewDashboardMobile')
    .addItem('Preview Dashboard (First-time / Tour)', 'previewDashboardFirstTime')
    .addToUi();
}

// The preview runs inside a sandboxed modal-dialog iframe, so clearing the
// tour's "seen" flag from a browser console is unreliable — the console is
// usually pointed at the wrong frame. forceTour lets the caller drive it
// instead: '' normal, '1' force the tour, 'reset' clear the flag then run it.
function showDashboardPreview_(width, height, title, forceTour) {
  var t = HtmlService.createTemplateFromFile('Index');
  t.forceTour = forceTour || '';
  // Deep-link params only arrive via the web app's URL, but every template
  // variable must still be defined here or evaluate() throws.
  t.deepPage = '';
  t.deepBonus = '';
  t.deepDate = '';
  // Still resolve the web-app URL so "Copy link" produces a shareable link even
  // when the dashboard is opened from this preview dialog.
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  t.webAppUrl = url;
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(width).setHeight(height), title);
}

function previewDashboard() {
  showDashboardPreview_(1400, 850, 'E3 Live Productivity — Dev Preview', '');
}

function previewDashboardMobile() {
  showDashboardPreview_(680, 1300, 'E3 Live Productivity — Mobile Preview', '');
}

// Reproduces what a brand-new user sees: clears the "tour seen" flag so the
// tour auto-starts exactly as it does on a genuine first visit.
function previewDashboardFirstTime() {
  showDashboardPreview_(1400, 850, 'E3 Live Productivity — First-time (Tour)', 'reset');
}

function confirmRunDailyAutomation() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Run Daily Automation',
    'This will create an archive, trim data, and refresh Links. Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    runDailyAutomation();
    ui.alert('Archiving completed.');
  }
}