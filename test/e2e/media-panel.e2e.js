/* media-panel: the project's pictures and drawings, on the real app.
 *
 * Opened by media.panel (the sidebar's footer button runs it): drawings
 * first, then pictures, by name; each with its thumbnail (painted lazily,
 * once per set of bytes), its kind and size and whether a map shows it;
 * the list follows the store while it is open; multi-select with "choose
 * all"; sending to the trash asks first only when a map still shows one,
 * is one step, and the toast's Undo brings everything back; a tile opens
 * its file in the viewer (beside the panel on a desktop); a notebook folder
 * is one tile (its cover, its pages counted) that opens in the viewer, the
 * board's in its Board view instead; the command
 * toggles it; a phone gets it as a bottom sheet that steps aside for the
 * viewer. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;

var MAP = '# Pics\n\n- ![sea](assets/sea.png) Sea\n- Words\n';

function tiles(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.media-panel .media-tile'), function (el) {
      var img = el.querySelector('.media-tile__img');
      return {
        name: el.querySelector('.media-tile__name').textContent,
        kind: el.getAttribute('data-kind'),
        info: el.querySelector('.media-tile__info').textContent,
        badge: el.querySelector('.media-tile__badge').textContent,
        unused: el.hasAttribute('data-unused'),
        chosen: el.hasAttribute('data-chosen'),
        thumb: !!img.getAttribute('src') && /^blob:/.test(img.getAttribute('src'))
      };
    });
  });
}

async function waitTiles(page, n) {
  try { await E.until(page, function (k) { return document.querySelectorAll('.media-panel .media-tile').length === k; }, n, 5000); } catch (err) { /* checked */ }
  return tiles(page);
}

async function choose(page, name) {
  await page.evaluate(function (n) {
    var tile = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (el) { return el.querySelector('.media-tile__name').textContent === n; });
    tile.querySelector('.media-tile__check').click();
  }, name);
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Pics', MAP]]);
  var page = s.page;
  /* sea.png (on the map), spare.png (on no map), a drawing on the map. */
  await M.makeImage(page, 'sea.png', { w: 80, h: 60, color: '#2f6fb3' });
  await M.makeImage(page, 'spare.png', { w: 60, h: 60, color: '#c4314b' });
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var pid = ns.store.here().projectId;
    var svg = ns.ink.serialize({ elements: [], background: null });
    return Promise.all([
      ns.storage.putBlob(window.__files['sea.png'], 'sea.png'),
      ns.storage.putBlob(window.__files['spare.png'], 'spare.png'),
      ns.storage.putBlob(svg, 'sketch.ink.svg')
    ]).then(function (refs) {
      ns.store.transaction('test', function () {
        ns.store.setFile(pid, 'assets/sea.png', refs[0]);
        ns.store.setFile(pid, 'assets/spare.png', refs[1]);
        ns.store.setFile(pid, 'assets/sketch.ink.svg', refs[2]);
        var map = ns.store.map(pid, ns.store.here().mapId);
        ns.store.setMapText(pid, map.id, map.text.replace('- Words', '- ![](assets/sketch.ink.svg) Words'));
      });
    });
  });
  await E.settled(page);

  t.step('the panel lists the project files, drawings first');
  var viaSidebar = await page.$('#sb-images');
  if (viaSidebar && await viaSidebar.isVisible()) await viaSidebar.click();
  else await page.evaluate(function () { window.MindRoot.commands.run('media.panel'); });
  var list = await waitTiles(page, 3);
  t.same(list.map(function (x) { return x.name; }), ['sketch.ink.svg', 'sea.png', 'spare.png'], 'drawings first, then by name');
  t.same(list.map(function (x) { return x.kind; }), ['drawing', 'image', 'image'], 'kinds');
  t.same(list.map(function (x) { return x.badge; }), ['On a map', 'On a map', 'On no map'], 'whether a map shows it');
  t.check('the kind and the size', /^Drawing · \d+ (B|KB)$/.test(list[0].info) && /^Picture · \d+ (B|KB)$/.test(list[1].info), list);
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.checked('media.panel'); }), true, 'the command is lit');
  try { await E.until(page, function () { return Array.prototype.every.call(document.querySelectorAll('.media-tile__img'), function (i) { return /^blob:/.test(i.getAttribute('src') || ''); }); }, null, 5000); } catch (err) { /* checked */ }
  list = await tiles(page);
  t.check('every thumbnail painted', list.every(function (x) { return x.thumb; }), list);
  t.eq(await page.evaluate(function () { return document.querySelector('.media-panel__count').textContent; }), '3 files', 'counted');
  await t.shot('desktop');

  t.step('it follows the store while open');
  await M.makeImage(page, 'late.png', { w: 30, h: 30 });
  await page.evaluate(function () { return window.MindRoot.media.addFiles([window.__files['late.png']], { path: '1', field: 'line' }, { quiet: true }); });
  list = await waitTiles(page, 4);
  t.check('a new picture shows up', list.some(function (x) { return x.name === 'late.png' && x.badge === 'On a map'; }), list);
  var srcBefore = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.media-tile__img'), function (i) { return i.getAttribute('src'); }).join('|');
  });
  await page.evaluate(function () { window.MindRoot.store.setActive(window.MindRoot.store.here().projectId, window.MindRoot.store.here().mapId); });
  await page.waitForTimeout(100);
  var srcAfter = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.media-tile__img'), function (i) { return i.getAttribute('src'); }).join('|');
  });
  t.eq(srcAfter, srcBefore, 'a change that is not about the files repaints nothing');

  t.step('an unused file goes to the trash without a question');
  var h0 = await E.history(page);
  await choose(page, 'spare.png');
  t.eq(await page.evaluate(function () { return document.querySelector('.media-panel__count').textContent; }), '1 chosen', 'the count says what is chosen');
  t.eq(await page.getAttribute('.media-panel__trash', 'aria-disabled'), 'false', 'the trash button is on');
  await page.click('.media-panel__trash');
  list = await waitTiles(page, 3);
  t.check('gone from the list', !list.some(function (x) { return x.name === 'spare.png'; }), list);
  var tr = await M.trash(page);
  t.check('in the trash as a file', tr.length === 1 && tr[0].kind === 'asset' && tr[0].path === 'assets/spare.png', tr);
  var h1 = await E.history(page);
  t.eq(h1.count, h0.count + 1, 'one step');
  t.eq(h1.label, 'send the file to the trash', 'labelled');
  t.eq(await M.waitToast(page, /trash/), 'The file is in the trash.', 'said, with Undo');
  await page.click('.toast:not([hidden]) .toast__action');
  list = await waitTiles(page, 4);
  t.check('Undo brings it back', list.some(function (x) { return x.name === 'spare.png'; }), list);

  t.step('files still on a map: a question first, then all in one step');
  await page.click('.media-panel__all');
  list = await tiles(page);
  t.check('choose all', list.every(function (x) { return x.chosen; }), list);
  await page.click('.media-panel__trash');
  await page.waitForSelector('dialog[open]:not(.sheet)', { timeout: 4000 });
  var question = await page.evaluate(function () { var d = document.querySelector('dialog[open]:not(.sheet)'); return d ? d.textContent : ''; });
  t.check('it says three of them are on a map', /3 of these are still on a map/.test(question), question);
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('dialog[open]:not(.sheet)'); }, null, 4000).catch(function () {});
  t.eq((await waitTiles(page, 4)).length, 4, 'cancelled: nothing moved');
  await page.click('.media-panel__trash');
  await page.waitForSelector('dialog[open]:not(.sheet) .btn--danger', { timeout: 4000 });
  await page.click('dialog[open]:not(.sheet) .btn--danger');
  list = await waitTiles(page, 0);
  t.eq(list.length, 0, 'all four in the trash');
  t.eq((await M.trash(page)).length, 4, 'four entries');
  t.eq((await E.history(page)).label, 'send 4 files to the trash', 'one step');
  t.check('the panel says it is empty', await page.evaluate(function () { var e = document.querySelector('.media-panel__empty'); return e && !e.hidden; }));
  try { await E.until(page, function () { return !!document.querySelector('.mv-node img.mv-img[data-broken="true"]'); }, null, 4000); } catch (err) { /* checked */ }
  t.check('the map shows the pictures as missing', (await M.pictures(page)).some(function (x) { return x.broken; }));
  await page.click('.toast:not([hidden]) .toast__action');
  list = await waitTiles(page, 4);
  t.eq(list.length, 4, 'Undo: all back');
  t.check('and none chosen any more', list.every(function (x) { return !x.chosen; }), list);

  t.step('a tile opens its file in the viewer, beside the panel');
  await page.evaluate(function () {
    var tile = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (el) { return el.querySelector('.media-tile__name').textContent === 'sea.png'; });
    tile.querySelector('.media-tile__open').click();
  });
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.kind === 'photo'; }, null, 4000);
  t.eq(await page.evaluate(function () { return window.MindRoot.media.viewerState().path; }), 'assets/sea.png', 'the picture');
  t.eq(await page.evaluate(function () { return window.MindRoot.media.panelOpen(); }), true, 'the panel stays open on a desktop');
  await page.evaluate(function () {
    var tile = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (el) { return el.querySelector('.media-tile__name').textContent === 'sketch.ink.svg'; });
    tile.querySelector('.media-tile__open').click();
  });
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.kind === 'drawing' && v.editor; }, null, 6000);
  t.eq(await page.evaluate(function () { return window.MindRoot.media.viewerState().path; }), 'assets/sketch.ink.svg', 'a drawing opens in the editor');
  await page.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await E.until(page, function () { return !window.MindRoot.media.viewerState(); }, null, 4000);

  t.step('a notebook is one tile; it opens in the viewer, a board in its Board view');
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var pid = ns.store.here().projectId;
    var page1 = ns.ink.serialize({ elements: [ns.ink.engine.makeShape('rect', [10, 10], [90, 60], { color: '#1f2328', width: 2 })] });
    var blank = ns.ink.serialize({ elements: [] });
    var book = JSON.stringify({ mindroot: 'book', version: 1, mode: 'pages', paper: { type: 'dots' }, size: { id: 'a5', w: 148, h: 210, orientation: 'portrait' }, background: 'auto', backgroundImage: null, pages: [{ file: '001.ink.svg' }, { file: '002.ink.svg' }] });
    return Promise.all([
      ns.storage.putBlob(page1, '001.ink.svg'), ns.storage.putBlob(blank, '002.ink.svg'), ns.storage.putBlob(book, 'book.json'),
      ns.storage.putBlob(blank, '001.ink.svg')
    ]).then(function (refs) {
      ns.store.transaction('test', function () {
        ns.store.setFile(pid, 'assets/plan.book/001.ink.svg', refs[0]);
        ns.store.setFile(pid, 'assets/plan.book/002.ink.svg', refs[1]);
        ns.store.setFile(pid, 'assets/plan.book/book.json', refs[2]);
        ns.store.setFile(pid, 'assets/pics-board.book/001.ink.svg', refs[3]);
        var map = ns.store.map(pid, ns.store.here().mapId);
        var text = '<!-- board: assets/pics-board.book/001.ink.svg -->\n\n' + map.text.replace('- ![sea](assets/sea.png) Sea', '- ![sea](assets/sea.png) Sea\n- ![](assets/plan.book/001.ink.svg) Plan');
        ns.store.setMapText(pid, map.id, text);
      });
    });
  });
  list = await waitTiles(page, 6);
  t.same(list.slice(0, 2).map(function (x) { return x.name + ':' + x.kind + ':' + x.badge; }), ['pics-board:notebook:On a map', 'plan:notebook:On a map'], 'notebooks first, one tile each, on a map');
  t.check('said with their pages', /^Notebook · 2 pages · /.test(list[1].info), list[1].info);
  try { await E.until(page, function () { var imgs = document.querySelectorAll('.media-panel .media-tile[data-kind="notebook"] .media-tile__img'); return imgs.length === 2 && Array.prototype.every.call(imgs, function (i) { return /^blob:/.test(i.getAttribute('src') || ''); }); }, null, 5000); } catch (err) { /* checked */ }
  t.check('their cover as the thumbnail', (await tiles(page)).slice(0, 2).every(function (x) { return x.thumb; }));
  await page.evaluate(function () {
    var tile = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (el) { return el.querySelector('.media-tile__name').textContent === 'plan'; });
    tile.querySelector('.media-tile__open').click();
  });
  await E.until(page, function () { var v = window.MindRoot.media.viewerState(); return v && v.notebook && v.editor && v.notebook.pages() === 2; }, null, 6000);
  t.same(await page.evaluate(function () { var v = window.MindRoot.media.viewerState(); return [v.kind, v.path, v.notebook.mode()]; }), ['drawing', 'assets/plan.book/001.ink.svg', 'pages'], 'the notebook in the viewer, its two pages');
  await page.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await E.until(page, function () { return !window.MindRoot.media.viewerState(); }, null, 4000);
  await page.evaluate(function () {
    var tile = Array.prototype.find.call(document.querySelectorAll('.media-panel .media-tile'), function (el) { return el.querySelector('.media-tile__name').textContent === 'pics-board'; });
    tile.querySelector('.media-tile__open').click();
  });
  await E.until(page, function () { return window.MindRoot.notebook.boardShown(); }, null, 6000);
  t.eq(await page.evaluate(function () { return window.MindRoot.media.viewerState(); }), null, 'the board\'s tile shows the board in place of the map, never in the viewer');
  await page.evaluate(function () { window.MindRoot.notebook.showMap(); });
  await E.until(page, function () { return !window.MindRoot.notebook.boardShown(); }, null, 4000);
  if (!(await page.evaluate(function () { return window.MindRoot.media.panelOpen(); }))) await page.evaluate(function () { window.MindRoot.commands.run('media.panel'); });

  t.step('the command closes it');
  await page.evaluate(function () { window.MindRoot.commands.run('media.panel'); });
  await E.until(page, function () { return !window.MindRoot.media.panelOpen(); }, null, 4000);
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.checked('media.panel'); }), false, 'closed');

  t.step('a phone: a bottom sheet that steps aside for the viewer');
  var ctx = await t.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await E.H.stubMissing(ctx, t);
  var phone = await ctx.newPage();
  await E.boot(t, [['Pics', '# Pics\n\n- Alpha\n']], { page: phone });
  await M.makeImage(phone, 'p.png', { w: 40, h: 40 });
  await phone.evaluate(function () { return window.MindRoot.media.addFiles([window.__files['p.png']], { path: '0', field: 'line' }, { quiet: true }); });
  await phone.evaluate(function () { window.MindRoot.commands.run('media.panel'); });
  await waitTiles(phone, 1);
  var sheet = await E.resting(phone, 'dialog.sheet--media');
  t.check('a sheet from the bottom', Math.abs(sheet.bottom - 844) < 2 && sheet.w >= 389, sheet);
  var check = await E.rectOf(phone, '.media-tile__pick');
  t.check('the check box is a finger-sized target', check.w >= 44 && check.h >= 44, check);
  await t.shot('phone', phone);
  await phone.tap('.media-tile__open');
  await E.until(phone, function () { return !!window.MindRoot.media.viewerState(); }, null, 4000);
  t.eq(await phone.evaluate(function () { return window.MindRoot.media.panelOpen(); }), false, 'the sheet closed for the viewer');
};
