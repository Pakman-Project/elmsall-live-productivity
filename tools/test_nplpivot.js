// NPL from the log to the chart: the notebook's two new pivot columns, the
// dashboard's read of them, the tag on a bonus number, and the band.
//
// The whole chain is joined by HEADER NAME across two repos. Spelled
// differently at either end, the column resolves to -1, every row reads
// npl:false, and the feature disappears with no error raised anywhere - so
// most of what follows is pinning literals from both sides at once.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const DBX = path.resolve(__dirname, '..', '..', 'Databricks-Live-Productivity-Output') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');
const NB = f => JSON.parse(fs.readFileSync(DBX + f, 'utf8'))
  .cells.map(c => c.source.join('')).join('\n');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const CODE = R('Web - Code.js');
const DATA = R('Web - JsData.html');
const HELP = R('Web - JsHelpers.html');
const CHARTS = R('Web - JsCharts.html');
const TABLES = R('Web - JsTables.html');
const UI = R('Web - JsUi.html');
const CSS = R('Web - Styles.html');
const STATE = R('Web - JsState.html');
const nb = NB('Elmsall Live Productivity.ipynb');
const nbBack = NB('Elmsall Live Productivity - Backfill Mode.ipynb');

// The pure helpers, run for real.
const ctx = { console, document: undefined };
vm.createContext(ctx);
const strip = s => s.replace(/<\/?script>/g, '');
vm.runInContext('var APP_CONFIG = { colors: { good: "#0a0", warn: "#fa0", bad: "#a00" } };', ctx);
vm.runInContext(strip(HELP), ctx);

head('[1] the two columns exist at both ends, spelled identically');
{
  const m = CODE.match(/PROC_NPL_HEADER_\s*=\s*'([^']+)'/);
  const t = CODE.match(/PROC_NPL_TIME_HEADER_\s*=\s*'([^']+)'/);
  check('Code.js declares both', !!m && !!t, (m ? m[1] : '?') + ' / ' + (t ? t[1] : '?'));
  check('and the notebook writes exactly those',
        !!m && nb.indexOf('"' + m[1] + '"') !== -1 &&
        !!t && nb.indexOf('"' + t[1] + '"') !== -1,
        'joined by name; a different spelling resolves to -1 in silence');
  check('the backfill notebook agrees with the live one',
        !!m && nbBack.indexOf('"' + m[1] + '"') !== -1 &&
        !!t && nbBack.indexOf('"' + t[1] + '"') !== -1,
        'a backfilled day would otherwise carry no NPL at all');
  // Appended, never inserted: legacyProcColumnMap_ addresses the std and
  // volume blocks positionally for files too old to have a header row.
  check('appended AFTER the OS pair, not inserted before it',
        /\+ \["OS\/ Indirect", "OS Time"\][\s\S]{0,40}\+ \["NPL Status", "NPL Time"\]\)/
          .test(nb.replace(/\s*\n\s*/g, ' ')),
        'inserting ahead of the positional block shifts every one of its offsets');
}

head('[2] the column indices the notebook reads out of NPL Log A7:P');
{
  const blk = nb.slice(nb.indexOf('NPL_LOG_TAB'), nb.indexOf('NPL log unreadable'));
  check('it reads A7:P, 16 wide', /NPL_RANGE = "A7:P"/.test(blk));
  check('Check is column M (index 12)', /_os_cell\(_r, 12\)/.test(blk), 'M = Check');
  check('Bonus is column B (index 1)', /_os_cell\(_r, 1\)\.upper\(\)/.test(blk));
  check('Date, Start and Finish are A, H and I',
        /_os_windows\(_os_cell\(_r, 0\), _os_cell\(_r, 7\), _os_cell\(_r, 8\)\)/.test(blk));
  // The same rule, so the same function - not a second copy of it.
  check('the production day comes from the SHARED window walker',
        /_wins, _why = _os_windows\(/.test(blk) && blk.indexOf('def _npl_windows') === -1,
        'a second copy of the 06:00 rule is a second thing to keep in step');
  check('and it degrades loudly rather than failing the run',
        /except Exception as _npl_err/.test(blk) &&
        /NPL Status will read NO for every row/.test(nb));
}

head('[3] the collision rank is the OPPOSITE of the OS one');
// OS lets the strongest verdict win, because an approved spell explains the
// block whatever was logged over it. This column flags time NOT signed off.
{
  const blk = nb.slice(nb.indexOf('def _npl_rank'), nb.indexOf('NPL_STATUS = {}'));
  check('there is a rank of its own', blk.length > 0 && /def _npl_rank/.test(nb));
  check('a not-OK outranks an OK', /return 2 if s\.lower\(\) == "ok" else 3/.test(blk),
        'hiding a not-OK under an OK buries the only thing worth acting on');
  check('and a blank ranks lowest', /return 1/.test(blk));
  check('the OS rank is untouched',
        /OS_STATUS_RANK = \{"Approved": 3, "Awaiting Approval": 2, OS_STATUS_UNKNOWN: 1\}/.test(nb));
}

head('[4] the dashboard reads them, and survives a file without them');
{
  check('both land in the column map',
        /npl: \(nplIdx === undefined\) \? -1 : nplIdx/.test(CODE) &&
        /nplTime: \(nplTimeIdx === undefined\) \? -1 : nplTimeIdx/.test(CODE));
  check('the read width covers them',
        /map\.npl \+ 1,\s*\n?\s*map\.nplTime \+ 1/.test(CODE),
        'short of that the columns are read as blank');
  // An absent field makes map.npl + 1 NaN, and Math.max poisons the whole
  // getRange - so the legacy map has to declare them even at -1.
  check('the legacy fallback map declares them, at -1',
        /var map = \{ total: total, os: -1, osTime: -1, npl: -1, nplTime: -1, areas: \[\] \};/
          .test(CODE),
        'undefined + 1 is NaN, which fails the read rather than the column');
  check('a row carries npl only when it has one',
        /entry\.npl = nplStatus !== '';/.test(CODE) &&
        /if \(nplStatus && nplStatus\.toUpperCase\(\) !== 'YES'\) entry\.nplStatus = nplStatus;/
          .test(CODE),
        'a field on the 99% of rows that are not NPL is payload paid on every poll');
  check('and the clip times only on the rows that are',
        /if \(entry\.npl && map\.nplTime >= 0\)/.test(CODE));
  // Same failure shape the v5 and v6 bumps were made for.
  check('the archive cache key is bumped',
        /ydayArch_v8_/.test(CODE),
        'a v7 line carries the pre-NPL header, so yesterday would show no NPL');
}

head('[5] one implementation per shape, not two');
// OS and NPL carry the identical shape of data from two independent logs.
{
  check('the span reader takes a field prefix',
        /function spanOfPak_\(rows, kind\)/.test(HELP) &&
        /function osSpanOfPak_\(rows\) \{ return spanOfPak_\(rows, 'os'\); \}/.test(HELP) &&
        /function nplSpanOfPak_\(rows\) \{ return spanOfPak_\(rows, 'npl'\); \}/.test(HELP));
  check('so does the span fold',
        /function foldSpanPak_\(g, r, blockAt, kind\)/.test(DATA) &&
        /function foldNplSpanPak_/.test(DATA));
  check('so does the bonus flag map',
        /function bonusFlagMapPak_\(entries, kind\)/.test(HELP) &&
        /function bonusNplMapPak_\(entries\) \{ return bonusFlagMapPak_\(entries, 'npl'\); \}/.test(HELP));
  check('and so does the band builder',
        /function mergeBandsPak_\(agg, kind\)/.test(CHARTS) &&
        /function pushBandPak_\(bands, agg, from, to, status, kind\)/.test(CHARTS),
        'the band geometry was got right once; two copies would not stay that way');

  // Run them.
  const rows = [
    { npl: true, nplFrom: '07:26', nplTo: '07:30', bonus: 'A' },
    { npl: true, nplFrom: '07:30', nplTo: '07:45', bonus: 'A' },
    { os: true, osFrom: '09:00', osTo: '09:15', bonus: 'B' }
  ];
  const span = ctx.nplSpanOfPak_(rows);
  check('nplSpanOfPak_ unions the NPL rows only',
        span.from === '07:26' && span.to === '07:45',
        span.from + ' - ' + span.to);
  check('and does not see the OS row beside them',
        ctx.osSpanOfPak_(rows).from === '09:00');
  const map = ctx.bonusNplMapPak_(rows);
  check('bonusNplMapPak_ flags only the NPL bonus',
        map.A === true && map.B === undefined, JSON.stringify(map));
}

head('[6] the Check is shown as logged - only OK is good');
{
  check('there is no three-state fold for it',
        /function nplStatusOfPak_\(statuses\)/.test(HELP) &&
        !/nplStatusBandPak_/.test(HELP),
        'OS folds because a band carries one label; this shows what was typed');
  const ok = ctx.nplCheckIsOkPak_;
  check('"OK" is the good one', ok('OK') === true);
  check('trimmed and case-insensitive, being a typed cell',
        ok(' ok ') === true && ok('Ok') === true);
  check('and everything else is not',
        ok('Awaiting sign off') === false && ok('Rejected') === false &&
        ok('') === false && ok(null) === false);
  const fold = ctx.nplStatusOfPak_;
  check('one wording over a bucket survives', fold(['Cancelled']) === 'Cancelled');
  check('a blank is not a vote', fold(['Cancelled', '']) === 'Cancelled');
  check('"YES" is the no-verdict placeholder, not a wording',
        fold(['YES', 'Cancelled']) === 'Cancelled');
  check('two different wordings cancel, as one label cannot carry both',
        fold(['Cancelled', 'Rejected']) === '');
  check('the colour is two-way, not three',
        /function CHART_NPL_STATUS\(check\)/.test(CHARTS) &&
        /nplCheckIsOkPak_\(check\) \? APP_CONFIG\.colors\.good : APP_CONFIG\.colors\.bad/.test(CHARTS));
  check('and the tooltip passes the wording straight through',
        /function nplBandTimeLabelPak_\(check, from, to\)/.test(HELP) &&
        /'NPL ' \+ c/.test(HELP));
  check('so a band cut happens on the RAW wording for NPL, folded for OS',
        /kind === 'os' \? osStatusBandPak_\(raw\)/.test(CHARTS));
}

head('[7] the band: its own tint, under the OS one, both labelled');
{
  check('it has colours of its own',
        /function CHART_NPL_BAND\(\)/.test(CHARTS) && /function CHART_NPL_EDGE\(\)/.test(CHARTS));
  // Measured INSIDE beforeDatasetsDraw. Against the whole file this compared
  // the wrong occurrence - osBandTooltipPak_ mentions opts.nplBands and is
  // defined earlier, so the check passed no matter which band drew first.
  const draw = CHARTS.slice(CHARTS.indexOf('beforeDatasetsDraw:'),
                            CHARTS.indexOf('afterDatasetsDraw:'));
  check('NPL is drawn FIRST, so OS lands on top of it',
        draw.indexOf('CHART_NPL_BAND()') !== -1 &&
        draw.indexOf('CHART_NPL_BAND()') < draw.indexOf('CHART_OS_BAND()'),
        'OS has the finer status vocabulary, so it is the one worth reading');
  check('the labels are stacked, not one dropped',
        /ctx\.fillText\('NPL', mid, area\.bottom - 34\)/.test(CHARTS) &&
        /ctx\.fillText\('OS', mid, area\.top \+ 6\)/.test(CHARTS),
        'both are true of the block; hiding one loses a fact to save a pixel');
  check('both sets ride on the one existing options key',
        (CHARTS.match(/osBand: \{ bands: osBands, nplBands: nplBands \}/g) || []).length === 4,
        'all four banded charts');
  check('and both are gated on the bonus filter',
        /var nplBands = \(selectedBonuses\.length > 0\) \? mergeNplBands_\(agg\) : \[\];/.test(CHARTS),
        'unfiltered, somebody is always on NPL and the bands are wallpaper');
  check('the tooltip names both when a block is both',
        /var nplBand = osBandAtPak_\(opts\.nplBands \|\| \[\], items\[0\]\.dataIndex\);/.test(CHARTS));
  check('and it still fires when only the NPL set is populated',
        /\(!opts\.bands \|\| !opts\.bands\.length\) &&\s*\n\s*\(!opts\.nplBands \|\| !opts\.nplBands\.length\)\)\) return \[\];/
          .test(CHARTS),
        'the old guard returned early on a chart with NPL bands but no OS ones');

  // The band object carries no field the comparisons do not expect.
  const agg = [{ npl: true, nplStatus: 'OK', nplFrom: '07:00', nplTo: '07:15' }];
  vm.runInContext(strip(CHARTS).split('// ── Hover crosshair')[0]
    .replace(/function _isLightTheme_[\s\S]*?\n  \}/, 'function _isLightTheme_() { return true; }'), ctx);
  check('a band is {from, to, status} and nothing else',
        Object.keys(ctx.mergeNplBands_(agg)[0]).filter(k => ['from','to','status','t0','t1','x0','x1'].indexOf(k) === -1).length === 0,
        Object.keys(ctx.mergeNplBands_(agg)[0]).join(','));
}

head('[8] the tag, beside the OS one');
{
  check('there is a tag builder',
        /function nplTagHtmlPak_\(isNpl\)/.test(HELP) && /class="npl-tag"/.test(HELP));
  check('returning nothing when they were not on NPL, so callers concatenate freely',
        /if \(!isNpl\) return '';/.test(HELP));
  check('it is a class of its own, not a modifier on .os-tag',
        /\.npl-tag \{/.test(CSS) && /\.clickable-bonus:hover \.npl-tag,/.test(CSS),
        'the two sit side by side whenever somebody is in both logs');
  check('rendered at all three table sites',
        (TABLES.match(/nplTagHtmlPak_\(/g) || []).length === 3,
        'two detail rows and the Bonus page');
  check('and in the head breakdown',
        /nplTagHtmlPak_\(bonusNpl\[bonusName\]\)/.test(UI));
  check('with the maps built beside the OS ones',
        /currentDetailNplMap = bonusNplMapPak_\(slice\);/.test(TABLES) &&
        /currentBonusNplMap = bonusNplMapPak_\(windowData\);/.test(TABLES) &&
        /var currentBonusNplMap = \{\};/.test(STATE));
  check('the tag says what it means on hover',
        /title="On non-productive labour in this period"/.test(HELP));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
