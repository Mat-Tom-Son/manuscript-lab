#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-gate-"));

try {
  testSectionReadyPassesAndWritesArtifacts();
  testSectionReadyFailsOnStaleRuntime();
  testCitationAliases();
  testManuscriptReadyAggregatesSectionReadiness();
  testExportReadyPassesAndWritesArtifacts();
  testExportReadyFailsOnStaleManifest();
  testEngineErrorsExitTwo();
  console.log("gate engine tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testSectionReadyPassesAndWritesArtifacts() {
  const workspace = path.join(tmp, "section-pass");
  const project = writeProject(workspace);

  const result = runGate(["draft/01-opening.md", "--json", "--write"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.gate_id, "section-ready");
  assert.equal(parsed.ready, true);
  assert.equal(parsed.status, "pass");
  assert.equal(requirement(parsed, "runtime.fresh").status, "pass");
  assert.equal(requirement(parsed, "issues.no_blockers").status, "pass");

  const runFile = path.join(project, parsed.artifacts.run);
  const latestFile = path.join(project, parsed.artifacts.latest);
  assert(fs.existsSync(runFile), "run artifact should be written");
  assert(fs.existsSync(latestFile), "latest artifact should be written");
  assert.equal(JSON.parse(fs.readFileSync(latestFile, "utf8")).run_id, parsed.run_id);
}

function testSectionReadyFailsOnStaleRuntime() {
  const workspace = path.join(tmp, "section-stale");
  const project = writeProject(workspace);
  fs.appendFileSync(path.join(project, "draft/01-opening.md"), "\nThis late edit makes the runtime packet stale.\n", "utf8");

  const result = runGate(["draft/01-opening.md", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, false);
  assert.equal(parsed.status, "fail");
  assert.equal(requirement(parsed, "runtime.fresh").status, "fail");
}

function testCitationAliases() {
  const passWorkspace = path.join(tmp, "citation-pass");
  writeProject(passWorkspace);

  const pass = runGate(["citation", "--json"], { cwd: passWorkspace });
  assert.equal(pass.status, 0, pass.stderr || pass.stdout);
  const passParsed = JSON.parse(pass.stdout);
  assert.equal(passParsed.gate_id, "citation-ready");
  assert.equal(passParsed.ready, true);

  const failWorkspace = path.join(tmp, "citation-fail");
  const project = writeProject(failWorkspace);
  fs.appendFileSync(path.join(project, "draft/01-opening.md"), "\nA specific fact waits for support. [citation-needed]\n", "utf8");

  const fail = runGate(["citations", "--json"], { cwd: failWorkspace });
  assert.equal(fail.status, 1);
  const failParsed = JSON.parse(fail.stdout);
  assert.equal(failParsed.gate_id, "citation-ready");
  assert.equal(requirement(failParsed, "claims.no_unsupported_markers").status, "fail");
}

function testManuscriptReadyAggregatesSectionReadiness() {
  const workspace = path.join(tmp, "manuscript-fail");
  const project = writeProject(workspace);
  fs.rmSync(path.join(project, "state/runtime/01-opening"), { recursive: true, force: true });

  const result = runGate(["manuscript", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.gate_id, "manuscript-ready");
  assert.equal(requirement(parsed, "sections.ready").status, "fail");
  assert.equal(requirement(parsed, "runtime.all_fresh").status, "fail");
}

function testEngineErrorsExitTwo() {
  const workspace = path.join(tmp, "engine-error");
  writeProject(workspace);

  const result = runGate(["not-a-gate", "--json"], { cwd: workspace });
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "error");
  assert.match(parsed.errors.join("\n"), /Unsupported gate target/);
}

function testExportReadyPassesAndWritesArtifacts() {
  const workspace = path.join(tmp, "export-pass");
  const project = writeProject(workspace);
  writeExport(project, { formats: ["md", "html"], slug: "fixture" });

  const result = runGate(["export", "--formats", "md,html", "--json", "--write"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.gate_id, "export-ready");
  assert.equal(parsed.ready, true);
  assert.equal(requirement(parsed, "manuscript.ready").status, "pass");
  assert.equal(requirement(parsed, "export.manifest_present").status, "pass");
  assert.equal(requirement(parsed, "export.formats_present").status, "pass");
  assert.equal(requirement(parsed, "export.generated_after_inputs").status, "pass");

  const runFile = path.join(project, parsed.artifacts.run);
  const latestFile = path.join(project, parsed.artifacts.latest);
  assert(fs.existsSync(runFile), "export run artifact should be written");
  assert(fs.existsSync(latestFile), "export latest artifact should be written");
  assert.equal(JSON.parse(fs.readFileSync(latestFile, "utf8")).run_id, parsed.run_id);
}

function testExportReadyFailsOnStaleManifest() {
  const workspace = path.join(tmp, "export-stale");
  const project = writeProject(workspace);
  writeExport(project, { formats: ["md"], slug: "fixture" });
  fs.appendFileSync(path.join(project, "brief.md"), "\nNew input after export.\n", "utf8");

  const result = runGate(["export", "--formats", "md", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.gate_id, "export-ready");
  assert.equal(parsed.ready, false);
  assert.equal(requirement(parsed, "export.generated_after_inputs").status, "fail");
}

function writeProject(workspace) {
  const project = path.join(workspace, "manuscript");
  mkdir(path.join(project, "draft"));
  mkdir(path.join(project, "state/issues"));
  mkdir(path.join(project, "state/reviews"));
  mkdir(path.join(project, "state/revision-plans"));
  mkdir(path.join(project, "state/revision-audits"));
  mkdir(path.join(project, "state/candidates"));
  mkdir(path.join(project, "state/runtime"));
  mkdir(path.join(project, "state/truth"));
  mkdir(path.join(project, "state/projections"));
  mkdir(path.join(project, "state/observations"));
  mkdir(path.join(project, "sources"));
  mkdir(path.join(project, "exports"));

  writeJson(path.join(workspace, "manuscript-lab.config.json"), {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "manuscript",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
    sourcesDir: "sources",
    tasteDir: "taste",
    profileOptions: {},
  });

  write(path.join(project, "PROJECT.md"), "# Project\n");
  write(path.join(project, "brief.md"), "# Brief\n");
  write(path.join(project, "outline.md"), "# Outline\n\n### Opening\nStatus: draft\nFile: `draft/01-opening.md`\n");
  write(path.join(project, "style.md"), "# Style\n");
  write(path.join(project, "sources/index.md"), "# Sources\n\n| Key | Type | Title | Location |\n|---|---|---|---|\n| `fixture` | note | Fixture | `brief.md` |\n");
  write(path.join(project, "state/claims.md"), "# Claims\n\n| Claim | Section | Source | Status | Notes |\n|---|---|---|---|---|\n| Fixture claim | `draft/01-opening.md` | `fixture` | supported | Covered by fixture. |\n");
  write(path.join(project, "state/continuity.md"), "# Continuity\n");
  write(path.join(project, "state/open-questions.md"), "# Open Questions\n");
  write(path.join(project, "state/status.md"), "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | draft | Fixture |\n");
  writeJson(path.join(project, "state/issues/issue-ledger.json"), { version: 1, next_id: 1, issues: [] });
  writeJson(path.join(project, "state/issues/decisions.json"), { decisions: [] });
  writeJson(path.join(project, "state/issues/closed.json"), { issues: [] });
  for (const rel of [
    "state/issues/README.md",
    "state/revision-plans/README.md",
    "state/revision-audits/README.md",
    "state/reviews/README.md",
    "state/candidates/README.md",
    "state/runtime/README.md",
    "state/truth/README.md",
    "state/projections/README.md",
    "state/observations/README.md",
  ]) {
    write(path.join(project, rel), "# State\n");
  }
  writeJson(path.join(project, "state/truth/entities.json"), { entities: [] });
  writeJson(path.join(project, "state/truth/threads.json"), { threads: [] });
  writeJson(path.join(project, "state/truth/claims.json"), { claims: [] });
  writeJson(path.join(project, "state/truth/sources.json"), { sources: [] });
  writeJson(path.join(project, "state/truth/terms.json"), { terms: [] });
  writeJson(path.join(project, "state/truth/artifacts.json"), { artifacts: [] });
  writeJson(path.join(project, "state/truth/style.json"), { style_profile: {} });

  const draftRel = "draft/01-opening.md";
  write(path.join(project, draftRel), `<!--
id: 01-opening
kind: document.section
status: draft
target_words: 20
purpose: Exercise gate readiness.
acceptance:
  - Contains enough prose for a started section.
checks:
  - claims.supported
reviews:
  - cold.reader
-->
# Opening

This fixture section contains enough plain prose to satisfy the started-section
threshold while staying small enough for focused readiness tests.
`);
  writeRuntime(project, draftRel, "01-opening");
  return project;
}

function writeRuntime(project, draftRel, sectionId) {
  const runtimeDir = path.join(project, "state/runtime", sectionId);
  mkdir(runtimeDir);
  const inputs = [draftRel, "brief.md", "outline.md", "style.md", "state/status.md", "state/claims.md", "sources/index.md"];
  const inputHashes = Object.fromEntries(inputs.map((rel) => [rel, sha256File(path.join(project, rel))]));
  writeJson(path.join(runtimeDir, "context.json"), {
    generated_at: "2026-06-16T00:00:00.000Z",
    section: draftRel,
    input_hashes: inputHashes,
    visible_files: inputs,
  });
  write(path.join(runtimeDir, "intent.md"), "# Intent\n");
  write(path.join(runtimeDir, "rule-stack.yaml"), "rules: []\n");
  write(path.join(runtimeDir, "criteria.json"), "{}\n");
  write(path.join(runtimeDir, "trace.json"), "{}\n");
}

function writeExport(project, { formats, slug }) {
  const outDir = path.join(project, "exports");
  mkdir(outDir);
  const outputs = formats.map((format) => {
    const file = path.join(outDir, `${slug}.${format}`);
    write(file, format === "html" ? "<!doctype html><title>Fixture</title>\n" : "# Fixture\n\nExport body.\n");
    return {
      format,
      file: `exports/${slug}.${format}`,
      size: fs.statSync(file).size,
      sha256: sha256File(file),
    };
  });
  const inputRels = ["PROJECT.md", "brief.md", "outline.md", "style.md", "state/status.md", "state/claims.md", "sources/index.md", "draft/01-opening.md"];
  writeJson(path.join(outDir, "manifest.json"), {
    schema_version: "manuscript-lab.export-manifest.v1",
    export_id: `export-fixture-${slug}`,
    created_at: "2026-06-16T00:00:00.000Z",
    title: "Fixture",
    subtitle: "",
    author: "",
    slug,
    profile: "whitepaper",
    mode: "installed",
    source_commit: "",
    source_dirty: false,
    gate_enforced: false,
    options: {
      formats,
      include_todo: false,
      output_dir: "exports",
    },
    chapters: [
      {
        id: "01-opening",
        file: "draft/01-opening.md",
        title: "Opening",
        status: "draft",
        sha256: sha256File(path.join(project, "draft/01-opening.md")),
      },
    ],
    input_hashes: Object.fromEntries(inputRels.map((rel) => [rel, sha256File(path.join(project, rel))])),
    outputs,
    output_summary: {
      count: outputs.length,
      formats,
      bytes: outputs.reduce((sum, output) => sum + output.size, 0),
    },
  });
}

function runGate(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/gate.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requirement(result, id) {
  const req = result.requirements.find((candidate) => candidate.id === id);
  assert(req, `missing requirement ${id}`);
  return req;
}

function write(file, content) {
  mkdir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
