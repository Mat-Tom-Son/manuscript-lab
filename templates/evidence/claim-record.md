# Claim Record Template

Markdown register row:

```markdown
| ID | Claim | Section | Locator | Kind | Source | Source Locator | Status | Risk | Citation | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| claim-000 | Write the claim exactly enough that another reader can find it. | draft/00-section.md | heading: Section heading | factual | `source-key` | p. 1 | unsupported | medium | [citation-needed:claim-000] | Explain current evidence state. |
```

Structured record shape:

```yaml
id: claim-000
schema_version: 1
section: draft/00-section.md
locator: "heading: Section heading"
kind: factual
status: unsupported
risk: medium
text: "Write the claim exactly enough that another reader can find it."
normalized_text: ""
support:
  - source: source-key
    locator: "p. 1"
    relation: supports
    strength: moderate
    checked_at: YYYY-MM-DD
    checked_by: human
    note: "Explain how this source supports the claim."
citation:
  required: true
  status: missing
  placeholder: "[citation-needed:claim-000]"
notes: ""
```
