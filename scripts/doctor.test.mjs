#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const doctorScript = path.resolve("scripts/doctor.mjs");

const result = spawnSync(process.execPath, [doctorScript, "--json", "--no-network"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

assert.equal(result.status, 0, result.stderr || result.stdout);
const parsed = JSON.parse(result.stdout);
assert.equal(typeof parsed.ok, "boolean");
assert(Array.isArray(parsed.checks));

const ids = new Set(parsed.checks.map((check) => check.id));
for (const id of ["node", "harness.files", "git.executable", "gitignore.private_paths", "package.private"]) {
  assert(ids.has(id), `doctor output should include ${id}`);
}

const modelKeys = parsed.checks.find((check) => check.id === "model.keys");
assert(modelKeys, "doctor output should include model key status");
assert(!/sk-|ghp_|AIza/.test(JSON.stringify(modelKeys)), "doctor must not print secret-looking values");

const blankDir = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-doctor-"));
try {
  const blankResult = spawnSync(process.execPath, [doctorScript, "--json", "--no-network"], {
    cwd: blankDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.equal(blankResult.status, 0, blankResult.stderr || blankResult.stdout);
  const blankParsed = JSON.parse(blankResult.stdout);
  assert.equal(blankParsed.summary.failures, 0);
  const ignoreCheck = blankParsed.checks.find((check) => check.id === "gitignore.private_paths");
  assert(ignoreCheck, "blank-directory doctor output should include private path check");
  assert.equal(ignoreCheck.status, "info");
} finally {
  fs.rmSync(blankDir, { recursive: true, force: true });
}

console.log("doctor tests passed");
