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
        watch_patterns: ["repeated rhetorical structures"],
        avoid: [],
        register_balance: {},
        pattern_registry: [
          {
            id: "phrase.quantum_drift",
            label: "quantum drift tic",
            type: "phrase",
            pattern: "quantum drift",
            max_count: 1,
            cluster: { max_occurrences: 1, window_paragraphs: 3 },
          },
          { id: "rhetoric.not_x_but_y", disabled: true },
        ],
        registers: [
          {
            key: "bureaucratic_dread",
            label: "bureaucratic dread",
            rules: [{ kind: "regex", pattern: "(committee|form 27-b|subclause)", flags: "i", score: 2 }],
          },
        ],
      },
    },
    null,
    2,
  ),
);
const workspaceSection = path.join(workspaceDir, "custom.md");
fs.writeFileSync(
  workspaceSection,
  `<!--
id: custom-section
status: draft
-->
# Custom

The committee reviewed subclause nine. Quantum drift settled over the room, and quantum drift stayed.

The room is not broken, but waiting.
`,
);

const overrideRun = spawnSync(process.execPath, [path.join(root, "scripts", "style-calibration.mjs"), "signals", "--json", "custom.md"], {
  cwd: workspaceDir,
  encoding: "utf8",
});
assert.equal(overrideRun.status, 0, overrideRun.stderr);
const overrideReport = JSON.parse(overrideRun.stdout);
assert.equal(overrideReport[0].counters.not_x_but_y_count, undefined);
const signalsJson = JSON.parse(fs.readFileSync(path.join(workspaceDir, "state", "style", "custom-section-style-signals.json"), "utf8"));
assert.equal(signalsJson.pattern_counts["phrase.quantum_drift"].count, 2);
assert.equal(signalsJson.pattern_counts["rhetoric.not_x_but_y"], undefined);
const registerMapJson = JSON.parse(fs.readFileSync(path.join(workspaceDir, "state", "style", "custom-section-register-map.json"), "utf8"));
assert.ok("bureaucratic_dread" in registerMapJson.register_map[0].scores);
assert.equal(registerMapJson.register_map[0].dominant_register, "bureaucratic dread");

const enforceRun = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "style-calibration.mjs"), "signals", "--enforce", "custom.md"],
  { cwd: workspaceDir, encoding: "utf8" },
);
assert.equal(enforceRun.status, 1);
assert.match(enforceRun.stderr, /phrase\.quantum_drift count 2 exceeds max_count 1/);
assert.match(
  enforceRun.stderr,
  /phrase\.quantum_drift appears 2x within 2 consecutive paragraphs \(max 1 in a 3-paragraph window\)/,
  "cluster limits must still apply when the document is shorter than the configured window",
);

const watchlistRun = spawnSync(process.execPath, [path.join(root, "scripts", "style-calibration.mjs"), "watchlist", "--json"], {
  cwd: workspaceDir,
  encoding: "utf8",
});
assert.equal(watchlistRun.status, 0, watchlistRun.stderr);
const watchlistText = fs.readFileSync(path.join(workspaceDir, "style", "pattern-watchlist.md"), "utf8");
assert.match(watchlistText, /phrase\.quantum_drift/);
assert.match(watchlistText, /bureaucratic_dread/);
assert.doesNotMatch(watchlistText, /rhetoric\.not_x_but_y/);
assert.match(watchlistText, /repeated rhetorical structures/);

// Registry discovery and state/ outputs must resolve from a project
// subdirectory, not from the invocation cwd.
const draftDir = path.join(workspaceDir, "draft");
fs.mkdirSync(draftDir, { recursive: true });
fs.writeFileSync(
  path.join(draftDir, "nested.md"),
  `<!--
id: nested-section
status: draft
-->
# Nested

Quantum drift again. Quantum drift twice over.
`,
);
const nestedRun = spawnSync(process.execPath, [path.join(root, "scripts", "style-calibration.mjs"), "signals", "--json", "nested.md"], {
  cwd: draftDir,
  encoding: "utf8",
});
assert.equal(nestedRun.status, 0, nestedRun.stderr);
const nestedSignals = JSON.parse(
  fs.readFileSync(path.join(workspaceDir, "state", "style", "nested-section-style-signals.json"), "utf8"),
);
assert.equal(nestedSignals.pattern_counts["phrase.quantum_drift"].count, 2, "registry must load from the project root, not the cwd");
assert.equal(fs.existsSync(path.join(draftDir, "state")), false, "state outputs must not be created under the invocation cwd");

const labWatchlist = spawnSync(process.execPath, [path.join(root, "bin", "manuscript-lab.mjs"), "lab", "style", "watchlist", "--json"], {
  cwd: workspaceDir,
  encoding: "utf8",
});
assert.equal(labWatchlist.status, 0, `mlab lab style watchlist must route to the watchlist subcommand: ${labWatchlist.stderr}`);
assert.match(labWatchlist.stdout, /"patterns"/);
const labSignals = spawnSync(process.execPath, [path.join(root, "bin", "manuscript-lab.mjs"), "lab", "style", "custom.md", "--json"], {
  cwd: workspaceDir,
  encoding: "utf8",
});
assert.equal(labSignals.status, 0, `mlab lab style <file> must still default to signals: ${labSignals.stderr}`);

console.log("style-calibration tests passed");

function run(args) {
  return spawnSync(process.execPath, ["scripts/style-calibration.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
