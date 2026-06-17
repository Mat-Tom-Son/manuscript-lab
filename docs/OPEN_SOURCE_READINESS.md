# Open Source Readiness

This file closes the gap between a surface packaging read and what the repo
actually contains.

## What A Surface Audit Sees

- Zero npm dependencies.
- Many npm scripts.
- A small CLI wrapper rather than a fully polished global install flow.
- Reusable harness and active project content sharing one working tree.
- Symlink-mounted project files.
- A large README and several detailed operator docs.
- Pi-specific files under `.pi/`.
- Project-specific work lives beside the reusable harness unless ignored.

Those observations are mostly correct, but incomplete.

## What The Repo Actually Has

The `.pi/` layer is not incidental. It is an agent workflow adapter with:

- long-form writing skill
- chapter production skill
- evaluation lab skill
- narrative taste skill
- story workspace skill
- slash-command prompts for compose, write, review, triage, candidates, compare,
  taste gate, merge, export, and done gate

The repo also has a mature durable-state model:

- section contracts
- runtime context packets
- typed review suites
- issue ledger
- revision plans
- candidate arena
- blind pairwise comparisons
- taste arbiter gate
- diff audit
- active/inactive project registry
- export and done gates

The right packaging question is therefore not only "template or npm package?"
It is also "how do we preserve the agent workflow layer without making the tool
feel locked to one agent UI?"

## Changes Made In The Clean Candidate

- Created a clean sibling repo named `manuscript-lab`.
- Copied reusable harness files only.
- Excluded active manuscripts, archives, exports, model logs, generated state,
  `.env`, and private project work.
- Renamed package metadata from `doc-repo-agent` to `manuscript-lab`.
- Added a small local wrapper: `manuscript-lab` / `mlab`.
- Chose MIT license.
- Added the active CI workflow and documented it in `docs/CI.md`.
- Added contribution, security, issue, and pull-request templates.
- Rewrote `README.md` as a quick public entry point.
- Added `docs/GETTING_STARTED.md`.
- Added `docs/ARCHITECTURE.md`.
- Added a repo-shipped Codex skill adapter under `skills/codex/`.
- Added active GitHub Actions CI under `.github/workflows/ci.yml`.
- Added protocol, install workflow, gate engine, and evidence spine design docs.
- Added `examples/technical-whitepaper/` as a public tutorial fixture.
- Added initial deterministic protocol validation, evidence-spine commands, and
  section/citation/manuscript gate commands.
- Added config-first `mlab init --profile whitepaper --root manuscript`.
- Added packlist assertions and an installed-tarball init/validate/evidence/gate
  smoke test under `npm test`.
- Added root-aware installed-mode support and tarball smoke coverage for
  `status`, `compose`, static `check`, `done:no-export`, `review:report`, and
  Markdown/HTML export from workspace, manuscript, and nested draft
  directories.
- Added `mlab report` / `npm run report` for text, JSON, and HTML readiness
  summaries across status, evidence, gates, review runs, revision trails, model
  calls, and exports.
- Added export manifests so every successful export has input/output hashes,
  file sizes, formats, source commit when available, git dirty state, and
  chapter metadata.
- Added configurable `mlab done` export requirements and installed-tarball
  smoke coverage for running the done gate with generated exports from
  workspace, manuscript, and nested draft directories.
- Guarded template-only project/workspace commands so installed-mode users do
  not accidentally create legacy `projects/` workspaces outside a template
  clone root.
- Added project-free version/doctor commands and temporary-prefix global install
  smoke coverage from a packed tarball.
- Made the technical-whitepaper fixture a config-first project so the demo can
  be inspected without mounting it as the active template project.
- Updated `.gitignore` so user writing work does not accidentally become public.

## Release Decisions

- Name: Manuscript Lab.
- Package/repo slug: `manuscript-lab`.
- License: MIT.
- First release shape: GitHub template-style public repo.
- npm publishing: intentionally disabled for now with `private: true` until
  registry/one-off `npx` behavior and migration are ready.
- User project files: ignored by default so the public repo contains the harness,
  not someone's manuscript.
- Product lane: local CI for prose, not an AI book generator. See
  `docs/PRODUCT_STRATEGY.md`.

## Strategy Fit

The product strategy fits the current GitHub repo. The v0.1 public repo already
has the core primitives: section contracts, runtime packets, typed reviews,
issue ledger, candidate revisions, comparison, taste gate, diff audit, model
routing, exports, done gate, optional agent adapters, and local diagnostics.

The main mismatch is packaging maturity. The repo is template-first with an
install-anywhere alpha; the deterministic local command loop, unified local
report, configurable export-oriented done gate, model/revision command surface,
and template-only command refusal now work in external writing repositories.
Migration, registry/one-off `npx` behavior, and any future installed
multi-project workflow are not yet stable as installed-package workflows.

## Remaining Gaps

### Before npm Publishing

- Implement migration for the draft protocol in `docs/FILE_PROTOCOL.md`.
- Broaden the gate engine from the initial deterministic gates into the full
  profile/override/export model described in `docs/GATE_ENGINE.md`.
- Broaden evidence commands from deterministic Markdown registers into richer
  claim/source records and issue integration from `docs/EVIDENCE_SPINE.md`.
- Better distinction between optional agent integrations and portable npm usage.
- Registry/one-off `npx` smokes once npm publishing is enabled.
- Decide whether installed multi-project switching should exist; current
  `project:*` and `story:*` commands are guarded as template-only compatibility.

### Nice To Have

- `manuscript-lab quickstart` for guided setup.
- A public docs site.
- A CI end-to-end test that runs the public tutorial fixture walkthrough.

## Current Release Path

1. Keep the GitHub repo template-friendly and contributor-safe.
2. Keep the technical-whitepaper fixture current as the public demo path.
3. Mature migration and registry/one-off `npx` smokes.
4. Keep npm publishing disabled until those smokes and the protocol migration
   story are boring.
