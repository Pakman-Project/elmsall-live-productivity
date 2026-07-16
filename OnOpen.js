/************************************************************
 * CUSTOM MENU
 ************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Scripts')
    .addItem('Manual Archive', 'confirmRunDailyAutomation')
    .addItem('Import Archive Links', 'refreshArchiveLinks')
    .addItem('Preview Dashboard (Dev)', 'previewDashboard')
    .addItem('Preview Dashboard (Mobile)', 'previewDashboardMobile')
    .addToUi();
}

function previewDashboard() {
  var html = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setWidth(1400)
    .setHeight(850);
  SpreadsheetApp.getUi().showModalDialog(html, 'E3 Live Productivity — Dev Preview');
}

function previewDashboardMobile() {
  var html = HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setWidth(680)
    .setHeight(1300);
  SpreadsheetApp.getUi().showModalDialog(html, 'E3 Live Productivity — Mobile Preview');
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