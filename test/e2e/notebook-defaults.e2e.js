/* MindRoot - what a new notebook starts on, on the real app: the settings
 * sheet ("Notebooks") chooses the paper and the background every new board
 * or drawing is made on; a notebook keeps its own once it is written, so a
 * later change in the settings leaves it alone; a damaged preference falls
 * back to the built-in ones. */
'use strict';

var N = require('../fixtures/notebook/helpers.js');

module.exports = async function (t) {
  var page = t.page;
  await N.openApp(t);
  var ids = await N.project(page, [['Garden', '# Garden\n\n- Rose\n'], ['Orchard', '# Orchard\n\n- Pear\n']]);

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function bookJson(folder) {
    return N.fileText(page, ids.pid, folder + '/book.json').then(function (text) { return JSON.parse(text); });
  }
  async function drawOnBoard() {
    await page.click('#topbar-actions .nb-switch [data-value="board"]');
    await N.boardReady(page);
    var box = await ev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top }; });
    await N.stroke(page, box.x + 300, box.y + 250, box.x + 520, box.y + 330);
    await N.idle(page);
  }

  t.step('the settings sheet offers them');
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#set-nb-paper', { state: 'visible' });
  t.eq(await page.inputValue('#set-nb-paper'), 'dots', 'paper: dots');
  t.eq(await page.inputValue('#set-nb-bg'), 'auto', 'background: automatic');
  t.eq(await page.locator('#set-nb-paper option[value="image"]').count(), 0, 'no picture paper (it is a notebook\'s, with its picture)');
  t.check('the papers are grouped', (await page.locator('#set-nb-paper optgroup').count()) >= 5, null);

  t.step('a choice is applied at once and kept');
  await page.selectOption('#set-nb-paper', 'grid-5');
  await page.selectOption('#set-nb-bg', '#f6f0e1');
  t.same(await ev(function () { var v = window.MindRoot.prefs.get('notebook'); return [v.paper, v.background]; }), ['grid-5', '#f6f0e1'], 'the preference');
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('#set-nb-paper'); });

  t.step('a new board starts on them');
  await drawOnBoard();
  var folder = 'assets/garden-board.book';
  var json = await bookJson(folder);
  t.same([json.paper.type, json.background], ['grid-5', '#f6f0e1'], 'book.json: the paper and the background chosen');
  t.same(await ev(function () { var l = window.MindRoot.notebook.boardView().editor().look(); return [l.paper.type, l.background]; }), ['grid-5', '#f6f0e1'], 'the sheet in the editor');

  t.step('a later change leaves it alone');
  await ev(function () { window.MindRoot.prefs.set('notebook', { paper: 'ruled', background: '#141517' }); });
  json = await bookJson(folder);
  t.same([json.paper.type, json.background], ['grid-5', '#f6f0e1'], 'the board has its own now');

  t.step('a damaged preference falls back');
  var fell = await ev(function () {
    window.MindRoot.prefs.set('notebook', { paper: 'ruled', background: '#141517' });
    var M = window.MindRoot.notebook.model;
    var good = M.defaults();
    return { good: [good.paper.type, good.background], app: M.appLook() };
  });
  t.same(fell.good, ['ruled', '#141517'], 'a good one is used by defaults()');
  var viaStorage = await ev(function () {
    var M = window.MindRoot.notebook.model;
    var orig = window.MindRoot.prefs.get;
    window.MindRoot.prefs.get = function (k) { return k === 'notebook' ? { paper: 'no-such-paper', background: 'red' } : orig.apply(this, arguments); };
    var d = M.defaults();
    var out = [d.paper.type, d.background];
    window.MindRoot.prefs.get = function (k) { return k === 'notebook' ? { paper: 'image', background: '#ABCDEF' } : orig.apply(this, arguments); };
    d = M.defaults();
    out.push(d.paper.type, d.background);
    window.MindRoot.prefs.get = orig;
    return out;
  });
  t.same(viaStorage, ['dots', 'auto', 'dots', '#abcdef'], 'an unknown paper or a bad colour: the built-in ones; "image" is never a default paper');
};
