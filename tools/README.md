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

Or in VS Code: **Run Test Task** (the "Check: everything" task in
`Elmsall Pipeline.code-workspace`).

| file | what it guards |
|---|---|
| `audit_pipeline.js` | Cross-repo drift. Area counts agree across the notebooks, `Code.js`, JsState, the tour and the Index markup; column lists agree; per-area cells are generated rather than hand-listed; area names match between the notebook's `PROC_AREAS` and the Apps Script header map; the userscript's backfill map covers every notebook report; Data-tab positional assumptions; syntax on every file. |
| `test_sitefilter.js` | The building filter. Which areas belong to E3 vs E1/E2, that hours are recomputed per building rather than double counted, and that scaffolding columns survive filtering. |
| `test_palette.js` | Work-area colour. Every area belongs to a declared family and carries both themes, no two share a hex, the theme resolver picks the right one, and each family ramp is measurably distinguishable. |
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
