# Changelog

## Unreleased

- Added `mlab report` / `npm run report` for text, JSON, and HTML readiness
  summaries that combine status, evidence, gates, review runs, revision trails,
  model-call counts, exports, blockers, and suggested next steps.
- Added installed-mode smoke coverage for `report --json` and
  `report --write`, with generated reports staying under the configured
  manuscript root.
- Made the technical-whitepaper fixture config-first so it can be validated and
  reported in place without changing the active template project.
- Added `reports/` to private/generated path hygiene checks and package
  exclusions.

## 0.5.0 - 2026-06-16

- Added shared protocol path helpers for separating package assets, workspace
  roots, manuscript roots, configured state directories, and configured export
  directories.
- Made `status`, `compose`, `check`, `done:no-export`, `export --formats
  md,html`, and `review:report` work from packed install-anywhere workspaces.
- Split `doccheck` package assets from project files so installed workspaces no
  longer need copied `checks/`, `reviews/`, `.pi/`, docs, or templates.
- Added installed-tarball smoke coverage for running commands from the workspace
  root, manuscript root, and nested `draft/` directory.
- Added installed-mode export coverage that keeps generated runtime packets,
  `.doccheck` artifacts, and Markdown/HTML exports under the configured
  manuscript root instead of the package directory.

## 0.4.0 - 2026-06-16

- Added config-first `mlab init --profile whitepaper --root manuscript` for the
  install-anywhere alpha.
- Added a neutral whitepaper scaffold with `manuscript-lab.config.json`, section
  contracts, taste/style docs, source and claim registers, issue ledgers, and
  truth-state placeholders.
- Preserved legacy template init for bare `init`, `project:init`, and
  `story:init`.
- Added an installed-tarball smoke test that packs the package, installs it into
  a disposable npm project, initializes a workspace, and runs validate, claims,
  citations, and gate commands.
- Added a packlist assertion to keep private/generated project files out of
  package contents.

## 0.3.0 - 2026-06-16

- Added `mlab validate` / `npm run validate` for deterministic file-protocol
  discovery and validation across template-first and config-first workspaces.
- Added deterministic evidence commands for listing unsupported claims, checking
  citation markers, reporting evidence state, and adding local source records.
- Added `mlab gate` / `npm run gate` for initial section, citation, and
  manuscript readiness gates with optional JSON artifacts.
- Expanded CI fresh-project smoke coverage for validate, evidence, citations,
  and gate commands.

## 0.2.0 - 2026-06-16

- Added product strategy documentation for the "local CI for prose" direction.
- Added a Codex skill adapter, validator, and installer for Manuscript Lab shipping work.
- Added active GitHub Actions CI for tests, audits, smoke checks, and package dry-runs.
- Added draft protocol/install/gate/evidence design docs and the public technical whitepaper tutorial fixture.
- Fixed doctor ignore checks so fresh CI checkouts validate private/generated path rules correctly.

## 0.1.1

- Added `npm run doctor` and `manuscript-lab doctor` for environment and release-health diagnostics.
- Documented doctor in onboarding and CI guidance.
- Updated public-readiness notes now that the doctor gap is closed.

## 0.1.0

Initial public-ready release candidate.

- Extracted reusable writing harness from a live document workspace.
- Added runtime context packets, static and model-backed checks, typed reviews,
  issue-ledger revisions, candidate arenas, taste gates, diff audits, and
  exports.
- Added optional Pi skills and prompt commands.
- Added public onboarding, architecture, security, contribution, and release
  readiness docs.
- Added a lightweight `manuscript-lab` / `mlab` command wrapper.
- Documented the intended CI workflow for tests, audits, package dry-run, and a
  fresh project smoke test.
- Defaulted generated project files, drafts, exports, logs, and state to ignored
  paths so private writing work stays out of the harness repo.
