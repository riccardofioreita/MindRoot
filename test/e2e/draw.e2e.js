/* draw: a node's drawing is a notebook (docs/NOTEBOOK.md) hosted in the
 * viewer, on the real app with the real editor and real pointer events.
 *
 * Covered: a new drawing for a node makes nothing until the first stroke;
 * the first stroke makes the '<node>.book' folder (book.json and the first
 * page) and puts the first page in the node, one step; later saves land as
 * one step per pause; Mod+S, a map switch and another tab taking over hand
 * them over at once; the page asks before it is left only while strokes
 * are not written; every notebook feature is there in the viewer (settings:
 * pages mode, paper, size; pages and the rail; export) with the node still
 * naming the first page; the three places (beside, over the map, a card)
 * all show the notebook whole; Done closes the viewer and gives the focus
 * back; a tap on the drawing on the map opens it again; undoing the first
 * stroke takes the viewer back to a new drawing and redo brings the folder
 * back; the board is no longer in the viewer (no media.board; a board's page
 * opened from here switches to the Board view); an old lone .ink.svg opens
 * as a one-page notebook and writes back to its file until a setting needs
 * a folder (then it moves, the node renamed, one step); an old .excalidraw.svg
 * opens as the background and moves into a folder with the first stroke;
 * view only opens a drawing locked; a drawing the store cannot keep is
 * offered as a download. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;

var MAP = '# Pics\n\n- Alpha\n- Beta\n- ![](assets/old.excalidraw.svg) Gamma\n- ![](assets/lone.ink.svg) Delta\n';
var OLD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><!-- svg-source:excalidraw --><rect width="200" height="100" fill="#ffffff"/><path d="M10 50 L190 50" stroke="#1e1e1e" stroke-width="3"/></svg>';
var ALPHA = 'assets/alpha.book/001.ink.svg';
var BETA = 'assets/beta.book/001.ink.svg';

module.exports = async function (t) {
  var s = await E.boot(t, [['Pics', MAP], ['Second', '# Second\n\n- one\n']]);
  var page = s.page;

  /* An old Excalidraw file and an old lone drawing of ours (one rectangle),
   * as the previous versions left them. */
  await page.evaluate(function (svg) {
    var ns = window.MindRoot;
    var pid = ns.store.here().projectId;
    var lone = ns.ink.serialize({ elements: [ns.ink.engine.makeShape('rect', [10, 10], [120, 80], { color: '#1f2328', width: 2 })] });
    return Promise.all([ns.storage.putBlob(svg, 'old.excalidraw.svg'), ns.storage.putBlob(lone, 'lone.ink.svg')]).then(function (refs) {
      ns.store.setFile(pid, 'assets/old.excalidraw.svg', refs[0]);
      ns.store.setFile(pid, 'assets/lone.ink.svg', refs[1]);
    });
  }, OLD_SVG);

  function text() { return E.text(page); }
  async function waitText(re, ms) {
    try { await E.until(page, function (src) { var c = window.MindRoot.session.current(); return c && new RegExp(src).test(c.text); }, re.source, ms || 8000); } catch (err) { /* checked below */ }
    return text();
  }
  function state() {
    return page.evaluate(function () {
      var v = window.MindRoot.media.viewerState();
      if (!v) return null;
      var nb = v.notebook;
      return {
        kind: v.kind, path: v.path, created: v.created, mode: v.mode, side: v.side,
        scene: v.editor ? v.editor.scene().length : null, readOnly: v.editor ? v.editor.readOnly() : null,
        loaded: v.editor ? v.editor.loaded().kind : null, book: nb ? nb.mode() : null, pages: nb ? nb.pages() : null
      };
    });
  }
  async function editorReady() { await M.editorReady(page); }
  function stroke(dy) { return M.stroke(page, dy); }
  function fileAsset(path) { return M.fileAsset(page, path); }
  async function waitAsset(path, not, ms) {
    try {
      await E.until(page, function (o) {
        var ns = window.MindRoot;
        var ref = ns.store.fileRef(ns.store.here().projectId, o.p);
        return !!ref && ref.asset !== o.not;
      }, { p: path, not: not }, ms || 8000);
    } catch (err) { /* checked */ }
    return fileAsset(path);
  }
  function storedElements(path) {
    return page.evaluate(function (p) {
      var ns = window.MindRoot;
      var ref = ns.store.fileRef(ns.store.here().projectId, p);
      if (!ref) return null;
      return ns.storage.blobText(ref.asset).then(function (svg) { return ns.ink.parse(svg).elements.length; });
    }, path);
  }
  async function waitElements(path, n) {
    for (var w = 0; w < 60 && (await storedElements(path)) !== n; w++) await page.waitForTimeout(100);
    return storedElements(path);
  }
  function bookJson(folder) {
    return page.evaluate(function (f) {
      var ns = window.MindRoot;
      var ref = ns.store.fileRef(ns.store.here().projectId, f + '/book.json');
      return ref ? ns.storage.blobText(ref.asset).then(function (tx) { return JSON.parse(tx); }) : null;
    }, folder);
  }
  async function storageIdle() {
    await E.until(page, function () { return !window.MindRoot.storage.pending(); }, null, 6000);
  }
  function unloadAsks() {
    return page.evaluate(function () {
      var ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
  }
  async function closed() {
    try { await E.until(page, function () { return !window.MindRoot.media.viewerState(); }, null, 5000); } catch (err) { /* checked */ }
    return state();
  }
  /* Everything the notebook in the viewer holds, written. */
  function idle() {
    return page.evaluate(function () {
      var v = window.MindRoot.media.viewerState();
      var nb = v && v.notebook;
      return nb ? nb.flush().then(function () { return nb.idle(); }) : null;
    });
  }

  t.step('a new drawing for a node: nothing until the first stroke');
  /* Chosen through the session (what is tested here is the drawing, and a
   * click on a map still settling its first camera can land beside it). */
  await E.settled(page);
  await E.select(page, '0');
  await E.settled(page);
  var h0 = await E.history(page);
  await E.until(page, function () { var b = document.querySelector('.node-toolbar [data-command="media.draw"]'); return b && !b.hidden && b.getClientRects().length; });
  await page.click('.node-toolbar [data-command="media.draw"]');
  await editorReady();
  var st = await state();
  t.same([st.kind, st.path, st.created, st.scene, st.book, st.pages], ['drawing', null, false, 0, 'infinite', 1], 'an empty infinite notebook, no file');
  t.eq(await page.evaluate(function () { return document.getElementById('viewer').getAttribute('aria-labelledby') && document.getElementById('viewer-title').textContent; }), 'New drawing: Alpha', 'titled with the node');
  t.check('the notebook fills the viewer', await page.evaluate(function () {
    var b = document.querySelector('#viewer .viewer__body').getBoundingClientRect();
    var n = document.querySelector('#viewer .nb').getBoundingClientRect();
    return Math.abs(b.width - n.width) < 2 && Math.abs(b.height - n.height) < 2;
  }));
  t.check('the editor has the keyboard', await page.evaluate(function () { return document.querySelector('#viewer .ink').contains(document.activeElement); }));
  await page.waitForTimeout(800);
  t.eq((await E.history(page)).count, h0.count, 'opening it wrote nothing');
  t.check('no file in the project', !Object.keys(await M.files(page)).some(function (f) { return /alpha/.test(f); }));

  t.step('the first stroke makes the notebook and puts its first page in the node, one step');
  await storageIdle();
  await stroke(0);
  t.eq(await unloadAsks(), true, 'leaving now would ask (the stroke is not written yet)');
  var tx = await waitText(/alpha\.book/);
  t.check('the node shows the first page', tx.indexOf('- ![](' + ALPHA + ') Alpha\n') >= 0, tx);
  var a1 = await fileAsset(ALPHA);
  t.check('the page is in the project', !!a1);
  t.eq(await storedElements(ALPHA), 1, 'with the stroke in it');
  var bj = await bookJson('assets/alpha.book');
  t.check('with its book.json: infinite, one page', bj && bj.mindroot === 'book' && bj.mode === 'infinite' && bj.pages.length === 1 && bj.pages[0].file === '001.ink.svg', bj);
  var h1 = await E.history(page);
  t.eq(h1.count, h0.count + 1, 'one step');
  t.eq(h1.label, 'draw on the node', 'labelled');
  st = await state();
  t.same([st.path, st.created], [ALPHA, true], 'the viewer knows its notebook from now on');
  t.eq(await page.evaluate(function () { return document.getElementById('viewer-title').textContent; }), 'Drawing: Alpha', 'retitled');
  await t.shot('desktop-drawing');
  try {
    await E.until(page, function () {
      var n = window.MindRoot.session.view.nodeEl('0');
      var img = n && n.querySelector('img.mv-img[data-kind="draw"]');
      return img && img.complete && img.naturalWidth > 0;
    }, null, 6000);
  } catch (err) { /* checked */ }
  var onMap = (await M.pictures(page)).filter(function (p) { return p.node === '0'; });
  t.check('and the map draws it', onMap.length === 1 && onMap[0].kind === 'draw' && onMap[0].loaded, onMap);
  await idle();
  await storageIdle();
  t.eq(await unloadAsks(), false, 'written: leaving does not ask');

  t.step('later strokes are one step per pause');
  var srcBefore = await page.evaluate(function () { return window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img').getAttribute('src'); });
  /* Each stroke handed over at once (editor.save(), what ink does 600 ms
   * after a gesture), timed in the page: on a runner so busy that more
   * than the pause passed between them, two steps are right. */
  await stroke(40);
  var firstAt = await page.evaluate(function () { window.MindRoot.media.viewerState().editor.save(); return performance.now(); });
  await page.waitForTimeout(200);
  t.eq(await fileAsset(ALPHA), a1, 'a save is held for a moment');
  await stroke(-40);
  var gap = await page.evaluate(function () { window.MindRoot.media.viewerState().editor.save(); return performance.now(); }) - firstAt;
  var a2 = await waitAsset(ALPHA, a1, 8000);
  t.check('then written', a2 && a2 !== a1, a2);
  t.eq(await waitElements(ALPHA, 3), 3, 'with both strokes');
  a2 = await fileAsset(ALPHA);
  var h2 = await E.history(page);
  t.check('two saves, one step', h2.count === h1.count + 1 || (gap >= 1500 && h2.count === h1.count + 2), { steps: h2.count - h1.count, gap: gap });
  t.eq(h2.label, 'draw', 'labelled');
  try {
    await E.until(page, function (old) {
      var img = window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img');
      return img.getAttribute('src') && img.getAttribute('src') !== old;
    }, srcBefore, 4000);
  } catch (err) { /* checked */ }
  var srcAfter = await page.evaluate(function () { return window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img').getAttribute('src'); });
  t.check('the map shows the new bytes', srcAfter && srcAfter !== srcBefore, [srcBefore, srcAfter]);

  t.step('Mod+S hands the drawing over at once');
  await stroke(80);
  var saved = await page.evaluate(function () { return window.MindRoot.commands.run('file.save'); });
  t.check('saved', saved !== false);
  var a3 = await waitAsset(ALPHA, a2, 3000);
  t.check('the new stroke is in the store when Save is done', a3 !== a2, [a2, a3]);
  t.eq(await waitElements(ALPHA, 4), 4, 'all four strokes');

  t.step('every notebook feature is there in the viewer');
  var tools = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#viewer .ink__host'), function (b) { return b.getAttribute('data-nb'); }).join(','); });
  t.eq(tools, 'pages,settings,export', 'the canvases (pages), settings and export in the editor bar (no "more": the map is beside it)');
  await page.click('#viewer [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet .nb-paper[data-value="grid-5"]', { state: 'visible' });
  await page.click('.nb-paper[data-value="grid-5"]');
  await E.until(page, function () { return document.querySelector('#viewer .ink').getAttribute('data-paper') === 'grid-5'; });
  t.eq((await E.history(page)).key, 'notebook.label.settings', 'another paper, one step');
  await page.click('.nb-sheet [role="radiogroup"][aria-label="Mode"] [data-value="pages"]');
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.notebook.mode() === 'pages' && v.editor && v.editor.page(); });
  await page.waitForSelector('.nb-sheet [role="radiogroup"][aria-label="Orientation"]');
  var sizeSel = await page.$('.nb-sheet select');
  if (sizeSel) await sizeSel.selectOption('a5');
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v.notebook.book().meta.size.id === 'a5'; }); } catch (err) { /* checked */ }
  await t.shot('viewer-settings');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.nb-sheet'); });
  t.check('the viewer is still open under the sheet it closed', !!(await state()));
  bj = await bookJson('assets/alpha.book');
  t.same([bj.mode, bj.paper.type, bj.size.id], ['pages', 'grid-5', 'a5'], 'pages mode, 5 mm squares, A5 in book.json');
  await page.click('#viewer [data-nb="pages"]');
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  await page.click('.nb-thumbs__bar button');
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v.notebook.pages() === 2; });
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.nb-sheet'); });
  await idle();
  t.check('a second page file', !!(await fileAsset('assets/alpha.book/002.ink.svg')));
  t.check('the node still names the first page', (await text()).indexOf('- ![](' + ALPHA + ') Alpha') >= 0, await text());
  var rail = await page.evaluate(function () {
    var r = document.querySelector('#viewer .nb__rail');
    var b = document.querySelector('#viewer .viewer__body').getBoundingClientRect();
    var rr = r.getBoundingClientRect();
    return { shown: !r.hidden && rr.width > 0, inside: rr.right <= b.right + 1 && rr.left >= b.left, ticks: r.querySelectorAll('.nb__tick').length };
  });
  t.check('the rail at the side of the viewer, a tick per page', rail.shown && rail.inside && rail.ticks === 2, rail);
  await t.shot('viewer-pages');
  await page.click('#viewer [data-nb="export"]');
  await page.waitForSelector('.menu [role="menuitem"]', { state: 'visible' });
  var exportItems = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.menu [role="menuitem"]'), function (m) { return m.textContent.trim(); }); });
  t.check('export: the PDF of every page and the PNG of this page', exportItems.some(function (x) { return /PDF of every page/.test(x); }) && exportItems.some(function (x) { return /PNG of this page/.test(x); }), exportItems);
  var dl = page.waitForEvent('download', { timeout: 8000 }).catch(function () { return null; });
  await page.click('.menu [role="menuitem"]:has-text("PNG of this page")');
  var png = await dl;
  t.check('a PNG of the page', png && /\.png$/i.test(png.suggestedFilename()), png && png.suggestedFilename());

  t.step('the three places all show the notebook whole');
  async function fits() {
    return page.evaluate(function () {
      var body = document.querySelector('#viewer .viewer__body').getBoundingClientRect();
      var nb = document.querySelector('#viewer .nb').getBoundingClientRect();
      var bar = document.querySelector('#viewer .ink__bar, #viewer .ink__tools');
      var surf = document.querySelector('#viewer .ink__surface').getBoundingClientRect();
      return {
        mode: document.documentElement.getAttribute('data-viewer'),
        fills: Math.abs(body.width - nb.width) < 2 && Math.abs(body.height - nb.height) < 2,
        surface: surf.width > 150 && surf.height > 150,
        tools: !!bar
      };
    });
  }
  for (var m of ['card', 'full', 'split']) {
    await page.evaluate(function (mode) { window.MindRoot.media.setViewerMode(mode); }, m);
    await E.until(page, function (mode) { return document.documentElement.getAttribute('data-viewer') === mode; }, m);
    await page.waitForTimeout(350);
    var f = await fits();
    t.check(m + ': the notebook fills the viewer, the sheet in sight', f.fills && f.surface && f.tools, f);
    await t.shot('viewer-' + m);
  }

  t.step('Done closes the viewer and gives the focus back');
  await page.click('#viewer .viewer__close');
  t.eq(await closed(), null, 'closed');
  t.eq(await page.evaluate(function () { return document.getElementById('viewer').hidden; }), true, 'hidden');
  t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-viewer'); }), false, 'the map has the room back');
  t.check('the focus is back on the toolbar button or the map', await page.evaluate(function () {
    var a = document.activeElement;
    return a && (a.closest('.node-toolbar') || a === window.MindRoot.session.view.el);
  }));

  t.step('a tap on the drawing on the map opens it again');
  await page.evaluate(function () { window.MindRoot.session.select(null); });
  await E.settled(page);
  var img = await page.evaluate(function () {
    var r = window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(img.x, img.y);
  await editorReady();
  st = await state();
  t.same([st.kind, st.path, st.scene, st.book, st.pages], ['drawing', ALPHA, 4, 'pages', 2], 'the same notebook: pages mode, two pages, every stroke on the first');
  await page.keyboard.press('Escape');
  t.eq(await closed(), null, 'Escape closes it');

  t.step('undo of the first stroke: back to a new drawing; redo: the notebook again');
  await E.select(page, '1');
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await editorReady();
  await stroke(0);
  tx = await waitText(/beta\.book/);
  t.check('Beta has its notebook', tx.indexOf('- ![](' + BETA + ') Beta') >= 0, tx);
  await idle();
  await page.evaluate(function () { window.MindRoot.session.undo(); });
  tx = await waitText(/^(?![\s\S]*beta\.book)/);
  t.check('undo takes it out of the node', tx.indexOf('beta.book') < 0, tx);
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && !v.created && v.editor && v.editor.scene().length === 0; }, null, 5000); } catch (err) { /* checked */ }
  st = await state();
  t.same([st.created, st.scene], [false, 0], 'and the open notebook is a new drawing again');
  await page.evaluate(function () { window.MindRoot.session.redo(); });
  tx = await waitText(/beta\.book/);
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.created && v.editor && v.editor.scene().length === 1; }, null, 5000); } catch (err) { /* checked */ }
  st = await state();
  t.same([st.created, st.scene, st.path], [true, 1, BETA], 'redo: the notebook and its stroke are back');

  t.step('another map: the drawing is handed over and the viewer closes');
  await stroke(50);
  var b1 = await fileAsset(BETA);
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mids[1] });
  t.eq(await closed(), null, 'closed with its map');
  var b2 = await waitAsset(BETA, b1, 4000);
  t.check('the last stroke landed', b2 !== b1, [b1, b2]);
  t.eq(await waitElements(BETA, 2), 2, 'both strokes kept');
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mid });
  await E.settled(page);

  t.step('another tab taking over gets what is held');
  await E.select(page, '1');
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await editorReady();
  await stroke(-60);
  await page.waitForTimeout(700);
  var held = await fileAsset(BETA);
  var waited = await page.evaluate(function () {
    var waits = [];
    window.MindRoot.bus.emit('tabs:yield', { to: 'test', waitUntil: function (p) { waits.push(p); } });
    return Promise.all(waits).then(function () { return waits.length; });
  });
  t.check('it waits for the notebook', waited >= 1, waited);
  t.check('and finds it in the store', (await fileAsset(BETA)) !== held);
  await page.click('#viewer .viewer__close');
  await closed();

  t.step('the board is the Board view, never the viewer');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.has('media.board'); }), false, 'one board command: view.board');
  await page.evaluate(function () { window.MindRoot.commands.run('view.board'); });
  await E.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v && v.editor() && !v.el.hasAttribute('data-loading'); });
  t.eq(await state(), null, 'the viewer stays closed');
  t.check('the board fills the stage', await page.evaluate(function () { return !!document.querySelector('#stage > #board .nb'); }));
  var bs = await E.rectOf(page, '#board .ink__surface');
  await page.mouse.move(bs.x + bs.w * 0.4, bs.y + bs.h * 0.5);
  await page.mouse.down();
  for (var i = 1; i <= 10; i++) await page.mouse.move(bs.x + bs.w * 0.4 + i * 10, bs.y + bs.h * 0.5 + i * 3);
  await page.mouse.up();
  tx = await waitText(/board:/);
  t.check('the first stroke writes the marker to the board notebook', /<!-- board: assets\/pics-board\.book\/001\.ink\.svg -->/.test(tx), tx.slice(0, 80));
  await page.evaluate(function () { window.MindRoot.commands.run('view.board'); });
  await E.until(page, function () { return !window.MindRoot.notebook.boardShown(); });
  await page.evaluate(function () { return window.MindRoot.media.openViewer('assets/pics-board.book/001.ink.svg'); });
  await E.until(page, function () { return window.MindRoot.notebook.boardShown(); });
  t.eq(await state(), null, 'its page asked for here (the media panel) switches to the Board view');
  await page.evaluate(function () { window.MindRoot.notebook.showMap(); });
  await E.until(page, function () { return !window.MindRoot.notebook.boardShown(); });
  await E.settled(page);

  t.step('an old lone drawing opens as one page and is written back to its own file');
  await E.select(page, '3');
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await editorReady();
  st = await state();
  t.same([st.path, st.created, st.scene, st.book, st.pages], ['assets/lone.ink.svg', true, 1, 'infinite', 1], 'one infinite page, its rectangle in it');
  var l0 = await fileAsset('assets/lone.ink.svg');
  await stroke(30);
  var l1 = await waitAsset('assets/lone.ink.svg', l0, 6000);
  t.check('a stroke writes the lone file itself', l1 && l1 !== l0, [l0, l1]);
  t.check('no folder made for it', !Object.keys(await M.files(page)).some(function (f) { return /lone\.book/.test(f); }));
  var hl = await E.history(page);
  await page.click('#viewer [data-nb="settings"]');
  await page.waitForSelector('.nb-sheet .nb-paper[data-value="ruled"]', { state: 'visible' });
  await page.click('.nb-paper[data-value="ruled"]');
  tx = await waitText(/lone\.book/);
  t.check('a setting moves it into a folder and the node follows', tx.indexOf('- ![](assets/lone.book/001.ink.svg) Delta') >= 0, tx);
  var hl2 = await E.history(page);
  t.same([hl2.count - hl.count, hl2.key], [1, 'notebook.label.settings'], 'in one step');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.nb-sheet'); });
  await page.click('#viewer .viewer__close');
  await closed();

  t.step('an old Excalidraw drawing becomes the background, in a folder at the first stroke');
  await E.select(page, '2');
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await editorReady();
  st = await state();
  t.same([st.kind, st.loaded], ['drawing', 'foreign'], 'opened as a picture behind the sheet');
  await stroke(0);
  tx = await waitText(/old\.book/);
  t.check('its first stroke moves it into a folder that replaces it in the node', tx.indexOf('- ![](assets/old.book/001.ink.svg) Gamma') >= 0 && tx.indexOf('excalidraw') < 0, tx);
  var fl = await M.files(page);
  t.check('the old file stays in the project', !!fl['assets/old.excalidraw.svg'] && !!fl['assets/old.book/001.ink.svg'], fl);
  await idle();
  var bg = await page.evaluate(function () {
    var ns = window.MindRoot;
    var ref = ns.store.fileRef(ns.store.here().projectId, 'assets/old.book/001.ink.svg');
    return ns.storage.blobText(ref.asset).then(function (svg) { var p = ns.ink.parse(svg); return { kind: p.kind, bg: !!p.background, n: p.elements.length }; });
  });
  t.same(bg, { kind: 'ink', bg: true, n: 1 }, 'the page keeps the old picture as its background');
  await page.click('#viewer .viewer__close');
  await closed();

  t.step('view only: a drawing opens locked, a new one cannot start');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(true); });
  await E.select(page, '1');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('media.draw'); }), true, 'an existing drawing can still be opened');
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await editorReady().catch(function () {});
  st = await state();
  t.eq(st && st.readOnly, true, 'locked');
  await page.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await closed();
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(false); });

  t.step('a drawing the store cannot keep is offered as a download');
  await E.select(page, '0');
  await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await editorReady();
  await stroke(30);
  await page.evaluate(function () { window.MindRoot.store.setReadOnly(true); });
  await page.evaluate(function () { window.MindRoot.media.closeViewer(); });
  var said = await M.waitToast(page, /could not be saved/);
  t.eq(said, 'The notebook could not be saved here. Download the page to keep it.', 'said, with a way to keep it');
  var dl2 = page.waitForEvent('download', { timeout: 5000 }).catch(function () { return null; });
  await page.click('.toast:not([hidden]) .toast__action');
  var file = await dl2;
  t.eq(file ? file.suggestedFilename() : null, 'alpha-001.ink.svg', 'downloaded under the notebook\'s name and the page');
  await page.evaluate(function () { window.MindRoot.store.setReadOnly(false); });
  t.eq(await closed(), null, 'the viewer closed with it');
};
