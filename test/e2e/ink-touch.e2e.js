/* ink: the drawing editor on a phone, under fingers and a pen.
 *
 * A 390 x 844 touch screen. Fingers and the pen come from the DevTools
 * protocol (real touch and pen PointerEvents, several fingers at once), on
 * the bare host page (test/fixtures/ink/host.html).
 *
 * Covered: the compact layout (tools at the bottom under the thumb, the
 * rest in a popover, finger-sized and on screen, no sideways scroll), a
 * finger drawing, a two-finger pinch zooming about its middle, a second
 * finger turning a stroke into a pinch with nothing left behind, palm
 * rejection once a pen has been seen, a palm landing while the pen draws,
 * the popovers and the tap that puts one away (it draws nothing), text on
 * a phone (never under 16px, so iOS does not zoom), the selection bar, and
 * tablets upright and on their side and phones on their side, where the
 * bars must never cover each other. */
'use strict';

var T = require('../fixtures/touch.js');

module.exports = async function (t) {
  var context = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  var page = await context.newPage();
  var cdp = await context.newCDPSession(page);
  await page.goto(t.fileUrl('test/fixtures/ink/host.html') + '?lang=it');
  await page.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
  await page.evaluate(function () {
    window.mount({});
    window.editor.setCamera({ x: 0, y: 0, k: 1 });
    window.editor.setTool('pen');
  });

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function count() { return ev(function () { return window.editor.scene().length; }); }
  function camera() { return ev(function () { return window.editor.camera(); }); }

  function line(x1, y1, x2, y2, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
    return pts;
  }

  function touches(type, list) {
    return cdp.send('Input.dispatchTouchEvent', {
      type: type,
      touchPoints: list.map(function (p) { return { x: p[0], y: p[1], id: p[2] }; })
    });
  }

  async function finger(points) {
    await touches('touchStart', [[points[0][0], points[0][1], 1]]);
    for (var i = 1; i < points.length; i++) await touches('touchMove', [[points[i][0], points[i][1], 1]]);
    await touches('touchEnd', []);
  }

  async function pinchOut(mid, from, to, steps) {
    await touches('touchStart', [[mid[0] - from, mid[1], 1]]);
    await touches('touchStart', [[mid[0] - from, mid[1], 1], [mid[0] + from, mid[1], 2]]);
    for (var i = 1; i <= steps; i++) {
      var d = from + (to - from) * i / steps;
      await touches('touchMove', [[mid[0] - d, mid[1], 1], [mid[0] + d, mid[1], 2]]);
    }
    await touches('touchEnd', []);
  }

  async function penDown(p, force) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p[0], y: p[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: force || 0.5 });
  }
  function penMove(p, force) {
    return cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: force || 0.5 });
  }
  function penUp(p) {
    return cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p[0], y: p[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  }
  async function pen(points) {
    await penDown(points[0]);
    for (var i = 1; i < points.length; i++) await penMove(points[i]);
    await penUp(points[points.length - 1]);
  }

  /* Popovers grow in from 96%: measured mid-way they would read small. */
  function settled() {
    return page.waitForFunction(function () {
      return document.getAnimations().filter(function (a) { return a.playState === 'running'; }).length === 0;
    }, null, { timeout: 3000, polling: 20 });
  }

  /* Everything a finger could press, if it is drawn. */
  async function controls() {
    await settled();
    return ev(function () {
      var out = { outside: [], small: [], count: 0 };
      var vw = innerWidth;
      var vh = innerHeight;
      Array.prototype.forEach.call(document.querySelectorAll('.ink button, .ink input, .ink label'), function (el) {
        var cs = getComputedStyle(el);
        if (el.closest('[hidden]') || cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (el.matches('.ink__custom-input')) return;
        out.count++;
        var name = el.getAttribute('aria-label') || el.className;
        if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.outside.push(name);
        if (el.matches('.ink__range')) return;
        if (r.width < 43.5 || r.height < 43.5) out.small.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return out;
    });
  }

  /* ---------------------------------------------------------------- layout */

  t.step('a phone layout');
  var lay = await ev(function () {
    var tools = document.querySelector('.ink__tools').getBoundingClientRect();
    var actions = document.querySelector('.ink__actions').getBoundingClientRect();
    return {
      layout: window.editor.layout(),
      toolsAtBottom: tools.bottom > innerHeight - 40 && tools.top > innerHeight / 2,
      actionsAtTop: actions.top < 40,
      zoom: getComputedStyle(document.querySelector('.ink__zoom')).display,
      wideShapes: getComputedStyle(document.querySelector('.ink__tool[data-tool="rect"]')).display,
      coarse: matchMedia('(pointer: coarse)').matches,
      scroll: document.documentElement.scrollWidth <= innerWidth
    };
  });
  t.same(lay, { layout: 'compact', toolsAtBottom: true, actionsAtTop: true, zoom: 'none', wideShapes: 'none', coarse: true, scroll: true },
    'tools under the thumb, actions at the top, the rest folded away, no sideways scroll');
  var c0 = await controls();
  t.check('every control on screen and finger-sized (' + c0.count + ')', !c0.outside.length && !c0.small.length && c0.count >= 9, c0);

  t.step('the chevrons and the hint on a phone');
  var up = await ev(function () {
    return ['pen', 'eraser', 'text'].map(function (n) {
      var b = document.querySelector('.ink__tool[data-tool="' + n + '"]').getBoundingClientRect();
      var c = document.querySelector('.ink__tool[data-tool="' + n + '"] .ink__caret-icon');
      var r = c.getBoundingClientRect();
      return n + ':' + (r.top + r.height / 2 < b.top + b.height / 2) + ':' + (r.left + r.width / 2 > b.left + b.width / 2) + ':' + getComputedStyle(c).rotate;
    }).join(' ') + ' shapes:' + !!document.querySelector('.ink__compact[data-key="ink.tool.shapes"] .ink__caret');
  });
  t.eq(up, 'pen:true:true:180deg eraser:true:true:180deg text:true:true:180deg shapes:true', 'under the thumb the chevrons sit at the top right and point up, where the options open');
  await page.tap('.ink__tool[data-tool="eraser"]');
  await settled();
  var hint = await ev(function () {
    var el = document.querySelector('.ink__coach');
    var r = el.getBoundingClientRect();
    var b = document.querySelector('.ink__tool[data-tool="eraser"]').getBoundingClientRect();
    return { shown: !el.hidden, text: el.textContent, above: r.bottom < b.top, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && el.scrollWidth <= el.clientWidth, pop: !document.querySelector('.ink__pop').hidden };
  });
  t.same(hint, { shown: true, text: 'Tocca di nuovo per le opzioni della gomma', above: true, inside: true, pop: false }, 'the eraser taken by finger: "tap again" above it, on screen');
  await t.shot('phone-coach', page);
  await page.tap('.ink__tool[data-tool="eraser"]');
  t.eq(await ev(function () { return document.querySelector('.ink__coach').hidden + ',' + document.querySelector('.ink__pop').getAttribute('data-kind') + ',' + !document.querySelector('.ink__pop').hidden; }), 'true,eraser,true', 'tapped again: the hint goes, the eraser options open');
  var penCaret = await ev(function () {
    var r = document.querySelector('.ink__tool[data-tool="pen"] .ink__caret-icon').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  await page.touchscreen.tap(penCaret[0], penCaret[1]);
  t.eq(await ev(function () { return window.editor.tool() + ',' + document.querySelector('.ink__pop').getAttribute('data-kind') + ',' + !document.querySelector('.ink__pop').hidden; }), 'pen,pen,true', 'a tap on the pen\'s chevron takes the pen and opens its options at once');
  await page.touchscreen.tap(penCaret[0], penCaret[1]);
  t.eq(await ev(function () { return window.editor.tool() + ',' + document.querySelector('.ink__pop').hidden + ',' + window.editor.scene().length; }), 'pen,true,0', 'and again puts them away, drawing nothing');

  t.step('a tap on the sheet that puts the options away does nothing else');
  await page.tap('.ink__tool[data-tool="pen"]');
  await page.tap('.ink__pop .ink__colors [aria-label="Rosso"]');
  t.eq(await ev(function () { return !document.querySelector('.ink__pop').hidden && window.editor.settings().pens.pen.color; }), '#c4314b', 'the pen options open, red picked');
  await page.tap('.ink__surface', { position: { x: 200, y: 300 } });
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden + ',' + window.editor.scene().length + ',' + window.editor.isDirty() + ',' + window.editor.penSeen(); }),
    'true,0,false,false', 'the finger closes the popover and draws no dot (no pen seen yet)');
  await page.waitForTimeout(800);
  t.eq(await ev(function () { return window.saves.length; }), 0, 'so a new drawing creates no file');
  await finger(line(60, 250, 200, 260, 8));
  t.eq(await count(), 1, 'the next touch draws, in red');
  await ev(function () { window.editor.undo(); window.editor.setColor('#1f2328'); });

  /* ---------------------------------------------------------------- fingers */

  t.step('a finger draws, two fingers zoom');
  await finger(line(60, 300, 300, 340, 16));
  var s = await ev(function () { return window.editor.scene(); });
  t.check('a finger draws a stroke, its pressure simulated', s.length === 1 && s[0].sim === true, s);
  var before = await camera();
  var under = await ev(function () { return window.editor.toScene(195, 500); });
  await pinchOut([195, 500], 50, 100, 8);
  var after = await camera();
  var still = await ev(function () { return window.editor.toScene(195, 500); });
  t.check('two fingers apart: twice the zoom', Math.abs(after.k / before.k - 2) < 0.02, { before: before, after: after });
  t.check('about the point between them', Math.abs(still[0] - under[0]) < 0.5 && Math.abs(still[1] - under[1]) < 0.5, { under: under, still: still });
  t.eq(await count(), 1, 'and nothing drawn by either finger');
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 1 }); });

  t.step('a second finger turns a stroke into a pinch, leaving nothing');
  var depthBefore = await ev(function () { return window.editor.history().undo; });
  await touches('touchStart', [[60, 450, 1]]);
  for (var i = 1; i <= 6; i++) await touches('touchMove', [[60 + i * 20, 450, 1]]);
  var drawing = await ev(function () { return document.querySelectorAll('.ink__live *').length; });
  await touches('touchStart', [[180, 450, 1], [300, 600, 2]]);
  await touches('touchMove', [[170, 450, 1], [320, 620, 2]]);
  await touches('touchEnd', []);
  t.eq(drawing, 1, 'the stroke was being drawn');
  t.eq((await count()) + ',' + (await ev(function () { return document.querySelectorAll('.ink__live *').length + ',' + window.editor.busy(); })), '1,0,false', 'it is dropped when the second finger lands');
  t.eq(await ev(function () { return window.editor.history().undo; }), depthBefore, 'and no undo step is left');
  await ev(function () { window.editor.undo(); });
  t.eq(await count(), 0, 'the next undo takes the stroke before it');
  await ev(function () { window.editor.redo(); window.editor.setCamera({ x: 0, y: 0, k: 1 }); });

  /* ---------------------------------------------------------------- pen and palm */

  t.step('palm rejection');
  var pts = line(60, 380, 320, 400, 20);
  await pen(pts);
  t.eq((await count()) + ',' + (await ev(function () { return window.editor.penSeen(); })), '2,true', 'the pen draws, and is noticed');
  var cam1 = await camera();
  await finger(line(200, 600, 120, 560, 8));
  var cam2 = await camera();
  t.eq((await count()) + ',' + Math.round(cam1.x - cam2.x) + ',' + Math.round(cam1.y - cam2.y), '2,80,40', 'now a finger only moves the sheet');
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 1 }); });

  await penDown([60, 480]);
  await penMove([100, 485]);
  await touches('touchStart', [[300, 700, 5]]);
  await penMove([160, 490]);
  await touches('touchMove', [[310, 690, 5]]);
  await penMove([240, 495]);
  await penUp([240, 495]);
  await touches('touchEnd', []);
  var last = await ev(function () { var all = window.editor.scene(); return all[all.length - 1]; });
  t.eq(await count(), 3, 'a palm landing while the pen draws does not stop it');
  t.check('the stroke goes where the pen went', last.type === 'stroke' && last.sim === false && Math.abs(last.points[last.points.length - 1][0] - 240) < 1, last.points);
  t.eq(await ev(function () { var c = window.editor.camera(); return c.x + ',' + c.y; }), '0,0', 'and the palm did not move the sheet');


  t.step('a palm that lands first gives way to the pen');
  var n3 = await count();
  var camA = await camera();
  await touches('touchStart', [[300, 760, 7]]);
  await touches('touchMove', [[290, 750, 7]]);
  await penDown([60, 560]);
  await touches('touchMove', [[270, 740, 7]]);
  await penMove([120, 570]);
  await penMove([200, 580]);
  await penUp([200, 580]);
  await touches('touchEnd', []);
  var camB = await camera();
  t.eq((await count()) - n3, 1, 'the pen draws although the palm was down first');
  t.check('and the palm moved the sheet only before the pen came', Math.abs(camB.x - camA.x) <= 10 && Math.abs(camB.y - camA.y) <= 10, { camA: camA, camB: camB });
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 1 }); });

  /* ---------------------------------------------------------------- popovers */

  t.step('the popovers on a phone');
  /* A quick finger pan, on the hand's clock (a move every 16 ms, as a
   * screen reports them), and the tool pressed at once: Chromium reads such
   * a pan as a fling and takes the next tap as the touch that stops it,
   * never a click, unless the sheet consumes its touches. Sent unstamped,
   * the pan's speed was whatever the runner's load made it, and the tap
   * below was lost only on a busy machine. */
  var pan0 = await ev(function () {
    /* The middle of the sheet's free part, above its bar: the finger must
     * land on the sheet itself, or the step would test nothing. */
    var sf = document.querySelector('.ink__surface').getBoundingClientRect();
    var bar = document.querySelector('.ink__tools').getBoundingClientRect();
    var x = sf.left + sf.width / 2;
    var y = sf.top + (Math.min(sf.bottom, bar.top) - sf.top) / 2;
    var el = document.elementFromPoint(x, y);
    return { x: x, y: y, on: !!(el && el.closest('.ink__surface')) };
  });
  t.check('the pan starts on the sheet', pan0.on, pan0);
  await T.swipe(cdp, [pan0.x, pan0.y], [pan0.x - 60, pan0.y - 30], 3, 9);
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 1 }); });
  await page.tap('.ink__tool[data-tool="pen"]');
  var pop = await ev(function () {
    var p = document.querySelector('.ink__pop');
    var r = p.getBoundingClientRect();
    var bar = document.querySelector('.ink__tools').getBoundingClientRect();
    return { open: !p.hidden, kind: p.getAttribute('data-kind'), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0, above: r.bottom <= bar.top + 0.5 };
  });
  t.same(pop, { open: true, kind: 'pen', inside: true, above: true }, 'the pen in hand pressed again: its options, above the bar, on screen');
  var c1 = await controls();
  t.check('finger-sized there too (' + c1.count + ')', !c1.outside.length && !c1.small.length, c1);
  await page.tap('.ink__pop [aria-label="Evidenziatore"]');
  await page.tap('.ink__pop .ink__colors [aria-label="Verde"]');
  t.eq(await ev(function () { var st = window.editor.settings(); return st.pen + ',' + st.pens.highlighter.color; }), 'highlighter,#2f7d5a', 'an instrument and a colour chosen by finger');
  await page.tap('.ink__surface', { position: { x: 200, y: 200 } });
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden; }), true, 'a tap on the sheet closes it');
  t.eq(await count(), 4, 'and draws nothing (a finger, after a pen)');

  await page.tap('.ink__tools [aria-label="Forme"]');
  t.eq(await ev(function () { return window.editor.tool(); }), 'rect', 'the shapes button takes the last shape');
  await page.tap('.ink__tools [aria-label="Forme"]');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').getAttribute('data-kind') + ',' + document.querySelectorAll('.ink__pop [role="radiogroup"]')[0].children.length; }), 'shape,5', 'and pressed again, the five shapes');
  await page.tap('.ink__pop [aria-label="Ellisse"]');
  t.eq(await ev(function () { return window.editor.tool() + ',' + !document.querySelector('.ink__pop').hidden; }), 'ellipse,true', 'a shape chosen, the options stay open');
  await page.tap('.ink__surface', { position: { x: 200, y: 250 } });
  await pen(line(80, 560, 240, 640, 8));
  t.eq(await ev(function () { var all = window.editor.scene(); return all[all.length - 1].type; }), 'ellipse', 'and drawn with the pen');

  await page.tap('.ink__tools [aria-label="Altro"]');
  var more = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.ink__pop button'), function (b) { return b.getAttribute('aria-label'); }).join(','); });
  t.eq(more, 'Sposta la vista,Aggiungi un\'immagine,Riduci,Torna al 100%,Ingrandisci,Adatta il disegno', 'More: the hand, a picture and the zoom');
  await page.tap('.ink__pop [aria-label="Ingrandisci"]');
  t.eq(await ev(function () { return Math.round(window.editor.camera().k * 100) + ',' + document.querySelector('.ink__pop .ink__zoom-level').textContent; }), '125,125%', 'zoom from there, and the level follows');
  await page.tap('.ink__pop [aria-label="Adatta il disegno"]');
  t.eq(await ev(function () { return document.querySelector('.ink__pop').hidden; }), true, 'Fit closes it');

  /* ---------------------------------------------------------------- text and selection */

  t.step('text on a phone');
  await ev(function () { window.editor.setCamera({ x: 0, y: 0, k: 0.5 }); });
  await page.tap('.ink__tool[data-tool="text"]');
  await pen([[100, 200], [101, 200]]);
  var field = await ev(function () {
    var ta = document.querySelector('.ink__text');
    return { open: !ta.hidden, focused: document.activeElement === ta, size: parseFloat(getComputedStyle(ta).fontSize) };
  });
  t.check('a pen tap with the text tool opens the field, at 16px or more even zoomed out', field.open && field.focused && field.size >= 16, field);
  await page.keyboard.insertText('Memo');
  await page.tap('.ink__surface', { position: { x: 300, y: 600 } });
  var written = await ev(function () { var all = window.editor.scene(); return all[all.length - 1]; });
  t.eq(written.type + ',' + written.text + ',' + written.size, 'text,Memo,24', 'a tap elsewhere writes it, at the sheet size chosen');

  t.step('the selection bar');
  await page.tap('.ink__tool[data-tool="select"]');
  var at = await ev(function (id) { var r = document.querySelector('[data-id="' + id + '"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, written.id);
  await pen([at, [at[0] + 1, at[1]]]);
  var bar = await ev(function () {
    var b = document.querySelector('.ink__selbar');
    var r = b.getBoundingClientRect();
    return { shown: !b.hidden, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, selected: window.editor.selection().length };
  });
  t.same(bar, { shown: true, inside: true, selected: 1 }, 'a pen tap selects, the bar shows, on screen');
  var c2 = await controls();
  t.check('its buttons finger-sized', !c2.small.length && !c2.outside.length, c2);
  await page.tap('.ink__selbar [aria-label="Duplica"]');
  t.eq(await ev(function () { return window.editor.scene().filter(function (el) { return el.type === 'text'; }).length; }), 2, 'Duplicate from the bar');
  await page.tap('.ink__selbar [aria-label="Elimina"]');
  t.eq(await ev(function () { return window.editor.scene().filter(function (el) { return el.type === 'text'; }).length + ',' + window.editor.selection().length; }), '1,0', 'Delete from the bar');
  await page.tap('.ink__actions [aria-label="Annulla"]');
  t.eq(await ev(function () { return window.editor.scene().filter(function (el) { return el.type === 'text'; }).length; }), 2, 'Undo by finger');

  t.same(await ev(function () { return window.inkMissingStrings; }), [], 'no string missing');
  await ev(function () { window.editor.fit(); });
  await t.shot('phone', page);
  await context.close();

  /* ---------------------------------------------------------------- the hint on narrow phones */

  t.step('narrow phones: the "tap again" bubble hugs its wrapped text');
  var narrow = [[320, 'text'], [360, 'eraser']];
  var fits = [];
  for (var q = 0; q < narrow.length; q++) {
    var nctx = await t.newContext({ viewport: { width: narrow[q][0], height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    var npg = await nctx.newPage();
    await npg.goto(t.fileUrl('test/fixtures/ink/host.html') + '?lang=it');
    await npg.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
    await npg.evaluate(function () { window.mount({}); });
    await npg.tap('.ink__tool[data-tool="' + narrow[q][1] + '"]');
    await npg.waitForFunction(function () { var c = document.querySelector('.ink__coach'); return c && !c.hidden; });
    fits.push(await npg.evaluate(function (kind) {
      var el = document.querySelector('.ink__coach');
      var range = document.createRange();
      range.selectNodeContents(el);
      var k = el.offsetWidth / el.getBoundingClientRect().width;
      var lines = Array.prototype.map.call(range.getClientRects(), function (r) { return r.width * k; });
      var widest = Math.max.apply(null, lines);
      var box = { left: el.offsetLeft, width: el.offsetWidth, right: el.offsetLeft + el.offsetWidth };
      var host = el.offsetParent.getBoundingClientRect();
      box.left += host.left;
      box.right += host.left;
      var b = document.querySelector('.ink__tool[data-tool="' + kind + '"]').getBoundingClientRect();
      var arrow = parseFloat(el.style.getPropertyValue('--coach-arrow'));
      return {
        size: innerWidth, text: el.textContent, lines: lines.length, box: Math.round(box.width), widest: Math.round(widest),
        slack: Math.round(box.width - widest - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight)), inside: box.left >= 0 && box.right <= innerWidth,
        arrowOnTool: Math.abs(box.left + arrow - (b.left + b.width / 2)) <= 1.5
      };
    }, narrow[q][1]));
    if (q === 1) await t.shot('phone-coach-narrow', npg);
    await nctx.close();
  }
  /* Whether the words wrap (one line or two) depends on the font the machine has; either way the bubble must not be wider than its text. */
  t.check('at 320 and 360px the hint is no wider than its widest line and its padding (4px spare at most), on screen, its arrow on the tool',
    fits.every(function (f) { return f.lines >= 1 && f.slack <= 4 && f.inside && f.arrowOnTool; }), fits);

  /* ---------------------------------------------------------------- tablets, phones on their side */

  t.step('tablets and phones on their side: the bars never overlap');
  var sizes = [[768, 1024], [810, 1080], [834, 1194], [1024, 768], [1180, 820], [1366, 1024], [667, 375], [844, 390], [932, 430]];
  var rows = [];
  for (var z = 0; z < sizes.length; z++) {
    var ctx = await t.newContext({ viewport: { width: sizes[z][0], height: sizes[z][1] }, hasTouch: true, isMobile: true });
    var pg = await ctx.newPage();
    await pg.goto(t.fileUrl('test/fixtures/ink/host.html') + '?lang=it');
    await pg.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
    rows.push(await pg.evaluate(function () {
      window.mount({ onSave: function () { return new Promise(function () {}); } });
      var s = document.querySelector('.ink__surface');
      function f(type, x, y) { s.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 })); }
      window.editor.setTool('pen');
      f('pointerdown', 150, 200); f('pointermove', 200, 220); f('pointerup', 200, 220);
      window.editor.save();
      var bars = ['.ink__tools', '.ink__actions', '.ink__zoom'].map(function (sel) {
        var el = document.querySelector(sel);
        return getComputedStyle(el).display === 'none' ? null : el.getBoundingClientRect();
      }).filter(Boolean);
      var overlap = false;
      for (var i = 0; i < bars.length; i++) {
        for (var j = i + 1; j < bars.length; j++) {
          var a = bars[i];
          var b = bars[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlap = true;
        }
      }
      var small = [];
      var outside = [];
      Array.prototype.forEach.call(document.querySelectorAll('.ink__bar button'), function (el) {
        if (el.closest('[hidden]') || getComputedStyle(el).display === 'none' || !el.getClientRects().length) return;
        var r = el.getBoundingClientRect();
        if (r.width < 43.5 || r.height < 43.5) small.push(el.getAttribute('aria-label'));
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) outside.push(el.getAttribute('aria-label'));
      });
      var tools = document.querySelector('.ink__tools');
      return { size: innerWidth + 'x' + innerHeight, layout: window.editor.layout(), state: window.editor.saveState(), overlap: overlap, small: small, outside: outside, clipped: tools.scrollWidth > tools.clientWidth + 1 };
    }));
    await ctx.close();
  }
  t.check('at every size: no bar over another, every button on screen and finger-sized, no tool scrolled out of sight',
    rows.every(function (r) { return !r.overlap && !r.small.length && !r.outside.length && !r.clipped && r.state === 'saving'; }), rows);
  t.check('an upright iPad gets the thumb layout, a landscape one the wide one',
    rows[0].layout === 'compact' && rows[2].layout === 'compact' && rows[4].layout === 'wide' && rows[5].layout === 'wide', rows.map(function (r) { return r.size + ' ' + r.layout; }));
};
