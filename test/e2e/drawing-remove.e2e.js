/* drawing-remove: an empty drawing never lands in a map, and whatever a
 * node carries - a drawing, a picture, a note, the note on its link - can be
 * taken off from where a person looks for it.
 *
 * Reported from real use: two nodes showed an empty dotted box (a notebook
 * cover with the dots paper, nothing drawn) and nothing said how to remove
 * it. The box came from a setting chosen in a new drawing before its first
 * stroke (the setting wrote the notebook, empty, into the map), or from a
 * drawing whose strokes were all erased. Now:
 *   - a new drawing's settings, pages added and pages moved before the first
 *     stroke are held, not written (no file, no reference, no undo step);
 *     the same drawing opened again finds them; the first stroke writes the
 *     notebook with them, as one step, which Undo takes back whole;
 *   - the board alike: nothing in the map until its first stroke;
 *   - a notebook closed with nothing on any page (everything erased, or an
 *     empty one an older version wrote) goes to the trash, one step, with a
 *     toast whose Undo brings it back;
 *   - the node's menus (the toolbar's "more" and the context menu, on a
 *     phone too) offer "Remove the drawing" / "Remove the picture" for each
 *     picture and "Delete the note" / "Delete the note on the link";
 *   - the viewer's header has "Delete the drawing" ("Delete the picture");
 *   - removing a whole drawing - from a menu row, the format bar, the
 *     viewer's Delete or the Delete key on a picked drawing - asks first
 *     ("Delete this drawing?", Delete in red, Cancel focused); Cancel and
 *     Escape leave everything as it was, Delete is one step with the
 *     notebook in the trash. Pictures and notes keep their Undo toast, and
 *     an empty drawing closed still goes without a question;
 *   - a click on a picture picks it (a ring) and Delete then takes out that
 *     picture only; with the words clicked Delete is the branch again;
 *   - the note bubble's delete button says "Delete" in words.
 * Every removal is one undo step; pictures and drawings go to the project's
 * trash. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;

var EMPTY_BOOK = 'assets/old.book/001.ink.svg';
var MAP = '# Root\n\n- Alpha\n- Beta\n- ![](' + EMPTY_BOOK + ') Gamma\n- Delta\n  - > note: hello\n  - > edge: why\n- Epsilon\n';

module.exports = async function (t) {
  var s = await E.boot(t, [['Remove', MAP], ['Other', '# Other\n\n- One\n']]);
  var page = s.page;

  function ev(fn, arg) { return page.evaluate(fn, arg === undefined ? null : arg); }
  /* A click on the map, at the point `where` gives at the moment of the
   * click (the map may still be moving to where it rests: a viewer that
   * closed gives the stage its room back, and the camera follows). This
   * suite clicks a picture, takes it out or closes it, and clicks it again
   * faster than a hand could; that second click used to be taken for the
   * second half of a double click (which on a picture does nothing more
   * than its first click did), so no viewer opened and the step timed out
   * on a loaded runner. A key or a press elsewhere between two clicks now
   * makes them two clicks (gestures.js forgetTap; mapview checks it on the
   * events' own clock). Gives the point clicked. */
  async function mapClick(where) {
    var at = await where();
    await page.mouse.click(at.x, at.y);
    return at;
  }
  function text() { return E.text(page); }
  async function seedEmptyBook() {
    await ev(function (ref) {
      var ns = window.MindRoot;
      var pid = ns.store.here().projectId;
      var page = ns.ink.serialize({ elements: [], paper: { type: 'dots' } });
      var json = JSON.stringify({ mindroot: 'book', version: 1, mode: 'infinite', paper: { type: 'dots' }, size: { id: 'a4', w: 210, h: 297, orientation: 'portrait' }, background: 'auto', backgroundImage: null, pages: [{ file: '001.ink.svg' }] });
      return Promise.all([ns.storage.putBlob(page, '001.ink.svg'), ns.storage.putBlob(json, 'book.json')]).then(function (refs) {
        ns.store.setFile(pid, ref, refs[0]);
        ns.store.setFile(pid, ref.replace('001.ink.svg', 'book.json'), refs[1]);
      });
    }, EMPTY_BOOK);
  }
  /* The centre of a node's picture once it has stopped moving: a viewer
   * opening or closing widens the stage and the camera follows, so a rect
   * read during that would send the click to the background. */
  async function imgAt(path, kind) {
    var last = null;
    for (var n = 0; n < 60; n++) {
      var r = await ev(function (a) {
        var el = window.MindRoot.session.view.nodeEl(a.path);
        var img = el && el.querySelector('img.mv-img' + (a.kind ? '[data-kind="' + a.kind + '"]' : ''));
        if (!img || !img.complete || !img.naturalWidth) return null;
        var b = img.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, src: img.getAttribute('data-src') };
      }, { path: path, kind: kind || null });
      if (r && last && Math.abs(r.x - last.x) < 0.5 && Math.abs(r.y - last.y) < 0.5) return r;
      last = r;
      await page.waitForTimeout(60);
    }
    throw new Error('the picture of ' + path + ' never stood still: ' + JSON.stringify(last));
  }
  async function eraseAll() {
    await ev(function () {
      var ed = window.MindRoot.media.viewerState().editor;
      ed.setTool('select');
      ed.select(ed.scene().map(function (e) { return e.id; }));
      ed.focus();
    });
    await page.keyboard.press('Delete');
    await E.until(page, function () { return window.MindRoot.media.viewerState().editor.scene().length === 0; });
    await idle();
  }
  function mapText(mid) { return ev(function (m) { var ns = window.MindRoot; return ns.store.map(ns.store.here().projectId, m).text; }, mid); }
  function trashButton() {
    return ev(function () {
      var b = document.querySelector('#viewer .viewer__trash');
      var l = b && b.querySelector('.btn__label');
      return b ? { shown: !b.hidden && b.getClientRects().length > 0, label: b.getAttribute('aria-label'), words: !!(l && l.getClientRects().length && l.getBoundingClientRect().width > 20) } : null;
    });
  }
  function projectFiles() { return M.files(page).then(function (f) { return Object.keys(f).sort(); }); }
  function state() {
    return ev(function () {
      var v = window.MindRoot.media.viewerState();
      if (!v) return null;
      var nb = v.notebook;
      return { path: v.path, created: v.created, mode: nb ? nb.mode() : null, pages: nb ? nb.pages() : null, paper: nb && nb.book() ? nb.book().meta.paper.type : null, scene: v.editor ? v.editor.scene().length : null };
    });
  }
  async function closed() {
    try { await E.until(page, function () { return !window.MindRoot.media.viewerState(); }, null, 6000); } catch (err) { /* checked */ }
    return state();
  }
  function idle() {
    return ev(function () {
      var v = window.MindRoot.media.viewerState();
      var nb = v && v.notebook;
      return nb ? nb.flush().then(function () { return nb.idle(); }) : null;
    });
  }
  async function storageIdle() { await E.until(page, function () { return !window.MindRoot.storage.pending(); }, null, 6000); }
  async function openDrawing(path) {
    await E.select(page, path);
    await E.settled(page);
    await ev(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
    await M.editorReady(page);
  }
  async function menuLabels(open) {
    await open();
    await page.waitForSelector('.menu:not([hidden]) .menu__item', { timeout: 4000 });
    var labels = await ev(function () {
      return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__item .menu__label'), function (l) { return l.textContent; });
    });
    return labels;
  }
  async function pickMenu(label) {
    var ok = await ev(function (want) {
      var items = document.querySelectorAll('.menu:not([hidden]) .menu__item');
      for (var i = 0; i < items.length; i++) {
        if (items[i].querySelector('.menu__label').textContent === want) { items[i].setAttribute('data-test-pick', ''); return true; }
      }
      return false;
    }, label);
    if (!ok) throw new Error('no menu item ' + label);
    await page.click('[data-test-pick]');
  }
  async function closeMenu() {
    await page.keyboard.press('Escape');
    await E.until(page, function () { return !document.querySelector('.menu:not([hidden])'); }).catch(function () {});
  }
  /* Toasts put away: an Undo toast stands over the free part of the stage
   * for a few seconds, which at the map's rest can be over its last node.
   * A click meant for that node would land on the toast. */
  async function noToasts() {
    for (var n = 0; n < 5 && await page.$('.toast:not([hidden]) .toast__close'); n++) {
      await page.click('.toast:not([hidden]) .toast__close');
      await E.until(page, function () { return !document.querySelector('.toast:not([hidden]) .toast__close'); }).catch(function () {});
    }
  }
  /* A point on the node's words, the map at rest, that the node itself
   * answers to (nothing drawn over it). */
  async function wordsOf(path, fromRight) {
    await noToasts();
    await E.settled(page);
    var b = await E.box(page, path);
    var at = { x: fromRight ? b.x + b.w - fromRight : b.x + Math.min(30, b.w - 6), y: b.cy };
    var hit = await ev(function (a) { var el = document.elementFromPoint(a.x, a.y); var n = el && el.closest('.mv-node'); return n ? n.getAttribute('data-path') : (el ? el.className : null); }, at);
    if (hit !== path) throw new Error('the words of ' + path + ' are covered at ' + JSON.stringify(at) + ' by ' + hit);
    return at;
  }
  async function contextOn(path) {
    var at = await wordsOf(path);
    await page.mouse.click(at.x, at.y, { button: 'right' });
  }
  async function undoToast(re) {
    var said = await M.waitToast(page, re);
    var has = await ev(function () {
      var all = document.querySelectorAll('.toast:not([hidden])');
      var last = all[all.length - 1];
      return !!(last && last.querySelector('button'));
    });
    return { said: said, undo: has };
  }
  var ASK = 'dialog.dialog--drawing-out[open]';
  function askShown() {
    return ev(function (sel) {
      var d = document.querySelector(sel);
      if (!d) return null;
      var r = d.getBoundingClientRect();
      var foot = Array.prototype.map.call(d.querySelectorAll('.dialog__foot .btn'), function (b) {
        var br = b.getBoundingClientRect();
        return { words: b.textContent.trim(), danger: b.classList.contains('btn--danger'), h: br.height, inside: br.left >= r.left - 0.5 && br.right <= r.right + 0.5 };
      });
      var a = document.activeElement;
      return {
        title: d.querySelector('.dialog__title').textContent,
        text: (d.querySelector('.dialog__text') || {}).textContent,
        buttons: foot.map(function (b) { return [b.words, b.danger]; }),
        focus: a && d.contains(a) ? a.textContent.trim() : null,
        modal: d.matches(':modal'),
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth },
        tap: Math.min.apply(null, foot.map(function (b) { return b.h; })),
        inside: foot.every(function (b) { return b.inside; })
      };
    }, ASK);
  }
  async function waitAsk() {
    await page.waitForSelector(ASK, { timeout: 5000 });
    /* Measured once it has finished growing in. */
    await ev(function (sel) {
      var d = document.querySelector(sel);
      var all = d && d.getAnimations ? d.getAnimations({ subtree: true }) : [];
      return Promise.all(all.map(function (a) { return a.finished.catch(function () {}); }));
    }, ASK);
    return askShown();
  }
  /* how: 'delete' (the red button), 'cancel' (its button) or 'escape'. */
  async function answer(how) {
    await waitAsk();
    if (how === 'escape') await page.keyboard.press('Escape');
    else await page.click(ASK + ' .dialog__foot .btn' + (how === 'delete' ? '.btn--danger' : ':not(.btn--danger)'));
    await E.until(page, function (sel) { return !document.querySelector(sel); }, ASK);
  }
  function focusOnBody() { return ev(function () { return !document.activeElement || document.activeElement === document.body; }); }
  async function clickToastAction() {
    await ev(function () {
      var all = document.querySelectorAll('.toast:not([hidden])');
      var last = all[all.length - 1];
      last.querySelector('button').click();
    });
  }

  await seedEmptyBook();
  await E.settled(page);

  /* ------------------------------------------------------------------ never written while empty */

  t.step('a new drawing: settings and pages before the first stroke write nothing');
  var h0 = await E.history(page);
  var files0 = await projectFiles();
  var text0 = await text();
  await openDrawing('0');
  t.same(await state(), { path: null, created: false, mode: 'infinite', pages: 1, paper: 'dots', scene: 0 }, 'a new notebook, nothing in the project');
  /* The paper picked in the settings sheet, as a person would. */
  await page.click('#viewer [data-nb="settings"]');
  await E.until(page, function () { return !!document.querySelector('.nb-paper[aria-checked="false"]'); });
  var picked = await ev(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll('.nb-paper[aria-checked="false"]'), function (x) { return !x.disabled && x.textContent && !/import|picture/i.test(x.textContent); })[2];
    b.setAttribute('data-test-paper', '');
    return b.getAttribute('data-paper') || b.getAttribute('data-value') || b.textContent;
  });
  await page.click('[data-test-paper]');
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.notebook.book().meta.paper.type !== 'dots'; });
  var chosenPaper = (await state()).paper;
  t.check('the sheet took the paper (' + picked + ')', chosenPaper !== 'dots', chosenPaper);
  await page.keyboard.press('Escape');
  await ev(function () { return window.MindRoot.media.viewerState().notebook.setSetting({ mode: 'pages' }); });
  await ev(function () { return window.MindRoot.media.viewerState().notebook.addPage(); });
  await idle();
  await page.waitForTimeout(300);
  t.same(await state(), { path: null, created: false, mode: 'pages', pages: 2, paper: chosenPaper, scene: 0 }, 'shown: pages mode, two pages, the paper chosen');
  t.eq((await E.history(page)).count, h0.count, 'no undo step');
  t.same(await projectFiles(), files0, 'no file');
  t.eq(await text(), text0, 'the map does not name it');
  t.eq(await ev(function () { return !!window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img'); }), false, 'no box next to the words');

  t.step('closed without a stroke: still nothing; opened again: the settings are there');
  await page.click('#viewer .viewer__close');
  t.eq(await closed(), null, 'closed');
  t.eq(await text(), text0, 'the map is as it was');
  t.same(await projectFiles(), files0, 'no file');
  t.eq((await E.history(page)).count, h0.count, 'no step');
  await openDrawing('0');
  t.same(await state(), { path: null, created: false, mode: 'pages', pages: 2, paper: chosenPaper, scene: 0 }, 'the same drawing opened again keeps what was chosen');

  t.step('the first stroke writes it with those settings, one step; Undo takes it back whole');
  await storageIdle();
  await M.stroke(page, 0);
  await idle();
  await E.until(page, function () { return /alpha\.book/.test(window.MindRoot.session.current().text); }, null, 8000);
  var h1 = await E.history(page);
  t.eq(h1.count, h0.count + 1, 'one step');
  t.eq(h1.label, 'draw on the node', 'the new drawing\'s label');
  var bj = await ev(function () {
    var ns = window.MindRoot;
    var ref = ns.store.fileRef(ns.store.here().projectId, 'assets/alpha.book/book.json');
    return ref ? ns.storage.blobText(ref.asset).then(function (tx) { return JSON.parse(tx); }) : null;
  });
  t.same(bj && [bj.mode, bj.paper.type, bj.pages.length], ['pages', chosenPaper, 2], 'book.json: pages mode, the paper, two pages');
  await page.click('#viewer .viewer__close');
  await closed();
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return !/alpha\.book/.test(window.MindRoot.session.current().text); });
  t.eq(await text(), text0, 'undone: the map as before the drawing');
  t.check('and no page of it left in the project', !(await projectFiles()).some(function (f) { return /alpha\.book/.test(f); }), await projectFiles());

  /* ------------------------------------------------------------------ emptied, then closed */

  t.step('every stroke erased, then closed: the drawing goes to the trash, with Undo');
  await openDrawing('1');
  await storageIdle();
  await M.stroke(page, 0);
  await idle();
  await E.until(page, function () { return /beta\.book/.test(window.MindRoot.session.current().text); }, null, 8000);
  await ev(function () {
    var ed = window.MindRoot.media.viewerState().editor;
    ed.setTool('select');
    ed.select(ed.scene().map(function (e) { return e.id; }));
    ed.focus();
  });
  await page.keyboard.press('Delete');
  await E.until(page, function () { return window.MindRoot.media.viewerState().editor.scene().length === 0; });
  await idle();
  var trashBefore = (await M.trash(page)).length;
  await page.click('#viewer .viewer__close');
  t.eq(await closed(), null, 'closed');
  await E.until(page, function () { return !/beta\.book/.test(window.MindRoot.session.current().text); }, null, 6000).catch(function () {});
  t.check('the empty box is gone from the node', !/beta\.book/.test(await text()), await text());
  var tt = await undoToast(/empty drawing/);
  t.same(tt, { said: 'The empty drawing went to the trash.', undo: true }, 'a toast says so, with Undo');
  var tr = await M.trash(page);
  t.eq(tr.length, trashBefore + 1, 'one entry in the trash');
  t.check('the notebook is that entry', /beta\.book/.test(tr[tr.length - 1].path || ''), tr[tr.length - 1]);
  await clickToastAction();
  await E.until(page, function () { return /beta\.book/.test(window.MindRoot.session.current().text); });
  t.check('Undo puts it back', /- !\[\]\(assets\/beta\.book\/001\.ink\.svg\) Beta/.test(await text()), await text());

  t.step('an empty drawing an older version wrote: opened and closed, it goes too');
  await E.settled(page);
  var gamma = await mapClick(function () { return imgAt('2'); });
  await M.editorReady(page);
  t.eq((await state()).path, EMPTY_BOOK, 'a click on the box opens it');
  await page.click('#viewer .viewer__close');
  await closed();
  await E.until(page, function () { return !/old\.book/.test(window.MindRoot.session.current().text); }, null, 6000).catch(function () {});
  t.check('closed empty: gone from Gamma', /\n- Gamma\n/.test(await text()), await text());
  t.eq((await undoToast(/empty drawing/)).undo, true, 'with Undo');
  await clickToastAction();
  await E.until(page, function () { return /old\.book/.test(window.MindRoot.session.current().text); });
  t.check('and back', /- !\[\]\(assets\/old\.book\/001\.ink\.svg\) Gamma/.test(await text()), await text());

  /* ------------------------------------------------------------------ the menus */

  t.step('the context menu: Remove the drawing asks first');
  await E.settled(page);
  var ctxLabels = await menuLabels(function () { return contextOn('2'); });
  t.check('offered on a node with a drawing', ctxLabels.indexOf('Remove the drawing') >= 0, ctxLabels);
  t.check('just above Delete the branch', ctxLabels.indexOf('Delete the branch') === ctxLabels.indexOf('Remove the drawing') + 1, ctxLabels);
  var hBefore = (await E.history(page)).count;
  var nTrash = (await M.trash(page)).length;
  var textAsk = await text();
  await pickMenu('Remove the drawing');
  var ask = await waitAsk();
  t.same([ask.title, ask.text, ask.buttons], ['Delete this drawing?', 'The drawing and all its pages go to the project\'s trash. You can restore it from there, or undo.', [['Cancel', false], ['Delete', true]]], 'a question, in words: Cancel, and Delete in red');
  t.eq(ask.focus, 'Cancel', 'the focus starts on Cancel (Enter or Space there keeps the drawing)');
  t.eq(ask.modal, true, 'modal: nothing else can be pressed meanwhile');
  await t.shot('ask-drawing-out');
  await answer('escape');
  await page.waitForTimeout(250);
  t.eq(await text(), textAsk, 'Escape: the drawing stays');
  t.eq((await E.history(page)).count, hBefore, 'no step');
  t.eq((await M.trash(page)).length, nTrash, 'nothing in the trash');
  t.eq(await focusOnBody(), false, 'the focus is back on the page, not lost');
  await menuLabels(function () { return contextOn('2'); });
  await pickMenu('Remove the drawing');
  await answer('cancel');
  await page.waitForTimeout(250);
  t.eq(await text(), textAsk, 'Cancel: the drawing stays');
  t.eq((await E.history(page)).count, hBefore, 'still no step');
  t.eq((await M.trash(page)).length, nTrash, 'and nothing in the trash');
  await menuLabels(function () { return contextOn('2'); });
  await pickMenu('Remove the drawing');
  await answer('delete');
  await E.until(page, function () { return !/old\.book/.test(window.MindRoot.session.current().text); });
  t.check('Delete: the drawing is off the node, the node stays', /\n- Gamma\n/.test(await text()), await text());
  t.eq((await E.history(page)).count, hBefore + 1, 'one step');
  t.eq((await M.trash(page)).length, nTrash + 1, 'in the trash');
  t.eq((await undoToast(/trash/)).undo, true, 'the toast has Undo');
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return /old\.book/.test(window.MindRoot.session.current().text); });
  t.check('Undo puts it back', true);

  t.step('the toolbar\'s more menu: the same');
  await E.select(page, '2');
  await E.settled(page);
  await E.until(page, function () { var b = document.querySelector('.node-toolbar .btn--more'); return b && b.getClientRects().length; }).catch(function () {});
  var moreLabels = await menuLabels(function () {
    return ev(function () {
      var b = document.querySelector('.node-toolbar .btn--more');
      b.click();
    });
  });
  t.check('Remove the drawing in the more menu', moreLabels.indexOf('Remove the drawing') >= 0, moreLabels);
  hBefore = (await E.history(page)).count;
  nTrash = (await M.trash(page)).length;
  await pickMenu('Remove the drawing');
  t.eq((await waitAsk()).title, 'Delete this drawing?', 'the same question');
  await answer('delete');
  await E.until(page, function () { return !/old\.book/.test(window.MindRoot.session.current().text); });
  t.eq((await E.history(page)).count, hBefore + 1, 'Delete: one step');
  t.eq((await M.trash(page)).length, nTrash + 1, 'in the trash');
  t.eq(await focusOnBody(), false, 'the focus is not lost');
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return /old\.book/.test(window.MindRoot.session.current().text); });
  await E.settled(page);
  var plain = await menuLabels(function () { return contextOn('4'); });
  t.check('a node with nothing to remove has no such rows', !plain.some(function (l) { return /^Remove|^Delete the note/.test(l); }), plain);
  await closeMenu();

  t.step('notes: Delete the note, Delete the note on the link');
  var noteLabels = await menuLabels(function () { return contextOn('3'); });
  t.check('both offered on Delta', noteLabels.indexOf('Delete the note') >= 0 && noteLabels.indexOf('Delete the note on the link') >= 0, noteLabels);
  await pickMenu('Delete the note');
  await E.until(page, function () { return !/note: hello/.test(window.MindRoot.session.current().text); });
  t.check('the note is gone, the link\'s note stays', /edge: why/.test(await text()), await text());
  t.eq((await undoToast(/note is in the trash/)).undo, true, 'with Undo');
  var noteEntry = (await M.trash(page)).filter(function (e) { return e.kind === 'note'; });
  t.same(noteEntry.map(function (e) { return [e.label, e.owner]; }), [['hello', 'Delta']], 'the note is in the project\'s trash, with the node it was on');
  await ev(function () { window.MindRoot.commands.run('trash.open', { source: 'test' }); });
  await E.until(page, function () { return !!document.querySelector('.ws-row[data-kind="note"]'); });
  var noteRow = await ev(function () {
    var r = document.querySelector('.ws-row[data-kind="note"]');
    return { name: r.querySelector('.ws-row__name').textContent, meta: r.querySelector('.ws-row__meta').textContent.replace(/, .*$/, '') };
  });
  t.same(noteRow, { name: 'hello', meta: 'Note that was on Delta in Remove' }, 'the trash lists it: its words, where it was');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.ws-row[data-kind="note"]'); }).catch(function () {});
  await menuLabels(function () { return contextOn('3'); });
  await pickMenu('Delete the note on the link');
  await E.until(page, function () { return !/edge: why/.test(window.MindRoot.session.current().text); });
  t.check('and the link\'s note', /\n- Delta\n- Epsilon\n/.test(await text()), await text());
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return /note: hello/.test(window.MindRoot.session.current().text) && /edge: why/.test(window.MindRoot.session.current().text); });
  t.check('two undos: both back', true);
  t.eq((await M.trash(page)).filter(function (e) { return e.kind === 'note'; }).length, 0, 'and out of the trash: each delete was one step with its trash entry');

  t.step('a deleted note comes back from the trash onto its node');
  await menuLabels(function () { return contextOn('3'); });
  await pickMenu('Delete the note on the link');
  await E.until(page, function () { return !/edge: why/.test(window.MindRoot.session.current().text); });
  var back = await ev(function () {
    var ns = window.MindRoot;
    var pid = ns.store.here().projectId;
    var e = ns.store.trash(pid).filter(function (x) { return x.kind === 'note'; })[0];
    var r = ns.store.restoreTrash(pid, e.id);
    return { kind: e.noteKind, where: r && r.where, left: ns.store.trash(pid).filter(function (x) { return x.kind === 'note'; }).length };
  });
  t.same(back, { kind: 'edge', where: 'same', left: 0 }, 'put back: the link\'s note, where it was, out of the trash');
  await E.until(page, function () { return /edge: why/.test(window.MindRoot.session.current().text); });
  t.check('on Delta\'s link again', /- Delta\n(  - > (note: hello|edge: why)\n){2}- Epsilon/.test(await text()) && /edge: why/.test(await text()), await text());

  t.step('the note bubble says Delete in words');
  await ev(function () { window.MindRoot.notes.open('3', 'node'); });
  await E.until(page, function () { var b = document.querySelector('.note-bubble'); return b && !b.hidden; });
  var del = await ev(function () {
    var b = document.querySelector('.note-bubble__delete');
    var r = b.getBoundingClientRect();
    return { hidden: b.hidden, w: r.width > 30, words: (b.querySelector('.btn__label') || {}).textContent, aria: b.getAttribute('aria-label') };
  });
  t.same(del, { hidden: false, w: true, words: 'Delete', aria: 'Delete the note' }, 'visible, labelled');
  await page.click('.note-bubble__delete');
  await E.until(page, function () { return !/note: hello/.test(window.MindRoot.session.current().text); });
  t.check('and deletes the note', true);
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return /note: hello/.test(window.MindRoot.session.current().text); });

  /* ------------------------------------------------------------------ the viewer's Delete */

  t.step('the viewer\'s header: Delete the drawing');
  await E.settled(page);
  var bx = await mapClick(function () { return imgAt('1'); });
  await M.editorReady(page);
  await storageIdle();
  await M.stroke(page, 30);
  await idle();
  var btn = await ev(function () {
    var b = document.querySelector('#viewer .viewer__trash');
    return b ? { hidden: b.hidden, label: b.getAttribute('aria-label'), words: (b.querySelector('.btn__label') || {}).textContent } : null;
  });
  t.same(btn, { hidden: false, label: 'Delete the drawing', words: 'Delete the drawing' }, 'there, in words');
  await t.shot('viewer-delete');
  nTrash = (await M.trash(page)).length;
  hBefore = (await E.history(page)).count;
  textAsk = await text();
  await page.click('#viewer .viewer__trash');
  t.eq((await waitAsk()).title, 'Delete this drawing?', 'it asks first');
  await answer('cancel');
  await page.waitForTimeout(250);
  t.check('Cancel: the viewer stays open on the drawing', !!(await state()) && (await state()).path === 'assets/beta.book/001.ink.svg', await state());
  t.eq(await text(), textAsk, 'the map unchanged');
  t.eq(await ev(function () { var a = document.activeElement; return !!(a && a.closest('.viewer__trash')); }), true, 'the focus back on the button');
  await page.click('#viewer .viewer__trash');
  await answer('delete');
  t.eq(await closed(), null, 'Delete: the viewer closes');
  t.eq(await focusOnBody(), false, 'and hands the focus on');
  await E.until(page, function () { return !/beta\.book/.test(window.MindRoot.session.current().text); });
  t.check('the drawing is off Beta', /\n- Beta\n/.test(await text()), await text());
  t.eq((await M.trash(page)).length, nTrash + 1, 'in the trash');
  t.eq((await E.history(page)).count, hBefore + 1, 'one step');
  t.eq((await undoToast(/trash/)).undo, true, 'with Undo');
  await clickToastAction();
  await E.until(page, function () { return /beta\.book/.test(window.MindRoot.session.current().text); });
  t.check('Undo: back on Beta', true);

  t.step('an existing drawing opened by a click: Delete is there at once, in words at 1440x900');
  var vp = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 900 });
  await E.settled(page);
  bx = await mapClick(function () { return imgAt('1'); });
  await M.editorReady(page);
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.created; });
  await E.until(page, function () { var b = document.querySelector('#viewer .viewer__trash'); return b && !b.hidden; }, null, 3000).catch(function () {});
  t.same(await trashButton(), { shown: true, label: 'Delete the drawing', words: true }, 'no stroke needed; the words show beside the bin');
  await t.shot('viewer-delete-1440');

  t.step('the drawing clicked, then Delete at once: the drawing goes, not the branch');
  nTrash = (await M.trash(page)).length;
  hBefore = (await E.history(page)).count;
  var beforeDel = await text();
  await page.keyboard.press('Delete');
  t.eq((await waitAsk()).title, 'Delete this drawing?', 'it asks first');
  await answer('delete');
  t.eq(await closed(), null, 'the viewer closes');
  await E.until(page, function () { return !/beta\.book/.test(window.MindRoot.session.current().text); }, null, 6000).catch(function () {});
  t.check('Beta keeps its words and its place', /\n- Beta\n/.test(await text()) && (await text()).split('\n').length === beforeDel.split('\n').length, await text());
  t.eq((await M.trash(page)).length, nTrash + 1, 'the drawing is in the trash');
  t.eq((await E.history(page)).count, hBefore + 1, 'one step');
  t.eq((await undoToast(/trash/)).undo, true, 'with Undo');
  await clickToastAction();
  await E.until(page, function () { return /beta\.book/.test(window.MindRoot.session.current().text); });
  await page.setViewportSize(vp);
  await E.settled(page);

  t.step('the format bar while writing: Take the drawing out asks too, and Cancel goes back to the words');
  await ev(function () { window.MindRoot.editor.startRename('1'); });
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  await page.click('.format-bar [data-format="picture"]');
  await page.waitForSelector('.menu:not([hidden]) .menu__item', { timeout: 4000 });
  hBefore = (await E.history(page)).count;
  nTrash = (await M.trash(page)).length;
  textAsk = await text();
  await pickMenu('Take the drawing out');
  t.eq((await waitAsk()).title, 'Delete this drawing?', 'the question');
  await answer('cancel');
  await page.waitForTimeout(250);
  t.eq(await text(), textAsk, 'Cancel: nothing changed');
  t.eq((await E.history(page)).count, hBefore, 'no step');
  t.eq(await ev(function () { var r = window.MindRoot.editor.renaming(); var a = document.activeElement; return !!(r && a && a.closest('.mv-node[data-path="1"]')); }), true, 'still writing, the caret back in the node');
  await page.click('.format-bar [data-format="picture"]');
  await page.waitForSelector('.menu:not([hidden]) .menu__item', { timeout: 4000 });
  await pickMenu('Take the drawing out');
  await answer('delete');
  await E.until(page, function () { return !/beta\.book/.test(window.MindRoot.session.current().text); });
  t.check('Delete: off Beta', /\n- Beta\n/.test(await text()), await text());
  t.eq((await E.history(page)).count, hBefore + 1, 'one step');
  t.eq((await M.trash(page)).length, nTrash + 1, 'in the trash');
  t.eq(await ev(function () { return !!window.MindRoot.editor.renaming(); }), true, 'and the writing goes on');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !window.MindRoot.editor.renaming(); });
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return /beta\.book/.test(window.MindRoot.session.current().text); });
  await E.settled(page);

  t.step('a new drawing has no Delete (nothing to delete yet)');
  await openDrawing('4');
  t.eq(await ev(function () { return document.querySelector('#viewer .viewer__trash').hidden; }), true, 'hidden');
  await page.click('#viewer .viewer__close');
  await closed();

  /* ------------------------------------------------------------------ a picture picked, Delete */

  t.step('a click on a picture picks it; Delete takes out that picture, not the branch');
  await M.makeImage(page, 'photo.png', { w: 80, h: 60, color: '#2f6fb3' });
  await ev(function () { return window.MindRoot.media.addFiles([window.__files['photo.png']], { path: '0', field: 'line' }, { quiet: true }); });
  await E.until(page, function () { var img = window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img[data-kind="photo"]'); return img && img.complete && img.naturalWidth > 0; }, null, 6000);
  await E.settled(page);
  var ph = await mapClick(function () { return imgAt('0', 'photo'); });
  await E.until(page, function () { return !!window.MindRoot.media.viewerState(); });
  var ring = await ev(function () {
    var img = window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img[data-kind="photo"]');
    var cs = getComputedStyle(img);
    return { picked: img.hasAttribute('data-picked'), outline: cs.outlineStyle, api: window.MindRoot.session.view.picked() };
  });
  t.same([ring.picked, ring.outline, ring.api && ring.api.file], [true, 'solid', ph.src], 'picked: a ring round it');
  t.eq(await ev(function () { var b = document.querySelector('#viewer .viewer__trash'); return b && !b.hidden && b.getAttribute('aria-label'); }), 'Delete the picture', 'its viewer offers Delete the picture');
  /* Straight after the click, the viewer open beside the map and the
   * focus in it: no Escape, no closing first. */
  nTrash = (await M.trash(page)).length;
  var textWithPhoto = await text();
  await page.keyboard.press('Delete');
  await E.until(page, function () { return !window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img[data-kind="photo"]'); });
  t.eq(await closed(), null, 'the viewer of the picture closes with it');
  var after = await text();
  t.check('the picture is out, Alpha and its branch stay', /\n- Alpha\n/.test(after) && after.split('\n').length === textWithPhoto.split('\n').length, after);
  t.eq((await M.trash(page)).length, nTrash + 1, 'the picture is in the trash');
  t.eq(await ev(function () { return window.MindRoot.session.view.picked(); }), null, 'nothing picked any more');
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return !!window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img[data-kind="photo"]'); });

  t.step('a press in the viewer first: Delete is the viewer\'s, the picture stays');
  await E.settled(page);
  ph = await mapClick(function () { return imgAt('0', 'photo'); });
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.kind === 'photo'; });
  var body = await E.rectOf(page, '#viewer .viewer__body');
  await page.mouse.click(body.x + body.w / 2, body.y + body.h / 2);
  var withPhoto = await text();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  t.eq(await text(), withPhoto, 'nothing taken out');
  t.check('the viewer still shows it', !!(await state()), await state());
  await ev(function () { window.MindRoot.media.closeViewer(); });
  await closed();

  t.step('the words clicked: Delete is the branch again');
  await E.settled(page);
  ph = await mapClick(function () { return imgAt('0', 'photo'); });
  await E.until(page, function () { return !!window.MindRoot.media.viewerState(); });
  await ev(function () { window.MindRoot.media.closeViewer(); });
  await closed();
  /* The Undo toast of the step before may stand over Epsilon, at the foot
   * of the map at rest: wordsOf puts it away first. */
  await mapClick(function () { return wordsOf('4', 8); });
  await E.until(page, function () { return window.MindRoot.session.selected() === '4'; });
  t.eq(await ev(function () { return window.MindRoot.session.view.picked(); }), null, 'another node selected: the pick is let go');
  t.eq(await ev(function () { return document.querySelectorAll('img.mv-img[data-picked]').length; }), 0, 'and its ring');
  await page.keyboard.press('Delete');
  await E.until(page, function () { return !/Epsilon/.test(window.MindRoot.session.current().text); });
  t.check('Delete removed the branch Epsilon', /Alpha/.test(await text()), await text());
  await ev(function () { window.MindRoot.commands.run('history.undo', { source: 'test' }); });
  await E.until(page, function () { return /Epsilon/.test(window.MindRoot.session.current().text); });

  /* ------------------------------------------------------------------ emptied, then left another way */

  t.step('every stroke erased, then another picture clicked: the empty drawing goes too');
  await openDrawing('3');
  await storageIdle();
  await M.stroke(page, 0);
  await idle();
  await E.until(page, function () { return /delta\.book/.test(window.MindRoot.session.current().text); }, null, 8000);
  await eraseAll();
  nTrash = (await M.trash(page)).length;
  ph = await mapClick(function () { return imgAt('0', 'photo'); });
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.kind === 'photo'; });
  await E.until(page, function () { return !/delta\.book/.test(window.MindRoot.session.current().text); }, null, 6000).catch(function () {});
  t.check('gone from Delta', !/delta\.book/.test(await text()), await text());
  t.eq((await undoToast(/empty drawing/)).undo, true, 'a toast, with Undo');
  t.eq((await M.trash(page)).length, nTrash + 1, 'in the trash');
  t.eq(await E.selected(page), '0', 'the node of the picture clicked stays chosen');
  await clickToastAction();
  await E.until(page, function () { return /delta\.book/.test(window.MindRoot.session.current().text); });
  t.check('Undo puts it back', true);
  await ev(function () { window.MindRoot.media.closeViewer(); });
  await closed();

  t.step('every stroke erased, then another map opened: the first map loses the empty box');
  await openDrawing('4');
  await storageIdle();
  await M.stroke(page, 0);
  await idle();
  await E.until(page, function () { return /epsilon\.book/.test(window.MindRoot.session.current().text); }, null, 8000);
  await eraseAll();
  nTrash = (await M.trash(page)).length;
  await ev(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mids[1] });
  await E.until(page, function (ids) { var ns = window.MindRoot; return !/epsilon\.book/.test(ns.store.map(ids.pid, ids.mid).text); }, { pid: s.pid, mid: s.mid }, 6000).catch(function () {});
  t.check('the map left behind no longer names it', !/epsilon\.book/.test(await mapText(s.mid)), await mapText(s.mid));
  t.eq((await undoToast(/empty drawing/)).undo, true, 'a toast, with Undo');
  t.eq((await M.trash(page)).length, nTrash + 1, 'in the trash');
  t.eq(await ev(function () { return window.MindRoot.session.current().mapId; }), s.mids[1], 'the other map stays open');
  await ev(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mid });
  await E.until(page, function (mid) { return window.MindRoot.session.current().mapId === mid; }, s.mid);
  await E.settled(page);

  /* ------------------------------------------------------------------ the board */

  t.step('the board: a setting before the first stroke writes nothing');
  var boardText = await text();
  var hb = (await E.history(page)).count;
  await ev(function () { window.MindRoot.commands.run('view.board', { source: 'test' }); });
  await E.until(page, function () { var v = window.MindRoot.notebook.boardView(); return !!(v && v.editor() && !v.el.hasAttribute('data-loading')); });
  await ev(function () { return window.MindRoot.notebook.boardView().setSetting({ paper: { type: 'grid-5' } }); });
  await page.waitForTimeout(200);
  t.eq(await text(), boardText, 'no board marker in the map');
  t.check('no board folder', !(await projectFiles()).some(function (f) { return /-board\.book\//.test(f); }));
  t.eq((await E.history(page)).count, hb, 'no step');
  await ev(function () { window.MindRoot.commands.run('view.board', { source: 'test' }); });
  await E.until(page, function () { return !window.MindRoot.notebook.boardShown(); });
  await ev(function () { window.MindRoot.commands.run('view.board', { source: 'test' }); });
  await E.until(page, function () { var v = window.MindRoot.notebook.boardView(); return !!(v && v.editor() && !v.el.hasAttribute('data-loading')); });
  t.eq(await ev(function () { return window.MindRoot.notebook.boardView().book().meta.paper.type; }), 'grid-5', 'back on the board: the paper is still the one chosen');
  var sb = await ev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await ev(function () { window.MindRoot.notebook.boardView().editor().setTool('pen'); });
  await page.mouse.move(sb.x + 300, sb.y + 250);
  await page.mouse.down();
  for (var i = 1; i <= 10; i++) await page.mouse.move(sb.x + 300 + i * 20, sb.y + 250 + i * 6);
  await page.mouse.up();
  await ev(function () { var v = window.MindRoot.notebook.boardView(); return v.flush().then(function () { return v.idle(); }); });
  await E.until(page, function () { return /<!-- board:/.test(window.MindRoot.session.current().text); }, null, 8000);
  t.eq((await E.history(page)).count, hb + 1, 'the first stroke: one step');
  var boardJson = await ev(function () {
    var ns = window.MindRoot;
    var p = ns.store.project(ns.store.here().projectId);
    var k = Object.keys(p.files).filter(function (f) { return /-board\.book\/book\.json$/.test(f); })[0];
    return k ? ns.storage.blobText(p.files[k].asset).then(function (tx) { return JSON.parse(tx).paper.type; }) : null;
  });
  t.eq(boardJson, 'grid-5', 'the board is written with the paper chosen before');
  await ev(function () { window.MindRoot.commands.run('view.board', { source: 'test' }); });
  await E.until(page, function () { return !window.MindRoot.notebook.boardShown(); });

  /* ------------------------------------------------------------------ after a reload */

  t.step('after a reload: the drawing clicked shows its Delete at once');
  await page.keyboard.press('Control+s');
  await storageIdle();
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await E.until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, s.mid, 10000);
  await E.settled(page);
  bx = await mapClick(function () { return imgAt('1'); });
  await M.editorReady(page);
  await E.until(page, function () { var b = document.querySelector('#viewer .viewer__trash'); return b && !b.hidden; }, null, 4000).catch(function () {});
  t.eq((await trashButton()).shown, true, 'there, without a stroke');
  await page.click('#viewer .viewer__close');
  await closed();

  /* ------------------------------------------------------------------ Italian labels */

  t.step('the words in Italian');
  var it = await ev(function () {
    var i18n = window.MindRoot.i18n;
    i18n.setLang('it');
    var out = ['editor.cmd.removeDrawing', 'editor.cmd.removePicture', 'editor.cmd.deleteNote', 'editor.cmd.deleteEdgeNote', 'media.viewer.deleteDrawing', 'media.viewer.deletePicture', 'media.emptyDrawingGone', 'notes.deleteShort', 'media.askDrawingOut.title', 'media.askDrawingOut.text', 'media.askDrawingOut.ok', 'ui.cancel'].map(function (k) { return i18n.t(k); });
    i18n.setLang('en');
    return out;
  });
  t.same(it, ['Rimuovi disegno', 'Rimuovi immagine', 'Elimina nota', "Elimina nota sull'arco", 'Elimina disegno', 'Elimina immagine', 'Il disegno vuoto è nel cestino.', 'Elimina', 'Eliminare questo disegno?', 'Il disegno, con tutte le sue pagine, va nel cestino del progetto. Da lì puoi ripristinarlo, oppure annullare.', 'Elimina', 'Annulla'], 'as asked');

  /* ------------------------------------------------------------------ a phone */

  t.step('a phone: the long-press menu offers Remove the drawing; settings before a stroke write nothing');
  var phoneCtx = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  var phone = await phoneCtx.newPage();
  var ps = await E.boot(t, [['Remove', MAP]], { page: phone });
  page = ps.page;
  await seedEmptyBook();
  await E.settled(page);
  await E.select(page, '2');
  await E.settled(page);
  var phoneLabels = await menuLabels(function () { return ev(function () { window.MindRoot.commands.run('node.menu', { source: 'key' }); }); });
  t.check('Remove the drawing in the node menu', phoneLabels.indexOf('Remove the drawing') >= 0, phoneLabels);
  await closeMenu();
  var gp = await imgAt('2');
  await page.touchscreen.tap(gp.x, gp.y);
  await M.editorReady(page);
  await E.until(page, function () { var b = document.querySelector('#viewer .viewer__trash'); return b && !b.hidden; }, null, 4000).catch(function () {});
  t.eq((await trashButton()).shown, true, 'the old empty notebook tapped: its viewer offers Delete');
  await t.shot('phone-viewer-delete', page);
  await page.click('#viewer .viewer__trash');
  var pa = await waitAsk();
  t.eq(pa.title, 'Delete this drawing?', 'the phone asks too');
  t.check('the question fits the phone with a gutter, nothing scrolls sideways', pa.box.left >= 12 && pa.box.right <= pa.box.vw - 12 && pa.box.top >= 0 && pa.box.bottom <= pa.box.vh && pa.box.scrollW <= pa.box.vw, pa.box);
  t.check('its buttons are finger-sized and inside it', pa.tap >= 44 && pa.inside, pa);
  await t.shot('phone-ask-drawing-out', page);
  await answer('delete');
  await closed();
  await E.until(page, function () { return !/old\.book/.test(window.MindRoot.session.current().text); }, null, 6000).catch(function () {});
  t.check('and Delete takes it off Gamma', /\n- Gamma\n/.test(await text()), await text());
  await E.settled(page);
  var pt0 = await text();
  var ph0 = (await E.history(page)).count;
  await E.select(page, '0');
  await ev(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
  await M.editorReady(page);
  await ev(function () { return window.MindRoot.media.viewerState().notebook.setSetting({ paper: { type: 'ruled' } }); });
  await ev(function () { return window.MindRoot.media.viewerState().notebook.close(); });
  await closed();
  t.eq(await text(), pt0, 'the map unchanged');
  t.eq((await E.history(page)).count, ph0, 'no step');
};
