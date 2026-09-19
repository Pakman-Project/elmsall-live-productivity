// The daily archive sweep: re-derives NPL Status/NPL Time (and any pure-OS
// or pure-NPL row that did not exist yet) for each of the last N days of
// archives, from that archive's OWN Data/Front/OS log/NPL Log tabs.
//
// Deliberately re-pivot only - it must never touch the BonusHub Delta table,
// which is what makes it cheap enough to run once a day against up to eight
// spreadsheets. If that scope grows later, this suite should grow with it.
const fs = require('fs');
const path = require('path');
const DBX = path.resolve(__dirname, '..', '..', 'Databricks-Live-Productivity-Output') + path.sep;
const NBFILE = 'Elmsall Live Productivity - Archive Sweep.ipynb';
const BACKFILL = 'Elmsall Live Productivity - Backfill Mode.ipynb';
const cellSources = f => JSON.parse(fs.readFileSync(DBX + f, 'utf8')).cells.map(c => c.source.join(''));
const cells = cellSources(NBFILE);
const nb = cells.join('\n');
const backfillCells = cellSources(BACKFILL);

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

head('[1] discovery reads the Links sheet Spreadsheet - Archive.js already writes');
{
  check('opens a worksheet named "Links"',
        /w\.title\.strip\(\)\.lower\(\) == "links"/.test(nb));
  check('File Name / File URL, columns A/B - see refreshArchiveLinks()',
        /_name, _url = _r\[0\]\.strip\(\), _r\[1\]\.strip\(\)/.test(nb),
        'the sheet is written by refreshArchiveLinks() in Spreadsheet - Archive.js: A=Name, B=URL');
  check('an archive is identified by its OWN date, out of the file name',
        /_Archive_\(\\d\{2\}\/\\d\{2\}\/\\d\{4\}\)\$/.test(nb),
        'matches archiveName = `${baseName}_Archive_${fileDateText}` in Spreadsheet - Archive.js');
  check('today itself is excluded, only the window before it is swept',
        /cutoff <= _d < today/.test(nb),
        "today's file is the live archive-in-waiting, not a past archive");
}

head('[2] one archive failing does not stop the rest');
{
  check('each archive opens inside its own try',
        /for _arc_id, _arc_name, _arc_date in archives:[\s\S]{0,80}try:/.test(nb));
  check('and a failure is counted and printed, not raised',
        /except Exception as _sweep_err:[\s\S]{0,120}_failed \+= 1/.test(nb));
}

head('[3] re-pivot only - never re-reads BonusHub, never rewrites Data');
// The user chose this scope deliberately: cheaper, and what actually needs
// to exist for BC/BD + new pure-OS/NPL rows. A full refetch was the explicit
// alternative turned down for a first version.
{
  check('no Delta/Spark read anywhere in this notebook',
        !/spark\.read/.test(nb) && !/landing_bonus_hub_event_parsed/.test(nb));
  check('the Data tab is only ever READ (ws.get_all_values), never written',
        /ws\.get_all_values\(\)/.test(nb) &&
        !/(?<![A-Za-z0-9_])ws\.update\(/.test(nb) &&
        !/(?<![A-Za-z0-9_])ws\.append/.test(nb),
        'proc_ws/_b_ws are written - only the bare Data-tab handle must not be');
}

head('[4] the pivot config cannot silently drift from Backfill Mode\'s');
// Hand-carried into a third notebook when this was built. A report added to
// Backfill Mode later and not here would make an archive's rebuild disagree
// with the live rebuild about how many areas exist - same failure shape
// test_oslog_dates.py already guards for _os_windows.
{
  const marker = '# --- Work-area pivot config:';
  const endMarker = 'PROC_LAST_COL = _col_a1(len(PROC_HEADER))';
  const sweepBlock = nb.slice(nb.indexOf(marker), nb.indexOf(endMarker) + endMarker.length);
  const backfillJoined = backfillCells.join('\n');
  const liveBlock = backfillJoined.slice(backfillJoined.indexOf(marker), backfillJoined.indexOf(endMarker) + endMarker.length);
  check('PROC_AREAS/PROC_HEADER are byte-identical to Backfill Mode\'s',
        sweepBlock === liveBlock,
        sweepBlock === liveBlock ? '' : 'a report added to one and not the other splits the two pivots');
}

head('[5] the fix that made this worth building at all - both loops synthesize');
{
  check('OS_STATUS and NPL_STATUS both get a synthesized row',
        /for _status_map in \(OS_STATUS, NPL_STATUS\):/.test(nb));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
