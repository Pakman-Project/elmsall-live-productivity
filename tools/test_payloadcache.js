// savePayloadCache_ (Web - JsInit.html) - the localStorage instant-repaint
// cache for the live payload.
//
// The one behaviour worth a real test: once localStorage has genuinely
// refused a write (QuotaExceededError, not just PAYLOAD_CACHE_MAX_CHARS
// declining), every later call this session must give up WITHOUT paying to
// JSON.stringify the payload again - that string is ~7-8MB for a real
// account, and a write that fails once against a fixed browser quota will
// fail identically on every later call, since the payload only grows over a
// session, never shrinks back under it.
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

const INIT = R('Web - JsInit.html');
const STATE = R('Web - JsState.html');

function world() {
  const warns = [], infos = [];
  const store = {};
  let setItemCalls = 0;
  const ctx = {
    console: { warn: m => warns.push(m), info: m => infos.push(m), log: console.log },
    localStorage: {
      setItem: (k, v) => {
        setItemCalls++;
        if (ctx.__quotaFails) {
          var e = new Error("Failed to execute 'setItem' on 'Storage': Setting the value of '" +
                             k + "' exceeded the quota.");
          e.name = 'QuotaExceededError';
          throw e;
        }
        store[k] = v;
      },
      removeItem: k => { delete store[k]; }
    },
    __quotaFails: false
  };
  vm.createContext(ctx);
  // VOLUME_TYPES only, for PAYLOAD_CACHE_KEY.
  vm.runInContext(strip(STATE).slice(strip(STATE).indexOf('var VOLUME_TYPES'),
                                     strip(STATE).indexOf('var VOLUME_TYPES') + 4000)
                    .split(/\n\];/)[0] + '\n];', ctx);
  vm.runInContext(
    strip(INIT).slice(strip(INIT).indexOf('var PAYLOAD_CACHE_KEY'),
                      strip(INIT).indexOf('function renderCachedPayload_')),
    ctx);
  return { ctx, warns, infos, store, calls: () => setItemCalls };
}

head('[1] a real quota failure is remembered for the rest of the session');
{
  const { ctx, warns, calls } = world();
  ctx.__quotaFails = true;
  ctx.savePayloadCache_({ big: 'x'.repeat(1000) });
  check('the write was attempted once, and failed', calls() === 1);
  check('logged as a real failure, not a decline',
        warns.some(w => /payload cache write failed/.test(w)), warns.join(' | '));
  check('the flag is now set', ctx.payloadCacheQuotaHit_ === true);

  ctx.savePayloadCache_({ big: 'y'.repeat(1000) });
  check('a second call does not touch localStorage.setItem again', calls() === 1,
        'the payload only grows over a session, so a second failure is guaranteed');
  check('and nothing new was logged either', warns.length === 1, JSON.stringify(warns));
}

head('[2] a normal write is unaffected - the flag only trips on a real failure');
{
  const { ctx, infos, store, calls } = world();
  ctx.savePayloadCache_({ small: 'x' });
  check('written for real', calls() === 1 && !!store[ctx.PAYLOAD_CACHE_KEY]);
  check('and logged as saved, not declined or failed',
        infos.some(i => /payload cache saved/.test(i)), infos.join(' | '));
  check('the flag stays false', ctx.payloadCacheQuotaHit_ === false);
}

head('[3] an archive view is never cached, quota flag or not');
{
  const { ctx, calls } = world();
  ctx.savePayloadCache_({ x: 1 }, 'https://example/archive');
  check('no attempt at all', calls() === 0);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
