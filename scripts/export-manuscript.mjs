#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverProtocol, protocolPaths } from "./lib/protocol.mjs";

const discovery = discoverProtocol({ cwd: process.cwd() });
const root = discovery.manuscriptRoot;
const paths = protocolPaths(discovery, { cwd: process.cwd() });
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const formats = new Set(splitList(options.formats ?? "md,html"));
const allowedFormats = new Set(["md", "html", "epub", "pdf"]);
const includeContents = !options.noContents;
if (!formats.size) fail("At least one export format is required.");
for (const format of formats) {
  if (!allowedFormats.has(format)) fail(`Unsupported format: ${format}`);
}

const manuscript = collectManuscript();
if (!manuscript.chapters.length) fail("No manuscript chapters found. Draft at least one non-todo chapter first.");

const outDir = resolveOutputPath(options.out ?? paths.exportsDir);
fs.mkdirSync(outDir, { recursive: true });

const slug = slugify(options.slug || manuscript.title || "manuscript");
const outputs = [];

if (formats.has("md")) outputs.push(writeMarkdown(manuscript, path.join(outDir, `${slug}.md`)));
if (formats.has("html")) outputs.push(writeHtml(manuscript, path.join(outDir, `${slug}.html`)));
if (formats.has("epub")) outputs.push(writeEpub(manuscript, path.join(outDir, `${slug}.epub`), slug));
if (formats.has("pdf")) outputs.push(writePdf(manuscript, path.join(outDir, `${slug}.pdf`), slug));
const manifest = writeExportManifest(manuscript, { slug, outputs, outDir });

if (options.json) {
  console.log(JSON.stringify({ outputs, manifest, title: manuscript.title, chapters: manuscript.chapters.length }, null, 2));
} else {
  console.log(`Exported ${manuscript.title} (${manuscript.chapters.length} chapter(s))`);
  for (const output of outputs) console.log(`- ${output.format}: ${output.file}`);
  console.log(`- manifest: ${manifest.file}`);
}

function collectManuscript() {
  const draftDir = abs("draft");
  const files = fs
    .readdirSync(draftDir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => path.join(draftDir, file));

  let title = titleFromBrief() || "Untitled";
  let subtitle = "";
  const chapters = [];

  for (const file of files) {
    const raw = read(file);
    const contract = parseSectionContract(raw);
    const kind = contract?.get("kind") ?? "";
    const status = contract?.get("status") || contract?.get("stage") || "";
    const body = stripContract(raw).trim();
    const heading = firstHeading(body);

    if (kind === "fiction.title" || path.basename(file).startsWith("00-")) {
      if (heading) title = heading.text;
      subtitle = stripFirstHeading(body).trim();
      continue;
    }

    if (!exportableSectionKind(kind)) continue;
    if (!options.includeTodo && status === "todo") continue;

    const contentAfterHeading = stripFirstHeading(body).trim();
    if (!contentAfterHeading && !options.includeTodo) continue;

    chapters.push({
      id: contract?.get("id") ?? path.basename(file, ".md"),
      file: displayPath(file),
      title: heading?.text ?? path.basename(file, ".md"),
      markdown: body,
      body_markdown: contentAfterHeading,
      status,
    });
  }

  return {
    title: String(options.title ?? title).trim() || "Untitled",
    subtitle: String(options.subtitle ?? subtitle).trim(),
    author: String(options.author ?? "").trim(),
    source_root: root,
    generated_at: new Date().toISOString(),
    include_contents: includeContents,
    chapters,
  };
}

function writeMarkdown(manuscript, file) {
  const lines = [];
  lines.push(`# ${manuscript.title}`);
  if (manuscript.subtitle) lines.push("", manuscript.subtitle);
  if (manuscript.author) lines.push("", `By ${manuscript.author}`);
  lines.push("", `Exported ${formatDate(manuscript.generated_at)} from ${path.basename(root)}.`);
  if (includeContents) {
    lines.push("", "## Contents", "");
    for (const chapter of manuscript.chapters) lines.push(`- ${chapter.title}`);
    lines.push("");
  }

  for (const chapter of manuscript.chapters) {
    lines.push("", chapter.markdown.trim(), "");
  }

  fs.writeFileSync(file, `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`);
  return exportOutput("md", file);
}

function writeHtml(manuscript, file) {
  const chapterHtml = manuscript.chapters
    .map((chapter) => `<section class="chapter" id="${escapeAttr(chapter.id)}">\n${markdownToHtml(chapter.markdown)}\n</section>`)
    .join("\n\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(manuscript.title)}</title>
  <style>${bookCss()}</style>
</head>
<body>
  <main class="book">
    <section class="title-page">
      <h1>${escapeHtml(manuscript.title)}</h1>
      ${manuscript.subtitle ? `<p class="subtitle">${inlineMarkdownToHtml(manuscript.subtitle)}</p>` : ""}
      ${manuscript.author ? `<p class="author">${escapeHtml(manuscript.author)}</p>` : ""}
    </section>
    ${includeContents ? `
    <nav class="toc" aria-label="Contents">
      <h2>Contents</h2>
      <ol>
        ${manuscript.chapters.map((chapter) => `<li><a href="#${escapeAttr(chapter.id)}">${escapeHtml(chapter.title)}</a></li>`).join("\n        ")}
      </ol>
    </nav>` : ""}
    ${chapterHtml}
  </main>
</body>
</html>
`;

  fs.writeFileSync(file, html);
  return exportOutput("html", file);
}

function writeEpub(manuscript, file, slug) {
  const zip = findExecutable("zip");
  if (!zip) fail("EPUB export requires the `zip` command.");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${slug}-epub-`));
  const metaInf = path.join(tmp, "META-INF");
  const oebps = path.join(tmp, "OEBPS");
  fs.mkdirSync(metaInf, { recursive: true });
  fs.mkdirSync(oebps, { recursive: true });

  fs.writeFileSync(path.join(tmp, "mimetype"), "application/epub+zip");
  fs.writeFileSync(
    path.join(metaInf, "container.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );

  fs.writeFileSync(path.join(oebps, "styles.css"), bookCss());
  const chapterFiles = [];
  manuscript.chapters.forEach((chapter, index) => {
    const chapterFile = `chapter-${String(index + 1).padStart(2, "0")}.xhtml`;
    chapterFiles.push({ file: chapterFile, chapter });
    fs.writeFileSync(path.join(oebps, chapterFile), xhtmlPage(manuscript, chapter, markdownToHtml(chapter.markdown)));
  });

  fs.writeFileSync(path.join(oebps, "nav.xhtml"), navXhtml(manuscript, chapterFiles));
  fs.writeFileSync(path.join(oebps, "content.opf"), contentOpf(manuscript, chapterFiles, slug));

  if (fs.existsSync(file)) fs.rmSync(file);
  execFileSync(zip, ["-X0", file, "mimetype"], { cwd: tmp, stdio: options.quiet ? "ignore" : "ignore" });
  execFileSync(zip, ["-Xr9D", file, "META-INF", "OEBPS"], { cwd: tmp, stdio: options.quiet ? "ignore" : "ignore" });
  fs.rmSync(tmp, { recursive: true, force: true });
  return exportOutput("epub", file);
}

function writePdf(manuscript, file, slug) {
  const python = findExecutable("python3");
  if (!python) fail("PDF export requires python3.");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${slug}-pdf-`));
  const dataFile = path.join(tmpDir, "manuscript.json");
  fs.writeFileSync(dataFile, `${JSON.stringify(manuscript, null, 2)}\n`);

  const renderer = packageAbs("scripts/render-pdf.py");
  execFileSync(python, [renderer, dataFile, file], { cwd: root, stdio: options.quiet ? "ignore" : "inherit" });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return exportOutput("pdf", file);
}

function writeExportManifest(manuscript, { slug, outputs, outDir }) {
  const file = path.join(outDir, "manifest.json");
  const manifest = {
    schema_version: "manuscript-lab.export-manifest.v1",
    export_id: `export-${manuscript.generated_at.replace(/[:.]/g, "-")}-${slug}`,
    created_at: manuscript.generated_at,
    title: manuscript.title,
    subtitle: manuscript.subtitle,
    author: manuscript.author,
    slug,
    profile: discovery.config?.profile ?? "generic",
    mode: discovery.mode,
    source_commit: gitCommit(),
    source_dirty: gitDirty(),
    gate_enforced: false,
    options: {
      formats: [...formats].sort(),
      include_todo: Boolean(options.includeTodo),
      include_contents: includeContents,
      output_dir: displayPath(outDir),
    },
    chapters: manuscript.chapters.map((chapter) => ({
      id: chapter.id,
      file: chapter.file,
      title: chapter.title,
      status: chapter.status,
      sha256: sha256File(abs(chapter.file)),
    })),
    input_hashes: inputHashes(manuscript),
    outputs,
    output_summary: {
      count: outputs.length,
      formats: outputs.map((output) => output.format),
      bytes: outputs.reduce((sum, output) => sum + Number(output.size ?? 0), 0),
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    file: displayPath(file),
    export_id: manifest.export_id,
    schema_version: manifest.schema_version,
    outputs: outputs.length,
  };
}

function exportOutput(format, file) {
  const stat = fs.statSync(file);
  return {
    format,
    file: displayPath(file),
    size: stat.size,
    sha256: sha256File(file),
  };
}

function inputHashes(manuscript) {
  const candidates = [
    "PROJECT.md",
    "brief.md",
    "outline.md",
    "style.md",
    "state/status.md",
    "state/claims.md",
    "sources/index.md",
    ...manuscript.chapters.map((chapter) => chapter.file),
  ];
  const seen = new Set();
  const hashes = {};
  for (const rel of candidates) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const file = abs(rel);
    if (fs.existsSync(file)) hashes[rel] = sha256File(file);
  }
  return hashes;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: discovery.workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function gitDirty() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: discovery.workspaceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
  } catch {
    return null;
  }
}

function xhtmlPage(manuscript, chapter, html) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head>
  <title>${escapeHtml(chapter.title)} - ${escapeHtml(manuscript.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section class="chapter" id="${escapeAttr(chapter.id)}">
${html}
  </section>
</body>
</html>
`;
}

function navXhtml(manuscript, chapterFiles) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <title>${escapeHtml(manuscript.title)} Contents</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${chapterFiles.map(({ file: chapterFile, chapter }) => `<li><a href="${chapterFile}">${escapeHtml(chapter.title)}</a></li>`).join("\n      ")}
    </ol>
  </nav>
</body>
</html>
`;
}

function contentOpf(manuscript, chapterFiles, slug) {
  const modified = manuscript.generated_at.replace(/\.\d{3}Z$/, "Z");
  const manifestChapters = chapterFiles
    .map(({ file: chapterFile }, index) => `    <item id="chapter-${index + 1}" href="${chapterFile}" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineChapters = chapterFiles.map((_, index) => `    <itemref idref="chapter-${index + 1}"/>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${stableUuid(slug, manuscript.title)}</dc:identifier>
    <dc:title>${escapeXml(manuscript.title)}</dc:title>
    <dc:language>en</dc:language>
    ${manuscript.author ? `<dc:creator>${escapeXml(manuscript.author)}</dc:creator>` : ""}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="styles" href="styles.css" media-type="text/css"/>
${manifestChapters}
  </manifest>
  <spine>
${spineChapters}
  </spine>
</package>
`;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdownToHtml(paragraph.join(" ").trim())}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const tag = list.type === "ol" ? "ol" : "ul";
    const items = list.items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("\n");
    blocks.push(`<${tag}>\n${items}\n</${tag}>`);
    list = null;
  };

  const pushListItem = (type, text) => {
    flushParagraph();
    if (!list || list.type !== type) {
      flushList();
      list = { type, items: [] };
    }
    list.items.push(text.trim());
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 3);
      blocks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(\*\s*){3,}$/.test(trimmed) || /^-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push('<div class="scene-break">* * *</div>');
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      pushListItem("ol", ordered[1]);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      pushListItem("ul", unordered[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
}

function inlineMarkdownToHtml(value) {
  const placeholders = [];
  let text = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${placeholders.length}@@`;
    placeholders.push(`<code>${code}</code>`);
    return token;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  for (let index = 0; index < placeholders.length; index += 1) text = text.replace(`@@CODE${index}@@`, placeholders[index]);
  return text;
}

function bookCss() {
  return `
:root {
  color-scheme: light;
  --ink: #1f2933;
  --muted: #5f6b76;
  --rule: #d8dee4;
}
body {
  margin: 0;
  background: #f8f7f3;
  color: var(--ink);
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.62;
}
.book {
  max-width: 780px;
  margin: 0 auto;
  padding: 48px 24px 80px;
  background: #fffdf8;
  min-height: 100vh;
}
.title-page {
  min-height: 55vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 42px;
}
h1, h2, h3 {
  font-family: Avenir, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.15;
  letter-spacing: 0;
}
h1 {
  font-size: 2.55rem;
  margin: 0 0 16px;
}
h2 {
  margin-top: 40px;
}
.subtitle, .author {
  color: var(--muted);
  font-size: 1.08rem;
}
.toc {
  border-bottom: 1px solid var(--rule);
  margin-bottom: 48px;
  padding-bottom: 32px;
}
.toc a {
  color: inherit;
  text-decoration: none;
}
.chapter {
  break-before: page;
  margin: 0 0 64px;
}
.chapter h1 {
  font-size: 2rem;
  margin-top: 0;
  padding-top: 24px;
}
p {
  margin: 0 0 1.05em;
}
.scene-break {
  text-align: center;
  margin: 2rem 0;
  color: var(--muted);
}
code {
  font-family: Menlo, Consolas, monospace;
  font-size: 0.92em;
}
@media print {
  body { background: white; }
  .book { max-width: none; padding: 0; }
}
`.trim();
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? { text: match[1].trim() } : null;
}

function stripFirstHeading(markdown) {
  return markdown.replace(/^#\s+.+\n*/, "");
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

function titleFromBrief() {
  if (!fs.existsSync(abs("brief.md"))) return "";
  const match = read(abs("brief.md")).match(/^Working title:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function stripContract(text) {
  return text.replace(/^\s*<!--[\s\S]*?-->/, "").trim();
}

function parseArgs(rawArgs) {
  const parsed = { help: false, json: false, includeTodo: false, quiet: false, noContents: false };
  const booleanOptions = new Set(["help", "json", "includeTodo", "quiet", "noContents"]);
  const valueOptions = new Set(["formats", "out", "slug", "title", "subtitle", "author"]);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const equalsIndex = arg.indexOf("=");
      const rawKey = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex);
      const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

      if (booleanOptions.has(key)) {
        if (equalsIndex !== -1) fail(`Option --${rawKey} does not take a value.`);
        parsed[key] = true;
      } else if (valueOptions.has(key)) {
        const nextValue = rawArgs[index + 1];
        parsed[key] = arg.slice(equalsIndex + 1);
        if (equalsIndex === -1) {
          if (nextValue === undefined || nextValue.startsWith("--")) fail(`Missing value for --${rawKey}.`);
          parsed[key] = nextValue;
          index += 1;
        }
      } else {
        fail(`Unknown option: --${rawKey}`);
      }
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

function splitList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "manuscript";
}

function stableUuid(slug, title) {
  const hash = createHash(`${slug}:${title}:${root}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function createHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function findExecutable(name) {
  try {
    return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function formatDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function resolveOutputPath(input) {
  return paths.resolveProjectOutput(input);
}

function abs(rel) {
  return paths.projectAbs(rel);
}

function packageAbs(rel) {
  return paths.packageAbs(rel);
}

function displayPath(file) {
  return paths.projectRel(file);
}

function exportableSectionKind(kind) {
  const value = String(kind ?? "");
  if (value.includes("chapter")) return true;
  return value === "document.section" || value.endsWith(".section");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`export-manuscript - export draft chapters as Markdown, HTML, EPUB, and PDF

Usage:
  npm run export
  node scripts/export-manuscript.mjs [options]

Options:
  --formats md,html,epub,pdf  Formats to export. Default: md,html.
                              epub needs zip; pdf needs python3 + reportlab.
  --out exports               Output directory. Default: exports.
  --slug manuscript-name      Output filename stem. Default: title slug.
  --title "Title"             Override exported title.
  --subtitle "Subtitle"       Override exported subtitle.
  --author "Name"             Add author metadata.
  --include-todo              Include todo chapter shells.
  --no-contents               Skip generated contents pages in Markdown, HTML, and PDF.
  --json                      Print machine-readable output.
  --quiet                     Suppress child tool output.
  --help, -h                  Show this help.

Every successful export writes exports/manifest.json with input/output hashes,
file sizes, formats, chapter metadata, source commit when available, and git
dirty state.
`);
}
