#!/usr/bin/env node
/* MindRoot - the folder GitHub Pages publishes: the app's own files and
 * nothing else.
 *
 *     node tools/pages.js <dir>       copies the app into <dir> (made empty first)
 *     node tools/pages.js --list      prints what would be copied
 *
 * .github/workflows/pages.yml runs it on every push to main and uploads the
 * folder it writes; test/e2e/pages.e2e.js builds the same folder and serves
 * it under a /MindRoot/ prefix, the way https://<user>.github.io/MindRoot/
 * serves it. One list, so what is tested is what is published.
 *
 * Published: index.html, manifest.webmanifest, sw.js, css/, js/, icons/,
 * vendor/, README.md, README.it.md, LICENSE, plus an empty .nojekyll (the
 * Actions deployment runs no Jekyll anyway; the file says so to anyone who
 * publishes the folder another way). Left out: test/, tools/, docs/, dist/,
 * and every dotfile of the repository.
 *
 * Before it answers, the folder is checked: every file index.html loads and
 * every file the service worker precaches must be in it, or the build
 * fails - a site that installs without its shell is worse than none.
 *
 * The published sw.js carries its VERSION followed by a fingerprint of
 * every file it precaches ('2.0.0-4+3f9a1c2e'): the browser installs a new
 * worker, and drops the old copies, whenever any of those files changed,
 * even if nobody remembered to bump VERSION by hand (an installed app
 * would otherwise keep serving the old code, cache first, for ever).
 * Node built-ins only. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var crypto = require('crypto');

var ROOT = path.resolve(__dirname, '..');

var FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'README.md', 'README.it.md', 'LICENSE'];
var DIRS = ['css', 'js', 'icons', 'vendor'];
var MARKER = '.nojekyll';

/* Every file under a folder, as paths relative to ROOT with forward
 * slashes; dotfiles (an editor's leftovers) are not part of the app. */
function walk(rel) {
  var out = [];
  fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).forEach(function (d) {
    if (d.name.charAt(0) === '.') return;
    var child = rel + '/' + d.name;
    if (d.isDirectory()) out = out.concat(walk(child));
    else if (d.isFile()) out.push(child);
  });
  return out;
}

/* What is published, sorted. */
function list() {
  var out = FILES.slice();
  DIRS.forEach(function (dir) { out = out.concat(walk(dir)); });
  return out.sort();
}

/* The local files index.html names (src= and href=, not anchors, not
 * addresses elsewhere). */
function indexReferences(html) {
  var refs = [];
  html.replace(/\s(?:src|href)\s*=\s*"([^"]+)"/g, function (all, ref) {
    if (/^(#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return all;
    ref = ref.replace(/[?#].*$/, '');
    if (refs.indexOf(ref) < 0) refs.push(ref);
    return all;
  });
  return refs;
}

/* The service worker's precache list, read by running sw.js with a stub
 * `self` (it publishes the list as self.MINDROOT_PRECACHE). */
function precacheList(swSource) {
  var self = { addEventListener: function () {}, location: { origin: 'http://localhost' } };
  vm.runInNewContext(swSource, { self: self, caches: {}, fetch: function () {}, Request: function () {}, Response: {}, URL: URL, Promise: Promise });
  return Array.isArray(self.MINDROOT_PRECACHE) ? self.MINDROOT_PRECACHE.slice() : [];
}

/* What the folder lacks: [{ file, why }], empty when it is whole. */
function missing(dir) {
  var out = [];
  function need(rel, why) {
    if (rel === './' || rel === '') return;
    if (!fs.existsSync(path.join(dir, rel))) out.push({ file: rel, why: why });
  }
  need('index.html', 'the page');
  need(MARKER, 'the no-Jekyll marker');
  if (!out.length) {
    indexReferences(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).forEach(function (ref) { need(ref, 'loaded by index.html'); });
    precacheList(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8')).forEach(function (ref) { need(ref, 'precached by sw.js'); });
  }
  return out;
}

function emptyDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/* The published worker's VERSION, with the fingerprint of what it caches. */
function fingerprint(dir, swSource) {
  var hash = crypto.createHash('sha256');
  precacheList(swSource).forEach(function (ref) {
    var rel = ref === './' ? 'index.html' : ref;
    var file = path.join(dir, rel);
    if (rel === 'sw.js' || !fs.existsSync(file)) return;
    hash.update(rel + '\0');
    hash.update(fs.readFileSync(file));
  });
  return hash.digest('hex').slice(0, 8);
}

function stampWorker(dir) {
  var file = path.join(dir, 'sw.js');
  var src = fs.readFileSync(file, 'utf8');
  var re = /var VERSION = '([^'+]+)';/;
  if (!re.test(src)) throw new Error('sw.js has no VERSION to stamp');
  var print = fingerprint(dir, src);
  fs.writeFileSync(file, src.replace(re, function (all, v) { return "var VERSION = '" + v + '+' + print + "';"; }));
  return print;
}

/* Writes the published folder into `dir` and returns the files copied.
 * Throws when the result lacks a file the app needs. */
function stage(dir) {
  dir = path.resolve(dir);
  if (dir === ROOT || ROOT.indexOf(dir + path.sep) === 0) throw new Error('refusing to empty ' + dir);
  emptyDir(dir);
  var files = list();
  files.forEach(function (rel) {
    var to = path.join(dir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), to);
  });
  fs.writeFileSync(path.join(dir, MARKER), '');
  stampWorker(dir);
  var gaps = missing(dir);
  if (gaps.length) {
    throw new Error('the published folder lacks ' + gaps.map(function (g) { return g.file + ' (' + g.why + ')'; }).join(', '));
  }
  return files.concat([MARKER]);
}

module.exports = { FILES: FILES, DIRS: DIRS, MARKER: MARKER, list: list, stage: stage, missing: missing, indexReferences: indexReferences, precacheList: precacheList, fingerprint: fingerprint };

if (require.main === module) {
  var arg = process.argv[2];
  if (arg === '--list') {
    list().concat([MARKER]).forEach(function (f) { console.log(f); });
  } else if (!arg) {
    console.error('usage: node tools/pages.js <dir> | --list');
    process.exit(2);
  } else {
    try {
      var copied = stage(arg);
      console.log('PAGES OK (' + copied.length + ' files in ' + path.relative(process.cwd(), path.resolve(arg)) + ')');
    } catch (err) {
      console.error('PAGES FAILED: ' + err.message);
      process.exit(1);
    }
  }
}
