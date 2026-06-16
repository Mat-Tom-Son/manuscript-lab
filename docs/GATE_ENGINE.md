# Gate Engine

The gate engine is the readiness layer for Manuscript Lab. It turns existing
checks, issue state, runtime packet state, claim/source state, and export state
into named, repeatable decisions with machine-readable evidence.

The engine does not score literary quality or claim that a manuscript will
succeed with readers. It answers a narrower question: does this target satisfy
the configured readiness standard, and what evidence supports that answer?

## Design Goals

- Make section, manuscript, citation, and export readiness explicit.
- Keep every blocking decision auditable, with stable requirement IDs.
- Prefer deterministic checks before optional model-backed checks.
- Produce artifacts that humans, agents, CI jobs, and future UIs can read.
- Let `npm run done` reuse the same primitives without losing its role as the
  final operator handoff command.
- Allow human overrides only when they are deliberate, scoped, visible, and
  recorded.

## Core Concepts

Gate:
  A named readiness contract, such as `section-ready`, `manuscript-ready`,
  `citation-ready`, or `export-ready`.

Target:
  The thing being gated. Examples: one section file, the active manuscript, the
  current citation graph, or an export set.

Requirement:
  A stable check inside a gate. Each requirement has an ID, severity, sensor,
  expected result, and evidence payload.

Sensor:
  The implementation that observes a requirement. Initial sensors should wrap
  existing deterministic scripts and files, such as static doccheck, status JSON,
  runtime packet traces, issue ledger state, review error scans, and export file
  manifests.

Profile:
  A named strictness level for the same gate. Examples: `draft`, `default`,
  `release`, and `ci`. Profiles change included requirements and severities
  without changing the gate ID.

Result artifact:
  The persisted decision for one gate run. It records the config, target hashes,
  requirement outcomes, overrides, warnings, errors, and final readiness.

Override:
  A human decision to accept a known failed requirement for a scoped target.
  Overrides are not hidden passes; the result remains visibly overridden.

## Gate Config

Gate configs should be YAML or JSON files. Template configs can live under
`templates/gates/`; project-local configs can later live under `gates/` or be
passed with `--config`.

Config loading order should be:

1. Built-in default for the requested gate ID.
2. Template or project config selected by `--config`.
3. Profile selected by `--profile`.
4. CLI flags that only narrow execution, such as `--static-only` or
   `--format`.

Stable requirement IDs are part of the public contract. Rename them only with a
migration path, because result artifacts, CI annotations, and overrides refer to
them.

Minimal shape:

```yaml
gate:
  schema_version: manuscript-lab.gate-config.v1
  id: section-ready
  version: 1
  scope: section
  applies_to:
    include:
      - draft/*.md
  profiles:
    default:
      requires:
        - id: contract.valid
          severity: block
          sensor: section_contract
        - id: runtime.fresh
          severity: block
          sensor: runtime_packet
        - id: issues.no_blockers
          severity: block
          sensor: issue_ledger
      warns:
        - id: reviews.latest_clean
          severity: warn
          sensor: review_errors
  overrides:
    allowed: true
    require_reason: true
    require_actor: true
    max_age_days: 14
```

Recommended top-level fields:

| Field | Purpose |
| --- | --- |
| `schema_version` | Identifies the config schema. |
| `id` | Stable gate ID. |
| `version` | Gate config version, incremented for behavior changes. |
| `scope` | `section`, `manuscript`, `citation`, `export`, or future scopes. |
| `applies_to` | Path globs or named targets the gate can evaluate. |
| `profiles` | Requirement sets and severity changes by use case. |
| `requires` | Blocking or advisory requirements for a profile. |
| `overrides` | Policy for deliberate human override. |

Requirement fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable requirement ID, namespaced by domain. |
| `severity` | `block`, `warn`, or `info`. |
| `sensor` | Engine sensor or script wrapper. |
| `when` | Optional condition, such as `status != todo`. |
| `expected` | Machine-readable threshold or predicate. |
| `depends_on` | Other requirement IDs that must run first. |
| `message` | Human-readable failure summary. |

## Result Artifact Shape

The engine should write immutable run artifacts and update a latest pointer:

```text
state/gates/
  runs/<run-id>.json
  latest/<scope>/<target-id>/<gate-id>.json
  overrides/<override-id>.json
```

`target-id` is a filesystem-safe ID derived from the target path or named scope,
such as `draft-04-market` or `manuscript`.

Result JSON shape:

```json
{
  "schema_version": "manuscript-lab.gate-result.v1",
  "run_id": "gate-2026-06-16T15-04-05Z-section-ready-draft-04-market",
  "gate_id": "section-ready",
  "gate_version": 1,
  "profile": "default",
  "scope": "section",
  "target": {
    "kind": "section",
    "path": "draft/04-market.md",
    "id": "04-market",
    "sha256": "..."
  },
  "command": "mlab gate draft/04-market.md --profile default --write",
  "started_at": "2026-06-16T15:04:05.000Z",
  "finished_at": "2026-06-16T15:04:06.000Z",
  "status": "fail",
  "ready": false,
  "exit_code": 1,
  "summary": {
    "passed": 7,
    "failed": 1,
    "warnings": 1,
    "skipped": 0,
    "overridden": 0
  },
  "requirements": [
    {
      "id": "runtime.fresh",
      "severity": "block",
      "status": "fail",
      "deterministic": true,
      "sensor": "runtime_packet",
      "message": "Runtime packet is stale for draft/04-market.md.",
      "evidence": {
        "paths": [
          "state/runtime/04-market/trace.json"
        ],
        "observed": "stale",
        "expected": "fresh"
      }
    }
  ],
  "overrides": [],
  "input_hashes": {
    "config": "...",
    "target": "...",
    "status": "...",
    "issue_ledger": "..."
  },
  "warnings": [],
  "errors": []
}
```

Gate status values:

| Status | Meaning |
| --- | --- |
| `pass` | All blocking requirements passed. |
| `pass_with_warnings` | Blocking requirements passed and advisory findings remain. |
| `fail` | At least one blocking requirement failed. |
| `overridden` | Blocking failures were deliberately overridden and `ready` is true only because overrides were allowed for this run. |
| `error` | The engine, config, or sensor failed before producing a trustworthy decision. |

Requirement status values:

| Status | Meaning |
| --- | --- |
| `pass` | Requirement satisfied. |
| `fail` | Requirement observed and not satisfied. |
| `warn` | Advisory requirement observed and not satisfied. |
| `skip` | Requirement intentionally not applicable. |
| `overridden` | Blocking failure accepted by a matching override. |
| `error` | Sensor could not produce a trustworthy observation. |

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Ready: `pass`, `pass_with_warnings`, or allowed `overridden`. |
| `1` | Not ready: one or more blocking requirements failed. |
| `2` | Engine/config/sensor error. |

## Initial Gates

### `section-ready`

Use this gate when deciding whether one section can move forward in the workflow
or be included in manuscript readiness.

Initial deterministic requirements:

- `contract.present`: the section has a parseable contract.
- `contract.valid`: required contract fields are present and valid.
- `contract.check_ids_exist`: every listed check ID exists in `checks/suite.json`.
- `contract.review_ids_exist`: every listed review ID exists in `reviews/suite.json`.
- `status.synced`: section contract status matches `state/status.md` when that
  file is present.
- `content.nonempty_when_active`: non-`todo` sections contain real prose.
- `word_count.in_band`: `done` sections satisfy the contract word-count band.
- `runtime.fresh`: non-`todo` sections have a fresh runtime packet.
- `doccheck.static_pass`: static document checks pass for the target.
- `issues.no_blockers`: no open or deferred blocker issues target the section.
- `reviews.latest_clean`: latest required review runs have no persisted errors.

Optional profile requirements:

- `claims.no_placeholders`: no `[citation-needed]` markers remain.
- `candidates.audited`: candidate-based accepted issues have a merge/audit trail.
- `taste.gate_applyable`: required taste arbiter results allow apply.

### `citation-ready`

Use this gate for nonfiction or research-heavy projects, either for a section or
for the whole manuscript.

Initial deterministic requirements:

- `claims.no_empty_placeholders`: no empty citation placeholders remain.
- `claims.no_unsupported_markers`: unsupported factual claims are absent or
  explicitly tracked.
- `claims.source_keys_exist`: claim source keys match entries in
  `sources/index.md`.
- `sources.index_valid`: source records have stable keys and usable locations.
- `sources.no_missing_files`: local source paths referenced by the index exist.

Model-backed claim extraction can become a sensor later, but the first version
should gate only structured state and explicit markers unless a profile opts in.

### `manuscript-ready`

Use this gate before export or release-oriented review.

Initial deterministic requirements:

- `project.required_files_present`: core project files required by the workspace
  exist.
- `outline.sections_resolve`: active outline entries map to section files or
  intentional non-draft entries.
- `sections.ready`: every active non-`todo` section passes `section-ready`.
- `citations.ready`: citation requirements pass when the profile enables them.
- `runtime.all_fresh`: active sections have fresh runtime packets.
- `issues.none_open_or_deferred`: no open or deferred issues remain unless the
  profile explicitly allows advisory debt.
- `reviews.no_latest_errors`: persisted latest review runs have no errors.
- `project.filesystem_verified`: the active project workspace verifies.
- `harness.context_clean`: strict context hygiene audit passes.
- `harness.templates_clean`: strict template audit passes.

### `export-ready`

Use this gate after export generation and before treating exported files as
reader-facing release artifacts.

Initial deterministic requirements:

- `manuscript.ready`: the manuscript passed the configured manuscript gate.
- `export.command_passed`: the export command completed successfully.
- `export.formats_present`: required formats exist, such as Markdown, HTML,
  EPUB, and PDF.
- `export.files_nonempty`: required export files are nonempty.
- `export.generated_after_inputs`: exports are newer than the source inputs or
  match the export manifest input hashes.
- `export.manifest_present`: the export manifest is present and parseable.
- `export.no_dirty_override`: exports created with overrides are visibly marked
  dirty in the result or manifest.

## Deterministic Checks First

The first engine implementation should be deterministic by default. Good initial
sensor inputs are:

- `scripts/doccheck.mjs --static-only`
- `scripts/harness-status.mjs --json`
- `scripts/template-audit.mjs --strict`
- `scripts/context-audit.mjs --strict`
- `scripts/story-workspace.mjs verify-projects --json`
- `state/runtime/*/trace.json`
- `state/issues/issue-ledger.json`
- `state/reviews/`
- `state/claims.md`
- `sources/index.md`
- `exports/`

Model-backed checks may be represented in results only when the profile asks for
them. If a required model check cannot run because credentials are missing, the
requirement should be `fail` or `skip` according to profile policy, never a
silent pass. Cached model-check results should record the input hash they cover.

## Overrides

Overrides should be explicit artifacts, not flags that erase evidence.

Recommended override shape:

```json
{
  "schema_version": "manuscript-lab.gate-override.v1",
  "override_id": "override-2026-06-16-001",
  "created_at": "2026-06-16T15:20:00.000Z",
  "created_by": "human",
  "gate_id": "export-ready",
  "target": {
    "kind": "export",
    "id": "manuscript"
  },
  "requirements": [
    "export.generated_after_inputs"
  ],
  "reason": "Preview build requested before final PDF tooling is installed.",
  "expires_at": "2026-06-23T15:20:00.000Z",
  "target_sha256": "..."
}
```

Rules:

- Overrides require actor, reason, target, requirement IDs, and expiry.
- Overrides should be scoped to the target hash when a hash exists.
- Overrides can convert `fail` to requirement status `overridden`, but the final
  gate status must be `overridden`, not `pass`.
- Engine/config errors cannot be overridden.
- CI should ignore overrides by default unless `--allow-overrides` is passed.
- Export manifests should record whether an export was produced from an
  overridden gate.

## CLI Target

Target command surface:

```bash
mlab gate draft/04-market.md
mlab gate section draft/04-market.md --profile release
mlab gate citation draft/04-market.md
mlab gate citation manuscript
mlab gate manuscript --profile ci --static-only
mlab gate export --formats md,html,epub,pdf --write
```

Recommended flags:

| Flag | Purpose |
| --- | --- |
| `--profile <name>` | Select config profile. |
| `--config <path>` | Load a specific gate config. |
| `--json` | Print result JSON to stdout. |
| `--write` | Persist result artifacts under `state/gates/`. |
| `--static-only` | Disable live model-backed sensors. |
| `--allow-overrides` | Apply matching override artifacts. |
| `--no-overrides` | Refuse overrides even if config allows them. |
| `--format <list>` | Limit export formats for export gates. |
| `--ci` | Shorthand for JSON output, deterministic sensors, no interactive prompts, and no overrides. |

The command should infer `section-ready` when passed `draft/*.md`, infer
`manuscript-ready` for `manuscript`, and infer `export-ready` for `export`.
Explicit subtargets stay available for clarity.

## Relation To The Existing Done Gate

`npm run done` remains the final operator handoff command. It currently
regenerates exports, runs static document checks, strict template and context
audits, checks runtime freshness through status JSON, checks issue/review error
state, syncs the active project workspace, verifies the project filesystem, and
requires reader exports.

The gate engine should extract those checks into reusable named requirements.
The done gate can then become a small orchestrator:

```text
npm run done
-> sync project workspace
-> regenerate exports
-> mlab gate manuscript --profile done --write
-> mlab gate export --profile done --write
-> print a short human handoff summary
```

`npm run done:no-export` should keep its maintenance role. It can map to a
profile that skips export requirements while still running harness hygiene,
project filesystem verification, static checks, runtime freshness, and issue
state requirements.

This preserves the current user-facing habit while making readiness reusable by
agents, CI jobs, export commands, and future UIs.

## CI Integration

CI should run deterministic gates without secrets:

```yaml
- name: Gate manuscript
  run: npx mlab gate manuscript --profile ci --static-only --json --write

- name: Build exports
  run: npx mlab export --formats md,html

- name: Gate exports
  run: npx mlab gate export --profile ci --formats md,html --json --write
```

CI recommendations:

- Use exit code `1` for readiness failures and `2` for engine errors.
- Upload `state/gates/runs/*.json` as build artifacts.
- Do not require live model checks unless the workflow explicitly provides
  provider credentials.
- Prefer `--static-only` for pull requests from forks.
- Comment on pull requests from result artifacts, not from ad hoc console text.
- Treat overridden results as failures by default in CI unless the workflow
  deliberately passes `--allow-overrides`.

## Implementation Edges

Follow-up implementation can be split cleanly:

1. Add config loader and schema validation.
2. Add deterministic sensors for status, doccheck, runtime packets, issues,
   review errors, exports, and project verification.
3. Add result writer and latest pointer update.
4. Add `mlab gate` CLI routing and exit codes.
5. Refactor `scripts/done-gate.mjs` to consume gate primitives.
6. Add export gate enforcement on top of the existing export manifest.
7. Add optional model-backed sensors behind explicit profiles.
