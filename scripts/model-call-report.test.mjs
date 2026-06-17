#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manuscript-lab-model-calls-"));

try {
  const auditRoot = path.join(tmp, "model-calls");
  fs.mkdirSync(auditRoot, { recursive: true });
  fs.writeFileSync(
    path.join(auditRoot, "ledger.jsonl"),
    `${JSON.stringify({
      call_id: "call-test-001",
      created_at: "2026-06-17T00:00:00.000Z",
      status: "ok",
      operation: "model.smoke",
      provider: "openrouter",
      model: "openrouter:z-ai/glm-5.1",
      resolved_model: "z-ai/glm-5.1",
      usage: { total_tokens: 7, cost: 0.000001 },
      call_dir: "model-calls/calls/call-test-001",
    })}\n`,
    "utf8",
  );

  const result = spawnSync(process.execPath, ["scripts/model-call-report.mjs", "--json"], {
    cwd: root,
    env: { ...process.env, MODEL_CALL_AUDIT_DIR: auditRoot },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.entries[0].operation, "model.smoke");
  assert.equal(path.resolve(root, parsed.ledger), path.join(auditRoot, "ledger.jsonl"));

  console.log("model-call-report tests passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
