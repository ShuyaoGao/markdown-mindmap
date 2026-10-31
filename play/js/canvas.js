/* SVG 画布：绘制、缩放平移（滚轮 / 空白处拖动 / 双指）、拖节点换父（拖到目标节点上高亮）、导出 SVG / PNG。
 * 只管“画”和“手势”，不改树：所有改动通过 handlers 回调交给 app.js。
 *
 *   Canvas.init(svg, handlers)   handlers: onSelect(id), onEdit(id), onDrop(srcId, dstId), onToggle(id), onBackground(), onViewChange()
 *   Canvas.render(tree, {mode, edgeStyle, theme, dark, sel, findSet, newIds})
 *   Canvas.fit() / zoomBy(f, cx, cy) / zoomTo(z) / ensureVisible(id) / nodeScreenRect(id) / center(id)
 *   Canvas.toSVGString() / toCanvas(scale) → Promise<HTMLCanvasElement>
 */
(function (root) {
  'use strict';
  var CFG = root.APP_CONFIG, P = CFG.LAYOUT_PARAMS, F = CFG.FONT, NS = 'http://www.w3.org/2000/svg';
  var svg, world, gEdges, gNodes, stage, H = {}, measureCtx, sizeCache = new Map();
  var view = { x: 0, y: 0, z: 1 };
  var cur = { tree: null, layout: null, opts: {} };
  var pointers = new Map(), gesture = null, lastTap = { id: null, t: 0 };

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function measure(s, bold, size) {
    if (!measureCtx) { var c = document.createElement('canvas'); measureCtx = c.getContext('2d'); }
    measureCtx.font = (bold ? 'bold ' : '') + size + 'px ' + F.family;
    return measureCtx.measureText(s).width;
  }
  function luminance(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 0.5;
    var h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function sizeOf(n, d) {
    var key = [n.text, d, n.icon, n.priority, n.note ? 1 : 0].join('\u0001');
    var s = sizeCache.get(key);
    if (!s) { s = root.Layout.nodeSize(n, d, measure); sizeCache.set(key, s); if (sizeCache.size > 5000) sizeCache.clear(); }
    return s;
  }

  /* ---------------- 颜色 ---------------- */
  function theme() { return CFG.THEMES[cur.opts.theme] || CFG.THEMES[CFG.DEFAULT_THEME]; }
  function colorsFor(b) {
    var T = theme(), dark = !!cur.opts.dark, branch = T.branch[(b.branch < 0 ? 0 : b.branch) % T.branch.length];
    var c = { branch: branch, fill: null, stroke: branch, ink: dark ? T.inkDark : T.ink, strokeW: 1.5 };
    if (b.depth === 0) { c.fill = T.root; c.ink = T.rootInk; c.stroke = T.root; c.strokeW = 0; }
    else if (b.depth === 1) { c.fill = branch; c.ink = '#ffffff'; c.strokeW = 0; }
    else { c.fill = dark ? T.leafBgDark : T.leafBg; }
    if (b.node.color) { c.fill = b.node.color; c.stroke = b.node.color; c.ink = luminance(b.node.color) > 0.55 ? '#1d2430' : '#ffffff'; c.strokeW = 0; }
    return c;
  }

  /* ---------------- 绘制 ---------------- */
  function edgePath(e, L) {
    var a = L.byId.get(e.from), b = L.byId.get(e.to), x1, y1, x2, y2;
    if (e.side === 'O') { x1 = a.x + Math.min(18, a.w / 2); y1 = a.y + a.h; x2 = b.x; y2 = b.cy; return 'M' + x1 + ' ' + y1 + ' V' + y2 + ' H' + x2; }
    if (e.side === 'L') { x1 = a.x; y1 = a.cy; x2 = b.x + b.w; y2 = b.cy; } else { x1 = a.x + a.w; y1 = a.cy; x2 = b.x; y2 = b.cy; }
    if (a.depth === 0) y1 = a.cy;
    if (cur.opts.edgeStyle === 'elbow') { var mx = (x1 + x2) / 2; return 'M' + x1 + ' ' + y1 + ' H' + mx + ' V' + y2 + ' H' + x2; }
    var dx = (x2 - x1) / 2;
    return 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }

  function drawInto(gE, gN, L, deco) {
    deco = deco || {};
    var T = theme(), dark = !!cur.opts.dark;
    L.edges.forEach(function (e) {
      var b = L.byId.get(e.to), c = colorsFor(b);
      el('path', { d: edgePath(e, L), fill: 'none', stroke: b.depth === 1 || b.node.color ? c.branch : (dark ? T.edgeDark : T.edge), 'stroke-width': b.depth === 1 ? 2.5 : 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'edge' }, gE);
    });
    L.nodes.forEach(function (b) {
      var n = b.node, s = b.size, c = colorsFor(b), g = el('g', { class: 'node' + (deco.sel === b.id ? ' sel' : '') + (deco.newIds && deco.newIds.has(b.id) ? ' pop' : ''), 'data-id': b.id, transform: 'translate(' + b.x + ' ' + b.y + ')' }, gN);
      var dim = deco.findSet && !deco.findSet.has(b.id);
      if (dim) g.setAttribute('opacity', '0.28');
      el('rect', { width: b.w, height: b.h, rx: b.depth === 0 ? 12 : 8, fill: c.fill, stroke: c.stroke, 'stroke-width': c.strokeW, class: 'box' }, g);
      var x = s.padX, baseY = s.padY, size = s.font, lineH = s.lineH;
      if (n.icon) { el('text', { x: x, y: baseY + lineH * 0.78, 'font-size': size * 1.05, 'font-family': F.family, fill: c.ink, class: 'icon' }, g).textContent = n.icon; x += size * 1.25 + 4; }
      if (n.priority) {
        var r = size * 0.6;
        el('circle', { cx: x + r, cy: baseY + lineH / 2, r: r, fill: b.depth >= 2 && !n.color ? c.branch : 'rgba(255,255,255,.28)', stroke: 'none' }, g);
        el('text', { x: x + r, y: baseY + lineH / 2 + size * 0.36, 'font-size': size * 0.8, 'font-weight': 'bold', 'text-anchor': 'middle', 'font-family': F.family, fill: b.depth >= 2 && !n.color ? '#fff' : c.ink }, g).textContent = CFG.PRIORITY_LABELS[n.priority] || n.priority;
        x += size * 1.2 + 4;
      }
      s.lines.forEach(function (ln, li) {
        var t = el('text', { x: x, y: baseY + lineH * li + lineH * 0.78, 'font-size': size, 'font-family': F.family, fill: c.ink, 'font-weight': b.depth === 0 ? 'bold' : 'normal', class: 'label' }, g);
        ln.forEach(function (r) {
          var sp = el('tspan', { 'font-weight': r.t === 'bold' ? 'bold' : null, 'font-family': r.t === 'code' ? 'Consolas, "Courier New", monospace' : null,
                                 'text-decoration': r.t === 'link' ? 'underline' : null, fill: r.t === 'link' ? (b.depth >= 2 && !n.color ? '#2f6fe0' : c.ink) : null, class: r.t === 'link' ? 'link' : null, 'data-href': r.t === 'link' ? r.href : null });
          sp.textContent = r.s; t.appendChild(sp);
        });
      });
      if (n.note) el('text', { x: b.w - s.padX - size * 0.9, y: baseY + lineH * 0.78, 'font-size': size * 0.85, 'font-family': F.family, fill: c.ink, opacity: 0.85, class: 'notemark' }, g).textContent = '≡';
      if (b.collapsedCount) {
        var cx = b.side === 'L' ? -13 : b.w + 13, badge = el('g', { class: 'badge', transform: 'translate(' + cx + ' ' + (b.h / 2) + ')' }, g);
        el('circle', { r: 11, fill: dark ? '#2a3140' : '#ffffff', stroke: c.branch, 'stroke-width': 1.5 }, badge);
        el('text', { y: 4, 'font-size': 11, 'text-anchor': 'middle', 'font-family': F.family, fill: dark ? '#e8ecf4' : '#1d2430', 'font-weight': 'bold' }, badge).textContent = b.collapsedCount;
      }
      if (deco.sel === b.id) el('rect', { x: -4, y: -4, width: b.w + 8, height: b.h + 8, rx: b.depth === 0 ? 15 : 11, fill: 'none', stroke: '#ffb020', 'stroke-width': 3, class: 'selring' }, g);
    });
  }

  function render(tree, opts) {
    cur.tree = tree; cur.opts = opts || cur.opts;
    var L = root.Layout.compute(tree, { mode: cur.opts.mode || CFG.DEFAULT_LAYOUT, size: sizeOf });
    cur.layout = L;
    while (gEdges.firstChild) gEdges.removeChild(gEdges.firstChild);
    while (gNodes.firstChild) gNodes.removeChild(gNodes.firstChild);
    drawInto(gEdges, gNodes, L, { sel: cur.opts.sel, findSet: cur.opts.findSet, newIds: cur.opts.newIds });
    applyView();
    return L;
  }

  /* ---------------- 视图 ---------------- */
  function applyView() {
    world.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.z + ')');
    if (H.onViewChange) H.onViewChange(view);
  }
  function stageSize() { var r = stage.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  function fit(maxZ) {
    var L = cur.layout; if (!L || !L.nodes.length) return;
    var S = stageSize(), pad = 32;
    var z = Math.min((S.w - pad * 2) / Math.max(L.bbox.w, 1), (S.h - pad * 2) / Math.max(L.bbox.h, 1), maxZ || 1.25);
    z = Math.max(0.15, z);
    view.z = z; view.x = S.w / 2 - (L.bbox.x + L.bbox.w / 2) * z; view.y = S.h / 2 - (L.bbox.y + L.bbox.h / 2) * z;
    applyView();
  }
  function zoomBy(f, cx, cy) {
    var S = stageSize(); if (cx == null) { cx = S.w / 2; cy = S.h / 2; }
    var nz = Math.max(0.15, Math.min(4, view.z * f)); f = nz / view.z;
    view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.z = nz;
    applyView();
  }
  function zoomTo(z) { zoomBy(z / view.z); }
  function center(id) { var b = cur.layout && cur.layout.byId.get(id); if (!b) return; var S = stageSize(); view.x = S.w / 2 - b.cx * view.z; view.y = S.h / 2 - b.cy * view.z; applyView(); }
  function nodeScreenRect(id) {
    var b = cur.layout && cur.layout.byId.get(id); if (!b) return null;
    return { x: b.x * view.z + view.x, y: b.y * view.z + view.y, w: b.w * view.z, h: b.h * view.z, box: b };
  }
  function ensureVisible(id) {
    var r = nodeScreenRect(id); if (!r) return;
    var S = stageSize(), m = 24, dx = 0, dy = 0;
    if (r.x < m) dx = m - r.x; else if (r.x + r.w > S.w - m) dx = S.w - m - (r.x + r.w);
    if (r.y < m) dy = m - r.y; else if (r.y + r.h > S.h - m) dy = S.h - m - (r.y + r.h);
    if (dx || dy) { view.x += dx; view.y += dy; applyView(); }
  }
  function screenToWorld(x, y) { return { x: (x - view.x) / view.z, y: (y - view.y) / view.z }; }
  function localPos(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /* ---------------- 手势 ---------------- */
  function nodeIdAt(clientX, clientY, excludeEl) {
    if (excludeEl) excludeEl.style.pointerEvents = 'none';
    var t = document.elementFromPoint(clientX, clientY);
    if (excludeEl) excludeEl.style.pointerEvents = '';
    var g = t && t.closest ? t.closest('g.node') : null;
    return g && gNodes.contains(g) ? g.getAttribute('data-id') : null;
  }
  function setDrop(id) {
    if (gesture && gesture.dropEl) gesture.dropEl.classList.remove('drop');
    if (gesture) { gesture.dropId = id; gesture.dropEl = id ? gNodes.querySelector('g.node[data-id="' + id + '"]') : null; if (gesture.dropEl) gesture.dropEl.classList.add('drop'); }
  }
  function endGesture() {
    if (gesture) { setDrop(null); if (gesture.ghost) gesture.ghost.remove(); if (gesture.kind === 'pan' || gesture.kind === 'pinch') stage.classList.remove('panning'); }
    gesture = null; pointers.clear();
  }
  function onDown(e) {
    if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 某些浏览器不支持 */ }
    if (pointers.size === 2) {                       // 第二根手指：进入双指缩放
      if (gesture && gesture.ghost) gesture.ghost.remove();
      var pts = Array.from(pointers.values());
      gesture = { kind: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), z0: view.z, mid0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, v0: { x: view.x, y: view.y } };
      stage.classList.add('panning');
      return;
    }
    if (pointers.size > 2) return;
    var t = e.target, badge = t.closest ? t.closest('g.badge') : null, g = t.closest ? t.closest('g.node') : null;
    var p = localPos(e);
    if (badge && g) { gesture = { kind: 'badge', id: g.getAttribute('data-id'), x: p.x, y: p.y }; return; }
    if (g) { gesture = { kind: 'node', id: g.getAttribute('data-id'), el: g, x: p.x, y: p.y, moved: false, touch: e.pointerType === 'touch', link: t.closest && t.closest('tspan.link') }; return; }
    gesture = { kind: 'pan', x: p.x, y: p.y, v0: { x: view.x, y: view.y }, moved: false };
    stage.classList.add('panning');
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    var p = localPos(e);
    if (gesture.kind === 'pinch') {
      var pts = Array.from(pointers.values()); if (pts.length < 2) return;
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      var nz = Math.max(0.15, Math.min(4, gesture.z0 * d / Math.max(gesture.d0, 1))), r = stage.getBoundingClientRect();
      var m0 = { x: gesture.mid0.x - r.left, y: gesture.mid0.y - r.top }, m1 = { x: mid.x - r.left, y: mid.y - r.top };
      view.x = m1.x - (m0.x - gesture.v0.x) * nz / gesture.z0; view.y = m1.y - (m0.y - gesture.v0.y) * nz / gesture.z0; view.z = nz;
      applyView(); return;
    }
    if (gesture.kind === 'pan') {
      view.x = gesture.v0.x + (p.x - gesture.x); view.y = gesture.v0.y + (p.y - gesture.y);
      if (Math.hypot(p.x - gesture.x, p.y - gesture.y) > 4) gesture.moved = true;
      applyView(); return;
    }
    if (gesture.kind === 'node') {
      var dist = Math.hypot(p.x - gesture.x, p.y - gesture.y);
      if (!gesture.moved && dist > (gesture.touch ? 10 : 6)) {
        gesture.moved = true;
        if (gesture.id === cur.tree.root.id) { gesture.kind = 'pan'; gesture.v0 = { x: view.x, y: view.y }; stage.classList.add('panning'); return; }   // 拖根节点 = 平移
        gesture.ghost = gesture.el.cloneNode(true); gesture.ghost.classList.add('ghost'); gesture.ghost.removeAttribute('data-id');
        var ring = gesture.ghost.querySelector('.selring'); if (ring) ring.remove();
        gNodes.appendChild(gesture.ghost);
        stage.classList.add('dragging');
      }
      if (gesture.moved && gesture.ghost) {
        var b = cur.layout.byId.get(gesture.id), w = screenToWorld(p.x, p.y);
        gesture.ghost.setAttribute('transform', 'translate(' + (w.x - b.w / 2) + ' ' + (w.y - b.h / 2) + ')');
        var over = nodeIdAt(e.clientX, e.clientY, gesture.ghost);
        if (over && (over === gesture.id || cur.tree.isAncestor(gesture.id, over))) over = null;
        if (over !== gesture.dropId) setDrop(over);
      }
    }
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    if (!gesture) { if (!pointers.size) endGesture(); return; }
    if (gesture.kind === 'pinch') { if (!pointers.size) endGesture(); else { pointers.clear(); endGesture(); } return; }   // 一根抬起就结束，避免抖动
    var g = gesture, dropId = gesture.dropId; endGesture();   // endGesture() clears gesture.dropId, so read it first
    if (g.kind === 'badge') { if (H.onToggle) H.onToggle(g.id); return; }
    if (g.kind === 'pan') { if (!g.moved && H.onBackground) H.onBackground(); return; }
    if (g.kind === 'node') {
      if (g.moved) { if (dropId && H.onDrop) H.onDrop(g.id, dropId); stage.classList.remove('dragging'); return; }
      stage.classList.remove('dragging');
      if (g.link && g.link.getAttribute('data-href') && !g.touch) { openLink(g.link.getAttribute('data-href')); return; }
      var now = Date.now(), dbl = g.touch && lastTap.id === g.id && now - lastTap.t < 380;
      lastTap = { id: g.id, t: now };
      if (dbl) { lastTap.t = 0; if (H.onEdit) H.onEdit(g.id); return; }
      if (H.onSelect) H.onSelect(g.id);
    }
  }
  function openLink(href) { if (!/^(https?:|mailto:)/i.test(href)) return; try { window.open(href, '_blank', 'noopener'); } catch (e) { /* 忽略 */ } }
  function onDbl(e) {
    var g = e.target.closest ? e.target.closest('g.node') : null;
    if (g && H.onEdit) { e.preventDefault(); H.onEdit(g.getAttribute('data-id')); }
  }
  function onWheel(e) {
    e.preventDefault();
    var p = localPos(e);
    if (e.ctrlKey || !e.shiftKey) zoomBy(Math.pow(1.0015, -e.deltaY), p.x, p.y);
    else { view.x -= e.deltaY; applyView(); }
  }
  function cancelAll() { endGesture(); stage.classList.remove('dragging'); }

  function init(svgEl, handlers) {
    svg = svgEl; H = handlers || {}; stage = svg.parentNode;
    world = el('g', { id: 'world' }, svg); gEdges = el('g', { id: 'edges' }, world); gNodes = el('g', { id: 'nodes' }, world);
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', function (e) { pointers.delete(e.pointerId); cancelAll(); });
    svg.addEventListener('dblclick', onDbl);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('blur', cancelAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) cancelAll(); });
  }
  function destroy() { cancelAll(); while (svg && svg.firstChild) svg.removeChild(svg.firstChild); cur = { tree: null, layout: null, opts: {} }; }

  /* ---------------- 导出 ---------------- */
  function toSVGString(opts) {
    opts = opts || {};
    var L = cur.layout; if (!L) return '';
    var pad = 24, w = Math.ceil(L.bbox.w + pad * 2), h = Math.ceil(L.bbox.h + pad * 2);
    var out = el('svg', { xmlns: NS, width: w, height: h, viewBox: [0, 0, w, h].join(' ') });
    var T = theme(), dark = !!cur.opts.dark;
    el('rect', { width: w, height: h, fill: opts.transparent ? 'none' : (dark ? '#141821' : '#ffffff') }, out);
    var g = el('g', { transform: 'translate(' + (pad - L.bbox.x) + ' ' + (pad - L.bbox.y) + ')', 'font-family': F.family }, out);
    var ge = el('g', null, g), gn = el('g', null, g);
    drawInto(ge, gn, L, {});
    var s = new XMLSerializer().serializeToString(out);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + s;
  }
  function toCanvas(scale) {
    scale = scale || 2;
    return new Promise(function (resolve, reject) {
      var s = toSVGString(), L = cur.layout, pad = 24, w = Math.ceil(L.bbox.w + pad * 2), h = Math.ceil(L.bbox.h + pad * 2);
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
        var ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0); resolve(c);
      };
      img.onerror = function () { reject(new Error('SVG 转图片失败')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    });
  }

  root.Canvas = { init: init, render: render, fit: fit, zoomBy: zoomBy, zoomTo: zoomTo, center: center, ensureVisible: ensureVisible, nodeScreenRect: nodeScreenRect,
                  screenToWorld: screenToWorld, toSVGString: toSVGString, toCanvas: toCanvas, measure: measure, view: view, layout: function () { return cur.layout; },
                  destroy: destroy, cancel: cancelAll, clearCache: function () { sizeCache.clear(); } };
})(window);
