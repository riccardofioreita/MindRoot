#!/usr/bin/env node
/* MindRoot - opaque app icons for the PWA and iOS, from icons/logo-compact.svg.
 *
 *     node tools/make-icons.js
 *
 * The transparent PNGs in icons/ (192, 512, 1024) are the mark itself, for
 * "any" purpose. Two uses need an opaque square instead:
 *   - maskable icons (Android adaptive icons): the launcher crops to a circle
 *     or a squircle, and only the centre circle of 80% is guaranteed to stay,
 *     so the mark sits inside 60% of the side on the paper ground;
 *   - apple-touch-icon: iOS fills transparency with black, so it gets the
 *     same ground, with the mark a little larger (iOS only rounds corners).
 * Rendered by Chromium through Playwright, so the result is exactly what a
 * browser draws of the SVG. No network: the SVG goes in as a data URL. */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var GROUND = '#fbfbfc'; /* --paper, light: the same as the manifest background_color */

var OUTPUTS = [
  { file: 'icons/icon-maskable-192.png', size: 192, scale: 0.60 },
  { file: 'icons/icon-maskable-512.png', size: 512, scale: 0.60 },
  { file: 'icons/apple-touch-icon.png', size: 180, scale: 0.72 }
];

function loadPlaywright() {
  try { return require('playwright'); } catch (err) { /* try the usual global places */ }
  var roots = [path.join(ROOT, 'node_modules'), '/opt/node-tools/node_modules'];
  try { roots.push(require('child_process').execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (err) { /* no npm */ }
  for (var i = 0; i < roots.length; i++) {
    var p = path.join(roots[i], 'playwright');
    if (fs.existsSync(p)) return require(p);
  }
  console.error('playwright not found (npm i -D playwright).');
  process.exit(2);
}

async function main() {
  var pw = loadPlaywright();
  var svg = fs.readFileSync(path.join(ROOT, 'icons/logo-compact.svg'), 'utf8');
  var dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  var browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
  var page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  for (var i = 0; i < OUTPUTS.length; i++) {
    var o = OUTPUTS[i];
    var png = await page.evaluate(async function (args) {
      var img = new Image();
      img.src = args.dataUrl;
      await img.decode();
      var c = document.createElement('canvas');
      c.width = c.height = args.size;
      var g = c.getContext('2d');
      g.fillStyle = args.ground;
      g.fillRect(0, 0, args.size, args.size);
      var side = Math.round(args.size * args.scale);
      var at = Math.round((args.size - side) / 2);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, at, at, side, side);
      return c.toDataURL('image/png').split(',')[1];
    }, { dataUrl: dataUrl, size: o.size, scale: o.scale, ground: GROUND });
    fs.writeFileSync(path.join(ROOT, o.file), Buffer.from(png, 'base64'));
    console.log('wrote ' + o.file + ' (' + o.size + 'x' + o.size + ')');
  }
  await browser.close();
}

main().catch(function (err) { console.error(err); process.exit(1); });
