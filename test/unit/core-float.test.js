/* core-float: the clamping maths, and carrying a panel by its grip. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var F = ns.float;
  var U = ns.util;
  var room = { left: 0, top: 0, right: 500, bottom: 400 };

  T.test('fit keeps a panel inside its room', function () {
    T.same(F.fit(50, 60, 100, 100, room), { left: 50, top: 60 }, 'inside stays');
    T.same(F.fit(-30, -10, 100, 100, room), { left: 0, top: 0 }, 'pulled in from the top-left');
    T.same(F.fit(480, 390, 100, 100, room), { left: 400, top: 300 }, 'pulled in from the bottom-right');
  });

  T.test('a panel bigger than its room keeps its start edge and 48px', function () {
    var p = F.fit(100, 0, 700, 100, room);
    T.eq(p.left, 0, 'start edge visible when pushed right');
    var q = F.fit(-1000, 0, 700, 100, room);
    T.eq(q.left, room.right - F.KEEP - 700, 'never further than KEEP from the edge');
    var r = F.fit(0, -5000, 100, 900, room);
    T.eq(r.top, room.bottom - F.KEEP - 900, 'tall panel likewise');
  });

  function pointer(type, el, x, y) {
    el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
  }

  T.test('carrying a panel by its grip', async function () {
    var panel = document.getElementById('panel');
    var grip = document.getElementById('grip');
    var replaced = 0;
    F.attach(panel, grip);
    F.onAnchor(panel, function () { replaced++; });
    T.ok(grip.getAttribute('title'), 'the grip says what it is for');
    var start = panel.getBoundingClientRect();
    pointer('pointerdown', grip, start.left + 5, start.top + 5);
    pointer('pointermove', grip, start.left + 7, start.top + 6);
    await U.nextFrame();
    T.eq(F.moved(panel), false, 'under 3px it is still a tap');
    pointer('pointermove', grip, start.left + 105, start.top + 85);
    await T.until(function () { return F.moved(panel); }, 1000, 'became a drag');
    await U.nextFrame();
    var r = panel.getBoundingClientRect();
    T.eq(Math.round(r.left), Math.round(start.left + 100), 'followed in x');
    T.eq(Math.round(r.top), Math.round(start.top + 80), 'followed in y');
    T.eq(panel.getAttribute('data-moving'), 'true', 'marked while carried');
    pointer('pointerup', grip, start.left + 105, start.top + 85);
    T.eq(panel.hasAttribute('data-moving'), false, 'put down');
    T.eq(panel.getAttribute('data-moved'), 'true', 'remembers it was moved');

    pointer('pointerdown', grip, r.left + 5, r.top + 5);
    pointer('pointermove', grip, 5000, 5000);
    await U.nextFrame();
    await U.nextFrame();
    pointer('pointerup', grip, 5000, 5000);
    var s = panel.getBoundingClientRect();
    var stage = document.getElementById('stage').getBoundingClientRect();
    T.ok(s.right <= stage.right && s.bottom <= stage.bottom, 'kept inside the stage');

    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    T.eq(F.moved(panel), false, 'double-click puts it back');
    T.eq(panel.style.left, '', 'offsets removed');
    T.eq(replaced, 1, 'the owner was asked to place it');
  });

  T.test('place and anchor', function () {
    var panel = document.getElementById('panel');
    var stage = document.getElementById('stage').getBoundingClientRect();
    F.place(panel, { left: stage.left + 30, top: stage.top + 40 });
    var r = panel.getBoundingClientRect();
    T.eq(Math.round(r.left - stage.left), 30, 'placed in x');
    T.eq(Math.round(r.top - stage.top), 40, 'placed in y');
    F.place(panel, { x: stage.right + 100, y: stage.bottom + 100 });
    r = panel.getBoundingClientRect();
    T.ok(r.right <= stage.right && r.bottom <= stage.bottom, 'clamped');
    T.eq(F.moved(panel), false, 'placing is not a hand move');
    T.eq(F.anchor(panel), false, 'nothing to anchor');
  });

  T.test('a smaller window pulls a moved panel back into view', async function () {
    var panel = document.getElementById('panel');
    var stageEl = document.getElementById('stage');
    var grip = document.getElementById('grip');
    var r = panel.getBoundingClientRect();
    pointer('pointerdown', grip, r.left + 5, r.top + 5);
    pointer('pointermove', grip, r.left + 400, r.top + 5);
    await U.nextFrame();
    await U.nextFrame();
    pointer('pointerup', grip, r.left + 400, r.top + 5);
    T.ok(F.moved(panel), 'moved');
    stageEl.style.width = '300px';
    F.reflow();
    var p = panel.getBoundingClientRect();
    T.ok(p.right <= stageEl.getBoundingClientRect().right + 0.5, 'back inside the smaller stage');
    T.ok(F.moved(panel), 'still where the hand put it, as far as it can be');
  });
})();
