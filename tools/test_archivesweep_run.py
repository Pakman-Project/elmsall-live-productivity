"""The archive sweep's per-archive block, EXECUTED - twice.

A regex suite could not have caught the bug this exists for, and neither could
running the block once. `_dtr` was both the window formatter and, further down
the same loop body, a loop variable:

    def _dtr(start, end): ...          # the formatter _os_windows calls
    for _dtr, _bonus in sorted(...):   # rebinds that global to a string

Archive #1 ran fine and rebound the name on its way out. Archive #2 called a
string, raised TypeError inside the OS block's own try, and came back with
OS_STATUS = {} - so seven of eight archives got "NO" in every OS and NPL
column while their log tabs were perfectly correct, and the job still printed
"8 rebuilt, 0 failed".

So the shape of the test is: run the loop body over TWO archives and demand
the second one produces what the first did. Anything that leaks between
iterations fails here and nowhere else.

The Google client is stubbed - this is about the notebook's own logic, not
about gspread.

    python tools/test_archivesweep_run.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DBX = os.path.join(HERE, '..', '..', 'Databricks-Live-Productivity-Output')
SWEEP = os.path.join(DBX, 'Elmsall Live Productivity - Archive Sweep.ipynb')

fails = []


def check(label, ok, detail=''):
    if not ok:
        fails.append(label)
    print('  %s  %s%s' % ('ok  ' if ok else 'FAIL', label,
                          ('   ' + str(detail)) if detail else ''))


def head(t):
    print('\n' + t)


def cells():
    with io.open(SWEEP, encoding='utf-8') as fh:
        return [''.join(c.get('source', [])) for c in json.load(fh)['cells']]


# ── the stub sheet ──────────────────────────────────────────────────────────
# Only what the notebook actually touches: worksheets(), worksheet(), get(),
# get_all_values(), col_values(), update(), resize(), batch_clear(), title,
# row_count, col_count.
class Ws(object):
    def __init__(self, title, values=None, rows=1000, cols=60):
        self.title = title
        self.values = values or []
        self.row_count = rows
        self.col_count = cols
        self.written = None

    def get(self, rng=None):
        return [r[:] for r in self.values]

    def get_all_values(self):
        return [r[:] for r in self.values]

    def col_values(self, n):
        return [r[n - 1] for r in self.values if len(r) >= n]

    def update(self, _a1, vals, value_input_option=None):
        self.written = vals

    def resize(self, rows=None, cols=None):
        if rows:
            self.row_count = rows
        if cols:
            self.col_count = cols

    def batch_clear(self, _ranges):
        pass


class Sheet(object):
    def __init__(self, title, ws):
        self.title = title
        self._ws = ws

    def worksheets(self):
        return list(self._ws)

    def worksheet(self, name):
        for w in self._ws:
            if w.title == name:
                return w
        raise KeyError(name)

    def add_worksheet(self, title, rows, cols):
        w = Ws(title, [], rows, cols)
        self._ws.append(w)
        return w


DTR = '21/09/2026 06:00 - 21/09/2026 06:15'


def make_archive(name):
    """One archive whose Data tab has a block, and whose OS/NPL logs claim it."""
    # get("C2:D2") returns just those two cells - the stub's get() ignores the
    # range, so the tab holds exactly what that range would yield.
    front = Ws('Front', [['96.40%', '95.00%']])
    # Data: A=Date B=Hour C=Bonus D=EventType E=Attr F=Qty G=StdHours
    #       H=SMV I=Week J=DateTimeRange K=ReportName
    data = Ws('Data', [
        ['Date', 'Hour', 'BONUS', 'Event', 'Attr', 'Qty', 'Std',
         'SMV', 'Week', 'Date Time Range', 'Report Name'],
        ['21/09/2026', '6', '1AM', 'MSKU', '', '10', '0.5',
         '', '', DTR, 'D.Analysis - OSR PiE'],
    ])
    # OS log A7:T - A Date, B Bonus, H Start, I Finish, Q Record Status
    os_row = [''] * 20
    os_row[0], os_row[1], os_row[7], os_row[8], os_row[16] = \
        '21/09/2026', '1AM', '06:00', '06:15', 'OK'
    oslog = Ws('OS log', [os_row])
    # NPL Log A7:P - A Date, B Bonus, H Start, I Finish, M Check
    npl_row = [''] * 16
    npl_row[0], npl_row[1], npl_row[7], npl_row[8], npl_row[12] = \
        '21/09/2026', 'ZUW', '06:00', '06:15', 'OK'
    npllog = Ws('NPL Log', [npl_row])
    proc = Ws('Processed Data (15mins)', [['Date']])
    backend = Ws('Backend', [['Date']])
    return Sheet(name, [front, data, oslog, npllog, proc, backend])


def run_sweep(archives):
    """Execute cells 3 and 4 over the given archives, returning the namespace."""
    c = cells()
    ns = {'__name__': '__main__'}
    captured = []
    ns['print'] = lambda *a, **k: captured.append(' '.join(str(x) for x in a))

    store = {'sheets': {n: s for n, s in archives}}

    class GC(object):
        def open_by_key(self, k):
            return store['sheets'][k]

    ns['gc'] = GC()
    ns['archives'] = [(n, n, None) for n, _ in archives]

    exec(compile(c[3], 'cell3', 'exec'), ns)   # static pivot config
    exec(compile(c[4], 'cell4', 'exec'), ns)   # the per-archive loop
    ns['__out__'] = captured
    return ns


head('[1] the second archive is rebuilt as completely as the first')
try:
    archives = [('A1', make_archive('A1')), ('A2', make_archive('A2'))]
    ns = run_sweep(archives)
    out = '\n'.join(ns['__out__'])

    check('both archives were swept', ns.get('_swept') == 2,
          'swept=%s failed=%s' % (ns.get('_swept'), ns.get('_failed')))
    check('nothing was reported as failed', ns.get('_failed') == 0)
    # The bug's fingerprint, in the notebook's own words.
    check('no log was reported unreadable',
          'unreadable' not in out,
          [l for l in ns['__out__'] if 'unreadable' in l])
    check('and nothing raised "not callable"',
          'not callable' not in out,
          [l for l in ns['__out__'] if 'not callable' in l])

    # The real assertion: the rows written for archive 2 carry OS and NPL
    # status, exactly as archive 1's do. This is what went blank.
    def os_npl_of(sheet):
        proc = sheet.worksheet('Processed Data (15mins)')
        hdr, rows = proc.written[0], proc.written[1:]
        oi, ni = hdr.index('OS/ Indirect'), hdr.index('NPL Status')
        return sorted((r[2], r[oi], r[ni]) for r in rows)

    first, second = os_npl_of(archives[0][1]), os_npl_of(archives[1][1])
    check('archive 1 carries a real OS/NPL verdict, not NO',
          any(a != 'NO' for _, a, _ in first) or
          any(b != 'NO' for _, _, b in first), first)
    check('and archive 2 is IDENTICAL to archive 1', first == second,
          'A1=%s  A2=%s' % (first, second))

    # A pure-NPL bonus has no BonusHub row, so it only appears if the
    # synthesis loop - the one that held the renamed variables - ran.
    check('the synthesized pure-NPL row appears on BOTH archives',
          any(b == 'ZUW' for b, _, _ in first) and
          any(b == 'ZUW' for b, _, _ in second),
          'A1=%s  A2=%s' % ([b for b, _, _ in first], [b for b, _, _ in second]))

    check('Backend was written for both, with the same row count as Proc',
          all(len(s.worksheet('Backend').written) ==
              len(s.worksheet('Processed Data (15mins)').written)
              for _, s in archives),
          [(len(s.worksheet('Backend').written or []),
            len(s.worksheet('Processed Data (15mins)').written or []))
           for _, s in archives])
except Exception as exc:                                  # noqa: BLE001
    import traceback
    traceback.print_exc()
    check('the sweep ran at all', False, exc)


head('[2] three archives, to be sure it is not just a two-run fluke')
try:
    archives = [('B%d' % i, make_archive('B%d' % i)) for i in range(3)]
    ns = run_sweep(archives)
    check('all three swept, none failed',
          ns.get('_swept') == 3 and ns.get('_failed') == 0,
          'swept=%s failed=%s' % (ns.get('_swept'), ns.get('_failed')))
    check('no archive reported an unreadable log',
          'unreadable' not in '\n'.join(ns['__out__']))
except Exception as exc:                                  # noqa: BLE001
    check('the three-archive sweep ran', False, exc)


head('[3] no module-level def is shadowed by a loop variable')
# The general form of the bug, checked across every notebook so the next one
# is caught wherever it lands.
import re
for nb_name in ['Elmsall Live Productivity.ipynb',
                'Elmsall Live Productivity - Backfill Mode.ipynb',
                'Elmsall Live Productivity - Archive Sweep.ipynb']:
    with io.open(os.path.join(DBX, nb_name), encoding='utf-8') as fh:
        whole = '\n'.join(''.join(c.get('source', []))
                          for c in json.load(fh)['cells'])
    defined = set(re.findall(r'^\s*def\s+(\w+)\s*\(', whole, re.M))
    looped = set()
    for m in re.finditer(r'^\s*for\s+([\w,\s]+?)\s+in\s', whole, re.M):
        for nm in m.group(1).split(','):
            looped.add(nm.strip())
    clash = sorted(defined & looped)
    check('%s: no def is also a loop variable' % nb_name[:40],
          not clash, clash)


print('\n' + ('%d FAILED' % len(fails) if fails else 'all passed'))
sys.exit(1 if fails else 0)
