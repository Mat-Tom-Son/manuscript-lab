# Case Study: The Harness Versus A Direct Pass

> First inward baseline for the 2.0 promotion criterion: does the mlab loop
> beat the same model writing directly? Evidence and raw artifacts:
> `evals/case-studies/2026-07-harness-vs-direct/`.

## Question

Does the Manuscript Lab discipline produce more shippable sections than the
same model given the same inputs without the harness?

## Method

Subject: a four-section technical whitepaper about Manuscript Lab itself, with
real section contracts and the evidence spine registered against six real
project docs. Each section's contract carries concrete acceptance criteria,
word targets, and required `[cite:key]` markers.

Three arms, same generator (`openrouter:z-ai/glm-5.2`), same visible inputs
(brief, style rules, outline, contract, and identically truncated source
texts):

- **A - direct:** one-shot generation.
- **B - direct + self-revise:** arm A's draft plus a generic "revise against
  the contract" pass. Controls for "any iteration helps."
- **C - mlab loop:** composed runtime packet, three candidates, deterministic
  static checks on each, blind selection by a disjoint model family
  (`lightning:lightning-ai/gpt-oss-120b`), and one check-informed revision
  pass when findings remained.

Scoring:

1. **Deterministic readiness:** the section gate and citation checks, run
   identically on all twelve drafts.
2. **Blind preference:** pairwise judging (C-A, C-B, A-B) by two judge
   families disjoint from the generator and selector
   (`openrouter:qwen/qwen3.7-plus`, `openrouter:tencent/hy3`), each judging
   both presentation orders. Sixteen votes per matchup.

## Results

### Deterministic readiness (section gate, objective)

| Arm | Sections ready | Failure detail |
|---|---|---|
| A direct | **1 / 4** | `TODO` placeholder text in two sections; a literal `[citation-needed]` left in one |
| B direct + self-revise | **3 / 4** | cleared two placeholder failures; one section "passed" by collapsing from 548 to 204 words |
| C mlab loop | **4 / 4** | all sections inside contract, no placeholders, citations resolving |

The naked model, given identical instructions, shipped placeholder debt in
three of four sections. Arm C's own raw candidates had the same disease -
three of nine failed gates - but the harness filtered them out before
selection. The discipline is in the sensors and the loop, not in the model
suddenly writing more carefully.

Length control shows the same pattern. On the gates-and-evidence section
(target 500 words), the direct arm wrote 1,733 words and self-revision grew it
to 1,983. The harness arm landed at 579.

### Blind preference (16 votes per matchup)

| Matchup | Result |
|---|---|
| mlab vs direct | **9 - 6** (1 judge error) |
| mlab vs direct + self-revise | **10 - 6** |
| direct vs direct + self-revise | 8 - 6 (2 ties) |

Directional edge to the harness arm, but not decisive at this sample size:
6 of 23 evaluable judge-pairs flipped their vote with presentation order, so
the margins sit inside judge noise. The self-revision control is the cleaner
negative result: revising without structure did not reliably help, and judges
weakly preferred the unrevised draft.

Per-section detail is more instructive than the aggregate. The harness swept
the section where the direct arms blew the length contract (4-0, 4-0), and
lost the opening section (1-3, 0-4) where its winning candidate was
contract-compliant but thinner than the direct drafts. Compliance is not the
same thing as editorial preference, and the gates currently measure only the
first.

### Cost

Per section, the mlab arm used roughly 5x the input tokens and 2.3x the
output tokens of the direct arm (three candidates, selection, occasional
revision). Judge overhead for the evaluation itself was 223k input / 61k
output tokens. Total experiment spend across all runs was a few dollars.

## Read

- The demonstrated, objective value of the harness in this study is
  **readiness discipline**: it was the only arm that produced four shippable
  sections, and the failures it prevented (placeholders, phantom citations,
  contract-length blowouts) are exactly the failures its sensors exist to
  catch.
- The blind-preference edge is directional, not proven. Do not quote the
  9-6 as a win; quote the 4/4 versus 1/4.
- Iteration without structure (arm B) is not a substitute: it fixed some
  surface debt, hurt as often as it helped on preference, and once "passed"
  a gate by deleting most of the section.
- The opening-section loss is a real product finding: acceptance criteria
  bind the floor, judges reward richness above it. Contracts that want richer
  prose need acceptance criteria that say so.

## Limitations

- Four sections, one generator model, one subject document authored by the
  tool's own maintainers. This is a case study, not a benchmark.
- Judges showed position noise (6/23 order flips) and premium judge models
  were not reachable on the account used; verdicts came from two mid-tier
  families.
- Source texts were truncated identically for all arms and judges.
- The mlab arm's token cost advantage-per-quality is not established; the
  claim under test was "the discipline is worth its cost," and only the
  readiness half is demonstrated.

## Reproduce

The full runner, subject project, all twelve drafts, every judge vote with
reasons, and the call ledger are in
`evals/case-studies/2026-07-harness-vs-direct/`. The runner needs provider
keys in `.env` and spends a few dollars.
