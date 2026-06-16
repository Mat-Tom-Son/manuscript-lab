# Judge Calibration

Use this directory for local judge calibration pairs.

Pair shape:

```text
pairs/<eval-id>/
  a.md
  b.md
  expected.json
```

`expected.json` should explain the preferred answer and when `neither`, `manual`, or `merge` is the right outcome.

Example:

```json
{
  "preferred": "a",
  "reason": "A preserves the narrator's voice while reducing repeated quip shape; B flattens the voice.",
  "decision_type": "voice_preservation"
}
```

Judge results should be written under `judge-results/` once the calibration runner exists.
