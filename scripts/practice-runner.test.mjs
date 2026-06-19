#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assessDistinctPracticeProse, assessPracticeProse } from "./lib/practice-prose-guard.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-practice-"));
const cli = path.join(repoRoot, "bin", "manuscript-lab.mjs");

try {
  testList();
  testDryRun();
  testProseGuard();
  testMockPropose();
  testMockCompare();
  testMockBench();
  testMockStrategies();
  testUnknownExercise();
  console.log("practice runner tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testList() {
  const result = assertJson(run([cli, "practice", "list", "--json"]));
  assert(result.exercises.some((exercise) => exercise.id === "want-in-room"));
  assert(result.exercises.some((exercise) => exercise.id === "status-shift"));
  assert.equal("hidden_test" in result.exercises[0], false);
  assert.equal("axis" in result.exercises[0], true);
}

function testDryRun() {
  const workspace = freshWorkspace("dry-run");
  const result = assertJson(run([cli, "practice", "propose", "--exercise", "want-in-room", "--dry-run", "--json"], { cwd: workspace }));
  assert.equal(result.ok, true);
  assert.equal(result.status, "dry_run");
  assert.equal(result.run_dir, "");
  assert.equal(fs.existsSync(path.join(workspace, "manuscript", "state", "practice", "want-in-room")), false);
}

function testProseGuard() {
  const good = assessPracticeProse("Marlene set the third plate by the window and polished the fork until it caught the late sun.");
  assert.equal(good.ok, true);
  const bad = assessPracticeProse("The user wants me to revise the candidate. The hidden test is about a blind reader.");
  assert.equal(bad.ok, false);
  assert(bad.reasons.includes("hidden-test"));
  assert(bad.reasons.includes("blind-reader"));
  assert(bad.reasons.includes("planning-language"));
  const distinct = assessDistinctPracticeProse(
    "Marlene set the third plate by the window and polished the fork until it caught the late sun.",
    "Marlene set the third plate by the window and polished the fork until it caught the late sun.",
  );
  assert.equal(distinct.ok, false);
}

function testMockPropose() {
  const workspace = freshWorkspace("mock");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const candidates = path.join(workspace, "candidates.json");
  fs.writeFileSync(candidates, `${JSON.stringify([
    "Mara entered the archive and counted the chairs before she looked at the shelves. The blue folder was gone.",
    "Mara wanted the blue folder, so she searched the archive.",
  ])}\n`);
  const result = assertJson(run([
    cli,
    "practice",
    "propose",
    "--exercise",
    "want-in-room",
    "--brief",
    "an archive after closing",
    "--mock-candidates-file",
    candidates,
    "--json",
  ], { cwd: workspace }));
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.match(result.run_dir, /^state\/practice\/want-in-room\/practice-/);
  assert.equal(result.winner_id, "candidate-001");
  assert.match(result.final, /Mara entered the archive/);
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "final.md")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "judgment.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "candidates", "candidate-001.md")));
}

function testMockCompare() {
  const workspace = freshWorkspace("compare");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const direct = path.join(workspace, "direct.md");
  const mlab = path.join(workspace, "mlab.md");
  fs.writeFileSync(direct, "Mara came in wanting the blue folder and looked around the archive.\n");
  fs.writeFileSync(mlab, "Mara entered the archive and counted the chairs before she touched the shelves. The blue folder was gone.\n");
  const result = assertJson(run([
    cli,
    "practice",
    "compare",
    "--exercise",
    "want-in-room",
    "--mock-direct-file",
    direct,
    "--mock-mlab-file",
    mlab,
    "--json",
  ], { cwd: workspace }));
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.match(result.run_dir, /^state\/practice-evals\/want-in-room\/practice-eval-/);
  assert.equal(result.winner_source, "mlab");
  assert.equal(result.repair_rounds, 0);
  assert.equal(result.pairwise.winner_source, "mlab");
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "direct.md")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "mlab-final.md")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "pairwise-judgment.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "REPORT.md")));
}

function testMockBench() {
  const workspace = freshWorkspace("bench");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const direct = path.join(workspace, "direct.md");
  const mlab = path.join(workspace, "mlab.md");
  fs.writeFileSync(direct, "Mara came in wanting the blue folder and looked around the archive.\n");
  fs.writeFileSync(mlab, "Mara entered the archive and counted the chairs before she touched the shelves. The blue folder was gone.\n");
  const result = assertJson(run([
    cli,
    "practice",
    "bench",
    "--exercises",
    "want-in-room,thing-unsaid",
    "--models",
    "mock:one,mock:two",
    "--seeds",
    "2",
    "--mock-direct-file",
    direct,
    "--mock-mlab-file",
    mlab,
    "--json",
  ], { cwd: workspace }));
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.match(result.run_dir, /^state\/practice-bench\/practice-bench-/);
  assert.equal(result.rows.length, 8);
  assert.equal(result.summary.total, 8);
  assert.equal(result.summary.mlab_wins, 8);
  assert.equal(result.summary.direct_wins, 0);
  assert.equal(result.summary.copy_check_failures, 0);
  assert.equal(result.summary.first_pass_mlab_wins, 8);
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "summary.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "rows.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "runs.jsonl")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "RESULTS.md")));

  const dry = assertJson(run([
    cli,
    "practice",
    "bench",
    "--exercises",
    "want-in-room",
    "--models",
    "mock:writer",
    "--judge-model",
    "mock:judge",
    "--dry-run",
    "--json",
  ], { cwd: workspace }));
  assert.equal(dry.judge_model, "mock:judge");

  const typo = run([
    cli,
    "practice",
    "bench",
    "--exercises",
    "want-in-room,missing-exercise",
    "--dry-run",
    "--json",
  ], { cwd: workspace });
  assert.equal(typo.status, 2);
  assert.match(JSON.parse(typo.stdout).error, /Unknown benchmark exercise/);
}

function testMockStrategies() {
  const workspace = freshWorkspace("strategies");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const direct = path.join(workspace, "direct.md");
  const mlab = path.join(workspace, "mlab.md");
  fs.writeFileSync(direct, "Mara came in wanting the blue folder and looked around the archive.\n");
  fs.writeFileSync(mlab, "Mara entered the archive and counted the chairs before she touched the shelves. The blue folder was gone.\n");
  const result = assertJson(run([
    cli,
    "practice",
    "strategies",
    "--exercises",
    "want-in-room,thing-unsaid",
    "--models",
    "mock:one",
    "--seeds",
    "1",
    "--strategies",
    "single,revise",
    "--mock-direct-file",
    direct,
    "--mock-mlab-file",
    mlab,
    "--json",
  ], { cwd: workspace }));
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.match(result.run_dir, /^state\/practice-strategies\/practice-strategies-/);
  assert.equal(result.rows.length, 4);
  assert.equal(result.strategy_runs.length, 2);
  assert.equal(result.summary.strategies.single.total, 2);
  assert.equal(result.summary.strategies.revise.total, 2);
  assert.equal(result.summary.strategies.single.mlab_wins, 2);
  assert.equal(result.summary.recommendations["want-in-room"].strategy, "single");
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "summary.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "rows.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "strategy-runs.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "STRATEGY_REPORT.md")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "benchmarks", "single", "summary.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "benchmarks", "revise", "summary.json")));

  const dry = assertJson(run([
    cli,
    "practice",
    "strategies",
    "--exercises",
    "Want-In-Room",
    "--models",
    "mock:writer",
    "--strategies",
    "SINGLE,Select",
    "--dry-run",
    "--json",
  ], { cwd: workspace }));
  assert.equal(dry.status, "dry_run");
  assert.equal(dry.rows.length, 2);
  assert.deepEqual(dry.rows.map((row) => row.strategy), ["single", "select"]);
  assert.equal(dry.summary.planned, 2);
  assert.equal(fs.existsSync(path.join(manuscriptRoot, "state", "practice-strategies", dry.run_id)), false);

  const typo = run([
    cli,
    "practice",
    "strategies",
    "--strategies",
    "single,missing-strategy",
    "--dry-run",
    "--json",
  ], { cwd: workspace });
  assert.equal(typo.status, 2);
  assert.match(JSON.parse(typo.stdout).error, /Unknown strategy/);
}

function testUnknownExercise() {
  const workspace = freshWorkspace("unknown");
  const result = run([cli, "practice", "propose", "--exercise", "missing", "--json"], { cwd: workspace });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).error, /Unknown --exercise/);
}

function freshWorkspace(name) {
  const workspace = path.join(tmp, name);
  fs.mkdirSync(workspace, { recursive: true });
  const init = run(
    [
      cli,
      "init",
      "--profile",
      "whitepaper",
      "--root",
      "manuscript",
      "--title",
      `Practice ${name}`,
      "--sections",
      "1",
      "--kind",
      "document.section",
      "--json",
    ],
    { cwd: workspace },
  );
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return workspace;
}

function assertJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function run(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
