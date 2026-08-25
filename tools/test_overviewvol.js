// The Overall page's volume chart decides its own series. That decision reads
// three pieces of state at once - the building, the dashboard-wide hidden list
// and the viewer's own choice - and the failure modes are all quiet ones: a
// chart with no series, a chart drawing the other building's areas, or a saved
// choice silently thrown away. Each of those is a case below.
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
const ev = e => vm.runInContext(e, ctx);

const labels = () => ev('overviewVolTypes_().map(t => t.label)');
const keys = () => ev('overviewVolTypes_().map(t => t.key)');
const allIn = site => ev('overviewVolTypes_().every(t => AREA_SITE[areaBaseKey_(t.key)] === ' + JSON.stringify(site) + ')');
const set = (site, hidden, chosen) => {
  ev('siteFilter = ' + JSON.stringify(site) + '; siteFilterPreferred = ' + JSON.stringify(site));
  ev('hiddenVolumeAreas = ' + JSON.stringify(hidden || []));
  ev('overviewVolAreas = ' + JSON.stringify(chosen || []));
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

head('[1] with no choice made, the first two areas in view');
set('all', [], []);
check('Elmsall', same(labels(), ev('volumeTypesActive_().slice(0, 2).map(t => t.label)')), labels().join(', '));
set('e3', [], []);
check('E3 draws E3 areas', allIn('e3'), labels().join(', '));
set('e1e2', [], []);
check('E1/E2 draws E1/E2 areas', allIn('e1e2'), labels().join(', '));

head('[2] the default follows the dashboard-wide hidden list');
// This is what makes the onboarding answers the default without storing them
// twice: hiding everything else IS choosing what leads.
set('all', ['rspsPickVol', 'ispsPickVol'], []);
check('skips hidden areas', keys().indexOf('rspsPickVol') === -1 && keys().indexOf('ispsPickVol') === -1,
      labels().join(', '));
check('and takes the next two', labels().length === 2, labels().join(', '));

head('[3] an explicit choice wins, in VOLUME_TYPES order');
set('all', [], ['e3PackingVol', 'parcelInductVol']);
check('honours it', same(keys(), ['e3PackingVol', 'parcelInductVol']), labels().join(', '));
set('all', [], ['parcelInductVol', 'e3PackingVol']);
check('click order does not leak in', same(keys(), ['e3PackingVol', 'parcelInductVol']), labels().join(', '));
set('all', [], ['e3PackingVol']);
check('one area is a legal choice', same(keys(), ['e3PackingVol']), labels().join(', '));
set('all', [], ev('VOLUME_TYPES.map(t => t.key)'));
check('so is all of them', keys().length === 22, keys().length + ' areas');

head('[4] a choice that no longer applies falls back rather than emptying');
// A saved choice naming the other building is kept, not pruned - switching back
// has to restore it - so the resolver is what has to cope with it.
set('e1e2', [], ['pieVol', 'topUpVol']);
check('never empty', labels().length > 0, labels().join(', '));
check('and in-building', allIn('e1e2'), labels().join(', '));
set('all', [], ['nonsenseVol']);
check('an unknown key falls back', labels().length === 2, labels().join(', '));
set('e1e2', [], ['pieVol', 'sorter6PackingVol']);
check('a partly-applicable choice keeps the part that applies',
      same(keys(), ['sorter6PackingVol']), labels().join(', '));

head('[5] every area hidden still draws a chart');
// hiddenVolumeAreas is a display filter for the panels below; it must not be
// able to leave this chart a bare axis.
set('all', ev('VOLUME_TYPES.map(t => t.key)'), []);
check('Elmsall', labels().length === 2, labels().join(', '));
set('e3', ev('VOLUME_TYPES.map(t => t.key)'), []);
check('E3 stays in-building', allIn('e3') && labels().length === 2, labels().join(', '));

head('[6] the saved choice survives a round trip through the building filter');
set('all', [], ['pieVol', 'topUpVol']);
const beforeSwitch = keys();
ev('siteFilter = "e1e2"; siteFilterPreferred = "e1e2"');
const during = keys();
ev('siteFilter = "all"; siteFilterPreferred = "all"');
check('E1/E2 shows its own areas meanwhile', during.indexOf('pieVol') === -1, during.join(', '));
check('and the choice comes back', same(keys(), beforeSwitch), labels().join(', '));

head('[7] the Productivity % groups lead on the same areas, collected by family');
// Three areas as three groups is three lines and a legend. Collecting the
// same-family ones is what turns the default into a comparison.
const groups = () => ev('defaultAreaGroupsForSite_()');
set('all', [], []);
check('one group when the first three share a family',
  same(groups(), [['rspsPickVol', 'ispsPickVol', 'pieVol']]), JSON.stringify(groups()));

// First three visible become Picking x2 + Returns x1.
set('all', ['pieVol', 'onlinePickingDriveVol', 'onlinePickingWayVol', 'onlinePickingE3Vol'], []);
check('splits when they do not',
  same(groups(), [['rspsPickVol', 'ispsPickVol'], ['rspsTopUpVol']]), JSON.stringify(groups()));

set('all', [], []);
check('never more than three areas total',
  ev('defaultAreaGroupsForSite_().reduce((n, g) => n + g.length, 0)') <= 3, JSON.stringify(groups()));
check('and never more than three groups', groups().length <= 3, groups().length + ' groups');

set('e1e2', [], []);
check('stays in the building',
  ev('defaultAreaGroupsForSite_().every(g => g.every(k => ["e1e2", "all"].indexOf(AREA_SITE[areaBaseKey_(k)]) !== -1))'),
  JSON.stringify(groups()));

// Everything hidden must still produce a chart, exactly as the volume one does.
set('all', ev('VOLUME_TYPES.map(t => t.key)'), []);
check('never empty', groups().length > 0 && groups()[0].length > 0, JSON.stringify(groups()));

set('all', [], []);
check('the two Overall charts agree on what leads',
  ev('defaultAreaGroupsForSite_()[0][0]') === ev('overviewVolTypes_()[0].key'),
  ev('defaultAreaGroupsForSite_()[0][0]') + ' / ' + ev('overviewVolTypes_()[0].key'));

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(fail ? 1 : 0);
