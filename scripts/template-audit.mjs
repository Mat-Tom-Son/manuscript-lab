#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const configuredPatterns = loadConfiguredPatterns();

if (options.help) {
  printHelp();
  process.exit(0);
}

const files = collectFiles();
const findings = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const pattern of configuredPatterns) {
      if (pattern.regex.test(lines[index])) {
        findings.push({
          file: displayPath(file),
          line: index + 1,
          pattern: pattern.label,
          text: lines[index].trim().slice(0, 240),
        });
      }
      pattern.regex.lastIndex = 0;
    }
  }
}

if (options.json) {
  console.log(JSON.stringify({ checked_files: files.length, findings }, null, 2));
} else {
  console.log(`Template audit checked ${files.length} reusable infrastructure file(s).`);
  if (!configuredPatterns.length) {
    console.log("No local contamination patterns configured.");
  } else if (!findings.length) {
    console.log("No sample-story contamination found in reusable infrastructure.");
  } else {
    console.log("");
    console.log("Sample-story contamination findings:");
    for (const finding of findings) {
      console.log(`- ${finding.file}:${finding.line} [${finding.pattern}] ${finding.text}`);
    }
  }
}

process.exit(findings.length && options.strict ? 1 : 0);

function pattern(label, regex) {
  return { label, regex };
}

function loadConfiguredPatterns() {
  const files = [
    options.patterns,
    process.env.TEMPLATE_AUDIT_PATTERNS,
    ".template-audit.local.json",
  ].filter(Boolean);

  const loaded = [];
  for (const file of files) {
    const full = abs(file);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    const entries = Array.isArray(data) ? data : data.patterns;
    if (!Array.isArray(entries)) fail(`Template audit pattern file must contain an array or { "patterns": [] }: ${file}`);
    for (const [index, entry] of entries.entries()) {
      loaded.push(patternFromEntry(entry, `${file}#${index + 1}`));
    }
  }
  return loaded;
}

function patternFromEntry(entry, fallbackLabel) {
  if (typeof entry === "string") {
    return pattern(entry, new RegExp(escapeRegex(entry), "i"));
  }
  if (!entry || typeof entry !== "object") fail(`Invalid template audit pattern: ${fallbackLabel}`);
  const label = String(entry.label || entry.term || entry.pattern || fallbackLabel);
  if (entry.term) return pattern(label, new RegExp(escapeRegex(String(entry.term)), entry.flags || "i"));
  if (entry.pattern) return pattern(label, new RegExp(String(entry.pattern), entry.flags || ""));
  fail(`Template audit pattern needs "term" or "pattern": ${fallbackLabel}`);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectFiles() {
  const roots = [
    "README.md",
    "AGENTS.md",
    "docs/AGENT_HANDOFF.md",
    "docs/OPERATOR_GUIDE.md",
    "docs/EVALUATION_LAB_ROADMAP.md",
    ".pi/prompts",
    ".pi/skills",
    "scripts",
    "checks",
    "reviews",
    "evals",
    "package.json",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "state/candidates/README.md",
    "state/issues/README.md",
    "state/reviews/README.md",
    "state/revision-audits/README.md",
    "state/revision-plans/README.md",
    "state/style/README.md",
    "state/taste/README.md",
  ];

  if (options.includeProjectDocs) {
    roots.push("docs/PROJECT_HANDOFF.md", "state/status.md");
  }

  return roots
    .flatMap((entry) => collectEntry(abs(entry)))
    .filter((file) => /\.(?:md|mjs|js|json|py)$/.test(file))
    .sort();
}

function collectEntry(entry) {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  if (!stat.isDirectory()) return [];

  const files = [];
  for (const name of fs.readdirSync(entry)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    files.push(...collectEntry(path.join(entry, name)));
  }
  return files;
}

function parseArgs(rawArgs) {
  const parsed = { help: false, json: false, strict: false, includeProjectDocs: false, patterns: "" };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--include-project-docs") parsed.includeProjectDocs = true;
    else if (arg === "--patterns") parsed.patterns = rawArgs[++index] || "";
    else if (arg.startsWith("--patterns=")) parsed.patterns = arg.slice("--patterns=".length);
    else fail(`Unknown option: ${arg}`);
  }
  return parsed;
}

function abs(rel) {
  return path.join(root, rel);
}

function displayPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`template-audit - scan reusable infrastructure for sample-story contamination

Usage:
  npm run template:audit
  node scripts/template-audit.mjs [options]

Options:
  --strict                Exit nonzero when findings are present.
  --include-project-docs  Also scan project-specific handoff/status files.
  --patterns <file>       JSON contamination patterns. Defaults to .template-audit.local.json when present.
  --json                  Print machine-readable output.
  --help, -h              Show this help.

Pattern file formats:
  ["Private Term"]
  { "patterns": [{ "label": "Old project title", "term": "Private Term" }] }
  { "patterns": [{ "label": "Regex", "pattern": "\\\\bPrivate[A-Z]+", "flags": "i" }] }
`);
}
