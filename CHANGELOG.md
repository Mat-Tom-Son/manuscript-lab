# Changelog

## Unreleased

- Added product strategy documentation for the "local CI for prose" direction.
- Added a Codex skill adapter, validator, and installer for Manuscript Lab shipping work.
- Added active GitHub Actions CI for tests, audits, smoke checks, and package dry-runs.
- Added draft protocol/install/gate/evidence design docs and the public technical whitepaper tutorial fixture.

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
