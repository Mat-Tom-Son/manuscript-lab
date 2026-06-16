#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

function main() {
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.paths.length) fail("Provide at least one Markdown file or directory.");

  const files = collectMarkdownFiles(options.paths);
  if (!files.length) fail("No Markdown files found in the requested targets.");

  const fileReports = files.map(analyzeFile);
  const corpus = combineReports(fileReports);
  const watchFailures = [...fileReports.flatMap((report) => report.watchlist), ...corpus.watchlist].some((item) => item.exceeds_limit);
  const result = {
    version: 1,
    generated_at: new Date().toISOString(),
    options: {
      min_count: options.minCount,
      top: options.top,
      phrase_sizes: options.phraseSizes,
      include_stopwords: options.includeStopwords,
      watch_terms: options.watchTerms,
      max_watch_count: options.maxWatchCount,
      max_watch_density: options.maxWatchDensity,
    },
    pass: !watchFailures,
    files: fileReports,
    corpus,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  process.exit(result.pass ? 0 : 1);
}


function analyzeFile(file) {
  const raw = read(file);
  const body = markdownToText(stripMarkdownContracts(raw));
  const tokens = tokenize(body);
  const wordCount = tokens.length;
  const topWords = topCounts(countWords(tokens, options.includeStopwords), options.minCount, options.top, wordCount);
  const phraseCounts = countPhrases(tokens, options.phraseSizes);
  const repeatedPhrases = topCounts(phraseCounts, options.minCount, options.top, wordCount);
  const watchlist = analyzeWatchlist(tokens, wordCount);

  return {
    file: displayPath(file),
    word_count: wordCount,
    top_repeated_non_stopwords: topWords,
    repeated_phrases: repeatedPhrases,
    watchlist,
  };
}

function combineReports(reports) {
  const tokens = reports.flatMap((report) => tokenize(markdownToText(stripMarkdownContracts(read(abs(report.file))))));
  const wordCount = tokens.length;
  const topWords = topCounts(countWords(tokens, options.includeStopwords), options.minCount, options.top, wordCount);
  const phraseCounts = countPhrases(tokens, options.phraseSizes);
  const repeatedPhrases = topCounts(phraseCounts, options.minCount, options.top, wordCount);
  const watchlist = analyzeWatchlist(tokens, wordCount);

  return {
    file_count: reports.length,
    word_count: wordCount,
    top_repeated_non_stopwords: topWords,
    repeated_phrases: repeatedPhrases,
    watchlist,
  };
}

function countWords(tokens, includeStopwords) {
  const counts = new Map();
  for (const token of tokens) {
    if (!includeStopwords && STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function countPhrases(tokens, sizes) {
  const counts = new Map();
  for (const size of sizes) {
    if (size < 2) continue;
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phraseTokens = tokens.slice(index, index + size);
      if (phraseTokens.every((token) => STOPWORDS.has(token))) continue;
      const phrase = phraseTokens.join(" ");
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return counts;
}

function analyzeWatchlist(tokens, wordCount) {
  return options.watchTerms
    .map((term) => {
      const termTokens = tokenize(term);
      const count = termTokens.length ? countTokenSequence(tokens, termTokens) : 0;
      const density = densityPerThousand(count, wordCount);
      const exceedsCount = Number.isFinite(options.maxWatchCount) && count > options.maxWatchCount;
      const exceedsDensity = Number.isFinite(options.maxWatchDensity) && density > options.maxWatchDensity;
      return {
        term,
        normalized: termTokens.join(" "),
        count,
        density_per_1000_words: density,
        exceeds_limit: exceedsCount || exceedsDensity,
      };
    })
    .filter((item) => item.normalized);
}

function countTokenSequence(tokens, sequence) {
  let count = 0;
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[index + offset] !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) count += 1;
  }
  return count;
}

function topCounts(counts, minCount, limit, wordCount) {
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term, count]) => ({
      term,
      count,
      density_per_1000_words: densityPerThousand(count, wordCount),
    }));
}

function densityPerThousand(count, wordCount) {
  if (!wordCount) return 0;
  return Number(((count / wordCount) * 1000).toFixed(2));
}

function stripMarkdownContracts(text) {
  let value = text.replace(/^\uFEFF/, "");
  value = value.replace(/^\s*---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  value = value.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  return value.replace(/<!--[\s\S]*?-->/g, " ");
}

function markdownToText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~#|[\]()>-]/g, " ")
    .replace(/&[a-z]+;/gi, " ");
}

function tokenize(text) {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu), (match) => normalizeToken(match[0]))
    .filter((token) => token && !isSingleLetterToken(token));
}

function normalizeToken(token) {
  return token
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/'s$/u, "")
    .trim();
}

function isSingleLetterToken(token) {
  return /^\p{L}$/u.test(token);
}

function collectMarkdownFiles(targets) {
  const seen = new Set();
  const files = [];
  for (const target of targets) {
    const full = abs(target);
    if (!fs.existsSync(full)) fail(`Target does not exist: ${target}`);
    const stat = fs.statSync(full);
    const matches = stat.isDirectory() ? walk(full).filter((file) => file.endsWith(".md")) : [full];
    for (const file of matches) {
      if (!file.endsWith(".md")) continue;
      const real = fs.realpathSync(file);
      if (seen.has(real)) continue;
      seen.add(real);
      files.push(file);
    }
  }
  return files.sort((left, right) => displayPath(left).localeCompare(displayPath(right)));
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else results.push(full);
  }
  return results;
}

function parseArgs(args) {
  const parsed = {
    help: false,
    json: false,
    includeStopwords: false,
    minCount: 3,
    top: 20,
    phraseSizes: [2, 3],
    watchTerms: [],
    maxWatchCount: Number.POSITIVE_INFINITY,
    maxWatchDensity: Number.POSITIVE_INFINITY,
    paths: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--include-stopwords") parsed.includeStopwords = true;
    else if (arg === "--min-count") {
      parsed.minCount = numberArg("--min-count", args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--min-count=")) parsed.minCount = numberArg("--min-count", arg.slice("--min-count=".length));
    else if (arg === "--top") {
      parsed.top = numberArg("--top", args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--top=")) parsed.top = numberArg("--top", arg.slice("--top=".length));
    else if (arg === "--phrases") {
      parsed.phraseSizes = parsePhraseSizes(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--phrases=")) parsed.phraseSizes = parsePhraseSizes(arg.slice("--phrases=".length));
    else if (arg === "--no-phrases") parsed.phraseSizes = [];
    else if (arg === "--watch") {
      parsed.watchTerms.push(...splitWatchTerms(args[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--watch=")) parsed.watchTerms.push(...splitWatchTerms(arg.slice("--watch=".length)));
    else if (arg === "--watch-file") {
      parsed.watchTerms.push(...readWatchFile(args[index + 1] ?? ""));
      index += 1;
    } else if (arg.startsWith("--watch-file=")) parsed.watchTerms.push(...readWatchFile(arg.slice("--watch-file=".length)));
    else if (arg === "--max-watch-count") {
      parsed.maxWatchCount = numberArg("--max-watch-count", args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--max-watch-count=")) parsed.maxWatchCount = numberArg("--max-watch-count", arg.slice("--max-watch-count=".length));
    else if (arg === "--max-watch-density") {
      parsed.maxWatchDensity = numberArg("--max-watch-density", args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--max-watch-density=")) parsed.maxWatchDensity = numberArg("--max-watch-density", arg.slice("--max-watch-density=".length));
    else if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    else parsed.paths.push(arg);
  }

  parsed.watchTerms = unique(parsed.watchTerms.map((term) => term.trim()).filter(Boolean));
  if (!Number.isInteger(parsed.minCount) || parsed.minCount < 1) fail("--min-count must be a positive integer");
  if (!Number.isInteger(parsed.top) || parsed.top < 1) fail("--top must be a positive integer");
  return parsed;
}

function parsePhraseSizes(value) {
  const sizes = String(value ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 2 && item <= 6);
  if (!sizes.length) fail("--phrases must include at least one integer from 2 through 6");
  return unique(sizes);
}

function splitWatchTerms(value) {
  return String(value)
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

function readWatchFile(file) {
  if (!file) fail("--watch-file requires a path");
  const full = abs(file);
  if (!fs.existsSync(full)) fail(`Watch file does not exist: ${file}`);
  return read(full)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
}

function numberArg(label, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${label} requires a number`);
  return Number.isInteger(number) ? number : number;
}

function printHuman(result) {
  console.log(`Word usage report: ${result.corpus.file_count} file(s), ${result.corpus.word_count} word(s)`);
  console.log("");
  printList("Top repeated non-stopwords", result.corpus.top_repeated_non_stopwords);
  if (options.phraseSizes.length) printList("Repeated phrases", result.corpus.repeated_phrases);
  if (result.corpus.watchlist.length) printWatchlist(result.corpus.watchlist);

  if (result.files.length > 1) {
    console.log("");
    console.log("Files:");
    for (const file of result.files) {
      const watchFailures = file.watchlist.filter((item) => item.exceeds_limit).length;
      const suffix = watchFailures ? `, watch limit failures=${watchFailures}` : "";
      console.log(`- ${file.file}: ${file.word_count} word(s)${suffix}`);
    }
  }
}

function printList(title, rows) {
  console.log(`${title}:`);
  if (!rows.length) {
    console.log("- none");
    return;
  }
  for (const row of rows) {
    console.log(`- ${row.term}: ${row.count} (${row.density_per_1000_words}/1k words)`);
  }
}

function printWatchlist(rows) {
  console.log("Watchlist:");
  for (const row of rows) {
    const marker = row.exceeds_limit ? "FAIL " : "";
    console.log(`- ${marker}${row.term}: ${row.count} (${row.density_per_1000_words}/1k words)`);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/word-usage.mjs [options] <file-or-dir...>

Reports repeated words and phrases in Markdown prose.

Options:
  --json                         Print machine-readable JSON instead of text.
  --min-count <n>                Minimum count for repeated terms. Default: 3.
  --top <n>                      Number of repeated words/phrases to show. Default: 20.
  --phrases <sizes>              Comma-separated phrase sizes. Default: 2,3.
  --no-phrases                   Skip repeated phrase analysis.
  --include-stopwords            Include common stopwords in word counts.
  --watch <term[,term...]>       Count one or more watchlisted words or phrases.
  --watch-file <path>            Read watch terms, one per line. # comments allowed.
  --max-watch-count <n>          Exit nonzero when a watch term count is above n.
  --max-watch-density <n>        Exit nonzero when a watch term density per 1k words is above n.
  -h, --help                     Show this help.

The scanner strips leading YAML front matter, leading HTML-comment section contracts,
other HTML comments, fenced code blocks, inline code, and Markdown link targets.`);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function abs(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function displayPath(value) {
  return path.relative(root, abs(value)) || ".";
}

function unique(values) {
  return [...new Set(values)];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "can't",
  "cannot",
  "could",
  "couldn't",
  "did",
  "didn't",
  "do",
  "does",
  "doesn't",
  "doing",
  "don't",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "hadn't",
  "has",
  "hasn't",
  "have",
  "haven't",
  "having",
  "he",
  "he'd",
  "he'll",
  "he's",
  "her",
  "here",
  "here's",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "how's",
  "i",
  "i'd",
  "i'll",
  "i'm",
  "i've",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "itself",
  "let",
  "me",
  "more",
  "most",
  "mustn't",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "shan't",
  "she",
  "she'd",
  "she'll",
  "she's",
  "should",
  "shouldn't",
  "so",
  "some",
  "such",
  "than",
  "that",
  "that's",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "there's",
  "these",
  "they",
  "they'd",
  "they'll",
  "they're",
  "they've",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "wasn't",
  "we",
  "we'd",
  "we'll",
  "we're",
  "we've",
  "were",
  "weren't",
  "what",
  "what's",
  "when",
  "when's",
  "where",
  "where's",
  "which",
  "while",
  "who",
  "who's",
  "whom",
  "why",
  "why's",
  "with",
  "won't",
  "would",
  "wouldn't",
  "you",
  "you'd",
  "you'll",
  "you're",
  "you've",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

main();
