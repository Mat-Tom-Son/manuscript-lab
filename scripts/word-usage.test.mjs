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

const referenceDir = path.join(testDir, "reference");
const candidateDir = path.join(testDir, "candidate");
fs.mkdirSync(referenceDir, { recursive: true });
fs.mkdirSync(candidateDir, { recursive: true });
fs.writeFileSync(
  path.join(referenceDir, "approved.md"),
  `# Approved

The engineer checked the panel and wrote the totals into the log before lunch.
Nobody hurried. The building kept its own schedule and the work stayed plain.
`,
);
fs.writeFileSync(
  path.join(candidateDir, "generated.md"),
  `# Generated

A flicker of doubt crossed her face. A flicker of light caught the window.
A flicker of memory arrived, then a flicker of resolve followed it out.
`,
);

const contrastRun = run(["contrast", "--reference", referenceDir, "--candidate", candidateDir, "--json", "--min-candidate-count", "3"]);
assert.equal(contrastRun.status, 0, contrastRun.stderr);
const contrastReport = JSON.parse(contrastRun.stdout);
const flickerRow = contrastReport.overrepresented.find((row) => row.term === "flicker of");
assert.ok(flickerRow, "expected 'flicker of' to be overrepresented");
assert.equal(flickerRow.candidate_count, 4);
assert.equal(flickerRow.reference_count, 0);
assert.ok(flickerRow.relative_rate > 3);
assert.equal(flickerRow.candidate_files, 1);

const contrastFail = run(["contrast", "--reference", referenceDir, "--candidate", candidateDir, "--min-candidate-count", "3", "--fail-over", "3"]);
assert.equal(contrastFail.status, 1);
assert.match(contrastFail.stdout, /FAIL/);

const missingArgs = run(["contrast", "--reference", referenceDir]);
assert.equal(missingArgs.status, 1);
assert.match(missingArgs.stderr, /requires at least one --reference and one --candidate/);

const invalidContrastTop = run(["contrast", "--reference", referenceDir, "--candidate", candidateDir, "--top", "0"]);
assert.equal(invalidContrastTop.status, 1);
assert.match(invalidContrastTop.stderr, /--top must be a positive integer/);

const invalidCandidateCount = run([
  "contrast",
  "--reference",
  referenceDir,
  "--candidate",
  candidateDir,
  "--min-candidate-count",
  "1.5",
]);
assert.equal(invalidCandidateCount.status, 1);
assert.match(invalidCandidateCount.stderr, /--min-candidate-count must be a positive integer/);

const workspaceDir = path.join(testDir, "workspace");
fs.mkdirSync(path.join(workspaceDir, "state", "truth"), { recursive: true });
fs.writeFileSync(
  path.join(workspaceDir, "manuscript-lab.config.json"),
  JSON.stringify({ schemaVersion: 1, profile: "generic", root: ".", draftGlob: "draft/*.md", stateDir: "state", exportsDir: "exports" }),
);
fs.writeFileSync(
  path.join(workspaceDir, "state", "truth", "style.json"),
  JSON.stringify(
    {
      style_profile: {
        summary: "",
        protected_strengths: [],
        watch_patterns: [],
        avoid: [],
        register_balance: {},
        pattern_registry: [
          { id: "phrase.flicker_of", label: "flicker of", type: "phrase", pattern: "flicker of", max_count: 1 },
        ],
      },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(workspaceDir, "watched.md"),
  `# Watched

A flicker of doubt. A flicker of light.
`,
);

const registryRun = spawnSync(process.execPath, [path.join(root, "scripts", "word-usage.mjs"), "--registry", "--json", "watched.md"], {
  cwd: workspaceDir,
  encoding: "utf8",
});
assert.equal(registryRun.status, 1, registryRun.stderr);
const registryReport = JSON.parse(registryRun.stdout);
const registryRow = registryReport.files[0].watchlist.find((item) => item.term === "flicker of");
assert.equal(registryRow.count, 2);
assert.equal(registryRow.exceeds_limit, true);

// The canonical registry must also resolve when invoked from a project
// subdirectory.
const wsDraftDir = path.join(workspaceDir, "draft");
fs.mkdirSync(wsDraftDir, { recursive: true });
fs.writeFileSync(path.join(wsDraftDir, "inner.md"), "# Inner\n\nA flicker of one. A flicker of two.\n");
const nestedRegistryRun = spawnSync(process.execPath, [path.join(root, "scripts", "word-usage.mjs"), "--registry", "--json", "inner.md"], {
  cwd: wsDraftDir,
  encoding: "utf8",
});
assert.equal(nestedRegistryRun.status, 1, nestedRegistryRun.stderr);
const nestedRow = JSON.parse(nestedRegistryRun.stdout).files[0].watchlist.find((item) => item.term === "flicker of");
assert.equal(nestedRow.exceeds_limit, true, "registry must load from the project root when run from a subdirectory");

const labContrast = spawnSync(
  process.execPath,
  [path.join(root, "bin", "manuscript-lab.mjs"), "lab", "words", "contrast", "--reference", referenceDir, "--candidate", candidateDir, "--json", "--min-candidate-count", "3"],
  { cwd: root, encoding: "utf8" },
);
assert.equal(labContrast.status, 0, labContrast.stderr);
assert.ok(JSON.parse(labContrast.stdout).overrepresented.some((row) => row.term === "flicker of"), "contrast must be reachable through mlab lab words");

console.log("word-usage tests passed");

function run(args) {
  return spawnSync(process.execPath, ["scripts/word-usage.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
