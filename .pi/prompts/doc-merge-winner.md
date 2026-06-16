---
description: Materialize or apply a candidate arena winner
argument-hint: "<section file> --run <candidate-run-id> [--apply] [--audit]"
---
Merge a candidate arena winner.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run merge:winner -- $ARGUMENTS` without `--apply` first when the human has not already approved applying the winner.
2. Inspect `winner.md`, `decision.json`, `taste-arbiter.json` when present, and `merge-result.json` under the candidate run.
3. Check `merge-result.json` for `source_integrity`. If it reports `missing_source_hash` or `source_mismatch`, regenerate candidates from the current draft unless the human explicitly approves `--force`.
4. If aesthetic/story tradeoffs matter and no taste gate exists yet, run `npm run taste:arbiter -- <section file> --run <candidate-run-id>`.
5. Treat an unreadable, blocking, or non-applyable `taste-arbiter.json` as a stop sign unless the human explicitly approves `--force`.
6. If applying, run `npm run merge:winner -- $ARGUMENTS --apply --audit`.
7. Read the generated diff audit under `state/revision-audits/` when `--audit` was used.
8. Run `npm run check -- <section file>` after applying.
9. If the diff audit reports voice flattening, lost high-value lines, or new regressions, stop and summarize the tradeoff instead of continuing to polish blindly.
10. Run `npm run done:no-export`, or `npm run export` followed by `npm run done` if the user requested reader files.

This command is controlled by the candidate run and issue context. Do not revise unrelated prose during merge.
