---
description: Run typed review passes and import issues into the ledger
argument-hint: "<section file>"
---
Run the issue-driven review pipeline for:

$ARGUMENTS

Steps:

1. Read `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, `state/continuity.md`, and the target section contract.
2. Run `npm run compose -- $ARGUMENTS` and inspect `state/runtime/<section-id>/criteria.json`.
3. Run `node scripts/review-runner.mjs --dry-run --panel prose.clean` on the target section to inspect the queue and context manifests.
4. If a configured provider key is available, run `node scripts/review-runner.mjs --panel prose.clean` or `node scripts/review-runner.mjs --panel lightning.clean` on the target section.
5. Confirm new review runs were saved under `state/reviews/<section-id>/runs/`.
6. Run `node scripts/review-report.mjs` on the target section and summarize model health.
7. Confirm concrete findings were imported into `state/issues/issue-ledger.json`.
8. Do not revise the manuscript in this prompt.

Reviews are sensors. They produce issues, not decisions.
Use `--panel prose.board` when the user asks for a broader taste/opinion panel. Use `--passes narrative.taste --models openrouter:z-ai/glm-5.1` when the user asks whether prose belongs to this project. Use `--passes style.pattern_saturation --panel style.calibration` when the user asks for voice overfit, quip density, or pattern-saturation feedback.
