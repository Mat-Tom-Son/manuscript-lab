#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { discoverProtocol } from "../scripts/lib/protocol.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const args = process.argv.slice(2);
const pkg = readPackageJson();

const commands = {
  "adopt": ["scripts/adopt.mjs"],
  "check": ["scripts/doccheck.mjs"],
  "citations": ["scripts/evidence-spine.mjs", "citations"],
  "claims": ["scripts/evidence-spine.mjs", "claims"],
  "compare:candidates": ["scripts/compare-candidates.mjs"],
  "compose": ["scripts/compose-context.mjs"],
  "context:audit": ["scripts/context-audit.mjs"],
  "diff:audit": ["scripts/revision-diff-audit.mjs"],
  "doctor": ["scripts/doctor.mjs"],
  "done": ["scripts/done-gate.mjs"],
  "done:no-export": ["scripts/done-gate.mjs", "--skip-exports"],
  "evidence": ["scripts/evidence-spine.mjs", "evidence"],
  "export": ["scripts/export-manuscript.mjs"],
  "gate": ["scripts/gate.mjs"],
  "issues": ["scripts/issue-ledger.mjs"],
  "mcp": ["scripts/mcp-server.mjs"],
  "narrative": ["scripts/narrative-signals.mjs"],
  "project": ["scripts/story-workspace.mjs"],
  "report": ["scripts/report.mjs"],
  "revise:candidates": ["scripts/revision-candidates.mjs"],
  "review:report": ["scripts/review-report.mjs"],
  "review:run": ["scripts/review-runner.mjs"],
  "merge:winner": ["scripts/merge-winner.mjs"],
  "status": ["scripts/harness-status.mjs"],
  "story": ["scripts/story-workspace.mjs"],
  "sources": ["scripts/evidence-spine.mjs", "sources"],
  "template:audit": ["scripts/template-audit.mjs"],
  "test": ["scripts/run-tests.mjs"],
  "validate": ["scripts/protocol-validate.mjs"],
};

// Lab commands route through `mlab lab <name>`; every name also stays a
// hidden top-level compatibility alias below.
const labCommands = {
  "room": ["scripts/room-runner.mjs"],
  "chorus": ["scripts/chorus-runner.mjs"],
  "practice": ["scripts/practice-runner.mjs"],
  "drive": ["scripts/model-driver.mjs"],
  "eval": ["scripts/eval-runner.mjs"],
  "artifacts": ["scripts/artifact-inspector.mjs"],
  "golden-path": ["scripts/golden-path.mjs"],
  "taste": ["scripts/taste-arbiter.mjs"],
  "style": ["scripts/style-calibration.mjs", "signals"],
  "words": ["scripts/word-usage.mjs"],
};

const labModelCommands = {
  "smoke": ["scripts/model-smoke.mjs"],
  "capabilities": ["scripts/model-capabilities.mjs"],
  "calls": ["scripts/model-call-report.mjs"],
};

const aliases = {
  "artifacts": ["scripts/artifact-inspector.mjs"],
  "audit": ["scripts/revision-diff-audit.mjs"],
  "chorus": ["scripts/chorus-runner.mjs"],
  "compare": ["scripts/compare-candidates.mjs"],
  "drive": ["scripts/model-driver.mjs"],
  "eval": ["scripts/eval-runner.mjs"],
  "golden-path": ["scripts/golden-path.mjs"],
  "merge": ["scripts/merge-winner.mjs"],
  "model:calls": ["scripts/model-call-report.mjs"],
  "model:capabilities": ["scripts/model-capabilities.mjs"],
  "model:smoke": ["scripts/model-smoke.mjs"],
  "new": ["scripts/story-workspace.mjs", "init"],
  "practice": ["scripts/practice-runner.mjs"],
  "project:init": ["scripts/story-workspace.mjs", "init"],
  "project:list": ["scripts/story-workspace.mjs", "list-projects"],
  "project:sync": ["scripts/story-workspace.mjs", "sync-project"],
  "project:verify": ["scripts/story-workspace.mjs", "verify-projects"],
  "revise": ["scripts/revision-candidates.mjs"],
  "review": ["scripts/review-runner.mjs"],
  "review-report": ["scripts/review-report.mjs"],
  "room": ["scripts/room-runner.mjs"],
  "story:init": ["scripts/story-workspace.mjs", "init"],
  "story:restore": ["scripts/story-workspace.mjs", "restore"],
  "story:unload": ["scripts/story-workspace.mjs", "unload"],
  "style:signals": ["scripts/style-calibration.mjs", "signals"],
  "style:fingerprint": ["scripts/style-calibration.mjs", "fingerprint"],
  "style:watchlist": ["scripts/style-calibration.mjs", "watchlist"],
  "taste:arbiter": ["scripts/taste-arbiter.mjs"],
  "words": ["scripts/word-usage.mjs"],
};

if (args[0] === "help" && args[1] === "admin") {
  printAdminHelp();
  process.exit(0);
}

const invocation = resolveInvocation(forwardHelpTopic(args));
const command = invocation.command;
const rest = invocation.rest;

const templateOnlyCommands = new Set([
  "project",
  "story",
  "new",
  "project:init",
  "project:list",
  "project:sync",
  "project:verify",
  "story:init",
  "story:restore",
  "story:unload",
]);

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "version" || command === "--version" || command === "-v") {
  printVersion(rest);
  process.exit(0);
}

if (command === "lab") {
  runLab(rest);
}

if (command === "init") {
  await runInit(rest);
}

if (templateOnlyCommands.has(command)) {
  const discovery = discoverProtocol({ cwd: process.cwd(), packageRoot });
  if (!templateCommandAllowed(discovery)) {
    refuseTemplateOnlyCommand(command, discovery, rest);
  }
}

const target = commands[command] || aliases[command];
if (!target) {
  printUnknownCommand(command);
  process.exit(1);
}

runScript(target, rest);

function runScript(scriptTarget, scriptArgs) {
  const [script, ...presetArgs] = scriptTarget;
  const result = spawnSync(process.execPath, [path.join(packageRoot, script), ...presetArgs, ...scriptArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function runLab(labArgs) {
  const sub = labArgs[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printLabHelp();
    process.exit(0);
  }
  if (sub === "model") {
    const modelSub = labArgs[1];
    if (!modelSub || modelSub === "help" || modelSub === "--help" || modelSub === "-h") {
      printLabModelHelp();
      process.exit(0);
    }
    const modelTarget = labModelCommands[modelSub];
    if (!modelTarget) {
      console.error(`Unknown lab model command: ${modelSub}\nAvailable: smoke, capabilities, calls. Run \`mlab lab model --help\`.`);
      process.exit(1);
    }
    runScript(modelTarget, labArgs.slice(2));
  }
  if (sub === "style") {
    const styleSubcommands = new Set(["signals", "watchlist", "fingerprint", "help"]);
    const next = labArgs[1];
    const styleArgs = styleSubcommands.has(next) || next === "--help" || next === "-h" ? labArgs.slice(1) : ["signals", ...labArgs.slice(1)];
    runScript(["scripts/style-calibration.mjs"], styleArgs);
  }
  const labTarget = labCommands[sub];
  if (!labTarget) {
    console.error(`Unknown lab command: ${sub}\nAvailable: ${[...Object.keys(labCommands), "model"].join(", ")}. Run \`mlab lab --help\`.`);
    process.exit(1);
  }
  runScript(labTarget, labArgs.slice(1));
}

async function runInit(commandArgs) {
  if (commandArgs.some((arg) => arg === "--help" || arg === "-h")) {
    printInitHelp();
    process.exit(0);
  }
  if (installAnywhereInitRequest(commandArgs)) {
    runScript(["scripts/install-init.mjs"], commandArgs);
  }

  const discovery = discoverProtocol({ cwd: process.cwd(), packageRoot });
  if (discovery.mode === "template") {
    if (!templateCommandAllowed(discovery)) {
      refuseTemplateOnlyCommand("init", discovery, commandArgs);
    }
    runScript(["scripts/story-workspace.mjs", "init"], commandArgs);
  }

  const { deriveBareInitDefaults } = await import("../scripts/install-init.mjs");
  const defaults = deriveBareInitDefaults(process.cwd());
  const title = explicitOptionValue(commandArgs, "title") ?? defaults.title;
  if (discovery.mode === "none" && !commandArgs.includes("--json")) {
    console.log([
      "No Manuscript Lab workspace found here. Creating one with defaults:",
      `  profile: ${defaults.profile}`,
      `  root:    ${defaults.root}`,
      `  title:   ${title}`,
      "Customize with --profile, --root, and --title (see `mlab init --help`).",
      "",
    ].join("\n"));
  }
  runScript(["scripts/install-init.mjs"], ["--profile", defaults.profile, "--root", defaults.root, "--title", title, ...commandArgs]);
}

function forwardHelpTopic(rawArgs) {
  if (rawArgs[0] !== "help") return rawArgs;
  const topic = rawArgs[1];
  if (!topic || topic.startsWith("-")) return rawArgs;
  return [...rawArgs.slice(1), "--help"];
}

function resolveInvocation(rawArgs) {
  const rawCommand = rawArgs[0] || "help";
  const rawRest = rawArgs[1] === "--" ? rawArgs.slice(2) : rawArgs.slice(1);
  const subcommands = {
    "compare": { "candidates": "compare" },
    "merge": { "winner": "merge" },
    "revise": { "candidates": "revise" },
    "review": { "report": "review:report", "run": "review" },
  };
  const subcommand = rawRest[0];
  const mappedCommand = subcommands[rawCommand]?.[subcommand];
  if (mappedCommand) {
    return { command: mappedCommand, rest: normalizePublicArgs(mappedCommand, rawRest.slice(1)) };
  }
  return { command: rawCommand, rest: normalizePublicArgs(rawCommand, rawRest) };
}

function normalizePublicArgs(commandName, commandArgs) {
  const normalized = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if ((commandName === "revise" || commandName === "revise:candidates") && arg === "--candidates") {
      normalized.push("--n");
      continue;
    }
    if ((commandName === "revise" || commandName === "revise:candidates") && arg.startsWith("--candidates=")) {
      normalized.push(`--n=${arg.slice("--candidates=".length)}`);
      continue;
    }
    if ((commandName === "merge" || commandName === "merge:winner") && arg === "--winner") {
      normalized.push("--candidate");
      const value = commandArgs[index + 1];
      if (value && !value.startsWith("--")) {
        normalized.push(normalizeCandidateId(value));
        index += 1;
      }
      continue;
    }
    if ((commandName === "merge" || commandName === "merge:winner") && arg.startsWith("--winner=")) {
      normalized.push(`--candidate=${normalizeCandidateId(arg.slice("--winner=".length))}`);
      continue;
    }
    normalized.push(arg);
  }
  return normalized;
}

function normalizeCandidateId(value) {
  return /^[a-z]$/i.test(value) ? `candidate-${value.toLowerCase()}` : value;
}

function installAnywhereInitRequest(commandArgs) {
  return commandArgs.some((arg) => arg === "--profile" || arg === "--root" || arg.startsWith("--profile=") || arg.startsWith("--root="));
}

function explicitOptionValue(commandArgs, name) {
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === `--${name}`) return commandArgs[index + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(`--${name}=`.length);
  }
  return undefined;
}

function templateCommandAllowed(discovery) {
  return discovery.mode === "template" && path.resolve(process.cwd()) === path.resolve(discovery.workspaceRoot);
}

function refuseTemplateOnlyCommand(commandName, discovery, commandArgs) {
  const json = commandArgs.includes("--json");
  const message = discovery.mode === "template"
    ? `Command "${commandName}" is template-clone only and must be run from the template clone root.`
    : discovery.mode === "installed"
    ? `Command "${commandName}" is template-clone only. This workspace uses install-anywhere mode.`
    : `Command "${commandName}" is template-clone only and no template clone was found.`;
  const hint = "Use `mlab init --profile whitepaper --root manuscript --title \"My Project\"` for install-anywhere projects.";

  if (json) {
    console.log(JSON.stringify({ ok: false, command: commandName, mode: discovery.mode, error: message, hint }, null, 2));
  } else {
    console.error(`${message}\n${hint}`);
  }
  process.exit(2);
}

function printUnknownCommand(commandName) {
  const suggestion = nearestCommand(commandName);
  const lines = [`Unknown command: ${commandName}`];
  if (suggestion) lines.push(`Did you mean \`mlab ${suggestion}\`?`);
  lines.push(
    "",
    "Command groups: Start, Daily loop, Evidence, Ship, Agents, Lab.",
    "Run `mlab help` for the command list, `mlab lab --help` for lab commands,",
    "or see docs/COMMANDS.md for the full reference.",
  );
  console.error(lines.join("\n"));
}

function nearestCommand(input) {
  const name = String(input ?? "").toLowerCase();
  if (!name) return "";
  const candidates = [...new Set([
    ...Object.keys(commands),
    ...Object.keys(aliases),
    ...Object.keys(labCommands),
    "init",
    "adopt",
    "lab",
    "help",
    "version",
  ])].sort();

  if (name.length >= 3) {
    const prefixed = candidates
      .filter((candidate) => candidate.startsWith(name))
      .sort((a, b) => a.length - b.length || a.localeCompare(b));
    if (prefixed.length) return prefixed[0];
  }

  let best = "";
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances = Array.from({ length: rows }, (_, row) => {
    const line = new Array(cols).fill(0);
    line[0] = row;
    return line;
  });
  for (let col = 0; col < cols; col += 1) distances[0][col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      distances[row][col] = Math.min(
        distances[row - 1][col] + 1,
        distances[row][col - 1] + 1,
        distances[row - 1][col - 1] + cost,
      );
    }
  }
  return distances[rows - 1][cols - 1];
}

function readPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function printVersion(commandArgs) {
  const version = pkg.version ?? "0.0.0";
  if (commandArgs.includes("--json")) {
    console.log(JSON.stringify({ name: pkg.name ?? "manuscript-lab", version }, null, 2));
  } else {
    console.log(version);
  }
}

function printHelp() {
  console.log(`manuscript-lab (mlab) - file-based writing harness

Usage:
  mlab <command> [args]

Start:
  init         — create a workspace here (defaults: --profile whitepaper --root manuscript)
  adopt        — import existing markdown files into a new workspace
  doctor       — environment, package, and provider diagnostics
  validate     — validate config, project files, and section contracts

Daily loop:
  status       — drafts, runtime packets, issues, and run artifacts at a glance
  compose      — compile the auditable runtime packet for a section
  check        — static and model document checks (--fix creates missing scaffolding)
  review       — run typed editorial review passes (review run, review report)
  issues       — manage the durable issue ledger
  revise       — generate competing revision candidates for accepted issues
  compare      — blind pairwise comparison of revision candidates
  merge        — materialize or apply the candidate arena winner
  gate         — evaluate readiness gates (section, citation, manuscript, export)
  report       — project readiness report with blockers and fix commands
  narrative    — advisory narrative-structure observations and intent checks

Evidence:
  claims       — list and audit tracked claims
  citations    — check citation coverage for active sections
  sources      — inspect the source index
  evidence     — full evidence spine report

Ship:
  export       — export reader files (default formats: md,html)
  done         — end-of-run verification gate

Agents:
  mcp          — serve Manuscript Lab tools to agents over MCP stdio

Lab:
  lab          — contained R&D: room, chorus, practice, drive, eval, and more

Run \`mlab help <command>\` or \`mlab <command> --help\` for details.
\`mlab lab --help\` lists lab commands. Full reference: docs/COMMANDS.md.
Template-clone admin commands: \`mlab help admin\`.`);
}

function printLabHelp() {
  console.log(`mlab lab - contained R&D commands

The lab holds generation features under evaluation. They write run artifacts
under state/ and never gate readiness.

Usage:
  mlab lab <command> [args]

Commands:
  room         — writers' room protocol artifacts (diagnose, blue-sky, decide, break, table-read)
  chorus       — prose line lab and contact-sheet artifacts (plan, run, sample, judge, assemble)
  practice     — creative-writing practice exercises (propose, compare, bench, strategies)
  drive        — bounded model-driver loop toward a stated goal
  eval         — snapshot and compare workflow evidence
  artifacts    — inspect generated run artifacts
  golden-path  — first useful product path evidence
  taste        — taste arbiter gate for candidate arena winners
  style        — style signals, registry watchlist, and voice fingerprint
  words        — word usage and reference/candidate contrast reports
  model        — provider utilities: mlab lab model <smoke|capabilities|calls>

Every lab command also works as a top-level alias (for example \`mlab room ...\`).
Run \`mlab lab <command> --help\` for details.`);
}

function printLabModelHelp() {
  console.log(`mlab lab model - provider utilities

Usage:
  mlab lab model smoke         — test the configured model provider with one tiny call
  mlab lab model capabilities  — probe provider capabilities and structured output support
  mlab lab model calls         — inspect the project-local model call ledger

Compatibility aliases: model:smoke, model:capabilities, model:calls.`);
}

function printAdminHelp() {
  console.log(`manuscript-lab template-clone admin commands

These commands manage the template-clone workflow and must run from the
template clone root. Install-anywhere workspaces use \`mlab init\` or
\`mlab adopt\` instead.

  project:init    — scaffold a template project workspace (aliases: new, story:init)
  project:list    — list registered template projects
  project:sync    — sync the active project filesystem
  project:verify  — verify registered project filesystems
  story:restore   — restore an archived story workspace
  story:unload    — unload the active story workspace
  template:audit  — audit template placeholder hygiene
  context:audit   — audit context budgets
  test            — run the package test suite`);
}

function printInitHelp() {
  console.log(`manuscript-lab init

Create a Manuscript Lab workspace in the current directory.

Bare init (outside a template clone):
  mlab init
  Uses defaults: --profile whitepaper --root manuscript --title "<Directory Name>".

Customize:
  mlab init --profile whitepaper --root manuscript --title "My Whitepaper" [--sections 3] [--kind document.section]
  Passing --profile or --root always selects config-first install-anywhere init.

Then:
  mlab status
  mlab check --static-only
  mlab report --write

Template clone note:
  Inside a template clone root, bare init keeps the legacy template workspace
  flow (also available as project:init and story:init):
  mlab init --title "My Project" --slug my-project --sections 4 --kind document.section`);
}
