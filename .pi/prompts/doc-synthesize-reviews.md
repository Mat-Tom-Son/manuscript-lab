---
description: Deduplicate model reviews into one revision plan
argument-hint: "<section id or file>"
---
Synthesize review feedback for:

$ARGUMENTS

Read:

- `PROJECT.md`
- `brief.md`
- `outline.md`
- `style.md`
- `state/status.md`
- `state/claims.md`
- `state/reviews/`
- `state/issues/issue-ledger.json`
- the target section

Run the review report first:

```bash
node scripts/review-report.mjs $ARGUMENTS
```

Write or update one synthesis file under `state/reviews/` using this structure:

## Shared Judgment

## Accepted Issues

## Rejected Or Deferred Issues

## Patch Plan

Rules:

1. Deduplicate repeated issues.
2. Treat repeated sightings on the same ledger issue as evidence, not separate chores.
3. Preserve useful disagreements.
4. Reject suggestions that contradict the brief, style guide, or section contract.
5. Prefer concrete patch steps over vague taste notes.
6. Do not revise the manuscript in this prompt.
