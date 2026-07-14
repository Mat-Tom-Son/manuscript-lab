import { spawnSync } from "node:child_process";

// Shared spawn helper for running allowlisted Manuscript Lab commands from
// orchestration surfaces (model driver, MCP server). Captures stdout/stderr as
// UTF-8 text and never inherits the parent's stdio, so protocol streams stay
// clean. `timeoutMs` and `maxBuffer` are opt-in; when omitted the call behaves
// exactly like the historical inline spawnSync in scripts/model-driver.mjs.
export function runDriverCommand({ executable = process.execPath, args = [], cwd, env, timeoutMs, maxBuffer } = {}) {
  const options = {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    options.timeout = timeoutMs;
    options.killSignal = "SIGKILL";
  }
  if (Number.isFinite(maxBuffer) && maxBuffer > 0) {
    options.maxBuffer = maxBuffer;
  }
  return spawnSync(executable, args, options);
}
