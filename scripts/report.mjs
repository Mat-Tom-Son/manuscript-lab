#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { evaluateGate } from "./gate.mjs";
import { writeFileAtomic, writeJsonAtomic } from "./lib/files.mjs";
import { discoverProtocol, listDrafts, protocolPaths } from "./lib/protocol.mjs";
import {
  NARRATIVE_SIGNALS_SCHEMA,
  aggregateNarrativeProfile,
  checkIntentsAgainstFeatures,
  loadNarrativeFeatures,
  narrativeSignalStaleness,
  parseNarrativeIntents,
} from "./lib/narrative-schema.mjs";
import { parseSectionContract, sectionIdForFile } from "./lib/section-contract.mjs";

const REPORT_SCHEMA = "manuscript-lab.report.v1";

const discovery = discoverProtocol({ cwd: process.cwd() });
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!discovery.config || discovery.mode === "none" || discovery.errors?.length) {
  const errors = discovery.errors?.length ? discovery.errors : ["No Manuscript Lab project found."];
  if (options.json) {
    console.log(JSON.stringify({ schema_version: REPORT_SCHEMA, ok: false, errors, warnings: discovery.warnings ?? [] }, null, 2));
  } else {
    for (const error of errors) console.error(error);
  }
  process.exit(2);
}

const report = buildReport();
if (options.write || options.open) writeReport(report);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else if (options.html) {
  console.log(renderHtml(report));
} else {
  printText(report);
}

process.exit(options.gate && !report.ok ? 1 : 0);

function buildReport() {
  const statusRun = runJsonCommand("scripts/harness-status.mjs", ["--json"], { required: true });
  const evidenceRun = runJsonCommand("scripts/evidence-spine.mjs", ["evidence", "report", "--json"]);
  const gateRun = runManuscriptGate();
  const reviewRun = runJsonCommand("scripts/review-report.mjs", ["--json"]);
  const modelCalls = readModelCalls();
  const revisionTrail = buildRevisionTrail(statusRun.data?.candidate_runs ?? []);
  const exportManifest = readExportManifest();
  const narrative = readNarrativeObservations();
  const status = statusRun.data ?? {};
  const evidence = evidenceRun.data ?? null;
  const gate = gateRun.data ?? null;
  const reviews = reviewRun.data ?? null;
  const sections = (status.drafts ?? []).map((draft) => ({
    section: draft.section,
    file: draft.file,
    status: draft.status,
    words: draft.words,
    target_words: draft.target_words,
    runtime_status: draft.runtime?.status ?? "unknown",
    exists: draft.exists,
  }));
  const blockers = collectBlockers({ status, evidence, gate, commandRuns: [statusRun, evidenceRun, gateRun, reviewRun] });
  const generatedAt = new Date().toISOString();

  const summary = {
    state: blockers.length ? "not_ready" : "ready",
    ready: blockers.length === 0,
    sections: {
      total: sections.length,
      active: sections.filter((section) => section.status !== "todo").length,
      done: sections.filter((section) => section.status === "done").length,
      stale_runtime: sections.filter((section) => ["stale", "missing", "invalid"].includes(section.runtime_status) && section.status !== "todo").length,
    },
    issues: {
      open: Number(status.issues?.open ?? 0),
      deferred: Number(status.issues?.deferred ?? 0),
      total: Number(status.issues?.total ?? 0),
    },
    claims: {
      total: Number(evidence?.claims?.total ?? 0),
      blockers: Number(evidence?.claims?.blocker_count ?? 0),
      unsupported: Number(evidence?.claims?.by_status?.unsupported ?? 0),
      needs_review: Number(evidence?.claims?.by_status?.["needs-review"] ?? 0),
    },
    citations: {
      markers: Number(evidence?.citations?.total_markers ?? 0),
      unresolved: Number(evidence?.citations?.by_state?.unresolved ?? 0) + Number(evidence?.citations?.by_state?.["citation-needed"] ?? 0),
    },
    reviews: {
      runs: Number(reviews?.totals?.runs ?? 0),
      errors: Number(reviews?.totals?.errors ?? 0),
      issues: Number(reviews?.totals?.issues ?? 0),
    },
    revision_trail: revisionTrail.summary,
    candidate_runs: (status.candidate_runs ?? []).length,
    room_runs: (status.room_runs ?? []).length,
    room_runs_by_status: countBy(status.room_runs ?? [], (run) => run.status || "unknown"),
    room_runs_by_operation: countBy(status.room_runs ?? [], (run) => run.operation || "unknown"),
    chorus_runs: (status.chorus_runs ?? []).length,
    chorus_runs_by_status: countBy(status.chorus_runs ?? [], (run) => run.status || "unknown"),
    chorus_runs_by_operation: countBy(status.chorus_runs ?? [], (run) => run.operation || "unknown"),
    generated_artifacts: summarizeGeneratedArtifacts(status.generated_artifacts ?? {}),
    model_calls: modelCalls.count,
    exports: (status.exports ?? []).length,
    narrative: narrative
      ? {
          sections_observed: narrative.sections_observed,
          sections_total: narrative.sections_total,
          convergence_flags: narrative.convergence_flags.length,
          intent_drift: narrative.intent_drift.length,
          stale_templates: narrative.stale_templates.length,
        }
      : null,
  };

  return {
    schema_version: REPORT_SCHEMA,
    ok: blockers.length === 0,
    generated_at: generatedAt,
    project: {
      title: status.title ?? path.basename(discovery.manuscriptRoot),
      profile: discovery.config?.profile ?? "generic",
      mode: discovery.mode,
      workspace_root: discovery.workspaceRoot,
      manuscript_root: discovery.manuscriptRoot,
      config_path: discovery.configPath,
    },
    summary,
    blockers,
    sections,
    issues: status.issues ?? {},
    evidence: evidence
      ? {
          ok: evidence.ok,
          claims: evidence.claims,
          citations: evidence.citations,
          sources: evidence.sources,
          issues: evidence.issues,
        }
      : { ok: false, error: evidenceRun.error || "Evidence report unavailable." },
    reviews: reviews ?? { error: reviewRun.error || "Review report unavailable." },
    gates: {
      manuscript: gate ?? { error: gateRun.error || "Manuscript gate unavailable." },
    },
    revision_trail: revisionTrail,
    narrative,
    candidate_runs: status.candidate_runs ?? [],
    room_runs: status.room_runs ?? [],
    chorus_runs: status.chorus_runs ?? [],
    generated_artifacts: status.generated_artifacts ?? {},
    artifact_recommendations: status.artifact_recommendations ?? [],
    model_calls: modelCalls,
    exports: status.exports ?? [],
    export_manifest: exportManifest,
    suggested_next: status.suggested_next ?? [],
    command_runs: [statusRun, evidenceRun, gateRun, reviewRun].map(publicCommandRun),
    artifacts: {},
  };
}

function collectBlockers({ status, evidence, gate, commandRuns }) {
  const blockers = [];
  for (const run of commandRuns) {
    if (run.required && !run.ok) blockers.push(blocker("command_error", "report", run.error || `${run.command} failed`, { command: run.command }, run.command));
  }
  if (status.issues?.open > 0) blockers.push(blocker("open_issues", "issues", `${status.issues.open} open issue(s) remain.`, status.issues, "mlab issues list --status open"));
  if (status.issues?.deferred > 0) blockers.push(blocker("deferred_issues", "issues", `${status.issues.deferred} deferred issue(s) remain.`, status.issues, "mlab issues list --status deferred"));
  if (evidence && !evidence.ok) {
    for (const issue of (evidence.issues ?? []).filter((item) => item.severity === "blocking").slice(0, 20)) {
      blockers.push(blocker(issue.kind || "evidence", issue.file || "evidence", issue.message || "Evidence blocker remains.", issue, fixForEvidenceIssue(issue)));
    }
  }
  if (gate && !gate.ready) {
    for (const req of (gate.requirements ?? []).filter((item) => ["fail", "error"].includes(item.status)).slice(0, 20)) {
      if (req.id === "sections.ready") {
        const failedSections = Array.isArray(req.evidence?.failed_sections) ? req.evidence.failed_sections : [];
        if (failedSections.length) {
          for (const section of failedSections.slice(0, 20)) {
            const failures = sectionFailures(section);
            blockers.push(blocker(
              "sections.ready",
              section.file || section.id || "section",
              sectionBlockerMessage(section, failures),
              { gate: gate.gate_id, requirement: req.id, section },
              fixForSection(section, failures),
            ));
          }
          continue;
        }
      }
      blockers.push(blocker(req.id, "gate", req.message, { gate: gate.gate_id, requirement: req.id, evidence: req.evidence }, fixForGateRequirement(req)));
    }
  }
  return blockers;
}

function blocker(type, target, message, evidence = {}, fix = "") {
  return { type, target, message, fix, evidence };
}

function runManuscriptGate() {
  // Reuse the gate engine directly so report and `mlab gate manuscript`
  // can never disagree about readiness.
  const command = "node scripts/gate.mjs manuscript --json";
  try {
    const data = evaluateGate({
      gateId: "manuscript-ready",
      targetArg: "manuscript",
      discovery,
      options: { cwd: process.cwd() },
      command: "manuscript-ready manuscript",
    });
    return { command, status: data.exit_code, ok: true, required: true, data, error: "" };
  } catch (error) {
    return { command, status: 2, ok: false, required: true, data: null, error: `Manuscript gate engine failed: ${error.message}` };
  }
}

function sectionFailures(section) {
  return (Array.isArray(section.failures) ? section.failures : []).map((failure) =>
    typeof failure === "string" ? { id: failure, message: "" } : { id: failure.id ?? "", message: failure.message ?? "" });
}

function sectionBlockerMessage(section, failures) {
  const detail = failures.map((failure) => failure.message || failure.id).filter(Boolean).join("; ");
  return `${section.file || section.id} is not ready: ${detail || "section gate failed"}`;
}

function fixForSection(section, failures) {
  const file = section.file || "draft/<section>.md";
  const ids = failures.map((failure) => failure.id);
  if (ids.includes("contract.status_started")) return `set status: draft in the ${file} section contract (manual edit)`;
  if (ids.includes("contract.present") || ids.includes("contract.valid")) return `add a valid section contract to ${file} (manual edit)`;
  if (ids.includes("contract.confirmed")) {
    return `review purpose/acceptance in ${file}, then set confirmed: true in its contract (manual edit)`;
  }
  if (ids.includes("runtime.fresh")) return `mlab compose ${file}`;
  if (ids.includes("words.floor") || ids.includes("content.nonempty_when_active") || ids.includes("word_count.in_band")) {
    return `write more prose in ${file} toward target_words (manual edit)`;
  }
  if (ids.includes("doccheck.static_pass")) return `mlab check ${file}`;
  if (ids.includes("status.synced")) return "mlab check --fix";
  if (ids.includes("issues.no_blockers")) return `mlab issues list --target ${file}`;
  return `mlab gate ${file}`;
}

function fixForEvidenceIssue(issue) {
  const kind = String(issue.kind ?? "");
  if (kind.startsWith("claim")) return "mlab claims list --unsupported";
  return "mlab citations check";
}

function fixForGateRequirement(req) {
  const id = String(req.id ?? "");
  if (id === "sections.any_started") {
    return "Set status: draft in the section contract you are writing, then run mlab compose <file>.";
  }
  if (id === "doccheck.static_all_pass") {
    return hasMissingScaffoldingOutput(req) ? "mlab check --fix" : "mlab check --static-only";
  }
  if (id === "runtime.all_fresh") {
    const stale = (Array.isArray(req.evidence?.stale) ? req.evidence.stale : []).map((entry) => entry.file).filter(Boolean);
    if (!stale.length) return "mlab compose draft/<section>.md";
    return stale.slice(0, 3).map((file) => `mlab compose ${file}`).join(" && ");
  }
  if (id === "citations.ready" || id.startsWith("evidence.citations") || id.startsWith("evidence.sources")) return "mlab citations check";
  if (id.startsWith("evidence.claims")) return "mlab claims list --unsupported";
  if (id === "issues.none_open_or_deferred") return "mlab issues list --status open";
  if (id === "reviews.no_latest_errors") return "mlab review draft/<section>.md";
  if (id === "project.required_files_present") return "mlab check --fix";
  if (id === "outline.sections_resolve") return "update File: references in outline.md (manual edit)";
  if (id === "harness.templates_clean") return "mlab template:audit --strict";
  if (id === "harness.context_clean") return "mlab context:audit --strict";
  if (id === "project.filesystem_verified") return "mlab project:verify";
  if (id === "manuscript.ready") return "mlab gate manuscript";
  if (id.startsWith("export.")) return "mlab export";
  return "mlab gate manuscript --json";
}

function hasMissingScaffoldingOutput(req) {
  const lines = [
    ...(Array.isArray(req.evidence?.stdout) ? req.evidence.stdout : []),
    ...(Array.isArray(req.evidence?.stderr) ? req.evidence.stderr : []),
  ];
  return lines.some((line) => /Missing required project (?:file|directory): |Expected project directory but found file: /.test(String(line)));
}

function runJsonCommand(script, args = [], { required = false } = {}) {
  const command = `node ${script} ${args.join(" ")}`.trim();
  const result = spawnSync(process.execPath, [paths.packageAbs(script), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let data = null;
  let parseError = "";
  if (result.stdout) {
    try {
      data = JSON.parse(result.stdout);
    } catch (error) {
      parseError = error.message;
    }
  }
  return {
    command,
    status: result.status ?? 1,
    ok: Boolean(data) && !parseError,
    required,
    data,
    error: parseError || (result.status && !data ? (result.stderr || result.stdout || `Command exited ${result.status}`).trim() : ""),
  };
}

function publicCommandRun(run) {
  return {
    command: run.command,
    status: run.status,
    ok: run.ok,
    required: run.required,
    error: run.error,
  };
}

function buildRevisionTrail(statusCandidateRuns) {
  const issues = readJsonIfExists(paths.stateAbs("issues/issue-ledger.json"), { issues: [] })?.issues ?? [];
  const acceptedIssues = issues
    .filter((issue) => issue.status === "accepted" || issue.decision?.decision === "accept")
    .map((issue) => ({
      id: issue.id ?? "",
      status: issue.status ?? "",
      category: issue.category ?? "",
      severity: issue.severity ?? "",
      target: issue.target?.file ?? "",
      summary: issue.claim ?? issue.summary ?? issue.recommended_action ?? "",
      revision_instruction: issue.decision?.revision_instruction ?? "",
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const audits = listRevisionAudits();
  const candidateDetails = listCandidateRunDetails(statusCandidateRuns, audits);

  return {
    summary: {
      accepted_issues: acceptedIssues.length,
      candidate_runs: candidateDetails.length,
      winners: candidateDetails.filter((run) => Boolean(run.winner)).length,
      applied: candidateDetails.filter((run) => run.applied).length,
      audits: audits.length,
    },
    accepted_issues: acceptedIssues,
    candidate_runs: candidateDetails,
    audits,
  };
}

function listCandidateRunDetails(statusCandidateRuns, audits) {
  const rootDir = paths.stateAbs("candidates");
  const byRun = new Map();

  for (const run of statusCandidateRuns) {
    byRun.set(run.run_id, {
      section_id: run.section_id ?? "",
      run_id: run.run_id ?? "",
      status: run.status ?? "",
      target: run.target ?? "",
      path: run.path ?? "",
      issue_ids: [],
      decision: run.decision ?? "",
      winner: run.winner ?? "",
      applied: Boolean(run.applied),
      taste_disposition: run.taste_disposition ?? "",
      audit_count: 0,
    });
  }

  if (fs.existsSync(rootDir)) {
    for (const sectionEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!sectionEntry.isDirectory()) continue;
      const sectionDir = path.join(rootDir, sectionEntry.name);
      for (const runEntry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) continue;
        const runDir = path.join(sectionDir, runEntry.name);
        const manifest = readJsonIfExists(path.join(runDir, "manifest.json"), null);
        if (!manifest) continue;
        const decision = readJsonIfExists(path.join(runDir, "decision.json"), null);
        const mergeResult = readJsonIfExists(path.join(runDir, "merge-result.json"), null);
        const tasteGate = readJsonIfExists(path.join(runDir, "taste-arbiter.json"), null);
        byRun.set(manifest.run_id ?? runEntry.name, {
          section_id: manifest.section_id ?? sectionEntry.name,
          run_id: manifest.run_id ?? runEntry.name,
          status: manifest.status ?? "unknown",
          target: manifest.target ?? "",
          path: displayPath(runDir),
          issue_ids: manifest.issue_ids ?? [],
          decision: decision?.decision ?? "",
          winner: decision?.winner ?? "",
          confidence: decision?.confidence ?? "",
          applied: Boolean(mergeResult?.applied ?? decision?.applied),
          taste_disposition: tasteGate?.gate?.disposition ?? "",
          audit_count: 0,
        });
      }
    }
  }

  const runs = [...byRun.values()].sort((left, right) => left.run_id.localeCompare(right.run_id));
  for (const run of runs) {
    run.audit_count = audits.filter((audit) => {
      if (audit.issue_id && run.issue_ids.includes(audit.issue_id)) return true;
      if (run.issue_ids.length) return false;
      if (audit.section_id && audit.section_id === run.section_id) return true;
      return false;
    }).length;
  }
  return runs;
}

function listRevisionAudits() {
  const rootDir = paths.stateAbs("revision-audits");
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  collectJsonFiles(rootDir, files);
  return files
    .map((file) => {
      const data = readJsonIfExists(file, null);
      if (!data) return null;
      return {
        file: displayPath(file),
        run_id: data.run_id ?? path.basename(file, ".json"),
        created_at: data.created_at ?? "",
        mode: data.mode ?? "",
        section_id: data.target?.section_id ?? "",
        issue_id: data.target?.issue_id ?? data.static?.issue_id ?? "",
        before_file: data.target?.before_file ?? data.static?.before_file ?? "",
        after_file: data.target?.after_file ?? data.static?.after_file ?? "",
        word_count_delta: data.static?.word_count_delta ?? null,
        error: data.error ?? "",
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.file.localeCompare(right.file));
}

function collectJsonFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsonFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
}

function renderNarrativeHtml(narrative) {
  if (!narrative) return "";
  const flagRows = narrative.convergence_flags.length
    ? narrative.convergence_flags
        .map(
          (flag) =>
            `<li>${escapeHtml(flag.label)}: ${escapeHtml(flag.reasons.join("; "))}${flag.matches_ai_lean ? " <em>[model-default direction]</em>" : ""}</li>`,
        )
        .join("\n")
    : "<li>No convergence flags.</li>";
  const driftRows = narrative.intent_drift.length
    ? narrative.intent_drift
        .map(
          (drift) =>
            `<li>${escapeHtml(drift.section_id)} ${escapeHtml(drift.intent)}: declared <code>${escapeHtml(drift.declared)}</code>, observed <code>${escapeHtml(String(drift.observed))}</code></li>`,
        )
        .join("\n")
    : "<li>No intent drift.</li>";
  const stale = narrative.stale_templates.length
    ? `<p>Stale observations (excluded from the live summary): ${narrative.stale_templates.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")} — rerun <code>mlab narrative extract</code>, then <code>mlab narrative features</code>.</p>`
    : "";
  return `
    <h2>Narrative Observations (advisory, never gate)</h2>
    <section class="meta">
      <p>Observed: ${narrative.sections_observed}/${narrative.sections_total} section(s)</p>
      <p>Convergence:</p>
      <ul>
${flagRows}
      </ul>
      <p>Intent drift:</p>
      <ul>
${driftRows}
      </ul>
${stale}
    </section>
`;
}

function readNarrativeObservations() {
  const file = paths.stateAbs("observations/manuscript-narrative-profile.json");
  if (!fs.existsSync(file)) return null;
  try {
    const profile = JSON.parse(fs.readFileSync(file, "utf8"));
    if (profile?.schema !== "narrative_profile_v1") return null;
    const featureConfig = loadNarrativeFeatures(discovery.packageRoot, discovery.manuscriptRoot);
    const drafts = listDrafts(discovery);
    const entries = [];
    const missing = [];
    const staleObservations = [];
    drafts.forEach((draft, index) => {
      const text = fs.existsSync(draft.fullPath) ? fs.readFileSync(draft.fullPath, "utf8") : "";
      const contract = parseSectionContract(text);
      const sectionId = sectionIdForFile(draft.fullPath, contract);
      const kind = String(contract?.get("kind") ?? "").trim();
      const signals = readJsonIfExists(paths.stateAbs(`observations/${sectionId}-narrative-signals.json`), null);
      if (!signals || signals.schema !== NARRATIVE_SIGNALS_SCHEMA) {
        missing.push(draft.path);
        return;
      }
      const template = readJsonIfExists(paths.stateAbs(`observations/${sectionId}-template.json`), null);
      const freshness = narrativeSignalStaleness({
        signalsArtifact: signals,
        templateArtifact: template,
        sectionText: text,
        kind,
        featuresSha256: featureConfig.sha256,
      });
      if (freshness.stale) {
        staleObservations.push({
          section_id: sectionId,
          target: draft.path,
          reasons: freshness.reasons,
        });
        return;
      }
      const { intents } = parseNarrativeIntents(contract);
      entries.push({
        section_id: sectionId,
        order_index: index,
        kind,
        features: signals.features,
        intent_check: checkIntentsAgainstFeatures(intents, signals.features),
      });
    });
    const aggregate = aggregateNarrativeProfile(entries, { featureSet: featureConfig.features });
    return {
      advisory: true,
      generated_at: new Date().toISOString(),
      profile_generated_at: profile.generated_at ?? "",
      sections_observed: entries.length,
      sections_total: drafts.length,
      sections_missing_observations: missing,
      stale_templates: staleObservations.map((entry) => entry.section_id),
      stale_observations: staleObservations,
      ...aggregate,
      ...(profile.drafting_model_watch ? { drafting_model_watch: profile.drafting_model_watch } : {}),
    };
  } catch {
    return null;
  }
}

function readExportManifest() {
  const file = paths.exportsAbs("manifest.json");
  const manifest = readJsonIfExists(file, null);
  if (!manifest) return null;
  return {
    file: displayPath(file),
    schema_version: manifest.schema_version ?? "",
    export_id: manifest.export_id ?? "",
    created_at: manifest.created_at ?? "",
    source_commit: manifest.source_commit ?? "",
    source_dirty: manifest.source_dirty ?? null,
    output_summary: manifest.output_summary ?? {},
    outputs: manifest.outputs ?? [],
  };
}

function readModelCalls() {
  const ledger = modelLedgerPath();
  if (!ledger || !fs.existsSync(ledger)) {
    return {
      ledger: ledger ? displayPath(ledger) : "",
      count: 0,
      by_status: {},
      by_operation: {},
      by_model: {},
      recent: [],
    };
  }

  const entries = fs
    .readFileSync(ledger, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    ledger: displayPath(ledger),
    count: entries.length,
    by_status: countBy(entries, (entry) => entry.status || "unknown"),
    by_operation: countBy(entries, (entry) => entry.operation || "unknown"),
    by_model: countBy(entries, (entry) => entry.model || entry.resolved_model || "unknown"),
    recent: entries.slice(-10).map((entry) => ({
      created_at: entry.created_at,
      status: entry.status,
      operation: entry.operation,
      model: entry.model,
      target: entry.target,
      call_dir: entry.call_dir,
    })),
  };
}

function summarizeGeneratedArtifacts(artifacts = {}) {
  const counts = {};
  for (const [key, items] of Object.entries(artifacts)) counts[key] = Array.isArray(items) ? items.length : 0;
  return {
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    ...counts,
  };
}

function modelLedgerPath() {
  if (process.env.MODEL_CALL_AUDIT_DIR) return path.join(path.resolve(process.env.MODEL_CALL_AUDIT_DIR), "ledger.jsonl");

  const registry = readJsonIfExists(paths.workspaceAbs("projects/registry.json"), null);
  const active = typeof registry?.active === "string" ? registry.active : registry?.active?.slug;
  const project = active ? registry?.projects?.[active] : null;
  const logsPath = project?.logs_path || registry?.active?.logs_path || (active ? path.join("projects", "active", active, "logs") : "");
  if (logsPath) return paths.workspaceAbs(path.join(logsPath, "model-calls", "ledger.jsonl"));
  return paths.stateAbs("model-calls/ledger.jsonl");
}

function writeReport(report) {
  const dir = path.isAbsolute(options.out) ? options.out : paths.projectAbs(options.out);
  fs.mkdirSync(dir, { recursive: true });
  const jsonFile = path.join(dir, "latest.json");
  const htmlFile = path.join(dir, "latest.html");
  const withArtifacts = {
    ...report,
    artifacts: {
      json: displayPath(jsonFile),
      html: displayPath(htmlFile),
    },
  };
  writeJsonAtomic(jsonFile, withArtifacts);
  writeFileAtomic(htmlFile, renderHtml(withArtifacts), "utf8");
  report.artifacts = withArtifacts.artifacts;
  if (options.open) openFile(htmlFile);
}

function openFile(file) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  spawnSync(command, args, { stdio: "ignore" });
}

function printText(report) {
  const marker = report.ok ? "PASS" : "FAIL";
  console.log(`${marker} Manuscript Lab Report`);
  console.log(`Project: ${report.project.title}`);
  console.log(`Profile: ${report.project.profile}`);
  console.log(`Status: ${report.summary.state}`);
  console.log("");
  console.log("Sections:");
  if (report.sections.length) {
    for (const section of report.sections) {
      console.log(`- ${section.file}: ${section.status}, runtime ${section.runtime_status}, ${section.words} word(s)`);
    }
  } else {
    console.log("- none");
  }
  console.log("");
  console.log("Summary:");
  console.log(`- issues: ${report.summary.issues.open} open, ${report.summary.issues.deferred} deferred`);
  console.log(`- claims: ${report.summary.claims.total} total, ${report.summary.claims.blockers} blocker(s)`);
  console.log(`- reviews: ${report.summary.reviews.runs} run(s), ${report.summary.reviews.errors} error(s)`);
  console.log(`- revision trail: ${report.summary.revision_trail.accepted_issues} accepted issue(s), ${report.summary.revision_trail.candidate_runs} candidate run(s), ${report.summary.revision_trail.audits} audit(s)`);
  console.log(`- room runs: ${report.summary.room_runs}`);
  console.log(`- chorus runs: ${report.summary.chorus_runs}`);
  console.log(`- generated artifacts: ${report.summary.generated_artifacts.total}`);
  console.log(`- model calls: ${report.summary.model_calls}`);
  console.log(`- exports: ${report.summary.exports}`);
  if (report.export_manifest?.file) console.log(`- export manifest: ${report.export_manifest.file}`);
  if (report.artifacts?.html) console.log(`- html report: ${report.artifacts.html}`);
  if (report.artifacts?.json) console.log(`- json report: ${report.artifacts.json}`);

  if (report.narrative) {
    console.log("");
    console.log("Narrative Observations (advisory, never gate):");
    console.log(`- observed: ${report.narrative.sections_observed}/${report.narrative.sections_total} section(s)`);
    for (const flag of report.narrative.convergence_flags.slice(0, 3)) {
      console.log(`- convergence: ${flag.label}: ${flag.reasons.join("; ")}${flag.matches_ai_lean ? " [model-default direction]" : ""}`);
    }
    for (const drift of report.narrative.intent_drift.slice(0, 5)) {
      console.log(`- intent drift: ${drift.section_id} ${drift.intent}: declared ${drift.declared}, observed ${drift.observed}`);
    }
    if (report.narrative.stale_templates.length) {
      console.log(
        `- stale observations: ${report.narrative.stale_templates.join(", ")} (excluded; rerun mlab narrative extract, then mlab narrative features)`,
      );
    }
  }

  console.log("");
  console.log("Blockers:");
  if (report.blockers.length) {
    for (const item of report.blockers.slice(0, 12)) {
      console.log(`- ${item.type}: ${item.message}`);
      if (item.fix) console.log(`  fix: ${item.fix}`);
    }
    if (report.blockers.length > 12) console.log(`- ... ${report.blockers.length - 12} more`);
  } else {
    console.log("- none");
  }

  console.log("");
  console.log("Creative Labs:");
  if (report.room_runs.length || report.chorus_runs.length) {
    for (const run of report.room_runs.slice(0, 5)) {
      const artifact = run.files?.diagnosis_md || run.files?.report || run.files?.beat_board_md || run.files?.checklist || run.path;
      console.log(`- room/${run.run_id}: ${run.operation || "room"} ${run.status} on ${run.target || run.section_id} -> ${artifact}`);
    }
    for (const run of report.chorus_runs.slice(0, 5)) {
      const artifact = run.files?.contact_sheet || run.files?.report || run.files?.assembled || run.path;
      console.log(`- chorus/${run.run_id}: ${run.operation || "chorus"} ${run.status} on ${run.target || run.section_id} -> ${artifact}`);
    }
  } else {
    console.log("- none");
  }

  console.log("");
  console.log("Generated Artifacts:");
  const artifactItems = flattenGeneratedArtifacts(report.generated_artifacts).slice(0, 10);
  if (artifactItems.length) {
    for (const item of artifactItems) console.log(`- ${item.kind}/${item.run_id}: ${item.status} -> ${item.report || item.path}`);
  } else {
    console.log("- none");
  }
  if (report.artifact_recommendations.length) {
    for (const item of report.artifact_recommendations.slice(0, 5)) {
      console.log(`- recommendation: ${item.message}`);
      if (item.next_command) console.log(`  ${item.next_command}`);
    }
  }

  if (report.suggested_next.length) {
    console.log("");
    console.log("Suggested Next:");
    for (const step of report.suggested_next) console.log(`- ${step}`);
  }
}

function renderHtml(report) {
  const title = `${escapeHtml(report.project.title)} Manuscript Lab Report`;
  const blockerRows = report.blockers.length
    ? report.blockers
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.message)}</td><td>${item.fix ? `<code>${escapeHtml(item.fix)}</code>` : ""}</td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="4">None</td></tr>`;
  const sectionRows = report.sections.length
    ? report.sections
        .map(
          (section) =>
            `<tr><td>${escapeHtml(section.file)}</td><td>${escapeHtml(section.status)}</td><td>${escapeHtml(section.runtime_status)}</td><td>${section.words}</td><td>${section.target_words ?? ""}</td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="5">No sections found.</td></tr>`;
  const exportRows = report.exports.length
    ? report.exports.map((item) => `<li>${escapeHtml(item.file)} (${formatBytes(item.size)})</li>`).join("\n")
    : "<li>None</li>";
  const exportManifest = report.export_manifest?.file
    ? `<p>Manifest: <code>${escapeHtml(report.export_manifest.file)}</code>${report.export_manifest.export_id ? ` (${escapeHtml(report.export_manifest.export_id)})` : ""}</p>`
    : "<p>Manifest: none</p>";
  const issueRows = report.revision_trail.accepted_issues.length
    ? report.revision_trail.accepted_issues
        .map((issue) => `<tr><td>${escapeHtml(issue.id)}</td><td>${escapeHtml(issue.target)}</td><td>${escapeHtml(issue.summary)}</td></tr>`)
        .join("\n")
    : `<tr><td colspan="3">No accepted issues.</td></tr>`;
  const candidateRows = report.revision_trail.candidate_runs.length
    ? report.revision_trail.candidate_runs
        .map(
          (run) =>
            `<tr><td>${escapeHtml(run.run_id)}</td><td>${escapeHtml(run.issue_ids.join(", "))}</td><td>${escapeHtml(run.winner || "none")}</td><td>${run.audit_count}</td><td>${escapeHtml(run.applied ? "yes" : "no")}</td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="5">No candidate runs.</td></tr>`;
  const roomRows = report.room_runs.length
    ? report.room_runs
        .map(
          (run) =>
            `<tr><td>${escapeHtml(run.run_id)}</td><td>${escapeHtml(run.operation || "room")}</td><td>${escapeHtml(run.target || run.section_id)}</td><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.modified_at || run.created_at || "")}</td><td>${run.cards}</td><td>${run.selected}</td><td>${run.beats}</td><td>${artifactLinks(run.files, ["diagnosis_md", "diagnosis_json", "report", "decision", "beat_board_md", "checklist", "reader_text"])}</td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="9">No room runs.</td></tr>`;
  const chorusRows = report.chorus_runs.length
    ? report.chorus_runs
        .map(
          (run) =>
            `<tr><td>${escapeHtml(run.run_id)}</td><td>${escapeHtml(run.operation || "chorus")}</td><td>${escapeHtml(run.target || run.section_id)}</td><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.modified_at || run.created_at || "")}</td><td>${run.beats}</td><td>${run.candidates}</td><td>${run.committed}</td><td>${escapeHtml(run.assembled ? "yes" : "no")}</td><td>${artifactLinks(run.files, ["contact_sheet", "report", "plan_quality", "beat_plan", "voice_pack", "metrics", "assembled"])}</td></tr>`,
        )
        .join("\n")
    : `<tr><td colspan="10">No Chorus runs.</td></tr>`;
  const generatedRows = flattenGeneratedArtifacts(report.generated_artifacts).length
    ? flattenGeneratedArtifacts(report.generated_artifacts)
        .map((item) => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.run_id)}</td><td>${escapeHtml(item.status)}</td><td><code>${escapeHtml(item.report || item.path)}</code></td></tr>`)
        .join("\n")
    : `<tr><td colspan="4">No generated artifacts.</td></tr>`;
  const recommendationRows = report.artifact_recommendations.length
    ? report.artifact_recommendations
        .map((item) => `<li>${escapeHtml(item.message)}${item.next_command ? ` <code>${escapeHtml(item.next_command)}</code>` : ""}</li>`)
        .join("\n")
    : "<li>None</li>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2933; background: #f6f8fb; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1080px; margin: 0 auto; }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 30px; }
    h2 { font-size: 18px; margin-top: 28px; }
    .meta, .grid, table { background: #fff; border: 1px solid #d8dee8; border-radius: 8px; }
    .meta { padding: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; overflow: hidden; }
    .metric { padding: 14px; background: #fff; }
    .metric strong { display: block; font-size: 24px; color: #0f172a; }
    .pass { color: #147a4b; }
    .fail { color: #b42318; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5eaf1; vertical-align: top; }
    th { background: #eef2f7; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
    tr:last-child td { border-bottom: 0; }
    code { background: #eef2f7; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <section class="meta">
      <p>Status: <strong class="${report.ok ? "pass" : "fail"}">${escapeHtml(report.summary.state)}</strong></p>
      <p>Profile: ${escapeHtml(report.project.profile)} | Generated: ${escapeHtml(report.generated_at)}</p>
      <p>Manuscript: <code>${escapeHtml(report.project.manuscript_root)}</code></p>
    </section>

    <h2>Summary</h2>
    <section class="grid">
      <div class="metric"><strong>${report.summary.sections.total}</strong> sections</div>
      <div class="metric"><strong>${report.summary.issues.open}</strong> open issues</div>
      <div class="metric"><strong>${report.summary.claims.blockers}</strong> claim blockers</div>
      <div class="metric"><strong>${report.summary.revision_trail.accepted_issues}</strong> accepted issues</div>
      <div class="metric"><strong>${report.summary.revision_trail.candidate_runs}</strong> candidate runs</div>
      <div class="metric"><strong>${report.summary.room_runs}</strong> room runs</div>
      <div class="metric"><strong>${report.summary.chorus_runs}</strong> Chorus runs</div>
      <div class="metric"><strong>${report.summary.generated_artifacts.total}</strong> artifacts</div>
      <div class="metric"><strong>${report.summary.revision_trail.audits}</strong> diff audits</div>
      <div class="metric"><strong>${report.summary.model_calls}</strong> model calls</div>
    </section>
${renderNarrativeHtml(report.narrative)}
    <h2>Blockers</h2>
    <table>
      <thead><tr><th>Type</th><th>Target</th><th>Message</th><th>Fix</th></tr></thead>
      <tbody>${blockerRows}</tbody>
    </table>

    <h2>Sections</h2>
    <table>
      <thead><tr><th>File</th><th>Status</th><th>Runtime</th><th>Words</th><th>Target</th></tr></thead>
      <tbody>${sectionRows}</tbody>
    </table>

    <h2>Revision Trail</h2>
    <table>
      <thead><tr><th>Accepted Issue</th><th>Target</th><th>Summary</th></tr></thead>
      <tbody>${issueRows}</tbody>
    </table>
    <table>
      <thead><tr><th>Candidate Run</th><th>Issues</th><th>Winner</th><th>Audits</th><th>Applied</th></tr></thead>
      <tbody>${candidateRows}</tbody>
    </table>

    <h2>Creative Labs</h2>
    <table>
      <thead><tr><th>Room Run</th><th>Operation</th><th>Target</th><th>Status</th><th>Updated</th><th>Cards</th><th>Selected</th><th>Beats</th><th>Artifacts</th></tr></thead>
      <tbody>${roomRows}</tbody>
    </table>
    <table>
      <thead><tr><th>Chorus Run</th><th>Operation</th><th>Target</th><th>Status</th><th>Updated</th><th>Beats</th><th>Candidates</th><th>Committed</th><th>Assembled</th><th>Artifacts</th></tr></thead>
      <tbody>${chorusRows}</tbody>
    </table>

    <h2>Generated Artifacts</h2>
    <table>
      <thead><tr><th>Kind</th><th>Run</th><th>Status</th><th>Report</th></tr></thead>
      <tbody>${generatedRows}</tbody>
    </table>
    <ul>${recommendationRows}</ul>

    <h2>Exports</h2>
    ${exportManifest}
    <ul>${exportRows}</ul>
  </main>
</body>
</html>
`;
}

function readJsonIfExists(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function artifactLinks(files = {}, order = []) {
  const items = order
    .filter((key) => files?.[key])
    .map((key) => `<span><code>${escapeHtml(key)}</code>: <code>${escapeHtml(files[key])}</code></span>`);
  return items.length ? items.join("<br>") : `<code>${escapeHtml(files?.path || "")}</code>`;
}

function flattenGeneratedArtifacts(artifacts = {}) {
  return Object.values(artifacts)
    .flatMap((items) => Array.isArray(items) ? items : [])
    .sort((left, right) => String(right.modified_at || "").localeCompare(String(left.modified_at || "")));
}

function displayPath(file) {
  return paths.projectRel(file);
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseArgs(args) {
  const parsed = {
    json: false,
    html: false,
    write: false,
    open: false,
    gate: false,
    out: "reports",
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--html") parsed.html = true;
    else if (arg === "--write") parsed.write = true;
    else if (arg === "--gate") parsed.gate = true;
    else if (arg === "--open") {
      parsed.open = true;
      parsed.write = true;
    } else if (arg === "--out") {
      parsed.out = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!parsed.out) {
    console.error("--out requires a value");
    process.exit(2);
  }
  return parsed;
}

function printHelp() {
  console.log(`report - summarize Manuscript Lab readiness as text, JSON, or HTML

Usage:
  mlab report
  mlab report --json
  mlab report --html
  mlab report --write
  mlab report --write --out reports
  mlab report --open

Options:
  --json       Print the report JSON.
  --html       Print the report HTML.
  --write      Write reports/latest.json and reports/latest.html.
  --out dir    Output directory relative to the manuscript root. Default: reports.
  --open       Write the report and ask the OS to open latest.html.
  --gate       Exit non-zero when blockers remain.
  --help, -h   Show this help.
`);
}
