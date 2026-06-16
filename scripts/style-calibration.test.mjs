#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const testDir = path.join(root, "tmp", "style-calibration-test");
fs.rmSync(testDir, { recursive: true, force: true });
process.on("exit", () => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.rmSync(path.join(root, "state", "style", "style-calibration-test-style-signals.json"), { force: true });
  fs.rmSync(path.join(root, "state", "style", "style-calibration-test-register-map.json"), { force: true });
});
fs.mkdirSync(testDir, { recursive: true });

const sampleFile = path.join(testDir, "sample.md");
fs.writeFileSync(
  sampleFile,
  `<!--
id: style-calibration-test
status: draft
-->
# Sample

The room is not broken, but waiting.

Not triumph. Caution with an edge.

The clean sentence lands.
`,
);

const jsonRun = run(["signals", "--json", sampleFile]);
assert.equal(jsonRun.status, 0, jsonRun.stderr);
const report = JSON.parse(jsonRun.stdout);
assert.equal(report.length, 1);
assert.equal(report[0].counters.not_x_but_y_count, 1);
assert.equal(report[0].counters.not_fragment_reframe_count, 1);

const failingRun = run(["signals", "--max-not-x-but-y", "0", sampleFile]);
assert.equal(failingRun.status, 1);
assert.match(failingRun.stderr, /not_x_but_y_count 1 exceeds 0/);

console.log("style-calibration tests passed");

function run(args) {
  return spawnSync(process.execPath, ["scripts/style-calibration.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
