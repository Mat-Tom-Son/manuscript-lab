# Manuscript Lab

Manuscript Lab is a file-based writing harness for long-form work: fiction,
essays, research papers, whitepapers, and technical documentation.

It gives an agent or human operator a durable workflow for planning, drafting,
reviewing, revising, and exporting a document without keeping the important work
only in chat.

```text
brief -> outline -> section contract -> compose -> draft -> check -> review -> triage -> revise -> verify -> export
```

It is deliberately not an AI book generator. The product direction is local CI
for prose: contracts, checks, issues, revision trails, evidence gates, and
release workflow for serious writing.

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

There is also an install-anywhere alpha for external writing repos. It is tested
from a packed local package, but npm registry publishing remains disabled until
global/registry smokes and the remaining model-heavy commands are ready.

```bash
mkdir my-whitepaper
cd my-whitepaper
npm init -y
npm install -D /path/to/manuscript-lab-0.5.0.tgz
npx mlab init --profile whitepaper --root manuscript --title "My Whitepaper"
npx mlab validate
npx mlab status
npx mlab compose draft/01-opening.md
npx mlab check --static-only draft/01-opening.md
npx mlab claims list --json
npx mlab citations check --json
npx mlab gate draft/01-opening.md --json
npx mlab report --write
npx mlab export --formats md,html --include-todo --slug my-whitepaper
npx mlab done:no-export
```

Install-anywhere init writes `manuscript-lab.config.json` plus user-owned files
under `manuscript/`. It does not copy package `scripts/`, `checks/`, `reviews/`,
`.pi/`, or `skills/` into the caller workspace.

The v0.5 install-anywhere surface covers deterministic local work: validate,
status, compose, static checks, claims/citations/evidence, gates,
reports, `review:report`, `done:no-export`, and Markdown/HTML export. Full
typed review execution, candidate revisions, template project switching, and full
EPUB/PDF-oriented `done` remain template-first while the installed CLI matures.

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
- `docs/FILE_PROTOCOL.md`: draft protocol v1 for project layout and config
- `docs/INSTALL_WORKFLOW.md`: npm/install-anywhere design record
- `docs/GATE_ENGINE.md`: readiness gate design and result format
- `docs/EVIDENCE_SPINE.md`: claims and sources design
- `examples/technical-whitepaper/README.md`: public tutorial fixture
- `docs/OPEN_SOURCE_READINESS.md`: current public-readiness gap list
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

## License

MIT. See `LICENSE`.
