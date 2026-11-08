/* MindRoot - helpers shared by the notebook e2e suites (notebook*): the real
 * app, a project of our own, the board view, strokes drawn with real
 * pointer events, and reads of what the store holds.
 *
 * The app page. The suites drive the real index.html. Until the shell lists
 * paper.js, notebook.js and notebook.css itself, the page they load is
 * test/out/notebook-app.html (test/out is not kept in git): index.html as
 * it is, with <base> pointed at the repository root and only the three
 * missing tags added (each one only when index.html does not have it yet),
 * written fresh on every run so it never drifts from index.html. Every
 * wait is for a condition. */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..', '..');
var APP = path.join(ROOT, 'test', 'out', 'notebook-app.html');

function writeApp() {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<head>/i, '<head>\n<base href="../../">');
  if (html.indexOf('css/notebook.css') < 0) {
    html = html.replace(/(<link[^>]+css\/ink\.css[^>]*>)/i, '$1\n<link rel="stylesheet" href="css/notebook.css">');
    if (html.indexOf('css/notebook.css') < 0) html = html.replace(/<\/head>/i, '<link rel="stylesheet" href="css/notebook.css">\n</head>');
  }
  if (html.indexOf('js/features/paper.js') < 0) {
    html = html.replace('<script src="js/features/ink.js"></script>', '<script src="js/features/paper.js"></script>\n<script src="js/features/ink.js"></script>');
  }
  if (html.indexOf('js/features/notebook.js') < 0) {
    html = html.replace('<script src="js/app.js"></script>', '<script src="js/features/notebook.js"></script>\n<script src="js/app.js"></script>');
  }
  fs.mkdirSync(path.dirname(APP), { recursive: true });
  /* Several notebook suites run at once and each writes this page as it
   * starts: written in place, one suite's page could load while another
   * had just emptied the file (a page with no scripts, which never
   * boots). Unchanged, it is left alone; changed, it is written beside and
   * renamed over, which no reader ever sees half done. */
  var now = null;
  try { now = fs.readFileSync(APP, 'utf8'); } catch (err) { /* not there yet */ }
  if (now === html) return APP;
  var tmp = APP + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, APP);
  return APP;
}

var counter = 0;

/* Opens the app on a fresh database and waits for the boot. */
async function openApp(t, opts) {
  opts = opts || {};
  writeApp();
  var page = opts.page || t.page;
  var q = 'db=' + (opts.db || ('e2e-notebook-' + process.pid + '-' + (++counter))) + '&lang=' + (opts.lang || 'en') + (opts.query ? '&' + opts.query : '');
  await page.goto(t.fileUrl('test/out/notebook-app.html') + '?' + q);
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  return { page: page, db: q };
}

/* A project with these maps, the first one open and drawn. */
async function project(page, maps) {
  var ids = await page.evaluate(function (list) {
    var ns = window.MindRoot;
    var p = ns.store.createProject({ name: 'Notebooks', maps: list.map(function (m) { return { name: m[0], text: m[1] }; }) });
    return { pid: p.id, mids: p.maps.map(function (m) { return m.id; }) };
  }, maps);
  await page.waitForFunction(function (mid) {
    var c = window.MindRoot.session.current();
    return c && c.mapId === mid;
  }, ids.mids[0], { timeout: 10000, polling: 50 });
  await page.evaluate(function () { return window.MindRoot.session.view.settled(); });
  return { pid: ids.pid, mids: ids.mids, mid: ids.mids[0] };
}

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: timeout || 8000, polling: 30 });
}

/* The board view up, its editor mounted. */
async function boardReady(page) {
  await until(page, function () {
    var v = window.MindRoot.notebook.boardView();
    return !!(v && v.editor() && !v.el.hasAttribute('data-loading'));
  });
}

/* Everything the notebook holds written (its saves chain idle). */
async function idle(page) {
  await page.evaluate(function () {
    var v = window.MindRoot.notebook.boardView();
    if (!v) return null;
    return v.flush().then(function () { return v.idle(); });
  });
}

/* A stroke with real pointer events, from (x0, y0) to (x1, y1), in steps. */
async function stroke(page, x0, y0, x1, y1, opts) {
  opts = opts || {};
  var steps = opts.steps || 12;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (var i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
  }
  await page.mouse.up();
}

/* The files of the project under a folder: {name: asset}. */
function folder(page, pid, dir) {
  return page.evaluate(function (a) {
    var p = window.MindRoot.store.project(a.pid);
    var out = {};
    Object.keys(p.files).forEach(function (k) { if (k.indexOf(a.dir + '/') === 0) out[k.slice(a.dir.length + 1)] = p.files[k].asset; });
    return out;
  }, { pid: pid, dir: dir });
}

function fileText(page, pid, file) {
  return page.evaluate(function (a) { return window.MindRoot.storage.readDrawing(window.MindRoot.store, a.pid, a.file); }, { pid: pid, file: file });
}

function mapText(page, pid, mid) {
  return page.evaluate(function (a) { return window.MindRoot.store.map(a.pid, a.mid).text; }, { pid: pid, mid: mid });
}

function board(page) {
  return page.evaluate(function () {
    var v = window.MindRoot.notebook.boardView();
    if (!v) return null;
    var b = v.book();
    return {
      mode: v.mode(), pages: v.pages(), page: v.page(), active: v.active(), ref: b.ref, folder: b.folder,
      files: b.pages.map(function (p) { return p.file; }), meta: b.meta
    };
  });
}

/* The PDF's pages as [w, h] in points, read from its MediaBoxes. */
function pdfPages(buffer) {
  var text = buffer.toString('latin1');
  var out = [];
  var re = /\/Type\s*\/Page[^s][\s\S]*?\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/g;
  var m;
  while ((m = re.exec(text))) out.push([+m[3] - +m[1], +m[4] - +m[2]]);
  if (!out.length) {
    var re2 = /\/MediaBox\s*\[\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*\]/g;
    while ((m = re2.exec(text))) out.push([+m[3] - +m[1], +m[4] - +m[2]]);
  }
  return out;
}

module.exports = {
  ROOT: ROOT, writeApp: writeApp, openApp: openApp, project: project, until: until, boardReady: boardReady,
  idle: idle, stroke: stroke, folder: folder, fileText: fileText, mapText: mapText, board: board, pdfPages: pdfPages
};
