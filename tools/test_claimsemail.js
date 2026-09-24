// The 07:00 Claims email. Runs 'Spreadsheet - Claims Email.js' for real, with
// Apps Script stubbed out and HtmlService serving the actual client files off
// disk - so the loader, the file cuts and the Claims page's own scan are all
// exercised exactly as the server will run them.
const fs = require('fs'), vm = require('vm');
const path = require('path');
const APPS = path.resolve(__dirname, '..') + path.sep;
const R = f => fs.readFileSync(APPS + f, 'utf8');

let fail = 0;
const head = t => console.log('\n' + t);
const check = (label, ok, detail) => {
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   ' + detail : ''));
};

// The real wire format, from Code.js, so the page's decoder is fed what
// getDashboardData actually sends.
const CODE = R('Web - Code.js');
const wire = { console };
vm.createContext(wire);
vm.runInContext(CODE.slice(CODE.indexOf('var PROC_AREA_COLUMNS_'),
                           CODE.indexOf('function normaliseProcHeader_')), wire);
vm.runInContext(CODE.slice(CODE.indexOf('function sideSchema_'),
                           CODE.indexOf('function buildSideEntry_')), wire);
vm.runInContext(CODE.slice(CODE.indexOf('function formatDateTimeRange_'),
                           CODE.indexOf('function toNumber_')), wire);
const block = (d, h, m) => {
  const s = new Date(2026, 8, d, h, m);
  return wire.formatDateTimeRange_(s, new Date(s.getTime() + 900000));
};

function world(opts) {
  const calls = { opened: [], logs: [], mail: [], writes: [], cleared: [] };
  const claimsTab = {
    getLastRow: () => opts.archiveLastRow || 0,
    getRange: (r, c, nr, nc) => ({
      setValues: v => calls.writes.push({ r, c, v }),
      clearContent: () => calls.cleared.push({ r, c, nr, nc })
    })
  };
  const side = opts.side.map(s => Object.assign({ timeRange: block(s.d, s.h, s.m) }, s));
  const ctx = {
    console,
    Session: { getScriptTimeZone: () => 'Europe/London' },
    Utilities: { formatDate: d => ('0' + d.getDate()).slice(-2) + '/' +
                                  ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear(),
                 newBlob: (data, type, name) => ({ data, type, name }) },
    Logger: { log: m => calls.logs.push(m) },
    HtmlService: { createHtmlOutputFromFile: f => ({ getContent: () => R(f + '.html') }) },
    getArchiveLinks: () => [{ name: '22/09/2026', url: 'U22' }, { name: '23/09/2026', url: 'U23' }],
    getOsLogRows: (keys, url) => { calls.logs.push('os ' + keys + ' ' + url); return { rows: opts.os }; },
    getNplLogRows: (keys, url) => { calls.logs.push('npl ' + keys + ' ' + url); return { rows: opts.npl }; },
    getDashboardData: url => {
      const schema = wire.sideSchema_();
      return JSON.parse(JSON.stringify({ timeRanges: [], sideSchema: schema,
                                         rawSideData: wire.encodeSideRows_(side, schema) }));
    },
    SpreadsheetApp: {
      openByUrl: u => { calls.opened.push(u); return { getSheetByName: () => claimsTab }; },
      getActiveSpreadsheet: () => ({ getSheetByName: () => ({
        getLastRow: () => opts.recipients.length + 1,
        getRange: () => ({ getValues: () => opts.recipients.map(v => [v]) })
      }) })
    },
    MailApp: { sendEmail: m => calls.mail.push(m) }
  };
  vm.createContext(ctx);
  vm.runInContext(R('Spreadsheet - Claims Email.js'), ctx);
  return { ctx, calls };
}

const BASE = {
  recipients: ['a@x.com', '', ' b@x.com '],
  side: [
    // AAA: 15 minutes inside its OS claim, plus 30 more elsewhere in the day.
    // Two areas, so the email has a list to print without their minutes.
    { d: 23, h: 10, m: 0, bonus: 'AAA', value: 0.25, pieStd: 0.05, e3PackingStd: 0.2 },
    { d: 23, h: 14, m: 0, bonus: 'AAA', value: 0.5 },
    // BBB: 0.3 of a minute inside its NPL claim, after midnight.
    { d: 24, h: 1, m: 0, bonus: 'BBB', value: 0.005 },
    // CCC: real production inside an 11.5-hour-plus claim, which must not
    // reach the email at all - see [1b].
    { d: 23, h: 8, m: 0, bonus: 'CCC', value: 0.25, npl: true }
  ],
  os: [{ bonus: 'AAA', date: '23/09/2026', from: '10:00', to: '11:00', status: '',
         auth: 'J Smith', job: 'Training' }],
  npl: [
    { bonus: 'BBB', date: '23/09/2026', from: '00:30', to: '02:00', check: 'OK',
      tmAuth: 'K Lee', task: 'Meeting' },
    { bonus: 'CCC', date: '23/09/2026', from: '06:00', to: '18:00', check: 'OK',
      tmAuth: 'L Ng', task: 'Long one' }
  ]
};

head('[1] on 24/09 at 07:00 it sends the 23/09 archive\'s Overlapping Claims page');
// Corrected from the original D-2 spec: the archive for D-1 already exists by
// 07:00 (the daily automation archives a date the moment it is no longer
// today, well before this trigger fires), and D-1 is the production day
// someone checking "yesterday's claims" at 07:00 actually means.
{
  const { ctx, calls } = world(BASE);
  ctx.sendClaimsEmailFor_(new Date(2026, 8, 24, 7, 0));
  check('both logs asked for 23/09, from the 23/09 archive',
        calls.logs.includes('os 23/09/2026 U23') && calls.logs.includes('npl 23/09/2026 U23'),
        calls.logs.join(' | '));
  check('one email', calls.mail.length === 1);
  const mail = calls.mail[0];
  check('subject uses the page\'s new name', mail.subject === 'Overlapping Claims - 23/09/2026', mail.subject);
  check('recipients from A2:A, blanks skipped and trimmed',
        mail.to === 'a@x.com,b@x.com', mail.to);
  check('the window is 23/09 06:00 to 24/09 06:00',
        mail.htmlBody.includes('23/09/2026 06:00 to 24/09/2026 06:00'));
  check('written into that archive', calls.opened.join() === 'U23', calls.opened.join());

  const hdr = calls.writes.find(w => w.r === 1);
  const body = calls.writes.find(w => w.r === 2);
  check('headings at C1, the page\'s own column labels, Task included',
        hdr && hdr.c === 3 && hdr.v[0].join() ===
          'Bonus,Work Areas,Total Std Mins Produced,Overlap Std Mins,Overlap Time,Claim,Claim Time,Task,TM authorised,Status',
        hdr && hdr.v[0].join());
  check('rows from C2, worst overlap first, CCC left out (690+ minute claim)',
        body && body.c === 3 && body.v.map(r => r[0]).join() === 'AAA,BBB',
        body && JSON.stringify(body.v));
  const aaa = body.v[0], bbb = body.v[1];
  check('AAA: 45 mins all day, 15 of them overlapping',
        aaa[2] === '45' && aaa[3] === '15', aaa.join(' | '));
  check('BBB: a fraction of a minute reads "~1"', bbb[3] === '~1', bbb.join(' | '));
  check('a claim starting after midnight still belongs to the day before',
        bbb[6] === '00:30 - 02:00', bbb[6]);
  check('the Task column carries the OS Job / NPL Task, between Claim Time and TM authorised',
        aaa[7] === 'Training' && bbb[7] === 'Meeting', aaa.join(' | ') + ' // ' + bbb.join(' | '));
  check('the email shows the same rows', mail.htmlBody.includes('>AAA<') &&
        mail.htmlBody.includes('>~1<') && mail.htmlBody.includes('>Training<'));
  check('CCC is nowhere in the email either', !mail.htmlBody.includes('>CCC<'));
  check('OVERLAP STD MINS reads red and uppercase in the summary line',
        /color:#d32f2f">15 OVERLAP STD MINS/.test(mail.htmlBody), mail.htmlBody);
  check('several areas are named without their minutes, biggest first',
        aaa[1] === 'E3 Packing, OSR PiE', aaa[1]);
  check('the dashboard is linked, as "Open Elmsall Live Productivity for more information"',
        mail.htmlBody.includes('Open <a href="https://sites.google.com/next.co.uk/' +
                               'elmsall-live-productivity/home">Elmsall Live Productivity</a>' +
                               ' for more information.'));
  check('the Warehouse-picker sentence is gone', !/Warehouse picker/.test(mail.htmlBody));
  const csv = mail.attachments && mail.attachments[0];
  check('a CSV is attached, named without slashes',
        csv && csv.type === 'text/csv' && csv.name === 'Overlapping Claims - 23-09-2026.csv',
        csv && csv.name);
  const lines = csv ? csv.data.split('\r\n') : [];
  check('headings then the same rows as the tab', lines.length === 3 &&
        lines[0] === hdr.v[0].join(',') && lines[2].startsWith('BBB,'), lines.join(' || '));
  check('a field holding a comma is quoted', lines[1] ===
        'AAA,"E3 Packing, OSR PiE",45,15,10:00 - 10:15,OS,10:00 - 11:00,Training,J Smith,No verdict',
        lines[1]);
  check('the client files\' state stayed inside the loader, not on the server\'s globals',
        !('fraudOsRows' in ctx) && !('timeRanges' in ctx) && !('allSideData' in ctx) &&
        !('rawSideData' in ctx),
        Object.keys(ctx).filter(k => /fraud|Side|timeRanges/.test(k)).join());
}

head('[2] a re-run clears the old rows before writing');
{
  const { ctx, calls } = world(Object.assign({}, BASE, { archiveLastRow: 9 }));
  ctx.sendClaimsEmailFor_(new Date(2026, 8, 24, 7, 0));
  check('C2 down cleared, the full width', calls.cleared.length === 1 &&
        JSON.stringify(calls.cleared[0]) === '{"r":2,"c":3,"nr":8,"nc":10}',
        JSON.stringify(calls.cleared));
}

head('[3] nothing flagged still sends, and says so');
{
  const { ctx, calls } = world(Object.assign({}, BASE, { os: [], npl: [] }));
  ctx.sendClaimsEmailFor_(new Date(2026, 8, 24, 7, 0));
  check('sent', calls.mail.length === 1);
  check('with the page\'s own "none found" wording',
        calls.mail[0].htmlBody.includes('No claim overlaps produced hours'));
  check('only the headings written', calls.writes.length === 1 && calls.writes[0].r === 1);
}

head('[4] failures are loud, not silent');
{
  const throws = (o, now) => {
    const { ctx, calls } = world(Object.assign({}, BASE, o));
    try { ctx.sendClaimsEmailFor_(now || new Date(2026, 8, 24, 7, 0)); return calls.mail.length ? 'sent' : 'no throw'; }
    catch (e) { return e.message; }
  };
  check('no archive for the day throws', /no archive for 21\/09\/2026/.test(
        throws({}, new Date(2026, 8, 22, 7, 0))));
  check('no recipients throws', /no recipients/.test(throws({ recipients: [''] })));
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all passed'));
process.exit(fail ? 1 : 0);
