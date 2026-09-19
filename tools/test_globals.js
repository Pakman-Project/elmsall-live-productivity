// Apps Script does not have modules.
//
// Every .js in the project is evaluated into ONE global scope, so two
// functions of the same name are not two functions - the second to load
// replaces the first, and nothing anywhere tells you. There is no import, no
// export and no error; the only symptom is that one of them stops running.
//
// This is not hypothetical. The check below was written after finding
// logLinks_ defined twice, in 'Spreadsheet - Archive.js' and 'Spreadsheet - OS
// Links.js', with DIFFERENT bodies - one logging under [LINKS] and one under
// [OS-LINKS] - so one of those two modules had been logging under the other's
// name for as long as both files existed. scanFolderTree_ was duplicated too,
// identically, which is the same landmine set for whoever edits one copy.
const fs = require('fs');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8').replace(/\r\n/g, '\n');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

head('[1] no two server files define the same global');
{
  const names = {};
  // 'Web - *.js' is the web app's own server file; the rest are the
  // spreadsheet-bound scripts. They all share the one scope.
  fs.readdirSync(APPS)
    .filter(f => f.endsWith('.js'))
    .forEach(f => {
      const src = R(f);
      // Top-level only. A nested helper is scoped to its function and cannot
      // collide, and in this codebase indentation is what tells them apart.
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

  // The pair this was written for, pinned by name so the fix cannot be undone
  // by restoring either old name.
  const osLinks = R('Spreadsheet - OS Links.js');
  check('the OS Links helpers are named apart from the Archive ones',
        /function osLinksScanFolderTree_\(/.test(osLinks) &&
        /function osLinksLog_\(/.test(osLinks) &&
        !/function logLinks_\(/.test(osLinks));
  check('and Archive.js keeps the originals it was already using',
        /function logLinks_\(/.test(R('Spreadsheet - Archive.js')) &&
        /function scanFolderTree_\(/.test(R('Spreadsheet - Archive.js')));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
