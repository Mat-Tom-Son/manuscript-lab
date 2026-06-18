# Writers' Room Workflow Research

Manuscript Lab is already close to a writers' room operating system: it has
contracts, runtime packets, typed notes, issue triage, candidate rewrites,
blind comparison, taste gates, diff audits, and done gates. The strongest next
move is not to imitate a TV room theatrically. It is to extract the durable
behaviors that make good rooms work and express them as file-backed rituals.

The working principle:

```text
foundation diagnosis -> room energy -> durable cards -> accountable decisions -> assigned draft work -> table-read feedback -> controlled rewrites
```

Implemented MVP:

```bash
npm run room -- diagnose draft/<section>.md
npm run room -- blue-sky draft/<section>.md
npm run room -- blue-sky draft/<section>.md --models lightning:lightning-ai/gpt-oss-120b,openrouter:qwen/qwen3.7-plus
npm run room -- decide draft/<section>.md --run <room-run-id> --select idea-001 --reason "..."
npm run room -- break draft/<section>.md --run <room-run-id>
npm run room -- table-read draft/<section>.md
npm run review:run -- --passes room.table_read --panel lightning.clean draft/<section>.md
npm run review:run -- --passes scene.turn --panel lightning.clean draft/<section>.md
```

Current room artifacts live under
`state/room/<section-id>/<room-run-id>/`. The feature diagnoses story-foundation
readiness, generates options, records decisions, materializes causal beat
boards, and prepares table-read packets; it does not rewrite manuscript prose
directly.

## Research Synthesis

### Every Room Is Different, So Encode Primitives

Eric Haywood's Writers' Room 101 series is useful partly because it refuses one
universal recipe. He emphasizes that rooms vary by showrunner, genre, schedule,
and temperament, while still sharing recognizable operations: pitching, breaking,
drafting, rewriting, table reads, and production follow-through.

For Manuscript Lab, this argues against a single monolithic "writers room"
prompt. The product should expose small primitives that can be combined per
project:

- blue-sky ideas
- beat breaking
- blend / sequence
- showrunner decision
- draft assignment
- notes triage
- table read
- punch-up / rewrite
- continuity and evidence pass

Source: [Writers' Room 101 introduction](https://scriptmag.com/features/writers-room-101-introduction).

### The Showrunner Decides; The Room Supplies Options

Effective rooms are collaborative, but not consensus-driven. The showrunner,
head writer, or episode owner has accountable creative authority. The WGA treats
showrunning as a distinct leadership craft, and its Showrunner Training Program
exists to prepare senior writer-producers for that role.

This maps cleanly to Manuscript Lab's existing stance:

- model reviews are sensors
- issue ledger decisions are the decision surface
- the human/project owner is the showrunner
- candidate comparison informs, but does not authoritatively own, the final call

Pixar's Braintrust model reinforces the same separation. Candid peers can point
at problems and suggest possibilities, but the director keeps authority over
which advice to use. That is almost exactly the desired relationship between
model panels, candidate arenas, and a human writer.

Sources:

- [WGA Showrunner Training Program](https://www.wga.org/members/programs/showrunner-training)
- [How Pixar Fosters Collective Creativity](https://hbr.org/2008/09/how-pixar-fosters-collective-creativity)

### Safety Produces Better Raw Material

Writers' rooms depend on privacy. Haywood's famous rule is "What's said in the
room stays in the room." The practical reason is not mystique; it is throughput.
People need to pitch bad ideas, vulnerable memories, half-formed jokes, and
unfashionable possibilities without worrying that raw material will leak.

For Manuscript Lab, this means room artifacts should default to ignored project
state, not public harness docs:

```text
state/room/
projects/active/<slug>/logs/room/
```

A room workflow should also distinguish:

- public project canon
- private idea exploration
- accepted decisions
- parked ideas
- rejected ideas

Only accepted decisions should graduate into `outline.md`, section contracts,
`state/continuity.md`, `state/claims.md`, or manuscript prose.

Sources:

- [Writers' Room 101: The Most Important Rule](https://scriptmag.com/features/writers-room-101-important-rule)
- [WGA AI guidance](https://www.wga.org/contracts/know-your-rights/artificial-intelligence)

### Blue-Sky Is Real, But Unstructured Brainstorming Has Losses

Rooms often begin with broad idea generation. The useful part is option volume,
cross-pollination, and permission to say the weird thing. The risky part is that
live group brainstorming can lose ideas through turn-taking, dominance, and
evaluation pressure.

Research on brainstorming productivity repeatedly points to production blocking:
people cannot all speak at once, and ideas can decay while someone waits. The
product implication is simple: use silent or asynchronous idea capture before
group evaluation.

Recommended Manuscript Lab pattern:

```text
silent pitch cards -> grouped board -> showrunner selects or parks -> beat break
```

This is especially important for agentic workflows. Multiple model calls should
not read one another's raw brainstorm before proposing options; otherwise they
collapse toward the same shape.

Sources:

- [Productivity Loss in Brainstorming Groups](https://homepages.se.edu/cvonbergen/files/2013/01/Productivity-Loss-In-Brainstorming_Toward-the-Solution-of-a-Riddle.pdf)
- [Writers' Room 101: Beats, Breaking, and Blending](https://scriptmag.com/features/writers-room-101-beats-breaking-blending)

### Break Beats Before Writing Pages

A key writers' room habit is turning vague pitches into visible beats. Haywood
describes breaking as moving from ideas into concrete story pieces, then blending
those pieces into a script order. This is one of the clearest opportunities for
Manuscript Lab.

Today, section contracts and `outline.md` carry structure, while candidate
revisions operate after an issue exists. A writers' room layer would add a
pre-draft beat board:

```text
state/room/<section-id>/beat-board.json
```

Suggested beat-card shape:

```json
{
  "id": "beat-004",
  "lane": "A",
  "job": "turn",
  "visible_event": "The character/document encounters the constraint.",
  "pressure": "Why this cannot wait.",
  "reader_question": "What the reader should wonder here.",
  "exit_state": "What changed by the end of the beat.",
  "risks": ["too much explanation", "continuity debt"],
  "status": "selected"
}
```

For nonfiction, the lanes can be argument spine, evidence, reader objection,
example, and implication rather than A/B/C story.

Source: [Writers' Room 101: Beats, Breaking, and Blending](https://scriptmag.com/features/writers-room-101-beats-breaking-blending).

### The Episode Writer Is The Custodian

Television workflows often distinguish room authorship from draft ownership. One
Television Academy remembrance of Steven Bochco frames the episode writer as the
story custodian and stresses that scripts must be ready before production.

For Manuscript Lab, add a section-level custodian concept:

```yaml
owner: human-or-agent-name
decision_owner: human
room_status: blue_sky | broken | assigned | drafted | table_read | revised
```

This is useful even in a solo writing project. It makes explicit who is allowed
to decide, who is only reviewing, and what stage the section has reached.

Source: [What Would Steven Do?](https://www.televisionacademy.com/features/news/features/what-would-steven-do).

### Table Reads Are Reader-Energy Tests

A table read is not just another proofreading pass. It reveals pacing, energy,
voice, confusion, and tonal drift under embodied reading. Manuscript Lab already
has `cold.reader`, `line.editor`, and export flows; a room layer should add a
`room.table_read` pass that asks different questions:

- Where does attention leave?
- Which lines are hard to perform or parse aloud?
- Which turn is not audible?
- Which joke, claim, or emotional beat lands late?
- Which line should be protected because it carries the room?

For prose, this can be a human read-aloud ritual plus an optional model-backed
sensor. The output should become issues or protected-line notes, not a rewrite.

Sources:

- [Abbott Elementary writers room event](https://www.wgfoundation.org/events/all/2022/6/23/inside-the-writers-zoom-with-abbott-elementary-2tngh)
- [Television Academy: Abbott Elementary table-read detail](https://www.televisionacademy.com/features/online-originals/abbott-elementary-writer-chad-morton-interview)

### Good Notes Motivate Direction, Not Defensiveness

Scriptnotes' "Notes on Notes" frames feedback as a psychologically loaded
exchange: bad notes can trigger fight-or-flight, while good notes help the writer
move toward a creative vision. Manuscript Lab's typed issue ledger already
implements the important part: feedback must become bounded, local, evidence-led
work before it drives revision.

Room workflows should preserve this standard. A room note is not automatically an
issue. It can be:

- `accept`: revise from it
- `reject`: false positive or wrong project direction
- `defer`: useful but not now
- `park`: good raw material for another section
- `convert_to_contract`: a structural requirement
- `convert_to_taste`: a project taste rule
- `convert_to_check`: repeatable mechanical or semantic gate

Source: [Scriptnotes: Notes on Notes](https://johnaugust.com/2019/scriptnotes-ep-399-notes-on-notes).

### Effective Teams Need Safety, Clarity, Meaning, And Impact

Google's Project Aristotle work identifies five useful team dynamics:
psychological safety, dependability, structure and clarity, meaning, and impact.
Those translate well into a local writing harness:

- safety: private raw room state and non-punitive option generation
- dependability: issue IDs, owners, verification commands, done gates
- structure and clarity: section contracts, runtime packets, room stages
- meaning: brief, reader contract, taste doctrine
- impact: reports, exports, gate results, issue closure

Source: [Google re:Work: Understand team effectiveness](https://rework.withgoogle.com/intl/en/guides/understand-team-effectiveness).

### Modern Rooms Are Also Labor And Authorship Systems

WGA's 2023 agreement formalized minimum staffing and duration provisions for
many episodic rooms, and its AI guidance says AI-generated material is not a
writer under the MBA. Manuscript Lab is not a WGA-covered room, but the product
lesson is important: do not blur human authorship, decision authority, or
creative labor provenance.

This supports the repo's "anti AI book generator" position. A room feature should
make authorship clearer, not fuzzier.

Sources:

- [WGA 2023 MBA summary](https://www.wgacontract2023.org/the-campaign/summary-of-the-2023-wga-mba)
- [WGA showrunners' guide to room provisions](https://origin.www.wga.org/contracts/contracts/mba/showrunners-guide-to-2023-mba-writers-room-provisions)
- [WGA AI guidance](https://www.wga.org/contracts/know-your-rights/artificial-intelligence)

## Recommended Workflow Layer

Add an optional writers' room layer that sits between `compose` and drafting or
between accepted issue triage and candidate revision.

### Pre-Draft Room

```text
status
-> compose section
-> room:blue-sky
-> room:break
-> room:decide
-> update outline / section contract
-> draft
-> check
```

Purpose: create better raw material before prose exists.

Artifacts:

```text
state/room/<section-id>/
  <room-run-id>/
    manifest.json
    room-packet.json
    role-casts.json
    visible-files.json
    independent/
    idea-cards.jsonl
    clusters.json
    stress-tests.json
    decision-log.md
    ROOM_REPORT.md
    output/
```

### Revision Room

```text
review
-> triage issues
-> room:rewrite-options
-> plan:revision
-> revise:candidates
-> compare:candidates
-> taste:arbiter
-> merge:winner
-> diff:audit
```

Purpose: use room-style pitching before generating full candidate rewrites.

This should produce `fix_options` on accepted issues so candidate generation can
vary structure more intentionally than the current static strategy list.

### Table-Read Room

```text
export or render section
-> human read-aloud or model table-read sensor
-> issue ledger import
-> punch-up candidates for accepted issues
-> done gate
```

Purpose: catch energy, voice, and performance problems that contract checks miss.

## Big Swing: Room Protocol V1

The ambitious version is a room protocol, not a pile of prompts. A room run is a
reproducible orchestration event with a goal, visible context, independent model
roles, durable artifacts, and a convergence step.

```text
compile room packet
-> cast model roles
-> run independent pitches
-> cluster without judging
-> ask targeted stress roles
-> human/showrunner decision
-> materialize beat board or issue fix-options
-> verify with gates
```

This would make Manuscript Lab unusually strong because it uses models for the
part of writing rooms where they are genuinely helpful: multiplying plausible
options, surfacing blind spots, and stress-testing consequences. It keeps humans
in charge of taste, authorship, and final direction.

### Room Packet

`npm run compose` currently builds a section runtime packet. A room packet would
be a sibling operation:

```bash
mlab room diagnose draft/<section>.md
mlab room blue-sky draft/<section>.md
mlab room decide draft/<section>.md --run <room-run-id> --select idea-001 --reason "..."
mlab room break draft/<section>.md --run <room-run-id>
mlab room table-read draft/<section>.md
```

Output:

```text
state/room/<section-id>/<room-run-id>/
  room-packet.json
  visible-files.json
  role-casts.json
  independent/
  clusters.json
  stress-tests.json
  decision-log.md
  output/
```

The packet should record:

- operation: `blue_sky`, `break`, `rewrite_options`, `table_read`, `punch_up`
- target section
- source hashes
- visible context and excluded files
- role roster
- model/provider metadata
- privacy level
- human decision owner
- expected output artifact

### Model Roster

Instead of "run three models," cast roles with different permissions and
temperatures. Example roster:

```json
{
  "roles": [
    {
      "id": "story_engine",
      "job": "Find structural turns and causal pressure.",
      "context_pack": "informed.editor",
      "temperature": 0.8
    },
    {
      "id": "character_room",
      "job": "Pitch choices that reveal character under pressure.",
      "context_pack": "taste.editor",
      "temperature": 0.85
    },
    {
      "id": "reader_advocate",
      "job": "Predict where a cold reader loses the thread.",
      "context_pack": "blind.section_only",
      "temperature": 0.4
    },
    {
      "id": "continuity_cop",
      "job": "Flag canon, evidence, source, or downstream debt.",
      "context_pack": "continuity.pack",
      "temperature": 0
    },
    {
      "id": "wild_card",
      "job": "Offer non-obvious shapes without drafting prose.",
      "context_pack": "informed.editor",
      "temperature": 1.0
    }
  ]
}
```

The important move is context asymmetry. A cold-reader role should not see the
outline. A continuity role should see canon but not be asked for vibe. A wild
card should generate alternatives but have no authority to update state.

### Divergence Before Convergence

The room should deliberately separate phases:

```text
diverge: generate cards independently
organize: cluster and dedupe
stress: ask specialist roles what breaks
decide: human/showrunner selects, rejects, or parks
materialize: write beat board, contract patch, or issue fix-options
```

This borrows from real rooms and also counters model collapse. If every role sees
the same previous model output, the run becomes a consensus machine too early.

### Room Telemetry

A clever model system should measure its own usefulness. Add a room report that
tracks:

- number of independent cards generated
- novelty / duplication rate
- selected, rejected, and parked card counts
- accepted issue fix-options created
- candidate diversity after `revise:candidates`
- comparison instability rate
- taste gate failures
- diff-audit regression rate
- human overrides

This turns taste work into accumulated process knowledge without pretending that
quality is a single score.

### Persistent Taste Memory

The existing `taste/accepted_patches/` and `taste/rejected_patches/` direction is
the right compounding asset. A big-swing room feature should let a human promote
room outcomes into taste memory:

```bash
mlab room promote draft/<section>.md --run <room-run-id> --card idea-014 --to accepted-patches
mlab room promote draft/<section>.md --run <room-run-id> --candidate candidate-c --to rejected-patches
```

This is how the system learns project taste without fine-tuning or pretending
that generic model preference equals the author's preference.

### Room As A Board, Not A Chat

Avoid building toward a chat transcript. The useful interface is closer to a
board:

- cards
- lanes
- clusters
- selected/parked/rejected states
- evidence links
- risk notes
- owner/decision fields
- exportable room report

The CLI can write JSON/Markdown first. A future UI could render the same files as
a beat board or notes board.

## Clever Model Leverage

### Use Models For Roles, Not Personae Theater

The roster should name editorial functions, not pretend personalities. Good
roles are specific and falsifiable:

- "Find three beat orders that change the reader question by the midpoint."
- "List unsupported factual dependencies introduced by these pitch cards."
- "Name which candidate loses the strongest protected line."
- "Generate five punch-up alternatives for this beat without changing facts."

Weak roles are vague:

- "Be the funny writer."
- "Be a genius showrunner."
- "Make this better."

### Generate Options At The Smallest Useful Unit

Full-section candidate rewrites are expensive and sometimes too late. Add model
passes at smaller units:

- premise cards before outline changes
- beat cards before drafting
- fix-options before candidate rewrites
- line alternatives only after a table-read issue is accepted
- evidence questions before claims are written into prose

This uses models where variance is cheap and preserves the manuscript from
thrash.

### Make Some Models Blind On Purpose

The repo already has `blind.section_only`. Lean into that. A good room run should
include blinded and informed roles, then compare their disagreement:

```text
blind reader says: "I expect X."
informed editor says: "The outline intends Y."
room output: either revise the section, update the contract, or accept the gap.
```

That disagreement is valuable. It catches cases where the writer's private plan
has not become reader-visible.

### Use Cheap Models For Volume, Strong Models For Judgment

A good orchestration pattern:

```text
cheap/diverse models -> generate many cards
middle models -> cluster, dedupe, label risks
strong/taste-aware model -> stress-test finalists
human -> decide
```

The candidate arena already points this way. The room layer should apply the same
economics before prose generation.

### Make The System Ask Better Human Questions

One of the most helpful outputs is not prose. It is a crisp decision request:

```text
You need to choose one:
A. Make this section about character pressure.
B. Make this section about evidence credibility.
C. Split the job across two sections.
```

That belongs in `state/open-questions.md` or `state/room/.../decision-log.md`.
The model's job is to reduce fog, not to pretend the hard choice disappeared.

### Add Negative Capability

Rooms often protect ideas by not using them yet. Manuscript Lab should make
parking first-class:

```json
{
  "card_id": "idea-022",
  "status": "parked",
  "reason": "Good for later, but it steals the section turn.",
  "revisit_when": "after draft/04-consequences.md"
}
```

This is useful for writers because it lowers the emotional cost of cutting a good
idea. The idea is not dead; it is out of the current section's way.

## Prompt And Suite Additions

### `room.blue_sky`

Inputs:

- `PROJECT.md`
- `brief.md`
- `outline.md`
- `style.md`
- relevant `taste/`
- `state/continuity.md`
- target section contract
- runtime criteria

Output:

```json
{
  "cards": [
    {
      "id": "idea-001",
      "type": "scene | argument | object | joke | reversal | evidence | image | question",
      "pitch": "one concrete possibility",
      "why_it_might_work": "reader or project effect",
      "risks": ["risk"],
      "depends_on": ["canon/source/decision"],
      "not_a_draft": true
    }
  ],
  "do_not_use_yet": ["ideas that are tempting but unsafe"],
  "questions_for_showrunner": ["decision needed"]
}
```

Rules:

- Generate options, not prose.
- Do not evaluate too early.
- Do not read other model cards during independent generation.
- Use `[citation-needed]` for factual dependencies that lack support.

### `room.break_story`

Inputs:

- selected idea cards
- section contract
- outline
- runtime criteria

Output: `beat-board.json`.

Rules:

- Every selected beat needs an exit-state change.
- Every beat should carry pressure, not just information.
- For nonfiction, every evidence beat needs a source key or `[citation-needed]`.
- Park good ideas that do not serve the section purpose.

### `room.showrunner_decision`

This can be a human-filled prompt/template rather than model-owned judgment.

Output:

```markdown
# Room Decision

Target:
Decision owner:
Selected cards:
Rejected cards:
Parked cards:
Reason:
Risks accepted:
Files to update:
Verification:
```

The model may summarize tradeoffs, but the final decision should be marked human
unless the user explicitly delegates it.

### `room.table_read`

A review pass, not a draft pass.

Context pack: target section only, optionally stripped of contract for a reader
view.

Output issues:

- attention drop
- unclear turn
- line hard to read aloud
- tone mismatch
- joke or emotional beat misfire
- protect line

This belongs in `reviews/suite.json`, probably non-blocking by default.

### Candidate Strategy Tweaks

The current `revision-candidates.mjs` rotates through generic strategies. A
room-informed version should optionally derive strategies from accepted
`fix_options` or use named room roles:

- story-spine candidate
- character-pressure candidate
- compression candidate
- voice-preservation candidate
- reader-clarity candidate
- evidence/continuity candidate
- punch-up candidate

This keeps the candidate arena from producing three versions of the same local
patch.

## Minimal Implementation Plan

1. Add `docs/WRITERS_ROOM_WORKFLOWS.md`.
2. Add a `templates/room-session.md` or `templates/room-session.json`.
3. Add `state/room/` to the documented project map and keep it ignored.
4. Add `room.table_read` as a review pass and prompt.
5. Add a `room` command namespace:

```bash
mlab room diagnose draft/<section>.md
mlab room blue-sky draft/<section>.md
mlab room break draft/<section>.md
mlab room decide draft/<section>.md
mlab room table-read draft/<section>.md
mlab room report draft/<section>.md
```

6. Teach `revise:candidates` to consume accepted issue `fix_options` as candidate
   strategies when present.
7. Add tests for generated room artifacts staying under the manuscript root in
   config-first install-anywhere projects.

## Product Guardrails

- Do not create an "agent swarm" feature. Create room artifacts and commands.
- Keep raw room notes private by default.
- Keep human authorship and final decisions explicit.
- Do not let model-generated ideas mutate canon without accepted decisions.
- Do not let table-read feedback rewrite prose directly.
- Do not make consensus the gate. Use evidence, taste, and accountable judgment.
- Prefer small room rituals that produce files over one giant prompt.

## How This Fits The Current Repo

The strongest fit points are already present:

- `npm run compose` is room prep.
- `reviews/suite.json` is the staff roster.
- `state/issues/issue-ledger.json` is the notes board.
- `plan:revision` is the rewrite assignment.
- `revise:candidates` is the room pitching alternate fixes.
- `compare:candidates` is the blind read.
- `taste:arbiter` is the project taste gate.
- `diff:audit` is the post-room accountability check.
- `done` is production readiness.

The missing layer is upstream: a structured way to generate, park, select, and
break ideas before drafting, and a post-draft table-read ritual that captures
reader energy without collapsing into generic line editing.
