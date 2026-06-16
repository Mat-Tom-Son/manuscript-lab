<!--
id: 01-opening
kind: document.chapter
stage: draft
status: draft
target_words: 650
purpose: Introduce the sample packet workflow and show how durable review artifacts fit together.
depends_on:
  - PROJECT.md
  - brief.md
  - outline.md
  - style.md
  - sources/index.md
  - state/continuity.md
  - state/claims.md
acceptance:
  - Defines context packet, issue, candidate, audit, and export in plain language.
  - Uses only local fixture claims listed in state/claims.md.
  - Ends with a concrete operating promise a tutorial reader can verify.
checks:
  - claims.supported
  - style.violations
reviews:
  - cold.reader
  - contract.editor
-->
# Executive Summary

This whitepaper is a tutorial fixture. It does not describe a real customer,
private manuscript, proprietary benchmark, or deployed system. It gives a small
technical document enough structure to exercise the Manuscript Lab workflow in
public.

The sample problem is simple: a team needs a repeatable way to revise a document
without losing the reason for each change. In this fixture, the answer is a
three-step packet workflow: name the section contract, gather only the relevant
context, and verify each revision against the contract before exporting a reader
copy. The workflow is intentionally small so the file relationships stay visible
inside the repository.

A context packet is the local bundle under `state/runtime/`. It records the
target section, visible files, skipped or excluded files, and criteria generated
from the section contract. The packet does not replace judgment; it creates a
small place to write down what judgment should protect.

An issue is a durable review finding. A review dry-run can show which sensors
would run without calling a model provider. When a real review creates findings,
the operator triages them before revising. The issue in this fixture is already
accepted so a reader can see how a decision becomes revision input without
needing a provider key.

A candidate is an alternative complete revision of the same section. The sample
candidate run includes two manual variants. One preserves the original
structure and adds an owner-review sentence. The other compresses the workflow
into a shorter operating rule. Both are public examples, not model logs.

An audit compares a before snapshot with an after file. The static audit sample
records word-count movement and line changes without calling a provider. That is
enough to show the habit: preserve what works, name what changed, and verify
that the accepted issue was actually addressed.

An export is the reader-facing copy. This fixture includes Markdown and HTML
examples under `exports/`. A live run can regenerate them with `npm run export
-- --formats md,html --slug technical-whitepaper --author ""`.

The operating promise is modest: every visible claim in this sample document can
be found in `state/claims.md`, every sample source key appears in
`sources/index.md`, and every revision artifact is small enough to inspect
without private context.
