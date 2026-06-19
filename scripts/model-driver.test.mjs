#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildDriverToolCommand,
  listDriverTools,
  normalizeDriverDecision,
  validateDriverCatalog,
} from "./lib/driver-tool-catalog.mjs";
import { driverPolicyByName, listDriverPolicies } from "./lib/driver-policies.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-driver-"));
const cli = path.join(repoRoot, "bin", "manuscript-lab.mjs");

try {
  testCatalog();
  testHelp();
  testDriverDryRun();
  testDriverWriteAndPathFence();
  testDriverMockLoop();
  testDriverResume();
  testDriverExecuteSafeTool();
  testDriverApprovalStop();
  console.log("model-driver tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testCatalog() {
  const validation = validateDriverCatalog();
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  const ids = listDriverTools().map((tool) => tool.tool_id);
  assert(ids.includes("status.project"));
  assert(ids.includes("compose.section"));
  assert(ids.includes("practice.propose"));
  assert(ids.includes("practice.compare"));
  assert(ids.includes("practice.bench"));
  assert(ids.includes("practice.strategies"));
  assert(ids.includes("artifacts.list"));
  assert(ids.includes("artifacts.inspect"));
  assert(ids.includes("eval.practice_strategies"));
  assert(ids.includes("golden_path.guide"));
  assert(ids.includes("export.reader"));
  assert(listDriverPolicies().some((policy) => policy.name === "pi"));
  assert(driverPolicyByName("pi").trusted_rules.some((rule) => /Pi/i.test(rule)));

  const workspace = freshWorkspace("catalog");
  const discovery = discoverProtocol({ cwd: workspace });
  const paths = protocolPaths(discovery, { cwd: workspace });
  const command = buildDriverToolCommand("compose.section", { section: "draft/01-opening.md" }, { discovery, paths });
  assert.equal(command.argv.join(" "), "compose draft/01-opening.md --json");
  assert.equal(path.basename(command.wrapper), "manuscript-lab.mjs");
  const practice = buildDriverToolCommand("practice.propose", { exercise: "want-in-room", brief: "archive" }, { discovery, paths, driverModel: "openrouter:z-ai/glm-5.2" });
  assert.equal(practice.argv.join(" "), "practice propose --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json --brief archive");
  const practiceCompare = buildDriverToolCommand("practice.compare", { exercise: "want-in-room", brief: "archive" }, { discovery, paths, driverModel: "openrouter:z-ai/glm-5.2" });
  assert.equal(practiceCompare.argv.join(" "), "practice compare --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json --brief archive");
  const practiceBench = buildDriverToolCommand(
    "practice.bench",
    { exercises: "want-in-room,limited-camera", seeds: 2, candidates: 2, repair_rounds: 0 },
    { discovery, paths, driverModel: "openrouter:z-ai/glm-5.2" },
  );
  assert.equal(
    practiceBench.argv.join(" "),
    "practice bench --exercises want-in-room,limited-camera --models openrouter:z-ai/glm-5.2 --seeds 2 --candidates 2 --repair-rounds 0 --json",
  );
  const badBench = normalizeDriverDecision(
    {
      action: "run_tool",
      tool_id: "practice.bench",
      args: { exercises: "core", seeds: 99 },
    },
    { discovery, paths },
  );
  assert.equal(badBench.ok, false);
  assert.match(badBench.errors.join("\n"), /integer from 1 to 5/);
  const practiceStrategies = buildDriverToolCommand(
    "practice.strategies",
    { exercises: "Want-In-Room,Thing-Unsaid", strategies: "Single,REVISE", seeds: 1 },
    { discovery, paths, driverModel: "openrouter:z-ai/glm-5.2" },
  );
  assert.equal(
    practiceStrategies.argv.join(" "),
    "practice strategies --exercises want-in-room,thing-unsaid --models openrouter:z-ai/glm-5.2 --strategies single,revise --seeds 1 --json",
  );
  const badStrategies = normalizeDriverDecision(
    {
      action: "run_tool",
      tool_id: "practice.strategies",
      args: { strategies: "single,missing" },
    },
    { discovery, paths },
  );
  assert.equal(badStrategies.ok, false);
  assert.match(badStrategies.errors.join("\n"), /unknown practice strategy/);
  const artifacts = buildDriverToolCommand("artifacts.list", { kind: "practice-strategy", limit: 3 }, { discovery, paths });
  assert.equal(artifacts.argv.join(" "), "artifacts list --kind practice-strategy --limit 3 --json");
  const artifactInspect = buildDriverToolCommand("artifacts.inspect", { run_id: "practice-strategies-abc", kind: "practice-strategy" }, { discovery, paths });
  assert.equal(artifactInspect.argv.join(" "), "artifacts inspect --run practice-strategies-abc --kind practice-strategy --json");
  const evalStrategy = buildDriverToolCommand("eval.practice_strategies", { run_id: "practice-strategies-abc" }, { discovery, paths });
  assert.equal(evalStrategy.argv.join(" "), "eval practice-strategies --from state/practice-strategies/practice-strategies-abc --json");
  const goldenPath = buildDriverToolCommand("golden_path.guide", { target: "draft/01-opening.md" }, { discovery, paths });
  assert.equal(goldenPath.argv.join(" "), "golden-path --target draft/01-opening.md --json");
  const badArtifactKind = normalizeDriverDecision(
    {
      action: "run_tool",
      tool_id: "artifacts.list",
      args: { kind: "nope" },
    },
    { discovery, paths },
  );
  assert.equal(badArtifactKind.ok, false);
  assert.match(badArtifactKind.errors.join("\n"), /unknown artifact kind/);

  const bad = normalizeDriverDecision(
    {
      action: "run_tool",
      tool_id: "compose.section",
      args: { section: path.join(workspace, "manuscript", "draft", "01-opening.md") },
    },
    { discovery, paths },
  );
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join("\n"), /absolute paths are not allowed/);

  const traversal = normalizeDriverDecision(
    {
      action: "run_tool",
      tool_id: "compose.section",
      args: { section: "draft/../draft/01-opening.md" },
    },
    { discovery, paths },
  );
  assert.equal(traversal.ok, false);
  assert.match(traversal.errors.join("\n"), /\.\. traversal/);
}

function testHelp() {
  const help = run([cli, "drive", "--help"], { cwd: repoRoot });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /model-driver - bounded Manuscript Lab driver loop/);
  assert.match(help.stdout, /--mock-decision-file/);
}

function testDriverDryRun() {
  const workspace = freshWorkspace("dry-run");
  const result = assertJson(
    run([cli, "drive", "--goal", "prepare opening", "--target", "draft/01-opening.md", "--dry-run", "--json"], { cwd: workspace }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "dry_run");
  assert.equal(result.persisted, false);
  assert.equal(result.decision.tool_id, "compose.section");
  assert.equal(result.command.display, "mlab compose draft/01-opening.md --json");
  assert.equal(fs.existsSync(path.join(workspace, "manuscript", "state", "driver", "runs")), false);

  const badPolicy = run([cli, "drive", "--goal", "x", "--policy", "unknown", "--dry-run", "--json"], { cwd: workspace });
  assert.equal(badPolicy.status, 2);
  assert.match(JSON.parse(badPolicy.stdout).error, /Unknown --policy/);
}

function testDriverWriteAndPathFence() {
  const workspace = freshWorkspace("write");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const result = assertJson(
    run([cli, "drive", "--goal", "prepare opening", "--target", "draft/01-opening.md", "--dry-run", "--write", "--json"], { cwd: draftRoot }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "dry_run");
  assert.equal(result.persisted, true);
  assert.match(result.run_dir, /^state\/driver\/runs\/driver-/);
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "events.jsonl")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "decisions", "step-001.json")));
  assert.equal(fs.existsSync(path.join(workspace, "state")), false, "driver must not write state at workspace root");
  assert.equal(fs.existsSync(path.join(draftRoot, "state")), false, "driver must not write state under draft/");
  assert.equal(
    fs.existsSync(path.join(repoRoot, "state", "driver", "runs", path.basename(result.run_dir))),
    false,
    "driver must not write this installed-workspace run under package root",
  );

  const badDecision = path.join(workspace, "bad-decision.json");
  fs.writeFileSync(
    badDecision,
    `${JSON.stringify({
      action: "run_tool",
      tool_id: "compose.section",
      args: { section: "../outside.md" },
    })}\n`,
  );
  const bad = run([cli, "drive", "--goal", "bad path", "--dry-run", "--json", "--mock-decision-file", badDecision], { cwd: workspace });
  assert.equal(bad.status, 2);
  const parsed = JSON.parse(bad.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join("\n"), /\.\. traversal/);

  const invalidDecision = path.join(workspace, "invalid-decision.json");
  fs.writeFileSync(invalidDecision, "{not json\n");
  const invalid = run([cli, "drive", "--goal", "bad json", "--dry-run", "--json", "--mock-decision-file", invalidDecision], { cwd: workspace });
  assert.equal(invalid.status, 2);
  const invalidParsed = JSON.parse(invalid.stdout);
  assert.equal(invalidParsed.ok, false);
  assert.match(invalidParsed.errors.join("\n"), /Could not load mock decision file/);

  const badResume = run([cli, "drive", "--goal", "bad resume", "--resume", "../outside", "--dry-run", "--json"], { cwd: workspace });
  assert.equal(badResume.status, 2);
  assert.match(JSON.parse(badResume.stdout).error, /safe driver run id/);

  const missingResume = run([cli, "drive", "--goal", "resume", "--resume", "driver-existing", "--dry-run", "--json"], { cwd: workspace });
  assert.equal(missingResume.status, 2);
  assert.match(JSON.parse(missingResume.stdout).error, /No persisted driver run found/);
}

function testDriverMockLoop() {
  const workspace = freshWorkspace("loop");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const decisions = path.join(workspace, "loop-decisions.json");
  fs.writeFileSync(
    decisions,
    `${JSON.stringify([
      {
        action: "run_tool",
        tool_id: "status.project",
        args: {},
        rationale: "Observe the cockpit first.",
      },
      {
        action: "stop",
        rationale: "The status observation is enough for this run.",
        message: "Ready to hand back the next move.",
      },
    ])}\n`,
  );
  const result = assertJson(
    run([cli, "drive", "--goal", "loop once", "--mode", "operate", "--max-steps", "3", "--json", "--mock-decision-file", decisions], { cwd: workspace }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "stopped");
  assert.equal(result.persisted, true);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].tool_id, "status.project");
  assert.equal(result.steps[1].action, "stop");
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "observations", "step-002.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "decisions", "step-002.json")));
  const events = fs.readFileSync(path.join(manuscriptRoot, result.run_dir, "events.jsonl"), "utf8");
  assert.match(events, /"step":2/);

  const modelDefaultDecisions = path.join(workspace, "model-default-loop-decisions.json");
  fs.writeFileSync(
    modelDefaultDecisions,
    `${JSON.stringify([
      {
        action: "run_tool",
        tool_id: "status.project",
        args: {},
        rationale: "Inspect before deciding.",
      },
      {
        action: "stop",
        rationale: "Observation is enough.",
        message: "Ready.",
      },
    ])}\n`,
  );
  const modelDefault = assertJson(
    run([cli, "drive", "--goal", "model loop", "--model", "mock:driver", "--json", "--mock-decision-file", modelDefaultDecisions], { cwd: workspace }),
  );
  assert.equal(modelDefault.ok, true);
  assert.equal(modelDefault.status, "stopped");
  assert.equal(modelDefault.max_steps, 4);
  assert.equal(modelDefault.steps.length, 2);
  assert.equal(modelDefault.steps[0].tool_id, "status.project");
  assert.match(modelDefault.steps[0].result_summary, /drafts=/);
  assert.equal(modelDefault.steps[1].action, "stop");
}

function testDriverResume() {
  const workspace = freshWorkspace("resume");
  const manuscriptRoot = path.join(workspace, "manuscript");
  const firstDecision = path.join(workspace, "resume-first.json");
  fs.writeFileSync(
    firstDecision,
    `${JSON.stringify({
      action: "run_tool",
      tool_id: "status.project",
      args: {},
      rationale: "Capture the starting cockpit.",
    })}\n`,
  );
  const first = assertJson(
    run([cli, "drive", "--goal", "resume me", "--mode", "operate", "--max-steps", "1", "--json", "--mock-decision-file", firstDecision], { cwd: workspace }),
  );
  assert.equal(first.ok, true);
  assert.equal(first.status, "pass");
  assert.equal(first.steps.length, 1);
  const runDir = path.join(manuscriptRoot, first.run_dir);
  const firstObservation = fs.readFileSync(path.join(runDir, "observations", "step-001.json"), "utf8");

  const stopDecision = path.join(workspace, "resume-stop.json");
  fs.writeFileSync(
    stopDecision,
    `${JSON.stringify({
      action: "stop",
      rationale: "Prior state is enough.",
      message: "Stopped after resume.",
    })}\n`,
  );
  const resumed = assertJson(
    run([cli, "drive", "--resume", first.run_id, "--max-steps", "1", "--json", "--mock-decision-file", stopDecision], { cwd: workspace }),
  );
  assert.equal(resumed.ok, true);
  assert.equal(resumed.status, "stopped");
  assert.equal(resumed.run_id, first.run_id);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.step_budget, 1);
  assert.equal(resumed.max_steps, 2);
  assert.equal(resumed.steps.length, 2);
  assert.equal(resumed.steps[0].tool_id, "status.project");
  assert.equal(resumed.steps[1].step, 2);
  assert.equal(resumed.steps[1].action, "stop");
  assert.equal(fs.readFileSync(path.join(runDir, "observations", "step-001.json"), "utf8"), firstObservation);
  assert(fs.existsSync(path.join(runDir, "observations", "step-002.json")));
  assert(fs.existsSync(path.join(runDir, "decisions", "step-002.json")));
  assert(fs.existsSync(path.join(runDir, "resume.json")));
  const events = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8");
  assert.match(events, /"type":"resume"/);
  assert.match(events, /"step":2/);
  const latest = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, "state", "driver", "latest.json"), "utf8"));
  assert.equal(latest.run_id, first.run_id);
}

function testDriverExecuteSafeTool() {
  const workspace = freshWorkspace("execute");
  const manuscriptRoot = path.join(workspace, "manuscript");
  fs.writeFileSync(
    path.join(manuscriptRoot, "manuscript-lab.config.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      profile: "whitepaper",
      root: ".",
      draftGlob: "draft/*.md",
      stateDir: "inner-state",
      exportsDir: "inner-exports",
      profileOptions: { title: "Shadow Config" },
    }, null, 2)}\n`,
  );
  const decision = path.join(workspace, "compose-decision.json");
  fs.writeFileSync(
    decision,
    `${JSON.stringify({
      action: "run_tool",
      tool_id: "compose.section",
      args: { section: "draft/01-opening.md" },
      rationale: "Compose before review.",
    })}\n`,
  );
  const result = assertJson(
    run([cli, "drive", "--goal", "compose", "--mode", "operate", "--json", "--mock-decision-file", decision], { cwd: workspace }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.equal(result.persisted, true);
  assert(fs.existsSync(path.join(manuscriptRoot, "state", "runtime", "01-opening", "trace.json")));
  assert.equal(fs.existsSync(path.join(manuscriptRoot, "inner-state", "runtime", "01-opening", "trace.json")), false);
  assert(fs.existsSync(path.join(manuscriptRoot, result.run_dir, "command-results", "step-001.json")));

  fs.rmSync(path.join(manuscriptRoot, "state", "runtime"), { recursive: true, force: true });
  const noWrite = assertJson(
    run([cli, "drive", "--goal", "compose", "--mode", "advise", "--approve", "always-safe", "--no-write", "--json", "--mock-decision-file", decision], { cwd: workspace }),
  );
  assert.equal(noWrite.ok, true);
  assert.equal(noWrite.status, "needs_approval");
  assert.equal(noWrite.persisted, false);
  assert.equal(fs.existsSync(path.join(manuscriptRoot, "state", "runtime", "01-opening", "trace.json")), false);

  const reviewOnly = run([cli, "drive", "--goal", "compose", "--policy", "review-only", "--mode", "operate", "--dry-run", "--json", "--mock-decision-file", decision], { cwd: workspace });
  assert.equal(reviewOnly.status, 2);
  const reviewOnlyPayload = JSON.parse(reviewOnly.stdout);
  assert.equal(reviewOnlyPayload.ok, false);
  assert.match(reviewOnlyPayload.errors.join("\n"), /review-only does not allow/);
}

function testDriverApprovalStop() {
  const workspace = freshWorkspace("approval");
  const decision = path.join(workspace, "export-decision.json");
  fs.writeFileSync(
    decision,
    `${JSON.stringify({
      action: "run_tool",
      tool_id: "export.reader",
      args: { formats: ["md", "html"] },
      rationale: "Export reader files.",
    })}\n`,
  );
  const result = assertJson(
    run([cli, "drive", "--goal", "export", "--mode", "ci", "--json", "--mock-decision-file", decision], { cwd: workspace }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "needs_approval");
  assert.equal(result.command.display, "mlab export --formats md,html --json");

  const practiceDecision = path.join(workspace, "practice-decision.json");
  fs.writeFileSync(
    practiceDecision,
    `${JSON.stringify({
      action: "run_tool",
      tool_id: "practice.propose",
      args: { exercise: "want-in-room", brief: "a locked archive" },
      rationale: "Generate practice candidates.",
    })}\n`,
  );
  const practice = assertJson(
    run([cli, "drive", "--goal", "practice", "--model", "openrouter:z-ai/glm-5.2", "--mode", "ci", "--json", "--mock-decision-file", practiceDecision], { cwd: workspace }),
  );
  assert.equal(practice.ok, true);
  assert.equal(practice.status, "needs_approval");
  assert.equal(practice.command.display, "mlab practice propose --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json --brief \"a locked archive\"");
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
      `Driver ${name}`,
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
