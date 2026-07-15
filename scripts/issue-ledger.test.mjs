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

function initWorkspace(name) {
  const workspace = path.join(tmp, name);
  fs.mkdirSync(workspace, { recursive: true });
  const init = run(["init"], workspace);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return workspace;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
}
