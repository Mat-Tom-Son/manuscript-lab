# CI

The intended GitHub Actions workflow is:

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
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Run tests
        run: npm test

      - name: Run template audit
        run: npm run template:audit -- --strict

      - name: Run context audit
        run: npm run context:audit -- --strict

      - name: Run fresh project smoke test
        run: |
          node bin/manuscript-lab.mjs init --title "CI Smoke" --slug ci-smoke --sections 1 --kind document.section
          node bin/manuscript-lab.mjs status
          node bin/manuscript-lab.mjs check --static-only
          node bin/manuscript-lab.mjs done:no-export

      - name: Verify package contents
        run: npm pack --dry-run
```

Enable it by saving this as `.github/workflows/ci.yml` after pushing with a
GitHub token that has `workflow` scope.

