// Past dates: which 24 hours an archive shows (Settings > Past dates), and a
// filtered bonus number's run followed past the edge of them.
//
// An archive file holds one calendar day, so a shift crossing midnight used to
// vanish at 00:00. The payload now brings the next morning beside the date
// (nextDayRows), the client cuts the reader's 24 hours out of the two, and a
// picked person still at work at either edge is followed until they stop -
// fetching the days either side (getEdgeRows) only when the run reaches them.
//
// The client half runs the real JsHelpers, JsState, JsPageOs and JsData; the
// server half runs the real Code.js against stub spreadsheets.
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

// Pulls one `function name(...) { ... }` out of a source file by brace-matching.
function grabFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unterminated: ' + name);
}

// ── the client ──────────────────────────────────────────────────────────────
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(strip(R('Web - JsHelpers.html')), ctx);
vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], ctx);
const INIT = strip(R('Web - JsInit.html'));
vm.runInContext(INIT.slice(INIT.indexOf('function decodeSideRowsPak_'),
                           INIT.indexOf('var PAYLOAD_CACHE_KEY')), ctx);
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);
vm.runInContext(strip(R('Web - JsData.html')), ctx);
vm.runInContext(grabFn(strip(R('Web - JsTables.html')), 'buildMainRowDetail'), ctx);
const ev = e => vm.runInContext(e, ctx);

// The real ones, kept before the render path's collaborators are stubbed.
const realSave = ctx.saveUserPreferences, realLoad = ctx.loadUserPreferences;

// Declared below the point JsState is cut at, or in files not loaded here.
Object.assign(ctx, {
  selectedBonuses: [], currentThreshold: 0, currentMainRows: [], pageRenderCtx: null,
  trendSplitState: { enabled: false, charts: [] }, tourActive: false, currentPage: 0,
  // A custom range (Web - JsUi's applyDateRange_) is a separate way to leave
  // Live from anything this suite exercises - null throughout.
  customRangeQuery: null,
  invalidateChartCommon_() {}, markAllPagesDirty_() {}, renderPageIfNeeded_() {},
  saveUserPreferences() {}
});
const ui = { hoursRange: '24', timeWindow: '15', sharedRowsLimit: '10' };
ctx.$ = id => (id in ui ? { value: ui[id] } : null);

// google.script.run, recording each call with the handlers it was given.
const gs = { calls: [] };
function gsRunner(ok, bad) {
  return new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return f => gsRunner(f, bad);
    if (name === 'withFailureHandler') return f => gsRunner(ok, f);
    return (...args) => { gs.calls.push({ name, args, ok, bad }); };
  } });
}
ctx.google = { script: { run: gsRunner(null, null) } };

const fmt = d => ctx.formatDatePak(d);
const blk = (d, h, m, mo) => {
  const s = new Date(2026, mo === undefined ? 8 : mo, d, h, m);
  return fmt(s) + ' - ' + fmt(new Date(s.getTime() + 900000));
};
const row = (bonus, d, h, m, x) => Object.assign({ bonus, timeRange: blk(d, h, m), value: 0.25 }, x || {});
// Every block from `from` up to, not including, `to` - both [day, h, m] in 09/2026.
function run(bonus, from, to, x) {
  const out = [];
  const end = new Date(2026, 8, to[0], to[1], to[2] || 0).getTime();
  for (let t = new Date(2026, 8, from[0], from[1], from[2] || 0).getTime(); t < end; t += 900000) {
    out.push(Object.assign({ bonus, timeRange: fmt(new Date(t)) + ' - ' + fmt(new Date(t + 900000)),
                             value: 0.25 }, x || {}));
  }
  return out;
}
const hourOf = r => Number(r.timeRange.slice(11, 13));
const on = (r, d) => r.timeRange.startsWith(d + '/09/2026');
const last = a => a[a.length - 1];

// Opens 23/09/2026 the way renderDashboardPayload_ does: that date's rows, and
// the next morning's beside them. A fresh view each time, as a new date is.
function open(mode, all) {
  ctx.dayMode = mode;
  ctx.archiveView = null;
  const day = all.filter(r => on(r, 23));
  const next = all.filter(r => on(r, 24) && hourOf(r) < 6);
  ctx._bonusList = ctx.applyArchiveWindowPak_(
    { archiveDate: '23/09/2026', nextDayRows: next, sideSchema: null }, day);
  return ctx.archiveView;
}
// What getEdgeRows would bring back for these bonus numbers.
function edgeIn(all, bonuses) {
  ctx.archiveView.edge = all.filter(r => bonuses.includes(r.bonus) &&
    (on(r, 22) || (on(r, 24) && hourOf(r) >= 6)));
  bonuses.forEach(b => { ctx.archiveView.edgeFor[b] = true; });
}
const stretch = (bonuses, wm) => ctx.stretchBlocksPak_(
  ctx.archiveView, ctx.archiveView.span.concat(ctx.archiveView.edge), bonuses, wm || 15);
function apply() {
  ctx.rawSideData = ctx.scopeRowsToSite_(ctx.allSideData);
  ctx.applyLocalFiltersPak();
}

// Someone at work in every block from 00:00 on the date to 06:00 the next
// morning, so neither window trims.
const FILL = run('FILL', [23, 0], [24, 6]);

head('[0] an unanswered question starts unanswered');
check('dayMode starts null, not as a default someone chose', ctx.dayMode === null, String(ctx.dayMode));
check('which reads as 06:00-06:00', ctx.dayModePak_() === '6-6');

// ── the server, for the labels it generates and for [7] ─────────────────────
const CODE = R('Web - Code.js');
const cacheStore = {};
const cacheStub = {
  putAll(map) { Object.keys(map).forEach(k => { cacheStore[k] = map[k]; }); },
  getAll(keys) {
    const out = {};
    keys.forEach(k => { out[k] = Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; });
    return out;
  },
  get(k) { return Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; },
  put(k, v) { cacheStore[k] = v; }
};
const p2 = n => String(n).padStart(2, '0');
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

head('[1] the window is the reader\'s 24 hours');
{
  let v = open('6-6', FILL);
  check('06:00-06:00 starts at 06:00 on the date', ctx.timeRanges[0] === blk(23, 6, 0), ctx.timeRanges[0]);
  check('and ends at 06:00 the next morning, 96 blocks later',
        ctx.timeRanges.length === 96 && last(ctx.timeRanges) === blk(24, 5, 45), last(ctx.timeRanges));
  check('its rows are the window\'s, the morning after included',
        ctx.allSideData.length === 96 && ctx.allSideData.some(r => on(r, 24)) &&
        !ctx.allSideData.some(r => on(r, 23) && hourOf(r) < 6));
  check('while the span keeps all of it', v.span.length === 120, v.span.length);

  v = open('0-0', FILL);
  check('00:00-00:00 is the calendar date',
        ctx.timeRanges[0] === blk(23, 0, 0) && last(ctx.timeRanges) === blk(23, 23, 45) &&
        ctx.timeRanges.length === 96, ctx.timeRanges[0] + ' .. ' + last(ctx.timeRanges));
  check('and its rows stop at midnight', ctx.allSideData.length === 96 && !ctx.allSideData.some(r => on(r, 24)));
  const server = sctx.generateTimeRanges_(new Date(2026, 8, 24, 0, 0), 96);
  check('labelled exactly as the server labels that day',
        JSON.stringify(ctx.timeRanges) === JSON.stringify(server), server[0] + ' vs ' + ctx.timeRanges[0]);

  // Trailing blocks with no hours go, as the server trims them. An OS spell
  // typed ahead of time is not hours, so it does not hold a block open.
  const TRIM = run('FILL', [23, 0], [24, 3, 15]).concat(run('OSA', [24, 3], [24, 6], { value: 0, os: true }));
  v = open('6-6', TRIM);
  check('the unpublished tail is trimmed, OS rows or not',
        last(ctx.timeRanges) === blk(24, 3, 0) && v.trimmed === true, last(ctx.timeRanges));

  const dst = ctx.archiveWindowPak_('25/10/2026', '0-0', []).list;
  check('a day the clocks change still has 96 distinct blocks',
        new Set(dst).size === 96 && dst[0] === blk(25, 0, 0, 9) && last(dst) === blk(25, 23, 45, 9),
        new Set(dst).size + ' distinct');

  const MORN = FILL.concat([row('MORN', 24, 0, 30)]);
  open('6-6', MORN);
  check('someone who only worked the next morning is searchable on 06:00-06:00',
        ctx._bonusList.includes('MORN'));
  open('0-0', MORN);
  check('...and not on 00:00-00:00, where they are off screen', !ctx._bonusList.includes('MORN'));
}

head('[2] the Data Table is the window, not the next morning');
// buildFullDayTimeList_ anchors to the midnight of the LAST block, which on a
// 06:00-06:00 day is the next morning's - so the table showed 00:00-06:00 only.
{
  open('6-6', FILL);
  ctx.selectedBonuses = [];
  apply();
  const rows = ctx.currentMainRows;
  check('it runs 06:00 to 06:00', rows.length === 96 && rows[0].dateTime === blk(23, 6, 0) &&
        last(rows).dateTime === blk(24, 5, 45), rows.length + ' rows from ' + (rows[0] || {}).dateTime);
  check('and nothing was asked of the server with no filter on', gs.calls.length === 0);
}

head('[2b] the LIVE Data Table follows the day setting too');
// buildFullDayTimeList_ used to always anchor to midnight - so on Live, with
// dayMode set to 6-6, the table still reset at 00:00 rather than 06:00, the
// one place the setting was silently ignored.
{
  ctx.archiveView = null;
  ctx.dayMode = '6-6';
  ctx.timeRanges = [blk(23, 13, 45), blk(23, 14, 0)];
  let list = ctx.buildFullDayTimeList_();
  check('a block at 14:00 belongs to the day that started at 06:00 THAT morning',
        list[0] === blk(23, 6, 0) && list.length === 96 && last(list) === blk(24, 5, 45),
        list[0] + ' .. ' + last(list));

  ctx.timeRanges = [blk(23, 2, 45), blk(23, 3, 0)];
  list = ctx.buildFullDayTimeList_();
  check('a block at 03:00 belongs to the PRODUCTION day that started the morning before',
        list[0] === blk(22, 6, 0) && last(list) === blk(23, 5, 45),
        list[0] + ' .. ' + last(list));

  ctx.dayMode = '0-0';
  ctx.timeRanges = [blk(23, 13, 45), blk(23, 14, 0)];
  list = ctx.buildFullDayTimeList_();
  check('and 00:00-00:00 is unchanged: the calendar day of the latest block',
        list[0] === blk(23, 0, 0) && last(list) === blk(23, 23, 45),
        list[0] + ' .. ' + last(list));

  ctx.dayMode = null;
  ctx.timeRanges = [];
  ctx.archiveView = null;
}

head('[3] a picked run is followed past the edge until it stops');
{
  // NGT works 04:00 to 08:00 on the morning after: over the 06:00 edge.
  const NGT = FILL.concat(run('NGT', [24, 4], [24, 8]));
  open('6-6', NGT);
  let s = stretch(['NGT']);
  check('at the edge of what is loaded, it asks for more', s.needsEdge === true && s.after.length === 0);
  edgeIn(NGT, ['NGT']);
  s = stretch(['NGT']);
  check('and with it, carries on to the end of the shift',
        s.after.length === 8 && last(s.after) === blk(24, 7, 45) && !s.needsEdge,
        s.after.length + ' blocks, to ' + last(s.after));
  check('bringing that person\'s rows in those blocks with it',
        s.rows.length === 8 && s.rows.every(r => r.bonus === 'NGT'));

  // EARLY starts AT 06:00 - it touches the edge from outside and is not pulled in.
  const EARLY = FILL.concat(run('EARLY', [24, 6], [24, 10]));
  open('6-6', EARLY);
  edgeIn(EARLY, ['EARLY']);
  s = stretch(['EARLY']);
  check('a run that starts at the edge is left alone', s.after.length === 0 && !s.needsEdge,
        s.after.length + ' blocks');

  // LONG is at work from 20:00 on the date to midnight the next night.
  const LONG = FILL.concat(run('LONG', [23, 20], [25, 0]));
  open('0-0', LONG);
  edgeIn(LONG, ['LONG']);
  s = stretch(['LONG']);
  check('no further than the longest shift the OS page believes',
        s.after.length === 64 && last(s.after) === blk(24, 15, 45), s.after.length + ' blocks');

  // SNAP stops at 06:45 - partway through the 06:00 hour.
  const SNAP = FILL.concat([row('SNAP', 24, 5, 45)], run('SNAP', [24, 6], [24, 6, 45]));
  open('6-6', SNAP);
  edgeIn(SNAP, ['SNAP']);
  check('at 15 minutes, exactly as far as the run', stretch(['SNAP'], 15).after.length === 3);
  s = stretch(['SNAP'], 60);
  check('at 60, out to the end of the hour, or the part-hour is dropped',
        s.after.length === 4 && last(s.after) === blk(24, 6, 45), s.after.length + ' blocks');
  const BS = FILL.concat(run('BS', [23, 5, 15], [23, 6, 15]));
  open('6-6', BS);
  s = stretch(['BS'], 60);
  check('and the same going back: from 05:15 to the 05:00 hour',
        s.before.length === 4 && s.before[0] === blk(23, 5, 0), s.before[0]);
  check('the early side comes out of the loaded date, needing nothing more', !s.needsEdge);

  // NIGHT is at work 22:00 the night before to 06:00 on the date.
  const NIGHT = FILL.concat(run('NIGHT', [22, 22], [23, 6]));
  open('0-0', NIGHT);
  s = stretch(['NIGHT']);
  check('on 00:00-00:00, a night shift at midnight asks for the day before',
        s.needsEdge === true && s.before.length === 0);
  edgeIn(NIGHT, ['NIGHT']);
  s = stretch(['NIGHT']);
  check('and then starts where the shift did', s.before.length === 8 && s.before[0] === blk(22, 22, 0),
        s.before.length + ' from ' + s.before[0]);
  open('6-6', NIGHT);
  s = stretch(['NIGHT']);
  check('on 06:00-06:00 that shift ended before the window began, and is not pulled in',
        s.before.length === 0 && !s.needsEdge);

  // When the morning after is today, the window's end is the present.
  const TRIM = run('FILL', [23, 0], [24, 3, 15]).concat(run('OSA', [24, 3], [24, 6], { value: 0, os: true }));
  open('6-6', TRIM);
  s = stretch(['OSA']);
  check('never past a trimmed end, where an OS spell is only typed ahead',
        s.after.length === 0 && !s.needsEdge, s.after.length + ' blocks');
}

head('[4] the rows beyond are asked for once, and dropped if the date moved on');
{
  const NGT = FILL.concat(run('NGT', [24, 4], [24, 8]));
  const edgeRows = NGT.filter(r => r.bonus === 'NGT' && on(r, 24) && hourOf(r) >= 6);
  open('6-6', NGT);
  ctx.selectedBonuses = ['NGT'];
  gs.calls = [];
  apply();
  const c = gs.calls[0];
  check('one call, for this date and this bonus number',
        gs.calls.length === 1 && c.name === 'getEdgeRows' && c.args[0] === '23/09/2026' &&
        c.args[1].join() === 'NGT', gs.calls.map(x => x.name + ' ' + JSON.stringify(x.args)).join());
  check('and the axis does not run on before they arrive',
        last(ctx.pageRenderCtx.targetTimeList) === blk(24, 5, 45));
  c.ok({ sideSchema: null, rows: edgeRows });
  check('when they do, the axis follows the shift to its end',
        last(ctx.pageRenderCtx.targetTimeList) === blk(24, 7, 45), last(ctx.pageRenderCtx.targetTimeList));
  check('and so does the Data Table', last(ctx.currentMainRows).dateTime === blk(24, 7, 45),
        last(ctx.currentMainRows).dateTime);
  check('without asking a second time', gs.calls.length === 1, gs.calls.length + ' calls');

  // A stretched row expands to its people, who are not in rawSideData.
  Object.assign(ctx, {
    bonusAreaCountMapPak() { return {}; }, bonusOsMapPak_() { return {}; }, bonusNplMapPak_() { return {}; },
    compareEntryDetailPak() { return 0; }, isCardModePak() { return false; },
    buildMainDetailTableHtml_(rows) { return 'ROWS:' + rows.map(r => r.bonus).join(); }
  });
  check('a row out in the stretch still opens onto its person',
        ctx.buildMainRowDetail({ dateTime: blk(24, 7, 0) }) === 'ROWS:NGT',
        ctx.buildMainRowDetail({ dateTime: blk(24, 7, 0) }));

  ctx.dayMode = '0-0';
  ctx.applyArchiveWindowPak_({ archiveDate: '23/09/2026', nextDayRows: [], sideSchema: null }, []);
  check('changing the day setting keeps what was already fetched',
        ctx.archiveView.edge.length === edgeRows.length && ctx.archiveView.edgeFor.NGT === true);

  // Counted rather than run: what matters is whether the answer re-draws.
  const realApply = ctx.applyLocalFiltersPak;
  let draws = 0;
  ctx.applyLocalFiltersPak = () => { draws++; };
  open('6-6', NGT);
  gs.calls = [];
  ctx.requestEdgeRowsPak_();
  const stale = gs.calls[0], staleView = ctx.archiveView;
  open('6-6', NGT);             // another date picked meanwhile, then this one again
  stale.ok({ sideSchema: null, rows: edgeRows });
  check('an answer for a view no longer on screen is dropped',
        draws === 0 && staleView.edge.length === 0 && ctx.archiveView.edge.length === 0,
        draws + ' draws');
  gs.calls = [];
  ctx.requestEdgeRowsPak_();
  ctx.tourActive = true;
  gs.calls[0].ok({ sideSchema: null, rows: edgeRows });
  ctx.tourActive = false;
  check('and so is one landing while the tour\'s demo data is up',
        draws === 0 && ctx.archiveView.edge.length === 0, draws + ' draws');
  ctx.applyLocalFiltersPak = realApply;
  open('6-6', NGT);

  gs.calls = [];
  ctx.requestEdgeRowsPak_();
  const warned = [];
  ctx.console = Object.assign({}, console, { warn: (...a) => warned.push(a.join(' ')) });
  gs.calls[0].bad(new Error('boom'));
  ctx.console = console;
  ctx.requestEdgeRowsPak_();
  check('a failure is said in the console', /Edge rows failed to load: boom/.test(warned.join()), warned.join());
  check('and not retried in a loop', gs.calls.length === 1, gs.calls.length + ' calls');
  ctx.selectedBonuses = [];
}

head('[5] the OS and NPL pages reach the stretch too');
{
  function FakeSelect() {
    const el = { dataset: {}, children: [], selectedIndex: -1,
                 appendChild(o) { this.children.push(o); return o; } };
    Object.defineProperty(el, 'innerHTML', { get: () => '', set(v) { if (v === '') el.children = []; } });
    Object.defineProperty(el, 'value', { get: () =>
      (el.selectedIndex >= 0 && el.children[el.selectedIndex]) ? el.children[el.selectedIndex].value : '' });
    return el;
  }
  const NGT = FILL.concat(run('NGT', [24, 4], [24, 8]));
  open('6-6', NGT);
  edgeIn(NGT, ['NGT']);
  ctx.viewStretch = stretch(['NGT']);
  const from = FakeSelect(), to = FakeSelect();
  ctx.document = { createElement: () => ({ value: '', textContent: '' }) };
  const was$ = ctx.$;
  ctx.$ = id => (id === 'osFrom' ? from : id === 'osTo' ? to : was$(id));
  ctx.ensureTimeSelectsPak_('osFrom', 'osTo');
  check('the From / To pickers run on to the end of the stretch',
        from.children.length === 104 && last(to.children).value === blk(24, 7, 45),
        from.children.length + ' options');
  ctx.$ = was$;

  const win = { start: new Date(2026, 8, 24, 6, 0), finish: new Date(2026, 8, 24, 8, 0) };
  check('work in the stretch counts as work, so the person is not "Pure OS"',
        ctx.osPureBonusesPak_(win).NGT === true);
  ctx.viewStretch = { before: [], after: [], rows: [], needsEdge: false };

  open('0-0', FILL);
  const want = ctx.osLogWantDates_().slice().sort();
  check('a past date asks the logs for the day after too, whichever window is on screen',
        want.join() === '22/09/2026,23/09/2026,24/09/2026', want.join());
}

head('[6] the answer is saved - and so is not having one');
{
  const store = { _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  ctx.localStorage = store;
  // Whatever saveUserPreferences reads that this harness has not loaded.
  const defaults = { hiddenBonusAreas: [], hiddenVolumeAreas: [], siteSettings_: {}, chartOrderState: {},
                     allowMultiBonusFilter: false, syncAreaChips: true, siteFilterPreferred: 'all',
                     currentTheme: 'light', AREA_ORDER_VERSION: 1 };
  Object.keys(defaults).forEach(n => { if (ev('typeof ' + n) === 'undefined') ctx[n] = defaults[n]; });
  ctx.applyTheme_ = () => {};      // the real one paints document.documentElement
  const was$ = ctx.$;
  ctx.$ = id => ({ value: ui[id] || '', checked: false, classList: { toggle() {} } });
  const KEY = 'e3_dashboard_prefs_v1';

  ctx.dayMode = null;
  realSave();
  const saved = JSON.parse(store.getItem(KEY) || '{}');
  check('unanswered is saved as unanswered - the first paint saves before anyone is asked',
        Object.prototype.hasOwnProperty.call(saved, 'dayMode') && saved.dayMode === null,
        JSON.stringify(saved.dayMode));
  // The rest of a load is DOM work this harness has no DOM for, and it runs
  // after the day is read - so its complaint is muted, not faked away.
  const load = () => {
    ctx.console = Object.assign({}, console, { warn() {} });
    try { realLoad(); } finally { ctx.console = console; }
  };
  ctx.dayMode = '0-0';
  realSave();
  ctx.dayMode = null;
  load();
  check('an answer survives a reload', ctx.dayMode === '0-0', String(ctx.dayMode));
  store.setItem(KEY, JSON.stringify({ dayMode: 'noon' }));
  load();
  check('anything else reads as unanswered, not as a guess', ctx.dayMode === null, String(ctx.dayMode));
  ctx.$ = was$;
}

// ── the server ──────────────────────────────────────────────────────────────
const AREAS = sctx.PROC_AREA_COLUMNS_;
const HEADER = ['Date', 'Hour', 'BONUS']
  .concat(AREAS.map(a => a.stdHeader)).concat([sctx.PROC_TOTAL_HEADER_])
  .concat(AREAS.map(a => a.volHeader)).concat([sctx.PROC_OS_HEADER_, sctx.PROC_OS_TIME_HEADER_]);
// One pivot row, as the notebook writes it, in the first area.
function srow(d, h, m, bonus) {
  const r = [blk(d, h, m), h, bonus];
  AREAS.forEach((a, i) => r.push(i === 0 ? 0.25 : 0));
  r.push(0.25);
  AREAS.forEach((a, i) => r.push(i === 0 ? 10 : 0));
  r.push('NO', '');
  return r;
}
const opened = [];
function sheetFile(rows, b2) {
  const lines = [HEADER.join('|')].concat(rows.map(r => r.join('|')));
  const backend = { getName: () => 'Backend', getLastRow: () => lines.length,
                    getRange: () => ({ getDisplayValues: () => lines.map(l => [l]) }) };
  const cells = { A2: 0.05, B2: b2 || new Date(2026, 8, 24, 0, 0), G3: '' };
  const front = { getRange: c => ({ getValue: () => cells[c], getDisplayValue: () => String(cells[c]) }) };
  const source = { getLastRow: () => rows.length + 1 };
  return { getSheets: () => [backend],
           getSheetByName: n => (n === 'Front' ? front : n === 'Processed Data (15mins)' ? source : null) };
}
const FILES = {
  U22: sheetFile([srow(22, 7, 45, 'NXT'), srow(22, 20, 0, 'NXT'), srow(22, 21, 0, 'OTHER')]),
  U23: sheetFile([srow(23, 7, 15, 'AAA'), srow(23, 23, 45, 'NXT')]),
  U24: sheetFile([srow(24, 0, 30, 'MORN'), srow(24, 5, 45, 'NXT'), srow(24, 7, 0, 'NXT'),
                  srow(24, 7, 0, 'LATE'), srow(24, 22, 0, 'NXT')]),
  LIVE: sheetFile([srow(24, 1, 0, 'LIVEONLY')])
};
sctx.SpreadsheetApp = {
  openByUrl: u => { opened.push(u); if (!FILES[u]) throw new Error('no file ' + u); return FILES[u]; },
  getActiveSpreadsheet: () => { opened.push('LIVE'); return FILES.LIVE; }
};
let LINKS = [{ name: '22/09/2026', url: 'U22' }, { name: '23/09/2026', url: 'U23' },
             { name: '24/09/2026', url: 'U24' }];
sctx.getArchiveLinks = () => LINKS;
const decode = p => ctx.decodeSideRowsPak_(p.rows || p.rawSideData, p.sideSchema);
const names = rows => rows.map(r => r.bonus + '@' + r.timeRange.slice(0, 16)).sort().join(', ');

head('[7] the server: the date alone, and the next morning beside it');
{
  const p = sctx.getDashboardData('U23');
  const day = ctx.decodeSideRowsPak_(p.rawSideData, p.sideSchema);
  const next = ctx.decodeSideRowsPak_(p.nextDayRows, p.sideSchema);
  check('rawSideData is still the date alone - the Claims email reads it',
        day.length === 2 && day.every(r => on(r, 23)), names(day));
  check('the morning after comes from that date\'s own archive when it has one',
        names(next) === 'MORN@24/09/2026 00:30, NXT@24/09/2026 05:45', names(next));
  check('and stops at 06:00', !next.some(r => hourOf(r) >= 6));
  check('bonusList is the date\'s, not the morning\'s', !p.bonusList.includes('MORN'), p.bonusList.join());
  check('the payload says which date it is', p.archiveDate === '23/09/2026', p.archiveDate);

  LINKS = LINKS.filter(l => l.url !== 'U24');
  const q = sctx.getDashboardData('U23');
  check('and from the live file when it has not been archived yet',
        names(ctx.decodeSideRowsPak_(q.nextDayRows, q.sideSchema)) === 'LIVEONLY@24/09/2026 01:00',
        names(ctx.decodeSideRowsPak_(q.nextDayRows, q.sideSchema)));
  LINKS.push({ name: '24/09/2026', url: 'U24' });

  const live = sctx.getDashboardData();
  check('Live carries neither field', live.archiveDate === undefined && live.nextDayRows === undefined);
}

head('[8] the server: the edges, for the bonus numbers asked about');
{
  const e = sctx.getEdgeRows('23/09/2026', ['nxt']);
  check('08:00 the day before to 22:00 the day after, that person only',
        names(decode(e)) === 'NXT@22/09/2026 20:00, NXT@24/09/2026 07:00', names(decode(e)));
  check('nothing the payload already brought comes twice',
        !decode(e).some(r => on(r, 24) && hourOf(r) < 6));
  let threw = '';
  try { sctx.getEdgeRows('2026-09-23', ['NXT']); } catch (x) { threw = x.message; }
  check('a date that is not dd/mm/yyyy is refused', /not a date/.test(threw), threw);
  opened.length = 0;
  const none = sctx.getEdgeRows('23/09/2026', ['<b>', 'a-b']);
  check('bonus numbers that are not bonus numbers read nothing at all',
        none.rows.length === 0 && opened.length === 0, opened.join());
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
