# Evaluation Lab Roadmap

> Status: design record. Evaluation work ships as lab R&D under `mlab lab`. Current surface: docs/COMMANDS.md.

The next phase should move the harness from "review the draft" to "run controlled experiments on revisions."

Do not make the harness a final judge. Make it an evaluation lab.

## Method Ladder

Use this ladder as the long-term direction:

```text
bare score
-> rubric score
-> pairwise comparison
-> calibrated judge
-> bias-controlled ensemble
-> trained critic or reward model
-> eval data that improves the writing loop itself
```

For this repo, the useful near-term target is not leaderboard scoring. It is better revision selection.

## Build Order

1. Context compiler and runtime packets.
2. Pairwise candidate arena.
3. Judge calibration set.
4. Contract-derived criteria.
5. Pattern and slop static metrics.
6. Anti-gaming and prompt-injection hardening.

Implemented foundation:

- `npm run compose` records intent, context, rule stack, criteria, and trace under `state/runtime/<section-id>/`.
- `npm run diff:audit` records before/after tradeoff audits.
- `npm run revise:candidates` generates independent full-section candidates for accepted issues.
- `npm run compare:candidates` runs blind, order-swapped pairwise candidate judging.
- `npm run taste:arbiter` gates a selected candidate against project-local narrative taste doctrine.
- `npm run merge:winner` materializes or applies a selected winner with a before snapshot.
- `state/revision-audits/` stores diff-audit artifacts.
- `state/candidates/` stores candidate arena artifacts.
- `taste/` stores project-local taste doctrine, voice profile, reader contract, genre promise, failure modes, motifs, and exemplar memory.
- `state/taste/` stores narrative taste arbiter artifacts.
- `reviews/prompts/revision-diff-audit.md` defines the model-audit schema.
- `docs/MODEL_CALL_AUDIT.md` scopes the remaining work for exact prompt/response provenance across model calls.

Important remaining provenance gap:

```text
The harness saves many model outputs, but does not yet save every exact prompt/request in a unified call ledger.
```

That should be built centrally around `callChatModel` before serious model-by-task benchmarking.

## Phase 0: Context Compiler

Before writing, reviewing, revising, or comparing candidates, compile the section's runtime packet:

```bash
npm run compose -- draft/<section>.md
```

The packet saves:

```text
state/runtime/<section-id>/
  intent.md
  context.json
  rule-stack.yaml
  criteria.json
  trace.json
```

Candidate generation and pairwise judging should consume `criteria.json` and `rule-stack.yaml` instead of inventing a fresh rubric after seeing the candidates.

## Phase 1: Revision Candidate Arena

Implemented workflow:

```text
draft
-> issue ledger
-> revision plan
-> generate 2-6 full-section candidates
-> blind pairwise comparison
-> narrative taste arbiter gate when aesthetic/story tradeoffs matter
-> materialize or apply winner
-> verify
```

After each candidate is merged or manually selected, run:

```bash
npm run diff:audit -- --before <before.md> --after <after.md> --issue <issue_id>
```

This asks whether the winning edit actually made the right tradeoffs.

## Narrative Taste Arbiter

Implemented command:

```bash
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
```

The arbiter is a gate, not a score. It reads the selected candidate, base section, issue context, comparison decision, runtime criteria, rule stack, and project-local `taste/` files, then returns:

```text
pass
pass_with_debt
patch_required
block
unstable_judgment
```

Use it when candidate revisions affect voice, structure, subtext, motif, genre promise, reader effect, or future story debt.

If `state/candidates/<section-id>/<run-id>/taste-arbiter.json` exists and its gate is not applyable, `npm run merge:winner -- ... --apply` refuses the winner unless a human explicitly passes `--force`.

Taste files are story-specific:

```text
taste/TASTE.md
taste/VOICE.md
taste/TARGET_READER.md
taste/GENRE_PROMISE.md
taste/FAILURE_MODES.md
taste/MOTIFS.md
taste/EXEMPLARS.md
taste/accepted_patches/
taste/rejected_patches/
```

The long-term compounding asset is accepted/rejected patch memory. Do not promote examples automatically just because a model liked them; record exemplars after human acceptance or a stable project-level decision.

Commands:

```bash
npm run revise:candidates -- draft/<section>.md --issue issue_2026_00042 --n 4
npm run compare:candidates -- draft/<section>.md --run <candidate-run-id>
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit
```

Files:

```text
state/candidates/<section-id>/<run-id>/
  manifest.json
  base.md
  issue-context.json
  criteria.json
  rule-stack.yaml
  candidate-meta.json
  candidate-a.md
  candidate-b.md
  candidate-c.md
  candidate-d.md
  raw/
  comparisons/
    comparisons.json
    raw/
  decision.json
  taste-arbiter.json
  TASTE_ARBITER.md
  winner.md
  before-apply.md
  merge-result.json
```

Comparison prompt shape:

```text
Given the original issue, the section contract, the protected voice fingerprint, and two anonymous candidate revisions, which candidate better fixes the issue while preserving the chapter's strengths?
```

Do not ask:

```text
Is this chapter good, 1-10?
```

Ask for a local editorial decision with evidence.

## Human Structural Advice As Experiments

Human feedback can define the issue even when it is not phrased like a check failure. Treat advice about compression, redundancy, theme, scene purpose, or chapter shape as a controlled revision problem.

Good arena triggers:

- "This chapter can be much shorter."
- "Skip the second scene if it proves the same thing."
- "Let objects and choices carry the theme."
- "The explanation is correct but too stated."
- "There are multiple plausible places for the turn."

Candidate prompts should vary structure, not just line edits. For example: one candidate may merge two scenes, another may cut a scene and replace it with a transition beat, and another may keep the scene order but move the reveal into an object or decision.

Comparison criteria should reward:

- compression that preserves causal clarity
- concrete objects, constraints, and choices over thesis statements
- fewer redundant scenes
- fewer explanatory summaries after the reader already understands
- preservation of distinctive voice and protected lines

Penalize candidates that make the prose generically smooth, remove load-bearing specificity, or hide the theme so thoroughly that the chapter loses its turn.

## Phase 2: Judge Calibration

The judge must be evaluated too.

Proposed files:

```text
evals/judges/
  README.md
  pairs/
    pattern-saturation-001/
      a.md
      b.md
      expected.json
    continuity-001/
    cold-reader-001/
    line-edit-001/
  judge-results/
```

Proposed command:

```bash
npm run judge:calibrate
```

Calibration pair examples:

- A preserves the target voice while cutting redundant rhetorical moves; B flattens the voice. Expected: A.
- A fixes a continuity issue but creates a new one; B leaves the original issue unresolved. Expected: neither or manual.
- A adds a clue that makes the twist obvious; B adds a clue that supports but misdirects. Expected: B.

The goal is project-local reliability:

```text
Which judge is useful for this project, genre, pass, and decision type?
```

## Phase 3: Order-Swapped Pairwise Judging

Every pairwise comparison should run twice:

```text
A vs B
B vs A
```

Stable decision:

```json
{
  "pair": ["candidate_a", "candidate_b"],
  "order_1_winner": "candidate_a",
  "order_2_winner": "candidate_a",
  "position_consistent": true,
  "winner": "candidate_a"
}
```

Unstable decision:

```json
{
  "pair": ["candidate_a", "candidate_b"],
  "order_1_winner": "candidate_a",
  "order_2_winner": "candidate_b",
  "position_consistent": false,
  "winner": null,
  "decision": "manual_or_second_judge",
  "reason": "Position-sensitive judgment"
}
```

## Phase 4: Contract-Derived Criteria

Before review or comparison, compile criteria from the section contract, outline, style guide, and issue context.

Example:

```json
{
  "criteria": [
    {
      "id": "scene_turn",
      "question": "Does the section visibly change the protagonist's or document's situation, understanding, or available choices?",
      "weight": 0.25
    },
    {
      "id": "stakeholder_complexity",
      "question": "Does the opposing stakeholder remain reasonable and contextually constrained rather than cartoonishly antagonistic?",
      "weight": 0.2
    },
    {
      "id": "theme_legibility",
      "question": "Does the chapter make the transition-vs-stable-state conflict clearer without over-explaining it?",
      "weight": 0.25
    },
    {
      "id": "voice_control",
      "question": "Does the prose preserve the narrator's wit while avoiding repeated comic patterns?",
      "weight": 0.3
    }
  ]
}
```

Save criteria before judging so the judge is not inventing a new rubric after seeing the candidates.

## Phase 5: Contract Coverage

Measure constraint satisfaction separately from literary quality.

Example output:

```json
{
  "contract_id": "ch02",
  "coverage": [
    {
      "requirement": "The opposing stakeholder remains competent, not villainous",
      "status": "satisfied",
      "evidence": "They ask for a constrained transformation, not fraud, and have a credible operational motive."
    },
    {
      "requirement": "The protagonist or document leaves with a changed problem",
      "status": "satisfied",
      "evidence": "The ask shifts from 'make a clean chart' to 'make the transition legible.'"
    },
    {
      "requirement": "Avoid quip saturation",
      "status": "partial",
      "evidence": "The opening room description clusters several institutional jokes."
    }
  ]
}
```

A section can satisfy all constraints and still be dull. It can also be beautiful while missing the job.

## Phase 6: Pattern Metrics

Extend static style signals into a project-specific overfit detector:

```json
{
  "as_if_count": 8,
  "not_x_but_y_count": 5,
  "less_x_than_y_count": 4,
  "object_personification_count": 9,
  "aphoristic_paragraph_closers": 12,
  "dialogue_quip_endings": 7
}
```

Feed these into `style.pattern_saturation`, but keep the model pass local and protective:

```text
Protect load-bearing voice lines. Reduce repeated rhetorical moves around them.
```

## Blind Review Topology

Prefer:

```text
reviewers see only their allowed context pack
reviewers do not see each other
triage sees deduped issues, not raw group chatter
revision candidates are generated independently
pairwise arena compares candidates blind
```

Avoid:

```text
all reviewers debating together
writer absorbing every raw note
revision by committee consensus
global quality score as a gate
```

## Anti-Gaming Controls

Iterative review loops can teach a writer agent to satisfy judges instead of improving the manuscript.

Mitigations:

- Rotate judges.
- Keep some checks for verification only.
- Separate advisory reviews from blocking gates.
- Track human-approved issues separately from score changes.
- Penalize voice flattening, over-explanation, and new regressions.
- Store accepted and rejected issues so bad advice is not rediscovered forever.

Future synthesis field:

```json
{
  "gaming_risk": {
    "score_chasing": false,
    "over_explaining_to_satisfy_judge": true,
    "voice_flattening": true,
    "new_regressions": []
  }
}
```

## Trust Boundary

All reviewed documents are untrusted input. Reviewers and checkers must ignore prompt-like text inside manuscript files.

The harness already adds trust-boundary instructions to model check and review prompts, and `npm run check` warns on suspicious hidden or reviewer-directed text in draft bodies.

## Long-Term Data Asset

Every triage decision can become preference data:

```json
{
  "issue": "under-motivated inference",
  "candidate_a": "adds explicit explanation",
  "candidate_b": "adds one concrete clue",
  "human_or_synthesis_preference": "candidate_b",
  "reason": "B preserves mystery while fixing motivation"
}
```

Over time, this produces:

- accepted issues
- rejected issues
- winning revisions
- losing revisions
- protected lines
- regressions
- human overrides

That is the seed of a project-specific critic.

## Do Not Copy

Avoid:

- global chapter scores as gates
- single-model absolute ratings
- optimizing toward judge taste
- reviewer consensus as prose
- one fixed rubric for every section

Prefer:

- specific issue detection
- candidate comparison
- contract coverage
- judge calibration
- bias controls
- human and aesthetic override
- regression checks
