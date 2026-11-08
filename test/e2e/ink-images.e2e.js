/* ink: pictures on the sheet, under a real hand. A picture is an element
 * like the others - added from a file, pasted or dropped, moved, resized
 * (proportionally from a corner, stretched from a side), duplicated, sent
 * to the front, deleted, locked - that sits behind the ink already there,
 * so strokes and text go over it; the eraser never takes it, a locked one
 * cannot be selected until its padlock is pressed. It is written once in the
 * file (a format-2 drawing) and comes back whole. Bad files are refused
 * with a word, and a view-only sheet takes none. */
'use strict';

module.exports = async function (t) {
  var page = t.page;

  async function load() {
    await page.goto(t.fileUrl('test/fixtures/ink/host.html'));
    await page.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
  }
  async function mount(opts) {
    await page.evaluate(function (o) {
      window.mount(o || {});
      window.editor.setCamera({ x: 0, y: 0, k: 1 });
    }, opts || null);
  }
  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function scene() { return ev(function () { return window.editor.scene(); }); }
  function pics() { return scene().then(function (s) { return s.filter(function (e) { return e.type === 'image'; }); }); }
  function until(fn, arg) { return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: 5000, polling: 30 }); }
  async function drag(from, to, steps) {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: steps || 8 });
    await page.mouse.up();
  }
  /* A PNG made in the page: w x h, left half red, right half blue. */
  function png(w, h) {
    return ev(function (d) {
      var c = document.createElement('canvas');
      c.width = d.w; c.height = d.h;
      var g = c.getContext('2d');
      g.fillStyle = '#c4314b'; g.fillRect(0, 0, d.w / 2, d.h);
      g.fillStyle = '#2f6fb3'; g.fillRect(d.w / 2, 0, d.w / 2, d.h);
      return c.toDataURL('image/png');
    }, { w: w, h: h });
  }
  function handleBox(id) {
    return ev(function (i) { var r = document.querySelector('.ink__handle[data-handle="' + i + '"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, id);
  }

  await load();
  await mount();
  var red = await png(400, 200);

  /* ---------------------------------------------------------------- adding */

  t.step('a picture added from the page: centred, selected, one undo step');
  var id = await ev(function (u) { return window.editor.insertImage(u); }, red);
  t.check('it was added', typeof id === 'string' && id.length > 0, id);
  var s1 = await scene();
  t.eq(s1.length, 1, 'one element');
  t.same([s1[0].type, s1[0].w, s1[0].h], ['image', 400, 200], 'at its own size when it fits the view');
  t.check('in the middle of the view', await ev(function () {
    var e = window.editor.elements()[0];
    var r = document.querySelector('.ink__surface').getBoundingClientRect();
    return Math.abs(e.x + e.w / 2 - r.width / 2) < 2 && Math.abs(e.y + e.h / 2 - r.height / 2) < 2;
  }));
  t.same(await ev(function () { return [window.editor.selection().length, window.editor.tool()]; }), [1, 'select'], 'selected, with the select tool');
  t.eq(await page.locator('.ink__handle').count(), 8, 'with its handles');
  await ev(function () { window.editor.undo(); });
  t.eq((await scene()).length, 0, 'one undo takes it back');
  await ev(function () { window.editor.redo(); });
  t.eq((await scene()).length, 1, 'and redo gives it');

  t.step('from the button: the file chooser');
  await ev(function () { window.editor.setTool('pen'); });
  var base64 = red.split(',')[1];
  var chooser = page.waitForEvent('filechooser');
  await page.click('[data-key="ink.image.pick"]');
  var fc = await chooser;
  await fc.setFiles({ name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await until(function () { return window.editor.scene().filter(function (e) { return e.type === 'image'; }).length === 2; });
  var two = await scene();
  t.same(two.map(function (e) { return e.type; }), ['image', 'image'], 'two pictures');
  t.eq(two[0].id !== two[1].id, true, 'with their own ids');
  t.eq(await ev(function () { return window.editor.elements()[0].id === window.editor.selection()[0]; }), true, 'the new one is behind everything, and selected');

  t.step('pasted, and dropped where it is let go');
  var pasted = await ev(function (u) {
    var bin = atob(u.split(',')[1]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var dt = new DataTransfer();
    dt.items.add(new File([bytes], 'p.png', { type: 'image/png' }));
    var root = document.querySelector('.ink');
    root.focus();
    var ev1 = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    root.dispatchEvent(ev1);
    return ev1.defaultPrevented;
  }, red);
  t.eq(pasted, true, 'a pasted picture is taken');
  await until(function () { return window.editor.scene().filter(function (e) { return e.type === 'image'; }).length === 3; });
  var dropped = await ev(function (u) {
    var bin = atob(u.split(',')[1]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var dt = new DataTransfer();
    dt.items.add(new File([bytes], 'd.png', { type: 'image/png' }));
    var sf = document.querySelector('.ink__surface');
    var over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 900, clientY: 600 });
    sf.dispatchEvent(over);
    var drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 900, clientY: 600 });
    sf.dispatchEvent(drop);
    return [over.defaultPrevented, drop.defaultPrevented];
  }, red);
  t.same(dropped, [true, true], 'a file over the sheet is accepted, and the drop is taken');
  await until(function () { return window.editor.scene().filter(function (e) { return e.type === 'image'; }).length === 4; });
  var last = await ev(function () { var e = window.editor.elements()[0]; return [e.x + e.w / 2, e.y + e.h / 2]; });
  t.check('the dropped one is centred where it was let go', Math.abs(last[0] - 900) < 2 && Math.abs(last[1] - 600) < 2, last);

  /* a clean sheet for the rest */
  await mount();
  await ev(function (u) { return window.editor.insertImage(u); }, red);
  var one = (await pics())[0];

  /* ---------------------------------------------------------------- moving and resizing */

  t.step('moved by dragging it, resized by its handles');
  var cx = one.x + one.w / 2;
  var cy = one.y + one.h / 2;
  await drag([cx, cy], [cx + 80, cy + 30]);
  var moved = (await pics())[0];
  t.same([Math.round(moved.x - one.x), Math.round(moved.y - one.y), moved.w, moved.h], [80, 30, 400, 200], 'moved by the drag, the same size');
  var se = await handleBox('se');
  await drag(se, [se[0] + 100, se[1] + 10]);
  var grown = (await pics())[0];
  t.check('from a corner it keeps its proportions', Math.abs(grown.w / grown.h - 2) < 0.02 && grown.w > 450, grown);
  t.same([Math.round(grown.x), Math.round(grown.y)], [Math.round(moved.x), Math.round(moved.y)], 'the opposite corner stays put');
  var east = await handleBox('e');
  await drag(east, [east[0] + 60, east[1]]);
  var stretched = (await pics())[0];
  t.check('from a side it stretches', stretched.w > grown.w + 50 && Math.abs(stretched.h - grown.h) < 1, stretched);
  await ev(function () { window.editor.undo(); window.editor.undo(); window.editor.undo(); });
  var back = (await pics())[0];
  t.same([back.x, back.y, back.w, back.h], [one.x, one.y, one.w, one.h], 'three undo steps (move, corner, side) bring it back as it was added');
  await ev(function () { window.editor.redo(); window.editor.redo(); window.editor.redo(); });

  /* ---------------------------------------------------------------- writing and drawing over it */

  t.step('ink goes over it; the eraser leaves it');
  var p0 = (await pics())[0];
  await ev(function () { window.editor.setTool('pen'); });
  await drag([p0.x + 20, p0.y + 40], [p0.x + p0.w - 20, p0.y + 120], 12);
  var sc = await scene();
  t.same(sc.map(function (e) { return e.type; }), ['image', 'stroke'], 'the stroke is after the picture, over it');
  var still = (await pics())[0];
  t.same([still.x, still.y, still.w, still.h], [p0.x, p0.y, p0.w, p0.h], 'and the picture did not move');
  await ev(function () { window.editor.setTool('eraser'); });
  await drag([p0.x + 5, p0.y + 80], [p0.x + p0.w - 5, p0.y + 80], 14);
  sc = await scene();
  t.eq(sc.filter(function (e) { return e.type === 'image'; }).length, 1, 'the eraser did not take the picture');
  await ev(function () { window.editor.setTool('text'); });
  await page.mouse.click(p0.x + 60, p0.y + 30);
  await page.keyboard.type('over it');
  await ev(function () { window.editor.setTool('select'); });
  sc = await scene();
  t.same(sc.map(function (e) { return e.type; }).filter(function (x) { return x !== 'stroke'; }), ['image', 'text'], 'writing goes on it, after it');

  /* ---------------------------------------------------------------- lock */

  t.step('locked: no longer selectable, a padlock gives it back');
  await ev(function () { window.editor.select([window.editor.elements()[0].id]); });
  await page.click('[data-key="ink.lock"]');
  var locked = (await pics())[0];
  t.eq(locked.locked, true, 'the picture is locked');
  t.eq(await ev(function () { return window.editor.selection().length; }), 0, 'and is no longer the selection');
  t.eq(await page.locator('.ink__lock').count(), 1, 'a padlock shows on it with the select tool');
  await ev(function () { window.editor.setTool('select'); });
  await drag([p0.x + 200, p0.y + 150], [p0.x + 240, p0.y + 150], 5);
  var unmoved = (await pics())[0];
  t.same([unmoved.x, unmoved.y], [locked.x, locked.y], 'dragging over it does not move it');
  await page.mouse.click(p0.x + 120, p0.y + 100);
  t.eq(await ev(function () { return window.editor.selection().filter(function (id) { return id === window.editor.elements()[0].id; }).length; }), 0, 'a tap on it does not select it');
  await ev(function () { window.editor.selectAll && window.editor.selectAll(); });
  t.eq(await ev(function () { return window.editor.selection().indexOf(window.editor.elements()[0].id); }), -1, 'select-all leaves it out');
  var pad = await ev(function () { var r = document.querySelector('.ink__lock').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(pad[0], pad[1]);
  t.eq(!!(await pics())[0].locked, false, 'the padlock unlocks it');
  t.eq(await ev(function () { return window.editor.selection()[0] === window.editor.elements()[0].id; }), true, 'and it is selected');

  /* ---------------------------------------------------------------- duplicate, front, delete */

  t.step('duplicated, brought to the front, deleted');
  await ev(function () { window.editor.select([window.editor.elements()[0].id]); });
  await page.click('[data-key="ink.duplicate"]');
  t.eq((await pics()).length, 2, 'duplicated');
  await page.click('[data-key="ink.front"]');
  t.eq(await ev(function () { var l = window.editor.elements(); return l[l.length - 1].type; }), 'image', 'brought to the front, over the ink');
  await page.click('[data-key="ink.delete"]');
  t.eq((await pics()).length, 1, 'deleted');

  /* ---------------------------------------------------------------- the file */

  t.step('written once, in a format-2 file, and back whole');
  await ev(function () { window.editor.save(); });
  var svg = await ev(function () { return window.saves[window.saves.length - 1] || window.editor.svg(); });
  t.eq(svg.indexOf('data-mindroot-ink="2"') > 0, true, 'format 2');
  t.eq(svg.split('data:image/png').length - 1, 1, 'the bytes once');
  var before = await scene();
  await mount({ svgText: svg });
  var after = await scene();
  t.same(after, before, 'opened again: the same scene');
  t.eq(await ev(function () { return window.editor.elements().filter(function (e) { return e.type === 'image'; })[0].href.indexOf('data:image/png') === 0; }), true, 'with its picture');

  /* ---------------------------------------------------------------- refused, view only */

  t.step('what cannot be a picture is refused with a word; view only takes none');
  await mount();
  var refused = await ev(function () {
    var f = new File(['hello'], 'x.txt', { type: 'text/plain' });
    return window.editor.insertImage(f).then(function (r) { return { r: r, said: document.querySelector('.ink [role="alert"]').textContent, n: window.editor.scene().length }; });
  });
  t.same([refused.r, refused.n], [null, 0], 'a text file: nothing added');
  t.check('and it says why', /PNG, JPEG, WebP, GIF or SVG/.test(refused.said), refused.said);
  var hostile = await ev(function () {
    return window.editor.insertImage('data:image/png;base64,AAAA').then(function (r) { return [r, window.editor.scene().length]; });
  });
  t.same(hostile, [null, 0], 'bytes that are no picture: nothing added');
  await ev(function () { window.editor.setReadOnly(true); });
  t.eq(await page.locator('[data-key="ink.image.pick"]').isDisabled(), true, 'view only: the button is off');
  t.eq(await ev(function (u) { return window.editor.insertImage(u); }, red), null, 'and a picture is not taken');
  await ev(function () { window.editor.setReadOnly(false); });

  t.step('a big picture is brought down to a size the file can hold');
  var big = await png(3600, 1800);
  var res = await ev(function (u) {
    return window.editor.insertImage(u).then(function () {
      var el = window.editor.elements()[0];
      return new Promise(function (done) {
        var im = new Image();
        im.onload = function () { done({ w: im.naturalWidth, h: im.naturalHeight, ratio: el.w / el.h }); };
        im.src = el.href;
      });
    });
  }, big);
  t.check('its longest side is at most 2048', Math.max(res.w, res.h) <= 2048 && Math.max(res.w, res.h) > 1000, res);
  t.check('with the same proportions', Math.abs(res.ratio - 2) < 0.02, res);
};
