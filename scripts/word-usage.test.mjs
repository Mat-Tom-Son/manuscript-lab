#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const testDir = path.join(root, "tmp", "word-usage-test");
fs.rmSync(testDir, { recursive: true, force: true });
process.on("exit", () => fs.rmSync(testDir, { recursive: true, force: true }));
fs.mkdirSync(path.join(testDir, "nested"), { recursive: true });

const sampleFile = path.join(testDir, "sample.md");
fs.writeFileSync(
  sampleFile,
  `---
title: transition
---
<!--
id: sample
notes: transition transition
-->
# Sample

Transition needs a bridge. Transition needs a handoff.

The signal repeats; the signal repeats; signal repeats.

\`transition\` should not count.
<!-- transition hidden -->
`,
);

const nestedFile = path.join(testDir, "nested", "extra.md");
fs.writeFileSync(
  nestedFile,
  `# Extra

Signal carries signal. Transition stays visible.
`,
);
fs.writeFileSync(path.join(testDir, "nested", "ignore.txt"), "signal signal signal");

const jsonRun = run(["--json", "--watch", "transition,signal", "--min-count", "2", sampleFile]);
assert.equal(jsonRun.status, 0, jsonRun.stderr);
const report = JSON.parse(jsonRun.stdout);
assert.equal(report.files.length, 1);
assert.equal(report.files[0].watchlist.find((item) => item.term === "transition").count, 2);
assert.equal(report.files[0].watchlist.find((item) => item.term === "signal").count, 3);
assert.equal(report.files[0].top_repeated_non_stopwords.find((item) => item.term === "signal").count, 3);
assert.equal(report.files[0].top_repeated_non_stopwords.find((item) => item.term === "repeats").count, 3);
assert.equal(report.files[0].top_repeated_non_stopwords.some((item) => item.term === "the"), false);

const dirRun = run(["--json", "--watch", "transition", testDir]);
assert.equal(dirRun.status, 0, dirRun.stderr);
const dirReport = JSON.parse(dirRun.stdout);
assert.equal(dirReport.corpus.file_count, 2);
assert.equal(dirReport.corpus.watchlist.find((item) => item.term === "transition").count, 3);

const failingRun = run(["--watch", "transition", "--max-watch-count", "1", sampleFile]);
assert.equal(failingRun.status, 1);
assert.match(failingRun.stdout, /FAIL transition: 2/);

console.log("word-usage tests passed");

function run(args) {
  return spawnSync(process.execPath, ["scripts/word-usage.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
