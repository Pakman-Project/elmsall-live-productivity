/************************************************************
 * ARCHIVE LIVE LINKS — the OS and NPL logs, traced for 8 days
 *
 * An archive is a frozen copy of a day. Its OS and NPL Log tabs are not, or
 * not at first: approvals and corrections keep arriving for days after the day
 * itself, and a copy taken at 03:00 holds whatever had been typed by 03:00.
 *
 * So the two log ranges are replaced, on creation, by an IMPORTRANGE that
 * traces the LIVE file's own log tabs and filters them to this archive's date.
 * No trigger has to run in the archive for that to keep working.
 *
 * WHY IT IMPORTS THE LIVE FILE RATHER THAN THE SOURCE WORKBOOKS
 * The obvious formula reaches straight past the live file to the OS/NPL source
 * workbooks. It should not. 'Spreadsheet - OS Log.js' maps three tabs across
 * two workbooks through SHEET_CONFIGS - seven select lists, interleaved
 * literals, two computed columns - and 'Spreadsheet - NPL Log.js' filters its
 * weekly links by date. A formula reaching the sources would be a SECOND copy
 * of all of that, in a string, and Code.js already records what happens when
 * those column positions shift: "the log went from 25 columns to 20".
 *
 * The live file's log tabs are that mapping, already applied and kept current
 * by the updater on its own trigger, and nothing trims them to today - they
 * hold every day their sources hold. So the archive filters them by date and
 * the mapping stays in exactly one place.
 *
 * WHY IT IS FROZEN AFTER EIGHT DAYS
 * The NPL weekly links are ROLLING files. Once one rolls past this archive's
 * date the live log loses those rows, and a formula tracing it would not go
 * stale - it would go EMPTY, which is worse than stale because it looks like
 * an answer. freezeExpiredArchiveLinks() writes the values down before that
 * can happen, and the archive becomes a real record again.
 ************************************************************/

const ARCHIVE_LINKS_CFG = {
  // Matched case-insensitively: the tab is 'OS log' in the file and 'OS Log'
  // in conversation, and getSheetByName is exact. The same trap Code.js
  // documents on the reading side.
  LOGS: [
    { name: 'os log',  firstRow: 7, numCols: 20 },   // A:T
    { name: 'npl log', firstRow: 7, numCols: 16 }    // A:P
  ],
  // How long an archive keeps tracing. Eight days because that is how long
  // late approvals actually take to stop arriving; past it the rolling source
  // files are the risk, not the paperwork.
  TRACE_DAYS: 8,
  LOG_PREFIX: '[ARCHIVE-LINKS] ',
};

/************************************************************
 * THE FORMULA
 *
 * Pure string work, and the only part of this file that can be tested without
 * Drive - see tools/test_archivelinks.js.
 *
 * TEXT() rather than a QUERY date literal, because the Date column arrives as
 * a real date from some source tabs and as dd/mm/yyyy text from others, and
 * `where Col1 = date '...'` silently matches nothing against the text ones.
 * TEXT() of a date formats it; TEXT() of that same string returns it unchanged.
 * One comparison that is right either way.
 *
 * LET so IMPORTRANGE is evaluated once rather than once per reference: it is
 * the expensive part, and FILTER needs both the block and its first column.
 *
 * IFERROR to "" so a donor that has not been authorised yet, or a day with no
 * rows, leaves the tab EMPTY rather than filling A7:T with #REF!. An empty log
 * reads as "nobody was on OS", which is wrong but survivable; a grid of #REF!
 * is what a broken file looks like.
 ************************************************************/
function buildArchiveLogFormulaPak_(liveUrl, tabName, firstRow, numCols, dateText) {
  const lastCol = columnLetterPak_(numCols);
  const range = "'" + tabName + "'!A" + firstRow + ':' + lastCol;
  // Doubled, because the URL and the range go inside a quoted formula string.
  const url = String(liveUrl).replace(/"/g, '""');
  return '=IFERROR(LET(src, IMPORTRANGE("' + url + '", "' + range + '"), ' +
         'FILTER(src, TEXT(INDEX(src,,1), "dd/MM/yyyy") = "' + dateText + '")), "")';
}

/** 1 -> A, 20 -> T, 27 -> AA. */
function columnLetterPak_(n) {
  let out = '';
  let x = Number(n);
  while (x > 0) {
    const rem = (x - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

/** The /d/<id>/ out of a Google Sheets URL, or '' when there is not one. */
function spreadsheetIdFromUrlPak_(url) {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

/************************************************************
 * APPLY — called once, as the archive is created
 ************************************************************/
function archiveApplyLiveLinks_(archiveSS, liveSS, dateObj, tz) {
  const liveUrl = liveSS.getUrl();
  const dateText = Utilities.formatDate(dateObj, tz, 'dd/MM/yyyy');
  let applied = 0;

  ARCHIVE_LINKS_CFG.LOGS.forEach(function (cfg) {
    const sheet = findSheetByLowerNamePak_(archiveSS, cfg.name);
    if (!sheet) {
      logLinksPak_('no tab named ' + cfg.name + ' - skipped');
      return;
    }
    const lastRow = sheet.getLastRow();
    // Cleared before the formula goes in, not after: a formula spills into the
    // cells below it and will not spill at all if anything is in the way.
    // #REF! with the message "Array result was not expanded" is what a copy's
    // leftover values produce, and it looks like an authorisation failure.
    if (lastRow >= cfg.firstRow) {
      sheet.getRange(cfg.firstRow, 1, lastRow - cfg.firstRow + 1, cfg.numCols)
           .clearContent();
    }
    sheet.getRange(cfg.firstRow, 1).setFormula(
      buildArchiveLogFormulaPak_(liveUrl, sheet.getName(), cfg.firstRow,
                                 cfg.numCols, dateText));
    applied++;
  });

  return { applied: applied, donorId: liveSS.getId() };
}

/************************************************************
 * AUTHORISE — so nobody has to open the file and click Allow access
 *
 * There is no supported API for this. Neither Sheets v4 nor Apps Script
 * exposes IMPORTRANGE's permission model; this is an internal endpoint the
 * Sheets front end itself calls, and it can stop working without notice.
 *
 * Which is why it is wrapped. A failure here leaves an archive whose logs read
 * empty until somebody opens it once and clicks the prompt - annoying, and
 * exactly what this is trying to avoid, but not damage. Throwing would abandon
 * the rest of the archive run half-done.
 *
 * The grant is per (destination, donor) PAIR - not per formula, per cell or
 * per range. Both log tabs point at the same live file, so one call covers
 * both, and a third formula added later would need no further grant.
 ************************************************************/
function archiveAuthoriseImportrange_(destId, donorId) {
  if (!destId || !donorId) return false;
  const url = 'https://docs.google.com/spreadsheets/d/' + destId +
              '/externaldata/addimportrangepermissions?donor=' + donorId;
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const ok = code >= 200 && code < 300;
    logLinksPak_('authorise ' + donorId + ' -> ' + destId + ': ' + code +
                 (ok ? '' : ' ' + res.getContentText().slice(0, 200)));
    return ok;
  } catch (err) {
    logLinksPak_('authorise FAILED for ' + destId + ': ' + (err && err.message));
    return false;
  }
}

/************************************************************
 * FREEZE — the day-8 job
 *
 * Entry point, put on a daily trigger:
 *   freezeExpiredArchiveLinks()
 *
 * Reads the Links tab rather than listing Drive, so it needs no Drive call per
 * archive, and the file name carries the date it is for.
 ************************************************************/
function freezeExpiredArchiveLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const sheet = ss.getSheetByName(LINKS_CFG.LINKS_SHEET_NAME);
  if (!sheet) { logLinksPak_('no Links tab - nothing to freeze'); return; }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - ARCHIVE_LINKS_CFG.TRACE_DAYS);

  const rows = sheet.getDataRange().getValues();
  let frozen = 0;

  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '');
    const url = String(rows[i][1] || '');
    const when = archiveDateFromNamePak_(name);
    if (!when || !url) continue;
    if (when >= cutoff) continue;              // still inside the window

    try {
      const archiveSS = SpreadsheetApp.openByUrl(url);
      if (archiveFreezeLiveLinks_(archiveSS)) {
        frozen++;
        logLinksPak_('froze ' + name);
      }
    } catch (err) {
      // One unreachable archive - deleted, moved, permissions changed - must
      // not stop the rest being frozen. They age out one day at a time, so a
      // run that gives up early leaves the oldest ones tracing for ever.
      logLinksPak_('could not freeze ' + name + ': ' + (err && err.message));
    }
  }
  logLinksPak_('froze ' + frozen + ' archive(s)');
}

/** "<base>_Archive_dd/MM/yyyy" -> Date, or null. */
function archiveDateFromNamePak_(name) {
  const m = /_Archive_(\d{2})\/(\d{2})\/(\d{4})/.exec(String(name || ''));
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/**
 * Values in place of the formula. Read as DISPLAY values and written back onto
 * a text-formatted column B, for the reason 'Spreadsheet - Name Correction.js'
 * exists: setValues re-parses what it is given, and a bonus code like "1AM"
 * becomes a time serial the moment it lands in a cell that is not already
 * text. Freezing a live log through the default format would corrupt the very
 * column the archive is being frozen to preserve.
 */
function archiveFreezeLiveLinks_(archiveSS) {
  let did = false;
  ARCHIVE_LINKS_CFG.LOGS.forEach(function (cfg) {
    const sheet = findSheetByLowerNamePak_(archiveSS, cfg.name);
    if (!sheet) return;
    const anchor = sheet.getRange(cfg.firstRow, 1);
    if (!anchor.getFormula()) return;          // already frozen, or never traced

    const lastRow = sheet.getLastRow();
    const rows = Math.max(1, lastRow - cfg.firstRow + 1);
    const range = sheet.getRange(cfg.firstRow, 1, rows, cfg.numCols);
    const shown = range.getDisplayValues();

    range.clearContent();
    sheet.getRange(cfg.firstRow, 2, rows, 1).setNumberFormat('@');
    range.setValues(shown);
    did = true;
  });
  return did;
}

/** getSheetByName is exact; these tabs are named inconsistently. */
function findSheetByLowerNamePak_(ss, lowerName) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim().toLowerCase() === lowerName) return sheets[i];
  }
  return null;
}

function logLinksPak_(msg) {
  Logger.log(ARCHIVE_LINKS_CFG.LOG_PREFIX + msg);
}
