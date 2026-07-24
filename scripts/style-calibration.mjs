#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JSON_OBJECT_RESPONSE_FORMAT, parseJsonObjectOrThrow } from "./lib/model-json.mjs";
import { callChatModel, describeModelRuntime, hasApiKeyForModel, providerMissingKeyMessage } from "./lib/model-provider.mjs";
import {
  analyzePatternOccurrences,
  evaluatePatternThresholds,
  findRegisterClusters,
  loadStyleRegistry,
  renderWatchlistMarkdown,
  scoreParagraphRegisters,
} from "./lib/style-registry.mjs";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";

// Root comes from protocol discovery so the canonical registry and state/
// outputs resolve from any subdirectory of a project; outside any project the
// tool still works standalone on the current directory.
const discovery = discoverProtocol({ cwd: process.cwd() });
const protocolReady = Boolean(discovery.config) && discovery.mode !== "none" && !(discovery.errors?.length ?? 0);
const protocol = protocolReady ? protocolPaths(discovery, { cwd: process.cwd() }) : null;
const root = protocolReady ? discovery.manuscriptRoot : process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? "help";
const rest = args.slice(1);
const BOOLEAN_OPTIONS = new Set(["json", "enforce"]);
const registry = loadStyleRegistry(root);
for (const warning of registry.warnings) console.error(`style registry warning: ${warning}`);

if (command === "help" || args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (command === "signals") {
  const options = parseOptions(rest);
  const targets = options.positionals;
  if (!targets.length) fail("signals requires at least one draft section");

  const outputs = targets.map((target) => writeSignals(resolveInputPath(target)));
  const failures = styleSignalFailures(outputs, options);
  if (options.enforce) {
    for (const output of outputs) {
      failures.push(...output.threshold_failures.map((failure) => failure.message));
    }
  }
  if (options.json) console.log(JSON.stringify(outputs, null, 2));
  else for (const output of outputs) console.log(`saved: ${output.signals_file} | ${output.register_map_file}`);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  process.exit(0);
}

if (command === "watchlist") {
  const options = parseOptions(rest);
  const outputFile = String(options.output ?? "style/pattern-watchlist.md");
  const markdown = renderWatchlistMarkdown(registry, { project: readProjectName() });
  fs.mkdirSync(path.dirname(abs(outputFile)), { recursive: true });
  fs.writeFileSync(abs(outputFile), markdown);
  if (options.json) {
    console.log(JSON.stringify({ output: outputFile, patterns: registry.patterns.length, registers: registry.registers.length, source: registry.source }, null, 2));
  } else {
    console.log(`saved: ${outputFile} (${registry.patterns.length} patterns, ${registry.registers.length} registers, source: ${registry.source})`);
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
    threshold_failures: analysis.threshold_failures,
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

  const occurrences = analyzePatternOccurrences({ body, paragraphs, registry });
  const paragraphSignals = paragraphs.map((paragraph, index) => analyzeParagraph(paragraph, index + 1, occurrences));
  const bodyWordCount = wordCount(body);

  const counters = {};
  const patternCounts = {};
  for (const { pattern, count } of occurrences.values()) {
    if (pattern.count_key) counters[pattern.count_key] = count;
    patternCounts[pattern.id] = {
      label: pattern.label ?? pattern.id,
      count,
      density_per_1000_words: bodyWordCount ? Number(((count / bodyWordCount) * 1000).toFixed(2)) : 0,
    };
  }
  counters.aphoristic_closer_count = paragraphSignals.filter((item) => item.flags.aphoristic_closer).length;
  counters.dialogue_paragraph_count = paragraphSignals.filter((item) => item.flags.dialogue).length;
  counters.comic_paragraph_count = paragraphSignals.filter((item) => (item.scores.comic_observation ?? 0) >= 2).length;
  counters.systems_pressure_paragraph_count = paragraphSignals.filter((item) => (item.scores.systems_pressure ?? 0) >= 2).length;

  const signals = {
    version: 1,
    generated_at: new Date().toISOString(),
    target: targetPath,
    section_id: sectionId,
    word_count: bodyWordCount,
    paragraph_count: paragraphs.length,
    sentence_count: sentences.length,
    registry_source: registry.source,
    signals: counters,
    pattern_counts: patternCounts,
    repeated_sentence_openings: repeatedSentenceOpenings(sentences),
    pattern_examples: patternExamples(paragraphs, occurrences),
    clusters: findRegisterClusters(paragraphSignals, registry.registers),
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

  const thresholdFailures = evaluatePatternThresholds({
    occurrences,
    wordCount: bodyWordCount,
    target: targetPath,
  });

  return { signals, register_map: registerMap, threshold_failures: thresholdFailures };
}

function analyzeParagraph(paragraph, paragraphNumber, occurrences) {
  const { scores, dominant, secondary } = scoreParagraphRegisters(paragraph, registry.registers, {
    hasDialogue,
    lastSentence,
    wordCount,
  });

  const flags = {
    aphoristic_closer: isAphoristicCloser(paragraph),
    dialogue: hasDialogue(paragraph),
  };
  for (const { pattern, perParagraph } of occurrences.values()) {
    if (!pattern.flag_key) continue;
    flags[pattern.flag_key] = (perParagraph[paragraphNumber - 1] ?? 0) > 0;
  }

  return {
    paragraph: paragraphNumber,
    excerpt: paragraph.replace(/\s+/g, " ").slice(0, 220),
    scores,
    dominant_register: dominant,
    secondary_register: secondary,
    flags,
  };
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

function patternExamples(paragraphs, occurrences) {
  const examples = {};
  for (const { pattern, examples: matched } of occurrences.values()) {
    if (!pattern.example_key && pattern.id === "punctuation.em_dash") continue;
    examples[pattern.example_key ?? pattern.id] = matched;
  }
  examples.aphoristic_closers = paragraphs
    .map((paragraph) => lastSentence(paragraph.trim()))
    .filter((sentence) => sentence && wordCount(sentence) <= 12)
    .slice(0, 12);
  return examples;
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
  node scripts/style-calibration.mjs watchlist [--output style/pattern-watchlist.md]
  node scripts/style-calibration.mjs fingerprint <approved-section.md> [...] [--model provider/model]

Commands:
  signals      Generate static style signals and register maps under state/style/.
  watchlist    Project the canonical style registry to a readable Markdown watchlist.
  fingerprint  Extract or refresh style/voice-fingerprint.json from approved samples.

Options:
  --json              Print JSON result.
  --model id          Model for fingerprint extraction. Prefix with lightning: or openrouter: to route a model.
  --max-tokens n      Max response tokens for fingerprint extraction.
  --temperature n     Fingerprint extraction temperature.
  --output file       Fingerprint or watchlist output path.
  --max-not-x-but-y n Fail signals when any target has more than n not-X-but-Y patterns.
  --enforce           Fail signals when registry max_count/max_per_1000_words/cluster limits are exceeded.

Patterns and registers come from built-in defaults merged with
state/truth/style.json (style_profile.pattern_registry, style_profile.registers).
Set "disabled": true on an entry to remove it; matching ids override defaults.

Environment:
  OPENROUTER_API_KEY  Required for OpenRouter fingerprint models.
  LIGHTNING_API_KEY   Required for Lightning AI fingerprint models.
`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resolveInputPath(input) {
  if (path.isAbsolute(input)) return input;
  if (protocol) return protocol.resolveProjectInputOrCwd(input);
  return abs(input);
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
