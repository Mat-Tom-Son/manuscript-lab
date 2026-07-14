# Golden Path

> Status: written for the pre-2.0 surface; command names may differ. Current surface: docs/COMMANDS.md. Old names still work as aliases.

The golden path is the smallest product tour that proves Manuscript Lab is more
than a command list. It shows protocol, cockpit, model-driver evidence,
practice strategy evidence, eval snapshots, and report output in one sequence.

Use it as a readable guide:

```bash
mlab golden-path
mlab golden-path --target draft/01-opening.md --json
```

Persist it as onboarding evidence:

```bash
mlab golden-path --write --json
```

That writes `state/golden-path/<run-id>/summary.json` and
`state/golden-path/<run-id>/GOLDEN_PATH.md`.

## Evidence Loop

The default path is:

```text
validate
-> status
-> compose one section
-> persisted driver dry-run
-> small practice strategy comparison
-> eval snapshot
-> report --write
```

The practice step uses OpenRouter GLM 5.2 in the example command, but the guide
does not call a model by itself. It is safe to print without credentials. The
model-backed step is there so operators can see where measured workflow evidence
enters the product.

## What To Inspect

- `mlab artifacts list --json` shows recent driver, practice, eval, and golden
  path artifacts.
- `mlab artifacts inspect --run <run-id> --json` opens a specific generated run
  without reading raw directories by hand.
- `mlab eval practice-strategies --from state/practice-strategies/<run-id>`
  snapshots strategy evidence so future harness changes can be compared.
- `mlab report --write` rolls the generated evidence into the main cockpit.

The goal is not to hard-code creative answers. The goal is to make the harness
self-aware enough to choose between direct calls, candidate loops, revision
loops, and repair loops based on recorded evidence.
