#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const fixtureRoot = path.join(root, "tmp", `taste-arbiter-test-${Date.now()}`);
const targetRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "draft", "01-test.md")));
const candidatesRootRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "candidates")));
const runDirRel = normalizeRel(path.join(candidatesRootRel, "01-test", "run-001"));
const tasteRootRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "taste")));
const mockPassRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "mock-pass.json")));
const mockBlockRel = normalizeRel(path.relative(root, path.join(fixtureRoot, "mock-block.json")));
const mirrorDir = path.join(root, "state", "taste", "arbiter", "01-test");

try {
  setupFixture();
  testDryRun();
  testPassWithDebt();
  testMergeBlocksOnTasteGate();
  console.log("taste-arbiter tests passed");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(mirrorDir, { recursive: true, force: true });
}

function setupFixture() {
  mkdir(path.dirname(abs(targetRel)));
  mkdir(abs(runDirRel));
  mkdir(abs(tasteRootRel));

  write(
    targetRel,
    `<!--
id: 01-test
kind: fiction.chapter
stage: revision
status: draft
purpose: Test the taste arbiter.
acceptance:
  - Preserve subtext.
reviews:
  - narrative.taste
-->
# Test

Mara set the key on the table. "I found nothing," she said.
`,
  );

  write(path.join(tasteRootRel, "TASTE.md"), "# Taste Doctrine\n\nPrefer subtext over direct confession.\n");
  write(path.join(tasteRootRel, "VOICE.md"), "# Voice Profile\n\nRestrained, concrete, no explained feelings.\n");
  write(path.join(tasteRootRel, "TARGET_READER.md"), "# Target Reader\n\nTrusts inference.\n");
  write(path.join(tasteRootRel, "GENRE_PROMISE.md"), "# Genre Promise\n\nDomestic unease.\n");
  write(path.join(tasteRootRel, "FAILURE_MODES.md"), "# Failure Modes\n\nDo not announce lies.\n");
  write(path.join(tasteRootRel, "MOTIFS.md"), "# Motifs\n\nKeys carry concealed choice.\n");
  write(path.join(tasteRootRel, "EXEMPLARS.md"), "# Taste Exemplars\n\nNo exemplars yet.\n");

  const base = read(abs(targetRel));
  const sourceSha256 = sha256(base);
  const candidateA = base.replace('"I found nothing," she said.', '"It was already open," she said.');
  const candidateB = base.replace('"I found nothing," she said.', '"I am lying because I am frightened," she said.');

  write(path.join(runDirRel, "base.md"), base);
  write(path.join(runDirRel, "candidate-a.md"), candidateA);
  write(path.join(runDirRel, "candidate-b.md"), candidateB);
  writeJson(path.join(runDirRel, "manifest.json"), {
    version: 1,
    run_id: "run-001",
    target: targetRel,
    section_id: "01-test",
    source_sha256: sourceSha256,
  });
  writeJson(path.join(runDirRel, "candidate-meta.json"), {
    version: 1,
    run_id: "run-001",
    target: targetRel,
    section_id: "01-test",
    source_sha256: sourceSha256,
    candidates: [
      { candidate_id: "candidate-a", model: "mock-a", file: normalizeRel(path.join(runDirRel, "candidate-a.md")) },
      { candidate_id: "candidate-b", model: "mock-b", file: normalizeRel(path.join(runDirRel, "candidate-b.md")) },
    ],
  });
  writeJson(path.join(runDirRel, "issue-context.json"), {
    version: 1,
    issue_ids: ["issue_test_001"],
    issues: [
      {
        id: "issue_test_001",
        status: "accepted",
        category: "style",
        claim: "The revision should preserve subtext.",
      },
    ],
  });
  writeJson(path.join(runDirRel, "decision.json"), {
    version: 1,
    decision: "winner_selected",
    winner: "candidate-a",
    confidence: "high",
    recommended_action: "apply_winner",
  });
  writeJson(path.join(runDirRel, "criteria.json"), {
    version: 1,
    criteria: [{ id: "taste_effect", question: "Does the section preserve subtext?" }],
  });
  write(path.join(runDirRel, "rule-stack.yaml"), "version: 1\n");

  writeJson(mockPassRel, {
    disposition: "pass_with_debt",
    confidence: "high",
    candidate_id: "candidate-a",
    rationale: "The candidate keeps the lie oblique.",
    reader_effect: "Reader has something to infer.",
    voice_integrity: "Restrained and concrete.",
    section_effect: "Maintains domestic unease.",
    future_story_debt: ["Track key motif carefully."],
    blocking_reasons: [],
    required_patch: "",
    protected_strengths: ["It was already open."],
    exemplar_recommendation: { should_record: true, reason: "Useful subtext repair.", tags: ["subtext"] },
  });
  writeJson(mockBlockRel, {
    disposition: "block",
    confidence: "high",
    candidate_id: "candidate-a",
    rationale: "The patch explains what should remain inferred.",
    reader_effect: "Reader inference collapses.",
    voice_integrity: "Too explicit.",
    section_effect: "Fails the accepted issue.",
    future_story_debt: ["Makes Mara too legible too early."],
    blocking_reasons: ["Names the subtext."],
    required_patch: "",
    protected_strengths: [],
    exemplar_recommendation: { should_record: true, reason: "Useful rejected example.", tags: ["subtext"] },
  });
}

function testDryRun() {
  const result = run(["scripts/taste-arbiter.mjs", targetRel, "--run", "run-001", "--out", candidatesRootRel, "--taste-root", tasteRootRel, "--dry-run", "--json"]);
  assert(result.status === 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert(parsed.selected_candidate === "candidate-a", "dry run should resolve selected candidate");
  assert(parsed.taste_files.length === 7, "dry run should see taste files");
}

function testPassWithDebt() {
  const result = run([
    "scripts/taste-arbiter.mjs",
    targetRel,
    "--run",
    "run-001",
    "--out",
    candidatesRootRel,
    "--taste-root",
    tasteRootRel,
    "--mock-response",
    mockPassRel,
    "--models",
    "openrouter:z-ai/glm-5.2",
    "--json",
  ]);
  assert(result.status === 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert(parsed.gate.disposition === "pass_with_debt", "expected pass_with_debt");
  assert(parsed.gate.can_apply === true, "pass_with_debt should allow apply");
  assert(fs.existsSync(abs(path.join(runDirRel, "taste-arbiter.json"))), "arbiter result should be written");
}

function testMergeBlocksOnTasteGate() {
  const block = run([
    "scripts/taste-arbiter.mjs",
    targetRel,
    "--run",
    "run-001",
    "--out",
    candidatesRootRel,
    "--taste-root",
    tasteRootRel,
    "--mock-response",
    mockBlockRel,
    "--models",
    "openrouter:z-ai/glm-5.2",
  ]);
  assert(block.status === 2, "blocking gate should exit with status 2");

  const blockedMerge = run(["scripts/merge-winner.mjs", targetRel, "--run", "run-001", "--out", candidatesRootRel, "--apply"]);
  assert(blockedMerge.status !== 0, "merge apply should stop on blocking taste gate");
  assert(/Taste arbiter gate/.test(blockedMerge.stderr), "merge failure should name taste gate");

  const forcedMerge = run(["scripts/merge-winner.mjs", targetRel, "--run", "run-001", "--out", candidatesRootRel, "--apply", "--force"]);
  assert(forcedMerge.status === 0, forcedMerge.stderr || forcedMerge.stdout);
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(file, value) {
  const full = abs(file);
  mkdir(path.dirname(full));
  fs.writeFileSync(full, value, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
