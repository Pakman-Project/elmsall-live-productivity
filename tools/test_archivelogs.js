// Refreshing the OS/NPL logs on recent archives.
//
// An archive is a frozen copy, and its logs originate in forms people keep
// correcting for days afterwards - so without this, an 8-day-old archive's
// OS/NPL logs are whatever they were the minute the copy was taken, and the
// Databricks sweep rebuilds BC/BD from stale records.
//
// The load-bearing claim of the whole design is that the mapping is NOT
// restated here: the archive rebuild calls the same builders the live file
// calls. Most of what follows pins that.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

const REF = R('Spreadsheet - Archive Log Refresh.js');
// Comments stripped: that file's header EXPLAINS why it holds no SHEET_CONFIGS
// and no IMPORTRANGE, so searching the raw text for those words finds the
// explanation and fails a check that is actually about the code.
const REF_CODE = REF.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
const OS = R('Spreadsheet - OS Log.js');
const NPL = R('Spreadsheet - NPL Log.js');
const NC = R('Spreadsheet - Name Correction.js');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

head('[1] one mapping, reused - not a second copy of it');
{
  check('the archive refresh calls the live builders',
        /updateOSLogFor_\(archiveSS\);\s*\n\s*updateNPLLogFor_\(archiveSS\);/.test(REF));
  check('and restates none of the column mapping itself',
        !/SHEET_CONFIGS/.test(REF_CODE) && !/NPL_SELECT_/.test(REF_CODE) &&
        !/baseSelect/.test(REF_CODE) && !/extraSelect/.test(REF_CODE),
        'SHEET_CONFIGS moved once already; a second copy is a second one to get wrong');
  check('no IMPORTRANGE formula anywhere - values, written by the builder',
        !/IMPORTRANGE/i.test(REF_CODE) && !/setFormula/.test(REF_CODE),
        'a formula cannot do the bonus text format or the name correction');
  check('the live entry points are unchanged in name',
        /function updateOSLog\(\) \{\s*\n\s*updateOSLogFor_\(SpreadsheetApp\.getActiveSpreadsheet\(\)\);/.test(OS) &&
        /function updateNPLLog\(\) \{\s*\n\s*updateNPLLogFor_\(SpreadsheetApp\.getActiveSpreadsheet\(\)\);/.test(NPL),
        'existing triggers and menu items keep working untouched');
}

head('[2] the builders take a file rather than assuming the active one');
{
  check('updateOSLogFor_ works off its argument',
        /function updateOSLogFor_\(ss\)/.test(OS) &&
        /const osLogSheet = ss\.getSheetByName\('OS log'\);/.test(OS));
  check('updateNPLLogFor_ likewise',
        /function updateNPLLogFor_\(ss\)/.test(NPL) && /var sheet = nplLogSheet_\(ss\);/.test(NPL));
  // getUi() throws outside a UI context, which is every trigger run and every
  // archive rebuild - so a missing tab used to kill the execution.
  check('a missing OS log tab logs instead of calling getUi()',
        !/getUi\(\)/.test(OS) && /Sheet 'OS log' was not found in/.test(OS),
        'getUi() throws on a trigger run, turning a missing tab into a dead execution');
  check('the name correction is pointed at the file just written',
        /correctOsLogNames\(ss\)/.test(OS) &&
        /correctNplLogNames\(sheet\.getParent\(\)\)/.test(NPL) &&
        /ss = ss \|\| SpreadsheetApp\.getActiveSpreadsheet\(\);/.test(NC),
        'correcting the active file during an archive rebuild repairs the wrong one');
}

head('[3] no date is passed in - the archive already knows its own');
{
  check('nothing computes source links or dates here',
        !/Front!B2/.test(REF_CODE) && !/getRange\('B1/.test(REF_CODE),
        "setArchiveB2_ pinned Front!B2, so the copy's own control formulas resolve correctly");
}

head('[4] discovery: the Links sheet, the name\'s own date, the window');
{
  check('reads the Links sheet rather than listing Drive',
        /getSheetByName\(ARCHIVE_LOG_CFG\.LINKS_SHEET_NAME\)/.test(REF) &&
        /LINKS_SHEET_NAME: 'Links'/.test(REF));
  check('columns A and B only - File Name, File URL',
        /getRange\(2, 1, lastRow - 1, 2\)/.test(REF),
        'matches what refreshArchiveLinks() writes in Spreadsheet - Archive.js');
  check('the window matches the Databricks sweep\'s eight days',
        /WINDOW_DAYS: 8/.test(REF));
  check('today is excluded, so a half-made archive is never touched',
        /date >= midnight/.test(REF));
  check('and the run stops on a time budget rather than being killed',
        /BUDGET_MS/.test(REF) && /Out of time/.test(REF),
        'a kill mid-write leaves a log cleared and not yet rewritten');
  check('one bad archive does not cost the rest',
        /catch \(e\) \{[\s\S]{0,300}failed\+\+;/.test(REF));
}

head('[5] archiveDateFromName_, run for real');
{
  // Run the parser itself. The window is the whole point of this file, and an
  // off-by-one or a d/m swap puts archives in the wrong one silently.
  const ctx = { Logger: { log() {} } };
  vm.createContext(ctx);
  vm.runInContext(REF.slice(REF.indexOf('function archiveDateFromName_')), ctx);
  const d = ctx.archiveDateFromName_;

  const got = d('Elmsall Live Productivity_Archive_09/12/2026');
  check('dd/MM/yyyy is read as day-month, not month-day',
        got && got.getDate() === 9 && got.getMonth() === 11 && got.getFullYear() === 2026,
        got ? got.toDateString() : 'null');
  check('Date.parse would have read that as 12 September',
        got.getMonth() === 11, 'which is why it is built from the three parts');
  check('the time is midnight, so a same-day compare is not an hours race',
        got.getHours() === 0 && got.getMinutes() === 0);
  check('a name that is not an archive is rejected',
        d('Elmsall Live Productivity') === null &&
        d('some other file.xlsx') === null);
  check('and an impossible date is rejected rather than rolled',
        d('x_Archive_31/02/2026') === null,
        'the Date constructor rolls 31/02 into March, matching the wrong day');
  check('trailing whitespace on a Drive name is tolerated',
        d('x_Archive_01/03/2026  ') !== null);
  check('a single-digit-padded name still parses',
        d('x_Archive_01/01/2027').getFullYear() === 2027);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
