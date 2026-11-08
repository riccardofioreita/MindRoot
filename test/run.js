#!/usr/bin/env node
/* MindRoot - run the test suites from the command line.
 *
 *     node test/run.js               every suite
 *     node test/run.js doc store     only these (by file name, without extension)
 *     node test/run.js --headed      in a real window (xvfb-run on a Linux box with no display)
 *     node test/run.js --list        print the suite names
 *
 * Two kinds of suite:
 *   test/unit/<name>.html     a page that writes its verdict into <pre id="out">
 *                             (see test/harness.js); opened straight from file://
 *   test/e2e/<name>.e2e.js    a Node module exporting async function (t) that drives
 *                             the real index.html through Playwright (see E2E below)
 *
 * Every suite runs in a browser context of its own, so IndexedDB and
 * localStorage start empty each time and never touch a person's real data.
 * Any request that leaves the machine (anything but file:, data:, blob:,
 * about: and the suite's own local http server) is blocked and turns the
 * suite red: the app promises to work offline, so trying the network at all
 * is a failure. So are uncaught page errors and console errors.
 *
 * Output, one line per suite, then the total:
 *     SUITE doc GREEN (212 checks)
 *     SUITE store RED (2 of 80)
 *       FAIL ...
 *     ALL SUITES GREEN (14)          or          RED SUITES (2): store, app
 * A CRASH (a suite that threw or timed out) also prints, for every page the
 * suite still had open, a screenshot path (test/out/<suite>-CRASH-<n>.png),
 * the page's URL, focus and open dialogs or menus, then the last console
 * lines of the suite's pages (any level), so a flake can be read after it.
 * Exit code 0 when everything is green, 1 when anything is red, 2 when the
 * runner itself cannot start.
 *
 * Suites run four at a time (MINDROOT_PARALLEL to change it). An e2e suite
 * that measures time exports `solo = true` and runs alone after the rest.
 *
 * E2E: t = { page, context, browser, open(query?, opts?), check(name, cond, detail?),
 *            eq(actual, expected, name), same(actual, expected, name), step(name),
 *            newContext(opts), serve() -> base http URL, fileUrl(rel), shot(name, page?),
 *            sleep(ms), log(msg) }
 *   open() loads index.html?db=<fresh name>&lang=en plus the query given, waits for
 *   window.MindRoot.booted === true (app.js sets it once the boot is over and the
 *   open map, if any, has rendered) and returns the page.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var url = require('url');
var http = require('http');
var child = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var UNIT = path.join(__dirname, 'unit');
var E2E = path.join(__dirname, 'e2e');
var OUT = path.join(__dirname, 'out');
/* Half the cores at most: each suite drives a whole Chromium, and the timing
 * checks (flings, long presses) turn flaky when browsers fight for the CPU. */
var PARALLEL = Math.max(1, Math.min(4, Number(process.env.MINDROOT_PARALLEL) || Math.floor(require('os').cpus().length / 2) || 1));
var UNIT_TIMEOUT = 90000;
var E2E_TIMEOUT = 240000;

function loadPlaywright() {
  var tries = [];
  try { return require('playwright'); } catch (err) { tries.push(String(err.message).split('\n')[0]); }
  var roots = [path.join(ROOT, 'node_modules'), '/opt/node-tools/node_modules'];
  try { roots.push(child.execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (err) { /* no npm */ }
  for (var i = 0; i < roots.length; i++) {
    var p = path.join(roots[i], 'playwright');
    if (fs.existsSync(p)) return require(p);
  }
  console.error('playwright not found (npm i -D playwright, or npm i -g playwright).');
  process.exit(2);
}

function suites() {
  var list = [];
  if (fs.existsSync(UNIT)) fs.readdirSync(UNIT).filter(function (f) { return /\.html$/.test(f); }).sort().forEach(function (f) {
    list.push({ name: f.replace(/\.html$/, ''), kind: 'unit', file: path.join(UNIT, f) });
  });
  if (fs.existsSync(E2E)) fs.readdirSync(E2E).filter(function (f) { return /\.e2e\.js$/.test(f); }).sort().forEach(function (f) {
    list.push({ name: f.replace(/\.e2e\.js$/, ''), kind: 'e2e', file: path.join(E2E, f) });
  });
  return list;
}

function fileUrl(rel) { return url.pathToFileURL(path.join(ROOT, rel)).href; }

/* A static server over the repository, for the suites that need http (the
 * service worker and the manifest do nothing on file://). */
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
var server = null;
function serve() {
  if (server) return Promise.resolve(server.base);
  return new Promise(function (resolve) {
    var s = http.createServer(function (req, res) {
      var rel = decodeURIComponent(url.parse(req.url).pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      var file = path.join(ROOT, rel);
      if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    s.listen(0, '127.0.0.1', function () {
      server = { s: s, base: 'http://127.0.0.1:' + s.address().port + '/' };
      resolve(server.base);
    });
  });
}

function allowed(u, base) {
  return /^(file|data|blob|about|chrome-extension|devtools):/.test(u) || (base && u.indexOf(base) === 0) ||
    (server && u.indexOf(server.base) === 0);
}

function guard(context, result) {
  context.on('page', function (page) { watch(page, result); });
  return context.route('**/*', function (route) {
    var u = route.request().url();
    if (allowed(u)) return route.continue();
    result.network.push(u);
    return route.abort();
  });
}

/* The last console lines of every page of a suite, whatever their level, so
 * that a CRASH can say what the page was saying when it stopped. */
var CONSOLE_KEEP = 40;
function remember(result, line) {
  if (!result.console) result.console = [];
  result.console.push(line);
  if (result.console.length > CONSOLE_KEEP) result.console.shift();
}

function watch(page, result) {
  if (page.__mrWatched) return;
  page.__mrWatched = true;
  if (!result.pages) result.pages = [];
  result.pages.push(page);
  var tag = 'p' + result.pages.length;
  var t0 = Date.now();
  function stamp() { return '+' + ((Date.now() - t0) / 1000).toFixed(1) + 's'; }
  page.on('pageerror', function (err) {
    remember(result, tag + ' ' + stamp() + ' pageerror: ' + String(err.message || err).split('\n')[0]);
    result.errors.push('pageerror: ' + (err.stack || err.message));
  });
  page.on('console', function (msg) {
    remember(result, tag + ' ' + stamp() + ' ' + msg.type() + ': ' + msg.text().split('\n')[0].slice(0, 300));
    if (msg.type() !== 'error') return;
    var text = msg.text();
    if (/net::ERR_FAILED|blocked by|ERR_BLOCKED/.test(text) && result.network.length) return; // already counted as network
    result.errors.push('console.error: ' + text);
  });
}

/* What a crashed suite's pages looked like at the moment it stopped: a
 * screenshot of each page still open (test/out/<suite>-CRASH-<n>.png), its
 * URL, the focused element and any dialog, menu or sheet on screen. Bounded
 * in time, so a hung page cannot hang the runner. */
async function postmortem(suite, result) {
  var pages = (result.pages || []).filter(function (p) { return !p.isClosed(); });
  result.shots = [];
  result.states = [];
  fs.mkdirSync(OUT, { recursive: true });
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    var file = path.join(OUT, suite.name + '-CRASH-' + (i + 1) + '.png');
    try {
      await Promise.race([p.screenshot({ path: file, timeout: 5000 }), timeout(6000, 'screenshot')]);
      result.shots.push(path.relative(ROOT, file));
    } catch (err) { result.shots.push('(no screenshot of page ' + (i + 1) + ': ' + String(err.message || err).split('\n')[0] + ')'); }
    try {
      var state = await Promise.race([p.evaluate(function () {
        function name(el) {
          if (!el || el === document.body) return 'body';
          var s = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
          if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
          var label = el.getAttribute('aria-label') || el.getAttribute('data-command') || el.getAttribute('data-key');
          return label ? s + '[' + label + ']' : s;
        }
        var open = Array.prototype.filter.call(document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],.nb-sheet,.menu,.toast'), function (el) {
          var r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).slice(0, 6).map(name);
        var ns = window.MindRoot || {};
        return 'url ' + location.href.replace(/^.*\//, '') + ' | ' + window.innerWidth + 'x' + window.innerHeight +
          ' | booted ' + !!ns.booted + ' | focus ' + name(document.activeElement) + ' | open: ' + (open.join(', ') || 'none');
      }), timeout(3000, 'page state')]);
      result.states.push('page ' + (i + 1) + ': ' + state);
    } catch (err) { result.states.push('page ' + (i + 1) + ': (no state: ' + String(err.message || err).split('\n')[0] + ')'); }
  }
}

function timeout(ms, what) {
  return new Promise(function (_, reject) {
    var timer = setTimeout(function () { reject(new Error(what + ' timed out after ' + ms + ' ms')); }, ms);
    if (timer.unref) timer.unref();
  });
}

async function runUnit(browser, suite) {
  var result = { checks: 0, failures: 0, lines: [], network: [], errors: [], verdict: null };
  var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await guard(context, result);
  try {
    var page = await context.newPage();
    watch(page, result);
    await page.goto(url.pathToFileURL(suite.file).href);
    await Promise.race([
      page.waitForFunction(function () {
        var out = document.getElementById('out');
        return out && /^(GREEN|RED|CRASH)/.test(out.textContent);
      }, null, { timeout: UNIT_TIMEOUT, polling: 50 }),
      timeout(UNIT_TIMEOUT + 1000, 'suite')
    ]);
    var text = await page.$eval('#out', function (el) { return el.textContent; });
    var all = text.split('\n');
    result.verdict = all[0];
    result.lines = all.slice(1);
    var m = /^GREEN (\d+)/.exec(all[0]);
    var r = /^RED (\d+) of (\d+)/.exec(all[0]);
    if (m) result.checks = +m[1];
    else if (r) { result.failures = +r[1]; result.checks = +r[2]; }
    else { result.crash = all[0]; }
  } catch (err) {
    result.crash = String(err.message || err);
  }
  if (result.crash) await postmortem(suite, result).catch(function () {});
  await context.close().catch(function () {});
  return result;
}

async function runE2E(browser, suite) {
  var result = { checks: 0, failures: 0, lines: [], network: [], errors: [], verdict: null };
  var contexts = [];
  var counter = 0;
  async function newContext(opts) {
    var context = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }, opts || {}));
    await guard(context, result);
    contexts.push(context);
    return context;
  }
  var context = await newContext();
  var page = await context.newPage();
  watch(page, result);
  var stepName = '';
  function record(pass, name, detail) {
    result.checks++;
    var full = (stepName ? stepName + ' :: ' : '') + name;
    if (pass) result.lines.push('PASS  ' + full);
    else {
      result.failures++;
      result.lines.push('FAIL  ' + full);
      if (detail !== undefined) result.lines.push('        ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)));
    }
    return pass;
  }
  var t = {
    browser: browser, context: context, page: page, root: ROOT,
    newContext: newContext,
    fileUrl: fileUrl,
    serve: serve,
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    log: function (msg) { result.lines.push('      ' + msg); },
    step: function (name) { stepName = name; result.step = name; },
    check: function (name, cond, detail) { return record(!!cond, name, cond ? undefined : detail); },
    eq: function (actual, expected, name) { return record(actual === expected, name, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); },
    same: function (actual, expected, name) {
      var a = JSON.stringify(actual), e = JSON.stringify(expected);
      return record(a === e, name, 'expected ' + e + ', got ' + a);
    },
    open: async function (query, opts) {
      opts = opts || {};
      var p = opts.page || page;
      watch(p, result);
      var q = 'db=e2e-' + suite.name + '-' + (++counter) + '&lang=' + (opts.lang || 'en') + (query ? '&' + query.replace(/^[?&]/, '') : '');
      var base = opts.base ? opts.base + 'index.html' : fileUrl('index.html');
      await p.goto(base + '?' + q);
      await p.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
      return p;
    },
    shot: async function (name, p) {
      fs.mkdirSync(OUT, { recursive: true });
      var file = path.join(OUT, suite.name + '-' + name + '.png');
      await (p || page).screenshot({ path: file });
      return file;
    }
  };
  try {
    var body = require(suite.file);
    await Promise.race([Promise.resolve(body(t)), timeout(E2E_TIMEOUT, 'suite')]);
    if (!result.checks) result.crash = 'no checks ran';
  } catch (err) {
    result.crash = String(err && (err.stack || err.message) || err);
  }
  if (result.crash) await postmortem(suite, result).catch(function () {});
  for (var i = 0; i < contexts.length; i++) await contexts[i].close().catch(function () {});
  return result;
}

function report(suite, result) {
  var out = [];
  var red = result.crash || result.failures || result.network.length || result.errors.length;
  if (result.crash) out.push('SUITE ' + suite.name + ' CRASH ' + result.crash.split('\n')[0]);
  else if (red) out.push('SUITE ' + suite.name + ' RED (' + (result.failures + result.network.length + result.errors.length) + ' of ' + (result.checks + result.network.length + result.errors.length) + ')');
  else out.push('SUITE ' + suite.name + ' GREEN (' + result.checks + ' checks)');
  if (result.crash && result.crash.indexOf('\n') > 0) out.push('  ' + result.crash.split('\n').slice(1, 8).join('\n  '));
  if (result.crash) {
    /* Where in the suite it stopped, when the lines above (a long Playwright
     * call log) did not get that far. */
    var shown = result.crash.split('\n').slice(0, 8).join('\n');
    var where = result.crash.split('\n').filter(function (l) { return /test\/(e2e|fixtures)\/[^:]+:\d+/.test(l); })[0];
    if (where && shown.indexOf(where) < 0) out.push('  ' + where.trim());
    if (result.step) out.push('  in step: ' + result.step + ' (' + result.checks + ' checks done)');
    (result.shots || []).forEach(function (f) { out.push('  screenshot: ' + f); });
    (result.states || []).forEach(function (s) { out.push('  ' + s); });
    var tail = (result.console || []).slice(-12);
    out.push('  last console lines' + (tail.length ? ':' : ': none'));
    tail.forEach(function (line) { out.push('    ' + line); });
  }
  var verbose = process.argv.indexOf('--verbose') > 0;
  result.lines.forEach(function (line, i) {
    if (verbose || /^FAIL/.test(line) || (/^\s{8}/.test(line) && /^FAIL/.test(result.lines[i - 1] || ''))) out.push('  ' + line);
  });
  result.network.forEach(function (u) { out.push('  FAIL  network request attempted: ' + u); });
  result.errors.forEach(function (e) { out.push('  FAIL  ' + e.split('\n').slice(0, 4).join('\n        ')); });
  return { text: out.join('\n'), red: !!red };
}

async function main() {
  var args = process.argv.slice(2);
  var headed = args.indexOf('--headed') >= 0;
  if (headed && process.platform === 'linux' && !process.env.DISPLAY && !process.env.MINDROOT_XVFB) {
    var r = child.spawnSync('xvfb-run', ['-a', process.execPath].concat(process.argv.slice(1)), {
      stdio: 'inherit', env: Object.assign({}, process.env, { MINDROOT_XVFB: '1' })
    });
    process.exit(r.status === null ? 2 : r.status);
  }
  var names = args.filter(function (a) { return a[0] !== '-'; });
  var all = suites();
  if (args.indexOf('--list') >= 0) { all.forEach(function (s) { console.log(s.kind + '\t' + s.name); }); return; }
  var chosen = names.length ? all.filter(function (s) { return names.indexOf(s.name) >= 0; }) : all;
  var unknown = names.filter(function (n) { return !all.some(function (s) { return s.name === n; }); });
  if (unknown.length) { console.error('unknown suite(s): ' + unknown.join(', ')); process.exit(2); }
  if (!chosen.length) { console.error('no suites found'); process.exit(2); }

  var pw = loadPlaywright();
  var launch = { headless: !headed, args: ['--no-sandbox', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] };
  if (process.env.MINDROOT_BROWSER) launch.executablePath = process.env.MINDROOT_BROWSER;
  var browser;
  try { browser = await pw.chromium.launch(launch); } catch (err) {
    try { browser = await pw.chromium.launch(Object.assign({}, launch, { channel: 'chrome' })); } catch (err2) {
      console.error('cannot start Chromium: ' + err.message.split('\n')[0]);
      process.exit(2);
    }
  }

  /* A suite that measures time (frame budgets, render budgets) says so with
   * `module.exports.solo = true`: it runs alone once the parallel pool has
   * drained, so it measures the app and not the other suites' load. */
  function isSolo(suite) {
    if (suite.kind !== 'e2e') return false;
    try { return require(suite.file).solo === true; } catch (err) { return false; }
  }
  var solo = chosen.filter(isSolo);
  var queue = chosen.filter(function (s) { return solo.indexOf(s) < 0; });
  var results = {};
  async function worker() {
    while (queue.length) {
      var suite = queue.shift();
      var started = Date.now();
      var result = suite.kind === 'unit' ? await runUnit(browser, suite) : await runE2E(browser, suite);
      var rep = report(suite, result);
      results[suite.name] = rep;
      console.log(rep.text + (process.argv.indexOf('--time') > 0 ? '  [' + (Date.now() - started) + ' ms]' : ''));
    }
  }
  var workers = [];
  for (var i = 0; i < Math.min(PARALLEL, queue.length); i++) workers.push(worker());
  await Promise.all(workers);
  queue = solo.slice();
  await worker();
  await browser.close();
  if (server) server.s.close();

  var red = chosen.filter(function (s) { return results[s.name].red; }).map(function (s) { return s.name; });
  if (red.length) {
    console.log('RED SUITES (' + red.length + '): ' + red.join(', '));
    process.exit(1);
  }
  console.log('ALL SUITES GREEN (' + chosen.length + ')');
  process.exit(0);
}

main().catch(function (err) { console.error(err && (err.stack || err)); process.exit(2); });
