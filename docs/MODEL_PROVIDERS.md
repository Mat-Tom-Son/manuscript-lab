# Model Providers

> Status: pre-2.0 reference in the template-clone dialect (`npm run ...`). For the current install-anywhere command surface see [COMMANDS.md](COMMANDS.md).

The harness routes model calls through `scripts/lib/model-provider.mjs`.

The goal is to keep model use primitive-shaped:

```text
task -> model id -> provider runtime -> chat completion
```

No review, check, or audit script should talk directly to one vendor endpoint.

## Providers

Supported provider IDs:

- `openrouter`
- `lightning`
- `custom`

Credentials may live in `.env`. Model choices should not.

Keep swappable model choices in:

- `reviews/model-panels.json`
- package `reviews/suite.json` plus an optional project suite registered as
  `reviews.suite` in `manuscript-lab.config.json`
- `checks/suite.json`
- command flags such as `--models`, `--model`, and `DOCHECK_MODEL`
- task-specific config files added later

Unprefixed model IDs default to OpenRouter. Use prefixes for Lightning and custom providers unless a specific command flag explicitly sets the route.

You can route one model explicitly by prefixing it:

```text
lightning:lightning-ai/gpt-oss-20b
lightning:lightning-ai/gpt-oss-120b
openrouter:qwen/qwen3.7-plus
openrouter:z-ai/glm-5.2
custom:local-model-name
```

The prefix is removed before the request is sent to the provider.

## Environment

The provider layer loads `.env` from the repository root when present. Shell environment variables win over `.env` values.

Safe template:

```bash
cp .env.example .env
```

Lightning AI:

```bash
LIGHTNING_API_KEY=...
```

Optional granular billing scope:

```bash
LIGHTNING_BILLING_SCOPE=my-org/general
```

If the key does not already contain a slash-delimited billing suffix, the provider layer appends `LIGHTNING_BILLING_SCOPE` to the key for the request.

OpenRouter:

```bash
OPENROUTER_API_KEY=...
```

Custom OpenAI-compatible endpoint:

```bash
MODEL_API_BASE_URL=https://example.com/v1
MODEL_API_KEY=...
MODEL_API_PROVIDER_NAME=Local vLLM
```

## Smoke Test

Dry-run provider resolution:

```bash
npm run model:smoke -- --dry-run
```

Call a Lightning model:

```bash
npm run model:smoke -- --model lightning:lightning-ai/gpt-oss-20b
```

Call an OpenRouter model:

```bash
npm run model:smoke -- --model openrouter:openai/gpt-4.1-mini
```

## Reviews

Lightning panels are available in `reviews/model-panels.json`:

```bash
npm run review:run -- --dry-run --panel lightning.fast draft/<section>.md
npm run review:run -- --panel lightning.clean draft/<section>.md
npm run review:run -- --panel lightning.board draft/<section>.md
```

Lightning panels use provider-prefixed model IDs and are intentionally swappable:

- `lightning.fast` keeps a cheap broad workhorse: `lightning:lightning-ai/gpt-oss-120b`.
- `lightning.clean` favors cleaner structured output for verification and issue-ledger work, currently `lightning:lightning-ai/deepseek-v4-pro`, with GLM added for narrative taste.
- `lightning.board` is the broader taste/opinion panel. It uses `lightning:lightning-ai/glm-5` for taste and voice, DeepSeek for clean editorial structure, Nemotron for science/logic, and selected frontier routes such as Claude Opus or GPT-5.5 for high-value arbitration.

At the time of the latest smoke test, Lightning exposed `lightning-ai/glm-5` rather than an explicit `glm-5.2` model ID. The repo still supports OpenRouter GLM 5.2 as `openrouter:z-ai/glm-5.2`.

You can also override models directly:

```bash
npm run review:run -- --passes cold.reader --models lightning:lightning-ai/gpt-oss-120b draft/<section>.md
npm run review:run -- --passes narrative.taste --models lightning:lightning-ai/glm-5 draft/<section>.md
```

## Writers' Room

Room runs are deterministic unless `--models` is provided. Use provider-prefixed
IDs to cast independent roles across Lightning and OpenRouter:

```bash
npm run room -- diagnose draft/<section>.md
npm run room -- blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
npm run room -- blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus --roles story_engine,reader_advocate
npm run room -- table-read draft/<section>.md
npm run review:run -- --passes room.table_read --panel lightning.clean draft/<section>.md
npm run review:run -- --passes scene.turn --panel lightning.clean draft/<section>.md
```

`room diagnose` is deterministic and does not call a model. `room blue-sky`
records model/provider metadata in `role-casts.json` and per-role outputs under
`state/room/<section-id>/<run-id>/independent/`. The table-read command prepares
the packet; the optional `room.table_read` and `scene.turn` review passes use
the normal review/model-panel infrastructure and issue-ledger flow.

## Chorus

Chorus runs are local-seed/deterministic unless `--models` is provided. Use
provider-prefixed IDs to fan out short beat-level line candidates. A more
delicate model such as Claude Sonnet is a good first slot, with a cheaper
contrast model after it:

```bash
npm run chorus -- run draft/<section>.md --models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus
npm run chorus -- sample draft/<section>.md --run <chorus-run-id> --models openrouter:anthropic/claude-sonnet-4,openrouter:qwen/qwen3.7-plus
npm run chorus -- report draft/<section>.md
```

Model-backed sampling records candidate metadata under
`state/chorus/<section-id>/<run-id>/candidates/` and model-call audit entries
with `operation: chorus.sample`. The default workflow writes contact sheets and
does not modify `draft/`; pick/assemble remains explicit with `--assemble` or
`chorus assemble`.

## Practice Lab

Creative-writing practice commands use the same provider routing as reviews and
Chorus. OpenRouter GLM 5.2 is the default documented route for the current
practice lab:

```bash
npm run practice -- propose --exercise want-in-room --model openrouter:z-ai/glm-5.2
npm run practice -- compare --exercise want-in-room --model openrouter:z-ai/glm-5.2
npm run practice -- bench --exercises core --models openrouter:z-ai/glm-5.2 --seeds 3
npm run practice -- strategies --exercises core --models openrouter:z-ai/glm-5.2 --strategies default
```

`practice strategies` compares loop presets such as single-candidate,
multi-candidate selection, revision, and repair. It writes model-call audit
entries through the same provider layer and stores aggregate recommendations
under `state/practice-strategies/`.

Practice benchmark matrices are intentionally reliability-aware. A timeout,
provider rejection, malformed model response, or other per-row failure is stored
as a benchmark error row instead of aborting the whole run. Summaries and
reports expose both `evaluated_rows` and `error_rows`; interpret win rates over
evaluated rows, then separately decide whether the error rate makes a model
unsuitable for interactive driver loops. For unfamiliar OpenRouter models, start
with a small `practice strategies --strategies single --seeds 1` screen and tune
`MODEL_PROVIDER_TIMEOUT_MS` before widening the exercise/model matrix.

## Checks And Audits

Override check models:

```bash
DOCHECK_MODEL=lightning:lightning-ai/gpt-oss-120b npm run check:model -- draft/<section>.md
```

Run a model diff audit through Lightning:

```bash
npm run diff:audit -- --before before.md --after draft/<section>.md --model lightning:lightning-ai/gpt-oss-120b
```

Refresh style fingerprint through Lightning:

```bash
npm run style:fingerprint -- draft/<section>.md --model lightning:lightning-ai/gpt-oss-120b
```

Run a narrative taste arbiter through OpenRouter GLM 5.2:

```bash
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id> --models openrouter:z-ai/glm-5.2
```

Run the taste arbiter through Lightning GLM:

```bash
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id> --models lightning:lightning-ai/glm-5
```

## Structured JSON And Reasoning Models

Structured tasks pass `response_format: {"type":"json_object"}` through `scripts/lib/model-provider.mjs` when they call:

- `npm run review:run`
- `npm run check:model`
- `npm run revise:candidates`
- `npm run compare:candidates`
- `npm run taste:arbiter`
- `npm run diff:audit`
- `npm run style:fingerprint`

This follows provider JSON-mode guidance and works with OpenAI-compatible gateways that support `response_format`. If a gateway rejects a capability parameter, the provider layer retries with a smaller compatible feature set so the run can still proceed.

Reasoning-heavy models may expose separate thinking lanes, prepend planning text, emit `<think>...</think>` blocks, fence the JSON, add trailing commas, or include extra prose before the final object. The harness treats those as separate layers:

- `scripts/lib/model-provider.mjs` sends structured-output controls and extracts final output from `tool_calls[*].function.arguments` first, then `message.content`.
- Reasoning fields such as `reasoning_content`, `reasoning`, and `reasoning_details` are preserved in the raw/audit response but are not treated as structured output for JSON calls.
- Streaming or SDK-style chunks such as `choices[0].delta.content` are normalized alongside standard `choices[0].message.content`.
- `scripts/lib/model-json.mjs` normalizes model text before structured tools consume it. It prefers likely root objects over inner fragments and repairs common harmless issues such as trailing commas or truncated pattern-saturation arrays.

Provider defaults:

| Route | Structured default |
|---|---|
| `lightning:lightning-ai/glm-5` | JSON mode plus `thinking: {"type":"disabled"}`. Hidden reasoning may still appear in provider responses; the harness ignores it for structured parsing. |
| `openrouter:z-ai/glm-5.2` | JSON mode plus `reasoning: {"effort":"none","exclude":true}` and `provider.require_parameters: true`. |
| Other OpenRouter models | JSON mode when requested; `provider.require_parameters: true` when structured/reasoning/tool parameters are present. |
| Custom OpenAI-compatible endpoints | JSON mode when requested, with fallback if the endpoint rejects the parameter. |

Tool calling is not forced by default. Some model catalogs list tool capability broadly, but routed providers may reject specific combinations such as forced tools plus JSON mode plus reasoning controls. Callers can still pass tools explicitly. A generic structured-response tool is available as an opt-in experiment with `MODEL_PROVIDER_ENABLE_STRUCTURED_TOOLS=1`:

```json
{
  "response_format": { "type": "json_object" },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "submit_structured_response",
        "parameters": {
          "type": "object",
          "additionalProperties": true
        }
      }
    }
  ],
  "tool_choice": {
    "type": "function",
    "function": {
      "name": "submit_structured_response"
    }
  },
  "parallel_tool_calls": false
}
```

For OpenRouter strict schema mode, callers can pass `response_format: {"type":"json_schema", ...}` later; the provider layer will add `structured_outputs: true`. Current review/check schemas are prompt schemas, so the harness uses JSON object mode plus validation/normalization for now.

If a provider rejects any capability, the provider layer deliberately retries by removing unsupported feature groups: tools, `response_format`, thinking/reasoning controls, and Lightning token-parameter variants. A 200 response with separate reasoning is not a failure as long as the final answer lane contains parseable JSON.

If a structured call returns no final answer, has reasoning content, and ends with `finish_reason: "length"`, the provider treats that as a thinking-budget failure. GLM-style models retry with a large budget first, then step down only if the provider itself rejects or times out the request. Starving the completion before the final JSON defeats the point of using a thinking model. Override the retry sequence only when intentionally testing with `MODEL_PROVIDER_STRUCTURED_REASONING_RETRY_TOKENS`, for example `65536,32768,24000`.

Cheap JSON-mode smoke test:

```bash
npm run model:smoke -- --model lightning:lightning-ai/glm-5 --json-mode --prompt '{"ok": true, "note": "Return this shape with a short note."}'
npm run model:smoke -- --model openrouter:z-ai/glm-5.2 --json-mode --prompt '{"ok": true, "note": "Return this shape with a short note."}'
```

Model IDs stay in panels, suites, or command flags. Do not put model choices in `.env`.

## Call Provenance

Current model-call artifacts are decentralized:

- typed reviews save run JSON/Markdown under `state/reviews/`
- model checks save chronological runs under `.doccheck/runs/` and cache hits under `.doccheck/cache/`
- candidate arenas save candidate and comparison artifacts under `state/candidates/`
- diff audits save before/after reports under `state/revision-audits/`
- style fingerprinting saves the generated fingerprint under `style/`

These records include model/provider metadata and model responses. Set `MODEL_CALL_AUDIT=1` to also preserve immutable prompt/response snapshots under `projects/active/<slug>/logs/model-calls/`, implemented centrally inside `scripts/lib/model-provider.mjs`. Use `npm run model:calls` to inspect the ledger. See `docs/MODEL_CALL_AUDIT.md`.

## Capability Inspection

Use `npm run model:capabilities` before swapping in unfamiliar models:

```bash
npm run model:capabilities -- lightning:lightning-ai/glm-5
npm run model:capabilities -- openrouter:z-ai/glm-5.2
npm run model:capabilities -- --provider openrouter --search nemotron --limit 10
```

OpenRouter's `/models` feed includes supported parameters such as `response_format`, `reasoning`, `tools`, and `structured_outputs`. Lightning's authenticated `/api/v1/models` endpoint currently exposes IDs, context length, max-token metadata, pricing, provider, and modalities, but not the same supported-parameter list. Use a small `npm run model:smoke -- --json-mode` call to verify a new provider/model/parameter combination before relying on it for reviews.

## Lightning SDK Notes

Lightning documents both the Python `litai` SDK and OpenAI-compatible Model APIs. The harness uses Lightning's OpenAI-compatible API endpoint by default so the Node scripts stay dependency-free while still spending Lightning credits and preserving the same chat-completion primitive used by other providers.

The official `litai` SDK is useful as a reference implementation and supports tools, fallbacks, retries, memory, streaming, and `full_response=True`. In full-response or streaming paths, results may arrive in OpenAI chunk shape such as `choices[0].delta.content`; `scripts/lib/model-provider.mjs` normalizes both `choices[0].message` and `choices[0].delta` so future SDK-backed or streaming adapters do not lose valid final output.

References:

- Lightning Model APIs: <https://lightning.ai/docs/overview/model-apis>
- Lightning LitAI tools: <https://lightning.ai/docs/litai/features/tools>
- Lightning LitAI streaming/full response: <https://lightning.ai/docs/litai/features/streaming>
- OpenRouter GLM 5.2: <https://openrouter.ai/z-ai/glm-5.2/api>
- OpenRouter parameters: <https://www.openrouter.ai/docs/api/reference/parameters>
