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

head('[2] it agrees with what the charts compute');
// The chart path for the same area, summed over the same window. If these two
// ever part company, the panel and the chart above it state different figures
// for the same thing, which is worse than either being wrong alone.
const group = { id: 'g0', label: 'OSR PiE', keys: ['pieVol'] };
const split = ctx.generatePerfSplitRows_(DATA, TR, [group]);
let cStd = 0, cDep = 0;
split.forEach(r => { cStd += r.g0_std; cDep += r.g0_dep; });
check('same figure via generatePerfSplitRows_', near((cStd / cDep) * 100, total),
      ((cStd / cDep) * 100).toFixed(2) + '% vs ' + total.toFixed(2) + '%');
check('and the same hours deployed',
      near(cDep, rows.reduce((a, r) => a + r.deployedHour, 0)),
      cDep + ' vs ' + rows.reduce((a, r) => a + r.deployedHour, 0));

head('[3] deployedHour is carried, not reconstructed');
// Recovering it from standardHour / performance divides by zero for anyone at
// 0%, which is exactly the operator an OS band exists to explain.
check('every row has it', rows.every(r => typeof r.deployedHour === 'number'));
check('a quarter hour per active block',
      near(rows.find(r => r.bonus === 'AAA').deployedHour, 1) &&
      near(rows.find(r => r.bonus === 'BBB').deployedHour, 0.25));

head('[4] no hours deployed is not 0%');
// 0% would say the area ran and produced nothing. Null lets the panel say
// nothing at all, which is the honest answer.
check('empty area returns null', ctx.areaTotalPerformance_([]) === null);
check('rows with no deployed hours return null',
      ctx.areaTotalPerformance_([{ standardHour: 0, deployedHour: 0 }]) === null);
check('a real zero still reports 0%',
      ctx.areaTotalPerformance_([{ standardHour: 0, deployedHour: 0.5 }]) === 0,
      'deployed but unproductive is a genuine zero');

head('[5] the panel renders it beside the name');
const src = fs.readFileSync(APPS + 'Web - JsTables.html', 'utf8').replace(/\/\/[^\n]*/g, '');
check('the pill is only emitted when there is a figure',
      /areaPerf === null\s*\)\s*\?\s*''/.test(src));
// The heading fills the row by default, which would push the pill to the far
// right next to the head count. The class is what stops that.
check('and the title row is flagged so it sits by the name',
      src.indexOf('has-area-perf') !== -1);
const css = fs.readFileSync(APPS + 'Web - Styles.html', 'utf8');
check('with the CSS to match', /\.mini-table-title\.has-area-perf h2/.test(css));

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
