/* sidebar-drag: rows reordered by dragging. With a mouse, a few pixels of
 * movement lift the row and a line shows where it lands: projects among
 * projects, maps within their project (each one step of undo); a map
 * dragged onto another project is refused and says so; Escape cancels a
 * drag. On a phone the sidebar is a drawer: a map chosen in it opens and
 * closes the drawer, a project tapped only shows its maps, a long press on a row opens its menu (a bottom sheet)
 * and moving on drags the row, and every control in it is finger-sized. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

function center(page, sel) {
  return page.evaluate(function (s) {
    var r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, h: r.height };
  }, sel);
}

function rowSel(key) { return '#sidebar .sb-item[data-key="' + key + '"] > .sb-row'; }

async function drag(page, from, toX, toY, opts) {
  opts = opts || {};
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 3);
  var steps = 8;
  for (var i = 1; i <= steps; i++) await page.mouse.move(from.x + (toX - from.x) * i / steps, from.y + (toY - from.y) * i / steps);
  if (opts.before) await opts.before();
  if (opts.escape) await page.keyboard.press('Escape');
  await page.mouse.up();
}

module.exports = async function (t) {
  var b = await W.boot(t, [
    { name: 'Alpha', maps: [['One', '# One\n'], ['Two', '# Two\n'], ['Three', '# Three\n']] },
    { name: 'Beta', maps: [['Solo', '# Solo\n']] },
    { name: 'Gamma', maps: [['G', '# G\n']] }
  ]);
  var page = b.page;
  var A = b.projects[0], B = b.projects[1], G = b.projects[2];
  await page.evaluate(function (id) { window.MindRoot.sidebar.setExpanded(id, true); }, A.id);
  await until(page, function () { return document.querySelectorAll('#sidebar .sb-item--map').length >= 4; });

  t.step('a project dragged above another');
  var gamma = await center(page, rowSel('p:' + G.id));
  var alpha = await center(page, rowSel('p:' + A.id));
  var line = null;
  await drag(page, gamma, gamma.x, alpha.top + 4, {
    before: async function () {
      line = await page.evaluate(function () {
        var l = document.querySelector('.sb-drop');
        return { shown: !l.hidden, ghost: !!document.querySelector('.sb-ghost'), lifted: document.querySelector('.sb-item[data-dragging]') !== null };
      });
    }
  });
  t.same(line, { shown: true, ghost: true, lifted: true }, 'while dragging: a line, a lifted copy, the row faded');
  await until(page, function () { return window.MindRoot.store.projects()[0].name === 'Gamma'; });
  t.same(await page.evaluate(function () { return window.MindRoot.store.projects().map(function (p) { return p.name; }); }), ['Gamma', 'Alpha', 'Beta'], 'dropped first');
  t.eq(await page.evaluate(function () { return !!document.querySelector('.sb-ghost') || !document.querySelector('.sb-drop').hidden; }), false, 'the drag leaves nothing behind');
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoLabel; }), 'move the project', 'one step');
  await page.keyboard.press('Control+z');
  await until(page, function () { return window.MindRoot.store.projects()[0].name === 'Alpha'; });
  await until(page, function (k) { return document.querySelector('#sidebar .sb-item').getAttribute('data-key') === k; }, 'p:' + A.id);

  t.step('a map dragged within its project');
  var three = await center(page, rowSel('m:' + A.maps[2]));
  var one = await center(page, rowSel('m:' + A.maps[0]));
  await drag(page, three, three.x, one.top + 3);
  await until(page, function (id) { return window.MindRoot.store.project(id).maps[0].name === 'Three'; }, A.id);
  await until(page, function (k) { return document.querySelector('#sidebar .sb-item--map').getAttribute('data-key') === k; }, 'm:' + A.maps[2]);
  t.same(await page.evaluate(function (id) { return window.MindRoot.store.project(id).maps.map(function (m) { return m.name; }); }, A.id), ['Three', 'One', 'Two'], 'Three goes first');

  t.step('a map dragged onto another project is refused');
  var two = await center(page, rowSel('m:' + A.maps[1]));
  var beta = await center(page, rowSel('p:' + B.id));
  var refused = null;
  await drag(page, two, beta.x, beta.y, {
    before: async function () {
      refused = await page.evaluate(function () { return { ghost: document.querySelector('.sb-ghost').hasAttribute('data-refused'), line: !document.querySelector('.sb-drop').hidden }; });
    }
  });
  t.same(refused, { ghost: true, line: false }, 'no line, and the lifted row says no');
  await W.waitToast(page, /moves within its project/);
  t.same(await page.evaluate(function (id) { return window.MindRoot.store.project(id).maps.map(function (m) { return m.name; }); }, A.id), ['Three', 'One', 'Two'], 'nothing moved');

  t.step('Escape cancels a drag');
  var one2 = await center(page, rowSel('m:' + A.maps[0]));
  var three2 = await center(page, rowSel('m:' + A.maps[2]));
  await drag(page, one2, one2.x, three2.top + 2, { escape: true });
  t.same(await page.evaluate(function (id) { return window.MindRoot.store.project(id).maps.map(function (m) { return m.name; }); }, A.id), ['Three', 'One', 'Two'], 'nothing moved');
  t.eq(await page.evaluate(function () { return !!document.querySelector('.sb-ghost'); }), false, 'and nothing is left');

  t.step('a phone: the drawer');
  var ph = await W.boot(t, [
    { name: 'Home', maps: [['Rooms', '# Rooms\n\n- Kitchen\n'], ['Plants', '# Plants\n']] },
    { name: 'Trip', maps: [['Days', '# Days\n\n- Monday\n'], ['Bags', '# Bags\n'], ['Food', '# Food\n']] }
  ], { kind: 'phone' });
  var phone = ph.page;
  var home = ph.projects[0];
  var trip = ph.projects[1];
  t.eq(await phone.evaluate(function () { return window.MindRoot.shell.sidebar.isDrawer() && !window.MindRoot.shell.sidebar.isOpen(); }), true, 'a closed drawer');
  await phone.tap('#sidebar-toggle');
  await until(phone, function () { return window.MindRoot.shell.sidebar.isOpen(); });
  await until(phone, function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return r.left >= -0.5; });
  var sizes = await phone.evaluate(function () {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('#sidebar button:not([tabindex="-1"]), #sidebar [tabindex="0"]'), function (el) {
      if (el.hidden || el.closest('[hidden]')) return;
      var r = el.getBoundingClientRect();
      if (!r.width) return;
      if (r.height < 43.5 || r.width < 43.5) out.push((el.id || el.getAttribute('data-key') || el.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    var rows = Array.prototype.map.call(document.querySelectorAll('#sidebar .sb-row'), function (r) { return Math.round(r.getBoundingClientRect().height); });
    return { small: out, minRow: Math.min.apply(null, rows), more: getComputedStyle(document.querySelector('#sidebar .sb-more')).opacity };
  });
  t.same(sizes.small, [], 'every control at least 44px');
  t.check('rows finger-tall', sizes.minRow >= 44, sizes.minRow);
  t.eq(sizes.more, '1', 'the row menu buttons are visible on touch');
  await W.rest(phone);
  await t.shot('phone-drawer', phone);
  await phone.tap(rowSel('m:' + trip.maps[1]) + ' .sb-name');
  await until(phone, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, trip.maps[1]);
  await until(phone, function () { return !window.MindRoot.shell.sidebar.isOpen(); });
  t.check('a map chosen opens and the drawer closes', true);
  await phone.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
  await until(phone, function () { return window.MindRoot.shell.sidebar.isOpen(); });
  await phone.tap(rowSel('m:' + trip.maps[1]) + ' .sb-name');
  await until(phone, function () { return !window.MindRoot.shell.sidebar.isOpen(); });
  t.check('choosing the map already open closes it too', true);
  await phone.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
  await until(phone, function () { var a = document.activeElement; return a && a.classList.contains('sb-item'); });
  t.eq(await phone.evaluate(function () { return document.activeElement.getAttribute('aria-current'); }), 'page', 'an opened drawer puts the focus on the open map\'s row');
  await phone.keyboard.press('ArrowUp');
  await phone.keyboard.press('Enter');
  await until(phone, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid && !window.MindRoot.shell.sidebar.isOpen(); }, trip.maps[0]);
  await until(phone, function () { return document.activeElement && document.activeElement.classList.contains('mv'); });
  t.check('a map chosen with the keyboard: the drawer closes and the map has the focus', true);

  t.step('a long press opens the row menu as a sheet');
  await phone.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
  await until(phone, function () { return window.MindRoot.shell.sidebar.isOpen(); });
  await until(phone, function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return r.left >= -0.5; });
  var food = await center(phone, rowSel('m:' + trip.maps[2]));
  var cdp = await phone.context().newCDPSession(phone);
  t.eq(await phone.evaluate(function () { return document.querySelectorAll('dialog[open]').length; }), 0, 'two taps of a finger on a row are not a double click (no rename)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: food.x, y: food.y }] });
  await until(phone, function () { return !!document.querySelector('dialog.sheet[open] .menu'); }, null, 3000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  var sheet = await phone.evaluate(function () {
    var d = document.querySelector('dialog.sheet[open]');
    return { title: d.querySelector('.sheet__title').textContent, rows: d.querySelectorAll('.menu__item').length };
  });
  t.eq(sheet.title, 'Food', 'the menu of the row held, as a bottom sheet');
  t.check('with its items', sheet.rows >= 6, sheet.rows);
  t.eq(await phone.evaluate(function (mid) { return window.MindRoot.session.current().mapId === mid; }, trip.maps[0]), true, 'the press did not open the map');
  await phone.keyboard.press('Escape');
  await until(phone, function () { return !document.querySelector('dialog.sheet[open]'); });

  t.step('a long press, then moving, drags the row');
  food = await center(phone, rowSel('m:' + trip.maps[2]));
  var days = await center(phone, rowSel('m:' + trip.maps[0]));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: food.x, y: food.y }] });
  await until(phone, function () { return !!document.querySelector('dialog.sheet[open] .menu'); }, null, 3000);
  for (var k = 1; k <= 8; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: food.x, y: food.y + (days.top + 4 - food.y) * k / 8 }] });
  }
  var during = await phone.evaluate(function () { return { menu: !!document.querySelector('dialog.sheet[open]'), ghost: !!document.querySelector('.sb-ghost') }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  t.same(during, { menu: false, ghost: true }, 'moving closes the menu and lifts the row');
  await until(phone, function (pid) { return window.MindRoot.store.project(pid).maps[0].name === 'Food'; }, trip.id);
  t.check('dropped first', true);
  t.eq(await phone.evaluate(function () { return window.MindRoot.shell.sidebar.isOpen(); }), true, 'the drawer stays open (no map was chosen)');

  t.step('a phone: a project tapped in the drawer shows its maps');
  var before = await W.here(phone);
  t.eq(await phone.evaluate(function (pid) { return document.querySelector('#sidebar .sb-item[data-key="p:' + pid + '"]').getAttribute('aria-expanded'); }, home.id), 'false', 'the other project is folded');
  await phone.tap(rowSel('p:' + home.id) + ' .sb-name');
  await until(phone, function (pid) { return !!document.querySelector('#sidebar .sb-item[data-pid="' + pid + '"][data-key^="m:"]'); }, home.id);
  t.check('its maps appear', true);
  t.eq(await phone.evaluate(function () { return window.MindRoot.shell.sidebar.isOpen(); }), true, 'the drawer stays open');
  t.same(await W.here(phone), before, 'nothing else opened');
  await phone.tap(rowSel('m:' + home.maps[1]) + ' .sb-name');
  await until(phone, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid && !window.MindRoot.shell.sidebar.isOpen(); }, home.maps[1]);
  t.check('then a map of it chosen opens and closes the drawer', true);
  await phone.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
  await until(phone, function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return window.MindRoot.shell.sidebar.isOpen() && r.left >= -0.5; });
  await W.rest(phone);
  var caret = await phone.evaluate(function (pid) {
    var c = document.querySelector('#sidebar .sb-item[data-key="p:' + pid + '"] .sb-caret');
    var r = c.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    function hits(dx, dy) { var el = document.elementFromPoint(x + dx, y + dy); return !!(el && el.closest('.sb-caret') === c); }
    return { up: hits(0, -20), down: hits(0, 20), left: hits(-12, 0), right: hits(20, 0) };
  }, trip.id);
  t.same(caret, { up: true, down: true, left: true, right: true }, 'the caret takes a finger-sized square');
  var wasOpen = await phone.evaluate(function (pid) { return document.querySelector('#sidebar .sb-item[data-key="p:' + pid + '"]').getAttribute('aria-expanded'); }, trip.id);
  await phone.tap(rowSel('p:' + trip.id) + ' .sb-caret');
  await until(phone, function (a) { return document.querySelector('#sidebar .sb-item[data-key="p:' + a.pid + '"]').getAttribute('aria-expanded') !== a.was; }, { pid: trip.id, was: wasOpen });
  t.check('and folds or unfolds the project', true);
  t.eq(await phone.evaluate(function () { return window.MindRoot.shell.sidebar.isOpen(); }), true, 'with the drawer still open');

  t.step('a phone: the closed drawer is fresh as a finger pulls it in');
  await phone.evaluate(function () { window.MindRoot.shell.sidebar.close(); });
  await until(phone, function () { return !window.MindRoot.shell.sidebar.isOpen(); });
  await phone.evaluate(function (a) { window.MindRoot.store.renameMap(a.pid, a.mid, 'Greenhouse'); }, { pid: home.id, mid: home.maps[1] });
  await phone.evaluate(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); });
  t.eq(await phone.evaluate(function (mid) { return document.querySelector('#sidebar .sb-item[data-key="m:' + mid + '"] .sb-name').textContent; }, home.maps[1]), 'Plants', 'closed: not rebuilt');
  /* What the shell does while the drawer follows a finger. */
  await phone.evaluate(function () { document.documentElement.setAttribute('data-sidebar-drag', ''); });
  await until(phone, function (mid) { return document.querySelector('#sidebar .sb-item[data-key="m:' + mid + '"] .sb-name').textContent === 'Greenhouse'; }, home.maps[1]);
  t.check('shown by a finger: built with what changed', true);
  await phone.evaluate(function () { document.documentElement.removeAttribute('data-sidebar-drag'); });
};
