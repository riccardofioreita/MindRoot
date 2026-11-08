/* palette: Ctrl+K and Ctrl+F. One list, no motion; the focus never leaves
 * the field (aria-activedescendant), arrows wrap, Enter runs, Escape closes
 * and gives the focus back. Commands come from the registry with their
 * keys, dimmed when they cannot run; projects and maps of every project
 * are there to go to; nodes of the open map join after two letters, and in
 * node mode ('#', or Ctrl+F) of the open map or of every map (Tab). Matching
 * ignores accents and ranks a label that starts with the words first;
 * what was chosen lately leads an empty query. A node chosen in another
 * map opens that map with the node selected. On a phone the rows are
 * finger-sized. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

function state(page) {
  return page.evaluate(function () {
    var d = document.querySelector('dialog.palette[open]');
    if (!d) return null;
    var input = d.querySelector('.palette__input');
    var act = input.getAttribute('aria-activedescendant');
    var el = act && document.getElementById(act);
    return {
      focus: document.activeElement === input,
      active: el ? el.getAttribute('data-key') : null,
      activeLabel: el ? el.querySelector('.palette__label').textContent : null,
      items: window.MindRoot.palette.items().map(function (i) { return i.kind + ':' + i.label; }),
      groups: Array.prototype.map.call(d.querySelectorAll('.palette__group'), function (g) { return g.textContent; }),
      empty: d.querySelector('.palette__empty') ? d.querySelector('.palette__empty').textContent : null,
      placeholder: input.placeholder
    };
  });
}

async function typeQuery(page, text) {
  await page.fill('dialog.palette[open] .palette__input', text);
}

module.exports = async function (t) {
  var b = await W.boot(t, [
    { name: 'Città', maps: [['Café', '# Café\n\n- Questions\n- Answers\n'], ['Notes', '# Notes\n\n- Leek soup\n']] },
    { name: 'Kitchen', maps: [['Recipes', '# Recipes\n\n- Soup\n  - Leek\n- Bread\n']] }
  ]);
  var page = b.page;
  var citta = b.projects[0];
  var kitchen = b.projects[1];
  await page.focus('#stage .mv');

  t.step('Ctrl+K opens it, with no motion, the focus in the field');
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  var s = await state(page);
  t.eq(s.focus, true, 'the field has the focus');
  t.eq(s.placeholder, 'Type a command or the name of a map', 'and says what to type');
  t.check('the first row is active (aria-activedescendant)', !!s.active, s);
  t.same(s.groups, ['Commands'], 'an empty query lists commands');
  var still = await page.evaluate(function () {
    var d = document.querySelector('dialog.palette[open]');
    return { transition: getComputedStyle(d).transitionDuration, animations: d.getAnimations().length, role: d.querySelector('.palette__input').getAttribute('role'), list: d.querySelector('[role=listbox]') !== null };
  });
  t.same(still, { transition: '0s', animations: 0, role: 'combobox', list: true }, 'no transition, a combobox over a listbox');
  var keys = await page.evaluate(function () {
    var row = document.querySelector('.palette__item[data-key="c:sidebar.newMap"]');
    return row ? row.querySelector('kbd').textContent : null;
  });
  t.eq(keys, 'Ctrl+Alt+N', 'commands show their keys, for this machine');

  t.step('accents ignored, the best match first');
  await typeQuery(page, 'cafe');
  await until(page, function () { return window.MindRoot.palette.items().length > 0; });
  s = await state(page);
  t.eq(s.items[0], 'map:Café', 'Café, typed without its accent');
  t.eq(s.active, 'm:' + citta.id + ':' + citta.maps[0], 'and it is the active row');
  t.eq(await page.evaluate(function () { return document.querySelector('.palette__item[aria-selected="true"] mark').textContent; }), 'Café', 'the match is marked on the words as written');
  await typeQuery(page, 'citta');
  await until(page, function () { return window.MindRoot.palette.items()[0] && window.MindRoot.palette.items()[0].kind === 'project'; });
  t.eq((await state(page)).items[0], 'project:Città', 'a project too');
  await typeQuery(page, 'new map');
  await until(page, function () { var i = window.MindRoot.palette.items(); return i[0] && i[0].kind === 'command'; });
  t.eq((await state(page)).items[0], 'command:New map in Kitchen', 'every word, and a live title');
  await typeQuery(page, 'leek');
  await until(page, function () { return window.MindRoot.palette.items().some(function (i) { return i.kind === 'node'; }); });
  t.check('nodes of the open map join after two letters', (await state(page)).items.indexOf('node:Leek') >= 0, (await state(page)).items);
  await typeQuery(page, 'zzzz');
  await until(page, function () { return window.MindRoot.palette.items().length === 0; });
  t.eq((await state(page)).empty, 'Nothing matches "zzzz".', 'says when nothing matches');

  t.step('arrows wrap, Enter runs, the focus comes back');
  await typeQuery(page, 'cafe');
  await until(page, function () { return window.MindRoot.palette.items().length > 0; });
  var n = (await state(page)).items.length;
  await page.keyboard.press('ArrowUp');
  s = await state(page);
  t.eq(s.activeLabel, s.items[n - 1].split(':').slice(1).join(':'), 'Up from the first row goes to the last');
  await page.keyboard.press('ArrowDown');
  t.eq((await state(page)).items[0], 'map:Café', 'Down from the last goes to the first');
  t.eq((await state(page)).focus, true, 'the focus never left the field');
  await page.keyboard.press('Enter');
  await until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, citta.maps[0]);
  t.eq(await page.evaluate(function () { return !!document.querySelector('dialog.palette'); }), false, 'chosen: the palette closes');
  t.check('and the map opens', true);
  t.eq(await page.evaluate(function () { return document.activeElement && document.activeElement.classList.contains('mv'); }), true, 'the focus is back on the map');

  t.step('recents lead an empty query; > is commands only');
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  s = await state(page);
  t.same(s.groups, ['Recent', 'Commands'], 'a group of recent choices');
  t.eq(s.items[0], 'map:Café', 'the map just chosen first');
  await typeQuery(page, '>recipes');
  await until(page, function () { return !!document.querySelector('.palette__empty'); });
  t.eq((await state(page)).empty, 'No command matches "recipes".', 'no maps with >');
  await typeQuery(page, '>redo');
  await until(page, function () { return window.MindRoot.palette.items().length > 0; });
  var redo = await page.evaluate(function () { var i = window.MindRoot.palette.items().filter(function (x) { return x.key === 'c:history.redo'; })[0]; return i && { enabled: i.enabled, dim: document.querySelector('.palette__item[data-key="c:history.redo"]').getAttribute('aria-disabled'), state: document.querySelector('.palette__item[data-key="c:history.redo"] .palette__state').textContent }; });
  t.same(redo, { enabled: false, dim: 'true', state: 'not now' }, 'a command that cannot run now is there, dimmed');
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('dialog.palette'); });
  t.eq(await page.evaluate(function () { return document.activeElement && document.activeElement.classList.contains('mv'); }), true, 'Escape closes, the focus goes back');

  t.step('a command runs from it');
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  await typeQuery(page, 'trash open');
  await until(page, function () { var i = window.MindRoot.palette.items(); return i[0] && i[0].key === 'c:trash.open'; });
  await page.keyboard.press('Enter');
  await until(page, function () { return window.MindRoot.trash.isOpen(); });
  t.check('Enter ran "Open the trash"', true);
  await page.keyboard.press('Escape');

  t.step('nodes: # and Ctrl+F, this map or every map');
  await page.focus('#stage .mv');
  await page.keyboard.press('Control+f');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  s = await state(page);
  t.eq(s.placeholder, 'Search for a node', 'Ctrl+F searches nodes');
  t.same(s.items, ['node:Café', 'node:Questions', 'node:Answers'], 'the open map\'s nodes, in order');
  var scope = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.palette__scope .seg__opt'), function (b) { return b.textContent + ':' + b.getAttribute('aria-checked'); }); });
  t.same(scope, ['This map:true', 'Every map:false'], 'this map first');
  await typeQuery(page, 'leek');
  await until(page, function () { return !!document.querySelector('.palette__empty'); });
  await page.keyboard.press('Tab');
  await until(page, function () { return window.MindRoot.palette.items().length === 2; });
  s = await state(page);
  t.same(s.items, ['node:Leek', 'node:Leek soup'], 'Tab looks in every map: the word that starts the label first');
  t.check('each says where it is', await page.evaluate(function () { return document.querySelector('.palette__item[aria-selected="true"] .palette__sub').textContent; }) === 'Recipes / Soup');
  await page.keyboard.press('Enter');
  await until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid && window.MindRoot.session.selected() === '0.0'; }, kitchen.maps[0]);
  t.check('choosing it opens its map with the node selected', true);
  await until(page, function () { return document.activeElement && document.activeElement.classList.contains('mv'); });
  t.check('the map has the focus: the next key acts on the node', true);
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  await typeQuery(page, '#bread');
  await until(page, function () { var i = window.MindRoot.palette.items(); return i.length === 1 && i[0].label === 'Bread'; });
  t.eq((await state(page)).placeholder, 'Search for a node', '# searches nodes');
  await page.hover('.palette__item[data-key$=":1"]');
  await page.click('.palette__item[data-key$=":1"]');
  await until(page, function () { return window.MindRoot.session.selected() === '1'; });
  t.check('a click chooses too', true);
  await page.evaluate(function () { var v = window.MindRoot.session.view; v.setCamera({ x: 0, y: 0, k: 0.15 }); });
  await page.keyboard.press('Control+f');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  await typeQuery(page, 'leek');
  await until(page, function () { return window.MindRoot.palette.items().length >= 1; });
  await page.keyboard.press('Enter');
  await until(page, function () { return window.MindRoot.session.selected() === '0.0'; });
  await page.waitForTimeout(400);
  var read = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var fs = parseFloat(getComputedStyle(v.nodeEl('0.0').querySelector('.mv-title')).fontSize);
    var r = v.rect('0.0');
    return { px: fs * v.camera().k, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  });
  t.check('a node found on a map shown tiny comes in at a size that can be read', read.px >= 10 && read.inside, read);

  t.step('Ctrl+K finds nodes of every map; a node is found by its own words, not by the branch above it');
  await page.evaluate(function (pid) { var S = window.MindRoot.store; S.setActive(pid, S.project(pid).maps[0].id); }, citta.id);
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  await typeQuery(page, 'leek');
  await until(page, function () { return window.MindRoot.palette.items().some(function (i) { return i.kind === 'node'; }); });
  var kinds = await page.evaluate(function () { return window.MindRoot.palette.items().filter(function (i) { return i.kind === 'node'; }).map(function (i) { return i.label; }); });
  t.same(kinds.sort(), ['Leek', 'Leek soup'], 'the nodes of the other maps are there');
  await typeQuery(page, '#soup');
  await until(page, function () { return window.MindRoot.palette.items().length > 0 || !!document.querySelector('.palette__empty'); });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+f');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  await page.keyboard.press('Tab');
  await typeQuery(page, 'soup');
  await until(page, function () { return window.MindRoot.palette.items().length > 0; });
  t.same((await page.evaluate(function () { return window.MindRoot.palette.items().map(function (i) { return i.label; }); })).sort(), ['Leek soup', 'Soup'], 'Leek, under Soup, is not listed for "soup"');
  t.eq(await page.evaluate(function () { return !!document.querySelector('.palette__list .palette__empty'); }), false, 'and what is said when nothing matches is never inside the list');
  await page.keyboard.press('Escape');

  t.step('on a phone');
  var ph = await W.boot(t, [{ name: 'Trip', maps: [['Days', '# Days\n\n- Monday\n- Tuesday\n']] }], { kind: 'phone' });
  var phone = ph.page;
  await phone.evaluate(function () { window.MindRoot.commands.run('palette.open'); });
  await until(phone, function () { return !!document.querySelector('dialog.palette[open]'); });
  await phone.fill('dialog.palette[open] .palette__input', 'tue');
  await until(phone, function () { return window.MindRoot.palette.items().length > 0; });
  var fit = await phone.evaluate(function () {
    var d = document.querySelector('dialog.palette[open]').getBoundingClientRect();
    var rows = Array.prototype.map.call(document.querySelectorAll('.palette__item'), function (r) { return Math.round(r.getBoundingClientRect().height); });
    return { inside: d.left >= 0 && d.right <= innerWidth && d.top >= 0, minRow: Math.min.apply(null, rows), font: parseFloat(getComputedStyle(document.querySelector('.palette__input')).fontSize) };
  });
  t.eq(fit.inside, true, 'on screen');
  t.check('rows finger-sized', fit.minRow >= 44, fit);
  t.check('the field does not zoom iOS (16px or more)', fit.font >= 16, fit);
  await W.rest(phone);
  await t.shot('phone', phone);
  await phone.tap('.palette__item[data-key$=":1"]');
  await until(phone, function () { return window.MindRoot.session.selected() === '1'; });
  t.check('a tap chooses', true);

  t.step('house style of the strings');
  var copy = await W.copyCheck(page, ['palette']);
  t.check('strings registered', copy.count > 30, copy.count);
  t.same([copy.onlyEn, copy.onlyIt, copy.bang, copy.dash, copy.emoji], [[], [], [], [], []], 'both languages, no exclamation marks, em-dashes or emoji');
};
