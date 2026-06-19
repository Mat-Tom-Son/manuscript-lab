#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { writeFileAtomic, writeJsonAtomic } from "./lib/files.mjs";
import { collectGeneratedArtifacts } from "./lib/generated-artifacts.mjs";

const EVAL_SCHEMA = "manuscript-lab.eval-run.v1";

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

if (options.command === "list") {
  const payload = {
    schema_version: EVAL_SCHEMA,
    ok: true,
    eval_runs: collectGeneratedArtifacts(paths, { kind: "eval", limit: options.limit }).artifacts.eval_runs,
  };
  emit(payload, options);
  process.exit(0);
}

if (options.command !== "practice-strategies") {
  fail(`Unknown eval command: ${options.command || "(missing)"}`, options);
}

const result = runPracticeStrategiesEval();
emit(result, options);
process.exit(result.exit_code ?? (result.ok ? 0 : 2));

function runPracticeStrategiesEval() {
  const sourceDir = resolveSourceDir(options.from);
  const sourceSummary = readJson(path.join(sourceDir, "summary.json"), null);
  if (!sourceSummary) fail(`Could not read practice strategy summary: ${paths.projectRel(path.join(sourceDir, "summary.json"))}`, options);
  const rows = readJson(path.join(sourceDir, "rows.json"), []);
  const baseline = options.baseline ? readJson(paths.resolveProjectInput(options.baseline), null) : null;
  if (options.baseline && !baseline) fail(`Could not read baseline JSON: ${options.baseline}`, options);

  const runId = makeEvalRunId();
  const runDir = paths.stateAbs(path.join("evals", runId));
  const comparison = compareStrategySummaries(sourceSummary, baseline);
  const summary = {
    schema_version: EVAL_SCHEMA,
    run_id: runId,
    subject: "practice-strategies",
    label: options.label,
    source_run_id: sourceSummary.run_id ?? path.basename(sourceDir),
    source_run_dir: paths.projectRel(sourceDir),
    baseline_file: options.baseline || "",
    created_at: new Date().toISOString(),
    disposition: comparison.regressions ? "regression" : comparison.improvements ? "improved_or_changed" : "snapshot",
    regressions: comparison.regressions,
    improvements: comparison.improvements,
    total_rows: Number(sourceSummary.total ?? rows.length ?? 0),
    evaluated_rows: Number(sourceSummary.evaluated_rows ?? sourceSummary.total ?? rows.length ?? 0),
    error_rows: Number(sourceSummary.error_rows ?? 0),
    strategies: summarizeStrategies(sourceSummary),
    recommendations: sourceSummary.recommendations ?? {},
    known_usage: sourceSummary.known_usage ?? {},
    comparison,
  };

  if (options.dryRun) {
    const ok = !(options.failOnRegression && summary.regressions);
    return { ok, status: ok ? "dry_run" : "regression", run_id: runId, run_dir: "", summary, exit_code: ok ? 0 : 1 };
  }

  fs.mkdirSync(runDir, { recursive: true });
  writeJsonAtomic(path.join(runDir, "input.json"), {
    schema_version: EVAL_SCHEMA,
    command: "practice-strategies",
    source: paths.projectRel(sourceDir),
    baseline: options.baseline,
    label: options.label,
  });
  writeJsonAtomic(path.join(runDir, "summary.json"), summary);
  writeEvalReport(runDir, summary);
  const ok = !(options.failOnRegression && summary.regressions);
  return { ok, status: ok ? "pass" : "regression", run_id: runId, run_dir: paths.projectRel(runDir), summary, exit_code: ok ? 0 : 1 };
}

function resolveSourceDir(value) {
  const raw = String(value || "").trim();
  if (raw) {
    const full = paths.resolveProjectInput(raw);
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    if (!stat) fail(`Practice strategy source does not exist: ${raw}`, options);
    return stat.isDirectory() ? full : path.dirname(full);
  }
  const latest = collectGeneratedArtifacts(paths, { kind: "practice-strategy", limit: 1 }).artifacts.practice_strategies[0];
  if (!latest) fail("No practice strategy run found. Pass --from state/practice-strategies/<run-id>.", options);
  return paths.projectAbs(latest.path);
}

function summarizeStrategies(summary) {
  return Object.fromEntries(Object.entries(summary.strategies ?? {}).map(([id, item]) => [id, {
    total: Number(item.total ?? 0),
    evaluated_rows: Number(item.evaluated_rows ?? item.total ?? 0),
    error_rows: Number(item.error_rows ?? 0),
    error_rate: Number(item.error_rate ?? 0),
    mlab_wins: Number(item.mlab_wins ?? 0),
    mlab_win_rate: Number(item.mlab_win_rate ?? 0),
    average_score_delta: Number(item.average_score_delta ?? 0),
    first_pass_average_score_delta: Number(item.first_pass_average_score_delta ?? 0),
    repair_recoveries: Number(item.repair_recoveries ?? 0),
    cost: Number(item.known_usage?.cost ?? 0),
  }]));
}

function compareStrategySummaries(current, baseline) {
  if (!baseline) {
    return {
      baseline: false,
      regressions: 0,
      improvements: 0,
      strategy_deltas: {},
      notes: ["No baseline supplied; this eval is a snapshot for future comparisons."],
    };
  }
  const baselineStrategies = baseline.strategies ?? baseline.summary?.strategies ?? {};
  const currentStrategies = current.strategies ?? {};
  const strategyDeltas = {};
  let regressions = 0;
  let improvements = 0;
  for (const id of new Set([...Object.keys(currentStrategies), ...Object.keys(baselineStrategies)])) {
    const now = currentStrategies[id] ?? {};
    const before = baselineStrategies[id] ?? {};
    const delta = {
      mlab_win_rate: Number(now.mlab_win_rate ?? 0) - Number(before.mlab_win_rate ?? 0),
      average_score_delta: Number(now.average_score_delta ?? 0) - Number(before.average_score_delta ?? 0),
      error_rows: Number(now.error_rows ?? 0) - Number(before.error_rows ?? 0),
      cost: Number(now.known_usage?.cost ?? now.cost ?? 0) - Number(before.known_usage?.cost ?? before.cost ?? 0),
    };
    if (delta.mlab_win_rate <= -0.2 || delta.average_score_delta <= -2 || delta.error_rows > 0) regressions += 1;
    if (delta.mlab_win_rate >= 0.2 || delta.average_score_delta >= 2) improvements += 1;
    strategyDeltas[id] = delta;
  }
  return {
    baseline: true,
    regressions,
    improvements,
    strategy_deltas: strategyDeltas,
    notes: [],
  };
}

function writeEvalReport(runDir, summary) {
  const lines = [
    `# Eval ${summary.run_id}`,
    "",
    `Subject: ${summary.subject}`,
    `Source: ${summary.source_run_dir}`,
    `Baseline: ${summary.baseline_file || "none"}`,
    `Disposition: ${summary.disposition}`,
    `Regressions: ${summary.regressions}`,
    `Improvements: ${summary.improvements}`,
    `Rows: ${summary.total_rows}`,
    `Evaluated rows: ${summary.evaluated_rows}`,
    `Errors: ${summary.error_rows}`,
    "",
    "## Strategies",
    "",
    "| Strategy | Total | Evaluated | Errors | MLab Wins | Win Rate | Avg Delta | Cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(summary.strategies).map(([id, item]) => `| ${id} | ${item.total} | ${item.evaluated_rows} | ${item.error_rows} | ${item.mlab_wins} | ${(item.mlab_win_rate * 100).toFixed(1)}% | ${item.average_score_delta.toFixed(2)} | $${item.cost.toFixed(4)} |`),
    "",
  ];
  writeFileAtomic(path.join(runDir, "EVAL_REPORT.md"), lines.join("\n"), "utf8");
}

function emit(payload, opts) {
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.eval_runs) {
    console.log(`Eval runs: ${payload.eval_runs.length}`);
    for (const run of payload.eval_runs) console.log(`- ${run.run_id}: ${run.disposition || run.status} -> ${run.report || run.path}`);
    return;
  }
  console.log(`Eval ${payload.status}: ${payload.summary.subject}`);
  if (payload.run_dir) console.log(`Run: ${payload.run_dir}`);
  console.log(`Disposition: ${payload.summary.disposition}`);
  if (payload.summary.error_rows) console.log(`Errors: ${payload.summary.error_rows}`);
}

function parseArgs(args) {
  const explicitCommand = Boolean(args[0] && !args[0].startsWith("--"));
  const parsed = {
    command: explicitCommand ? args[0] : "list",
    from: "",
    baseline: "",
    label: "",
    limit: 10,
    dryRun: false,
    failOnRegression: false,
    json: false,
    help: false,
    config: "",
    workspace: "",
  };
  const start = explicitCommand && (parsed.command === "list" || parsed.command === "practice-strategies") ? 1 : 0;
  for (let index = start; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--fail-on-regression") parsed.failOnRegression = true;
    else if (arg === "--from") parsed.from = args[++index] ?? "";
    else if (arg.startsWith("--from=")) parsed.from = arg.slice("--from=".length);
    else if (arg === "--baseline") parsed.baseline = args[++index] ?? "";
    else if (arg.startsWith("--baseline=")) parsed.baseline = arg.slice("--baseline=".length);
    else if (arg === "--label") parsed.label = args[++index] ?? "";
    else if (arg.startsWith("--label=")) parsed.label = arg.slice("--label=".length);
    else if (arg === "--limit") parsed.limit = positiveInteger(args[++index], 10);
    else if (arg.startsWith("--limit=")) parsed.limit = positiveInteger(arg.slice("--limit=".length), 10);
    else if (arg === "--config") parsed.config = args[++index] ?? "";
    else if (arg === "--workspace") parsed.workspace = args[++index] ?? "";
    else fail(`Unexpected argument: ${arg}`, parsed);
  }
  return parsed;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function makeEvalRunId() {
  return `eval-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
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
  console.log(`eval - snapshot and compare Manuscript Lab workflow evidence

Usage:
  mlab eval list --json
  mlab eval practice-strategies --from state/practice-strategies/<run-id> --json
  mlab eval practice-strategies --from state/practice-strategies/<run-id> --baseline state/evals/<eval-id>/summary.json

Options:
  --from <dir>       Practice strategy run directory. Defaults to latest.
  --baseline <json>  Prior eval summary or practice strategy summary to compare.
  --label <text>     Optional human label for the eval.
  --dry-run          Build the eval summary without writing state.
  --fail-on-regression
                     Exit 1 when a baseline comparison finds regressions.
  --json             Print machine-readable output.
  --config <path>    Explicit protocol config path.
  --workspace <path> Explicit workspace root.
`);
}
