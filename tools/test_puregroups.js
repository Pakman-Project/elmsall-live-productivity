// The Overall page's "Productivity % by Work Area" groups, and what happens to
// them when a bonus number is filtered.
//
// Two things are pinned here.
//
// 1. A group counts only people whose work in a block fell ENTIRELY inside its
//    areas. It used to admit anybody with hours in any of them, and then
//    charge a full quarter-hour of deployment while counting only the group's
//    share of the standard hours - so somebody splitting a block between RSPS
//    Pick and ISPS Pick dragged an RSPS Pick group down using deployment they
//    had spent in ISPS. The percentage was being billed for time that was
//    never its own.
//
// 2. That rule must be OFF under a bonus filter. In that mode the chart
//    replaces the configured groups with one per area the operator worked, so
//    a multi-area operator would fail the subset test in every single group
//    and the chart would come back blank for exactly the person being looked
//    at. The filtered view draws standard hours instead, which needs no
//    inclusion rule at all.
//
// The second is the one that would ship silently: an empty chart reads as "no
// data for this person", not as a bug.
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

const ctx = { console, document: undefined };
vm.createContext(ctx);
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsHelpers.html', 'utf8')), ctx);
vm.runInContext(
  strip(fs.readFileSync(APPS + 'Web - JsState.html', 'utf8'))
    .split('function applyConfigToCSSPak')[0], ctx);
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsData.html', 'utf8')), ctx);

const TR = ['09/09/2026 06:00 - 09/09/2026 06:15'];
const near = (a, b) => Math.abs(a - b) < 0.0001;

// A row as buildSideEntry_ shapes it: every area zeroed, then the ones worked
// filled in. `value` is the row total, which is what scopeRowsToSite_ leaves.
function row(bonus, areas) {
  const r = { timeRange: TR[0], bonus: bonus, value: 0 };
  ctx.VOLUME_TYPES.forEach(t => { r[t.stdKey] = 0; r[ctx.areaBaseKey_(t.key)] = 0; });
  Object.keys(areas).forEach(k => {
    r[k] = areas[k];
    r.value += areas[k];
  });
  return r;
}

// The user's own example: a group of RSPS Pick + RSPS Top Up.
const GROUP = { id: 'g0', label: 'RSPS', keys: ['rspsPickVol', 'rspsTopUpVol'] };

const DATA = [
  row('PICKONLY', { rspsPickStd: 0.20 }),                                     // in
  row('TOPONLY', { rspsTopUpStd: 0.20 }),                                     // in
  row('BOTH', { rspsPickStd: 0.10, rspsTopUpStd: 0.10 }),                     // in
  row('STRADDLE', { rspsPickStd: 0.10, ispsPickStd: 0.10 }),                  // out
  row('THREE', { rspsPickStd: 0.05, rspsTopUpStd: 0.05, ispsPickStd: 0.05 }), // out
  row('ELSEWHERE', { ispsPickStd: 0.20 })                                     // out
];

head('[1] a group counts only people working solely within its areas');
const pure = ctx.generatePerfSplitRows_(DATA, TR, [GROUP], true)[0];
// PICKONLY 0.20 + TOPONLY 0.20 + BOTH 0.20 = 0.60 std over 3 x 0.25 = 0.75 h
check('three operators deployed, not five', near(pure.g0_dep, 0.75), pure.g0_dep + ' h');
check('and all of their hours count', near(pure.g0_std, 0.60), pure.g0_std + ' hrs');
check('so the figure is 80%', near((pure.g0_std / pure.g0_dep) * 100, 80),
      ((pure.g0_std / pure.g0_dep) * 100).toFixed(1) + '%');

head('[2] the people it leaves out, one at a time');
// Adding another excluded person must change nothing. If the guard above were
// passing for some other reason, these would move.
const plus = (name, areas) =>
  ctx.generatePerfSplitRows_(DATA.concat([row(name, areas)]), TR, [GROUP], true)[0];
check('another two-area straddler changes nothing',
      near(plus('S2', { rspsPickStd: 0.10, ispsPickStd: 0.10 }).g0_dep, pure.g0_dep));
check('another three-area operator changes nothing',
      near(plus('T2', { rspsPickStd: 0.05, rspsTopUpStd: 0.05, ispsPickStd: 0.05 }).g0_dep,
           pure.g0_dep));
check('somebody working only outside the group changes nothing',
      near(plus('E2', { ispsPickStd: 0.20 }).g0_dep, pure.g0_dep));
// And the converse: a legitimate addition MUST move it, or the rule is simply
// excluding everybody.
check('but another pure operator does count',
      near(plus('P2', { rspsTopUpStd: 0.20 }).g0_dep, 1.0),
      plus('P2', { rspsTopUpStd: 0.20 }).g0_dep + ' h');

head('[3] the old rule really did admit them, and read lower for it');
const loose = ctx.generatePerfSplitRows_(DATA, TR, [GROUP], false)[0];
check('five operators under the old rule', near(loose.g0_dep, 1.25), loose.g0_dep + ' h');
check('charging deployment spent elsewhere',
      (loose.g0_std / loose.g0_dep) < (pure.g0_std / pure.g0_dep),
      (loose.g0_std / loose.g0_dep * 100).toFixed(1) + '% vs ' +
      (pure.g0_std / pure.g0_dep * 100).toFixed(1) + '%');

head('[4] "outside" means all 24 areas, both buildings');
// scopeRowsToSite_ copies every area field across and only rewrites `value`,
// so a row still carries its out-of-building standard hours - and time in the
// other building dilutes a percentage exactly as much as time in the next
// aisle. A building-scoped test would quietly let it through.
// RSPS Pick and RSPS Top Up are both E1/E2 areas, so the cross-building case
// is an E3 area - and it has to be one the group does not already contain,
// or the row stays pure and the test passes for the wrong reason.
const otherBuilding = ctx.VOLUME_TYPES.find(
  t => ctx.AREA_SITE[ctx.areaBaseKey_(t.key)] === 'e3' && GROUP.keys.indexOf(t.key) === -1);
check('the group is entirely in one building',
      GROUP.keys.every(k => ctx.AREA_SITE[ctx.areaBaseKey_(k)] === 'e1e2'));
check('and there is an area in the other one to test with', !!otherBuilding,
      otherBuilding ? otherBuilding.label : 'none found');
if (otherBuilding) {
  const mixed = row('CROSSBUILDING', { rspsPickStd: 0.10 });
  mixed[otherBuilding.stdKey] = 0.10;
  mixed.value += 0.10;
  const withCross = ctx.generatePerfSplitRows_(DATA.concat([mixed]), TR, [GROUP], true)[0];
  check('work in the other building excludes them too',
        near(withCross.g0_dep, pure.g0_dep),
        withCross.g0_dep + ' h vs ' + pure.g0_dep + ' h');
}

head('[5] under a bonus filter the rule is off, or the chart goes blank');
// One filtered operator, one group per area they worked - which is exactly
// what JsCharts synthesises in that mode.
const FILTERED = [row('WHO', { rspsPickStd: 0.10, ispsPickStd: 0.10 })];
const perArea = [
  { id: 'g0', label: 'RSPS Pick', keys: ['rspsPickVol'] },
  { id: 'g1', label: 'ISPS Pick', keys: ['ispsPickVol'] }
];
const blank = ctx.generatePerfSplitRows_(FILTERED, TR, perArea, true)[0];
check('with the rule on, a multi-area operator vanishes from EVERY group',
      near(blank.g0_dep, 0) && near(blank.g1_dep, 0),
      'g0 ' + blank.g0_dep + ' h, g1 ' + blank.g1_dep + ' h');
const drawn = ctx.generatePerfSplitRows_(FILTERED, TR, perArea, false)[0];
check('with it off, both areas report their hours',
      near(drawn.g0_std, 0.10) && near(drawn.g1_std, 0.10),
      'g0 ' + drawn.g0_std + ' hrs, g1 ' + drawn.g1_std + ' hrs');

head('[6] the aggregator keeps the standard hours, not just the ratio');
const agg = ctx.getAggregatedPerfSplitDataPak(
  ctx.generatePerfSplitRows_(FILTERED, TR, perArea, false), 15, perArea)[0];
check('g0_std survives aggregation', near(agg.g0_std, 0.10), agg.g0_std + ' hrs');
check('the ratio is still there too', typeof agg.g0 === 'number', String(agg.g0));
check('and so is the deployment, for telling two kinds of zero apart',
      typeof agg.g0_dep === 'number', String(agg.g0_dep));

head('[7] the chart switches unit under a filter');
const csrc = fs.readFileSync(APPS + 'Web - JsCharts.html', 'utf8').replace(/\/\/[^\n]*/g, '');
check('std mode is exactly "a bonus is filtered"',
      /var agStdMode = selectedBonuses\.length > 0;/.test(csrc));
check('the subset rule is passed as its negation',
      /generatePerfSplitRows_\(\s*rawFilteredData, rawTimeList, perfGroups, !agStdMode\)/.test(csrc));
check('the datasets read _std in that mode',
      /agStdMode \? \(group\.id \+ '_std'\) : group\.id/.test(csrc));
check('the axis is relabelled',
      /agStdMode \? 'Standard Hours' : 'Productivity %'/.test(csrc));
check('the tooltip changes unit', csrc.indexOf("' hrs'") !== -1);
check('the heading is renamed',
      /if \(stdMode\) return 'Standard Hours by Work Area';/.test(csrc));
check('and the percentage axis cropping is bypassed for hours',
      /agStdMode[\s\S]{0,20}\{ min: 0, max: undefined \}/.test(csrc));

head('[8] the percentage view says who it covers');
// Anyone working across a group boundary is now in no group at all. Left
// unsaid, that reads as productivity having fallen on the day this shipped.
check('a note is rendered', csrc.indexOf('chart-note') !== -1);
check('only on the percentage view', /agStdMode \? '' :/.test(csrc));
const css = fs.readFileSync(APPS + 'Web - Styles.html', 'utf8');
check('with CSS to match', /\.chart-note \{/.test(css));

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
