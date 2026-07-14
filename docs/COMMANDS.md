# Command Reference

This is the full reference for the `mlab` / `manuscript-lab` CLI as of v2.0.0.
`mlab --help` shows the same six groups with one line per command;
`mlab help <command>` (or `mlab <command> --help`) prints per-command detail;
`mlab help admin` prints template-clone admin commands.

Every command name that worked before v2 still works — see
[Compatibility aliases](#compatibility-aliases).

## Start

| Command | Does | Key flags |
| --- | --- | --- |
| `mlab init` | Create a config-first workspace in the current directory. Bare `init` outside a template clone defaults to `--profile whitepaper --root manuscript` with the title cased from the directory name. | `--profile <name>`, `--root <dir>`, `--title "..."` |
| `mlab adopt <file-or-dir>` | Import existing markdown into a new contracted workspace. Copies sources verbatim into `draft/NN-slug.md` sections with inferred contracts; never modifies or moves originals. Refuses if `manuscript-lab.config.json` already exists. | `--split file\|h1\|h2`, `--root <dir>`, `--title "..."`, `--profile <name>`, `--dry-run`, `--json` |
| `mlab doctor` | Diagnose environment, provider keys, and release health. | `--no-network`, `--json` |
| `mlab validate` | Validate the file protocol and workspace discovery. | `--json` |

## Daily loop

| Command | Does | Key flags |
| --- | --- | --- |
| `mlab status` | Cockpit view: sections, issues, runs, artifacts, next steps. | `--json` |
| `mlab compose draft/<section>.md` | Build the runtime context packet for one section under `state/runtime/`. | |
| `mlab check [target]` | Run document checks. `--fix` creates every missing required scaffolding path (state dirs, README stubs, `state/truth/*.json`), then re-runs the static checks. | `--static-only`, `--fix`, `--model-checks`, `--model <provider/model>` |
| `mlab review <target>` | Run typed review passes; findings land as issues in the ledger. `mlab review report <target>` summarizes latest runs. | `--panel <id>`, `--passes <ids>`, `--dry-run` |
| `mlab issues` | List and triage typed issues. | `list --status open`, `--target <path>`, `--json` |
| `mlab revise <target>` | Generate candidate revisions for an accepted issue. | `--issue <id>`, `--candidates <n>`, `--dry-run` |
| `mlab compare <target>` | Blind pairwise comparison of a candidate run. | `--run <candidate-run-id>`, `--dry-run` |
| `mlab merge <target>` | Preview or apply the comparison winner, with audit trail. | `--run <candidate-run-id>`, `--apply`, `--audit` |
| `mlab gate <target>` | Evaluate a readiness gate: `draft/*.md` infers `section-ready`; `citation`, `manuscript`, and `export` name the other gates. | `--json`, `--write`, `--static-only`, `--profile <name>` |
| `mlab report` | One-page readiness report (terminal, JSON, HTML). Every blocker carries a `fix:` command; failing sections are listed individually with reasons. | `--write`, `--json` |

## Evidence

| Command | Does | Key flags |
| --- | --- | --- |
| `mlab claims` | Inspect the claim register. | `list --unsupported`, `--section <path>`, `--json` |
| `mlab citations check [target]` | Check citation markers, placeholders, and source resolution. Shares one implementation with the citation gate, so the two can never disagree. | `--json` |
| `mlab sources add <path>` | Register a local source file in `sources/index.md`. | |
| `mlab evidence report` | Combined claims/citations/sources report with `evidence.*` requirement rollups. | `--json` |

## Ship

| Command | Does | Key flags |
| --- | --- | --- |
| `mlab export` | Export reader copies plus `exports/manifest.json` with input/output hashes. Default formats: `md,html`. EPUB needs `zip`; PDF needs `python3` + `reportlab`. | `--formats md,html,epub,pdf`, `--slug <slug>`, `--out <dir>`, `--no-contents`, `--include-todo` |
| `mlab done` | Final release gate: regenerates exports, then verifies manuscript and export readiness. `--skip-exports` is the maintenance form (alias: `done:no-export`). | `--skip-exports`, `--export-formats <list>`, `--include-todo-exports`, `--json` |

## Agents

| Command | Does | Key flags |
| --- | --- | --- |
| `mlab mcp` | Run the zero-dependency MCP server over stdio, exposing the protocol as typed tools. See `docs/MCP.md`. | `--read-only`, `--all-tools`, `--root <dir>` |

## Lab

R&D commands live under `mlab lab`. `mlab lab --help` (or bare `mlab lab`)
lists them. The old top-level names remain as aliases.

| Command | Does |
| --- | --- |
| `mlab lab room <sub> <target>` | Writers' room protocol: `diagnose`, `blue-sky`, `decide`, `break`, `table-read`, `report` under `state/room/`. |
| `mlab lab chorus <sub> <target>` | Prose line lab: `plan`, `run`, `sample`, `judge`, `assemble`, `report` under `state/chorus/`. |
| `mlab lab practice <sub>` | Creative-writing practice loops: `propose`, `compare`, `bench`, `strategies` under `state/practice*/`. |
| `mlab lab drive` | Bounded model-driver loop over the tool catalog, persisted under `state/driver/`. |
| `mlab lab eval practice-strategies` | Snapshot strategy-comparison evidence under `state/evals/`; `--fail-on-regression` for CI. |
| `mlab lab artifacts` | List and inspect generated run artifacts (`list`, `inspect --run <id>`). |
| `mlab lab golden-path` | Print or persist the first-use onboarding sequence. |
| `mlab lab taste <target> --run <id>` | Taste-arbiter gate for candidate runs. |
| `mlab lab style <target>` | Style calibration signals. |
| `mlab lab words <target>` | Word-usage report. |
| `mlab lab model smoke\|capabilities\|calls` | Provider smoke test, capability probe, and model-call audit report. |

## Compatibility aliases

All pre-2.0 command names keep working. Canonical v2 forms:

| Old name | v2 form |
| --- | --- |
| `room` | `lab room` |
| `chorus` | `lab chorus` |
| `practice` | `lab practice` |
| `drive` | `lab drive` |
| `eval` | `lab eval` |
| `artifacts` | `lab artifacts` |
| `golden-path` | `lab golden-path` |
| `taste:arbiter` | `lab taste` |
| `style:signals` | `lab style` |
| `words` | `lab words` |
| `model:smoke` | `lab model smoke` |
| `model:capabilities` | `lab model capabilities` |
| `model:calls` | `lab model calls` |
| `review:run` | `review` |
| `review:report` | `review report` |
| `revise:candidates` | `revise` |
| `compare:candidates` | `compare` |
| `merge:winner` | `merge` |
| `diff:audit` | `audit` |
| `done:no-export` | `done --skip-exports` |

`audit`, `new`, `project:*`, and `story:*` also keep working; `new`,
`project:*`, and `story:*` are template-clone admin commands (listed by
`mlab help admin`) and refuse outside a template clone root.

## npm scripts (template clones)

Template clones expose the same commands as npm scripts. `npm run <name> -- <args>`
maps to `mlab <name> <args>` for: `validate`, `status`, `compose`, `check`,
`doctor`, `gate`, `report`, `issues`, `claims`, `citations`, `sources`,
`evidence`, `export`, `done`, `done:no-export`, `room`, `chorus`, `practice`,
`drive`, `eval`, `artifacts`, `golden-path`, `words`, and the compatibility
names `review:run`, `review:report`, `revise:candidates`,
`compare:candidates`, `merge:winner`, `diff:audit`, `taste:arbiter`,
`style:signals`, `model:smoke`, `model:capabilities`, `model:calls`.

Examples:

```bash
npm run check -- --static-only
npm run gate -- draft/01-opening.md
npm run report -- --write
npm run review:run -- --panel prose.clean draft/01-opening.md
```

Removed in 2.0 (use the flag or surviving script instead):
`done:json` -> `npm run done -- --json`,
`check:list` -> `npm run check -- --list-model-checks`,
`check:static` -> `npm run check -- --static-only`,
`story:init` -> `npm run project:init`,
`story:restore` -> `npm run project:restore`,
`story:unload` -> `npm run story -- unload`, and the per-domain `*:test`
scripts (`model:json-test`, `model:response-test`, `project:test`,
`style:test`, `taste:test`, `words:test`) -> `npm test`.

Template-clone project administration (`project:init`, `project:sync`,
`project:list`, `story:archive`, and friends) stays npm-script and
`mlab help admin` territory; installed workspaces do not need it.
