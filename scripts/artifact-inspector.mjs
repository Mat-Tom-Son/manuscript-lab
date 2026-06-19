#!/usr/bin/env node

import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import {
  artifactKindNames,
  collectGeneratedArtifacts,
  findGeneratedArtifact,
  readArtifactJson,
} from "./lib/generated-artifacts.mjs";

const ARTIFACTS_SCHEMA = "manuscript-lab.artifacts.v1";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const discovery = discoverProtocol({
  cwd: process.cwd(),
  configPath: options.config,
  workspace: options.workspace,
});
if (discovery.mode === "none" || discovery.errors?.length) {
  const errors = discovery.errors?.length ? discovery.errors : ["No Manuscript Lab project found."];
  fail(errors.join("\n"), options);
}

const paths = protocolPaths(discovery, { cwd: process.cwd() });

if (options.command === "inspect") {
  let artifact;
  try {
    artifact = findGeneratedArtifact(paths, { runId: options.run, kind: options.kind });
  } catch (error) {
    fail(error.message, options);
  }
  if (!artifact) fail(`No artifact matched --run ${options.run || "(missing)"}.`, options);
  const payload = {
    schema_version: ARTIFACTS_SCHEMA,
    ok: true,
    command: "inspect",
    artifact,
    summary: readArtifactJson(paths, artifact, "summary.json", null),
    plan: readArtifactJson(paths, artifact, "plan.json", null),
    input: readArtifactJson(paths, artifact, "input.json", null),
  };
  emit(payload, options);
  process.exit(0);
}

let collected;
try {
  collected = collectGeneratedArtifacts(paths, { kind: options.kind, limit: options.limit });
} catch (error) {
  fail(error.message, options);
}
const payload = {
  schema_version: ARTIFACTS_SCHEMA,
  ok: true,
  command: "list",
  kind: options.kind,
  generated_at: collected.generated_at,
  artifacts: collected.artifacts,
  recommendations: collected.recommendations,
};
emit(payload, options);

function emit(payload, opts) {
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.command === "inspect") {
    printArtifact(payload.artifact);
    if (payload.summary) printSummary(payload.summary);
    return;
  }
  printList(payload);
}

function printList(payload) {
  console.log("Generated Artifacts");
  console.log("");
  for (const [group, items] of Object.entries(payload.artifacts)) {
    if (!items.length) continue;
    console.log(`${title(group)}:`);
    for (const item of items) {
      const report = item.report ? ` -> ${item.report}` : ` -> ${item.path}`;
      console.log(`- ${item.run_id}: ${item.status}${report}`);
    }
    console.log("");
  }
  if (payload.recommendations?.length) {
    console.log("Recommendations:");
    for (const item of payload.recommendations) {
      console.log(`- ${item.message}`);
      if (item.next_command) console.log(`  ${item.next_command}`);
    }
  }
}

function printArtifact(artifact) {
  console.log(`${artifact.kind}: ${artifact.run_id}`);
  console.log(`status: ${artifact.status}`);
  console.log(`path: ${artifact.path}`);
  if (artifact.report) console.log(`report: ${artifact.report}`);
  if (artifact.summary_file) console.log(`summary: ${artifact.summary_file}`);
  if (artifact.modified_at) console.log(`modified: ${artifact.modified_at}`);
}

function printSummary(summary) {
  const keys = [
    "total",
    "total_rows",
    "evaluated_rows",
    "error_rows",
    "mlab_wins",
    "direct_wins",
    "mlab_win_rate",
    "average_score_delta",
    "disposition",
    "regressions",
    "improvements",
  ];
  const visible = keys.filter((key) => summary[key] !== undefined);
  if (!visible.length) return;
  console.log("");
  console.log("Summary:");
  for (const key of visible) console.log(`- ${key}: ${summary[key]}`);
}

function parseArgs(args) {
  const explicitCommand = Boolean(args[0] && !args[0].startsWith("--"));
  const parsed = {
    command: explicitCommand ? args[0] : "list",
    kind: "all",
    run: "",
    limit: 5,
    json: false,
    help: false,
    config: "",
    workspace: "",
  };
  let start = explicitCommand ? 1 : 0;
  if (explicitCommand && !["list", "inspect"].includes(parsed.command)) {
    parsed.command = "list";
    start = 0;
  }
  for (let index = start; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--kind") parsed.kind = args[++index] ?? "";
    else if (arg.startsWith("--kind=")) parsed.kind = arg.slice("--kind=".length);
    else if (arg === "--run") parsed.run = args[++index] ?? "";
    else if (arg.startsWith("--run=")) parsed.run = arg.slice("--run=".length);
    else if (arg === "--limit") parsed.limit = positiveInteger(args[++index], 5);
    else if (arg.startsWith("--limit=")) parsed.limit = positiveInteger(arg.slice("--limit=".length), 5);
    else if (arg === "--config") parsed.config = args[++index] ?? "";
    else if (arg === "--workspace") parsed.workspace = args[++index] ?? "";
    else fail(`Unexpected argument: ${arg}`, parsed);
  }
  if (parsed.command === "inspect" && !parsed.run) fail("artifacts inspect requires --run <run-id-or-path>.", parsed);
  return parsed;
}

function title(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function fail(message, opts = {}) {
  if (opts.json) console.log(JSON.stringify({ ok: false, status: "error", error: message }, null, 2));
  else console.error(message);
  process.exit(2);
}

function printHelp() {
  console.log(`artifacts - inspect generated Manuscript Lab evidence

Usage:
  mlab artifacts list --json
  mlab artifacts list --kind practice-strategy
  mlab artifacts inspect --run <run-id> --json

Options:
  --kind <kind>       all, ${artifactKindNames().join(", ")}. Default: all.
  --run <id|path>    Run id or project-relative artifact path for inspect.
  --limit <n>        Artifacts per kind, 1-50. Default: 5.
  --json             Print machine-readable output.
  --config <path>    Explicit protocol config path.
  --workspace <path> Explicit workspace root.
`);
}
