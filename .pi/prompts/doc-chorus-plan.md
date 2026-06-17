---
description: Plan a Chorus beat-level prose ensemble run
argument-hint: "<section file> [--beats 4] [--from-room <room-run-id>]"
---
Plan a Chorus prose ensemble run.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run compose -- <section file>` if the runtime packet is stale.
2. Run `npm run chorus -- plan $ARGUMENTS`.
3. Inspect `state/chorus/<section-id>/<run-id>/voice-pack.json` and `beat-plan.json`.
4. Do not edit `draft/` from the plan alone.
5. Next command: `npm run chorus -- run <section file> --run <run-id>`.

Use `--from-room <room-run-id>` when a room beat board already exists and the
question is how the selected beats should sound in prose.
