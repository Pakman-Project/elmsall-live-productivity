// Every fresh archive needs the same access the live file already has - the
// Databricks service account cannot rebuild Processed Data (15mins)/Backend
// on it otherwise, and makeCopy() shares with nobody and resets every
// protection's editor list to whoever ran the copy.
//
// Two things here are load-bearing and easy to undo by accident:
//   - nobody is NAMED; the list is read off the live file's permissions
//   - it is SILENT; DriveApp.addEditor mails everyone it adds, every day
const fs = require('fs');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const ARCH = fs.readFileSync(APPS + 'Spreadsheet - Archive.js', 'utf8');
const MANIFEST = fs.readFileSync(APPS + 'appsscript.json', 'utf8');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const fnAt = name => {
  const i = ARCH.indexOf('function ' + name);
  return i === -1 ? '' : ARCH.slice(i, i + 3000);
};

head('[1] every archive gets shared right after it is dated');
{
  check('shareArchiveLikeLiveFile_ runs inside the creation loop',
        /setArchiveB2_\(archiveSS, dateObj\);\s*\n\s*shareArchiveLikeLiveFile_\(sourceFile, archiveFile, archiveSS\);/
          .test(ARCH));
}

head('[2] no email is hard-coded - it all comes from the live file itself');
{
  const fn = fnAt('shareArchiveLikeLiveFile_') + fnAt('liveAccessGrantees_');
  check('no literal address anywhere in either function',
        !/[\w.-]+@[\w.-]+\.[a-z]{2,}/i.test(fn),
        'a hard-coded email here is exactly what was asked NOT to do');
  check('the list is read off the live file, not named',
        /liveAccessGrantees_\(sourceFile\.getId\(\)\)/.test(ARCH) &&
        /Drive\.Permissions\.list\(fileId/.test(ARCH));
  check('only roles that can WRITE are carried over',
        /EDIT_ROLES = \{ owner: true, organizer: true, fileOrganizer: true, writer: true \}/.test(ARCH),
        'a viewer on the live file should not become an editor on the archive');
  check('and paging is followed, so a long list is not truncated',
        /nextPageToken/.test(ARCH) && /while \(pageToken\)/.test(ARCH));
}

head('[3] SILENT - the whole point of using Drive v3 over DriveApp');
{
  check('permissions are created with no notification mail',
        /sendNotificationEmail: false/.test(ARCH),
        'DriveApp.addEditor mails every person, for every archive, every day');
  check('DriveApp.addEditor is not used to share the archive',
        !/archiveFile\.addEditor/.test(ARCH));
  // clasp push overwrites the manifest, so enabling the service in the editor
  // alone is undone by the next deploy.
  check('Drive v3 is declared in appsscript.json, not just enabled in the editor',
        /"userSymbol":\s*"Drive"/.test(MANIFEST) &&
        /"serviceId":\s*"drive"/.test(MANIFEST) &&
        /"version":\s*"v3"/.test(MANIFEST),
        'clasp push -f would otherwise strip the service and break Drive.Permissions');
  check('granted as writer, never owner',
        /role: 'writer'/.test(ARCH) && !/role: 'owner'/.test(ARCH),
        'handing ownership away would take this script\'s own access with it');
}

head('[4] protections: every one, batched, warning-only skipped');
{
  check('sheet-level AND range-level protections',
        /getProtections\(SpreadsheetApp\.ProtectionType\.SHEET\)\s*\n?\s*\.concat\(sheet\.getProtections\(SpreadsheetApp\.ProtectionType\.RANGE\)\)/
          .test(ARCH));
  check('a warning-only protection is skipped',
        /if \(protection\.isWarningOnly\(\)\) return;/.test(ARCH),
        'it has no editor list at all - it only warns on edit');
  check('addEditors in one call, not addEditor per person',
        /protection\.addEditors\(emails\)/.test(ARCH) &&
        !/protection\.addEditor\(/.test(ARCH),
        'a dozen protections times a list of people, inside an already-long run');
}

head('[5] never fails archive creation over a sharing problem');
{
  const fn = fnAt('shareArchiveLikeLiveFile_');
  check('a rejected share is caught, not thrown',
        /\} catch \(e\) \{[\s\S]{0,260}Could not share with/.test(fn));
  check('a rejected protection grant is caught, not thrown',
        /\} catch \(e\) \{[\s\S]{0,200}Could not grant on a protection/.test(fn));
  check('and an unreadable permission list degrades to doing nothing',
        /Could not read permissions on/.test(ARCH) &&
        /No editors found on the live file/.test(ARCH),
        'a missing grant costs one sweep; a throw costs the archive itself');
}

head('[6] the file header describes what the job actually does now');
{
  const header = ARCH.slice(0, ARCH.indexOf('const ARCHIVE_CFG'));
  check('it mentions the access reapply',
        /reapply the live file's access/.test(header));
  check('it mentions the archive log refresh',
        /Refresh the OS\/NPL logs on every archive/.test(header));
  check('it mentions Backend being trimmed alongside Processed Data',
        /'Backend'/.test(header));
  check('and the ordering constraint against the Databricks sweep',
        /must finish before that sweep starts/.test(header),
        'the sweep reads what step 7 wrote');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
