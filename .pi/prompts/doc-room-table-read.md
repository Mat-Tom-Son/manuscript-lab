---
description: Prepare a table-read packet and optional table-read review sensor
argument-hint: "<section file> [--run-id <id>]"
---
Run a writers-room table-read setup for a section.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run room -- table-read $ARGUMENTS`.
2. Read the generated checklist and reader text under `state/room/<section-id>/<run-id>/output/`.
3. If a model-backed read-aloud sensor is useful, run:
   `npm run review:run -- --passes room.table_read <section file>`
4. If scene causality is the risk, also run:
   `npm run review:run -- --passes scene.turn <section file>`
5. Treat table-read results as review sensors. Import, triage, accept, reject,
   defer, or park issues before revising.
6. Do not rewrite directly from raw table-read chatter.

For Lightning-specific routing:

```bash
npm run review:run -- --passes room.table_read --panel lightning.clean draft/<section>.md
npm run review:run -- --passes scene.turn --panel lightning.clean draft/<section>.md
```
