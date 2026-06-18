---
description: Run the Chorus line lab without applying to draft
argument-hint: "<section file> [--models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus] [--assemble]"
---
Run Chorus for one section.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run chorus -- run $ARGUMENTS`.
2. Read `state/chorus/<section-id>/<run-id>/CHORUS_REPORT.md`.
3. Read `CONTACT_SHEET.md`, then inspect per-beat candidate files when useful.
4. Treat Chorus output as provisional line-lab material. It has not modified
   `draft/`.
5. Mine phrases, sentence movement, and risks manually; do not merge whole
   candidates or `assembled.md` wholesale.

Recommended model substrate:

```bash
npm run chorus -- run draft/<section>.md --models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus
```

Keep credentials in `.env`, never in prompts or project files.
