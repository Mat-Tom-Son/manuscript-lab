# CI

The active GitHub Actions workflows live under `.github/workflows/`.

- `ci.yml` runs on pushes and pull requests to `main`.
- `release.yml` is a manual `workflow_dispatch` scaffold for maintainers.

CI runs:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: "22"

      - name: Run tests
        run: npm test

      - name: Run template audit
        run: npm run template:audit -- --strict

      - name: Run context audit
        run: npm run context:audit -- --strict

      - name: Run doctor
        run: npm run doctor -- --no-network

      - name: Run fresh project smoke test
        run: |
          node bin/manuscript-lab.mjs init --title "CI Smoke" --slug ci-smoke --sections 1 --kind document.section
          node bin/manuscript-lab.mjs validate
          node bin/manuscript-lab.mjs status
          node bin/manuscript-lab.mjs claims list --json
          node bin/manuscript-lab.mjs citations check --json
          node bin/manuscript-lab.mjs gate draft/01-opening.md --json
          node bin/manuscript-lab.mjs report --json
          node bin/manuscript-lab.mjs check --static-only
          node bin/manuscript-lab.mjs done:no-export

      - name: Verify package contents
        run: npm pack --dry-run
```

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

Required repository secret:

- `NPM_TOKEN`: npm automation token with publish rights for `manuscript-lab`

The workflow has `contents: write` for tags/releases and `id-token: write` for
npm provenance. It does not bump versions; version changes stay as ordinary
reviewed commits.
