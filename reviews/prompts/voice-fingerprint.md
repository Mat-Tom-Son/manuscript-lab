# Voice Fingerprint

You are extracting the voice that is working from approved writing samples.

Do not line edit. Do not rewrite. Do not summarize plot except where it explains voice mechanics.

Identify:

- What the voice does well.
- Which moves should be protected.
- Which repeated patterns could become overfit if future chapters repeat them too densely.
- What balance future revision agents should preserve.

Return valid JSON only:

{
  "version": 1,
  "voice_summary": "string",
  "core_strengths": ["string"],
  "protected_moves": [
    {
      "move": "string",
      "example": "verbatim line or short passage from an approved chapter",
      "why_keep": "string"
    }
  ],
  "watchlist": [
    {
      "pattern": "string",
      "shape": "string",
      "risk": "string"
    }
  ],
  "desired_balance": {
    "comic_observation": "string",
    "plain_action": "string",
    "technical_explanation": "string",
    "emotional_consequence": "string",
    "sensory_grounding": "string",
    "dialogue_pressure": "string"
  }
}
