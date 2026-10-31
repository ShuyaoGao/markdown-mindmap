/* 导入 / 导出格式（无 DOM，浏览器与 Node 测试共用）。
 *
 *   Formats.toJSON(tree) / fromJSON(text)          自定义 JSON：{text, children, note, collapsed, color, icon, priority} 树
 *   Formats.toOPML(tree) / fromOPML(text)          OPML 2.0（outline text="…" _note="…"）
 *   Formats.toFreeMind(tree) / fromFreeMind(text)  FreeMind .mm（node TEXT="…" FOLDED COLOR，richcontent NOTE）
 *   Formats.detect(text)                           'json' | 'opml' | 'freemind' | 'markdown'
 *   Formats.importAny(text)                        按内容自动识别 → { tree, format }
 *   Formats.parseXML(text)                         自己写的小 XML 解析器（元素、属性、文本、CDATA、注释、实体）
 */
(function (root) {
  'use strict';
  var Model = root.Model, Markdown = root.Markdown;

  /* ---------------- 小 XML 解析器 ---------------- */
  var ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === '#') { var code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(code) ? String.fromCodePoint(code) : m; }
      return ENT.hasOwnProperty(e) ? ENT[e] : m;
    });
  }
  function encode(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function parseXML(src) {
    src = String(src || '').replace(/^﻿/, '');
    var i = 0, n = src.length, stack = [], docRoot = null, cur = null;
    function pushText(t) { if (cur && t) cur.children.push({ type: 'text', text: decode(t) }); }
    while (i < n) {
      var lt = src.indexOf('<', i);
      if (lt < 0) { pushText(src.slice(i)); break; }
      if (lt > i) pushText(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { var ce = src.indexOf('-->', lt + 4); i = ce < 0 ? n : ce + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) { var de = src.indexOf(']]>', lt + 9); if (cur) cur.children.push({ type: 'text', text: src.slice(lt + 9, de < 0 ? n : de) }); i = de < 0 ? n : de + 3; continue; }
      if (src.startsWith('<?', lt)) { var pe = src.indexOf('?>', lt + 2); i = pe < 0 ? n : pe + 2; continue; }
      if (src.startsWith('<!', lt)) { var be = src.indexOf('>', lt + 2); i = be < 0 ? n : be + 1; continue; }
      var gt = lt + 1, inQ = null;
      while (gt < n) { var ch = src[gt]; if (inQ) { if (ch === inQ) inQ = null; } else if (ch === '"' || ch === "'") inQ = ch; else if (ch === '>') break; gt++; }
      var tag = src.slice(lt + 1, gt);
      i = gt + 1;
      if (tag[0] === '/') { if (stack.length) { stack.pop(); cur = stack[stack.length - 1] || null; } continue; }
      var selfClose = /\/\s*$/.test(tag);
      if (selfClose) tag = tag.replace(/\/\s*$/, '');
      var m = /^([^\s\/>]+)([\s\S]*)$/.exec(tag);
      if (!m) continue;
      var el = { type: 'element', name: m[1], attrs: {}, children: [] };
      var re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g, am;
      while ((am = re.exec(m[2]))) el.attrs[am[1]] = decode(am[2] != null ? am[2] : am[3] != null ? am[3] : am[4]);
      if (cur) cur.children.push(el); else if (!docRoot) docRoot = el;
      if (!selfClose) { stack.push(el); cur = el; }
    }
    return docRoot;
  }
  function kids(el, name) { return el ? el.children.filter(function (c) { return c.type === 'element' && (!name || c.name.toLowerCase() === name); }) : []; }
  function textOf(el) { return el ? el.children.map(function (c) { return c.type === 'text' ? c.text : textOf(c); }).join('') : ''; }
  function stripHTML(s) {
    return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* richcontent 里的 HTML：在元素树上取文字（实体已解码的 <node> 字面文字不会被当成标签），p / br / div / li 换行 */
  function richText(el) {
    var out = '';
    (function w(e) {
      e.children.forEach(function (c) {
        if (c.type === 'text') { out += c.text; return; }
        var nm = c.name.toLowerCase();
        if (nm === 'head' || nm === 'style' || nm === 'script') return;
        if (nm === 'br') out += '\n';
        w(c);
        if (nm === 'p' || nm === 'div' || nm === 'li' || nm === 'tr' || nm === 'h1' || nm === 'h2' || nm === 'h3') out += '\n';
      });
    })(el);
    return out.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(function (l) { return l; }).join('\n');
  }

  /* ---------------- JSON ---------------- */
  function toJSON(tree) { return JSON.stringify(tree.toJSON(), null, 2) + '\n'; }
  function fromJSON(text) { return Model.Tree.fromJSON(typeof text === 'string' ? JSON.parse(text) : text, false); }

  /* ---------------- OPML ---------------- */
  function toOPML(tree) {
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head><title>' + encode(tree.root.text) + '</title></head>', '  <body>'];
    (function w(n, ind) {
      var a = ' text="' + encode(n.text) + '"';
      if (n.note) a += ' _note="' + encode(n.note) + '"';
      if (n.collapsed) a += ' _collapsed="true"';
      if (n.color) a += ' _color="' + encode(n.color) + '"';
      if (n.icon) a += ' _icon="' + encode(n.icon) + '"';
      if (n.priority) a += ' _priority="' + n.priority + '"';
      if (!n.children.length) { out.push(ind + '<outline' + a + '/>'); return; }
      out.push(ind + '<outline' + a + '>');
      n.children.forEach(function (c) { w(c, ind + '  '); });
      out.push(ind + '</outline>');
    })(tree.root, '    ');
    out.push('  </body>', '</opml>', '');
    return out.join('\n');
  }
  function fromOPML(text) {
    var doc = parseXML(text);
    if (!doc || doc.name.toLowerCase() !== 'opml') throw new Error('不是 OPML 文件');
    var body = kids(doc, 'body')[0], head = kids(doc, 'head')[0];
    function conv(el) {
      var a = el.attrs, n = Model.makeNode(a.text != null ? a.text : (a.title || ''), {
        note: a._note || '', collapsed: a._collapsed === 'true', color: a._color || null, icon: a._icon || '',
        priority: parseInt(a._priority, 10) || 0 });
      kids(el, 'outline').forEach(function (c) { n.children.push(conv(c)); });
      return n;
    }
    var tops = kids(body, 'outline').map(conv), rootNode;
    if (tops.length === 1) rootNode = tops[0];
    else { rootNode = Model.makeNode(textOf(kids(head, 'title')[0]).trim() || '思维导图'); rootNode.children = tops; }
    return new Model.Tree(rootNode);
  }

  /* ---------------- FreeMind .mm ---------------- */
  function toFreeMind(tree) {
    var out = ['<map version="1.0.1">', '<!-- 由 ' + (root.APP_CONFIG ? root.APP_CONFIG.APP_NAME_EN : 'Markdown Mindmap') + ' 导出；FreeMind / Freeplane 可直接打开 -->'];
    (function w(n, ind, depth, idx) {
      var a = ' TEXT="' + encode(n.text) + '"';
      if (depth === 1) a += ' POSITION="' + (idx % 2 === 0 ? 'right' : 'left') + '"';
      if (n.collapsed) a += ' FOLDED="true"';
      if (n.color) a += ' COLOR="' + encode(n.color) + '"';
      var inner = [];
      if (n.icon) inner.push(ind + '  <icon BUILTIN="' + encode(n.icon) + '"/>');
      if (n.priority) inner.push(ind + '  <icon BUILTIN="full-' + n.priority + '"/>');
      if (n.note) inner.push(ind + '  <richcontent TYPE="NOTE"><html><head></head><body><p>' + encode(n.note).replace(/\n/g, '</p><p>') + '</p></body></html></richcontent>');
      if (!inner.length && !n.children.length) { out.push(ind + '<node' + a + '/>'); return; }
      out.push(ind + '<node' + a + '>');
      inner.forEach(function (l) { out.push(l); });
      n.children.forEach(function (c, i) { w(c, ind + '  ', depth + 1, i); });
      out.push(ind + '</node>');
    })(tree.root, '', 0, 0);
    out.push('</map>', '');
    return out.join('\n');
  }
  function fromFreeMind(text) {
    var doc = parseXML(text);
    if (!doc || doc.name.toLowerCase() !== 'map') throw new Error('不是 FreeMind 文件');
    function conv(el) {
      var a = el.attrs, txt = a.TEXT != null ? a.TEXT : '', note = '', icon = '', pr = 0;
      kids(el, 'richcontent').forEach(function (rc) {
        var t = (rc.attrs.TYPE || '').toUpperCase(), s = richText(rc);
        if (t === 'NOTE') note = s; else if (t === 'NODE' && !txt) txt = s.replace(/\s+/g, ' ');
      });
      kids(el, 'icon').forEach(function (ic) {
        var b = ic.attrs.BUILTIN || '', m = /^full-([1-3])$/.exec(b);
        if (m) pr = +m[1]; else if (!icon) icon = /^[\x00-\x7f]+$/.test(b) ? '' : b;
      });
      var n = Model.makeNode(txt, { note: note, collapsed: a.FOLDED === 'true', color: a.COLOR || null, icon: icon, priority: pr });
      kids(el, 'node').forEach(function (c) { n.children.push(conv(c)); });
      return n;
    }
    var tops = kids(doc, 'node').map(conv), rootNode;
    if (tops.length === 1) rootNode = tops[0]; else { rootNode = Model.makeNode('思维导图'); rootNode.children = tops; }
    return new Model.Tree(rootNode);
  }

  /* ---------------- 识别 ---------------- */
  function detect(text) {
    var t = String(text || '').replace(/^﻿/, '').trimStart();
    if (t[0] === '{' || t[0] === '[') return 'json';
    if (t[0] === '<') {
      var head = t.slice(0, 2000).toLowerCase();
      if (/<opml[\s>]/.test(head)) return 'opml';
      if (/<map[\s>]/.test(head)) return 'freemind';
      return 'xml';
    }
    return 'markdown';
  }
  function importAny(text, hintName) {
    var f = detect(text);
    if (f === 'xml' && hintName) f = /\.mm$/i.test(hintName) ? 'freemind' : /\.opml$/i.test(hintName) ? 'opml' : f;
    if (f === 'json') return { tree: fromJSON(text), format: 'json' };
    if (f === 'opml') return { tree: fromOPML(text), format: 'opml' };
    if (f === 'freemind') return { tree: fromFreeMind(text), format: 'freemind' };
    if (f === 'xml') throw new Error('不认识的 XML 格式（支持 OPML 和 FreeMind .mm）');
    var p = Markdown.parse(text);
    return { tree: new Model.Tree(p.root), format: 'markdown', headingLevels: p.headingLevels };
  }

  root.Formats = { toJSON: toJSON, fromJSON: fromJSON, toOPML: toOPML, fromOPML: fromOPML, toFreeMind: toFreeMind, fromFreeMind: fromFreeMind,
                   detect: detect, importAny: importAny, parseXML: parseXML, encodeXML: encode, decodeXML: decode, stripHTML: stripHTML };
})(typeof window !== 'undefined' ? window : globalThis);
