# Manuscript Lab

[![npm version](https://img.shields.io/npm/v/manuscript-lab.svg)](https://www.npmjs.com/package/manuscript-lab)
[![GitHub release](https://img.shields.io/github/v/release/Mat-Tom-Son/manuscript-lab)](https://github.com/Mat-Tom-Son/manuscript-lab/releases/latest)
[![CI](https://github.com/Mat-Tom-Son/manuscript-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/Mat-Tom-Son/manuscript-lab/actions/workflows/ci.yml)

Manuscript Lab is local CI for prose.

It gives long-form writing what software takes for granted: section contracts,
checks, typed issues, revision trails, an evidence spine, and release gates —
all in plain files in your repo, driven by a zero-dependency Node CLI that
humans, agents, and CI jobs can share.

## Sixty-Second Start

Requires Node.js 18 or newer. No runtime dependencies.

Start clean:

```bash
npm install -D manuscript-lab
npx mlab init
```

Or adopt a manuscript you already have:

```bash
npx mlab adopt existing-draft.md
```

Then:

```bash
npx mlab status
npx mlab report --write
```

`init` scaffolds a contracted workspace: `manuscript-lab.config.json` plus a
`manuscript/` root with section contracts, state directories, and source/claim
registers (customize with `--profile`, `--root`, `--title`). `adopt` copies
every markdown file into contracted `draft/` sections without modifying or
moving your originals.

Expect a freshly adopted draft to report blockers — that is the point. Short
imported sections sit below the word floor, purposes are marked TODO, and
claims have no sources yet. The report names each gap and the exact command
that closes it, so "not ready" is a work list instead of a shrug.

## What You Get

- Section contracts: each `draft/*.md` opens with a machine-checked contract
  (status, target words, purpose, acceptance, checks, reviews).
- Checks: `mlab check` runs deterministic document checks;
  `mlab check --fix` creates any missing required scaffolding, then re-checks.
- Typed issues: reviews write durable work items to an issue ledger instead of
  advice that disappears in chat.
- Candidate trails: high-stakes revisions run as candidates, blind comparison,
  taste gate, merge winner, diff audit — never a silent rewrite.
- Evidence spine: claims, sources, and citation markers share one
  implementation across `claims`, `citations`, `evidence`, and the gates, with
  stable `evidence.*` requirement ids.
- Gates: `section-ready`, `citation-ready`, `manuscript-ready`, and
  `export-ready` decide readiness from evidence, not vibes. Sections marked
  `todo` block, and prose below 33% of a section's target word count blocks.
- Reports with fix commands: every blocker in `mlab report` (terminal, JSON,
  HTML) carries the command that addresses it. For example:

  ```text
  Blockers:
  - claim_unresolved: Claim "Documentation teams recover forty percent of
    review time after adopting local prose CI." is unsupported with
    unspecified risk and blocks release.
    fix: mlab claims list --unsupported
  ```

- Export manifests: `mlab export` writes Markdown and HTML by default plus
  `exports/manifest.json` with input/output hashes. EPUB and PDF are explicit
  opt-ins (`--formats md,html,epub,pdf`); EPUB needs `zip`, PDF needs
  `python3` with the `reportlab` package.

The full command reference is `docs/COMMANDS.md`.

## For Agents

Agents are the primary distribution surface. The fastest hookup is MCP:

```bash
claude mcp add manuscript-lab -- npx mlab mcp
```

`mlab mcp` is a zero-dependency MCP server over stdio that exposes the
protocol as typed tools with safety annotations. Claude Desktop and Cursor
snippets, exposure flags (`--read-only`, `--all-tools`, `--root`), and the
generated tool table live in `docs/MCP.md`.

`AGENTS.md` is the standing contract for agents working in a Manuscript Lab
repo. Codex users can install the repo's Codex skill with
`npm run codex:install-skill` (see `docs/CODEX_SKILLS.md`). A GitHub Action
for running reports in CI is documented in `docs/CI.md`.

## The Lab

Generation and orchestration features — writers' room, the Chorus line lab,
practice benchmarks, the model driver, eval snapshots, artifact inspection,
and the golden path — live under `mlab lab` (`mlab lab --help` lists them; the
old top-level names still work as aliases). They are contained R&D, not the
product promise: they write their evidence under `state/`, they never silently
rewrite drafts, and a lab feature graduates into the core surface only when a
real case study beats a solo frontier-model baseline on a real project. Until
then, the protocol is the product and the lab is where we try to earn the next
piece of it.

## Fixtures

Two public fixtures demonstrate both ends of the workflow:

- `examples/technical-whitepaper`: a complete project that ends green —
  `validate`, `check --static-only`, `gate manuscript`, and `report` all pass,
  with an accepted issue, candidate run, diff audit, and export manifest kept
  as revision-trail history.
- `examples/broken-whitepaper`: deliberately red. Its README lists every
  expected blocker and the `fix:` command each one carries, so you can see the
  failure UX without breaking your own project.

Fastest demo from a clone:

```bash
cd examples/technical-whitepaper
../../bin/manuscript-lab.mjs validate
../../bin/manuscript-lab.mjs report --write
```

## Model Providers

The core workflow is deterministic and needs no API keys. Model-backed checks,
reviews, and lab commands route through `scripts/lib/model-provider.mjs`,
which supports OpenRouter, Lightning AI, and custom OpenAI-compatible
endpoints. Copy `.env.example` to `.env` for keys and never commit `.env`.
See `docs/MODEL_PROVIDERS.md`.

## Docs

- `docs/COMMANDS.md`: full command reference, aliases, npm-script mapping
- `docs/GETTING_STARTED.md`: first-project walkthrough
- `docs/MCP.md`: MCP server setup and tool catalog
- `docs/CI.md`: GitHub Actions workflow and the composite action
- `docs/GATE_ENGINE.md`: readiness gates and result format
- `docs/EVIDENCE_SPINE.md`: claims and sources design
- `docs/ARCHITECTURE.md`: layers and file boundaries
- `docs/FILE_PROTOCOL.md`: project layout and config protocol
- `docs/PRODUCT_STRATEGY.md`: the decision of record and roadmap
- `docs/OPERATOR_GUIDE.md`: detailed operating manual

## License

MIT. See `LICENSE`.
