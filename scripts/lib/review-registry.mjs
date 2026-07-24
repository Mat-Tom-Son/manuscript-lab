import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REVIEW_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const SUPPORTED_OUTPUT_SCHEMAS = new Set(["review_issues_v1", "pattern_saturation_v1"]);

export function loadReviewRegistry(discovery) {
  const errors = [];
  const warnings = [];
  const sources = [];
  const packageSuitePath = path.join(discovery.packageRoot, "reviews/suite.json");
  const packageSource = loadSuiteSource({
    file: packageSuitePath,
    root: discovery.packageRoot,
    label: "package reviews/suite.json",
    origin: "built-in",
    required: true,
    errors,
  });
  if (packageSource) sources.push(packageSource);

  const projectSuiteRel = projectSuitePath(discovery.config);
  if (projectSuiteRel) {
    const localSource = loadSuiteSource({
      file: path.resolve(discovery.manuscriptRoot, projectSuiteRel),
      root: discovery.manuscriptRoot,
      label: `project ${projectSuiteRel}`,
      origin: "project",
      required: true,
      errors,
      declaredPath: projectSuiteRel,
    });
    if (localSource) sources.push(localSource);
  }

  const contextPacks = {};
  const contextPackMeta = new Map();
  const passes = [];
  const passById = new Map();
  const passMeta = new Map();
  const inputFiles = new Set();
  if (packageSource) inputFiles.add(packageSource.file);

  for (const source of sources) {
    inputFiles.add(source.file);
    validateSuiteShape(source, errors);

    const sourceContextPacks = isPlainObject(source.suite.context_packs) ? source.suite.context_packs : {};
    for (const [id, pack] of Object.entries(sourceContextPacks)) {
      const label = `${source.label}: context_packs.${id}`;
      validateId(id, `${label} ID`, errors);
      validateContextPack(pack, label, errors, discovery.manuscriptRoot);
      if (contextPackMeta.has(id)) {
        const existing = contextPackMeta.get(id);
        errors.push(`${label} duplicates ${existing.origin} context pack ID "${id}"`);
        continue;
      }
      contextPacks[id] = pack;
      contextPackMeta.set(id, { origin: source.origin, source: source.label });
    }

    const sourcePasses = Array.isArray(source.suite.passes) ? source.suite.passes : [];
    for (const [index, pass] of sourcePasses.entries()) {
      const fallbackLabel = `${source.label}: passes[${index}]`;
      if (!isPlainObject(pass)) {
        errors.push(`${fallbackLabel} must be an object`);
        continue;
      }

      const id = pass.id;
      const label = typeof id === "string" && id ? `${source.label}: ${id}` : fallbackLabel;
      validateReviewPass(pass, { label, source, errors });
      if (typeof id !== "string" || !id) continue;
      if (passById.has(id)) {
        const existing = passMeta.get(id);
        errors.push(`${label} duplicates ${existing.origin} review pass ID "${id}"`);
        continue;
      }

      passes.push(pass);
      passById.set(id, pass);
      const promptPath = resolveOwnedFile(source.root, pass.prompt, {
        label: `${label}.prompt`,
        errors,
      });
      if (promptPath) inputFiles.add(promptPath);
      passMeta.set(id, {
        origin: source.origin,
        source: source.label,
        suite_path: source.file,
        prompt_path: promptPath,
      });
    }
  }

  for (const pass of passes) {
    if (typeof pass.context_pack === "string" && !contextPackMeta.has(pass.context_pack)) {
      const meta = passMeta.get(pass.id);
      errors.push(`${meta.source}: ${pass.id}.context_pack references unknown context pack "${pass.context_pack}"`);
    }
  }

  const configuredDefaults = Array.isArray(discovery.config?.reviews?.default) ? discovery.config.reviews.default : [];
  const unknownDefaults = configuredDefaults.filter((id) => !passById.has(id));
  if (unknownDefaults.length) {
    errors.push(`Config reviews.default references unknown review pass IDs: ${unknownDefaults.join(", ")}`);
  }

  const packageSuite = packageSource?.suite ?? {};
  const suite = {
    version: 1,
    output_schema: packageSuite.output_schema ?? "review_issues_v1",
    default_models: Array.isArray(packageSuite.default_models) ? packageSuite.default_models : [],
    context_packs: contextPacks,
    passes,
  };

  return {
    suite,
    passes,
    passById,
    contextPacks,
    knownReviewIds: new Set(passById.keys()),
    errors,
    warnings,
    inputFiles: Array.from(inputFiles).sort(),
    projectSuitePath: projectSuiteRel ? path.resolve(discovery.manuscriptRoot, projectSuiteRel) : null,
    originForPass(id) {
      return passMeta.get(id)?.origin ?? null;
    },
    metaForPass(id) {
      return passMeta.get(id) ?? null;
    },
    promptPathForPass(id) {
      return passMeta.get(id)?.prompt_path ?? null;
    },
  };
}

export function projectSuitePath(config) {
  const value = config?.reviews?.suite;
  return typeof value === "string" && value.trim() ? normalizeRel(value.trim()) : "";
}

export function resolveReviewContextPath(discovery, rel) {
  const pathError = portableRelativePathError(rel);
  if (pathError) throw new Error(`Review context path "${rel}" is invalid: ${pathError}`);

  const root = discovery.manuscriptRoot;
  const resolved = path.resolve(root, rel);
  if (!isPathInsideOrEqual(resolved, root)) {
    throw new Error(`Review context path "${rel}" must stay inside the project root`);
  }
  if (!fs.existsSync(resolved)) return resolved;

  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(resolved);
  if (!isPathInsideOrEqual(realFile, realRoot)) {
    throw new Error(`Review context path "${rel}" resolves outside the project root`);
  }
  return realFile;
}

export function reviewPassApplies(pass, sectionKind, sectionStage) {
  const stages = Array.isArray(pass?.stage) ? pass.stage : [];
  const kinds = Array.isArray(pass?.applies_to) ? pass.applies_to : [];
  return (stages.includes("*") || stages.includes(sectionStage))
    && (kinds.includes("*") || kinds.includes(sectionKind));
}

export function reviewPassDefinitionSha256(registry, id, { promptText } = {}) {
  const pass = registry.passById.get(id);
  if (!pass) return null;
  const promptPath = registry.promptPathForPass(id);
  const promptSha256 = promptText !== undefined
    ? sha256(promptText)
    : promptPath && fs.existsSync(promptPath)
      ? sha256(fs.readFileSync(promptPath))
      : null;
  return sha256(stableJson({
    pass,
    context_pack: registry.contextPacks[pass.context_pack] ?? null,
    prompt_sha256: promptSha256,
  }));
}

export function reviewRegistrySha256(registry) {
  return sha256(stableJson({
    passes: registry.passes.map((pass) => ({
      id: pass.id,
      definition_sha256: reviewPassDefinitionSha256(registry, pass.id),
    })),
    context_packs: registry.contextPacks,
  }));
}

function loadSuiteSource({ file, root, label, origin, required, errors, declaredPath = "" }) {
  if (declaredPath) {
    const pathError = portableRelativePathError(declaredPath);
    if (pathError) {
      errors.push(`Config reviews.suite is invalid: ${pathError}`);
      return null;
    }
    const resolved = path.resolve(root, declaredPath);
    if (!isPathInsideOrEqual(resolved, root)) {
      errors.push("Config reviews.suite must stay inside the project root.");
      return null;
    }
  }

  if (!fs.existsSync(file)) {
    if (required) errors.push(`${label} does not exist`);
    return null;
  }
  if (!fs.statSync(file).isFile()) {
    errors.push(`${label} must be a JSON file`);
    return null;
  }

  const ownedFile = resolveOwnedFile(root, normalizeRel(path.relative(root, file)), {
    label,
    errors,
  });
  if (!ownedFile) return null;

  try {
    const suite = JSON.parse(fs.readFileSync(ownedFile, "utf8"));
    if (!isPlainObject(suite)) {
      errors.push(`${label} must contain a JSON object`);
      return null;
    }
    return { file: ownedFile, root, label, origin, suite };
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateSuiteShape(source, errors) {
  const { suite, label } = source;
  if (suite.version !== undefined && suite.version !== 1) {
    errors.push(`${label}.version must be 1`);
  }
  if (!isPlainObject(suite.context_packs)) {
    errors.push(`${label}.context_packs must be an object`);
  }
  if (!Array.isArray(suite.passes)) {
    errors.push(`${label}.passes must be an array`);
  }
  if (suite.default_models !== undefined) {
    validateStringArray(suite.default_models, `${label}.default_models`, errors, { nonEmpty: true });
  }
  if (suite.output_schema !== undefined && !SUPPORTED_OUTPUT_SCHEMAS.has(suite.output_schema)) {
    errors.push(`${label}.output_schema must be one of: ${Array.from(SUPPORTED_OUTPUT_SCHEMAS).join(", ")}`);
  }
}

function validateContextPack(pack, label, errors, root) {
  if (!isPlainObject(pack)) {
    errors.push(`${label} must be an object`);
    return;
  }
  validateStringArray(pack.include, `${label}.include`, errors, { nonEmpty: true });
  if (pack.exclude !== undefined) validateStringArray(pack.exclude, `${label}.exclude`, errors);
  for (const [index, entry] of (Array.isArray(pack.include) ? pack.include : []).entries()) {
    validateContextEntry(entry, `${label}.include[${index}]`, errors, root);
  }
  for (const [index, entry] of (Array.isArray(pack.exclude) ? pack.exclude : []).entries()) {
    validateContextEntry(entry, `${label}.exclude[${index}]`, errors, root);
  }
  if (pack.description !== undefined && typeof pack.description !== "string") {
    errors.push(`${label}.description must be a string`);
  }
  if (pack.strip_contract !== undefined && typeof pack.strip_contract !== "boolean") {
    errors.push(`${label}.strip_contract must be a boolean`);
  }
}

function validateContextEntry(entry, label, errors, root) {
  if (typeof entry !== "string" || !entry.trim()) return;
  const pathError = portableRelativePathError(entry);
  if (pathError) {
    errors.push(`${label} is invalid: ${pathError}`);
    return;
  }
  if (entry.includes("{")) return;

  const resolved = path.resolve(root, entry);
  if (!fs.existsSync(resolved)) return;
  const realRoot = fs.realpathSync(root);
  const realEntry = fs.realpathSync(resolved);
  if (!isPathInsideOrEqual(realEntry, realRoot)) {
    errors.push(`${label} resolves outside its owning root`);
  }
}

function validateReviewPass(pass, { label, source, errors }) {
  validateId(pass.id, `${label}.id`, errors);
  validateStringArray(pass.stage, `${label}.stage`, errors, { nonEmpty: true });
  validateStringArray(pass.applies_to, `${label}.applies_to`, errors, { nonEmpty: true });
  if (typeof pass.context_pack !== "string" || !pass.context_pack.trim()) {
    errors.push(`${label}.context_pack must be a non-empty string`);
  }
  validateStringArray(pass.models, `${label}.models`, errors, { nonEmpty: true });

  if (typeof pass.prompt !== "string" || !pass.prompt.trim()) {
    errors.push(`${label}.prompt must be a non-empty project-relative path`);
  }

  if (pass.label !== undefined && (typeof pass.label !== "string" || !pass.label.trim())) {
    errors.push(`${label}.label must be a non-empty string when present`);
  }
  if (pass.blocking !== undefined && typeof pass.blocking !== "boolean") {
    errors.push(`${label}.blocking must be a boolean`);
  }
  if (pass.output_schema !== undefined && !SUPPORTED_OUTPUT_SCHEMAS.has(pass.output_schema)) {
    errors.push(`${label}.output_schema must be one of: ${Array.from(SUPPORTED_OUTPUT_SCHEMAS).join(", ")}`);
  }
  if (pass.max_issues !== undefined && (!Number.isFinite(Number(pass.max_issues)) || Number(pass.max_issues) < 0)) {
    errors.push(`${label}.max_issues must be a non-negative number`);
  }
  if (
    pass.min_confidence !== undefined &&
    (!Number.isFinite(Number(pass.min_confidence)) ||
      Number(pass.min_confidence) < 0 ||
      Number(pass.min_confidence) > 1)
  ) {
    errors.push(`${label}.min_confidence must be a number from 0 to 1`);
  }
}

function validateId(value, label, errors) {
  if (typeof value !== "string" || !value.trim() || !REVIEW_ID_PATTERN.test(value)) {
    errors.push(`${label} must be a stable ID using letters, numbers, dots, colons, underscores, or hyphens`);
  }
}

function validateStringArray(value, label, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    errors.push(`${label} must be ${nonEmpty ? "a non-empty" : "an"} array`);
    return;
  }
  if (value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must contain only non-empty strings`);
  }
}

function resolveOwnedFile(root, rel, { label, errors }) {
  if (typeof rel !== "string" || !rel.trim()) return null;
  const pathError = portableRelativePathError(rel);
  if (pathError) {
    errors.push(`${label} is invalid: ${pathError}`);
    return null;
  }

  const resolved = path.resolve(root, rel);
  if (!isPathInsideOrEqual(resolved, root)) {
    errors.push(`${label} must stay inside ${normalizeRel(root)}`);
    return null;
  }
  if (!fs.existsSync(resolved)) {
    errors.push(`${label} points to missing file: ${normalizeRel(rel)}`);
    return null;
  }
  if (!fs.statSync(resolved).isFile()) {
    errors.push(`${label} must point to a file: ${normalizeRel(rel)}`);
    return null;
  }

  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(resolved);
  if (!isPathInsideOrEqual(realFile, realRoot)) {
    errors.push(`${label} resolves outside its owning root`);
    return null;
  }
  return realFile;
}

function portableRelativePathError(value) {
  if (!value || typeof value !== "string") return "must be a non-empty relative path";
  if (/^[A-Za-z]:($|[\\/])/.test(value)) return "Windows drive paths are not portable";
  if (value.startsWith("\\\\") || value.startsWith("//")) return "UNC paths are not portable";
  if (value.includes("\\")) return "use forward slashes, not backslashes";
  if (path.isAbsolute(value) || path.posix.isAbsolute(value)) return "absolute paths are not portable";
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) return "path must not escape its owning root";
  return "";
}

function isPathInsideOrEqual(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRel(value) {
  return String(value).split(path.sep).join("/");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
