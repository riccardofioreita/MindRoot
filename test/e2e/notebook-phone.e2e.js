/* MindRoot - the board notebook on a phone (390 x 844, real touch points
 * from the DevTools protocol, Italian): the Map | Board switch in the
 * top capsule, the board under the thumb (the thumb bar steps aside for the
 * editor's own tools), a finger drawing the first stroke, the settings and
 * the thumbnails as bottom sheets, pages mode, a page added, two fingers
 * pinching the pages, the rail dragged by a finger, a thumbnail moved by a
 * long press, the app's Undo, Redo and "more" in the board's own bar (the
 * thumb bar is hidden), at 390 and at 320 px, and nothing wider than the
 * screen. */
'use strict';

var N = require('../fixtures/notebook/helpers.js');
var T = require('../fixtures/touch.js');

module.exports = async function (t) {
  var context = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  var page = await context.newPage();
  var cdp = await context.newCDPSession(page);
  await N.openApp(t, { page: page, lang: 'it' });
  var ids = await N.project(page, [['Garden', '# Garden\n\n- Tomatoes\n- Basil\n']]);

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  /* No pause after a finger lifts: the next tap comes at once, as a
   * person's does. Chromium reads a quick stroke on a touch-action: none
   * surface as a fling of its own and takes a tap in the next half second
   * as the touch that stops it, never a click; the board's sheet and rail
   * consume their touch moves so that it starts none (ink.js,
   * notebook.js). The suite used to wait 400 ms here instead, which hid
   * the bug on an idle machine and not on a loaded one, where the moves
   * arrive spaced like a real hand's. */
  async function touches(type, list) {
    await cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: list.map(function (p) { return { x: p[0], y: p[1], id: p[2] }; }) });
  }
  /* A quick finger, on the hand's clock (fixtures/touch.js), lifted at
   * speed: the tap that follows it must still be a click. */
  function finger(x0, y0, x1, y1, n) { return T.swipe(cdp, [x0, y0], [x1, y1], n); }
  function tap(selector) { return page.tap(selector); }
  function wide() { return ev(function () { return document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth; }); }

  /* ---------------------------------------------------------------- the switch */

  t.step('the switch in the top capsule');
  var sw = await ev(function () {
    var lead = document.querySelector('#topbar-lead .nb-switch');
    var r = lead ? lead.getBoundingClientRect() : null;
    return { lead: !!lead && !!r && r.width > 0, inView: !!r && r.right <= window.innerWidth, actions: getComputedStyle(document.querySelector('.topbar__slot--actions')).display };
  });
  t.same(sw, { lead: true, inView: true, actions: 'none' }, 'in the top capsule, on screen (the actions capsule is the thumb bar on a phone)');
  t.eq(await ev(function () { return Array.prototype.map.call(document.querySelectorAll('#topbar-lead .nb-switch [role="radio"]'), function (b) { return b.getAttribute('aria-label'); }).join(','); }), 'Mappa,Lavagna', 'in Italian');
  t.check('finger-sized options', await ev(function () { return Array.prototype.every.call(document.querySelectorAll('#topbar-lead .nb-switch [role="radio"]'), function (b) { return b.getBoundingClientRect().height >= 40; }); }));
  await tap('#topbar-lead .nb-switch [data-value="board"]');
  await N.boardReady(page);
  /* The thumb bar fades out (display is part of its transition). */
  await N.until(page, function () { return getComputedStyle(document.getElementById('thumbbar')).display === 'none'; });
  var phone = await ev(function () {
    var ink = document.querySelector('#board .ink');
    var tools = ink.querySelector('.ink__tools').getBoundingClientRect();
    return {
      thumb: getComputedStyle(document.getElementById('thumbbar')).display,
      layout: ink.getAttribute('data-layout'),
      toolsAtFoot: tools.bottom > window.innerHeight - 120,
      undo: getComputedStyle(ink.querySelector('[data-key="ink.undo"]')).display !== 'none'
    };
  });
  await t.shot('board', page);
  t.same(phone, { thumb: 'none', layout: 'compact', toolsAtFoot: true, undo: true }, 'the editor\'s tools under the thumb, its own undo with them');
  t.check('nothing wider than the screen', await wide());

  /* ---------------------------------------------------------------- a finger draws */

  t.step('a finger draws the first stroke');
  var s = await ev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await finger(s.x + 80, s.y + 260, s.x + 300, s.y + 340, 12);
  await N.idle(page);
  var b = await N.board(page);
  t.eq(b.folder, 'assets/garden-board.book', 'the board is made');
  t.check('named on the map', (await N.mapText(page, ids.pid, ids.mid)).indexOf('<!-- board: assets/garden-board.book/001.ink.svg -->') === 0);

  /* ---------------------------------------------------------------- sheets */

  t.step('settings and thumbnails are bottom sheets');
  await tap('#board [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet', { state: 'visible' });
  t.eq(await ev(function () { return document.querySelector('.nb-sheet').getAttribute('data-place'); }), 'bottom', 'the settings: a bottom sheet');
  await tap('.nb-sheet [role="radiogroup"][aria-label="Modalità"] [data-value="pages"]');
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.mode() === 'pages' && v.editor() && v.editor().page(); });
  t.check('pages mode from the sheet', true);
  t.check('the sheet stays on screen', await ev(function () { var r = document.querySelector('.nb-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; }));
  await t.shot('settings', page);
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  await tap('#board [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  t.eq(await ev(function () { return document.querySelector('.nb-sheet').getAttribute('data-place'); }), 'bottom', 'the thumbnails: a bottom sheet');
  await tap('.nb-thumbs__bar button');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 2 && document.querySelectorAll('.nb-thumb').length === 2; });
  await tap('.nb-thumbs__bar button');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 3 && document.querySelectorAll('.nb-thumb').length === 3; });
  t.check('two pages added by finger', true);
  await N.idle(page);

  t.step('a long press picks a thumbnail up');
  var tiles = await ev(function () {
    return Array.prototype.map.call(document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page'), function (el) { var r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.left]; });
  });
  var firstBefore = await ev(function () { return window.MindRoot.notebook.boardView().book().pages[0].file; });
  await touches('touchStart', [[tiles[2][0], tiles[2][1], 1]]);
  await N.until(page, function () { return !!document.querySelector('.nb-thumb--ghost'); }, undefined, 3000);
  for (var i = 1; i <= 8; i++) await touches('touchMove', [[tiles[2][0] + (tiles[0][2] + 4 - tiles[2][0]) * i / 8, tiles[2][1] + (tiles[0][1] - tiles[2][1]) * i / 8, 1]]);
  await touches('touchEnd', []);
  await N.until(page, function (f) { var v = window.MindRoot.notebook.boardView(); return v.book().pages[0].file !== f; }, firstBefore);
  await N.idle(page);
  t.eq(await ev(function () { return window.MindRoot.notebook.boardView().book().pages[0].file; }), '003.ink.svg', 'the third page is now the first');
  t.check('the Markdown follows the cover', (await N.mapText(page, ids.pid, ids.mid)).indexOf('board: assets/garden-board.book/003.ink.svg') > 0);
  await t.shot('thumbs', page);
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });

  /* ---------------------------------------------------------------- pinch and rail */

  t.step('two fingers zoom the pages, the rail scrolls them');
  var k0 = await ev(function () { return window.MindRoot.notebook.boardView().editor().camera().k; });
  /* Every element of every page (the live one from the editor), what is
   * held, and the steps: a pinch may turn the page under the first finger,
   * but must add nothing anywhere. */
  function inked() {
    return ev(function () {
      var v = window.MindRoot.notebook.boardView();
      return v.exportBook().then(function (texts) {
        var els = texts.reduce(function (n, tx) { return n + (tx ? window.MindRoot.ink.parse(tx).elements.length : 0); }, 0);
        return { els: els, dirty: v.isDirty(), steps: window.MindRoot.store.historyState().undoCount };
      });
    });
  }
  await N.idle(page);
  var ink0 = await inked();
  var mid = [s.x + s.w / 2, s.y + s.h / 2];
  await touches('touchStart', [[mid[0] - 40, mid[1], 1]]);
  await touches('touchStart', [[mid[0] - 40, mid[1], 1], [mid[0] + 40, mid[1], 2]]);
  for (var j = 1; j <= 8; j++) {
    var d = 40 + 60 * j / 8;
    await touches('touchMove', [[mid[0] - d, mid[1], 1], [mid[0] + d, mid[1], 2]]);
  }
  await touches('touchEnd', []);
  var k1 = await ev(function () { return window.MindRoot.notebook.boardView().editor().camera().k; });
  t.check('pinched in', k1 > k0 * 1.5, [k0, k1]);
  await N.idle(page);
  t.same(await inked(), ink0, 'a pinch draws nothing: no element, nothing held, no step');
  var rail = await ev(function () {
    var r = document.querySelector('#board .nb__rail');
    var hd = r.querySelector('.nb__handle').getBoundingClientRect();
    var tr = r.querySelector('.nb__track').getBoundingClientRect();
    return { x: hd.left + hd.width / 2, y: hd.top + hd.height / 2, bottom: tr.bottom, w: r.getBoundingClientRect().width };
  });
  t.check('the rail is a finger wide', rail.w >= 24, rail);
  await finger(rail.x, rail.y, rail.x, rail.bottom + 30, 10);
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 3; });
  t.check('dragged to the last page', true);
  t.check('still nothing wider than the screen', await wide());
  await t.shot('pages', page);

  /* ---------------------------------------------------------------- undo and more */

  t.step('the app\'s Undo and "more" stay at hand on the board');
  var bar = await ev(function () {
    function on(el) { if (!el) return false; var r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight; }
    return { undo: on(document.querySelector('#board [data-key="ink.undo"]')), redo: on(document.querySelector('#board [data-key="ink.redo"]')), more: on(document.querySelector('#board [data-nb="more"]')) };
  });
  t.same(bar, { undo: true, redo: true, more: true }, 'Undo, Redo and More in the board\'s bar, on screen');
  await tap('#board [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  await tap('.nb-thumbs__bar button');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 4; });
  await N.idle(page);
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  await tap('#board [data-key="ink.undo"]');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 3; });
  t.eq(await ev(function () { return window.MindRoot.store.historyState().redoLabelKey; }), 'notebook.label.addPage', 'Undo on the board takes back the page added (the app\'s history)');
  await tap('#board [data-key="ink.redo"]');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 4; });
  t.check('and Redo brings it back', true);
  await tap('#board [data-nb="more"]');
  await page.waitForSelector('.menu [role="menuitem"]', { state: 'visible' });
  var items = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.menu [role^="menuitem"]'), function (b) { return b.textContent; }); });
  t.check('"more" lists the app\'s commands: the palette, settings, the way back to the map', items.some(function (x) { return /Comandi/.test(x); }) && items.some(function (x) { return /Impostazioni/.test(x); }) && items.some(function (x) { return /Mostra la mappa/.test(x); }), items);
  t.check('and nothing that would act on the hidden map (nodes, pictures, its zoom)', !items.some(function (x) { return /fratello|figlio|immagine|Ingrandisci|Rimpicciolisci|Adatta/.test(x); }), items);
  await t.shot('more', page);
  await page.tap('.menu [role^="menuitem"]:has-text("Mostra la mappa")');
  await N.until(page, function () { return !window.MindRoot.notebook.boardShown(); });
  t.check('"Show the map" from it: the map again, its thumb bar back', await ev(function () { return getComputedStyle(document.getElementById('thumbbar')).display !== 'none'; }));

  t.step('on the smallest phone too');
  await page.setViewportSize({ width: 320, height: 640 });
  await tap('#topbar-lead .nb-switch [data-value="board"]');
  await N.boardReady(page);
  await N.until(page, function () { return getComputedStyle(document.getElementById('thumbbar')).display === 'none'; });
  var small = await ev(function () {
    function on(el) { if (!el) return false; var r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight; }
    return { undo: on(document.querySelector('#board [data-key="ink.undo"]')), more: on(document.querySelector('#board [data-nb="more"]')) };
  });
  t.same(small, { undo: true, more: true }, '320 x 640: Undo and More on screen');
  t.check('nothing wider than the screen at 320', await wide());
  await t.shot('small', page);
};
