# Open Source Readiness

This file closes the gap between a surface packaging read and what the repo
actually contains.

## What A Surface Audit Sees

- Zero npm dependencies.
- Many npm scripts.
- No traditional CLI entry point.
- Reusable harness and active project content sharing one working tree.
- Symlink-mounted project files.
- A large README and several detailed operator docs.
- Pi-specific files under `.pi/`.
- Missing license and public contribution policy.

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
- Rewrote `README.md` as a quick public entry point.
- Added `docs/GETTING_STARTED.md`.
- Added `docs/ARCHITECTURE.md`.
- Updated `.gitignore` so user writing work does not accidentally become public.

## Remaining Release Gaps

### Must Decide

- Final project name.
- License.
- Whether this is primarily a template repo, an npm package, or both.
- Whether user project files should be ignored by default or tracked in a
  generated project repo.

### Must Build Or Polish

- A true `init` command for installing the harness into an arbitrary folder.
- Public sample project or tutorial fixture.
- CI workflow for tests and template/context audits.
- Security note for prompt-injection boundaries and secret handling.
- Contribution guide.
- Code of conduct, if desired.
- Changelog/release process.
- Better distinction between optional Pi integration and portable npm usage.

### Nice To Have

- `manuscript-lab doctor` for environment checks.
- `manuscript-lab quickstart` for guided setup.
- A public docs site.
- A fixture-based end-to-end test that initializes a project, composes context,
  checks it, exports it, and passes `done:no-export`.

## Suggested Release Path

1. Keep this as a template repo for the first public release.
2. Add one polished tutorial project fixture.
3. Add CI for `npm test`, `template:audit`, and `context:audit`.
4. Choose license and final name.
5. Publish as a GitHub template.
6. Only then invest in an installable npm package that can initialize arbitrary
   external workspaces.

