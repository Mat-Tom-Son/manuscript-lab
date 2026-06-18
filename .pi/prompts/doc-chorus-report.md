---
description: Summarize saved Chorus line-lab runs
argument-hint: "[section file]"
---
Report Chorus runs.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run chorus -- report $ARGUMENTS`.
2. For the relevant run, read `CHORUS_REPORT.md`, `CONTACT_SHEET.md`,
   `plan-quality.json`, and `metrics.json`.
3. Report whether the run is useful, parked, needs tighter beat planning, or
   needs another sampling pass.
4. Do not claim Chorus output has changed the manuscript unless a future apply
   command or manual draft edit actually changed `draft/`.
