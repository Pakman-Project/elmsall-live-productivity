/************************************************************
 * REFRESH THE LOGS ON RECENT ARCHIVES
 *
 * Entry point:
 *   refreshRecentArchiveLogs()
 *
 * An archive is a frozen copy: its 'OS log' and 'NPL Log' hold whatever the
 * live file held the moment it was made. Those logs originate in forms people
 * fill in, and records are corrected, approved and rejected for days
 * afterwards - none of which an archive ever saw.
 *
 * This rebuilds both logs on every archive inside the window, from the same
 * source workbooks the live file reads, using the SAME builders the live file
 * uses (updateOSLogFor_ / updateNPLLogFor_). Nothing about the column mapping
 * is restated here.
 *
 * WHY VALUES AND NOT IMPORTRANGE FORMULAS
 * An IMPORTRANGE in each archive would have to re-express SHEET_CONFIGS - 3
 * source tabs, 3 different column layouts, interleaved literals and two
 * computed columns - as a spreadsheet formula. That is a second copy of the
 * most fragile mapping in this pipeline, in a language with no tests, that
 * nothing would keep in step when SHEET_CONFIGS next changes. It also loses
 * the bonus-column text formatting and the name correction, both of which are
 * in the builders below and neither of which a formula can do.
 *
 * The only things that read an archive's logs are the 3am Databricks sweep
 * and the dashboard when somebody opens that archive's date - so once a day,
 * ahead of the sweep, is as fresh as either needs.
 *
 * Nothing here is date-aware. Each archive's OWN control cells (B1/B2 on OS
 * log, B1:C4 on NPL Log) are formulas relative to its Front!B2, which
 * setArchiveB2_ pinned to that archive's date when the copy was made - so
 * opening an archive and running the builder against it already reads that
 * day's workbooks.
 ************************************************************/

const ARCHIVE_LOG_CFG = {
  // How far back to keep archives' logs tracking their sources. Matches the
  // window the Databricks archive sweep rebuilds BC/BD over - past it, a day
  // is settled and its archive is left alone for good.
  WINDOW_DAYS: 8,
  LINKS_SHEET_NAME: 'Links',
  // Apps Script kills an execution at six minutes. Each archive costs several
  // openByUrl calls, which are the slow part, so the run stops cleanly and
  // says where it got to rather than being killed mid-write with one file's
  // log cleared and not yet rewritten.
  BUDGET_MS: 4.5 * 60 * 1000,
  LOG_PREFIX: '[ARCHIVE-LOGS] ',
};

function refreshRecentArchiveLogs() {
  const started = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targets = recentArchiveTargets_(ss, ARCHIVE_LOG_CFG.WINDOW_DAYS);

  logArchiveLogs_(`${targets.length} archive(s) inside ${ARCHIVE_LOG_CFG.WINDOW_DAYS} days`);

  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (const target of targets) {
    if (Date.now() - started > ARCHIVE_LOG_CFG.BUDGET_MS) {
      // Whatever is left keeps its existing log and gets picked up tomorrow.
      skipped = targets.length - done - failed;
      logArchiveLogs_(`Out of time - ${skipped} archive(s) left for the next run`);
      break;
    }

    try {
      const archiveSS = SpreadsheetApp.openByUrl(target.url);
      // Both logs, or as many of them as the file has. An archive cut before
      // the NPL log existed simply has no NPL Log tab, and the builder says so
      // and returns rather than throwing.
      updateOSLogFor_(archiveSS);
      updateNPLLogFor_(archiveSS);
      done++;
      logArchiveLogs_(`Refreshed: ${target.name}`);
    } catch (e) {
      // One unreachable archive must not cost the rest - the same bargain the
      // log builders already make about one unreachable source workbook.
      failed++;
      logArchiveLogs_(`FAILED: ${target.name} - ${e.message}`);
    }
  }

  logArchiveLogs_(`Done: ${done} refreshed, ${failed} failed, ${skipped} skipped`);
}

/**
 * The archives whose date falls inside the window, newest first.
 *
 * Read off the Links sheet rather than by listing the Drive folder: that tab
 * already holds every archive's name and URL, refreshArchiveLinks() rebuilds
 * it at the end of every daily run, and it is the same discovery the
 * Databricks sweep uses - so the two cannot disagree about which files are
 * "recent".
 *
 * The date comes out of the NAME, which archiveName builds as
 * `<file>_Archive_dd/MM/yyyy`, rather than off the file's Drive timestamp:
 * the name is the archive's own identity for its day, and a file touched by
 * hand last week would otherwise look newer than it is.
 */
function recentArchiveTargets_(ss, windowDays) {
  const sheet = ss.getSheetByName(ARCHIVE_LOG_CFG.LINKS_SHEET_NAME);
  if (!sheet) {
    logArchiveLogs_(`No '${ARCHIVE_LOG_CFG.LINKS_SHEET_NAME}' sheet - run refreshArchiveLinks() first`);
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A and B only: File Name, File URL. The other six columns are for people
  // reading the tab.
  const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const oldest = new Date(midnight);
  oldest.setDate(oldest.getDate() - windowDays);

  const out = [];
  for (const [name, url] of rows) {
    const date = archiveDateFromName_(String(name == null ? '' : name));
    if (!date) continue;                       // not an archive, or an unreadable name
    if (date < oldest || date >= midnight) continue;  // today has no archive yet
    const link = String(url == null ? '' : url).trim();
    if (!link) continue;
    out.push({ name: String(name).trim(), url: link, date: date });
  }

  out.sort((a, b) => b.date - a.date);
  return out;
}

/**
 * "<anything>_Archive_dd/MM/yyyy" -> that date at midnight, or null.
 *
 * Built explicitly from the three parts rather than handed to Date.parse: the
 * name carries dd/MM/yyyy, and Date.parse reads 09/12/2026 as the 12th of
 * September. That mistake would put five archives in the wrong window and
 * leave them tracking nothing, quietly.
 */
function archiveDateFromName_(name) {
  const m = /_Archive_(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(name.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  // Rejects 31/02: the Date constructor rolls it into March rather than
  // failing, and a rolled date would match a file that is not that day.
  if (d.getDate() !== day || d.getMonth() !== month - 1 || d.getFullYear() !== year) {
    return null;
  }
  return d;
}

function logArchiveLogs_(msg) {
  Logger.log(ARCHIVE_LOG_CFG.LOG_PREFIX + msg);
}
