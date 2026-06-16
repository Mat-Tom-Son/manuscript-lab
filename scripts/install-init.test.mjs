#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
