#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-install-init-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;

try {
  testLocalWrapperInstallInit();
  testTemplateOnlyWrapperRoutesRefuseOutsideTemplate();
  testUnsafeInitTargets();
  testReviewRunRejectsInvalidConfig();
  testInstalledTarball();
  console.log("install init tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testLocalWrapperInstallInit() {
  const workspace = path.join(tmp, "local-wrapper");
  mkdir(workspace);

  const init = runMlab(["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "Config First", "--sections", "1", "--kind", "document.section", "--json"], { cwd: workspace });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const parsed = JSON.parse(init.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "installed");
  assert.equal(parsed.root, "manuscript");

  assertProjectScaffold(workspace);
  assertNoPackageScaffoldCopied(workspace);

  // The resolved title must reach the 00-title heading, which is what
  // status/report/export display as the visible project title.
  const titleDraft = fs.readFileSync(path.join(workspace, "manuscript/draft/00-title.md"), "utf8");
  assert.match(titleDraft, /^# Config First$/m, "init --title must land in the 00-title heading");
  assert.doesNotMatch(titleDraft, /^# Title$/m, "the placeholder heading must be replaced");
  const status = runMlab(["status"], { cwd: workspace });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.match(status.stdout, /Config First/, "status should display the resolved project title");

  assertValidateWorksFrom(workspace);
  assertValidateWorksFrom(path.join(workspace, "manuscript"));
  assertValidateWorksFrom(path.join(workspace, "manuscript", "draft"));
  assertEvidenceAndGate(workspace);
  assertSectionGatePassesAfterDraftProgress(workspace);

  const duplicate = runMlab(["init", "--profile", "whitepaper", "--root", "manuscript"], { cwd: workspace });
  assert.notEqual(duplicate.status, 0, "duplicate init should fail");
  assert.match(duplicate.stderr, /already exists|not empty/i);
}

function testUnsafeInitTargets() {
  const escaping = path.join(tmp, "escaping");
  mkdir(escaping);
  const escapeResult = runMlab(["init", "--profile", "whitepaper", "--root", "../outside"], { cwd: escaping });
  assert.notEqual(escapeResult.status, 0);
  assert.match(escapeResult.stderr, /invalid|escape|root/i);

  const absolute = path.join(tmp, "absolute");
  mkdir(absolute);
  const absoluteResult = runMlab(["init", "--profile", "whitepaper", "--root", path.join(tmp, "abs-root")], { cwd: absolute });
  assert.notEqual(absoluteResult.status, 0);
  assert.match(absoluteResult.stderr, /absolute|invalid|root/i);

  const nonEmpty = path.join(tmp, "non-empty");
  mkdir(path.join(nonEmpty, "manuscript"));
  fs.writeFileSync(path.join(nonEmpty, "manuscript", "note.md"), "owned content\n", "utf8");
  const nonEmptyResult = runMlab(["init", "--profile", "whitepaper", "--root", "manuscript"], { cwd: nonEmpty });
  assert.notEqual(nonEmptyResult.status, 0);
  assert.match(nonEmptyResult.stderr, /not empty/i);
}

function testReviewRunRejectsInvalidConfig() {
  const workspace = path.join(tmp, "invalid-review-config");
  mkdir(workspace);
  writeJsonFile(path.join(workspace, "manuscript-lab.config.json"), {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "../outside",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
  });

  const result = runMlab(["review:run", "--dry-run", "draft/01-opening.md"], { cwd: workspace });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Config root is invalid|must not escape/i);
}

function testTemplateOnlyWrapperRoutesRefuseOutsideTemplate() {
  for (const command of ["new", "project:init", "project:sync", "story:init", "story:restore"]) {
    const workspace = path.join(tmp, `template-only-${command.replace(":", "-")}`);
    mkdir(workspace);
    const result = runMlab([command, "--title", `Legacy ${command}`, "--slug", `legacy-${command.replace(":", "-")}`, "--sections", "1", "--kind", "document.section"], { cwd: workspace });
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /template-clone only/i);
    assert.match(result.stderr, /mlab init --profile/i);
    assert.equal(fs.existsSync(path.join(workspace, "manuscript-lab.config.json")), false, `${command} should not create install-anywhere config`);
    assert.equal(fs.existsSync(path.join(workspace, "projects")), false, `${command} should not create a legacy project registry`);
    assert.equal(fs.existsSync(path.join(workspace, "draft")), false, `${command} should not create a draft mount`);
  }

  const json = runMlab(["project:init", "--json"], { cwd: path.join(tmp, "local-wrapper") });
  assert.equal(json.status, 2, json.stderr || json.stdout);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.mode, "installed");
  assert.match(parsed.error, /template-clone only/i);

  const help = runMlab(["init", "--help"], { cwd: path.join(tmp, "local-wrapper") });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Bare init \(outside a template clone\)/);
  assert.match(help.stdout, /Template clone note/);
}

function testInstalledTarball() {
  const packDir = path.join(tmp, "pack");
  const workspace = path.join(tmp, "installed-package");
  mkdir(packDir);
  mkdir(workspace);

  const pack = spawnSync(npmCommand, ["pack", "--json", "--pack-destination", packDir], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const packInfo = JSON.parse(pack.stdout);
  const tarball = path.join(packDir, packInfo[0].filename);
  assert(fs.existsSync(tarball), `expected tarball at ${tarball}`);

  const npmInit = spawnSync(npmCommand, ["init", "-y"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(npmInit.status, 0, npmInit.stderr || npmInit.stdout);

  const install = spawnSync(npmCommand, ["install", "--save-dev", "--no-audit", "--no-fund", "--ignore-scripts", tarball], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);
  assertProjectLocalDependency(workspace);

  const installedRunner = (args, { cwd }) => runInstalledMlab(args, { cwd, installRoot: workspace });
  const init = installedRunner(["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "Packed Project", "--sections", "1", "--json"], { cwd: workspace });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assertProjectScaffold(workspace);
  assertNoPackageScaffoldCopied(workspace);
  assertValidateWorksFrom(workspace, installedRunner);
  assertValidateWorksFrom(path.join(workspace, "manuscript"), installedRunner);
  assertValidateWorksFrom(path.join(workspace, "manuscript", "draft"), installedRunner);
  assertEvidenceAndGate(workspace, installedRunner);
  assertEvidenceAndGate(path.join(workspace, "manuscript"), installedRunner);
  assertEvidenceAndGate(path.join(workspace, "manuscript", "draft"), installedRunner);
  assertProjectLocalNpxSmoke(workspace);
  assertInstalledCommandSurface(workspace, installedRunner);
  assertTemplateOnlyCommandsRefuseInInstalledMode(workspace, installedRunner);
  assertOneOffNpxLikeSmoke(tarball);
  assertGlobalPrefixInstall(tarball);
}

function assertProjectLocalDependency(workspace) {
  const pkg = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8"));
  assert(pkg.devDependencies?.["manuscript-lab"], "packed package should be installed as a project-local dev dependency");
}

function assertProjectLocalNpxSmoke(workspace) {
  const runner = (args, { cwd }) => runProjectLocalNpxMlab(args, { cwd });
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");

  const validate = assertJsonCommand(runner, ["validate", "--json"], { cwd: workspace });
  assert.equal(validate.ok, true);
  assert.equal(validate.mode, "installed");

  const check = assertJsonCommand(runner, ["check", "--static-only", "--json", "draft/01-opening.md"], { cwd: manuscriptRoot });
  assert.equal(check.pass, true);

  const gate = runner(["gate", "01-opening.md", "--json"], { cwd: draftRoot });
  assert.notEqual(gate.status, 0, "fresh todo section must not pass section-ready");
  const parsedGate = JSON.parse(gate.stdout);
  assert.equal(parsedGate.ready, false);
  assert.equal(parsedGate.gate_id, "section-ready");
  assert(parsedGate.requirements.some((req) => req.id === "contract.status_started" && req.status === "fail"));
}

function assertOneOffNpxLikeSmoke(tarball) {
  const workspace = path.join(tmp, "one-off-npx-like");
  mkdir(workspace);
  const runner = (args, { cwd }) => runOneOffNpxLikeMlab(args, { cwd, tarball });

  const help = runner(["help"], { cwd: workspace });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Daily loop:/);
  assert.match(help.stdout, /mlab help <command>/);

  const version = assertJsonCommand(runner, ["version", "--json"], { cwd: workspace });
  assert.equal(version.name, "manuscript-lab");
  assert.equal(version.version, packageVersion);

  const doctor = assertJsonCommand(runner, ["doctor", "--no-project", "--no-network", "--json"], { cwd: workspace });
  assert.equal(doctor.ok, true, JSON.stringify(doctor, null, 2));
  assert.equal(doctor.summary.failures, 0);

  const noProject = runner(["validate", "--json"], { cwd: workspace });
  assert.equal(noProject.status, 1, noProject.stderr || noProject.stdout);
  const missing = JSON.parse(noProject.stdout);
  assert.equal(missing.mode, "none");
  assert.match(missing.hints[0], /Run `mlab init` /, "bare `mlab init` should be the first project-free hint");
  assert(missing.hints.some((hint) => /mlab init --profile/.test(hint)));
  assert(missing.hints.some((hint) => /mlab doctor --no-project/.test(hint)));

  const init = assertJsonCommand(
    runner,
    ["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "One-Off Project", "--sections", "1", "--json"],
    { cwd: workspace },
  );
  assert.equal(init.ok, true);
  assert.equal(init.mode, "installed");
  assert.equal(fs.existsSync(path.join(workspace, "package.json")), false, "one-off smoke should not create package.json");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules")), false, "one-off smoke should not create a project-local install");

  assertProjectScaffold(workspace);
  assertNoPackageScaffoldCopied(workspace);
  assertValidateWorksFrom(workspace, runner);
  assertValidateWorksFrom(path.join(workspace, "manuscript", "draft"), runner);
}

function assertGlobalPrefixInstall(tarball) {
  const prefix = path.join(tmp, "global-prefix");
  const workspace = path.join(tmp, "global-workspace");
  mkdir(prefix);
  mkdir(workspace);

  const install = spawnSync(npmCommand, ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", "--ignore-scripts", tarball], {
    cwd: tmp,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const runner = (args, { cwd }) => runGlobalMlab(args, { cwd, prefix });

  const help = runner(["help"], { cwd: tmp });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Daily loop:/);
  assert.match(help.stdout, /mlab help <command>/);

  const version = assertJsonCommand(runner, ["version", "--json"], { cwd: tmp });
  assert.equal(version.name, "manuscript-lab");
  assert.equal(version.version, packageVersion);

  const doctor = assertJsonCommand(runner, ["doctor", "--no-project", "--no-network", "--json"], { cwd: tmp });
  assert.equal(doctor.ok, true, JSON.stringify(doctor, null, 2));
  assert.equal(doctor.summary.failures, 0);
  assert(doctor.checks.some((check) => check.id === "workspace.project" && check.status === "info"));

  const init = assertJsonCommand(
    runner,
    ["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "Global Prefix Project", "--sections", "1", "--json"],
    { cwd: workspace },
  );
  assert.equal(init.ok, true);
  assert.equal(init.mode, "installed");

  assertProjectScaffold(workspace);
  assertNoPackageScaffoldCopied(workspace);
  assertValidateWorksFrom(workspace, runner);
  assertValidateWorksFrom(path.join(workspace, "manuscript", "draft"), runner);
  assertEvidenceAndGate(path.join(workspace, "manuscript", "draft"), runner);

  const refused = runner(["project:init", "--json"], { cwd: workspace });
  assert.equal(refused.status, 2, refused.stderr || refused.stdout);
  const parsed = JSON.parse(refused.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.mode, "installed");
  assert.match(parsed.error, /template-clone only/i);
  assert.equal(fs.existsSync(path.join(workspace, "projects")), false, "global template command should not create projects/");
  assert.equal(fs.existsSync(path.join(prefix, "projects")), false, "global template command should not write under the prefix");
}

function assertProjectScaffold(workspace) {
  for (const rel of [
    "manuscript-lab.config.json",
    "manuscript/PROJECT.md",
    "manuscript/brief.md",
    "manuscript/outline.md",
    "manuscript/style.md",
    "manuscript/draft/00-title.md",
    "manuscript/draft/01-opening.md",
    "manuscript/sources/index.md",
    "manuscript/state/status.md",
    "manuscript/state/claims.md",
    "manuscript/state/chorus/README.md",
    "manuscript/state/issues/issue-ledger.json",
    "manuscript/state/room/README.md",
    "manuscript/state/truth/entities.json",
    "manuscript/taste/TASTE.md",
  ]) {
    assert(fs.existsSync(path.join(workspace, rel)), `missing ${rel}`);
  }
}

function assertNoPackageScaffoldCopied(workspace) {
  for (const rel of ["scripts", ".pi", "skills", "projects", "checks", "reviews"]) {
    assert.equal(fs.existsSync(path.join(workspace, rel)), false, `package path copied into workspace: ${rel}`);
    assert.equal(fs.existsSync(path.join(workspace, "manuscript", rel)), false, `package path copied into manuscript root: ${rel}`);
  }
}

function assertValidateWorksFrom(cwd, runner = runMlab) {
  const result = runner(["validate", "--json"], { cwd });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "installed");
  assert.equal(parsed.draft_count, 2);
}

function assertEvidenceAndGate(workspace, runner = runMlab) {
  const claims = runner(["claims", "list", "--json"], { cwd: workspace });
  assert.equal(claims.status, 0, claims.stderr || claims.stdout);
  assert.equal(JSON.parse(claims.stdout).count, 0);

  const citations = runner(["citations", "check", "--json"], { cwd: workspace });
  assert.equal(citations.status, 0, citations.stderr || citations.stdout);
  assert.equal(JSON.parse(citations.stdout).ok, true);

  const gate = runner(["gate", "draft/01-opening.md", "--json"], { cwd: workspace });
  assert.notEqual(gate.status, 0, "fresh todo section must not pass section-ready");
  const parsedGate = JSON.parse(gate.stdout);
  assert.equal(parsedGate.ready, false);
  assert.equal(parsedGate.gate_id, "section-ready");
  const started = parsedGate.requirements.find((req) => req.id === "contract.status_started");
  assert.equal(started?.status, "fail", JSON.stringify(started, null, 2));
  assert.match(started.message, /Set status: draft/);
}

function assertSectionGatePassesAfterDraftProgress(workspace, runner = runMlab) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftFile = path.join(manuscriptRoot, "draft", "01-opening.md");
  const statusFile = path.join(manuscriptRoot, "state", "status.md");

  const sentence = "The opening frames the reader problem, names the promise, and sets the evidence standard plainly.";
  const body = Array.from({ length: 22 }, () => sentence).join(" ");
  const raw = fs.readFileSync(draftFile, "utf8");
  assert.match(raw, /status: todo/);
  const updated = raw
    .replace("status: todo", "status: draft")
    .replace(/# Opening[\s\S]*$/, `# Opening\n\n${body}\n`);
  fs.writeFileSync(draftFile, updated, "utf8");

  const statusRaw = fs.readFileSync(statusFile, "utf8");
  const updatedStatus = statusRaw
    .split("\n")
    .map((line) => (line.includes("draft/01-opening.md") ? line.replace("| todo |", "| draft |") : line))
    .join("\n");
  fs.writeFileSync(statusFile, updatedStatus, "utf8");

  const compose = runner(["compose", "draft/01-opening.md", "--json"], { cwd: workspace });
  assert.equal(compose.status, 0, compose.stderr || compose.stdout);

  const gate = assertJsonCommand(runner, ["gate", "draft/01-opening.md", "--json"], { cwd: workspace });
  assert.equal(gate.ready, true, JSON.stringify(gate.requirements?.filter((req) => req.status === "fail"), null, 2));
  assert.equal(gate.gate_id, "section-ready");
  const started = gate.requirements.find((req) => req.id === "contract.status_started");
  assert.equal(started?.status, "pass");
  const floor = gate.requirements.find((req) => req.id === "words.floor");
  assert.equal(floor?.status, "pass", JSON.stringify(floor, null, 2));
  const nearTarget = gate.requirements.find((req) => req.id === "words.near_target");
  assert.equal(nearTarget?.status, "warn", "330 words should warn below 80% of target without blocking");

  assertValidateWorksFrom(workspace, runner);
}

function assertInstalledCommandSurface(workspace, runner) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const practiceCandidates = path.join(workspace, "practice-candidates.json");
  fs.writeFileSync(practiceCandidates, `${JSON.stringify([
    "Jules entered the studio and touched only the frames turned toward the wall.",
    "Jules wanted the hidden painting and looked for it in the studio.",
  ])}\n`);
  const practiceDirect = path.join(workspace, "practice-direct.md");
  const practiceMlab = path.join(workspace, "practice-mlab.md");
  fs.writeFileSync(practiceDirect, "Jules wanted the hidden painting and searched the studio.\n");
  fs.writeFileSync(practiceMlab, "Jules entered the studio and touched only the frames turned toward the wall.\n");
  const cwdCases = [workspace, manuscriptRoot, draftRoot];

  for (const [index, cwd] of cwdCases.entries()) {
    const status = assertJsonCommand(runner, ["status", "--json"], { cwd });
    assert.equal(status.mode, "installed");
    assert.equal(fs.realpathSync(status.manuscript_root), fs.realpathSync(manuscriptRoot));
    assert.equal(status.drafts.length, 2);

    const compose = assertJsonCommand(runner, ["compose", "draft/01-opening.md", "--json"], { cwd });
    assert.equal(compose.section, "draft/01-opening.md");
    assert.equal(compose.runtime_dir, "state/runtime/01-opening");
    assert(compose.visible_file_count > 1, "compose should include project context files");

    const check = assertJsonCommand(runner, ["check", "--static-only", "--json", "draft/01-opening.md"], { cwd });
    assert.equal(check.pass, true);

    const drive = assertJsonCommand(
      runner,
      ["drive", "--goal", "prepare opening", "--target", "draft/01-opening.md", "--dry-run", "--write", "--json"],
      { cwd },
    );
    assert.equal(drive.ok, true);
    assert.equal(drive.status, "dry_run");
    assert.equal(drive.persisted, true);
    assert.equal(drive.decision.tool_id, "compose.section");
    assert.match(drive.run_dir, /^state\/driver\/runs\/driver-/);
    assert(fs.existsSync(path.join(manuscriptRoot, drive.run_dir, "events.jsonl")));
    assert(fs.existsSync(path.join(manuscriptRoot, drive.run_dir, "decisions", "step-001.json")));

    const practice = assertJsonCommand(
      runner,
      ["practice", "propose", "--exercise", "want-in-room", "--mock-candidates-file", practiceCandidates, "--json"],
      { cwd },
    );
    assert.equal(practice.ok, true);
    assert.equal(practice.status, "pass");
    assert.match(practice.run_dir, /^state\/practice\/want-in-room\/practice-/);
    assert(fs.existsSync(path.join(manuscriptRoot, practice.run_dir, "final.md")));
    assert.equal(fs.existsSync(path.join(workspace, "state", "practice")), false, "practice must not write state at workspace root");
    assert.equal(fs.existsSync(path.join(draftRoot, "state", "practice")), false, "practice must not write state under draft/");

    const practiceCompare = assertJsonCommand(
      runner,
      ["practice", "compare", "--exercise", "want-in-room", "--mock-direct-file", practiceDirect, "--mock-mlab-file", practiceMlab, "--json"],
      { cwd },
    );
    assert.equal(practiceCompare.ok, true);
    assert.equal(practiceCompare.status, "pass");
    assert.equal(practiceCompare.winner_source, "mlab");
    assert.match(practiceCompare.run_dir, /^state\/practice-evals\/want-in-room\/practice-eval-/);
    assert(fs.existsSync(path.join(manuscriptRoot, practiceCompare.run_dir, "pairwise-judgment.json")));
    assert.equal(fs.existsSync(path.join(workspace, "state", "practice-evals")), false, "practice compare must not write state at workspace root");
    assert.equal(fs.existsSync(path.join(draftRoot, "state", "practice-evals")), false, "practice compare must not write state under draft/");

    const practiceBench = assertJsonCommand(
      runner,
      [
        "practice",
        "bench",
        "--exercises",
        "want-in-room,thing-unsaid",
        "--models",
        "mock:installed",
        "--mock-direct-file",
        practiceDirect,
        "--mock-mlab-file",
        practiceMlab,
        "--json",
      ],
      { cwd },
    );
    assert.equal(practiceBench.ok, true);
    assert.equal(practiceBench.status, "pass");
    assert.equal(practiceBench.summary.total, 2);
    assert.equal(practiceBench.summary.mlab_wins, 2);
    assert.match(practiceBench.run_dir, /^state\/practice-bench\/practice-bench-/);
    assert(fs.existsSync(path.join(manuscriptRoot, practiceBench.run_dir, "summary.json")));
    assert.equal(fs.existsSync(path.join(workspace, "state", "practice-bench")), false, "practice bench must not write state at workspace root");
    assert.equal(fs.existsSync(path.join(draftRoot, "state", "practice-bench")), false, "practice bench must not write state under draft/");

    const practiceStrategies = assertJsonCommand(
      runner,
      [
        "practice",
        "strategies",
        "--exercises",
        "want-in-room",
        "--models",
        "mock:installed",
        "--strategies",
        "single,revise",
        "--mock-direct-file",
        practiceDirect,
        "--mock-mlab-file",
        practiceMlab,
        "--json",
      ],
      { cwd },
    );
    assert.equal(practiceStrategies.ok, true);
    assert.equal(practiceStrategies.status, "pass");
    assert.equal(practiceStrategies.summary.total, 2);
    assert.equal(practiceStrategies.summary.strategies.single.mlab_wins, 1);
    assert.equal(practiceStrategies.summary.strategies.revise.mlab_wins, 1);
    assert.match(practiceStrategies.run_dir, /^state\/practice-strategies\/practice-strategies-/);
    assert(fs.existsSync(path.join(manuscriptRoot, practiceStrategies.run_dir, "summary.json")));
    assert(fs.existsSync(path.join(manuscriptRoot, practiceStrategies.run_dir, "STRATEGY_REPORT.md")));
    assert.equal(fs.existsSync(path.join(workspace, "state", "practice-strategies")), false, "practice strategies must not write state at workspace root");
    assert.equal(fs.existsSync(path.join(draftRoot, "state", "practice-strategies")), false, "practice strategies must not write state under draft/");

    const artifactList = assertJsonCommand(runner, ["artifacts", "list", "--kind", "practice-strategy", "--json"], { cwd });
    assert.equal(artifactList.ok, true);
    assert.equal(artifactList.schema_version, "manuscript-lab.artifacts.v1");
    assert(artifactList.artifacts.practice_strategies.some((item) => item.path === practiceStrategies.run_dir));

    const strategyRunId = path.basename(practiceStrategies.run_dir);
    const artifactInspect = assertJsonCommand(runner, ["artifacts", "inspect", "--run", strategyRunId, "--kind", "practice-strategy", "--json"], { cwd });
    assert.equal(artifactInspect.ok, true);
    assert.equal(artifactInspect.artifact.run_id, strategyRunId);
    assert.equal(artifactInspect.summary.total, 2);

    const evalSnapshot = assertJsonCommand(runner, ["eval", "practice-strategies", "--from", practiceStrategies.run_dir, "--json"], { cwd });
    assert.equal(evalSnapshot.ok, true);
    assert.equal(evalSnapshot.status, "pass");
    assert.match(evalSnapshot.run_dir, /^state\/evals\/eval-/);
    assert(fs.existsSync(path.join(manuscriptRoot, evalSnapshot.run_dir, "summary.json")));
    assert(fs.existsSync(path.join(manuscriptRoot, evalSnapshot.run_dir, "EVAL_REPORT.md")));
    assert.equal(fs.existsSync(path.join(workspace, "state", "evals")), false, "evals must not write state at workspace root");
    assert.equal(fs.existsSync(path.join(draftRoot, "state", "evals")), false, "evals must not write state under draft/");

    const goldenPath = assertJsonCommand(runner, ["golden-path", "--write", "--json"], { cwd });
    assert.equal(goldenPath.ok, true);
    assert.equal(goldenPath.status, "pass");
    assert.match(goldenPath.run_dir, /^state\/golden-path\/golden-path-/);
    assert(fs.existsSync(path.join(manuscriptRoot, goldenPath.report)));
    assert.equal(fs.existsSync(path.join(workspace, "state", "golden-path")), false, "golden path must not write state at workspace root");
    assert.equal(fs.existsSync(path.join(draftRoot, "state", "golden-path")), false, "golden path must not write state under draft/");

    const report = assertJsonCommand(runner, ["review:report", "--json"], { cwd });
    assert.equal(report.totals.runs, 0);

    const chorusRunId = `packed-chorus-${index + 1}`;
    const chorusTarget = cwd === draftRoot ? "01-opening.md" : "draft/01-opening.md";
    const chorus = assertJsonCommand(runner, ["chorus", "run", chorusTarget, "--run-id", chorusRunId, "--beats", "2", "--json"], { cwd });
    assert.equal(chorus.ok, true);
    assert.equal(chorus.target, "draft/01-opening.md");
    assert.equal(chorus.run_dir, `state/chorus/01-opening/${chorusRunId}`);
    assert.equal(chorus.beat_count, 2);
    assert.equal(chorus.candidate_count, 2);
    assert.equal(chorus.committed_beat_count, 0);
    assert.equal(chorus.contact_sheet_file, `state/chorus/01-opening/${chorusRunId}/CONTACT_SHEET.md`);
    assert(fs.existsSync(path.join(manuscriptRoot, chorus.run_dir, "manifest.json")));
    assert(fs.existsSync(path.join(manuscriptRoot, chorus.run_dir, "voice-pack.json")));
    assert(fs.existsSync(path.join(manuscriptRoot, chorus.run_dir, "plan-quality.json")));
    assert(fs.existsSync(path.join(manuscriptRoot, chorus.run_dir, "CONTACT_SHEET.md")));
    assert.equal(fs.existsSync(path.join(manuscriptRoot, chorus.run_dir, "assembled.md")), false);

    const diagnosisRunId = `packed-diagnose-${index + 1}`;
    const diagnosis = assertJsonCommand(runner, ["room", "diagnose", chorusTarget, "--run-id", diagnosisRunId, "--json"], { cwd });
    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.target, "draft/01-opening.md");
    assert.equal(diagnosis.run_dir, `state/room/01-opening/${diagnosisRunId}`);
    assert(diagnosis.grade);
    assert(fs.existsSync(path.join(manuscriptRoot, diagnosis.files.json)));
    assert(fs.existsSync(path.join(manuscriptRoot, diagnosis.files.markdown)));

    const roomRunId = `packed-room-${index + 1}`;
    const roomTarget = cwd === draftRoot ? "01-opening.md" : "draft/01-opening.md";
    const room = assertJsonCommand(runner, ["room", "blue-sky", roomTarget, "--run-id", roomRunId, "--json"], { cwd });
    assert.equal(room.ok, true);
    assert.equal(room.target, "draft/01-opening.md");
    assert.equal(room.run_dir, `state/room/01-opening/${roomRunId}`);
    assert(fs.existsSync(path.join(manuscriptRoot, room.run_dir, "room-packet.json")));
    assert(fs.existsSync(path.join(manuscriptRoot, room.run_dir, "manifest.json")));

    const breakBeforeDecision = runner(["room", "break", roomTarget, "--run", roomRunId, "--json"], { cwd });
    assert.equal(breakBeforeDecision.status, 1, breakBeforeDecision.stderr || breakBeforeDecision.stdout);
    assert.match(breakBeforeDecision.stdout, /requires selected idea cards/);

    const decision = assertJsonCommand(
      runner,
      ["room", "decide", roomTarget, "--run", roomRunId, "--select", "idea-001", "--reason", "Installed room smoke.", "--json"],
      { cwd },
    );
    assert.deepEqual(decision.selected, ["idea-001"]);

    const beatBoard = assertJsonCommand(runner, ["room", "break", roomTarget, "--run", roomRunId, "--json"], { cwd });
    assert.equal(beatBoard.beat_count, 1);
    assert(fs.existsSync(path.join(manuscriptRoot, room.run_dir, "output", "beat-board.json")));
    const beatBoardJson = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, room.run_dir, "output", "beat-board.json"), "utf8"));
    assert(beatBoardJson.beats[0].causal_link);
    assert(beatBoardJson.beats[0].choice);
    assert(beatBoardJson.beats[0].consequence);
    assert(beatBoardJson.beats[0].turn);

    const tableRead = assertJsonCommand(runner, ["room", "table-read", roomTarget, "--run-id", `packed-table-read-${index + 1}`, "--json"], { cwd });
    assert.equal(tableRead.review_command, "mlab review:run --passes room.table_read draft/01-opening.md");
    assert(fs.existsSync(path.join(manuscriptRoot, tableRead.files.checklist)));

    const statusAfterLabs = assertJsonCommand(runner, ["status", "--json"], { cwd });
    const roomStatusRun = statusAfterLabs.room_runs.find((run) => run.run_id === roomRunId);
    assert(roomStatusRun, `status should include room run ${roomRunId}`);
    assert.equal(roomStatusRun.kind, "room");
    assert.equal(roomStatusRun.operation, "blue_sky");
    assert.equal(roomStatusRun.target, "draft/01-opening.md");
    assert.equal(roomStatusRun.files.manifest, `state/room/01-opening/${roomRunId}/manifest.json`);
    assert.equal(roomStatusRun.files.beat_board_json, `state/room/01-opening/${roomRunId}/output/beat-board.json`);

    const tableReadStatusRun = statusAfterLabs.room_runs.find((run) => run.run_id === `packed-table-read-${index + 1}`);
    assert(tableReadStatusRun, "status should include table-read room run");
    assert.equal(tableReadStatusRun.operation, "table_read");
    assert.equal(tableReadStatusRun.files.checklist, `state/room/01-opening/packed-table-read-${index + 1}/output/table-read-checklist.md`);

    const diagnosisStatusRun = statusAfterLabs.room_runs.find((run) => run.run_id === diagnosisRunId);
    assert(diagnosisStatusRun, `status should include room diagnosis ${diagnosisRunId}`);
    assert.equal(diagnosisStatusRun.operation, "diagnose");
    assert.equal(diagnosisStatusRun.files.diagnosis_md, `state/room/01-opening/${diagnosisRunId}/output/STORY_DIAGNOSIS.md`);
    assert.equal(diagnosisStatusRun.files.diagnosis_json, `state/room/01-opening/${diagnosisRunId}/output/story-diagnosis.json`);

    const chorusStatusRun = statusAfterLabs.chorus_runs.find((run) => run.run_id === chorusRunId);
    assert(chorusStatusRun, `status should include chorus run ${chorusRunId}`);
    assert.equal(chorusStatusRun.kind, "chorus");
    assert.equal(chorusStatusRun.operation, "chorus");
    assert.equal(chorusStatusRun.target, "draft/01-opening.md");
    assert.equal(chorusStatusRun.files.report, `state/chorus/01-opening/${chorusRunId}/CHORUS_REPORT.md`);
    assert.equal(chorusStatusRun.files.contact_sheet, `state/chorus/01-opening/${chorusRunId}/CONTACT_SHEET.md`);
    assert.equal(chorusStatusRun.files.plan_quality, `state/chorus/01-opening/${chorusRunId}/plan-quality.json`);
    assert.equal(chorusStatusRun.files.assembled, undefined);

    const projectReport = assertJsonCommand(runner, ["report", "--json"], { cwd });
    assert.equal(projectReport.schema_version, "manuscript-lab.report.v1");
    assert.equal(fs.realpathSync(projectReport.project.manuscript_root), fs.realpathSync(manuscriptRoot));
    assert.equal(projectReport.summary.sections.total, 2);
    // Every scaffolded section is still todo, so the pristine workspace must
    // not report ready: the manuscript gate blocks on sections.any_started.
    assert.equal(projectReport.ok, false, "pristine all-todo workspace must not report ready");
    assert.equal(projectReport.summary.state, "not_ready");
    assert(
      projectReport.blockers.some((item) => item.type === "sections.any_started"),
      `expected a sections.any_started blocker, found: ${projectReport.blockers.map((item) => item.type).join(", ")}`,
    );
    assert(projectReport.summary.room_runs >= 2, "report should count room runs");
    assert(projectReport.summary.chorus_runs >= 1, "report should count chorus runs");
    assert(projectReport.summary.room_runs_by_operation.blue_sky >= 1, "report should group room operations");
    assert(projectReport.summary.room_runs_by_operation.diagnose >= 1, "report should group room diagnoses");
    assert(projectReport.summary.room_runs_by_operation.table_read >= 1, "report should group table-read operations");
    assert(projectReport.summary.chorus_runs_by_status.sampled >= 1, "report should group chorus statuses");
    assert(projectReport.room_runs.some((run) => run.run_id === diagnosisRunId && run.files.diagnosis_md));
    assert(projectReport.room_runs.some((run) => run.run_id === roomRunId && run.files.beat_board_md));
    assert(projectReport.chorus_runs.some((run) => run.run_id === chorusRunId && run.files.contact_sheet));

    const projectReportHtml = runner(["report", "--html"], { cwd });
    assert.equal(projectReportHtml.status, 0, projectReportHtml.stderr || projectReportHtml.stdout);
    assert.match(projectReportHtml.stdout, /Creative Labs/);
    assert.match(projectReportHtml.stdout, new RegExp(roomRunId));
    assert.match(projectReportHtml.stdout, new RegExp(chorusRunId));
    assert.match(projectReportHtml.stdout, /blue_sky/);
    assert.match(projectReportHtml.stdout, /state\/chorus\/01-opening\/packed-chorus-/);

    // done inherits the manuscript gate, so the pristine all-todo workspace
    // fails with the sections.any_started blocker instead of a false green.
    const doneResult = runner(["done:no-export", "--json"], { cwd });
    assert.equal(doneResult.status, 1, doneResult.stderr || doneResult.stdout);
    const done = JSON.parse(doneResult.stdout);
    assert.equal(done.pass, false, JSON.stringify(done, null, 2));
    assert(
      done.errors.some((error) => error.includes("manuscript-ready/sections.any_started")),
      JSON.stringify(done.errors, null, 2),
    );
    assert.equal(done.checks.project_sync, "skipped");
    assert.equal(done.checks.project_filesystem, "skipped");

    const doneSlug = `packed-done-${index + 1}`;
    const doneWithExportsResult = runner(
      ["done", "--export-formats=md,html", "--include-todo-exports", "--no-contents", `--export-slug=${doneSlug}`, "--json"],
      { cwd },
    );
    assert.equal(doneWithExportsResult.status, 1, doneWithExportsResult.stderr || doneWithExportsResult.stdout);
    const doneWithExports = JSON.parse(doneWithExportsResult.stdout);
    assert.equal(doneWithExports.pass, false, JSON.stringify(doneWithExports, null, 2));
    assert(
      doneWithExports.errors.some((error) => error.includes("manuscript-ready/sections.any_started")),
      JSON.stringify(doneWithExports.errors, null, 2),
    );
    assert.deepEqual(doneWithExports.export_formats, ["md", "html"]);
    assert.equal(doneWithExports.checks.exports, false, "export gate must not pass while no section is started");
    assert.equal(doneWithExports.checks.project_sync, "skipped");
    assert.equal(doneWithExports.checks.project_filesystem, "skipped");
    assert(fs.existsSync(path.join(manuscriptRoot, "exports", `${doneSlug}.md`)));
    assert(fs.existsSync(path.join(manuscriptRoot, "exports", `${doneSlug}.html`)));
    const doneManifest = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, "exports", "manifest.json"), "utf8"));
    assert.deepEqual(doneManifest.output_summary.formats.sort(), ["html", "md"]);
    assert.equal(doneManifest.options.include_todo, true);
    assert.equal(doneManifest.options.include_contents, false);
  }

  const nestedCompose = assertJsonCommand(runner, ["compose", "01-opening.md", "--json"], { cwd: draftRoot });
  assert.equal(nestedCompose.section, "draft/01-opening.md");

  assertInstalledReviewRun(workspace, runner);
  assertInstalledProjectReviewRegistration(workspace, runner);
  assertInstalledCandidatePreview(workspace, runner);

  const exported = assertJsonCommand(runner, ["export", "--formats", "md,html", "--include-todo", "--slug", "packed", "--json"], { cwd: workspace });
  assert.equal(exported.chapters, 1);
  assert.deepEqual(
    exported.outputs.map((output) => output.file).sort(),
    ["exports/packed.html", "exports/packed.md"],
  );
  assert.equal(exported.manifest.file, "exports/manifest.json");
  assert.equal(exported.manifest.schema_version, "manuscript-lab.export-manifest.v1");
  assert(fs.existsSync(path.join(manuscriptRoot, "exports", "packed.md")));
  assert(fs.existsSync(path.join(manuscriptRoot, "exports", "packed.html")));
  const exportManifestFile = path.join(manuscriptRoot, "exports", "manifest.json");
  assert(fs.existsSync(exportManifestFile));
  const exportManifest = JSON.parse(fs.readFileSync(exportManifestFile, "utf8"));
  assert.equal(exportManifest.schema_version, "manuscript-lab.export-manifest.v1");
  assert("source_dirty" in exportManifest);
  assert.deepEqual(exportManifest.output_summary.formats.sort(), ["html", "md"]);
  assert.equal(exportManifest.options.include_contents, true);
  assert.equal(exportManifest.outputs.length, 2);
  for (const output of exportManifest.outputs) {
    assert.equal(typeof output.sha256, "string");
    assert.equal(output.sha256.length, 64);
    assert(output.size > 0);
  }
  const defaultMarkdown = fs.readFileSync(path.join(manuscriptRoot, "exports", "packed.md"), "utf8");
  assert.match(defaultMarkdown, /^## Contents$/m);

  const noContents = assertJsonCommand(runner, ["export", "--formats", "md,html", "--include-todo", "--slug", "packed-no-contents", "--no-contents", "--json"], { cwd: workspace });
  assert.equal(noContents.chapters, 1);
  const noContentsMarkdown = fs.readFileSync(path.join(manuscriptRoot, "exports", "packed-no-contents.md"), "utf8");
  const noContentsHtml = fs.readFileSync(path.join(manuscriptRoot, "exports", "packed-no-contents.html"), "utf8");
  assert.doesNotMatch(noContentsMarkdown, /^## Contents$/m);
  assert.doesNotMatch(noContentsHtml, /<nav class="toc"/);
  const noContentsManifest = JSON.parse(fs.readFileSync(exportManifestFile, "utf8"));
  assert.equal(noContentsManifest.options.include_contents, false);

  const writtenReport = assertJsonCommand(runner, ["report", "--write", "--json"], { cwd: workspace });
  assert.equal(writtenReport.artifacts.json, "reports/latest.json");
  assert.equal(writtenReport.artifacts.html, "reports/latest.html");
  assert.equal(writtenReport.export_manifest.file, "exports/manifest.json");
  assert(writtenReport.summary.room_runs >= 6, "written report should include room and table-read runs from all cwd cases");
  assert(writtenReport.summary.chorus_runs >= 3, "written report should include chorus runs from all cwd cases");
  assert(fs.existsSync(path.join(manuscriptRoot, "reports", "latest.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, "reports", "latest.html")));
  const writtenHtml = fs.readFileSync(path.join(manuscriptRoot, "reports", "latest.html"), "utf8");
  assert.match(writtenHtml, /Creative Labs/);
  assert.match(writtenHtml, /packed-room-1/);
  assert.match(writtenHtml, /packed-chorus-1/);
  assert(fs.existsSync(path.join(manuscriptRoot, "state", "runtime", "01-opening", "context.json")));
  assert.equal(fs.existsSync(path.join(workspace, "state")), false, "commands should not write state at workspace root");
  assert.equal(fs.existsSync(path.join(workspace, "reports")), false, "commands should not write reports at workspace root");
  assert.equal(fs.existsSync(path.join(workspace, "exports")), false, "commands should not write exports at workspace root");
  assert.equal(fs.existsSync(path.join(draftRoot, "state")), false, "commands should not write state under draft/");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", "state")), false, "commands should not write state under the package");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", "reports")), false, "commands should not write reports under the package");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", "exports")), false, "commands should not write exports under the package");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", ".doccheck")), false, "doccheck cache should not write under the package");
}

function assertTemplateOnlyCommandsRefuseInInstalledMode(workspace, runner) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const cwdCases = [workspace, manuscriptRoot, draftRoot];
  const commands = ["new", "project", "project:init", "project:list", "project:sync", "story", "story:init", "story:restore", "story:unload"];

  for (const cwd of cwdCases) {
    for (const command of commands) {
      const result = runner([command, "--json"], { cwd });
      assert.equal(result.status, 2, `${command} should refuse in installed mode from ${cwd}: ${result.stderr || result.stdout}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.mode, "installed");
      assert.match(parsed.error, /template-clone only/i);
      assert.match(parsed.hint, /mlab init --profile/i);
    }

    const init = runner(["init", "--json"], { cwd });
    assert.equal(init.status, 2, `bare init should refuse inside an existing workspace from ${cwd}: ${init.stderr || init.stdout}`);
    const initParsed = JSON.parse(init.stdout);
    assert.equal(initParsed.ok, false);
    assert(
      initParsed.errors.some((error) => /already exists|Already inside a Manuscript Lab workspace/i.test(error)),
      JSON.stringify(initParsed, null, 2),
    );
  }

  assert.equal(fs.existsSync(path.join(workspace, "projects")), false, "template commands should not create projects/ in installed workspace");
  assert.equal(fs.existsSync(path.join(manuscriptRoot, "projects")), false, "template commands should not create projects/ under manuscript root");
  assert.equal(fs.existsSync(path.join(draftRoot, "projects")), false, "template commands should not create projects/ under draft/");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", "projects")), false, "template commands should not create projects/ under the package");
}

function assertInstalledReviewRun(workspace, runner) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const mockResponseRel = "state/reviews/mock-contract-editor-response.json";
  const mockResponseFile = path.join(manuscriptRoot, mockResponseRel);

  for (const cwd of [workspace, manuscriptRoot, draftRoot]) {
    const target = cwd === draftRoot ? "01-opening.md" : "draft/01-opening.md";
    const review = assertJsonCommand(
      runner,
      ["review:run", "--dry-run", "--passes", "contract.editor", "--panel", "prose.clean", "--force", "--json", target],
      { cwd },
    );

    assert.equal(review.target, "draft/01-opening.md");
    assert.equal(review.section_id, "01-opening");
    assert(review.jobs.length >= 1);
    assert(review.jobs.every((job) => job.pass === "contract.editor"));
    assert(review.jobs.every((job) => job.context_pack === "informed.editor"));
    assert(review.jobs.every((job) => job.visible_files.some((file) => file.path === "draft/01-opening.md")));

    const sceneTurn = assertJsonCommand(
      runner,
      ["review:run", "--dry-run", "--passes", "scene.turn", "--panel", "prose.clean", "--force", "--json", target],
      { cwd },
    );
    assert.equal(sceneTurn.target, "draft/01-opening.md");
    assert(sceneTurn.jobs.every((job) => job.pass === "scene.turn"));
    assert(sceneTurn.jobs.every((job) => job.context_pack === "blind.section_only"));
  }

  writeJsonFile(mockResponseFile, {
    pass: "contract.editor",
    section: "draft/01-opening.md",
    summary: "Mock installed review response.",
    issues: [
      {
        category: "structure",
        severity: "minor",
        confidence: 0.91,
        target_quote: "Use this section for the first owned draft once the brief, outline, style guide,\nand source index are ready.",
        claim: "The scaffold still reads like setup instructions rather than owned prose.",
        evidence: "The sentence directly tells the writer how to use the section.",
        reader_effect: "A reviewer can tell the draft has not yet been replaced with manuscript content.",
        recommended_action: "Replace the scaffold instruction with project-specific prose.",
      },
    ],
    strengths: [],
  });

  const run = parseJsonFromMixedOutput(
    runner(
      [
        "review:run",
        "01-opening.md",
        "--passes",
        "contract.editor",
        "--models",
        "openrouter:openai/gpt-4.1-mini",
        "--force",
        "--mock-response",
        mockResponseRel,
        "--json",
      ],
      { cwd: draftRoot },
    ),
  );
  assert.equal(run.target, "draft/01-opening.md");
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].imported_issue_ids.length, 1);
  assert(fs.existsSync(path.join(manuscriptRoot, run.results[0].file)));
  assert(fs.existsSync(path.join(manuscriptRoot, "state", "issues", "issue-ledger.json")));
  const ledger = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, "state", "issues", "issue-ledger.json"), "utf8"));
  assert(ledger.issues.some((issue) => issue.source?.type === "model_review" && issue.source?.run_file === run.results[0].file));
  assert.equal(fs.existsSync(path.join(draftRoot, "state")), false, "review runs should not write state under draft/");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", "state")), false, "review runs should not write state under the package");
}

function assertInstalledProjectReviewRegistration(workspace, runner) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const targetFile = path.join(draftRoot, "01-opening.md");
  const configFile = path.join(workspace, "manuscript-lab.config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.reviews = { ...(config.reviews ?? {}), suite: "reviews/suite.json" };
  writeJsonFile(configFile, config);

  writeJsonFile(path.join(manuscriptRoot, "reviews/suite.json"), {
    version: 1,
    context_packs: {
      "local.anti_tidiness": {
        description: "Expose the style guide and target section.",
        include: ["style.md", "draft/{section}"],
        exclude: ["state/", "taste/"],
      },
    },
    passes: [
      {
        id: "loose.thread",
        label: "Loose Thread",
        stage: ["todo", "draft", "review", "revision", "polish"],
        applies_to: ["*"],
        context_pack: "local.anti_tidiness",
        models: ["openai/gpt-4.1-mini"],
        prompt: "reviews/prompts/loose-thread.md",
        blocking: false,
        min_confidence: 0.5,
        max_issues: 6,
      },
    ],
  });
  writeText(
    path.join(manuscriptRoot, "reviews/prompts/loose-thread.md"),
    "# Loose Thread\n\nReport only places where tidying erased useful friction or implication.\n",
  );

  const targetText = fs.readFileSync(targetFile, "utf8");
  const updatedTarget = targetText.replace(
    /reviews:[ \t]*\n(?:[ \t]+-[ \t]*[A-Za-z0-9_.:-]+[ \t]*\n)*/,
    "reviews:\n  - contract.editor\n  - loose.thread\n",
  );
  assert.notEqual(updatedTarget, targetText);
  writeText(targetFile, updatedTarget);

  const validate = assertJsonCommand(runner, ["validate", "--json"], { cwd: draftRoot });
  assert.equal(validate.ok, true);

  const list = assertJsonCommand(runner, ["review", "list", "--json"], { cwd: workspace });
  const localPass = list.passes.find((pass) => pass.id === "loose.thread");
  assert.equal(localPass?.origin, "project");

  const dryRun = assertJsonCommand(
    runner,
    ["review", "01-opening.md", "--passes", "loose.thread", "--force", "--dry-run", "--json"],
    { cwd: draftRoot },
  );
  assert.equal(dryRun.jobs.length, 1);
  assert.equal(dryRun.jobs[0].origin, "project");
  assert(dryRun.jobs[0].visible_files.some((file) => file.path === "style.md"));

  const quote = "Use this section for the first owned draft once the brief, outline, style guide,\nand source index are ready.";
  const mockResponseRel = "state/reviews/mock-loose-thread-response.json";
  writeJsonFile(path.join(manuscriptRoot, mockResponseRel), {
    pass: "loose.thread",
    section: "draft/01-opening.md",
    summary: "Mock project-local review response.",
    issues: [
      {
        category: "style",
        severity: "minor",
        confidence: 0.92,
        target_quote: quote,
        claim: "The setup sentence over-explains the section's job.",
        evidence: "Its instruction-like framing removes implication before the draft begins.",
        reader_effect: "The opening feels administratively tidy instead of alive.",
        recommended_action: "Replace the instruction with prose that leaves useful pressure unresolved.",
      },
    ],
    strengths: [],
  });

  const run = parseJsonFromMixedOutput(
    runner(
      [
        "review",
        "01-opening.md",
        "--passes",
        "loose.thread",
        "--force",
        "--mock-response",
        mockResponseRel,
        "--json",
      ],
      { cwd: draftRoot },
    ),
  );
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].pass, "loose.thread");
  assert.equal(run.results[0].imported_issue_ids.length, 1);
  const runRecord = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, run.results[0].file), "utf8"));
  assert.equal(runRecord.pass.origin, "project");
  assert.match(runRecord.target.sha256, /^[a-f0-9]{64}$/);
  assert.match(runRecord.target.body_sha256, /^[a-f0-9]{64}$/);
  assert.match(runRecord.pass.definition_sha256, /^[a-f0-9]{64}$/);
  assert.match(runRecord.registry_sha256, /^[a-f0-9]{64}$/);
  assert.equal(runRecord.attempts[0].status, "mock");

  const gateResult = runner(["gate", "draft/01-opening.md", "--json"], { cwd: workspace });
  assert.notEqual(gateResult.status, 2, gateResult.stderr || gateResult.stdout);
  const gate = JSON.parse(gateResult.stdout);
  const reviewIds = gate.requirements.find((requirement) => requirement.id === "contract.review_ids_exist");
  assert.equal(reviewIds?.status, "pass", JSON.stringify(reviewIds, null, 2));
  const coverage = gate.requirements.find((requirement) => requirement.id === "reviews.declared_have_run");
  assert.equal(coverage?.status, "skip", JSON.stringify(coverage, null, 2));
  assert.match(coverage.message, /No applicable declared review passes target active sections/);
  const freshness = gate.requirements.find((requirement) => requirement.id === "reviews.declared_fresh");
  assert.equal(freshness?.status, "skip", JSON.stringify(freshness, null, 2));
  assert.equal(typeof gate.input_hashes.reviews_registry, "string");
  assert.equal(typeof gate.input_hashes.review_runs, "string");
}

function assertInstalledCandidatePreview(workspace, runner) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const targetRel = "draft/01-opening.md";
  const targetFile = path.join(manuscriptRoot, targetRel);
  const baseText = fs.readFileSync(targetFile, "utf8");
  const sourceSha256 = sha256(baseText);
  const issueId = "issue-installed-001";

  writeJsonFile(path.join(manuscriptRoot, "state/issues/issue-ledger.json"), {
    version: 1,
    next_id: 2,
    issues: [
      {
        id: issueId,
        status: "accepted",
        target: { file: targetRel, section_id: "01-opening" },
        category: "structure",
        severity: "minor",
        claim: "The installed smoke needs a durable accepted issue for candidate preview.",
        evidence: "Fixture issue inserted by install smoke.",
        recommended_action: "Create a candidate preview without model calls.",
        decision: {
          issue_id: issueId,
          decision: "accept",
          reason: "Exercise installed candidate command routing.",
          revision_instruction: "Add a concise installed-mode verification sentence.",
          merge_into: "",
          decided_at: "2026-06-16T00:00:00.000Z",
        },
      },
    ],
  });

  for (const cwd of [workspace, manuscriptRoot, draftRoot]) {
    const target = cwd === draftRoot ? "01-opening.md" : targetRel;
    const issues = runner(["issues", "list", "--status", "accepted"], { cwd });
    assert.equal(issues.status, 0, issues.stderr || issues.stdout);
    assert.match(issues.stdout, new RegExp(issueId));

    const revise = runner(["revise:candidates", target, "--issue", issueId, "--dry-run"], { cwd });
    assert.equal(revise.status, 0, revise.stderr || revise.stdout);
    assert.match(revise.stdout, /Candidate run dry-run/);
  }

  assertInstalledMockRevisionModelSurface({ workspace, runner, manuscriptRoot, draftRoot, targetRel, baseText, issueId });

  const runId = "installed-run-001";
  const runRel = path.join("state/candidates/01-opening", runId);
  const runDir = path.join(manuscriptRoot, runRel);
  mkdir(runDir);
  const candidateAText = `${baseText.trim()}\n\nThis installed-mode candidate preserves the base draft while adding one preview sentence.\n`;
  const candidateBText = `${baseText.trim()}\n\nThis alternate installed-mode candidate uses a slightly different preview sentence.\n`;
  writeText(path.join(runDir, "base.md"), baseText);
  writeText(path.join(runDir, "candidate-a.md"), candidateAText);
  writeText(path.join(runDir, "candidate-b.md"), candidateBText);
  writeJsonFile(path.join(runDir, "issue-context.json"), {
    version: 1,
    target: targetRel,
    issue_ids: [issueId],
    issues: [{ id: issueId, status: "accepted", target: { file: targetRel, section_id: "01-opening" }, claim: "Installed preview issue." }],
  });
  writeJsonFile(path.join(runDir, "manifest.json"), {
    version: 1,
    run_id: runId,
    created_at: "2026-06-16T00:00:00.000Z",
    target: targetRel,
    section_id: "01-opening",
    source_sha256: sourceSha256,
    status: "generated",
    n: 2,
    models: ["manual:installed-smoke"],
    issue_ids: [issueId],
    files: {
      base: `${runRel}/base.md`,
      issue_context: `${runRel}/issue-context.json`,
      candidate_meta: `${runRel}/candidate-meta.json`,
    },
    candidates: [
      { candidate_id: "candidate-a", model: "manual:installed-smoke", strategy: "minimal", file: `${runRel}/candidate-a.md`, raw_output_file: "" },
      { candidate_id: "candidate-b", model: "manual:installed-smoke", strategy: "alternate", file: `${runRel}/candidate-b.md`, raw_output_file: "" },
    ],
    completed_at: "2026-06-16T00:00:00.000Z",
  });
  writeJsonFile(path.join(runDir, "candidate-meta.json"), {
    version: 1,
    run_id: runId,
    generated_at: "2026-06-16T00:00:00.000Z",
    target: targetRel,
    section_id: "01-opening",
    source_sha256: sourceSha256,
    candidates: [
      { candidate_id: "candidate-a", model: "manual:installed-smoke", file: `${runRel}/candidate-a.md`, error: "", summary: "Adds preview sentence." },
      { candidate_id: "candidate-b", model: "manual:installed-smoke", file: `${runRel}/candidate-b.md`, error: "", summary: "Adds alternate preview sentence." },
    ],
  });
  writeJsonFile(path.join(runDir, "decision.json"), {
    version: 1,
    source_candidate_run: runId,
    decision: "winner_selected",
    winner: "candidate-a",
    confidence: "high",
    reason: "Manual installed smoke winner.",
  });
  writeJsonFile(path.join(runDir, "taste-pass.json"), {
    disposition: "pass",
    confidence: "high",
    candidate_id: "candidate-a",
    rationale: "Installed smoke candidate can apply.",
    reader_effect: "Keeps the scaffold readable.",
    voice_integrity: "Preserves the neutral tutorial voice.",
    section_effect: "Maintains the section job.",
    future_story_debt: [],
    blocking_reasons: [],
    required_patch: "",
    protected_strengths: ["Concise project setup."],
  });

  for (const cwd of [workspace, manuscriptRoot, draftRoot]) {
    const target = cwd === draftRoot ? "01-opening.md" : targetRel;
    const compare = runner(["compare:candidates", target, "--run", runId, "--dry-run"], { cwd });
    assert.equal(compare.status, 0, compare.stderr || compare.stdout);
    assert.match(compare.stdout, /Compare candidates dry-run/);

    const taste = runner(["taste:arbiter", target, "--run", runId, "--dry-run"], { cwd });
    assert.equal(taste.status, 0, taste.stderr || taste.stdout);
    assert.match(taste.stdout, /Taste arbiter dry-run/);

    const mergePreview = assertJsonCommand(runner, ["merge:winner", target, "--run", runId, "--json"], { cwd });
    assert.equal(mergePreview.applied, false);
    assert.equal(mergePreview.selected_candidate, "candidate-a");
    assert.equal(mergePreview.files.winner, `${runRel}/winner.md`);
  }

  const taste = assertJsonCommand(
    runner,
    ["taste:arbiter", targetRel, "--run", runId, "--mock-response", `${runRel}/taste-pass.json`, "--models", "openrouter:z-ai/glm-5.2", "--json"],
    { cwd: workspace },
  );
  assert.equal(taste.gate.disposition, "pass");
  assert.equal(taste.gate.can_apply, true);
  assert(fs.existsSync(path.join(runDir, "taste-arbiter.json")));

  const merge = assertJsonCommand(runner, ["merge:winner", "01-opening.md", "--run", runId, "--apply", "--audit", "--static-only", "--json"], { cwd: draftRoot });
  assert.equal(merge.applied, true);
  assert.equal(merge.selected_candidate, "candidate-a");
  assert.equal(merge.audit.status, "ran", JSON.stringify(merge.audit, null, 2));
  assert(fs.existsSync(path.join(runDir, "winner.md")));
  assert(fs.existsSync(path.join(runDir, "merge-result.json")));
  assert(fs.existsSync(path.join(runDir, "before-apply.md")));
  assert.match(fs.readFileSync(targetFile, "utf8"), /installed-mode candidate preserves the base draft/);
  assert(fs.existsSync(path.join(manuscriptRoot, "state", "revision-audits", "01-opening")));
}

function assertInstalledMockRevisionModelSurface({ workspace, runner, manuscriptRoot, draftRoot, targetRel, baseText, issueId }) {
  const runId = "installed-mock-model-run-001";
  const runRel = path.join("state/candidates/01-opening", runId);
  const mockCandidatesRel = "state/candidates/mock-candidate-responses.json";
  const mockCompareRel = "state/candidates/mock-compare-response.json";
  const mockDiffRel = "state/revision-audits/mock-diff-audit-response.json";
  const candidateAText = `${baseText.trim()}\n\nThis mock model candidate adds one installed-mode verification sentence.\n`;
  const candidateBText = `${baseText.trim()}\n\nThis alternate mock model candidate adds a different installed-mode verification sentence.\n`;

  writeJsonFile(path.join(manuscriptRoot, mockCandidatesRel), [
    {
      summary: "Adds installed-mode verification sentence.",
      candidate_markdown: candidateAText,
      changed_lines: ["Added one verification sentence."],
      protected_strengths: ["Keeps the scaffold contract."],
      risk_notes: [],
    },
    {
      summary: "Adds alternate installed-mode verification sentence.",
      candidate_markdown: candidateBText,
      changed_lines: ["Added alternate verification sentence."],
      protected_strengths: ["Keeps the scaffold contract."],
      risk_notes: [],
    },
  ]);
  writeJsonFile(path.join(manuscriptRoot, mockCompareRel), [
    {
      winner: "A",
      confidence: "high",
      reason: "Candidate A fixes the accepted issue with less extra wording.",
      issue_resolution: "Resolves the installed smoke issue.",
      voice_preservation: "Preserves the neutral tutorial voice.",
      new_regressions: [],
    },
    {
      winner: "B",
      confidence: "high",
      reason: "Candidate A remains better after order swapping.",
      issue_resolution: "Resolves the installed smoke issue.",
      voice_preservation: "Preserves the neutral tutorial voice.",
      new_regressions: [],
    },
  ]);
  writeJsonFile(path.join(manuscriptRoot, mockDiffRel), {
    target_issue: issueId,
    verdict: "improved",
    voice_preservation: 0.9,
    pattern_saturation_delta: 0,
    register_variance_delta: 0,
    issue_resolution: { status: "resolved" },
    lost_high_value_lines: [],
    new_strengths: ["Adds a concrete verification sentence."],
    remaining_hotspots: [],
    gaming_risk: { risk: "low" },
    recommendation: "The mocked model audit approves the change.",
  });

  const generated = parseJsonFromMixedOutput(
    runner(
      [
        "revise:candidates",
        "01-opening.md",
        "--issue",
        issueId,
        "--run-id",
        runId,
        "--n",
        "2",
        "--models",
        "openrouter:openai/gpt-4.1-mini",
        "--mock-response",
        mockCandidatesRel,
        "--json",
      ],
      { cwd: draftRoot },
    ),
  );
  assert.equal(generated.run_id, runId);
  assert.equal(generated.manifest.status, "generated");
  assert.equal(generated.candidate_meta.candidates.length, 2);
  assert(fs.existsSync(path.join(manuscriptRoot, runRel, "candidate-a.md")));
  assert(fs.existsSync(path.join(manuscriptRoot, runRel, "candidate-b.md")));

  const compared = parseJsonFromMixedOutput(
    runner(
      [
        "compare:candidates",
        "01-opening.md",
        "--run",
        runId,
        "--models",
        "openrouter:openai/gpt-4.1-mini",
        "--mock-response",
        mockCompareRel,
        "--json",
      ],
      { cwd: draftRoot },
    ),
  );
  assert.equal(compared.decision.winner, "candidate-a");
  assert(fs.existsSync(path.join(manuscriptRoot, runRel, "comparisons", "comparisons.json")));

  writeJsonFile(path.join(manuscriptRoot, runRel, "taste-pass.json"), {
    disposition: "pass",
    confidence: "high",
    candidate_id: "candidate-a",
    rationale: "Mock candidate can apply.",
    reader_effect: "Keeps the scaffold readable.",
    voice_integrity: "Preserves the neutral tutorial voice.",
    section_effect: "Maintains the section job.",
    future_story_debt: [],
    blocking_reasons: [],
    required_patch: "",
    protected_strengths: ["Concise project setup."],
  });
  const taste = assertJsonCommand(
    runner,
    ["taste:arbiter", "01-opening.md", "--run", runId, "--mock-response", `${runRel}/taste-pass.json`, "--models", "openrouter:z-ai/glm-5.2", "--json"],
    { cwd: draftRoot },
  );
  assert.equal(taste.gate.disposition, "pass");
  assert.equal(taste.gate.can_apply, true);

  const audit = parseJsonFromMixedOutput(
    runner(
      [
        "diff:audit",
        "--before",
        `${runRel}/base.md`,
        "--after",
        `${runRel}/candidate-a.md`,
        "--issue",
        issueId,
        "--model",
        "openrouter:openai/gpt-4.1-mini",
        "--mock-response",
        mockDiffRel,
        "--json",
      ],
      { cwd: draftRoot },
    ),
  );
  assert.equal(audit.result.mode, "static+model");
  assert.equal(audit.result.provider, "openrouter");
  assert.equal(audit.result.parsed.verdict, "improved");
  assert(fs.existsSync(path.join(manuscriptRoot, audit.file)));
  assert.equal(fs.existsSync(path.join(draftRoot, "state")), false, "mocked model revision commands should not write state under draft/");
  assert.equal(fs.existsSync(path.join(workspace, "node_modules", "manuscript-lab", "state")), false, "mocked model revision commands should not write state under the package");
}

function assertJsonCommand(runner, args, { cwd }) {
  const result = runner(args, { cwd });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function parseJsonFromMixedOutput(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const start = result.stdout.indexOf("{");
  assert.notEqual(start, -1, result.stdout);
  return JSON.parse(result.stdout.slice(start));
}

function runMlab(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "bin/manuscript-lab.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runInstalledMlab(args, { cwd, installRoot = cwd }) {
  const bin = path.join(installRoot, "node_modules", ".bin", process.platform === "win32" ? "mlab.cmd" : "mlab");
  return spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runProjectLocalNpxMlab(args, { cwd }) {
  return spawnSync(npmCommand, ["exec", "--", "mlab", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runOneOffNpxLikeMlab(args, { cwd, tarball }) {
  return spawnSync(npmCommand, ["exec", "--yes", `--package=${tarball}`, "--", "mlab", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGlobalMlab(args, { cwd, prefix }) {
  const bin = path.join(prefix, process.platform === "win32" ? "mlab.cmd" : "bin/mlab");
  return spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function writeJsonFile(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}
