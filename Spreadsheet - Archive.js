/************************************************************
 * MASTER AUTOMATION — DAILY ARCHIVE
 *
 * Entry point:
 *   runDailyAutomation()
 *
 * Strategy:
 * 1. Sort Data!A2:<used width> by Column J (Date Time Range)
 * 2. Read only Data!A:A to get row date keys
 * 3. For each past date:
 *    - make archive copy
 *    - clear every row that is not that date
 *    - set Front!B2
 * 4. Live file keeps ONLY today by clear all other rows, sort Data again by Column J
 * 5. Refresh the Links sheet with current archive files
 ************************************************************/

const ARCHIVE_CFG = {
  DATA_SHEET_NAME: 'Data',
  PROCESSED_SHEET_NAME: 'Processed Data (15mins)',
  // Width of 'Processed Data (15mins)' is NOT fixed here: it is A:C (keys) plus
  // two blocks that grow by one column each time a work area is added — 22
  // columns for 9 areas, 24 for 10. A constant that lags the tab silently
  // excludes the newest area's columns from the clear and, worse, from the sort,
  // which would shear those two columns away from the rows they belong to.
  // Read from the tab instead; see processedSheetCols_.
  PROCESSED_SHEET_COLS_FALLBACK: 22,
  // The same rows as 'Processed Data (15mins)', joined into one column, which
  // is what the dashboard actually reads - 57x fewer cells, and it turned a
  // 43-second load into a few seconds. A whole-file copy brings it along with
  // every other tab, holding every date the live tab held, so it needs the
  // same trim. One column wide, and its column A starts with the same window
  // string, so processedWindowDateKey_ parses a joined row unchanged.
  BACKEND_SHEET_NAME: 'Backend',
  BACKEND_SHEET_COLS: 1,
  FRONT_SHEET_NAME: 'Front',
  // 'Date Time Range' on the Data tab, the time-block key everything downstream
  // orders by. Column J since the Attribute column was inserted after Event
  // Type; it was I before.
  DATA_SORT_COLUMN: 10,
  ARCHIVE_FOLDER_ID: '1eFML5s-EdF0mpImJoAv_2I0yobxpm0vt',
  HEADER_ROWS: 1,
  FILE_DATE_FORMAT: 'dd/MM/yyyy',
  DATE_KEY_FORMAT: 'yyyy/MM/dd',
  OUTPUT_DATE_FORMAT: 'dd/MM/yyyy HH:mm:ss',
  LOG_PREFIX: '[DAILY-AUTO] ',
  DEBUG: false,
};

/************************************************************
 * ENTRY POINT
 ************************************************************/
function runDailyAutomation() {
  const lock = LockService.getScriptLock();
  const started = Date.now();
  log_('START');

  if (!lock.tryLock(60000)) {
    throw new Error('Another automation run is already in progress.');
  }

  try {
    archivePastDatesAndTrimLive_();

    // The archives' own OS/NPL logs, refreshed against their source workbooks.
    // Runs here rather than on a trigger of its own so there is nothing new to
    // schedule, and so it is guaranteed to come after refreshArchiveLinks()
    // above - that tab is what it reads to find the recent archives, and a
    // brand-new archive is not in it until that call.
    //
    // Handed this execution's start time, not its own: the six-minute limit
    // covers everything above as well, so a budget measured from here would
    // let the pair overrun together.
    refreshRecentArchiveLogs(started);

    log_('DONE');
  } catch (err) {
    log_('ERROR: ' + (err?.message || err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/************************************************************
 * ARCHIVE + LIVE TRIM
 ************************************************************/
function archivePastDatesAndTrimLive_() {
  const liveSS = SpreadsheetApp.getActiveSpreadsheet();
  const tz = liveSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

  const today = startOfDay_(new Date());
  const todayKey = dateKey_(today, tz);

  log_(`Today=${todayKey}`);

  const liveSheet = getSheetOrThrow_(liveSS, ARCHIVE_CFG.DATA_SHEET_NAME);
  const lastRow = liveSheet.getLastRow();

  if (lastRow <= ARCHIVE_CFG.HEADER_ROWS) {
    log_('No data to process.');
    return;
  }

  /* ---------------------------------------------------------
   * SORT the Data rows by Column J before reading/processing
   * --------------------------------------------------------- */
  const dataStartRow = ARCHIVE_CFG.HEADER_ROWS + 1;
  const numDataRows = lastRow - ARCHIVE_CFG.HEADER_ROWS;
  // Sort the full USED width rather than a fixed count. The tab was ten columns
  // wide, then eleven once Attribute was inserted, and a sort narrower than the
  // data shears the columns it misses away from the rows they belong to —
  // silently, and only for the rows that actually moved.
  const dataCols = Math.max(liveSheet.getLastColumn(), ARCHIVE_CFG.DATA_SORT_COLUMN);
  log_(`Sorting Data rows ${dataStartRow}-${lastRow} (${dataCols} cols) by Column J...`);
  liveSheet.getRange(dataStartRow, 1, numDataRows, dataCols)
           .sort({ column: ARCHIVE_CFG.DATA_SORT_COLUMN, ascending: true });
  log_('Sort complete.');
  /* --------------------------------------------------------- */

  const dateValues = liveSheet.getRange(dataStartRow, 1, numDataRows, 1).getValues();

  const { pastDates, rowKeys } = processRows_(dateValues, tz, todayKey);

  log_(`Past dates: ${pastDates.size}`);

  const existingArchives = getExistingArchiveNames_();
  logDebug_(`Existing archives: ${existingArchives.size}`);

  createArchivesClearRows_(
    liveSS,
    tz,
    pastDates,
    existingArchives,
    rowKeys,
    dataStartRow
  );

  // ONLY keep today's rows - clear everything else, then re-sort so the
  // kept rows compact to the top and cleared (blank) rows sink to the bottom
  trimLiveByClearingRows_(
    liveSheet,
    rowKeys,
    dataStartRow,
    new Set([todayKey])
  );

  log_('Archive + live trim complete.');

  /* ---------------------------------------------------------
   * REOPEN ANY OF TODAY'S WINDOWS THIS REWRITE ERASED
   *
   * The trim above rewrites every row of Data from an in-memory copy, so a
   * Databricks append that landed between the read and the write is gone. Run
   * immediately, in this same execution, so the ordering between the two
   * systems never has to be coordinated. See reconcilePipelineStateWithData_.
   * --------------------------------------------------------- */
  var reopened = reconcilePipelineStateWithData_();
  if (reopened > 0) {
    log_(`Reopened ${reopened} window(s) erased by the trim; Databricks will refill them.`);
  }

  /* ---------------------------------------------------------
   * REFRESH ARCHIVE LINKS AT THE END
   * --------------------------------------------------------- */
  log_('Refreshing archive links...');
  refreshArchiveLinks();
}

/************************************************************
 * PROCESS ROWS
 ************************************************************/
function processRows_(dateValues, tz, todayKey) {
  const pastDates = new Map();
  const rowKeys = new Array(dateValues.length);
  const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const cache = new Map();

  for (let i = 0; i < dateValues.length; i++) {
    const key = parseDateKeyFast_(dateValues[i][0], tz, cache, dateRegex);
    rowKeys[i] = key;

    if (key && key < todayKey && !pastDates.has(key)) {
      pastDates.set(key, keyToDate_(key));
    }
  }

  const sortedPastDates = new Map(
    [...pastDates.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  );

  return { pastDates: sortedPastDates, rowKeys };
}

/************************************************************
 * CREATE ARCHIVES: CLEAR ONLY
 ************************************************************/
function createArchivesClearRows_(
  liveSS,
  tz,
  pastDates,
  existingArchives,
  rowKeys,
  dataStartRow
) {
  if (pastDates.size === 0) return;

  const sourceFile = DriveApp.getFileById(liveSS.getId());
  const archiveFolder = DriveApp.getFolderById(ARCHIVE_CFG.ARCHIVE_FOLDER_ID);
  const baseName = liveSS.getName();

  for (const [dateKey, dateObj] of pastDates) {
    const fileDateText = Utilities.formatDate(dateObj, tz, ARCHIVE_CFG.FILE_DATE_FORMAT);
    const archiveName = `${baseName}_Archive_${fileDateText}`;

    if (existingArchives.has(archiveName)) {
      logDebug_(`Skip: ${archiveName}`);
      continue;
    }

    log_(`Creating: ${archiveName}`);

    const archiveFile = sourceFile.makeCopy(archiveName, archiveFolder);
    const archiveSS = SpreadsheetApp.openById(archiveFile.getId());
    const archiveSheet = getSheetOrThrow_(archiveSS, ARCHIVE_CFG.DATA_SHEET_NAME);

    const clearBlocks = getClearBlocks_(rowKeys, dataStartRow, new Set([dateKey]));
    logDebug_(`Clear blocks: ${clearBlocks.length}`);

    applyClearBlocks_(archiveSheet, clearBlocks);

    // The copy is taken of the WHOLE live file, so its Processed Data tab
    // arrives holding every date the live tab held — including days that have
    // their own archive, and today's rows, which belong to neither. Trim it to
    // this archive's date so the file is internally consistent: Data and
    // Processed Data describing the same day, and nothing else.
    const procCleared = trimArchiveProcessedData_(archiveSS, dateKey);
    logDebug_(`Processed Data rows cleared: ${procCleared}`);

    // Both tabs or neither. Trimming one and not the other leaves an archive
    // whose two copies of the same day disagree about which days they hold -
    // and since the dashboard prefers Backend, it would be the UNTRIMMED one
    // being read.
    const backendCleared = trimArchiveProcessedData_(
      archiveSS, dateKey, ARCHIVE_CFG.BACKEND_SHEET_NAME, ARCHIVE_CFG.BACKEND_SHEET_COLS);
    logDebug_(`Backend rows cleared: ${backendCleared}`);

    setArchiveB2_(archiveSS, dateObj);

    shareArchiveLikeLiveFile_(sourceFile, liveSS, archiveFile, archiveSS);

    log_(`Done: ${archiveName}`);
  }
}

/************************************************************
 * SHARE THE ARCHIVE LIKE THE LIVE FILE
 *
 * A fresh copy is NOT shared with anyone the live file is shared with — Drive
 * sharing does not carry over to a makeCopy(), and a protected range/sheet's
 * editor list resets to whoever ran the copy rather than keeping the live
 * file's list. Both have to be reapplied by hand, every time.
 *
 * Deliberately reads WHO already has access on the live file rather than
 * naming anyone here: the Databricks service account and the handful of
 * people with the same standing access are a fact about the live file, not
 * a fact this script should have its own opinion about. Add someone to the
 * live file and every archive created after that inherits it automatically.
 *
 * Matched by POSITION, not by range/coordinates: a protection on the archive
 * is the copy of the live protection at the same index in the same sheet
 * (same creation order, same count, straight out of makeCopy()), so there is
 * no need to compare what each one actually protects.
 ************************************************************/
function shareArchiveLikeLiveFile_(sourceFile, liveSS, archiveFile, archiveSS) {
  try {
    sourceFile.getEditors().forEach((user) => {
      const email = user.getEmail();
      if (!email) return;
      try {
        archiveFile.addEditor(email);
      } catch (e) {
        logDebug_(`Could not add ${email} as a file editor: ${e}`);
      }
    });
  } catch (e) {
    logDebug_(`Could not read the live file's editors: ${e}`);
  }

  let granted = 0;
  let failed = 0;
  liveSS.getSheets().forEach((liveSheet) => {
    const archiveSheet = archiveSS.getSheetByName(liveSheet.getName());
    if (!archiveSheet) return;
    [SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE].forEach((type) => {
      const liveProts = liveSheet.getProtections(type);
      const archiveProts = archiveSheet.getProtections(type);
      const n = Math.min(liveProts.length, archiveProts.length);
      if (liveProts.length !== archiveProts.length) {
        logDebug_(`${liveSheet.getName()}: ${liveProts.length} ${type} protection(s) live, ` +
                  `${archiveProts.length} on the copy - only the first ${n} matched`);
      }
      for (let i = 0; i < n; i++) {
        liveProts[i].getEditors().forEach((user) => {
          const email = user.getEmail();
          if (!email) return;
          try {
            archiveProts[i].addEditor(email);
            granted++;
          } catch (e) {
            failed++;
            logDebug_(`Could not add ${email} to a ${type} protection on ` +
                      `${liveSheet.getName()}: ${e}`);
          }
        });
      }
    });
  });
  logDebug_(`Protection editors carried over: ${granted}` + (failed ? `, ${failed} failed` : ''));
}

/************************************************************
 * TRIM AN ARCHIVE'S 'Processed Data (15mins)' TO ITS OWN DATE
 *
 * Column A holds the window, "30/07/2026 00:00 - 30/07/2026 00:15". The day a
 * window belongs to is the day it STARTS, which is why only the first date in
 * the string is read: the 23:45 window of one day ends at 00:00 of the next
 * and would otherwise be filed a day late.
 *
 * Only ever called on an archive COPY, never on the live tab. Databricks
 * rebuilds the live Processed Data in full every fifteen minutes, so anything
 * cleared there would simply come back — and clearing it would be a second
 * writer on a tab that deliberately has one.
 ************************************************************/
function trimArchiveProcessedData_(archiveSS, dateKey, sheetName, forcedCols) {
  const name = sheetName || ARCHIVE_CFG.PROCESSED_SHEET_NAME;
  const sheet = archiveSS.getSheetByName(name);
  if (!sheet) {
    log_(`No '${name}' tab in the archive; nothing to trim.`);
    return 0;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= ARCHIVE_CFG.HEADER_ROWS) return 0;

  const startRow = ARCHIVE_CFG.HEADER_ROWS + 1;
  const numRows = lastRow - ARCHIVE_CFG.HEADER_ROWS;

  const windows = sheet.getRange(startRow, 1, numRows, 1).getDisplayValues();

  const rowKeys = new Array(numRows);
  let readable = 0;
  for (let i = 0; i < numRows; i++) {
    const key = processedWindowDateKey_(windows[i][0]);
    rowKeys[i] = key;
    if (key) readable++;
  }

  // Guard against a format change quietly emptying the tab. Rows that hold no
  // readable window at all mean column A has changed shape rather than aged
  // out, and wiping everything is the wrong response to that. A tab where every
  // row parses but none matches this date is a different thing entirely and is
  // allowed through — that is simply a day with no processed rows left.
  if (readable === 0) {
    log_(`WARNING: no readable window in column A of '${name}' ` +
         `(checked ${numRows} rows). Format may have changed. Left untouched.`);
    return 0;
  }

  const clearBlocks = getClearBlocks_(rowKeys, startRow, new Set([dateKey]));

  let cleared = 0;
  for (let i = 0; i < clearBlocks.length; i++) cleared += clearBlocks[i][1];

  // One column for Backend; the wide tab asks the tab itself, since an old
  // archive is genuinely narrower than today's live one.
  const procCols = forcedCols || processedSheetCols_(sheet);

  applyClearBlocks_(sheet, clearBlocks, procCols);

  // Sorted so the kept rows compact to the top and the blanks sink, matching
  // what the live trim does to Data.
  if (cleared > 0 && cleared < numRows) {
    sheet.getRange(startRow, 1, numRows, procCols)
         .sort({ column: 1, ascending: true });
  }

  return cleared;
}

/**
 * How wide 'Processed Data (15mins)' actually is on THIS file.
 *
 * Archives are frozen copies, so an old one is genuinely narrower than today's
 * live tab and must be trimmed and sorted at its own width — a hard-coded
 * number is wrong for every file that is not the current layout.
 *
 * getLastColumn() is the tab's own answer. The fallback only covers a tab so
 * empty that it reports nothing, where the width is academic anyway.
 */
function processedSheetCols_(sheet) {
  const cols = sheet.getLastColumn();
  return cols > 0 ? cols : ARCHIVE_CFG.PROCESSED_SHEET_COLS_FALLBACK;
}

/**
 * "30/07/2026 00:00 - 30/07/2026 00:15" -> "2026/07/30", matching the keys
 * parseDateKeyFast_ and dateKey_ produce so they can be compared directly.
 * Anchored at the start of the string, so it reads the window's start date.
 */
function processedWindowDateKey_(display) {
  const s = String(display === null || display === undefined ? '' : display).trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return null;

  return `${m[3]}/${m[2].padStart(2, '0')}/${m[1].padStart(2, '0')}`;
}

/************************************************************
 * TRIM LIVE: CLEAR, THEN RE-SORT
 ************************************************************/
function trimLiveByClearingRows_(sheet, rowKeys, startRow, allowedKeys) {
  const clearBlocks = getClearBlocks_(rowKeys, startRow, allowedKeys);
  logDebug_(`Live clear blocks: ${clearBlocks.length}`);

  // Calculate total rows that would be cleared
  let totalToClear = 0;
  for (let i = 0; i < clearBlocks.length; i++) {
    totalToClear += clearBlocks[i][1];
  }

  // If we'd clear ALL rows, skip so we don't wipe the live sheet's data
  // entirely. This happens at midnight when today's data hasn't arrived yet.
  if (totalToClear >= rowKeys.length) {
    log_('WARNING: No rows match the keep-set. Skipping live trim to preserve data.');
    return;
  }

  applyClearBlocks_(sheet, clearBlocks);

  // Re-sort by Column J so today's kept rows compact to the top and the
  // now-blank cleared rows sink to the bottom. Full used width, for the same
  // reason as the sort in archivePastDatesAndTrimLive_.
  const trimCols = Math.max(sheet.getLastColumn(), ARCHIVE_CFG.DATA_SORT_COLUMN);
  sheet.getRange(startRow, 1, rowKeys.length, trimCols)
       .sort({ column: ARCHIVE_CFG.DATA_SORT_COLUMN, ascending: true });
}

/************************************************************
 * BUILD CLEAR BLOCKS
 ************************************************************/
function getClearBlocks_(rowKeys, startRow, allowedKeys) {
  const blocks = [];
  let blockStart = null;

  for (let i = 0; i < rowKeys.length; i++) {
    const rowNum = startRow + i;
    const keep = rowKeys[i] && allowedKeys.has(rowKeys[i]);

    if (!keep) {
      if (blockStart === null) blockStart = rowNum;
    } else if (blockStart !== null) {
      blocks.push([blockStart, rowNum - blockStart]);
      blockStart = null;
    }
  }

  if (blockStart !== null) {
    blocks.push([blockStart, startRow + rowKeys.length - blockStart]);
  }

  return blocks;
}

/************************************************************
 * APPLY CLEAR BLOCKS
 * Order doesn't matter here — clearing content never shifts rows,
 * unlike deleteRows() which required bottom-up application.
 ************************************************************/
function applyClearBlocks_(sheet, blocks, width) {
  // Defaults to the Data tab's 11 columns, which is what every existing caller
  // wants; Processed Data passes its own 22.
  const cols = width || 11;
  for (let i = 0; i < blocks.length; i++) {
    const [row, count] = blocks[i];
    if (count > 0) {
      sheet.getRange(row, 1, count, cols).clearContent();
    }
  }
}

/************************************************************
 * FAST DATE KEY PARSER
 ************************************************************/
function parseDateKeyFast_(value, tz, cache, regex) {
  if (value == null || value === '') return null;

  const cacheKey = value instanceof Date ? `D:${value.getTime()}` : `S:${String(value).trim()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let key = null;

  if (value instanceof Date) {
    key = dateKey_(value, tz);
  } else {
    const s = String(value).trim();
    const m = s.match(regex);
    if (m) {
      key = `${m[3]}/${m[2].padStart(2, '0')}/${m[1].padStart(2, '0')}`;
    }
  }

  cache.set(cacheKey, key);
  return key;
}

/************************************************************
 * BATCH EXISTING ARCHIVE CHECK
 ************************************************************/
function getExistingArchiveNames_() {
  const folder = DriveApp.getFolderById(ARCHIVE_CFG.ARCHIVE_FOLDER_ID);
  const existing = new Set();
  const files = folder.getFiles();

  while (files.hasNext()) {
    existing.add(files.next().getName());
  }

  return existing;
}

/************************************************************
 * SET ARCHIVE Front!B2
 ************************************************************/
function setArchiveB2_(ss, archiveDate) {
  const frontSheet = ss.getSheetByName(ARCHIVE_CFG.FRONT_SHEET_NAME);
  if (!frontSheet) return;

  const nextDay = new Date(archiveDate);
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(0, 0, 0, 0);

  frontSheet.getRange('B2').setValue(nextDay).setNumberFormat(ARCHIVE_CFG.OUTPUT_DATE_FORMAT);
}

/************************************************************
 * UTILITIES
 ************************************************************/
function getSheetOrThrow_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet "${name}" not found.`);
  return sheet;
}

function keyToDate_(key) {
  const p = key.split('/');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function dateKey_(date, tz) {
  return Utilities.formatDate(date, tz, ARCHIVE_CFG.DATE_KEY_FORMAT);
}

function startOfDay_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function log_(msg) {
  Logger.log(ARCHIVE_CFG.LOG_PREFIX + msg);
}

function logDebug_(msg) {
  if (ARCHIVE_CFG.DEBUG) Logger.log(ARCHIVE_CFG.LOG_PREFIX + '[DBG] ' + msg);
}


/************************************************************
 * ARCHIVE LINKS — DRIVE FILE IMPORTER
 *
 * Entry point:
 *   refreshArchiveLinks()
 *
 * Scans the archive folder (and all subfolders)
 * and writes file metadata to the Links sheet.
 ************************************************************/

const LINKS_CFG = {
  LINKS_SHEET_NAME: 'Links',
  ARCHIVE_FOLDER_ID: '1eFML5s-EdF0mpImJoAv_2I0yobxpm0vt',
  LOG_PREFIX: '[LINKS] ',
};

/************************************************************
 * LINKS ENTRY POINT
 ************************************************************/
function refreshArchiveLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LINKS_CFG.LINKS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(LINKS_CFG.LINKS_SHEET_NAME);
  }

  const rootFolder = DriveApp.getFolderById(LINKS_CFG.ARCHIVE_FOLDER_ID);
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
  Logger.log(LINKS_CFG.LOG_PREFIX + msg);
}