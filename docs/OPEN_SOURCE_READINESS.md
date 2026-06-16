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
- Documented the intended CI workflow in `docs/CI.md`.
- Added contribution, security, issue, and pull-request templates.
- Rewrote `README.md` as a quick public entry point.
- Added `docs/GETTING_STARTED.md`.
- Added `docs/ARCHITECTURE.md`.
- Added a repo-shipped Codex skill adapter under `skills/codex/`.
- Added protocol, install workflow, gate engine, and evidence spine design docs.
- Added `examples/technical-whitepaper/` as a public tutorial fixture.
- Updated `.gitignore` so user writing work does not accidentally become public.

## Release Decisions

- Name: Manuscript Lab.
- Package/repo slug: `manuscript-lab`.
- License: MIT.
- First release shape: GitHub template-style public repo.
- npm publishing: intentionally disabled for now with `private: true` until the
  installed-package workflow can initialize or locate a full harness cleanly.
- User project files: ignored by default so the public repo contains the harness,
  not someone's manuscript.
- Product lane: local CI for prose, not an AI book generator. See
  `docs/PRODUCT_STRATEGY.md`.

## Strategy Fit

The product strategy fits the current GitHub repo. The v0.1 public repo already
has the core primitives: section contracts, runtime packets, typed reviews,
issue ledger, candidate revisions, comparison, taste gate, diff audit, model
routing, exports, done gate, optional agent adapters, and local diagnostics.

The main mismatch is packaging maturity. Today the repo is template-first; the
target product should also work as an install-anywhere CLI that can initialize
or manage a Manuscript Lab project inside an arbitrary writing repository.

## Remaining Gaps

### Before npm Publishing

- Implement the install-anywhere `init` command described in
  `docs/INSTALL_WORKFLOW.md`.
- Implement protocol validation/migration for the draft protocol in
  `docs/FILE_PROTOCOL.md`.
- Implement the gate engine described in `docs/GATE_ENGINE.md`.
- Implement claim/source commands from `docs/EVIDENCE_SPINE.md`.
- Active GitHub Actions CI once a GitHub token with `workflow` scope is used.
- Better distinction between optional agent integrations and portable npm usage.
- Installed-package end-to-end test once npm publishing is enabled.

### Nice To Have

- `manuscript-lab quickstart` for guided setup.
- A public docs site.
- A CI end-to-end test that runs the public tutorial fixture walkthrough.

## Suggested Release Path

1. Publish the clean repo on GitHub.
2. Keep it template-first for the first public release.
3. Keep the tutorial fixture current as the public demo path.
4. Only then invest in an installable npm package that can initialize arbitrary
   external workspaces.
