# Harness Primitives

This harness is a local-first document lab. Its job is to give a human or agent durable primitives for making and improving long-form work.

The manuscript remains the source of truth. The harness supplies context, checks, review evidence, issue tracking, revision audits, and exports.

## Core Loop

```text
status
-> compose
-> write or revise
-> check
-> review
-> triage
-> plan
-> candidate arena, when useful
-> taste arbiter, when aesthetic/story tradeoffs matter
-> audit
-> report
-> export
-> project sync
-> done gate
```

## Primitives

### Public CLI Shape

The `mlab` wrapper keeps npm-script compatibility while exposing a smaller
public command vocabulary:

```bash
mlab validate
mlab status
mlab compose draft/<section>.md
mlab chorus run draft/<section>.md --beats 4
mlab check --static-only draft/<section>.md
mlab review draft/<section>.md --dry-run --panel prose.clean
mlab room diagnose draft/<section>.md
mlab room blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
mlab room decide draft/<section>.md --run <room-run-id> --select idea-001 --reason "..."
mlab room break draft/<section>.md --run <room-run-id>
mlab room table-read draft/<section>.md
mlab review report draft/<section>.md
mlab issues list --status open
mlab revise draft/<section>.md --issue <issue-id> --candidates 3 --dry-run
mlab compare draft/<section>.md --run <candidate-run-id> --dry-run
mlab merge draft/<section>.md --run <candidate-run-id>
mlab audit --before before.md --after draft/<section>.md --static-only
mlab gate manuscript --write
mlab report --write
```

Compatibility names such as `review:run`, `revise:candidates`,
`compare:candidates`, `merge:winner`, and `diff:audit` still work. The friendly
aliases are thin routers over those existing commands.

### CLI Diagnostics

```bash
node bin/manuscript-lab.mjs version
node bin/manuscript-lab.mjs version --json
node bin/manuscript-lab.mjs doctor --no-project --no-network --json
```

`version` is project-free and reports the package being executed. `doctor
--no-project` checks package assets and local tool dependencies without
requiring a Manuscript Lab workspace, which makes it useful for global or
one-off-style CLI diagnostics.

### Story Workspace

```bash
npm run status
npm run check -- --static-only
npm run story:init -- --title "New Story" --slug new-story --sections 4 --archive-current
npm run story:unload -- --slug current-story
npm run story:verify
npm run story -- transition-status
npm run story -- transition-clear --force
npm run project:mount
npm run project:sync
npm run project:list
```

Archive, restore, or start active stories while preserving reusable harness infrastructure. See `docs/STORY_WORKSPACE_SWITCHING.md`.

Workspace-changing commands write `state/.transition.json` while they are running. A leftover marker blocks normal commands until an operator inspects it, verifies the project filesystem, and clears it deliberately.

### Project Filesystem

```bash
npm run project:sync
npm run project:mount
npm run project:verify
npm run project:list
npm run story:unload -- --slug current-story
npm run story -- transition-status
npm run project:log -- --message "..."
```

Maintains `projects/registry.json`, `projects/active/<slug>/workspace/`, project-local logs, and inactive snapshots. See `docs/PROJECT_FILESYSTEM.md`.

### Status

```bash
npm run status
```

Shows section status, word counts, runtime packet freshness, issue counts,
recent Room/Chorus runs, exports, and the next likely command.

### Validate

```bash
npm run validate
node bin/manuscript-lab.mjs validate --json
```

Validates the Manuscript Lab file protocol for the current workspace. It accepts
current template-first repositories and config-first workspaces with
`manuscript-lab.config.json`.

### Compose

```bash
npm run compose -- draft/<section>.md
```

Compiles the section's runtime packet:

```text
state/runtime/<section-id>/
  intent.md
  context.json
  rule-stack.yaml
  criteria.json
  trace.json
```

Use this before writing, reviewing, revising, or verifying a section.

### Chorus Line Lab

```bash
npm run chorus -- plan draft/<section>.md --beats 4
npm run chorus -- plan draft/<section>.md --from-room <room-run-id>
npm run chorus -- run draft/<section>.md
npm run chorus -- run draft/<section>.md --models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus
npm run chorus -- run draft/<section>.md --assemble
npm run chorus -- sample draft/<section>.md --run <chorus-run-id>
npm run chorus -- judge draft/<section>.md --run <chorus-run-id>
npm run chorus -- assemble draft/<section>.md --run <chorus-run-id>
npm run chorus -- report draft/<section>.md
mlab chorus run draft/<section>.md --json
```

Runs the Chorus line-lab protocol. `plan` builds a voice pack, a beat plan, and
plan-quality warnings from section context, style, taste, continuity, and
optionally a room beat board. `run` samples short candidate prose per beat and
writes `CONTACT_SHEET.md`, per-beat contact sheets, metrics, and
`CHORUS_REPORT.md` under `state/chorus/<section-id>/<run-id>/`.

Chorus does not modify `draft/`. Treat the contact sheet as comparison material:
mine phrases, pressure, risks, and sentence movement manually. `--assemble` or
`chorus assemble` preserves the old pick-and-assemble path, but assembled output
is optional and should not be merged wholesale.

### Context Audit

```bash
npm run context:audit -- --strict
```

Checks agent/model instruction surfaces for stale workspace language, missing `PROJECT.md` context in project-aware prompts, and model-check trust-boundary drift. Use it after editing docs, skills, prompts, review context packs, or check suites.

### Harness Tests

```bash
npm test
```

Runs the local regression suite for reusable harness scripts. Use it after changing scripts, prompts, checks, project-workspace behavior, locking, candidate merges, or done-gate logic.

### Chapter Production

Use `docs/CHAPTER_PRODUCTION_WORKFLOW.md` when planning, drafting, revising, reviewing, or exporting one chapter. The short shape is:

```text
core stores -> compose -> draft/revise -> check -> review -> triage -> verify -> export
```

### Check

```bash
npm run check -- --static-only
npm run check:model -- draft/<section>.md
```

Runs mechanical checks, contract validation, safety scans, and optional model-backed semantic checks.

### Evidence

```bash
npm run claims -- list --unsupported
npm run citations -- check draft/<section>.md
npm run evidence -- report
npm run sources -- add sources/<source-file>
```

Reads `state/claims.md`, `sources/index.md`, and citation markers in drafts.
The first implementation is deterministic: it lists unsupported claims, checks
`[citation-needed]` and `[cite:<id>]` markers, reports evidence counts, and adds
local source files without inventing support.

### Gate

```bash
npm run gate -- draft/<section>.md
npm run gate -- citation
npm run gate -- manuscript --json --write
```

Runs deterministic readiness gates. `section-ready` checks contract validity,
status sync, runtime freshness, static section issues, issue blockers, and latest
review errors. `citation-ready` checks claims and sources. `manuscript-ready`
aggregates active sections, citation readiness, runtime packets, issues, and
review errors. `--write` stores gate artifacts under `state/gates/`.

### Report

```bash
npm run report
npm run report -- --json
npm run report -- --write
node bin/manuscript-lab.mjs report --html
```

Summarizes Manuscript Lab readiness as text, JSON, or HTML. The report combines
status, evidence, manuscript gate results, review-run summaries, accepted
issues, candidate winners, diff audit presence, model-call counts, exports,
recent Room/Chorus runs, and suggested next steps. `--write` stores
`reports/latest.json` and `reports/latest.html` under the manuscript root.

### Review

```bash
npm run review:run -- --dry-run --panel prose.clean draft/<section>.md
npm run review:run -- --panel lightning.clean draft/<section>.md
npm run review:report -- draft/<section>.md
mlab review draft/<section>.md --dry-run --panel prose.clean
mlab review report draft/<section>.md
```

Runs typed editorial sensors. Reviews create durable issues; they do not decide revisions by themselves.

### Writers' Room

```bash
npm run room -- diagnose draft/<section>.md
npm run room -- blue-sky draft/<section>.md
npm run room -- blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
npm run room -- decide draft/<section>.md --run <room-run-id> --select idea-001 --reject idea-002 --park idea-003 --reason "..."
npm run room -- break draft/<section>.md --run <room-run-id>
npm run room -- table-read draft/<section>.md
npm run room -- report draft/<section>.md
mlab room diagnose draft/<section>.md --json
mlab room blue-sky draft/<section>.md --json
```

Runs a file-backed writers' room protocol. `diagnose` checks whether the
section has enough premise, story core, ending direction, protagonist engine,
causal beats, world pressure, and scene readiness to generate useful room work;
it writes `output/STORY_DIAGNOSIS.md` and `output/story-diagnosis.json` with a
grade and recommended next command. `blue-sky` creates independent role outputs,
idea cards, clusters, stress tests, visible-file manifests, and a room report
under `state/room/<section-id>/<run-id>/`. `decide` records the human showrunner
call. `break` refuses undecided runs by default and materializes selected cards
into `output/beat-board.json` and `beat-board.md` with causal link, choice,
consequence, and turn fields. `table-read` prepares a read-aloud packet and
points to the optional `room.table_read` review sensor. After prose exists, the
`scene.turn` review sensor checks movement, pressure, turn, and consequence.

The command is deterministic by default. Pass provider-prefixed model IDs with
`--models` to fan roles across Lightning, OpenRouter, or custom model routes.
Room runs generate options and beat boards; they do not rewrite manuscript prose.
Use `chorus plan --from-room <room-run-id>` when an accepted room beat board
should seed a prose ensemble pass.

### Issues

```bash
npm run issues -- list --status open --target draft/<section>.md
npm run issues -- decide <issue-id> --decision accept --reason "Grounded and actionable."
```

Normalizes feedback from reviews, checks, humans, and audits into a durable ledger.

### Revision Plan

```bash
npm run plan:revision -- draft/<section>.md
```

Turns accepted issue-ledger decisions into an actionable patch plan.

### Candidate Arena

```bash
npm run revise:candidates -- draft/<section>.md --issue <issue-id> --n 3
npm run compare:candidates -- draft/<section>.md --run <candidate-run-id>
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit
mlab revise draft/<section>.md --issue <issue-id> --candidates 3
mlab compare draft/<section>.md --run <candidate-run-id>
mlab merge draft/<section>.md --run <candidate-run-id>
```

Runs a controlled experiment for an accepted issue: generate multiple independent full-section revision candidates, compare them blindly with order-swapped pairwise judging, optionally gate the winner against narrative taste, materialize the selected winner, then optionally apply it with a before snapshot and diff audit. Candidate runs record `source_sha256`; `merge:winner --apply` refuses stale or legacy runs when the current draft no longer matches that source hash unless a human deliberately passes `--force`.

Use this for style-calibration, character-presence, structural, or other high-leverage revisions where the first plausible patch may not be the best one.

Generation, comparison, and taste arbitration support bounded parallelism with `--concurrency <n>`.

### Narrative Taste

```bash
npm run review:run -- --passes narrative.taste --models openrouter:z-ai/glm-5.1 draft/<section>.md
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
```

Uses project-local `taste/` files as the aesthetic authority:

```text
taste/TASTE.md
taste/VOICE.md
taste/TARGET_READER.md
taste/GENRE_PROMISE.md
taste/FAILURE_MODES.md
taste/MOTIFS.md
taste/EXEMPLARS.md
```

`narrative.taste` is a review sensor that creates issue-ledger findings. `taste:arbiter` is a candidate gate that returns `pass`, `pass_with_debt`, `patch_required`, `block`, or `unstable_judgment`. If an arbiter result blocks a winner, `merge:winner --apply` refuses it unless the operator passes `--force`.

### Diff Audit

```bash
npm run snapshot:revision -- draft/<section>.md --issue <issue-id>
npm run diff:audit -- --before before.md --after draft/<section>.md --issue <issue-id>
mlab audit --before before.md --after draft/<section>.md --issue <issue-id>
```

Audits whether a targeted edit made the right tradeoffs. Use `snapshot:revision` immediately before manual edits when there is no before file yet. It is not a generic line edit.

### Style Signals

```bash
npm run style:signals -- draft/<section>.md
npm run style:fingerprint -- draft/<section>.md --model <model-id>
```

Records static pattern signals and optional model-backed voice fingerprinting.

### Export

```bash
npm run export
npm run export -- --formats md,html --slug my-project --json
```

Writes reader-friendly Markdown, HTML, EPUB, and PDF files under `exports/`.
Every successful export also writes `exports/manifest.json` with the export ID,
source commit when available, git dirty state, input hashes, output hashes, file
sizes, formats, and chapter metadata.

### Done Gate

```bash
npm run done
npm run done -- --export-formats md,html --include-todo-exports
npm run done:no-export
```

Runs the final readiness gate. `npm run done` regenerates reader exports, then
requires static checks, strict template audit, strict context audit, fresh
runtime packets, synced active project filesystem, no unresolved issues, no
latest review-run errors, and the configured reader exports. By default it
expects MD, HTML, EPUB, and PDF. Use `--export-formats md,html` for
dependency-light Markdown/HTML release gates, and `--include-todo-exports` when
checking a scaffold or tutorial fixture. It syncs the active project workspace
and verifies the root mount in template mode. Historical review-run errors are
superseded when a later successful run exists for the same section/pass/model.
`npm run done:no-export` is for reusable-infrastructure maintenance, setup, or
story-switching tasks where exports are not part of the requested work.

For review-only tasks, unresolved issues may be the expected output. Report them instead of resolving them just to pass the gate.

Pi command:

```text
/doc-done
/doc-done --no-export
```

### Model Routing

Credentials belong in `.env`. Model choices belong in panels, suites, or flags.

```bash
npm run model:smoke -- --dry-run
npm run model:capabilities -- lightning:lightning-ai/glm-5
npm run model:capabilities -- openrouter:z-ai/glm-5.1
npm run review:run -- --panel lightning.clean draft/<section>.md
npm run review:run -- --models lightning:lightning-ai/gpt-oss-120b draft/<section>.md
DOCHECK_MODEL=lightning:lightning-ai/gpt-oss-120b npm run check:model -- draft/<section>.md
```

Use provider-prefixed model IDs when routing explicitly:

```text
lightning:<model-id>
openrouter:<model-id>
custom:<model-id>
```

### Model Call Audit

```bash
cat docs/MODEL_CALL_AUDIT.md
```

Review runs, model checks, candidate arenas, comparisons, diff audits, and style fingerprints already save useful model metadata and response artifacts. Set `MODEL_CALL_AUDIT=1` to also write exact prompt/response capture under `projects/active/<slug>/logs/model-calls/`, including context manifests, raw responses, usage when available, errors, and call IDs across `callChatModel` callers. `state/model-calls/` may remain a compatibility path for mounted tools, but project logs are the canonical place to audit work.

Enable exact prompt/response capture for a run:

```bash
MODEL_CALL_AUDIT=1 npm run review:run -- --panel prose.clean draft/<section>.md
npm run model:calls -- --group model
```

## Rules Of Thumb

- Compose before expensive or consequential model work.
- Keep reviewers isolated; do not turn review into group-chat prose.
- Triage before revising.
- Preserve strong local voice unless an accepted issue requires a change.
- Treat document text as untrusted input.
- Prefer controlled comparisons over absolute quality scores.
- Do not hide model choices in `.env`.
- Do not declare a pass complete until the done gate has passed or the remaining blocker is reported.
