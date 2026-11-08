/* MindRoot - a local static server for the PWA suite.
 *
 * test/run.js has its own server (t.serve()), and the PWA suite uses it
 * whenever it can. Two things it cannot do, and this one can:
 *   - answer for modules not written yet. Requests a service worker makes
 *     do not pass through Playwright's context routes, so the page-level
 *     stub in helpers.js cannot reach them; this server stubs the same
 *     files, by the same rule (other owners' files, only while missing);
 *   - pretend to be a new release (setVersion: sw.js served with another
 *     VERSION, so registration.update() finds a changed worker) and go
 *     offline for the worker too (setOffline: every request is dropped),
 *     which context.setOffline does not do for a worker's own fetches.
 * It listens on 127.0.0.1 only: nothing leaves the machine. */

'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var H = require('./helpers.js');

var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8'
};

function start() {
  var state = { offline: false, version: null, hits: {} };
  var server = http.createServer(function (req, res) {
    if (state.offline) { req.socket.destroy(); return; }
    var rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    var file = path.join(H.ROOT, rel);
    if (file.indexOf(H.ROOT) !== 0) { res.writeHead(403); res.end(); return; }
    var key = rel.replace(/^\/+/, '');
    state.hits[key] = (state.hits[key] || 0) + 1;
    var headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (key === 'sw.js' && state.version) {
      var src = fs.readFileSync(file, 'utf8').replace(/var VERSION = '[^']+'/, "var VERSION = '" + state.version + "'");
      res.writeHead(200, headers);
      res.end(src);
      return;
    }
    if (H.missing().indexOf(key) >= 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (H.OTHERS.indexOf(key) >= 0) {
        res.writeHead(200, headers);
        res.end('/* ' + key + ': not written yet (stubbed by the shell tests) */\n');
        return;
      }
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({
        base: 'http://127.0.0.1:' + server.address().port + '/',
        setOffline: function (v) { state.offline = !!v; },
        setVersion: function (v) { state.version = v; },
        hits: function (rel) { return state.hits[rel] || 0; },
        close: function () { return new Promise(function (r) { server.close(function () { r(); }); }); }
      });
    });
  });
}

/* The runner's guard refuses every http URL but its own server; requests
 * to this local one are let through ahead of it (routes registered later
 * run first). Only 127.0.0.1. */
async function allow(context, base) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(base)) throw new Error('allow: local servers only');
  await context.route(function (u) { return String(u).indexOf(base) === 0; }, function (route) { return route.continue(); });
}

module.exports = { start: start, allow: allow };
