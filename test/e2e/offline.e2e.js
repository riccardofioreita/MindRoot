/* offline: MindRoot never needs the network, in each of the three ways it
 * is opened.
 *
 *   1. index.html from file://, double-clicked: a whole short journey - a
 *      project, nodes by keyboard, a picture from a file, the Markdown
 *      panel, an export, a reload - with not one request leaving the page
 *      (the runner turns any attempt red) and every resource the page
 *      loaded being file:, data: or blob:.
 *   2. Served over http: the service worker installs and takes the page;
 *      then the server goes away for everything, the worker included
 *      (test/fixtures/shell/server.js drops every connection) and the
 *      browser is told it is offline; the same journey runs on the cached
 *      shell, and survives a reload.
 *   3. dist/MindRoot.html, rebuilt here by tools/single.js: one file with
 *      nothing to fetch (no <script src>, no stylesheet link, no manifest,
 *      no worker), opened from file://, runs the journey too - the export
 *      font and the pictures included. */
'use strict';

var fs = require('fs');
var path = require('path');
var url = require('url');
var M = require('../fixtures/media/helpers.js');
var Server = require('../fixtures/shell/server.js');
var single = require('../../tools/single.js');

module.exports = async function (t) {
  /* ------------------------------------------------------------ file:// */
  t.step('index.html from file://');
  var ctx = await t.newContext({ viewport: { width: 1280, height: 800 } });
  var page = await ctx.newPage();
  await t.open('', { page: page });
  await journey(t, page, 'file');
  var schemes = await page.evaluate(function () {
    return performance.getEntriesByType('resource').map(function (e) { return e.name.split(':')[0]; })
      .filter(function (s, i, all) { return all.indexOf(s) === i; }).sort();
  });
  t.check('every resource came from the file system or the page itself', schemes.every(function (s) { return /^(file|data|blob)$/.test(s); }), schemes);
  t.eq(await page.evaluate(function () { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); }), false, 'no service worker on file://');
  t.eq(await page.evaluate(function () { return !!document.querySelector('link[rel="manifest"]'); }), false, 'and no manifest');
  await ctx.close();

  /* ------------------------------------------------------------ http, then offline */
  t.step('over http, then with the network gone');
  var server = await Server.start();
  var hctx = await t.newContext({ viewport: { width: 1280, height: 800 } });
  await Server.allow(hctx, server.base);
  var hp = await hctx.newPage();
  await t.open('', { page: hp, base: server.base });
  await hp.evaluate(function () { return navigator.serviceWorker.ready.then(function () { return true; }); });
  await hp.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, null, { timeout: 15000 });
  t.check('the service worker installed and controls the page', true);
  server.setOffline(true);
  await hctx.setOffline(true);
  await hp.reload();
  await hp.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  t.check('the app opens with no network at all', true);
  t.eq(await hp.evaluate(function () { return navigator.onLine; }), false, 'the browser knows it is offline');
  await journey(t, hp, 'offline');
  await hctx.setOffline(false);
  server.setOffline(false);
  await hctx.close();
  await server.close();

  /* ------------------------------------------------------------ the single file */
  t.step('dist/MindRoot.html, the single file');
  var built = single.build();
  fs.mkdirSync(path.dirname(single.OUT), { recursive: true });
  fs.writeFileSync(single.OUT, built.html);
  t.check('built just now by tools/single.js', fs.statSync(single.OUT).size > 100000);
  var sctx = await t.newContext({ viewport: { width: 1280, height: 800 } });
  var sp = await sctx.newPage();
  var href = url.pathToFileURL(single.OUT).href;
  await sp.goto(href + '?db=e2e-offline-single-' + Date.now().toString(36) + '&lang=en');
  await sp.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  var shape = await sp.evaluate(function () {
    return {
      /* The liquid-glass decoration may load later from a data: URL. */
      scripts: document.querySelectorAll('script[src]:not([src^="data:"])').length,
      sheets: document.querySelectorAll('link[rel="stylesheet"]').length,
      manifest: !!document.querySelector('link[rel="manifest"]'),
      pwa: !!window.MindRoot.pwa,
      worker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      font: getComputedStyle(document.querySelector('#stage') || document.body).getPropertyValue('--font-map') || ''
    };
  });
  t.same([shape.scripts, shape.sheets, shape.manifest, shape.pwa, shape.worker], [0, 0, false, false, false], 'nothing to fetch: no script or stylesheet files, no manifest, no worker');
  await journey(t, sp, 'single');
  var resources = await sp.evaluate(function () {
    return performance.getEntriesByType('resource').map(function (e) { return e.name.slice(0, 40); }).filter(function (n) { return !/^(data|blob):/.test(n); });
  });
  t.same(resources, [], 'it loaded nothing but itself, data: and blob: URLs');
  await sctx.close();
};

/* The short journey: a project from the sidebar, nodes by keyboard, a
 * picture from a file, the Markdown panel, a PNG export (with the bundled
 * font and the map inside), then a reload that keeps it all. */
async function journey(t, page, label) {
  function until(fn, arg, timeout) { return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: timeout || 10000, polling: 30 }); }
  function text() { return page.evaluate(function () { var c = window.MindRoot.session.current(); return c ? c.text : null; }); }
  var name = 'Offline ' + label;
  await page.click('#sidebar button[aria-label="New project"]');
  await until(function () { var d = document.querySelector('dialog[open]'); return d && d.contains(document.activeElement) && document.activeElement.tagName === 'INPUT'; });
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await until(function (n) { var c = window.MindRoot.session.current(); return c && c.map.name === n; }, name);
  await page.evaluate(function () { return window.MindRoot.session.view.settled(); });
  var root = await page.evaluate(function () {
    var el = document.querySelector('#stage .mv-node');
    var r = el.getBoundingClientRect();
    return { x: r.left + Math.min(30, r.width / 2), y: r.top + r.height / 2 };
  });
  await page.mouse.click(root.x, root.y);
  await until(function () { return window.MindRoot.session.selected() === ''; });
  await page.keyboard.press('Tab');
  await until(function () { var a = document.activeElement; return a && a.closest && a.closest('.mv-node--editing'); });
  await page.keyboard.type('Without a network');
  await page.keyboard.press('Enter');
  await until(function () { return !document.querySelector('.mv-node--editing'); });
  t.eq(await text(), '# ' + name + '\n\n## Without a network\n', label + ': nodes by keyboard');

  var chooser = page.waitForEvent('filechooser');
  await page.evaluate(function () { window.MindRoot.commands.run('media.image'); });
  await (await chooser).setFiles({ name: 'here.png', mimeType: 'image/png', buffer: M.png(undefined, 3) });
  await until(function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage img.mv-img'), function (img) { return img.complete && img.naturalWidth > 0 && /^blob:/.test(img.src); });
  });
  t.check(label + ': a picture from a file, shown from a blob', /!\[[^\]]*\]\(assets\/here\.png\) Without a network/.test(await text()), await text());

  await page.keyboard.press('Control+M');
  await page.waitForSelector('#source:not([hidden]) .src-field', { state: 'visible' });
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-field').value; }), await text(), label + ': the Markdown panel shows it');
  await page.keyboard.press('Control+M');
  await until(function () { return document.getElementById('source').hidden; });

  var download = page.waitForEvent('download');
  await page.evaluate(function () { window.MindRoot.commands.run('export.png'); });
  var png = await download;
  var bytes = fs.readFileSync(await png.path());
  t.check(label + ': a PNG export, carrying its map', bytes.slice(1, 4).toString('latin1') === 'PNG' && bytes.indexOf(Buffer.from('Without a network')) > 0);
  /* document.fonts.check() says true when no face of that family exists at
   * all, so the face itself is looked for: declared, and loaded from what
   * ships with the app. The export's own copy (a data: URL, so the SVG and
   * PNG carry the letters) must come from the bundle too. */
  var font = await page.evaluate(function () {
    return document.fonts.load('600 16px Montserrat').catch(function () { return []; }).then(function () {
      var faces = [];
      document.fonts.forEach(function (f) { faces.push({ family: f.family.replace(/["']/g, ''), status: f.status, weight: f.weight }); });
      return window.MindRoot.exporter.ensureFont().then(function (url) {
        return { faces: faces, url: typeof url === 'string' ? url.slice(0, 32) : String(url) };
      });
    });
  });
  t.check(label + ': the bundled Montserrat face is loaded', font.faces.some(function (f) { return f.family === 'Montserrat' && f.status === 'loaded'; }), font.faces);
  t.check(label + ': and the export embeds it as a woff2 data URL', /^data:font\/woff2/.test(font.url), font.url);

  var kept = await text();
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await until(function (n) { var c = window.MindRoot.session.current(); return c && c.map.name === n; }, name);
  t.eq(await text(), kept, label + ': a reload keeps every word');
  await until(function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage img.mv-img'), function (img) { return img.complete && img.naturalWidth > 0; });
  });
  t.check(label + ': and the picture', true);
}
