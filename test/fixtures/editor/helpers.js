/* MindRoot - helpers shared by the editor's e2e suites (editor*, notes*,
 * color*): open the real app with a map of our own, and read back what the
 * person would see - the map's text, the selection, the history's top step,
 * where a node is drawn. Every wait is for a condition, never a guessed
 * time. */
'use strict';

var H = require('../shell/helpers.js');

/* Opens index.html (missing modules of other owners answered empty, see
 * shell/helpers.js), makes a project with the given maps, and waits until
 * the first one is drawn and settled. */
async function boot(t, maps, opts) {
  opts = opts || {};
  var page = opts.page || t.page;
  if (!opts.page) await H.stubMissing(t.context, t);
  await t.open(opts.query || '', { page: page, lang: opts.lang });
  var ids = await page.evaluate(function (list) {
    var ns = window.MindRoot;
    var p = ns.store.createProject({ name: 'Test', maps: list.map(function (m) { return { name: m[0], text: m[1] }; }) });
    return { pid: p.id, mids: p.maps.map(function (m) { return m.id; }) };
  }, maps.map(function (m) { return typeof m === 'string' ? ['Map', m] : m; }));
  await page.waitForFunction(function (mid) {
    var c = window.MindRoot.session.current();
    return c && c.mapId === mid;
  }, ids.mids[0], { timeout: 10000, polling: 50 });
  await settled(page);
  return { page: page, pid: ids.pid, mids: ids.mids, mid: ids.mids[0] };
}

/* Every motion landed, and two frames painted after it (the bars are
 * placed on the frame after a change). */
async function settled(page) {
  await page.evaluate(function () {
    return window.MindRoot.session.view.settled().then(function () {
      return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(); }); }); });
    });
  });
}

async function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 6000, polling: 30 });
}

function text(page) {
  return page.evaluate(function () { var c = window.MindRoot.session.current(); return c ? c.text : null; });
}

function selected(page) {
  return page.evaluate(function () { return window.MindRoot.session.selected(); });
}

function history(page) {
  return page.evaluate(function () {
    var hs = window.MindRoot.store.historyState();
    return { count: hs.undoCount, label: hs.undoLabel, key: hs.undoLabelKey, redo: hs.redoCount };
  });
}

/* The node's box on screen (where it lands), or null. */
function box(page, path) {
  return page.evaluate(function (p) {
    var r = window.MindRoot.session.view.rect(p);
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, bottom: r.bottom, right: r.right } : null;
  }, path);
}

/* The path drawn with these words. */
function pathOf(page, words) {
  return page.evaluate(function (w) {
    var c = window.MindRoot.session.current();
    var flat = c.state.flat;
    for (var i = 0; i < flat.length; i++) if (window.MindRoot.doc.plainText(flat[i]) === w) return flat[i].path;
    return null;
  }, words);
}

async function clickNode(page, path) {
  var b = await box(page, path);
  if (!b) throw new Error('node ' + path + ' is not drawn');
  await page.mouse.click(b.x + Math.min(12, b.w / 2), b.y + Math.min(10, b.h / 2));
  await until(page, function (p) { return window.MindRoot.session.selected() === p; }, path);
}

async function select(page, path) {
  await page.evaluate(function (p) {
    window.MindRoot.session.select(p, { reveal: true, animate: false });
    var v = window.MindRoot.session.view;
    if (v && v.el) v.el.focus({ preventScroll: true });
  }, path);
  await settled(page);
}

function renaming(page) {
  return page.evaluate(function () { return window.MindRoot.editor.renaming(); });
}

/* What the rename fields hold, and where the caret is. */
function fields(page) {
  return page.evaluate(function () {
    var a = document.activeElement;
    var title = document.querySelector('.mv-edit--title');
    var body = document.querySelector('.mv-edit--body');
    var sel = window.getSelection();
    return {
      title: title ? window.MindRoot.editor.readField(title) : null,
      body: body ? window.MindRoot.editor.readField(body) : null,
      focus: a === title ? 'title' : (a === body ? 'body' : (a && a.className) || null),
      chosen: sel ? sel.toString() : ''
    };
  });
}

function visible(page, selector) {
  return page.evaluate(function (s) {
    var el = document.querySelector(s);
    if (!el || el.hidden) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  }, selector);
}

/* Waits until the element has stopped moving (an entrance, a sheet
 * sliding in) and gives its rect. */
async function resting(page, selector) {
  await page.waitForFunction(function (sel) {
    var el = document.querySelector(sel);
    if (!el) return false;
    /* No transition or animation still running on the page (a sheet's
     * slide, a panel's entrance), and the same box twice in a row. */
    var moving = typeof document.getAnimations === 'function' && document.getAnimations().some(function (a) {
      return a.playState === 'running' && !(a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity);
    });
    var r = el.getBoundingClientRect();
    var key = [r.left, r.top, r.width, r.height].join(',');
    var same = el.__restKey === key;
    el.__restKey = key;
    return !moving && same && r.width > 0;
  }, selector, { timeout: 4000, polling: 60 });
  return rectOf(page, selector);
}

function rectOf(page, selector) {
  return page.evaluate(function (s) {
    var el = document.querySelector(s);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  }, selector);
}

/* A length token resolved to px where it applies (inside that element), the
 * way the browser would lay it out: custom properties read back as written
 * ('0.5rem'), so the suites never parse them themselves. */
function tokenPx(page, selector, name) {
  return page.evaluate(function (a) {
    var host = document.querySelector(a.sel) || document.body;
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;display:block;height:0;padding:0;border:0;width:var(' + a.name + ')';
    host.appendChild(probe);
    var v = parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return v;
  }, { sel: selector, name: name });
}

/* A page error or a console error turns the suite red in the runner; the
 * suites also check that nothing was logged while they drove the page. */
module.exports = {
  H: H,
  boot: boot,
  settled: settled,
  until: until,
  text: text,
  selected: selected,
  history: history,
  box: box,
  pathOf: pathOf,
  clickNode: clickNode,
  select: select,
  renaming: renaming,
  fields: fields,
  visible: visible,
  rectOf: rectOf,
  resting: resting,
  tokenPx: tokenPx
};
