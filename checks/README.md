# Model-Backed Checks

`checks/suite.json` defines semantic checks that `scripts/doccheck.mjs` can run through the configured model provider.

Each check is intentionally narrow:

- It declares explicit input files.
- It uses a prompt from `checks/prompts/`.
- It requires a JSON response shape.
- It has a programmatic assertion.
- It has a severity: `blocking`, `warning`, or `advisory`.

The model is not the final judge. It returns structured evidence; `doccheck` validates the response and decides pass/fail.

Severity behavior:

- `blocking`: failed findings fail the run.
- `warning`: failed findings warn by default and fail only with `--strict`.
- `advisory`: failed findings are recorded as notes and never fail the run.

Run model-backed checks:

```bash
OPENROUTER_API_KEY=... npm run check:model
LIGHTNING_API_KEY=... DOCHECK_MODEL=lightning:lightning-ai/gpt-oss-120b npm run check:model
```

Run one section:

```bash
OPENROUTER_API_KEY=... npm run check:model -- draft/01-introduction.md
LIGHTNING_API_KEY=... DOCHECK_MODEL=lightning:lightning-ai/gpt-oss-120b npm run check:model -- draft/01-introduction.md
```

Useful development flags:

```bash
node scripts/doccheck.mjs --list-model-checks
node scripts/doccheck.mjs --model-checks --no-cache
node scripts/doccheck.mjs --model-checks --model provider/model
node scripts/doccheck.mjs --model-checks --strict
node scripts/doccheck.mjs --model-checks --json
```

`DOCHECK_MODEL=provider/model` also overrides every configured model for a run. Prefix a model with `lightning:` or `openrouter:` to route it explicitly, for example `DOCHECK_MODEL=lightning:lightning-ai/gpt-oss-120b`. This is useful for model shootouts: keep the suite stable, run the same section through different reviewers, then compare the structured JSON in `.doccheck/runs/`.

See `docs/MODEL_PROVIDERS.md` for provider setup and `.env` support.

Cached results live in `.doccheck/cache/`. If an unchanged section has a cached result, `doccheck --model-checks` can replay it without an API key. Add `--no-cache` when you want a fresh provider call.

Supported assertion types:

- `empty_array` / `no_issues`: pass when the configured array path is empty.
- `pass_true`: pass when `pass` is exactly `true`.
- `max_array_length`: pass when an array path length is below `max` or `threshold`.
- `score_at_least`: pass when a numeric path is at least `threshold`.
