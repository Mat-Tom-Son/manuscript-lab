---
name: chapter-production
description: Plan, draft, revise, review, or verify a single chapter or section through the Manuscript Lab harness using core stores, runtime packets, checks, reviews, issue ledger, and candidate arena when useful.
---

# Chapter Production

Use this skill when working on one chapter or section.

## Rule

Update the source of truth before drafting prose. Then compose, write, check, review, triage, revise, and verify in files.

## Workflow

1. Run `npm run status`.
2. Read the target section contract plus `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, relevant `taste/` files, `docs/PROJECT_HANDOFF.md`, `docs/PROJECT_REVIEW_APPROACH.md`, and relevant `state/` files when present.
3. If the premise, plot, science, or character direction changed, update core stores first.
4. Run `npm run compose -- draft/<section>.md --operation draft` or `--operation revise`.
5. Draft or revise in `draft/<section>.md`.
6. Run `npm run check -- --static-only`.
7. Run typed reviews when useful; import only actionable issues.
8. Triage issues before editing.
9. Use candidate arena for consequential accepted issues with multiple plausible fixes.
10. Make a before snapshot before substantial manual structural edits.
11. Refresh runtime packets, rerun checks, and export when a reader copy is needed.
12. Run `npm run done` before claiming reader-ready completion, or `npm run done:no-export` for chapter maintenance without exports.

For exact commands and state responsibilities, read `docs/CHAPTER_PRODUCTION_WORKFLOW.md`.

## Review Discipline

- Reviews are sensors, not decisions.
- Use `--no-ledger` for verification passes that should not import issues automatically.
- Close stale or false-positive issues with explicit reasons.
- Preserve protected lines and strong local voice.
- After major revisions, run `npm run diff:audit`.
- When human feedback asks for compression, skipped scenes, or less stated theme, prefer objects, choices, consequences, and scene turns over explanatory thesis statements.
- Reduce repeated rhetorical moves around strong voice before cutting the voice itself.
- Do not call a pass complete until the done gate passes or the remaining blocker is reported.

## Candidate Arena

Use:

```bash
npm run revise:candidates -- draft/<section>.md --issue <issue-id> --n 3
npm run compare:candidates -- draft/<section>.md --run <candidate-run-id>
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit
```

If comparisons are unstable, stop for human judgment or a manual merge. If the taste arbiter returns `patch_required`, `block`, or `unstable_judgment`, stop unless the human explicitly overrides it.

Use the arena when structural feedback has several viable shapes, such as merging scenes, deleting a redundant scene, moving the chapter turn, or replacing explanation with object-led action.
