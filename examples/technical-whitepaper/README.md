# Technical Whitepaper Tutorial Fixture

This is a safe, public, compact Manuscript Lab project fixture. It uses neutral
sample content and demonstrates the file concepts operators meet in a real
project: `brief.md`, `outline.md`, `style.md`, `draft/`, `sources/`, `state/`,
issue-ledger decisions, candidate runs, revision audits, and Markdown/HTML
exports.

The fixture is committed in its ready end state: protocol validation, static
document checks, the manuscript gate, and the readiness report all pass on the
files in this directory. CI runs the same commands against this fixture to
catch drift between the harness and its own tutorial.

The fixture includes its own `manuscript-lab.config.json`, so package commands
run from this directory inspect the fixture itself instead of the active
template project.

The included candidate and audit artifacts are manual public samples. They do
not contain provider raw outputs, model-call logs, API keys, private manuscript
material, or private story fingerprints.

## Fixture Map

- `PROJECT.md`, `brief.md`, `outline.md`, `style.md`: project intent, shape,
  voice, terminology, and evidence rules.
- `draft/00-title.md`, `draft/01-opening.md`: section contracts plus draft
  prose that satisfies the section gates.
- `sources/index.md`, `state/claims.md`: source registry and claim support.
- `state/status.md`, `state/continuity.md`, `state/open-questions.md`: cockpit
  state for section status, durable definitions, and open decisions.
- `state/issues/`: one accepted tutorial issue plus its decision record.
- `state/runtime/00-title/`, `state/runtime/01-opening/`: fresh composed
  runtime packets matching the committed drafts.
- `state/candidates/01-opening/tutorial-run-001/`: manual two-candidate sample.
- `state/revision-audits/01-opening/`: before snapshot plus static audit sample.
- `state/truth/`, `state/reviews/`, `state/revision-plans/`,
  `state/projections/`, `state/observations/`: required scaffolding created by
  `check --fix`.
- `exports/technical-whitepaper.md`, `exports/technical-whitepaper.html`,
  `exports/manifest.json`: reader exports plus release metadata whose input
  hashes match the committed draft.

## Run The Demo

Run the readiness path from this fixture directory using the checkout harness:

```bash
cd examples/technical-whitepaper
node ../../bin/manuscript-lab.mjs validate
node ../../bin/manuscript-lab.mjs check --static-only
node ../../bin/manuscript-lab.mjs gate manuscript
node ../../bin/manuscript-lab.mjs report --write
```

Expected end state:

- `validate` prints `PASS protocol validation`.
- `check --static-only` prints `Document checks passed. Checked 2 draft
  file(s).`
- `gate manuscript` prints `PASS manuscript-ready manuscript`.
- `report --write` prints `PASS Manuscript Lab Report` with `Status: ready`
  and zero blockers, and writes `reports/latest.json` and
  `reports/latest.html`.

With the package installed, `mlab <command>` works the same way from this
directory. The generated `reports/` directory and the `.doccheck/` scratch
state are local artifacts and are ignored by git.

## The Revision Trail Is Completed History

The issue, candidate, and audit artifacts show a finished revision loop, not
pending work:

- `state/issues/issue-ledger.json` holds `issue_tutorial_0001`, a minor
  structure finding that was accepted with a revision instruction: name the
  owner review that happens before export.
- `state/candidates/01-opening/tutorial-run-001/` holds the base snapshot, two
  manual candidate revisions, a comparison record, and `decision.json`
  selecting `candidate-a`.
- The winning owner-review sentence now appears in `draft/01-opening.md`, so
  the accepted issue reads as addressed. The sample keeps `"applied": false`
  in `decision.json` because the sentence was carried into the draft by hand
  when the tutorial was authored, not replayed through `merge`.
- `state/revision-audits/01-opening/` holds the before snapshot and a static
  diff audit recording what the revision changed.

Because the trail is history, the gate finds no open or deferred issues and
the report stays green while still showing one accepted issue, one candidate
run, one winner, and one audit in its revision-trail summary.

## Regenerate The Exports

The committed exports match the committed draft. To rebuild them after editing
prose, compose fresh runtime packets and export again:

```bash
node ../../bin/manuscript-lab.mjs compose draft/00-title.md
node ../../bin/manuscript-lab.mjs compose draft/01-opening.md
node ../../bin/manuscript-lab.mjs export --formats md,html --slug technical-whitepaper --author ""
```

`exports/manifest.json` records input and output hashes, so `report` can
verify that the published files match the draft they were built from.

## See The Failure Side

This fixture shows the ready end state. Its sibling,
`examples/broken-whitepaper`, is deliberately not ready and demonstrates how
blockers and their `fix:` commands look when the same gates fail.
