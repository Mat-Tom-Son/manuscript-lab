# Manuscript Lab

Manuscript Lab is a file-based writing harness for long-form work: fiction,
essays, research papers, whitepapers, and technical documentation.

It gives an agent or human operator a durable workflow for planning, drafting,
reviewing, revising, and exporting a document without keeping the important work
only in chat.

```text
brief -> outline -> section contract -> compose -> draft -> check -> review -> triage -> revise -> verify -> export
```

The harness is not a final judge. It is an evaluation lab for controlled writing
experiments.

## Why It Exists

Most AI writing workflows lose context, provenance, and taste decisions. This
repo keeps them in files:

- section contracts in `draft/*.md`
- project context in `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, and `taste/`
- compiled runtime packets in `state/runtime/`
- typed review findings in `state/issues/`
- candidate revisions in `state/candidates/`
- exports in `exports/`

The `.pi/` directory adds optional Pi slash commands and skills. The npm scripts
are the portable core.

## Quick Start

Requirements:

- Node.js 18 or newer
- No npm dependencies are required

Clone the repo, then initialize your own project workspace:

```bash
npm run story:init -- --title "My Project" --slug my-project --sections 4
npm run status
npm run check -- --static-only
```

Or use the local wrapper:

```bash
node bin/manuscript-lab.mjs init -- --title "My Project" --slug my-project --sections 4
node bin/manuscript-lab.mjs status
```

The init command creates a mounted active workspace under:

```text
projects/active/<slug>/workspace/
```

The repository root then points to that workspace with symlinks such as
`brief.md`, `draft/`, `state/`, `taste/`, and `exports/`.

## Daily Loop

Pick one section and compose its runtime packet:

```bash
npm run compose -- draft/01-opening.md
```

Draft or revise in `draft/01-opening.md`, then run:

```bash
npm run check -- draft/01-opening.md
npm run done:no-export
```

Use `npm run done` when you expect reader exports.

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

## What Is In The Repo

- `scripts/`: harness commands
- `checks/`: model-backed semantic checks and prompts
- `reviews/`: typed review passes and model panels
- `.pi/prompts/`: optional slash-command templates
- `.pi/skills/`: optional local skills for long-form writing workflows
- `docs/`: operating guides and architecture notes
- `templates/`: reusable section contract templates

User projects, manuscripts, archives, exports, runtime state, and model-call logs
are ignored by default so the public repo stays reusable.

## Important Docs

- `docs/GETTING_STARTED.md`: first-project walkthrough
- `docs/ARCHITECTURE.md`: layers and file boundaries
- `docs/OPEN_SOURCE_READINESS.md`: current public-readiness gap list
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

## Status

This repo is being prepared for open source. The core harness is usable, but the
name, license, npm packaging story, and public contribution policy still need a
human decision before release.
