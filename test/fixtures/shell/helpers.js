/* MindRoot - helpers shared by the shell's e2e suites.
 *
 * The shell is built in parallel with the modules it loads, and boots with
 * any of them missing (app.js treats everything past the core as optional).
 * A file that does not exist yet would still make the browser log
 * "net::ERR_FILE_NOT_FOUND", which the runner rightly counts as an error. So
 * while a module is absent, its file is answered with an empty body: only
 * files the contract assigns to another owner, only while they are missing
 * on disk, and each one is named in the suite's log. Once every module
 * exists, nothing is stubbed and the suites run against the real app. */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..', '..');

/* Files index.html loads that other owners write (docs/ARCHITECTURE.md §3). */
var OTHERS = [
  'css/map.css', 'css/editor.css', 'css/source.css', 'css/media.css', 'css/ink.css', 'css/workspace.css',
  'js/model/color.js', 'js/model/doc.js', 'js/model/store.js', 'js/model/zip.js', 'js/model/storage.js',
  'js/model/archive.js', 'js/map/layout.js', 'js/map/gestures.js', 'js/map/mapview.js', 'js/map/session.js',
  'js/map/notes.js', 'js/map/editor.js', 'js/features/colorpicker.js', 'js/features/source.js',
  'js/features/export.js', 'js/features/ink.js', 'js/features/media.js', 'js/features/sidebar.js',
  'js/features/trash.js', 'js/features/copies.js', 'js/features/palette.js', 'js/features/settings.js',
  'js/features/help.js', 'js/features/welcome.js', 'js/features/tabs.js'
];

/* MINDROOT_SHELL_STUB=js/features/ink.js,... also stubs files that exist:
 * for running the shell's suites while another owner is half-way through
 * writing a module. Only files of other owners, and only on request. */
function forced() {
  return String(process.env.MINDROOT_SHELL_STUB || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (rel) { return OTHERS.indexOf(rel) >= 0; });
}

function missing() {
  var force = forced();
  return OTHERS.filter(function (rel) { return force.indexOf(rel) >= 0 || !fs.existsSync(path.join(ROOT, rel)); });
}

function relOf(u) {
  try {
    var url = new URL(u);
    var p = decodeURIComponent(url.pathname);
    if (url.protocol === 'file:') {
      var abs = path.normalize(p);
      var rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
      return abs.indexOf(rootWithSep) === 0 ? abs.slice(rootWithSep.length).split(path.sep).join('/') : null;
    }
    return p.replace(/^\/+/, '');
  } catch (err) {
    return null;
  }
}

/* Installs the stub on a browser context; returns the stubbed list. */
async function stubMissing(context, t) {
  var list = missing();
  if (!list.length) return list;
  if (t && !stubMissing.logged) {
    stubMissing.logged = true;
    t.log('modules not written yet, stubbed empty: ' + list.join(', '));
  }
  await context.route(function (u) {
    var rel = relOf(String(u));
    return !!rel && list.indexOf(rel) >= 0;
  }, function (route) {
    var rel = relOf(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: /\.css$/.test(rel) ? 'text/css' : 'text/javascript',
      body: '/* ' + rel + ': not written yet (stubbed by the shell tests) */\n'
    });
  });
  return list;
}

/* Every local file index.html references (scripts, stylesheets, icons). */
function indexReferences() {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var out = [];
  var re = /<(?:script|link)\b[^>]*?\s(?:src|href)="([^"#:]+)"/g;
  var m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/* A new context with the runner's guards plus the module stub. */
async function context(t, opts) {
  var ctx = await t.newContext(opts);
  await stubMissing(ctx, t);
  return ctx;
}

/* Waits for a condition in the page instead of sleeping a guessed time. */
async function until(page, fn, arg, timeout) {
  await page.waitForFunction(fn, arg, { timeout: timeout || 5000, polling: 'raf' });
}

module.exports = {
  ROOT: ROOT,
  OTHERS: OTHERS,
  missing: missing,
  stubMissing: stubMissing,
  indexReferences: indexReferences,
  context: context,
  until: until
};
