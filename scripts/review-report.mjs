#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";

const discovery = discoverProtocol({ cwd: process.cwd() });
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const runs = loadRuns().filter((run) => runMatchesTarget(run, options.target));
const summary = summarizeRuns(runs);

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printSummary(summary);
}

function loadRuns() {
  const dir = paths.stateAbs("reviews");
  if (!fs.existsSync(dir)) return [];

  const runs = [];
  for (const file of walk(dir).filter((item) => item.endsWith(".json"))) {
    if (!file.includes(`${path.sep}runs${path.sep}`)) continue;
    try {
      runs.push({ ...JSON.parse(read(file)), report_file: displayPath(file) });
    } catch (error) {
      runs.push({
        report_file: displayPath(file),
        model: "(unreadable)",
        pass: { id: "(unreadable)" },
        target: { file: "(unknown)", section_id: "(unknown)" },
        error: `Could not parse run JSON: ${error.message}`,
        normalized: { issues: [], strengths: [], discarded_issues: [] },
        imported_issue_ids: [],
      });
    }
  }

  return runs.sort((left, right) => String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")));
}

function runMatchesTarget(run, target) {
  if (!target) return true;
  const normalizedTarget = normalizeRel(target);
  return run.target?.file === normalizedTarget || run.target?.section_id === target;
}

function summarizeRuns(runs) {
  const byModel = new Map();
  const byPass = new Map();
  const errors = [];

  const totals = {
    runs: runs.length,
    ok: 0,
    errors: 0,
    issues: 0,
    imported_issues: 0,
    discarded_issues: 0,
  };

  for (const run of runs) {
    const row = runMetrics(run);
    totals.ok += row.error ? 0 : 1;
    totals.errors += row.error ? 1 : 0;
    totals.issues += row.issues;
    totals.imported_issues += row.imported_issues;
    totals.discarded_issues += row.discarded_issues;

    addGroupRow(byModel, run.model ?? "(unknown)", row);
    addGroupRow(byPass, run.pass?.id ?? "(unknown)", row);

    if (row.error) {
      errors.push({
        created_at: run.created_at ?? "",
        model: run.model ?? "(unknown)",
        pass: run.pass?.id ?? "(unknown)",
        target: run.target?.file ?? "(unknown)",
        error: String(run.error).slice(0, 300),
        file: run.report_file,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    target: options.target || "all",
    totals,
    by_model: Object.fromEntries([...byModel.entries()].sort(([left], [right]) => left.localeCompare(right))),
    by_pass: Object.fromEntries([...byPass.entries()].sort(([left], [right]) => left.localeCompare(right))),
    recent_errors: errors.slice(-10).reverse(),
  };
}

function runMetrics(run) {
  const normalized = run.normalized ?? {};
  return {
    runs: 1,
    ok: run.error ? 0 : 1,
    errors: run.error ? 1 : 0,
    error: Boolean(run.error),
    issues: Number(run.metrics?.issue_count ?? normalized.issues?.length ?? 0),
    imported_issues: Number(run.metrics?.imported_issue_count ?? run.imported_issue_ids?.length ?? 0),
    discarded_issues: Number(run.metrics?.discarded_issue_count ?? normalized.discarded_issues?.length ?? 0),
  };
}

function addGroupRow(groups, key, row) {
  const current = groups.get(key) ?? {
    runs: 0,
    ok: 0,
    errors: 0,
    issues: 0,
    imported_issues: 0,
    discarded_issues: 0,
  };

  current.runs += row.runs;
  current.ok += row.ok;
  current.errors += row.errors;
  current.issues += row.issues;
  current.imported_issues += row.imported_issues;
  current.discarded_issues += row.discarded_issues;
  groups.set(key, current);
}

function printSummary(summary) {
  console.log(`Review report (${summary.target})`);
  console.log(
    `Runs: ${summary.totals.runs} | ok: ${summary.totals.ok} | errors: ${summary.totals.errors} | issues: ${summary.totals.issues} | imported: ${summary.totals.imported_issues} | discarded: ${summary.totals.discarded_issues}`,
  );

  console.log("\nBy model:");
  printGroup(summary.by_model);

  console.log("\nBy pass:");
  printGroup(summary.by_pass);

  if (summary.recent_errors.length) {
    console.log("\nRecent errors:");
    for (const error of summary.recent_errors) {
      console.log(`- ${error.model} / ${error.pass} / ${error.target}: ${error.error}`);
    }
  }
}

function printGroup(group) {
  const entries = Object.entries(group);
  if (!entries.length) {
    console.log("- none");
    return;
  }

  for (const [key, row] of entries) {
    console.log(
      `- ${key}: runs ${row.runs}, ok ${row.ok}, errors ${row.errors}, issues ${row.issues}, imported ${row.imported_issues}, discarded ${row.discarded_issues}`,
    );
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    target: "",
    json: false,
    help: false,
  };

  for (const arg of rawArgs) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (!parsed.target) {
      parsed.target = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  if (parsed.target && parsed.target.endsWith(".md")) parsed.target = displayPath(resolveInputPath(parsed.target));
  return parsed;
}

function printHelp() {
  console.log(`review-report - summarize saved typed review runs

Usage:
  node scripts/review-report.mjs [options] [section-id|draft-section.md]

Options:
  --json      Print JSON output.
  --help, -h  Show this help.
`);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function resolveInputPath(input) {
  return paths.resolveProjectInput(input);
}

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function displayPath(file) {
  return paths.projectRel(file);
}
