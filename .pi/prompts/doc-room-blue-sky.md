---
description: Generate independent writers-room idea cards for one section
argument-hint: "<section file> [--models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus]"
---
Run a writers-room blue-sky pass.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run compose -- <section file>` if the section packet is stale or the direction is unclear.
2. Run `npm run room -- diagnose <section file>` first when no fresh diagnosis exists.
3. Run `npm run room -- blue-sky $ARGUMENTS`.
4. Read the generated run under `state/room/<section-id>/<run-id>/`.
5. Inspect `role-casts.json`, `visible-files.json`, `idea-cards.jsonl`, `clusters.json`, `stress-tests.json`, and `ROOM_REPORT.md`.
6. Do not draft prose yet. The next step is a showrunner decision:
   `npm run room -- decide <section file> --run <run-id> --select <idea-id> --reason "..."`

Recommended model substrate when a model-backed run is desired:

```bash
npm run room -- blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
```

Keep model IDs in flags or panels. Keep credentials in `.env`.
