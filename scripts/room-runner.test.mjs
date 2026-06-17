#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = path.join(repoRoot, "bin/manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-room-"));

try {
  const workspace = path.join(tmp, "workspace");
  mkdir(workspace);

  const init = assertJsonCommand(
    ["init", "--profile", "whitepaper", "--root", "manuscript", "--title", "Room Smoke", "--sections", "1", "--json"],
    { cwd: workspace },
  );
  assert.equal(init.ok, true);

  const manuscriptRoot = path.join(workspace, "manuscript");
  const draftRoot = path.join(manuscriptRoot, "draft");
  const cwdCases = [workspace, manuscriptRoot, draftRoot];

  for (const [index, cwd] of cwdCases.entries()) {
    const target = cwd === draftRoot ? "01-opening.md" : "draft/01-opening.md";
    const runId = `room-smoke-${index + 1}`;
    const blueSky = assertJsonCommand(["room", "blue-sky", target, "--run-id", runId, "--json"], { cwd });
    assert.equal(blueSky.ok, true);
    assert.equal(blueSky.target, "draft/01-opening.md");
    assert.equal(blueSky.section_id, "01-opening");
    assert(blueSky.card_count >= 1);
    assert.equal(blueSky.run_dir, `state/room/01-opening/${runId}`);

    const runDir = path.join(manuscriptRoot, blueSky.run_dir);
    assert(fs.existsSync(path.join(runDir, "manifest.json")));
    assert(fs.existsSync(path.join(runDir, "room-packet.json")));
    assert(fs.existsSync(path.join(runDir, "visible-files.json")));
    assert(fs.existsSync(path.join(runDir, "role-casts.json")));
    assert(fs.existsSync(path.join(runDir, "idea-cards.jsonl")));
    assert(fs.existsSync(path.join(runDir, "clusters.json")));
    assert(fs.existsSync(path.join(runDir, "stress-tests.json")));

    const breakBeforeDecision = runMlab(["room", "break", target, "--run", runId, "--json"], { cwd });
    assert.equal(breakBeforeDecision.status, 1, breakBeforeDecision.stderr || breakBeforeDecision.stdout);
    assert.match(breakBeforeDecision.stdout, /requires selected idea cards/);

    const decision = assertJsonCommand(
      ["room", "decide", target, "--run", runId, "--select", "idea-001", "--reason", "Exercise explicit showrunner decision.", "--json"],
      { cwd },
    );
    assert.deepEqual(decision.selected, ["idea-001"]);
    assert(fs.existsSync(path.join(runDir, "decision.json")));

    const beatBoard = assertJsonCommand(["room", "break", target, "--run", runId, "--json"], { cwd });
    assert.equal(beatBoard.ok, true);
    assert.equal(beatBoard.beat_count, 1);
    assert.equal(beatBoard.files.json, `state/room/01-opening/${runId}/output/beat-board.json`);
    assert(fs.existsSync(path.join(runDir, "output", "beat-board.md")));

    const packet = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    assert.equal(packet.status, "materialized");
    assert.equal(packet.beat_count, 1);
  }

  const mockResponseFile = path.join(manuscriptRoot, "state/room/mock-room-response.json");
  writeJson(mockResponseFile, {
    summary: "Mock room role generated a card.",
    cards: [
      {
        type: "pressure",
        pitch: "Make the section choose between clarity and momentum before drafting.",
        reader_effect: "The reader can feel a turn rather than a status report.",
        pressure: "The beat must move the document instead of explaining the document.",
        exit_state: "The section has one visible turn to draft toward.",
        risks: ["The idea may overfit the smoke fixture."],
        depends_on: ["section contract"],
      },
    ],
    questions_for_showrunner: ["Which turn should the section own?"],
    risks: ["Mock-only risk."],
  });

  const mockRun = assertJsonCommand(
    [
      "room",
      "blue-sky",
      "01-opening.md",
      "--run-id",
      "room-mock",
      "--roles",
      "story_engine,reader_advocate",
      "--models",
      "lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus",
      "--mock-response",
      "state/room/mock-room-response.json",
      "--json",
    ],
    { cwd: draftRoot },
  );
  assert.equal(mockRun.ok, true);
  assert.equal(mockRun.card_count, 2);
  const roleCasts = JSON.parse(fs.readFileSync(path.join(manuscriptRoot, mockRun.run_dir, "role-casts.json"), "utf8"));
  assert.deepEqual(
    roleCasts.roles.map((role) => role.model),
    ["lightning:lightning-ai/gpt-oss-120b", "openrouter:qwen/qwen3.7-plus"],
  );

  const tableRead = assertJsonCommand(["room", "table-read", "01-opening.md", "--run-id", "table-read-smoke", "--json"], { cwd: draftRoot });
  assert.equal(tableRead.ok, true);
  assert.equal(tableRead.review_command, "mlab review:run --passes room.table_read draft/01-opening.md");
  assert(fs.existsSync(path.join(manuscriptRoot, "state/room/01-opening/table-read-smoke/output/table-read-checklist.md")));

  const report = assertJsonCommand(["room", "report", "01-opening.md", "--json"], { cwd: draftRoot });
  assert.equal(report.ok, true);
  assert.equal(report.target, "draft/01-opening.md");
  assert(report.run_count >= 5);

  assert.equal(fs.existsSync(path.join(workspace, "state")), false, "room should not write state at workspace root");
  assert.equal(fs.existsSync(path.join(draftRoot, "state")), false, "room should not write state under draft/");

  console.log("room runner tests passed");
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
