const DEFAULT_LIKELY_ROOT_KEYS = [
  "issues",
  "strengths",
  "pass",
  "section",
  "summary",
  "candidate_markdown",
  "winner",
  "preference",
  "decision",
  "disposition",
  "verdict",
  "overall_assessment",
  "line_flags",
  "voice_preservation",
  "pattern_saturation_delta",
  "gate",
];

export const JSON_OBJECT_RESPONSE_FORMAT = Object.freeze({ type: "json_object" });

export function parseModelJsonObject(rawOutput, options = {}) {
  const normalized = normalizeModelJsonText(rawOutput);
  const candidates = candidateJsonObjects(normalized);
  const repairOptions = {
    repairArrays: options.repairArrays ?? [],
    dropMalformedKeys: options.dropMalformedKeys ?? [],
  };
  const attempts = [];

  for (const candidate of rankCandidates(candidates, options)) {
    const parsed = parseCandidate(candidate.text, repairOptions);
    attempts.push({ start: candidate.start, end: candidate.end, ok: parsed.ok, error: parsed.error ?? "" });
    if (parsed.ok) {
      return {
        ok: true,
        value: parsed.value,
        candidate: candidate.text,
        repair: parsed.repair ?? "",
        attempts,
      };
    }
  }

  const whole = parseCandidate(normalized.trim(), repairOptions);
  if (whole.ok) {
    return {
      ok: true,
      value: whole.value,
      candidate: normalized.trim(),
      repair: whole.repair ?? "",
      attempts,
    };
  }

  const error = attempts.findLast((attempt) => attempt.error)?.error ?? whole.error ?? "No JSON object found";
  return { ok: false, error: `Malformed JSON response: ${error}`, attempts };
}

export function parseJsonObjectOrThrow(rawOutput, options = {}) {
  const result = parseModelJsonObject(rawOutput, options);
  if (result.ok) return result.value;
  throw new Error(result.error);
}

export function normalizeModelJsonText(rawOutput) {
  return String(rawOutput ?? "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
}

function candidateJsonObjects(text) {
  const fenced = fencedJsonBlocks(text);
  const candidates = fenced.flatMap((block) => balancedObjects(block.text, block.offset));
  candidates.push(...balancedObjects(text, 0));
  return dedupeCandidates(candidates);
}

function fencedJsonBlocks(text) {
  const blocks = [];
  const pattern = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) {
    blocks.push({ text: match[1] ?? "", offset: match.index + match[0].indexOf(match[1] ?? "") });
  }
  return blocks;
}

function balancedObjects(text, offset) {
  const objects = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const end = balancedObjectEnd(text, index);
    objects.push({
      start: offset + index,
      end: offset + (end === -1 ? text.length : end),
      text: text.slice(index, end === -1 ? text.length : end),
      unbalanced: end === -1,
    });
  }
  return objects;
}

function balancedObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const key = `${candidate.start}:${candidate.end}:${candidate.text.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function rankCandidates(candidates, options) {
  const likelyKeys = options.likelyRootKeys ?? DEFAULT_LIKELY_ROOT_KEYS;
  return [...candidates].sort((left, right) => candidateScore(right, likelyKeys) - candidateScore(left, likelyKeys));
}

function candidateScore(candidate, likelyKeys) {
  const parsed = tryParseJson(candidate.text);
  const value = parsed.ok ? parsed.value : null;
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const likelyHits = likelyKeys.filter((key) => keys.includes(key) || candidate.text.includes(`"${key}"`)).length;
  const rootObjectBonus = value && typeof value === "object" && !Array.isArray(value) ? 100 : 0;
  const laterBonus = Math.min(candidate.start, 100000) / 100000;
  const sizeBonus = Math.min(candidate.text.length, 50000) / 50000;
  return rootObjectBonus + likelyHits * 1000 + sizeBonus + laterBonus;
}

function parseCandidate(candidate, options) {
  const trimmed = stripOuterFence(candidate.trim());
  const direct = tryParseJson(trimmed);
  if (direct.ok) return direct;

  const withoutTrailingCommas = trimmed.replace(/,\s*([}\]])/g, "$1");
  if (withoutTrailingCommas !== trimmed) {
    const repaired = tryParseJson(withoutTrailingCommas);
    if (repaired.ok) return { ...repaired, repair: "removed trailing commas" };
  }

  for (const arrayKey of options.repairArrays ?? []) {
    const repairedText = repairTruncatedArray(trimmed, arrayKey, direct.error);
    if (!repairedText) continue;
    const repaired = tryParseJson(repairedText);
    if (repaired.ok) {
      repaired.value.__parse_repair = `truncated malformed ${arrayKey} after parse error: ${direct.error}`;
      return { ...repaired, repair: `truncated malformed ${arrayKey}` };
    }
  }

  for (const key of options.dropMalformedKeys ?? []) {
    const repairedText = dropMalformedTailKey(trimmed, key, direct.error);
    if (!repairedText) continue;
    const repaired = tryParseJson(repairedText);
    if (repaired.ok) {
      repaired.value.__parse_repair = `dropped malformed ${key} after parse error: ${direct.error}`;
      return { ...repaired, repair: `dropped malformed ${key}` };
    }
  }

  return direct;
}

function tryParseJson(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function stripOuterFence(value) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function repairTruncatedArray(candidate, arrayKey, originalError) {
  const keyIndex = candidate.lastIndexOf(`"${arrayKey}"`);
  if (keyIndex === -1) return "";

  const arrayStart = candidate.indexOf("[", keyIndex);
  if (arrayStart === -1) return "";

  const body = candidate.slice(arrayStart + 1);
  const lastObjectEnd = lastBalancedObjectEnd(body);
  if (lastObjectEnd === -1) return "";

  const prefix = candidate.slice(0, arrayStart + 1);
  const items = body.slice(0, lastObjectEnd).trim().replace(/,\s*$/, "");
  const repairFields = arrayKey === "line_flags"
    ? [
        '  "plain_down_targets": []',
        '  "protected_lines": []',
        '  "register_map": []',
      ]
    : [
        '  "strengths": []',
      ];

  return [
    prefix,
    items,
    "\n  ],",
    ...repairFields.map((line) => `${line},`),
    `  "__parse_repair": "truncated malformed ${arrayKey} after parse error: ${escapeJsonString(originalError)}"`,
    "}",
  ].join("\n");
}

function dropMalformedTailKey(candidate, key, originalError) {
  const keyIndex = candidate.lastIndexOf(`"${key}"`);
  if (keyIndex === -1) return "";

  const beforeKey = candidate.slice(0, keyIndex);
  const commaIndex = beforeKey.lastIndexOf(",");
  if (commaIndex === -1) return "";

  const prefix = beforeKey.slice(0, commaIndex).trimEnd();
  return `${prefix},\n  "${key}": [],\n  "__parse_repair": "dropped malformed ${key} after parse error: ${escapeJsonString(originalError)}"\n}`;
}

function lastBalancedObjectEnd(value) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastEnd = -1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) lastEnd = index + 1;
      if (depth < 0) break;
    }
  }

  return lastEnd;
}

function escapeJsonString(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
