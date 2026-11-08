/* MindRoot - a canvas with a paper of its own, on the real app: in an infinite
 * board, the settings sheet says whether paper and background are the whole
 * notebook's or the canvas shown's ("Applies to"). A canvas's own choice is
 * kept in book.json ('looks', by page file), drawn into that canvas's file
 * only, followed by the editor when canvases are switched, kept by a copy,
 * given up with "Use the notebook's", and ignored (not lost) in pages mode.
 * Changing the notebook's paper leaves a canvas that has its own alone. */
'use strict';

var N = require('../fixtures/notebook/helpers.js');

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
  function bookJson() {
    return N.fileText(page, ids.pid, folder + '/book.json').then(function (text) { return JSON.parse(text); });
  }
  function editorLook() { return view(function (v) { var l = v.editor().look(); return { paper: l.paper && l.paper.type, background: l.background }; }); }
  async function openSheet() {
    await view(function (v) { v.openSettings(); });
    await page.waitForSelector('.nb-sheet .nb-set__scope', { state: 'visible' });
  }
  async function closeSheet() {
    await page.keyboard.press('Escape');
    await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  }
  async function scope(value) {
    await page.click('.nb-sheet .nb-set__scope [data-value="' + value + '"]');
    await N.until(page, function (v) { return document.querySelector('.nb-sheet .nb-set__scope [data-value="' + v + '"]').getAttribute('aria-checked') === 'true'; }, value);
  }
  async function pickPaper(id) {
    await page.click('.nb-sheet .nb-paper[data-value="' + id + '"]');
    await N.idle(page);
  }

  /* ---------------------------------------------------------------- two canvases, one drawn */

  t.step('an infinite board with two canvases');
  await page.click('#topbar-actions .nb-switch [data-value="board"]');
  await N.boardReady(page);
  var box = await ev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await N.stroke(page, box.x + 300, box.y + 250, box.x + 520, box.y + 330);
  await N.idle(page);
  await view(function (v) { return v.addPage(); });
  await N.idle(page);
  t.eq(await view(function (v) { return [v.pages(), v.page()]; }).then(String), '2,2', 'two canvases, the second shown');
  t.eq((await bookJson()).looks, undefined, 'no look of its own anywhere yet');

  /* ---------------------------------------------------------------- the second canvas gets its own paper */

  t.step('"This canvas": a paper of its own, for it alone');
  await openSheet();
  t.eq(await page.getAttribute('.nb-sheet .nb-set__scope [data-value="book"]', 'aria-checked'), 'true', 'the sheet starts on the whole notebook');
  t.eq(await page.locator('.nb-sheet .nb-paper[data-value="image"]').count(), 1, 'where the picture paper is offered');
  await scope('canvas');
  t.eq(await page.locator('.nb-sheet .nb-paper[data-value="image"]').count(), 0, 'for a canvas it is not (a picture is the notebook\'s)');
  t.eq(await page.locator('.nb-sheet .nb-set__reset').count(), 0, 'nothing to give up yet');
  await pickPaper('grid-10');
  var json = await bookJson();
  t.eq(json.paper.type, 'dots', 'the notebook\'s paper is still dots');
  t.same(json.looks, { '002.ink.svg': { paper: { type: 'grid-10' } } }, 'the canvas has its own, by file');
  t.eq((await editorLook()).paper, 'grid-10', 'the sheet in the editor is on it');
  var f1 = await N.fileText(page, ids.pid, folder + '/001.ink.svg');
  var f2 = await N.fileText(page, ids.pid, folder + '/002.ink.svg');
  t.check('the first canvas\'s file is still drawn on dots', f1.indexOf('-dots') >= 0, f1.slice(0, 160));
  t.check('the second canvas\'s file is not', f2.indexOf('-dots') < 0 && f2.length > 200, f2.slice(0, 160));
  t.eq(await page.getAttribute('.nb-sheet .nb-paper[data-value="grid-10"]', 'aria-checked'), 'true', 'the sheet shows it chosen');
  t.eq(await page.locator('.nb-sheet .nb-set__reset').count(), 1, 'and offers the notebook\'s back');
  var h = await ev(function () { var s = window.MindRoot.store.historyState(); return s.undoLabelKey; });
  t.eq(h, 'notebook.label.canvasLook', 'one undo step, named for it');

  t.step('the editor follows the canvas shown');
  await closeSheet();
  await view(function (v) { v.goTo(1); });
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.page() === 1 && v.editor().pageId() === '001.ink.svg'; });
  t.eq((await editorLook()).paper, 'dots', 'canvas 1: dots');
  await view(function (v) { v.goTo(2); });
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.page() === 2 && v.editor().pageId() === '002.ink.svg'; });
  t.eq((await editorLook()).paper, 'grid-10', 'canvas 2: its own');

  t.step('its thumbnail and the sheet follow it too');
  await view(function (v) { v.openThumbs(); });
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  var thumbs = await ev(function () { return document.querySelectorAll('.nb-thumbs__grid .nb-thumb__page').length; });
  t.eq(thumbs, 2, 'two thumbnails');
  await closeSheet();

  /* ---------------------------------------------------------------- a background colour of its own */

  t.step('a background colour of its own');
  await view(function (v) { return v.setCanvasLook(2, { background: '#f6e7c1' }); });
  await N.idle(page);
  json = await bookJson();
  t.same(json.looks['002.ink.svg'], { paper: { type: 'grid-10' }, background: '#f6e7c1' }, 'paper and background, both its own');
  t.eq(json.background, 'auto', 'the notebook\'s background is untouched');
  t.eq((await editorLook()).background, '#f6e7c1', 'the sheet shows it');

  /* ---------------------------------------------------------------- the notebook changes, the canvas keeps */

  t.step('the notebook\'s paper changes; a canvas with its own keeps it');
  await openSheet();
  await scope('book');
  await pickPaper('ruled');
  json = await bookJson();
  t.eq(json.paper.type, 'ruled', 'the notebook\'s paper is now ruled');
  t.eq(json.looks['002.ink.svg'].paper.type, 'grid-10', 'the canvas kept its own');
  f1 = await N.fileText(page, ids.pid, folder + '/001.ink.svg');
  t.check('the first canvas\'s file is no longer on dots', f1.indexOf('-dots') < 0, f1.slice(0, 120));
  t.eq((await editorLook()).paper, 'grid-10', 'the shown canvas is still on its own');
  await closeSheet();

  /* ---------------------------------------------------------------- a copy keeps it */

  t.step('a copy of the canvas keeps its paper');
  await view(function (v) { return v.duplicatePage(2); });
  await N.idle(page);
  json = await bookJson();
  var files = await ev(function () { return window.MindRoot.notebook.boardView().book().pages.map(function (p) { return p.file; }); });
  t.eq(files.length, 3, 'three canvases');
  var copy = files[2];
  t.same(json.looks[copy], json.looks['002.ink.svg'], 'the copy has the same look of its own');

  /* ---------------------------------------------------------------- pages mode ignores it, does not lose it */

  t.step('pages mode: one paper for all; the looks wait');
  await view(function (v) { return v.setSetting({ mode: 'pages' }); });
  await N.idle(page);
  json = await bookJson();
  t.eq(json.mode, 'pages', 'pages mode');
  t.check('the looks are still in the file', !!(json.looks && json.looks['002.ink.svg']), json.looks);
  t.eq((await editorLook()).paper, 'ruled', 'the pages are all on the notebook\'s paper');
  await view(function (v) { return v.setSetting({ mode: 'infinite' }); });
  await N.idle(page);
  await view(function (v) { v.goTo(2); });
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.editor().pageId() === '002.ink.svg'; });
  t.eq((await editorLook()).paper, 'grid-10', 'back to infinite: the canvas is on its own paper again');

  /* ---------------------------------------------------------------- giving it up */

  t.step('"Use the notebook\'s"');
  await openSheet();
  await scope('canvas');
  await page.click('.nb-sheet .nb-set__reset');
  await N.idle(page);
  json = await bookJson();
  t.eq(json.looks && json.looks['002.ink.svg'], undefined, 'the canvas has none of its own');
  t.check('the copy still has its', !!(json.looks && json.looks[copy]), json.looks);
  t.eq((await editorLook()).paper, 'ruled', 'it is on the notebook\'s paper');
  await closeSheet();
  await ev(function () { window.MindRoot.store.undo(); });
  await N.until(page, function () { return window.MindRoot.notebook.boardView().editor().look().paper.type === 'grid-10'; });
  t.eq((await editorLook()).paper, 'grid-10', 'one undo gives it back');
};
