#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REQUIRED_PROJECT_DIRS, REQUIRED_PROJECT_FILES, TRUTH_STATE_SCHEMA_VERSION } from "./lib/required-scaffolding.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-doccheck-"));

try {
  testPlainCheckHintsAtFix();
  testFixCreatesMissingScaffoldingIdempotently();
  testFixReportsScaffoldingConflictsCleanly();
  testFixRefusesWithoutProject();
  testInstallInitSatisfiesRequiredScaffolding();
  console.log("doccheck tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testPlainCheckHintsAtFix() {
  const workspace = path.join(tmp, "hint");
  writeSparseProject(workspace);

  const result = runDoccheck(["--static-only"], { cwd: workspace });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /- Missing required project file: brief\.md/);
  assert.match(result.stderr, /- Missing required project directory: state\/truth/);
  assert.match(result.stderr, /Run mlab check --fix to create missing scaffolding\./);
}

function testFixCreatesMissingScaffoldingIdempotently() {
  const workspace = path.join(tmp, "fix");
  const project = writeSparseProject(workspace);

  const fixed = runDoccheck(["--fix", "--static-only", "--json"], { cwd: workspace });
  assert.equal(fixed.status, 0, fixed.stderr || fixed.stdout);
  const parsed = JSON.parse(fixed.stdout);
  assert.equal(parsed.pass, true, JSON.stringify(parsed.errors, null, 2));
  assert.equal(parsed.fix, true);
  assert(parsed.fixed.includes("brief.md"));
  assert(parsed.fixed.includes("state/truth/style.json"));
  assert(parsed.fixed.includes("state/issues/issue-ledger.json"));

  for (const rel of REQUIRED_PROJECT_DIRS) {
    assert(fs.existsSync(path.join(project, rel)), `missing required dir after --fix: ${rel}`);
  }
  for (const rel of REQUIRED_PROJECT_FILES) {
    assert(fs.existsSync(path.join(project, rel)), `missing required file after --fix: ${rel}`);
  }

  const style = JSON.parse(fs.readFileSync(path.join(project, "state/truth/style.json"), "utf8"));
  assert.equal(style.schema_version, TRUTH_STATE_SCHEMA_VERSION);
  assert(style.style_profile && typeof style.style_profile === "object");
  const ledger = JSON.parse(fs.readFileSync(path.join(project, "state/issues/issue-ledger.json"), "utf8"));
  assert(Array.isArray(ledger.issues));

  const again = runDoccheck(["--fix", "--static-only", "--json"], { cwd: workspace });
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.deepEqual(JSON.parse(again.stdout).fixed, []);
}

function testFixReportsScaffoldingConflictsCleanly() {
  // A required directory shadowed by a regular file must produce a clean
  // actionable error from --fix, not an unhandled EEXIST stack trace.
  const workspace = path.join(tmp, "fix-conflict");
  const project = writeSparseProject(workspace);
  fs.mkdirSync(path.join(project, "state"), { recursive: true });
  fs.writeFileSync(path.join(project, "state/truth"), "oops\n", "utf8");

  const result = runDoccheck(["--fix", "--static-only"], { cwd: workspace });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Cannot create required scaffolding:/);
  assert.match(result.stderr, /Cannot create state\/truth: state\/truth exists as a file/);
  assert.match(result.stderr, /Cannot create state\/truth\/entities\.json: state\/truth exists as a file/);
  assert.match(result.stderr, /re-run mlab check --fix/);
  assert.doesNotMatch(result.stderr, /EEXIST|ENOTDIR/, "conflicts must not surface as raw fs errors");
  assert.doesNotMatch(result.stderr, /at .*required-scaffolding\.mjs/, "conflicts must not print a stack trace");
  assert(fs.statSync(path.join(project, "state/truth")).isFile(), "--fix must not delete the shadowing file");
}

function testFixRefusesWithoutProject() {
  const workspace = path.join(tmp, "no-project");
  fs.mkdirSync(workspace, { recursive: true });

  const result = runDoccheck(["--fix", "--static-only"], { cwd: workspace });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No Manuscript Lab project found/);
  assert.equal(fs.existsSync(path.join(workspace, "state")), false, "--fix must not scaffold without a project");
}

function testInstallInitSatisfiesRequiredScaffolding() {
  // Drift guard: a fresh install-anywhere workspace must satisfy the shared
  // required-scaffolding list without any --fix step.
  const workspace = path.join(tmp, "install-init");
  fs.mkdirSync(workspace, { recursive: true });

  const init = spawnSync(process.execPath, [path.join(repoRoot, "scripts/install-init.mjs"), "--json", "--title", "Drift Guard"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const project = path.join(workspace, "manuscript");
  for (const rel of REQUIRED_PROJECT_FILES) {
    assert(fs.existsSync(path.join(project, rel)), `install-init did not create required file: ${rel}`);
  }
  const style = JSON.parse(fs.readFileSync(path.join(project, "state/truth/style.json"), "utf8"));
  assert.equal(style.schema_version, TRUTH_STATE_SCHEMA_VERSION);

  const check = runDoccheck(["--static-only"], { cwd: workspace });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.doesNotMatch(check.stderr, /Missing required project/);
}

function writeSparseProject(workspace) {
  const project = path.join(workspace, "manuscript");
  fs.mkdirSync(path.join(project, "draft"), { recursive: true });
  writeJson(path.join(workspace, "manuscript-lab.config.json"), {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "manuscript",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
    sourcesDir: "sources",
    profileOptions: {},
  });
  write(path.join(project, "outline.md"), "# Outline\n");
  write(path.join(project, "style.md"), "# Style\n");
  write(path.join(project, "draft/01-a.md"), `<!--
id: 01-a
kind: document.section
status: draft
target_words: 60
purpose: Exercise check --fix.
acceptance:
  - Exists.
-->
# A

${Array.from({ length: 30 }, (_, index) => `word${index + 1}`).join(" ")}
`);
  return project;
}

function runDoccheck(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/doccheck.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}
