/************************************************************
 * ARCHIVE LINKS — DRIVE FILE IMPORTER
 *
 * Entry point:
 *   refreshOSLinks()
 *
 * Scans the archive folder (and all subfolders)
 * and writes file metadata to the Links sheet.
 ************************************************************/

const OSLINKS_CFG = {
  LINKS_SHEET_NAME: 'OS Links',
  ARCHIVE_FOLDER_ID: '1JZAqHLl4hAN02rEyAJUC7apAkgwtPXfh',
  LOG_PREFIX: '[LINKS] ',
};

/************************************************************
 * LINKS ENTRY POINT
 ************************************************************/
function refreshOSLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(OSLINKS_CFG.LINKS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(OSLINKS_CFG.LINKS_SHEET_NAME);
  }

  const rootFolder = DriveApp.getFolderById(OSLINKS_CFG.ARCHIVE_FOLDER_ID);
  const data = [
    [
      'File Name',
      'File URL',
      'Folder Name',
      'Folder Path',
      'File Type',
      'Owner',
      'Created Date',
      'Last Updated',
    ],
  ];

  scanFolderTree_(rootFolder, rootFolder.getName(), data);

  const lastRow = sheet.getLastRow();
  if (lastRow > 0) {
    sheet.getRange(1, 1, lastRow, 8).clearContent();
  }
  sheet.getRange(1, 1, data.length, 8).setValues(data);

  logLinks_(`Imported ${data.length - 1} files`);
}

/************************************************************
 * ITERATIVE FOLDER SCAN
 ************************************************************/
function scanFolderTree_(rootFolder, rootPath, out) {
  const stack = [{ f: rootFolder, p: rootPath }];

  while (stack.length > 0) {
    const { f: folder, p: path } = stack.pop();
    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      const owner = file.getOwner();

      out.push([
        file.getName(),
        file.getUrl(),
        folder.getName(),
        path,
        file.getMimeType(),
        owner ? owner.getEmail() : '',
        file.getDateCreated(),
        file.getLastUpdated(),
      ]);
    }

    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      stack.push({ f: sub, p: path + ' / ' + sub.getName() });
    }
  }
}

/************************************************************
 * LINKS LOGGING
 ************************************************************/
function logLinks_(msg) {
  Logger.log(OSLINKS_CFG.LOG_PREFIX + msg);
}