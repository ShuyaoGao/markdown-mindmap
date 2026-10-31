/* localStorage 多文档保存（file:// 下 localStorage 可能不可用：全部 try/catch，失败时退化成内存）。
 *
 *   Store.list()                → [{id, title, updated}]（按更新时间倒序）
 *   Store.load(id)              → {id, title, updated, json, headingLevels} | null
 *   Store.save(doc)             doc = {id?, title, json(tree.toJSON()), headingLevels} → id
 *   Store.remove(id)
 *   Store.prefs() / setPrefs(obj)   主题、布局、面板开关
 */
(function (root) {
  'use strict';
  var CFG = root.APP_CONFIG, mem = {};
  function read(key) {
    try { var s = root.localStorage.getItem(key); if (s) return JSON.parse(s); } catch (e) { /* 不可用或损坏 */ }
    return mem[key] || null;
  }
  function write(key, obj) {
    mem[key] = obj;
    try { root.localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function docs() { var d = read(CFG.STORAGE_KEY); return d && Array.isArray(d.docs) ? d : { docs: [] }; }
  function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function list() { return docs().docs.slice().sort(function (a, b) { return b.updated - a.updated; }).map(function (d) { return { id: d.id, title: d.title, updated: d.updated }; }); }
  function load(id) { var d = docs().docs.filter(function (x) { return x.id === id; })[0]; return d ? JSON.parse(JSON.stringify(d)) : null; }
  function save(doc) {
    var all = docs(), id = doc.id || newId(), rec = { id: id, title: doc.title || '未命名', json: doc.json, headingLevels: doc.headingLevels || 2, updated: Date.now() };
    var i = all.docs.findIndex(function (x) { return x.id === id; });
    if (i >= 0) all.docs[i] = rec; else all.docs.push(rec);
    while (all.docs.length > 50) { all.docs.sort(function (a, b) { return a.updated - b.updated; }); all.docs.shift(); }   // 最多留 50 份
    write(CFG.STORAGE_KEY, all);
    return id;
  }
  function remove(id) { var all = docs(); all.docs = all.docs.filter(function (x) { return x.id !== id; }); write(CFG.STORAGE_KEY, all); }
  function prefs() { return read(CFG.PREF_KEY) || {}; }
  function setPrefs(obj) { var p = prefs(); for (var k in obj) p[k] = obj[k]; write(CFG.PREF_KEY, p); return p; }
  function flag(key, val) { if (val === undefined) { try { return root.localStorage.getItem(key) === '1'; } catch (e) { return !!mem[key]; } } mem[key] = val; try { root.localStorage.setItem(key, val ? '1' : '0'); } catch (e) { /* 忽略 */ } }

  root.Store = { list: list, load: load, save: save, remove: remove, prefs: prefs, setPrefs: setPrefs, flag: flag };
})(typeof window !== 'undefined' ? window : globalThis);
