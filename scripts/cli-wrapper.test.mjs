#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(".");
const cli = path.join(root, "bin/manuscript-lab.mjs");

{
  const result = run([cli, "help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Review and revision:/);
  assert.match(result.stdout, /review draft\/<section>\.md --dry-run --panel prose\.clean/);
  assert.match(result.stdout, /revise draft\/<section>\.md --issue <issue-id> --candidates 3 --dry-run/);
  assert.match(result.stdout, /Compatibility command names:/);
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

function run(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
