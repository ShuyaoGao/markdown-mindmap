/* 自动排版（无 DOM，浏览器与 Node 测试共用）。
 *
 *   Layout.wrap(runs, maxWidth, measure)        把 Markdown.inline 的 runs 按宽度折行 → [[run, …], …]
 *   Layout.nodeSize(node, depth, measure)       节点盒子 {w, h, lines, font}（measure(str, bold, size) → 像素宽；浏览器用 canvas，Node 用估算）
 *   Layout.compute(tree, {mode, size})          mode = 'mindmap'（根居中、左右平衡）| 'tree'（向右树状）| 'outline'（大纲）
 *                                               → {nodes:[{id,node,x,y,w,h,side,depth,branch,hidden}], edges:[{from,to,side}], bbox}
 *                                               子树块高度 = 子块之和，节点在自己的块里垂直居中 → 按构造不重叠。
 *   Layout.overlaps(result)                     返回有重叠的节点对（自检与单元测试用，应为空）。
 *   Layout.estimateMeasure                      无 canvas 时的宽度估算（中文 = 字号，英文 ≈ 0.56 字号）。
 */
(function (root) {
  'use strict';
  var CFG = root.APP_CONFIG, P = CFG.LAYOUT_PARAMS, F = CFG.FONT;
  var CJK = /[⺀-⻿⼀-⿟　-〿぀-ゟ゠-ヿ㄀-ㄯ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/;

  function estimateMeasure(s, bold, size) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdbff) { w += size * 1.1; i++; continue; }       // emoji 等代理对
      w += CJK.test(ch) ? size : (ch === ' ' ? size * 0.3 : size * 0.56);
    }
    return bold ? w * 1.04 : w;
  }

  function tokens(s) {           // 中文逐字、英文按词、空格单独
    var out = [], re = /[⺀-鿿豈-﫿＀-￯가-힯]|[\ud800-\udbff][\udc00-\udfff]|\s+|[^\s⺀-鿿豈-﫿＀-￯가-힯\ud800-\udfff]+/g, m;
    while ((m = re.exec(s))) out.push(m[0]);
    return out;
  }

  function wrap(runs, maxWidth, measure, size) {
    var lines = [], line = [], lineW = 0;
    function push(run, piece, w) {
      var last = line[line.length - 1];
      if (last && last.t === run.t && last.href === run.href) last.s += piece; else line.push({ t: run.t, s: piece, href: run.href });
      lineW += w;
    }
    function newline() { if (line.length) lines.push(line); line = []; lineW = 0; }
    runs.forEach(function (run) {
      var bold = run.t === 'bold', mono = run.t === 'code';
      tokens(run.s).forEach(function (tok) {
        var w = measure(tok, bold, size) * (mono ? 1.05 : 1);
        if (lineW + w <= maxWidth || !line.length && w <= maxWidth) { if (!(line.length === 0 && /^\s+$/.test(tok))) push(run, tok, w); return; }
        if (/^\s+$/.test(tok)) { newline(); return; }
        if (w > maxWidth) {                         // 一个词就超宽：按字符硬切
          for (var i = 0; i < tok.length; i++) {
            var cw = measure(tok[i], bold, size);
            if (lineW + cw > maxWidth && line.length) newline();
            push(run, tok[i], cw);
          }
          return;
        }
        newline(); push(run, tok, w);
      });
    });
    newline();
    if (!lines.length) lines.push([{ t: 'text', s: '' }]);
    return lines;
  }

  function nodeSize(node, depth, measure, opts) {
    opts = opts || {};
    var size = depth === 0 ? F.rootSize : (depth === 1 ? F.size + 1 : F.size);
    var padX = depth === 0 ? P.rootPadX : P.padX, padY = depth === 0 ? P.rootPadY : P.padY;
    var runs = root.Markdown.inline(node.text || '');
    var lines = wrap(runs, opts.maxTextWidth || P.maxTextWidth, measure, size);
    var textW = 0;
    lines.forEach(function (ln) {
      var w = 0; ln.forEach(function (r) { w += measure(r.s, r.t === 'bold', size) * (r.t === 'code' ? 1.05 : 1); });
      if (w > textW) textW = w;
    });
    var extra = 0;
    if (node.icon) extra += size * 1.25 + 4;
    if (node.priority) extra += size * 1.2 + 4;
    if (node.note) extra += size * 0.9 + 4;
    var lineH = Math.round(size * F.lineHeight);
    var w = Math.max(Math.round(textW + extra + padX * 2), depth === 0 ? 72 : 40);
    var h = lines.length * lineH + padY * 2;
    return { w: w, h: h, lines: lines, font: size, lineH: lineH, padX: padX, padY: padY, extra: extra };
  }

  /* ---------------- 排版 ---------------- */
  function compute(tree, opts) {
    opts = opts || {};
    var mode = opts.mode || CFG.DEFAULT_LAYOUT, sizeFn = opts.size, hgap = opts.hgap || P.hgap, vgap = opts.vgap || P.vgap;
    var out = { mode: mode, nodes: [], edges: [], bbox: null }, boxes = new Map();
    function box(n, d) {
      var b = boxes.get(n.id);
      if (!b) { var s = sizeFn(n, d); b = { id: n.id, node: n, w: s.w, h: s.h, size: s, depth: d, x: 0, y: 0, side: 'R', branch: -1, block: 0 }; boxes.set(n.id, b); }
      return b;
    }
    function visibleKids(n) { return n.collapsed ? [] : n.children; }
    function measureBlock(n, d) {
      var b = box(n, d), ks = visibleKids(n), total = 0;
      ks.forEach(function (c, i) { total += measureBlock(c, d + 1) + (i ? vgap : 0); });
      b.kidsTotal = total;
      b.block = Math.max(b.h, total);
      return b.block;
    }
    function place(n, d, x, yTop, side, branch) {
      var b = box(n, d);
      b.side = side; b.branch = branch;
      b.y = yTop + (b.block - b.h) / 2;
      b.x = side === 'L' ? x - b.w : x;
      out.nodes.push(b);
      var ks = visibleKids(n), cy = yTop + (b.block - b.kidsTotal) / 2;
      ks.forEach(function (c, i) {
        var cb = place(c, d + 1, side === 'L' ? b.x - hgap : b.x + b.w + hgap, cy, side, d === 0 ? i : branch);
        out.edges.push({ from: b.id, to: cb.id, side: side });
        cy += cb.block + vgap;
      });
      return b;
    }

    if (mode === 'outline') {
      var y = 0, indent = opts.outlineIndent || P.outlineIndent, gap = opts.outlineGap || P.outlineGap;
      (function w(n, d, parentBox, branch) {
        var b = box(n, d); b.x = d * indent; b.y = y; b.side = 'R'; b.branch = branch; b.block = b.h; y += b.h + gap;
        out.nodes.push(b);
        if (parentBox) out.edges.push({ from: parentBox.id, to: b.id, side: 'O' });
        visibleKids(n).forEach(function (c, i) { w(c, d + 1, b, d === 0 ? i : branch); });
      })(tree.root, 0, null, -1);
    } else {
      var rt = tree.root, rb = box(rt, 0), ks = visibleKids(rt);
      var right = mode === 'tree' ? ks : ks.slice(0, Math.ceil(ks.length / 2)), left = mode === 'tree' ? [] : ks.slice(Math.ceil(ks.length / 2));
      function total(list) { var t = 0; list.forEach(function (c, i) { t += measureBlock(c, 1) + (i ? vgap : 0); }); return t; }
      var tr = total(right), tl = total(left);
      rb.block = Math.max(rb.h, tr, tl); rb.kidsTotal = 0;
      rb.x = -rb.w / 2; rb.y = -rb.h / 2; rb.side = 'C'; rb.branch = -1;
      out.nodes.push(rb);
      var cy = -tr / 2;
      right.forEach(function (c, i) {
        var cb = place(c, 1, rb.x + rb.w + hgap, cy, 'R', ks.indexOf(c));
        out.edges.push({ from: rb.id, to: cb.id, side: 'R' }); cy += cb.block + vgap;
      });
      cy = -tl / 2;
      left.forEach(function (c) {
        var cb = place(c, 1, rb.x - hgap, cy, 'L', ks.indexOf(c));
        out.edges.push({ from: rb.id, to: cb.id, side: 'L' }); cy += cb.block + vgap;
      });
    }
    out.nodes.forEach(function (b) { b.x = Math.round(b.x); b.y = Math.round(b.y); b.cx = b.x + b.w / 2; b.cy = b.y + b.h / 2; b.collapsedCount = b.node.collapsed ? tree.descendantCount(b.id) : 0; });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    out.nodes.forEach(function (b) { var pad = b.collapsedCount ? 26 : 0; if (b.x - (b.side === 'L' ? pad : 0) < minX) minX = b.x - (b.side === 'L' ? pad : 0); if (b.y < minY) minY = b.y; if (b.x + b.w + (b.side !== 'L' ? pad : 0) > maxX) maxX = b.x + b.w + (b.side !== 'L' ? pad : 0); if (b.y + b.h > maxY) maxY = b.y + b.h; });
    out.bbox = out.nodes.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
    out.byId = new Map(out.nodes.map(function (b) { return [b.id, b]; }));
    return out;
  }

  function overlaps(result, margin) {
    margin = margin == null ? 0 : margin;
    var bad = [], ns = result.nodes;
    for (var i = 0; i < ns.length; i++) for (var j = i + 1; j < ns.length; j++) {
      var a = ns[i], b = ns[j];
      if (a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin) bad.push([a.id, b.id]);
    }
    return bad;
  }

  root.Layout = { wrap: wrap, nodeSize: nodeSize, compute: compute, overlaps: overlaps, estimateMeasure: estimateMeasure, tokens: tokens };
})(typeof window !== 'undefined' ? window : globalThis);
