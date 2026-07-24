#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { discoverProtocol, protocolPaths, validateProtocolConfig } from "./lib/protocol.mjs";
import { parseContractList, parseSectionContract } from "./lib/section-contract.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-protocol-"));

try {
  testContractParser();
  testInstalledWorkspaceValidation();
  testNestedRootDiscovery();
  testProtocolPaths();
  testConfigValidationWarningsAndTypes();
  testWindowsAndBackslashPathsFail();
  testEscapingConfigFails();
  testInvalidJsonConfigFailsCleanly();
  testProjectFreeValidateShowsHints();
  console.log("protocol tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testContractParser() {
  const text = `<!--
id: 01-test
status: draft
target_words: 100
purpose: Test parsing.
acceptance:
  - One.
checks:
  - claims.supported
  - style.violations
reviews: cold.reader, contract.editor
-->
# Test
`;
  const contract = parseSectionContract(text);
  assert.equal(contract.get("id"), "01-test");
  assert.deepEqual(parseContractList(text, "checks"), ["claims.supported", "style.violations"]);
  assert.deepEqual(parseContractList(text, "reviews"), ["cold.reader", "contract.editor"]);
}

function testInstalledWorkspaceValidation() {
  const workspace = path.join(tmp, "valid-workspace");
  writeProject(workspace);

  const result = runValidate(["--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "installed");
  assert.equal(parsed.draft_count, 1);
  assert.equal(parsed.drafts[0].sectionId, "01-opening");
}

function testNestedRootDiscovery() {
  const workspace = path.join(tmp, "nested-workspace");
  writeProject(workspace);
  const nested = path.join(workspace, "manuscript", "draft");

  const result = runValidate(["--json"], { cwd: nested });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(fs.realpathSync(parsed.workspace_root), fs.realpathSync(workspace));
  assert.equal(fs.realpathSync(parsed.manuscript_root), fs.realpathSync(path.join(workspace, "manuscript")));
}

function testProtocolPaths() {
  const workspace = path.join(tmp, "path-workspace");
  writeProject(workspace);
  const manuscript = path.join(workspace, "manuscript");
  const nested = path.join(manuscript, "draft");
  const discovery = discoverProtocol({ cwd: nested });
  const paths = protocolPaths(discovery, { cwd: nested });

  assert.equal(paths.projectRel(paths.resolveProjectInput("01-opening.md")), "draft/01-opening.md");
  assert.equal(paths.projectRel(paths.resolveProjectInput("draft/01-opening.md")), "draft/01-opening.md");
  assert.equal(paths.projectRel(paths.stateAbs("runtime")), "state/runtime");
  assert.equal(paths.projectRel(paths.exportsAbs("book.md")), "exports/book.md");
  assert.equal(paths.packageAbs("checks/suite.json"), path.join(repoRoot, "checks/suite.json"));
}

function testEscapingConfigFails() {
  const workspace = path.join(tmp, "bad-workspace");
  mkdir(workspace);
  writeJson(path.join(workspace, "manuscript-lab.config.json"), {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "../outside",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
  });

  const result = runValidate(["--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert(parsed.errors.some((error) => /root/.test(error) && /escape/.test(error)));
}

function testConfigValidationWarningsAndTypes() {
  const configDir = path.join(tmp, "config-validation");
  mkdir(configDir);
  const base = {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "manuscript",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
    profileOptions: {},
  };

  const unknown = validateProtocolConfig({ ...base, extraTopLevel: true, profileOptions: { title: "Known", surprise: true } }, { configDir });
  assert.deepEqual(unknown.errors, []);
  assert(unknown.warnings.some((warning) => /Unknown config field.*extraTopLevel/.test(warning)));
  assert(unknown.warnings.some((warning) => /Unknown profileOptions field.*surprise/.test(warning)));

  const typed = validateProtocolConfig(
    {
      ...base,
      schemaVersion: "1",
      profile: "",
      profileOptions: [],
      checks: [],
      reviews: "default",
      model: "openrouter",
      gates: [],
    },
    { configDir },
  );
  assert(typed.errors.some((error) => /schemaVersion must be integer 1/.test(error)));
  assert(typed.errors.some((error) => /profile must be a non-empty string/.test(error)));
  assert(typed.errors.some((error) => /profileOptions must be an object/.test(error)));
  assert(typed.errors.some((error) => /checks must be an object/.test(error)));
  assert(typed.errors.some((error) => /reviews must be an object/.test(error)));
  assert(typed.errors.some((error) => /model must be an object/.test(error)));
  assert(typed.errors.some((error) => /gates must be an object/.test(error)));

  const gatePolicy = validateProtocolConfig(
    {
      ...base,
      gates: {
        reviews: { declared_have_run: "warn", declared_fresh: "off" },
        profiles: {
          release: {
            reviews: { declared_have_run: "block", declared_fresh: "block" },
          },
        },
      },
    },
    { configDir },
  );
  assert.deepEqual(gatePolicy.errors, []);

  const invalidGatePolicy = validateProtocolConfig(
    {
      ...base,
      gates: {
        section: { words_floor_ratio: 2 },
        reviews: { declared_have_run: "sometimes" },
        profiles: { release: { reviews: { declared_fresh: true } } },
      },
    },
    { configDir },
  );
  assert(invalidGatePolicy.errors.some((error) => /words_floor_ratio/.test(error)));
  assert(invalidGatePolicy.errors.some((error) => /declared_have_run must be one of/.test(error)));
  assert(invalidGatePolicy.errors.some((error) => /declared_fresh must be one of/.test(error)));
}

function testWindowsAndBackslashPathsFail() {
  const configDir = path.join(tmp, "windows-paths");
  mkdir(configDir);
  const base = {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "manuscript",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
  };
  const cases = [
    ["root", "C:/Users/mat/manuscript", /Windows drive paths/],
    ["root", "\\\\server\\share", /UNC paths|forward slashes/],
    ["draftGlob", "draft\\*.md", /forward slashes/],
    ["stateDir", "..\\state", /forward slashes/],
  ];

  for (const [field, value, pattern] of cases) {
    const validation = validateProtocolConfig({ ...base, [field]: value }, { configDir });
    assert(
      validation.errors.some((error) => error.includes(`Config ${field}`) && pattern.test(error)),
      `${field}=${value} should fail with ${pattern}; got ${validation.errors.join("; ")}`,
    );
  }
}

function testInvalidJsonConfigFailsCleanly() {
  const workspace = path.join(tmp, "invalid-json");
  mkdir(workspace);
  write(path.join(workspace, "manuscript-lab.config.json"), "{ nope\n");

  const result = runValidate(["--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.mode, "installed");
  assert.equal(parsed.config, null);
  assert(parsed.errors.some((error) => /not valid JSON/.test(error)));
}

function testProjectFreeValidateShowsHints() {
  const workspace = path.join(tmp, "no-project");
  mkdir(workspace);

  const result = runValidate(["--json"], { cwd: workspace });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.mode, "none");
  assert(parsed.errors.some((error) => /No Manuscript Lab project found/.test(error)));
  assert(parsed.hints.some((hint) => /mlab init --profile/.test(hint)));
  assert(parsed.hints.some((hint) => /mlab doctor --no-project/.test(hint)));

  const text = runValidate([], { cwd: workspace });
  assert.equal(text.status, 1);
  assert.match(text.stdout, /Hints:/);
  assert.match(text.stdout, /mlab init --profile/);
  assert.match(text.stdout, /mlab doctor --no-project/);
}

function writeProject(workspace) {
  const project = path.join(workspace, "manuscript");
  mkdir(path.join(project, "draft"));
  mkdir(path.join(project, "state"));
  mkdir(path.join(project, "sources"));
  mkdir(path.join(project, "exports"));

  writeJson(path.join(workspace, "manuscript-lab.config.json"), {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "manuscript",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
    profileOptions: {},
  });
  write(path.join(project, "PROJECT.md"), "# Project\n");
  write(path.join(project, "brief.md"), "# Brief\n");
  write(path.join(project, "outline.md"), "# Outline\n");
  write(path.join(project, "style.md"), "# Style\n");
  write(path.join(project, "sources/index.md"), "# Sources\n\n| Key | Type | Title | Location |\n|---|---|---|---|\n| `fixture` | note | Fixture | `brief.md` |\n");
  write(path.join(project, "state/claims.md"), "# Claims\n\n| Claim | Section | Source | Status | Notes |\n|---|---|---|---|---|\n");
  write(path.join(project, "state/open-questions.md"), "# Open Questions\n");
  write(path.join(project, "state/status.md"), "| Section | File | Status | Notes |\n|---|---|---|---|\n| Opening | `draft/01-opening.md` | draft | Fixture |\n");
  write(path.join(project, "draft/01-opening.md"), `<!--
id: 01-opening
kind: document.section
status: draft
target_words: 20
purpose: Exercise protocol validation.
acceptance:
  - Contains enough prose for a started section.
checks:
  - claims.supported
reviews:
  - cold.reader
-->
# Opening

This fixture section has enough words to satisfy the small started-section
threshold used by protocol validation.
`);
}

function runValidate(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/protocol-validate.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(file, content) {
  mkdir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
