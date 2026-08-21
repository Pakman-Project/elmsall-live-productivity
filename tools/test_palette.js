// Palette tests, run against the SHIPPING JsState.html rather than the
// generator that produced the hexes — so if someone hand-edits a hex later,
// this fails rather than the generator quietly still passing.
const fs = require('fs'), vm = require('vm');
// Paths are resolved from this file, not hardcoded, so the checks run from any
// clone. The Databricks and Tampermonkey repos are expected as SIBLINGS of this
// one - that is how they sit on the machine this pipeline is maintained from.
const path = require('path');
const REPOS = path.resolve(__dirname, '..', '..');

const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  R('Web - JsState.html').replace(/<\/?script>/g, '').split('function applyConfigToCSSPak')[0],
  ctx);
const ev = e => vm.runInContext(e, ctx);

// Just enough sRGB -> OKLCH to check a ramp's direction and hue. The validator
// measures separation but exports no conversion, and these two properties are
// about the ramp's RELATIONSHIP to VOLUME_TYPES order and to its family hue,
// which is something only this file knows to ask.
function oklch_(hex) {
  const int = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex)[1], 16);
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const r = lin((int >> 16) & 255), g = lin((int >> 8) & 255), b = lin(int & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
           h: ((Math.atan2(B, A) * 180 / Math.PI) + 360) % 360 };
}
const oklchL_ = hex => oklch_(hex).L;
const oklchH_ = hex => oklch_(hex).h;

// ── structure ────────────────────────────────────────────────────────────────
head('[1] every area belongs to a declared family');
{
  const fams = ev('AREA_FAMILIES.map(f => f.name)');
  const vt = ev('VOLUME_TYPES.map(t => ({key:t.key, family:t.family, color:t.color, dark:t.colorDark}))');
  check('19 areas', vt.length === 19, '= ' + vt.length);
  // Six since BPP folded into Packing and Automation Pick into Picking. The
  // eight-slot requirement moved to AREA_GROUP_COLORS, which is what actually
  // needed it - see the group-palette checks below.
  check('6 family hues', fams.length === 6, '= ' + fams.length);
  const grp = ev('AREA_GROUP_COLORS'), grpD = ev('AREA_GROUP_COLORS_DARK');
  check('8 group hues', grp.length === 8 && grpD.length === 8,
        grp.length + ' / ' + grpD.length);
  check('group palette outlasts MAX_AREA_GROUPS',
        grp.length >= ev('MAX_AREA_GROUPS'),
        grp.length + ' hues for ' + ev('MAX_AREA_GROUPS') + ' groups');
  // Deriving it from AREA_FAMILIES is what made the group palette shrink with
  // the family count; groupColor_ wraps, so seven groups over six hues gives
  // two of them the same colour.
  check('group palette is written out, not derived',
        R('Web - JsState.html').indexOf('AREA_GROUP_COLORS = AREA_FAMILIES.map(') === -1, '');
  check('every area names a family', vt.every(t => t.family), '');
  check('every named family exists', vt.every(t => fams.indexOf(t.family) !== -1),
        vt.filter(t => fams.indexOf(t.family) === -1).map(t => t.key).join(',') || 'all found');
  const sizes = {};
  vt.forEach(t => { sizes[t.family] = (sizes[t.family] || 0) + 1; });
  check('no family is empty', fams.every(f => sizes[f] > 0),
        fams.map(f => f + ':' + (sizes[f] || 0)).join(' '));
  check('every area has both themes',
        vt.every(t => /^#[0-9a-f]{6}$/.test(t.color) && /^#[0-9a-f]{6}$/.test(t.dark)), '');
  ['color', 'dark'].forEach(k => {
    const seen = {}, dup = [];
    vt.forEach(t => { if (seen[t[k]]) dup.push(seen[t[k]] + '/' + t.key); seen[t[k]] = t.key; });
    check('no two areas share a ' + (k === 'dark' ? 'dark' : 'light') + ' hex', dup.length === 0, dup.join('; '));
  });
}

head('[2] the display modes');
{
  const idx = R('Web - Index.html');
  ['separate', 'combined', 'stacked'].forEach(m =>
    check('Index offers ' + m, idx.indexOf('<option value="' + m + '"') !== -1, ''));
  ['combinedAll', 'stackedAll'].forEach(m =>
    check('Index no longer offers ' + m, idx.indexOf('<option value="' + m + '"') === -1, ''));
  // A saved preference from the removed modes must still land somewhere real,
  // or the select renders blank and reads as a broken control.
  check('a saved *All mode migrates', /replace\(\/All\$\/, ''\)/.test(R('Web - JsHelpers.html')), '');
  // Nothing may still call the folding helpers that were removed.
  ['volumeFamiliesActive_', 'volumeModeIsByFamily_', 'volumeModeIsStacked_'].forEach(fn => {
    const hits = ['Web - JsCharts.html', 'Web - JsState.html', 'Web - JsUi.html',
                  'Web - JsHelpers.html', 'Web - JsData.html', 'Web - JsTour.html']
      .filter(f => R(f).indexOf(fn) !== -1);
    check('no leftover ' + fn, hits.length === 0, hits.join(', ') || 'gone');
  });
}

// ── theme resolution ─────────────────────────────────────────────────────────
head('[3] areaColor_ / groupColor_ follow the theme');
ev("currentTheme='light'");
const lightA = ev('VOLUME_TYPES.map(areaColor_)');
const lightG = ev('[0,1,2,3,4,5,6,7,8].map(groupColor_)');
ev("currentTheme='dark'");
const darkA = ev('VOLUME_TYPES.map(areaColor_)');
const darkG = ev('[0,1,2,3,4,5,6,7,8].map(groupColor_)');
ev("currentTheme='light'");
check('light picks .color', lightA.join() === ev('VOLUME_TYPES.map(t => t.color)').join(), '');
check('dark picks .colorDark', darkA.join() === ev('VOLUME_TYPES.map(t => t.colorDark)').join(), '');
check('the two themes differ', lightA.filter((c, i) => c !== darkA[i]).length >= 18,
      lightA.filter((c, i) => c === darkA[i]).length + ' shared');
check('groupColor_ wraps past 8', lightG[8] === lightG[0], lightG[8] + ' = ' + lightG[0]);
check('groupColor_ themes', lightG[0] !== darkG[0], lightG[0] + ' / ' + darkG[0]);
check('areaColor_ survives junk', ev('areaColor_(null)') === '#888888', '');

// ── the measured checks, on the shipping hexes ───────────────────────────────
head('[4] the palette, measured');
// The colour validator ships with the data-viz skill, which lives in a
// temporary directory. When it is not there the structural checks above still
// run and the measured ones say so rather than the whole suite dying - a
// missing tool is not a failing palette.
let V = null;
try {
  V = require(process.env.DATAVIZ_VALIDATOR ||
    'C:/Users/Calli/AppData/Local/Temp/claude/bundled-skills/2.1.229/' +
    '0ce262059e8d5cb12076b338356e75ac/dataviz/scripts/validate_palette.js');
} catch (e) {
  console.log('\n  (skipped: colour validator not available - set DATAVIZ_VALIDATOR to run it)');
}

const st_ = v => String(v === true ? 'pass' : v === false ? 'fail' : v).toLowerCase();
const SURF = { light: '#ffffff', dark: '#1e1e1e' };
for (const mode of (V ? ['light', 'dark'] : [])) {
  const pick = mode === 'dark' ? 'colorDark' : 'color';
  // The six hues every shade is derived from.
  const fam = ev(`AREA_FAMILIES.map(f => f.${pick})`);
  V.validate(fam, { mode, surface: SURF[mode] }).report.forEach(([name, v, d]) => {
    const s_ = st_(v), band = s_ === 'relief' || s_ === 'warn';
    check(mode + ' 6 hues: ' + name, s_ === 'pass' || band, (band ? '[' + s_ + '] ' : '') + d);
  });
  // What area GROUPS wear. Measured separately now that it is its own list
  // rather than a copy of the family hues - eight mutually distinguishable
  // colours is a claim about this list, so this is where it gets checked.
  const grpHexes = ev(`AREA_GROUP_COLORS${pick === 'colorDark' ? '_DARK' : ''}`);
  V.validate(grpHexes, { mode, surface: SURF[mode] }).report.forEach(([name, v, d]) => {
    const s_ = st_(v), band = s_ === 'relief' || s_ === 'warn';
    check(mode + ' 8 group hues: ' + name, s_ === 'pass' || band, (band ? '[' + s_ + '] ' : '') + d);
  });
  // Each family read as an ordered ramp - that is what "shade within family"
  // has to mean if the shades are to be tellable apart.
  ev('AREA_FAMILIES.map(f => f.name)').forEach(fname => {
    const ramp = ev(`VOLUME_TYPES.filter(t => t.family === ${JSON.stringify(fname)}).map(t => t.${pick})`);
    if (ramp.length < 2) return;
    const bad = V.validateOrdinal(ramp, { mode, surface: SURF[mode] })
                 .report.filter(([, v]) => ['pass', 'warn', 'relief'].indexOf(st_(v)) === -1);
    check(mode + ' ramp: ' + fname, bad.length === 0,
          ramp.join(' ') + (bad.length ? '  <- ' + bad.map(b => b[0]).join(', ') : ''));

    // validateOrdinal accepts a ramp running either way, so it cannot tell a
    // deliberate order from a lucky one. VOLUME_TYPES order is what the charts,
    // chips and table columns follow, so pin the direction to it: reordering
    // the areas is what silently left Top Up mid-light-dark.
    const Ls = ramp.map(oklchL_);
    const ascending = Ls.every((L, i) => i === 0 || L > Ls[i - 1]);
    check(mode + ' ramp direction: ' + fname, ascending,
          ascending ? 'later is lighter' : 'L = ' + Ls.map(l => l.toFixed(3)).join(' ') + ' - later must be lighter');

    // A ramp is meant to be lightness steps of its FAMILY's hue. Nothing tied
    // the two together, so a re-familied area could keep the hue of the family
    // it left and still pass every check above.
    const anchor = oklchH_(ev(`AREA_FAMILIES.filter(f => f.name === ${JSON.stringify(fname)})[0].${pick}`));
    const drift = ramp.map(h => Math.abs(((oklchH_(h) - anchor + 540) % 360) - 180));
    const worst = Math.max(...drift);
    check(mode + ' ramp hue: ' + fname, worst <= 20,
          'worst ' + worst.toFixed(1) + 'deg from the family hue');
  });
}

// RECORDED, not asserted. Nineteen touching series cannot clear the adjacent
// separation floors - that is a limit of the eye, not a defect in the hexes -
// and the combined chart leans on its legend and hover tooltip instead. Kept
// visible here so the cost stays known rather than forgotten.
head('[5] all 19 on one plot, for the record');
for (const mode of (V ? ['light', 'dark'] : [])) {
  const pick = mode === 'dark' ? 'colorDark' : 'color';
  const all = ev(`VOLUME_TYPES.map(t => t.${pick})`);
  V.validate(all, { mode, surface: SURF[mode] }).report
    .filter(([name]) => /CVD|Normal/.test(name))
    .forEach(([name, v, d]) => console.log('  ' + st_(v).toUpperCase() + '  ' + mode + ' ' + name + '   ' + d));
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
