// Per-model-family narrative tendencies observed by StoryScope (Russell et al.
// 2026, arXiv:2604.03136, Tables 5 and 16) on one-shot short-story generation.
// Directional watch notes for drafting sessions — not measurements of any
// particular output, and never evidence of authorship.
const FINGERPRINTS = [
  {
    family: "claude",
    match: /claude|sonnet|opus|haiku|fable/i,
    narrative_watch: [
      "flat event escalation — stakes may plateau instead of compounding",
      "epilogue habit — quiet wind-down endings over consequential ones",
      "reverent, convention-honoring storytelling; subversion is rare unless asked for",
      "uniform narrative voice across characters",
    ],
    length_note: "closest of the five to explicit word targets (16.6% mean absolute error; 38% of stories within 10%)",
  },
  {
    family: "gpt",
    match: /\bgpt|openai|o[0-9]+\b/i,
    narrative_watch: [
      "gossip and rumor as a default plot mechanism",
      "retrospective framing — stories told from years or decades later",
      "reconciliations left partial or ambiguous",
      "expectation subversion as a tic rather than a choice",
    ],
    length_note: "unreliable on explicit word targets (40.2% mean absolute error; only ~10% of stories within 10%, overshooting on average)",
  },
  {
    family: "gemini",
    match: /gemini|google/i,
    narrative_watch: [
      "tidy endings with extended denouements",
      "bleak, oppressive setting mood by default",
      "frequent flashbacks as the go-to time device",
    ],
    length_note: "typically writes about half the requested length (36.9% mean absolute error; mean ~3.1k words against ~6.2k targets)",
  },
  {
    family: "deepseek",
    match: /deepseek/i,
    narrative_watch: [
      "front-loaded context — crucial backstory dumped early instead of revealed",
      "evenly interleaved plot and atmosphere regardless of scene job",
    ],
    length_note: "typically writes about half the requested length (39.9% mean absolute error)",
  },
  {
    family: "kimi",
    match: /kimi|moonshot/i,
    narrative_watch: [
      "sits at the generic center of narrative space — few distinctive choices of any kind; push hard on specificity",
      "in-media-res openings and in-action character introductions as reflex",
    ],
    length_note: "typically writes about half the requested length (35.2% mean absolute error)",
  },
];

export function fingerprintForModel(modelId) {
  const id = String(modelId ?? "");
  if (!id) return null;
  const entry = FINGERPRINTS.find((candidate) => candidate.match.test(id));
  if (!entry) return null;
  return {
    family: entry.family,
    model: id,
    narrative_watch: [...entry.narrative_watch],
    length_note: entry.length_note,
    source: "StoryScope (arXiv:2604.03136) Tables 5 and 16; directional, not diagnostic",
  };
}

export function knownFingerprintFamilies() {
  return FINGERPRINTS.map((entry) => entry.family);
}
