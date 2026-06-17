#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));
const checks = [];

loadLocalEnv();

if (options.help) {
  printHelp();
  process.exit(0);
}

checkNodeVersion();
checkRequiredHarnessFiles();
checkGit();
checkIgnoredPrivatePaths();
checkProjectWorkspace();
checkExportDependencies();
checkModelEnvironment();
checkPackagePosture();
if (!options["no-network"]) checkGitHubRemote();

const summary = summarize();

if (options.json) {
  console.log(JSON.stringify({ ok: summary.failures === 0 && (!options.strict || summary.warnings === 0), summary, checks }, null, 2));
} else {
  printText(summary);
}

process.exit(summary.failures > 0 || (options.strict && summary.warnings > 0) ? 1 : 0);

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 18 ? "pass" : "fail", "node", `Node.js ${process.versions.node}`, major >= 18 ? "" : "Node.js 18 or newer is required.");
}

function checkRequiredHarnessFiles() {
  const required = [
    "AGENTS.md",
    "README.md",
    "package.json",
    "scripts/story-workspace.mjs",
    "scripts/doccheck.mjs",
    "scripts/install-codex-skill.mjs",
    "scripts/validate-codex-skill.mjs",
    "checks/suite.json",
    "reviews/suite.json",
    "templates/section-contract.md",
    "skills/codex/manuscript-lab/SKILL.md",
    ".pi/skills/longform-writing/SKILL.md",
  ];
  const missing = required.filter((file) => !fs.existsSync(abs(file)));
  add(missing.length ? "fail" : "pass", "harness.files", "Reusable harness files", missing.length ? `Missing: ${missing.join(", ")}` : "Required files are present.");
}

function checkGit() {
  const git = run("git", ["--version"]);
  add(git.status === 0 ? "pass" : "fail", "git.executable", "Git executable", git.status === 0 ? git.stdout.trim() : "Git is required for project hygiene checks.");

  if (git.status !== 0) return;
  const workTree = run("git", ["rev-parse", "--is-inside-work-tree"]);
  add(workTree.status === 0 ? "pass" : "warn", "git.worktree", "Git worktree", workTree.status === 0 ? "Repository detected." : "Not inside a git worktree.");
}

function checkIgnoredPrivatePaths() {
  const privatePaths = [
    ".env",
    ".doccheck/",
    "tmp/",
    "PROJECT.md",
    "brief.md",
    "outline.md",
    "style.md",
    "draft",
    "state",
    "exports",
    "reports",
    "sources",
    "taste",
    "projects/active/",
    "projects/inactive/",
    "projects/registry.json",
    "docs/PROJECT_HANDOFF.md",
    "docs/PROJECT_REVIEW_APPROACH.md",
    ".template-audit.local.json",
  ];
  if (run("git", ["--version"]).status !== 0) {
    add("warn", "gitignore.private_paths", "Private/generated path ignore rules", "Skipped because git is unavailable.");
    return;
  }
  const notIgnored = privatePaths.filter((file) => run("git", ["check-ignore", "-q", "--", file]).status !== 0);
  add(notIgnored.length ? "fail" : "pass", "gitignore.private_paths", "Private/generated path ignore rules", notIgnored.length ? `Not ignored: ${notIgnored.join(", ")}` : "Private/generated paths are ignored.");
}

function checkProjectWorkspace() {
  const transitionFile = abs("state/.transition.json");
  if (fs.existsSync(transitionFile)) {
    add("fail", "workspace.transition", "Workspace transition marker", "state/.transition.json exists. Inspect with npm run story -- transition-status --json.");
  } else {
    add("pass", "workspace.transition", "Workspace transition marker", "No active transition marker.");
  }

  if (!fs.existsSync(abs("state/workspace.json")) && !fs.existsSync(abs("projects/registry.json"))) {
    add("info", "workspace.project", "Project workspace", "No active project initialized yet.");
    return;
  }

  const verify = run(process.execPath, ["scripts/story-workspace.mjs", "verify-projects", "--json"]);
  if (verify.status !== 0) {
    add("warn", "workspace.project", "Project workspace", "Project filesystem verification failed. Run npm run project:sync, then npm run project:verify.");
    return;
  }
  add("pass", "workspace.project", "Project workspace", "Project filesystem verifies.");
}

function checkExportDependencies() {
  add(commandExists("zip") ? "pass" : "warn", "export.epub", "EPUB export dependency", commandExists("zip") ? "`zip` is available." : "`zip` is missing. Markdown/HTML export still works.");
  const python = commandExists("python3");
  add(python ? "pass" : "warn", "export.python", "PDF export Python dependency", python ? "`python3` is available." : "`python3` is missing. Markdown/HTML export still works.");
  if (!python) return;
  const reportlab = run("python3", ["-c", "import reportlab"]);
  add(reportlab.status === 0 ? "pass" : "warn", "export.reportlab", "PDF export ReportLab dependency", reportlab.status === 0 ? "Python package `reportlab` is available." : "Python package `reportlab` is missing. Install it for PDF export.");
}

function checkModelEnvironment() {
  const modelKeys = [
    "OPENROUTER_API_KEY",
    "LIGHTNING_API_KEY",
    "LITAI_API_KEY",
    "MODEL_API_KEY",
  ];
  const present = modelKeys.filter((key) => Boolean(process.env[key]));
  add(present.length ? "pass" : "warn", "model.keys", "Model provider keys", present.length ? `Configured: ${present.join(", ")}. Values not printed.` : "No model provider keys detected. Static checks and dry-runs still work.");

  const auditDir = process.env.MODEL_CALL_AUDIT_DIR;
  if (!auditDir) {
    add("pass", "model.audit_dir", "Model-call audit directory", "Default private audit path will be used when enabled.");
  } else {
    const ignored = run("git", ["check-ignore", "-q", "--", path.relative(root, path.resolve(root, auditDir))]).status === 0;
    add(ignored || process.env.MODEL_CALL_AUDIT_ALLOW_UNSAFE_DIR ? "pass" : "warn", "model.audit_dir", "Model-call audit directory", ignored ? "Custom audit dir is ignored by git." : "Custom audit dir may be unsafe unless deliberately reviewed.");
  }
}

function checkPackagePosture() {
  const pkg = loadJson("package.json", {});
  add(pkg.private === true ? "pass" : "warn", "package.private", "npm publishing posture", pkg.private === true ? "package.json is private; template-first release is protected from accidental npm publish." : "package.json is publishable. Confirm installed-package workflow is ready before publishing.");
  add(pkg.bin ? "pass" : "info", "package.bin", "Local wrapper", pkg.bin ? `Wrapper commands: ${Object.keys(pkg.bin).join(", ")}` : "No bin wrapper configured.");
}

function checkGitHubRemote() {
  if (!commandExists("gh")) {
    add("info", "github.cli", "GitHub CLI", "`gh` is not installed or not on PATH.");
    return;
  }

  const remote = run("git", ["remote", "get-url", "origin"]);
  if (remote.status !== 0) {
    add("info", "github.remote", "GitHub remote", "No origin remote configured.");
    return;
  }

  const view = run("gh", ["repo", "view", "--json", "name,visibility,isTemplate,url"]);
  if (view.status !== 0) {
    add("warn", "github.remote", "GitHub remote", "Could not inspect GitHub repo with gh.");
    return;
  }

  try {
    const repo = JSON.parse(view.stdout);
    add(repo.visibility === "PUBLIC" ? "pass" : "warn", "github.visibility", "GitHub visibility", `${repo.url} is ${repo.visibility}.`);
    add(repo.isTemplate ? "pass" : "warn", "github.template", "GitHub template setting", repo.isTemplate ? "Template repository is enabled." : "Template repository is not enabled.");
  } catch {
    add("warn", "github.remote", "GitHub remote", "Could not parse gh repo output.");
  }
}

function add(status, id, label, detail = "") {
  checks.push({ status, id, label, detail });
}

function summarize() {
  return {
    failures: checks.filter((check) => check.status === "fail").length,
    warnings: checks.filter((check) => check.status === "warn").length,
    passes: checks.filter((check) => check.status === "pass").length,
    info: checks.filter((check) => check.status === "info").length,
  };
}

function printText(summary) {
  console.log("Manuscript Lab Doctor\n");
  for (const check of checks) {
    const icon = check.status.toUpperCase().padEnd(4, " ");
    console.log(`${icon} ${check.label}`);
    if (check.detail) console.log(`     ${check.detail}`);
  }
  console.log(`\nSummary: ${summary.passes} pass, ${summary.warnings} warn, ${summary.failures} fail, ${summary.info} info`);
  if (options.strict && summary.warnings) console.log("Strict mode treats warnings as failures.");
}

function commandExists(command) {
  return run(command, ["--version"]).status === 0 || run("which", [command]).status === 0;
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function loadJson(file, fallback) {
  const full = abs(file);
  if (!fs.existsSync(full)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return fallback;
  }
}

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function loadLocalEnv() {
  const file = abs(".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripEnvQuotes(match[2].trim());
  }
}

function stripEnvQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseArgs(args) {
  const parsed = { help: false, json: false, strict: false, "no-network": false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--no-network") parsed["no-network"] = true;
    else fail(`Unknown option: ${arg}`);
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`doctor - inspect Manuscript Lab environment and release health

Usage:
  npm run doctor
  node scripts/doctor.mjs [options]

Options:
  --json        Print machine-readable output.
  --strict      Exit nonzero when warnings are present.
  --no-network  Skip GitHub CLI remote inspection.
  --help, -h    Show this help.
`);
}
