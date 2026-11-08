/* MindRoot - the service worker (registered only over http/https).
 *
 * Cache-first app shell: every file the app is made of is stored at install,
 * then served from the cache, so the installed app opens and works with no
 * network at all. Your maps are not here: they live in IndexedDB.
 *
 * Updating: the cache name carries VERSION. Bump it with every release that
 * changes any file below, or browsers keep serving the old copies; the
 * folder GitHub Pages publishes (tools/pages.js) adds a fingerprint of
 * those files to it, so a release there always installs anew. A new
 * worker installs beside the old one, takes over at once (skipWaiting +
 * clients.claim) and deletes the older mindroot2-* caches, and only those:
 * other apps served from the same origin keep theirs. The open page keeps
 * running the code it loaded; js/features/pwa.js offers a reload.
 *
 * The list must name every file index.html loads (the pwa test checks it).
 * CORE must all arrive or the install fails (an offline app without its
 * shell is worse than none); the rest is added one by one, so a missing
 * optional file costs that file, not the whole offline copy. Anything else
 * of the same origin is cached the first time it is fetched. */

'use strict';

var VERSION = '2.1.0-2';
var PREFIX = 'mindroot2-';
var CACHE = PREFIX + VERSION;

var CORE = [
  './',
  'index.html',
  'css/fonts.css',
  'css/tokens.css',
  'css/base.css',
  'css/chrome.css',
  'css/motion.css',
  'js/core/util.js',
  'js/core/i18n.js',
  'js/core/bus.js',
  'js/core/prefs.js',
  'js/core/ui.js',
  'js/core/float.js',
  'js/core/commands.js',
  'js/app.js'
];

var OPTIONAL = [
  'manifest.webmanifest',
  'css/map.css',
  'css/editor.css',
  'css/source.css',
  'css/media.css',
  'css/ink.css',
  'css/notebook.css',
  'css/ai.css',
  'css/mentions.css',
  'css/workspace.css',
  'css/liquid.css',
  'css/fonts/montserrat-latin.woff2',
  'js/model/color.js',
  'js/model/doc.js',
  'js/model/store.js',
  'js/model/zip.js',
  'js/model/storage.js',
  'js/model/archive.js',
  'js/map/layout.js',
  'js/map/gestures.js',
  'js/map/mapview.js',
  'js/map/session.js',
  'js/map/notes.js',
  'js/map/editor.js',
  'js/features/colorpicker.js',
  'js/features/source.js',
  'js/features/export.js',
  'js/features/paper.js',
  'js/features/ink.js',
  'js/features/notebook.js',
  'js/features/ai.js',
  'js/features/ai-ui.js',
  'js/features/ai-chat.js',
  'js/features/mentions.js',
  'js/features/laser.js',
  'js/features/media.js',
  'js/features/sidebar.js',
  'js/features/trash.js',
  'js/features/copies.js',
  'js/features/palette.js',
  'js/features/settings.js',
  'js/features/help.js',
  'js/features/welcome.js',
  'js/features/tabs.js',
  'js/features/pwa.js',
  'vendor/liquid-glass.iife.js',
  'vendor/montserrat-font.js',
  'icons/logo-compact.svg',
  'icons/logo.svg',
  'icons/logo-wordmark.svg',
  'icons/favicon.ico',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-1024.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png'
];

/* For tests and tools: the whole list. */
self.MINDROOT_PRECACHE = CORE.concat(OPTIONAL);

function fresh(url) {
  /* Past the HTTP cache: a new version must not install yesterday's files. */
  return new Request(url, { cache: 'reload' });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(CORE.map(fresh)).then(function () {
        return Promise.all(OPTIONAL.map(function (url) {
          return cache.add(fresh(url)).catch(function () { /* missing optional file: cached later if it ever appears */ });
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name.indexOf(PREFIX) === 0 && name !== CACHE) return caches.delete(name);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function shellFallback() {
  return caches.match('index.html', { ignoreSearch: true }).then(function (res) {
    return res || caches.match('./', { ignoreSearch: true });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Opening the app with any query (?db=, ?lang=) is the same shell. */
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(req).catch(shellFallback);
      }).then(function (res) { return res || shellFallback(); })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { return cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return Response.error(); });
    })
  );
});
