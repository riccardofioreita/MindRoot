/* tabs: one tab at a time, on file:// in Chromium. The first tab of a
 * database holds the data; a second is read-only (its store refuses
 * changes, its storage writes nothing) and says so with "Use here"; using
 * it makes the first tab save, let go and say so, and the second reload
 * holding the data. Closing the tab that holds the data frees it. The same
 * without Web Locks, over the BroadcastChannel. A page whose storage is
 * memory only is never read-only. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

function booted(page) {
  return page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
}

async function openAt(page, url) {
  await page.goto(url);
  await booted(page);
  return page;
}

function state(page) {
  return page.evaluate(function () {
    var ns = window.MindRoot;
    var banner = document.querySelector('[data-banner="tabs"]');
    return {
      tabs: ns.tabs.state(),
      store: ns.store.readOnly(),
      storage: ns.storage.readOnly(),
      banner: banner && !banner.hidden ? banner.textContent : null
    };
  });
}

/* Clicks "Use here" and waits for this page to come back booted. */
async function useHere(page) {
  await page.evaluate(function () { window.__beforeReload = true; });
  var loaded = page.waitForEvent('load', { timeout: 20000 });
  await page.locator('[data-banner="tabs"] button', { hasText: 'Use here' }).click();
  await loaded;
  await page.waitForFunction(function () { return !window.__beforeReload && window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
}

function until(page, fn, arg) {
  return page.waitForFunction(fn, arg, { timeout: 10000, polling: 50 });
}

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var db = 'e2e-tabs-' + Date.now().toString(36);
  var url = t.fileUrl('index.html') + '?db=' + db + '&lang=en';

  t.step('the first tab holds the data');
  var a = await openAt(t.page, url);
  var sa = await state(a);
  t.same(sa.tabs, { readOnly: false, reason: null, mode: 'locks' }, 'writer, through Web Locks');
  t.eq(sa.store, false, 'its store takes changes');
  t.eq(sa.storage, false, 'its storage writes');
  t.eq(sa.banner, null, 'no banner');
  var pid = await a.evaluate(async function () {
    var ns = window.MindRoot;
    var p = ns.store.createProject({ name: 'Shared' });
    await ns.storage.flush();
    return p.id;
  });
  t.check('a project made and saved', !!pid);

  t.step('a second tab of the same database is read-only');
  var b = await openAt(await t.context.newPage(), url);
  var sb = await state(b);
  t.same(sb.tabs, { readOnly: true, reason: 'busy', mode: 'locks' }, 'read-only: another tab holds the data');
  t.eq(sb.store, true, 'its store refuses changes');
  t.eq(sb.storage, true, 'its storage writes nothing');
  t.check('a banner says so', /open in another tab/.test(sb.banner || ''), sb.banner);
  t.check('and offers Use here', await b.locator('[data-banner="tabs"] button', { hasText: 'Use here' }).count() === 1);
  t.eq(await b.evaluate(function (id) { return !!window.MindRoot.store.project(id); }, pid), true, 'it shows what the first tab saved');
  t.eq(await b.evaluate(function (id) {
    var ns = window.MindRoot;
    return ns.store.setMapText(id, ns.store.map(id).id, '# changed in B\n');
  }, pid), false, 'a change is refused');
  t.eq(await b.evaluate(function () { return window.MindRoot.commands.get('tabs.useHere').when(); }), true, 'the palette offers "Use MindRoot in this tab"');
  t.eq((await state(a)).tabs.readOnly, false, 'the first tab still holds the data');

  t.step('Use here: the other tab saves and lets go, this one reloads holding the data');
  await a.evaluate(function (id) {
    var ns = window.MindRoot;
    ns.bus.on('tabs:yield', function (detail) {
      window.__yieldHeard = ns.store.readOnly() ? 'too late' : 'in time';
      /* A drawing handed over the way ink does: bytes stored first (hash
       * and a write), the store told afterwards - after a pause, too. */
      detail.waitUntil(ns.storage.putBlob(new Blob(['<svg>late</svg>'], { type: 'image/svg+xml' }), 'late.ink.svg').then(function (ref) {
        return new Promise(function (resolve) { setTimeout(resolve, 400); }).then(function () {
          window.__lateSet = ns.store.setFile(id, 'assets/late.ink.svg', ref);
        });
      }));
    });
    ns.store.setMapText(id, ns.store.map(id).id, '# Shared\n\n- written in A just before\n');
  }, pid);
  t.eq(await a.evaluate(function () { return window.MindRoot.storage.pending(); }), true, 'A has a write pending');
  await useHere(b);
  sb = await state(b);
  t.same(sb.tabs, { readOnly: false, reason: null, mode: 'locks' }, 'B now holds the data');
  t.eq(sb.banner, null, 'its banner is gone');
  t.eq(await b.evaluate(function (id) { var ns = window.MindRoot; return ns.store.map(id).text; }, pid),
    '# Shared\n\n- written in A just before\n', 'with what A had pending: A saved before letting go');
  await until(a, function () { return window.MindRoot.tabs.readOnly(); });
  sa = await state(a);
  t.same(sa.tabs, { readOnly: true, reason: 'yielded', mode: 'locks' }, 'A is read-only');
  t.check('and says it is used elsewhere now', /now working in another tab/.test(sa.banner || ''), sa.banner);
  t.eq(await a.evaluate(function () { return window.__yieldHeard; }), 'in time', 'modules heard tabs:yield while they could still hand their edits to the store');
  t.eq(await a.evaluate(function () { return window.__lateSet; }), true, 'an edit handed over asynchronously (waitUntil) is taken by the store');
  t.eq(await b.evaluate(async function (id) {
    var ns = window.MindRoot;
    var ref = ns.store.fileRef(id, 'assets/late.ink.svg');
    return ref ? await ns.storage.blobText(ref.asset) : null;
  }, pid), '<svg>late</svg>', 'and was saved before the other tab reloaded');
  t.eq(await b.evaluate(async function (id) {
    var ns = window.MindRoot;
    var ok = ns.store.setMapText(id, ns.store.map(id).id, '# Shared\n\n- written in B\n');
    await ns.storage.flush();
    return ok;
  }, pid), true, 'B writes');
  t.eq(await a.evaluate(function (id) {
    var ns = window.MindRoot;
    return ns.store.setMapText(id, ns.store.map(id).id, '# A must not\n');
  }, pid), false, 'A does not');

  t.step('closing the tab that holds the data frees it');
  await b.close();
  await until(a, function () { return window.MindRoot.tabs.state().reason === 'closed'; });
  t.check('the read-only tab hears it, and says so', /was closed/.test((await state(a)).banner || ''), (await state(a)).banner);
  var c = await openAt(await t.context.newPage(), url);
  t.eq((await state(c)).tabs.readOnly, false, 'a new tab holds the data at once');
  t.eq(await c.evaluate(function (id) { return window.MindRoot.store.map(id).text; }, pid), '# Shared\n\n- written in B\n', 'and reads what B saved');
  t.eq((await state(a)).tabs.readOnly, true, 'A stays read-only until asked');
  await useHere(a);
  t.eq((await state(a)).tabs.readOnly, false, 'Use here in A takes it back');
  await until(c, function () { return window.MindRoot.tabs.readOnly(); });
  t.eq((await state(c)).tabs.reason, 'yielded', 'and C lets go');
  await c.close();

  t.step('a tab that does not answer has the lock taken from it');
  var d = await openAt(await t.context.newPage(), url);
  t.eq((await state(d)).tabs.readOnly, true, 'D is read-only while A holds the data');
  /* A frozen in the background: it hears the request but never gets to
   * let go (its last write never finishes). */
  await a.evaluate(function () { window.MindRoot.storage.flush = function () { return new Promise(function () {}); }; });
  var asked = Date.now();
  await useHere(d);
  t.eq((await state(d)).tabs.readOnly, false, 'after waiting a few seconds, D takes the lock anyway');
  t.check('it waited for an answer first', Date.now() - asked >= 3500, Date.now() - asked);
  await until(a, function () { return window.MindRoot.tabs.readOnly(); });
  t.eq((await state(a)).tabs.reason, 'yielded', 'A, robbed of the lock, stops writing');
  t.eq(await a.evaluate(function () { return window.MindRoot.storage.readOnly(); }), true, 'its storage too');
  await d.close();

  t.step('another database is another matter');
  var other = await openAt(await t.context.newPage(), t.fileUrl('index.html') + '?db=' + db + '-other&lang=en');
  t.eq((await state(other)).tabs.readOnly, false, 'a tab of another database holds its own data');
  await other.close();

  t.step('without Web Locks: the BroadcastChannel');
  var noLocks = await H.context(t);
  await noLocks.addInitScript(function () {
    Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get: function () { return undefined; } });
  });
  var url2 = t.fileUrl('index.html') + '?db=' + db + '-channel&lang=en';
  var c1 = await openAt(await noLocks.newPage(), url2);
  t.same((await state(c1)).tabs, { readOnly: false, reason: null, mode: 'channel' }, 'the first holds the data');
  var c2 = await openAt(await noLocks.newPage(), url2);
  t.same((await state(c2)).tabs, { readOnly: true, reason: 'busy', mode: 'channel' }, 'the second is read-only');
  await useHere(c2);
  t.eq((await state(c2)).tabs.readOnly, false, 'Use here works there too');
  await until(c1, function () { return window.MindRoot.tabs.readOnly(); });
  t.eq((await state(c1)).tabs.reason, 'yielded', 'and the other lets go');
  await c1.close();
  await c2.close();
  var url3 = t.fileUrl('index.html') + '?db=' + db + '-race&lang=en';
  var r1 = await noLocks.newPage();
  var r2 = await noLocks.newPage();
  await Promise.all([openAt(r1, url3), openAt(r2, url3)]);
  var both = [(await state(r1)).tabs.readOnly, (await state(r2)).tabs.readOnly];
  t.eq(both.filter(function (x) { return !x; }).length, 1, 'two tabs opening at the same moment: exactly one holds the data');

  t.step('a page that keeps nothing is never read-only');
  var memory = await H.context(t);
  await memory.addInitScript(function () {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: function () { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  var url4 = t.fileUrl('index.html') + '?db=' + db + '-memory&lang=en';
  var m1 = await openAt(await memory.newPage(), url4);
  var m2 = await openAt(await memory.newPage(), url4);
  t.same([(await state(m1)).tabs, (await state(m2)).tabs].map(function (s) { return s.readOnly; }), [false, false], 'each works on its own memory');
  t.eq(await m2.evaluate(function () { return window.MindRoot.storage.saveState().state; }), 'memory', 'and says it keeps nothing');
  t.check('with a banner', await m2.locator('[data-banner="storage"]').count() === 1);
};
