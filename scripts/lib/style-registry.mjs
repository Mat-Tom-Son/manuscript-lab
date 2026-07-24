import fs from "node:fs";
import path from "node:path";

export const STYLE_REGISTRY_VERSION = 1;

// Built-in defaults mirror the historical hard-coded detectors so an empty
// style_profile preserves the established counters and register scoring.
// Projects extend or override them via state/truth/style.json
// (style_profile.pattern_registry and style_profile.registers);
// `disabled: true` removes an entry.
const DEFAULT_PATTERNS = [
  {
    id: "rhetoric.as_if",
    label: "as-if simile",
    type: "regex",
    pattern: "\\bas if\\b",
    flags: "gi",
    count_key: "as_if_count",
    flag_key: "as_if",
    example_key: "as_if",
    example_pattern: "[^.!?\\n]{0,120}\\bas if\\b[^.!?\\n]{0,160}[.!?]",
    example_flags: "gi",
    message: "Simile scaffolding; review for saturation, not presence.",
  },
  {
    id: "rhetoric.not_x_but_y",
    label: "not-X-but-Y correction",
    type: "regex",
    pattern: "\\bnot\\b[^.!?\\n]{0,100}\\b(but|rather than|instead|it is|it's)\\b",
    flags: "gi",
    count_key: "not_x_but_y_count",
    flag_key: "not_x_but_y",
    example_key: "not_x_but_y",
    example_pattern: "[^.!?\\n]{0,120}\\bnot\\b[^.!?\\n]{0,100}\\b(but|rather than|instead|it is|it's)\\b[^.!?\\n]{0,140}[.!?]",
    example_flags: "gi",
    message: "Contrastive correction; effective alone, generic in clusters.",
  },
  {
    id: "rhetoric.not_fragment_reframe",
    label: "Not-fragment reframe",
    type: "regex",
    pattern: "(?:^|[\\n.!?]\\s+)Not\\s+[^.!?\\n]{1,48}[.!?]\\s+[A-Z][^.!?\\n]{1,120}[.!?]",
    flags: "g",
    count_key: "not_fragment_reframe_count",
    flag_key: "not_fragment_reframe",
    example_key: "not_fragment_reframe",
    example_pattern: "(?:^|[\\n.!?]\\s+)Not\\s+[^.!?\\n]{1,48}[.!?]\\s+[A-Z][^.!?\\n]{1,120}[.!?]",
    example_flags: "g",
    message: "Fragment-then-reframe; watch for repeated use as a paragraph engine.",
  },
  {
    id: "rhetoric.less_x_than_y",
    label: "less-X-than-Y comparison",
    type: "regex",
    pattern: "\\bless\\b[^.!?\\n]{0,80}\\bthan\\b",
    flags: "gi",
    count_key: "less_x_than_y_count",
    flag_key: "less_x_than_y",
    example_key: "less_x_than_y",
    example_pattern: "[^.!?\\n]{0,120}\\bless\\b[^.!?\\n]{0,80}\\bthan\\b[^.!?\\n]{0,140}[.!?]",
    example_flags: "gi",
    message: "Scaled comparison; review clusters.",
  },
  {
    id: "punctuation.em_dash",
    label: "em dash",
    type: "regex",
    pattern: "--|—",
    flags: "g",
    count_key: "em_dash_count",
    message: "Track density only; em dashes are a legitimate tool.",
  },
];

const DEFAULT_REGISTERS = [
  {
    key: "comic_observation",
    label: "comic observation",
    rules: [
      {
        kind: "regex",
        pattern: "\\bas if\\b|\\bless\\b[^.!?]{0,80}\\bthan\\b|\\bnot\\b[^.!?]{0,100}\\b(but|rather than|instead|it is|it's)\\b",
        flags: "i",
        score: 2,
      },
      { kind: "short_closer", max_words: 12, score: 1 },
    ],
    cluster: { label: "high-density comic observation", min_score: 2 },
  },
  {
    key: "plain_action",
    label: "plain action",
    rules: [
      {
        kind: "regex",
        pattern:
          "\\b(i|we)\\s+(open|cycle|flip|unfold|bend|wedge|trigger|point|release|pick|set|leave|look|glance|close|stand|sit|move|pull|push|write|read|run|test|check|measure|calculate|send|switch|hold|turn)\\b",
        flags: "i",
        score: 2,
      },
    ],
  },
  {
    key: "technical_explanation",
    label: "technical explanation",
    rules: [
      {
        kind: "regex",
        pattern:
          "(algorithm|api|analysis|baseline|battery|coefficient|constraint|data|dataset|delta|equation|experiment|flow|function|geometry|hardware|index|latency|measurement|metric|model|parameter|pressure|protocol|rate|ratio|sample|sensor|signal|solver|system|temperature|test|theorem|threshold|trace|unit|velocity|voltage|window)",
        flags: "i",
        score: 2,
      },
    ],
    cluster: { label: "technical explanation cluster", min_score: 2 },
  },
  {
    key: "sensory_grounding",
    label: "sensory grounding",
    rules: [
      {
        kind: "regex",
        pattern:
          "(cold|warm|hot|wet|dry|bright|dark|light|gray|green|orange|white|black|hum|beep|flicker|smell|breath|hand|skin|metal|glass|plastic|stone|screen|clamp|fiber|tape|wheel|silence|noise|vibration|pressure|weight|taste|sound|touch)",
        flags: "i",
        score: 1,
      },
    ],
  },
  {
    key: "emotional_consequence",
    label: "emotional consequence",
    rules: [
      {
        kind: "regex",
        pattern: "(brittle|heavier|demand|trap|dangerous|fatigue|warning|pleasure|annoying|unpleasant|bad|worse|threat|risk|afraid)",
        flags: "i",
        score: 1,
      },
    ],
  },
  {
    key: "dialogue_pressure",
    label: "dialogue pressure",
    rules: [
      { kind: "dialogue", score: 2 },
      {
        kind: "regex",
        pattern: "(says|ask|asks|tell|tells|say|said|voice|meeting|question|answer|warning|objection)",
        flags: "i",
        score: 1,
      },
    ],
  },
  {
    key: "systems_pressure",
    label: "systems pressure",
    rules: [
      {
        kind: "regex",
        pattern:
          "(room|screen|chart|folder|page|instrument|device|machine|system|tool|protocol|table|slide|file|document|report|graph|dataset|interface|terminal|panel).{0,80}\\b(is|are|has|have|looks|feels|behaves|wants|refuses|suggests|means)\\b",
        flags: "i",
        score: 1,
      },
      {
        kind: "regex",
        pattern:
          "(board|operations|resource|alignment|protocol|budget|facility|facilities|procurement|administrative|asset|classification|owner|deadline|platform|deliverable|metric|index|stakeholder|client|customer|review|approval|compliance|policy|workflow|queue|ticket|requirement|constraint|schedule|risk|governance)",
        flags: "i",
        score: 1,
      },
    ],
    cluster: { label: "systems pressure cluster", min_score: 2 },
  },
  {
    key: "interiority",
    label: "interiority",
    rules: [
      {
        kind: "regex",
        pattern: "\\bi\\s+(think|know|hate|feel|assume|remember|understand|suspect|want|do not|don't)\\b",
        flags: "i",
        score: 2,
      },
    ],
  },
  {
    key: "plot_movement",
    label: "plot movement",
    rules: [
      {
        kind: "regex",
        pattern: "(invite|deadline|monday|go|leave|arrive|return|push|request|task|decision|meeting|next|then|now)",
        flags: "i",
        score: 1,
      },
    ],
  },
];

export function defaultPatternRegistry() {
  return structuredClone(DEFAULT_PATTERNS);
}

export function defaultRegisters() {
  return structuredClone(DEFAULT_REGISTERS);
}

export function loadStyleRegistry(root) {
  const warnings = [];
  const truthFile = path.join(root, "state/truth/style.json");
  let profile = null;
  if (fs.existsSync(truthFile)) {
    try {
      profile = JSON.parse(fs.readFileSync(truthFile, "utf8"))?.style_profile ?? null;
    } catch (error) {
      warnings.push(`state/truth/style.json is not valid JSON (${error.message}); using built-in style registry`);
    }
  }

  const patterns = mergeById(DEFAULT_PATTERNS, arrayOf(profile?.pattern_registry), "id", warnings, "pattern_registry");
  const registers = mergeById(DEFAULT_REGISTERS, arrayOf(profile?.registers), "key", warnings, "registers");

  const compiled = [];
  for (const entry of patterns) {
    const pattern = compilePattern(entry, warnings);
    if (pattern) compiled.push(pattern);
  }

  return {
    version: STYLE_REGISTRY_VERSION,
    source: profile ? "state/truth/style.json + defaults" : "defaults",
    patterns: compiled,
    registers: registers.filter((register) => register && register.key && Array.isArray(register.rules)),
    watch_patterns: arrayOf(profile?.watch_patterns).filter((item) => typeof item === "string" && item.trim()),
    warnings,
  };
}

function mergeById(defaults, overrides, idField, warnings, label) {
  const merged = new Map(structuredClone(defaults).map((entry) => [entry[idField], entry]));
  for (const override of overrides) {
    if (!override || typeof override !== "object" || !override[idField]) {
      warnings.push(`ignored ${label} entry without ${idField}`);
      continue;
    }
    const id = String(override[idField]);
    if (override.disabled === true) {
      merged.delete(id);
      continue;
    }
    merged.set(id, { ...(merged.get(id) ?? {}), ...override });
  }
  return [...merged.values()];
}

function compilePattern(entry, warnings) {
  const type = entry.type ?? "regex";
  let source = "";
  let flags = entry.flags ?? "gi";
  if (type === "phrase") {
    const phrase = String(entry.pattern ?? entry.phrase ?? "").trim();
    if (!phrase) {
      warnings.push(`pattern ${entry.id}: phrase entries need a pattern`);
      return null;
    }
    source = `\\b${phrase.split(/\s+/).map(escapeRegex).join("\\s+")}\\b`;
  } else if (type === "regex") {
    source = String(entry.pattern ?? "");
  } else {
    warnings.push(`pattern ${entry.id}: unsupported type "${type}"`);
    return null;
  }

  let regex;
  let exampleRegex = null;
  try {
    if (!flags.includes("g")) flags += "g";
    regex = new RegExp(source, flags);
  } catch (error) {
    warnings.push(`pattern ${entry.id}: invalid regex (${error.message})`);
    return null;
  }
  if (entry.example_pattern) {
    try {
      let exampleFlags = entry.example_flags ?? flags;
      if (!exampleFlags.includes("g")) exampleFlags += "g";
      exampleRegex = new RegExp(entry.example_pattern, exampleFlags);
    } catch (error) {
      warnings.push(`pattern ${entry.id}: invalid example regex (${error.message})`);
    }
  }

  return { ...entry, type, regex, exampleRegex };
}

export function analyzePatternOccurrences({ body, paragraphs, registry }) {
  const byId = new Map();
  for (const pattern of registry.patterns) {
    const count = countMatches(body, pattern.regex);
    const perParagraph = paragraphs.map((paragraph) => countMatches(paragraph, pattern.regex));
    const examples = pattern.exampleRegex
      ? collectMatches(body, pattern.exampleRegex, pattern.example_limit ?? 8)
      : collectMatches(body, pattern.regex, pattern.example_limit ?? 8);
    byId.set(pattern.id, { pattern, count, perParagraph, examples });
  }
  return byId;
}

export function evaluatePatternThresholds({ occurrences, wordCount, target }) {
  const failures = [];
  for (const { pattern, count, perParagraph } of occurrences.values()) {
    const density = wordCount ? Number(((count / wordCount) * 1000).toFixed(2)) : 0;
    if (Number.isFinite(pattern.max_count) && pattern.max_count !== null && count > pattern.max_count) {
      failures.push({
        target,
        pattern: pattern.id,
        kind: "count",
        message: `${target}: ${pattern.id} count ${count} exceeds max_count ${pattern.max_count}`,
      });
    }
    if (
      Number.isFinite(pattern.max_per_1000_words) &&
      pattern.max_per_1000_words !== null &&
      density > pattern.max_per_1000_words
    ) {
      failures.push({
        target,
        pattern: pattern.id,
        kind: "density",
        message: `${target}: ${pattern.id} density ${density}/1k exceeds max_per_1000_words ${pattern.max_per_1000_words}`,
      });
    }
    const cluster = pattern.cluster;
    if (cluster && Number.isFinite(cluster.max_occurrences) && Number.isFinite(cluster.window_paragraphs)) {
      const window = Math.max(1, Math.floor(cluster.window_paragraphs));
      for (let start = 0; start < perParagraph.length; start += 1) {
        const end = Math.min(perParagraph.length, start + window);
        const inWindow = perParagraph.slice(start, end).reduce((sum, value) => sum + value, 0);
        if (inWindow > cluster.max_occurrences) {
          const paragraphCount = end - start;
          failures.push({
            target,
            pattern: pattern.id,
            kind: "cluster",
            message: `${target}: ${pattern.id} appears ${inWindow}x within ${paragraphCount} consecutive paragraph${paragraphCount === 1 ? "" : "s"} (max ${cluster.max_occurrences} in a ${window}-paragraph window); paragraphs ${start + 1}-${end}`,
          });
          break;
        }
      }
    }
  }
  return failures;
}

export function scoreParagraphRegisters(paragraph, registers, helpers) {
  const scores = {};
  for (const register of registers) scores[register.key] = 0;
  for (const register of registers) {
    for (const rule of register.rules) {
      if (rule.kind === "regex" || rule.kind === undefined) {
        let regex;
        try {
          regex = new RegExp(rule.pattern ?? "", rule.flags ?? "i");
        } catch {
          continue;
        }
        if (regex.test(paragraph)) scores[register.key] += rule.score ?? 1;
      } else if (rule.kind === "dialogue") {
        if (helpers.hasDialogue(paragraph)) scores[register.key] += rule.score ?? 1;
      } else if (rule.kind === "short_closer") {
        const last = helpers.lastSentence(paragraph);
        if (/[?!.]["']?$/.test(paragraph) && helpers.wordCount(last) <= (rule.max_words ?? 12)) {
          scores[register.key] += rule.score ?? 1;
        }
      }
    }
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const labelFor = (key) => registers.find((register) => register.key === key)?.label ?? key.replaceAll("_", " ");
  const dominant = ranked[0]?.[1] > 0 ? labelFor(ranked[0][0]) : "plain action";
  const secondary = ranked[1]?.[1] > 0 ? labelFor(ranked[1][0]) : "";
  return { scores, dominant, secondary };
}

export function findRegisterClusters(paragraphSignals, registers) {
  const clusters = [];
  for (const register of registers) {
    if (!register.cluster) continue;
    const minScore = register.cluster.min_score ?? 2;
    const minRun = register.cluster.min_run ?? 3;
    const label = register.cluster.label ?? `${register.label} cluster`;
    let current = [];
    for (const paragraph of paragraphSignals) {
      if ((paragraph.scores[register.key] ?? 0) >= minScore || paragraph.dominant_register === register.label) {
        current.push(paragraph.paragraph);
      } else {
        pushCluster(clusters, current, label, minRun);
        current = [];
      }
    }
    pushCluster(clusters, current, label, minRun);
  }
  return clusters;
}

function pushCluster(clusters, paragraphs, clusterType, minRun) {
  if (paragraphs.length < minRun) return;
  clusters.push({
    paragraphs: [...paragraphs],
    cluster_type: clusterType,
    risk: "Several consecutive paragraphs use the same register or rhetorical move; review for saturation rather than automatic cuts.",
  });
}

export function registryPhraseWatchTerms(registry) {
  return registry.patterns
    .filter((pattern) => pattern.type === "phrase")
    .map((pattern) => ({
      id: pattern.id,
      term: String(pattern.pattern ?? "").trim(),
      max_count: Number.isFinite(pattern.max_count) ? pattern.max_count : null,
      max_per_1000_words: Number.isFinite(pattern.max_per_1000_words) ? pattern.max_per_1000_words : null,
    }))
    .filter((entry) => entry.term);
}

export function renderWatchlistMarkdown(registry, { project = "" } = {}) {
  const lines = [
    "# Pattern Watchlist",
    "",
    "Generated from the canonical style registry (`state/truth/style.json` +",
    "built-in defaults) by `mlab lab style watchlist`. Edit the registry, not",
    "this file; regenerate after changes.",
    "",
  ];
  if (project) lines.splice(1, 0, "", `Project: ${project}`);

  lines.push("## Patterns", "");
  for (const pattern of registry.patterns) {
    lines.push(`### ${pattern.id}`, "");
    lines.push(`- label: ${pattern.label ?? pattern.id}`);
    lines.push(`- type: ${pattern.type}`);
    lines.push(`- pattern: \`${pattern.pattern}\``);
    if (Number.isFinite(pattern.max_count)) lines.push(`- max_count: ${pattern.max_count}`);
    if (Number.isFinite(pattern.max_per_1000_words)) lines.push(`- max_per_1000_words: ${pattern.max_per_1000_words}`);
    if (pattern.cluster && Number.isFinite(pattern.cluster.max_occurrences)) {
      lines.push(`- cluster: max ${pattern.cluster.max_occurrences} per ${pattern.cluster.window_paragraphs} paragraphs`);
    }
    if (pattern.message) lines.push(`- note: ${pattern.message}`);
    lines.push("");
  }

  if (registry.watch_patterns.length) {
    lines.push("## Watch notes (from style_profile.watch_patterns)", "");
    for (const note of registry.watch_patterns) lines.push(`- ${note}`);
    lines.push("");
  }

  lines.push("## Registers", "");
  for (const register of registry.registers) {
    lines.push(`- ${register.key}: ${register.label}${register.cluster ? ` (clusters tracked as "${register.cluster.label}")` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}

function countMatches(value, regex) {
  regex.lastIndex = 0;
  return [...String(value ?? "").matchAll(regex)].length;
}

function collectMatches(value, regex, limit) {
  regex.lastIndex = 0;
  return [...String(value ?? "").matchAll(regex)].map((match) => match[0].trim().replace(/\s+/g, " ")).slice(0, limit);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
