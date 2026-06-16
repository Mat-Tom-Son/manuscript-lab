#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { callChatModel, describeModelRuntime, hasAnyApiKeyForModels, providerMissingKeyMessage } from "./lib/model-provider.mjs";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help || !options.target) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

if (!hasAnyApiKeyForModels(options.models)) {
  console.error(`No configured model provider API key found for requested models.`);
  for (const model of options.models) console.error(`- ${providerMissingKeyMessage(model)}`);
  process.exit(1);
}

const target = resolveInputPath(options.target);
if (!fs.existsSync(target)) {
  console.error(`Target file does not exist: ${displayPath(target)}`);
  process.exit(1);
}

const sectionText = read(target);
const sectionId = parseSectionContract(sectionText)?.get("id") ?? path.basename(target, path.extname(target));
const contextFiles = collectContextFiles(target, sectionText);
const prompt = buildReviewPrompt({ target, contextFiles });
const date = new Date().toISOString().slice(0, 10);
const outDir = abs("state/reviews");
fs.mkdirSync(outDir, { recursive: true });

const results = [];
for (const model of options.models) {
  const startedAt = new Date().toISOString();
  let content = "";
  let error = "";
  let modelCallId = "";
  let modelCallPath = "";

  try {
    const response = await callChatModel({
      model,
      title: "manuscript-lab model review",
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      system:
        "You are a read-only fiction editor. You cannot edit files. Return concise, actionable review notes in Markdown.",
      content: prompt,
      audit: {
        operation: "review.model",
        target: displayPath(target),
        section_id: sectionId,
      },
    });
    content = response.content;
    modelCallId = response.model_call_id ?? "";
    modelCallPath = response.model_call_path ?? "";
  } catch (caught) {
    error = caught.message;
    content = `## Blocking\n\n- Provider error: ${error}\n`;
  }

  const runtime = describeModelRuntime(model);
  const file = path.join(outDir, `${date}-${sectionId}-${slugModel(model)}.md`);
  const body = [
    `# Model Review: ${sectionId}`,
    "",
    `Model: \`${model}\``,
    `Provider: \`${runtime.provider}\``,
    `Resolved model: \`${runtime.model}\``,
    `Target: \`${displayPath(target)}\``,
    modelCallId ? `Model call ID: \`${modelCallId}\`` : "",
    modelCallPath ? `Model call path: \`${modelCallPath}\`` : "",
    `Started: ${startedAt}`,
    `Finished: ${new Date().toISOString()}`,
    "",
    content.trim(),
    "",
  ].join("\n");

  fs.writeFileSync(file, body);
  results.push({ model, provider: runtime.provider, resolved_model: runtime.model, file: displayPath(file), error, model_call_id: modelCallId, model_call_path: modelCallPath });
  console.log(`${error ? "error" : "saved"}: ${model} -> ${displayPath(file)}`);
}

if (options.json) {
  console.log(JSON.stringify({ target: displayPath(target), section_id: sectionId, results }, null, 2));
}

function collectContextFiles(targetFile, targetText) {
  const baseFiles = [
    "brief.md",
    "outline.md",
    "style.md",
    "state/status.md",
    "state/continuity.md",
    "state/claims.md",
    "state/open-questions.md",
    "sources/index.md",
  ];
  const contract = parseSectionContract(targetText);
  const dependencies = contract ? parseContractList(targetText, "depends_on") : [];
  const files = [...baseFiles, ...dependencies, displayPath(targetFile)]
    .map((file) => (path.isAbsolute(file) ? file : abs(file)))
    .filter((file) => fs.existsSync(file));

  return Array.from(new Set(files));
}

function buildReviewPrompt({ target, contextFiles }) {
  const fileBlocks = contextFiles
    .map((file) => `<file path="${displayPath(file)}">\n${read(file)}\n</file>`)
    .join("\n\n");

  return [
    "Review this section without editing files.",
    "",
    `Target: ${displayPath(target)}`,
    "",
    "Read the provided files, then return concise issues only. Prioritize project-level usefulness over generic prose advice.",
    "",
    "Use this structure exactly:",
    "",
    "## Blocking",
    "## Source / Science",
    "## Continuity",
    "## Structure",
    "## Style",
    "## Best Next Patch",
    "",
    "Rules:",
    "- Report concrete issues before praise.",
    "- Do not rewrite the section.",
    "- Do not ask for a different story unless the current section cannot satisfy its contract.",
    "- Preserve the established voice defined in the style guide and section context.",
    "- Treat characters, stakeholders, and arguments according to the project brief rather than generic archetypes.",
    "- Separate true blockers from taste preferences.",
    "",
    "Files:",
    "",
    fileBlocks,
  ].join("\n");
}

function parseSectionContract(text) {
  const match = text.match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return null;

  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2]);
  }
  return fields;
}

function parseContractList(text, fieldName) {
  const match = text.match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return [];

  const items = [];
  let inList = false;
  for (const line of match[1].split("\n")) {
    if (new RegExp(`^\\s*${escapeRegExp(fieldName)}\\s*:\\s*$`).test(line)) {
      inList = true;
      continue;
    }

    if (!inList) continue;

    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item) {
      items.push(item[1]);
      continue;
    }

    if (/^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) break;
  }

  return items;
}

function parseArgs(rawArgs) {
  const parsed = {
    target: "",
    models: (process.env.DOC_REVIEW_MODELS || "openai/gpt-4.1-mini,google/gemini-2.5-flash-lite,anthropic/claude-haiku-4.5")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    temperature: Number(process.env.DOC_REVIEW_TEMPERATURE ?? 0.2),
    maxTokens: Number(process.env.DOC_REVIEW_MAX_TOKENS ?? 1800),
    json: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--models") {
      parsed.models = String(rawArgs[index + 1] ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg.startsWith("--models=")) {
      parsed.models = arg
        .slice("--models=".length)
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean);
    } else if (arg === "--temperature") {
      parsed.temperature = Number(rawArgs[index + 1]);
      index += 1;
    } else if (arg === "--max-tokens") {
      parsed.maxTokens = Number(rawArgs[index + 1]);
      index += 1;
    } else if (!parsed.target) {
      parsed.target = arg;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!parsed.models.length) {
    console.error("At least one model is required");
    process.exit(1);
  }

  if (!Number.isFinite(parsed.temperature)) parsed.temperature = 0.2;
  if (!Number.isFinite(parsed.maxTokens) || parsed.maxTokens <= 0) parsed.maxTokens = 1800;
  return parsed;
}

function printHelp() {
  console.log(`model-review - run read-only model reviews for a draft section

Usage:
  node scripts/model-review.mjs [options] <draft-section.md>

Options:
  --models a,b       Comma-separated model IDs. Prefix with lightning: or openrouter: to route a model.
  --temperature n    Review temperature. Default: 0.2.
  --max-tokens n     Max response tokens per model. Default: 1800.
  --json             Print result JSON after saving files.
  --help, -h         Show this help.

Environment:
  OPENROUTER_API_KEY Required for OpenRouter models.
  LIGHTNING_API_KEY  Required for Lightning AI models.
  DOC_REVIEW_MODELS  Default comma-separated model list.
`);
}

function slugModel(model) {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveInputPath(input) {
  return path.isAbsolute(input) ? input : abs(input);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function abs(rel) {
  return path.join(root, rel);
}

function displayPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}
