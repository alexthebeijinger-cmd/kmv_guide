#!/usr/bin/env python3
"""
Рендер Markdown-документа проекта (например, knowledge/CHECKLIST-VISIT.md)
в PDF с поддержкой кириллицы.

Использование:
    python3 scripts/render_md_to_pdf.py knowledge/CHECKLIST-VISIT.md output/checklist.pdf

Требует: pip install markdown --break-system-packages, установленный wkhtmltopdf
и шрифт DejaVu Sans (fc-list | grep -i dejavu).
"""
import sys
import subprocess
import tempfile
import os
import markdown

CSS = """
<style>
body { font-family: "DejaVu Sans", sans-serif; font-size: 12px; line-height: 1.45; }
h1 { font-size: 20px; }
h2 { font-size: 16px; margin-top: 20px; }
h3 { font-size: 14px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
code { background: #f2f2f2; padding: 1px 4px; }
</style>
"""


def render(md_path: str, pdf_path: str) -> None:
    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()

    html_body = markdown.markdown(text, extensions=["tables"])
    html_doc = f"<html><head><meta charset='utf-8'>{CSS}</head><body>{html_body}</body></html>"

    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as tmp:
        tmp.write(html_doc)
        tmp_path = tmp.name

    try:
        subprocess.run(
            [
                "wkhtmltopdf",
                "--encoding", "utf-8",
                "--page-size", "A4",
                "--margin-top", "15mm",
                "--margin-bottom", "15mm",
                "--margin-left", "15mm",
                "--margin-right", "15mm",
                tmp_path,
                pdf_path,
            ],
            check=True,
        )
    finally:
        os.unlink(tmp_path)

    print(f"OK: {pdf_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    render(sys.argv[1], sys.argv[2])
