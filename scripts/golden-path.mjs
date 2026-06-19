#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { writeFileAtomic, writeJsonAtomic } from "./lib/files.mjs";

const GOLDEN_SCHEMA = "manuscript-lab.golden-path.v1";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const discovery = discoverProtocol({
  cwd: process.cwd(),
  configPath: options.config,
  workspace: options.workspace,
});
if (discovery.mode === "none" || discovery.errors?.length) {
  const errors = discovery.errors?.length ? discovery.errors : ["No Manuscript Lab project found."];
  fail(errors.join("\n"), options);
}
const paths = protocolPaths(discovery, { cwd: process.cwd() });

const guide = buildGoldenPath();
if (options.write) Object.assign(guide, writeGoldenPath(guide));
if (options.json) console.log(JSON.stringify(guide, null, 2));
else printText(guide);

function buildGoldenPath() {
  const target = options.target || firstDraftTarget() || "draft/01-opening.md";
  const steps = [
    {
      id: "validate",
      purpose: "Prove the project protocol is readable before model or review work.",
      command: labCommand("validate"),
      writes: [],
    },
    {
      id: "status",
      purpose: "Show the cockpit: drafts, runtime packets, issues, exports, and next move.",
      command: labCommand("status"),
      writes: [],
    },
    {
      id: "compose",
      purpose: "Compile the runtime packet for the first section so later tools share context.",
      command: labCommand("compose", target),
      writes: [`state/runtime/${path.basename(target, ".md")}/`],
    },
    {
      id: "driver-dry-run",
      purpose: "Capture what the model-operator would do first without mutating manuscript prose.",
      command: labCommand("drive", `--goal "find the next useful command" --target ${target} --dry-run --write --json`),
      writes: ["state/driver/runs/"],
    },
    {
      id: "practice-strategies",
      purpose: "Run a small model-workflow experiment before choosing a loop shape for creative generation.",
      command: labCommand("practice", "strategies --exercises want-in-room,thing-unsaid --models openrouter:z-ai/glm-5.2 --strategies single,select --seeds 1 --json"),
      writes: ["state/practice-strategies/"],
      requires_model: true,
    },
    {
      id: "eval-snapshot",
      purpose: "Snapshot the strategy evidence so future harness changes can be compared.",
      command: labCommand("eval", "practice-strategies --json"),
      writes: ["state/evals/"],
    },
    {
      id: "report",
      purpose: "Produce the readable cockpit artifact a human can inspect.",
      command: labCommand("report", "--write"),
      writes: ["reports/latest.json", "reports/latest.html"],
    },
  ];

  return {
    schema_version: GOLDEN_SCHEMA,
    generated_at: new Date().toISOString(),
    target,
    mode: discovery.mode,
    title: "Manuscript Lab Golden Path",
    promise: "Show a new user how protocol, driver, practice evidence, eval snapshots, and reports fit together without hiding work in chat.",
    steps,
  };
}

function writeGoldenPath(guide) {
  const runId = `golden-path-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = paths.stateAbs(path.join("golden-path", runId));
  fs.mkdirSync(runDir, { recursive: true });
  writeJsonAtomic(path.join(runDir, "summary.json"), guide);
  writeFileAtomic(path.join(runDir, "GOLDEN_PATH.md"), renderMarkdown(guide), "utf8");
  return {
    ok: true,
    status: "pass",
    run_id: runId,
    run_dir: paths.projectRel(runDir),
    report: paths.projectRel(path.join(runDir, "GOLDEN_PATH.md")),
  };
}

function renderMarkdown(guide) {
  return [
    `# ${guide.title}`,
    "",
    guide.promise,
    "",
    `Target: \`${guide.target}\``,
    "",
    "## Steps",
    "",
    ...guide.steps.flatMap((step, index) => [
      `${index + 1}. ${step.purpose}`,
      "",
      `   \`${step.command}\``,
      "",
    ]),
  ].join("\n");
}

function printText(guide) {
  console.log(guide.title);
  console.log("");
  console.log(guide.promise);
  console.log("");
  for (const [index, step] of guide.steps.entries()) {
    console.log(`${index + 1}. ${step.purpose}`);
    console.log(`   ${step.command}`);
  }
}

function firstDraftTarget() {
  const status = paths.stateAbs("status.md");
  if (!fs.existsSync(status)) return "";
  const match = fs.readFileSync(status, "utf8").match(/\|\s*([^|]+)\s*\|\s*`?(draft\/[^`|\s]+\.md)`?\s*\|/);
  return match?.[2] ?? "";
}

function labCommand(command, args = "") {
  const suffix = args ? ` ${args}` : "";
  if (discovery.mode === "installed") return `mlab ${command}${suffix}`;
  return args ? `npm run ${command} -- ${args}` : `npm run ${command}`;
}

function parseArgs(args) {
  const parsed = { target: "", write: false, json: false, help: false, config: "", workspace: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--write") parsed.write = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--target") parsed.target = args[++index] ?? "";
    else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else if (arg === "--config") parsed.config = args[++index] ?? "";
    else if (arg === "--workspace") parsed.workspace = args[++index] ?? "";
    else fail(`Unexpected argument: ${arg}`, parsed);
  }
  return parsed;
}

function fail(message, opts = {}) {
  if (opts.json) console.log(JSON.stringify({ ok: false, status: "error", error: message }, null, 2));
  else console.error(message);
  process.exit(2);
}

function printHelp() {
  console.log(`golden-path - show the first useful Manuscript Lab product path

Usage:
  mlab golden-path
  mlab golden-path --target draft/01-opening.md --json
  mlab golden-path --write

Options:
  --target <draft>   Draft target for the path. Defaults to first draft in state/status.md.
  --write            Persist the guide under state/golden-path/.
  --json             Print machine-readable output.
  --config <path>    Explicit protocol config path.
  --workspace <path> Explicit workspace root.
`);
}
