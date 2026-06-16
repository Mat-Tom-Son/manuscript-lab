---
description: Blindly compare revision candidates with order-swapped pairwise judging
argument-hint: "<section file> --run <candidate-run-id> [--models judge-a,judge-b]"
---
Compare candidate revisions.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run compare:candidates -- $ARGUMENTS`.
2. Inspect `state/candidates/<section-id>/<run-id>/comparisons/comparisons.json`.
3. Inspect `state/candidates/<section-id>/<run-id>/decision.json`.
4. If the decision is `winner_selected`, summarize the winner, confidence, unstable pairs, and regression risks.
5. If the decision is `no_clear_winner`, recommend manual review or a human-guided merge. Do not force a winner.
6. Next command for a stable winner with aesthetic/story stakes: `npm run taste:arbiter -- <section file> --run <run-id>`.
7. Next command after a passing taste gate: `npm run merge:winner -- <section file> --run <run-id>`.

Treat comparison output as preference evidence, not objective truth.
