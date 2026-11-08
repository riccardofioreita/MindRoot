/* editor-keys: every key the map answers, on the real app. Tab, Enter,
 * Shift+Enter, F2, Delete, Backspace, Alt+arrows, Shift+Tab, Space, the
 * arrows over the visible nodes only, Home/End, Escape, Enter with nothing
 * selected; each edit one undo step with its label; a new node opens ready
 * to type with its words chosen; a letter typed on a selected node starts
 * writing its name; keys pressed on a focused control or in another region
 * are not the map's. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n- Beta\n- Gamma\n';

module.exports = async function (t) {
  var s = await E.boot(t, [['Keys', MAP]]);
  var page = s.page;
  var start = await E.history(page);

  t.step('Tab adds a child and opens it for typing');
  await E.clickNode(page, '1');
  t.eq(await page.evaluate(function () { return document.activeElement === window.MindRoot.session.view.el; }), true, 'a click puts the keyboard on the map');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  t.eq(await page.evaluate(function () {
    var el = window.MindRoot.session.view.el;
    return el.matches(':focus-visible') ? getComputedStyle(el).outlineStyle : 'not focus-visible';
  }), 'none', 'keys with a node selected: the node ring shows where they go, no frame round the whole map');
  await page.keyboard.press('Tab');
  var f = await E.fields(page);
  t.same({ title: f.title, focus: f.focus, chosen: f.chosen }, { title: 'New node', focus: 'title', chosen: 'New node' }, 'the new node is open with its words chosen, in the same task');
  t.eq(await E.selected(page), '1.0', 'and selected');
  var h = await E.history(page);
  t.same([h.count - start.count, h.key], [1, 'editor.label.addChild'], 'one step: add a child');
  await page.keyboard.type('Beta kid');
  await page.keyboard.press('Enter');
  t.eq(await E.renaming(page), null, 'Enter saves and closes the field');
  t.eq(await E.text(page), '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n- Beta\n  - Beta kid\n- Gamma\n', 'written in the file');
  h = await E.history(page);
  t.same([h.count - start.count, h.key], [1, 'editor.label.addChild'], 'named in the same step that made it: one gesture, one undo');
  t.eq(await page.evaluate(function () { return document.activeElement === window.MindRoot.session.view.el; }), true, 'the keyboard is back on the map');

  t.step('Enter adds a sibling; Escape cancels the add');
  var stepsAdd = (await E.history(page)).count;
  var textAdd = await E.text(page);
  await page.keyboard.press('Enter');
  t.eq((await E.fields(page)).chosen, 'New node', 'open and chosen');
  t.eq((await E.history(page)).key, 'editor.label.addSibling', 'add a sibling');
  await page.keyboard.type('Not this');
  await page.keyboard.press('Escape');
  t.eq(await E.renaming(page), null, 'Escape closes the field');
  t.eq(await E.text(page), textAdd, 'the node is gone: no "New node" left behind');
  t.same([(await E.history(page)).count, (await E.history(page)).redo], [stepsAdd, 0], 'no step, and nothing to redo');
  t.eq(await E.selected(page), '1.0', 'the node it was added from is selected again');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  t.check('Enter with the placeholder keeps it', /- Beta kid\n {2}- New node\n/.test(await E.text(page)), await E.text(page));
  t.eq(await E.selected(page), '1.1', 'the new sibling stays selected');

  t.step('Delete and Backspace send the branch to the trash');
  var before = (await E.history(page)).count;
  await page.keyboard.press('Delete');
  t.eq(await E.text(page), '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n- Beta\n  - Beta kid\n- Gamma\n', 'Delete takes it out');
  h = await E.history(page);
  t.same([h.count - before, h.key], [1, 'store.label.deleteBranch'], 'one step: delete the branch');
  t.eq(await E.selected(page), '1.0', 'the selection goes to the sibling before it');
  var trash = await page.evaluate(function (pid) { return window.MindRoot.store.project(pid).trash.map(function (e) { return e.kind + ':' + e.label; }); }, s.pid);
  t.same(trash, ['branch:New node'], 'the branch is in the trash');
  await page.keyboard.press('Backspace');
  t.check('Backspace does the same', !/Beta kid/.test(await E.text(page)));
  t.eq(await E.selected(page), '1', 'and the parent is selected when no sibling is left');
  await page.keyboard.press('Control+z');
  t.check('undo brings the branch back', /- Beta\n {2}- Beta kid\n/.test(await E.text(page)), await E.text(page));
  trash = await page.evaluate(function (pid) { return window.MindRoot.store.project(pid).trash.map(function (e) { return e.label; }); }, s.pid);
  t.same(trash, ['New node'], 'and takes it out of the trash in the same step');
  var keep = await E.text(page);
  var was = await E.selected(page);
  var steps = (await E.history(page)).count;
  await E.select(page, '');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  t.eq(await E.text(page), keep, 'the one root is never deleted: the map keeps something to grow from');
  t.eq((await E.history(page)).count, steps, 'and no step is added');
  t.check('a toast says why', await page.evaluate(function () { return Array.prototype.some.call(document.querySelectorAll('.toast'), function (n) { return /central node stays/.test(n.textContent); }); }));
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('node.delete', { source: 'menu' }); }), false, 'the menu entry is off on the root');
  await E.select(page, was);
  t.eq(await E.selected(page), '1.0', 'selected again');
  await page.keyboard.press('Backspace');

  t.step('F2 renames with the caret at the end');
  await page.keyboard.press('F2');
  f = await E.fields(page);
  t.same({ title: f.title, chosen: f.chosen, focus: f.focus }, { title: 'Beta', chosen: '', focus: 'title' }, 'open on the words, nothing chosen');
  await page.keyboard.type(' plus');
  await page.keyboard.press('Enter');
  t.check('renamed', /\n- Beta plus\n/.test(await E.text(page)), await E.text(page));

  t.step('Shift+Enter adds a sibling before');
  await page.keyboard.press('Shift+Enter');
  t.eq((await E.fields(page)).chosen, 'New node', 'open and chosen');
  await page.keyboard.type('Between');
  await page.keyboard.press('Enter');
  t.eq(await E.text(page), '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n- Between\n- Beta plus\n- Gamma\n', 'written before Beta');
  t.eq(await E.selected(page), '1', 'and selected where it stands');

  t.step('Alt+arrows move and re-level the node');
  before = (await E.history(page)).count;
  await page.keyboard.press('Alt+ArrowUp');
  t.eq(await E.text(page), '# Root\n\n- Between\n- Alpha\n  - Alpha one\n  - Alpha two\n- Beta plus\n- Gamma\n', 'Alt+Up swaps it with the sibling above');
  t.eq((await E.history(page)).key, 'editor.label.moveUp', 'labelled move up');
  t.eq(await E.selected(page), '0', 'the selection follows it');
  await page.keyboard.press('Alt+ArrowDown');
  t.eq((await E.history(page)).key, 'editor.label.moveDown', 'Alt+Down: move down');
  t.eq(await E.selected(page), '1', 'back where it was');
  await page.keyboard.press('Alt+ArrowRight');
  t.eq(await E.text(page), '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n  - Between\n- Beta plus\n- Gamma\n', 'Alt+Right makes it a child of the node above');
  t.same([(await E.history(page)).key, await E.selected(page)], ['editor.label.indent', '0.2'], 'move down a level, still selected');
  await page.keyboard.press('Alt+ArrowLeft');
  t.same([(await E.history(page)).key, await E.selected(page)], ['editor.label.outdent', '1'], 'Alt+Left: move up a level');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Shift+Tab');
  t.same([(await E.history(page)).key, await E.selected(page)], ['editor.label.outdent', '1'], 'Shift+Tab outdents too');
  t.eq((await E.history(page)).count - before, 6, 'six moves, six steps');
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  var top = (await E.history(page)).count;
  await page.keyboard.press('Alt+ArrowUp');
  t.eq((await E.history(page)).count, top, 'the first sibling cannot go up: no step');

  t.step('the arrows walk over what is drawn');
  await page.keyboard.press('Alt+ArrowDown');
  await E.select(page, '0');
  t.eq(await E.text(page), '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n- Between\n- Beta plus\n- Gamma\n', 'back in order');
  await page.keyboard.press('ArrowRight');
  t.eq(await E.selected(page), '0.0', 'Right: the first child');
  await page.keyboard.press('ArrowDown');
  t.eq(await E.selected(page), '0.1', 'Down: the next sibling');
  await page.keyboard.press('ArrowLeft');
  t.eq(await E.selected(page), '0', 'Left: the parent');
  await page.keyboard.press('ArrowLeft');
  t.eq(await E.selected(page), '', 'Left again: the root');
  await page.keyboard.press('ArrowRight');
  t.eq(await E.selected(page), '0', 'Right from the root: its first child');
  await page.keyboard.press('End');
  t.eq(await E.selected(page), '3', 'End: the last sibling');
  await page.keyboard.press('Home');
  t.eq(await E.selected(page), '0', 'Home: the first sibling');

  t.step('Space folds, and the arrows do not go into a fold');
  await page.keyboard.press('Space');
  await E.until(page, function () { return window.MindRoot.session.view.isFolded('0'); });
  t.check('Alpha folded', true);
  t.eq(await page.evaluate(function () { return !!window.MindRoot.session.view.nodeEl('0.0'); }), false, 'its children are not drawn');
  await page.keyboard.press('ArrowRight');
  t.eq(await E.selected(page), '0', 'Right does not go under a fold');
  await page.keyboard.press('ArrowDown');
  t.eq(await E.selected(page), '1', 'Down goes to the next node drawn');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await E.until(page, function () { return !window.MindRoot.session.view.isFolded('0'); });
  t.check('Space unfolds it again', true);
  var foldSaved = await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.mid).folds.length; }, { pid: s.pid, mid: s.mid });
  t.check('folds are remembered with the map (not the history)', foldSaved >= 1, foldSaved);

  t.step('Shift+F10 opens the node menu from the keyboard');
  await page.keyboard.press('Shift+F10');
  await E.until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  t.eq(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.closest('.menu')); }), true, 'with the keyboard in it');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.menu:not([hidden])'); });
  t.eq(await E.selected(page), '0', 'Escape closes the menu and only the menu');

  t.step('Escape deselects; Enter with nothing selected adds a root');
  await page.keyboard.press('Escape');
  t.eq(await E.selected(page), null, 'nothing selected');
  await page.keyboard.press('Enter');
  t.eq((await E.history(page)).key, 'editor.label.addRoot', 'add a root');
  t.eq((await E.fields(page)).chosen, 'New node', 'open and chosen');
  await page.keyboard.type('Second root');
  await page.keyboard.press('Enter');
  t.check('a second heading at the end', /\n# Second root\n$/.test(await E.text(page)), await E.text(page));
  t.eq(await page.evaluate(function () { return window.MindRoot.session.current().state.byPath[window.MindRoot.session.selected()].title; }), 'Second root', 'selected');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  t.eq(await E.selected(page), '0', 'Down with nothing selected starts at the first node');

  t.step('Undo takes back one step at a time');
  var textNow = await E.text(page);
  await page.keyboard.press('Control+z');
  t.check('the added and named root goes in one undo', !/Second root/.test(await E.text(page)) && !/\n# New node\n$/.test(await E.text(page)), await E.text(page));
  await page.keyboard.press('Control+Shift+z');
  t.eq(await E.text(page), textNow, 'and redone');

  t.step('keys on a focused control or in another region are not the map\'s');
  await E.select(page, '1');
  var stepsBefore = (await E.history(page)).count;
  await page.focus('#sidebar-toggle');
  await page.keyboard.press('Enter');
  t.eq((await E.history(page)).count, stepsBefore, 'Enter on a button presses the button, adds nothing');
  await page.focus('#sidebar-toggle');
  await page.keyboard.press('Tab');
  t.eq((await E.history(page)).count, stepsBefore, 'Tab on a button moves the focus, adds nothing');
  var inSidebar = await page.evaluate(function () {
    if (window.MindRoot.shell && window.MindRoot.shell.sidebar) window.MindRoot.shell.sidebar.open();
    var probe = document.createElement('button');
    probe.textContent = 'probe';
    probe.id = 'probe-in-sidebar';
    document.getElementById('sidebar').appendChild(probe);
    probe.focus();
    return document.activeElement === probe;
  });
  t.eq(inSidebar, true, 'focus in the sidebar');
  await page.keyboard.press('Delete');
  await page.keyboard.press('F2');
  t.eq((await E.history(page)).count, stepsBefore, 'Delete and F2 there do nothing to the map');
  t.eq(await E.renaming(page), null, 'no rename opened');
  await page.evaluate(function () { document.getElementById('probe-in-sidebar').remove(); });

  t.step('a letter typed on a selected node writes its name over the old one');
  var gamma = await E.pathOf(page, 'Gamma');
  await E.select(page, gamma);
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  stepsBefore = (await E.history(page)).count;
  var textBefore = await E.text(page);
  await page.keyboard.type('Gx');
  var typed = await E.fields(page);
  t.same({ title: typed.title, focus: typed.focus }, { title: 'Gx', focus: 'title' }, 'the first key opens the name and is its first letter');
  await page.keyboard.press('Escape');
  t.eq(await E.text(page), textBefore, 'Escape gives the old name back');
  t.eq((await E.history(page)).count, stepsBefore, 'and leaves no step');
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  await page.keyboard.type('Delta');
  await page.keyboard.press('Enter');
  t.check('Enter writes it', /\n- Delta\n/.test(await E.text(page)) && !/Gamma/.test(await E.text(page)), await E.text(page));
  t.eq((await E.history(page)).count - stepsBefore, 1, 'one step');
  await page.keyboard.press('Control+z');
  t.eq(await E.text(page), textBefore, 'one undo takes it back');
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  await page.keyboard.press('Control+j');
  await page.keyboard.press('Alt+g');
  t.eq(await E.renaming(page), null, 'a key with Ctrl or Alt is not typing');
  t.eq(await E.text(page), textBefore, 'and writes nothing');

  t.step('view-only: the map reads, nothing writes');
  await E.select(page, '0.1');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await E.until(page, function () { return window.MindRoot.session.readOnly(); });
  stepsBefore = (await E.history(page)).count;
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  for (var k of ['Tab', 'Enter', 'Delete', 'F2', 'Alt+ArrowUp', 'Space', 'a']) {
    await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
    await page.keyboard.press(k);
  }
  t.eq(await page.evaluate(function () { return window.MindRoot.session.readOnly(); }), true, 'still view-only');
  t.eq(await E.renaming(page), null, 'no rename opened');
  t.eq((await E.history(page)).count, stepsBefore, 'no key writes');
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  await page.keyboard.press('ArrowDown');
  t.eq(await E.selected(page), '0.2', 'but the arrows still walk');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await E.until(page, function () { return !window.MindRoot.session.readOnly(); });
  t.check('editable again', true);

  t.step('Ctrl+C copies the branch as Markdown; Ctrl+V writes Markdown as children');
  var alphaPath = await E.pathOf(page, 'Alpha');
  await E.select(page, alphaPath);
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  var copied = await page.evaluate(function () {
    var dt = new DataTransfer();
    document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  var branch = await page.evaluate(function () { var c = window.MindRoot.session.current(); return window.MindRoot.doc.extractBranch(c.state, window.MindRoot.session.selected()).fragment.text; });
  t.eq(copied.trim(), branch.trim(), 'the branch, as the file writes it');
  var steps0 = (await E.history(page)).count;
  await page.evaluate(function () {
    var dt = new DataTransfer();
    dt.setData('text/plain', '- pasted\n  - kid\n- second\n');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  var txt = await E.text(page);
  t.check('two branches under the node, with their children', /- Alpha two\n {2}- pasted\n {4}- kid\n {2}- second\n/.test(txt), txt);
  t.eq((await E.history(page)).count - steps0, 1, 'one step');
  t.eq(await page.evaluate(function () { var c = window.MindRoot.session.current(); return window.MindRoot.doc.plainText(c.state.byPath[window.MindRoot.session.selected()]); }), 'pasted', 'the first one pasted is selected');

  t.step('how to leave the map is said: on the tree and in the help');
  t.check('the tree describes Escape then Tab', /Escape lets go of the node, then Tab leaves the map/.test(await page.evaluate(function () { return window.MindRoot.session.view.el.getAttribute('aria-description'); })));
  t.eq(await page.evaluate(function () { var c = window.MindRoot.commands.get('node.deselect'); return c.showInHelp !== false && !!c.help; }), true, 'the help lists Escape with what it does to Tab');
};
