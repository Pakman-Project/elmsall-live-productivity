/************************************************************
 * ARCHIVE LINKS — NPL DRIVE FILE IMPORTER
 *
 * Entry point:
 *   refreshNPLLinks()
 *
 * Scans the archive folder (and all subfolders)
 * and writes file metadata to the NPL Links sheet.
 * Skips folders named "Archive" and "Spare".
 ************************************************************/

const NPLLINKS_CFG = {
  LINKS_SHEET_NAME: 'NPL Links',
  ARCHIVE_FOLDER_ID: '1upGeMNaPqBgHOIUT_eYP0F_XzSlcFOG2',
  LOG_PREFIX: '[NPL LINKS] ',
  SKIP_FOLDER_NAMES: ['archive', 'spare'], // compared case-insensitively
};

/************************************************************
 * LINKS ENTRY POINT
 ************************************************************/
function refreshNPLLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NPLLINKS_CFG.LINKS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(NPLLINKS_CFG.LINKS_SHEET_NAME);
  }

  const rootFolder = DriveApp.getFolderById(NPLLINKS_CFG.ARCHIVE_FOLDER_ID);
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

  scanNPLFolderTree_(rootFolder, rootFolder.getName(), data);

  const lastRow = sheet.getLastRow();
  if (lastRow > 0) {
    sheet.getRange(1, 1, lastRow, 8).clearContent();
  }
  sheet.getRange(1, 1, data.length, 8).setValues(data);

  logNPLLinks_(`Imported ${data.length - 1} files`);
}

/************************************************************
 * ITERATIVE FOLDER SCAN
 ************************************************************/
function scanNPLFolderTree_(rootFolder, rootPath, out) {
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

      // Skip excluded folders (and everything inside them)
      if (NPLLINKS_CFG.SKIP_FOLDER_NAMES.includes(sub.getName().toLowerCase())) {
        continue;
      }

      stack.push({ f: sub, p: path + ' / ' + sub.getName() });
    }
  }
}

/************************************************************
 * LINKS LOGGING
 ************************************************************/
function logNPLLinks_(msg) {
  Logger.log(NPLLINKS_CFG.LOG_PREFIX + msg);
}