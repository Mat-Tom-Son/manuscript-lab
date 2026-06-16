#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scanReviewErrors } from "./lib/review-errors.mjs";

const options = normalizeOptions(parseArgs(process.argv.slice(2)));
const unloaded = isWorkspaceUnloaded();

if (options.help) {
  printHelp();
  process.exit(0);
}

const errors = [];
const warnings = [];

const checkResult = unloaded ? skippedResult() : runNode(["scripts/doccheck.mjs", "--static-only"], { capture: true });
if (checkResult.status !== 0) errors.push("Static document checks failed.");

const auditResult = runNode(["scripts/template-audit.mjs", "--strict"], { capture: true });
if (auditResult.status !== 0) errors.push("Reusable template audit failed.");

const contextAuditResult = runNode(["scripts/context-audit.mjs", "--strict"], { capture: true });
if (contextAuditResult.status !== 0) errors.push("Context hygiene audit failed.");

const exportResult = options["skip-exports"] || unloaded ? null : runNode(["scripts/export-manuscript.mjs", "--quiet"], { capture: true });
if (exportResult && exportResult.status !== 0) errors.push("Reader export failed. Run npm run export.");

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

const reviewScan = unloaded ? { failures: [] } : scanReviewErrors("state/reviews");
if (reviewScan.failures.length) {
  const details = reviewScan.failures.slice(0, 5).map((failure) => `${failure.file}${failure.error ? `: ${failure.error}` : ""}`).join("; ");
  const message = `Review run errors remain: ${reviewScan.failures.length}${details ? ` (${details}${reviewScan.failures.length > 5 ? "; ..." : ""})` : ""}`;
  if (options["warn-review-errors"]) warnings.push(message);
  else errors.push(message);
}

const projectSyncResult = unloaded ? skippedResult() : runNode(["scripts/story-workspace.mjs", "sync-project", "--json"], { capture: true });
if (!unloaded && projectSyncResult.status !== 0) {
  errors.push("Project filesystem sync failed. Run npm run project:sync.");
}

const projectResult = runNode(["scripts/story-workspace.mjs", "verify-projects", "--json"], { capture: true });
if (projectResult.status !== 0) {
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
    project_sync: unloaded ? "skipped" : projectSyncResult.status === 0,
    project_filesystem: projectResult.status === 0,
    review_errors: unloaded ? "skipped" : reviewScan.failures.length === 0,
  },
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
    for (const ext of ["md", "html", "epub", "pdf"]) {
      if (!byExt.has(ext)) errors.push(`Missing ${ext.toUpperCase()} export. Run npm run export.`);
    }
  }

}

function runNode(args, { capture }) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function skippedResult() {
  return { status: 0, stdout: "", stderr: "" };
}

function isWorkspaceUnloaded() {
  const workspace = loadJson("state/workspace.json", null);
  const registry = loadJson("projects/registry.json", { active: null });
  return workspace?.status === "unloaded" && workspace?.active === false && !registry.active;
}

function loadJson(file, fallback) {
  const full = path.join(process.cwd(), file);
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
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
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
  - MD, HTML, EPUB, and PDF exports exist unless --skip-exports is set

Options:
  --skip-exports     Do not require readable exports
  --no-export        Alias for --skip-exports
  --require-done     Require every active section status to be done
  --warn-review-errors
                     Report persisted review run errors as warnings instead of failures
  --json             Print machine-readable output
  --help             Show this help
`);
}
