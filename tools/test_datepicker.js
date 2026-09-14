// Date-picker tests. The widget is DOM code, so it runs against a stub DOM
// small enough to be obvious and real enough to catch the things that actually
// break: date parsing, what the search matches, and whether picking a day
// writes back through the hidden <select> that everything else reads.
const fs = require('fs'), vm = require('vm');
// Paths are resolved from this file, not hardcoded, so the checks run from any
// clone. The Databricks and Tampermonkey repos are expected as SIBLINGS of this
// one - that is how they sit on the machine this pipeline is maintained from.
const path = require('path');
const REPOS = path.resolve(__dirname, '..', '..');

const APPS = path.resolve(__dirname, '..') + path.sep;
// Normalised to LF on read: this file slices JsUi on multi-line markers,
// and a checkout under core.autocrlf=true hands back a CRLF working copy -
// which made those markers stop matching without one line of the dashboard
// having changed.
const R = f => fs.readFileSync(APPS + f, 'utf8').replace(/\r\n/g, '\n');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

// ── a DOM just big enough ────────────────────────────────────────────────────
function el(id) {
  return {
    id, innerHTML: '', value: '', title: '', textContent: '',
    options: [], selectedIndex: 0, attrs: {}, classes: {}, events: [],
    classList: {
      toggle(c, on) { this.__o[c] = !!on; },
      contains(c) { return !!this.__o[c]; },
      __o: {},
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { this.events.push([t, fn]); },
    dispatchEvent(e) { this.__dispatched = e && e.type; return true; },
    querySelector() { return null; },
    focus() { this.__focused = true; },
    scrollIntoView() {},
  };
}

const nodes = {};
['archiveSelect', 'datePickerBtn', 'datePickerLabel', 'dateMenu', 'calGrid', 'calTitle']
  .forEach(id => { nodes[id] = el(id); nodes[id].classList.__o = {}; });

// "Today" is now a day the calendar offers, so what today IS decides what the
// grid contains - and a suite whose expectations move at midnight is a suite
// that fails on a date nobody chose. Pinned to a Monday in a month with no
// archives in the fixture below, which is the interesting case: the only
// pickable day in September is today.
const REAL_DATE = Date;
const TODAY = [2026, 8, 14];            // 14 September 2026
function FakeDate() {
  return arguments.length
    ? new REAL_DATE(...arguments)
    : new REAL_DATE(TODAY[0], TODAY[1], TODAY[2]);
}
FakeDate.prototype = REAL_DATE.prototype;

const ctx = {
  console,
  Date: FakeDate,
  $: id => nodes[id] || null,
  safeTextPak: s => String(s),
  escapeAttrPak: s => String(s).replace(/"/g, '&quot;'),
  document: { addEventListener() {} },
  window: { matchMedia: () => ({ matches: false }) },
  Event: function (type) { this.type = type; },
};
vm.createContext(ctx);

// Pull just the picker out of JsUi so an unrelated DOM call elsewhere in the
// file cannot fail the run.
const ui = R('Web - JsUi.html');
const from = ui.indexOf('  // ── The date picker');
const to = ui.indexOf('  document.addEventListener(\'click\', function (e) {\n    var menu = $(\'dateMenu\');');
if (from === -1 || to === -1) { console.log('picker block not found'); process.exit(1); }
vm.runInContext(ui.slice(from, to), ctx);
const ev = e => vm.runInContext(e, ctx);

// ── the archive list the server would send ───────────────────────────────────
const DAYS = ['18/08/2026', '17/08/2026', '12/08/2026', '31/07/2026', '02/03/2025'];
nodes.archiveSelect.options = [{ value: '', textContent: 'Live' }].concat(
  DAYS.map(d => ({ value: 'https://docs.google.com/x/' + d.replace(/\//g, '-'), textContent: d })));
nodes.archiveSelect.value = '';
nodes.archiveSelect.selectedIndex = 0;

head('[1] archive names parse');
check('dd/MM/yyyy parses', ev("dateOptionParts_('12/08/2026').long") === 'Wednesday 12 August 2026',
      ev("dateOptionParts_('12/08/2026').long"));
check('short form', ev("dateOptionParts_('12/08/2026').short") === 'Wed 12 Aug',
      ev("dateOptionParts_('12/08/2026').short"));
check('month heading', ev("dateOptionParts_('31/07/2026').month") === 'July 2026',
      ev("dateOptionParts_('31/07/2026').month"));
check('Live is not a date', ev("dateOptionParts_('Live')") === null, '');
check('junk is not a date', ev("dateOptionParts_('Loading History...')") === null, '');
check('impossible date rejected', ev("dateOptionParts_('99/99/2026')") === null, '');
check('31 September rejected', ev("dateOptionParts_('31/09/2026')") === null, '');
check('29 Feb on a leap year kept', ev("dateOptionParts_('29/02/2024').short") === 'Thu 29 Feb',
      ev("dateOptionParts_('29/02/2024') && dateOptionParts_('29/02/2024').short"));

head('[2] the calendar grid');
// The widget is a month grid now, not a searchable list. What has to hold is
// that only days WITH an archive are choosable, that the shape of the month is
// right, and that browsing months never invents a day.
const cells = () => (nodes.calGrid.innerHTML.match(/<(button|span)[^>]*class="cal-cell[^"]*"/g) || []);
const pickable = () => (nodes.calGrid.innerHTML.match(/data-cal="[^"]*"/g) || []).map(m => m.slice(10, -1));

ev('_calMonth = new Date(2026, 7, 1)');   // August 2026
ev('renderDateMenu_()');

check('title names the month', nodes.calTitle.textContent === 'August 2026', nodes.calTitle.textContent);
// August 2026 starts on a Saturday, so Monday-first gives 5 leading blanks.
check('31 day cells plus leading blanks', cells().length === 31 + 5, '= ' + cells().length);
check('leading blanks land the 1st on Saturday',
      (nodes.calGrid.innerHTML.match(/cal-blank/g) || []).length === 5,
      '= ' + (nodes.calGrid.innerHTML.match(/cal-blank/g) || []).length);
check('only archived days are choosable',
      pickable().join() === '2026-08-12,2026-08-17,2026-08-18',
      pickable().join());
check('days without an archive are not buttons',
      nodes.calGrid.innerHTML.indexOf('<button type="button" class="cal-cell cal-disabled') === -1, '');
check('unarchived days are still shown',
      (nodes.calGrid.innerHTML.match(/cal-disabled/g) || []).length === 31 - 3,
      '= ' + (nodes.calGrid.innerHTML.match(/cal-disabled/g) || []).length);

// A month with no archives at all still renders, and offers only today.
ev('_calMonth = new Date(2026, 8, 1)');   // September 2026
ev('renderDateMenu_()');
check('a month with no archives offers only today', pickable().join() === '2026-09-14',
      pickable().join());
check('and still draws its 30 days',
      (nodes.calGrid.innerHTML.match(/cal-cell/g) || []).length >= 30,
      '= ' + (nodes.calGrid.innerHTML.match(/cal-cell/g) || []).length);

head('[2a] today is a day you can pick, and it means Live');
// It used to be excluded for having no ARCHIVE entry, which greyed out the one
// date people open this calendar to get back to and put the "today" ring on a
// dead cell. Worse, the Today button only moved the VIEW - so on today's own
// month, the month the calendar already opens on, it did nothing at all and
// read as broken. That is what was reported.
{
  const avail = () => ev('JSON.stringify(calAvailable_())') && JSON.parse(ev('JSON.stringify(calAvailable_())'));
  check('today is in the available map', '2026-09-14' in avail(), Object.keys(avail()).join());
  check('and picking it means Live, not an archive', avail()['2026-09-14'] === '',
        JSON.stringify(avail()['2026-09-14']));
  check('today is a button, not a dead span',
        /<button[^>]*data-cal="2026-09-14"/.test(nodes.calGrid.innerHTML), '');
  check('and is not marked unavailable',
        !/data-cal="2026-09-14"[^>]*cal-disabled/.test(nodes.calGrid.innerHTML) &&
        !/cal-disabled[^"]*"[^>]*data-cal="2026-09-14"/.test(nodes.calGrid.innerHTML), '');
  check('it still carries the today marker', /cal-today/.test(nodes.calGrid.innerHTML), '');

  // On Live, the grid used to highlight nothing whatsoever.
  nodes.archiveSelect.value = '';
  ev('renderDateMenu_()');
  check('on Live, today is the selected cell',
        /data-cal="2026-09-14"/.test(nodes.calGrid.innerHTML) &&
        (nodes.calGrid.innerHTML.match(/cal-selected/g) || []).length === 1,
        '= ' + (nodes.calGrid.innerHTML.match(/cal-selected/g) || []).length + ' selected');

  // Clicking it goes to Live rather than doing nothing.
  nodes.archiveSelect.value = 'https://docs.google.com/x/12-08-2026';
  nodes.archiveSelect.__dispatched = null;
  ev("pickDate_(calAvailable_()['2026-09-14'])");
  check('picking today returns the dashboard to Live', nodes.archiveSelect.value === '',
        JSON.stringify(nodes.archiveSelect.value));
  check('and actually reloads', nodes.archiveSelect.__dispatched === 'change', '');

  // An archive cut for today, if one ever exists, must keep the cell - or the
  // day becomes unreachable.
  const saved = nodes.archiveSelect.options;
  nodes.archiveSelect.options = saved.concat(
    [{ value: 'https://docs.google.com/x/14-09-2026', textContent: '14/09/2026' }]);
  check('an archive for today wins over Live',
        avail()['2026-09-14'] === 'https://docs.google.com/x/14-09-2026',
        String(avail()['2026-09-14']));
  nodes.archiveSelect.options = saved;
  nodes.archiveSelect.value = '';
}

head('[2a2] one footer action, and it works from today\'s own month');
{
  // The delegated listener the real page binds at startup.
  ev('initDatePicker_()');
  const menu = nodes.dateMenu;
  const handler = (menu.events.find(e => e[0] === 'click') || [])[1];
  check('the menu has a click handler', typeof handler === 'function', '');

  const header = R('Web - Header.html');
  check('Clear is gone', header.indexOf('data-cal-action="clear"') === -1,
        'it meant "back to Live" without saying so, which is what Today now does');
  check('one action button remains',
        (header.match(/data-cal-action=/g) || []).length === 1,
        '= ' + (header.match(/data-cal-action=/g) || []).length);
  check('and it names both things it does', /Today \(Live\)/.test(header), '');

  if (typeof handler === 'function') {
    // The reported case exactly: already on this month, already the month the
    // calendar opens on. The old code re-rendered the same view and stopped.
    ev('_calMonth = new Date(2026, 8, 1); renderDateMenu_();');
    nodes.archiveSelect.value = 'https://docs.google.com/x/12-08-2026';
    nodes.archiveSelect.__dispatched = null;
    const btn = { getAttribute: () => 'today' };
    handler({ target: { closest: s => (s === '[data-cal-action]' ? btn : null) } });
    check('pressing it on today\'s month returns to Live',
          nodes.archiveSelect.value === '', JSON.stringify(nodes.archiveSelect.value));
    check('and is not a silent no-op', nodes.archiveSelect.__dispatched === 'change',
          'the whole bug was a button that did nothing visible');
    check('the menu closes behind it', nodes.dateMenu.classList.contains('open') === false, '');
    nodes.archiveSelect.value = '';
  }
}

head('[2b] month navigation');
ev('_calMonth = new Date(2026, 7, 1); renderDateMenu_();');
ev('calShiftMonth_(-1)');
check('back a month', nodes.calTitle.textContent === 'July 2026', nodes.calTitle.textContent);
check('July offers its one archived day', pickable().join() === '2026-07-31', pickable().join());
ev('calShiftMonth_(1)');
ev('calShiftMonth_(1)');
check('forward across the year holds', nodes.calTitle.textContent === 'September 2026', nodes.calTitle.textContent);
// December -> January is where a naive month counter breaks.
ev('_calMonth = new Date(2026, 11, 1); renderDateMenu_(); calShiftMonth_(1);');
check('December rolls into January', nodes.calTitle.textContent === 'January 2027', nodes.calTitle.textContent);

head('[2c] the selected day is marked');
nodes.archiveSelect.value = 'https://docs.google.com/x/12-08-2026';
ev('_calMonth = new Date(2026, 7, 1)');
ev('renderDateMenu_()');
check('selected day carries the class',
      /class="cal-cell cal-selected[^"]*" data-cal="2026-08-12"/.test(nodes.calGrid.innerHTML) ||
      /data-cal="2026-08-12"/.test(nodes.calGrid.innerHTML) && nodes.calGrid.innerHTML.indexOf('cal-selected') !== -1, '');
check('exactly one day is selected',
      (nodes.calGrid.innerHTML.match(/cal-selected/g) || []).length === 1,
      '= ' + (nodes.calGrid.innerHTML.match(/cal-selected/g) || []).length);
nodes.archiveSelect.value = '';

head('[3] picking writes through the select');
ev('renderDateMenu_()');
const target = 'https://docs.google.com/x/12-08-2026';
nodes.archiveSelect.__dispatched = null;
ev(`pickDate_(${JSON.stringify(target)})`);
check('select takes the value', nodes.archiveSelect.value === target, nodes.archiveSelect.value);
check('a change event is fired', nodes.archiveSelect.__dispatched === 'change',
      String(nodes.archiveSelect.__dispatched));
check('the menu closes', nodes.dateMenu.classList.contains('open') === false, '');

nodes.archiveSelect.selectedIndex = 3;   // 12/08/2026
ev('syncDateUi_()');
check('button shows the day', nodes.datePickerLabel.textContent === 'Wed 12 Aug',
      nodes.datePickerLabel.textContent);
check('history state is marked', nodes.datePickerBtn.classList.contains('is-history'), '');
check('aria says the full date',
      /Wednesday 12 August 2026/.test(nodes.datePickerBtn.getAttribute('aria-label')),
      nodes.datePickerBtn.getAttribute('aria-label'));

nodes.archiveSelect.__dispatched = null;
ev(`pickDate_(${JSON.stringify(target)})`);
check('re-picking the same day does not reload', nodes.archiveSelect.__dispatched === null,
      'no change event, so no archive read');

nodes.archiveSelect.selectedIndex = 0;
nodes.archiveSelect.value = '';
ev('syncDateUi_()');
check('back to Live clears the state', !nodes.datePickerBtn.classList.contains('is-history'), '');
check('button reads Live', nodes.datePickerLabel.textContent === 'Live', nodes.datePickerLabel.textContent);

head('[4] the rest of the app still reads the select');
{
  const share = R('Web - JsShare.html');
  check('share link still reads archiveSelect', share.indexOf("$('archiveSelect')") !== -1, '');
  const init = R('Web - JsInit.html');
  check('the change listener is still on the select',
        /\$\('archiveSelect'\)\.addEventListener\('change'/.test(init), '');
  check('the picker is initialised', init.indexOf('initDatePicker_') !== -1, '');
  const header = R('Web - Header.html');
  check('the select is hidden, not removed', /id="archiveSelect" class="date-native"/.test(header), '');
  const styles = R('Web - Styles.html');
  check('no CSS still targets the old select by id',
        styles.indexOf('#archiveSelect') === -1, '');
  const tour = R('Web - JsTour.html');
  check('the tour points at the button', tour.indexOf("target: '#datePickerBtn'") !== -1, '');
  check('the tour no longer points at the select', tour.indexOf("'#archiveSelect'") === -1, '');
}

head('[5] the 14-day cap is gone');
{
  const code = R('Web - Code.js');
  check('no cutoff date', code.indexOf('cutoffDate') === -1, '');
  check('links use the chunked cache', code.indexOf("cachePutLarge_('archiveLinks_v2'") !== -1, '');
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
