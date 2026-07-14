# Model Driver

> Status: design record. Ships as lab R&D via `mlab lab drive`. Current surface: docs/COMMANDS.md.

Status: V1 bounded loop shipped with resume-safe persisted runs, read-only
artifact inspection, and approval-gated practice prose proposals, comparisons,
benchmarks, strategy comparisons, and eval snapshots.

The model driver is the orchestration layer for Manuscript Lab. It puts a
model in the operator seat while keeping the durable product boundary intact:
the model chooses from Manuscript Lab primitives, the CLI executes allowlisted
commands, and gates decide when the work is ready.

Short shape:

```text
human goal -> driver policy -> tool catalog -> model decision -> primitive run
-> artifact inspection -> next decision -> gate or stop
```

The feature should feel like an interactive command line tool for prompting a
smart project operator, not like an unrestricted shell, a chat transcript, or a
one-click book generator.

## Product Bet

Manuscript Lab already has the primitives:

- status, validation, runtime packets, and reports
- Room and Chorus option-generation workflows
- checks, reviews, issues, candidate revisions, comparisons, taste gates, and
  diff audits
- claims, citations, evidence reports, gates, exports, and done gates
- model-provider routing through OpenRouter, Lightning, and custom endpoints
- Pi prompts and skills that teach agents how to operate the harness

The next step is to let a model dynamically choose how to use those primitives
over a bounded run:

```text
observe what exists
decide the next useful primitive
run it
read the resulting files
adjust the plan
continue until a stop condition is met
```

This is different from asking a model to write a manuscript. The driver operates
the lab. Draft text and project state still live in files, and readiness still
comes from checks, issues, gates, and explicit human approvals.

## Requirements

- Provide an interactive CLI command for prompting the model.
- Expose Manuscript Lab primitives as a structured tool catalog.
- Let the model choose tools dynamically based on the goal, target, current
  project state, and artifacts from previous steps.
- Support bounded loops: max steps, budget limits, stop conditions, and
  resume-safe continuation of persisted run history.
- Work in both template-first and install-anywhere projects.
- Route model calls through `scripts/lib/model-provider.mjs`.
- Support OpenRouter models through provider-prefixed IDs such as
  `openrouter:z-ai/glm-5.2`.
- Record every non-dry-run decision, command, output summary, and artifact path
  in project state by default.
- Preserve the Pi adapter idea: Pi-style prompts and skills can teach policy,
  but the CLI primitives remain the execution boundary.
- Require approval for irreversible or high-impact actions.

## Non-Goals

- Do not give the model arbitrary shell access.
- Do not make the model a final judge of manuscript quality.
- Do not silently edit `draft/` outside existing revision primitives.
- Do not bypass issue triage, candidate comparison, taste gates, or done gates.
- Do not require Pi, Codex, or any specific agent UI to use the core feature.
- Do not store API keys, model choices, or private project facts in package docs
  or reusable prompts.

## Command Shape

Primary command:

```bash
mlab drive
mlab drive --goal "prepare draft/01-opening.md for review" --target draft/01-opening.md
mlab drive --goal "find the safest next move" --model openrouter:z-ai/glm-5.2 --max-steps 8
mlab drive --interactive --policy pi
```

NPM script compatibility:

```bash
npm run drive -- --goal "prepare the manuscript for a reader export"
```

Useful flags:

| Flag | Purpose |
| --- | --- |
| `--goal <text>` | The operator objective for the run. |
| `--target <path-or-scope>` | Optional section, manuscript, citation graph, export, or project target. |
| `--model <provider:model>` | Model used for driver decisions. Defaults should be explicit in docs, not hidden in `.env`. |
| `--policy <name>` | Driver policy pack, such as `default`, `pi`, `review-only`, or `release`. |
| `--mode <name>` | `advise`, `operate`, or `ci`. |
| `--max-steps <n>` | Hard cap on loop iterations. Defaults to 4 for model-backed runs and 1 for heuristic runs. |
| `--max-model-calls <n>` | Hard cap on model-backed primitive calls plus driver calls. |
| `--budget-cents <n>` | Optional soft cost budget for provider-backed runs. |
| `--approve <mode>` | `ask`, `never`, or `always-safe`. Default: `ask`. |
| `--dry-run` | Ask the model for decisions and show intended commands without executing mutating actions. |
| `--write` | Persist a dry run under the configured state directory. Non-dry-run driver runs persist by default. |
| `--no-write` | Ephemeral advisory run. Allows read-only primitive execution only; mutating primitives stop because there would be no durable driver ledger. Not allowed in `operate` or `ci`. |
| `--json` | Emit machine-readable summary output. |
| `--resume <run-id>` | Resume a persisted driver run under `state/driver/runs/`. The driver validates the same manuscript root, reloads prior plan steps, appends from the next step number, and treats `--max-steps` as an additional step budget. |
| `--config <path>` | Resolve the project with an explicit config path. |
| `--workspace <path>` | Resolve the project from an explicit workspace root. |

If no `--goal` is provided, `mlab drive` starts an interactive prompt:

```text
Manuscript Lab Driver
goal> prepare draft/01-opening.md for a clean review pass
driver> step 1/8: run status to inspect the current cockpit
approve? [enter=yes, n=no, e=edit, q=quit]
```

Interactive commands:

```text
/status       show current cockpit summary
/tools        list available primitives and permissions
/plan         show the current driver plan
/budget       show model calls, elapsed time, and step limits
/why          show the current action rationale and expected result
/last         show the previous decision and command result
/artifacts    show run artifacts and latest changed files
/approve      approve the current proposed action
/deny         reject the current proposed action and ask for another
/edit         edit the proposed action arguments before approval
/retry        ask the model for a new decision using the latest observation
/mode NAME    change between advise and operate when policy allows it
/target PATH  update the run target
/goal TEXT    update the run goal
/help         show available interactive commands
/stop         end the run and write a final report
/quit         alias for /stop
/resume ID    resume a saved run
```

## Driver Loop

Each loop iteration should be explicit and durable.

1. Discover the protocol with `discoverProtocol`.
2. Create a driver run under the configured state directory, or resume an
   existing run after validating that it belongs to the same manuscript root.
3. Observe the current project using read-only primitives.
4. Build a compact prompt from the goal, policy, tool catalog, latest plan, and
   recent artifacts.
5. Ask the model for one structured decision.
6. Validate the decision against the tool catalog and policy.
7. Ask for human approval when the action requires it.
8. Execute the primitive through a pinned package wrapper argv, never a shell
   command string.
9. Summarize stdout, stderr, exit code, changed artifact paths, and parsed JSON.
10. Append an event to the run ledger.
11. Stop, ask the user, or repeat.

The model should decide one step at a time. It can maintain a plan, but the CLI
should re-observe after every command because files and gates are the source of
truth.

Non-dry-run driver runs are durable by default. `--dry-run` stays ephemeral
unless paired with `--write`. Model-backed runs get a small default loop budget
so they can observe, act, re-observe, and stop; credential-free heuristic runs
still default to one safe action. `--resume` reloads prior plan steps, writes a
`resume.json` marker, appends new events, and never reinitializes the existing
run directory.

Every driver run should pin discovery metadata at start:

```json
{
  "mode": "installed",
  "package_root": "/repo/node_modules/manuscript-lab",
  "workspace_root": "/repo",
  "manuscript_root": "/repo/manuscript",
  "config_path": "/repo/manuscript-lab.config.json"
}
```

Those roots should be passed to primitive subprocesses with explicit
`--config`/`--workspace` support or equivalent environment pinning so a nested
cwd cannot silently change the target project mid-run.

## Trust Boundary

The driver prompt must separate trusted control text from untrusted project
content.

Trusted:

- driver system policy
- validated tool catalog
- permission/effects matrix
- operator-provided goal, mode, model, budget, and approval settings
- package-owned policy manifests

Untrusted:

- manuscript draft text
- sources and imported research
- runtime packet content
- review output, room/chorus artifacts, issue text, model responses, and prior
  rationales
- project-local overrides unless explicitly declared as policy files

The model's rationale is advisory text. The CLI validates only the structured
decision against schemas, effects, roots, allowlists, budgets, and approval
state. Prompt text inside manuscripts, sources, or artifacts must never expand
the tool catalog or change policy.

## Path Fence

Model-supplied paths must be portable project-relative paths unless a specific
tool schema declares another safe identifier such as a run ID, issue ID, card ID,
or export format.

Driver validation should reject:

- absolute paths
- Windows drive paths and UNC paths
- backslashes
- `..` traversal
- paths outside `manuscriptRoot` after `realpath` resolution
- draft targets that do not match the configured draft glob when the tool
  expects a section
- output paths outside declared state/export directories

Existing generic helpers such as `protocolPaths.resolveProjectInput` may accept
absolute paths for human-operated commands. The driver needs a stricter
resolver before argv construction.

## Decision Protocol

The driver should request structured JSON from the model. It should use the
same JSON normalization and provider fallback behavior as the rest of the
harness.

Example decision:

```json
{
  "schema_version": "manuscript-lab.driver-decision.v1",
  "action": "run_tool",
  "tool_id": "compose.section",
  "args": {
    "target": "draft/01-opening.md"
  },
  "rationale": "The target section has no fresh runtime packet, and downstream review should use composed context.",
  "expected_result": "state/runtime/01-opening/trace.json exists and is fresh",
  "approval": {
    "required": false,
    "reason": ""
  },
  "stop_condition": "continue_after_success"
}
```

Allowed action types:

| Action | Meaning |
| --- | --- |
| `run_tool` | Execute one allowlisted Manuscript Lab primitive. |
| `ask_user` | Ask for a missing decision, approval, or project fact. |
| `update_plan` | Revise the driver plan without running a command. |
| `summarize` | Produce an interim human-readable summary. |
| `stop` | End the run with a status, blockers, and recommended next move. |

The driver should reject decisions that name unknown tools, include shell
fragments, use absolute paths outside the project, exceed policy permissions, or
try to mutate protected files without approval.

The decision schema should never allow a model to select arbitrary providers,
endpoints, commands, environment variables, or filesystem roots. Model-backed
tools may use only operator-approved rosters, panels, or model aliases from the
run policy. Custom-provider routes require explicit human approval because they
may send project context outside the default provider path.

## Tool Catalog V1

The first tool catalog should be executable data, not prose command strings.
Each entry should define:

- stable `tool_id`
- command argv array builder routed through
  `discovery.packageRoot/bin/manuscript-lab.mjs`
- input schema
- composable effects
- approval requirement
- allowed model roster or panel, when model-backed
- expected artifact paths
- JSON parsing strategy
- installed-mode support

Implementation target:

```json
{
  "tool_id": "compose.section",
  "public_command": "mlab compose <section>",
  "argv": ["compose", "<section>", "--json"],
  "input_schema": {
    "section": "project_relative_draft_path"
  },
  "effects": ["reads_project", "writes_state"],
  "approval": "auto_in_operate",
  "json_output": "required",
  "artifact_roots": ["state/runtime/<section-id>/"],
  "available_in": ["template", "installed"]
}
```

Initial catalog candidates:

| Tool ID | Command Shape | Effects / Approval |
| --- | --- | --- |
| `validate.project` | `mlab validate --json` | `reads_project` |
| `status.project` | `mlab status --json` | `reads_project` |
| `report.project` | `mlab report --json` | `reads_project` |
| `gate.target` | `mlab gate <target> --json --write` | `reads_project`, `writes_state` |
| `compose.section` | `mlab compose <section> --json` | `reads_project`, `writes_state` |
| `check.static` | `mlab check --static-only --json <target>` | `reads_project` |
| `claims.list` | `mlab claims list --json` | `reads_project` |
| `citations.check` | `mlab citations check --json <target>` | `reads_project` |
| `evidence.report` | `mlab evidence report --json` | `reads_project` |
| `issues.list` | `mlab issues list --json` after JSON support exists | `reads_project` |
| `issues.propose_decision` | driver-only proposal artifact | `reads_project`, `writes_state` |
| `issues.apply_decision` | `mlab issues decide <id> --decision <decision> --reason <reason>` after JSON support exists | `records_human_decision`, approval required |
| `review.run` | `mlab review <target> --panel <panel>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget` |
| `review.report` | `mlab review report <target>` | `reads_project` |
| `room.diagnose` | `mlab room diagnose <target> --json` | `reads_project`, `writes_state` |
| `room.blue_sky` | `mlab room blue-sky <target> --models <models> --json` | `reads_project`, `writes_state`, `calls_model`, `spends_budget` |
| `room.propose_decision` | driver-only proposal artifact | `reads_project`, `writes_state` |
| `room.apply_decision` | `mlab room decide <target> --run <run-id> --select <card> --reason <reason> --json` | `records_human_decision`, approval required |
| `room.break` | `mlab room break <target> --run <run-id> --json` | `reads_project`, `writes_state` |
| `room.table_read` | `mlab room table-read <target> --json` | `reads_project`, `writes_state` |
| `room.report` | `mlab room report <target> --json` | `reads_project` |
| `chorus.run` | `mlab chorus run <target> --models <models> --json` | `reads_project`, `writes_state`, `calls_model`, `spends_budget` |
| `chorus.report` | `mlab chorus report <target>` | `reads_project` |
| `revise.candidates` | `mlab revise <target> --issue <issue-id> --candidates <n>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget` |
| `compare.candidates` | `mlab compare <target> --run <run-id>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget` |
| `taste.arbiter` | `mlab taste:arbiter <target> --run <run-id>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget` |
| `merge.preview` | `mlab merge <target> --run <run-id>` | `reads_project` |
| `merge.apply` | `mlab merge <target> --run <run-id> --apply --audit` | `writes_draft`, `writes_state`, approval required |
| `practice.propose` | `mlab practice propose --exercise <exercise> --model <driver-model>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget`, approval required |
| `practice.compare` | `mlab practice compare --exercise <exercise> --model <driver-model>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget`, approval required |
| `practice.bench` | `mlab practice bench --exercises <set> --models <driver-model> --seeds <n>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget`, approval required |
| `practice.strategies` | `mlab practice strategies --exercises <set> --strategies <list> --models <driver-model>` | `reads_project`, `writes_state`, `calls_model`, `spends_budget`, approval required |
| `artifacts.list` | `mlab artifacts list --kind <kind> --json` | `reads_project` |
| `artifacts.inspect` | `mlab artifacts inspect --run <run-id> --json` | `reads_project` |
| `eval.practice_strategies` | `mlab eval practice-strategies --from state/practice-strategies/<run-id> --json` | `reads_project`, `writes_state` |
| `golden_path.guide` | `mlab golden-path --json` | `reads_project` |
| `audit.diff` | `mlab audit --before <file> --after <file> --static-only` | `reads_project`, `writes_state` |
| `export.reader` | `mlab export --formats <formats>` | `writes_exports`, approval required |
| `done.no_export` | `mlab done:no-export --json` | `writes_state`, `touches_workspace`, approval required |
| `done.export` | `mlab done --json` | `writes_exports`, `touches_workspace`, approval required |

V1 should not include a generic "edit file" tool. Draft changes should flow
through accepted issues, candidate runs, merge previews, explicit apply, and
diff audits. A later version can add a patch-proposal primitive if it writes a
before snapshot and requires approval.

Tools whose underlying commands do not yet support JSON should either gain JSON
mode before entering the V1 catalog or remain unavailable to the driver. The
catalog should treat user-facing command names and internal `tool_id`s as
separate: users see `mlab room blue-sky`, while the model receives
`room.blue_sky`.

## Effects And Approval

Tool permissions should be composed from effects rather than assigned as one
coarse class.

| Effect | Meaning |
| --- | --- |
| `reads_project` | Reads project or package files. |
| `writes_state` | Writes generated state, reports, runtime packets, or review artifacts. |
| `writes_draft` | Changes manuscript prose or section contracts. |
| `writes_exports` | Writes reader-facing exports. |
| `calls_model` | Sends prompt/context to a configured model provider. |
| `spends_budget` | Consumes provider budget or rate-limit quota. |
| `records_human_decision` | Applies issue triage, room selections, overrides, or editorial decisions. |
| `touches_workspace` | Syncs, mounts, archives, restores, or otherwise changes workspace/project filesystem state. |
| `release_action` | Publishes, tags, pushes, or creates PRs. Not part of V1. |

Default mode behavior:

| Mode | Behavior |
| --- | --- |
| `advise` | Default interactive mode. The model can inspect and propose. Mutating tools require approval. |
| `operate` | The model can run read-only and deterministic generated-state tools inside step and budget limits. Human decisions, model calls, draft writes, exports, workspace changes, and release actions still ask. |
| `ci` | Non-interactive. If approval is required, the run stops with `needs_approval`. |

`--approve always-safe` means read-only plus deterministic generated-state writes
only. It excludes model calls, human decisions, draft writes, exports, workspace
changes, custom-provider egress, and release actions.

Human-decision tools such as issue triage and room selection should split into
proposal and apply phases. The model may propose a decision; applying it requires
durable approval.

Approval artifacts are mandatory for:

- `records_human_decision`
- `writes_draft`
- `writes_exports`
- `touches_workspace`
- `release_action`
- custom-provider or new-model egress
- final gates such as `done.export` and `done.no_export`

Approval artifacts should include normalized argv, target hash or source hash
when applicable, effect list, user approval text or mode, timestamp, run ID, and
step. On resume, approval is invalid if argv, target hash, effect list, run ID,
or permission class changed.

## Artifacts

Driver runs should live under the configured state directory:

```text
state/driver/
  runs/
    <run-id>/
      objective.md
      policy.json
      tool-catalog.json
      plan.json
      events.jsonl
      observations/
        step-001.json
      decisions/
        step-001.json
      command-results/
        step-001.json
      prompt-summaries/
        step-001.json
      approvals/
        step-004.json
      FINAL_REPORT.md
  latest.json
```

`events.jsonl` should be the append-only spine. Other files can be projections
or step details.

Event shape:

```json
{
  "schema_version": "manuscript-lab.driver-event.v1",
  "run_id": "driver-2026-06-18T20-41-12Z",
  "step": 3,
  "type": "tool_result",
  "tool_id": "compose.section",
  "target": "draft/01-opening.md",
  "exit_code": 0,
  "status": "pass",
  "artifacts": [
    "state/runtime/01-opening/trace.json"
  ],
  "summary": "Runtime packet composed for draft/01-opening.md.",
  "created_at": "2026-06-18T20:43:01.000Z"
}
```

Driver artifacts should store redacted prompt summaries by default, not exact
prompt/response text. Every driver decision event should include
`operation: driver.decision`, run ID, step, normalized decision, request hash,
response hash, and `model_call_id` or `model_call_path` when a live provider was
called. Exact prompt/response capture should continue to use the existing
model-call audit path for persisted driver runs. Ephemeral `--dry-run` and
`--no-write` driver runs should not force model-call audit artifacts.

Tool results should feed the next decision with compact parsed-result summaries
and artifact paths, not raw stdout. For example, a practice benchmark result can
surface the run directory, winner source, evaluated rows, error rows,
first-pass win rate, final win rate, and `RESULTS.md` path so the model can
choose whether to inspect, repair, widen, rerun with a different timeout/model
roster, or stop. A strategy-comparison result should additionally surface
`STRATEGY_REPORT.md`, per-strategy win/cost/error summaries, and per-exercise
recommendations so the model can choose a loop shape from measured behavior
instead of assuming revision or repair is always worth the extra spend.

## Pi Policy Pack

Pi should be an adapter and teaching surface, not a separate execution engine.

The first driver policy packs can be:

```text
default
pi
review-only
release
```

`--policy pi` should compile compact doctrine from:

- package-owned driver policy manifests derived from `AGENTS.md`,
  `docs/OPERATOR_GUIDE.md`, `docs/PRIMITIVES.md`, `.pi/skills/`, and
  `.pi/prompts/`
- optional project-local policy supplements under the manuscript root, when
  explicitly configured

The compiled policy should teach the model how to use the harness, but actual
execution still goes through the tool catalog. The driver should not ask the
model to "run a Pi prompt" as a free-form instruction. It should translate the
intent into `mlab` primitives.

The driver should not ingest raw Pi prompts at runtime as trusted policy. Pi
prompt files are workflow entrypoints, and some of them describe mutating work.
The implementation should ship or generate a compact curated policy manifest
from package assets, then layer project-local supplements as untrusted or
explicitly opted-in policy.

Policy source precedence:

1. package-owned defaults from `packageRoot`
2. package-owned Pi policy manifest for `--policy pi`
3. explicit project-local policy supplement, if configured
4. operator goal and interactive instructions for the current run

Future Pi integration can add a prompt such as:

```text
/doc-drive prepare draft/01-opening.md for review
```

That prompt should call or instruct the operator to call:

```bash
mlab drive --policy pi --goal "prepare draft/01-opening.md for review" --target draft/01-opening.md
```

## Stop Conditions

The driver should stop when any of these are true:

- the model returns `stop`
- the user types `/stop`
- `--max-steps` is reached
- `--max-model-calls` or `--budget-cents` is reached
- a command fails repeatedly and the model has no new recovery action
- the next action requires approval in `ci` mode
- the requested gate passes
- `done` passes for the requested scope
- a blocker requires a human project decision

Final output should say:

- what the driver did
- what artifacts changed
- which checks or gates passed
- what remains blocked
- the safest next command

## Implementation Plan

### Phase 1: Deterministic Driver Shell

Deliverables:

- `scripts/model-driver.mjs`
- `scripts/lib/driver-tool-catalog.mjs`
- `scripts/model-driver.test.mjs`
- `npm run drive`
- `mlab drive`
- static executable tool catalog with argv arrays and JSON contracts
- `--goal`, `--target`, `--max-steps`, `--dry-run`, `--json`, and `--write`
- default artifact writer under `state/driver/` for non-dry-run runs
- `--mock-decision-file` or equivalent mock decision mode for tests

Acceptance:

- dry-run works without model credentials
- unknown tool IDs are rejected
- no arbitrary shell commands can execute
- artifacts stay under the configured manuscript root in installed mode
- `mlab drive --help` and `npm run drive -- --help` work before model-backed
  execution ships
- wrapper, package script, run-tests, CLI help, and installed-tarball smoke are
  updated in the same patch

### Phase 2: Interactive Model Decisions

Deliverables:

- interactive prompt loop
- OpenRouter-backed structured decision calls through `model-provider`
- JSON schema validation and repair through existing model JSON helpers
- read-only and write-state primitive execution
- concise human approval prompts
- strict path fence and trust-labeled prompt envelope

Acceptance:

- `mlab drive --interactive --model openrouter:z-ai/glm-5.2` can inspect a
  project and run a bounded status/compose/check loop
- every step writes an event
- failed model JSON produces a clear retry or error artifact

### Phase 3: Workflow-Aware Operation

Deliverables:

- Room, Chorus, review, issue, candidate, comparison, taste, and merge-preview
  tools in the catalog
- model-call and cost counters
- policy packs: `default`, `pi`, and `review-only`
- artifact inspection and eval snapshot tools
- JSON support for issue-ledger commands or removal of issue mutators from V1

Acceptance:

- the driver can choose between Room, Chorus, review, and candidate workflows
  based on goal and target state
- model-backed primitives count against budget and preserve provider metadata
- resume reconstructs plan, recent observations, and event history
- the driver can inspect generated artifacts before choosing new model-spending
  primitives

### Phase 4: Apply, Export, And Done Controls

Deliverables:

- approval-gated `merge.apply`, `export.reader`, `done.export`, and
  `done.no_export`
- final report projection
- installed-tarball smoke coverage
- docs and Pi prompt surface

Acceptance:

- no draft apply happens without approval
- stale candidate protections still come from `merge:winner`
- export and done results are linked in the final report
- packed install smoke proves driver artifacts stay in the caller workspace

## Tests

Initial tests should cover:

- tool catalog schema and duplicate IDs
- policy permission checks
- command argv construction
- path normalization for template and installed projects
- dry-run without provider keys
- mock model decisions for read-only and write-state loops
- approval refusal and `ci` stop behavior
- artifact layout under `state/driver/`
- wrapper routing through `bin/manuscript-lab.mjs`
- `mlab drive --help`
- `npm run drive -- --help`
- packlist hygiene
- installed-tarball smoke for `mlab drive --dry-run --json`
- installed-tarball smoke for `mlab drive --dry-run --write --json` from the
  workspace root, manuscript root, and nested draft directory, asserting
  `state/driver/` stays under the configured manuscript root
- resume appends step history without overwriting `step-001` artifacts
- artifact/eval/golden-path commands stay root-aware in installed smoke tests
- approval-required tools stopping with `needs_approval` in `ci`
- path-fence rejection for absolute, escaping, and wrong-root paths
- issue and room decision tools producing proposals unless approval is present
- mock decision files for deterministic CI without provider keys

When model-backed behavior is added, use mock provider responses in CI. Live
OpenRouter smoke should stay optional and explicit.

## Open Questions

1. Should the public command be only `mlab drive`, or should `mlab agent` remain
   as an alias?
2. Should the package ship a compact generated Pi policy file, or should it be
   generated during release from package-owned Pi prompts and skills?
3. Should long-running driver runs support parallel model-backed primitives, or
   should V1 stay strictly one action at a time?

## First Implementation Slice

The first valuable patch is not a full agent. It is:

```bash
mlab drive --goal "find the next useful command" --target draft/01-opening.md --dry-run --json
```

That slice should:

- discover the project
- write a dry-run shell under `state/driver/` only when `--write` is passed
- print the available tool catalog
- build the initial observation from `status` and `validate`
- produce a mock decision from a fixture or `--mock-decision-file`
- refuse anything outside the catalog
- show the exact command it would run next
- include wrapper routing, npm script routing, tests, installed-tarball smoke,
  context audit cleanliness, and pack dry-run

Once that is solid, the model can start driving real loops.

Current implemented slice:

- `scripts/model-driver.mjs`
- `scripts/lib/driver-tool-catalog.mjs`
- `scripts/lib/driver-policies.mjs`
- `npm run drive`
- `mlab drive`
- `mlab drive --help`
- dry-run and `--write` driver ledgers
- bounded step loops with per-step observations, decisions, command results,
  events, plan updates, and final reports
- heuristic, `--mock-decision-file`, `--mock-decision-json`, and live
  `--model <provider:model>` decisions through `model-provider`
- curated `default`, `pi`, `review-only`, and `release` policy packs
- enforced `review-only` allowlist
- approval-gated `practice.propose`, `practice.compare`, `practice.bench`, and
  `practice.strategies` tools for safe prose candidate generation,
  direct-vs-mlab benchmark evaluation, and measured loop-strategy selection
- read-only `artifacts.list`, `artifacts.inspect`, and `golden_path.guide`
  tools plus the generated-state `eval.practice_strategies` snapshot tool
- strict catalog/path validation before argv construction
- approval stops for draft/export/workspace/model-spending effects
- pinned `MLAB_WORKSPACE`/`MLAB_CONFIG` child command execution
- resume-safe continuation with same-root validation and append-only step
  numbering
- wrapper and installed-package smoke coverage
