# Changelog

## Unreleased

- Fixed the adopt funnel: `mlab adopt` no longer writes `TODO` purpose and
  acceptance markers that its own gates then flag. Imported contracts get a
  provisional purpose inferred from the first prose sentence, the profile's
  default acceptance criteria, and a new `confirmed: false` field. A new
  section requirement, `contract.confirmed`, blocks only on an explicit
  `confirmed: false` and its report blocker names the file to review; existing
  contracts without the field are unaffected. `mlab adopt` with no source now
  adopts the current directory (mirroring bare `init`), and the success output
  explains the confirm step.
- Made the placeholder check tell marker forms apart from prose that merely
  mentions the words: `TODO:`/`[TBD]`/line-initial markers and bare `TBD`
  still fail, but "the section that still says TODO in a shipped draft" no
  longer does, and code spans/fences are ignored. Any TODO/TBD/FIXME inside a
  section contract comment is still flagged, with a message that points at the
  contract header. One shared implementation now backs both `mlab check` and
  the gate engine (`scripts/lib/section-contract.mjs#placeholderFindings`).
- Made section contracts the single source of truth for status: `mlab check
  --fix` now syncs `state/status.md` and `outline.md` statuses from the
  contracts (`scripts/lib/status-sync.mjs`), mismatch failures hint at it, and
  the report's `status.synced` blocker fix is `mlab check --fix` instead of a
  manual edit.
- Made `mlab export` gate-aware: it evaluates the manuscript gate first,
  prints a loud draft-export warning (with the failing requirement ids) when
  the gate fails, records `readiness` in `exports/manifest.json` and in
  `--json` output, sets `gate_enforced` honestly, and refuses under the new
  `--require-ready` flag. Added `scripts/export.test.mjs` — the export path
  was previously untested.
- Bare `mlab gate` now evaluates the manuscript gate instead of erroring, and
  gate error output no longer prints the literal header `ERROR unknown
  unknown`.
- Added `mlab issues add --target <path> --note "..."` (`--category`,
  `--severity`, `--quote`, `--why`, `--fix`) so human editors can file issues
  into the ledger directly; manual issues share the model-review record shape
  (`source.type: "manual"`). Added `scripts/issue-ledger.test.mjs`.
- Unified the guidance layer on one vocabulary per mode: installed-mode
  `status`/`report`/`done`/`compose`/`issues` output no longer leaks `npm run
  ...`, `/doc-write`, or `node scripts/...` forms; `issues --help` and the
  export/gate/status help texts now speak `mlab`.
- Stopped advertising labs to fresh projects: `mlab status` shows Room,
  Chorus, and Generated Artifacts blocks (now labeled "(lab)") only when runs
  exist, and the "run a driver dry-run" recommendation no longer fires on
  projects with no driver runs. Lab discovery lives in `mlab lab --help`.
- Made modelless lab runs label themselves: `mlab lab room blue-sky` and
  `mlab lab chorus run` without `--models` now print "(scaffold run)" with a
  deterministic-seed explanation, stamp a scaffold banner into
  `ROOM_REPORT.md` / `CHORUS_REPORT.md`, and expose `model_backed` in their
  JSON output.
- Rewrote `AGENTS.md` for the workspaces `mlab init`/`mlab adopt` actually
  create (mlab verbs, `manuscript/` root, the confirm step, `issues add`,
  gate-aware export), with the template-clone `npm run` dialect moved to a
  maintainer appendix.
- Retold the npm storefront story: `package.json` description now leads with
  "local CI for prose" (contracts, checks, reviews, ledger, evidence spine,
  gates, MCP) and the keywords drop `writing-agent`/`evaluation-lab` for
  `ci`, `gates`, `evidence`, `prose-lint`, `docs-as-code`, `mcp`.
- Bannered the pre-2.0 doc stratum (`docs/AGENT_HANDOFF.md`,
  `docs/PRIMITIVES.md`, `docs/MODEL_DRIVER.md`, and twelve more) with a
  status note pointing at `docs/COMMANDS.md`; updated `docs/MCP.md` lab tool
  names to `mlab lab ...` forms and the stale `claims.no_placeholders` id in
  `docs/GATE_ENGINE.md`; refreshed `docs/COMMANDS.md` and `README.md` for the
  behaviors above.
- Added the first inward case study (`docs/CASE_STUDY_HARNESS_VS_DIRECT.md`)
  with full evidence under `evals/case-studies/2026-07-harness-vs-direct/`:
  same-model comparison of the mlab loop against a direct pass and a
  self-revision control on a real four-section document. The mlab loop was
  the only arm to produce four gate-ready sections (direct: one of four);
  blind preference leaned to the harness inside judge noise; a "Does It Work"
  section in `README.md` and a promotion-criterion note in
  `docs/PRODUCT_STRATEGY.md` reference the study.

## 2.0.0 - 2026-07-14

- Added `mlab adopt <file-or-dir>` as the front door for existing manuscripts:
  it bootstraps a config-first workspace and imports markdown into contracted
  `draft/NN-slug.md` sections (`--split file|h1|h2`, `--dry-run`, `--json`)
  without modifying or moving source files.
- Added `mlab mcp`, a zero-dependency MCP server over stdio that exposes the
  command surface as typed tools with safety annotations and `--read-only` /
  `--all-tools` / `--root` exposure flags, documented in `docs/MCP.md`.
- Added the `mlab lab` namespace grouping R&D commands (`room`, `chorus`,
  `practice`, `drive`, `eval`, `artifacts`, `golden-path`, `taste`, `style`,
  `words`, `model`) behind one entry point with `mlab lab --help`.
- Added `mlab check --fix` to create every missing required scaffolding path
  (state directories, README stubs, `state/truth/*.json`) idempotently before
  re-running static checks; plain `check` failures now hint at `--fix` when
  missing scaffolding is the cause.
- Added a `fix` command to every report blocker: JSON blockers gain a `fix`
  field, terminal blockers print a `fix:` line, and the HTML report gains a
  FIX column, with failing sections listed individually with their reasons.
- Added a composite GitHub Action (`action.yml`) for running Manuscript Lab
  reports in CI, documented in `docs/CI.md`.
- Added a green end state to the `examples/technical-whitepaper` fixture and a
  fixtures CI job that guards both the green fixture and the deliberately red
  `examples/broken-whitepaper` blocker demo.
- Added grouped `mlab` help (one line per command across six groups), `mlab
  help <command>` forwarding, `mlab help admin` for template-clone commands,
  and `docs/COMMANDS.md` as the full command reference.
- Added bare `mlab init` defaults outside template clones: profile
  `whitepaper`, root `manuscript`, and a title cased from the directory name,
  printed with customization hints instead of erroring.
- Changed `mlab validate` to treat low prose counts on started sections as a
  warning instead of an error: structural validation stays in `validate`, and
  writing progress is enforced by the `words.floor` gate requirement, so
  `adopt` and early drafting no longer fail protocol validation.
- Changed section-ready gate semantics to be stricter: sections whose contract
  status is `todo` or `planned` now fail the blocking `contract.status_started`
  requirement, prose below 33% of `target_words` fails the blocking
  `words.floor` requirement (contract `min_words` or the config
  `gates.section.words_floor_ratio` override the floor), and prose below 80%
  of target warns via `words.near_target`.
- Changed citation requirement ids to the `evidence.*` namespace (ten
  requirements across `evidence.claims.*`, `evidence.citations.*`, and
  `evidence.sources.*`) shared by `claims`, `citations check`, `evidence
  report`, and the citation gate. Migration: consumers parsing gate or
  evidence JSON must switch from the old `claims.*`/`sources.*` requirement
  ids to the `evidence.*` ids.
- Changed unsupported-claim severity to be risk-aware: claims with explicit
  `low` or `medium` risk now warn instead of block in citation checks and
  gates, while `high`, `critical`, and unspecified risk still block.
- Changed missing local source files to block `mlab citations check` and
  `mlab evidence report` as well as the citation gate (at 1.5.x only the gate
  blocked): a path-like `sources/index.md` location that does not resolve to a
  local file fails `evidence.sources.manifest_valid`. Prose-y descriptive
  locations (containing whitespace) and URL/`n/a`-style locations still only
  warn.
- Changed `mlab report` to compute section and citation readiness through the
  same in-process gate engine as `mlab gate`, eliminating pass-vs-fail
  contradictions between the two surfaces.
- Changed the default export formats from `md,html,epub,pdf` to `md,html`
  across every surface that takes them: `mlab export` / `npm run export`,
  `mlab done --export-formats` / `npm run done`, and the standalone
  `mlab gate export`. EPUB and PDF are now explicit opt-ins via
  `--formats` / `--export-formats` (breaking for workflows that relied on
  default EPUB/PDF outputs).
- Changed unknown-command handling to print the six command groups and a
  nearest-match suggestion instead of the full help text.
- Rewrote `README.md` and `docs/PRODUCT_STRATEGY.md` around the 2.0 decision
  of record: the protocol is the product, generation features are contained
  lab R&D with an explicit promotion criterion, and agents are the primary
  distribution surface.
- Deprecated the old top-level lab command names (`room`, `chorus`,
  `practice`, `drive`, `eval`, `artifacts`, `golden-path`, `taste:arbiter`,
  `style:signals`, `words`, `model:*`) in favor of `mlab lab <command>`; the
  old names keep working as compatibility aliases.
- Removed unused template npm scripts:
  `done:json` (use `npm run done -- --json`),
  `check:list` (use `npm run check -- --list-model-checks`),
  `check:static` (use `npm run check -- --static-only`),
  `story:init` / `story:restore` (use `project:init` / `project:restore`),
  `story:unload` (use `npm run story -- unload`), and the per-domain test
  scripts `model:json-test`, `model:response-test`, `project:test`,
  `style:test`, `taste:test`, and `words:test` (use `npm test`).
- Fixed the false green on fresh projects: a workspace where every draft
  section is still `todo` no longer passes the manuscript gate vacuously.
  The new blocking `sections.any_started` requirement fails until at least
  one section is started, so `mlab report` and `mlab done` on a pristine
  `mlab init` workspace now say `not_ready` with a fix command instead of
  `ready`. Projects with at least one active (non-`todo`) section are
  unaffected.
- Fixed the contradiction where `citations check` could pass while the report
  and manuscript gate citation requirement failed: both now call one shared
  evidence-spine implementation with the same default scope (all active
  sections).
- Fixed technical-whitepaper fixture drift so the committed fixture passes the
  current harness end to end, with its revision-trail artifacts kept as
  completed history.
- Fixed `.gitignore` to exclude generated `examples/**/.doccheck/` artifacts.

## 1.5.3 - 2026-06-25

- Fixed the manual release workflow so GitHub Actions configures a bot git
  identity before creating annotated release tags.

## 1.5.2 - 2026-06-25

- Added `--no-contents` to `mlab export` / `npm run export` and forwarded it
  through `mlab done` / `npm run done`, allowing reader exports to omit
  generated Contents pages while keeping export manifests explicit about the
  choice.
- Aligned the manual release workflow with the public release checklist by
  creating annotated tags and using the matching `CHANGELOG.md` section for
  GitHub release notes.

## 1.5.1 - 2026-06-19

- Hardened practice benchmark and strategy runs for heterogeneous model
  testing: per-row provider/model failures now persist as error rows with
  evaluated/error denominators in summaries, reports, console output, and
  practice-strategy eval snapshots. Runs with some errors now report `partial`;
  runs where every comparison errors fail instead of masquerading as a pass.
- Cleaned generated-artifact discovery so incomplete practice-strategy runs are
  marked `in_progress` without polluting recommendations, while completed
  benchmark/eval artifacts expose evaluated/error row counts.
- Expanded the practice prose guard to catch visible reasoning tags, analysis
  headings, and prompt/task chatter from reasoning-heavy models before judging.

## 1.5.0 - 2026-06-19

- Added generated-artifact discovery across driver runs, practice runs,
  practice benchmarks, strategy comparisons, eval snapshots, and golden-path
  guides, surfaced through `mlab artifacts`, `status`, and `report`.
- Added `mlab eval practice-strategies` to snapshot strategy-comparison
  evidence under `state/evals/`, compare against baselines, and optionally fail
  CI/release checks with `--fail-on-regression`.
- Added `mlab golden-path` as a first-use product guide that can persist
  onboarding evidence under `state/golden-path/`.
- Extended `mlab drive` with resume-safe continuation, read-only artifact
  inspection tools, an eval snapshot primitive, and generated-artifact context
  in model observations.
- Added contributor primitive-contract docs, installed-package smoke coverage
  for artifacts/evals/golden-path, and a manual GitHub Actions release workflow
  scaffold.

## 1.4.0 - 2026-06-19

- Scoped the future `mlab drive` model-driver primitive: an interactive,
  policy-bound command loop that exposes Manuscript Lab tools to a model,
  records decisions under `state/driver/`, and preserves gates and approvals as
  the readiness boundary.
- Added the first bounded `mlab drive` implementation slice with a validated
  tool catalog, curated policy packs, strict project-relative path fences,
  dry-run, mock-decision, and live model decision support, persisted
  `state/driver/` step ledgers, wrapper/npm routing, and installed-package
  smoke coverage.
- Hardened `mlab drive` after adversarial review: child primitives now inherit
  pinned workspace/config roots, ephemeral live-model driver runs do not force
  model-call audit writes, `review-only` has an enforced allowlist, `--no-write`
  blocks mutating primitives, traversal segments are rejected, and `--resume`
  is explicitly rejected until real history reconstruction ships.
- Tuned `mlab drive` for actual model use: model-backed runs now default to a
  four-step observe/decide/act loop and carry compact parsed-result summaries
  into the next decision, while heuristic runs still default to one conservative
  step.
- Made the driver-exposed `practice.bench` primitive less macro-shaped by adding
  bounded model-controlled knobs for exercise set/id list, seeds, candidate
  count, and repair rounds.
- Hardened practice generation from live GLM traces: direct baselines and
  candidates now prose-guard outputs before judging and retry once with a strict
  `final_prose` contract when a model leaks planning/meta text.
- Added `mlab practice propose` / `npm run practice` as a safe creative-writing
  exercise primitive: it generates multiple candidates, judges them against a
  hidden exercise test, revises the winner, writes `state/practice/` artifacts,
  and is exposed to the driver as the approval-gated `practice.propose` tool.
- Added `mlab practice compare` for controlled direct-vs-mlab evidence: it runs
  a direct same-model baseline, a practice proposal loop, and a blind pairwise
  judge, then writes comparison artifacts under `state/practice-evals/`.
- Hardened practice comparisons with structured prose-only revision outputs,
  prose/meta leakage guards, bounded repair rounds when the direct baseline
  wins, and copy checks so duplicated direct baselines cannot count as distinct
  mlab wins.
- Expanded the practice exercise battery and added `mlab practice bench`, which
  runs direct-vs-mlab comparison matrices across exercise sets, models, and
  seeds, writes self-contained `state/practice-bench/` ledgers, separates
  first-pass wins from repair recoveries, supports `--judge-model`, and exposes
  `practice.bench` to the model driver as an approval-gated oracle-guided
  workflow benchmark tool.
- Added `mlab practice strategies`, a first-class strategy-comparison command
  that runs preset practice-loop shapes, writes `state/practice-strategies/`
  ledgers with nested benchmark artifacts, recommends per-exercise strategies
  from aggregate win/delta/cost/recovery evidence, and exposes
  `practice.strategies` to the model driver and installed-package smoke tests.
- Aligned GLM examples and taste-arbiter defaults on OpenRouter GLM 5.2 so the
  driver, practice lab, provider docs, and release examples point at the same
  current model route.

## 1.3.0 - 2026-06-17

- Added `room diagnose` as the first writers' room step. It writes a
  deterministic story-foundation diagnosis, readiness grade, missing inputs,
  warnings, visible-file manifest, and recommended next command under
  `state/room/`.
- Strengthened beat boards with causality fields: `causal_link`, `choice`,
  `consequence`, and `turn`, so room material is easier to use as story
  pressure instead of loose idea inventory.
- Added the `scene.turn` typed review sensor and panel routes for checking
  movement, pressure, turn, and consequence after prose exists.
- Updated `mlab` help, status/report artifact discovery, install-anywhere
  smoke coverage, Pi prompts, and public docs so diagnosis, causal beat boards,
  and scene-turn review are first-class package surfaces.

## 1.2.0 - 2026-06-17

- Reframed Chorus as a prose line lab by default: `chorus run` now samples
  beat-level candidates and writes `CONTACT_SHEET.md`, per-beat contact sheets,
  `plan-quality.json`, metrics, and reports without assembling prose.
- Kept the pick-and-assemble path available through explicit `--assemble`,
  `chorus judge`, and `chorus assemble`, with reports warning against wholesale
  merges.
- Tightened Chorus beat plans with sensory/object targets, continuity limits,
  stricter no-new-canon guardrails, plan-quality warnings, and usage/cost
  metrics for model-backed candidates.
- Updated `mlab` help, status/report artifact links, installed-package smoke
  coverage, Pi prompts, and public docs so Room, Chorus, and candidate loops
  present as first-class but distinct workflows.

## 1.1.0 - 2026-06-17

- Added a writers' room workflow research memo mapping industry room practices
  to future Manuscript Lab commands, prompts, and durable artifacts.
- Added the `room` protocol command for blue-sky role cards, showrunner
  decisions, beat-board materialization, table-read packets, and room reports
  under `state/room/`.
- Added the `room.table_read` typed review sensor, Lightning/OpenRouter panel
  routes, Pi room prompts, project scaffold support for `state/room/`, and
  root-aware room command smoke coverage.
- Added the first Chorus prose ensemble MVP: `npm run chorus` / `mlab chorus`
  can plan beat-level voice experiments, sample local/mock/model-backed
  candidates, pick provisional beat prose, assemble `state/chorus/` output, and
  report runs without modifying `draft/`.
- Promoted Room and Chorus into first-class package surfaces: `status` and
  `report` now expose recent runs and artifact links, project lifecycle commands
  mount/archive their state, generated next-step hints are `mlab`-aware in
  installed workspaces, Pi prompt coverage includes report/plan entrypoints, and
  installed-package smoke tests assert the cockpit/report integration.

## 1.0.3 - 2026-06-17

- Cleaned public changelog wording so the v1 history stays focused on fresh
  config-first installed projects.

## 1.0.2 - 2026-06-17

- Aligned public release docs with the published npm package and GitHub release:
  added npm/GitHub/CI badges, deleted the old v1 branch plan, and removed stale
  pre-publish language from install docs.

## 1.0.1 - 2026-06-17

- Fixed project-free `mlab doctor --no-network` so public one-off registry
  smokes in blank directories report missing project/git context as diagnostics
  instead of failing the command before `mlab init`.

## 1.0.0 - 2026-06-17

- Set the v1/npm-publishing path around fresh config-first installed projects
  while preserving template-clone compatibility.
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
