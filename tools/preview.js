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
      getDashboardData: function () { reply(function () { return buildTourDummyData_(); }); },
      getArchiveLinks: function () { reply(archiveLinks); },
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
