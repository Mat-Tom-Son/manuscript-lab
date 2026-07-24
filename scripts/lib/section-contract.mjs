import path from "node:path";
import { NARRATIVE_INTENTS } from "./narrative-schema.mjs";

export const ALLOWED_SECTION_STATUSES = new Set(["todo", "draft", "review", "revise", "done"]);

export function parseSectionContract(text) {
  const match = String(text ?? "").match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return null;

  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2]);
  }

  if (/^\s*acceptance\s*:/m.test(match[1])) fields.set("acceptance", fields.get("acceptance") ?? "");
  return fields;
}

export function parseContractList(text, fieldName) {
  const block = String(text ?? "").match(/^\s*<!--([\s\S]*?)-->/)?.[1];
  if (!block) return [];

  const items = [];
  let inList = false;
  for (const line of block.split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field?.[1] === fieldName) {
      const inline = field[2].trim();
      if (inline) {
        items.push(...splitInlineList(inline));
        inList = false;
      } else {
        inList = true;
      }
      continue;
    }

    if (!inList) continue;

    const item = line.match(/^\s*-\s*([A-Za-z0-9_.:-]+)\s*$/);
    if (item) {
      items.push(item[1]);
      continue;
    }

    if (/^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) break;
  }

  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function validateSectionContract({ text, file = "draft section", knownCheckIds = new Set(), knownReviewIds = new Set() }) {
  const errors = [];
  const warnings = [];
  const contract = parseSectionContract(text);

  if (!contract) {
    errors.push(`${file}: missing section contract comment at the top of the file`);
    return { contract: null, errors, warnings };
  }

  for (const field of ["id", "status", "target_words", "purpose", "acceptance"]) {
    if (!contract.has(field)) errors.push(`${file}: section contract missing ${field}`);
  }

  const status = contract.get("status");
  if (status && !ALLOWED_SECTION_STATUSES.has(status)) {
    errors.push(`${file}: unsupported section status "${status}"`);
  }

  const targetWords = Number(contract.get("target_words"));
  if (contract.has("target_words") && (!Number.isFinite(targetWords) || targetWords <= 0)) {
    errors.push(`${file}: target_words must be a positive number`);
  }

  for (const checkId of parseContractList(text, "checks")) {
    if (knownCheckIds.size && !knownCheckIds.has(checkId)) {
      errors.push(`${file}: section contract references unknown model check "${checkId}"`);
    }
  }

  for (const reviewId of parseContractList(text, "reviews")) {
    if (knownReviewIds.size && !knownReviewIds.has(reviewId)) {
      errors.push(`${file}: section contract references unknown review pass "${reviewId}"`);
    }
  }

  for (const [key, spec] of Object.entries(NARRATIVE_INTENTS)) {
    if (!contract.has(key)) continue;
    const value = String(contract.get(key) ?? "").trim().toLowerCase();
    if (!spec.values.includes(value)) {
      errors.push(`${file}: unsupported ${key} "${contract.get(key)}" (expected one of: ${spec.values.join(", ")})`);
    }
  }

  return { contract, errors, warnings };
}

export function stripContract(text) {
  return String(text ?? "").replace(/^\s*<!--[\s\S]*?-->/, "").trim();
}

// Placeholder detection distinguishes marker forms ("TODO: finish", "[TBD]",
// a line that opens with TODO) from prose that merely mentions the word, and
// never looks inside code spans or fences — a document about placeholders must
// be able to say "TODO" without failing its own checks. Contract comments are
// stricter: metadata is never prose, so any TODO/TBD/FIXME there is a
// placeholder.
const PROSE_PLACEHOLDER_PATTERNS = [
  /\b(?:TODO|FIXME|TBD)\s*:/, // TODO: finish this
  /\[(?:TODO|FIXME|TBD)\]/, // [TODO]
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?(?:TODO|FIXME)\b/m, // line or list item opening with TODO
  /\bTBD\b/, // bare TBD reads as a placeholder even mid-sentence
];

export function placeholderFindings(text) {
  const raw = String(text ?? "");
  const contractMatch = raw.match(/^\s*<!--[\s\S]*?-->/);
  const contractText = contractMatch ? contractMatch[0] : "";
  const body = contractMatch ? raw.slice(contractMatch[0].length) : raw;

  const findings = [];
  if (/\b(?:TODO|TBD|FIXME)\b/.test(contractText)) {
    findings.push("section contract contains TODO/TBD/FIXME — complete purpose and acceptance in the contract header");
  }

  const prose = body
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ");
  if (PROSE_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(prose))) {
    findings.push("contains TODO/TBD/FIXME placeholder text");
  }

  return findings;
}

export function wordCount(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function minimumWordsForStartedSection(targetWords) {
  const number = Number(targetWords);
  if (Number.isFinite(number) && number > 0) {
    return Math.min(50, Math.max(5, Math.floor(number * 0.4)));
  }
  return 50;
}

export function isShortFormDraftContract(contract) {
  const kind = String(contract?.get("kind") ?? "").trim();
  return kind === "fiction.title" || kind.endsWith(".title");
}

export function sectionIdForFile(file, contract) {
  return safeId(contract?.get("id") || path.basename(file, path.extname(file)));
}

export function safeId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "section";
}

export function parseMarkdownTable(text) {
  const lines = String(text ?? "").split("\n");
  const headerIndex = lines.findIndex((line, index) => {
    const next = lines[index + 1] ?? "";
    return line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
  });

  if (headerIndex === -1) return [];

  const headers = splitMarkdownTableRow(lines[headerIndex]).map(normalizeHeader);
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("|") || !line.trim()) break;
    const cells = splitMarkdownTableRow(line);
    const row = {};
    headers.forEach((header, cellIndex) => {
      row[header] = stripCode(cells[cellIndex] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

export function splitSourceKeys(source) {
  return String(source ?? "")
    .split(/[;,]/)
    .map((key) => stripCode(key).trim())
    .filter(Boolean)
    .filter((key) => !["n/a", "not-needed", "none"].includes(key.toLowerCase()));
}

export function stripCode(value) {
  return String(value ?? "").trim().replace(/^`+/, "").replace(/`+$/, "").trim();
}

export function normalizeRel(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

// Markdown table cells escape literal pipes as `\|`. Keep the escape in the
// returned cell so callers that rewrite a row can preserve its exact Markdown,
// but do not treat the escaped pipe as a column boundary.
export function splitMarkdownTableRow(line) {
  const trimmed = String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return splitMarkdownTableCells(trimmed).map((cell) => cell.trim());
}

export function splitMarkdownTableCells(value) {
  const cells = [];
  let cell = "";
  let backslashes = 0;
  for (const character of String(value ?? "")) {
    if (character === "|" && backslashes % 2 === 0) {
      cells.push(cell);
      cell = "";
      backslashes = 0;
      continue;
    }
    cell += character;
    if (character === "\\") backslashes += 1;
    else backslashes = 0;
  }
  cells.push(cell);
  return cells;
}

function splitInlineList(value) {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
