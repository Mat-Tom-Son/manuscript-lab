#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, validatePortableRelativePath } from "./lib/protocol.mjs";
import { normalizeRel, parseSectionContract, stripContract, wordCount } from "./lib/section-contract.mjs";
import {
  RESERVED_WORKSPACE_ROOTS,
  assertSafeInitTarget,
  buildInstalledConfig,
  normalizeWorkspaceProfile,
  normalizeWorkspaceTitle,
  writeInstalledScaffold,
  writeScaffoldJson,
} from "./install-init.mjs";

const DEFAULT_ROOT = "manuscript";
const DEFAULT_PROFILE = "whitepaper";
const DEFAULT_SPLIT = "file";
const SECTION_KIND = "document.section";
const SECTION_STATUS = "draft";
const SPLIT_MODES = new Set(["file", "h1", "h2"]);
const NEXT_STEPS = ["mlab status", "mlab check --static-only", "mlab report --write"];
const DEFAULT_ACCEPTANCE = [
  "The section fulfills its purpose without relying on later sections.",
  "Claims are source-backed or visibly marked for support.",
  "The ending gives the next section a clean handoff.",
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execution = runAdopt(process.argv.slice(2), { cwd: process.cwd() });
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  process.exitCode = execution.exitCode;
}

export function runAdopt(rawArgs, env = {}) {
  const options = parseArgs(rawArgs);
  if (options.help) return { exitCode: 0, stdout: helpText(), stderr: "" };
  if (options.errors.length) return formatError(options.errors, options);

  try {
    const result = adoptWorkspace({ ...options, cwd: env.cwd ?? process.cwd() });
    return formatSuccess(result, options);
  } catch (error) {
    return formatError([error.message], options);
  }
}

export function adoptWorkspace(options = {}) {
  const workspaceRoot = path.resolve(options.cwd ?? process.cwd());
  const profile = normalizeWorkspaceProfile(options.profile ?? DEFAULT_PROFILE);
  if (profile !== "whitepaper") {
    throw new Error(`Unsupported profile "${profile}". adopt supports "whitepaper".`);
  }

  const root = normalizeRel(options.root ?? DEFAULT_ROOT);
  const rootError = validatePortableRelativePath(root, { allowDot: false });
  if (rootError) throw new Error(`Project root is invalid: ${rootError}`);
  if (root === ".") throw new Error("Project root must be a subdirectory such as manuscript.");
  if (RESERVED_WORKSPACE_ROOTS.has(root.split("/")[0])) {
    throw new Error(`Project root "${root}" is reserved for package or tool files.`);
  }

  const split = String(options.split ?? DEFAULT_SPLIT);
  if (!SPLIT_MODES.has(split)) throw new Error(`Unsupported --split "${split}". Use file, h1, or h2.`);

  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    throw new Error(
      `Already initialized: ${CONFIG_FILE} exists at ${configPath}. ` +
        "adopt bootstraps a new workspace from existing markdown; to import into this project, " +
        "copy sections under draft/ instead. See docs/GETTING_STARTED.md.",
    );
  }

  const manuscriptRoot = path.resolve(workspaceRoot, root);
  assertSafeInitTarget({ workspaceRoot, manuscriptRoot, configPath, force: false });

  const sourcePath = path.resolve(workspaceRoot, String(options.source ?? ""));
  const collected = collectMarkdownSources(sourcePath, split);
  const sections = buildImportedSections(collected, split);
  if (!sections.length) throw new Error(`No adoptable markdown content found under ${sourcePath}.`);

  const title = normalizeWorkspaceTitle(String(options.title ?? "").trim() || deriveTitle(sections, sourcePath));
  const config = buildInstalledConfig({
    profile,
    root,
    title,
    sections: sections.length,
    targetWords: averageTargetWords(sections),
    kind: SECTION_KIND,
  });
  const contractDefaults = {
    checks: config.checks?.default ?? [],
    reviews: config.reviews?.default ?? [],
  };

  const result = {
    ok: true,
    mode: "installed",
    command: "adopt",
    dry_run: Boolean(options.dryRun),
    profile,
    root,
    title,
    split,
    source: sourcePath,
    source_defaulted: Boolean(options.sourceDefaulted),
    workspace_root: workspaceRoot,
    manuscript_root: manuscriptRoot,
    config_path: configPath,
    sections: sections.map((section) => ({
      id: section.id,
      file: section.file,
      title: section.title,
      source: section.sourceLabel,
      words: section.words,
      target_words: section.targetWords,
      replaced_existing_contract: section.replacedExistingContract,
    })),
    files_written: [],
    next_steps: [...NEXT_STEPS],
  };
  if (options.dryRun) return result;

  const plan = sections.map((section) => ({
    id: section.id,
    label: section.title,
    file: section.file,
    kind: SECTION_KIND,
    status: SECTION_STATUS,
    targetWords: section.targetWords,
    purpose: section.purpose,
  }));

  const written = [];
  writeScaffoldJson(configPath, config, { written });
  writeInstalledScaffold({ manuscriptRoot, root, profile, title, plan, written });
  for (const section of sections) {
    const file = path.join(manuscriptRoot, section.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${sectionContract(section, contractDefaults)}\n${ensureTrailingNewline(section.body)}`, "utf8");
  }

  result.files_written = Array.from(new Set(written.map((file) => normalizeRel(path.relative(workspaceRoot, file))))).sort();
  return result;
}

export function collectMarkdownSources(sourcePath, split) {
  const stat = fs.statSync(sourcePath, { throwIfNoEntry: false });
  if (!stat) throw new Error(`Source path does not exist: ${sourcePath}`);

  if (stat.isFile()) {
    if (!isMarkdownName(path.basename(sourcePath))) {
      throw new Error(`Source file must be a markdown (.md) file: ${sourcePath}`);
    }
    return { kind: "file", sourceRoot: path.dirname(sourcePath), files: [sourcePath] };
  }

  if (!stat.isDirectory()) throw new Error(`Source path must be a markdown file or a directory: ${sourcePath}`);
  if (split !== "file") {
    throw new Error(`--split ${split} needs a single source file; ${sourcePath} is a directory. Use --split file for directories.`);
  }

  const files = [];
  walkMarkdownFiles(sourcePath, files);
  if (!files.length) throw new Error(`No markdown files found under ${sourcePath}`);
  files.sort((a, b) => normalizeRel(path.relative(sourcePath, a)).localeCompare(normalizeRel(path.relative(sourcePath, b))));
  return { kind: "dir", sourceRoot: sourcePath, files };
}

export function splitAtHeadingLevel(text, level) {
  const lines = String(text ?? "").split("\n");
  const groups = [];
  let current = [];
  let inFence = false;

  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    if (!inFence && headingLevel(line) === level && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) groups.push(current);

  return groups
    .map((group, index) => group.join("\n") + (index < groups.length - 1 ? "\n" : ""))
    .filter((part) => part.trim().length > 0);
}

export function adoptTargetWords(words) {
  const number = Number(words);
  const actual = Number.isFinite(number) && number > 0 ? number : 0;
  return Math.max(300, Math.ceil((actual * 1.2) / 50) * 50);
}

function buildImportedSections(collected, split) {
  const chunks = [];
  if (split === "file") {
    for (const file of collected.files) {
      chunks.push({
        body: fs.readFileSync(file, "utf8"),
        sourceFile: file,
        sourceLabel: normalizeRel(path.relative(collected.sourceRoot, file)) || path.basename(file),
      });
    }
  } else {
    const file = collected.files[0];
    for (const body of splitAtHeadingLevel(fs.readFileSync(file, "utf8"), split === "h1" ? 1 : 2)) {
      chunks.push({ body, sourceFile: file, sourceLabel: path.basename(file) });
    }
  }

  const pad = Math.max(2, String(chunks.length).length);
  return chunks.map((chunk, index) => {
    // Re-imported Manuscript Lab drafts already open with a section contract;
    // strip it so the fresh inferred contract is the only one and the old
    // contract lines never count as prose.
    const existingContract = parseSectionContract(chunk.body);
    const replacedExistingContract = Boolean(existingContract && (existingContract.has("id") || existingContract.has("status")));
    const body = replacedExistingContract ? `${stripContract(chunk.body)}\n` : chunk.body;
    const heading = firstHeadingText(body);
    const baseSlug = slugify(path.basename(chunk.sourceFile, path.extname(chunk.sourceFile)).replace(/^\d+[-_. ]*/, ""));
    const slug = split === "file" ? baseSlug || slugify(heading) : slugify(heading) || baseSlug;
    const id = `${String(index + 1).padStart(pad, "0")}-${slug || "section"}`;
    const words = wordCount(body);
    return {
      id,
      file: `draft/${id}.md`,
      title: heading || titleCaseFromPath(chunk.sourceFile) || `Section ${index + 1}`,
      heading,
      body,
      sourceLabel: chunk.sourceLabel,
      words,
      targetWords: adoptTargetWords(words),
      replacedExistingContract,
      purpose: contractSafeValue(provisionalPurpose(body, chunk.sourceLabel)),
    };
  });
}

// Imported contracts get a best-effort provisional purpose instead of a TODO
// marker: TODO text in the contract trips the placeholder check and leaves the
// section red with no command that clears it. `confirmed: false` carries the
// "a human must still review this" signal through the gate instead.
function provisionalPurpose(body, sourceLabel) {
  const sentence = firstProseSentence(body);
  if (sentence) return `Imported from ${sourceLabel}: ${sentence}`;
  return `Carry the content imported from ${sourceLabel} until its job for the reader is confirmed.`;
}

function firstProseSentence(text) {
  const stripped = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/[*_`>]/g, "");
  for (const paragraph of stripped.split(/\n\s*\n/)) {
    const flat = paragraph.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    const sentence = flat.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? flat;
    return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
  }
  return "";
}

function sectionContract(section, { checks, reviews }) {
  return [
    "<!--",
    `id: ${section.id}`,
    `kind: ${SECTION_KIND}`,
    `status: ${SECTION_STATUS}`,
    "confirmed: false",
    `target_words: ${section.targetWords}`,
    `purpose: ${section.purpose}`,
    "acceptance:",
    ...DEFAULT_ACCEPTANCE.map((item) => `  - ${item}`),
    "checks:",
    ...checks.map((id) => `  - ${id}`),
    "reviews:",
    ...reviews.map((id) => `  - ${id}`),
    "-->",
  ].join("\n");
}

function walkMarkdownFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkMarkdownFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && isMarkdownName(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function isMarkdownName(name) {
  return name.toLowerCase().endsWith(".md");
}

function headingLevel(line) {
  const match = String(line).match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

function firstHeadingText(text) {
  let inFence = false;
  for (const line of String(text ?? "").split("\n")) {
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^#{1,6}\s+(.*)$/);
    if (match) return match[1].replace(/#+\s*$/, "").replace(/[`*_]/g, "").trim();
  }
  return "";
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

function titleCaseFromPath(value) {
  const base = path.basename(String(value ?? "")).replace(/\.md$/i, "");
  const words = base.split(/[-_.\s]+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function deriveTitle(sections, sourcePath) {
  const heading = sections.find((section) => section.heading)?.heading ?? "";
  return heading || titleCaseFromPath(sourcePath);
}

function averageTargetWords(sections) {
  const total = sections.reduce((sum, section) => sum + section.targetWords, 0);
  return Math.max(300, Math.round(total / sections.length / 50) * 50);
}

function contractSafeValue(value) {
  // Strip C0/C1 control characters (and DEL) that survive the whitespace
  // collapse so heading-derived text cannot smuggle raw control bytes into a
  // machine-parsed contract field.
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/-->/g, "→")
    .trim();
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function formatSuccess(result, options) {
  if (options.json) return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };

  const noun = result.sections.length === 1 ? "section" : "sections";
  const lines = [];
  if (result.source_defaulted) lines.push("No source path given — adopting markdown from the current directory.", "");
  if (result.dry_run) lines.push("Dry run: no files written.", "");
  lines.push(`${result.dry_run ? "Would adopt" : "Adopted"} ${result.sections.length} ${noun} into ${result.root}/draft (split: ${result.split})`, "");
  for (const section of result.sections) {
    const note = section.replaced_existing_contract ? "  [replaced existing section contract]" : "";
    lines.push(`  ${section.file}  ${section.words} words -> target ${section.target_words}  (from ${section.source})${note}`);
  }
  lines.push("");
  if (!result.dry_run) {
    lines.push(`Config: ${result.config_path}`, "");
    lines.push(
      "Contracts are provisional (confirmed: false): review purpose and acceptance",
      "in each draft header, then change confirmed: false to confirmed: true.",
      "",
    );
  }
  lines.push("Next:");
  for (const step of result.next_steps) lines.push(`  ${step}`);
  lines.push("");
  return { exitCode: 0, stdout: lines.join("\n"), stderr: "" };
}

function formatError(errors, options) {
  const payload = { ok: false, errors };
  if (options.json) return { exitCode: 2, stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: "" };
  return { exitCode: 2, stdout: "", stderr: `${errors.join("\n")}\n` };
}

function parseArgs(args) {
  const parsed = {
    source: "",
    root: DEFAULT_ROOT,
    title: "",
    split: DEFAULT_SPLIT,
    profile: DEFAULT_PROFILE,
    dryRun: false,
    json: false,
    help: false,
    errors: [],
  };
  const valueOptions = new Set(["root", "title", "split", "profile"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
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
      parsed[name] = value;
    } else if (!parsed.source) {
      parsed.source = arg;
    } else {
      parsed.errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  if (!parsed.help && !parsed.source) {
    parsed.source = ".";
    parsed.sourceDefaulted = true;
  }
  if (!SPLIT_MODES.has(parsed.split)) parsed.errors.push(`Unsupported --split "${parsed.split}". Use file, h1, or h2.`);
  return parsed;
}

function helpText() {
  return `adopt - create a Manuscript Lab workspace from existing markdown

Usage:
  mlab adopt [file-or-dir] [--root manuscript] [--title "My Whitepaper"] [--split file|h1|h2] [--profile whitepaper] [--dry-run] [--json]

Imports every *.md under [file-or-dir] (default: the current directory;
recursive; hidden entries and node_modules are skipped) into
draft/NN-slug.md sections with inferred section contracts (status: draft,
confirmed: false, sized target_words, a provisional purpose taken from the
first prose sentence, and profile default acceptance, checks, and reviews).
Source files are copied verbatim, never modified or moved.

Imported contracts are marked confirmed: false. The manuscript gate blocks
until you review each section's purpose and acceptance and flip the flag to
confirmed: true — that review is the human judgment step adopt cannot do.

Refuses when ${CONFIG_FILE} already exists: adopt only bootstraps
new workspaces.

Split modes:
  file  one section per source file (default; required for directories)
  h1    split a single source file at level-1 headings
  h2    split a single source file at level-2 headings

Options:
  --root <dir>       project root directory to create (default: manuscript)
  --title "..."      workspace title (default: first heading, else the source name)
  --profile <name>   project profile (default: whitepaper)
  --dry-run          print the adoption plan without writing anything
  --json             machine-readable output

After adopting:
${NEXT_STEPS.map((step) => `  ${step}`).join("\n")}
`;
}
