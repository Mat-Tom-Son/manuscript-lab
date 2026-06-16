# CI

The active GitHub Actions workflow lives at `.github/workflows/ci.yml`.

It runs on pushes and pull requests to `main`:

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
`done:no-export`, and Markdown/HTML export with manifests from workspace,
manuscript, and nested draft directories.

Changing this workflow requires a GitHub token with `workflow` scope. Normal
code and docs pushes do not need that extra scope.
