#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const alwaysRun = [
  "scripts/model-json.test.mjs",
  "scripts/model-provider-response.test.mjs",
  "scripts/doctor.test.mjs",
  "scripts/word-usage.test.mjs",
  "scripts/style-calibration.test.mjs",
  "scripts/taste-arbiter.test.mjs",
  "scripts/harness-hardening.test.mjs",
];

let failures = 0;
for (const file of alwaysRun) {
  failures += runTest(file) ? 0 : 1;
}

if (workspaceIsUnloaded()) {
  failures += runTest("scripts/project-mount.test.mjs") ? 0 : 1;
} else {
  console.log("skip: scripts/project-mount.test.mjs (requires unloaded workspace)");
}

process.exit(failures ? 1 : 0);

function runTest(file) {
  const result = spawnSync(process.execPath, [file], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error(`FAIL: ${file}`);
    return false;
  }
  return true;
}

function workspaceIsUnloaded() {
  const result = spawnSync(process.execPath, ["scripts/harness-status.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return false;
  try {
    const status = JSON.parse(result.stdout);
    return status.workspace_state?.status === "unloaded" && !status.project_workspace?.active;
  } catch {
    return false;
  }
}
