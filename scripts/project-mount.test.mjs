#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const slug = "mount-test";
const title = "Mount Test";
const backupDir = path.join(root, "tmp", `project-mount-backup-${Date.now()}`);
const projectEntries = [
  "PROJECT.md",
  "brief.md",
  "outline.md",
  "style.md",
  "draft",
  "sources",
  "exports",
  "taste",
  "docs/PROJECT_HANDOFF.md",
  "docs/PROJECT_REVIEW_APPROACH.md",
];
const stateEntries = [
  "status.md",
  "continuity.md",
  "claims.md",
  "open-questions.md",
  "issues",
  "reviews",
  "revision-audits",
  "revision-plans",
  "runtime",
  "room",
  "style",
  "candidates",
  "chorus",
  "truth",
  "taste",
  "model-calls",
  "logs",
  "generation",
  "projections",
  "observations",
];

try {
  assertUnloaded();
  backupWorkspaceState();

  runOk(["scripts/story-workspace.mjs", "init", "--title", title, "--slug", slug, "--sections", "1"]);

  assertSymlink("PROJECT.md");
  assertSymlink("brief.md");
  assertSymlink("draft");
  assertSymlink("state/status.md");
  assertSymlink("state/issues");
  assertSymlink("state/room");
  assertSymlink("state/chorus");

  const workspace = path.join(root, "projects", "active", slug, "workspace");
  assert(fs.existsSync(path.join(workspace, "PROJECT.md")), "project workspace should contain PROJECT.md");
  assert(fs.existsSync(path.join(workspace, "draft", "01-opening.md")), "project workspace should contain draft");

  runOk(["scripts/compose-context.mjs", "draft/01-opening.md"]);
  const context = JSON.parse(fs.readFileSync(path.join(root, "state", "runtime", "01-opening", "context.json"), "utf8"));
  const visibleFiles = new Set(context.visible_files?.map((entry) => entry.path) || []);
  assert(visibleFiles.has("PROJECT.md"), "runtime packet should include PROJECT.md");

  const rootDraft = path.join(root, "draft", "01-opening.md");
  const targetDraft = path.join(workspace, "draft", "01-opening.md");
  const marker = "\nMount test marker.\n";
  fs.appendFileSync(rootDraft, marker, "utf8");
  assert(fs.readFileSync(targetDraft, "utf8").includes(marker.trim()), "root draft edit should write through to workspace target");

  const status = JSON.parse(runOk(["scripts/harness-status.mjs", "--json"]).stdout);
  assert(status.project_workspace?.mounted === true, "status should report mounted active workspace");
  assert(status.project_workspace?.workspace_path === `projects/active/${slug}/workspace`, "status should report active workspace path");

  const modelCallLog = path.join(root, "projects", "active", slug, "logs", "model-calls");
  fs.mkdirSync(path.join(modelCallLog, "calls", "call-001"), { recursive: true });
  fs.writeFileSync(path.join(modelCallLog, "ledger.jsonl"), "{\"call_id\":\"call-001\"}\n", "utf8");
  fs.writeFileSync(path.join(modelCallLog, "calls", "call-001", "request.json"), "{\"ok\":true}\n", "utf8");

  runOk(["scripts/story-workspace.mjs", "sync-project"]);
  assert(fs.existsSync(path.join(modelCallLog, "ledger.jsonl")), "project sync should preserve model-call ledger");
  assert(fs.existsSync(path.join(modelCallLog, "calls", "call-001", "request.json")), "project sync should preserve model-call call artifacts");

  const verify = JSON.parse(runOk(["scripts/story-workspace.mjs", "verify-projects", "--json"]).stdout);
  assert(verify.ok === true, "project verify should pass");
  assert(verify.mounted === true, "project verify should report mounted");
  assert(verify.mount_checked_entries > 1, "project verify should check the full mount surface");
  assert(verify.mount_errors.length === 0, "project verify should report no mount errors");

  rm("state/issues");
  const brokenVerify = run(["scripts/story-workspace.mjs", "verify-projects", "--json"]);
  assert(brokenVerify.status !== 0, "project verify should fail when one mount entry is missing");
  const broken = JSON.parse(brokenVerify.stdout);
  assert(broken.ok === false, "broken mount verify should report ok=false");
  assert(broken.errors.some((error) => error.includes("state/issues")), "broken mount verify should name the missing mount entry");

  runOk(["scripts/story-workspace.mjs", "mount-project"]);
  assertSymlink("state/issues");

  runOk(["scripts/story-workspace.mjs", "unload", "--slug", slug]);
  const unloaded = JSON.parse(runOk(["scripts/harness-status.mjs", "--json"]).stdout);
  assert(unloaded.workspace_state?.status === "unloaded", "workspace should unload after test project");

  console.log("project-mount tests passed");
} finally {
  let teardownError = null;
  try {
    restoreWorkspaceState();
  } catch (error) {
    teardownError = error;
  }
  try {
    cleanupTestProject();
  } catch (error) {
    teardownError ||= error;
  }
  if (teardownError) throw teardownError;
}

function assertUnloaded() {
  const status = JSON.parse(runOk(["scripts/harness-status.mjs", "--json"]).stdout);
  if (status.workspace_state?.status !== "unloaded" || status.project_workspace?.active) {
    throw new Error("project-mount test requires an unloaded workspace.");
  }
}

function backupWorkspaceState() {
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(path.join(root, "state"))) fs.cpSync(path.join(root, "state"), path.join(backupDir, "state"), { recursive: true, force: true, dereference: true });
  if (fs.existsSync(path.join(root, "projects", "registry.json"))) {
    fs.mkdirSync(path.join(backupDir, "projects"), { recursive: true });
    fs.copyFileSync(path.join(root, "projects", "registry.json"), path.join(backupDir, "projects", "registry.json"));
  }
}

function restoreWorkspaceState() {
  for (const entry of projectEntries) rm(entry);
  for (const entry of stateEntries) rm(path.join("state", entry));
  if (fs.existsSync(path.join(backupDir, "state"))) {
    rmAbsolute(path.join(root, "state"));
    fs.cpSync(path.join(backupDir, "state"), path.join(root, "state"), { recursive: true, force: true });
  }
  if (fs.existsSync(path.join(backupDir, "projects", "registry.json"))) {
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
    fs.copyFileSync(path.join(backupDir, "projects", "registry.json"), path.join(root, "projects", "registry.json"));
  }
  rmAbsolute(backupDir);
}

function cleanupTestProject() {
  rm(path.join("projects", "active", slug));
  rm(path.join("projects", "inactive", slug));
  const archiveDir = path.join(root, "archive");
  if (fs.existsSync(archiveDir)) {
    for (const entry of fs.readdirSync(archiveDir)) {
      if (entry.startsWith(`${slug}-active-`)) rm(path.join("archive", entry));
    }
  }
}

function assertSymlink(rel) {
  const full = path.join(root, rel);
  assert(fs.existsSync(full), `${rel} should exist`);
  assert(fs.lstatSync(full).isSymbolicLink(), `${rel} should be a symlink`);
}

function runOk(args) {
  const result = run(args);
  if (result.status !== 0) {
    throw new Error(`${process.execPath} ${args.join(" ")} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result;
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function rm(rel) {
  const full = path.join(root, rel);
  if (existsOrSymlink(full)) rmAbsolute(full);
}

function rmAbsolute(full) {
  fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function existsOrSymlink(full) {
  if (fs.existsSync(full)) return true;
  try {
    fs.lstatSync(full);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
