// The Data Table page's own controls: search removed entirely, the download
// button renamed and repositioned, and the sort dropdown / direction icon /
// download button sharing one row on a phone at one consistent height.
const fs = require('fs');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const index = R('Web - Index.html');
const init = R('Web - JsInit.html');
const tables = R('Web - JsTables.html');
const css = R('Web - Styles.html');
const tour = R('Web - JsTour.html');

head('[1] the search bar is gone, not just hidden');
// A control left wired up after its markup is removed throws the moment
// anything touches it - $('search') would return null and the next line would
// crash the whole render, not just the search feature.
{
  check('no #search input in the markup',
        index.indexOf('id="search"') === -1 && index.indexOf('Search rows') === -1);
  check('nothing listens for it any more',
        init.indexOf("$('search')") === -1,
        'a debounced listener on a element that no longer exists');
  check('and the table render no longer filters by it',
        tables.indexOf("$('search')") === -1 && !/\bvar q = /.test(tables),
        'the whole q-filter branch, including the "no rows match" empty state');
  check('the "no bonus filter" and "no data yet" empty states still stand',
        /selectedBonuses\.length > 0/.test(tables) && /No data has arrived for this day yet/.test(tables),
        'only the search-shaped reason should have gone, not the other two');
  check('the dead mobile #search rule went with it',
        !/\n\s*#search \{/.test(css));
}

head('[2] the button reads "Raw data"');
{
  check('the visible label changed',
        index.indexOf('Raw data') !== -1 && index.indexOf('>Download raw data<') === -1,
        'the id and the title attribute (a tooltip, not a label) are unaffected on purpose');
  check('the button keeps its id, onclick and download icon',
        /id="downloadRawDataBtn" onclick="downloadRawDataCsvPak\(\)"/.test(index) &&
        /fa-solid fa-download/.test(index));
  check('the tour mentions the new label',
        /Clicking .Raw data. exports/.test(tour) && tour.indexOf('Download raw data') === -1,
        'stale UI copy in a tour step is worse than none - it never matches what it points at');
}

head('[3] one row on a phone: dropdown, direction icon, Raw data');
{
  // Order in the MARKUP, not just in the rendered row: main-sort-mobile is
  // display:none on desktop and the tag is display:none on a phone, so moving
  // it earlier costs the desktop layout nothing while being what puts it
  // first in the mobile row.
  const ctrlBlock = index.slice(index.indexOf('class="main-table-controls"'),
                                index.indexOf('mainTableWrapper'));
  check('main-sort-mobile comes before the download button in the DOM',
        ctrlBlock.indexOf('main-sort-mobile') !== -1 &&
        ctrlBlock.indexOf('main-sort-mobile') < ctrlBlock.indexOf('downloadRawDataBtn'),
        'the button renders to the RIGHT of the sort icon because it comes after it here');
  check('the tag comes last, since it only ever shows on desktop',
        ctrlBlock.lastIndexOf('class="tag"') > ctrlBlock.indexOf('downloadRawDataBtn'));
  check('the inline style became a class, so mobile rules have something to target',
        index.indexOf('class="main-table-controls"') !== -1 &&
        !/style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;"/.test(index));
  check('and the class carries the same three declarations the inline style had',
        /\.main-table-controls \{\s*\n\s*display: flex;\s*\n\s*align-items: center;\s*\n\s*gap: 10px;\s*\n\s*flex-wrap: wrap;/
          .test(css));

  check('the row does not wrap on a phone',
        /\.main-table-controls \{ flex-wrap: nowrap; \}/.test(css),
        'wrapping is exactly what put the button on its own line before');
  check('the sort wrapper shares the row instead of claiming all of it',
        /\.main-sort-mobile \{\s*\n\s*display: flex;\s*\n\s*flex: 1 1 auto;\s*\n\s*min-width: 0;\s*\n\s*\}/
          .test(css),
        'it used to be width: 100%, which forced everything after it onto a new line');
  check('the select can shrink below its own content width',
        /#mainSortSelect \{\s*\n\s*flex: 1;\s*\n\s*min-width: 0;/.test(css),
        'flex: 1 alone does not let a <select> shrink past its intrinsic width');
  check('the download button does not shrink or wrap its text',
        /#downloadRawDataBtn \{\s*\n\s*flex-shrink: 0;\s*\n\s*white-space: nowrap;\s*\n\s*\}/.test(css),
        'it is the select that should give way, not "Raw data" breaking onto two lines');
}

head('[4] the direction icon matches the dropdown’s actual height');
// #mainSortSelect settles at 24px from a LATER, more specific rule than the
// one that originally sized the direction icon to 36px - so the two drifted
// out of step even though the comment beside the 36px rule said they matched.
{
  const laterHeight = /#mainSortSelect,[\s\S]{0,300}\{\s*\n\s*height: 24px;\s*\n\s*min-height: 24px;/.test(css);
  check('the select really does resolve to 24px, not the 34px an earlier rule implies',
        laterHeight,
        'the consolidated "SAME height" rule further down the file is the one that wins');
  check('the direction icon is sized to match that, not the earlier 36px',
        /\.main-sort-mobile \.icon-btn \{\s*\n\s*width: 24px;\s*\n\s*height: 24px;/.test(css),
        'a 36px button beside a 24px select is the mismatch the screenshot showed');
  check('and it will not be shrunk by the row it sits in',
        /\.main-sort-mobile \.icon-btn \{[\s\S]{0,120}flex-shrink: 0;/.test(css));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
