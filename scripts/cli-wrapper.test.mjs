#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(".");
const cli = path.join(root, "bin/manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-cli-"));

try {
  {
    const result = run([cli, "help"]);
    assert.equal(result.status, 0, result.stderr);
    for (const group of ["Start:", "Daily loop:", "Evidence:", "Ship:", "Agents:", "Lab:"]) {
      assert.match(result.stdout, new RegExp(`^${group}`, "m"), `help should include the ${group} group`);
    }
    assert.match(result.stdout, /init\s+— create a workspace here/);
    assert.match(result.stdout, /adopt\s+— import existing markdown files/);
    assert.match(result.stdout, /mcp\s+— serve Manuscript Lab tools/);
    assert.match(result.stdout, /lab\s+— contained R&D/);
    assert.match(result.stdout, /report\s+— project readiness report with blockers and fix commands/);
    assert.match(result.stdout, /export\s+— export reader files \(default formats: md,html\)/);
    assert.match(result.stdout, /mlab help <command>/);
    assert.match(result.stdout, /mlab lab --help/);
    assert.match(result.stdout, /docs\/COMMANDS\.md/);
    assert.match(result.stdout, /mlab help admin/);
    const lineCount = result.stdout.trim().split("\n").length;
    assert(lineCount <= 48, `grouped help should stay compact, got ${lineCount} lines`);
    assert.doesNotMatch(result.stdout, /room blue-sky draft/, "help should not include the old example wall");
  }

  {
    const result = run([cli, "help", "admin"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /template clone root/);
    assert.match(result.stdout, /project:init/);
    assert.match(result.stdout, /story:restore/);
    assert.match(result.stdout, /template:audit/);
  }

  {
    const result = run([cli, "help", "report"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /report - summarize Manuscript Lab readiness/);
  }

  {
    const result = run([cli, "unknowncmd"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: unknowncmd/);
    assert.match(result.stderr, /Start, Daily loop, Evidence, Ship, Agents, Lab/);
    assert.doesNotMatch(result.stdout + result.stderr, /Daily loop:/, "unknown command should not print the full help");
  }

  {
    const result = run([cli, "gaet"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: gaet/);
    assert.match(result.stderr, /Did you mean `mlab gate`\?/);
  }

  {
    const result = run([cli, "stat"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Did you mean `mlab status`\?/);
  }

  for (const labArgs of [["lab"], ["lab", "--help"]]) {
    const result = run([cli, ...labArgs]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mlab lab - contained R&D commands/);
    assert.match(result.stdout, /room\s+— writers' room protocol artifacts/);
    assert.match(result.stdout, /mlab lab model <smoke\|capabilities\|calls>/);
  }

  {
    const result = run([cli, "lab", "room", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /room - writers' room protocol artifacts/);
  }

  {
    const result = run([cli, "lab", "model", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mlab lab model smoke/);
    assert.match(result.stdout, /model:capabilities/);
  }

  {
    const result = run([cli, "lab", "model", "smoke", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /model-smoke - test the configured model provider/);
  }

  {
    const result = run([cli, "lab", "bogus"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown lab command: bogus/);
    assert.match(result.stderr, /mlab lab --help/);
  }

  // lab members that wrap a preset script subcommand must still honor --help
  // instead of failing the subcommand's argument checks.
  for (const styleHelpArgs of [["lab", "style", "--help"], ["style:signals", "--help"], ["help", "style:signals"]]) {
    const result = run([cli, ...styleHelpArgs]);
    assert.equal(result.status, 0, `mlab ${styleHelpArgs.join(" ")}: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /style-calibration - voice fingerprint and pattern-saturation helpers/);
    assert.doesNotMatch(result.stderr, /signals requires at least one draft section/);
  }

  {
    const result = run([cli, "adopt", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /adopt - create a Manuscript Lab workspace from existing markdown/);
  }

  {
    const result = run([cli, "mcp", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Model Context Protocol server over stdio/);
  }

  {
    const workspace = path.join(tmp, "fresh-bare-init");
    fs.mkdirSync(workspace, { recursive: true });
    const result = run([cli, "init"], { cwd: workspace });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /profile: whitepaper/);
    assert.match(result.stdout, /root:\s+manuscript/);
    assert.match(result.stdout, /title:\s+Fresh Bare Init/);
    assert.match(result.stdout, /Customize with --profile, --root, and --title/);
    const config = JSON.parse(fs.readFileSync(path.join(workspace, "manuscript-lab.config.json"), "utf8"));
    assert.equal(config.profile, "whitepaper");
    assert.equal(config.root, "manuscript");
    assert.equal(config.profileOptions.title, "Fresh Bare Init");
    assert(fs.existsSync(path.join(workspace, "manuscript/draft/01-opening.md")));
  }

  {
    const workspace = path.join(tmp, "fresh-bare-init-json");
    fs.mkdirSync(workspace, { recursive: true });
    const result = run([cli, "init", "--json"], { cwd: workspace });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, "installed");
    assert.equal(parsed.root, "manuscript");
  }

  {
    const workspace = path.join(tmp, "fresh-bare-init-title");
    fs.mkdirSync(workspace, { recursive: true });
    const result = run([cli, "init", "--title", "Named Draft"], { cwd: workspace });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /title:\s+Named Draft/);
    const config = JSON.parse(fs.readFileSync(path.join(workspace, "manuscript-lab.config.json"), "utf8"));
    assert.equal(config.profileOptions.title, "Named Draft");
  }

  {
    const result = run([cli, "init", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bare init \(outside a template clone\)/);
    assert.match(result.stdout, /Template clone note/);
  }

  {
    const workspace = path.join(tmp, "bare-command-defaults");
    fs.mkdirSync(workspace, { recursive: true });
    const init = run([cli, "init"], { cwd: workspace });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const evidence = run([cli, "evidence", "--json"], { cwd: workspace });
    assert.equal(evidence.status, 0, evidence.stderr || evidence.stdout);
    assert.equal(JSON.parse(evidence.stdout).command, "evidence report");

    const narrative = run([cli, "narrative", "--json"], { cwd: workspace });
    assert.equal(narrative.status, 0, narrative.stderr || narrative.stdout);
    const profile = JSON.parse(narrative.stdout);
    assert(Array.isArray(profile.sections));
    assert(
      fs.existsSync(path.join(workspace, "manuscript/state/observations/manuscript-narrative-profile.json")),
      "bare narrative should build the overview profile instead of printing usage",
    );
  }

  {
    const result = run([cli, "drive", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /model-driver - bounded Manuscript Lab driver loop/);
  }

  {
    const result = run([cli, "practice", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /practice - generate and judge creative-writing exercise candidates/);
    assert.match(result.stdout, /practice compare --exercise want-in-room --model openrouter:z-ai\/glm-5\.2 --json/);
    assert.match(result.stdout, /practice bench --exercises core --models openrouter:z-ai\/glm-5\.2 --seeds 3 --json/);
    assert.match(result.stdout, /practice strategies --exercises want-in-room,thing-unsaid --model openrouter:z-ai\/glm-5\.2 --json/);
  }

  {
    const result = run([cli, "artifacts", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /artifacts - inspect generated Manuscript Lab evidence/);
  }

  {
    const result = run([cli, "eval", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /eval - snapshot and compare Manuscript Lab workflow evidence/);
  }

  {
    const result = run([cli, "golden-path", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /golden-path - show the first useful Manuscript Lab product path/);
  }

  {
    const result = run([cli, "chorus", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /chorus - prose line lab and contact-sheet artifacts/);
  }

  {
    const result = run([cli, "room", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /room - writers' room protocol artifacts/);
  }

  {
    const result = run([cli, "review", "run", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /review-runner - typed editorial sensors/);
  }

  {
    const result = run([cli, "review", "report", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /review-report - summarize saved typed review runs/);
  }

  {
    const result = run(
      [
        cli,
        "revise",
        "draft/01-opening.md",
        "--issue",
        "issue_tutorial_0001",
        "--candidates",
        "2",
        "--dry-run",
      ],
      { cwd: path.join(root, "examples/technical-whitepaper") },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Candidate run dry-run:/);
    assert.match(result.stdout, /candidate-a:/);
    assert.match(result.stdout, /candidate-b:/);
    assert.doesNotMatch(result.stdout, /candidate-c:/);
  }

  console.log("cli wrapper tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function run(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
