#!/usr/bin/env python3
"""Static validation for ScanVuong Offline — Python stdlib only, no dependencies.

Run from the repo root:
    python3 scripts/validate_static.py

Checks (see CLAUDE.md / AGENTS.md for why these matter):
  - manifest.webmanifest / vercel.json are valid JSON
  - server.py parses as valid Python
  - every asset sw.js caches actually exists on disk
  - no external/CDN URL literals in the app shell files
  - privacy boundary in app.js: no XHR/sendBeacon/WebSocket/storage APIs/fetch
"""
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAILURES = []


def check(name):
    def run(fn):
        try:
            detail = fn()
            print(f"PASS  {name}" + (f" — {detail}" if detail else ""))
        except AssertionError as e:
            FAILURES.append(name)
            print(f"FAIL  {name} — {e}")
        except Exception as e:  # keep scanning even if one check errors out
            FAILURES.append(name)
            print(f"FAIL  {name} — unexpected error: {e}")
    return run


def read(relpath):
    return (ROOT / relpath).read_text(encoding='utf-8')


def _manifest_json():
    json.loads(read('manifest.webmanifest'))


check("manifest.webmanifest is valid JSON")(_manifest_json)


def _vercel_json():
    json.loads(read('vercel.json'))


check("vercel.json is valid JSON")(_vercel_json)


def _party_taxonomy():
    data = json.loads(read('assets/party/document_types.json'))
    items = data.get('document_types')
    ids = [item.get('id') for item in items or []]
    assert len(items or []) == 104, "party taxonomy must contain exactly 104 document types"
    assert len(set(ids)) == 104, "party taxonomy contains duplicate type ids"
    assert all(item.get('filename_base') for item in items), "party taxonomy has an item without filename_base"
    return "104 canonical document types, unique ids, filename_base present"


check("party taxonomy is canonical shape and contains 104 unique types")(_party_taxonomy)

def _server_py_ast():
    ast.parse(read('server.py'), filename='server.py')


check("server.py parses as valid Python")(_server_py_ast)


def _sw_assets_exist():
    sw = read('sw.js')
    m = re.search(r"const ASSETS\s*=\s*\[(.*?)\];", sw, re.S)
    assert m, "could not find `const ASSETS = [...]` in sw.js"
    entries = re.findall(r"""['"](\.[^'"]*)['"]""", m.group(1))
    assert entries, "ASSETS array appears to be empty"
    for entry in entries:
        target = ROOT / 'index.html' if entry == './' else ROOT / entry.lstrip('./')
        assert target.is_file(), f"cached asset missing on disk: {entry!r} (expected {target})"
    return f"{len(entries)} cached asset(s) all present"


check("every sw.js ASSETS entry exists on disk")(_sw_assets_exist)

# Plain text scan (not comment/string-aware): a real http(s):// literal
# anywhere in these files — including inside a comment — is worth failing CI
# over, since this project's rule is that none should ever appear here.
EXTERNAL_URL_RE = re.compile(r"https?://")
SCANNED_FOR_EXTERNAL_URLS = ['index.html', 'app.js', 'party-pdf.js', 'party-mode.js', 'party-taxonomy.js', 'document-detector.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'pdf-compress.js', 'compress-mode.js']


def _no_external_urls():
    offenders = []
    for f in SCANNED_FOR_EXTERNAL_URLS:
        text = read(f)
        for m in EXTERNAL_URL_RE.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            offenders.append(f"{f}:{line}")
    assert not offenders, "external http(s):// URL literal(s) found at " + ", ".join(offenders)
    return f"{len(SCANNED_FOR_EXTERNAL_URLS)} file(s) scanned, no http(s):// literals"


check("no external/CDN URL literals in app shell files")(_no_external_urls)

# fetch() is legitimate in sw.js (same-origin cache refresh) but must never
# appear in app.js — the app processes documents purely on-device.
PRIVACY_FORBIDDEN_PATTERNS = {
    'XMLHttpRequest': r'\bXMLHttpRequest\b',
    'sendBeacon': r'\.sendBeacon\s*\(',
    'WebSocket': r'\bWebSocket\b',
    'localStorage': r'\blocalStorage\b',
    'sessionStorage': r'\bsessionStorage\b',
    'indexedDB': r'\bindexedDB\b',
    'document.cookie': r'\bdocument\.cookie\b',
    'fetch(': r'\bfetch\s*\(',
}


def _no_network_or_storage_in_app_js():
    app_js = '\\n'.join(read(f) for f in ['app.js', 'party-pdf.js', 'party-mode.js', 'party-taxonomy.js', 'pdf-compress.js', 'compress-mode.js'])
    hits = []
    for label, pattern in PRIVACY_FORBIDDEN_PATTERNS.items():
        for m in re.finditer(pattern, app_js):
            line = app_js.count('\n', 0, m.start()) + 1
            hits.append(f"{label} at app.js:{line}")
    assert not hits, "privacy boundary violation(s) in app.js: " + ", ".join(hits)
    return f"{len(PRIVACY_FORBIDDEN_PATTERNS)} forbidden pattern(s) absent from app.js"


check("app.js has no network calls or persistent storage APIs")(_no_network_or_storage_in_app_js)


def _sw_fetch_is_same_origin_only():
    sw = read('sw.js')
    assert 'fetch(' in sw, "sw.js should use fetch() for same-origin cache refresh"
    assert 'self.location.origin' in sw, "sw.js fetch handler must guard on same-origin requests"


check("sw.js fetch usage stays same-origin (documented guard present)")(_sw_fetch_is_same_origin_only)

# UI Emoji Guard: ensure all UI icons use consistent SVG and no emojis linger in app shell
EMOJI_RE = re.compile(r'[\U0001F300-\U0001F9FF\U00002700-\U000027BF\U00002600-\U000026FF\U0001FA00-\U0001FAFF\U00002B50\U00002B55\U000025FD-\U000025FE\U000026AA-\U000026AB]')
SCANNED_FOR_EMOJIS = ['index.html', 'styles.css', 'app.js', 'party-pdf.js', 'party-mode.js', 'party-taxonomy.js', 'document-detector.js', 'pdf-compress.js', 'compress-mode.js']


def _no_ui_emojis():
    hits = []
    for f in SCANNED_FOR_EMOJIS:
        text = read(f)
        for m in EMOJI_RE.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            hits.append(f"{f}:{line} ({m.group(0)!r})")
    assert not hits, "UI emoji(s) found in app shell files: " + ", ".join(hits)
    return f"{len(SCANNED_FOR_EMOJIS)} file(s) scanned, 0 emoji literals"


check("no UI emojis in app shell files")(_no_ui_emojis)

# Brand Guard: ensure no legacy branding strings remain in user-facing files
LEGACY_BRAND_RE = re.compile(r'\b(ScanVu[oô]ng|Scan\s+Vu[oô]ng)\b', re.IGNORECASE)
SCANNED_FOR_LEGACY_BRAND = ['index.html', 'manifest.webmanifest']


def _no_legacy_brand_in_user_facing():
    hits = []
    for f in SCANNED_FOR_LEGACY_BRAND:
        text = read(f)
        for m in LEGACY_BRAND_RE.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            hits.append(f"{f}:{line} ({m.group(0)!r})")
    assert not hits, "Legacy brand occurrence(s) in user-facing files: " + ", ".join(hits)
    return f"{len(SCANNED_FOR_LEGACY_BRAND)} file(s) scanned, 0 legacy brand literals"


check("no legacy brand in user-facing files")(_no_legacy_brand_in_user_facing)


def main():
    print(f"Vigil Lens static validation — {ROOT}\n")
    if FAILURES:
        print(f"\n{len(FAILURES)} check(s) FAILED: {', '.join(FAILURES)}")
        sys.exit(1)
    print("\nAll static validation checks PASSED.")


if __name__ == '__main__':
    main()
