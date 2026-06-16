import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_STALE_LOCK_MS = 10 * 60_000;
const DEFAULT_RETRY_MS = 35;

export function lockPathFor(file) {
  const full = path.resolve(file);
  return path.join(path.dirname(full), `.${path.basename(full)}.lock`);
}

export function withFileLock(lockPath, callback, options = {}) {
  const full = path.resolve(lockPath);
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = positiveNumber(options.staleMs, DEFAULT_STALE_LOCK_MS);
  const retryMs = positiveNumber(options.retryMs, DEFAULT_RETRY_MS);
  const started = Date.now();
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  fs.mkdirSync(path.dirname(full), { recursive: true });
  acquireLockDir(full, { token, started, timeoutMs, staleMs, retryMs });

  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      throw new Error("withFileLock callback must be synchronous; async callbacks would release the lock before work completes.");
    }
    return result;
  } finally {
    releaseLockDir(full, token);
  }
}

export function writeFileAtomic(file, content, options = "utf8") {
  const full = path.resolve(file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const temp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`);

  try {
    fs.writeFileSync(temp, content, options);
    fs.renameSync(temp, full);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJsonFile(file, fallback = undefined) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return fallback;
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

export function updateJsonFileAtomic(file, fallback, updater, options = {}) {
  const full = path.resolve(file);
  return withFileLock(options.lockPath || lockPathFor(full), () => {
    const current = fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : structuredCloneFallback(fallback);
    const next = updater(current);
    writeJsonAtomic(full, next);
    return next;
  }, options);
}

function acquireLockDir(lockPath, { token, started, timeoutMs, staleMs, retryMs }) {
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify({ token, pid: process.pid, created_at: new Date().toISOString() }, null, 2)}\n`);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      removeStaleLock(lockPath, staleMs);
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for file lock: ${lockPath}`);
      }
      sleepSync(retryMs + Math.floor(Math.random() * retryMs));
    }
  }
}

function removeStaleLock(lockPath, staleMs) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) fs.rmSync(lockPath, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function releaseLockDir(lockPath, token) {
  const ownerFile = path.join(lockPath, "owner.json");
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
  } catch {
    return;
  }
  if (owner?.token !== token) return;

  try {
    fs.rmSync(lockPath, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function structuredCloneFallback(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
