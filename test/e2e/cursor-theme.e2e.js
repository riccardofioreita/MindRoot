/* cursor-theme: inside the app the mouse pointer is MindRoot's own arrow -
 * the navigation arrow of the drawing editor's select tool, drawn as an SVG
 * cursor in the colours of the theme (dark ink ringed with white on the
 * light theme, light ink ringed with near-black on the dark one), one SVG
 * picture of 32 px drawn by the browser at the screen's density, its
 * hotspot on the tip at (6, 4).
 *
 * It is the cursor of the page and of the buttons; the I-beam stays in text
 * fields, grab on the empty map, the hand on links. It follows the theme
 * live (light, dark, and the system's scheme while the theme is "system").
 * The setting "MindRoot pointer" (Settings > Appearance, on by default)
 * gives the system's cursors back, at once and after a reload. A phone (a
 * coarse pointer, nothing that hovers) and forced colours keep the system's
 * cursors.
 *
 * Screenshots: the two cursor pictures at 1x, at 2x and magnified, on light
 * and dark paper (test/out/cursor-theme-arrows.png), and the arrow drawn
 * where the pointer is over the real app in both themes. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var TIP = 'M5.5 3.5l12.5 7-5.8 1.6-2.7 5.9z';

/* What the pointer is over an element: 'light' or 'dark' for MindRoot's
 * arrow of that theme, else the computed keyword. */
function readCursor(page, selector) {
  return page.evaluate(function (a) {
    var el = typeof a.sel === 'string' ? document.querySelector(a.sel) : null;
    if (!el) return 'missing:' + a.sel;
    var c = getComputedStyle(el).cursor;
    if (c.indexOf(a.tip) < 0) return c;
    var hot = / 6 4, default$/.test(c);
    var fill = /fill='%23([0-9a-f]{6})'/.exec(c);
    /* One vector picture at 32 px (the browser draws it at the screen's
       density); not image-set(), which crashed Chromium's renderer. */
    var both = /^url\("data:image\/svg\+xml,/.test(c) && c.indexOf("width='32'") > 0 && c.indexOf('image-set') < 0;
    var name = fill && fill[1] === '15171c' ? 'light' : (fill && fill[1] === 'e4e6ea' ? 'dark' : 'other:' + (fill && fill[1]));
    return name + (hot ? '' : ':no-hotspot') + (both ? '' : ':not-one-svg');
  }, { sel: selector, tip: TIP });
}

async function all(page) {
  return {
    body: await readCursor(page, 'body'),
    button: await readCursor(page, '#topbar button'),
    map: await readCursor(page, '#stage .mv'),
    node: await readCursor(page, '#stage .mv-node')
  };
}

module.exports = async function (t) {
  var b = await W.boot(t, [{ name: 'Garden', maps: [['Beds', '# Beds\n\n- North\n- South\n']] }]);
  var page = b.page;

  t.step('light theme: the dark arrow');
  await page.evaluate(function () { window.MindRoot.prefs.set('theme', 'light'); });
  await until(page, function () { return document.documentElement.getAttribute('data-theme') === 'light'; });
  t.same(await all(page), { body: 'light', button: 'light', map: 'grab', node: 'light' }, 'the page, a button and a node: the arrow; the empty map: grab');

  t.step('text fields keep the I-beam, links the hand');
  await page.focus('#stage .mv');
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('.palette input'); });
  t.eq(await readCursor(page, '.palette input'), 'text', 'the palette field: I-beam');
  t.check('and the palette rows the arrow', /^light/.test(await readCursor(page, '.palette__item')), await readCursor(page, '.palette__item'));
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('.palette input'); });
  var link = await page.evaluate(function () {
    var a = document.createElement('a');
    a.href = '#x';
    a.id = 'probe-link';
    a.textContent = 'link';
    document.body.appendChild(a);
    var c = getComputedStyle(a).cursor;
    a.remove();
    return c;
  });
  t.eq(link, 'pointer', 'a link keeps the hand');
  await page.evaluate(function () { window.MindRoot.session.select('0'); window.MindRoot.editor.startRename('0'); });
  await until(page, function () { var el = document.activeElement; return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable); });
  var field = await page.evaluate(function () {
    var el = document.activeElement;
    return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable) ? getComputedStyle(el).cursor : 'no field:' + (el && el.tagName);
  });
  t.eq(field, 'text', 'the rename field: I-beam');
  await page.keyboard.press('Escape');
  /* The I-beam rule has no weight of its own: the Markdown panel's field
   * shows the arrow over its fold gutter (data-over-fold), as it asks. */
  await page.evaluate(function () { window.MindRoot.commands.run('source.toggle', { source: 'test' }); });
  await until(page, function () { var f = document.querySelector('.src-field'); return !!(f && f.getClientRects().length); });
  t.eq(await readCursor(page, '.src-field'), 'text', 'the Markdown field: I-beam');
  var gutter = await page.evaluate(function () {
    var f = document.querySelector('.src-field');
    f.setAttribute('data-over-fold', '');
    var c = getComputedStyle(f).cursor;
    f.removeAttribute('data-over-fold');
    return c;
  });
  t.check('over its fold gutter: the arrow, not the I-beam', gutter.indexOf(TIP) >= 0 && /fill='%2315171c'/.test(gutter), gutter.slice(0, 60));
  await page.evaluate(function () { window.MindRoot.commands.run('source.toggle', { source: 'test' }); });
  await until(page, function () { var f = document.querySelector('.src-field'); return !f || !f.getClientRects().length; });

  t.step('dark theme: the light arrow, switched live');
  await page.evaluate(function () { window.MindRoot.prefs.set('theme', 'dark'); });
  await until(page, function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  t.same(await all(page), { body: 'dark', button: 'dark', map: 'grab', node: 'dark' }, 'every arrow is the light one');
  await page.mouse.move(640, 22);
  await t.shot('app-dark');

  t.step('theme "system" follows the scheme of the system');
  await page.evaluate(function () { window.MindRoot.prefs.set('theme', 'system'); });
  await until(page, function () { return !document.documentElement.hasAttribute('data-theme'); });
  await page.emulateMedia({ colorScheme: 'dark' });
  t.eq(await readCursor(page, 'body'), 'dark', 'the system dark: the light arrow');
  await page.emulateMedia({ colorScheme: 'light' });
  t.eq(await readCursor(page, 'body'), 'light', 'the system light: the dark arrow');

  t.step('the setting gives the system cursor back');
  await page.keyboard.press('Control+Comma');
  await until(page, function () { return !!document.getElementById('set-cursor'); });
  var row = await page.evaluate(function () {
    var sw = document.getElementById('set-cursor');
    var look = sw.closest('.ws-section');
    return { on: sw.getAttribute('aria-checked'), label: document.getElementById('set-cursor-label').textContent, section: look ? look.querySelector('.ws-section__title').textContent : null };
  });
  t.same(row, { on: 'true', label: 'MindRoot pointer', section: 'Appearance' }, 'on by default, under Appearance');
  t.check('the sheet itself shows the arrow', /^light/.test(await readCursor(page, '#set-cursor')), await readCursor(page, '#set-cursor'));
  await page.click('#set-cursor');
  await until(page, function () { return document.documentElement.getAttribute('data-cursor') === 'system'; });
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('appCursor'); }), false, 'the preference is off');
  t.eq(await readCursor(page, '#set-cursor'), 'pointer', 'a button: the system hand');
  t.eq(await readCursor(page, 'body'), 'auto', 'the page: the system cursor');
  t.eq(await readCursor(page, '#stage .mv'), 'grab', 'the map still grabs');
  await page.keyboard.press('Escape');
  await page.evaluate(function () { return window.MindRoot.prefs.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; });
  t.eq(await page.evaluate(function () { return document.documentElement.getAttribute('data-cursor'); }), 'system', 'kept after a reload, from the first paint');
  t.eq(await readCursor(page, 'body'), 'auto', 'still the system cursor');
  await page.evaluate(function () { window.MindRoot.prefs.set('appCursor', true); });
  await until(page, function () { return !document.documentElement.hasAttribute('data-cursor'); });
  t.eq(await readCursor(page, 'body'), 'light', 'back on: the arrow again');

  t.step('the Italian label');
  var it = await page.evaluate(function () { window.MindRoot.i18n.setLang('it'); var r = [window.MindRoot.i18n.t('settings.cursor'), window.MindRoot.i18n.t('settings.cursorHint')]; window.MindRoot.i18n.setLang('en'); return r; });
  t.eq(it[0], 'Puntatore MindRoot', 'Puntatore MindRoot');
  t.check('its hint in Italian, house style', /puntatore di sistema/.test(it[1]) && !/[!—]/.test(it[1]), it[1]);

  t.step('the pictures, looked at');
  var sets = await page.evaluate(function () {
    var cs = getComputedStyle(document.documentElement);
    function urls(v) { var out = []; v.replace(/url\("([^"]+)"\)/g, function (w, u) { out.push(u); return w; }); return out; }
    return [urls(cs.getPropertyValue('--cursor-arrow-light')), urls(cs.getPropertyValue('--cursor-arrow-dark'))];
  });
  /* Drawn on a page of their own: nothing of the app over them. */
  var probe = await (await t.newContext({ viewport: { width: 1400, height: 340 } })).newPage();
  await probe.setContent('<!doctype html><body style="margin:0"></body>');
  var shot = await probe.evaluate(async function (sets) {
    var light = sets[0];
    var dark = sets[1];
    var host = document.createElement('div');
    host.id = 'arrow-probe';
    host.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;min-height:100vh';
    function load(src) { return new Promise(function (r) { var i = new Image(); i.onload = function () { r(i); }; i.onerror = function () { r(null); }; i.src = src; }); }
    var report = [];
    for (var k = 0; k < 2; k++) {
      var set = k ? dark : light;
      var pane = document.createElement('div');
      pane.style.cssText = 'display:flex;align-items:flex-start;gap:24px;padding:24px;background:' + (k ? '#131519' : '#fbfbfc');
      /* The one picture of the theme, rasterised as a 1x screen and as a
         2x screen would draw it. */
      for (var s = 0; s < 2; s++) {
        var img = await load(set[0]);
        if (!img || set.length !== 1) { report.push('pictures:' + set.length); continue; }
        var c = document.createElement('canvas');
        var dpr = s ? 2 : 1;
        c.width = img.naturalWidth * dpr; c.height = img.naturalHeight * dpr;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        report.push(c.width + 'x' + c.height);
        var data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        /* The tip: the hotspot pixel (6, 4 at 1x) is painted, and nothing
           left of it or above it on its own row and column. */
        var scale = c.width / 32;
        var hx = 6 * scale, hy = 4 * scale;
        var at = function (x, y) { return data[(y * c.width + x) * 4 + 3]; };
        report.push('tip:' + (at(hx, hy) > 0 ? 'painted' : 'empty') + ',' + (at(Math.max(0, hx - 3 * scale), hy) === 0 ? 'clear-left' : 'ink-left') + ',' + (at(hx, Math.max(0, hy - 3 * scale)) === 0 ? 'clear-above' : 'ink-above'));
        var big = document.createElement('canvas');
        var mag = s ? 4 : 8;
        big.width = c.width * mag; big.height = c.height * mag;
        var g = big.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(c, 0, 0, big.width, big.height);
        /* The hotspot pixel, outlined in red on the magnified copy. */
        g.strokeStyle = '#ff2d55';
        g.lineWidth = 2;
        g.strokeRect(hx * mag, hy * mag, mag, mag);
        pane.appendChild(c);
        pane.appendChild(big);
      }
      host.appendChild(pane);
    }
    document.body.appendChild(host);
    return report;
  }, sets);
  t.same(shot, ['32x32', 'tip:painted,clear-left,clear-above', '64x64', 'tip:painted,clear-left,clear-above', '32x32', 'tip:painted,clear-left,clear-above', '64x64', 'tip:painted,clear-left,clear-above'],
    'one 32 px picture per theme, sharp at 1x (32 px) and 2x (64 px); the hotspot pixel is the tip');
  var file = await t.shot('arrows', probe);
  t.log('cursor pictures: ' + file);

  t.step('a phone: the system cursors');
  var phone = await (await W.context(t, 'phone')).newPage();
  await t.open('', { page: phone });
  var ph = await phone.evaluate(function () {
    return { coarse: matchMedia('(pointer: coarse)').matches, hovers: matchMedia('(any-hover: hover) and (any-pointer: fine)').matches, body: getComputedStyle(document.body).cursor, set: getComputedStyle(document.documentElement).getPropertyValue('--mr-cursor').trim() };
  });
  t.same([ph.coarse, ph.hovers, ph.body, ph.set], [true, false, 'auto', ''], 'coarse and nothing hovers: no picture cursor at all');

  t.step('forced colours: the system cursors');
  var fc = await (await t.newContext({ forcedColors: 'active' })).newPage();
  await t.open('', { page: fc });
  var f = await fc.evaluate(function () {
    var btn = document.querySelector('#topbar button');
    return { forced: matchMedia('(forced-colors: active)').matches, body: getComputedStyle(document.body).cursor, button: btn ? getComputedStyle(btn).cursor : null };
  });
  t.same(f, { forced: true, body: 'auto', button: 'pointer' }, 'the page auto, buttons the hand');
};
