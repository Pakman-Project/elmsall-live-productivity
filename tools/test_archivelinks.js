// The archive's live OS/NPL log links.
//
// Almost none of this file can be tested without Drive, and the part that CAN
// is the part most worth pinning: the formula string. It is assembled by hand
// out of a URL, a tab name, a range and a date, it goes into a file nobody
// opens for weeks, and every way of getting it wrong fails the same silent
// way - an empty log tab, which reads exactly like "nobody was on OS that day".
//
// So the checks below are about the four things that can each empty it:
//   - a range that does not match the tab's real width;
//   - a date comparison that never matches because the column is text on some
//     source tabs and a real date on others;
//   - IMPORTRANGE evaluated more than once, or reached past the live file to
//     the source workbooks, where the column mapping would have to be copied;
//   - an error that fills A7:T with #REF! instead of leaving it blank.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8').replace(/\r\n/g, '\n');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const SRC = R('Spreadsheet - Archive Live Links.js');
const ARCHIVE = R('Spreadsheet - Archive.js');
const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

const LIVE = 'https://docs.google.com/spreadsheets/d/1uiv27J0YPDW/edit';

head('[1] the column letter, which decides how wide the import is');
{
  const L = ctx.columnLetterPak_;
  check('1 is A', L(1) === 'A', L(1));
  check('16 is P, the NPL log', L(16) === 'P', L(16));
  check('20 is T, the OS log', L(20) === 'T', L(20));
  check('26 is Z', L(26) === 'Z', L(26));
  // The two that a naive base-26 conversion gets wrong, and the reason this is
  // a function rather than a lookup: spreadsheet columns have no zero digit.
  check('27 is AA, not BA', L(27) === 'AA', L(27));
  check('52 is AZ', L(52) === 'AZ', L(52));
}

head('[2] the formula');
{
  const f = ctx.buildArchiveLogFormulaPak_(LIVE, 'OS log', 7, 20, '18/09/2026');

  check('imports the tab, at the right first row and width',
        f.indexOf('"\'OS log\'!A7:T"') !== -1, f);
  check('and the NPL one stops at P',
        ctx.buildArchiveLogFormulaPak_(LIVE, 'NPL Log', 7, 16, '18/09/2026')
          .indexOf('"\'NPL Log\'!A7:P"') !== -1);

  // The whole reason this imports the live file: the mapping in
  // SHEET_CONFIGS stays in one place. A formula naming a source tab would be
  // a second copy of it.
  check('it reads the LIVE file, not a source workbook',
        f.indexOf(LIVE) !== -1,
        'the mapping lives in updateOSLog(); a formula must not re-do it');
  check('...and the archive script passes the live file in',
        /archiveApplyLiveLinks_\(archiveSS, liveSS, dateObj, tz\)/.test(ARCHIVE));

  check('IMPORTRANGE is evaluated once, not once per reference',
        (f.match(/IMPORTRANGE\(/g) || []).length === 1 && f.indexOf('LET(') !== -1,
        'FILTER needs the block and its first column; LET is what stops two fetches');

  // TEXT() on both sides. `where Col1 = date '...'` matches nothing when the
  // column arrived as dd/mm/yyyy text, which some source tabs give it.
  check('the date is compared as text, so it matches either type',
        f.indexOf('TEXT(INDEX(src,,1), "dd/MM/yyyy") = "18/09/2026"') !== -1, f);
  check('and it is THIS archive\'s date',
        ctx.buildArchiveLogFormulaPak_(LIVE, 'OS log', 7, 20, '01/01/2027')
          .indexOf('"01/01/2027"') !== -1);

  check('an error leaves the tab empty rather than full of #REF!',
        /^=IFERROR\(/.test(f) && /, ""\)$/.test(f),
        'a grid of #REF! is what a broken file looks like; blank is survivable');

  // A quote in a URL would end the formula's string early and produce a
  // parse error rather than a wrong answer - loud, but still a broken archive.
  check('a quote in the URL is escaped, not left to break the string',
        ctx.buildArchiveLogFormulaPak_('http://x/"y', 'T', 7, 2, '01/01/2027')
          .indexOf('http://x/""y') !== -1);
}

head('[3] the donor id, which is what gets authorised');
{
  const id = ctx.spreadsheetIdFromUrlPak_;
  check('read out of a normal edit URL',
        id('https://docs.google.com/spreadsheets/d/ABC-123_x/edit#gid=0') === 'ABC-123_x');
  check('and out of one with no trailing path',
        id('https://docs.google.com/spreadsheets/d/ABC-123_x') === 'ABC-123_x');
  check('anything else gives nothing rather than a guess',
        id('https://example.com/nope') === '' && id('') === '' && id(null) === '');
}

head('[4] the grant is per donor, not per formula');
{
  // Both log tabs point at the same live file, so one call covers both. This
  // is the thing worth writing down: the permission model is (destination,
  // donor) pairs, and a reader who assumes it is per-cell adds helper cells
  // that do nothing.
  check('one authorise call per archive, not one per tab',
        (ARCHIVE.match(/archiveAuthoriseImportrange_\(/g) || []).length === 1,
        'both tabs share a donor; a second call would be a second grant of the same thing');
  check('and it is told the archive and the donor',
        /archiveAuthoriseImportrange_\(archiveSS\.getId\(\), linked\.donorId\)/.test(ARCHIVE));
  check('the endpoint is reached with the script\'s own token',
        /Authorization: 'Bearer ' \+ ScriptApp\.getOAuthToken\(\)/.test(SRC));
  check('and a failure is logged, not thrown',
        /muteHttpExceptions: true/.test(SRC) &&
        /catch \(err\) \{[\s\S]{0,200}return false;/.test(SRC),
        'an unauthorised archive is annoying; an abandoned archive run is damage');
  check('the whole step is wrapped where it is called, too',
        /try \{[\s\S]{0,400}archiveApplyLiveLinks_[\s\S]{0,300}catch \(err\)/.test(ARCHIVE),
        'it rewrites two ranges and calls the network, after the file is already an archive');
  check('and it runs LAST, after the archive is otherwise complete',
        ARCHIVE.indexOf('archiveApplyLiveLinks_') > ARCHIVE.indexOf('setArchiveB2_(archiveSS'),
        'a failure should cost the tracing, not the file');
}

head('[5] the eight-day window, and what happens at the end of it');
{
  check('eight days, named once',
        /TRACE_DAYS: 8,/.test(SRC));
  const d = ctx.archiveDateFromNamePak_;
  check('the date is read off the file name',
        typeof d('Elmsall Live Productivity_Archive_18/09/2026').getTime === 'function',
        'not instanceof Date - the vm builds it in its own realm, where that is false');
  check('...as the right day',
        d('x_Archive_18/09/2026').getDate() === 18 &&
        d('x_Archive_18/09/2026').getMonth() === 8 &&
        d('x_Archive_18/09/2026').getFullYear() === 2026);
  check('and a file that is not an archive is skipped, not guessed at',
        d('Some other file') === null && d('') === null);

  // The freeze exists because the NPL weekly links are ROLLING files: once one
  // rolls past this date the live log loses those rows, and a formula tracing
  // it goes empty rather than stale.
  check('the freeze writes DISPLAY values',
        /getDisplayValues\(\)/.test(SRC),
        'the formula\'s result, not the formula');
  // The bug 'Spreadsheet - Name Correction.js' exists for. setValues re-parses
  // what it is given, so "1AM" becomes a time serial unless the column is
  // already text - and freezing would corrupt the column it is preserving.
  check('column B is made text BEFORE the values go back',
        /setNumberFormat\('@'\);\s*\n\s*range\.setValues\(shown\);/.test(SRC),
        'setValues re-parses; "1AM" is a time serial the moment it lands otherwise');
  check('an already-frozen archive is left alone',
        /if \(!anchor\.getFormula\(\)\) return;/.test(SRC),
        'or every run would re-freeze, and re-parse, every archive ever made');
  check('one unreachable archive does not stop the rest',
        /catch \(err\) \{[\s\S]{0,400}could not freeze/.test(SRC),
        'they age out one a day; a run that gives up leaves the oldest tracing for ever');
  check('the window is read from the Links tab, not from Drive',
        /LINKS_CFG\.LINKS_SHEET_NAME/.test(SRC),
        'no per-archive Drive call, and the name already carries the date');
}

head('[6] no two server files define the same global');
// Apps Script does not have modules. Every .js in the project is evaluated
// into ONE global scope, so two functions of one name are not two functions -
// the second to load replaces the first, and nothing anywhere says so.
//
// This is not hypothetical. Adding this check found logLinks_ defined twice,
// in 'Spreadsheet - Archive.js' and 'Spreadsheet - OS Links.js', with
// DIFFERENT bodies: one logs under [LINKS] and one under [OS-LINKS], so one of
// the two modules had been logging under the other's name for as long as both
// existed. scanFolderTree_ was duplicated too, identically, which is the same
// landmine waiting for whoever edits one copy and not the other.
{
  const names = {};
  fs.readdirSync(APPS)
    .filter(f => f.endsWith('.js') && !f.startsWith('Web - '))
    .forEach(f => {
      const src = R(f);
      // Top-level only. A nested helper is scoped to its function and cannot
      // collide; indentation is what tells them apart in this codebase.
      let m;
      const fnRe = /^function\s+([A-Za-z0-9_]+)\s*\(/gm;
      while ((m = fnRe.exec(src))) (names[m[1]] = names[m[1]] || []).push(f);
      const constRe = /^(?:const|var|let)\s+([A-Z][A-Z0-9_]+)\s*=/gm;
      while ((m = constRe.exec(src))) (names[m[1]] = names[m[1]] || []).push(f);
    });

  const clashes = Object.keys(names).filter(n => names[n].length > 1);
  check('every top-level name is defined once across the project',
        clashes.length === 0,
        clashes.map(n => n + ' in ' + names[n].join(' + ')).join('; ') || 'none');

  // The specific pair this check was written for, pinned by name so the fix
  // cannot be quietly undone by restoring either old name.
  check('the OS Links helpers are named apart from the Archive ones',
        /function osLinksScanFolderTree_\(/.test(R('Spreadsheet - OS Links.js')) &&
        /function osLinksLog_\(/.test(R('Spreadsheet - OS Links.js')) &&
        !/function logLinks_\(/.test(R('Spreadsheet - OS Links.js')));
  check('and Archive.js keeps the originals it was already using',
        /function logLinks_\(/.test(ARCHIVE) &&
        /function scanFolderTree_\(/.test(ARCHIVE));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
