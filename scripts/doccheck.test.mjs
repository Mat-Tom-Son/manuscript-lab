#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REQUIRED_PROJECT_DIRS, REQUIRED_PROJECT_FILES, TRUTH_STATE_SCHEMA_VERSION } from "./lib/required-scaffolding.mjs";
import { placeholderFindings } from "./lib/section-contract.mjs";
import { syncSectionStatusesFromContracts } from "./lib/status-sync.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-doccheck-"));

try {
  testPlaceholderFindings();
  testStatusSyncFromContracts();
  testStatusSyncReconcilesMembership();
  testStatusSyncHandlesEscapedPipes();
  testOutlineMembershipPreservesGlobalContent();
  testPlainCheckHintsAtFix();
  testFixCreatesMissingScaffoldingIdempotently();
  testFixReportsScaffoldingConflictsCleanly();
  testFixRefusesWithoutProject();
  testInstallInitSatisfiesRequiredScaffolding();
  testFixReconcilesRenamedSectionsAfterInit();
  console.log("doccheck tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testPlaceholderFindings() {
  const contract = (fields) => `<!--\nid: 01-x\nstatus: draft\n${fields}\n-->\n`;

  // Marker forms in prose are placeholders.
  for (const body of [
    "TODO: finish the middle section.",
    "The ending is [TBD] until review.",
    "- TODO expand this list item",
    "**TODO** rewrite the close.",
    "The launch date is TBD.",
    "Notes below.\n\n<!-- FIXME: recheck this figure -->",
  ]) {
    assert.deepEqual(
      placeholderFindings(`${contract("purpose: Real purpose.")}# H\n\n${body}\n`),
      ["contains TODO/TBD/FIXME placeholder text"],
      `should flag: ${JSON.stringify(body)}`,
    );
  }

  // Prose that merely mentions the word, and code spans/fences, are clean.
  for (const body of [
    "It catches the section that still says TODO in a shipped draft.",
    "Writers often leave FIXME markers behind; this tool hunts them.",
    "Use `TODO:` markers so the checker can find them.",
    "```\nTODO: examples inside fences are code, not prose\n```",
  ]) {
    assert.deepEqual(
      placeholderFindings(`${contract("purpose: Real purpose.")}# H\n\n${body}\n`),
      [],
      `should not flag: ${JSON.stringify(body)}`,
    );
  }

  // Any TODO/TBD/FIXME in the contract comment is a placeholder, and both
  // findings can surface at once.
  assert.deepEqual(placeholderFindings(`${contract("purpose: TODO: confirm this")}# H\n\nClean prose.\n`), [
    "section contract contains TODO/TBD/FIXME — complete purpose and acceptance in the contract header",
  ]);
  assert.equal(placeholderFindings(`${contract("purpose: TBD")}# H\n\nTODO: also unfinished.\n`).length, 2);
}

function testStatusSyncFromContracts() {
  const project = path.join(tmp, "status-sync");
  fs.mkdirSync(path.join(project, "draft"), { recursive: true });
  fs.mkdirSync(path.join(project, "state"), { recursive: true });

  fs.writeFileSync(
    path.join(project, "draft/01-a.md"),
    "<!--\nid: 01-a\nstatus: review\ntarget_words: 300\npurpose: P.\nacceptance:\n  - A.\n-->\n# A\n\nProse.\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, "state/status.md"),
    [
      "# Status",
      "",
      "| Section | File | Status | Purpose |",
      "| --- | --- | --- | --- |",
      "| A | `draft/01-a.md` | todo | Keeps its purpose cell |",
      "| Meta | n/a | done | Not a draft row |",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, "outline.md"),
    "# Outline\n\n### A\n\nStatus: todo\nFile: `draft/01-a.md`\n\n### Unlinked\n\nStatus: todo\n",
    "utf8",
  );

  const changed = syncSectionStatusesFromContracts(project);
  assert.deepEqual(changed.sort(), ["outline.md", "state/status.md"]);

  const table = fs.readFileSync(path.join(project, "state/status.md"), "utf8");
  assert.match(table, /\| A \| `draft\/01-a\.md` \| review \| Keeps its purpose cell \|/);
  assert.match(table, /\| Meta \| n\/a \| done \| Not a draft row \|/, "non-draft rows stay untouched");

  const outline = fs.readFileSync(path.join(project, "outline.md"), "utf8");
  assert.match(outline, /### A\n\nStatus: review\n/);
  assert.match(outline, /### Unlinked\n\nStatus: todo\n/, "blocks without File: stay untouched");

  assert.deepEqual(syncSectionStatusesFromContracts(project), [], "second sync is a no-op");
}

function testStatusSyncReconcilesMembership() {
  // Contracts (the draft files themselves) decide membership, not just
  // status: rows and outline blocks for deleted files go away — todo rows
  // included — and contracted files missing from a view are appended to it.
  const project = path.join(tmp, "membership-sync");
  fs.mkdirSync(path.join(project, "draft"), { recursive: true });
  fs.mkdirSync(path.join(project, "state"), { recursive: true });

  const contract = ({ id, status, purpose, heading }) =>
    `<!--\nid: ${id}\nstatus: ${status}\ntarget_words: 300\npurpose: ${purpose}\nacceptance:\n  - A.\n-->\n# ${heading}\n\nProse.\n`;

  fs.writeFileSync(path.join(project, "draft/01-a.md"), contract({ id: "01-a", status: "review", purpose: "P.", heading: "A" }), "utf8");
  fs.writeFileSync(path.join(project, "draft/02-new.md"), contract({ id: "02-new", status: "todo", purpose: "Cover the new ground.", heading: "New Ground" }), "utf8");
  fs.writeFileSync(path.join(project, "draft/_scratch.md"), contract({ id: "scratch", status: "draft", purpose: "Hidden.", heading: "Scratch" }), "utf8");
  fs.writeFileSync(path.join(project, "draft/03-raw.md"), "# Raw\n\nNo contract here.\n", "utf8");

  fs.writeFileSync(
    path.join(project, "state/status.md"),
    [
      "# Status",
      "",
      "| Section | File | Status | Notes |",
      "|---|---|---|---|",
      "| A | `draft/01-a.md` | todo | Keeps notes |",
      "| Gone | `draft/09-gone.md` | draft | Stale row |",
      "| Planned | `draft/07-planned.md` | todo | Never created |",
      "| Raw | `draft/03-raw.md` | draft | No contract |",
      "| Meta | n/a | done | Not a draft row |",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, "outline.md"),
    [
      "# Outline",
      "",
      "### A",
      "",
      "Status: todo",
      "File: `draft/01-a.md`",
      "",
      "### Gone",
      "",
      "Status: draft",
      "File: `draft/09-gone.md`",
      "",
      "### External",
      "",
      "Status: todo",
      "File: `notes/plan.md`",
      "",
      "### Unlinked",
      "",
      "Status: todo",
      "",
    ].join("\n"),
    "utf8",
  );

  const changed = syncSectionStatusesFromContracts(project);
  assert.deepEqual(changed.sort(), ["outline.md", "state/status.md"]);

  const table = fs.readFileSync(path.join(project, "state/status.md"), "utf8");
  assert.match(table, /\| A \| `draft\/01-a\.md` \| review \| Keeps notes \|/);
  assert.doesNotMatch(table, /09-gone/, "rows for deleted files are dropped");
  assert.doesNotMatch(table, /07-planned/, "todo rows for files that do not exist are dropped too");
  assert.match(table, /\| Raw \| `draft\/03-raw\.md` \| draft \| No contract \|/, "rows for contractless files stay untouched");
  assert.match(table, /\| Meta \| n\/a \| done \| Not a draft row \|/, "non-draft rows stay untouched");
  assert.match(table, /\| New Ground \| `draft\/02-new\.md` \| todo \| Cover the new ground\. \|/, "unlisted contracted files gain a row");
  assert.doesNotMatch(table, /_scratch/, "underscore-prefixed drafts stay out of the table");

  const outline = fs.readFileSync(path.join(project, "outline.md"), "utf8");
  assert.match(outline, /### A\n\nStatus: review\nFile: `draft\/01-a\.md`/);
  assert.doesNotMatch(outline, /### Gone|09-gone/, "blocks for deleted files are dropped");
  assert.match(outline, /### External\n\nStatus: todo\nFile: `notes\/plan\.md`/, "blocks naming non-draft files stay untouched");
  assert.match(outline, /### Unlinked\n\nStatus: todo\n/, "blocks without File: stay untouched");
  assert.match(outline, /### New Ground\n\nStatus: todo\nFile: `draft\/02-new\.md`\n\nPurpose: Cover the new ground\.\n/, "unlisted contracted files gain a block");
  assert.doesNotMatch(outline, /_scratch/);

  assert.deepEqual(syncSectionStatusesFromContracts(project), [], "second sync is a no-op");
}

function testStatusSyncHandlesEscapedPipes() {
  const project = path.join(tmp, "membership-pipes");
  fs.mkdirSync(path.join(project, "draft"), { recursive: true });
  fs.mkdirSync(path.join(project, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(project, "draft/01-pipe.md"),
    "<!--\nid: 01-pipe\nstatus: todo\ntarget_words: 100\npurpose: Compare A | B safely.\nacceptance:\n  - A.\n-->\n# Alpha | Beta\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, "draft/02-escaped-pipe.md"),
    "<!--\nid: 02-escaped-pipe\nstatus: todo\ntarget_words: 100\npurpose: Already escaped A \\| B.\nacceptance:\n  - A.\n-->\n# Gamma \\| Delta\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, "state/status.md"),
    "# Status\n\n| Section | File | Status | Notes |\n|---|---|---|---|\n",
    "utf8",
  );
  fs.writeFileSync(path.join(project, "outline.md"), "# Outline\n\n## Sections\n", "utf8");

  assert.deepEqual(syncSectionStatusesFromContracts(project).sort(), ["outline.md", "state/status.md"]);
  const table = fs.readFileSync(path.join(project, "state/status.md"), "utf8");
  assert.match(table, /\| Alpha \\\| Beta \| `draft\/01-pipe\.md` \| todo \| Compare A \\\| B safely\. \|/);
  assert.match(table, /\| Gamma \\\| Delta \| `draft\/02-escaped-pipe\.md` \| todo \| Already escaped A \\\| B\. \|/);
  assert.deepEqual(syncSectionStatusesFromContracts(project), [], "escaped pipes must not make the next sync append a duplicate");
  assert.equal((fs.readFileSync(path.join(project, "state/status.md"), "utf8").match(/draft\/01-pipe\.md/g) ?? []).length, 1);
  assert.equal((fs.readFileSync(path.join(project, "state/status.md"), "utf8").match(/draft\/02-escaped-pipe\.md/g) ?? []).length, 1);
}

function testOutlineMembershipPreservesGlobalContent() {
  const project = path.join(tmp, "membership-outline-boundaries");
  fs.mkdirSync(path.join(project, "draft"), { recursive: true });
  fs.mkdirSync(path.join(project, "state"), { recursive: true });
  const contract = ({ id, heading, status = "todo" }) =>
    `<!--\nid: ${id}\nstatus: ${status}\ntarget_words: 100\npurpose: ${heading} purpose.\nacceptance:\n  - A.\n-->\n# ${heading}\n`;
  fs.writeFileSync(path.join(project, "draft/01-keep.md"), contract({ id: "01-keep", heading: "Keep", status: "review" }), "utf8");
  fs.writeFileSync(path.join(project, "draft/02-new.md"), contract({ id: "02-new", heading: "New" }), "utf8");
  fs.writeFileSync(
    path.join(project, "state/status.md"),
    "# Status\n\n| Section | File | Status | Notes |\n|---|---|---|---|\n| Keep | `draft/01-keep.md` | todo | Existing. |\n| Gone | `draft/99-gone.md` | todo | Remove. |\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, "outline.md"),
    [
      "# Outline",
      "",
      "## Sections",
      "",
      "### Keep",
      "",
      "Status: todo",
      "File: `draft/01-keep.md`",
      "",
      "---",
      "",
      "### Gone",
      "",
      "Status: todo",
      "File: `draft/99-gone.md`",
      "",
      "## Editorial Notes",
      "",
      "This global note must survive membership repair.",
      "",
    ].join("\n"),
    "utf8",
  );

  syncSectionStatusesFromContracts(project);
  const outline = fs.readFileSync(path.join(project, "outline.md"), "utf8");
  assert.doesNotMatch(outline, /### Gone|99-gone/);
  assert.match(outline, /### Keep\n\nStatus: review/);
  assert.match(outline, /### New\n\nStatus: todo\nFile: `draft\/02-new\.md`/);
  assert.match(outline, /## Editorial Notes\n\nThis global note must survive membership repair\./);
  assert(
    outline.indexOf("### New") < outline.indexOf("## Editorial Notes"),
    "new section blocks must stay inside ## Sections instead of appending under a later heading",
  );
  assert.deepEqual(syncSectionStatusesFromContracts(project), [], "outline boundary repair must be idempotent");
}

function testPlainCheckHintsAtFix() {
  const workspace = path.join(tmp, "hint");
  writeSparseProject(workspace);

  const result = runDoccheck(["--static-only"], { cwd: workspace });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /- Missing required project file: brief\.md/);
  assert.match(result.stderr, /- Missing required project directory: state\/truth/);
  assert.match(result.stderr, /Run mlab check --fix to create missing scaffolding\./);
}

function testFixCreatesMissingScaffoldingIdempotently() {
  const workspace = path.join(tmp, "fix");
  const project = writeSparseProject(workspace);

  const fixed = runDoccheck(["--fix", "--static-only", "--json"], { cwd: workspace });
  assert.equal(fixed.status, 0, fixed.stderr || fixed.stdout);
  const parsed = JSON.parse(fixed.stdout);
  assert.equal(parsed.pass, true, JSON.stringify(parsed.errors, null, 2));
  assert.equal(parsed.fix, true);
  assert(parsed.fixed.includes("brief.md"));
  assert(parsed.fixed.includes("state/truth/style.json"));
  assert(parsed.fixed.includes("state/issues/issue-ledger.json"));

  for (const rel of REQUIRED_PROJECT_DIRS) {
    assert(fs.existsSync(path.join(project, rel)), `missing required dir after --fix: ${rel}`);
  }
  for (const rel of REQUIRED_PROJECT_FILES) {
    assert(fs.existsSync(path.join(project, rel)), `missing required file after --fix: ${rel}`);
  }

  const style = JSON.parse(fs.readFileSync(path.join(project, "state/truth/style.json"), "utf8"));
  assert.equal(style.schema_version, TRUTH_STATE_SCHEMA_VERSION);
  assert(style.style_profile && typeof style.style_profile === "object");
  const ledger = JSON.parse(fs.readFileSync(path.join(project, "state/issues/issue-ledger.json"), "utf8"));
  assert(Array.isArray(ledger.issues));

  const again = runDoccheck(["--fix", "--static-only", "--json"], { cwd: workspace });
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.deepEqual(JSON.parse(again.stdout).fixed, []);
}

function testFixReportsScaffoldingConflictsCleanly() {
  // A required directory shadowed by a regular file must produce a clean
  // actionable error from --fix, not an unhandled EEXIST stack trace.
  const workspace = path.join(tmp, "fix-conflict");
  const project = writeSparseProject(workspace);
  fs.mkdirSync(path.join(project, "state"), { recursive: true });
  fs.writeFileSync(path.join(project, "state/truth"), "oops\n", "utf8");

  const result = runDoccheck(["--fix", "--static-only"], { cwd: workspace });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Cannot create required scaffolding:/);
  assert.match(result.stderr, /Cannot create state\/truth: state\/truth exists as a file/);
  assert.match(result.stderr, /Cannot create state\/truth\/entities\.json: state\/truth exists as a file/);
  assert.match(result.stderr, /re-run mlab check --fix/);
  assert.doesNotMatch(result.stderr, /EEXIST|ENOTDIR/, "conflicts must not surface as raw fs errors");
  assert.doesNotMatch(result.stderr, /at .*required-scaffolding\.mjs/, "conflicts must not print a stack trace");
  assert(fs.statSync(path.join(project, "state/truth")).isFile(), "--fix must not delete the shadowing file");
}

function testFixRefusesWithoutProject() {
  const workspace = path.join(tmp, "no-project");
  fs.mkdirSync(workspace, { recursive: true });

  const result = runDoccheck(["--fix", "--static-only"], { cwd: workspace });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No Manuscript Lab project found/);
  assert.equal(fs.existsSync(path.join(workspace, "state")), false, "--fix must not scaffold without a project");
}

function testInstallInitSatisfiesRequiredScaffolding() {
  // Drift guard: a fresh install-anywhere workspace must satisfy the shared
  // required-scaffolding list without any --fix step.
  const workspace = path.join(tmp, "install-init");
  fs.mkdirSync(workspace, { recursive: true });

  const init = spawnSync(process.execPath, [path.join(repoRoot, "scripts/install-init.mjs"), "--json", "--title", "Drift Guard"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const project = path.join(workspace, "manuscript");
  for (const rel of REQUIRED_PROJECT_FILES) {
    assert(fs.existsSync(path.join(project, rel)), `install-init did not create required file: ${rel}`);
  }
  const style = JSON.parse(fs.readFileSync(path.join(project, "state/truth/style.json"), "utf8"));
  assert.equal(style.schema_version, TRUTH_STATE_SCHEMA_VERSION);

  const check = runDoccheck(["--static-only"], { cwd: workspace });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.doesNotMatch(check.stderr, /Missing required project/);
}

function testFixReconcilesRenamedSectionsAfterInit() {
  // Regression: after init, deleting the generated sections and creating new
  // ones with different ids/filenames must not leave state/status.md and
  // outline.md describing files that no longer exist, and the new sections
  // must be adopted into both views instead of warning forever.
  const workspace = path.join(tmp, "membership-e2e");
  fs.mkdirSync(workspace, { recursive: true });

  const init = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts/install-init.mjs"), "--json", "--title", "Membership Repro", "--sections", "5"],
    { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const project = path.join(workspace, "manuscript");
  const generated = ["01-opening", "02-problem", "03-evidence", "04-approach", "05-risks"];
  for (const stale of generated) {
    fs.rmSync(path.join(project, `draft/${stale}.md`));
  }
  write(path.join(project, "draft/01-thesis.md"), `<!--
id: 01-thesis
kind: document.section
status: draft
target_words: 120
purpose: State the core thesis and stakes.
acceptance:
  - Exists.
-->
# Thesis

${Array.from({ length: 60 }, (_, index) => `word${index + 1}`).join(" ")}
`);
  write(path.join(project, "draft/02-method.md"), `<!--
id: 02-method
kind: document.section
status: todo
target_words: 500
purpose: Explain the method.
acceptance:
  - Exists.
-->
# Method
`);

  const fixed = runDoccheck(["--fix", "--static-only", "--json"], { cwd: workspace });
  assert.equal(fixed.status, 0, fixed.stderr || fixed.stdout);
  const parsed = JSON.parse(fixed.stdout);
  assert.equal(parsed.pass, true, JSON.stringify(parsed.errors, null, 2));
  assert.deepEqual(parsed.synced.sort(), ["outline.md", "state/status.md"]);
  assert.deepEqual(
    parsed.warnings.filter((warning) => warning.includes("not listed in state/status.md")),
    [],
    "new sections must be listed after --fix",
  );

  const table = fs.readFileSync(path.join(project, "state/status.md"), "utf8");
  for (const stale of generated) {
    assert.doesNotMatch(table, new RegExp(stale), `stale status row survived --fix: ${stale}`);
  }
  assert.match(table, /\| Title \| `draft\/00-title\.md` \| todo \|/);
  assert.match(table, /\| Thesis \| `draft\/01-thesis\.md` \| draft \| State the core thesis and stakes\. \|/);
  assert.match(table, /\| Method \| `draft\/02-method\.md` \| todo \| Explain the method\. \|/);

  const outline = fs.readFileSync(path.join(project, "outline.md"), "utf8");
  for (const stale of generated) {
    assert.doesNotMatch(outline, new RegExp(stale), `stale outline block survived --fix: ${stale}`);
  }
  assert.match(outline, /### Thesis\n\nStatus: draft\nFile: `draft\/01-thesis\.md`\n\nPurpose: State the core thesis and stakes\.\n/);
  assert.match(outline, /### Method\n\nStatus: todo\nFile: `draft\/02-method\.md`\n\nPurpose: Explain the method\.\n/);

  const again = runDoccheck(["--fix", "--static-only", "--json"], { cwd: workspace });
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.deepEqual(JSON.parse(again.stdout).synced, [], "membership sync must be idempotent");
}

function writeSparseProject(workspace) {
  const project = path.join(workspace, "manuscript");
  fs.mkdirSync(path.join(project, "draft"), { recursive: true });
  writeJson(path.join(workspace, "manuscript-lab.config.json"), {
    schemaVersion: 1,
    profile: "whitepaper",
    root: "manuscript",
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
    sourcesDir: "sources",
    profileOptions: {},
  });
  write(path.join(project, "outline.md"), "# Outline\n");
  write(path.join(project, "style.md"), "# Style\n");
  write(path.join(project, "draft/01-a.md"), `<!--
id: 01-a
kind: document.section
status: draft
target_words: 60
purpose: Exercise check --fix.
acceptance:
  - Exists.
-->
# A

${Array.from({ length: 30 }, (_, index) => `word${index + 1}`).join(" ")}
`);
  return project;
}

function runDoccheck(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/doccheck.mjs"), ...args], {
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
