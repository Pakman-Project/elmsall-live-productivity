// OS / Indirect rows are the first thing ever admitted to the payload with no
// standard hours. Everything downstream was written on the assumption that a row
// existing means someone was working, so the danger is not that the band fails
// to draw - that is visible - but that admitting these rows quietly moves a
// number nobody is looking at. Head count and hours deployed are the two, and
// they feed productivity, which is the figure the whole dashboard is about.
//
// So the suite leads with the guard that nothing changed, and only then checks
// that the feature does anything at all.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};
const strip = s => s.replace(/<\/?script>/g, '');

// ── the data layer, as the browser runs it ──────────────────────────────────
const ctx = { console, currentThreshold: 0.05, selectedBonuses: [] };
vm.createContext(ctx);
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsHelpers.html', 'utf8')), ctx);
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsData.html', 'utf8')), ctx);
// Only the theme helpers and the OS band code - the rest of JsCharts wants a
// live Chart.js and a DOM.
vm.runInContext(
  strip(fs.readFileSync(APPS + 'Web - JsCharts.html', 'utf8')).split('// ── Hover crosshair')[0], ctx);

const TR = ['09/09/2026 06:00 - 09/09/2026 06:15',
            '09/09/2026 06:15 - 09/09/2026 06:30',
            '09/09/2026 06:30 - 09/09/2026 06:45',
            '09/09/2026 06:45 - 09/09/2026 07:00'];

// A productive row shaped like the real thing: hours in `value`, volume in the
// area keys buildSideEntry_ writes.
const work = (tr, bonus, hrs, vol) => ({
  timeRange: tr, bonus: bonus, value: hrs, os: false,
  pie: vol || 0, topUp: 0, e3Packing: 0, parcelSortation: 0, parcelInduct: 0,
  inboundDecanting: 0, osrDecanting: 0, bcrInducting: 0, e1e2Inducting: 0,
  sorter6Packing: 0, onlinePickingDrive: 0, onlinePickingWay: 0, onlinePickingE3: 0,
  e3Bpp: 0, e1e2Bpp: 0, rspsTopUp: 0, rspsPick: 0, ispsTopUp: 0, ispsPick: 0,
  sorter6ItemInduct: 0, sorter6ParcelInduct: 0, forwardTpa: 0, tpRetail: 0, rtf: 0
});
// What the notebook writes for an indirect block: flagged, and zero everywhere.
const osRow = (tr, bonus) => Object.assign(work(tr, bonus, 0, 0), { os: true });

const BASE = [
  work(TR[0], 'AAA', 0.20, 120), work(TR[0], 'BBB', 0.18, 90),
  work(TR[1], 'AAA', 0.22, 140), work(TR[1], 'BBB', 0.15, 70),
  work(TR[2], 'AAA', 0.19, 110),
  work(TR[3], 'AAA', 0.21, 130), work(TR[3], 'BBB', 0.17, 80)
];
// HJW is on OS the whole time and appears nowhere in the productive data - the
// synthesised case. AAA picks up one OS block mid-shift - the overlap case.
const OS_ROWS = [
  osRow(TR[0], 'HJW'), osRow(TR[1], 'HJW'), osRow(TR[2], 'HJW'), osRow(TR[3], 'HJW'),
  osRow(TR[2], 'AAA')
];

const rows = (data, applyThreshold) =>
  ctx.generateMainRows_(data, TR, { applyThreshold: applyThreshold });
const agg = (data, applyThreshold, wm) =>
  ctx.getAggregatedDataPak(rows(data, applyThreshold), wm || 15);

// Compares everything except the OS flag itself, which is supposed to differ.
const without = list => JSON.stringify(list.map(r => {
  const c = Object.assign({}, r); delete c.os; return c;
}));

head('[1] admitting OS rows moves no existing number');
// The guard this whole suite exists for. If it fails, every productivity figure
// on the dashboard is wrong by however many people were on indirect work.
[true, false].forEach(function (applyThreshold) {
  const label = applyThreshold ? 'charts (threshold applied)' : 'Data Table (threshold OFF)';
  check(label + ' - main rows',
        without(rows(BASE, applyThreshold)) === without(rows(BASE.concat(OS_ROWS), applyThreshold)),
        applyThreshold ? '' : 'this is the path the accident does NOT cover');
  [15, 30, 60].forEach(function (wm) {
    check(label + ' - aggregated at ' + wm + 'min',
          without(agg(BASE, applyThreshold, wm)) === without(agg(BASE.concat(OS_ROWS), applyThreshold, wm)));
  });
});

head('[2] the exclusion is by name, not by arithmetic');
// The threshold filter drops zero-value rows as a side effect, so [1] would pass
// on a default threshold even with the OS handling removed. Take the threshold
// away and only an explicit exclusion is left standing.
const savedThreshold = ctx.currentThreshold;
[0, -1].forEach(function (t) {
  ctx.currentThreshold = t;
  check('threshold ' + t + ' still moves nothing',
        without(rows(BASE, true)) === without(rows(BASE.concat(OS_ROWS), true)),
        'a threshold at or below zero admits anything the accident relied on');
});
ctx.currentThreshold = savedThreshold;

head('[3] an OS row that carries hours is still real work');
// OS is a reason for a zero, not a licence to discard hours. A row flagged OS
// that nonetheless has standard hours against it stays counted.
const paidOs = Object.assign(work(TR[0], 'CCC', 0.30, 50), { os: true });
const withPaid = rows(BASE.concat([paidOs]), true);
const plain = rows(BASE, true);
check('its hours reach the block', withPaid[0].stdHours > plain[0].stdHours,
      plain[0].stdHours.toFixed(2) + ' -> ' + withPaid[0].stdHours.toFixed(2));
check('and so does its head count', withPaid[0].hourDeployed > plain[0].hourDeployed,
      plain[0].hourDeployed + ' -> ' + withPaid[0].hourDeployed);

head('[4] the flag survives the trip to the charts');
const flagged = rows(BASE.concat(OS_ROWS), true);
check('set on blocks that have an OS row', flagged.map(r => r.os).join(',') === 'true,true,true,true');
check('and clear on blocks that do not', rows(BASE, true).every(r => r.os === false));
// A quarter-hour of OS inside an hour shades the hour: at 60 minutes there is
// no finer place to put it, and dropping it would hide short spells entirely.
const oneBlock = rows(BASE.concat([osRow(TR[2], 'AAA')]), true);
check('one 15-min spell shades its 60-min bucket',
      ctx.getAggregatedDataPak(oneBlock, 60).every(r => r.os === true));

head('[5] contiguous windows merge into one band');
const bands = a => JSON.stringify(ctx.mergeOsBands_(a.map(os => ({ os: os }))));
check('a single run', bands([false, true, true, false, true]) === '[{"from":1,"to":2},{"from":4,"to":4}]',
      bands([false, true, true, false, true]));
check('a run to the end', bands([false, true, true]) === '[{"from":1,"to":2}]');
check('the whole series', bands([true, true, true]) === '[{"from":0,"to":2}]',
      'a full OS shift is ONE band, not one per window');
check('nothing at all', bands([false, false]) === '[]');
check('an empty series', bands([]) === '[]');

head('[6] nothing draws unless a bonus is filtered');
// Unfiltered, someone is nearly always on OS somewhere, so the bands would be
// permanent wallpaper. getChartCommon_ is what enforces this, so read the rule
// out of the source rather than restating it here.
const chartsSrc = fs.readFileSync(APPS + 'Web - JsCharts.html', 'utf8').replace(/\/\/[^\n]*/g, '');
check('osBands is gated on selectedBonuses',
      /osBands\s*=\s*\(\s*selectedBonuses\.length\s*>\s*0\s*\)\s*\?\s*mergeOsBands_/.test(chartsSrc));
check('the plugin is attached per-chart, never registered globally',
      chartsSrc.indexOf('Chart.register(osBandPlugin_') === -1 &&
      (chartsSrc.match(/plugins:\s*\[osBandPlugin_\]/g) || []).length === 3,
      'registering it globally would band every canvas in the app');

head('[7] an OS-only operator is findable under a building filter');
// The bonus search offers whatever is in scope, and scopeRowsToSite_ decides
// that by summing the areas - which is zero for an OS block in every building.
// So YT4, on OS all afternoon, existed in the sheet and in the payload but
// could not be searched for unless the view happened to be on Elmsall.
{
  const s = { console, document: undefined };
  vm.createContext(s);
  vm.runInContext(
    strip(fs.readFileSync(APPS + 'Web - JsState.html', 'utf8'))
      .split('function applyConfigToCSSPak')[0], s);

  s.__rows = [
    { bonus: 'AAA', timeRange: 'T1', value: 0.25, pieStd: 0.25, pie: 90 },      // E3
    { bonus: 'CCC', timeRange: 'T1', value: 0.15, e1e2BppStd: 0.15, e1e2Bpp: 30 }, // E1/E2
    Object.assign(osRow('T1', 'YT4'), { value: 0 })                             // OS, no area
  ];
  const scope = site => {
    vm.runInContext('siteFilter = ' + JSON.stringify(site), s);
    return vm.runInContext('scopeRowsToSite_(__rows)', s)
      .map(function (r) { return r.bonus; });
  };
  ['all', 'e3', 'e1e2'].forEach(function (site) {
    check('YT4 survives ' + site, scope(site).indexOf('YT4') !== -1, scope(site).join(','));
  });
  // The rule is the OS flag, not "keep every empty row" - a genuinely empty
  // row is still someone with nothing in this building, and still goes.
  s.__rows = [Object.assign(osRow('T1', 'ZZZ'), { os: false })];
  check('a zero row WITHOUT the flag is still dropped', scope('e3').length === 0,
        'otherwise this stops being a building filter');
  // And the flag must not smuggle hours across: value is recomputed per
  // building, so an OS row reads as zero hours wherever it is shown.
  s.__rows = [Object.assign(osRow('T1', 'YT4'), { value: 9 })];
  vm.runInContext('siteFilter = "e3"', s);
  const kept = vm.runInContext('scopeRowsToSite_(__rows)', s);
  check('its hours still resolve to this building (0)',
        kept.length === 1 && kept[0].value === 0,
        kept.length ? String(kept[0].value) : 'row was dropped');
}

head('[8] an OS-only block cannot roll the timeline forward');
// A shift is logged to 18:00 the moment it starts, so at 09:00 the sheet already
// holds OS rows for blocks the pipeline has published nothing into. The trailing
// trim exists to stop the axis running past real data; run the real block.
const codeSrc = fs.readFileSync(APPS + 'Web - Code.js', 'utf8');
const trimSrc = codeSrc.slice(codeSrc.indexOf('var presentTR = {};'),
                              codeSrc.indexOf('timeRanges = timeRanges.slice(0, newestWithData + 1);') + 60);
const runTrim = data => {
  const c = { timeRanges: TR.slice(), rawSideData: data, console };
  vm.createContext(c);
  vm.runInContext(trimSrc, c);
  return c.timeRanges.length;
};
check('real data sets the edge', runTrim([work(TR[0], 'AAA', 0.2, 10), work(TR[1], 'AAA', 0.2, 10)]) === 2);
check('an OS-only future block does not extend it',
      runTrim([work(TR[0], 'AAA', 0.2, 10), work(TR[1], 'AAA', 0.2, 10), osRow(TR[3], 'HJW')]) === 2,
      'the axis must stop at the newest block with hours in it');
check('and OS alone leaves nothing to trim to', runTrim([osRow(TR[2], 'HJW')]) === TR.length);

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
