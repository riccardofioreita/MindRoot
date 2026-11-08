/* editor-tidy: the map put back in order with one click, and the places a
 * node lands on kept in line. The zoom capsule has a Tidy button (always
 * there on a map that can be edited): it takes every place put by hand off,
 * in one step, and says so when there is nothing to put back. A node let go a
 * few units off the column its siblings stand in joins it; one let go on top
 * of another is moved straight up or down, flush, so the column is kept. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Garden\n\n## Beds\n- Roses\n- Basil\n- Thyme\n- Sage\n';

module.exports = async function (t) {
  var b = await E.boot(t, [['Garden', MAP]]);
  var page = b.page;
  async function geo() { return page.evaluate(function () { return window.MindRoot.session.view.geometry().nodes; }); }
  async function place(path, x, y) {
    await page.evaluate(function (a) { window.MindRoot.editor.placeFree(a.p, a.x, a.y); }, { p: path, x: x, y: y });
    await E.settled(page);
  }

  t.step('the button is in the zoom capsule');
  t.eq(await page.isVisible('#zoombar [data-command="map.tidy"]'), true, 'there, with nothing placed by hand');

  t.step('with nothing to put back it says so and writes nothing');
  var steps = (await E.history(page)).count;
  await page.click('#zoombar [data-command="map.tidy"]');
  await E.until(page, function () { return /already where the layout/i.test(document.body.textContent); });
  t.eq((await E.history(page)).count, steps, 'no step');

  t.step('a node let go a few units off its column joins it');
  var g = await geo();
  var column = g['0.1'].x;
  await place('0.2', g['0.2'].x + g['0.2'].w / 2 + 9, g['0.2'].y + g['0.2'].h / 2 + 90);
  g = await geo();
  t.check('its left edge is the siblings\' (9 units off became at most 1: places are whole units)', Math.abs(g['0.2'].x - column) <= 1, [g['0.2'].x, column]);

  t.step('a node let go far from the column stays where it was let go');
  await place('0.3', g['0.3'].x + g['0.3'].w / 2 + 60, g['0.3'].y + g['0.3'].h / 2 + 120);
  var far = await geo();
  t.check('60 units off stays 60 off', Math.abs(far['0.3'].x - (g['0.3'].x + 60)) <= 1, [far['0.3'].x, g['0.3'].x]);

  t.step('let go on top of another: moved straight up or down, flush, in its column');
  g = await geo();
  var on = g['0.0'];
  await place('0.2', on.x + on.w / 2 + 4, on.y + on.h / 2);
  g = await geo();
  t.check('still in the column', Math.abs(g['0.2'].x - column) <= 1, [g['0.2'].x, column]);
  var a = g['0.0'];
  var c = g['0.2'];
  var gap = c.y >= a.y + a.h ? c.y - (a.y + a.h) : a.y - (c.y + c.h);
  t.check('and clear of the node it was let go on, a gap away', gap >= 10 && gap <= 11, [gap, a, c]);

  t.step('Tidy puts everything back in one step');
  t.check('some places are written', /<!-- at:/.test(await E.text(page)), await E.text(page));
  steps = (await E.history(page)).count;
  await page.click('#zoombar [data-command="map.tidy"]');
  await E.settled(page);
  t.eq(/<!-- at:/.test(await E.text(page)), false, 'every place taken off');
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.tidyMap'], 'one step');
  g = await geo();
  t.same([g['0.0'].x, g['0.1'].x, g['0.2'].x, g['0.3'].x].map(Math.round), [column, column, column, column].map(Math.round), 'the column is whole again');
  await page.keyboard.press('Control+z');
  await E.settled(page);
  t.check('one Undo gives the places back', /<!-- at:/.test(await E.text(page)), await E.text(page));
};
