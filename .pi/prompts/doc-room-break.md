---
description: Materialize selected room cards into a beat board
argument-hint: "<section file> --run <run-id>"
---
Break selected room cards into a beat board.

Arguments:

$ARGUMENTS

Steps:

1. Confirm the room run has a `decision.json` with at least one selected card.
2. Run `npm run room -- break $ARGUMENTS`.
3. Read `state/room/<section-id>/<run-id>/output/beat-board.md` and `beat-board.json`.
4. Check each beat for causal link, choice, consequence, and turn. Weak fields
   mean the room produced inventory rather than dramatic movement.
5. Use the beat board to update `outline.md`, the section contract, continuity,
   claims, or open questions only when the human accepts that direction.
6. Do not draft manuscript prose unless the user also asked for drafting or revision.

The `break` command refuses undecided room runs by default. Use `--force` only
when the human explicitly wants to materialize proposed cards without a recorded
decision.
