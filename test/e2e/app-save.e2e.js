/* app-save: the saving promises around the open map. An edit shows "not
 * saved yet" then "saved at" in the top bar (a dot alone on phones), and
 * routine saves are not spoken; Mod+S writes at once - from a text field
 * too, never opening the browser's own save - and says so truthfully: in a
 * read-only tab, and with a browser that keeps nothing, it says that
 * instead; modules with work in flight are waited for through the bus
 * 'flush' event, and the drawings being edited (ink.flush) are handed over
 * before storage writes, on Mod+S as when the page is hidden or left. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 8000, polling: 50 });
}

function booted(page) {
  return page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
}

function toastText(page) {
  return page.evaluate(function () {
    var el = document.querySelector('.toast:not([data-seen]) .toast__text');
    return el ? el.textContent : null;
  });
}

/* Toasts already shown are marked, so a wait finds only a new one. */
function forgetToasts(page) {
  return page.evaluate(function () {
    Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (el) { el.setAttribute('data-seen', ''); });
  });
}

async function waitToast(page, re) {
  await page.waitForFunction(function (src) {
    var list = document.querySelectorAll('.toast:not([data-seen]) .toast__text');
    return Array.prototype.some.call(list, function (el) { return new RegExp(src).test(el.textContent); });
  }, re.source, { timeout: 8000, polling: 50 });
}

/* What IndexedDB holds for a map, read straight from the database. */
function storedText(page, ids) {
  return page.evaluate(async function (ids) {
    var data = await window.MindRoot.storage.load();
    var p = data.projects.filter(function (x) { return x.id === ids.pid; })[0];
    var m = p && p.maps.filter(function (x) { return x.id === ids.mid; })[0];
    return m ? m.text : null;
  }, ids);
}

function edit(page, title) {
  return page.evaluate(function (title) {
    var ns = window.MindRoot;
    var c = ns.session.current();
    return ns.session.apply(ns.doc.addChild(c.state, '', title), { label: 'store.label.editMap' });
  }, title);
}

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var page = await t.open();
  var ids = await page.evaluate(function () {
    var p = window.MindRoot.store.createProject({ name: 'Kitchen', maps: [{ name: 'Recipes', text: '# Recipes\n\n- Bread\n' }] });
    return { pid: p.id, mid: p.maps[0].id };
  });
  await until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, ids.mid);
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });

  t.step('the save state follows an edit');
  await page.evaluate(function () {
    window.__saves = [];
    window.MindRoot.bus.on('save', function (d) { window.__saves.push(d.state); });
  });
  t.eq(await edit(page, 'Soup'), true, 'edited');
  /* State and words are read in the same frame: the camera the edit moved
   * is written a moment later (a save of its own), which may already have
   * turned the state back to "pending" by the time a second read lands. */
  var shown = await page.waitForFunction(function () {
    var el = document.getElementById('save-state');
    return el.getAttribute('data-state') === 'saved' && { saves: window.__saves.slice(), text: el.querySelector('.save__text').textContent };
  }, null, { timeout: 8000, polling: 50 }).then(function (h) { return h.jsonValue(); });
  var saves = shown.saves;
  t.check('pending, saving, then saved', saves.indexOf('pending') >= 0 && saves.indexOf('saving') > saves.indexOf('pending') && saves[saves.length - 1] === 'saved', saves);
  t.check('the text says when', /^Saved at /.test(shown.text), shown.text);
  t.eq(await page.getAttribute('#save-state', 'aria-hidden'), 'true', 'the visible line is not read out twice');
  t.eq(await page.textContent('#save-status'), '', 'a routine save is not announced');
  t.check('it is in the database', /- Soup\n/.test(await storedText(page, ids)));
  await until(page, function (want) { return document.title === want; }, 'Recipes - Kitchen - MindRoot');
  t.check('the tab title', true);

  t.step('on a phone the state is a dot');
  await page.setViewportSize({ width: 375, height: 740 });
  await until(page, function () { return document.documentElement.getAttribute('data-layout') === 'compact'; });
  var phone = await page.evaluate(function () {
    var s = document.getElementById('save-state');
    var dot = s.querySelector('.save__dot').getBoundingClientRect();
    return { text: getComputedStyle(s.querySelector('.save__text')).display, dot: dot.width > 0 && dot.height > 0, shown: getComputedStyle(s).display !== 'none' };
  });
  t.same(phone, { text: 'none', dot: true, shown: true }, 'no words, a visible dot');
  await page.setViewportSize({ width: 1280, height: 800 });
  await until(page, function () { return document.documentElement.getAttribute('data-layout') === 'expanded'; });

  t.step('Mod+S writes now and says so');
  t.eq(await edit(page, 'Salad'), true, 'edited');
  t.eq(await page.evaluate(function () { return window.MindRoot.storage.pending(); }), true, 'a write is waiting');
  await forgetToasts(page);
  await page.keyboard.press('Control+S');
  await waitToast(page, /^Saved$/);
  t.check('the toast says saved', true);
  t.check('and the database has it at once', /- Salad\n/.test(await storedText(page, ids)));

  t.step('Mod+S from a text field, without the browser\'s own save');
  var prevented = await page.evaluate(function () {
    var input = document.createElement('input');
    input.id = 'probe-field';
    document.getElementById('floaters').appendChild(input);
    input.focus();
    window.__prevented = null;
    document.addEventListener('keydown', function (e) { if (e.key === 's' || e.key === 'S') window.__prevented = e.defaultPrevented; });
    return true;
  });
  t.check('a field has focus', prevented);
  await edit(page, 'Stew');
  await forgetToasts(page);
  await page.keyboard.press('Control+S');
  await until(page, function () { return window.__prevented !== null; });
  t.eq(await page.evaluate(function () { return window.__prevented; }), true, 'the key is taken (no "save page as")');
  await waitToast(page, /^Saved$/);
  t.check('saved from the field', /- Stew\n/.test(await storedText(page, ids)));
  await page.evaluate(function () { document.getElementById('probe-field').remove(); });

  t.step('modules with work in flight are waited for');
  var waited = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var off = ns.bus.on('flush', function (d) {
      d.waitUntil(new Promise(function (resolve) {
        setTimeout(function () {
          var c = ns.session.current();
          ns.store.setMapText(ids.pid, ids.mid, c.text + '- Late\n', { origin: 'probe' });
          resolve();
        }, 150);
      }));
    });
    window.__offFlush = off;
    return true;
  }, ids);
  t.check('a listener', waited);
  await forgetToasts(page);
  await page.keyboard.press('Control+S');
  await waitToast(page, /^Saved$/);
  await page.evaluate(function () { window.__offFlush(); });
  t.check('what it handed over is in the database with the rest', /- Late\n/.test(await storedText(page, ids)));
  var reason = await page.evaluate(function () {
    var got = null;
    var off = window.MindRoot.bus.on('flush', function (d) { got = d.reason; });
    var done = window.MindRoot.commands.run('file.save');
    off();
    /* That save is let finish, so the next step counts only its own. */
    return Promise.resolve(done).then(function () { return got; });
  });
  t.eq(reason, 'save', "the 'flush' event says why");

  t.step('the drawings being edited are handed over before storage writes');
  await page.evaluate(function () {
    var ns = window.MindRoot;
    window.__order = [];
    window.__realInk = ns.ink.flush;
    window.__realStorage = ns.storage.flush;
    ns.ink.flush = function () { window.__order.push('ink'); return window.__realInk.apply(this, arguments); };
    ns.storage.flush = function () { window.__order.push('storage'); return window.__realStorage.apply(this, arguments); };
  });
  await forgetToasts(page);
  await page.keyboard.press('Control+S');
  await waitToast(page, /^Saved$/);
  t.same(await page.evaluate(function () { return window.__order; }), ['ink', 'storage'], 'Mod+S: ink.flush, then storage.flush');
  var hidden = await page.evaluate(function () {
    window.__order = [];
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
    var a = window.__order.slice();
    window.__order = [];
    window.dispatchEvent(new Event('pagehide'));
    var b = window.__order.slice();
    var ns = window.MindRoot;
    ns.ink.flush = window.__realInk;
    ns.storage.flush = window.__realStorage;
    return { hide: a, leave: b };
  });
  t.same(hidden, { hide: ['ink', 'storage'], leave: ['ink', 'storage'] }, 'hiding and leaving the page: the same order');
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });

  t.step('a read-only tab says it saves nothing');
  var second = await t.context.newPage();
  await second.goto(page.url());
  await booted(second);
  t.eq(await second.evaluate(function () { return window.MindRoot.session.readOnly(); }), true, 'read-only');
  await forgetToasts(second);
  await second.keyboard.press('Control+S');
  await waitToast(second, /saves nothing/);
  t.eq(await toastText(second), 'This tab saves nothing: another tab keeps your maps.', 'the toast says why');
  await second.close();

  t.step('a browser that keeps nothing: Mod+S says so');
  var memory = await H.context(t);
  await memory.addInitScript(function () {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: function () { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  var mp = await memory.newPage();
  await t.open('', { page: mp });
  await mp.evaluate(function () { window.MindRoot.store.createProject({ name: 'Temp', maps: [{ name: 'T', text: '# T\n' }] }); });
  await forgetToasts(mp);
  await mp.keyboard.press('Control+S');
  await waitToast(mp, /Not kept/);
  t.eq(await mp.evaluate(function () { var el = document.querySelector('.toast'); return el && el.getAttribute('data-kind'); }), 'error', 'as an error');
  t.eq(await mp.getAttribute('#save-state', 'data-state'), 'memory', 'and the top bar says it too');

  t.step('a name still being typed survives a reload and a closed tab');
  var lctx = await t.newContext();
  for (var round = 0; round < 2; round++) {
    var lp = await lctx.newPage();
    await lp.goto(t.fileUrl('index.html') + '?db=leave-typing&lang=en&welcome=1');
    await booted(lp);
    var mark = 'MARKER' + round;
    await lp.evaluate(function () { window.MindRoot.session.select(''); window.MindRoot.session.view.el.focus(); });
    await lp.keyboard.press('Tab');
    await until(lp, function () { return !!window.MindRoot.editor.renaming(); });
    await lp.keyboard.type(mark);
    if (round === 0) await lp.reload();
    else { await lp.close({ runBeforeUnload: true }); lp = await lctx.newPage(); await lp.goto(t.fileUrl('index.html') + '?db=leave-typing&lang=en&welcome=1'); }
    await booted(lp);
    var kept = await lp.evaluate(function (m) {
      var s = window.MindRoot.store;
      return s.projects().some(function (p) { return s.project(p.id || p).maps.some(function (x) { return x.text.indexOf(m) >= 0; }); });
    }, mark);
    t.eq(kept, true, round === 0 ? 'reloaded mid-word: the word is there' : 'closed mid-word: the word is there');
    await lp.close();
  }
};
