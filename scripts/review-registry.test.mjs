#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const cli = path.join(repoRoot, "bin/manuscript-lab.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-review-registry-"));

try {
  testProjectReviewIsSharedAcrossCommands();
  testUnknownProjectReviewIsRejected();
  testBuiltInCollisionsAreRejected();
  testMissingAndEscapingPromptsAreRejected();
  testSymlinkedPromptEscapeIsRejected();
  testSymlinkedContextEscapeIsRejected();
  console.log("review registry tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testProjectReviewIsSharedAcrossCommands() {
  const workspace = createWorkspace("shared-registry");
  const project = path.join(workspace, "manuscript");
  registerLocalReview(workspace, { defaultReviews: ["loose.thread"] });
  setContractReviews(project, ["loose.thread"]);

  const validate = run(["validate", "--json"], workspace);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  assert.equal(JSON.parse(validate.stdout).ok, true);

  const check = run(["check", "--static-only", "--json"], workspace);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.equal(JSON.parse(check.stdout).pass, true);

  const list = run(["review", "list", "--json"], workspace);
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const local = JSON.parse(list.stdout).passes.find((pass) => pass.id === "loose.thread");
  assert.equal(local?.origin, "project");
  assert.equal(local?.context_pack, "local.anti_tidiness");

  const review = run(
    ["review", "draft/01-opening.md", "--passes", "loose.thread", "--force", "--dry-run", "--json"],
    workspace,
  );
  assert.equal(review.status, 0, review.stderr || review.stdout);
  const reviewJson = JSON.parse(review.stdout);
  assert.equal(reviewJson.jobs.length, 1);
  assert.equal(reviewJson.jobs[0].pass, "loose.thread");
  assert.equal(reviewJson.jobs[0].origin, "project");
  assert(reviewJson.jobs[0].visible_files.some((file) => file.path === "draft/01-opening.md"));
  assert(reviewJson.jobs[0].visible_files.some((file) => file.path === "style.md"));

  setContractReviews(project, []);
  const defaultReview = run(["review", "draft/01-opening.md", "--force", "--dry-run", "--json"], workspace);
  assert.equal(defaultReview.status, 0, defaultReview.stderr || defaultReview.stdout);
  assert.deepEqual(JSON.parse(defaultReview.stdout).jobs.map((job) => job.pass), ["loose.thread"]);
  setContractReviews(project, ["loose.thread"]);

  const compose = run(
    ["compose", "draft/01-opening.md", "--context-pack", "local.anti_tidiness", "--dry-run", "--json"],
    workspace,
  );
  assert.equal(compose.status, 0, compose.stderr || compose.stdout);
  assert.equal(JSON.parse(compose.stdout).context_pack, "local.anti_tidiness");

  const gate = run(["gate", "draft/01-opening.md", "--json"], workspace);
  assert.equal(gate.status, 1, gate.stderr || gate.stdout);
  const reviewRequirement = JSON.parse(gate.stdout).requirements.find((item) => item.id === "contract.review_ids_exist");
  assert.equal(reviewRequirement?.status, "pass", JSON.stringify(reviewRequirement, null, 2));
  assert.deepEqual(reviewRequirement?.evidence.reviews, ["loose.thread"]);
  assert.equal(typeof JSON.parse(gate.stdout).input_hashes.reviews_registry, "string");
}

function testUnknownProjectReviewIsRejected() {
  const workspace = createWorkspace("unknown-review");
  const project = path.join(workspace, "manuscript");
  setContractReviews(project, ["missing.project_review"]);

  const validate = run(["validate", "--json"], workspace);
  assert.equal(validate.status, 1);
  assert(
    JSON.parse(validate.stdout).errors.some((error) => error.includes('unknown review pass "missing.project_review"')),
    validate.stdout,
  );

  const defaultWorkspace = createWorkspace("unknown-default-review");
  const configFile = path.join(defaultWorkspace, "manuscript-lab.config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.reviews.default = ["missing.default_review"];
  writeJson(configFile, config);
  const defaultValidation = run(["validate", "--json"], defaultWorkspace);
  assert.equal(defaultValidation.status, 1);
  assert(
    JSON.parse(defaultValidation.stdout).errors.some((error) => /reviews\.default references unknown review pass IDs: missing\.default_review/.test(error)),
    defaultValidation.stdout,
  );
}

function testBuiltInCollisionsAreRejected() {
  const passWorkspace = createWorkspace("pass-collision");
  registerLocalReview(passWorkspace, { passId: "cold.reader" });
  const passCollision = run(["validate", "--json"], passWorkspace);
  assert.equal(passCollision.status, 1);
  assert(
    JSON.parse(passCollision.stdout).errors.some((error) => /duplicates built-in review pass ID "cold\.reader"/.test(error)),
    passCollision.stdout,
  );
  const passCheck = run(["check", "--static-only", "--json"], passWorkspace);
  assert.equal(passCheck.status, 1);
  assert(
    JSON.parse(passCheck.stdout).errors.some((error) => /duplicates built-in review pass ID "cold\.reader"/.test(error)),
    passCheck.stdout,
  );

  const packWorkspace = createWorkspace("pack-collision");
  registerLocalReview(packWorkspace, { packId: "blind.section_only" });
  const packCollision = run(["validate", "--json"], packWorkspace);
  assert.equal(packCollision.status, 1);
  assert(
    JSON.parse(packCollision.stdout).errors.some((error) => /duplicates built-in context pack ID "blind\.section_only"/.test(error)),
    packCollision.stdout,
  );
}

function testMissingAndEscapingPromptsAreRejected() {
  const missingWorkspace = createWorkspace("missing-prompt");
  registerLocalReview(missingWorkspace, { writePrompt: false });
  const missing = run(["validate", "--json"], missingWorkspace);
  assert.equal(missing.status, 1);
  assert(JSON.parse(missing.stdout).errors.some((error) => /prompt points to missing file/.test(error)), missing.stdout);

  const escapingWorkspace = createWorkspace("escaping-prompt");
  write(path.join(escapingWorkspace, "outside.md"), "Outside the project root.\n");
  registerLocalReview(escapingWorkspace, { prompt: "../outside.md", writePrompt: false });
  const escaping = run(["validate", "--json"], escapingWorkspace);
  assert.equal(escaping.status, 1);
  assert(JSON.parse(escaping.stdout).errors.some((error) => /prompt is invalid: path must not escape/.test(error)), escaping.stdout);

  const contextWorkspace = createWorkspace("escaping-context");
  registerLocalReview(contextWorkspace, { include: ["../outside.md", "draft/{section}"] });
  const context = run(["validate", "--json"], contextWorkspace);
  assert.equal(context.status, 1);
  assert(
    JSON.parse(context.stdout).errors.some((error) => /context_packs\.local\.anti_tidiness\.include\[0\].*must not escape/.test(error)),
    context.stdout,
  );
}

function testSymlinkedPromptEscapeIsRejected() {
  if (process.platform === "win32") return;
  const workspace = createWorkspace("symlink-prompt");
  const outside = path.join(workspace, "outside.md");
  write(outside, "Outside the project root.\n");
  registerLocalReview(workspace, { writePrompt: false });
  const prompt = path.join(workspace, "manuscript", "reviews", "prompts", "loose-thread.md");
  fs.mkdirSync(path.dirname(prompt), { recursive: true });
  fs.symlinkSync(outside, prompt);

  const result = run(["validate", "--json"], workspace);
  assert.equal(result.status, 1);
  assert(JSON.parse(result.stdout).errors.some((error) => /prompt resolves outside its owning root/.test(error)), result.stdout);
}

function testSymlinkedContextEscapeIsRejected() {
  if (process.platform === "win32") return;
  const workspace = createWorkspace("symlink-context");
  const outside = path.join(workspace, "outside.md");
  write(outside, "Outside the project root.\n");
  registerLocalReview(workspace, { include: ["reviews/context.md", "draft/{section}"] });
  const context = path.join(workspace, "manuscript", "reviews", "context.md");
  fs.symlinkSync(outside, context);

  const result = run(["validate", "--json"], workspace);
  assert.equal(result.status, 1);
  assert(
    JSON.parse(result.stdout).errors.some((error) => /context_packs\.local\.anti_tidiness\.include\[0\] resolves outside/.test(error)),
    result.stdout,
  );
}

function createWorkspace(name) {
  const workspace = path.join(tmp, name);
  fs.mkdirSync(workspace, { recursive: true });
  const init = run(
    ["init", "--profile", "whitepaper", "--root", "manuscript", "--title", name, "--sections", "1", "--json"],
    workspace,
  );
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return workspace;
}

function registerLocalReview(
  workspace,
  {
    passId = "loose.thread",
    packId = "local.anti_tidiness",
    prompt = "reviews/prompts/loose-thread.md",
    writePrompt = true,
    include = ["style.md", "draft/{section}"],
    defaultReviews,
  } = {},
) {
  const project = path.join(workspace, "manuscript");
  const configFile = path.join(workspace, "manuscript-lab.config.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.reviews = {
    ...(config.reviews ?? {}),
    ...(defaultReviews ? { default: defaultReviews } : {}),
    suite: "reviews/suite.json",
  };
  writeJson(configFile, config);

  writeJson(path.join(project, "reviews", "suite.json"), {
    version: 1,
    context_packs: {
      [packId]: {
        description: "Expose the style guide and target while looking for over-tidied prose.",
        include,
        exclude: ["state/", "taste/"],
      },
    },
    passes: [
      {
        id: passId,
        label: "Loose Thread",
        stage: ["todo", "draft", "review", "revision", "polish"],
        applies_to: ["*"],
        context_pack: packId,
        models: ["openai/gpt-4.1-mini"],
        prompt,
        blocking: false,
        min_confidence: 0.5,
        max_issues: 6,
      },
    ],
  });
  if (writePrompt) {
    write(
      path.join(project, prompt),
      "# Loose Thread\n\nReport only places where tidying the prose erased useful friction or implication.\n",
    );
  }
}

function setContractReviews(project, ids) {
  const file = path.join(project, "draft", "01-opening.md");
  const text = fs.readFileSync(file, "utf8");
  const replacement = `reviews:\n${ids.map((id) => `  - ${id}`).join("\n")}\n`;
  const updated = text.replace(
    /reviews:[ \t]*\n(?:[ \t]+-[ \t]*[A-Za-z0-9_.:-]+[ \t]*\n)*/,
    replacement,
  );
  assert.notEqual(updated, text, "fixture contract should contain a reviews list");
  write(file, updated);
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}
