// The Bonus page's From/To defaults to the current half of the rolling day -
// 06:00-18:00, or 18:00-06:00 the next day - rather than a fixed "last hour",
// and resets to that default every time the page is ENTERED, never restoring
// a manual pick from the visit before. Two failures matter: the wrong half
// picked at a boundary hour, and a stale pick surviving a page re-entry that
// should have discarded it.
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

// The smallest thing that behaves like a <select> for this code's purposes:
// appendChild collects options in order, innerHTML = '' clears them, value
// reads off whatever selectedIndex currently points at.
function FakeSelect() {
  var el = { dataset: {}, children: [], selectedIndex: -1,
             appendChild: function (o) { this.children.push(o); return o; } };
  Object.defineProperty(el, 'innerHTML', { get: function () { return ''; },
    set: function (v) { if (v === '') this.children = []; } });
  Object.defineProperty(el, 'value', { get: function () {
    return (this.selectedIndex >= 0 && this.children[this.selectedIndex])
      ? this.children[this.selectedIndex].value : '';
  } });
  return el;
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(strip(R('Web - JsHelpers.html')), ctx);
const fromSel = FakeSelect(), toSel = FakeSelect();
ctx.document = { createElement: function () { return { value: '', textContent: '' }; } };
ctx.$ = function (id) { return id === 'bonusFrom' ? fromSel : id === 'bonusTo' ? toSel : null; };
vm.runInContext(strip(R('Web - JsTables.html')), ctx);
ctx.refreshBonusTables = function () { ctx._refreshed = (ctx._refreshed || 0) + 1; }; // stub the real one out
ctx.saveUserPreferences = function () {};

// dd/mm/yyyy hh:mm - dd/mm/yyyy hh:mm, 15 minutes apart - the wire format
// extractRangePartsPak/parseDateTimePartPak actually parse.
function fmt(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' +
         d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function block(y, mo, d, h, m) {
  var s = new Date(y, mo - 1, d, h, m), e = new Date(s.getTime() + 15 * 60000);
  return fmt(s) + ' - ' + fmt(e);
}
// 96 quarter-hour blocks ending at `nowMs`, floored to the quarter - the same
// shape generateTimeRanges_ produces server-side.
function rolling96(nowMs) {
  var out = [];
  var floored = Math.floor(nowMs / 900000) * 900000;
  for (var i = 96; i >= 1; i--) {
    var s = new Date(floored - i * 900000), e = new Date(s.getTime() + 900000);
    out.push(fmt(s) + ' - ' + fmt(e));
  }
  return out;
}

head('[1] which half "now" falls in');
{
  ctx.lastRefreshTimestamp = new Date(2026, 8, 25, 10, 0).getTime();
  var h1 = ctx.bonusDefaultHalfPak_();
  check('10:00 is the day half, 06:00 to 18:00',
        h1.start.getTime() === new Date(2026, 8, 25, 6, 0).getTime() &&
        h1.end.getTime() === new Date(2026, 8, 25, 18, 0).getTime());

  ctx.lastRefreshTimestamp = new Date(2026, 8, 25, 20, 0).getTime();
  var h2 = ctx.bonusDefaultHalfPak_();
  check('20:00 is the night half, TODAY 18:00 to TOMORROW 06:00',
        h2.start.getTime() === new Date(2026, 8, 25, 18, 0).getTime() &&
        h2.end.getTime() === new Date(2026, 8, 26, 6, 0).getTime());

  ctx.lastRefreshTimestamp = new Date(2026, 8, 25, 3, 0).getTime();
  var h3 = ctx.bonusDefaultHalfPak_();
  check('03:00 is still the night half that started YESTERDAY 18:00, ending today 06:00',
        h3.start.getTime() === new Date(2026, 8, 24, 18, 0).getTime() &&
        h3.end.getTime() === new Date(2026, 8, 25, 6, 0).getTime());

  ctx.lastRefreshTimestamp = new Date(2026, 8, 25, 6, 0).getTime();
  var h4 = ctx.bonusDefaultHalfPak_();
  check('06:00 exactly is the day half starting, not the night half ending',
        h4.start.getTime() === new Date(2026, 8, 25, 6, 0).getTime());

  ctx.lastRefreshTimestamp = new Date(2026, 8, 25, 18, 0).getTime();
  var h5 = ctx.bonusDefaultHalfPak_();
  check('18:00 exactly is the night half starting, not the day half ending',
        h5.start.getTime() === new Date(2026, 8, 25, 18, 0).getTime() &&
        h5.end.getTime() === new Date(2026, 8, 26, 6, 0).getTime());
}

head('[2] the From/To indexes picked out of a real 24h rolling window');
{
  var now = new Date(2026, 8, 25, 14, 32).getTime(); // mid-afternoon, an odd minute
  ctx.lastRefreshTimestamp = now;
  var sliced = rolling96(now);
  var idx = ctx.bonusDefaultIndexesPak_(sliced);
  var fromParts = ctx.extractRangePartsPak(sliced[idx.from]);
  check('From lands exactly on today\'s 06:00 block',
        fromParts.start === '25/09/2026 06:00', fromParts.start);
  check('To is the newest available block - 18:00 has not happened yet',
        idx.to === sliced.length - 1);
}

head('[3] entering the Bonus page always resets to the default half, discarding a manual pick');
{
  var now = new Date(2026, 8, 25, 10, 0).getTime();
  ctx.lastRefreshTimestamp = now;
  ctx.timeRanges = rolling96(now);

  ctx.ensureBonusTimeSelects_(); // first population, as if the page just loaded
  // The viewer manually widens it - as if they picked an earlier From.
  fromSel.selectedIndex = 0;
  toSel.selectedIndex = 10;
  check('the manual pick actually took (sanity check on the fake select)',
        fromSel.selectedIndex === 0 && toSel.selectedIndex === 10);

  // Time passes, but not enough to change which half we are in - a plain
  // periodic refresh must NOT disturb the manual pick.
  ctx.timeRanges = rolling96(now + 5 * 60000);
  ctx.ensureBonusTimeSelects_();
  check('a periodic refresh mid-visit leaves a manual pick alone',
        fromSel.selectedIndex === 0 && toSel.selectedIndex === 10);

  // Now the viewer leaves the page and comes back - goToPage calls this.
  ctx.resetBonusTimeRangeToDefault_();
  var def = ctx.bonusDefaultIndexesPak_(ctx.timeRanges.slice(-96));
  check('returning to the page discards the manual pick and re-applies today\'s default',
        fromSel.selectedIndex === def.from && toSel.selectedIndex === def.to,
        'from=' + fromSel.selectedIndex + ' to=' + toSel.selectedIndex + ' (want ' + def.from + '/' + def.to + ')');
  check('the table is refreshed to match', ctx._refreshed >= 1);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
