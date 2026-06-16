---
description: Gate a candidate arena winner against project narrative taste
argument-hint: "<section file> --run <candidate-run-id> [--models openrouter:z-ai/glm-5.1]"
---
Run the narrative taste arbiter.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run taste:arbiter -- $ARGUMENTS`.
2. Inspect `state/candidates/<section-id>/<run-id>/taste-arbiter.json`.
3. Inspect `state/candidates/<section-id>/<run-id>/TASTE_ARBITER.md`.
4. If the disposition is `pass` or `pass_with_debt`, summarize the debt and proceed to `npm run merge:winner -- <section file> --run <run-id>`.
5. If the disposition is `patch_required`, `block`, or `unstable_judgment`, stop and report the blocking reasons or required patch. Do not apply the winner unless the human explicitly overrides the gate.

The arbiter is a taste gate, not a score. It decides whether a candidate belongs in this project.
