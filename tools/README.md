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
    python tools/test_oslog_dates.py

Or in VS Code: **Run Test Task** (the "Check: everything" task in
`Elmsall Pipeline.code-workspace`).

| file | what it guards |
|---|---|
| `audit_pipeline.js` | Cross-repo drift. Area counts agree across the notebooks, `Code.js`, JsState, the tour and the Index markup; column lists agree; per-area cells are generated rather than hand-listed; area names match between the notebook's `PROC_AREAS` and the Apps Script header map; the userscript's backfill map covers every notebook report; Data-tab positional assumptions; syntax on every file. |
| `test_sitefilter.js` | The building filter. Which areas belong to E3 vs E1/E2, that hours are recomputed per building rather than double counted, and that scaffolding columns survive filtering. |
| `test_palette.js` | Work-area colour. Every area belongs to a declared family and carries both themes, no two share a hex, the theme resolver picks the right one, and each family ramp is measurably distinguishable, runs light-to-dark in `VOLUME_TYPES` order, and stays on its family's hue. Also that the area-GROUP palette still holds eight hues of its own, since it is what `MAX_AREA_GROUPS` draws from. |
| `test_overviewvol.js` | Which series the Overall page's volume chart draws. That it is never empty, never leaves the building in view, defaults to the first two areas the viewer can see, and keeps a saved choice across a building switch. |
| `test_onboarding.js` | The first-run setup dialog. That a family answer becomes the right *area* keys, that it narrows only the building it asked about and leaves the other fully visible, that an empty answer is refused rather than committed, that Escape still leaves a usable dashboard, and that a deep link skips the dialog without marking it seen. |
| `test_sitesettings.js` | Chart settings that are lists of area keys, kept per building. That a group built in E1/E2 never appears in E3, that an unconfigured building follows the default rule (and keeps following it when an area is hidden), and that resetting one dialog leaves the others alone. |
| `test_reorder.js` | Rearranging chart panels when some are switched off. That the position badge counts the panels on screen rather than all nineteen, and that moving steps over hidden neighbours instead of swapping with one invisibly. |
| `test_oslog.js` | OS / Indirect rows — the first rows ever admitted to the payload with no standard hours behind them. Chiefly that admitting them moves no existing figure on either threshold path, and that the exclusion is explicit rather than a side effect of the threshold happening to be positive. Also that the flag survives aggregation, that contiguous windows merge into one band, that the band is gated on the bonus filter, and that an OS-only block cannot roll the time axis past the newest real data. |
| `test_oslog_dates.py` | How a logged OS spell becomes 15-minute windows — the notebook's own `_os_windows`, lifted out and run rather than re-implemented. Chiefly that the Date column is the PRODUCTION day, which starts at 06:00, so a spell logged before then belongs to the next calendar date; also midnight crossings, month/year boundaries, grid flooring, the over-long-spell cap, and that both notebooks carry the same copy. The only Python suite: the logic under test is Python. |
| `test_datepicker.js` | The header date picker. Archive-name parsing (including rejecting impossible dates), what the search matches, and that picking a day writes through the hidden `<select>` every other module reads. |

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
