---
description: Record a showrunner decision for writers-room idea cards
argument-hint: "<section file> --run <run-id> --select idea-001 [--reject idea-002] [--park idea-003] --reason \"...\""
---
Record the human/showrunner decision for a room run.

Arguments:

$ARGUMENTS

Steps:

1. Read `state/room/<section-id>/<run-id>/ROOM_REPORT.md` and `idea-cards.jsonl`.
2. Run `npm run room -- decide $ARGUMENTS`.
3. Inspect the updated `decision.json`, `decision-log.md`, and card statuses in `idea-cards.jsonl`.
4. Do not edit draft prose from undecided cards.
5. Next command: `npm run room -- break <section file> --run <run-id>`.

Select only cards the project is willing to pay for in outline, continuity,
claims, or revision work. Park interesting material that should not drive the
current section.
