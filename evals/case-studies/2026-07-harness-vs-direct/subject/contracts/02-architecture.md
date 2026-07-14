<!--
id: 02-architecture
kind: document.section
status: todo
target_words: 500
purpose: Explain the file protocol that makes prose reviewable - section contracts, runtime packets, and the boundary that keeps files as the source of truth and models as operators.
acceptance:
  - Defines a section contract and lists at least four of its real fields.
  - Explains the layer boundary (file protocol, deterministic CLI, model layer, agent adapters) and why files remain the source of truth.
  - Cites [cite:architecture] and [cite:readme] at the claims they support.
checks:
  - claims.supported
  - style.violations
reviews:
  - cold.reader
  - contract.editor
-->
# The File Protocol
