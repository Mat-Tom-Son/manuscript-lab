import fs from "node:fs";
import path from "node:path";

export const GENERATED_ARTIFACT_SCHEMA = "manuscript-lab.generated-artifacts.v1";

const KIND_DEFS = [
  { key: "driver_runs", kind: "driver", root: "driver/runs", depth: 1, marker: "FINAL_REPORT.md" },
  { key: "practice_runs", kind: "practice", root: "practice", depth: 2, marker: "REPORT.md" },
  { key: "practice_evals", kind: "practice-eval", root: "practice-evals", depth: 2, marker: "REPORT.md" },
  { key: "practice_benches", kind: "practice-bench", root: "practice-bench", depth: 1, marker: "RESULTS.md" },
  { key: "practice_strategies", kind: "practice-strategy", root: "practice-strategies", depth: 1, marker: "STRATEGY_REPORT.md" },
  { key: "eval_runs", kind: "eval", root: "evals", depth: 1, marker: "EVAL_REPORT.md" },
  { key: "golden_paths", kind: "golden-path", root: "golden-path", depth: 1, marker: "GOLDEN_PATH.md" },
];
const RECOMMENDATION_SCAN_LIMIT = 50;

export function artifactKindNames() {
  return KIND_DEFS.map((def) => def.kind);
}

export function collectGeneratedArtifacts(paths, { kind = "all", limit = 5 } = {}) {
  const normalizedKind = String(kind || "all").trim().toLowerCase();
  const maxItems = clampInteger(limit, 1, 50);
  const selected = normalizedKind === "all"
    ? KIND_DEFS
    : KIND_DEFS.filter((def) => def.kind === normalizedKind || def.key === normalizedKind.replace(/-/g, "_"));
  if (!selected.length) {
    throw new Error(`Unknown artifact kind: ${kind}. Available: all, ${artifactKindNames().join(", ")}`);
  }

  const artifacts = {};
  for (const def of selected) {
    artifacts[def.key] = listArtifactsForKind(paths, def, maxItems);
  }
  for (const def of KIND_DEFS) {
    if (!(def.key in artifacts)) artifacts[def.key] = [];
  }
  const recommendationArtifacts = Object.fromEntries(
    KIND_DEFS.map((def) => [def.key, listArtifactsForKind(paths, def, RECOMMENDATION_SCAN_LIMIT)]),
  );

  return {
    schema_version: GENERATED_ARTIFACT_SCHEMA,
    generated_at: new Date().toISOString(),
    artifacts,
    recommendations: recommendFromArtifacts(recommendationArtifacts),
  };
}

export function findGeneratedArtifact(paths, { runId = "", kind = "all" } = {}) {
  const all = collectGeneratedArtifacts(paths, { kind, limit: 50 }).artifacts;
  for (const items of Object.values(all)) {
    const found = items.find((item) => item.run_id === runId || item.path === runId || item.path.endsWith(`/${runId}`));
    if (found) return found;
  }
  return null;
}

export function readArtifactJson(paths, artifact, filename, fallback = null) {
  if (!artifact?.path) return fallback;
  const file = paths.projectAbs(path.join(artifact.path, filename));
  if (!isInside(paths.projectAbs(), file) || !fs.existsSync(file)) return fallback;
  return readJson(file, fallback);
}

function listArtifactsForKind(paths, def, limit) {
  const root = paths.stateAbs(def.root);
  if (!fs.existsSync(root)) return [];
  const dirs = collectRunDirs(root, def.depth);
  return dirs
    .map((dir) => artifactFromDir(paths, def, dir))
    .filter(Boolean)
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at) || b.run_id.localeCompare(a.run_id))
    .slice(0, limit);
}

function artifactFromDir(paths, def, dir) {
  const markerFile = path.join(dir, def.marker);
  const markerExists = fs.existsSync(markerFile);
  const summaryFile = path.join(dir, "summary.json");
  const summary = readFirstJson([
    summaryFile,
    path.join(dir, "FINAL.json"),
    path.join(dir, "final.json"),
    path.join(dir, "plan.json"),
  ]);
  const input = readJson(path.join(dir, "input.json"), null);
  const metadata = summary ?? input;
  if (!markerExists && !metadata) return null;

  const modifiedAt = latestArtifactMtime(dir, [
    def.marker,
    "summary.json",
    "FINAL.json",
    "final.json",
    "plan.json",
    "input.json",
    "events.jsonl",
  ]);
  const runId = metadata?.run_id || metadata?.run?.run_id || path.basename(dir);
  const artifact = {
    kind: def.kind,
    run_id: runId,
    status: artifactStatus({ markerExists, summary, metadata }),
    path: paths.projectRel(dir),
    report: markerExists ? paths.projectRel(markerFile) : "",
    summary_file: fs.existsSync(summaryFile) ? paths.projectRel(summaryFile) : "",
    created_at: metadata?.created_at || metadata?.run?.created_at || "",
    updated_at: metadata?.updated_at || metadata?.generated_at || modifiedAt,
    modified_at: modifiedAt,
  };

  if (def.kind === "practice-strategy") addPracticeStrategyFields(artifact, summary);
  if (def.kind === "practice-bench") addPracticeBenchFields(artifact, summary);
  if (def.kind === "driver") addDriverFields(artifact, summary);
  if (def.kind === "eval") addEvalFields(artifact, summary);
  return artifact;
}

function artifactStatus({ markerExists, summary, metadata }) {
  if (!markerExists && !summary) return "in_progress";
  if (!markerExists) return summary?.status === "error" || metadata?.status === "error" ? "error" : "in_progress";
  return summary?.status
    || summary?.summary?.state
    || summary?.latest_step?.status
    || summary?.disposition
    || metadata?.status
    || (markerExists ? "pass" : "unknown");
}

function addPracticeStrategyFields(artifact, summary) {
  const strategies = summary?.strategies ?? {};
  artifact.total = Number(summary?.total ?? 0);
  artifact.evaluated_rows = Number(summary?.evaluated_rows ?? summary?.total ?? 0);
  artifact.error_rows = Number(summary?.error_rows ?? 0);
  artifact.strategies = Object.fromEntries(Object.entries(strategies).map(([id, item]) => [id, {
    total: Number(item.total ?? 0),
    evaluated_rows: Number(item.evaluated_rows ?? item.total ?? 0),
    error_rows: Number(item.error_rows ?? 0),
    error_rate: Number(item.error_rate ?? 0),
    mlab_wins: Number(item.mlab_wins ?? 0),
    mlab_win_rate: Number(item.mlab_win_rate ?? 0),
    average_score_delta: Number(item.average_score_delta ?? 0),
    cost: Number(item.known_usage?.cost ?? 0),
  }]));
  artifact.recommendations = summary?.recommendations ?? {};
  artifact.known_cost = Number(summary?.known_usage?.cost ?? 0);
}

function addPracticeBenchFields(artifact, summary) {
  artifact.total = Number(summary?.total ?? 0);
  artifact.evaluated_rows = Number(summary?.evaluated_rows ?? summary?.total ?? 0);
  artifact.error_rows = Number(summary?.error_rows ?? 0);
  artifact.mlab_win_rate = Number(summary?.mlab_win_rate ?? 0);
  artifact.average_score_delta = Number(summary?.average_score_delta ?? 0);
  artifact.known_cost = Number(summary?.known_usage?.cost ?? 0);
}

function addDriverFields(artifact, summary) {
  artifact.goal = summary?.goal || "";
  artifact.latest_step = summary?.latest_step ?? null;
  artifact.steps = Array.isArray(summary?.steps) ? summary.steps.length : 0;
}

function addEvalFields(artifact, summary) {
  artifact.subject = summary?.subject ?? "";
  artifact.disposition = summary?.disposition ?? "";
  artifact.total_rows = Number(summary?.total_rows ?? 0);
  artifact.evaluated_rows = Number(summary?.evaluated_rows ?? summary?.total_rows ?? 0);
  artifact.error_rows = Number(summary?.error_rows ?? 0);
  artifact.regressions = Number(summary?.regressions ?? 0);
  artifact.improvements = Number(summary?.improvements ?? 0);
}

function recommendFromArtifacts(artifacts) {
  const recommendations = [];
  const completedStrategies = artifacts.practice_strategies.filter((artifact) => artifact.report && artifact.status !== "in_progress");
  const latestStrategyWithRecommendation = completedStrategies.find((artifact) => artifact.recommendations && Object.keys(artifact.recommendations).length);
  if (latestStrategyWithRecommendation) {
    const [exercise, item] = Object.entries(latestStrategyWithRecommendation.recommendations)[0];
    recommendations.push({
      id: "practice-strategy-latest",
      priority: "medium",
      message: `Latest practice strategy run recommends ${item.strategy || "a strategy"} for ${exercise}.`,
      artifact: latestStrategyWithRecommendation.report || latestStrategyWithRecommendation.path,
      next_command: `mlab artifacts inspect --run ${latestStrategyWithRecommendation.run_id}`,
    });
  }
  const latestCompleteStrategy = completedStrategies[0];
  if (latestCompleteStrategy && !artifacts.eval_runs.length) {
    recommendations.push({
      id: "eval-first-strategy-run",
      priority: "medium",
      message: "Snapshot the latest practice strategy run into the eval spine so future harness changes can be compared.",
      artifact: latestCompleteStrategy.path,
      next_command: `mlab eval practice-strategies --from ${latestCompleteStrategy.path}`,
    });
  }
  return recommendations;
}

function collectRunDirs(root, depth) {
  const out = [];
  walk(root, depth, out);
  return out;
}

function walk(dir, depth, out) {
  if (depth === 0) {
    out.push(dir);
    return;
  }
  for (const entry of safeReadDir(dir)) {
    if (!entry.isDirectory()) continue;
    walk(path.join(dir, entry.name), depth - 1, out);
  }
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readFirstJson(files) {
  for (const file of files) {
    const data = readJson(file, null);
    if (data) return data;
  }
  return null;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function latestArtifactMtime(dir, files) {
  const times = [fs.statSync(dir).mtimeMs];
  for (const rel of files) {
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) times.push(fs.statSync(full).mtimeMs);
  }
  return new Date(Math.max(...times)).toISOString();
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return min;
  return Math.max(min, Math.min(max, number));
}
