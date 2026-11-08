/* editor-drag: dragging a node to a new place. Dropped on a node it becomes
 * that node's last child, on its upper or lower band a sibling before or
 * after it; never into its own branch; a place the model refuses (a to-do
 * among sub-headings) is shown refused and changes nothing; Escape cancels;
 * each drop is one undo step, 'move the branch', the moved node selected. */
'use strict';

var E = require('../fixtures/editor/helpers.js');
var Drop = require('../fixtures/map/drop.js');

var MAP = '# Root\n\n- A\n  - A1\n- B\n- C\n';

async function drag(page, fromPath, to, opts) {
  opts = opts || {};
  var a = await E.box(page, fromPath);
  var sx = a.x + Math.min(14, a.w / 3);
  var sy = a.cy;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 2 });
  await page.mouse.move(sx + 20, sy + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await Drop.decided(page);
  if (opts.before) await opts.before();
  await page.mouse.up();
  await E.settled(page);
}

function spot(b, where) {
  var x = b.x + Math.min(20, b.w / 2);
  if (where === 'before') return { x: x, y: b.y + b.h * 0.12 };
  if (where === 'after') return { x: x, y: b.y + b.h * 0.88 };
  return { x: x, y: b.cy };
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Drag', MAP], ['Todo', '# Root\n\n- [ ] Todo\n\n## Sub one\n\n## Sub two\n']]);
  var page = s.page;

  t.step('on a node: its last child');
  var steps = (await E.history(page)).count;
  await drag(page, '2', spot(await E.box(page, '0'), 'child'), {
    before: async function () {
      var lit = await page.evaluate(function () {
        return { ghost: !!document.querySelector('.mv-ghost'), drop: !!document.querySelector('.mv-node--drop[data-path="0"]'), dragging: document.documentElement.hasAttribute('data-node-drag') };
      });
      t.same(lit, { ghost: true, drop: true, dragging: true }, 'a lifted copy follows the pointer and the target is lit');
      t.eq(await E.visible(page, '.node-toolbar'), false, 'the toolbar steps aside');
    }
  });
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n- B\n', 'C is the last child of A');
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.move'], 'one step: move the branch');
  t.eq(await E.selected(page), '0.1', 'the moved node is selected');
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-ghost-host'); }), false, 'the copy is gone');

  t.step('on the upper band: before it; on the lower band: after it');
  await drag(page, '1', spot(await E.box(page, '0'), 'before'));
  t.eq(await E.text(page), '# Root\n\n- B\n- A\n  - A1\n  - C\n', 'B before A');
  await drag(page, '0', spot(await E.box(page, '1.1'), 'after'));
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n  - B\n', 'B after C');

  t.step('never into its own branch: let go there, it only moves');
  steps = (await E.history(page)).count;
  await drag(page, '0', spot(await E.box(page, '0.0'), 'child'));
  t.eq((await E.history(page)).count - steps, 1, 'one step');
  t.check('no node changed parent, A only took a place', /^# Root\n\n- A <!-- at: -?\d+,-?\d+ -->\n {2}- A1\n {2}- C\n {2}- B\n$/.test(await E.text(page)), await E.text(page));
  await page.keyboard.press('Control+z');
  await E.settled(page);
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n  - B\n', 'undone');

  t.step('Escape cancels a drag');
  var a = await E.box(page, '0.2');
  var target = spot(await E.box(page, '0.0'), 'before');
  await page.mouse.move(a.x + 10, a.cy);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.cy + 10, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-ghost'); }), true, 'lifted');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await E.settled(page);
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n  - B\n', 'nothing moved');
  t.eq((await E.history(page)).count, steps, 'no step');
  t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-node-drag'); }), false, 'the drag is over');

  t.step('undo puts it back in one step');
  await drag(page, '0.2', spot(await E.box(page, '0.0'), 'before'));
  t.eq(await E.text(page), '# Root\n\n- A\n  - B\n  - A1\n  - C\n', 'moved');
  await page.keyboard.press('Control+z');
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n  - B\n', 'and back');

  t.step('a place the model refuses is shown refused and changes nothing');
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mids[1] });
  await E.until(page, function (m) { return window.MindRoot.session.current().mapId === m; }, s.mids[1]);
  await E.settled(page);
  var before = await E.text(page);
  steps = (await E.history(page)).count;
  var todo = await E.pathOf(page, 'Todo');
  var sub = await E.pathOf(page, 'Sub one');
  var refused = null;
  await drag(page, todo, spot(await E.box(page, sub), 'after'), {
    before: async function () {
      refused = await page.evaluate(function () { return document.documentElement.hasAttribute('data-drop-refused'); });
    }
  });
  t.eq(refused, true, 'the drop is shown refused while over it');
  t.eq(await E.text(page), before, 'nothing written');
  t.eq((await E.history(page)).count, steps, 'no step');
  await E.until(page, function () { var x = document.querySelector('.toast:not([hidden]) .toast__text'); return x && /cannot go there/.test(x.textContent); });
  t.check('a toast says why', true);

  t.step('view-only: nodes do not lift');
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mid });
  await E.until(page, function (m) { return window.MindRoot.session.current().mapId === m; }, s.mid);
  await E.settled(page);
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await E.until(page, function () { return window.MindRoot.session.readOnly(); });
  before = await E.text(page);
  await drag(page, '0.2', spot(await E.box(page, '0.0'), 'before'));
  t.eq(await E.text(page), before, 'unchanged');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
};
