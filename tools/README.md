# tools

Verification for the whole pipeline, not just this repo. These grew out of the
same bug repeating: a work area added in one place and missed in another, or a
column position assumed that had since shifted. Every one of them is a check
that a past incident would have been caught by.

Run them all before a commit, and always after adding a work area:

    node tools/audit_pipeline.js
    node tools/test_sitefilter.js
    node tools/test_palette.js
    node tools/test_datepicker.js
    node tools/test_overviewvol.js
    node tools/test_onboarding.js
    node tools/test_reorder.js
    node tools/test_sitesettings.js
    node tools/test_oslog.js
    node tools/test_bonuspanel.js
    node tools/test_puregroups.js
    node tools/test_namecorrect.js
    python tools/test_oslog_dates.py

Or in VS Code: **Run Test Task** (the "Check: everything" task in
`Elmsall Pipeline.code-workspace`).

| file | what it guards |
|---|---|
| `audit_pipeline.js` | Cross-repo drift. Area counts agree across the notebooks, `Code.js`, JsState, the tour and the Index markup; column lists agree; per-area cells are generated rather than hand-listed; area names match between the notebook's `PROC_AREAS` and the Apps Script header map; the userscript's backfill map covers every notebook report; Data-tab positional assumptions; syntax on every file. Also the control panel's layout, where the count of fields in the markup and the count of grid tracks in the CSS have to agree - a sixth picker added to the markup would land in the spacer track, silently, with the bonus filter still pinned past it. |
| `test_sitefilter.js` | The building filter. Which areas belong to E3 vs E1/E2, that hours are recomputed per building rather than double counted, and that scaffolding columns survive filtering. |
| `test_palette.js` | Work-area colour. Every area belongs to a declared family and carries both themes, no two share a hex, the theme resolver picks the right one, and each family ramp is measurably distinguishable, runs light-to-dark in `VOLUME_TYPES` order, and stays on its family's hue. Also that the area-GROUP palette still holds eight hues of its own, since it is what `MAX_AREA_GROUPS` draws from. |
| `test_overviewvol.js` | Which series the Overall page's volume chart draws. That it is never empty, never leaves the building in view, defaults to the first two areas the viewer can see, and keeps a saved choice across a building switch. |
| `test_onboarding.js` | The first-run setup dialog. That a family answer becomes the right *area* keys, that it narrows only the building it asked about and leaves the other fully visible, that an empty answer is refused rather than committed, that Escape still leaves a usable dashboard, and that a deep link skips the dialog without marking it seen. |
| `test_sitesettings.js` | Chart settings that are lists of area keys, kept per building. That a group built in E1/E2 never appears in E3, that an unconfigured building follows the default rule (and keeps following it when an area is hidden), and that resetting one dialog leaves the others alone. |
| `test_reorder.js` | Rearranging chart panels when some are switched off. That the position badge counts the panels on screen rather than all nineteen, and that moving steps over hidden neighbours instead of swapping with one invisibly. |
| `test_oslog.js` | OS / Indirect rows — the first rows ever admitted to the payload with no standard hours behind them. Chiefly that admitting them moves no existing figure on either threshold path, and that the exclusion is explicit rather than a side effect of the threshold happening to be positive. Also that the flag survives aggregation, that contiguous windows merge into one band, that the band is gated on the bonus filter, and that an OS-only block cannot roll the time axis past the newest real data. Since the column carries an approval status rather than YES/NO: that any value but NO reads as on-OS (so a status nobody enumerated is not silently dropped, which is what happened to "Rejected"), that a bucket spanning two verdicts claims neither, that a change of status cuts the band, and that the status is drawn under the word OS and tinted while the wash itself stays neutral. Also that the form's many wordings fold to three display states with Rejected as the catch-all (an undecided spell is NOT rejected), and that the status is WRAPPED onto a second line and leans into the clear chart either side of its band before it is ever abbreviated - a desktop band showed "Pnd." beside two hundred empty pixels, making the reader learn a code for no reason - stepping down to App. / Pnd. / Rej. only where the wording genuinely cannot fit, which on a phone is still the usual case. Separately, the clipped OS times: that each block carries the spell clipped to itself, that the band reports the two ends of the spell rather than of its own quarter-hour blocks, that the range shows as one line of the chart's own tooltip on all four banded families, that a bucket running into midnight is still ordered by the block's clock rather than by comparing "00:00" as a string, and that a day cut before those columns existed keeps exactly the band it had. Also that one `xOpt` spells `offset` out for both chart types: Chart.js sets it per type, so the bar chart alone had it true and put the same block half a slot along from where every line chart put it - bands and crosshairs disagreeing across charts stacked for exactly that comparison. |
| `test_bonuspanel.js` | The Bonus page's area panels. Chiefly that a person who worked two areas is charged one quarter-hour of deployment rather than one per panel - the panels show each operator's TOTAL across every area and rank who worked where, instead of recomputing a per-area figure that understated multi-area staff by however many areas they touched. Also that the area pill keeps the per-area calculation the rows gave up, and computes it over the area's PURE blocks only - a block split between two areas used to charge a full quarter-hour to both while each numerator held only its own half, so every area sharing its people read low - including that purity spans both buildings, that an area with no pure blocks shows no pill rather than a misleading one, and that the rows beneath are untouched by the rule. Also that the render path is wired to the totals (checked structurally, since the totals call legitimately appears for the lookup map too), and that the column headings say "Total". Separately, that the Productive / Unproductive tables split at one figure - 61% and above against 60% and below - so every operator lands in exactly one: the old rules tested the badge colour, which has three bands where the tables have two, so 60-79% was listed twice on one panel under opposite headings while anything under the live threshold appeared on neither. Swept across 0-120% rather than spot-checked, and on the ROUNDED figure, since a row badged 60% under "Productive" is the rule visibly not being followed. Also that productivity is measured over the blocks worked rather than the selected window, so changing the window changes nobody's figure. |
| `test_puregroups.js` | The Overall page's work-area groups. That a group counts only people whose block fell entirely inside its areas - it used to admit anyone with hours in any of them and then charge a full quarter-hour of deployment, so somebody splitting a block with another area dragged the group down with time that was never its own. "Outside" means all 24 areas, both buildings. Chiefly, though, that the rule is OFF under a bonus filter: the groups are one-per-area there, so a multi-area operator would fail the test in every group and the chart would come back blank for exactly the person being examined - which reads as "no data", not as a bug. Also the unit switch to standard hours, and the note saying who the percentage covers. |
| `test_namecorrect.js` | The 'Data' tab's column C correction. Chiefly the ORDER of the two calls that write it: `setValues` parses a string the way typing it would unless the cell is ALREADY formatted as text, so setting the format afterwards stored "1AM" as the time serial 1/24 and then froze that number as the text "0.04166666667" - every correction undone by the act of making it, hourly, across rows Databricks had written correctly. Checked against a stub that parses the way Sheets does, not just by reading the source order. Also that a healthy code is never altered, that the recovery of already-damaged cells is narrow enough not to invent an operator (10:00 and 11:00 have no code and are left alone; a three-digit number is a code, not notation), and that every step is idempotent. Chiefly among those: `"0"` is never repaired, because `"000"` and `"0AM"` are both real codes that collapse to it and nothing tells them apart - the map that used to guess `"000"` was attributing one real operator's hours to another about half the time. |
| `test_oslog_dates.py` | How a logged OS spell becomes 15-minute windows — the notebook's own `_os_windows`, lifted out and run rather than re-implemented. Chiefly that the Date column is the PRODUCTION day, which starts at 06:00, so a spell logged before then belongs to the next calendar date; also midnight crossings, month/year boundaries, grid flooring, the over-long-spell cap, and that both notebooks carry the same copy. Plus the Record Status vocabulary (`OK` -> Approved, `authorise or reject` -> Awaiting Approval, anything else through as typed) and the column indices it is read from — those shifted when the OS log went from 25 columns to 20, and a wrong index reads a populated cell, so the failure is every row quietly rejected as unparseable rather than an error anyone sees. Also the per-window clipping the two new columns carry: a 07:26-08:06 spell reads 07:26-07:30 in the 07:15 block and 08:00-08:06 in the last, so the four clips total the forty minutes worked rather than the hour they touch, and a block ending at midnight says 00:00 - the one value the union has to special-case, since it sorts lowest as a string when it is in fact the highest. The only Python suite: the logic under test is Python. |
| `test_datepicker.js` | The header date picker. Archive-name parsing (including rejecting impossible dates), what the search matches, and that picking a day writes through the hidden `<select>` every other module reads. Also that today is a day the calendar offers and that picking it means Live — it used to be greyed out for having no archive entry, which left the "today" ring on a dead cell and nothing highlighted at all while the dashboard was live — and that the one footer action returns to Live even from today's own month, where the old Today button only moved the view and so did nothing visible. "Today" is pinned to a fixed date, or the expectations would move at midnight. |

## Notes

Paths are resolved from `__dirname`, so these run from any clone. The Databricks
and Tampermonkey repos are expected as **siblings** of this one.

`test_palette.js` measures colour separation using the data-viz skill's
validator, which lives in a temporary directory. When it is absent that section
prints a notice and the structural checks still run - point `DATAVIZ_VALIDATOR`
at the script to re-enable it.

## Previewing the dashboard

    node tools/preview.js                       # writes tools/preview.html
    node tools/preview.js --page=volume --site=e3
    node tools/preview.js --tour=1

Assembles the real markup, styles and client code into one standalone page,
resolving the HtmlService includes and standing in for google.script.run with
the tour's demo payload. Layout, theming, charts, the building filter and the
date picker all behave as deployed; the numbers are fake and nothing in
Code.js runs, so this cannot catch a server-side bug.

Open it with VS Code's **Live Preview**, not by double-clicking - the page
uses localStorage, which browsers restrict on file:// URLs. The output is
gitignored, and .claspignore keeps all of tools/ out of the Apps Script push.
