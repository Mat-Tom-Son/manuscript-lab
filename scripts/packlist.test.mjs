#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["pack", "--dry-run", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

assert.equal(result.status, 0, result.stderr || result.stdout);

let packs;
try {
  packs = JSON.parse(result.stdout);
} catch (error) {
  throw new Error(`npm pack --dry-run --json did not return valid JSON: ${error.message}\n${result.stdout}`);
}

assert(Array.isArray(packs), "npm pack JSON output should be an array");

const files = packs.flatMap((pack) => {
  assert(Array.isArray(pack.files), "npm pack JSON entries should include a files array");
  return pack.files.map((file) => normalizePackPath(file.path));
});

assert(files.length > 0, "npm pack file list should not be empty");

const forbidden = [
  { label: ".env", test: privateEnvFile },
  { label: ".doccheck", test: hasPathSegment(".doccheck") },
  { label: "PROJECT.md", test: exact("PROJECT.md") },
  { label: "brief.md", test: exact("brief.md") },
  { label: "outline.md", test: exact("outline.md") },
  { label: "style.md", test: exact("style.md") },
  { label: "draft", test: exactOrUnder("draft") },
  { label: "state", test: exactOrUnder("state") },
  { label: "sources", test: exactOrUnder("sources") },
  { label: "taste", test: exactOrUnder("taste") },
  { label: "exports", test: exactOrUnder("exports") },
  { label: "reports", test: hasPathSegment("reports") },
  { label: "archive", test: exactOrUnder("archive") },
  { label: "projects/active", test: exactOrUnder("projects/active") },
  { label: "projects/inactive", test: exactOrUnder("projects/inactive") },
  { label: "projects/registry.json", test: exact("projects/registry.json") },
  { label: "tmp", test: exactOrUnder("tmp") },
  { label: "node_modules", test: exactOrUnder("node_modules") },
  { label: "generated tarball", test: (file) => file.endsWith(".tgz") || file.endsWith(".tar.gz") },
];

const violations = [];
for (const file of files) {
  for (const rule of forbidden) {
    if (rule.test(file)) violations.push(`${file} (${rule.label})`);
  }
}

assert.deepEqual(violations, [], `npm pack includes forbidden private/generated paths:\n${violations.join("\n")}`);

const required = [
  ".pi/prompts/doc-chorus-plan.md",
  ".pi/prompts/doc-chorus-run.md",
  ".pi/prompts/doc-chorus-report.md",
  ".pi/prompts/doc-room-blue-sky.md",
  ".pi/prompts/doc-room-break.md",
  ".pi/prompts/doc-room-decide.md",
  ".pi/prompts/doc-room-report.md",
  ".pi/prompts/doc-room-table-read.md",
  "docs/CHORUS_PROSE_ENSEMBLE_PLAN.md",
  "docs/WRITERS_ROOM_WORKFLOWS.md",
  "reviews/prompts/room-table-read.md",
  "scripts/chorus-runner.mjs",
  "scripts/chorus-runner.test.mjs",
  "scripts/room-runner.mjs",
  "scripts/room-runner.test.mjs",
];
const missing = required.filter((file) => !files.includes(file));
assert.deepEqual(missing, [], `npm pack is missing public Room/Chorus assets:\n${missing.join("\n")}`);

const tutorialFixtures = [
  "examples/technical-whitepaper/state/candidates/01-opening/tutorial-run-001/manifest.json",
  "examples/technical-whitepaper/state/revision-audits/01-opening/diff_audit_tutorial_001.json",
  "examples/technical-whitepaper/exports/manifest.json",
];
const missingFixtures = tutorialFixtures.filter((file) => !files.includes(file));
assert.deepEqual(missingFixtures, [], `npm pack is missing intentional tutorial fixture artifacts:\n${missingFixtures.join("\n")}`);

console.log("packlist tests passed");

function normalizePackPath(file) {
  return String(file || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function privateEnvFile(file) {
  return file === ".env" || file.startsWith(".env/") || (file.startsWith(".env.") && file !== ".env.example");
}

function exact(target) {
  return (file) => file === target;
}

function exactOrUnder(target) {
  return (file) => file === target || file.startsWith(`${target}/`);
}

function hasPathSegment(target) {
  return (file) => file.split("/").includes(target);
}
