// Node unit tests for the DOM-free parts of play/ (tree model, undo/redo, Markdown <-> tree, JSON / OPML / FreeMind, layout).
// Run: node tests/js/unit_tests.js   -> prints one JSON line {passed, failed, failures:[...]} and exits 1 on failure.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS = path.resolve(__dirname, "..", "..", "play", "js");
const ctx = { console, Math, JSON, Map, Set, Date, Infinity };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["config.js", "model.js", "markdown.js", "formats.js", "layout.js", "samples.js"]) {
  vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
}
const { Model, Markdown, Formats, Layout, SAMPLES, APP_CONFIG: CFG } = ctx;
const { Tree, History } = Model;

const failures = [];
let passed = 0;
function test(name, fn) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function assert(c, msg) { if (!c) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja !== jb) throw new Error((msg || "not equal") + `\n  got:  ${ja.slice(0, 300)}\n  want: ${jb.slice(0, 300)}`); }
function sampleTree(i) { return new Tree(Markdown.parse(SAMPLES[i].md).root); }
function shape(n) { const o = { text: n.text }; if (n.note) o.note = n.note; if (n.children.length) o.children = n.children.map(shape); return o; }
const measure = (s, bold, size) => Layout.estimateMeasure(s, bold, size);
const sizeFn = (n, d) => Layout.nodeSize(n, d, measure);

/* ---------------- 树模型 ---------------- */
test("addChild / addSibling / remove keep parent links and order", () => {
  const t = new Tree();
  const a = t.addChild(t.root.id, "a"), b = t.addSibling(a.id, "b"), c = t.addSibling(a.id, "c", true);
  eq(t.root.children.map(n => n.text), ["c", "a", "b"]);
  assert(t.parentOf(b.id) === t.root && t.depthOf(b.id) === 1);
  const r = t.addSibling(t.root.id, "child-of-root");          // root has no sibling -> child
  assert(t.parentOf(r.id) === t.root && t.root.children.length === 4);
  t.remove(a.id);
  assert(!t.get(a.id) && t.root.children.length === 3);
  assert(t.remove(t.root.id) === null, "root cannot be removed");
});
test("move rejects self / descendants and re-parents otherwise", () => {
  const t = new Tree();
  const a = t.addChild(t.root.id, "a"), b = t.addChild(t.root.id, "b"), a1 = t.addChild(a.id, "a1");
  assert(t.move(a.id, a1.id) === null, "cannot move under own descendant");
  assert(t.move(a.id, a.id) === null);
  assert(t.move(a1.id, b.id));
  assert(t.parentOf(a1.id) === b && a.children.length === 0 && b.children[0] === a1);
  assert(t.move(b.id, t.root.id, 0));
  eq(t.root.children.map(n => n.text), ["b", "a"]);
});
test("moveUp / moveDown / outdent / indent", () => {
  const t = new Tree();
  const a = t.addChild(t.root.id, "a"), b = t.addChild(t.root.id, "b"), c = t.addChild(t.root.id, "c");
  t.moveDown(a.id); eq(t.root.children.map(n => n.text), ["b", "a", "c"]);
  t.moveUp(c.id); eq(t.root.children.map(n => n.text), ["b", "c", "a"]);
  assert(t.moveUp(b.id) === null && t.moveDown(a.id) === null);
  t.indent(c.id); eq(shape(t.root).children, [{ text: "b", children: [{ text: "c" }] }, { text: "a" }]);
  t.outdent(c.id); eq(t.root.children.map(n => n.text), ["b", "c", "a"]);
  assert(t.outdent(b.id) === null, "depth-1 node cannot outdent");
  assert(t.indent(b.id) === null, "first child cannot indent");
});
test("toJSON omits defaults, fromJSON restores everything, snapshot keeps ids", () => {
  const t = new Tree();
  const a = t.addChild(t.root.id, "a");
  t.setProps(a.id, { color: "#ff0000", icon: "⭐", priority: 2, note: "n" });
  t.addChild(a.id, "a1"); t.toggleCollapse(a.id);
  const j = t.toJSON();
  eq(j, { text: "中心主题", children: [{ text: "a", note: "n", collapsed: true, color: "#ff0000", icon: "⭐", priority: 2, children: [{ text: "a1" }] }] });
  const t2 = Tree.fromJSON(j);
  eq(t2.toJSON(), j);
  const snap = t.snapshot(), t3 = Tree.fromJSON(snap, true);
  assert(t3.get(a.id) && t3.get(a.id).text === "a", "ids kept");
  eq(Tree.fromJSON({ root: j }).toJSON(), j, "accepts {root: ...} wrapper");
});
test("stats / descendantCount / visibleList respect collapse", () => {
  const t = sampleTree(0);
  const s = t.stats();
  assert(s.nodes === 21 && s.depth === 2 && s.levels[1] === 5 && s.levels[2] === 15, JSON.stringify(s));
  const branch = t.root.children[1];
  assert(t.descendantCount(branch.id) === 4);
  t.toggleCollapse(branch.id);
  assert(t.visibleList().length === 21 - 4 && t.count() === 21);
  t.expandTo(branch.children[0].id);
  assert(!branch.collapsed);
});
test("History: undo / redo with snapshots", () => {
  const t = new Tree(), h = new History(3);
  h.push({ json: t.snapshot(), sel: t.root.id });
  const a = t.addChild(t.root.id, "a");
  h.push({ json: t.snapshot(), sel: a.id });
  t.setText(a.id, "a-renamed");
  const s1 = h.undo({ json: t.snapshot(), sel: a.id });
  const t1 = Tree.fromJSON(s1.json, true);
  assert(t1.get(a.id).text === "a" && h.canRedo());
  const s0 = h.undo({ json: t1.snapshot(), sel: a.id });
  assert(Tree.fromJSON(s0.json, true).root.children.length === 0 && !h.canUndo());
  const r1 = h.redo({ json: s0.json, sel: s0.sel }); assert(Tree.fromJSON(r1.json, true).root.children.length === 1);
  const r2 = h.redo({ json: r1.json, sel: r1.sel }); assert(Tree.fromJSON(r2.json, true).get(a.id).text === "a-renamed");
  assert(!h.canRedo());
  for (let i = 0; i < 5; i++) h.push({ json: t.snapshot(), sel: null });
  assert(h.undoStack.length === 3, "limit");
});

/* ---------------- Markdown ---------------- */
test("parse headings + lists (2 / 4 spaces, tabs, numbered) into one tree", () => {
  const md = "# Root\n## A\n- a1\n    - a1x\n    - a1y\n- a2\n## B\n1. b1\n\t2. b1x\n* b2\n";
  const r = Markdown.parse(md);
  eq(shape(r.root), { text: "Root", children: [
    { text: "A", children: [{ text: "a1", children: [{ text: "a1x" }, { text: "a1y" }] }, { text: "a2" }] },
    { text: "B", children: [{ text: "b1", children: [{ text: "b1x" }] }, { text: "b2" }] }] });
  assert(r.headingLevels === 2);
});
test("notes: single-line and multi-line comments attach to the previous node; plain lines become notes", () => {
  const md = "# R\n<!-- root note -->\n## A\n<!--\nline 1\nline 2\n-->\n- a1\n  <!-- deep -->\nplain text\n";
  const r = Markdown.parse(md).root;
  assert(r.note === "root note");
  assert(r.children[0].note === "line 1\nline 2", JSON.stringify(r.children[0].note));
  assert(r.children[0].children[0].note === "deep\nplain text");
});
test("plain first line is the root; several top-level nodes get a synthetic root; depth jumps are clamped", () => {
  eq(shape(Markdown.parse("我的导图\n- x\n").root), { text: "我的导图", children: [{ text: "x" }] });
  const r = Markdown.parse("## A\n## B\n").root;
  eq(shape(r), { text: "思维导图", children: [{ text: "A" }, { text: "B" }] });
  eq(shape(Markdown.parse("# R\n#### deep\n").root), { text: "R", children: [{ text: "deep" }] });
  assert(Markdown.parse("").empty && Markdown.parse("   \n").root.text === "思维导图");
});
test("serialize -> parse round trip is lossless for all samples (text, structure, notes) and keeps cursor map", () => {
  for (const s of SAMPLES) {
    const t = sampleTree(SAMPLES.indexOf(s));
    for (const hl of [1, 2, 3, 6]) {
      const out = Markdown.serialize(t.root, { headingLevels: hl });
      const back = Markdown.parse(out.text);
      eq(shape(back.root), shape(t.root), `${s.id} headingLevels=${hl}`);
      assert(back.headingLevels === Math.min(hl, t.stats().depth + 1), `${s.id}: headingLevels detected ${back.headingLevels}`);
      const lines = out.text.split("\n");
      t.walk(n => { const li = out.lineOf[n.id]; assert(lines[li].indexOf(n.text) >= 0, `lineOf ${n.text}`); });
    }
  }
});
test("texts that look like markers are escaped and round-trip", () => {
  const t = new Tree(Model.makeNode("# not a heading"));
  t.addChild(t.root.id, "- not a list"); t.addChild(t.root.id, "1. numbered"); t.addChild(t.root.id, "<!-- not a note");
  t.setNote(t.root.children[0].id, "has --> inside");
  const back = Markdown.parse(Markdown.serialize(t.root).text).root;
  eq(back.children.map(c => c.text), ["- not a list", "1. numbered", "<!-- not a note"]);
  assert(back.text === "# not a heading");
  assert(back.children[0].note.indexOf("has --") === 0, back.children[0].note);
});
test("inline: bold / code / link / plain", () => {
  eq(Markdown.inline("a **b** `c` [d](http://x/y) e"), [{ t: "text", s: "a " }, { t: "bold", s: "b" }, { t: "text", s: " " }, { t: "code", s: "c" },
    { t: "text", s: " " }, { t: "link", s: "d", href: "http://x/y" }, { t: "text", s: " e" }]);
  assert(Markdown.plain("**粗** `x` [l](u)") === "粗 x l");
  eq(Markdown.inline(""), [{ t: "text", s: "" }]);
});
test("merge keeps ids / colors / icons / collapse by text, falls back to position when the text was edited", () => {
  const old = Markdown.parse("# R\n## A\n- a1\n## B\n").root;
  const A = old.children[0], B = old.children[1], a1 = A.children[0];
  A.color = "#123456"; B.icon = "⭐"; a1.priority = 3; A.collapsed = true;
  const neu = Markdown.parse("# R\n## B\n## A-renamed\n- a1\n## C\n").root;
  Markdown.merge(old, neu);
  assert(neu.id === old.id);
  assert(neu.children[0].id === B.id && neu.children[0].icon === "⭐", "B matched by text although moved");
  assert(neu.children[1].id === A.id && neu.children[1].color === "#123456" && neu.children[1].collapsed === true, "A matched by position after rename");
  assert(neu.children[1].children[0].id === a1.id && neu.children[1].children[0].priority === 3);
  assert(neu.children[2].id !== B.id && neu.children[2].id !== A.id, "C is new");
  const leaf = Markdown.parse("# R\n## A\n").root; leaf.children[0].collapsed = true;
  const neu2 = Markdown.merge(leaf, Markdown.parse("# R\n## A\n").root);
  assert(neu2.children[0].collapsed === false, "collapsed is dropped on a node without children");
});

/* ---------------- 格式 ---------------- */
test("JSON export / import is lossless (all attributes)", () => {
  const t = sampleTree(1);
  const a = t.root.children[0];
  t.setProps(a.id, { color: "#00aa00", icon: "💡", priority: 1 }); t.toggleCollapse(a.id);
  const text = Formats.toJSON(t);
  assert(text.trim()[0] === "{" && text.indexOf('"id"') < 0, "no ids in the public JSON");
  eq(Formats.fromJSON(text).toJSON(), t.toJSON());
});
test("OPML export / import round trip; OPML from another tool (several top-level outlines)", () => {
  const t = sampleTree(2);
  t.setNote(t.root.children[0].id, 'note with "quotes" & <tags>'); t.setProps(t.root.children[1].id, { color: "#abc", icon: "🔥", priority: 2 }); t.toggleCollapse(t.root.children[2].id);
  const x = Formats.toOPML(t);
  assert(x.indexOf("<opml") >= 0 && x.indexOf("&quot;quotes&quot; &amp; &lt;tags&gt;") > 0);
  eq(Formats.fromOPML(x).toJSON(), t.toJSON());
  const foreign = '<?xml version="1.0"?><opml version="1.0"><head><title>My list</title></head><body>\n<outline text="One"><outline text="1.1" _note="n"/></outline>\n<outline text="Two"/></body></opml>';
  eq(Formats.fromOPML(foreign).toJSON(), { text: "My list", children: [{ text: "One", children: [{ text: "1.1", note: "n" }] }, { text: "Two" }] });
});
test("FreeMind export / import round trip; a real-looking .mm with richcontent and icons imports", () => {
  const t = sampleTree(0);
  t.setProps(t.root.children[0].id, { color: "#ff8800", icon: "📌", priority: 3 }); t.toggleCollapse(t.root.children[3].id);
  const mm = Formats.toFreeMind(t);
  assert(mm.indexOf('<map version="1.0.1">') === 0 && mm.indexOf('POSITION="right"') > 0 && mm.indexOf('POSITION="left"') > 0);
  eq(Formats.fromFreeMind(mm).toJSON(), t.toJSON());
  const foreign = `<map version="1.0.1">
<node CREATED="1" ID="ID_1" MODIFIED="2" TEXT="Root &amp; co">
<node CREATED="1" ID="ID_2" MODIFIED="2" POSITION="right" TEXT="Right 1" FOLDED="true" COLOR="#0000ff">
<icon BUILTIN="full-1"/>
<richcontent TYPE="NOTE"><html>
  <head></head>
  <body>
    <p>line one</p>
    <p>line <b>two</b></p>
  </body>
</html></richcontent>
<node ID="ID_3" TEXT="leaf"/>
</node>
<node ID="ID_4" POSITION="left"><richcontent TYPE="NODE"><html><body><p>Rich &lt;node&gt;</p></body></html></richcontent></node>
</node>
</map>`;
  const f = Formats.fromFreeMind(foreign).toJSON();
  eq(f, { text: "Root & co", children: [
    { text: "Right 1", note: "line one\nline two", collapsed: true, color: "#0000ff", priority: 1, children: [{ text: "leaf" }] },
    { text: "Rich <node>" }] });
});
test("mini XML parser: entities, CDATA, comments, self-closing, single quotes, processing instructions", () => {
  const d = Formats.parseXML('<?xml version="1.0"?><!DOCTYPE x><!-- c --><a x="1 &amp; 2" y=\'q\'><b/><c><![CDATA[<raw> & stuff]]></c>t&#x4e2d;&#25991;&nbsp;</a>');
  assert(d.name === "a" && d.attrs.x === "1 & 2" && d.attrs.y === "q");
  assert(d.children.length === 3 && d.children[0].name === "b" && d.children[1].children[0].text === "<raw> & stuff");
  assert(d.children[2].text === "t中文 ", JSON.stringify(d.children[2].text));
});
test("detect / importAny pick the right parser", () => {
  assert(Formats.detect('{"text":"x"}') === "json" && Formats.detect("<opml>") === "opml" && Formats.detect("﻿<map version='1'>") === "freemind" && Formats.detect("# x") === "markdown" && Formats.detect("<foo/>") === "xml");
  assert(Formats.importAny("# A\n- b").format === "markdown" && Formats.importAny("# A\n- b").tree.count() === 2);
  assert(Formats.importAny(Formats.toJSON(sampleTree(0))).tree.count() === 21);
  assert(Formats.importAny(Formats.toOPML(sampleTree(2))).format === "opml");
  assert(Formats.importAny(Formats.toFreeMind(sampleTree(1))).format === "freemind");
  let threw = false; try { Formats.importAny("<foo/>"); } catch (e) { threw = true; } assert(threw);
});

/* ---------------- 排版 ---------------- */
function randomTree(seed, n) {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const t = new Tree(Model.makeNode("根节点 root"));
  const ids = [t.root.id];
  const words = ["数据", "a very long english word sequence here", "短", "Transformer 与注意力机制的详细说明", "x", "**粗体** 和 `代码` 混排", "[链接](http://a/b)", "中文 english mixed 文本"];
  for (let i = 0; i < n; i++) {
    const p = ids[Math.floor(rnd() * ids.length)];
    const c = t.addChild(p, words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? " ".repeat(1) + words[Math.floor(rnd() * words.length)] : ""));
    if (rnd() < 0.15) c.icon = "⭐"; if (rnd() < 0.1) c.priority = 1 + Math.floor(rnd() * 3); if (rnd() < 0.1) c.note = "n";
    ids.push(c.id);
  }
  return t;
}
test("no overlapping nodes in all three layouts for the samples and 12 random trees", () => {
  const trees = SAMPLES.map((_, i) => sampleTree(i));
  for (let k = 0; k < 12; k++) trees.push(randomTree(k + 1, 20 + k * 7));
  let checked = 0;
  for (const t of trees) for (const mode of ["mindmap", "tree", "outline"]) {
    const r = Layout.compute(t, { mode, size: sizeFn });
    assert(r.nodes.length === t.count(), `${mode}: ${r.nodes.length} boxes for ${t.count()} nodes`);
    const bad = Layout.overlaps(r);
    assert(bad.length === 0, `${mode}: ${bad.length} overlaps e.g. ${JSON.stringify(bad[0])}`);
    for (const b of r.nodes) assert(b.x >= r.bbox.x - 1e-6 && b.y >= r.bbox.y - 1e-6 && b.x + b.w <= r.bbox.x + r.bbox.w + 1e-6 && b.y + b.h <= r.bbox.y + r.bbox.h + 1e-6, "bbox contains node");
    assert(r.edges.length === r.nodes.length - 1, `${mode}: edges`);
    checked++;
  }
  assert(checked === 45);
});
test("mindmap: root centred at origin, first half of the branches right, second half left, mirrored x", () => {
  const t = sampleTree(0);
  const r = Layout.compute(t, { mode: "mindmap", size: sizeFn });
  const rb = r.byId.get(t.root.id);
  assert(Math.abs(rb.cx) < 1 && Math.abs(rb.cy) < 1 && rb.side === "C");
  const sides = t.root.children.map(c => r.byId.get(c.id).side);
  eq(sides, ["R", "R", "R", "L", "L"]);
  for (const c of t.root.children) {
    const b = r.byId.get(c.id);
    if (b.side === "R") assert(b.x >= rb.x + rb.w + CFG.LAYOUT_PARAMS.hgap - 1); else assert(b.x + b.w <= rb.x - CFG.LAYOUT_PARAMS.hgap + 1);
    for (const g of c.children) { const gb = r.byId.get(g.id); assert(gb.side === b.side); if (b.side === "R") assert(gb.x > b.x + b.w); else assert(gb.x + gb.w < b.x); }
  }
  const tr = Layout.compute(t, { mode: "tree", size: sizeFn });
  assert(tr.nodes.every(b => b.side === "R" || b.side === "C"));
});
test("outline: one row per visible node in document order, indented by depth", () => {
  const t = sampleTree(1);
  const r = Layout.compute(t, { mode: "outline", size: sizeFn });
  const order = t.visibleList().map(n => n.id);
  eq(r.nodes.map(b => b.id), order);
  for (let i = 1; i < r.nodes.length; i++) assert(r.nodes[i].y >= r.nodes[i - 1].y + r.nodes[i - 1].h, "rows go down");
  r.nodes.forEach(b => assert(b.x === b.depth * CFG.LAYOUT_PARAMS.outlineIndent));
});
test("collapsed nodes hide their subtree and carry the descendant count", () => {
  const t = sampleTree(0);
  const br = t.root.children[0]; t.toggleCollapse(br.id);
  const r = Layout.compute(t, { mode: "mindmap", size: sizeFn });
  assert(r.nodes.length === 21 - 3 && r.byId.get(br.id).collapsedCount === 3);
  assert(!r.byId.get(br.children[0].id));
});
test("wrap: long text breaks into several lines within maxTextWidth; CJK breaks anywhere, Latin at spaces", () => {
  const long = "这是一段很长的中文节点文字，用来测试自动折行是否正常工作，应该会被切成好几行。";
  const s = Layout.nodeSize(Model.makeNode(long), 2, measure);
  assert(s.lines.length >= 3 && s.w <= CFG.LAYOUT_PARAMS.maxTextWidth + 2 * CFG.LAYOUT_PARAMS.padX + 1, `lines=${s.lines.length} w=${s.w}`);
  const lat = Layout.nodeSize(Model.makeNode("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda"), 2, measure);
  assert(lat.lines.length >= 2 && lat.lines.every(ln => !/^\s/.test(ln[0].s)), "no leading spaces on wrapped lines");
  const word = Layout.nodeSize(Model.makeNode("Supercalifragilisticexpialidocious_and_then_some_more_letters"), 2, measure);
  assert(word.lines.length >= 2, "an over-long word is hard-split");
  const bold = Layout.nodeSize(Model.makeNode("**粗体** 普通 `code`"), 2, measure);
  eq(bold.lines[0].map(r => r.t), ["bold", "text", "code"]);
  const r0 = Layout.nodeSize(Model.makeNode("根"), 0, measure), r2 = Layout.nodeSize(Model.makeNode("根"), 2, measure);
  assert(r0.font > r2.font && r0.h > r2.h, "root is bigger");
});

/* ---------------- 示例 ---------------- */
test("samples parse, have narration keys that exist in the tree, and quote the right node count", () => {
  assert(SAMPLES.length === 3);
  for (let i = 0; i < SAMPLES.length; i++) {
    const t = sampleTree(i), texts = new Set(); t.walk(n => texts.add(n.text));
    for (const k of Object.keys(SAMPLES[i].narration)) assert(texts.has(k), `${SAMPLES[i].id}: narration for unknown node ${k}`);
    assert(t.count() >= 15 && t.stats().depth === 2, SAMPLES[i].id);
    const m = /(\d+) 个节点、(\d+) 层/.exec(SAMPLES[i].outro);
    if (m) assert(+m[1] === t.count() && +m[2] === t.stats().depth + 1, `${SAMPLES[i].id}: outro says ${m[0]} but tree has ${t.count()} nodes / ${t.stats().depth + 1} levels`);
  }
});

const out = { passed, failed: failures.length, failures };
console.log(JSON.stringify(out));
process.exit(failures.length ? 1 : 0);
