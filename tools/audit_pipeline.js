// Cross-checks every place the pipeline enumerates work areas or assumes a
// column position, across the Apps Script client and the Databricks notebooks.
// Run after adding a work area, adding a Data-tab column, or renaming an area.
const fs = require('fs'), vm = require('vm');
// Paths are resolved from this file, not hardcoded, so the checks run from any
// clone. The Databricks and Tampermonkey repos are expected as SIBLINGS of this
// one - that is how they sit on the machine this pipeline is maintained from.
const path = require('path');
const REPOS = path.resolve(__dirname, '..', '..');

const APPS = path.resolve(__dirname, '..') + path.sep;
const DBX = path.join(REPOS, 'Databricks-Live-Productivity-Output') + path.sep;
const TM = path.join(REPOS, 'Tampermonkey Scripts') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');
const n = (s, re) => (s.match(re) || []).length;

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const idx = R('Web - Index.html'), state = R('Web - JsState.html'),
      tables = R('Web - JsTables.html'), exp = R('Web - JsExport.html'),
      data = R('Web - JsData.html'), tour = R('Web - JsTourData.html'),
      code = R('Web - Code.js'), charts = R('Web - JsCharts.html'),
      ui = R('Web - JsUi.html'), helpers = R('Web - JsHelpers.html');

// Slice a `var NAME = [ ... ];` block without regex-escaping games.
// Ends at the first `];` rather than a line-start one: the tour's AREAS list is
// indented, and anchoring to "\n];" ran past it into the next list.
function grab(src, name) {
  const start = src.indexOf('var ' + name + ' = [');
  if (start === -1) throw new Error('list not found: ' + name);
  const end = src.indexOf('];', start);
  if (end === -1) throw new Error('unterminated list: ' + name);
  return src.slice(start, end);
}

// JsState evaluated for real, so lists that are DERIVED (rather than written
// out) still get counted, and the palette can be checked as data.
const stateCtx = { console };
vm.createContext(stateCtx);
vm.runInContext(
  state.replace(/<\/?script>/g, '').split('function applyConfigToCSSPak')[0],
  stateCtx);
const ev = expr => vm.runInContext(expr, stateCtx);

const AREAS = 24;
const COLS = AREAS + 5;   // 4 identity columns + areas + Productivity %

head('[1] work-area enumerations (expect ' + AREAS + ')');
const counts = {
  VOLUME_TYPES: n(grab(state, 'VOLUME_TYPES'), /\{ key:/g),
  MAIN_TABLE_METRIC_COLUMNS: n(grab(state, 'MAIN_TABLE_METRIC_COLUMNS'), /\{ key:/g),
  BREAKDOWN_AREAS: ev('BREAKDOWN_AREAS.length'),
  'volume panels': n(idx, /id="volPanel/g),
  'volume canvases': n(idx, /id="volChart/g),
  'tour AREAS': n(grab(tour, 'AREAS'), /'/g) / 2,
  PROC_AREA_COLUMNS_: n(grab(code, 'PROC_AREA_COLUMNS_'), /\{ key:/g),
  // 'all' is a third legal value - an area worked in BOTH buildings. It has
  // to be counted here or the map reads one area short of VOLUME_TYPES and
  // this check fails for an area that is in fact declared.
  AREA_SITE: n(state.slice(state.indexOf('var AREA_SITE = {'),
                           state.indexOf('};', state.indexOf('var AREA_SITE = {'))),
              /: '(e3|e1e2|all)'/g),
};
Object.keys(counts).forEach(k => check(k, counts[k] === AREAS, '= ' + counts[k]));

head('[1b] palette');
{
  const fams = ev('AREA_FAMILIES.map(f => f.name)');
  const vt = ev('VOLUME_TYPES.map(t => ({key:t.key, label:t.label, family:t.family, color:t.color, dark:t.colorDark}))');
  check('every area has a family', vt.every(t => t.family), '');
  check('every family is declared',
        vt.every(t => fams.indexOf(t.family) !== -1),
        vt.filter(t => fams.indexOf(t.family) === -1).map(t => t.key).join(',') || 'all found');
  check('every area has both themes',
        vt.every(t => /^#[0-9a-f]{6}$/.test(t.color) && /^#[0-9a-f]{6}$/.test(t.dark)), '');
  for (const mode of ['color', 'dark']) {
    const seen = {}, dup = [];
    vt.forEach(t => { if (seen[t[mode]]) dup.push(seen[t[mode]] + '/' + t.key + ' ' + t[mode]); seen[t[mode]] = t.key; });
    check('no two areas share a ' + (mode === 'dark' ? 'dark' : 'light') + ' hex', dup.length === 0, dup.join('; '));
  }
  // Eight: originally eight, down to six when BPP folded into Packing and
  // Automation Pick into Picking, then seven with TP Retail and eight again
  // with RTF. Loosening a guard to make a run go green is how the bugs these
  // checks exist for got in, so the compensating ones below were added in that
  // same change - the group palette is what actually needed eight slots, and it
  // no longer depends on how many families there are.
  check('AREA_FAMILIES has 8 slots', fams.length === 8, '= ' + fams.length);
  const grp = ev('AREA_GROUP_COLORS'), grpD = ev('AREA_GROUP_COLORS_DARK');
  check('AREA_GROUP_COLORS has 8 slots', grp.length === 8, '= ' + grp.length);
  check('AREA_GROUP_COLORS_DARK has 8 slots', grpD.length === 8, '= ' + grpD.length);
  // MAX_AREA_GROUPS is 7 and groupColor_ wraps, so a palette shorter than that
  // hands two groups in one dialog the same hue.
  check('group palette covers MAX_AREA_GROUPS',
        grp.length >= ev('MAX_AREA_GROUPS'), grp.length + ' hues for ' + ev('MAX_AREA_GROUPS') + ' groups');
  check('group palette is not derived from AREA_FAMILIES',
        state.indexOf('AREA_GROUP_COLORS = AREA_FAMILIES.map(') === -1,
        'written out, so family count cannot shrink it');
  // Folding is what makes the combined chart legible; if a family ever held
  // every area it would fold to one series and say nothing.
  const sizes = {};
  vt.forEach(t => { sizes[t.family] = (sizes[t.family] || 0) + 1; });
  check('no family holds more than half the areas',
        Math.max(...Object.values(sizes)) <= Math.ceil(AREAS / 2),
        Object.keys(sizes).map(k => k + ':' + sizes[k]).join(' '));
  // BREAKDOWN_AREAS is derived - assert it actually tracks VOLUME_TYPES.
  const bd = ev('BREAKDOWN_AREAS.map(a => a.key + "|" + a.label + "|" + a.color)');
  const want = ev('VOLUME_TYPES.map(t => areaBaseKey_(t.key) + "|" + t.label + "|" + t.color)');
  check('BREAKDOWN_AREAS tracks VOLUME_TYPES', bd.join() === want.join(), '');
  // Nothing may reach a raw .color on a work area: the theme has to be
  // resolved, or dark mode silently draws the light hexes.
  const rawColor = [];
  [['Web - JsCharts.html', charts], ['Web - JsUi.html', ui],
   ['Web - JsHelpers.html', helpers]].forEach(([name, src]) => {
    (src.match(/\b(?:vType|volType|t|type|area|pgType)\.color\b/g) || [])
      .forEach(m => rawColor.push(name + ' ' + m));
  });
  check('no unresolved .color on a work area', rawColor.length === 0, rawColor.join('; '));
}

head('[2] column lists (expect ' + COLS + ')');
check('#mainTable <th>', n(idx, /<th data-key="/g) === COLS, '= ' + n(idx, /<th data-key="/g));
const sortable = grab(state, 'mainTableSortableColumns');
check('mainTableSortableColumns', n(sortable, /\{ key:/g) === COLS, '= ' + n(sortable, /\{ key:/g));
const detail = grab(tables, 'DETAIL_TABLE_COLUMNS');
check('DETAIL_TABLE_COLUMNS', n(detail, /\{ key:/g) === COLS, '= ' + n(detail, /\{ key:/g));

head('[2b] the column lists are in the SAME ORDER as VOLUME_TYPES');
// Counting them is not enough. Four lists restate VOLUME_TYPES' order and
// labels by hand, and until this block existed nothing compared them: a list
// reordered on its own put every value under the wrong header, in both the main
// table and the expanded-row detail table, and the suite still said ALL CHECKS
// PASSED. The scaffolding differs - the metric list is areas only, the sortable
// and detail lists carry 4 identity columns and a trailing Productivity % - so
// each is sliced down to its area run before comparing.
{
  const sig = l => l.map(c => c.key + '|' + c.label).join('\n');
  const want = ev('VOLUME_TYPES.map(t => ({key: t.key, label: t.label}))');
  const wantSig = sig(want);
  const diff = got => {
    const a = got.split('\n'), b = wantSig.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) return 'first difference at #' + (i + 1) + ': ' + (a[i] || '(missing)') + ' vs ' + (b[i] || '(missing)');
    }
    return '';
  };

  const metric = ev('MAIN_TABLE_METRIC_COLUMNS.map(c => ({key: c.key, label: c.label}))');
  check('MAIN_TABLE_METRIC_COLUMNS', sig(metric) === wantSig, diff(sig(metric)));

  const sortAreas = ev('mainTableSortableColumns.slice(4, -1).map(c => ({key: c.key, label: c.label}))');
  check('mainTableSortableColumns', sig(sortAreas) === wantSig, diff(sig(sortAreas)));

  // Evaluated rather than regexed so its `type` field cannot confuse the parse.
  const detailCtx = { out: null };
  vm.createContext(detailCtx);
  vm.runInContext(detail + '];\nout = DETAIL_TABLE_COLUMNS;', detailCtx);
  const detailAreas = detailCtx.out.slice(4, -1).map(c => ({ key: c.key, label: c.label }));
  check('DETAIL_TABLE_COLUMNS', sig(detailAreas) === wantSig, diff(sig(detailAreas)));

  const th = [];
  {
    const re = /<th data-key="([^"]+)"(?: data-site="([^"]+)")?>([^<]*)<\/th>/g;
    let m;
    while ((m = re.exec(idx))) th.push({ key: m[1], site: m[2] || null, label: m[3] });
  }
  const thAreas = th.slice(4, -1);
  check('#mainTable <th> order', sig(thAreas) === wantSig, diff(sig(thAreas)));

  // The building a column belongs to is data, not something the markup gets to
  // restate: e1e2Inducting is e3 work despite its name (see AREA_SITE).
  const siteWrong = thAreas
    .filter(c => c.site !== ev('AREA_SITE[areaBaseKey_(' + JSON.stringify(c.key) + ')]'))
    .map(c => c.key + '=' + c.site);
  check('<th data-site> matches AREA_SITE', siteWrong.length === 0, siteWrong.join(', ') || 'all match');

  // volPanel<i> shows VOLUME_TYPES[i]: the renderer indexes panels straight
  // into the array. tagReorderItems_ overwrites both of these at init, so the
  // markup is only the pre-JS fallback - but a fallback that names the wrong
  // area is worse than no fallback, and only panel 0 was ever rewritten at
  // render time, so for years the other eighteen were simply stale.
  const panelWrong = [];
  want.forEach((t, i) => {
    const m = new RegExp('id="volPanel' + i + '">\\s*<div class="mini-table-title">\\s*<h2>([^<]*)</h2>\\s*<span class="tag">([^<]*)</span>').exec(idx);
    if (!m) { panelWrong.push('volPanel' + i + ' not found'); return; }
    const famWant = ev('VOLUME_TYPES[' + i + '].family');
    if (m[1] !== t.label) panelWrong.push('volPanel' + i + ' h2 "' + m[1] + '" vs "' + t.label + '"');
    else if (m[2] !== famWant) panelWrong.push('volPanel' + i + ' tag "' + m[2] + '" vs "' + famWant + '"');
  });
  check('volume panel headings', panelWrong.length === 0, panelWrong.join('; ') || 'all ' + AREAS + ' match');
}

head('[3] per-area cells are GENERATED, not hand-listed');
// The recurring bug was a hand-written run of numTdPak calls drifting out of
// step with the column lists. Rows must be built from the active list instead.
check('main + detail rows derive their cells',
  n(tables, /mainMetricColumnsActive_\(\)\.map/g) >= 2,
  n(tables, /mainMetricColumnsActive_\(\)\.map/g) + ' uses');
check('CSV header and row share one list', exp.indexOf('function rawDataCsvColumns_') !== -1);
check('no stale hardcoded CSV header', exp.indexOf('RAW_DATA_CSV_HEADERS_ =') === -1);
check('mobile sort select filters by building', tables.indexOf('sortableColumnsActive_()') !== -1);
check('table headers hide by building', tables.indexOf('th[data-site]') !== -1);
// The Bonus page's By Work Area panels looped VOLUME_TYPES raw, so they honoured
// the chips' hidden list but not the building filter - an E3 panel rendered on
// the E1/E2 page, with no chip beside it to turn off. It showed a head count
// because scopeRowsToSite_ keeps a cross-building operator's row and copies
// every area key onto it, so their E3 hours travel into E1/E2-scoped data.
// Comments are stripped before the test: the fix carries an explanatory comment
// naming volumeTypesActive_(), and matching raw text let that comment satisfy
// the check on its own - it passed with the fix reverted.
{
  const areaBranch = tables.slice(tables.indexOf("if (mode === 'area')"),
                                  tables.indexOf('buildBonusPanel_(t.label'));
  const code = areaBranch.replace(/\/\/[^\n]*/g, '');
  check('bonus work-area panels filter by building',
        code.indexOf('volumeTypesActive_()') !== -1 && code.indexOf('VOLUME_TYPES') === -1,
        'renderSideTablesPak iterates volumeTypesActive_(), not VOLUME_TYPES');
}

head('[4] every area key reaches the paths still keyed by name');
const keys = [];
{
  const re = /key: '([a-zA-Z0-9]+)Vol'/g, block = grab(state, 'VOLUME_TYPES');
  let m;
  while ((m = re.exec(block))) keys.push(m[1]);
}
keys.forEach(k => {
  const missing = [
    ['JsData block total', data.indexOf('r.' + k + ' || 0') !== -1],
    ['JsData row field', data.indexOf(k + 'Vol:') !== -1],
    ['JsData group init', data.indexOf(k + 'Vol: 0') !== -1],
    ['JsData group accum', data.indexOf('g.' + k + 'Vol +=') !== -1],
    ['Index th', idx.indexOf('data-key="' + k + 'Vol"') !== -1],
    ['Index th data-site', idx.indexOf('data-key="' + k + 'Vol" data-site="') !== -1],
    ['Code.js header map', code.indexOf("key: '" + k + "'") !== -1],
    ['AREA_SITE', new RegExp('\\b' + k + ": '(e3|e1e2|all)'").test(state)],
  ].filter(p => !p[1]).map(p => p[0]);
  check(k, missing.length === 0, missing.length ? 'MISSING: ' + missing.join(', ') : '');
});

head('[5] area names agree: notebook PROC_AREAS <-> Code.js headers');
const nb = JSON.parse(fs.readFileSync(DBX + 'Elmsall Live Productivity.ipynb', 'utf8'));
const nbSrc = nb.cells.map(c => c.source.join('')).join('\n');
const pStart = nbSrc.indexOf('PROC_AREAS = [');
const procBlock = nbSrc.slice(pStart, nbSrc.indexOf('\n]', pStart));
const nbAreas = [];
{
  const re = /"report": "([^"]+)",\s*"label": "([^"]+)"/g;
  let m;
  while ((m = re.exec(procBlock))) nbAreas.push({ report: m[1], label: m[2] });
}
check('notebook PROC_AREAS count', nbAreas.length === AREAS, '= ' + nbAreas.length);
const codeMap = [];
{
  const re = /stdHeader: '([^']+)',\s*volHeader: '([^']+)'/g, block = grab(code, 'PROC_AREA_COLUMNS_');
  let m;
  while ((m = re.exec(block))) codeMap.push({ std: m[1], vol: m[2] });
}
check('Code.js header pairs', codeMap.length === AREAS, '= ' + codeMap.length);
nbAreas.forEach((a, i) => {
  const c = codeMap[i] || {};
  const ok = c.std === a.report && c.vol === 'Volume - ' + a.label;
  check('  ' + a.report, ok, ok ? '' : 'std=' + c.std + '  vol=' + c.vol);
});

head('[6] Data tab positional assumptions (layout A..K)');
const DATA = ['Date', 'Hour', 'PAYLOAD_BONUSCODE', 'PAYLOAD_EVENTTYPE', 'Attribute',
              'Total_Quantity', 'Total_StandardHours', 'Total_SMV', 'Week',
              'Date Time Range', 'Report Name'];
const at = name => DATA.indexOf(name) + 1;
const archive = R('Spreadsheet - Archive.js'), cleanup = R('Spreadsheet - Daily Data Cleanup.js'),
      namec = R('Spreadsheet - Name Correction.js'), pstate = R('Spreadsheet - Pipeline State.js');
const num = (s, re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
[['Archive DATA_SORT_COLUMN', num(archive, /DATA_SORT_COLUMN: (\d+)/), at('Date Time Range')],
 ['Cleanup CLEANUP_KEY_COLUMNS_', num(cleanup, /CLEANUP_KEY_COLUMNS_ = (\d+)/), DATA.length],
 ['Cleanup CLEANUP_SORT_COLUMN_', num(cleanup, /CLEANUP_SORT_COLUMN_ = (\d+)/), at('Date Time Range')],
 ['NameCorrection NAME_COLUMN_', num(namec, /var NAME_COLUMN_ = (\d+)/), at('PAYLOAD_BONUSCODE')],
 ['NameCorrection HOURS_OUT_COLUMN_', num(namec, /HOURS_OUT_COLUMN_ = (\d+)/), at('Total_StandardHours')],
 ['NameCorrection HOURS_IN_COLUMN_', num(namec, /HOURS_IN_COLUMN_ = (\d+)/), at('Total_SMV')],
].forEach(p => check(p[0], p[1] === p[2], p[1] + ' vs ' + p[2]));
check('PipelineState locates its column by header',
  pstate.indexOf('PIPELINE_STATE_DATA_RANGE_HEADER_') !== -1 &&
  pstate.indexOf('PIPELINE_STATE_DATA_RANGE_COL_') === -1);

head('[7] notebook internals');
['Elmsall Live Productivity.ipynb', 'Elmsall Live Productivity - Backfill Mode.ipynb'].forEach(f => {
  const src = JSON.parse(fs.readFileSync(DBX + f, 'utf8')).cells.map(c => c.source.join('')).join('\n');
  const p = src.indexOf('PROC_AREAS = [');
  const areas = src.slice(p, src.indexOf('\n]', p));
  const tag = f.replace('Elmsall Live Productivity', 'nb').replace('.ipynb', '') + ': ';
  check(tag + AREAS + ' areas', n(areas, /"report":/g) === AREAS, '= ' + n(areas, /"report":/g));
  check(tag + 'header derived from PROC_AREAS', src.indexOf('PROC_HEADER = (["Date", "Hour", "BONUS"]') !== -1);
  check(tag + 'clear range derived', src.indexOf('PROC_LAST_COL') !== -1);
  check(tag + 'grid widened before write', src.indexOf('proc_ws.resize(cols=len(PROC_HEADER))') !== -1);
  check(tag + 'divisors aligned to PROC_AREAS', src.indexOf('PROC_DIVISORS[i]') !== -1);
  const cs = src.indexOf('COLUMNS = [');
  const colsBlock = src.slice(cs, src.indexOf(']', cs));
  check(tag + 'Data COLUMNS = ' + DATA.length, n(colsBlock, /'/g) / 2 === DATA.length, '= ' + n(colsBlock, /'/g) / 2);
  check(tag + 'pivot Report Name r[10]', src.indexOf('area_index.get(r[10].strip())') !== -1);
  check(tag + 'pivot Date Time Range r[9]', src.indexOf('key = (r[9].strip()') !== -1);
  check(tag + 'pivot StdHours r[6]', src.indexOf('_f(r[6])') !== -1);
  check(tag + 'pivot Quantity r[5]', src.indexOf('_f(r[5])') !== -1);

  // OS / Indirect is joined by header NAME on the dashboard side, so the two
  // repos agree on one literal or they agree on nothing. Spelled differently
  // here - the space after the slash is the easy one to lose - the column
  // resolves to -1, every row reads os:false, and the bands simply never draw.
  // No error is raised anywhere along that path, which is why this is a check
  // rather than a comment.
  check(tag + 'OS column in PROC_HEADER', src.indexOf('"OS/ Indirect"') !== -1);
  // Both OS columns have to stay LAST, and in this order.
  // legacyProcColumnMap_ addresses the standard-hours and volume blocks
  // positionally for files too old to have a usable header row, and those
  // offsets only hold while nothing is inserted AHEAD of them. Appending past
  // them - which is all OS Time does - costs nothing.
  check(tag + 'the OS columns are last, in order',
        /\+\s*\[\s*"OS\/ Indirect",\s*"OS Time"\s*\]\s*\)/
          .test(src.replace(/\s*\n\s*/g, ' ')));
});

head('[7c] OS column agrees across repos');
{
  // The dashboard half of the same literal.
  const code = fs.readFileSync(APPS + 'Web - Code.js', 'utf8').replace(/\/\/[^\n]*/g, '');
  const m = code.match(/PROC_OS_HEADER_\s*=\s*'([^']+)'/);
  check('Code.js declares PROC_OS_HEADER_', !!m, m ? m[1] : 'missing');
  const nbSrc = JSON.parse(fs.readFileSync(DBX + 'Elmsall Live Productivity.ipynb', 'utf8'))
    .cells.map(c => c.source.join('')).join('\n');
  check('and it matches the notebook byte for byte',
        !!m && nbSrc.indexOf('"' + m[1] + '"') !== -1,
        m ? JSON.stringify(m[1]) : '');
}

head('[7b] userscript backfill map <-> notebook reports');
{
  // The third leg of the pipeline, and the one with no loud failure mode: a
  // report missing from REPORT_POST_URLS_BACKFILL still RUNS in WHDS and still
  // saves locally, it just never gets posted. That looks identical to the
  // report working, so it went unnoticed for twelve work areas until this
  // check existed. Nothing here can catch it except comparing the two lists.
  const us = fs.readFileSync(TM + '[PAK] PSD - Bonus Hub Report Runner.user.js', 'utf8');
  const nbBack = fs.readFileSync(DBX + 'Elmsall Live Productivity - Backfill Mode.ipynb', 'utf8');

  const wanted = (JSON.parse(nbBack).cells || [])
    .map(c => (c.source || []).join(''))
    .join('\n')
    .match(/\{"name":\s*"(D\.Analysis - [^"]+)"/g) || [];
  const want = wanted.map(m => m.replace(/^\{"name":\s*"/, '').replace(/"$/, ''));

  const from = us.indexOf('const REPORT_POST_URLS_BACKFILL');
  const got = from === -1 ? [] :
    (us.slice(from, us.indexOf(']))', from)).match(/'(D\.Analysis - [^']+)'/g) || [])
      .map(m => m.slice(1, -1));

  check('notebook backfill reports = ' + AREAS, want.length === AREAS, '= ' + want.length);
  check('userscript backfill entries = ' + AREAS, got.length === AREAS, '= ' + got.length);
  const missing = want.filter(n => got.indexOf(n) === -1);
  const extra = got.filter(n => want.indexOf(n) === -1);
  check('every notebook report is postable', missing.length === 0, missing.join(', ') || 'none missing');
  check('no orphan entries in the userscript', extra.length === 0, extra.join(', ') || 'none orphaned');
  check('same order as the notebook', JSON.stringify(want) === JSON.stringify(got), '');

  // The backfill notebook's "Select Reports" multiselect can only offer names
  // that exist when the widget is created. That list used to be a REPORT_NAMES
  // literal - a second copy of the same names, restated by hand, which nothing
  // compared against all_reports. Adding a report left the widget unable to
  // offer it while Filter Mode "All" still ran it, so the only symptom was a
  // name missing from a dropdown; three had gone missing before anyone noticed.
  //
  // Read from the PARSED source rather than the raw file: inside the .ipynb
  // JSON every quote on that line is backslash-escaped.
  const backSrc = (JSON.parse(nbBack).cells || [])
    .map(c => (c.source || []).join('')).join('');
  const derivedNames = 'REPORT_NAMES = [r["name"] for r in all_reports]';
  check('backfill widget list is derived, not restated',
        backSrc.indexOf(derivedNames) !== -1,
        backSrc.indexOf('REPORT_NAMES') === -1
          ? 'REPORT_NAMES is gone entirely'
          : 'REPORT_NAMES comes from all_reports');

  // One endpoint, declared once - nineteen copies of a URL is nineteen chances
  // to repoint one of them by accident.
  const urlCount = (us.slice(from, us.indexOf(']))', from)).match(/https:\/\/script\.google\.com/g) || []).length;
  check('the URL is not repeated per entry', urlCount === 0,
        urlCount ? urlCount + ' inline URLs inside the map' : 'declared once above the list');
}

head('[8] syntax');
[['Web - Code.js', 0], ['Spreadsheet - Archive.js', 0],
 ['Spreadsheet - Daily Data Cleanup.js', 0], ['Spreadsheet - Name Correction.js', 0],
 ['Spreadsheet - Pipeline State.js', 0], ['Web - doPost.js', 0],
 ['Web - JsState.html', 1], ['Web - JsData.html', 1], ['Web - JsTables.html', 1],
 ['Web - JsExport.html', 1], ['Web - JsTourData.html', 1], ['Web - JsCharts.html', 1],
 ['Web - JsUi.html', 1], ['Web - JsHelpers.html', 1], ['Web - JsInit.html', 1],
 ['Web - JsShare.html', 1], ['Web - JsTour.html', 1],
 // These four were simply missed. Every one is a <script> include shipped to
 // the browser exactly like the others, so a syntax error in any of them breaks
 // the page just as hard - being small is not being safe.
 ['Web - JsModal.html', 1], ['Web - JsReorder.html', 1],
 ['Web - JsToast.html', 1], ['Web - JsPullRefresh.html', 1],
 ['Web - JsOnboarding.html', 1], ['Web - JsPageOs.html', 1]].forEach(pair => {
  let body = R(pair[0]);
  if (pair[1]) body = body.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  try { new vm.Script(body, { filename: pair[0] }); check(pair[0], true); }
  catch (e) { check(pair[0], false, e.message); }
});

head('[' + 'a class that sets display cannot un-hide a [hidden] element' + ']');
{
  // [hidden] and a class selector both have specificity (0,1,0), so whichever
  // rule is declared LATER in the stylesheet wins - regardless of which one is
  // "supposed" to apply. A class with its own `display:` sets exactly that
  // trap: .note-banner { display: flex } sat after the browser's built-in
  // [hidden] rule and silently defeated it, so `el.hidden = true` stopped
  // hiding anything. There is no error, no warning - the element is simply
  // visible when it should not be.
  //
  // So: any class this codebase toggles `.hidden` on, that ALSO declares its
  // own `display`, must carry an explicit `.class[hidden] { display: none }`
  // override - the fix already in place for .onboarding-error.
  const styles = R('Web - Styles.html');
  const scripts = fs.readdirSync(APPS).filter(f => /^Web - Js.*\.html$/.test(f))
    .map(f => R(f)).join('\n');

  // Two passes rather than a line-proximity guess, which missed the very case
  // this check exists for: JsInit looks noteBanner up on one line and sets
  // .hidden five lines later, well outside a small window. Pass 1 maps every
  // `var x = $('someId')` / `x = $('someId')` binding; pass 2 walks every
  // `<name>.hidden =` and resolves through that map when the name is not
  // itself a literal id lookup.
  const idFor = {};
  let bm;
  const bindRe = /(?:var\s+)?(\w+)\s*=\s*\$\(\s*['"]([\w-]+)['"]\s*\)/g;
  while ((bm = bindRe.exec(scripts))) { idFor[bm[1]] = bm[2]; }

  const idsToggled = new Set();
  let hm;
  const hiddenRe = /\$\(\s*['"]([\w-]+)['"]\s*\)\s*\.hidden\s*=|(\w+)\s*\.hidden\s*=/g;
  while ((hm = hiddenRe.exec(scripts))) {
    if (hm[1]) idsToggled.add(hm[1]);
    else if (idFor[hm[2]]) idsToggled.add(idFor[hm[2]]);
  }

  const index = R('Web - Index.html') + R('Web - Header.html');
  let bad = [];
  idsToggled.forEach(id => {
    const tag = new RegExp('id=["\']' + id + '["\'][^>]*class=["\']([^"\']+)["\']|class=["\']([^"\']+)["\'][^>]*id=["\']' + id + '["\']');
    const hit = index.match(tag);
    if (!hit) return;
    const classes = (hit[1] || hit[2]).split(/\s+/);
    classes.forEach(cls => {
      const declares = new RegExp('\\.' + cls + '\\s*\\{[^}]*\\bdisplay\\s*:', 's').test(styles);
      const overridden = new RegExp('\\.' + cls + '\\[hidden\\]').test(styles);
      if (declares && !overridden) bad.push(id + ' (.' + cls + ')');
    });
  });
  check('every such class has a [hidden] override', bad.length === 0, bad.join(', '));
}

head('[' + 'nothing scrolls outside the iframe' + ']');
{
  // The dashboard is embedded in a Google Site, and Element.scrollIntoView()
  // scrolls every scrollable ancestor INCLUDING the host page - the tour, which
  // centres one ringed element after another, dragged the Site up and down and
  // left it parked below the embed showing its own empty space. Every call goes
  // through scrollIntoViewPak_, which stops at the app's own scroll container.
  //
  // A textual check because there is no way to observe the host page from a
  // test, and the symptom appears only when embedded - never in preview.html,
  // never in the Apps Script /exec page on its own.
  const files = fs.readdirSync(APPS).filter(f => /^Web - .*\.(html|js)$/.test(f));
  const offenders = [];
  files.forEach(f => {
    // Comments name it on purpose, explaining why it is not used.
    const body = fs.readFileSync(APPS + f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    if (/(?<!Pak_)\bscrollIntoView\s*\(/.test(body)) offenders.push(f);
  });
  check('no raw scrollIntoView in ' + files.length + ' web files',
        offenders.length === 0, offenders.join(', '));
  check('and the helper it must go through exists',
        /function scrollIntoViewPak_/.test(R('Web - JsHelpers.html')));
}


// ---------------------------------------------------------------------------
head('[the manager card opens from every surface that claims to have it]');
{
  // The hover / tap machinery matches ONE selector. The card used to live only
  // on bonus numbers in a table; it is now also on the active-filter chip and
  // on the head breakdown's chips, neither of which is a .clickable-bonus. A
  // surface that emits the card without the host class shows nothing at all,
  // and a surface that claims the class without emitting a card opens an empty
  // box - both silent, and both invisible to any arithmetic test.
  const ui = R('Web - JsUi.html');
  const machinery = (ui.match(/closestPak_\([^)]*'\.bonus-tip-host'\)/g) || []).length;
  check('the machinery matches .bonus-tip-host', machinery === 4,
        machinery + ' of 4 call sites (hover in, hover out, still-inside, tap)');
  check('and no longer matches .clickable-bonus directly',
        !/closestPak_\([^)]*'\.clickable-bonus'\)/.test(ui));

  // Every emitter of the card must also emit the class, and vice versa.
  const emitters = ['Web - JsTables.html', 'Web - JsUi.html'];
  emitters.forEach(f => {
    const body = R(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const cards = (body.match(/bonusTipHtmlPak_\(/g) || []).length;
    // Only class ATTRIBUTES count as emitting the host. The machinery's own
    // selectors name the class too, and they are not surfaces.
    const hosts = (body.match(/class="[^"]*bonus-tip-host/g) || []).length;
    check(f + ': a host class for every card', cards === hosts,
          cards + ' cards, ' + hosts + ' hosts');
  });

  // Two tooltips on one element: the browser's own from title=, and the card.
  const bodyU = R('Web - JsUi.html').replace(/\/\/[^\n]*/g, '');
  const chipLine = (bodyU.match(/[^\n]*breakdown-bonus-chip[^\n]*/) || [''])[0];
  check('the breakdown chip dropped its title attribute',
        chipLine.indexOf('bonusTitleAttrPak_') === -1,
        'the card replaces it; both at once shows two tooltips');
  const bannerLine = (bodyU.match(/[^\n]*class="chip bonus-tip-host[^\n]*/) || [''])[0];
  check('and so did the active-filter chip',
        bannerLine.indexOf('bonusTitleAttrPak_') === -1);

  // The card is reparented to <body>, so it has to clear whatever it opened
  // on top of. The breakdown overlay is the tallest thing it can open over.
  const css = R('Web - Styles.html');
  const floatZ = /\.bonus-tip\.tip-floating \{[^}]*z-index:\s*(\d+)/.exec(css);
  const overlayZ = /\.breakdown-overlay \{[^}]*z-index:\s*(\d+)/.exec(css);
  check('the floating card clears the breakdown overlay',
        floatZ && overlayZ && Number(floatZ[1]) > Number(overlayZ[1]),
        floatZ && overlayZ ? floatZ[1] + ' vs ' + overlayZ[1]
                           : 'could not read both z-indexes');
  check('and .tip-open is keyed on the shared host class',
        /\.bonus-tip-host\.tip-open \.bonus-tip/.test(css));
}

// ---------------------------------------------------------------------------
head('[the multi-area filter has a control wherever it applies]');
{
  // A filter that is applied but whose control is off screen is
  // indistinguishable from missing data.
  const tables = R('Web - JsTables.html');
  const ui = R('Web - JsUi.html');
  check('the Bonus page strip is shown in both view modes',
        /visible: true,\s*\n\s*areaChips: mode === 'area'/.test(
          tables.replace(/\/\/[^\n]*\n/g, '')),
        'Overall mode needs the chip even with no area chips to show');
  // The Bonus page's control is a dropdown in bonus-page-controls now, beside
  // Display Mode and Rows; the breakdown kept the cycling chip. Different
  // shapes, but they must offer the same three states under the same names, so
  // the options are written from the arrays the chip also reads rather than
  // typed into the markup.
  check('the Bonus page has a dropdown for it',
        R('Web - Index.html').indexOf('id="bonusAreaCount"') !== -1 &&
        /onchange="setBonusAreaCountFilter\(this\.value\)"/.test(R('Web - Index.html')));
  check('its options are generated, not hand-typed',
        /sel\.innerHTML = areaCountFilterOptionsHtmlPak_\(bonusAreaCountFilter\)/.test(tables) &&
        R('Web - Index.html').indexOf('Multi-area only') === -1,
        'typed twice, the dropdown and the chip would drift apart');
  check('and it is re-synced on every render',
        /renderBonusAreaCountSelect_\(\);/.test(tables) &&
        (tables.match(/renderBonusAreaCountSelect_\(\)/g) || []).length >= 3,
        'the tour sets the state directly, so the select must follow it');
  check('both controls read one list of modes',
        /AREA_COUNT_FILTER_MODES_/.test(R('Web - JsHelpers.html')) &&
        (R('Web - JsHelpers.html').match(/AREA_COUNT_FILTER_LABELS_\[/g) || []).length >= 2);
  check('the Bonus page no longer also renders the chip',
        !/countFilter: \{ mode: bonusAreaCountFilter/.test(tables),
        'two controls for one filter would disagree the moment either moved');
  check('the head breakdown renders its own copy',
        ui.indexOf("areaCountFilterChipHtmlPak_(\n        breakdownAreaCountFilter") !== -1 ||
        /areaCountFilterChipHtmlPak_\([\s\S]{0,80}breakdownAreaCountFilter/.test(ui));
  check('and there is a container for it',
        R('Web - Index.html').indexOf('id="breakdownCountFilter"') !== -1);
  check('both handlers exist',
        /function setBonusAreaCountFilter/.test(tables) &&
        /function setBreakdownAreaCountFilter/.test(ui));
  check('the chip is styled', /\.area-count-chip \{/.test(R('Web - Styles.html')));
  // The three states are named for the job, not the column: an operator on two
  // areas is on two TASKS, which is the word the floor uses.
  const helpers = R('Web - JsHelpers.html');
  check('the states are named for tasks',
        /all: 'All bonus numbers'/.test(helpers) &&
        /single: 'Single Task'/.test(helpers) &&
        /multi: 'Multi Tasks'/.test(helpers),
        'and because the arrays are shared, the breakdown chip renames with it');
}

head('[the control panel: five narrow pickers left, the bonus filter right]');
// Requested that way, and the grid only holds while the count of fields and
// the count of tracks agree. A sixth picker added to the markup would land in
// the SPACER track - silently, on top of nothing, with the bonus filter still
// pinned past it - so the two are checked against each other rather than
// separately.
{
  const hdr = R('Web - Header.html');
  const css = R('Web - Styles.html');
  const fields = (hdr.match(/class="hc-field[ "]/g) || []).length;
  const grow = (hdr.match(/class="hc-field hc-field-grow"/g) || []).length;
  check('six fields in the markup', fields === 6, fields + ' found');
  check('exactly one of them grows, and it is Filter by Bonus',
        grow === 1 && /hc-field-grow[\s\S]{0,200}for="bonusSearch"/.test(hdr),
        grow + ' found');

  // Seven tracks: five halves, the slack, then the bonus filter's full share.
  const desktop = /@media \(min-width: 701px\) \{\s*\.hc-filters \{([\s\S]*?)\}/.exec(css);
  check('five half-width tracks at desktop width',
        !!desktop && /repeat\(5, minmax\(0, calc\(\(100% - 72px\) \/ 12\)\)\)/.test(desktop[1]),
        desktop ? desktop[1].replace(/\s+/g, ' ').trim().slice(0, 80) : 'not found');
  check('then the slack, then a full share for the bonus filter',
        !!desktop && /minmax\(0, 1fr\)\s*minmax\(0, calc\(\(100% - 72px\) \/ 6\)\)/.test(desktop[1]),
        'the slack collects between the two groups, not through them');
  check('and the gap arithmetic matches seven tracks',
        !!desktop && desktop[1].indexOf('100% - 72px') !== -1,
        'six gaps of 12px; five tracks and one gap fewer would not divide right');
  check('the bonus filter is placed past the spacer, not auto-placed into it',
        /\.hc-field-grow \{ grid-column: 7; \}/.test(css),
        'auto-placement fills tracks in order and would drop it in track 6');
  check('and the selects lose the 140px floor a half-share cannot honour',
        /\.hc-field \.row-select \{ min-width: 0; \}/.test(css),
        'a grid item wider than its track overruns the one beside it');
  // Date and Warehouse hold a text span rather than being a control with its
  // own text, so nothing shrinks it for them.
  check('the two button labels can shorten rather than spill',
        /\.hc-field \.warehouse-label \{[^}]*text-overflow: ellipsis/
          .test(css.replace(/\.hc-field \.date-picker-label,\s*/g, '')),
        '"E1/E2, E3" is wider than a half-share of a 900px card');
}

head('[no source file carries a stray control character]');
// Found the hard way, twice in one session: a backslash escape that has been
// interpreted once too often leaves a raw control byte behind, and it is
// invisible in every editor. Once it was a regex where \b had become a
// backspace, so the check it guarded silently matched nothing. Once it was two
// CSS rules where \25B2 had become 0x15 + "B2", so the Data Table's sort
// arrows had been rendering as a control character followed by "B2".
//
// Neither failed loudly. Both are the kind of thing only a sweep finds.
{
  const FILES = ['Web - Code.js', 'Web - doPost.js', 'Web - Index.html',
    'Web - Header.html', 'Web - Styles.html', 'Web - PageOverall.html',
    'Web - JsState.html', 'Web - JsData.html', 'Web - JsCharts.html',
    'Web - JsTables.html', 'Web - JsHelpers.html', 'Web - JsUi.html',
    'Web - JsInit.html', 'Web - JsPageOs.html', 'Web - JsTour.html',
    'Web - JsTourData.html', 'Web - JsExport.html', 'Web - JsShare.html',
    'Web - JsModal.html', 'Web - JsReorder.html', 'Web - JsToast.html',
    'Web - JsPullRefresh.html', 'Web - JsOnboarding.html',
    'Spreadsheet - Archive.js', 'Spreadsheet - Name Correction.js',
    'Spreadsheet - OS Log.js', 'Spreadsheet - OS Links.js',
    'Spreadsheet - OnOpen.js', 'Spreadsheet - Pipeline State.js',
    'Spreadsheet - Daily Data Cleanup.js'];
  const found = [];
  FILES.forEach(f => {
    const src = R(f);
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i);
      // Tab, newline and carriage return are the only ones that belong.
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        found.push(f + ' 0x' + c.toString(16) + ' near: ' +
                   JSON.stringify(src.slice(Math.max(0, i - 40), i + 10)));
      }
    }
  });
  check('every file is free of them', found.length === 0, found.slice(0, 3).join('  |  '));
  // Both pairs: the .side-table rules were always intact and the
  // .main-detail-table ones were not, so only a COUNT catches it.
  {
    const css = R('Web - Styles.html');
    const ups = css.split("content: ' \\25B2'").length - 1;
    const dns = css.split("content: ' \\25BC'").length - 1;
    check('and every sort arrow is the escape, not a control byte',
          ups >= 2 && ups === dns,
          ups + ' up, ' + dns + ' down - they come in pairs, and a corrupted ' +
          'one is invisible next to an intact one');
  }
}

head('[the load is measurable, and measuring it cannot break it]');
// There was no instrumentation of any kind in getDashboardData, which made
// "the dashboard feels slow - what is it doing?" unanswerable, so every answer
// was a guess. These pin the two properties that make the logging worth
// having: that it covers every expensive read, and that it can never be the
// reason a load fails.
{
  // Code.js run for real, with the two Apps Script globals it touches stubbed.
  const logs = [];
  const cctx = {
    console, JSON, Date, Math, String, Number, Object, isNaN, parseInt, parseFloat,
    Logger: { log: s => logs.push(String(s)) },
    CacheService: { getScriptCache: () => ({ putAll() {}, getAll() { return {}; }, get() { return null; } }) }
  };
  vm.createContext(cctx);
  vm.runInContext(code, cctx);

  // Every read that can be slow has a mark of its own. Rolled into one
  // another, a log line cannot tell which of two reads was the expensive one -
  // which is the entire question.
  ['open', 'front', 'links', 'ydayCacheGet', 'ydayOpen', 'ydayRead',
   'liveRead', 'archiveRead', 'osLog', 'tmList'].forEach(label => {
    check("'" + label + "' is timed separately",
          code.indexOf("tm.mark('" + label + "'") !== -1);
  });

  check('cells are counted, not just rows',
        typeof cctx.procCells_ === 'function' &&
        cctx.procCells_({ vals: [new Array(55).fill(0), new Array(55).fill(0)] }) === 116,
        'getValues() costs by the cell, so rows alone cannot tell a wide tab ' +
        'from a slow one - and 2 rows x 55 cols + the A:C read is 116');
  check('and a missing read counts zero rather than throwing',
        cctx.procCells_(null) === 0 && cctx.procCells_({ vals: [] }) === 0);

  // The two silent ceilings. A cache that has never once populated looks
  // exactly like one that is working, unless it says so.
  // Sized off the constant rather than a literal, so raising the ceiling
  // cannot quietly stop this from testing the over-limit path — which is
  // exactly what happened when it went from 1.8M to 3M.
  const ceiling = cctx.CACHE_MAX_TOTAL_;
  check('the ceiling is high enough for a compacted yesterday slice',
        ceiling >= 3000000,
        ceiling + ' chars; ~20k rows joined by "|" is about 2.16M');
  logs.length = 0;
  cctx.cachePutLarge_('probe', 'x'.repeat(ceiling + 1), 900);
  check('a cache write over the limit says so',
        logs.some(l => l.indexOf('CACHE REFUSED probe: ' + (ceiling + 1) +
                                ' chars, limit ' + ceiling) !== -1),
        logs.join(' | ') || 'nothing logged');
  logs.length = 0;
  cctx.cachePutLarge_('probe', 'x'.repeat(1000), 900);
  check('and one under it reports how close it came',
        logs.some(l => /CACHE PUT probe: 1000 chars/.test(l)), logs.join(' | '));
  check('the client half of that reports too',
        /payload cache DECLINED/.test(R('Web - JsInit.html')),
        'declining the write costs the instant repaint on every reopen');

  // Instrumentation that can break the thing it measures is worse than none.
  cctx.Logger = { log() { throw new Error('quota'); } };
  let escaped = null;
  try {
    const t = cctx.loadTimer_();
    t.mark('x');
    t.note('y');
    t.done('LIVE');
  } catch (e) { escaped = e.message; }
  check('a logging failure cannot fail a load', escaped === null,
        escaped || 'swallowed');

  // Reading Executions means opening the script editor and hunting for the
  // right run. The person actually waiting on a slow load is the one who
  // should be able to see why it was slow.
  const init = R('Web - JsInit.html');
  check('the same line reaches the browser console',
        code.indexOf('payload.timing = tm.done(') !== -1 &&
        init.indexOf('if (data && data.timing) { console.info(data.timing); }') !== -1);
  check('and only for a FRESH fetch, not the cached paint',
        init.indexOf('console.info(data.timing)') <
        init.indexOf('savePayloadCache_(data, urlToFetch)'),
        'a stale line reported as this load would be worse than none');
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
