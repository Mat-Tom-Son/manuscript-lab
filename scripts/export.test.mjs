#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const bin = path.join(repoRoot, "bin/manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-export-"));

try {
  testExportWarnsAndRecordsReadinessOnRedProject();
  testRequireReadyRefusesOnRedProject();
  testCleanExportOnReadyProject();
  console.log("export tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testExportWarnsAndRecordsReadinessOnRedProject() {
  const workspace = initWorkspace("red");
  startSection(workspace, { compose: false });

  const result = run(["export"], workspace);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /WARNING: exporting while the manuscript gate is FAILING/);
  assert.match(result.stderr, /--require-ready/);
  assert.match(result.stdout, /- readiness: not_ready \(draft export/);

  const manifest = readManifest(workspace);
  assert.equal(manifest.readiness.status, "not_ready");
  assert(manifest.readiness.failing.includes("runtime.all_fresh"), JSON.stringify(manifest.readiness));
  assert.equal(manifest.gate_enforced, false);
}

function testRequireReadyRefusesOnRedProject() {
  const workspace = initWorkspace("red-refuse");
  startSection(workspace, { compose: false });

  const result = run(["export", "--require-ready"], workspace);
  assert.equal(result.status, 1, "export --require-ready must fail on a red project");
  assert.match(result.stderr, /Manuscript gate is failing/);
  assert.equal(fs.existsSync(path.join(workspace, "manuscript/exports/manifest.json")), false, "refused export must write nothing");
}

function testCleanExportOnReadyProject() {
  const workspace = initWorkspace("green");
  startSection(workspace, { compose: true });

  const result = run(["export", "--json"], workspace);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /WARNING/);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.readiness.status, "ready");
  assert.deepEqual(parsed.readiness.failing, []);
  assert.equal(parsed.chapters, 1);

  const manifest = readManifest(workspace);
  assert.equal(manifest.readiness.status, "ready");
  for (const output of parsed.outputs) {
    assert(fs.existsSync(path.join(workspace, "manuscript", output.file)), `missing export output ${output.file}`);
  }
}

function initWorkspace(name) {
  const workspace = path.join(tmp, name);
  fs.mkdirSync(workspace, { recursive: true });
  const init = run(["init"], workspace);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return workspace;
}

// Promotes 01-opening to a started section with enough prose to satisfy the
// word floor, then lets `check --fix` sync status.md/outline.md from the
// contract; with compose: true the runtime packet is fresh and the project
// gates green, with compose: false the project stays red on runtime.all_fresh.
function startSection(workspace, { compose }) {
  const draft = path.join(workspace, "manuscript/draft/01-opening.md");
  const text = fs.readFileSync(draft, "utf8");
  const contract = text.slice(0, text.indexOf("-->") + 3).replace("status: todo", "status: draft");
  const sentence = "The opening section carries enough deliberate prose to satisfy the word floor for this fixture. ";
  fs.writeFileSync(draft, `${contract}\n# Opening\n\n${sentence.repeat(40)}\n`, "utf8");

  const synced = run(["check", "--fix", "--static-only"], workspace);
  assert.equal(synced.status, 0, synced.stderr || synced.stdout);
  assert.match(synced.stdout, /Synced section statuses from contracts:/);

  if (compose) {
    const composed = run(["compose", "draft/01-opening.md"], workspace);
    assert.equal(composed.status, 0, composed.stderr || composed.stdout);
  }
}

function readManifest(workspace) {
  return JSON.parse(fs.readFileSync(path.join(workspace, "manuscript/exports/manifest.json"), "utf8"));
}

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
}
