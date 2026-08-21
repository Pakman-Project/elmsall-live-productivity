// Chart settings that are lists of AREA KEYS, kept per building.
//
// The bug: one shared copy meant a group built in E1/E2 - "RSPS Pick" - was
// still listed in the Groups & Charts dialog while viewing E3, offering a chart
// of areas that building does not have. Every case below is a way that can come
// back, and none of them raises an error when it does - the wrong areas simply
// appear, which looks like a configuration the user does not remember making.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(APPS + 'Web - JsState.html', 'utf8')
    .replace(/<\/?script>/g, '').split('function applyConfigToCSSPak')[0], ctx);
vm.runInContext(`
  var currentTheme = 'light';
  var selectedBonuses = [];
  function syncSiteUi_() {}
`, ctx);
const ev = e => vm.runInContext(e, ctx);

const to = site => {
  ev('siteFilterPreferred = ' + JSON.stringify(site));
  ev('syncSiteScope_()');
};
const groupKeys = () => ev('areaGroupState.map(g => g.keys.join("+")).join(" | ")');
const allGroupKeys = () => ev('areaGroupState.reduce((a, g) => a.concat(g.keys), [])');
const inSite = site => ev('areaGroupState.every(g => g.keys.every(k => AREA_SITE[areaBaseKey_(k)] === ' + JSON.stringify(site) + '))');
const reset = () => {
  ev('siteSettings_ = {}; siteSettingsTouched_ = {}; hiddenVolumeAreas = []; hiddenBonusAreas = [];');
  ev('siteFilter = "all"; siteFilterPreferred = "all";');
  ev('applySiteSettings_("all")');
};
// Standing in for a dialog's Apply: set the value, then mark it configured.
const configureGroups = keys => {
  ev('areaGroupState = ' + JSON.stringify(keys.map(k => ({ keys: [k], showLine: true, showTrend: true }))));
  ev('markSiteSettingsTouched_(siteFilter, "areaGroups")');
};

head('[1] the reported bug: an E1/E2 group must not appear in E3');
reset();
to('e1e2');
// Configure E1/E2 with a group naming an area E3 does not have.
configureGroups(['rspsPickVol']);
check('E1/E2 holds the RSPS group', groupKeys() === 'rspsPickVol', groupKeys());
to('e3');
check('E3 does not show it', allGroupKeys().indexOf('rspsPickVol') === -1, groupKeys());
check('E3 shows only E3 areas', inSite('e3'), groupKeys());
to('e1e2');
check('and E1/E2 still has it on return', groupKeys() === 'rspsPickVol', groupKeys());

head('[2] each building is configured on its own');
reset();
to('e3');
configureGroups(['e3PackingVol']);
to('e1e2');
configureGroups(['sorter6PackingVol']);
to('all');
configureGroups(['parcelInductVol']);
to('e3');
check('E3 kept its own', groupKeys() === 'e3PackingVol', groupKeys());
to('e1e2');
check('E1/E2 kept its own', groupKeys() === 'sorter6PackingVol', groupKeys());
to('all');
check('Elmsall kept its own', groupKeys() === 'parcelInductVol', groupKeys());

head('[3] an unconfigured building follows the default rule');
reset();
to('e3');
configureGroups(['e3PackingVol']);
to('e1e2');
check('E1/E2 was never configured, so it derives',
  ev('JSON.stringify(areaGroupState) === JSON.stringify(defaultAreaGroupState_())'), groupKeys());
check('and it is in-building', inSite('e1e2'), groupKeys());
check('nothing was stored for it', ev('!siteSettings_.hasOwnProperty("e1e2")'),
  Object.keys(ev('siteSettings_')).join(','));

head('[4] only what differs from the rule is remembered');
// Otherwise the first switch away freezes the default, and the building stops
// following its own visible areas.
reset();
to('e3');
check('an untouched building stores nothing', ev('!siteSettings_.hasOwnProperty("e3")'));
ev('captureSiteSettings_("e3")');
check('capturing an untouched building still stores nothing',
  ev('!siteSettings_.hasOwnProperty("e3")'), JSON.stringify(ev('siteSettings_')));

// ...and because it stays unconfigured, hiding an area still moves its groups.
ev('hiddenVolumeAreas = ["pieVol"]');
to('all'); to('e3');
check('so hiding an area re-derives the groups',
  allGroupKeys().indexOf('pieVol') === -1, groupKeys());

// A real edit IS remembered.
configureGroups(['bcrInductingVol']);
ev('captureSiteSettings_("e3")');
check('an edited building is stored', ev('siteSettings_.hasOwnProperty("e3")'));
ev('hiddenVolumeAreas = ["pieVol", "e3PackingVol"]');
to('all'); to('e3');
check('and then it stops re-deriving', groupKeys() === 'bcrInductingVol', groupKeys());

head('[5] the other key-holding settings travel with the building too');
reset();
to('e1e2');
ev('overviewVolAreas = ["rspsPickVol"]; markSiteSettingsTouched_(siteFilter, "overviewVolAreas")');
ev('trendSplitState = { enabled: true, charts: [["rspsPickVol"]] }; markSiteSettingsTouched_(siteFilter, "trendSplit")');
to('e3');
check('the volume chart choice does not follow',
  ev('overviewVolAreas.indexOf("rspsPickVol")') === -1, ev('overviewVolAreas').join(','));
check('nor the trend split',
  ev('JSON.stringify(trendSplitState.charts)').indexOf('rspsPickVol') === -1,
  ev('JSON.stringify(trendSplitState)'));
to('e1e2');
check('both come back', ev('overviewVolAreas.join()') === 'rspsPickVol' &&
  ev('JSON.stringify(trendSplitState.charts)').indexOf('rspsPickVol') !== -1,
  ev('overviewVolAreas').join(',') + ' / ' + ev('JSON.stringify(trendSplitState)'));

head('[6] the group SPLIT is per building as well');
// Its charts hold group INDICES, so carrying it across would point at groups
// that building does not have.
reset();
to('e1e2');
configureGroups(['rspsPickVol', 'ispsPickVol']);
ev('areaGroupSplitState = { enabled: true, charts: [[0], [1]] }; markSiteSettingsTouched_(siteFilter, "areaGroups")');
to('e3');
check('E3 is not split by E1/E2 groups', ev('areaGroupSplitState.enabled') === false,
  ev('JSON.stringify(areaGroupSplitState)'));
to('e1e2');
check('E1/E2 still is', ev('areaGroupSplitState.enabled') === true,
  ev('JSON.stringify(areaGroupSplitState)'));

head('[7] forgetting a building puts it back on the rule');
reset();
to('e3');
configureGroups(['bcrInductingVol']);
ev('captureSiteSettings_("e3")');
ev('forgetSiteSettings_("e3"); applySiteSettings_("e3")');
check('back to the derived default',
  ev('JSON.stringify(areaGroupState) === JSON.stringify(defaultAreaGroupState_())'), groupKeys());
check('and only that building was forgotten',
  ev('!siteSettings_.hasOwnProperty("e3")'), Object.keys(ev('siteSettings_')).join(','));

head('[8] a bonus filter borrows the whole complex, then hands the building back');
reset();
to('e3');
configureGroups(['e3PackingVol']);
ev('selectedBonuses = ["X"]');
ev('syncSiteScope_()');
check('the filter widens to Elmsall', ev('siteFilter') === 'all', ev('siteFilter'));
ev('selectedBonuses = []');
ev('syncSiteScope_()');
check('and E3 gets its groups back', groupKeys() === 'e3PackingVol', groupKeys());

head('[9] resetting one dialog leaves the others alone');
// "Reset to Default" in Groups & Charts must not silently discard this
// building's Deployment Trend split - a different dialog, a different question.
reset();
to('e3');
configureGroups(['bcrInductingVol']);
ev('trendSplitState = { enabled: true, charts: [["e3PackingVol"]] }; markSiteSettingsTouched_(siteFilter, "trendSplit")');
ev('forgetSiteSetting_("e3", "areaGroups")');
ev('captureSiteSettings_("e3")');
check('the groups went back to the rule',
  !ev('siteSettings_.e3 && siteSettings_.e3.hasOwnProperty("areaGroups")'),
  JSON.stringify(ev('siteSettings_.e3')));
check('the trend split survived',
  ev('!!(siteSettings_.e3 && siteSettings_.e3.trendSplit)'),
  JSON.stringify(ev('siteSettings_.e3')));
to('all'); to('e3');
check('and it comes back on return',
  ev('JSON.stringify(trendSplitState.charts)').indexOf('e3PackingVol') !== -1,
  ev('JSON.stringify(trendSplitState)'));
check('while the groups re-derive',
  ev('JSON.stringify(areaGroupState) === JSON.stringify(defaultAreaGroupState_())'), groupKeys());

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
