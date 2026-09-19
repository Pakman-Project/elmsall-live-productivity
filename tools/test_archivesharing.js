// Every fresh archive needs the same access the live file already has - the
// Databricks service account cannot rebuild Processed Data (15mins)/Backend
// on it otherwise, and makeCopy() shares with nobody, resets every
// protection's editor list to whoever ran the copy.
//
// Deliberately reads who already has access rather than naming anyone here:
// see the comment above shareArchiveLikeLiveFile_ in Spreadsheet - Archive.js.
const fs = require('fs');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const ARCH = fs.readFileSync(APPS + 'Spreadsheet - Archive.js', 'utf8');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

head('[1] every archive gets shared right after it is dated');
{
  check('shareArchiveLikeLiveFile_ runs inside the creation loop',
        /setArchiveB2_\(archiveSS, dateObj\);\s*\n\s*shareArchiveLikeLiveFile_\(sourceFile, liveSS, archiveFile, archiveSS\);/
          .test(ARCH));
}

head('[2] no email is hard-coded - it all comes from the live file itself');
{
  const fn = ARCH.slice(ARCH.indexOf('function shareArchiveLikeLiveFile_'),
                         ARCH.indexOf('function shareArchiveLikeLiveFile_') + 3000);
  check('no literal address anywhere in the function',
        !/[\w.-]+@[\w.-]+\.[a-z]{2,}/i.test(fn),
        'a hard-coded email here is exactly what was asked NOT to do');
  check('file-level access is read off the live file, not named',
        /sourceFile\.getEditors\(\)/.test(fn) && /archiveFile\.addEditor\(email\)/.test(fn));
  check('protection editors are read off the live protection, not named',
        /liveProts\[i\]\.getEditors\(\)/.test(fn) && /archiveProts\[i\]\.addEditor\(email\)/.test(fn));
}

head('[3] both kinds of protection are covered, matched by position');
{
  check('sheet-level AND range-level protections',
        /\[SpreadsheetApp\.ProtectionType\.SHEET, SpreadsheetApp\.ProtectionType\.RANGE\]/.test(ARCH));
  check('matched by index, not by comparing what each one protects',
        /const n = Math\.min\(liveProts\.length, archiveProts\.length\)/.test(ARCH),
        'a copy is a positional mirror of the live protections, in the same order');
}

head('[4] never fails archive creation over a sharing problem');
{
  const fn = ARCH.slice(ARCH.indexOf('function shareArchiveLikeLiveFile_'),
                         ARCH.indexOf('function shareArchiveLikeLiveFile_') + 3000);
  check('a rejected file-editor add is caught, not thrown',
        /archiveFile\.addEditor\(email\);\s*\n\s*\} catch/.test(fn));
  check('a rejected protection-editor add is caught, not thrown',
        /archiveProts\[i\]\.addEditor\(email\);\s*\n\s*granted\+\+;\s*\n\s*\} catch/.test(fn));
  check('reading the live file\'s own editor list is guarded too',
        /try \{\s*\n\s*sourceFile\.getEditors\(\)/.test(fn));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
