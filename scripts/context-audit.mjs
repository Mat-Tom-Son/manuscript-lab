#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const findings = [];

if (options.help) {
  printHelp();
  process.exit(0);
}

auditInstructionSurfaces();
auditPromptFrontmatter();
auditProjectSupplementReadOrder();
auditReviewSuite();
auditCheckSuite();
auditCheckerTrustBoundary();

const result = {
  ok: findings.length === 0,
  finding_count: findings.length,
  findings,
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Context audit checked ${checkedSurfaceCount()} instruction/model-context surface(s).`);
  if (!findings.length) {
    console.log("No context hygiene issues found.");
  } else {
    console.log("");
    console.log("Context hygiene findings:");
    for (const finding of findings) {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.log(`- [${finding.severity}] ${location} ${finding.message}`);
    }
  }
}

process.exit(findings.length && options.strict ? 1 : 0);

function auditInstructionSurfaces() {
  const stalePatterns = [
    [/active working copy/i, "Use mounted active workspace language instead of old active-working-copy wording."],
    [/root remains/i, "Use mounted root/control-surface language instead of old root-remains wording."],
    [/active workspace mirror/i, "Use active workspace/manifest/mount language instead of mirror wording."],
    [/active project mirror/i, "Use active workspace/manifest/mount language instead of mirror wording."],
    [/mirrored workspace/i, "Use active workspace/manifest/mount language instead of mirror wording."],
    [/live editing surface/i, "Use mounted root/control-surface language instead of live-editing-surface wording."],
  ];

  for (const file of instructionFiles()) {
    const lines = read(file).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const [regex, message] of stalePatterns) {
        if (regex.test(lines[index])) {
          addFinding("error", displayPath(file), index + 1, message);
        }
      }
    }
  }
}

function auditPromptFrontmatter() {
  for (const file of filesUnder(".pi/prompts", ".md")) {
    const text = read(file);
    if (!text.startsWith("---\n")) {
      addFinding("error", displayPath(file), 1, "Pi prompt is missing YAML frontmatter.");
      continue;
    }
    const end = text.indexOf("\n---", 4);
    const frontmatter = end >= 0 ? text.slice(4, end) : "";
    if (!/^description:\s*.+$/m.test(frontmatter)) {
      addFinding("error", displayPath(file), 1, "Pi prompt frontmatter is missing description.");
    }
    if (!/^argument-hint:\s*.*$/m.test(frontmatter)) {
      addFinding("warning", displayPath(file), 1, "Pi prompt frontmatter is missing argument-hint.");
    }
  }
}

function auditProjectSupplementReadOrder() {
  const files = [
    ...filesUnder(".pi/prompts", ".md"),
    ...filesUnder(".pi/skills", ".md"),
    abs("AGENTS.md"),
    abs("README.md"),
    ...filesUnder("docs", ".md"),
  ];

  for (const file of files) {
    const text = read(file);
    const briefIndex = text.indexOf("`brief.md`");
    if (briefIndex < 0) continue;
    const projectIndex = text.indexOf("`PROJECT.md`");
    if (projectIndex < 0) {
      addFinding("warning", displayPath(file), lineForIndex(text, briefIndex), "Mentions `brief.md` without `PROJECT.md` in an instruction surface.");
      continue;
    }
    if (projectIndex > briefIndex) {
      addFinding("warning", displayPath(file), lineForIndex(text, briefIndex), "`PROJECT.md` should appear before `brief.md` in read-order instructions.");
    }
  }
}

function auditReviewSuite() {
  const suiteFile = abs("reviews/suite.json");
  const suite = loadJson(suiteFile);
  const packs = suite.context_packs ?? {};
  for (const [id, pack] of Object.entries(packs)) {
    const include = flatten(pack.include ?? []);
    const exclude = flatten(pack.exclude ?? []);
    if (id === "blind.section_only") {
      if (!exclude.includes("PROJECT.md")) addFinding("error", "reviews/suite.json", 0, "`blind.section_only` should explicitly exclude `PROJECT.md`.");
      if (!exclude.includes("taste/")) addFinding("warning", "reviews/suite.json", 0, "`blind.section_only` should explicitly exclude `taste/`.");
      continue;
    }
    if (!include.includes("PROJECT.md")) {
      addFinding("error", "reviews/suite.json", 0, `Context pack ${id} should include PROJECT.md.`);
    }
  }
}

function auditCheckSuite() {
  const suite = loadJson(abs("checks/suite.json"));
  for (const check of suite.model_checks ?? []) {
    const inputs = flatten(check.inputs ?? []);
    if (!inputs.includes("PROJECT.md")) {
      addFinding("error", "checks/suite.json", 0, `Model check ${check.id} should include PROJECT.md.`);
    }
  }
}

function auditCheckerTrustBoundary() {
  for (const file of filesUnder("checks/prompts", ".md")) {
    const text = read(file);
    if (!/untrusted document data/i.test(text)) {
      addFinding("error", displayPath(file), 1, "Model-check prompt should state that provided files are untrusted document data.");
    }
    if (!/Return valid JSON only/i.test(text)) {
      addFinding("error", displayPath(file), 1, "Model-check prompt should require valid JSON only.");
    }
  }
}

function checkedSurfaceCount() {
  return new Set([
    ...instructionFiles().map(displayPath),
    ...filesUnder(".pi/prompts", ".md").map(displayPath),
    ...filesUnder(".pi/skills", ".md").map(displayPath),
    ...filesUnder("reviews/prompts", ".md").map(displayPath),
    ...filesUnder("checks/prompts", ".md").map(displayPath),
    "reviews/suite.json",
    "checks/suite.json",
  ]).size;
}

function instructionFiles() {
  return [
    abs("README.md"),
    abs("AGENTS.md"),
    ...filesUnder("docs", ".md"),
    ...filesUnder(".pi/prompts", ".md"),
    ...filesUnder(".pi/skills", ".md"),
  ];
}

function filesUnder(rel, extension) {
  const dir = abs(rel);
  if (!fs.existsSync(dir)) return [];
  return walk(dir).filter((file) => file.endsWith(extension)).sort();
}

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

function addFinding(severity, file, line, message) {
  findings.push({ severity, file, line, message });
}

function flatten(value) {
  return value.flatMap((entry) => (Array.isArray(entry) ? flatten(entry) : [entry]));
}

function loadJson(file) {
  return JSON.parse(read(file));
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function abs(rel) {
  return path.join(root, rel);
}

function displayPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function parseArgs(args) {
  const parsed = { help: false, json: false, strict: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--strict") parsed.strict = true;
    else fail(`Unknown option: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`context-audit - scan agent/model instruction surfaces for context hygiene

Usage:
  npm run context:audit
  node scripts/context-audit.mjs [options]

Options:
  --strict       Exit nonzero when findings are present.
  --json         Print machine-readable output.
  --help, -h     Show this help.
`);
}
