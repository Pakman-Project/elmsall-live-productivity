// The wire format for rawSideData.
//
// One builder makes the row objects (buildSideEntry_), they are flattened to
// positional arrays on the way out, and the client rebuilds them. That is two
// readers of one set of rows again - the failure test_backend.js exists for -
// except this pair cannot even disagree loudly: a field decoded to the wrong
// thing renders a plausible dashboard with quietly wrong numbers in it.
//
// So the suite leads with running BOTH ends over one fixture and demanding the
// decoded objects are indistinguishable from what went in.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

const CODE = R('Web - Code.js');
const INIT = R('Web - JsInit.html');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

// ── both ends, in one context ───────────────────────────────────────────────
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(CODE.slice(CODE.indexOf('var PROC_AREA_COLUMNS_'),
                           CODE.indexOf('function normaliseProcHeader_')), ctx);
vm.runInContext(CODE.slice(CODE.indexOf('function sideSchema_'),
                           CODE.indexOf('function buildSideEntry_')), ctx);
vm.runInContext(INIT.slice(INIT.indexOf('function decodeSideRowsPak_'),
                           INIT.indexOf('var PAYLOAD_CACHE_KEY')), ctx);

const schema = ctx.sideSchema_();

head('[1] the schema names every field, once');
{
  check('it exists on both sides',
        typeof ctx.sideSchema_ === 'function' &&
        typeof ctx.encodeSideRows_ === 'function' &&
        typeof ctx.decodeSideRowsPak_ === 'function');
  check('two numeric fields per area, plus the total',
        schema.num.length === ctx.PROC_AREA_COLUMNS_.length * 2 + 1,
        schema.num.length + ' for ' + ctx.PROC_AREA_COLUMNS_.length + ' areas');
  check('derived from PROC_AREA_COLUMNS_, not a second list of names',
        /PROC_AREA_COLUMNS_\[i\]\.key \+ 'Std'/.test(CODE) &&
        /num\.push\(PROC_AREA_COLUMNS_\[i\]\.key\)/.test(CODE),
        'a list here would drift from the column map the first time an area moved');
  const all = schema.text.concat(schema.bool, schema.num);
  check('no name appears twice', new Set(all).size === all.length);
  check('the two logs carry status and both clip times',
        ['osStatus', 'osFrom', 'osTo', 'nplStatus', 'nplFrom', 'nplTo']
          .every(f => schema.text.indexOf(f) !== -1));
  check('and os/npl are the booleans',
        schema.bool.join() === 'os,npl');
}

head('[2] a row survives the round trip unchanged');
// Shaped exactly as buildSideEntry_ builds them, including the fields it sets
// only on the rows that have one.
function entry(over) {
  const e = { timeRange: '21/09/2026 06:00 - 21/09/2026 06:15', bonus: '1AM',
              value: 0, os: false, npl: false };
  for (const a of ctx.PROC_AREA_COLUMNS_) { e[a.key + 'Std'] = 0; e[a.key] = 0; }
  return Object.assign(e, over || {});
}
{
  const fixture = [
    entry({ value: 0.2183, pieStd: 0.2183, pie: 37 }),
    // On OS, with a status and a clipped span.
    entry({ bonus: '1E8', os: true, osStatus: 'Approved',
            osFrom: '07:26', osTo: '07:30' }),
    // On NPL, whose status passes through as typed.
    entry({ bonus: 'ZUW', npl: true, nplStatus: 'Cancelled',
            nplFrom: '09:00', nplTo: '09:15', rspsPickStd: 1.5, rspsPick: 12 }),
    // Both at once, which a block can be.
    entry({ bonus: 'B58', os: true, npl: true, osStatus: 'Rejected',
            osFrom: '12:00', osTo: '12:15', nplStatus: 'OK',
            nplFrom: '12:00', nplTo: '12:15' }),
    // Every area carrying something, so no column is only ever tested at zero.
    entry(ctx.PROC_AREA_COLUMNS_.reduce((o, a, i) => {
      o[a.key + 'Std'] = (i + 1) / 100; o[a.key] = i + 1; return o;
    }, { bonus: 'ALL' }))
  ];

  const wire = ctx.encodeSideRows_(fixture, schema);
  const back = ctx.decodeSideRowsPak_(JSON.parse(JSON.stringify(wire)), schema);

  check('same number of rows out as in', back.length === fixture.length);
  let mismatch = '';
  for (let i = 0; i < fixture.length && !mismatch; i++) {
    const a = JSON.stringify(fixture[i], Object.keys(fixture[i]).sort());
    const b = JSON.stringify(back[i], Object.keys(fixture[i]).sort());
    if (a !== b) mismatch = 'row ' + i;
    // and no field invented on the way
    const extra = Object.keys(back[i]).filter(k => !(k in fixture[i]));
    if (extra.length) mismatch = 'row ' + i + ' gained ' + extra.join(',');
  }
  check('every field of every row comes back identical', !mismatch, mismatch);

  check('an absent optional stays ABSENT, not an empty string',
        !('osStatus' in back[0]) && !('nplFrom' in back[0]),
        'the client tests these with `if (entry.osStatus)`');
  check('and a present one keeps its exact wording',
        back[2].nplStatus === 'Cancelled' && back[3].osStatus === 'Rejected');
  check('booleans come back as real booleans, not 1/0',
        back[1].os === true && back[1].npl === false &&
        back[3].os === true && back[3].npl === true,
        'JsData tests `r.os === true`, which 1 would fail');
  check('zeros stay numbers',
        back[0].topUpStd === 0 && typeof back[0].topUpStd === 'number');
  check('and every area value lands in its own field',
        ctx.PROC_AREA_COLUMNS_.every((a, i) =>
          back[4][a.key + 'Std'] === (i + 1) / 100 && back[4][a.key] === i + 1),
        'one field off by a place would move hours between work areas');
}

head('[3] it is actually smaller - the whole point');
{
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(entry({ value: 0.25, pieStd: 0.25, pie: 9 }));
  const asObjects = JSON.stringify(rows).length;
  const asWire = JSON.stringify(ctx.encodeSideRows_(rows, schema)).length +
                 JSON.stringify(schema).length;
  const ratio = asObjects / asWire;
  check('at least four times smaller', ratio >= 4,
        Math.round(asObjects / 200) + ' B/row -> ' +
        Math.round(asWire / 200) + ' B/row (' + ratio.toFixed(1) + 'x)');
  // The schema is sent ONCE. If it were per row this would all be for nothing.
  check('the schema is sent once, beside the rows, not on them',
        /sideSchema: sideSchema,/.test(CODE) &&
        !/sideSchema:/.test(CODE.slice(CODE.indexOf('function encodeSideRows_'),
                                       CODE.indexOf('function buildSideEntry_'))));
}

head('[4] payloads that carry no schema still work');
// The tour's demo data and any localStorage copy saved before this format
// existed are plain objects. Decoding must pass them straight through.
{
  const plain = [{ timeRange: 'x', bonus: 'A', value: 1, os: false, npl: false }];
  check('no schema means the rows are already objects',
        ctx.decodeSideRowsPak_(plain, undefined) === plain,
        'the tour builds rawSideData by hand - see Web - JsTourData.html');
  check('and an empty payload is an empty array, not a throw',
        Array.isArray(ctx.decodeSideRowsPak_(undefined, schema)) &&
        ctx.decodeSideRowsPak_(undefined, schema).length === 0);
  check('the cache key was bumped, so an old copy is not mixed with a new one',
        /e3_dashboard_payload_v3_/.test(INIT));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
