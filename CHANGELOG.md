# Changelog

## 1.0.2 - 2026-06-17

- Aligned public release docs with the published npm package and GitHub release:
  added npm/GitHub/CI badges, deleted the old v1 branch plan, and removed stale
  pre-publish language from install docs.

## 1.0.1 - 2026-06-17

- Fixed project-free `mlab doctor --no-network` so public one-off registry
  smokes in blank directories report missing project/git context as diagnostics
  instead of failing the command before `mlab init`.

## 1.0.0 - 2026-06-17

- Removed migration from the v1/npm-publishing path; v1 now assumes fresh
  config-first installed projects while preserving template-clone compatibility.
- Added v1 release scope notes, stronger config validation, project-free validation
  hints, project-local install smoke coverage, and local one-off `npm exec`
  package smoke coverage.
- Added public CLI aliases for review, revision, comparison, merge, and audit
  workflows while preserving compatibility command names.
- Added deterministic `export-ready` gate templates and broadened
  `manuscript-ready` / `done:no-export` gate integration with persisted gate
  artifacts and final project filesystem sync.
- Broadened evidence reporting with richer claim/source normalization,
  risk/status-aware issue output, citation resolution, source validation, and
  `claims list` filters.
- Added a deterministic broken-whitepaper fixture for demonstrating useful
  not-ready output without model or network calls.
- Excluded generated example `.doccheck` artifacts from package contents and
  extended packlist coverage.

## 0.9.0 - 2026-06-17

- Tightened public contributor guidance with the full verification gate,
  package-boundary checks, current install-anywhere examples, and `done`
  export-format command documentation.
- Added `mlab version` / `mlab --version`, project-free
  `mlab doctor --no-project`, and packed-tarball temporary-prefix global install
  smoke coverage for help/version/doctor/init/validate/gate/refusal behavior.

## 0.8.0 - 2026-06-17

- Made `mlab review:run` root-aware in packed install-anywhere workspaces,
  loading bundled review suites, model panels, and prompts from the package
  while writing review artifacts and issue-ledger updates under the configured
  manuscript root.
- Added installed-tarball smoke coverage for `review:run --dry-run` from the
  workspace root, manuscript root, and nested `draft/` directory, plus a
  non-network mocked review run that saves artifacts and imports ledger issues.
- Made model-backed revision commands root-aware in install-anywhere workspaces:
  `revise:candidates`, `compare:candidates`, `taste:arbiter`, and `diff:audit`
  now load workspace/project `.env` files before provider setup and default
  model-call audit ledgers to the configured manuscript root.
- Added non-network installed-tarball smoke coverage for the model-shaped
  revision chain: candidate generation, comparison, taste gate, and diff audit
  from a nested `draft/` directory.
- Made `mlab done` configurable for install-anywhere release gates with
  `--export-formats`, `--export-slug`, `--export-out`, and
  `--include-todo-exports`, while keeping the default reader-export expectation
  at Markdown, HTML, EPUB, and PDF.
- Added installed-tarball smoke coverage for running full `done` with
  Markdown/HTML exports from the workspace root, manuscript root, and nested
  `draft/` directory.
- Guarded template-only wrapper commands (`init` without `--profile`,
  `project:*`, `story:*`, and related aliases) so they refuse outside the
  template clone root instead of creating confusing legacy project workspaces in
  install-anywhere repositories.

## 0.7.1 - 2026-06-17

- Loaded local `.env` values in `mlab doctor` so provider-key diagnostics match
  model-backed command behavior without printing secret values.
- Made `mlab model:calls` and `mlab report` honor `MODEL_CALL_AUDIT_DIR` when
  inspecting model-call ledgers from calibration or external workspaces.

## 0.7.0 - 2026-06-17

- Sharpened the README demo payoff with a concrete report excerpt and an
  inspection trail for the technical-whitepaper fixture.
- Made `mlab issues`, `mlab revise:candidates --dry-run`,
  `mlab compare:candidates --dry-run`, `mlab taste:arbiter --dry-run`, and
  `mlab merge:winner` root-aware in packed install-anywhere workspaces, with
  smoke coverage from the workspace root, manuscript root, and nested `draft/`
  directory.
- Added packed install smoke coverage for `merge:winner --apply --audit
  --static-only`, keeping candidate and revision-audit artifacts under the
  configured manuscript root.

## 0.6.0 - 2026-06-16

- Added `exports/manifest.json` generation to `mlab export` / `npm run export`,
  including export ID, source commit when available, input hashes, output
  hashes, file sizes, formats, git dirty state, and chapter metadata.
- Added installed-mode smoke coverage to ensure export manifests stay under the
  configured manuscript root and appear in `mlab report`.
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

Initial public-ready release checkpoint.

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
