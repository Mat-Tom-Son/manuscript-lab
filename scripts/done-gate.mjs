#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureProtocolReady } from "./lib/cli-runtime.mjs";
import { scanReviewErrors } from "./lib/review-errors.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";

const options = normalizeOptions(parseArgs(process.argv.slice(2)));
if (options.help) {
  printHelp();
  process.exit(0);
}

const discovery = discoverProtocol({ cwd: process.cwd() });
ensureProtocolReady(discovery, { json: Boolean(options.json) });
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const installedMode = discovery.mode === "installed";
const unloaded = isWorkspaceUnloaded();
const exportFormats = requiredExportFormats(options);

const errors = [];
const warnings = [];

const checkResult = unloaded ? skippedResult() : runNode(["scripts/doccheck.mjs", "--static-only"], { capture: true });
if (checkResult.status !== 0) errors.push("Static document checks failed.");

const auditResult = runNode(["scripts/template-audit.mjs", "--strict"], { capture: true, cwd: discovery.packageRoot });
if (auditResult.status !== 0) errors.push("Reusable template audit failed.");

const contextAuditResult = runNode(["scripts/context-audit.mjs", "--strict"], { capture: true, cwd: discovery.packageRoot });
if (contextAuditResult.status !== 0) errors.push("Context hygiene audit failed.");

const exportResult = options["skip-exports"] || unloaded ? null : runNode(["scripts/export-manuscript.mjs", ...exportArgs(options, exportFormats)], { capture: true });
if (exportResult && exportResult.status !== 0) errors.push(`Reader export failed${childSummary(exportResult)}. Run ${installedMode ? "mlab export" : "npm run export"}.`);

const statusResult = runNode(["scripts/harness-status.mjs", "--json"], { capture: true });
let status = null;
if (statusResult.status !== 0) {
  errors.push("Harness status failed.");
} else {
  try {
    status = JSON.parse(statusResult.stdout);
  } catch (error) {
    errors.push(`Harness status JSON could not be parsed: ${error.message}`);
  }
}

if (status) validateStatus(status);

const reviewScan = unloaded ? { failures: [] } : scanReviewErrors(paths.stateAbs("reviews"));
if (reviewScan.failures.length) {
  const details = reviewScan.failures.slice(0, 5).map((failure) => `${failure.file}${failure.error ? `: ${failure.error}` : ""}`).join("; ");
  const message = `Review run errors remain: ${reviewScan.failures.length}${details ? ` (${details}${reviewScan.failures.length > 5 ? "; ..." : ""})` : ""}`;
  if (options["warn-review-errors"]) warnings.push(message);
  else errors.push(message);
}

const projectSyncResult = unloaded || installedMode ? skippedResult() : runNode(["scripts/story-workspace.mjs", "sync-project", "--json"], { capture: true });
if (!unloaded && !installedMode && projectSyncResult.status !== 0) {
  errors.push("Project filesystem sync failed. Run npm run project:sync.");
}

const projectResult = installedMode ? skippedResult() : runNode(["scripts/story-workspace.mjs", "verify-projects", "--json"], { capture: true });
if (!installedMode && projectResult.status !== 0) {
  errors.push("Project filesystem verification failed. Run npm run project:sync.");
}

const result = {
  pass: errors.length === 0,
  timestamp: new Date().toISOString(),
  checks: {
    static: checkResult.status === 0,
    template_audit: auditResult.status === 0,
    context_audit: contextAuditResult.status === 0,
    exports: options["skip-exports"] || unloaded ? "skipped" : exportResult?.status === 0,
    status: statusResult.status === 0,
    project_sync: unloaded || installedMode ? "skipped" : projectSyncResult.status === 0,
    project_filesystem: installedMode ? "skipped" : projectResult.status === 0,
    review_errors: unloaded ? "skipped" : reviewScan.failures.length === 0,
  },
  export_formats: options["skip-exports"] || unloaded ? [] : exportFormats,
  errors,
  warnings,
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printText(result);
}

process.exit(result.pass ? 0 : 1);

function validateStatus(status) {
  if (status.workspace_state?.status === "unloaded") return;

  const draftStatusByFile = new Map((status.drafts ?? []).map((draft) => [draft.file, draft.status]));
  const stale = (status.runtime_packets ?? []).filter((packet) => {
    if (draftStatusByFile.get(packet.file) === "todo") return false;
    return packet.status !== "fresh";
  });
  for (const packet of stale) {
    errors.push(`Runtime packet is ${packet.status}: ${packet.file} -> ${packet.path}`);
  }

  if (status.issues?.open > 0) errors.push(`Open issues remain: ${status.issues.open}`);
  if (status.issues?.deferred > 0) errors.push(`Deferred issues remain: ${status.issues.deferred}`);

  const activeDrafts = (status.drafts ?? []).filter((draft) => draft.status !== "todo");
  if (!activeDrafts.length) warnings.push("No active non-todo draft sections found.");

  if (options["require-done"]) {
    for (const draft of activeDrafts) {
      if (draft.status !== "done") errors.push(`Section is not done: ${draft.file} (${draft.status})`);
    }
  }

  if (!options["skip-exports"]) {
    const exports = status.exports ?? [];
    const byExt = new Set(exports.map((item) => item.file.split(".").pop()?.toLowerCase()).filter(Boolean));
    for (const ext of exportFormats) {
      if (!byExt.has(ext)) errors.push(`Missing ${ext.toUpperCase()} export. Run npm run export.`);
    }
  }

}

function requiredExportFormats(rawOptions) {
  const formats = splitList(rawOptions["export-formats"] ?? "md,html,epub,pdf");
  const allowed = new Set(["md", "html", "epub", "pdf"]);
  if (!formats.length) {
    console.error("At least one export format is required.");
    process.exit(2);
  }
  for (const format of formats) {
    if (!allowed.has(format)) {
      console.error(`Unsupported export format: ${format}`);
      process.exit(2);
    }
  }
  return [...new Set(formats)];
}

function exportArgs(rawOptions, formats) {
  const args = ["--quiet", "--formats", formats.join(",")];
  if (rawOptions["include-todo-exports"]) args.push("--include-todo");
  if (rawOptions["export-slug"]) args.push("--slug", rawOptions["export-slug"]);
  if (rawOptions["export-out"]) args.push("--out", rawOptions["export-out"]);
  return args;
}

function runNode(args, { capture, cwd = process.cwd() }) {
  const [script, ...scriptArgs] = args;
  const scriptPath = script.startsWith("scripts/") ? path.join(discovery.packageRoot, script) : script;
  return spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function skippedResult() {
  return { status: 0, stdout: "", stderr: "" };
}

function isWorkspaceUnloaded() {
  if (installedMode) return false;
  const workspace = loadJson(paths.stateAbs("workspace.json"), null);
  const registry = loadJson(paths.workspaceAbs("projects/registry.json"), { active: null });
  return workspace?.status === "unloaded" && workspace?.active === false && !registry.active;
}

function loadJson(file, fallback) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return fallback;
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const equalsIndex = arg.indexOf("=");
    const key = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const next = args[i + 1];
    if (equalsIndex !== -1) {
      parsed[key] = arg.slice(equalsIndex + 1);
    } else if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function normalizeOptions(options) {
  if (options["no-export"]) options["skip-exports"] = true;
  return options;
}

function splitList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function childSummary(result) {
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !line.startsWith("Traceback "));
  return text ? `: ${text}` : "";
}

function printText(result) {
  if (result.pass) {
    console.log("Done gate passed.");
  } else {
    console.error("Done gate failed:\n");
    for (const error of result.errors) console.error(`- ${error}`);
  }

  if (result.warnings.length) {
    console.warn("\nWarnings:");
    for (const warning of result.warnings) console.warn(`- ${warning}`);
  }
}

function printHelp() {
  console.log(`done-gate - end-of-run verification for Manuscript Lab

Usage:
  npm run done
  node scripts/done-gate.mjs [options]

Checks:
  - static document checks pass
  - strict template audit passes
  - strict context hygiene audit passes
  - reader exports are regenerated unless --skip-exports is set
  - all runtime packets are fresh
  - no open or deferred issues remain
  - latest persisted review runs have no errors
  - active project filesystem is synced and verified under projects/active/
  - configured export formats exist unless --skip-exports is set

Options:
  --skip-exports     Do not require readable exports
  --no-export        Alias for --skip-exports
  --export-formats md,html,epub,pdf
                     Export formats required by this run. Default: md,html,epub,pdf
  --export-slug name Override export filename stem for the regenerated exports
  --export-out dir   Override export output directory
  --include-todo-exports
                     Include todo draft shells when regenerating exports
  --require-done     Require every active section status to be done
  --warn-review-errors
                     Report persisted review run errors as warnings instead of failures
  --json             Print machine-readable output
  --help             Show this help
`);
}
