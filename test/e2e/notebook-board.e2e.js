/* MindRoot - the map's board as a notebook, on the real app with a mouse
 * and the keyboard (1280 x 800): the Map | Board switch and
 * Mod+Shift+L, the first stroke making the board (and its undo), the paper,
 * pages mode in A4 landscape, three pages added, the rail, a page turned by
 * drawing on it, a reorder by drag (the Markdown following the first
 * page), delete and restore, the PDF (one A4 landscape page per page, by the
 * print engine) and the PNG, the dark theme (light ink on dark paper on
 * screen, literal colours in the file), a reload, the hidden map's keys
 * kept from it, Mod+Z as the app's undo, and back to the map. */
'use strict';

var N = require('../fixtures/notebook/helpers.js');

module.exports = async function (t) {
  var page = t.page;
  await N.openApp(t);
  var ids = await N.project(page, [['Garden', '# Garden\n\n- Rose\n- Basil\n'], ['Other', '# Other\n\n- One\n']]);
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

  /* ---------------------------------------------------------------- the switch */

  t.step('the switch Map | Board');
  var sw = await ev(function () {
    var g = document.querySelector('#topbar-actions .nb-switch');
    if (!g) return null;
    var next = g.nextElementSibling;
    return {
      opts: Array.prototype.map.call(g.querySelectorAll('[role="radio"]'), function (b) { return b.getAttribute('aria-label') + ':' + b.getAttribute('aria-checked'); }).join(','),
      before: next ? next.getAttribute('data-command') : null,
      label: g.getAttribute('aria-label')
    };
  });
  t.check('the switch is in the top capsule', !!sw, sw);
  t.eq(sw && sw.opts, 'Map:true,Board:false', 'Map shown, Board offered');
  t.check('to the left of the search button', sw && /^(search\.nodes|palette\.open)$/.test(sw.before), sw);
  t.eq(sw && sw.label, 'View', 'the group is named');
  await page.click('#topbar-actions .nb-switch [data-value="board"]');
  await N.boardReady(page);
  var shown = await ev(function () {
    var mv = document.querySelector('#stage > .mv');
    return {
      attr: document.documentElement.hasAttribute('data-board'),
      map: getComputedStyle(mv).visibility,
      checked: document.querySelector('#topbar-actions .nb-switch [data-value="board"]').getAttribute('aria-checked'),
      remembered: window.MindRoot.store.mapView(window.MindRoot.session.current().projectId, window.MindRoot.session.current().mapId).view,
      files: Object.keys(window.MindRoot.store.project(window.MindRoot.session.current().projectId).files).length
    };
  });
  t.same(shown, { attr: true, map: 'hidden', checked: 'true', remembered: 'board', files: 0 }, 'the board takes the stage, remembered per map; nothing is made by opening it');
  await page.keyboard.press('Control+Shift+L');
  await N.until(page, function () { return !window.MindRoot.notebook.boardShown(); });
  t.eq(await ev(function () { return getComputedStyle(document.querySelector('#stage > .mv')).visibility; }), 'visible', 'Mod+Shift+L: the map again');
  await page.keyboard.press('Control+Shift+L');
  await N.boardReady(page);
  t.check('and the board again', await ev(function () { return window.MindRoot.notebook.boardShown(); }));
  var cmd = await ev(function () { var c = window.MindRoot.commands.get('view.board'); return c ? c.keys.join(',') + '|' + c.group : null; });
  t.eq(cmd, 'Mod+Shift+L|view', 'the command view.board');

  /* ---------------------------------------------------------------- the first stroke */

  t.step('drawing on the infinite board');
  var steps = (await history()).n;
  var s0 = await surfaceBox();
  await N.stroke(page, s0.x + 300, s0.y + 250, s0.x + 520, s0.y + 330);
  await N.stroke(page, s0.x + 320, s0.y + 300, s0.x + 560, s0.y + 260);
  await N.idle(page);
  var made = await N.folder(page, ids.pid, folder);
  t.same(Object.keys(made).sort(), ['001.ink.svg', 'book.json'], 'the board is born: book.json and its first page');
  t.check('the map names it with the board marker', (await N.mapText(page, ids.pid, ids.mid)).indexOf('<!-- board: ' + folder + '/001.ink.svg -->') === 0);
  var h1 = await history();
  t.eq(h1.n, steps + 1, 'one step for the strokes held together');
  t.eq(h1.key, 'notebook.label.newBoard', 'labelled: start the board');
  var paperOn = await ev(function () { return document.querySelector('#board .ink').getAttribute('data-paper') + ',' + !!document.querySelector('#board .ink__paper [data-paper]'); });
  t.eq(paperOn, 'dots,true', 'the default paper (dots) is drawn under the drawing');
  await page.click('#topbar-actions [data-command="history.undo"]');
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v && v.book() && v.book().fresh && v.editor() && v.editor().elements().length === 0; });
  t.check('Undo in the top bar: the board is gone again, the sheet empty', (await N.mapText(page, ids.pid, ids.mid)).indexOf('board:') < 0);
  await page.click('#topbar-actions [data-command="history.redo"]');
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v && v.book() && !v.book().fresh && v.editor() && v.editor().elements().length === 2; });
  t.check('Redo: back, with both strokes', true);

  /* ---------------------------------------------------------------- the paper */

  t.step('another paper from the settings');
  await page.click('#board [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet .nb-set__papers', { state: 'visible' });
  var groups = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('.nb-set__group'), function (g) { return g.textContent; }); });
  t.same(groups, ['Basic', 'School', 'Maths and science', 'Music', 'Design', 'Planning', 'Calligraphy', 'Import'].slice(0, groups.length), 'papers grouped by field');
  t.check('every paper has a live preview', await ev(function () {
    var all = document.querySelectorAll('.nb-paper:not([data-value="image"]) .nb-paper__pic');
    return all.length > 25 && Array.prototype.every.call(all, function (p) { return /^url\("data:image\/svg\+xml/.test(p.style.backgroundImage); });
  }));
  await page.click('.nb-paper[data-value="grid-5"]');
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.book().meta.paper.type === 'grid-5'; });
  await N.until(page, function () { return document.querySelector('#board .ink').getAttribute('data-paper') === 'grid-5'; });
  t.eq((await history()).key, 'notebook.label.settings', 'one step: change the notebook');
  var json = JSON.parse(await N.fileText(page, ids.pid, folder + '/book.json'));
  t.eq(json.paper.type, 'grid-5', 'book.json says so');
  t.check('the page file is drawn again on it', /data-paper="grid-5"/.test(await N.fileText(page, ids.pid, folder + '/001.ink.svg')));

  t.step('Mod+Z on the board is the app\'s undo: the paper goes back, the strokes stay');
  var beforeUndo = await history();
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  await page.focus('#board .ink');
  await page.keyboard.press('Control+z');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().book().meta.paper.type === 'dots'; });
  t.eq(await view(function (v) { return v.editor().elements().length; }), 2, 'both strokes still on the sheet');
  t.eq((await history()).n, beforeUndo.n - 1, 'one step back, none added');
  t.eq(await ev(function () { return window.MindRoot.store.historyState().redoLabelKey; }), 'notebook.label.settings', 'the paper is what redo brings back');
  await page.keyboard.press('Control+Shift+z');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().book().meta.paper.type === 'grid-5'; });
  t.check('Mod+Shift+Z: the paper again', true);
  await page.click('#board [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet .nb-paper[data-value="image"]', { state: 'visible' });

  t.step('a picture as the paper');
  var png = await ev(function () {
    var c = document.createElement('canvas');
    c.width = 60; c.height = 40;
    var g = c.getContext('2d');
    g.fillStyle = '#e8d9b0'; g.fillRect(0, 0, 60, 40);
    g.fillStyle = '#8a5fbf'; g.fillRect(10, 10, 20, 10);
    return c.toDataURL('image/png').split(',')[1];
  });
  var chooser = page.waitForEvent('filechooser');
  await page.click('.nb-paper[data-value="image"]');
  var fc = await chooser;
  await fc.setFiles({ name: 'paper.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.book().meta.paper.type === 'image' && !!v.book().meta.backgroundImage; });
  await N.idle(page);
  var bgFiles = await N.folder(page, ids.pid, folder);
  t.check('kept in the notebook folder as background.png', !!bgFiles['background.png'], Object.keys(bgFiles));
  t.same(JSON.parse(await N.fileText(page, ids.pid, folder + '/book.json')).backgroundImage, { file: 'background.png', type: 'image/png', w: 60, h: 40 }, 'named in book.json with its size');
  t.check('drawn under the drawing', await ev(function () { return !!document.querySelector('#board .ink__paper-image .mr-image'); }));
  t.check('and inside the page file', /class="mr-image"/.test(await N.fileText(page, ids.pid, folder + '/001.ink.svg')));
  t.eq((await history()).key, 'notebook.label.background', 'one step');
  await page.click('.nb-paper[data-value="grid-5"]');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().book().meta.paper.type === 'grid-5' && !document.querySelector('#board .ink__paper-image .mr-image'); });
  t.check('another paper: the picture leaves the sheet (and stays in the folder for later)', !!(await N.folder(page, ids.pid, folder))['background.png']);

  /* ---------------------------------------------------------------- pages mode */

  t.step('pages mode, A4 landscape');
  await page.click('.nb-sheet [role="radiogroup"][aria-label="Mode"] [data-value="pages"]');
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.mode() === 'pages' && v.editor() && v.editor().page(); });
  await page.waitForSelector('.nb-sheet [role="radiogroup"][aria-label="Orientation"]');
  await page.click('.nb-sheet [role="radiogroup"][aria-label="Orientation"] [data-value="landscape"]');
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.book().meta.size.orientation === 'landscape' && v.editor() && v.editor().page() && v.editor().page().w > v.editor().page().h; });
  var size = await view(function (v) { return v.book().meta.size; });
  t.same([size.id, size.w, size.h], ['a4', 297, 210], 'A4 landscape');
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  var p1 = await N.fileText(page, ids.pid, folder + '/001.ink.svg');
  var pg = await ev(function (svg) { return window.MindRoot.ink.parse(svg).page; }, p1);
  t.check('the page file is a page of that size', pg && Math.abs(pg.w - 297 * 96 / 25.4) < 0.1 && Math.abs(pg.h - 210 * 96 / 25.4) < 0.1, pg);
  t.check('the drawing kept on the page', (await ev(function (svg) { return window.MindRoot.ink.parse(svg).elements.length; }, p1)) === 2);
  var desk = await ev(function () {
    var nb = document.querySelector('#board .nb');
    var live = nb.querySelector('.nb__page[data-live]');
    var r = live.getBoundingClientRect();
    var s = document.querySelector('#board .ink__surface').getBoundingClientRect();
    return { mode: nb.getAttribute('data-mode'), w: r.width, centred: Math.abs((r.left - s.left) - (s.right - r.right)) < 30, rail: !nb.querySelector('.nb__rail').hidden };
  });
  t.check('the page fits the width, centred on the desk, with the rail', desk.mode === 'pages' && desk.w > 700 && desk.centred && desk.rail, desk);
  await t.shot('pages-one');

  /* ---------------------------------------------------------------- pages */

  t.step('three pages added from the thumbnails');
  await page.click('#board [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  for (var i = 0; i < 3; i++) {
    var n0 = await view(function (v) { return v.pages(); });
    await page.click('.nb-thumbs__bar button');
    await N.until(page, function (n) { var v = window.MindRoot.notebook.boardView(); return v.pages() === n + 1 && document.querySelectorAll('.nb-thumbs__grid .nb-thumb').length === n + 1; }, n0);
  }
  await N.idle(page);
  t.same(Object.keys(await N.folder(page, ids.pid, folder)).filter(function (f) { return /\.ink\.svg$/.test(f); }).sort(), ['001.ink.svg', '002.ink.svg', '003.ink.svg', '004.ink.svg'], 'four page files');
  t.same(JSON.parse(await N.fileText(page, ids.pid, folder + '/book.json')).pages, [{ file: '001.ink.svg' }, { file: '002.ink.svg' }, { file: '003.ink.svg' }, { file: '004.ink.svg' }], 'book.json lists them in order');
  t.eq((await history()).key, 'notebook.label.addPage', 'each one a step');
  await N.until(page, function () { var imgs = document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page img'); return imgs.length === 4 && Array.prototype.every.call(imgs, function (i) { return /^blob:/.test(i.getAttribute('src') || '') && i.complete && i.naturalWidth > 0; }); });
  t.check('each thumbnail is a picture of its page', true);
  await t.shot('thumbs');
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });

  /* ---------------------------------------------------------------- the rail */

  t.step('the rail');
  await view(function (v) { v.goTo(1); });
  var rail = await ev(function () {
    var r = document.querySelector('#board .nb__rail');
    var hd = r.querySelector('.nb__handle').getBoundingClientRect();
    var tr = r.querySelector('.nb__track').getBoundingClientRect();
    return { ticks: r.querySelectorAll('.nb__tick').length, max: r.getAttribute('aria-valuemax'), now: r.getAttribute('aria-valuenow'), hx: hd.left + hd.width / 2, hy: hd.top + hd.height / 2, bottom: tr.bottom, top: tr.top, role: r.getAttribute('role') };
  });
  t.same([rail.role, rail.ticks, rail.max, rail.now], ['scrollbar', 4, '4', '1'], 'a scrollbar with one tick per page, on page 1');
  await page.mouse.move(rail.hx, rail.hy);
  await page.mouse.down();
  await page.mouse.move(rail.hx, rail.hy + 40, { steps: 4 });
  await page.mouse.move(rail.hx, rail.bottom + 20, { steps: 8 });
  var bubble = await ev(function () { var b = document.querySelector('#board .nb__bubble'); return { text: b.textContent, shown: getComputedStyle(b).opacity }; });
  await page.mouse.up();
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 4; });
  t.eq(bubble.text, '4 / 4', 'dragging the handle to the end: the bubble says page 4 of 4');
  t.check('the bubble shows while scrolling', +bubble.shown > 0.5, bubble);
  t.eq(await ev(function () { return document.querySelector('#board .nb__rail').getAttribute('aria-valuetext'); }), 'Page 4 of 4', 'said as a page of the notebook');
  await page.mouse.click(rail.hx, rail.top + 4);
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.check('a press at the top of the track: page 1', true);
  await page.focus('#board .nb__rail');
  await page.keyboard.press('End');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 4; });
  await page.keyboard.press('Home');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.check('End and Home on the rail', true);
  await page.focus('#board .ink');
  await page.keyboard.press('PageDown');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 2; });
  await page.keyboard.press('PageUp');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 1; });
  t.check('Page Down and Page Up on the sheet turn the pages', true);

  /* ---------------------------------------------------------------- drawing on another page */

  t.step('a stroke on another page turns the editor to it');
  await view(function (v) { v.goTo(3); });
  await N.until(page, function () { return window.MindRoot.notebook.boardView().page() === 3; });
  var target = await ev(function () {
    var v = window.MindRoot.notebook.boardView();
    var ed = v.editor();
    var s = document.querySelector('#board .ink__surface').getBoundingClientRect();
    /* The middle of the screen is on page 3. */
    return { x: s.left + s.width / 2, y: s.top + s.height / 2, active: v.active() };
  });
  t.eq(target.active, 0, 'page 1 is the live one');
  var before3 = (await N.folder(page, ids.pid, folder))['003.ink.svg'];
  await N.stroke(page, target.x - 100, target.y - 30, target.x + 120, target.y + 40);
  await N.idle(page);
  t.eq(await view(function (v) { return v.active(); }), 2, 'the stroke went to page 3, now live');
  t.check('its file changed', (await N.folder(page, ids.pid, folder))['003.ink.svg'] !== before3);
  t.eq(await ev(function (svg) { return window.MindRoot.ink.parse(svg).elements.length; }, await N.fileText(page, ids.pid, folder + '/003.ink.svg')), 1, 'with the stroke');
  t.eq(await ev(function (svg) { return window.MindRoot.ink.parse(svg).elements.length; }, await N.fileText(page, ids.pid, folder + '/001.ink.svg')), 2, 'page 1 as it was');
  await t.shot('pages-drawn');

  /* ---------------------------------------------------------------- reorder */

  t.step('reorder by dragging a thumbnail');
  await page.click('#board [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  var tiles = await ev(function () {
    return Array.prototype.map.call(document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page'), function (b) { var r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, w: r.width }; });
  });
  await page.mouse.move(tiles[3].x, tiles[3].y);
  await page.mouse.down();
  await page.mouse.move(tiles[3].x + 10, tiles[3].y + 10, { steps: 3 });
  await page.mouse.move(tiles[0].l + 6, tiles[0].y, { steps: 10 });
  t.check('a ghost follows and a bar shows the place', await ev(function () { return !!document.querySelector('.nb-thumb--ghost') && !!document.querySelector('.nb-thumbs__drop'); }));
  await page.mouse.up();
  await N.until(page, function () { return window.MindRoot.notebook.boardView().book().pages[0].file === '004.ink.svg'; });
  await N.idle(page);
  t.same(await view(function (v) { return v.book().pages.map(function (p) { return p.file; }); }), ['004.ink.svg', '001.ink.svg', '002.ink.svg', '003.ink.svg'], 'the last page is first');
  t.check('the board marker names the new first page', (await N.mapText(page, ids.pid, ids.mid)).indexOf('<!-- board: ' + folder + '/004.ink.svg -->') === 0);
  t.eq((await history()).key, 'notebook.label.movePage', 'one step: move the page');
  t.same(JSON.parse(await N.fileText(page, ids.pid, folder + '/book.json')).pages.map(function (p) { return p.file; }), ['004.ink.svg', '001.ink.svg', '002.ink.svg', '003.ink.svg'], 'book.json in the new order');

  /* ---------------------------------------------------------------- delete and restore */

  t.step('a page to the trash and back');
  await page.hover('.nb-thumbs__grid .nb-thumb:nth-child(2)');
  await page.click('.nb-thumbs__grid .nb-thumb:nth-child(2) .nb-thumb__more');
  await page.click('.menu [role="menuitem"]:has-text("Move the page to the trash")');
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 3; });
  await N.idle(page);
  var trash = await ev(function (a) { return window.MindRoot.store.trash(a.pid).filter(function (e) { return e.path === a.path; }).map(function (e) { return { kind: e.kind, owner: e.owner, id: e.id }; })[0] || null; }, { pid: ids.pid, path: folder + '/001.ink.svg' });
  t.check('the page is in the project trash', trash && trash.kind === 'asset', trash);
  t.check('named as a page of the board', trash && /page 2/.test(trash.owner), trash);
  t.check('its file left the folder', !(await N.folder(page, ids.pid, folder))['001.ink.svg']);
  await ev(function (a) { window.MindRoot.store.restoreTrash(a.pid, a.id); }, { pid: ids.pid, id: trash.id });
  await N.until(page, function () { return window.MindRoot.notebook.boardView().pages() === 4; });
  t.same(await view(function (v) { return v.book().pages.map(function (p) { return p.file; }); }), ['004.ink.svg', '001.ink.svg', '002.ink.svg', '003.ink.svg'], 'restored where it was');
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });

  t.step('the palette and the sidebar work over the board');
  await page.click('#board .ink__surface', { position: { x: 30, y: 400 } });
  await page.keyboard.press('Control+k');
  await N.until(page, function () { return window.MindRoot.palette && window.MindRoot.palette.isOpen(); });
  t.check('Mod+K opens the palette from the board', true);
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !window.MindRoot.palette.isOpen(); });
  var w0 = await ev(function () { return document.querySelector('#board .nb__page[data-live]').getBoundingClientRect().width; });
  await page.keyboard.press('Control+b');
  await N.until(page, function (w) { var el = document.querySelector('#board .nb__page[data-live]'); return el && Math.abs(el.getBoundingClientRect().width - w) > 20; }, w0);
  var w1 = await ev(function () { return document.querySelector('#board .nb__page[data-live]').getBoundingClientRect().width; });
  t.check('the sidebar closes: the page, fitted to the width, grows with it', w1 > w0, [w0, w1]);
  await page.keyboard.press('Control+b');
  await N.until(page, function (w) { var el = document.querySelector('#board .nb__page[data-live]'); return el && Math.abs(el.getBoundingClientRect().width - w) < 2; }, w0);

  /* ---------------------------------------------------------------- export */

  t.step('export: PDF of every page, PNG of this page');
  await N.idle(page);
  var pdfInfo = await ev(function () {
    var v = window.MindRoot.notebook.boardView();
    return v.exportBook().then(function (texts) { return window.MindRoot.notebook.exportPdf(v.book(), { print: false, texts: texts }); }).then(function (out) { return out.pages; });
  });
  t.eq(pdfInfo.length, 4, 'four pages in the print sheet');
  t.same(pdfInfo[0], { w: 297, h: 210 }, 'each one A4 landscape in mm');
  t.check('vector: the page drawings are inlined SVG', await ev(function () { return document.querySelectorAll('.nb-print .nb-print__page > svg').length === 4; }));
  var buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  var sizes = N.pdfPages(buf);
  t.eq(sizes.length, 4, 'the PDF has four pages');
  t.check('each A4 landscape (841.9 x 595.3 pt)', sizes.every(function (s) { return Math.abs(s[0] - 841.89) < 2 && Math.abs(s[1] - 595.28) < 2; }), sizes);
  await ev(function () { window.dispatchEvent(new Event('afterprint')); });
  await ev(function () { window.__printed = 0; window.print = function () { window.__printed++; }; });
  await page.click('#board [data-nb="export"]');
  await page.click('.menu [role="menuitem"]:has-text("PDF of every page")');
  await N.until(page, function () { return window.__printed === 1; });
  t.check('from the menu: the print dialog, the sheet ready', await ev(function () { return document.documentElement.hasAttribute('data-nb-printing') && document.querySelectorAll('.nb-print__page').length === 4; }));
  await ev(function () { window.dispatchEvent(new Event('afterprint')); });
  t.check('afterprint takes the sheet away', await ev(function () { return !document.querySelector('.nb-print') && !document.documentElement.hasAttribute('data-nb-printing'); }));
  await page.click('#board [data-nb="export"]');
  var dl = page.waitForEvent('download');
  await page.click('.menu [role="menuitem"]:has-text("PNG of this page")');
  var download = await dl;
  var file = await download.path();
  var png = require('fs').readFileSync(file);
  t.eq(png.slice(1, 4).toString('latin1'), 'PNG', 'a PNG');
  var pw = png.readUInt32BE(16);
  var ph = png.readUInt32BE(20);
  t.check('of the page at twice its size', Math.abs(pw - Math.round(297 * 96 / 25.4 * 2)) <= 2 && Math.abs(ph - Math.round(210 * 96 / 25.4 * 2)) <= 2, [pw, ph]);
  t.check('named after the board', /board|garden/i.test(download.suggestedFilename()), download.suggestedFilename());

  /* ---------------------------------------------------------------- dark */

  t.step('the dark theme: light ink on dark paper, literal colours in the file');
  await view(function (v) { v.goTo(1); });
  var mid1 = await ev(function () { var s = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: s.left + s.width / 2, y: s.top + 220 }; });
  await N.stroke(page, mid1.x - 120, mid1.y, mid1.x + 120, mid1.y + 30);
  await N.idle(page);
  t.eq(await view(function (v) { return v.active(); }), 0, 'drawn on page 1');
  await ev(function () { window.MindRoot.prefs.set('theme', 'dark'); });
  await N.until(page, function () { return document.querySelector('#board .ink').getAttribute('data-sheet') === 'dark'; });
  var dark = await ev(function () {
    var ink = document.querySelector('#board .ink');
    var stroke = ink.querySelector('.ink__scene path');
    var sheet = ink.querySelector('.ink__paper .mr-sheet');
    return { sheet: sheet ? sheet.getAttribute('fill') : null, stroke: stroke ? stroke.getAttribute('fill') : null, colors: window.MindRoot.paper.colors('dark') };
  });
  t.eq(dark.sheet, dark.colors.sheet, 'the page is dark paper');
  t.eq(dark.stroke, dark.colors.ink, 'the semantic ink is light on it');
  var themedUrl = await ev(function () { var img = document.querySelector('#board .nb__page:not([data-live]) img[src]'); return img ? img.src : null; });
  t.check('the other pages are pictures of their files', !!themedUrl);
  var themedText = await ev(function (u) { return fetch(u).then(function (r) { return r.text(); }); }, themedUrl);
  t.check('shown in the dark theme', themedText.indexOf(dark.colors.sheet) > 0);
  var saved = await N.fileText(page, ids.pid, folder + '/004.ink.svg');
  var light = await ev(function () { return window.MindRoot.paper.colors('light'); });
  t.check('the file keeps the light paper and the literal ink', saved.indexOf(dark.colors.sheet) < 0 && saved.indexOf(light.sheet) > 0);
  var p001 = await N.fileText(page, ids.pid, folder + '/001.ink.svg');
  t.check('the strokes in the file are the light paper\'s ink, marked mr-ink', /class="mr-ink"[^>]*fill="#15171c"|fill="#15171c"[^>]*class="mr-ink"/.test(p001) || (p001.indexOf('mr-ink') > 0 && p001.indexOf(light.ink) > 0));
  /* The theme crossfades (a view transition): the picture after it. */
  await N.until(page, function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  await ev(function () { return new Promise(function (r) { setTimeout(r, 450); }); });
  await t.shot('dark');

  t.step('the board\'s tools say they hold more: the chevrons and the hint, in the app\'s preferences');
  await page.click('#board .ink__tool[data-tool="eraser"]');
  await N.until(page, function () { var c = document.querySelector('#board .ink__coach'); return c && !c.hidden; });
  var coach = await ev(function () {
    var c = document.querySelector('#board .ink__coach');
    var r = c.getBoundingClientRect();
    var b = document.querySelector('#board .ink__tool[data-tool="eraser"]').getBoundingClientRect();
    var carets = Array.prototype.filter.call(document.querySelectorAll('#board .ink__tools .ink__caret'), function (el) { return el.getClientRects().length > 0; }).length;
    return { text: c.textContent, below: r.top > b.bottom, carets: carets, pref: window.MindRoot.prefs.get('inkCoach') };
  });
  t.same(coach, { text: 'Click again for eraser options', below: true, carets: 9, pref: { used: false, shown: 1 } },
    'the eraser taken: the hint under it, a chevron on each of the nine buttons that hold more, counted in the preferences');
  await ev(function () { return new Promise(function (r) { setTimeout(r, 300); }); });
  await t.shot('dark-coach');
  var caretAt = await ev(function () { var r = document.querySelector('#board .ink__tool[data-tool="eraser"] .ink__caret-icon').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(caretAt[0], caretAt[1]);
  t.same(await ev(function () {
    var pop = document.querySelector('#board .ink__pop');
    return { kind: !pop.hidden && pop.getAttribute('data-kind'), coach: document.querySelector('#board .ink__coach').hidden, pref: window.MindRoot.prefs.get('inkCoach') };
  }), { kind: 'eraser', coach: true, pref: { used: true, shown: 1 } }, 'its chevron opens the eraser options; found, the hint is done for good');
  await page.mouse.click(caretAt[0], caretAt[1]);
  await page.click('#board .ink__tool[data-tool="pen"]');
  t.eq(await ev(function () { return window.MindRoot.notebook.boardView().editor().tool() + ',' + document.querySelector('#board .ink__pop').hidden + ',' + document.querySelector('#board .ink__coach').hidden; }), 'pen,true,true', 'the pen back in hand, nothing left open');

  await ev(function () { window.MindRoot.prefs.set('theme', 'light'); });
  await N.until(page, function () { return !document.querySelector('#board .ink').hasAttribute('data-sheet'); });

  /* ---------------------------------------------------------------- reload */

  t.step('a reload opens the board again, as it was');
  await N.idle(page);
  await ev(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await N.boardReady(page);
  var back = await N.board(page);
  t.same([back.mode, back.pages, back.files[0], back.meta.size.orientation, back.meta.paper.type], ['pages', 4, '004.ink.svg', 'landscape', 'grid-5'], 'the board view, its pages and settings');
  t.eq(await ev(function () { return document.querySelector('#topbar-actions .nb-switch [data-value="board"]').getAttribute('aria-checked'); }), 'true', 'the switch on Board');

  /* ---------------------------------------------------------------- the hidden map */

  t.step('the hidden map keeps still: its keys with the focus nowhere');
  var text0 = await N.mapText(page, ids.pid, ids.mid);
  var keys = ['Control+Enter', 'F2', 'Alt+ArrowDown', 'Home', 'Delete', 'Enter', 'ArrowRight', 'ArrowDown'];
  for (var ki = 0; ki < keys.length; ki++) {
    await ev(function () { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    await page.keyboard.press(keys[ki]);
  }
  t.eq(await N.mapText(page, ids.pid, ids.mid), text0, 'arrows, Enter, Delete, Alt+arrows, F2: the map text unchanged');
  t.eq(await ev(function () { return window.MindRoot.session.selected(); }), null, 'nothing selected on the hidden map');
  t.check('the board is still up', await ev(function () { return window.MindRoot.notebook.boardShown(); }));
  t.check('the focus is back on the board', await ev(function () { return document.getElementById('board').contains(document.activeElement); }));
  await page.click('#board [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet', { state: 'visible' });
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  await page.keyboard.press('ArrowDown');
  t.eq(await N.mapText(page, ids.pid, ids.mid), text0, 'a sheet closed: still nothing reaches the map');
  await ev(function () { window.MindRoot.session.select('0', { reveal: true }); });
  await N.until(page, function () { return !window.MindRoot.notebook.boardShown(); });
  t.eq(await ev(function () { return window.MindRoot.session.selected(); }), '0', 'a node chosen (a search result) brings the map back, the node selected');
  await page.keyboard.press('Control+Shift+L');
  await N.boardReady(page);

  /* ---------------------------------------------------------------- back to the map */

  t.step('back to the map, and another map opens on its own face');
  await page.click('#topbar-actions .nb-switch [data-value="map"]');
  await N.until(page, function () { return !window.MindRoot.notebook.boardShown() && !document.getElementById('board'); });
  t.eq(await ev(function () { var c = window.MindRoot.session.current(); return window.MindRoot.store.mapView(c.projectId, c.mapId).view || null; }), null, 'remembered: the map');
  await page.keyboard.press('Control+Shift+L');
  await N.boardReady(page);
  await ev(function (a) { window.MindRoot.session.open(a.pid, a.mid); }, { pid: ids.pid, mid: ids.mids[1] });
  await N.until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid && !window.MindRoot.notebook.boardShown(); }, ids.mids[1]);
  t.check('Other opens as a map', true);
  await ev(function (a) { window.MindRoot.session.open(a.pid, a.mid); }, { pid: ids.pid, mid: ids.mid });
  await N.boardReady(page);
  t.check('Garden opens on its board again', await ev(function () { return window.MindRoot.notebook.boardShown(); }));
};
