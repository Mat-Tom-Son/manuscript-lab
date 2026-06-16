import fs from "node:fs";
import path from "node:path";

export function scanReviewErrors(dirOrRel, { cwd = process.cwd() } = {}) {
  const dir = path.isAbsolute(dirOrRel) ? dirOrRel : path.join(cwd, dirOrRel);
  const failures = [];
  const latestByKey = new Map();
  if (!fs.existsSync(dir)) return { failures };

  for (const file of walk(dir).filter((candidate) => candidate.endsWith(".json"))) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isReviewRun(data)) continue;
      const record = reviewRunRecord(file, data, cwd);
      const previous = latestByKey.get(record.key);
      if (!previous || record.sort_key.localeCompare(previous.sort_key) > 0) latestByKey.set(record.key, record);
    } catch (error) {
      failures.push({ file: displayPath(file, cwd), error: `unreadable JSON: ${error.message}` });
    }
  }
  for (const record of latestByKey.values()) {
    if (record.error) failures.push(record);
  }
  return { failures };
}

function isReviewRun(data) {
  return Boolean(data?.run_id && data?.created_at && data?.target?.section_id && data?.pass?.id && data?.model !== undefined && data?.error !== undefined);
}

function reviewRunRecord(file, data, cwd) {
  const section = String(data.target?.section_id || data.target?.file || "");
  const pass = String(data.pass?.id || "");
  const model = String(data.model || "");
  const createdAt = String(data.created_at || "");
  const runId = String(data.run_id || "");
  const shownFile = displayPath(file, cwd);
  return {
    file: shownFile,
    key: [section, pass, model].join("\0"),
    section,
    pass,
    model,
    run_id: runId,
    created_at: createdAt,
    sort_key: `${createdAt}\0${runId}\0${shownFile}`,
    error: String(data.error ?? "").trim(),
  };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function displayPath(file, cwd) {
  return path.relative(cwd, file).split(path.sep).join("/");
}
