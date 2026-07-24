#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { lockPathFor, withFileLock, writeJsonAtomic } from "./lib/files.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { ISSUE_CLOSED_SCHEMA_VERSION, ISSUE_DECISIONS_SCHEMA_VERSION } from "./lib/required-scaffolding.mjs";

const ISSUE_CATEGORIES = new Set(["confusion", "continuity", "structure", "style", "science", "evidence", "pacing", "other"]);
const ISSUE_SEVERITIES = new Set(["blocker", "major", "minor", "note"]);
const ISSUE_DECISIONS = new Set(["accept", "reject", "defer", "merge", "convert_to_check", "manual_review_needed"]);
const STATUS_BY_DECISION = {
  accept: "accepted",
  reject: "rejected",
  defer: "deferred",
  merge: "merged",
  convert_to_check: "converted",
  manual_review_needed: "manual_review_needed",
};

const discovery = discoverProtocol({ cwd: process.cwd() });
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const args = process.argv.slice(2);
const command = args[0] ?? "help";
const rest = args.slice(1);

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "init") {
  ensureLedgers();
  console.log("Issue ledger initialized.");
  process.exit(0);
}

if (command === "list") {
  ensureLedgers();
  const options = parseOptions(rest);
  const ledger = loadLedger();
  const status = options.status ?? "open";
  const issues = filterIssues(ledger.issues, { ...options, status });
  printIssueList(issues);
  process.exit(0);
}

if (command === "add") {
  ensureLedgers();
  const options = parseOptions(rest);
  const target = normalizeTargetOption(options.target ?? "");
  if (!target) fail('add requires --target draft/<section>.md');
  const note = String(options.note ?? "").trim();
  if (!note) fail('add requires --note "what the reader hits here"');
  const category = String(options.category ?? "other");
  if (!ISSUE_CATEGORIES.has(category)) fail(`--category must be ${[...ISSUE_CATEGORIES].join("|")}`);
  const severity = String(options.severity ?? "minor");
  if (!ISSUE_SEVERITIES.has(severity)) fail(`--severity must be ${[...ISSUE_SEVERITIES].join("|")}`);
  const issue = addManualIssue({
    target,
    note,
    category,
    severity,
    quote: String(options.quote ?? ""),
    why: String(options.why ?? ""),
    fix: String(options.fix ?? ""),
  });
  console.log(`${issue.id}: open (${severity}/${category}) ${target}`);
  process.exit(0);
}

if (command === "show") {
  ensureLedgers();
  const id = rest[0];
  const issue = findIssue(id);
  if (!issue) fail(`Issue not found: ${id}`);
  console.log(JSON.stringify(issue, null, 2));
  process.exit(0);
}

if (command === "stats") {
  ensureLedgers();
  const options = parseOptions(rest);
  const ledger = loadLedger();
  const issues = filterIssues(ledger.issues, { ...options, status: options.status ?? "all" });
  const counts = {};
  for (const issue of issues) counts[issue.status] = (counts[issue.status] ?? 0) + 1;
  console.log(JSON.stringify({ total: issues.length, by_status: counts }, null, 2));
  process.exit(0);
}

if (command === "batch") {
  ensureLedgers();
  const options = parseOptions(rest);
  try {
    const operations = parseBatchOperations(readBatchInput(options));
    const result = applyBatchOperations(operations, { dryRun: Boolean(options.dryRun) });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const verb = result.dry_run ? "Validated" : "Applied";
      console.log(
        `${verb} ${result.operation_count} issue operation(s): ${result.decision_count} decision(s), ${result.close_count} closure(s), ${result.skipped_count} already applied.`,
      );
    }
  } catch (error) {
    fail(error.message);
  }
  process.exit(0);
}

if (command === "decide") {
  ensureLedgers();
  const id = rest[0];
  const options = parseOptions(rest.slice(1));
  const decision = options.decision;
  if (!ISSUE_DECISIONS.has(decision)) {
    fail("--decision must be accept, reject, defer, merge, convert_to_check, or manual_review_needed");
  }
  try {
    updateDecision(id, {
      decision,
      reason: options.reason ?? "",
      revision_instruction: options.revisionInstruction ?? options.revision_instruction ?? "",
      merge_into: options.mergeInto ?? options.merge_into ?? "",
    });
  } catch (error) {
    fail(error.message);
  }
  console.log(`${id}: ${decision}`);
  process.exit(0);
}

if (command === "close") {
  ensureLedgers();
  const id = rest[0];
  const options = parseOptions(rest.slice(1));
  try {
    closeIssue(id, options.reason ?? "Closed after verification.");
  } catch (error) {
    fail(error.message);
  }
  console.log(`${id}: closed`);
  process.exit(0);
}

fail(`Unknown command: ${command}`);

function ensureLedgers() {
  fs.mkdirSync(abs("state/issues"), { recursive: true });
  withFileLock(issueLedgerLockPath(), () => {
    ensureJson("state/issues/issue-ledger.json", { version: 1, next_id: 1, issues: [] });
    ensureJson("state/issues/decisions.json", { schema_version: ISSUE_DECISIONS_SCHEMA_VERSION, version: 1, decisions: [] });
    ensureJson("state/issues/closed.json", { schema_version: ISSUE_CLOSED_SCHEMA_VERSION, version: 1, closed: [] });
  });
}

function updateDecision(id, decisionRecord) {
  withFileLock(issueLedgerLockPath(), () => {
    const ledger = loadLedger();
    const decisions = loadJson(abs("state/issues/decisions.json"));
    decisions.schema_version = decisions.schema_version ?? ISSUE_DECISIONS_SCHEMA_VERSION;
    decisions.decisions = Array.isArray(decisions.decisions) ? decisions.decisions : [];
    applyDecisionToState({ ledger, decisions }, id, decisionRecord, new Date().toISOString());
    saveLedger(ledger);
    saveJson("state/issues/decisions.json", decisions);
  });
}

function closeIssue(id, reason) {
  withFileLock(issueLedgerLockPath(), () => {
    const ledger = loadLedger();
    const closed = loadJson(abs("state/issues/closed.json"));
    closed.schema_version = closed.schema_version ?? ISSUE_CLOSED_SCHEMA_VERSION;
    closed.closed = Array.isArray(closed.closed) ? closed.closed : [];
    applyCloseToState({ ledger, closed }, id, reason, new Date().toISOString());
    saveLedger(ledger);
    saveJson("state/issues/closed.json", closed);
  });
}

function applyBatchOperations(operations, { dryRun = false } = {}) {
  return withFileLock(issueLedgerLockPath(), () => {
    const ledger = loadLedger();
    const decisions = loadJson(abs("state/issues/decisions.json"));
    decisions.schema_version = decisions.schema_version ?? ISSUE_DECISIONS_SCHEMA_VERSION;
    decisions.decisions = Array.isArray(decisions.decisions) ? decisions.decisions : [];
    const closed = loadJson(abs("state/issues/closed.json"));
    closed.schema_version = closed.schema_version ?? ISSUE_CLOSED_SCHEMA_VERSION;
    closed.closed = Array.isArray(closed.closed) ? closed.closed : [];

    const knownIds = new Set(ledger.issues.map((issue) => issue.id));
    for (const operation of operations) {
      if (!knownIds.has(operation.id)) throw new Error(`Issue not found: ${operation.id}`);
    }

    const results = [];
    for (const operation of operations) {
      const now = new Date().toISOString();
      if (operation.action === "decide") {
        results.push(applyDecisionToState({ ledger, decisions }, operation.id, operation, now, { idempotent: true }));
      } else {
        results.push(applyCloseToState({ ledger, closed }, operation.id, operation.reason, now, { idempotent: true }));
      }
    }

    if (!dryRun) {
      // The one ledger lock covers the complete operation set, so another
      // agent cannot interleave mutations between batch entries.
      saveLedger(ledger);
      saveJson("state/issues/decisions.json", decisions);
      saveJson("state/issues/closed.json", closed);
    }

    return {
      ok: true,
      dry_run: dryRun,
      operation_count: operations.length,
      decision_count: operations.filter((operation) => operation.action === "decide").length,
      close_count: operations.filter((operation) => operation.action === "close").length,
      skipped_count: results.filter((result) => result.skipped).length,
      results,
    };
  });
}

function applyDecisionToState({ ledger, decisions }, id, decisionRecord, now, { idempotent = false } = {}) {
  const issue = requireIssue(ledger, id);
  if (idempotent && sameDecision(issue.decision, decisionRecord)) {
    return { action: "decide", id, status: issue.status, decision: decisionRecord.decision, skipped: true };
  }
  const decision = {
    issue_id: id,
    decision: decisionRecord.decision,
    reason: decisionRecord.reason ?? "",
    revision_instruction: decisionRecord.revision_instruction ?? "",
    merge_into: decisionRecord.merge_into ?? "",
    decided_at: now,
  };
  issue.status = STATUS_BY_DECISION[decisionRecord.decision];
  issue.decision = decision;
  issue.updated_at = now;
  issue.history = issue.history ?? [];
  issue.history.push({ at: now, action: "decided", decision });
  decisions.decisions.push(decision);
  return { action: "decide", id, status: issue.status, decision: decisionRecord.decision, skipped: false };
}

function applyCloseToState({ ledger, closed }, id, reason, now, { idempotent = false } = {}) {
  const issue = requireIssue(ledger, id);
  if (idempotent && issue.status === "closed" && issue.close_reason === reason) {
    return { action: "close", id, status: issue.status, skipped: true };
  }
  issue.status = "closed";
  issue.closed_at = now;
  issue.updated_at = now;
  issue.close_reason = reason;
  issue.history = issue.history ?? [];
  issue.history.push({ at: now, action: "closed", reason });
  closed.closed.push({ issue_id: id, closed_at: now, reason });
  return { action: "close", id, status: issue.status, skipped: false };
}

function requireIssue(ledger, id) {
  const issue = ledger.issues.find((candidate) => candidate.id === id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  return issue;
}

function sameDecision(existing, operation) {
  return Boolean(
    existing &&
    existing.decision === operation.decision &&
    existing.reason === (operation.reason ?? "") &&
    existing.revision_instruction === (operation.revision_instruction ?? "") &&
    existing.merge_into === (operation.merge_into ?? ""),
  );
}

function readBatchInput(options) {
  if (options.file === true) throw new Error("batch --file requires a path or - for stdin.");
  if (options.file && options.file !== "-") {
    const file = path.resolve(process.cwd(), String(options.file));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Batch file not found: ${options.file}`);
    return fs.readFileSync(file, "utf8");
  }
  return fs.readFileSync(0, "utf8");
}

function parseBatchOperations(input) {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("Batch input is empty. Pass --file <json-or-jsonl> or pipe operations on stdin.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    } catch (error) {
      throw new Error(`Batch input must be a JSON array/object or JSONL: ${error.message}`);
    }
  }
  const operations = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.operations) ? parsed.operations : [parsed];
  if (!operations.length) throw new Error("Batch input contains no operations.");
  return operations.map(normalizeBatchOperation);
}

function normalizeBatchOperation(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Batch operation ${index + 1} must be an object.`);
  const action = String(raw.action ?? "").trim();
  const id = String(raw.id ?? raw.issue_id ?? "").trim();
  if (!["decide", "close"].includes(action)) throw new Error(`Batch operation ${index + 1}: action must be decide or close.`);
  if (!id) throw new Error(`Batch operation ${index + 1}: id is required.`);
  if (action === "close") {
    return { action, id, reason: String(raw.reason ?? "Closed after verification.") };
  }
  const decision = String(raw.decision ?? "").trim();
  if (!ISSUE_DECISIONS.has(decision)) {
    throw new Error(
      `Batch operation ${index + 1}: decision must be accept, reject, defer, merge, convert_to_check, or manual_review_needed.`,
    );
  }
  return {
    action,
    id,
    decision,
    reason: String(raw.reason ?? ""),
    revision_instruction: String(raw.revision_instruction ?? raw.revisionInstruction ?? ""),
    merge_into: String(raw.merge_into ?? raw.mergeInto ?? ""),
  };
}

// Manual issues share the model-review record shape so list/decide/revise
// treat them identically; only the source type differs.
function addManualIssue({ target, note, category, severity, quote, why, fix }) {
  return withFileLock(issueLedgerLockPath(), () => {
    const ledger = loadLedger();
    const now = new Date().toISOString();
    const id = `issue_${new Date().getUTCFullYear()}_${String(ledger.next_id).padStart(5, "0")}`;
    ledger.next_id += 1;
    const source = { type: "manual", created_at: now };
    const issue = {
      id,
      status: "open",
      created_at: now,
      updated_at: now,
      fingerprint: `manual-${id}`,
      source,
      sources: [source],
      target: { file: target, quote, start_line: null, end_line: null },
      category,
      severity,
      confidence: 1,
      observation_count: 1,
      related_fingerprints: [],
      claim: note,
      evidence: "",
      why_it_matters: why,
      recommended_action: fix,
      fix_options: [],
      decision: null,
      history: [{ at: now, action: "opened", source }],
    };
    ledger.issues.push(issue);
    saveLedger(ledger);
    return issue;
  });
}

function printIssueList(issues) {
  if (!issues.length) {
    console.log("No issues.");
    return;
  }

  for (const issue of issues) {
    const loc = issue.target?.start_line ? `${issue.target.file}:${issue.target.start_line}` : issue.target?.file ?? "(unknown)";
    console.log(`${issue.id} [${issue.status}] ${issue.severity}/${issue.category} ${loc}`);
    console.log(`  ${issue.claim}`);
  }
}

function filterIssues(issues, options) {
  const target = normalizeTargetOption(options.target ?? "");
  const status = options.status ?? "open";
  const category = options.category ?? "";
  const severity = options.severity ?? "";

  return issues.filter((issue) => {
    if (status !== "all" && issue.status !== status) return false;
    if (target && issue.target?.file !== target) return false;
    if (category && issue.category !== category) return false;
    if (severity && issue.severity !== severity) return false;
    return true;
  });
}

function findIssue(id) {
  if (!id) return null;
  return loadLedger().issues.find((issue) => issue.id === id) ?? null;
}

function loadLedger() {
  const ledger = loadJson(abs("state/issues/issue-ledger.json"));
  ledger.version = ledger.version ?? 1;
  ledger.next_id = ledger.next_id ?? 1;
  ledger.issues = Array.isArray(ledger.issues) ? ledger.issues : [];
  return ledger;
}

function saveLedger(ledger) {
  saveJson("state/issues/issue-ledger.json", ledger);
}

function ensureJson(rel, value) {
  const file = abs(rel);
  if (!fs.existsSync(file)) saveJson(rel, value);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(rel, value) {
  writeJsonAtomic(abs(rel), value);
}

function parseOptions(rawArgs) {
  const options = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const equalsIndex = arg.indexOf("=");
    const rawKey = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (equalsIndex !== -1) {
      options[key] = arg.slice(equalsIndex + 1);
      continue;
    }

    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function normalizeTargetOption(value) {
  if (!value) return "";
  const raw = String(value);
  if (!raw.endsWith(".md")) return raw;
  return displayPath(paths.resolveProjectInput(raw));
}

function printHelp() {
  console.log(`issues - manage durable editorial issues

Usage:
  mlab issues init
  mlab issues add --target draft/file.md --note "what the reader hits" [--category structure] [--severity major] [--quote "..."] [--why "..."] [--fix "..."]
  mlab issues list [--status open|accepted|rejected|deferred|closed|all] [--target draft/file.md]
  mlab issues show <issue_id>
  mlab issues stats [--target draft/file.md]
  mlab issues decide <issue_id> --decision accept --reason "..." --revision-instruction "..."
  mlab issues close <issue_id> --reason "..."
  mlab issues batch [--file operations.json|operations.jsonl|-] [--dry-run] [--json]

Filters:
  --target draft/file.md
  --category confusion|continuity|structure|style|science|evidence|pacing|other
  --severity blocker|major|minor|note

Decisions:
  accept, reject, defer, merge, convert_to_check, manual_review_needed

Batch input is a JSON array, {"operations": [...]}, one operation object, or
JSONL. Pipe input on stdin by default. Operations use:
  {"action":"decide","id":"issue_...","decision":"accept","reason":"..."}
  {"action":"close","id":"issue_...","reason":"Verified."}

The complete batch is validated before writing and runs under one ledger lock.
Exact retries are skipped, so agents can safely retry after an interrupted call.

Model reviews (mlab review run) file issues automatically; add is the manual
entry point for what a human editor spots.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function abs(rel) {
  return paths.projectAbs(rel);
}

function issueLedgerLockPath() {
  return lockPathFor(abs("state/issues/issue-ledger.json"));
}

function displayPath(file) {
  return paths.projectRel(file);
}
