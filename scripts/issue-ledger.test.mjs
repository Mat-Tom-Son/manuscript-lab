#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const bin = path.join(repoRoot, "bin/manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-issues-"));

try {
  testManualIssueLifecycle();
  testAddValidation();
  testBatchLifecycle();
  console.log("issue-ledger tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testManualIssueLifecycle() {
  const workspace = initWorkspace("lifecycle");

  const added = run(["issues", "add", "--target", "draft/01-opening.md", "--note", "Opening buries the promise", "--category", "structure", "--severity", "major", "--why", "Cold readers skim"], workspace);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  assert.match(added.stdout, /^issue_\d{4}_00001: open \(major\/structure\) draft\/01-opening\.md/);

  const listed = run(["issues", "list"], workspace);
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /issue_\d{4}_00001 \[open\] major\/structure draft\/01-opening\.md/);
  assert.match(listed.stdout, /Opening buries the promise/);

  const ledger = JSON.parse(fs.readFileSync(path.join(workspace, "manuscript/state/issues/issue-ledger.json"), "utf8"));
  assert.equal(ledger.issues.length, 1);
  assert.equal(ledger.issues[0].source.type, "manual");
  assert.equal(ledger.issues[0].why_it_matters, "Cold readers skim");
  assert.equal(ledger.next_id, 2);

  const id = ledger.issues[0].id;
  const decided = run(["issues", "decide", id, "--decision", "accept", "--reason", "Real problem", "--revision-instruction", "Lead with the promise"], workspace);
  assert.equal(decided.status, 0, decided.stderr || decided.stdout);

  const stats = run(["issues", "stats"], workspace);
  assert.equal(JSON.parse(stats.stdout).by_status.accepted, 1);
}

function testAddValidation() {
  const workspace = initWorkspace("validation");

  const noTarget = run(["issues", "add", "--note", "x"], workspace);
  assert.equal(noTarget.status, 1);
  assert.match(noTarget.stderr, /requires --target/);

  const noNote = run(["issues", "add", "--target", "draft/01-opening.md"], workspace);
  assert.equal(noNote.status, 1);
  assert.match(noNote.stderr, /requires --note/);

  const badCategory = run(["issues", "add", "--target", "draft/01-opening.md", "--note", "x", "--category", "vibes"], workspace);
  assert.equal(badCategory.status, 1);
  assert.match(badCategory.stderr, /--category must be/);

  const badSeverity = run(["issues", "add", "--target", "draft/01-opening.md", "--note", "x", "--severity", "catastrophic"], workspace);
  assert.equal(badSeverity.status, 1);
  assert.match(badSeverity.stderr, /--severity must be/);
}

function testBatchLifecycle() {
  const workspace = initWorkspace("batch");
  for (const note of ["First issue", "Second issue"]) {
    const added = run(["issues", "add", "--target", "draft/01-opening.md", "--note", note], workspace);
    assert.equal(added.status, 0, added.stderr || added.stdout);
  }
  const ledgerFile = path.join(workspace, "manuscript/state/issues/issue-ledger.json");
  const decisionsFile = path.join(workspace, "manuscript/state/issues/decisions.json");
  const closedFile = path.join(workspace, "manuscript/state/issues/closed.json");
  const ids = JSON.parse(fs.readFileSync(ledgerFile, "utf8")).issues.map((issue) => issue.id);
  const operations = ids.flatMap((id) => [
    { action: "decide", id, decision: "accept", reason: "Confirmed in batch." },
    { action: "close", id, reason: "Verified in batch." },
  ]);
  const input = operations.map((operation) => JSON.stringify(operation)).join("\n");

  const dryRun = run(["issues", "batch", "--dry-run", "--json"], workspace, input);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(JSON.parse(dryRun.stdout).operation_count, 4);
  assert(JSON.parse(dryRun.stdout).dry_run);
  assert(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).issues.every((issue) => issue.status === "open"));

  const applied = run(["issues", "batch", "--json"], workspace, input);
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.operation_count, 4);
  assert.equal(result.decision_count, 2);
  assert.equal(result.close_count, 2);
  assert.equal(result.skipped_count, 0);
  assert(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).issues.every((issue) => issue.status === "closed"));
  assert.equal(JSON.parse(fs.readFileSync(decisionsFile, "utf8")).decisions.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(closedFile, "utf8")).closed.length, 2);

  const retried = run(["issues", "batch", "--json"], workspace, input);
  assert.equal(retried.status, 0, retried.stderr || retried.stdout);
  assert.equal(JSON.parse(retried.stdout).skipped_count, 4, "exact batch retries should be idempotent");
  assert.equal(JSON.parse(fs.readFileSync(decisionsFile, "utf8")).decisions.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(closedFile, "utf8")).closed.length, 2);

  const invalid = JSON.stringify([
    { action: "decide", id: ids[0], decision: "reject", reason: "Must not partially apply." },
    { action: "close", id: "issue_missing", reason: "Invalid." },
  ]);
  const rejected = run(["issues", "batch", "--json"], workspace, invalid);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Issue not found: issue_missing/);
  const afterRejected = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
  assert.equal(afterRejected.issues[0].decision.decision, "accept", "invalid batches must not partially mutate earlier operations");
}

function initWorkspace(name) {
  const workspace = path.join(tmp, name);
  fs.mkdirSync(workspace, { recursive: true });
  const init = run(["init"], workspace);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return workspace;
}

function run(args, cwd, input = undefined) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", input });
}
