#!/usr/bin/env node

import { discoverProtocol, validateProtocolProject } from "./lib/protocol.mjs";

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
const validation = validateProtocolProject(discovery);
const result = {
  ok: validation.ok,
  mode: discovery.mode,
  workspace_root: discovery.workspaceRoot,
  manuscript_root: discovery.manuscriptRoot,
  package_root: discovery.packageRoot,
  config_path: discovery.configPath,
  config: discovery.config,
  draft_count: validation.drafts.length,
  drafts: validation.drafts,
  errors: validation.errors,
  warnings: validation.warnings,
};

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printText(result);
}

process.exit(result.ok ? 0 : 1);

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function printText(result) {
  console.log("Manuscript Lab Protocol");
  console.log("");
  console.log(`Mode: ${result.mode}`);
  console.log(`Workspace: ${result.workspace_root}`);
  console.log(`Manuscript: ${result.manuscript_root}`);
  console.log(`Config: ${result.config_path || "(implicit template mode)"}`);
  console.log(`Drafts: ${result.draft_count}`);
  console.log("");

  if (result.ok) {
    console.log("PASS protocol validation");
  } else {
    console.error("FAIL protocol validation");
  }

  if (result.errors.length) {
    console.error("\nErrors:");
    for (const error of result.errors) console.error(`- ${error}`);
  }

  if (result.warnings.length) {
    console.warn("\nWarnings:");
    for (const warning of result.warnings) console.warn(`- ${warning}`);
  }
}

function printHelp() {
  console.log(`protocol-validate - validate Manuscript Lab file protocol

Usage:
  mlab validate [--json] [--config manuscript-lab.config.json] [--workspace <dir>]
  node scripts/protocol-validate.mjs [options]

The validator accepts current template-first repositories and config-first
install-anywhere workspaces. It is deterministic and does not call models.`);
}
