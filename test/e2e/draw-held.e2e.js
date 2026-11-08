/* draw-held: the strokes a node's notebook holds (written one step per
 * pause) never fight with what moves its files, on the real app with the
 * real editor in the viewer.
 *
 * Covered: taking the drawing out of its node while strokes are held (and
 * one not even handed over yet) keeps every stroke - they become a step,
 * the trash holds the page with all of them, the take-out is the last step,
 * nothing writes the page back afterwards, and the toast's Undo brings the
 * whole drawing back; the media panel lists the notebook as one tile and
 * its trash sends the whole folder, held strokes included, in one step; an
 * undo arriving while a stroke is held follows the history (nothing written
 * back with no map naming it, the redo kept, the viewer showing what the
 * files say); a press on the top bar's Undo right after a stroke takes back
 * exactly that stroke (the write is waited for); back in the notebook,
 * saves are held again; files taken out from under the open notebook by
 * another hand close the viewer and offer the newest strokes as a
 * download. Every wait is for a condition, plus the pause the holding is
 * about. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;

var MAP = '# Held\n\n- Alpha\n- Beta\n- Gamma\n- Delta\n';
var PAUSE = 1500;

function page1(slug) { return 'assets/' + slug + '.book/001.ink.svg'; }

module.exports = async function (t) {
  var s = await E.boot(t, [['Held', MAP]]);
  var page = s.page;

  function state() {
    return page.evaluate(function () {
      var v = window.MindRoot.media.viewerState();
      return v ? { kind: v.kind, path: v.path, created: v.created, scene: v.editor ? v.editor.scene().length : null } : null;
    });
  }
  function trashEntries(prefix) {
    return page.evaluate(function (p) {
      var ns = window.MindRoot;
      return ns.store.trash(ns.store.here().projectId).filter(function (x) { return x.path && x.path.indexOf(p) === 0; }).map(function (e) {
        return { kind: e.kind, path: e.path, asset: e.file ? e.file.asset : null, owner: e.owner, files: Object.keys(e.files || {}).sort() };
      });
    }, prefix);
  }
  async function waitText(re) {
    try { await E.until(page, function (src) { var c = window.MindRoot.session.current(); return c && new RegExp(src).test(c.text); }, re.source, 8000); } catch (err) { /* checked */ }
    return E.text(page);
  }
  async function waitClosed() {
    try { await E.until(page, function () { return !window.MindRoot.media.viewerState(); }, null, 5000); } catch (err) { /* checked */ }
    return state();
  }
  async function storageIdle() {
    await E.until(page, function () { return !window.MindRoot.storage.pending(); }, null, 6000);
  }
  /* A new drawing on a node, its first stroke written as the notebook's
   * first page. */
  async function firstStroke(path, slug) {
    await E.select(page, path);
    await page.evaluate(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
    await M.editorReady(page);
    await storageIdle();
    await M.stroke(page, 0);
    await waitText(new RegExp(slug + '\\.book'));
    try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.created; }, null, 6000); } catch (err) { /* checked */ }
    await page.evaluate(function () { var nb = window.MindRoot.media.viewerState().notebook; return nb.flush().then(function () { return nb.idle(); }); });
    return M.fileAsset(page, page1(slug));
  }
  /* A stroke handed over at once (what ink does 600 ms after a gesture),
   * then a moment: it is held, not in the store yet. */
  async function heldStroke(dy) {
    await M.stroke(page, dy);
    var at = await page.evaluate(function () { window.MindRoot.media.viewerState().editor.save(); return performance.now(); });
    await page.waitForTimeout(150);
    return at;
  }

  t.step('taking a drawing out while strokes are held keeps them all');
  var A = page1('alpha');
  var a1 = await firstStroke('0', 'alpha');
  t.check('the page is made', !!a1);
  var h1 = await E.history(page);
  var heldAt = await heldStroke(40);
  t.eq(await M.fileAsset(page, A), a1, 'the second stroke is held');
  /* A third stroke not even handed over by the editor yet. */
  await M.stroke(page, -40);
  var out = await page.evaluate(function () { return window.MindRoot.media.takePictureOut('0', 'line', 'draw'); });
  var outGap = await page.evaluate(function () { return performance.now(); }) - heldAt;
  t.eq(out, true, 'taken out');
  t.check('out of the node', (await E.text(page)).indexOf('alpha.book') < 0, await E.text(page));
  t.eq(await waitClosed(), null, 'the viewer closed with it');
  var tr = (await trashEntries(A))[0];
  t.check('in the trash as a figure of Alpha', tr && tr.kind === 'figure' && tr.owner === 'Alpha', tr);
  t.check('holding newer bytes than the first stroke', tr && tr.asset && tr.asset !== a1, [a1, tr]);
  t.eq(tr ? await M.assetElements(page, tr.asset) : null, 3, 'all three strokes');
  var h2 = await E.history(page);
  t.check('the strokes, then the take-out: the take-out is the last step', h2.label === 'take the drawing out' && (h2.count - h1.count === 2 || (outGap >= PAUSE && h2.count - h1.count === 3)), { steps: h2.count - h1.count, label: h2.label, gap: outGap });
  await page.waitForTimeout(PAUSE + 800);
  t.eq(await M.fileAsset(page, A), null, 'nothing writes the page back after the pause');
  var h3 = await E.history(page);
  t.same([h3.count, h3.label], [h2.count, 'take the drawing out'], 'and no step comes after it');
  t.eq(await M.waitToast(page, /trash/), 'The drawing is in the trash.', 'the toast');
  await page.click('.toast:not([hidden]) .toast__action');
  var back = await waitText(/alpha\.book/);
  t.check('its Undo puts the drawing back in the node', back.indexOf('- ![](' + A + ') Alpha') >= 0, back);
  var a3 = await M.fileAsset(page, A);
  t.eq(a3, tr.asset, 'with the last bytes');
  t.eq(await M.assetElements(page, a3), 3, 'every stroke');

  t.step('the media panel: a notebook is one tile, and goes to the trash whole');
  var B = page1('beta');
  var b1 = await firstStroke('1', 'beta');
  t.check('Beta has its notebook', !!b1);
  await heldStroke(40);
  t.eq(await M.fileAsset(page, B), b1, 'a stroke held');
  var hb = await E.history(page);
  /* The panel opened and the tile chosen without a press anywhere, so
   * what is tested is the trash keeping the drawing whole by itself. */
  await page.evaluate(function () { window.MindRoot.media.openPanel(); });
  await page.waitForSelector('.media-tile .media-tile__check', { timeout: 5000 });
  var tiles = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.media-tile'), function (el) {
      return { name: el.querySelector('.media-tile__name').textContent, kind: el.getAttribute('data-kind'), info: el.querySelector('.media-tile__info').textContent };
    });
  });
  t.same(tiles.map(function (x) { return x.name + ':' + x.kind; }), ['alpha:notebook', 'beta:notebook'], 'one tile per notebook, no page files or book.json of their own');
  t.check('said as a notebook with its pages', /^Notebook · 1 page · /.test(tiles[1].info), tiles[1].info);
  await page.evaluate(function () {
    var tile = Array.prototype.find.call(document.querySelectorAll('.media-tile'), function (el) { return el.querySelector('.media-tile__name').textContent === 'beta'; });
    var box = tile.querySelector('.media-tile__check');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.media-panel__trash').click();
  });
  /* The question is a dialog of its own (the panel is a sheet). */
  await page.waitForSelector('dialog[open]:not(.sheet) .btn--danger', { timeout: 5000 });
  var ok = await page.evaluate(function () {
    var b = document.querySelector('dialog[open]:not(.sheet) .btn--danger');
    if (b) b.click();
    return !!b;
  });
  t.eq(ok, true, 'asked first: it is on a map');
  t.eq(await waitClosed(), null, 'the viewer closed');
  try { await E.until(page, function () { var ns = window.MindRoot; return !ns.store.fileRef(ns.store.here().projectId, 'assets/beta.book/001.ink.svg'); }, null, 5000); } catch (err) { /* checked */ }
  var tb = await trashEntries('assets/beta.book/');
  t.same(tb.map(function (e) { return [e.kind, e.path, e.files.join(',')]; }), [['asset', 'assets/beta.book/001.ink.svg', 'assets/beta.book/book.json']], 'the whole folder in the trash, as one entry: the cover, the rest with it');
  var tbPage = tb.filter(function (e) { return /001/.test(e.path); })[0];
  t.check('the page with the held stroke', tbPage && tbPage.asset !== b1 && (await M.assetElements(page, tbPage.asset)) === 2, [b1, tbPage]);
  t.check('owned by the node that showed it', tb.every(function (e) { return e.owner === 'Beta'; }), tb);
  var hb2 = await E.history(page);
  t.same([hb2.count - hb.count, hb2.label], [2, 'send the notebook to the trash'], 'the stroke, then the trash (the notebook, its page and its book.json)');
  t.eq(await M.waitToast(page, /trash/), 'The notebook is in the trash.', 'one tile, said as the notebook');
  await page.waitForTimeout(PAUSE + 800);
  t.eq(await M.fileAsset(page, B), null, 'the page stays out of the project');
  t.eq((await E.history(page)).count, hb2.count, 'no step after the trash');
  await page.evaluate(function () { window.MindRoot.media.closePanel(); });

  t.step('an undo arriving while a stroke is held follows the history');
  var G = page1('gamma');
  var g1 = await firstStroke('2', 'gamma');
  t.check('Gamma has its notebook', !!g1);
  var hg = await E.history(page);
  t.eq(hg.label, 'draw on the node', 'its first step');
  await heldStroke(40);
  await page.evaluate(function () { window.MindRoot.session.undo(); });
  var tx = await waitText(/^(?![\s\S]*gamma\.book)/);
  t.check('the drawing is out of the node', tx.indexOf('gamma.book') < 0, tx);
  t.eq(await M.fileAsset(page, G), null, 'and its page out of the project');
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && !v.created && v.editor && v.editor.scene().length === 0; }, null, 5000); } catch (err) { /* checked */ }
  t.same(await state(), { kind: 'drawing', path: null, created: false, scene: 0 }, 'the viewer shows a new drawing again');
  await page.waitForTimeout(PAUSE + 800);
  t.eq(await M.fileAsset(page, G), null, 'the held stroke does not bring the page back with no map naming it');
  var hu = await E.history(page);
  t.same([hu.count, hu.redo], [hg.count - 1, 1], 'and the redo is still there');
  await page.evaluate(function () { window.MindRoot.session.redo(); });
  tx = await waitText(/gamma\.book/);
  t.check('redo puts the drawing back', tx.indexOf('- ![](' + G + ') Gamma') >= 0, tx);
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.created && v.editor && v.editor.scene().length === 1; }, null, 5000); } catch (err) { /* checked */ }
  t.same(await state(), { kind: 'drawing', path: G, created: true, scene: 1 }, 'and the viewer with it');
  t.eq(await M.fileAsset(page, G), g1, 'the bytes of its step');

  t.step('the top bar\'s Undo right after a stroke takes back just that stroke');
  await M.stroke(page, 60);
  var hp = await E.history(page);
  t.eq(await M.fileAsset(page, G), g1, 'held while drawing');
  await page.click('#topbar [data-command="history.undo"]');
  try { await E.until(page, function () { return window.MindRoot.store.historyState().redoCount > 0; }, null, 5000); } catch (err) { /* checked */ }
  var hq = await E.history(page);
  t.same([hq.count, hq.redo], [hp.count, 1], 'the stroke became a step and the undo took it back');
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().redoLabel; }), 'draw', 'what the redo holds is the stroke');
  t.eq(await M.fileAsset(page, G), g1, 'the page is the first stroke again');
  t.check('still on the map', (await E.text(page)).indexOf('- ![](' + G + ') Gamma') >= 0);
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.editor && v.editor.scene().length === 1; }, null, 5000); } catch (err) { /* checked */ }
  t.eq((await state()).scene, 1, 'and the viewer shows it');
  await page.evaluate(function () { window.MindRoot.session.redo(); });
  try { await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.editor && v.editor.scene().length === 2; }, null, 5000); } catch (err) { /* checked */ }
  var g2 = await M.fileAsset(page, G);
  t.check('redo brings the stroke back', g2 !== g1 && (await M.assetElements(page, g2)) === 2 && (await state()).scene === 2, g2);

  t.step('back in the notebook, saves are held again');
  await heldStroke(-60);
  t.eq(await M.fileAsset(page, G), g2, 'a stroke is held again');
  var hr = await E.history(page);
  try {
    await E.until(page, function (old) {
      var ns = window.MindRoot;
      var ref = ns.store.fileRef(ns.store.here().projectId, 'assets/gamma.book/001.ink.svg');
      return ref && ref.asset !== old;
    }, g2, PAUSE + 4000);
  } catch (err) { /* checked */ }
  var g3 = await M.fileAsset(page, G);
  t.check('and written after the pause', g3 && g3 !== g2, [g2, g3]);
  t.eq((await E.history(page)).count, hr.count + 1, 'as one step');

  t.step('another hand takes the page out from under the open notebook');
  await heldStroke(80);
  /* And one more not even handed over by the editor yet. */
  await M.stroke(page, 100);
  var drawn = (await state()).scene;
  /* A script moving the files without passing through media or the
   * notebook: the notebook must neither write the page back nor lose the
   * strokes it held. */
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var pid = ns.store.here().projectId;
    var mid = ns.store.here().mapId;
    var map = ns.store.map(pid, mid);
    ns.store.transaction('store.label.takePictureOut', function () {
      ns.store.setMapText(pid, mid, map.text.replace('![](assets/gamma.book/001.ink.svg) ', ''), {});
      ns.store.trashFigure(pid, mid, { path: 'assets/gamma.book/001.ink.svg', ownerPath: '2', field: 'line', owner: 'Gamma' });
    });
  });
  t.eq(await waitClosed(), null, 'the viewer closes: its drawing left the project');
  t.eq(await M.waitToast(page, /could not be saved/), 'The notebook could not be saved here. Download the page to keep it.', 'the held strokes are offered as a download');
  var dl = page.waitForEvent('download', { timeout: 5000 }).catch(function () { return null; });
  await page.click('.toast:not([hidden]) .toast__action');
  var file = await dl;
  t.eq(file ? file.suggestedFilename() : null, 'gamma-001.ink.svg', 'named after the notebook and the page');
  var fs = require('fs');
  var saved = file ? fs.readFileSync(await file.path(), 'utf8') : '';
  var inFile = await page.evaluate(function (svg) { return window.MindRoot.ink.parse(svg).elements.length; }, saved);
  t.eq(inFile, drawn, 'the download is the newest drawing, every stroke');
  await page.waitForTimeout(PAUSE + 800);
  t.eq(await M.fileAsset(page, G), null, 'and the page stays in the trash');
  t.eq((await E.history(page)).label, 'take the picture out', 'with no step after the take-out');
};
