#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = path.join(repoRoot, "bin/manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-chorus-"));

try {
  const workspace = path.join(tmp, "workspace");
  mkdir(workspace);

  const init = assertJsonCommand(
    ["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "Chorus Smoke", "--sections", "1", "--json"],
    { cwd: workspace },
  );
  assert.equal(init.ok, true);

  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");

  const roomRunId = "chorus-room-bridge";
  const roomBlueSky = assertJsonCommand(["room", "blue-sky", "draft/01-opening.md", "--run-id", roomRunId, "--json"], { cwd: workspace });
  assert.equal(roomBlueSky.ok, true);
  assertJsonCommand(["room", "decide", "draft/01-opening.md", "--run", roomRunId, "--select", "idea-001", "--reason", "Bridge into Chorus.", "--json"], { cwd: workspace });
  const roomBreak = assertJsonCommand(["room", "break", "draft/01-opening.md", "--run", roomRunId, "--json"], { cwd: workspace });
  assert.equal(roomBreak.beat_count, 1);

  const bridged = assertJsonCommand(["chorus", "plan", "draft/01-opening.md", "--run-id", "chorus-from-room", "--from-room", roomRunId, "--json"], { cwd: workspace });
  assert.equal(bridged.ok, true);
  assert.equal(bridged.beat_count, 1);
  assert.match(bridged.plan_quality, /line-lab ready|plan warning/);
  const bridgedPlan = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, bridged.run_dir, "beat-plan.json"), "utf8"));
  assert.equal(bridgedPlan.source.type, "room");
  assert.equal(bridgedPlan.source.run_id, roomRunId);
  assert.equal(bridgedPlan.beats[0].source_room_beat_id, "beat-001");
  assert(bridgedPlan.beats[0].sensory_targets.length > 0, "room bridge should carry sensory/object targets");
  assert(fs.existsSync(path.join(manuscriptRoot, bridged.run_dir, "plan-quality.json")));

  const cwdCases = [workspace, manuscriptRoot, draftRoot];
  for (const [index, cwd] of cwdCases.entries()) {
    const target = cwd === draftRoot ? "01-opening.md" : "draft/01-opening.md";
    const runId = `chorus-smoke-${index + 1}`;
    const result = assertJsonCommand(["chorus", "run", target, "--run-id", runId, "--beats", "2", "--json"], { cwd });
    assert.equal(result.ok, true);
    assert.equal(result.target, "draft/01-opening.md");
    assert.equal(result.run_dir, `state/chorus/01-opening/${runId}`);
    assert.equal(result.beat_count, 2);
    assert.equal(result.candidate_count, 2);
    assert.equal(result.committed_beat_count, 0);
    assert.equal(result.contact_sheet_file, `state/chorus/01-opening/${runId}/CONTACT_SHEET.md`);
    assert.equal(result.assembled_file, "");

    const runDir = path.join(manuscriptRoot, result.run_dir);
    assert(fs.existsSync(path.join(runDir, "manifest.json")));
    assert(fs.existsSync(path.join(runDir, "voice-pack.json")));
    assert(fs.existsSync(path.join(runDir, "roster.json")));
    assert(fs.existsSync(path.join(runDir, "beat-plan.json")));
    assert(fs.existsSync(path.join(runDir, "plan-quality.json")));
    assert(fs.existsSync(path.join(runDir, "specs", "beat-001.json")));
    assert(fs.existsSync(path.join(runDir, "candidates", "beat-001", "candidate-a.md")));
    assert(fs.existsSync(path.join(runDir, "candidates", "beat-001", "contact-sheet.md")));
    assert.equal(fs.existsSync(path.join(runDir, "judgments", "beat-001.json")), false);
    assert.equal(fs.existsSync(path.join(runDir, "commits", "beat-001.md")), false);
    assert.equal(fs.existsSync(path.join(runDir, "assembled.md")), false);
    assert(fs.existsSync(path.join(runDir, "CONTACT_SHEET.md")));
    assert(fs.existsSync(path.join(runDir, "metrics.json")));
    assert(fs.existsSync(path.join(runDir, "CHORUS_REPORT.md")));

    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    assert.equal(manifest.status, "sampled");
    assert.equal(manifest.contact_sheet_file, `state/chorus/01-opening/${runId}/CONTACT_SHEET.md`);
    assert.equal(manifest.target.source_sha256.length, 64);
  }

  const assembled = assertJsonCommand(["chorus", "run", "draft/01-opening.md", "--run-id", "chorus-assemble", "--beats", "1", "--assemble", "--json"], { cwd: workspace });
  assert.equal(assembled.ok, true);
  assert.equal(assembled.committed_beat_count, 1);
  assert.equal(assembled.assembled_file, "state/chorus/01-opening/chorus-assemble/assembled.md");
  const assembledRunDir = path.join(manuscriptRoot, assembled.run_dir);
  assert(fs.existsSync(path.join(assembledRunDir, "judgments", "beat-001.json")));
  assert(fs.existsSync(path.join(assembledRunDir, "commits", "beat-001.md")));
  assert(fs.existsSync(path.join(assembledRunDir, "assembled.md")));

  const mockResponseRel = "state/chorus/mock-candidate-response.json";
  writeJson(path.join(manuscriptRoot, mockResponseRel), {
    candidate_markdown: "The mock beat arrives with a clean pressure point. It does not ask to become the whole section. It leaves the next sentence holding a little more weight.",
    summary: "Mock ensemble candidate.",
    protect: ["clean pressure point"],
    risks: ["mocked candidate"],
  });

  const mock = assertJsonCommand(
    [
      "chorus",
      "run",
      "01-opening.md",
      "--run-id",
      "chorus-mock",
      "--beats",
      "1",
      "--models",
      "lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus",
      "--mock-response",
      mockResponseRel,
      "--json",
    ],
    { cwd: draftRoot },
  );
  assert.equal(mock.ok, true);
  assert.equal(mock.candidate_count, 2);
  assert.equal(mock.committed_beat_count, 0);
  assert(fs.existsSync(path.join(manuscriptRoot, mock.contact_sheet_file)));
  const mockRunDir = path.join(manuscriptRoot, mock.run_dir);
  const roster = JSON.parse(fs.readFileSync(path.join(mockRunDir, "roster.json"), "utf8"));
  assert.deepEqual(
    roster.members.map((member) => member.model),
    ["lightning:lightning-ai/gpt-oss-120b", "openrouter:qwen/qwen3.7-plus"],
  );
  const report = assertJsonCommand(["chorus", "report", "01-opening.md", "--json"], { cwd: draftRoot });
  assert.equal(report.ok, true);
  assert.equal(report.target, "draft/01-opening.md");
  assert(report.run_count >= 5);

  assert.equal(fs.existsSync(path.join(workspace, "state")), false, "chorus should not write state at workspace root");
  assert.equal(fs.existsSync(path.join(draftRoot, "state")), false, "chorus should not write state under draft/");

  console.log("chorus runner tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function assertJsonCommand(args, options) {
  const result = runMlab(args, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runMlab(args, { cwd }) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
