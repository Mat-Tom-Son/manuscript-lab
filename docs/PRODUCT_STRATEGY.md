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

## Fit With The Current Repo

This strategy works with the GitHub repo that exists today.

The current public repo is a good v0.1 foundation because it already has the
right bones:

- file-based project state
- section contracts
- runtime context packets
- static and model-backed checks
- typed review suites
- an issue ledger
- candidate revisions
- blind comparison
- a taste arbiter gate
- diff audit
- model-provider routing
- export and done gates
- optional agent workflow adapters under `.pi/`
- `npm run doctor` for local setup diagnostics

The current repo is still template-first. Users clone or use the GitHub template,
then initialize a project inside the repo. That is acceptable for v0.1, but it is
not the final product shape.

The next major product step is install-anywhere usage:

```bash
npm install -D manuscript-lab
npx mlab init --profile whitepaper
npx mlab doctor
```

That shift should not throw away the current work. It should package the same
protocol, checks, reviews, and workflow into a cleaner CLI that can operate in
any writing repository.

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

Target flow:

```bash
mlab revise issue-017 --candidates 3
mlab compare issue-017
mlab merge issue-017 --winner b
mlab audit issue-017
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
  "formats": ["docx", "pdf"],
  "gates_passed": ["manuscript-ready", "citation-ready"],
  "unresolved_issues": 0
}
```

## Roadmap

### Phase 1: Install Anywhere

Goal: make Manuscript Lab work inside an arbitrary writing repo.

Target adoption test:

```bash
mkdir my-whitepaper
cd my-whitepaper
npm init -y
npm install -D manuscript-lab
npx mlab init --profile whitepaper
npx mlab doctor
```

Key work:

- remove assumptions that the harness owns the repository root
- support a project root such as `manuscript/`
- preserve template-first usage for people who like that workflow
- add installed-package end-to-end tests
- keep `package.json` private until this is real

### Phase 2: File Protocol V1

Goal: define the stable schema before adding more features.

Target layout:

```text
manuscript-lab.config.json
manuscript/
  brief.md
  outline.md
  style.md
  draft/
  claims/
  sources/
  state/
    runtime/
    issues/
    candidates/
    audits/
    gates/
    model-calls/
  exports/
```

Target config:

```json
{
  "schemaVersion": 1,
  "profile": "whitepaper",
  "root": "manuscript",
  "draftGlob": "draft/*.md",
  "stateDir": "state",
  "exportsDir": "exports"
}
```

Commands to add:

```bash
mlab validate
mlab next
mlab report
```

### Phase 3: Deterministic Checks And Gate Engine

Goal: make checks trustworthy before making model review bigger.

Baseline checks:

- missing required files
- invalid section frontmatter
- broken internal links
- duplicate headings
- word count outside contract
- empty citation placeholders
- unsupported claim markers
- unresolved blocker issues
- stale runtime packets
- candidate runs without audits
- exports created without passing gates

Target gate config:

```yaml
gate:
  id: section-ready
  applies_to: draft/*.md
  requires:
    - contract_satisfied
    - no_blocker_issues
    - citations_resolved
    - word_count_in_band
    - no_ai_residue_flags
    - export_clean
```

Target commands:

```bash
mlab gate draft/04-market.md
mlab gate manuscript --profile whitepaper
```

### Phase 4: Reviews As Typed Work Orders

Goal: make every review produce actionable records.

Target commands:

```bash
mlab review draft/04-pricing.md --panel evidence
mlab issues list
mlab issues triage issue-017 --status accepted
mlab workorder draft/04-pricing.md
```

### Phase 5: Polish The Candidate Arena

Goal: make controlled revision experiments the standout demo.

Target trail:

- original section
- issue being solved
- candidates A/B/C
- comparison result
- selected winner
- merge diff
- post-merge checks
- human approval

Pitch:

```text
Never let an AI silently overwrite your manuscript again.
```

### Phase 6: Claims And Source Grounding

Goal: make nonfiction and research workflows materially stronger.

Target commands:

```bash
mlab claims extract draft/04-pricing.md
mlab claims list --unsupported
mlab sources add path/to/source.pdf
mlab citations check
mlab evidence report
```

The gate should eventually fail on unsupported factual claims, unresolved
citation placeholders, missing bibliography entries, and stale source mappings.

### Phase 7: Agent Skills As Adapters

Goal: let agents use the protocol without becoming the protocol.

Initial Codex adapter:

```text
skills/codex/manuscript-lab/
```

Target package shape:

```text
packages/core
packages/cli
skills/claude
skills/codex
skills/cursor
skills/gemini
skills/pi
```

Agent instructions should say:

- compose context before drafting, review, or revision
- write review findings as typed issues
- use candidate revisions for high-stakes changes
- merge only after a winner is selected
- run gates before export

### Phase 8: CI And Pull Request Workflows

Goal: make "writing like software" easy.

Target GitHub Action:

```yaml
name: manuscript-lab
on:
  pull_request:
  push:
jobs:
  manuscript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npx mlab validate
      - run: npx mlab check
      - run: npx mlab gate manuscript --static-only
```

Advanced PR workflow:

- validate schema
- check section contracts
- check claims
- check unresolved blockers
- build export preview
- comment with manuscript status

### Phase 9: Export Through Existing Publishing Tools

Goal: make export a release step.

Target commands:

```bash
mlab export --format md
mlab export --format docx
mlab export --format html
mlab export --format quarto
mlab export --format pandoc
```

Exports should require gates unless explicitly overridden:

```bash
mlab export --format docx
# FAIL: manuscript-ready gate has not passed

mlab export --format docx --allow-dirty
# Creates export but marks manifest dirty.
```

### Phase 10: One Excellent Example Project

Goal: create one demo that shows the full lifecycle.

Start with:

```text
examples/technical-whitepaper/
examples/broken-whitepaper/
```

The polished example should show:

- `mlab doctor`
- `mlab check`
- `mlab review`
- `mlab issues list`
- `mlab revise`
- `mlab compare`
- `mlab merge`
- `mlab gate`
- `mlab export`

The broken example should be deliberately useful: unsupported claims, missing
contracts, stale citations, duplicate arguments, unresolved blockers, and a dirty
export gate.

## Target Public CLI

Keep the public CLI small:

```text
mlab init
mlab doctor
mlab status
mlab import
mlab compose
mlab check
mlab review
mlab issues
mlab workorder
mlab revise
mlab compare
mlab merge
mlab claims
mlab sources
mlab gate
mlab export
```

Hide low-level scripts behind coherent subcommands.

Good:

```bash
mlab review --panel continuity --strict
```

Bad:

```bash
npm run review:panel:continuity:strict:v2
```

## Killer Demo

The demo should not be "watch AI write a chapter."

It should be:

```bash
npm install -D manuscript-lab
npx mlab init --profile whitepaper
npx mlab import draft.md
npx mlab doctor
npx mlab check
```

Output:

```text
Manuscript Lab found:
- 3 missing section contracts
- 8 unsupported factual claims
- 2 duplicate arguments
- 4 stale citation placeholders
- 1 unresolved blocker issue
- export gate not ready
```

Then:

```bash
npx mlab review draft/03-market.md --panel evidence
npx mlab issues list --blockers
npx mlab revise issue-017 --candidates 3
npx mlab compare issue-017
npx mlab merge issue-017 --winner b
npx mlab gate
npx mlab export --format docx
```

Final output:

```text
PASS manuscript-ready
PASS citation-ready
PASS export-ready
Created:
exports/my-whitepaper.docx
exports/export-manifest.json
```

That is the moment people understand the product.

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
Install into any repo. Understand the manuscript. Check it. Review it. Track
issues. Generate candidates. Merge safely. Gate exports.
```

## Release Posture

The GitHub repo can keep moving as a template-friendly public project while the
install-anywhere workflow stays boring and reproducible.

Recommended release line:

- `0.1.x`: public template, docs, doctor, hygiene, onboarding, sample fixture
- `0.2.x`: CI, protocol v1 draft, gate spec, install-anywhere design
- `0.3.x`: installable package workflow
- `0.4.x`: gate engine and profile validation
- `0.5.x`: claim/source spine
- `1.0.0`: stable protocol, install-anywhere CLI, gates, issues, candidates,
  evidence checks, export manifests, and CI workflow
