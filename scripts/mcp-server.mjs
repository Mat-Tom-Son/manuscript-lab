#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { runDriverCommand } from "./lib/driver-exec.mjs";
import { buildDriverToolCommand, listDriverTools } from "./lib/driver-tool-catalog.mjs";
import { discoverProtocol, safeReadJson } from "./lib/protocol.mjs";

const SERVER_NAME = "manuscript-lab";
const FALLBACK_PROTOCOL_VERSION = "2025-06-18";
const KNOWN_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", FALLBACK_PROTOCOL_VERSION]);
const READ_ONLY_EFFECTS = new Set(["reads_project"]);
const DESTRUCTIVE_EFFECTS = new Set(["writes_draft", "writes_exports", "touches_workspace", "release_action"]);
const DEFAULT_EXPOSURE_APPROVALS = new Set(["auto", "auto_in_operate"]);
const TOOL_TIMEOUT_MS = 120_000;
const TOOL_MAX_BUFFER = 16 * 1024 * 1024;
const STDOUT_TAIL_CHARS = 50_000;
const STDERR_TAIL_CHARS = 8_000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    process.exit(0);
  }
  if (options.errors.length) {
    console.error(options.errors.join("\n"));
    console.error("Run `mlab mcp --help` for usage.");
    process.exit(2);
  }

  const rootDir = path.resolve(options.root || process.cwd());
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    console.error(`--root is not a directory: ${rootDir}`);
    process.exit(2);
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = safeReadJson(path.join(packageRoot, "package.json"), {});
  const tools = exposedTools(options);
  const server = {
    version: String(pkg.version ?? "0.0.0"),
    rootDir,
    pinnedRoot: Boolean(options.root),
    exposure: options.readOnly ? "read-only" : options.allTools ? "all-tools" : "default",
    tools,
    toolsByName: new Map(tools.map((tool) => [tool.name, tool])),
  };

  const discovery = discoverServerWorkspace(server);
  logLine(`v${server.version} serving ${server.tools.length} tools (${server.exposure} exposure) over stdio`);
  logLine(describeWorkspace(discovery, rootDir));

  serve(server);
}

function serve(server) {
  // Exit quietly if the client closes our stdout pipe mid-write.
  process.stdout.on("error", () => process.exit(0));

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  rl.on("line", (line) => {
    const response = handleLine(server, line);
    if (response !== undefined) sendMessage(response);
  });
  rl.on("close", () => {
    logLine("stdin closed; shutting down");
    process.exit(0);
  });
}

function handleLine(server, line) {
  const text = line.trim();
  if (!text) return undefined;

  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return errorResponse(null, -32700, "Parse error");
  }
  return handleMessage(server, message);
}

function handleMessage(server, message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return errorResponse(null, -32600, "Invalid Request");
  }

  const id = message.id;
  if (id === undefined) {
    // Notifications (for example notifications/initialized) never get responses.
    return undefined;
  }

  const method = message.method;
  if (typeof method !== "string" || !method) {
    return errorResponse(id, -32600, "Invalid Request");
  }

  try {
    if (method === "initialize") return resultResponse(id, initializeResult(server, message.params));
    if (method === "ping") return resultResponse(id, {});
    if (method === "tools/list") return resultResponse(id, { tools: server.tools.map((tool) => tool.listing) });
    if (method === "tools/call") {
      const outcome = callTool(server, message.params);
      return outcome.error
        ? errorResponse(id, outcome.error.code, outcome.error.message)
        : resultResponse(id, outcome.result);
    }
    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    logLine(`internal error in ${method}: ${error.message}`);
    return errorResponse(id, -32603, `Internal error: ${error.message}`);
  }
}

function initializeResult(server, params) {
  const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
  return {
    protocolVersion: KNOWN_PROTOCOL_VERSIONS.has(requested) ? requested : FALLBACK_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: server.version },
    instructions: [
      "Manuscript Lab tools mirror the mlab CLI: validation, status, checks, gates, reports, and evidence for a file-based writing project.",
      "Read-only tools are safe to call at any time; state-writing tools only touch the workspace's generated state directory.",
      "If a call reports that no workspace exists, run `mlab init` in the project directory first, then retry.",
    ].join(" "),
  };
}

function callTool(server, params) {
  const name = typeof params?.name === "string" ? params.name.trim() : "";
  const tool = server.toolsByName.get(name);
  if (!tool) {
    return { error: { code: -32602, message: `Unknown tool: ${name || "(missing name)"}` } };
  }

  const discovery = discoverServerWorkspace(server);
  if (discovery.mode === "none") {
    return {
      result: textResult(
        [
          `No Manuscript Lab workspace found from ${server.rootDir}.`,
          "Run `mlab init` in the project directory to scaffold one",
          "(or `mlab init --profile whitepaper --root manuscript --title \"My Project\"` to customize it),",
          "then call this tool again.",
        ].join(" "),
        { isError: true },
      ),
    };
  }

  // Enforce the advertised inputSchema types before catalog normalization:
  // the shared catalog tolerates String()/Number() coercion for the model
  // driver, but a schema-conformant MCP client must never rely on it.
  const typeError = argumentTypeError(tool, params?.arguments);
  if (typeError) {
    return { error: { code: -32602, message: `Invalid arguments for ${name}: ${typeError}` } };
  }

  let command;
  try {
    command = buildDriverToolCommand(tool.toolId, params?.arguments ?? {}, { discovery });
  } catch (error) {
    return { error: { code: -32602, message: `Invalid arguments for ${name}: ${error.message}` } };
  }

  logLine(`tools/call ${name} -> ${command.display}`);
  const run = runDriverCommand({
    executable: command.executable,
    args: command.args,
    cwd: server.rootDir,
    env: toolEnv(server),
    timeoutMs: TOOL_TIMEOUT_MS,
    maxBuffer: TOOL_MAX_BUFFER,
  });
  return { result: runResult(command, run) };
}

function argumentTypeError(tool, args) {
  if (args == null || typeof args !== "object" || Array.isArray(args)) return null;
  const properties = tool.listing.inputSchema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const declared = properties[key];
    if (!declared || value === undefined) continue;
    if (typeof value !== declared.type) return `${key} must be a ${declared.type}`;
  }
  return null;
}

export function runResult(command, run) {
  const isError = Boolean(run.error) || run.status !== 0;
  const parts = [];
  const stdoutTail = tailText(run.stdout, STDOUT_TAIL_CHARS);
  if (stdoutTail) parts.push(stdoutTail);
  if (isError) {
    const stderrTail = tailText(run.stderr, STDERR_TAIL_CHARS);
    if (stderrTail) parts.push(`stderr:\n${stderrTail}`);
    if (run.error && run.error.code === "ETIMEDOUT") {
      parts.push(`${command.display} timed out after ${Math.round(TOOL_TIMEOUT_MS / 1000)}s and was killed.`);
    } else if (run.error) {
      parts.push(`${command.display} failed to run: ${run.error.message}`);
    } else if (run.status === null && run.signal) {
      parts.push(`${command.display} was terminated by signal ${run.signal}.`);
    } else {
      parts.push(`${command.display} exited with code ${run.status}.`);
    }
  }
  return textResult(parts.join("\n\n") || `${command.display} exited 0 with no output.`, { isError });
}

function textResult(text, { isError = false } = {}) {
  return { content: [{ type: "text", text }], isError };
}

function tailText(value, limit) {
  const text = String(value ?? "");
  if (!text.trim()) return "";
  if (text.length <= limit) return text.trimEnd();
  return `...[truncated ${text.length - limit} of ${text.length} chars]\n${text.slice(-limit).trimEnd()}`;
}

function discoverServerWorkspace(server) {
  // --root pins the workspace even when MLAB_WORKSPACE is set in the
  // environment; without --root the server matches plain CLI resolution.
  return discoverProtocol(server.pinnedRoot ? { cwd: server.rootDir, workspace: server.rootDir } : { cwd: server.rootDir });
}

function toolEnv(server) {
  if (!server.pinnedRoot) return process.env;
  return { ...process.env, MLAB_WORKSPACE: server.rootDir };
}

function exposedTools(options) {
  const tools = listDriverTools().map(describeTool);
  if (options.readOnly) return tools.filter((tool) => tool.listing.annotations.readOnlyHint);
  if (options.allTools) return tools;
  return tools.filter((tool) => DEFAULT_EXPOSURE_APPROVALS.has(tool.approval) && !tool.effects.includes("calls_model"));
}

function describeTool(tool) {
  const name = mcpToolName(tool.tool_id);
  return {
    toolId: tool.tool_id,
    name,
    approval: tool.approval,
    effects: [...tool.effects],
    listing: {
      name,
      description: `${tool.public_command} — effects: ${tool.effects.join(", ")}`,
      inputSchema: toolInputSchema(tool),
      annotations: toolAnnotations(tool),
    },
  };
}

function mcpToolName(toolId) {
  return String(toolId).replace(/\./g, "_");
}

function toolAnnotations(tool) {
  const effects = tool.effects ?? [];
  return {
    readOnlyHint: effects.every((effect) => READ_ONLY_EFFECTS.has(effect)),
    destructiveHint: effects.some((effect) => DESTRUCTIVE_EFFECTS.has(effect)),
    openWorldHint: effects.includes("calls_model"),
  };
}

function toolInputSchema(tool) {
  const properties = {};
  const required = [];
  for (const [name, kind] of Object.entries(tool.args ?? {})) {
    const optional = kind.startsWith("optional_");
    const semanticType = optional ? kind.slice("optional_".length) : kind;
    properties[name] = booleanKind(semanticType)
      ? { type: "boolean", description: semanticType }
      : { type: "string", description: semanticType };
    if (!optional) required.push(name);
  }
  const schema = { type: "object", properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

function booleanKind(semanticType) {
  return semanticType === "boolean" || semanticType === "flag" || semanticType.endsWith("_flag");
}

function sendMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function resultResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

function logLine(text) {
  console.error(`[manuscript-lab mcp] ${text}`);
}

function parseArgs(argv) {
  const options = { help: false, allTools: false, readOnly: false, root: "", errors: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all-tools") {
      options.allTools = true;
    } else if (arg === "--read-only") {
      options.readOnly = true;
    } else if (arg === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        options.errors.push("--root requires a directory path.");
      } else {
        options.root = value;
        index += 1;
      }
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice("--root=".length);
      if (!options.root) options.errors.push("--root requires a directory path.");
    } else {
      options.errors.push(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function describeWorkspace(discovery, rootDir) {
  if (discovery.mode === "none") {
    return `no workspace found from ${rootDir}; tools/list works, tool calls will explain how to run mlab init`;
  }
  return `workspace: ${discovery.manuscriptRoot} (${discovery.mode} mode)`;
}

function helpText() {
  return `manuscript-lab mcp - Model Context Protocol server over stdio

Usage:
  mlab mcp [--root <dir>] [--all-tools | --read-only]

Runs a zero-dependency MCP server speaking newline-delimited JSON-RPC 2.0 on
stdin/stdout (logs go to stderr). Tools are generated from the Manuscript Lab
driver tool catalog and execute the local mlab CLI against the workspace
resolved from the server's start directory.

Options:
  --root <dir>   Resolve the workspace from <dir> instead of the current
                 working directory. Tool runs are pinned to it as well.
  --all-tools    Expose every catalog tool, including approval-gated and
                 model-calling tools (review, room blue-sky, chorus, practice,
                 merge apply, export, done).
  --read-only    Expose only read-only tools (no project state writes).
  --help         Show this help.

By default the server exposes tools that never call models and never require
a human approval: reads plus generated-state writes under the workspace's
state directory. The server still starts without a workspace; tool calls then
return guidance to run \`mlab init\`.

Docs: docs/MCP.md`;
}
