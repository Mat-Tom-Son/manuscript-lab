# Narrative Observations

`mlab narrative` watches a manuscript for **default narrative pressure** — the
tendency of drafts (especially model-assisted drafts) to converge on the most
common storytelling moves: meaning explained after it has been dramatized,
emotion routed through the same bodily formula, settings that always mirror
feelings, tidy single-track causality, climaxes that resolve into realization.

It is a craft diagnostic, not an authorship detector.

- It never outputs an "AI probability" and never claims who or what wrote a passage.
- Every observation is advisory. Nothing here blocks `mlab gate`, `mlab report`
  readiness, or `mlab done`.
- A default move chosen deliberately is not a problem. The tool exists to catch
  defaults nobody chose — and to help you steer away from them *before* drafting,
  because structural habits survive line editing.

The feature definitions are adapted from StoryScope (Russell et al. 2026,
arXiv:2604.03136), which showed that discourse-level narrative choices separate
one-shot model fiction from published human fiction far more durably than
surface style, and that surface-level rewriting barely moves them. The paper's
human/AI gaps are directional priors from that corpus — mlab does not use them
as thresholds.

## The pipeline

```
draft section
   |
   |  mlab narrative extract        one model call per changed section (cached by content hash)
   v
state/observations/<id>-template.json      structured narrative template
   |
   |  mlab narrative features       deterministic derivation, no model calls
   v
state/observations/<id>-narrative-signals.json   feature observations + intent comparison
   |
   |  mlab narrative profile        local aggregation, no model calls
   v
state/observations/manuscript-narrative-profile.json   manuscript convergence profile
```

The **template** is the load-bearing artifact: a structured record of what
happens, how it is arranged in time, what is withheld, how emotion is conveyed,
and how the section resolves — abstracted away from surface wording. Everything
downstream (features, intent checks, diffs, the profile, the review pass) is
cheap local math over templates. Editing a section invalidates only that
section's template. A refreshed template also invalidates its derived feature
artifact until `mlab narrative features` runs again; profiles and reports
exclude stale observations instead of presenting old convergence or intent
drift as current.

Evidence quotes inside a template are verified verbatim against the section
body; quotes that cannot be located are dropped and recorded under
`evidence_verification.dropped`, mirroring the review runner's
no-quote-no-issue rule.

## Steering: narrative intents in the section contract

Declare the shape you want in the section contract, next to `purpose` and
`acceptance`:

```html
<!--
id: 07-return
kind: fiction.chapter
...
narrative_resolution: external_action
narrative_emotion: behavioral_cue
narrative_commentary: none
narrative_time: nonlinear
-->
```

Supported keys and values:

| Key | Values |
| --- | --- |
| `narrative_resolution` | `external_action`, `internal_understanding`, `mixed`, `unresolved` |
| `narrative_agency` | `protagonist_choice`, `mixed`, `external_fate` |
| `narrative_emotion` | `explicit_label`, `embodied_metaphor`, `behavioral_cue`, `dialogue`, `mixed` |
| `narrative_commentary` | `none`, `implicit`, `explicit` |
| `narrative_time` | `linear`, `mostly_linear`, `nonlinear` |
| `narrative_subplots` | `none`, `thematically_parallel`, `contrasting`, `independent` |
| `narrative_reader_address` | `yes`, `no` |

Declared intents flow through the whole loop:

1. `mlab compose` injects them into the drafting context (intent doc and rule
   stack) as explicit constraints, phrased as craft guidance.
2. `mlab narrative check` compares each declared intent against the observed
   feature and reports drift. Advisory by default; `--strict` exits nonzero.
3. The `narrative.default_pressure` review pass treats declared values as
   chosen — it never flags a shape the contract asked for, only drift away
   from it or saturation nobody chose.

This ordering matters: post-hoc surface editing does not move narrative
structure. If you want a non-default shape, it has to be in the contract before
the draft exists.

## Candidate exploration: `mlab narrative diff`

Models asked for N candidate revisions often return the same narrative choices
in different words. After extracting templates for two drafts or candidates:

```bash
mlab narrative extract state/candidates/07-return/<run>/candidate-a.md --id 07-return-cand-a
mlab narrative extract state/candidates/07-return/<run>/candidate-b.md --id 07-return-cand-b
mlab narrative diff 07-return-cand-a 07-return-cand-b
```

The diff compares fixed structural axes (resolution, temporal order, subplots,
commentary, emotion modes, setting mirroring, scene turns, ...) and gives a
verdict: word-level variants, moderately distinct, or structurally distinct.
Use it to see whether a candidate run actually explored the space before you
spend judge calls comparing prose.

## The manuscript profile

`mlab narrative profile` aggregates all observed sections:

- per-feature distributions, dominant values, and longest consecutive runs;
- convergence flags when ≥70% of at least 4 observed sections share a value, or
  ≥3 consecutive sections repeat it — annotated with whether that direction
  matches the common model default;
- collected intent drift;
- with `--model <id>`, watch notes for your drafting model's known narrative
  tendencies (Claude flattens escalation and favors epilogues; GPT leans on
  gossip mechanics and retrospective framing; Gemini tidies endings and reaches
  for flashbacks; several families undershoot word targets by ~a third).

`mlab report` shows a compact advisory block when the profile exists. It
rebuilds the block from current feature artifacts, excluding any section whose
template, feature definitions, or section kind changed after derivation.

## The review pass

`narrative.default_pressure` (stages: revision, polish; non-blocking) reads the
observation artifacts plus taste doctrine and flags **only** findings that pass
all three tests: materially present (saturated, clustered, or convergent),
weakening the section's stated job, and fixable by a concrete craft move. Zero
issues is a normal outcome. Findings anchor to verbatim quotes like every other
review pass.

```bash
mlab review draft/07-return.md --passes narrative.default_pressure
```

## Configuration

- Feature definitions ship in the package at `narrative/features.json`. A
  project can override or disable entries by id (or add its own) in its own
  `narrative/features.json`; entries carry `applies_to` kinds, so embodiment
  features never fire on `document.*` sections.
- Extraction model: `--model`, else `NARRATIVE_TEMPLATE_MODEL`, else
  `default_model` in `narrative/features.json`.
- All artifacts live under `state/observations/` and record the extractor
  model, prompt hash, and section hash that produced them.

## Guardrails

- No authorship scores, ever. The word "AI" does not appear in findings.
- Advisory by default everywhere; the only nonzero exits are opt-in
  (`check --strict`).
- Density, clusters, and manuscript-wide recurrence over single occurrences.
- Declared intents and protected lines are chosen; choices are not findings.
- Observations are hypotheses: the review pass is instructed to trust the
  visible text over any cached artifact that disagrees with it.
