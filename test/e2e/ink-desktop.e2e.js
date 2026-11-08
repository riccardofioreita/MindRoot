/* ink: the drawing editor under a real hand, on a desktop.
 *
 * test/fixtures/ink/host.html mounts the editor alone (tokens, ink.css, a
 * strings stub, ink.js). Mouse and keyboard come from Playwright; the pen
 * comes from the DevTools protocol, which sends real pen PointerEvents with
 * pressure. The two things a page cannot get from the protocol - the back
 * of a pen (button 5) and its barrel button (button 2) - are dispatched as
 * PointerEvents, as the old app's eraser test did.
 *
 * Covered: freehand with the mouse and with pen pressure, the save after
 * 600 ms and only on real change, the keys and that they never reach the
 * page, shapes and Shift, text, select / move / resize / duplicate / front /
 * delete, the eraser's three modes with its fade, Escape and one undo step,
 * the pen's eraser end and barrel button, zoom, undo and redo buttons,
 * opening a saved drawing and an old Excalidraw one, read only, Done, the
 * focus staying in the editor after a choice in a popover, Done when the
 * host cannot save, Mod+S while writing, a pasted soft line break, a file
 * from a newer version, the top bars at every width (wide only where both
 * fit), and the Italian strings. */
'use strict';

module.exports = async function (t) {
  var page = t.page;
  var cdp = await t.context.newCDPSession(page);

  async function load(query) {
    await page.goto(t.fileUrl('test/fixtures/ink/host.html') + (query || ''));
    await page.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
  }

  /* Mounts with the camera at 1:1 on the page, so scene and client
   * coordinates are the same numbers. */
  async function mount(code) {
    await page.evaluate(function (c) {
      var opts = c ? (new Function('return ' + c))() : {};
      window.mount(opts);
      window.editor.setCamera({ x: 0, y: 0, k: 1 });
      window.leaked = [];
    }, code || null);
  }

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function scene() { return ev(function () { return window.editor.scene(); }); }
  function count() { return ev(function () { return window.editor.scene().length; }); }
  function until(fn, arg, what) {
    return page.waitForFunction(fn, arg, { timeout: 5000, polling: 30 }).then(function () { return true; }, function () {
      t.check('waited for ' + (what || 'a condition'), false, 'timed out');
      return false;
    });
  }

  async function drag(from, to, steps, opts) {
    opts = opts || {};
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down({ button: opts.button || 'left' });
    await page.mouse.move(to[0], to[1], { steps: steps || 10 });
    if (!opts.hold) await page.mouse.up({ button: opts.button || 'left' });
  }

  async function path(points, opts) {
    opts = opts || {};
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (var i = 1; i < points.length; i++) await page.mouse.move(points[i][0], points[i][1]);
    if (!opts.hold) await page.mouse.up();
  }

  async function pen(points, forces) {
    function f(i) { return forces ? forces[i] : 0.5; }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0][0], y: points[0][1], pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points[0][0], y: points[0][1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: f(0) });
    for (var i = 1; i < points.length; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[i][0], y: points[i][1], button: 'left', buttons: 1, pointerType: 'pen', force: f(i) });
    }
    var last = points[points.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  }

  function line(x1, y1, x2, y2, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
    return pts;
  }

  /* A pen pointer the protocol cannot send: the eraser end, the barrel. */
  function synthPen(points, button, buttons, opts) {
    return ev(function (a) {
      var surface = document.querySelector('.ink__surface');
      var id = 700 + Math.floor(Math.random() * 1000);
      function fire(type, p, b, bs) {
        var e = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'pen', isPrimary: true, clientX: p[0], clientY: p[1], button: b, buttons: bs, pressure: bs ? 0.5 : 0 });
        surface.dispatchEvent(e);
      }
      fire('pointerdown', a.points[0], a.button, a.buttons);
      for (var i = 1; i < a.points.length; i++) fire('pointermove', a.points[i], -1, a.buttons);
      var end = a.points[a.points.length - 1];
      fire('pointerup', end, a.button, 0);
      var menu = null;
      if (a.menu) {
        menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: end[0], clientY: end[1] });
        surface.dispatchEvent(menu);
      }
      return { tool: window.editor.tool(), count: window.editor.scene().length, menuPrevented: menu ? menu.defaultPrevented : null };
    }, { points: points, button: button, buttons: buttons, menu: !!(opts && opts.menu) });
  }

  await load('');
  await mount();

  /* ---------------------------------------------------------------- mouse */

  t.step('freehand with the mouse');
  t.eq(await ev(function () { return document.activeElement === window.editor.el; }), true, 'the editor takes the focus when it opens');
  await page.keyboard.press('p');
  t.eq(await ev(function () { return window.editor.tool(); }), 'pen', 'P takes the pen');
  await path(line(200, 300, 500, 330, 25));
  var s1 = await scene();
  t.eq(s1.length, 1, 'one stroke');
  t.check('drawn with simulated pressure, many points', s1[0].type === 'stroke' && s1[0].sim === true && s1[0].points.length >= 10, s1[0]);
  t.check('on the sheet where the hand went', Math.abs(s1[0].points[0][0] - 200) < 1 && Math.abs(s1[0].points[s1[0].points.length - 1][0] - 500) < 1, s1[0].points[0]);
  t.eq(await ev(function () { return document.querySelectorAll('.ink__scene path[data-id]').length; }), 1, 'one filled path on screen');
  t.eq(await ev(function () { return document.querySelectorAll('.ink__live *').length; }), 0, 'the live stroke is gone once committed');
  t.eq(await ev(function () { return window.saves.length + ',' + window.editor.saveState(); }), '0,dirty', 'not saved at once, marked unsaved');
  await until(function () { return window.saves.length === 1; }, null, 'the save');
  t.eq(await ev(function () { return window.MindRoot.ink.parse(window.saves[0]).elements.length + ',' + window.editor.saveState() + ',' + window.editor.el.getAttribute('data-save'); }), '1,saved,saved', 'saved 600 ms later, and it says so');
  await page.mouse.wheel(0, 120);
  await ev(function () { window.editor.setTool('rect'); window.editor.setTool('pen'); });
  await t.sleep(800);
  t.eq(await ev(function () { return window.saves.length + ',' + window.editor.isDirty(); }), '1,false', 'a pan and a change of tool save nothing');
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 1 }); });

  /* ---------------------------------------------------------------- pen pressure */

  t.step('a pen with pressure');
  var ramp = [];
  var pts = line(200, 450, 600, 450, 40);
  for (var i = 0; i < pts.length; i++) ramp.push(0.1 + 0.9 * i / (pts.length - 1));
  await pen(pts, ramp);
  var penStroke = (await scene())[1];
  t.check('a pen stroke keeps the pressure it was drawn with', penStroke && penStroke.sim === false, penStroke);
  var pr = penStroke.points.map(function (p) { return p[2]; });
  t.check('from light to hard', Math.abs(pr[0] - 0.1) < 0.02 && Math.abs(pr[pr.length - 1] - 1) < 0.02 && pr[20] > pr[5], pr);
  var widths = await ev(function () {
    var el = window.editor.scene()[1];
    var E = window.MindRoot.ink.engine;
    var poly = E.strokeOutline(el.points, { size: el.size, thinning: el.thinning, smoothing: el.smoothing, streamline: el.streamline, simulatePressure: false, cap: el.cap, last: true });
    function half(x0, x1) {
      return Math.max.apply(null, poly.filter(function (p) { return p[0] > x0 && p[0] < x1; }).map(function (p) { return Math.abs(p[1] - 450); }));
    }
    return [half(230, 300), half(500, 570)];
  });
  t.check('and the line is thicker where the pen pressed harder', widths[1] > widths[0] * 1.5, widths);
  t.eq(await ev(function () { return window.editor.penSeen(); }), true, 'the editor knows a pen is about');

  /* ---------------------------------------------------------------- the pen's other ends */

  t.step('the back of the pen and its barrel button');
  await ev(function () { window.editor.setEraser({ mode: 'part', size: 20 }); });
  var back = await synthPen(line(350, 250, 350, 520, 20), 5, 32);
  t.eq(back.count + ',' + back.tool, '4,pen', 'the back of the pen cuts both strokes, and the pen stays in hand');
  await ev(function () { window.editor.undo(); });
  t.eq(await count(), 2, 'one undo puts both back');
  var side = await synthPen(line(420, 250, 420, 520, 20), 2, 2, { menu: true });
  t.eq(side.count + ',' + side.tool + ',' + side.menuPrevented, '4,pen,true', 'the barrel button dragged erases, and the menu it sends after is swallowed');
  var tap = await synthPen([[600, 300], [602, 301]], 2, 2);
  t.eq(tap.count, 4, 'a barrel press that does not travel erases nothing');
  await ev(function () { window.editor.undo(); });
  t.eq(await count(), 2, 'back to the two strokes');

  /* ---------------------------------------------------------------- keys */

  t.step('keys: every tool, and nothing reaches the page');
  var keys = [['v', 'select'], ['h', 'hand'], ['r', 'rect'], ['o', 'ellipse'], ['d', 'diamond'], ['l', 'line'], ['a', 'arrow'], ['t', 'text']];
  for (var k = 0; k < keys.length; k++) {
    await page.keyboard.press(keys[k][0]);
    if (keys[k][0] === 't') {
      t.eq(await ev(function () { return window.editor.tool(); }), 'text', 'T takes text');
      continue;
    }
    t.eq(await ev(function () { return window.editor.tool(); }), keys[k][1], keys[k][0].toUpperCase() + ' takes ' + keys[k][1]);
  }
  await page.keyboard.press('h');
  await page.keyboard.press('e');
  t.eq(await ev(function () { return window.editor.tool(); }), 'eraser', 'E takes the eraser');
  await page.keyboard.press('e');
  t.eq(await ev(function () { return window.editor.tool(); }), 'hand', 'E again gives back what was in hand');
  await page.keyboard.press('0');
  t.eq(await ev(function () { return window.editor.tool(); }), 'eraser', '0 takes the eraser too');
  await page.keyboard.press('p');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+Z');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  t.same(await ev(function () { return window.leaked; }), [], 'no key reached the page');
  await page.keyboard.press('Escape');
  t.same(await ev(function () { return window.leaked; }), ['Escape'], 'Escape with nothing to close here goes on to the app');

  /* ---------------------------------------------------------------- shapes */

  t.step('shapes, and Shift');
  await page.keyboard.press('r');
  await page.mouse.move(700, 150);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(800, 210, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  var rect = (await scene()).pop();
  t.eq(rect.type + ',' + rect.w + ',' + rect.h, 'rect,100,100', 'Shift makes a square');
  await page.keyboard.press('o');
  await drag([850, 150], [970, 210], 6);
  var oval = (await scene()).pop();
  t.eq(oval.type + ',' + oval.w + ',' + oval.h, 'ellipse,120,60', 'an ellipse');
  await page.keyboard.press('d');
  await drag([1000, 150], [1080, 230], 6);
  t.eq((await scene()).pop().type, 'diamond', 'a diamond');
  await page.keyboard.press('l');
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(800, 312, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  var ruled = (await scene()).pop();
  t.check('Shift puts a line on the nearest 15 degrees', ruled.type === 'line' && Math.abs(ruled.points[1][1] - 300) < 0.01, ruled.points);
  await page.keyboard.press('a');
  await drag([700, 360], [880, 360], 6);
  var arrow = (await scene()).pop();
  t.eq(arrow.type, 'arrow', 'an arrow');
  t.eq(await ev(function (id) { return (document.querySelector('[data-id="' + id + '"]').getAttribute('d').match(/M/g) || []).length; }, arrow.id), 2, 'drawn with its head');
  await page.mouse.click(1150, 500);
  t.eq((await scene()).pop().id, arrow.id, 'a click with a shape tool draws nothing');

  t.step('the shape options');
  await page.click('.ink__tool[data-tool="rect"]');
  await page.click('.ink__tool[data-tool="rect"]');
  t.eq(await ev(function () { return !document.querySelector('.ink__pop').hidden && document.querySelector('.ink__pop').getAttribute('data-kind'); }), 'shape', 'pressing the shape in hand again opens its options');
  await page.click('.ink__pop [role="radio"][aria-label="Full"]');
  await page.click('.ink__pop [role="radio"][aria-label="Thick"]');
  await page.click('.ink__pop .ink__colors [aria-label="Blue"]');
  await page.mouse.click(640, 700);
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden; }), true, 'a press outside closes it');
  await drag([700, 420], [780, 480], 6);
  var filled = (await scene()).pop();
  t.eq(filled.fill + ',' + filled.width + ',' + filled.color, 'solid,8,#2f6fb3', 'the next shape has the fill, line and colour chosen');
  t.eq(await ev(function (id) { return document.querySelector('[data-id="' + id + '"]').getAttribute('fill'); }, filled.id), '#2f6fb3', 'and is filled on screen');

  /* ---------------------------------------------------------------- text */

  t.step('text');
  await page.keyboard.press('t');
  await page.mouse.click(250, 620);
  t.eq(await ev(function () { var ta = document.querySelector('.ink__text'); return !ta.hidden && document.activeElement === ta; }), true, 'a tap opens a field there, with the caret in it');
  await page.keyboard.type('Hello <b>&');
  await page.keyboard.press('Enter');
  await page.keyboard.type('world');
  t.same(await ev(function () { return window.leaked; }), ['Escape'], 'typing never reaches the page');
  await page.keyboard.press('Escape');
  var words = (await scene()).pop();
  t.eq(words.type + '|' + words.text, 'text|Hello <b>&\nworld', 'Escape writes it on the sheet');
  t.same(await ev(function (id) { return Array.prototype.map.call(document.querySelectorAll('[data-id="' + id + '"] tspan'), function (s) { return s.textContent; }); }, words.id), ['Hello <b>&', 'world'], 'shown as text, one line each, nothing interpreted');
  t.eq(await ev(function () { return document.querySelector('.ink__text').hidden + ',' + (document.activeElement === window.editor.el); }), 'true,true', 'the field goes and the focus comes back to the sheet');
  var box = await ev(function (id) { var r = document.querySelector('[data-id="' + id + '"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, words.id);
  await page.mouse.click(box[0] + 10, box[1] + 8);
  t.eq(await ev(function () { return document.querySelector('.ink__text').value; }), 'Hello <b>&\nworld', 'a tap on a text with the text tool writes in it');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('One');
  await page.mouse.click(1100, 650);
  var edited = (await scene()).filter(function (el) { return el.id === words.id; })[0];
  t.eq(edited && edited.text, 'One', 'a tap elsewhere keeps the change, on the same text');
  t.eq(await ev(function () { return document.querySelector('.ink__text').hidden; }), true, 'and closes the field without opening another');
  var before = await count();
  await page.mouse.click(600, 680);
  await page.keyboard.press('Escape');
  t.eq(await count(), before, 'a field left empty adds nothing');

  /* ---------------------------------------------------------------- select */

  t.step('select, move, resize, duplicate, front, delete');
  await page.keyboard.press('v');
  await page.mouse.click(700, 180);
  t.same(await ev(function () { return window.editor.selection(); }), [rect.id], 'a tap on the square selects it');
  t.eq(await ev(function () { return document.querySelectorAll('.ink__handle').length + ',' + document.querySelector('.ink__selbar').hidden; }), '8,false', 'eight handles and the selection bar');
  var undoDepth = await ev(function () { return window.editor.canUndo(); });
  await drag([700, 180], [750, 220], 8);
  var moved = (await scene()).filter(function (el) { return el.id === rect.id; })[0];
  t.eq(moved.x + ',' + moved.y, '750,190', 'dragged by 50, 40');
  await ev(function () { window.editor.undo(); });
  var back1 = (await scene()).filter(function (el) { return el.id === rect.id; })[0];
  t.eq(back1.x + ',' + back1.y + ',' + undoDepth, '700,150,true', 'one undo for the whole move');
  await ev(function () { window.editor.redo(); });
  var handle = await ev(function () { var h = document.querySelector('.ink__handle[data-handle="se"]').getBoundingClientRect(); return [h.left + h.width / 2, h.top + h.height / 2]; });
  await drag(handle, [handle[0] + 50, handle[1] + 50], 8);
  var grown = (await scene()).filter(function (el) { return el.id === rect.id; })[0];
  t.check('the corner handle resizes, the opposite corner stays', Math.abs(grown.x - 750) < 0.01 && Math.abs(grown.y - 190) < 0.01 && Math.abs(grown.w - 150) < 0.01 && Math.abs(grown.h - 150) < 0.01, grown);
  t.eq(grown.width, 4, 'and the line keeps its width');
  await page.keyboard.press('Control+d');
  var all = await scene();
  var dup = all[all.length - 1];
  t.check('Mod+D duplicates, a little aside, and selects the copy', dup.type === 'rect' && dup.id !== rect.id && Math.abs(dup.x - grown.x - 16) < 0.01 &&
    JSON.stringify(await ev(function () { return window.editor.selection(); })) === JSON.stringify([dup.id]), dup);
  await page.keyboard.press('Delete');
  t.eq((await scene()).some(function (el) { return el.id === dup.id; }), false, 'Delete takes it away');
  await page.mouse.click(200, 300);
  var first = (await scene())[0].id;
  t.same(await ev(function () { return window.editor.selection(); }), [first], 'a tap on the first stroke selects it');
  await page.click('.ink__selbar [aria-label="Bring to front"]');
  t.eq((await scene()).pop().id, first, 'Bring to front puts it on top');
  await page.mouse.move(100, 560);
  await page.mouse.down();
  await page.mouse.move(650, 590, { steps: 4 });
  await page.mouse.move(650, 100, { steps: 4 });
  await page.mouse.up();
  var picked = await ev(function () { return window.editor.selection().length; });
  t.check('a marquee selects what lies wholly inside it', picked >= 1, picked);
  await page.keyboard.press('Escape');
  t.eq(await ev(function () { return window.editor.selection().length; }), 0, 'Escape clears the selection');
  await page.mouse.click(grown.x + 4, grown.y + 4);
  t.same(await ev(function () { return window.editor.selection(); }), [rect.id], 'the square selected again by its edge');
  var mid = [grown.x + grown.w / 2, grown.y + grown.h / 2];
  await drag(mid, [mid[0] - 30, mid[1] + 10], 6);
  var dragged = (await scene()).filter(function (el) { return el.id === rect.id; })[0];
  t.eq(Math.round(dragged.x - grown.x) + ',' + Math.round(dragged.y - grown.y), '-30,10', 'a drag inside its frame moves it, though a hollow shape has no middle to grab');
  await page.keyboard.press('Escape');
  var nText = await count();
  await page.mouse.dblclick(1150, 620);
  t.eq(await ev(function () { return !document.querySelector('.ink__text').hidden; }), true, 'a double click on empty paper starts a text');
  await page.keyboard.type('here');
  await page.keyboard.press('Escape');
  t.eq((await count()) - nText, 1, 'written there');
  var textBox = await ev(function (id) { var r = document.querySelector('[data-id="' + id + '"]').getBoundingClientRect(); return [r.left + 6, r.top + 8]; }, words.id);
  await page.mouse.dblclick(textBox[0], textBox[1]);
  t.eq(await ev(function () { return document.querySelector('.ink__text').value; }), 'One', 'a double click on a text writes in it');
  await page.keyboard.press('Escape');

  /* ---------------------------------------------------------------- eraser */

  t.step('the eraser: modes, fade, Escape, one step');
  await page.keyboard.press('p');
  await path(line(150, 720, 600, 720, 30));
  await page.keyboard.press('e');
  await page.click('.ink__tool[data-tool="eraser"]');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').getAttribute('data-kind') + ',' + document.querySelectorAll('.ink__pop [role="radio"]').length; }), 'eraser,3', 'pressing the eraser in hand again opens its three modes');
  await page.click('.ink__pop [role="radio"][aria-label="Whole stroke"]');
  t.eq(await ev(function () { return window.editor.settings().eraser.mode; }), 'stroke', 'Whole stroke chosen');
  await page.click('.ink__tool[data-tool="pen"]');
  t.eq(await ev(function () { return window.editor.tool() + ',' + document.querySelector('.ink__pop').hidden + ',' + document.querySelector('.ink__tool[data-tool="eraser"]').getAttribute('aria-pressed'); }), 'pen,true,false', 'the pen pressed while erasing gives the pen back and closes the options');
  await page.click('.ink__tool[data-tool="eraser"]');
  t.eq(await ev(function () { return window.editor.tool() + ',' + document.querySelector('.ink__pop').hidden; }), 'eraser,true', 'one press takes the eraser again, its options stay shut');
  await page.mouse.click(640, 760);
  var n0 = await count();
  await page.mouse.move(400, 700);
  await page.mouse.down();
  await page.mouse.move(400, 740, { steps: 5 });
  var fadedNow = await ev(function () { return document.querySelectorAll('.ink__scene [data-faded]').length; });
  await page.mouse.up();
  t.eq(fadedNow, 1, 'what the eraser will take fades while the gesture lasts');
  t.eq(await count(), n0 - 1, 'and goes whole when it ends');
  await ev(function () { window.editor.undo(); });
  await ev(function () { window.editor.setEraser({ mode: 'part', size: 20 }); });
  await page.mouse.move(380, 700);
  await page.mouse.down();
  await page.mouse.move(380, 740, { steps: 5 });
  var during = await ev(function () { return document.querySelectorAll('.ink__scene [data-id]').length; });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  t.eq(during + ',' + (await count()) + ',' + (await ev(function () { return window.editor.busy() + ',' + document.querySelectorAll('.ink__scene [data-id]').length; })), (n0 + 1) + ',' + n0 + ',false,' + n0, 'the stroke cut under the eraser at once, and Escape in the middle gives everything back');
  t.eq(await ev(function () { return window.editor.canRedo(); }), true, 'leaving no step behind (the redo is still there)');
  t.eq(await ev(function () { return document.querySelectorAll('.ink__scene [data-faded]').length; }), 0, 'and nothing stays faded');
  await ev(function () { window.editor.setEraser({ mode: 'area' }); });
  var shapes = await scene();
  var square = shapes.filter(function (el) { return el.id === rect.id; })[0];
  var loop = [].concat(line(square.x - 20, square.y - 20, square.x + square.w + 20, square.y - 20, 6),
    line(square.x + square.w + 20, square.y - 20, square.x + square.w + 20, square.y + square.h + 20, 6),
    line(square.x + square.w + 20, square.y + square.h + 20, square.x - 20, square.y + square.h + 20, 6),
    line(square.x - 20, square.y + square.h + 20, square.x - 20, square.y - 15, 6));
  var beforeLoop = await count();
  await page.mouse.move(loop[0][0], loop[0][1]);
  await page.mouse.down();
  for (var q = 1; q < loop.length; q++) await page.mouse.move(loop[q][0], loop[q][1]);
  t.eq(await ev(function () { return document.querySelectorAll('.ink__lasso').length; }), 2, 'the loop is drawn as it goes, with its closing line');
  await page.mouse.up();
  t.eq((await scene()).some(function (el) { return el.id === rect.id; }), false, 'Area takes what the loop holds');
  t.eq(await ev(function () { return document.querySelectorAll('.ink__lasso').length; }), 0, 'and the loop goes with the gesture');

  /* ---------------------------------------------------------------- zoom */

  t.step('zoom and pan');
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 1 }); });
  await page.mouse.move(640, 400);
  var under = await ev(function () { return window.editor.toScene(640, 400); });
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  var cam = await ev(function () { return window.editor.camera(); });
  var still = await ev(function () { return window.editor.toScene(640, 400); });
  t.check('Ctrl+wheel zooms in at the cursor', cam.k > 1.3 && Math.abs(still[0] - under[0]) < 0.01 && Math.abs(still[1] - under[1]) < 0.01, { cam: cam, under: under, still: still });
  await page.click('.ink__zoom [aria-label="Back to 100%"]');
  t.eq(await ev(function () { return window.editor.camera().k; }), 1, 'the zoom level button goes back to 100%');
  t.eq(await ev(function () { return document.querySelector('.ink__zoom-level').textContent; }), '100%', 'and shows it');
  await page.click('.ink__zoom [aria-label="Zoom in"]');
  t.eq(await ev(function () { return Math.round(window.editor.camera().k * 100); }), 125, 'Zoom in');
  await page.click('.ink__zoom [aria-label="Fit the drawing"]');
  var fitted = await ev(function () {
    var E = window.MindRoot.ink.engine;
    var box = E.contentBox(window.editor.elements(), null);
    var a = window.editor.toClient(box[0], box[1]);
    var b = window.editor.toClient(box[2], box[3]);
    return a[0] >= 0 && a[1] >= 0 && b[0] <= innerWidth && b[1] <= innerHeight;
  });
  t.eq(fitted, true, 'Fit shows the whole drawing');
  var c0 = await ev(function () { return window.editor.camera(); });
  await page.mouse.move(640, 400);
  await page.mouse.wheel(40, 80);
  var c1 = await ev(function () { return window.editor.camera(); });
  t.eq(Math.round(c0.x - c1.x) + ',' + Math.round(c0.y - c1.y) + ',' + (c0.k === c1.k), '40,80,true', 'a plain wheel pans');
  await page.keyboard.press('h');
  await drag([600, 600], [500, 550], 5);
  var c2 = await ev(function () { return window.editor.camera(); });
  t.eq(Math.round(c1.x - c2.x) + ',' + Math.round(c1.y - c2.y), '100,50', 'the hand drags the sheet');
  await page.keyboard.press('p');
  await page.keyboard.down('Space');
  var n1 = await count();
  await drag([600, 600], [550, 600], 5);
  await page.keyboard.up('Space');
  t.eq(await count(), n1, 'Space held turns any tool into the hand');
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(600, 400, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  t.eq(await count(), n1, 'and so does the middle button');

  /* ---------------------------------------------------------------- undo buttons */

  t.step('undo and redo buttons');
  var n2 = await count();
  await page.click('.ink__actions [aria-label="Undo"]');
  t.eq(await count(), beforeLoop, 'Undo brings back all the loop took, in one step');
  await page.click('.ink__actions [aria-label="Redo"]');
  t.eq(await count(), n2, 'Redo');
  t.eq(await ev(function () { return document.querySelector('.ink__actions [aria-label="Redo"]').disabled; }), true, 'Redo greys out with nothing to redo');

  /* ---------------------------------------------------------------- opening files */

  t.step('a saved drawing opens as it was saved');
  await until(function () { return !window.editor.isDirty(); }, null, 'everything saved');
  var saved = await ev(function () { return window.saves[window.saves.length - 1]; });
  var wanted = await scene();
  await page.evaluate(function (svg) { window.mount({ svgText: svg }); }, saved);
  t.same(await scene(), wanted, 'every element back');
  t.eq(await ev(function () { return window.editor.isDirty() + ',' + window.editor.saveState(); }), 'false,clean', 'and nothing to save');
  t.eq(await ev(function () { return window.closes.length; }), 0, 'remounting is not a close of the new one');

  t.step('an old Excalidraw drawing becomes the background');
  await mount('{ svgText: INK_SAMPLES.EXCALIDRAW }');
  var bg = await ev(function () { var img = document.querySelector('image.ink__bg'); return img ? img.getAttribute('href').slice(0, 26) + ',' + img.getAttribute('width') : null; });
  t.eq(bg, 'data:image/svg+xml;base64,,240', 'shown as a picture behind the sheet');
  t.eq(await ev(function () { return window.editor.scene().length + ',' + window.editor.isDirty(); }), '0,false', 'nothing to edit, nothing to save until drawn on');
  await page.keyboard.press('p');
  await path(line(40, 200, 200, 230, 12));
  await until(function () { return window.saves.length === 1; }, null, 'the first save of the new drawing');
  var kept = await ev(function () { var got = window.MindRoot.ink.parse(window.saves[0]); return got.kind + ',' + got.elements.length + ',' + (got.background && got.background.w) + ',' + (window.saves[0].indexOf('<image id="mindroot-ink-bg"') > 0); });
  t.eq(kept, 'ink,1,240,true', 'the new file keeps the old drawing under the new ink');
  await page.keyboard.press('e');
  await ev(function () { window.editor.setEraser({ mode: 'stroke', size: 40 }); });
  await drag([30, 100], [230, 100], 10);
  await page.keyboard.press('v');
  await drag([10, 60], [250, 160], 6);
  t.eq(await ev(function () { return window.editor.scene().length + ',' + !!window.editor.background() + ',' + window.editor.selection().length; }), '1,true,0', 'it cannot be erased or selected: it is not an element');

  /* ---------------------------------------------------------------- read only, done */

  t.step('read only');
  await mount('{ readOnly: true }');
  t.eq(await ev(function () { return getComputedStyle(document.querySelector('.ink__tools')).display + ',' + window.editor.tool(); }), 'none,hand', 'no tools, the hand');
  var r0 = await ev(function () { return window.editor.camera(); });
  await drag([500, 500], [450, 480], 5);
  var r1 = await ev(function () { return window.editor.camera(); });
  t.eq((await count()) + ',' + Math.round(r0.x - r1.x), '0,50', 'a drag moves the sheet and draws nothing');
  await page.keyboard.press('p');
  await page.keyboard.press('Delete');
  t.eq(await ev(function () { return window.editor.tool(); }), 'hand', 'keys take no tool');
  await ev(function () { window.editor.setReadOnly(false); });
  t.eq(await ev(function () { return window.editor.tool() + ',' + (window.editor.tool() === window.editor.settings().tool); }), 'select,true', 'writable again: the tool last in hand comes back');

  t.step('Done');
  await page.keyboard.press('p');
  await path(line(300, 300, 400, 380, 10));
  await page.click('.ink__done');
  t.eq(await ev(function () {
    var c = window.closes[0];
    /* The svg is the drawing Done handed over, or null when the autosave
     * had already kept it. */
    return window.closes.length + ',' + c.saved + ',' + (c.svg === null || c.svg === window.saves[window.saves.length - 1]) + ',' + window.saves.length;
  }), '1,true,true,1', 'Done saves at once and closes');
  t.eq(await ev(function () { return !!document.querySelector('.ink') + ',' + window.MindRoot.ink.isDirty() + ',' + window.MindRoot.ink.editors().length; }), 'false,false,0', 'the editor is gone');


  /* ---------------------------------------------------------------- the editor among other things */

  t.step('it keeps to itself, and gives the focus back');
  await page.evaluate(function () {
    var b = document.createElement('button');
    b.id = 'opener';
    b.textContent = 'open';
    b.style.cssText = 'position:fixed;left:0;bottom:0;z-index:100';
    document.body.appendChild(b);
    b.focus();
    window.pasted = 0;
    document.addEventListener('paste', function () { window.pasted++; });
  });
  await page.evaluate(function () { window.editor = null; window.mount({}); window.editor.setCamera({ x: 0, y: 0, k: 1 }); window.leaked = []; });
  await page.evaluate(function () {
    var ev = new Event('paste', { bubbles: true, cancelable: true });
    window.editor.el.dispatchEvent(ev);
  });
  t.eq(await ev(function () { return window.pasted; }), 0, 'a paste in the drawing does not reach the app (it would make the picture a node)');
  await page.keyboard.press('p');
  await path(line(300, 300, 420, 340, 10));
  await page.keyboard.press('Control+s');
  t.eq(await ev(function () { return window.saves.length + ',' + window.leaked.join('+'); }), '1,s', 'Mod+S saves the drawing at once, and goes on to the app');
  await page.keyboard.press('v');
  await page.mouse.click(300, 300);
  await page.keyboard.press('t');
  await page.mouse.click(500, 500);
  await page.keyboard.type('Note');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  var noteBox = await ev(function () { var all = window.editor.scene(); var el = all[all.length - 1]; var r = document.querySelector('[data-id="' + el.id + '"]').getBoundingClientRect(); return [r.left + 5, r.top + r.height / 2]; });
  await page.mouse.click(noteBox[0], noteBox[1]);
  await page.keyboard.press('Enter');
  t.eq(await ev(function () { return document.querySelector('.ink__text').value; }), 'Note', 'Enter on a selected text writes in it');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  t.eq(await ev(function () { return window.editor.selection().length; }), 0, 'Escape once writes the text, twice lets the selection go');
  await page.focus('.ink__tool[data-tool="select"]');
  await page.keyboard.press('ArrowRight');
  t.eq(await ev(function () { return document.activeElement.getAttribute('data-tool'); }), 'hand', 'the arrows walk a toolbar');
  await page.keyboard.press('End');
  t.eq(await ev(function () { return document.activeElement.getAttribute('aria-label'); }), 'Colour and size', 'End goes to its last button');
  await page.keyboard.press('Enter');
  var slider = await ev(function () {
    var r = document.querySelector('.ink__pop .ink__range');
    return { focusedInPop: document.querySelector('.ink__pop').contains(document.activeElement), text: r && r.getAttribute('aria-valuetext') };
  });
  t.same(slider, { focusedInPop: true, text: '3 px' }, 'opened from the keyboard the popover takes the focus; the size says its pixels');
  await page.keyboard.press('Escape');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden + ',' + document.activeElement.getAttribute('aria-label'); }), 'true,Colour and size', 'Escape closes it and the focus goes back to its button');
  await page.click('.ink__done');
  t.eq(await ev(function () { return document.activeElement && document.activeElement.id; }), 'opener', 'closing gives the focus back to what opened the editor');


  t.step('colours: the eight, the arrows, and another colour');
  await page.evaluate(function () { window.mount({}); });
  await page.keyboard.press('p');
  await page.click('.ink__tool[data-tool="pen"]');
  await page.focus('.ink__pop .ink__colors [role="radio"][aria-checked="true"]');
  await page.keyboard.press('ArrowRight');
  var walked = await ev(function () { return window.editor.settings().pens.pen.color + ',' + document.activeElement.getAttribute('aria-label'); });
  t.eq(walked, '#7a828e,Grey', 'an arrow walks to the next ink and takes it');
  await page.keyboard.press('End');
  t.eq(await ev(function () { return document.activeElement.getAttribute('aria-label') + ',' + document.activeElement.getAttribute('role'); }), 'Another colour,radio', 'another colour is the last of the same group');
  t.eq(await ev(function () { return window.editor.settings().pens.pen.color; }), '#7a828e', 'walked onto with nothing picked yet, it changes nothing');
  await page.evaluate(function () {
    var input = document.querySelector('.ink__pop .ink__custom-input');
    input.value = '#123abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  var custom = await ev(function () {
    var r = document.querySelector('.ink__pop [data-value="custom"]');
    return window.editor.settings().pens.pen.color + ',' + r.getAttribute('aria-checked') + ',' + r.style.getPropertyValue('--swatch') + ',' + document.querySelector('.ink__pop .ink__custom-input').getAttribute('aria-hidden');
  });
  t.eq(custom, '#123abc,true,#123abc,true', 'the system picker sets the ink; the swatch shows it, checked; the field itself is hidden from assistive tech');
  await page.keyboard.press('Escape');
  await page.click('.ink__tool[data-tool="pen"]');
  t.eq(await ev(function () { return document.querySelector('.ink__pop [data-value="custom"]').getAttribute('aria-checked'); }), 'true', 'opened again, the custom colour is the one checked');
  await page.click('.ink__pop .ink__colors [aria-label="Ink"]');
  await page.focus('.ink__pop [data-value="custom"]');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  t.eq(await ev(function () { return window.editor.settings().pens.pen.color; }), '#123abc', 'and the arrows bring it back once it has been picked');
  await page.keyboard.press('Escape');
  await page.click('.ink__done');

  /* ---------------------------------------------------------------- the focus stays in the editor */

  t.step('a choice in a popover keeps the keys in the drawing');
  await mount();
  await page.keyboard.press('p');
  await path(line(200, 300, 400, 320, 8));
  await path(line(200, 400, 400, 420, 8));
  await page.keyboard.press('r');
  await page.click('.ink__tool[data-tool="rect"]');
  await page.click('.ink__pop [role="radio"][aria-label="Ellipse"]');
  t.same(await ev(function () {
    var a = document.activeElement;
    return { inside: window.editor.el.contains(a), label: a.getAttribute('aria-label'), tool: window.editor.tool(), pop: !document.querySelector('.ink__pop').hidden };
  }), { inside: true, label: 'Ellipse', tool: 'ellipse', pop: true }, 'a shape picked in its popover: the popover stays, the focus on the shape');
  await page.keyboard.press('Control+z');
  t.eq(await count(), 1, 'Ctrl+Z undoes the drawing from there');
  await page.keyboard.press('v');
  t.eq(await ev(function () { return window.editor.tool() + ',' + window.editor.el.contains(document.activeElement); }), 'select,true', 'V takes a tool, and the focus stays in the editor');
  await page.keyboard.press('Control+y');
  await page.mouse.click(300, 410);
  await page.click('.ink__selbar [aria-label="Colour"]');
  await page.click('.ink__pop [aria-label="Duplicate"]');
  t.eq(await ev(function () { return window.editor.scene().length + ',' + document.activeElement.getAttribute('aria-label'); }), '3,Duplicate', 'Duplicate in the selection popover: the copy made, the focus on the same button');
  await page.keyboard.press('Delete');
  t.eq(await count(), 2, 'Delete then takes the copy away');
  await page.evaluate(function () { window.editor.setTool('pen'); window.editor.focus(); });
  await page.focus('.ink__tool[data-tool="pen"]');
  await page.keyboard.press('Enter');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').contains(document.activeElement); }), true, 'the pen options opened from the keyboard take the focus');
  await page.keyboard.press('r');
  t.eq(await ev(function () { return window.editor.tool() + ',' + document.activeElement.getAttribute('data-tool'); }), 'rect,pen', 'R inside them takes the rectangle; the focus goes back to the pen button');
  await page.keyboard.press('Control+z');
  t.eq(await count(), 3, 'and Ctrl+Z still undoes (the copy comes back)');
  await page.keyboard.press('Control+d');
  t.same(await ev(function () { return window.leaked; }), [], 'nothing reached the page, Mod+D with nothing selected included');

  /* ---------------------------------------------------------------- what cannot be saved */

  t.step('Done when the drawing cannot be saved');
  await page.evaluate(function () {
    window.failSave = true;
    window.mount({ onSave: function (svg) { window.saves.push(svg); return !window.failSave; } });
    window.editor.setCamera({ x: 0, y: 0, k: 1 });
  });
  await page.keyboard.press('p');
  await path(line(200, 300, 420, 340, 10));
  await page.click('.ink__done');
  t.eq(await ev(function () {
    return !!document.querySelector('.ink') + '|' + document.querySelector('.ink__status-text').textContent + '|' + document.querySelector('.ink [role="alert"]').textContent + '|' + window.closes.length;
  }), 'true|Not saved|Not saved. The drawing stays open.|0', 'Done leaves the editor open, and says why');
  await page.evaluate(function () { window.failSave = false; });
  await page.click('.ink__done');
  t.eq(await ev(function () {
    var c = window.closes[0];
    return !!document.querySelector('.ink') + ',' + window.closes.length + ',' + c.saved + ',' + window.MindRoot.ink.parse(c.svg).elements.length;
  }), 'false,1,true,1', 'once the host can keep it, Done saves and closes');

  t.step('Mod+S while writing a text, and what a paste can carry');
  await page.evaluate(function () {
    window.mount({});
    window.editor.setCamera({ x: 0, y: 0, k: 1 });
    window.leaked = [];
  });
  await page.keyboard.press('t');
  await page.mouse.click(300, 300);
  await page.keyboard.insertText('Line one\u000bLine two');
  await page.keyboard.press('Control+s');
  var saved1 = await ev(function () {
    var svg = window.saves[window.saves.length - 1];
    var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    var words = window.MindRoot.ink.parse(svg).elements.filter(function (el) { return el.type === 'text'; })[0];
    return { leaked: window.leaked, saves: window.saves.length, typing: !document.querySelector('.ink__text').hidden, wellFormed: !doc.getElementsByTagName('parsererror').length, text: words && words.text };
  });
  t.same(saved1, { leaked: ['s'], saves: 1, typing: false, wellFormed: true, text: 'Line one\nLine two' },
    'Mod+S puts the words on the sheet, saves the drawing and goes on to the app; the soft line break pasted from an office app is a line break, the file well-formed');
  var shows = await ev(function () {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img.naturalWidth > 0); };
      img.onerror = function () { resolve(false); };
      img.src = URL.createObjectURL(new Blob([window.saves[0]], { type: 'image/svg+xml' }));
    });
  });
  t.eq(shows, true, 'and it shows as a picture, as on the map');

  t.step('a file that cannot be read opens view only');
  await page.evaluate(function () {
    window.mount({ svgText: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200"><metadata id="mindroot-ink">{"v":3,"elements":[]}</metadata><rect width="300" height="200" fill="#c4314b"/></svg>' });
  });
  var locked = await ev(function () {
    var n = document.querySelector('.ink__notice');
    var r = n.getBoundingClientRect();
    var tools = document.querySelector('.ink__actions').getBoundingClientRect();
    return { kind: window.editor.loaded().kind, readOnly: window.editor.readOnly(), notice: !n.hidden && r.width > 0, below: r.top >= tools.bottom, tools: getComputedStyle(document.querySelector('.ink__tools')).display, bg: !!document.querySelector('image.ink__bg') };
  });
  t.same(locked, { kind: 'newer', readOnly: true, notice: true, below: true, tools: 'none', bg: true }, 'a later format: the picture shown, a notice under the bars, no tools');
  await drag([500, 500], [400, 450], 5);
  await page.click('.ink__done');
  t.eq(await ev(function () { return window.saves.length + ',' + window.closes.length + ',' + window.closes[0].saved; }), '0,1,true', 'Done closes it and nothing is written over it');

  /* ---------------------------------------------------------------- layout */

  t.step('the top bars never overlap: wide only where both fit');
  async function bars(lang) {
    var out = [];
    var widths = [560, 640, 700, 760, 820, 900, 1280];
    for (var w = 0; w < widths.length; w++) {
      await page.setViewportSize({ width: widths[w], height: 700 });
      out.push(await ev(function (width) {
        window.mount({ onSave: function () { return new Promise(function () {}); } });
        window.editor.setCamera({ x: 0, y: 0, k: 1 });
        var s = document.querySelector('.ink__surface');
        function f(type, x, y) { s.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 })); }
        window.editor.setTool('pen');
        f('pointerdown', 100, 400); f('pointermove', 140, 420); f('pointerup', 140, 420);
        window.editor.save();
        var tools = document.querySelector('.ink__tools');
        var t = tools.getBoundingClientRect();
        var a = document.querySelector('.ink__actions').getBoundingClientRect();
        return {
          w: width, layout: window.editor.layout(), state: window.editor.saveState(),
          overlap: t.right > a.left && t.left < a.right && t.top < a.bottom && a.top < t.bottom,
          clipped: tools.scrollWidth > tools.clientWidth + 1
        };
      }, widths[w]));
    }
    return out;
  }
  var en = await bars('en');
  t.check('English: no overlap, nothing clipped, wide on a laptop, compact on a narrow pane', en.every(function (r) { return !r.overlap && !(r.layout === 'wide' && r.clipped); }) &&
    en[0].layout === 'compact' && en[en.length - 1].layout === 'wide' && en.some(function (r) { return r.state === 'saving'; }), en);
  await page.setViewportSize({ width: 1280, height: 800 });

  /* ---------------------------------------------------------------- tools that hold more */

  t.step('a chevron on every tool with options, and the hint the first times');
  await load();
  await ev(function () { localStorage.removeItem('mindroot2:ink-coach'); });
  await load();
  await mount();
  await ev(function () { window.editor.setTool('select'); });
  var carets = await ev(function () {
    return Array.prototype.map.call(document.querySelectorAll('.ink__tools .ink__btn'), function (b) {
      if (!b.getClientRects().length || getComputedStyle(b).display === 'none') return null;
      var c = b.querySelector('.ink__caret');
      return (b.getAttribute('data-tool') || b.getAttribute('data-key')) + ':' + (c ? 'caret' : '-') + ':' + (b.getAttribute('aria-haspopup') || '-') + ':' + (b.getAttribute('aria-expanded') || '-');
    }).filter(Boolean).join(' ');
  });
  t.eq(carets, 'select:-:-:- hand:-:-:- pen:caret:dialog:false eraser:caret:dialog:false rect:caret:dialog:false ellipse:caret:dialog:false diamond:caret:dialog:false line:caret:dialog:false arrow:caret:dialog:false text:caret:dialog:false ink.image.pick:-:-:- ink.style:caret:dialog:false',
    'the chevron, aria-haspopup and aria-expanded on the buttons that hold more, and only there');
  var caretLook = await ev(function () {
    function at(sel) {
      var b = document.querySelector(sel);
      var c = b.querySelector('.ink__caret-icon').getBoundingClientRect();
      var r = b.getBoundingClientRect();
      var cx = c.left + c.width / 2 - (r.left + r.width / 2);
      var cy = c.top + c.height / 2 - (r.top + r.height / 2);
      return { right: cx > 0, below: cy > 0, onRim: Math.abs(Math.hypot(cx, cy) - r.width / 2) < 2, opacity: Number(getComputedStyle(b.querySelector('.ink__caret-icon')).opacity) };
    }
    return { pen: at('.ink__tool[data-tool="pen"]'), select: document.querySelector('.ink__tool[data-tool="select"] .ink__caret') };
  });
  t.same(caretLook, { pen: { right: true, below: true, onRim: true, opacity: 0.5 }, select: null }, 'at rest the chevron is faint, on the rim at the bottom right (the options open below)');

  await page.click('.ink__tool[data-tool="eraser"]');
  await page.waitForTimeout(200);
  var coach = await ev(function () {
    var el = document.querySelector('.ink__coach');
    var r = el.getBoundingClientRect();
    var b = document.querySelector('.ink__tool[data-tool="eraser"]').getBoundingClientRect();
    var icon = getComputedStyle(document.querySelector('.ink__tool[data-tool="eraser"] .ink__caret-icon'));
    var caret = Number(icon.opacity) + (icon.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ',badge' : '');
    return { shown: !el.hidden, text: el.textContent, below: r.top > b.bottom, under: r.left < b.left + b.width / 2 && r.right > b.left + b.width / 2 && el.scrollWidth <= el.clientWidth, presses: getComputedStyle(el).pointerEvents, caret: caret, pop: !document.querySelector('.ink__pop').hidden };
  });
  t.same(coach, { shown: true, text: 'Click again for eraser options', below: true, under: true, presses: 'none', caret: '1,badge', pop: false },
    'the eraser taken with the mouse: its chevron at full strength in its badge, the hint under it, the options still shut');
  await t.shot('desktop-coach');
  await page.mouse.click(700, 500);
  t.eq(await ev(function () { return document.querySelector('.ink__coach').hidden; }), true, 'a press on the sheet puts the hint away');
  await page.click('.ink__tool[data-tool="pen"]');
  t.eq(await ev(function () { return document.querySelector('.ink__coach').hidden; }), true, 'once per drawing opened: the pen does not say it again');

  var caretAt = await ev(function () {
    var r = document.querySelector('.ink__tool[data-tool="ellipse"] .ink__caret-icon').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  await page.mouse.click(caretAt[0], caretAt[1]);
  t.eq(await ev(function () {
    var pop = document.querySelector('.ink__pop');
    return window.editor.tool() + ',' + (!pop.hidden && pop.getAttribute('data-kind')) + ',' + document.querySelector('.ink__tool[data-tool="ellipse"]').getAttribute('aria-expanded');
  }), 'ellipse,shape,true', 'a press on the chevron of a tool not in hand takes it and opens its options at once');
  t.same(await ev(function () { return JSON.parse(localStorage.getItem('mindroot2:ink-coach')); }), { used: true, shown: 1 }, 'the options found: remembered');
  await page.waitForTimeout(250);
  await t.shot('desktop-caret-options');
  await page.mouse.click(caretAt[0], caretAt[1]);
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden + ',' + window.editor.tool(); }), 'true,ellipse', 'the chevron again puts them away');

  t.step('the keyboard: the arrow down opens the options of the button with the focus');
  await page.focus('.ink__tool[data-tool="text"]');
  await page.keyboard.press('ArrowDown');
  t.eq(await ev(function () {
    var pop = document.querySelector('.ink__pop');
    return window.editor.tool() + ',' + pop.getAttribute('data-kind') + ',' + pop.contains(document.activeElement);
  }), 'text,text,true', 'on the Text button: the text in hand, its options open, the focus inside them');
  await page.keyboard.press('Escape');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden + ',' + document.activeElement.getAttribute('data-tool'); }), 'true,text', 'Escape: shut, the focus back on the button');
  await page.focus('.ink__btn[data-key="ink.style"]');
  await page.keyboard.press('ArrowDown');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').getAttribute('data-kind') + ',' + document.querySelector('.ink__pop').contains(document.activeElement); }), 'text,true', 'on Colour and size: its popover, for the tool in hand');
  await page.keyboard.press('Escape');
  await page.focus('.ink__tool[data-tool="select"]');
  await page.keyboard.press('ArrowDown');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden + ',' + window.editor.tool(); }), 'true,text', 'on a tool without options it does nothing');
  t.same(await ev(function () { return window.leaked; }), [], 'and no key reached the page');

  t.step('the hint never comes back once used, and stops after three showings');
  await load();
  await mount();
  await ev(function () { window.editor.setTool('select'); });
  await page.click('.ink__tool[data-tool="eraser"]');
  t.eq(await ev(function () { return document.querySelector('.ink__coach').hidden; }), true, 'used once: never again');
  await ev(function () { localStorage.setItem('mindroot2:ink-coach', JSON.stringify({ used: false, shown: 2 })); });
  await load();
  await mount();
  await ev(function () { window.editor.setTool('select'); });
  await page.click('.ink__tool[data-tool="text"]');
  t.eq(await ev(function () { return !document.querySelector('.ink__coach').hidden && document.querySelector('.ink__coach').textContent; }), 'Click again for text options', 'not used, shown twice: a third time');
  await load();
  await mount();
  await ev(function () { window.editor.setTool('select'); });
  await page.click('.ink__tool[data-tool="text"]');
  t.eq(await ev(function () { return document.querySelector('.ink__coach').hidden + ',' + localStorage.getItem('mindroot2:ink-coach'); }), 'true,{"used":false,"shown":3}', 'and then no more');
  await ev(function () { window.editor.setTool('pen'); });
  await page.waitForTimeout(400);

  /* ---------------------------------------------------------------- Italian */

  t.step('in Italian');
  await load('?lang=it');
  await mount();
  var labels = await ev(function () {
    return ['pen', 'eraser', 'select', 'text'].map(function (n) { return document.querySelector('.ink__tool[data-tool="' + n + '"]').getAttribute('aria-label'); }).join(',') + '|' +
      document.querySelector('.ink__done').textContent + '|' + window.editor.el.getAttribute('aria-label');
  });
  t.eq(labels, 'Penna,Gomma,Seleziona,Testo|Fine|Disegno: Test', 'the chrome speaks Italian');
  t.eq(await ev(function () { return window.editor.tool(); }), 'pen', 'the tool in hand is remembered from the last drawing');
  await page.click('.ink__tool[data-tool="pen"]');
  t.eq(await ev(function () { return document.querySelector('.ink__pop [role="radiogroup"]').getAttribute('aria-label') + ',' + document.querySelector('.ink__size-value').textContent; }), 'Strumento,3 px', 'and so does the popover, with the nib in pixels');
  t.same(await ev(function () { return window.inkMissingStrings; }), [], 'no string missing');
  await page.waitForFunction(function () { return document.getAnimations().filter(function (a) { return a.playState === 'running'; }).length === 0; });
  await t.shot('desktop-it');
  var it = await bars('it');
  t.check('Italian: no overlap, nothing clipped', it.every(function (r) { return !r.overlap && !(r.layout === 'wide' && r.clipped); }) && it[it.length - 1].layout === 'wide', it);
};
