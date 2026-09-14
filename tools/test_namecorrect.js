// The 'Data' tab's column C correction.
//
// This file had no tests, which is how it came to be the thing damaging the
// column it exists to protect. The defect was one line of ORDER:
//
//   range.setValues(corrected);      <- parsed "1AM" into the time serial 1/24
//   range.setNumberFormat('@');      <- then froze that number as text
//
// setValues does not store a string verbatim. It parses each one the way
// typing it into the cell would, unless the cell is ALREADY formatted as text.
// So every correction was undone by the act of making it, and because
// "0.04166666667" no longer looks like a clock time, the next pass could not
// recognise it either - the damage was permanent and it accumulated hourly,
// across rows Databricks had written correctly with RAW.
//
// So the checks below are in two halves: the pure value mapping, and the ORDER
// of the two calls that write it. The second is the one that mattered, and it
// is invisible to any test of the mapping alone.
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

const SRC = R('Spreadsheet - Name Correction.js');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const fix = v => ctx.correctNameValue_(v);

head('[1] a code is left exactly as it is');
// The common case by a mile. Anything that changes a healthy code invents an
// operator, so this comes first.
['PIT', '9SV', 'L1W', 'MF5', 'A1', 'ZZ9'].forEach(c =>
  check(c + ' survives', fix(c) === c, fix(c)));
check('and case is folded up', fix('mf5') === 'MF5', fix('mf5'));
check('with surrounding space trimmed', fix('  pit  ') === 'PIT', fix('  pit  '));
check('an empty cell stays empty', fix('') === '' && fix(null) === '' && fix(undefined) === '');

head('[2] the damage this file was written for');
check('a rendered time', fix('01:00') === '1AM', fix('01:00'));
check('an afternoon one', fix('18:00') === '6PM', fix('18:00'));
check('rendered scientific notation', fix('3.00E+03') === '3E3', fix('3.00E+03'));
check('an all-zero code', fix('0') === '000', fix('0'));

head('[3] the damage this file CAUSED, and now has to undo');
// A time serial frozen as text. This is what the reported cells held, and no
// lookup in NAME_TIME_MAP_ can find it - it is a number, not a clock time.
check('0.04166666667 was 1AM', fix('0.04166666667') === '1AM', fix('0.04166666667'));
check('0.75 was 6PM', fix('0.75') === '6PM', fix('0.75'));
check('0.5 was 0PM', fix('0.5') === '0PM', fix('0.5'));
check('full precision works too', fix(String(1 / 24)) === '1AM', fix(String(1 / 24)));
check('and so does 21:00', fix(String(21 / 24)) === '9PM', fix(String(21 / 24)));
// The whole 0-9 range both sides of noon, since a gap would be one shift code
// silently unrecoverable.
let allHours = true;
for (let h = 1; h <= 9; h++) {
  if (fix(String(h / 24)) !== h + 'AM') allHours = false;
  if (fix(String((h + 12) / 24)) !== h + 'PM') allHours = false;
}
check('every 1-9 AM and PM code round-trips', allHours);
check('and midday', fix(String(12 / 24)) === '0PM', fix(String(12 / 24)));

check('100000000 was 1E8', fix('100000000') === '1E8', fix('100000000'));
check('3000 was 3E3', fix('3000') === '3E3', fix('3000'));
check('1000 was 1E3', fix('1000') === '1E3', fix('1000'));

head('[4] what it must NOT touch');
// A false repair is worse than leaving the damage: it invents an operator who
// was never on shift, and nothing downstream can tell.
check('10:00 has no code, so it is left alone',
      fix(String(10 / 24)) === String(10 / 24), fix(String(10 / 24)));
check('nor does 11:00', fix(String(11 / 24)) === String(11 / 24));
check('nor 22:00', fix(String(22 / 24)) === String(22 / 24));
check('a fraction that is not a whole hour stays put',
      fix('0.3') === '0.3', fix('0.3'));
check('and one that is close but not close enough',
      fix('0.042') === '0.042', fix('0.042'));
check('a three-digit number is a code, not notation',
      fix('100') === '100' && fix('250') === '250', fix('100') + ' / ' + fix('250'));
check('so is a four-digit one that is not a power of ten',
      fix('1234') === '1234' && fix('1500') === '1500', fix('1500'));
check('and anything with a letter in it is untouched',
      fix('1A8') === '1A8' && fix('0X5') === '0X5');
// Both "000" and "0AM" collapse to "0" and nothing separates them, so the
// existing choice stands rather than the recovery guessing differently.
check('"0" keeps the existing answer, not a time',
      fix('0') === '000', 'both 000 and 0AM land here; 000 was already chosen');

head('[5] every step is idempotent');
// correctDataRows_ promises this, and a second pass over a repaired tab is the
// normal case rather than the exception.
['PIT', '1AM', '6PM', '1E8', '000', '3E3'].forEach(c =>
  check(c + ' is stable', fix(fix(c)) === fix(c), fix(c) + ' -> ' + fix(fix(c))));

head('[6] the format is set BEFORE the write');
// The actual defect. Everything above passed while the column was being
// destroyed, because the mapping was never what was wrong.
{
  const body = SRC.split('function correctNameColumn_')[1].split('\n}')[0];
  const fmtAt = body.indexOf('setNumberFormat');
  const setAt = body.indexOf('setValues(corrected)');
  check('both calls are there', fmtAt !== -1 && setAt !== -1);
  check('and the format comes first', fmtAt < setAt,
        'setValues parses strings unless the cell is already text, so writing ' +
        'first stores 1/24 for "1AM" and the format change then freezes it');

  // Run it against a stub that behaves the way Sheets does, which is the only
  // way to catch a re-ordering: a source-order check alone would pass against
  // a range object that applied them in the other order internally.
  const sheetsLike = (initialFormat) => {
    let format = initialFormat;
    const stored = [];
    return {
      stored,
      getDisplayValues: () => [['1AM']],
      setNumberFormat(f) { format = f; },
      setValues(v) {
        // What Sheets does: a text-formatted cell takes the string, anything
        // else parses it.
        stored.push(format === '@' ? v[0][0] : (v[0][0] === '1AM' ? 1 / 24 : v[0][0]));
      }
    };
  };
  const run = (initialFormat) => {
    const range = sheetsLike(initialFormat);
    ctx.correctNameColumn_({ getRange: () => range }, 2, 1);
    return range.stored[0];
  };
  check('an unformatted cell keeps the code', run('General') === '1AM', String(run('General')));
  check('and an already-text one still does', run('@') === '1AM', String(run('@')));
}

head('[7] Processed Data is still left alone');
// Databricks is its sole writer and rebuilds it whole every 15 minutes. A
// second writer editing its column C mid-rebuild can pair one row's bonus code
// with another row's figures.
check('no reference to the pivot tab', SRC.indexOf('Processed Data') === -1 ||
      /does NOT touch 'Processed Data/.test(SRC));
check('the sheet it opens is Data', /DATA_SHEET_NAME_ = 'Data'/.test(SRC));

head('[8] the notebook still writes RAW, so nothing needs this on arrival');
{
  const nb = path.resolve(APPS, '..', 'Databricks-Live-Productivity-Output',
                          'Elmsall Live Productivity.ipynb');
  const cells = JSON.parse(fs.readFileSync(nb, 'utf8')).cells.map(c => c.source.join(''));
  check('the Data append is RAW',
        cells.some(c => /append_rows\(values, value_input_option='RAW'/.test(c)),
        'USER_ENTERED here is the original cause of all of the above');
  check('and so is the Processed Data write',
        cells.some(c => /proc_ws\.update\("A1".*value_input_option="RAW"/.test(c)));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
