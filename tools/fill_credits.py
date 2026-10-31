# -*- coding: utf-8 -*-
"""Fill every double-brace placeholder (e.g. REPO_NAME) from credits.json (author, series, GitHub user, repo name ...)
and the numbers from results/result.json + results/mobile_check.json, then rebuild play/js/credits.js (and the release zip).

    python -m tools.fill_credits            # render tools/templates/*.tmpl -> repository root
    python -m tools.fill_credits --release  # ... and rebuild release/*.zip

Templates live in tools/templates/ (README.md.tmpl -> README.md, gitignore -> .gitignore, ...).
Re-running is safe: outputs are always regenerated from the templates. Finally it lists any
placeholder that is still unfilled anywhere in the repository.
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "tools" / "templates"
PH = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
TEXT_EXT = {".md", ".txt", ".cff", ".json", ".js", ".html", ".css", ".py", ".ini", ".opml", ".mm", ""}
RENAME = {"gitignore": ".gitignore", "nojekyll": ".nojekyll"}
BROWSERS = {"msedge": "Microsoft Edge", "chrome": "Google Chrome"}


def numbers_from_results():
    """results/result.json is written by tools/browser_check.py from the page's self-test."""
    p = ROOT / "results" / "result.json"
    if not p.exists():
        return {}
    r = json.loads(p.read_text(encoding="utf-8"))
    lay, kb, png = r["layouts"], r["keyboard_build"], r["png_export"]
    return {
        "BROWSER": BROWSERS.get(r["browser"]["name"], r["browser"]["name"]),
        "BROWSER_VERSION": r["browser"].get("version") or "",
        "LAYOUT_CASES": str(len(lay)), "LAYOUT_OVERLAPS": str(sum(v["overlaps"] for v in lay.values())),
        "COURSE_NODES": str(lay["course/mindmap"]["nodes"]), "PAPER_NODES": str(lay["paper/mindmap"]["nodes"]), "WEEK_NODES": str(lay["week/mindmap"]["nodes"]),
        "KB_BUILT": str(kb["built"]), "PNG_W": str(png["width"]), "PNG_H": str(png["height"]), "PNG_COLORED": f"{png['coloredPixels']:,}",
        "WATCH_STEPS": str(r["watch"]["steps"]),
    }


def numbers_from_mobile_check():
    """results/mobile_check.json is written by tools/mobile_check_mindmap.py (six device sizes, DevTools emulation)."""
    p = ROOT / "results" / "mobile_check.json"
    if not p.exists():
        return {}
    r = json.loads(p.read_text(encoding="utf-8"))
    sizes = r.get("sizes", [])
    fmt = lambda s: f"{s['w']}×{s['h']}" + (f"（DPR {s['dpr']}）" if s.get("dpr", 1) != 1 else "")  # noqa: E731
    b = r.get("browser") or {}
    return {
        "MOBILE_SIZES_TOTAL": str(len(sizes)),
        "MOBILE_SIZES_PASS": str(sum(1 for s in sizes if not s.get("fails"))),
        "MOBILE_SIZES_LIST": "、".join(fmt(s) for s in sizes if s.get("kind") == "mobile"),
        "DESKTOP_SIZES_LIST": "、".join(fmt(s) for s in sizes if s.get("kind") == "desktop"),
        "MOBILE_BROWSER": ((BROWSERS.get(b.get("name"), b.get("name") or "") + " " + (b.get("version") or "")).strip()),
    }


def render(values):
    written = []
    for tpl in sorted(TEMPLATES.iterdir()):
        if not tpl.is_file():
            continue
        name = tpl.name[:-len(".tmpl")] if tpl.name.endswith(".tmpl") else tpl.name
        out = ROOT / RENAME.get(name, name)
        text = tpl.read_text(encoding="utf-8")
        text = PH.sub(lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)
        out.write_text(text, encoding="utf-8", newline="\n")
        written.append(out)
    return written


def leftover_placeholders():
    left = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or ".git" in p.parts or "templates" in p.parts or p.suffix not in TEXT_EXT:
            continue
        if p.stat().st_size > 2_000_000:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in PH.finditer(text):
            left.append((p.relative_to(ROOT).as_posix(), m.group(0)))
    return left


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", action="store_true")
    args = ap.parse_args(argv)
    if not TEMPLATES.is_dir():
        raise SystemExit("tools/templates/ not found (run this inside the published repository)")
    credits = json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))
    values = {k: v for k, v in credits.items() if not k.startswith("_")}
    values.update(numbers_from_results())
    values.update(numbers_from_mobile_check())
    for p in render(values):
        print("wrote", p.relative_to(ROOT).as_posix())
    from tools import build
    build.main(["--release"] if args.release else [])
    left = leftover_placeholders()
    if left:
        print("UNFILLED placeholders:")
        for f, ph in left:
            print("  ", f, ph)
    else:
        print("no unfilled placeholders")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
