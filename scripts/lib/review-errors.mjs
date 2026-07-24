import fs from "node:fs";
import path from "node:path";

export function scanReviewErrors(dirOrRel, { cwd = process.cwd() } = {}) {
  const scanned = scanReviewRuns(dirOrRel, { cwd });
  const failures = [...scanned.read_failures];
  const latestByKey = new Map();
  for (const record of scanned.runs) {
    const previous = latestByKey.get(record.key);
    if (!previous || record.sort_key.localeCompare(previous.sort_key) > 0) latestByKey.set(record.key, record);
  }
  for (const record of latestByKey.values()) {
    if (record.error) failures.push(record);
  }
  return { failures, runs: scanned.runs };
}

export function scanReviewRuns(dirOrRel, { cwd = process.cwd() } = {}) {
  const dir = path.isAbsolute(dirOrRel) ? dirOrRel : path.join(cwd, dirOrRel);
  const runs = [];
  const readFailures = [];
  if (!fs.existsSync(dir)) return { runs, read_failures: readFailures };

  for (const file of walk(dir).filter((candidate) => candidate.endsWith(".json"))) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isReviewRun(data)) continue;
      runs.push(reviewRunRecord(file, data, cwd));
    } catch (error) {
      readFailures.push({ file: displayPath(file, cwd), error: `unreadable JSON: ${error.message}` });
    }
  }
  return { runs, read_failures: readFailures };
}

export function assessDeclaredReviewRuns(expectations, runs) {
  const missing = [];
  const fresh = [];
  const stale = [];
  const unknown = [];

  for (const expectation of expectations) {
    const successful = runs
      .filter((run) => run.section === expectation.section && run.pass === expectation.pass && !run.error)
      .sort((left, right) => right.sort_key.localeCompare(left.sort_key));
    if (!successful.length) {
      missing.push(expectationEvidence(expectation));
      continue;
    }

    const latest = successful[0];
    const evidence = {
      ...expectationEvidence(expectation),
      run_id: latest.run_id,
      run_file: latest.file,
      created_at: latest.created_at,
      model: latest.model,
    };
    const content = compareRunContent(expectation, latest);
    if (content.status !== "fresh") {
      (content.status === "stale" ? stale : unknown).push({ ...evidence, reason: content.reason });
      continue;
    }

    if (!latest.definition_sha256) {
      unknown.push({ ...evidence, reason: "run lacks a review-definition fingerprint" });
    } else if (latest.definition_sha256 !== expectation.definition_sha256) {
      stale.push({ ...evidence, reason: "review definition changed since the run" });
    } else {
      fresh.push(evidence);
    }
  }

  return { expected: expectations.length, missing, fresh, stale, unknown };
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
  const targetFile = String(data.target?.file || "");
  const targetManifest = Array.isArray(data.manifest?.visible_files)
    ? data.manifest.visible_files.find((entry) => String(entry?.path || "") === targetFile)
    : null;
  const manifestSha256 = String(targetManifest?.sha256 || "");
  const manifestStripped = targetManifest?.stripped_contract === true;
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
    target_file: targetFile,
    target_sha256: String(data.target?.sha256 || (!manifestStripped ? manifestSha256 : "")),
    target_body_sha256: String(data.target?.body_sha256 || (manifestStripped ? manifestSha256 : "")),
    definition_sha256: String(data.pass?.definition_sha256 || ""),
    registry_sha256: String(data.registry_sha256 || ""),
  };
}

function compareRunContent(expectation, run) {
  if (run.target_body_sha256) {
    return run.target_body_sha256 === expectation.body_sha256
      ? { status: "fresh", reason: "" }
      : { status: "stale", reason: "section body changed since the run" };
  }
  if (run.target_sha256) {
    return run.target_sha256 === expectation.sha256
      ? { status: "fresh", reason: "" }
      : { status: "stale", reason: "target file changed since the legacy run" };
  }
  return { status: "unknown", reason: "run lacks a comparable target-content fingerprint" };
}

function expectationEvidence(expectation) {
  return {
    section: expectation.section,
    file: expectation.file,
    pass: expectation.pass,
    kind: expectation.kind,
    stage: expectation.stage,
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
