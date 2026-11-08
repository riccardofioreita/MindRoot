/* welcome: the first run seeds one project whose map teaches the app, in
 * the language the app speaks, with the keys of this machine, as no step
 * of the history, saved at once (a reload does not seed again); a page that
 * names its database seeds only when asked. With nothing open the stage
 * says what to do: no projects, or a project with no maps, each with its
 * way forward (new, import, the sample); the card leaves when a map opens.
 * On a phone the card fits the screen and its controls are finger-sized. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

module.exports = async function (t) {
  t.step('the first run seeds the sample, in English');
  var ctx = await W.context(t);
  var page = await ctx.newPage();
  await t.open('welcome=1', { page: page });
  var seeded = await page.evaluate(function () {
    var ns = window.MindRoot;
    var ps = ns.store.projects();
    var c = ns.session.current();
    return {
      n: ps.length, name: ps[0] && ps[0].name, desc: ps[0] && ps[0].description, maps: ps[0] && ps[0].maps.map(function (m) { return m.name; }),
      open: !!c && c.mapId === ps[0].maps[0].id, undo: ns.store.historyState().undoCount, text: c ? c.text : '',
      welcome: ns.welcome.isShown()
    };
  });
  t.eq(seeded.n, 1, 'one project');
  t.eq(seeded.name, 'MindRoot', 'called MindRoot');
  t.check('with a line about it', /first project/.test(seeded.desc), seeded.desc);
  t.same(seeded.maps, ['Welcome'], 'one map, Welcome');
  t.eq(seeded.open, true, 'and it is open');
  t.eq(seeded.undo, 0, 'not a step of the history');
  t.eq(seeded.welcome, false, 'no empty-state card over it');
  var parsed = await page.evaluate(function (text) {
    var ns = window.MindRoot;
    var st = ns.doc.parse(text);
    var tree = ns.doc.viewTree(st);
    var notes = 0, tasks = 0, own = 0, folds = 0;
    (function walk(n) {
      if (n.notes && n.notes.node) notes++;
      if (n.task) tasks++;
      if (n.ownColor) own++;
      if (n.fold) folds++;
      (n.children || []).forEach(walk);
    })(tree);
    return { nodes: st.flat.length, root: tree.text, notes: notes, tasks: tasks, own: own, folds: folds };
  }, seeded.text);
  t.eq(parsed.root, 'Welcome to MindRoot', 'its root');
  t.check('teaches by example: a note, a box, a colour of its own, a fold', parsed.notes >= 1 && parsed.tasks >= 1 && parsed.own >= 1 && parsed.folds >= 1, parsed);
  t.check('a map of some size', parsed.nodes > 25, parsed.nodes);
  t.check('the keys of this machine (Ctrl on Linux)', /Ctrl\+K finds/.test(seeded.text) && /Tab adds a child, Enter a sibling/.test(seeded.text), seeded.text.slice(0, 600));
  t.check('the real copy interval', /every hour/.test(seeded.text));
  var folded = await page.evaluate(function () { return window.MindRoot.session.view.folded().size; });
  t.check('the folded branch is drawn folded', folded >= 1, folded);

  t.step('saved at once: a reload does not seed again');
  await until(page, function () { var s = window.MindRoot.storage.saveState().state; return s === 'saved' || s === 'idle'; });
  var url = page.url();
  await page.goto(url);
  await until(page, function () { return window.MindRoot && window.MindRoot.booted; }, null, 20000);
  var again = await page.evaluate(function () { return window.MindRoot.store.projects().map(function (p) { return p.name; }); });
  t.same(again, ['MindRoot'], 'still one project after a reload');

  t.step('a database named by the page starts empty');
  var plain = await (await W.context(t)).newPage();
  await t.open('', { page: plain });
  var empty = await plain.evaluate(function () {
    var ns = window.MindRoot;
    var card = document.querySelector('#welcome .welcome__card');
    return { n: ns.store.projects().length, shown: ns.welcome.isShown(), title: card && card.querySelector('.empty__title').textContent, buttons: card ? Array.prototype.map.call(card.querySelectorAll('button'), function (b) { return b.textContent.trim(); }) : [] };
  });
  t.eq(empty.n, 0, 'nothing seeded');
  t.eq(empty.shown, true, 'the empty state shows');
  t.eq(empty.title, 'No projects yet', 'says there are no projects');
  t.same(empty.buttons, ['New project', 'Import', 'Open the sample'], 'with the ways forward');
  var hint = await plain.evaluate(function () { return document.querySelector('#welcome .welcome__drop').textContent; });
  t.check('names the drop', /drop files/.test(hint), hint);
  await plain.hover('#welcome-new');
  var hov = await plain.evaluate(function () {
    var b = document.querySelector('#welcome-new');
    var probe = document.createElement('i');
    probe.style.color = 'var(--accent)';
    b.parentNode.appendChild(probe);
    var accent = getComputedStyle(probe).color;
    probe.remove();
    var cs = getComputedStyle(b);
    return { bg: cs.backgroundColor, accent: accent, hovered: b.matches(':hover') };
  });
  t.check('the primary button stays green under the pointer', hov.hovered && hov.bg === hov.accent, JSON.stringify(hov));

  var sem = await plain.evaluate(function () {
    return {
      emptyTreeStop: document.querySelector('#stage .mv').tabIndex,
      h1: !!document.querySelector('h1, [role="heading"][aria-level="1"]'),
      thumb: document.getElementById('thumbbar').getAttribute('role')
    };
  });
  t.same(sem, { emptyTreeStop: -1, h1: true, thumb: 'toolbar' }, 'an empty tree is no Tab stop; the page has a level-one heading; the thumb bar is a toolbar');

  t.step('the sample button brings the map in, as an ordinary step');
  await plain.click('#welcome-sample');
  await until(plain, function () { return !!window.MindRoot.session.current(); });
  var s1 = await plain.evaluate(function () { return { n: window.MindRoot.store.projects().length, undo: window.MindRoot.store.historyState().undoCount, shown: window.MindRoot.welcome.isShown() }; });
  t.same(s1, { n: 1, undo: 1, shown: false }, 'a project with the map, one undo step, and the card goes');
  await W.waitToast(plain, /sample map is open/);
  t.check('a toast says so', true);
  t.eq(await plain.evaluate(function () { return document.querySelector('#stage .mv').tabIndex; }), 0, 'with nodes in it the map is a Tab stop again');
  await until(plain, function () { return !/MindRoot - MindRoot/.test(document.title) && /^\S.* - MindRoot$/.test(document.title); });
  t.check('the tab title says MindRoot once', true, await plain.title());
  await plain.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(plain, function () { return window.MindRoot.welcome.isShown(); });
  t.check('undone: the empty state comes back', true);

  t.step('a project with no maps');
  await plain.evaluate(function () {
    var S = window.MindRoot.store;
    var p = S.createProject({ name: 'Garden', maps: [{ name: 'Beds', text: '# Beds\n' }] });
    S.deleteMap(p.id, p.maps[0].id);
  });
  await until(plain, function () { var c = document.querySelector('#welcome .empty__title'); return c && c.textContent === 'Garden has no maps'; });
  t.check('names the project', true);
  var b2 = await plain.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#welcome .welcome__card button'), function (b) { return b.textContent.trim(); }); });
  t.same(b2, ['New map', 'Import', 'Open the sample'], 'a new map first');
  await plain.click('#welcome-new');
  await until(plain, function () { return !!document.querySelector('dialog.dialog[open] input'); });
  await plain.fill('dialog.dialog[open] input', 'Herbs');
  await plain.keyboard.press('Enter');
  await until(plain, function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Herbs'; });
  t.eq(await plain.evaluate(function () { return window.MindRoot.welcome.isShown(); }), false, 'a new map opens and the card goes');
  t.eq(await plain.evaluate(function () { return window.MindRoot.session.current().text; }), '# Herbs\n', 'the new map holds its title');

  t.step('the import menu offers a file or a folder');
  await plain.evaluate(function () { var S = window.MindRoot.store; var h = S.here(); S.deleteProject(h.projectId); });
  await until(plain, function () { var c = document.querySelector('#welcome .empty__title'); return c && c.textContent === 'No projects yet'; });
  await plain.click('#welcome-import');
  await until(plain, function () { return document.querySelectorAll('.menu:not([hidden]) .menu__item').length === 2; });
  var items = await plain.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__label'), function (l) { return l.textContent; }); });
  t.same(items, ['A file (ZIP, JSON, .md)', 'A .interneuron folder'], 'two ways in');
  await plain.keyboard.press('Escape');

  t.step('the language switch rewrites the card');
  await plain.evaluate(function () { window.MindRoot.i18n.setLang('it'); });
  await until(plain, function () { var c = document.querySelector('#welcome .empty__title'); return c && c.textContent === 'Ancora nessun progetto'; });
  t.check('in Italian', true);

  t.step('first run in Italian');
  var it = await (await W.context(t)).newPage();
  await t.open('welcome=1', { page: it, lang: 'it' });
  var itSeed = await it.evaluate(function () {
    var p = window.MindRoot.store.projects()[0];
    return { map: p.maps[0].name, desc: p.description, text: p.maps[0].text.split('\n')[0] };
  });
  t.same(itSeed.map, 'Benvenuto', 'the map is Benvenuto');
  t.eq(itSeed.text, '# Benvenuto in MindRoot', 'written in Italian');

  t.step('on a phone the card fits and is finger-sized');
  var phone = await (await W.context(t, 'phone')).newPage();
  await t.open('', { page: phone });
  var fit = await phone.evaluate(function () {
    var vw = innerWidth, vh = innerHeight;
    return Array.prototype.map.call(document.querySelectorAll('#welcome button'), function (b) {
      var r = b.getBoundingClientRect();
      return { inside: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh, big: r.height >= 43.5 && r.width >= 43.5 };
    });
  });
  t.check('every button on screen and at least 44px', fit.length === 3 && fit.every(function (f) { return f.inside && f.big; }), fit);
  await W.rest(phone);
  await t.shot('phone-empty', phone);
  await phone.click('#welcome-sample');
  await phone.waitForFunction(function () { var c = window.MindRoot.session.current(); return c && window.MindRoot.session.view.visiblePaths().length > 10; });
  await phone.waitForTimeout(400);
  var readable = await phone.evaluate(function () {
    var v = window.MindRoot.session.view;
    var min = 99;
    v.visiblePaths().forEach(function (p) { var t = v.nodeEl(p) && v.nodeEl(p).querySelector('.mv-title'); if (t) min = Math.min(min, parseFloat(getComputedStyle(t).fontSize)); });
    var root = v.rect(v.visiblePaths()[0]);
    return { px: min * v.camera().k, rootIn: root.left >= 0 && root.right <= innerWidth && root.top >= 0 && root.bottom <= innerHeight };
  });
  t.check('the sample opens on a phone at a size that can be read, its root in sight', readable.px >= 10 && readable.rootIn, readable);

  t.step('from the keyboard: a new project leaves the keys on its map, root chosen');
  var kb = await (await W.context(t)).newPage();
  await t.open('', { page: kb });
  await kb.focus('#welcome-new');
  await kb.keyboard.press('Enter');
  await kb.waitForSelector('dialog.dialog[open] input');
  await kb.keyboard.type('Studio');
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(function () { return document.activeElement && document.activeElement.classList.contains('mv') && window.MindRoot.session.selected() === ''; }, null, { timeout: 5000 });
  t.check('the map has the keys, the root is chosen', true);
  await kb.keyboard.press('Tab');
  await kb.keyboard.type('Child');
  await kb.keyboard.press('Enter');
  t.eq(await kb.evaluate(function () { return window.MindRoot.session.current().text; }), '# Studio\n\n## Child\n', 'Tab, a name and Enter make its first child, not a second root');

  t.step('from the keyboard: words typed on the chosen root name it, Enter on the root grows the map');
  var kb2 = await (await W.context(t)).newPage();
  await t.open('', { page: kb2 });
  await kb2.focus('#welcome-new');
  await kb2.keyboard.press('Enter');
  await kb2.waitForSelector('dialog.dialog[open] input');
  await kb2.keyboard.type('Studio');
  await kb2.keyboard.press('Enter');
  await kb2.waitForFunction(function () { return document.activeElement && document.activeElement.classList.contains('mv') && window.MindRoot.session.selected() === ''; }, null, { timeout: 5000 });
  await kb2.keyboard.type('Root');
  await kb2.keyboard.press('Enter');
  await kb2.keyboard.press('Tab');
  await kb2.keyboard.type('Child');
  await kb2.keyboard.press('Enter');
  t.eq(await kb2.evaluate(function () { return window.MindRoot.session.current().text; }), '# Root\n\n## Child\n', 'the typed name replaces the root\'s, nothing is lost and no second root appears');
  await kb2.evaluate(function () { window.MindRoot.session.select(''); });
  await kb2.keyboard.press('Enter');
  await kb2.keyboard.type('Other');
  await kb2.keyboard.press('Enter');
  t.eq(await kb2.evaluate(function () { return window.MindRoot.session.current().text; }), '# Root\n\n## Child\n\n## Other\n', 'Enter on the one root adds a child, joined to the map');
  t.check('one tree on screen', await kb2.evaluate(function () { var g = window.MindRoot.session.view.geometry(); return g.nodes['1'] && g.nodes['1'].parent === ''; }));

  t.step('the sample in the dark: highlighted words and the open map\'s count read at 4.5:1');
  var dk = await (await t.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })).newPage();
  await t.open('', { page: dk });
  await dk.click('#welcome-sample');
  await dk.waitForFunction(function () { return !!document.querySelector('.mv-node mark') && !!document.querySelector('.sb-item--map.is-current .sb-count'); });
  var ratios = await dk.evaluate(function () {
    function rgb(s) { return s.match(/[\d.]+/g).map(Number); }
    function lum(c) { var a = c.slice(0, 3).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
    function ground(el) {
      var layers = [];
      for (var n = el; n; n = n.parentElement) { var c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || c[3] > 0) layers.unshift(c); if (c.length === 3 || c[3] === 1) break; }
      var out = [255, 255, 255];
      layers.forEach(function (c) { var a = c.length === 4 ? c[3] : 1; out = [0, 1, 2].map(function (i) { return c[i] * a + out[i] * (1 - a); }); });
      return out;
    }
    function ratio(el) { var l1 = lum(rgb(getComputedStyle(el).color)); var l2 = lum(ground(el)); return Math.round((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) * 100) / 100; }
    return { mark: ratio(document.querySelector('.mv-node mark')), count: ratio(document.querySelector('.sb-item--map.is-current .sb-count')) };
  });
  t.check('both at least 4.5:1', ratios.mark >= 4.5 && ratios.count >= 4.5, ratios);

  t.step('house style of the strings');
  var copy = await W.copyCheck(page, ['welcome']);
  t.check('strings registered', copy.count > 40, copy.count);
  t.same([copy.onlyEn, copy.onlyIt, copy.bang, copy.dash, copy.emoji], [[], [], [], [], []], 'both languages, no exclamation marks, em-dashes or emoji');
};
