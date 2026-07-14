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
  testSectionReadyBlocksNotStartedStatus();
  testSectionWordsFloorAndNearTarget();
  testWordsFloorOverrides();
  testCitationAliases();
  testCitationGateMatchesCitationsCheck();
  testManuscriptReadyAggregatesSectionReadiness();
  testManuscriptFailsWhenNoSectionStarted();
  testManuscriptPassesWithActiveAndTodoSections();
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
  assert.equal(requirement(failParsed, "evidence.citations.no_placeholders").status, "fail");
}

function testCitationGateMatchesCitationsCheck() {
  // The gate and `citations check` share one implementation; their verdicts
  // must never contradict each other.
  const passWorkspace = path.join(tmp, "citation-agree-pass");
  writeProject(passWorkspace);
  const gatePass = runGate(["citations", "--json"], { cwd: passWorkspace });
  const checkPass = runEvidence(["citations", "check", "--json", "--gate"], { cwd: passWorkspace });
  assert.equal(gatePass.status, 0, gatePass.stderr || gatePass.stdout);
  assert.equal(checkPass.status, 0, checkPass.stderr || checkPass.stdout);
  assert.equal(JSON.parse(gatePass.stdout).ready, JSON.parse(checkPass.stdout).ok);

  const failWorkspace = path.join(tmp, "citation-agree-fail");
  const project = writeProject(failWorkspace);
  fs.appendFileSync(path.join(project, "draft/01-opening.md"), "\nAn unregistered citation. [cite:not-a-source]\n", "utf8");
  const gateFail = runGate(["citations", "--json"], { cwd: failWorkspace });
  const checkFail = runEvidence(["citations", "check", "--json", "--gate"], { cwd: failWorkspace });
  assert.equal(gateFail.status, 1);
  assert.equal(checkFail.status, 1);
  assert.equal(JSON.parse(gateFail.stdout).ready, JSON.parse(checkFail.stdout).ok);
  assert.equal(requirement(JSON.parse(gateFail.stdout), "evidence.citations.resolve_markers").status, "fail");
}

function testSectionReadyBlocksNotStartedStatus() {
  const workspace = path.join(tmp, "section-todo");
  const project = writeProject(workspace);
  writeDraft(project, { status: "todo" });
  write(path.join(project, "state/status.md"), "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | todo | Fixture |\n");

  const result = runGate(["draft/01-opening.md", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, false);
  const started = requirement(parsed, "contract.status_started");
  assert.equal(started.status, "fail");
  assert.match(started.message, /Section status is "todo"\. Set status: draft in the section contract when writing begins\./);
  assert.equal(requirement(parsed, "words.floor").status, "skip");
  assert.equal(requirement(parsed, "words.near_target").status, "skip");
}

function testSectionWordsFloorAndNearTarget() {
  const workspace = path.join(tmp, "section-words-floor");
  const project = writeProject(workspace);
  writeDraft(project, { targetWords: 900, proseWords: 60 });
  writeRuntime(project, "draft/01-opening.md", "01-opening");

  const result = runGate(["draft/01-opening.md", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, false);
  const floor = requirement(parsed, "words.floor");
  assert.equal(floor.status, "fail");
  assert.match(floor.message, /below the word floor of 297/);
  assert.equal(floor.evidence.floor_words, 297);
  const near = requirement(parsed, "words.near_target");
  assert.equal(near.status, "warn");
  assert.match(near.message, /below 80% of target 900/);

  // Enough words for the floor but under 80% of target: warn only, still ready.
  writeDraft(project, { targetWords: 900, proseWords: 320 });
  writeRuntime(project, "draft/01-opening.md", "01-opening");
  const warnOnly = runGate(["draft/01-opening.md", "--json"], { cwd: workspace });
  assert.equal(warnOnly.status, 0, warnOnly.stderr || warnOnly.stdout);
  const warnParsed = JSON.parse(warnOnly.stdout);
  assert.equal(warnParsed.ready, true);
  assert.equal(warnParsed.status, "pass_with_warnings");
  assert.equal(requirement(warnParsed, "words.floor").status, "pass");
  assert.equal(requirement(warnParsed, "words.near_target").status, "warn");
}

function testWordsFloorOverrides() {
  // Contract min_words overrides the computed floor.
  const contractWorkspace = path.join(tmp, "words-floor-min-words");
  const contractProject = writeProject(contractWorkspace);
  writeDraft(contractProject, { targetWords: 900, proseWords: 60, extraContract: "min_words: 40" });
  writeRuntime(contractProject, "draft/01-opening.md", "01-opening");
  const minWordsResult = runGate(["draft/01-opening.md", "--json"], { cwd: contractWorkspace });
  assert.equal(minWordsResult.status, 0, minWordsResult.stderr || minWordsResult.stdout);
  const minWordsParsed = JSON.parse(minWordsResult.stdout);
  const minWordsFloor = requirement(minWordsParsed, "words.floor");
  assert.equal(minWordsFloor.status, "pass");
  assert.equal(minWordsFloor.evidence.floor_words, 40);
  assert.equal(minWordsFloor.evidence.floor_source, "contract.min_words");

  // A blank min_words value must fall through to the ratio floor instead of
  // silently zeroing it; junk non-numeric values fall through the same way.
  for (const [suffix, extraContract] of [["blank", "min_words:"], ["junk", "min_words: abc"]]) {
    const workspace = path.join(tmp, `words-floor-${suffix}-min-words`);
    const project = writeProject(workspace);
    writeDraft(project, { targetWords: 900, proseWords: 60, extraContract });
    writeRuntime(project, "draft/01-opening.md", "01-opening");
    const result = runGate(["draft/01-opening.md", "--json"], { cwd: workspace });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    const floor = requirement(parsed, "words.floor");
    assert.equal(floor.status, "fail", `${suffix} min_words must keep the ratio floor`);
    assert.equal(floor.evidence.floor_words, 297);
    assert.equal(floor.evidence.floor_source, "default_ratio");
  }

  // Config gates.section.words_floor_ratio overrides the default ratio.
  const configWorkspace = path.join(tmp, "words-floor-config");
  const configProject = writeProject(configWorkspace, {
    config: { gates: { section: { words_floor_ratio: 0.05 } } },
  });
  writeDraft(configProject, { targetWords: 900, proseWords: 60 });
  writeRuntime(configProject, "draft/01-opening.md", "01-opening");
  const configResult = runGate(["draft/01-opening.md", "--json"], { cwd: configWorkspace });
  assert.equal(configResult.status, 0, configResult.stderr || configResult.stdout);
  const configParsed = JSON.parse(configResult.stdout);
  const configFloor = requirement(configParsed, "words.floor");
  assert.equal(configFloor.status, "pass");
  assert.equal(configFloor.evidence.floor_words, 45);
  assert.equal(configFloor.evidence.floor_source, "config.gates.section.words_floor_ratio");
}

function testManuscriptReadyAggregatesSectionReadiness() {
  const workspace = path.join(tmp, "manuscript-fail");
  const project = writeProject(workspace);
  fs.rmSync(path.join(project, "state/runtime/01-opening"), { recursive: true, force: true });

  const result = runGate(["manuscript", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.gate_id, "manuscript-ready");
  const sectionsReady = requirement(parsed, "sections.ready");
  assert.equal(sectionsReady.status, "fail");
  assert.match(sectionsReady.message, /Sections not ready: draft\/01-opening\.md \(runtime\.fresh\)/);
  const failedSection = sectionsReady.evidence.failed_sections[0];
  assert.equal(failedSection.file, "draft/01-opening.md");
  assert.equal(failedSection.failures[0].id, "runtime.fresh");
  assert.match(failedSection.failures[0].message, /Runtime packet is missing/);
  assert.equal(requirement(parsed, "runtime.all_fresh").status, "fail");
}

function testManuscriptFailsWhenNoSectionStarted() {
  // A fresh workspace where every draft is still todo must not pass the
  // manuscript gate vacuously: sections.any_started blocks the false green.
  const workspace = path.join(tmp, "manuscript-all-todo");
  const project = writeProject(workspace);
  writeDraft(project, { status: "todo" });
  write(path.join(project, "state/status.md"), "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | todo | Fixture |\n");

  const result = runGate(["manuscript", "--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, false);
  const anyStarted = requirement(parsed, "sections.any_started");
  assert.equal(anyStarted.status, "fail");
  assert.match(anyStarted.message, /No section has been started — every draft is still "todo"\./);
  assert.equal(anyStarted.evidence.total_sections, 1);
  assert.equal(anyStarted.evidence.active_sections, 0);
  // The todo section stays out of manuscript scope; sections.ready itself passes.
  assert.equal(requirement(parsed, "sections.ready").status, "pass");
}

function testManuscriptPassesWithActiveAndTodoSections() {
  // One started section plus one todo section: the todo section stays out of
  // manuscript scope, sections.any_started passes, and the gate stays ready.
  const workspace = path.join(tmp, "manuscript-active-plus-todo");
  const project = writeProject(workspace);
  write(path.join(project, "draft/02-body.md"), `<!--
id: 02-body
kind: document.section
status: todo
target_words: 900
purpose: Hold a later section while the opening is drafted.
acceptance:
  - Stays todo until drafting starts.
checks:
  - claims.supported
reviews:
  - cold.reader
-->
# Body

Planned section body arrives later.
`);
  write(
    path.join(project, "state/status.md"),
    "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | draft | Fixture |\n| Body | `draft/02-body.md` | todo | Fixture |\n",
  );
  writeRuntime(project, "draft/01-opening.md", "01-opening");

  const result = runGate(["manuscript", "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ready, true);
  assert.equal(requirement(parsed, "sections.any_started").status, "pass");
  assert.equal(requirement(parsed, "sections.ready").status, "pass");

  // All-done projects keep passing sections.any_started too.
  writeDraft(project, { status: "done" });
  fs.rmSync(path.join(project, "draft/02-body.md"), { force: true });
  write(path.join(project, "outline.md"), "# Outline\n\n### Opening\nStatus: done\nFile: `draft/01-opening.md`\n");
  write(path.join(project, "state/status.md"), "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | done | Fixture |\n");
  writeRuntime(project, "draft/01-opening.md", "01-opening");
  const doneResult = runGate(["manuscript", "--json"], { cwd: workspace });
  assert.equal(doneResult.status, 0, doneResult.stderr || doneResult.stdout);
  const doneParsed = JSON.parse(doneResult.stdout);
  assert.equal(doneParsed.ready, true);
  assert.equal(requirement(doneParsed, "sections.any_started").status, "pass");
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

  // Without --formats the export gate now defaults to md,html.
  const defaults = runGate(["export", "--json"], { cwd: workspace });
  assert.equal(defaults.status, 0, defaults.stderr || defaults.stdout);
  const defaultsParsed = JSON.parse(defaults.stdout);
  assert.equal(defaultsParsed.ready, true);
  assert.deepEqual(requirement(defaultsParsed, "export.formats_present").evidence.required_formats, ["md", "html"]);
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

function writeProject(workspace, options = {}) {
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
    ...(options.config ?? {}),
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
  writeDraft(project);
  writeRuntime(project, draftRel, "01-opening");
  return project;
}

function writeDraft(project, { status = "draft", targetWords = 20, proseWords = 0, extraContract = "" } = {}) {
  const body = proseWords
    ? proseOfWords(proseWords)
    : "This fixture section contains enough plain prose to satisfy the started-section\nthreshold while staying small enough for focused readiness tests.";
  write(path.join(project, "draft/01-opening.md"), `<!--
id: 01-opening
kind: document.section
status: ${status}
target_words: ${targetWords}
${extraContract ? `${extraContract}\n` : ""}purpose: Exercise gate readiness.
acceptance:
  - Contains enough prose for a started section.
checks:
  - claims.supported
reviews:
  - cold.reader
-->
# Opening

${body}
`);
}

function proseOfWords(count) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");
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

function runEvidence(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/evidence-spine.mjs"), ...args], {
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
