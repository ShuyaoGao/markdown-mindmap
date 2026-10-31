/* Markdown ↔ 树（无 DOM，浏览器与 Node 测试共用）。
 *
 * 认两种写法，可以混用：
 *   # 中心主题            `#` 的个数 = 层级（# 根，## 第一层，### 第二层……）
 *   ## 分支
 *   - 子节点              列表项 `- ` `* ` `+ ` `1. `：层级 = 上一个标题的层级 + 1 + 缩进级数（2 空格或 1 个 Tab 为一级，自动识别 4 空格）
 *     - 孙节点
 *   <!-- 备注 -->          紧跟在节点后面的 HTML 注释 = 这个节点的备注（可多行：<!-- 第一行 ⏎ 第二行 -->）
 *   没有 `#` 也没有 `-` 的普通文字行：第一行当根节点，其余并入上一个节点的备注。
 *   节点文字里支持 **粗体**、`代码`、[文字](url)。
 *
 *   Markdown.parse(text)                → { root（Model 节点，含新 id）, headingLevels }
 *   Markdown.serialize(root, opts)      → { text, lineOf: {id: 行号} }   opts.headingLevels = 前几层写成标题（默认 2）
 *   Markdown.merge(oldRoot, newRoot)    → 把旧树的 id / 颜色 / 图标 / 优先级 / 折叠状态按位置和文字搬到新树上（实时同步时保留属性）
 *   Markdown.inline(text)               → [{ t: 'text'|'bold'|'code'|'link', s, href }]
 *   Markdown.plain(text)                → 去掉标记后的纯文字
 */
(function (root) {
  'use strict';
  var Model = root.Model;
  var HEAD = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  var LIST = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;
  var ESCAPED_PREFIX = /^\\(?=(#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|<!--))/;

  function indentWidth(ws) {       // Tab 算一级，空格按文档里最小的非零缩进算一级（2 或 4 空格都行）
    var tabs = 0, spaces = 0;
    for (var i = 0; i < ws.length; i++) if (ws[i] === '\t') tabs++; else spaces++;
    return { tabs: tabs, spaces: spaces };
  }

  /* 第一遍：把每一行变成 {kind:'node', level, text} 或 {kind:'note', text} */
  function scan(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var items = [], i = 0, m;
    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();
      if (!t) { i++; continue; }
      if (t.indexOf('<!--') === 0) {                       // 注释：可能跨多行
        var buf = [], first = t.slice(4), done = false;
        var end = first.indexOf('-->');
        if (end >= 0) { buf.push(first.slice(0, end)); done = true; }
        else { buf.push(first); }
        i++;
        while (!done && i < lines.length) {
          var l2 = lines[i]; var e2 = l2.indexOf('-->');
          if (e2 >= 0) { buf.push(l2.slice(0, e2)); done = true; } else buf.push(l2);
          i++;
        }
        var note = buf.join('\n').replace(/^\s*\n|\n\s*$/g, '').trim();
        items.push({ kind: 'note', text: note });
        continue;
      }
      if ((m = HEAD.exec(t))) { items.push({ kind: 'head', level: m[1].length - 1, text: unescapeText(m[2]) }); i++; continue; }
      if ((m = LIST.exec(line))) { items.push({ kind: 'list', indent: indentWidth(m[1]), text: unescapeText(m[2].trim()) }); i++; continue; }
      items.push({ kind: 'plain', text: unescapeText(t) });
      i++;
    }
    return items;
  }
  function unescapeText(s) { return s.replace(ESCAPED_PREFIX, ''); }
  function escapeText(s) {
    s = String(s == null ? '' : s).replace(/\r?\n/g, ' ');
    return /^(#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|<!--)/.test(s) ? '\\' + s : s;
  }

  function parse(text) {
    var items = scan(text);
    var unit = 0;                                            // 空格缩进单位：列表里最小的非零空格缩进（默认 2）
    items.forEach(function (it) { if (it.kind === 'list' && it.indent.spaces > 0 && (unit === 0 || it.indent.spaces < unit)) unit = it.indent.spaces; });
    if (!unit) unit = 2;
    var flat = [], lastHead = -1, maxHead = 0, hasNode = false;
    items.forEach(function (it) {
      if (it.kind === 'head') { lastHead = it.level; if (it.level + 1 > maxHead) maxHead = it.level + 1; flat.push({ depth: it.level, text: it.text }); hasNode = true; }
      else if (it.kind === 'list') { flat.push({ depth: lastHead + 1 + it.indent.tabs + Math.round(it.indent.spaces / unit), text: it.text }); hasNode = true; }
      else if (it.kind === 'plain') {
        if (!hasNode) { flat.push({ depth: 0, text: it.text }); hasNode = true; lastHead = 0; if (maxHead < 1) maxHead = 1; }
        else { var last = flat[flat.length - 1]; last.note = last.note ? last.note + '\n' + it.text : it.text; }
      } else if (it.kind === 'note') {
        if (flat.length) { var ln = flat[flat.length - 1]; ln.note = ln.note ? ln.note + '\n' + it.text : it.text; }
      }
    });
    /* 第二遍：按“声明的深度”建树（标准大纲算法：弹掉栈里深度 ≥ 自己的，然后挂到栈顶）。
       `## A` `## B` 并列成两个顶层；`# R` 后直接 `#### x` 时 x 是 R 的子节点（跳级就近挂）。 */
    var tops = [], stack = [];
    flat.forEach(function (f) {
      var n = Model.makeNode(f.text, { note: f.note || '' });
      while (stack.length && stack[stack.length - 1].depth >= f.depth) stack.pop();
      if (!stack.length) tops.push(n); else stack[stack.length - 1].node.children.push(n);
      stack.push({ depth: f.depth, node: n });
    });
    var rootNode;
    if (tops.length === 1) rootNode = tops[0];
    else { rootNode = Model.makeNode('思维导图'); rootNode.children = tops; }
    return { root: rootNode, headingLevels: Math.max(1, Math.min(6, maxHead || 1)), empty: tops.length === 0 };
  }

  function serialize(rootNode, opts) {
    opts = opts || {};
    var hl = Math.max(1, Math.min(6, opts.headingLevels || 2));
    var out = [], lineOf = {};
    (function w(n, d) {
      var prefix, indent = '';
      if (d < hl) prefix = new Array(d + 2).join('#') + ' ';
      else { indent = new Array((d - hl) * 2 + 1).join(' '); prefix = indent + '- '; }
      lineOf[n.id] = out.length;
      out.push(prefix + escapeText(n.text));
      if (n.note) {
        var note = String(n.note).replace(/-->/g, '--​>');
        if (note.indexOf('\n') < 0) out.push(indent + '<!-- ' + note + ' -->');
        else out.push(indent + '<!--\n' + note + '\n' + indent + '-->');
      }
      for (var i = 0; i < n.children.length; i++) w(n.children[i], d + 1);
    })(rootNode, 0);
    return { text: out.join('\n') + '\n', lineOf: lineOf };
  }

  /* 把旧树的属性搬到新树：同一父节点下先按文字配对，配不上再按位置配对（文字被改了的情况） */
  function merge(oldN, newN) {
    if (!oldN || !newN) return newN;
    newN.id = oldN.id;
    newN.color = oldN.color; newN.icon = oldN.icon; newN.priority = oldN.priority; newN.collapsed = oldN.collapsed && newN.children.length > 0;
    var unused = oldN.children.slice();
    var pairs = new Array(newN.children.length);
    newN.children.forEach(function (c, i) {
      var j = -1;
      for (var k = 0; k < unused.length; k++) if (unused[k] && unused[k].text === c.text) { j = k; break; }
      if (j >= 0) { pairs[i] = unused[j]; unused[j] = null; }
    });
    var leftover = unused.filter(function (o) { return o; }), li = 0;   // 文字对不上的：按先后顺序配对（通常是改了字的那个）
    newN.children.forEach(function (c, i) { if (!pairs[i] && li < leftover.length) pairs[i] = leftover[li++]; });
    newN.children.forEach(function (c, i) { if (pairs[i]) merge(pairs[i], c); });
    return newN;
  }

  var INLINE = /(\*\*([^*]+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  function inline(text) {
    var s = String(text == null ? '' : text), runs = [], last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(s))) {
      if (m.index > last) runs.push({ t: 'text', s: s.slice(last, m.index) });
      if (m[1]) runs.push({ t: 'bold', s: m[2] });
      else if (m[3]) runs.push({ t: 'code', s: m[4] });
      else runs.push({ t: 'link', s: m[6], href: m[7] });
      last = m.index + m[0].length;
    }
    if (last < s.length) runs.push({ t: 'text', s: s.slice(last) });
    if (!runs.length) runs.push({ t: 'text', s: '' });
    return runs;
  }
  function plain(text) { return inline(text).map(function (r) { return r.s; }).join(''); }

  root.Markdown = { parse: parse, serialize: serialize, merge: merge, inline: inline, plain: plain, escapeText: escapeText };
})(typeof window !== 'undefined' ? window : globalThis);
