#!/usr/bin/env python3
"""Build an index.html that lists all magazine issues and redirects to latest."""

import os
import re
from datetime import datetime

MAGAZINES_DIR = "magazines"


def build():
    all_files = os.listdir(MAGAZINES_DIR)

    # Morning Edition files: YYYY-MM-DD.html (no prefix)
    morning_files = sorted(
        [f for f in all_files if re.match(r"\d{4}-\d{2}-\d{2}\.html", f)],
        reverse=True,
    )
    # Psych Edition files: psych-YYYY-MM-DD.html
    psych_files = sorted(
        [f for f in all_files if re.match(r"psych-\d{4}-\d{2}-\d{2}\.html", f)],
        reverse=True,
    )

    if not morning_files and not psych_files:
        print("No magazine issues found")
        return

    latest = morning_files[0] if morning_files else psych_files[0]

    def make_rows(files, prefix=""):
        rows = ""
        for f in files:
            date_str = f.replace(".html", "").replace(prefix, "")
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                label = dt.strftime("%B %-d, %Y — %A")
            except Exception:
                label = date_str
            rows += f'        <a href="{f}" class="issue">{label}</a>\n'
        return rows

    morning_rows = make_rows(morning_files)
    psych_rows = make_rows(psych_files, "psych-")

    sections = ""
    if morning_rows:
        sections += f'    <h2>Morning Edition</h2>\n    <div class="issues">\n{morning_rows}    </div>\n'
    if psych_rows:
        sections += f'    <h2>Psych Edition</h2>\n    <div class="issues">\n{psych_rows}    </div>\n'

    rows = sections  # for template below

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Morning Edition — Archive</title>
    <meta http-equiv="refresh" content="3;url={latest}">
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {{
            margin: 0;
            background: #0A0A0A;
            color: #F0F0F0;
            font-family: 'Inter', sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 4rem 2rem;
        }}
        h1 {{
            font-family: 'Fraunces', serif;
            font-size: clamp(2.5rem, 6vw, 4.5rem);
            font-weight: 900;
            margin-bottom: 0.5rem;
        }}
        h2 {{
            font-family: 'Fraunces', serif;
            font-size: 1.5rem;
            font-weight: 700;
            margin: 2rem 0 1rem;
            color: #ccc;
        }}
        .sub {{
            color: #888;
            font-size: 0.9rem;
            margin-bottom: 3rem;
        }}
        .issues {{
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            width: 100%;
            max-width: 500px;
        }}
        .issue {{
            color: #ccc;
            text-decoration: none;
            padding: 1rem 1.5rem;
            border: 1px solid #222;
            border-radius: 4px;
            transition: all 0.2s;
            font-size: 1rem;
        }}
        .issue:first-child {{
            background: #1A1A2E;
            border-color: #E94560;
            color: #fff;
        }}
        .issue:hover {{ background: #1A1A2E; border-color: #555; }}
    </style>
</head>
<body>
    <h1>Daily News</h1>
    <div class="sub">Redirecting to latest issue...</div>
{rows}
</body>
</html>"""

    path = os.path.join(MAGAZINES_DIR, "index.html")
    with open(path, "w") as f:
        f.write(html)
    print(f"Index built: {path}")


if __name__ == "__main__":
    build()
