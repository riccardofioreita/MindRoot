/* workspace-help: the help sheet (F1, or ?) is written from the command
 * registry, so it lists every command there is - with every key it answers
 * to, for this machine - grouped as the registry groups them; then the
 * drawing keys the drawing editor reports, the Markdown a map is written
 * in and the touch gestures. A search filters it all, ignoring accents;
 * Escape clears the search, then closes. A language switch rewrites it in
 * place. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

module.exports = async function (t) {
  var b = await W.boot(t, [{ name: 'Garden', maps: [['Beds', '# Beds\n\n- North\n']] }]);
  var page = b.page;

  t.step('F1 opens it');
  await page.focus('#stage .mv');
  await page.keyboard.press('F1');
  await until(page, function () { return !!document.querySelector('.ws-help'); });
  var head = await page.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return { title: s.querySelector('.sheet__title').textContent, focus: document.activeElement.classList.contains('ws-search') };
  });
  t.eq(head.title, 'How to use MindRoot', 'titled');
  t.eq(head.focus, true, 'the search has the focus');

  t.step('every registered command is there');
  var listed = await page.evaluate(function () {
    var C = window.MindRoot.commands;
    var want = C.all().filter(function (c) { return c.showInHelp !== false; });
    var missing = [];
    var wrongKeys = [];
    want.forEach(function (c) {
      var row = document.querySelector('.ws-help__row[data-command="' + c.id + '"]');
      if (!row) { missing.push(c.id); return; }
      var title = row.querySelector('.ws-help__title').textContent;
      if (title !== C.label(c.id)) missing.push(c.id + ' (label ' + title + ')');
      var kbd = Array.prototype.map.call(row.querySelectorAll('kbd'), function (k) { return k.textContent; });
      var expect = (c.keys || []).map(function (k) { return C.keysLabel(k); });
      if (JSON.stringify(kbd) !== JSON.stringify(expect)) wrongKeys.push(c.id + ': ' + kbd.join(',') + ' vs ' + expect.join(','));
    });
    var groups = Array.prototype.map.call(document.querySelectorAll('.ws-help__section[data-section^="help-g-"] .ws-section__title'), function (h) { return h.textContent; });
    return { count: want.length, missing: missing, wrongKeys: wrongKeys, groups: groups };
  });
  t.check('a good many commands', listed.count > 40, listed.count);
  t.same(listed.missing, [], 'every command listed, by its label');
  t.same(listed.wrongKeys, [], 'with every key it answers to');
  t.check('grouped as the registry groups them', listed.groups[0] === 'History' && listed.groups.indexOf('Node') > 0 && listed.groups.indexOf('Help') > 0, listed.groups);
  var keysOf = await page.evaluate(function () {
    var r = document.querySelector('.ws-help__row[data-command="history.redo"]');
    return Array.prototype.map.call(r.querySelectorAll('kbd'), function (k) { return k.textContent; });
  });
  t.same(keysOf, ['Ctrl+Shift+Z', 'Ctrl+Y'], 'keys written for this machine');
  var parts = await page.evaluate(function () {
    function rows(id) { var s = document.querySelector('[data-section="' + id + '"]'); return s ? s.querySelectorAll('.ws-help__row').length : 0; }
    return { ink: rows('help-ink'), md: rows('help-md'), touch: rows('help-touch'), tree: rows('help-tree'), nb: rows('help-notebooks'), inkWant: window.MindRoot.ink ? window.MindRoot.ink.shortcuts().length : 0 };
  });
  t.eq(parts.ink, parts.inkWant, 'the drawing keys, from the drawing editor');
  t.eq(parts.md, 14, 'the Markdown of a map');
  t.eq(parts.touch, 10, 'the touch gestures (the map\'s and a notebook\'s)');
  t.eq(parts.nb, 8, 'how notebooks work: the board, a node\'s drawing, settings, ink, pages, turning a page, export, files');
  t.eq(parts.tree, 1, 'the keys of the projects list');

  t.step('search');
  await page.fill('.ws-help .ws-search', 'trash');
  await until(page, function () { return !document.querySelector('.ws-help__row[data-command="history.undo"]:not([hidden])'); });
  var found = await page.evaluate(function () {
    return Array.prototype.filter.call(document.querySelectorAll('.ws-help__row'), function (r) { return !r.hidden && !r.closest('[hidden]'); })
      .map(function (r) { return r.getAttribute('data-command') || r.querySelector('.ws-help__title').textContent; });
  });
  t.check('only what matches', found.indexOf('trash.open') >= 0 && found.indexOf('history.undo') < 0, found);
  await page.fill('.ws-help .ws-search', 'markdòwn zebra');
  await until(page, function () { return !document.querySelector('.ws-help .ws-note').hidden; });
  t.eq(await page.textContent('.ws-help .ws-note'), 'Nothing in the help matches "markdòwn zebra".', 'says when nothing matches');
  await page.fill('.ws-help .ws-search', 'markdòwn');
  await until(page, function () { return document.querySelector('.ws-help .ws-note').hidden; });
  t.check('accents ignored', true);
  await page.keyboard.press('Escape');
  t.eq(await page.inputValue('.ws-help .ws-search'), '', 'Escape clears the search first');
  t.eq(await page.evaluate(function () { return window.MindRoot.help.isOpen(); }), true, 'the sheet stays');
  await page.keyboard.press('Escape');
  await until(page, function () { return !window.MindRoot.help.isOpen(); });
  t.check('then closes', true);

  t.step('? opens it too; a language switch rewrites it');
  await page.focus('#stage .mv');
  await page.keyboard.press('Shift+Slash');
  await until(page, function () { return window.MindRoot.help.isOpen(); });
  t.check('? opens the help', true);
  await page.evaluate(function () { window.MindRoot.i18n.setLang('it'); });
  await until(page, function () { return document.querySelector('dialog.sheet[open] .sheet__title').textContent === 'Come si usa MindRoot'; });
  var itHelp = await page.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return { first: s.querySelector('.ws-help__section .ws-section__title').textContent, undo: s.querySelector('.ws-help__row[data-command="history.undo"] .ws-help__title').textContent, shift: s.querySelector('.ws-help__row[data-command="history.redo"] kbd').textContent };
  });
  t.same(itHelp, { first: 'Cronologia', undo: 'Annulla', shift: 'Ctrl+Maiusc+Z' }, 'in Italian, keys included');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('en'); });
  await page.keyboard.press('Escape');

  t.step('on a phone');
  var ph = await (await W.context(t, 'phone')).newPage();
  await t.open('', { page: ph });
  await ph.evaluate(function () { window.MindRoot.commands.run('help.open'); });
  await until(ph, function () { return !!document.querySelector('.ws-help'); });
  var phone = await ph.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return { place: s.getAttribute('data-place'), wide: document.scrollingElement.scrollWidth <= innerWidth, rowsInside: Array.prototype.every.call(s.querySelectorAll('.ws-help__row'), function (r) { var b = r.getBoundingClientRect(); return b.right <= innerWidth + 0.5; }) };
  });
  t.same(phone, { place: 'bottom', wide: true, rowsInside: true }, 'a bottom sheet, nothing wider than the screen');
  t.eq(await ph.evaluate(function () { return document.querySelector('.ws-help .ws-help__section').getAttribute('data-section'); }), 'help-touch', 'on a touch screen the gestures come first');
  await ph.keyboard.press('Escape');
  await until(ph, function () { return !document.querySelector('.ws-help'); });
  await ph.tap('#sidebar-toggle');
  await until(ph, function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return window.MindRoot.shell.sidebar.isOpen() && r.left >= -0.5; });
  await W.rest(ph);
  await ph.tap('#sb-help');
  await until(ph, function () { return !!document.querySelector('.ws-help'); });
  t.eq(await ph.evaluate(function () { var a = document.activeElement; return a && a.matches('dialog.sheet') ? 'sheet' : (a && a.className); }), 'sheet',
    'opened by a finger: the sheet has the focus, not the search (no keyboard over it)');
  await ph.keyboard.press('Escape');
  await until(ph, function () { return !document.querySelector('.ws-help'); });
  await ph.keyboard.press('F1');
  await until(ph, function () { return !!document.querySelector('.ws-help'); });
  t.eq(await ph.evaluate(function () { return document.activeElement.classList.contains('ws-search'); }), true, 'opened by F1 on a keyboard: straight into the search');
};
