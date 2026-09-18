// Builds a standalone preview of the dashboard that opens in a plain browser.
//
// The real page is assembled by Apps Script: doGet renders "Web - Index" as a
// template, HtmlService splices the other files in via include(), and the
// client talks to the server over google.script.run. None of that exists
// locally, so this does the same three jobs by hand - resolve the includes,
// fill in the scriptlet values, and stand in for the server - and writes one
// self-contained HTML file.
//
// What you get is the REAL markup, the REAL styles and the REAL client code,
// driven by the tour's demo payload. So layout, theming, the charts, the
// building filter, the date picker and every interaction behave exactly as
// deployed. What you do NOT get is real numbers, and nothing here can catch a
// server-side bug: anything inside Code.js is stubbed away.
//
//   node tools/preview.js                       # then open tools/preview.html
//   node tools/preview.js --page=volume --site=e3
//   node tools/preview.js --tour=1
//   node tools/preview.js --os          # one bonus put on OS, filtered to them
//   node tools/preview.js --page=npl    # straight to the NPL page
//   node tools/preview.js --note="NOTE TEST"   # what Front!G3 renders as
//
// In VS Code: right-click preview.html -> Open with Live Preview. Prefer that
// over opening the file directly - the page uses localStorage, which browsers
// restrict on file:// URLs.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'preview.html');

const read = name => fs.readFileSync(path.join(REPO, name + '.html'), 'utf8');

// --page=volume --site=e3 ... -> { page: 'volume', site: 'e3' }
const args = Object.fromEntries(process.argv.slice(2)
  .filter(a => a.startsWith('--'))
  .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || '1']; }));

// The scriptlet names in Index.html, and what to put in each. Deep-link values
// come from the flags so a preview can start on any page, building or bonus -
// the same knobs the real ?query= parameters turn.
const VARS = {
  forceTour: args.tour || '',
  deepPage: args.page || '',
  deepBonus: (args.bonus || '').toUpperCase(),
  deepDate: args.date || '',
  deepHours: args.hours || '',
  deepWindow: args.window || '',
  deepSite: args.site || '',
  webAppUrl: '#preview',
};

// ---- assemble -------------------------------------------------------------
let html = read('Web - Index');

// <?!= include('Web - X'); ?>  ->  the file's contents. Repeated until none are
// left, so an include inside an included file resolves too.
const INCLUDE = /<\?!=\s*include\(\s*'([^']+)'\s*\)\s*;?\s*\?>/g;
let pass = 0;
while (INCLUDE.test(html)) {
  if (++pass > 10) throw new Error('include() still unresolved after 10 passes - a cycle?');
  INCLUDE.lastIndex = 0;
  html = html.replace(INCLUDE, (_, name) => read(name));
}

// <?= foo ?> -> its value. Unknown names become empty rather than being left
// as literal scriptlet text in the output.
const unknown = new Set();
html = html.replace(/<\?=\s*([A-Za-z_$][\w$]*)\s*\?>/g, (_, name) => {
  if (!(name in VARS)) { unknown.add(name); return ''; }
  return String(VARS[name]);
});
if (unknown.size) {
  console.warn('  note: no preview value for ' + [...unknown].join(', ') + ' (left empty)');
}

// Anything left is a scriptlet this builder does not understand. Better to say
// so than to ship a page with `<? ... ?>` rendered as text.
const leftover = html.match(/<\?[\s\S]{0,60}?\?>/g);
if (leftover) {
  throw new Error('unhandled Apps Script scriptlet(s):\n  ' + leftover.join('\n  '));
}

// ---- stand in for the server ---------------------------------------------
// google.script.run hands back a NEW builder per call in the real thing. A
// single shared object would let two calls overwrite each other's handlers -
// and the dashboard fires getArchiveLinks and getDashboardData in parallel on
// startup, so that would cross their wires immediately.
const STUB = `
<script>
(function () {
  // --os: give one demo bonus a spell of OS / Indirect work and filter to them,
  // so the grey band has something to draw. The tour's bonus codes are random
  // per load, so the bonus is chosen here rather than passed in.
  //
  // It models the harder of the two real cases: the person has NO productive
  // rows for those windows at all, which is what the notebook synthesises for
  // someone with no BonusHub events. Their productive rows are removed rather
  // than merely flagged, because a row with hours on it would still draw a
  // productivity bar and the band would be explaining nothing.
  // --note stands in for Front!G3, which Code.js reads verbatim
  // (noteVal = sheet.getRange('G3').getValue()) and hands back as
  // payload.note. JsInit writes it into #noteText untouched - no formatting,
  // no truncation - so the string here is exactly what would show.
  var NOTE_PREVIEW = ${JSON.stringify(args.note || '')};
  function withNote_(d) {
    if (NOTE_PREVIEW && d) { d.note = NOTE_PREVIEW; }
    return d;
  }

  var OS_PREVIEW = ${args.os ? 'true' : 'false'};
  function withOsSpell_(d) {
    if (!OS_PREVIEW || !d || !d.bonusList || !d.bonusList.length) return d;
    var bonus = d.bonusList[0];
    var trs = d.timeRanges || [];
    var from = Math.floor(trs.length * 0.35);
    var to = Math.floor(trs.length * 0.62);
    var want = {};
    for (var i = from; i <= to && i < trs.length; i++) { want[trs[i]] = true; }

    d.rawSideData = d.rawSideData.filter(function (r) {
      return !(r.bonus === bonus && want[r.timeRange]);
    });
    var blank = {};
    Object.keys(d.rawSideData[0] || {}).forEach(function (k) {
      if (k !== 'timeRange' && k !== 'bonus') blank[k] = 0;
    });
    // A status, and the clipped times the notebook now writes alongside it.
    // "Awaiting Approval" on purpose: it is the longest of the three, so it is
    // the one that shows whether the band wraps the real wording or falls back
    // to a code. And the spell starts seven minutes into its first block and
    // stops eight into its last, so the hover tooltip reports a range the
    // band's own edges cannot.
    var trKeys = Object.keys(want);
    trKeys.forEach(function (tr, n) {
      // The first two thirds are OS, the last third NPL, and the middle block
      // of the run is BOTH - which is the case worth being able to look at,
      // since the two bands then cover the same blocks and have to stay
      // readable over each other.
      var isNpl = n >= Math.floor(trKeys.length * 0.55);
      var isOs = n <= Math.floor(trKeys.length * 0.62);
      d.rawSideData.push(Object.assign({}, blank, {
        timeRange: tr, bonus: bonus, value: 0,
        os: isOs,
        osStatus: isOs ? 'Awaiting Approval' : '',
        osFrom: isOs ? osClipAtPak_(tr, n === 0 ? 7 : 0) : '',
        osTo: isOs ? osClipAtPak_(tr, n === trKeys.length - 1 ? 8 : 15) : '',
        npl: isNpl,
        nplStatus: isNpl ? 'Awaiting sign off' : '',
        nplFrom: isNpl ? osClipAtPak_(tr, 0) : '',
        nplTo: isNpl ? osClipAtPak_(tr, n === trKeys.length - 1 ? 8 : 15) : ''
      }));
    });
    // Bands only draw under a bonus filter, so apply one.
    window.DEEP_BONUS = bonus;
    console.log('PREVIEW: ' + bonus + ' put on OS for ' + Object.keys(want).length + ' blocks');
    return d;
  }

  // The OS page reads the OS log, which the tour's payload knows nothing
  // about, so the demo log is synthesised here from the demo bonus numbers.
  //
  // Shaped like the real thing rather than tidied: several sites, uneven zones,
  // two departments to a zone, a couple of job types each, and a spread of
  // record statuses including one left blank - which is what the page has to
  // render, and the only way to see whether it does.
  var OS_DEMO_SITES_ = [
    { site: 'E1/E2', zones: ['Goods In', 'OSR', 'Despatch'] },
    { site: 'E3',    zones: ['Packing', 'Returns'] }
  ];
  var OS_DEMO_DEPTS_ = ['Inbound', 'Outbound', 'Support'];
  var OS_DEMO_JOBS_ = ['Cleaning', 'Training', 'Cover - Team Manager',
                       'Housekeeping', '5S Audit'];
  var OS_DEMO_PEOPLE_ = ['J Ashworth', 'P Okonkwo', 'S Nowak', 'R Patel', 'D Byrne'];
  var OS_DEMO_STATUS_ = ['OK', 'OK', 'OK', 'authorise or reject', 'Rejected', ''];

  // NPL's own vocabulary. Check is a free cell, so the not-OK wordings are
  // deliberately several different ones rather than a single "Not OK" - the
  // page shows them verbatim, and a preview with only one would not show that.
  // 'Site Transfer' is in here deliberately: it is the one task whose Site
  // Transfer cell means anything, and the phone card drops that line on every
  // other one - so without it in the demo data only HALF that rule is ever on
  // screen to look at. See nplIsSiteTransferTaskPak_.
  var NPL_DEMO_TASKS_ = ['Cleaning', 'Waiting for work', 'Site Transfer',
                         'Toolbox talk', 'Breakdown', 'Meeting'];
  var NPL_DEMO_CHECKS_ = ['OK', 'OK', 'OK', 'Needs review', 'Adjusted', ''];
  var NPL_DEMO_TRANSFER_ = ['No', 'Yes', 'No', 'No', ''];

  // The OS spells, re-dressed as NPL ones. Built off the same generator rather
  // than a second copy of it: what makes these rows useful is the clock times
  // and the production-day handling, which the OS builder already gets right,
  // and the only thing that differs is which columns they are dressed in.
  function nplDemoLog_(d) {
    return osDemoLog_(d).map(function (r, i) {
      return {
        date: r.date, bonus: r.bonus, dept: r.dept,
        task: NPL_DEMO_TASKS_[(i * 2) % NPL_DEMO_TASKS_.length],
        from: r.from, to: r.to,
        siteTransfer: NPL_DEMO_TRANSFER_[i % NPL_DEMO_TRANSFER_.length],
        tmAuth: OS_DEMO_PEOPLE_[(i + 1) % OS_DEMO_PEOPLE_.length],
        check: NPL_DEMO_CHECKS_[i % NPL_DEMO_CHECKS_.length]
      };
    });
  }

  function osDemoLog_(d) {
    if (!d || !d.bonusList || !d.timeRanges || !d.timeRanges.length) return [];
    // A deterministic shuffle, so reloading the preview does not reshuffle the
    // whole page and make a layout change impossible to see.
    var seed = 20260915;
    var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };

    var last = d.timeRanges[d.timeRanges.length - 1];
    var endPart = String(last).split(' - ')[1] || '';
    var bits = endPart.split(' ');
    var dparts = (bits[0] || '').split('/');
    var tparts = (bits[1] || '').split(':');
    if (dparts.length !== 3 || tparts.length < 2) return [];
    var axisEnd = new Date(Number(dparts[2]), Number(dparts[1]) - 1, Number(dparts[0]),
                           Number(tparts[0]), Number(tparts[1]));

    var out = [];
    var bonuses = d.bonusList.slice(0, 18);
    for (var i = 0; i < bonuses.length; i++) {
      var s = OS_DEMO_SITES_[i % OS_DEMO_SITES_.length];
      // Spells ending within the last few hours of the axis, of uneven length,
      // starting and finishing on ragged minutes - the log records real clock
      // times, not quarter-hours.
      var endMin = Math.floor(rnd() * 200);
      var lenMin = 25 + Math.floor(rnd() * 150);
      var finish = new Date(axisEnd.getTime() - endMin * 60000);
      var start = new Date(finish.getTime() - lenMin * 60000);
      // The Date column is the PRODUCTION day: 06:00 to 06:00, so a spell
      // starting before six is logged against the previous date.
      var logDay = start.getHours() < 6
        ? new Date(start.getTime() - 86400000) : start;
      out.push({
        date: p2(logDay.getDate()) + '/' + p2(logDay.getMonth() + 1) + '/' + logDay.getFullYear(),
        bonus: bonuses[i],
        dept: OS_DEMO_DEPTS_[i % OS_DEMO_DEPTS_.length],
        job: OS_DEMO_JOBS_[(i * 3) % OS_DEMO_JOBS_.length],
        from: p2(start.getHours()) + ':' + p2(start.getMinutes()),
        to: p2(finish.getHours()) + ':' + p2(finish.getMinutes()),
        auth: OS_DEMO_PEOPLE_[i % OS_DEMO_PEOPLE_.length],
        deployedBy: OS_DEMO_PEOPLE_[(i + 2) % OS_DEMO_PEOPLE_.length],
        reportsTo: OS_DEMO_PEOPLE_[(i + 4) % OS_DEMO_PEOPLE_.length],
        status: OS_DEMO_STATUS_[i % OS_DEMO_STATUS_.length],
        site: s.site,
        zone: s.zones[i % s.zones.length]
      });
    }
    return out;
  }

  // The OS log no longer travels in the payload - the OS page asks for it on
  // first open, through its own entry point. Stashed here so the stub's
  // getOsLogRows can answer, and built from the payload because that is where
  // the demo bonus numbers and time ranges live.
  var OS_LOG_STASH = null;
  var NPL_LOG_STASH = null;
  function withOsLog_(d) {
    if (d) {
      // The NPL page's own log, on the same terms - including one row the page
      // cannot place, so its warning card is on screen rather than only ever
      // exercised by a test.
      var _npl = nplDemoLog_(d);
      NPL_LOG_STASH = {
        rows: _npl, skipped: 1,
        bad: _npl.slice(0, 1).map(function (r) {
          return Object.assign({}, r, { row: 901, to: '',
                                        why: 'the finish is not a time' });
        })
      };
      // One unreadable row, so the page's own warning is on screen rather than
      // only ever exercised by a test.
      var _rows = osDemoLog_(d);
      // Two spells nobody has closed, so the Open card has something to draw.
      var _open = _rows.slice(0, 2).map(function (r, i) {
        return Object.assign({}, r, {
          bonus: 'OP' + i, to: '', source: 'Open', status: 'Awaiting Approval'
        });
      });
      OS_LOG_STASH = { rows: _rows, skipped: 1,
        bad: _open.map(function (r) {
          return Object.assign({}, r, { row: 900, why: 'the finish is not a time' });
        }) };
    }
    return d;
  }

  function archiveLinks() {
    var out = [], d = new Date();
    d.setHours(0, 0, 0, 0);
    for (var i = 1; i <= 240; i++) {
      var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      var name = p(day.getDate()) + '/' + p(day.getMonth() + 1) + '/' + day.getFullYear();
      out.push({ name: name, url: 'preview://' + name });
    }
    return out;
  }

  function runner(ok, fail) {
    function reply(produce) {
      // Asynchronous like the real transport, so anything depending on the
      // loading state is exercised rather than skipped.
      setTimeout(function () {
        try { if (ok) ok(produce()); }
        catch (e) { if (fail) fail(e); else console.error(e); }
      }, 120);
    }
    return {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); },
      getDashboardData: function () { reply(function () { return withOsLog_(withNote_(withOsSpell_(buildTourDummyData_()))); }); },
      getArchiveLinks: function () { reply(archiveLinks); },
      // Answered from the stash the payload filled. Still asynchronous, so the
      // OS page's loading state is exercised rather than skipped.
      getOsLogRows: function () {
        reply(function () {
          return OS_LOG_STASH || { rows: [], skipped: 0 };
        });
      },
      getNplLogRows: function () {
        reply(function () {
          return NPL_LOG_STASH || { rows: [], skipped: 0 };
        });
      },
      getLastRefreshTimestamp: function () { reply(function () { return null; }); }
    };
  }

  window.google = { script: { run: runner(null, null) } };

  window.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.textContent = 'PREVIEW - demo data, no server';
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
      'padding:4px 10px;font:11px system-ui;text-align:center;' +
      'background:#b3541e;color:#fff;letter-spacing:.04em;';
    document.body.appendChild(b);
  });
})();
</script>
`;

// Injected after JsTourData (which defines buildTourDummyData_) and before
// JsInit, which is what starts calling the server.
const anchor = html.lastIndexOf('<script>');
const initAt = html.indexOf('function populateArchiveDropdown');
if (initAt === -1) throw new Error('could not find JsInit in the assembled page');
const injectAt = html.lastIndexOf('<script>', initAt);
if (injectAt === -1) throw new Error('could not find the script tag opening JsInit');
html = html.slice(0, injectAt) + STUB + html.slice(injectAt);

fs.writeFileSync(OUT, html, 'utf8');
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log('wrote ' + path.relative(process.cwd(), OUT) + '  (' + kb + ' KB)');
console.log('open it with VS Code\'s Live Preview - localStorage is restricted on file:// URLs');
