# Broken Whitepaper Demo

This fixture is deliberately not ready. It is a deterministic public demo of
the blocker experience: protocol validation succeeds, then local checks expose
unsupported claims, citation placeholders, a missing citation target, an open
blocker issue, missing scaffolding, and readiness gate failures. Every blocker
the report prints carries a `fix:` line naming the command that addresses it.

Do not make this fixture pass. CI asserts it stays red so the failure output
stays honest. The ready counterpart is `examples/technical-whitepaper`.

Run it from this directory:

```bash
cd examples/broken-whitepaper
node ../../bin/manuscript-lab.mjs validate
node ../../bin/manuscript-lab.mjs check --static-only
node ../../bin/manuscript-lab.mjs report
```

Expected shape:

- `validate` passes: the file protocol itself is intact.
- `check --static-only` fails on missing scaffolding plus document and claim
  hygiene, and ends with `Run mlab check --fix to create missing scaffolding.`
- `report` prints `Status: not_ready` and the blocker list below. `report
  --json` carries the same blockers with a machine-readable `fix` field.

## Expected Blockers

The report emits these blocker types, each with the printed `fix:` command.
With the checkout harness, run the fix commands as
`node ../../bin/manuscript-lab.mjs <command>`; with the package installed they
work as written.

| Blocker type | What it flags | `fix:` command |
|---|---|---|
| `open_issues` | One open blocker issue targets `draft/01-market.md`. | `mlab issues list --status open` |
| `citation_needed` | `draft/01-market.md` contains a `[citation-needed]` placeholder. | `mlab citations check` |
| `unresolved_cite` | `[cite:missing-benchmark]` does not resolve to a registered source key or claim ID. | `mlab citations check` |
| `claim_blocker` (x2) | The claim register rows marked `unsupported` and `needs-review` block release. | `mlab claims list --unsupported` |
| `claim_source_unregistered` | A claim references source `missing-benchmark`, which is absent from `sources/index.md`. | `mlab claims list --unsupported` |
| `claim_unresolved` (x2) | The unsupported and needs-review claims carry unspecified risk and block release. | `mlab claims list --unsupported` |
| `sections.ready` (per section) | `draft/00-title.md` and `draft/01-market.md` fail the section-ready gate, with per-section reasons: missing runtime packets, the citation placeholder, heading depth, and the open issue. | `mlab compose draft/00-title.md`, `mlab compose draft/01-market.md` |
| `citations.ready` | The manuscript-level citation gate fails on the marker and unresolved cite above. | `mlab citations check` |
| `runtime.all_fresh` | Both active sections lack composed runtime packets. | `mlab compose draft/00-title.md && mlab compose draft/01-market.md` |
| `issues.none_open_or_deferred` | The open issue in `state/issues/issue-ledger.json` has no decision yet. | `mlab issues list --status open` |
| `doccheck.static_all_pass` | Static document checks fail: missing scaffolding, `[citation-needed]`, a `####` heading beyond the style limit, a duplicate `Adoption Pressure` heading, and the claim register rows. | `mlab check --fix` |

Notes on the fix commands:

- `mlab check --fix` creates only the missing scaffolding. The content
  failures (placeholders, headings, claims) remain on purpose; fixing those
  means editing the draft and the claim register, which is the human part of
  the loop.
- The `issues` and `claims` fix commands are diagnostic: they show exactly
  which issue or claim row blocks release so an operator can decide, revise,
  or register a source.
- Running `compose` would clear only the runtime blockers; the evidence and
  issue blockers keep the fixture red.

## Inspect The Failure Evidence

```bash
node ../../bin/manuscript-lab.mjs claims list --unsupported
node ../../bin/manuscript-lab.mjs citations check draft/01-market.md
node ../../bin/manuscript-lab.mjs issues list --status open
node ../../bin/manuscript-lab.mjs gate manuscript
node ../../bin/manuscript-lab.mjs review draft/01-market.md --dry-run --passes contract.editor --force
```

- `draft/01-market.md`: citation placeholders, duplicate headings, and an
  overdeep heading.
- `state/claims.md`: unsupported and needs-review claim rows.
- `state/issues/issue-ledger.json`: one unresolved blocker issue.
- `sources/index.md`: local fixture sources only; the cited benchmark is
  deliberately absent.
- `review ... --dry-run` shows the typed review queue without requiring an API
  key.
