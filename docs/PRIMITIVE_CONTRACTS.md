# Primitive Contracts

> Status: pre-2.0 reference in the template-clone dialect (`npm run ...`). For the current install-anywhere command surface see [COMMANDS.md](COMMANDS.md).

Manuscript Lab primitives are CLI operations that a human, package smoke test,
or model driver can safely compose. A primitive should be boring in the best
way: explicit inputs, fenced paths, durable artifacts, predictable JSON, and
clear approval posture.

## Add A Primitive

Use this checklist when adding a first-class command:

1. Add the wrapper route in `bin/manuscript-lab.mjs`.
2. Add an npm script in `package.json` when source users should run it through
   `npm run`.
3. Keep user inputs project-relative unless the command is intentionally
   project-free.
4. Emit stable `--json` output with `ok`, `status`, and artifact paths when the
   command writes generated state.
5. Write generated evidence under the configured manuscript state directory, not
   the package root, workspace parent, or caller `draft/` directory.
6. Add the command to install/package smoke tests when it is public.
7. Add docs and changelog entries for user-visible behavior.

## Driver Tool Catalog

Only add a primitive to `scripts/lib/driver-tool-catalog.mjs` when it is safe
for a model to choose by schema. Driver tools need:

- `tool_id`: stable dotted id, such as `artifacts.inspect`.
- `public_command`: the human command shape.
- `effects`: one or more declared effects from `DRIVER_EFFECTS`.
- `approval`: `auto`, `auto_in_operate`, or `ask`.
- `args`: narrow argument kinds with path fences and bounded integers.
- `argv`: a wrapper argv builder that never shells out through a string.
- `json_output`: `required` when the next driver step depends on parsed output.

Read-only tools can be available in the `review-only` policy. Tools that call
models, spend budget, write drafts, export, touch project workspaces, or record
human decisions should stay approval-gated.

## Artifact Contract

Generated workflow evidence should be discoverable through
`scripts/lib/generated-artifacts.mjs` and `mlab artifacts`.

Preferred artifact shape:

```text
state/<kind>/<run-id>/
  summary.json
  <HUMAN_REPORT>.md
  input.json              optional
  rows.json or events.jsonl optional
```

The artifact inspector currently recognizes driver runs, practice proposals,
practice pairwise evals, practice benchmarks, practice strategy comparisons,
eval snapshots, and golden-path guides. If a new primitive writes a new artifact
family, add its marker file to the generated-artifact schema and surface it in
`status` and `report`.

## Eval Contract

Eval commands record product evidence that can become a release guard.

`mlab eval practice-strategies` snapshots a strategy comparison run under
`state/evals/<run-id>/`. With `--baseline`, it compares strategy win rate,
score delta, error rows, and cost. With `--fail-on-regression`, it exits `1`
when the comparison finds a regression, making it suitable for CI or release
checks.

The eval layer should measure generic workflow behavior. Do not hard-code
exercise answers or expected prose; preserve blind tests and held-out judgment
where possible.
