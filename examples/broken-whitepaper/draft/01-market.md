<!--
id: 01-market
kind: research.paper.section
stage: draft
status: draft
target_words: 180
purpose: Demonstrate deterministic failure output for a flawed evidence section.
depends_on:
  - PROJECT.md
  - brief.md
  - outline.md
  - style.md
  - sources/index.md
  - state/claims.md
acceptance:
  - Shows at least one unsupported factual claim.
  - Contains citation markers that local evidence checks can find.
  - Keeps all failures fake, public, and inspectable.
checks:
  - claims.supported
  - style.violations
reviews:
  - contract.editor
-->
# Market Claims

The market section is written to look almost ready, but it deliberately leaves
evidence work unfinished. It says independent analysts found that documentation
teams recover forty percent of review time after adopting local prose CI
[citation-needed]. It also cites a missing benchmark key as if the source had
already been registered [cite:missing-benchmark].

## Adoption Pressure

The draft then repeats the same kind of argument in a different costume:
executives supposedly approve whitepaper budgets twice as fast when every claim
has a machine-readable evidence row. That number is not in the source index,
and the claim register marks it as needing review. This is the kind of confident
sentence a useful gate should stop before export.

## Adoption Pressure

The repeated heading is intentional. A static check should complain about it,
because duplicate headings make review comments and generated anchors harder to
trust.

#### Overdeep Detail

This final note uses a heading that is too deep for the local style rule. The
fixture should feel broken in boring, realistic ways: not spectacularly wrong,
just full of small release blockers that are easier to fix when the CLI names
them precisely.
