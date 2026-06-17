import fs from "node:fs";
import path from "node:path";

export function ensureProtocolReady(discovery, { json = false } = {}) {
  if (discovery.config && discovery.mode !== "none" && !discovery.errors?.length) return;

  const errors = discovery.errors?.length ? discovery.errors : ["No Manuscript Lab project found."];
  if (json) {
    console.log(JSON.stringify({ ok: false, errors, warnings: discovery.warnings ?? [] }, null, 2));
  } else {
    for (const error of errors) console.error(error);
  }
  process.exit(2);
}

export function prepareModelProviderEnvironment(discovery, paths) {
  const initialCwd = paths.cwd ?? process.cwd();
  const auditDirFromEnvironment = process.env.MODEL_CALL_AUDIT_DIR !== undefined;
  loadEnvFiles([paths.workspaceAbs(".env"), paths.projectAbs(".env")]);
  if (auditDirFromEnvironment) canonicalizeRelativeEnvPath("MODEL_CALL_AUDIT_DIR", initialCwd);
  process.chdir(discovery.manuscriptRoot);
}

function loadEnvFiles(files) {
  const seen = new Set();
  for (const file of files) {
    const resolved = path.resolve(file);
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
    seen.add(resolved);
    for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      const key = match[1];
      let value = stripEnvQuotes(match[2].trim());
      if (key === "MODEL_CALL_AUDIT_DIR" && value && !path.isAbsolute(value)) {
        value = path.resolve(path.dirname(resolved), value);
      }
      process.env[key] = value;
    }
  }
}

function canonicalizeRelativeEnvPath(name, baseDir) {
  const value = process.env[name];
  if (!value || path.isAbsolute(value)) return;
  process.env[name] = path.resolve(baseDir, value);
}

function stripEnvQuotes(value) {
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) return value.slice(1, -1);
  return value;
}
