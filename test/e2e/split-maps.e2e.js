/* split-maps: branches turned into maps of their own in the project, from
 * the real app. The node menu's "Turn the branch into a map" and the
 * central node's "Split the branches into maps": the new maps appear in the
 * project, the branch stays as a [[link]] that opens its map, the new map's
 * note links back and that link opens the source map (from the node's
 * links and from the note bubble). One undo step takes it all back. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Gym app\n\n- Athlete\n  - Weight history\n  - QR check-in\n- Trainer\n  - Templates\n- Admin\n  - KPI dashboard\n';

module.exports = async function (t) {
  var s = await E.boot(t, [['Gym app', MAP]]);
  var page = s.page;
  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function maps() { return ev(function (pid) { return window.MindRoot.store.project(pid).maps.map(function (m) { return m.name; }); }, s.pid); }
  function current() { return ev(function () { var c = window.MindRoot.session.current(); return c ? c.map.name : null; }); }

  t.step('one branch, from the node menu');
  await E.select(page, '0');
  var menu = await ev(function () {
    window.MindRoot.commands.run('node.menu', { source: 'key' });
    return Array.prototype.map.call(document.querySelectorAll('[role="menuitem"]'), function (el) { return el.textContent.trim(); });
  });
  t.check('the node menu offers it', menu.some(function (x) { return x.indexOf('Turn the branch into a map') >= 0; }), menu);
  await page.keyboard.press('Escape');
  await E.select(page, '0');
  t.eq(await ev(function () { return window.MindRoot.commands.run('node.toMap', { source: 'palette' }); }), true, 'the command runs');
  t.same(await maps(), ['Gym app', 'Athlete'], 'a new map in the project, after the source');
  t.eq(await current(), 'Gym app', 'the source map stays open');
  t.check('the branch is a link now', /^- \[\[Athlete\]\]$/m.test(await E.text(page)), await E.text(page));

  t.step('the link opens the new map');
  await E.select(page, '0');
  await ev(function () { window.MindRoot.commands.run('node.openLink', { source: 'palette' }); });
  await E.until(page, function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Athlete'; });
  t.check('the children came along', /Weight history/.test(await E.text(page)) && /QR check-in/.test(await E.text(page)), await E.text(page));

  t.step('the link in the note leads back');
  t.eq(await ev(function () { return window.MindRoot.doc.linksOf(window.MindRoot.session.current().state, '').map(function (l) { return l.kind + ':' + l.href; }).join(); }), 'map:Gym app', 'the root counts the note\'s link as its own');
  await ev(function () { window.MindRoot.notes.open('', 'node'); });
  await E.until(page, function () { var el = document.querySelector('.note-bubble'); return el && !el.hidden; });
  t.eq(await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.note-bubble .note-links__link'), function (b) { return b.textContent; }).join(); }), 'Gym app', 'the bubble shows the link');
  await page.click('.note-bubble .note-links__link');
  await E.until(page, function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Gym app'; });
  t.eq(await current(), 'Gym app', 'a press on it opens the source map');

  t.step('every branch at once, one undo');
  await E.settled(page);
  await E.select(page, '');
  t.eq(await ev(function () { return window.MindRoot.commands.run('map.splitBranches', { source: 'palette' }); }), true, 'the command runs');
  t.same(await maps(), ['Gym app', 'Trainer', 'Admin', 'Athlete'], 'one map per branch; the branch that is already a link is left alone');
  t.eq((await E.history(page)).label, 'turn 2 branches into maps', 'one step, named');
  await ev(function () { window.MindRoot.store.undo(); });
  t.same(await maps(), ['Gym app', 'Athlete'], 'one undo takes them all back');
};
