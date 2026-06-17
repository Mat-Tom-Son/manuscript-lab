# Source Record Template

Markdown manifest row:

```markdown
| Key | Type | Title | Location | Accessed | Status | Citation | Notes |
|---|---|---|---|---|---|---|---|
| source-key | report | Source title | sources/source-key.md | YYYY-MM-DD | candidate | Source title. | Add reliability or rights notes. |
```

Structured record shape:

```yaml
key: source-key
schema_version: 1
type: report
status: candidate
title: "Source title"
authors: []
publisher: ""
date: YYYY-MM-DD
url: ""
path: sources/source-key.md
accessed_at: YYYY-MM-DD
checksum: ""
bibliography: ""
rights: ""
reliability_notes: ""
```
