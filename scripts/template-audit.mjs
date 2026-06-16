#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const STORY_PATTERNS = [
  pattern("Plant Room B", /\bPlant Room B\b|plant-room-b/i),
  pattern("Plant Room B character", /\b(?:Hale|Corinne|Kiera)\b/),
  pattern("Plant Room B science", /\b(?:fluorometer|fluorescence|photosynthesis|NPQ|fern|chlorophyll|stomata)\b/i),
  pattern("Astronaut story title", /\bThe Last Nine Meters Per Second\b|the-last-nine-meters-per-second/i),
  pattern("Astronaut story character", /\b(?:Rae|Okonkwo)\b/),
  pattern("Astronaut story vehicle", /\b(?:Cicada|Lowell)\b/),
  pattern("Astronaut story engineering", /\b(?:cislunar|water barge|micrometeoroid|hydrazine|lunar-capture|starboard|far-side|nozzle-side)\b/i),
];

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
    for (const pattern of STORY_PATTERNS) {
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
  if (!findings.length) {
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
    .filter((file) => displayPath(file) !== "scripts/template-audit.mjs")
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
  const parsed = { help: false, json: false, strict: false, includeProjectDocs: false };
  for (const arg of rawArgs) {
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--include-project-docs") parsed.includeProjectDocs = true;
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
  --json                  Print machine-readable output.
  --help, -h              Show this help.
`);
}
