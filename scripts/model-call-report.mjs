#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const ledgerFile = resolveLedgerFile();
const entries = fs.existsSync(ledgerFile) ? readLedger(ledgerFile).filter(matchesFilters) : [];

if (options.json) {
  console.log(JSON.stringify({ ledger: displayPath(ledgerFile), count: entries.length, entries, groups: grouped(entries) }, null, 2));
  process.exit(0);
}

if (!fs.existsSync(ledgerFile)) {
  console.log(`No model-call ledger found at ${displayPath(ledgerFile)}`);
  console.log("Enable capture with MODEL_CALL_AUDIT=1 before running model-backed commands.");
  process.exit(0);
}

console.log(`Model call ledger: ${displayPath(ledgerFile)}`);
console.log(`Calls: ${entries.length}`);

const groups = grouped(entries);
if (options.group) {
  console.log("");
  console.log(`Grouped by ${options.group}:`);
  for (const item of groups) {
    const cost = item.cost ? `, cost=$${item.cost.toFixed(6)}` : "";
    console.log(`- ${item.key}: ${item.count} call(s), ok=${item.ok}, error=${item.error}, tokens=${item.total_tokens}${cost}`);
  }
  process.exit(0);
}

for (const entry of entries.slice(-options.limit)) {
  const target = entry.target ? ` target=${entry.target}` : "";
  const usage = entry.usage?.total_tokens ? ` tokens=${entry.usage.total_tokens}` : "";
  const cost = Number.isFinite(Number(entry.usage?.cost)) ? ` cost=$${Number(entry.usage.cost).toFixed(6)}` : "";
  console.log(`- ${entry.created_at} ${entry.status} ${entry.operation} ${entry.model}${target}${usage}${cost}`);
  console.log(`  ${entry.call_dir}`);
}

function resolveLedgerFile() {
  if (options.ledger) return abs(options.ledger);

  const registry = readJsonSafe(abs("projects/registry.json"), null);
  const active = typeof registry?.active === "string" ? registry.active : registry?.active?.slug;
  const project = active ? registry?.projects?.[active] : null;
  const logsPath = project?.logs_path || registry?.active?.logs_path || (active ? path.join("projects", "active", active, "logs") : "");
  if (logsPath) return abs(path.join(logsPath, "model-calls", "ledger.jsonl"));

  return abs("state/model-calls/ledger.jsonl");
}

function readLedger(file) {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function matchesFilters(entry) {
  if (options.since && Date.parse(entry.created_at) < Date.parse(options.since)) return false;
  if (options.operation && entry.operation !== options.operation) return false;
  if (options.target && entry.target !== options.target) return false;
  if (options.status && entry.status !== options.status) return false;
  if (options.model && entry.model !== options.model && entry.resolved_model !== options.model) return false;
  return true;
}

function grouped(entriesToGroup) {
  if (!options.group) return [];
  const groups = new Map();
  for (const entry of entriesToGroup) {
    const key = String(entry[options.group] ?? "");
    const group = groups.get(key) ?? { key, count: 0, ok: 0, error: 0, total_tokens: 0, cost: 0 };
    group.count += 1;
    if (entry.status === "ok") group.ok += 1;
    if (entry.status !== "ok") group.error += 1;
    group.total_tokens += Number(entry.usage?.total_tokens ?? 0);
    group.cost += Number(entry.usage?.cost ?? entry.usage?.cost_details?.upstream_inference_cost ?? 0);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function parseArgs(args) {
  const parsed = {
    json: false,
    help: false,
    ledger: "",
    since: "",
    operation: "",
    target: "",
    status: "",
    model: "",
    group: "",
    limit: 20,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--ledger") {
      parsed.ledger = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--ledger=")) parsed.ledger = arg.slice("--ledger=".length);
    else if (arg === "--since") {
      parsed.since = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--since=")) parsed.since = arg.slice("--since=".length);
    else if (arg === "--operation") {
      parsed.operation = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--operation=")) parsed.operation = arg.slice("--operation=".length);
    else if (arg === "--target") {
      parsed.target = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else if (arg === "--status") {
      parsed.status = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--status=")) parsed.status = arg.slice("--status=".length);
    else if (arg === "--model") {
      parsed.model = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--model=")) parsed.model = arg.slice("--model=".length);
    else if (arg === "--group") {
      parsed.group = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--group=")) parsed.group = arg.slice("--group=".length);
    else if (arg === "--limit") {
      parsed.limit = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--limit=")) parsed.limit = Number(arg.slice("--limit=".length));
    else fail(`Unexpected argument: ${arg}`);
  }

  if (parsed.since && Number.isNaN(Date.parse(parsed.since))) fail(`Invalid --since date: ${parsed.since}`);
  if (parsed.group && !["operation", "provider", "model", "resolved_model", "target", "section_id", "status"].includes(parsed.group)) {
    fail("--group must be one of operation, provider, model, resolved_model, target, section_id, status");
  }
  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) parsed.limit = 20;
  return parsed;
}

function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function abs(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function displayPath(value) {
  return path.relative(root, abs(value)) || ".";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`model-call-report - inspect the project-local model call ledger

Usage:
  npm run model:calls
  npm run model:calls -- --group model
  npm run model:calls -- --operation review.run --target draft/01-opening.md
  npm run model:calls -- --since 2026-06-01 --json

Capture:
  MODEL_CALL_AUDIT=1 npm run review:run -- --panel prose.clean draft/<section>.md

Options:
  --ledger file       Read a specific ledger.jsonl file.
  --since date        Keep calls created on or after this date.
  --operation id      Filter by operation, for example review.run.
  --target file       Filter by target path.
  --status status     Filter by ok or error.
  --model id          Filter by configured or resolved model ID.
  --group field       Group by operation, provider, model, resolved_model, target, section_id, or status.
  --limit n           Number of recent calls to print. Default: 20.
  --json              Print machine-readable output.
  --help, -h          Show this help.
`);
}
