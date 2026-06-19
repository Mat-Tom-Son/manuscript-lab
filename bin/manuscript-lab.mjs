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
  "check": ["scripts/doccheck.mjs"],
  "chorus": ["scripts/chorus-runner.mjs"],
  "citations": ["scripts/evidence-spine.mjs", "citations"],
  "claims": ["scripts/evidence-spine.mjs", "claims"],
  "compare:candidates": ["scripts/compare-candidates.mjs"],
  "compose": ["scripts/compose-context.mjs"],
  "context:audit": ["scripts/context-audit.mjs"],
  "diff:audit": ["scripts/revision-diff-audit.mjs"],
  "doctor": ["scripts/doctor.mjs"],
  "drive": ["scripts/model-driver.mjs"],
  "done": ["scripts/done-gate.mjs"],
  "done:no-export": ["scripts/done-gate.mjs", "--skip-exports"],
  "evidence": ["scripts/evidence-spine.mjs", "evidence"],
  "export": ["scripts/export-manuscript.mjs"],
  "gate": ["scripts/gate.mjs"],
  "issues": ["scripts/issue-ledger.mjs"],
  "model:calls": ["scripts/model-call-report.mjs"],
  "model:capabilities": ["scripts/model-capabilities.mjs"],
  "model:smoke": ["scripts/model-smoke.mjs"],
  "practice": ["scripts/practice-runner.mjs"],
  "project": ["scripts/story-workspace.mjs"],
  "report": ["scripts/report.mjs"],
  "revise:candidates": ["scripts/revision-candidates.mjs"],
  "review:report": ["scripts/review-report.mjs"],
  "review:run": ["scripts/review-runner.mjs"],
  "merge:winner": ["scripts/merge-winner.mjs"],
  "room": ["scripts/room-runner.mjs"],
  "status": ["scripts/harness-status.mjs"],
  "story": ["scripts/story-workspace.mjs"],
  "style:signals": ["scripts/style-calibration.mjs", "signals"],
  "sources": ["scripts/evidence-spine.mjs", "sources"],
  "taste:arbiter": ["scripts/taste-arbiter.mjs"],
  "template:audit": ["scripts/template-audit.mjs"],
  "test": ["scripts/run-tests.mjs"],
  "validate": ["scripts/protocol-validate.mjs"],
  "words": ["scripts/word-usage.mjs"],
};

const aliases = {
  "audit": ["scripts/revision-diff-audit.mjs"],
  "compare": ["scripts/compare-candidates.mjs"],
  "init": ["scripts/story-workspace.mjs", "init"],
  "merge": ["scripts/merge-winner.mjs"],
  "new": ["scripts/story-workspace.mjs", "init"],
  "project:init": ["scripts/story-workspace.mjs", "init"],
  "project:list": ["scripts/story-workspace.mjs", "list-projects"],
  "project:sync": ["scripts/story-workspace.mjs", "sync-project"],
  "project:verify": ["scripts/story-workspace.mjs", "verify-projects"],
  "revise": ["scripts/revision-candidates.mjs"],
  "review": ["scripts/review-runner.mjs"],
  "review-report": ["scripts/review-report.mjs"],
  "story:init": ["scripts/story-workspace.mjs", "init"],
  "story:restore": ["scripts/story-workspace.mjs", "restore"],
  "story:unload": ["scripts/story-workspace.mjs", "unload"],
};

const invocation = resolveInvocation(args);
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

if (initHelpRequest(command, rest)) {
  printInitHelp();
  process.exit(0);
}

if (templateOnlyRequest(command, rest)) {
  const discovery = discoverProtocol({ cwd: process.cwd(), packageRoot });
  if (!templateCommandAllowed(discovery)) {
    refuseTemplateOnlyCommand(command, discovery, rest);
  }
}

const target = installAnywhereInitRequest(command, rest)
  ? ["scripts/install-init.mjs"]
  : commands[command] || aliases[command];
if (!target) {
  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

const [script, ...scriptArgs] = target;
const result = spawnSync(process.execPath, [path.join(packageRoot, script), ...scriptArgs, ...rest], {
  cwd: process.cwd(),
  stdio: "inherit",
});

process.exit(result.status ?? 1);

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

function installAnywhereInitRequest(commandName, commandArgs) {
  return commandName === "init" && commandArgs.some((arg) => arg === "--profile" || arg === "--root" || arg.startsWith("--profile=") || arg.startsWith("--root="));
}

function templateOnlyRequest(commandName, commandArgs) {
  if (commandName === "init") return !installAnywhereInitRequest(commandName, commandArgs);
  return templateOnlyCommands.has(commandName);
}

function templateCommandAllowed(discovery) {
  return discovery.mode === "template" && path.resolve(process.cwd()) === path.resolve(discovery.workspaceRoot);
}

function initHelpRequest(commandName, commandArgs) {
  return commandName === "init" && commandArgs.some((arg) => arg === "--help" || arg === "-h");
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
  console.log(`manuscript-lab - file-based writing harness

Usage:
  manuscript-lab <command> [args]
  mlab <command> [args]

Common commands:
  version
  doctor --no-network
  init --profile whitepaper --root manuscript --title "My Whitepaper"
  validate
  status
  drive --goal "find the next useful command" --dry-run
  drive --goal "prepare draft/01-opening.md for review" --target draft/01-opening.md --dry-run --json
  practice propose --exercise want-in-room --model openrouter:z-ai/glm-5.2 --json
  practice bench --exercises core --models openrouter:z-ai/glm-5.2 --seeds 3 --json
  practice strategies --exercises core --models openrouter:z-ai/glm-5.2 --strategies default --json
  compose -- draft/<section>.md
  chorus run draft/<section>.md --models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus
  check --static-only
  claims list --unsupported
  citations check draft/<section>.md
  evidence report
  gate draft/<section>.md
  report --write
  room diagnose draft/<section>.md --json
  room blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
  room decide draft/<section>.md --run <room-run-id> --select idea-001 --reason "..."
  room break draft/<section>.md --run <room-run-id>
  room table-read draft/<section>.md
  export --formats md,html --slug my-project
  done:no-export
  done

Review and revision:
  review draft/<section>.md --dry-run --panel prose.clean
  review report draft/<section>.md
  issues list
  revise draft/<section>.md --issue <issue-id> --candidates 3 --dry-run
  compare draft/<section>.md --run <candidate-run-id> --dry-run
  merge draft/<section>.md --run <candidate-run-id>
  audit --before before.md --after draft/<section>.md --static-only

Writers' room:
  room diagnose draft/<section>.md --json
  room blue-sky draft/<section>.md --json
  room decide draft/<section>.md --run <room-run-id> --select idea-001 --reason "..."
  room break draft/<section>.md --run <room-run-id>
  room table-read draft/<section>.md
  room report draft/<section>.md

Prose line lab:
  chorus plan draft/<section>.md --beats 4
  chorus run draft/<section>.md --json
  chorus run draft/<section>.md --assemble
  chorus sample draft/<section>.md --run <chorus-run-id>
  chorus judge draft/<section>.md --run <chorus-run-id>
  chorus assemble draft/<section>.md --run <chorus-run-id>
  chorus report draft/<section>.md

Compatibility command names:
  review:run
  review:report
  revise:candidates
  compare:candidates
  merge:winner
  diff:audit
  drive
  practice
  words -- draft/<section>.md

Project commands (template clone compatibility only):
  project:init --title "My Project" --slug my-project --sections 4 --kind document.section
  project:init
  story:init
  story:restore
  story:unload
  project:list
  project:sync
  project:verify

The npm scripts remain the broadest template interface. This wrapper also
supports the install-anywhere workflow for config-first workspaces.`);
}

function printInitHelp() {
  console.log(`manuscript-lab init

Install-anywhere workflow:
  mlab init --profile whitepaper --root manuscript --title "My Whitepaper"

Template clone compatibility:
  mlab init --title "My Project" --slug my-project --sections 4 --kind document.section
  mlab project:init --title "My Project" --slug my-project --sections 4 --kind document.section
  mlab story:init --title "My Project" --slug my-project --sections 4 --kind document.section

Notes:
  Passing --profile or --root selects config-first install-anywhere init.
  Bare init, project:init, and story:init preserve the template workspace flow
  only inside a template clone.`);
}
