import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isShortFormDraftContract,
  minimumWordsForStartedSection,
  normalizeRel,
  parseContractList,
  parseMarkdownTable,
  parseSectionContract,
  sectionIdForFile,
  stripCode,
  stripContract,
  validateSectionContract,
  wordCount,
} from "./section-contract.mjs";
import { loadReviewRegistry } from "./review-registry.mjs";

export const CONFIG_FILE = "manuscript-lab.config.json";

const REQUIRED_CONFIG_FIELDS = ["schemaVersion", "profile", "root", "draftGlob", "stateDir", "exportsDir"];
const OPTIONAL_CONFIG_FIELDS = new Set([
  ...REQUIRED_CONFIG_FIELDS,
  "profileOptions",
  "sourcesDir",
  "tasteDir",
  "checks",
  "reviews",
  "model",
  "gates",
]);
const BUILT_IN_PROFILE_OPTIONS = new Map([
  ["generic", new Set()],
  ["whitepaper", new Set(["title", "sections", "kind", "targetWords"])],
  ["document", new Set(["title", "sections", "kind", "targetWords"])],
]);

export function discoverProtocol(options = {}) {
  const packageRoot = path.resolve(options.packageRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const start = path.resolve(options.workspace ?? process.env.MLAB_WORKSPACE ?? options.cwd ?? process.cwd());
  const explicitConfig = options.configPath ?? process.env.MLAB_CONFIG ?? "";
  const configPath = explicitConfig ? path.resolve(start, explicitConfig) : findUpward(start, CONFIG_FILE);

  if (configPath) {
    const configDir = path.dirname(configPath);
    let config = null;
    try {
      config = readJson(configPath);
    } catch (error) {
      return {
        mode: "installed",
        packageRoot,
        workspaceRoot: configDir,
        manuscriptRoot: configDir,
        configPath,
        config: null,
        errors: [`Config file is not valid JSON: ${displayPath(configPath, configDir)} (${error.message})`],
        warnings: [],
        hints: ["Fix manuscript-lab.config.json, then rerun `mlab validate`."],
      };
    }
    const configValidation = validateProtocolConfig(config, { configDir });
    const manuscriptRoot = configValidation.projectRoot ?? configDir;
    return {
      mode: "installed",
      packageRoot,
      workspaceRoot: configDir,
      manuscriptRoot,
      configPath,
      config,
      errors: configValidation.errors,
      warnings: configValidation.warnings,
      hints: [],
    };
  }

  const templateRoot = findTemplateRoot(start);
  if (templateRoot) {
    const activeWorkspace = activeTemplateWorkspace(templateRoot);
    const manuscriptRoot = activeWorkspace && fs.existsSync(activeWorkspace) ? activeWorkspace : templateRoot;
    return {
      mode: "template",
      packageRoot: templateRoot,
      workspaceRoot: templateRoot,
      manuscriptRoot,
      configPath: null,
      config: {
        schemaVersion: 1,
        profile: "generic",
        root: normalizeRel(path.relative(templateRoot, manuscriptRoot)) || ".",
        draftGlob: "draft/*.md",
        stateDir: "state",
        exportsDir: "exports",
        sourcesDir: "sources",
        tasteDir: "taste",
        profileOptions: {},
      },
      errors: [],
      warnings: ["No manuscript-lab.config.json found; using template-first compatibility mode."],
      hints: [],
    };
  }

  return {
    mode: "none",
    packageRoot,
    workspaceRoot: start,
    manuscriptRoot: start,
    configPath: null,
    config: null,
    errors: [`No Manuscript Lab project found from ${start}.`],
    warnings: [],
    hints: projectFreeHints(),
  };
}

export function validateProtocolProject(discovery) {
  const errors = [...(discovery.errors ?? [])];
  const warnings = [...(discovery.warnings ?? [])];
  if (!discovery.config) return { ok: false, errors, warnings, drafts: [] };
  if (errors.length) return { ok: false, errors, warnings, drafts: [] };

  const projectRoot = discovery.manuscriptRoot;
  if (!fs.existsSync(projectRoot)) {
    errors.push(`Project root does not exist: ${displayPath(projectRoot, discovery.workspaceRoot)}`);
    return { ok: false, errors, warnings, drafts: [] };
  }

  for (const file of ["brief.md", "outline.md", "style.md"]) {
    if (!fs.existsSync(path.join(projectRoot, file))) errors.push(`Missing required project file: ${file}`);
  }

  const draftDir = firstGlobDir(discovery.config.draftGlob);
  if (!fs.existsSync(path.join(projectRoot, draftDir))) {
    errors.push(`Missing required draft directory: ${draftDir}`);
  }

  for (const file of ["PROJECT.md", "sources/index.md", "state/status.md", "state/claims.md", "state/open-questions.md"]) {
    if (!fs.existsSync(path.join(projectRoot, file))) warnings.push(`Recommended project file is missing: ${file}`);
  }

  for (const dir of [discovery.config.stateDir, discovery.config.exportsDir]) {
    if (dir && !fs.existsSync(path.join(projectRoot, dir))) warnings.push(`Recommended project directory is missing: ${dir}`);
  }

  const knownCheckIds = loadKnownCheckIds(discovery.packageRoot);
  const reviewRegistry = loadReviewRegistry(discovery);
  errors.push(...reviewRegistry.errors);
  warnings.push(...reviewRegistry.warnings);
  const knownReviewIds = reviewRegistry.knownReviewIds;
  const statusByFile = loadStatusByFile(path.join(projectRoot, discovery.config.stateDir ?? "state", "status.md"));
  const drafts = listDrafts(discovery);

  for (const draft of drafts) {
    const text = fs.readFileSync(draft.fullPath, "utf8");
    const validation = validateSectionContract({
      text,
      file: draft.path,
      knownCheckIds,
      knownReviewIds,
    });
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);

    const contract = validation.contract;
    if (!contract) continue;

    const status = contract.get("status") ?? "";
    const tableStatus = statusByFile.get(normalizeRel(draft.path));
    if (tableStatus && status && tableStatus !== status) {
      errors.push(`${draft.path}: section contract status "${status}" does not match state/status.md "${tableStatus}"`);
    }

    const proseWords = wordCount(stripContract(text));
    const targetWords = Number(contract.get("target_words"));
    if (!isShortFormDraftContract(contract) && status !== "todo" && proseWords < minimumWordsForStartedSection(targetWords)) {
      warnings.push(`${draft.path}: section is marked ${status} but has only ${proseWords} prose words (readiness is enforced by the words.floor gate)`);
    }

    drafts[drafts.indexOf(draft)] = {
      ...draft,
      sectionId: sectionIdForFile(draft.path, contract),
      status,
      wordCount: proseWords,
      checks: parseContractList(text, "checks"),
      reviews: parseContractList(text, "reviews"),
    };
  }

  return { ok: errors.length === 0, errors, warnings, drafts };
}

export function validateProtocolConfig(config, { configDir }) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(config)) {
    return { errors: ["Config root must be a JSON object."], warnings, projectRoot: null };
  }

  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (!(field in config)) errors.push(`Config missing required field: ${field}`);
  }

  if ("schemaVersion" in config) {
    if (!Number.isInteger(config.schemaVersion)) {
      errors.push("Config schemaVersion must be integer 1.");
    } else if (config.schemaVersion !== 1) {
      errors.push(`Unsupported schemaVersion "${config.schemaVersion}". Expected 1.`);
    }
  }

  if ("profile" in config) {
    if (typeof config.profile !== "string" || !config.profile.trim()) {
      errors.push("Config profile must be a non-empty string.");
    }
  }

  for (const key of Object.keys(config)) {
    if (!OPTIONAL_CONFIG_FIELDS.has(key)) warnings.push(`Unknown config field ignored in v0.x: ${key}`);
  }

  let projectRoot = null;
  if (typeof config.root === "string") {
    const rootCheck = validatePortableRelativePath(config.root, { allowDot: true });
    if (rootCheck) {
      errors.push(`Config root is invalid: ${rootCheck}`);
    } else {
      projectRoot = path.resolve(configDir, config.root);
      if (!isPathInsideOrEqual(projectRoot, configDir)) errors.push("Config root must not escape the config directory.");
    }
  } else if ("root" in config) {
    errors.push("Config root must be a string.");
  }

  for (const field of ["draftGlob", "stateDir", "exportsDir", "sourcesDir", "tasteDir"]) {
    if (!(field in config)) continue;
    if (typeof config[field] !== "string") {
      errors.push(`Config ${field} must be a string.`);
      continue;
    }
    const message = validatePortableRelativePath(config[field], { allowGlob: field === "draftGlob", allowDot: field !== "draftGlob" });
    if (message) errors.push(`Config ${field} is invalid: ${message}`);
  }

  if ("profileOptions" in config) {
    if (!isPlainObject(config.profileOptions)) {
      errors.push("Config profileOptions must be an object when present.");
    } else if (typeof config.profile === "string") {
      const declaredOptions = BUILT_IN_PROFILE_OPTIONS.get(config.profile);
      if (declaredOptions) {
        for (const key of Object.keys(config.profileOptions)) {
          if (!declaredOptions.has(key)) warnings.push(`Unknown profileOptions field for profile "${config.profile}" ignored in v0.x: ${key}`);
        }
      }
    }
  }

  for (const field of ["checks", "reviews", "model", "gates"]) {
    if (field in config && !isPlainObject(config[field])) {
      errors.push(`Config ${field} must be an object when present.`);
    }
  }

  if (isPlainObject(config.reviews)) {
    const knownReviewFields = new Set(["default", "suite"]);
    for (const key of Object.keys(config.reviews)) {
      if (!knownReviewFields.has(key)) warnings.push(`Unknown config reviews field ignored: ${key}`);
    }

    if ("default" in config.reviews) {
      if (!Array.isArray(config.reviews.default)) {
        errors.push("Config reviews.default must be an array when present.");
      } else {
        for (const id of config.reviews.default) {
          if (typeof id !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(id)) {
            errors.push("Config reviews.default must contain only stable review IDs.");
            break;
          }
        }
      }
    }

    if ("suite" in config.reviews) {
      if (typeof config.reviews.suite !== "string") {
        errors.push("Config reviews.suite must be a project-relative string path.");
      } else {
        const message = validatePortableRelativePath(config.reviews.suite);
        if (message) errors.push(`Config reviews.suite is invalid: ${message}`);
      }
    }
  }

  if (isPlainObject(config.gates)) {
    validateGatesConfig(config.gates, errors, warnings);
  }

  return { errors, warnings, projectRoot };
}

function validateGatesConfig(gates, errors, warnings) {
  const knownGateFields = new Set(["section", "reviews", "profiles"]);
  for (const key of Object.keys(gates)) {
    if (!knownGateFields.has(key)) warnings.push(`Unknown config gates field ignored: ${key}`);
  }

  if ("section" in gates && !isPlainObject(gates.section)) {
    errors.push("Config gates.section must be an object when present.");
  }
  if (isPlainObject(gates.section) && "words_floor_ratio" in gates.section) {
    const ratio = Number(gates.section.words_floor_ratio);
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      errors.push("Config gates.section.words_floor_ratio must be a number greater than 0 and at most 1.");
    }
  }

  if ("reviews" in gates) validateReviewGatePolicy(gates.reviews, "Config gates.reviews", errors, warnings);
  if ("profiles" in gates) {
    if (!isPlainObject(gates.profiles)) {
      errors.push("Config gates.profiles must be an object when present.");
    } else {
      for (const [profile, policy] of Object.entries(gates.profiles)) {
        const label = `Config gates.profiles.${profile}`;
        if (!isPlainObject(policy)) {
          errors.push(`${label} must be an object.`);
          continue;
        }
        for (const key of Object.keys(policy)) {
          if (key !== "reviews") warnings.push(`Unknown ${label} field ignored: ${key}`);
        }
        if ("reviews" in policy) validateReviewGatePolicy(policy.reviews, `${label}.reviews`, errors, warnings);
      }
    }
  }
}

function validateReviewGatePolicy(policy, label, errors, warnings) {
  if (!isPlainObject(policy)) {
    errors.push(`${label} must be an object when present.`);
    return;
  }
  const known = new Set(["declared_have_run", "declared_fresh"]);
  for (const [key, value] of Object.entries(policy)) {
    if (!known.has(key)) {
      warnings.push(`Unknown ${label} field ignored: ${key}`);
      continue;
    }
    if (!["off", "warn", "block"].includes(value)) {
      errors.push(`${label}.${key} must be one of: off, warn, block.`);
    }
  }
}

export function listDrafts(discovery) {
  const glob = discovery.config?.draftGlob ?? "draft/*.md";
  const projectRoot = discovery.manuscriptRoot;
  const dir = firstGlobDir(glob);
  const base = path.join(projectRoot, dir);
  if (!fs.existsSync(base)) return [];

  const extension = glob.endsWith(".md") ? ".md" : "";
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !extension || entry.name.endsWith(extension))
    .filter((entry) => !entry.name.startsWith("_") && entry.name.toLowerCase() !== "readme.md")
    .map((entry) => {
      const rel = normalizeRel(path.join(dir, entry.name));
      return { path: rel, fullPath: path.join(base, entry.name) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function loadKnownCheckIds(packageRoot) {
  const suite = safeReadJson(path.join(packageRoot, "checks/suite.json"), { model_checks: [] });
  return new Set((suite.model_checks ?? []).map((check) => check.id).filter(Boolean));
}

export function loadKnownReviewIds(discoveryOrPackageRoot) {
  if (typeof discoveryOrPackageRoot === "string") {
    const suite = safeReadJson(path.join(discoveryOrPackageRoot, "reviews/suite.json"), { passes: [] });
    return new Set((suite.passes ?? []).map((review) => review.id).filter(Boolean));
  }
  return loadReviewRegistry(discoveryOrPackageRoot).knownReviewIds;
}

export function loadStatusByFile(statusFile) {
  const statusByFile = new Map();
  if (!fs.existsSync(statusFile)) return statusByFile;
  for (const row of parseMarkdownTable(fs.readFileSync(statusFile, "utf8"))) {
    const file = normalizeRel(stripCode(row.file ?? ""));
    const status = String(row.status ?? "").toLowerCase();
    if (file && status) statusByFile.set(file, status);
  }
  return statusByFile;
}

export function projectPath(discovery, rel) {
  return path.join(discovery.manuscriptRoot, rel);
}

export function protocolPaths(discovery, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const stateDir = discovery.config?.stateDir ?? "state";
  const exportsDir = discovery.config?.exportsDir ?? "exports";

  const projectAbs = (rel = "") => resolveUnder(discovery.manuscriptRoot, rel);
  const packageAbs = (rel = "") => resolveUnder(discovery.packageRoot, rel);
  const workspaceAbs = (rel = "") => resolveUnder(discovery.workspaceRoot, rel);
  const stateAbs = (rel = "") => projectAbs(path.join(stateDir, rel));
  const exportsAbs = (rel = "") => projectAbs(path.join(exportsDir, rel));
  const projectRel = (file) => displayPath(path.resolve(file), discovery.manuscriptRoot);

  return {
    cwd,
    stateDir,
    exportsDir,
    projectAbs,
    packageAbs,
    workspaceAbs,
    stateAbs,
    exportsAbs,
    projectRel,
    resolveProjectInput(input) {
      if (path.isAbsolute(input)) return path.resolve(input);
      const projectCandidate = projectAbs(input);
      if (fs.existsSync(projectCandidate)) return projectCandidate;

      const cwdCandidate = path.resolve(cwd, input);
      if (isPathInsideOrEqual(cwdCandidate, discovery.manuscriptRoot)) return cwdCandidate;
      return projectCandidate;
    },
    resolveProjectInputOrCwd(input) {
      if (path.isAbsolute(input)) return path.resolve(input);
      const projectCandidate = projectAbs(input);
      if (fs.existsSync(projectCandidate)) return projectCandidate;

      const cwdCandidate = path.resolve(cwd, input);
      if (fs.existsSync(cwdCandidate)) return cwdCandidate;
      if (isPathInsideOrEqual(cwdCandidate, discovery.manuscriptRoot)) return cwdCandidate;
      return projectCandidate;
    },
    resolveProjectOutput(input) {
      return path.isAbsolute(input) ? path.resolve(input) : projectAbs(input);
    },
  };
}

export function displayPath(file, base = process.cwd()) {
  const rel = path.relative(base, file);
  return normalizeRel(rel && !rel.startsWith("..") ? rel : file);
}

export function safeReadJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function validatePortableRelativePath(value, { allowGlob = false, allowDot = false } = {}) {
  if (!value || typeof value !== "string") return "must be a non-empty relative path";
  if (allowDot && value === ".") return "";
  if (/^[A-Za-z]:($|[\\/])/.test(value)) return "Windows drive paths are not portable";
  if (value.startsWith("\\\\") || value.startsWith("//")) return "UNC paths are not portable";
  if (value.includes("\\")) return "use forward slashes, not backslashes";
  if (path.isAbsolute(value) || path.posix.isAbsolute(value)) return "absolute paths are not portable";
  const normalized = normalizeRel(path.posix.normalize(value));
  if (!allowGlob && normalized.includes("*")) return "globs are not allowed here";
  if (!allowGlob && /[*?[\]{}]/.test(normalized)) return "wildcards are not allowed here";
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return "path must not escape the project root";
  return "";
}

function projectFreeHints() {
  return [
    "Run `mlab init` to create a config-first project here (defaults: --profile whitepaper --root manuscript).",
    "Customize the scaffold with `mlab init --profile whitepaper --root manuscript --title \"My Project\"`.",
    "Run `mlab doctor --no-project` for package diagnostics without a project.",
  ];
}

function findUpward(start, name) {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function findTemplateRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "scripts/doccheck.mjs")) &&
      fs.existsSync(path.join(current, "checks/suite.json")) &&
      fs.existsSync(path.join(current, "reviews/suite.json"))
    ) {
      const pkg = safeReadJson(path.join(current, "package.json"), {});
      if (pkg.name === "manuscript-lab") return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function activeTemplateWorkspace(templateRoot) {
  const registry = safeReadJson(path.join(templateRoot, "projects/registry.json"), { active: null, projects: {} });
  const active = registry.active;
  if (!active?.slug && !active?.workspace_path) return "";
  const project = active.slug ? registry.projects?.[active.slug] ?? null : null;
  const workspacePath = active.workspace_path || project?.workspace_path || "";
  return workspacePath ? path.resolve(templateRoot, workspacePath) : "";
}

function firstGlobDir(glob) {
  const normalized = normalizeRel(glob || "draft/*.md");
  const wildcard = normalized.search(/[*?[\]{}]/);
  const beforeWildcard = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
  const dir = beforeWildcard.endsWith("/") ? beforeWildcard.slice(0, -1) : path.posix.dirname(beforeWildcard);
  return dir === "." ? "" : dir;
}

function isPathInsideOrEqual(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveUnder(base, rel) {
  return path.isAbsolute(String(rel)) ? path.resolve(String(rel)) : path.resolve(base, String(rel));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
