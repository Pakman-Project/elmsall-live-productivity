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
// The @media block CONTAINING a rule, brace-matched - splitting on the media
// opener puts a rule sited just above one into the previous chunk, and lets a
// chunk run past its own closing brace into whatever follows.
function mediaBlockFor(css, marker) {
  const at = css.indexOf(marker);
  if (at === -1) return '';
  const open = css.lastIndexOf('@media (max-width: 700px)', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = css.indexOf('{', open); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return (i > at) ? css.slice(open, i + 1) : '';
  }
  return '';
}

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
        /status-chip-good/.test(chip('OK')) && />Approved</.test(chip('OK')), chip('OK'));
  check('authorise or reject reads Awaiting Approval, amber',
        /status-chip-warn/.test(chip('authorise or reject')) &&
        />Awaiting Approval</.test(chip('authorise or reject')));
  check('Rejected is red', /status-chip-bad/.test(chip('Rejected')));
  // De-grouped, on this page only. The chart's fold sends everything that is
  // neither approved nor pending to "Rejected", which is right for a band - one
  // label, full height of the plot - and wrong for a cell per record. A spell
  // logged "Cancelled" is not a rejection, and this page is where somebody
  // comes to find out what actually happened to a record.
  check('a wording nobody enumerated says what was LOGGED',
        />Escalated to Ops</.test(chip('Escalated to Ops')) &&
        !/>Rejected</.test(chip('Escalated to Ops')),
        chip('Escalated to Ops'));
  check('but keeps the red, because it still did not get its hours',
        /status-chip-bad/.test(chip('Escalated to Ops')) &&
        /status-chip-bad/.test(chip('Cancelled')),
        'the colour is the three-state fold; only the word is de-grouped');
  check('the two known translations still fold',
        />Approved</.test(chip('OK')) &&
        />Awaiting Approval</.test(chip('authorise or reject')),
        'those are the form words for states the page already names');
  check('and a passed-through wording needs no "Logged as" title',
        !/title="Logged as/.test(chip('Escalated to Ops')),
        'the cell already says it; repeating it in a tooltip is noise');
  check('while a folded one still carries the raw wording for an audit',
        /title="Logged as: OK"/.test(chip('OK')), chip('OK'));
  check('an empty status is not given a verdict',
        /status-chip-none/.test(chip('')) && !/Rejected/.test(chip('')),
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
        /class="bonus-chip bonus-tip-host clickable-bonus/.test(html) &&
        html.indexOf('bonus-tip') !== -1,
        'this page is often where a manager first meets a code they do not know');
  check('a blank person reads as a dash, not as an empty cell',
        /cell-none/.test(ctx.osJobTableHtmlPak_([rec({ auth: '' })])));
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
  ['bonus-chip', 'status-chip', 'record-table', 'os-site-head', 'os-dept', 'record-group']
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
        /\? openRecords : unplaceable\)\.push\(\{/.test(PAGE) && !/unplaceable\+\+/.test(PAGE),
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
        /badInBuilding\.concat\(unplaceable\)/.test(PAGE),
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
        PAGE.indexOf('dropped-row') !== -1 &&
        /key: '__bad'/.test(PAGE) && /osNodeKeyPak_\(kind\.key\)/.test(PAGE) &&
        R('Web - Styles.html').indexOf('.dropped-row .breakdown-label') !== -1);
  // Not a warning to be tidied away. An impossible date is a real form filled
  // in wrongly, and the page exists to make the abnormal visible - so the
  // section says what the record was and who there is to ask about it.
  check('the columns are the record, not the fault',
        /OS_BAD_COLUMNS_ = \['Bonus', 'Date', 'Start', 'Finish', 'Site \/ Zone',\s*\n?\s*'Task', 'TM Authorising', 'Deployed by', 'Record Status'\]/
          .test(PAGE),
        'the code, the three bad cells, the task, the verdict, and who signed it off');
  // The sheet row named a place most readers of this page cannot open, and the
  // reason was the widest column in a table already too wide for a phone. Both
  // went; the reason stayed, on the row, where hovering still finds it.
  check('the row number and the Problem column are gone',
        PAGE.indexOf("'OS log row'") === -1 && !/'Problem'\]/.test(PAGE) &&
        PAGE.indexOf('os-bad-row-num') === -1 && PAGE.indexOf('os-bad-why') === -1 &&
        R('Web - Styles.html').indexOf('.os-bad-row-num') === -1,
        'a dead column and its stylesheet rule both go, or the next reader finds half of it');
  check('but the reason still rides on the row',
        /title="' \+ escapeAttrPak\(b\.why\)/.test(PAGE) &&
        R('Web - Styles.html').indexOf('.bad-record-row { cursor: help; }') !== -1,
        'it is the most useful thing here, just not the widest column');
  // Both halves have to carry the new cells or the table is a column of
  // dashes: the server's own rejects, and the ones the client could not place.
  check('the server fills the new columns too',
        /job: osLogCell_\(r, OS_LOG_COLS_\.job\),[\s\S]{0,300}status: osLogCell_\(r, OS_LOG_COLS_\.status\),[\s\S]{0,200}zone: osLogCell_\(r, OS_LOG_COLS_\.zone\),[\s\S]{0,120}why: why/
          .test(CODE),
        'a server reject with half the row blank looks like a worse kind of fault');
  check('and so does the client-side drop',
        /openRecords : unplaceable\)\.push\(\{[\s\S]{0,400}job: rec\.job,[\s\S]{0,200}status: rec\.status,/.test(PAGE));
  check('the verdict there is the same chip as everywhere else',
        /osStatusChipPak_\(b\.status\)/.test(PAGE),
        'a second way of writing Approved would eventually disagree with the first');
  check('the reason is per-record, from the same walk that rejects it',
        /function osSpellProblemPak_\(row\)/.test(PAGE) &&
        /function osSpellWalkPak_\(row, why\)/.test(PAGE),
        'two copies of that logic would eventually disagree about which rows');
  check('and it names the actual problem',
        /'the start is not a time'/.test(PAGE) &&
        /-hour cap'/.test(PAGE) &&
        /'the date is not a date'/.test(PAGE));
  check('the bonus number there is clickable like any other',
        /bonus-chip bonus-tip-host clickable-bonus[\s\S]{0,200}toggleBonusFilter/
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

  // The filter has to reach the records that never made it onto a clock too -
  // a reject for the OTHER building is exactly the "elsewhere" case the picker
  // exists for, whether or not it also failed to parse.
  check('unplaceable records are checked against the building before anything else',
        /if \(!osInBuildingPak_\(rec\.site\)\) continue;\s*\n\s*var w = osSpellWindowPak_\(rec\);/
          .test(PAGE),
        'a record for the OTHER warehouse should not be on screen at all');
  check('and so are the server\'s own rejects',
        /\(osLogBad \|\| \[\]\)\.forEach\(function \(b\) \{\s*\n\s*if \(!osInBuildingPak_\(b\.site\)\) return;/
          .test(PAGE),
        'they carry a Site cell too, read off the same OS Log row');
  check('badInBuilding is what reaches the card, not the raw list',
        PAGE.indexOf('badInBuilding.concat(unplaceable)') !== -1 &&
        !/osLogBad \|\| \[\]\)\.concat\(unplaceable\)/.test(PAGE));
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
        /osUniqueValuesPak_\(rowsForDept, 'dept', 'department'\)/.test(PAGE),
        'a zone nobody worked has no business on the list');
  check('zones is built from the WHOLE window, unfiltered by itself',
        /var zoneValues = osUniqueValuesPak_\(inWindow, 'zone', 'zone'\);/.test(PAGE),
        'or choosing one would empty the list you chose it from');

  // Departments cascades from Zones, and Record Status cascades from
  // Departments: each dropdown offers only what exists under whatever is
  // chosen upstream of it, not the whole window regardless.
  check('departments is narrowed by the chosen zones first',
        /var rowsForDept = inWindow\.filter\(function \(r\) \{\s*\n\s*return osPassesSetPak_\(osZoneFilter, osLabelPak_\(r\.zone, 'zone'\)\);/
          .test(PAGE));
  check('and record status by the chosen zones AND departments',
        /var rowsForStatus = rowsForDept\.filter\(function \(r\) \{\s*\n\s*return osPassesSetPak_\(osDeptFilter, osLabelPak_\(r\.dept, 'department'\)\);/
          .test(PAGE) &&
        /osStatusValuesPak_\(rowsForStatus\)/.test(PAGE),
        'built on rowsForDept, which is already zone-narrowed - not on inWindow again');
  // A stale downstream selection has to be cleared the moment its upstream
  // changes, or it goes on filtering by a value its own dropdown no longer
  // even lists - which the picked-count label would then misreport as "All".
  check('choosing a zone clears the departments and status selections',
        /function toggleOsZoneFilter\(zone\) \{[\s\S]{0,160}osDeptFilter = \{\};[\s\S]{0,40}osStatusFilter = \{\};/
          .test(PAGE));
  check('clearing zones does too',
        /function clearOsZoneFilter\(\) \{[\s\S]{0,80}osDeptFilter = \{\};[\s\S]{0,40}osStatusFilter = \{\};/
          .test(PAGE));
  check('choosing a department clears the status selection',
        /function toggleOsDeptFilter\(dept\) \{[\s\S]{0,140}osStatusFilter = \{\};/.test(PAGE));
  check('clearing departments does too',
        /function clearOsDeptFilter\(\) \{[\s\S]{0,60}osStatusFilter = \{\};/.test(PAGE));
  check('but record status has nothing downstream to clear',
        /function toggleOsStatusFilter\(status\) \{[\s\S]{0,120}renderOsPagePak\(\);\s*\n\s*\}/
          .test(PAGE) &&
        !/function toggleOsStatusFilter\(status\) \{[\s\S]{0,160}osZoneFilter = \{\}/.test(PAGE));

  // An EMPTY set means no filter. The alternative makes the first click on a
  // fresh dropdown empty the page, which reads as the page being broken.
  check('an empty set is no filter, not nothing',
        ctx.osPassesSetPak_({}, 'anything') === true);
  check('and a chosen set is a whitelist',
        ctx.osPassesSetPak_({ 'Goods In': true }, 'Goods In') === true &&
        ctx.osPassesSetPak_({ 'Goods In': true }, 'OSR') === false);
  check('there is a way back to All in one click',
        /function clearOsZoneFilter\(\)/.test(PAGE) &&
        /filter-multi-all/.test(PAGE),
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
        PAGE.indexOf('node-detail') < PAGE.indexOf('os-dept-row'));
  check('and it opens onto the records, grouped by job type',
        /class="node-subdetail"/.test(PAGE) &&
        PAGE.indexOf('node-subdetail') < PAGE.indexOf('osJobTableHtmlPak_(job.records)'));
  check('the job type heading carries its record count',
        /class="record-group-count"/.test(PAGE));
  // A department bar is a SHARE OF ITS ZONE - 9 of 33 is a third of the track.
  // Scaled against the largest department instead, which this did, the biggest
  // always filled the track whatever it was: 9, 9, 9 and 6 drew three full-width
  // bars and one at two thirds, reading as "nearly everybody" three times over.
  check('department bars are a share of the zone total',
        /zone\.count > 0[\s\S]{0,60}dept\.count \/ zone\.count \* 100/.test(PAGE) &&
        PAGE.indexOf('maxDept') === -1,
        'the zone total is the number on the row the reader just looked at');
  check('and clamped, because one head can be in two departments',
        /Math\.min\(100, dept\.count \/ zone\.count \* 100\)/.test(PAGE),
        'the parts can legitimately sum past the whole');
  // Zone bars are a share of the OVERALL total (headCount, the same number the
  // summary calls "N on OS"), not of the largest zone at their own site.
  // Scaled per site, a 56-strong zone at a busy site and a 28-strong zone at a
  // quiet one both drew full-width bars - each was simply the biggest thing
  // beside it, which told the reader nothing about how they compared.
  check('zone bars are a share of the OVERALL total, not their own site',
        /headCount > 0 \? Math\.min\(100, zone\.count \/ headCount \* 100\)/.test(PAGE) &&
        PAGE.indexOf('maxZone') === -1,
        'a 56-strong zone and a 28-strong one should not both fill the bar');
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
        /\.page-controls \.page-time-bar \{[^}]*margin-left: auto/.test(css),
        'auto margin, so it survives the row wrapping on a narrow window');
  check('one row, same baseline',
        /\.page-controls \{[^}]*align-items: flex-end/.test(css) &&
        /\.page-controls \{[^}]*justify-content: space-between/.test(css));

  // The fourth filter.
  check('Record Status is a multi-select of its own',
        /osMultiSelectHtmlPak_\('osStatusMenu', 'Record Status'/.test(PAGE) &&
        /function toggleOsStatusFilter\(status\)/.test(PAGE));
  // The filter and the cell have to offer the same words, or the dropdown is a
  // list of options nobody can match to the page. Both go through one function.
  check('the filter reads what the CELL reads',
        /function osRecordStatusPak_\(row\)/.test(PAGE) &&
        /osStatusTextPak_\(row && row\.status\)/.test(PAGE) &&
        /var text = osStatusTextPak_\(status\);/.test(PAGE),
        'one function, so a filter option can always be matched to a chip');
  check('a record logged without one is its own option',
        /OS_STATUS_NONE_PAK_ = 'No verdict'/.test(PAGE),
        'and not silently lumped in with Rejected');
  check('approved first, then undecided, then the blanks last',
        /rank\[OS_STATUS_APPROVED_PAK_\] = 1/.test(PAGE) &&
        /rank\[OS_STATUS_AWAITING_PAK_\] = 2/.test(PAGE) &&
        /rank\[OS_STATUS_NONE_PAK_\] = 4/.test(PAGE),
        'alphabetically would put Awaiting first');
  check('with the logged wordings between them, sorted among themselves',
        /\(rank\[a\] \|\| 3\) - \(rank\[b\] \|\| 3\)/.test(PAGE) &&
        /d \|\| \(a < b \? -1 : a > b \? 1 : 0\)/.test(PAGE),
        'they are no longer a fixed set, so the order has to be stable by name');
  check('and it composes with the other three',
        /osPassesSetPak_\(osStatusFilter, osRecordStatusPak_\(r\)\)/.test(PAGE));

  // Run the real thing.
  const st = ctx.osRecordStatusPak_;
  check('OK reads as Approved here too', st({ status: 'OK' }) === 'Approved');
  check('an unknown wording is passed through as logged',
        st({ status: 'Escalated to Ops' }) === 'Escalated to Ops',
        st({ status: 'Escalated to Ops' }));
  check('and Rejected stays Rejected, being a real verdict',
        st({ status: 'Rejected' }) === 'Rejected');
  check('trimmed, so one typed with a trailing space is not a second option',
        st({ status: '  Cancelled ' }) === 'Cancelled');
  check('and a blank is No verdict', st({ status: '' }) === 'No verdict' &&
        st({}) === 'No verdict');
  const vals = ctx.osStatusValuesPak_([
    { status: '' }, { status: 'Rejected' }, { status: 'OK' },
    { status: 'authorise or reject' }, { status: 'OK' },
    { status: 'Cancelled' }, { status: 'Escalated to Ops' }]);
  check('the list is unique, verdicts first, wordings by name',
        vals.join(' | ') === 'Approved | Awaiting Approval | Cancelled | ' +
                             'Escalated to Ops | Rejected | No verdict',
        vals.join(' | '));
}

head('[15e] the OS page on a phone');
// Two separate reports, both about this page at phone width: it would not
// scroll at all, and the four filters were stacked down one half of the row.
{
  const css = R('Web - Styles.html');
  const mob = (css.split('@media (max-width: 700px)')
                  .filter(s => s.indexOf('.record-table-wrap') !== -1)[0] || '');

  // Scrolling the table sideways to fit six-to-nine columns on a phone used to
  // need pan-x to keep that gesture off the page swipe, and even then a finger
  // placed over an open record table on iOS Safari did nothing at all - Safari
  // does not chain a captured horizontal drag out to the page the way Chrome
  // does. Cards side-step the trade instead of picking a side of it: nothing
  // inside a card scrolls, so there is no gesture left to fight over.
  check('the wrapper no longer captures the gesture at all',
        /\.table-wrap\.record-table-wrap \{/.test(mob) &&
        /overflow: visible; touch-action: auto;/.test(mob),
        'a vertical drag over a record table has to reach the page');
  check('...beating the LATER rule that puts overflow-x back for other tables',
        mob.indexOf('.table-wrap.record-table-wrap') !== -1,
        'a single-class selector here would lose the tie to source order');
  check('the table lays out as blocks, one row one card',
        /\.record-table, \.record-table tbody, \.record-table tr \{ display: block; width: 100%; \}/.test(mob) &&
        /\.record-table thead \{ display: none; \}/.test(mob));
  check('each cell shows the label the hidden header used to carry',
        /\.record-table td::before \{\s*content: attr\(data-label\);/.test(mob),
        'so the value is still identifiable once the header is gone');

  // The CSS reads the attribute; this is the other half - that every <td> in
  // every one of the four builders (both here and in JsPageNpl) actually
  // carries one. A cell with none would render with no label at all once the
  // header hides, on a phone, which is exactly where nobody would be looking
  // at a wide screen to notice.
  const cellsAndLabels = src => (src.match(/<td[^>]*>/g) || []).length ===
                                 (src.match(/data-label="/g) || []).length &&
                                 (src.match(/data-label="/g) || []).length > 0;
  check('every OS job cell carries its label',
        cellsAndLabels(PAGE.slice(PAGE.indexOf('function osJobTableHtmlPak_'),
                                   PAGE.indexOf('function renderOsPagePak'))));
  check('and every OS bad-record cell too',
        cellsAndLabels(PAGE.slice(PAGE.indexOf('function osBadRowsHtmlPak_'),
                                   PAGE.indexOf('function renderOsPagePak'))));

  // The filters were one flex column inside a single cell of the Bonus page's
  // two-column grid. display:contents dissolves the wrapper so each filter is a
  // grid item in its own right, and the six controls lay out three rows of two.
  check('the filter wrapper dissolves into the Bonus page grid',
        /\.page-filters \{ display: contents; \}/.test(mob),
        'or all four stack down one half of the row');
  check('the page uses that grid in the first place',
        R('Web - Index.html').indexOf('class="bonus-page-controls page-controls"') !== -1 &&
        /\.bonus-page-controls \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/
          .test(css));
  check('and each filter fills its cell, label above control',
        /\.page-filter \.filter-type-select,[\s\S]{0,120}width: 100%/.test(mob) &&
        /\.page-filter \.breakdown-time-label \{[\s\S]{0,120}font-size: 11px/.test(mob),
        'the same shape as the Bonus page, which is what was asked for');
}

head('[15f] the records-to-be-aware-of row is a bar, not a squeezed label');
{
  const css = R('Web - Styles.html');
  check('the wording says what is actually wrong with them',
        /' that cannot be placed on a clock'/.test(PAGE),
        'which is the same thing the section underneath then explains');
  check('and it still agrees with itself for a single record',
        /n \+ ' record' \+ \(n === 1 \? '' : 's'\) \+ ' that cannot be placed on a clock'/.test(PAGE) &&
        !/need[s]? to be aware of/.test(PAGE),
        '"1 record that cannot be placed on a clock"');

  // It sat between the summary and the first site, which put a warning in the
  // reader's way before the thing they opened the page for. These records are
  // in none of the figures, so they are a footnote to the breakdown.
  // Its own card now, not a row appended inside the breakdown: these records
  // are in none of the figures in that card, and a warning living inside it
  // read as part of the same total it is explicitly excluded from.
  check('the bad-records section is its own card in the markup',
        /id="osBadCard"[^>]*hidden[\s\S]{0,80}id="osBadBody"/.test(R('Web - Index.html')),
        'separate from the breakdown card, and hidden until there is something to show');
  check('rendered into that card by its own function',
        /function osRenderDroppedCardPak_\(cardId, bodyId, bad, unnamed, kind\)/.test(PAGE) &&
        /osRenderDroppedCardPak_\('osBadCard', 'osBadBody'/.test(PAGE));
  check('hidden outright when there is nothing to show',
        /card\.hidden = !html;/.test(PAGE),
        'an empty card would still draw a border round nothing');
  check('called once, before either exit, so both get it the same way',
        (PAGE.match(/osRenderDroppedCardPak_\('osBadCard'/g) || []).length === 1 &&
        PAGE.indexOf("osRenderDroppedCardPak_('osBadCard'") < PAGE.indexOf("for (var si = 0"),
        'one call site above the branch, not one per exit that could drift apart');
  check('and it no longer renders inside #osBody',
        !/html \+= osBadRowsHtmlPak_\(/.test(PAGE) &&
        !/body\.innerHTML = html \+ badHtml/.test(PAGE),
        'the old in-card placement');
  check('separated from the card above it',
        /#osBadCard, #nplBadCard \{ margin-top: 16px; \}/.test(R('Web - Styles.html')),
        'the page has no grid gap of its own here; the two cards would sit flush');
  // It has no bar and no count - there is nothing to measure it against - so
  // the label took the full width instead of wrapping onto two lines beside an
  // empty bar track.
  check('the empty bar track and count cell are gone',
        !/dropped-row[\s\S]{0,400}breakdown-bar-wrap/.test(PAGE) &&
        !/dropped-row[\s\S]{0,400}breakdown-count/.test(PAGE));
  check('and the label IS the bar, at the bar\'s own height',
        /\.dropped-row \.breakdown-label \{[^}]*flex: 1 1 auto/.test(css) &&
        /\.dropped-row \.breakdown-label \{[^}]*height: 30px/.test(css) &&
        /\.dropped-row \.breakdown-label \{[^}]*background: var\(--status-warn-soft\)/.test(css),
        'so the row still lines up with the zone bars under it');
  check('with the chevron at the far end, like every other expandable row',
        /\.dropped-row \.breakdown-chevron \{ margin-left: auto; \}/.test(css));

  // The bare `table` rule is table-layout: fixed, which is right for the Data
  // Table - a column per work area, sharing the width evenly - and wrong here.
  // The bad-records table appears once and is not a column of anything else,
  // so it sizes to its own content: a fixed equal split clipped
  // "Cover - Team Manager" and "15/09/2026" to "Cov..." and "15/...".
  check('the bad-records table sizes its columns to what is IN them',
        /\.bad-record-table \{ table-layout: auto; \}/.test(css),
        'nine equal columns clipped every name and every date');
  check('and the global fixed layout is still there for the Data Table',
        /\ntable \{\s*\n\s*width: 100%;\s*\n\s*border-collapse: collapse;\s*\n\s*table-layout: fixed;/
          .test(css),
        'it is what lets every volume column be visible at once');

  // The RECORDS table is the opposite case: one job type is one table, and a
  // zone can hold a dozen down the page, so it has to agree with every other
  // job table on where its columns sit rather than read well on its own.
  check('the records table is fixed, with shares spent on what needs them',
        /\.record-table:not\(\.bad-record-table\) \{ table-layout: fixed; \}/.test(css),
        'auto would size each table from its own content and misalign the next one down');
  check('a colgroup carries those shares, not a blind six-way split',
        /var OS_JOB_COL_WIDTHS_ = \[10, 13, 19, 19, 19, 20\];/.test(PAGE) &&
        /html \+= '<col style="width:' \+ OS_JOB_COL_WIDTHS_\[w\] \+ '%">';/.test(PAGE),
        'the bare `table` rule\'s equal split crushed the bonus chip to the ' +
        'width of "TM Authorising"');
  const widths = /var OS_JOB_COL_WIDTHS_ = \[([^\]]+)\];/.exec(PAGE);
  check('one share per column, summing to the whole table',
        !!widths && widths[1].split(',').map(Number).length === ctx.OS_JOB_COLUMNS_.length &&
        widths[1].split(',').map(Number).reduce((a, b) => a + b, 0) === 100,
        widths ? widths[1] : 'not found');
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
  // Read through nodeOpenStatePak_ rather than straight off the map: with a
  // bonus filter on, what is open is whatever holds that person instead. The
  // map is still the answer when nothing is picked, which is the case this
  // section is about.
  check('the render re-applies them',
        /var zState = nodeOpenStatePak_\(zKey, zone\.heads\);/.test(PAGE) &&
        /var zOpen = zState\.open;/.test(PAGE) &&
        /\(zOpen \? ' expanded' : ''\)/.test(PAGE) &&
        /\(zOpen \? ' open' : ''\)/.test(PAGE));
  check('and a department too',
        /var dState = nodeOpenStatePak_\(dKey, dept\.heads\);/.test(PAGE) &&
        /var dOpen = dState\.open;/.test(PAGE));
  check('...and with nothing picked that IS the map',
        /if \(!bonusFilterOnPak_\(\)\) \{\s*\n\s*return \{ open: !!osOpenNodes\[key\], hit: false \};/.test(PAGE));
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

head('[10] Claims at 3, OS at 4, NPL at 5, the Data Table at 6');
// The rail order IS the page order - the swipe and the arrow keys move by
// index - so inserting a tab renumbers everything after it. Every list that
// counts pages has to move together or a tab navigates somewhere else.
{
  const state = R('Web - JsState.html');
  const ui = R('Web - JsUi.html');
  const index = R('Web - Index.html');
  const tour = R('Web - JsTour.html');
  const init = R('Web - JsInit.html');

  check('seven pages', /var totalPages = 7;/.test(state) &&
        /var pageDirty = \[true, true, true, true, true, true, true\];/.test(state));
  const rail = (index.match(/onclick="goToPage\((\d)\)"/g) || []).map(s => s.replace(/\D/g, ''));
  check('seven rail tabs, in order', rail.join() === '0,1,2,3,4,5,6', rail.join());
  check('the Claims tab is the fourth',
        /goToPage\(3\)" title="Potential Fraudulent Claims"/.test(index));
  check('the OS tab is the fifth', /goToPage\(4\)" title="Operational Support"/.test(index));
  check('the NPL tab is the sixth', /goToPage\(5\)" title="Non-Productive Labour"/.test(index));
  check('and the Data Table the seventh', /goToPage\(6\)" title="Data Table"/.test(index));
  // Six in the markup plus the Overall page, which is its own include.
  const pageDivs = (index.match(/<div class="page">/g) || []).length +
                   (R('Web - PageOverall.html').match(/<div class="page">/g) || []).length;
  check('there are seven .page containers, one per tab', pageDivs === 7, String(pageDivs));

  check('the dispatcher builds the Claims page at 3',
        /index === 3\) \{[\s\S]{0,400}renderFraudPagePak\(\)/.test(ui));
  check('the OS page at 4',
        /index === 4\) \{[\s\S]{0,400}renderOsPagePak\(\)/.test(ui));
  check('the NPL page at 5',
        /index === 5\) \{[\s\S]{0,400}renderNplPagePak\(\)/.test(ui));
  check('and the main table at 6',
        /index === 6\) \{\s*renderMainTablePak/.test(ui));

  // One list of page names, read by the deep link on both sides.
  check('the deep-link names agree across the two files',
        /DEEP_LINK_PAGES_ = \['overall', 'volume', 'bonus', 'fraud', 'os', 'npl', 'data'\]/.test(CODE) &&
        /DEEP_LINK_PAGES_PAK_ = \['overall', 'volume', 'bonus', 'fraud', 'os', 'npl', 'data'\]/.test(state),
        '?page=data would otherwise open the OS page');
  check('and JsInit reads the list rather than keeping a third copy',
        /DEEP_LINK_PAGES_PAK_\.indexOf\(DEEP_PAGE\)/.test(init),
        'the copy that used to sit here was missed when this page was inserted');

  // The tour walks pages by index too, and it has a chapter of its own for
  // this page - a tour that swipes straight through one on its way to the next
  // is how a whole page ends up undiscovered.
  check('the tour follows the Data Table to page 6',
        (tour.match(/page: 6,/g) || []).length === 7,
        (tour.match(/page: 6,/g) || []).length + ' step(s)');
  // NPL has no chapter, so the tour steps straight past it - which would fire
  // a REAL request for the real log in the middle of demo data unless the page
  // is parked as already-read first.
  check('and parks the NPL page so it cannot fetch mid-tour',
        /nplLogState = 'ready';/.test(tour) &&
        tour.indexOf('nplLogState = null;') > tour.indexOf("nplLogState = 'ready';"),
        'or the real NPL log would never be fetched afterwards');
  check('and has a chapter on the OS page',
        (tour.match(/part: 6, page: 4,/g) || []).length >= 3 &&
        /6: 'OS page'/.test(tour),
        (tour.match(/part: 6, page: 3,/g) || []).length + ' step(s)');
  // It walks BOTH levels, and opens them through toggleOsNode - a class set
  // behind the page's back is undone by the next render, which is the very bug
  // the open-state tracking exists to fix.
  check('the chapter reaches the department bars and the records',
        /target: '#osBody \.os-dept-row'/.test(tour) &&
        /target: '#osBody \.node-subdetail \.record-table'/.test(tour));
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
  check('a true first load is the only one that shows a skeleton',
        /if \(osLogState === null\) \{[\s\S]{0,80}osLogState = 'loading';/.test(PAGE),
        'osLogState guards which branch fetches, not whether the render happens');

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
  // A skeleton, as everywhere else on the dashboard - not a spinner, which used
  // to land on top of whatever somebody was already reading. This page fetches
  // the log on first open, so without one the first thing a new arrival sees is
  // an empty card, which reads as "nobody was on OS".
  // The markup, not just the name: page-skeleton also appears in the guard that
  // stops it being rewritten, so a looser check passed against a loading branch
  // that had stopped rendering one.
  check('it shows a skeleton while the log is on its way',
        !/fa-spin/.test(PAGE) && /osLogState === 'loading'/.test(PAGE) &&
        /'<div class="page-skeleton"/.test(PAGE),
        'an empty card and "nobody on OS" look identical otherwise');
  check('shaped like what is coming, so the page does not jump',
        PAGE.indexOf('skel-summary') !== -1 && PAGE.indexOf('skel-row') !== -1 &&
        R('Web - Styles.html').indexOf('.skel-row') !== -1);
  check('and it uses the same shimmer as every other skeleton',
        /\.skel-summary,[\s\S]{0,200}animation: skelShimmer/.test(R('Web - Styles.html')),
        'a second animation would run at its own speed beside the first');
  // Written once. A re-render while still loading - and this page re-renders on
  // every filter change - would restart every shimmer from the left.
  check('the skeleton is not rewritten on every re-render',
        /classList\.contains\('page-skeleton'\)/.test(PAGE));

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
  check('Bonus, Claims, OS and NPL are the four',
        /var PAGES_WITH_OWN_RANGE_ = \[2, 3, 4, 5\];/.test(ui));
  check('and goToPage syncs it', /syncTimeAxisControlsPak_\(index\);/.test(ui));
  check('both controls are disabled, not hidden',
        /\['hoursRange', 'timeWindow'\]/.test(ui) && /el\.disabled = off;/.test(ui),
        'hidden, the row would reflow every time you change page');
  check('the field greys with them',
        /hc-field-off/.test(ui) && R('Web - Styles.html').indexOf('.hc-field-off {') !== -1);
  // Desktop keeps the disabled field in its column so the row does not
  // reflow; at phone width there is nothing beside it for hiding it to
  // displace, and a control a thumb cannot use is not worth its row.
  check('but at phone width it is hidden outright, not just greyed',
        /@media \(max-width: 700px\) \{[\s\S]{0,2000}\.hc-field-off \{ display: none; \}/.test(R('Web - Styles.html')));
  // The claim being made: the Bonus page really does read neither.
  check('the Bonus page reads neither, which is why this is true',
        !/\$\('hoursRange'\)/.test(tables) &&
        (tables.match(/\$\('timeWindow'\)/g) || []).length === 1 &&
        /function buildMainRowDetail[\s\S]{0,120}\$\('timeWindow'\)/.test(tables),
        'the one use left is the Data Table detail row, on page 4');
  check('and the OS page reads its own selects only',
        !/hoursRange|timeWindow/.test(PAGE) && /\$\('osFrom'\)/.test(PAGE));
}

head('[18] a dashboard refresh updates the log SILENTLY after the first load');
// The dashboard's own data refreshes every few minutes, and each one used to
// reset osLogState to null - indistinguishable from a true first load - so the
// skeleton flashed over rows that were still perfectly good. osLogEverLoaded
// is what tells the two apart.
{
  const init = R('Web - JsInit.html');
  check('osLogEverLoaded is declared, defaulting to false', /var osLogEverLoaded = false;/.test(R('Web - JsState.html')));
  check('and osLogNeedsRefresh alongside it', /var osLogNeedsRefresh = false;/.test(R('Web - JsState.html')));
  check('a refresh before the first successful load still resets and skeletons',
        /if \(osLogEverLoaded\) \{\s*\n\s*osLogNeedsRefresh = true;\s*\n\s*\} else \{\s*\n\s*osLogRows = \[\];\s*\n\s*osLogSkipped = 0;\s*\n\s*osLogState = null;/
          .test(init),
        'the first load has nothing on screen to protect');
  check('a refresh after it only marks the log as needing one, and touches nothing else',
        !/osLogEverLoaded\)[\s\S]{0,20}osLogRows = \[\]/.test(init),
        'clearing the rows would blank the page for the seconds the fetch takes');

  check('ensureOsLogPak_ treats null and ready+needsRefresh as two different jobs',
        /if \(osLogState === null\) \{[\s\S]{0,500}osFetchLogPak_\(false\);/.test(PAGE) &&
        /if \(osLogState === 'ready' && osLogNeedsRefresh && !logFetchesHeldPak_\) \{[\s\S]{0,400}osFetchLogPak_\(true\);/
          .test(PAGE),
        'only the first is allowed to show loading state');
  check('the flag is cleared before the fetch starts, not after it lands',
        /osLogNeedsRefresh = false;\s*\n\s*osFetchLogPak_\(true\);/.test(PAGE),
        'a second refresh arriving mid-fetch must not queue a duplicate request');
  // Both fetches are behind the date-change hold: until the payload lands,
  // osLogWantDates_ is still reading the PREVIOUS day's timeRanges.
  check('and neither fetch runs while a date change is still in flight',
        /if \(!logFetchesHeldPak_\) osFetchLogPak_\(false\);/.test(PAGE) &&
        /osLogNeedsRefresh && !logFetchesHeldPak_/.test(PAGE),
        'fetching now asks the server for the day the reader just left');
  check('the render dispatch kicks it off, once the ready branch is confirmed',
        /if \(osLogState !== 'ready' && osLogState !== 'loading'\) \{[\s\S]{0,700}ensureOsLogPak_\(\);/.test(PAGE),
        "'loading' reaches that line on a re-read that kept its rows, and is not an error");

  // A silent fetch changes osLogState only on real success, or on failure it
  // is silently a no-op that keeps the old good data rather than replacing it
  // with an error - a first-load fetch does both, visibly.
  check('a silent success updates the rows without ever visiting "loading"',
        /function osFetchLogPak_\(silent\)/.test(PAGE) &&
        !/osFetchLogPak_[\s\S]{0,300}osLogState = 'loading'/.test(PAGE));
  check('a silent failure is swallowed, not shown',
        /if \(silent\) \{ console\.warn\('OS log background refresh failed: ' \+ message\); return; \}/
          .test(PAGE),
        'the next refresh will simply try again');
  check('but a first-load failure still names itself on screen',
        /osLogState = message;\s*\n\s*renderOsPagePak\(\);/.test(PAGE));
}

head('[19] only one filter menu can be open at a time');
// Opening Departments while Zones was still open used to leave both on
// screen - the click-away handler only closed the two it knew about, and
// neither one closed when the OTHER was opened.
{
  check('one shared slot, not a flag per menu',
        /var osOpenFilterMenu = null;/.test(R('Web - JsState.html')));
  // The menus are FOUND, not listed. This was a hand-kept array of ids, and
  // the Claims page's five were added to the page without being added to it -
  // so all five dropdowns were dead on arrival, because osFilterMenuClick_
  // only ever opens a menu whose id it is holding. Reading the DOM means a new
  // filter works the moment it is drawn.
  check('the menus are found in the DOM, not kept in a list',
        /function osFilterMenuIdsPak_\(\) \{[\s\S]{0,260}querySelectorAll\('\.filter-multi-menu'\)/.test(PAGE) &&
        !/OS_FILTER_MENU_IDS_/.test(PAGE),
        'a list is a second place to remember, and it was already one page out of date');
  check('opening one force-closes every other, in the same pass',
        /function osFilterMenuClick_\(id\) \{[\s\S]{0,260}var ids = osFilterMenuIdsPak_\(\);[\s\S]{0,160}toggleOsMenu_\(ids\[i\], ids\[i\] === id && opening\);/
          .test(PAGE));
  check('the buttons call the exclusive opener, not the bare painter',
        /onclick="osFilterMenuClick_\(\\'' \+ id \+ '\\'\)"/.test(PAGE) &&
        !/onclick="toggleOsMenu_\(\\'' \+ id \+ '\\'\)"/.test(PAGE));
  check('click-away closes whatever is open, on any page',
        /var ids = osFilterMenuIdsPak_\(\);\s*\n\s*for \(var i = 0; i < ids\.length; i\+\+\) \{\s*\n\s*toggleOsMenu_\(ids\[i\], false\);/
          .test(PAGE));
  // The one class every multi-select menu carries, which is what makes the
  // lookup above work. If the builder stopped writing it, every menu on every
  // page would go back to being unopenable.
  check('and the builder gives every menu that class',
        /class="warehouse-menu filter-multi-menu" id="' \+ id \+ '"/.test(PAGE));

  // Item 2: a selection inside an open menu rebuilds the whole filter row -
  // every toggle/clear handler calls renderOsPagePak - and used to lose the
  // open state in that rebuild. It is restored from osOpenFilterMenu now.
  check('the freshly rebuilt row re-opens whichever menu was open',
        /if \(osOpenFilterMenu\) \{ toggleOsMenu_\(osOpenFilterMenu, true\); \}/.test(PAGE),
        'a tick inside a menu used to close the very menu it was ticked in');
}

head('[20] the four filter controls match: width, and the Type chevron');
{
  const css = R('Web - Styles.html');
  check('one fixed column width for all four, not four different min-widths',
        /\.page-filter \{ width: 170px; flex: 0 0 170px; \}/.test(css),
        'Type was 120px and the three multi-selects 150px');
  check('at the SAME specificity as the mobile override, deliberately',
        !/\.page-filters \.page-filter \{ width:/.test(css),
        'an ancestor-qualified selector would have outranked the phone grid rule regardless of source order');
  check('Type is wrapped for a caret the same way the other three are',
        /<div class="filter-multi filter-type-wrap select-caret-wrap">/.test(PAGE));
  check('its native caret is switched off in favour of the FA chevron',
        /select\.hc-control\.fa-caret-select \{[\s\S]{0,200}background-image: none;/.test(css) &&
        /class="hc-control fa-caret-select filter-type-select/.test(PAGE));
  check('and the chevron is the one shared class, positioned over the select',
        /fa-solid fa-chevron-down hc-select-caret/.test(PAGE) &&
        /\.hc-select-caret \{\s*\n\s*position: absolute;/.test(css));
  check('clicks pass through the icon to the control underneath it',
        /\.hc-select-caret \{[^}]*pointer-events: none;/.test(css));
}


head('[21] the Open tab: spells nobody has closed');
// An operative starts a spell and does not finish it. There is no finish time,
// so it can never be placed on a clock - but it is not a FAULT in the record
// the way an impossible date is, and it needs a different person to do a
// different thing about it. Its own card, above the sites.
{
  const os = R('Spreadsheet - OS Log.js');
  const css = R('Web - Styles.html');

  // The mapping, pinned from the script side. A wrong index here reads a
  // populated cell, so the failure is plausible nonsense rather than an error.
  const cfg = /sheetName: 'Open',[\s\S]*?hourIdx: (\d+)/.exec(os);
  check('there is an Open config at all', !!cfg);
  check('it starts at row 8 of the Open tab',
        /sheetName: 'Open',\s*\n\s*startRow: 8,/.test(os));
  check('reading D:S, which is every column the mapping names',
        /sheetName: 'Open',[\s\S]{0,200}firstCol: 4,\s*\n\s*numCols: 16,/.test(os));
  check('A-K are D, G, O, Indirect, H, I, blank, K, M, N and a dash',
        /baseSelect: \[0, 3, 11, 'Indirect', 4, 5, '', 7, 9, 10, '-'\]/.test(os),
        'output A date, B bonus, E dept, F job, H start, I finish, J hours');
  check('N-T are Q, R, blank, S, O, P and the Open marker',
        /extraSelect: \[13, 14, '', 15, 11, 12, 'Open'\]/.test(os),
        'output N deployedBy, O reportsTo, Q status, R site, S zone, T marker');
  // Site and zone land on the same source columns the OS Form tab uses, which
  // is the check that the two tabs group under one heading rather than two.
  const form = /sheetName: 'OS Form',[\s\S]*?extraSelect: \[([^\]]+)\]/.exec(os);
  check('site and zone match the OS Form tab, so both group together',
        !!form && /11, 12,/.test(form[1]),
        form ? form[1] : 'not found');
  check('the two computed columns are dashes, having no hours to compute from',
        /calcSelect: \['-', '-'\]/.test(os));
  check('and a literal in extraSelect is written through, not used as an index',
        /const pick = spec => typeof spec === 'number' \? row\[spec\] : spec;/.test(os) &&
        /const extra = cfg\.extraSelect\.map\(pick\);/.test(os),
        'extraSelect used to be numbers only and would have read row[undefined]');

  // The marker has to survive the trip to the page.
  check('the server reads column T as the source marker',
        /source: 19/.test(CODE) && /var OS_SOURCE_OPEN_ = 'Open';/.test(CODE));
  check('and carries it on BOTH the good rows and the rejects',
        (CODE.match(/source: osLogCell_\(r, OS_LOG_COLS_\.source\)/g) || []).length === 2,
        'an unfinished spell is rejected server-side, so the rejects matter most');

  // Read off the marker, not the status cell: the marker is written by our own
  // script for every row of that tab, whatever the operative typed.
  check('the page tests the marker, not the Record Status cell',
        /function osIsOpenRecordPak_\(row\)/.test(PAGE) &&
        /String\(row && row\.source \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'open'/.test(PAGE));
  const isOpen = ctx.osIsOpenRecordPak_;
  check('an Open row is one', isOpen({ source: 'Open' }) === true);
  check('trimmed and case-insensitive, being a sheet cell',
        isOpen({ source: '  open ' }) === true);
  check('a row from either other tab is not',
        isOpen({ source: '' }) === false && isOpen({}) === false &&
        isOpen({ source: 'W' }) === false);
  check('and a Record Status of Open does NOT make one',
        isOpen({ status: 'Open', source: '' }) === false,
        'the status cell is a human typing; the marker is not');

  // Split at both the places a record can be dropped.
  check('the client sends its own drops to whichever list they belong in',
        /\(osIsOpenRecordPak_\(rec\) \? openRecords : unplaceable\)\.push/.test(PAGE));
  check('and so does the server-reject loop',
        /\(osIsOpenRecordPak_\(b\) \? openRecords : badInBuilding\)\.push\(b\);/.test(PAGE));

  // One builder for both cards, so they cannot drift apart in format.
  check('both cards come out of ONE function',
        /function osBadRowsHtmlPak_\(bad, unnamed, kindName\)/.test(PAGE) &&
        (PAGE.match(/osRenderDroppedCardPak_\('os/g) || []).length === 2);
  check('with only the heading, the icon, the key and the colour differing',
        /var OS_DROPPED_KINDS_ = \{/.test(PAGE) &&
        /key: '__open',/.test(PAGE) && /rowClass: ' os-open-row',/.test(PAGE));
  check('the heading is the one that was asked for',
        /' Open record' \+ \(n === 1 \? '' : 's'\) \+ ', Operatives need to add ' \+\s*\n\s*'finish times to these OS entries'/
          .test(PAGE));
  check('the two cards remember open/closed separately',
        /key: '__bad'/.test(PAGE) && /key: '__open'/.test(PAGE),
        'one key for both would open and close them together');

  // Above the sites, unlike the card of faults - something to go and close
  // now, not a footnote to read afterwards.
  const index = R('Web - Index.html');
  // The three indexes are required to EXIST first: a missing card gives -1,
  // which sorts before everything and made this pass by being absent.
  check('the Open card sits ABOVE the breakdown card in the markup',
        index.indexOf('id="osOpenCard"') !== -1 &&
        index.indexOf('id="osOpenCard"') < index.indexOf('id="osBody"') &&
        index.indexOf('id="osBody"') < index.indexOf('id="osBadCard"'),
        'open on top, breakdown, then the faults underneath');
  check('and is hidden until there is something in it',
        /id="osOpenCard" hidden/.test(index));
  check('its banner is tinted apart from the amber one',
        /\.os-open-row \.breakdown-label \{[\s\S]{0,120}color: var\(--accent\)/.test(css),
        'a different problem, so a different colour - not a worse fault');
}

head('[22] a control the USER moved skeletons; the clock ticking does not');
// The opposite of the silent background refresh, and for the opposite reason:
// somebody is waiting on an answer they just asked for.
{
  const data = R('Web - JsData.html');
  const ui = R('Web - JsUi.html');
  const init = R('Web - JsInit.html');

  check('there is one function for "the user moved something"',
        /function osMarkControlChangedPak_\(\) \{\s*\n\s*osLogState = null;\s*\n\s*osLogNeedsRefresh = false;/
          .test(PAGE),
        'null is the first-load path, which is the one that skeletons');
  check('it leaves the ROWS alone',
        !/function osMarkControlChangedPak_\(\)[\s\S]{0,200}osLogRows = \[\]/.test(PAGE),
        'if the re-fetch fails, what is there is still true of the window it was read for');

  check('every control-panel dropdown goes through it',
        /function handleControlChangePak[\s\S]{0,1000}osMarkControlChangedPak_\(\);/.test(data));
  check('the Warehouse picker too, but only when it actually changed',
        /if \(changed && typeof osMarkControlChangedPak_ === 'function'\)/.test(ui));
  check('and the date picker, since another day is other data entirely',
        /archiveSelect'\)\.addEventListener\('change'[\s\S]{0,2600}osMarkControlChangedPak_\(\);/
          .test(init),
        'otherwise yesterday spells swap for today under the reader, silently');
  // All three pages that hold their own logs, not just OS. The other two were
  // cleared inside renderDashboardPayload_ instead - which does not run until
  // the new day comes BACK from the server, so the page a reader was looking
  // at when they picked the date showed the old day for the whole round trip.
  check('...and so do the NPL and Claims pages',
        /archiveSelect'\)\.addEventListener\('change'[\s\S]{0,2800}nplMarkControlChangedPak_\(\);/.test(init) &&
        /archiveSelect'\)\.addEventListener\('change'[\s\S]{0,2800}fraudMarkControlChangedPak_\(\);/.test(init));
  check('and the page on screen is redrawn at once, not when the data lands',
        /redrawCurrentPagePak_\(\);/.test(init) &&
        /function redrawCurrentPagePak_\(\)/.test(ui),
        'that redraw is what puts the skeleton up at the moment of the click');
  check('all three call sites are guarded, the OS page being a separate file',
        (init + data + ui).split('osMarkControlChangedPak_').length - 1 >= 6,
        'each is a typeof test plus a call');
}

head('[23] one chevron size, and one dropdown height on a phone');
{
  const css = R('Web - Styles.html');
  const header = R('Web - Header.html');

  check('the size is stated once, as a token',
        /:root \{ --caret-size: 11px; \}/.test(css));
  check('and all three caret classes read it',
        /\.date-picker-caret,\s*\n\.warehouse-caret,\s*\n\.hc-select-caret \{ font-size: var\(--caret-size\); \}/
          .test(css));
  // Six different values had accumulated across the breakpoints, and the OS
  // page's carets matched none of them because nothing set them at all.
  check('no breakpoint overrides a caret size any more',
        !/\.warehouse-caret \{ font-size:/.test(css) &&
        !/\.date-picker-caret,\s*\n[^}]*\{ font-size: 0\./.test(css),
        'the calendar glyph still scales; the caret is furniture');

  check('Hours Range and Time Window carry the chevron now',
        (header.match(/fa-chevron-down hc-select-caret/g) || []).length === 2 &&
        (header.match(/class="select-caret-wrap"/g) || []).length === 2);
  check('and switch off the caret a native select draws for itself',
        (header.match(/row-select fa-caret-select/g) || []).length === 2 &&
        /select\.hc-control\.fa-caret-select \{[\s\S]{0,120}background-image: none;/.test(css),
        'or the two sit side by side');

  // The page dropdowns were about 34px and the control panel 30px - close
  // enough to look like a mistake rather than a choice, and both on screen at
  // once.
  const mob = mediaBlockFor(css, '#bonusAreaCount');
  check('every page dropdown is the control panel height on a phone',
        /height: 24px;\s*\n\s*min-height: 24px;/.test(mob) &&
        /\.breakdown-time-select,/.test(mob) && /#mainSortSelect,/.test(mob),
        'the From/To pair included, which is what was asked for');
  check('stated as a height, not as padding',
        /padding-top: 0;\s*\n\s*padding-bottom: 0;/.test(mob),
        'padding leaves the final number to a font that differs between them');
  // .hc-control is 38px, 30px on a phone, then 24px from the last rule in the
  // file - which carries !important and is what actually renders. The page
  // dropdowns have to match THAT, not the rule that reads first.
  check('and it is the same 24px .hc-control actually renders at',
        /\.hc-control,[\s\S]{0,300}height: 24px !important;/.test(css));
}

head('[24] a filter that is narrowing something says so');
{
  const css = R('Web - Styles.html');
  check('the three multi-selects light up when anything is picked',
        /\(picked\.length \? ' page-filter-on' : ''\)/.test(PAGE));
  check('and Type when it is not on All',
        /\(osTypeFilter === 'all' \? '' : ' page-filter-on'\)/.test(PAGE));
  check('the tint is the accent, not another status colour',
        /\.hc-control\.page-filter-on \{[\s\S]{0,140}border-color: var\(--accent\)/.test(css) &&
        /\.hc-control\.page-filter-on \{[\s\S]{0,140}background: var\(--accent-8\)/.test(css),
        'green/amber/red already mean a verdict on this page');
}

head('[25] every filter label sits beside its control, and they all line up');
// These were stacked, label over control, on every page - which cost a row of
// height per pair and, on the Bonus page, split each time-row across TWO grid
// rows so To landed a full row below From with Areas paired against From's
// label. All of them are inline now, and the alignment claim is the whole
// point: Type, Zones, Depts., Rec. Stat., Display Mode, Rows, Areas, From and
// To are built by four separate bits of code, and the only thing that makes
// their dropdowns share an edge is that every label reserves the same width.
{
  const css = R('Web - Styles.html');
  const mob = mediaBlockFor(css, '.bonus-page-controls .time-row {');

  check('one width, declared once, for all of them',
        /:root \{ --mob-label-w: \d+px; \}/.test(mob) &&
        (css.match(/--mob-label-w:\s*\d+px/g) || []).length === 1,
        'two numbers in two places is how they drift apart');
  // Each of the four families that draws a filter label. Matched against the
  // whole stylesheet rather than a extracted block: every one of these
  // selectors ALSO has a desktop rule earlier in the file, and the property
  // being looked for exists only in the mobile one - so the search cannot
  // land on the wrong copy, and does not depend on picking the right block
  // out first.
  [['the OS/NPL filters', '\\.page-filter \\.breakdown-time-label'],
   ['From and To', '\\.bonus-page-controls \\.time-row \\.breakdown-time-label'],
   ['Display Mode, Rows and Areas', '\\.bonus-control-group > label'],
   ['the Volume control', '\\.volume-controls label']
  ].forEach(([what, sel]) => {
    check(what + ' reserve that same width',
          new RegExp(sel + ' \\{[\\s\\S]{0,220}flex: 0 0 var\\(--mob-label-w\\);').test(css),
          'or its dropdown starts at an x of its own');
  });

  // Inline, not stacked - the three wrappers that used to be columns.
  check('the OS/NPL filter is a row now',
        /\.page-filter \{\s*display: flex;\s*flex-direction: row;/.test(css),
        'the desktop rule above it is the same selector set to column');
  check('so is the Bonus control group',
        /\.bonus-control-group \{\s*display: flex;\s*flex-direction: row;/.test(mob));
  check('and the time-row',
        /\.bonus-page-controls \.time-row \{[\s\S]{0,120}flex-direction: row;/.test(mob));
  check('the select fills whatever the label left, not a width of its own',
        /\.bonus-page-controls \.time-row \.breakdown-time-select \{[\s\S]{0,120}flex: 1 1 0;/.test(mob) &&
        /\.bonus-control-group > \.row-select \{\s*flex: 1 1 0;/.test(mob));
  // Areas, the odd one out among Display Mode / Rows / Areas, is what used to
  // land beside From's label. Pushed onto a row of its own so the grid's next
  // pair is From and To rather than Areas and whichever came first.
  check('Areas is pushed onto a full-width row of its own',
        /\.bonus-control-group:has\(#bonusAreaCount\) \{\s*grid-column: 1 \/ -1;/.test(mob),
        'the item before From/To in the markup, and the one the auto-flow used to pair with it');
}

head('[25b] the two long filter names abbreviate, visually only');
// "Departments" and "Record Status" do not fit beside a control in half a
// phone's width. The full word has to stay in the DOM: it is the accessible
// name, and it is still what the button underneath says when nothing is
// picked ("All Departments"), where an abbreviation would have nothing beside
// it to be understood from.
{
  const css = R('Web - Styles.html');
  const mob = mediaBlockFor(css, '.breakdown-time-label[data-short]');
  const page = R('Web - JsPageOs.html');
  const npl = R('Web - JsPageNpl.html');

  check('the short form rides on an attribute, not in the text',
        /\.breakdown-time-label\[data-short\] \{ font-size: 0; \}/.test(mob) &&
        /\.breakdown-time-label\[data-short\]::before \{\s*content: attr\(data-short\);/.test(mob));
  check('Departments abbreviates on both pages',
        /'toggleOsDeptFilter', 'clearOsDeptFilter', 'Depts\.'/.test(page) &&
        /'toggleNplDeptFilter', 'clearNplDeptFilter', 'Depts\.'/.test(npl));
  check('and Record Status on the one that has it',
        /'toggleOsStatusFilter', 'clearOsStatusFilter', 'Rec\. Stat\.'/.test(page));
  check('the full word is still what the markup carries',
        /'<span class="breakdown-time-label"' \+\s*\n\s*\(short \? ' data-short="' \+ escapeAttrPak\(short\)/.test(page) &&
        /'>' \+ title \+ '<\/span>'/.test(page),
        'the abbreviation is a display swap; the DOM text is the real name');
  check('and the button below it still says the full one',
        /var label = picked\.length === 0 \? 'All ' \+ title/.test(page));
}

head('[26] Display Mode reads the same weight on Volume as it does on Bonus');
// Same text everywhere already - "Display Mode:", capital M, both pages - so
// what differed was never the wording, it was the WEIGHT: Bonus goes medium
// at phone width and Volume stayed at the browser default, which is visibly
// lighter once the two are on screen one after another.
{
  const css = R('Web - Styles.html');
  // Anchored on font-weight AND margin-right:0 close together, which only the
  // MOBILE rule has - the desktop one carries margin-right:8px and no
  // font-weight at all, so this cannot match that occurrence by accident.
  check('Volume label is medium weight at phone width',
        /\.volume-controls label \{[\s\S]{0,80}font-weight: 500;[\s\S]{0,40}margin-right: 0;/.test(css));
  check('matching the weight Bonus already carries there',
        /\.bonus-control-group > label \{[\s\S]{0,80}font-weight: 500;/.test(css),
        'the two rules should read the same number, not merely both be non-default');
}

head('[27] Hours Range is dead on the Data Table, but Time Window is not');
// The Data Table draws all 96 blocks of the day whatever Hours Range says (see
// generateMainRows_), and DOES read Time Window, which is what aggregates its
// rows. So the two controls stopped being switchable together: each carries
// its own list of the pages it is dead on.
{
  const ui = R('Web - JsUi.html');
  check('the two lists are separate',
        /hoursRange: PAGES_WITH_OWN_RANGE_\.concat\(\[6\]\)/.test(ui) &&
        /timeWindow: PAGES_WITH_OWN_RANGE_(?!\.concat)/.test(ui),
        'Time Window must stay live on the Data Table - it is what aggregates it');
  check('and each control is judged against its own',
        /var off = PAGES_IGNORING_\[ids\[i\]\]\.indexOf\(index\) !== -1;/.test(ui),
        'one `off` for both is what made them inseparable');
  check('the tooltip does not claim a range picker the page has not got',
        /index === 6 \? 'The Data Table always shows the whole day'/.test(ui) &&
        /index === 3 \? 'This page covers one production day, 06:00 to 06:00'/.test(ui),
        '"this page has its own From / To" is a plain untruth on either');
}

head('[28] Rearrange is inert where there is nothing to rearrange');
// The mode covers every panel in an edit bar and puts a persistent toast up.
// Both are invisible on a page with no panels, so it would sit switched on
// with nothing to show for it.
{
  const ro = R('Web - JsReorder.html');
  const ui = R('Web - JsUi.html');
  const css = R('Web - Styles.html');

  check('the pages are DERIVED from the zones, not listed again',
        /page: 0 \}/.test(ro) && /page: 1 \}/.test(ro) && /page: 2 \}/.test(ro) &&
        /REORDER_PAGES_ = REORDER_ZONES_\.map/.test(ro),
        'a second list is how PAGE_SLUGS came to be two pages out of date');
  check('the button goes disabled off them',
        /btn\.disabled = !has;/.test(ro) &&
        /\.header-icon-btn\[disabled\] \{[\s\S]{0,120}pointer-events: none;/.test(css));
  check('...but never while the mode is ON',
        /if \(btn && !_reorderMode\) \{/.test(ro),
        'disabling Done would strand somebody mid-edit where they cannot leave');
  check('and the mode refuses to open there anyway',
        /if \(!_reorderMode && !reorderPageHasPanelsPak_\(currentPage\)\) return;/.test(ro),
        'the tour drives the toggle directly, past the button');
  check('one hook, on the one path every page change takes',
        /syncReorderForPagePak_\(index\);/.test(ui) &&
        (ui.match(/syncReorderForPagePak_\(/g) || []).length === 1);
}

head('[29] leaving the charts mid-edit closes the mode on a countdown');
// A swipe past a page is not a decision - Claims, OS and NPL all sit between
// Bonus and the Data Table, so crossing from one chart page to the other can
// cross three the mode is dead on.
{
  const ro = R('Web - JsReorder.html');
  check('ten seconds, named once',
        /var REORDER_LEAVE_SECONDS_ = 10;/.test(ro));
  check('the toast is red, being a countdown to something happening unwatched',
        /kind: 'warn',/.test(ro) &&
        /\.toast-warn \.toast-text \{\s*color: var\(--color-bad\);/.test(R('Web - Styles.html')));
  check('the count starts on leaving',
        /\} else \{\s*startReorderLeavePak_\(\);/.test(ro));
  check('and is cancelled by coming back before it ends',
        /if \(has\) \{[\s\S]{0,220}cancelReorderLeavePak_\(\);\s*showRearrangeToast_\('Back to the charts\.'\)/.test(ro),
        'and says so, rather than silently swapping the toast back');
  check('a second page change does not restart it',
        /if \(_reorderLeaveTimer\) return;\s*\/\/ already counting/.test(ro),
        'crossing OS then NPL would otherwise give five fresh seconds each');
  check('the end of the count is what saves',
        /cancelReorderLeavePak_\(\);[\s\S]{0,200}setReorderMode_\(false\);/.test(ro) &&
        /captureChartOrder_\(\);/.test(ro));
  check('the text counts down in place rather than re-showing the toast',
        /text\.textContent = reorderLeaveMessagePak_\(_reorderLeaveLeft\);/.test(ro),
        'five slide-ins reads as five toasts, not one counting down');
  check('and the toast offers the same exit its countdown would reach',
        /label: 'Save now'/.test(ro));
}

head('[30] the share export knows which page it is on');
// One stale four-entry list gave three wrong answers at once: ?page=data from
// the OS page, a file named e3-data-..., and "Data Table" across the caption.
{
  const sh = R('Web - JsShare.html');
  check('the slugs are the deep-link list, not a copy of it',
        /var PAGE_SLUGS = \(typeof DEEP_LINK_PAGES_PAK_ !== 'undefined'\)\s*\?\s*DEEP_LINK_PAGES_PAK_/.test(sh));
  check('the caption has a name for all seven pages',
        (/PAGE_TITLES_ = \[([\s\S]*?)\];/.exec(sh) || [0, ''])[1]
          .split(',').length === 7);
  check('Claims, OS and NPL are among them',
        /'Potential Fraudulent Claims', 'Operational Support',\s*\n\s*'Non-Productive Labour'/.test(sh));
  check('and the caption reads that list rather than one of its own',
        /var pageName = PAGE_TITLES_\[currentPage\] \|\| '';/.test(sh));
  // The capture was being cut off mid-card with a band of empty panel below.
  check('an open breakdown is pinned open for the capture',
        /page\.querySelectorAll\('\.breakdown-detail\.open'\)/.test(sh) &&
        /animation: 'none', maxHeight: 'none', overflow: 'visible'/.test(sh),
        'html2canvas clones the document, and the clone re-runs the 300px animation');
  check('and put back by the same restore the ancestors use',
        /relax\(opened\[d\], \{/.test(sh),
        'a capture that throws must not leave the page pinned open');
}

head('[31] a bonus filter opens and marks the rows holding that person');
// With a filter on, these pages are being read for one question - where is
// that person - and leaving the reader to open zones one at a time hunting
// for a row four levels down is the page refusing to answer it.
{
  ctx.selectedBonuses = [];
  ctx.osOpenNodes = {};
  check('with nothing picked, the reader\'s own state is what is open',
        ctx.bonusFilterOnPak_() === false &&
        ctx.nodeOpenStatePak_('k', ['AAA']).open === false);
  ctx.osOpenNodes = { k: true };
  check('...including what they had opened',
        ctx.nodeOpenStatePak_('k', ['AAA']).open === true);

  ctx.selectedBonuses = ['BBB'];
  check('with one picked, a branch holding them opens',
        ctx.nodeOpenStatePak_('other', ['AAA', 'BBB']).open === true);
  check('and is marked as the reason it opened',
        ctx.nodeOpenStatePak_('other', ['AAA', 'BBB']).hit === true,
        'opened-and-unmarked is ambiguous once more than one row is open');
  check('a branch without them closes, whatever the reader had done',
        ctx.nodeOpenStatePak_('k', ['AAA']).open === false,
        'k is in osOpenNodes, and the filter still wins');
  check('...and is not marked',
        ctx.nodeOpenStatePak_('k', ['AAA']).hit === false);
  check('an empty branch never counts as a hit',
        ctx.hasPickedBonusPak_([]) === false &&
        ctx.hasPickedBonusPak_(null) === false);

  // The undo. This is the whole reason the state is DERIVED, not written.
  ctx.selectedBonuses = [];
  check('clearing the filter restores exactly what the reader had',
        ctx.nodeOpenStatePak_('k', ['AAA']).open === true &&
        ctx.nodeOpenStatePak_('other', ['AAA', 'BBB']).open === false,
        'nothing to restore - osOpenNodes was never written to');
  check('and the filter path never writes that map',
        !/function nodeOpenStatePak_[\s\S]{0,400}osOpenNodes\[[^\]]+\] =/.test(PAGE),
        'writing it would make the filter impossible to undo');
  ctx.osOpenNodes = {};

  check('both levels carry their head list out of the grouping',
        /heads: Object\.keys\(z\.heads\)/.test(PAGE) &&
        /heads: Object\.keys\(d\.heads\)/.test(PAGE),
        'the count draws the bar; the list is what answers the filter');
  check('the row says so in a class of its own',
        /\(zState\.hit \? ' bonus-hit-row' : ''\)/.test(PAGE) &&
        /\(dState\.hit \? ' bonus-hit-row' : ''\)/.test(PAGE) &&
        /\.breakdown-row\.bonus-hit-row \{/.test(R('Web - Styles.html')));
  check('marked in the accent, not a verdict colour',
        /\.breakdown-row\.bonus-hit-row \{[\s\S]{0,160}var\(--accent-8\)/.test(R('Web - Styles.html')),
        'green, amber and red already mean a decision on both those pages');
  const npl = R('Web - JsPageNpl.html');
  check('the NPL page shares the rule rather than copying it',
        /nodeOpenStatePak_\(dKey, dept\.heads\)/.test(npl) &&
        !/function nodeOpenStatePak_/.test(npl));
}

head('[32] a bonus filter widens the range to cover that person');
// Opening the rows that hold somebody is no use if the From / To they are
// outside of has already dropped them: a filter on, a highlight promised, and
// an empty card.
{
  // A pair of selects over four quarter-hours, the way the real ones are
  // filled: the value IS the block, and both ends are read off it.
  function selects(n) {
    const mk = (i) => {
      const h = 8 + Math.floor(i / 4), m = (i % 4) * 15;
      const e = (m === 45) ? [h + 1, 0] : [h, m + 15];
      const p = (x) => String(x).padStart(2, '0');
      return '09/09/2026 ' + p(h) + ':' + p(m) + ' - 09/09/2026 ' + p(e[0]) + ':' + p(e[1]);
    };
    const opts = [];
    for (let i = 0; i < n; i++) opts.push({ value: mk(i) });
    return { options: opts, selectedIndex: 0, get value() { return this.options[this.selectedIndex].value; } };
  }
  const from = selects(8), to = selects(8);
  to.selectedIndex = 1;
  ctx.$ = (id) => (id === 'osFrom' ? from : id === 'osTo' ? to : null);
  ctx.selectedBonuses = [];
  ctx._bonusRangePak_ = {};

  const row = (b, f, t) => ({ bonus: b, date: '09/09/2026', from: f, to: t });
  const rows = [row('AAA', '08:20', '09:10'), row('BBB', '08:00', '08:10')];

  // Nothing picked: the pickers are left exactly alone.
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  check('with nothing picked the range is untouched',
        from.selectedIndex === 0 && to.selectedIndex === 1);

  ctx.selectedBonuses = ['AAA'];
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  check('picking someone widens From to the block their first record starts in',
        from.options[from.selectedIndex].value.indexOf('08:15') !== -1,
        from.options[from.selectedIndex].value);
  check('...and To to the block their last record ends in',
        to.options[to.selectedIndex].value.indexOf('09:00 - 09/09/2026 09:15') !== -1,
        to.options[to.selectedIndex].value);

  // Re-running while the SAME person is picked must not fight a manual change.
  from.selectedIndex = 0;
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  check('a manual change while filtered survives the next draw',
        from.selectedIndex === 0,
        'a range re-imposed every render would make the pickers unusable');

  // Clearing gives back what the reader had, not what the filter left.
  ctx.selectedBonuses = [];
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  check('clearing restores the reader\'s own range',
        from.options[from.selectedIndex].value.indexOf('08:00') !== -1 &&
        to.selectedIndex === 1,
        from.options[from.selectedIndex].value + ' / ' + to.selectedIndex);
  check('and forgets it, so the next filter saves afresh',
        !ctx._bonusRangePak_.os);

  // Picking a SECOND person must not "restore" to the first pick's widening.
  ctx.selectedBonuses = ['AAA'];
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  ctx.selectedBonuses = ['AAA', 'BBB'];
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  check('a second pick widens again without re-saving',
        from.options[from.selectedIndex].value.indexOf('08:00') !== -1,
        'BBB starts at 08:00, so the pair has to reach back to it');
  ctx.selectedBonuses = [];
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', rows);
  check('...and clearing still gives back the ORIGINAL range',
        to.selectedIndex === 1,
        'saving on every pick would have restored to the first widening');

  check('a picked bonus that cannot be placed on a clock moves nothing',
        (function () {
          ctx.selectedBonuses = ['NOPE'];
          const a = from.selectedIndex, b = to.selectedIndex;
          ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', [row('NOPE', 'zz', 'zz')]);
          const same = from.selectedIndex === a && to.selectedIndex === b;
          ctx.selectedBonuses = [];
          ctx._bonusRangePak_ = {};
          return same;
        })(),
        'widening to a span that does not exist would be worse than not widening');

  check('OS and NPL keep their own saved range',
        /applyBonusRangePak_\('os', 'osFrom', 'osTo'/.test(PAGE) &&
        /applyBonusRangePak_\('npl', 'nplFrom', 'nplTo'/.test(R('Web - JsPageNpl.html')));
  check('and it runs after the options exist, before the window is read',
        /ensureOsTimeSelects_\(\);[\s\S]{0,140}applyBonusRangePak_\('os'[\s\S]{0,120}var win = osSelectedWindowPak_\(\);/.test(PAGE));
  delete ctx.$;
}

head('[33] the sort control is the sixth filter, and the carets line up');
{
  const css = R('Web - Styles.html');
  const INDEX = R('Web - Index.html');
  check('the Claims sort sits in the grid as a filter, not a strip of its own',
        /<div class="page-filter fraud-sort-filter">/.test(INDEX) &&
        !/\.fraud-sort-mobile \{ grid-column: 1 \/ -1; \}/.test(css));
  check('and it is named, like the five above it',
        /<span class="breakdown-time-label">Sort by<\/span>/.test(INDEX));
  check('hidden where the column headings do the sorting',
        /\.fraud-sort-filter \{ display: none; \}/.test(css));
  check('the Data Table\'s sort is named too',
        /<span class="main-sort-label">Sort by<\/span>/.test(INDEX) &&
        /\.main-sort-label \{/.test(css));
  // One number for every caret in the control panel. They were at 27px, 9px
  // and 12px - three values in one row of six controls.
  check('one inset, declared once',
        /:root \{ --caret-inset: 9px; \}/.test(css) &&
        (css.match(/--caret-inset:\s*\d+px/g) || []).length === 1);
  check('the overlaid carets are moved to it',
        /\.hc-select-caret \{[\s\S]{0,120}right: var\(--caret-inset\);/.test(css),
        'the <select> overlay is the only one of the four that CAN be moved');
  // The Date button was grouped with #bonusSearch for its SIZING and took
  // that field's 26px of right padding with it - room for a search icon it
  // has not got, which is what pushed its caret 27px in while the rest sat
  // at 9. Four !important rules set that padding, so the fix is to stop
  // asking for it rather than to out-rank them.
  // Scanned per RULE - split on the closing brace - rather than with a window
  // wide enough to cover one, which reaches into the rule after it and reads
  // that rule's padding as this one's. That mistake has been made twice in
  // this file already.
  const rulesWithBoth = css.split('}').filter(
    r => r.indexOf('#datePickerBtn') !== -1 && r.indexOf('padding-right: 26px') !== -1);
  check('and the Date button no longer takes the search field\'s padding',
        rulesWithBoth.length === 0,
        'that padding is the search icon\'s, and the Date button has no icon on that side');
  const searchKeeps = css.split('}').filter(
    r => r.indexOf('#bonusSearch') !== -1 && r.indexOf('padding-right: 26px') !== -1);
  check('...while the search field keeps it', searchKeeps.length === 3,
        'the normal size, the scrolled one and the phone - was ' + searchKeeps.length);
}

head('[34] a class is named for what it IS, not for where it was born');
// Every one of these components started on the OS page and was then reused -
// by NPL, by Claims, or by all three - and kept the os- prefix it was born
// with. A Claims dropdown reading `os-multi` in the inspector is a lie about
// what the thing is, and the next person to touch it pays for that.
{
  const npl = R('Web - JsPageNpl.html');
  const fraud = R('Web - JsPageFraud.html');
  const index = R('Web - Index.html');
  const css = R('Web - Styles.html');
  const everything = PAGE + npl + fraud + index + css;
  const tok = (hay, t) =>
    (hay.match(new RegExp('(?<![A-Za-z0-9-])' + t + '(?![A-Za-z0-9-])', 'g')) || []).length;

  // The shared ones, by their new names. Each has to exist and be styled.
  [['filter-multi', 'the multi-select'],
   ['page-filter', 'the filter column'],
   ['record-table', 'the record table'],
   ['status-chip', 'the verdict chip'],
   ['bonus-chip', 'the bonus chip'],
   ['page-skeleton', 'the loading skeleton'],
   ['node-detail', 'an expanded node'],
   ['bad-record-table', 'the unreadable records']
  ].forEach(([cls, what]) => {
    check(what + ' is called ' + cls,
          tok(css, '\\.' + cls) > 0 && tok(PAGE + npl + fraud + index, cls) > 0,
          'a rule and at least one user');
  });

  // And none of them answers to the old name any more, anywhere.
  const gone = ['os-multi', 'os-filter', 'os-filters', 'os-job-table', 'os-job',
                'os-status', 'os-bonus-chip', 'os-body', 'os-skeleton',
                'os-skel-row', 'os-cell-none', 'os-time-cell', 'os-controls',
                'os-zone-detail', 'os-dept-detail', 'os-zone-bar', 'os-bad-table',
                'os-dropped-row', 'data-os-key'];
  gone.forEach(cls => {
    check('nothing is called ' + cls + ' any more', tok(everything, cls) === 0,
          tok(everything, cls) + ' left');
  });

  // The OS page's OWN furniture keeps the prefix, because there it is true.
  ['os-site', 'os-open-card', 'os-tag', 'os-dept-row'].forEach(cls => {
    check(cls + ' keeps it, being genuinely the OS page\'s', tok(everything, cls) > 0);
  });
  check('...and none of those leaked onto another page',
        tok(npl + fraud, 'os-site') === 0 && tok(npl + fraud, 'os-open-card') === 0,
        'a page-specific class on another page is the same lie the other way round');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
