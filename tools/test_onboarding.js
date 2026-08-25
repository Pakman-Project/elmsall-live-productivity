// The first-run setup dialog. Everything it does lands in hiddenVolumeAreas,
// which every page reads, so the cases that matter are the ones where the
// answer and the resulting filter could disagree: a family answer has to become
// the right AREA keys, a building answer must not silently hide the other
// building, and no answer at all must not be committable.
//
// The DOM is stubbed and the state helpers are the REAL ones, lifted out of
// JsHelpers - a test that reimplements toggleAreaKeyPak_ would pass while the
// shipping one was broken.
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

// Pulls one `function name(...) { ... }` out of a source file by brace-matching,
// so the real implementation is what gets exercised.
function grabFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unterminated: ' + name);
}

// ---- A DOM small enough to run the dialog against --------------------------
const els = {};
function fakeEl() {
  return {
    innerHTML: '', textContent: '', hidden: false,
    classList: {
      _s: {},
      add(c) { this._s[c] = true; },
      remove(c) { delete this._s[c]; },
      contains(c) { return !!this._s[c]; }
    }
  };
}
['onboardingSiteChoices', 'onboardingAreaChoices', 'onboardingAreaTitle',
 'onboardingAreaHint', 'onboardingError', 'onboardingOverlay',
 'onboardingPage1', 'onboardingPage2',
 'onboardingBackBtn', 'onboardingNextBtn', 'onboardingDoneBtn'].forEach(id => { els[id] = fakeEl(); });

const store = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const ctx = { console };
ctx.window = { localStorage: store };
ctx.$ = id => els[id] || null;
vm.createContext(ctx);

// Real state, real helpers, real dialog.
vm.runInContext(strip(R('Web - JsState.html')).split('function applyConfigToCSSPak')[0], ctx);
const helpers = R('Web - JsHelpers.html');
['toggleAreaKeyPak_', 'mirrorHiddenAreasPak_', 'safeTextPak', 'escapeAttrPak']
  .forEach(fn => vm.runInContext(grabFn(helpers, fn), ctx));

// Collaborators the dialog hands off to, recorded rather than performed.
vm.runInContext(`
  // Declared below the slice point JsState is cut at, and areaColor_ needs it.
  var currentTheme = 'light';
  var _calls = { site: [], tour: 0, saved: 0, tourOpts: null, tourBeforeClose: null };
  function setSiteFilter_(k) { _calls.site.push(k); siteFilterPreferred = k; siteFilter = k; }
  function maybeAutoStartTour_(opts) {
    _calls.tour++;
    _calls.tourOpts = opts || null;
    // Whether the setup dialog was still covering the page when the tour began.
    // If it was not, the bare dashboard was briefly the top layer.
    _calls.tourBeforeClose = $('onboardingOverlay').classList.contains('active');
  }
  function saveUserPreferences() { _calls.saved++; }
`, ctx);

vm.runInContext(strip(R('Web - JsOnboarding.html')), ctx);
const ev = e => vm.runInContext(e, ctx);

const reset = () => {
  ev('hiddenVolumeAreas = []; hiddenBonusAreas = []; overviewVolAreas = []; syncAreaChips = true;');
  ev('siteFilter = "all"; siteFilterPreferred = "all";');
  ev('_calls = { site: [], tour: 0, saved: 0 };');
  store._d = {};
  els.onboardingError.hidden = false;
  ev('openOnboarding_({ chainTour: true })');
};
const hidden = () => ev('hiddenVolumeAreas.slice().sort()');
const visible = () => ev('VOLUME_TYPES.filter(t => hiddenVolumeAreas.indexOf(t.key) === -1).map(t => t.key)');

head('[1] the buildings offer the right areas');
check('Elmsall = 22', ev('onboardingAreasForSite_("all").length') === 22);
check('E3 = 12', ev('onboardingAreasForSite_("e3").length') === 12);
check('E1/E2 = 11', ev('onboardingAreasForSite_("e1e2").length') === 11);
// The buildings COVER the whole set but no longer partition it: an area
// declared 'all' in AREA_SITE is worked in both and is offered by both, so
// the two lists overlap by exactly those areas and their lengths sum high.
check('together the buildings cover every area',
  ev('new Set([].concat(onboardingAreasForSite_("e3"), onboardingAreasForSite_("e1e2")).map(t => t.key)).size') === 22);
check('and overlap only on the both-buildings areas',
  ev('onboardingAreasForSite_("e3").filter(t => onboardingAreasForSite_("e1e2").some(u => u.key === t.key)).every(t => AREA_SITE[areaBaseKey_(t.key)] === "all")'));

head('[2] a fresh dialog starts fully selected');
// The question is what to leave OUT, so opening with nothing ticked would read
// as though a previous answer had been lost.
reset();
check('every family ticked', ev('_onboardDraft.families.length') === ev('AREA_FAMILIES.length'));
check('resolves to all 22 areas', ev('onboardingSelectedKeys_().length') === 22);

head('[3] a family answer becomes the right AREA keys');
reset();
ev('_onboardDraft.families = ["Picking"]');
check('Picking resolves to its six areas',
  ev('onboardingSelectedKeys_().length') === 6, ev('onboardingSelectedKeys_()').join(', '));
check('and only Picking areas',
  ev('onboardingSelectedKeys_().every(k => VOLUME_TYPES.filter(t => t.key === k)[0].family === "Picking")'));
ev('commitOnboarding_()');
check('everything else is hidden', hidden().length === 16, hidden().length + ' hidden');
check('the six survive', visible().length === 6, visible().join(', '));
check('hidden is stored by area key, never by family',
  ev('hiddenVolumeAreas.every(k => VOLUME_TYPES.some(t => t.key === k))'));

head('[4] a building answer narrows THAT building and leaves the other alone');
// "E3, and of E3 just OSR PiE" says nothing about E1/E2. Hiding E1/E2's areas
// on the strength of it would leave the dashboard empty on switching building.
reset();
ev('_onboardDraft.site = "e3"; _onboardDraft.areas = onboardingAreasForSite_("e3").map(t => t.key)');
ev('commitOnboarding_()');
check('setSiteFilter_ got the building', ev('_calls.site.join()') === 'e3', ev('_calls.site').join());
check('picking every E3 area hides nothing at all', hidden().length === 0, hidden().length + ' hidden');

reset();
ev('_onboardDraft.site = "e3"; _onboardDraft.areas = ["pieVol"]');
ev('commitOnboarding_()');
check('the other eleven E3 areas are hidden', hidden().length === 11, hidden().length + ' hidden');
// 'E3' is what the user was ASKED about, so what gets hidden is what E3's
// own list offered - which includes the both-buildings areas, since those
// really are worked in E3. Declining one there declines it everywhere,
// because there is no E3-only copy of it to decline.
check('and every one of them was on the E3 list',
  ev('hiddenVolumeAreas.every(k => ["e3", "all"].indexOf(AREA_SITE[areaBaseKey_(k)]) !== -1)'),
  hidden().join(', '));
check('no E1/E2-only area is touched',
  ev('onboardingAreasForSite_("e1e2").filter(t => AREA_SITE[areaBaseKey_(t.key)] === "e1e2").every(t => hiddenVolumeAreas.indexOf(t.key) === -1)'));
check('so switching to E1/E2 still shows all 10 of its own',
  ev('siteFilter = "e1e2"; volumeTypesActive_().filter(t => hiddenVolumeAreas.indexOf(t.key) === -1).length') === 10);
check('while E3 still shows just the one',
  ev('siteFilter = "e3"; volumeTypesActive_().filter(t => hiddenVolumeAreas.indexOf(t.key) === -1).length') === 1);

// The whole complex IS the scope, so there the answer covers all twenty-two.
reset();
ev('_onboardDraft.site = "all"; _onboardDraft.families = ["Parcel"]');
ev('commitOnboarding_()');
check('Elmsall narrows everything', hidden().length === 20, hidden().length + ' hidden');

head('[5] an empty answer is refused');
reset();
ev('_onboardDraft.families = []');
ev('commitOnboarding_()');
check('nothing was hidden', hidden().length === 0, hidden().length + ' hidden');
check('the dialog stayed open', ev('$("onboardingOverlay").classList.contains("active")'));
check('an error is shown', els.onboardingError.hidden === false, els.onboardingError.textContent);
check('the draft is intact', ev('_onboardDraft !== null'));
check('the tour did not start', ev('_calls.tour') === 0);
check('and nothing was marked seen', store.getItem('e3_onboarding_seen_v1') === null);

head('[6] a successful answer closes, records, and hands over');
reset();
ev('_onboardDraft.families = ["Packing"]');
ev('commitOnboarding_()');
check('the dialog closed', !ev('$("onboardingOverlay").classList.contains("active")'));
check('marked seen', store.getItem('e3_onboarding_seen_v1') === '1');
check('the tour follows', ev('_calls.tour') === 1);
check('the draft is cleared', ev('_onboardDraft === null'));
check('what was answered is remembered', ev('onboardingRemembered_.families.join()') === 'Packing');

head('[7] reopening from Settings does not replay the tour');
reset();
ev('_calls.tour = 0');
ev('openOnboarding_({ chainTour: false })');
ev('commitOnboarding_()');
check('no tour', ev('_calls.tour') === 0);

head('[8] Escape leaves a usable dashboard');
// No X and no backdrop click, so this is the only other way out - and it must
// not be able to leave the dashboard filtered by a dismissed dialog.
reset();
ev('_onboardDraft.families = []');
ev('closeOnboarding_()');
check('nothing hidden', hidden().length === 0, hidden().length + ' hidden');
check('whole complex', ev('_calls.site.join()') === 'all', ev('_calls.site').join());
check('dialog closed', !ev('$("onboardingOverlay").classList.contains("active")'));
check('the tour still follows', ev('_calls.tour') === 1);

head('[9] the Bonus page follows when the two are synced');
reset();
ev('_onboardDraft.families = ["Parcel"]');
ev('commitOnboarding_()');
check('bonus list mirrors volume',
  ev('hiddenBonusAreas.join() === hiddenVolumeAreas.join()'), ev('hiddenBonusAreas.length') + ' vs ' + ev('hiddenVolumeAreas.length'));
reset();
ev('syncAreaChips = false');
ev('_onboardDraft.families = ["Parcel"]');
ev('commitOnboarding_()');
check('and does not when de-synced', ev('hiddenBonusAreas.length') === 0, ev('hiddenBonusAreas.length') + ' hidden');

head('[10] the volume chart choice is cleared, not left dangling');
reset();
ev('overviewVolAreas = ["pieVol", "topUpVol"]');
ev('_onboardDraft.families = ["Decanting"]');
ev('commitOnboarding_()');
check('cleared so it re-derives', ev('overviewVolAreas.length') === 0, ev('overviewVolAreas').join());
check('and re-derives to visible areas',
  ev('overviewVolTypes_().every(t => hiddenVolumeAreas.indexOf(t.key) === -1)'),
  ev('overviewVolTypes_().map(t => t.label)').join(', '));

head('[11] seeding reflects what is actually in force');
reset();
ev('hiddenVolumeAreas = VOLUME_TYPES.filter(t => t.family !== "Parcel").map(t => t.key)');
ev('seedOnboardingDraft_()');
check('a fully-visible family is ticked', ev('_onboardDraft.families.join()') === 'Parcel', ev('_onboardDraft.families').join());
ev('hiddenVolumeAreas = ["parcelInductVol"]');
ev('seedOnboardingDraft_()');
check('a partly-hidden family is not claimed as ticked',
  ev('_onboardDraft.families.indexOf("Parcel")') === -1, ev('_onboardDraft.families').join());

head('[12] when to ask at all');
store._d = {};
ev('var TOUR_FORCE = "0", DEEP_SITE = "", DEEP_BONUS = ""');
check('a first visit asks', ev('shouldShowOnboarding_()') === true);
store.setItem('e3_onboarding_seen_v1', '1');
check('a return visit does not', ev('shouldShowOnboarding_()') === false);
store._d = {};
ev('TOUR_FORCE = "1"');
check('?tour=1 skips it', ev('shouldShowOnboarding_()') === false);
ev('TOUR_FORCE = "0"; DEEP_SITE = "e3"');
check('a deep link skips it', ev('shouldShowOnboarding_()') === false);
check('but is NOT marked seen, so the next plain visit asks',
  store.getItem('e3_onboarding_seen_v1') === null);

head('[13] the two pages');
// The area question is "which of THESE", so it cannot be on screen before the
// building is known.
reset();
check('opens on the building question', !els.onboardingPage1.hidden && els.onboardingPage2.hidden);
check('offers Next, not Done', !els.onboardingNextBtn.hidden && els.onboardingDoneBtn.hidden);
check('no Back on the first page', els.onboardingBackBtn.hidden);

ev('onboardingNext_()');
check('Next shows the areas', els.onboardingPage1.hidden && !els.onboardingPage2.hidden);
check('and swaps Next for Done', els.onboardingNextBtn.hidden && !els.onboardingDoneBtn.hidden);
check('Back is now offered', !els.onboardingBackBtn.hidden);
check('the area list was rendered', els.onboardingAreaChoices.innerHTML.length > 0);

ev('onboardingBack_()');
check('Back returns to the building', !els.onboardingPage1.hidden && els.onboardingPage2.hidden);

head('[14] changing building on page 1 re-asks page 2 against it');
reset();
ev('onOnboardingSiteChange({ value: "e1e2" })');
ev('onboardingNext_()');
check('the draft followed', ev('_onboardDraft.site') === 'e1e2');
check('and lists only that building',
  ev('_onboardDraft.areas.every(k => ["e1e2", "all"].indexOf(AREA_SITE[areaBaseKey_(k)]) !== -1)'),
  ev('_onboardDraft.areas.length') + ' areas');
check('and nothing from the other one',
  ev('_onboardDraft.areas.every(k => AREA_SITE[areaBaseKey_(k)] !== "e3")'),
  ev('_onboardDraft.areas.length') + ' areas');
ev('commitOnboarding_()');
check('committing from page 2 works', ev('_calls.site.join()') === 'e1e2', ev('_calls.site').join());

head('[15] the handover to the tour is synchronous');
// A deferred start left a frame in which the bare dashboard was the top layer.
reset();
ev('_calls.tourOpts = null');
ev('_onboardDraft.families = ["Picking"]');
ev('commitOnboarding_()');
check('the tour was asked to start immediately',
  ev('_calls.tourOpts && _calls.tourOpts.immediate === true'), JSON.stringify(ev('_calls.tourOpts')));
check('and the backdrop came down after it', ev('_calls.tourBeforeClose') === true);

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
