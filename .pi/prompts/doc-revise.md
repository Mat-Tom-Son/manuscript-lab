---
description: Revise one section from review findings
argument-hint: "<section file>"
---
Revise this section:

$ARGUMENTS

Steps:

1. Read the latest revision plan under `state/revision-plans/` when one exists; otherwise read the latest review notes in the conversation.
2. Run `npm run compose -- $ARGUMENTS --operation revise` and inspect the runtime packet.
3. Read `PROJECT.md`, the target section, and relevant state files.
4. Apply only necessary edits.
5. Preserve good existing prose.
6. Update `state/status.md`, `state/continuity.md`, `state/claims.md`, and `state/open-questions.md`.
7. Run `node scripts/doccheck.mjs` on the target section.
8. If the section contract has `checks:` and a configured provider key or cached results are available, run `node scripts/doccheck.mjs --model-checks` on the target section.
9. Fix mechanical and blocking semantic failures.
10. Run `npm run done:no-export`, or `npm run export` followed by `npm run done` if the user requested reader files.

If no review notes or revision plan are available, perform a brief local review first and then revise.
