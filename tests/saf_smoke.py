#!/usr/bin/env python3
"""SAF offline smoke checks. Read-only; no network, credentials or database access."""
from __future__ import annotations
import pathlib
import subprocess
import sys
import tempfile
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED = {
    "SAF-Portail": ["index.html", "lecteur.html", "SAF_Elearning_Atelier.html", "_redirects"],
    "SAF_International-_SMS": ["index.html", "SAF_International_Safety.html",
        "SAF_International_Compliance_Monitoring_System.html", "SAF_Report.html",
        "SAF_Suivi_Flotte.html"],
    "SAF-Retex": ["index.html", "admin.html", ".github/workflows/pages.yml"],
    "SAF-Suivi-B3": ["index.html", "sw.js", "manifest.webmanifest"],
    "SAF_Exports": ["SAF_International_Compliance_Monitoring_System.html"],
}
IGNORE_DIRS = {".git", "node_modules", "dist", "build", ".venv"}

class Scripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.in_script = False
        self.chunks = []
        self.scripts = []
    def handle_starttag(self, tag, attrs):
        if tag != "script":
            return
        opts = dict(attrs)
        kind = (opts.get("type") or "text/javascript").lower()
        self.in_script = ("src" not in opts and kind in (
            "text/javascript", "application/javascript", "module", ""))
        self.chunks = []
    def handle_data(self, data):
        if self.in_script:
            self.chunks.append(data)
    def handle_endtag(self, tag):
        if tag == "script":
            if self.in_script:
                self.scripts.append("".join(self.chunks))
            self.in_script = False

def files(suffix):
    return sorted(p for p in ROOT.rglob("*") if p.is_file()
        and p.suffix.lower() in suffix
        and not any(part in IGNORE_DIRS for part in p.relative_to(ROOT).parts))

def main():
    errors = []
    repo = ROOT.name
    for expected in EXPECTED.get(repo, []):
        if not (ROOT / expected).is_file():
            errors.append("Missing critical file: " + expected)
    html = files({".html", ".htm"})
    if not html:
        errors.append("No HTML entrypoints found")
    scanned = 0
    with tempfile.TemporaryDirectory() as tmp:
        target = pathlib.Path(tmp) / "inline.mjs"
        for path in files({".html", ".htm", ".js", ".mjs"}):
            content = path.read_text(encoding="utf-8-sig")
            if any(token in content for token in ("<<<<<<< HEAD", "=======" + "\\n" + ">>>>>>>")):
                # The second marker is checked only as a conflict sequence, not alone.
                if "<<<<<<< HEAD" in content:
                    errors.append(f"{path.relative_to(ROOT)}: unresolved merge conflict")
            snippets = []
            if path.suffix.lower() in (".js", ".mjs"):
                snippets = [content]
            else:
                extractor = Scripts()
                extractor.feed(content)
                snippets = extractor.scripts
            for index, code in enumerate(snippets, 1):
                if not code.strip():
                    continue
                target.write_text(code, encoding="utf-8")
                result = subprocess.run(["node", "--check", str(target)],
                    capture_output=True, text=True)
                scanned += 1
                if result.returncode:
                    errors.append(f"{path.relative_to(ROOT)} script {index}: "
                        + result.stderr[-900:].strip())
    print(f"SAF read-only smoke check: {repo}, {len(html)} HTML files, {scanned} JS scripts checked")
    if errors:
        for error in errors:
            print("FAIL:", error, file=sys.stderr)
        return 1
    print("PASS: critical files present, JavaScript syntax valid, no merge markers")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
