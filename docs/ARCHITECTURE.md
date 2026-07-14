# Architecture

> Status: written for the pre-2.0 surface; command names may differ. Current surface: docs/COMMANDS.md. Old names still work as aliases.

Manuscript Lab has three layers.

## 1. Reusable Harness

These files belong to the public tool:

```text
scripts/
checks/
reviews/
docs/
templates/
evals/
.pi/
package.json
AGENTS.md
README.md
```

The reusable harness should not contain project-specific story details, client
facts, drafts, exports, logs, or secrets.

## 2. Agent Workflow Adapter

The harness can be operated directly through npm scripts, but it also includes an
agent-facing workflow layer:

```text
AGENTS.md
.pi/skills/
.pi/prompts/
docs/AGENT_HANDOFF.md
docs/OPERATOR_GUIDE.md
docs/PRIMITIVES.md
```

This layer is not decorative. It encodes important operating rules:

- write durable prose in files
- compose runtime packets before draft/review/revise work
- treat reviews as sensors, not decisions
- triage issue-ledger findings before editing
- use candidate arenas for high-stakes alternatives
- gate aesthetic/story tradeoffs with the taste arbiter
- run the done gate before calling work complete

## 3. User Project Workspace

Project content lives under:

```text
projects/active/<slug>/workspace/
```

When active, the root mounts that workspace with symlinks:

```text
PROJECT.md -> projects/active/<slug>/workspace/PROJECT.md
brief.md   -> projects/active/<slug>/workspace/brief.md
draft/     -> projects/active/<slug>/workspace/draft/
state/...  -> projects/active/<slug>/workspace/state/...
```

This gives scripts simple paths while keeping reusable infrastructure separate
from user writing.

## Runtime Packets

`npm run compose -- draft/<section>.md` compiles a section-specific packet:

```text
state/runtime/<section-id>/
  intent.md
  context.json
  rule-stack.yaml
  criteria.json
  trace.json
```

The packet records what context was visible, what was excluded, what rules apply,
and what criteria a reviewer or revision should use.

## Review And Revision Flow

The preferred high-stakes flow is:

```text
accepted issue -> candidate revisions -> blind comparison -> taste arbiter -> merge winner -> diff audit -> checks
```

This prevents a model review from becoming an unexamined rewrite instruction.

## Public Repo Boundary

The public repo should track reusable harness files only.

Ignored by default:

- `PROJECT.md`, `brief.md`, `outline.md`, `style.md`
- `draft/`, `taste/`, `sources/`, `exports/`
- `state/`
- `projects/active/`, `projects/inactive/`
- `archive/`
- `.env`, `.doccheck/`, `tmp/`

Users who want to version their own manuscripts can do so in a separate private
repo or adjust `.gitignore` deliberately.

