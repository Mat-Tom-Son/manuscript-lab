# File Protocol V1

Status: draft protocol target for install-anywhere Manuscript Lab projects.

This file defines the v1 project shape that future `mlab` commands should
validate. It also explains how the current template-first repository maps onto
that shape while the package-installed CLI is still being designed.

## Goals

File protocol v1 gives humans, agents, CLI commands, CI jobs, and future UIs a
stable way to find the manuscript, project state, generated artifacts, and
profile-specific policy without assuming that Manuscript Lab owns the repository
root.

The protocol must support two operating modes:

- template-first: the current repository layout, where reusable harness files
  live beside mounted project files
- install-anywhere: a future package-installed workflow where `mlab` runs inside
  an arbitrary writing repository

The protocol is not a prose format, editor format, or export format. Markdown
draft files remain ordinary files. The protocol defines where project artifacts
live and how tools should interpret them.

## Terms

- Config file: `manuscript-lab.config.json`.
- Config directory: the directory containing the config file.
- Project root: the directory named by `root` in the config. Project files live
  under this directory.
- Harness root: the current template repository root, or the installed package
  directory in install-anywhere usage. Harness files are not manuscript content.
- Profile: a named bundle of templates, default checks, review panels, gates,
  and export expectations.

Unless this document says otherwise, config paths use forward slashes and are
relative paths. `root` is relative to the config directory. All other path fields
are relative to the project root. Portable v1 config rejects absolute paths,
Windows drive paths such as `C:/...`, UNC paths, backslashes, and paths that
escape their owning root.

## Config Shape

The v1 config file is JSON.

```json
{
  "schemaVersion": 1,
  "profile": "whitepaper",
  "root": "manuscript",
  "draftGlob": "draft/*.md",
  "stateDir": "state",
  "exportsDir": "exports",
  "profileOptions": {}
}
```

### Required Fields

| Field | Type | Semantics |
| --- | --- | --- |
| `schemaVersion` | integer | Required. Must be `1` for this protocol. Tools must reject unsupported versions with a clear upgrade message rather than guessing. |
| `profile` | string | Required. Selects a profile such as `generic`, `fiction`, `whitepaper`, `technical`, or another installed profile. The profile changes policy, not the basic file layout. |
| `root` | string | Required. Directory containing the project files. `.` is valid. Absolute paths and paths that escape the config directory are invalid in portable v1 projects. |
| `draftGlob` | string | Required. Glob for section draft files, relative to the project root. The baseline value is `draft/*.md`. |
| `stateDir` | string | Required. Directory for project state and generated workflow artifacts, relative to the project root. The baseline value is `state`. |
| `exportsDir` | string | Required. Directory for generated reader exports, relative to the project root. The baseline value is `exports`. |

### Optional Fields

| Field | Type | Semantics |
| --- | --- | --- |
| `profileOptions` | object | Optional profile-specific settings. Unknown keys should warn unless the selected profile declares that it accepts them. |
| `sourcesDir` | string | Optional directory for the source manifest, relative to the project root. The baseline value is `sources`. |
| `tasteDir` | string | Optional directory for project taste files, relative to the project root. The baseline value is `taste`. |
| `checks` | object | Optional check-suite selection or profile defaults. Unknown object keys are profile- or command-owned until this document defines a stable schema. |
| `reviews` | object | Optional review-suite selection or profile defaults. Unknown object keys are profile- or command-owned until this document defines a stable schema. |
| `model` | object | Optional model preference metadata. Secrets must stay in environment variables or `.env`, not in config. |

Additional top-level fields are reserved. Current v0.x tools warn and ignore
unknown top-level fields. Stable v1 may make reserved top-level fields blocking
errors once compatibility policy is finalized. Tools may preserve unknown fields
when rewriting the config, but they should not depend on them unless this
document is updated.

## Project Root Layout

The project root is the durable manuscript workspace. A typical install-anywhere
project should look like this:

```text
manuscript-lab.config.json
manuscript/
  PROJECT.md
  brief.md
  outline.md
  style.md
  taste/
  draft/
  sources/
    index.md
  docs/
    PROJECT_HANDOFF.md
    PROJECT_REVIEW_APPROACH.md
  state/
    status.md
    continuity.md
    claims.md
    open-questions.md
    runtime/
    issues/
    reviews/
    revision-plans/
    candidates/
    revision-audits/
    gates/
    truth/
    projections/
    taste/
    style/
    model-calls/
    logs/
  exports/
```

Agent and tool read order should start with `PROJECT.md`, then `brief.md`,
`outline.md`, and `style.md` when those files exist.

Required source files:

- `brief.md`: goal, audience, constraints, and success criteria.
- `outline.md`: source of truth for document structure.
- `style.md`: voice, formatting, terminology, and citation rules.
- `draft/`: section Markdown files matched by `draftGlob`.

Recommended source files:

- `PROJECT.md`: compact project-specific operating supplement.
- `taste/`: project-specific taste doctrine and voice memory.
- `sources/index.md`: source manifest.
- `docs/PROJECT_HANDOFF.md`: project-specific handoff notes.
- `docs/PROJECT_REVIEW_APPROACH.md`: project-specific review taste.

Durable state:

- `state/status.md`: section status table.
- `state/continuity.md`: definitions, decisions, characters, timeline, or other
  invariants.
- `state/claims.md`: claim register for current workflows.
- `state/open-questions.md`: unresolved decisions and research gaps.
- `state/issues/`: typed issue ledger and decisions.

Generated or derived artifacts:

- `state/chorus/`: Chorus line-lab runs, beat specs, candidate prose, contact
  sheets, plan-quality notes, optional pick/assemble artifacts, metrics, and
  reports.
- `state/runtime/`: composed runtime packets.
- `state/reviews/`: review run records and reports.
- `state/room/`: writers' room run packets, role outputs, decisions, beat
  boards, and table-read artifacts.
- `state/revision-plans/`: accepted-issue revision plans.
- `state/candidates/`: candidate revision runs.
- `state/revision-audits/`: diff audit records.
- `state/gates/`: future gate results and manifests.
- `state/truth/` and `state/projections/`: structured truth state and readable
  projections.
- `state/taste/` and `state/style/`: generated taste and style signals.
- `state/model-calls/`: compatibility mirror for model-call artifacts.
- `state/logs/`: compatibility mirror for work logs.
- `exports/`: generated reader exports.

Generated artifacts may be ignored by version control. Source files and durable
state should be versioned according to the user's project policy.

## Current Template-First Mapping

The current public repository is template-first. It contains reusable harness
files at the repository root and keeps the active project workspace under:

```text
projects/active/<slug>/workspace/
```

When a project is active, the repository root mounts that workspace with
symlinks such as:

```text
PROJECT.md -> projects/active/<slug>/workspace/PROJECT.md
brief.md   -> projects/active/<slug>/workspace/brief.md
draft/     -> projects/active/<slug>/workspace/draft/
state/...  -> projects/active/<slug>/workspace/state/...
```

For v1, the canonical project root is the active workspace path. The root mount
is a compatibility surface for existing scripts and agents.

An active template-first project can be interpreted as this implicit config:

```json
{
  "schemaVersion": 1,
  "profile": "generic",
  "root": "projects/active/<slug>/workspace",
  "draftGlob": "draft/*.md",
  "stateDir": "state",
  "exportsDir": "exports",
  "profileOptions": {}
}
```

`profile` is not currently stored in `projects/registry.json` or
`projects/active/<slug>/project.json`. Template-first compatibility defaults to
`generic`. Existing story scaffolds may choose `fiction` when the operator
requests that profile.

Reusable harness files remain outside the protocol project root:

```text
scripts/
checks/
reviews/
templates/
docs/
package.json
AGENTS.md
README.md
```

Project-specific files remain inside the project root, even when they are
mounted at the repository root for compatibility.

## Install-Anywhere Mapping

In the future package-installed workflow, Manuscript Lab should not require the
writing repository to be cloned from this template. A typical install-anywhere
project should look like this:

```text
my-whitepaper/
  manuscript-lab.config.json
  manuscript/
    brief.md
    outline.md
    style.md
    draft/
    state/
    exports/
  package.json
  node_modules/
```

The config points the installed CLI at the project root:

```json
{
  "schemaVersion": 1,
  "profile": "whitepaper",
  "root": "manuscript",
  "draftGlob": "draft/*.md",
  "stateDir": "state",
  "exportsDir": "exports",
  "profileOptions": {}
}
```

The installed package supplies the harness. The host repository supplies the
project root. No `scripts/`, `checks/`, `reviews/`, or generic `docs/` directory
is required in the host repository unless the user deliberately customizes the
harness.

## Validation Expectations

`mlab validate` should become the deterministic protocol validator. It should
not call a model.

Validation should:

1. Locate `manuscript-lab.config.json`, or synthesize an implicit config for a
   current template-first repo with a registered active project.
2. Parse JSON without executing code and report malformed config as a protocol
   error, not a stack trace.
3. Require integer `schemaVersion: 1`.
4. Require `profile`, `root`, `draftGlob`, `stateDir`, and `exportsDir`.
5. Reject absolute paths, Windows drive paths, UNC paths, backslashes, and paths
   that escape the config directory or project root.
6. Warn for reserved unknown top-level fields and for unknown built-in
   `profileOptions` keys.
7. Verify that the project root exists, unless validation is running in an init
   planning mode.
8. Verify required project files and directories.
9. Verify that draft files matched by `draftGlob` have parseable section
   contracts when they contain contracts.
10. Verify that section contract `checks` IDs exist in `checks/suite.json` or in
   the selected profile's check registry.
11. Verify that section contract `reviews` IDs exist in `reviews/suite.json` or
   in the selected profile's review registry.
12. Treat generated artifact directories as derived state, not source text.
13. In template-first mode, verify that the active project registry, workspace
    manifest, and root mounts agree.

Validation output should be machine-readable by default or available through a
`--json` flag. Human output should group findings by severity:

- error: protocol violation that blocks reliable operation
- warning: supported compatibility behavior or likely cleanup work
- info: discovered layout and inferred defaults

## Version Compatibility

v1 is a fresh-start protocol for config-first projects. Existing template clones
remain supported as a compatibility mode, but installed-package projects should
be initialized directly with `mlab init`.

Older tools should fail closed when they see a newer `schemaVersion`. Newer
tools may read older versions only through an explicit compatibility path.

## Profile Hooks

Profiles specialize the workflow without changing the protocol contract. A
profile may provide hooks for:

- init: scaffold `brief.md`, `outline.md`, `style.md`, taste files, source
  files, and starter section contracts.
- contract: provide default section `kind`, `checks`, `reviews`, acceptance
  criteria, and word-count expectations.
- compose: add profile-specific rule-stack entries and required context files.
- check: enable deterministic checks and model-backed check defaults.
- review: choose default review panels and severity mapping.
- gate: define section, manuscript, evidence, and export readiness gates.
- export: choose default export formats and required export manifest fields.

Hooks must operate inside the configured project root and declared generated
artifact directories. Reusable profile templates must not contain
project-specific facts, private manuscript details, or credentials.

`profileOptions` is the only v1 config space for project-local profile
parameters. Examples might include target citation style, export formats, or
required evidence gates. Each profile owns validation of its own options.

## Compatibility Rules

- v1 tools should accept the current mounted-root workflow as a compatibility
  layer, but should report the active workspace as the canonical project root.
- v1 tools should prefer explicit config over inferred template-first metadata.
- v1 tools should preserve root symlinks created by `project:mount`.
- v1 tools should keep generic harness files free of project-specific content.
- v1 tools should keep credentials outside project files and profile templates.
