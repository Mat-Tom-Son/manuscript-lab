#!/usr/bin/env node

import { describeModelRuntime, resolveModelRuntime } from "./lib/model-provider.mjs";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

try {
  const result = await inspectModels(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function inspectModels(options) {
  const provider = options.provider || providerFromModel(options.model) || "openrouter";
  const runtime = resolveModelRuntime(`${provider}:__capability_probe__`);
  const models = await fetchModels({ provider, runtime });
  const query = normalizedQuery(options.model || options.search || "");
  const matches = query
    ? models.filter((model) => modelMatches(model, query))
    : models;

  return {
    provider,
    provider_label: runtime.provider_label,
    base_url: runtime.base_url,
    api_key_env: runtime.api_key_env,
    missing_api_key: runtime.missing_api_key,
    query: options.model || options.search || "",
    count: matches.length,
    models: matches.slice(0, options.limit).map((model) => summarizeModel(provider, model)),
  };
}

async function fetchModels({ provider, runtime }) {
  const headers = {};
  if (runtime.api_key) headers.Authorization = `Bearer ${runtime.api_key}`;
  const response = await fetch(`${runtime.base_url.replace(/\/+$/g, "")}/models`, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${runtime.provider_label} models request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${runtime.provider_label} models response was not JSON: ${error.message}`);
  }
  const data = Array.isArray(json.data) ? json.data : [];
  if (!data.length && provider === "lightning" && runtime.missing_api_key) {
    throw new Error(`${runtime.api_key_env} is required to list Lightning models.`);
  }
  return data;
}

function summarizeModel(provider, model) {
  const id = model.id ?? model.slug ?? "";
  const prefixed = id ? `${provider}:${id}` : "";
  const runtime = id ? describeModelRuntime(prefixed) : null;
  return {
    id,
    prefixed_model: prefixed,
    resolved_model: runtime?.model ?? id,
    name: model.name ?? "",
    description: model.description ?? "",
    provider: model.provider?.name ?? model.top_provider?.provider_name ?? "",
    context_length: model.context_length ?? model.top_provider?.context_length ?? null,
    max_tokens: model.max_tokens ?? model.top_provider?.max_completion_tokens ?? null,
    supported_parameters: model.supported_parameters ?? [],
    pricing: model.pricing ?? null,
    architecture: model.architecture ?? null,
  };
}

function modelMatches(model, query) {
  return [model.id, model.canonical_slug, model.name, model.description]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function normalizedQuery(value) {
  return String(value ?? "")
    .replace(/^[A-Za-z][A-Za-z0-9_-]*:/, "")
    .trim()
    .toLowerCase();
}

function providerFromModel(model) {
  const match = String(model ?? "").match(/^([A-Za-z][A-Za-z0-9_-]*):/);
  return match?.[1] ?? "";
}

function parseArgs(args) {
  const parsed = {
    model: "",
    provider: "",
    search: "",
    limit: 20,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--provider") {
      parsed.provider = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--search") {
      parsed.search = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--limit") {
      parsed.limit = Number(args[index + 1] ?? 20);
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (!parsed.model) {
      parsed.model = arg;
    }
  }

  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) parsed.limit = 20;
  return parsed;
}

function printResult(result) {
  console.log(`${result.provider_label} models`);
  console.log(`base_url: ${result.base_url}`);
  console.log(`api_key_env: ${result.api_key_env}${result.missing_api_key ? " (missing)" : ""}`);
  if (result.query) console.log(`query: ${result.query}`);
  console.log(`matches: ${result.count}`);
  console.log("");

  for (const model of result.models) {
    console.log(`- ${model.prefixed_model}`);
    if (model.name && model.name !== model.id) console.log(`  name: ${model.name}`);
    if (model.provider) console.log(`  provider: ${model.provider}`);
    if (model.context_length !== null) console.log(`  context_length: ${model.context_length}`);
    if (model.max_tokens !== null) console.log(`  max_tokens: ${model.max_tokens}`);
    if (model.supported_parameters.length) console.log(`  supported_parameters: ${model.supported_parameters.join(", ")}`);
    const pricing = pricingSummary(model.pricing);
    if (pricing) console.log(`  pricing: ${pricing}`);
    if (model.description) console.log(`  description: ${model.description.replace(/\s+/g, " ").slice(0, 220)}`);
    console.log("");
  }
}

function pricingSummary(pricing) {
  if (!pricing || typeof pricing !== "object") return "";
  const pairs = Object.entries(pricing)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 6)
    .map(([key, value]) => `${key}=${value}`);
  return pairs.join(", ");
}

function printHelp() {
  console.log(`Usage:
  npm run model:capabilities -- [provider:model-or-query]
  npm run model:capabilities -- --provider lightning --search glm
  npm run model:capabilities -- openrouter:z-ai/glm-5.2 --json

Lists model catalog metadata from provider /models endpoints. OpenRouter includes
supported_parameters; Lightning includes model ids, context, max tokens, pricing,
and modalities from its authenticated OpenAI-compatible endpoint.
`);
}
