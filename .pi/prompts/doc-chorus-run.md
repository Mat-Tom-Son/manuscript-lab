---
description: Run the Chorus prose ensemble without applying to draft
argument-hint: "<section file> [--models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus]"
---
Run Chorus for one section.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run chorus -- run $ARGUMENTS`.
2. Read `state/chorus/<section-id>/<run-id>/CHORUS_REPORT.md`.
3. Read `assembled.md`, then inspect candidate/judgment artifacts when useful.
4. Treat Chorus output as provisional voice material. It has not modified
   `draft/`.
5. Decide whether to use it as manual drafting material, feed it into a future
   candidate arena, or park it.

Recommended model substrate:

```bash
npm run chorus -- run draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
```

Keep credentials in `.env`, never in prompts or project files.
