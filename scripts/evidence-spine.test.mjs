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
  testEmptyCitationMarkersBlock();
  testDefaultScopeSkipsTodoSections();
  testMissingLocalSourceFileSeverity();
  testRiskAwareUnsupportedClaims();
  testSourceManifestValidationAndResolution();
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
  assert.equal(parsed.claims[0].kind, "factual");
  assert.equal(parsed.claims[0].severity, "blocking");
  assert(parsed.requirements.some((requirement) => requirement.id === "evidence.claims.no_blocking_claims" && requirement.status === "fail"));

  const supported = runEvidence(["claims", "list", "--status", "supported", "--json"], { cwd: workspace });
  assert.equal(supported.status, 0, supported.stderr || supported.stdout);
  const supportedParsed = JSON.parse(supported.stdout);
  assert.equal(supportedParsed.count, 3);

  const byKind = runEvidence(["claims", "list", "--unsupported", "--kind", "factual", "--section", "draft/01-intro.md", "--json"], { cwd: workspace });
  assert.equal(byKind.status, 0, byKind.stderr || byKind.stdout);
  assert.equal(JSON.parse(byKind.stdout).count, 2);
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
  assert(parsed.markers.some((marker) => marker.id === "supported-claim" && marker.resolution?.type === "claim"));
  assert(parsed.issues.some((issue) => issue.kind === "citation_needed"));
  assert(parsed.issues.some((issue) => issue.kind === "unresolved_cite" && issue.cite_id === "missing-citation"));
  assert(parsed.issues.some((issue) => issue.kind === "claim_source_unregistered" && issue.claim_id === "missing-source-claim"));
  assert(parsed.requirements.some((requirement) => requirement.id === "evidence.citations.resolve_markers" && requirement.status === "fail"));

  const report = runEvidence(["evidence", "report", "draft/01-intro.md", "--json"], { cwd: workspace });
  assert.equal(report.status, 0, report.stderr || report.stdout);
  const reportParsed = JSON.parse(report.stdout);
  assert.equal(reportParsed.claims.by_status.supported, 2);
  assert.equal(reportParsed.claims.by_status.unsupported, 1);
  assert.equal(reportParsed.claims.by_kind.factual, 3);
  assert.equal(reportParsed.claims.by_source.alpha, 1);
  assert(reportParsed.citations.by_state["resolved-source"] >= 1);
  assert(reportParsed.issue_counts.by_requirement["evidence.claims.no_blocking_claims"] >= 1);
}

function testEmptyCitationMarkersBlock() {
  const workspace = path.join(tmp, "empty-markers");
  const project = writeProject(workspace);
  write(
    path.join(project, "state/claims.md"),
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Kind | Notes |\n|---|---|---|---|---|---|---|---|\n| supported-claim | Supported intro fact | draft/02-next.md | `alpha` | supported | medium | factual | p. 1 |\n",
  );
  write(
    path.join(project, "draft/01-intro.md"),
    `<!--
id: 01-intro
kind: document.section
status: draft
target_words: 20
purpose: Exercise empty citation markers.
acceptance:
  - Uses citation markers.
-->
# Intro

An empty cite marker [cite: ] waits for a key.
Another empty marker [cite:] sits on its own line.
A spaced but valid cite [cite: alpha] must still resolve.
`,
  );

  const check = runEvidence(["citations", "check", "draft/01-intro.md", "--json", "--gate"], { cwd: workspace });
  assert.equal(check.status, 1);
  const parsed = JSON.parse(check.stdout);
  assert.equal(parsed.ok, false);
  const empties = parsed.issues.filter((issue) => issue.kind === "empty_citation_marker");
  assert.equal(empties.length, 2, JSON.stringify(parsed.issues, null, 2));
  assert(empties.every((issue) => issue.severity === "blocking" && issue.requirement_id === "evidence.citations.resolve_markers"));
  assert(parsed.markers.some((marker) => marker.id === "alpha" && marker.state === "resolved-source"), "spaced [cite: alpha] should resolve");
  assert(parsed.requirements.some((requirement) => requirement.id === "evidence.citations.resolve_markers" && requirement.status === "fail"));

  const gate = runGate(["citations", "--json"], { cwd: workspace });
  assert.equal(gate.status, 1, gate.stderr || gate.stdout);
  const gateParsed = JSON.parse(gate.stdout);
  assert.equal(gateParsed.ready, false);
  assert.equal(gateParsed.status, "fail");
  const resolveMarkers = gateParsed.requirements.find((requirement) => requirement.id === "evidence.citations.resolve_markers");
  assert(resolveMarkers, "gate should report evidence.citations.resolve_markers");
  assert.equal(resolveMarkers.status, "fail");
}

function testDefaultScopeSkipsTodoSections() {
  const workspace = path.join(tmp, "default-scope");
  const project = writeProject(workspace);
  // Move the marker-heavy intro section back to todo; the default scope is
  // active (non-todo) sections, matching the readiness gates.
  write(
    path.join(project, "draft/01-intro.md"),
    `<!--
id: 01-intro
kind: document.section
status: todo
target_words: 20
purpose: Exercise evidence spine.
acceptance:
  - Uses citation markers.
-->
# Intro

This still needs support [citation-needed] once drafting starts.
`,
  );

  const check = runEvidence(["citations", "check", "--json"], { cwd: workspace });
  const parsed = JSON.parse(check.stdout);
  assert.equal(parsed.target, "active drafts");
  assert.deepEqual(parsed.files, ["draft/02-next.md"]);
  assert.equal(parsed.counts.citation_needed, 0);
  assert(!parsed.issues.some((issue) => issue.kind === "citation_needed"));
}

function testMissingLocalSourceFileSeverity() {
  const workspace = path.join(tmp, "source-file-missing");
  const project = writeProject(workspace);
  write(
    path.join(project, "sources/index.md"),
    "# Source Index\n\n| Key | Type | Path | Status | Notes |\n|---|---|---|---|---|\n| `alpha` | notes | `sources/alpha.md` | usable | Fixture source. |\n| `ghost` | notes | `sources/missing-note.md` | usable | File was never added. |\n",
  );
  write(
    path.join(project, "state/claims.md"),
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Kind | Notes |\n|---|---|---|---|---|---|---|---|\n| supported-claim | Supported intro fact | draft/02-next.md | `alpha` | supported | medium | factual | p. 1 |\n",
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

Clean prose citing a registered source [cite:alpha].
`,
  );

  // A path-like location that does not resolve to a local file blocks, matching
  // the 1.x citation-gate guarantee.
  const check = runEvidence(["citations", "check", "--json", "--gate"], { cwd: workspace });
  assert.equal(check.status, 1, check.stderr || check.stdout);
  const parsed = JSON.parse(check.stdout);
  assert.equal(parsed.ok, false);
  const blocker = parsed.issues.find((issue) => issue.kind === "source_file_missing");
  assert(blocker, "expected a source_file_missing issue");
  assert.equal(blocker.severity, "blocking");
  assert.equal(blocker.source, "ghost");
  assert(parsed.requirements.some((requirement) => requirement.id === "evidence.sources.manifest_valid" && requirement.status === "fail"));

  // Prose-y descriptive locations were never resolvable paths; they still warn.
  write(
    path.join(project, "sources/index.md"),
    "# Source Index\n\n| Key | Type | Path | Status | Notes |\n|---|---|---|---|---|\n| `alpha` | notes | `sources/alpha.md` | usable | Fixture source. |\n| `shelf` | book | `office shelf, second edition` | usable | Physical copy. |\n",
  );
  const proseCheck = runEvidence(["citations", "check", "--json", "--gate"], { cwd: workspace });
  assert.equal(proseCheck.status, 0, proseCheck.stderr || proseCheck.stdout);
  const proseParsed = JSON.parse(proseCheck.stdout);
  assert.equal(proseParsed.ok, true);
  const warning = proseParsed.issues.find((issue) => issue.kind === "source_file_missing");
  assert(warning, "expected a source_file_missing warning");
  assert.equal(warning.severity, "warning");
  assert.equal(warning.source, "shelf");
  assert(proseParsed.requirements.some((requirement) => requirement.id === "evidence.sources.manifest_valid" && requirement.status === "warn"));
}

function testRiskAwareUnsupportedClaims() {
  const workspace = path.join(tmp, "risk-aware");
  const project = writeProject(workspace);
  write(
    path.join(project, "state/claims.md"),
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Kind | Notes |\n|---|---|---|---|---|---|---|---|\n| low-risk | Low stakes unsupported fact | draft/01-intro.md | | unsupported | low | factual | triage later |\n| high-risk | High stakes unsupported fact | draft/01-intro.md | | unsupported | high | factual | blocks release |\n",
  );

  const all = runEvidence(["claims", "list", "--unsupported", "--json", "--gate"], { cwd: workspace });
  assert.equal(all.status, 1);
  const allParsed = JSON.parse(all.stdout);
  assert.equal(allParsed.count, 2);
  assert.equal(allParsed.blocker_count, 1);
  assert.equal(allParsed.warning_count, 1);
  assert.equal(allParsed.claims.find((claim) => claim.id === "low-risk").severity, "warning");
  assert.equal(allParsed.claims.find((claim) => claim.id === "high-risk").severity, "blocking");

  const lowOnly = runEvidence(["claims", "list", "--unsupported", "--risk", "low", "--json", "--gate"], { cwd: workspace });
  assert.equal(lowOnly.status, 0, lowOnly.stderr || lowOnly.stdout);
  const lowParsed = JSON.parse(lowOnly.stdout);
  assert.equal(lowParsed.count, 1);
  assert.equal(lowParsed.blocker_count, 0);
  assert.equal(lowParsed.claims[0].id, "low-risk");

  write(
    path.join(project, "state/claims.md"),
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Kind | Citation | Notes |\n|---|---|---|---|---|---|---|---|---|\n| cite-missing | Supported fact with missing citation | draft/01-intro.md | `alpha` | supported | high | factual | missing | source exists |\n",
  );
  const citationState = runEvidence(["claims", "list", "--status", "supported", "--json"], { cwd: workspace });
  assert.equal(citationState.status, 0, citationState.stderr || citationState.stdout);
  const citationParsed = JSON.parse(citationState.stdout);
  assert.equal(citationParsed.count, 1);
  assert.equal(citationParsed.claims[0].citation.status, "missing");
  assert(citationParsed.issues.some((issue) => issue.kind === "claim_citation_missing" && issue.claim_id === "cite-missing"));
}

function testSourceManifestValidationAndResolution() {
  const workspace = path.join(tmp, "source-validation");
  const project = writeProject(workspace);
  write(
    path.join(project, "sources/index.md"),
    "# Source Index\n\n| Key | Type | Title | Location | Accessed | Status | Citation | Notes |\n|---|---|---|---|---|---|---|---|\n| `alpha` | notes | Alpha Notes | `sources/alpha.md` | 2026-06-16 | usable | Alpha Notes. | Fixture. |\n| `beta` | notes | Beta Notes | `sources/beta.md` | 2026-06-16 | needs-review | Beta Notes. | Review. |\n| `gamma` | notes | Gamma Notes | `sources/gamma.md` | 2026-06-16 | rejected | Gamma Notes. | Rejected. |\n| `delta` | notes | Delta Notes | `sources/delta.md` | 2026-06-16 | usable | | Missing bibliography. |\n| `dupe` | notes | First Dupe | `sources/dupe-a.md` | 2026-06-16 | usable | First Dupe. | Duplicate. |\n| `dupe` | notes | Second Dupe | `sources/dupe-b.md` | 2026-06-16 | usable | Second Dupe. | Duplicate. |\n\n- legacy-key: Legacy source note.\n",
  );
  write(path.join(project, "sources/beta.md"), "# Beta\n");
  write(path.join(project, "sources/gamma.md"), "# Gamma\n");
  write(path.join(project, "sources/delta.md"), "# Delta\n");
  write(path.join(project, "sources/dupe-a.md"), "# Dupe A\n");
  write(path.join(project, "sources/dupe-b.md"), "# Dupe B\n");
  write(
    path.join(project, "state/claims.md"),
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Kind | Notes |\n|---|---|---|---|---|---|---|---|\n| supported-claim | Supported intro fact | draft/01-intro.md | `alpha` | supported | medium | factual | p. 1 |\n",
  );
  write(
    path.join(project, "draft/01-intro.md"),
    `<!--
id: 01-intro
kind: document.section
status: draft
target_words: 20
purpose: Exercise source validation.
acceptance:
  - Uses source statuses.
-->
# Intro

Good source [cite:alpha], review source [cite:beta], rejected source [cite:gamma],
missing bibliography [cite:delta], duplicate key [cite:dupe], and legacy key [cite:legacy-key].
`,
  );

  const check = runEvidence(["citations", "check", "draft/01-intro.md", "--json", "--gate"], { cwd: workspace });
  assert.equal(check.status, 1);
  const parsed = JSON.parse(check.stdout);
  assert(parsed.markers.some((marker) => marker.id === "alpha" && marker.resolution?.status === "usable"));
  assert(parsed.issues.some((issue) => issue.kind === "source_needs_review" && issue.source === "beta" && issue.severity === "warning"));
  assert(parsed.issues.some((issue) => issue.kind === "unusable_source" && issue.source === "gamma" && issue.severity === "blocking"));
  assert(parsed.issues.some((issue) => issue.kind === "missing_bibliography" && issue.source === "delta"));
  assert(parsed.issues.some((issue) => issue.kind === "source_key_duplicate" && issue.source === "dupe"));
  assert(parsed.issues.some((issue) => issue.kind === "source_legacy_metadata" && issue.source === "legacy-key"));
  assert(parsed.requirements.some((requirement) => requirement.id === "evidence.sources.cited_usable" && requirement.status === "fail"));
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
    "# Claims\n\n| ID | Claim | Section | Source | Status | Risk | Kind | Notes |\n|---|---|---|---|---|---|---|---|\n| supported-claim | Supported intro fact | draft/01-intro.md | `alpha` | supported | medium | factual | ok |\n| unsupported-intro | Unsupported intro fact | draft/01-intro.md | | unsupported | high | factual | needs source |\n| missing-source-claim | Supported intro fact with missing source | draft/01-intro.md | `missing-source` | supported | high | factual | bad source |\n| next-review | Review next fact | draft/02-next.md | | needs-review | medium | factual | review |\n| not-needed | Common context | draft/01-intro.md | | not-needed | low | interpretive | ok |\n| alpha-direct | Direct source backed fact | draft/02-next.md | `alpha` | supported | low | factual | ok |\n",
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

function runGate(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/gate.mjs"), ...args], {
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
