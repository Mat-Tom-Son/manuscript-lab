# Manuscript Lab

[![npm version](https://img.shields.io/npm/v/manuscript-lab.svg)](https://www.npmjs.com/package/manuscript-lab)
[![GitHub release](https://img.shields.io/github/v/release/Mat-Tom-Son/manuscript-lab)](https://github.com/Mat-Tom-Son/manuscript-lab/releases/latest)
[![CI](https://github.com/Mat-Tom-Son/manuscript-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/Mat-Tom-Son/manuscript-lab/actions/workflows/ci.yml)

Manuscript Lab is local CI for prose.

It is a file-based workflow for making long-form writing reviewable,
source-grounded, revisable, and release-ready without keeping the important work
only in chat.

```text
brief -> outline -> section contract -> compose -> draft -> check -> review -> triage -> revise -> verify -> export
```

It is deliberately not an AI book generator. The product direction is contracts,
checks, issues, revision trails, evidence gates, and release workflow for
serious writing.

The harness is not a final judge. It is an evaluation lab for controlled writing
experiments.

## Why It Exists

Most AI writing workflows lose context, provenance, and taste decisions. This
repo keeps them in files:

- section contracts in `draft/*.md`
- project context in `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, and `taste/`
- compiled runtime packets in `state/runtime/`
- Chorus beat-level line-lab runs, contact sheets, plan-quality notes, and
  metrics in `state/chorus/`
- writers' room diagnostics, idea cards, decisions, causal beat boards, and
  table-read artifacts in `state/room/`
- typed review findings in `state/issues/`
- candidate revisions in `state/candidates/`
- exports and export manifests in `exports/`
- readiness reports in `reports/`

The `.pi/` directory adds optional Pi slash commands and skills. The npm scripts
are the portable core.

Codex users can install the repo's Codex skill with:

```bash
npm run codex:install-skill
```

## Quick Start

Requirements:

- Node.js 18 or newer
- No npm dependencies are required
- Full EPUB/PDF export additionally needs `zip`, `python3`, and the Python
  `reportlab` package. Markdown/HTML export works without those.

Install from npm when you want Manuscript Lab inside an existing writing repo:

```bash
npm install -D manuscript-lab
npx mlab --version
```

The public package is
[`manuscript-lab`](https://www.npmjs.com/package/manuscript-lab). The matching
source release is published on
[GitHub Releases](https://github.com/Mat-Tom-Son/manuscript-lab/releases/latest),
with user-visible changes tracked in `CHANGELOG.md`.

Fastest demo:

```bash
cd examples/technical-whitepaper
../../bin/manuscript-lab.mjs validate
../../bin/manuscript-lab.mjs report --write
```

That fixture is a tiny config-first whitepaper project with an accepted issue,
candidate run, comparison winner, diff audit, source/claim register, and sample
exports. The report lands at `reports/latest.html` and `reports/latest.json`
inside the fixture.

The terminal report should look roughly like this:

```text
FAIL Manuscript Lab Report
Project: Technical Whitepaper Tutorial
Profile: whitepaper
Status: not_ready

Summary:
- issues: 0 open, 0 deferred
- claims: 3 total, 0 blocker(s)
- revision trail: 1 accepted issue(s), 1 candidate run(s), 1 audit(s)
- exports: 2
- export manifest: exports/manifest.json
```

After running the demo, inspect:

- `reports/latest.html`: the one-page readiness cockpit
- `state/issues/issue-ledger.json`: the accepted tutorial issue
- `state/candidates/01-opening/tutorial-run-001/`: base, issue context,
  candidates, comparison, and winner decision
- `state/revision-audits/01-opening/`: before snapshot and static diff audit
- `exports/manifest.json`: export release metadata and hashes

Clone the repo, then initialize your own project workspace. The template
workflow is still the broadest command surface and works well when you want the
harness and writing project in one repository.

```bash
npm run project:init -- --title "My Project" --slug my-project --sections 4 --kind document.section
npm run validate
npm run status
npm run check -- --static-only
npm run doctor
```

Or use the local wrapper:

```bash
node bin/manuscript-lab.mjs init --title "My Project" --slug my-project --sections 4 --kind document.section
node bin/manuscript-lab.mjs validate
node bin/manuscript-lab.mjs status
```

The init command creates a mounted active workspace under:

```text
projects/active/<slug>/workspace/
```

The repository root then points to that workspace with symlinks such as
`brief.md`, `draft/`, `state/`, `taste/`, and `exports/`.

The install-anywhere workflow supports external writing repos with Manuscript Lab
as a dev dependency. The published package is tested both as a one-off
`npm exec --package=manuscript-lab -- mlab ...` command and as a project-local
`npm install -D manuscript-lab && npx mlab ...` dependency.

```bash
mkdir my-whitepaper
cd my-whitepaper
npm init -y
npm install -D manuscript-lab
npx mlab init --profile whitepaper --root manuscript --title "My Whitepaper"
npx mlab validate
npx mlab status
npx mlab compose draft/01-opening.md
npx mlab room diagnose draft/01-opening.md
npx mlab room blue-sky draft/01-opening.md
npx mlab room decide draft/01-opening.md --run <room-run-id> --select idea-001 --reason "..."
npx mlab room break draft/01-opening.md --run <room-run-id>
npx mlab room table-read draft/01-opening.md
npx mlab room report draft/01-opening.md
npx mlab chorus plan draft/01-opening.md --from-room <room-run-id>
npx mlab chorus run draft/01-opening.md --from-room <room-run-id>
npx mlab chorus report draft/01-opening.md
npx mlab drive --goal "prepare draft/01-opening.md for review" --target draft/01-opening.md --dry-run --json
npx mlab practice propose --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
npx mlab practice compare --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
npx mlab practice bench --exercises core --models openrouter:z-ai/glm-5.2 --seeds 3 --json
npx mlab practice strategies --exercises core --models openrouter:z-ai/glm-5.2 --strategies default --json
npx mlab artifacts list --json
npx mlab eval practice-strategies --from state/practice-strategies/<run-id> --json
npx mlab golden-path --write --json
npx mlab check --static-only draft/01-opening.md
npx mlab claims list --json
npx mlab citations check --json
npx mlab gate draft/01-opening.md --json
npx mlab report --write
npx mlab export --formats md,html --include-todo --slug my-whitepaper
npx mlab done --export-formats md,html --include-todo-exports --json
```

Install-anywhere init writes `manuscript-lab.config.json` plus user-owned files
under `manuscript/`. It does not copy package `scripts/`, `checks/`, `reviews/`,
`.pi/`, or `skills/` into the caller workspace.

The install-anywhere surface covers deterministic local work: validate,
status, compose, static checks, claims/citations/evidence, gates, reports,
typed review runs, `review:report`, Markdown/HTML export, and `done` with
configurable export requirements. It also includes root-aware candidate-loop
command routing for accepted issues, candidate generation, candidate
comparison, taste gates, merge previews, diff audits, writers' room runs under
`state/room/`, Chorus line-lab runs under `state/chorus/`, bounded model-driver
runs under `state/driver/`, and creative-writing practice proposals under
`state/practice/` with direct-vs-mlab comparisons under
`state/practice-evals/` and aggregate practice benchmarks under
`state/practice-bench/`. Strategy comparison runs live under
`state/practice-strategies/` and compare preset mlab loop shapes such as
single-candidate, multi-candidate selection, revision, and repair, then
recommend per-exercise defaults from aggregate win rate, score delta, cost, and
repair recovery evidence. Model-backed `drive` runs default to a four-step
observe/decide/act loop, can resume persisted run history with `--resume`, and
can inspect generated evidence through read-only artifact primitives, while
credential-free heuristic runs stay one step unless `--max-steps` is set.
Practice comparisons can run bounded repair rounds
when the direct baseline wins and include copy checks so near-copied baselines
do not count as mlab wins. Practice benchmarks report first-pass and
post-repair win rates, score deltas, failure modes, judge relation, and known
token/cost usage, including one-shot recoveries from invalid planning/meta
outputs. They are oracle-guided workflow benchmarks: the direct baseline sees
the public prompt, while the mlab loop may use hidden-rubric feedback for
candidate selection, revision, and repair.
`artifacts list` and `artifacts inspect` expose generated driver, practice,
eval, and golden-path evidence; `eval practice-strategies` snapshots strategy
comparisons into `state/evals/` and can fail on baseline regressions for CI;
`golden-path` prints or persists the first useful onboarding sequence.
`status` and `report` surface recent generated artifacts as part of the
cockpit.
Template project switching commands are guarded as template-clone compatibility
commands.

## Daily Loop

Pick one section and compose its runtime packet:

```bash
npm run compose -- draft/01-opening.md
```

Draft or revise in `draft/01-opening.md`, then run:

```bash
npm run check -- draft/01-opening.md
npm run gate -- draft/01-opening.md
npm run report -- --write
npm run done:no-export
```

Use `npm run done` when you expect reader exports.

## Chorus

Use Chorus when the question is not just what a section should do, but which
line options, pressure moves, and sentence shapes are worth stealing:

```bash
npm run chorus -- plan draft/01-opening.md --beats 4
npm run chorus -- plan draft/01-opening.md --from-room <room-run-id>
npm run chorus -- run draft/01-opening.md --models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus
npm run chorus -- report draft/01-opening.md
```

Chorus is a line lab by default. `run` writes beat candidates, per-beat contact
sheets, `CONTACT_SHEET.md`, `plan-quality.json`, `metrics.json`, and
`CHORUS_REPORT.md` under `state/chorus/<section-id>/<run-id>/`. It does not
modify `draft/`, and it does not write `assembled.md` unless you explicitly pass
`--assemble` or run `chorus assemble`.

## Writers' Room

Use the room protocol when a section needs better options before drafting or a
read-aloud energy pass after revision:

```bash
npm run room -- diagnose draft/01-opening.md
npm run room -- blue-sky draft/01-opening.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
npm run room -- decide draft/01-opening.md --run <room-run-id> --select idea-001 --reason "..."
npm run room -- break draft/01-opening.md --run <room-run-id>
npm run room -- table-read draft/01-opening.md
npm run room -- report draft/01-opening.md
```

Room artifacts land under `state/room/<section-id>/<run-id>/`. The command
diagnoses story-foundation readiness, generates options, records decisions,
materializes causal beat boards, and prepares table-read packets; it does not
rewrite manuscript prose. Diagnosis runs write `STORY_DIAGNOSIS.md` and
`story-diagnosis.json` with a grade and recommended next command. A materialized
room beat board can seed Chorus with
`npm run chorus -- plan draft/01-opening.md --from-room <room-run-id>`. After
drafting or revision, `npm run review:run -- --passes scene.turn draft/01-opening.md`
checks whether scene movement, pressure, turns, and consequences are carrying.

## Evidence And Gates

Use the deterministic evidence spine for nonfiction, research, technical docs,
and any project with source-sensitive claims:

```bash
npm run claims -- list --unsupported
npm run citations -- check draft/01-opening.md
npm run evidence -- report
npm run sources -- add sources/my-source.md
```

Use the first gate command for repeatable readiness checks:

```bash
npm run gate -- draft/01-opening.md
npm run gate -- citation
npm run gate -- manuscript --json --write
```

Gate artifacts written with `--write` land under `state/gates/`.

## Reviews And Revisions

Typed reviews are sensors. They create durable issues; they do not decide
revisions by themselves.

```bash
npm run review:run -- --dry-run --panel prose.clean draft/01-opening.md
npm run review:run -- --panel prose.clean draft/01-opening.md
npm run review:report -- draft/01-opening.md
npm run issues -- list --status open
```

For higher-stakes revisions, use the candidate arena:

```bash
npm run revise:candidates -- draft/01-opening.md --issue <issue-id> --n 3
npm run compare:candidates -- draft/01-opening.md --run <candidate-run-id>
npm run taste:arbiter -- draft/01-opening.md --run <candidate-run-id>
npm run merge:winner -- draft/01-opening.md --run <candidate-run-id> --apply --audit
```

That path is designed for changes where several plausible fixes exist, such as
compression, scene deletion, structural moves, voice-sensitive revisions, or
tradeoffs between clarity and subtext.

## Model Providers

Model calls route through `scripts/lib/model-provider.mjs`. Supported provider
families include OpenRouter, Lightning AI, and custom OpenAI-compatible
endpoints.

Copy `.env.example` to `.env` when you need model-backed checks or reviews:

```bash
OPENROUTER_API_KEY=... npm run review:run -- --panel prose.clean draft/01-opening.md
LIGHTNING_API_KEY=... npm run check:model -- draft/01-opening.md
```

Do not commit `.env`.

## Optional Pi Adapter

Pi is an agent UI that can read `AGENTS.md`, `.pi/prompts/`, and `.pi/skills/`.
You do not need Pi to use Manuscript Lab. The npm scripts are the portable core;
the `.pi/` files are an optional command-and-skill layer for agents that support
them.

## What Is In The Repo

- `scripts/`: harness commands
- `checks/`: model-backed semantic checks and prompts
- `reviews/`: typed review passes and model panels
- `skills/codex/`: optional Codex skill adapter
- `examples/`: public tutorial fixture projects
- `.pi/prompts/`: optional slash-command templates
- `.pi/skills/`: optional local skills for long-form writing workflows
- `docs/`: operating guides and architecture notes
- `templates/`: reusable section contract templates

User projects, manuscripts, archives, exports, runtime state, and model-call logs
are ignored by default so the public repo stays reusable.

## Important Docs

- `docs/GETTING_STARTED.md`: first-project walkthrough
- `docs/CODEX_SKILLS.md`: installing and using the Codex skill
- `docs/PRODUCT_STRATEGY.md`: positioning and product roadmap
- `docs/ARCHITECTURE.md`: layers and file boundaries
- `docs/FILE_PROTOCOL.md`: project layout and config protocol
- `docs/INSTALL_WORKFLOW.md`: npm/install-anywhere design record
- `docs/MODEL_DRIVER.md`: model-driven interactive orchestration design
- `docs/GOLDEN_PATH.md`: first useful product path and evidence tour
- `docs/PRIMITIVE_CONTRACTS.md`: contributor contract for public commands,
  driver tools, generated artifacts, and evals
- `docs/GATE_ENGINE.md`: readiness gate design and result format
- `docs/EVIDENCE_SPINE.md`: claims and sources design
- `examples/technical-whitepaper/README.md`: public tutorial fixture
- `docs/CI.md`: GitHub Actions workflow
- `docs/OPERATOR_GUIDE.md`: detailed operating manual
- `docs/PROJECT_FILESYSTEM.md`: active/inactive project filesystem
- `docs/CHAPTER_PRODUCTION_WORKFLOW.md`: section-level writing workflow
- `docs/EVALUATION_LAB_ROADMAP.md`: candidate and judge evaluation strategy
- `docs/MODEL_PROVIDERS.md`: provider setup and model routing

## Verification

Run reusable script tests:

```bash
npm test
```

Validate the file protocol and current workspace discovery:

```bash
npm run validate
node bin/manuscript-lab.mjs validate --json
```

Inspect local setup and release-health basics:

```bash
npm run doctor
npm run doctor -- --json
```

Run public-template hygiene checks:

```bash
npm run template:audit -- --strict
npm run context:audit -- --strict
```

Run the final gate after project work:

```bash
npm run done
```

Use `npm run done:no-export` for maintenance work that should not regenerate
reader exports.

For a Markdown/HTML reader copy without Python:

```bash
npm run export -- --formats md,html --slug my-project
```

For all formats, including EPUB and PDF:

```bash
npm run export -- --slug my-project
```

Each successful export writes `exports/manifest.json` with input hashes, output
hashes, file sizes, formats, source commit when available, and git dirty state.

## License

MIT. See `LICENSE`.
