# The zero-hours row the pivot rebuild gives someone flagged OS or NPL in a
# window they produced nothing in - see the "Processed Data (15mins)" rebuild
# cell in the notebook. Without it, "no row" renders as plain absence rather
# than as explained absence, and the dashboard's OS/NPL band (which is drawn
# from that flag alone, not from std hours - see mergeBandsPak_ in
# Web - JsCharts.html) cuts in two at every quiet block.
#
# The clamp guarding this used to require the EXACT window to already be a key
# in `groups` - i.e. that SOME bonus, anywhere on site, produced something in
# it. A window nobody at all produced in that quarter hour - a lull, a shift
# changeover - failed that test exactly like a window in the future did, and a
# continuous NPL claim spanning one lost its band for the blocks either side
# of the gap: reported as four separate "NPL / OK" bands under one claim
# running 13:00-15:30 with real production only in two of its blocks.
#
# The fix clamps on the CLOCK instead - at or before the LATEST window the
# pivot has reached - which still refuses to synthesize into the future (an
# OS/NPL spell is logged against its finish time the moment it starts, so the
# log can already reach hours past the newest real data) without confusing a
# quiet window for one that has not happened yet.
#
# The cell is pulled out of the notebook and run, not re-implemented, so this
# cannot pass against a copy that has drifted from the real thing.
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DBX = os.path.join(HERE, "..", "..", "Databricks-Live-Productivity-Output")

fail = 0


def head(t):
    print("\n" + t)


def check(label, ok, detail=""):
    global fail
    if not ok:
        fail += 1
    print("  " + ("ok  " if ok else "FAIL") + "  " + label + ("   " + detail if detail else ""))


# ── the fixture: five consecutive quarter hours, one site-wide silent ───────
PROC_AREAS = [
    {"report": "AreaA", "vol_events": ["PickA"]},
    {"report": "AreaB", "vol_events": ["PickB"]},
]


def dtr(h, m):
    start = "15/09/2026 %02d:%02d" % (h, m)
    e_m = m + 15
    eh, em = (h + 1, 0) if e_m == 60 else (h, e_m)
    end = "15/09/2026 %02d:%02d" % (eh, em)
    return start + " - " + end


W = [dtr(13, 0), dtr(13, 15), dtr(13, 30), dtr(13, 45), dtr(14, 0)]
W6 = dtr(14, 15)          # one window past the last real production anywhere


def data_row(w, bonus, area="AreaA"):
    # A=Date B=Hour C=Bonus D=EventType E=Attribute F=Qty G=StdHours H=SMV
    # I=Week J=DateTimeRange K=ReportName
    return ["15/09/2026", w.split(" ")[1][:2], bonus, "PickA", "x", "1", "0.1", "1", "37", w, area]


def build_groups(npl_windows):
    """Runs the real rebuild cell up to `groups`, for one claim spanning
    `npl_windows` for bonus XXX, against Data rows where XXX only produced in
    the first and last of the five known windows - everything in between is
    someone else's activity, except W[2] (the middle one) which is nobody's."""
    data_rows = (
        [data_row(W[0], "XXX")]
        + [data_row(W[1], "YYY")]
        # W[2]: deliberately nothing from anyone - the site-wide-silent window.
        + [data_row(W[3], "YYY")]
        + [data_row(W[4], "XXX")]
    )

    class FakeWs:
        def get_all_values(self):
            header = ["Date", "Hour", "Bonus", "EventType", "Attribute", "Qty",
                      "StdHours", "SMV", "Week", "DateTimeRange", "ReportName"]
            return [header] + data_rows

    ns = {
        "PROC_AREAS": PROC_AREAS,
        "ws": FakeWs(),
        "OS_STATUS": {}, "OS_SPAN": {},
        "NPL_STATUS": {(w, "XXX"): "OK" for w in npl_windows},
        "NPL_SPAN": {},
    }
    exec(rebuild_src, ns)
    return ns["groups"]


cells = ["".join(c["source"]) for c in json.load(
    open(os.path.join(DBX, "Elmsall Live Productivity.ipynb"), encoding="utf-8"))["cells"]]
rebuild_cell = next((c for c in cells if "_have.add((_syn_dtr, _syn_bonus))" in c), None)
if rebuild_cell is None:
    print("FAIL  could not find the pivot rebuild cell in the notebook")
    sys.exit(1)
# Up to (not including) `out = []`: everything needed to inspect `groups`,
# without PROC_DIVISORS or the gspread writes that follow.
rebuild_src = rebuild_cell[:rebuild_cell.index("out = []")]

head("[1] a window nobody anywhere produced in still gets the flag")
groups = build_groups([w for w in W])
check("XXX's real production windows are there, as they always were",
      (W[0], "13", "XXX") in groups and (W[4], "14", "XXX") in groups)
check("so are the windows only SOMEONE ELSE worked - that already worked before this fix",
      (W[1], "13", "XXX") in groups and (W[3], "13", "XXX") in groups)
check("and now so is the one NOBODY worked - the site-wide-quiet window",
      (W[2], "13", "XXX") in groups,
      "this is the fix: it used to require an exact match in `groups`, and a quiet "
      "window is not a key in it either")
check("carrying zero in every area, not a guess at what happened",
      groups.get((W[2], "13", "XXX"), {}).get("std") == [0.0, 0.0])

head("[2] the future guard still holds")
groups2 = build_groups(W + [W6])
check("a window past the last real production anywhere is still withheld",
      (W6, "14", "XXX") not in groups2,
      "an OS/NPL spell is logged against its finish time the moment it starts, so the "
      "log can already reach hours past the newest real data - synthesizing there "
      "would push the time axis into blocks nothing has published yet")

head("[3] no claim at all synthesizes nothing")
groups3 = build_groups([])
check("only the real production rows are there",
      set(k for k in groups3 if k[2] == "XXX") == {(W[0], "13", "XXX"), (W[4], "14", "XXX")})

print("\n" + (str(fail) + " FAILED" if fail else "all passed"))
sys.exit(1 if fail else 0)
