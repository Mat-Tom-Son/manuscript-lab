# Install Workflow

This document is the design record for issue #2, "Design npm/global install
workflow." It does not implement the workflow. It defines the supported target
so the package can stay template-first until the installed-package path is
tested enough to publish.

## Decision

Manuscript Lab remains template-first today.

- The repository is the product surface for `0.1.x`.
- `package.json` stays `private: true`.
- The local `manuscript-lab` / `mlab` wrapper is convenience for clones, not a
  supported global or `npx` install flow.
- Existing `npm run ...` commands stay canonical for template users.

The install-anywhere target is a package-assets CLI, not a postinstall copy of
the whole harness.

- `npm install -D manuscript-lab` installs the reusable engine under
  `node_modules/`.
- `npx mlab ...` runs package code from `node_modules/.bin` and reads or writes
  project files in the caller's workspace.
- `mlab init` creates project scaffolding, config, and user-owned protocol
  files. It does not copy `scripts/`, package docs, release metadata, or agent
  adapters into the project unless a user asks for an adapter install.
- A global `mlab` can be supported later as a convenience, but project-local
  installs are the reproducible CI path.

Unsupported choices:

- No postinstall script that mutates the current directory.
- No global package that assumes the global install directory is the project
  root.
- No npm publish until an installed-tarball end-to-end test passes in CI.

## Current Template-First Workflow

Current public usage is:

```bash
git clone <repo-url> manuscript-lab
cd manuscript-lab
npm run project:init -- --title "My Project" --slug my-project --sections 4 --kind document.section
npm run status
npm run check -- --static-only
npm run doctor
```

Template users own the whole repository clone. The reusable harness lives in the
root, while project content is mounted from
`projects/active/<slug>/workspace/` into root paths such as `PROJECT.md`,
`brief.md`, `draft/`, `state/`, `taste/`, and `exports/`.

That workflow remains valid. It is useful for users who want the harness
scripts, docs, adapter files, and writing workspace in one repo. It also keeps
the first public release honest while the CLI learns how to separate its package
root from a caller workspace root.

## Install-Anywhere Target

The target adoption path is:

```bash
mkdir my-whitepaper
cd my-whitepaper
npm init -y
npm install -D manuscript-lab
npx mlab init --profile whitepaper --root manuscript
npx mlab doctor
npx mlab status
npx mlab check --static-only
```

After init, the caller repo owns:

```text
manuscript-lab.config.json
manuscript/
  PROJECT.md
  brief.md
  outline.md
  style.md
  draft/
  sources/
  taste/
  state/
  exports/
```

The package owns:

```text
node_modules/manuscript-lab/
  bin/
  scripts/        # or future packages/core and packages/cli
  checks/
  reviews/
  templates/
  docs/
  skills/
  .pi/
```

Runtime commands must distinguish:

- package root: where the installed executable and bundled assets live
- workspace root: the user repo or subdirectory containing
  `manuscript-lab.config.json`
- manuscript root: the configured project content root, usually `manuscript/`

The command runner may load built-in templates, default checks, default review
passes, schemas, and docs from the package root. It must read and write drafts,
state, sources, exports, and project config under the workspace/manuscript root.

## `npx` And `mlab` UX

The public CLI should prefer short, coherent commands:

```bash
npx mlab init --profile whitepaper --root manuscript
npx mlab doctor
npx mlab status
npx mlab compose draft/01-intro.md
npx mlab check draft/01-intro.md
npx mlab review draft/01-intro.md --panel prose.clean
npx mlab issues list --status open
npx mlab revise issue-017 --candidates 3
npx mlab compare issue-017
npx mlab merge issue-017 --winner b
npx mlab gate manuscript --static-only
npx mlab export --format html
```

`manuscript-lab` and `mlab` remain equivalent bin names. `mlab` is the primary
docs name once npm support is real.

Behavior by install mode:

- local dev dependency: `npx mlab` uses the project-local package and is the
  default docs/CI path.
- one-off `npx`: allowed for `init`, `doctor`, `validate`, and help commands,
  but should warn when no project-local dependency exists.
- global install: allowed for interactive use, but should prefer a local
  `node_modules/.bin/mlab` when it finds one in the workspace so project CI and
  local shells use the same version.

Useful failure modes:

- outside a configured workspace: show `mlab init --profile <kind>` and
  `mlab doctor --no-project` hints instead of stack traces.
- inside a template clone: report that template mode is active and that
  `npm run ...` remains supported.
- version mismatch between global CLI and project config/package: warn, then
  suggest `npm install -D manuscript-lab@<expected>`.

## Package Contents

The publishable package should include:

- `bin/` executable entry points
- CLI/core runtime code, currently `scripts/` and later possibly
  `packages/core` plus `packages/cli`
- default `checks/`, `reviews/`, prompts, model panels, and schemas
- `templates/` for project scaffolds and section contracts
- public docs needed by operators and agents
- optional agent adapters under `skills/` and `.pi/`
- `.env.example`, license, security, contributing, changelog, and README

The package must exclude:

- user drafts and manuscript source files
- `PROJECT.md`, `brief.md`, `outline.md`, `style.md`, root `taste/`, root
  `sources/`, root `draft/`, root `state/`, and root `exports/`
- `projects/active/`, `projects/inactive/`, private archives, runtime caches,
  model-call logs, `.doccheck/`, `.env`, temporary files, and generated package
  tarballs
- credentials, provider keys, and local machine paths

The current `npm pack --dry-run` posture already exercises the package file
list. Before publishing, this needs a stricter packlist assertion that fails if
any ignored project path enters the tarball.

## Root Discovery

Root discovery is the central implementation boundary.

For every command, resolve roots in this order:

1. Parse explicit `--config`, `--workspace`, or `--root` flags.
2. Read `MLAB_CONFIG` or `MLAB_WORKSPACE` environment overrides.
3. Walk upward from `process.cwd()` looking for `manuscript-lab.config.json`.
4. If no config exists, detect legacy template mode by the current harness
   markers: package name `manuscript-lab`, `scripts/`, `checks/`, `reviews/`,
   and project filesystem markers.
5. If no root is found, allow only project-free commands such as `help`,
   `version`, `init`, `doctor --no-project`, and `validate --package`.

Discovery must return a structured object:

```json
{
  "mode": "installed",
  "packageRoot": "/repo/node_modules/manuscript-lab",
  "workspaceRoot": "/repo",
  "manuscriptRoot": "/repo/manuscript",
  "configPath": "/repo/manuscript-lab.config.json"
}
```

Template mode can return:

```json
{
  "mode": "template",
  "packageRoot": "/repo",
  "workspaceRoot": "/repo",
  "manuscriptRoot": "/repo",
  "configPath": null
}
```

No command may infer the user workspace from the npm package root. Installed
commands must be safe to run from a subdirectory inside the manuscript root.

## Config

The install-anywhere protocol should start with one root config file:

```json
{
  "schemaVersion": 1,
  "profile": "whitepaper",
  "root": "manuscript",
  "draftGlob": "draft/*.md",
  "stateDir": "state",
  "exportsDir": "exports",
  "sourcesDir": "sources",
  "tasteDir": "taste",
  "checks": {
    "suite": "default"
  },
  "reviews": {
    "suite": "default"
  },
  "model": {
    "envFile": ".env"
  }
}
```

Rules:

- Paths are relative to the workspace root unless documented otherwise.
- `root` points to the manuscript root, not the package root.
- Built-in suites use stable names such as `default`; project-local suites use
  explicit paths.
- Unknown config keys should warn in `0.x` and fail once protocol v1 is stable.
- Config reads must never execute code.
- Secrets stay in environment variables or `.env`, not in config.

Profiles can set scaffold defaults, gate defaults, and section-contract
defaults. They should not make hidden project-specific choices after init. Once
files are created, the user's files and config are the source of truth.

## Migration

Migration has two jobs: keep existing template clones working and give users a
controlled path to installed-package projects.

Supported states:

- template clone with no config: continue to work with `npm run ...` and the
  local wrapper.
- template clone with config: commands can opt into install-anywhere discovery
  while retaining root-mounted project files.
- installed project: config-first, package-assets CLI, no copied harness
  scripts.

Future migration command:

```bash
mlab migrate --from template --root manuscript --dry-run
mlab migrate --from template --root manuscript --apply
```

Migration should:

- inventory current root project files, active project registry, generated
  state, exports, sources, and ignored private files
- write a dry-run plan before moving anything
- create `manuscript-lab.config.json`
- preserve existing project content and generated state unless the user asks for
  a cleanup
- support an in-place mode with `"root": "."` for users who do not want a
  `manuscript/` subdirectory yet
- avoid deleting template scripts or docs; removal from a user clone is a
  separate manual cleanup
- run `mlab doctor` and `mlab validate` after applying

The migration command should be conservative because manuscripts are user data.
It should prefer refusal with a clear plan over surprising rewrites.

## Tests

Do not set `private: false` until these tests exist and pass in CI.

Installed tarball e2e:

```bash
npm pack
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm init -y
npm install /path/to/manuscript-lab-*.tgz
npx mlab init --profile whitepaper --root manuscript
npx mlab doctor
npx mlab status
npx mlab check --static-only
npx mlab done:no-export
```

The test must assert:

- project files are created under the caller workspace, not under the package
  install directory
- no `scripts/`, package docs, release files, or adapter directories are copied
  into the caller workspace by default
- root discovery works from the workspace root, manuscript root, and a nested
  draft subdirectory
- generated state and exports stay under configured paths
- package assets are read from the installed tarball
- no active project, source text, generated state, or secret-bearing file enters
  the tarball

Additional required tests:

- one-off `npx` smoke for `help`, `version`, `init`, and `doctor`
- global-install smoke using a temporary npm prefix
- config schema validation and unknown-key behavior
- legacy template-mode smoke so template-first usage does not regress
- migration dry-run fixture and apply fixture
- Windows path fixture for root discovery and configured relative paths
- CI fixture matching the public docs path:
  `npm install -D manuscript-lab`, `npx mlab validate`, `npx mlab check`,
  `npx mlab gate manuscript --static-only`

## Release Gates

Before the package can be published:

- the installed-package design in this doc has an implementation issue or PR
  linked from issue #2
- `npm test` passes
- `npm run template:audit -- --strict` passes
- `npm run context:audit -- --strict` passes
- `npm run doctor -- --no-network` passes without packaging failures
- installed-tarball e2e passes in CI
- temporary-prefix global install smoke passes in CI
- packlist audit proves private/generated project files are absent
- README, package docs, and CHANGELOG describe the supported npm workflow
- `package.json` is changed from `private: true` only in the release PR that
  also contains the installed-package tests
- `npm pack --dry-run` output is reviewed in the release PR

Recommended release line:

- `0.1.x`: template-first public repo
- `0.2.x`: protocol/config/root-discovery design and tests
- `0.3.x`: installable package alpha behind documented caveats
- `1.0.0`: stable file protocol, installed CLI, gate engine, evidence checks,
  export manifests, and CI-ready `npx mlab`

## Close Criteria For Issue #2

This design closes the decision portion of issue #2:

- npm install should operate from package assets, with `init` writing only
  user-owned project scaffolding/config into the caller workspace
- copying the whole harness into the current directory is not the target
- global install remains a convenience layer, not the reproducible project
  workflow
- npm publishing remains unsupported until installed-tarball e2e coverage exists

The implementation follow-up should add the root-discovery/config layer, the
installed-tarball tests, and the README/package/CHANGELOG updates in the same
release path that flips npm publishing on.
