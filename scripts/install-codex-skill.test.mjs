#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-codex-skill-"));

try {
  const dryRunHome = path.join(tmp, "dry-run-home");
  const dryRun = run(["--dry-run", "--codex-home", dryRunHome]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /Would install Manuscript Lab Codex skill/);
  assert.equal(fs.existsSync(dryRunHome), false, "dry run should not create Codex home");

  const codexHome = path.join(tmp, "codex-home");
  const install = run(["--copy", "--codex-home", codexHome]);
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const skillPath = path.join(codexHome, "skills", "manuscript-lab", "SKILL.md");
  assert.equal(fs.existsSync(skillPath), true, "skill should be copied into fake Codex home");
  assert.match(fs.readFileSync(skillPath, "utf8"), /^name: manuscript-lab/m);

  const duplicate = run(["--copy", "--codex-home", codexHome]);
  assert.notEqual(duplicate.status, 0, "duplicate copy without --force should fail");
  assert.match(duplicate.stderr, /Target already exists/);

  const forced = run(["--copy", "--force", "--codex-home", codexHome]);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);

  console.log("install-codex-skill tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function run(args) {
  return spawnSync(process.execPath, ["scripts/install-codex-skill.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
