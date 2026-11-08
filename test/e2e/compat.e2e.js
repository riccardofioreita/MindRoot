/* compat: exports in the older form still open here.
 *
 * The files are real exports in that form (test/fixtures/data/old-exports.js,
 * frozen): a project ZIP (.interneuron folder), the project JSON, the
 * whole-workspace ZIP and JSON. Each is brought in the way a person would - the import
 * command's file picker, or a drop on the page - and then its maps must
 * open and draw, words, notes, to-dos and pictures included (the picture
 * must actually load, from a blob: URL). The old Excalidraw board opens in
 * the viewer, read-only as the decision says.
 *
 * The production path, last: a browser with nothing in it opened on a
 * plain index.html (no ?db, so the real 'mindroot2', no ?welcome) gets the
 * "MindRoot" welcome project.
 *
 * The import command's file picker: Playwright starts intercepting file
 * choosers when the first 'filechooser' listener is added, and a chooser
 * opened by the page in the same instant can slip past (seen right after
 * boot, 1 time in 5). So the listener is in place from the start, and a
 * press that brings no chooser within a few seconds is pressed again. */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var M = require('../fixtures/media/helpers.js');

/* The fixture is a browser script (window.OldExports = ...): read in a
 * sandbox, never on Node's own global. */
function oldExports() {
  var box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'data', 'old-exports.js'), 'utf8'), box);
  return box.window.OldExports;
}

module.exports = async function (t) {
  var O = oldExports();
  var ctx = await t.newContext({ viewport: { width: 1280, height: 800 } });
  var page = await ctx.newPage();
  page.on('filechooser', function () { /* keeps the interception on from the start */ });
  function until(fn, arg, timeout) { return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: timeout || 10000, polling: 30 }); }

  async function importFile(name, type, buffer) {
    for (var attempt = 1; attempt <= 3; attempt++) {
      var chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(function () { return null; });
      await page.keyboard.press('Control+O');
      var c = await chooser;
      if (c) return c.setFiles({ name: name, mimeType: type, buffer: buffer });
      t.log('no file chooser after Ctrl+O (try ' + attempt + '), pressed again');
    }
    throw new Error('Ctrl+O never brought a file chooser');
  }
  function projects() {
    return page.evaluate(function () {
      return window.MindRoot.store.projects().map(function (p) { return { id: p.id, name: p.name, maps: p.maps.map(function (m) { return m.name; }), files: Object.keys(p.files).sort() }; });
    });
  }
  async function open(pid, mapName) {
    await page.evaluate(function (a) {
      var ns = window.MindRoot;
      var m = ns.store.project(a.pid).maps.filter(function (x) { return x.name === a.map; })[0];
      ns.store.setActive(a.pid, m.id);
    }, { pid: pid, map: mapName });
    await until(function (map) { var c = window.MindRoot.session.current(); return c && c.map.name === map; }, mapName);
    await page.evaluate(function () { return window.MindRoot.session.view.settled(); });
  }
  /* What the open map shows: node words, and whether each picture loaded. */
  function shown() {
    return page.evaluate(function () {
      var nodes = Array.prototype.map.call(document.querySelectorAll('#stage .mv-node .mv-title .mv-text'), function (el) { return el.textContent.trim(); });
      var pics = Array.prototype.map.call(document.querySelectorAll('#stage img.mv-img'), function (img) {
        return { path: img.getAttribute('data-src'), loaded: img.complete && img.naturalWidth > 0 && /^blob:/.test(img.src) };
      });
      return { nodes: nodes, pics: pics, notes: document.querySelectorAll('#stage [class*="mv-note"]').length, tasks: document.querySelectorAll('#stage [class*="task"] input, #stage .mv-task').length };
    });
  }
  async function picturesLoaded() {
    await until(function () {
      var imgs = document.querySelectorAll('#stage img.mv-img');
      return imgs.length && Array.prototype.every.call(imgs, function (img) { return img.complete && img.naturalWidth > 0; });
    }).catch(function () {});
  }
  async function checkKyc(pid, where) {
    await open(pid, 'KYC');
    await picturesLoaded();
    var s = await shown();
    t.same(s.nodes.slice(0, 4), ['KYC', 'POI', 'SOF', 'SOW'], where + ': the KYC map draws its nodes');
    t.same(s.pics, [{ path: 'assets/foto.png', loaded: true }], where + ': its picture loads');
    t.check(where + ': the note dot and the to-do box are drawn', s.notes >= 1 && s.tasks >= 1, s);
    await open(pid, 'Città');
    t.same((await shown()).nodes, ['Città', 'Milano', 'Navigli', 'Roma', 'Napoli'], where + ': the second map, accents and all');
  }

  /* ------------------------------------------------------------ project ZIP */
  t.step('a project ZIP (.interneuron folder) from the import command');
  await t.open('', { page: page });
  await page.evaluate(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); });
  await importFile(O.projectZip.name, 'application/zip', Buffer.from(O.projectZip.base64, 'base64'));
  await until(function () { return window.MindRoot.store.projects().length === 1; });
  var ps = await projects();
  t.eq(ps[0].name, 'Rischio & Controlli', 'the project, by its name');
  t.same(ps[0].maps, ['KYC', 'Città', 'KYC', 'Cestinata'], 'its four maps, in order');
  t.check('its files', ps[0].files.indexOf('assets/foto.png') >= 0 && ps[0].files.indexOf('assets/kyc-board.excalidraw.svg') >= 0, ps[0].files);
  await checkKyc(ps[0].id, 'ZIP');
  t.eq(await page.evaluate(function (pid) { return window.MindRoot.store.project(pid).isTemplate; }, ps[0].id), true, 'still a template');
  await t.shot('zip', page);

  t.step('the old Excalidraw board opens as the board, a one-page notebook, nothing moved');
  await open(ps[0].id, 'KYC');
  await page.evaluate(function () { window.MindRoot.commands.run('view.board'); });
  await until(function () {
    var v = window.MindRoot.notebook.boardView();
    return v && v.editor() && !v.el.hasAttribute('data-loading');
  });
  var board = await page.evaluate(function () {
    var v = window.MindRoot.notebook.boardView();
    var ed = v.editor();
    var info = ed.loaded ? ed.loaded() : null;
    var b = v.book();
    return { ref: b.ref, lone: b.lone, folder: b.folder, pages: b.pages.length, kind: info && info.kind };
  });
  t.eq(board.lone, 'assets/kyc-board.excalidraw.svg', 'the board named in the map, read');
  t.check('as one page of a notebook with no folder: opening converts nothing', board.folder === null && board.pages === 1 && board.kind !== 'invalid', board);
  await page.evaluate(function () { window.MindRoot.commands.run('view.board'); });
  await until(function () { return !window.MindRoot.notebook.boardShown(); });
  var boardText = await page.evaluate(function (pid) {
    var ns = window.MindRoot;
    return ns.storage.blobText(ns.store.fileRef(pid, 'assets/kyc-board.excalidraw.svg').asset);
  }, ps[0].id);
  var oldAssets = JSON.parse(O.projectJson.text).assets;
  var oldBoard = Object.keys(oldAssets).map(function (k) { return oldAssets[k]; }).filter(function (a) { return a.id === O.record.files['assets/kyc-board.excalidraw.svg'].asset; })[0];
  t.eq(boardText, Buffer.from(oldBoard.data, 'base64').toString('utf8'), 'the old file is still, byte for byte, the one in the export');
  t.check('and the map still names it', /<!-- board: assets\/kyc-board\.excalidraw\.svg/.test(await page.evaluate(function () { return window.MindRoot.session.current().text; })));

  /* ------------------------------------------------------------ project JSON */
  t.step('the project JSON, dropped on the page');
  await M.putFile(page, O.projectJson.name, Buffer.from(O.projectJson.text, 'utf8'), 'application/json');
  await M.drop(page, [O.projectJson.name], 700, 400);
  await until(function () { return window.MindRoot.store.projects().length === 2; });
  ps = await projects();
  t.eq(ps.length, 2, 'a second project beside the first, never over it');
  t.same(ps[1].maps, ['KYC', 'Città', 'KYC', 'Cestinata'], 'with the same four maps');
  await checkKyc(ps[1].id, 'JSON');

  /* ------------------------------------------------------------ workspace ZIP and JSON */
  t.step('the whole-workspace ZIP');
  await importFile(O.workspaceZip.name, 'application/zip', Buffer.from(O.workspaceZip.base64, 'base64'));
  await until(function () { return window.MindRoot.store.projects().length >= 4; });
  ps = await projects();
  t.check('both projects of the old workspace came in', ps.some(function (p) { return p.name === 'Uno'; }), ps.map(function (p) { return p.name; }));
  var fromWs = ps.filter(function (p) { return /^Rischio & Controlli( \(\d+\))?$/.test(p.name); })[2];
  t.check('a third copy of the KYC project', !!fromWs);
  if (fromWs) await checkKyc(fromWs.id, 'workspace ZIP');
  var secondProject = ps.filter(function (p) { return p.name === 'Uno'; })[0];
  if (secondProject) {
    await open(secondProject.id, secondProject.maps[0]);
    await picturesLoaded();
    var su = await shown();
    t.check('"Uno" draws, with its picture', su.nodes.length >= 1 && su.pics.every(function (p) { return p.loaded; }), su);
  }

  t.step('the whole-workspace JSON');
  var count = ps.length;
  await importFile(O.workspaceJson.name, 'application/json', Buffer.from(O.workspaceJson.text, 'utf8'));
  await until(function (n) { return window.MindRoot.store.projects().length >= n + 2; }, count);
  ps = await projects();
  var last = ps.filter(function (p) { return p.name === 'Rischio & Controlli'; }).pop();
  await checkKyc(last.id, 'workspace JSON');

  /* ------------------------------------------------------------ the real first run */
  /* Both real first runs happen in a browser that speaks Italian: the app
   * and everything it writes on its own are English all the same. */
  t.step('a plain index.html in an empty Italian browser: the welcome project, in English');
  var freshCtx = await t.newContext({ viewport: { width: 1280, height: 800 }, locale: 'it-IT' });
  var fresh = await freshCtx.newPage();
  await fresh.goto(t.fileUrl('index.html'));
  await fresh.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  var first = await fresh.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var o = ns.shell.opened() || {};
    return { db: ns.storage.databaseName(), projects: ns.store.projects().map(function (p) { return p.name; }), open: c ? c.map.name : null, fresh: !!o.fresh,
      lang: ns.i18n.lang(), html: document.documentElement.lang, nav: navigator.language, text: c ? c.map.text : '',
      newMap: ns.doc.emptyDocument(''), untitled: ns.i18n.t('doc.untitled'), images: ns.i18n.t('doc.images'),
      chrome: document.getElementById('sidebar-toggle').getAttribute('aria-label') };
  });
  t.eq(first.db, 'mindroot2', 'the real database, mindroot2');
  t.same({ nav: first.nav, lang: first.lang, html: first.html }, { nav: 'it-IT', lang: 'en', html: 'en' }, 'an Italian browser, an English app');
  t.eq(first.open, 'Welcome', 'the welcome map has its English name');
  t.check('the welcome map is written in English', /^# Welcome to MindRoot\n/.test(first.text) && !/Benvenuto/.test(first.text), first.text.slice(0, 200));
  t.same([first.newMap, first.untitled, first.images], ['# New map\n', 'untitled', 'Images'], 'the default names are English');
  t.check('and so is the chrome', /^Show or hide/.test(first.chrome), first.chrome);
  t.same(first.projects, ['MindRoot'], 'one project, the welcome one');
  t.check('its map is open', !!first.open, first);
  t.check('a first run', first.fresh, first);
  await fresh.reload();
  await fresh.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  t.same(await fresh.evaluate(function () { return window.MindRoot.store.projects().map(function (p) { return p.name; }); }), ['MindRoot'], 'saved at once: a reload does not seed it twice');
};

