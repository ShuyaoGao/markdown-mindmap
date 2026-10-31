# -*- coding: utf-8 -*-
"""Phone / desktop acceptance of play/index.html (six device sizes, DevTools-protocol emulation).

    python -m tools.mobile_check_mindmap                 # -> results/mobile_check.json + docs/img/04-mobile-draw-390x844.png
    python -m tools.mobile_check_mindmap --out DIR       # keep all six screenshots + the raw report in DIR
    python -m tools.mobile_check_mindmap --no-write      # only check (used by RUN_BROWSER=1 pytest)

Playwright drives the locally installed Microsoft Edge (channel "msedge", nothing is downloaded) and emulates
390x844, 414x896, 360x780 (DPR 3) and 768x1024 (DPR 2) with touch, plus 1920x1080 and 1366x768 desktop.
Window-size tricks are not used: a headless Edge window cannot be narrower than ~500 px, which fakes overflow.

Every size: no horizontal overflow, no JS error (page error / console.error), one screenshot. Scenario on top:
  * first-open help closes with a tap; on touch sizes it shows the touch diagram and hides the key table;
  * "watch" mode: a caption is shown; on touch the right column sits below the canvas;
  * "draw" mode: 10 nodes built with Enter / Tab (desktop) or the bottom buttons 子级 / 同级 (touch), each with text;
    the whole page does not scroll (operation modes are one 100dvh screen); the six buttons are >= 44 px and inside the viewport;
  * one node dragged onto another node with an emulated touch sequence (touch) or the mouse (desktop): its parent changes;
  * one Markdown line added in the text box (touch: ☰ → 看 Markdown full-screen sheet) -> the new node appears in the tree;
  * PNG export contains coloured pixels;
  * "practice" mode: 7 tasks, one screen; menu / help / outline sheet open and close (touch).

The generic runner is tools/mobile_check.py (Edge lock so only one Edge runs on the machine, free-memory wait,
device emulation, screenshots); pip install playwright, nothing is downloaded (channel="msedge").
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "play" / "index.html"
RESULT = ROOT / "results" / "mobile_check.json"
README_SHOT = ROOT / "docs" / "img" / "04-mobile-draw-390x844.png"
README_SHOT_SOURCE = "m390x844"          # the size whose final state (draw mode, nodes built) goes into README
FACTS: dict[str, dict] = {}


# ---------------------------------------------------------------- helpers run inside the page
JS_STATE = """() => ({
  touchp: document.body.classList.contains('touchp'),
  mode: document.body.className.match(/m-(watch|draw|practice)/) ? RegExp.$1 : null,
  sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
  iw: innerWidth, ih: innerHeight, scrollY: window.scrollY,
  nodes: MindApp.tree() ? MindApp.tree().count() : -1,
  sel: MindApp.state.sel,
  helpOpen: document.getElementById('dlg-help').classList.contains('show'),
  sheet: (document.body.className.match(/sheet-(md|right)/) || [])[1] || null,
  menuHidden: document.getElementById('menu').hidden,
  editing: !document.getElementById('edit-box').hidden,
  tasks: document.querySelectorAll('#tasks li').length,
  caption: document.getElementById('cap-text').textContent.length,
})"""
JS_RECT = """sel => { const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; }"""
JS_VISIBLE = """sel => { const n = document.querySelector(sel); if (!n) return false; const cs = getComputedStyle(n);
  const r = n.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }"""
JS_PAIR = """() => {
  // pick A = first grandchild of branch 0, B = branch 1; zoom so both are visible, return client-space centres
  const t = MindApp.tree(), root = t.root, A = root.children[0].children[0], B = root.children[1];
  const st = document.getElementById('stage').getBoundingClientRect();
  for (const z of [1.0, 0.8, 0.6, 0.45, 0.35, 0.25]) {
    Canvas.zoomTo(z);
    const a = Canvas.nodeScreenRect(A.id), b = Canvas.nodeScreenRect(B.id);
    const mx = (a.x + a.w / 2 + b.x + b.w / 2) / 2, my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    Canvas.view.x += st.width / 2 - mx; Canvas.view.y += st.height / 2 - my; Canvas.zoomBy(1);
    const a2 = Canvas.nodeScreenRect(A.id), b2 = Canvas.nodeScreenRect(B.id);
    const inside = r => r.x > 2 && r.y > 2 && r.x + r.w < st.width - 2 && r.y + r.h < st.height - 2;
    if (inside(a2) && inside(b2)) return { a: A.id, b: B.id, ax: st.left + a2.x + a2.w / 2, ay: st.top + a2.y + a2.h / 2,
                                          bx: st.left + b2.x + b2.w / 2, by: st.top + b2.y + b2.h / 2, z, ah: a2.h, bh: b2.h };
  }
  return null;
}"""
JS_PARENT = """id => { const p = MindApp.tree().parentOf(id); return p ? p.id : null; }"""
JS_HAS_TEXT = """txt => { let f = false; MindApp.tree().walk(n => { if (n.text === txt) f = true; }); return f; }"""
JS_PNG = """() => MindApp.exportCanvas(1).then(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i] - d[i + 2]) > 20) n++; return { w: c.width, h: c.height, colored: n }; })"""


def touch_drag(page, points, step_ms=40):
    """Emulated single-finger drag through the DevTools protocol (Input.dispatchTouchEvent -> pointer events)."""
    cdp = page.context.new_cdp_session(page)
    try:
        x, y = points[0]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for x, y in points[1:]:
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
            page.wait_for_timeout(step_ms)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    finally:
        cdp.detach()


def mouse_drag(page, points, step_ms=25):
    page.mouse.move(*points[0])
    page.mouse.down()
    for x, y in points[1:]:
        page.mouse.move(x, y)
        page.wait_for_timeout(step_ms)
    page.mouse.up()


def line(p0, p1, n=12):
    return [(p0[0] + (p1[0] - p0[0]) * i / (n - 1), p0[1] + (p1[1] - p0[1]) * i / (n - 1)) for i in range(n)]


def scenario(page, size) -> list[str]:
    fails: list[str] = []
    mobile = size["kind"] == "mobile"
    facts = FACTS.setdefault(size["name"], {})

    def press(sel, timeout=5000):
        """Tap (touch sizes) / click (desktop); a miss is recorded as a failure instead of aborting the scenario."""
        try:
            (page.tap if mobile else page.click)(sel, timeout=timeout)
            return True
        except Exception as e:  # noqa: BLE001
            fails.append("点不到 %s：%s" % (sel, str(e).splitlines()[0]))
            return False

    def no_scroll(label):
        st = page.evaluate(JS_STATE)
        if st["sh"] > st["ih"] + 1 or st["scrollY"] > 0:
            fails.append("%s：整页还能滚动 scrollHeight=%d innerHeight=%d scrollY=%d" % (label, st["sh"], st["ih"], st["scrollY"]))

    st = page.evaluate(JS_STATE)

    # 0) first-open help overlay
    if not st["helpOpen"]:
        fails.append("首次打开没有弹出操作说明")
    else:
        if mobile:
            if not page.evaluate(JS_VISIBLE, ".help-touch"):
                fails.append("触屏说明图解没有显示")
            if page.evaluate(JS_VISIBLE, ".help-kbd"):
                fails.append("触屏设备仍显示键位表")
            r = page.evaluate(JS_RECT, "#help-close")
            if r["bottom"] > st["ih"] + 1 or r["h"] < 44:
                fails.append("「开始」按钮不在视口底部或触控区 < 44px：%s" % r)
        else:
            if not page.evaluate(JS_VISIBLE, "table.kbd"):
                fails.append("电脑：操作说明里没有键位表")
        press("#help-close")
        page.wait_for_timeout(200)
    st = page.evaluate(JS_STATE)
    if st["helpOpen"]:
        fails.append("操作说明没有关闭")
    if mobile != st["touchp"]:
        fails.append("body.touchp=%s 但尺寸类型是 %s" % (st["touchp"], size["kind"]))

    # 1) watch mode (default): caption present; on touch the right column sits below the stage
    if st["mode"] != "watch":
        fails.append("默认模式不是观看：%s" % st["mode"])
    if st["caption"] < 5:
        fails.append("观看模式没有解说文字")
    if not page.evaluate(JS_VISIBLE, "#rightcol"):
        fails.append("观看模式右栏不可见")
    if mobile:
        vr, rr = page.evaluate(JS_RECT, "#stage"), page.evaluate(JS_RECT, "#rightcol")
        if not (rr["y"] >= vr["bottom"] - 1):
            fails.append("观看：右栏没有排在图下方 stage.bottom=%s rightcol.top=%s" % (vr["bottom"], rr["y"]))
        if vr["w"] < size["w"] - 30:
            fails.append("观看：图没有占满宽度 %s / %s" % (vr["w"], size["w"]))

    # 2) draw mode: one screen; build 10 nodes with keys / bottom buttons
    press('#modes button[data-mode="draw"]')
    page.wait_for_timeout(600)
    st = page.evaluate(JS_STATE)
    if st["mode"] != "draw":
        fails.append("没有切到我来画")
    if mobile:
        no_scroll("我来画")
        if page.evaluate(JS_VISIBLE, "#rightcol") or page.evaluate(JS_VISIBLE, "#mdpane"):
            fails.append("手机操作模式下右栏 / Markdown 面板没有收起")
        for sel in ("#mob-sibling", "#mob-child", "#mob-outdent", "#mob-edit", "#mob-delete", "#mob-undo", "#menu-btn"):
            r = page.evaluate(JS_RECT, sel)
            if r["h"] < 44 or r["w"] < 44:
                fails.append("触控区 < 44px：%s %dx%d" % (sel, r["w"], r["h"]))
            if r["bottom"] > st["ih"] + 1 or r["y"] < 0:
                fails.append("按钮不在视口内：%s %s" % (sel, r))
    else:
        if not page.evaluate(JS_VISIBLE, "#mdpane") or not page.evaluate(JS_VISIBLE, "#rightcol"):
            fails.append("电脑：Markdown 面板或右栏不可见")
        if page.evaluate(JS_VISIBLE, "#menu-btn") or page.evaluate(JS_VISIBLE, "#mob-actions"):
            fails.append("电脑：手机专用的 ☰ / 大按钮不该显示")
    before = page.evaluate(JS_STATE)["nodes"]
    for i in range(10):
        if mobile:
            press("#mob-child" if i < 5 else "#mob-sibling")
            page.wait_for_timeout(120)
            if not page.evaluate(JS_STATE)["editing"]:
                fails.append("第 %d 个节点：按大按钮后没有出现输入框" % (i + 1)); break
            r = page.evaluate(JS_RECT, "#edit-box")
            if r["bottom"] > page.evaluate("innerHeight") + 1:
                fails.append("输入框不在视口内：%s" % r)
            page.keyboard.type("节点%d" % (i + 1))
            press("#edit-ok")
        else:
            page.keyboard.press("Tab" if i < 5 else "Enter")
            page.wait_for_timeout(60)
            if not page.evaluate(JS_STATE)["editing"]:
                fails.append("第 %d 个节点：按键后没有进入编辑" % (i + 1)); break
            page.keyboard.type("节点%d" % (i + 1))
            page.keyboard.press("Enter")
        page.wait_for_timeout(80)
    after = page.evaluate(JS_STATE)
    facts["built"] = after["nodes"] - before
    if after["nodes"] != before + 10:
        fails.append("建 10 个节点失败：%d -> %d" % (before, after["nodes"]))
    if not page.evaluate(JS_HAS_TEXT, "节点7"):
        fails.append("新节点没有文字（输入没有生效）")
    if mobile:
        no_scroll("建节点后")

    # 3) drag one node onto another: parent changes
    pair = page.evaluate(JS_PAIR)
    if not pair:
        fails.append("找不到能同时放进视口的两个节点（拖拽测试）")
    else:
        p0 = page.evaluate(JS_PARENT, pair["a"])
        pts = line((pair["ax"], pair["ay"]), (pair["bx"], pair["by"]))
        (touch_drag if mobile else mouse_drag)(page, pts)
        page.wait_for_timeout(300)
        p1 = page.evaluate(JS_PARENT, pair["a"])
        facts["reparented"] = p1 == pair["b"]
        if p1 != pair["b"]:
            fails.append("拖节点换父失败：parent %s -> %s（目标 %s，缩放 %s）" % (p0, p1, pair["b"], pair["z"]))

    # 4) Markdown: add one line -> tree updated
    marker = "来自Markdown"
    if mobile:
        press("#menu-btn"); page.wait_for_timeout(120)
        press("#menu-md"); page.wait_for_timeout(250)
        st = page.evaluate(JS_STATE)
        if st["sheet"] != "md" or not page.evaluate(JS_VISIBLE, "#md-text"):
            fails.append("「看 Markdown」没有全屏打开文本框")
    text = page.evaluate("document.getElementById('md-text').value")
    page.fill("#md-text", text.rstrip("\n") + "\n- " + marker + "\n")
    page.wait_for_timeout(450)
    facts["mdUpdated"] = page.evaluate(JS_HAS_TEXT, marker)
    if not facts["mdUpdated"]:
        fails.append("Markdown 改一行后图没有更新")
    if mobile:
        press("#sheet-close"); page.wait_for_timeout(250)
        if page.evaluate(JS_STATE)["sheet"]:
            fails.append("「返回」没有关闭 Markdown 面板")
        no_scroll("关闭面板后")
    else:
        page.keyboard.press("Escape")

    # 5) PNG export has content
    png = page.evaluate(JS_PNG)
    facts["pngPixels"] = png["colored"]
    if png["colored"] < 2000:
        fails.append("导出 PNG 几乎是空的：%s" % png)

    # 6) practice mode: 7 tasks, one screen
    press('#modes button[data-mode="practice"]')
    page.wait_for_timeout(500)
    st = page.evaluate(JS_STATE)
    if st["mode"] != "practice" or st["tasks"] != 7:
        fails.append("练习模式 / 任务数不对：%s %s" % (st["mode"], st["tasks"]))
    if mobile:
        no_scroll("练习")

    # 7) touch: outline sheet + menu/help; desktop: right column always visible
    if mobile:
        press("#menu-btn"); page.wait_for_timeout(120)
        if page.evaluate(JS_STATE)["menuHidden"]:
            fails.append("☰ 菜单没有打开")
        press("#menu-right"); page.wait_for_timeout(250)
        st = page.evaluate(JS_STATE)
        if st["sheet"] != "right" or not page.evaluate(JS_VISIBLE, "#rightcol") or not page.evaluate(JS_VISIBLE, "#sheet-close"):
            fails.append("「大纲 · 统计」没有全屏打开右栏")
        else:
            rr = page.evaluate(JS_RECT, "#rightcol")
            if rr["right"] > size["w"] + 1 or rr["bottom"] > st["ih"] + 1:
                fails.append("右栏面板超出视口：%s" % rr)
        press("#sheet-close"); page.wait_for_timeout(200)
        press("#menu-btn"); page.wait_for_timeout(120)
        press("#menu-help"); page.wait_for_timeout(200)
        st = page.evaluate(JS_STATE)
        if not st["helpOpen"] or not st["menuHidden"]:
            fails.append("菜单里的「操作说明」没有打开说明（或菜单没有收起）")
        press("#help-close"); page.wait_for_timeout(150)
    else:
        if not page.evaluate(JS_VISIBLE, "#rightcol"):
            fails.append("电脑：右栏不可见")

    # back to draw mode for the final screenshot (nodes built earlier are restored)
    press('#modes button[data-mode="draw"]')
    page.wait_for_timeout(500)
    page.evaluate("Canvas.fit()")
    page.wait_for_timeout(200)
    if mobile:
        no_scroll("结束时")
    return fails


def browser_version():
    try:
        from tools.browser_check import browser_version as bv, find_browser
        exe = find_browser()
        return {"name": Path(exe).stem if exe else "msedge", "version": bv(exe) if exe else None}
    except Exception:
        return {"name": "msedge", "version": None}


def write_outputs(report, out_dir: Path):
    rec = {
        "_note": "Generated by tools/mobile_check_mindmap.py: Playwright + locally installed Edge, DevTools-protocol device "
                 "emulation (size, DPR, mobile viewport, touch). Each size: no horizontal overflow, no JS error, plus the "
                 "scenario assertions listed in the script (help overlay, one-screen operation modes, 10 nodes built with "
                 "keys or bottom buttons, drag-to-reparent, Markdown line -> node, PNG export has content, practice tasks, "
                 "menu / sheets). facts = numbers measured in that run.",
        "browser": browser_version(),
        "page": "play/index.html",
        "ok": report["ok"],
        "sizes": [{**{k: v for k, v in s.items() if k != "screenshot"}, "facts": FACTS.get(s["name"], {}), "screenshot": Path(s["screenshot"]).name}
                  for s in report["sizes"]],
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    src = out_dir / (README_SHOT_SOURCE + ".png")
    if src.exists():
        README_SHOT.parent.mkdir(parents=True, exist_ok=True)
        try:
            from PIL import Image
            im = Image.open(src)
            im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)     # DPR 3 -> half size keeps the repo small
            im.save(README_SHOT, "PNG", optimize=True)
        except Exception:
            shutil.copyfile(src, README_SHOT)
    return rec


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="directory for the six screenshots and the raw report (default: a temporary directory)")
    ap.add_argument("--no-write", action="store_true", help="do not touch results/ and docs/img/")
    args = ap.parse_args(argv)
    from tools.mobile_check import run
    import tempfile
    out_dir = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="mdmm_mobile_"))
    report = run(str(INDEX), out_dir, scenario=scenario, settle_ms=1800)
    for s in report["sizes"]:
        print("%-11s %4dx%-4d DPR %s  %s  %s" % (s["name"], s["w"], s["h"], s["dpr"], "PASS" if not s["fails"] else "FAIL: " + " | ".join(s["fails"]), FACTS.get(s["name"])))
    print("summary:", "all %d sizes pass" % len(report["sizes"]) if report["ok"] else "FAILED")
    if not args.no_write:
        write_outputs(report, out_dir)
        print("wrote", RESULT.relative_to(ROOT).as_posix(), "and", README_SHOT.relative_to(ROOT).as_posix())
    if not args.out:
        shutil.rmtree(out_dir, ignore_errors=True)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
