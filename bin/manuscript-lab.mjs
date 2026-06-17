#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const args = process.argv.slice(2);
const command = args[0] || "help";
const rest = args[1] === "--" ? args.slice(2) : args.slice(1);

const commands = {
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
  "model:calls": ["scripts/model-call-report.mjs"],
  "model:capabilities": ["scripts/model-capabilities.mjs"],
  "model:smoke": ["scripts/model-smoke.mjs"],
  "project": ["scripts/story-workspace.mjs"],
  "report": ["scripts/report.mjs"],
  "revise:candidates": ["scripts/revision-candidates.mjs"],
  "review:report": ["scripts/review-report.mjs"],
  "review:run": ["scripts/review-runner.mjs"],
  "merge:winner": ["scripts/merge-winner.mjs"],
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
  "init": ["scripts/story-workspace.mjs", "init"],
  "new": ["scripts/story-workspace.mjs", "init"],
  "project:init": ["scripts/story-workspace.mjs", "init"],
  "project:list": ["scripts/story-workspace.mjs", "list-projects"],
  "project:sync": ["scripts/story-workspace.mjs", "sync-project"],
  "project:verify": ["scripts/story-workspace.mjs", "verify-projects"],
  "story:init": ["scripts/story-workspace.mjs", "init"],
  "story:restore": ["scripts/story-workspace.mjs", "restore"],
  "story:unload": ["scripts/story-workspace.mjs", "unload"],
};

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (initHelpRequest(command, rest)) {
  printInitHelp();
  process.exit(0);
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

function installAnywhereInitRequest(commandName, commandArgs) {
  return commandName === "init" && commandArgs.some((arg) => arg === "--profile" || arg === "--root" || arg.startsWith("--profile=") || arg.startsWith("--root="));
}

function initHelpRequest(commandName, commandArgs) {
  return commandName === "init" && commandArgs.some((arg) => arg === "--help" || arg === "-h");
}

function printHelp() {
  console.log(`manuscript-lab - file-based writing harness

Usage:
  manuscript-lab <command> [args]
  mlab <command> [args]

Common commands:
  init --profile whitepaper --root manuscript --title "My Whitepaper"
  project:init --title "My Project" --slug my-project --sections 4 --kind document.section
  validate
  status
  compose -- draft/<section>.md
  check --static-only
  claims list --unsupported
  citations check draft/<section>.md
  evidence report
  gate draft/<section>.md
  report --write
  revise:candidates draft/<section>.md --issue <issue-id> --dry-run
  compare:candidates draft/<section>.md --run <candidate-run-id> --dry-run
  taste:arbiter draft/<section>.md --run <candidate-run-id> --dry-run
  merge:winner draft/<section>.md --run <candidate-run-id>
  doctor
  review:run -- --dry-run --panel prose.clean draft/<section>.md
  issues list
  words -- draft/<section>.md
  export -- --slug my-project
  done:no-export
  done

Project commands:
  project:init
  story:init
  story:restore
  story:unload
  project:list
  project:sync
  project:verify

The npm scripts remain the broadest template interface. This wrapper also
supports the install-anywhere alpha for config-first workspaces.`);
}

function printInitHelp() {
  console.log(`manuscript-lab init

Install-anywhere alpha:
  mlab init --profile whitepaper --root manuscript --title "My Whitepaper"

Template clone compatibility:
  mlab init --title "My Project" --slug my-project --sections 4 --kind document.section
  mlab project:init --title "My Project" --slug my-project --sections 4 --kind document.section
  mlab story:init --title "My Project" --slug my-project --sections 4 --kind document.section

Notes:
  Passing --profile or --root selects config-first install-anywhere init.
  Bare init, project:init, and story:init preserve the template workspace flow.`);
}
