# Product Strategy

Manuscript Lab should be the anti AI book generator.

The durable product is not a machine that writes more text. It is a local
manuscript operating system: a CLI and file protocol for making long-form prose
reviewable, testable, revisable, source-grounded, and releasable.

The short version:

```text
Manuscript Lab is local CI for prose.
```

It should help a writer or agent understand what exists, what is missing, what
changed, what is unsupported, what is blocked, what passed, and what is ready to
ship.

## Decision Of Record (v2.0)

Four decisions define the 2.0 line. Everything else in this document serves
them.

1. **The protocol is the product.** Contracts, checks, typed issues, candidate
   trails, the evidence spine, gates, and provenance are the promise. Anything
   that generates prose is R&D until it proves otherwise.
2. **Generation features are contained R&D under `mlab lab`.** Writers' room,
   Chorus, practice, the model driver, evals, artifacts, and golden-path live
   under the `lab` namespace. A lab feature graduates into the core surface
   only when an inward-pointed case study — this harness working on a real
   project of ours — beats the solo-frontier baseline (the same model doing
   the task in one good session without the harness). No case study, no
   promotion. Old top-level names remain as compatibility aliases.
3. **Agents are the primary distribution surface.** The MCP server
   (`mlab mcp`, see `docs/MCP.md`) shipped in 2.0; `AGENTS.md` stays the
   standing contract; a Claude Code plugin is next. Humans get the same CLI;
   agents are how the protocol spreads.
4. **`adopt` is the front door.** Most serious manuscripts already exist.
   `mlab adopt existing-draft.md` turns a folder of markdown into a contracted
   workspace without touching the originals, and the first report shows real
   blockers with real fix commands. That first-five-minutes experience is the
   demo.

## What Changed And Why

2.0 is a re-centering, not a pivot. Through v1.x the generation surface —
room, Chorus, practice benchmarks, the model driver — grew faster than the
evidence that those loops beat a strong frontier model working alone. Our own
practice benchmarks were honest about this: they are oracle-guided workflow
benchmarks, not proof of product value. Meanwhile the protocol pieces
(contracts, gates, issues, evidence, manifests) kept quietly earning their
place every time they caught a drifted claim or blocked a premature export.

So 2.0 puts the weight where the value is: a reorganized CLI centered on the
daily protocol loop, stricter gates that cannot disagree with each other
(`todo` sections block, word floors block, `report` and `gate` share one
engine), a `fix:` command on every blocker, `adopt` as the entry point, and an
MCP server so agents can operate the protocol directly. The lab work is not
deleted — it is contained, labeled, and given a bar to clear.

## Positioning

Manuscript Lab is:

- a local CLI and file protocol for serious long-form writing
- a review, revision, evidence, and release workflow
- a way to turn model feedback into typed, durable work items
- a way to compare AI revision candidates before merging them
- a gate system for deciding when sections and exports are ready
- an adapter-friendly layer that agents can use without owning the protocol

Manuscript Lab is not:

- a one-click book generator
- a bestseller promise
- an autonomous author
- an agent swarm for its own sake
- a prompt pack
- a Scrivener, Google Docs, Quarto, or Pandoc replacement
- an academic cheating tool
- an AI detector evasion tool

The product promise should stay narrow and strong:

> Manuscript Lab turns a folder of draft files into a reviewable writing
> project. It gives every section a contract, every review a typed issue log,
> every AI revision a candidate trail, every important factual claim a source
> status, and every export a readiness gate.

## Product Principles

These principles predate 2.0 and survived it unchanged.

### Protocol Over Prompts

The project format matters more than any single prompt. A stable protocol lets
humans, agents, CI jobs, and future UIs work against the same artifacts.

Core artifacts:

```text
brief
outline
style
section contract
runtime packet
typed issue
revision candidate
comparison result
merge audit
claim register
source manifest
gate result
export manifest
```

### Gates Over Swagger

Do not claim "bestseller quality" or "publish-ready" as a generic model opinion.
Say exactly which configured standards passed.

Good:

```text
PASS section-ready
- contract satisfied
- no blocker issues
- no citation placeholders
- runtime packet fresh
```

Bad:

```text
This chapter is guaranteed to sell.
```

### Issues Over Advice Blobs

Model reviews should produce typed issues, not loose critique that disappears in
chat.

Target issue shape:

```json
{
  "id": "issue-017",
  "target": "draft/04-pricing.md",
  "severity": "blocker",
  "type": "unsupported-claim",
  "summary": "Pricing benchmark lacks source support.",
  "evidence": "Paragraph 6 cites a 2024 benchmark but no source is registered.",
  "suggested_action": "Add source support or weaken the claim.",
  "status": "open"
}
```

### Candidate Trails Over Silent Rewrites

For meaningful revisions, never let an AI silently overwrite a manuscript.
Generate candidates, compare them, select a winner, audit the diff, and preserve
the trail.

Shipped flow:

```bash
mlab revise draft/04-pricing.md --issue issue-017 --candidates 3
mlab compare draft/04-pricing.md --run <candidate-run-id>
mlab merge draft/04-pricing.md --run <candidate-run-id> --apply --audit
```

### Evidence As A First-Class Spine

For nonfiction, research, whitepapers, policy, technical writing, and business
writing, prose quality is not enough. The system must know what claims are being
made and how they are supported.

Target claim shape:

```json
{
  "id": "claim-019",
  "section": "draft/04-pricing.md",
  "kind": "factual",
  "status": "unsupported",
  "text": "Usage-based pricing became dominant after 2021.",
  "support": [],
  "risk": "medium"
}
```

### Agent Adapters, Not Agent Lock-In

Agents are useful operators. They should not be the product boundary.

The core should remain:

```text
file protocol -> deterministic CLI -> model provider layer -> optional agent skills
```

Agent instructions can teach Claude, Codex, Cursor, Pi, or future tools how to
use Manuscript Lab, but the durable state should remain local files.

### Export As Release, Not Formatting Toy

Do not compete with Quarto, Pandoc, Word, or publishing tools. Prepare and gate
the manuscript upstream, then export into existing publishing stacks.

Every serious export should eventually have a manifest:

```json
{
  "export_id": "export-2026-06-16-001",
  "source_commit": "abc123",
  "profile": "whitepaper",
  "formats": ["md", "html"],
  "gates_passed": ["manuscript-ready", "citation-ready"],
  "unresolved_issues": 0
}
```

## The Lab And The Promotion Criterion

The lab exists because the generation experiments are worth running, not
because they are worth promising. Room, Chorus, practice, drive, evals,
artifacts, and golden-path stay under `mlab lab` with three standing rules:

- Lab commands write evidence under `state/`; they never silently rewrite
  drafts.
- Lab claims stay honest: practice runs are oracle-guided workflow benchmarks,
  and reports say so.
- Promotion requires the case study. A lab feature moves into the core groups
  only when an inward-pointed case study on a real project shows the harness
  loop beating the solo-frontier baseline on outcomes we can show — not on
  win-rate against a handicapped baseline.

Until a feature clears that bar, it is allowed to be interesting and required
to be contained.

The first inward baseline exists: `docs/CASE_STUDY_HARNESS_VS_DIRECT.md`
(2026-07) tested the CORE loop against a direct pass and a self-revision
control on a real four-section document. Result: readiness discipline
demonstrated objectively (4/4 gate-ready sections versus 1/4 direct), blind
prose preference directional but inside judge noise, self-revision control
null. That is the bar and the template lab features must now clear.

## Distribution: Agents First

The people most likely to run a file-protocol writing harness daily are agents
and the humans who work with them. The 2.0 distribution order:

1. **MCP server** (shipped): `mlab mcp` exposes the protocol as typed tools
   with safety annotations to Claude Code, Claude Desktop, Cursor, and any MCP
   client. Default exposure is deterministic and model-free.
2. **AGENTS.md** (shipped, ongoing): the standing in-repo contract for any
   agent editing a Manuscript Lab workspace.
3. **Codex skill** (shipped): `npm run codex:install-skill`.
4. **Claude Code plugin** (next): a first-class plugin wrapping the golden
   path, report reading, and fix-command loops.

## Roadmap

In priority order:

1. **Model-backed claims extract**: `mlab claims extract <target>` proposing
   claim-register rows from prose, human-confirmed before they gate anything.
2. **docx export**: the most-requested handoff format for review workflows
   that live in Word.
3. **GitHub Action hardening**: version pinning, PR comment output, and
   fixture-backed action tests on top of the shipped composite action.
4. **Judge calibration**: calibrate lab judges against human picks so
   comparison verdicts carry known error bars.
5. **The case study**: run a real project through the harness, inward-pointed,
   against a solo-frontier baseline; publish what wins and what does not. This
   is the promotion gate for the lab.
6. **Claude Code plugin**: package the agent workflow as a first-class plugin.

## Where The Original Roadmap Landed

The pre-1.0 strategy laid out eleven phases. Honest status:

| Phase | Status |
| --- | --- |
| 1. Install anywhere | Shipped (1.0); bare `mlab init` defaults landed in 2.0. |
| 2. File protocol v1 | Shipped (`manuscript-lab.config.json`, `validate`, `report`). |
| 3. Deterministic checks and gate engine | Shipped; 2.0 tightened semantics (`todo` blocks, word floors, shared report/gate engine). |
| 4. Reviews as typed work orders | Shipped (`review`, `issues`); `workorder` never built — the report's per-blocker `fix:` commands took its job. |
| 5. Candidate arena | Shipped (`revise`/`compare`/`merge` with audits and taste gate). |
| 6. Claims and source grounding | Shipped deterministically (`evidence.*` requirement ids); model-backed `claims extract` is roadmap item 1. |
| 7. Agent skills as adapters | Shipped as Codex skill + `AGENTS.md` + MCP; the multi-package split never happened and is not planned. |
| 8. Model driver | Shipped, then contained: `mlab lab drive` is R&D under the promotion criterion, not a core surface. |
| 9. CI and PR workflows | Shipped (`docs/CI.md`, composite GitHub Action); hardening is roadmap item 3. |
| 10. Export through publishing tools | Partial: md/html default, epub/pdf explicit; docx is roadmap item 2; quarto/pandoc handoff unplanned. |
| 11. One excellent example | Shipped: `examples/technical-whitepaper` ends green, `examples/broken-whitepaper` demos blockers with fixes. |

## Do Not Prioritize Yet

Avoid spending early product energy on:

- desktop app
- complex web dashboard
- marketplace of agents
- full autonomous writing
- vector database dependency
- social/community features
- custom PDF typesetting engine
- Scrivener replacement
- Google Docs replacement

The near-term win is simpler:

```text
Install into any repo. Adopt the manuscript. Understand it. Check it. Review
it. Track issues. Generate candidates. Merge safely. Gate exports.
```

## Release Posture

- `0.x`: template, protocol drafts, install-anywhere alpha
- `1.x`: stable protocol, install-anywhere CLI, gates, issues, candidates,
  evidence checks, export manifests, CI workflow, and the lab build-out
- `2.0`: surface reorg around the protocol, stricter unified gates, blocker
  fix commands, `adopt`, MCP, and the lab containment with full back-compat
  aliases
- Next: the roadmap above, with the case study gating any lab promotion
