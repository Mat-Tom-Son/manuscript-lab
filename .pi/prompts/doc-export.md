---
description: Export the current manuscript to MD, HTML, EPUB, and PDF
argument-hint: "[optional export flags]"
---
Export the current manuscript.

Arguments:

$ARGUMENTS

Steps:

1. Run `npm run export -- $ARGUMENTS`.
2. Confirm the generated files under `exports/`.
3. Run `unzip -t` on the EPUB when `zip`/`unzip` are available.
4. Run `pdfinfo` on the PDF when available.
5. Run `npm run done`.
6. Do not revise manuscript prose in this prompt.
