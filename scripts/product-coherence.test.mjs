#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = path.join(repoRoot, "bin", "manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-product-"));

try {
  const workspace = path.join(tmp, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const init = run([
    cli,
    "init",
    "--profile",
    "whitepaper",
    "--root",
    "manuscript",
    "--title",
    "Product Coherence",
    "--sections",
    "1",
    "--kind",
    "document.section",
    "--json",
  ], { cwd: workspace });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const manuscriptRoot = path.join(workspace, "manuscript");
  const strategyRunId = "practice-strategies-coherence";
  const strategyDir = path.join(manuscriptRoot, "state", "practice-strategies", strategyRunId);
  fs.mkdirSync(strategyDir, { recursive: true });
  const summary = {
    schema_version: "manuscript-lab.practice-strategy-summary.v1",
    run_id: strategyRunId,
    status: "pass",
    created_at: "2026-06-19T00:00:00.000Z",
    total: 2,
    strategies: {
      single: {
        total: 1,
        mlab_wins: 1,
        mlab_win_rate: 1,
        average_score_delta: 3,
        known_usage: { cost: 0.01 },
      },
      revise: {
        total: 1,
        mlab_wins: 0,
        mlab_win_rate: 0,
        average_score_delta: -1,
        known_usage: { cost: 0.02 },
      },
    },
    recommendations: {
      "want-in-room": { strategy: "single", reason: "Best observed delta." },
    },
    known_usage: { cost: 0.03 },
  };
  fs.writeFileSync(path.join(strategyDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(strategyDir, "rows.json"), "[]\n");
  fs.writeFileSync(path.join(strategyDir, "STRATEGY_REPORT.md"), "# Strategy Report\n");

  const artifacts = assertJson(run([cli, "artifacts", "list", "--kind", "practice-strategy", "--json"], { cwd: manuscriptRoot }));
  assert.equal(artifacts.schema_version, "manuscript-lab.artifacts.v1");
  assert.equal(artifacts.ok, true);
  assert.equal(artifacts.artifacts.practice_strategies[0].run_id, strategyRunId);
  assert.equal(artifacts.recommendations[0].id, "practice-strategy-latest");

  const badArtifacts = run([cli, "artifacts", "list", "--kind", "missing", "--json"], { cwd: manuscriptRoot });
  assert.equal(badArtifacts.status, 2);
  assert.match(JSON.parse(badArtifacts.stdout).error, /Unknown artifact kind/);

  const inspected = assertJson(run([cli, "artifacts", "inspect", "--run", strategyRunId, "--kind", "practice-strategy", "--json"], { cwd: manuscriptRoot }));
  assert.equal(inspected.artifact.path, `state/practice-strategies/${strategyRunId}`);
  assert.equal(inspected.summary.recommendations["want-in-room"].strategy, "single");

  const evalRun = assertJson(run([cli, "eval", "practice-strategies", "--from", `state/practice-strategies/${strategyRunId}`, "--json"], { cwd: manuscriptRoot }));
  assert.equal(evalRun.ok, true);
  assert.equal(evalRun.summary.disposition, "snapshot");
  assert.match(evalRun.run_dir, /^state\/evals\/eval-/);

  const baselineFile = path.join(manuscriptRoot, "baseline.json");
  fs.writeFileSync(
    baselineFile,
    `${JSON.stringify({
      strategies: {
        single: { mlab_win_rate: 1, average_score_delta: 3, cost: 0.01 },
        revise: { mlab_win_rate: 1, average_score_delta: 3, cost: 0.02 },
      },
    }, null, 2)}\n`,
  );
  const regression = run([
    cli,
    "eval",
    "practice-strategies",
    "--from",
    `state/practice-strategies/${strategyRunId}`,
    "--baseline",
    "baseline.json",
    "--fail-on-regression",
    "--json",
  ], { cwd: manuscriptRoot });
  assert.equal(regression.status, 1);
  assert.equal(JSON.parse(regression.stdout).status, "regression");

  const missingSource = run([cli, "eval", "practice-strategies", "--from", "state/practice-strategies/does-not-exist", "--json"], { cwd: manuscriptRoot });
  assert.equal(missingSource.status, 2);
  assert.match(JSON.parse(missingSource.stdout).error, /does not exist/);

  const golden = assertJson(run([cli, "golden-path", "--write", "--json"], { cwd: manuscriptRoot }));
  assert.equal(golden.ok, true);
  assert.match(golden.run_dir, /^state\/golden-path\/golden-path-/);

  const status = assertJson(run([cli, "status", "--json"], { cwd: manuscriptRoot }));
  assert.equal(status.generated_artifacts.practice_strategies[0].run_id, strategyRunId);
  assert(status.generated_artifacts.eval_runs.length >= 1);
  assert(status.generated_artifacts.golden_paths.length >= 1);
  assert(status.artifact_recommendations.some((item) => item.id === "practice-strategy-latest"));

  const report = assertJson(run([cli, "report", "--json"], { cwd: manuscriptRoot }));
  assert(report.summary.generated_artifacts.total >= 3);
  assert(report.generated_artifacts.practice_strategies.some((item) => item.run_id === strategyRunId));

  console.log("product coherence tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
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
