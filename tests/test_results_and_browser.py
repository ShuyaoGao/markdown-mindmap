# -*- coding: utf-8 -*-
"""results/result.json (written by tools/browser_check.py from the page's self-test) and,
optionally (RUN_BROWSER=1), a fresh headless Edge run of that self-test."""
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
RESULT = ROOT / "results" / "result.json"


def test_result_json_records_a_passing_selftest():
    r = json.loads(RESULT.read_text(encoding="utf-8"))
    lay = r["layouts"]
    assert len(lay) == 9 and all(v["overlaps"] == 0 and v["nodes"] >= 15 for v in lay.values()), lay
    assert lay["course/mindmap"]["nodes"] == 21 and lay["paper/outline"]["nodes"] == 22 and lay["week/tree"]["nodes"] == 19
    kb = r["keyboard_build"]
    assert kb["built"] == 10 and kb["after"] == kb["before"] + 10 and kb["depthAfterOutdent"] == kb["depthBeforeOutdent"] - 1
    ur = r["undo_redo"]
    assert ur["afterAdd"] == ur["before"] + 1 and ur["afterUndo"] == ur["before"] and ur["afterRedo"] == ur["afterAdd"]
    assert r["markdown_sync"]["textToTree"] and r["markdown_sync"]["treeToText"]
    assert r["drag_reparent"]["reparented"] and r["drag_reparent"]["cycleRejected"]
    assert r["collapse_find"]["collapsedCount"] >= 1 and r["collapse_find"]["findMatches"] == 1
    assert all(r["formats"][k] for k in ("json", "opml", "freemind"))
    png = r["png_export"]
    assert png["ok"] and png["coloredPixels"] > 2000 and png["width"] > 200 and png["height"] > 100
    assert r["watch"]["nodes"] == r["watch"]["steps"] == 21
    for size, run in r["runs"].items():
        assert run["ok"] and not run["errors"], size
        for mode, layout in run["layout"].items():
            assert layout["ok"] and layout["hOverflow"] <= 0, (size, mode, layout)
        assert {"watch", "practice", "draw", "bigscreen"} <= set(run["layout"]), size


@pytest.mark.skipif(os.environ.get("RUN_BROWSER") != "1", reason="set RUN_BROWSER=1 to start a headless browser")
def test_browser_selftest_both_sizes():
    from tools import browser_check
    assert browser_check.main(["--no-result"]) == 0
