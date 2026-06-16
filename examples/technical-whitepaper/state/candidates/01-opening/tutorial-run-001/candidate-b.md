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

A context packet is the local bundle under `state/runtime/`: the target section,
visible files, excluded files, and criteria from the section contract. It does
not replace judgment. It gives the document owner a compact checklist for the
final review before export.
