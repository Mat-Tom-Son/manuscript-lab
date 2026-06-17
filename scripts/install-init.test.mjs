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

try {
  testLocalWrapperInstallInit();
  testLegacyWrapperInitRoutes();
  testUnsafeInitTargets();
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
  assertValidateWorksFrom(workspace);
  assertValidateWorksFrom(path.join(workspace, "manuscript"));
  assertValidateWorksFrom(path.join(workspace, "manuscript", "draft"));
  assertEvidenceAndGate(workspace);

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

function testLegacyWrapperInitRoutes() {
  for (const command of ["init", "project:init", "story:init"]) {
    const workspace = path.join(tmp, `legacy-${command.replace(":", "-")}`);
    mkdir(workspace);
    const result = runMlab([command, "--title", `Legacy ${command}`, "--slug", `legacy-${command.replace(":", "-")}`, "--sections", "1", "--kind", "document.section"], { cwd: workspace });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(workspace, "manuscript-lab.config.json")), false, `${command} should not create install-anywhere config`);
    assert(fs.existsSync(path.join(workspace, "projects", "registry.json")), `${command} should create template project registry`);
    assert(fs.existsSync(path.join(workspace, "draft", "01-opening.md")), `${command} should create template draft mount`);
  }

  const help = runMlab(["init", "--help"], { cwd: path.join(tmp, "local-wrapper") });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Install-anywhere alpha/);
  assert.match(help.stdout, /Template clone compatibility/);
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

  const install = spawnSync(npmCommand, ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);

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
  assertInstalledCommandSurface(workspace, installedRunner);
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
    "manuscript/state/issues/issue-ledger.json",
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
  assert.equal(gate.status, 0, gate.stderr || gate.stdout);
  const parsedGate = JSON.parse(gate.stdout);
  assert.equal(parsedGate.ready, true);
  assert.equal(parsedGate.gate_id, "section-ready");
}

function assertInstalledCommandSurface(workspace, runner) {
  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const cwdCases = [workspace, manuscriptRoot, draftRoot];

  for (const cwd of cwdCases) {
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

    const report = assertJsonCommand(runner, ["review:report", "--json"], { cwd });
    assert.equal(report.totals.runs, 0);

    const projectReport = assertJsonCommand(runner, ["report", "--json"], { cwd });
    assert.equal(projectReport.schema_version, "manuscript-lab.report.v1");
    assert.equal(fs.realpathSync(projectReport.project.manuscript_root), fs.realpathSync(manuscriptRoot));
    assert.equal(projectReport.summary.sections.total, 2);

    const done = assertJsonCommand(runner, ["done:no-export", "--json"], { cwd });
    assert.equal(done.pass, true, JSON.stringify(done, null, 2));
    assert.equal(done.checks.project_sync, "skipped");
    assert.equal(done.checks.project_filesystem, "skipped");
  }

  const nestedCompose = assertJsonCommand(runner, ["compose", "01-opening.md", "--json"], { cwd: draftRoot });
  assert.equal(nestedCompose.section, "draft/01-opening.md");

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
  assert.equal(exportManifest.outputs.length, 2);
  for (const output of exportManifest.outputs) {
    assert.equal(typeof output.sha256, "string");
    assert.equal(output.sha256.length, 64);
    assert(output.size > 0);
  }

  const writtenReport = assertJsonCommand(runner, ["report", "--write", "--json"], { cwd: workspace });
  assert.equal(writtenReport.artifacts.json, "reports/latest.json");
  assert.equal(writtenReport.artifacts.html, "reports/latest.html");
  assert.equal(writtenReport.export_manifest.file, "exports/manifest.json");
  assert(fs.existsSync(path.join(manuscriptRoot, "reports", "latest.json")));
  assert(fs.existsSync(path.join(manuscriptRoot, "reports", "latest.html")));
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
    ["taste:arbiter", targetRel, "--run", runId, "--mock-response", `${runRel}/taste-pass.json`, "--models", "openrouter:z-ai/glm-5.1", "--json"],
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

function assertJsonCommand(runner, args, { cwd }) {
  const result = runner(args, { cwd });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
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
