#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";

const discovery = discoverProtocol({ cwd: process.cwd() });
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const options = parseArgs(process.argv.slice(2));

if (options.help || !options.target) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

const target = resolveInputPath(options.target);
if (!fs.existsSync(target)) fail(`Target file does not exist: ${displayPath(target)}`);

const targetText = read(target);
const contract = parseSectionContract(targetText);
const sectionId = safeId(contract.fields.id || path.basename(target, path.extname(target)));
const runDirRel = resolveRunDir(sectionId, options.run, options.out);
const runDir = abs(runDirRel);
const manifest = loadJson(path.join(runDir, "manifest.json"));
const candidateMeta = loadJson(path.join(runDir, "candidate-meta.json"));
const issueContext = loadJsonSafe(path.join(runDir, "issue-context.json"), { issue_ids: [], issues: [] });
const decision = loadJsonSafe(path.join(runDir, "decision.json"), null);
const tasteGateFileRel = normalizeRel(path.join(runDirRel, "taste-arbiter.json"));
const tasteGateLoad = loadOptionalJson(path.join(runDir, "taste-arbiter.json"));
const tasteGate = tasteGateLoad.value;
const candidateId = options.candidate || decision?.winner || "";

if (!candidateId) {
  fail(`No winner found in ${runDirRel}/decision.json. Pass --candidate <candidate-id> after manual review.`);
}

const candidate = loadCandidate(candidateMeta, candidateId);
if (!candidate) fail(`Candidate not found or not materialized: ${candidateId}`);

const winnerText = read(resolveInputPath(candidate.file));
const sourceIntegrity = sourceIntegrityForRun({ manifest, candidateMeta, currentText: targetText });
const winnerFileRel = normalizeRel(path.join(runDirRel, "winner.md"));
const backupFileRel = normalizeRel(path.join(runDirRel, "before-apply.md"));
const mergeResultFileRel = normalizeRel(path.join(runDirRel, "merge-result.json"));
const mode = options.apply ? "applied" : "preview";
const changed = hashText(targetText) !== hashText(winnerText);
const selectedBy = options.candidate ? "manual_candidate_flag" : "decision_file";

if (options.apply && !sourceIntegrity.can_apply && !options.force) {
  fail(sourceIntegrity.reason);
}

writeFile(winnerFileRel, winnerText);

if (options.apply && tasteGateLoad.status === "invalid" && !options.force) {
  fail(
    `Taste arbiter gate is unreadable for ${manifest.run_id}: ${tasteGateLoad.error}. ` +
      "Run npm run taste:arbiter again, remove the corrupted gate file deliberately, or pass --force for a human override.",
  );
}

if (options.apply && tasteGate && !tasteGate?.gate?.can_apply && !options.force) {
  fail(
    `Taste arbiter gate is ${tasteGate.gate?.disposition || "not passable"} for ${manifest.run_id}. ` +
      "Run npm run taste:arbiter again after patching, choose another candidate, or pass --force for a deliberate human override.",
  );
}

const result = {
  version: 1,
  run_id: manifest.run_id,
  created_at: new Date().toISOString(),
  target: displayPath(target),
  section_id: sectionId,
  mode,
  applied: options.apply,
  changed,
  selected_candidate: candidateId,
  selected_by: selectedBy,
  source_integrity: sourceIntegrity,
  decision: decision
    ? {
        decision: decision.decision,
        winner: decision.winner,
        confidence: decision.confidence,
        recommended_action: decision.recommended_action,
        reason: decision.reason,
      }
    : null,
  taste_gate: tasteGate
    ? {
        disposition: tasteGate.gate?.disposition ?? "",
        can_apply: Boolean(tasteGate.gate?.can_apply),
        recommended_action: tasteGate.gate?.recommended_action ?? "",
        reason: tasteGate.gate?.reason ?? "",
        file: tasteGateFileRel,
      }
    : tasteGateLoad.status === "invalid"
      ? {
          disposition: "unreadable",
          can_apply: false,
          recommended_action: "rerun_taste_arbiter",
          reason: tasteGateLoad.error,
          file: tasteGateFileRel,
        }
    : null,
  issue_ids: issueContext.issue_ids ?? [],
  files: {
    candidate: candidate.file,
    winner: winnerFileRel,
    backup_before_apply: options.apply ? backupFileRel : "",
    merge_result: mergeResultFileRel,
  },
  audit: null,
  next: [],
};

if (options.apply) {
  writeFile(backupFileRel, targetText);
  writeFile(displayPath(target), winnerText);
  result.next.push(cliCommand("diff:audit", ["--before", backupFileRel, "--after", displayPath(target), firstIssueId(issueContext) ? `--issue ${firstIssueId(issueContext)}` : ""]));
  result.next.push(cliCommand("check", [displayPath(target)]));

  if (options.audit) {
    result.audit = runDiffAudit({ before: backupFileRel, after: displayPath(target), issue: firstIssueId(issueContext) });
  }
} else {
  result.next.push(`Inspect ${winnerFileRel}`);
  result.next.push(cliCommand("taste:arbiter", [manifest.target, "--run", manifest.run_id]));
  result.next.push(cliCommand("merge:winner", [displayPath(target), "--run", manifest.run_id, "--apply"]));
}

writeJson(mergeResultFileRel, result);
writeFile(normalizeRel(path.join(runDirRel, "MERGE.md")), renderMergeMarkdown(result));

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${mode}: ${candidateId} -> ${winnerFileRel}`);
  console.log(`merge result: ${mergeResultFileRel}`);
  if (options.apply) {
    console.log(`backup: ${backupFileRel}`);
    if (result.audit?.status === "ran") console.log(`audit: ${result.audit.stdout.trim().split("\n")[0] ?? "done"}`);
    if (result.audit?.status === "failed") console.log(`audit failed: ${result.audit.error || result.audit.stderr}`);
  } else {
    console.log("Manuscript not changed. Re-run with --apply to write the winner into the draft.");
  }
  for (const next of result.next) console.log(`next: ${next}`);
}

function loadCandidate(meta, id) {
  const candidates = Array.isArray(meta.candidates) ? meta.candidates : [];
  const candidate = candidates.find((item) => item.candidate_id === id);
  if (!candidate || candidate.error) return null;
  const file = resolveInputPath(candidate.file);
  return fs.existsSync(file) ? candidate : null;
}

function runDiffAudit({ before, after, issue }) {
  const script = paths.packageAbs("scripts/revision-diff-audit.mjs");
  const args = [script, "--before", before, "--after", after];
  if (issue) args.push("--issue", issue);
  if (options.staticOnly) args.push("--static-only");
  if (options.model) args.push("--model", options.model);
  const result = spawnSync(process.execPath, args, {
    cwd: discovery.manuscriptRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status === 0 ? "ran" : "failed",
    command: `node ${["scripts/revision-diff-audit.mjs", ...args.slice(1)].join(" ")}`,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? "",
  };
}

function renderMergeMarkdown(result) {
  const lines = [
    "# Candidate Merge",
    "",
    `Run ID: \`${result.run_id}\``,
    `Target: \`${result.target}\``,
    `Mode: \`${result.mode}\``,
    `Selected candidate: \`${result.selected_candidate}\``,
    `Changed target: \`${result.changed}\``,
  ];
  if (result.decision) {
    lines.push(`Decision: \`${result.decision.decision}\``);
    if (result.decision.confidence) lines.push(`Confidence: \`${result.decision.confidence}\``);
    if (result.decision.reason) lines.push("", "## Decision Reason", "", result.decision.reason);
  }
  if (result.taste_gate) {
    lines.push("", "## Taste Gate", "", `Disposition: \`${result.taste_gate.disposition}\``, `Can apply: \`${result.taste_gate.can_apply}\``);
    if (result.taste_gate.reason) lines.push("", result.taste_gate.reason);
  }
  if (result.source_integrity) {
    lines.push(
      "",
      "## Source Integrity",
      "",
      `Status: \`${result.source_integrity.status}\``,
      `Recorded source SHA-256: \`${result.source_integrity.recorded_source_sha256 || "(missing)"}\``,
      `Current source SHA-256: \`${result.source_integrity.current_source_sha256}\``,
    );
    if (result.source_integrity.reason) lines.push("", result.source_integrity.reason);
  }
  lines.push("", "## Files", "");
  for (const [key, file] of Object.entries(result.files)) {
    if (file) lines.push(`- ${key}: \`${file}\``);
  }
  if (result.audit) {
    lines.push("", "## Audit", "", `Status: \`${result.audit.status}\``, `Command: \`${result.audit.command}\``);
  }
  if (result.next.length) {
    lines.push("", "## Next", "");
    for (const next of result.next) lines.push(`- \`${next}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function resolveRunDir(id, requestedRun, out) {
  const sectionDir = resolveInputPath(path.join(out, id));
  if (requestedRun) {
    const run = path.isAbsolute(requestedRun) ? requestedRun : path.join(sectionDir, requestedRun);
    if (!fs.existsSync(run)) fail(`Candidate run not found: ${requestedRun}`);
    return displayPath(run);
  }

  if (!fs.existsSync(sectionDir)) fail(`No candidate runs found for ${id}.`);
  const runs = fs
    .readdirSync(sectionDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sectionDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "manifest.json")))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  if (!runs.length) fail(`No candidate runs found for ${id}.`);
  return displayPath(runs[0]);
}

function firstIssueId(issueContext) {
  const ids = issueContext.issue_ids ?? issueContext.issues?.map((issue) => issue.id) ?? [];
  return ids[0] ?? "";
}

function sourceIntegrityForRun({ manifest, candidateMeta, currentText }) {
  const recorded = String(manifest.source_sha256 || candidateMeta.source_sha256 || "").trim();
  const current = hashText(currentText);
  if (!recorded) {
    return {
      status: "missing_source_hash",
      can_apply: false,
      recorded_source_sha256: "",
      current_source_sha256: current,
      reason:
        `Candidate run ${manifest.run_id} does not record source_sha256. ` +
        "Regenerate candidates from the current draft, or pass --force for a deliberate legacy-run override.",
    };
  }
  if (recorded !== current) {
    return {
      status: "source_mismatch",
      can_apply: false,
      recorded_source_sha256: recorded,
      current_source_sha256: current,
      reason:
        `Candidate run ${manifest.run_id} was generated from a different draft state. ` +
        `recorded=${recorded} current=${current}. Regenerate candidates, or pass --force to overwrite deliberately.`,
    };
  }
  return {
    status: "ok",
    can_apply: true,
    recorded_source_sha256: recorded,
    current_source_sha256: current,
    reason: "",
  };
}

function parseSectionContract(text) {
  const match = text.match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return { fields: {} };
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  return { fields };
}

function parseArgs(args) {
  const parsed = {
    target: "",
    run: "",
    candidate: "",
    out: "state/candidates",
    apply: false,
    audit: false,
    staticOnly: false,
    model: "",
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--audit") parsed.audit = true;
    else if (arg === "--static-only") parsed.staticOnly = true;
    else if (arg === "--run") parsed.run = args[++index] ?? "";
    else if (arg.startsWith("--run=")) parsed.run = arg.slice("--run=".length);
    else if (arg === "--out") parsed.out = normalizeRel(args[++index] ?? parsed.out);
    else if (arg.startsWith("--out=")) parsed.out = normalizeRel(arg.slice("--out=".length));
    else if (arg === "--candidate") parsed.candidate = args[++index] ?? "";
    else if (arg.startsWith("--candidate=")) parsed.candidate = arg.slice("--candidate=".length);
    else if (arg === "--model") parsed.model = args[++index] ?? "";
    else if (arg.startsWith("--model=")) parsed.model = arg.slice("--model=".length);
    else if (!parsed.target) parsed.target = arg;
    else fail(`Unexpected argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`merge-winner - materialize or apply a revision candidate arena winner

Usage:
  npm run merge:winner -- draft/<section>.md --run <candidate-run-id>
  npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit

Options:
  --run id          Candidate run ID. Defaults to latest run for the section.
  --candidate id    Override decision.json and select a candidate manually.
  --out dir         Candidate root directory. Default: state/candidates.
  --apply           Replace the target draft with the selected winner.
  --force           Apply despite a stale/missing source hash or blocking taste gate.
  --audit           After --apply, run revision.diff_audit on the before/after pair.
  --static-only     Pass --static-only to the diff audit.
  --model id        Pass a model ID to the diff audit.
  --json            Print machine-readable result.
  --help, -h        Show this help.
`);
}

function loadJson(file) {
  return JSON.parse(read(file));
}

function loadJsonSafe(file, fallback) {
  try {
    return JSON.parse(read(file));
  } catch {
    return fallback;
  }
}

function loadOptionalJson(file) {
  if (!fs.existsSync(file)) return { status: "missing", value: null, error: "" };
  try {
    return { status: "ok", value: JSON.parse(read(file)), error: "" };
  } catch (error) {
    return { status: "invalid", value: null, error: error.message };
  }
}

function writeJson(rel, value) {
  writeFile(rel, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(rel, value) {
  const file = abs(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function safeId(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function resolveInputPath(input) {
  return paths.resolveProjectInputOrCwd(input);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function abs(rel) {
  return paths.projectAbs(rel);
}

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function displayPath(file) {
  return paths.projectRel(file);
}

function cliCommand(command, commandArgs = []) {
  const args = commandArgs.filter(Boolean).join(" ");
  return discovery.mode === "installed" ? `mlab ${command}${args ? ` ${args}` : ""}` : `npm run ${command} --${args ? ` ${args}` : ""}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
