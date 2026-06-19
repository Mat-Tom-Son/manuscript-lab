#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JSON_OBJECT_RESPONSE_FORMAT, parseJsonObjectOrThrow } from "./lib/model-json.mjs";
import { prepareModelProviderEnvironment } from "./lib/cli-runtime.mjs";
import { writeFileAtomic, writeJsonAtomic } from "./lib/files.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { listPracticeExercises, practiceExerciseById, practiceExerciseIds, practiceExerciseSet } from "./lib/practice-exercises.mjs";
import { assessDistinctPracticeProse, assessPracticeProse } from "./lib/practice-prose-guard.mjs";

const RUN_SCHEMA = "manuscript-lab.practice-run.v1";
const COMPARE_SCHEMA = "manuscript-lab.practice-comparison.v1";
const BENCH_SCHEMA = "manuscript-lab.practice-benchmark.v1";
const STRATEGIES_SCHEMA = "manuscript-lab.practice-strategy-comparison.v1";
const DEFAULT_MODEL = "openrouter:z-ai/glm-5.2";
const STRATEGY_PRESETS = Object.freeze([
  {
    id: "single",
    label: "1 candidate, no revision, no repair",
    candidates: 1,
    noRevise: true,
    repairRounds: 0,
  },
  {
    id: "select",
    label: "3 candidates, judge pick, no revision, no repair",
    candidates: 3,
    noRevise: true,
    repairRounds: 0,
  },
  {
    id: "revise",
    label: "3 candidates, judge pick, revision, no repair",
    candidates: 3,
    noRevise: false,
    repairRounds: 0,
  },
  {
    id: "repair",
    label: "3 candidates, judge pick, revision, 1 repair",
    candidates: 3,
    noRevise: false,
    repairRounds: 1,
  },
]);

await main();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.command === "list") {
    emitList(options);
    process.exit(0);
  }

  if (!["propose", "compare", "bench", "strategies"].includes(options.command)) {
    fail(`Unknown practice command: ${options.command || "(missing)"}`, options);
  }

  const discovery = discoverProtocol({
    cwd: process.cwd(),
    configPath: options.config,
    workspace: options.workspace,
  });
  if (discovery.mode === "none" || discovery.errors?.length) {
    const errors = discovery.errors?.length ? discovery.errors : ["No Manuscript Lab project found."];
    fail(errors.join("\n"), options);
  }

  const paths = protocolPaths(discovery, { cwd: process.cwd() });
  if (options.command === "strategies") {
    const result = await runStrategyComparison({ discovery, paths, options });
    emitStrategiesResult(result, options);
    process.exit(result.ok ? 0 : 2);
  }
  if (options.command === "bench") {
    const result = await runBenchmark({ discovery, paths, options });
    emitBenchResult(result, options);
    process.exit(result.ok ? 0 : 2);
  }

  const exercise = practiceExerciseById(options.exercise);
  if (!exercise) {
    fail(`Unknown --exercise ${options.exercise || "(missing)"}. Available: ${listPracticeExercises().map((item) => item.id).join(", ")}.`, options);
  }

  if (options.command === "compare") {
    const result = await runComparison({ exercise, discovery, paths, options });
    emitCompareResult(result, options);
    process.exit(result.ok ? 0 : 2);
  }

  const runId = makeRunId();
  const runDir = paths.stateAbs(path.join("practice", exercise.id, runId));
  const run = {
    schema_version: RUN_SCHEMA,
    run_id: runId,
    exercise,
    brief: options.brief,
    model: options.model,
    judge_model: options.judgeModel || options.model,
    candidate_count: options.candidates,
    dry_run: options.dryRun,
    run_dir: runDir,
    discovery: {
      mode: discovery.mode,
      package_root: discovery.packageRoot,
      workspace_root: discovery.workspaceRoot,
      manuscript_root: discovery.manuscriptRoot,
      config_path: discovery.configPath,
    },
  };

  if (options.dryRun) {
    emitResult({ ok: true, status: "dry_run", run, candidates: [], judge: null, final: "" }, options);
    process.exit(0);
  }

  initializeRun(run);

  const candidates = await loadOrGenerateCandidates({ run, options, discovery, paths });
  writeCandidates(run, candidates);

  const judge = await loadOrJudgeCandidates({ run, options, candidates, discovery, paths });
  writeJsonAtomic(path.join(runDir, "judgment.json"), judge);

  const winner = candidates.find((candidate) => candidate.id === judge.winner_id) ?? candidates[0];
  const final = await reviseWinner({ run, options, winner, judge, discovery, paths });
  writeFileAtomic(path.join(runDir, "winner.md"), `${winner.text.trim()}\n`, "utf8");
  writeFileAtomic(path.join(runDir, "final.md"), `${final.trim()}\n`, "utf8");
  writeReport(run, { candidates, judge, final });

  emitResult({ ok: true, status: "pass", run, candidates, judge, final }, options);
}

async function runComparison({ exercise, discovery, paths, options }) {
  const runId = options.compareRunId || makeCompareRunId();
  const runDir = options.compareRunDir || paths.stateAbs(path.join("practice-evals", exercise.id, runId));
  const run = {
    schema_version: COMPARE_SCHEMA,
    run_id: runId,
    exercise,
    brief: options.brief,
    model: options.model,
    judge_model: options.judgeModel || options.model,
    candidate_count: options.candidates,
    dry_run: options.dryRun,
    run_dir: runDir,
    discovery: {
      mode: discovery.mode,
      package_root: discovery.packageRoot,
      workspace_root: discovery.workspaceRoot,
      manuscript_root: discovery.manuscriptRoot,
      config_path: discovery.configPath,
    },
  };

  if (options.dryRun) {
    return { ok: true, status: "dry_run", run, direct: null, mlab: null, pairwise: null, initialPairwise: null, repairRounds: [] };
  }

  fs.mkdirSync(runDir, { recursive: true });
  writeJsonAtomic(path.join(runDir, "input.json"), {
    schema_version: COMPARE_SCHEMA,
    run_id: runId,
    exercise,
    brief: options.brief,
    model: options.model,
    judge_model: options.judgeModel || options.model,
    candidate_count: options.candidates,
    discovery: run.discovery,
  });

  const direct = await generateDirectBaseline({ run, options, discovery, paths });
  writeFileAtomic(path.join(runDir, "direct.md"), `${direct.text.trim()}\n`, "utf8");
  writeJsonAtomic(path.join(runDir, "direct-meta.json"), directMeta(direct));

  const mlab = await generateMlabPracticeOutput({ run, options, discovery, paths });
  writeFileAtomic(path.join(runDir, "mlab-initial.md"), `${mlab.final.trim()}\n`, "utf8");

  let pairwise = await judgeDirectVsMlab({ run, options, direct, mlab, discovery, paths, round: 0 });
  const initialPairwise = pairwise;
  writeJsonAtomic(path.join(runDir, "pairwise-initial.json"), initialPairwise);
  const repairRounds = [];
  for (let round = 1; round <= options.repairRounds && pairwise.winner_source !== "mlab"; round += 1) {
    const repair = await repairMlabAgainstDirect({ run, options, direct, mlab, pairwise, discovery, paths, round });
    repairRounds.push(repair);
    writeRepairRound(run, repair);
    if (!repair.changed) break;
    mlab.final = repair.final;
    pairwise = await judgeDirectVsMlab({ run, options, direct, mlab, discovery, paths, round });
    repair.pairwise = pairwise;
    writeRepairRound(run, repair);
  }
  writeFileAtomic(path.join(runDir, "mlab-final.md"), `${mlab.final.trim()}\n`, "utf8");
  writeJsonAtomic(path.join(runDir, "pairwise-judgment.json"), pairwise);
  if (repairRounds.length) {
    writeJsonAtomic(path.join(runDir, "repair-history.json"), {
      schema_version: "manuscript-lab.practice-repair-history.v1",
      rounds: repairRounds.map(({ final, ...round }) => round),
    });
  }
  writeComparisonReport(run, { direct, mlab, pairwise });

  return { ok: true, status: "pass", run, direct, mlab, pairwise, initialPairwise, repairRounds };
}

async function runBenchmark({ discovery, paths, options }) {
  const exerciseResolution = resolveBenchmarkExercises(options.exercises);
  if (!exerciseResolution.ok) fail(exerciseResolution.error, options);
  const exercises = exerciseResolution.exercises;
  if (!exercises.length) {
    fail(`No benchmark exercises matched --exercises ${options.exercises}. Available: core, expanded, all, or comma-separated ids.`, options);
  }
  const models = parseList(options.models || options.model);
  if (!models.length) fail("Benchmark requires at least one model.", options);

  const runId = options.benchmarkRunId || makeBenchRunId();
  const runDir = options.benchmarkRunDir || paths.stateAbs(path.join("practice-bench", runId));
  const run = benchmarkRunRecord({ discovery, options, exercises, models, runId, runDir });

  const plan = buildBenchmarkPlan({ exercises, models, seeds: options.seeds, brief: options.brief });
  if (options.dryRun) {
    const plannedRows = plan.map((item) => plannedBenchmarkRow(item));
    return {
      ok: true,
      status: "dry_run",
      run,
      rows: plannedRows,
      summary: {
        ...summarizeBenchmarkRows(plannedRows),
        planned: plannedRows.length,
        max_model_calls_estimate: plannedRows.length * estimatedCallsPerComparison(options),
      },
    };
  }

  fs.mkdirSync(runDir, { recursive: true });
  writeBenchmarkInput(run, plan);

  const rows = [];
  for (const item of plan) {
    const childRunId = `${runId}-${safeSegment(item.model)}-${item.exercise.id}-seed-${String(item.seed).padStart(3, "0")}`;
    const compareRunDir = path.join(runDir, "comparisons", safeSegment(item.model), item.exercise.id, `seed-${String(item.seed).padStart(3, "0")}`);
    const compareOptions = {
      ...options,
      command: "compare",
      exercise: item.exercise.id,
      model: item.model,
      compareRunId: childRunId,
      compareRunDir,
      brief: item.brief,
      dryRun: false,
    };
    let row;
    try {
      maybeThrowMockBenchmarkFailure({ options, item });
      const result = await runComparison({ exercise: item.exercise, discovery, paths, options: compareOptions });
      row = benchmarkRowFromComparison({ item, result });
    } catch (error) {
      row = benchmarkRowFromError({ item, run, childRunId, compareRunDir, error, options: compareOptions });
      writeComparisonError({ run, item, childRunId, compareRunDir, error, row });
    }
    rows.push(row);
    writeBenchmarkProgress(runDir, rows);
  }

  const summary = summarizeBenchmarkRows(rows);
  writeBenchmarkProgress(runDir, rows);
  writeJsonAtomic(path.join(runDir, "summary.json"), summary);
  writeBenchmarkReport(run, { rows, summary });
  return { ...completionStatus(summary), run, rows, summary };
}

function estimatedCallsPerComparison(options) {
  return 1 + Number(options.candidates ?? 0) + 1 + (options.noRevise ? 0 : 1) + 1 + Number(options.repairRounds ?? 0) * 2;
}

async function runStrategyComparison({ discovery, paths, options }) {
  const exerciseResolution = resolveBenchmarkExercises(options.exercises);
  if (!exerciseResolution.ok) fail(exerciseResolution.error, options);
  const exercises = exerciseResolution.exercises;
  if (!exercises.length) {
    fail(`No strategy exercises matched --exercises ${options.exercises}. Available: core, expanded, all, or comma-separated ids.`, options);
  }
  const models = parseList(options.models || options.model);
  if (!models.length) fail("Strategy comparison requires at least one model.", options);
  const strategyResolution = resolveStrategies(options.strategies);
  if (!strategyResolution.ok) fail(strategyResolution.error, options);
  const strategies = strategyResolution.strategies;

  const runId = makeStrategyRunId();
  const runDir = paths.stateAbs(path.join("practice-strategies", runId));
  const run = {
    schema_version: STRATEGIES_SCHEMA,
    run_id: runId,
    run_dir: runDir,
    exercise_set: options.exercises,
    exercises: exercises.map(publicExercise),
    models,
    judge_model: options.judgeModel || "",
    seeds: options.seeds,
    strategies: strategies.map(publicStrategy),
    dry_run: options.dryRun,
    discovery: {
      mode: discovery.mode,
      package_root: discovery.packageRoot,
      workspace_root: discovery.workspaceRoot,
      manuscript_root: discovery.manuscriptRoot,
      config_path: discovery.configPath,
    },
  };

  const plan = buildStrategyPlan({ exercises, models, seeds: options.seeds, brief: options.brief, strategies });
  if (options.dryRun) {
    const rows = plan.map(plannedStrategyRow);
    return {
      ok: true,
      status: "dry_run",
      run,
      rows,
      strategy_runs: [],
      summary: {
        ...summarizeStrategyRows(rows, strategies),
        planned: rows.length,
        max_model_calls_estimate: plan.reduce((sum, item) => sum + estimatedCallsPerComparison(strategyOptions(options, item.strategy)), 0),
      },
    };
  }

  fs.mkdirSync(runDir, { recursive: true });
  writeJsonAtomic(path.join(runDir, "input.json"), {
    ...run,
    run_dir: displayProjectPath(run, runDir),
    plan: plan.map(({ exercise, strategy, ...item }) => ({ ...item, exercise: publicExercise(exercise), strategy: publicStrategy(strategy) })),
  });

  const rows = [];
  const strategyRuns = [];
  for (const strategy of strategies) {
    const benchOptions = {
      ...strategyOptions(options, strategy),
      command: "bench",
      dryRun: false,
      strategyId: strategy.id,
      benchmarkRunId: `${runId}-${strategy.id}`,
      benchmarkRunDir: path.join(runDir, "benchmarks", strategy.id),
    };
    let result;
    try {
      result = await runBenchmark({ discovery, paths, options: benchOptions });
    } catch (error) {
      result = recoverFailedStrategyBenchmark({ discovery, paths, options: benchOptions, exercises, models, error });
    }
    const strategyRun = {
      strategy: strategy.id,
      strategy_label: strategy.label,
      strategy_settings: strategySettings(strategy),
      status: result.status,
      run_id: result.run.run_id,
      run_dir: displayProjectPath(run, result.run.run_dir),
      summary: result.summary,
      error_message: result.error_message ?? "",
    };
    strategyRuns.push(strategyRun);
    rows.push(...result.rows.map((row) => strategyRow(strategy, row)));
    writeStrategyProgress(runDir, rows, strategyRuns, strategies);
  }

  const summary = summarizeStrategyRows(rows, strategies);
  writeStrategyProgress(runDir, rows, strategyRuns, strategies);
  writeJsonAtomic(path.join(runDir, "summary.json"), summary);
  writeStrategyReport(run, { rows, strategyRuns, summary });
  return { ...completionStatus(summary), run, rows, strategy_runs: strategyRuns, summary };
}

function resolveBenchmarkExercises(value) {
  const raw = String(value || "core").trim();
  const normalized = raw.toLowerCase();
  if (["core", "all", "expanded", ""].includes(normalized)) {
    return { ok: true, exercises: practiceExerciseSet(normalized || "core") };
  }
  const ids = raw.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
  const available = new Set(practiceExerciseIds());
  const missing = ids.filter((id) => !available.has(id));
  if (missing.length) {
    return {
      ok: false,
      exercises: [],
      error: `Unknown benchmark exercise(s): ${missing.join(", ")}. Available: ${practiceExerciseIds().join(", ")}`,
    };
  }
  return { ok: true, exercises: ids.map((id) => practiceExerciseById(id)) };
}

function resolveStrategies(value) {
  const raw = String(value || "default").trim();
  const normalized = raw.toLowerCase();
  const aliases = new Map([
    ["default", STRATEGY_PRESETS.map((strategy) => strategy.id)],
    ["all", STRATEGY_PRESETS.map((strategy) => strategy.id)],
    ["single_candidate_no_revise", ["single"]],
    ["three_candidates_no_revise", ["select"]],
    ["three_candidates_revise_no_repair", ["revise"]],
    ["three_candidates_revise_repair1", ["repair"]],
  ]);
  const ids = aliases.get(normalized)
    ?? raw.split(",").map((id) => {
      const normalizedId = id.trim().toLowerCase();
      return aliases.get(normalizedId) ?? [normalizedId];
    }).flat().filter(Boolean);
  const available = new Map(STRATEGY_PRESETS.map((strategy) => [strategy.id, strategy]));
  const missing = ids.filter((id) => !available.has(id));
  if (missing.length) {
    return {
      ok: false,
      strategies: [],
      error: `Unknown strategy id(s): ${missing.join(", ")}. Available: default, all, ${STRATEGY_PRESETS.map((strategy) => strategy.id).join(", ")}`,
    };
  }
  const seen = new Set();
  return {
    ok: true,
    strategies: ids.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((id) => available.get(id)),
  };
}

function publicExercise(exercise) {
  return {
    id: exercise.id,
    title: exercise.title,
    axis: exercise.axis,
    public_prompt: exercise.public_prompt,
  };
}

function publicStrategy(strategy) {
  return {
    id: strategy.id,
    label: strategy.label,
    ...strategySettings(strategy),
  };
}

function strategySettings(strategy) {
  return {
    candidates: strategy.candidates,
    no_revise: strategy.noRevise,
    repair_rounds: strategy.repairRounds,
  };
}

function buildBenchmarkPlan({ exercises, models, seeds, brief }) {
  const plan = [];
  for (const model of models) {
    for (const exercise of exercises) {
      for (let seed = 1; seed <= seeds; seed += 1) {
        plan.push({
          model,
          exercise,
          seed,
          brief: benchmarkBrief({ brief, exercise, seed }),
        });
      }
    }
  }
  return plan;
}

function buildStrategyPlan({ exercises, models, seeds, brief, strategies }) {
  const plan = [];
  for (const strategy of strategies) {
    for (const item of buildBenchmarkPlan({ exercises, models, seeds, brief })) {
      plan.push({ ...item, strategy });
    }
  }
  return plan;
}

function benchmarkBrief({ brief, exercise, seed }) {
  const prefix = brief ? `${brief.trim()} ` : "";
  return `${prefix}Benchmark seed ${seed}: choose a fresh situation that is not a known example for ${exercise.axis}; keep names, setting, and central objects distinct from other candidates.`;
}

function strategyOptions(options, strategy) {
  return {
    ...options,
    candidates: strategy.candidates,
    noRevise: strategy.noRevise,
    repairRounds: strategy.repairRounds,
  };
}

function safeSegment(value) {
  const text = String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return text || "model";
}

function benchmarkRunRecord({ discovery, options, exercises, models, runId, runDir }) {
  return {
    schema_version: BENCH_SCHEMA,
    run_id: runId,
    run_dir: runDir,
    exercise_set: options.exercises,
    exercises: exercises.map(publicExercise),
    models,
    judge_model: options.judgeModel || "",
    workflow_mode: "oracle_guided",
    seeds: options.seeds,
    candidate_count: options.candidates,
    repair_rounds: options.repairRounds,
    dry_run: options.dryRun,
    discovery: {
      mode: discovery.mode,
      package_root: discovery.packageRoot,
      workspace_root: discovery.workspaceRoot,
      manuscript_root: discovery.manuscriptRoot,
      config_path: discovery.configPath,
    },
  };
}

function writeBenchmarkInput(run, plan) {
  writeJsonAtomic(path.join(run.run_dir, "input.json"), {
    ...run,
    run_dir: displayProjectPath(run, run.run_dir),
    plan: plan.map(({ exercise, ...item }) => ({ ...item, exercise: publicExercise(exercise) })),
  });
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function plannedBenchmarkRow(item) {
  return {
    model: item.model,
    exercise: item.exercise.id,
    exercise_axis: item.exercise.axis,
    seed: item.seed,
    brief: item.brief,
    status: "planned",
    winner_source: "",
    mlab_score: null,
    direct_score: null,
    score_delta: null,
    repair_rounds: 0,
    copy_check_ok: null,
    comparison_run_dir: "",
  };
}

function plannedStrategyRow(item) {
  return strategyRow(item.strategy, plannedBenchmarkRow(item));
}

function strategyRow(strategy, row) {
  return {
    strategy: strategy.id,
    strategy_label: strategy.label,
    strategy_settings: strategySettings(strategy),
    ...row,
  };
}

function benchmarkRowFromComparison({ item, result }) {
  const directScore = scoreForSource(result.pairwise, "direct");
  const mlabScore = scoreForSource(result.pairwise, "mlab");
  const firstPassDirectScore = scoreForSource(result.initialPairwise, "direct");
  const firstPassMlabScore = scoreForSource(result.initialPairwise, "mlab");
  const directPass = passForSource(result.pairwise, "direct");
  const mlabPass = passForSource(result.pairwise, "mlab");
  const knownUsage = knownComparisonUsage(result);
  return {
    model: item.model,
    exercise: item.exercise.id,
    exercise_title: item.exercise.title,
    exercise_axis: item.exercise.axis,
    seed: item.seed,
    brief: item.brief,
    status: result.status,
    comparison_run_id: result.run.run_id,
    comparison_run_dir: displayProjectPath(result.run, result.run.run_dir),
    judge_model: result.run.judge_model || result.run.model,
    judge_relation: (result.run.judge_model || result.run.model) === result.run.model ? "self" : "heldout",
    workflow_mode: "oracle_guided",
    first_pass_winner_source: result.initialPairwise?.winner_source ?? result.pairwise?.winner_source ?? "",
    winner_source: result.pairwise?.winner_source ?? "",
    first_pass_mlab_score: firstPassMlabScore,
    first_pass_direct_score: firstPassDirectScore,
    first_pass_score_delta: Number.isFinite(firstPassMlabScore) && Number.isFinite(firstPassDirectScore) ? firstPassMlabScore - firstPassDirectScore : null,
    mlab_score: mlabScore,
    direct_score: directScore,
    score_delta: Number.isFinite(mlabScore) && Number.isFinite(directScore) ? mlabScore - directScore : null,
    mlab_pass: mlabPass,
    direct_pass: directPass,
    repair_rounds: result.repairRounds?.length ?? 0,
    copy_check_ok: result.pairwise?.copy_check?.ok ?? null,
    copy_similarity_score: result.pairwise?.copy_check?.similarity_score ?? null,
    invalid_direct_prose: result.direct?.prose_guard?.ok === false,
    invalid_candidate_count: (result.mlab?.candidates ?? []).filter((candidate) => candidate.prose_guard?.ok === false).length,
    recovered_direct_prose: Boolean(result.direct?.recovered_from_invalid),
    recovered_candidate_count: (result.mlab?.candidates ?? []).filter((candidate) => candidate.recovered_from_invalid).length,
    failure_modes: classifyBenchmarkFailure(result.pairwise),
    known_usage: knownUsage,
  };
}

function benchmarkRowFromError({ item, run, childRunId, compareRunDir, error, options }) {
  const judgeModel = options.judgeModel || item.model;
  return {
    model: item.model,
    exercise: item.exercise.id,
    exercise_title: item.exercise.title,
    exercise_axis: item.exercise.axis,
    seed: item.seed,
    brief: item.brief,
    status: "error",
    comparison_run_id: childRunId,
    comparison_run_dir: displayProjectPath(run, compareRunDir),
    judge_model: judgeModel,
    judge_relation: judgeModel === item.model ? "self" : "heldout",
    workflow_mode: "oracle_guided",
    first_pass_winner_source: "",
    winner_source: "",
    first_pass_mlab_score: null,
    first_pass_direct_score: null,
    first_pass_score_delta: null,
    mlab_score: null,
    direct_score: null,
    score_delta: null,
    mlab_pass: null,
    direct_pass: null,
    repair_rounds: 0,
    copy_check_ok: null,
    copy_similarity_score: null,
    invalid_direct_prose: false,
    invalid_candidate_count: 0,
    recovered_direct_prose: false,
    recovered_candidate_count: 0,
    failure_modes: classifyBenchmarkError(error),
    error_name: error?.name ? String(error.name) : "Error",
    error_message: errorMessage(error),
    known_usage: emptyUsage(),
  };
}

function maybeThrowMockBenchmarkFailure({ options, item }) {
  const failingModels = parseList(options.mockFailModel);
  const failingStrategies = parseList(options.mockFailStrategy);
  if (!failingModels.includes(item.model) && !failingStrategies.includes(options.strategyId)) return;
  const target = failingModels.includes(item.model) ? item.model : options.strategyId;
  const error = new Error(`Mock benchmark failure for ${target}`);
  error.code = "MLAB_MOCK_BENCHMARK_FAILURE";
  throw error;
}

function completionStatus(summary) {
  const total = Number(summary?.total ?? 0);
  const evaluatedRows = Number(summary?.evaluated_rows ?? total);
  const errorRows = Number(summary?.error_rows ?? 0);
  if (total > 0 && evaluatedRows === 0 && errorRows > 0) return { ok: false, status: "error" };
  if (errorRows > 0) return { ok: true, status: "partial" };
  return { ok: true, status: "pass" };
}

function writeBenchmarkProgress(runDir, rows) {
  writeJsonAtomic(path.join(runDir, "rows.json"), rows);
  writeFileAtomic(path.join(runDir, "runs.jsonl"), `${rows.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  writeJsonAtomic(path.join(runDir, "latest-summary.json"), summarizeBenchmarkRows(rows));
}

function writeStrategyProgress(runDir, rows, strategyRuns, strategies) {
  writeJsonAtomic(path.join(runDir, "strategy-runs.json"), strategyRuns);
  writeJsonAtomic(path.join(runDir, "rows.json"), rows);
  writeFileAtomic(path.join(runDir, "runs.jsonl"), `${rows.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  writeJsonAtomic(path.join(runDir, "latest-summary.json"), summarizeStrategyRows(rows, strategies));
}

function recoverFailedStrategyBenchmark({ discovery, paths, options, exercises, models, error }) {
  const runId = options.benchmarkRunId || makeBenchRunId();
  const runDir = options.benchmarkRunDir || paths.stateAbs(path.join("practice-bench", runId));
  const run = benchmarkRunRecord({
    discovery,
    options,
    exercises,
    models,
    runId,
    runDir,
  });
  const plan = buildBenchmarkPlan({ exercises, models, seeds: options.seeds, brief: options.brief });
  const existingRows = readJsonIfExists(path.join(run.run_dir, "rows.json"), []);
  const rows = Array.isArray(existingRows) ? [...existingRows] : [];
  const seen = new Set(rows.map(benchmarkRowKey));
  for (const item of plan) {
    if (seen.has(benchmarkItemKey(item))) continue;
    const childRunId = `${run.run_id}-${safeSegment(item.model)}-${item.exercise.id}-seed-${String(item.seed).padStart(3, "0")}`;
    const compareRunDir = path.join(run.run_dir, "comparisons", safeSegment(item.model), item.exercise.id, `seed-${String(item.seed).padStart(3, "0")}`);
    const row = benchmarkRowFromError({ item, run, childRunId, compareRunDir, error, options: { ...options, model: item.model } });
    writeComparisonError({ run, item, childRunId, compareRunDir, error, row });
    rows.push(row);
  }
  const summary = summarizeBenchmarkRows(rows);
  fs.mkdirSync(run.run_dir, { recursive: true });
  writeBenchmarkInput(run, plan);
  writeBenchmarkProgress(run.run_dir, rows);
  writeJsonAtomic(path.join(run.run_dir, "summary.json"), summary);
  writeBenchmarkReport(run, { rows, summary });
  writeJsonAtomic(path.join(run.run_dir, "benchmark-error.json"), {
    schema_version: "manuscript-lab.practice-benchmark-error.v1",
    run_id: run.run_id,
    status: "error",
    error: {
      name: error?.name ? String(error.name) : "Error",
      message: errorMessage(error),
      failure_modes: classifyBenchmarkError(error),
    },
  });
  return { ok: false, status: "error", run, rows, summary, error_message: errorMessage(error) };
}

function benchmarkRowKey(row) {
  return `${row.model}\u0000${row.exercise}\u0000${row.seed}`;
}

function benchmarkItemKey(item) {
  return `${item.model}\u0000${item.exercise.id}\u0000${item.seed}`;
}

function writeComparisonError({ run, item, childRunId, compareRunDir, error, row }) {
  fs.mkdirSync(compareRunDir, { recursive: true });
  writeJsonAtomic(path.join(compareRunDir, "error.json"), {
    schema_version: "manuscript-lab.practice-comparison-error.v1",
    run_id: childRunId,
    exercise: publicExercise(item.exercise),
    brief: item.brief,
    model: item.model,
    judge_model: row.judge_model,
    status: "error",
    error: {
      name: row.error_name,
      message: row.error_message,
      code: error?.code ? String(error.code) : "",
      failure_modes: row.failure_modes,
    },
    comparison_run_dir: displayProjectPath(run, compareRunDir),
  });
}

function readJsonIfExists(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function emptyUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 };
}

function errorMessage(error) {
  return String(error?.message ?? error ?? "Unknown benchmark error").trim() || "Unknown benchmark error";
}

function classifyBenchmarkError(error) {
  const text = `${error?.name ?? ""} ${error?.code ?? ""} ${errorMessage(error)}`.toLowerCase();
  const modes = [];
  if (/timeout|timed out|abort/.test(text)) modes.push("provider_timeout");
  if (/429|rate.?limit|quota|capacity|overloaded/.test(text)) modes.push("provider_rate_limit");
  if (/unauthorized|forbidden|api.?key|authentication|permission/.test(text)) modes.push("provider_auth");
  if (/json|parse|schema|malformed|invalid response/.test(text)) modes.push("malformed_model_response");
  if (/max.?tokens|max_completion_tokens|length|token/.test(text)) modes.push("token_limit");
  if (/network|fetch|econn|socket|proxy|bad gateway|upstream/.test(text)) modes.push("provider_network");
  if (error?.code === "MLAB_MOCK_BENCHMARK_FAILURE") modes.push("mock_failure");
  modes.push("model_call_error");
  return [...new Set(modes)];
}

function scoreForSource(pairwise, source) {
  const score = pairwise?.scores?.find((item) => item.source === source)?.score;
  return Number.isFinite(Number(score)) ? Number(score) : null;
}

function passForSource(pairwise, source) {
  const score = pairwise?.scores?.find((item) => item.source === source);
  return score ? Boolean(score.pass) : null;
}

function knownComparisonUsage(result) {
  const calls = [
    ...usageCalls("direct", result.direct),
    ...usageCalls("pairwise_initial", result.initialPairwise),
    ...usageCalls("pairwise_final", result.pairwise),
    ...usageCalls("mlab_judge", result.mlab?.judge),
    ...usageCalls("mlab_revision", result.mlab?.revision),
    ...(result.mlab?.candidates ?? []).flatMap((candidate) => usageCalls("mlab_candidate", candidate)),
    ...(result.repairRounds ?? []).flatMap((repair) => [
      ...usageCalls("repair", repair),
      ...usageCalls("repair_pairwise", repair.pairwise),
    ]),
  ];
  const seen = new Set();
  const usages = [];
  for (const call of calls) {
    if (!call?.usage) continue;
    const key = call.id || `${call.kind}:${JSON.stringify(call.usage)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usages.push(call.usage);
  }
  return usages.reduce((acc, usage) => ({
    prompt_tokens: acc.prompt_tokens + Number(usage.prompt_tokens ?? 0),
    completion_tokens: acc.completion_tokens + Number(usage.completion_tokens ?? 0),
    total_tokens: acc.total_tokens + Number(usage.total_tokens ?? 0),
    cost: acc.cost + Number(usage.cost ?? 0),
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 });
}

function usageCalls(kind, value) {
  if (!value) return [];
  if (Array.isArray(value.attempts) && value.attempts.length) {
    return value.attempts.map((attempt, index) => ({
      kind: `${kind}.${attempt.kind ?? index + 1}`,
      id: attempt.model_call_id ?? "",
      usage: attempt.usage ?? null,
    }));
  }
  return [{
    kind,
    id: value.model_call_id ?? "",
    usage: value.usage ?? null,
  }];
}

function classifyBenchmarkFailure(pairwise) {
  const loser = pairwise?.winner_source === "mlab" ? "direct" : "mlab";
  const losingScore = pairwise?.scores?.find((score) => score.source === loser);
  const text = String(losingScore?.reason ?? "").toLowerCase();
  const modes = [];
  if (/stated|explicit|names?|tells?|explains?|exposition|summary/.test(text)) modes.push("too_explicit");
  if (/invisible|unclear|opaque|not visible|cannot infer/.test(text)) modes.push("illegible");
  if (/generic|archetypal|random|neutral|decorative/.test(text)) modes.push("generic");
  if (/meta|analysis|planning|not prose|hidden test|candidate-|revision/.test(text)) modes.push("meta_or_not_prose");
  if (/copy|identical|similar/.test(text)) modes.push("copy_or_similarity");
  if (/flat|no escalation|only surface|surface argument/.test(text)) modes.push("flat_or_surface_only");
  return [...new Set(modes)];
}

function summarizeBenchmarkRows(rows) {
  const completed = rows.filter((row) => row.status !== "planned");
  const evaluated = completed.filter((row) => row.status !== "error");
  const total = completed.length;
  const evaluatedRows = evaluated.length;
  const errorRows = completed.filter((row) => row.status === "error").length;
  const mlabWins = evaluated.filter((row) => row.winner_source === "mlab").length;
  const directWins = evaluated.filter((row) => row.winner_source === "direct").length;
  const firstPassMlabWins = evaluated.filter((row) => row.first_pass_winner_source === "mlab").length;
  const firstPassDirectWins = evaluated.filter((row) => row.first_pass_winner_source === "direct").length;
  const scoreDeltas = evaluated.map((row) => row.score_delta).filter((value) => Number.isFinite(value));
  const firstPassScoreDeltas = evaluated.map((row) => row.first_pass_score_delta).filter((value) => Number.isFinite(value));
  const knownUsage = completed.reduce((acc, row) => ({
    prompt_tokens: acc.prompt_tokens + Number(row.known_usage?.prompt_tokens ?? 0),
    completion_tokens: acc.completion_tokens + Number(row.known_usage?.completion_tokens ?? 0),
    total_tokens: acc.total_tokens + Number(row.known_usage?.total_tokens ?? 0),
    cost: acc.cost + Number(row.known_usage?.cost ?? 0),
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 });
  return {
    schema_version: "manuscript-lab.practice-benchmark-summary.v1",
    total,
    evaluated_rows: evaluatedRows,
    error_rows: errorRows,
    first_pass_mlab_wins: firstPassMlabWins,
    first_pass_direct_wins: firstPassDirectWins,
    first_pass_mlab_win_rate: evaluatedRows ? firstPassMlabWins / evaluatedRows : 0,
    first_pass_average_score_delta: average(firstPassScoreDeltas),
    mlab_wins: mlabWins,
    direct_wins: directWins,
    mlab_win_rate: evaluatedRows ? mlabWins / evaluatedRows : 0,
    direct_win_rate: evaluatedRows ? directWins / evaluatedRows : 0,
    average_score_delta: scoreDeltas.length ? scoreDeltas.reduce((sum, value) => sum + value, 0) / scoreDeltas.length : 0,
    mlab_pass_rate: evaluatedRows ? evaluated.filter((row) => row.mlab_pass).length / evaluatedRows : 0,
    direct_pass_rate: evaluatedRows ? evaluated.filter((row) => row.direct_pass).length / evaluatedRows : 0,
    copy_check_failures: evaluated.filter((row) => row.copy_check_ok === false).length,
    repair_rounds: evaluated.reduce((sum, row) => sum + Number(row.repair_rounds ?? 0), 0),
    repair_recoveries: evaluated.filter((row) => row.first_pass_winner_source === "direct" && row.winner_source === "mlab").length,
    invalid_direct_outputs: evaluated.filter((row) => row.invalid_direct_prose).length,
    invalid_candidate_outputs: evaluated.reduce((sum, row) => sum + Number(row.invalid_candidate_count ?? 0), 0),
    recovered_direct_outputs: evaluated.filter((row) => row.recovered_direct_prose).length,
    recovered_candidate_outputs: evaluated.reduce((sum, row) => sum + Number(row.recovered_candidate_count ?? 0), 0),
    known_usage: knownUsage,
    by_model: summarizeBy(completed, "model"),
    by_exercise: summarizeBy(completed, "exercise"),
    failure_modes: countFailureModes(completed),
  };
}

function summarizeStrategyRows(rows, strategies) {
  const completed = rows.filter((row) => row.status !== "planned");
  const evaluated = completed.filter((row) => row.status !== "error");
  const strategySummaries = summarizeStrategies(completed, strategies);
  return {
    schema_version: "manuscript-lab.practice-strategy-summary.v1",
    total: completed.length,
    evaluated_rows: evaluated.length,
    error_rows: completed.filter((row) => row.status === "error").length,
    strategies: strategySummaries,
    by_exercise: summarizeStrategyExercises(completed),
    recommendations: recommendStrategies(completed),
    known_usage: completed.reduce((acc, row) => ({
      prompt_tokens: acc.prompt_tokens + Number(row.known_usage?.prompt_tokens ?? 0),
      completion_tokens: acc.completion_tokens + Number(row.known_usage?.completion_tokens ?? 0),
      total_tokens: acc.total_tokens + Number(row.known_usage?.total_tokens ?? 0),
      cost: acc.cost + Number(row.known_usage?.cost ?? 0),
    }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 }),
  };
}

function summarizeStrategies(rows, strategies) {
  return Object.fromEntries(strategies.map((strategy) => {
    const bucket = rows.filter((row) => row.strategy === strategy.id);
    const evaluated = bucket.filter((row) => row.status !== "error");
    const total = bucket.length;
    const evaluatedRows = evaluated.length;
    const errorRows = bucket.filter((row) => row.status === "error").length;
    const mlabWins = evaluated.filter((row) => row.winner_source === "mlab").length;
    return [strategy.id, {
      label: strategy.label,
      settings: strategySettings(strategy),
      total,
      evaluated_rows: evaluatedRows,
      error_rows: errorRows,
      error_rate: total ? errorRows / total : 0,
      mlab_wins: mlabWins,
      direct_wins: evaluated.filter((row) => row.winner_source === "direct").length,
      mlab_win_rate: evaluatedRows ? mlabWins / evaluatedRows : 0,
      first_pass_mlab_win_rate: evaluatedRows ? evaluated.filter((row) => row.first_pass_winner_source === "mlab").length / evaluatedRows : 0,
      average_score_delta: average(evaluated.map((row) => row.score_delta).filter((value) => Number.isFinite(value))),
      first_pass_average_score_delta: average(evaluated.map((row) => row.first_pass_score_delta).filter((value) => Number.isFinite(value))),
      repair_rounds: evaluated.reduce((sum, row) => sum + Number(row.repair_rounds ?? 0), 0),
      repair_recoveries: evaluated.filter((row) => row.first_pass_winner_source === "direct" && row.winner_source === "mlab").length,
      invalid_direct_outputs: evaluated.filter((row) => row.invalid_direct_prose).length,
      invalid_candidate_outputs: evaluated.reduce((sum, row) => sum + Number(row.invalid_candidate_count ?? 0), 0),
      recovered_direct_outputs: evaluated.filter((row) => row.recovered_direct_prose).length,
      recovered_candidate_outputs: evaluated.reduce((sum, row) => sum + Number(row.recovered_candidate_count ?? 0), 0),
      known_usage: bucket.reduce((acc, row) => ({
        prompt_tokens: acc.prompt_tokens + Number(row.known_usage?.prompt_tokens ?? 0),
        completion_tokens: acc.completion_tokens + Number(row.known_usage?.completion_tokens ?? 0),
        total_tokens: acc.total_tokens + Number(row.known_usage?.total_tokens ?? 0),
        cost: acc.cost + Number(row.known_usage?.cost ?? 0),
      }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 }),
      failure_modes: countFailureModes(bucket),
    }];
  }));
}

function summarizeStrategyExercises(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (!buckets.has(row.exercise)) buckets.set(row.exercise, []);
    buckets.get(row.exercise).push(row);
  }
  return Object.fromEntries([...buckets.entries()].map(([exercise, bucket]) => [exercise, {
    total: bucket.length,
    strategies: Object.fromEntries([...new Set(bucket.map((row) => row.strategy))].map((strategy) => {
      const strategyRows = bucket.filter((row) => row.strategy === strategy);
      const evaluated = strategyRows.filter((row) => row.status !== "error");
      return [strategy, {
        total: strategyRows.length,
        evaluated_rows: evaluated.length,
        error_rows: strategyRows.filter((row) => row.status === "error").length,
        mlab_wins: evaluated.filter((row) => row.winner_source === "mlab").length,
        average_score_delta: average(evaluated.map((row) => row.score_delta).filter((value) => Number.isFinite(value))),
      }];
    })),
  }]));
}

function recommendStrategies(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (!buckets.has(row.exercise)) buckets.set(row.exercise, []);
    buckets.get(row.exercise).push(row);
  }
  return Object.fromEntries([...buckets.entries()].map(([exercise, bucket]) => {
    const evaluated = bucket.filter((row) => row.status !== "error");
    if (!evaluated.length) {
      return [exercise, {
        strategy: "",
        strategy_label: "",
        settings: {},
        confidence: "none",
        rationale: "No evaluated rows; every attempted comparison errored.",
      }];
    }
    const ranked = aggregateStrategyRows(bucket).sort(compareStrategyRows);
    const best = ranked[0];
    const runnerUp = ranked[1] ?? null;
    return [exercise, {
      strategy: best?.strategy ?? "",
      strategy_label: best?.strategy_label ?? "",
      settings: best?.strategy_settings ?? {},
      confidence: recommendationConfidence(bucket, best, runnerUp),
      rationale: best ? recommendationRationale(best, runnerUp) : "No completed rows.",
    }];
  }));
}

function aggregateStrategyRows(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (!buckets.has(row.strategy)) buckets.set(row.strategy, []);
    buckets.get(row.strategy).push(row);
  }
  return [...buckets.entries()].map(([strategy, bucket]) => {
    const first = bucket[0] ?? {};
    const evaluated = bucket.filter((row) => row.status !== "error");
    const total = bucket.length;
    const evaluatedRows = evaluated.length;
    const errorRows = bucket.filter((row) => row.status === "error").length;
    const mlabWins = evaluated.filter((row) => row.winner_source === "mlab").length;
    const knownUsage = bucket.reduce((acc, row) => ({
      prompt_tokens: acc.prompt_tokens + Number(row.known_usage?.prompt_tokens ?? 0),
      completion_tokens: acc.completion_tokens + Number(row.known_usage?.completion_tokens ?? 0),
      total_tokens: acc.total_tokens + Number(row.known_usage?.total_tokens ?? 0),
      cost: acc.cost + Number(row.known_usage?.cost ?? 0),
    }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 });
    return {
      strategy,
      strategy_label: first.strategy_label ?? strategy,
      strategy_settings: first.strategy_settings ?? {},
      total,
      evaluated_rows: evaluatedRows,
      error_rows: errorRows,
      error_rate: total ? errorRows / total : 0,
      winner_source: evaluatedRows ? (mlabWins >= evaluatedRows - mlabWins ? "mlab" : "direct") : "",
      mlab_wins: mlabWins,
      direct_wins: evaluated.filter((row) => row.winner_source === "direct").length,
      mlab_win_rate: evaluatedRows ? mlabWins / evaluatedRows : 0,
      first_pass_mlab_win_rate: evaluatedRows ? evaluated.filter((row) => row.first_pass_winner_source === "mlab").length / evaluatedRows : 0,
      average_score_delta: average(evaluated.map((row) => row.score_delta).filter((value) => Number.isFinite(value))),
      first_pass_average_score_delta: average(evaluated.map((row) => row.first_pass_score_delta).filter((value) => Number.isFinite(value))),
      repair_rounds: evaluated.reduce((sum, row) => sum + Number(row.repair_rounds ?? 0), 0),
      repair_recoveries: evaluated.filter((row) => row.first_pass_winner_source === "direct" && row.winner_source === "mlab").length,
      known_usage: knownUsage,
      failure_modes: countFailureModes(bucket),
    };
  });
}

function compareStrategyRows(a, b) {
  const aWin = Number.isFinite(Number(a.mlab_win_rate)) ? Number(a.mlab_win_rate) : (a.winner_source === "mlab" ? 1 : 0);
  const bWin = Number.isFinite(Number(b.mlab_win_rate)) ? Number(b.mlab_win_rate) : (b.winner_source === "mlab" ? 1 : 0);
  if (aWin !== bWin) return bWin - aWin;
  const aErrorRate = Number.isFinite(Number(a.error_rate)) ? Number(a.error_rate) : Number(a.error_rows ?? 0) / Math.max(1, Number(a.total ?? 1));
  const bErrorRate = Number.isFinite(Number(b.error_rate)) ? Number(b.error_rate) : Number(b.error_rows ?? 0) / Math.max(1, Number(b.total ?? 1));
  if (aErrorRate !== bErrorRate) return aErrorRate - bErrorRate;
  const aDelta = Number.isFinite(Number(a.average_score_delta)) ? Number(a.average_score_delta) : Number.isFinite(Number(a.score_delta)) ? Number(a.score_delta) : -Infinity;
  const bDelta = Number.isFinite(Number(b.average_score_delta)) ? Number(b.average_score_delta) : Number.isFinite(Number(b.score_delta)) ? Number(b.score_delta) : -Infinity;
  if (aDelta !== bDelta) return bDelta - aDelta;
  const aCost = Number(a.known_usage?.cost ?? a.cost ?? 0) / Math.max(1, Number(a.total ?? 1));
  const bCost = Number(b.known_usage?.cost ?? b.cost ?? 0) / Math.max(1, Number(b.total ?? 1));
  if (aCost !== bCost) return aCost - bCost;
  return strategyRank(a.strategy) - strategyRank(b.strategy);
}

function strategyRank(id) {
  const index = STRATEGY_PRESETS.findIndex((strategy) => strategy.id === id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function recommendationConfidence(bucket, best, runnerUp) {
  if (!best) return "none";
  const strategyCount = new Set(bucket.map((row) => row.strategy)).size || 1;
  const evaluatedCount = bucket.filter((row) => row.status !== "error").length;
  if (evaluatedCount < strategyCount * 2) return "low";
  if (!runnerUp) return "medium";
  const winGap = Number(best.mlab_win_rate ?? 0) - Number(runnerUp.mlab_win_rate ?? 0);
  const deltaGap = Number(best.average_score_delta ?? 0) - Number(runnerUp.average_score_delta ?? 0);
  const errorGap = Number(runnerUp.error_rate ?? 0) - Number(best.error_rate ?? 0);
  if (evaluatedCount >= strategyCount * 4 && (winGap >= 0.34 || deltaGap >= 3 || errorGap >= 0.34)) return "high";
  if (winGap >= 0.25 || deltaGap >= 2) return "medium";
  return "low";
}

function recommendationRationale(best, runnerUp) {
  const parts = [
    `${best.strategy_label} won ${best.mlab_wins}/${best.evaluated_rows} evaluated row(s) with average delta ${formatNumber(best.average_score_delta)} and known cost $${Number(best.known_usage?.cost ?? 0).toFixed(4)}.`,
  ];
  if (runnerUp) {
    parts.push(`Next best was ${runnerUp.strategy_label} at ${runnerUp.mlab_wins}/${runnerUp.evaluated_rows} evaluated row(s) and average delta ${formatNumber(runnerUp.average_score_delta)}.`);
  }
  if (Number(best.error_rows ?? 0) > 0) {
    parts.push(`${best.error_rows} row(s) errored for this strategy in the sample.`);
  }
  if (Number(best.repair_rounds ?? 0) > 0 && Number(best.repair_recoveries ?? 0) === 0) {
    parts.push("Repair ran without producing a direct-to-mlab recovery in this sample.");
  }
  return parts.join(" ");
}

function summarizeBy(rows, key) {
  const buckets = new Map();
  for (const row of rows) {
    const id = row[key] ?? "";
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(row);
  }
  return Object.fromEntries([...buckets.entries()].map(([id, bucket]) => [id, {
    total: bucket.length,
    evaluated_rows: bucket.filter((row) => row.status !== "error").length,
    error_rows: bucket.filter((row) => row.status === "error").length,
    mlab_wins: bucket.filter((row) => row.status !== "error" && row.winner_source === "mlab").length,
    direct_wins: bucket.filter((row) => row.status !== "error" && row.winner_source === "direct").length,
    average_score_delta: average(bucket.filter((row) => row.status !== "error").map((row) => row.score_delta).filter((value) => Number.isFinite(value))),
  }]));
}

function countFailureModes(rows) {
  const counts = {};
  for (const row of rows) {
    for (const mode of row.failure_modes ?? []) counts[mode] = (counts[mode] ?? 0) + 1;
  }
  return counts;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function writeBenchmarkReport(run, { rows, summary }) {
  const lines = [
    `# Practice Benchmark ${run.run_id}`,
    "",
    `Exercises: ${run.exercise_set}`,
    `Models: ${run.models.join(", ")}`,
    `Judge model: ${run.judge_model || "same as writer model"}`,
    `Workflow mode: ${run.workflow_mode}`,
    `Seeds: ${run.seeds}`,
    `Total runs: ${summary.total}`,
    `Evaluated runs: ${summary.evaluated_rows}`,
    `Errors: ${summary.error_rows}`,
    `First-pass MLab wins: ${summary.first_pass_mlab_wins}`,
    `First-pass MLab win rate: ${(summary.first_pass_mlab_win_rate * 100).toFixed(1)}%`,
    `First-pass average score delta: ${summary.first_pass_average_score_delta.toFixed(2)}`,
    `Post-repair MLab wins: ${summary.mlab_wins}`,
    `Post-repair direct wins: ${summary.direct_wins}`,
    `Repair recoveries: ${summary.repair_recoveries}`,
    `Post-repair MLab win rate: ${(summary.mlab_win_rate * 100).toFixed(1)}%`,
    `Average score delta: ${summary.average_score_delta.toFixed(2)}`,
    `Invalid direct outputs: ${summary.invalid_direct_outputs}`,
    `Invalid candidate outputs: ${summary.invalid_candidate_outputs}`,
    `Recovered direct outputs: ${summary.recovered_direct_outputs}`,
    `Recovered candidate outputs: ${summary.recovered_candidate_outputs}`,
    `Known cost: $${summary.known_usage.cost.toFixed(4)}`,
    "",
    "## Rows",
    "",
    "| Exercise | Model | Seed | Status | First | Final | MLab | Direct | Delta | Repairs | Copy | Error |",
    "| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...rows.map((row) => markdownTableRow([
      row.exercise,
      row.model,
      row.seed,
      row.status,
      row.first_pass_winner_source,
      row.winner_source,
      row.mlab_score ?? "",
      row.direct_score ?? "",
      row.score_delta ?? "",
      row.repair_rounds,
      row.copy_check_ok === false ? "fail" : row.copy_check_ok === true ? "pass" : "",
      row.error_message ?? "",
    ])),
    "",
  ];
  writeFileAtomic(path.join(run.run_dir, "RESULTS.md"), lines.join("\n"), "utf8");
}

function writeStrategyReport(run, { rows, strategyRuns, summary }) {
  const lines = [
    `# Practice Strategy Comparison ${run.run_id}`,
    "",
    `Exercises: ${run.exercise_set}`,
    `Models: ${run.models.join(", ")}`,
    `Judge model: ${run.judge_model || "same as writer model"}`,
    `Seeds: ${run.seeds}`,
    `Total rows: ${summary.total}`,
    `Evaluated rows: ${summary.evaluated_rows}`,
    `Errors: ${summary.error_rows}`,
    `Known cost: $${summary.known_usage.cost.toFixed(4)}`,
    "",
    "## Strategies",
    "",
    "| Strategy | Settings | MLab Wins | Errors | Win Rate | Avg Delta | Cost | Repairs | Repair Recoveries |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(summary.strategies).map(([id, item]) => markdownTableRow([
      id,
      strategySettingsLabel(item.settings),
      `${item.mlab_wins}/${item.evaluated_rows}`,
      item.error_rows,
      `${(item.mlab_win_rate * 100).toFixed(1)}%`,
      item.average_score_delta.toFixed(2),
      `$${item.known_usage.cost.toFixed(4)}`,
      item.repair_rounds,
      item.repair_recoveries,
    ])),
    "",
    "## Recommendations",
    "",
    "| Exercise | Recommended Strategy | Confidence | Rationale |",
    "| --- | --- | --- | --- |",
    ...Object.entries(summary.recommendations).map(([exercise, item]) => markdownTableRow([
      exercise,
      item.strategy,
      item.confidence,
      item.rationale,
    ])),
    "",
    "## Child Benchmarks",
    "",
    ...strategyRuns.map((item) => `- ${item.strategy}: ${item.run_dir}`),
    "",
    "## Rows",
    "",
    "| Strategy | Exercise | Model | Seed | Status | First | Final | Delta | Repairs | Cost | Error |",
    "| --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows.map((row) => markdownTableRow([
      row.strategy,
      row.exercise,
      row.model,
      row.seed,
      row.status,
      row.first_pass_winner_source,
      row.winner_source,
      row.score_delta ?? "",
      row.repair_rounds,
      `$${Number(row.known_usage?.cost ?? 0).toFixed(4)}`,
      row.error_message ?? "",
    ])),
    "",
  ];
  writeFileAtomic(path.join(run.run_dir, "STRATEGY_REPORT.md"), lines.join("\n"), "utf8");
}

function strategySettingsLabel(settings) {
  return [
    `${settings.candidates} candidate${settings.candidates === 1 ? "" : "s"}`,
    settings.no_revise ? "no revision" : "revision",
    `${settings.repair_rounds} repair${settings.repair_rounds === 1 ? "" : "s"}`,
  ].join(", ");
}

function markdownTableRow(values) {
  return `| ${values.map(markdownTableCell).join(" | ")} |`;
}

function markdownTableCell(value) {
  return String(value ?? "").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

async function generateDirectBaseline({ run, options, discovery, paths }) {
  if (options.mockDirectFile) {
    return {
      id: "direct",
      text: fs.readFileSync(path.resolve(options.mockDirectFile), "utf8").trim(),
      model: "",
      model_call_id: null,
      model_call_path: null,
      usage: null,
    };
  }

  prepareModelProviderEnvironment(discovery, paths);
  const { callChatModel } = await import("./lib/model-provider.mjs");
  const prose = await callPracticeProse({
    callChatModel,
    model: run.model,
    title: `practice-${run.exercise.id}-direct`,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    content: [
      `Exercise: ${run.exercise.public_prompt}`,
      run.brief ? `Brief: ${run.brief}` : "",
      "Length: 300 to 450 words.",
    ].filter(Boolean).join("\n"),
    audit: {
      enabled: true,
      operation: "practice.direct_baseline",
      run_id: run.run_id,
      target: run.exercise.id,
      artifact_paths: [displayProjectPath(run, run.run_dir)],
    },
  });
  return {
    id: "direct",
    text: prose.text,
    model: prose.response.model,
    model_call_id: prose.response.model_call_id,
    model_call_path: prose.response.model_call_path,
    usage: prose.response.usage,
    prose_guard: prose.prose_guard,
    attempts: prose.attempts,
    recovered_from_invalid: prose.recovered_from_invalid,
  };
}

async function generateMlabPracticeOutput({ run, options, discovery, paths }) {
  if (options.mockMlabFile) {
    return {
      run_id: "",
      run_dir: "",
      final: fs.readFileSync(path.resolve(options.mockMlabFile), "utf8").trim(),
      winner_id: "",
      judge: null,
      candidates: [],
    };
  }

  const mlabRun = {
    schema_version: RUN_SCHEMA,
    run_id: `${run.run_id}-mlab`,
    exercise: run.exercise,
    brief: run.brief,
    model: run.model,
    judge_model: run.judge_model || run.model,
    candidate_count: run.candidate_count,
    dry_run: false,
    run_dir: path.join(run.run_dir, "mlab"),
    discovery: run.discovery,
  };
  initializeRun(mlabRun);
  const candidates = await loadOrGenerateCandidates({ run: mlabRun, options, discovery, paths });
  writeCandidates(mlabRun, candidates);
  const judge = await loadOrJudgeCandidates({ run: mlabRun, options, candidates, discovery, paths });
  writeJsonAtomic(path.join(mlabRun.run_dir, "judgment.json"), judge);
  const winner = candidates.find((candidate) => candidate.id === judge.winner_id) ?? candidates[0];
  const final = await reviseWinner({ run: mlabRun, options, winner, judge, discovery, paths });
  const revision = loadJsonIfExists(path.join(mlabRun.run_dir, "revision-meta.json"));
  writeFileAtomic(path.join(mlabRun.run_dir, "winner.md"), `${winner.text.trim()}\n`, "utf8");
  writeFileAtomic(path.join(mlabRun.run_dir, "final.md"), `${final.trim()}\n`, "utf8");
  writeReport(mlabRun, { candidates, judge, final });
  return {
    run_id: mlabRun.run_id,
    run_dir: displayProjectPath(run, mlabRun.run_dir),
    final,
    winner_id: judge.winner_id,
    judge,
    revision,
    candidates,
  };
}

async function judgeDirectVsMlab({ run, options, direct, mlab, discovery, paths, round = 0 }) {
  const mapping = blindPairwiseMapping(`${run.run_id}:${round}`, direct.text, mlab.final);
  if (options.mockPairwiseFile) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(options.mockPairwiseFile), "utf8"));
    return applyCopyGuard(normalizePairwiseJudge(raw, mapping), direct, mlab);
  }
  if (options.mockDirectFile && (options.mockMlabFile || options.mockCandidatesFile)) {
    return applyCopyGuard(normalizePairwiseJudge({
      winner_id: mapping.find((item) => item.source === "mlab").id,
      scores: mapping.map((item) => ({
        id: item.id,
        score: item.source === "mlab" ? 1 : 0,
        pass: true,
        inferred_effect: "Deterministic mock pairwise judgment.",
        reason: "Deterministic mock pairwise judgment.",
      })),
      rationale: "Deterministic mock pairwise judgment selected mlab.",
    }, mapping), direct, mlab);
  }

  prepareModelProviderEnvironment(discovery, paths);
  const { callChatModel } = await import("./lib/model-provider.mjs");
  const response = await callChatModel({
    model: run.judge_model || run.model,
    title: `practice-${run.exercise.id}-pairwise${round ? `-${round}` : ""}`,
    temperature: 0,
    maxTokens: 900,
    responseFormat: JSON_OBJECT_RESPONSE_FORMAT,
    system: "You are a blind writing-exercise judge. Return exactly one JSON object. Do not rewrite the prose.",
    content: JSON.stringify({
      exercise: {
        id: run.exercise.id,
        title: run.exercise.title,
        hidden_test: run.exercise.hidden_test,
      },
      brief: run.brief,
      candidates: mapping.map(({ id, text }) => ({ id, text })),
      required_shape: {
        winner_id: "A",
        scores: [{ id: "A", score: 0, pass: false, inferred_effect: "", reason: "brief" }],
        rationale: "brief comparison",
      },
    }, null, 2),
    audit: {
      enabled: true,
      operation: "practice.pairwise_judge",
      run_id: run.run_id,
      target: run.exercise.id,
      artifact_paths: [displayProjectPath(run, run.run_dir)],
    },
  });
  const parsed = parseJsonObjectOrThrow(response.content, {
    likelyRootKeys: ["winner_id", "scores", "rationale"],
  });
  return applyCopyGuard(normalizePairwiseJudge(parsed, mapping, response), direct, mlab);
}

async function repairMlabAgainstDirect({ run, options, direct, mlab, pairwise, discovery, paths, round }) {
  if (options.mockDirectFile || options.mockMlabFile || options.mockPairwiseFile) {
    return {
      schema_version: "manuscript-lab.practice-repair-round.v1",
      round,
      status: "skipped",
      changed: false,
      final: mlab.final,
      reason: "mock comparison inputs do not call live repair",
    };
  }

  prepareModelProviderEnvironment(discovery, paths);
  const { callChatModel } = await import("./lib/model-provider.mjs");
  const response = await callChatModel({
    model: run.model,
    title: `practice-${run.exercise.id}-repair-${round}`,
    temperature: Math.min(options.temperature, 0.4),
    maxTokens: structuredProseMaxTokens(options),
    responseFormat: JSON_OBJECT_RESPONSE_FORMAT,
    system: [
      "Return exactly one JSON object.",
      "The object must contain final_prose.",
      "final_prose must be literary prose only: no title, no analysis, no explanation, no test language.",
    ].join(" "),
    content: [
      "Repair the Manuscript Lab output after it lost a blind direct-vs-mlab comparison.",
      "You will receive the judge's summary of why the baseline won, not the baseline prose.",
      "Do not copy the baseline premise, images, sentences, or structure.",
      "Use the pairwise critique to make the Manuscript Lab output stronger on the hidden test.",
      "Do not mention the test, the judge, direct output, mlab output, candidates, or your revision plan.",
      "Return JSON only, with this shape: {\"final_prose\":\"...\"}.",
      "",
      `Exercise: ${run.exercise.public_prompt}`,
      run.brief ? `Brief: ${run.brief}` : "",
      `Hidden test: ${run.exercise.hidden_test}`,
      "",
      "Current Manuscript Lab output:",
      mlab.final,
      "",
      "Baseline strengths from the blind judge:",
      summarizeWinningBaselineForRepair(pairwise),
      "",
      "Repair critique:",
      summarizePairwiseForRepair(pairwise),
    ].filter(Boolean).join("\n"),
    audit: {
      enabled: true,
      operation: "practice.repair",
      run_id: run.run_id,
      target: run.exercise.id,
      artifact_paths: [displayProjectPath(run, run.run_dir)],
    },
  });

  try {
    const parsed = parseJsonObjectOrThrow(response.content, {
      likelyRootKeys: ["final_prose"],
    });
    const finalProse = String(parsed.final_prose ?? parsed.prose ?? "").trim();
    const assessment = assessPracticeProse(finalProse);
    if (assessment.ok) {
      const distinct = assessDistinctPracticeProse(assessment.text, direct.text);
      if (!distinct.ok) {
        return {
          schema_version: "manuscript-lab.practice-repair-round.v1",
          round,
          status: "fallback_previous",
          changed: false,
          final: mlab.final,
          reason: `repair output was too similar to direct baseline: ${distinct.reason}`,
          similarity_score: distinct.score,
          model: response.model,
          model_call_id: response.model_call_id,
          model_call_path: response.model_call_path,
        };
      }
      return {
        schema_version: "manuscript-lab.practice-repair-round.v1",
        round,
        status: "repaired",
        changed: assessment.text !== mlab.final.trim(),
        final: assessment.text,
        model: response.model,
        model_call_id: response.model_call_id,
        model_call_path: response.model_call_path,
        usage: response.usage,
      };
    }
    return {
      schema_version: "manuscript-lab.practice-repair-round.v1",
      round,
      status: "fallback_previous",
      changed: false,
      final: mlab.final,
      reason: "repair output failed prose guard",
      reasons: assessment.reasons,
      model: response.model,
      model_call_id: response.model_call_id,
      model_call_path: response.model_call_path,
      usage: response.usage,
    };
  } catch (error) {
    return {
      schema_version: "manuscript-lab.practice-repair-round.v1",
      round,
      status: "fallback_previous",
      changed: false,
      final: mlab.final,
      reason: `repair output was not parseable JSON: ${error.message}`,
      model: response.model,
      model_call_id: response.model_call_id,
      model_call_path: response.model_call_path,
      usage: response.usage,
    };
  }
}

function summarizePairwiseForRepair(pairwise) {
  return JSON.stringify({
    winner_source: pairwise.winner_source,
    rationale: pairwise.rationale,
    scores: pairwise.scores?.map((score) => ({
      source: score.source,
      score: score.score,
      pass: score.pass,
      inferred_effect: score.inferred_effect,
      reason: score.reason,
    })) ?? [],
  }, null, 2);
}

function summarizeWinningBaselineForRepair(pairwise) {
  const direct = pairwise.scores?.find((score) => score.source === "direct");
  return JSON.stringify({
    score: direct?.score ?? null,
    pass: direct?.pass ?? null,
    inferred_effect: direct?.inferred_effect ?? "",
    reason: direct?.reason ?? "",
  }, null, 2);
}

function writeRepairRound(run, repair) {
  const dir = path.join(run.run_dir, "repair-rounds");
  fs.mkdirSync(dir, { recursive: true });
  const stem = `round-${String(repair.round).padStart(3, "0")}`;
  writeFileAtomic(path.join(dir, `${stem}.md`), `${repair.final.trim()}\n`, "utf8");
  const { final, pairwise, ...meta } = repair;
  writeJsonAtomic(path.join(dir, `${stem}-meta.json`), meta);
  if (pairwise) writeJsonAtomic(path.join(dir, `${stem}-pairwise.json`), pairwise);
}

function blindPairwiseMapping(runId, directText, mlabText) {
  const mlabFirst = crypto.createHash("sha256").update(runId).digest()[0] % 2 === 0;
  const first = mlabFirst ? { source: "mlab", text: mlabText } : { source: "direct", text: directText };
  const second = mlabFirst ? { source: "direct", text: directText } : { source: "mlab", text: mlabText };
  return [
    { id: "A", ...first },
    { id: "B", ...second },
  ];
}

function normalizePairwiseJudge(value, mapping, response = null) {
  const ids = new Set(mapping.map((item) => item.id));
  const fallback = mapping[0];
  const winnerId = ids.has(value.winner_id) ? value.winner_id : fallback.id;
  const winner = mapping.find((item) => item.id === winnerId) ?? fallback;
  const scores = Array.isArray(value.scores) ? value.scores.map((score) => {
    const mapped = mapping.find((item) => item.id === score.id) ?? fallback;
    return {
      id: mapped.id,
      source: mapped.source,
      score: Number.isFinite(Number(score.score)) ? Number(score.score) : 0,
      pass: Boolean(score.pass),
      inferred_effect: String(score.inferred_effect ?? score.inferred_want ?? ""),
      reason: String(score.reason ?? ""),
    };
  }) : [];
  return {
    schema_version: "manuscript-lab.practice-pairwise-judgment.v1",
    winner_id: winnerId,
    winner_source: winner.source,
    mapping: mapping.map(({ id, source }) => ({ id, source })),
    scores,
    rationale: String(value.rationale ?? ""),
    model: response?.model ?? "",
    model_call_id: response?.model_call_id ?? null,
    model_call_path: response?.model_call_path ?? null,
    usage: response?.usage ?? null,
  };
}

function applyCopyGuard(pairwise, direct, mlab) {
  const distinct = assessDistinctPracticeProse(mlab.final, direct.text);
  if (distinct.ok) {
    return {
      ...pairwise,
      copy_check: {
        ok: true,
        similarity_score: distinct.score,
      },
    };
  }
  const directMapping = pairwise.mapping.find((item) => item.source === "direct") ?? pairwise.mapping[0];
  return {
    ...pairwise,
    winner_id: directMapping.id,
    winner_source: "direct",
    rationale: [
      pairwise.rationale,
      `Copy guard: Manuscript Lab output is too similar to the direct baseline (${distinct.reason}; score ${distinct.score.toFixed(3)}), so this cannot count as a distinct mlab win.`,
    ].filter(Boolean).join("\n\n"),
    copy_check: {
      ok: false,
      similarity_score: distinct.score,
      reason: distinct.reason,
    },
  };
}

function writeComparisonReport(run, { direct, mlab, pairwise }) {
  const lines = [
    `# Practice Comparison ${run.run_id}`,
    "",
    `Exercise: ${run.exercise.title}`,
    `Model: ${run.model}`,
    `Winner: ${pairwise.winner_source}`,
    `Repair history: ${fs.existsSync(path.join(run.run_dir, "repair-history.json")) ? "repair-history.json" : "none"}`,
    "",
    "## Pairwise Judgment",
    "",
    pairwise.rationale || "",
    "",
    "## Direct Baseline",
    "",
    direct.text.trim(),
    "",
    "## MLab Output",
    "",
    mlab.final.trim(),
    "",
  ];
  writeFileAtomic(path.join(run.run_dir, "REPORT.md"), lines.join("\n"), "utf8");
}

function initializeRun(run) {
  fs.mkdirSync(run.run_dir, { recursive: true });
  writeJsonAtomic(path.join(run.run_dir, "input.json"), {
    schema_version: RUN_SCHEMA,
    run_id: run.run_id,
    exercise: run.exercise,
    brief: run.brief,
    model: run.model,
    candidate_count: run.candidate_count,
    discovery: run.discovery,
  });
}

async function loadOrGenerateCandidates({ run, options, discovery, paths }) {
  if (options.mockCandidatesFile) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(options.mockCandidatesFile), "utf8"));
    const texts = Array.isArray(raw) ? raw : raw.candidates;
    if (!Array.isArray(texts) || !texts.length) throw new Error("--mock-candidates-file must contain a non-empty JSON array.");
    return texts.map((text, index) => candidateRecord(index + 1, String(text)));
  }

  prepareModelProviderEnvironment(discovery, paths);
  const { callChatModel } = await import("./lib/model-provider.mjs");
  const candidates = [];
  for (let index = 1; index <= options.candidates; index += 1) {
    const prose = await callPracticeProse({
      callChatModel,
      model: run.model,
      title: `practice-${run.exercise.id}-candidate-${index}`,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      content: buildCandidatePrompt(run, index),
      audit: {
        enabled: true,
        operation: "practice.candidate",
        run_id: run.run_id,
        target: run.exercise.id,
        artifact_paths: [displayProjectPath(run, run.run_dir)],
      },
    });
    candidates.push(candidateRecord(index, prose.text, prose.response, {
      attempts: prose.attempts,
      recovered_from_invalid: prose.recovered_from_invalid,
      prose_guard: prose.prose_guard,
    }));
  }
  return candidates;
}

async function callPracticeProse({ callChatModel, model, title, temperature, maxTokens, content, audit }) {
  const attempts = [];
  const first = await callChatModel({
    model,
    title,
    temperature,
    maxTokens,
    system: proseOnlySystemPrompt(),
    content,
    audit,
  });
  const firstText = first.content.trim();
  const firstGuard = assessPracticeProse(firstText);
  attempts.push(proseAttempt("initial", first, firstText, firstGuard));
  if (firstGuard.ok) {
    return {
      text: firstText,
      response: first,
      prose_guard: firstGuard,
      attempts,
      recovered_from_invalid: false,
    };
  }

  const retry = await callChatModel({
    model,
    title: `${title}-prose-retry`,
    temperature: Math.min(Number(temperature) || 0.4, 0.4),
    maxTokens,
    responseFormat: JSON_OBJECT_RESPONSE_FORMAT,
    system: [
      "Return exactly one JSON object.",
      "Do not include reasoning, notes, planning, markdown, code fences, titles, or explanations.",
      "The JSON object must contain only one key: final_prose.",
    ].join("\n"),
    content: JSON.stringify({
      task: "Write only the finished literary prose requested by the prompt.",
      previous_output_rejected_for: firstGuard.reasons,
      prompt: content,
      required_shape: {
        final_prose: "300 to 450 words of finished prose only",
      },
    }, null, 2),
    audit: audit ? { ...audit, operation: `${audit.operation}.prose_retry` } : audit,
  });
  const retryText = extractFinalProse(retry.content);
  const retryGuard = assessPracticeProse(retryText);
  attempts.push(proseAttempt("prose_retry", retry, retryText, retryGuard));
  if (retryGuard.ok || retryText) {
    return {
      text: retryText || firstText,
      response: retry,
      prose_guard: retryText ? retryGuard : firstGuard,
      attempts,
      recovered_from_invalid: retryGuard.ok,
    };
  }
  return {
    text: firstText,
    response: first,
    prose_guard: firstGuard,
    attempts,
    recovered_from_invalid: false,
  };
}

function proseOnlySystemPrompt() {
  return [
    "Write finished literary prose only.",
    "No title, no analysis, no explanation, no planning notes, no commentary about the prompt.",
    "Do not say what the exercise requires; simply write the scene.",
  ].join("\n");
}

function extractFinalProse(content) {
  try {
    const parsed = parseJsonObjectOrThrow(content, { likelyRootKeys: ["final_prose"] });
    return String(parsed.final_prose ?? "").trim();
  } catch {
    return String(content ?? "").trim();
  }
}

function proseAttempt(kind, response, text, proseGuard) {
  return {
    kind,
    model: response.model,
    model_call_id: response.model_call_id,
    model_call_path: response.model_call_path,
    usage: response.usage,
    prose_guard: {
      ok: proseGuard.ok,
      reasons: proseGuard.reasons,
    },
    text_sha256: sha256Text(text),
  };
}

async function loadOrJudgeCandidates({ run, options, candidates, discovery, paths }) {
  if (options.mockJudgeFile) {
    return JSON.parse(fs.readFileSync(path.resolve(options.mockJudgeFile), "utf8"));
  }
  if (options.mockCandidatesFile) {
    return deterministicJudge(candidates);
  }

  prepareModelProviderEnvironment(discovery, paths);
  const { callChatModel } = await import("./lib/model-provider.mjs");
  const response = await callChatModel({
    model: run.judge_model || run.model,
    title: `practice-${run.exercise.id}-judge`,
    temperature: 0,
    maxTokens: 900,
    responseFormat: JSON_OBJECT_RESPONSE_FORMAT,
    system: "You are a blind writing-exercise judge. Return exactly one JSON object. Do not rewrite the prose.",
    content: buildJudgePrompt(run, candidates),
    audit: {
      enabled: true,
      operation: "practice.judge",
      run_id: run.run_id,
      target: run.exercise.id,
      artifact_paths: [displayProjectPath(run, run.run_dir)],
    },
  });
  const parsed = parseJsonObjectOrThrow(response.content, {
    likelyRootKeys: ["winner_id", "scores", "rationale", "revision_brief"],
  });
  return normalizeJudge(parsed, candidates, response);
}

async function reviseWinner({ run, options, winner, judge, discovery, paths }) {
  if (options.noRevise || options.mockCandidatesFile) {
    writeRevisionMeta(run, {
      status: "skipped",
      reason: options.noRevise ? "--no-revise" : "mock candidates use deterministic winner text",
      fallback_used: true,
      fallback_candidate_id: winner.id,
    });
    return winner.text;
  }

  prepareModelProviderEnvironment(discovery, paths);
  const { callChatModel } = await import("./lib/model-provider.mjs");
  const response = await callChatModel({
    model: run.model,
    title: `practice-${run.exercise.id}-revise`,
    temperature: Math.min(options.temperature, 0.4),
    maxTokens: structuredProseMaxTokens(options),
    responseFormat: JSON_OBJECT_RESPONSE_FORMAT,
    system: [
      "Return exactly one JSON object.",
      "The object must contain final_prose.",
      "final_prose must be literary prose only: no title, no analysis, no explanation, no test language.",
    ].join(" "),
    content: [
      "Revise the selected candidate so it better satisfies the hidden exercise test.",
      "Do not state the test, the intended effect, or your analysis in the prose.",
      "Return JSON only, with this shape: {\"final_prose\":\"...\"}.",
      "",
      `Exercise: ${run.exercise.public_prompt}`,
      run.brief ? `Brief: ${run.brief}` : "",
      `Hidden test: ${run.exercise.hidden_test}`,
      `Judge feedback: ${judge.revision_brief || judge.rationale || ""}`,
      "",
      "Candidate:",
      winner.text,
    ].filter(Boolean).join("\n"),
    audit: {
      enabled: true,
      operation: "practice.revise",
      run_id: run.run_id,
      target: run.exercise.id,
      artifact_paths: [displayProjectPath(run, run.run_dir)],
    },
  });
  const fallback = winner.text.trim();
  try {
    const parsed = parseJsonObjectOrThrow(response.content, {
      likelyRootKeys: ["final_prose"],
    });
    const finalProse = String(parsed.final_prose ?? parsed.prose ?? "").trim();
    const assessment = assessPracticeProse(finalProse);
    if (assessment.ok) {
      writeRevisionMeta(run, {
        status: "revised",
        fallback_used: false,
        model: response.model,
        model_call_id: response.model_call_id,
        model_call_path: response.model_call_path,
        usage: response.usage,
      });
      return assessment.text;
    }
    writeRevisionMeta(run, {
      status: "fallback_winner",
      reason: "revision output failed prose guard",
      reasons: assessment.reasons,
      fallback_used: true,
      fallback_candidate_id: winner.id,
      model: response.model,
      model_call_id: response.model_call_id,
      model_call_path: response.model_call_path,
      usage: response.usage,
    });
    return fallback;
  } catch (error) {
    writeRevisionMeta(run, {
      status: "fallback_winner",
      reason: `revision output was not parseable JSON: ${error.message}`,
      fallback_used: true,
      fallback_candidate_id: winner.id,
      model: response.model,
      model_call_id: response.model_call_id,
      model_call_path: response.model_call_path,
      usage: response.usage,
    });
    return fallback;
  }
}

function writeRevisionMeta(run, meta) {
  writeJsonAtomic(path.join(run.run_dir, "revision-meta.json"), {
    schema_version: "manuscript-lab.practice-revision.v1",
    updated_at: new Date().toISOString(),
    ...meta,
  });
}

function loadJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCandidates(run, candidates) {
  const dir = path.join(run.run_dir, "candidates");
  fs.mkdirSync(dir, { recursive: true });
  for (const candidate of candidates) {
    writeFileAtomic(path.join(dir, `${candidate.id}.md`), `${candidate.text.trim()}\n`, "utf8");
  }
  writeJsonAtomic(path.join(run.run_dir, "candidate-meta.json"), {
    candidates: candidates.map(({ id, model, model_call_id, model_call_path, usage, prose_guard, attempts, recovered_from_invalid }) => ({
      id,
      model,
      model_call_id,
      model_call_path,
      usage,
      prose_guard,
      attempts,
      recovered_from_invalid,
    })),
  });
}

function writeReport(run, { candidates, judge, final }) {
  const lines = [
    `# Practice Run ${run.run_id}`,
    "",
    `Exercise: ${run.exercise.title}`,
    `Model: ${run.model || "(mock)"}`,
    `Winner: ${judge.winner_id}`,
    "",
    "## Judge",
    "",
    judge.rationale || "",
    "",
    "## Final",
    "",
    final.trim(),
    "",
    "## Candidates",
    "",
    ...candidates.map((candidate) => `- ${candidate.id}`),
    "",
  ];
  writeFileAtomic(path.join(run.run_dir, "REPORT.md"), lines.join("\n"), "utf8");
}

function buildCandidatePrompt(run, index) {
  return [
    `Exercise: ${run.exercise.public_prompt}`,
    run.brief ? `Brief: ${run.brief}` : "",
    "Length: 300 to 450 words.",
    `Candidate ${index}: choose a distinct situation and do not explain the exercise.`,
  ].filter(Boolean).join("\n");
}

function buildJudgePrompt(run, candidates) {
  return JSON.stringify({
    exercise: {
      id: run.exercise.id,
      title: run.exercise.title,
      public_prompt: run.exercise.public_prompt,
      hidden_test: run.exercise.hidden_test,
    },
    brief: run.brief,
    candidates: candidates.map((candidate) => ({ id: candidate.id, text: candidate.text })),
    required_shape: {
      winner_id: "candidate-001",
      scores: [{ id: "candidate-001", score: 0, pass: false, reason: "brief" }],
      rationale: "why the winner best satisfies the hidden test",
      revision_brief: "specific revision instruction for the winner",
    },
  }, null, 2);
}

function normalizeJudge(value, candidates, response = null) {
  const ids = new Set(candidates.map((candidate) => candidate.id));
  const winner = ids.has(value.winner_id) ? value.winner_id : candidates[0].id;
  const scores = Array.isArray(value.scores) ? value.scores.map((score) => ({
    id: ids.has(score.id) ? score.id : candidates[0].id,
    score: Number.isFinite(Number(score.score)) ? Number(score.score) : 0,
    pass: Boolean(score.pass),
    reason: String(score.reason ?? ""),
  })) : [];
  return {
    schema_version: "manuscript-lab.practice-judgment.v1",
    winner_id: winner,
    scores,
    rationale: String(value.rationale ?? ""),
    revision_brief: String(value.revision_brief ?? ""),
    model: response?.model ?? "",
    model_call_id: response?.model_call_id ?? null,
    model_call_path: response?.model_call_path ?? null,
    usage: response?.usage ?? null,
  };
}

function deterministicJudge(candidates) {
  return {
    schema_version: "manuscript-lab.practice-judgment.v1",
    winner_id: candidates[0].id,
    scores: candidates.map((candidate, index) => ({
      id: candidate.id,
      score: index === 0 ? 1 : 0,
      pass: index === 0,
      reason: "Deterministic mock judgment.",
    })),
    rationale: "Deterministic mock judgment selected the first candidate.",
    revision_brief: "Keep the selected candidate unchanged.",
  };
}

function candidateRecord(index, text, response = null, extra = {}) {
  return {
    id: `candidate-${String(index).padStart(3, "0")}`,
    text: text.trim(),
    model: response?.model ?? "",
    model_call_id: response?.model_call_id ?? null,
    model_call_path: response?.model_call_path ?? null,
    usage: response?.usage ?? null,
    prose_guard: extra.prose_guard ?? assessPracticeProse(text),
    attempts: extra.attempts ?? null,
    recovered_from_invalid: Boolean(extra.recovered_from_invalid),
  };
}

function directMeta(direct) {
  return {
    id: direct.id,
    model: direct.model,
    model_call_id: direct.model_call_id,
    model_call_path: direct.model_call_path,
    usage: direct.usage,
    prose_guard: direct.prose_guard ?? null,
    attempts: direct.attempts ?? null,
    recovered_from_invalid: Boolean(direct.recovered_from_invalid),
  };
}

function emitList(options) {
  const payload = { exercises: listPracticeExercises().map(({ hidden_test, ...exercise }) => exercise) };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    for (const exercise of payload.exercises) console.log(`${exercise.id}\t${exercise.title}`);
  }
}

function emitCompareResult(result, options) {
  const payload = {
    ok: result.ok,
    status: result.status,
    run_id: result.run.run_id,
    run_dir: result.run.dry_run ? "" : displayProjectPath(result.run, result.run.run_dir),
    exercise: result.run.exercise.id,
    model: result.run.model,
    judge_model: result.run.judge_model || result.run.model,
    direct: result.direct ? {
      model: result.direct.model,
      model_call_id: result.direct.model_call_id,
      model_call_path: result.direct.model_call_path,
    } : null,
    mlab: result.mlab ? {
      run_id: result.mlab.run_id,
      run_dir: result.mlab.run_dir,
      winner_id: result.mlab.winner_id,
    } : null,
    pairwise: result.pairwise,
    winner_source: result.pairwise?.winner_source ?? "",
    repair_rounds: result.repairRounds?.length ?? 0,
  };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Practice comparison ${payload.status}: ${payload.exercise}`);
    if (payload.run_dir) console.log(`Run: ${payload.run_dir}`);
    if (payload.winner_source) console.log(`Winner: ${payload.winner_source}`);
  }
}

function emitBenchResult(result, options) {
  const payload = {
    ok: result.ok,
    status: result.status,
    run_id: result.run.run_id,
    run_dir: result.run.dry_run ? "" : displayProjectPath(result.run, result.run.run_dir),
    exercise_set: result.run.exercise_set,
    exercises: result.run.exercises.map((exercise) => exercise.id),
    models: result.run.models,
    judge_model: result.run.judge_model || "",
    seeds: result.run.seeds,
    rows: result.rows,
    summary: result.summary,
  };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Practice benchmark ${payload.status}: ${payload.summary.total} run(s)`);
    if (payload.run_dir) console.log(`Run: ${payload.run_dir}`);
    console.log(`MLab wins: ${payload.summary.mlab_wins}/${payload.summary.evaluated_rows}`);
    if (payload.summary.error_rows) console.log(`Errors: ${payload.summary.error_rows}`);
    console.log(`Average score delta: ${payload.summary.average_score_delta.toFixed(2)}`);
  }
}

function emitStrategiesResult(result, options) {
  const payload = {
    ok: result.ok,
    status: result.status,
    run_id: result.run.run_id,
    run_dir: result.run.dry_run ? "" : displayProjectPath(result.run, result.run.run_dir),
    exercise_set: result.run.exercise_set,
    exercises: result.run.exercises.map((exercise) => exercise.id),
    models: result.run.models,
    judge_model: result.run.judge_model || "",
    seeds: result.run.seeds,
    strategies: result.run.strategies,
    strategy_runs: result.strategy_runs,
    rows: result.rows,
    summary: result.summary,
  };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Practice strategy comparison ${payload.status}: ${payload.summary.total} row(s)`);
    if (payload.run_dir) console.log(`Run: ${payload.run_dir}`);
    if (payload.summary.error_rows) console.log(`Errors: ${payload.summary.error_rows}`);
    for (const [strategy, item] of Object.entries(payload.summary.strategies ?? {})) {
      console.log(`${strategy}: ${item.mlab_wins}/${item.evaluated_rows} MLab wins, ${item.error_rows} error(s), delta ${item.average_score_delta.toFixed(2)}`);
    }
  }
}

function emitResult(result, options) {
  const payload = {
    ok: result.ok,
    status: result.status,
    run_id: result.run.run_id,
    run_dir: result.run.dry_run ? "" : displayProjectPath(result.run, result.run.run_dir),
    exercise: result.run.exercise.id,
    model: result.run.model,
    judge_model: result.run.judge_model || result.run.model,
    candidate_count: result.candidates.length,
    winner_id: result.judge?.winner_id ?? "",
    judge: result.judge,
    final: result.final,
  };
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Practice ${payload.status}: ${payload.exercise}`);
    if (payload.run_dir) console.log(`Run: ${payload.run_dir}`);
    if (payload.winner_id) console.log(`Winner: ${payload.winner_id}`);
  }
}

function parseArgs(args) {
  const parsed = {
    command: args[0] && !args[0].startsWith("--") ? args[0] : "help",
    exercise: "want-in-room",
    brief: "",
    model: DEFAULT_MODEL,
    judgeModel: "",
    candidates: 3,
    temperature: 0.7,
    maxTokens: 700,
    dryRun: false,
    json: false,
    help: false,
    noRevise: false,
    config: "",
    workspace: "",
    mockCandidatesFile: "",
    mockJudgeFile: "",
    mockDirectFile: "",
    mockMlabFile: "",
    mockPairwiseFile: "",
    mockFailModel: "",
    mockFailStrategy: "",
    repairRounds: 1,
    exercises: "core",
    models: "",
    seeds: 1,
    strategies: "default",
  };
  const start = parsed.command === "help" ? 0 : 1;
  for (let index = start; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--no-revise") parsed.noRevise = true;
    else if (arg === "--exercise") parsed.exercise = args[++index] ?? "";
    else if (arg.startsWith("--exercise=")) parsed.exercise = arg.slice("--exercise=".length);
    else if (arg === "--brief") parsed.brief = args[++index] ?? "";
    else if (arg.startsWith("--brief=")) parsed.brief = arg.slice("--brief=".length);
    else if (arg === "--model") parsed.model = args[++index] ?? "";
    else if (arg.startsWith("--model=")) parsed.model = arg.slice("--model=".length);
    else if (arg === "--judge-model") parsed.judgeModel = args[++index] ?? "";
    else if (arg.startsWith("--judge-model=")) parsed.judgeModel = arg.slice("--judge-model=".length);
    else if (arg === "--models") parsed.models = args[++index] ?? "";
    else if (arg.startsWith("--models=")) parsed.models = arg.slice("--models=".length);
    else if (arg === "--strategies") parsed.strategies = args[++index] ?? "";
    else if (arg.startsWith("--strategies=")) parsed.strategies = arg.slice("--strategies=".length);
    else if (arg === "--exercises") parsed.exercises = args[++index] ?? "";
    else if (arg.startsWith("--exercises=")) parsed.exercises = arg.slice("--exercises=".length);
    else if (arg === "--seeds" || arg === "--repeats") parsed.seeds = positiveInteger(args[++index], 1);
    else if (arg.startsWith("--seeds=")) parsed.seeds = positiveInteger(arg.slice("--seeds=".length), 1);
    else if (arg.startsWith("--repeats=")) parsed.seeds = positiveInteger(arg.slice("--repeats=".length), 1);
    else if (arg === "--candidates" || arg === "--n") parsed.candidates = positiveInteger(args[++index], 3);
    else if (arg.startsWith("--candidates=")) parsed.candidates = positiveInteger(arg.slice("--candidates=".length), 3);
    else if (arg.startsWith("--n=")) parsed.candidates = positiveInteger(arg.slice("--n=".length), 3);
    else if (arg === "--temperature") parsed.temperature = Number(args[++index]);
    else if (arg === "--max-tokens") parsed.maxTokens = positiveInteger(args[++index], 700);
    else if (arg === "--config") parsed.config = args[++index] ?? "";
    else if (arg === "--workspace") parsed.workspace = args[++index] ?? "";
    else if (arg === "--mock-candidates-file") parsed.mockCandidatesFile = args[++index] ?? "";
    else if (arg === "--mock-judge-file") parsed.mockJudgeFile = args[++index] ?? "";
    else if (arg === "--mock-direct-file") parsed.mockDirectFile = args[++index] ?? "";
    else if (arg === "--mock-mlab-file") parsed.mockMlabFile = args[++index] ?? "";
    else if (arg === "--mock-pairwise-file") parsed.mockPairwiseFile = args[++index] ?? "";
    else if (arg === "--mock-fail-model") parsed.mockFailModel = args[++index] ?? "";
    else if (arg.startsWith("--mock-fail-model=")) parsed.mockFailModel = arg.slice("--mock-fail-model=".length);
    else if (arg === "--mock-fail-strategy") parsed.mockFailStrategy = args[++index] ?? "";
    else if (arg.startsWith("--mock-fail-strategy=")) parsed.mockFailStrategy = arg.slice("--mock-fail-strategy=".length);
    else if (arg === "--repair-rounds") parsed.repairRounds = boundedInteger(args[++index], 1, 0, 3);
    else if (arg.startsWith("--repair-rounds=")) parsed.repairRounds = boundedInteger(arg.slice("--repair-rounds=".length), 1, 0, 3);
    else fail(`Unexpected argument: ${arg}`, parsed);
  }
  parsed.candidates = Math.max(1, Math.min(parsed.candidates, 5));
  parsed.repairRounds = Math.max(0, Math.min(parsed.repairRounds, 3));
  parsed.seeds = Math.max(1, Math.min(parsed.seeds, 20));
  if (!parsed.models) parsed.models = parsed.model;
  if (!Number.isFinite(parsed.temperature)) parsed.temperature = 0.7;
  return parsed;
}

function parseList(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function structuredProseMaxTokens(options) {
  return Math.max(options.maxTokens, 1200);
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function makeRunId() {
  return `practice-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeCompareRunId() {
  return `practice-eval-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeBenchRunId() {
  return `practice-bench-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeStrategyRunId() {
  return `practice-strategies-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
}

function displayProjectPath(run, file) {
  const rel = path.relative(run.discovery.manuscript_root, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.replace(/\\/g, "/") : file.replace(/\\/g, "/");
}

function fail(message, options = {}) {
  if (options.json) console.log(JSON.stringify({ ok: false, status: "error", error: message }, null, 2));
  else console.error(message);
  process.exit(2);
}

function printHelp() {
  console.log(`practice - generate and judge creative-writing exercise candidates

Usage:
  mlab practice list
  mlab practice propose --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
  mlab practice compare --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
  mlab practice bench --exercises core --models openrouter:z-ai/glm-5.2 --seeds 3 --json
  mlab practice strategies --exercises want-in-room,thing-unsaid --model openrouter:z-ai/glm-5.2 --json
  mlab practice propose --exercise thing-unsaid --brief "two siblings in a garage" --candidates 3

Options:
  --exercise <id>              Exercise id. Default: want-in-room.
  --exercises <set|ids>        Bench exercise set: core, expanded/all, or comma-separated ids. Default: core.
  --brief <text>               Optional situation seed.
  --model <provider:model>     Model for candidates, judging, and revision. Default: ${DEFAULT_MODEL}.
  --judge-model <provider:model> Model for candidate and pairwise judges. Default: same as --model.
  --models <list>              Bench model list, comma-separated. Defaults to --model.
  --strategies <list>          Strategy presets for practice strategies: default/all, single, select, revise, repair.
  --seeds, --repeats <count>   Bench repeats per exercise/model, 1-20. Default: 1.
  --candidates, --n <count>    Candidate count, 1-5. Default: 3.
  --repair-rounds <count>      Compare-only repair rounds when direct wins, 0-3. Default: 1.
  --no-revise                  Save the judged winner as final without a revision pass.
  --dry-run                    Show intended run without model calls or state writes.
  --mock-candidates-file <f>   JSON array of candidate prose for tests.
  --mock-judge-file <f>        JSON judge fixture for tests.
  --mock-direct-file <f>       Direct baseline prose fixture for comparison tests.
  --mock-mlab-file <f>         MLab final prose fixture for comparison tests.
  --mock-pairwise-file <f>     Pairwise judge fixture for comparison tests.
  --mock-fail-model <list>     Force comma-separated benchmark models to error in tests.
  --mock-fail-strategy <list>  Force comma-separated benchmark strategies to error in tests.
  --json                       Print machine-readable output.
  --config <path>              Explicit protocol config path.
  --workspace <path>           Explicit workspace root.
`);
}
