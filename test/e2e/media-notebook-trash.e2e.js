/* media-notebook-trash: a node's notebook is a folder (docs/NOTEBOOK.md),
 * and every way it leaves the project takes the whole folder and brings
 * the whole folder back - on the real app, at 1440 x 900.
 *
 * A two-page notebook in pages mode on staff paper, drawn in the viewer ->
 * taken out of its node: one trash row named after it, its pages counted,
 * nothing left behind in the project -> put back from the trash sheet:
 * both pages, book.json and the reference -> its node deleted: the branch's
 * entry holds the folder, nothing is left over, a restore brings two pages
 * -> sent to the trash from the images panel: ONE row, labelled and said
 * as a notebook, restoring all of it -> taken out, a new notebook drawn on
 * the same node (it keeps clear of the name the trash holds), another
 * folder arriving under the old name, the old one put back: it moves whole
 * to the first free folder and every notebook is intact -> a folder
 * left with no page is still a tile (no picture, opens to a word), and can
 * be cleared -> the trash with a notebook in it through a ZIP and back ->
 * the board coming up closes the node's notebook; a viewer opened while
 * the board is up brings the map back. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;

var MAP = '# Garden\n\n- Herbs\n  - Basil\n- Trees\n';
var BOOK = 'assets/herbs.book';

module.exports = async function (t) {
  var ctx = await t.newContext({ viewport: { width: 1440, height: 900 } });
  await E.H.stubMissing(ctx, t);
  var page = await ctx.newPage();
  var s = await E.boot(t, [['Garden', MAP]], { page: page });
  var pid = s.pid;

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function until(fn, arg, ms) { return E.until(page, fn, arg === undefined ? null : arg, ms || 8000); }
  function folder(dir) {
    return ev(function (a) {
      var p = window.MindRoot.store.project(a.pid);
      var out = {};
      Object.keys(p.files).sort().forEach(function (k) { if (k.indexOf(a.dir + '/') === 0) out[k.slice(a.dir.length + 1)] = p.files[k].asset; });
      return out;
    }, { pid: pid, dir: dir });
  }
  function bookFiles() {
    return ev(function (a) {
      return Object.keys(window.MindRoot.store.project(a).files).filter(function (k) { return /\.book\//.test(k); }).sort();
    }, pid);
  }
  function trashRows() {
    return ev(function (a) {
      return window.MindRoot.store.trash(a).map(function (e) {
        return { id: e.id, kind: e.kind, label: e.label, path: e.path || null, files: Object.keys(e.files || {}).sort() };
      });
    }, pid);
  }
  function text() { return E.text(page); }
  function fileText(path) {
    return ev(function (a) { return window.MindRoot.storage.readDrawing(window.MindRoot.store, a.pid, a.path); }, { pid: pid, path: path });
  }
  async function viewerIdle() {
    await ev(function () {
      var v = window.MindRoot.media.viewerState();
      var nb = v && v.notebook;
      return nb ? nb.flush().then(function () { return nb.idle(); }) : null;
    });
  }
  async function closeViewer() {
    await ev(function () { window.MindRoot.media.closeViewer(); });
    await until(function () { return !window.MindRoot.media.viewerState(); });
  }
  /* The node's notebook in the viewer, ready to draw. */
  async function openHerbs() {
    await ev(function () { window.MindRoot.session.select('0', { reveal: true }); });
    await ev(function () { window.MindRoot.commands.run('media.draw', { source: 'test' }); });
    await M.editorReady(page);
  }
  async function notebookState() {
    return ev(function () {
      var v = window.MindRoot.media.viewerState();
      var nb = v && v.notebook;
      return nb ? { pages: nb.pages(), mode: nb.mode(), paper: nb.book().meta.paper.type, path: v.path } : null;
    });
  }
  /* Shots are taken once every sheet has come to rest. */
  async function rest() {
    await until(function () { return !document.getAnimations().some(function (a) { return a.playState === 'running'; }); }, null, 4000).catch(function () {});
  }
  async function openPanel() {
    if (!(await ev(function () { return window.MindRoot.media.panelOpen(); }))) await ev(function () { window.MindRoot.commands.run('media.panel'); });
    await until(function () { return !!document.querySelector('.media-panel'); });
  }
  async function closePanel() {
    if (await ev(function () { return window.MindRoot.media.panelOpen(); })) await ev(function () { window.MindRoot.media.closePanel(); });
    await until(function () { return !window.MindRoot.media.panelOpen(); });
  }
  function tile(name) {
    return ev(function (n) {
      var el = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (x) { return x.querySelector('.media-tile__name').textContent === n; });
      return el ? { info: el.querySelector('.media-tile__info').textContent, badge: el.querySelector('.media-tile__badge').textContent, empty: el.hasAttribute('data-empty'), src: el.querySelector('.media-tile__img').getAttribute('src') } : null;
    }, name);
  }
  function tileNames() {
    return ev(function () { return Array.prototype.map.call(document.querySelectorAll('.media-panel .media-tile'), function (x) { return x.querySelector('.media-tile__name').textContent; }); });
  }
  async function pressTile(name, part) {
    await ev(function (a) {
      var el = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (x) { return x.querySelector('.media-tile__name').textContent === a.n; });
      el.querySelector(a.part).click();
    }, { n: name, part: part });
  }

  /* ------------------------------------------------------------ the notebook */
  t.step('a two-page node notebook, pages mode, staff paper');
  await openHerbs();
  await M.stroke(page, 0);
  await until(function (b) { return window.MindRoot.session.current().text.indexOf(b + '/001.ink.svg') >= 0; }, BOOK);
  await ev(function () { return window.MindRoot.media.viewerState().notebook.setSetting({ mode: 'pages', paper: { type: 'staff' } }); });
  await until(function () { var nb = window.MindRoot.media.viewerState().notebook; return nb.mode() === 'pages' && nb.editor() && nb.editor().page(); });
  await ev(function () { return window.MindRoot.media.viewerState().notebook.addPage(); });
  await until(function () { return window.MindRoot.media.viewerState().notebook.pages() === 2; });
  await viewerIdle();
  var original = await folder(BOOK);
  t.same(Object.keys(original).sort(), ['001.ink.svg', '002.ink.svg', 'book.json'], 'the folder: two pages and book.json');
  t.same(await notebookState(), { pages: 2, mode: 'pages', paper: 'staff', path: BOOK + '/001.ink.svg' }, 'in the viewer');
  await closeViewer();

  /* ------------------------------------------------------------ taken out */
  t.step('taken out of its node: one trash row, nothing left behind');
  var h0 = await E.history(page);
  t.eq(await ev(function () { return window.MindRoot.media.takePictureOut('0', 'line', 'draw'); }), true, 'taken out');
  t.same(await bookFiles(), [], 'no file of the folder stays in the project');
  t.check('the node no longer names it', (await text()).indexOf(BOOK) < 0, await text());
  var rows = await trashRows();
  t.same(rows.map(function (r) { return [r.kind, r.label, r.path, r.files.join(',')]; }), [['figure', 'herbs', BOOK + '/001.ink.svg', BOOK + '/002.ink.svg,' + BOOK + '/book.json']], 'one entry, named after the notebook, holding the folder');
  t.eq((await E.history(page)).count, h0.count + 1, 'one step');
  await openPanel();
  t.check('the panel shows no leftover of it', (await tileNames()).indexOf('herbs') < 0, await tileNames());
  await closePanel();

  t.step('put back from the trash sheet: both pages, the settings, the reference');
  await ev(function () { window.MindRoot.commands.run('trash.open'); });
  await until(function () { return !!document.querySelector('.ws-trash__list .ws-row'); });
  var row = await ev(function () {
    var r = document.querySelector('.ws-trash__list .ws-row');
    return { name: r.querySelector('.ws-row__name').textContent, meta: r.querySelector('.ws-row__meta').textContent, kind: r.querySelector('.ws-row__icon').getAttribute('title') };
  });
  t.eq(row.name, 'herbs', 'the row says the notebook\'s name');
  t.check('and that it is a notebook of two pages from Herbs', row.kind === 'Notebook' && /^Notebook of 2 pages that was on Herbs, /.test(row.meta), row);
  await rest();
  await t.shot('trash-row', page);
  await page.click('.ws-trash__list .ws-row [data-role="restore"]');
  await until(function (b) { return window.MindRoot.session.current().text.indexOf(b + '/001.ink.svg') >= 0; }, BOOK);
  t.same(await folder(BOOK), original, 'every file back, the same bytes');
  t.eq((await trashRows()).length, 0, 'the trash is empty again');
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('dialog.sheet[open] .ws-trash__list'); }).catch(function () {});
  await openHerbs();
  await until(function () { var v = window.MindRoot.media.viewerState(); return v.notebook.pages() === 2; });
  t.same(await notebookState(), { pages: 2, mode: 'pages', paper: 'staff', path: BOOK + '/001.ink.svg' }, 'it opens as it was');
  await closeViewer();

  /* ------------------------------------------------------------ node deleted */
  t.step('its node deleted: the branch takes the folder, a restore brings it all');
  await E.select(page, '0');
  await ev(function () { window.MindRoot.commands.run('node.delete', { source: 'test' }); });
  await until(function () { return window.MindRoot.session.current().text.indexOf('Herbs') < 0; });
  t.same(await bookFiles(), [], 'no file of the folder stays in the project');
  rows = await trashRows();
  t.same(rows.map(function (r) { return [r.kind, r.files.join(',')]; }), [['branch', BOOK + '/001.ink.svg,' + BOOK + '/002.ink.svg,' + BOOK + '/book.json']], 'one branch entry holding the whole folder');
  await openPanel();
  t.check('the panel shows no orphan', (await tileNames()).indexOf('herbs') < 0, await tileNames());
  await closePanel();
  var back = await ev(function (a) { return window.MindRoot.store.restoreTrash(a.pid, a.id).where; }, { pid: pid, id: rows[0].id });
  t.eq(back, 'same', 'the branch back in its place');
  t.same(await folder(BOOK), original, 'and its notebook, every file');
  await until(function () { return window.MindRoot.session.current().text.indexOf('Herbs') >= 0; });
  await openHerbs();
  await until(function () { return window.MindRoot.media.viewerState().notebook.pages() === 2; });
  t.same(await notebookState(), { pages: 2, mode: 'pages', paper: 'staff', path: BOOK + '/001.ink.svg' }, 'two pages, pages mode, staff');
  await closeViewer();

  /* ------------------------------------------------------------ from the panel */
  t.step('sent to the trash from the images panel: one row, said as a notebook');
  await openPanel();
  await until(function () { return Array.prototype.some.call(document.querySelectorAll('.media-tile__name'), function (n) { return n.textContent === 'herbs'; }); });
  t.check('one tile, two pages, on a map', /^Notebook · 2 pages · /.test((await tile('herbs')).info) && (await tile('herbs')).badge === 'On a map', await tile('herbs'));
  var h1 = await E.history(page);
  await pressTile('herbs', '.media-tile__check');
  await page.click('.media-panel__trash');
  await page.waitForSelector('dialog[open]:not(.sheet) .btn--danger', { timeout: 4000 });
  await page.click('dialog[open]:not(.sheet) .btn--danger');
  await until(function () { return !Array.prototype.some.call(document.querySelectorAll('.media-tile__name'), function (n) { return n.textContent === 'herbs'; }); });
  rows = await trashRows();
  t.same(rows.map(function (r) { return [r.kind, r.label, r.path, r.files.length]; }), [['asset', 'herbs', BOOK + '/001.ink.svg', 2]], 'ONE row, the cover first, the rest with it');
  var h2 = await E.history(page);
  t.same([h2.count - h1.count, h2.label], [1, 'send the notebook to the trash'], 'one step, labelled as the notebook');
  t.eq(await M.waitToast(page, /notebook/), 'The notebook is in the trash.', 'said as the notebook');
  t.same(await bookFiles(), [], 'nothing of it left');
  await ev(function () { window.MindRoot.commands.run('trash.open'); });
  await until(function () { return !!document.querySelector('.ws-trash__list .ws-row'); });
  t.check('the trash row: a notebook of two pages', /^Notebook of 2 pages that was on Herbs, /.test(await ev(function () { return document.querySelector('.ws-trash__list .ws-row .ws-row__meta').textContent; })));
  await page.click('.ws-trash__list .ws-row [data-role="restore"]');
  await until(function (a) { return Object.keys(window.MindRoot.store.project(a).files).filter(function (k) { return /herbs\.book\//.test(k); }).length === 3; }, pid);
  t.same(await folder(BOOK), original, 'one restore: the whole notebook');
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('dialog.sheet[open] .ws-trash__list'); }).catch(function () {});

  /* ------------------------------------------------------------ the name taken */
  t.step('put back where another notebook took its name: it moves whole to a free one');
  await closePanel();
  t.eq(await ev(function () { return window.MindRoot.media.takePictureOut('0', 'line', 'draw'); }), true, 'taken out');
  var outEntry = (await trashRows())[0];
  /* A new drawing on the node keeps clear of a name the trash holds... */
  await openHerbs();
  await M.stroke(page, 0);
  await until(function () { return /assets\/herbs-2\.book\/001\.ink\.svg/.test(window.MindRoot.session.current().text); });
  await viewerIdle();
  await closeViewer();
  t.check('a new notebook on the node keeps clear of the name in the trash', (await text()).indexOf('assets/herbs-2.book/001.ink.svg') >= 0, await text());
  /* ...but a folder can still arrive under it (an import, another tool). */
  await ev(function (a) {
    var ns = window.MindRoot;
    var blank = ns.ink.serialize({ elements: [] });
    var json = JSON.stringify({ mindroot: 'book', version: 1, mode: 'infinite', paper: { type: 'dots' }, pages: [{ file: '001.ink.svg' }] });
    return Promise.all([ns.storage.putBlob(blank, '001.ink.svg'), ns.storage.putBlob(json, 'book.json')]).then(function (refs) {
      ns.store.transaction('test', function () {
        ns.store.setFile(a, 'assets/herbs.book/001.ink.svg', refs[0]);
        ns.store.setFile(a, 'assets/herbs.book/book.json', refs[1]);
      });
    });
  }, pid);
  var other = await folder(BOOK);
  var mine = await folder('assets/herbs-2.book');
  var r2 = await ev(function (a) { var r = window.MindRoot.store.restoreTrash(a.pid, a.id); return { where: r.where, path: r.path }; }, { pid: pid, id: outEntry.id });
  t.same(r2, { where: 'same', path: 'assets/herbs-3.book/001.ink.svg' }, 'back on its node, in the first free folder (herbs-3.book)');
  t.same(await folder('assets/herbs-3.book'), original, 'every file moved together, the same bytes');
  t.same(await folder(BOOK), other, 'the folder that took its name untouched');
  t.same(await folder('assets/herbs-2.book'), mine, 'and the new notebook too');
  t.check('the node names the one put back', (await text()).indexOf('assets/herbs-3.book/001.ink.svg') >= 0, await text());
  t.eq(JSON.parse(await fileText('assets/herbs-3.book/book.json')).pages.length, 2, 'its book.json still names its two pages');
  await ev(function () { window.MindRoot.session.select('0', { reveal: true }); });
  await ev(function () { window.MindRoot.media.openViewer('assets/herbs-3.book/001.ink.svg', { owner: '0', field: 'line' }); });
  await until(function () { var v = window.MindRoot.media.viewerState(); return v && v.notebook && v.editor && v.notebook.pages() === 2; });
  t.same(await notebookState(), { pages: 2, mode: 'pages', paper: 'staff', path: 'assets/herbs-3.book/001.ink.svg' }, 'it opens whole from its new folder');
  await closeViewer();

  /* ------------------------------------------------------------ no page left */
  t.step('a folder left with no page: still a tile, and it can be cleared');
  await ev(function (a) {
    var ns = window.MindRoot;
    return ns.storage.putBlob('{"mindroot":"book","version":1,"pages":[]}', 'book.json').then(function (ref) { ns.store.setFile(a, 'assets/left.book/book.json', ref); });
  }, pid);
  await openPanel();
  await until(function () { return Array.prototype.some.call(document.querySelectorAll('.media-tile__name'), function (n) { return n.textContent === 'left'; }); });
  var left = await tile('left');
  t.check('a notebook of no pages, on no map, no picture', /^Notebook · 0 pages · /.test(left.info) && left.badge === 'On no map' && left.empty && !left.src, left);
  await rest();
  await t.shot('panel-empty-notebook', page);
  await pressTile('left', '.media-tile__open');
  t.eq(await M.waitToast(page, /no pages/), 'This notebook has no pages left: send it to the trash to tidy up.', 'opening it says why it shows nothing');
  t.eq(await ev(function () { return window.MindRoot.media.viewerState(); }), null, 'and opens nothing');
  await pressTile('left', '.media-tile__check');
  await page.click('.media-panel__trash');
  await until(function () { return !Array.prototype.some.call(document.querySelectorAll('.media-tile__name'), function (n) { return n.textContent === 'left'; }); });
  t.same(await folder('assets/left.book'), {}, 'cleared, without a question (no map shows it)');
  await closePanel();

  /* ------------------------------------------------------------ ZIP */
  t.step('the trash with a notebook in it, through a ZIP and back');
  t.eq(await ev(function () { return window.MindRoot.media.takePictureOut('0', 'line', 'draw'); }), true, 'the new notebook out too');
  var trip = await ev(function (a) {
    var ns = window.MindRoot;
    var before = ns.store.trash(a).filter(function (e) { return e.files && Object.keys(e.files).length; })[0];
    return ns.archive.projectZip(a).then(function (out) {
      var file = new File([out.blob], out.name, { type: 'application/zip' });
      return ns.archive.readFile(file).then(function (res) {
        var added = ns.store.importProjects(res.projects);
        var id = added[0].id || added[0];
        var cover = ns.store.trash(id).filter(function (e) { return e.path === before.path; })[0];
        var folder = before.path.replace(/\/[^/]+$/, '/');
        var restored = ns.store.restoreTrash(id, cover.id);
        var p = ns.store.project(id);
        return {
          files: Object.keys(cover.files || {}).sort().join(',') === Object.keys(before.files).sort().join(','),
          same: Object.keys(before.files).every(function (k) { return cover.files[k] && cover.files[k].asset === before.files[k].asset; }),
          where: restored.where,
          back: Object.keys(p.files).filter(function (k) { return k.indexOf(folder) === 0; }).length,
          want: Object.keys(before.files).length + 1
        };
      });
    });
  }, pid);
  t.check('the entry keeps its folder through the ZIP and restores whole', trip.files && trip.same && trip.where === 'same' && trip.back === trip.want, trip);
  await ev(function (a) { window.MindRoot.store.setActive(a.pid, a.mid); }, { pid: pid, mid: s.mid });
  await until(function (a) { var c = window.MindRoot.session.current(); return c && c.projectId === a; }, pid);

  /* ------------------------------------------------------------ board and viewer */
  t.step('the board coming up closes the node\'s notebook; a viewer brings the map back');
  await E.settled(page);
  await ev(function () { window.MindRoot.session.select('0', { reveal: true }); });
  await ev(function () { window.MindRoot.media.openDrawing({ path: '0', field: 'line' }); });
  await M.editorReady(page);
  await page.keyboard.press('Control+Shift+L');
  await until(function () { var v = window.MindRoot.notebook.boardView(); return window.MindRoot.notebook.boardShown() && v && v.editor(); });
  await until(function () { return !window.MindRoot.media.viewerState(); });
  var alone = await ev(function () {
    var vw = document.getElementById('viewer');
    return { viewer: !!vw && !vw.hidden, notebooks: document.querySelectorAll('.nb').length, mode: document.documentElement.getAttribute('data-viewer') };
  });
  t.same([alone.viewer, alone.notebooks], [false, 1], 'one notebook on screen: the board');
  await rest();
  await t.shot('board-alone', page);
  await openPanel();
  var onMap = null;
  await until(function () { return Array.prototype.some.call(document.querySelectorAll('.media-tile[data-kind="notebook"]:not([data-unused])'), function () { return true; }); });
  onMap = await ev(function () { return document.querySelector('.media-tile[data-kind="notebook"]:not([data-unused]) .media-tile__name').textContent; });
  await pressTile(onMap, '.media-tile__open');
  await until(function () { var v = window.MindRoot.media.viewerState(); return v && v.editor && !window.MindRoot.notebook.boardShown(); });
  t.eq(await ev(function () { return getComputedStyle(document.querySelector('#stage > .mv')).visibility; }), 'visible', 'the map is back beside the viewer');
  t.eq(await ev(function () { return document.querySelectorAll('.nb').length; }), 1, 'and one notebook: the node\'s');
  await closeViewer();
};
