/* editor-wires: the threads of the selected node. Two handles sit beside it:
 * 'in' on the thread that holds it to its parent, 'out' under the move grip.
 * Pulling 'in' takes the thread off the parent: let go on another node and the
 * branch is plugged into it (its last child), in the open and it is detached
 * where it stands; over the parent it already hangs from nothing happens.
 * Pulling 'out' reaches for another node: let go on one and it becomes a
 * child of the pulled node. A place the model refuses (into its own branch)
 * shows refused and changes nothing; Escape cancels; each use is one undo
 * step; the map's only root has no handles. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- A\n  - A1\n- B\n- C\n';

async function pull(page, selector, to, opts) {
  opts = opts || {};
  var h = await E.rectOf(page, selector);
  var sx = h.x + h.w / 2;
  var sy = h.y + h.h / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (opts.before) await opts.before();
  if (opts.escape) { await page.keyboard.press('Escape'); await page.mouse.up(); } else await page.mouse.up();
  await E.settled(page);
}

function at(b) { return { x: b.x + Math.min(20, b.w / 2), y: b.cy }; }

module.exports = async function (t) {
  var s = await E.boot(t, [['Wires', MAP]]);
  var page = s.page;

  t.step('the handles follow the selection');
  await E.select(page, '2');
  var vis = await page.evaluate(function () {
    return ['in', 'out'].map(function (w) { var e = document.querySelector('.mv-wire--' + w); return !!e && !e.hidden; });
  });
  t.same(vis, [true, true], 'a branch has both threads');
  await E.select(page, '');
  vis = await page.evaluate(function () {
    return ['in', 'out'].map(function (w) { var e = document.querySelector('.mv-wire--' + w); return !!e && !e.hidden; });
  });
  t.same(vis, [false, false], 'the map\'s only root has none (nothing to plug it into)');

  t.step('"in" on a node: the branch is plugged into it');
  await E.select(page, '2');
  var steps = (await E.history(page)).count;
  await pull(page, '.mv-wire--in', at(await E.box(page, '0')), {
    before: async function () {
      var st = await page.evaluate(function () {
        return { thread: !!document.querySelector('.mv-thread'), drop: !!document.querySelector('.mv-node--drop[data-path="0"]'), chip: (document.querySelector('.mv-thread-chip') || {}).textContent || '' };
      });
      t.same([st.thread, st.drop], [true, true], 'a thread follows the pointer and the node it would join is lit');
      t.check('the chip says what letting go does', /^(Plug into|Collega a)/.test(st.chip), st.chip);
    }
  });
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n- B\n', 'C is the last child of A');
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.attach'], 'one step: attach');
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-thread, .mv-thread-chip'); }), false, 'the thread is gone');

  t.step('"in" in the open: the branch is detached where it stands');
  await E.select(page, '0.1');
  steps = (await E.history(page)).count;
  var box = await E.rectOf(page, '.mv-stage, #map, .mv');
  await pull(page, '.mv-wire--in', { x: box.x + box.w - 60, y: box.y + box.h - 60 });
  var text = await E.text(page);
  t.check('C is a top node of its own, with a place', /\n(#|-) C <!-- at: -?\d+,-?\d+ -->\n?$/.test(text) && text.indexOf('  - C') < 0, text);
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.detach'], 'one step: detach');
  await page.keyboard.press('Control+z');
  await E.settled(page);
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n- B\n', 'undone');

  t.step('"in" over the parent it hangs from: nothing');
  await E.select(page, '0.1');
  steps = (await E.history(page)).count;
  await pull(page, '.mv-wire--in', at(await E.box(page, '0')), {
    before: async function () {
      var chip = await page.evaluate(function () { return (document.querySelector('.mv-thread-chip') || {}).textContent || ''; });
      t.check('it says so', /^(Already hangs|È già collegato)/.test(chip), chip);
    }
  });
  t.eq((await E.history(page)).count, steps, 'no step');

  t.step('"in" into its own branch is refused');
  await E.select(page, '0');
  steps = (await E.history(page)).count;
  await pull(page, '.mv-wire--in', at(await E.box(page, '0.0')), {
    before: async function () {
      t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-drop-refused'); }), true, 'shown refused');
    }
  });
  t.eq((await E.history(page)).count, steps, 'no step');

  t.step('"out" onto a node: it becomes a child of the pulled one');
  await E.select(page, '0');
  steps = (await E.history(page)).count;
  await pull(page, '.mv-wire--out', at(await E.box(page, '1')), {
    before: async function () {
      t.check('the chip names the node it takes in', /^(Take in|Prendi)/.test(await page.evaluate(function () { return (document.querySelector('.mv-thread-chip') || {}).textContent || ''; })), '');
    }
  });
  t.eq(await E.text(page), '# Root\n\n- A\n  - A1\n  - C\n  - B\n', 'B is the last child of A');
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.attach'], 'one step');

  t.step('Escape cancels a pulled thread');
  await E.select(page, '0.1');
  steps = (await E.history(page)).count;
  await pull(page, '.mv-wire--in', at(await E.box(page, '0.0')), { escape: true });
  t.eq((await E.history(page)).count, steps, 'no step');
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-thread, .mv-thread-chip'); }), false, 'the thread is gone');
};
