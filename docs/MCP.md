# MCP Server

Status: shipped surface. `mlab mcp` is the agents-first distribution surface
for the Manuscript Lab protocol.

`mlab mcp` runs a zero-dependency Model Context Protocol (MCP) server over
stdio. Any MCP client — Claude Code, Claude Desktop, Cursor, or a custom agent
— gets the Manuscript Lab primitives as typed tools: validation, status,
checks, gates, reports, evidence, and artifact inspection. Every tool call
executes the local `mlab` CLI against your workspace; nothing bypasses the
file protocol, and readiness still comes from checks, issues, and gates.

Short shape:

```text
MCP client -> tools/call -> allowlisted mlab command -> workspace files
-> text result (stdout) back to the agent
```

## Quick start

### Claude Code

From a project where `manuscript-lab` is installed (`npm i -D manuscript-lab`):

```bash
claude mcp add manuscript-lab -- npx mlab mcp
```

Without a project-local install, pin the workspace explicitly:

```bash
claude mcp add manuscript-lab -- npx --yes manuscript-lab mcp --root /absolute/path/to/your/project
```

### Claude Desktop

Add to `claude_desktop_config.json` (Claude Desktop launches servers outside
your project directory, so `--root` is required):

```json
{
  "mcpServers": {
    "manuscript-lab": {
      "command": "npx",
      "args": ["--yes", "manuscript-lab", "mcp", "--root", "/absolute/path/to/your/project"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in the workspace (Cursor starts servers from the
workspace root, so a project-local install needs no `--root`):

```json
{
  "mcpServers": {
    "manuscript-lab": {
      "command": "npx",
      "args": ["mlab", "mcp"]
    }
  }
}
```

### Working in this repo

```bash
node scripts/mcp-server.mjs --root /path/to/workspace
```

## Workspace resolution

The server resolves the workspace from its start directory (or `--root`) using
the same discovery as every other `mlab` command: nearest
`manuscript-lab.config.json`, then template-clone fallback. `--root` also pins
`MLAB_WORKSPACE` for tool runs so an inherited environment cannot redirect
them.

No workspace is required to start. `initialize`, `tools/list`, and `ping` work
anywhere; `tools/call` in a directory without a workspace returns an `isError`
text result telling the agent to run `mlab init` first, and calls succeed as
soon as the workspace exists — no server restart needed.

## Exposure flags

| Flag | Exposure |
| --- | --- |
| (default) | Tools that never call models and never require a human approval: reads plus generated-state writes under the workspace's state directory. |
| `--all-tools` | The full catalog, including approval-gated and model-calling tools (review, room blue-sky, chorus, practice, merge apply, export, done). |
| `--read-only` | Only tools whose effects are pure project reads. Strictest posture. |
| `--root <dir>` | Resolve the workspace from `<dir>` instead of the server's working directory. |

## Safety posture

- Default exposure mirrors the model driver's auto-approval rules
  (`approval` of `auto` or `auto_in_operate` in the tool catalog) and always
  excludes tools with the `calls_model` effect. Draft prose, exports, and
  release actions are unreachable without `--all-tools`.
- Tool arguments are validated by the same shared catalog used by
  `mlab drive`: project-relative paths only, no traversal, no absolute paths,
  bounded integers, allowlisted identifiers. Invalid arguments are rejected
  with JSON-RPC `-32602` before anything runs.
- Each call spawns the local `bin/manuscript-lab.mjs` with a 120s timeout and
  captured output; the server itself makes no network calls. Model-calling
  tools (only reachable with `--all-tools`) still need provider credentials in
  the environment and spend budget like their CLI equivalents.
- stdout carries only protocol messages (one JSON-RPC message per line); all
  logging goes to stderr.
- Tool annotations advertise the posture to clients: `readOnlyHint` (effects
  are pure reads), `destructiveHint` (writes drafts/exports, touches the
  workspace, or is a release action), `openWorldHint` (calls a model).

## Tools

Tool names are catalog `tool_id`s with `.` replaced by `_` (MCP name charset).
Descriptions carry the underlying CLI command and its declared effects.

| MCP tool | CLI command | Effects | Default | Read-only |
| --- | --- | --- | --- | --- |
| `validate_project` | `mlab validate --json` | reads_project | yes | yes |
| `status_project` | `mlab status --json` | reads_project | yes | yes |
| `report_project` | `mlab report --json` | reads_project | yes | yes |
| `compose_section` | `mlab compose <section> --json` | reads_project, writes_state | yes | no |
| `check_static` | `mlab check --static-only --json <target>` | reads_project | yes | yes |
| `gate_target` | `mlab gate <target> --json --write` | reads_project, writes_state | yes | no |
| `claims_list` | `mlab claims list --json` | reads_project | yes | yes |
| `citations_check` | `mlab citations check --json <target>` | reads_project | yes | yes |
| `evidence_report` | `mlab evidence report --json` | reads_project | yes | yes |
| `review_report` | `mlab review report <target>` | reads_project | yes | yes |
| `review_run` | `mlab review <target> --panel <panel>` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `room_diagnose` | `mlab lab room diagnose <target> --json` | reads_project, writes_state | yes | no |
| `room_blue_sky` | `mlab lab room blue-sky <target> --json` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `room_report` | `mlab lab room report <target>` | reads_project | yes | yes |
| `chorus_run` | `mlab lab chorus run <target> --json` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `chorus_report` | `mlab lab chorus report <target>` | reads_project | yes | yes |
| `merge_preview` | `mlab merge <target> --run <run-id> --json` | reads_project | yes | yes |
| `merge_apply` | `mlab merge <target> --run <run-id> --apply --audit --json` | reads_project, writes_state, writes_draft | no | no |
| `practice_propose` | `mlab lab practice propose --exercise <exercise> --brief <brief>` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `practice_compare` | `mlab lab practice compare --exercise <exercise> --brief <brief>` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `practice_bench` | `mlab lab practice bench --exercises <set>` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `practice_strategies` | `mlab lab practice strategies --exercises <set> --strategies <list>` | reads_project, writes_state, calls_model, spends_budget | no | no |
| `artifacts_list` | `mlab lab artifacts list --kind <kind> --json` | reads_project | yes | yes |
| `artifacts_inspect` | `mlab lab artifacts inspect --run <run-id> --json` | reads_project | yes | yes |
| `eval_practice_strategies` | `mlab lab eval practice-strategies --from state/practice-strategies/<run-id> --json` | reads_project, writes_state | yes | no |
| `golden_path_guide` | `mlab lab golden-path --json` | reads_project | yes | yes |
| `export_reader` | `mlab export --formats <formats> --json` | reads_project, writes_exports | no | no |
| `done_no_export` | `mlab done:no-export --json` | reads_project, writes_state, touches_workspace | no | no |
| `done_export` | `mlab done --json` | reads_project, writes_state, writes_exports, touches_workspace | no | no |

### Regenerating this table

The table is generated from `scripts/lib/driver-tool-catalog.mjs` — the single
source of truth the server, the model driver, and this document all share. The
live list is always available from a running server via `tools/list`. After a
catalog change, regenerate the table from the package root with:

```bash
node --input-type=module -e '
import { listDriverTools } from "./scripts/lib/driver-tool-catalog.mjs";
const readOnly = (tool) => tool.effects.every((effect) => effect === "reads_project");
const exposedByDefault = (tool) => ["auto", "auto_in_operate"].includes(tool.approval) && !tool.effects.includes("calls_model");
console.log("| MCP tool | CLI command | Effects | Default | Read-only |");
console.log("| --- | --- | --- | --- | --- |");
for (const tool of listDriverTools()) {
  const name = tool.tool_id.replace(/\./g, "_");
  console.log(`| \`${name}\` | \`${tool.public_command}\` | ${tool.effects.join(", ")} | ${exposedByDefault(tool) ? "yes" : "no"} | ${readOnly(tool) ? "yes" : "no"} |`);
}'
```

## Protocol details

- Transport: stdio, newline-delimited JSON-RPC 2.0 — one message per line on
  stdout, requests read line by line from stdin. The server exits cleanly when
  stdin closes.
- Methods: `initialize`, `notifications/initialized`, `tools/list`,
  `tools/call`, `ping`. Unknown methods return `-32601`; unparseable lines
  return `-32700`; invalid tool names or arguments return `-32602`.
  Notifications never receive responses.
- Protocol versions: echoes the client's requested version when it is one of
  `2024-11-05`, `2025-03-26`, or `2025-06-18`; otherwise answers `2025-06-18`.
- Results: `tools/call` returns `content` with a single text item holding the
  command's stdout tail (last 50k characters). Nonzero exits set
  `isError: true` and append the stderr tail and exit code so agents can react
  without guessing.
