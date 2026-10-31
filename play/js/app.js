/* 页面外壳：三个模式（观看 / 我来画 / 练习）、键盘命令、Markdown ↔ 图实时同步、右栏（大纲 / 统计 / 源）、
 * 本机保存（多文档）、打开 / 下载 / 导出、主题与深色模式、操作说明、大屏模式、退出、手机竖屏（☰ 菜单、
 * 大按钮、全屏面板、键盘上方输入框）、自检（?selftest=1）与截图状态（?shot=…）。
 */
(function () {
  'use strict';
  var CFG = window.APP_CONFIG, CR = window.CREDITS || {}, Tree = Model.Tree;
  var $ = function (id) { return document.getElementById(id); };
  var QS = new URLSearchParams(location.search);
  var ON = { passive: false };

  var S = {
    mode: null, tree: null, hist: new Model.History(CFG.MAX_UNDO), sel: null, docId: null, headingLevels: 2,
    layout: CFG.DEFAULT_LAYOUT, edgeStyle: 'curve', theme: CFG.DEFAULT_THEME, dark: false,
    editing: null, find: { open: false, q: '', matches: [], idx: -1 }, stopped: false, newIds: null,
    watch: { sample: 0, order: [], idx: 0, playing: true, speed: 1, timer: null, full: null },
    practice: { tasks: [], created: 0, edited: 0, dropped: false, collapsed: false, undone: false, redone: false, downloaded: false, active: false },
    textBurst: 0, saveTimer: null, textTimer: null
  };
  var SPEEDS = [{ name: '逐条讲解', ms: 2600 }, { name: '正常', ms: 1400 }, { name: '快速', ms: 600 }, { name: '瞬间', ms: 40 }];
  var SWATCHES = ['#2f8fe8', '#2fb380', '#f0a030', '#e05a7a', '#8a63d2', '#20a8b8', '#d2784a', '#6a8f2e', '#444444'];
  var isTouchP = function () { return document.body.classList.contains('touchp'); };
  var isTouch = function () { return document.body.classList.contains('touch'); };

  /* ================================================================ 渲染与同步 */
  function render(opts) {
    opts = opts || {};
    Canvas.render(S.tree, { mode: S.layout, edgeStyle: S.edgeStyle, theme: S.theme, dark: S.dark, sel: S.sel, findSet: S.find.open && S.find.q ? new Set(S.find.matches) : null, newIds: S.newIds });
    S.newIds = null;
    if (opts.fit) Canvas.fit();
    else if (S.sel && opts.ensure !== false) Canvas.ensureVisible(S.sel);
    updateZoom();
  }
  function changed(opts) {           // 树改了：画图、同步文字、右栏、保存、属性条
    opts = opts || {};
    if (S.sel && !S.tree.get(S.sel)) S.sel = S.tree.root.id;
    render(opts);
    if (!opts.fromText) syncText();
    updateRight();
    updateProps();
    if (S.mode !== 'watch') scheduleSave();
    if (S.practice.active) checkTasks();
  }
  function snapshot() { return { json: S.tree.snapshot(), sel: S.sel }; }
  function commit(fn, opts) {         // 带撤销的改动
    if (S.mode === 'watch') return null;
    var before = snapshot();
    var r = fn();
    if (r === false) return null;
    S.hist.push(before);
    changed(opts);
    return r;
  }
  function restore(state) { S.tree = Tree.fromJSON(state.json, true); S.sel = state.sel && S.tree.get(state.sel) ? state.sel : S.tree.root.id; }
  function undo() { if (S.editing) return; var st = S.hist.undo(snapshot()); if (!st) return toast('没有可撤销的操作'); restore(st); S.practice.undone = true; changed(); }
  function redo() { if (S.editing) return; var st = S.hist.redo(snapshot()); if (!st) return toast('没有可重做的操作'); restore(st); S.practice.redone = true; changed(); }

  function select(id, opts) {
    opts = opts || {};
    if (!S.tree.get(id)) return;
    S.sel = id;
    if (opts.expand) { S.tree.expandTo(id); }
    render({ ensure: true });
    updateOutlineSel();
    updateProps();
    if (!opts.keepCursor) moveTextCursor();
  }

  /* ---- 文字 ↔ 图 ---- */
  function syncText() {
    var ta = $('md-text'), out = Markdown.serialize(S.tree.root, { headingLevels: S.headingLevels });
    S.lineOf = out.lineOf;
    $('md-source').textContent = out.text;
    if (ta.value !== out.text) {
      var focused = document.activeElement === ta;
      ta.value = out.text;
      if (focused || isTouchP()) moveTextCursor();
    }
  }
  function moveTextCursor() {        // 光标跟着选中节点走（只在文本框有焦点或手机全屏面板里时移动）
    var ta = $('md-text');
    if (!S.lineOf || S.sel == null || !(document.activeElement === ta)) return;
    var li = S.lineOf[S.sel]; if (li == null) return;
    var lines = ta.value.split('\n'), pos = 0;
    for (var i = 0; i < li; i++) pos += lines[i].length + 1;
    var end = pos + lines[li].length;
    try { ta.setSelectionRange(end, end); } catch (e) { /* 忽略 */ }
  }
  function applyText(text) {          // 文本框改了：解析 → 搬属性 → 换树（不改写文本框）
    var p = Markdown.parse(text);
    if (p.empty) return;
    var before = snapshot();
    Markdown.merge(S.tree.root, p.root);
    S.tree = new Tree(p.root);
    S.headingLevels = Math.max(1, Math.min(6, p.headingLevels));
    if (!S.textBurst || Date.now() - S.textBurst > 1200) S.hist.push(before);
    S.textBurst = Date.now();
    S.lastSource = 'text';
    changed({ fromText: true, ensure: false });
  }
  function onTextInput() {
    clearTimeout(S.textTimer);
    S.textTimer = setTimeout(function () { applyText($('md-text').value); }, 160);
  }
  function cursorToNode() {           // 文本框里点一行 → 选中那个节点
    var ta = $('md-text'); if (!S.lineOf) return;
    var li = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    for (var id in S.lineOf) if (S.lineOf[id] === li) { if (id !== S.sel) select(id, { keepCursor: true }); return; }
  }

  /* ================================================================ 节点操作 */
  function cur() { return S.tree.get(S.sel) || S.tree.root; }
  function addSibling(before) {
    if (S.mode === 'watch') return;
    var n = commit(function () { var x = S.tree.addSibling(cur().id, '', before); S.newIds = new Set([x.id]); S.sel = x.id; S.practice.created++; return x; });
    if (n) openEdit(n.id);
  }
  function addChild() {
    if (S.mode === 'watch') return;
    var n = commit(function () { var x = S.tree.addChild(cur().id, ''); S.newIds = new Set([x.id]); S.sel = x.id; S.practice.created++; return x; });
    if (n) openEdit(n.id);
  }
  function outdent() { if (!commit(function () { return S.tree.outdent(cur().id) || false; })) toast('已经是第一层'); }
  function indent() { if (!commit(function () { return S.tree.indent(cur().id) || false; })) toast('前面没有同级节点'); }
  function moveUp() { commit(function () { return S.tree.moveUp(cur().id) || false; }); }
  function moveDown() { commit(function () { return S.tree.moveDown(cur().id) || false; }); }
  function toggleCollapse() {
    var n = cur(); if (!n.children.length) return toast('这个节点没有子节点');
    commit(function () { S.tree.toggleCollapse(n.id); if (n.collapsed) S.practice.collapsed = true; return true; });
  }
  function deleteNode() {
    var n = cur(); if (n === S.tree.root) return toast('根节点不能删除（可以改文字）');
    var kids = S.tree.descendantCount(n.id);
    function doIt() {
      commit(function () { var p = S.tree.parentOf(n.id), i = S.tree.indexOf(n.id); S.tree.remove(n.id); S.sel = (p.children[i] || p.children[i - 1] || p).id; return true; });
    }
    if (kids > 0) confirmDlg('删除「' + Markdown.plain(n.text) + '」及其 ' + kids + ' 个子节点？', doIt); else doIt();
  }
  function reparent(src, dst) {
    if (S.mode === 'watch') return;
    var ok = commit(function () { if (!S.tree.move(src, dst)) return false; S.sel = src; S.practice.dropped = true; return true; });
    if (ok) toast('已移到「' + Markdown.plain(S.tree.get(dst).text) + '」下面');
  }
  function setProp(props) { commit(function () { S.tree.setProps(cur().id, props); return true; }); }

  /* ---- 方向键 ---- */
  function navigate(dir) {
    var L = Canvas.layout(); if (!L) return;
    var b = L.byId.get(S.sel) || L.byId.get(S.tree.root.id), n = b.node, p = S.tree.parentOf(n.id);
    var target = null;
    if (dir === 'up' || dir === 'down') {
      if (p) { var i = p.children.indexOf(n), s = p.children[i + (dir === 'up' ? -1 : 1)]; if (s && L.byId.get(s.id)) target = s.id; }
      if (!target) target = nearest(L, b, dir);
    } else {
      var toChild = (dir === 'right' && b.side !== 'L') || (dir === 'left' && b.side === 'L');
      if (b.side === 'C') { var want = dir === 'right' ? 'R' : 'L'; var c = n.children.filter(function (k) { var kb = L.byId.get(k.id); return kb && kb.side === want; })[0]; target = c ? c.id : null; }
      else if (toChild) { if (n.collapsed) { commit(function () { S.tree.toggleCollapse(n.id, false); return true; }); L = Canvas.layout(); } var k = n.children[0]; target = k ? k.id : null; }
      else target = p ? p.id : null;
      if (!target) target = nearest(L, b, dir);
    }
    if (target) select(target);
  }
  function nearest(L, b, dir) {
    var best = null, bd = Infinity;
    L.nodes.forEach(function (o) {
      if (o.id === b.id) return;
      var dx = o.cx - b.cx, dy = o.cy - b.cy, ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
      if (!ok) return;
      var d = dir === 'up' || dir === 'down' ? Math.abs(dy) + Math.abs(dx) * 2.5 : Math.abs(dx) + Math.abs(dy) * 2.5;
      if (d < bd) { bd = d; best = o.id; }
    });
    return best;
  }

  /* ================================================================ 编辑文字 */
  function openEdit(id) {
    if (S.mode === 'watch') return;
    var n = S.tree.get(id); if (!n) return;
    S.sel = id; S.editing = { id: id, orig: n.text };
    render({ ensure: true });
    var box = $('edit-box'), ta = $('edit-input');
    ta.value = n.text;
    box.hidden = false;
    positionEdit();
    ta.focus();
    try { ta.setSelectionRange(0, ta.value.length); } catch (e) { /* 忽略 */ }
    autosize(ta);
  }
  function positionEdit() {
    var box = $('edit-box'); if (box.hidden) return;
    if (isTouchP() || document.body.classList.contains('touchl')) {         // 固定在键盘上方
      var vv = window.visualViewport;
      if (vv) { box.style.top = (vv.offsetTop + vv.height - box.offsetHeight) + 'px'; box.style.bottom = 'auto'; }
      else { box.style.top = ''; box.style.bottom = '0'; }
      return;
    }
    var r = Canvas.nodeScreenRect(S.editing.id); if (!r) return;
    box.style.left = Math.max(4, Math.min(r.x, $('stage').clientWidth - 180)) + 'px';
    box.style.top = Math.max(4, r.y - 2) + 'px';
    box.style.width = Math.max(180, r.w + 24) + 'px';
    box.style.bottom = 'auto';
  }
  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight + 2) + 'px'; positionEdit(); }
  function commitEdit(then) {
    var ed = S.editing; if (!ed) return;
    var ta = $('edit-input'), text = ta.value.replace(/\r?\n/g, ' ').trim();
    S.editing = null; $('edit-box').hidden = true;
    var n = S.tree.get(ed.id);
    if (n && text !== n.text) { commit(function () { S.tree.setText(ed.id, text); S.practice.edited++; return true; }); }
    else if (n && !text && !n.children.length && n !== S.tree.root) { commit(function () { var p = S.tree.parentOf(ed.id); S.tree.remove(ed.id); S.sel = p.id; return true; }); toast('空节点已删除'); }
    else render();
    focusCanvas();
    if (then) then();
  }
  function cancelEdit() {
    var ed = S.editing; if (!ed) return;
    S.editing = null; $('edit-box').hidden = true;
    var n = S.tree.get(ed.id);
    if (n && !ed.orig && !n.text && !n.children.length && n !== S.tree.root) { S.tree.remove(ed.id); var st = S.hist.undo(snapshot()); if (st) restore(st); changed(); }
    else render();
    focusCanvas();
  }
  function focusCanvas() { if (!isTouch()) { try { $('canvas').focus({ preventScroll: true }); } catch (e) { /* 忽略 */ } } }

  /* ================================================================ 查找 */
  function openFind() { S.find.open = true; $('findbar').hidden = false; $('find-input').focus(); $('find-input').select(); runFind(); }
  function closeFind() { S.find = { open: false, q: '', matches: [], idx: -1 }; $('findbar').hidden = true; render(); focusCanvas(); }
  function runFind() {
    var q = $('find-input').value.trim().toLowerCase(); S.find.q = q; S.find.matches = [];
    if (q) S.tree.walk(function (n) { if (Markdown.plain(n.text).toLowerCase().indexOf(q) >= 0 || (n.note && n.note.toLowerCase().indexOf(q) >= 0)) S.find.matches.push(n.id); });
    S.find.idx = S.find.matches.length ? 0 : -1;
    $('find-count').textContent = q ? (S.find.matches.length ? (S.find.idx + 1) + ' / ' + S.find.matches.length : '0 个') : '';
    if (S.find.idx >= 0) select(S.find.matches[0], { expand: true }); else render();
  }
  function findStep(d) {
    if (!S.find.matches.length) return;
    S.find.idx = (S.find.idx + d + S.find.matches.length) % S.find.matches.length;
    $('find-count').textContent = (S.find.idx + 1) + ' / ' + S.find.matches.length;
    select(S.find.matches[S.find.idx], { expand: true });
  }

  /* ================================================================ 键盘 */
  function onKey(e) {
    if (S.stopped) return;
    var t = e.target, tag = t && t.tagName, typing = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || (t && t.isContentEditable);
    var ctrl = e.ctrlKey || e.metaKey, k = e.key;
    if (k === 'Escape') {
      if (S.editing) { e.preventDefault(); cancelEdit(); return; }
      if (S.find.open) { e.preventDefault(); closeFind(); return; }
      var open = document.querySelector('.dlg-mask.show'); if (open) { e.preventDefault(); open.classList.remove('show'); if (open.id === 'dlg-help') closeHelp(); return; }
      if (typing && t.id === 'md-text') { t.blur(); focusCanvas(); }
      return;
    }
    if (typing) {
      if (t.id === 'edit-input') {
        if (k === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
        else if (k === 'Tab') { e.preventDefault(); commitEdit(function () { if (e.shiftKey) outdent(); else addChild(); }); }
        return;
      }
      if (t.id === 'find-input') { if (k === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } return; }
      if (t.id === 'md-text') {
        if (k === 'Tab') { e.preventDefault(); insertAtCursor(t, e.shiftKey ? null : '  '); }
        else if (ctrl && (k === 'm' || k === 'M')) { e.preventDefault(); toggleMd(); }
        return;
      }
      if (t.id === 'prompt-input' && k === 'Enter') { e.preventDefault(); $('prompt-ok').click(); }
      return;
    }
    if (document.querySelector('.dlg-mask.show')) { if (k === 'Enter' && $('dlg-confirm').classList.contains('show')) { e.preventDefault(); $('confirm-yes').click(); } return; }
    if (!ctrl && (k === 'h' || k === 'H')) { e.preventDefault(); openHelp(); return; }
    if (S.mode === 'watch') {
      if (k === ' ') { e.preventDefault(); togglePlay(); }
      else if (k === 'ArrowRight' || k === 'n') { e.preventDefault(); watchStep(); }
      else if (k === 'r') { e.preventDefault(); watchRestart(); }
      return;
    }
    if (ctrl) {
      var low = k.toLowerCase();
      if (low === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (low === 'y' || (low === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 'Enter') { e.preventDefault(); addSibling(true); }
      else if (k === 'ArrowUp') { e.preventDefault(); moveUp(); }
      else if (k === 'ArrowDown') { e.preventDefault(); moveDown(); }
      else if (k === '/' || e.code === 'Slash') { e.preventDefault(); toggleCollapse(); }
      else if (low === 'f') { e.preventDefault(); openFind(); }
      else if (k === '0') { e.preventDefault(); Canvas.fit(); updateZoom(); }
      else if (low === 'm') { e.preventDefault(); toggleMd(); }
      else if (k === '=' || k === '+') { e.preventDefault(); Canvas.zoomBy(1.2); updateZoom(); }
      else if (k === '-') { e.preventDefault(); Canvas.zoomBy(1 / 1.2); updateZoom(); }
      return;
    }
    switch (k) {
      case 'Enter': e.preventDefault(); addSibling(false); break;
      case 'Tab': e.preventDefault(); if (e.shiftKey) outdent(); else addChild(); break;
      case ' ': case 'F2': e.preventDefault(); openEdit(cur().id); break;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteNode(); break;
      case 'ArrowUp': e.preventDefault(); navigate('up'); break;
      case 'ArrowDown': e.preventDefault(); navigate('down'); break;
      case 'ArrowLeft': e.preventDefault(); navigate('left'); break;
      case 'ArrowRight': e.preventDefault(); navigate('right'); break;
      case 'Home': e.preventDefault(); select(S.tree.root.id); break;
      default: return;
    }
  }
  function insertAtCursor(ta, text) {
    var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if (text == null) {                                  // Shift+Tab：去掉行首两个空格
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      if (v.slice(ls, ls + 2) === '  ') { ta.value = v.slice(0, ls) + v.slice(ls + 2); ta.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, en - 2)); onTextInput(); }
      return;
    }
    ta.value = v.slice(0, s) + text + v.slice(en); ta.setSelectionRange(s + text.length, s + text.length); onTextInput();
  }

  /* ================================================================ 右栏：大纲 / 统计 / 源 */
  function updateRight() {
    var box = $('outline'), T = CFG.THEMES[S.theme] || CFG.THEMES[CFG.DEFAULT_THEME];
    while (box.firstChild) box.removeChild(box.firstChild);
    var branchOf = {};
    S.tree.walk(function (n, d, p) {
      if (d === 1) branchOf[n.id] = S.tree.root.children.indexOf(n); else if (d > 1) branchOf[n.id] = branchOf[p.id];
      var row = document.createElement('div'); row.className = 'orow' + (n.id === S.sel ? ' sel' : ''); row.dataset.id = n.id; row.style.paddingLeft = (6 + d * 16) + 'px';
      var tog = document.createElement('span'); tog.className = 'tog'; tog.textContent = n.children.length ? (n.collapsed ? '▸' : '▾') : '·'; tog.dataset.tog = n.id; row.appendChild(tog);
      var dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = n.color || (d === 0 ? T.root : T.branch[(branchOf[n.id] || 0) % T.branch.length]); row.appendChild(dot);
      var txt = document.createElement('span'); txt.textContent = (n.icon ? n.icon + ' ' : '') + Markdown.plain(n.text); row.appendChild(txt);
      if (n.collapsed) { var c = document.createElement('span'); c.className = 'cnt'; c.textContent = '（' + S.tree.descendantCount(n.id) + '）'; row.appendChild(c); }
      box.appendChild(row);
    }, true);
    var st = S.tree.stats();
    $('st-nodes').textContent = st.nodes; $('st-depth').textContent = st.depth + 1; $('st-leaves').textContent = st.leaves; $('st-notes').textContent = st.notes;
    var lv = $('st-levels'); while (lv.firstChild) lv.removeChild(lv.firstChild);
    var max = Math.max.apply(null, st.levels);
    st.levels.forEach(function (c, i) {
      var row = document.createElement('div'); row.className = 'lvl';
      var a = document.createElement('span'); a.textContent = '第 ' + (i + 1) + ' 层'; var bar = document.createElement('span'); bar.className = 'bar'; var fill = document.createElement('i'); fill.style.width = (100 * c / max) + '%'; bar.appendChild(fill);
      var b = document.createElement('b'); b.textContent = c; row.appendChild(a); row.appendChild(bar); row.appendChild(b); lv.appendChild(row);
    });
    $('rtab-hint').textContent = st.nodes + ' 个节点 · ' + (st.depth + 1) + ' 层';
  }
  function updateOutlineSel() { document.querySelectorAll('#outline .orow').forEach(function (r) { r.classList.toggle('sel', r.dataset.id === S.sel); }); }
  function updateProps() {
    var n = cur();
    $('sel-text').textContent = Markdown.plain(n.text) || '（空）';
    document.querySelectorAll('#color-swatches .swatch').forEach(function (b) { b.classList.toggle('on', b.dataset.color === n.color); });
    document.querySelectorAll('#icon-picker .ipick').forEach(function (b) { b.classList.toggle('on', b.dataset.icon === n.icon); });
    document.querySelectorAll('#priority-seg button').forEach(function (b) { b.classList.toggle('on', +b.dataset.p === (n.priority || 0)); });
    $('btn-collapse').textContent = n.collapsed ? '展开 (' + S.tree.descendantCount(n.id) + ')' : '折叠';
    $('btn-collapse').disabled = !n.children.length;
    $('btn-note').textContent = n.note ? '备注 ≡ ✔' : '备注 ≡';
    var mu = $('mob-undo'); if (mu) mu.disabled = !S.hist.canUndo();
  }
  function updateZoom() { $('zoom-badge').textContent = Math.round(Canvas.view.z * 100) + '%'; }

  /* ================================================================ 保存 / 文档 */
  function scheduleSave() { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveNow, 500); }
  function saveNow() {
    if (S.mode === 'watch' || !S.tree) return;
    S.docId = Store.save({ id: S.docId, title: Markdown.plain(S.tree.root.text) || '未命名', json: S.tree.toJSON(), headingLevels: S.headingLevels });
    fillDocSelect();
  }
  function fillDocSelect() {
    var sel = $('doc-select'), list = Store.list();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    list.forEach(function (d) { var o = document.createElement('option'); o.value = d.id; o.textContent = d.title + '（' + fmtTime(d.updated) + '）'; sel.appendChild(o); });
    if (!list.length) { var o = document.createElement('option'); o.value = ''; o.textContent = '（还没有保存的导图）'; sel.appendChild(o); }
    sel.value = S.docId || '';
  }
  function fmtTime(t) { var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function loadDoc(tree, opts) {        // 换一棵树（新建 / 打开 / 载入示例 / 切换文档）
    opts = opts || {};
    S.tree = tree; S.sel = tree.root.id; S.hist.clear(); S.docId = opts.docId || null; S.headingLevels = opts.headingLevels || 2; S.editing = null; $('edit-box').hidden = true;
    if (S.find.open) closeFind();
    changed({ fit: true });
    if (S.mode !== 'watch' && !opts.noSave) saveNow();
  }
  function newDoc(title) { loadDoc(new Tree(Model.makeNode(title || '中心主题'))); toast('新建了一张空白导图：选中根节点，按 Tab 建子级'); }
  function openDocId(id) { var d = Store.load(id); if (!d) return; loadDoc(Tree.fromJSON(d.json), { docId: d.id, headingLevels: d.headingLevels, noSave: true }); }
  function loadSample(i, opts) {
    var smp = SAMPLES[i] || SAMPLES[0], p = Markdown.parse(smp.md);
    loadDoc(new Tree(p.root), { headingLevels: p.headingLevels, noSave: opts && opts.noSave });
  }
  function ensureDoc() {               // 进入「我来画」时：有保存的就开最近一张，否则载入第一个示例
    if (S.docId && S.tree) return;
    var list = Store.list();
    if (list.length) openDocId(list[0].id); else loadSample(0);
  }

  /* ---- 打开 / 下载 / 导出 ---- */
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    S.practice.downloaded = true; if (S.practice.active) checkTasks();
  }
  function fileBase() { return (Markdown.plain(S.tree.root.text) || 'mindmap').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60); }
  function dlMd() { download(fileBase() + '.md', Markdown.serialize(S.tree.root, { headingLevels: S.headingLevels }).text, 'text/markdown;charset=utf-8'); }
  function dlJson() { download(fileBase() + '.json', Formats.toJSON(S.tree), 'application/json;charset=utf-8'); }
  function dlOpml() { download(fileBase() + '.opml', Formats.toOPML(S.tree), 'text/xml;charset=utf-8'); }
  function dlMm() { download(fileBase() + '.mm', Formats.toFreeMind(S.tree), 'text/xml;charset=utf-8'); }
  function dlSvg() { download(fileBase() + '.svg', Canvas.toSVGString(), 'image/svg+xml;charset=utf-8'); }
  function dlPng() {
    Canvas.toCanvas(2).then(function (c) { c.toBlob(function (b) { if (b) download(fileBase() + '.png', b); else toast('导出失败'); }, 'image/png'); })
      .catch(function (e) { toast('导出 PNG 失败：' + e.message); });
  }
  function openFile(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var res = Formats.importAny(String(r.result), file.name);
        loadDoc(res.tree, { headingLevels: res.headingLevels });
        toast('已打开 ' + file.name + '（' + { json: 'JSON', opml: 'OPML', freemind: 'FreeMind', markdown: 'Markdown' }[res.format] + '，' + res.tree.count() + ' 个节点）');
      } catch (e) { toast('打不开：' + e.message); }
    };
    r.readAsText(file, 'utf-8');
  }

  /* ================================================================ 观看模式 */
  function watchLoad(i) {
    S.watch.sample = i;
    var smp = SAMPLES[i], p = Markdown.parse(smp.md), full = new Tree(p.root);
    S.watch.full = full;
    var order = []; var q = [full.root];
    while (q.length) { var n = q.shift(); order.push(n.id); n.children.forEach(function (c) { q.push(c); }); }   // 逐层（BFS）
    S.watch.order = order; S.watch.idx = 0;
    watchShow(true);
  }
  function watchShow(first) {
    var W = S.watch, full = W.full, shown = new Set(W.order.slice(0, W.idx + 1));
    function filt(o) { var c = { text: o.text, id: o.id, note: o.note, color: o.color, icon: o.icon, priority: o.priority }; if (o.children) { var ks = o.children.filter(function (k) { return shown.has(k.id); }).map(filt); if (ks.length) c.children = ks; } return c; }
    S.tree = Tree.fromJSON(filt(full.snapshot()), true);
    var id = W.order[W.idx], n = full.get(id), smp = SAMPLES[W.sample];
    S.sel = id; S.newIds = first ? null : new Set([id]);
    render({ fit: true });
    updateRight();
    var cap = W.idx === 0 ? smp.intro : (smp.narration[n.text] || defaultCaption(full, n));
    $('cap-title').textContent = W.idx === 0 ? smp.title : '「' + Markdown.plain(n.text) + '」';
    $('cap-text').textContent = cap + (W.idx === W.order.length - 1 ? ' ' + smp.outro : '');
    $('pl-count').textContent = (W.idx + 1) + ' / ' + W.order.length;
    $('pl-bar').style.width = (100 * (W.idx + 1) / W.order.length) + '%';
    document.title = CFG.APP_NAME_ZH;
  }
  function defaultCaption(full, n) {
    var p = full.parentOf(n.id), k = n.children.length;
    if (full.depthOf(n.id) === 1) return '第一层分支「' + Markdown.plain(n.text) + '」' + (k ? '，下面有 ' + k + ' 个子节点。' : '。');
    return '「' + Markdown.plain(p.text) + '」→「' + Markdown.plain(n.text) + '」' + (n.note ? '（有备注：' + n.note + '）' : '。');
  }
  function watchStep() {
    var W = S.watch;
    if (W.idx >= W.order.length - 1) { W.playing = false; setPlayLabel(); return false; }
    W.idx++; watchShow(); return true;
  }
  function watchTick() {
    clearTimeout(S.watch.timer);
    if (S.mode !== 'watch' || !S.watch.playing || S.stopped) return;
    S.watch.timer = setTimeout(function () { if (watchStep()) watchTick(); else setPlayLabel(); }, SPEEDS[S.watch.speed].ms);
  }
  function togglePlay() {
    var W = S.watch;
    if (W.idx >= W.order.length - 1 && !W.playing) { watchRestart(); return; }
    W.playing = !W.playing; setPlayLabel(); if (W.playing) watchTick(); else clearTimeout(W.timer);
  }
  function watchRestart() { S.watch.idx = 0; S.watch.playing = true; watchShow(true); setPlayLabel(); watchTick(); }
  function setPlayLabel() { var W = S.watch; $('pl-play').textContent = W.playing ? '⏸ 暂停' : (W.idx >= W.order.length - 1 ? '⟲ 再看一遍' : '▶ 播放'); }
  function setSpeed(i) { S.watch.speed = i; document.querySelectorAll('#speed-presets button').forEach(function (b, j) { b.classList.toggle('on', j === i); }); if (S.watch.playing) watchTick(); }

  /* ================================================================ 练习 */
  var TASKS = [
    { id: 'create', text: '建 10 个节点：Enter 同级、Tab 子级（手机：底部「同级」「子级」）', test: function () { return S.practice.created >= 10; } },
    { id: 'edit', text: '改 3 个节点的文字：空格 / F2 / 双击（手机：「编辑」）', test: function () { return S.practice.edited >= 3; } },
    { id: 'md', text: '把一段 Markdown 变成图：在 Markdown 框里（手机：☰ → 看 Markdown）加上三行「- 苹果」「- 香蕉」「- 橙子」', test: function () { var s = new Set(); S.tree.walk(function (n) { s.add(Markdown.plain(n.text)); }); return s.has('苹果') && s.has('香蕉') && s.has('橙子'); } },
    { id: 'drag', text: '把一个分支拖到另一个节点上（换父级，目标会高亮）', test: function () { return S.practice.dropped; } },
    { id: 'collapse', text: '折叠一个有子节点的节点（Ctrl+/ 或「折叠」按钮；折叠后显示子节点数）', test: function () { return S.practice.collapsed; } },
    { id: 'undo', text: '撤销一次再重做一次（Ctrl+Z / Ctrl+Y）', test: function () { return S.practice.undone && S.practice.redone; } },
    { id: 'download', text: '下载 .md 或 .json（工具条「下载」；手机在 ☰ 里）', test: function () { return S.practice.downloaded; } }
  ];
  function practiceStart() {
    S.practice = { tasks: TASKS.map(function (t) { return { id: t.id, done: false }; }), created: 0, edited: 0, dropped: false, collapsed: false, undone: false, redone: false, downloaded: false, active: true };
    var root = Model.makeNode('我的练习'); root.children.push(Model.makeNode('先选中我，按 Enter')); root.children.push(Model.makeNode('再按 Tab 建子级'));
    loadDoc(new Tree(root));
    renderTasks();
  }
  function renderTasks() {
    var ol = $('tasks'); while (ol.firstChild) ol.removeChild(ol.firstChild);
    var done = 0, curSet = false;
    S.practice.tasks.forEach(function (t, i) {
      var li = document.createElement('li'); li.textContent = TASKS[i].text; if (t.done) { li.className = 'done'; done++; } else if (!curSet) { li.className = 'cur'; curSet = true; }
      ol.appendChild(li);
    });
    $('task-progress').textContent = done + ' / ' + S.practice.tasks.length + (done === S.practice.tasks.length ? ' 全部完成！' : '');
  }
  function checkTasks() {
    var changedAny = false;
    S.practice.tasks.forEach(function (t, i) { if (!t.done && TASKS[i].test()) { t.done = true; changedAny = true; toast('完成：' + TASKS[i].text.split('：')[0]); } });
    if (changedAny) renderTasks();
  }

  /* ================================================================ 模式切换 */
  function setMode(m) {
    if (S.mode === m) return;
    if (S.editing) cancelEdit();
    clearTimeout(S.watch.timer);
    if (S.mode === 'watch') { S.tree = null; }
    else if (S.tree) { saveNow(); S.saved = { tree: S.tree, docId: S.docId, hl: S.headingLevels, sel: S.sel }; }
    S.mode = m;
    document.body.classList.remove('m-watch', 'm-draw', 'm-practice');
    document.body.classList.add('m-' + m);
    document.querySelectorAll('#modes button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', b.dataset.mode === m); });
    if (Sheets) Sheets.close();
    S.practice.active = m === 'practice';
    if (m === 'watch') { S.hist.clear(); S.docId = null; watchLoad(S.watch.sample); S.watch.playing = true; setPlayLabel(); watchTick(); }
    else if (m === 'practice') { practiceStart(); }
    else {
      if (S.saved && S.saved.tree && S.lastMode !== 'practice') { S.tree = S.saved.tree; S.docId = S.saved.docId; S.headingLevels = S.saved.hl; S.sel = S.saved.sel; S.hist.clear(); changed({ fit: true }); }
      else { S.tree = null; S.docId = null; ensureDoc(); }
    }
    S.lastMode = m;
    fillDocSelect();
    focusCanvas();
  }

  /* ================================================================ 说明 / 退出 / 页脚 */
  function openHelp() { $('dlg-help').classList.add('show'); if (S.mode === 'watch' && S.watch.playing) { S.watch.playing = false; S.helpPaused = true; clearTimeout(S.watch.timer); setPlayLabel(); } }
  function closeHelp() {
    $('dlg-help').classList.remove('show');
    if (S.helpPaused) { S.helpPaused = false; S.watch.playing = true; setPlayLabel(); watchTick(); }
    Store.flag(CFG.HELP_KEY, true);
    focusCanvas();
  }
  function exitApp() {
    if (S.stopped) return;
    S.stopped = true;
    clearTimeout(S.watch.timer); clearTimeout(S.saveTimer); clearTimeout(S.textTimer);
    if (S.mode !== 'watch' && S.tree) saveNow();
    Canvas.destroy(); MobileUI.destroy();
    document.removeEventListener('keydown', onKey);
    try { window.close(); } catch (e) { /* 浏览器不允许 */ }
    setTimeout(function () {
      var L = $('layout'); if (L) L.remove();
      ['menu', 'menu-btn', 'sheet-close', 'rotate-hint', 'edit-box', 'findbar', 'mob-actions'].forEach(function (id) { var n = $(id); if (n) n.remove(); });
      $('ended').classList.add('show'); document.title = '已停止运行';
    }, 120);
  }
  function fillFooter() {   // 页脚只放纯文字署名 + 许可证（含作者有意公开的联系邮箱）
    var parts = [];
    if (CR.AUTHOR) parts.push('作者 ' + CR.AUTHOR + (CR.AUTHOR_EMAIL ? '（' + CR.AUTHOR_EMAIL + '）' : ''));
    if (CR.UNIVERSITY_EN) parts.push(CR.UNIVERSITY_EN);
    if (CR.UNIVERSITY_KO) parts.push(CR.UNIVERSITY_KO);
    parts.push('代码 MIT · 文档 CC BY 4.0');
    if (CR.SERIES_NAME_ZH) parts.push(CR.SERIES_NAME_ZH + (CR.SERIES_NAME_EN ? ' / ' + CR.SERIES_NAME_EN : '') + ' 系列');
    $('footer').textContent = parts.join(' · ');
  }
  var toastTimer = null;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function confirmDlg(text, yes) {
    $('confirm-text').textContent = text; $('dlg-confirm').classList.add('show');
    $('confirm-yes').onclick = function () { $('dlg-confirm').classList.remove('show'); yes(); focusCanvas(); };
    $('confirm-no').onclick = function () { $('dlg-confirm').classList.remove('show'); focusCanvas(); };
  }
  function promptDlg(title, value, ok) {
    $('prompt-title').textContent = title; $('prompt-input').value = value; $('dlg-prompt').classList.add('show'); $('prompt-input').focus(); $('prompt-input').select();
    $('prompt-ok').onclick = function () { $('dlg-prompt').classList.remove('show'); ok($('prompt-input').value); focusCanvas(); };
    $('prompt-cancel').onclick = function () { $('dlg-prompt').classList.remove('show'); focusCanvas(); };
  }
  function toggleMd() { document.body.classList.toggle('md-hidden'); Store.setPrefs({ mdHidden: document.body.classList.contains('md-hidden') }); $('btn-md-toggle').textContent = document.body.classList.contains('md-hidden') ? 'Markdown ◨' : 'Markdown ◧'; }

  /* ================================================================ 手机竖屏 */
  var Menu = null, Sheets = null;
  function mobileInit() {
    MobileUI.detect({ onChange: function () { if (!isTouchP() && Sheets) Sheets.close(); render(); positionEdit(); } });
    Menu = MobileUI.menu($('menu-btn'), $('menu'));
    Sheets = MobileUI.sheets($('sheet-close'), function (name) { if (name === 'md') { $('md-text').focus(); } else if (!name) { render(); focusCanvas(); } });
    MobileUI.rotateHint($('rotate-hint'), $('rot-ok'));
    MobileUI.pressFeedback(document.body, '#mob-actions button, #menu button, .tabs button');
    MobileUI.guard($('stage'), { onReset: function () { Canvas.cancel(); } });
    $('menu-md').addEventListener('click', function () { Sheets.open('md'); });
    $('menu-right').addEventListener('click', function () { Sheets.open('right'); });
    $('menu-new').addEventListener('click', function () { if (S.mode === 'watch') setMode('draw'); newDoc(); });
    $('menu-open').addEventListener('click', function () { if (S.mode === 'watch') setMode('draw'); $('file-open').click(); });
    $('menu-dl-md').addEventListener('click', dlMd);
    $('menu-dl-json').addEventListener('click', dlJson);
    $('menu-png').addEventListener('click', dlPng);
    $('menu-fit').addEventListener('click', function () { Canvas.fit(); updateZoom(); });
    $('menu-help').addEventListener('click', openHelp);
    $('menu-exit').addEventListener('click', exitApp);
    $('mob-sibling').addEventListener('click', function () { addSibling(false); });
    $('mob-child').addEventListener('click', addChild);
    $('mob-outdent').addEventListener('click', outdent);
    $('mob-edit').addEventListener('click', function () { openEdit(cur().id); });
    $('mob-delete').addEventListener('click', deleteNode);
    $('mob-undo').addEventListener('click', undo);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', positionEdit); window.visualViewport.addEventListener('scroll', positionEdit); }
  }

  /* ================================================================ 初始化 */
  function buildControls() {
    var ls = $('layout-select'); for (var k in CFG.LAYOUTS) { var o = document.createElement('option'); o.value = k; o.textContent = CFG.LAYOUTS[k]; ls.appendChild(o); }
    var ts = $('theme-select'); for (var t in CFG.THEMES) { var o2 = document.createElement('option'); o2.value = t; o2.textContent = CFG.THEMES[t].name; ts.appendChild(o2); }
    var ss = $('sample-select'); SAMPLES.forEach(function (s, i) { var o3 = document.createElement('option'); o3.value = i; o3.textContent = s.title; ss.appendChild(o3); });
    SPEEDS.forEach(function (sp, i) { var b = document.createElement('button'); b.textContent = sp.name; b.addEventListener('click', function () { setSpeed(i); }); $('speed-presets').appendChild(b); });
    SWATCHES.forEach(function (c) { var b = document.createElement('button'); b.className = 'swatch'; b.style.background = c; b.dataset.color = c; b.title = c; b.addEventListener('click', function () { setProp({ color: c }); }); $('color-swatches').appendChild(b); });
    CFG.ICONS.forEach(function (ic) { var b = document.createElement('button'); b.className = 'ipick'; b.textContent = ic; b.dataset.icon = ic; b.addEventListener('click', function () { setProp({ icon: ic }); }); $('icon-picker').appendChild(b); });
    [0, 1, 2, 3].forEach(function (p) { var b = document.createElement('button'); b.textContent = p ? String(p) : '无'; b.dataset.p = p; b.addEventListener('click', function () { setProp({ priority: p }); }); $('priority-seg').appendChild(b); });
  }
  function bind() {
    document.addEventListener('keydown', onKey);
    document.querySelectorAll('#modes button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    $('bigscreen').addEventListener('change', function () { document.body.classList.toggle('bigscreen', $('bigscreen').checked); setTimeout(function () { Canvas.fit(); updateZoom(); }, 50); });
    $('help-btn').addEventListener('click', openHelp); $('help-close').addEventListener('click', closeHelp); $('exit-btn').addEventListener('click', exitApp);
    $('layout-select').addEventListener('change', function () { S.layout = $('layout-select').value; Store.setPrefs({ layout: S.layout }); render({ fit: true }); });
    $('edge-select').addEventListener('change', function () { S.edgeStyle = $('edge-select').value; Store.setPrefs({ edge: S.edgeStyle }); render(); });
    $('theme-select').addEventListener('change', function () { S.theme = $('theme-select').value; Store.setPrefs({ theme: S.theme }); render(); updateRight(); });
    $('btn-fit').addEventListener('click', function () { Canvas.fit(); updateZoom(); });
    $('btn-md-toggle').addEventListener('click', toggleMd); $('md-collapse').addEventListener('click', toggleMd);
    $('sample-select').addEventListener('change', function () { var i = +$('sample-select').value; if (S.mode === 'watch') { S.watch.sample = i; watchRestart(); } });
    $('btn-load-sample').addEventListener('click', function () { var i = +$('sample-select').value; if (S.mode === 'watch') setMode('draw'); loadSample(i); toast('已载入示例「' + SAMPLES[i].title + '」，另存为一张新导图'); });
    $('doc-select').addEventListener('change', function () { if ($('doc-select').value) { saveNow(); openDocId($('doc-select').value); } });
    $('doc-new').addEventListener('click', function () { newDoc(); });
    $('doc-rename').addEventListener('click', function () { promptDlg('导图标题（就是根节点文字）', Markdown.plain(S.tree.root.text), function (v) { if (v.trim()) commit(function () { S.tree.setText(S.tree.root.id, v.trim()); return true; }); }); });
    $('doc-delete').addEventListener('click', function () { confirmDlg('从本机删除「' + Markdown.plain(S.tree.root.text) + '」？（已下载的文件不受影响）', function () { if (S.docId) Store.remove(S.docId); S.docId = null; var l = Store.list(); if (l.length) openDocId(l[0].id); else newDoc(); }); });
    $('btn-open').addEventListener('click', function () { $('file-open').click(); });
    $('file-open').addEventListener('change', function () { var f = $('file-open').files[0]; if (f) openFile(f); $('file-open').value = ''; });
    var dd = $('btn-download').parentNode;
    $('btn-download').addEventListener('click', function (e) { e.stopPropagation(); dd.classList.toggle('open'); });
    document.addEventListener('click', function (e) { if (!dd.contains(e.target)) dd.classList.remove('open'); });
    dd.querySelector('.ddmenu').addEventListener('click', function () { dd.classList.remove('open'); });
    $('dl-md').addEventListener('click', dlMd); $('dl-json').addEventListener('click', dlJson); $('dl-opml').addEventListener('click', dlOpml); $('dl-mm').addEventListener('click', dlMm); $('dl-png').addEventListener('click', dlPng); $('dl-svg').addEventListener('click', dlSvg);
    $('md-text').addEventListener('input', onTextInput);
    $('md-text').addEventListener('click', cursorToNode);
    $('md-text').addEventListener('keyup', function (e) { if (/^Arrow/.test(e.key)) cursorToNode(); });
    $('edit-input').addEventListener('input', function () { autosize($('edit-input')); });
    $('edit-input').addEventListener('blur', function () { setTimeout(function () { if (S.editing && document.activeElement !== $('edit-input') && !isTouch()) commitEdit(); }, 80); });
    $('edit-ok').addEventListener('click', function () { commitEdit(); }); $('edit-cancel').addEventListener('click', cancelEdit);
    $('find-input').addEventListener('input', runFind); $('find-next').addEventListener('click', function () { findStep(1); }); $('find-prev').addEventListener('click', function () { findStep(-1); }); $('find-close').addEventListener('click', closeFind);
    $('outline').addEventListener('click', function (e) {
      var tog = e.target.closest('.tog'), row = e.target.closest('.orow'); if (!row) return;
      if (tog && S.tree.get(tog.dataset.tog).children.length) { S.sel = tog.dataset.tog; toggleCollapse(); return; }
      select(row.dataset.id); if (isTouchP() && Sheets) Sheets.close();
    });
    document.querySelectorAll('.tabs button[data-rtab]').forEach(function (b) { b.addEventListener('click', function () {
      document.querySelectorAll('.tabs button[data-rtab]').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.rpane').forEach(function (p) { p.classList.toggle('on', p.id === 'rpane-' + b.dataset.rtab); });
    }); });
    $('pl-play').addEventListener('click', togglePlay); $('pl-step').addEventListener('click', function () { S.watch.playing = false; clearTimeout(S.watch.timer); setPlayLabel(); watchStep(); }); $('pl-restart').addEventListener('click', watchRestart);
    $('color-clear').addEventListener('click', function () { setProp({ color: null }); }); $('icon-clear').addEventListener('click', function () { setProp({ icon: '' }); });
    $('btn-collapse').addEventListener('click', toggleCollapse);
    $('btn-note').addEventListener('click', function () {
      var n = cur(); $('note-for').textContent = '「' + Markdown.plain(n.text) + '」'; $('note-text').value = n.note; $('dlg-note').classList.add('show'); $('note-text').focus();
      $('note-ok').onclick = function () { $('dlg-note').classList.remove('show'); var v = $('note-text').value.trim(); if (v !== n.note) commit(function () { S.tree.setNote(n.id, v); return true; }); focusCanvas(); };
      $('note-cancel').onclick = function () { $('dlg-note').classList.remove('show'); focusCanvas(); };
    });
    $('task-reset').addEventListener('click', practiceStart);
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    S.dark = mq.matches;
    (mq.addEventListener ? mq.addEventListener('change', onDark) : mq.addListener(onDark));
    function onDark(e) { S.dark = e.matches; render(); }
    window.addEventListener('resize', function () { render({ ensure: false }); positionEdit(); });
    Canvas.init($('canvas'), {
      onSelect: function (id) { if (S.mode === 'watch') return; if (S.editing && S.editing.id !== id) commitEdit(); select(id); focusCanvas(); },
      onEdit: function (id) { if (S.mode !== 'watch') openEdit(id); },
      onDrop: reparent,
      onToggle: function (id) { if (S.mode === 'watch') return; S.sel = id; toggleCollapse(); },
      onBackground: function () { if (S.editing) commitEdit(); else if (S.find.open) closeFind(); focusCanvas(); },
      onViewChange: updateZoom
    });
    mobileInit();
  }
  function applyPrefs() {
    var p = Store.prefs();
    if (p.layout && CFG.LAYOUTS[p.layout]) S.layout = p.layout; if (p.edge) S.edgeStyle = p.edge; if (p.theme && CFG.THEMES[p.theme]) S.theme = p.theme;
    $('layout-select').value = S.layout; $('edge-select').value = S.edgeStyle; $('theme-select').value = S.theme;
    if (p.mdHidden) { document.body.classList.add('md-hidden'); $('btn-md-toggle').textContent = 'Markdown ◨'; }
    setSpeed(1);
  }

  /* ================================================================ 自检（?selftest=1）与截图状态（?shot=…） */
  function layoutCheck() {
    var r = function (id) { return $(id).getBoundingClientRect(); };
    var L = r('leftcol'), R = r('rightcol'), F = r('footer'), st = r('stage');
    return { innerWidth: innerWidth, innerHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth, hOverflow: document.documentElement.scrollWidth - innerWidth,
             leftBottom: Math.round(L.bottom), rightBottom: Math.round(R.bottom), footerBottom: Math.round(F.bottom), stageW: Math.round(st.width), stageH: Math.round(st.height),
             ok: document.documentElement.scrollWidth <= innerWidth && F.bottom <= innerHeight + 1 && L.width > 300 && R.width > 200 && st.height > 200 };
  }
  function key(k, opts) { var e = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})); ($('edit-box').hidden ? $('canvas') : $('edit-input')).dispatchEvent(e); }
  function typeText(s) { $('edit-input').value = s; }
  function selftest() {
    var out = { ok: true, errors: [], steps: {} }, t0 = Date.now();
    function step(name, fn) { try { out.steps[name] = fn(); } catch (e) { out.ok = false; out.errors.push(name + ': ' + (e && e.stack || e)); } }
    $('dlg-help').classList.remove('show');
    step('layouts', function () {
      var res = {};
      SAMPLES.forEach(function (s, i) {
        var t = new Tree(Markdown.parse(s.md).root);
        ['mindmap', 'tree', 'outline'].forEach(function (m) {
          var L = Layout.compute(t, { mode: m, size: function (n, d) { return Layout.nodeSize(n, d, Canvas.measure); } });
          var ov = Layout.overlaps(L);
          res[s.id + '/' + m] = { nodes: L.nodes.length, overlaps: ov.length, bbox: { w: Math.round(L.bbox.w), h: Math.round(L.bbox.h) } };
          if (ov.length || L.nodes.length !== t.count()) throw new Error(s.id + '/' + m + ' overlaps=' + ov.length);
        });
      });
      return res;
    });
    step('keyboard_build', function () {
      setMode('draw'); newDoc('自检');
      var n0 = S.tree.count();
      for (var i = 0; i < 5; i++) { key('Tab'); typeText('子 ' + i); key('Enter'); }                 // Tab 建子级 → 编辑中 Enter 确认
      for (var j = 0; j < 5; j++) { key('Enter'); typeText('同级 ' + j); key('Enter'); }           // Enter 建同级
      var n1 = S.tree.count();
      var depthBefore = S.tree.depthOf(S.sel);
      key('Tab', { shiftKey: true });                                                             // Shift+Tab 升级
      var depthAfter = S.tree.depthOf(S.sel);
      key('ArrowUp'); key('ArrowDown'); key('ArrowLeft'); key('Home');
      var atRoot = S.sel === S.tree.root.id;
      if (n1 - n0 !== 10 || !atRoot || depthAfter !== depthBefore - 1) throw new Error('built ' + (n1 - n0) + ' nodes, atRoot=' + atRoot + ' depth ' + depthBefore + '->' + depthAfter);
      return { before: n0, after: n1, built: n1 - n0, depthBeforeOutdent: depthBefore, depthAfterOutdent: depthAfter, texts: S.tree.visibleList().map(function (n) { return n.text; }).slice(0, 12) };
    });
    step('undo_redo', function () {
      var c = S.tree.count();
      key('Tab'); typeText('临时'); key('Enter');                                                 // 两次改动：建节点、改文字
      var a = S.tree.count();
      key('z', { ctrlKey: true }); key('z', { ctrlKey: true }); var u = S.tree.count();
      key('y', { ctrlKey: true }); key('y', { ctrlKey: true }); var r = S.tree.count();
      var txt = S.tree.get(S.sel) && S.tree.get(S.sel).text;
      if (!(a === c + 1 && u === c && r === a && txt === '临时')) throw new Error('undo/redo counts ' + [c, a, u, r, txt].join(','));
      return { before: c, afterAdd: a, afterUndo: u, afterRedo: r };
    });
    step('markdown_sync', function () {
      var ta = $('md-text'), text = '# 同步测试\n## 分支 A\n- 苹果\n- 香蕉\n## 分支 B\n<!-- 备注 B -->\n- 橙子\n';
      ta.value = text; applyText(text);
      var json = S.tree.toJSON(), ok = json.text === '同步测试' && json.children.length === 2 && json.children[1].note === '备注 B' && json.children[0].children[1].text === '香蕉';
      if (!ok) throw new Error(JSON.stringify(json));
      S.sel = S.tree.root.children[0].children[0].id; key('Enter'); typeText('梨'); key('Enter');
      var back = ta.value.indexOf('- 梨') > 0 && ta.value.indexOf('- 苹果\n- 梨\n- 香蕉') > 0;
      if (!back) throw new Error('textarea not updated: ' + ta.value);
      return { textToTree: ok, treeToText: back, text: ta.value };
    });
    step('drag_reparent', function () {
      var a = S.tree.root.children[0], b = S.tree.root.children[1];
      reparent(a.id, b.id);
      if (S.tree.parentOf(a.id) !== b) throw new Error('not reparented');
      var rejected = S.tree.move(b.id, a.id) === null;
      if (!rejected) throw new Error('moved under descendant');
      return { reparented: true, cycleRejected: rejected };
    });
    step('collapse_find', function () {
      S.sel = S.tree.root.children[0].id; key('/', { ctrlKey: true });
      var cnt = Canvas.layout().byId.get(S.sel).collapsedCount;
      key('/', { ctrlKey: true });
      openFind(); $('find-input').value = '香蕉'; runFind(); var m = S.find.matches.length; closeFind();
      if (cnt < 1 || m !== 1) throw new Error('collapsedCount=' + cnt + ' matches=' + m);
      return { collapsedCount: cnt, findMatches: m };
    });
    step('formats', function () {
      var t = S.tree, j = Formats.fromJSON(Formats.toJSON(t)).toJSON(), o = Formats.fromOPML(Formats.toOPML(t)).toJSON(), f = Formats.fromFreeMind(Formats.toFreeMind(t)).toJSON();
      var same = JSON.stringify(j) === JSON.stringify(t.toJSON()) && JSON.stringify(o) === JSON.stringify(t.toJSON()) && JSON.stringify(f) === JSON.stringify(t.toJSON());
      if (!same) throw new Error('round trip differs');
      return { json: true, opml: true, freemind: true, nodes: t.count() };
    });
    step('modes_and_layout', function () {
      var res = {};
      ['watch', 'practice', 'draw'].forEach(function (m) { setMode(m); res[m] = layoutCheck(); if (!res[m].ok) throw new Error(m + ' ' + JSON.stringify(res[m])); });
      setMode('watch'); S.watch.playing = false; clearTimeout(S.watch.timer); while (watchStep()) { /* 展开到底 */ }
      res.watchFinal = { nodes: S.tree.count(), steps: S.watch.order.length };
      if (res.watchFinal.nodes !== S.watch.full.count()) throw new Error('watch did not reveal all nodes');
      $('bigscreen').checked = true; $('bigscreen').dispatchEvent(new Event('change')); res.bigscreen = layoutCheck(); $('bigscreen').checked = false; $('bigscreen').dispatchEvent(new Event('change'));
      openHelp(); res.help = $('dlg-help').classList.contains('show'); closeHelp();
      return res;
    });
    var finish = function (png) {
      out.steps.png_export = png;
      out.ms = Date.now() - t0; out.layouts = out.steps.layouts;
      $('selftest').textContent = JSON.stringify(out);
      document.title = out.ok ? 'SELFTEST PASS' : 'SELFTEST FAIL';
    };
    setMode('draw'); loadSample(0, { noSave: true });
    Canvas.toCanvas(1).then(function (c) {
      var ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data, colored = 0, total = c.width * c.height;
      for (var i = 0; i < d.length; i += 4) { if (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i] - d[i + 2]) > 20) colored++; }
      var ok = colored > 2000;
      if (!ok) { out.ok = false; out.errors.push('png export has ' + colored + ' coloured pixels'); }
      finish({ width: c.width, height: c.height, coloredPixels: colored, totalPixels: total, ok: ok });
    }).catch(function (e) { out.ok = false; out.errors.push('png: ' + e.message); finish({ ok: false }); });
  }
  function shotMode(what) {
    var steps = +(QS.get('steps') || 0);
    if (what === 'watch') { setMode('watch'); S.watch.playing = false; clearTimeout(S.watch.timer); for (var i = 0; i < steps; i++) watchStep(); }
    else if (what === 'practice') { setMode('practice'); S.practice.created = 10; S.practice.edited = 3; checkTasks(); }
    else { setMode('draw'); loadSample(QS.get('sample') ? +QS.get('sample') : 1, { noSave: true }); if (QS.get('layout')) { S.layout = QS.get('layout'); $('layout-select').value = S.layout; render({ fit: true }); } select(S.tree.root.children[1].id); }
    setTimeout(function () { Canvas.fit(); updateZoom(); document.body.dataset.shot = 'ready'; }, 250);
  }

  function init() {
    $('app-tagline').textContent = CFG.TAGLINE;
    document.title = CFG.APP_NAME_ZH;
    fillFooter(); buildControls(); bind(); applyPrefs(); fillDocSelect();
    if (QS.has('selftest')) { setMode('watch'); return selftest(); }
    if (QS.has('shot')) { if (!QS.has('nohelp')) openHelp(); return shotMode(QS.get('shot')); }
    setMode('watch');
    if (!Store.flag(CFG.HELP_KEY) && !QS.has('nohelp')) openHelp();
  }
  window.MindApp = { state: S, setMode: setMode, select: select, addSibling: addSibling, addChild: addChild, reparent: reparent, applyText: applyText, loadSample: loadSample, newDoc: newDoc,
                     undo: undo, redo: redo, commitEdit: commitEdit, openEdit: openEdit, watchStep: watchStep, exportCanvas: function (s) { return Canvas.toCanvas(s); }, tree: function () { return S.tree; } };
  init();
})();
