#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help || !options.target) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

const target = resolveInputPath(options.target);
if (!fs.existsSync(target)) fail(`Target file does not exist: ${displayPath(target)}`);
if (!fs.statSync(target).isFile()) fail(`Target is not a file: ${displayPath(target)}`);

const text = read(target);
const contract = parseSectionContract(text);
const sectionId = safeId(contract.get("id") || path.basename(target, path.extname(target)));
const targetRel = displayPath(target);
const createdAt = new Date().toISOString();
const stamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14);
const label = safeId(options.label || options.issue || "before");
const outDir = resolveInputPath(options.out || path.join("state/revision-audits", sectionId, "before-snapshots"));
const fileBase = `${stamp}-${label}`;
const snapshotFile = uniquePath(path.join(outDir, `${fileBase}${path.extname(target) || ".md"}`));
const metadataFile = snapshotFile.replace(/\.[^.]+$/, ".json");
const markdownFile = snapshotFile.replace(/\.[^.]+$/, ".md.meta.md");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(snapshotFile, text);

const metadata = {
  version: 1,
  created_at: createdAt,
  purpose: "revision_before_snapshot",
  target: targetRel,
  section_id: sectionId,
  issue_id: options.issue || "",
  label,
  snapshot_file: displayPath(snapshotFile),
  metadata_file: displayPath(metadataFile),
  bytes: Buffer.byteLength(text),
  words: wordCount(stripContract(text)),
  sha256: sha256(text),
  target_mtime: fs.statSync(target).mtime.toISOString(),
  next: [
    `npm run diff:audit -- --before ${displayPath(snapshotFile)} --after ${targetRel}${options.issue ? ` --issue ${options.issue}` : ""}`,
  ],
};

writeJson(metadataFile, metadata);
fs.writeFileSync(markdownFile, renderMarkdown(metadata));

if (options.json) {
  console.log(JSON.stringify(metadata, null, 2));
} else {
  console.log(`snapshot: ${metadata.snapshot_file}`);
  console.log(`metadata: ${metadata.metadata_file}`);
  console.log(`next: ${metadata.next[0]}`);
}

function renderMarkdown(metadata) {
  return [
    "# Revision Before Snapshot",
    "",
    `- Created: ${metadata.created_at}`,
    `- Target: \`${metadata.target}\``,
    `- Section: \`${metadata.section_id}\``,
    metadata.issue_id ? `- Issue: \`${metadata.issue_id}\`` : "",
    `- Snapshot: \`${metadata.snapshot_file}\``,
    `- SHA-256: \`${metadata.sha256}\``,
    "",
    "## Next",
    "",
    `\`\`\`bash`,
    metadata.next[0],
    `\`\`\``,
    "",
  ].filter((line) => line !== "").join("\n") + "\n";
}

function parseSectionContract(textValue) {
  const match = textValue.match(/^\s*<!--([\s\S]*?)-->/);
  const fields = new Map();
  if (!match) return fields;

  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2]);
  }
  return fields;
}

function stripContract(textValue) {
  return textValue.replace(/^\s*<!--[\s\S]*?-->/, "").trim();
}

function wordCount(textValue) {
  return (textValue.match(/\b[\w'-]+\b/g) ?? []).length;
}

function sha256(textValue) {
  return createHash("sha256").update(textValue).digest("hex");
}

function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  fail(`Could not find an unused snapshot path near ${displayPath(file)}`);
}

function parseArgs(rawArgs) {
  const parsed = {
    target: "",
    issue: "",
    label: "",
    out: "",
    json: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--issue") {
      parsed.issue = nextValue(rawArgs, index, "--issue");
      index += 1;
    } else if (arg.startsWith("--issue=")) {
      parsed.issue = arg.slice("--issue=".length);
    } else if (arg === "--label") {
      parsed.label = nextValue(rawArgs, index, "--label");
      index += 1;
    } else if (arg.startsWith("--label=")) {
      parsed.label = arg.slice("--label=".length);
    } else if (arg === "--out") {
      parsed.out = nextValue(rawArgs, index, "--out");
      index += 1;
    } else if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
    } else if (!arg.startsWith("--") && !parsed.target) {
      parsed.target = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function nextValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`Missing value for ${option}.`);
  return value;
}

function safeId(value) {
  return String(value || "snapshot")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "snapshot";
}

function resolveInputPath(input) {
  return path.isAbsolute(input) ? input : abs(input);
}

function abs(rel) {
  return path.join(root, rel);
}

function displayPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`revision-snapshot - save a before snapshot for a targeted revision audit

Usage:
  npm run snapshot:revision -- draft/<section>.md
  npm run snapshot:revision -- draft/<section>.md --issue issue_2026_00042

Options:
  --issue id     Issue-ledger id that motivates the revision.
  --label text   Short label for the snapshot filename.
  --out dir      Output directory. Default: state/revision-audits/<section-id>/before-snapshots.
  --json         Print machine-readable metadata.
  --help, -h     Show this help.
`);
}
