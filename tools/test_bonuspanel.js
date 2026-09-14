// The Bonus page's area panels now carry the area's own productivity beside
// its name. That figure has one way of being quietly wrong: averaging the
// per-operator percentages instead of totalling both sides before dividing.
// The average weights somebody who worked two blocks the same as somebody who
// worked the whole window, so it reads high or low by an amount that depends
// on the shape of the shift - never obviously, and never the same way twice.
//
// It would also disagree with the charts, which total first. So the checks
// below pin the arithmetic AND pin it against the chart's own code path,
// rather than against a number typed in here.
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
vm.runInContext(strip(fs.readFileSync(APPS + 'Web - JsTables.html', 'utf8')), ctx);

const TR = ['09/09/2026 06:00 - 09/09/2026 06:15',
            '09/09/2026 06:15 - 09/09/2026 06:30',
            '09/09/2026 06:30 - 09/09/2026 06:45',
            '09/09/2026 06:45 - 09/09/2026 07:00'];

// A row as buildSideEntry_ shapes it, carrying hours for one area.
const row = (tr, bonus, std) => ({ timeRange: tr, bonus: bonus, value: std, pieStd: std, pie: 0 });

// AAA works the whole window at full rate; BBB appears for one block and does
// almost nothing. Chosen so the two arithmetics disagree loudly:
//   mean of percentages : (100 + 20) / 2      = 60%
//   totals then divide  : 1.05 / 1.25 * 100   = 84%
const DATA = [
  row(TR[0], 'AAA', 0.25), row(TR[1], 'AAA', 0.25),
  row(TR[2], 'AAA', 0.25), row(TR[3], 'AAA', 0.25),
  row(TR[0], 'BBB', 0.05)
];

const rows = ctx.computeBonusRows_(DATA, 'pieStd');
const total = ctx.areaTotalPerformance_(rows);
const near = (a, b) => Math.abs(a - b) < 0.001;

head('[1] the area figure totals both sides before dividing');
check('two operators found', rows.length === 2, rows.map(r => r.bonus).join(','));
check('84%, not the 60% an average would give', near(total, 84), total.toFixed(2) + '%');
const mean = rows.reduce((a, r) => a + r.performance, 0) / rows.length;
check('and the average really is different here', !near(mean, total),
      'mean ' + mean.toFixed(1) + '% vs total ' + total.toFixed(1) + '%');

head('[2] the pill still agrees with the chart for a single-area area');
// These two used to be asserted equal in general. They are not any more, and
// deliberately: the panel's ROWS now carry each operator's total across every
// area, while the chart counts only people working purely in the group. They
// still have to agree where the distinction cannot arise - nobody here worked
// anywhere but OSR PiE - because the pill and the chart above it describe the
// same thing, and disagreeing is worse than either being wrong alone.
const group = { id: 'g0', label: 'OSR PiE', keys: ['pieVol'] };
const split = ctx.generatePerfSplitRows_(DATA, TR, [group], true);
let cStd = 0, cDep = 0;
split.forEach(r => { cStd += r.g0_std; cDep += r.g0_dep; });
check('same figure via generatePerfSplitRows_', near((cStd / cDep) * 100, total),
      ((cStd / cDep) * 100).toFixed(2) + '% vs ' + total.toFixed(2) + '%');
check('and the same hours deployed',
      near(cDep, rows.reduce((a, r) => a + r.deployedHour, 0)),
      cDep + ' vs ' + rows.reduce((a, r) => a + r.deployedHour, 0));

// ---------------------------------------------------------------------------
// The defect this page was rebuilt to fix.
//
// SPLIT spends one block half in OSR PiE and half in OSR Top Up: 0.10 std
// hours each, 0.20 in total, against a single quarter-hour of deployment. The
// honest figure is 0.20 / 0.25 = 80%. The old per-area calculation charged a
// full 0.25 h in EACH panel and reported 40% in both - understating them by
// half, twice over, and never visibly.
const rowMulti = (tr, bonus, pieStd, topStd) => ({
  timeRange: tr, bonus: bonus,
  value: pieStd + topStd,
  pieStd: pieStd, pie: pieStd > 0 ? 5 : 0,
  topUpStd: topStd, topUp: topStd > 0 ? 5 : 0
});
const MULTI = [
  rowMulti(TR[0], 'SPLIT', 0.10, 0.10),   // one block, two areas
  rowMulti(TR[0], 'SOLO', 0.10, 0)        // one block, one area
];

head('[3] a person who worked two areas is not charged twice');
const totalsMulti = ctx.computeBonusRows_(MULTI, null);
const split80 = totalsMulti.find(r => r.bonus === 'SPLIT');
check('SPLIT is deployed for one quarter-hour, not two',
      near(split80.deployedHour, 0.25), split80.deployedHour + ' h');
check('and reads 80%, not 40%', near(split80.performance, 80),
      split80.performance.toFixed(1) + '%');

// The old arithmetic, kept here as the thing that must NOT be what a row says.
const oldPie = ctx.computeBonusRows_(MULTI, 'pieStd').find(r => r.bonus === 'SPLIT');
const oldTop = ctx.computeBonusRows_(MULTI, 'topUpStd').find(r => r.bonus === 'SPLIT');
check('the per-area figure really was different', near(oldPie.performance, 40),
      'old OSR PiE ' + oldPie.performance.toFixed(1) + '%');
check('and identical in the other panel too', near(oldTop.performance, 40),
      'old OSR Top Up ' + oldTop.performance.toFixed(1) + '%');
check('so the totals figure is not reachable by the old path',
      !near(oldPie.performance, split80.performance));

head('[4] one figure per person, whichever panel they appear in');
// The point of the change: a panel says who worked in that area, and shows
// their figures. It does not recompute them, so both of SPLIT's panels agree.
const byBonus = {};
totalsMulti.forEach(r => { byBonus[r.bonus] = r; });
const membersOf = stdKey => {
  const m = {};
  MULTI.forEach(r => { if ((Number(r[stdKey]) || 0) > 0) m[r.bonus] = true; });
  return Object.keys(m).map(b => byBonus[b]).filter(Boolean);
};
const pieRows = membersOf('pieStd');
const topRows2 = membersOf('topUpStd');
check('OSR PiE lists both operators', pieRows.length === 2,
      pieRows.map(r => r.bonus).join(','));
check('OSR Top Up lists only SPLIT', topRows2.length === 1 && topRows2[0].bonus === 'SPLIT',
      topRows2.map(r => r.bonus).join(','));
check('SPLIT is the very same row object in both',
      pieRows.find(r => r.bonus === 'SPLIT') === topRows2[0],
      'one figure, not two computations');

head('[5] membership is any standard hours, however brief');
// "even if they only work there for 1 time block" - a single block in an area
// is still having worked in it.
const BRIEF = [
  rowMulti(TR[0], 'AAA', 0.25, 0), rowMulti(TR[1], 'AAA', 0.25, 0),
  rowMulti(TR[2], 'AAA', 0.25, 0), rowMulti(TR[3], 'AAA', 0.25, 0.01)
];
const briefMembers = stdKey => {
  const m = {};
  BRIEF.forEach(r => { if ((Number(r[stdKey]) || 0) > 0) m[r.bonus] = true; });
  return Object.keys(m);
};
check('one block out of four is enough to be listed',
      briefMembers('topUpStd').length === 1, briefMembers('topUpStd').join(','));
check('and the figure shown is still the whole-window total',
      near(ctx.computeBonusRows_(BRIEF, null)[0].standardHour, 1.01),
      ctx.computeBonusRows_(BRIEF, null)[0].standardHour + ' hrs');

head('[6] the multi-area filter partitions, and changes no figure');
const counts = ctx.bonusAreaCountMapPak(MULTI);
check('SPLIT counts as two areas, SOLO as one',
      counts.SPLIT === 2 && counts.SOLO === 1, JSON.stringify(counts));
const f = m => ctx.filterByAreaCountPak_(totalsMulti, counts, m).map(r => r.bonus).sort();
check('all keeps both', JSON.stringify(f('all')) === '["SOLO","SPLIT"]', JSON.stringify(f('all')));
check('single keeps SOLO', JSON.stringify(f('single')) === '["SOLO"]', JSON.stringify(f('single')));
check('multi keeps SPLIT', JSON.stringify(f('multi')) === '["SPLIT"]', JSON.stringify(f('multi')));
check('an unknown mode hides nothing',
      JSON.stringify(f('nonsense')) === '["SOLO","SPLIT"]');
// It is a view filter, so it must not touch the arithmetic.
check('and the surviving row is untouched',
      ctx.filterByAreaCountPak_(totalsMulti, counts, 'multi')[0] === split80);

head('[7] deployedHour is carried, not reconstructed');
// Recovering it from standardHour / performance divides by zero for anyone at
// 0%, which is exactly the operator an OS band exists to explain.
check('every row has it', rows.every(r => typeof r.deployedHour === 'number'));
check('a quarter hour per active block',
      near(rows.find(r => r.bonus === 'AAA').deployedHour, 1) &&
      near(rows.find(r => r.bonus === 'BBB').deployedHour, 0.25));

head('[8] no hours deployed is not 0%');
// 0% would say the area ran and produced nothing. Null lets the panel say
// nothing at all, which is the honest answer.
check('empty area returns null', ctx.areaTotalPerformance_([]) === null);
check('rows with no deployed hours return null',
      ctx.areaTotalPerformance_([{ standardHour: 0, deployedHour: 0 }]) === null);
check('a real zero still reports 0%',
      ctx.areaTotalPerformance_([{ standardHour: 0, deployedHour: 0.5 }]) === 0,
      'deployed but unproductive is a genuine zero');

head('[9] the panel renders it beside the name');
const src = fs.readFileSync(APPS + 'Web - JsTables.html', 'utf8').replace(/\/\/[^\n]*/g, '');
check('the pill is only emitted when there is a figure',
      /areaPerf === null\s*\)\s*\?\s*''/.test(src));
// The heading fills the row by default, which would push the pill to the far
// right next to the head count. The class is what stops that.
check('and the title row is flagged so it sits by the name',
      src.indexOf('has-area-perf') !== -1);
const css = fs.readFileSync(APPS + 'Web - Styles.html', 'utf8');
check('with the CSS to match', /\.mini-table-title\.has-area-perf h2/.test(css));

head('[10] the render path is wired to the totals, not the old per-area call');
const rsrc = fs.readFileSync(APPS + 'Web - JsTables.html', 'utf8').replace(/\/\/[^\n]*/g, '');
// The whole fix lives in renderSideTablesPak choosing its rows. If a future
// edit hands buildBonusPanel_ the per-area rows again, the double-count is
// back and every figure on the page is quietly halved for multi-area staff,
// with no error raised anywhere.
const render = rsrc.split('function renderSideTablesPak')[1].split('function setSideTableSort')[0];
// Not "does the totals call appear" - it does, for the lookup map, so a panel
// handed the per-area rows again would still satisfy that. What matters is
// where the PER-AREA call may appear: inside the pill, and nowhere else.
const perAreaCalls = (render.match(
  /computeBonusRows_\(pureAreaRows_\(windowData, t\.stdKey\), t\.stdKey\)/g) || []);
check('the per-area calculation survives in exactly one place',
      perAreaCalls.length === 1, perAreaCalls.length + ' call sites');
check('and that place is the pill',
      /areaTotalPerformance_\(\s*computeBonusRows_\(pureAreaRows_\(windowData, t\.stdKey\), t\.stdKey\)\s*\)/
        .test(render));
check('and it no longer counts blocks shared with another area',
      !/computeBonusRows_\(\s*windowData\s*,\s*t\.stdKey\s*\)/.test(render),
      'charging one quarter-hour to two areas is what made every mixed area read low');
check('the panel rows are assembled from the totals lookup',
      /var rows = \[\];/.test(render) && /totalsByBonus\[/.test(render));
check('built once, outside the per-area loop',
      render.indexOf('var totalRows = computeBonusRows_(windowData, null);') <
      render.indexOf('for (var v = 0; v < inScope.length'));
check('membership is tested on the area std key',
      /windowData\[w\]\[t\.stdKey\]/.test(render));
check('and it is passed in, not recomputed from the rows',
      /buildBonusPanel_\([^\)]*areaPerf\)/.test(render));
check('the multi-area filter is applied in both view modes',
      (render.match(/filterByAreaCountPak_/g) || []).length === 2,
      (render.match(/filterByAreaCountPak_/g) || []).length + ' call sites');

head('[10b] the area pill counts only blocks that were purely its own');
// The pill's denominator used to be every block in which the area had any
// hours at all - so a block split between OSR PiE and OSR Top Up charged a
// full quarter-hour to BOTH areas while each numerator held only its own half.
// Both areas read low, and the more the areas shared their people the worse it
// got. Now the figure is computed over the blocks that were unambiguously the
// area's own, so the two halves of the fraction describe the same time.
{
  // PURE works nothing but OSR PiE: two blocks at 0.20, so 0.40 std over 0.50 h
  // deployed = 80%. SPLIT's single block is half OSR PiE and half Top Up, and
  // belongs to neither area's own figure.
  const P = [
    rowMulti(TR[0], 'PURE', 0.20, 0),
    rowMulti(TR[1], 'PURE', 0.20, 0),
    rowMulti(TR[2], 'SPLIT', 0.10, 0.10)
  ];
  const pureRows = ctx.pureAreaRows_(P, 'pieStd');
  check('the shared block is left out', pureRows.length === 2,
        pureRows.map(r => r.bonus).join(','));
  check('and the pure ones are kept', pureRows.every(r => r.bonus === 'PURE'));

  const pill = ctx.areaTotalPerformance_(ctx.computeBonusRows_(pureRows, 'pieStd'));
  check('the pill reads 80% - 0.40 std over 0.50 h', near(pill, 80), pill.toFixed(1) + '%');

  // What it used to read, kept here as the thing it must NOT be.
  const old = ctx.areaTotalPerformance_(ctx.computeBonusRows_(P, 'pieStd'));
  check('where it used to read 66.7%', near(old, (0.5 / 0.75) * 100), old.toFixed(1) + '%');
  check('so the dilution really is gone', !near(old, pill),
        'the old figure was paying for a quarter-hour the area never had');

  // Both sides of the fraction, checked directly - a pill can be right by
  // accident if numerator and denominator are both wrong.
  const pr = ctx.computeBonusRows_(pureRows, 'pieStd');
  check('the numerator is the pure hours only',
        near(pr.reduce((a, r) => a + r.standardHour, 0), 0.40),
        pr.reduce((a, r) => a + r.standardHour, 0) + ' hrs');
  check('and the denominator is a quarter-hour per pure block',
        near(pr.reduce((a, r) => a + r.deployedHour, 0), 0.50),
        pr.reduce((a, r) => a + r.deployedHour, 0) + ' h');

  // An area worked only ever alongside something else has no figure rather
  // than a misleading one. That is a real cost of the rule, so it is pinned.
  check('an area with no pure blocks has no pill',
        ctx.areaTotalPerformance_(ctx.computeBonusRows_(
          ctx.pureAreaRows_([rowMulti(TR[0], 'SPLIT', 0.10, 0.10)], 'topUpStd'),
          'topUpStd')) === null,
        'null, so buildBonusPanel_ renders no pill at all');

  // "Pure" spans every area in VOLUME_TYPES, both buildings. A row carries its
  // out-of-building standard hours through scopeRowsToSite_, and an hour spent
  // in E3 dilutes an E1/E2 percentage exactly as much as one spent next door.
  const e3Key = ctx.VOLUME_TYPES.find(
    t => ctx.AREA_SITE[ctx.areaBaseKey_(t.key)] === 'e3' &&
         t.stdKey !== 'pieStd' && t.stdKey !== 'topUpStd');
  check('there is an area in the other building to test with', !!e3Key,
        e3Key ? e3Key.label : 'none found');
  if (e3Key) {
    const cross = rowMulti(TR[0], 'CROSS', 0.10, 0);
    cross[e3Key.stdKey] = 0.10;
    cross.value += 0.10;
    check('work in the other building breaks purity too',
          ctx.pureAreaRows_([cross], 'pieStd').length === 0,
          'a building-scoped test would quietly let this through');
  }

  // The rule is the pill's alone: the rows underneath still list everybody who
  // worked the area, so the head count does not move.
  check('the rows are untouched by it',
        ctx.computeBonusRows_(P, null).length === 2,
        'PURE and SPLIT both still appear');
}

head('[11] the column headers say whose total this is');
// A multi-area operator shows the same pair of numbers in several panels, so a
// column headed "Standard Hours" invites being summed for the area's output.
check('Total Std Hrs', rsrc.indexOf('Total Std Hrs') !== -1);
check('Total Prod %', rsrc.indexOf('Total Prod %') !== -1);
check('and the old headings are gone',
      rsrc.indexOf('>Standard Hours<') === -1 && rsrc.indexOf('>Productivity %<') === -1);

head('[12] the two tables split at 60% and cover everybody exactly once');
// The rule as given: 61% or more is Productive, 60% or below is Unproductive.
//
// Neither held before. The old pair of rules tested the BADGE colour, which
// has three bands where the tables have two - so 60-79% satisfied both rules
// and was listed TWICE on one panel under opposite headings, while anything
// under the live threshold satisfied neither and vanished from the panel
// entirely. The worst performers in the building were the missing ones.
ctx.tmDirectory = {};
ctx.selectedBonuses = [];
ctx.sideSortMetric = 'performance';
ctx.currentBonusAreaCount = {};
ctx.currentBonusOsMap = {};
ctx.currentThreshold = 0.15;

const placeOf = perf => {
  const html = ctx.buildBonusPanel_('T', [
    { bonus: 'ZZZ', standardHour: 1, deployedHour: 1, performance: perf }
  ], 10);
  const halves = html.split('Unproductive');
  return { top: halves[0].indexOf('ZZZ') !== -1, under: halves[1].indexOf('ZZZ') !== -1 };
};

// Every operator lands in exactly one table - the property that was broken.
let both = [], neither = [];
for (let p = 0; p <= 120; p += 0.5) {
  const at = placeOf(p);
  if (at.top && at.under) both.push(p);
  if (!at.top && !at.under) neither.push(p);
}
check('nobody is listed in both tables', both.length === 0,
      both.length ? 'at ' + both.slice(0, 6).join(', ') + '%' : '0 to 120% in 0.5% steps');
check('and nobody is left out of both', neither.length === 0,
      neither.length ? 'at ' + neither.slice(0, 6).join(', ') + '%' : 'every figure is placed');

check('60% is Unproductive', placeOf(60).under && !placeOf(60).top);
check('61% is Productive', placeOf(61).top && !placeOf(61).under);
check('0% is Unproductive', placeOf(0).under);
check('100% is Productive', placeOf(100).top);

// The comparison is on the printed figure, not the raw one. 60.2% renders as
// "60%", and a row badged 60% sitting under "Productive" is the rule visibly
// not being followed.
check('60.2% follows its badge into Unproductive', placeOf(60.2).under,
      'rounds to 60%');
check('60.5% follows its badge into Productive', placeOf(60.5).top,
      'rounds to 61%');

// Retired by the new rule: the exception only existed because the old lower
// bound dropped a 0% operator out of both tables.
check('the OS exception is gone, not just unused',
      rsrc.indexOf('currentBonusOsMap[r.bonus] === true') === -1,
      'a 0% operator is Unproductive by the rule itself now');
check('and the split no longer moves with the live threshold',
      rsrc.indexOf('minUnderPerf') === -1 &&
      /var BONUS_TABLE_SPLIT_PCT = 60;/.test(rsrc));

head('[13] an OS operator still reaches a table, and is tagged there');
ctx.currentBonusOsMap = { OSGUY: true };
const osHtml = ctx.buildBonusPanel_('T', [
  { bonus: 'OSGUY', standardHour: 0, deployedHour: 0, performance: 0 }
], 10);
check('listed', osHtml.indexOf('OSGUY') !== -1);
check('in Unproductive', osHtml.split('Unproductive')[1].indexOf('OSGUY') !== -1);
check('with the tag beside the name', /OSGUY[\s\S]{0,120}os-tag|os-tag[\s\S]{0,120}OSGUY/.test(osHtml));
ctx.currentBonusOsMap = {};
check('the tag is emitted at all three render sites',
      (rsrc.match(/osTagHtmlPak_/g) || []).length === 3,
      'bonus rows + both Data Table detail layouts');

head('[14] productivity is measured over the blocks worked, not the window');
// A short spell at a good rate is a good rate. Dividing by the selected window
// would turn "worked two blocks well" into a poor figure, and the window is a
// viewing choice - changing it must not change anybody's productivity.
const WIN8 = [];
for (let i = 0; i < 8; i++) WIN8.push('09/09/2026 ' + (6 + i) + ':00 - x');
const twoBlocks = [
  { timeRange: WIN8[0], bonus: 'SHORT', value: 0.25, pieStd: 0.25 },
  { timeRange: WIN8[1], bonus: 'SHORT', value: 0.25, pieStd: 0.25 }
];
const short = ctx.computeBonusRows_(twoBlocks, null)[0];
check('two full-rate blocks read 100%', near(short.performance, 100),
      short.performance.toFixed(1) + '%');
check('deployed for the blocks worked, not the window',
      near(short.deployedHour, 0.5), short.deployedHour + ' h of a 2 h window');
// Present but idle: those blocks carry no hours, so they are not deployment.
const idle = twoBlocks.slice();
for (let i = 2; i < 8; i++) idle.push({ timeRange: WIN8[i], bonus: 'SHORT', value: 0, pieStd: 0 });
const withIdle = ctx.computeBonusRows_(idle, null)[0];
check('and a row with no hours on it does not become deployment',
      near(withIdle.deployedHour, short.deployedHour) &&
      near(withIdle.performance, short.performance),
      withIdle.deployedHour + ' h, ' + withIdle.performance.toFixed(1) + '%');

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
