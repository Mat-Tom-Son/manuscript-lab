---
name: manuscript-lab
description: Operate and ship work in the Manuscript Lab repository or a Manuscript Lab writing project. Use when Codex is asked to implement product features, fix harness scripts, update checks/reviews/prompts/docs, mature packaging, run release work, install agent adapters, revise manuscript sections, run gates, or generally jump into Manuscript Lab and make durable verified changes.
---

# Manuscript Lab

Use this skill to work as a Manuscript Lab shipping agent.

Manuscript Lab is local CI for prose: file protocol, checks, typed issues,
candidate revisions, evidence gates, and release workflow for serious long-form
writing. Do useful work in files, verify it, and leave the repo shippable.

## First Minute

1. Run `git status --short --ignored`.
2. Run `npm run doctor -- --no-network` unless the task is a tiny read-only
   question.
3. Read `AGENTS.md`, then the smallest relevant docs:
   - product direction: `docs/PRODUCT_STRATEGY.md`
   - architecture or file boundaries: `docs/ARCHITECTURE.md`
   - command surface: `docs/PRIMITIVES.md`
   - onboarding: `README.md`, `docs/GETTING_STARTED.md`
   - model routing: `docs/MODEL_PROVIDERS.md`
   - release/CI/package posture: `README.md`, `CHANGELOG.md`,
     `docs/INSTALL_WORKFLOW.md`, `docs/CI.md`
4. Identify whether the task is harness work, writing-project work, release
   work, or agent-adapter work.

Read `references/task-routes.md` from this skill folder when the route is not
obvious.

## Operating Rules

- Never write long-form manuscript prose only in chat. Edit durable files.
- Preserve ignored user/project content unless explicitly asked to change it.
- Do not stage `PROJECT.md`, `brief.md`, `draft/`, `state/`, `exports/`,
  `sources/`, `taste/`, `.env`, `.doccheck/`, or `projects/active/` for public
  harness commits unless the user deliberately changes repo boundaries.
- Keep generic harness files free of project-specific story/client facts.
- Treat reviews as sensors. Triage issue-ledger findings before revising from
  them.
- Use candidate revisions for meaningful structural, voice, evidence, or
  high-risk edits where several fixes could work.
- Use `[citation-needed]` rather than inventing factual support.
- Put credentials in `.env` or the shell environment only; never in docs,
  prompts, checks, reviews, tests, or examples.
- Prefer `npm` scripts and `bin/manuscript-lab.mjs` commands over ad hoc script
  entry points when they exist.
- Update `CHANGELOG.md` for user-visible harness, CLI, docs, packaging, or
  release-process changes.

## Common Routes

### Harness/Product Work

Use for scripts, checks, reviews, prompts, docs, packaging, CLI, tests, skills,
and repo maturity.

1. Inspect the relevant script/docs/test files.
2. Make scoped edits.
3. Run targeted tests first when available.
4. Run the standard public-repo gates:

```bash
npm test
npm run template:audit -- --strict
npm run context:audit -- --strict
npm run doctor -- --no-network
npm pack --dry-run
```

If the change is docs-only, `npm test`, `template:audit`, `context:audit`, and
`doctor` are usually enough; run `npm pack --dry-run` when package contents or
public surface changed.

### Writing-Project Work

Use for drafting, revising, reviewing, or exporting a specific manuscript.

1. Run `npm run status`.
2. Read `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, relevant `taste/`
   files, and relevant `state/` files.
3. Work on one `draft/<section>.md` at a time.
4. Run `npm run compose -- draft/<section>.md` before drafting, reviewing,
   revising, or verifying.
5. Inspect `state/runtime/<section-id>/`.
6. Edit the draft and any required state files.
7. Run `npm run check -- draft/<section>.md`.
8. Run `npm run project:sync`.
9. Run `npm run done` when exports are expected, otherwise
   `npm run done:no-export`.

### Review And Revision Work

Use durable issue flow:

```bash
npm run review:run -- --dry-run --panel prose.clean draft/<section>.md
npm run review:run -- --panel prose.clean draft/<section>.md
npm run review:report -- draft/<section>.md
npm run issues -- list --status open
```

Gate and report output distinguish a declared pass that never completed from a
successful run that became stale after the section body or review definition
changed. Follow the emitted `mlab review run ... --passes ...` fix command;
successful mock-response runs count, provider/parse failures do not.

For accepted issues with multiple plausible fixes:

```bash
npm run revise:candidates -- draft/<section>.md --issue <issue-id> --n 3
npm run compare:candidates -- draft/<section>.md --run <candidate-run-id>
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit
```

### Release Or Shipping Work

Read `references/shipping-checklist.md` from this skill folder before
committing, pushing, tagging, releasing, or closing public issues.

## Output Discipline

Before final response:

- Report what changed.
- Report verification commands and results.
- Call out skipped checks or remaining risk.
- Mention open follow-ups only when they are directly useful.
- If changes were committed, pushed, or released, include the commit/tag/release
  facts.
