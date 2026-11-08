#!/usr/bin/env node
/* MindRoot - screenshots of the paper gallery, to look at the drawings.
 *
 *     node test/fixtures/paper/shoot.js [outdir] [query]
 *
 * Opens test/fixtures/paper/gallery.html from file:// in headless Chromium
 * (network blocked, as in test/run.js), waits until every picture decoded,
 * and writes gallery.png (the whole page) plus one close-up per paper at
 * full A4 size into outdir (default test/out/paper). Not a suite: the
 * suites check geometry with numbers; this is for the eyes. */
'use strict';

var path = require('path');
var fs = require('fs');
var url = require('url');
var child = require('child_process');

function playwright() {
  try { return require('playwright'); } catch (err) { /* look further */ }
  var roots = [path.resolve(__dirname, '../../../node_modules'), '/opt/node-tools/node_modules'];
  try { roots.push(child.execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (err) { /* no npm */ }
  for (var i = 0; i < roots.length; i++) {
    var p = path.join(roots[i], 'playwright');
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('playwright not found');
}

async function main() {
  var out = path.resolve(process.argv[2] || path.resolve(__dirname, '../../out/paper'));
  var query = process.argv[3] || '';
  fs.mkdirSync(out, { recursive: true });
  var pw = playwright();
  var browser = await pw.chromium.launch();
  var context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', function (route) {
    var u = route.request().url();
    if (/^(file|data|blob|about):/.test(u)) return route.continue();
    return route.abort();
  });
  var page = await context.newPage();
  var errors = [];
  page.on('pageerror', function (e) { errors.push(String(e)); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
  var base = url.pathToFileURL(path.resolve(__dirname, 'gallery.html')).href;
  await page.goto(base + (query ? '?' + query : ''));
  await page.waitForFunction(function () { return !!window.galleryReady; });
  var ready = await page.evaluate(function () { return window.galleryReady; });
  await page.screenshot({ path: path.join(out, 'gallery.png'), fullPage: true });
  if (!/only=/.test(query)) {
    var ids = await page.evaluate(function () { return window.MindRoot.paper.CATALOG.map(function (e) { return e.id; }); });
    for (var i = 0; i < ids.length; i++) {
      await page.goto(base + '?canvas=0&width=560&only=' + ids[i] + (query ? '&' + query : ''));
      await page.waitForFunction(function () { return !!window.galleryReady; });
      await page.screenshot({ path: path.join(out, ids[i] + '.png'), fullPage: true });
    }
  }
  await browser.close();
  console.log(JSON.stringify({ out: out, ready: ready, errors: errors }));
  if (errors.length || ready.failed) process.exit(1);
}

main().catch(function (err) { console.error(err); process.exit(2); });
