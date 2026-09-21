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

head('[6] the last warehouse cannot be unticked away');
{
  check('an empty selection falls back rather than refusing the click',
        /if \(sel\.length === 0\) \{\s*\n\s*sel = \[WAREHOUSE_FALLBACK_\];/.test(UI),
        'refusing left the tick where the reader had just tried to remove it');
  check('the fallback is named once, not spelled inline',
        /var WAREHOUSE_FALLBACK_ = 'e1e2';/.test(UI));
  check('and it still says what happened',
        /At least one warehouse stays selected/.test(UI));
  check('the toggle no longer has an early return that skips the commit',
        !/showToastPak\('Pick at least one warehouse'\);\s*\n\s*return;/.test(UI));

  // Run the projection helpers for real.
  const ctx = { siteFilter: 'e3', document: { getElementById: () => null } };
  vm.createContext(ctx);
  const from = UI.indexOf('var WAREHOUSE_OPTIONS_');
  vm.runInContext(UI.slice(from, UI.indexOf('function renderWarehouseMenu_')), ctx);
  check('E3 alone is a legal selection',
        ctx.warehouseSelection_().join() === 'e3');
  check('and the fallback names a real option',
        ctx.warehouseLabelFor_(ctx.WAREHOUSE_FALLBACK_) === 'E1/E2',
        ctx.warehouseLabelFor_(ctx.WAREHOUSE_FALLBACK_));
  check('both ticked still reads as "all"',
        ctx.warehouseKeyFor_(['e1e2', 'e3']) === 'all');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
