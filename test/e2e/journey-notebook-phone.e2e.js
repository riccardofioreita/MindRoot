/* journey-notebook-phone: the notebooks round on a phone (390 x 844, real
 * touch points from the DevTools protocol, Italian), on the real index.html.
 *
 * A map -> the board from the top capsule -> a finger draws the board's first
 * stroke -> the settings bottom sheet: lined paper, pages mode, A5 -> the
 * thumbnails bottom sheet: a page added -> the rail dragged by a finger ->
 * export from the notebook's own button: PNG of the page in view, PDF of
 * every page through the print dialog -> the export sheet from the board's
 * "More commands" (the board first, PNG of the page in view) -> the map again,
 * the thumb bar back ->
 * a node's drawing as a notebook in the viewer (under the map, over it, a
 * card), drawn on by a finger, Done -> the dark theme on the board and in
 * the viewer (dark paper, the ink drawn light, the files still light) -> a
 * reload opens the map on its board -> the project as a ZIP and back keeps
 * both .book folders and the references. Nothing is ever wider
 * than the screen, and every control the person taps is finger-sized.
 * Screenshots of each stage go to test/out. */
'use strict';

var fs = require('fs');
var N = require('../fixtures/notebook/helpers.js');

var MAP = '# Garden\n\n- Tomatoes\n- Basil\n- Rosemary\n';

module.exports = async function (t) {
  var context = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  var page = await context.newPage();
  var cdp = await context.newCDPSession(page);
  await t.open('', { page: page, lang: 'it' });
  var ids = await N.project(page, [['Garden', MAP]]);
  var BOARD = 'assets/garden-board.book';

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function until(fn, arg, ms) { return N.until(page, fn, arg, ms || 10000); }
  /* After a finger lifts, the next tap waits out Chromium's fling window:
   * a tap within about 300 ms of a moving touch's lift is taken to stop a
   * fling and never becomes a click (measured: 12 of 12 taps lost at 0,
   * 80 and 200 ms, none at 400 ms), and the finger's rest before lifting
   * does not always kill the velocity on a loaded machine. */
  async function touches(type, list) {
    await cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: list.map(function (p) { return { x: p[0], y: p[1], id: p[2] || 1 }; }) });
    if (type === 'touchEnd') await new Promise(function (r) { setTimeout(r, 400); });
  }
  async function finger(x0, y0, x1, y1, n) {
    await touches('touchStart', [[x0, y0, 1]]);
    for (var i = 1; i <= n; i++) await touches('touchMove', [[x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 1]]);
    /* The finger rests before it lifts, as a hand ending a stroke does. */
    for (var k = 0; k < 3; k++) {
      await new Promise(function (r) { setTimeout(r, 16); });
      await touches('touchMove', [[x1, y1, 1]]);
    }
    await touches('touchEnd', []);
  }
  async function rectOf(sel) {
    return ev(function (s) { var el = document.querySelector(s); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
  }
  /* Taps land once nothing on the page is still moving. */
  async function rest() {
    await until(function () { return !document.getAnimations().some(function (a) { return a.playState === 'running'; }); }, null, 4000).catch(function () {});
  }
  function wide() { return ev(function () { return document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth; }); }
  /* The strokes in the live page of a notebook: their fill against the dark
   * paper's ink, and whether that ink is light (relative luminance). */
  function inkOf(sel) {
    return ev(function (s) {
      var ink = document.querySelector(s + ' .ink');
      var want = String(window.MindRoot.paper.colors('dark', 'auto').ink).toLowerCase();
      var fills = Array.prototype.map.call(ink.querySelectorAll('.ink__scene path'), function (p) { return String(p.getAttribute('fill') || '').toLowerCase(); });
      var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(want);
      var lum = m ? [m[1], m[2], m[3]].map(function (h) { var c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }) : null;
      return { sheet: ink.getAttribute('data-sheet'), want: want, fills: fills, light: !!lum && (0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2]) > 0.5 };
    }, sel);
  }
  /* Every visible button inside these, at least 44 px high and 32 wide
   * (the editor's tool row packs icons 40 px apart, each 44 high). */
  function fingerSized(sel) {
    return ev(function (s) {
      var bad = [];
      Array.prototype.forEach.call(document.querySelectorAll(s), function (b) {
        var r = b.getBoundingClientRect();
        if (!r.width || getComputedStyle(b).visibility === 'hidden') return;
        if (r.height < 43.5 || r.width < 31.5) bad.push((b.getAttribute('aria-label') || b.textContent.trim()) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return bad;
    }, sel);
  }

  /* ------------------------------------------------------------ the switch */
  t.step('the board from the top capsule');
  t.same(await fingerSized('#topbar-lead .nb-switch [role="radio"]'), [], 'the switch is finger-sized');
  await rest();
  await page.tap('#topbar-lead .nb-switch [data-value="board"]');
  await N.boardReady(page);
  await until(function () { return getComputedStyle(document.getElementById('thumbbar')).display === 'none'; });
  t.eq(await ev(function () { return document.querySelector('#topbar-lead .nb-switch [data-value="board"]').getAttribute('aria-checked'); }), 'true', 'Board chosen');
  t.check('nothing wider than the screen', await wide());
  await t.shot('board', page);

  t.step('a finger draws the board\'s first stroke');
  var s = await rectOf('#board .ink__surface');
  await finger(s.x + 70, s.y + 300, s.x + 300, s.y + 380, 12);
  await N.idle(page);
  t.check('the board is made and named on the map', (await N.mapText(page, ids.pid, ids.mid)).indexOf('<!-- board: ' + BOARD + '/001.ink.svg -->') === 0);
  t.eq(await ev(function (svg) { return window.MindRoot.ink.parse(svg).elements.length; }, await N.fileText(page, ids.pid, BOARD + '/001.ink.svg')), 1, 'the stroke is in its first page');

  /* ------------------------------------------------------------ settings */
  t.step('the settings sheet from the bottom: lines, pages, A5');
  await rest();
  await page.tap('#board [data-nb="settings"]');
  try {
    await page.waitForSelector('.nb-sheet .nb-paper[data-value="ruled"]', { state: 'visible', timeout: 10000 });
  } catch (err) {
    await t.shot('settings-missed', page);
    throw err;
  }
  t.eq(await ev(function () { return document.querySelector('.nb-sheet').getAttribute('data-place'); }), 'bottom', 'a bottom sheet');
  await rest();
  await page.tap('.nb-sheet [role="radiogroup"][aria-label="Modalità"] [data-value="pages"]');
  await until(function () { var v = window.MindRoot.notebook.boardView(); return v.mode() === 'pages' && v.editor() && v.editor().page(); });
  await page.waitForSelector('.nb-sheet select', { state: 'visible' });
  await page.selectOption('.nb-sheet select', 'a5');
  await until(function () { return window.MindRoot.notebook.boardView().book().meta.size.id === 'a5'; });
  await page.locator('.nb-paper[data-value="ruled"]').scrollIntoViewIfNeeded();
  await rest();
  await page.tap('.nb-paper[data-value="ruled"]');
  await until(function () { return document.querySelector('#board .ink').getAttribute('data-paper') === 'ruled'; });
  t.check('the sheet stays on screen', await ev(function () { var r = document.querySelector('.nb-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; }));
  t.same(await fingerSized('.nb-sheet [role="radio"]'), [], 'its choices are finger-sized');
  await t.shot('settings', page);
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('.nb-sheet'); });
  await N.idle(page);
  var meta = JSON.parse(await N.fileText(page, ids.pid, BOARD + '/book.json'));
  t.same([meta.mode, meta.paper.type, meta.size.id], ['pages', 'ruled', 'a5'], 'book.json: pages, ruled, A5');

  /* ------------------------------------------------------------ pages and the rail */
  t.step('a page added from the thumbnails, the rail dragged by a finger');
  await rest();
  await page.tap('#board [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  t.eq(await ev(function () { return document.querySelector('.nb-sheet').getAttribute('data-place'); }), 'bottom', 'the thumbnails in a bottom sheet');
  await rest();
  await page.tap('.nb-thumbs__bar button');
  await until(function () { return window.MindRoot.notebook.boardView().pages() === 2 && document.querySelectorAll('.nb-thumb').length === 2; });
  await until(function () { var imgs = document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page img'); return imgs.length === 2 && Array.prototype.every.call(imgs, function (i) { return i.complete && i.naturalWidth > 0; }); });
  await t.shot('thumbnails', page);
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('.nb-sheet'); });
  await N.idle(page);
  await ev(function () { window.MindRoot.notebook.boardView().goTo(1); });
  await until(function () { return window.MindRoot.notebook.boardView().page() === 1; });
  var rail = await ev(function () {
    var r = document.querySelector('#board .nb__rail');
    var hd = r.querySelector('.nb__handle').getBoundingClientRect();
    var tr = r.querySelector('.nb__track').getBoundingClientRect();
    return { x: hd.left + hd.width / 2, y: hd.top + hd.height / 2, bottom: tr.bottom, w: r.getBoundingClientRect().width, right: window.innerWidth - r.getBoundingClientRect().right };
  });
  t.check('the rail at the right edge, a finger wide', rail.w >= 24 && rail.right < 12, rail);
  await finger(rail.x, rail.y, rail.x, rail.bottom + 30, 10);
  try { await until(function () { return window.MindRoot.notebook.boardView().page() === 2; }); } catch (err) { /* checked */ }
  t.eq(await ev(function () { return window.MindRoot.notebook.boardView().page(); }), 2, 'dragged to the last page');
  await t.shot('rail', page);
  t.check('nothing wider than the screen', await wide());

  /* ------------------------------------------------------------ export */
  t.step('export from the notebook: PNG of this page, PDF of every page');
  await rest();
  await page.tap('#board [data-nb="export"]');
  await page.waitForSelector('.menu [role^="menuitem"]', { state: 'visible' });
  var items = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.menu [role^="menuitem"]'), function (b) { return b.textContent.trim(); }); });
  t.check('PDF of every page, PNG of this page, light or dark paper', items.some(function (x) { return /PDF di tutte le pagine/.test(x); }) && items.some(function (x) { return /PNG di questa pagina/.test(x); }) && items.some(function (x) { return /Carta chiara/.test(x); }), items);
  /* The menu is a bottom sheet on a phone: shot once it has slid up. */
  await until(function () {
    var m = document.querySelector('.menu [role^="menuitem"]');
    var r = m && m.getBoundingClientRect();
    return !!r && r.bottom <= window.innerHeight && r.top < window.innerHeight - 160;
  });
  await page.waitForTimeout(450);
  await t.shot('export', page);
  var dl = page.waitForEvent('download', { timeout: 10000 });
  await rest();
  await page.tap('.menu [role^="menuitem"]:has-text("PNG di questa pagina")');
  var png = await dl;
  t.check('a PNG named after the board', /\.png$/i.test(png.suggestedFilename()), png.suggestedFilename());
  await ev(function () { window.__printed = 0; window.print = function () { window.__printed++; }; });
  await rest();
  await page.tap('#board [data-nb="export"]');
  await page.waitForSelector('.menu [role^="menuitem"]', { state: 'visible' });
  await rest();
  await page.tap('.menu [role^="menuitem"]:has-text("PDF di tutte le pagine")');
  await until(function () { return window.__printed === 1; });
  t.check('the print dialog with a page per page', await ev(function () { return document.querySelectorAll('.nb-print__page').length === 2; }));
  await ev(function () { window.dispatchEvent(new Event('afterprint')); });

  t.step('the export sheet from "More commands": the board first, the map one choice away');
  await rest();
  await page.tap('#board [data-nb="more"]');
  await page.waitForSelector('.menu [role^="menuitem"]', { state: 'visible' });
  var more = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.menu [role^="menuitem"]'), function (b) { return b.textContent.trim(); }); });
  t.check('the board\'s export is in the menu', more.some(function (x) { return /Esporta la lavagna o la mappa/.test(x); }), more);
  await rest();
  await page.tap('.menu [role^="menuitem"]:has-text("Esporta la lavagna o la mappa")');
  await page.waitForSelector('dialog.xp[open] .xp-part--board', { state: 'visible' });
  /* A bottom sheet slides up: measured once it has come to rest. */
  try {
    await until(function () { var r = document.querySelector('dialog.xp[open]').getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1; }, null, 3000);
  } catch (err) { /* checked */ }
  var xp = await ev(function () {
    var d = document.querySelector('dialog.xp[open]');
    var r = d.getBoundingClientRect();
    return {
      what: Array.prototype.map.call(d.querySelectorAll('.xp-row--what [role="radio"]'), function (b) { return b.textContent.trim() + ':' + b.getAttribute('aria-checked'); }).join(','),
      mapHidden: d.querySelector('.xp-part--map').hidden,
      inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1
    };
  });
  t.same(xp, { what: 'Lavagna:true,Mappa:false', mapHidden: true, inside: true }, 'Board chosen, the map hidden, the sheet on screen');
  t.same(await fingerSized('dialog.xp[open] .xp-part--board [role="radio"], dialog.xp[open] .xp-row--what [role="radio"]'), [], 'its choices are finger-sized');
  await page.waitForTimeout(450);
  await t.shot('export-sheet', page);
  await rest();
  await page.tap('dialog.xp[open] .xp-part--board .xp-row--format [data-value="png"]');
  var dl2 = page.waitForEvent('download', { timeout: 10000 });
  await rest();
  await page.tap('dialog.xp[open] .sheet__foot .btn--primary');
  var png2 = fs.readFileSync(await (await dl2).path());
  t.eq(png2.slice(1, 4).toString('latin1'), 'PNG', 'Esporta: the page in view as a PNG');
  t.check('at twice the A5 page', Math.abs(png2.readUInt32BE(16) - Math.round(148 * 96 / 25.4 * 2)) <= 2, png2.readUInt32BE(16));
  await until(function () { return !document.querySelector('dialog.xp[open]'); });

  /* ------------------------------------------------------------ back to the map */
  t.step('the map again');
  await rest();
  await page.tap('#topbar-lead .nb-switch [data-value="map"]');
  await until(function () { return !window.MindRoot.notebook.boardShown(); });
  await until(function () { return getComputedStyle(document.getElementById('thumbbar')).display !== 'none'; });
  t.eq(await ev(function () { return getComputedStyle(document.querySelector('#stage > .mv')).visibility; }), 'visible', 'the map and its thumb bar are back');

  /* ------------------------------------------------------------ a node notebook */
  t.step('a node\'s drawing: a notebook in the viewer, in each place');
  await ev(function () { window.MindRoot.session.select('1', { reveal: true }); });
  await ev(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await until(function () { var v = window.MindRoot.media.viewerState(); var el = document.querySelector('#viewer .ink'); return v && v.editor && el && el.getBoundingClientRect().width > 100; });
  await ev(function () { window.MindRoot.media.viewerState().editor.setTool('pen'); });
  var vs = await rectOf('#viewer .ink__surface');
  await finger(vs.x + 60, vs.y + vs.h * 0.45, vs.x + 260, vs.y + vs.h * 0.55, 12);
  await until(function () { return /basil\.book\/001\.ink\.svg/.test(window.MindRoot.session.current().text); });
  t.check('its first page in the node', /- !\[\]\(assets\/basil\.book\/001\.ink\.svg\) Basil/.test(await N.mapText(page, ids.pid, ids.mid)));
  for (var m of ['split', 'full', 'card']) {
    await ev(function (x) { window.MindRoot.media.setViewerMode(x); }, m);
    await until(function (x) { return document.documentElement.getAttribute('data-viewer') === x; }, m);
    await page.waitForTimeout(300);
    var placed = await ev(function () {
      var body = document.querySelector('#viewer .viewer__body').getBoundingClientRect();
      var nb = document.querySelector('#viewer .nb').getBoundingClientRect();
      var tools = document.querySelector('#viewer .ink__tools');
      var tr = tools ? tools.getBoundingClientRect() : null;
      return {
        fills: Math.abs(body.width - nb.width) < 2 && Math.abs(body.height - nb.height) < 2,
        inside: body.left >= -1 && body.right <= window.innerWidth + 1,
        tools: !!tr && tr.bottom <= window.innerHeight + 1 && tr.right <= window.innerWidth + 1
      };
    });
    t.same(placed, { fills: true, inside: true, tools: true }, m + ': the notebook fills the viewer, its tools on screen');
    t.check(m + ': nothing wider than the screen', await wide());
    await t.shot('viewer-' + m, page);
  }
  await ev(function () { window.MindRoot.media.setViewerMode('split'); });
  await until(function () { return document.documentElement.getAttribute('data-viewer') === 'split'; });
  var done = await rectOf('#viewer .ink__done');
  if (done) await page.tap('#viewer .ink__done');
  else await page.tap('#viewer .viewer__close');
  await until(function () { return !window.MindRoot.media.viewerState(); });
  t.check('Done: the viewer closes, the drawing kept', /basil\.book/.test(await N.mapText(page, ids.pid, ids.mid)));

  /* ------------------------------------------------------------ dark */
  t.step('the dark theme on the board and in the viewer');
  await ev(function () { window.MindRoot.prefs.set('theme', 'dark'); });
  await until(function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  await rest();
  await page.tap('#topbar-lead .nb-switch [data-value="board"]');
  await N.boardReady(page);
  await until(function () { return document.querySelector('#board .ink').getAttribute('data-sheet') === 'dark'; });
  var bs = await rectOf('#board .ink__surface');
  await finger(bs.x + 80, bs.y + bs.h * 0.4, bs.x + 280, bs.y + bs.h * 0.45, 12);
  await N.idle(page);
  var boardInk = await inkOf('#board');
  t.check('the board: dark paper, the ink drawn light', boardInk.sheet === 'dark' && boardInk.fills.length > 0 && boardInk.fills.every(function (f) { return f === boardInk.want; }) && boardInk.light, boardInk);
  await t.shot('board-dark', page);
  await rest();
  await page.tap('#topbar-lead .nb-switch [data-value="map"]');
  await until(function () { return !window.MindRoot.notebook.boardShown(); });
  await ev(function () { window.MindRoot.session.select('1', { reveal: true }); });
  await ev(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await until(function () { var el = document.querySelector('#viewer .ink'); return el && el.getAttribute('data-sheet') === 'dark' && el.querySelector('.ink__scene path'); });
  var viewerInk = await inkOf('#viewer');
  t.check('the viewer: dark paper, the ink drawn light', viewerInk.sheet === 'dark' && viewerInk.fills.length > 0 && viewerInk.fills.every(function (f) { return f === viewerInk.want; }) && viewerInk.light, viewerInk);
  var basil = await N.fileText(page, ids.pid, 'assets/basil.book/001.ink.svg');
  var lightSheet = await ev(function () { return window.MindRoot.paper.colors('light', 'auto').sheet; });
  t.check('its file still light paper, the ink marked', /mr-ink/.test(basil) && basil.toLowerCase().indexOf(String(lightSheet).toLowerCase()) >= 0);
  await t.shot('viewer-dark', page);
  await ev(function () { window.MindRoot.media.closeViewer(); });
  await until(function () { return !window.MindRoot.media.viewerState(); });

  /* ------------------------------------------------------------ reload */
  t.step('a reload opens the map on its board');
  await rest();
  await page.tap('#topbar-lead .nb-switch [data-value="board"]');
  await N.boardReady(page);
  await ev(function () { return window.MindRoot.notebook.flush(); });
  await until(function () { return !window.MindRoot.storage.pending(); });
  await ev(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await N.boardReady(page);
  var again = await ev(function () { var v = window.MindRoot.notebook.boardView(); return { pages: v.pages(), mode: v.mode(), paper: v.book().meta.paper.type }; });
  t.same(again, { pages: 2, mode: 'pages', paper: 'ruled' }, 'the board, its pages and its paper');
  await until(function () { return getComputedStyle(document.getElementById('thumbbar')).display === 'none'; });
  t.check('nothing wider than the screen', await wide());
  await t.shot('board-reload', page);

  /* ------------------------------------------------------------ ZIP round trip */
  t.step('the project as a ZIP and back keeps both folders and the references');
  var trip = await ev(function (pid) {
    var ns = window.MindRoot;
    var before = ns.store.project(pid);
    return ns.archive.projectZip(pid).then(function (out) {
      return ns.zip.read(out.blob).then(function (entries) {
        var names = entries.map(function (e) { return e.name.replace(/^[^/]+\//, ''); }).filter(function (n) { return /\.book\//.test(n); }).sort();
        return ns.archive.readFile(new File([out.blob], out.name, { type: 'application/zip' })).then(function (res) {
          var added = ns.store.importProjects(res.projects);
          var p = ns.store.project(added[0].id || added[0]);
          var map = p.maps[0];
          var refs = ns.doc.refsInText(map.text);
          return {
            names: names,
            same: Object.keys(before.files).filter(function (k) { return /\.book\//.test(k); }).every(function (k) { return p.files[k] && p.files[k].asset === before.files[k].asset; }),
            board: ns.doc.boardPath(ns.doc.parse(map.text)),
            refs: refs.every(function (r) { return !!p.files[r]; }) && refs.indexOf('assets/basil.book/001.ink.svg') >= 0
          };
        });
      });
    });
  }, ids.pid);
  t.same(trip.names, ['assets/basil.book/001.ink.svg', 'assets/basil.book/book.json', BOARD + '/001.ink.svg', BOARD + '/002.ink.svg', BOARD + '/book.json'], 'the ZIP holds both folders, every file');
  t.same([trip.same, trip.board, trip.refs], [true, BOARD + '/001.ink.svg', true], 'imported back byte for byte, the board marker and the node reference resolve');
};
