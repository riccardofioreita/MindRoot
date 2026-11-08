/* sidebar: the projects and maps tree on a desktop, by keyboard alone and
 * by mouse. One Tab stop; arrows, Home/End and letters move; Right and Left
 * open and close a project; Enter opens a map; F2 renames; Delete sends a
 * map to the trash with an Undo toast and gives the focus to its neighbour;
 * Alt+arrows move a row (one undo step); the menu key and Shift+F10 open
 * the row's menu, and Escape gives the focus back. With the mouse: the
 * caret folds without switching, a project row switches, a double click
 * renames, a right click opens the menu; the new project dialog starts
 * empty or from a template with or without its content; projects are
 * renamed, duplicated, made templates and deleted (asked first, undoable).
 * The footer's trash badge counts and bumps. Strings in house style. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var BEDS = '# Beds\n\n- North\n  - Lettuce\n- South\n';
var TOOLS = '# Tools\n\n- Spade\n- Rake\n';
var SEEDS = '# Seeds\n\n- Beans\n';
var RECIPES = '# Recipes\n\n- Soup\n  - Leek\n- Bread\n';

function rows(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#sidebar .sb-item'), function (li) {
      return li.getAttribute('data-key').charAt(0) + ':' + (li.querySelector(':scope > .sb-row .sb-name') || {}).textContent;
    });
  });
}

function focused(page) {
  return page.evaluate(function () {
    var a = document.activeElement;
    if (!a || !a.classList.contains('sb-item')) return a ? a.tagName + '#' + a.id : null;
    return a.getAttribute('data-key').charAt(0) + ':' + a.querySelector(':scope > .sb-row .sb-name').textContent;
  });
}

function mapNames(page, pid) {
  return page.evaluate(function (id) { return window.MindRoot.store.project(id).maps.map(function (m) { return m.name; }); }, pid);
}

/* The tree is rebuilt on its next frame after a store change, and the
 * focus follows then: wait for it, then say what it is. */
async function focusIs(page, want, t, name) {
  await until(page, function (w) {
    var a = document.activeElement;
    if (!a || !a.classList.contains('sb-item')) return false;
    return a.getAttribute('data-key').charAt(0) + ':' + a.querySelector(':scope > .sb-row .sb-name').textContent === w;
  }, want).catch(function () {});
  t.eq(await focused(page), want, name);
}

async function press(page, key, expectFocus, t, name) {
  await page.keyboard.press(key);
  if (expectFocus) await focusIs(page, expectFocus, t, name || (key + ' -> ' + expectFocus));
}

module.exports = async function (t) {
  var b = await W.boot(t, [
    { name: 'Garden', description: 'Vegetables and flowers', maps: [['Beds', BEDS], ['Tools', TOOLS], ['Seeds', SEEDS]] },
    { name: 'Kitchen', maps: [['Recipes', RECIPES]] }
  ]);
  var page = b.page;
  var garden = b.projects[0];
  var kitchen = b.projects[1];

  t.step('the tree');
  await until(page, function () { return document.querySelectorAll('#sidebar .sb-item').length === 4; });
  t.same(await rows(page), ['p:Garden', 'p:Kitchen', 'm:Recipes', 'n:New map'], 'projects, the open one unfolded with its maps and a new-map row');
  var tree = await page.evaluate(function () {
    var t = document.querySelector('#sidebar [role=tree]');
    var g = document.querySelector('[data-key^="p:"][aria-expanded="false"]');
    var cur = document.querySelector('.sb-item[aria-current="page"]');
    return {
      label: t.getAttribute('aria-labelledby') && document.getElementById(t.getAttribute('aria-labelledby')).textContent,
      folded: g && g.querySelector('.sb-name').textContent,
      current: cur && cur.querySelector('.sb-name').textContent,
      meta: document.querySelector('[data-key^="p:"] .sb-meta').textContent,
      stops: Array.prototype.filter.call(document.querySelectorAll('#sidebar .sb-item'), function (r) { return r.tabIndex === 0; }).length,
      title: document.querySelector('[data-key^="p:"] > .sb-row').getAttribute('title'),
      desc: Array.prototype.map.call(document.querySelectorAll('[data-key^="p:"] .sb-desc'), function (e) { return e.textContent; })
    };
  });
  t.eq(tree.label, 'Projects', 'a tree named by its heading');
  t.eq(tree.folded, 'Garden', 'the other project is folded');
  t.eq(tree.current, 'Recipes', 'the open map is aria-current');
  t.eq(tree.meta, '3 maps, 9 nodes', 'counts under the project');
  t.eq(tree.title, 'Garden - Vegetables and flowers', 'the description in the tooltip');
  t.same(tree.desc, ['Vegetables and flowers'], 'and shown under the name, where a finger sees it too');
  t.eq(tree.stops, 1, 'one Tab stop');

  t.step('keyboard only');
  await page.focus('#sb-io');
  await press(page, 'Tab', 'm:Recipes', t, 'Tab reaches the tree on the open map');
  await press(page, 'ArrowUp', 'p:Kitchen', t);
  await press(page, 'ArrowUp', 'p:Garden', t);
  await press(page, 'ArrowUp', 'p:Garden', t, 'Up stops at the top');
  await page.keyboard.press('ArrowRight');
  await until(page, function () { return document.querySelector('[data-key^="p:"]').getAttribute('aria-expanded') === 'true'; });
  t.same(await rows(page), ['p:Garden', 'm:Beds', 'm:Tools', 'm:Seeds', 'n:New map', 'p:Kitchen', 'm:Recipes', 'n:New map'], 'Right unfolds a project');
  await focusIs(page, 'p:Garden', t, 'and the focus stays on it');
  t.eq(await page.evaluate(function (id) { return window.MindRoot.prefs.get('expanded')[id]; }, garden.id), true, 'remembered in prefs.expanded');
  await press(page, 'ArrowRight', 'm:Beds', t, 'Right again goes to its first map');
  await press(page, 'ArrowDown', 'm:Tools', t);
  await page.keyboard.press('Enter');
  await until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, garden.maps[1]);
  t.check('Enter opens the map', true);
  await focusIs(page, 'm:Tools', t, 'and the focus stays in the tree');
  await until(page, function () { var c = document.querySelector('.sb-item[aria-current="page"] .sb-name'); return c && c.textContent === 'Tools'; });
  t.check('now the current one', true);
  await until(page, function () { return document.querySelectorAll('#sidebar .sb-item').length === 6; });
  t.same(await rows(page), ['p:Garden', 'm:Beds', 'm:Tools', 'm:Seeds', 'n:New map', 'p:Kitchen'], 'the project left behind folds (only the open one unfolds by itself)');
  await press(page, 'End', 'p:Kitchen', t, 'End: the last row');
  await press(page, 'Home', 'p:Garden', t, 'Home: the first row');
  await press(page, 'k', 'p:Kitchen', t, 'a letter jumps to the row it starts');
  await page.keyboard.press('ArrowRight');
  await until(page, function () { return document.querySelectorAll('#sidebar .sb-item').length === 8; });
  await press(page, 'ArrowLeft', 'p:Kitchen', t, 'Left on an unfolded project');
  await until(page, function () { return document.querySelectorAll('#sidebar .sb-item').length === 6; });
  t.same(await rows(page), ['p:Garden', 'm:Beds', 'm:Tools', 'm:Seeds', 'n:New map', 'p:Kitchen'], 'folds it');
  await press(page, 'ArrowUp', 'n:New map', t);
  await press(page, 'ArrowLeft', 'p:Garden', t, 'Left on a map row goes to its project');
  await page.keyboard.press('Shift+F10');
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('.menu:not([hidden])'); });
  await focusIs(page, 'p:Garden', t, 'Shift+F10 then Escape: the keys are back on the row, not on its hidden button');
  await press(page, 'ArrowDown', 'm:Beds', t, 'and the arrows go on working');
  await press(page, 'ArrowUp', 'p:Garden', t);

  t.step('F2 renames, the focus comes back');
  await press(page, 'ArrowDown', 'm:Beds', t);
  await press(page, 'ArrowDown', 'm:Tools', t);
  await page.keyboard.press('F2');
  await until(page, function () { var i = document.querySelector('dialog.dialog[open] input'); return i && document.activeElement === i; });
  t.eq(await page.inputValue('dialog.dialog[open] input'), 'Tools', 'the rename box holds the name');
  await page.keyboard.type('Shed tools');
  await page.keyboard.press('Enter');
  await until(page, function (id) { return window.MindRoot.store.project(id).maps[1].name === 'Shed tools'; }, garden.id);
  await press(page, 'Shift', 'm:Shed tools', t, 'renamed, and the focus is back on the row');
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoLabel; }), 'rename the map', 'one step');

  t.step('Delete sends the map to the trash');
  await page.keyboard.press('Delete');
  await until(page, function (id) { return window.MindRoot.store.project(id).maps.length === 2; }, garden.id);
  await W.waitToast(page, /Shed tools is in the trash/);
  t.check('with an Undo toast', await page.evaluate(function () { return !!document.querySelector('.toast:not([hidden]) .toast__action'); }));
  await focusIs(page, 'm:Seeds', t, 'the focus goes to its neighbour');
  t.eq(await page.evaluate(function (id) { return window.MindRoot.store.project(id).trash[0].kind; }, garden.id), 'map', 'it is in the trash');
  await until(page, function () { return document.querySelector('#sb-trash .sb-badge').textContent === '1'; });
  t.check('the trash badge counts it', true);
  await page.click('.toast:not([hidden]) .toast__action');
  await until(page, function (id) { return window.MindRoot.store.project(id).maps.length === 3; }, garden.id);
  t.same(await mapNames(page, garden.id), ['Beds', 'Shed tools', 'Seeds'], 'Undo brings it back in its place');
  await until(page, function () { return document.querySelector('#sb-trash .sb-badge').hidden; });
  t.check('and the badge empties', true);

  t.step('Alt+arrows move a row');
  await page.focus('#sidebar .sb-item[data-key="m:' + garden.maps[1] + '"]');
  await page.keyboard.press('Alt+ArrowDown');
  await until(page, function (id) { return window.MindRoot.store.project(id).maps[2].name === 'Shed tools'; }, garden.id);
  t.same(await mapNames(page, garden.id), ['Beds', 'Seeds', 'Shed tools'], 'down one');
  await focusIs(page, 'm:Shed tools', t, 'the focus moves with it');
  await page.keyboard.press('Alt+ArrowDown');
  t.same(await mapNames(page, garden.id), ['Beds', 'Seeds', 'Shed tools'], 'not past the end');
  await page.keyboard.press('Control+z');
  await until(page, function (id) { return window.MindRoot.store.project(id).maps[1].name === 'Shed tools'; }, garden.id);
  t.check('one undo step puts it back', true);
  await page.focus('#sidebar .sb-item[data-key="p:' + kitchen.id + '"]');
  await page.keyboard.press('Alt+ArrowUp');
  await until(page, function () { return window.MindRoot.store.projects()[0].name === 'Kitchen'; });
  await focusIs(page, 'p:Kitchen', t, 'a project moves among projects');
  await page.keyboard.press('Control+z');
  await until(page, function () { return window.MindRoot.store.projects()[0].name === 'Garden'; });

  t.step('the menu key, Shift+F10, Escape');
  await page.focus('#sidebar .sb-item[data-key="m:' + garden.maps[0] + '"]');
  await page.keyboard.press('ContextMenu');
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  var menu = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__label'), function (l) { return l.textContent; }); });
  t.same(menu, ['Open', 'Rename', 'Duplicate', 'The copies', 'Import its branches into the open map', 'Move up', 'Move down', 'Delete the map'], 'the map menu');
  t.eq(await page.evaluate(function () { return document.activeElement && document.activeElement.textContent; }), 'Open', 'opened from the keyboard: the first row has the focus');
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('.menu:not([hidden])'); });
  await until(page, function () { var a = document.activeElement; return a && a.closest && !!a.closest('.sb-item'); });
  t.check('Escape closes it and the focus is back in the row', true);
  /* The tree rebuilt under the open menu (another map renamed): the
   * button the menu came from is gone, the row is found by its key. */
  await page.focus('#sidebar .sb-item[data-key="m:' + garden.maps[0] + '"]');
  await page.keyboard.press('ContextMenu');
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  await page.evaluate(function (a) {
    window.__oldRow = document.querySelector('#sidebar .sb-item[data-key="m:' + a.mid + '"]');
    window.MindRoot.store.renameMap(a.pid, a.other, 'Seed bank');
  }, { pid: garden.id, mid: garden.maps[0], other: garden.maps[2] });
  await until(page, function () { return !window.__oldRow.isConnected; });
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('.menu:not([hidden])'); });
  await focusIs(page, 'm:Beds', t, 'a tree rebuilt under the menu: Escape still gives the row the focus');
  await page.evaluate(function (a) { delete window.__oldRow; window.MindRoot.store.renameMap(a.pid, a.other, 'Seeds'); }, { pid: garden.id, other: garden.maps[2] });
  await until(page, function () { return !!Array.prototype.some.call(document.querySelectorAll('#sidebar .sb-name'), function (n) { return n.textContent === 'Seeds'; }); });
  await page.focus('#sidebar .sb-item[data-key="p:' + garden.id + '"]');
  await page.keyboard.press('Shift+F10');
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  var pmenu = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__label'), function (l) { return l.textContent; }); });
  var media = await page.evaluate(function () { return window.MindRoot.commands.has('media.panel'); });
  t.same(pmenu, ['New map', 'Rename and describe', 'Duplicate', 'Use as a template', 'Import its branches into the open map', 'Export as ZIP', 'Export as JSON']
    .concat(media ? ['Images and drawings'] : []).concat(['Trash (0)', 'Move up', 'Move down', 'Delete the project']), 'the project menu');
  await page.keyboard.press('Escape');

  t.step('the mouse: caret, rows, double click, right click');
  var was = await W.here(page);
  await page.evaluate(function (pid) { window.MindRoot.store.setActive(pid); }, garden.id);
  await until(page, function (pid) { var c = window.MindRoot.session.current(); return c && c.projectId === pid; }, garden.id);
  was = await W.here(page);
  await page.click('#sidebar .sb-item[data-key="p:' + kitchen.id + '"] .sb-caret');
  await until(page, function () { return document.querySelectorAll('#sidebar .sb-item').length === 8; });
  t.eq((await W.here(page)).projectId, was.projectId, 'the caret unfolds without switching');
  await page.click('#sidebar .sb-item[data-key="p:' + kitchen.id + '"] .sb-name');
  await until(page, function (pid) { return window.MindRoot.store.here().projectId === pid; }, kitchen.id);
  t.check('a project row switches to it (its last map opens)', (await W.here(page)).mapId === kitchen.maps[0]);
  await page.click('#sidebar .sb-item[data-key="p:' + kitchen.id + '"] .sb-name');
  await until(page, function () { return document.querySelector('.sb-item[data-key^="p:"]:nth-child(2)').getAttribute('aria-expanded') === 'false'; });
  t.check('the active project row folds and unfolds', true);
  await page.click('#sidebar .sb-item[data-key="m:' + garden.maps[2] + '"] .sb-name');
  await until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, garden.maps[2]);
  t.check('a map row opens the map', true);
  await page.dblclick('#sidebar .sb-item[data-key="m:' + garden.maps[0] + '"] .sb-name');
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] input'); });
  t.eq(await page.inputValue('dialog.dialog[open] input'), 'Beds', 'a double click renames');
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('dialog.dialog[open]'); });
  await page.click('#sidebar .sb-item[data-key="m:' + garden.maps[0] + '"] .sb-name', { button: 'right' });
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  await page.click('.menu:not([hidden]) .menu__item:has-text("Duplicate")');
  await until(page, function (id) { return window.MindRoot.store.project(id).maps.length === 4; }, garden.id);
  t.same(await mapNames(page, garden.id), ['Beds', 'Beds (copy)', 'Shed tools', 'Seeds'], 'right click, Duplicate: right after it');
  await W.waitToast(page, /Made Beds \(copy\)/);
  await until(page, function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Beds (copy)'; });
  t.check('and it opens', true);

  t.step('the row menu button: template');
  await page.hover('#sidebar .sb-item[data-key="p:' + garden.id + '"] > .sb-row');
  await page.click('#sidebar .sb-item[data-key="p:' + garden.id + '"] > .sb-row .sb-more');
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  await page.click('.menu:not([hidden]) .menu__item:has-text("Use as a template")');
  await until(page, function () { return /^Template, 4 maps/.test(document.querySelector('[data-key^="p:"] .sb-meta').textContent); });
  t.check('the meta says Template', true);
  t.eq(await page.evaluate(function () { return document.querySelector('[data-key^="p:"] > .sb-row > .sb-icon use').getAttribute('href'); }), '#i-template', 'and the icon is the template one');
  await W.waitToast(page, /Garden is a template/);

  t.step('a new project from a template, titles only');
  await page.click('#sb-new-project');
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] .ws-choices'); });
  var dlg = await page.evaluate(function () {
    var d = document.querySelector('dialog.dialog[open]');
    return {
      title: d.querySelector('.dialog__title').textContent,
      choices: Array.prototype.map.call(d.querySelectorAll('.ws-choice__title'), function (x) { return x.textContent; }),
      hint: Array.prototype.map.call(d.querySelectorAll('.ws-choice__hint'), function (x) { return x.textContent; }),
      focus: document.activeElement === d.querySelector('input[type=text]'),
      sub: d.querySelector('.ws-choices__sub').hidden
    };
  });
  t.eq(dlg.title, 'New project', 'the dialog');
  t.same(dlg.choices, ['Empty', 'Garden'], 'empty, or the template');
  t.eq(dlg.hint[1], '4 maps: Beds, Beds (copy), Shed tools, …', 'the template says what it holds');
  t.eq(dlg.focus, true, 'the name has the focus');
  t.eq(dlg.sub, true, 'no content box for an empty project');
  await page.click('dialog.dialog[open] .btn--primary');
  t.eq(await page.evaluate(function () { return document.querySelector('dialog.dialog[open] .field__error').textContent; }), 'Write something first.', 'a name is needed');
  await page.fill('dialog.dialog[open] input[type=text]', 'Orchard');
  await page.click('dialog.dialog[open] .ws-choice:nth-child(2)');
  t.eq(await page.evaluate(function () { return document.querySelector('dialog.dialog[open] .ws-choices__sub').hidden; }), false, 'a template offers its content');
  await page.click('dialog.dialog[open] .ws-choices__sub input');
  await page.click('dialog.dialog[open] .btn--primary');
  await until(page, function () { return window.MindRoot.store.projects().some(function (p) { return p.name === 'Orchard'; }); });
  var orchard = await page.evaluate(function () {
    var p = window.MindRoot.store.projects().filter(function (x) { return x.name === 'Orchard'; })[0];
    return { id: p.id, maps: p.maps.map(function (m) { return m.name + '|' + m.text; }), active: window.MindRoot.store.here().projectId === p.id, template: p.isTemplate };
  });
  t.same(orchard.maps, ['Beds|# Beds\n', 'Beds (copy)|# Beds (copy)\n', 'Shed tools|# Shed tools\n', 'Seeds|# Seeds\n'], 'the template\'s maps, only their titles');
  t.eq(orchard.active, true, 'it opens');
  t.eq(orchard.template, false, 'and is not a template itself');
  await W.waitToast(page, /Made Orchard, from Garden/);

  t.step('rename and describe, duplicate');
  await page.evaluate(function (pid) { window.MindRoot.sidebar.editProject(pid); }, orchard.id);
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] textarea'); });
  await page.fill('dialog.dialog[open] input[type=text]', 'Fruit trees');
  await page.fill('dialog.dialog[open] textarea', 'Apples and pears');
  await page.click('dialog.dialog[open] .btn--primary');
  await until(page, function (pid) { var p = window.MindRoot.store.project(pid); return p.name === 'Fruit trees' && p.description === 'Apples and pears'; }, orchard.id);
  t.check('name and description saved', true);
  await page.evaluate(function () { window.MindRoot.commands.run('project.duplicate'); });
  await until(page, function () { return window.MindRoot.store.projects().some(function (p) { return p.name === 'Fruit trees (copy)'; }); });
  t.eq(await page.evaluate(function () { return window.MindRoot.store.projects().map(function (p) { return p.name; }).join(', '); }), 'Garden, Kitchen, Fruit trees, Fruit trees (copy)', 'the copy right after the original');

  t.step('deleting a project asks, and Undo brings it back');
  await page.evaluate(function () { window.MindRoot.commands.run('project.delete'); });
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] .btn--danger'); });
  var ask = await page.evaluate(function () {
    var d = document.querySelector('dialog.dialog[open]');
    return { title: d.querySelector('.dialog__title').textContent, text: d.querySelector('.dialog__text').textContent, focus: document.activeElement.textContent };
  });
  t.eq(ask.title, 'Delete Fruit trees (copy)?', 'it asks');
  t.check('saying what goes and how to get it back', /4 maps/.test(ask.text) && /Undo brings it back/.test(ask.text), ask.text);
  t.eq(ask.focus, 'Cancel', 'Cancel has the focus (a danger dialog)');
  await page.keyboard.press('Enter');
  await until(page, function () { return !document.querySelector('dialog.dialog[open]'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.store.projects().length; }), 4, 'Cancel keeps it');
  await page.evaluate(function () { window.MindRoot.commands.run('project.delete'); });
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] .btn--danger'); });
  await page.click('dialog.dialog[open] .btn--danger');
  await until(page, function () { return window.MindRoot.store.projects().length === 3; });
  await W.waitToast(page, /Fruit trees \(copy\) deleted/);
  await page.click('.toast:not([hidden]) .toast__action');
  await until(page, function () { return window.MindRoot.store.projects().length === 4; });
  t.check('Undo brings it back', true);

  t.step('the footer');
  var foot = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#sidebar .sb__foot .sb-tool'), function (b) { return b.hidden ? null : b.getAttribute('aria-label'); }).filter(Boolean);
  });
  t.check('copies, trash, settings, help (and images with the media module)', foot.indexOf('Copies') === 0 && foot.indexOf('Settings') > 0 && foot.indexOf('Help') > 0 && foot.some(function (l) { return /^The trash of /.test(l); }), foot);
  await page.click('#sb-trash');
  await until(page, function () { return window.MindRoot.trash.isOpen(); });
  t.check('the trash button opens the trash', true);
  await page.keyboard.press('Escape');
  await until(page, function () { return !window.MindRoot.trash.isOpen(); });
  var bump = await page.evaluate(function () {
    var ns = window.MindRoot;
    var badge = document.querySelector('#sb-trash .sb-badge');
    var seen = false;
    var mo = new MutationObserver(function () { if (badge.hasAttribute('data-bump')) seen = true; });
    mo.observe(badge, { attributes: true });
    var h = ns.store.here();
    ns.store.deleteMap(h.projectId, h.mapId);
    return new Promise(function (r) { setTimeout(function () { mo.disconnect(); r({ seen: seen, text: badge.textContent }); }, 300); });
  });
  t.same(bump, { seen: true, text: '1' }, 'the badge counts and bumps');

  t.step('read-only: a tab that only shows');
  await page.evaluate(function () { window.MindRoot.store.setReadOnly(true); });
  await until(page, function () { return document.getElementById('sb-new-project').getAttribute('aria-disabled') === 'true'; });
  await page.focus('#sidebar .sb-item[tabindex="0"]');
  var before = await page.evaluate(function () { return JSON.stringify(window.MindRoot.store.projects().map(function (p) { return p.maps.length; })); });
  await page.keyboard.press('Delete');
  await W.waitToast(page, /only shows your maps/);
  t.eq(await page.evaluate(function () { return JSON.stringify(window.MindRoot.store.projects().map(function (p) { return p.maps.length; })); }), before, 'Delete changes nothing, and says why');
  await page.evaluate(function () { window.MindRoot.store.setReadOnly(false); });

  t.step('typing in a map repaints numbers, not the tree');
  await W.settled(page);
  await page.evaluate(function () {
    var tree = document.querySelector('#sidebar [role=tree]');
    window.__builds = 0;
    window.__mo = new MutationObserver(function (list) { if (list.some(function (r) { return r.target === tree && r.type === 'childList'; })) window.__builds++; });
    window.__mo.observe(tree, { childList: true });
  });
  var h0 = await W.here(page);
  await page.evaluate(function (h) {
    var ns = window.MindRoot;
    var text = '# Spot\n';
    for (var i = 0; i < 10; i++) { text += '- n' + i + '\n'; ns.store.setMapText(h.projectId, h.mapId, text); }
  }, h0);
  await until(page, function (mid) { var c = document.querySelector('#sidebar .sb-item[data-key="m:' + mid + '"] .sb-count'); return c && c.textContent === '11'; }, h0.mapId);
  var painted = await page.evaluate(function (h) {
    var row = document.querySelector('#sidebar .sb-item[data-key="m:' + h.mapId + '"]');
    var p = window.MindRoot.store.project(h.projectId);
    var meta = document.querySelector('#sidebar .sb-item[data-key="p:' + h.projectId + '"] .sb-meta').textContent;
    return { builds: window.__builds, label: row.getAttribute('aria-label'), title: row.querySelector('.sb-row').getAttribute('title'), meta: meta, want: window.MindRoot.store.counts(p).nodes };
  }, h0);
  t.eq(painted.builds, 0, 'ten edits, no rebuild of the tree');
  t.check('the row says the new count', /11 nodes$/.test(painted.label) && painted.title === painted.label, painted.label);
  t.check('and so does its project', painted.meta.indexOf(painted.want + ' nodes') >= 0, painted.meta + ' / ' + painted.want);

  t.step('a closed sidebar is not rebuilt, and is fresh when it opens');
  await page.evaluate(function () { window.MindRoot.shell.sidebar.close(); });
  await until(page, function () { return !window.MindRoot.shell.sidebar.isOpen(); });
  await page.evaluate(function () { window.__builds = 0; });
  await page.evaluate(function (h) {
    var ns = window.MindRoot;
    ns.store.setMapText(h.projectId, h.mapId, '# Spot\n\n- one\n');
    ns.store.renameMap(h.projectId, h.mapId, 'Renamed while closed');
  }, h0);
  await page.evaluate(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); });
  t.eq(await page.evaluate(function () { return window.__builds; }), 0, 'changes while closed build nothing');
  await page.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
  var fresh = await page.evaluate(function (mid) {
    var row = document.querySelector('#sidebar .sb-item[data-key="m:' + mid + '"]');
    return { name: row && row.querySelector('.sb-name').textContent, count: row && row.querySelector('.sb-count').textContent, builds: window.__builds };
  }, h0.mapId);
  t.same(fresh, { name: 'Renamed while closed', count: '2', builds: 1 }, 'opened: built once, at once, with what changed');
  await page.evaluate(function () { window.__mo.disconnect(); delete window.__mo; delete window.__builds; });

  t.step('house style of the strings');
  var copy = await W.copyCheck(page, ['sidebar']);
  t.check('strings registered', copy.count > 100, copy.count);
  t.same([copy.onlyEn, copy.onlyIt, copy.bang, copy.dash, copy.emoji], [[], [], [], [], []], 'both languages, no exclamation marks, em-dashes or emoji');
  await W.rest(page);
  await t.shot('desktop', page);
};
