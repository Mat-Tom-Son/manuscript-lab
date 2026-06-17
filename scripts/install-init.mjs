#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, discoverProtocol, validatePortableRelativePath } from "./lib/protocol.mjs";
import { normalizeRel, safeId } from "./lib/section-contract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = "manuscript";
const DEFAULT_PROFILE = "whitepaper";
const DEFAULT_TITLE = "Untitled Whitepaper";
const DEFAULT_SECTIONS = 1;
const DEFAULT_TARGET_WORDS = 900;
const RESERVED_ROOTS = new Set([".git", ".pi", "bin", "checks", "docs", "node_modules", "reviews", "scripts", "skills", "templates"]);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execution = runInstallInit(process.argv.slice(2), { cwd: process.cwd() });
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  process.exitCode = execution.exitCode;
}

export function runInstallInit(rawArgs, env = {}) {
  const options = parseArgs(rawArgs);
  if (options.help) return { exitCode: 0, stdout: helpText(), stderr: "" };
  if (options.errors.length) return formatError(options.errors, options);

  try {
    const result = initInstalledProject({ ...options, cwd: env.cwd ?? process.cwd() });
    return formatSuccess(result, options);
  } catch (error) {
    return formatError([error.message], options);
  }
}

export function initInstalledProject(options = {}) {
  const workspaceRoot = path.resolve(options.cwd ?? process.cwd());
  const profile = normalizeProfile(options.profile ?? DEFAULT_PROFILE);
  const root = normalizeRel(options.root ?? DEFAULT_ROOT);
  const rootError = validatePortableRelativePath(root, { allowDot: false });
  if (rootError) throw new Error(`Project root is invalid: ${rootError}`);
  if (root === ".") throw new Error("Project root must be a subdirectory such as manuscript.");
  if (RESERVED_ROOTS.has(root.split("/")[0])) throw new Error(`Project root "${root}" is reserved for package or tool files.`);
  if (!["whitepaper", "document"].includes(profile)) {
    throw new Error(`Unsupported profile "${profile}". The install-anywhere workflow supports "whitepaper".`);
  }

  const title = normalizeTitle(options.title ?? DEFAULT_TITLE);
  const sections = positiveInt(options.sections ?? DEFAULT_SECTIONS, "sections");
  const targetWords = positiveInt(options.targetWords ?? DEFAULT_TARGET_WORDS, "target-words");
  const kind = String(options.kind ?? "document.section").trim() || "document.section";
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  const manuscriptRoot = path.resolve(workspaceRoot, root);

  assertSafeInitTarget({ workspaceRoot, manuscriptRoot, configPath, force: options.force });

  const config = buildInstalledConfig({ profile, root, title, sections, targetWords, kind });
  const plan = whitepaperSectionPlan({ sections, kind, targetWords });
  const written = [];

  writeJson(configPath, config, { written });
  writeInstalledScaffold({ manuscriptRoot, root, profile, title, plan, written });

  return {
    ok: true,
    mode: "installed",
    profile,
    root,
    workspace_root: workspaceRoot,
    manuscript_root: manuscriptRoot,
    config_path: configPath,
    files_written: written.map((file) => normalizeRel(path.relative(workspaceRoot, file))).sort(),
    next_steps: [
      "npx mlab validate",
      "npx mlab claims list --json",
      "npx mlab gate draft/01-opening.md",
    ],
  };
}

export function buildInstalledConfig({ profile, root, title, sections, targetWords, kind }) {
  return {
    schemaVersion: 1,
    profile,
    root,
    draftGlob: "draft/*.md",
    stateDir: "state",
    exportsDir: "exports",
    sourcesDir: "sources",
    tasteDir: "taste",
    checks: {
      default: ["claims.supported", "style.violations"],
    },
    reviews: {
      default: ["cold.reader", "contract.editor"],
    },
    model: {
      provider: "",
      section_model: "",
      reviewer_model: "",
    },
    profileOptions: {
      title,
      sections,
      kind,
      targetWords,
    },
  };
}

export function assertSafeInitTarget({ workspaceRoot, manuscriptRoot, configPath, force = false }) {
  if (isPackageRoot(workspaceRoot) && !force) {
    throw new Error("Install-anywhere init should run in your document workspace. In this repository, use project:init or story:init.");
  }

  const discovered = discoverProtocol({ cwd: workspaceRoot });
  if (discovered.configPath && path.resolve(discovered.configPath) !== path.resolve(configPath) && !force) {
    throw new Error(`Already inside a Manuscript Lab workspace at ${discovered.configPath}. Run init from a new project directory.`);
  }

  if (!isPathInsideOrEqual(manuscriptRoot, workspaceRoot)) {
    throw new Error("Project root must stay inside the workspace.");
  }
  if (fs.existsSync(configPath) && !force) {
    throw new Error(`${CONFIG_FILE} already exists. Re-run with --force to overwrite the scaffold files.`);
  }

  const stat = fs.statSync(manuscriptRoot, { throwIfNoEntry: false });
  if (stat?.isFile()) throw new Error(`Project root already exists as a file: ${manuscriptRoot}`);
  if (stat?.isDirectory() && fs.readdirSync(manuscriptRoot).length > 0 && !force) {
    throw new Error(`Project root is not empty: ${manuscriptRoot}`);
  }
}

export function writeInstalledScaffold({ manuscriptRoot, root, profile, title, plan, written }) {
  const sectionFiles = plan.map((section) => section.file);
  ensureScaffoldDirs(manuscriptRoot, { written });

  write(path.join(manuscriptRoot, "PROJECT.md"), projectSupplement({ title, profile, root }), { written });
  write(path.join(manuscriptRoot, "brief.md"), briefScaffold({ title }), { written });
  write(path.join(manuscriptRoot, "outline.md"), outlineScaffold({ title, plan }), { written });
  write(path.join(manuscriptRoot, "style.md"), styleScaffold(), { written });
  write(path.join(manuscriptRoot, "docs/PROJECT_HANDOFF.md"), projectHandoffScaffold({ title }), { written });
  write(path.join(manuscriptRoot, "docs/PROJECT_REVIEW_APPROACH.md"), projectReviewApproachScaffold(), { written });
  write(path.join(manuscriptRoot, "sources/index.md"), sourceIndexScaffold(), { written });
  write(path.join(manuscriptRoot, "state/status.md"), statusScaffold(plan), { written });
  write(path.join(manuscriptRoot, "state/claims.md"), claimsScaffold(), { written });
  write(path.join(manuscriptRoot, "state/continuity.md"), continuityScaffold(), { written });
  write(path.join(manuscriptRoot, "state/open-questions.md"), openQuestionsScaffold(), { written });
  writeTasteFiles(manuscriptRoot, { written });
  writeIssueStateFiles(manuscriptRoot, { written });
  writeTruthStateFiles(manuscriptRoot, { written });

  for (const section of plan) {
    write(path.join(manuscriptRoot, section.file), draftScaffold({ section }), { written });
  }

  write(path.join(manuscriptRoot, "README.md"), workspaceReadme({ title, root, sectionFiles }), { written });
}

export function whitepaperSectionPlan({ sections, kind, targetWords }) {
  const base = [
    ["01-opening", "Opening", "Frame the reader problem, document promise, and evidence standard."],
    ["02-problem", "Problem", "Define the problem, stakes, constraints, and current failure mode."],
    ["03-evidence", "Evidence", "Summarize the strongest support, examples, and source-backed claims."],
    ["04-approach", "Approach", "Explain the proposed model, method, architecture, or operating path."],
    ["05-risks", "Risks", "Name tradeoffs, limits, dependencies, and open decisions plainly."],
    ["06-close", "Close", "End with the reader action, decision, or next review milestone."],
  ];

  const title = {
    id: "00-title",
    label: "Title",
    file: "draft/00-title.md",
    kind: "frontmatter.title",
    status: "todo",
    targetWords: 25,
    purpose: "Hold the working title and optional subtitle for export.",
  };

  const body = Array.from({ length: sections }, (_, index) => {
    const fallback = String(index + 1).padStart(2, "0");
    const template = base[index] ?? [`${fallback}-section-${index + 1}`, `Section ${index + 1}`, "Advance one clear part of the document argument."];
    const [id, label, purpose] = template;
    return {
      id,
      label,
      file: `draft/${id}.md`,
      kind,
      status: "todo",
      targetWords,
      purpose,
    };
  });
  return [title, ...body];
}

function ensureScaffoldDirs(root, { written }) {
  for (const dir of [
    "draft",
    "docs",
    "exports",
    "sources",
    "style",
    "taste",
    "taste/accepted_patches",
    "taste/rejected_patches",
    "state",
    "state/chorus",
    "state/issues",
    "state/runtime",
    "state/reviews",
    "state/room",
    "state/revision-audits",
    "state/revision-plans",
    "state/candidates",
    "state/style",
    "state/taste",
    "state/truth",
    "state/model-calls",
    "state/logs",
    "state/projections",
    "state/observations",
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }

  const readmes = {
    "state/chorus/README.md": "Chorus prose ensemble artifacts live here.\n",
    "style/README.md": "Project-local style artifacts live here.\n",
    "taste/accepted_patches/README.md": "Accepted taste examples live here.\n",
    "taste/rejected_patches/README.md": "Rejected taste examples live here.\n",
    "state/issues/README.md": "Issue ledger artifacts live here.\n",
    "state/runtime/README.md": "Composed runtime packets live here.\n",
    "state/reviews/README.md": "Review run artifacts live here.\n",
    "state/room/README.md": "Writers' room protocol artifacts live here.\n",
    "state/revision-audits/README.md": "Revision diff audit artifacts live here.\n",
    "state/revision-plans/README.md": "Revision plan artifacts live here.\n",
    "state/candidates/README.md": "Revision candidate arena artifacts live here.\n",
    "state/style/README.md": "Style calibration artifacts live here.\n",
    "state/taste/README.md": "Generated taste arbiter artifacts live here.\n",
    "state/truth/README.md": "Structured truth state lives here.\n",
    "state/model-calls/README.md": "Model-call artifacts live here when captured for local debugging.\n",
    "state/logs/README.md": "Project work logs live here.\n",
    "state/projections/README.md": "Human-readable truth projections live here.\n",
    "state/observations/README.md": "Observation artifacts live here.\n",
  };
  for (const [rel, content] of Object.entries(readmes)) write(path.join(root, rel), content, { written, ifMissing: true });
}

function projectSupplement({ title, profile, root }) {
  return `# Project Supplement

Project: ${title}
Profile: ${profile}
Root: \`${root}\`

Use this file for project-specific operating notes that should load after the
generic Manuscript Lab instructions. Keep it compact, durable, and free of
private credentials.

## Working Rules

- Treat draft files as the source of truth for prose.
- Keep factual claims either source-backed in \`state/claims.md\` or marked in
  the draft with \`[citation-needed]\` while drafting.
- Update \`state/status.md\` whenever a section contract status changes.
- Keep project-specific voice and reader expectations in \`taste/\` and
  \`style.md\`, not in reusable package prompts.
`;
}

function briefScaffold({ title }) {
  return `# Brief

Working title: ${title}

## Goal

Name the document's specific outcome and the decision, belief, or action it
should help the reader reach.

## Audience

Describe the primary reader, what they already know, and what they need from the
document.

## Constraints

- Keep unsupported factual claims visible until they are backed by sources.
- Prefer concrete examples over broad assertions.
- Preserve reviewer and revision decisions in files.

## Success Criteria

- The outline gives each section one clear job.
- Claims that matter are tracked in \`state/claims.md\`.
- Draft status, section contracts, and \`state/status.md\` stay in sync.
`;
}

function outlineScaffold({ title, plan }) {
  return `# Outline

Working title: ${title}

## Shape

Describe the argument, sequence, or reader journey before drafting.

## Sections

${plan.map(sectionOutline).join("\n\n")}
`;
}

function sectionOutline(section) {
  return `### ${section.label}

Status: ${section.status}
File: \`${section.file}\`

Purpose: ${section.purpose}

Acceptance criteria:

- The section fulfills its purpose without relying on later sections.
- Claims are source-backed or marked for support.
- The ending gives the next section a clean handoff.`;
}

function styleScaffold() {
  return `# Style

## Voice

Clear, modest, and operational. Prefer concrete nouns, plain verbs, and short
paragraphs. The prose should sound like a careful working document, not a launch
announcement.

## Formatting

- Use Markdown headings no deeper than \`###\`.
- Use code formatting for file paths, commands, ids, and literal values.
- Keep examples runnable where practical.
- Avoid decorative language, hype, and unexplained acronyms.

## Terminology

Add project terms here as they stabilize.

## Citation Rules

Every non-obvious factual claim should connect to \`sources/index.md\` through
\`state/claims.md\`, or remain visibly marked in the draft until supported.
`;
}

function statusScaffold(plan) {
  return `# Status

| Section | File | Status | Notes |
|---|---|---|---|
${plan.map((section) => `| ${escapeTableCell(section.label)} | \`${section.file}\` | ${section.status} | ${escapeTableCell(section.purpose)} |`).join("\n")}
`;
}

function claimsScaffold() {
  return `# Claims

| Claim | Section | Source | Status | Notes |
|---|---|---|---|---|
`;
}

function sourceIndexScaffold() {
  return `# Sources Index

| Key | Type | Title | Location | Status | Notes |
|---|---|---|---|---|---|
`;
}

function continuityScaffold() {
  return `# Continuity

Use this file for durable definitions, decisions, names, terms, timelines,
entities, and invariants that later sections must preserve.

## Decisions

| Decision | Applies To | Notes |
|---|---|---|
`;
}

function openQuestionsScaffold() {
  return `# Open Questions

| Question | Owner | Status | Notes |
|---|---|---|---|
`;
}

function projectHandoffScaffold({ title }) {
  return `# Project Handoff

Project: ${title}

## Current State

Fresh install-anywhere workspace. Start by tightening the brief, outline, style
guide, source index, and section contracts.

## Next Useful Command

\`\`\`bash
npx mlab validate
\`\`\`
`;
}

function projectReviewApproachScaffold() {
  return `# Project Review Approach

Use reviews as sensors, not commands. Triage findings into accepted, rejected,
deferred, or merged issue-ledger decisions before revising.

Prioritize:

- Claim support and source traceability.
- Section contract fit.
- Reader clarity and useful compression.
- Voice consistency with \`style.md\` and \`taste/\`.
`;
}

function writeTasteFiles(root, { written }) {
  const files = {
    "taste/TASTE.md": `# Taste

Define what the document should protect when revisions compete: reader trust,
precision, compression, concrete evidence, useful structure, or other project
values.
`,
    "taste/VOICE.md": `# Voice

Describe the voice profile with accepted and rejected examples as the draft
develops.
`,
    "taste/TARGET_READER.md": `# Target Reader

Name the reader's context, patience, expertise, likely objections, and desired
takeaway.
`,
    "taste/FAILURE_MODES.md": `# Failure Modes

Track patterns that would make the document less trustworthy or less useful.
`,
    "taste/MOTIFS.md": `# Motifs

Track recurring examples, terms, images, or structural moves worth preserving.
`,
  };
  for (const [rel, content] of Object.entries(files)) write(path.join(root, rel), content, { written });
}

function writeIssueStateFiles(root, { written }) {
  writeJson(path.join(root, "state/issues/issue-ledger.json"), { version: 1, next_id: 1, issues: [] }, { written });
  writeJson(path.join(root, "state/issues/decisions.json"), { version: 1, decisions: [] }, { written });
  writeJson(path.join(root, "state/issues/closed.json"), { version: 1, closed: [] }, { written });
}

function writeTruthStateFiles(root, { written }) {
  writeJson(path.join(root, "state/truth/entities.json"), { entities: [] }, { written });
  writeJson(path.join(root, "state/truth/threads.json"), { threads: [] }, { written });
  writeJson(path.join(root, "state/truth/claims.json"), { claims: [] }, { written });
  writeJson(path.join(root, "state/truth/sources.json"), { sources: [] }, { written });
  writeJson(path.join(root, "state/truth/terms.json"), { terms: [] }, { written });
  writeJson(path.join(root, "state/truth/artifacts.json"), { artifacts: [] }, { written });
  writeJson(path.join(root, "state/truth/style.json"), {
    style_profile: {
      summary: "",
      protected_strengths: [],
      watch_patterns: [],
      avoid: [],
      register_balance: {},
    },
  }, { written });
}

function draftScaffold({ section }) {
  const titleSection = section.id === "00-title";
  const checks = titleSection ? ["style.violations"] : ["claims.supported", "style.violations"];
  const reviews = titleSection ? ["contract.editor"] : ["cold.reader", "contract.editor"];
  return `<!--
id: ${section.id}
kind: ${section.kind}
status: ${section.status}
target_words: ${section.targetWords}
purpose: ${section.purpose}
acceptance:
  - The section fulfills its purpose without relying on later sections.
  - Claims are source-backed or visibly marked for support.
  - The ending gives the next section a clean handoff.
${contractList("checks", checks)}${contractList("reviews", reviews)}-->
# ${section.label}

Use this section for the first owned draft once the brief, outline, style guide,
and source index are ready.
`;
}

function contractList(label, items) {
  return `${label}:\n${items.map((item) => `  - ${item}`).join("\n")}\n`;
}

function workspaceReadme({ title, root, sectionFiles }) {
  const firstSection = sectionFiles.find((file) => !file.includes("00-title")) ?? sectionFiles[0] ?? "draft/01-opening.md";
  return `# ${title}

This is a Manuscript Lab install-anywhere workspace. The package lives in
\`node_modules/\`; the writing project lives in \`${root}/\`.

## Start Here

\`\`\`bash
npx mlab validate
npx mlab claims list
npx mlab citations check
npx mlab gate ${firstSection}
\`\`\`

Edit \`brief.md\`, \`outline.md\`, \`style.md\`, \`sources/index.md\`,
\`state/status.md\`, and files under \`draft/\` inside this directory.
`;
}

function normalizeProfile(profile) {
  const value = safeId(profile);
  return value === "document" ? "whitepaper" : value || DEFAULT_PROFILE;
}

function normalizeTitle(title) {
  return String(title ?? "").trim().replace(/\s+/g, " ") || DEFAULT_TITLE;
}

function positiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`--${label} must be a positive integer.`);
  return number;
}

function writeJson(file, value, options = {}) {
  write(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

function write(file, content, { written = [], ifMissing = false } = {}) {
  if (ifMissing && fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  written.push(file);
}

function parseArgs(args) {
  const parsed = {
    profile: DEFAULT_PROFILE,
    root: DEFAULT_ROOT,
    title: DEFAULT_TITLE,
    sections: DEFAULT_SECTIONS,
    targetWords: DEFAULT_TARGET_WORDS,
    kind: "document.section",
    json: false,
    force: false,
    help: false,
    errors: [],
  };
  const valueOptions = new Set(["profile", "root", "title", "sections", "target-words", "kind"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (!valueOptions.has(name)) {
        parsed.errors.push(`Unknown option: --${name}`);
        continue;
      }
      const value = inlineValue != null ? inlineValue : args[++index];
      if (value == null || value.startsWith("--")) {
        parsed.errors.push(`Option --${name} requires a value.`);
        continue;
      }
      if (name === "target-words") parsed.targetWords = value;
      else parsed[name] = value;
    } else {
      parsed.errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  return parsed;
}

function formatSuccess(result, options) {
  if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
  return {
    exitCode: 0,
    stdout: [
      `Created Manuscript Lab workspace at ${result.manuscript_root}`,
      `Config: ${result.config_path}`,
      "",
      "Next:",
      ...result.next_steps.map((step) => `  ${step}`),
      "",
    ].join("\n"),
    stderr: "",
  };
}

function formatError(errors, options) {
  const payload = { ok: false, errors };
  if (options.json) return { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" };
  return { exitCode: 2, stdout: "", stderr: `${errors.join("\n")}\n` };
}

function helpText() {
  return `install-init - create a config-first Manuscript Lab workspace

Usage:
  mlab init --profile whitepaper --root manuscript [--title "My Whitepaper"] [--sections 3] [--kind document.section]

This command writes manuscript-lab.config.json in the current directory and a
user-owned project scaffold under the configured root. It does not copy package
scripts, checks, reviews, skills, or template workspace mounts.
`;
}

function escapeTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function isPackageRoot(dir) {
  const pkg = path.join(dir, "package.json");
  if (!fs.existsSync(pkg) || !fs.existsSync(path.join(dir, "scripts/doccheck.mjs"))) return false;
  try {
    return JSON.parse(fs.readFileSync(pkg, "utf8")).name === "manuscript-lab";
  } catch {
    return false;
  }
}

function isPathInsideOrEqual(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
