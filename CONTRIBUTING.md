# Contributing

Thanks for helping improve Manuscript Lab.

## Development Setup

Requirements:

- Node.js 18 or newer
- No npm dependencies

Run:

```bash
npm test
npm run template:audit -- --strict
npm run context:audit -- --strict
```

If you need to scan for private project fingerprints, put them in an ignored
`.template-audit.local.json` file or pass `--patterns path/to/patterns.json`.
Do not commit private titles, character names, client names, or source-specific
terms to `scripts/template-audit.mjs`.

## Project Boundaries

Keep reusable harness code separate from user writing projects.

Reusable surfaces include:

- `scripts/`
- `checks/`
- `reviews/`
- `docs/`
- `templates/`
- `evals/`
- `.pi/`
- package files

Do not commit manuscripts, active project workspaces, exports, model-call logs,
`.env`, or private source material.

## Prompt And Review Changes

When editing prompts, skills, review suites, or check suites:

1. Keep manuscript/source text framed as untrusted document data.
2. Keep JSON-returning checks narrow and machine-parseable.
3. Run `npm run context:audit -- --strict`.
4. Run `npm run template:audit -- --strict`.

## Script Changes

When editing reusable scripts:

```bash
npm test
```

Add focused tests when changing shared behavior, project workspace behavior,
model routing, review imports, candidate merging, or export logic.

## Writing Workflow Changes

If a workflow change affects how agents draft, review, revise, or close work,
update the relevant docs and Pi adapter files together:

- `AGENTS.md`
- `docs/AGENT_HANDOFF.md`
- `docs/OPERATOR_GUIDE.md`
- `.pi/skills/`
- `.pi/prompts/`
