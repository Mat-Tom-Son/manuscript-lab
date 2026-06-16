#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JSON_OBJECT_RESPONSE_FORMAT, parseJsonObjectOrThrow } from "./lib/model-json.mjs";
import { callChatModel, describeModelRuntime, hasApiKeyForModel, providerMissingKeyMessage } from "./lib/model-provider.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? "help";
const rest = args.slice(1);
const BOOLEAN_OPTIONS = new Set(["json"]);

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "signals") {
  const options = parseOptions(rest);
  const targets = options.positionals;
  if (!targets.length) fail("signals requires at least one draft section");

  const outputs = targets.map((target) => writeSignals(resolveInputPath(target)));
  const failures = styleSignalFailures(outputs, options);
  if (options.json) console.log(JSON.stringify(outputs, null, 2));
  else for (const output of outputs) console.log(`saved: ${output.signals_file} | ${output.register_map_file}`);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  process.exit(0);
}

if (command === "fingerprint") {
  const options = parseOptions(rest);
  const targets = options.positionals;
  if (!targets.length) fail("fingerprint requires at least one approved section");

  const model = String(options.model ?? process.env.STYLE_FINGERPRINT_MODEL ?? "qwen/qwen3.7-plus");
  if (!hasApiKeyForModel(model)) fail(providerMissingKeyMessage(model));

  const maxTokens = Number(options.maxTokens ?? options.max_tokens ?? process.env.STYLE_FINGERPRINT_MAX_TOKENS ?? 2400);
  const temperature = Number(options.temperature ?? process.env.STYLE_FINGERPRINT_TEMPERATURE ?? 0.1);
  const outputFile = String(options.output ?? "style/voice-fingerprint.json");
  const prompt = buildFingerprintPrompt(targets.map(resolveInputPath));
  const response = await callChatModel({
    model,
    title: "manuscript-lab style calibration",
    temperature,
    maxTokens,
    responseFormat: JSON_OBJECT_RESPONSE_FORMAT,
    system:
      "You are a JSON API endpoint for a voice-calibration editor. Return exactly one valid JSON object. The first character of your response must be { and the last must be }. Do not write prose, Markdown, headings, or visible reasoning outside the JSON object.",
    content: prompt,
    audit: {
      operation: "style.fingerprint",
      target: targets.map((target) => displayPath(resolveInputPath(target))).join(","),
      artifact_paths: [outputFile],
    },
  });
  const raw = response.content;
  const parsed = parseJsonObject(raw);
  const runtime = describeModelRuntime(model);

  const body = {
    version: 1,
    project: readProjectName(),
    generated_at: new Date().toISOString(),
    model,
    provider: runtime.provider,
    resolved_model: runtime.model,
    model_call_id: response.model_call_id,
    model_call_path: response.model_call_path,
    generated_from: targets.map((target) => displayPath(resolveInputPath(target))),
    ...parsed,
  };

  fs.mkdirSync(path.dirname(abs(outputFile)), { recursive: true });
  fs.writeFileSync(abs(outputFile), `${JSON.stringify(body, null, 2)}\n`);
  if (options.json) console.log(JSON.stringify({ output: outputFile, model, sha256: sha256(JSON.stringify(body)) }, null, 2));
  else console.log(`saved: ${outputFile}`);
  process.exit(0);
}

fail(`Unknown command: ${command}`);

function writeSignals(target) {
  if (!fs.existsSync(target)) fail(`Target file does not exist: ${displayPath(target)}`);
  const text = read(target);
  const sectionId = parseSectionContract(text)?.get("id") ?? path.basename(target, path.extname(target));
  const analysis = analyzeSection(text, displayPath(target), sectionId);

  const outDir = abs("state/style");
  fs.mkdirSync(outDir, { recursive: true });
  const signalsFile = path.join(outDir, `${sectionId}-style-signals.json`);
  const registerMapFile = path.join(outDir, `${sectionId}-register-map.json`);

  fs.writeFileSync(signalsFile, `${JSON.stringify(analysis.signals, null, 2)}\n`);
  fs.writeFileSync(registerMapFile, `${JSON.stringify(analysis.register_map, null, 2)}\n`);

  return {
    section_id: sectionId,
    target: displayPath(target),
    signals_file: displayPath(signalsFile),
    register_map_file: displayPath(registerMapFile),
    counters: analysis.signals.signals,
  };
}

function styleSignalFailures(outputs, options) {
  const failures = [];
  const maxNotXButY = finiteOption(options.maxNotXButY);
  if (Number.isFinite(maxNotXButY)) {
    for (const output of outputs) {
      const count = output.counters?.not_x_but_y_count ?? 0;
      if (count > maxNotXButY) {
        failures.push(`${output.target}: not_x_but_y_count ${count} exceeds ${maxNotXButY}`);
      }
    }
  }
  return failures;
}

function analyzeSection(text, targetPath, sectionId) {
  const body = stripHeading(stripContract(text));
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const sentences = splitSentences(body);

  const paragraphSignals = paragraphs.map((paragraph, index) => analyzeParagraph(paragraph, index + 1));
  const signals = {
    version: 1,
    generated_at: new Date().toISOString(),
    target: targetPath,
    section_id: sectionId,
    word_count: wordCount(body),
    paragraph_count: paragraphs.length,
    sentence_count: sentences.length,
    signals: {
      as_if_count: countMatches(body, /\bas if\b/gi),
      not_x_but_y_count: countMatches(body, /\bnot\b[^.!?\n]{0,100}\b(but|rather than|instead|it is|it's)\b/gi),
      not_fragment_reframe_count: countMatches(body, /(?:^|[\n.!?]\s+)Not\s+[^.!?\n]{1,48}[.!?]\s+[A-Z][^.!?\n]{1,120}[.!?]/g),
      less_x_than_y_count: countMatches(body, /\bless\b[^.!?\n]{0,80}\bthan\b/gi),
      em_dash_count: countMatches(body, /--|—/g),
      aphoristic_closer_count: paragraphSignals.filter((item) => item.flags.aphoristic_closer).length,
      dialogue_paragraph_count: paragraphSignals.filter((item) => item.flags.dialogue).length,
      comic_paragraph_count: paragraphSignals.filter((item) => item.scores.comic_observation >= 2).length,
      systems_pressure_paragraph_count: paragraphSignals.filter((item) => item.scores.systems_pressure >= 2).length,
    },
    repeated_sentence_openings: repeatedSentenceOpenings(sentences),
    pattern_examples: patternExamples(body),
    clusters: findClusters(paragraphSignals),
  };

  const registerMap = {
    version: 1,
    generated_at: signals.generated_at,
    target: targetPath,
    section_id: sectionId,
    register_map: paragraphSignals.map((item) => ({
      paragraph: item.paragraph,
      dominant_register: item.dominant_register,
      secondary_register: item.secondary_register,
      excerpt: item.excerpt,
      flags: item.flags,
      scores: item.scores,
    })),
    clusters: signals.clusters,
  };

  return { signals, register_map: registerMap };
}

function analyzeParagraph(paragraph, paragraphNumber) {
  const normalized = paragraph.toLowerCase();
  const scores = {
    comic_observation: 0,
    plain_action: 0,
    technical_explanation: 0,
    sensory_grounding: 0,
    emotional_consequence: 0,
    dialogue_pressure: 0,
    systems_pressure: 0,
    interiority: 0,
    plot_movement: 0,
  };

  if (/\bas if\b|\bless\b[^.!?]{0,80}\bthan\b|\bnot\b[^.!?]{0,100}\b(but|rather than|instead|it is|it's)\b/i.test(paragraph)) {
    scores.comic_observation += 2;
  }
  if (/[?!.]["']?$/.test(paragraph) && wordCount(lastSentence(paragraph)) <= 12) scores.comic_observation += 1;
  if (/(room|screen|chart|folder|page|instrument|device|machine|system|tool|protocol|table|slide|file|document|report|graph|dataset|interface|terminal|panel).{0,80}\b(is|are|has|have|looks|feels|behaves|wants|refuses|suggests|means)\b/i.test(paragraph)) {
    scores.systems_pressure += 1;
  }
  if (/(board|operations|resource|alignment|protocol|budget|facility|facilities|procurement|administrative|asset|classification|owner|deadline|platform|deliverable|metric|index|stakeholder|client|customer|review|approval|compliance|policy|workflow|queue|ticket|requirement|constraint|schedule|risk|governance)/i.test(paragraph)) {
    scores.systems_pressure += 1;
  }
  if (/(algorithm|api|analysis|baseline|battery|coefficient|constraint|data|dataset|delta|equation|experiment|flow|function|geometry|hardware|index|latency|measurement|metric|model|parameter|pressure|protocol|rate|ratio|sample|sensor|signal|solver|system|temperature|test|theorem|threshold|trace|unit|velocity|voltage|window)/i.test(paragraph)) {
    scores.technical_explanation += 2;
  }
  if (/(cold|warm|hot|wet|dry|bright|dark|light|gray|green|orange|white|black|hum|beep|flicker|smell|breath|hand|skin|metal|glass|plastic|stone|screen|clamp|fiber|tape|wheel|silence|noise|vibration|pressure|weight|taste|sound|touch)/i.test(paragraph)) {
    scores.sensory_grounding += 1;
  }
  if (/\b(i|we)\s+(open|cycle|flip|unfold|bend|wedge|trigger|point|release|pick|set|leave|look|glance|close|stand|sit|move|pull|push|write|read|run|test|check|measure|calculate|send|switch|hold|turn)\b/i.test(paragraph)) {
    scores.plain_action += 2;
  }
  if (hasDialogue(paragraph)) scores.dialogue_pressure += 2;
  if (/(says|ask|asks|tell|tells|say|said|voice|meeting|question|answer|warning|objection)/i.test(paragraph)) {
    scores.dialogue_pressure += 1;
  }
  if (/\bi\s+(think|know|hate|feel|assume|remember|understand|suspect|want|do not|don't)\b/i.test(paragraph)) {
    scores.interiority += 2;
  }
  if (/(brittle|heavier|demand|trap|dangerous|fatigue|warning|pleasure|annoying|unpleasant|bad|worse|threat|risk|afraid)/i.test(paragraph)) {
    scores.emotional_consequence += 1;
  }
  if (/(invite|deadline|monday|go|leave|arrive|return|push|request|task|decision|meeting|next|then|now)/i.test(paragraph)) {
    scores.plot_movement += 1;
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const dominant = ranked[0]?.[1] > 0 ? ranked[0][0].replaceAll("_", " ") : "plain action";
  const secondary = ranked[1]?.[1] > 0 ? ranked[1][0].replaceAll("_", " ") : "";

  return {
    paragraph: paragraphNumber,
    excerpt: paragraph.replace(/\s+/g, " ").slice(0, 220),
    scores,
    dominant_register: dominant,
    secondary_register: secondary,
    flags: {
      aphoristic_closer: isAphoristicCloser(paragraph),
      dialogue: hasDialogue(paragraph),
      as_if: /\bas if\b/i.test(paragraph),
      not_x_but_y: /\bnot\b[^.!?\n]{0,100}\b(but|rather than|instead|it is|it's)\b/i.test(paragraph),
      not_fragment_reframe: /(?:^|[\n.!?]\s+)Not\s+[^.!?\n]{1,48}[.!?]\s+[A-Z][^.!?\n]{1,120}[.!?]/.test(paragraph),
      less_x_than_y: /\bless\b[^.!?\n]{0,80}\bthan\b/i.test(paragraph),
    },
  };
}

function findClusters(paragraphSignals) {
  const clusters = [];
  const clusterTypes = [
    { key: "comic_observation", label: "high-density comic observation" },
    { key: "systems_pressure", label: "systems pressure cluster" },
    { key: "technical_explanation", label: "technical explanation cluster" },
  ];

  for (const type of clusterTypes) {
    let current = [];
    for (const paragraph of paragraphSignals) {
      if (paragraph.scores[type.key] >= 2 || paragraph.dominant_register === type.key.replaceAll("_", " ")) {
        current.push(paragraph.paragraph);
      } else {
        pushCluster(clusters, current, type.label);
        current = [];
      }
    }
    pushCluster(clusters, current, type.label);
  }

  return clusters;
}

function pushCluster(clusters, paragraphs, clusterType) {
  if (paragraphs.length < 3) return;
  clusters.push({
    paragraphs,
    cluster_type: clusterType,
    risk: "Several consecutive paragraphs use the same register or rhetorical move; review for saturation rather than automatic cuts.",
  });
}

function repeatedSentenceOpenings(sentences) {
  const counts = new Map();
  for (const sentence of sentences) {
    const words = sentence
      .toLowerCase()
      .replace(/^[^a-z0-9"]+/, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    if (words) counts.set(words, (counts.get(words) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((left, right) => right[1] - left[1])
    .map(([opening, count]) => ({ opening, count }))
    .slice(0, 12);
}

function patternExamples(body) {
  return {
    as_if: collectMatches(body, /[^.!?\n]{0,120}\bas if\b[^.!?\n]{0,160}[.!?]/gi, 8),
    not_x_but_y: collectMatches(body, /[^.!?\n]{0,120}\bnot\b[^.!?\n]{0,100}\b(but|rather than|instead|it is|it's)\b[^.!?\n]{0,140}[.!?]/gi, 8),
    not_fragment_reframe: collectMatches(body, /(?:^|[\n.!?]\s+)Not\s+[^.!?\n]{1,48}[.!?]\s+[A-Z][^.!?\n]{1,120}[.!?]/g, 8),
    less_x_than_y: collectMatches(body, /[^.!?\n]{0,120}\bless\b[^.!?\n]{0,80}\bthan\b[^.!?\n]{0,140}[.!?]/gi, 8),
    aphoristic_closers: body
      .split(/\n{2,}/)
      .map((paragraph) => lastSentence(paragraph.trim()))
      .filter((sentence) => sentence && wordCount(sentence) <= 12)
      .slice(0, 12),
  };
}

function buildFingerprintPrompt(targets) {
  const prompt = fs.existsSync(abs("reviews/prompts/voice-fingerprint.md")) ? read(abs("reviews/prompts/voice-fingerprint.md")) : "";
  const files = [
    "style.md",
    "style/pattern-watchlist.md",
    "style/protected-lines.md",
    ...targets.map(displayPath),
  ]
    .map((file) => (path.isAbsolute(file) ? file : abs(file)))
    .filter((file) => fs.existsSync(file));

  const fileBlocks = files.map((file) => `<file path="${displayPath(file)}">\n${read(file)}\n</file>`).join("\n\n");
  return [
    "CRITICAL OUTPUT CONTRACT:",
    "- Return exactly one valid JSON object.",
    "- First character `{`, last character `}`.",
    "- No prose, Markdown fences, headings, preamble, or visible reasoning outside JSON.",
    "",
    prompt,
    "",
    "Approved voice samples and style files:",
    "",
    fileBlocks,
  ].join("\n");
}

function parseJsonObject(rawOutput) {
  return parseJsonObjectOrThrow(rawOutput);
}

function parseOptions(rawArgs) {
  const options = { positionals: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      options.positionals.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const rawKey = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (equalsIndex !== -1) {
      options[key] = arg.slice(equalsIndex + 1);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(rawKey)) {
      options[key] = true;
      continue;
    }

    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function finiteOption(value) {
  if (value === undefined || value === null || value === false) return Number.POSITIVE_INFINITY;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`Expected a numeric limit, got: ${value}`);
  return number;
}

function parseSectionContract(text) {
  const match = text.match(/^\s*<!--([\s\S]*?)-->/);
  if (!match) return null;

  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (field) fields.set(field[1], field[2]);
  }
  return fields;
}

function splitSentences(text) {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function hasDialogue(value) {
  return /["“”]/.test(value);
}

function lastSentence(paragraph) {
  const sentences = splitSentences(paragraph);
  return sentences.at(-1) ?? "";
}

function isAphoristicCloser(paragraph) {
  const last = lastSentence(paragraph);
  if (!last || wordCount(last) > 14) return false;
  return /[.!?]$/.test(last) && !/^"/.test(last);
}

function countMatches(value, regex) {
  return [...String(value ?? "").matchAll(regex)].length;
}

function collectMatches(value, regex, limit) {
  return [...String(value ?? "").matchAll(regex)].map((match) => match[0].trim().replace(/\s+/g, " ")).slice(0, limit);
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function stripContract(text) {
  return text.replace(/^\s*<!--[\s\S]*?-->/, "").trim();
}

function stripHeading(text) {
  return text.replace(/^# .+?\n+/, "").trim();
}

function readProjectName() {
  if (!fs.existsSync(abs("brief.md"))) return "";
  const match = read(abs("brief.md")).match(/^Working title:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function printHelp() {
  console.log(`style-calibration - voice fingerprint and pattern-saturation helpers

Usage:
  node scripts/style-calibration.mjs signals <draft-section.md> [...]
  node scripts/style-calibration.mjs fingerprint <approved-section.md> [...] [--model provider/model]

Commands:
  signals      Generate static style signals and register maps under state/style/.
  fingerprint  Extract or refresh style/voice-fingerprint.json from approved samples.

Options:
  --json              Print JSON result.
  --model id          Model for fingerprint extraction. Prefix with lightning: or openrouter: to route a model.
  --max-tokens n      Max response tokens for fingerprint extraction.
  --temperature n     Fingerprint extraction temperature.
  --output file       Fingerprint output path. Default: style/voice-fingerprint.json.
  --max-not-x-but-y n Fail signals when any target has more than n not-X-but-Y patterns.

Environment:
  OPENROUTER_API_KEY  Required for OpenRouter fingerprint models.
  LIGHTNING_API_KEY   Required for Lightning AI fingerprint models.
`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resolveInputPath(input) {
  return path.isAbsolute(input) ? input : abs(input);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function abs(rel) {
  return path.join(root, rel);
}

function displayPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
