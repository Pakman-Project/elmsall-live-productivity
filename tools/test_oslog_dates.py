# The OS log records a spell as one Date and two clock times, and production
# counts a day from 06:00 to 06:00. So the Date column is NOT the calendar date
# the work happened on: a row reading 08/09 00:00-04:00 happened on the 09th.
#
# Get that wrong and a whole night shift is written against windows that do not
# exist in the pivot, where it matches nothing and disappears - no error, no
# warning, just a bonus whose zeros stay unexplained. That is the case this
# file exists for; everything else here is the boundary either side of it.
#
# The functions are pulled out of the notebook and run, not re-implemented, so
# this cannot pass against a copy that has drifted from the real thing.
import json
import os
import re
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DBX = os.path.join(HERE, "..", "..", "Databricks-Live-Productivity-Output")
NB = os.path.join(DBX, "Elmsall Live Productivity.ipynb")

fail = 0


def head(t):
    print("\n" + t)


def check(label, ok, detail=""):
    global fail
    if not ok:
        fail += 1
    print("  " + ("ok  " if ok else "FAIL") + "  " + label + ("   " + detail if detail else ""))


# ── lift the real code out of the notebook ──────────────────────────────────
cells = ["".join(c["source"]) for c in json.load(open(NB, encoding="utf-8"))["cells"]]

dtr_src = next((c for c in cells if "def _dtr(" in c), None)
os_src = next((c for c in cells if "def _os_windows(" in c), None)
if dtr_src is None or os_src is None:
    print("FAIL  could not find _dtr / _os_windows in the notebook")
    sys.exit(1)

ns = {}
exec(re.search(r"def _dtr\(.*?\n\n", dtr_src, re.S).group(0), ns)
# Everything above the first bare statement: the constants and the two helpers,
# without the gspread call that follows them.
exec(os_src[:os_src.index("OS_KEYS = set()")].replace("from datetime import", "from datetime import"), ns)
win = ns["_os_windows"]


def span(day, a, b):
    """First and last window of a spell, as (start, end) strings, or the reason."""
    out, why = win(day, a, b)
    if why:
        return why
    if not out:
        return "empty"
    return out[0].split(" - ")[0], out[-1].split(" - ")[1]


head("[1] the production day starts at 06:00, so an early spell is the NEXT date")
# The case from the brief, verbatim.
check("08/09 00:00-04:00 happened on the 09th",
      span("08/09/2026", "00:00", "04:00") == ("09/09/2026 00:00", "09/09/2026 04:00"),
      str(span("08/09/2026", "00:00", "04:00")))
check("05:45 is still the previous production day",
      span("09/09/2026", "05:45", "07:00") == ("10/09/2026 05:45", "10/09/2026 07:00"),
      str(span("09/09/2026", "05:45", "07:00")))
check("06:00 exactly does NOT shift",
      span("09/09/2026", "06:00", "18:00") == ("09/09/2026 06:00", "09/09/2026 18:00"),
      str(span("09/09/2026", "06:00", "18:00")))
check("nor does anything after it",
      span("09/09/2026", "14:00", "16:00") == ("09/09/2026 14:00", "09/09/2026 16:00"),
      str(span("09/09/2026", "14:00", "16:00")))

head("[2] a spell that runs past midnight finishes on the next date")
# The log has one Date column and nowhere to say the shift ended tomorrow.
check("22:00-02:00 crosses midnight",
      span("09/09/2026", "22:00", "02:00") == ("09/09/2026 22:00", "10/09/2026 02:00"),
      str(span("09/09/2026", "22:00", "02:00")))
check("and it is not also shifted forward",
      win("09/09/2026", "22:00", "02:00")[0][0].startswith("09/09/2026 22:00"),
      "the 06:00 rule reads the START, not the finish")

head("[3] month and year boundaries")
check("31/12 -> 01/01",
      span("31/12/2026", "00:00", "04:00") == ("01/01/2027 00:00", "01/01/2027 04:00"),
      str(span("31/12/2026", "00:00", "04:00")))
check("end of February",
      span("28/02/2026", "23:00", "01:00") == ("28/02/2026 23:00", "01/03/2026 01:00"),
      str(span("28/02/2026", "23:00", "01:00")))
check("a leap day is a real date",
      span("29/02/2028", "06:00", "07:00") == ("29/02/2028 06:00", "29/02/2028 07:00"),
      str(span("29/02/2028", "06:00", "07:00")))

head("[4] windows land on the 15-minute grid, and cover the whole spell")
w, _ = win("09/09/2026", "06:07", "06:20")
# 06:07 belongs to the 06:00 block: that is the one that would otherwise show
# an unexplained zero.
check("a ragged start floors onto the grid", w[0] == "09/09/2026 06:00 - 09/09/2026 06:15", str(w))
check("and a ragged finish covers its own block", w[-1] == "09/09/2026 06:15 - 09/09/2026 06:30", str(w))
check("06:00-07:00 is exactly four blocks", len(win("09/09/2026", "06:00", "07:00")[0]) == 4)
check("a 12-hour shift is 48", len(win("09/09/2026", "06:00", "18:00")[0]) == 48)
check("no window is repeated", len(set(win("09/09/2026", "06:00", "18:00")[0])) == 48)
check("they are contiguous",
      all(a.split(" - ")[1] == b.split(" - ")[0]
          for a, b in zip(w, w[1:])), str(w))

head("[5] the string is the join key, so it must match the pivot exactly")
# Anything else silently matches no row rather than failing.
check("dd/mm/yyyy HH:MM - dd/mm/yyyy HH:MM",
      re.fullmatch(r"\d{2}/\d{2}/\d{4} \d{2}:\d{2} - \d{2}/\d{2}/\d{4} \d{2}:\d{2}",
                   win("09/09/2026", "06:00", "06:15")[0][0]) is not None,
      win("09/09/2026", "06:00", "06:15")[0][0])

head("[6] bad input is rejected, not guessed at")
check("an unparseable date", win("not a date", "06:00", "07:00")[1] == "unparsed")
check("an unparseable time", win("09/09/2026", "", "07:00")[1] == "unparsed")
check("seconds are tolerated", win("09/09/2026", "06:00:00", "07:00:00")[1] is None)
# A finish typed 06:00 instead of 18:00 reads as a real overnight spell and
# would otherwise expand to a full day of windows.
check("an over-long spell is capped", win("09/09/2026", "06:00", "05:59")[1] == "too_long")
check("16 hours exactly is still allowed", win("09/09/2026", "06:00", "22:00")[1] is None)
check("17 hours is not", win("09/09/2026", "06:00", "23:00")[1] == "too_long")

head("[7] the two notebooks agree")
back = os.path.join(DBX, "Elmsall Live Productivity - Backfill Mode.ipynb")
bcells = ["".join(c["source"]) for c in json.load(open(back, encoding="utf-8"))["cells"]]
bsrc = next((c for c in bcells if "def _os_windows(" in c), None)
check("backfill carries the same _os_windows", bsrc is not None and bsrc == os_src,
      "a fix applied to one and not the other rewrites history wrong")

print("\n" + (str(fail) + " FAILED" if fail else "all passed"))
sys.exit(1 if fail else 0)
