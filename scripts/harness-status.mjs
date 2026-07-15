#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";
import { collectGeneratedArtifacts } from "./lib/generated-artifacts.mjs";

const discovery = discoverProtocol({ cwd: process.cwd() });
const root = discovery.manuscriptRoot;
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const workspaceState = readWorkspaceState();
const projectWorkspace = readProjectWorkspace();
const unloaded = workspaceState.status === "unloaded" && !projectWorkspace.active;
const statusFile = paths.stateAbs("status.md");
const statusRows = !unloaded && fs.existsSync(statusFile) ? parseMarkdownTable(read(statusFile)) : [];
const drafts = unloaded ? [] : statusRows.map(sectionStatus).filter(Boolean);
const issueLedger = loadJson(paths.stateAbs("issues/issue-ledger.json"), { issues: [] });
const issueStats = summarizeIssues(issueLedger.issues ?? []);
const exports = unloaded ? [] : listExports();
const candidateRuns = listCandidateRuns();
const roomRuns = unloaded ? [] : listRoomRuns();
const chorusRuns = unloaded ? [] : listChorusRuns();
const generatedArtifacts = unloaded ? emptyGeneratedArtifacts() : safeGeneratedArtifacts();
const nextDraft = drafts.find((draft) => draft.status === "todo" && draft.file.startsWith("draft/"));
const activeReview = drafts.find((draft) => ["review", "revise"].includes(draft.status) && draft.words > 50);
const activeDraft = drafts.find((draft) => draft.status === "draft" && draft.words > 50);

const summary = {
  title: readTitle(),
  generated_at: new Date().toISOString(),
  mode: discovery.mode,
  workspace_root: discovery.workspaceRoot,
  manuscript_root: discovery.manuscriptRoot,
  config_path: discovery.configPath,
  workspace_state: workspaceState,
  drafts,
  runtime_packets: summarizeRuntimePackets(drafts),
  issues: issueStats,
  candidate_runs: candidateRuns,
  room_runs: roomRuns,
  chorus_runs: chorusRuns,
  generated_artifacts: generatedArtifacts.artifacts,
  artifact_recommendations: generatedArtifacts.recommendations,
  project_workspace: projectWorkspace,
  exports,
  suggested_next: suggestedNext({ nextDraft, activeReview, activeDraft, issueStats }),
};

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printText(summary);
}

function sectionStatus(row) {
  const file = stripCode(row.file ?? "");
  const status = String(row.status ?? "").toLowerCase();
  if (!file) return null;

  const full = abs(file);
  const exists = fs.existsSync(full);
  const text = exists ? read(full) : "";
  const contract = text ? parseSectionContract(text) : new Map();
  const words = text ? wordCount(stripContract(text)) : 0;
  const targetWords = Number(contract.get("target_words") ?? 0) || null;

  return {
    section: row.section ?? "",
    file,
    status,
    notes: row.notes ?? "",
    exists,
    words,
    target_words: targetWords,
    checks: parseContractList(text, "checks"),
    reviews: parseContractList(text, "reviews"),
    runtime: runtimePacketStatus(file, contract),
  };
}

function summarizeRuntimePackets(drafts) {
  return drafts
    .filter((draft) => draft.file.startsWith("draft/"))
    .map((draft) => ({
      section: draft.section,
      file: draft.file,
      ...draft.runtime,
    }));
}

function summarizeIssues(issues) {
  const byStatus = new Map();
  const byTarget = new Map();
  const open = [];
  const deferred = [];

  for (const issue of issues) {
    const status = issue.status ?? "unknown";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    const target = issue.target?.file ?? "(no target)";
    if (status === "open") {
      open.push(issue);
      byTarget.set(target, (byTarget.get(target) ?? 0) + 1);
    }
    if (issue.decision?.decision === "defer" || status === "deferred") deferred.push(issue);
  }

  return {
    total: issues.length,
    open: open.length,
    deferred: deferred.length,
    by_status: Object.fromEntries([...byStatus.entries()].sort()),
    open_by_target: Object.fromEntries([...byTarget.entries()].sort()),
  };
}

function listExports() {
  const dir = paths.exportsAbs();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => /\.(md|html|epub|pdf)$/i.test(file))
    .map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      return {
        file: displayPath(full),
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function listCandidateRuns() {
  const rootDir = paths.stateAbs("candidates");
  if (!fs.existsSync(rootDir)) return [];

  const runs = [];
  for (const sectionEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!sectionEntry.isDirectory()) continue;
    const sectionDir = path.join(rootDir, sectionEntry.name);
    for (const runEntry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      const runDir = path.join(sectionDir, runEntry.name);
      const manifestFile = path.join(runDir, "manifest.json");
      if (!fs.existsSync(manifestFile)) continue;
      const manifest = loadJson(manifestFile, null);
      if (!manifest) continue;
      const decision = loadJson(path.join(runDir, "decision.json"), null);
      const tasteGate = loadJson(path.join(runDir, "taste-arbiter.json"), null);
      const mergeResult = loadJson(path.join(runDir, "merge-result.json"), null);
      runs.push({
        section_id: manifest.section_id ?? sectionEntry.name,
        run_id: manifest.run_id ?? runEntry.name,
        status: manifest.status ?? "unknown",
        target: manifest.target ?? "",
        path: displayPath(runDir),
        decision: decision?.decision ?? "",
        winner: decision?.winner ?? "",
        taste_disposition: tasteGate?.gate?.disposition ?? "",
        taste_can_apply: tasteGate ? Boolean(tasteGate?.gate?.can_apply) : null,
        applied: Boolean(mergeResult?.applied),
        modified_at: fs.statSync(runDir).mtime.toISOString(),
      });
    }
  }

  return runs.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 5);
}

function listRoomRuns() {
  const rootDir = paths.stateAbs("room");
  if (!fs.existsSync(rootDir)) return [];

  const runs = [];
  for (const sectionEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!sectionEntry.isDirectory()) continue;
    const sectionDir = path.join(rootDir, sectionEntry.name);
    for (const runEntry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      const runDir = path.join(sectionDir, runEntry.name);
      const manifest = loadJson(path.join(runDir, "manifest.json"), null) ?? loadJson(path.join(runDir, "room-packet.json"), null);
      if (!manifest) continue;
      const cards = fs.existsSync(path.join(runDir, "idea-cards.jsonl")) ? readJsonl(path.join(runDir, "idea-cards.jsonl")) : [];
      const beatBoard = loadJson(path.join(runDir, "output/beat-board.json"), null);
      const stat = fs.statSync(runDir);
      const files = presentFiles(runDir, {
        manifest: "manifest.json",
        packet: "room-packet.json",
        report: "ROOM_REPORT.md",
        decision: "decision.json",
        diagnosis_json: "output/story-diagnosis.json",
        diagnosis_md: "output/STORY_DIAGNOSIS.md",
        beat_board_json: "output/beat-board.json",
        beat_board_md: "output/beat-board.md",
        checklist: "output/table-read-checklist.md",
        reader_text: "output/reader-text.md",
      });
      runs.push({
        kind: "room",
        section_id: manifest.section_id ?? sectionEntry.name,
        run_id: manifest.run_id ?? runEntry.name,
        status: manifest.status ?? "unknown",
        operation: manifest.operation ?? "",
        target: manifest.target?.file ?? "",
        path: displayPath(runDir),
        created_at: manifest.created_at ?? "",
        completed_at: manifest.completed_at ?? "",
        cards: cards.length,
        selected: cards.filter((card) => card.status === "selected").length,
        parked: cards.filter((card) => card.status === "parked").length,
        rejected: cards.filter((card) => card.status === "rejected").length,
        beats: beatBoard?.beats?.length ?? 0,
        grade: manifest.story_grade ?? "",
        foundation_ready: manifest.foundation_ready ?? null,
        recommended_next: manifest.recommended_next ?? "",
        error_count: Number(manifest.error_count ?? 0),
        cluster_count: Number(manifest.cluster_count ?? 0),
        files,
        modified_at: stat.mtime.toISOString(),
      });
    }
  }

  return runs.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 10);
}

function listChorusRuns() {
  const rootDir = paths.stateAbs("chorus");
  if (!fs.existsSync(rootDir)) return [];

  const runs = [];
  for (const sectionEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!sectionEntry.isDirectory()) continue;
    const sectionDir = path.join(rootDir, sectionEntry.name);
    for (const runEntry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      const runDir = path.join(sectionDir, runEntry.name);
      const manifest = loadJson(path.join(runDir, "manifest.json"), null);
      if (!manifest) continue;
      const beatPlan = loadJson(path.join(runDir, "beat-plan.json"), { beats: [] });
      const metrics = loadJson(path.join(runDir, "metrics.json"), {});
      const stat = fs.statSync(runDir);
      const files = presentFiles(runDir, {
        manifest: "manifest.json",
        beat_plan: "beat-plan.json",
        voice_pack: "voice-pack.json",
        roster: "roster.json",
        plan_quality: "plan-quality.json",
        contact_sheet: "CONTACT_SHEET.md",
        metrics: "metrics.json",
        report: "CHORUS_REPORT.md",
        assembled: "assembled.md",
      });
      runs.push({
        kind: "chorus",
        section_id: manifest.section_id ?? sectionEntry.name,
        run_id: manifest.run_id ?? runEntry.name,
        status: manifest.status ?? "unknown",
        operation: manifest.operation ?? "chorus",
        target: manifest.target?.file ?? "",
        path: displayPath(runDir),
        created_at: manifest.created_at ?? "",
        completed_at: manifest.completed_at ?? "",
        beats: beatPlan.beats?.length ?? Number(manifest.beat_count ?? 0),
        candidates: Number(metrics.candidate_count ?? manifest.sampled_candidate_count ?? 0),
        committed: Number(metrics.committed_beat_count ?? manifest.judged_beat_count ?? 0),
        missing_beats: metrics.missing_beats ?? manifest.missing_beats ?? [],
        assembled: fs.existsSync(path.join(runDir, "assembled.md")),
        selected_models: metrics.selected_models ?? {},
        files,
        modified_at: stat.mtime.toISOString(),
      });
    }
  }

  return runs.sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 10);
}

function safeGeneratedArtifacts() {
  try {
    return collectGeneratedArtifacts(paths, { limit: 5 });
  } catch (error) {
    return {
      artifacts: emptyGeneratedArtifacts().artifacts,
      recommendations: [{
        id: "artifact-discovery-error",
        priority: "high",
        message: error.message,
        artifact: "",
        next_command: "",
      }],
    };
  }
}

function emptyGeneratedArtifacts() {
  return {
    artifacts: {
      driver_runs: [],
      practice_runs: [],
      practice_evals: [],
      practice_benches: [],
      practice_strategies: [],
      eval_runs: [],
      golden_paths: [],
    },
    recommendations: [],
  };
}

function presentFiles(runDir, spec) {
  const files = {};
  for (const [key, rel] of Object.entries(spec)) {
    const full = path.join(runDir, rel);
    if (fs.existsSync(full)) files[key] = displayPath(full);
  }
  return files;
}

function readProjectWorkspace() {
  if (discovery.mode === "installed") {
    return {
      configured: true,
      mode: "installed",
      active: {
        slug: path.basename(discovery.workspaceRoot),
        path: displayPath(discovery.manuscriptRoot),
        workspace_path: displayPath(discovery.manuscriptRoot),
      },
      project_count: 1,
      active_status: "active",
      workspace_path: displayPath(discovery.manuscriptRoot),
      mounted: false,
      updated_at: "",
      config_path: discovery.configPath ? path.relative(discovery.workspaceRoot, discovery.configPath).split(path.sep).join("/") : "",
    };
  }

  const registryFile = paths.workspaceAbs("projects/registry.json");
  if (!fs.existsSync(registryFile)) {
    return {
      configured: false,
      active: null,
      project_count: 0,
    };
  }

  const registry = loadJson(registryFile, { projects: {} });
  const active = registry.active ?? null;
  const project = active?.slug ? registry.projects?.[active.slug] ?? null : null;
  const workspacePath = active?.workspace_path || project?.workspace_path || "";
  return {
    configured: true,
    active,
    project_count: Object.keys(registry.projects ?? {}).length,
    active_status: project?.status ?? "",
    workspace_path: workspacePath,
    mounted: workspacePath ? isRootMountedTo(paths.workspaceAbs(workspacePath)) : false,
    updated_at: registry.updated_at ?? "",
  };
}

function readWorkspaceState() {
  const file = paths.stateAbs("workspace.json");
  if (!fs.existsSync(file)) {
    return {
      status: "active",
      active: true,
    };
  }
  return loadJson(file, { status: "active", active: true });
}

function suggestedNext({ nextDraft, activeReview, activeDraft, issueStats }) {
  if (unloaded) {
    return [
      "No active story is loaded.",
      "Start a new story: npm run project:init -- --title \"New Story\" --slug new-story --sections 4",
      "Restore an archived story: npm run project:restore -- --from archive/<story-archive>",
    ];
  }

  if (issueStats.open > 0) {
    const [target] = Object.keys(issueStats.open_by_target);
    return [
      "Triage open issues before revising.",
      target ? labCommand("issues", `list --status open --target ${target}`) : labCommand("issues", "list --status open"),
      target ? labCommand("revise:candidates", `${target} --issue <issue-id>`) : labCommand("issues", "stats"),
    ];
  }

  if (activeReview?.file && runtimeNeedsCompose(activeReview)) {
    return [
      `Refresh the runtime packet for the section currently in ${activeReview.status}: ${activeReview.file}`,
      labCommand("compose", activeReview.file),
      labCommand("check", activeReview.file),
    ];
  }

  if (nextDraft?.file && runtimeNeedsCompose(nextDraft)) {
    return [
      `Compile the runtime packet for the next planned section: ${nextDraft.file}`,
      labCommand("compose", nextDraft.file),
      `then draft ${nextDraft.file} toward its contract and run ${labCommand("check", nextDraft.file)}`,
    ];
  }

  if (activeDraft?.file && runtimeNeedsCompose(activeDraft)) {
    return [
      `Refresh the runtime packet for the active section: ${activeDraft.file}`,
      labCommand("compose", activeDraft.file),
      labCommand("check", activeDraft.file),
    ];
  }

  if (activeReview?.file) {
    return [
      `Finish the section currently in ${activeReview.status}: ${activeReview.file}`,
      labCommand("review:run", `--dry-run --panel prose.clean ${activeReview.file}`),
      labCommand("check", activeReview.file),
    ];
  }

  if (nextDraft?.file) {
    return [
      `Draft the next planned section: ${nextDraft.file}`,
      `write ${nextDraft.file} toward its contract (purpose, acceptance, target words)`,
      labCommand("check", nextDraft.file),
    ];
  }

  if (activeDraft?.file) {
    return [
      `Review or continue the active section: ${activeDraft.file}`,
      labCommand("review:run", `--dry-run --panel prose.clean ${activeDraft.file}`),
      labCommand("check", activeDraft.file),
    ];
  }

  return ["Run final checks and export.", labCommand("check", "--static-only"), labCommand("export")];
}

function printText(data) {
  console.log(`${data.title} Harness Status`);
  console.log("");

  console.log("Drafts:");
  if (data.workspace_state?.status === "unloaded") {
    console.log("- none; workspace is unloaded");
  } else for (const draft of data.drafts) {
    const target = draft.target_words ? `/${draft.target_words}` : "";
    const marker = draft.exists ? "" : " missing";
    console.log(`- ${draft.section}: ${draft.status}, ${draft.words}${target} words -> ${draft.file}${marker}`);
  }
  console.log("");

  console.log("Runtime Packets:");
  if (data.runtime_packets.length) {
    for (const packet of data.runtime_packets) {
      const stale = packet.stale_inputs?.length ? `, ${packet.stale_inputs.length} stale input(s)` : "";
      const visible = Number.isFinite(packet.visible_files) ? `, ${packet.visible_files} visible file(s)` : "";
      console.log(`- ${packet.section_id}: ${packet.status}${visible}${stale} -> ${packet.path}`);
    }
  } else {
    console.log(`- none yet; run ${labCommand("compose", "draft/<section>.md")}`);
  }
  console.log("");

  console.log("Issues:");
  console.log(`- total: ${data.issues.total}`);
  console.log(`- open: ${data.issues.open}`);
  console.log(`- deferred: ${data.issues.deferred}`);
  if (Object.keys(data.issues.open_by_target).length) {
    for (const [target, count] of Object.entries(data.issues.open_by_target)) {
      console.log(`- ${target}: ${count} open`);
    }
  }
  console.log("");

  console.log("Candidate Runs:");
  if (data.candidate_runs.length) {
    for (const run of data.candidate_runs) {
      const decision = run.decision ? `, ${run.decision}${run.winner ? ` -> ${run.winner}` : ""}` : "";
      const taste = run.taste_disposition ? `, taste ${run.taste_disposition}${run.taste_can_apply ? "" : " (stop)"}` : "";
      const applied = run.applied ? ", applied" : "";
      console.log(`- ${run.section_id}: ${run.status}${decision}${taste}${applied} -> ${run.path}`);
    }
  } else {
    console.log(`- none yet; run ${labCommand("revise:candidates", "draft/<section>.md --issue <issue-id>")}`);
  }
  console.log("");

  // Lab surfaces (room, chorus, generated artifacts) appear only once runs
  // exist: status reports the state of the writing loop, it does not advertise
  // R&D features to fresh projects. Discovery lives in `mlab lab --help`.
  if (data.room_runs.length) {
    console.log("Room Runs (lab):");
    for (const run of data.room_runs) {
      const decision = run.selected || run.parked || run.rejected ? `, selected ${run.selected}, parked ${run.parked}, rejected ${run.rejected}` : "";
      const beats = run.beats ? `, ${run.beats} beat(s)` : "";
      const artifact = run.files?.diagnosis_md || run.files?.report || run.files?.beat_board_md || run.files?.checklist || run.path;
      console.log(`- ${run.section_id}: ${run.operation || "room"} ${run.status}${decision}${beats} -> ${artifact}`);
    }
    console.log("");
  }

  if (data.chorus_runs.length) {
    console.log("Chorus Runs (lab):");
    for (const run of data.chorus_runs) {
      const assembled = run.assembled ? ", assembled" : "";
      const artifact = run.files?.contact_sheet || run.files?.report || run.files?.assembled || run.path;
      console.log(`- ${run.section_id}: ${run.operation || "chorus"} ${run.status}, ${run.beats} beat(s), ${run.candidates} candidate(s), ${run.committed} committed${assembled} -> ${artifact}`);
    }
    console.log("");
  }

  const generatedGroups = [
    ["Driver", data.generated_artifacts?.driver_runs ?? []],
    ["Practice", data.generated_artifacts?.practice_runs ?? []],
    ["Practice Bench", data.generated_artifacts?.practice_benches ?? []],
    ["Practice Strategy", data.generated_artifacts?.practice_strategies ?? []],
    ["Eval", data.generated_artifacts?.eval_runs ?? []],
    ["Golden Path", data.generated_artifacts?.golden_paths ?? []],
  ];
  const visibleGroups = generatedGroups.filter(([, items]) => items.length);
  if (visibleGroups.length || data.artifact_recommendations?.length) {
    console.log("Generated Artifacts (lab):");
    for (const [label, items] of visibleGroups) {
      for (const item of items.slice(0, 3)) {
        const report = item.report || item.path;
        console.log(`- ${label}/${item.run_id}: ${item.status} -> ${report}`);
      }
    }
    for (const item of (data.artifact_recommendations ?? []).slice(0, 3)) {
      console.log(`- recommendation: ${item.message}`);
      if (item.next_command) console.log(`  ${item.next_command}`);
    }
    console.log("");
  }

  console.log("Project Workspace:");
  if (data.project_workspace?.mode === "installed") {
    console.log("- mode: installed");
    console.log(`- workspace: ${data.workspace_root}`);
    console.log(`- manuscript: ${data.manuscript_root}`);
    if (data.project_workspace.config_path) console.log(`- config: ${data.project_workspace.config_path}`);
  } else if (data.project_workspace?.configured && data.project_workspace.active) {
    const active = data.project_workspace.active;
    console.log(`- active: ${active.slug} -> ${active.path}`);
    if (data.project_workspace.workspace_path) console.log(`- workspace: ${data.project_workspace.workspace_path}`);
    console.log(`- mounted: ${data.project_workspace.mounted ? "yes" : "no"}`);
    console.log(`- logs: ${active.logs_path}`);
    console.log(`- projects tracked: ${data.project_workspace.project_count}`);
  } else {
    if (data.workspace_state?.status === "unloaded") {
      const archived = data.workspace_state?.archived_story?.archive_path;
      console.log("- active: none (workspace unloaded)");
      if (archived) console.log(`- last archived story: ${archived}`);
      console.log(`- projects tracked: ${data.project_workspace?.project_count ?? 0}`);
    } else {
      console.log(`- not synced yet; run ${labCommand("project:sync")}`);
    }
  }
  console.log("");

  console.log("Exports:");
  if (data.exports.length) {
    for (const item of data.exports) {
      console.log(`- ${item.file} (${formatBytes(item.size)})`);
    }
  } else {
    console.log(`- none yet; run ${labCommand("export")}`);
  }
  console.log("");

  console.log("Suggested Next:");
  for (const step of data.suggested_next) console.log(`- ${step}`);
}

function parseMarkdownTable(text) {
  const lines = text.split("\n").filter((line) => line.trim().startsWith("|"));
  if (lines.length < 2) return [];

  const headers = splitTableRow(lines[0]).map((header) => normalizeHeader(header));
  return lines
    .slice(2)
    .map(splitTableRow)
    .filter((cells) => cells.length)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseSectionContract(text) {
  const match = text.match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return new Map();

  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2]);
  }
  return fields;
}

function parseContractList(text, field) {
  const contract = parseSectionContract(text);
  const value = contract.get(field) ?? "";
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function runtimePacketStatus(file, contract) {
  const sectionId = safeId(contract.get("id") || path.basename(file, ".md"));
  const dir = normalizeRel(path.join(paths.stateDir, "runtime", sectionId));
  const contextFile = `${dir}/context.json`;

  if (!fs.existsSync(abs(contextFile))) {
    return {
      section_id: sectionId,
      status: "missing",
      path: dir,
      context: contextFile,
      generated_at: null,
      visible_files: null,
      stale_inputs: [],
      output_missing: [],
    };
  }

  let context;
  try {
    context = loadJson(abs(contextFile), null);
  } catch {
    context = null;
  }

  if (!context || typeof context !== "object") {
    return {
      section_id: sectionId,
      status: "invalid",
      path: dir,
      context: contextFile,
      generated_at: null,
      visible_files: null,
      stale_inputs: [],
      output_missing: [contextFile],
    };
  }

  const staleInputs = [];
  for (const [input, expectedHash] of Object.entries(context.input_hashes ?? {})) {
    if (!fs.existsSync(abs(input))) {
      staleInputs.push(`${input} (missing)`);
      continue;
    }

    const actualHash = sha256(read(abs(input)));
    if (actualHash !== expectedHash) staleInputs.push(input);
  }

  if (context.section && context.section !== file) staleInputs.push(`section mismatch: ${context.section}`);

  const outputMissing = ["intent.md", "context.json", "rule-stack.yaml", "criteria.json", "trace.json"]
    .map((name) => `${dir}/${name}`)
    .filter((runtimeFile) => !fs.existsSync(abs(runtimeFile)));

  return {
    section_id: sectionId,
    status: outputMissing.length ? "invalid" : staleInputs.length ? "stale" : "fresh",
    path: dir,
    context: contextFile,
    generated_at: context.generated_at ?? null,
    visible_files: Array.isArray(context.visible_files) ? context.visible_files.length : null,
    stale_inputs: staleInputs,
    output_missing: outputMissing,
  };
}

function runtimeNeedsCompose(draft) {
  return draft.runtime?.status !== "fresh";
}

function stripContract(text) {
  return text.replace(/^\s*<!--[\s\S]*?-->/, "").trim();
}

function wordCount(text) {
  return (text.match(/\b[\w'-]+\b/g) ?? []).length;
}

function readTitle() {
  const workspace = readWorkspaceState();
  if (workspace.status === "unloaded" && workspace.active === false) return "No Active Story Loaded";

  const titleFile = abs("draft/00-title.md");
  if (fs.existsSync(titleFile)) {
    const match = stripContract(read(titleFile)).match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
  }

  const briefFile = abs("brief.md");
  if (fs.existsSync(briefFile)) {
    const match = read(briefFile).match(/^Working title:\s*(.+)$/m);
    if (match) return match[1].trim();
  }

  return path.basename(root);
}

function stripCode(value) {
  return String(value).replace(/^`|`$/g, "").trim();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function labCommand(command, args = "") {
  const suffix = args ? ` ${args}` : "";
  if (discovery.mode === "installed") return `mlab ${command}${suffix}`;
  return args ? `npm run ${command} -- ${args}` : `npm run ${command}`;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(read(file));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  try {
    return read(file)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function safeId(value) {
  const id = String(value).trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "section";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseArgs(args) {
  const parsed = { json: false, help: false };
  for (const arg of args) {
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return parsed;
}

function abs(rel) {
  return paths.projectAbs(rel);
}

function displayPath(file) {
  return paths.projectRel(file);
}

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function isRootMountedTo(workspaceDir) {
  const probe = paths.workspaceAbs("brief.md");
  if (!fs.existsSync(probe)) return false;
  try {
    const stat = fs.lstatSync(probe);
    if (!stat.isSymbolicLink()) return false;
    const real = fs.realpathSync(probe);
    const normalizedWorkspace = fs.realpathSync(workspaceDir);
    return real === path.join(normalizedWorkspace, "brief.md");
  } catch {
    return false;
  }
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function printHelp() {
  console.log(`status - print a quick operator dashboard

Usage:
  mlab status [--json]
`);
}
