// The NPL Log builder.
//
// The dangerous parts are the two that fail SILENTLY:
//
//   1. The COLUMN MAPPING. Source B:S with C and D dropped, 16 in and 16 out.
//      Off by one and every row lands shifted - departments in the Task
//      column, a time where the authoriser should be. Nothing raises; the log
//      just reads as nonsense somebody has to notice.
//
//   2. The WEEKLY DATE FILTER. B3/B4 point at ROLLING files holding months of
//      rows, and only the rows matching C3/C4 belong in the log. Match on the
//      displayed text instead of the parsed date and a sheet reformatted to
//      "9/9/2026" contributes nothing - which looks exactly like a quiet week.
//
// So those two lead, and the rest follows.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const SRC = R('Spreadsheet - NPL Log.js');
const NC = R('Spreadsheet - Name Correction.js');

// The script runs against Apps Script globals it never sees here. Only the
// pure helpers are exercised; everything touching SpreadsheetApp is read as
// source, which is what the greps below are for.
const ctx = { console, Logger: { log: function () {} } };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);

head('[1] the column mapping: B:S with C and D dropped');
{
  check('16 columns out, which is A:P',
        ctx.NPL_SELECT_.length === 16, '= ' + ctx.NPL_SELECT_.length);
  check('the source read is B:S, 18 wide',
        ctx.NPL_SOURCE_FIRST_COL_ === 2 && ctx.NPL_SOURCE_NUM_COLS_ === 18,
        'col ' + ctx.NPL_SOURCE_FIRST_COL_ + ', width ' + ctx.NPL_SOURCE_NUM_COLS_);
  check('and it starts at row 5 of the source tab',
        ctx.NPL_SOURCE_FIRST_ROW_ === 5);
  check('writing from row 7, under the control cells and headings',
        ctx.NPL_LOG_DATA_ROW_ === 7);

  // Spelled out as letters, because that is how the mapping was specified and
  // how anybody checking it against the sheet will read it.
  const L = i => String.fromCharCode(66 + i);   // index 0 = B
  const got = ctx.NPL_SELECT_.map(L).join(' ');
  check('the kept columns are B E F G H I J K L M N O P Q R S',
        got === 'B E F G H I J K L M N O P Q R S', got);
  check('C and D are the only two dropped',
        ctx.NPL_SELECT_.indexOf(1) === -1 && ctx.NPL_SELECT_.indexOf(2) === -1,
        'indices 1 and 2 from B');
  check('nothing is read twice and nothing is out of order',
        ctx.NPL_SELECT_.every((v, i, a) => i === 0 || v > a[i - 1]));

  // The headers the mapping has to land on, in order.
  const DEST = ['Date', 'Bonus Number', 'Department', 'Task',
                'Protected Bonus Area', 'Site Transfer',
                'Strictly P1 / MI numbers only', 'Start Time', 'Finish Time',
                'Duration', 'TM authorised', 'Exceptional Circumstances Task',
                'Check', 'Allow duplicate', 'TOTAL Non prod hours',
                'Unproductive Minutes'];
  check('one output column per NPL Log heading',
        DEST.length === ctx.NPL_SELECT_.length);
  // The four the dashboard will actually join on, pinned by position.
  check('Date is A, from source B', ctx.NPL_SELECT_[0] === 0);
  check('Bonus Number is B, from source E', ctx.NPL_SELECT_[1] === 3);
  check('Start/Finish are H and I, from source K and M',
        ctx.NPL_SELECT_[7] === 9 && ctx.NPL_SELECT_[8] === 10);
  check('Check is M, from source P', ctx.NPL_SELECT_[12] === 14);
  check('and the weekly filter reads the same cell that becomes Date',
        ctx.NPL_SOURCE_DATE_IDX_ === ctx.NPL_SELECT_[0],
        'filtering on a different column than it writes would be unfindable');
}

head('[2] dates are PARSED, not string-matched');
// The cell is whatever the sheet is formatted to show. Matching its text is
// what would drop every row of a reformatted file, with no error anywhere.
{
  const key = ctx.nplDateKey_;
  // Built INSIDE the vm context: a Date from this realm is not `instanceof`
  // the context's Date, and the script tests `v instanceof Date` exactly as
  // osLogDateKey_ does. Realm-crossing is the harness's problem, not the
  // script's - Apps Script has one realm.
  const vmDate = vm.runInContext('new Date(2026, 8, 9)', ctx);
  check('a real Date becomes dd/mm/yyyy',
        key(vmDate) === '09/09/2026', key(vmDate));
  check('a single-digit display still matches the padded form',
        key('9/9/2026') === '09/09/2026', key('9/9/2026'));
  check('and so does a dash-separated one',
        key('9-9-2026') === '09/09/2026', key('9-9-2026'));
  check('a padded string is left alone',
        key('09/09/2026') === '09/09/2026');
  check('a date with a time after it still reads as that day',
        key('09/09/2026 01:30') === '09/09/2026', key('09/09/2026 01:30'));
  check('and anything that is not a date is not one',
        key('') === '' && key(null) === '' && key('not a date') === '' &&
        key('9/9/26') === '',
        'a two-digit year is ambiguous and is refused rather than guessed');
}

head('[3] the weekly links: read once, filtered twice');
// B3 and B4 are rolling-file links, so they are routinely the SAME workbook
// asked about two different dates.
{
  check('jobs are grouped by workbook AND tab before reading',
        /var byWorkbook = \{\};/.test(SRC) &&
        /byWorkbook\[key\] = \{ url: job\.url, tab: job\.tab, dates: \[\] \};/.test(SRC),
        'one open, both dates');
  check('and identical url+tab+date triples collapse first',
        /var key = JSON\.stringify\(\[job\.url, job\.tab\.toLowerCase\(\), job\.onDate\]\);/
          .test(SRC) && /if \(seen\[key\]\) return;/.test(SRC),
        'B3 === B4 with C3 === C4 would otherwise write every row out twice');
  // A delimiter has to be a character that cannot occur in a URL, a tab name
  // or a date, and picking one is a bet. The first attempt used  and
  // landed in the file as three RAW 0x1f bytes rather than as escapes -
  // invisible in an editor, and exactly what the control-character sweep in
  // audit_pipeline exists to catch. It did not, because its file list was
  // hand-kept and had never heard of this file; it reads the folder now.
  check('the keys are JSON, so no separator can collide or be mis-escaped',
        SRC.indexOf('') === -1 && SRC.indexOf('\\u001f') === -1,
        'neither a raw byte nor the escape');
  check('the read takes a LIST of dates, not one',
        /function nplReadTabPak_\(url, tabName, dates\)/.test(SRC));
  check('a daily tab asks for everything by carrying no date',
        /var wantAll = dates\.some\(function \(d\) \{ return !d; \}\);/.test(SRC));
  check('a weekly link with no date beside it is SKIPPED, not widened',
        /if \(weeklyUrl && onDate\) \{/.test(SRC),
        'it would otherwise pull months of rows');
  check('the weekly tab name is fixed, not read from C3/C4',
        /var NPL_WEEKLY_TAB_ = 'NPL';/.test(SRC) &&
        /tab: NPL_WEEKLY_TAB_, onDate: onDate/.test(SRC),
        'C3/C4 hold the DATE for the weekly pair, unlike C1/C2');
  check('rows with no date at all are spacers and are dropped',
        /if \(!key\) continue;/.test(SRC));
}

head('[4] one unreachable link does not cost the other three');
{
  check('each workbook read is wrapped',
        /try \{\s*\n\s*combined = combined\.concat\(nplReadTabPak_\(/.test(SRC) &&
        /\} catch \(e\) \{/.test(SRC),
        'a partial log is recoverable; an exception is not');
  check('and a missing tab is logged rather than thrown',
        /tab '" \+ tabName \+ "' not found in/.test(SRC) ||
        /not found in" \+ url/.test(SRC) ||
        /tab '/.test(SRC));
  check('the control cells are read in ONE call, not eight',
        /getRange\('B1:C4'\)\.getValues\(\)/.test(SRC));
  check('only http(s) values count as links',
        /function nplUrlPak_\(v\)/.test(SRC) &&
        /indexOf\('https:\/\/'\) === 0/.test(SRC));
  const url = ctx.nplUrlPak_;
  check('so a stray note in B1 is not treated as one',
        url('https://x/y') === 'https://x/y' && url('see Dave') === '' &&
        url('') === '' && url(null) === '');
}

head('[5] the bonus column is formatted before it is written');
// The defect this whole ordering exists for: setValues PARSES "1AM" as a time
// serial unless the cell is already text, and the result no longer looks like
// a clock time, so the damage is permanent and accumulates every run.
{
  const write = SRC.slice(SRC.indexOf('function nplWriteRowsPak_'));
  check('setNumberFormat comes BEFORE setValues',
        write.indexOf("setNumberFormat('@')") !== -1 &&
        write.indexOf("setNumberFormat('@')") < write.indexOf('.setValues(rows)'),
        'the other order undoes every correction as it makes it');
  check('and it is column B, the bonus code',
        /getRange\(NPL_LOG_DATA_ROW_, 2, rows\.length, 1\)\.setNumberFormat\('@'\)/.test(write));
  check('the repair runs in the SAME execution as the write',
        /correctNplLogNames\(\)/.test(write),
        'a scheduled correction could land mid-rewrite');
  check('and cannot fail the rebuild',
        /catch \(e\) \{[\s\S]{0,160}NPL log name correction failed/.test(write));

  // One implementation for both logs, not two agreeing about the ordering.
  check('correctNplLogNames shares its body with the OS one',
        /function correctNplLogNames\(\) \{\s*\n\s*return correctLogBonusColumn_\(NPL_LOG_SHEET_NAME_NC_, NPL_LOG_FIRST_ROW_NC_\);/
          .test(NC) &&
        /function correctOsLogNames\(\) \{\s*\n\s*return correctLogBonusColumn_\(OS_LOG_SHEET_NAME_NC_, OS_LOG_FIRST_ROW_NC_\);/
          .test(NC),
        'the ordering above is the easy thing to get wrong in a copy');
  check('and that shared body still formats before writing',
        /function correctLogBonusColumn_[\s\S]{0,900}range\.setNumberFormat\('@'\);\s*\n\s*range\.setValues\(corrected\);/
          .test(NC));
  check('the NPL sheet and first row are declared beside the OS ones',
        /var NPL_LOG_SHEET_NAME_NC_ = 'NPL Log';/.test(NC) &&
        /var NPL_LOG_FIRST_ROW_NC_ = 7;/.test(NC));
}

head('[6] a run with nothing to write empties the log');
// Otherwise a quiet day leaves yesterday's rows on screen, which reads as
// today's.
{
  const write = SRC.slice(SRC.indexOf('function nplWriteRowsPak_'));
  check('the clear happens before the early return',
        write.indexOf('.clearContent()') < write.indexOf('if (rows.length === 0)'),
        'clearing only when there is a replacement leaves stale rows');
  check('and it clears all 16 columns',
        /clearContent\(\)/.test(write) && /NPL_SELECT_\.length\)\.clearContent/.test(write));
  check('the sheet is resolved case-insensitively',
        /function nplLogSheet_\(ss\)/.test(SRC) &&
        /getName\(\)\.trim\(\)\.toLowerCase\(\) === NPL_LOG_TAB_NAME_\.toLowerCase\(\)/.test(SRC),
        'getSheetByName matches exactly, and the tab is spelled both ways');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
