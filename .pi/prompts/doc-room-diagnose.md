---
description: Diagnose story foundation before room or prose work
argument-hint: "<section file> [--run-id <id>]"
---
Diagnose whether a section is ready for room cards, beat breaking, scene work,
or revision.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run compose -- <section file>` if the runtime packet is stale.
2. Run `npm run room -- diagnose $ARGUMENTS`.
3. Read `state/room/<section-id>/<run-id>/output/STORY_DIAGNOSIS.md`.
4. If the diagnosis says foundation is not ready, update durable project state
   such as `PROJECT.md`, `brief.md`, `outline.md`, section contracts,
   `state/continuity.md`, or `state/open-questions.md` before generating prose.
5. If the diagnosis is ready, continue with `room blue-sky`, `room decide`,
   `room break`, `chorus run`, or the recommended review pass.

Do not treat the diagnosis as canon by itself. Promote only accepted direction
into durable project files.
