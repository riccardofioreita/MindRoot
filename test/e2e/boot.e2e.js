/* boot: index.html opened from disk starts with no network and no console
 * error, exposes the contract regions and script order, applies a stored
 * theme before the first stylesheet, survives blocked storage, and shows a
 * failure screen (with the raw data export) instead of a blank page. */
'use strict';

var fs = require('fs');
var path = require('path');
var H = require('../fixtures/shell/helpers.js');

var SCRIPT_ORDER = ['core/util', 'core/i18n', 'core/bus', 'core/prefs', 'core/ui', 'core/float', 'core/commands',
  'model/color', 'model/doc', 'model/store', 'model/zip', 'model/storage', 'model/archive', 'map/layout',
  'map/gestures', 'map/mapview', 'map/session', 'map/notes', 'map/editor', 'features/colorpicker',
  'features/source', 'features/export', 'features/paper', 'features/ink', 'features/notebook', 'features/ai', 'features/ai-ui', 'features/ai-chat', 'features/mentions', 'features/media', 'features/sidebar', 'features/trash',
  'features/copies', 'features/palette', 'features/settings', 'features/help', 'features/welcome',
  'features/tabs', 'features/pwa', 'app'];

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var page = t.page;
  var requests = [];
  page.on('request', function (r) { requests.push(r.url()); });

  t.step('file:// boot');
  await t.open();
  t.eq(await page.evaluate(function () { return window.MindRoot.booted; }), true, 'booted');
  t.eq(await page.evaluate(function () { return window.MindRoot.ready.then(function () { return 'resolved'; }); }), 'resolved', 'ready resolved');
  t.eq(await page.evaluate(function () { return location.protocol; }), 'file:', 'opened from a file');
  var foreign = requests.filter(function (u) { return !/^(file|data|blob|about):/.test(u); });
  t.same(foreign, [], 'every request is local');
  t.eq(await page.$('link[rel="manifest"]'), null, 'no manifest link on file://');
  t.check('no manifest or worker requested', !requests.some(function (u) { return /manifest\.webmanifest|sw\.js/.test(u); }), requests);
  t.eq(await page.evaluate(function () { return !!(navigator.serviceWorker && navigator.serviceWorker.controller); }), false, 'no service worker');
  t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-booted'); }), true, 'data-booted');
  t.eq(await page.evaluate(function () { return document.documentElement.lang; }), 'en', 'language from ?lang=');

  t.step('contract regions and script order');
  var ids = await page.evaluate(function () {
    return ['app', 'sidebar', 'main', 'topbar', 'stage', 'floaters', 'source', 'thumbbar', 'layers', 'drop'].filter(function (id) { return !document.getElementById(id); });
  });
  t.same(ids, [], 'every region id exists');
  t.eq(await page.evaluate(function () { return document.getElementById('floaters').parentNode.id; }), 'stage', '#floaters inside #stage');
  t.eq(await page.evaluate(function () { return document.getElementById('stage').parentNode.id; }), 'main', '#stage inside #main');
  var scripts = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('script[src]'), function (s) { return s.getAttribute('src'); });
  });
  t.same(scripts.filter(function (s) { return /^js\//.test(s); }).map(function (s) { return s.replace(/^js\//, '').replace(/\.js$/, ''); }), SCRIPT_ORDER, 'scripts in the contract order');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('script[type="module"]').length; }), 0, 'no module scripts');
  var api = await page.evaluate(function () {
    var ns = window.MindRoot;
    return ['util', 'i18n', 'bus', 'prefs', 'ui', 'float', 'commands', 'shell', 'glass', 'pwa'].filter(function (k) { return !ns[k]; });
  });
  t.same(api, [], 'core namespaces present');
  var cmds = await page.evaluate(function () { return window.MindRoot.commands.all().map(function (c) { return c.id; }); });
  ['view.sidebar', 'view.theme', 'view.readOnly', 'view.fullscreen', 'view.zoomIn', 'view.zoomOut', 'view.fit'].forEach(function (id) {
    t.check('shell command ' + id, cmds.indexOf(id) >= 0, cmds);
  });
  var appSource = fs.readFileSync(path.join(H.ROOT, 'js/app.js'), 'utf8');
  t.check('palette.open and settings.open are left to their owners', !/id:\s*'(palette|settings)\.open'/.test(appSource));

  t.step('the shell\'s strings: both languages, house style');
  var copy = await page.evaluate(function () {
    var I = window.MindRoot.i18n;
    var mine = /^(ui|commands|keys|float|app|group|theme|pwa)\./;
    var en = I.keys('en').filter(function (k) { return mine.test(k); });
    var it = I.keys('it').filter(function (k) { return mine.test(k); });
    var lang = I.lang();
    function texts(l, keys) {
      I.init(l);
      var out = {};
      keys.forEach(function (k) { out[k] = I.t(k); });
      return out;
    }
    var enText = texts('en', en);
    var itText = texts('it', it);
    I.init(lang);
    return {
      count: en.length,
      onlyEn: en.filter(function (k) { return it.indexOf(k) < 0; }),
      onlyIt: it.filter(function (k) { return en.indexOf(k) < 0; }),
      bang: Object.keys(itText).filter(function (k) { return /!/.test(itText[k]); }).concat(Object.keys(enText).filter(function (k) { return /!/.test(enText[k]); })),
      dash: Object.keys(itText).concat(Object.keys(enText)).filter(function (k) { return /\u2014/.test(itText[k] || '') || /\u2014/.test(enText[k] || ''); }),
      emoji: Object.keys(itText).filter(function (k) { return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(itText[k] + enText[k]); })
    };
  });
  t.check('strings registered', copy.count > 60, copy.count);
  t.same(copy.onlyEn, [], 'no English-only string');
  t.same(copy.onlyIt, [], 'no Italian-only string');
  t.same(copy.bang, [], 'no exclamation marks');
  t.same(copy.dash, [], 'no em-dashes');
  t.same(copy.emoji, [], 'no emoji');

  t.step('the icon sprite has every icon the app names');
  var html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  var need = ['menu', 'sidebar', 'plus', 'child', 'sibling', 'rename', 'trash', 'undo', 'redo', 'search', 'fit', 'zoom-in',
    'zoom-out', 'more', 'close', 'check', 'chevron-right', 'chevron-left', 'chevron-down', 'folder', 'map', 'project',
    'template', 'copy', 'export', 'import', 'image', 'draw', 'board', 'note', 'edge-note', 'color', 'dice', 'tag', 'link',
    'task', 'fold', 'unfold', 'eye', 'code', 'command', 'help', 'settings', 'sun', 'moon', 'monitor', 'share', 'download',
    'upload', 'drag-grip', 'pen', 'pencil', 'marker', 'brush', 'highlighter', 'eraser', 'shape-rect', 'shape-ellipse',
    'shape-line', 'shape-arrow', 'text', 'select', 'hand', 'lock', 'warning', 'info', 'sync', 'history', 'clock', 'restore',
    'bold', 'italic', 'underline', 'strike', 'h-size', 'caption', 'image-left', 'image-right', 'image-above', 'image-off',
    'card', 'split', 'full', 'wifi-off', 'offline', 'glass', 'fullscreen'];
  var absent = need.filter(function (n) { return html.indexOf('id="i-' + n + '"') < 0; });
  t.same(absent, [], 'sprite complete');
  var symbolIds = [];
  html.replace(/<symbol id="i-([^"]+)"/g, function (whole, id) { symbolIds.push(id); return whole; });
  var dupes = symbolIds.filter(function (id, i) { return symbolIds.indexOf(id) !== i; });
  t.same(dupes, [], 'no duplicate symbol ids');
  var usedInCode = [];
  ['js/app.js', 'js/core/ui.js', 'js/features/pwa.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(H.ROOT, f), 'utf8');
    var re = /icon:\s*'([a-z-]+)'|icon\('([a-z-]+)'/g;
    var m;
    while ((m = re.exec(src))) usedInCode.push(m[1] || m[2]);
  });
  var unknown = usedInCode.filter(function (n) { return symbolIds.indexOf(n) < 0; });
  t.same(unknown, [], 'every icon the shell asks for exists');

  t.step('tokens: the two dark sets agree and every pair meets its contrast');
  var css = fs.readFileSync(path.join(H.ROOT, 'css/tokens.css'), 'utf8');
  function vars(text) {
    var o = {};
    text.replace(/--([a-z0-9-]+):\s*([^;]+);/g, function (w, k, v) { o[k] = v.trim(); return w; });
    return o;
  }
  var light = vars(css.slice(css.indexOf(':root {'), css.indexOf('@supports')));
  var darkSystem = vars(/:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/.exec(css)[1]);
  var darkManual = vars(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)[1]);
  var drift = Object.keys(Object.assign({}, darkSystem, darkManual)).filter(function (k) { return darkSystem[k] !== darkManual[k]; });
  t.same(drift, [], 'the system-dark and manual-dark blocks are identical');
  function rgbOf(v, set) {
    var ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
    if (ref) return rgbOf(set[ref[1]], set);
    var m = /^#([0-9a-f]{6})$/i.exec(v || '');
    return m ? [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16); }) : null;
  }
  function luminance(c) {
    return c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); })
      .reduce(function (a, x, i) { return a + x * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b) {
    var l1 = luminance(a);
    var l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  var PAIRS = [['ink', 'paper', 4.5], ['ink-soft', 'paper', 4.5], ['ink-soft', 'paper-raised', 4.5], ['ink-faint', 'paper', 4.5],
    ['ink-faint', 'paper-raised', 4.5], ['on-accent', 'accent', 4.5], ['on-danger', 'danger', 4.5], ['line-control', 'paper', 3],
    ['line-control', 'paper-raised', 3], ['accent', 'paper', 3], ['accent-ink', 'paper', 4.5], ['danger', 'paper-raised', 4.5],
    ['on-inverse', 'inverse', 4.5], ['inverse-accent', 'inverse', 4.5], ['note', 'paper', 3]];
  [['light', light], ['dark', Object.assign({}, light, darkSystem)]].forEach(function (theme) {
    var low = PAIRS.filter(function (p) {
      var a = rgbOf(theme[1][p[0]], theme[1]);
      var b = rgbOf(theme[1][p[1]], theme[1]);
      return !a || !b || ratio(a, b) < p[2];
    }).map(function (p) { return p[0] + '/' + p[1]; });
    t.same(low, [], theme[0] + ': AA for text, 3:1 for controls');
  });

  t.step('theme applied before the first stylesheet');
  var darkCtx = await H.context(t, { colorScheme: 'light' });
  var dark = await darkCtx.newPage();
  await dark.addInitScript(function () {
    try {
      localStorage.setItem('mindroot2:theme', 'dark');
      localStorage.setItem('mindroot2:prefs', JSON.stringify({ v: 1, prefs: { theme: 'dark' } }));
    } catch (e) { /* the test checks the result */ }
    window.__trace = [];
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'attributes') window.__trace.push('theme:' + document.documentElement.getAttribute('data-theme'));
        Array.prototype.forEach.call(m.addedNodes || [], function (n) {
          if (n.nodeName === 'LINK' && /stylesheet/.test(n.getAttribute('rel') || '')) window.__trace.push('css');
        });
      });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme'] });
  });
  await t.open('', { page: dark });
  var trace = await dark.evaluate(function () { return window.__trace; });
  t.eq(trace[0], 'theme:dark', 'data-theme set first');
  t.check('before any stylesheet', trace.indexOf('css') > trace.indexOf('theme:dark'), trace);
  t.eq(await dark.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }), 'rgb(19, 21, 25)', 'dark paper');
  t.same(await dark.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { return m.content; });
  }), ['#131519', '#131519'], 'theme-color follows the manual choice');
  t.eq(await dark.evaluate(function () { return document.querySelector('meta[name="color-scheme"]').content; }), 'dark', 'color-scheme meta');

  t.step('changing the theme persists it for the next boot');
  await dark.evaluate(function () { window.MindRoot.prefs.set('theme', 'light'); window.MindRoot.prefs.flush(); });
  await H.until(dark, function () { return document.documentElement.getAttribute('data-theme') === 'light'; });
  t.eq(await dark.evaluate(function () { return localStorage.getItem('mindroot2:theme'); }), 'light', 'mirror updated');
  await dark.evaluate(function () { window.MindRoot.prefs.set('theme', 'system'); });
  await H.until(dark, function () { return !document.documentElement.hasAttribute('data-theme'); });
  t.eq(await dark.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }), 'rgb(251, 251, 252)', 'system (light here) after the switch');
  t.same(await dark.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { return m.content; });
  }), ['#fbfbfc', '#131519'], 'theme-color metas back to their media defaults');

  t.step('storage blocked: still boots');
  var blockedCtx = await H.context(t);
  var blocked = await blockedCtx.newPage();
  await blocked.addInitScript(function () {
    var deny = function () { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny });
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: deny });
  });
  await t.open('', { page: blocked });
  t.eq(await blocked.evaluate(function () { return window.MindRoot.booted; }), true, 'booted');
  t.eq(await blocked.evaluate(function () { return window.MindRoot.prefs.available(); }), false, 'preferences in memory');
  await blocked.keyboard.press('Control+B');
  t.eq(await blocked.evaluate(function () { return document.documentElement.getAttribute('data-sidebar'); }), 'closed', 'the shell works');

  t.step('a failed boot shows the failure screen and exports the raw data');
  /* The failure path logs a console error on purpose, so this one page runs
   * in a context the runner does not watch; its own guard still refuses the
   * network, and the only console error allowed is the boot failure. */
  var failCtx = await t.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  var failNetwork = [];
  await failCtx.route('**/*', function (route) {
    var u = route.request().url();
    if (/^(file|data|blob|about):/.test(u)) return route.continue();
    failNetwork.push(u);
    return route.abort();
  });
  await H.stubMissing(failCtx, null);
  var fail = await failCtx.newPage();
  var failErrors = [];
  fail.on('pageerror', function (e) { failErrors.push('pageerror ' + e.message); });
  fail.on('console', function (m) { if (m.type() === 'error') failErrors.push(m.text()); });
  await fail.addInitScript(function () {
    var ns = {};
    var real = null;
    function broken() { return Promise.reject(new Error('the disk is on fire')); }
    Object.defineProperty(ns, 'storage', {
      configurable: true,
      enumerable: true,
      get: function () { return real || { open: broken }; },
      set: function (v) { real = Object.assign({}, v, { open: broken }); }
    });
    window.MindRoot = ns;
  });
  await fail.goto(t.fileUrl('index.html') + '?db=e2e-boot-raw&lang=en');
  await H.until(fail, function () { return !!document.querySelector('.boot-fail'); }, null, 10000);
  t.eq(await fail.evaluate(function () { return window.MindRoot.booted; }), false, 'not booted');
  t.check('says what happened', /did not start/.test(await fail.textContent('.boot-fail')), await fail.textContent('.boot-fail'));
  t.check('shows the error', /disk is on fire/.test(await fail.textContent('.boot-fail__error')));
  t.eq(await fail.evaluate(function () { return document.getElementById('app').inert; }), true, 'the broken app is inert');
  t.eq(await fail.evaluate(function () { return window.MindRoot.ready.then(function () { return 'ok'; }, function (e) { return 'rejected: ' + e.message; }); }), 'rejected: the disk is on fire', 'ready rejects');
  await fail.click('.boot-fail .btn--primary');
  await H.until(fail, function () { return /nothing stored/i.test(document.querySelector('.boot-fail__status').textContent); });
  t.check('an empty browser says so', /nothing stored/i.test(await fail.textContent('.boot-fail__status')));
  /* Listed without opening it: opening is what would create it. */
  t.eq(await fail.evaluate(function () {
    return indexedDB.databases().then(function (list) {
      return list.some(function (d) { return d.name === 'e2e-boot-raw'; });
    });
  }), false, 'and the export did not create the database it looked for');
  await fail.evaluate(function () {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open('e2e-boot-raw', 1);
      r.onupgradeneeded = function () {
        r.result.createObjectStore('projects', { keyPath: 'id' });
        r.result.createObjectStore('kv');
      };
      r.onsuccess = function () {
        var tx = r.result.transaction(['projects', 'kv'], 'readwrite');
        tx.objectStore('projects').put({ id: 'p1', name: 'Città', maps: [{ id: 'm1', text: '# Città\n' }], when: new Date(0) });
        tx.objectStore('kv').put(new Blob(['png bytes'], { type: 'image/png' }), 'blob1');
        tx.oncomplete = function () { r.result.close(); resolve(); };
        tx.onerror = function () { reject(tx.error); };
      };
      r.onerror = function () { reject(r.error); };
    });
  });
  var downloadPromise = fail.waitForEvent('download');
  await fail.click('.boot-fail .btn--primary');
  var download = await downloadPromise;
  var file = await download.path();
  var dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  t.eq(dump.format, 'mindroot2-raw', 'raw export format');
  t.eq(dump.database, 'e2e-boot-raw', 'the database of this page');
  t.eq(dump.stores.projects[0].value.name, 'Città', 'records exported');
  t.eq(dump.stores.projects[0].value.when.$date, '1970-01-01T00:00:00.000Z', 'dates tagged');
  t.check('blobs as data URLs', /^data:image\/png;base64,/.test(dump.stores.kv[0].value.$blob), dump.stores.kv[0]);
  t.check('file name', /^mindroot2-raw-\d{4}-\d\d-\d\d\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
  t.same(failNetwork, [], 'no network from the failed page either');
  t.check('the only console error is the boot failure', failErrors.length === 1 && /did not start/.test(failErrors[0]), failErrors);
  await failCtx.close();

  /* The language of a first visit (no ?lang=, no stored choice) is English,
   * whatever the browser says: Italian is a second language a person picks
   * in Settings, and that choice survives a reload. */
  t.step('a first visit is in English whatever the browser\'s language');
  var cases = [
    { locale: 'it-IT', why: 'an Italian browser' },
    { locale: 'en-US', why: 'an English browser' },
    { locale: 'fr-FR', why: 'a French browser' },
    { locale: 'de-DE', why: 'a German browser' },
    { locale: 'en-US', none: true, why: 'no language to read (empty list, no navigator.language)' },
    { locale: 'it-IT', throws: true, why: 'a browser whose language getters throw' }
  ];
  /* `stored` is the preference as the page holds it, `storage` whether the
   * page could reach localStorage at all when it loaded: a page that could
   * not keeps its preferences in memory, where a reload cannot find them. */
  async function langOf(p) {
    return p.evaluate(function () { return { html: document.documentElement.lang, lang: window.MindRoot.i18n.lang(), cancel: window.MindRoot.i18n.t('ui.cancel'), stored: window.MindRoot.prefs.get('lang'), storage: window.MindRoot.prefs.available() }; });
  }
  for (var ci = 0; ci < cases.length; ci++) {
    var c = cases[ci];
    var lctx = await t.newContext({ locale: c.locale });
    await H.stubMissing(lctx, t);
    if (c.none || c.throws) {
      await lctx.addInitScript(function (throws) {
        var get = throws ? function () { throw new Error('no language'); } : function () { return throws ? null : undefined; };
        Object.defineProperty(Navigator.prototype, 'languages', { configurable: true, get: throws ? get : function () { return []; } });
        Object.defineProperty(Navigator.prototype, 'language', { configurable: true, get: get });
      }, !!c.throws);
    }
    var lp = await lctx.newPage();
    await lp.goto(t.fileUrl('index.html') + '?db=e2e-boot-lang-' + ci);
    await lp.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
    t.same(await langOf(lp), { html: 'en', lang: 'en', cancel: 'Cancel', stored: null, storage: true }, c.locale + (c.none ? ' (unreadable)' : c.throws ? ' (throws)' : '') + ': ' + c.why + ', English');
    await lctx.close();
  }

  t.step('Italian only when chosen in Settings, and the choice survives a reload');
  var chooseCtx = await t.newContext({ locale: 'it-IT' });
  await H.stubMissing(chooseCtx, t);
  var cp = await chooseCtx.newPage();
  var chooseUrl = t.fileUrl('index.html') + '?db=e2e-boot-lang-choose';
  await cp.goto(chooseUrl);
  await cp.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  t.eq((await langOf(cp)).lang, 'en', 'an Italian browser starts in English');
  await cp.evaluate(function () { window.MindRoot.commands.run('settings.open'); });
  await cp.waitForSelector('dialog[open].ws-sheet--settings #set-lang');
  t.same(await cp.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#set-lang .seg__opt'), function (b) { return b.getAttribute('data-value'); });
  }), ['en', 'it'], 'English listed first');
  await cp.click('#set-lang .seg__opt[data-value="it"]');
  t.same(await langOf(cp), { html: 'it', lang: 'it', cancel: 'Annulla', stored: 'it', storage: true }, 'chosen: Italian, stored');
  await cp.evaluate(function () { return window.MindRoot.prefs.flush && window.MindRoot.prefs.flush(); });
  function rawPrefs() { try { return window.localStorage.getItem('mindroot2:prefs'); } catch (err) { return 'localStorage threw: ' + err; } }
  var written = await cp.evaluate(rawPrefs);
  t.check('flushed: in this page\'s localStorage', /"lang":"it"/.test(written || ''), written);
  await cp.goto(chooseUrl);
  await cp.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  var reloaded = await langOf(cp);
  t.same(reloaded, { html: 'it', lang: 'it', cancel: 'Annulla', stored: 'it', storage: true }, 'after a reload: still Italian');
  /* Each way this can fail says which it is: a page that could not reach
   * localStorage (storage: false, above or here), a write that never landed
   * in its own page (the check before the reload), or one the next page
   * does not find (this one). */
  var reread = await cp.evaluate(rawPrefs);
  t.check('and the reloaded page finds it in localStorage', /"lang":"it"/.test(reread || ''), reread);
  await chooseCtx.close();
};
