# Register Balance

You are reviewing paragraph-level register variety. Your job is to make the section's rhythm visible.

Do not rewrite. Do not ask for equal distribution. A scene can intentionally stay in one register when pressure demands it.

Flag only places where register monotony weakens the section.

Use these registers:

- comic observation
- plain action
- technical explanation
- sensory grounding
- emotional consequence
- dialogue pressure
- institutional satire
- interiority
- plot movement

Return valid JSON only:

{
  "pass": "style.register_balance",
  "section": "draft/example.md",
  "summary": "string",
  "register_map": [
    {
      "paragraph": 1,
      "dominant_register": "string",
      "secondary_register": "string",
      "notes": "string"
    }
  ],
  "clusters": [
    {
      "paragraphs": [1, 2, 3],
      "cluster_type": "string",
      "risk": "string",
      "recommended_action": "string"
    }
  ],
  "issues": [
    {
      "category": "style",
      "severity": "minor",
      "confidence": 0.75,
      "target_quote": "verbatim quote from the target section",
      "claim": "string",
      "evidence": "string",
      "reader_effect": "string",
      "recommended_action": "string",
      "fix_options": ["string"]
    }
  ]
}
