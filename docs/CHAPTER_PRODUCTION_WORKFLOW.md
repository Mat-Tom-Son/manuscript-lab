# Chapter Production Workflow

> Status: written for the pre-2.0 surface; command names may differ. Current surface: docs/COMMANDS.md. Old names still work as aliases.

Use this when planning, drafting, revising, or verifying one chapter or document section.

## 1. Read The Operating Context

Start with:

```bash
npm run status
```

Read:

- section contract at the top of the target draft file
- `PROJECT.md`
- `brief.md`
- `outline.md`
- `style.md`
- `state/continuity.md`
- `state/claims.md`
- `state/open-questions.md`
- `docs/PROJECT_HANDOFF.md`, if present

For a new chapter, create the draft file and matching `state/status.md` row before drafting.

## 2. Update Core Stores First

If the user changes premise, plot, science, scope, or character direction, update the source of truth before prose:

- `PROJECT.md` for compact active operating notes and human taste direction
- `brief.md` for promise, scope, and must-include / must-avoid constraints
- `outline.md` for chapter purpose and plot ladder
- `style.md` for voice or terminology rules
- `taste/` for aesthetic doctrine, reader contract, genre promise, failure modes, motifs, and exemplar memory
- `state/continuity.md` for canon
- `state/claims.md` for factual or speculative claims
- `state/open-questions.md` for unresolved choices
- `sources/index.md` and `sources/*.md` for research notes

This prevents later model passes from judging against stale canon.

## 3. Compose Runtime Packet

Run:

```bash
npm run compose -- draft/<section>.md --operation draft
```

Use `--operation revise` for existing prose. Inspect `state/runtime/<section-id>/intent.md`, `criteria.json`, `rule-stack.yaml`, and `trace.json` when the operation is consequential.

## 4. Diagnose Optional Story Foundation

When direction is still cheap to change, run the room diagnosis before drafting:

```bash
npm run room -- diagnose draft/<section>.md
```

If the diagnosis flags missing premise, story core, ending direction,
protagonist engine, causal beats, world pressure, or scene readiness, update
durable project state before generating options or prose. Continue to
`room blue-sky`, `decide`, and `break` only when the foundation is useful enough
to pressure-test.

## 5. Draft Or Revise In Files

Write in `draft/<section>.md`, not chat. Keep the section contract current.

Preserve strong existing prose unless an accepted issue requires changing it. When revising a major section, snapshot before/after material under `state/revision-audits/` so `npm run diff:audit` can compare tradeoffs.

## 6. Check And Review

Run static checks:

```bash
npm run check -- --static-only
```

Run targeted reviews when useful:

```bash
npm run review:run -- --panel lightning.clean --passes cold.reader,contract.editor,continuity draft/<section>.md
npm run review:run -- --passes scene.turn draft/<section>.md
npm run review:report -- draft/<section>.md
npm run issues -- list --status open --target draft/<section>.md
```

Use `--no-ledger` for verification reads that should not import issues automatically.

## 7. Triage Before Editing

Reviews are sensors. The issue ledger is the decision surface.

For each open issue:

```bash
npm run issues -- decide <issue-id> --decision accept --reason "..." --revision-instruction "..."
npm run issues -- close <issue-id> --reason "..."
```

Close false positives or stale issues with explicit reasons so future agents can see why they were rejected.

## 8. Use Candidate Arena For Consequential Fixes

When one issue has multiple plausible fixes:

```bash
npm run plan:revision -- draft/<section>.md
npm run revise:candidates -- draft/<section>.md --issue <issue-id> --n 3 --concurrency 3
npm run compare:candidates -- draft/<section>.md --run <candidate-run-id> --concurrency 2
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id> --models openrouter:z-ai/glm-5.2
npm run merge:winner -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit
```

If comparisons are unstable, stop for human judgment or manually merge strengths. Do not force the top option. If the taste arbiter returns `patch_required`, `block`, or `unstable_judgment`, patch or choose another candidate before apply unless the human explicitly overrides it.

## 9. Verify And Export

After edits:

```bash
npm run compose -- draft/<section>.md --operation revise
npm run check -- --static-only
npm run issues -- list --status open
npm run status
npm run done:no-export
```

For reader copies:

```bash
npm run export -- --slug <story-slug>
npm run done
```

Done means the prose, state files, runtime packet, checks, issue ledger, and requested exports agree.
