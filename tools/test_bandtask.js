// The chart band tooltip's Department/Task line - osBandRecordPak_ (finds the
// OS/NPL log row a band's block belongs to) and osBandTimeLabelPak_/
// nplBandTimeLabelPak_ (what the tooltip prints from it).
//
// Asked for: the tooltip no longer restates the band's own type and status -
// the band's colour already carries that - it says the record's own
// Department + Job/Task instead: "Packing Site Transfer : 08:15 - 10:00",
// no brackets. See test_oslog.js [9] and test_nplpivot.js [6]/[7] for the
// label function's own shape; this is the lookup that feeds it.
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

const ctx = { console, document: undefined };
vm.createContext(ctx);
vm.runInContext(strip(R('Web - JsHelpers.html')), ctx);
vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], ctx);
vm.runInContext(strip(R('Web - JsData.html')), ctx);
vm.runInContext(strip(R('Web - JsCharts.html')).split('// ── Hover crosshair')[0], ctx);
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);

const CHARTS = R('Web - JsCharts.html');

head('[1] only when exactly one bonus is filtered');
{
  ctx.selectedBonuses = [];
  check('none selected: no record, whatever the log holds',
        ctx.osBandRecordPak_('os', '18/09/2026 08:00 - 18/09/2026 08:15', 'Approved') === null);
  ctx.selectedBonuses = ['AAA', 'BBB'];
  check('more than one selected: still no record - a block cannot be credited to one of them',
        ctx.osBandRecordPak_('os', '18/09/2026 08:00 - 18/09/2026 08:15', 'Approved') === null);
}

head('[2] matched on bonus + production day + the SAME status the band carries');
{
  ctx.selectedBonuses = ['AAA'];
  ctx.osLogRows = [
    { bonus: 'AAA', date: '18/09/2026', status: 'OK', dept: 'E3 Packing', job: 'Site Transfer' },
    // A second AAA row, same day, different status - must not be picked for
    // an 'Approved' band.
    { bonus: 'AAA', date: '18/09/2026', status: 'Rejected', dept: 'Wrong', job: 'Wrong' },
    // A different bonus, same day and status - must not match either.
    { bonus: 'ZZZ', date: '18/09/2026', status: 'OK', dept: 'Wrong', job: 'Wrong' }
  ];
  ctx.nplLogRows = [
    { bonus: 'AAA', date: '18/09/2026', check: 'OK', dept: 'E3 Packing', task: 'Meeting' }
  ];
  // 09:00 is after the 06:00 fold, so the block's own calendar date IS the
  // production day.
  const rec = ctx.osBandRecordPak_('os', '18/09/2026 09:00 - 18/09/2026 09:15', 'Approved');
  check('OS status folds the same way the band itself does (OK -> Approved)',
        rec && rec.dept === 'E3 Packing' && rec.job === 'Site Transfer', JSON.stringify(rec));
  check('the wrong-status row for the same bonus/day is not picked',
        ctx.osBandRecordPak_('os', '18/09/2026 09:00 - 18/09/2026 09:15', 'Rejected').job === 'Wrong');
  const nplRec = ctx.osBandRecordPak_('npl', '18/09/2026 09:00 - 18/09/2026 09:15', 'OK');
  check('NPL is matched on the Check AS LOGGED, not folded',
        nplRec && nplRec.dept === 'E3 Packing' && nplRec.task === 'Meeting', JSON.stringify(nplRec));
}

head('[3] the log Date column is the PRODUCTION day, same fold as everywhere else');
{
  ctx.selectedBonuses = ['AAA'];
  ctx.osLogRows = [{ bonus: 'AAA', date: '17/09/2026', status: 'OK', dept: 'E3 Packing', job: 'Overnight' }];
  ctx.nplLogRows = [];
  // 02:00 on the 18th is before the 06:00 cut, so it belongs to the 17th.
  const rec = ctx.osBandRecordPak_('os', '18/09/2026 02:00 - 18/09/2026 02:15', 'Approved');
  check('a block before 06:00 is matched against the day BEFORE its own calendar date',
        rec && rec.job === 'Overnight', JSON.stringify(rec));
  check('and the fold line itself is the one everywhere else uses',
        /if \(d\.getHours\(\) < OS_DAY_START_HOUR_PAK_\) d = new Date\(d\.getTime\(\) - 86400000\);/.test(CHARTS));
}

head('[4] no match at all falls back gracefully, never throws');
{
  ctx.selectedBonuses = ['QQQ'];
  ctx.osLogRows = [];
  ctx.nplLogRows = [];
  check('an empty log is null, not a throw',
        ctx.osBandRecordPak_('os', '18/09/2026 09:00 - 18/09/2026 09:15', 'Approved') === null);
  check('no dateTimeStr at all (a chart with no blockDates wired) is also null',
        ctx.osBandRecordPak_('os', undefined, 'Approved') === null);
}

head('[5] the full tooltip line, end to end');
{
  ctx.selectedBonuses = ['AAA'];
  ctx.osLogRows = [{ bonus: 'AAA', date: '18/09/2026', status: 'OK', dept: 'E3 Packing', job: 'Site Transfer' }];
  ctx.nplLogRows = [{ bonus: 'AAA', date: '18/09/2026', check: 'OK', dept: 'E3 Packing', task: 'Site Transfer' }];
  const band = [{ from: 0, to: 3, status: 'Approved', t0: '08:15', t1: '10:00' }];
  const nplBand = [{ from: 0, to: 3, status: 'OK', t0: '08:15', t1: '10:00' }];
  const opts = { bands: band, nplBands: nplBand,
                 blockDates: ['18/09/2026 08:00 - 18/09/2026 08:15'] };
  const chart = { options: { plugins: { osBand: opts } } };
  const out = ctx.osBandTooltipPak_([{ chart: chart, dataIndex: 0 }]);
  check('the example from the request, verbatim',
        out.indexOf('E3 Packing Site Transfer : 08:15 - 10:00') !== -1, JSON.stringify(out));
  check('no brackets, and no restated OS/NPL/status anywhere in the line',
        !/[\[\]]/.test(out.join('')) && !/\bOK\b|\bApproved\b/.test(out.join('')), JSON.stringify(out));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
