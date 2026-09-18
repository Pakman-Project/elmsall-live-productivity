// Potential Fraudulent Claims — where an OS or NPL claim overlaps hours the
// pivot says were actually produced.
//
// The dangerous part is the BLOCK RULE, and it is dangerous in both directions.
// Too loose and the page accuses people whose claim merely touched a block
// somebody else's work landed in; too tight and it clears a claim that really
// did overlap. The spec is exact - only blocks lying WHOLLY inside the claim
// count - and 05:55-06:40 is the worked example it came with, so that case is
// pinned here directly.
//
// The other half is the WINDOW: a production day runs 06:00 to 06:00, so the
// day on the date control is not the calendar day, and a claim running past
// midnight belongs to the day it started in.
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
// In this order: the Claims page reads the OS page's spell walk.
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);
vm.runInContext(strip(R('Web - JsPageFraud.html')), ctx);
ctx.selectedBonuses = [];

const PAGE = R('Web - JsPageFraud.html');
const INDEX = R('Web - Index.html');

const at = (h, m, d) => new Date(2026, 8, d || 18, h, m);
const blocks = (a, b) => ctx.fraudFullBlocksPak_(a, b)
  .map(t => { const d = new Date(t); return ctx.fraudTimeTextPak_(d); });

head('[1] only the blocks lying WHOLLY inside a claim count');
// The worked example from the spec, first and by itself: a claim of
// 05:55-06:40 covers 06:00-06:15 and 06:15-06:30 and nothing else. The 05:45
// block started before the claim did; the 06:30 block ends after it.
{
  check('05:55-06:40 is exactly 06:00 and 06:15',
        blocks(at(5, 55), at(6, 40)).join() === '06:00,06:15',
        blocks(at(5, 55), at(6, 40)).join() || '(none)');
  check('a claim sitting exactly on the quarters keeps both ends',
        blocks(at(6, 0), at(6, 30)).join() === '06:00,06:15',
        blocks(at(6, 0), at(6, 30)).join());
  check('one minute short of a boundary loses that block',
        blocks(at(6, 0), at(6, 29)).join() === '06:00',
        blocks(at(6, 0), at(6, 29)).join());
  check('one minute late starting loses the first',
        blocks(at(6, 1), at(6, 30)).join() === '06:15',
        blocks(at(6, 1), at(6, 30)).join());
  check('a claim shorter than a block covers none of them',
        blocks(at(6, 5), at(6, 14)).length === 0,
        String(blocks(at(6, 5), at(6, 14)).length));
  check('...even when it straddles a boundary',
        blocks(at(6, 10), at(6, 20)).length === 0,
        blocks(at(6, 10), at(6, 20)).join());
  // A long claim, to be sure the walk does not stop early or run away.
  check('a four-hour claim covers sixteen blocks',
        ctx.fraudFullBlocksPak_(at(8, 0), at(12, 0)).length === 16,
        String(ctx.fraudFullBlocksPak_(at(8, 0), at(12, 0)).length));
  check('a claim over midnight keeps counting',
        ctx.fraudFullBlocksPak_(at(23, 30), at(24 + 1, 0)).length === 6,
        String(ctx.fraudFullBlocksPak_(at(23, 30), at(24 + 1, 0)).length));
  check('a backwards or empty claim covers nothing',
        ctx.fraudFullBlocksPak_(at(8, 0), at(7, 0)).length === 0 &&
        ctx.fraudFullBlocksPak_(at(8, 0), at(8, 0)).length === 0,
        'the loop covers this on its own; there is deliberately no guard for it');
  // Caught, not just compared: without the guard this does not return the
  // wrong answer, it THROWS - .getTime() on null - and a bare comparison
  // would take the whole suite down with it rather than failing one check.
  const safeBlocks = (a, b) => {
    try { return ctx.fraudFullBlocksPak_(a, b).length; }
    catch (e) { return 'threw: ' + e.message; }
  };
  check('a missing start or finish is not walked',
        safeBlocks(null, at(8, 0)) === 0 && safeBlocks(at(8, 0), null) === 0,
        String(safeBlocks(at(8, 0), null)));
  check('the blocks come back in order, earliest first',
        (() => { const b = ctx.fraudFullBlocksPak_(at(8, 0), at(10, 0));
                 return b.every((t, i) => i === 0 || t > b[i - 1]); })());
}

head('[2] the window is a production day, not a calendar one');
{
  check('06:00 to 06:00', /var FRAUD_DAY_START_HOUR_ = 6;/.test(PAGE));
  check('and exactly 24 hours of it',
        /new Date\(start\.getTime\(\) \+ 86400000\)/.test(PAGE));
  check('the blocks are quarter hours',
        /var FRAUD_BLOCK_MINUTES_ = 15;/.test(PAGE));
  // The log's Date column IS the production day, so one key covers the whole
  // window - including the hours of it that fall after midnight.
  check('one date key is asked of both logs',
        /\.getOsLogRows\(\[key\], currentArchiveUrl \|\| null\)/.test(PAGE) &&
        /\.getNplLogRows\(\[key\], currentArchiveUrl \|\| null\)/.test(PAGE),
        'the Date column is already the production day; a second key would double-count');
  check('and the key is built from the selected day',
        /var key = fraudDateKeyPak_\(fraudSelectedDayPak_\(\)\);/.test(PAGE));
  check('Live reads the data\'s own clock, not the browser\'s',
        /for \(var i = timeRanges\.length - 1; i >= 0 && !newest; i--\)/.test(PAGE),
        'the browser\'s clock can disagree with the sheet\'s by more than a block');
}

head('[3] any produced hours at all flags the claim');
{
  check('the test is greater than zero, not the Front threshold',
        /if \(std <= 0\) return;/.test(PAGE),
        'the threshold is about whether a block counts as WORKED; this is not that question');
  check('the hours are summed over the covered blocks',
        /std \+= Number\(hit\.value\) \|\| 0;/.test(PAGE));
  check('a claim that cannot be placed on a clock is not judged',
        /var w = osSpellWindowPak_\(row\);\s*\n\s*if \(!w\) return;/.test(PAGE),
        'it has no blocks to check, and guessing at one would be an accusation from nothing');
  check('and one outside the window is not either',
        /if \(w\.finish <= win\.start \|\| w\.start >= win\.finish\) return;/.test(PAGE));
  check('both logs are scanned',
        /fraudOsRows\[i\], 'OS'/.test(PAGE) && /fraudNplRows\[j\], 'NPL'/.test(PAGE));
  check('the worst is listed first',
        /return \(b\.std - a\.std\) \|\|/.test(PAGE),
        'and the bonus number breaks ties, so the same data draws the same way twice');
}

head('[4] work areas come from the one list that names them');
{
  check('read off VOLUME_TYPES, not a second list of names',
        /for \(var i = 0; i < VOLUME_TYPES\.length; i\+\+\)/.test(PAGE) &&
        /into\[t\.label\] = true;/.test(PAGE),
        'a list here would drift from the legend the first time an area was renamed');
  check('an area counts when it carries standard hours',
        /\(Number\(row\[t\.stdKey\]\) \|\| 0\) > 0/.test(PAGE),
        'volume without hours is not what the claim is being checked against');
  // Run it: two areas on one row, one on another, and the union of them.
  const areas = {};
  ctx.fraudAreasOfRowPak_({ rspsPickStd: 0.4, ispsTopUpStd: 0.2, pieStd: 0 }, areas);
  ctx.fraudAreasOfRowPak_({ pieStd: 0.1 }, areas);
  check('the union is named, sorted, and excludes the zeroes',
        Object.keys(areas).sort().join(', ') === 'ISPS Top Up, OSR PiE, RSPS Pick',
        Object.keys(areas).sort().join(', '));
  check('and the page sorts them the same way',
        /areas: Object\.keys\(areas\)\.sort\(\)/.test(PAGE));
}

head('[5] the pivot is read whole, not through the Warehouse picker');
// A claim that stops looking fraudulent because somebody switched building is
// exactly the answer this page must not give.
{
  check('allSideData, with rawSideData only as a fallback',
        (PAGE.match(/allSideData\.length\)\s*\n\s*\? allSideData : rawSideData/g) || []).length === 2,
        'in the index AND in the coverage line, or the two would disagree');
  check('and the page says so on screen',
        /Both buildings, whatever the Warehouse picker says\./.test(PAGE));
  check('the index is keyed on bonus and block together',
        /idx\[String\(r\.bonus\)\.toUpperCase\(\) \+ '\|\|' \+ d\.getTime\(\)\] = r;/.test(PAGE));
  check('and looked up the same way it was built',
        /idx\[String\(row\.bonus\)\.toUpperCase\(\) \+ '\|\|' \+ blocks\[b\]\]/.test(PAGE),
        'one side upper-cased and the other not is a join that silently finds nothing');
}

head('[6] an empty table says WHICH kind of empty it is');
// The dashboard holds a rolling 96 blocks. A window reaching past them is not
// clean, it is unchecked, and those two readings are opposites.
{
  check('the checked span is computed, not assumed',
        /function fraudCoveragePak_\(win\)/.test(PAGE));
  check('clipped to the window at both ends',
        /Math\.max\(lo, win\.start\.getTime\(\)\)/.test(PAGE) &&
        /Math\.min\(hi \+ ms, win\.finish\.getTime\(\)\)/.test(PAGE),
        'the last block is checked to its END, not to its start');
  check('nothing loaded is said outright',
        /None of this production day is loaded yet/.test(PAGE));
  check('and the empty state is careful about what it claims',
        /No claim overlaps produced hours in the part of this day that/.test(PAGE),
        'not "no fraud" - only that none was found in what was checked');
  check('the claim count is shown either way',
        /scan\.claims \+ ' claim'/.test(PAGE) &&
        (PAGE.match(/scan\.claims/g) || []).length >= 2,
        'so "0 to check" out of 40 claims reads differently from 0 out of 0');
}

head('[7] the table names every part of the case');
{
  const cols = /var FRAUD_COLUMNS_ = \[([\s\S]*?)\];/.exec(PAGE);
  check('the six columns, in order',
        !!cols && cols[1].replace(/['\s\n\r]/g, '') ===
          'Bonus,WorkAreas,StdHours,Claim,ClaimTime,TMauthorised',
        cols ? cols[1].replace(/\s+/g, ' ') : 'not declared');
  const w = /var FRAUD_COL_WIDTHS_ = \[([\d,\s]+)\];/.exec(PAGE);
  const nums = w ? w[1].split(',').map(Number) : [];
  check('six widths summing to 100',
        nums.length === 6 && nums.reduce((a, b) => a + b, 0) === 100,
        nums.join('+') + '=' + nums.reduce((a, b) => a + b, 0));
  check('every cell carries the label its phone card shows',
        (PAGE.slice(PAGE.indexOf('function fraudTableHtmlPak_'))
             .match(/<td[^>]*>/g) || []).length ===
        (PAGE.slice(PAGE.indexOf('function fraudTableHtmlPak_'))
             .match(/data-label="/g) || []).length);
  check('the bonus is clickable, like every other on the dashboard',
        /toggleBonusFilter\(/.test(PAGE) && /bonus-tip-host clickable-bonus/.test(PAGE));
  check('a finish past midnight is marked as such',
        /\(to\.getDate\(\) !== from\.getDate\(\)\) \? t \+ ' \(\+1\)' : t/.test(PAGE),
        'two bare clock times cannot say that a claim crossed a date');
  check('the work areas wrap rather than being clipped',
        /\.fraud-areas-cell \{ line-height/.test(R('Web - Styles.html')),
        'which areas they were in is the evidence; half of it is no use');
  check('OS and NPL are told apart in their own column',
        /fraud-kind-' \+ kind\.toLowerCase\(\)/.test(PAGE));
  check('and that chip is neutral, not a verdict colour',
        /\.fraud-kind \{[\s\S]{0,300}color: var\(--muted\)/.test(R('Web - Styles.html')),
        'green, amber and red already mean a decision elsewhere; nothing here is decided');
  // The page is named for what it is: potential.
  check('the page does not call anybody a fraud',
        !/\bis fraud\b|confirmed|guilty/i.test(PAGE) &&
        /Potential Fraudulent Claims/.test(INDEX));
}

head('[8] fetched for the day, and dropped when the day can change');
{
  check('both logs land before the page draws',
        /if \(--pending > 0\) return;/.test(PAGE),
        'one handler drawing early would show OS-only results as if they were all of them');
  check('a failure in either is surfaced, not swallowed',
        /fraudLogState = failed \|\| 'ready';/.test(PAGE));
  check('a control change drops what was fetched',
        /function fraudMarkControlChangedPak_\(\) \{\s*fraudLogState = null;/.test(PAGE) &&
        /fraudMarkControlChangedPak_\(\);/.test(R('Web - JsData.html')),
        'the DATE is a control, and it moves this page\'s whole window');
  check('and so does a refresh',
        /fraudLogState = null;/.test(R('Web - JsInit.html')));
  check('the tour parks it so it cannot fetch mid-demo',
        /fraudLogState = 'ready';/.test(R('Web - JsTour.html')) &&
        R('Web - JsTour.html').indexOf('fraudLogState = null;') >
        R('Web - JsTour.html').indexOf("fraudLogState = 'ready';"));
  check('the page is included after the OS one it borrows from',
        INDEX.indexOf("include('Web - JsPageFraud')") >
        INDEX.indexOf("include('Web - JsPageOs')"),
        'osSpellWindowPak_ would not be defined yet');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
