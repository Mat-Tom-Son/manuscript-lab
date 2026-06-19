import fs from "node:fs";
import path from "node:path";
import { practiceExerciseById, practiceExerciseIds } from "./practice-exercises.mjs";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_PANEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_FORMAT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const ARTIFACT_KINDS = new Set(["all", "driver", "practice", "practice-eval", "practice-bench", "practice-strategy", "eval", "golden-path"]);

export const DRIVER_EFFECTS = Object.freeze([
  "reads_project",
  "writes_state",
  "writes_draft",
  "writes_exports",
  "calls_model",
  "spends_budget",
  "records_human_decision",
  "touches_workspace",
  "release_action",
]);

const TOOL_DEFS = [
  {
    tool_id: "validate.project",
    public_command: "mlab validate --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {},
    argv: () => ["validate", "--json"],
    json_output: "required",
  },
  {
    tool_id: "status.project",
    public_command: "mlab status --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {},
    argv: () => ["status", "--json"],
    json_output: "required",
  },
  {
    tool_id: "report.project",
    public_command: "mlab report --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {},
    argv: () => ["report", "--json"],
    json_output: "required",
  },
  {
    tool_id: "compose.section",
    public_command: "mlab compose <section> --json",
    effects: ["reads_project", "writes_state"],
    approval: "auto_in_operate",
    args: { section: "project_relative_draft_path" },
    argv: ({ section }) => ["compose", section, "--json"],
    json_output: "required",
    artifact_roots: ({ sectionId }) => [`state/runtime/${sectionId}/`],
  },
  {
    tool_id: "check.static",
    public_command: "mlab check --static-only --json <target>",
    effects: ["reads_project"],
    approval: "auto",
    args: { target: "project_relative_or_scope" },
    argv: ({ target }) => ["check", "--static-only", "--json", target],
    json_output: "required",
  },
  {
    tool_id: "gate.target",
    public_command: "mlab gate <target> --json --write",
    effects: ["reads_project", "writes_state"],
    approval: "auto_in_operate",
    args: { target: "project_relative_or_scope" },
    argv: ({ target }) => ["gate", target, "--json", "--write"],
    json_output: "required",
  },
  {
    tool_id: "claims.list",
    public_command: "mlab claims list --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {},
    argv: () => ["claims", "list", "--json"],
    json_output: "required",
  },
  {
    tool_id: "citations.check",
    public_command: "mlab citations check --json <target>",
    effects: ["reads_project"],
    approval: "auto",
    args: { target: "optional_project_relative_or_scope" },
    argv: ({ target = "" }) => ["citations", "check", "--json", ...(target ? [target] : [])],
    json_output: "required",
  },
  {
    tool_id: "evidence.report",
    public_command: "mlab evidence report --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {},
    argv: () => ["evidence", "report", "--json"],
    json_output: "required",
  },
  {
    tool_id: "review.report",
    public_command: "mlab review report <target>",
    effects: ["reads_project"],
    approval: "auto",
    args: { target: "optional_project_relative_or_scope" },
    argv: ({ target = "" }) => ["review", "report", ...(target ? [target] : [])],
    json_output: "text",
  },
  {
    tool_id: "review.run",
    public_command: "mlab review <target> --panel <panel>",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: { target: "project_relative_or_scope", panel: "panel_id" },
    argv: ({ target, panel }) => ["review", target, "--panel", panel],
    json_output: "text",
  },
  {
    tool_id: "room.diagnose",
    public_command: "mlab room diagnose <target> --json",
    effects: ["reads_project", "writes_state"],
    approval: "auto_in_operate",
    args: { target: "project_relative_draft_path" },
    argv: ({ target }) => ["room", "diagnose", target, "--json"],
    json_output: "required",
  },
  {
    tool_id: "room.blue_sky",
    public_command: "mlab room blue-sky <target> --json",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: { target: "project_relative_draft_path" },
    argv: ({ target }) => ["room", "blue-sky", target, "--json"],
    json_output: "required",
  },
  {
    tool_id: "room.report",
    public_command: "mlab room report <target>",
    effects: ["reads_project"],
    approval: "auto",
    args: { target: "project_relative_draft_path" },
    argv: ({ target }) => ["room", "report", target],
    json_output: "text",
  },
  {
    tool_id: "chorus.run",
    public_command: "mlab chorus run <target> --json",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: { target: "project_relative_draft_path" },
    argv: ({ target }) => ["chorus", "run", target, "--json"],
    json_output: "required",
  },
  {
    tool_id: "chorus.report",
    public_command: "mlab chorus report <target>",
    effects: ["reads_project"],
    approval: "auto",
    args: { target: "project_relative_draft_path" },
    argv: ({ target }) => ["chorus", "report", target],
    json_output: "text",
  },
  {
    tool_id: "merge.preview",
    public_command: "mlab merge <target> --run <run-id> --json",
    effects: ["reads_project"],
    approval: "auto",
    args: { target: "project_relative_draft_path", run_id: "safe_id" },
    argv: ({ target, run_id }) => ["merge", target, "--run", run_id, "--json"],
    json_output: "required",
  },
  {
    tool_id: "merge.apply",
    public_command: "mlab merge <target> --run <run-id> --apply --audit --json",
    effects: ["reads_project", "writes_state", "writes_draft"],
    approval: "ask",
    args: { target: "project_relative_draft_path", run_id: "safe_id" },
    argv: ({ target, run_id }) => ["merge", target, "--run", run_id, "--apply", "--audit", "--json"],
    json_output: "required",
  },
  {
    tool_id: "practice.propose",
    public_command: "mlab practice propose --exercise <exercise> --brief <brief>",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: { exercise: "practice_exercise_id", brief: "optional_prompt_text" },
    argv: ({ exercise, brief = "" }, context) => {
      if (!context.driverModel) throw new Error("practice.propose requires the driver run to set --model.");
      return ["practice", "propose", "--exercise", exercise, "--model", context.driverModel, "--json", ...(brief ? ["--brief", brief] : [])];
    },
    json_output: "required",
  },
  {
    tool_id: "practice.compare",
    public_command: "mlab practice compare --exercise <exercise> --brief <brief>",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: { exercise: "practice_exercise_id", brief: "optional_prompt_text" },
    argv: ({ exercise, brief = "" }, context) => {
      if (!context.driverModel) throw new Error("practice.compare requires the driver run to set --model.");
      return ["practice", "compare", "--exercise", exercise, "--model", context.driverModel, "--json", ...(brief ? ["--brief", brief] : [])];
    },
    json_output: "required",
  },
  {
    tool_id: "practice.bench",
    public_command: "mlab practice bench --exercises <set>",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: {
      exercises: "optional_practice_exercise_set",
      seeds: "optional_small_positive_integer",
      candidates: "optional_small_positive_integer",
      repair_rounds: "optional_small_nonnegative_integer",
    },
    argv: ({ exercises = "core", seeds = 1, candidates = 3, repair_rounds = 1 }, context) => {
      if (!context.driverModel) throw new Error("practice.bench requires the driver run to set --model.");
      return [
        "practice",
        "bench",
        "--exercises",
        exercises,
        "--models",
        context.driverModel,
        "--seeds",
        String(seeds),
        "--candidates",
        String(candidates),
        "--repair-rounds",
        String(repair_rounds),
        "--json",
      ];
    },
    json_output: "required",
  },
  {
    tool_id: "practice.strategies",
    public_command: "mlab practice strategies --exercises <set> --strategies <list>",
    effects: ["reads_project", "writes_state", "calls_model", "spends_budget"],
    approval: "ask",
    args: {
      exercises: "optional_practice_exercise_set",
      strategies: "optional_practice_strategy_set",
      seeds: "optional_small_positive_integer",
    },
    argv: ({ exercises = "core", strategies = "default", seeds = 1 }, context) => {
      if (!context.driverModel) throw new Error("practice.strategies requires the driver run to set --model.");
      return [
        "practice",
        "strategies",
        "--exercises",
        exercises,
        "--models",
        context.driverModel,
        "--strategies",
        strategies,
        "--seeds",
        String(seeds),
        "--json",
      ];
    },
    json_output: "required",
  },
  {
    tool_id: "artifacts.list",
    public_command: "mlab artifacts list --kind <kind> --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {
      kind: "optional_artifact_kind",
      limit: "optional_small_positive_integer",
    },
    argv: ({ kind = "all", limit = 5 }) => ["artifacts", "list", "--kind", kind, "--limit", String(limit), "--json"],
    json_output: "required",
  },
  {
    tool_id: "artifacts.inspect",
    public_command: "mlab artifacts inspect --run <run-id> --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {
      run_id: "safe_id",
      kind: "optional_artifact_kind",
    },
    argv: ({ run_id, kind = "all" }) => ["artifacts", "inspect", "--run", run_id, "--kind", kind, "--json"],
    json_output: "required",
  },
  {
    tool_id: "eval.practice_strategies",
    public_command: "mlab eval practice-strategies --from state/practice-strategies/<run-id> --json",
    effects: ["reads_project", "writes_state"],
    approval: "auto_in_operate",
    args: {
      run_id: "optional_safe_id",
    },
    argv: ({ run_id = "" }) => ["eval", "practice-strategies", ...(run_id ? ["--from", `state/practice-strategies/${run_id}`] : []), "--json"],
    json_output: "required",
  },
  {
    tool_id: "golden_path.guide",
    public_command: "mlab golden-path --json",
    effects: ["reads_project"],
    approval: "auto",
    args: {
      target: "optional_project_relative_draft_path",
    },
    argv: ({ target = "" }) => ["golden-path", ...(target ? ["--target", target] : []), "--json"],
    json_output: "required",
  },
  {
    tool_id: "export.reader",
    public_command: "mlab export --formats <formats> --json",
    effects: ["reads_project", "writes_exports"],
    approval: "ask",
    args: { formats: "format_list" },
    argv: ({ formats }) => ["export", "--formats", formats.join(","), "--json"],
    json_output: "required",
  },
  {
    tool_id: "done.no_export",
    public_command: "mlab done:no-export --json",
    effects: ["reads_project", "writes_state", "touches_workspace"],
    approval: "ask",
    args: {},
    argv: () => ["done:no-export", "--json"],
    json_output: "required",
  },
  {
    tool_id: "done.export",
    public_command: "mlab done --json",
    effects: ["reads_project", "writes_state", "writes_exports", "touches_workspace"],
    approval: "ask",
    args: {},
    argv: () => ["done", "--json"],
    json_output: "required",
  },
];

const TOOL_MAP = new Map(TOOL_DEFS.map((tool) => [tool.tool_id, tool]));

export function listDriverTools() {
  return TOOL_DEFS.map(publicTool);
}

export function driverToolById(toolId) {
  return TOOL_MAP.get(toolId) ?? null;
}

export function validateDriverCatalog() {
  const errors = [];
  const seen = new Set();
  for (const tool of TOOL_DEFS) {
    if (seen.has(tool.tool_id)) errors.push(`Duplicate driver tool id: ${tool.tool_id}`);
    seen.add(tool.tool_id);
    for (const effect of tool.effects ?? []) {
      if (!DRIVER_EFFECTS.includes(effect)) errors.push(`${tool.tool_id}: unknown effect ${effect}`);
    }
    if (typeof tool.argv !== "function") errors.push(`${tool.tool_id}: missing argv builder`);
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeDriverDecision(decision, context) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return { ok: false, errors: ["Decision must be a JSON object."] };
  }

  const action = String(decision.action ?? "").trim();
  if (!["run_tool", "ask_user", "update_plan", "summarize", "stop"].includes(action)) {
    return { ok: false, errors: [`Unsupported decision action: ${action || "(missing)"}`] };
  }
  if (action !== "run_tool") {
    return {
      ok: true,
      decision: {
        schema_version: decision.schema_version ?? "manuscript-lab.driver-decision.v1",
        action,
        message: String(decision.message ?? decision.summary ?? ""),
        rationale: String(decision.rationale ?? ""),
      },
    };
  }

  const toolId = String(decision.tool_id ?? "").trim();
  const tool = driverToolById(toolId);
  if (!tool) return { ok: false, errors: [`Unknown driver tool id: ${toolId || "(missing)"}`] };

  const normalizedArgs = normalizeToolArgs(tool, decision.args ?? {}, context);
  if (!normalizedArgs.ok) return { ok: false, errors: normalizedArgs.errors.map((error) => `${toolId}: ${error}`) };

  return {
    ok: true,
    decision: {
      schema_version: decision.schema_version ?? "manuscript-lab.driver-decision.v1",
      action: "run_tool",
      tool_id: toolId,
      args: normalizedArgs.args,
      rationale: String(decision.rationale ?? ""),
      expected_result: String(decision.expected_result ?? ""),
      approval: decision.approval && typeof decision.approval === "object" ? decision.approval : { required: false, reason: "" },
      stop_condition: String(decision.stop_condition ?? "continue_after_success"),
    },
    tool: publicTool(tool),
  };
}

export function buildDriverToolCommand(toolId, args, context) {
  const tool = driverToolById(toolId);
  if (!tool) throw new Error(`Unknown driver tool id: ${toolId}`);
  const normalized = normalizeToolArgs(tool, args ?? {}, context);
  if (!normalized.ok) throw new Error(normalized.errors.join("; "));
  const argv = tool.argv(normalized.args, context);
  const wrapper = path.join(context.discovery.packageRoot, "bin", "manuscript-lab.mjs");
  return {
    executable: process.execPath,
    args: [wrapper, ...argv],
    wrapper,
    argv,
    display: ["mlab", ...argv].map(shellToken).join(" "),
    effects: [...tool.effects],
    approval: tool.approval,
    json_output: tool.json_output,
  };
}

export function approvalRequired(tool, { mode = "advise", approve = "ask" } = {}) {
  const effects = tool.effects ?? [];
  if (effects.some((effect) => ["writes_draft", "writes_exports", "records_human_decision", "touches_workspace", "release_action"].includes(effect))) {
    return true;
  }
  if (effects.includes("calls_model") || effects.includes("spends_budget")) return true;
  if (approve === "always-safe") return false;
  if (mode === "operate" && onlySafeGeneratedState(effects)) return false;
  if (mode === "ci" && onlySafeGeneratedState(effects)) return false;
  return effects.includes("writes_state");
}

export function publicTool(tool) {
  return {
    tool_id: tool.tool_id,
    public_command: tool.public_command,
    effects: [...tool.effects],
    approval: tool.approval,
    args: { ...(tool.args ?? {}) },
    json_output: tool.json_output,
  };
}

function onlySafeGeneratedState(effects) {
  return effects.every((effect) => effect === "reads_project" || effect === "writes_state");
}

function normalizeToolArgs(tool, rawArgs, context) {
  const args = {};
  const errors = [];
  const schema = tool.args ?? {};
  const incoming = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};

  for (const [name, kind] of Object.entries(schema)) {
    const fallback = name === "section" && incoming.target !== undefined ? incoming.target : undefined;
    const value = incoming[name] ?? fallback;
    if (kind.startsWith("optional_") && (value === undefined || value === "")) continue;
    if (value === undefined || value === "") {
      errors.push(`Missing required argument: ${name}`);
      continue;
    }

    const normalized = normalizeArgValue(kind, value, context);
    if (!normalized.ok) {
      errors.push(`${name}: ${normalized.error}`);
    } else {
      args[name] = normalized.value;
    }
  }

  for (const key of Object.keys(incoming)) {
    if (key === "target" && "section" in schema) continue;
    if (!(key in schema)) errors.push(`Unknown argument: ${key}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, args };
}

function normalizeArgValue(kind, value, context) {
  const baseKind = kind.startsWith("optional_") ? kind.slice("optional_".length) : kind;
  if (baseKind === "project_relative_draft_path") return normalizeDraftPath(value, context);
  if (baseKind === "project_relative_or_scope") return normalizeTarget(value, context);
  if (baseKind === "safe_id") return normalizeSafeId(value);
  if (baseKind === "practice_exercise_id") return normalizePracticeExerciseId(value);
  if (baseKind === "practice_exercise_set") return normalizePracticeExerciseSet(value);
  if (baseKind === "practice_strategy_set") return normalizePracticeStrategySet(value);
  if (baseKind === "artifact_kind") return normalizeArtifactKind(value);
  if (baseKind === "prompt_text") return normalizePromptText(value);
  if (baseKind === "panel_id") return normalizePanelId(value);
  if (baseKind === "format_list") return normalizeFormatList(value);
  if (baseKind === "small_positive_integer") return normalizeBoundedInteger(value, { min: 1, max: 5 });
  if (baseKind === "small_nonnegative_integer") return normalizeBoundedInteger(value, { min: 0, max: 3 });
  return { ok: false, error: `Unsupported argument kind: ${kind}` };
}

function normalizeDraftPath(value, context) {
  const rel = normalizeProjectRelativePath(value);
  if (!rel.ok) return rel;
  const draftDir = draftGlobDir(context.discovery.config?.draftGlob ?? "draft/*.md");
  if (draftDir && !(rel.value === draftDir || rel.value.startsWith(`${draftDir}/`))) {
    return { ok: false, error: `must be under configured draft directory: ${draftDir}/` };
  }
  if (!rel.value.endsWith(".md")) return { ok: false, error: "must be a Markdown draft file" };
  return assertInsideManuscript(rel.value, context);
}

function normalizeTarget(value, context) {
  const raw = String(value ?? "").trim();
  if (["manuscript", "citation", "citations", "export"].includes(raw)) return { ok: true, value: raw };
  const rel = normalizeProjectRelativePath(raw);
  if (!rel.ok) return rel;
  return assertInsideManuscript(rel.value, context);
}

function normalizeProjectRelativePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, error: "must not be empty" };
  if (/^[A-Za-z]:($|[\\/])/.test(raw)) return { ok: false, error: "Windows drive paths are not allowed" };
  if (raw.startsWith("\\\\") || raw.startsWith("//")) return { ok: false, error: "UNC paths are not allowed" };
  if (raw.includes("\\")) return { ok: false, error: "use forward slashes, not backslashes" };
  if (path.isAbsolute(raw) || path.posix.isAbsolute(raw)) return { ok: false, error: "absolute paths are not allowed" };
  if (raw.split("/").some((part) => part === "..")) return { ok: false, error: "path must not contain .. traversal" };
  const normalized = raw.split("/").filter(Boolean).join("/");
  const posix = path.posix.normalize(normalized);
  if (posix === "." || posix === ".." || posix.startsWith("../") || posix.includes("/../")) {
    return { ok: false, error: "path must not escape the manuscript root" };
  }
  return { ok: true, value: posix };
}

function assertInsideManuscript(rel, context) {
  const manuscriptRoot = fs.existsSync(context.discovery.manuscriptRoot)
    ? fs.realpathSync(context.discovery.manuscriptRoot)
    : path.resolve(context.discovery.manuscriptRoot);
  const full = path.resolve(manuscriptRoot, rel);
  let checked = full;
  try {
    checked = fs.existsSync(full) ? fs.realpathSync(full) : path.resolve(fs.realpathSync(existingParent(full)), path.basename(full));
  } catch {
    checked = full;
  }
  if (!isInsideOrEqual(checked, manuscriptRoot)) return { ok: false, error: "resolved path is outside the manuscript root" };
  return { ok: true, value: rel };
}

function existingParent(file) {
  let current = path.dirname(file);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) return current;
    current = path.dirname(current);
  }
  return current;
}

function isInsideOrEqual(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeSafeId(value) {
  const text = String(value ?? "").trim();
  if (!SAFE_ID_PATTERN.test(text)) return { ok: false, error: "must be a safe identifier" };
  return { ok: true, value: text };
}

function normalizePracticeExerciseId(value) {
  const normalized = normalizeSafeId(value);
  if (!normalized.ok) return normalized;
  if (!practiceExerciseById(normalized.value)) {
    return { ok: false, error: `unknown practice exercise; available: ${practiceExerciseIds().join(", ")}` };
  }
  return normalized;
}

function normalizePracticeExerciseSet(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return { ok: false, error: "must not be empty" };
  if (["core", "expanded", "all"].includes(text)) return { ok: true, value: text };
  const ids = text.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!ids.length) return { ok: false, error: "must include at least one exercise id" };
  if (ids.length > 10) return { ok: false, error: "must include 10 exercise ids or fewer" };
  const bad = ids.find((id) => !SAFE_ID_PATTERN.test(id) || !practiceExerciseById(id));
  if (bad) return { ok: false, error: `unknown practice exercise; available: core, expanded, all, or ${practiceExerciseIds().join(", ")}` };
  return { ok: true, value: ids.join(",") };
}

function normalizePracticeStrategySet(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return { ok: false, error: "must not be empty" };
  if (["default", "all"].includes(text)) return { ok: true, value: text };
  const allowed = new Set(["single", "select", "revise", "repair"]);
  const ids = text.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!ids.length) return { ok: false, error: "must include at least one strategy id" };
  if (ids.length > allowed.size) return { ok: false, error: "must include 4 strategy ids or fewer" };
  const bad = ids.find((id) => !SAFE_ID_PATTERN.test(id) || !allowed.has(id));
  if (bad) return { ok: false, error: "unknown practice strategy; available: default, all, single, select, revise, repair" };
  return { ok: true, value: ids.join(",") };
}

function normalizeArtifactKind(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return { ok: false, error: "must not be empty" };
  if (!ARTIFACT_KINDS.has(text)) {
    return { ok: false, error: `unknown artifact kind; available: ${[...ARTIFACT_KINDS].join(", ")}` };
  }
  return { ok: true, value: text };
}

function normalizeBoundedInteger(value, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return { ok: false, error: `must be an integer from ${min} to ${max}` };
  }
  return { ok: true, value: number };
}

function normalizePromptText(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: "must not be empty" };
  if (text.length > 2000) return { ok: false, error: "must be 2000 characters or fewer" };
  if (text.includes("\0")) return { ok: false, error: "must not contain NUL bytes" };
  return { ok: true, value: text };
}

function normalizePanelId(value) {
  const text = String(value ?? "").trim();
  if (!SAFE_PANEL_PATTERN.test(text)) return { ok: false, error: "must be a safe panel id" };
  return { ok: true, value: text };
}

function normalizeFormatList(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const formats = list.map((item) => String(item).trim()).filter(Boolean);
  if (!formats.length) return { ok: false, error: "must include at least one format" };
  const bad = formats.find((format) => !SAFE_FORMAT_PATTERN.test(format));
  if (bad) return { ok: false, error: `invalid export format: ${bad}` };
  return { ok: true, value: formats };
}

function draftGlobDir(glob) {
  const normalized = String(glob || "draft/*.md").replace(/\\/g, "/");
  const wildcard = normalized.search(/[*?[\]{}]/);
  const beforeWildcard = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
  const dir = beforeWildcard.endsWith("/") ? beforeWildcard.slice(0, -1) : path.posix.dirname(beforeWildcard);
  return dir === "." ? "" : dir;
}

function shellToken(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=,-]+$/.test(text) ? text : JSON.stringify(text);
}
