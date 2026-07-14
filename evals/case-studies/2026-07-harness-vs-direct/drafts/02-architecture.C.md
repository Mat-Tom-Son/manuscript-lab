# The File Protocol

Manuscript Lab treats a manuscript as a set of files governed by a protocol, not as a chat session governed by memory. The protocol has one rule that shapes everything else: files are the source of truth, and models are operators that read and write them. Every other primitive exists to make that rule enforceable rather than aspirational.

## Section Contracts

Each file in `draft/` opens with a machine-checked section contract. A section contract is a YAML block that declares what the section is for and how its readiness will be judged. Its real fields include `kind` (the document type, such as `document.section`), `status` (a lifecycle state like `todo` or `done`), `target_words` (the word count the section must reach), `purpose` (a one-sentence statement of the section's job), `acceptance` (a list of conditions the section must satisfy), and `checks` (the deterministic validators the section must pass) [cite:readme]. The contract is not a comment. It is parsed by the CLI, and a section whose contract is missing or malformed fails `mlab check` before any prose is examined.

## Runtime Packets

Before a model drafts or revises a section, the harness compiles a runtime packet. The packet is a directory under `state/runtime/<section-id>/` containing `intent.md`, `context.json`, `rule-stack.yaml`, `criteria.json`, and `trace.json` [cite:architecture]. It records what context was visible to the model, what was excluded, which rules apply, and which criteria a reviewer or revision should use. The packet is durable. It lives in the repo, so a later reviewer or CI job can inspect what the model actually saw and hold the revision accountable to it. This is the mechanism that makes review file-based rather than chat-based: the evidence is on disk, not in a transcript that disappears when the session closes.

## The Layer Boundary

The system is built in four layers, and the boundary between them is what keeps files authoritative.

The first layer is the file protocol: the on-disk layout of contracts, state directories, issue ledgers, and draft sections. This is the source of truth. The second layer is the deterministic CLI, a zero-dependency Node tool that reads and writes those files [cite:readme]. It runs checks, composes packets, and emits reports without calling any model. The third layer is the model layer: model-backed checks, reviews, and lab features route through a provider library but write their outputs back into files under `state/` [cite:architecture]. The fourth layer is agent adapters: `AGENTS.md`, MCP server bindings, and skill files that tell agents how to operate the CLI [cite:architecture].

The boundary matters because each layer can only act through the one below it. A model cannot edit a draft directly. It composes a packet, produces a candidate, and the CLI writes the result. An agent cannot invoke a model outside the packet the CLI assembles. The CLI cannot invent rules that are not in the files. This stacking means that if the files say a section is not ready, no layer above can override that verdict. The protocol, not the model, decides what is true.

## Why Files Remain the Source of Truth

The layering exists to solve one problem: model output is unreliable in ways that file state is not. A model can hallucinate a citation, drop a constraint, or silently rewrite a paragraph. A file can be checked, diffed, and replayed. By forcing every operation through the file protocol, Manuscript Lab makes each step inspectable and each result auditable. The model proposes. The files dispose.