---
description: Run the final readiness gate before handing work back
argument-hint: "[--no-export] [additional done-gate flags]"
---
Verify that the current work is ready to hand back.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run done -- $ARGUMENTS`.
2. Use `--no-export` when readable exports are not part of the task.
3. Remember that review-run errors fail the gate only when the latest run for a section/pass/model still contains an error; rerun the affected review to supersede a transient provider failure.
4. If the gate fails on a workspace transition marker, inspect it with `npm run story -- transition-status --json`, verify the project filesystem, and clear it with `npm run story -- transition-clear --force` only after the state is understood.
5. If the gate fails, report the blocker and the exact command needed to inspect or fix it.
6. Do not declare the task complete until the gate passes or the blocker is explicitly reported.
7. Do not edit manuscript prose in this prompt.
