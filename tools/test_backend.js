// The 'Backend' tab — the same rows as 'Processed Data (15mins)', one column.
//
// Why it exists is measured, not assumed. Reading the wide tab cost FORTY
// SECONDS of a forty-three second load: 2.9 million cells across two
// spreadsheets, because live mode reads yesterday's archive as well. Apps
// Script's Sheets bridge costs per CELL rather than per byte, and 23 of every
// 24 area columns on a row are zero, so almost all of it was marshalling
// noughts. One column is 57x fewer cells.
//
// That makes this the second reader of one set of rows, and the whole danger is
// the two drifting. A divergence here does not fail: it renders a dashboard
// that looks entirely plausible and is wrong. So the suite leads with running
// BOTH readers over the same fixture and demanding byte-identical entries, and
// only then checks the things around it.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};
const R = f => fs.readFileSync(APPS + f, 'utf8');

const CODE = R('Web - Code.js');
const logs = [];
const ctx = {
  console, JSON, Date, Math, String, Number, Object, Array, isNaN, parseInt, parseFloat,
  RegExp, Error,
  Logger: { log: s => logs.push(String(s)) },
  CacheService: { getScriptCache: () => cacheStub }
};
// A CacheService that behaves: chunked writes land, chunked reads come back.
const cacheStore = {};
const cacheStub = {
  putAll(map) { Object.keys(map).forEach(k => { cacheStore[k] = map[k]; }); },
  getAll(keys) {
    const out = {};
    keys.forEach(k => { out[k] = Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; });
    return out;
  },
  get(k) { return Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; }
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);

// ── the header, built from the SAME constants the notebook builds it from ───
// Date, Hour, BONUS | 24 std | Sum of Std hrs | 24 volumes | OS/ Indirect,
// OS Time. Derived rather than written out, so adding a work area cannot make
// this fixture disagree with the thing it is testing.
const AREAS = ctx.PROC_AREA_COLUMNS_;
const HEADER = ['Date', 'Hour', 'BONUS']
  .concat(AREAS.map(a => a.stdHeader))
  .concat([ctx.PROC_TOTAL_HEADER_])
  .concat(AREAS.map(a => a.volHeader))
  .concat([ctx.PROC_OS_HEADER_, ctx.PROC_OS_TIME_HEADER_]);

const TR = '15/09/2026 07:15 - 15/09/2026 07:30';

// One row as the notebook writes it: a person in ONE area, zero everywhere
// else, which is the shape that makes the wide tab so wasteful.
function row(bonus, areaIdx, std, vol, os, osTime) {
  const r = [TR, 7, bonus];
  for (let i = 0; i < AREAS.length; i++) r.push(i === areaIdx ? std : 0);
  r.push(std);
  for (let i = 0; i < AREAS.length; i++) r.push(i === areaIdx ? vol : 0);
  r.push(os || 'NO');
  r.push(osTime || '');
  return r;
}

const ROWS = [
  row('AAA', 0, 0.2033333333333333, 137),
  row('BBB', 3, 0.18, 90),
  row('CCC', 11, 0, 0, 'Approved', '07:26 - 07:30'),
  row('DDD', 23, 0.4, 1204)
];

// ── stub sheets ─────────────────────────────────────────────────────────────
// The wide tab, answering the three ranges readProcRows_ asks for.
function wideSheet(header, rows) {
  return {
    getLastColumn: () => header.length,
    getLastRow: () => rows.length + 1,
    getRange(r, c, nr, nc) {
      if (r === 1) return { getDisplayValues: () => [header.slice(0, nc)] };
      const body = rows.map(x => x.slice(0, nc));
      return { getValues: () => body, getDisplayValues: () => body.map(x => x.map(String)) };
    }
  };
}

// The Backend tab: one column, header on row 1.
function backendSs(lines, name) {
  const sheet = {
    getName: () => (name === undefined ? 'Backend' : name),
    getLastRow: () => lines.length,
    getRange: () => ({ getDisplayValues: () => lines.map(l => [l]) })
  };
  return { getSheets: () => [sheet] };
}

const join = r => r.map(c => (c === null || c === undefined ? '' : String(c))).join('|');
const LINES = [join(HEADER)].concat(ROWS.map(join));

head('[1] the two readers must not diverge');
// The check this suite exists for. A divergence renders a plausible wrong
// dashboard rather than failing, so it is compared on the ENTRIES both
// readers ultimately produce, byte for byte, not on the intermediate arrays.
{
  const wide = ctx.readProcRows_(wideSheet(HEADER, ROWS), ROWS.length + 1);
  const fast = ctx.readBackendRows_(backendSs(LINES));
  check('the Backend tab is read at all', !!fast);

  const entries = read => read.vals.map((v, i) =>
    ctx.buildSideEntry_(v, read.disps[i], read.map));
  const w = entries(wide), f = entries(fast);

  check('same number of rows', w.length === f.length, w.length + ' vs ' + f.length);
  check('and every entry is byte-identical',
        JSON.stringify(w) === JSON.stringify(f),
        'the whole point of deriving Backend from proc_values rather than a ' +
        'field list of its own');

  // Spot-checked out loud as well, so a failure above says WHICH field.
  check('the full float precision survives the round trip',
        f[0].pieStd === 0.2033333333333333, String(f[0].pieStd));
  check('the volume too', f[0].pie === 137, String(f[0].pie));
  check('the window string, which contains a hyphen and spaces',
        f[0].timeRange === TR, f[0].timeRange);
  check('an OS row keeps its status and its clipped times',
        f[2].os === true && f[2].osStatus === 'Approved' &&
        f[2].osFrom === '07:26' && f[2].osTo === '07:30',
        JSON.stringify({ os: f[2].os, s: f[2].osStatus, a: f[2].osFrom, b: f[2].osTo }));
  check('and the LAST area is not lost off the end',
        f[3].rtfStd === 0.4 && f[3].rtf === 1204,
        'an off-by-one in the join would show here first');
}

head('[2] columns are mapped by NAME, through the same mapper');
// The discipline the whole pipeline rests on: inserting a work area moves every
// column after it, and only a header lookup survives that. A positional reader
// here would have thrown it away for no extra gain.
{
  const fast = ctx.readBackendRows_(backendSs(LINES));
  check('buildProcColumnMap_ is what does it',
        /buildProcColumnMap_\(String\(col\[0\]\[0\] \|\| ''\)\.split\(BACKEND_DELIM_\)\)/.test(CODE));
  check('the total column is found', fast.map.total === 3 + AREAS.length,
        String(fast.map.total));
  check('the OS columns are found',
        fast.map.os === HEADER.indexOf(ctx.PROC_OS_HEADER_) &&
        fast.map.osTime === HEADER.indexOf(ctx.PROC_OS_TIME_HEADER_));

  // Worth stating precisely, because it is half positional and that is easy
  // to get wrong: A (the window) and C (the bonus) are read by INDEX -
  // buildSideEntry_ has always done dispsRow[0] and dispsRow[2] - and
  // everything from D onwards is mapped by header name. So the first three
  // columns must stay put, and the rest may move freely.
  check('A and C are positional, by long-standing design',
        /timeRange: String\(dispsRow\[0\]\)/.test(CODE) &&
        /bonus: String\(dispsRow\[2\]\)/.test(CODE),
        'the Backend tab preserves column order, so this is safe - but it is ' +
        'why the header check above is not the whole story');

  // Reorder everything the MAP covers, leaving A:C alone, and it still reads
  // correctly. That is the property that makes inserting a work area safe.
  const fixed = [0, 1, 2];
  const moved = HEADER.map((h, i) => i).slice(3).reverse();
  const order = fixed.concat(moved);
  const shuffled = [join(order.map(i => HEADER[i]))]
    .concat(ROWS.map(r => join(order.map(i => r[i]))));
  const sh = ctx.readBackendRows_(backendSs(shuffled));
  const a = ctx.buildSideEntry_(sh.vals[0], sh.disps[0], sh.map);
  check('every mapped column can move and still read right',
        a.bonus === 'AAA' && a.pieStd === 0.2033333333333333 &&
        a.value === 0.2033333333333333 && a.pie === 137,
        JSON.stringify({ bonus: a.bonus, pieStd: a.pieStd, value: a.value, pie: a.pie }));
  // The reversal puts OS Time before OS/ Indirect and the volumes before the
  // standard hours, so this is not a no-op.
  check('and that really did move them',
        order.slice(3).join() !== HEADER.map((h, i) => i).slice(3).join());
}

head('[3] it falls back rather than guessing');
// Three real cases, all of which have to degrade to the old path rather than
// to an empty dashboard: an archive cut before this tab existed, a live file
// whose notebook has not run since the change, and a header that no longer
// maps.
{
  check('no Backend tab -> null',
        ctx.readBackendRows_({ getSheets: () => [] }) === null);
  check('a tab under another name is not mistaken for it',
        ctx.readBackendRows_(backendSs(LINES, 'Processed Data (15mins)')) === null);
  check('but the name is matched case-insensitively',
        ctx.readBackendRows_(backendSs(LINES, 'BACKEND')) !== null,
        'somebody retyping the tab name must not silently halve the speed');
  check('header only, no rows -> null',
        ctx.readBackendRows_(backendSs([join(HEADER)])) === null);
  check('an unrecognisable header -> null',
        ctx.readBackendRows_(backendSs(['a|b|c', '1|2|3'])) === null,
        'NOT the positional legacy map: guessing positions from a header we ' +
        'have just failed to understand is how you get a plausible wrong page');

  // The fallback RUN, not just read: a file with no Backend tab has to come
  // back with the wide tab's rows. This is what keeps every archive cut before
  // the tab existed rendering at all, so it is exercised rather than grepped.
  {
    const sheet = wideSheet(HEADER, ROWS);
    const noBackend = { getSheets: () => [] };
    const got = ctx.readSourceRows_(noBackend, sheet, ROWS.length + 1);
    check('a file with no Backend tab still returns the wide rows',
          !!got && got.vals.length === ROWS.length, got ? got.vals.length + ' rows' : 'nothing');
    check('and says it fell back, so the timing line shows it',
          got && got.fallback === true);
    const e = ctx.buildSideEntry_(got.vals[0], got.disps[0], got.map);
    check('the rows are the real ones, not a placeholder',
          e.bonus === 'AAA' && e.value === 0.2033333333333333,
          JSON.stringify({ bonus: e.bonus, value: e.value }));
    // And the fast path really is preferred when both exist.
    const both = { getSheets: backendSs(LINES).getSheets };
    const fastGot = ctx.readSourceRows_(both, sheet, ROWS.length + 1);
    check('but the Backend tab wins when it is there', !fastGot.fallback);
  }

  // And the caller actually uses the fallback, at all three sites.
  check('every read site goes through readSourceRows_',
        (CODE.match(/readSourceRows_\(/g) || []).length === 4,
        'declaration plus three call sites; a direct readProcRows_ call would ' +
        'be a site where the fast path is silently never taken');
  check('the fallback is flagged so the timing line says so',
        /slow\.fallback = true;/.test(CODE) && /tm\.note\('ydayFELLBACK'\)/.test(CODE));
}

head('[4] the delimiter cannot appear in any field');
// A stray '|' would shift every field after it when the line is split back -
// silent corruption, and the exact class of bug this pipeline has hit twice
// with column positions. A comma was rejected for this reason: a Record Status
// of "Rejected, see notes" is entirely plausible.
{
  const nb = JSON.parse(fs.readFileSync(
    path.resolve(APPS, '..', 'Databricks-Live-Productivity-Output',
                 'Elmsall Live Productivity.ipynb'), 'utf8'))
    .cells.map(c => c.source.join('')).join('\n');

  check('the two sides agree on the delimiter',
        /BACKEND_DELIM = "\|"/.test(nb) && /BACKEND_DELIM_ = '\|'/.test(CODE));
  // Everything the notebook can write into a field.
  const fields = [TR, '7', 'AAA', '0AM', '000', '1E8', '0.2033333333333333', '0',
                  'NO', 'Approved', 'Awaiting Approval', 'Rejected',
                  'Escalated to Ops', '07:26 - 07:30', ctx.PROC_TOTAL_HEADER_,
                  ctx.PROC_OS_HEADER_, ctx.PROC_OS_TIME_HEADER_]
    .concat(HEADER);
  const bad = fields.filter(f => String(f).indexOf('|') !== -1);
  check('no window, code, number, status, time or header contains it',
        bad.length === 0, bad.join(', ') || fields.length + ' checked');

  // And if one ever does, it is rewritten and COUNTED rather than written
  // through. Visibly wrong beats invisibly wrong.
  check('the notebook rewrites and counts a stray one',
        /_b_mangled \+= 1/.test(nb) && /s\.replace\(BACKEND_DELIM, "\/"\)/.test(nb) &&
        /WARNING \{_b_mangled\} field\(s\) contained/.test(nb),
        'a mis-split row would be silent; a warning is not');
  check('and so does the Apps Script side, for the archive cache',
        /function backendJoin_\(row\)/.test(CODE) &&
        /s\.split\(BACKEND_DELIM_\)\.join\('\/'\)/.test(CODE));
}

head('[5] the archive cache stores lines, and now fits');
// It stored the expanded entry objects, which ran to ~19MB for this site's
// yesterday slice - so cachePutLarge_ refused the write every single time and
// the cache had never once populated. Every load paid to re-open and re-read
// yesterday's whole archive file for nothing.
{
  check('the ceiling was raised past a compacted slice',
        ctx.CACHE_MAX_TOTAL_ >= 3000000,
        ctx.CACHE_MAX_TOTAL_ + '; ~20k rows joined is about 2.16M, objects ~19M');
  check('lines go in, not objects',
        /cachePutLarge_\(yCacheKey, yLines_\.join\('\\n'\)/.test(CODE) &&
        CODE.indexOf('cachePutLarge_(yCacheKey, JSON.stringify(yEntries)') === -1);
  check('the header travels with them',
        /yLines_ = \[backendJoin_\(aRead\.header\)\]/.test(CODE),
        'so a slice cached before an area was added is re-mapped, not mis-read');
  check('and it is re-mapped by NAME on the way out',
        /var yMap = buildProcColumnMap_\(yLines\[0\]\.split\(BACKEND_DELIM_\)\)/.test(CODE) &&
        /if \(yMap\.total >= 0\)/.test(CODE));
  check('the key is bumped, as it is for every field change',
        /ydayArch_v7_/.test(CODE), 'v6 entries hold objects and would not parse');

  // Round-trip the real thing: lines in, entries out, identical.
  const cached = LINES.join('\n');
  const lines = cached.split('\n');
  const map = ctx.buildProcColumnMap_(lines[0].split('|'));
  const out = lines.slice(1).filter(Boolean)
    .map(l => { const c = l.split('|'); return ctx.buildSideEntry_(c, c, map); });
  const direct = (() => {
    const f = ctx.readBackendRows_(backendSs(LINES));
    return f.vals.map((v, i) => ctx.buildSideEntry_(v, f.disps[i], f.map));
  })();
  check('a cached slice reads back byte-identical to a fresh one',
        JSON.stringify(out) === JSON.stringify(direct));
}

head('[6] the TM List is cached - 23% of what a fast load costs');
// 1,031ms measured, on every load, for a bonus-to-manager directory edited by
// hand that changes daily at most.
{
  let reads = 0;
  const tmSheet = {
    getLastRow: () => 4,
    getRange: () => ({ getDisplayValues: () => { reads++; return [['AAA', 'J Ashworth', 'j@x.com'], ['BBB', 'P Okonkwo', 'p@x.com']]; } })
  };
  const ss = { getSheetByName: () => tmSheet };
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);

  const first = ctx.readTmDirectory_(ss);
  const second = ctx.readTmDirectory_(ss);
  check('the sheet is read once, not twice', reads === 1, reads + ' reads');
  check('and the second answer is the same', JSON.stringify(first) === JSON.stringify(second),
        JSON.stringify(second));
  check('the TTL is hours, not minutes', ctx.TM_CACHE_TTL_ >= 3600,
        ctx.TM_CACHE_TTL_ + 's');

  // An empty directory is what a MISSING tab returns. Pinning that for six
  // hours would turn a transient failure into an afternoon with no names.
  Object.keys(cacheStore).forEach(k => delete cacheStore[k]);
  const empty = ctx.readTmDirectory_({ getSheetByName: () => null });
  check('an empty directory is never cached',
        JSON.stringify(empty) === '{}' &&
        Object.keys(cacheStore).filter(k => k.indexOf('tmDirectory') === 0).length === 0,
        Object.keys(cacheStore).join(',') || 'nothing cached');
}

head('[7] the notebook writes it, derived from the tab it mirrors');
{
  const nbs = ['Elmsall Live Productivity.ipynb',
               'Elmsall Live Productivity - Backfill Mode.ipynb'];
  nbs.forEach(f => {
    const src = JSON.parse(fs.readFileSync(
      path.resolve(APPS, '..', 'Databricks-Live-Productivity-Output', f), 'utf8'))
      .cells.map(c => c.source.join('')).join('\n');
    const tag = f.replace('Elmsall Live Productivity', 'nb').replace('.ipynb', '') + ': ';
    check(tag + 'writes the Backend tab', /BACKEND_TAB = "Backend"/.test(src));
    check(tag + 'derived from PROC_HEADER and proc_values, not a second list',
          /_backend_row\(PROC_HEADER\)/.test(src) &&
          /_backend_row\(r\)\] for r in proc_values/.test(src),
          'a field list of its own is how the two tabs would drift');
    check(tag + 'the header is row 1', /\[\[_backend_row\(PROC_HEADER\)\]\] \+/.test(src));
    check(tag + 'creates the tab on first run',
          /sh\.add_worksheet\(title=BACKEND_TAB/.test(src),
          'no manual setup on the live file or on any archive');
    check(tag + 'grows the grid before writing',
          /if _b_ws\.row_count < len\(_b_values\)/.test(src),
          'a short grid rejects the write outright');
    check(tag + 'writes over the top, then clears the tail',
          src.indexOf('_b_ws.update("A1", _b_values') <
          src.indexOf('_b_ws.batch_clear'),
          'clearing first leaves the tab empty for a whole round trip, and ' +
          'the dashboard polls');
    check(tag + 'and Processed Data is still written in full',
          /proc_ws\.update\("A1", \[PROC_HEADER\] \+ proc_values/.test(src),
          'it is still the readable reference');
    check(tag + 'a failure here does not fail the run',
          /the dashboard will fall back to Processed Data/.test(src));
    // 46 of the ~50 fields on a typical row are exactly zero, so "0" against
    // "0.0" is a third of the whole tab - and the measured read came back at
    // 30 cells/ms against 85 for the wide tab, so the cost is charged by the
    // byte as well as by the cell.
    // Indentation-agnostic: the backfill notebook runs its pivot inside a
    // per-day loop, so every line of this block sits four spaces further in.
    check(tag + 'an integral float loses its ".0"',
          src.indexOf('if isinstance(c, float) and c.is_integer():') !== -1 &&
          src.indexOf('s = str(int(c))') !== -1,
          'a third of the tab, for no change to any value');
  });

  // The rule run rather than grepped, on the real function.
  {
    const src = JSON.parse(fs.readFileSync(
      path.resolve(APPS, '..', 'Databricks-Live-Productivity-Output',
                   'Elmsall Live Productivity.ipynb'), 'utf8'))
      .cells.map(c => c.source.join('')).join('\n');
    // "0" and "0.0" parse to the same number, so shortening cannot change a
    // figure - which is why the parity check in [1] is still green.
    check('and "0" reads back as the same number as "0.0"',
          ctx.toNumber_('0') === ctx.toNumber_('0.0') &&
          ctx.toNumber_('137') === ctx.toNumber_('137.0'),
          'the saving costs no precision at all');
    // Non-integral floats keep every digit: standard hours are a division and
    // rounding them WOULD change a figure.
    check('a non-integral float keeps its full precision',
          src.indexOf('else:\n        s = "" if c is None else str(c)') !== -1 ||
          /else:\s*\n\s*s = "" if c is None else str\(c\)/.test(src),
          'standard hours are a division; rounding them would move a number');
    check('and inf or nan cannot slip through as an integer',
          /c\.is_integer\(\)/.test(src),
          'is_integer() is False for both, unlike c == int(c) which throws');
  }
}

head('[8] an archive trims BOTH tabs, or reads the untrimmed one');
// The archive is a whole-file copy, so Backend arrives holding every date the
// live tab held - exactly what trimArchiveProcessedData_ exists to fix for the
// wide tab. And since the dashboard PREFERS Backend, trimming only the other
// one would leave it reading the untrimmed copy.
{
  const arch = R('Spreadsheet - Archive.js');
  check('the trim takes a sheet name and a width',
        /function trimArchiveProcessedData_\(archiveSS, dateKey, sheetName, forcedCols\)/.test(arch));
  check('and is called for Backend as well',
        /trimArchiveProcessedData_\(\s*archiveSS, dateKey, ARCHIVE_CFG\.BACKEND_SHEET_NAME/.test(arch));
  check('one column wide', /BACKEND_SHEET_COLS: 1/.test(arch));
  check('the window parser needs no change',
        /\^\(\\d\{1,2\}\)\\\/\(\\d\{1,2\}\)\\\/\(\\d\{4\}\)\\b/.test(arch),
        'it anchors at the start, and a joined row starts with the window');
  check('a joined row really does parse with it',
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.test(LINES[1]), LINES[1].slice(0, 24));
  check('the "column A changed shape" guard is still there, per tab',
        /no readable window in column A of '\$\{name\}'/.test(arch),
        'wiping everything is the wrong answer to a format change');
}

head('[9] one column is the whole point');
{
  const wide = ctx.readProcRows_(wideSheet(HEADER, ROWS), ROWS.length + 1);
  const fast = ctx.readBackendRows_(backendSs(LINES));
  const wideCells = ctx.procCells_(wide);
  check('the wide tab marshals ' + HEADER.length + ' columns plus the A:C read',
        wideCells === ROWS.length * (HEADER.length + 3), String(wideCells));
  check('the Backend tab marshals one per row, header included',
        fast.cells === ROWS.length + 1, String(fast.cells));
  check('which is ' + Math.round(wideCells / fast.cells) + 'x fewer at this size',
        fast.cells < wideCells / 10,
        'measured at 57x on the live tab: 2.9M cells -> 51k');
  check('and the second full-height display read is gone',
        /disps: vals,/.test(CODE),
        'a joined row is text, so what is displayed IS the value');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
