// Loads the real JsState/JsExport code and exercises the building filter.
const fs = require('fs'), vm = require('vm');
// Paths are resolved from this file, not hardcoded, so the checks run from any
// clone. The Databricks and Tampermonkey repos are expected as SIBLINGS of this
// one - that is how they sit on the machine this pipeline is maintained from.
const path = require('path');
const REPOS = path.resolve(__dirname, '..', '..');

const APPS = path.resolve(__dirname, '..') + path.sep;
const strip = f => fs.readFileSync(APPS + f, 'utf8')
  .replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');

const ctx = { console, document: undefined };
vm.createContext(ctx);
// JsState defines the lists, the site map and the scoping helpers.
vm.runInContext(strip('Web - JsState.html').split('function applyConfigToCSSPak')[0], ctx);
// Pull in just the CSV column builder from JsExport.
const exp = strip('Web - JsExport.html');
vm.runInContext(exp.slice(exp.indexOf('function rawDataCsvColumns_'), exp.indexOf('function buildRawDataCsvPak_')), ctx);
vm.runInContext('function csvEscapePak(v){return String(v);}', ctx);

let fail = 0;
const check = (label, ok, detail) => { if (!ok) fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`); };

// --- every area is assigned to exactly one building --------------------------
console.log('\n[1] building assignment');
const keys = vm.runInContext('VOLUME_TYPES.map(v => areaBaseKey_(v.key))', ctx);
const map = vm.runInContext('AREA_SITE', ctx);
check('every area has a building', keys.every(k => map[k]), keys.filter(k => !map[k]).join(',') || '');
const e3 = keys.filter(k => map[k] === 'e3'), e12 = keys.filter(k => map[k] === 'e1e2');
check('E3 count = 11', e3.length === 11, e3.length + ': ' + e3.join(' '));
check('E1/E2 count = 10', e12.length === 10, e12.length + ': ' + e12.join(' '));
check('no area in both', e3.filter(k => e12.includes(k)).length === 0);
// The third bucket: work done in BOTH buildings, which shows under either
// filter. These are the areas the two counts above do not add up over, so
// they are counted separately rather than by subtraction.
const both = keys.filter(k => map[k] === 'all');
check('both-buildings count = 1', both.length === 1, both.join(' '));
check('every area is in exactly one bucket',
  e3.length + e12.length + both.length === keys.length,
  `${e3.length}+${e12.length}+${both.length} vs ${keys.length}`);

// --- list filtering ----------------------------------------------------------
console.log('\n[2] list narrowing per building');
// A building shows its own areas PLUS the both-buildings ones, so E3 and
// E1/E2 deliberately overlap by `both.length` and no longer sum to the total.
for (const [site, n] of [['all', 22], ['e3', 12], ['e1e2', 11]]) {
  vm.runInContext(`siteFilter='${site}'`, ctx);
  const vt = vm.runInContext('volumeTypesActive_().length', ctx);
  const bd = vm.runInContext('breakdownAreasActive_().length', ctx);
  const mt = vm.runInContext('mainMetricColumnsActive_().length', ctx);
  const sc = vm.runInContext('sortableColumnsActive_().length', ctx);
  const csv = vm.runInContext('rawDataCsvColumns_().length', ctx);
  check(`${site}: volume/breakdown/metric = ${n}`, vt === n && bd === n && mt === n, `${vt}/${bd}/${mt}`);
  check(`${site}: sort list keeps 5 non-area cols`, sc === n + 5, String(sc));
  check(`${site}: CSV = 4 + ${n} + 1`, csv === n + 5, String(csv));
}

// --- scoping the rows --------------------------------------------------------
console.log('\n[3] scopeRowsToSite_ recomputes the hours');
const rows = [
  // std split across both buildings; `value` is the site-wide total
  { bonus: 'A1', timeRange: 'T1', value: 0.30, pieStd: 0.20, sorter6PackingStd: 0.10, pie: 100, sorter6Packing: 40 },
  { bonus: 'B2', timeRange: 'T1', value: 0.25, pieStd: 0.25, pie: 80 },                    // E3 only
  { bonus: 'C3', timeRange: 'T1', value: 0.15, e1e2BppStd: 0.15, e1e2Bpp: 33 },            // E1/E2 only
  { bonus: 'D4', timeRange: 'T1', value: 0.05, onlinePickingE3Std: 0.05, onlinePickingE3: 9 },
];
vm.runInContext('__rows = ' + JSON.stringify(rows), ctx);
const run = site => {
  vm.runInContext(`siteFilter='${site}'`, ctx);
  return vm.runInContext('scopeRowsToSite_(__rows)', ctx);
};
const sum = rs => Number(rs.reduce((a, r) => a + r.value, 0).toFixed(4));

const all = run('all'), only3 = run('e3'), only12 = run('e1e2');
check('all: untouched', all.length === 4 && sum(all) === 0.75, `${all.length} rows, ${sum(all)}h`);
check('e3: drops C3 (E1/E2 only)', only3.length === 3 && !only3.some(r => r.bonus === 'C3'),
  only3.map(r => r.bonus).join(','));
check('e3: A1 hours 0.30 -> 0.20', only3.find(r => r.bonus === 'A1').value === 0.20);
check('e3: total = 0.50', sum(only3) === 0.50, sum(only3) + 'h');
check('e1e2: only A1 + C3', only12.length === 2 && only12.every(r => ['A1', 'C3'].includes(r.bonus)),
  only12.map(r => r.bonus).join(','));
check('e1e2: A1 hours 0.30 -> 0.10', only12.find(r => r.bonus === 'A1').value === 0.10);
check('e1e2: total = 0.25', sum(only12) === 0.25, sum(only12) + 'h');
check('E3 + E1/E2 hours = site total', Number((sum(only3) + sum(only12)).toFixed(4)) === 0.75);
check('operator in both counted in both',
  only3.some(r => r.bonus === 'A1') && only12.some(r => r.bonus === 'A1'));
check('originals not mutated', rows[0].value === 0.30);

// --- head count --------------------------------------------------------------
console.log('\n[4] head deployed follows the building');
const heads = rs => new Set(rs.map(r => r.bonus)).size;
check('all = 4 operators', heads(all) === 4);
check('e3 = 3 operators', heads(only3) === 3);
check('e1e2 = 2 operators', heads(only12) === 2);

// --- non-area columns survive -----------------------------------------------
console.log('\n[5] scaffolding columns are never filtered out');
vm.runInContext("siteFilter='e1e2'", ctx);
const sortKeys = vm.runInContext('sortableColumnsActive_().map(c => c.key)', ctx);
for (const k of ['dateTime', 'bonusNumber', 'hourDeployed', 'stdHours', 'performance']) {
  check('keeps ' + k, sortKeys.includes(k));
}
check('drops E3 areas', !sortKeys.includes('pieVol'));
check('keeps E1/E2 areas', sortKeys.includes('sorter6PackingVol'));

console.log('\n' + (fail ? `${fail} CHECK(S) FAILED` : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
