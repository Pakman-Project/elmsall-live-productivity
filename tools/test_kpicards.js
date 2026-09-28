// The three Overall-page KPI cards (Head Deployed, Head > X% Prod.,
// Productivity) used to always score "the last hour" (the last 4 x 15-min
// blocks), whatever the reader was actually looking at. Live is a rolling
// last-24-hours, so that is the right window there - but once Live is left
// (a picked archive day, or a custom range: see isHistoricalViewPak_), the
// reader chose a WHOLE fixed span on purpose, and scoring only its last hour
// silently threw most of it away while the "Last 4 blocks" caption and "Last
// Hour" wording kept insisting that was the whole answer.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');
const strip = s => s.replace(/<\/?script>/g, '');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const INIT = strip(R('Web - JsInit.html')).replace(/\r\n/g, '\n');
const start = INIT.indexOf('function setKpiTrend_');
const end = INIT.indexOf('function renderDashboardPayload_');
const SRC = INIT.slice(start, end);

function fakeEl() {
  return { textContent: '', style: {}, className: '', innerHTML: '', title: '' };
}

function newCtx() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.els = {
    headDeployed: fakeEl(), headAbove20: fakeEl(), avgPerf: fakeEl(),
    headDeployedTrend: fakeEl(), headAbove20Trend: fakeEl(), avgPerfTrend: fakeEl(),
    headDeployedLabel: fakeEl(), avgPerfLabel: fakeEl(), headAbove20Label: fakeEl(),
    headDeployedSub: fakeEl(), avgPerfSub: fakeEl(),
    headDeployedTip: fakeEl(), headAbove20Tip: fakeEl()
  };
  ctx.$ = id => ctx.els[id] || null;
  ctx.isHistoricalViewPak_ = () => false;
  ctx.currentThreshold = 0.1;
  return ctx;
}

// Four 15-min blocks per bonus per hour, laid out oldest-first, matching how
// timeRanges/rawSideData are ordered elsewhere on the dashboard.
function blocksOf(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('blk' + i);
  return out;
}
function rowsOver(blocks, bonus, perBlockValue) {
  return blocks.map(b => ({ bonus: bonus, timeRange: b, value: perBlockValue }));
}

head('[1] Live: the last hour only, exactly as before');
{
  const ctx = newCtx();
  ctx.timeRanges = blocksOf(12);
  // AAA present throughout the day at 0.2/block (comfortably above a 0.1
  // threshold every block); BBB only in the very first block, well outside
  // the last-hour window this test is really checking.
  ctx.rawSideData = rowsOver(ctx.timeRanges, 'AAA', 0.2).concat(rowsOver(['blk0'], 'BBB', 0.2));
  ctx.isHistoricalViewPak_ = () => false;
  ctx.renderKpiCards_();
  check('only the last 4 blocks are scored - BBB (block 0) never counted',
        ctx.els.headDeployed.textContent === 1, ctx.els.headDeployed.textContent);
  check('the label keeps "Last Hour"',
        ctx.els.headDeployedLabel.textContent === 'Head Deployed Last Hour');
  check('the sub-caption keeps "Last 4 blocks"',
        ctx.els.headDeployedSub.textContent === 'Last 4 blocks' &&
        ctx.els.avgPerfSub.textContent === 'Last 4 blocks');
  check('Head > X% Prod. keeps "Last Hour" too',
        ctx.els.headAbove20Label.textContent === 'Head > 40% Prod. Last Hour',
        ctx.els.headAbove20Label.textContent);
  check('a real previous hour still gets a trend arrow, not a hidden badge',
        ctx.els.headDeployedTrend.style.display === 'inline-flex');
  check('the info tooltips still describe the last 4 blocks',
        ctx.els.headDeployedTip.textContent === 'Counts unique Bonus Numbers active in the last 4 x 15min blocks.' &&
        ctx.els.headAbove20Tip.textContent === 'Workers meeting/exceeding the hourly productivity target.');
}

head('[2] historical (an archive day, or a custom range): the WHOLE window, not just its tail');
{
  const ctx = newCtx();
  ctx.timeRanges = blocksOf(12);
  // AAA sits just BELOW threshold (0.1) in every one of the 12 blocks - never
  // qualifies, in any single block, for "above threshold". BBB sits above it
  // in every block. The OLD code compared the 12-block SUM against a target
  // still fixed at threshold*4 (one hour's worth) - AAA's sum (0.6) cleared
  // that easily even though it never once cleared the PER-BLOCK bar the
  // target is supposed to stand for.
  ctx.rawSideData = rowsOver(ctx.timeRanges, 'AAA', 0.05).concat(rowsOver(ctx.timeRanges, 'BBB', 0.2));
  ctx.isHistoricalViewPak_ = () => true;
  ctx.renderKpiCards_();
  check('both bonuses across all 12 blocks are deployed, not just the last 4',
        ctx.els.headDeployed.textContent === 2, ctx.els.headDeployed.textContent);
  check('the per-block target scales with the window - AAA (always below threshold) is excluded',
        ctx.els.headAbove20.textContent === 1, ctx.els.headAbove20.textContent);
  check('the label drops "Last Hour" - it is not what is being shown',
        ctx.els.headDeployedLabel.textContent === 'Head Deployed' &&
        ctx.els.avgPerfLabel.textContent === 'Productivity',
        ctx.els.headDeployedLabel.textContent + ' / ' + ctx.els.avgPerfLabel.textContent);
  check('the sub-caption says so honestly - not "Last 4 blocks" while reading 12',
        ctx.els.headDeployedSub.textContent === 'All blocks' &&
        ctx.els.avgPerfSub.textContent === 'All blocks');
  check('Head > X% Prod. drops "Last Hour" too',
        ctx.els.headAbove20Label.textContent === 'Head > 40% Prod.',
        ctx.els.headAbove20Label.textContent);
  check('there is no previous WHOLE window to compare against, so the trend is hidden, not guessed at',
        ctx.els.headDeployedTrend.style.display === 'none' &&
        ctx.els.headAbove20Trend.style.display === 'none' &&
        ctx.els.avgPerfTrend.style.display === 'none');
  check('the info tooltips say so too - not "the last 4 x 15min blocks" while reading the whole window',
        ctx.els.headDeployedTip.textContent === 'Counts unique Bonus Numbers active anywhere in the selected window.' &&
        ctx.els.headAbove20Tip.textContent === 'Workers meeting/exceeding the productivity target across the whole selected window.',
        ctx.els.headDeployedTip.textContent + ' / ' + ctx.els.headAbove20Tip.textContent);
}

head('[3] the per-block target genuinely scales, both ways');
{
  const ctx = newCtx();
  // A short 2-block span - the target must be threshold*2 here, not a
  // leftover "*4" that would wrongly demand a full hour's worth from a span
  // that is not even one hour long.
  ctx.timeRanges = blocksOf(2);
  ctx.rawSideData = rowsOver(ctx.timeRanges, 'CCC', 0.15); // above 0.1 every block
  ctx.isHistoricalViewPak_ = () => true;
  ctx.renderKpiCards_();
  check('a 2-block window: CCC (above threshold each block) still counts as above',
        ctx.els.headAbove20.textContent === 1, ctx.els.headAbove20.textContent);
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
