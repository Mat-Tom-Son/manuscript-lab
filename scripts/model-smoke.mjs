#!/usr/bin/env node

import { JSON_OBJECT_RESPONSE_FORMAT } from "./lib/model-json.mjs";
import { callChatModel, describeModelRuntime, providerMissingKeyMessage } from "./lib/model-provider.mjs";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const runtime = describeModelRuntime(options.model, options.provider);
const summary = {
  model: options.model,
  provider: runtime.provider,
  resolved_model: runtime.model,
  base_url: runtime.base_url,
  api_key_env: runtime.api_key_env,
  missing_api_key: runtime.missing_api_key,
  dry_run: options.dryRun,
};

if (options.dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (runtime.missing_api_key) {
  console.error(providerMissingKeyMessage(options.model, options.provider));
  process.exit(1);
}

try {
  const response = await callChatModel({
    model: options.model,
    explicitProvider: options.provider,
    title: "manuscript-lab model smoke",
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    responseFormat: options.jsonMode ? JSON_OBJECT_RESPONSE_FORMAT : null,
    system: options.jsonMode ? "Return exactly one valid JSON object. No Markdown." : "Return one concise sentence. No Markdown.",
    content: options.prompt,
    audit: {
      operation: "model.smoke",
    },
  });

  const result = {
    ...summary,
    output: response.content,
    reasoning_chars: response.reasoning ? response.reasoning.length : 0,
    tool_call_count: Array.isArray(response.tool_calls) ? response.tool_calls.length : 0,
    finish_reason: response.finish_reason || "",
    usage: response.usage,
    model_call_id: response.model_call_id,
    model_call_path: response.model_call_path,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`provider: ${response.provider}`);
    console.log(`model: ${response.model}`);
    if (response.model_call_id) console.log(`model_call_id: ${response.model_call_id}`);
    if (response.usage) console.log(`usage: ${JSON.stringify(response.usage)}`);
    if (response.reasoning) console.log(`reasoning_chars: ${response.reasoning.length}`);
    if (Array.isArray(response.tool_calls) && response.tool_calls.length) console.log(`tool_call_count: ${response.tool_calls.length}`);
    if (response.finish_reason) console.log(`finish_reason: ${response.finish_reason}`);
    console.log(response.content);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    model: "lightning:lightning-ai/gpt-oss-20b",
    provider: "",
    prompt: "Say that the doc repo model provider is wired correctly.",
    temperature: 0,
    maxTokens: 80,
    dryRun: false,
    json: false,
    jsonMode: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--json-mode") parsed.jsonMode = true;
    else if (arg === "--model") {
      parsed.model = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--model=")) {
      parsed.model = arg.slice("--model=".length);
    } else if (arg === "--provider") {
      parsed.provider = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--provider=")) {
      parsed.provider = arg.slice("--provider=".length);
    } else if (arg === "--prompt") {
      parsed.prompt = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--prompt=")) {
      parsed.prompt = arg.slice("--prompt=".length);
    } else if (arg === "--temperature") {
      parsed.temperature = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--max-tokens") {
      parsed.maxTokens = Number(args[index + 1]);
      index += 1;
    } else {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!parsed.model) {
    console.error("A model is required.");
    process.exit(1);
  }

  if (!Number.isFinite(parsed.temperature)) parsed.temperature = 0;
  if (!Number.isFinite(parsed.maxTokens) || parsed.maxTokens <= 0) parsed.maxTokens = 80;
  return parsed;
}

function printHelp() {
  console.log(`model-smoke - test the configured model provider with one tiny call

Usage:
  npm run model:smoke -- --dry-run
  LIGHTNING_API_KEY=... npm run model:smoke
  npm run model:smoke -- --model lightning:lightning-ai/gpt-oss-120b
  npm run model:smoke -- --model openrouter:openai/gpt-4.1-mini

Options:
  --model id          Model ID. Prefix with lightning:, openrouter:, or custom: to route explicitly.
  --provider id       Provider for unprefixed model IDs.
  --prompt text       Prompt to send. Default is a short wiring check.
  --temperature n     Temperature. Default: 0.
  --max-tokens n      Max output tokens. Default: 80.
  --dry-run           Print resolved provider config without calling a model.
  --json              Print machine-readable output.
  --json-mode         Request provider JSON mode via response_format.
  --help, -h          Show this help.

Environment:
  LIGHTNING_API_KEY        Lightning AI API key.
  LIGHTNING_BILLING_SCOPE  Optional org/teamspace or user/teamspace suffix.
  OPENROUTER_API_KEY       OpenRouter API key.
  MODEL_API_BASE_URL       Custom OpenAI-compatible base URL for custom: models.
  MODEL_API_KEY            Custom OpenAI-compatible API key.
`);
}
