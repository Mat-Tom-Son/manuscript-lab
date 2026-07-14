# CI

The active GitHub Actions workflows live under `.github/workflows/`.

- `ci.yml` runs on pushes and pull requests to `main`.
- `release.yml` is a manual `workflow_dispatch` scaffold for maintainers.

## ci.yml Jobs

`test` runs the unit and integration suites plus the maintenance audits:

- `npm test`, strict template audit, strict context audit, and
  `doctor --no-network`.
- A fresh-project smoke test that exercises the v2 gate semantics end to end:
  after `init`, every section is `status: todo`, so `report --json` must be
  `not_ready` with a `sections.any_started` blocker, and
  `gate draft/01-opening.md --json` must exit non-zero with a
  `contract.status_started` failure. The smoke then flips the contract, status
  table, and outline to `draft`, appends prose past the word floor, runs
  `compose` and `project:sync`, and asserts the section gate passes, the
  report is `ready` with 2 total / 1 active sections, and `done:no-export`
  passes.
- `npm pack --dry-run` to verify package contents.

`fixtures` runs the checkout harness against both tutorial fixtures and
asserts they stay in their committed end states:

- `examples/technical-whitepaper` must stay green: `validate` and
  `check --static-only` pass, `gate manuscript --json` reports ready, and
  `report --json` is `ready` with zero blockers.
- `examples/broken-whitepaper` must stay red: `check --static-only` fails,
  `report --json` is `not_ready`, the expected blocker types are all present
  (`open_issues`, `citation_needed`, `unresolved_cite`, `claim_blocker`,
  `claim_source_unregistered`, `claim_unresolved`, `sections.ready`,
  `citations.ready`, `runtime.all_fresh`, `issues.none_open_or_deferred`,
  `doccheck.static_all_pass`), and every blocker carries a `fix` command.

`action-smoke` exercises the bundled GitHub Action (`uses: ./` with
`use-local: true`) against the green fixture with
`command: report --json --gate`, so a fixture regression fails the step.

`npm test` includes the protocol/gate/evidence unit tests, the packlist
assertion, and an installed-tarball smoke test for init, validate, evidence,
gates, report generation, status, compose, static check, review reporting,
`done:no-export`, configurable `done` export gates, and Markdown/HTML export
with manifests from workspace, manuscript, and nested draft directories. It
also verifies template-only wrapper commands refuse in installed workspaces
without writing legacy `projects/` state, and smoke-tests a temporary-prefix
global install for help, version, project-free doctor, config-first init,
validation, evidence gates, and template-command refusal.

Changing this workflow requires a GitHub token with `workflow` scope. Normal
code and docs pushes do not need that extra scope.

## GitHub Action For Prose Repos

The repository root ships a small composite action (`action.yml`) that runs a
Manuscript Lab command in a workspace directory. By default it runs
`npx --yes manuscript-lab@^2`, so consumer repositories need Node on the
runner but no dependency in their own `package.json`.

Inputs:

- `working-directory`: directory containing `manuscript-lab.config.json`
  (default `.`).
- `command`: the Manuscript Lab command line (default `report --json`).
- `use-local`: run the harness from the action's own checkout instead of npx.
  Only useful inside this repository's CI (default `false`).

Note on exit codes: plain `report --json` prints the report and exits zero
even when blockers remain. For a PR gate, use `report --json --gate` or
`gate manuscript --json`, which exit non-zero on blockers.

Drop-in PR gate for a prose repository:

```yaml
name: Prose CI

on:
  pull_request:

jobs:
  manuscript-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - name: Gate the manuscript
        uses: Mat-Tom-Son/manuscript-lab@v2
        with:
          working-directory: .
          command: report --json --gate
```

`@v2` is a moving tag that tracks the latest 2.x release (the release workflow
creates and force-updates it on publish); pin an exact tag such as `@v2.0.0`
for reproducibility. Note that the action's default npx path requires
manuscript-lab 2.x to be published on npm.

Every blocker in the report output names its `fix:` command, so a failing run
tells the author exactly what to run next.

## Release Workflow

`.github/workflows/release.yml` is intentionally manual. Dispatch it with the
package version that is already present in `package.json`.

Dry run mode:

- verifies the requested version matches `package.json`
- runs `npm test`
- runs strict template and context audits
- runs `npm run doctor -- --no-network`
- runs `npm pack --dry-run`
- runs `npm publish --dry-run --access public`

Publish mode does the same checks, then runs:

- `npm publish --access public --provenance`
- creates/pushes `v<version>` if the tag does not exist
- creates the matching GitHub release if it does not exist
- force-updates the moving major tag (for example `v2`) to the released
  commit, so `uses: Mat-Tom-Son/manuscript-lab@v2` keeps resolving to the
  latest 2.x release

The npm publish completes before the tags move, so announce the action only
after the workflow finishes: the action's default path runs
`npx --yes manuscript-lab@^2` and needs the package on npm.

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish rights for `manuscript-lab`

The workflow has `contents: write` for tags/releases and `id-token: write` for
npm provenance. It does not bump versions; version changes stay as ordinary
reviewed commits.
