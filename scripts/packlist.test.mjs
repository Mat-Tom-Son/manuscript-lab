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
  { label: ".doccheck", test: exactOrUnder(".doccheck") },
  { label: "PROJECT.md", test: exact("PROJECT.md") },
  { label: "brief.md", test: exact("brief.md") },
  { label: "outline.md", test: exact("outline.md") },
  { label: "style.md", test: exact("style.md") },
  { label: "draft", test: exactOrUnder("draft") },
  { label: "state", test: exactOrUnder("state") },
  { label: "sources", test: exactOrUnder("sources") },
  { label: "taste", test: exactOrUnder("taste") },
  { label: "exports", test: exactOrUnder("exports") },
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
