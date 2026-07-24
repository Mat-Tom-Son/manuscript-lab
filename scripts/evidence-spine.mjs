#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EvidenceSpineError,
  addSourceCommand,
  citationsCheckCommand,
  evidenceReportCommand,
  listSourcesCommand,
  listClaimsCommand,
  renderCitationsText,
  renderClaimsText,
  renderEvidenceReportText,
  renderSourceAddText,
  renderSourcesText,
} from "./lib/evidence-spine.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execution = executeEvidenceCommand(process.argv.slice(2), { cwd: process.cwd() });
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  process.exitCode = execution.exitCode;
}

export function executeEvidenceCommand(argv, options = {}) {
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      return { exitCode: 0, stdout: helpText(), stderr: "" };
    }

    const [domain, rawVerb, ...rawRest] = argv;
    const { verb, rest } = withDefaultVerb(domain, rawVerb, rawRest);
    if (domain === "claims" && verb === "list") return executeClaimsList(rest, options);
    if (domain === "citations" && verb === "check") return executeCitationsCheck(rest, options);
    if (domain === "evidence" && verb === "report") return executeEvidenceReport(rest, options);
    if (domain === "sources" && verb === "list") return executeSourcesList(rest, options);
    if (domain === "sources" && verb === "add") return executeSourcesAdd(rest, options);

    throw new EvidenceSpineError(`Unknown evidence-spine command: ${argv.join(" ")}`, { exitCode: 2 });
  } catch (error) {
    if (error instanceof EvidenceSpineError) {
      return { exitCode: error.exitCode, stdout: "", stderr: `${error.message}\n` };
    }
    throw error;
  }
}

function withDefaultVerb(domain, rawVerb, rawRest) {
  const defaults = { claims: "list", citations: "check", evidence: "report", sources: "list" };
  const defaultVerb = defaults[domain];
  if (!defaultVerb || (rawVerb && !rawVerb.startsWith("--"))) return { verb: rawVerb, rest: rawRest };
  return { verb: defaultVerb, rest: rawVerb ? [rawVerb, ...rawRest] : rawRest };
}

function executeClaimsList(args, options) {
  const parsed = parseFlags(args, {
    booleans: new Set(["json", "gate", "unsupported"]),
    values: new Set(["section", "status", "risk", "kind"]),
  });
  rejectPositionals(parsed.positionals, "claims list does not accept positional arguments.");
  const result = listClaimsCommand({
    cwd: options.cwd,
    now: options.now,
    unsupported: parsed.flags.unsupported,
    section: parsed.flags.section,
    statuses: parsed.flags.status,
    risks: parsed.flags.risk,
    kinds: parsed.flags.kind,
  });
  const stdout = parsed.flags.json ? `${JSON.stringify(result, null, 2)}\n` : renderClaimsText(result);
  const exitCode = parsed.flags.gate && result.blocker_count > 0 ? 1 : 0;
  return { exitCode, stdout, stderr: "" };
}

function executeCitationsCheck(args, options) {
  const parsed = parseFlags(args, {
    booleans: new Set(["json", "gate"]),
    values: new Set(),
  });
  if (parsed.positionals.length > 1) throw new EvidenceSpineError("citations check accepts at most one target.", { exitCode: 2 });
  const result = citationsCheckCommand({ cwd: options.cwd, target: parsed.positionals[0] });
  const stdout = parsed.flags.json ? `${JSON.stringify(result, null, 2)}\n` : renderCitationsText(result);
  const exitCode = parsed.flags.gate && !result.ok ? 1 : 0;
  return { exitCode, stdout, stderr: "" };
}

function executeEvidenceReport(args, options) {
  const parsed = parseFlags(args, {
    booleans: new Set(["json", "gate"]),
    values: new Set(),
  });
  if (parsed.positionals.length > 1) throw new EvidenceSpineError("evidence report accepts at most one target.", { exitCode: 2 });
  const result = evidenceReportCommand({ cwd: options.cwd, target: parsed.positionals[0] });
  const stdout = parsed.flags.json ? `${JSON.stringify(result, null, 2)}\n` : renderEvidenceReportText(result);
  const exitCode = parsed.flags.gate && !result.ok ? 1 : 0;
  return { exitCode, stdout, stderr: "" };
}

function executeSourcesList(args, options) {
  const parsed = parseFlags(args, {
    booleans: new Set(["json", "gate"]),
    values: new Set(["status"]),
  });
  rejectPositionals(parsed.positionals, "sources list does not accept positional arguments.");
  const result = listSourcesCommand({
    cwd: options.cwd,
    statuses: parsed.flags.status,
  });
  const stdout = parsed.flags.json ? `${JSON.stringify(result, null, 2)}\n` : renderSourcesText(result);
  const exitCode = parsed.flags.gate && !result.ok ? 1 : 0;
  return { exitCode, stdout, stderr: "" };
}

function executeSourcesAdd(args, options) {
  const parsed = parseFlags(args, {
    booleans: new Set(["json"]),
    values: new Set(),
  });
  if (parsed.positionals.length !== 1) throw new EvidenceSpineError("sources add requires exactly one local file path.", { exitCode: 2 });
  const result = addSourceCommand({ cwd: options.cwd, path: parsed.positionals[0], now: options.now });
  const stdout = parsed.flags.json ? `${JSON.stringify(result, null, 2)}\n` : renderSourceAddText(result);
  return { exitCode: 0, stdout, stderr: "" };
}

function parseFlags(args, spec) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    if (spec.booleans.has(rawName)) {
      if (inlineValue != null && inlineValue !== "") throw new EvidenceSpineError(`Option --${rawName} does not take a value.`, { exitCode: 2 });
      flags[rawName] = true;
      continue;
    }

    if (spec.values.has(rawName)) {
      const value = inlineValue != null ? inlineValue : args[++index];
      if (value == null || value.startsWith("--")) throw new EvidenceSpineError(`Option --${rawName} requires a value.`, { exitCode: 2 });
      if (rawName === "status") flags.status = [...(flags.status ?? []), value];
      else if (rawName === "risk") flags.risk = [...(flags.risk ?? []), value];
      else if (rawName === "kind") flags.kind = [...(flags.kind ?? []), value];
      else flags[rawName] = value;
      continue;
    }

    throw new EvidenceSpineError(`Unknown option: --${rawName}`, { exitCode: 2 });
  }
  return { flags, positionals };
}

function rejectPositionals(positionals, message) {
  if (positionals.length) throw new EvidenceSpineError(message, { exitCode: 2 });
}

function helpText() {
  return `Usage:
  node scripts/evidence-spine.mjs claims list [--unsupported] [--section <id-or-path>] [--status <status>] [--risk <risk>] [--kind <kind>] [--json] [--gate]
  node scripts/evidence-spine.mjs citations check [target] [--json] [--gate]
  node scripts/evidence-spine.mjs evidence report [target] [--json] [--gate]
  node scripts/evidence-spine.mjs sources list [--status <status>] [--json] [--gate]
  node scripts/evidence-spine.mjs sources add <local-file> [--json]

Bare claims, citations, evidence, and sources use list/check/report/list respectively.
`;
}
