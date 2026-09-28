// A custom From/To span, as an alternative to picking one archive day once
// Live is left: getDashboardDataRange (Web - Code.js) reads it, possibly
// across several days, and the client disables Hours Range while it is
// active - the span already says both ends, and reading Hours Range's stale
// value regardless would silently re-narrow a multi-day range down to
// however many hours it was last left at.
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

const CODE = R('Web - Code.js');
const INIT = R('Web - JsInit.html');
const UI = R('Web - JsUi.html');
const DATA = R('Web - JsData.html');

// ── the server ───────────────────────────────────────────────────────────
const p2 = n => String(n).padStart(2, '0');
const cacheStore = {};
const cacheStub = {
  putAll(map) { Object.keys(map).forEach(k => { cacheStore[k] = map[k]; }); },
  getAll(keys) {
    const out = {};
    keys.forEach(k => { out[k] = Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; });
    return out;
  },
  get(k) { return Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; }
};
const sctx = {
  console, JSON, Date, Math, String, Number, Object, Array, isNaN, parseInt, parseFloat, RegExp, Error,
  Logger: { log() {} },
  CacheService: { getScriptCache: () => cacheStub },
  Session: { getScriptTimeZone: () => 'Europe/London' },
  Utilities: { formatDate: (d, tz, f) => p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() +
                                         (/HH:mm/.test(f) ? ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) : '') }
};
vm.createContext(sctx);
vm.runInContext(CODE, sctx);

const AREAS = sctx.PROC_AREA_COLUMNS_;
const HEADER = ['Date', 'Hour', 'BONUS']
  .concat(AREAS.map(a => a.stdHeader)).concat([sctx.PROC_TOTAL_HEADER_])
  .concat(AREAS.map(a => a.volHeader)).concat([sctx.PROC_OS_HEADER_, sctx.PROC_OS_TIME_HEADER_]);
function srow(d, h, m, bonus, value) {
  const blk = new Date(2026, 8, d, h, m);
  const r = [sctx.formatDateTimeRange_(blk, new Date(blk.getTime() + 900000)), h, bonus];
  AREAS.forEach((a, i) => r.push(i === 0 ? (value == null ? 0.25 : value) : 0));
  r.push(value == null ? 0.25 : value);
  AREAS.forEach((a, i) => r.push(i === 0 ? 10 : 0));
  r.push('NO', '');
  return r;
}
function sheetFile(rows, b2) {
  const lines = [HEADER.join('|')].concat(rows.map(r => r.join('|')));
  const backend = { getName: () => 'Backend', getLastRow: () => lines.length,
                    getRange: () => ({ getDisplayValues: () => lines.map(l => [l]) }) };
  const cells = { A2: 0.05, B2: b2 || new Date(2026, 8, 21, 0, 0), G3: '' };
  const front = { getRange: c => ({ getValue: () => cells[c], getDisplayValue: () => String(cells[c]) }) };
  const source = { getLastRow: () => rows.length + 1 };
  return { getSheets: () => [backend],
           getSheetByName: n => (n === 'Front' ? front : n === 'Processed Data (15mins)' ? source : null) };
}
const FILES = {
  U19: sheetFile([srow(19, 20, 0, 'AAA'), srow(19, 23, 0, 'AAA')]),
  U20: sheetFile([srow(20, 8, 0, 'AAA'), srow(20, 20, 0, 'BBB')]),
  // 21/09 has no archive yet - it is "today", read from the live file.
  LIVE: sheetFile([srow(21, 1, 0, 'CCC'), srow(21, 8, 0, 'DDD'), srow(21, 8, 45, 'DDD')])
};
const opened = [];
sctx.SpreadsheetApp = {
  openByUrl: u => { opened.push(u); if (!FILES[u]) throw new Error('no file ' + u); return FILES[u]; },
  getActiveSpreadsheet: () => { opened.push('LIVE'); return FILES.LIVE; }
};
sctx.getArchiveLinks = () => [{ name: '19/09/2026', url: 'U19' }, { name: '20/09/2026', url: 'U20' }];
const decode = p => sctx.decodeSideRowsPak_ ? sctx.decodeSideRowsPak_(p.rawSideData, p.sideSchema) : null;
// Code.js has no client-side decoder - decode with the schema directly.
function rowsOf(payload) {
  const t = payload.sideSchema.text, b = payload.sideSchema.bool, n = payload.sideSchema.num;
  return payload.rawSideData.map(row => {
    const e = {}; let c = 0;
    for (let i = 0; i < t.length; i++, c++) { if (row[c]) e[t[i]] = row[c]; }
    for (let j = 0; j < b.length; j++, c++) { e[b[j]] = row[c] === 1; }
    for (let k = 0; k < n.length; k++, c++) { e[n[k]] = row[c] || 0; }
    return e;
  });
}
const names = rows => rows.map(r => r.bonus + '@' + r.timeRange.slice(0, 16)).sort().join(', ');

head('[1] a span crossing days reads each day from the right place');
{
  opened.length = 0;
  const p = sctx.getDashboardDataRange('20/09/2026 14:00', '21/09/2026 09:00');
  const rows = rowsOf(p);
  check('20/09 20:00 comes from that day\'s archive', rows.some(r => r.bonus === 'BBB'));
  check('20/09 08:00 is excluded - before the "from" time', !rows.some(r => r.bonus === 'AAA' && r.timeRange.startsWith('20/09')));
  check('21/09, not yet archived, comes from the live file',
        rows.some(r => r.bonus === 'CCC') && rows.some(r => r.bonus === 'DDD'));
  check('the archive is opened exactly once', opened.filter(u => u === 'U20').length === 1, opened.join(', '));
  check('the window is exactly the requested span, to the quarter hour',
        p.timeRanges[0] === '20/09/2026 14:00 - 20/09/2026 14:15' &&
        p.timeRanges[p.timeRanges.length - 1] === '21/09/2026 08:45 - 21/09/2026 09:00',
        p.timeRanges[0] + ' .. ' + p.timeRanges[p.timeRanges.length - 1]);
  // AAA is real, but entirely before 14:00 on the 20th - outside this span,
  // so its absence here is the "from" boundary working, not a miss.
  check('the bonus list covers every day touched, not just one', p.bonusList.join() === 'BBB,CCC,DDD', p.bonusList.join());
  check('threshold comes from the live Front sheet regardless of the dates asked for', p.threshold === 0.05);
  check('says which span it is, for the header', p.lastRefresh === '20/09/2026 14:00 to 21/09/2026 09:00', p.lastRefresh);
  check('no archiveDate/nextDayRows - this is not an archive-window payload',
        p.archiveDate === undefined && p.nextDayRows === undefined);
}

head('[2] the trailing edge is trimmed exactly as a normal load is');
{
  // Ask well past the last real row on 21/09 (08:45) - the rest of that day
  // has not been produced yet, and must not pad the table with empty rows.
  const p = sctx.getDashboardDataRange('21/09/2026 06:00', '21/09/2026 18:00');
  check('cut back to the last block that actually has hours, not out to 18:00',
        p.timeRanges[p.timeRanges.length - 1] === '21/09/2026 08:45 - 21/09/2026 09:00',
        p.timeRanges[p.timeRanges.length - 1]);
}

head('[3] a doomed request is refused before it opens anything');
{
  const throws = (a, b) => { try { sctx.getDashboardDataRange(a, b); return null; } catch (e) { return e.message; } };
  check('to before from', /to must be after from/.test(throws('21/09/2026 09:00', '20/09/2026 14:00')));
  check('not a real date', /not dd\/MM\/yyyy HH:mm/.test(throws('2026-09-20 14:00', '21/09/2026 09:00')));
  check('a span past the cap', (() => {
    const msg = throws('01/01/2026 00:00', '01/03/2026 00:00');
    return /over the 31-day limit/.test(msg || '');
  })(), throws('01/01/2026 00:00', '01/03/2026 00:00'));
  opened.length = 0;
  throws('21/09/2026 09:00', '20/09/2026 14:00');
  check('and nothing was opened for a request that was always going to fail', opened.length === 0);
}

// ── the client ───────────────────────────────────────────────────────────
const ctx = { console, Event };
vm.createContext(ctx);
vm.runInContext(strip(R('Web - JsHelpers.html')), ctx);
vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], ctx);
const initSlice = strip(INIT);
vm.runInContext(initSlice.slice(initSlice.indexOf('function decodeSideRowsPak_'),
                                initSlice.indexOf('var PAYLOAD_CACHE_KEY')), ctx);
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);
vm.runInContext(strip(R('Web - JsData.html')), ctx);
vm.runInContext(strip(R('Web - JsTables.html')), ctx);
Object.assign(ctx, {
  selectedBonuses: [], currentThreshold: 0, currentMainRows: [], pageRenderCtx: null,
  trendSplitState: { enabled: false, charts: [] }, tourActive: false, currentPage: 0,
  invalidateChartCommon_() {}, markAllPagesDirty_() {}, renderPageIfNeeded_() {},
  saveUserPreferences() {}, archiveView: null, viewStretch: { before: [], after: [], rows: [], needsEdge: false }
});
const ui = { hoursRange: '3', timeWindow: '15', sharedRowsLimit: '10' };
ctx.$ = id => (id in ui ? { value: ui[id] } : null);
const fmt = d => ctx.formatDatePak(d);
const blk = (d, h, m) => { const s = new Date(2026, 8, d, h, m); return fmt(s) + ' - ' + fmt(new Date(s.getTime() + 900000)); };
function fullRange(fromD, fromH, toD, toH) {
  const out = [];
  for (let t = new Date(2026, 8, fromD, fromH).getTime(); t < new Date(2026, 8, toD, toH).getTime(); t += 900000) {
    out.push(fmt(new Date(t)) + ' - ' + fmt(new Date(t + 900000)));
  }
  return out;
}
function row(bonus, d, h, m) { return { bonus, timeRange: blk(d, h, m), value: 0.25 }; }

head('[4] the whole span is read, Hours Range or not');
{
  const list = fullRange(20, 14, 22, 9);        // 43 hours, well past any Hours Range option
  ctx.timeRanges = list;
  ctx.rawSideData = list.map((tr, i) => ({ bonus: 'AAA', timeRange: tr, value: 0.25 }));
  ctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  ui.hoursRange = '3';                          // left over from before the range was applied
  ctx.applyLocalFiltersPak();
  check('the axis is the full 43 hours, not the last 3', ctx.pageRenderCtx.targetTimeList.length === list.length,
        ctx.pageRenderCtx.targetTimeList.length + ' of ' + list.length);
  check('and so is the Data Table', ctx.currentMainRows.length === list.length, ctx.currentMainRows.length);

  ctx.customRangeQuery = null;
  ctx.archiveView = null;
  ctx.applyLocalFiltersPak();
  check('cleared, Hours Range narrows it again as normal',
        ctx.pageRenderCtx.targetTimeList.length === 12, ctx.pageRenderCtx.targetTimeList.length);
}

function FakeSelect() {
  const el = { dataset: {}, children: [], selectedIndex: -1, disabled: false,
              appendChild(o) { this.children.push(o); return o; } };
  Object.defineProperty(el, 'innerHTML', { get: () => '', set(v) { if (v === '') el.children = []; } });
  Object.defineProperty(el, 'value', { get: () => (el.selectedIndex >= 0 && el.children[el.selectedIndex]) ? el.children[el.selectedIndex].value : '' });
  Object.defineProperty(el, 'options', { get: () => el.children });
  return el;
}

head('[5] the OS/NPL pickers reach the whole span too, disabled and spanning it');
// Its own From/To would only let someone narrow WITHIN the range that was
// just asked for - two controls disagreeing about the window - so it is
// locked to the whole span and disabled, the same treatment Hours Range gets.
{
  const list = fullRange(20, 14, 22, 9);
  ctx.timeRanges = list;
  ctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  const from = FakeSelect(), to = FakeSelect();
  ctx.document = { createElement: () => ({ value: '', textContent: '' }) };
  const was$ = ctx.$;
  ctx.$ = id => (id === 'osFrom' ? from : id === 'osTo' ? to : was$(id));
  ctx.ensureTimeSelectsPak_('osFrom', 'osTo');
  check('every block of the range is offered, not just the last 96',
        from.children.length === list.length, from.children.length + ' vs ' + list.length);
  check('disabled', from.disabled === true && to.disabled === true);
  check('spanning the whole thing, start to finish',
        from.selectedIndex === 0 && to.selectedIndex === list.length - 1);

  // A later call with the SAME options (sig unchanged) must still enforce
  // the lock - not just on the one call that rebuilt them.
  from.selectedIndex = 3; to.selectedIndex = 5;
  ctx.ensureTimeSelectsPak_('osFrom', 'osTo');
  check('re-locked even when nothing else about the options changed',
        from.selectedIndex === 0 && to.selectedIndex === list.length - 1);

  // A bonus filter must not fight the lock by narrowing to one person's own
  // span - the whole point of disabling these is that nothing narrows them.
  ctx.selectedBonuses = ['AAA'];
  ctx._bonusRangePak_ = {};
  ctx.applyBonusRangePak_('os', 'osFrom', 'osTo', [{ bonus: 'AAA', date: '20/09/2026', from: '15:00', to: '16:00' }]);
  check('a bonus filter changes nothing while a range is active',
        from.selectedIndex === 0 && to.selectedIndex === list.length - 1);
  ctx.selectedBonuses = [];

  ctx.customRangeQuery = null;
  ctx.ensureTimeSelectsPak_('osFrom', 'osTo');
  check('cleared, it is editable again', from.disabled === false && to.disabled === false);
  ctx.$ = was$;
  ctx.timeRanges = [];
}

head('[5b] the Bonus page\'s own From/To gets the same lock');
{
  const list = fullRange(20, 14, 22, 9);
  ctx.timeRanges = list;
  ctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  const from = FakeSelect(), to = FakeSelect();
  ctx.document = { createElement: () => ({ value: '', textContent: '' }) };
  const was$ = ctx.$;
  ctx.$ = id => (id === 'bonusFrom' ? from : id === 'bonusTo' ? to : was$(id));
  ctx.refreshBonusTables = () => {};
  ctx.ensureBonusTimeSelects_();
  check('every block of the range is offered', from.children.length === list.length);
  check('disabled and spanning the whole range',
        from.disabled === true && to.disabled === true &&
        from.selectedIndex === 0 && to.selectedIndex === list.length - 1);

  // resetBonusTimeRangeToDefault_ (entering the page) must not undo the lock
  // with the current-half default either.
  ctx.resetBonusTimeRangeToDefault_();
  check('entering the page keeps the whole range, not the current half',
        from.disabled === true && from.selectedIndex === 0 && to.selectedIndex === list.length - 1);

  ctx.customRangeQuery = null;
  ctx.ensureBonusTimeSelects_();
  check('cleared, it is editable again', from.disabled === false);
  ctx.$ = was$;
  ctx.timeRanges = [];
}

head('[6] the label, the field mapping, and the ISO<->dd/MM/yyyy round trip');
{
  // LF-normalised: the file is CRLF on disk, and the boundary marker below
  // is matched as plain text, the same reason test_datepicker.js normalises
  // before it slices this exact file.
  const uiSlice = strip(UI).replace(/\r\n/g, '\n');
  vm.runInContext(uiSlice.slice(uiSlice.indexOf('// ── The date picker'),
                                uiSlice.indexOf("  document.addEventListener('click', function (e) {\n    var menu = $('dateMenu');")), ctx);
  check('the label shows both ends in full, year included - the field has room for it now',
        ctx.dateRangeShortLabelPak_({ from: '20/09/2026 14:00', to: '22/09/2026 09:00' }) === '20/09/2026 14:00 → 22/09/2026 09:00',
        ctx.dateRangeShortLabelPak_({ from: '20/09/2026 14:00', to: '22/09/2026 09:00' }));
  check('native date input format converts to dd/MM/yyyy', ctx.isoDateToDmyPak_('2026-09-20') === '20/09/2026');
  check('and rejects garbage rather than guessing', ctx.isoDateToDmyPak_('20/09/2026') === '');
}

head('[6b] opening the custom-range fields collapses the calendar above them');
// The two answer the same question ("which day(s)") - showing both at once
// in one small popover is that question asked twice.
{
  const fake = () => ({ hidden: true, setAttribute() {} });
  const cEls = { dateRangeFields: fake(), dateRangeToggle: fake(), calBody: fake() };
  cEls.calBody.hidden = false;                  // the calendar starts visible
  cEls.dateRangeToggle.hidden = false;          // "Custom range..." starts visible
  const was$ = ctx.$;
  ctx.$ = id => cEls[id] || null;
  ctx.customRangeQuery = null;

  ctx.toggleDateRangePanel_();
  check('opening the fields hides the calendar',
        !cEls.dateRangeFields.hidden && cEls.calBody.hidden === true);
  check('and hides the "Custom range..." toggle - the fields have their own way back',
        cEls.dateRangeToggle.hidden === true);
  ctx.toggleDateRangePanel_();
  check('closing them brings the calendar back',
        cEls.dateRangeFields.hidden && cEls.calBody.hidden === false);
  check('and the toggle too', cEls.dateRangeToggle.hidden === false);
  ctx.$ = was$;
}

head('[6c] Default Range cancels the span and shows the calendar again');
{
  const fake = () => ({ hidden: true, setAttribute() {} });
  const cEls = { dateRangeFields: fake(), dateRangeToggle: fake(), calBody: fake(),
                 archiveSelect: { value: '', dispatchEvent(e) { this.__dispatched = e && e.type; return true; } } };
  const was$ = ctx.$;
  ctx.$ = id => cEls[id] || null;

  // Simulate the state applyDateRange_ leaves: fields open, calendar and the
  // toggle both collapsed away, a range applied.
  cEls.dateRangeFields.hidden = false;
  cEls.dateRangeToggle.hidden = true;
  cEls.calBody.hidden = true;
  ctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };

  ctx.useDefaultRangePak_();
  check('the span is cancelled - the select is set to Live and reloaded',
        cEls.archiveSelect.value === '' && cEls.archiveSelect.__dispatched === 'change');
  check('the fields collapse, the calendar and its toggle come back',
        cEls.dateRangeFields.hidden === true && cEls.calBody.hidden === false &&
        cEls.dateRangeToggle.hidden === false);

  // Called with nothing applied (the fields were opened and then abandoned),
  // it is just a collapse - nothing to cancel, nothing thrown.
  ctx.customRangeQuery = null;
  cEls.archiveSelect.__dispatched = null;
  cEls.dateRangeFields.hidden = false;
  ctx.useDefaultRangePak_();
  check('with no range active it only collapses, asking nothing of the server',
        cEls.archiveSelect.__dispatched === null && cEls.dateRangeFields.hidden === true);
  ctx.$ = was$;
}

head('[7] applying a range validates, then takes over from Live');
{
  const els = {};
  const fake = () => ({ value: '', hidden: true, textContent: '', setAttribute() {}, classList: { _s: {}, add(c) { this._s[c] = true; }, toggle(c, on) { this._s[c] = !!on; } } });
  ['rangeFromDate', 'rangeFromTime', 'rangeToDate', 'rangeToTime', 'dateRangeError',
   'archiveSelect', 'datePickerBtn', 'datePickerLabel', 'dateMenu'].forEach(id => { els[id] = fake(); });
  ctx.$ = id => els[id] || null;
  const timeWindowEl = { value: '60' };
  ctx.document = { querySelectorAll: sel => (sel === '[data-sync="timeWindow"]' ? [timeWindowEl] : []),
                   createElement: () => ({ value: '', textContent: '' }) };
  const calls = { begin: 0, load: 0 };
  ctx.beginNewViewPak_ = () => { calls.begin++; };
  ctx.loadDataPak = () => { calls.load++; };
  ctx.toggleDateMenu_ = () => {};

  els.rangeFromDate.value = '2026-09-22';
  els.rangeToDate.value = '2026-09-20';
  els.rangeFromTime.value = '14:00';
  els.rangeToTime.value = '09:00';
  ctx.applyDateRange_();
  check('To before From is refused', els.dateRangeError.hidden === false && calls.load === 0,
        els.dateRangeError.textContent);
  check('nothing was committed', ctx.customRangeQuery === null);

  els.rangeFromDate.value = '2026-01-01';
  els.rangeToDate.value = '2026-03-01';
  ctx.applyDateRange_();
  check('a span past the cap is refused too', /31/.test(els.dateRangeError.textContent), els.dateRangeError.textContent);

  els.rangeFromDate.value = '2026-09-20'; els.rangeFromTime.value = '14:00';
  els.rangeToDate.value = '2026-09-22'; els.rangeToTime.value = '09:00';
  ctx.currentArchiveUrl = 'U18';
  els.archiveSelect.value = 'U18';
  ctx.applyDateRange_();
  check('a valid span is committed as dd/MM/yyyy HH:mm, both ends',
        JSON.stringify(ctx.customRangeQuery) === JSON.stringify({ from: '20/09/2026 14:00', to: '22/09/2026 09:00' }),
        JSON.stringify(ctx.customRangeQuery));
  check('it replaces whatever archive day was showing', ctx.currentArchiveUrl === null);
  check('the hidden select is cleared to Live, so re-picking the SAME day still fires change',
        els.archiveSelect.value === '');
  check('the shared reset runs, exactly as picking a single day does', calls.begin === 1);
  check('and the load is kicked off', calls.load === 1);
  // 15, not the 60 a single archive day gets: an arbitrary range rarely
  // starts or ends on the hour, and at 60 the edge blocks the reader picked
  // a precise time to include would be dropped as partial buckets - see
  // dropPartialEdgeGroupKeys_ in Web - JsData.
  check('Time Window resets to 15, so nothing at the edges gets aggregated away',
        timeWindowEl.value === '15', timeWindowEl.value);
  // isHistoricalViewPak_ itself lives past the point JsState is sliced at
  // for this suite (it is declared beside customRangeQuery) - the property
  // it is built from is what every "is this Live?" check actually reads.
  check('and this is what every "is this Live?" check gates on',
        !!(ctx.currentArchiveUrl || ctx.customRangeQuery) === true);
}

head('[8] loadDataPak reads the range endpoint, not the single-archive one');
{
  check('a custom range is checked first, and gets its own server call',
        /if \(customRangeQuery\) \{\s*\n\s*runner\.getDashboardDataRange\(customRangeQuery\.from, customRangeQuery\.to\);\s*\n\s*\} else \{\s*\n\s*runner\.getDashboardData\(urlToFetch\);\s*\n\s*\}/
          .test(strip(INIT).replace(/\r\n/g, '\n')));
}

head('[9] the Claims page reads the picked span, not a single production day');
{
  const fctx = { console };
  vm.createContext(fctx);
  vm.runInContext(strip(R('Web - JsHelpers.html')), fctx);
  vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], fctx);
  vm.runInContext(strip(R('Web - JsPageOs.html')), fctx);
  vm.runInContext(strip(R('Web - JsPageNpl.html')), fctx);
  vm.runInContext(strip(R('Web - JsPageFraud.html')), fctx);
  fctx.$ = () => null;                          // no date control to read from in range mode
  fctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  const win = fctx.fraudWindowPak_();
  check('start is the picked FROM, not 06:00 of some single day',
        win.start.getTime() === new Date(2026, 8, 20, 14, 0).getTime(), win.start);
  check('finish is the picked TO, not 24 hours later',
        win.finish.getTime() === new Date(2026, 8, 22, 9, 0).getTime(), win.finish);
  // The email's own call always passes `day` explicitly, so it is untouched
  // by any of this - checked structurally, since the email never runs in
  // range mode at all.
  const dayWin = fctx.fraudWindowPak_(new Date(2026, 8, 20));
  check('a day passed in explicitly (the email) is unaffected',
        dayWin.start.getTime() === new Date(2026, 8, 20, 6, 0).getTime());

  // The window above spans 20/09 14:00 to 22/09 09:00 - three production
  // days, since a claim after midnight on the 22nd still belongs to the
  // 21st's day. Missing any of them would mean the OS/NPL log is only
  // half-asked-for, and the Overlapping Claims table is quietly incomplete
  // for whichever days it never asked about.
  const keys = fctx.fraudWantDatesPak_();
  check('every production day the range touches is asked for, not just one',
        keys.slice().sort().join() === '20/09/2026,21/09/2026,22/09/2026', keys.join());

  // A single production day - what every OTHER load already relied on -
  // still comes back as exactly the one key it always sent.
  fctx.customRangeQuery = null;
  fctx.lastRefreshTimestamp = new Date(2026, 8, 20, 12, 0).getTime();
  check('a single day still asks for exactly one key, as before',
        fctx.fraudWantDatesPak_().join() === '20/09/2026', fctx.fraudWantDatesPak_().join());
}

head('[9b] the note and the badge say what was actually asked for, not 06:00');
// "in this production day" was a plain untruth for a span that can cross
// several of them, and the badge hard-coded 06:00 either side regardless of
// what the picked range's own start and finish actually were.
{
  const fctx2 = { console };
  vm.createContext(fctx2);
  vm.runInContext(strip(R('Web - JsHelpers.html')), fctx2);
  vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], fctx2);
  vm.runInContext(strip(R('Web - JsPageOs.html')), fctx2);
  vm.runInContext(strip(R('Web - JsPageNpl.html')), fctx2);
  vm.runInContext(strip(R('Web - JsPageFraud.html')), fctx2);
  fctx2.$ = () => null;
  fctx2.allSideData = [
    { bonus: 'AAA', timeRange: '20/09/2026 14:00 - x', value: 0.25 },
    { bonus: 'AAA', timeRange: '22/09/2026 08:45 - x', value: 0.25 }
  ];
  fctx2.rawSideData = fctx2.allSideData;

  fctx2.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  const win = fctx2.fraudWindowPak_();
  const covered = { start: win.start, finish: win.finish };
  const noteRanged = fctx2.fraudNoteTextPak_(win, { claims: 5 });
  check('the note says "this range", not "this production day"',
        /5 claims in this range, checked against produced hours from/.test(noteRanged), noteRanged);
  check('and the empty-coverage wording follows suit',
        /None of this range is loaded yet/.test(fctx2.fraudNoteTextPak_({ start: win.finish, finish: win.finish }, { claims: 0 })));

  fctx2.customRangeQuery = null;
  const dayWin = fctx2.fraudWindowPak_(new Date(2026, 8, 20));
  const noteDay = fctx2.fraudNoteTextPak_(dayWin, { claims: 1 });
  check('a single production day still reads that way, unchanged',
        /1 claim in this production day, checked against produced hours from/.test(noteDay), noteDay);

  // The badge: rendered through the real DOM path, not read back off the
  // function directly, since the whole point is what actually reaches the
  // page.
  const badgeEl = { textContent: '' };
  const bodyEl = { querySelector: () => null };
  fctx2.document = { getElementById: id => (id === 'fraudRangeBadge' ? badgeEl : id === 'fraudBody' ? bodyEl : null) };
  fctx2.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  fctx2.fraudLogState = null;   // renderFraudPagePak bails after setting the badge
  fctx2.ensureFraudLogsPak_ = () => {};
  fctx2.renderFraudPagePak();
  check('the badge shows the range\'s OWN times, not a literal 06:00',
        badgeEl.textContent === '20/09/2026 14:00  to  22/09/2026 09:00', badgeEl.textContent);

  fctx2.customRangeQuery = null;
  fctx2.lastRefreshTimestamp = new Date(2026, 8, 20, 12, 0).getTime();
  fctx2.renderFraudPagePak();
  check('a single production day still reads 06:00 to 06:00, derived the same way',
        badgeEl.textContent === '20/09/2026 06:00  to  21/09/2026 06:00', badgeEl.textContent);
}

head('[9c] the KPI Breakdown dialog\'s own From/To gets the same lock');
{
  const uiSlice3 = strip(UI).replace(/\r\n/g, '\n');
  const pStart = uiSlice3.indexOf('function populateBreakdownSelects');
  let depth = 0, pEnd = uiSlice3.indexOf('{', pStart);
  for (let j = pEnd; j < uiSlice3.length; j++) {
    if (uiSlice3[j] === '{') depth++;
    else if (uiSlice3[j] === '}' && --depth === 0) { pEnd = j + 1; break; }
  }
  vm.runInContext(uiSlice3.slice(pStart, pEnd), ctx);
  const list = fullRange(20, 14, 22, 9);
  ctx.timeRanges = list;
  ctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  const from = FakeSelect(), to = FakeSelect();
  const wasDoc = ctx.document;
  ctx.document = { getElementById: id => (id === 'breakdownFrom' ? from : id === 'breakdownTo' ? to : null),
                   createElement: () => ({ value: '', textContent: '' }) };
  ctx.updateBreakdownRange = () => {};
  ctx.populateBreakdownSelects();
  check('every block of the range is offered, not just the last 96', from.children.length === list.length);
  check('disabled and spanning the whole range',
        from.disabled === true && to.disabled === true &&
        from.selectedIndex === 0 && to.selectedIndex === list.length - 1);

  ctx.customRangeQuery = null;
  ctx.populateBreakdownSelects();
  check('cleared, it is editable again', from.disabled === false);
  ctx.document = wasDoc;
  ctx.timeRanges = [];
}

head('[10] Hours Range gets the same greyed, tooltipped treatment a page with its own range does');
{
  const gctx = { console };
  vm.createContext(gctx);
  const uiSlice2 = strip(UI).replace(/\r\n/g, '\n');
  vm.runInContext(uiSlice2.slice(uiSlice2.indexOf('var PAGES_WITH_OWN_RANGE_'),
                                 uiSlice2.indexOf('function releaseLogFetchesPak_')), gctx);
  function fakeField(id) {
    const control = { id, disabled: false, title: '' };
    // 'hc-field' true from the start, so the walk-up loop stops on the first
    // hop - control.parentNode IS the field, exactly one level up.
    const state = { 'hc-field': true };
    const field = { classList: {
      toggle(c, on) { state[c] = on === undefined ? !state[c] : !!on; },
      contains(c) { return !!state[c]; }
    } };
    control.parentNode = field;
    field.parentNode = null;
    return { control, field };
  }
  const hours = fakeField('hoursRange'), window_ = fakeField('timeWindow'), date_ = fakeField('archiveSelect');
  gctx.document = { getElementById: id => (id === 'hoursRange' ? hours.control
                                          : id === 'timeWindow' ? window_.control
                                          : id === 'archiveSelect' ? date_.control : null) };
  date_.control.closest = () => date_.field;
  gctx.customRangeQuery = null;

  gctx.syncTimeAxisControlsPak_(0);            // Overall, no range of its own
  check('with no range active, Hours Range is live on a normal page',
        hours.control.disabled === false && !hours.field.classList.contains('hc-field-off') &&
        !hours.field.classList.contains('hc-field-range-hide'));

  gctx.customRangeQuery = { from: '20/09/2026 14:00', to: '22/09/2026 09:00' };
  gctx.syncTimeAxisControlsPak_(0);
  check('a custom range hides it outright, not merely greys it',
        hours.control.disabled === true && hours.field.classList.contains('hc-field-range-hide') &&
        !hours.field.classList.contains('hc-field-off'));
  check('with a tooltip saying why', hours.control.title === 'A custom date range already covers both ends',
        hours.control.title);
  check('but leaves Time Window alone - it still aggregates the range',
        window_.control.disabled === false && !window_.field.classList.contains('hc-field-off'));
  check('and the Date field grows into the column Hours Range leaves',
        date_.field.classList.contains('hc-field-range-grow'));
  check('hc-field-range-hide actually hides the field, not just names it',
        /\.hc-field-range-hide\s*\{\s*display:\s*none;\s*\}/.test(R('Web - Styles.html')));
  check('the date button\'s own max-width is lifted too, so a long span does not truncate into an ellipsis',
        /\.hc-field-range-grow #datePickerBtn\s*\{[^}]*max-width:\s*none/.test(R('Web - Styles.html')));
  // The filter row is a CSS grid, not the flex row the class name history
  // suggests - a flex-basis does nothing there, and a plain min-width instead
  // forced the Date field wider than its own grid track, overlapping Time
  // Window beside it. A span across two tracks is what actually reclaims
  // Hours Range's own track.
  check('the Date field grows by spanning Hours Range\'s own grid track, not by a flex-basis',
        /\.hc-field-range-grow\s*\{\s*grid-column:\s*span 2;\s*\}/.test(R('Web - Styles.html')));
  // .hc-control used to be inline-flex, which put it in an inline formatting
  // context of its own inside its wrapper div and picked up that context's
  // line-height as real space below its baseline - the few px that had
  // Warehouse and Time Window sitting lower than Threshold and Date (whose
  // own #datePickerBtn rule already overrode this to plain flex).
  check('.hc-control is a block flex box, not inline-flex, so it never picks up a phantom line-height gap',
        /\.hc-control\s*\{[^}]*display:\s*flex;/.test(R('Web - Styles.html')) &&
        !/\.hc-control\s*\{[^}]*display:\s*inline-flex;/.test(R('Web - Styles.html')));

  gctx.syncTimeAxisControlsPak_(0);
  check('re-running with the same range keeps it hidden, not toggled back',
        hours.field.classList.contains('hc-field-range-hide') && date_.field.classList.contains('hc-field-range-grow'));

  // The Claims page (index 3) already disables Hours Range for its own
  // reason - that tooltip must not be overwritten by the range's.
  gctx.syncTimeAxisControlsPak_(3);
  check('a page with its OWN reason keeps its OWN tooltip',
        hours.control.title === 'This page covers one production day, 06:00 to 06:00', hours.control.title);

  gctx.customRangeQuery = null;
  gctx.syncTimeAxisControlsPak_(0);
  check('cleared, a normal page is live again',
        hours.control.disabled === false && !hours.field.classList.contains('hc-field-range-hide') &&
        !date_.field.classList.contains('hc-field-range-grow'));
}

head('[11] the x-axis does not draw one label per block over a many-day custom range');
{
  // Only the tick-count logic is under test, so the function is cut down to
  // just that - through the line that sets xTicksConfig.maxTicksLimit -
  // rather than pulled in whole with everything past it that OTHER chart
  // config (bands, tooltips, plugins) would need stubbed for no reason.
  const chartsSrc = strip(R('Web - JsCharts.html')).replace(/\r\n/g, '\n');
  const start = chartsSrc.indexOf('function getChartCommon_(rows) {');
  const cut = chartsSrc.indexOf("} else if (hRange >= 24)", start);
  const end = chartsSrc.indexOf('\n', cut) + 1;
  const body = chartsSrc.slice(start, end) + '    return xTicksConfig;\n  }\n';

  const cctx = { console, parseInt };
  vm.createContext(cctx);
  cctx.CHART_MUTED = () => '#000';
  cctx.trimTimeLabelPak = s => s;
  let aggLen = 0;
  cctx.getAggregatedDataPak = () => Array.from({ length: aggLen }, (_, i) => ({ dateTime: i, rangeLabel: '', pieVol: 0, topUpVol: 0, performance: 0 }));
  cctx.$ = id => ({ value: id === 'timeWindow' ? '15' : '3' });
  cctx._chartCommon = null;
  vm.runInContext(body, cctx);

  cctx.customRangeQuery = { from: '20/09/2026 14:00', to: '30/09/2026 09:00' };
  aggLen = 200;
  check('a long span (200 blocks) is capped at 24 ticks, not left to draw all of them',
        cctx.getChartCommon_([1]).maxTicksLimit === 24);

  aggLen = 60;
  check('a medium span (60 blocks) is capped at 12',
        cctx.getChartCommon_([1]).maxTicksLimit === 12);

  aggLen = 30;
  check('a short span (30 blocks) is capped at 8',
        cctx.getChartCommon_([1]).maxTicksLimit === 8);

  aggLen = 20;
  check('a small span (20 blocks) is left unlimited, same as a normal small Hours Range',
        cctx.getChartCommon_([1]).maxTicksLimit === undefined);

  // Cleared, Hours Range's OWN value drives it again, unchanged from before -
  // this only ever kicks in while customRangeQuery is set.
  cctx.customRangeQuery = null;
  aggLen = 200;
  check('cleared, a large block count no longer matters - Hours Range (\'3\') does, and it is under 6',
        cctx.getChartCommon_([1]).maxTicksLimit === undefined);
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
