#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const source = path.join(repoRoot, "skills", "codex", "manuscript-lab");
const options = parseArgs(process.argv.slice(2));
const codexHome = path.resolve(options["codex-home"] || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const skillsDir = path.join(codexHome, "skills");
const target = path.join(skillsDir, "manuscript-lab");

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!fs.existsSync(path.join(source, "SKILL.md"))) {
  fail(`Missing skill source: ${source}`);
}

const action = options.copy ? "copy" : "symlink";

if (options["dry-run"]) {
  console.log(`Would install Manuscript Lab Codex skill by ${action}.`);
  console.log(`Source: ${source}`);
  console.log(`Target: ${target}`);
  process.exit(0);
}

fs.mkdirSync(skillsDir, { recursive: true });

if (pathExists(target)) {
  const current = describeExistingTarget(target);
  if (current.sameSource && !options.force) {
    console.log(`Manuscript Lab Codex skill is already installed at ${target}`);
    process.exit(0);
  }
  if (!options.force) {
    fail(`Target already exists: ${target}\n${current.detail}\nUse --force to replace it.`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

if (options.copy) {
  fs.cpSync(source, target, { recursive: true });
} else {
  fs.symlinkSync(source, target, "dir");
}

console.log(`Installed Manuscript Lab Codex skill at ${target}`);
console.log("Start a new Codex session and invoke $manuscript-lab when working in this repo.");

function describeExistingTarget(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      const resolved = path.resolve(path.dirname(file), link);
      return {
        sameSource: resolved === source,
        detail: `Existing symlink points to ${resolved}`,
      };
    }
    return { sameSource: false, detail: "Existing target is not a symlink." };
  } catch {
    return { sameSource: false, detail: "Could not inspect existing target." };
  }
}

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(args) {
  const parsed = {
    copy: false,
    "dry-run": false,
    force: false,
    help: false,
    "codex-home": "",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--copy") parsed.copy = true;
    else if (arg === "--dry-run") parsed["dry-run"] = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--codex-home") {
      const value = args[i + 1];
      if (!value) fail("--codex-home requires a path.");
      parsed["codex-home"] = value;
      i += 1;
    } else if (arg.startsWith("--codex-home=")) {
      parsed["codex-home"] = arg.slice("--codex-home=".length);
    } else {
      fail(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`install-codex-skill - install the Manuscript Lab Codex skill

Usage:
  npm run codex:install-skill
  node scripts/install-codex-skill.mjs [options]

Options:
  --dry-run             Show planned source and target without changing files.
  --copy                Copy the skill instead of symlinking it.
  --force               Replace an existing target.
  --codex-home <path>   Install under a specific Codex home directory.
  --help, -h            Show this help.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
