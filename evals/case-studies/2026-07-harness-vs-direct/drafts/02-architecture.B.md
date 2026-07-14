# The File Protocol

Manuscript Lab treats a manuscript the way a repository treats code: the files are the source of truth, and every tool that touches them is an operator that must leave a trace. The protocol that enforces this discipline rests on four layers, each with a fixed responsibility.

The lowest layer is the file protocol. Every section in `draft/` opens with a machine-checked section contract that declares what the section must accomplish and how its readiness will be judged [cite:readme]. A section contract is a front-matter block pinned to a single draft file. It carries at least the following fields:

- `status`: the section's lifecycle state; sections marked `todo` block release [cite:readme].
- `target_words`: the expected length; prose below 33 percent of this value blocks readiness [cite:readme].
- `purpose`: a plain statement of what the section is for.
- `acceptance`: the conditions that must hold before the section can pass a gate.
- `checks`: the deterministic checks that run against the file.
- `reviews`: the review passes required before the section is considered done.

These fields are not documentation. The CLI reads them, the gates evaluate them, and the report surfaces gaps in them [cite:readme].

Above the file protocol sits the deterministic CLI. It is a zero-dependency Node tool that humans, agents, and CI jobs share [cite:readme]. The CLI compiles runtime packets, runs checks, writes issues, and evaluates gates. A runtime packet is a per-section bundle assembled by `npm run compose` that records what context was visible, what was excluded, which rules apply, and which criteria a reviewer or revision should use [cite:architecture]. The packet lives under `state/runtime/<section-id>/` and contains `intent.md`, `context.json`, `rule-stack.yaml`, `criteria.json`, and `trace.json` [cite:architecture]. Because the packet is a file, a reviewer or agent can inspect exactly what the model saw before producing output.

The model layer sits above the CLI. Model-backed checks, reviews, and lab commands route through a provider library that supports OpenRouter, Lightning AI, and custom OpenAI-compatible endpoints [cite:readme]. The core workflow, however, is deterministic and needs no API keys [cite:readme]. Models do not write directly to draft files in the preferred flow. High-stakes revisions run as candidates that go through blind comparison, a taste arbiter, a merge step, and a diff audit before they touch the accepted draft [cite:architecture]. This prevents a model review from becoming an unexamined rewrite instruction [cite:architecture].

The top layer consists of agent adapters. The harness includes an agent-facing workflow layer encoded in `AGENTS.md`, skills, prompts, and operator guides [cite:architecture]. This layer sets operating rules: write durable prose in files, compose runtime packets before work, treat reviews as sensors rather than decisions, triage issue-ledger findings before editing, and run the done gate before calling work complete [cite:architecture]. Agents connect through an MCP server exposed by `mlab mcp`, which presents the protocol as typed tools with safety annotations [cite:readme].

The layer boundary matters because it keeps files as the source of truth. The reusable harness, the agent workflow adapter, and the user project workspace are physically separated; project content lives under `projects/active/<slug>/workspace/` and is symlinked into the root at runtime so scripts see simple paths while infrastructure stays distinct from user writing [cite:architecture]. The public repo tracks harness files only; drafts, state, and exports are ignored by default so that authors can version their manuscripts independently [cite:architecture]. A model can propose changes, but a change is not real until it is a file the CLI can check and a gate can evaluate.