#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["scripts/doctor.mjs", "--json", "--no-network"], {
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

console.log("doctor tests passed");
