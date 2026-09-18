// The NPL page — a breakdown of who is on Non-Productive Labour, read from the
// NPL log rather than from the pivot.
//
// The OS page's twin, and the same two joins are the dangerous part for the
// same reasons (see the header of test_ospage.js): the log's COLUMN POSITIONS,
// picked by index in 'Spreadsheet - NPL Log.js' so a dropped source column
// shifts everything after it and reads a populated cell rather than erroring;
// and the PRODUCTION DAY, 06:00 to 06:00, which puts a night shift a day out
// when it is read as a calendar date.
//
// A third thing matters here that did not there: this page is built ON the OS
// page's parts rather than beside them. The spell walk, the range picker, the
// multi-select and the bar animation are shared, and the value of sharing them
// is entirely lost the moment somebody copies one back. So the reuse is pinned
// too - by name, and by the absence of a second definition.
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
// Every <td> a builder writes carries a data-label the shared mobile CSS reads
// once the real header hides on a phone - a cell with none would render with
// no label at all, and nobody testing at a desktop width would ever see it.
const cellsAndLabels = src => (src.match(/<td[^>]*>/g) || []).length ===
                               (src.match(/data-label="/g) || []).length &&
                               (src.match(/data-label="/g) || []).length > 0;
const nl = R('Web - JsPageNpl.html').indexOf('\r\n') === -1 ? '\n' : '\r\n';

const ctx = { console, document: undefined };
vm.createContext(ctx);
vm.runInContext(strip(R('Web - JsHelpers.html')), ctx);
vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], ctx);
// In this order, and it matters: the NPL page calls into the OS one.
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);
vm.runInContext(strip(R('Web - JsPageNpl.html')), ctx);
ctx.selectedBonuses = [];

const CODE = R('Web - Code.js');
const SCRIPT = R('Spreadsheet - NPL Log.js');
const PAGE = R('Web - JsPageNpl.html');
const OSPAGE = R('Web - JsPageOs.html');
const INDEX = R('Web - Index.html');

// A logged record as readNplLogRows_ hands it over.
const rec = (o) => Object.assign({
  date: '09/09/2026', bonus: 'AAA', dept: 'Inbound', task: 'Cleaning',
  from: '07:26', to: '08:06', siteTransfer: 'No', tmAuth: 'J Ashworth',
  check: 'OK'
}, o || {});

head('[1] the log columns, which are the fragile part');
// Pinned from BOTH sides: the indices Code.js reads, and the layout the Apps
// Script writes. Either alone can drift without the other noticing.
{
  const m = /var NPL_LOG_COLS_ = \{([\s\S]*?)\};/.exec(CODE);
  check('Code.js declares the column map', !!m);
  const cols = {};
  if (m) {
    m[1].replace(/(\w+):\s*(\d+)/g, (_, k, v) => { cols[k] = Number(v); return ''; });
  }
  // A Date, B Bonus, C Department, D Task, F Site Transfer, H Start,
  // I Finish, K TM authorised, M Check.
  const want = {
    date: 0, bonus: 1, dept: 2, task: 3, siteTransfer: 5,
    start: 7, finish: 8, tmAuth: 10, check: 12
  };
  Object.keys(want).forEach(k => {
    check(k + ' is column ' + String.fromCharCode(65 + want[k]),
          cols[k] === want[k], 'declared ' + cols[k]);
  });
  check('nothing else is declared', Object.keys(cols).length === Object.keys(want).length,
        Object.keys(cols).join());
  check('the read is 16 columns wide, A:P',
        /var NPL_LOG_WIDTH_ = 16;/.test(CODE) &&
        /var NPL_LOG_FIRST_ROW_ = 7;/.test(CODE));
  // The writer's own width, from the other side of the join.
  check('and the script writes exactly that many',
        /var NPL_SELECT_ = \[0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17\];/.test(SCRIPT),
        '16 source columns -> A:P');
  check('the sheet is found case-insensitively',
        /var NPL_LOG_SHEET_NAME_ = 'npl log';/.test(CODE) &&
        /findSheetLower_\(ss, NPL_LOG_SHEET_NAME_\)/.test(CODE),
        'a capital L either way would otherwise empty the page with nothing to say why');
  check('and the OS read was moved onto the same finder rather than keeping its own',
        (CODE.match(/function findSheetLower_/g) || []).length === 1 &&
        /findSheetLower_\(ss, OS_LOG_SHEET_NAME_\)/.test(CODE));
}

head('[2] the page is built on the OS page, not copied from it');
// The whole point of the arrangement. Each of these exists once; a second
// definition is a copy that will drift, and the geometry in some of them was
// got exactly right only after being measured on a live chart.
{
  // Two lists. The first are called from this page by name; the second are
  // reached THROUGH those - osSpellWalkPak_ is what osSpellWindowPak_ is, and
  // osLogMinsPak_ is what parses the times inside it - so a copy of either
  // would be just as much of a drift hazard without this page ever naming it.
  const called = ['osSpellWindowPak_', 'osSpellProblemPak_', 'osPassesSetPak_',
                  'osUniqueValuesPak_', 'osLabelPak_', 'osByCountThenNamePak_',
                  'osPersonCellPak_', 'osMultiSelectHtmlPak_', 'toggleOsMenu_',
                  'osApplyBarsPak_', 'osNodeKeyPak_', 'toggleOsNode',
                  'osRowTimeTextPak_', 'osPureBonusesPak_', 'osLogWantDates_',
                  'ensureTimeSelectsPak_', 'selectedWindowPak_'];
  const reached = ['osSpellWalkPak_', 'osLogMinsPak_'];
  called.concat(reached).forEach(fn => {
    const defs = (OSPAGE + PAGE).match(new RegExp('function ' + fn + '\\b', 'g')) || [];
    check(fn + ' is defined once', defs.length === 1, defs.length + ' definition(s)');
  });
  called.forEach(fn => {
    check('  ...and the NPL page calls ' + fn, PAGE.indexOf(fn) !== -1);
  });
  check('the NPL page is included AFTER the OS one',
        INDEX.indexOf("include('Web - JsPageNpl')") >
        INDEX.indexOf("include('Web - JsPageOs')"),
        'or none of the above would be defined when this file loads');
  // The two wrappers that keep the OS page's own call sites - and its test
  // suite - reading exactly as they did.
  check('the OS names survive as one-line wrappers',
        /function ensureOsTimeSelects_\(\) \{ ensureTimeSelectsPak_\('osFrom', 'osTo'\); \}/.test(OSPAGE) &&
        /function osSelectedWindowPak_\(\) \{ return selectedWindowPak_\('osFrom', 'osTo'\); \}/.test(OSPAGE));
  check('and the NPL page passes its own ids',
        /ensureTimeSelectsPak_\('nplFrom', 'nplTo'\)/.test(PAGE) &&
        /selectedWindowPak_\('nplFrom', 'nplTo'\)/.test(PAGE));
}

head('[3] the production day, inherited whole');
// Not re-derived here - it is osSpellWalkPak_ doing the work - but asserted
// anyway, because "the NPL page uses the shared walker" and "the NPL page
// places a 01:00 spell on the right day" are two different claims and only the
// second one is what anybody cares about.
{
  const w = ctx.osSpellWindowPak_(rec({ date: '16/09/2026', from: '01:00', to: '02:00' }));
  check('16/09 01:00-02:00 is placed on the 17th',
        !!w && w.start.getDate() === 17 && w.finish.getDate() === 17,
        w ? w.start.toString() : 'not placed');
  const d = ctx.osSpellWindowPak_(rec({ date: '16/09/2026', from: '14:00', to: '15:00' }));
  check('and a daytime spell stays on its own date',
        !!d && d.start.getDate() === 16);
  const over = ctx.osSpellWindowPak_(rec({ date: '16/09/2026', from: '22:00', to: '02:00' }));
  check('22:00-02:00 runs into the next morning',
        !!over && over.finish.getDate() === 17 && over.finish - over.start === 4 * 3600000);
  check('and a shift past the 16-hour cap is dropped, not drawn across the day',
        ctx.osSpellWindowPak_(rec({ from: '06:00', to: '05:00' })) === null);
}

head('[4] grouping: department -> task -> records');
// No site and no zone: the NPL log has neither column, so the page has one
// level of bar rather than OS's site heading and two.
{
  // Inbound is the busier department AND the alphabetically later one, and
  // its head count (2) differs from both its task count (3) and its record
  // count (4). All three on purpose: with them equal, counting records instead
  // of heads and sorting by name instead of by size both pass by coincidence.
  const g = ctx.nplGroupPak_([
    rec({ bonus: 'A', dept: 'Inbound', task: 'Cleaning' }),
    rec({ bonus: 'A', dept: 'Inbound', task: 'Training', from: '09:00' }),
    rec({ bonus: 'A', dept: 'Inbound', task: 'Sorting', from: '10:00' }),
    rec({ bonus: 'B', dept: 'Inbound', task: 'Cleaning' }),
    rec({ bonus: 'C', dept: 'Ambient', task: 'Cleaning' })
  ]);
  check('two departments', g.length === 2, g.map(d => d.name).join());
  check('the busier one leads', g[0].name === 'Inbound', g.map(d => d.name).join());
  check('counted in unique bonus numbers, not records',
        g[0].count === 2, 'counted ' + g[0].count + ' from 4 records over 3 tasks');
  check('its tasks are named and sorted',
        g[0].tasks.map(t => t.name).join() === 'Cleaning,Sorting,Training',
        g[0].tasks.map(t => t.name).join());
  check('and hold their own records', g[0].tasks[0].records.length === 2);
  // Earliest first, so a task reads as a timeline.
  const t = ctx.nplGroupPak_([
    rec({ bonus: 'B', from: '10:00' }), rec({ bonus: 'A', from: '08:00' })
  ])[0].tasks[0];
  check('records within a task run earliest first',
        t.records[0].from === '08:00', t.records[0].from);
  check('a blank department is named rather than dropped',
        ctx.nplGroupPak_([rec({ dept: '' })])[0].name === '(no department)',
        'the record under it is real');
  check('and a blank task likewise',
        ctx.nplGroupPak_([rec({ task: '  ' })])[0].tasks[0].name === '(no task)');
}

head('[5] Check is shown as logged, and only OK is signed off');
// Deliberately NOT the OS fold. OS Record Status has a known vocabulary off a
// form with three meanings behind it; NPL's Check is a free cell whose exact
// wording is the whole content of the column, and folding it would rename
// somebody's answer to something they did not write.
{
  check('OK is green', /nplCheckIsOkPak_\(raw\) \? 'status-chip-good' : 'status-chip-bad'/.test(PAGE));
  const chip = w => ctx.nplCheckChipPak_(w);
  check('...and says OK', chip('OK').indexOf('>OK<') !== -1);
  check('anything else is red, verbatim',
        chip('Needs review').indexOf('status-chip-bad') !== -1 &&
        chip('Needs review').indexOf('>Needs review<') !== -1,
        chip('Needs review'));
  check('including a wording that merely contains ok',
        chip('not ok').indexOf('status-chip-bad') !== -1, chip('not ok'));
  check('case and padding do not change the verdict',
        chip('  ok  ').indexOf('status-chip-good') !== -1);
  check('a blank is a dash, not an accusation',
        chip('').indexOf('status-chip-none') !== -1 &&
        chip('').indexOf('&ndash;') !== -1,
        'calling an unchecked record failed is a claim the data does not support');
  check('the chart band shares the same test',
        /function nplCheckIsOkPak_/.test(R('Web - JsHelpers.html')) &&
        /nplCheckIsOkPak_\(check\)/.test(R('Web - JsCharts.html')),
        'or the colour in the table and the colour under the chart could disagree');
  // Text is escaped: the Check cell is free text off a form.
  check('and the wording is escaped',
        chip('<b>x</b>').indexOf('<b>') === -1, chip('<b>x</b>'));
}

head('[6] the Check filter values, and their order');
{
  const vals = ctx.nplCheckValuesPak_([
    rec({ check: 'Needs review' }), rec({ check: '' }), rec({ check: 'OK' }),
    rec({ check: 'Adjusted' }), rec({ check: 'OK' })
  ]);
  check('signed off first, then everything that was not, then the blanks',
        vals.join(' | ') === 'OK | Adjusted | Needs review | No check',
        vals.join(' | '));
  check('a blank becomes a named option rather than vanishing',
        ctx.nplCheckValuePak_(rec({ check: '   ' })) === 'No check');
  check('and the filter reads the same value the option was built from',
        /osPassesSetPak_\(nplCheckFilter, nplCheckValuePak_\(r\)\)/.test(PAGE),
        'filtering on something the reader cannot see is a list nobody can match');
}

head('[7] the four filters, and the cascade');
// Departments -> Task -> Check. A stale downstream selection has to be cleared
// the moment its upstream changes, or it goes on filtering by a value its own
// dropdown no longer offers - invisible, because the picked count is read
// against the new narrower list and shows "All" while excluding everything.
{
  check('Departments clears Task and Check',
        /function toggleNplDeptFilter\([\s\S]{0,200}nplTaskFilter = \{\};[\s\S]{0,60}nplCheckFilter = \{\};/.test(PAGE));
  check('Task clears Check',
        /function toggleNplTaskFilter\([\s\S]{0,200}nplCheckFilter = \{\};/.test(PAGE));
  // Sliced to the function's OWN body rather than matched with a windowed
  // regex: a window wide enough to cover this function also reaches into
  // clearNplDeptFilter below it, where a filter reset is exactly right.
  const bodyOf = (src, name) => {
    const at = src.indexOf('function ' + name + '(');
    return at === -1 ? '' : src.slice(at, src.indexOf(nl + '  }', at));
  };
  check('and Check clears nothing, being last',
        /renderNplPagePak\(\);/.test(bodyOf(PAGE, 'toggleNplCheckFilter')) &&
        !/Filter = \{\};/.test(bodyOf(PAGE, 'toggleNplCheckFilter')),
        bodyOf(PAGE, 'toggleNplCheckFilter').slice(0, 60));
  check('clearing Departments clears both below it',
        /function clearNplDeptFilter\(\) \{\s*nplDeptFilter = \{\};\s*nplTaskFilter = \{\};\s*nplCheckFilter = \{\};/.test(PAGE));
  // The options each dropdown offers are narrowed by the one above it.
  check('Departments is built from the whole window',
        /osUniqueValuesPak_\(inWindow, 'dept', 'department'\)/.test(PAGE));
  check('Tasks from what the chosen departments left',
        /var rowsForTask = inWindow\.filter[\s\S]{0,600}osUniqueValuesPak_\(rowsForTask, 'task', 'task'\)/.test(PAGE));
  check('and Checks from what the chosen tasks left',
        /var rowsForCheck = rowsForTask\.filter[\s\S]{0,600}nplCheckValuesPak_\(rowsForCheck\)/.test(PAGE));
  // Type is about the PERSON across the window, so it is judged before the
  // record filters narrow anything.
  check('Type is All / Pure NPL / Multi Tasks',
        /NPL_TYPE_LABELS_ = \{ all: 'All', pure: 'Pure NPL', multi: 'Multi Tasks' \}/.test(PAGE));
  check('and is judged off the pivot, which is the only thing that knows about productive work',
        /var productive = osPureBonusesPak_\(win\);/.test(PAGE));
  check('an empty set means NO filter, not nothing',
        ctx.osPassesSetPak_({}, 'anything') === true,
        'the first click on a fresh dropdown emptying the page reads as broken');
  check('there is no Zones filter, there being no zone column',
        !/nplZoneFilter|osZoneFilter|r\.zone/.test(PAGE));
  check('and the four menus are the four',
        (PAGE.match(/osMultiSelectHtmlPak_\('npl/g) || []).length === 3 &&
        /'nplDeptMenu', 'Departments'/.test(PAGE) &&
        /'nplTaskMenu', 'Tasks'/.test(PAGE) &&
        /'nplCheckMenu', 'Checks'/.test(PAGE));
}

head('[8] the record table');
// Bonus | Time | Site Transfer | TM authorised | Check, and the widths have to
// sum to 100 - one task is one table and a department can hold a dozen of them
// down the page, so they have to agree with each other on where a column sits.
{
  const cols = /var NPL_TASK_COLUMNS_ = \[([\s\S]*?)\];/.exec(PAGE);
  check('the five columns, in order',
        !!cols && cols[1].replace(/['\s\n\r]/g, '') ===
          'Bonus,Time,SiteTransfer,TMauthorised,Check',
        cols ? cols[1].replace(/\s+/g, ' ') : 'not declared');
  const w = /var NPL_TASK_COL_WIDTHS_ = \[([\d,\s]+)\];/.exec(PAGE);
  const nums = w ? w[1].split(',').map(Number) : [];
  check('five widths', nums.length === 5, String(nums.length));
  check('summing to 100', nums.reduce((a, b) => a + b, 0) === 100,
        String(nums.reduce((a, b) => a + b, 0)));
  check('the bonus is clickable, like every other bonus number on the dashboard',
        /toggleBonusFilter\(/.test(PAGE) && /bonus-tip-host clickable-bonus/.test(PAGE));
  check('the time reads as clock times without the date',
        /osRowTimeTextPak_\(r\)/.test(PAGE),
        'the date is on the page range picker; repeating it crowds the row');
  check('Site Transfer and TM authorised fall back to a dash when blank',
        /osPersonCellPak_\(r\.siteTransfer\)/.test(PAGE) &&
        /osPersonCellPak_\(r\.tmAuth\)/.test(PAGE));

  // The table becomes a stack of cards on a phone - one .record-table CSS rule
  // in Web - Styles.html covers both pages, which is only true if this table
  // is built with the SAME class and the SAME data-label convention the OS
  // page's cells use. Not redeclared here; borrowed.
  check('built with the class the shared mobile card CSS targets',
        /<table class="record-table">/.test(PAGE));
  check('every task cell carries the label the hidden header used to show',
        cellsAndLabels(PAGE.slice(PAGE.indexOf('function nplTaskTableHtmlPak_'),
                                   PAGE.indexOf('function nplBadRowsHtmlPak_'))));
}

head('[9] the records that reach no figure are named, not counted');
// An NPL record with an impossible date or a nineteen-hour shift is a real
// form somebody filled in wrongly. "7 records could not be read" with no way
// to find out which seven is a dead end.
{
  check('every row carries its sheet row number from the server',
        /row: NPL_LOG_FIRST_ROW_ \+ i,/.test(CODE) &&
        (CODE.match(/row: NPL_LOG_FIRST_ROW_ \+ i,/g) || []).length === 2,
        'on the good rows as well as the rejected ones, or a client-side drop cannot be named');
  check('the client keeps the reason with the record',
        /why: osSpellProblemPak_\(rec\) \|\| 'it cannot be placed on a clock'/.test(PAGE));
  check('the reason rides on the row rather than costing a column',
        /b\.why \? ' title="' \+ escapeAttrPak\(b\.why\)/.test(PAGE));
  const bad = /var NPL_BAD_COLUMNS_ = \[([\s\S]*?)\];/.exec(PAGE);
  check('the card names the record in NPL\'s own columns',
        !!bad && bad[1].replace(/['\s\n\r]/g, '') ===
          'Bonus,Date,Start,Finish,Department,Task,TMauthorised,Check',
        bad ? bad[1].replace(/\s+/g, ' ') : 'not declared');
  check('server rejects and client drops go in one list',
        /nplRenderDroppedCardPak_\(unplaceable\.concat\(nplLogBad \|\| \[\]\)/.test(PAGE));
  check('and the residual is counted once, not twice',
        /Math\.max\(0, \(Number\(nplLogSkipped\) \|\| 0\) - \(nplLogBad \|\| \[\]\)\.length\)/.test(PAGE),
        'the heading said eight and the note said "8 more", which read as sixteen');
  check('the card hides itself when there is nothing to show',
        /card\.hidden = !html;/.test(PAGE));
  // No Open card: the NPL log has no Source column to split on.
  check('there is no Open card, there being no Source column to split on',
        !/osIsOpenRecordPak_|OS_SOURCE_OPEN_/.test(PAGE));
  check('every bad-record cell carries its label too',
        cellsAndLabels(PAGE.slice(PAGE.indexOf('function nplBadRowsHtmlPak_'),
                                   PAGE.indexOf('function renderNplPagePak'))));
}

head('[10] fetch once, refresh silently');
// Two call sites, two different appetites for interruption. A FIRST load has
// nothing on screen, so a skeleton is honest. Every refresh after is the
// dashboard's own window moving on, and flashing a skeleton over rows that are
// still perfectly readable is worse than showing them a minute stale.
{
  check('null means never fetched, distinct from an empty result',
        /var nplLogState = null;/.test(R('Web - JsState.html')),
        '"nobody was on NPL" and "not here yet" are the same empty array');
  check('a true first load shows the skeleton',
        /if \(nplLogState === null\) \{\s*nplLogState = 'loading';/.test(PAGE));
  check('a later refresh is marked, not flashed',
        /if \(nplLogEverLoaded\) \{\s*nplLogNeedsRefresh = true;/.test(R('Web - JsInit.html')));
  check('and the flag is cleared BEFORE the fetch, not after',
        /nplLogNeedsRefresh = false;\s*nplFetchLogPak_\(true\);/.test(PAGE),
        'or a second refresh arriving in flight queues a duplicate request');
  check('a silent failure keeps what is on screen',
        /if \(silent\) \{ console\.warn\('NPL log background refresh failed: ' \+ message\); return; \}/.test(PAGE),
        'the next refresh will simply try again');
  check('a control the USER moved does show the skeleton',
        /function nplMarkControlChangedPak_\(\) \{\s*nplLogState = null;/.test(PAGE) &&
        /nplMarkControlChangedPak_\(\);/.test(R('Web - JsData.html')),
        'a page that sits still for a second looks like it ignored the click');
  check('the skeleton is written once, not on every render',
        /!body\.firstChild\.classList\.contains\('page-skeleton'\)/.test(PAGE),
        'or every shimmer restarts from the left');
  check('an error is named rather than left as an empty page',
        /escapeTextPak_\(nplLogState\)/.test(PAGE));
  check('and the log read degrades rather than failing the load',
        /Logger\.log\('NPL log unreadable: ' \+ e\.message\);/.test(CODE));
  check('the server caches on the dates asked for',
        /'nplLog_v1_' \+ \(archiveUrl \? 'a' : 'l'\) \+ '_' \+ keys\.join\(','\)/.test(CODE),
        'a different window must not be served a stale answer');
  check('and it is its own key, not the OS one',
        !/'osLog_v1_' \+ [\s\S]{0,200}getNplLogRows/.test(CODE) &&
        (CODE.match(/'nplLog_v1_'/g) || []).length === 1);
}

head('[11] the open/closed rows survive a re-render, and cannot collide with OS');
// The page polls. A refresh used to collapse whatever you were reading.
{
  check('the keys carry an npl segment',
        /osNodeKeyPak_\('npl', dept\.name\)/.test(PAGE) &&
        /osNodeKeyPak_\('npl', '__bad'\)/.test(PAGE),
        'or a department of the same name on both pages would share a slot');
  check('which is what lets one map serve both',
        ctx.osNodeKeyPak_('npl', 'Inbound') !== ctx.osNodeKeyPak_('os', 'Inbound') &&
        /nodeOpenStatePak_\(dKey, dept\.heads\)/.test(PAGE),
        'read through the OS page\'s state helper, which falls back to that map');
  check('and the shared toggle is the one on the rows',
        /onclick="toggleOsNode\(this\)"/.test(PAGE) &&
        !/function toggleNplNode/.test(PAGE));
}

head('[12] the warehouse picker is not silently ignored');
// The NPL log has no Site column, so the Warehouse picker cannot narrow this
// page. That is a fact about the data, and the file says so where somebody
// wondering why the picker does nothing would look.
{
  check('no building filter is applied',
        !/osInBuildingPak_/.test(PAGE));
  check('and the file says why, rather than leaving it to be rediscovered',
        /no Site column/i.test(PAGE) || /has no Site/i.test(PAGE));
  check('but a building switch still re-reads the log',
        /nplMarkControlChangedPak_\(\);/.test(R('Web - JsUi.html')),
        'the window it was read for can still have moved');
  // The card sits flush against the breakdown above it otherwise - the page
  // has no grid gap of its own here - and read as part of the same box rather
  // than as its own, separately-expandable card. The OS page's twin already
  // carries this; it was missed when this one was built from it.
  check('the dropped-record card is separated from the breakdown above it',
        /#osBadCard, #nplBadCard \{ margin-top: 16px; \}/.test(R('Web - Styles.html')));
}

head('[13] the page summary counts what the page is about');
{
  check('heads on NPL, counted unique',
        /breakdown-summary-label">on NPL</.test(PAGE) &&
        /heads\[rows\[h\]\.bonus\] = true;/.test(PAGE));
  check('tasks, not zones',
        />task' \+ \(taskCount === 1 \? '' : 's'\)/.test(PAGE) &&
        !/>zone/i.test(PAGE),
        'the .os-zone-* CLASS names are reused for the styling; no zone is read');
  check('and records', />record' \+ \(rows\.length === 1 \? '' : 's'\)/.test(PAGE));
  check('the empty state says NPL, not OS',
        /Nobody on NPL in the selected range/.test(PAGE));
  check('and nothing on this page says OS to the reader',
        !/>[^<]*\bOS\b/.test(PAGE.replace(/\/\/[^\n]*/g, '')),
        'the comments discuss the OS page; the page does not');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
