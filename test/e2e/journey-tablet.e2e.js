/* journey-tablet: a 768x1024 touch tablet, in Italian. The middle layout:
 * the projects list is a drawer, the actions float in glass capsules at the
 * top, the zoom capsule sits in the corner, the node toolbar floats by the
 * selected node (no thumb bar). Checked here:
 *
 *   the welcome map in Italian -> every string the app registers exists in
 *   both languages and the Italian copy keeps its rules (no exclamation
 *   marks, no em-dash, no emoji) -> the drawer opens and a tap outside
 *   closes it without touching the map -> a node added from the floating
 *   toolbar -> help, in Italian, generated from the commands -> the
 *   language switched to English and back, the bars relabelled -> the
 *   system's dark scheme followed with no setting -> every control on
 *   screen finger-sized. Screenshots: test/out/journey-tablet-*.png. */
'use strict';

var VIEW = { width: 768, height: 1024 };

module.exports = async function (t) {
  var ctx = await t.newContext({ viewport: VIEW, hasTouch: true, isMobile: true });
  var page = await ctx.newPage();
  var cdp = await ctx.newCDPSession(page);
  function until(fn, arg, timeout) { return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: timeout || 8000, polling: 30 }); }
  async function tap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x, y: y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function rest() {
    await until(function () { return !document.getAnimations().some(function (a) { return a.playState === 'running'; }); }, null, 4000).catch(function () {});
  }
  async function tapEl(selector) {
    var loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    await rest();
    var r = await loc.boundingBox();
    await tap(r.x + r.width / 2, r.y + r.height / 2);
  }
  async function settled() {
    await page.evaluate(function () {
      var v = window.MindRoot.session.view;
      return v.settled().then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); });
    });
  }
  function text() { return page.evaluate(function () { return window.MindRoot.session.current().text; }); }
  async function controls(where) {
    await rest();
    var rep = await page.evaluate(function () {
      var out = { outside: [], small: [] };
      Array.prototype.forEach.call(document.querySelectorAll('button, a[href], select, [role="button"], [role="treeitem"]'), function (el) {
        if (el.closest('[inert], [hidden], #stage .mv') || el.classList.contains('switch')) return;
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || !el.getClientRects().length) return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 20) || el.className;
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.outside.push(name);
        if (r.width < 43.5 || r.height < 43.5) out.small.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      out.sideways = document.scrollingElement.scrollWidth > innerWidth;
      return out;
    });
    t.same(rep.outside, [], where + ': every control on screen');
    t.same(rep.small, [], where + ': every control finger-sized');
    t.eq(rep.sideways, false, where + ': no sideways scroll');
  }

  t.step('the welcome map, in Italian');
  await t.open('welcome=1', { page: page, lang: 'it' });
  await settled();
  var start = await page.evaluate(function () {
    var ns = window.MindRoot;
    function ids(sel) { return Array.prototype.map.call(document.querySelectorAll(sel + ' [data-command]'), function (b) { return b.getAttribute('data-command'); }); }
    return {
      lang: document.documentElement.lang,
      layout: document.documentElement.getAttribute('data-layout'),
      root: ns.session.current().state.flat[0] ? ns.doc.labelOf(ns.session.current().state.flat[0]) : null,
      top: ids('#topbar-actions'),
      thumb: getComputedStyle(document.getElementById('thumbbar')).display,
      zoom: !document.getElementById('zoombar').hidden,
      drawer: document.documentElement.getAttribute('data-sidebar'),
      undo: document.querySelector('#topbar-actions [data-command="history.undo"]').getAttribute('aria-label')
    };
  });
  t.eq(start.lang, 'it', 'the page says it is Italian');
  t.eq(start.layout, 'medium', 'the middle layout');
  t.eq(start.root, 'Benvenuto in MindRoot', 'the sample map is written in Italian');
  t.same(start.top, ['history.undo', 'history.redo', 'source.toggle', 'ai.open', 'ai.chat', 'search.nodes'], 'the top capsule');
  t.eq(start.thumb, 'none', 'no thumb bar on a tablet');
  t.eq(start.zoom, true, 'the zoom capsule');
  t.eq(start.drawer, 'closed', 'the projects drawer starts closed');
  t.eq(start.undo, 'Niente da annullare', 'the bars speak Italian');
  await controls('welcome');
  await t.shot('welcome-light', page);

  t.step('every string in both languages, the Italian copy in its rules');
  var strings = await page.evaluate(function () {
    var i = window.MindRoot.i18n;
    var en = i.keys('en');
    var it = i.keys('it');
    var setIt = {};
    it.forEach(function (k) { setIt[k] = true; });
    var setEn = {};
    en.forEach(function (k) { setEn[k] = true; });
    var bad = [];
    it.forEach(function (k) {
      var v = i.t(k).replace(/<!--|!\[/g, '');
      if (/!|—|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v)) bad.push(k + ' = ' + v);
    });
    return {
      count: it.length,
      missingIt: en.filter(function (k) { return !setIt[k]; }),
      missingEn: it.filter(function (k) { return !setEn[k]; }),
      bad: bad
    };
  });
  t.check('hundreds of strings registered', strings.count > 500, strings.count);
  t.same(strings.missingIt, [], 'every English string has its Italian');
  t.same(strings.missingEn, [], 'and the other way round');
  t.same(strings.bad, [], 'no exclamation mark, em-dash or emoji in the Italian copy');

  t.step('the drawer');
  await tapEl('#sidebar-toggle');
  await until(function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return document.documentElement.getAttribute('data-sidebar') === 'open' && r.left >= -0.5; });
  await controls('drawer');
  await page.evaluate(function () { window.__mapTaps = 0; document.getElementById('stage').addEventListener('click', function () { window.__mapTaps++; }); });
  var before = await page.evaluate(function () { return window.MindRoot.session.selected(); });
  await tap(VIEW.width - 40, VIEW.height / 2);
  await until(function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
  t.eq(await page.evaluate(function () { return window.__mapTaps; }), 0, 'a tap outside closes it and does nothing to the map');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.selected(); }), before, 'the selection is untouched');

  t.step('a node from the floating toolbar');
  await settled();
  var box = await page.evaluate(function () {
    var el = Array.prototype.filter.call(document.querySelectorAll('#stage .mv-node'), function (n) { var x = n.querySelector('.mv-title .mv-text'); return x && x.textContent.trim() === 'File'; })[0];
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await tap(box.x + Math.min(20, box.w / 2), box.y + box.h / 2);
  await until(function () { var ns = window.MindRoot; var e = ns.session.entry(); return e && ns.doc.labelOf(e) === 'File'; });
  await page.waitForSelector('.node-toolbar:not([hidden])', { state: 'visible' });
  t.eq(await page.getAttribute('.node-toolbar [data-command="node.addChild"]', 'aria-label'), 'Aggiungi un figlio', 'the toolbar floats by the node, in Italian');
  await controls('toolbar');
  await tapEl('.node-toolbar [data-command="node.addChild"]');
  await until(function () { var a = document.activeElement; return a && a.closest && a.closest('.mv-node--editing'); });
  await page.keyboard.type('Export to PDF');
  await page.keyboard.press('Enter');
  await until(function () { return !document.querySelector('.mv-node--editing'); });
  t.check('the child is written under "File"', /- File\n[\s\S]*  - Export to PDF\n/.test(await text()), await text());
  function mapOutline() {
    return page.evaluate(function () {
      var el = document.querySelector('#stage .mv');
      return document.activeElement === el ? getComputedStyle(el).outlineStyle : 'not focused';
    });
  }
  t.eq(await mapOutline(), 'none', 'named after a tap: the keys are back on the map with no frame round the screen');
  await page.keyboard.press('ArrowUp');
  t.eq(await mapOutline(), 'none', 'with a node selected its own ring shows where the keys go: no frame round the map');
  await page.keyboard.press('Escape');
  await until(function () { return window.MindRoot.session.selected() === null; });
  t.check('a key from a hardware keyboard with nothing selected brings the focus frame back', !/none|not focused/.test(await mapOutline()), await mapOutline());

  t.step('help, in Italian');
  await tapEl('#sidebar-toggle');
  await until(function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; });
  await tapEl('#sidebar button[aria-label="Aiuto"]');
  await page.waitForSelector('dialog[open].ws-sheet--help', { state: 'visible' });
  var help = await page.evaluate(function () { return document.querySelector('dialog[open].ws-sheet--help').innerText; });
  t.check('generated from the commands, in Italian', /Aggiungi un figlio/.test(help) && !/Add a child/.test(help), help.slice(0, 160));
  await page.keyboard.press('Escape');
  await until(function () { return !document.querySelector('dialog[open]'); });

  t.step('English and back');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('en'); });
  await until(function () { return /^Undo: /.test(document.querySelector('#topbar-actions [data-command="history.undo"]').getAttribute('aria-label')); });
  t.eq(await page.getAttribute('#sidebar-toggle', 'aria-label'), 'Show or hide the projects', 'the shell relabels itself');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('it'); });
  await until(function () { return /^Annulla/.test(document.querySelector('#topbar-actions [data-command="history.undo"]').getAttribute('aria-label')); });
  t.check('and back to Italian', true);

  t.step('the system dark scheme, followed');
  await page.evaluate(function () { if (window.MindRoot.shell.sidebar.isOpen()) window.MindRoot.shell.sidebar.close(); });
  await page.emulateMedia({ colorScheme: 'dark' });
  await until(function () { return parseInt(getComputedStyle(document.body).backgroundColor.match(/\d+/)[0], 10) < 60; });
  t.eq(await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); }), null, 'no setting written: the system decides');
  await settled();
  await rest();
  await t.shot('dark', page);
  await page.emulateMedia({ colorScheme: 'light' });
};
