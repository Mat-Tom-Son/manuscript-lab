#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { listDriverTools } from "./lib/driver-tool-catalog.mjs";
import { runResult } from "./mcp-server.mjs";

const repoRoot = process.cwd();
const serverScript = path.join(repoRoot, "scripts", "mcp-server.mjs");
const cli = path.join(repoRoot, "bin", "manuscript-lab.mjs");
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-mcp-"));
const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

try {
  const workspace = scaffoldWorkspace();
  await testHandshakeToolsAndCalls(workspace);
  await testServesWithoutWorkspace();
  await testReadOnlyExposure(workspace);
  await testAllToolsExposureWithRootFlag(workspace);
  testHelpAndBadFlags();
  testRunResultSignalLabel();
  console.log("mcp server tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function testHandshakeToolsAndCalls(workspace) {
  const server = startServer({ cwd: workspace });
  try {
    const init = await server.request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-server-test", version: "0.0.0" },
    });
    assert.equal(init.jsonrpc, "2.0");
    assert.equal(init.result.protocolVersion, "2025-06-18", "recognized client protocol version should be echoed");
    assert.equal(init.result.serverInfo.name, "manuscript-lab");
    assert.equal(init.result.serverInfo.version, packageVersion);
    assert.equal(init.result.capabilities.tools.listChanged, false);

    server.notify("notifications/initialized");

    const ping = await server.request(2, "ping");
    assert.deepEqual(ping.result, {});

    const list = await server.request(3, "tools/list");
    const tools = list.result.tools;
    assert(Array.isArray(tools), "tools/list must return a tools array");
    assert(tools.length >= 10, `expected at least 10 default tools, got ${tools.length}`);
    for (const tool of tools) {
      assert.match(tool.name, MCP_NAME_PATTERN, `tool name violates MCP charset: ${tool.name}`);
      assert.equal(typeof tool.description, "string");
      assert(tool.description.includes("effects:"), `description should list effects: ${tool.name}`);
      assert.equal(tool.inputSchema.type, "object", `inputSchema must be an object schema: ${tool.name}`);
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
      assert.equal(typeof tool.annotations.destructiveHint, "boolean");
      assert.equal(typeof tool.annotations.openWorldHint, "boolean");
    }

    const names = tools.map((tool) => tool.name);
    const validate = tools.find((tool) => tool.name === "validate_project");
    assert(validate, "validate_project must be exposed by default");
    assert.equal(validate.annotations.readOnlyHint, true);
    assert.equal(validate.annotations.destructiveHint, false);
    assert.equal(validate.annotations.openWorldHint, false);
    assert.match(validate.description, /mlab validate --json/);

    const check = tools.find((tool) => tool.name === "check_static");
    assert(check, "check_static must be exposed by default");
    assert.deepEqual(check.inputSchema.required, ["target"]);
    assert.equal(check.inputSchema.properties.target.type, "string");
    assert.equal(check.inputSchema.properties.target.description, "project_relative_or_scope");

    for (const excluded of [
      "review_run",
      "room_blue_sky",
      "chorus_run",
      "merge_apply",
      "practice_propose",
      "practice_bench",
      "export_reader",
      "done_no_export",
      "done_export",
    ]) {
      assert(!names.includes(excluded), `${excluded} must not be exposed by default (approval/model gated)`);
    }

    const call = await server.request(4, "tools/call", { name: "validate_project", arguments: {} });
    assert(call.result, `expected a result, got ${JSON.stringify(call)}`);
    assert.notEqual(call.result.isError, true, JSON.stringify(call.result));
    assert.equal(call.result.content[0].type, "text");
    assert.match(call.result.content[0].text, /"ok": true|PASS/);

    const checkCall = await server.request(5, "tools/call", { name: "check_static", arguments: { target: "draft/01-opening.md" } });
    assert(checkCall.result, `expected a result, got ${JSON.stringify(checkCall)}`);
    assert.equal(checkCall.result.content[0].type, "text");
    assert(checkCall.result.content[0].text.trim().length > 0, "tool output text must not be empty");

    const failing = await server.request(6, "tools/call", { name: "artifacts_inspect", arguments: { run_id: "does-not-exist" } });
    assert.equal(failing.result.isError, true, "nonzero exit must map to isError: true");
    assert.match(failing.result.content[0].text, /exited with code/);

    const unknownTool = await server.request(7, "tools/call", { name: "no_such_tool", arguments: {} });
    assert.equal(unknownTool.error.code, -32602);
    assert.match(unknownTool.error.message, /Unknown tool/);

    const badArgs = await server.request(8, "tools/call", { name: "check_static", arguments: { target: "../escape.md" } });
    assert.equal(badArgs.error.code, -32602);
    assert.match(badArgs.error.message, /Invalid arguments/);

    const missingArgs = await server.request(9, "tools/call", { name: "check_static", arguments: {} });
    assert.equal(missingArgs.error.code, -32602);
    assert.match(missingArgs.error.message, /Missing required argument/);

    // Values that violate the advertised inputSchema types must be rejected
    // before catalog normalization can String()-coerce them.
    const badTypeValues = [["array", ["manuscript"]], ["number", 123], ["boolean", true], ["object", { toString: "evil" }]];
    let badTypeId = 12;
    for (const [label, value] of badTypeValues) {
      const badType = await server.request(badTypeId, "tools/call", { name: "gate_target", arguments: { target: value } });
      assert(badType.error, `${label}-typed target must be rejected, got ${JSON.stringify(badType)}`);
      assert.equal(badType.error.code, -32602, `${label}-typed target must map to -32602`);
      assert.match(badType.error.message, /target must be a string/, `${label}-typed target needs a clear type error`);
      badTypeId += 1;
    }

    const unknownMethod = await server.request(10, "resources/list");
    assert.equal(unknownMethod.error.code, -32601);

    server.sendLine("this is not json");
    const parseError = await server.waitForResponse(null);
    assert.equal(parseError.id, null);
    assert.equal(parseError.error.code, -32700);

    server.notify("notifications/unknown");
    const pingAfter = await server.request(11, "ping");
    assert.deepEqual(pingAfter.result, {});
    assert.equal(server.leftoverCount(), 0, "notifications must never produce responses");

    const exit = await server.end();
    assert.equal(exit.code, 0, `server should exit 0 when stdin ends, got ${JSON.stringify(exit)}`);
  } finally {
    server.kill();
  }
}

async function testServesWithoutWorkspace() {
  const empty = path.join(tmp, "no-workspace");
  fs.mkdirSync(empty, { recursive: true });
  const server = startServer({ cwd: empty });
  try {
    const init = await server.request(1, "initialize", { protocolVersion: "1999-01-01" });
    assert.equal(init.result.protocolVersion, "2025-06-18", "unrecognized client protocol version falls back to the latest supported");
    assert.equal(init.result.serverInfo.version, packageVersion);

    const list = await server.request(2, "tools/list");
    assert(list.result.tools.length >= 10, "tools/list must still work without a workspace");

    const call = await server.request(3, "tools/call", { name: "status_project", arguments: {} });
    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /mlab init/);
    assert.equal(fs.readdirSync(empty).length, 0, "no-workspace guidance must not write files");

    const exit = await server.end();
    assert.equal(exit.code, 0);
  } finally {
    server.kill();
  }
}

async function testReadOnlyExposure(workspace) {
  const server = startServer({ cwd: workspace, args: ["--read-only"] });
  try {
    const list = await server.request(1, "tools/list");
    const tools = list.result.tools;
    assert(tools.length > 0, "read-only exposure must include tools");
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must be read-only under --read-only`);
    }
    const names = tools.map((tool) => tool.name);
    assert(names.includes("validate_project"));
    assert(!names.includes("gate_target"), "gate_target writes state and must be hidden under --read-only");
    assert(!names.includes("compose_section"), "compose_section writes state and must be hidden under --read-only");

    const exit = await server.end();
    assert.equal(exit.code, 0);
  } finally {
    server.kill();
  }
}

async function testAllToolsExposureWithRootFlag(workspace) {
  const elsewhere = path.join(tmp, "elsewhere");
  fs.mkdirSync(elsewhere, { recursive: true });
  const server = startServer({ cwd: elsewhere, args: ["--all-tools", `--root=${workspace}`] });
  try {
    const list = await server.request(1, "tools/list");
    const tools = list.result.tools;
    assert.equal(tools.length, listDriverTools().length, "--all-tools must expose the full catalog");
    const names = tools.map((tool) => tool.name);
    for (const expected of ["review_run", "room_blue_sky", "export_reader", "done_export", "practice_bench"]) {
      assert(names.includes(expected), `--all-tools should include ${expected}`);
    }
    const review = tools.find((tool) => tool.name === "review_run");
    assert.equal(review.annotations.openWorldHint, true, "model-calling tools carry openWorldHint");
    const done = tools.find((tool) => tool.name === "done_export");
    assert.equal(done.annotations.destructiveHint, true, "export/release tools carry destructiveHint");

    const call = await server.request(2, "tools/call", { name: "validate_project", arguments: {} });
    assert.notEqual(call.result.isError, true, `--root should pin the workspace: ${JSON.stringify(call.result)}`);
    assert.match(call.result.content[0].text, /"ok": true/);

    const exit = await server.end();
    assert.equal(exit.code, 0);
  } finally {
    server.kill();
  }
}

function testHelpAndBadFlags() {
  const help = spawnSync(process.execPath, [serverScript, "--help"], {
    cwd: tmp,
    env: cleanEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Model Context Protocol/);
  assert.match(help.stdout, /--all-tools/);
  assert.match(help.stdout, /--read-only/);

  const unknown = spawnSync(process.execPath, [serverScript, "--nope"], {
    cwd: tmp,
    env: cleanEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(unknown.status, 2, unknown.stderr || unknown.stdout);
  assert.match(unknown.stderr, /Unknown argument/);
}

function testRunResultSignalLabel() {
  // spawnSync reports an externally signal-killed child as status null +
  // signal; the tool result must name the signal instead of "code null".
  const command = { display: "mlab gate manuscript --json" };
  const killed = runResult(command, { status: null, signal: "SIGKILL", error: null, stdout: "", stderr: "" });
  assert.equal(killed.isError, true);
  assert.match(killed.content[0].text, /was terminated by signal SIGKILL\./);
  assert.doesNotMatch(killed.content[0].text, /exited with code null/);

  const exited = runResult(command, { status: 1, signal: null, error: null, stdout: "", stderr: "boom\n" });
  assert.equal(exited.isError, true);
  assert.match(exited.content[0].text, /exited with code 1\./);
}

function scaffoldWorkspace() {
  const workspace = path.join(tmp, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const init = spawnSync(
    process.execPath,
    [cli, "init", "--profile", "whitepaper", "--root", "manuscript", "--title", "MCP Smoke", "--sections", "1", "--json"],
    { cwd: workspace, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return workspace;
}

function startServer({ cwd, args = [] }) {
  const child = spawn(process.execPath, [serverScript, ...args], {
    cwd,
    env: cleanEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = { buffer: "", messages: [], waiters: [], stderr: "", exit: null, exitWaiters: [] };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    state.buffer += chunk;
    let index = state.buffer.indexOf("\n");
    while (index !== -1) {
      const line = state.buffer.slice(0, index).trim();
      state.buffer = state.buffer.slice(index + 1);
      if (line) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          throw new Error(`stdout line is not JSON (protocol must stay pure): ${line}`);
        }
        state.messages.push(message);
        flushWaiters(state);
      }
      index = state.buffer.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    state.stderr += chunk;
  });
  child.on("exit", (code, signal) => {
    state.exit = { code, signal };
    for (const waiter of state.exitWaiters.splice(0)) waiter(state.exit);
  });

  return {
    sendLine(line) {
      child.stdin.write(`${line}\n`);
    },
    notify(method, params) {
      const message = { jsonrpc: "2.0", method };
      if (params !== undefined) message.params = params;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    request(id, method, params) {
      const message = { jsonrpc: "2.0", id, method };
      if (params !== undefined) message.params = params;
      child.stdin.write(`${JSON.stringify(message)}\n`);
      return waitForResponse(state, id);
    },
    waitForResponse(id, timeoutMs) {
      return waitForResponse(state, id, timeoutMs);
    },
    leftoverCount() {
      return state.messages.length;
    },
    end() {
      child.stdin.end();
      if (state.exit) return Promise.resolve(state.exit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not exit after stdin end; stderr:\n${state.stderr}`)), 15_000);
        state.exitWaiters.push((exit) => {
          clearTimeout(timer);
          resolve(exit);
        });
      });
    },
    kill() {
      if (!state.exit) child.kill("SIGKILL");
    },
  };
}

function waitForResponse(state, id, timeoutMs = 60_000) {
  const index = state.messages.findIndex((message) => message.id === id);
  if (index !== -1) return Promise.resolve(state.messages.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for response id=${JSON.stringify(id)}; stderr:\n${state.stderr}`)), timeoutMs);
    state.waiters.push({
      id,
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

function flushWaiters(state) {
  for (let position = 0; position < state.waiters.length; position += 1) {
    const waiter = state.waiters[position];
    const index = state.messages.findIndex((message) => message.id === waiter.id);
    if (index === -1) continue;
    const [message] = state.messages.splice(index, 1);
    state.waiters.splice(position, 1);
    position -= 1;
    waiter.resolve(message);
  }
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.MLAB_WORKSPACE;
  delete env.MLAB_CONFIG;
  return env;
}
