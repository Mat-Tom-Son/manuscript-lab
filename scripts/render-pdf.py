#!/usr/bin/env python3

import html
import json
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import inch
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer


PAGE_SIZE = (6 * inch, 9 * inch)


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: render-pdf.py manuscript.json output.pdf", file=sys.stderr)
        return 1

    data_file = Path(sys.argv[1])
    output_file = Path(sys.argv[2])
    manuscript = json.loads(data_file.read_text(encoding="utf-8"))
    output_file.parent.mkdir(parents=True, exist_ok=True)
    build_pdf(manuscript, output_file)
    return 0


def build_pdf(manuscript: dict, output_file: Path) -> None:
    doc = SimpleDocTemplate(
        str(output_file),
        pagesize=PAGE_SIZE,
        rightMargin=0.62 * inch,
        leftMargin=0.62 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.68 * inch,
        title=manuscript.get("title", "Manuscript"),
        author=manuscript.get("author", ""),
    )

    styles = make_styles()
    story = []

    story.append(Spacer(1, 1.6 * inch))
    story.append(Paragraph(xml_text(manuscript.get("title", "Untitled")), styles["TitlePage"]))
    subtitle = manuscript.get("subtitle", "").strip()
    if subtitle:
        story.append(Spacer(1, 0.18 * inch))
        story.append(Paragraph(inline_markup(subtitle), styles["Subtitle"]))
    author = manuscript.get("author", "").strip()
    if author:
        story.append(Spacer(1, 0.3 * inch))
        story.append(Paragraph(xml_text(author), styles["Author"]))

    include_contents = manuscript.get("include_contents", True)
    if include_contents:
        story.append(PageBreak())
        story.append(Paragraph("Contents", styles["ContentsHeading"]))
        for chapter in manuscript.get("chapters", []):
            story.append(Paragraph(xml_text(chapter.get("title", "")), styles["ContentsEntry"]))

    for chapter in manuscript.get("chapters", []):
        story.append(PageBreak())
        for block in markdown_blocks(chapter.get("markdown", "")):
            kind = block["kind"]
            text = block["text"]
            if kind == "h1":
                story.append(Paragraph(inline_markup(text), styles["ChapterTitle"]))
            elif kind == "h2":
                story.append(Paragraph(inline_markup(text), styles["Heading2"]))
            elif kind == "h3":
                story.append(Paragraph(inline_markup(text), styles["Heading3"]))
            elif kind == "break":
                story.append(Spacer(1, 0.18 * inch))
                story.append(Paragraph("* * *", styles["SceneBreak"]))
                story.append(Spacer(1, 0.18 * inch))
            elif kind == "ol":
                for index, item in enumerate(block["items"], start=1):
                    story.append(Paragraph(f"{index}. {inline_markup(item)}", styles["ListItem"]))
            elif kind == "ul":
                for item in block["items"]:
                    story.append(Paragraph(f"- {inline_markup(item)}", styles["ListItem"]))
            else:
                story.append(Paragraph(inline_markup(text), styles["Body"]))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def make_styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "TitlePage": ParagraphStyle(
            "TitlePage",
            parent=base["Title"],
            fontName="Times-Bold",
            fontSize=28,
            leading=32,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "Subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=13,
            leading=17,
            textColor=colors.HexColor("#4f5b66"),
            alignment=TA_CENTER,
        ),
        "Author": ParagraphStyle(
            "Author",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=12,
            leading=16,
            alignment=TA_CENTER,
        ),
        "ContentsHeading": ParagraphStyle(
            "ContentsHeading",
            parent=base["Heading1"],
            fontName="Times-Bold",
            fontSize=18,
            leading=23,
            spaceAfter=16,
        ),
        "ContentsEntry": ParagraphStyle(
            "ContentsEntry",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=11.5,
            leading=16,
            leftIndent=0.15 * inch,
            spaceAfter=6,
        ),
        "ChapterTitle": ParagraphStyle(
            "ChapterTitle",
            parent=base["Heading1"],
            fontName="Times-Bold",
            fontSize=20,
            leading=25,
            spaceAfter=20,
        ),
        "Heading2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="Times-Bold",
            fontSize=15,
            leading=19,
            spaceBefore=10,
            spaceAfter=8,
        ),
        "Heading3": ParagraphStyle(
            "Heading3",
            parent=base["Heading3"],
            fontName="Times-BoldItalic",
            fontSize=12.5,
            leading=16,
            spaceBefore=8,
            spaceAfter=6,
        ),
        "Body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=11.2,
            leading=16.2,
            firstLineIndent=0.18 * inch,
            spaceAfter=7,
        ),
        "ListItem": ParagraphStyle(
            "ListItem",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=11.2,
            leading=16.2,
            leftIndent=0.28 * inch,
            firstLineIndent=-0.18 * inch,
            spaceAfter=4,
        ),
        "SceneBreak": ParagraphStyle(
            "SceneBreak",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=12,
            leading=16,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6b7280"),
        ),
    }


def footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Times-Roman", 9)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    if doc.page > 1:
        canvas.drawCentredString(PAGE_SIZE[0] / 2, 0.35 * inch, str(doc.page))
    canvas.restoreState()


def markdown_blocks(markdown: str) -> list[dict]:
    markdown = strip_contract(markdown).strip()
    blocks = []
    paragraph = []
    current_list = None

    def flush() -> None:
        nonlocal paragraph
        if paragraph:
            blocks.append({"kind": "p", "text": " ".join(paragraph).strip()})
            paragraph = []

    def flush_list() -> None:
        nonlocal current_list
        if current_list:
            blocks.append(current_list)
            current_list = None

    def add_list_item(kind: str, text: str) -> None:
        nonlocal current_list
        flush()
        if not current_list or current_list["kind"] != kind:
            flush_list()
            current_list = {"kind": kind, "text": "", "items": []}
        current_list["items"].append(text.strip())

    for line in markdown.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if not stripped:
            flush()
            flush_list()
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            flush()
            flush_list()
            blocks.append({"kind": f"h{min(len(heading.group(1)), 3)}", "text": heading.group(2).strip()})
            continue

        if re.match(r"^(\*\s*){3,}$", stripped) or re.match(r"^-{3,}$", stripped):
            flush()
            flush_list()
            blocks.append({"kind": "break", "text": ""})
            continue

        ordered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if ordered:
            add_list_item("ol", ordered.group(1))
            continue

        unordered = re.match(r"^[-*]\s+(.+)$", stripped)
        if unordered:
            add_list_item("ul", unordered.group(1))
            continue

        flush_list()
        paragraph.append(stripped)

    flush()
    flush_list()
    return blocks


def strip_contract(text: str) -> str:
    return re.sub(r"^\s*<!--.*?-->", "", text, flags=re.S).strip()


def inline_markup(text: str) -> str:
    escaped = xml_text(text)
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(^|[\s(])\*([^*\n]+)\*", r"\1<i>\2</i>", escaped)
    escaped = re.sub(r"(^|[\s(])_([^_\n]+)_", r"\1<i>\2</i>", escaped)
    return escaped


def xml_text(text: str) -> str:
    return html.escape(str(text), quote=False)


if __name__ == "__main__":
    raise SystemExit(main())
