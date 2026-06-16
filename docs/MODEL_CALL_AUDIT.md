# Model Call Audit Trail

This document explains the project-local model-call audit trail and what remains to make model comparison rigorous.

## Current Coverage

The harness saves useful artifacts in each primitive and can also write a unified project-local ledger when capture is enabled:

```bash
MODEL_CALL_AUDIT=1 npm run review:run -- --panel prose.clean draft/<section>.md
npm run model:calls
npm run model:calls -- --group model
```

The ledger lives with the active project:

```text
projects/active/<slug>/logs/model-calls/
  ledger.jsonl
  calls/<call-id>/
    request.json
    prompt.md
    response.json
    response.txt
    provider-response.txt
    metadata.json
```

`scripts/lib/model-provider.mjs` owns the capture path, so every `callChatModel` caller can use the same format.

Project sync preserves this canonical project-local log folder. The `state/model-calls/` path is only a compatibility mirror; it must not overwrite existing `projects/active/<slug>/logs/model-calls/` artifacts during `npm run project:sync` or the done gate.

| Primitive | Current saved evidence | Gap |
|---|---|---|
| `npm run review:run` | `state/reviews/<section>/runs/*.json` includes pass, target, model, provider, resolved model, context manifest with visible file hashes, attempts, parsed/normalized output, raw model output, imported issue IDs, markdown report, and `model_call_id` when audit capture is enabled. | Usage/cost depends on what the provider returns. |
| `npm run check:model` | `.doccheck/cache/<hash>.json` stores check result, raw output, model/provider/resolved model, cache key, parsed output, pass/fail, and `model_call_id` for uncached audited calls. | Cached hits replay prior results and do not create new provider calls. |
| `npm run revise:candidates` | `state/candidates/<section>/<run>/` stores base file, issue context, criteria, rule stack, candidate metadata, raw model output per candidate, candidate Markdown, and `model_call_id` when audited. | Candidate artifacts keep their own raw outputs; exact prompt replay uses the project-local ledger. |
| `npm run compare:candidates` | Candidate comparison directories store pairwise decisions, order-swapped outputs, raw model output files, judge model/provider/resolved model, decision summaries, and `model_call_id` when audited. | Usage/cost depends on provider support. |
| `npm run taste:arbiter` | Candidate run directories store taste disposition, synthesized gate, model/provider/resolved model, taste context hashes, model call IDs, and a Markdown arbiter report. | Exemplar promotion is still a human/project decision. |
| `npm run diff:audit` | `state/revision-audits/<section>/` stores static diff metrics, model/provider/resolved model when used, raw output, parsed audit, markdown report, and `model_call_id` when audited. | Static-only runs do not call a provider. |
| `npm run style:fingerprint` | `style/voice-fingerprint.json` stores generated fingerprint, model/provider/resolved model, source files, and `model_call_id` when audited. | The fingerprint file is not a chronological call ledger by itself. |
| `npm run model:smoke` and `npm run review:model` | Smoke prints output/usage/call ID when audited; simple model review writes model metadata and Markdown review. | Use `npm run model:calls` for cross-call summaries. |

## Captured Fields

When a project is archived or restored, these logs travel with that project under `projects/inactive/<slug>/logs/` and its snapshots.

Each call should record:

- call ID, timestamp, operation, script, target file, section ID, run ID
- provider, configured model ID, resolved model ID, base URL label, not the API key
- temperature, max tokens, retry/variant count, timeout/error state
- exact system message and user prompt sent to the provider
- context manifest with file paths and hashes
- raw provider JSON response and extracted assistant text
- token usage when the provider returns it
- parse/normalization status
- artifact paths created from the response

## Caller Metadata

Callers can pass an optional `audit` object to `callChatModel`.

```js
await callChatModel({
  model,
  title: "manuscript-lab review runner",
  system,
  content,
  audit: {
    operation: "review.run",
    target: "draft/01-opening.md",
    section_id: "01-opening",
    run_id,
    pass_id: "cold.reader",
    context_manifest: context.manifest,
  },
});
```

Enable full prompt/response capture with:

```bash
MODEL_CALL_AUDIT=1
```

Default behavior remains lightweight. When disabled, existing artifacts continue to work and no exact prompt ledger is written.

Secrets and dangerous headers are redacted.

Custom `MODEL_CALL_AUDIT_DIR` values must resolve under ignored/private paths,
known generated project paths, or the system temp directory. This prevents exact
prompt/response capture from accidentally landing in tracked public files. Use
`MODEL_CALL_AUDIT_ALLOW_UNSAFE_DIR=1` only for a deliberately reviewed
destination.

Never write API keys or Authorization headers. Store provider label, provider ID, resolved model, and base URL only.

The provider wrapper stores the prompt before the provider call and the final response after the call in the active project's `logs/model-calls/` folder.

This makes failed calls auditable too.

Useful first reports:

```bash
npm run model:calls -- --since 2026-06-01
npm run model:calls -- --operation review.run --group model
npm run model:calls -- --target draft/01-opening.md
```

Review runs, candidate metadata, comparisons, taste arbiters, model checks, style fingerprints, and diff audits include `model_call_id` when audit capture is enabled, so results can be traced back to the exact request/response pair.

## Why This Matters

This turns the harness from "we used a model and saved the result" into "we can compare model behavior across the same task shape." That enables:

- model-by-task performance analysis
- prompt regression analysis
- cost and token tracking
- replay/debugging of weird outputs
- calibration datasets for future judge/reviewer selection

## Open Design Choices

- Whether full prompt capture should be on by default for local-only repos.
- How aggressively to compact large prompts in summary reports while preserving exact files on disk.
- Whether to include model-call audit in `npm run done` as an optional warning.
- Whether to add cost estimation tables for providers that return only token usage.
