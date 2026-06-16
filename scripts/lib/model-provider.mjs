import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const KNOWN_PROVIDERS = new Set(["openrouter", "lightning", "custom"]);

loadLocalEnv();

export function resolveModelRuntime(model, explicitProvider = "") {
  const parsed = parseModelSpec(model);
  const provider = normalizeProvider(parsed.provider || explicitProvider || "openrouter");
  const resolvedModel = parsed.model || model;
  const config = providerConfig(provider);

  return {
    provider,
    provider_label: config.label,
    model: resolvedModel,
    display_model: model,
    base_url: config.baseUrl,
    api_key: config.apiKey,
    api_key_env: config.apiKeyEnv,
    missing_api_key: !config.apiKey,
  };
}

export function describeModelRuntime(model, explicitProvider = "") {
  const runtime = resolveModelRuntime(model, explicitProvider);
  return {
    provider: runtime.provider,
    provider_label: runtime.provider_label,
    model: runtime.model,
    display_model: runtime.display_model,
    base_url: runtime.base_url,
    api_key_env: runtime.api_key_env,
    missing_api_key: runtime.missing_api_key,
  };
}

export function providerMissingKeyMessage(model, explicitProvider = "") {
  const runtime = resolveModelRuntime(model, explicitProvider);
  if (!runtime.missing_api_key) return "";
  return `${runtime.api_key_env} is required for ${runtime.provider_label} model calls (${runtime.display_model}).`;
}

export function hasApiKeyForModel(model, explicitProvider = "") {
  return !resolveModelRuntime(model, explicitProvider).missing_api_key;
}

export function hasAnyApiKeyForModels(models = []) {
  return models.some((model) => hasApiKeyForModel(model));
}

export async function callChatModel({
  model,
  explicitProvider = "",
  title = "doc-repo-agent",
  temperature = 0.2,
  maxTokens = 1200,
  responseFormat = null,
  tools = null,
  toolChoice = null,
  parallelToolCalls = null,
  thinking = null,
  reasoning = null,
  messages = null,
  system = "",
  content = "",
  signal = null,
  audit = null,
}) {
  const runtime = resolveModelRuntime(model, explicitProvider);
  const body = buildRequestBody({
    runtime,
    model: runtime.model,
    temperature,
    maxTokens,
    responseFormat,
    tools,
    toolChoice,
    parallelToolCalls,
    thinking,
    reasoning,
    messages,
    system,
    content,
  });
  const attempts = requestBodyVariants(runtime, body);
  const auditRecord = beginModelCallAudit({
    audit,
    runtime,
    title,
    requestBody: body,
    attempts,
    parameters: {
      temperature,
      max_tokens: maxTokens,
      response_format: responseFormat,
      tools: summarizeToolsForAudit(tools),
      tool_choice: toolChoice,
      parallel_tool_calls: parallelToolCalls,
      thinking,
      reasoning,
    },
  });
  let auditFinished = false;
  const finishAudit = (details) => {
    if (!auditRecord || auditFinished) return;
    auditFinished = true;
    finishModelCallAudit(auditRecord, details);
  };

  if (runtime.missing_api_key) {
    const message = providerMissingKeyMessage(model, explicitProvider);
    finishAudit({
      status: "error",
      error: message,
      attempts: [],
      usage: null,
      rawResponseText: "",
      rawResponseJson: null,
      assistantText: "",
    });
    throw new Error(message);
  }

  let response;
  let text = "";
  const attemptSummaries = [];
  const warnedDowngrades = new Set();

  for (const attemptBody of attempts) {
    warnOnCapabilityDowngrade({ runtime, originalBody: body, attemptBody, warnedDowngrades });
    const started = Date.now();
    let requestResult;
    try {
      requestResult = await postChatCompletion({ runtime, title, body: attemptBody, signal });
      ({ response, text } = requestResult);
    } catch (error) {
      attemptSummaries.push({
        attempt: attemptSummaries.length + 1,
        ok: false,
        status: "network_error",
        duration_ms: Date.now() - started,
        request_sha256: sha256Json(redactForAudit(attemptBody)),
        error: error.message,
      });
      finishAudit({
        status: "error",
        error: error.message,
        attempts: attemptSummaries,
        usage: null,
        rawResponseText: text,
        rawResponseJson: null,
        assistantText: "",
      });
      throw error;
    }

    attemptSummaries.push({
      attempt: attemptSummaries.length + 1,
      ok: response.ok,
      status: response.status,
      duration_ms: Date.now() - started,
      request_sha256: sha256Json(redactForAudit(attemptBody)),
      response_chars: text.length,
      transient_retries: requestResult?.transientRetries ?? 0,
    });
    if (response.ok) break;
    if (!shouldTryNextVariant(runtime, text)) break;
  }

  if (!response.ok) {
    const message = `${runtime.provider_label} request failed (${response.status}): ${text.slice(0, 500)}`;
    finishAudit({
      status: "error",
      error: message,
      attempts: attemptSummaries,
      usage: null,
      rawResponseText: text,
      rawResponseJson: null,
      assistantText: "",
    });
    throw new Error(message);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = `${runtime.provider_label} returned non-JSON response: ${error.message}`;
    finishAudit({
      status: "error",
      error: message,
      attempts: attemptSummaries,
      usage: null,
      rawResponseText: text,
      rawResponseJson: null,
      assistantText: "",
    });
    throw new Error(message);
  }

  const structured = Boolean(body.response_format || body.tools);
  let normalizedResponse = normalizeChatCompletionResponse(json, { structured });
  let assistantContent = normalizedResponse.content;
  let reasoningContent = normalizedResponse.reasoning;
  let toolCalls = normalizedResponse.tool_calls;
  if (shouldRetryStructuredReasoningOnly({ runtime, structured, assistantContent, reasoningContent, finishReason: json.choices?.[0]?.finish_reason, maxTokens })) {
    const retryOutcome = await runStructuredReasoningRetries({
      runtime,
      title,
      body,
      maxTokens,
      signal,
      attemptSummaries,
      finishAudit,
      previousText: text,
      previousJson: json,
    });
    response = retryOutcome.response;
    text = retryOutcome.text;
    json = retryOutcome.json;
    normalizedResponse = normalizeChatCompletionResponse(json, { structured });
    assistantContent = normalizedResponse.content;
    reasoningContent = normalizedResponse.reasoning;
    toolCalls = normalizedResponse.tool_calls;
  }
  finishAudit({
    status: "ok",
    error: "",
    attempts: attemptSummaries,
    usage: json.usage ?? null,
    rawResponseText: text,
    rawResponseJson: json,
    assistantText: assistantContent,
  });

  return {
    content: assistantContent,
    provider: runtime.provider,
    provider_label: runtime.provider_label,
    model: runtime.model,
    display_model: runtime.display_model,
    usage: json.usage ?? null,
    raw: json,
    reasoning: reasoningContent,
    tool_calls: toolCalls,
    finish_reason: normalizedResponse.finish_reason,
    native_finish_reason: normalizedResponse.native_finish_reason,
    refusal: normalizedResponse.refusal,
    model_call_id: auditRecord?.call_id ?? null,
    model_call_path: auditRecord?.call_dir_rel ?? null,
  };
}

function buildRequestBody({
  runtime,
  model,
  temperature,
  maxTokens,
  responseFormat,
  tools,
  toolChoice,
  parallelToolCalls,
  thinking,
  reasoning,
  messages,
  system,
  content,
}) {
  const body = {
    model: runtime.model,
    temperature,
    max_tokens: maxTokens,
    messages:
      messages ??
      [
        system ? { role: "system", content: system } : null,
        { role: "user", content },
      ].filter(Boolean),
  };
  if (responseFormat) body.response_format = responseFormat;
  const structuredTools = tools || (responseFormat && shouldUseStructuredToolForCall(runtime) ? structuredResponseTools() : null);
  if (structuredTools) {
    body.tools = structuredTools;
    body.tool_choice = toolChoice || structuredToolChoice();
    body.parallel_tool_calls = parallelToolCalls ?? false;
  }
  if (thinking) body.thinking = thinking;
  if (reasoning) body.reasoning = reasoning;
  if (!thinking && !reasoning && responseFormat && shouldDisableThinkingForStructuredCall(runtime)) {
    if (runtime.provider === "openrouter") {
      body.reasoning = { effort: "none", exclude: true };
    } else {
      body.thinking = { type: "disabled" };
    }
  }
  applyProviderCapabilityHints({ runtime, body, structured: Boolean(responseFormat || structuredTools) });
  if (runtime.provider === "lightning" && process.env.LIGHTNING_USE_MAX_COMPLETION_TOKENS === "1") {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  return body;
}

function applyProviderCapabilityHints({ runtime, body, structured }) {
  if (runtime.provider !== "openrouter") return;
  if (structured || body.reasoning || body.tools || body.tool_choice) {
    body.provider = { ...(body.provider ?? {}), require_parameters: true };
  }
  if (body.response_format?.type === "json_schema") {
    body.structured_outputs = true;
  }
}

function requestBodyVariants(runtime, body) {
  if (runtime.provider !== "lightning") return requestFeatureVariants([body]);

  const maxCompletionBody = withMaxCompletionTokens(body);
  const defaultSamplingBody = withoutSamplingControls(body);
  const defaultSamplingMaxCompletionBody = withoutSamplingControls(maxCompletionBody);
  return requestFeatureVariants([body, maxCompletionBody, defaultSamplingBody, defaultSamplingMaxCompletionBody]);
}

function requestFeatureVariants(variants) {
  return uniqueJson(
    variants.flatMap((variant) => {
      const expanded = [variant];
      if (variant.response_format) expanded.push(withoutResponseFormat(variant));
      if (variant.thinking || variant.reasoning) expanded.push(withoutThinkingControls(variant));
      if (variant.tools || variant.tool_choice || variant.parallel_tool_calls !== undefined) expanded.push(withoutToolControls(variant));
      if (variant.response_format && (variant.thinking || variant.reasoning)) {
        expanded.push(withoutThinkingControls(withoutResponseFormat(variant)));
      }
      if (variant.response_format && (variant.tools || variant.tool_choice || variant.parallel_tool_calls !== undefined)) {
        expanded.push(withoutToolControls(withoutResponseFormat(variant)));
      }
      if ((variant.thinking || variant.reasoning) && (variant.tools || variant.tool_choice || variant.parallel_tool_calls !== undefined)) {
        expanded.push(withoutToolControls(withoutThinkingControls(variant)));
      }
      if (variant.response_format && (variant.thinking || variant.reasoning) && (variant.tools || variant.tool_choice || variant.parallel_tool_calls !== undefined)) {
        expanded.push(withoutToolControls(withoutThinkingControls(withoutResponseFormat(variant))));
      }
      return expanded;
    }),
  );
}

function withMaxCompletionTokens(body) {
  if (!("max_tokens" in body)) return body;
  const next = { ...body, max_completion_tokens: body.max_tokens };
  delete next.max_tokens;
  return next;
}

function withoutSamplingControls(body) {
  const next = { ...body };
  delete next.temperature;
  delete next.top_p;
  delete next.n;
  delete next.presence_penalty;
  delete next.frequency_penalty;
  return next;
}

function withoutResponseFormat(body) {
  const next = { ...body };
  delete next.response_format;
  return next;
}

function withoutThinkingControls(body) {
  const next = { ...body };
  delete next.thinking;
  delete next.reasoning;
  return next;
}

function withoutToolControls(body) {
  const next = { ...body };
  delete next.tools;
  delete next.tool_choice;
  delete next.parallel_tool_calls;
  return next;
}

function uniqueJson(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function shouldTryNextVariant(runtime, text) {
  const providerAgnosticFallback = /response_format|json_schema|json_object|thinking|reasoning|tool_choice|tools|unsupported parameter|invalid parameter|unrecognized parameter|no endpoints found|handle the requested parameters/i.test(text);
  if (providerAgnosticFallback) return true;
  if (runtime.provider !== "lightning") return false;
  return /MaxTokens|MaxCompletionTokens|max_tokens|max_completion_tokens|beta-limitations|temperature|top_p|presence_penalty|frequency_penalty/i.test(text);
}

async function postChatCompletion({ runtime, title, body, signal }) {
  const timeoutMs = positiveNumber(process.env.MODEL_PROVIDER_TIMEOUT_MS, 120_000);
  const maxTransientRetries = Math.floor(nonNegativeNumber(process.env.MODEL_PROVIDER_TRANSIENT_RETRIES, 2));
  let transientRetries = 0;
  let lastNetworkError = null;

  for (let retry = 0; retry <= maxTransientRetries; retry += 1) {
    const request = requestSignalWithTimeout(signal, timeoutMs);
    try {
      const response = await fetch(`${runtime.base_url.replace(/\/+$/g, "")}/chat/completions`, {
        method: "POST",
        headers: requestHeaders(runtime, title),
        body: JSON.stringify(body),
        signal: request.signal,
      });

      const text = await response.text();
      if (!isTransientStatus(response.status) || retry >= maxTransientRetries) return { response, text, transientRetries };

      transientRetries += 1;
      await sleep(backoffDelayMs({ response, retry }));
    } catch (error) {
      if (request.timedOut()) throw new Error(`${runtime.provider_label} request timed out after ${timeoutMs} ms`);
      if (signal?.aborted || retry >= maxTransientRetries) throw error;
      lastNetworkError = error;
      transientRetries += 1;
      await sleep(backoffDelayMs({ retry }));
    } finally {
      request.cleanup();
    }
  }

  throw lastNetworkError || new Error(`${runtime.provider_label} request failed after transient retries`);
}

async function runRequestAttempts({ runtime, title, attempts, signal, attemptSummaries }) {
  let response = null;
  let text = "";
  const originalBody = attempts[0] ?? {};
  const warnedDowngrades = new Set();

  for (const attemptBody of attempts) {
    warnOnCapabilityDowngrade({ runtime, originalBody, attemptBody, warnedDowngrades });
    const started = Date.now();
    let requestResult;
    try {
      requestResult = await postChatCompletion({ runtime, title, body: attemptBody, signal });
      ({ response, text } = requestResult);
    } catch (error) {
      attemptSummaries.push({
        attempt: attemptSummaries.length + 1,
        ok: false,
        status: "network_error",
        duration_ms: Date.now() - started,
        request_sha256: sha256Json(redactForAudit(attemptBody)),
        semantic_retry: true,
        error: error.message,
      });
      throw error;
    }

    attemptSummaries.push({
      attempt: attemptSummaries.length + 1,
      ok: response.ok,
      status: response.status,
      duration_ms: Date.now() - started,
      request_sha256: sha256Json(redactForAudit(attemptBody)),
      response_chars: text.length,
      semantic_retry: true,
      transient_retries: requestResult?.transientRetries ?? 0,
    });
    if (response.ok) break;
    if (!shouldTryNextVariant(runtime, text)) break;
  }

  return { response, text };
}

async function runStructuredReasoningRetries({
  runtime,
  title,
  body,
  maxTokens,
  signal,
  attemptSummaries,
  finishAudit,
  previousText,
  previousJson,
}) {
  let lastResponse = null;
  let lastText = previousText;

  for (const tokenBudget of structuredReasoningRetryTokenSequence({ runtime, maxTokens })) {
    const retryBody = withRaisedTokenBudget(body, tokenBudget);
    const retryAttempts = requestBodyVariants(runtime, retryBody);
    let retryResult;
    try {
      retryResult = await runRequestAttempts({ runtime, title, attempts: retryAttempts, signal, attemptSummaries });
    } catch (error) {
      finishAudit({
        status: "error",
        error: error.message,
        attempts: attemptSummaries,
        usage: null,
        rawResponseText: lastText,
        rawResponseJson: previousJson,
        assistantText: "",
      });
      throw error;
    }

    lastResponse = retryResult.response;
    lastText = retryResult.text;
    if (!lastResponse.ok && shouldTryNextStructuredReasoningBudget(lastResponse, lastText)) continue;
    if (!lastResponse.ok) break;

    try {
      return { response: lastResponse, text: lastText, json: JSON.parse(lastText) };
    } catch (error) {
      const message = `${runtime.provider_label} returned non-JSON response during structured reasoning retry: ${error.message}`;
      finishAudit({
        status: "error",
        error: message,
        attempts: attemptSummaries,
        usage: null,
        rawResponseText: lastText,
        rawResponseJson: null,
        assistantText: "",
      });
      throw new Error(message);
    }
  }

  const message = `${runtime.provider_label} structured reasoning retry failed (${lastResponse?.status ?? "unknown"}): ${String(lastText ?? "").slice(0, 500)}`;
  finishAudit({
    status: "error",
    error: message,
    attempts: attemptSummaries,
    usage: null,
    rawResponseText: lastText,
    rawResponseJson: null,
    assistantText: "",
  });
  throw new Error(message);
}

function beginModelCallAudit({ audit, runtime, title, requestBody, attempts, parameters }) {
  if (!modelCallAuditEnabled(audit)) return null;

  try {
    const auditMeta = audit && typeof audit === "object" ? audit : {};
    const createdAt = new Date().toISOString();
    const operation = auditMeta.operation || title || "model.call";
    const rootDir = modelCallAuditRoot();
    const callId = modelCallId({ createdAt, operation, runtime });
    const callDir = path.join(rootDir, "calls", callId);
    fs.mkdirSync(callDir, { recursive: true });

    const request = {
      version: 1,
      call_id: callId,
      created_at: createdAt,
      operation,
      script: displayPath(process.argv[1] || ""),
      target: auditMeta.target || "",
      section_id: auditMeta.section_id || "",
      run_id: auditMeta.run_id || "",
      pass_id: auditMeta.pass_id || "",
      title,
      provider: runtime.provider,
      provider_label: runtime.provider_label,
      model: runtime.display_model,
      resolved_model: runtime.model,
      base_url: runtime.base_url,
      api_key_env: runtime.api_key_env,
      parameters,
      context_manifest: auditMeta.context_manifest || null,
      artifact_paths: auditMeta.artifact_paths || [],
      request_body: redactForAudit(requestBody),
      request_variants: attempts.map((attemptBody, index) => ({
        attempt: index + 1,
        sha256: sha256Json(redactForAudit(attemptBody)),
        differs_from_primary: index > 0,
      })),
    };

    const metadata = {
      ...request,
      status: "started",
      finished_at: "",
      duration_ms: null,
      attempts: [],
      usage: null,
      error: "",
      paths: modelCallPaths(rootDir, callDir),
    };

    writeJson(path.join(callDir, "request.json"), request);
    fs.writeFileSync(path.join(callDir, "prompt.md"), renderPromptMarkdown(requestBody.messages ?? []));
    writeJson(path.join(callDir, "metadata.json"), metadata);

    return {
      call_id: callId,
      call_dir: callDir,
      call_dir_rel: displayPath(callDir),
      root_dir: rootDir,
      created_at: createdAt,
      request,
    };
  } catch (error) {
    auditWarning(`Could not initialize model-call audit: ${error.message}`);
    return null;
  }
}

function finishModelCallAudit(record, { status, error, attempts, usage, rawResponseText, rawResponseJson, assistantText }) {
  try {
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(record.created_at);
    const paths = modelCallPaths(record.root_dir, record.call_dir);

    if (rawResponseJson) writeJson(path.join(record.call_dir, "response.json"), redactForAudit(rawResponseJson));
    fs.writeFileSync(path.join(record.call_dir, "response.txt"), redactSensitiveText(assistantText || ""));
    if (rawResponseText) fs.writeFileSync(path.join(record.call_dir, "provider-response.txt"), redactSensitiveText(rawResponseText));
    if (error) fs.writeFileSync(path.join(record.call_dir, "error.txt"), `${redactSensitiveText(error)}\n`);

    const metadata = {
      ...record.request,
      status,
      finished_at: finishedAt,
      duration_ms: Number.isFinite(durationMs) ? durationMs : null,
      attempts,
      usage,
      error: redactSensitiveText(error || ""),
      paths,
    };
    writeJson(path.join(record.call_dir, "metadata.json"), metadata);

    const ledgerEntry = {
      version: 1,
      call_id: record.call_id,
      created_at: record.created_at,
      finished_at: finishedAt,
      status,
      operation: record.request.operation,
      script: record.request.script,
      target: record.request.target,
      section_id: record.request.section_id,
      run_id: record.request.run_id,
      pass_id: record.request.pass_id,
      provider: record.request.provider,
      model: record.request.model,
      resolved_model: record.request.resolved_model,
      usage,
      error: redactSensitiveText(error || ""),
      call_dir: record.call_dir_rel,
      metadata_path: paths.metadata,
      request_path: paths.request,
      response_path: status === "ok" ? paths.response : "",
      response_text_path: status === "ok" ? paths.response_text : "",
    };
    fs.mkdirSync(record.root_dir, { recursive: true });
    fs.appendFileSync(path.join(record.root_dir, "ledger.jsonl"), `${JSON.stringify(ledgerEntry)}\n`);
  } catch (caught) {
    auditWarning(`Could not finish model-call audit: ${caught.message}`);
  }
}

function modelCallAuditEnabled(audit) {
  if (audit === false) return false;
  if (audit && typeof audit === "object" && audit.enabled === false) return false;
  return envFlag("MODEL_CALL_AUDIT") || envFlag("DOC_REPO_MODEL_CALL_AUDIT") || audit === true || Boolean(audit?.enabled);
}

function modelCallAuditRoot() {
  if (process.env.MODEL_CALL_AUDIT_DIR) return absolutePath(process.env.MODEL_CALL_AUDIT_DIR);

  const registryFile = absolutePath("projects/registry.json");
  const registry = readJsonIfExists(registryFile);
  const activeSlug = typeof registry?.active === "string" ? registry.active : registry?.active?.slug;
  const project = activeSlug ? registry?.projects?.[activeSlug] : null;
  const logsPath = project?.logs_path || registry?.active?.logs_path || (activeSlug ? path.join("projects", "active", activeSlug, "logs") : "");
  if (logsPath) return path.join(absolutePath(logsPath), "model-calls");

  return absolutePath("state/model-calls");
}

function modelCallId({ createdAt, operation, runtime }) {
  const stamp = createdAt.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
  const label = slugPart(operation || "model-call", 28);
  const provider = slugPart(runtime.provider || "provider", 16);
  const model = slugPart(runtime.model || runtime.display_model || "model", 44);
  return `${stamp}-${label}-${provider}-${model}-${randomUUID().slice(0, 8)}`;
}

function modelCallPaths(rootDir, callDir) {
  return {
    root: displayPath(rootDir),
    call_dir: displayPath(callDir),
    metadata: displayPath(path.join(callDir, "metadata.json")),
    request: displayPath(path.join(callDir, "request.json")),
    prompt: displayPath(path.join(callDir, "prompt.md")),
    response: displayPath(path.join(callDir, "response.json")),
    response_text: displayPath(path.join(callDir, "response.txt")),
    provider_response: displayPath(path.join(callDir, "provider-response.txt")),
    error: displayPath(path.join(callDir, "error.txt")),
  };
}

function renderPromptMarkdown(messages) {
  const parts = ["# Model Prompt", ""];
  for (const [index, message] of messages.entries()) {
    parts.push(`## ${index + 1}. ${message.role || "message"}`, "");
    parts.push(redactSensitiveText(messageContentToString(message.content)), "");
  }
  return `${parts.join("\n")}\n`;
}

function messageContentToString(content) {
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
}

export function normalizeChatCompletionResponse(json, { structured = false } = {}) {
  const choice = json.choices?.[0] ?? {};
  const message = completionMessage(choice);
  return {
    content: extractAssistantContent(json, { structured }),
    reasoning: extractReasoningContent(json),
    tool_calls: extractToolCalls(json),
    finish_reason: choice.finish_reason ?? "",
    native_finish_reason: choice.native_finish_reason ?? "",
    refusal: message.refusal ?? "",
  };
}

function extractAssistantContent(json, { structured = false } = {}) {
  const message = completionMessage(json.choices?.[0] ?? {});
  const toolArguments = extractToolArguments(message);
  if (toolArguments) return toolArguments;
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? "";
      })
      .join("");
  }
  const text = message.text ?? json.choices?.[0]?.text ?? "";
  if (text) return text;
  if (structured) return "";
  return message.reasoning_content ?? message.reasoning ?? "";
}

function completionMessage(choice) {
  return choice?.message ?? choice?.delta ?? {};
}

function shouldDisableThinkingForStructuredCall(runtime) {
  return /\bglm[-_]?5(?:\.1)?\b|z-ai\/glm|lightning-ai\/glm/i.test(runtime.model || runtime.display_model || "");
}

function shouldUseStructuredToolForCall(runtime) {
  if (envFlag("MODEL_PROVIDER_DISABLE_STRUCTURED_TOOLS")) return false;
  return envFlag("MODEL_PROVIDER_ENABLE_STRUCTURED_TOOLS") && shouldDisableThinkingForStructuredCall(runtime);
}

function structuredResponseTools() {
  return [
    {
      type: "function",
      function: {
        name: "submit_structured_response",
        description: "Submit the complete structured JSON response requested by the harness.",
        parameters: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  ];
}

function structuredToolChoice() {
  return { type: "function", function: { name: "submit_structured_response" } };
}

function extractToolArguments(message) {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const call = toolCalls.find((item) => item?.function?.arguments) ?? null;
  const args = call?.function?.arguments;
  if (!args) return "";

  const text = typeof args === "string" ? args : JSON.stringify(args);
  try {
    const parsed = JSON.parse(text);
    const wrapper = parsed?.response ?? parsed?.result ?? parsed?.json ?? null;
    if (wrapper && typeof wrapper === "object" && Object.keys(parsed).length === 1) return JSON.stringify(wrapper);
  } catch {
    // Leave argument repair to the structured parser downstream.
  }
  return text;
}

function extractToolCalls(json) {
  const message = completionMessage(json.choices?.[0] ?? {});
  return Array.isArray(message.tool_calls) ? message.tool_calls : [];
}

function extractReasoningContent(json) {
  const choice = json.choices?.[0] ?? {};
  const message = completionMessage(choice);
  const direct = message.reasoning_content ?? message.reasoning ?? "";
  const details = message.reasoning_details ?? choice.reasoning_details ?? [];
  if (direct) return typeof direct === "string" ? direct : JSON.stringify(direct);
  if (Array.isArray(details) && details.length) return JSON.stringify(details);
  return "";
}

function shouldRetryStructuredReasoningOnly({ runtime, structured, assistantContent, reasoningContent, finishReason, maxTokens }) {
  if (!structured) return false;
  if (String(assistantContent ?? "").trim()) return false;
  if (!String(reasoningContent ?? "").trim()) return false;
  if (!/length/i.test(String(finishReason ?? ""))) return false;
  return structuredReasoningRetryTokenSequence({ runtime, maxTokens }).length > 0;
}

function structuredReasoningRetryTokenSequence({ runtime, maxTokens }) {
  const configured = String(process.env.MODEL_PROVIDER_STRUCTURED_REASONING_RETRY_TOKENS ?? "").trim();
  const configuredValues = configured
    ? configured.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > maxTokens)
    : [];
  if (configuredValues.length) return uniqueNumbers(configuredValues);

  const sequence = shouldDisableThinkingForStructuredCall(runtime)
    ? [65536, 32768, 24000, 16000, Math.max(maxTokens * 3, 12000)]
    : [32768, 24000, 16000, Math.max(maxTokens * 3, 12000)];
  return uniqueNumbers(sequence.filter((item) => item > maxTokens));
}

function shouldTryNextStructuredReasoningBudget(response, text) {
  if (!response) return false;
  if (isRateLimitResponse(response, text)) return false;
  if ([408, 409, 425, 500, 502, 503, 504, 529].includes(Number(response.status))) return true;
  return /timeout|timed out|bad gateway|proxy|upstream|overloaded|maximum|max_tokens|max_completion_tokens/i.test(String(text ?? ""));
}

function withRaisedTokenBudget(body, maxTokens) {
  const next = { ...body };
  if ("max_completion_tokens" in next && !("max_tokens" in next)) {
    next.max_completion_tokens = maxTokens;
  } else {
    next.max_tokens = maxTokens;
    delete next.max_completion_tokens;
  }
  return next;
}

function uniqueNumbers(values) {
  return Array.from(new Set(values.map((value) => Math.floor(value)).filter((value) => Number.isFinite(value) && value > 0)));
}

function requestSignalWithTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abortFromCaller();
  } else if (signal) {
    signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abortFromCaller);
    },
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function isTransientStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 529].includes(Number(status));
}

function isRateLimitResponse(response, text) {
  if (Number(response?.status) === 429) return true;
  return /\brate\b|\brate-limit\b|rate limit|quota|too many/i.test(String(text ?? ""));
}

function backoffDelayMs({ response = null, retry }) {
  const retryAfterMs = parseRetryAfterMs(response?.headers?.get?.("retry-after"));
  if (retryAfterMs) return Math.min(retryAfterMs, 30_000);
  const base = Math.min(10_000, 500 * 2 ** retry);
  return Math.floor(base / 2 + Math.random() * base);
}

function parseRetryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warnOnCapabilityDowngrade({ runtime, originalBody, attemptBody, warnedDowngrades }) {
  const removed = removedRequestFeatures(originalBody, attemptBody);
  if (!removed.length) return;
  const key = removed.join(",");
  if (warnedDowngrades.has(key)) return;
  warnedDowngrades.add(key);
  console.warn(`model ${runtime.display_model}: retried without ${removed.join(", ")}`);
}

function removedRequestFeatures(originalBody, attemptBody) {
  const features = [];
  if (originalBody.response_format && !attemptBody.response_format) features.push("response_format");
  if ((originalBody.thinking || originalBody.reasoning) && !attemptBody.thinking && !attemptBody.reasoning) features.push("thinking");
  if ((originalBody.tools || originalBody.tool_choice || originalBody.parallel_tool_calls !== undefined) && !attemptBody.tools && !attemptBody.tool_choice && attemptBody.parallel_tool_calls === undefined) {
    features.push("tools");
  }
  return features;
}

function summarizeToolsForAudit(tools) {
  if (!Array.isArray(tools)) return tools ? "[custom tools]" : null;
  return tools.map((tool) => tool?.function?.name || tool?.type || "tool");
}

function parseModelSpec(value) {
  const model = String(value ?? "").trim();
  const match = model.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/);
  if (!match) return { provider: "", model };

  const provider = normalizeProvider(match[1]);
  if (!KNOWN_PROVIDERS.has(provider)) return { provider: "", model };
  return { provider, model: match[2].trim() };
}

function normalizeProvider(value) {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "lightning-ai" || provider === "litai") return "lightning";
  if (provider === "open-router") return "openrouter";
  if (!provider) return "openrouter";
  return KNOWN_PROVIDERS.has(provider) ? provider : "openrouter";
}

function providerConfig(provider) {
  if (provider === "lightning") {
    return {
      label: "Lightning AI",
      baseUrl: process.env.LIGHTNING_API_BASE_URL || "https://lightning.ai/api/v1",
      apiKey: lightningApiKey(),
      apiKeyEnv: "LIGHTNING_API_KEY",
    };
  }

  if (provider === "custom") {
    return {
      label: process.env.MODEL_API_PROVIDER_NAME || "Custom OpenAI-compatible provider",
      baseUrl: process.env.MODEL_API_BASE_URL || "",
      apiKey: process.env.MODEL_API_BASE_URL && process.env.MODEL_API_KEY ? process.env.MODEL_API_KEY : "",
      apiKeyEnv: "MODEL_API_KEY and MODEL_API_BASE_URL",
    };
  }

  return {
    label: "OpenRouter",
    baseUrl: process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    apiKeyEnv: "OPENROUTER_API_KEY",
  };
}

function lightningApiKey() {
  const key = process.env.LIGHTNING_API_KEY || process.env.LITAI_API_KEY || "";
  const billingScope = String(process.env.LIGHTNING_BILLING_SCOPE || "").replace(/^\/+|\/+$/g, "");
  if (!key || !billingScope || key.includes("/")) return key;
  return `${key}/${billingScope}`;
}

function requestHeaders(runtime, title) {
  const headers = {
    Authorization: `Bearer ${runtime.api_key}`,
    "Content-Type": "application/json",
  };

  if (runtime.provider === "openrouter") {
    headers["X-Title"] = title;
    if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
  }

  return headers;
}

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    process.env[key] = stripEnvQuotes(match[2].trim());
  }
}

function stripEnvQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function redactForAudit(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactForAudit(item));
  if (!value || typeof value !== "object") return value;

  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveAuditKey(key)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redactForAudit(item);
    }
  }
  return redacted;
}

function isSensitiveAuditKey(key) {
  const normalized = String(key ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "authorization" ||
    normalized.includes("apikey") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    ["token", "accesstoken", "refreshtoken", "idtoken"].includes(normalized)
  );
}

function redactSensitiveText(value) {
  return String(value ?? "")
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[REDACTED_OPENROUTER_KEY]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:OPENROUTER|LIGHTNING|LITAI|MODEL)_API_KEY\s*=\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]");
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function absolutePath(value) {
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function displayPath(value) {
  if (!value) return "";
  const resolved = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
  return path.relative(process.cwd(), resolved) || ".";
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ""));
}

function slugPart(value, maxLength) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "item";
}

function auditWarning(message) {
  if (envFlag("MODEL_CALL_AUDIT_STRICT")) throw new Error(message);
  if (envFlag("MODEL_CALL_AUDIT_DEBUG")) console.warn(message);
}
