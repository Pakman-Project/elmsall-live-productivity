// The OS page — a breakdown of who is on Operational Support, read from the OS
// log rather than from the pivot.
//
// The dangerous part is not the rendering, which is visible the moment it is
// wrong. It is the two joins that are invisible when they break:
//
//   1. The log's COLUMN POSITIONS. "Spreadsheet - OS Log.js" picks its source
//      columns by index into a list, so dropping one shifts every output column
//      after it - which has happened once already, when the log went from 25
//      columns to 20. A wrong index here reads a POPULATED cell, so the failure
//      is a page of plausible nonsense: departments in the Zone column, times
//      where the authoriser should be. Nothing raises.
//
//   2. The PRODUCTION DAY. A day runs 06:00 to 06:00, so the log's Date column
//      is not the calendar date the work happened on. Read as one, a whole
//      night shift lands a day out, matches no window, and simply is not there.
//
// So those two lead, and the grouping and counting follow.
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
const R = f => fs.readFileSync(APPS + f, 'utf8');

const ctx = { console, document: undefined };
vm.createContext(ctx);
vm.runInContext(strip(R('Web - JsHelpers.html')), ctx);
vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], ctx);
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);
// Declared past the split above, and the manager card reads it.
ctx.selectedBonuses = [];
ctx.tmDirectory = {};

const CODE = R('Web - Code.js');
const SCRIPT = R('Spreadsheet - OS Log.js');
const PAGE = R('Web - JsPageOs.html');

// A logged record as readOsLogRows_ hands it over.
const rec = (o) => Object.assign({
  date: '09/09/2026', bonus: 'AAA', dept: 'Inbound', job: 'Cleaning',
  from: '07:26', to: '08:06', auth: 'J Ashworth', deployedBy: 'P Okonkwo',
  reportsTo: 'S Nowak', status: 'OK', site: 'E1/E2', zone: 'Goods In'
}, o || {});

head('[1] the log columns, which are the fragile part');
// Pinned from BOTH sides: the indices Code.js reads, and the layout the Apps
// Script writes. Either alone can drift without the other noticing.
{
  const m = /var OS_LOG_COLS_ = \{([\s\S]*?)\};/.exec(CODE);
  check('Code.js declares the column map', !!m);
  const cols = {};
  if (m) {
    m[1].replace(/(\w+):\s*(\d+)/g, (_, k, v) => { cols[k] = Number(v); return ''; });
  }
  // A Date, B Bonus, E Department, F Job Type, H Start, I Finish,
  // K TM Authorising, N Deployed by, O Reports to, Q Record Status,
  // R Site, S Zone.
  const want = {
    date: 0, bonus: 1, dept: 4, job: 5, start: 7, finish: 8,
    auth: 10, deployedBy: 13, reportsTo: 14, status: 16, site: 17, zone: 18
  };
  Object.keys(want).forEach(k => {
    check(k + ' is column ' + String.fromCharCode(65 + want[k]),
          cols[k] === want[k], 'declared ' + cols[k]);
  });
  check('the read is 20 columns wide, A:T',
        /var OS_LOG_WIDTH_ = 20;/.test(CODE) && /combinedResults\.length, 20\)/.test(SCRIPT),
        'if the script widens again, every index above moves');
  check('and it starts at row 7',
        /var OS_LOG_FIRST_ROW_ = 7;/.test(CODE) && /getRange\(7, 1, combinedResults\.length/.test(SCRIPT),
        'rows 1-6 are the source URLs and headings');
  // Status is the one column the notebook ALSO reads, so the two must agree.
  const nb = JSON.parse(fs.readFileSync(
    path.resolve(APPS, '..', 'Databricks-Live-Productivity-Output',
                 'Elmsall Live Productivity.ipynb'), 'utf8'))
    .cells.map(c => c.source.join('')).join('\n');
  check('Record Status is column Q for the notebook too',
        nb.indexOf('_os_status(_os_cell(_r, 16))') !== -1 && cols.status === 16,
        'two readers of one column disagreeing is the worst of the shapes');
  check('and so are Start and Finish',
        nb.indexOf('_os_cell(_r, 7), _os_cell(_r, 8)') !== -1 &&
        cols.start === 7 && cols.finish === 8);
}

head('[2] the production day starts at 06:00');
// The case that vanishes silently. A row dated the 8th with a 02:00 start
// happened on the 9th, and read as the 8th it lands on a window that is not on
// the axis at all.
{
  const w = r => ctx.osSpellWindowPak_(rec(r));
  const iso = d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
                   '-' + ('0' + d.getDate()).slice(-2) + ' ' +
                   ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);

  let s = w({ date: '08/09/2026', from: '00:00', to: '04:00' });
  check('00:00-04:00 logged on the 8th happened on the 9th',
        s && iso(s.start) === '2026-09-09 00:00' && iso(s.finish) === '2026-09-09 04:00',
        s ? iso(s.start) + ' -> ' + iso(s.finish) : 'null');
  s = w({ date: '09/09/2026', from: '05:45', to: '07:00' });
  check('05:45 is still the previous production day',
        s && iso(s.start) === '2026-09-10 05:45', s ? iso(s.start) : 'null');
  s = w({ date: '09/09/2026', from: '06:00', to: '18:00' });
  check('06:00 exactly does NOT shift',
        s && iso(s.start) === '2026-09-09 06:00', s ? iso(s.start) : 'null');
  s = w({ date: '09/09/2026', from: '22:00', to: '02:00' });
  check('and a spell over midnight finishes the next day',
        s && iso(s.start) === '2026-09-09 22:00' && iso(s.finish) === '2026-09-10 02:00',
        s ? iso(s.start) + ' -> ' + iso(s.finish) : 'null');
  check('the same rule, the same constants, as the notebook',
        /OS_DAY_START_HOUR_PAK_ = 6/.test(PAGE) && /OS_MAX_SHIFT_HOURS_PAK_ = 16/.test(PAGE) &&
        /OS_DAY_START_HOUR = 6/.test(nbSrc()) && /OS_MAX_SHIFT_HOURS = 16/.test(nbSrc()),
        'two readings of one shift would put the same person in two places');

  // A finish typed 06:00 instead of 18:00 is indistinguishable from a real
  // overnight spell, and the midnight rule above turns it into a full day.
  check('an over-long spell is dropped, not drawn across the day',
        w({ date: '09/09/2026', from: '06:00', to: '05:59' }) === null);
  check('16 hours exactly is still allowed',
        w({ date: '09/09/2026', from: '06:00', to: '22:00' }) !== null);
  check('17 is not', w({ date: '09/09/2026', from: '06:00', to: '23:00' }) === null);

  check('an unreadable date or time is dropped rather than guessed at',
        w({ date: 'not a date' }) === null && w({ from: '' }) === null &&
        w({ to: 'half past' }) === null && w({ from: '25:00' }) === null);
  check('and a single-digit hour is still a time',
        w({ date: '09/09/2026', from: '7:26', to: '8:06' }) !== null,
        'the cell is whatever the sheet is formatted to show');
}

function nbSrc() {
  return JSON.parse(fs.readFileSync(
    path.resolve(APPS, '..', 'Databricks-Live-Productivity-Output',
                 'Elmsall Live Productivity.ipynb'), 'utf8'))
    .cells.map(c => c.source.join('')).join('\n');
}

head('[3] site -> zone -> department -> job type');
{
  const rows = [
    rec({ bonus: 'AAA', site: 'E1/E2', zone: 'Goods In', dept: 'Inbound', job: 'Cleaning' }),
    rec({ bonus: 'BBB', site: 'E1/E2', zone: 'Goods In', dept: 'Inbound', job: 'Cleaning' }),
    rec({ bonus: 'CCC', site: 'E1/E2', zone: 'Goods In', dept: 'Support', job: 'Training' }),
    rec({ bonus: 'DDD', site: 'E1/E2', zone: 'OSR', dept: 'Outbound', job: '5S Audit' }),
    rec({ bonus: 'EEE', site: 'E3', zone: 'Packing', dept: 'Outbound', job: 'Cleaning' })
  ];
  const g = ctx.osGroupPak_(rows);
  check('two sites', g.length === 2, g.map(s => s.name).join(' / '));
  check('the bigger one first', g[0].name === 'E1/E2' && g[0].count === 4,
        g[0].name + ' = ' + g[0].count);
  check('its zones, biggest first',
        g[0].zones.map(z => z.name + ':' + z.count).join(' ') === 'Goods In:3 OSR:1',
        g[0].zones.map(z => z.name + ':' + z.count).join(' '));
  check('the zone opens onto its departments',
        g[0].zones[0].depts.map(d => d.name + ':' + d.count).join(' ') === 'Inbound:2 Support:1',
        g[0].zones[0].depts.map(d => d.name + ':' + d.count).join(' '));
  check('and each department onto its job types',
        g[0].zones[0].depts[0].jobs.map(j => j.name).join() === 'Cleaning' &&
        g[0].zones[0].depts[1].jobs.map(j => j.name).join() === 'Training');
  check('with the records under the job',
        g[0].zones[0].depts[0].jobs[0].records.map(r => r.bonus).join() === 'AAA,BBB');

  // The same data twice has to draw the same way twice, or a refresh looks
  // like something changed.
  check('two equal zones are ordered by name, not by luck',
        JSON.stringify(ctx.osGroupPak_(rows)) === JSON.stringify(g));
}

head('[4] a head is a PERSON, not a form');
// One operator logged for two jobs in one zone is one head on OS. Counting
// records would make the bar a measure of paperwork.
{
  const rows = [
    rec({ bonus: 'AAA', job: 'Cleaning' }),
    rec({ bonus: 'AAA', job: 'Training' }),
    rec({ bonus: 'AAA', job: 'Cleaning', zone: 'OSR' }),
    rec({ bonus: 'BBB', job: 'Cleaning' })
  ];
  const g = ctx.osGroupPak_(rows);
  check('four records, two people on site', g[0].count === 2, String(g[0].count));
  const goodsIn = g[0].zones.filter(z => z.name === 'Goods In')[0];
  check('and two in the zone that holds three of them', goodsIn.count === 2,
        String(goodsIn.count));
  check('while both records are still listed under their jobs',
        goodsIn.depts[0].jobs.reduce((n, j) => n + j.records.length, 0) === 3,
        'the count is people; the rows are what they were doing');
  // Somebody logged in two zones is on OS in both, and counted in both.
  check('somebody in two zones is counted in each',
        g[0].zones.filter(z => z.name === 'OSR')[0].count === 1);
}

head('[5] a blank name is labelled, not dropped');
// The form does not require site, zone, department or job, and blanks do turn
// up. An unlabelled heading reads as a rendering fault; a dropped row loses a
// real spell.
{
  const g = ctx.osGroupPak_([rec({ site: '', zone: '   ', dept: '', job: '' })]);
  check('the spell survives', g.length === 1 && g[0].zones.length === 1);
  check('and every level says what is missing',
        g[0].name === '(no site)' && g[0].zones[0].name === '(no zone)' &&
        g[0].zones[0].depts[0].name === '(no department)' &&
        g[0].zones[0].depts[0].jobs[0].name === '(no job type)',
        [g[0].name, g[0].zones[0].name, g[0].zones[0].depts[0].name,
         g[0].zones[0].depts[0].jobs[0].name].join(' / '));
}

head('[6] the status is worded and coloured as the chart bands word it');
// A record reading Approved on this page and amber on a chart would be one
// fact told two ways. Both go through osStatusBandPak_.
{
  const chip = s => ctx.osStatusChipPak_(s);
  check('OK reads Approved, in the good colour',
        /os-status-good/.test(chip('OK')) && />Approved</.test(chip('OK')), chip('OK'));
  check('authorise or reject reads Awaiting Approval, amber',
        /os-status-warn/.test(chip('authorise or reject')) &&
        />Awaiting Approval</.test(chip('authorise or reject')));
  check('Rejected is red', /os-status-bad/.test(chip('Rejected')));
  check('and so is a wording nobody enumerated',
        /os-status-bad/.test(chip('Escalated to Ops')) &&
        />Rejected</.test(chip('Escalated to Ops')),
        'an unknown verdict is not an excused one');
  check('with the raw wording kept in the title for an audit',
        /title="Logged as: Escalated to Ops"/.test(chip('Escalated to Ops')),
        chip('Escalated to Ops'));
  check('an empty status is not given a verdict',
        /os-status-none/.test(chip('')) && !/Rejected/.test(chip('')),
        'calling an undecided spell rejected is an accusation the data cannot support');
  check('and it does not claim to be one in the title either',
        /without a verdict/.test(chip('')), chip(''));
}

head('[7] the record row shows the six things it was asked for');
{
  const html = ctx.osJobTableHtmlPak_([rec({})]);
  check('the bonus number', html.indexOf('>AAA<') !== -1);
  check('the start and finish', html.indexOf('07:26 - 08:06') !== -1);
  check('TM authorising', html.indexOf('J Ashworth') !== -1);
  check('deployed by', html.indexOf('P Okonkwo') !== -1);
  check('reports to', html.indexOf('S Nowak') !== -1);
  check('and the record status', html.indexOf('Approved') !== -1);
  check('headed in that order',
        JSON.stringify(ctx.OS_JOB_COLUMNS_) ===
        '["Bonus","Time","TM Authorising","Deployed by","Reports to","Record Status"]',
        JSON.stringify(ctx.OS_JOB_COLUMNS_));

  // The bonus number behaves like every other one on the dashboard: it sets
  // the global filter, and it carries the manager card.
  check('the chip filters the main view',
        /onclick="event\.stopPropagation\(\);toggleBonusFilter\('AAA'\);"/.test(html), html.slice(0, 200));
  check('and hosts the manager card',
        /class="os-bonus-chip bonus-tip-host clickable-bonus/.test(html) &&
        html.indexOf('bonus-tip') !== -1,
        'this page is often where a manager first meets a code they do not know');
  check('a blank person reads as a dash, not as an empty cell',
        /os-cell-none/.test(ctx.osJobTableHtmlPak_([rec({ auth: '' })])));
  // The OS log is the dashboard's first source of genuinely free-typed text -
  // three people and a job name per record, straight out of a form - and
  // safeTextPak, despite the name, is a String() coercion that escapes
  // nothing. Every value on this page goes through escapeTextPak_ instead.
  check('a name out of a form is escaped, not injected',
        ctx.osJobTableHtmlPak_([rec({ auth: '<b>x</b>' })]).indexOf('<b>x</b>') === -1 &&
        ctx.osJobTableHtmlPak_([rec({ auth: '<b>x</b>' })]).indexOf('&lt;b&gt;') !== -1);
  check('and so is a job or zone name',
        ctx.osGroupPak_([rec({ zone: '<i>z</i>' })]) &&
        PAGE.indexOf('safeTextPak') === -1,
        'not one call left on this page');

  const css = R('Web - Styles.html');
  ['os-bonus-chip', 'os-status', 'os-job-table', 'os-site-head', 'os-dept', 'os-job']
    .forEach(c => check('.' + c + ' is styled', css.indexOf('.' + c + ' {') !== -1));
}

head('[8] a spell is included when it OVERLAPS the range');
// Requiring it to fit inside would hide exactly the people currently on OS: a
// shift that started before the window and is still running.
{
  // The rule is in renderOsPagePak, which needs a document - so it is read out
  // of the source rather than restated here, and the arithmetic is checked
  // against the same window objects it builds.
  check('the test is an overlap, both ways round',
        /w\.finish <= win\.start \|\| w\.start >= win\.finish/.test(PAGE),
        'a containment test would drop a spell already in progress');
  check('and the window is half-open, like the blocks',
        /b > a\) \? \{ start: a, finish: b \}/.test(PAGE),
        'a spell finishing exactly at 08:00 is not in the 08:00 block');

  const win = { start: new Date(2026, 8, 9, 8, 0), finish: new Date(2026, 8, 9, 9, 0) };
  const overlaps = r => {
    const w = ctx.osSpellWindowPak_(rec(r));
    return !!w && !(w.finish <= win.start || w.start >= win.finish);
  };
  check('a spell running into the window is in',
        overlaps({ from: '07:00', to: '08:30' }));
  check('one wholly inside it is in', overlaps({ from: '08:10', to: '08:20' }));
  check('one that spans it entirely is in', overlaps({ from: '06:00', to: '18:00' }));
  check('one that ends exactly as it opens is out',
        !overlaps({ from: '07:00', to: '08:00' }));
  check('one that starts exactly as it closes is out',
        !overlaps({ from: '09:00', to: '10:00' }));
  check('and one on another day is out',
        !overlaps({ date: '08/09/2026', from: '08:10', to: '08:20' }));
}

head('[9] records that could not be read are NAMED, not just counted');
// "7 records could not be read" with no way to find out which seven is a dead
// end. The whole point of saying it is so somebody can go and fix those rows.
{
  // The page NAMES its own drops now, rather than counting them. This is the
  // defect the screenshot caught: only the server's own rejects carried a row
  // number, so a record the CLIENT dropped - an over-long shift, an impossible
  // date - could be counted and then shrugged at, which is how the page came
  // to say "the server could not say which".
  check('the page names what IT dropped, not just counts it',
        /unplaceable\.push\(\{/.test(PAGE) && !/unplaceable\+\+/.test(PAGE),
        'a record nobody can find is a record nobody can chase');

  // The invariant behind that, run rather than read: every record the window
  // walk REJECTS has a reason, and every record it ACCEPTS has none. If the
  // two ever disagree the page would count a row it cannot name - which is
  // precisely the state the screenshot caught it in.
  {
    const cases = [
      rec({}),                                              // fine
      rec({ date: 'not a date' }),
      rec({ from: '' }),
      rec({ to: 'half past' }),
      rec({ from: '25:00' }),
      rec({ from: '', to: '' }),
      rec({ from: '06:00', to: '05:59' }),                  // over the cap
      rec({ date: '09/09/2026', from: '06:00', to: '23:00' })
    ];
    let mismatched = 0, named = 0;
    cases.forEach(c => {
      const placed = ctx.osSpellWindowPak_(c) !== null;
      const why = ctx.osSpellProblemPak_(c);
      if (placed === (why !== '')) mismatched++;
      if (!placed && why) named++;
    });
    check('a rejected record always has a reason, an accepted one never does',
          mismatched === 0, mismatched + ' of ' + cases.length + ' disagreed');
    check('and every one of the seven bad fixtures is named',
          named === 7, named + ' of 7 named');
  }
  // Twice: once in the good-record push, once in the reject list. Counted
  // rather than matched across a line break, since the file is CRLF.
  check('every record carries its sheet row, not only the rejects',
        (CODE.match(/row: OS_LOG_FIRST_ROW_ \+ i,/g) || []).length === 2,
        'which is what makes naming a client-side drop possible at all');
  check('and the two lists are shown as ONE',
        /\(osLogBad \|\| \[\]\)\.concat\(unplaceable\)/.test(PAGE),
        'the heading said 8 and the note said "8 more", which read as 16');
  check('the server counts them too', /skipped\+\+/.test(CODE));

  // The rows themselves, with the sheet row number so they can be found.
  check('the server names each one',
        /row: OS_LOG_FIRST_ROW_ \+ i,/.test(CODE) && /bad\.push\(\{/.test(CODE),
        'the sheet row, the bonus, and what was actually in the three cells');
  check('and says WHY each one failed',
        /'the date is not a date'/.test(CODE) &&
        /'the start is not a time'/.test(CODE) &&
        /'no bonus number'/.test(CODE),
        'so the fix is obvious from the row, not a guess');
  check('the list is capped',
        /OS_LOG_MAX_BAD_ = 50/.test(CODE) && /bad\.length >= OS_LOG_MAX_BAD_/.test(CODE),
        'a log whose Date column changed shape would return every row');
  check('it reaches the page',
        /osLogBad = \(res && res\.bad\) \|\| \[\];/.test(PAGE) &&
        /bad: bad/.test(CODE));
  check('and the page renders them as an expandable row',
        /function osBadRowsHtmlPak_/.test(PAGE) &&
        PAGE.indexOf('os-dropped-row') !== -1 &&
        PAGE.indexOf("osNodeKeyPak_('__bad')") !== -1 &&
        R('Web - Styles.html').indexOf('.os-dropped-row .breakdown-label') !== -1);
  check('with the OS log row number as the first column',
        /OS_BAD_COLUMNS_ = \['OS log row',/.test(PAGE));
  // Not a warning to be tidied away. An impossible date is a real form filled
  // in wrongly, and the page exists to make the abnormal visible - so the
  // section says who there is to ask.
  check('and enough to chase it with',
        /'TM Authorising', 'Deployed by', 'Problem'\]/.test(PAGE) &&
        /'Site \/ Zone'/.test(PAGE),
        'the row to open, the code, the three bad cells, and who signed it off');
  check('the reason is per-record, from the same walk that rejects it',
        /function osSpellProblemPak_\(row\)/.test(PAGE) &&
        /function osSpellWalkPak_\(row, why\)/.test(PAGE),
        'two copies of that logic would eventually disagree about which rows');
  check('and it names the actual problem',
        /'the start is not a time'/.test(PAGE) &&
        /-hour cap'/.test(PAGE) &&
        /'the date is not a date'/.test(PAGE));
  check('the bonus number there is clickable like any other',
        /os-bonus-chip bonus-tip-host clickable-bonus[\s\S]{0,200}toggleBonusFilter/
          .test(PAGE.slice(PAGE.indexOf('function osBadRowsHtmlPak_'))),
        'often the fastest way to find out whose record it is');

  // An unreadable log costs the page, not the dashboard.
  check('and an unreadable log degrades rather than failing the load',
        /return \{ rows: \[\], skipped: 0, bad: \[\] \};/.test(CODE) && /catch \(e\) \{/.test(CODE));
}

head('[13] the Warehouse picker filters the OS sites too');
// The control panel names buildings and the log names sites, so the two are
// mapped. They were never going to converge on their own.
{
  check('the map is declared', /var OS_SITE_BY_BUILDING_ = \{/.test(PAGE));
  const m = /OS_SITE_BY_BUILDING_ = \{([\s\S]*?)\};/.exec(PAGE);
  check('E3 is ELMSALL 3', /e3: \['ELMSALL 3'\]/.test(m ? m[1] : ''));
  check('and E1/E2 is ELMSALL WAY and ELMSALL DRIVE',
        /e1e2: \['ELMSALL WAY', 'ELMSALL DRIVE'\]/.test(m ? m[1] : ''));

  const site = s => { ctx.siteFilter = s; return ctx.osInBuildingPak_; };
  ctx.siteFilter = 'e3';
  check('an E3 view keeps ELMSALL 3 and drops the other two',
        ctx.osInBuildingPak_('ELMSALL 3') && !ctx.osInBuildingPak_('ELMSALL WAY') &&
        !ctx.osInBuildingPak_('ELMSALL DRIVE'));
  ctx.siteFilter = 'e1e2';
  check('an E1/E2 view keeps both of its sites',
        ctx.osInBuildingPak_('ELMSALL WAY') && ctx.osInBuildingPak_('ELMSALL DRIVE') &&
        !ctx.osInBuildingPak_('ELMSALL 3'));
  ctx.siteFilter = 'all';
  check('and Elmsall keeps everything', ctx.osInBuildingPak_('ELMSALL 3') &&
        ctx.osInBuildingPak_('ELMSALL WAY'));

  // Free text off a form.
  ctx.siteFilter = 'e3';
  check('the match is trimmed and case-insensitive',
        ctx.osInBuildingPak_('  elmsall 3 '),
        '"Elmsall 3 " and "ELMSALL 3" are the same site');
  // A site nobody mapped is still a real record.
  check('an unmapped site survives an unfiltered view',
        (function () { ctx.siteFilter = 'all'; return ctx.osInBuildingPak_('ELMSALL NORTH'); })(),
        'hiding it would be a silent loss');
  check('but drops out of a specific building',
        (function () { ctx.siteFilter = 'e3'; return !ctx.osInBuildingPak_('ELMSALL NORTH'); })());
  ctx.siteFilter = 'all';
}

head('[14] the three filters');
{
  check('type is all / pure OS / multi tasks',
        /OS_TYPE_LABELS_ = \{ all: 'All', pure: 'Pure OS', multi: 'Multi Tasks' \}/.test(PAGE));
  check('zones and departments are multi-select',
        /function toggleOsZoneFilter\(zone\)/.test(PAGE) &&
        /function toggleOsDeptFilter\(dept\)/.test(PAGE) &&
        /aria-multiselectable="true"/.test(PAGE));
  check('and both offer what is actually in range',
        /osUniqueValuesPak_\(inWindow, 'zone', 'zone'\)/.test(PAGE) &&
        /osUniqueValuesPak_\(inWindow, 'dept', 'department'\)/.test(PAGE),
        'a zone nobody worked has no business on the list');
  check('built BEFORE those filters are applied',
        PAGE.indexOf("osUniqueValuesPak_(inWindow, 'zone'") <
        PAGE.indexOf('osPassesSetPak_(osZoneFilter'),
        'or choosing one would empty the list you chose it from');

  // An EMPTY set means no filter. The alternative makes the first click on a
  // fresh dropdown empty the page, which reads as the page being broken.
  check('an empty set is no filter, not nothing',
        ctx.osPassesSetPak_({}, 'anything') === true);
  check('and a chosen set is a whitelist',
        ctx.osPassesSetPak_({ 'Goods In': true }, 'Goods In') === true &&
        ctx.osPassesSetPak_({ 'Goods In': true }, 'OSR') === false);
  check('there is a way back to All in one click',
        /function clearOsZoneFilter\(\)/.test(PAGE) &&
        /os-multi-all/.test(PAGE),
        'rather than un-ticking six things');

  // Pure OS is about the PERSON over the whole window, so it is judged before
  // the zone and department filters narrow the records.
  check('pure OS is judged on productive hours, not on the log',
        /function osPureBonusesPak_\(win\)/.test(PAGE) &&
        /rawSideData/.test(PAGE),
        'the log knows nothing about productive work; the pivot does');
  check('and before the other two filters narrow anything',
        PAGE.indexOf('var productive = osPureBonusesPak_(win);') <
        PAGE.indexOf("osTypeFilter === 'pure'"));
  check('the unique values sort, so the list does not reshuffle',
        /out\.sort\(\);/.test(PAGE));
}

head('[15] a zone opens onto DEPARTMENT bars, and those onto records');
{
  check('a department is a bar of its own',
        /class="breakdown-row clickable-row os-dept-row/.test(PAGE) &&
        /class="breakdown-bar os-dept-bar"/.test(PAGE));
  check('nested inside the zone it belongs to',
        PAGE.indexOf('os-zone-detail') < PAGE.indexOf('os-dept-row'));
  check('and it opens onto the records, grouped by job type',
        /class="os-dept-detail"/.test(PAGE) &&
        PAGE.indexOf('os-dept-detail') < PAGE.indexOf('osJobTableHtmlPak_(job.records)'));
  check('the job type heading carries its record count',
        /class="os-job-count"/.test(PAGE));
  // Scaled within their parent, or a small zone's bars are all stubs.
  check('department bars are scaled within their zone',
        /maxDept > 0 \? \(dept\.count \/ maxDept \* 100\)/.test(PAGE));
  check('and zone bars within their site',
        /maxZone > 0 \? \(zone\.count \/ maxZone \* 100\)/.test(PAGE));
  check('both are styled, and the department reads as the quieter one',
        R('Web - Styles.html').indexOf('.breakdown-bar.os-dept-bar') !== -1 &&
        R('Web - Styles.html').indexOf('.os-dept-row { padding-left') !== -1);
}

head('[15b] four filters left, the range right, one row');
{
  const index = R('Web - Index.html');
  const css = R('Web - Styles.html');
  check('the title and subtitle are gone',
        index.indexOf('os-page-title') === -1 && index.indexOf('os-page-sub') === -1 &&
        css.indexOf('.os-page-title') === -1,
        'the rail tab already says OS');
  check('the filters come before the range in the markup',
        index.indexOf('id="osFilters"') < index.indexOf('id="osFrom"'),
        'which is what puts them left of it');
  check('and the range is pushed hard right',
        /\.os-controls \.os-time-bar \{[^}]*margin-left: auto/.test(css),
        'auto margin, so it survives the row wrapping on a narrow window');
  check('one row, same baseline',
        /\.os-controls \{[^}]*align-items: flex-end/.test(css) &&
        /\.os-controls \{[^}]*justify-content: space-between/.test(css));

  // The fourth filter.
  check('Record Status is a multi-select of its own',
        /osMultiSelectHtmlPak_\('osStatusMenu', 'Record Status'/.test(PAGE) &&
        /function toggleOsStatusFilter\(status\)/.test(PAGE));
  check('it filters on the DISPLAYED verdict, not the raw wording',
        /function osRecordStatusPak_\(row\)/.test(PAGE) &&
        /osStatusBandPak_\(row && row\.status\)/.test(PAGE),
        'the table shows three folded states; listing raw wordings nobody can ' +
        'see would be unmatchable');
  check('a record logged without one is its own option',
        /OS_STATUS_NONE_PAK_ = 'No verdict'/.test(PAGE),
        'and not silently lumped in with Rejected');
  check('the options read approved, undecided, refused',
        /rank\[OS_STATUS_APPROVED_PAK_\] = 1/.test(PAGE) &&
        /rank\[OS_STATUS_REJECTED_PAK_\] = 3/.test(PAGE),
        'rather than alphabetically, which puts Awaiting first');
  check('and it composes with the other three',
        /osPassesSetPak_\(osStatusFilter, osRecordStatusPak_\(r\)\)/.test(PAGE));

  // Run the real thing.
  const st = ctx.osRecordStatusPak_;
  check('OK reads as Approved here too', st({ status: 'OK' }) === 'Approved');
  check('an unknown wording folds to Rejected',
        st({ status: 'Escalated to Ops' }) === 'Rejected');
  check('and a blank is No verdict', st({ status: '' }) === 'No verdict' &&
        st({}) === 'No verdict');
  const vals = ctx.osStatusValuesPak_([
    { status: '' }, { status: 'Rejected' }, { status: 'OK' },
    { status: 'authorise or reject' }, { status: 'OK' }]);
  check('the list is unique and in verdict order',
        vals.join(' | ') === 'Approved | Awaiting Approval | Rejected | No verdict',
        vals.join(' | '));
}

head('[16] a refresh does not collapse what you were reading');
// The page polls, and a refresh used to shut whatever was open.
{
  check('open nodes are kept in state, not in the DOM',
        /var osOpenNodes = \{\}/.test(R('Web - JsState.html')));
  check('keyed on the NAMES, so they survive a rebuild',
        /function osNodeKeyPak_\(\)/.test(PAGE) &&
        /osNodeKeyPak_\(site\.name, zone\.name\)/.test(PAGE) &&
        /osNodeKeyPak_\(site\.name, zone\.name, dept\.name\)/.test(PAGE),
        'an index would move the moment the rows re-sort');
  check('the render re-applies them',
        /var zOpen = !!osOpenNodes\[zKey\]/.test(PAGE) &&
        /\(zOpen \? ' expanded' : ''\)/.test(PAGE) &&
        /\(zOpen \? ' open' : ''\)/.test(PAGE));
  check('and a department too',
        /var dOpen = !!osOpenNodes\[dKey\]/.test(PAGE));
  check('the toggle writes to that state',
        /function toggleOsNode\(el\)/.test(PAGE) &&
        /osOpenNodes\[key\] = true/.test(PAGE));
  // Not an accordion: two levels plus persistence means several can be open,
  // and toggleBreakdownDetail would shut the others.
  check('it does not reuse the accordion toggle',
        PAGE.indexOf('toggleBreakdownDetail') === -1,
        'that one shuts every other open row, which fights the whole point');
  // A key built by joining names needs a separator those names cannot hold.
  check('the key separator cannot appear in a name',
        /join\('\\u001f'\)/.test(PAGE),
        'a unit separator, so "A|B" and "A" + "B" cannot collide');

  const k = ctx.osNodeKeyPak_;
  check('so two different paths cannot collide',
        k('E3', 'Packing') !== k('E3Packing') &&
        k('A', 'B', 'C') !== k('A', 'BC'),
        k('E3', 'Packing'));
}

head('[17] the wording is Records, not spells');
{
  check('the page says record',
        PAGE.indexOf(">record' + (rows.length === 1 ? '' : 's')") !== -1);
  check('and nowhere says spell to the reader',
        !/>[^<]*spell/i.test(PAGE.replace(/\/\/[^\n]*/g, '')),
        'the comments still discuss spells; the page does not');
}

head('[10] the page is wired in at index 3, and the Data Table moved to 4');
// The rail order IS the page order - the swipe and the arrow keys move by
// index - so inserting a tab renumbers everything after it. Every list that
// counts pages has to move together or a tab navigates somewhere else.
{
  const state = R('Web - JsState.html');
  const ui = R('Web - JsUi.html');
  const index = R('Web - Index.html');
  const tour = R('Web - JsTour.html');
  const init = R('Web - JsInit.html');

  check('five pages', /var totalPages = 5;/.test(state) &&
        /var pageDirty = \[true, true, true, true, true\];/.test(state));
  const rail = (index.match(/onclick="goToPage\((\d)\)"/g) || []).map(s => s.replace(/\D/g, ''));
  check('five rail tabs, in order', rail.join() === '0,1,2,3,4', rail.join());
  check('the OS tab is the fourth', /goToPage\(3\)" title="Operational Support"/.test(index));
  check('and the Data Table the fifth', /goToPage\(4\)" title="Data Table"/.test(index));
  // Four in the markup plus the Overall page, which is its own include.
  const pageDivs = (index.match(/<div class="page">/g) || []).length +
                   (R('Web - PageOverall.html').match(/<div class="page">/g) || []).length;
  check('there are five .page containers, one per tab', pageDivs === 5, String(pageDivs));

  check('the dispatcher builds the OS page at 3',
        /index === 3\) \{[\s\S]{0,400}renderOsPagePak\(\)/.test(ui));
  check('and the main table at 4',
        /index === 4\) \{\s*renderMainTablePak/.test(ui));

  // One list of page names, read by the deep link on both sides.
  check('the deep-link names agree across the two files',
        /DEEP_LINK_PAGES_ = \['overall', 'volume', 'bonus', 'os', 'data'\]/.test(CODE) &&
        /DEEP_LINK_PAGES_PAK_ = \['overall', 'volume', 'bonus', 'os', 'data'\]/.test(state),
        '?page=data would otherwise open the OS page');
  check('and JsInit reads the list rather than keeping a third copy',
        /DEEP_LINK_PAGES_PAK_\.indexOf\(DEEP_PAGE\)/.test(init),
        'the copy that used to sit here was missed when this page was inserted');

  // The tour walks pages by index too, and it has a chapter of its own for
  // this page - a tour that swipes straight through one on its way to the next
  // is how a whole page ends up undiscovered.
  check('the tour follows the Data Table to page 4',
        (tour.match(/page: 4,/g) || []).length === 7,
        (tour.match(/page: 4,/g) || []).length + ' step(s)');
  check('and has a chapter on the OS page',
        (tour.match(/part: 6, page: 3,/g) || []).length >= 3 &&
        /6: 'OS page'/.test(tour),
        (tour.match(/part: 6, page: 3,/g) || []).length + ' step(s)');
  // It walks BOTH levels, and opens them through toggleOsNode - a class set
  // behind the page's back is undone by the next render, which is the very bug
  // the open-state tracking exists to fix.
  check('the chapter reaches the department bars and the records',
        /target: '#osBody \.os-dept-row'/.test(tour) &&
        /target: '#osBody \.os-dept-detail \.os-job-table'/.test(tour));
  // Scoped to this chapter: the head breakdown's own steps still use
  // toggleBreakdownDetail, and legitimately - that page IS an accordion.
  const ch6 = tour.slice(tour.indexOf('===== Part 6'), tour.indexOf('===== Part 7'));
  check('and opens them the way a click does',
        /function tourOpenOsZone_\(\)/.test(tour) &&
        /function tourOpenOsDept_\(\)/.test(tour) &&
        ch6.indexOf('toggleBreakdownDetail') === -1,
        'poking the classes directly would be undone by the next render');
  check('it closes them again afterwards',
        /function tourCloseOsNodes_\(\)/.test(tour) &&
        /cleanup: function \(\) \{ tourCloseOsNodes_\(\); \}/.test(tour));
  check('every part still has a title in the replay menu',
        (() => {
          const parts = {};
          (tour.match(/part: (\d+),/g) || []).forEach(m => { parts[m.replace(/\D/g, '')] = true; });
          return Object.keys(parts).every(n => new RegExp('\n  ' + n + ": '").test(tour));
        })(),
        'a part with no title shows a blank row in the "?" menu');
  check('and the wrap-up is still the one hidden from it',
        /TOUR_MENU_HIDDEN_PARTS = \{ 11: true \}/.test(tour) &&
        /11: 'Wrap up'/.test(tour));

  check('the page include is in the document',
        /include\('Web - JsPageOs'\)/.test(index));
}

head('[12] the log is fetched by the page, not by every dashboard load');
// Measured at 431ms of a load, paid by everyone including the majority who
// never open this page - and it was the only read on that path that nothing
// on screen needed.
{
  const init = R('Web - JsInit.html');
  check('getDashboardData no longer reads it',
        CODE.indexOf('osLog: osLog.rows') === -1 &&
        !/var osLog = readOsLogRows_\(ss, timeRanges\)/.test(CODE),
        'it cost every viewer a read for a page most never open');
  check('and the payload no longer carries it',
        !/osLogRows = data\.osLog/.test(init) && /osLogRows = \[\];/.test(init));
  check('there is an entry point of its own',
        /function getOsLogRows\(dateKeys, archiveUrl\)/.test(CODE));
  check('the page calls it on first open',
        /\.getOsLogRows\(osLogWantDates_\(\), currentArchiveUrl \|\| null\)/.test(PAGE));
  check('once only - a second open is served from memory',
        /if \(osLogState !== null\) return;/.test(PAGE),
        'osLogState guards the fetch, not the render');

  // The three states have to be distinguishable. An empty array means both
  // "nobody was on OS" and "this has not arrived yet".
  ['loading', 'ready'].forEach(s =>
    check("'" + s + "' is a state the page renders", PAGE.indexOf("'" + s + "'") !== -1));
  // Matched on the whole call, not on the method name: "withFailureHandler" is
  // a substring of any typo'd longer name, so the looser check passed against
  // a handler that was never wired up.
  check('a failure is NAMED rather than left as an empty page',
        PAGE.indexOf('.withFailureHandler(function (err) {') !== -1 &&
        /The OS log could not be read/.test(PAGE),
        '"nobody on OS" and "the log broke" look identical otherwise');
  // Deliberately NO spinner. It arrives in well under a second, and the
  // animation was landing on top of whatever somebody was already reading.
  check('there is no loading animation to read around',
        !/fa-spin/.test(PAGE) && /if \(osLogState === 'loading'\) return;/.test(PAGE),
        'the body is left as it was and replaced when the rows land');

  // The client works out the window, so the server needs no read to do it.
  check('the client sends the dates it wants',
        /function osLogWantDates_\(\)/.test(PAGE));
  check('including the production day BEFORE each',
        /new Date\(d\.getTime\(\) - 86400000\)/.test(PAGE),
        'a 02:00 spell on the 9th is logged against the 8th');
  check('and the server takes them as a set rather than re-deriving them',
        /function readOsLogRows_\(ss, want\)/.test(CODE) &&
        !/for \(var t = 0; t < timeRanges\.length; t\+\+\)[\s\S]{0,200}osLogDateKey_/.test(CODE));
  check('the answer is cached, keyed on those dates',
        /'osLog_v1_' \+ \(archiveUrl \? 'a' : 'l'\) \+ '_' \+ keys\.join/.test(CODE),
        'a different window cannot be served a stale answer');
  check('and the preview stub answers it too',
        /getOsLogRows: function \(\)/.test(R('tools/preview.js')),
        'or the OS page is permanently empty in the preview');

  // The tour must not reach page 3 and pull the REAL log: real names, against
  // demo bonus numbers that match none of them, in the middle of a tour that
  // is demo data everywhere else.
  const tourData = R('Web - JsTourData.html');
  const tourJs = R('Web - JsTour.html');
  check('the tour supplies its own OS rows',
        /function buildTourOsLog_\(\)/.test(tourData) &&
        /osLogRows = buildTourOsLog_\(\);/.test(tourJs));
  check('and marks them ready, so the fetch never fires while it runs',
        /osLogState = 'ready';/.test(tourJs),
        'otherwise the tour shows real spells and real names');
  check('the demo rows are built from the codes the tour actually shows',
        /allBonusList\.slice\(0, 18\)/.test(tourData),
        'a code the tour never displays would chip nothing');
  check('they carry a blank status, which is a state the page must render',
        /TOUR_OS_STATUS_ = \['OK', 'OK', 'OK', 'authorise or reject', 'Rejected', ''\]/.test(tourData));
  check('and the state is reset when the tour ends',
        /osLogState = null;/.test(tourJs) &&
        tourJs.indexOf("osLogState = null;") > tourJs.indexOf("osLogState = 'ready';"),
        'or the real log would never be fetched afterwards');
}

head('[11] Hours Range and Time Window are inert where they do nothing');
// Both pages with their own From / To read neither: they work over the whole
// 24 hours and ignore the window size. A control you can change that then
// changes nothing reads as the page being broken.
{
  const ui = R('Web - JsUi.html');
  const tables = R('Web - JsTables.html');
  check('the Bonus and OS pages are the two',
        /var PAGES_WITH_OWN_RANGE_ = \[2, 3\];/.test(ui));
  check('and goToPage syncs it', /syncTimeAxisControlsPak_\(index\);/.test(ui));
  check('both controls are disabled, not hidden',
        /\['hoursRange', 'timeWindow'\]/.test(ui) && /el\.disabled = off;/.test(ui),
        'hidden, the row would reflow every time you change page');
  check('the field greys with them',
        /hc-field-off/.test(ui) && R('Web - Styles.html').indexOf('.hc-field-off {') !== -1);
  // The claim being made: the Bonus page really does read neither.
  check('the Bonus page reads neither, which is why this is true',
        !/\$\('hoursRange'\)/.test(tables) &&
        (tables.match(/\$\('timeWindow'\)/g) || []).length === 1 &&
        /function buildMainRowDetail[\s\S]{0,120}\$\('timeWindow'\)/.test(tables),
        'the one use left is the Data Table detail row, on page 4');
  check('and the OS page reads its own selects only',
        !/hoursRange|timeWindow/.test(PAGE) && /\$\('osFrom'\)/.test(PAGE));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
