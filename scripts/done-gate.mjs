#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureProtocolReady } from "./lib/cli-runtime.mjs";
import { scanReviewErrors } from "./lib/review-errors.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { runGateCli } from "./gate.mjs";

const DONE_SCHEMA = "manuscript-lab.done-gate.v1";

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

const projectSyncResult = unloaded || installedMode ? skippedResult() : runNode(["scripts/story-workspace.mjs", "sync-project", "--json"], { capture: true });
if (!unloaded && !installedMode && projectSyncResult.status !== 0) {
  errors.push("Project filesystem sync failed. Run npm run project:sync.");
}

const exportResult = options["skip-exports"] || unloaded ? null : runNode(["scripts/export-manuscript.mjs", ...exportArgs(options, exportFormats)], { capture: true });
if (exportResult && exportResult.status !== 0) errors.push(`Reader export failed${childSummary(exportResult)}. Run ${installedMode ? "mlab export" : "npm run export"}.`);

const manuscriptGate = unloaded ? null : runDoneGate(["manuscript", "--profile", options.profile || "done", "--json", "--write"]);
if (manuscriptGate?.result) appendGateFindings(manuscriptGate.result);
else if (!unloaded) errors.push(manuscriptGate?.error || "Manuscript gate failed without a result.");

const exportGate = options["skip-exports"] || unloaded
  ? null
  : runDoneGate(["export", "--profile", options.profile || "done", "--formats", exportFormats.join(","), "--json", "--write"]);
if (exportGate?.result) appendGateFindings(exportGate.result);
else if (!options["skip-exports"] && !unloaded) errors.push(exportGate?.error || "Export gate failed without a result.");

const finalProjectSyncResult = unloaded || installedMode ? skippedResult() : runNode(["scripts/story-workspace.mjs", "sync-project", "--json"], { capture: true });
if (!unloaded && !installedMode && finalProjectSyncResult.status !== 0) {
  errors.push("Final project filesystem sync failed after writing gate artifacts. Run npm run project:sync.");
}

const finalProjectVerifyResult = unloaded || installedMode ? skippedResult() : runNode(["scripts/story-workspace.mjs", "verify-projects", "--json"], { capture: true });
if (!unloaded && !installedMode && finalProjectVerifyResult.status !== 0) {
  errors.push("Final project filesystem verification failed after writing gate artifacts.");
}

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

const projectFilesystemCheck = unloaded || installedMode
  ? "skipped"
  : finalProjectVerifyResult.status === 0 && gateRequirementCheck(manuscriptGate?.result, "project.filesystem_verified", false);
const statusValue = gateExitStatus([manuscriptGate?.result, exportGate?.result], errors);
const result = {
  schema_version: DONE_SCHEMA,
  pass: statusValue.exitCode === 0,
  status: statusValue.status,
  exit_code: statusValue.exitCode,
  timestamp: new Date().toISOString(),
  checks: {
    static: gateRequirementCheck(manuscriptGate?.result, "doccheck.static_all_pass", unloaded ? "skipped" : null),
    template_audit: gateRequirementCheck(manuscriptGate?.result, "harness.templates_clean", unloaded ? "skipped" : null),
    context_audit: gateRequirementCheck(manuscriptGate?.result, "harness.context_clean", unloaded ? "skipped" : null),
    exports: options["skip-exports"] || unloaded ? "skipped" : Boolean(exportResult?.status === 0 && exportGate?.result?.ready),
    status: statusResult.status === 0,
    project_sync: unloaded || installedMode ? "skipped" : projectSyncResult.status === 0 && finalProjectSyncResult.status === 0,
    project_filesystem: projectFilesystemCheck,
    review_errors: gateRequirementCheck(manuscriptGate?.result, "reviews.no_latest_errors", unloaded ? "skipped" : null),
  },
  export_formats: options["skip-exports"] || unloaded ? [] : exportFormats,
  gates: {
    manuscript: publicGateResult(manuscriptGate?.result),
    export: publicGateResult(exportGate?.result),
  },
  artifacts: {
    gates: [manuscriptGate?.result?.artifacts, exportGate?.result?.artifacts].filter(Boolean),
  },
  errors,
  warnings,
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printText(result);
}

process.exit(result.exit_code);

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
  if (!activeDrafts.length && !manuscriptGate?.result) warnings.push("No active non-todo draft sections found.");

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

function runDoneGate(args) {
  const outcome = runGateCli(args, {
    cwd: process.cwd(),
    command: `${installedMode ? "mlab" : "npm run"} gate -- ${args.map(shellToken).join(" ")}`,
  });
  return {
    status: outcome.exitCode,
    result: outcome.result,
    error: outcome.stderr || outcome.stdout || "",
  };
}

function appendGateFindings(gate) {
  if (!gate) return;
  for (const error of gate.errors ?? []) errors.push(`${gate.gate_id}: ${error}`);
  for (const warning of gate.warnings ?? []) warnings.push(`${gate.gate_id}: ${warning}`);
  for (const req of gate.requirements ?? []) {
    if (!["fail", "error"].includes(req.status)) continue;
    const message = `${gate.gate_id}/${req.id}: ${req.message}`;
    if (options["warn-review-errors"] && req.id === "reviews.no_latest_errors") warnings.push(message);
    else errors.push(message);
  }
}

function gateRequirementCheck(gate, id, fallback = false) {
  if (!gate) return fallback ?? false;
  const req = (gate.requirements ?? []).find((item) => item.id === id);
  if (!req) return fallback ?? false;
  if (req.status === "skip") return "skipped";
  return req.status === "pass" || req.status === "warn";
}

function gateExitStatus(gates, gateErrors) {
  if (gateErrors.length) {
    const hasEngineError = gates.some((gate) => gate?.exit_code === 2 || gate?.status === "error");
    return { status: hasEngineError ? "error" : "fail", exitCode: hasEngineError ? 2 : 1 };
  }
  return { status: "pass", exitCode: 0 };
}

function publicGateResult(gate) {
  if (!gate) return null;
  return {
    run_id: gate.run_id,
    gate_id: gate.gate_id,
    profile: gate.profile,
    status: gate.status,
    ready: gate.ready,
    exit_code: gate.exit_code,
    target: gate.target,
    summary: gate.summary,
    artifacts: gate.artifacts ?? {},
  };
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
  if (rawOptions["no-contents"]) args.push("--no-contents");
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
  - manuscript-ready gate passes and writes state/gates artifacts
  - reader exports are regenerated unless --skip-exports is set
  - export-ready gate passes and writes state/gates artifacts unless exports are skipped
  - static checks, runtime freshness, issues, latest review errors, template hygiene,
    context hygiene, and project filesystem verification are enforced through gates
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
  --no-contents      Skip generated contents pages in regenerated reader exports
  --profile name     Gate profile label to record. Default: done
  --require-done     Require every active section status to be done
  --warn-review-errors
                     Report persisted review run errors as warnings instead of failures
  --json             Print machine-readable output
  --help             Show this help
`);
}

function shellToken(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
