# -*- coding: utf-8 -*-
"""Static checks on play/: it must run from file:// (double-click), offline, hand-written (no bundled library)."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PLAY = ROOT / "play"
INDEX = PLAY / "index.html"


def play_text_files():
    return [p for p in PLAY.rglob("*") if p.is_file() and p.suffix in {".html", ".js", ".css"}]


def test_index_uses_only_plain_local_scripts_and_styles():
    html = INDEX.read_text(encoding="utf-8")
    assert 'type="module"' not in html and "type='module'" not in html
    srcs = re.findall(r'<script[^>]*\ssrc="([^"]+)"', html)
    hrefs = re.findall(r'<link[^>]*\shref="([^"]+)"', html)
    assert srcs, "no scripts found"
    for ref in srcs + hrefs:
        assert not re.match(r"^(https?:)?//", ref), f"external reference {ref}"
        assert (PLAY / ref).is_file(), f"missing file {ref}"
    # every script in play/js is loaded, in dependency order (config first, app last)
    names = [Path(s).name for s in srcs]
    assert names[0] == "config.js" and names[-1] == "app.js"
    assert names.index("model.js") < names.index("markdown.js") < names.index("formats.js") < names.index("layout.js") < names.index("canvas.js")
    assert set(names) == {p.name for p in (PLAY / "js").glob("*.js")}


def test_no_network_module_or_service_worker_apis():
    banned = [r"\bfetch\s*\(", r"XMLHttpRequest", r"\bimport\s*\(", r"^\s*import\s", r"serviceWorker",
              r"WebSocket", r"navigator\.sendBeacon", r"https?://"]
    for p in play_text_files():
        text = p.read_text(encoding="utf-8")
        if p.name == "credits.js":          # data only (repository / Pages address shown as text), never loaded
            text = re.sub(r'"(REPO_URL|PAGES_URL)": "[^"]*"', "", text)
        if p.name == "canvas.js":           # the SVG namespace string and the link-protocol regex are not network calls
            text = text.replace("http://www.w3.org/2000/svg", "").replace("/^(https?:|mailto:)/i", "")
        if p.name == "unit_tests.js":
            continue
        for pat in banned:
            assert not re.search(pat, text, re.M), f"{p.relative_to(ROOT)} matches {pat}"


def test_no_third_party_library_or_font_files():
    """Everything in play/ is hand-written: no vendor directory, no font files, no minified bundles."""
    for p in PLAY.rglob("*"):
        if p.is_file():
            assert p.suffix in {".html", ".js", ".css"}, p
            assert "vendor" not in p.parts and ".min." not in p.name, p
    js = "\n".join(p.read_text(encoding="utf-8") for p in (PLAY / "js").glob("*.js"))
    for lib in ("markmap", "mind-elixir", "jsMind", "jsmind", "d3.", "React", "Vue"):
        assert lib not in js, lib


def test_credits_js_matches_credits_json():
    credits = json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))
    js = (PLAY / "js" / "credits.js").read_text(encoding="utf-8")
    payload = json.loads(js.split("window.CREDITS = ", 1)[1].rstrip().rstrip(";"))
    assert payload == {k: v for k, v in credits.items() if not k.startswith("_")}
    for key in ("AUTHOR", "AUTHOR_EMAIL", "UNIVERSITY_EN", "UNIVERSITY_KO", "SERIES_NAME_ZH", "REPO_NAME"):
        assert payload.get(key), key
    assert payload["AUTHOR_EMAIL"] == "gaoshuyao.mk@gmail.com" and payload["PAGES_URL"].endswith("/" + payload["REPO_NAME"] + "/")


def test_page_has_required_shell_elements():
    html = INDEX.read_text(encoding="utf-8")
    for needle in ['data-mode="watch"', 'data-mode="draw"', 'data-mode="practice"', 'id="help-btn"',
                   'id="exit-btn"', 'id="bigscreen"', 'id="footer"', 'id="dlg-help"', 'id="ended"',
                   'id="speed-presets"', 'id="tasks"', 'id="md-text"', 'id="canvas"', 'id="layout-select"', 'id="theme-select"',
                   'id="edit-input"', 'id="findbar"', 'id="dlg-confirm"', 'id="file-open"', 'id="rpane-outline"', 'id="rpane-stats"', 'id="rpane-source"',
                   # 手机竖屏：☰ 菜单、六个大按钮、全屏面板的「返回」、横屏提示、触屏说明图解
                   'id="menu-btn"', 'id="menu"', 'id="menu-exit"', 'id="menu-md"', 'id="mob-actions"', 'id="mob-sibling"', 'id="mob-child"',
                   'id="mob-outdent"', 'id="mob-edit"', 'id="mob-delete"', 'id="mob-undo"', 'id="sheet-close"',
                   'id="rotate-hint"', 'class="help-touch"', 'class="help-kbd"', 'viewport-fit=cover', 'table class="kbd"']:
        assert needle in html, needle
    assert "所有计算都已结束，可以直接关闭这个标签页" in html
    css = (PLAY / "css" / "mobile.css").read_text(encoding="utf-8")
    for needle in ["body.touchp", "100dvh", "touch-action: none", "safe-area-inset", "body.touchl", "#sheet-close", "sheet-md", "sheet-right"]:
        assert needle in css, needle
    app_css = (PLAY / "css" / "app.css").read_text(encoding="utf-8")
    assert "prefers-color-scheme: dark" in app_css, "dark mode follows the system"


def test_keyboard_map_in_help_matches_the_handler():
    """Every key in the help table is handled in app.js (and the brief's list is complete)."""
    js = (PLAY / "js" / "app.js").read_text(encoding="utf-8")
    for needle in ["case 'Enter'", "case 'Tab'", "case ' ': case 'F2'", "case 'Delete': case 'Backspace'", "case 'ArrowUp'", "case 'ArrowDown'",
                   "case 'ArrowLeft'", "case 'ArrowRight'", "case 'Home'", "low === 'z'", "low === 'y'", "k === 'Enter'", "k === 'ArrowUp'", "k === 'ArrowDown'",
                   "k === '/'", "low === 'f'", "k === '0'", "low === 'm'", "k === 'Escape'", "k === 'h' || k === 'H'"]:
        assert needle in js, needle
    html = INDEX.read_text(encoding="utf-8")
    for label in ["Enter", "Tab", "Shift", "F2", "Delete", "Backspace", "Ctrl", "Home", "Esc"]:
        assert f"<kbd>{label}</kbd>" in html, label


def test_canvas_uses_pointer_events_with_cancel_and_blur_reset():
    js = (PLAY / "js" / "canvas.js").read_text(encoding="utf-8")
    for needle in ["'pointerdown'", "'pointermove'", "'pointerup'", "'pointercancel'", "'blur'", "visibilitychange", "pinch", "setPointerCapture"]:
        assert needle in js, needle
    assert "touchstart" not in js and "mousedown" not in js


def test_samples_and_examples_agree():
    """docs/examples/*.md are exported from play/js/samples.js by tools/build.py (Node); the node counts in the README table match."""
    ex = ROOT / "docs" / "examples"
    readme = (ex / "README.md").read_text(encoding="utf-8")
    for base, nodes in (("course-tree", 21), ("paper-structure", 22), ("week-plan", 19)):
        for ext in ("md", "json", "opml", "mm"):
            assert (ex / f"{base}.{ext}").stat().st_size > 100, f"{base}.{ext}"
        j = json.loads((ex / f"{base}.json").read_text(encoding="utf-8"))

        def count(n):
            return 1 + sum(count(c) for c in n.get("children", []))

        assert count(j) == nodes, base
        assert f"| {nodes} | 3 |" in readme, base
    md = (ex / "course-tree.md").read_text(encoding="utf-8")
    assert md.startswith("# 机器学习与深度学习\n") and "<!-- " in md and "\n- " in md
    mm = (ex / "course-tree.mm").read_text(encoding="utf-8")
    assert mm.startswith('<map version="1.0.1">') and 'POSITION="left"' in mm
    opml = (ex / "course-tree.opml").read_text(encoding="utf-8")
    assert "<opml" in opml and '_note="' in opml


def test_release_zip_has_root_index_and_play(tmp_path):
    from tools import build
    out, size, n = build.make_zip(build.load_credits(), out_dir=tmp_path)
    import zipfile
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        assert "index.html" in names and "play/index.html" in names and "play/js/app.js" in names
        root = z.read("index.html").decode("utf-8")
        assert 'content="0; url=play/index.html"' in root and 'href="play/index.html"' in root
        assert "{{" not in root
        for n_ in names:
            assert n_.isascii(), n_
    assert out.name.isascii() and size <= 15 * 1024 * 1024 and n == len(names)


def test_publish_root_files():
    """Only in the published repository (tools/templates/ exists): .nojekyll and the root redirect page."""
    if not (ROOT / "tools" / "templates").is_dir():
        pytest.skip("internal checkout: root index.html / .nojekyll are rendered into publish/")
    assert (ROOT / ".nojekyll").is_file() and (ROOT / ".nojekyll").stat().st_size == 0
    root = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'content="0; url=play/index.html"' in root and "{{" not in root
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "gaoshuyao.mk@gmail.com" in readme and "AI 教学演示案例 / AI Teaching Demos" in readme.splitlines()[0]
    assert "gaoshuyao.mk@gmail.com" in (ROOT / "CITATION.cff").read_text(encoding="utf-8")
    assert "Contact: gaoshuyao.mk@gmail.com" in (ROOT / "LICENSE-docs").read_text(encoding="utf-8")
