/* cursors: what the pointer looks like over the drawing editor and the map.
 *
 * The drawing editor (test/fixtures/ink/host.html): with a pen in hand the
 * pointer is the nib - the hollow outline of the mark it will leave, as wide
 * as the line on screen (it follows the zoom, never under 6 px), tinted
 * faintly with the pen's colour, a chisel outline for the highlighter - with
 * a soft ring in the opposite of the sheet and a halo of the sheet's colour,
 * so the point aimed at stays in view. The page draws it (div.ink__pen-ring)
 * wherever a mouse or a pen moves over the sheet, because a browser may drop a
 * cursor image and show the system crosshair instead, above all under a
 * hovering stylus; the system cursor steps aside while it is live. Every
 * other tool has its system cursor (text: I-beam, shapes: crosshair, select:
 * arrow and move / resize over the selection, hand: grab and grabbing,
 * eraser: its own circle); forced colours get the system cursors; a finger
 * (nothing that hovers) gets no ring.
 *
 * The map (the real app): grab over the empty map, grabbing while it pans
 * and while a node is dragged to a new place, MindRoot's own arrow over the
 * nodes (and the select tool: read as 'mr-arrow', see cursor-theme), the
 * I-beam only inside a rename field.
 *
 * Screenshots: the cursor images themselves, drawn into a page at 1x and
 * magnified, on light and dark paper (test/out/cursors-*.png). */
'use strict';

var E = require('../fixtures/editor/helpers.js');

module.exports = async function (t) {
  /* ------------------------------------------------------------------ the drawing editor */
  var page = await t.context.newPage();

  async function load(p) {
    await p.goto(t.fileUrl('test/fixtures/ink/host.html'));
    await p.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
  }

  async function mount(p, opts) {
    await p.evaluate(function (o) {
      window.mount(o || {});
      window.editor.setCamera({ x: 0, y: 0, k: 1 });
    }, opts || null);
  }

  function ev(fn, arg) { return page.evaluate(fn, arg); }

  /* The cursor over the sheet, read back: the computed value and, for a
   * picture, the picture taken apart (its size, its hotspot, its shapes). */
  function sheetCursor(p, at) {
    return (p || page).evaluate(function (pt) {
      var el = pt ? document.elementFromPoint(pt[0], pt[1]) : document.querySelector('.ink__surface');
      var target = el && el.closest ? (el.closest('.ink__surface') || el) : el;
      var css = getComputedStyle(target).cursor;
      /* MindRoot's own arrow (tokens.css), read as one word. */
      if (css.indexOf('M5.5 3.5l12.5 7') >= 0 && / 6 4, default$/.test(css)) css = 'mr-arrow';
      var m = /^url\("data:image\/svg\+xml,([^"]*)"\) (\d+) (\d+), crosshair$/.exec(css);
      if (!m) return { css: css, image: null };
      var svgText = decodeURIComponent(m[1]);
      var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      var svg = doc.documentElement;
      var shapes = Array.prototype.map.call(svg.children, function (n) {
        var out = { tag: n.tagName };
        ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity'].forEach(function (a) {
          if (n.hasAttribute(a)) out[a] = isNaN(Number(n.getAttribute(a))) ? n.getAttribute(a) : Number(n.getAttribute(a));
        });
        return out;
      });
      return {
        css: 'image',
        image: { w: Number(svg.getAttribute('width')), h: Number(svg.getAttribute('height')), hot: [Number(m[2]), Number(m[3])], shapes: shapes, ok: svg.tagName === 'svg' && !doc.querySelector('parsererror') }
      };
    }, at || null);
  }

  /* The pen's ring, read back: where it is, how big, its colours, and the
   * system cursor under it. */
  function ring(p) {
    return (p || page).evaluate(function () {
      var n = document.querySelector('.ink__pen-ring');
      var r = n.getBoundingClientRect();
      var cs = getComputedStyle(n);
      var ink = document.querySelector('.ink');
      return {
        shown: !n.hidden,
        w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        color: n.style.getPropertyValue('--nib-color'), ring: n.style.getPropertyValue('--nib-ring'), halo: n.style.getPropertyValue('--nib-halo'),
        radius: cs.borderRadius, bg: cs.backgroundColor, shadow: cs.boxShadow, tint: getComputedStyle(n, '::before').opacity,
        cursor: getComputedStyle(document.querySelector('.ink__surface')).cursor,
        live: ink.hasAttribute('data-nib-live'), nib: ink.getAttribute('data-nib')
      };
    });
  }
  function builds() { return ev(function () { return window.editor.nibCursor().builds; }); }
  function zoomTo(cam) { return ev(function (c) { window.editor.setCamera(c); }, cam); }

  await load(page);
  await mount(page);

  t.step('the pen is a hollow ring of its size on screen, where the pointer is');
  await ev(function () {
    window.editor.setTool('pen');
    window.editor.setPen('pen');
    window.editor.setColor('#c4314b');
    window.editor.setSize(8);
  });
  await page.mouse.move(300, 300);
  var c = await ring();
  t.eq(c.shown, true, 'a mouse over the sheet: the ring');
  t.same([c.w, c.h], [8, 8], 'as wide as the line (8 px at 100%)');
  t.same([c.cx, c.cy], [300, 300], 'centred on the pointer');
  t.eq(c.radius, '50%', 'a circle');
  t.eq(c.color, '#c4314b', 'tinted with the pen colour');
  t.eq(c.bg, 'rgba(0, 0, 0, 0)', 'hollow: the aimed point is not covered');
  t.check('only a faint tint inside', Number(c.tint) > 0 && Number(c.tint) <= 0.2, c.tint);
  t.check('with a soft outline and a hair of halo', c.shadow !== 'none' && c.shadow.indexOf('inset') >= 0, c.shadow);
  var look = await ev(function () { return window.editor.look(); });
  t.eq(c.ring, '#15171c', 'the outline is dark ink on light paper');
  t.eq(c.halo, look.sheet, 'and the halo is the paper colour');
  t.eq(c.cursor, 'none', 'the system cursor (the crosshair) steps aside');
  t.eq(c.live, true, 'while the ring is live');
  await page.mouse.move(340, 320);
  c = await ring();
  t.same([c.cx, c.cy], [340, 320], 'it follows the pointer');

  t.step('a new colour or size changes the ring');
  await ev(function () { window.editor.setColor('#2f6fb3'); });
  c = await ring();
  t.eq(c.color, '#2f6fb3', 'the new colour');
  await ev(function () { window.editor.setSize(16); });
  c = await ring();
  t.same([c.w, c.h], [16, 16], 'the new size (16 px)');

  t.step('the ring follows the zoom, with no limit but its floor');
  await zoomTo({ x: 0, y: 0, k: 2 });
  c = await ring();
  t.same([c.w, c.h], [32, 32], 'at 200% a 16 px pen is 32 px on screen');
  await ev(function () { window.editor.setSize(8); });
  await zoomTo({ x: 0, y: 0, k: 0.1 });
  c = await ring();
  t.same([c.w, c.h], [6, 6], 'zoomed far out it never shrinks under 6 px');
  await ev(function () { window.editor.setSize(48); });
  await zoomTo({ x: 0, y: 0, k: 3 });
  c = await ring();
  t.same([c.w, c.h], [144, 144], 'a 144 px nib is drawn whole (no crosshair beyond 128 px any more)');
  await ev(function () { window.editor.setSize(8); });
  await zoomTo({ x: 0, y: 0, k: 1 });

  t.step('a pan or a pointer move changes nothing about the ring');
  var b0 = await builds();
  for (var i = 0; i < 40; i++) await page.mouse.move(300 + i * 7, 300 + (i % 5) * 9);
  t.eq(await builds(), b0, 'forty moves: the ring is not restyled');
  await ev(function () { var c0 = window.editor.camera(); window.editor.setCamera({ x: c0.x + 40, y: c0.y - 25, k: c0.k }); });
  t.eq(await builds(), b0, 'a pan without a zoom: nothing restyled');
  await ev(function () { window.editor.setSize(10); });
  t.eq(await builds(), b0 + 1, 'a new size: restyled once');

  t.step('the pencil, the highlighter');
  await ev(function () { window.editor.setSize(8); window.editor.setPen('highlighter'); });
  await page.mouse.move(420, 330);
  c = await ring();
  var hl = await ev(function () { return window.editor.settings().pens.highlighter; });
  t.check('the highlighter is a chisel: narrower than tall, as tall as its line', c.w < c.h && Math.abs(c.h - hl.size) <= 1, c);
  t.check('with rounded corners', c.radius !== '50%' && parseFloat(c.radius) > 0, c.radius);
  t.eq(c.color, hl.color, 'in its colour');

  t.step('a dark sheet turns the outline light and the halo dark');
  await ev(function () { window.editor.setPen('pen'); window.editor.setColor('ink'); });
  c = await ring();
  look = await ev(function () { return window.editor.look(); });
  t.eq(c.color, look.ink, 'the semantic ink shows as the paper ink');
  await ev(function () { window.editor.setLook({ theme: 'dark' }); });
  c = await ring();
  look = await ev(function () { return window.editor.look(); });
  t.eq(look.dark, true, 'the sheet is dark');
  t.eq(c.ring, '#f4f5f7', 'a light outline on dark paper');
  t.eq(c.halo, look.sheet, 'a halo of the dark paper');
  t.eq(c.color, look.ink, 'the ink is the light ink of dark paper');
  await ev(function () { window.editor.setLook({ theme: 'dark', background: '#f6e7c1' }); });
  c = await ring();
  t.eq(c.ring, '#15171c', 'a light background chosen on a dark theme: a dark outline again');
  await ev(function () { window.editor.setLook({ theme: 'light' }); });

  t.step('a stylus hovering shows the ring, a finger does not, a stroke hides it');
  await ev(function () { window.editor.setSize(10); window.editor.setColor('#c4314b'); });
  var hv = await ev(function () {
    var sf = document.querySelector('.ink__surface');
    var rc = sf.getBoundingClientRect();
    function move(type) {
      sf.dispatchEvent(new PointerEvent('pointermove', { pointerType: type, pointerId: 7, clientX: rc.left + 200, clientY: rc.top + 150, bubbles: true }));
      return !document.querySelector('.ink__pen-ring').hidden;
    }
    sf.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'pen', pointerId: 7, bubbles: false }));
    var afterLeave = !document.querySelector('.ink__pen-ring').hidden;
    return { afterLeave: afterLeave, touch: move('touch'), pen: move('pen') };
  });
  t.eq(hv.afterLeave, false, 'leaving the sheet hides it');
  t.eq(hv.touch, false, 'a finger: no ring');
  t.eq(hv.pen, true, 'a hovering stylus: the ring');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 330, { steps: 4 });
  t.eq((await ring()).shown, false, 'while a stroke is drawn: hidden (the line is the nib)');
  await page.mouse.up();
  c = await ring();
  t.eq(c.shown, true, 'the stroke done: the ring is back');
  t.same([c.cx, c.cy], [340, 330], 'where the pointer is');
  await ev(function () { window.editor.undo(); });

  t.step('every other tool has its system cursor');
  var seen = await ev(function () {
    var out = {};
    ['text', 'rect', 'ellipse', 'diamond', 'line', 'arrow', 'select', 'hand', 'eraser'].forEach(function (tool) {
      window.editor.setTool(tool);
      var c = getComputedStyle(document.querySelector('.ink__surface')).cursor;
      out[tool] = c.indexOf('M5.5 3.5l12.5 7') >= 0 && / 6 4, default$/.test(c) ? 'mr-arrow' : c;
    });
    window.editor.setEraser({ mode: 'area' });
    out.lasso = getComputedStyle(document.querySelector('.ink__surface')).cursor;
    window.editor.setEraser({ mode: 'part' });
    return out;
  });
  t.same(seen, {
    text: 'text', rect: 'crosshair', ellipse: 'crosshair', diamond: 'crosshair', line: 'crosshair', arrow: 'crosshair',
    select: 'mr-arrow', hand: 'grab', eraser: 'none', lasso: 'crosshair'
  }, 'text: I-beam; shapes: crosshair; select: MindRoot\'s arrow; hand: grab; eraser: its own circle (area: crosshair)');
  c = await ring();
  t.same([c.shown, c.nib], [false, null], 'and no ring is left on the editor');

  t.step('select: move over the selection, resize on its handles');
  await ev(function () { window.editor.setTool('rect'); });
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(420, 380, { steps: 6 });
  await page.mouse.up();
  await ev(function () {
    var els = window.editor.scene();
    window.editor.setTool('select');
    window.editor.select([els[els.length - 1].id]);
  });
  await page.mouse.move(600, 500);
  t.eq((await sheetCursor(null, [600, 500])).css, 'mr-arrow', 'off the selection: the arrow');
  await page.mouse.move(360, 340, { steps: 3 });
  t.eq((await sheetCursor(null, [360, 340])).css, 'move', 'inside it: move');
  var nw = await ev(function () { var r = document.querySelector('.ink__surface').getBoundingClientRect(); return [r.left + 296, r.top + 296]; });
  await page.mouse.move(nw[0], nw[1], { steps: 3 });
  t.eq((await sheetCursor(null, nw)).css, 'nwse-resize', 'on a corner handle: resize');
  await page.mouse.move(360, 296, { steps: 3 });
  t.eq((await sheetCursor(null, [360, 296])).css, 'ns-resize', 'on the top handle: resize up and down');
  await page.mouse.move(360, 340, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(380, 360, { steps: 4 });
  t.eq((await sheetCursor(null, [380, 360])).css, 'move', 'while moving it: still move');
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await ev(function () { window.editor.select([]); });
  await page.mouse.move(380, 360, { steps: 2 });
  t.eq((await sheetCursor(null, [380, 360])).css, 'mr-arrow', 'nothing selected: the arrow again');

  t.step('the hand grabs, and holds while the sheet moves');
  await ev(function () { window.editor.setTool('hand'); });
  await page.mouse.move(500, 400);
  t.eq((await sheetCursor(null, [500, 400])).css, 'grab', 'the hand: grab');
  await page.mouse.down();
  await page.mouse.move(540, 430, { steps: 5 });
  t.eq((await sheetCursor(null, [540, 430])).css, 'grabbing', 'panning: grabbing');
  await page.mouse.up();
  t.eq((await sheetCursor(null, [540, 430])).css, 'grab', 'let go: grab again');
  await ev(function () { window.editor.setTool('pen'); });
  await page.mouse.move(520, 420);
  await page.keyboard.down('Space');
  t.eq((await sheetCursor(null, [520, 420])).css, 'grab', 'Space held over the pen: grab');
  await page.keyboard.up('Space');
  t.eq((await ring()).cursor, 'none', 'Space let go: the ring\'s no-cursor again');
  await ev(function () { window.editor.setReadOnly(true); });
  t.eq((await sheetCursor()).css, 'grab', 'view only: grab');
  c = await ring();
  t.same([c.shown, c.nib], [false, null], 'and no ring');
  await ev(function () { window.editor.setReadOnly(false); window.editor.setTool('pen'); });
  t.eq((await ring()).nib, 'dot', 'editable again: the pen has its ring again');

  t.step('forced colours: the system cursors');
  await page.mouse.move(500, 400);
  await page.emulateMedia({ forcedColors: 'active' });
  await page.waitForFunction(function () { return !document.querySelector('.ink').hasAttribute('data-nib'); }, null, { timeout: 3000 }).catch(function () {});
  c = await ring();
  t.same([c.shown, c.cursor], [false, 'crosshair'], 'the pen: no ring, the crosshair');
  await page.emulateMedia({ forcedColors: 'none' });
  await page.waitForFunction(function () { return document.querySelector('.ink').hasAttribute('data-nib'); }, null, { timeout: 3000 }).catch(function () {});
  t.eq((await ring()).nib, 'dot', 'forced colours off: the pen has its ring again');

  t.step('pictures of the ring, on light and dark paper');
  await ev(function () { window.editor.setPen('pen'); window.editor.setSize(14); window.editor.setColor('#c4314b'); });
  await page.mouse.move(520, 380);
  await t.shot('cursors-ring-light', page);
  await ev(function () { window.editor.setLook({ theme: 'dark' }); window.editor.setColor('ink'); });
  await page.mouse.move(540, 390);
  await t.shot('cursors-ring-dark', page);
  await ev(function () { window.editor.setLook({ theme: 'light' }); });

  /* ------------------------------------------------------------------ a phone: no custom cursor */
  t.step('a finger has no ring');
  var phone = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  var pp = await phone.newPage();
  await load(pp);
  await mount(pp);
  var onPhone = await pp.evaluate(function () {
    window.editor.setTool('pen');
    window.editor.setPen('pen');
    window.editor.setColor('#c4314b');
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      hovers: matchMedia('(any-hover: hover) and (any-pointer: fine)').matches
    };
  });
  t.eq(onPhone.coarse, true, 'the phone has a coarse pointer');
  t.eq(onPhone.hovers, false, 'nothing hovers there');
  var pr = await ring(pp);
  t.same([pr.shown, pr.live], [false, false], 'no ring is shown, and the system cursor is left alone');
  t.check('the sheet\'s cursor is not hidden (' + pr.cursor + ')', pr.cursor !== 'none', pr.cursor);
  await phone.close();

  /* ------------------------------------------------------------------ the map */
  t.step('the map: grab on the empty map, the arrow on the nodes');
  await page.close();
  var s = await E.boot(t, [['Cursors', '# Root\n\n- Alpha\n- Beta\n  - Beta one\n- Gamma\n']]);
  var mp = s.page;
  function cursorAt(x, y) {
    return mp.evaluate(function (pt) {
      var el = document.elementFromPoint(pt[0], pt[1]);
      var c = el ? getComputedStyle(el).cursor : null;
      if (c && c.indexOf('M5.5 3.5l12.5 7') >= 0 && / 6 4, default$/.test(c)) c = 'mr-arrow';
      return { cursor: c, cls: el ? String(el.className.baseVal !== undefined ? el.className.baseVal : el.className) : null };
    }, [x, y]);
  }
  var empty = await mp.evaluate(function () {
    var view = window.MindRoot.session.view;
    var r = view.el.getBoundingClientRect();
    for (var y = r.top + 60; y < r.bottom - 60; y += 23) {
      for (var x = r.left + 60; x < r.right - 60; x += 31) {
        var el = document.elementFromPoint(x, y);
        if (el === view.el) return [x, y];
      }
    }
    return null;
  });
  t.check('an empty spot on the map', !!empty);
  t.eq((await cursorAt(empty[0], empty[1])).cursor, 'grab', 'grab over the empty map');
  var nb = await E.box(mp, '1');
  var onNode = await cursorAt(nb.x + Math.min(14, nb.w / 3), nb.cy);
  t.eq(onNode.cursor, 'mr-arrow', 'the arrow over a node (' + onNode.cls + ')');
  var rootBox = await E.box(mp, '');
  t.eq((await cursorAt(rootBox.cx, rootBox.cy)).cursor, 'mr-arrow', 'and over the root');

  t.step('the map: grabbing while it pans');
  await mp.mouse.move(empty[0], empty[1]);
  await mp.mouse.down();
  await mp.mouse.move(empty[0] + 30, empty[1] + 20, { steps: 6 });
  var panning = await cursorAt(empty[0] + 30, empty[1] + 20);
  t.eq(panning.cursor, 'grabbing', 'grabbing under the pointer while panning');
  await mp.mouse.up();
  await E.settled(mp);
  t.eq((await cursorAt(empty[0] + 30, empty[1] + 20)).cursor, 'grab', 'grab again once let go');

  t.step('the map: grabbing while a node is dragged to a new place');
  nb = await E.box(mp, '2');
  var sx = nb.x + Math.min(14, nb.w / 3);
  await mp.mouse.move(sx, nb.cy);
  await mp.mouse.down();
  await mp.mouse.move(sx + 6, nb.cy + 6, { steps: 2 });
  await mp.mouse.move(sx + 40, nb.cy + 30, { steps: 6 });
  var dragging = await mp.evaluate(function () { return document.documentElement.hasAttribute('data-node-drag'); });
  t.eq(dragging, true, 'the node is being dragged');
  var dragCursor = await cursorAt(sx + 40, nb.cy + 30);
  t.check('grabbing under the pointer (or not-allowed where the drop is refused)', dragCursor.cursor === 'grabbing' || dragCursor.cursor === 'not-allowed', dragCursor);
  t.eq(await mp.evaluate(function () { return getComputedStyle(document.querySelector('.mv')).cursor; }), 'grabbing', 'grabbing over the whole map');
  await mp.keyboard.press('Escape');
  await mp.mouse.up();
  await E.settled(mp);

  t.step('the map: the I-beam only inside a rename field');
  await E.select(mp, '0');
  await mp.keyboard.press('F2');
  await E.until(mp, function () { return !!document.querySelector('.mv-edit'); });
  t.eq(await mp.evaluate(function () { return getComputedStyle(document.querySelector('.mv-edit')).cursor; }), 'text', 'the rename field: the I-beam');
  await mp.keyboard.press('Escape');
};
