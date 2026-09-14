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
const ctx = { console, document: undefined };
vm.createContext(ctx);
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsHelpers.html', 'utf8')), ctx);
// The area lists, which the trend builder reads to find each area's std key.
vm.runInContext(
  strip(fs.readFileSync(APPS + 'Web - JsState.html', 'utf8'))
    .split('function applyConfigToCSSPak')[0], ctx);
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsData.html', 'utf8')), ctx);
// Only the theme helpers and the OS band code - the rest of JsCharts wants a
// live Chart.js and a DOM.
vm.runInContext(
  strip(fs.readFileSync(APPS + 'Web - JsCharts.html', 'utf8')).split('// ── Hover crosshair')[0], ctx);

// Set AFTER JsState, which declares both and would otherwise reset them.
ctx.currentThreshold = 0.05;
ctx.selectedBonuses = [];

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
check('a single run',
      bands([false, true, true, false, true]) ===
      '[{"from":1,"to":2,"status":""},{"from":4,"to":4,"status":""}]',
      bands([false, true, true, false, true]));
check('a run to the end', bands([false, true, true]) === '[{"from":1,"to":2,"status":""}]');
check('the whole series', bands([true, true, true]) === '[{"from":0,"to":2,"status":""}]',
      'a full OS shift is ONE band, not one per window');
check('nothing at all', bands([false, false]) === '[]');
check('an empty series', bands([]) === '[]');

head('[5b] the band cuts on its own points, not half a step outside them');
// Revised twice: it covered the full first and last window, which put grey
// beyond the points the hover line sits on and read as the band overrunning
// where the OS started and stopped. Pinned here because "which pixel" is
// invisible to every other check, and a plausible-looking edit either way
// silently changes what the shading claims.
{
  // The fill colour is theme-aware, so the plugin reads the document even
  // though only geometry is under test here.
  const savedDoc = ctx.document;
  ctx.document = { documentElement: { classList: { contains: () => false } } };

  const N = 20, left = 50, right = 450, step = (right - left) / N;
  const painted = [];
  const stub = {
    ctx: {
      save() {}, restore() {},
      fillRect(x, y, w) { painted.push([+x.toFixed(1), +(x + w).toFixed(1)]); },
      fillText() {},
      set fillStyle(v) {}, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {}
    },
    canvas: {},
    data: { labels: new Array(N).fill('x') },
    chartArea: { top: 10, bottom: 210, left: left, right: right },
    // A category axis puts the tick at the CENTRE of its slot.
    scales: { x: { left: left, right: right, getPixelForValue: i => left + step * (i + 0.5) } }
  };
  const tick = i => left + step * (i + 0.5);
  const span = bands => {
    painted.length = 0;
    ctx.osBandPlugin_.beforeDatasetsDraw(stub, null, { bands: bands });
    return painted[0];
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  check('a mid-series band runs point to point', same(span([{ from: 2, to: 5 }]), [tick(2), tick(5)]),
        JSON.stringify(span([{ from: 2, to: 5 }])) + ' want ' + JSON.stringify([tick(2), tick(5)]));
  check('and so does one starting at the first window',
        same(span([{ from: 0, to: 3 }]), [tick(0), tick(3)]),
        JSON.stringify(span([{ from: 0, to: 3 }])));
  // Point to point makes a one-window band zero-width, so it gets a minimum.
  const one = span([{ from: 7, to: 7 }]);
  check('a single window is still visible', one[1] - one[0] > 0, one[1] - one[0] + 'px wide');
  check('and is centred on its own point', Math.abs((one[0] + one[1]) / 2 - tick(7)) < 0.01);
  // Chart.js will happily be asked to paint outside the plot; it must not.
  const edge = span([{ from: 0, to: 0 }]);
  check('nothing is painted left of the axis', edge[0] >= left, 'x0 ' + edge[0] + ' vs left ' + left);
  check('nor right of it', span([{ from: N - 1, to: N - 1 }])[1] <= right);
  check('no bands, nothing painted', span([]) === undefined);

  ctx.document = savedDoc;
}

head('[6] nothing draws unless a bonus is filtered');
// Unfiltered, someone is nearly always on OS somewhere, so the bands would be
// permanent wallpaper. getChartCommon_ is what enforces this, so read the rule
// out of the source rather than restating it here.
const chartsSrc = fs.readFileSync(APPS + 'Web - JsCharts.html', 'utf8').replace(/\/\/[^\n]*/g, '');
check('osBands is gated on selectedBonuses',
      /osBands\s*=\s*\(\s*selectedBonuses\.length\s*>\s*0\s*\)\s*\?\s*mergeOsBands_/.test(chartsSrc));
// Volume, productivity, area group and deployment trend - the four families
// that plot the same time axis. Not a global register, which would band the
// doughnuts and the bonus-page charts too.
check('the plugin is attached per-chart, never registered globally',
      chartsSrc.indexOf('Chart.register(osBandPlugin_') === -1 &&
      (chartsSrc.match(/plugins:\s*\[osBandPlugin_\]/g) || []).length === 4,
      (chartsSrc.match(/plugins:\s*\[osBandPlugin_\]/g) || []).length + ' attachments');

head('[6b] the trend chart carries the flag too');
// Its rows come from a different builder and a different aggregator than the
// other three, so the flag has to be plumbed through both or the band draws
// on three charts and silently not the fourth.
{
  const trendRows = ctx.generateTrendRowsForAreas_(
    BASE.concat(OS_ROWS), TR, ['pieVol']);
  check('generateTrendRowsForAreas_ sets os', trendRows.map(r => r.os).join(',') === 'true,true,true,true',
        trendRows.map(r => r.os).join(','));
  check('and leaves it clear without OS rows',
        ctx.generateTrendRowsForAreas_(BASE, TR, ['pieVol']).every(r => r.os === false));
  check('aggregateTrendRows ORs it up',
        ctx.aggregateTrendRows(trendRows, 60).every(r => r.os === true));
  // The bands are indices into the shared label array, so a trend chart can
  // only line up with them if it aggregates to the same number of buckets.
  check('same bucket count as the other charts',
        ctx.aggregateTrendRows(trendRows, 30).length ===
        ctx.getAggregatedDataPak(rows(BASE.concat(OS_ROWS), true), 30).length,
        'otherwise the band would sit over the wrong windows');
}

head('[6c] the bonus search is not narrowed by building');
// It used to be, so that someone who never worked in E3 was hidden on an E3
// dashboard. A bonus filter forces whole-site scope, so picking them widens
// the view rather than emptying it - and the narrowing was hiding anyone whose
// whole day was OS, since they have no area anywhere.
{
  const state = fs.readFileSync(APPS + 'Web - JsState.html', 'utf8');
  const init = fs.readFileSync(APPS + 'Web - JsInit.html', 'utf8');
  const ui = fs.readFileSync(APPS + 'Web - JsUi.html', 'utf8');
  check('the scoping function is gone entirely',
        (state + init + ui).indexOf('refreshBonusListForScope_') === -1,
        'a surviving caller would re-narrow the list');
  check('the list comes straight from the payload',
        /allBonusList\s*=\s*data\.bonusList\s*\|\|\s*\[\]/.test(init));
}

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

head('[9] the flag reaches the tables, not just the charts');
// The band explains a zero on a chart. On the Bonus page and in the head
// breakdown the same zero is a number in a column with nothing to explain it,
// which is where "did nothing" gets read into "was on indirect duty".
check('a map of who was on OS', JSON.stringify(
        ctx.bonusOsMapPak_([osRow(TR[0], 'HJW'), work(TR[0], 'AAA', 0.2, 10)])) ===
      '{"HJW":true}');
check('one flagged block in the window is enough',
      ctx.bonusOsMapPak_([work(TR[0], 'AAA', 0.2, 10), osRow(TR[1], 'AAA')]).AAA === true,
      'somebody who cleared RSPS for one block was still on OS');
check('the tag renders for them', ctx.osTagHtmlPak_(true).indexOf('os-tag') !== -1);
check('and nothing at all for everybody else', ctx.osTagHtmlPak_(false) === '',
      'so callers can concatenate it unconditionally');
check('undefined is not on OS', ctx.osTagHtmlPak_(undefined) === '',
      'a bonus absent from the map reads as undefined, not false');

const tsrc = fs.readFileSync(APPS + 'Web - JsTables.html', 'utf8');
const usrc = fs.readFileSync(APPS + 'Web - JsUi.html', 'utf8');
check('the Bonus page builds the map per render',
      /currentBonusOsMap = bonusOsMapPak_\(windowData\)/.test(tsrc));
check('the Data Table detail rows build their own for their own window',
      /currentDetailOsMap = bonusOsMapPak_\(slice\)/.test(tsrc));
check('and the head breakdown builds one too',
      /var bonusOs = bonusOsMapPak_\(rangeData\)/.test(usrc));
check('the breakdown chip emits it',
      usrc.indexOf('osTagHtmlPak_(bonusOs[bonusName])') !== -1);

head('[11] the approval status travels with the flag');
// OS/ Indirect used to be YES or NO, and the notebook dropped every log row
// that was not "OK" - so a rejected or not-yet-approved spell left a zero with
// nothing to explain it, indistinguishable from somebody who did nothing. The
// column now carries the status itself, and this is what must not regress: a
// status nobody enumerated has to still read as "on OS".
{
  const csrc = fs.readFileSync(APPS + 'Web - Code.js', 'utf8');
  const osOf = raw => {
    const c = { console };
    vm.createContext(c);
    vm.runInContext(csrc.slice(csrc.indexOf('function procOsStatus_')).split('\nfunction buildSideEntry_')[0], c);
    return c.procOsStatus_(raw);
  };
  check('NO is not on OS', osOf('NO') === '' && osOf('no') === '', JSON.stringify(osOf('no')));
  check('an empty cell is not on OS', osOf('') === '' && osOf(null) === '' && osOf(undefined) === '');
  check('YES still is', osOf('YES') === 'YES');
  check('Approved is', osOf('Approved') === 'Approved');
  check('Awaiting Approval is', osOf('Awaiting Approval') === 'Awaiting Approval');
  check('Rejected is', osOf('Rejected') === 'Rejected',
        'this is the one the old YES-only test silently dropped');
  check('and so is a status this code has never heard of',
        osOf('Escalated to Ops') === 'Escalated to Ops',
        'matching a known list would lose the band for every status added later');
  check('surrounding space does not change the answer', osOf('  Approved  ') === 'Approved');

  check('the flag is derived from the status, not a second read of the cell',
        /os: osStatus !== ''/.test(csrc));
  check('YES is not repeated into the payload',
        /osStatus\.toUpperCase\(\) !== 'YES'/.test(csrc),
        'it says nothing os:true has not already said, on every row of a full day');
  check('the yesterday cache is bumped for the new field',
        csrc.indexOf("'ydayArch_v5_'") !== -1 && csrc.indexOf("'ydayArch_v4_'") === -1,
        'cached v4 rows carry the flag and no status, so the band would draw ' +
        'unlabelled on yesterday and labelled on today');
}

head('[12] one bucket, one verdict - or none');
// A 60-minute bucket can hold two 15-minute spells that were decided
// differently. Labelling it with either one is a claim the reader cannot see
// is only half true.
check('agreement carries through', ctx.osStatusOfPak_(['Approved', 'Approved']) === 'Approved');
check('disagreement carries nothing', ctx.osStatusOfPak_(['Approved', 'Rejected']) === '',
      'a plain OS band is honest; a wrong label is not');
check('an undecided block is not a vote against',
      ctx.osStatusOfPak_(['', 'Approved', '']) === 'Approved',
      'it says the spell happened without saying what was decided');
check('nothing at all', ctx.osStatusOfPak_([]) === '' && ctx.osStatusOfPak_(['', '']) === '');

// End to end, through the real row builders rather than the helper alone.
{
  const st = (tr, bonus, status) => Object.assign(osRow(tr, bonus), { osStatus: status });
  const r15 = ctx.generateMainRows_(
    [st(TR[0], 'HJW', 'Approved'), st(TR[1], 'HJW', 'Rejected')], TR, { applyThreshold: true });
  check('a 15-minute row keeps its own status',
        r15[0].osStatus === 'Approved' && r15[1].osStatus === 'Rejected',
        r15[0].osStatus + ' / ' + r15[1].osStatus);
  const r60 = ctx.getAggregatedDataPak(r15, 60);
  check('and an hour holding both claims neither', r60[0].osStatus === '',
        JSON.stringify(r60[0].osStatus));
  const same60 = ctx.getAggregatedDataPak(ctx.generateMainRows_(
    [st(TR[0], 'HJW', 'Approved'), st(TR[1], 'HJW', 'Approved')], TR,
    { applyThreshold: true }), 60);
  check('an hour that agrees keeps the label', same60[0].osStatus === 'Approved',
        JSON.stringify(same60[0].osStatus));
  check('the flag itself is unaffected either way', r60[0].os === true && same60[0].os === true);
}

head('[13] a change of status cuts the band');
// Merged straight through it, one label speaks for two verdicts and is wrong
// about half its own width.
{
  const b = list => ctx.mergeOsBands_(list.map(s =>
    s === null ? { os: false } : { os: true, osStatus: s }));
  check('two verdicts, two bands',
        JSON.stringify(b(['Approved', 'Approved', 'Rejected'])) ===
        '[{"from":0,"to":1,"status":"Approved"},{"from":2,"to":2,"status":"Rejected"}]',
        JSON.stringify(b(['Approved', 'Approved', 'Rejected'])));
  check('one verdict stays one band',
        b(['Approved', 'Approved', 'Approved']).length === 1,
        'the split must not fire on every window');
  check('a gap still separates them',
        b(['Approved', null, 'Approved']).length === 2);
  check('and the status survives a gap',
        b(['Approved', null, 'Rejected']).map(x => x.status).join() === 'Approved,Rejected');
  check('an unlabelled run is still one band',
        b(['', '', '']).length === 1 && b(['', '', ''])[0].status === '');
  check('labelled then unlabelled is a cut, not a merge',
        b(['Approved', '']).length === 2,
        'or the label would run on over windows it says nothing about');
}

head('[14] the band says the status under the word OS');
{
  const savedDoc = ctx.document;
  ctx.document = { documentElement: { classList: { contains: () => false } } };
  ctx.getComputedStyle = () => ({ fontFamily: 'sans-serif' });

  const painted = [];
  let fill = '';
  const stub = w => ({
    ctx: {
      save() {}, restore() {},
      fillRect() {}, measureText: t => ({ width: t.length * 5 }),
      fillText(t, x, y) { painted.push({ text: t, y: y, fill: fill }); },
      set fillStyle(v) { fill = v; }, set font(v) {}, set textAlign(v) {}, set textBaseline(v) {}
    },
    canvas: {},
    chartArea: { top: 10, bottom: 210, left: 0, right: w },
    scales: { x: { left: 0, right: w, getPixelForValue: i => i * w } }
  });
  const draw = (band, w) => {
    painted.length = 0;
    ctx.osBandPlugin_.afterDatasetsDraw(stub(w), null, { bands: [band] });
    return painted;
  };

  let out = draw({ from: 0, to: 1, status: 'Approved' }, 300);
  check('the word OS is still drawn', out[0] && out[0].text === 'OS', JSON.stringify(out));
  check('with the status beneath it in brackets',
        out[1] && out[1].text === '(Approved)', JSON.stringify(out.map(o => o.text)));
  check('on a second line, not alongside', out[1] && out[1].y > out[0].y,
        out[0].y + ' then ' + out[1].y);
  check('tinted green for approved', out[1] && out[1].fill === ctx.APP_CONFIG.colors.good,
        String(out[1] && out[1].fill));

  out = draw({ from: 0, to: 1, status: 'Awaiting Approval' }, 400);
  check('amber for awaiting', out[1] && out[1].fill === ctx.APP_CONFIG.colors.warn,
        String(out[1] && out[1].fill));
  out = draw({ from: 0, to: 1, status: 'Rejected' }, 300);
  check('red for rejected', out[1] && out[1].fill === ctx.APP_CONFIG.colors.bad,
        String(out[1] && out[1].fill));
  out = draw({ from: 0, to: 1, status: 'Escalated to Ops' }, 400);
  check('and red for anything unrecognised', out[1] && out[1].fill === ctx.APP_CONFIG.colors.bad,
        'an unknown verdict is not an excused one');

  out = draw({ from: 0, to: 1, status: '' }, 300);
  check('no status, no second line', out.length === 1,
        'a spell logged without a verdict renders exactly as it did before');

  // Clipped to "(Appro" it reads as a different status rather than a truncation.
  out = draw({ from: 0, to: 1, status: 'Awaiting Approval' }, 40);
  check('a band too narrow for the whole word drops it',
        out.length === 1 && out[0].text === 'OS', JSON.stringify(out.map(o => o.text)));
  out = draw({ from: 0, to: 1, status: 'Approved' }, 15);
  check('and one too narrow for OS itself draws neither', out.length === 0,
        JSON.stringify(out.map(o => o.text)));

  check('the wash itself is still neutral',
        /function CHART_OS_BAND\(\) \{ return _isLightTheme_\(\) \? "rgba\(0,0,0/.test(
          fs.readFileSync(APPS + 'Web - JsCharts.html', 'utf8')),
        'RAG on the fill would sit a green wash behind the red 0% bar it explains');

  ctx.document = savedDoc;
}

head('[10] the CSS exists for the class the JS emits');
// A tag styled by nothing renders as bare text mid-name, which reads as data
// corruption rather than as a label.
const ossCss = fs.readFileSync(APPS + 'Web - Styles.html', 'utf8');
check('.os-tag is styled', /\.os-tag \{/.test(ossCss));
check('and it is boxed, so it reads as a label beside the name',
      /\.os-tag \{[^}]*border:/.test(ossCss));

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
