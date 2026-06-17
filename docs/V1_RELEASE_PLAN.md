# V1 Release Plan

Status: active branch plan for `codex/v1-release`.

## Scope

V1 makes Manuscript Lab a fresh-start, install-anywhere CLI for serious
long-form writing projects.

The release promise:

- initialize a config-first project in any repository
- validate the file protocol deterministically
- run checks, evidence commands, typed reviews, issues, candidate revisions, and
  gates from the configured project root
- produce reader exports with provenance
- support CI-friendly `npx mlab` workflows
- keep template-clone usage as a compatibility path

## Non-Goals

- No migration command for v1.
- No desktop app.
- No autonomous book generator.
- No network-dependent default checks.
- No custom publishing/typesetting stack beyond current export support.

## Workstreams

### Install And Protocol

Finish the public install proof: registry/one-off `npx` behavior, project-local
dependency smoke, stable config validation, clear no-project failures, and
path/unknown-key coverage.

### Gate Engine

Broaden deterministic gates into the shared readiness layer: section,
manuscript, citation, and export readiness with stable requirement IDs, JSON
artifacts, latest pointers, and done-gate alignment.

### Evidence Spine

Strengthen claims, sources, and citation readiness while remaining compatible
with the current Markdown registers. Evidence commands must not invent sources
or fetch network data unless explicitly requested.

### Public CLI And Demo

Make the CLI feel coherent by adding friendly aliases around the existing
workflow, improving help text, and shipping a demo fixture that shows a useful
broken-to-ready path without model or network dependencies.

## Integration Rules

- Keep worker write scopes disjoint where possible.
- Do not stage or commit worker changes before lead review.
- Prefer deterministic tests before model-backed checks.
- Preserve template mode unless deliberately replacing it with an equivalent
  compatibility path.
- Update docs and changelog for user-visible command, protocol, gate, evidence,
  packaging, or demo changes.

## V1 Readiness Gates

Before calling the branch v1-ready, run:

```bash
npm test
npm run template:audit -- --strict
npm run context:audit -- --strict
npm run doctor -- --no-network
npm pack --dry-run
```

For release-candidate verification, also run the public install smoke that
matches the documented `npx mlab` path.
