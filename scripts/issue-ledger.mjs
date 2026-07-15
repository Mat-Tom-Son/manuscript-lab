#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { lockPathFor, withFileLock, writeJsonAtomic } from "./lib/files.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { ISSUE_CLOSED_SCHEMA_VERSION, ISSUE_DECISIONS_SCHEMA_VERSION } from "./lib/required-scaffolding.mjs";

const ISSUE_CATEGORIES = new Set(["confusion", "continuity", "structure", "style", "science", "evidence", "pacing", "other"]);
const ISSUE_SEVERITIES = new Set(["blocker", "major", "minor", "note"]);

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

if (command === "decide") {
  ensureLedgers();
  const id = rest[0];
  const options = parseOptions(rest.slice(1));
  const decision = options.decision;
  if (!["accept", "reject", "defer", "merge", "convert_to_check", "manual_review_needed"].includes(decision)) {
    fail("--decision must be accept, reject, defer, merge, convert_to_check, or manual_review_needed");
  }
  updateDecision(id, {
    decision,
    reason: options.reason ?? "",
    revision_instruction: options.revisionInstruction ?? options.revision_instruction ?? "",
    merge_into: options.mergeInto ?? options.merge_into ?? "",
  });
  console.log(`${id}: ${decision}`);
  process.exit(0);
}

if (command === "close") {
  ensureLedgers();
  const id = rest[0];
  const options = parseOptions(rest.slice(1));
  closeIssue(id, options.reason ?? "Closed after verification.");
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
    const issue = ledger.issues.find((candidate) => candidate.id === id);
    if (!issue) fail(`Issue not found: ${id}`);

    const now = new Date().toISOString();
    const statusByDecision = {
      accept: "accepted",
      reject: "rejected",
      defer: "deferred",
      merge: "merged",
      convert_to_check: "converted",
      manual_review_needed: "manual_review_needed",
    };

    const decision = {
      issue_id: id,
      decision: decisionRecord.decision,
      reason: decisionRecord.reason,
      revision_instruction: decisionRecord.revision_instruction,
      merge_into: decisionRecord.merge_into,
      decided_at: now,
    };

    issue.status = statusByDecision[decisionRecord.decision];
    issue.decision = decision;
    issue.updated_at = now;
    issue.history = issue.history ?? [];
    issue.history.push({ at: now, action: "decided", decision });

    saveLedger(ledger);

    const decisions = loadJson(abs("state/issues/decisions.json"));
    decisions.schema_version = decisions.schema_version ?? ISSUE_DECISIONS_SCHEMA_VERSION;
    decisions.decisions = Array.isArray(decisions.decisions) ? decisions.decisions : [];
    decisions.decisions.push(decision);
    saveJson("state/issues/decisions.json", decisions);
  });
}

function closeIssue(id, reason) {
  withFileLock(issueLedgerLockPath(), () => {
    const ledger = loadLedger();
    const issue = ledger.issues.find((candidate) => candidate.id === id);
    if (!issue) fail(`Issue not found: ${id}`);

    const now = new Date().toISOString();
    issue.status = "closed";
    issue.closed_at = now;
    issue.updated_at = now;
    issue.close_reason = reason;
    issue.history = issue.history ?? [];
    issue.history.push({ at: now, action: "closed", reason });
    saveLedger(ledger);

    const closed = loadJson(abs("state/issues/closed.json"));
    closed.schema_version = closed.schema_version ?? ISSUE_CLOSED_SCHEMA_VERSION;
    closed.closed = Array.isArray(closed.closed) ? closed.closed : [];
    closed.closed.push({ issue_id: id, closed_at: now, reason });
    saveJson("state/issues/closed.json", closed);
  });
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

Filters:
  --target draft/file.md
  --category confusion|continuity|structure|style|science|evidence|pacing|other
  --severity blocker|major|minor|note

Decisions:
  accept, reject, defer, merge, convert_to_check, manual_review_needed

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
