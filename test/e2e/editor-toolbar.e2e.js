/* editor-toolbar: the node toolbar (a capsule above the selected node,
 * below it when there is no room, never over its words, inside the stage,
 * gone while the map moves under the hand and back where the node lands,
 * carried by its grip until another node is chosen), what its buttons and
 * its "more" menu do, the colour and the dice, the colour a new node is born
 * with, tasks, links (web and [[map]]), a tap on a picture, the context
 * menu on a node and on the empty map, folding everything, and copying a
 * branch to another map - each edit one undo step with its label. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- Alpha\n  - Alpha one\n- [ ] Task item\n- See [the site](https://example.com/page) or [[Other]] or [[Nowhere]]\n- ![](assets/pic.png) Picture node\n- Beta\n';

async function bar(page, wait) {
  if (wait !== false) {
    try {
      await page.waitForFunction(function () { var el = document.querySelector('.node-toolbar'); return el && !el.hidden; }, null, { timeout: 1500, polling: 30 });
    } catch (err) { /* asked about a hidden bar */ }
  }
  return page.evaluate(function () {
    var el = document.querySelector('.node-toolbar');
    if (!el || el.hidden) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom, side: el.getAttribute('data-side'), instant: el.hasAttribute('data-instant'), moved: el.hasAttribute('data-moved') };
  });
}

async function pickMenu(page, label) {
  await page.waitForSelector('.menu:not([hidden]) .menu__item', { timeout: 4000 });
  var ok = await page.evaluate(function (want) {
    var items = document.querySelectorAll('.menu:not([hidden]) .menu__item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].querySelector('.menu__label').textContent === want) { items[i].setAttribute('data-test-pick', ''); return true; }
    }
    return false;
  }, label);
  if (!ok) throw new Error('no menu item ' + label);
  await page.click('[data-test-pick]');
}

function menuLabels(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__item .menu__label'), function (e) { return e.textContent; });
  });
}

async function closeMenus(page) {
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.menu:not([hidden])'); });
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Tools', MAP], ['Other', '# Other\n\n- Thing\n']]);
  var page = s.page;
  await page.evaluate(function () {
    window.__opened = [];
    HTMLAnchorElement.prototype.click = function () { window.__opened.push({ href: this.href, target: this.target, rel: this.rel }); };
    window.__viewer = [];
    window.MindRoot.media = { openViewer: function (p) { window.__viewer.push(p); } };
  });

  t.step('the toolbar stands above the selected node');
  t.eq(await bar(page, false), null, 'no selection, no toolbar');
  await E.clickNode(page, '0');
  var b = await bar(page);
  var n = await E.box(page, '0');
  var stage = await E.rectOf(page, '#stage');
  var gap = await E.tokenPx(page, '.node-toolbar', '--bar-gap');
  var margin = await E.tokenPx(page, '.node-toolbar', '--bar-margin');
  t.check('the tokens resolve to real lengths', gap >= 4 && margin >= 4, { gap: gap, margin: margin });
  t.check('shown', !!b);
  t.check('above the node, a gap clear of it', b.bottom <= n.y - gap + 1, { bar: b, node: n, gap: gap });
  t.check('and not floating away from it', n.y - b.bottom <= gap + 1, { bar: b, node: n, gap: gap });
  t.check('centred on it or held inside the stage', Math.abs((b.x + b.w / 2) - n.cx) < 2 || b.x <= stage.x + margin + 1 || b.right >= stage.right - margin - 1, { bar: b, node: n });
  t.check('inside the stage, a margin from its edges', b.x >= stage.x + margin - 1 && b.right <= stage.right - margin + 1 && b.y >= stage.y + margin - 1 && b.bottom <= stage.bottom - margin + 1, { bar: b, stage: stage, margin: margin });
  t.eq(await page.evaluate(function () { return document.activeElement === window.MindRoot.session.view.el; }), true, 'the map keeps the keyboard');

  t.step('of the two sides, the one that covers no other node');
  await E.clickNode(page, '4');
  b = await bar(page);
  var covered = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var tb = document.querySelector('.node-toolbar').getBoundingClientRect();
    return v.visiblePaths().filter(function (p) {
      if (p === '4') return false;
      var r = v.rect(p);
      return r && r.left < tb.right && tb.left < r.right && r.top < tb.bottom && tb.top < r.bottom;
    });
  });
  t.same(covered, [], 'the last sibling\'s toolbar leaves the sibling above it free');
  await E.clickNode(page, '0');
  await bar(page);

  t.step('the buttons');
  await page.click('.node-toolbar [data-command="node.addChild"]');
  var f = await E.fields(page);
  t.same([f.chosen, f.focus], ['New node', 'title'], 'add a child: open for typing');
  await page.keyboard.type('Alpha two');
  await page.keyboard.press('Enter');
  t.check('written', /- Alpha\n {2}- Alpha one\n {2}- Alpha two\n/.test(await E.text(page)), await E.text(page));
  await page.click('.node-toolbar [data-command="node.addSibling"]');
  await page.keyboard.press('Enter');
  t.check('add a sibling', /- Alpha two\n {2}- New node\n/.test(await E.text(page)), await E.text(page));
  await page.click('.node-toolbar [data-command="node.rename"]');
  t.same((await E.fields(page)).title, 'New node', 'rename opens the node');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  t.eq(await page.evaluate(function () { return document.activeElement === window.MindRoot.session.view.el; }), true, 'still on the map after the buttons');

  t.step('the toolbar goes below a node at the top of the stage');
  await E.select(page, '');
  var view = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var c = v.camera();
    var r = v.rect('');
    var stage = document.getElementById('stage').getBoundingClientRect();
    v.setCamera({ x: c.x, y: c.y - (r.top - stage.top) + 4, k: c.k });
    return true;
  });
  await E.settled(page);
  await E.until(page, function () { var el = document.querySelector('.node-toolbar'); return el && !el.hidden && el.getAttribute('data-side') === 'bottom'; });
  b = await bar(page);
  n = await E.box(page, '');
  /* The node stands beside the top capsules: the bar goes under it, and
   * further down when right under it would be under a capsule. */
  var band = await page.evaluate(function () {
    var st = document.getElementById('stage').getBoundingClientRect();
    var lead = document.getElementById('topbar-lead').getBoundingClientRect();
    return { top: st.top + window.MindRoot.shell.insets().top, lead: lead.bottom };
  });
  var want = Math.max(n.bottom + gap, band.top);
  t.check('below, a gap clear of the words and clear of the top capsules', b.y >= n.bottom + gap - 1 && b.y >= band.lead && Math.abs(b.y - want) <= 1, { bar: b, node: n, gap: gap, band: band });

  t.step('a node at the left edge: the toolbar keeps its margin from the stage');
  await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var c = v.camera();
    var r = v.rect('');
    var st = document.getElementById('stage').getBoundingClientRect();
    v.setCamera({ x: c.x - (r.left - st.left) + 2, y: c.y + 200, k: c.k });
  });
  await E.settled(page);
  await E.until(page, function () { var el = document.querySelector('.node-toolbar'); return el && !el.hidden; });
  b = await bar(page);
  stage = await E.rectOf(page, '#stage');
  t.check('clamped a margin inside the left edge', Math.abs(b.x - (stage.x + margin)) <= 1, { bar: b, stage: stage, margin: margin });
  await page.evaluate(function () { window.MindRoot.session.view.fit({ animate: false }); });
  await E.settled(page);

  t.step('gone while the map moves under the hand, back after');
  await E.select(page, '0');
  stage = await E.rectOf(page, '#stage');
  await page.mouse.move(stage.x + 30, stage.bottom - 40);
  await page.mouse.down();
  await page.mouse.move(stage.x + 60, stage.bottom - 60, { steps: 4 });
  t.eq(await bar(page, false), null, 'hidden while panning');
  await page.mouse.move(stage.x + 90, stage.bottom - 80, { steps: 4 });
  await page.mouse.up();
  await E.settled(page);
  await E.until(page, function () { var el = document.querySelector('.node-toolbar'); return el && !el.hidden; });
  b = await bar(page);
  n = await E.box(page, '0');
  var beside = (b.side === 'left' && Math.abs(n.x - b.right) < 40) || (b.side === 'right' && Math.abs(b.x - n.right) < 40);
  t.check('back beside the node where it landed', (b.bottom <= n.y + 0.5 && Math.abs(b.bottom - n.y) < 40) || (b.y >= n.bottom - 0.5 && Math.abs(b.y - n.bottom) < 40) ||
    (beside && b.y < n.bottom && n.y < b.bottom), { bar: b, node: n });
  await page.mouse.move(n.cx, n.cy + 200);
  await page.mouse.wheel(0, 120);
  await E.settled(page);
  await E.until(page, function () {
    var el = document.querySelector('.node-toolbar');
    var r = window.MindRoot.session.view.rect('0');
    if (!el || el.hidden || !r) return false;
    var b = el.getBoundingClientRect();
    return Math.abs(b.bottom - r.top) < 40 || Math.abs(b.top - r.bottom) < 40 ||
      ((Math.abs(r.left - b.right) < 40 || Math.abs(b.left - r.right) < 40) && b.top < r.bottom && r.top < b.bottom);
  });
  t.check('and after a wheel it follows the node', true);

  t.step('arrows move it at once, a hand can carry it');
  await page.keyboard.press('ArrowDown');
  b = await bar(page);
  t.eq(b.instant, true, 'no motion on a keyboard path');
  /* The map may still bring the new node into view (the bar steps aside
   * while it moves): the grip is taken once everything has landed. */
  await E.settled(page);
  await E.resting(page, '.node-toolbar');
  var grip = await E.rectOf(page, '.node-toolbar .bar-grip');
  await page.mouse.move(grip.x + grip.w / 2, grip.y + grip.h / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + 120, { steps: 6 });
  await page.mouse.up();
  /* The carry is applied on the next frames; under a busy runner they come late. */
  await page.waitForFunction(function () { var el = document.querySelector('.node-toolbar'); return el && el.hasAttribute('data-moved'); }, null, { timeout: 3000, polling: 30 }).catch(function () {});
  var moved = await bar(page);
  t.eq(moved.moved, true, 'carried by its grip');
  await page.evaluate(function () { window.MindRoot.editor.placeBars(); });
  var still = await bar(page);
  t.check('and left where the hand put it', Math.abs(still.x - moved.x) < 1 && Math.abs(still.y - moved.y) < 1, { moved: moved, still: still });
  await E.clickNode(page, '0');
  b = await bar(page);
  t.eq(b.moved, false, 'another node: placed again');

  t.step('colour: the swatch opens the picker, a pick is one step');
  var steps = (await E.history(page)).count;
  await page.click('.node-toolbar [data-command="node.color"]');
  await E.until(page, function () { var p = document.querySelector('.colorpicker'); return p && !p.hidden; });
  t.check('the picker opens', true);
  t.eq(await page.evaluate(function () { return document.querySelector('.colorpicker .cp-chip[aria-pressed="true"]').getAttribute('data-hex'); }), '#c2703d', 'showing the node\'s colour (its branch\'s palette colour)');
  await page.click('.colorpicker .cp-palette .cp-chip[data-hex="#3b6ea5"]');
  t.check('written as the node\'s own colour', /\n- Alpha <!-- color: #3b6ea5 -->\n/.test(await E.text(page)), await E.text(page));
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.color'], 'one step: change the colour');
  await E.until(page, function () { return document.querySelector('.node-toolbar__color').style.getPropertyValue('--chip') === '#3b6ea5'; });
  t.check('the swatch says so', true);
  await page.click('.colorpicker .cp-palette .cp-chip[data-hex="#b4485f"]');
  t.eq((await E.history(page)).count - steps, 1, 'a second pick right after is the same step');
  await page.click('.colorpicker button:has-text("Automatic")');
  t.check('automatic gives the node back to the palette', /\n- Alpha\n/.test(await E.text(page)), await E.text(page));
  t.eq(await page.evaluate(function () { return document.querySelector('.colorpicker').hidden; }), true, 'and closes the picker');

  t.step('the colour a new node is born with');
  await page.evaluate(function () {
    var ns = window.MindRoot;
    ns.session.select('0.0');
  });
  await E.select(page, '0.0');
  await page.click('.node-toolbar [data-command="node.color"]');
  await page.click('.colorpicker .cp-palette .cp-chip[data-hex="#a8843f"]');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Heir');
  await page.keyboard.press('Enter');
  t.check('a child takes the colour of the node it was made from, as its own', /\n {4}- Heir <!-- color: #a8843f -->\n/.test(await E.text(page)), await E.text(page));
  await page.evaluate(function () { window.MindRoot.commands.run('node.dice'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); }), true, 'the dice is down');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  t.check('with the dice every new node draws a colour, written as a branch', /\n {4}- New node <!-- color: #[0-9a-f]{6} branch -->\n/.test(await E.text(page)), await E.text(page));
  await page.evaluate(function () { window.MindRoot.commands.run('node.dice'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); }), false, 'and up again');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');

  t.step('the more menu');
  await E.select(page, '2');
  await page.click('.node-toolbar .btn--more');
  var labels = await menuLabels(page);
  ['Add a sibling before', 'Move down a level', 'Move up a level', 'Move up', 'Move down', 'Copy the branch to a map', 'Delete the branch'].forEach(function (want) {
    t.check('offers ' + want, labels.indexOf(want) >= 0, labels);
  });
  await pickMenu(page, 'Move up');
  t.check('acts on the node', /\n- See .*\n- \[ \] Task item\n/.test(await E.text(page)), await E.text(page));
  t.eq((await E.history(page)).key, 'editor.label.moveUp', 'labelled');
  await page.keyboard.press('Alt+ArrowDown');

  t.step('tasks');
  await E.select(page, '1');
  b = await bar(page);
  t.eq(await page.evaluate(function () { var x = document.querySelector('.node-toolbar [data-command="node.task"]'); return !x.hidden && x.getAttribute('aria-pressed'); }), 'true', 'the to-do button is pressed on a to-do');
  var box = await E.rectOf(page, '.mv-node[data-path="1"] .mv-task');
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  t.check('a tap on the box ticks it', /\n- \[x\] Task item\n/.test(await E.text(page)), await E.text(page));
  t.eq((await E.history(page)).key, 'editor.label.task', 'labelled');
  t.eq(await E.selected(page), '1', 'the selection does not move');
  await page.click('.node-toolbar [data-command="node.task"]');
  t.check('the button takes the box off', /\n- Task item\n/.test(await E.text(page)), await E.text(page));
  await page.click('.node-toolbar [data-command="node.task"]');
  t.check('and puts it back', /\n- \[ \] Task item\n/.test(await E.text(page)), await E.text(page));

  t.step('links: the web in a new tab, a [[map]] opens that map');
  await E.select(page, '2');
  t.eq(await E.visible(page, '.node-toolbar [data-command="node.openLink"]'), true, 'a node with links shows the link button');
  var link = await E.rectOf(page, '.mv-node[data-path="2"] a.md-link');
  await page.mouse.click(link.x + 4, link.y + link.h / 2);
  var opened = await page.evaluate(function () { return window.__opened; });
  t.same(opened, [{ href: 'https://example.com/page', target: '_blank', rel: 'noopener noreferrer' }], 'opened in a new tab that cannot reach back');
  t.eq(await E.text(page), (await E.text(page)), 'the page stays');
  var mapLink = await E.rectOf(page, '.mv-node[data-path="2"] a.md-map');
  await page.mouse.click(mapLink.x + 4, mapLink.y + mapLink.h / 2);
  await E.until(page, function (m) { return window.MindRoot.session.current().mapId === m; }, s.mids[1]);
  t.check('[[Other]] opened the map called Other', true);
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mid });
  await E.until(page, function (m) { return window.MindRoot.session.current().mapId === m; }, s.mid);
  await E.settled(page);
  var missing = await page.evaluate(function () { return window.MindRoot.editor.openLink('Nowhere', 'map'); });
  t.eq(missing, false, 'a map that does not exist is not opened');
  await E.until(page, function () { var x = document.querySelector('.toast:not([hidden]) .toast__text'); return x && /Nowhere/.test(x.textContent); });
  t.check('a toast offers to make it', await page.evaluate(function () { return /Make it/.test(document.querySelector('.toast:not([hidden])').textContent); }));
  t.eq(await page.evaluate(function () { return window.MindRoot.editor.openLink('javascript:alert(1)', 'url'); }), false, 'a link that is not the web or mail is refused');

  t.step('a tap on a picture opens the viewer');
  var pic = await E.rectOf(page, '.mv-node[data-path="3"] img.mv-img');
  await page.mouse.click(pic.x + pic.w / 2, pic.y + pic.h / 2);
  t.same(await page.evaluate(function () { return window.__viewer; }), ['assets/pic.png'], 'the viewer asked for that picture');
  t.eq(await E.selected(page), '3', 'and the node selected');

  t.step('the context menu on a node');
  n = await E.box(page, '4');
  await page.mouse.click(n.x + 10, n.y + n.h / 2, { button: 'right' });
  labels = await menuLabels(page);
  t.eq(await E.selected(page), '4', 'a right click selects the node');
  ['Add a child', 'Add a sibling', 'Rename', 'Colour', 'Delete the branch'].forEach(function (want) {
    t.check('offers ' + want, labels.indexOf(want) >= 0, labels);
  });
  await pickMenu(page, 'Add a child');
  t.same((await E.fields(page)).chosen, 'New node', 'and acts on it');
  await page.keyboard.type('Beta kid');
  await page.keyboard.press('Enter');
  t.check('written', /\n- Beta\n {2}- Beta kid\n$/.test(await E.text(page)), await E.text(page));

  t.step('the context menu on the empty map; folding everything');
  stage = await E.rectOf(page, '#stage');
  await page.mouse.click(stage.x + 20, stage.bottom - 30, { button: 'right' });
  labels = await menuLabels(page);
  t.same(labels, ['Add a root', 'Tidy up the map', 'Fold everything', 'Unfold everything'], 'what the empty map offers');
  t.check('a node is still selected', (await E.selected(page)) !== null);
  var textBefore = await E.text(page);
  var stepsBefore = (await E.history(page)).count;
  await pickMenu(page, 'Add a root');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.eq((await E.history(page)).key, 'editor.label.addRoot', 'the step says: add a root');
  await page.keyboard.type('Second root');
  await page.keyboard.press('Enter');
  t.check('a new root heading, not a sibling of the selected node', /\n# Second root\n?$/.test(await E.text(page)) && !/- Second root/.test(await E.text(page)), await E.text(page));
  t.eq((await E.history(page)).count - stepsBefore, 1, 'one step: the root with its words');
  await page.keyboard.press('Control+z');
  t.eq(await E.text(page), textBefore, 'one undo takes it all back');
  await page.mouse.click(stage.x + 20, stage.bottom - 30, { button: 'right' });
  await pickMenu(page, 'Fold everything');
  await E.until(page, function () { var v = window.MindRoot.session.view; return v.isFolded('0') && v.isFolded('4'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded(''); }), false, 'the root stays open, every branch under it folded');
  await page.evaluate(function () { window.MindRoot.commands.run('node.unfoldAll'); });
  await E.until(page, function () { var v = window.MindRoot.session.view; return !v.isFolded('0') && !v.isFolded('4'); });
  t.check('unfold everything', true);

  t.step('copy a branch to another map');
  await E.select(page, '0');
  var before = await page.evaluate(function (ids) { return window.MindRoot.store.map(ids.pid, ids.mid).text; }, { pid: s.pid, mid: s.mids[1] });
  await page.click('.node-toolbar .btn--more');
  await pickMenu(page, 'Copy the branch to a map');
  labels = await menuLabels(page);
  t.same(labels, ['Other'], 'the other maps are offered');
  await pickMenu(page, 'Other');
  var after = await page.evaluate(function (ids) { return window.MindRoot.store.map(ids.pid, ids.mid).text; }, { pid: s.pid, mid: s.mids[1] });
  t.check('the branch is in the other map', after !== before && /- Alpha\n {2}- Alpha one.*\n {2}- Alpha two\n/.test(after), after);
  t.eq(await E.text(page), await E.text(page), 'this map is unchanged');
  await E.until(page, function () { var x = document.querySelector('.toast:not([hidden]) .toast__text'); return x && /Copied to Other/.test(x.textContent); });
  t.check('a toast says where it went', true);

  t.step('the edge note needs a link to sit on');
  await E.select(page, '');
  t.eq(await page.evaluate(function () { return document.querySelector('.node-toolbar [data-command="node.edgeNote"]').getAttribute('aria-disabled'); }), 'true', 'not on the root');
  await E.select(page, '0');
  t.eq(await page.evaluate(function () { return document.querySelector('.node-toolbar [data-command="node.edgeNote"]').getAttribute('aria-disabled'); }), null, 'on a child, yes');

  t.step('view-only: no toolbar');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await E.until(page, function () { var el = document.querySelector('.node-toolbar'); return el.hidden; });
  t.check('hidden', true);
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });

  t.step('a dense map: the toolbar finds a place that hides no neighbour, and a click on one selects it');
  await page.evaluate(function (ids) {
    window.MindRoot.store.setMapText(ids.pid, ids.mid, '# Fold\n\n## A\n\n- a1\n- a2\n\n## B\n\n- b1\n\n## C\n\n- c1\n');
  }, { pid: s.pid, mid: s.mid });
  await E.until(page, function () { return /## B/.test(window.MindRoot.session.current().text); });
  await E.settled(page);
  await page.evaluate(function () { var v = window.MindRoot.session.view; v.fold('0', true); v.fold('1', true); v.fit({ animate: false }); });
  await E.settled(page);
  await E.clickNode(page, '1');
  await bar(page);
  var hidden = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var tb = document.querySelector('.node-toolbar').getBoundingClientRect();
    return v.visiblePaths().filter(function (p) {
      if (p === '1') return false;
      var r = v.rect(p);
      return r && r.left < tb.right && tb.left < r.right && r.top < tb.bottom && tb.top < r.bottom;
    });
  });
  t.same(hidden, [], 'the folded node between two siblings: neither A nor C is under its toolbar');
  await E.clickNode(page, '0');
  t.eq(await page.evaluate(function () { return !!(window.MindRoot.notes && window.MindRoot.notes.isOpen && window.MindRoot.notes.isOpen()); }), false, 'a click on A selects A and opens nothing else');

  t.step('a small map fitted to the window: no node\'s toolbar hides another node\'s words');
  for (var vp of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(vp);
    await page.evaluate(function (ids) {
      window.MindRoot.store.setMapText(ids.pid, ids.mid, '# Journey\n\n## Italy\n\n- Milan\n  - Cathedral\n  - Canals\n- Rome\n  - Colosseum\n\n## France\n\n- Paris\n  - Louvre\n- Lyon\n\n## Spain\n\n- Madrid\n- Barcelona\n');
    }, { pid: s.pid, mid: s.mid });
    await E.until(page, function () { return /Barcelona/.test(window.MindRoot.session.current().text); });
    await E.settled(page);
    await page.evaluate(function () { window.MindRoot.commands.run('node.unfoldAll'); });
    await E.settled(page);
    await page.evaluate(function () { window.MindRoot.session.view.fit({ animate: false }); });
    await E.settled(page);
    var paths = await page.evaluate(function () { return window.MindRoot.session.view.visiblePaths(); });
    var hides = [];
    for (var p of paths) {
      await E.clickNode(page, p);
      if (!(await bar(page))) continue;
      hides = hides.concat(await page.evaluate(function (sel) {
        var v = window.MindRoot.session.view;
        var tb = document.querySelector('.node-toolbar').getBoundingClientRect();
        return v.visiblePaths().filter(function (q) {
          if (q === sel) return false;
          var r = v.nodeEl(q).querySelector('.mv-title .mv-text').getBoundingClientRect();
          var ix = Math.min(r.right, tb.right) - Math.max(r.left, tb.left);
          var iy = Math.min(r.bottom, tb.bottom) - Math.max(r.top, tb.top);
          return ix > 0 && iy > 0 && ix * iy > 0.05 * r.width * r.height;
        }).map(function (q) { return sel + ' hides ' + q; });
      }, p));
    }
    t.eq(paths.length, 14, vp.width + ' px: the whole map is drawn');
    t.same(hides, [], vp.width + ' px: every node chosen in turn, its toolbar on no other node\'s words');
  }
  var canals = await E.pathOf(page, 'Canals');
  var duomo = await E.pathOf(page, 'Cathedral');
  await E.clickNode(page, canals);
  await bar(page);
  var stepsNow = (await E.history(page)).count;
  await E.clickNode(page, duomo);
  t.eq(await E.selected(page), duomo, 'with Canals chosen, a click on Cathedral just above it selects Cathedral');
  t.eq((await E.history(page)).count, stepsNow, 'and changes nothing in the map');
  await page.setViewportSize({ width: 1280, height: 800 });
};
