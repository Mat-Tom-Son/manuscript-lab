#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-report-"));

try {
  testReadyProjectHasNoBlockers();
  testFreshAllTodoProjectIsNotReady();
  testBlockersCarryFixCommandsAndSectionDetail();
  testTerminalAndHtmlRenderFixes();
  console.log("report tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testReadyProjectHasNoBlockers() {
  const workspace = path.join(tmp, "ready");
  writeProject(workspace);

  const result = runReport(["--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.blockers, null, 2));
  assert.equal(parsed.summary.state, "ready");
  assert.deepEqual(parsed.blockers, []);
  const reviewAdvisory = parsed.advisories.find((item) => item.type === "reviews.declared_have_run");
  assert(reviewAdvisory, JSON.stringify(parsed.advisories, null, 2));
  assert.equal(reviewAdvisory.fix, "mlab review run draft/01-opening.md --passes cold.reader");
  assert.equal(parsed.summary.advisories, parsed.advisories.length);
}

function testFreshAllTodoProjectIsNotReady() {
  // A fresh project where every section is still todo must not report ready:
  // the manuscript gate blocks on sections.any_started instead of passing
  // vacuously with zero active sections.
  const workspace = path.join(tmp, "all-todo");
  const project = writeProject(workspace);
  const draftFile = path.join(project, "draft/01-opening.md");
  write(draftFile, fs.readFileSync(draftFile, "utf8").replace("status: draft", "status: todo"));
  write(path.join(project, "outline.md"), "# Outline\n\n### Opening\nStatus: todo\nFile: `draft/01-opening.md`\n");
  write(path.join(project, "state/status.md"), "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | todo | Fixture |\n");

  const result = runReport(["--json", "--gate"], { cwd: workspace });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.summary.state, "not_ready");
  const blocker = parsed.blockers.find((item) => item.type === "sections.any_started");
  assert(blocker, `expected a sections.any_started blocker, found: ${parsed.blockers.map((item) => item.type).join(", ")}`);
  assert.match(blocker.message, /No section has been started — every draft is still "todo"\./);
  assert.equal(blocker.fix, "Set status: draft in the section contract you are writing, then run mlab compose <file>.");
}

function testBlockersCarryFixCommandsAndSectionDetail() {
  const workspace = path.join(tmp, "broken");
  const project = writeProject(workspace);
  breakProject(project);

  const result = runReport(["--json", "--gate"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.summary.state, "not_ready");
  assert(parsed.blockers.length > 0, "expected blockers");

  for (const item of parsed.blockers) {
    assert.equal(typeof item.fix, "string", `blocker ${item.type} is missing a fix field`);
    assert(item.fix.length > 0, `blocker ${item.type} has an empty fix`);
  }

  const sectionBlocker = parsed.blockers.find((item) => item.type === "sections.ready" && item.target === "draft/02-body.md");
  assert(sectionBlocker, "expected a per-section sections.ready blocker for draft/02-body.md");
  assert.match(sectionBlocker.message, /draft\/02-body\.md is not ready: /);
  assert.match(sectionBlocker.message, /below the word floor of 297/);
  assert.match(sectionBlocker.message, /Runtime packet is missing/);
  assert.equal(sectionBlocker.fix, "mlab compose draft/02-body.md");
  const failureIds = sectionBlocker.evidence.section.failures.map((failure) => failure.id);
  assert(failureIds.includes("words.floor"));
  assert(failureIds.includes("runtime.fresh"));
  assert(!parsed.blockers.some((item) => item.message === "One or more active sections are not ready."), "vague section blocker must be gone");

  const runtimeBlocker = parsed.blockers.find((item) => item.type === "runtime.all_fresh");
  assert(runtimeBlocker, "expected a runtime.all_fresh blocker");
  assert.equal(runtimeBlocker.fix, "mlab compose draft/02-body.md");

  const staticBlocker = parsed.blockers.find((item) => item.type === "doccheck.static_all_pass");
  assert(staticBlocker, "expected a doccheck.static_all_pass blocker");
  assert.equal(staticBlocker.fix, "mlab check --fix");
}

function testTerminalAndHtmlRenderFixes() {
  const workspace = path.join(tmp, "render");
  const project = writeProject(workspace);
  breakProject(project);

  const text = runReport([], { cwd: workspace });
  assert.equal(text.status, 0, text.stderr || text.stdout);
  assert.match(text.stdout, /\n  fix: mlab compose draft\/02-body\.md\n/);
  assert.match(text.stdout, /\n  fix: mlab check --fix\n/);
  assert.match(text.stdout, /Advisories:/);
  assert.match(text.stdout, /mlab review run draft\/01-opening\.md --passes cold\.reader/);

  const html = runReport(["--html"], { cwd: workspace });
  assert.equal(html.status, 0, html.stderr || html.stdout);
  assert.match(html.stdout, /<th>Fix<\/th>/);
  assert.match(html.stdout, /<code>mlab compose draft\/02-body\.md<\/code>/);
  assert.match(html.stdout, /<code>mlab check --fix<\/code>/);
  assert.match(html.stdout, /<h2>Advisories<\/h2>/);
  assert.match(html.stdout, /mlab review run draft\/01-opening\.md --passes cold\.reader/);
}

function breakProject(project) {
  // A started section far below its word floor, with no runtime packet.
  write(path.join(project, "draft/02-body.md"), `<!--
id: 02-body
kind: document.section
status: draft
target_words: 900
purpose: Exercise report blocker detail.
acceptance:
  - Carries the body of the argument.
checks:
  - claims.supported
reviews:
  - cold.reader
-->
# Body

${proseOfWords(60)}
`);
  write(
    path.join(project, "state/status.md"),
    "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | draft | Fixture |\n| Body | `draft/02-body.md` | draft | Fixture |\n",
  );
  // Missing required scaffolding so doccheck.static_all_pass fails.
  fs.rmSync(path.join(project, "state/truth/claims.json"), { force: true });
  // Refresh the healthy section's packet after the status.md rewrite so only
  // draft/02-body.md is stale.
  writeRuntime(project, "draft/01-opening.md", "01-opening");
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
purpose: Exercise report readiness.
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

function runReport(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/report.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function proseOfWords(count) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ");
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
