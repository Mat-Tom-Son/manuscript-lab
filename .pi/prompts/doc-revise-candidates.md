---
description: Generate multiple revision candidates for accepted issues
argument-hint: "<section file> --issue <issue_id> [--n 3] [--models model-a,model-b]"
---
Generate independent revision candidates for a section.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run compose -- <section file> --operation revise`.
2. Confirm `PROJECT.md`, runtime criteria, and the target section contract reflect the intended project-specific taste and tradeoff.
3. Confirm the target issue is accepted in `state/issues/issue-ledger.json`, or pass `--force` only when the human explicitly wants a non-accepted issue tested.
4. Run `npm run revise:candidates -- $ARGUMENTS`.
5. Read the generated run under `state/candidates/<section-id>/<run-id>/`.
6. Confirm `manifest.json` records `source_sha256`; the merge step uses it to refuse stale candidate runs when the draft changes before apply.
7. Do not merge anything yet. Candidate generation is an experiment setup step.
8. Next command: `npm run compare:candidates -- <section file> --run <run-id>`.

Keep model IDs in the command or panel config. Do not put model choices in `.env`.
