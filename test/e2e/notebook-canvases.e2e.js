/* MindRoot - the canvases of an infinite board, on the real app: with a
 * mouse and the keyboard at 1280 x 800, canvases added from the thumbnails
 * (one shown at a time, each its own page file, book.json still 'infinite'),
 * a switch by thumbnail, by Page Down / Page Up and from the rail (a press
 * on a stretch, a swipe along it), each canvas keeping its own camera, a
 * reorder by drag (the Markdown following the first canvas), one to the
 * trash and back, the PDF (a page per drawn canvas, each cut to its
 * drawing) and the PNG of the canvas shown, and a reload that opens the
 * board on the canvas left, under its camera. Then on a phone (390 x 844,
 * real touch points): the thumbnails in a bottom sheet, a canvas added, the
 * rail swiped by a finger, nothing wider than the screen. */
'use strict';

var N = require('../fixtures/notebook/helpers.js');
var T = require('../fixtures/touch.js');

module.exports = async function (t) {
  var page = t.page;
  await N.openApp(t);
  var ids = await N.project(page, [['Garden', '# Garden\n\n- Rose\n- Basil\n']]);
  var folder = 'assets/garden-board.book';

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function view(fn, arg) {
    return page.evaluate(function (a) {
      var v = window.MindRoot.notebook.boardView();
      return (new Function('v', 'arg', 'return (' + a.fn + ')(v, arg);'))(v, a.arg);
    }, { fn: String(fn), arg: arg === undefined ? null : arg });
  }
  async function surfaceBox() {
    return ev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  }
  function history() { return ev(function () { var h = window.MindRoot.store.historyState(); return { n: h.undoCount, key: h.undoLabelKey }; }); }
  function camera() { return view(function (v) { var c = v.editor().camera(); return { x: Math.round(c.x), y: Math.round(c.y), k: Math.round(c.k * 1000) / 1000 }; }); }
  function shown() { return view(function (v) { return { page: v.page(), id: v.editor().pageId(), strokes: v.editor().elements().length }; }); }
  function elementsOf(file) { return N.fileText(page, ids.pid, folder + '/' + file).then(function (svg) { return ev(function (s) { return window.MindRoot.ink.parse(s).elements.length; }, svg); }); }
  function railBox() {
    return ev(function () {
      var r = document.querySelector('#board .nb__rail');
      var tr = r.querySelector('.nb__track').getBoundingClientRect();
      var hd = r.querySelector('.nb__handle').getBoundingClientRect();
      return { hidden: r.hidden, x: tr.left + tr.width / 2, right: r.getBoundingClientRect().right, top: tr.top, bottom: tr.bottom, h: tr.height, hy: hd.top + hd.height / 2, text: r.getAttribute('aria-valuetext'), ticks: r.querySelectorAll('.nb__tick').length };
    });
  }
  async function openThumbs() {
    await page.click('#board [data-nb="pages"]');
    await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  }
  async function closeSheet() {
    await page.keyboard.press('Escape');
    await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  }

  /* ---------------------------------------------------------------- the board, one canvas */

  t.step('an infinite board with one canvas');
  await page.click('#topbar-actions .nb-switch [data-value="board"]');
  await N.boardReady(page);
  var s0 = await surfaceBox();
  await N.stroke(page, s0.x + 300, s0.y + 250, s0.x + 520, s0.y + 330);
  await N.idle(page);
  t.same(Object.keys(await N.folder(page, ids.pid, folder)).sort(), ['001.ink.svg', 'book.json'], 'the board is born with its first canvas');
  t.check('one canvas: no rail', (await railBox()).hidden);
  t.eq(await ev(function () { return document.querySelector('#board [data-nb="pages"]').getAttribute('aria-label'); }), 'Canvases', 'the canvases button in the bar');

  /* ---------------------------------------------------------------- canvases added */

  t.step('two canvases added from the thumbnails');
  await openThumbs();
  t.eq(await ev(function () { var el = document.querySelector('.nb-sheet .sheet__title'); return el ? el.textContent : null; }), 'Canvases', 'the sheet of the canvases');
  t.eq(await ev(function () { return document.querySelector('.nb-thumbs__bar button').textContent.trim(); }), 'Add a canvas', 'its button adds a canvas');
  for (var i = 0; i < 2; i++) {
    var n0 = await view(function (v) { return v.pages(); });
    await page.click('.nb-thumbs__bar button');
    await N.until(page, function (n) { var v = window.MindRoot.notebook.boardView(); return v.pages() === n + 1 && document.querySelectorAll('.nb-thumbs__grid .nb-thumb').length === n + 1; }, n0);
  }
  await N.idle(page);
  t.eq((await history()).key, 'notebook.label.addCanvas', 'each one a step: add a canvas');
  t.same(Object.keys(await N.folder(page, ids.pid, folder)).filter(function (f) { return /\.ink\.svg$/.test(f); }).sort(), ['001.ink.svg', '002.ink.svg', '003.ink.svg'], 'a page file per canvas');
  var json = JSON.parse(await N.fileText(page, ids.pid, folder + '/book.json'));
  t.same([json.mode, json.pages.length], ['infinite', 3], 'book.json: still infinite, with its pages');
  t.check('the thumbnails are pictures of the canvases, in a landscape frame', await ev(function () {
    var b = document.querySelector('.nb-thumbs__grid .nb-thumb__page');
    var r = b.getBoundingClientRect();
    return Math.abs(r.width / r.height - 4 / 3) < 0.05;
  }));
  /* Canvas 1's drawing is a wide stroke: its picture is still 4:3 (the
   * paper drawn round it), so no band of the button shows above and below. */
  await N.until(page, function () { var img = document.querySelector('.nb-thumbs__grid .nb-thumb__page img'); return img && img.complete && img.naturalWidth > 0; });
  var pic = await ev(function () { var img = document.querySelector('.nb-thumbs__grid .nb-thumb__page img'); return [img.naturalWidth, img.naturalHeight]; });
  t.check('the picture of a wide drawing fills the frame: 4:3, not letterboxed', Math.abs(pic[0] / pic[1] - 4 / 3) < 0.02, pic);
  await t.shot('canvases-thumbs');
  await closeSheet();
  t.same(await shown(), { page: 3, id: '003.ink.svg', strokes: 0 }, 'the canvas added last is the one shown, empty');
  t.check('only one canvas on screen: the editor shows one page file', await ev(function () { return document.querySelectorAll('#board .ink').length === 1 && !document.querySelector('#board .nb__page'); }));
  var rail = await railBox();
  t.same([rail.hidden, rail.ticks, rail.text], [false, 3, 'Canvas 3 of 3'], 'the rail: a stretch per canvas, on canvas 3');

  /* ---------------------------------------------------------------- drawing on canvas 3, its camera */

  t.step('a stroke on canvas 3, and a camera of its own');
  var s1 = await surfaceBox();
  await N.stroke(page, s1.x + 400, s1.y + 300, s1.x + 640, s1.y + 420);
  await N.idle(page);
  t.eq(await elementsOf('003.ink.svg'), 1, 'canvas 3 has its stroke');
  t.eq(await elementsOf('001.ink.svg'), 1, 'canvas 1 as it was');
  t.check('the Markdown still names the first canvas', (await N.mapText(page, ids.pid, ids.mid)).indexOf('<!-- board: ' + folder + '/001.ink.svg -->') === 0);
  await page.focus('#board .ink');
  await page.keyboard.down('Control');
  await page.mouse.move(s1.x + 520, s1.y + 360);
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().editor().camera().k > 1.05; });
  var cam3 = await camera();
  t.check('Ctrl + wheel zoomed canvas 3', cam3.k > 1.05, cam3);
  await t.shot('canvas-3');

  /* ---------------------------------------------------------------- switching */

  t.step('a thumbnail shows its canvas, under its own camera');
  await openThumbs();
  await page.click('.nb-thumbs__grid .nb-thumb:nth-child(1) .nb-thumb__page');
  await N.until(page, function () { return !document.querySelector('.nb-sheet') && window.MindRoot.notebook.boardView().page() === 1; });
  t.same(await shown(), { page: 1, id: '001.ink.svg', strokes: 1 }, 'canvas 1, its own stroke');
  var cam1 = await camera();
  t.check('not the camera of canvas 3', cam1.k !== cam3.k || cam1.x !== cam3.x, [cam1, cam3]);

  t.step('Page Down and Page Up');
  await page.focus('#board .ink');
  await page.keyboard.press('PageDown');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 2; });
  await page.keyboard.press('PageDown');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 3; });
  t.same(await camera(), cam3, 'canvas 3 again: the camera it was left with');
  t.eq(await ev(function () { return document.querySelector('#board .nb__sr').textContent; }), 'Canvas 3 of 3', 'said to a screen reader');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.same(await camera(), cam1, 'canvas 1 again: its own camera');

  t.step('the rail: a press on a stretch, a swipe along it, the handle dragged');
  rail = await railBox();
  await page.mouse.click(rail.x, rail.bottom - 6);
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 3; });
  t.check('a press on the last stretch: canvas 3', true);
  rail = await railBox();
  await page.mouse.move(rail.x, rail.top + 8);
  await page.mouse.down();
  await page.mouse.move(rail.x, rail.top + 30, { steps: 3 });
  await page.mouse.move(rail.x, rail.top + 70, { steps: 3 });
  await page.mouse.up();
  t.eq(await view(function (v) { return v.page(); }), 3, 'a swipe down on the last canvas: nothing after it');
  /* Off the handle (on the last stretch): from the middle one, upwards. */
  var mid = rail.top + rail.h / 2;
  await page.mouse.move(rail.x, mid + 30);
  await page.mouse.down();
  await page.mouse.move(rail.x, mid, { steps: 3 });
  await page.mouse.move(rail.x, mid - 40, { steps: 3 });
  await page.mouse.up();
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 2; });
  t.check('a swipe up off the handle: the canvas before', true);
  rail = await railBox();
  await page.mouse.move(rail.x, rail.hy);
  await page.mouse.down();
  await page.mouse.move(rail.x, rail.hy - 40, { steps: 4 });
  await page.mouse.move(rail.x, rail.top + 4, { steps: 6 });
  var bubble = await ev(function () { var b = document.querySelector('#board .nb__bubble'); return { text: b.textContent, shown: +getComputedStyle(b).opacity }; });
  await page.mouse.up();
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.eq(bubble.text, '1 / 3', 'the handle dragged to the top: canvas 1, said in the bubble');
  t.check('the bubble shows while it moves', bubble.shown > 0.5, bubble);

  t.step('the right edge stays drawing surface: a stroke beside the rail draws, the canvas stays');
  rail = await railBox();
  var before = (await shown()).strokes;
  /* On canvas 3's stretch of the rail (a press there on the line shows
   * canvas 3), a few px from the edge, inside the rail's 28 px strip. */
  var edgeY = rail.bottom - rail.h / 6;
  await N.stroke(page, rail.right - 4, edgeY, rail.right - 160, edgeY + 30);
  await N.idle(page);
  var after1 = await shown();
  t.eq(after1.page, 1, 'still canvas 1');
  t.eq(after1.strokes, before + 1, 'the stroke is drawn on it');
  t.eq(await elementsOf('001.ink.svg'), before + 1, 'and written into its file');

  /* ---------------------------------------------------------------- reorder */

  t.step('reorder by dragging a thumbnail: the Markdown follows the first canvas');
  await openThumbs();
  var tiles = await ev(function () {
    return Array.prototype.map.call(document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page'), function (b) { var r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left }; });
  });
  var steps = (await history()).n;
  await page.mouse.move(tiles[2].x, tiles[2].y);
  await page.mouse.down();
  await page.mouse.move(tiles[2].x + 10, tiles[2].y + 10, { steps: 3 });
  await page.mouse.move(tiles[0].l + 6, tiles[0].y, { steps: 10 });
  await page.mouse.up();
  await N.until(page, function () { return window.MindRoot.notebook.boardView().book().pages[0].file === '003.ink.svg'; });
  await N.idle(page);
  t.same(await view(function (v) { return v.book().pages.map(function (p) { return p.file; }); }), ['003.ink.svg', '001.ink.svg', '002.ink.svg'], 'canvas 3 is first');
  t.check('the board marker names it', (await N.mapText(page, ids.pid, ids.mid)).indexOf('<!-- board: ' + folder + '/003.ink.svg -->') === 0);
  var h = await history();
  t.same([h.n, h.key], [steps + 1, 'notebook.label.moveCanvas'], 'one step: move the canvas');
  t.eq(await view(function (v) { return v.editor().pageId(); }), '001.ink.svg', 'the canvas shown stays shown');

  /* ---------------------------------------------------------------- delete and restore */

  t.step('a canvas to the trash and back');
  await page.hover('.nb-thumbs__grid .nb-thumb:nth-child(3)');
  await page.click('.nb-thumbs__grid .nb-thumb:nth-child(3) .nb-thumb__more');
  await page.click('.menu [role="menuitem"]:has-text("Move the canvas to the trash")');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 2; });
  await N.idle(page);
  t.eq((await history()).key, 'notebook.label.deleteCanvas', 'one step: move the canvas to the trash');
  var trash = await ev(function (a) { return window.MindRoot.store.trash(a.pid).filter(function (e) { return e.path === a.path; }).map(function (e) { return { kind: e.kind, owner: e.owner, id: e.id }; })[0] || null; }, { pid: ids.pid, path: folder + '/002.ink.svg' });
  t.check('in the project trash, named as a canvas of the board', trash && trash.kind === 'asset' && /canvas 3/.test(trash.owner), trash);
  t.check('its file left the folder', !(await N.folder(page, ids.pid, folder))['002.ink.svg']);
  await ev(function (a) { window.MindRoot.store.restoreTrash(a.pid, a.id); }, { pid: ids.pid, id: trash.id });
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 3 && document.querySelectorAll('.nb-thumbs__grid .nb-thumb').length === 3; });
  t.same(await view(function (v) { return v.book().pages.map(function (p) { return p.file; }); }), ['003.ink.svg', '001.ink.svg', '002.ink.svg'], 'restored where it was');
  await closeSheet();

  /* ---------------------------------------------------------------- export */

  t.step('PDF: a page per drawn canvas, cut to its drawing; PNG: the canvas shown');
  await N.idle(page);
  var pdfInfo = await ev(function () {
    var v = window.MindRoot.notebook.boardView();
    return v.exportBook().then(function (texts) { return window.MindRoot.notebook.exportPdf(v.book(), { print: false, texts: texts }); }).then(function (out) { return out.pages; });
  });
  t.eq(pdfInfo.length, 2, 'two pages: the empty canvas is left out');
  t.check('each page cut to its canvas\'s drawing, not a paper size', pdfInfo.every(function (p) { return p.w < 297 && p.h < 210; }) && (pdfInfo[0].w !== pdfInfo[1].w || pdfInfo[0].h !== pdfInfo[1].h), pdfInfo);
  var buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  var sizes = N.pdfPages(buf);
  t.eq(sizes.length, 2, 'the PDF has two pages');
  t.check('each the size of its canvas\'s drawing', sizes.every(function (s, k) { return Math.abs(s[0] - pdfInfo[k].w * 72 / 25.4) < 2 && Math.abs(s[1] - pdfInfo[k].h * 72 / 25.4) < 2; }), [sizes, pdfInfo]);
  await ev(function () { window.dispatchEvent(new Event('afterprint')); });
  await ev(function () { window.__printed = 0; window.print = function () { window.__printed++; }; });
  await page.click('#board [data-nb="export"]');
  await page.click('.menu [role="menuitem"]:has-text("PDF of every canvas")');
  await N.until(page, function () { return window.__printed === 1; });
  t.check('from the menu: the print dialog, a page per drawn canvas', await ev(function () { return document.querySelectorAll('.nb-print__page').length === 2; }));
  await ev(function () { window.dispatchEvent(new Event('afterprint')); });
  await view(function (v) { v.goTo(1); });
  var box3 = await view(function (v) { var b = window.MindRoot.ink.engine.contentBox(v.editor().elements(), null); return [b[2] - b[0], b[3] - b[1]]; });
  await page.click('#board [data-nb="export"]');
  var dl = page.waitForEvent('download');
  await page.click('.menu [role="menuitem"]:has-text("PNG of this canvas")');
  var download = await dl;
  var png = require('fs').readFileSync(await download.path());
  t.eq(png.slice(1, 4).toString('latin1'), 'PNG', 'a PNG');
  var pw = png.readUInt32BE(16);
  var ph = png.readUInt32BE(20);
  t.check('of the canvas shown (canvas 1 is the old canvas 3), its drawn area at twice its size', pw > box3[0] * 1.8 && ph > box3[1] * 1.8 && pw < (box3[0] + 120) * 2 && ph < (box3[1] + 120) * 2 && pw > ph, [pw, ph, box3]);
  t.check('named after the board and the canvas', /-1\.png$/.test(download.suggestedFilename()), download.suggestedFilename());

  /* ---------------------------------------------------------------- reload */

  t.step('a reload opens the board on the canvas left, under its camera');
  await view(function (v) { v.goTo(2); });
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 2; });
  await page.focus('#board .ink');
  var sR = await surfaceBox();
  var kBefore = (await camera()).k;
  await page.keyboard.down('Control');
  await page.mouse.move(sR.x + 500, sR.y + 300);
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await N.until(page, function (k) { return window.MindRoot.notebook.boardView().editor().camera().k < k - 0.05; }, kBefore);
  var left = await camera();
  await N.idle(page);
  /* The zoom is written into the view state a moment after it rests:
   * waited for itself (the canvas shown was written long before). */
  await N.until(page, function (l) {
    var c = window.MindRoot.session.current();
    var v = window.MindRoot.store.mapView(c.projectId, c.mapId).notebooks;
    var e = v && v['assets/garden-board.book'];
    var cam = e && e.cams['001.ink.svg'];
    return !!e && e.at === '001.ink.svg' && !!cam && Math.abs(cam.x - l.x) <= 1 && Math.abs(cam.y - l.y) <= 1 && Math.abs(cam.k - l.k) < 0.002;
  }, left);
  var kept = await ev(function () { var c = window.MindRoot.session.current(); return window.MindRoot.store.mapView(c.projectId, c.mapId).notebooks['assets/garden-board.book']; });
  t.same(Object.keys(kept.cams).sort(), ['001.ink.svg', '003.ink.svg'], 'the map\'s view state: the cameras of the canvases looked at');
  await ev(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await N.boardReady(page);
  var back = await N.board(page);
  t.same([back.mode, back.pages, back.files, back.page], ['infinite', 3, ['003.ink.svg', '001.ink.svg', '002.ink.svg'], 2], 'the board, its three canvases, on canvas 2');
  var after = await camera();
  t.check('under the camera it was left with', Math.abs(after.x - left.x) <= 1 && Math.abs(after.y - left.y) <= 1 && Math.abs(after.k - left.k) < 0.002, [after, left]);
  t.eq((await railBox()).text, 'Canvas 2 of 3', 'the rail on it');
  await view(function (v) { v.goTo(1); });
  t.same(await camera(), cam3, 'and canvas 1 (the old canvas 3) under its own');
  await t.shot('reloaded');

  t.step('a switch and the page left at once: the canvas shown is written on the way out');
  var out = await view(function (v) {
    v.goTo(3);
    /* The page going away: the app hands everything over (bus 'flush'). */
    window.dispatchEvent(new Event('pagehide'));
    var c = window.MindRoot.session.current();
    return window.MindRoot.store.mapView(c.projectId, c.mapId).notebooks['assets/garden-board.book'].at;
  });
  t.eq(out, '002.ink.svg', 'in the view state at once, not after the pause');
  await ev(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await N.boardReady(page);
  t.eq((await N.board(page)).page, 3, 'reloaded on canvas 3');

  /* ---------------------------------------------------------------- a phone */

  t.step('on a phone: the canvases in a bottom sheet, the rail swiped by a finger');
  var context = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  var phone = await context.newPage();
  var cdp = await context.newCDPSession(phone);
  await N.openApp(t, { page: phone });
  var pIds = await N.project(phone, [['Garden', '# Garden\n\n- Tomatoes\n']]);
  function pev(fn, arg) { return phone.evaluate(fn, arg); }
  await phone.tap('#topbar-lead .nb-switch [data-value="board"]');
  await N.boardReady(phone);
  var ps = await pev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await T.swipe(cdp, [ps.x + 80, ps.y + 260], [ps.x + 300, ps.y + 340], 12);
  await N.idle(phone);
  t.check('the board is made by a finger', (await N.mapText(phone, pIds.pid, pIds.mid)).indexOf('<!-- board: assets/garden-board.book/001.ink.svg -->') === 0);
  await phone.tap('#board [data-nb="pages"]');
  await phone.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  t.eq(await pev(function () { return document.querySelector('.nb-sheet').getAttribute('data-place'); }), 'bottom', 'the canvases: a bottom sheet');
  await phone.tap('.nb-thumbs__bar button');
  await N.until(phone, function () { return window.MindRoot.notebook.boardView().pages() === 2 && document.querySelectorAll('.nb-thumb').length === 2; });
  await t.shot('phone-thumbs', phone);
  await phone.keyboard.press('Escape');
  await N.until(phone, function () { return !document.querySelector('.nb-sheet'); });
  t.eq(await pev(function () { return window.MindRoot.notebook.boardView().page(); }), 2, 'the new canvas shown');
  var pr = await pev(function () {
    var r = document.querySelector('#board .nb__rail');
    var tr = r.querySelector('.nb__track').getBoundingClientRect();
    return { hidden: r.hidden, x: tr.left + tr.width / 2, top: tr.top, bottom: tr.bottom, w: r.getBoundingClientRect().width };
  });
  t.check('the rail, a finger wide', !pr.hidden && pr.w >= 24, pr);
  /* Off the handle (which is on canvas 2, the lower half): a swipe up from
   * the upper half shows the canvas before. */
  await T.swipe(cdp, [pr.x, pr.top + 120], [pr.x, pr.top + 40], 8);
  await N.until(phone, function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.check('a finger swiping up the rail: canvas 1', true);
  await T.swipe(cdp, [pr.x, pr.bottom - 120], [pr.x, pr.bottom - 40], 8);
  await N.until(phone, function () { return window.MindRoot.notebook.boardView().page() === 2; });
  t.check('and down: canvas 2', true);
  /* Beside the rail's line, on canvas 1's stretch, a finger drawing from
   * the very edge: the stroke is drawn, the canvas stays. */
  var pStrokes = await pev(function () { return window.MindRoot.notebook.boardView().editor().elements().length; });
  var edge = await pev(function () { var r = document.querySelector('#board .nb__rail').getBoundingClientRect(); return { right: r.right, top: r.top }; });
  await T.swipe(cdp, [edge.right - 3, edge.top + 60], [edge.right - 160, edge.top + 90], 10);
  await N.idle(phone);
  t.same(await pev(function () { var v = window.MindRoot.notebook.boardView(); return [v.page(), v.editor().elements().length]; }), [2, pStrokes + 1], 'a finger from the edge, beside the rail: drawn on canvas 2, still shown');
  t.check('nothing wider than the screen', await pev(function () { return document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth; }));
  await t.shot('phone-canvas', phone);
  await context.close();
};
