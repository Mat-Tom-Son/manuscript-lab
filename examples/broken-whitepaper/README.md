# Broken Whitepaper Demo

This fixture is intentionally not ready. It is a deterministic public demo for
the v1 CLI polish path: protocol validation succeeds, then local checks expose
unsupported claims, citation placeholders, a missing citation target, an open
blocker issue, and readiness gate failures.

Run it from this directory:

```bash
../../bin/manuscript-lab.mjs validate
../../bin/manuscript-lab.mjs check --static-only
../../bin/manuscript-lab.mjs claims list --unsupported
../../bin/manuscript-lab.mjs citations check draft/01-market.md
../../bin/manuscript-lab.mjs issues list --status open
../../bin/manuscript-lab.mjs gate manuscript --write
../../bin/manuscript-lab.mjs report --write
../../bin/manuscript-lab.mjs review draft/01-market.md --dry-run --passes contract.editor --force
```

Expected shape:

- `validate` passes the file protocol.
- `check --static-only` fails on local document and claim hygiene.
- `claims`, `citations`, `gate`, and `report` explain why the project is not
  ready without calling a model or the network.
- `review ... --dry-run` shows the typed review queue without requiring an API
  key.

Inspect:

- `draft/01-market.md`: citation placeholders and duplicate headings.
- `state/claims.md`: unsupported and needs-review claim rows.
- `state/issues/issue-ledger.json`: one unresolved blocker issue.
- `sources/index.md`: local fixture sources only; the cited benchmark is
  deliberately absent.
