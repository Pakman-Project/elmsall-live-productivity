// Rearranging the Volume page's chart panels, where up to eleven of the
// nineteen can be switched off.
//
// Both failures here are silent. Numbering against all twenty-one labels a panel
// "4/19" on a page showing eight, naming a position the viewer cannot see; and
// stepping one slot at a time swaps a visible panel with a HIDDEN neighbour,
// which changes the saved order while changing nothing on screen - the button
// looks broken and the layout drifts anyway.
//
// A DOM shim rather than a browser: what is being tested is the adjacency
// arithmetic, and that needs real insertBefore semantics but nothing else.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

// ---- The smallest DOM that gives real insertBefore ------------------------
function El(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    className: '', innerHTML: '',
    style: {}, attrs: {}, children: [], parentNode: null,
    get firstChild() { return this.children[0] || null; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    appendChild(n) { n.parentNode = this; this.children.push(n); return n; },
    removeChild(n) {
      const i = this.children.indexOf(n);
      if (i !== -1) this.children.splice(i, 1);
      n.parentNode = null;
      return n;
    },
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) this.children.push(n); else this.children.splice(i, 0, n);
      return n;
    },
    querySelector() { return null; },
    scrollIntoView() {}
  };
}

const container = El('div');
const doc = {
  body: { classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } },
  getElementById: id => (id === 'volumeChartsContainer' ? container : null),
  createElement: t => El(t),
  querySelectorAll(sel) {
    const want = sel.replace('.', ''), out = [];
    (function walk(n) {
      for (const c of n.children) { if (c.className === want) out.push(c); walk(c); }
    })(container);
    return out;
  },
  addEventListener() {}
};

const ctx = { console, document: doc, window: { matchMedia: () => ({ matches: false }) } };
ctx.$ = () => null;
ctx.safeTextPak = v => String(v == null ? '' : v);
ctx.escapeAttrPak = v => String(v == null ? '' : v);
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(APPS + 'Web - JsReorder.html', 'utf8').replace(/<\/?script>/g, ''), ctx);
// Collaborators that reach for the rest of the dashboard; the arithmetic under
// test does not involve them.
vm.runInContext(`
  function captureChartOrder_() {}
  function reorderChipsToMatch_() {}
  function refreshOddCentering_() {}
  // Lives in JsHelpers, and needs real layout to do anything - it reads
  // getBoundingClientRect, which this DOM shim has no notion of. Where the
  // moved panel ends up on screen is not what the arithmetic below is about.
  function scrollIntoViewPak_() {}
  _reorderMode = true;
`, ctx);
const ev = e => vm.runInContext(e, ctx);

// Lays out panels A..: those named in `hide` get the inline display the volume
// renderer sets on a switched-off area.
function layout(names, hide) {
  container.children.length = 0;
  names.forEach(n => {
    const p = El('div');
    p.setAttribute('data-reorder-key', n);
    p.setAttribute('data-reorder-label', n);
    if ((hide || []).indexOf(n) !== -1) p.style.display = 'none';
    container.appendChild(p);
  });
}
const order = () => container.children
  .filter(c => c.hasAttribute('data-reorder-key'))
  .map(c => c.getAttribute('data-reorder-key')).join('');
const shownOrder = () => container.children
  .filter(c => c.hasAttribute('data-reorder-key') && c.style.display !== 'none')
  .map(c => c.getAttribute('data-reorder-key')).join('');
// The "O/N" each visible panel's bar is showing.
function badges() {
  ev('refreshReorderBars_()');
  return container.children
    .filter(c => c.hasAttribute('data-reorder-key') && c.style.display !== 'none')
    .map(c => {
      const bar = c.children.filter(k => k.className === 'reorder-bar')[0];
      return bar ? /class="reorder-pos">([^<]+)</.exec(bar.innerHTML)[1] : 'none';
    });
}

head('[1] the position badge counts what is on screen');
layout(['A', 'B', 'C', 'D', 'E'], []);
check('nothing hidden: 1/5 .. 5/5',
  badges().join(' ') === '1/5 2/5 3/5 4/5 5/5', badges().join(' '));

layout(['A', 'B', 'C', 'D', 'E'], ['B', 'D']);
check('two hidden: three panels numbered out of three',
  badges().join(' ') === '1/3 2/3 3/3', badges().join(' '));
check('and no bar is built for a hidden panel',
  container.children.filter(c => c.style.display === 'none' &&
    c.children.some(k => k.className === 'reorder-bar')).length === 0);

layout(['A', 'B', 'C'], ['A', 'B', 'C']);
check('all hidden: nothing to number', badges().length === 0, badges().join(' '));

head('[2] moving steps over hidden neighbours');
// A [B] C  — moving C earlier must pass the hidden B and land before A's
// neighbour, not merely swap with something invisible.
layout(['A', 'B', 'C'], ['B']);
ev('moveReorderItem_("C", -1)');
check('C moved ahead of A on screen', shownOrder() === 'CA', shownOrder());
check('the hidden panel is still in the order', order().indexOf('B') !== -1, order());

layout(['A', 'B', 'C'], ['B']);
ev('moveReorderItem_("A", 1)');
check('A moved after C on screen', shownOrder() === 'CA', shownOrder());

// Several hidden in a row must not need several presses.
layout(['A', 'B', 'C', 'D'], ['B', 'C']);
ev('moveReorderItem_("D", -1)');
check('one press clears a run of hidden panels', shownOrder() === 'DA', shownOrder());

head('[3] the ends are the visible ends');
layout(['A', 'B', 'C'], ['A']);
ev('moveReorderItem_("B", -1)');
check('the first VISIBLE panel cannot move earlier', shownOrder() === 'BC', shownOrder());
check('and the hidden one before it is left alone', order() === 'ABC', order());

layout(['A', 'B', 'C'], ['C']);
ev('moveReorderItem_("B", 1)');
check('the last VISIBLE panel cannot move later', shownOrder() === 'AB', shownOrder());

// The up/down buttons must agree with that, or they offer a press that does
// nothing.
layout(['A', 'B', 'C', 'D'], ['A', 'D']);
ev('refreshReorderBars_()');
const bars = container.children
  .filter(c => c.style.display !== 'none')
  .map(c => c.children.filter(k => k.className === 'reorder-bar')[0].innerHTML);
check('first visible has "earlier" disabled', /data-dir="-1" disabled/.test(bars[0]));
check('first visible has "later" enabled', !/data-dir="1" disabled/.test(bars[0]));
check('last visible has "later" disabled', /data-dir="1" disabled/.test(bars[bars.length - 1]));
check('last visible has "earlier" enabled', !/data-dir="-1" disabled/.test(bars[bars.length - 1]));

head('[4] a full pass still behaves when nothing is hidden');
layout(['A', 'B', 'C', 'D'], []);
ev('moveReorderItem_("A", 1)');
check('plain swap', order() === 'BACD', order());
ev('moveReorderItem_("A", -1)');
check('and back', order() === 'ABCD', order());

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
