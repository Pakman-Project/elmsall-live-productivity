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

head('[9] records that could not be read are said out loud');
{
  check('the page counts what it dropped itself', /unplaceable\+\+/.test(PAGE));
  check('and adds what the server dropped',
        /Number\(osLogSkipped\) \|\| 0\) \+ unplaceable/.test(PAGE),
        'a page quietly one row short is the worst of the options');
  check('the server counts them too', /skipped\+\+/.test(CODE));
  check('there is a place to say it', /class="os-dropped"/.test(PAGE) &&
        R('Web - Styles.html').indexOf('.os-dropped {') !== -1);
  // An unreadable log costs the page, not the dashboard.
  check('and an unreadable log degrades rather than failing the load',
        /return \{ rows: \[\], skipped: 0 \};/.test(CODE) && /catch \(e\) \{/.test(CODE));
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
  check('and the loading state is shown, not just set',
        /fa-circle-notch fa-spin/.test(PAGE));

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
