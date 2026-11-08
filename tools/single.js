#!/usr/bin/env node
/* MindRoot - build dist/MindRoot.html: the whole app in one file.
 *
 *     node tools/single.js            writes dist/MindRoot.html
 *     node tools/single.js --check    builds in memory and verifies only
 *
 * index.html already opens by double-click; this is for carrying MindRoot
 * as a single attachment (an e-mail, a USB stick, a phone's Files app) where
 * a folder would fall apart. Everything index.html loads is put inside it:
 *
 *   - every <link rel="stylesheet"> becomes a <style>, its url()s (the
 *     Montserrat woff2) data: URLs;
 *   - every <script src> becomes an inline script, with "</script" and
 *     "<!--" written as "\x3C/script" and "\x3C!--" so the HTML parser never
 *     ends or comments it early (and each one is parsed again to be sure);
 *   - the icons (<link rel="icon">, apple-touch-icon) become data: URLs;
 *   - files the scripts reach at run time by a relative path - the logo,
 *     the liquid-glass decoration, the export font - become data: URLs in
 *     the code itself (a classic <script src="data:..."> loads on file://).
 *
 * Left out on purpose: js/features/pwa.js, so no manifest and no service
 * worker. A single file is not an installable web app (the worker and the
 * manifest would be separate files next to it), and app.js treats every
 * feature module as optional. Its maps live where index.html's live, in
 * the browser's IndexedDB: Chromium gives every file:// page one shared
 * store (the two see the same maps), Firefox gives each file its own (see
 * README, "Your data").
 *
 * The build refuses to write a file that still points at anything outside
 * itself: after inlining it scans for src/href/url() that are not data:,
 * blob: or #fragments, and for relative script paths left in the code. */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var OUT_DIR = path.join(ROOT, 'dist');
var OUT = path.join(OUT_DIR, 'MindRoot.html');

/* Modules that make no sense inside a single file (see the header). */
var LEFT_OUT = ['js/features/pwa.js'];

var MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};

function read(rel) {
  var file = path.join(ROOT, rel);
  if (file.indexOf(ROOT) !== 0) throw new Error('outside the repository: ' + rel);
  if (!fs.existsSync(file)) throw new Error('index.html names a file that does not exist: ' + rel);
  return fs.readFileSync(file);
}

function dataUrl(rel) {
  var type = MIME[path.extname(rel).toLowerCase()];
  if (!type) throw new Error('no media type for ' + rel);
  return 'data:' + type + ';base64,' + read(rel).toString('base64');
}

/* Relative to a file inside the repository, as a repository path. */
function resolve(fromRel, ref) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), ref));
}

/* A stylesheet with its url()s turned into data: URLs. */
function inlineCss(rel) {
  var css = read(rel).toString('utf8');
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (all, q, ref) {
    if (/^(data:|blob:|#)/.test(ref)) return all;
    if (/^[a-z]+:/i.test(ref)) throw new Error(rel + ' reaches outside: ' + ref);
    return 'url("' + dataUrl(resolve(rel, ref)) + '")';
  });
}

/* Run-time references in the code, by the path they are written with: each
 * is replaced by its data: URL. A reference to a file that is not there is
 * an error, not a silent hole. */
var CODE_REFS = [
  { re: /(['"])(?:\.\.\/\.\.\/)?(vendor\/[A-Za-z0-9._-]+\.js)\1/g },
  { re: /(['"])(icons\/[A-Za-z0-9._-]+\.(?:svg|png))\1/g }
];

function inlineJs(rel) {
  var js = read(rel).toString('utf8');
  CODE_REFS.forEach(function (r) {
    js = js.replace(r.re, function (all, q, ref) { return q + dataUrl(ref) + q; });
  });
  return escapeScript(js, rel);
}

/* Inside <script>, the HTML parser ends the element at "</script" and
 * treats "<!--" followed by "<script" as an escape. Both are written with
 * "\x3C" for "<": the same character inside a string, a template or a
 * regular expression (u flag included), and harmless inside a comment; a
 * "\<" (an identity escape for the same "<") becomes "\x3C" as a whole.
 * Every script is then parsed (vm.Script) to be sure it still is
 * JavaScript. */
function escapeScript(js, rel) {
  var out = js.replace(/(\\*)(<)(\/script|!--)/gi, function (all, slashes, lt, rest) {
    /* "\<" (an identity escape) already means "<": it becomes "\x3C". */
    if (slashes.length % 2) return slashes.slice(1) + '\\x3C' + rest;
    return slashes + '\\x3C' + rest;
  });
  try { new vm.Script(out, { filename: rel || 'inline.js' }); } catch (err) {
    throw new Error((rel || 'a script') + ' no longer parses after escaping: ' + err.message);
  }
  return out;
}

function build() {
  var html = read('index.html').toString('utf8');
  var inlined = { css: 0, js: 0, icons: 0, left: [] };

  html = html.replace(/<link\b[^>]*>/g, function (tag) {
    var rel = (/\brel="([^"]+)"/.exec(tag) || [])[1] || '';
    var href = (/\bhref="([^"]+)"/.exec(tag) || [])[1] || '';
    if (/^(data:|#)/.test(href)) return tag;
    if (rel === 'stylesheet') {
      inlined.css++;
      return '<style>/* ' + href + ' */\n' + inlineCss(href) + '\n</style>';
    }
    if (/icon/.test(rel)) {
      inlined.icons++;
      return tag.replace(href, dataUrl(href));
    }
    if (rel === 'manifest') return '';
    throw new Error('a <link> single.js does not know how to inline: ' + tag);
  });

  html = html.replace(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g, function (all, a, src, b) {
    if (LEFT_OUT.indexOf(src) >= 0) {
      inlined.left.push(src);
      return '<!-- ' + src + ': left out of the single file (no service worker, no manifest) -->';
    }
    if (/\btype="module"/.test(a + b)) throw new Error('module scripts are not allowed: ' + src);
    inlined.js++;
    return '<script>/* ' + src + ' */\n' + inlineJs(src) + '\n</script>';
  });

  /* Images in the markup itself (none today; kept honest if one appears). */
  html = html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, function (all, a, src, b) {
    if (/^(data:|blob:)/.test(src)) return all;
    return a + dataUrl(src) + b;
  });

  var marker = '<meta name="generator" content="MindRoot single file, tools/single.js">\n';
  html = html.replace(/<meta charset="utf-8">\n?/i, function (m) { return m + marker; });
  verify(html);
  return { html: html, inlined: inlined };
}

/* Nothing in the result may point outside it. */
function verify(html) {
  var problems = [];
  var withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, function (css) {
    var m;
    var re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    while ((m = re.exec(css))) if (!/^(data:|blob:|#)/.test(m[2])) problems.push('css url(' + m[2] + ')');
    return '<style></style>';
  });
  var re = /\s(?:src|href)="([^"]*)"/g;
  var m;
  while ((m = re.exec(withoutScripts))) {
    if (!/^(data:|blob:|#|$)/.test(m[1])) problems.push('attribute ' + m[0].trim());
  }
  if (/<script\b[^>]*\bsrc=/.test(html)) problems.push('a <script src> is left');
  if (/serviceWorker\.register\(/.test(html)) problems.push('a service worker registration is left');
  if (/rel="manifest"/.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''))) problems.push('a manifest link is left');
  /* Relative paths to our own files left in the code would fail at run time. */
  var code = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || [];
  code.forEach(function (block) {
    var r = /(['"])(?:\.\.\/)*(?:vendor|icons|css|js|fonts)\/[A-Za-z0-9._/-]+\.(?:js|css|svg|png|woff2)\1/g;
    var x;
    while ((x = r.exec(block))) problems.push('code still names ' + x[0]);
  });
  if (problems.length) throw new Error('the single file would reach outside itself:\n  ' + problems.join('\n  '));
}

function main() {
  var check = process.argv.indexOf('--check') >= 0;
  var out = build();
  var kb = Math.round(Buffer.byteLength(out.html) / 1024);
  if (!check) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT, out.html);
  }
  console.log('SINGLE OK ' + (check ? '(checked, not written)' : path.relative(ROOT, OUT)) + ': ' + kb + ' KB, ' +
    out.inlined.css + ' stylesheets, ' + out.inlined.js + ' scripts, ' + out.inlined.icons + ' icons inlined; left out: ' +
    (out.inlined.left.join(', ') || 'nothing'));
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error('SINGLE FAILED: ' + (err && err.message || err));
    process.exit(1);
  }
}

module.exports = { build: build, escapeScript: escapeScript, OUT: OUT };
