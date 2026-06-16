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
- Updated `.gitignore` so user writing work does not accidentally become public.

## Release Decisions

- Name: Manuscript Lab.
- Package/repo slug: `manuscript-lab`.
- License: MIT.
- First release shape: GitHub template-style public repo.
- npm publishing: intentionally disabled for now with `private: true` until the
  broader installed-package command surface is config-root aware.
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
install-anywhere alpha; the target product should also manage a Manuscript Lab
project inside an arbitrary writing repository across the full command surface.

## Remaining Gaps

### Before npm Publishing

- Make `doctor`, `status`, `compose`, `check`, `done`, `export`, and review
  commands fully config-root aware in installed-package mode.
- Implement migration for the draft protocol in `docs/FILE_PROTOCOL.md`.
- Broaden the gate engine from the initial deterministic gates into the full
  profile/override/export model described in `docs/GATE_ENGINE.md`.
- Broaden evidence commands from deterministic Markdown registers into richer
  claim/source records and issue integration from `docs/EVIDENCE_SPINE.md`.
- Better distinction between optional agent integrations and portable npm usage.
- One-off `npx` and global-install smokes once npm publishing is enabled.

### Nice To Have

- `manuscript-lab quickstart` for guided setup.
- A public docs site.
- A CI end-to-end test that runs the public tutorial fixture walkthrough.

## Suggested Release Path

1. Publish the clean repo on GitHub.
2. Keep it template-first for the first public release.
3. Keep the tutorial fixture current as the public demo path.
4. Mature the install-anywhere alpha until the full command surface works in
   arbitrary external workspaces.
