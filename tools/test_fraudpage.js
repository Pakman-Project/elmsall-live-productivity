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
// In this order, matching Index.html: the Claims page reads the OS page's
// spell walk AND the NPL page's Check chip.
vm.runInContext(strip(R('Web - JsPageOs.html')), ctx);
vm.runInContext(strip(R('Web - JsPageNpl.html')), ctx);
vm.runInContext(strip(R('Web - JsPageFraud.html')), ctx);
ctx.selectedBonuses = [];
// Declared past the point JsState is split at above, and fraudPassesPak_ reads
// all five on every call - so one of them missing is a ReferenceError, not a
// wrong answer.
ctx.fraudBonusFilter = {};
ctx.fraudAreaFilter = {};
ctx.fraudKindFilter = {};
ctx.fraudAuthFilter = {};
ctx.fraudStatusFilter = {};
ctx.fraudSort = { key: 'overlapStd', dir: 'desc' };

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
        /if \(overlapStd <= 0\) return;/.test(PAGE),
        'the threshold is about whether a block counts as WORKED; this is not that question');
  check('the hours are summed over the covered blocks',
        /overlapStd \+= Number\(hit\.value\) \|\| 0;/.test(PAGE));
  check('a claim that cannot be placed on a clock is not judged',
        /var w = osSpellWindowPak_\(row\);\s*\n\s*if \(!w\) return;/.test(PAGE),
        'it has no blocks to check, and guessing at one would be an accusation from nothing');
  check('and one outside the window is not either',
        /if \(w\.finish <= win\.start \|\| w\.start >= win\.finish\) return;/.test(PAGE));
  check('both logs are scanned',
        /fraudOsRows\[i\], 'OS'/.test(PAGE) && /fraudNplRows\[j\], 'NPL'/.test(PAGE));
  check('the worst is listed first, by the OVERLAP figure',
        /return \(b\.overlapStd - a\.overlapStd\) \|\|/.test(PAGE),
        'the total-day figure is large for anyone who simply works a lot; it says nothing about THIS claim');
}

head('[3b] a claim already marked Rejected is left out - it was never paid');
{
  const considerAt = PAGE.indexOf('function consider');
  check('the exclusion runs before the claim is even counted',
        /if \(fraudIsRejectedPak_\(row, kind\)\) return;/.test(PAGE) &&
        PAGE.indexOf('if (fraudIsRejectedPak_(row, kind)) return;', considerAt) <
        PAGE.indexOf('claims++;', considerAt),
        'a rejected claim was never paid, so it is not "checked and clean" - it is not in scope at all');
  check('folded through the same band the OS page itself uses',
        /osStatusBandPak_\(row\.status\) === OS_STATUS_REJECTED_PAK_/.test(PAGE),
        '"Cancelled" or "Withdrawn" are folded to Rejected everywhere else on the dashboard; this should agree');
  check('only ever fires for an OS row',
        /function fraudIsRejectedPak_\(row, kind\) \{\s*return kind === 'OS' &&/.test(PAGE),
        'NPL\'s Check column has no equivalent verdict to exclude on');
  // Run it directly: OS in three verdicts, NPL regardless.
  check('Rejected excludes', ctx.fraudIsRejectedPak_({ status: 'Rejected' }, 'OS') === true);
  check('an unrecognised wording folds to Rejected too',
        ctx.fraudIsRejectedPak_({ status: 'Withdrawn' }, 'OS') === true);
  check('Approved does not exclude',
        ctx.fraudIsRejectedPak_({ status: 'OK' }, 'OS') === false);
  check('a BLANK verdict does not exclude - undecided is not rejected',
        ctx.fraudIsRejectedPak_({ status: '' }, 'OS') === false);
  check('NPL is never excluded by this, whatever Check says',
        ctx.fraudIsRejectedPak_({ check: 'Rejected' }, 'NPL') === false);
}

head('[3c] Total Std Hrs is the whole day, independent of any one claim');
// The figure a reader needs to tell "someone who works a lot, and happened to
// overlap once" apart from "someone whose whole day is one big overlap".
{
  // "dd/mm/yyyy hh:mm - x", matching how every other suite fakes a
  // timeRange - the START half is what parseDateTimePartPak actually reads.
  ctx.allSideData = [
    { bonus: 'AAA', timeRange: '09/09/2026 06:00 - x', value: 0.25 },
    { bonus: 'AAA', timeRange: '09/09/2026 12:00 - x', value: 0.25 },
    { bonus: 'AAA', timeRange: '09/09/2026 18:00 - x', value: 0.25 },
    // Outside the window on the LOW side (before 06:00 on the 9th)...
    { bonus: 'AAA', timeRange: '09/09/2026 00:00 - x', value: 9 },
    // ...and on the HIGH side (at or after 06:00 on the 10th, where the
    // window ends). Both must be excluded - a lower bound alone would pass
    // this row straight through.
    { bonus: 'AAA', timeRange: '10/09/2026 06:00 - x', value: 40 },
    { bonus: 'bbb', timeRange: '09/09/2026 06:00 - x', value: 0.4 }
  ];
  const win = { start: new Date(2026, 8, 9, 6, 0), finish: new Date(2026, 8, 10, 6, 0) };
  const totals = ctx.fraudTotalStdIndexPak_(win);
  check('summed across the whole window, not per block',
        Math.abs(totals.AAA - 0.75) < 1e-9, String(totals.AAA));
  check('the out-of-window row is excluded',
        Math.abs(totals.AAA - 0.75) < 1e-9,
        'a value of 9.75 means the 00:00 row leaked in');
  check('the key is upper-cased, matching how it is looked up',
        totals.BBB === 0.4 && totals.bbb === undefined);
  check('read off allSideData, with rawSideData as the only fallback',
        /function fraudTotalStdIndexPak_\(win\) \{[\s\S]{0,300}allSideData\.length\)/.test(PAGE));
  check('and the page reads it once per bonus, not once per block',
        /var totals = fraudTotalStdIndexPak_\(win\);/.test(PAGE) &&
        /totals\[String\(row\.bonus\)\.toUpperCase\(\)\] \|\| 0/.test(PAGE));
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
        (PAGE.match(/allSideData\.length\)\s*\n\s*\? allSideData : rawSideData/g) || []).length === 3,
        'in the block index, the TOTAL index, and the coverage line, or they would disagree');
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
        /No claim overlaps produced hours in the part of this day/.test(PAGE),
        'not "no fraud" - only that none was found in what was checked');
  check('...and says so differently when the FILTERS are what emptied it',
        /All ' \+ scan\.rows\.length \+ ' of them are filtered out/.test(PAGE),
        '"nothing was found" and "you hid it" need opposite reactions from the reader');
  check('the claim count is shown either way',
        /scan\.claims \+ ' claim'/.test(PAGE) &&
        (PAGE.match(/scan\.claims/g) || []).length >= 2,
        'so "0 to check" out of 40 claims reads differently from 0 out of 0');
}

head('[7] the table names every part of the case');
{
  // ONE list now - heading, width, the row field it reads and how that field
  // sorts. It was two, and sorting was about to make it three: three things
  // kept in the same order by hand is how a column ends up labelled as its
  // neighbour.
  const cols = ctx.FRAUD_COLUMNS_;
  check('the nine columns, in order',
        cols.map(c => c.label).join() ===
          'Bonus,Work Areas,Total Std Hrs,Overlap Std Hrs,Overlap Time,Claim,Claim Time,TM authorised,Status',
        cols.map(c => c.label).join());
  check('nine widths summing to 100',
        cols.length === 9 && cols.reduce((a, c) => a + c.width, 0) === 100,
        cols.map(c => c.width).join('+') + '=' + cols.reduce((a, c) => a + c.width, 0));
  check('every column names the row field it reads, and how it sorts',
        cols.every(c => c.key && c.sort),
        'a heading with no key is a heading that cannot be sorted by');
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
  check('the OVERLAP time range uses the same marker, not just Claim Time',
        /fraudRangeTextPak_\(r\.overlapFrom, r\.overlapTo\)/.test(PAGE));
  check('the work areas wrap rather than being clipped',
        /\.fraud-areas-cell \{ line-height/.test(R('Web - Styles.html')),
        'which areas they were in is the evidence; half of it is no use');
  check('OS and NPL are told apart in their own column',
        /fraud-kind-' \+ kind\.toLowerCase\(\)/.test(PAGE));
  check('and that chip is neutral, not a verdict colour',
        /\.fraud-kind \{[\s\S]{0,300}color: var\(--muted\)/.test(R('Web - Styles.html')),
        'green, amber and red already mean a decision elsewhere; nothing here is decided');
  // Status IS a verdict colour, deliberately unlike Claim - it is the record's
  // own chip, reused rather than redrawn.
  check('Status reuses each page\'s own chip rather than redrawing it',
        /function fraudStatusHtmlPak_\(row, kind\) \{\s*return \(kind === 'OS'\) \? osStatusChipPak_\(row\.status\) : nplCheckChipPak_\(row\.check\);/.test(PAGE),
        'a colour or a wording must not read differently here than it does on the OS/NPL page itself');
  check('...computed once per row and just printed, not rebuilt in the table function',
        /statusHtml: fraudStatusHtmlPak_\(row, kind\)/.test(PAGE) &&
        /<td data-label="Status">' \+ r\.statusHtml \+ '<\/td>/.test(PAGE));
  // The page is named for what it is: potential.
  check('the page does not call anybody a fraud',
        !/\bis fraud\b|confirmed|guilty/i.test(PAGE));
  check('and the on-screen heading says the full name, not a euphemism for it',
        /<span>Potential Fraudulent Claims<\/span>/.test(INDEX),
        '"Claims overlapping produced hours" told the reader what the page DOES, not what it is FOR');
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
  check('and after the NPL one, for its Check chip',
        INDEX.indexOf("include('Web - JsPageFraud')") >
        INDEX.indexOf("include('Web - JsPageNpl')"),
        'nplCheckChipPak_ would not be defined yet');
}

head('[9] five filters, each narrowing the same flat list');
{
  const row = (o) => Object.assign({
    bonus: 'AAA', areas: ['OSR PiE'], kind: 'OS', auth: 'J Ashworth',
    statusText: 'Approved'
  }, o || {});

  // Independent, not cascading: five facets over one flat list is a different
  // shape from OS's zone -> department -> status tree.
  check('each filter is its own set',
        /var fraudBonusFilter = \{\};/.test(R('Web - JsState.html')) &&
        /var fraudAreaFilter = \{\};/.test(R('Web - JsState.html')) &&
        /var fraudKindFilter = \{\};/.test(R('Web - JsState.html')) &&
        /var fraudAuthFilter = \{\};/.test(R('Web - JsState.html')) &&
        /var fraudStatusFilter = \{\};/.test(R('Web - JsState.html')));
  // Sliced to the toggle's OWN body: a windowed regex wide enough to cover it
  // also reaches into clearFraudFilterPak_ right below, where emptying a set
  // is the entire job.
  const toggleBody = PAGE.slice(
    PAGE.indexOf('function toggleFraudFilterPak_'),
    PAGE.indexOf('function clearFraudFilterPak_'));
  check('and none of them clears another',
        !/Filter = \{\}/.test(toggleBody),
        'that is the cascade OS needs and this page does not');

  // Empty means no filter, not nothing - the whole-page-empties trap.
  ctx.fraudBonusFilter = {};
  check('an empty set admits everything', ctx.fraudPassesPak_(row()) === true);

  ctx.fraudBonusFilter = { BBB: true };
  check('a chosen set is a whitelist', ctx.fraudPassesPak_(row()) === false);
  ctx.fraudBonusFilter = { AAA: true };
  check('...and admits what is in it', ctx.fraudPassesPak_(row()) === true);
  ctx.fraudBonusFilter = {};

  // Work Areas is the one matching against a LIST: a claim spanning three
  // areas has to be found by picking any one of them.
  ctx.fraudAreaFilter = { 'ISPS Top Up': true };
  check('Work Areas matches ANY of a row\'s areas',
        ctx.fraudPassesPak_(row({ areas: ['OSR PiE', 'ISPS Top Up'] })) === true,
        'a claim over three areas is found by picking one of them');
  check('...and rejects a row carrying none of them',
        ctx.fraudPassesPak_(row({ areas: ['OSR PiE'] })) === false);
  check('a row with NO areas is rejected once something is picked',
        ctx.fraudPassesPak_(row({ areas: [] })) === false);
  ctx.fraudAreaFilter = {};
  check('but an empty Work Areas filter still admits it',
        ctx.fraudPassesPak_(row({ areas: [] })) === true);

  ctx.fraudKindFilter = { NPL: true };
  check('Claim type filters OS from NPL',
        ctx.fraudPassesPak_(row({ kind: 'OS' })) === false &&
        ctx.fraudPassesPak_(row({ kind: 'NPL' })) === true);
  ctx.fraudKindFilter = {};

  ctx.fraudStatusFilter = { 'No verdict': true };
  check('Status filters on the plain text, not the chip HTML',
        ctx.fraudPassesPak_(row({ statusText: 'No verdict' })) === true &&
        ctx.fraudPassesPak_(row({ statusText: 'Approved' })) === false);
  ctx.fraudStatusFilter = {};

  check('a blank TM is a named option, not a dropped row',
        ctx.fraudAuthValuePak_({ auth: '' }) === '(no TM)',
        'somebody logged a claim nobody has put their name to - that IS the finding');

  // The values offered come from the rows, and a multi-valued field is
  // flattened rather than listed as "OSR PiE, ISPS Top Up".
  const vals = ctx.fraudUniquePak_(
    [row({ areas: ['OSR PiE', 'RSPS Pick'] }), row({ areas: ['OSR PiE'] })],
    function (r) { return r.areas; });
  check('the Work Areas list is flattened and de-duplicated',
        vals.join(' | ') === 'OSR PiE | RSPS Pick', vals.join(' | '));
}

head('[10] the columns sort, by header on a desktop and by dropdown on a phone');
{
  const mk = (o) => Object.assign({
    bonus: 'AAA', areas: ['B'], totalStd: 1, overlapStd: 1,
    overlapFrom: new Date(2026, 8, 18, 8, 0), kind: 'OS',
    from: new Date(2026, 8, 18, 8, 0), auth: 'A', statusText: 'Approved'
  }, o || {});

  ctx.fraudSort = { key: 'overlapStd', dir: 'desc' };
  const byOverlap = ctx.fraudSortRowsPak_(
    [mk({ bonus: 'LOW', overlapStd: 0.1 }), mk({ bonus: 'HIGH', overlapStd: 9 })]);
  check('numbers sort as numbers, biggest first by default',
        byOverlap[0].bonus === 'HIGH', byOverlap.map(r => r.bonus).join());

  ctx.fraudSort = { key: 'totalStd', dir: 'asc' };
  const asc = ctx.fraudSortRowsPak_(
    [mk({ bonus: 'BIG', totalStd: 9 }), mk({ bonus: 'SMALL', totalStd: 1 })]);
  check('and the other way when asked', asc[0].bonus === 'SMALL');

  ctx.fraudSort = { key: 'statusText', dir: 'asc' };
  const caseless = ctx.fraudSortRowsPak_(
    [mk({ bonus: 'B', statusText: 'approved' }), mk({ bonus: 'A', statusText: 'Adjusted' })]);
  check('text sorts case-insensitively',
        caseless[0].statusText === 'Adjusted',
        'or Approved and approved land in two different places');

  ctx.fraudSort = { key: 'overlapFrom', dir: 'asc' };
  const byTime = ctx.fraudSortRowsPak_([
    mk({ bonus: 'LATE', overlapFrom: new Date(2026, 8, 18, 20, 0) }),
    mk({ bonus: 'EARLY', overlapFrom: new Date(2026, 8, 18, 7, 0) })]);
  check('times sort as times, not as their printed text',
        byTime[0].bonus === 'EARLY', byTime.map(r => r.bonus).join());

  ctx.fraudSort = { key: 'areas', dir: 'asc' };
  const byArea = ctx.fraudSortRowsPak_([
    mk({ bonus: 'Z', areas: ['Zulu'] }), mk({ bonus: 'A', areas: ['Alpha', 'Bravo'] })]);
  check('a list column sorts on its joined text', byArea[0].bonus === 'A');

  // A stable order matters on a page somebody reads top-down twice.
  ctx.fraudSort = { key: 'overlapStd', dir: 'desc' };
  const tied = ctx.fraudSortRowsPak_(
    [mk({ bonus: 'ZZZ' }), mk({ bonus: 'AAA' }), mk({ bonus: 'MMM' })]);
  check('the bonus number breaks every tie',
        tied.map(r => r.bonus).join() === 'AAA,MMM,ZZZ',
        tied.map(r => r.bonus).join());

  check('sorting does not mutate the list it was given',
        /return rows\.slice\(\)\.sort\(/.test(PAGE),
        'an in-place sort would reorder the scan behind the filters');

  check('a new column starts descending, the same one flips',
        /fraudSort\.dir = \(fraudSort\.key === key\)\s*\n\s*\? \(fraudSort\.dir === 'asc' \? 'desc' : 'asc'\) : 'desc';/.test(PAGE));
  check('the headers are clickable and say which way they are sorting',
        /onclick="fraudSortByPak_\(/.test(PAGE) &&
        /active-sort ' \+ fraudSort\.dir/.test(PAGE) &&
        /\.fraud-th\.active-sort::after/.test(R('Web - Styles.html')));
  check('the phone gets the Data Table\'s own sort control, not a second design',
        /class="main-sort-mobile fraud-sort-mobile"/.test(INDEX) &&
        /id="fraudSortSelect"/.test(INDEX) && /id="fraudSortDirBtn"/.test(INDEX));
  check('and it is filled from the SAME list the headers are',
        /FRAUD_COLUMNS_\.map\(function \(c\) \{[\s\S]{0,200}escapeAttrPak\(c\.key\)/.test(PAGE),
        'two lists would let the dropdown offer a column the table has not got');
  check('its listeners are bound once, not on every render',
        /addEventListener\('DOMContentLoaded', function \(\) \{[\s\S]{0,600}fraudSortSelect/.test(PAGE),
        'binding inside the renderer would stack a listener per draw');
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
