/* touch-handles: a quick drag on any handle the app moves by hand, and a
 * tap at once after it: the tap is a click.
 *
 * Every one of these handles says touch-action: none and follows the finger
 * itself (a toast flicked away, the strip at the left edge that pulls the
 * drawer, the viewer's seam, its card's bar and corner, the Markdown
 * panel's grip, a sheet's pill and header, a note's corner, a floating
 * bar's grip, the colour picker's rails). Chromium still reads a quick drag
 * there as a fling with nothing to scroll, and takes the next tap anywhere
 * on the page, up to half a second later, as the touch that stops that
 * fling: it never became a click (a button pressed right after a drag did
 * nothing, and only when the hand was quick, which a loaded test runner
 * made it at random). The handles consume their touch moves
 * (ui.ownTouches), so no fling starts.
 *
 * Each drag is on the hand's clock (fixtures/touch.js: a move every 16 ms,
 * lifted at speed), so it is a quick drag on any machine, and each one
 * first proves the finger lands on the handle (elementFromPoint), so a
 * layout change cannot quietly make a step test nothing. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;
var T = require('../fixtures/touch.js');

var MAP = '# Handles\n\n- Alpha\n- Beta\n';

module.exports = async function (t) {
  /* A button of the test's own over everything, inside `host` (a modal
   * sheet leaves only itself to touch), that counts its clicks. */
  async function probe(page, host, where) {
    await page.evaluate(function (a) {
      var old = document.getElementById('probe');
      if (old) old.remove();
      var b = document.createElement('button');
      b.id = 'probe';
      b.type = 'button';
      b.textContent = 'probe';
      b.style.cssText = 'position:fixed;width:72px;height:44px;z-index:2147483647;' + a.where;
      b.addEventListener('click', function () { window.probeClicks = (window.probeClicks || 0) + 1; });
      (a.host ? document.querySelector(a.host) : document.body).appendChild(b);
    }, { host: host || null, where: where || 'left:8px;top:8px' });
  }
  function clicks(page) { return page.evaluate(function () { return window.probeClicks || 0; }); }

  /* A quick drag of `by` px from the middle of `selector` (or from `at`),
   * then a tap on the probe at once: one click. */
  async function dragThenTap(page, cdp, name, selector, by, at) {
    var r = await E.rectOf(page, selector);
    t.check(name + ': on screen', !!r && r.w > 0 && r.h > 0, r);
    if (!r || !r.w) return;
    var from = at ? at(r) : [r.x + r.w / 2, r.y + r.h / 2];
    var lands = await page.evaluate(function (a) {
      var el = document.elementFromPoint(a.x, a.y);
      return !!(el && el.closest(a.sel));
    }, { x: from[0], y: from[1], sel: selector });
    t.check(name + ': the finger lands on it', lands, { selector: selector, at: from });
    var before = await clicks(page);
    await T.swipe(cdp, from, [from[0] + by[0], from[1] + by[1]], 3);
    /* The tap at once, where the probe is now (inside a sheet that the
     * drag moved, it moves with it). */
    var b = await E.rectOf(page, '#probe');
    await T.tap(cdp, [b.x + b.w / 2, b.y + b.h / 2]);
    await E.until(page, function (n) { return (window.probeClicks || 0) > n; }, before, 1500).catch(function () {});
    t.eq((await clicks(page)) - before, 1, name + ': the tap right after the drag is a click');
  }

  /* ------------------------------------------------------------- a phone */
  var ctx = await t.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await E.H.stubMissing(ctx, t);
  var phone = await ctx.newPage();
  await E.boot(t, [['Handles', MAP]], { page: phone });
  var cdp = await ctx.newCDPSession(phone);
  await M.makeImage(phone, 'photo.png', { w: 300, h: 400, color: '#2f6fb3' });
  await phone.evaluate(function () { return window.MindRoot.media.addFiles([window.__files['photo.png']], { path: '0', field: 'line' }, { quiet: true }); });
  await E.settled(phone);
  await probe(phone);

  t.step('a toast flicked away');
  await phone.evaluate(function () { window.MindRoot.ui.toast('A toast to flick away', { duration: 60000 }); });
  await E.resting(phone, '.toast:not([hidden])');
  await dragThenTap(phone, cdp, 'the toast', '.toast:not([hidden])', [90, 0], function (r) { return [r.x + 24, r.y + r.h / 2]; });
  await E.until(phone, function () { return !document.querySelector('.toast:not([hidden])'); }, null, 4000).catch(function () {});
  t.eq(await phone.evaluate(function () { return !!document.querySelector('.toast:not([hidden])'); }), false, 'and the flick sent the toast away');

  t.step('the strip at the left edge');
  await dragThenTap(phone, cdp, 'the edge strip', '.edge-swipe', [0, -60], function (r) { return [r.x + r.w / 2, r.y + r.h / 2]; });
  t.eq(await phone.evaluate(function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; }), false, 'a drag along the edge does not pull the drawer');

  t.step('the viewer: the seam, the card\'s bar and its corner');
  await phone.evaluate(function () { window.MindRoot.prefs.set('viewer', 'split'); window.MindRoot.session.select('0'); window.MindRoot.media.openViewer('assets/photo.png'); });
  await E.until(phone, function () { var w = document.querySelector('#viewer .viewer__photo'); return w && w.hasAttribute('data-ready'); }, null, 6000);
  await E.resting(phone, '#viewer');
  await dragThenTap(phone, cdp, 'the seam', '#viewer .viewer__seam', [0, -30]);
  await phone.evaluate(function () { window.MindRoot.media.setViewerMode('card'); });
  await E.resting(phone, '#viewer');
  await dragThenTap(phone, cdp, 'the card\'s bar', '#viewer .viewer__bar[data-handle]', [-30, 20], function (r) { return [r.x + r.w * 0.3, r.y + r.h / 2]; });
  await E.resting(phone, '#viewer');
  await dragThenTap(phone, cdp, 'the card\'s corner', '#viewer .viewer__grip', [-20, -20]);
  await phone.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await E.until(phone, function () { return !window.MindRoot.media.viewerState(); }, null, 4000);

  t.step('a sheet: its pill and its header');
  await phone.evaluate(function () { window.MindRoot.commands.run('settings.open'); });
  await phone.waitForSelector('dialog[open].ws-sheet--settings .sheet__grip');
  await E.resting(phone, 'dialog[open].ws-sheet--settings');
  /* Inside the sheet: a modal sheet leaves nothing else to touch. */
  await probe(phone, 'dialog[open].ws-sheet--settings', 'right:8px;bottom:8px');
  await dragThenTap(phone, cdp, 'the sheet\'s pill', 'dialog[open] .sheet__grip', [0, -40]);
  await E.resting(phone, 'dialog[open].ws-sheet--settings');
  await dragThenTap(phone, cdp, 'the sheet\'s header', 'dialog[open] .sheet__title', [0, -40]);
  await E.resting(phone, 'dialog[open].ws-sheet--settings');
  t.check('the sheet is still open', await phone.evaluate(function () { return !!document.querySelector('dialog[open].ws-sheet--settings'); }));
  await phone.evaluate(function () { window.MindRoot.settings.close(); });
  await ctx.close();

  /* ------------------------------------------------------------ a tablet */
  var tctx = await t.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await E.H.stubMissing(tctx, t);
  var tab = await tctx.newPage();
  await E.boot(t, [['Handles', MAP]], { page: tab });
  var tcdp = await tctx.newCDPSession(tab);
  await probe(tab, null, 'left:8px;bottom:8px');

  t.step('the Markdown panel\'s grip');
  await tab.evaluate(function () { window.MindRoot.commands.run('source.toggle'); });
  await E.until(tab, function () { return document.documentElement.getAttribute('data-source') === 'open'; }, null, 6000);
  await E.resting(tab, '#source');
  await dragThenTap(tab, tcdp, 'the panel\'s grip', '.src-grip', [0, -30]);
  await tab.evaluate(function () { window.MindRoot.commands.run('source.toggle'); });
  await E.until(tab, function () { return document.documentElement.getAttribute('data-source') !== 'open'; }, null, 6000);

  t.step('a floating bar\'s grip');
  await tab.evaluate(function () { window.MindRoot.session.select('0'); });
  await E.until(tab, function () { var el = document.querySelector('.node-toolbar'); return el && !el.hidden; }, null, 4000);
  await E.resting(tab, '.node-toolbar');
  await dragThenTap(tab, tcdp, 'the node bar\'s grip', '.node-toolbar .bar-grip', [40, 30]);

  t.step('the colour picker\'s rails');
  await tab.evaluate(function () { window.MindRoot.commands.run('node.color', { source: 'menu' }); });
  await E.until(tab, function () { var p = document.querySelector('.colorpicker'); return p && !p.hidden; }, null, 4000);
  await E.resting(tab, '.colorpicker');
  if (await tab.evaluate(function () { return document.querySelector('.cp-custom').hidden; })) {
    await tab.tap('.cp-custom-toggle');
    await E.until(tab, function () { return !document.querySelector('.cp-custom').hidden; }, null, 4000);
    await E.resting(tab, '.cp-hue');
  }
  await dragThenTap(tab, tcdp, 'the hue rail', '.cp-hue', [60, 0], function (r) { return [r.x + r.w * 0.2, r.y + r.h / 2]; });
  await tab.keyboard.press('Escape');
  await E.until(tab, function () { var p = document.querySelector('.colorpicker'); return !p || p.hidden; }, null, 4000);

  t.step('a note\'s corner');
  await tab.evaluate(function () { return window.MindRoot.notes.open('0', 'node'); });
  await E.until(tab, function () { var el = document.querySelector('.note-bubble'); return el && !el.hidden; }, null, 4000);
  await E.resting(tab, '.note-bubble');
  await dragThenTap(tab, tcdp, 'the note\'s corner', '.note-bubble .note-bubble__resize', [30, 30]);
  await tctx.close();
};
