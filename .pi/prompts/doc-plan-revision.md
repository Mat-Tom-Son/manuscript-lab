---
description: Create a revision plan from accepted issue-ledger entries
argument-hint: "<section file>"
---
Create a revision plan for:

$ARGUMENTS

Steps:

1. Read `PROJECT.md`, `state/issues/issue-ledger.json`, `state/issues/decisions.json`, and the target section.
2. Run `npm run compose -- $ARGUMENTS --operation revise` and inspect the generated criteria.
3. Ensure relevant issues have been triaged before planning.
4. Run `node scripts/revision-plan.mjs` on the target section.
5. Read the generated plan under `state/revision-plans/`.
6. Do not edit the manuscript in this prompt.

The plan should reflect accepted decisions, not raw review notes.
If the planner reports no accepted issues, stop there unless an explicit empty plan was requested.
