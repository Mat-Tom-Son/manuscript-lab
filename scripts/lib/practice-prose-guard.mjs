const META_PATTERNS = [
  { id: "hidden-test", pattern: /\bhidden(?: exercise)? test\b/i },
  { id: "judge-feedback", pattern: /\bjudge feedback\b/i },
  { id: "revision-brief", pattern: /\brevision brief\b/i },
  { id: "blind-reader", pattern: /\bblind reader\b/i },
  { id: "candidate-reference", pattern: /\bcandidate-\d{3}\b/i },
  { id: "prose-submission", pattern: /\bprose submission\b/i },
  { id: "test-result", pattern: /\b(?:passes|fails?) (?:the )?(?:hidden )?test\b/i },
  { id: "exercise-meta", pattern: /\bthe exercise (?:asks|requires|demands|is about)\b/i },
  {
    id: "planning-language",
    pattern: /\b(?:the user wants me(?: to)?|let me|i need to|i should|i will|i'm going to)\s+(?:revise|think|try|write|add|replace|choose|make|go)\b/i,
  },
  {
    id: "revision-list",
    pattern: /^\s*(?:\d+\.|-)\s+(?:sharpen|vary|add|replace|keep|remove|make|let)\b/im,
  },
];

export function assessPracticeProse(text) {
  const trimmed = String(text ?? "").trim();
  const reasons = [];
  if (!trimmed) reasons.push("empty");
  if (/^```/.test(trimmed)) reasons.push("code-fence");
  if (/^\s*\{[\s\S]*"final_prose"/.test(trimmed)) reasons.push("unparsed-json");
  for (const { id, pattern } of META_PATTERNS) {
    if (pattern.test(trimmed)) reasons.push(id);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    text: trimmed,
  };
}

export function assessDistinctPracticeProse(candidate, baseline, { threshold = 0.62 } = {}) {
  const candidateText = normalizeText(candidate);
  const baselineText = normalizeText(baseline);
  if (!candidateText || !baselineText) return { ok: true, score: 0, reason: "" };
  if (candidateText === baselineText) {
    return { ok: false, score: 1, reason: "normalized text is identical to baseline" };
  }

  const candidateGrams = ngrams(candidateText.split(/\s+/), 5);
  const baselineGrams = ngrams(baselineText.split(/\s+/), 5);
  if (!candidateGrams.size || !baselineGrams.size) return { ok: true, score: 0, reason: "" };
  let overlap = 0;
  for (const gram of candidateGrams) {
    if (baselineGrams.has(gram)) overlap += 1;
  }
  const containment = overlap / Math.min(candidateGrams.size, baselineGrams.size);
  return {
    ok: containment < threshold,
    score: containment,
    reason: containment >= threshold ? "candidate shares too many five-word sequences with baseline" : "",
  };
}

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ngrams(words, size) {
  const set = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    set.add(words.slice(index, index + size).join(" "));
  }
  return set;
}
