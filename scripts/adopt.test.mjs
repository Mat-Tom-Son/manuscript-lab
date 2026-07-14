#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadKnownCheckIds, loadKnownReviewIds } from "./lib/protocol.mjs";
import { parseContractList, parseSectionContract, validateSectionContract, wordCount } from "./lib/section-contract.mjs";

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-adopt-"));
const knownCheckIds = loadKnownCheckIds(repoRoot);
const knownReviewIds = loadKnownReviewIds(repoRoot);
const NEXT_STEPS = ["mlab status", "mlab check --static-only", "mlab report --write"];
const FILLER =
  "The imported prose keeps enough plain words for the protocol validator to accept a started draft section without complaint, which keeps this fixture honest about the real adoption flow and its downstream checks.";

try {
  testAdoptSingleFile();
  testAdoptDirectory();
  testAdoptH1Split();
  testAdoptH2SplitKeepsPreamble();
  testAdoptReimportReplacesExistingContract();
  testAdoptSanitizesControlBytesInPurpose();
  testAdoptRefusesWhenConfigExists();
  testAdoptDryRunWritesNothing();
  testAdoptArgumentErrors();
  console.log("adopt tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function testAdoptSingleFile() {
  const workspace = path.join(tmp, "single");
  const sources = path.join(tmp, "single-sources");
  mkdir(workspace);
  mkdir(sources);
  const sourceFile = path.join(sources, "my-old-draft.md");
  const original = ["# Field Notes", "", FILLER, "", "## What Worked", "", FILLER, ""].join("\n");
  fs.writeFileSync(sourceFile, original, "utf8");

  const result = runAdopt([sourceFile, "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "adopt");
  assert.equal(parsed.dry_run, false);
  assert.equal(parsed.root, "manuscript");
  assert.equal(parsed.split, "file");
  assert.equal(parsed.title, "Field Notes", "title should derive from the first heading");
  assert.deepEqual(parsed.next_steps, NEXT_STEPS);
  assert.equal(parsed.sections.length, 1);

  const [section] = parsed.sections;
  assert.equal(section.id, "01-my-old-draft");
  assert.equal(section.file, "draft/01-my-old-draft.md");
  assert.equal(section.source, "my-old-draft.md");
  assert.equal(section.replaced_existing_contract, false, "plain markdown sources carry no contract to replace");
  const expectedWords = wordCount(original);
  assert.equal(section.words, expectedWords);
  assert.equal(section.target_words, Math.max(300, Math.ceil((expectedWords * 1.2) / 50) * 50));

  assert.equal(fs.readFileSync(sourceFile, "utf8"), original, "source file must never be modified");

  for (const rel of [
    "manuscript-lab.config.json",
    "manuscript/PROJECT.md",
    "manuscript/brief.md",
    "manuscript/outline.md",
    "manuscript/style.md",
    "manuscript/sources/index.md",
    "manuscript/state/status.md",
    "manuscript/state/claims.md",
    "manuscript/state/issues/issue-ledger.json",
    "manuscript/state/truth/entities.json",
    "manuscript/taste/TASTE.md",
    "manuscript/draft/01-my-old-draft.md",
  ]) {
    assert(fs.existsSync(path.join(workspace, rel)), `missing scaffold file ${rel}`);
  }
  assert(parsed.files_written.includes("manuscript-lab.config.json"));
  assert(parsed.files_written.includes("manuscript/draft/01-my-old-draft.md"));

  const config = JSON.parse(fs.readFileSync(path.join(workspace, "manuscript-lab.config.json"), "utf8"));
  assert.equal(config.profile, "whitepaper");
  assert.equal(config.root, "manuscript");
  assert.equal(config.profileOptions.title, "Field Notes");
  assert.equal(config.profileOptions.sections, 1);

  const draft = fs.readFileSync(path.join(workspace, "manuscript/draft/01-my-old-draft.md"), "utf8");
  assert.equal(bodyOf(draft), original, "imported body must be the source content verbatim");
  assertAdoptedContract(draft, {
    file: "draft/01-my-old-draft.md",
    id: "01-my-old-draft",
    targetWords: section.target_words,
    sourceLabel: "my-old-draft.md",
  });
  assert.match(parseSectionContract(draft).get("purpose"), /\(Field Notes\)$/);

  const validate = runValidate(["--json"], { cwd: workspace });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  const validated = JSON.parse(validate.stdout);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors ?? [], null, 2));
  assert.equal(validated.draft_count, 1);
  assert.equal(validated.drafts[0].status, "draft");
}

function testAdoptDirectory() {
  const sources = path.join(tmp, "directory-sources");
  mkdir(path.join(sources, "nested"));
  mkdir(path.join(sources, ".hidden"));
  mkdir(path.join(sources, "node_modules"));
  fs.writeFileSync(path.join(sources, "a-intro.md"), `# Intro\n\n${FILLER}\n\n${FILLER}\n`, "utf8");
  fs.writeFileSync(path.join(sources, "b-notes.md"), `${FILLER}\n\n${FILLER}\n`, "utf8");
  fs.writeFileSync(path.join(sources, "nested", "c-extra.md"), `# Extra Material\n\n${FILLER}\n\n${FILLER}\n`, "utf8");
  fs.writeFileSync(path.join(sources, ".hidden", "skip.md"), "# Skip Hidden\n\nHidden content.\n", "utf8");
  fs.writeFileSync(path.join(sources, "node_modules", "skip.md"), "# Skip Modules\n\nPackage content.\n", "utf8");
  fs.writeFileSync(path.join(sources, ".stray.md"), "# Skip Dotfile\n\nDotfile content.\n", "utf8");
  fs.writeFileSync(path.join(sources, "notes.txt"), "Not markdown.\n", "utf8");

  const workspace = path.join(tmp, "directory");
  mkdir(workspace);
  const result = runAdopt([sources, "--title", "Adopted Directory", "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.title, "Adopted Directory");
  assert.deepEqual(
    parsed.sections.map((section) => section.file),
    ["draft/01-a-intro.md", "draft/02-b-notes.md", "draft/03-c-extra.md"],
    "sections should follow sorted source order",
  );
  assert.deepEqual(
    parsed.sections.map((section) => section.source),
    ["a-intro.md", "b-notes.md", "nested/c-extra.md"],
  );
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ["Intro", "B Notes", "Extra Material"],
    "titles come from headings, else the title-cased file name",
  );
  assert(
    parsed.sections.every((section) => !/skip|stray/.test(section.source)),
    "hidden directories, dotfiles, and node_modules must be skipped",
  );

  for (const section of parsed.sections) {
    const draft = fs.readFileSync(path.join(workspace, "manuscript", section.file), "utf8");
    const original = fs.readFileSync(path.join(sources, section.source), "utf8");
    assert.equal(bodyOf(draft), original, `${section.file} body must be verbatim`);
    assertAdoptedContract(draft, {
      file: section.file,
      id: section.id,
      targetWords: section.target_words,
      sourceLabel: section.source,
    });
  }

  const validate = runValidate(["--json"], { cwd: workspace });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  assert.equal(JSON.parse(validate.stdout).draft_count, 3);

  const textWorkspace = path.join(tmp, "directory-text");
  mkdir(textWorkspace);
  const text = runAdopt([sources], { cwd: textWorkspace });
  assert.equal(text.status, 0, text.stderr || text.stdout);
  assert.match(text.stdout, /Adopted 3 sections into manuscript\/draft \(split: file\)/);
  assert.match(text.stdout, /draft\/01-a-intro\.md/);
  assert.match(text.stdout, /Next:/);
  for (const step of NEXT_STEPS) assert(text.stdout.includes(step), `terminal output should include "${step}"`);
}

function testAdoptH1Split() {
  const workspace = path.join(tmp, "h1");
  mkdir(workspace);
  const content = [
    "# Alpha",
    "",
    FILLER,
    "",
    "```txt",
    "# not a heading inside a fence",
    "```",
    "",
    FILLER,
    "",
    "# Beta",
    "",
    FILLER,
    "",
    FILLER,
  ].join("\n") + "\n";
  const sourceFile = path.join(workspace, "whitepaper.md");
  fs.writeFileSync(sourceFile, content, "utf8");

  const result = runAdopt(["whitepaper.md", "--split", "h1", "--title", "Custom Title", "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.split, "h1");
  assert.equal(parsed.title, "Custom Title");
  assert.equal(parsed.sections.length, 2, "the fenced pseudo-heading must not create a third section");
  assert.deepEqual(
    parsed.sections.map((section) => section.file),
    ["draft/01-alpha.md", "draft/02-beta.md"],
  );

  const draft1 = fs.readFileSync(path.join(workspace, "manuscript/draft/01-alpha.md"), "utf8");
  const draft2 = fs.readFileSync(path.join(workspace, "manuscript/draft/02-beta.md"), "utf8");
  const body1 = bodyOf(draft1);
  const body2 = bodyOf(draft2);
  assert(body1.startsWith("# Alpha\n"), "split sections keep their heading line");
  assert(body2.startsWith("# Beta\n"));
  assert(body1.includes("# not a heading inside a fence"));
  assert.equal(body1 + body2, content, "split bodies must reassemble the source verbatim");

  assertAdoptedContract(draft1, {
    file: "draft/01-alpha.md",
    id: "01-alpha",
    targetWords: parsed.sections[0].target_words,
    sourceLabel: "whitepaper.md",
  });
  assertAdoptedContract(draft2, {
    file: "draft/02-beta.md",
    id: "02-beta",
    targetWords: parsed.sections[1].target_words,
    sourceLabel: "whitepaper.md",
  });
  assert.match(parseSectionContract(draft1).get("purpose"), /\(Alpha\)$/);
  assert.equal(parsed.sections[0].words, wordCount(body1));

  assert.equal(fs.readFileSync(sourceFile, "utf8"), content, "in-workspace source must stay untouched");

  const validate = runValidate(["--json"], { cwd: workspace });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);

  const dirSources = path.join(tmp, "h1-dir-sources");
  mkdir(dirSources);
  fs.writeFileSync(path.join(dirSources, "one.md"), "# One\n\nBody.\n", "utf8");
  const dirWorkspace = path.join(tmp, "h1-dir-workspace");
  mkdir(dirWorkspace);
  const refused = runAdopt([dirSources, "--split", "h1"], { cwd: dirWorkspace });
  assert.equal(refused.status, 2, refused.stderr || refused.stdout);
  assert.match(refused.stderr, /needs a single source file/i);
  assert.equal(fs.existsSync(path.join(dirWorkspace, "manuscript-lab.config.json")), false);
}

function testAdoptH2SplitKeepsPreamble() {
  const workspace = path.join(tmp, "h2");
  mkdir(workspace);
  const content = [
    "# Big Doc",
    "",
    FILLER,
    "",
    "## Part One",
    "",
    FILLER,
    "",
    "## Part Two",
    "",
    FILLER,
  ].join("\n") + "\n";
  const sourceFile = path.join(workspace, "big-doc.md");
  fs.writeFileSync(sourceFile, content, "utf8");

  const result = runAdopt(["big-doc.md", "--split", "h2", "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(
    parsed.sections.map((section) => section.file),
    ["draft/01-big-doc.md", "draft/02-part-one.md", "draft/03-part-two.md"],
    "the preamble before the first h2 becomes its own leading section",
  );

  const bodies = parsed.sections.map((section) =>
    bodyOf(fs.readFileSync(path.join(workspace, "manuscript", section.file), "utf8")),
  );
  assert(bodies[0].startsWith("# Big Doc\n"));
  assert(bodies[1].startsWith("## Part One\n"));
  assert(bodies[2].startsWith("## Part Two\n"));
  assert.equal(bodies.join(""), content, "h2 split bodies must reassemble the source verbatim");
}

function testAdoptReimportReplacesExistingContract() {
  const workspace = path.join(tmp, "reimport");
  const sources = path.join(tmp, "reimport-sources");
  mkdir(workspace);
  mkdir(sources);
  const staleContract = [
    "<!--",
    "id: existing-01",
    "kind: document.section",
    "status: ready",
    "target_words: 750",
    "purpose: Stale purpose from the previous workspace.",
    "acceptance:",
    "  - Old acceptance line.",
    "-->",
  ].join("\n");
  const prose = `# Migrated Section\n\n${FILLER}\n`;
  const sourceFile = path.join(sources, "migrated-section.md");
  fs.writeFileSync(sourceFile, `${staleContract}\n${prose}`, "utf8");

  const result = runAdopt([sourceFile, "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  const [section] = parsed.sections;
  assert.equal(section.replaced_existing_contract, true, "re-import should report the replaced contract");
  assert.equal(section.words, wordCount(prose), "old contract lines must not count as prose");

  const draft = fs.readFileSync(path.join(workspace, "manuscript", section.file), "utf8");
  assert.equal((draft.match(/<!--/g) ?? []).length, 1, "the written draft must carry exactly one contract comment");
  assert(!draft.includes("existing-01"), "the stale contract must be stripped from the body");
  assert(!draft.includes("Stale purpose"), "the stale contract fields must not survive");
  assert.equal(bodyOf(draft), `${prose.trim()}\n`, "the stripped body keeps the prose");
  assertAdoptedContract(draft, {
    file: section.file,
    id: section.id,
    targetWords: section.target_words,
    sourceLabel: "migrated-section.md",
  });
  assert.equal(parseSectionContract(draft).get("status"), "draft", "the fresh inferred contract wins");

  const validate = runValidate(["--json"], { cwd: workspace });
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);

  const textWorkspace = path.join(tmp, "reimport-text");
  mkdir(textWorkspace);
  const text = runAdopt([sourceFile], { cwd: textWorkspace });
  assert.equal(text.status, 0, text.stderr || text.stdout);
  assert.match(text.stdout, /\[replaced existing section contract\]/);
}

function testAdoptSanitizesControlBytesInPurpose() {
  const workspace = path.join(tmp, "control-bytes");
  const sources = path.join(tmp, "control-bytes-sources");
  mkdir(workspace);
  mkdir(sources);
  const sourceFile = path.join(sources, "a.md");
  fs.writeFileSync(sourceFile, `# Head\u0000Injected\n\n${FILLER}\n`, "utf8");

  const result = runAdopt([sourceFile, "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);

  const draft = fs.readFileSync(path.join(workspace, "manuscript", parsed.sections[0].file), "utf8");
  const purpose = parseSectionContract(draft).get("purpose");
  assert.doesNotMatch(purpose, /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/, "purpose must not carry control bytes");
  assert.match(purpose, /HeadInjected/, "sanitizing should keep the printable heading text");
  const contractComment = draft.slice(0, draft.indexOf("-->"));
  assert.doesNotMatch(contractComment, /\u0000/, "the written contract must not contain NUL bytes");
}

function testAdoptRefusesWhenConfigExists() {
  const workspace = path.join(tmp, "refuse");
  mkdir(workspace);
  fs.writeFileSync(path.join(workspace, "notes.md"), `# Notes\n\n${FILLER}\n`, "utf8");
  fs.writeFileSync(
    path.join(workspace, "manuscript-lab.config.json"),
    `${JSON.stringify({ schemaVersion: 1, profile: "whitepaper", root: "manuscript", draftGlob: "draft/*.md", stateDir: "state", exportsDir: "exports" }, null, 2)}\n`,
    "utf8",
  );
  const before = fs.readdirSync(workspace).sort();

  const result = runAdopt(["notes.md"], { cwd: workspace });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /already initialized/i);
  assert.match(result.stderr, /docs\/GETTING_STARTED\.md/);
  assert.deepEqual(fs.readdirSync(workspace).sort(), before, "refusal must not write anything");

  const json = runAdopt(["notes.md", "--json"], { cwd: workspace });
  assert.equal(json.status, 2);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join("\n"), /already initialized/i);
}

function testAdoptDryRunWritesNothing() {
  const workspace = path.join(tmp, "dry-run");
  mkdir(workspace);
  fs.writeFileSync(path.join(workspace, "notes.md"), `# Dry Run Notes\n\n${FILLER}\n`, "utf8");
  const before = fs.readdirSync(workspace).sort();

  const result = runAdopt(["notes.md", "--dry-run", "--json"], { cwd: workspace });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.dry_run, true);
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].file, "draft/01-notes.md");
  assert(parsed.sections[0].target_words >= 300);
  assert.deepEqual(parsed.files_written, []);
  assert.deepEqual(parsed.next_steps, NEXT_STEPS);

  const text = runAdopt(["notes.md", "--dry-run"], { cwd: workspace });
  assert.equal(text.status, 0, text.stderr || text.stdout);
  assert.match(text.stdout, /Dry run: no files written\./);
  assert.match(text.stdout, /Would adopt 1 section into manuscript\/draft/);

  assert.deepEqual(fs.readdirSync(workspace).sort(), before, "dry-run must not create any files");
  assert.equal(fs.existsSync(path.join(workspace, "manuscript-lab.config.json")), false);
  assert.equal(fs.existsSync(path.join(workspace, "manuscript")), false);
}

function testAdoptArgumentErrors() {
  const workspace = path.join(tmp, "arg-errors");
  mkdir(workspace);

  const missing = runAdopt([], { cwd: workspace });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires a source markdown file or directory/i);

  const badSplit = runAdopt(["notes.md", "--split", "h3"], { cwd: workspace });
  assert.equal(badSplit.status, 2);
  assert.match(badSplit.stderr, /Unsupported --split/);

  const absent = runAdopt(["missing.md"], { cwd: workspace });
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /does not exist/);

  const help = runAdopt(["--help"], { cwd: workspace });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /adopt - create a Manuscript Lab workspace/);
  assert.match(help.stdout, /--dry-run/);

  assert.deepEqual(fs.readdirSync(workspace), [], "argument errors must not write anything");
}

function assertAdoptedContract(text, { file, id, targetWords, sourceLabel }) {
  const validation = validateSectionContract({ text, file, knownCheckIds, knownReviewIds });
  assert.deepEqual(validation.errors, [], `contract for ${file} should validate: ${validation.errors.join("; ")}`);

  const contract = validation.contract;
  assert.equal(contract.get("id"), id);
  assert.equal(contract.get("kind"), "document.section");
  assert.equal(contract.get("status"), "draft");
  assert.equal(Number(contract.get("target_words")), targetWords);
  assert(Number(contract.get("target_words")) >= 300, "target_words floor is 300");
  const purpose = contract.get("purpose");
  assert.match(purpose, /^TODO: confirm — imported from /);
  assert(purpose.includes(sourceLabel), `purpose should name the source ${sourceLabel}: ${purpose}`);
  assert(contract.has("acceptance"), "contract should declare acceptance");

  const comment = text.slice(0, text.indexOf("-->"));
  assert.equal((comment.match(/^ {2}- TODO:/gm) ?? []).length, 2, "acceptance should carry two TODO bullets");

  assert.deepEqual(parseContractList(text, "checks"), ["claims.supported", "style.violations"]);
  assert.deepEqual(parseContractList(text, "reviews"), ["cold.reader", "contract.editor"]);
}

function bodyOf(text) {
  const marker = "-->\n";
  const index = text.indexOf(marker);
  assert.notEqual(index, -1, "draft should start with a section contract comment");
  return text.slice(index + marker.length);
}

function runAdopt(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/adopt.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runValidate(args, { cwd }) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts/protocol-validate.mjs"), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
