/* pwa: the manifest is valid and its icons are what it says; the service
 * worker's precache list names every file index.html loads; over http the
 * manifest is linked, the worker installs, the app reloads with the network
 * off, a new version announces itself and only old mindroot2-* caches are
 * removed; on file:// nothing of this is touched. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var zlib = require('zlib');
var H = require('../fixtures/shell/helpers.js');
var Server = require('../fixtures/shell/server.js');

function read(rel) { return fs.readFileSync(path.join(H.ROOT, rel)); }

/* Width, height, colour type, and the first pixel (row 0 needs no
 * reconstruction for its first pixel, whatever the filter). */
function png(rel) {
  var b = read(rel);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  var info = { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
  var idat = [];
  for (var off = 8; off < b.length;) {
    var len = b.readUInt32BE(off);
    var type = b.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(b.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  var raw = zlib.inflateSync(Buffer.concat(idat));
  var channels = info.colorType === 6 ? 4 : info.colorType === 2 ? 3 : 1;
  info.firstPixel = Array.prototype.slice.call(raw, 1, 1 + channels);
  return info;
}

function precacheList() {
  var src = read('sw.js').toString('utf8');
  var self = { addEventListener: function () {}, location: { origin: 'http://localhost' } };
  vm.runInNewContext(src, { self: self, caches: {}, fetch: function () {}, Request: function () {}, Response: {}, URL: URL, Promise: Promise });
  return self.MINDROOT_PRECACHE;
}

module.exports = async function (t) {
  t.step('manifest');
  var manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));
  t.eq(manifest.name, 'MindRoot', 'name');
  t.check('short name fits a home screen', manifest.short_name && manifest.short_name.length <= 12, manifest.short_name);
  t.eq(manifest.display, 'standalone', 'standalone');
  t.eq(manifest.start_url, './index.html', 'relative start_url');
  t.eq(manifest.scope, './', 'relative scope');
  var tokens = read('css/tokens.css').toString('utf8');
  var paper = /--paper:\s*(#[0-9a-f]{6})/i.exec(tokens)[1];
  t.eq(manifest.background_color, paper, 'background from the paper token');
  t.eq(manifest.theme_color, paper, 'theme colour from the paper token');
  manifest.icons.forEach(function (icon) {
    t.check('icon exists: ' + icon.src, fs.existsSync(path.join(H.ROOT, icon.src)));
    if (icon.type === 'image/png') {
      var info = png(icon.src);
      t.eq(info && info.w + 'x' + info.h, icon.sizes, 'declared size of ' + icon.src);
    }
  });
  var maskable = manifest.icons.filter(function (i) { return /maskable/.test(i.purpose) && i.sizes === '512x512'; })[0];
  t.check('a 512 maskable icon', !!maskable);
  var m = png(maskable.src);
  t.check('maskable is opaque at the corner (launchers crop it)', m.colorType === 2 || m.firstPixel[3] === 255, m);
  var touch = png('icons/apple-touch-icon.png');
  t.check('apple-touch-icon is opaque (iOS paints transparency black)', touch.colorType === 2 || touch.firstPixel[3] === 255, touch);
  var handlers = manifest.file_handlers && manifest.file_handlers[0];
  t.check('opens .md files when installed', handlers && JSON.stringify(handlers.accept).indexOf('.md') >= 0, handlers);

  t.step('the precache list matches index.html');
  var list = precacheList();
  var refs = H.indexReferences();
  t.check('index.html references found', refs.length > 40, refs.length);
  t.same(refs.filter(function (r) { return list.indexOf(r) < 0; }), [], 'every file index.html loads is precached');
  t.same(manifest.icons.map(function (i) { return i.src; }).filter(function (r) { return list.indexOf(r) < 0; }), [], 'every manifest icon is precached');
  var fontRefs = [];
  read('css/fonts.css').toString('utf8').replace(/url\("?([^")]+)"?\)/g, function (w, u) { fontRefs.push('css/' + u); return w; });
  t.same(fontRefs.filter(function (r) { return list.indexOf(r) < 0; }), [], 'fonts are precached');
  ['manifest.webmanifest', 'vendor/liquid-glass.iife.js', 'vendor/montserrat-font.js', 'index.html', './'].forEach(function (f) {
    t.check(f + ' precached', list.indexOf(f) >= 0);
  });
  var stale = list.filter(function (f) { return f !== './' && !fs.existsSync(path.join(H.ROOT, f)) && H.OTHERS.indexOf(f) < 0; });
  t.same(stale, [], 'no entry names a file that cannot exist');
  var dupes = list.filter(function (f, i) { return list.indexOf(f) !== i; });
  t.same(dupes, [], 'no duplicates');

  /* The runner's server when every module exists; until then a local one
   * that can stub the missing ones for the worker too (see server.js). */
  var own = await Server.start();
  var useOwn = H.missing().length > 0;
  if (useOwn) t.log('missing modules: the http part runs on the shell\'s own local server');

  t.step('over http: manifest, worker, offline');
  var base = useOwn ? own.base : await t.serve();
  var ctx = await H.context(t);
  if (useOwn) await Server.allow(ctx, own.base);
  var page = await ctx.newPage();
  await t.open('', { page: page, base: base });
  t.eq(await page.evaluate(function () { var l = document.querySelector('link[rel="manifest"]'); return l && l.getAttribute('href'); }), 'manifest.webmanifest', 'manifest linked over http');
  var served = await page.evaluate(function () {
    return fetch('manifest.webmanifest').then(function (r) {
      return r.json().then(function (j) { return { status: r.status, type: r.headers.get('content-type'), name: j.name }; });
    });
  });
  t.same(served, { status: 200, type: 'application/manifest+json', name: 'MindRoot' }, 'manifest served and valid JSON');
  await page.evaluate(function () { return navigator.serviceWorker.ready.then(function () { return true; }); });
  await H.until(page, function () { return !!navigator.serviceWorker.controller; }, null, 15000);
  t.check('the worker controls the page', true);
  var cache = await page.evaluate(async function () {
    var keys = await caches.keys();
    var c = await caches.open(keys[0]);
    var entries = await c.keys();
    return { keys: keys, count: entries.length, hasIndex: entries.some(function (r) { return /\/index\.html$/.test(r.url); }), hasApp: entries.some(function (r) { return /\/js\/app\.js$/.test(r.url); }) };
  });
  t.check('one versioned cache', cache.keys.length === 1 && /^mindroot2-/.test(cache.keys[0]), cache);
  t.check('the shell is in it', cache.hasIndex && cache.hasApp && cache.count >= 15, cache);

  /* The store listener itself, called directly: emitting made-up store
   * changes on the bus would reach every real subscriber too. persist() is
   * watched on the real storage object and put back as it was. (It also
   * waits for the person's first interaction, which cannot be left out
   * here: every evaluate Playwright runs counts as a user gesture.) */
  await page.click('#title');
  var persisted = await page.evaluate(function () {
    var ns = window.MindRoot;
    var hadStorage = Object.prototype.hasOwnProperty.call(ns, 'storage');
    var storage = ns.storage || (ns.storage = {});
    var hadPersist = Object.prototype.hasOwnProperty.call(storage, 'persist');
    var realPersist = storage.persist;
    var calls = 0;
    storage.persist = function () { calls++; return Promise.resolve(true); };
    try {
      var asked = [ns.pwa.onStoreChange({ type: 'init' }), ns.pwa.onStoreChange({ type: 'ui' }), ns.pwa.onStoreChange(null)];
      var beforeEdit = calls;
      asked.push(ns.pwa.onStoreChange({ type: 'map:text', label: 'rename the node' }));
      asked.push(ns.pwa.onStoreChange({ type: 'map:text', label: 'rename the node' }));
      return { beforeEdit: beforeEdit, after: calls, asked: asked, wired: ns.bus.count('store') > 0 };
    } finally {
      if (hadPersist) storage.persist = realPersist; else delete storage.persist;
      if (!hadStorage) delete ns.storage;
    }
  });
  t.same(persisted, { beforeEdit: 0, after: 1, asked: [false, false, false, true, false], wired: true }, 'persistent storage asked once, after the first real edit');

  await ctx.setOffline(true);
  if (useOwn) own.setOffline(true);
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  t.check('boots again with the network off', true);
  t.eq(await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }), 'rgb(251, 251, 252)', 'styles came from the cache');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('#topbar-actions .btn').length > 0; }), true, 'the shell is there');
  await page.goto(base + 'index.html?db=e2e-pwa-other&lang=it');
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  t.eq(await page.evaluate(function () { return document.documentElement.lang; }), 'it', 'any query opens the same cached shell');
  await ctx.setOffline(false);
  own.setOffline(false);
  await ctx.close();

  t.step('a new version announces itself and cleans up after itself');
  var uctx = await H.context(t);
  await Server.allow(uctx, own.base);
  var upage = await uctx.newPage();
  await t.open('', { page: upage, base: own.base, lang: 'it' });
  await upage.evaluate(function () { return navigator.serviceWorker.ready.then(function () { return true; }); });
  await H.until(upage, function () { return !!navigator.serviceWorker.controller; }, null, 15000);
  await upage.evaluate(async function () {
    await caches.open('otherapp-v1');
    await caches.open('mindroot2-0.0.1-old');
  });
  own.setVersion('e2e-next');
  await upage.evaluate(function () { return navigator.serviceWorker.getRegistration().then(function (r) { return r.update(); }); });
  await H.until(upage, function () {
    var el = document.querySelector('.banner[data-banner="pwa-update"]:not([hidden])');
    return el && /nuova versione/i.test(el.textContent);
  }, null, 20000);
  t.check('a reload is offered, in a banner', /Ricarica/.test(await upage.textContent('.banner[data-banner="pwa-update"]')));
  t.eq(await upage.evaluate(function () { return document.documentElement.getAttribute('data-booted'); }), '', 'the open page was not reloaded behind the person\'s back');
  await upage.evaluate(function () {
    var ns = window.MindRoot;
    ns.ui.toast(ns.i18n.t('media.inTrash'), { action: { label: ns.i18n.t('ui.undo'), run: function () {} } });
  });
  await H.until(upage, function () { return document.querySelector('.toast:not([hidden])'); });
  t.eq(await upage.evaluate(function () { return !!document.querySelector('.banner[data-banner="pwa-update"]:not([hidden])'); }), true, 'a toast that follows does not take the offer away');
  /* The controller changes as soon as the new worker activates (skipWaiting);
   * its clean-up finishes a moment later. */
  var keys = [];
  for (var tries = 0; tries < 50; tries++) {
    keys = await upage.evaluate(function () { return caches.keys(); });
    if (keys.filter(function (k) { return /^mindroot2-/.test(k); }).length === 1) break;
    await t.sleep(100);
  }
  t.check('the new cache only, among ours', keys.indexOf('mindroot2-e2e-next') >= 0 && !keys.some(function (k) { return /^mindroot2-/.test(k) && k !== 'mindroot2-e2e-next'; }), keys);
  t.check('another app\'s cache is left alone', keys.indexOf('otherapp-v1') >= 0, keys);
  await upage.click('.banner[data-banner="pwa-update"] .btn--primary');
  await upage.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  t.eq(await upage.evaluate(function () { return !!document.querySelector('.banner[data-banner="pwa-update"]'); }), false, 'reloaded into the new version');
  await uctx.close();
  await own.close();

  t.step('file:// touches nothing');
  var fctx = await H.context(t);
  var fpage = await fctx.newPage();
  var asked = [];
  fpage.on('request', function (r) { if (/manifest|sw\.js/.test(r.url())) asked.push(r.url()); });
  await t.open('', { page: fpage });
  t.eq(await fpage.$('link[rel="manifest"]'), null, 'no manifest link');
  t.same(asked, [], 'no manifest or worker request');
  t.eq(await fpage.evaluate(function () { return window.MindRoot.pwa.registration(); }), null, 'no registration');
  t.eq(await fpage.evaluate(function () { return window.MindRoot.commands.has('app.install'); }), false, 'no install command');
};
