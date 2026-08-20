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
const R = f => fs.readFileSync(APPS + f, 'utf8');

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
['archiveSelect', 'datePickerBtn', 'datePickerLabel', 'dateMenu', 'dateMenuSearch', 'dateMenuList']
  .forEach(id => { nodes[id] = el(id); nodes[id].classList.__o = {}; });

const ctx = {
  console,
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

head('[2] the search');
const search = q => {
  nodes.dateMenuSearch.value = q;
  ev('renderDateMenu_()');
  return (nodes.dateMenuList.innerHTML.match(/data-value="[^"]*"/g) || [])
    .map(m => m.slice(12, -1)).filter(v => v);
};
check('empty query lists every day', search('').length === DAYS.length, '= ' + search('').length);
check('numeric day', search('12/08').length === 1, search('12/08').join());
check('month name', search('aug').length === 3, '= ' + search('aug').length);
check('weekday name', search('monday').length === 1, '= ' + search('monday').length);
check('year narrows to that year', search('2025').length === 1, '= ' + search('2025').length);
check('two terms are AND', search('aug 2026').length === 3, '= ' + search('aug 2026').length);
check('no match yields none', search('zzz').length === 0, '');
check('Live survives every search',
      nodes.dateMenuList.innerHTML.indexOf('data-value=""') !== -1, 'still offered after a no-match query');
search('');
check('one heading per month, none for Live',
      (nodes.dateMenuList.innerHTML.match(/date-menu-month/g) || []).length === 3,
      'expect Aug 2026, Jul 2026, Mar 2025');

head('[3] picking writes through the select');
nodes.dateMenuSearch.value = '';
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
