// A handful of small, unrelated UI fixes, grouped here rather than given a
// file each:
//   - the active-filter banner's own margin stacking on top of the page's
//     top padding, leaving a bare white seam above whatever came next;
//   - the SAME "how much time is this" label restated four times, one of
//     which had drifted to a different answer entirely (raw minutes, never
//     converted to hours);
//   - the filtered-bonus row highlight the Claims page got but the OS and
//     NPL record tables never did, even though the breakdown TREE above them
//     already had one.
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

const CSS = R('Web - Styles.html');
const INDEX = R('Web - Index.html');
const TABLES = R('Web - JsTables.html');
const UI = R('Web - JsUi.html');
const OS = R('Web - JsPageOs.html');
const NPL = R('Web - JsPageNpl.html');
const HELPERS = R('Web - JsHelpers.html');

head('[1] the active-filter banner has no margin of its own');
// It sits OUTSIDE .page (see Web - Index.html), so .page's own top padding
// already gives every page the same space above its first element - a margin
// here stacks on top of that, not instead of it.
{
  const bannerBlock = CSS.slice(CSS.indexOf('.active-filter-banner {'),
                                CSS.indexOf('.active-filter-banner.active'));
  // Comments stripped first: the block's own explanatory comment SAYS
  // "margin-bottom" while arguing against having one, which a plain text
  // search cannot tell apart from an actual declaration.
  const bannerRules = bannerBlock.replace(/\/\*[\s\S]*?\*\//g, '');
  check('no margin-bottom on the banner itself', !/margin-bottom/.test(bannerRules), bannerRules);
  check('the banner sits outside .page, so .page\'s own padding is what remains',
        INDEX.indexOf('activeFilterBanner') < INDEX.indexOf('id="swipeContainer"'),
        'if it moved inside .page, the seam would come back as double padding');
}

head('[2] one "how much time is this" label, not four');
// hoursLabelPak_ in Web - JsHelpers.html. Three call sites used to restate
// the same whole-hour/fractional split by hand (and disagreed on decimal
// places), and the OS/NPL pages never converted to hours at all - "1440 min"
// where every other page would say "24 hrs".
{
  check('it is defined once, in the shared helpers file',
        /function hoursLabelPak_\(minutes\)/.test(HELPERS));
  check('the Bonus page range badge calls it',
        /badge\.textContent = blockCount \+ ' block' \+ \(blockCount !== 1 \? 's' : ''\) \+ ' · ' \+ hoursLabelPak_\(minutes\);/
          .test(TABLES));
  check('the Head Deployed breakdown modal calls it too',
        /if \(badge\) badge\.textContent = blockCount \+ ' block' \+ \(blockCount !== 1 \? 's' : ''\) \+ ' · ' \+ hoursLabelPak_\(minutes\);/
          .test(UI));
  check('the OS page range badge calls it',
        /hoursLabelPak_\(Math\.round\(\(win\.finish - win\.start\) \/ 60000\)\)/.test(OS));
  check('the NPL page range badge calls it',
        /hoursLabelPak_\(Math\.round\(\(win\.finish - win\.start\) \/ 60000\)\)/.test(NPL));
  check('and none of the four restates the old inline formula any more',
        !/Number\.isInteger\(hours\) \? hours \+ ' hr'/.test(TABLES) &&
        !/Number\.isInteger\(hours\) \? hours \+ ' hr'/.test(UI) &&
        !/' min'\)\s*\n\s*: '-';/.test(OS) &&
        !/' min'\)\s*\n\s*: '-';/.test(NPL),
        'a leftover copy would drift from this one the next time either changed');

  // Run it for real.
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(strip(HELPERS), ctx);
  check('under an hour reads as minutes', ctx.hoursLabelPak_(45) === '45 min', ctx.hoursLabelPak_(45));
  check('zero minutes is zero minutes, not "0 hrs"',
        ctx.hoursLabelPak_(0) === '0 min', ctx.hoursLabelPak_(0));
  check('exactly one hour is singular', ctx.hoursLabelPak_(60) === '1 hr', ctx.hoursLabelPak_(60));
  check('a whole number of hours is plural and has no decimal point',
        ctx.hoursLabelPak_(180) === '3 hrs', ctx.hoursLabelPak_(180));
  check('a fractional hour is TWO decimal places, not one',
        ctx.hoursLabelPak_(225) === '3.75 hrs', ctx.hoursLabelPak_(225));
  check('...even when one decimal place would have looked exact',
        ctx.hoursLabelPak_(90) === '1.50 hrs', ctx.hoursLabelPak_(90));
  check('a full day converts rather than showing 1440 min',
        ctx.hoursLabelPak_(1440) === '24 hrs', ctx.hoursLabelPak_(1440));
}

head('[3] the OS and NPL record tables highlight a filtered row, like Claims');
// .record-row-selected is scoped to .record-table generically (Web - Styles),
// so one rule covers Claims, OS and NPL rather than three copies of it - see
// test_fraudpage.js [13], test_ospage.js [7b] and test_nplpage.js [8b] for the
// per-page render checks; this just confirms the shared CSS itself.
{
  check('the rule lives on .record-table, not on any one page\'s table class',
        /\.record-table tbody tr\.record-row-selected td \{ background: var\(--accent-8\); \}/.test(CSS));
  check('and nothing re-declares it under .fraud-table specifically any more',
        !/\.fraud-table tbody tr\.(fraud|record)-row-selected/.test(CSS),
        'a page-specific copy is exactly the drift a shared rule exists to prevent');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
