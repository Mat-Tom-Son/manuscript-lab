---
name: narrative-taste
description: Govern narrative taste, voice integrity, reader effect, subtext, genre promise, motifs, and aesthetic acceptance for story revisions in this document repository. Use when judging whether prose belongs in a specific project, running the narrative taste sensor, gating revision candidates, or updating project-local taste doctrine and exemplars.
---

# Narrative Taste

Use this skill when the question is whether a passage belongs to the project, not merely whether it is clear or polished.

## Required Reads

Read these when present:

- `PROJECT.md`
- `taste/TASTE.md`
- `taste/VOICE.md`
- `taste/TARGET_READER.md`
- `taste/GENRE_PROMISE.md`
- `taste/FAILURE_MODES.md`
- `taste/MOTIFS.md`
- `taste/EXEMPLARS.md`
- the target section contract
- `state/runtime/<section-id>/criteria.json`
- relevant accepted issue-ledger decisions

Taste files are project-specific. Do not copy story-specific taste rules into generic scripts, prompts, skills, or docs.

## Sensor Versus Arbiter

Use the taste sensor to create review evidence:

```bash
npm run review:run -- --passes narrative.taste --models openrouter:z-ai/glm-5.1 draft/<section>.md
```

The sensor is advisory and imports concrete findings into the issue ledger.

Use the taste arbiter to gate a candidate winner:

```bash
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
```

The arbiter is a gate, not a score. It returns:

- `pass`
- `pass_with_debt`
- `patch_required`
- `block`
- `unstable_judgment`

If the arbiter returns `patch_required`, `block`, or `unstable_judgment`, do not apply the winner unless the human explicitly overrides the gate.

## Judgment Rules

Prefer the candidate that:

- creates the intended reader effect
- preserves project voice
- increases narrative pressure
- respects subtext
- avoids generic AI prose
- introduces the least future story debt

Do not reward:

- length
- ornamental language
- explicit explanation
- cinematic intensity without causal pressure
- clever lines that break character
- theme stated as summary

Block a patch when it is better prose but worse story.

## Candidate Arena Shape

For consequential accepted issues:

```text
accepted issue -> revision plan -> candidates -> blind comparison -> taste arbiter -> merge/audit
```

Commands:

```bash
npm run compose -- draft/<section>.md --operation revise
npm run revise:candidates -- draft/<section>.md --issue <issue-id> --n 3
npm run compare:candidates -- draft/<section>.md --run <candidate-run-id>
npm run taste:arbiter -- draft/<section>.md --run <candidate-run-id>
npm run merge:winner -- draft/<section>.md --run <candidate-run-id> --apply --audit
```

## Taste Memory

When a human or stable project decision accepts or rejects a high-leverage patch, update taste memory with a compact before/after note in:

- `taste/EXEMPLARS.md`
- `taste/accepted_patches/`
- `taste/rejected_patches/`

Examples beat rules. Record why a patch won or lost.
