/* app-wiring: the shell and the session working together. The undo and redo
 * buttons light up in the top bar (and undo in the phone's thumb bar) from
 * the session's commands, labelled with the step they would take back; a
 * press undoes and the map follows. On a phone a tap on a node selects it,
 * a map chosen in the drawer closes the drawer, and the neighbour that
 * opens when the open map is deleted from the drawer leaves it open. ns.ready
 * resolves only once the first map is laid out and map:rendered was said. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 8000, polling: 50 });
}

function attr(page, sel, name) {
  return page.evaluate(function (a) { var el = document.querySelector(a[0]); return el ? el.getAttribute(a[1]) : undefined; }, [sel, name]);
}

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var page = await t.open();

  t.step('the history buttons come from the session');
  var undoBtn = '#topbar-actions [data-command="history.undo"]';
  var redoBtn = '#topbar-actions [data-command="history.redo"]';
  t.eq(await page.$$eval(undoBtn, function (b) { return b.length; }), 1, 'an undo button in the top bar');
  t.eq(await page.$$eval(redoBtn, function (b) { return b.length; }), 1, 'and a redo button');
  t.eq(await attr(page, undoBtn, 'aria-disabled'), 'true', 'off with nothing to undo');
  t.eq(await attr(page, undoBtn, 'aria-label'), 'Nothing to undo', 'and says so');
  var ids = await page.evaluate(function () {
    var p = window.MindRoot.store.createProject({ name: 'Trip', maps: [{ name: 'Days', text: '# Days\n\n- Monday\n- Tuesday\n' }, { name: 'Bags', text: '# Bags\n\n- Socks\n' }] });
    return { pid: p.id, a: p.maps[0].id, b: p.maps[1].id };
  });
  await until(page, function (a) { var c = window.MindRoot.session.current(); return c && c.mapId === a; }, ids.a);
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    ns.session.apply(ns.doc.addSibling(c.state, '1', 'Wednesday'), { label: 'store.label.editMap' });
  });
  await until(page, function (sel) { var b = document.querySelector(sel); return b && !b.hasAttribute('aria-disabled') && b.getAttribute('aria-label') === 'Undo: edit the map'; }, undoBtn);
  t.check('labelled with the step', true);
  await page.click(undoBtn);
  await until(page, function () { return !/Wednesday/.test(window.MindRoot.session.current().text); });
  t.check('a press undoes', true);
  await until(page, function (sel) { var b = document.querySelector(sel); return b && !b.hasAttribute('aria-disabled') && b.getAttribute('aria-label') === 'Redo: edit the map'; }, redoBtn);
  t.check('redo lights up, labelled', true);
  await page.click(redoBtn);
  await until(page, function () { return /Wednesday/.test(window.MindRoot.session.current().text); });
  t.check('and redo brings it back', true);

  t.step('on a phone: the thumb bar undoes, a tap selects');
  var ctx = await H.context(t, { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  var phone = await ctx.newPage();
  await t.open('', { page: phone });
  var pids = await phone.evaluate(function () {
    var p = window.MindRoot.store.createProject({ name: 'Trip', maps: [{ name: 'Days', text: '# Days\n\n- Monday\n- Tuesday\n' }, { name: 'Bags', text: '# Bags\n\n- Socks\n' }, { name: 'Food', text: '# Food\n\n- Bread\n' }] });
    return { pid: p.id, a: p.maps[0].id, b: p.maps[1].id, c: p.maps[2].id };
  });
  await until(phone, function (a) { var c = window.MindRoot.session.current(); return c && c.mapId === a && window.MindRoot.session.view.visiblePaths().length === 3; }, pids.a);
  await phone.evaluate(function () { return window.MindRoot.session.view.settled(); });
  var thumbUndo = '#thumbbar [data-command="history.undo"]';
  t.eq(await phone.$$eval(thumbUndo, function (b) { return b.length; }), 1, 'undo in the thumb bar');
  var box = await phone.evaluate(function () {
    var r = document.querySelector('#stage .mv-node[data-path="1"] .mv-text').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await phone.touchscreen.tap(box.x, box.y);
  await until(phone, function () { return window.MindRoot.session.selected() === '1'; });
  t.check('a tap on a node selects it', true);
  await phone.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    ns.session.apply(ns.doc.rename(c.state, '1', 'Tue'), { label: 'store.label.editMap' });
  });
  await until(phone, function (sel) { var b = document.querySelector(sel); return b && !b.hasAttribute('aria-disabled') && b.getAttribute('aria-label') === 'Undo: edit the map'; }, thumbUndo);
  await phone.tap(thumbUndo);
  await until(phone, function () { return /- Tuesday\n/.test(window.MindRoot.session.current().text); });
  t.eq(await phone.evaluate(function () { return window.MindRoot.session.selected(); }), '1', 'the thumb bar undoes, and the node stays selected');

  t.step('on a phone: the drawer closes for a chosen map, not for a replaced one');
  await phone.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
  await until(phone, function () { return window.MindRoot.shell.sidebar.isOpen(); });
  await phone.evaluate(function (ids) { window.MindRoot.store.deleteMap(ids.pid, ids.a); }, pids);
  await until(phone, function (b) { var c = window.MindRoot.session.current(); return c && c.mapId === b; }, pids.b);
  t.eq(await phone.evaluate(function () { return window.MindRoot.shell.sidebar.isOpen(); }), true, 'deleting the open map leaves the drawer open');
  await phone.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.c); }, pids);
  await until(phone, function (c) { var x = window.MindRoot.session.current(); return x && x.mapId === c; }, pids.c);
  await until(phone, function () { return !window.MindRoot.shell.sidebar.isOpen(); });
  t.check('choosing a map closes it', true);
  await until(phone, function (want) { return document.title === want; }, 'Food - Trip - MindRoot');
  t.check('the title follows', true);
  await ctx.close();

  t.step('ready waits for the first map to be laid out');
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });
  await page.addInitScript(function () {
    document.addEventListener('DOMContentLoaded', function () {
      var ns = window.MindRoot;
      window.__boot = [];
      ns.bus.on('map:opened', function () { window.__boot.push('opened'); });
      ns.bus.on('map:rendered', function () { window.__boot.push('rendered'); });
      ns.ready.then(function () {
        var g = ns.session.view.geometry();
        window.__boot.push('ready:' + (g && g.order ? g.order.length : 0));
      });
    });
  });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await until(page, function () { return window.__boot && window.__boot.some(function (x) { return /^ready:/.test(x); }); });
  var boot = await page.evaluate(function () { return window.__boot; });
  t.same(boot, ['opened', 'rendered', 'ready:4'], 'opened, rendered, then ready with every node placed');
};
