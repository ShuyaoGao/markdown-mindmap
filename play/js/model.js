/* 树模型（无 DOM，浏览器与 Node 测试共用）。
 *
 *   节点：{ id, text, children[], note, collapsed, color, icon, priority }
 *   Model.Tree            增删改移、折叠、统计；toJSON() 导出 {text, children, note, collapsed, color, icon, priority}
 *                         （默认值省略，不含 id）；Tree.fromJSON(obj, keepIds) 反向。
 *   Model.History         撤销 / 重做：每次改动前存一份带 id 的快照（上限 APP_CONFIG.MAX_UNDO）。
 */
(function (root) {
  'use strict';
  var seq = 0;
  function uid() { seq += 1; return 'n' + seq; }

  function makeNode(text, extra) {
    var n = { id: uid(), text: text == null ? '' : String(text), children: [], note: '', collapsed: false, color: null, icon: '', priority: 0 };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && k !== 'children') n[k] = extra[k];
    return n;
  }

  function Tree(rootNode) {
    this.root = rootNode || makeNode('中心主题');
    this.reindex();
  }

  Tree.prototype.reindex = function () {
    var byId = new Map(), parent = new Map();
    (function walk(n, p) {
      byId.set(n.id, n); parent.set(n.id, p);
      for (var i = 0; i < n.children.length; i++) walk(n.children[i], n);
    })(this.root, null);
    this.byId = byId; this.parentMap = parent;
  };
  Tree.prototype.get = function (id) { return this.byId.get(id) || null; };
  Tree.prototype.parentOf = function (id) { return this.parentMap.get(id) || null; };
  Tree.prototype.depthOf = function (id) { var d = 0, p = this.parentOf(id); while (p) { d++; p = this.parentOf(p.id); } return d; };
  Tree.prototype.indexOf = function (id) { var p = this.parentOf(id); return p ? p.children.indexOf(this.get(id)) : -1; };
  Tree.prototype.isAncestor = function (aId, bId) {   // a 是否是 b 的祖先（含自身）
    var n = this.get(bId);
    while (n) { if (n.id === aId) return true; n = this.parentOf(n.id); }
    return false;
  };
  Tree.prototype.pathOf = function (id) { var out = [], n = this.get(id); while (n) { out.unshift(n); n = this.parentOf(n.id); } return out; };

  /* 遍历：fn(node, depth, parent)；visibleOnly 时不进入折叠节点的子树 */
  Tree.prototype.walk = function (fn, visibleOnly) {
    (function w(n, d, p) {
      fn(n, d, p);
      if (visibleOnly && n.collapsed) return;
      for (var i = 0; i < n.children.length; i++) w(n.children[i], d + 1, n);
    })(this.root, 0, null);
  };
  Tree.prototype.visibleList = function () { var out = []; this.walk(function (n) { out.push(n); }, true); return out; };
  Tree.prototype.count = function () { var c = 0; this.walk(function () { c++; }); return c; };
  Tree.prototype.descendantCount = function (id) { var c = -1; (function w(n) { c++; for (var i = 0; i < n.children.length; i++) w(n.children[i]); })(this.get(id)); return c; };
  Tree.prototype.stats = function () {
    var levels = [], maxDepth = 0, leaves = 0, notes = 0;
    this.walk(function (n, d) { levels[d] = (levels[d] || 0) + 1; if (d > maxDepth) maxDepth = d; if (!n.children.length) leaves++; if (n.note) notes++; });
    return { nodes: levels.reduce(function (a, b) { return a + b; }, 0), depth: maxDepth, levels: levels, leaves: leaves, notes: notes };
  };

  /* ---- 增删改移（全部返回受影响的节点，失败返回 null） ---- */
  Tree.prototype.addChild = function (parentId, text, index) {
    var p = this.get(parentId); if (!p) return null;
    var n = makeNode(text);
    if (index == null || index < 0 || index > p.children.length) p.children.push(n); else p.children.splice(index, 0, n);
    p.collapsed = false;
    this.byId.set(n.id, n); this.parentMap.set(n.id, p);
    return n;
  };
  Tree.prototype.addSibling = function (id, text, before) {
    var p = this.parentOf(id);
    if (!p) return this.addChild(id, text);          // 根节点没有同级：建子节点
    var i = p.children.indexOf(this.get(id));
    return this.addChild(p.id, text, before ? i : i + 1);
  };
  Tree.prototype.remove = function (id) {
    var p = this.parentOf(id); if (!p) return null;
    var n = this.get(id), i = p.children.indexOf(n);
    p.children.splice(i, 1);
    this.reindex();
    return n;
  };
  Tree.prototype.setText = function (id, text) { var n = this.get(id); if (!n) return null; n.text = String(text == null ? '' : text).replace(/\r?\n/g, ' '); return n; };
  Tree.prototype.setNote = function (id, note) { var n = this.get(id); if (!n) return null; n.note = note || ''; return n; };
  Tree.prototype.setProps = function (id, props) { var n = this.get(id); if (!n) return null; for (var k in props) if (k !== 'id' && k !== 'children') n[k] = props[k]; return n; };
  Tree.prototype.toggleCollapse = function (id, force) {
    var n = this.get(id); if (!n || !n.children.length) return null;
    n.collapsed = force == null ? !n.collapsed : !!force; return n;
  };
  Tree.prototype.expandTo = function (id) { var p = this.parentOf(id); while (p) { p.collapsed = false; p = this.parentOf(p.id); } };

  /* 换父节点：目标不能是自己或自己的后代；index 省略 = 追加到末尾 */
  Tree.prototype.move = function (id, newParentId, index) {
    var n = this.get(id), np = this.get(newParentId), op = this.parentOf(id);
    if (!n || !np || !op || this.isAncestor(id, newParentId)) return null;
    var oi = op.children.indexOf(n);
    op.children.splice(oi, 1);
    if (index == null || index < 0 || index > np.children.length) np.children.push(n);
    else { if (np === op && index > oi) index--; np.children.splice(index, 0, n); }
    np.collapsed = false;
    this.parentMap.set(id, np);
    return n;
  };
  Tree.prototype.moveUp = function (id) { var p = this.parentOf(id); if (!p) return null; var i = p.children.indexOf(this.get(id)); if (i <= 0) return null; return this.move(id, p.id, i - 1); };
  Tree.prototype.moveDown = function (id) { var p = this.parentOf(id); if (!p) return null; var i = p.children.indexOf(this.get(id)); if (i >= p.children.length - 1) return null; return this.move(id, p.id, i + 2); };
  Tree.prototype.outdent = function (id) {          // Shift+Tab：升一级，排在原父节点后面
    var p = this.parentOf(id), gp = p && this.parentOf(p.id);
    if (!gp) return null;
    return this.move(id, gp.id, gp.children.indexOf(p) + 1);
  };
  Tree.prototype.indent = function (id) {           // 降一级：成为前一个同级的最后一个子节点
    var p = this.parentOf(id); if (!p) return null;
    var i = p.children.indexOf(this.get(id)); if (i <= 0) return null;
    return this.move(id, p.children[i - 1].id);
  };

  /* ---- 序列化 ---- */
  function toJSON(n, withIds) {
    var o = { text: n.text };
    if (withIds) o.id = n.id;
    if (n.note) o.note = n.note;
    if (n.collapsed) o.collapsed = true;
    if (n.color) o.color = n.color;
    if (n.icon) o.icon = n.icon;
    if (n.priority) o.priority = n.priority;
    if (n.children.length) o.children = n.children.map(function (c) { return toJSON(c, withIds); });
    return o;
  }
  function fromJSON(o, keepIds) {
    if (!o || typeof o !== 'object') o = { text: String(o == null ? '' : o) };
    var n = makeNode(o.text, { note: o.note ? String(o.note) : '', collapsed: !!o.collapsed, color: o.color || null, icon: o.icon || '',
                               priority: Math.max(0, Math.min(3, parseInt(o.priority, 10) || 0)) });
    if (keepIds && o.id) { n.id = String(o.id); var m = /^n(\d+)$/.exec(n.id); if (m && +m[1] > seq) seq = +m[1]; }
    var kids = Array.isArray(o.children) ? o.children : [];
    for (var i = 0; i < kids.length; i++) n.children.push(fromJSON(kids[i], keepIds));
    return n;
  }
  Tree.prototype.toJSON = function () { return toJSON(this.root, false); };
  Tree.prototype.snapshot = function () { return toJSON(this.root, true); };
  Tree.fromJSON = function (obj, keepIds) {
    if (obj && obj.root && typeof obj.root === 'object' && obj.text == null) obj = obj.root;   // 也接受 {root: {...}} 包装
    return new Tree(fromJSON(obj, keepIds));
  };
  Tree.prototype.clone = function () { return Tree.fromJSON(this.snapshot(), true); };

  /* ---- 撤销 / 重做 ---- */
  function History(limit) { this.limit = limit || 200; this.undoStack = []; this.redoStack = []; }
  History.prototype.push = function (state) {           // state：{json(带 id), sel}
    this.undoStack.push(state);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  };
  History.prototype.undo = function (current) { if (!this.undoStack.length) return null; this.redoStack.push(current); return this.undoStack.pop(); };
  History.prototype.redo = function (current) { if (!this.redoStack.length) return null; this.undoStack.push(current); return this.redoStack.pop(); };
  History.prototype.canUndo = function () { return this.undoStack.length > 0; };
  History.prototype.canRedo = function () { return this.redoStack.length > 0; };
  History.prototype.clear = function () { this.undoStack.length = 0; this.redoStack.length = 0; };

  root.Model = { Tree: Tree, History: History, makeNode: makeNode, uid: uid };
})(typeof window !== 'undefined' ? window : globalThis);
