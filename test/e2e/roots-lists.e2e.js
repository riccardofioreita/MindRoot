/* roots-lists: the words under a title hold lists, a map and its root share
 * a name, branches on the left read from the left, and roots go anywhere.
 *
 * Driven with the real mouse and keyboard: in the text under a title Enter
 * breaks the line and goes on with a list, Tab nests an item, Ctrl+Enter
 * saves; a task box drawn there ticks with a click; renaming the root
 * renames the map in the same undo step, and the sidebar's rename writes
 * back onto the root; a branch let go anywhere stays on its parent where
 * it was let go; Detach makes it a root where it stands, Attach to hangs
 * it on the next node chosen, holding a dragged node still over another
 * hangs it there; a root dragged onto the empty map stays there, every
 * other root keeping its place; the map's one root cannot be put
 * anywhere; the move grip lifts the selected node; while a branch is held
 * a chip says what letting go will do; the whole map goes back in order. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

async function hold(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: steps || 10 });
}

/* The camera has come to rest: the drawn layer stays where it is for a few
 * frames (a reveal after the last drop may still be gliding). */
async function still(page) {
  await page.waitForFunction(function () {
    var layer = document.querySelector('.mv-layer');
    var now = layer ? layer.style.transform : '';
    var w = window.__still || (window.__still = { at: '', n: 0 });
    if (w.at === now) w.n++; else { w.at = now; w.n = 0; }
    return w.n >= 4;
  }, null, { polling: 'raf', timeout: 6000 });
}

async function chip(page) {
  return page.evaluate(function () { var c = document.querySelector('.mv-drop-chip'); return c && !c.hidden ? c.textContent : null; });
}

module.exports = async function (t) {
  var b = await E.boot(t, [['Garden', '# Garden\n\n## Beds\n\n## Tools <!-- side: left -->\n\n### A long name for the tools that wraps onto two lines here\n']]);
  var page = b.page;

  t.step('the words on the left read from the left');
  var align = await page.evaluate(function () {
    var el = Array.prototype.filter.call(document.querySelectorAll('.mv-node--left'), function (n) { return /long name/.test(n.textContent); })[0];
    return el ? getComputedStyle(el).textAlign : null;
  });
  t.eq(align, 'left', 'a node on the left is aligned left');

  t.step('lists in the text under a title');
  var beds = await E.pathOf(page, 'Beds');
  await page.evaluate(function (p) { window.MindRoot.session.select(p); window.MindRoot.editor.startRename(p, { field: 'body' }); }, beds);
  await page.keyboard.type('To do:');
  await page.keyboard.press('Enter');
  t.eq(await E.renaming(page) !== null, true, 'Enter in the text does not save');
  await page.keyboard.type('- dig');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sow');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('carrots');
  t.eq((await E.fields(page)).body, 'To do:\n- dig\n- sow\n  - carrots', 'the list goes on and nests');
  var buttons = await page.evaluate(function () {
    return ['listBullet', 'listNumber', 'listCheck'].map(function (n) { var x = document.querySelector('.format-bar [data-format="' + n + '"]'); return !!x && !x.hidden; });
  });
  t.same(buttons, [true, true, true], 'the format bar offers the three lists');
  await page.click('.format-bar [data-format="listCheck"]');
  t.eq((await E.fields(page)).body, 'To do:\n- dig\n- sow\n  - [ ] carrots', 'the checklist button makes the line a task');
  var steps = (await E.history(page)).count;
  await page.keyboard.press('Control+Enter');
  await E.settled(page);
  t.eq(await E.renaming(page), null, 'Ctrl+Enter saves');
  t.eq((await E.history(page)).count - steps, 1, 'one step');
  t.check('written as quoted lines', /## Beds\n- > text: To do:\n {2}> - dig\n {2}> - sow\n {2}> {3}- \[ \] carrots\n/.test(await E.text(page)), await E.text(page));
  var drawn = await page.evaluate(function () { return document.querySelectorAll('.mv-node .md-li').length; });
  t.eq(drawn, 3, 'drawn as three items');
  var boxAt = await E.rectOf(page, '.mv-node .md-check');
  await page.mouse.click(boxAt.x + boxAt.w / 2, boxAt.y + boxAt.h / 2);
  await E.until(page, function () { return /\[x\] carrots/.test(window.MindRoot.session.current().text); });
  t.check('a click on the box ticks it', true);
  t.eq((await E.history(page)).key, 'editor.label.task', 'one step, "tick the to-do"');

  t.step('the root and the map share a name');
  var mapName = function () { return page.evaluate(function () { return window.MindRoot.session.current().map.name; }); };
  await page.evaluate(function () { window.MindRoot.session.select(''); window.MindRoot.editor.startRename('', { selectAll: true }); });
  await page.keyboard.type('Allotment');
  steps = (await E.history(page)).count;
  await page.keyboard.press('Enter');
  await E.settled(page);
  t.eq(await mapName(), 'Allotment', 'renaming the root renames the map');
  t.eq((await E.history(page)).count - steps, 1, 'in one step');
  await page.keyboard.press('Control+z');
  await E.settled(page);
  t.eq(await mapName(), 'Garden', 'one undo takes back both');
  t.check('the root too', /^# Garden\n/.test(await E.text(page)), await E.text(page));
  await page.evaluate(function (ids) { window.MindRoot.sidebar.renameMap(ids.pid, ids.mid); }, { pid: b.pid, mid: b.mid });
  await E.until(page, function () { return !!document.querySelector('dialog[open] input'); });
  await page.fill('dialog[open] input', 'Orchard');
  await page.keyboard.press('Enter');
  await E.until(page, function () { return /^# Orchard\n/.test(window.MindRoot.session.current().text); });
  t.eq(await mapName(), 'Orchard', 'the sidebar renames the map');
  t.check('and writes the name on the root', true);
  await page.evaluate(function (ids) { window.MindRoot.store.renameMap(ids.pid, ids.mid, 'Kept apart'); }, { pid: b.pid, mid: b.mid });
  await page.evaluate(function () { window.MindRoot.editor.startRename('', { field: 'body' }); });
  await page.keyboard.type('only words');
  await page.keyboard.press('Control+Enter');
  await E.settled(page);
  t.eq(await mapName(), 'Kept apart', 'words written under the root leave the map\'s name alone');
  await page.keyboard.press('Control+z');
  await E.settled(page);

  t.step('the one root has nowhere else to go');
  await E.select(page, '');
  var lone = await page.evaluate(function () { var g = document.querySelector('.mv-grip'); return !!g && !g.hidden; });
  t.eq(lone, false, 'no move grip on the map\'s one root');
  var before = await E.text(page);
  var root = await E.box(page, '');
  await hold(page, { x: root.cx, y: root.cy }, { x: root.cx + 40, y: root.cy + 260 });
  t.eq(await chip(page), 'Not here', 'the chip says so');
  await page.mouse.up();
  await E.settled(page);
  t.eq(await E.text(page), before, 'nothing changed');

  t.step('a branch let go on the empty map stays on its parent, where it was let go');
  var tools = await E.pathOf(page, 'Tools');
  await E.select(page, tools);
  var grip = await E.rectOf(page, '.mv-grip');
  t.check('the selected branch shows its grip', grip && grip.w > 0, grip);
  var stage = await E.rectOf(page, '#stage');
  await hold(page, { x: grip.x + grip.w / 2, y: grip.y + grip.h / 2 }, { x: stage.x + stage.w * 0.3, y: stage.y + stage.h * 0.82 });
  t.eq(await chip(page), 'Place it here', 'the chip says what letting go does');
  t.eq(await page.evaluate(function () { var l = document.querySelector('.mv-drop-link'); return !!l && l.style.display !== 'none'; }), true, 'a dashed link keeps it on its parent');
  await page.mouse.up();
  await E.settled(page);
  var text = await E.text(page);
  t.check('it took a place from its parent, still under it', /\n## Tools <!-- side: left --> <!-- at: -?\d+,\d+ -->\n/.test(text) && /^# Orchard\n/.test(text), text);
  t.check('its child came along', /\n### A long name/.test(text), text);

  t.step('detach makes it a root of its own, where it stands');
  await E.select(page, await E.pathOf(page, 'Tools'));
  var standing = await page.evaluate(function (p) { var v = window.MindRoot.session.view; var n = v.geometry().nodes[p]; return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }, await E.pathOf(page, 'Tools'));
  await page.evaluate(function () { return window.MindRoot.commands.run('node.detach', { source: 'palette' }); });
  await E.settled(page);
  text = await E.text(page);
  t.check('a root now, the first root keeping its place', /^# Orchard <!-- at: -?\d+,-?\d+ -->\n/.test(text) && /\n# Tools <!-- at: -?\d+,-?\d+ -->\n/.test(text), text);
  var nowAt = await page.evaluate(function (p) { var v = window.MindRoot.session.view; var n = v.geometry().nodes[p]; return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }, await E.pathOf(page, 'Tools'));
  t.check('where it stood', Math.abs(nowAt.x - standing.x) <= 1 && Math.abs(nowAt.y - standing.y) <= 1, { before: standing, after: nowAt });

  t.step('a root dragged onto the empty map stays there, the other keeps its place');
  var centre = function (path) {
    return page.evaluate(function (p) { var n = window.MindRoot.session.view.geometry().nodes[p]; return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }, path);
  };
  await still(page);
  var first = await centre('0');
  var second = await E.box(page, '1');
  /* Where it lands is what is looked at here; its child reaches over the other tree, which "leave it there" lets be (editor-overlap covers the rest). */
  await page.evaluate(function () { window.MindRoot.prefs.set('dropOverlap', 'keep'); });
  var drop = { x: stage.x + stage.w * 0.8, y: stage.y + stage.h * 0.3 };
  await hold(page, { x: second.cx, y: second.cy }, drop);
  t.eq(await chip(page), 'Place it here', 'the chip says it');
  /* Where the lifted copy is drawn is where the root lands (it is held by
   * the point the drag started at, a little way from the press). */
  var aim = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var c = v.camera();
    var r = v.el.getBoundingClientRect();
    var g = document.querySelector('.mv-ghost').getBoundingClientRect();
    return { x: (g.left + g.width / 2 - r.left - c.x) / c.k, y: (g.top + g.height / 2 - r.top - c.y) / c.k };
  });
  await page.mouse.up();
  await E.settled(page);
  var firstAfter = await centre('0');
  t.check('the first root did not move', Math.abs(firstAfter.x - first.x) <= 1 && Math.abs(firstAfter.y - first.y) <= 1, { first: first, after: firstAfter });
  var moved = await centre('1');
  t.check('the second stands where it was let go', Math.abs(moved.x - aim.x) <= 3 && Math.abs(moved.y - aim.y) <= 3, { moved: moved, aim: aim });
  await page.evaluate(function () { window.MindRoot.prefs.set('dropOverlap', 'move'); });

  t.step('dragging shows where a branch will hang');
  /* The drop before may still be revealing its node: aim once the camera rests. */
  await still(page);
  var bedsBox = await E.box(page, await E.pathOf(page, 'Beds'));
  var orchard = await E.box(page, '0');
  /* The step before let Tools' long child lie where it landed, which may be
   * over part of Beds (where depends on the camera then): Beds is taken at
   * a point of its box where it is Beds that is on top. */
  var grab = await page.evaluate(function (b) {
    var fys = [0.5, 0.25, 0.75, 0.15, 0.85];
    var fxs = [0.5, 0.35, 0.2, 0.65, 0.8];
    for (var i = 0; i < fys.length; i++) {
      for (var k = 0; k < fxs.length; k++) {
        var x = b.x + b.w * fxs[k];
        var y = b.y + b.h * fys[i];
        var n = document.elementFromPoint(x, y);
        n = n && n.closest('.mv-node');
        if (n && /^Beds/.test(n.textContent)) return { x: x, y: y };
      }
    }
    return { x: b.cx, y: b.cy };
  }, bedsBox);
  await hold(page, grab, { x: orchard.x + 6, y: orchard.cy });
  t.eq(await chip(page), 'Hold still to hang it on \u201cOrchard\u201d', 'over a node: hold still to hang it there');
  await E.until(page, function () { var c = document.querySelector('.mv-drop-chip'); return c && /left of/.test(c.textContent); });
  var shown = await page.evaluate(function () {
    var link = document.querySelector('.mv-drop-link');
    var slot = document.querySelector('.mv-drop-slot');
    return { link: !!link && link.style.display !== 'none', slot: !!slot && !slot.hidden };
  });
  t.same(shown, { link: true, slot: true }, 'a dashed link and the place it would take');
  t.eq(await chip(page), 'A branch on the left of “Orchard”', 'the chip names the side and the node');
  await page.mouse.up();
  await E.settled(page);
  t.check('it went to the left', /## Beds <!-- side: left -->/.test(await E.text(page)), await E.text(page));

  t.step('attach to: the next node chosen becomes the parent');
  await E.select(page, await E.pathOf(page, 'Beds'));
  await page.evaluate(function () { return window.MindRoot.commands.run('node.attach', { source: 'palette' }); });
  t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-linking'); }), true, 'waiting for a node');
  await still(page);
  var toolsBox = await E.box(page, await E.pathOf(page, 'Tools'));
  await page.mouse.click(toolsBox.cx, toolsBox.cy);
  await E.settled(page);
  var hung = await page.evaluate(function () {
    var c = window.MindRoot.session.current();
    var D = window.MindRoot.doc;
    var beds = c.state.flat.filter(function (e) { return D.plainText(e) === 'Beds'; })[0];
    return beds ? D.plainText(c.state.flat[beds.parentIndex]) : null;
  });
  t.eq(hung, 'Tools', 'Beds hangs from Tools now');
  t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-linking'); }), false, 'and the choosing is over');

  t.step('put the whole map back in order');
  await page.evaluate(function () { return window.MindRoot.commands.run('map.tidy', { source: 'palette' }); });
  await E.settled(page);
  t.check('every place taken off', !/<!-- at:/.test(await E.text(page)), await E.text(page));
  var tidySteps = (await E.history(page)).count;
  await page.evaluate(function () { return window.MindRoot.commands.run('map.tidy', { source: 'palette' }); });
  await E.settled(page);
  t.eq((await E.history(page)).count, tidySteps, 'again, with nothing to put back: no step (it says so)');
};
