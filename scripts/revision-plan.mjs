#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help || !options.target) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

const target = resolveInputPath(options.target);
if (!fs.existsSync(target)) {
  console.error(`Target file does not exist: ${displayPath(target)}`);
  process.exit(1);
}

const targetText = read(target);
const sectionId = parseSectionContract(targetText)?.get("id") ?? path.basename(target, path.extname(target));
const ledger = loadJson(abs("state/issues/issue-ledger.json"));
const issues = (ledger.issues ?? []).filter((issue) => {
  if (issue.target?.file !== displayPath(target)) return false;
  if (options.includeDeferred && issue.status === "deferred") return true;
  return issue.status === "accepted";
});

if (!issues.length && !options.allowEmpty) {
  const result = {
    target: displayPath(target),
    section_id: sectionId,
    issues: [],
    message: `No accepted editorial issues for ${sectionId}; no revision plan written.`,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.message);
    console.log("Use --allow-empty to write an explicit empty plan.");
  }
  process.exit(0);
}

const timestamp = new Date().toISOString();
const planNumber = nextPlanNumber(sectionId);
const planId = `${sectionId}__plan-${String(planNumber).padStart(3, "0")}`;
const plan = {
  version: 1,
  plan_id: planId,
  created_at: timestamp,
  target: displayPath(target),
  section_id: sectionId,
  issue_ids: issues.map((issue) => issue.id),
  summary: issues.length
    ? `Address ${issues.length} accepted editorial issue(s) for ${sectionId}.`
    : `No accepted editorial issues for ${sectionId}.`,
  steps: issues.map((issue, index) => ({
    order: index + 1,
    issue_id: issue.id,
    severity: issue.severity,
    category: issue.category,
    quote: issue.target?.quote ?? "",
    line: issue.target?.start_line ?? null,
    claim: issue.claim,
    decision_reason: issue.decision?.reason ?? "",
    instruction: issue.decision?.revision_instruction || issue.recommended_action,
    constraints: [
      "Preserve the section contract.",
      "Preserve established voice unless the issue explicitly concerns voice.",
      "Keep the edit local unless the accepted issue requires broader structure work.",
      "Rerun checks after editing.",
    ],
  })),
  verification: [
    "Run npm run check.",
    `Run node scripts/doccheck.mjs --model-checks ${displayPath(target)} when model-check access or cache is available.`,
    "Rerun targeted review or issue verification before closing accepted issues.",
  ],
};

const outDir = abs("state/revision-plans");
fs.mkdirSync(outDir, { recursive: true });
const jsonFile = path.join(outDir, `${planId}.json`);
const mdFile = path.join(outDir, `${planId}.md`);
fs.writeFileSync(jsonFile, `${JSON.stringify(plan, null, 2)}\n`);
fs.writeFileSync(mdFile, renderMarkdown(plan));

if (options.json) {
  console.log(JSON.stringify({ plan_id: planId, json: displayPath(jsonFile), markdown: displayPath(mdFile), issues: plan.issue_ids }, null, 2));
} else {
  console.log(`Revision plan written: ${displayPath(mdFile)}`);
  console.log(`Issues: ${plan.issue_ids.length ? plan.issue_ids.join(", ") : "none"}`);
}

function renderMarkdown(plan) {
  const lines = [
    `# Revision Plan: ${plan.section_id}`,
    "",
    `Plan ID: \`${plan.plan_id}\``,
    `Target: \`${plan.target}\``,
    `Created: ${plan.created_at}`,
    "",
    `## Summary`,
    "",
    plan.summary,
    "",
    "## Steps",
    "",
  ];

  if (!plan.steps.length) {
    lines.push("- No accepted issues to revise.", "");
  } else {
    for (const step of plan.steps) {
      lines.push(`${step.order}. ${step.issue_id} (${step.severity}/${step.category})`);
      lines.push(`   - Line: ${step.line ?? "unknown"}`);
      lines.push(`   - Claim: ${step.claim}`);
      lines.push(`   - Quote: ${JSON.stringify(step.quote)}`);
      if (step.decision_reason) lines.push(`   - Decision reason: ${step.decision_reason}`);
      lines.push(`   - Instruction: ${step.instruction}`);
      lines.push("");
    }
  }

  lines.push("## Verification", "");
  for (const item of plan.verification) lines.push(`- ${item}`);
  lines.push("");

  return `${lines.join("\n")}`;
}

function nextPlanNumber(sectionId) {
  const dir = abs("state/revision-plans");
  if (!fs.existsSync(dir)) return 1;
  const prefix = `${sectionId}__plan-`;
  const numbers = fs
    .readdirSync(dir)
    .map((name) => name.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)\\.(?:json|md)$`))?.[1])
    .filter(Boolean)
    .map(Number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function parseSectionContract(text) {
  const match = text.match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return null;

  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2]);
  }
  return fields;
}

function parseArgs(rawArgs) {
  const parsed = {
    target: "",
    includeDeferred: false,
    allowEmpty: false,
    json: false,
    help: false,
  };

  for (const arg of rawArgs) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--include-deferred") {
      parsed.includeDeferred = true;
    } else if (arg === "--allow-empty") {
      parsed.allowEmpty = true;
    } else if (!parsed.target) {
      parsed.target = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`revision-plan - create a patch plan from accepted issue-ledger entries

Usage:
  node scripts/revision-plan.mjs [options] <draft-section.md>

Options:
  --include-deferred  Include deferred issues as optional steps.
  --allow-empty       Write an empty plan when no accepted issues exist.
  --json              Print JSON output.
  --help, -h          Show this help.
`);
}

function loadJson(file) {
  return JSON.parse(read(file));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveInputPath(input) {
  return path.isAbsolute(input) ? input : abs(input);
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
