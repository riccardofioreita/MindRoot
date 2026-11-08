/* MindRoot - helpers shared by the workspace e2e suites (workspace*,
 * sidebar*, trash*, copies*, palette*, settings*, welcome*): open the real
 * app, make projects through the store, wait for conditions (never a
 * guessed time), and read back what the person would see. */
'use strict';

var H = require('../shell/helpers.js');

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 8000, polling: 30 });
}

/* A context of its own (desktop by default, or a phone). */
async function context(t, kind) {
  var opts = kind === 'phone'
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : kind === 'tablet'
      ? { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } };
  return H.context(t, opts);
}

/* Opens the app on a fresh database and makes the projects given:
 * [{name, maps: [[name, text], ...]}]. Waits until the first map of the
 * last project is open and drawn. Returns {page, projects: [{id, maps: [ids]}]}. */
async function boot(t, projects, opts) {
  opts = opts || {};
  var page = opts.page;
  if (!page) {
    var ctx = await context(t, opts.kind);
    page = await ctx.newPage();
  }
  await t.open(opts.query || '', { page: page, lang: opts.lang });
  var ids = [];
  if (projects && projects.length) {
    ids = await page.evaluate(function (list) {
      var ns = window.MindRoot;
      return list.map(function (p) {
        var made = ns.store.createProject({ name: p.name, description: p.description || '', maps: p.maps.map(function (m) { return { name: m[0], text: m[1] }; }) });
        if (p.template) ns.store.setTemplate(made.id, true);
        return { id: made.id, maps: made.maps.map(function (m) { return m.id; }) };
      });
    }, projects);
    var last = ids[ids.length - 1];
    await until(page, function (mid) {
      var c = window.MindRoot.session.current();
      return c && c.mapId === mid;
    }, last.maps[0]);
    await settled(page);
  }
  return { page: page, projects: ids };
}

async function settled(page) {
  await page.evaluate(function () {
    var s = window.MindRoot.session;
    return (s && s.view ? s.view.settled() : Promise.resolve()).then(function () {
      return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    });
  });
}

/* Every transition and animation on the page has landed (a sheet sliding
 * in, a toast arriving): for screenshots and for measuring where things
 * rest. */
function rest(page) {
  return until(page, function () {
    return !document.getAnimations().some(function (a) { return a.playState === 'running'; });
  }, null, 4000).catch(function () {});
}

/* The toast showing now, or ''. */
function toast(page) {
  return page.evaluate(function () {
    var list = document.querySelectorAll('.toast:not([hidden]) .toast__text');
    return list.length ? list[list.length - 1].textContent : '';
  });
}

function waitToast(page, re) {
  return until(page, function (src) {
    var list = document.querySelectorAll('.toast:not([hidden]) .toast__text');
    return list.length && new RegExp(src).test(list[list.length - 1].textContent);
  }, re.source);
}

function here(page) {
  return page.evaluate(function () { return window.MindRoot.store.here(); });
}

function focusInfo(page) {
  return page.evaluate(function () {
    var a = document.activeElement;
    return a ? { tag: a.tagName, id: a.id, key: a.getAttribute('data-key'), cls: a.className && a.className.baseVal === undefined ? a.className : '', role: a.getAttribute('role'), text: (a.textContent || '').trim().slice(0, 60) } : null;
  });
}

/* Every string of these prefixes in both languages, in house style. */
function copyCheck(page, prefixes) {
  return page.evaluate(function (src) {
    var I = window.MindRoot.i18n;
    var mine = new RegExp('^(' + src + ')\\.');
    var en = I.keys('en').filter(function (k) { return mine.test(k); });
    var it = I.keys('it').filter(function (k) { return mine.test(k); });
    var lang = I.lang();
    function texts(l, keys) { I.init(l); var o = {}; keys.forEach(function (k) { o[k] = I.t(k); }); return o; }
    var enText = texts('en', en);
    var itText = texts('it', it);
    I.init(lang);
    var all = Object.keys(itText).map(function (k) { return itText[k]; }).concat(Object.keys(enText).map(function (k) { return enText[k]; }));
    return {
      count: en.length,
      onlyEn: en.filter(function (k) { return it.indexOf(k) < 0; }),
      onlyIt: it.filter(function (k) { return en.indexOf(k) < 0; }),
      bang: all.filter(function (s) { return /!/.test(s) && !/!\[/.test(s); }),
      dash: all.filter(function (s) { return /—/.test(s); }),
      emoji: all.filter(function (s) { return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s); })
    };
  }, prefixes.join('|'));
}

module.exports = {
  H: H,
  until: until,
  context: context,
  boot: boot,
  settled: settled,
  rest: rest,
  toast: toast,
  waitToast: waitToast,
  here: here,
  focusInfo: focusInfo,
  copyCheck: copyCheck,
  stubMissing: H.stubMissing
};
