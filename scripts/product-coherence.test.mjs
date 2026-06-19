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
    total: 3,
    evaluated_rows: 2,
    error_rows: 1,
    strategies: {
      single: {
        total: 2,
        evaluated_rows: 1,
        error_rows: 1,
        error_rate: 0.5,
        mlab_wins: 1,
        mlab_win_rate: 1,
        average_score_delta: 3,
        known_usage: { cost: 0.01 },
      },
      revise: {
        total: 1,
        evaluated_rows: 1,
        error_rows: 0,
        error_rate: 0,
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

  const incompleteStrategyRunId = "practice-strategies-in-progress";
  const incompleteStrategyDir = path.join(manuscriptRoot, "state", "practice-strategies", incompleteStrategyRunId);
  fs.mkdirSync(incompleteStrategyDir, { recursive: true });
  fs.writeFileSync(path.join(incompleteStrategyDir, "input.json"), `${JSON.stringify({
    schema_version: "manuscript-lab.practice-strategy-comparison.v1",
    run_id: incompleteStrategyRunId,
    strategies: [{ id: "single", label: "1 candidate, no revision, no repair" }],
  }, null, 2)}\n`);

  const summaryOnlyStrategyRunId = "practice-strategies-summary-only";
  const summaryOnlyStrategyDir = path.join(manuscriptRoot, "state", "practice-strategies", summaryOnlyStrategyRunId);
  fs.mkdirSync(summaryOnlyStrategyDir, { recursive: true });
  fs.writeFileSync(path.join(summaryOnlyStrategyDir, "summary.json"), `${JSON.stringify({
    schema_version: "manuscript-lab.practice-strategy-summary.v1",
    run_id: summaryOnlyStrategyRunId,
    status: "pass",
    total: 1,
    evaluated_rows: 1,
    error_rows: 0,
    strategies: {},
    recommendations: {
      "want-in-room": { strategy: "summary-only", reason: "Should not be recommended without a report." },
    },
  }, null, 2)}\n`);

  const legacyStrategyRunId = "practice-strategies-legacy";
  const legacyStrategyDir = path.join(manuscriptRoot, "state", "practice-strategies", legacyStrategyRunId);
  fs.mkdirSync(legacyStrategyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyStrategyDir, "summary.json"), `${JSON.stringify({
    schema_version: "manuscript-lab.practice-strategy-summary.v1",
    run_id: legacyStrategyRunId,
    status: "pass",
    total: 4,
    error_rows: 0,
    strategies: {},
    recommendations: {},
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(legacyStrategyDir, "STRATEGY_REPORT.md"), "# Legacy Strategy Report\n");

  const artifacts = assertJson(run([cli, "artifacts", "list", "--kind", "practice-strategy", "--json"], { cwd: manuscriptRoot }));
  assert.equal(artifacts.schema_version, "manuscript-lab.artifacts.v1");
  assert.equal(artifacts.ok, true);
  const completeStrategyArtifact = artifacts.artifacts.practice_strategies.find((artifact) => artifact.run_id === strategyRunId);
  const incompleteStrategyArtifact = artifacts.artifacts.practice_strategies.find((artifact) => artifact.run_id === incompleteStrategyRunId);
  const summaryOnlyStrategyArtifact = artifacts.artifacts.practice_strategies.find((artifact) => artifact.run_id === summaryOnlyStrategyRunId);
  const legacyStrategyArtifact = artifacts.artifacts.practice_strategies.find((artifact) => artifact.run_id === legacyStrategyRunId);
  assert.equal(completeStrategyArtifact.status, "pass");
  assert.equal(completeStrategyArtifact.evaluated_rows, 2);
  assert.equal(completeStrategyArtifact.error_rows, 1);
  assert.equal(completeStrategyArtifact.strategies.single.error_rate, 0.5);
  assert.equal(incompleteStrategyArtifact.status, "in_progress");
  assert.equal(incompleteStrategyArtifact.summary_file, "");
  assert.deepEqual(incompleteStrategyArtifact.strategies, {});
  assert.equal(summaryOnlyStrategyArtifact.status, "in_progress");
  assert.equal(summaryOnlyStrategyArtifact.report, "");
  assert.equal(legacyStrategyArtifact.evaluated_rows, 4);
  assert.equal(artifacts.recommendations[0].id, "practice-strategy-latest");
  assert.equal(artifacts.recommendations[0].artifact, `state/practice-strategies/${strategyRunId}/STRATEGY_REPORT.md`);

  const limitedArtifacts = assertJson(run([cli, "artifacts", "list", "--kind", "practice-strategy", "--limit", "1", "--json"], { cwd: manuscriptRoot }));
  assert.equal(limitedArtifacts.artifacts.practice_strategies.length, 1);
  assert.equal(limitedArtifacts.recommendations[0].artifact, `state/practice-strategies/${strategyRunId}/STRATEGY_REPORT.md`);

  const badArtifacts = run([cli, "artifacts", "list", "--kind", "missing", "--json"], { cwd: manuscriptRoot });
  assert.equal(badArtifacts.status, 2);
  assert.match(JSON.parse(badArtifacts.stdout).error, /Unknown artifact kind/);

  const inspected = assertJson(run([cli, "artifacts", "inspect", "--run", strategyRunId, "--kind", "practice-strategy", "--json"], { cwd: manuscriptRoot }));
  assert.equal(inspected.artifact.path, `state/practice-strategies/${strategyRunId}`);
  assert.equal(inspected.summary.recommendations["want-in-room"].strategy, "single");

  const evalRun = assertJson(run([cli, "eval", "practice-strategies", "--from", `state/practice-strategies/${strategyRunId}`, "--json"], { cwd: manuscriptRoot }));
  assert.equal(evalRun.ok, true);
  assert.equal(evalRun.summary.disposition, "snapshot");
  assert.equal(evalRun.summary.total_rows, 3);
  assert.equal(evalRun.summary.evaluated_rows, 2);
  assert.equal(evalRun.summary.error_rows, 1);
  assert.equal(evalRun.summary.strategies.single.error_rows, 1);
  assert.equal(evalRun.summary.strategies.single.error_rate, 0.5);
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
  assert(status.generated_artifacts.practice_strategies.some((item) => item.run_id === strategyRunId));
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
