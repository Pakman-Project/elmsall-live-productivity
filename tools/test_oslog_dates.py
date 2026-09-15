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
exec(os_src[:os_src.index("OS_STATUS = {}")], ns)
win = ns["_os_windows"]
status_of = ns["_os_status"]


def span(day, a, b):
    """First and last window of a spell, as (start, end) strings, or the reason.

    _os_windows yields (window, from, to) triples; this reads the window, which
    is the join key. The two clipped times are section [4b].
    """
    out, why = win(day, a, b)
    if why:
        return why
    if not out:
        return "empty"
    return out[0][0].split(" - ")[0], out[-1][0].split(" - ")[1]


def clips(day, a, b):
    """Just the clipped (from, to) pairs, in window order."""
    return [(x[1], x[2]) for x in win(day, a, b)[0]]


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
      win("09/09/2026", "22:00", "02:00")[0][0][0].startswith("09/09/2026 22:00"),
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
check("a ragged start floors onto the grid", w[0][0] == "09/09/2026 06:00 - 09/09/2026 06:15", str(w))
check("and a ragged finish covers its own block", w[-1][0] == "09/09/2026 06:15 - 09/09/2026 06:30", str(w))
check("06:00-07:00 is exactly four blocks", len(win("09/09/2026", "06:00", "07:00")[0]) == 4)
check("a 12-hour shift is 48", len(win("09/09/2026", "06:00", "18:00")[0]) == 48)
check("no window is repeated", len(set(win("09/09/2026", "06:00", "18:00")[0])) == 48)
check("they are contiguous",
      all(a[0].split(" - ")[1] == b[0].split(" - ")[0]
          for a, b in zip(w, w[1:])), str(w))

head("[4b] each window carries the spell clipped to ITSELF")
# What the two new columns are for. A spell is not a whole block at either end
# of itself: 07:26-08:06 is forty minutes, and four blocks each claiming their
# whole fifteen would report it as an hour. The example is the brief's own.
k = win("09/09/2026", "07:26", "08:06")[0]
check("07:26-08:06 touches four blocks", len(k) == 4, str(len(k)))
check("the first starts at the real start, and ends with its block",
      (k[0][1], k[0][2]) == ("07:26", "07:30"), str((k[0][1], k[0][2])))
check("the two in the middle are whole",
      [(x[1], x[2]) for x in k[1:3]] == [("07:30", "07:45"), ("07:45", "08:00")],
      str([(x[1], x[2]) for x in k[1:3]]))
check("and the last ends at the real finish",
      (k[3][1], k[3][2]) == ("08:00", "08:06"), str((k[3][1], k[3][2])))
# The first start and the last end are the spell itself - which is what the
# chart's band tooltip reports for the whole merged band.
check("so the spell still reads 07:26 - 08:06",
      (k[0][1], k[-1][2]) == ("07:26", "08:06"))
_mins = sum((datetime.strptime(x[2], "%H:%M") - datetime.strptime(x[1], "%H:%M")).seconds // 60
            for x in k)
check("and the clips total the 40 minutes worked, not 60", _mins == 40, str(_mins) + " min")

check("a spell inside one block does not grow to fill it",
      clips("09/09/2026", "09:03", "09:08") == [("09:03", "09:08")],
      str(clips("09/09/2026", "09:03", "09:08")))
check("a block-aligned spell is not clipped at all",
      clips("09/09/2026", "10:00", "10:30") == [("10:00", "10:15"), ("10:15", "10:30")],
      str(clips("09/09/2026", "10:00", "10:30")))
# The 23:45 block ends at 00:00, and that is the END of that block rather than
# the start of a day. The union in OS_SPAN compares these as strings and has a
# special case for exactly this value; without it the block would report a
# finish earlier than its own start.
check("the block ending at midnight says 00:00",
      clips("09/09/2026", "23:50", "00:10") == [("23:50", "00:00"), ("00:00", "00:10")],
      str(clips("09/09/2026", "23:50", "00:10")))
check("every clip sits inside its own window",
      all(x[1] >= x[0][11:16] and (x[2] == "00:00" or x[2] <= x[0][-5:])
          for x in win("09/09/2026", "06:07", "18:53")[0]),
      "a clip outside its block would carve time out of the wrong quarter-hour")

head("[5] the string is the join key, so it must match the pivot exactly")
# Anything else silently matches no row rather than failing.
check("dd/mm/yyyy HH:MM - dd/mm/yyyy HH:MM",
      re.fullmatch(r"\d{2}/\d{2}/\d{4} \d{2}:\d{2} - \d{2}/\d{2}/\d{4} \d{2}:\d{2}",
                   win("09/09/2026", "06:00", "06:15")[0][0][0]) is not None,
      win("09/09/2026", "06:00", "06:15")[0][0][0])
check("and the clipped times are plain HH:MM",
      all(re.fullmatch(r"\d{2}:\d{2}", t) for t in clips("09/09/2026", "06:07", "07:03")[0]),
      str(clips("09/09/2026", "06:07", "07:03")[0]))

head("[6] bad input is rejected, not guessed at")
check("an unparseable date", win("not a date", "06:00", "07:00")[1] == "unparsed")
check("an unparseable time", win("09/09/2026", "", "07:00")[1] == "unparsed")
check("seconds are tolerated", win("09/09/2026", "06:00:00", "07:00:00")[1] is None)
# A finish typed 06:00 instead of 18:00 reads as a real overnight spell and
# would otherwise expand to a full day of windows.
check("an over-long spell is capped", win("09/09/2026", "06:00", "05:59")[1] == "too_long")
check("16 hours exactly is still allowed", win("09/09/2026", "06:00", "22:00")[1] is None)
check("17 hours is not", win("09/09/2026", "06:00", "23:00")[1] == "too_long")

head("[7] the Record Status becomes something a reader recognises")
# Column Q is the approval form's own wording. Two values are re-spelled on the
# way past - nobody outside that process reads "OK" as "this was approved", and
# "authorise or reject" is an instruction to an approver rather than a state.
check('"OK" -> Approved', status_of("OK") == "Approved", status_of("OK"))
check("whatever case it arrives in",
      status_of("ok") == "Approved" and status_of("Ok") == "Approved",
      status_of("ok") + " / " + status_of("Ok"))
check('"authorise or reject" -> Awaiting Approval',
      status_of("authorise or reject") == "Awaiting Approval",
      status_of("authorise or reject"))
check("and that one too", status_of("Authorise or Reject") == "Awaiting Approval",
      status_of("Authorise or Reject"))
check("Rejected passes straight through", status_of("Rejected") == "Rejected",
      status_of("Rejected"))
# The old code dropped every row that was not OK, so these vanished entirely -
# leaving a zero on the dashboard with nothing to explain it.
check("a status nobody thought of survives",
      status_of("Escalated to Ops") == "Escalated to Ops",
      "a fallback here would hide the next status the form grows")
check("surrounding space is trimmed", status_of("  Rejected ") == "Rejected",
      status_of("  Rejected "))
check("an empty cell reads as it always did",
      status_of("") == "YES" and status_of(None) == "YES",
      "the spell happened; nothing has been decided about it yet")

head("[8] the strongest verdict wins a block claimed twice")
# Two logged spells can cover the same block, most often a record re-submitted
# rather than edited, and the output column has room for one answer. Without an
# order the winner is whichever row the sheet happened to list last.
rank = ns["OS_STATUS_RANK"]
check("approved beats awaiting", rank["Approved"] > rank["Awaiting Approval"])
check("awaiting beats undecided", rank["Awaiting Approval"] > rank["YES"])
check("and anything known beats a status with no rank",
      rank.get("Rejected", 0) < rank["YES"],
      "rejected does not out-rank a spell that is still being decided")

# The times do NOT rank, they union: a block claimed by two records was spent
# indirect for every minute either of them claims, and unlike the status there
# is no single-answer problem forcing a choice.
check("the span unions rather than ranking",
      "OS_SPAN = {}" in os_src and "if _w_from < _span[0]:" in os_src,
      "ranking the times would throw away half of a re-submitted spell")
check("and it knows 00:00 is the latest finish, not the earliest",
      'if _w_to == "00:00" or _span[1] == "00:00":' in os_src,
      "strings compare fine inside one block except for this one value")

head("[9] the columns it reads, which are the fragile part")
# The Apps Script picks source columns by index into a list, so dropping one
# shifts every output column after it - which is exactly what happened when the
# log went from 25 columns to 20. A wrong index here reads a POPULATED cell, so
# the failure is every row quietly rejected as unparseable rather than an error
# anybody sees. Pinned to the layout the script actually writes.
check("the range covers the 20-column layout", 'OS_RANGE = "A7:T"' in os_src,
      "A7:Y was the old width")
check("date is column A", "_os_cell(_r, 0)" in os_src)
check("bonus is column B, not D",
      "_os_cell(_r, 1).upper()" in os_src and "_os_cell(_r, 3).upper()" not in os_src,
      "D held the bonus under the 25-column layout")
check("start and finish are H and I, not J and K",
      "_os_cell(_r, 7), _os_cell(_r, 8)" in os_src,
      "J and K were the old positions")
check("status is column Q, not V",
      "_os_status(_os_cell(_r, 16))" in os_src and "_os_cell(_r, 21)" not in os_src,
      "V held it under the 25-column layout")
check("and it is no longer a gate",
      'if _os_cell(_r, 16).upper() != "OK"' not in os_src,
      "dropping non-OK rows is what hid rejected spells")

# The Apps Script is the other half of this contract: these indices are only
# right for as long as it writes that layout.
script = open(os.path.join(HERE, "..", "Spreadsheet - OS Log.js"), encoding="utf-8").read()
check("the pivot writes both clipped times",
      "_span[0], _span[1]" in "".join(cells) and
      '"OS/ Indirect", "OS Start Time", "OS End Time"' in "".join(cells),
      "BB and BC on Processed Data (15mins)")
check("and blanks them on a row that was never on OS",
      'OS_SPAN.get((dtr, bonus)) or ["", ""]' in "".join(cells),
      "a short row would leave the previous run's cells under the new figures")

check("the script still writes 20 columns",
      "combinedResults.length, 20)" in script,
      "if this widens again, every index above moves")

head("[10] the two notebooks agree")
back = os.path.join(DBX, "Elmsall Live Productivity - Backfill Mode.ipynb")
bcells = ["".join(c["source"]) for c in json.load(open(back, encoding="utf-8"))["cells"]]
bsrc = next((c for c in bcells if "def _os_windows(" in c), None)
check("backfill carries the same _os_windows", bsrc is not None and bsrc == os_src,
      "a fix applied to one and not the other rewrites history wrong")

print("\n" + (str(fail) + " FAILED" if fail else "all passed"))
sys.exit(1 if fail else 0)
