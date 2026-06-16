---
description: Draft or continue one section
argument-hint: "<section id or file>"
---
Draft or continue this section:

$ARGUMENTS

Rules:

1. Read `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, `state/status.md`, and `state/continuity.md`.
2. Read relevant entries from `sources/index.md` and dependency files named in the section contract.
3. Work only on the requested draft section, plus necessary state-file updates.
4. If the section file does not exist, create it under `draft/` with a section contract.
5. If the section file exists, run `npm run compose -- $ARGUMENTS` and inspect the runtime packet.
6. Use `[citation-needed]` for unsupported factual claims.
7. Update `state/status.md`, `state/continuity.md`, `state/claims.md`, and `state/open-questions.md`.
8. Run `node scripts/doccheck.mjs` on the target section.
9. If the section contract has `checks:` and a configured provider key or cached results are available, run `node scripts/doccheck.mjs --model-checks` on the target section.
10. Fix mechanical and blocking semantic failures.
11. Run `npm run done:no-export`, or `npm run export` followed by `npm run done` if the user requested reader files.

Do not mark the section done if source, continuity, or checker issues remain.
