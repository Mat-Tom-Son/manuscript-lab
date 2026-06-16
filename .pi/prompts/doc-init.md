---
description: Initialize or refresh a document repo
argument-hint: "<document goal>"
---
Initialize this writing project for:

$ARGUMENTS

Steps:

1. Inspect the current folder.
2. Read `AGENTS.md`, `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, and files under `state/`.
3. Fill in missing brief fields where the user supplied enough information.
4. Add questions to `state/open-questions.md` where information is missing.
5. Create or improve a first-pass `outline.md`.
6. Ensure `state/status.md`, `state/continuity.md`, `state/claims.md`, `sources/index.md`, and `checks/suite.json` exist.
7. Do not draft manuscript prose yet.
8. Run `node scripts/doccheck.mjs`.
9. Run `npm run done:no-export`.

Do not overwrite non-empty user content unless it is clearly stale and you explain why.
