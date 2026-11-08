/* journey-phone-more: the rest of the story on a 390x844 touch phone, every
 * action a finger (real touch points through the DevTools protocol) on the
 * controls a person sees - mostly the thumb bar's "more" sheet:
 *
 *   a project with three nodes -> a picture from the file chooser -> a
 *   drawing (pen, a stroke, Done: the node names its notebook's first page) -> a long
 *   press and a move hands a branch to another node -> export as PNG from
 *   the export sheet -> a branch deleted, then put back from the trash ->
 *   a copy taken by hand -> help -> view only, and its X -> the language
 *   switched to Italian in settings and back.
 *
 * journey-phone covers the first steps (welcome, thumb bar, rename, colour,
 * note, undo, Markdown, drawer, palette, theme, reload); the helpers are
 * its own. Each sheet is checked for finger-sized controls on screen and
 * the page for sideways scroll. Screenshots: test/out/journey-phone-more-*.png. */
'use strict';

var fs = require('fs');
var M = require('../fixtures/media/helpers.js');
var helpers = require('./journey-phone.e2e.js').helpers;
var T = require('../fixtures/touch.js');

var VIEW = { width: 390, height: 844 };

module.exports = async function (t) {
  var page = null;
  try {
    await story(t, function (p) { page = p; });
  } catch (err) {
    /* What the screen showed when a step gave up: test/out/journey-phone-more-failure.png. */
    if (page) await t.shot('failure', page).catch(function () {});
    if (page) t.log('DBG ' + await page.evaluate(function () { return (window.__ev || []).join(' '); }).catch(function () { return ''; }));
    throw err;
  }
};

async function story(t, keep) {
  var ctx = await t.newContext({ viewport: VIEW, hasTouch: true, isMobile: true, acceptDownloads: true });
  var page = await ctx.newPage();
  keep(page);
  await page.addInitScript(function () {
    window.__ev = [];
    ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'pointercancel', 'click'].forEach(function (ty) {
      document.addEventListener(ty, function (e) {
        var c = e.target && e.target.className;
        window.__ev.push(ty + ':' + (typeof c === 'string' ? c.split(' ')[0] : e.target.tagName) + ':' + Math.round(performance.now()));
        if (window.__ev.length > 40) window.__ev.shift();
      }, true);
      document.addEventListener(ty, function (e) { if (e.defaultPrevented) window.__ev.push('  (' + ty + ' prevented)'); }, false);
    });
  });
  page.on('filechooser', function () { /* interception on from the start (see compat) */ });
  var cdp = await ctx.newCDPSession(page);
  var J = helpers(page, cdp, t);
  function storeText() { return J.text(); }
  /* A row of "more" that opens a sheet: tapped, then the sheet must be open
   * and at rest. */
  async function sheet(label, selector) {
    await J.more(label);
    await page.waitForSelector(selector, { state: 'visible' });
    await J.rest();
  }
  async function closeSheet() {
    await page.keyboard.press('Escape');
    await J.until(function () { return !document.querySelector('dialog[open]'); });
  }
  /* Waits for the map text to match; a timeout is a failed check that
   * shows the text, not a crash. */
  async function textMatches(re, label) {
    var ok = await page.waitForFunction(function (src) {
      var c = window.MindRoot.session.current();
      return c && new RegExp(src).test(c.text);
    }, re.source, { timeout: 8000, polling: 30 }).then(function () { return true; }, function () { return false; });
    t.check(label, ok, await storeText());
    return ok;
  }
  async function name(text) {
    await J.renaming();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await J.notRenaming();
  }

  /* ------------------------------------------------------------ a project */
  t.step('a project with three nodes');
  await t.open('', { page: page });
  await J.tapEl('#welcome button:has-text("New project")');
  await J.dialog();
  await page.keyboard.type('Garden');
  await page.keyboard.press('Enter');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Garden'; });
  await J.tapNode('Garden');
  await J.tapEl('#thumbbar [data-command="node.addRight"]');
  await name('Tomatoes');
  await J.tapEl('#thumbbar [data-command="node.addSibling"]');
  await name('Basil');
  await J.tapEl('#thumbbar [data-command="node.addSibling"]');
  await name('Mint');
  t.eq(await storeText(), '# Garden\n\n## Tomatoes\n\n## Basil\n\n## Mint\n', 'three nodes from the thumb bar');
  t.eq(await page.evaluate(function () {
    var el = document.querySelector('#stage .mv');
    return document.activeElement === el ? getComputedStyle(el).outlineStyle : 'not focused';
  }), 'none', 'the map has the keys back after each name, without a frame round the whole screen');

  /* ------------------------------------------------------------ picture */
  t.step('a picture from the file chooser');
  await J.tapNode('Tomatoes');
  var chooser = page.waitForEvent('filechooser', { timeout: 8000 });
  await J.more('Add a picture');
  await (await chooser).setFiles({ name: 'tomato.png', mimeType: 'image/png', buffer: M.png(undefined, 7) });
  await J.until(function () { return /!\[[^\]]*\]\(assets\/tomato\.png\) Tomatoes/.test(window.MindRoot.session.current().text); });
  t.check('the node names the picture', true);
  await J.until(function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage img.mv-img'), function (img) { return img.complete && img.naturalWidth > 0 && /^blob:/.test(img.src); });
  });
  t.check('and shows it, from the stored bytes', true);

  t.step('a toast said while a bottom sheet is open stays off its rows');
  await J.tapEl('#thumbbar .btn--more');
  await page.waitForSelector('dialog[open].sheet--menu', { state: 'visible' });
  await J.rest();
  await page.evaluate(function () { window.MindRoot.ui.toast('Something happened'); });
  await J.until(function () { var el = document.querySelector('dialog[open] .toast:not([hidden])'); return el && el.getAnimations().every(function (a) { return a.playState !== 'running'; }); });
  var over = await page.evaluate(function () {
    var toast = document.querySelector('dialog[open] .toast:not([hidden])').getBoundingClientRect();
    var sheet = document.querySelector('dialog[open].sheet--menu').getBoundingClientRect();
    return { toastTop: toast.top, toastBottom: toast.bottom, sheetTop: sheet.top };
  });
  t.check('it comes in at the top, above the sheet', over.toastTop >= 0 && over.toastBottom <= over.sheetTop + 0.5, over);
  await t.shot('toast-over-sheet', page);
  await closeSheet();

  /* ------------------------------------------------------------ drawing */
  t.step('a drawing: pen, a stroke, Done');
  await J.tapNode('Basil');
  await J.more('Draw on the node');
  await J.until(function () {
    var v = window.MindRoot.media.viewerState();
    var s = document.querySelector('#viewer .ink__surface');
    return v && v.editor && s && s.getBoundingClientRect().height > 100;
  });
  await J.rest();
  await J.fingerSized('drawing');
  /* The pen, unless it is in hand already (a second tap on the tool in
   * hand opens its options). */
  if (await page.evaluate(function () { var b = document.querySelector('#viewer .ink__tool[aria-label="Pen"]'); return b.getAttribute('aria-pressed') !== 'true' && b.getAttribute('aria-checked') !== 'true'; })) {
    await J.tapEl('#viewer .ink__tool[aria-label="Pen"]');
  }
  t.eq(await page.evaluate(function () { return window.MindRoot.media.viewerState().editor.tool(); }), 'pen', 'the pen is in hand');
  var surf = await page.evaluate(function () { var r = document.querySelector('#viewer .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  var x0 = surf.x + surf.w * 0.25;
  var y0 = surf.y + surf.h * 0.5;
  await J.touch('touchStart', [[x0, y0]]);
  for (var i = 1; i <= 12; i++) {
    await J.touch('touchMove', [[x0 + i * surf.w * 0.04, y0 + Math.sin(i / 2) * surf.h * 0.15]]);
    await t.sleep(16);
  }
  await J.touch('touchEnd', []);
  await J.until(function () { var v = window.MindRoot.media.viewerState(); return v && v.editor && v.editor.scene().length === 1; });
  t.check('the stroke is on the sheet', true);
  t.eq(await page.evaluate(function () { var b = document.getElementById('thumbbar'); return b.getClientRects().length; }), 0, 'the map\'s thumb bar steps aside while drawing: its Undo would undo the map under the drawing');
  await page.evaluate(function () { window.MindRoot.ui.toast('Something happened'); });
  await J.until(function () { var el = document.querySelector('#layers .toast:not([hidden])'); return el && el.getAnimations().every(function (a) { return a.playState !== 'running'; }); });
  var hidden = await page.evaluate(function () {
    var tr = document.querySelector('#layers .toast:not([hidden])').getBoundingClientRect();
    return Array.prototype.filter.call(document.querySelectorAll('#viewer button'), function (b) {
      var r = b.getBoundingClientRect();
      return r.width && r.left < tr.right && r.right > tr.left && r.top < tr.bottom && r.bottom > tr.top;
    }).map(function (b) { return b.getAttribute('aria-label'); });
  });
  t.same(hidden, [], 'a toast said while drawing covers none of the drawing\'s controls');
  await t.shot('drawing', page);
  await J.tapEl('#viewer .ink__done');
  await J.until(function () { return !document.querySelector('#viewer:not([hidden])'); });
  await J.until(function () { return /!\[[^\]]*\]\(assets\/[\w.\/-]+\.ink\.svg\) Basil/.test(window.MindRoot.session.current().text); });
  var ink = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var path = /\((assets\/[\w.\/-]+\.ink\.svg)\)/.exec(c.text)[1];
    var ref = ns.store.fileRef(c.projectId, path);
    return ref ? ns.storage.blobText(ref.asset).then(function (svg) { return { path: path, svg: svg }; }) : { path: path, svg: null };
  });
  t.check('Done: the node names the drawing, and its file is stored with the stroke in it', ink.svg && /<svg/.test(ink.svg) && /<path/.test(ink.svg), ink.path);
  await J.until(function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage img.mv-img'), function (img) { return /\.ink\.svg$/.test(img.getAttribute('data-src') || '') && img.complete && img.naturalWidth > 0; });
  });
  t.check('the drawing shows on the map', true);

  /* ------------------------------------------------------------ reparent by touch */
  t.step('a long press and a move hands Mint to Tomatoes');
  /* The whole map in sight first, as a person would before a long move. */
  await J.more('Fit the map');
  await J.settled();
  await J.rest();
  var from = await J.nodeBox('Mint');
  var onto = await J.nodeBox('Tomatoes');
  var fx = from.x + Math.min(16, from.w / 2);
  var fy = from.y + from.h / 2;
  /* The middle band of Tomatoes (its middle third means "as a child"),
   * kept on screen. */
  var ox = Math.max(24, Math.min(VIEW.width - 24, onto.x + Math.min(onto.w / 2, 40)));
  var oy = onto.y + onto.h / 2;
  await J.touch('touchStart', [[fx, fy]]);
  await t.sleep(650);
  await J.touch('touchMove', [[fx + 8, fy - 6]]);
  await J.touch('touchMove', [[fx + 16, fy - 20]]);
  for (var s = 1; s <= 8; s++) {
    await J.touch('touchMove', [[fx + (ox - fx) * s / 8, fy + (oy - fy) * s / 8]]);
    await t.sleep(20);
  }
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-ghost'); }), true, 'the node lifts');
  await require('../fixtures/map/drop.js').decided(page);
  await J.touch('touchEnd', []);
  /* A finger that has just dragged lifts before it taps again. Chromium's
   * gesture detector drops the click of a synthetic tap sent within a few
   * frames of a touch drag's end - a blank page with a plain button does
   * the same, so this is the input, not the app - and no hand is that
   * fast anyway. */
  await t.sleep(500);
  await textMatches(/## !\[[^\]]*\]\(assets\/tomato\.png\) Tomatoes\n\n### Mint\n/, 'dropped on Tomatoes, Mint is its child');
  await J.until(function () { return !document.querySelector('dialog[open]'); });
  t.eq(await page.evaluate(function () {
    return Array.prototype.some.call(document.querySelectorAll('[role="menu"]'), function (m) { return m.getClientRects().length > 0; });
  }), false, 'the menu the long press began to open is not left behind');

  /* ------------------------------------------------------------ export */
  t.step('export as PNG from the export sheet');
  await sheet('Export the map', 'dialog[open].xp');
  await J.fingerSized('export');
  await t.shot('export', page);
  await J.tapEl('dialog[open].xp .seg__opt:has-text("PNG")');
  var download = page.waitForEvent('download', { timeout: 15000 });
  await J.tapEl('dialog[open].xp .btn--primary');
  var png = await download;
  var bytes = fs.readFileSync(await png.path());
  t.eq(png.suggestedFilename(), 'Garden.png', 'a PNG named after the map');
  t.check('a real PNG, carrying the map', bytes.slice(1, 4).toString('latin1') === 'PNG' && bytes.indexOf(Buffer.from('# Garden')) > 0 && bytes.indexOf(Buffer.from('Mint')) > 0);
  await J.until(function () { return !document.querySelector('dialog[open].xp'); });

  /* ------------------------------------------------------------ trash */
  t.step('a branch deleted, then put back from the trash');
  await J.tapNode('Tomatoes');
  await J.more('Delete the branch');
  await J.until(function () { return !/Tomatoes/.test(window.MindRoot.session.current().text); });
  await J.until(function () { return !document.querySelector('.toast'); }, null, 12000).catch(function () {});
  await sheet('Open the trash', 'dialog[open].ws-sheet--trash');
  var rows = await page.evaluate(function () { return document.querySelector('dialog[open].ws-sheet--trash').innerText; });
  t.check('the branch is in the trash', /Tomatoes/.test(rows) && /Branch/.test(rows), rows.slice(0, 200));
  await J.fingerSized('trash');
  await t.shot('trash', page);
  await J.tapEl('dialog[open].ws-sheet--trash button[aria-label^="Put back"]');
  await J.until(function () { return /Tomatoes\n\n### Mint/.test(window.MindRoot.session.current().text); });
  t.check('put back where it was, with its child and its picture', /!\[[^\]]*\]\(assets\/tomato\.png\) Tomatoes/.test(await storeText()), await storeText());
  if (await page.isVisible('dialog[open].ws-sheet--trash')) await closeSheet();

  /* ------------------------------------------------------------ copies */
  t.step('a copy taken by hand');
  await sheet('The copies of this map', 'dialog[open].ws-sheet--copies');
  await J.tapEl('dialog[open].ws-sheet--copies .btn--primary:has-text("Take a copy now")');
  await J.until(function () { var d = document.querySelector('dialog[open]'); return d && d.querySelector('input, textarea'); });
  await page.keyboard.type('before the rain');
  await J.tapEl('dialog[open] button:has-text("Take the copy")');
  await J.until(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    return ns.store.project(c.projectId).snapshots.some(function (s) { return s.mapId === c.mapId && /before the rain/.test(s.note || s.label || ''); });
  });
  t.check('the copy is kept, with its note', true);
  await J.until(function () { var d = document.querySelector('dialog[open].ws-sheet--copies'); return d && /before the rain/.test(d.innerText); }).then(function () { t.check('and listed in the sheet', true); }, function () { t.check('and listed in the sheet', false); });
  await J.until(function () { return document.querySelectorAll('dialog[open]').length === 1; });
  await J.rest();
  await J.fingerSized('copies');
  await t.shot('copies', page);
  await closeSheet();

  /* ------------------------------------------------------------ help */
  t.step('help');
  await sheet('How to use MindRoot', 'dialog[open].ws-sheet--help');
  var help = await page.evaluate(function () {
    var d = document.querySelector('dialog[open].ws-sheet--help');
    var r = d.getBoundingClientRect();
    return { text: d.innerText, bottom: r.bottom, left: r.left, focusInSearch: document.activeElement && document.activeElement.tagName === 'INPUT' };
  });
  t.check('a bottom sheet that names the keys and the Markdown', /Tab/.test(help.text) && /Markdown/.test(help.text) && help.bottom >= VIEW.height - 1 && help.left <= 1, help.text.slice(0, 120));
  t.eq(help.focusInSearch, false, 'opened by a finger, it does not raise the on-screen keyboard');
  await J.fingerSized('help');
  await closeSheet();

  /* ------------------------------------------------------------ view only */
  t.step('view only, and its X');
  await J.more('View only');
  await J.until(function () { return document.documentElement.getAttribute('data-mode') === 'view'; });
  await J.rest();
  t.eq(await page.isVisible('#thumbbar'), false, 'the thumb bar goes away');
  t.eq(await page.isVisible('.view-exit'), true, 'an X stays to come back');
  var before = await storeText();
  await J.settled();
  var mint = await J.nodeBox('Mint');
  if (mint) {
    /* A real double tap on any runner (fixtures/touch.js): two plain taps
     * delivered late would be two taps, and the check below would pass
     * without asking anything. */
    await T.doubleTap(cdp, [mint.x + 12, mint.y + mint.h / 2]);
    await t.sleep(300);
  }
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-node--editing'); }), false, 'a double tap does not open a node for writing');
  t.eq(await storeText(), before, 'nothing changes');
  await t.shot('view-only', page);
  await J.tapEl('.view-exit');
  await J.until(function () { return document.documentElement.getAttribute('data-mode') !== 'view'; });
  await J.rest();
  t.eq(await page.isVisible('#thumbbar'), true, 'its X brings the thumb bar back');

  /* ------------------------------------------------------------ language */
  t.step('the language switched in settings, and back');
  await sheet('Settings', 'dialog[open].ws-sheet--settings');
  await J.tapEl('dialog[open].ws-sheet--settings .seg__opt:has-text("Italiano")');
  await J.until(function () { return document.documentElement.lang === 'it'; });
  await J.until(function () { return /Impostazioni/.test(document.querySelector('dialog[open].ws-sheet--settings').innerText); });
  t.check('the sheet speaks Italian at once', true);
  await J.rest();
  await J.fingerSized('settings in Italian');
  await t.shot('settings-it', page);
  await closeSheet();
  await J.until(function () { var b = document.querySelector('#thumbbar [data-command="node.addChild"]'); return b && b.getAttribute('aria-label') === 'Aggiungi un figlio'; }).catch(function () {});
  var thumbIt = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#thumbbar [data-command]'), function (b) { return b.getAttribute('aria-label'); });
  });
  t.check('so does the thumb bar', thumbIt.indexOf('Aggiungi un figlio') >= 0, thumbIt);
  await sheet('Impostazioni', 'dialog[open].ws-sheet--settings');
  await J.tapEl('dialog[open].ws-sheet--settings .seg__opt:has-text("English")');
  await J.until(function () { return document.documentElement.lang === 'en'; });
  await closeSheet();
  var backToEnglish = await J.until(function () { return /Undo/.test(document.querySelector('#thumbbar [data-command="history.undo"]').getAttribute('aria-label') || ''); }).then(function () { return true; }, function () { return false; });
  t.check('and back to English', backToEnglish, await page.evaluate(function () { return document.querySelector('#thumbbar [data-command="history.undo"]').getAttribute('aria-label'); }));
  t.eq(await page.evaluate(function () { return document.scrollingElement.scrollWidth <= window.innerWidth; }), true, 'never a sideways scroll');
}
