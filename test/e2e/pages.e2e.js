/* pages: MindRoot as GitHub Pages publishes it.
 *
 * tools/pages.js writes the folder .github/workflows/pages.yml uploads; this
 * builds the same folder, checks what is in it and what is not, and serves
 * it over http under a /MindRoot/ prefix, as https://<user>.github.io/MindRoot/
 * does (with nothing at all outside the prefix: a request that escaped it
 * would be a 404 here, and somebody else's site there). Then: the app boots
 * at the folder's address and at index.html, asks for nothing outside the
 * prefix, the manifest is linked and valid with start_url and scope inside
 * the prefix, the service worker registers with the prefix as its scope and
 * takes the page, a map written there survives an offline reload (the
 * server dropping every connection, the worker's own included), and the
 * folder's own address opens offline too. */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var Pages = require('../../tools/pages.js');
var Server = require('../fixtures/shell/server.js');

var PREFIX = '/MindRoot/';
var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8'
};

/* A static server over `dir`, mounted at PREFIX the way Pages mounts a
 * project site: '/MindRoot' redirects to '/MindRoot/', a folder answers
 * with its index.html, and everything outside the prefix is a 404 (and is
 * remembered, so the suite can say what escaped). */
function serveUnder(dir) {
  var state = { offline: false, hits: [], outside: [] };
  var server = http.createServer(function (req, res) {
    if (state.offline) { req.socket.destroy(); return; }
    var pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    state.hits.push(pathname);
    if (pathname === PREFIX.slice(0, -1)) { res.writeHead(301, { Location: PREFIX }); res.end(); return; }
    if (pathname.indexOf(PREFIX) !== 0) { state.outside.push(pathname); res.writeHead(404); res.end('not found'); return; }
    var rel = pathname.slice(PREFIX.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    var file = path.join(dir, rel);
    if (file.indexOf(dir + path.sep) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      var origin = 'http://127.0.0.1:' + server.address().port + '/';
      resolve({
        origin: origin,
        base: origin + PREFIX.slice(1),
        state: state,
        setOffline: function (v) { state.offline = !!v; },
        close: function () { return new Promise(function (r) { server.close(function () { r(); }); }); }
      });
    });
  });
}

async function booted(page) {
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
}

module.exports = async function (t) {
  /* ------------------------------------------------------------ the folder */
  t.step('the published folder');
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroot-pages-'));
  var site = path.join(dir, 'site');
  var copied = Pages.stage(site);
  t.check('tools/pages.js wrote the folder', copied.length > 40, copied.length);
  ['index.html', 'manifest.webmanifest', 'sw.js', 'README.md', 'README.it.md', 'LICENSE', '.nojekyll',
    'css/base.css', 'js/app.js', 'icons/icon-512.png', 'vendor/liquid-glass.iife.js', 'vendor/montserrat-font.js'].forEach(function (f) {
    t.check(f + ' is published', fs.existsSync(path.join(site, f)));
  });
  ['test', 'tools', 'docs', 'dist', '.git', '.github', '.gitignore', 'node_modules'].forEach(function (f) {
    t.check(f + ' is not published', !fs.existsSync(path.join(site, f)));
  });
  t.same(Pages.missing(site), [], 'every file index.html loads and sw.js precaches is there');
  t.eq(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), fs.readFileSync(path.join(t.root, 'index.html'), 'utf8'), 'index.html published as it is');

  t.step('the workflow');
  var yml = fs.readFileSync(path.join(t.root, '.github/workflows/pages.yml'), 'utf8');
  t.check('runs on a push to main', /on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/.test(yml));
  t.check('may deploy to Pages', /pages:\s*write/.test(yml) && /id-token:\s*write/.test(yml) && /contents:\s*read/.test(yml));
  t.check('one deployment at a time', /concurrency:\s*\n\s+group:\s*pages/.test(yml));
  ['actions/checkout@', 'actions/configure-pages@', 'actions/upload-pages-artifact@', 'actions/deploy-pages@'].forEach(function (a) {
    t.check('uses ' + a.slice(0, -1), yml.indexOf('uses: ' + a) >= 0);
  });
  t.check('builds the folder with tools/pages.js', /run:\s*node tools\/pages\.js _site\b/.test(yml));
  t.check('uploads that folder, .nojekyll included', /path:\s*_site\b/.test(yml) && /include-hidden-files:\s*true/.test(yml));
  t.check('deploys to the github-pages environment', /name:\s*github-pages/.test(yml));

  /* ------------------------------------------------------------ over http, under /MindRoot/ */
  t.step('boots under /MindRoot/');
  var srv = await serveUnder(site);
  var ctx = await t.newContext({ viewport: { width: 1280, height: 800 } });
  await Server.allow(ctx, srv.origin);
  var page = await ctx.newPage();
  var db = 'e2e-pages-' + Date.now().toString(36);
  /* The folder's own address, as a visitor types it. */
  await page.goto(srv.base + '?db=' + db + '&lang=en');
  await booted(page);
  t.check('the app boots at ' + PREFIX, true);
  t.same(srv.state.outside, [], 'nothing asked for outside ' + PREFIX);

  var manifest = await page.evaluate(async function () {
    var link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    var res = await fetch(link.href);
    var json = await res.json();
    return {
      href: link.href, status: res.status, type: res.headers.get('content-type'), name: json.name,
      start: new URL(json.start_url, link.href).href, scope: new URL(json.scope, link.href).href,
      icons: await Promise.all(json.icons.map(function (i) {
        return fetch(new URL(i.src, link.href).href).then(function (r) { return r.status; });
      }))
    };
  });
  t.check('manifest linked', !!manifest);
  t.eq(manifest && manifest.href, srv.base + 'manifest.webmanifest', 'manifest under the prefix');
  t.same(manifest && [manifest.status, manifest.type, manifest.name], [200, 'application/manifest+json', 'MindRoot'], 'manifest served and valid');
  t.eq(manifest && manifest.start, srv.base + 'index.html', 'start_url inside the prefix');
  t.eq(manifest && manifest.scope, srv.base, 'scope is the prefix');
  t.check('every icon of the manifest is there', manifest && manifest.icons.length > 3 && manifest.icons.every(function (s) { return s === 200; }), manifest && manifest.icons);

  t.step('the service worker');
  var reg = await page.evaluate(function () {
    return navigator.serviceWorker.ready.then(function (r) {
      return { scope: r.scope, script: r.active && r.active.scriptURL };
    });
  });
  t.eq(reg.scope, srv.base, 'registered with the prefix as its scope');
  t.eq(reg.script, srv.base + 'sw.js', 'the worker is the prefix\'s sw.js');
  await page.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, null, { timeout: 15000 });
  t.check('the worker controls the page', true);
  var cache = await page.evaluate(async function () {
    var keys = await caches.keys();
    var c = await caches.open(keys[0]);
    var urls = (await c.keys()).map(function (r) { return r.url; });
    return { keys: keys, urls: urls };
  });
  t.check('one mindroot2- cache', cache.keys.length === 1 && /^mindroot2-/.test(cache.keys[0]), cache.keys);
  t.check('the shell is cached under the prefix', cache.urls.indexOf(srv.base) >= 0 && cache.urls.indexOf(srv.base + 'index.html') >= 0 &&
    cache.urls.indexOf(srv.base + 'js/app.js') >= 0, cache.urls.slice(0, 5));
  t.check('nothing cached outside the prefix', cache.urls.every(function (u) { return u.indexOf(srv.base) === 0; }));

  t.step('a map survives an offline reload');
  var made = await page.evaluate(async function () {
    var ns = window.MindRoot;
    var p = ns.store.createProject({ name: 'Pages check', maps: [{ name: 'Offline map', text: '# Offline map\n\n- kept under the prefix\n' }] });
    var saved = await ns.storage.flush(true);
    return { id: p && p.id, saved: saved };
  });
  t.check('project written and saved', !!made.id && made.saved !== false, made);
  srv.setOffline(true);
  await ctx.setOffline(true);
  await page.reload();
  await booted(page);
  t.check('reloads with the network gone', true);
  var kept = await page.evaluate(function (id) {
    var p = window.MindRoot.store.project(id);
    return p ? p.maps.map(function (m) { return m.text; }) : null;
  }, made.id);
  t.same(kept, ['# Offline map\n\n- kept under the prefix\n'], 'the map is still there');
  await page.goto(srv.base + '?db=' + db + '&lang=en');
  await booted(page);
  t.check('the folder address opens offline as well', true);
  t.same(srv.state.outside, [], 'still nothing asked for outside ' + PREFIX);

  await ctx.setOffline(false);
  srv.setOffline(false);
  await ctx.close();
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
};
