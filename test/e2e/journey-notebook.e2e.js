/* journey-notebook: the notebooks round as a person on a desktop does it
 * (1440 x 900, mouse and keyboard), on the real index.html.
 *
 * A map -> the Map | Board switch -> a stroke on the infinite board (the
 * marker and the '<map>-board.book' folder appear, one step) -> the
 * settings sheet: another paper, pages mode, A5 landscape -> pages added
 * from the thumbnails -> the rail (ticks, the bubble, a click that moves) ->
 * the export sheet with the board up (the board first: PDF of every page
 * through the print dialog, PNG of the page in view) -> back to the map ->
 * a node's drawing as a notebook in the viewer, in each place (beside, over
 * the map, a card), with its own settings -> the board coming up closes
 * it (never two notebooks on screen) -> the dark theme (the board on
 * dark paper, light ink; the files keep light paper) -> a reload (the map
 * opens on the face it was left on, every page there) -> the project as a
 * ZIP and back: the .book folders and the Markdown references survive the
 * round trip byte for byte. Screenshots of each stage go to test/out. */
'use strict';

var fs = require('fs');
var N = require('../fixtures/notebook/helpers.js');

var MAP = '# Garden\n\n- Roses\n  - Climbing\n- Herbs\n  - Basil\n- Trees\n';

module.exports = async function (t) {
  var context = await t.newContext({ viewport: { width: 1440, height: 900 } });
  var page = await context.newPage();
  await t.open('', { page: page });
  var ids = await N.project(page, [['Garden', MAP], ['Notes', '# Notes\n\n- one\n']]);
  var BOARD = 'assets/garden-board.book';

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function until(fn, arg, ms) { return N.until(page, fn, arg, ms || 10000); }
  function history() {
    return ev(function () { var h = window.MindRoot.store.historyState(); return { count: h.undoCount, key: h.undoLabelKey, label: h.undoLabel }; });
  }
  function view(fn) { return ev('(' + fn.toString() + ')(window.MindRoot.notebook.boardView())'); }
  async function surface(sel) {
    return ev(function (s) { var r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
  }
  async function scribble(sel, fx, fy, steps) {
    var r = await surface(sel);
    var x0 = r.x + r.w * fx;
    var y0 = r.y + r.h * fy;
    await N.stroke(page, x0, y0, x0 + 160, y0 + 40, { steps: steps || 14 });
  }
  function wide() { return ev(function () { return document.documentElement.scrollWidth <= window.innerWidth; }); }
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

  /* ------------------------------------------------------------ the switch */
  t.step('the Map | Board switch, beside search');
  var sw = await ev(function () {
    var g = document.querySelector('#topbar-actions .nb-switch');
    var search = document.querySelector('#topbar-actions [data-command="search.nodes"], #topbar-actions [data-command="palette.open"]');
    return {
      there: !!g && g.getBoundingClientRect().width > 0,
      beforeSearch: !!(g && search && (g.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING)),
      labels: g ? Array.prototype.map.call(g.querySelectorAll('[role="radio"]'), function (b) { return b.textContent.trim() + ':' + b.getAttribute('aria-checked'); }).join(',') : ''
    };
  });
  t.same(sw, { there: true, beforeSearch: true, labels: 'Map:true,Board:false' }, 'in the top bar, to the left of search, Map chosen');
  var h0 = await history();
  await page.click('#topbar-actions .nb-switch [data-value="board"]');
  await N.boardReady(page);
  var shown = await ev(function () {
    var st = document.getElementById('stage').getBoundingClientRect();
    var b = document.querySelector('#board .nb').getBoundingClientRect();
    return {
      map: getComputedStyle(document.querySelector('#stage > .mv')).visibility,
      fills: Math.abs(b.width - st.width) < 2 && b.bottom >= st.bottom - 2,
      checked: document.querySelector('#topbar-actions .nb-switch [data-value="board"]').getAttribute('aria-checked'),
      sidebar: getComputedStyle(document.getElementById('sidebar')).display !== 'none',
      undo: !!document.querySelector('#topbar-actions [data-command="history.undo"]'),
      mode: window.MindRoot.notebook.boardView().mode()
    };
  });
  t.same(shown, { map: 'hidden', fills: true, checked: 'true', sidebar: true, undo: true, mode: 'infinite' }, 'the board in place of the map, the sidebar, top bar and Undo still there; infinite by default');
  t.eq((await history()).count, h0.count, 'switching writes no step');
  await t.shot('board-empty', page);

  /* ------------------------------------------------------------ drawing */
  t.step('a stroke on the infinite board makes it');
  await scribble('#board .ink__surface', 0.35, 0.45);
  await N.idle(page);
  var text = await N.mapText(page, ids.pid, ids.mid);
  t.check('the map names its first page on its first line', text.indexOf('<!-- board: ' + BOARD + '/001.ink.svg -->') === 0, text.slice(0, 90));
  var files = await N.folder(page, ids.pid, BOARD);
  t.same(Object.keys(files).sort(), ['001.ink.svg', 'book.json'], 'a folder: book.json and the first page');
  var h1 = await history();
  t.same([h1.count - h0.count, h1.key], [1, 'notebook.label.newBoard'], 'one step: start the board');
  await t.shot('board-drawn', page);

  /* ------------------------------------------------------------ settings */
  t.step('the settings sheet: paper, pages mode, A5 landscape');
  await page.click('#board [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet .nb-paper[data-value="grid-5"]', { state: 'visible' });
  var groups = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.nb-set__group'), function (g) { return g.textContent.trim(); }); });
  t.check('the papers grouped by field', groups.length >= 7, groups);
  await t.shot('settings', page);
  await page.click('.nb-paper[data-value="grid-5"]');
  await until(function () { return document.querySelector('#board .ink').getAttribute('data-paper') === 'grid-5'; });
  await page.click('.nb-sheet [role="radiogroup"][aria-label="Mode"] [data-value="pages"]');
  await until(function () { var v = window.MindRoot.notebook.boardView(); return v.mode() === 'pages' && v.editor() && v.editor().page(); });
  await page.waitForSelector('.nb-sheet select', { state: 'visible' });
  await page.selectOption('.nb-sheet select', 'a5');
  await until(function () { return window.MindRoot.notebook.boardView().book().meta.size.id === 'a5'; });
  await page.click('.nb-sheet [role="radiogroup"][aria-label="Orientation"] [data-value="landscape"]');
  await until(function () { var v = window.MindRoot.notebook.boardView(); return v.book().meta.size.orientation === 'landscape' && v.editor() && v.editor().page() && v.editor().page().w > v.editor().page().h; });
  await t.shot('settings-pages', page);
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('.nb-sheet'); });
  await N.idle(page);
  var meta = JSON.parse(await N.fileText(page, ids.pid, BOARD + '/book.json'));
  t.same([meta.mode, meta.paper.type, meta.size.id, meta.size.orientation, meta.background], ['pages', 'grid-5', 'a5', 'landscape', 'auto'], 'book.json: pages, 5 mm squares, A5 landscape, automatic background');
  var pg = await ev(function (svg) { return window.MindRoot.ink.parse(svg).page; }, await N.fileText(page, ids.pid, BOARD + '/001.ink.svg'));
  t.check('the page file is an A5 landscape page', pg && Math.abs(pg.w - 210 * 96 / 25.4) < 0.2 && Math.abs(pg.h - 148 * 96 / 25.4) < 0.2, pg);

  /* ------------------------------------------------------------ pages */
  t.step('pages added from the thumbnails');
  await page.click('#board [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  for (var i = 0; i < 2; i++) {
    var n0 = await view(function (v) { return v.pages(); });
    await page.click('.nb-thumbs__bar button');
    await until(function (n) { var v = window.MindRoot.notebook.boardView(); return v.pages() === n + 1 && document.querySelectorAll('.nb-thumbs__grid .nb-thumb').length === n + 1; }, n0);
  }
  await until(function () { var imgs = document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page img'); return imgs.length === 3 && Array.prototype.every.call(imgs, function (i) { return i.complete && i.naturalWidth > 0; }); });
  await t.shot('thumbnails', page);
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('.nb-sheet'); });
  await N.idle(page);
  t.same(Object.keys(await N.folder(page, ids.pid, BOARD)).sort(), ['001.ink.svg', '002.ink.svg', '003.ink.svg', 'book.json'], 'three page files');

  t.step('the rail at the side');
  var rail = await ev(function () {
    var r = document.querySelector('#board .nb__rail');
    var tr = r.querySelector('.nb__track').getBoundingClientRect();
    var st = document.getElementById('stage').getBoundingClientRect();
    return { ticks: r.querySelectorAll('.nb__tick').length, text: r.getAttribute('aria-valuetext'), right: st.right - tr.right < 40, top: tr.top, bottom: tr.bottom, x: tr.left + tr.width / 2 };
  });
  t.check('a slim bar at the right edge, a tick per page, said as a page', rail.ticks === 3 && rail.right && /^Page [1-3] of 3$/.test(rail.text || ''), rail);
  await page.mouse.click(rail.x, rail.top + 4);
  await until(function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.eq(await view(function (v) { return v.page(); }), 1, 'a click near its top goes to the first page');
  await page.mouse.click(rail.x, rail.bottom - 4);
  await until(function () { return window.MindRoot.notebook.boardView().page() === 3; });
  t.eq(await view(function (v) { return v.page(); }), 3, 'a click near its foot goes to the last page');
  var bubble = await ev(function () { var b = document.querySelector('#board .nb__bubble'); return b ? b.textContent : null; });
  t.eq(bubble, '3 / 3', 'the bubble says where');
  await t.shot('rail', page);
  /* The middle of the screen on page 3, then a stroke there. */
  await view(function (v) { v.goTo(3); });
  await until(function () { return window.MindRoot.notebook.boardView().page() === 3; });
  var mid = await surface('#board .ink__surface');
  await N.stroke(page, mid.x + mid.w / 2 - 90, mid.y + mid.h / 2 - 20, mid.x + mid.w / 2 + 90, mid.y + mid.h / 2 + 30);
  await N.idle(page);
  t.check('a stroke lands on the page in view', (await ev(function (svg) { return window.MindRoot.ink.parse(svg).elements.length; }, await N.fileText(page, ids.pid, BOARD + '/003.ink.svg'))) === 1);
  t.check('nothing wider than the window', await wide());

  /* ------------------------------------------------------------ export */
  t.step('the export sheet with the board up offers the board first');
  await ev(function () { window.__printed = 0; window.print = function () { window.__printed++; }; });
  await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('dialog.xp[open] .xp-row--what', { state: 'visible' });
  var xp = await ev(function () {
    var d = document.querySelector('dialog.xp[open]');
    return {
      what: Array.prototype.map.call(d.querySelectorAll('.xp-row--what [role="radio"]'), function (b) { return b.textContent + ':' + b.getAttribute('aria-checked'); }).join(','),
      board: !d.querySelector('.xp-part--board').hidden, map: !d.querySelector('.xp-part--map').hidden,
      hint: d.querySelector('.xp-hint').textContent
    };
  });
  t.same([xp.what, xp.board, xp.map], ['Board:true,Map:false', true, false], 'Board chosen, its options shown');
  t.check('the hint speaks of every page', /Every page of the board/.test(xp.hint), xp.hint);
  await t.shot('export-sheet', page);
  await page.click('dialog.xp[open] .sheet__foot .btn--primary');
  await until(function () { return window.__printed === 1; });
  t.check('PDF: the print dialog with a page per page', await ev(function () { return document.querySelectorAll('.nb-print__page').length === 3; }));
  var pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  var sizes = N.pdfPages(pdf);
  t.check('three A5 landscape pages (595 x 420 pt)', sizes.length === 3 && sizes.every(function (s) { return Math.abs(s[0] - 595.3) < 2 && Math.abs(s[1] - 419.5) < 2; }), sizes);
  await ev(function () { window.dispatchEvent(new Event('afterprint')); });
  await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('dialog.xp[open] .xp-part--board', { state: 'visible' });
  await page.click('dialog.xp[open] .xp-part--board .xp-row--format [data-value="png"]');
  var dl = page.waitForEvent('download', { timeout: 10000 });
  await page.click('dialog.xp[open] .sheet__foot .btn--primary');
  var png = await dl;
  var bytes = fs.readFileSync(await png.path());
  t.eq(bytes.slice(1, 4).toString('latin1'), 'PNG', 'PNG: the page in view, as a picture');
  t.check('at twice the page size', Math.abs(bytes.readUInt32BE(16) - Math.round(210 * 96 / 25.4 * 2)) <= 2, bytes.readUInt32BE(16));
  await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('dialog.xp[open] .xp-row--what', { state: 'visible' });
  await page.click('dialog.xp[open] .xp-row--what [data-value="map"]');
  t.check('the map is one choice away', await ev(function () { var d = document.querySelector('dialog.xp[open]'); return d.querySelector('.xp-part--board').hidden && !d.querySelector('.xp-part--map').hidden; }));
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('dialog.xp[open]'); });

  /* ------------------------------------------------------------ back to the map */
  t.step('back to the map');
  await page.click('#topbar-actions .nb-switch [data-value="map"]');
  await until(function () { return !window.MindRoot.notebook.boardShown(); });
  t.eq(await ev(function () { return getComputedStyle(document.querySelector('#stage > .mv')).visibility; }), 'visible', 'the map is back');
  t.check('the face is remembered as the map', await ev(function (a) { return !window.MindRoot.store.mapView(a.pid, a.mid).view; }, ids));
  t.eq(await ev(function () { return window.MindRoot.media.viewerState(); }), null, 'the board never opened in the viewer');

  /* ------------------------------------------------------------ a node notebook */
  t.step('a node\'s drawing is a notebook in the viewer, in each place');
  await ev(function () { window.MindRoot.session.select('1', { reveal: true }); });
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await until(function () { var v = window.MindRoot.media.viewerState(); var el = document.querySelector('#viewer .ink'); return v && v.editor && el && el.getBoundingClientRect().width > 100; });
  await ev(function () { window.MindRoot.media.viewerState().editor.setTool('pen'); });
  await scribble('#viewer .ink__surface', 0.25, 0.5);
  await until(function () { return /herbs\.book\/001\.ink\.svg/.test(window.MindRoot.session.current().text); });
  t.check('its first page in the node', /- !\[\]\(assets\/herbs\.book\/001\.ink\.svg\) Herbs/.test(await N.mapText(page, ids.pid, ids.mid)));
  for (var m of ['split', 'full', 'card']) {
    await ev(function (x) { window.MindRoot.media.setViewerMode(x); }, m);
    await until(function (x) { return document.documentElement.getAttribute('data-viewer') === x; }, m);
    await page.waitForTimeout(300);
    var placed = await ev(function () {
      var body = document.querySelector('#viewer .viewer__body').getBoundingClientRect();
      var nb = document.querySelector('#viewer .nb').getBoundingClientRect();
      return { fills: Math.abs(body.width - nb.width) < 2 && Math.abs(body.height - nb.height) < 2, settings: !!document.querySelector('#viewer [data-nb="settings"]'), w: Math.round(body.width) };
    });
    t.check(m + ': the notebook fills the viewer, its settings at hand', placed.fills && placed.settings && placed.w > 250, placed);
    await t.shot('viewer-' + m, page);
  }
  await ev(function () { window.MindRoot.media.setViewerMode('split'); });
  await page.click('#viewer [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet .nb-paper[data-value="staff"]', { state: 'visible' });
  await page.click('.nb-paper[data-value="staff"]');
  await until(function () { return document.querySelector('#viewer .ink').getAttribute('data-paper') === 'staff'; });
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('.nb-sheet'); });
  await ev(function () { var nb = window.MindRoot.media.viewerState().notebook; return nb.flush().then(function () { return nb.idle(); }); });
  t.eq(JSON.parse(await N.fileText(page, ids.pid, 'assets/herbs.book/book.json')).paper.type, 'staff', 'its own paper, in its own book.json');
  t.eq(JSON.parse(await N.fileText(page, ids.pid, BOARD + '/book.json')).paper.type, 'grid-5', 'the board keeps its own');
  await t.shot('viewer-staff', page);

  t.step('the board coming up closes the node\'s notebook: never two on screen');
  await page.keyboard.press('Control+Shift+L');
  await N.boardReady(page);
  await until(function () { return !window.MindRoot.media.viewerState(); });
  var alone = await ev(function () {
    var vw = document.getElementById('viewer');
    return { viewer: !!vw && !vw.hidden, notebooks: document.querySelectorAll('.nb').length, board: !!document.querySelector('#board .nb') };
  });
  t.same(alone, { viewer: false, notebooks: 1, board: true }, 'the viewer closed, the board alone on the stage');
  t.eq(JSON.parse(await N.fileText(page, ids.pid, 'assets/herbs.book/book.json')).paper.type, 'staff', 'what the node\'s notebook held was written first');
  await page.keyboard.press('Control+Shift+L');
  await until(function () { return !window.MindRoot.notebook.boardShown(); });

  /* ------------------------------------------------------------ dark */
  t.step('the dark theme: dark paper, light ink, light files');
  await ev(function () { window.MindRoot.prefs.set('theme', 'dark'); });
  await until(function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  await page.keyboard.press('Control+Shift+L');
  await N.boardReady(page);
  await until(function () { return document.querySelector('#board .ink').getAttribute('data-sheet') === 'dark'; });
  await scribble('#board .ink__surface', 0.3, 0.3);
  await N.idle(page);
  var dark = await inkOf('#board');
  t.check('the board on dark paper, the ink drawn light', dark.sheet === 'dark' && dark.fills.length > 0 && dark.fills.every(function (f) { return f === dark.want; }) && dark.light, dark);
  await t.shot('board-dark', page);
  var file1 = await N.fileText(page, ids.pid, BOARD + '/003.ink.svg');
  var lightSheet = await ev(function () { return window.MindRoot.paper.colors('light', 'auto').sheet; });
  t.check('the page file still says light paper and marks the ink', /mr-ink/.test(file1) && /mr-sheet/.test(file1) && file1.toLowerCase().indexOf(String(lightSheet).toLowerCase()) >= 0, lightSheet);
  await page.keyboard.press('Control+Shift+L');
  await until(function () { return !window.MindRoot.notebook.boardShown(); });
  await ev(function () { window.MindRoot.session.select('1', { reveal: true }); });
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await until(function () { var v = window.MindRoot.media.viewerState(); var el = document.querySelector('#viewer .ink'); return v && v.editor && el.getAttribute('data-sheet') === 'dark' && el.querySelector('.ink__scene path'); });
  var vdark = await inkOf('#viewer');
  t.check('the node\'s notebook too: dark paper, light ink', vdark.sheet === 'dark' && vdark.fills.length > 0 && vdark.fills.every(function (f) { return f === vdark.want; }) && vdark.light, vdark);
  await t.shot('viewer-dark', page);
  await page.click('#viewer .viewer__close');
  await until(function () { return !window.MindRoot.media.viewerState(); });

  /* ------------------------------------------------------------ reload */
  t.step('a reload: the map opens on the face it was left on');
  await page.keyboard.press('Control+Shift+L');
  await N.boardReady(page);
  await ev(function () { return window.MindRoot.notebook.flush(); });
  await page.keyboard.press('Control+s');
  await until(function () { return !window.MindRoot.storage.pending(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await N.boardReady(page);
  var again = await view(function (v) { return { pages: v.pages(), mode: v.mode(), paper: v.book().meta.paper.type }; });
  t.same(again, { pages: 3, mode: 'pages', paper: 'grid-5' }, 'the board again, every page and setting there');
  t.eq(await ev(function () { return document.documentElement.getAttribute('data-theme'); }), 'dark', 'in the dark theme');
  await t.shot('board-reload', page);

  /* ------------------------------------------------------------ ZIP round trip */
  t.step('the project as a ZIP and back keeps the .book folders and the references');
  var trip = await ev(function (pid) {
    var ns = window.MindRoot;
    var before = ns.store.project(pid);
    return ns.archive.projectZip(pid).then(function (out) {
      return ns.zip.read(out.blob).then(function (entries) {
        var names = entries.map(function (e) { return e.name; });
        var file = new File([out.blob], out.name, { type: 'application/zip' });
        return ns.archive.readFile(file).then(function (res) {
          var added = ns.store.importProjects(res.projects);
          var p = ns.store.project(added[0].id || added[0]);
          var same = Object.keys(before.files).filter(function (k) { return /\.book\//.test(k); }).every(function (k) {
            return p.files[k] && p.files[k].asset === before.files[k].asset;
          });
          var garden = p.maps.filter(function (m) { return m.name === 'Garden'; })[0];
          var refs = ns.doc.refsInText(garden.text);
          return {
            names: names.filter(function (n) { return /\.book\//.test(n); }).map(function (n) { return n.replace(/^[^/]+\//, ''); }).sort(),
            same: same,
            board: ns.doc.boardPath(ns.doc.parse(garden.text)),
            refsResolve: refs.every(function (r) { return !!p.files[r]; }),
            refs: refs
          };
        });
      });
    });
  }, ids.pid);
  t.same(trip.names, ['assets/garden-board.book/001.ink.svg', 'assets/garden-board.book/002.ink.svg', 'assets/garden-board.book/003.ink.svg', 'assets/garden-board.book/book.json', 'assets/herbs.book/001.ink.svg', 'assets/herbs.book/book.json'], 'the ZIP holds both folders, every file');
  t.eq(trip.same, true, 'imported back, byte for byte');
  t.eq(trip.board, BOARD + '/001.ink.svg', 'the board marker still names the first page');
  t.check('every reference of the map names a file of the project', trip.refsResolve && trip.refs.indexOf('assets/herbs.book/001.ink.svg') >= 0, trip.refs);
  t.check('nothing wider than the window', await wide());
};
