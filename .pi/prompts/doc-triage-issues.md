---
description: Triage issue-ledger findings into editorial decisions
argument-hint: "<section file or issue id>"
---
Triage issues for:

$ARGUMENTS

Read:

- `PROJECT.md`
- `brief.md`
- `outline.md`
- `style.md`
- `state/continuity.md`
- `state/issues/issue-ledger.json`
- relevant review runs under `state/reviews/`
- the target section when a section is provided

Use ledger filters to keep the pass focused:

```bash
node scripts/issue-ledger.mjs list --status open --target <section file>
node scripts/issue-ledger.mjs stats --target <section file>
```

For each relevant open issue, decide:

- `accept`
- `reject`
- `defer`
- `merge`
- `convert_to_check`
- `manual_review_needed`

Use `node scripts/issue-ledger.mjs decide <issue_id> --decision <decision> --reason "..." --revision-instruction "..."` for each decision.

Do not revise the manuscript in this prompt. Produce or update a concise patch-plan note only after triage decisions exist.
