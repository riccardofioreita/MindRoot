/* editor-overlap: a node let go on top of other nodes, on the real map with
 * the real mouse. By default it goes to the free place nearest to where it
 * was let go (the others do not move); with "move the others aside" it stays
 * where it was let go and the nodes it covers step out of its way; with
 * "leave it there" nothing moves and they overlap. A branch (a node with
 * what hangs under it) goes as one. Either way it is one undo step, and the
 * choice is in Settings. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

async function hold(page, from, to, steps) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: steps || 10 });
}

async function still(page) {
  await page.waitForFunction(function () {
    var layer = document.querySelector('.mv-layer');
    var now = layer ? layer.style.transform : '';
    var w = window.__still2 || (window.__still2 = { at: '', n: 0 });
    if (w.at === now) w.n++; else { w.at = now; w.n = 0; }
    return w.n >= 4;
  }, null, { polling: 'raf', timeout: 6000 });
}

/* Every pair of drawn nodes that touches (boxes of the layout, in map units). */
function overlaps(page, gap) {
  return page.evaluate(function (g) {
    var v = window.MindRoot.session.view;
    var nodes = v.geometry().nodes;
    var names = Object.keys(nodes);
    var out = [];
    for (var i = 0; i < names.length; i++) for (var j = i + 1; j < names.length; j++) {
      var a = nodes[names[i]];
      var b = nodes[names[j]];
      if (a.x - g < b.x + b.w && a.x + a.w + g > b.x && a.y - g < b.y + b.h && a.y + a.h + g > b.y) out.push([names[i], names[j]]);
    }
    return out;
  }, gap || 0);
}

function centre(page, path) {
  return page.evaluate(function (p) { var n = window.MindRoot.session.view.geometry().nodes[p]; return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null; }, path);
}

/* Where the lifted copy is drawn, in map units: where the node lands. */
function aimed(page) {
  return page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var c = v.camera();
    var r = v.el.getBoundingClientRect();
    var g = document.querySelector('.mv-ghost').getBoundingClientRect();
    return { x: (g.left + g.width / 2 - r.left - c.x) / c.k, y: (g.top + g.height / 2 - r.top - c.y) / c.k };
  });
}

module.exports = async function (t) {
  var map = '# Garden\n\n## Beds\n- Roses\n- Basil\n- Thyme\n\n## Tools\n- Spade\n- Rake\n';
  var b = await E.boot(t, [['Garden', map]]);
  var page = b.page;
  function path(words) { return E.pathOf(page, words); }
  async function dropOn(fromWords, toWords) {
    var from = await E.box(page, await path(fromWords));
    var to = await E.box(page, await path(toWords));
    await hold(page, { x: from.cx, y: from.cy }, { x: to.cx, y: to.cy });
    var aim = await aimed(page);
    await page.mouse.up();
    await E.settled(page);
    await still(page);
    return aim;
  }
  async function setMode(m) { await page.evaluate(function (v) { window.MindRoot.prefs.set('dropOverlap', v); }, m); }

  t.step('to begin with nothing overlaps');
  await still(page);
  t.same(await overlaps(page, 0), [], 'the layout keeps its nodes apart');

  /* ---------------------------------------------------------------- the default: it goes to free space */

  t.step('let go on another node, it goes to the nearest free place');
  var h0 = await E.history(page);
  var aim = await dropOn('Spade', 'Roses');
  t.same(await overlaps(page, 0), [], 'no node touches another');
  var spade = await centre(page, await path('Spade'));
  var dist = Math.hypot(spade.x - aim.x, spade.y - aim.y);
  t.check('it stands close to where it was let go (not back where it came from)', dist > 4 && dist < 220, { aim: aim, spade: spade, dist: dist });
  t.check('it took a place from its parent', /- Spade <!-- at: -?\d+,-?\d+ -->/.test(await E.text(page)) || /Spade[^\n]*<!-- at:/.test(await E.text(page)), await E.text(page));
  var h1 = await E.history(page);
  t.same([h1.count, h1.key], [h0.count + 1, 'editor.label.place'], 'one undo step');
  await page.evaluate(function () { window.MindRoot.store.undo(); });
  await E.settled(page);
  await still(page);
  t.eq(/<!-- at:/.test(await E.text(page)), false, 'one Undo puts everything back');

  t.step('a branch goes as one');
  await dropOn('Beds', 'Rake');
  t.same(await overlaps(page, 0), [], 'the node and its children touch nothing');
  var bedsC = await centre(page, await path('Beds'));
  var rosesC = await centre(page, await path('Roses'));
  t.check('its children came along', Math.abs(rosesC.x - bedsC.x) < 800 && Math.abs(rosesC.y - bedsC.y) < 400, { beds: bedsC, roses: rosesC });
  await page.evaluate(function () { window.MindRoot.store.undo(); });
  await E.settled(page);
  await still(page);

  /* ---------------------------------------------------------------- the others step aside */

  t.step('"move the others aside": it stays where it was let go');
  await setMode('aside');
  var rosesBefore = await centre(page, await path('Roses'));
  var h2 = await E.history(page);
  aim = await dropOn('Spade', 'Roses');
  var spade2 = await centre(page, await path('Spade'));
  t.check('it is where it was let go (lined up with its column when that is a few units away)', Math.abs(spade2.x - aim.x) <= 15 && Math.abs(spade2.y - aim.y) <= 3, { aim: aim, spade: spade2 });
  var rosesAfter = await centre(page, await path('Roses'));
  t.check('the node it covered stepped out of the way', Math.hypot(rosesAfter.x - rosesBefore.x, rosesAfter.y - rosesBefore.y) > 4, { before: rosesBefore, after: rosesAfter });
  t.same(await overlaps(page, 0), [], 'and nothing touches anything');
  var h3 = await E.history(page);
  t.same([h3.count, h3.key], [h2.count + 1, 'editor.label.place'], 'all of it one undo step');
  await page.evaluate(function () { window.MindRoot.store.undo(); });
  await E.settled(page);
  await still(page);
  t.eq(/<!-- at:/.test(await E.text(page)), false, 'one Undo puts everything back, the others too');

  t.step('"move the others aside" when the node is let go on its own parent: the node moves');
  var parentBox = await E.box(page, await path('Beds'));
  var thyme = await E.box(page, await path('Thyme'));
  await hold(page, { x: thyme.cx, y: thyme.cy }, { x: parentBox.cx, y: parentBox.cy });
  await page.mouse.up();
  await E.settled(page);
  await still(page);
  t.same(await overlaps(page, 0), [], 'a parent cannot step aside: the node goes to free space instead');
  await page.evaluate(function () { window.MindRoot.store.undo(); });
  await E.settled(page);
  await still(page);

  /* ---------------------------------------------------------------- what moves along */

  t.step('whatever the node leaves behind stays clear too: many drops, nothing ends up touching');
  for (var mode of ['move', 'aside']) {
    await setMode(mode);
    var res = await page.evaluate(async function () {
      var seed = 4242;
      function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
      function touching() {
        var nodes = window.MindRoot.session.view.geometry().nodes;
        var names = Object.keys(nodes);
        var out = [];
        for (var i = 0; i < names.length; i++) for (var j = i + 1; j < names.length; j++) {
          var a = nodes[names[i]];
          var c = nodes[names[j]];
          if (a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y) out.push([names[i], names[j]]);
        }
        return out;
      }
      var bad = [];
      var done = 0;
      for (var n = 0; n < 60; n++) {
        var g = window.MindRoot.session.view.geometry().nodes;
        var names = Object.keys(g).filter(function (p) { return p !== ''; });
        var p = names[Math.floor(rnd() * names.length)];
        var q = names[Math.floor(rnd() * names.length)];
        if (p === q || q.indexOf(p + '.') === 0) continue;
        var box = g[q];
        window.MindRoot.editor.placeFree(p, box.x + box.w / 2 + (rnd() - 0.5) * 80, box.y + box.h / 2 + (rnd() - 0.5) * 40);
        await new Promise(function (r) { setTimeout(r, 25); });
        done++;
        var ov = touching();
        if (ov.length) bad.push({ n: n, p: p, q: q, ov: ov.slice(0, 2) });
        if (rnd() < 0.2) { window.MindRoot.store.undo(); await new Promise(function (r) { setTimeout(r, 25); }); }
      }
      return { done: done, bad: bad.slice(0, 3), count: bad.length };
    });
    t.check('"' + mode + '": ' + res.done + ' random drops, none leaves anything touching', res.done > 30 && res.count === 0, res);
    for (var u = 0; u < 80; u++) { if (!(await page.evaluate(function () { return /<!-- at:/.test(window.MindRoot.session.current().text); }))) break; await page.evaluate(function () { window.MindRoot.store.undo(); }); }
    await page.evaluate(function () { return window.MindRoot.commands.run('view.fit', { source: 'palette' }); });
    await E.settled(page);
    await still(page);
  }

  /* ---------------------------------------------------------------- leave it there */

  t.step('"leave it there": as before, they overlap');
  await setMode('keep');
  await dropOn('Spade', 'Roses');
  t.check('the node is on top of another', (await overlaps(page, 0)).length > 0, await overlaps(page, 0));
  await page.evaluate(function () { window.MindRoot.store.undo(); });
  await E.settled(page);
  await still(page);

  /* ---------------------------------------------------------------- the choice is in Settings */

  t.step('Settings has the choice');
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#set-drop', { state: 'visible' });
  t.eq(await page.locator('#set-drop [role="radio"]').count(), 3, 'three ways');
  t.eq(await page.getAttribute('#set-drop [data-value="keep"]', 'aria-checked'), 'true', 'the one in use is shown');
  await page.click('#set-drop [data-value="move"]');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('dropOverlap'); }), 'move', 'a choice is kept');
  await page.keyboard.press('Escape');
};
