#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-evidence-spine-"));

try {
  testClaimsListFiltersAndGate();
  testCitationsCheckAndReport();
  testSourcesAddIsIdempotent();
  console.log("evidence-spine tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testClaimsListFiltersAndGate() {
  const workspace = path.join(tmp, "claims-list");
  writeProject(workspace);

  const result = runEvidence(["claims", "list", "--unsupported", "--section", "draft/01-intro.md", "--json", "--gate"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.blocker_count, 2);
  assert.deepEqual(parsed.claims.map((claim) => claim.claim), ["Unsupported intro fact", "Supported intro fact with missing source"]);
  assert(parsed.claims[1].blocker_reasons.includes("unregistered-source:missing-source"));

  const supported = runEvidence(["claims", "list", "--status", "supported", "--json"], { cwd: workspace });
  assert.equal(supported.status, 0, supported.stderr || supported.stdout);
  const supportedParsed = JSON.parse(supported.stdout);
  assert.equal(supportedParsed.count, 3);
}

function testCitationsCheckAndReport() {
  const workspace = path.join(tmp, "citations");
  writeProject(workspace);

  const check = runEvidence(["citations", "check", "draft/01-intro.md", "--json", "--gate"], { cwd: workspace });
  assert.equal(check.status, 1);
  const parsed = JSON.parse(check.stdout);
  assert.equal(parsed.files.length, 1);
  assert(parsed.markers.some((marker) => marker.id === "alpha" && marker.state === "resolved-source"));
  assert(parsed.markers.some((marker) => marker.id === "supported-claim" && marker.state === "resolved-claim"));
  assert(parsed.issues.some((issue) => issue.kind === "citation_needed"));
  assert(parsed.issues.some((issue) => issue.kind === "unresolved_cite" && issue.cite_id === "missing-citation"));
  assert(parsed.issues.some((issue) => issue.kind === "claim_blocker" && issue.claim_id === "missing-source-claim"));

  const report = runEvidence(["evidence", "report", "draft/01-intro.md", "--json"], { cwd: workspace });
  assert.equal(report.status, 0, report.stderr || report.stdout);
  const reportParsed = JSON.parse(report.stdout);
  assert.equal(reportParsed.claims.by_status.supported, 2);
  assert.equal(reportParsed.claims.by_status.unsupported, 1);
  assert.equal(reportParsed.claims.by_source.alpha, 1);
  assert(reportParsed.citations.by_state["resolved-source"] >= 1);
}

function testSourcesAddIsIdempotent() {
  const workspace = path.join(tmp, "sources-add");
  const project = writeProject(workspace);
  const sourcePath = path.join(project, "sources", "reference-note.txt");
  write(sourcePath, "Local source fixture.\n");

  const first = runEvidence(["sources", "add", "sources/reference-note.txt", "--json"], { cwd: workspace });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstParsed = JSON.parse(first.stdout);
  assert.equal(firstParsed.action, "added");
  assert.equal(firstParsed.key, "reference-note");
  assert.equal(firstParsed.path, "sources/reference-note.txt");
  assert.equal(firstParsed.checksum, crypto.createHash("sha256").update("Local source fixture.\n").digest("hex"));

  const second = runEvidence(["sources", "add", "sources/reference-note.txt", "--json"], { cwd: workspace });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const secondParsed = JSON.parse(second.stdout);
  assert.equal(secondParsed.action, "updated");
  assert.equal(secondParsed.key, "reference-note");

  const indexText = fs.readFileSync(path.join(project, "sources", "index.md"), "utf8");
  assert.equal((indexText.match(/^\| `reference-note` /gm) ?? []).length, 1);
  assert(indexText.includes(`sha256:${firstParsed.checksum}`));
}

function writeProject(workspace) {
  const project = path.join(workspace, "manuscript");
  mkdir(path.join(project, "draft"));
  mkdir(path.join(project, "state"));
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
    profileOptions: {},
  });
  write(path.join(project, "brief.md"), "# Brief\n");
  write(path.join(project, "outline.md"), "# Outline\n");
  write(path.join(project, "style.md"), "# Style\n");
  write(
    path.join(project, "sources/index.md"),
    "# Source Index\n\n| Key | Type | Path | Notes |\n|---|---|---|---|\n| `alpha` | notes | `sources/alpha.md` | Fixture source. |\n",
  );
  write(path.join(project, "sources/alpha.md"), "# Alpha\n");
  write(
    path.join(project, "state/claims.md"),
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Notes |\n|---|---|---|---|---|---|---|\n| supported-claim | Supported intro fact | draft/01-intro.md | `alpha` | supported | medium | ok |\n| unsupported-intro | Unsupported intro fact | draft/01-intro.md | | unsupported | high | needs source |\n| missing-source-claim | Supported intro fact with missing source | draft/01-intro.md | `missing-source` | supported | high | bad source |\n| next-review | Review next fact | draft/02-next.md | | needs-review | medium | review |\n| not-needed | Common context | draft/01-intro.md | | not-needed | low | ok |\n| alpha-direct | Direct source backed fact | draft/02-next.md | `alpha` | supported | low | ok |\n",
  );
  write(
    path.join(project, "draft/01-intro.md"),
    `<!--
id: 01-intro
kind: document.section
status: draft
target_words: 20
purpose: Exercise evidence spine.
acceptance:
  - Uses citation markers.
-->
# Intro

This cites a source [cite:alpha] and a supported claim [cite:supported-claim].
This still needs support [citation-needed] and points at a missing marker [cite:missing-citation].
`,
  );
  write(
    path.join(project, "draft/02-next.md"),
    `<!--
id: 02-next
kind: document.section
status: draft
target_words: 20
purpose: Exercise filters.
acceptance:
  - Exists.
-->
# Next

This section cites another registered source [cite:alpha].
`,
  );

  return project;
}

function runEvidence(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/evidence-spine.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
