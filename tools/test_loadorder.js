// How the dashboard loads: what it shows while it waits, and what it is
// allowed to ask for before the data it depends on has arrived.
//
// Three separate bugs are pinned here, all of which were live:
//   - a date change fired the log fetches BEFORE the payload, so the three log
//     pages asked the server for the previous day and drew the answer as if it
//     were the new one;
//   - the Claims page re-skeletoned on every automatic refresh, once a minute;
//   - generateMainRows_ re-scanned every row once per time block.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

const INIT = R('Web - JsInit.html');
const UI = R('Web - JsUi.html');
const STATE = R('Web - JsState.html');
const DATA = R('Web - JsData.html');
const OS = R('Web - JsPageOs.html');
const NPL = R('Web - JsPageNpl.html');
const FRAUD = R('Web - JsPageFraud.html');
const PROG = R('Web - JsProgress.html');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

head('[1] a date change asks for nothing until the new day has arrived');
{
  check('the hold goes up in the date handler, before anything is marked',
        /logFetchesHeldPak_ = true;[\s\S]{0,200}osMarkControlChangedPak_\(\);/.test(INIT),
        'marking is fine; it is the FETCH that must wait');
  check('and comes down only after the payload has been applied',
        INIT.indexOf('applyLocalFiltersPak();') < INIT.indexOf('releaseLogFetchesPak_();'),
        'timeRanges and rawSideData are replaced by then, and not before');
  check('all three pages honour it',
        /if \(!logFetchesHeldPak_\) osFetchLogPak_\(false\);/.test(OS) &&
        /if \(!logFetchesHeldPak_\) nplFetchLogPak_\(false\);/.test(NPL) &&
        /if \(!logFetchesHeldPak_\) fraudFetchLogsPak_\(false\);/.test(FRAUD));
  check('their silent-refresh paths honour it too',
        /osLogNeedsRefresh && !logFetchesHeldPak_/.test(OS) &&
        /nplLogNeedsRefresh && !logFetchesHeldPak_/.test(NPL) &&
        /fraudLogNeedsRefresh && !logFetchesHeldPak_/.test(FRAUD));
  check('the release is a no-op when no hold was taken',
        /function releaseLogFetchesPak_\(\) \{\s*\n\s*if \(!logFetchesHeldPak_\) return;/.test(UI),
        'an ordinary refresh must not be dragged through the date-change path');
}

head('[2] and then all three start, not just the one on screen');
{
  check('the release kicks off each page',
        /ensureOsLogPak_\(\);[\s\S]{0,120}ensureNplLogPak_\(\);[\s\S]{0,120}ensureFraudLogsPak_\(\);/
          .test(UI),
        'the reader who changed the date is about to open one of them');
  check('by putting the state back to null first',
        /logFetchesHeldPak_ = false;[\s\S]{0,200}osLogState = null;[\s\S]{0,80}fraudLogState = null;/
          .test(UI),
        'a different day is different data - nothing held is still the answer');
  check('but it does NOT clear the rows',
        !/releaseLogFetchesPak_[\s\S]{0,400}osLogRows = \[\]/.test(UI),
        'they stay on screen under the bar until the new day lands');
}

head('[3] a skeleton only on a first paint');
{
  [['OS', OS, 'osLogEverLoaded', 'osBody', 'oslog'],
   ['NPL', NPL, 'nplLogEverLoaded', 'nplBody', 'npllog'],
   ['Claims', FRAUD, 'fraudLogEverLoaded', 'fraudBody', 'claims']].forEach(function (p) {
    const [name, src, flag, host, key] = p;
    check(name + ': a re-read shows the bar and keeps its rows',
          new RegExp('if \\(' + flag + '\\) \\{\\s*\\n\\s*progressAttachBarPak_\\(\'' +
                     host + '\', \'' + key + '\'\\);').test(src),
          'the skeleton is only honest when there is nothing on screen yet');
    check(name + ": and 'loading' is not then mistaken for an error",
          new RegExp("!== 'ready' && [a-zA-Z]+ !== 'loading'").test(src),
          'falling through to the error branch would print the word "loading"');
  });
  check('the bar is a sibling of the content, not inside it',
        /host\.parentNode\.insertBefore\(wrap, host\)/.test(PROG),
        'each page rewrites its own innerHTML from several places');
  // The dashboard's bar was STARTED on every load and never once seen: the
  // only markup carrying data-progress="dashboard" is inside #loadingOverlay,
  // and the next line of the same function takes that overlay's .active off.
  check('the dashboard bar is ATTACHED to visible content, not just started',
        /progressAttachBarPak_\('swipeContainer', 'dashboard'\)/.test(INIT) &&
        !/progressStartPak_\('dashboard'\)/.test(INIT),
        'starting a bar inside the overlay this same function hides shows nobody anything');
  check('and its host is outside the overlay it used to live in',
        !/id="loadingOverlay"[\s\S]{0,400}id="swipeContainer"/.test(R('Web - Index.html')));
  check('and it is removed when the fetch ends, wherever that happens',
        /progressDetachBarPak_\(key\);/.test(PROG) &&
        PROG.indexOf('function progressEndPak_') < PROG.indexOf('progressDetachBarPak_(key);'),
        'hung off progressEndPak_ so no call site has to remember');
}

head('[4] Claims refreshes silently, like the other two');
{
  check('the payload marks it rather than dropping it',
        /if \(fraudLogEverLoaded\) \{\s*\n\s*fraudLogNeedsRefresh = true;\s*\n\s*\} else \{/.test(INIT),
        'it was fraudLogState = null unconditionally - a skeleton every minute');
  check('the flag pair exists beside the other two pages\'',
        /var fraudLogEverLoaded = false;/.test(STATE) &&
        /var fraudLogNeedsRefresh = false;/.test(STATE));
  check('ensureFraudLogsPak_ has the silent branch it never had',
        /fraudLogState === 'ready' && fraudLogNeedsRefresh/.test(FRAUD) &&
        /fraudLogNeedsRefresh = false;\s*\n\s*fraudFetchLogsPak_\(true\);/.test(FRAUD));
  check('a silent failure keeps the table rather than replacing it with an error',
        /if \(failed && silent\) \{[\s\S]{0,140}console\.warn/.test(FRAUD),
        'the next refresh simply tries again');
  check('and everLoaded is only set on a real success',
        /if \(!failed\) fraudLogEverLoaded = true;/.test(FRAUD));
}

head('[5] generateMainRows_ groups once instead of scanning per block');
{
  check('the per-block full scan is gone',
        !/data\.filter\(function\(r\) \{ return r\.timeRange === tr; \}\)/.test(DATA),
        '96 blocks x tens of thousands of rows, twice per filter apply');
  check('replaced by one pass into a map',
        /var byRange = Object\.create\(null\);/.test(DATA) &&
        /byRange\[key\]\.push\(data\[i\]\);/.test(DATA) &&
        /var blockData = byRange\[tr\] \|\| \[\];/.test(DATA));
  // All THREE builders had the same scan. One helper, three call sites - a
  // second copy would be a second thing to remember when this is next touched.
  check('and all three builders share one grouping helper',
        /function groupByTimeRangePak_\(data\)/.test(DATA) &&
        (DATA.match(/groupByTimeRangePak_\(data\)/g) || []).length === 4,
        'the definition plus one call each from main, trend and area rows');
  check('a null-prototype map, since the keys are data',
        /Object\.create\(null\)/.test(DATA),
        "'__proto__' as a time range would otherwise resolve to Object.prototype");

  // Run it: the grouping must produce exactly what the filter produced,
  // including an empty array for a block nothing falls in.
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(DATA.slice(DATA.indexOf('function groupByTimeRangePak_'),
                             DATA.indexOf('function generateMainRows_')), ctx);
  ctx.generateMainRows_ = ctx.groupByTimeRangePak_;
  const rows = [
    { timeRange: 'A', v: 1 }, { timeRange: 'B', v: 2 },
    { timeRange: 'A', v: 3 }, { timeRange: '__proto__', v: 4 }
  ];
  const grouped = ctx.generateMainRows_(rows, [], {});
  check('rows land in their own bucket, in order',
        grouped['A'].length === 2 && grouped['A'][0].v === 1 && grouped['A'][1].v === 3,
        JSON.stringify(grouped['A']));
  check('one row, one bucket', grouped['B'].length === 1);
  check("and '__proto__' is a bucket like any other",
        Array.isArray(grouped['__proto__']) && grouped['__proto__'].length === 1,
        'a plain {} would have resolved this to Object.prototype and thrown');
}

head('[6] the last warehouse hands over to the OTHER one, whichever it is');
// A fixed fallback is right exactly half the time. It was 'e1e2', so unticking
// the last E1/E2 "fell back" to E1/E2: the tick never moved and the toast
// announced a switch to the warehouse being removed. The regex test that used
// to live here passed throughout, which is why both directions now RUN.
{
  check('the fallback is chosen relative to what was just unticked',
        /var fallback = warehouseFallbackFor_\(key\);/.test(UI) &&
        /function warehouseFallbackFor_\(removedKey\)/.test(UI));
  check('no fixed fallback constant survives',
        !/WAREHOUSE_FALLBACK_/.test(UI),
        'a named one cannot be right for both warehouses');
  check('and it still says what happened',
        /At least one warehouse stays selected/.test(UI));
  check('the toggle no longer has an early return that skips the commit',
        !/showToastPak\('Pick at least one warehouse'\);\s*\n\s*return;/.test(UI));

  // Run the real thing, both ways round. `toggleWarehouse_` commits through
  // setSiteFilter_, so that is stubbed to record what it was asked for.
  function harness(startAt) {
    const ctx = {
      siteFilter: startAt,
      toasts: [],
      showToastPak: function (m) { ctx.toasts.push(m); },
      setSiteFilter_: function (v) { ctx.siteFilter = v; },
      renderWarehouseMenu_: function () {},
      document: { getElementById: () => null }
    };
    vm.createContext(ctx);
    vm.runInContext(UI.slice(UI.indexOf('var WAREHOUSE_OPTIONS_'),
                             UI.indexOf('function renderWarehouseMenu_')), ctx);
    vm.runInContext(UI.slice(UI.indexOf('function toggleWarehouse_'),
                             UI.indexOf('function toggleWarehouseMenu_')), ctx);
    return ctx;
  }

  const fromE3 = harness('e3');
  fromE3.toggleWarehouse_('e3');
  check('unticking the last E3 switches to E1/E2',
        fromE3.siteFilter === 'e1e2', fromE3.siteFilter);
  check('and the toast names E1/E2',
        /switched to E1\/E2/.test(fromE3.toasts.join('|')), fromE3.toasts.join('|'));

  // The direction that was broken.
  const fromE1E2 = harness('e1e2');
  fromE1E2.toggleWarehouse_('e1e2');
  check('unticking the last E1/E2 switches to E3',
        fromE1E2.siteFilter === 'e3', fromE1E2.siteFilter);
  check('and the toast names E3, not the one just removed',
        /switched to E3/.test(fromE1E2.toasts.join('|')), fromE1E2.toasts.join('|'));

  // Neither direction may ever land back on what was unticked.
  ['e3', 'e1e2'].forEach(function (k) {
    const h = harness(k);
    h.toggleWarehouse_(k);
    check('unticking ' + k + ' never lands back on ' + k, h.siteFilter !== k, h.siteFilter);
  });

  // And the ordinary narrowing case still just narrows, with no toast at all.
  const both = harness('all');
  both.toggleWarehouse_('e3');
  check('unticking one of two still just narrows',
        both.siteFilter === 'e1e2' && both.toasts.length === 0,
        both.siteFilter + ' toasts=' + both.toasts.length);
  const both2 = harness('all');
  both2.toggleWarehouse_('e1e2');
  check('...in the other direction too',
        both2.siteFilter === 'e3' && both2.toasts.length === 0,
        both2.siteFilter + ' toasts=' + both2.toasts.length);

  const ctx = harness('e3');
  check('both ticked still reads as "all"',
        ctx.warehouseKeyFor_(['e1e2', 'e3']) === 'all');
}

// ── the answer drawn is the answer to the LAST question ───────────────────
// A google.script.run call cannot be cancelled. Pick 23/09, then 24/09 while
// 23/09 is still loading, and both are answered - in whatever order the
// server finishes them. Whichever landed last used to be drawn, so the charts
// could show 23/09 under a date control reading 24/09.

// One named function, lifted out whole by matching its braces.
function fnSource(src, name) {
  const s = src.replace(/\r\n/g, '\n');
  const start = s.indexOf('function ' + name + '(');
  let depth = 0, i = s.indexOf('{', start);
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) break;
  }
  return s.slice(start, i + 1);
}

// A google.script.run that holds every call until the test answers it.
function fakeRunner(calls) {
  return {
    script: {
      get run() {
        const h = {};
        const r = {
          withSuccessHandler(f) { h.ok = f; return r; },
          withFailureHandler(f) { h.err = f; return r; }
        };
        ['getDashboardData', 'getDashboardDataRange', 'getOsLogRows', 'getNplLogRows'].forEach(m => {
          r[m] = function () { calls.push({ method: m, args: [].slice.call(arguments), h: h }); };
        });
        return r;
      }
    }
  };
}

function fakeEl() {
  return { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } };
}

head('[7] a dashboard load overtaken by a newer one is dropped, not drawn');
{
  const calls = [], drawn = [];
  const els = { status: fakeEl(), loadingOverlay: fakeEl() };
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    google: fakeRunner(calls),
    $: id => els[id] || null,
    document: { body: { classList: { add() {}, remove() {} } }, querySelectorAll: () => [],
                activeElement: null, getElementById: () => null },
    fetchSeqPak_: { dash: 0, os: 0, npl: 0, fraud: 0 },
    tourActive: false, customRangeQuery: null, currentArchiveUrl: null, currentPage: 0,
    lastRealPayload: null,
    progressAttachBarPak_() {}, progressEndPak_() {},
    savePayloadCache_() {}, setChartAnimationEnabled_() {},
    escapeAttrPak: s => s,
    renderDashboardPayload_: d => { drawn.push(d.day); }
  };
  vm.createContext(ctx);
  vm.runInContext(fnSource(INIT, 'loadDataPak'), ctx);

  ctx.loadDataPak('U23');
  ctx.loadDataPak('U24');
  check('both requests went out - neither can be cancelled', calls.length === 2);

  calls[1].h.ok({ day: '24/09' });      // the newer one lands FIRST...
  calls[0].h.ok({ day: '23/09' });      // ...and the older one after it
  check('only the newest answer is drawn, whichever order they land in',
        drawn.join() === '24/09', drawn.join());
  check('and the view it records is the newest one too',
        ctx.currentArchiveUrl === 'U24', ctx.currentArchiveUrl);

  // The other order, which is the one that used to be harmless.
  calls.length = 0; drawn.length = 0;
  ctx.loadDataPak('U23');
  ctx.loadDataPak('U24');
  calls[0].h.ok({ day: '23/09' });
  calls[1].h.ok({ day: '24/09' });
  check('in order, the older one is still dropped rather than flashed first',
        drawn.join() === '24/09', drawn.join());

  // An overtaken load that FAILS must not put an error up over the one
  // that is still on its way.
  calls.length = 0; drawn.length = 0; els.status.innerHTML = '';
  ctx.loadDataPak('U23');
  ctx.loadDataPak('U24');
  calls[0].h.err({ message: 'timed out' });
  check('an overtaken load failing leaves the status alone',
        els.status.innerHTML.indexOf('timed out') === -1, els.status.innerHTML);
  calls[1].h.ok({ day: '24/09' });
  check('and the newest still draws', drawn.join() === '24/09', drawn.join());
}

head('[8] a log read for the date just left is dropped, even before its replacement starts');
{
  const calls = [];
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    google: fakeRunner(calls),
    fetchSeqPak_: { dash: 0, os: 0, npl: 0, fraud: 0 },
    logFetchesHeldPak_: false, currentArchiveUrl: null,
    osLogRows: ['old'], osLogSkipped: 0, osLogBad: [], osLogState: 'loading', osLogEverLoaded: false,
    nplLogRows: ['old'], nplLogSkipped: 0, nplLogBad: [], nplLogState: 'loading', nplLogEverLoaded: false,
    fraudOsRows: ['old'], fraudNplRows: ['old'], fraudLogState: 'loading', fraudLogEverLoaded: false,
    osLogWantDates_: () => ['23/09/2026'], fraudWantDatesPak_: () => ['23/09/2026'],
    progressEndPak_() {},
    renders: { os: 0, npl: 0, fraud: 0 }
  };
  ctx.renderOsPagePak = () => { ctx.renders.os++; };
  ctx.renderNplPagePak = () => { ctx.renders.npl++; };
  ctx.renderFraudPagePak = () => { ctx.renders.fraud++; };
  vm.createContext(ctx);
  vm.runInContext(fnSource(OS, 'osFetchLogPak_') + '\n' + fnSource(NPL, 'nplFetchLogPak_') + '\n' +
                  fnSource(FRAUD, 'fraudFetchLogsPak_') + '\n' + fnSource(INIT, 'beginNewViewPak_'), ctx);

  ctx.osFetchLogPak_(false);
  ctx.nplFetchLogPak_(false);
  ctx.fraudFetchLogsPak_(false);
  check('all four log reads went out for 23/09', calls.length === 4, String(calls.length));

  ctx.beginNewViewPak_();                // 24/09 picked while they are in the air
  calls.forEach(c => c.h.ok({ rows: [{ bonus: 'A23' }] }));
  check('the OS page keeps what it had rather than drawing 23/09 under 24/09',
        ctx.osLogRows[0] === 'old' && ctx.renders.os === 0, JSON.stringify(ctx.osLogRows));
  check('so does NPL', ctx.nplLogRows[0] === 'old' && ctx.renders.npl === 0);
  check('and Claims, both halves of it',
        ctx.fraudOsRows[0] === 'old' && ctx.fraudNplRows[0] === 'old' && ctx.renders.fraud === 0);
  check('nor is any of them marked ready - the new date is still to come',
        ctx.osLogState === 'loading' && ctx.nplLogState === 'loading' && ctx.fraudLogState === 'loading');

  // The replacement read, once the payload is in, is answered normally.
  calls.length = 0;
  ctx.osFetchLogPak_(false);
  calls[0].h.ok({ rows: [{ bonus: 'B24' }] });
  check('the read started after the change is drawn',
        ctx.osLogRows[0].bonus === 'B24' && ctx.osLogState === 'ready' && ctx.renders.os === 1);

  // Two reads of the SAME view overlapping - a refresh landing behind a newer
  // one - is the same race by a different route.
  calls.length = 0;
  ctx.osFetchLogPak_(true);
  ctx.osFetchLogPak_(true);
  calls[1].h.ok({ rows: [{ bonus: 'NEW' }] });
  calls[0].h.ok({ rows: [{ bonus: 'STALE' }] });
  check('an older refresh landing late does not overwrite a newer one',
        ctx.osLogRows[0].bonus === 'NEW', ctx.osLogRows[0].bonus);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
