#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lockPathFor, withFileLock } from "./lib/files.mjs";
import { scanReviewErrors } from "./lib/review-errors.mjs";

const root = process.cwd();
const fixtureRoot = path.join(root, "tmp", `harness-hardening-test-${Date.now()}`);
const targetRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "draft", "01-test.md")));
const candidatesRootRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "candidates")));
const runDirRel = normalizeRel(path.join(candidatesRootRel, "01-test", "run-001"));
const legacyRunDirRel = normalizeRel(path.join(candidatesRootRel, "01-test", "run-legacy"));
const transitionMarker = path.join(root, "state", ".transition.json");
const reviewScanTestDir = path.join(fixtureRoot, "reviews");
let createdTransitionMarker = false;

try {
  setupFixture();
  testFileLockRejectsAsyncCallback();
  testFileLockDoesNotReleaseWithoutOwnerToken();
  await testFileLockSerializesContention();
  testUnknownContextPackFailsClosed();
  testTransitionMarkerRefusesMutatingCommands();
  testReviewErrorsAreSupersededByLaterSuccess();
  testStaleCandidateApplyFailsClosed();
  testMissingSourceHashFailsClosed();
  testCorruptedTasteGateFailsClosed();
  console.log("harness-hardening tests passed");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  if (createdTransitionMarker) fs.rmSync(transitionMarker, { force: true });
}

function setupFixture() {
  mkdir(path.dirname(abs(targetRel)));
  mkdir(abs(runDirRel));
  mkdir(abs(legacyRunDirRel));

  write(
    targetRel,
    `<!--
id: 01-test
kind: fiction.chapter
stage: revision
status: draft
purpose: Test hardening behavior.
-->
# Test

The original line remains.
`,
  );

  const source = read(abs(targetRel));
  const sourceSha256 = sha256(source);
  const candidateText = source.replace("The original line remains.", "The winning line applies.");

  write(path.join(runDirRel, "candidate-a.md"), candidateText);
  writeJson(path.join(runDirRel, "manifest.json"), {
    version: 1,
    run_id: "run-001",
    target: targetRel,
    section_id: "01-test",
    source_sha256: sourceSha256,
  });
  writeJson(path.join(runDirRel, "candidate-meta.json"), {
    version: 1,
    run_id: "run-001",
    target: targetRel,
    section_id: "01-test",
    source_sha256: sourceSha256,
    candidates: [{ candidate_id: "candidate-a", model: "mock", file: normalizeRel(path.join(runDirRel, "candidate-a.md")) }],
  });
  writeJson(path.join(runDirRel, "decision.json"), {
    version: 1,
    decision: "winner_selected",
    winner: "candidate-a",
  });
  writeJson(path.join(runDirRel, "issue-context.json"), {
    version: 1,
    issue_ids: [],
    issues: [],
  });
  write(path.join(runDirRel, "taste-arbiter.json"), "{\n");

  write(path.join(legacyRunDirRel, "candidate-a.md"), candidateText);
  writeJson(path.join(legacyRunDirRel, "manifest.json"), {
    version: 1,
    run_id: "run-legacy",
    target: targetRel,
    section_id: "01-test",
  });
  writeJson(path.join(legacyRunDirRel, "candidate-meta.json"), {
    version: 1,
    run_id: "run-legacy",
    target: targetRel,
    section_id: "01-test",
    candidates: [{ candidate_id: "candidate-a", model: "mock", file: normalizeRel(path.join(legacyRunDirRel, "candidate-a.md")) }],
  });
  writeJson(path.join(legacyRunDirRel, "decision.json"), {
    version: 1,
    decision: "winner_selected",
    winner: "candidate-a",
  });
  writeJson(path.join(legacyRunDirRel, "issue-context.json"), {
    version: 1,
    issue_ids: [],
    issues: [],
  });
}

function testUnknownContextPackFailsClosed() {
  const result = run(["scripts/compose-context.mjs", targetRel, "--context-pack", "blind.section_onl", "--dry-run"]);
  assert.notEqual(result.status, 0, "unknown context pack should fail");
  assert.match(result.stderr, /Unknown context pack: blind\.section_onl/);
}

function testFileLockRejectsAsyncCallback() {
  const dataFile = path.join(fixtureRoot, "locks", "async.json");
  const lockPath = lockPathFor(dataFile);
  assert.throws(
    () => withFileLock(lockPath, async () => ({ ok: true })),
    /callback must be synchronous/,
    "withFileLock should reject async callbacks instead of releasing early",
  );
  assert(!fs.existsSync(lockPath), "async callback rejection should release the caller's lock");
}

function testFileLockDoesNotReleaseWithoutOwnerToken() {
  const dataFile = path.join(fixtureRoot, "locks", "missing-owner.json");
  const lockPath = lockPathFor(dataFile);
  withFileLock(lockPath, () => {
    fs.rmSync(path.join(lockPath, "owner.json"), { force: true });
  });
  assert(fs.existsSync(lockPath), "lock with missing owner token should be left for stale-lock cleanup, not deleted");
  fs.rmSync(lockPath, { recursive: true, force: true });
}

async function testFileLockSerializesContention() {
  const dataFile = path.join(fixtureRoot, "locks", "contention.json");
  writeJson(dataFile, { value: 0 });
  const workers = 4;
  const increments = 25;
  const workerScript = `
import fs from "node:fs";
import { lockPathFor, withFileLock } from "./scripts/lib/files.mjs";

const dataFile = process.env.LOCK_TEST_FILE;
const count = Number(process.env.LOCK_TEST_COUNT || 0);
const lockPath = lockPathFor(dataFile);

for (let index = 0; index < count; index += 1) {
  withFileLock(lockPath, () => {
    const current = JSON.parse(fs.readFileSync(dataFile, "utf8")).value;
    sleepSync(2);
    fs.writeFileSync(dataFile, JSON.stringify({ value: current + 1 }) + "\\n", "utf8");
  });
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}
`;

  const results = await Promise.all(Array.from({ length: workers }, () => runWorker(workerScript, {
    LOCK_TEST_FILE: dataFile,
    LOCK_TEST_COUNT: String(increments),
  })));
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  assert.equal(JSON.parse(read(dataFile)).value, workers * increments, "concurrent lock users should serialize file updates");
}

function testTransitionMarkerRefusesMutatingCommands() {
  if (fs.existsSync(transitionMarker)) throw new Error("transition marker test requires no active transition marker");
  writeJson(transitionMarker, {
    version: 1,
    id: "transition_test",
    operation: "test-transition",
    status: "running",
    started_at: new Date().toISOString(),
    recovery: ["test recovery"],
  });
  createdTransitionMarker = true;

  const refused = run(["scripts/story-workspace.mjs", "list-projects"]);
  assert.notEqual(refused.status, 0, "mutating and normal commands should refuse during an active transition");
  assert.match(refused.stderr, /Workspace transition is running: test-transition/);

  const status = run(["scripts/story-workspace.mjs", "transition-status", "--json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const parsedStatus = JSON.parse(status.stdout);
  assert.equal(parsedStatus.active, true, "transition-status should report marker");
  assert.equal(parsedStatus.transition.operation, "test-transition");

  const verify = run(["scripts/story-workspace.mjs", "verify-projects", "--json"]);
  assert.notEqual(verify.status, 0, "verify-projects should fail while transition marker exists");
  const parsedVerify = JSON.parse(verify.stdout);
  assert.equal(parsedVerify.ok, false);
  assert.match(parsedVerify.errors.join("\n"), /Workspace transition is running/);

  const clearWithoutForce = run(["scripts/story-workspace.mjs", "transition-clear"]);
  assert.notEqual(clearWithoutForce.status, 0, "transition-clear should require --force");

  const cleared = run(["scripts/story-workspace.mjs", "transition-clear", "--force", "--json"]);
  assert.equal(cleared.status, 0, cleared.stderr || cleared.stdout);
  assert.equal(JSON.parse(cleared.stdout).cleared, true);
  createdTransitionMarker = false;
}

function testReviewErrorsAreSupersededByLaterSuccess() {
  const runsDir = path.join(reviewScanTestDir, "runs");
  mkdir(runsDir);
  const base = {
    version: 1,
    target: { file: "draft/__hardening.md", section_id: "__hardening" },
    pass: { id: "hardening.review", label: "Hardening Review" },
    model: "mock:model",
    provider: "mock",
    resolved_model: "mock:model",
    attempts: [],
    parsed: null,
    normalized: { issues: [], strengths: [], discarded_issues: [] },
    raw_output: "",
    imported_issue_ids: [],
    metrics: { issue_count: 0, imported_issue_count: 0 },
  };
  writeJson(path.join(runsDir, "hardening__mock__old-error.json"), {
    ...base,
    run_id: "review_20260101000000_hardening_mock",
    created_at: "2026-01-01T00:00:00.000Z",
    error: "old transient provider failure",
  });
  writeJson(path.join(runsDir, "hardening__mock__new-success.json"), {
    ...base,
    run_id: "review_20260101000100_hardening_mock",
    created_at: "2026-01-01T00:01:00.000Z",
    error: "",
  });

  const superseded = scanReviewErrors(reviewScanTestDir, { cwd: root });
  assert.deepEqual(superseded.failures, [], "older review errors should be superseded by a later success for the same section/pass/model");

  writeJson(path.join(runsDir, "hardening__mock__newer-error.json"), {
    ...base,
    run_id: "review_20260101000200_hardening_mock",
    created_at: "2026-01-01T00:02:00.000Z",
    error: "fresh provider failure",
  });
  const freshError = scanReviewErrors(reviewScanTestDir, { cwd: root });
  assert.equal(freshError.failures.length, 1, "latest review error should fail the review-error scan");
  assert.match(freshError.failures[0].error, /fresh provider failure/);
}

function testCorruptedTasteGateFailsClosed() {
  const before = read(abs(targetRel));
  const blocked = run(["scripts/merge-winner.mjs", targetRel, "--run", "run-001", "--out", candidatesRootRel, "--apply"]);
  assert.notEqual(blocked.status, 0, "corrupted taste gate should block apply");
  assert.match(blocked.stderr, /Taste arbiter gate is unreadable/);
  assert.equal(read(abs(targetRel)), before, "blocked apply should not change the target");

  const forced = run(["scripts/merge-winner.mjs", targetRel, "--run", "run-001", "--out", candidatesRootRel, "--apply", "--force"]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.match(read(abs(targetRel)), /The winning line applies/);
}

function testStaleCandidateApplyFailsClosed() {
  const before = read(abs(targetRel));
  write(targetRel, `${before}\nHuman edit after candidate generation.\n`);
  const blocked = run(["scripts/merge-winner.mjs", targetRel, "--run", "run-001", "--out", candidatesRootRel, "--apply"]);
  assert.notEqual(blocked.status, 0, "stale candidate run should block apply");
  assert.match(blocked.stderr, /generated from a different draft state/);
  assert.match(read(abs(targetRel)), /Human edit after candidate generation/);
  write(targetRel, before);
}

function testMissingSourceHashFailsClosed() {
  const before = read(abs(targetRel));
  const blocked = run(["scripts/merge-winner.mjs", targetRel, "--run", "run-legacy", "--out", candidatesRootRel, "--apply"]);
  assert.notEqual(blocked.status, 0, "legacy candidate run without source_sha256 should block apply");
  assert.match(blocked.stderr, /does not record source_sha256/);
  assert.equal(read(abs(targetRel)), before, "legacy blocked apply should not change the target");
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runWorker(code, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: null, signal: null, stdout, stderr: error.stack || error.message });
    });
    child.on("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function write(file, value) {
  const full = abs(file);
  mkdir(path.dirname(full));
  fs.writeFileSync(full, value, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}
