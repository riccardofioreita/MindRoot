/* workspace: the module as a whole. Every command it owns is registered
 * under its contract id, in a known group, with an icon the sprite has, a
 * label in both languages and the keys the contract gives it (Ctrl+K works
 * from a text field). Its sources keep the house rules: a header comment,
 * strict IIFEs on window.MindRoot, no alert/confirm/prompt, no network,
 * no innerHTML, every localStorage access guarded; its CSS spends only
 * tokens and leaves motion to motion.css. The app with the sample, light
 * and dark, desktop and phone, as screenshots. */
'use strict';

var fs = require('fs');
var path = require('path');
var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var ROOT = W.H.ROOT;
var FILES = ['sidebar', 'trash', 'copies', 'palette', 'settings', 'help', 'welcome'].map(function (n) { return 'js/features/' + n + '.js'; });

var COMMANDS = {
  'palette.open': ['Mod+K'], 'search.nodes': ['Mod+F'], 'sidebar.newProject': [], 'sidebar.newMap': ['Mod+Alt+N'],
  'project.rename': [], 'project.duplicate': [], 'project.delete': [], 'project.export': [],
  'map.rename': [], 'map.duplicate': [], 'map.delete': [], 'map.importBranches': [],
  'file.import': ['Mod+O'], 'file.backup': [], 'file.restore': [],
  'trash.open': [], 'copies.open': [], 'copies.take': [], 'settings.open': ['Mod+,'], 'help.open': ['F1', '?']
};

module.exports = async function (t) {
  t.step('the sources keep the house rules');
  FILES.forEach(function (rel) {
    var src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    var lines = src.split('\n');
    t.check(rel + ': a header comment', /^\/\* MindRoot - /.test(src));
    t.check(rel + ': an IIFE on window.MindRoot, strict', /window\.MindRoot = window\.MindRoot \|\| \{\};\n\(function \(ns\) \{\n  'use strict';/.test(src) && /\}\)\(window\.MindRoot\);\s*$/.test(src));
    t.check(rel + ': no alert, confirm or prompt of the browser', !/(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(code) && !/window\.(alert|confirm|prompt)/.test(code));
    t.check(rel + ': no network', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(code));
    t.check(rel + ': no innerHTML', !/innerHTML|outerHTML|insertAdjacentHTML|\bhtml:\s/.test(code));
    var unguarded = [];
    lines.forEach(function (l, i) {
      if (!/localStorage/.test(l) || /^\s*(\*|\/\*)/.test(l)) return;
      var near = lines.slice(Math.max(0, i - 1), i + 1).join('\n');
      if (!/try\s*\{/.test(near)) unguarded.push(i + 1);
    });
    t.same(unguarded, [], rel + ': every localStorage access inside try');
  });
  var css = fs.readFileSync(path.join(ROOT, 'css/workspace.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  var decls = css.replace(/[^{}]*\{/g, '{');
  t.check('workspace.css: colours only from tokens', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(decls), (decls.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).slice(0, 5));
  t.check('workspace.css: no transitions or animations (motion.css owns them)', !/(^|[\s;{])(transition|animation)\s*:/.test(css));
  t.check('workspace.css: z-index only from the scale', (css.match(/z-index:\s*[^;]+/g) || []).every(function (z) { return /var\(--z-[a-z-]+\)|z-index:\s*1$/.test(z.trim()); }), css.match(/z-index:\s*[^;]+/g));

  t.step('the commands');
  var b = await W.boot(t, [{ name: 'Garden', maps: [['Beds', '# Beds\n\n- North\n']] }]);
  var page = b.page;
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var cmds = await page.evaluate(function (ids) {
    var C = window.MindRoot.commands;
    var I = window.MindRoot.i18n;
    var out = {};
    ids.forEach(function (id) {
      var c = C.get(id);
      if (!c) { out[id] = null; return; }
      var en = C.label(id);
      I.init('it');
      var it = C.label(id);
      I.init('en');
      out[id] = { group: c.group, icon: c.icon, keys: c.keys, en: en, it: it, label: c.label, known: C.GROUPS.indexOf(c.group) >= 0, help: c.help && I.has(c.help) };
    });
    return out;
  }, Object.keys(COMMANDS));
  Object.keys(COMMANDS).forEach(function (id) {
    var c = cmds[id];
    if (!t.check(id + ' registered', !!c)) return;
    t.check(id + ': a known group', c.known, c.group);
    t.check(id + ': an icon from the sprite', html.indexOf('id="i-' + c.icon + '"') >= 0, c.icon);
    t.check(id + ': labelled in both languages', c.en && c.it && c.en !== c.label && c.it !== c.label, c);
    t.check(id + ': with help', !!c.help);
    t.same(c.keys, COMMANDS[id], id + ': its keys');
  });

  t.step('keys');
  await page.focus('#stage .mv');
  await page.keyboard.press('Control+Alt+n');
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] input'); });
  t.eq(await page.textContent('dialog.dialog[open] .dialog__title'), 'New map', 'Ctrl+Alt+N: a new map');
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('dialog.dialog[open]'); });
  var chooser = page.waitForEvent('filechooser', { timeout: 4000 }).catch(function () { return null; });
  await page.focus('#stage .mv');
  await page.keyboard.press('Control+o');
  t.check('Ctrl+O: import a file', !!(await chooser));
  await page.evaluate(function () { var i = document.createElement('input'); i.id = 'probe'; document.getElementById('floaters').appendChild(i); });
  await page.focus('#probe');
  await page.keyboard.press('Control+k');
  await until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  t.check('Ctrl+K works from a text field', true);
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.querySelector('dialog.palette'); });
  t.eq(await page.evaluate(function () { return document.activeElement.id; }), 'probe', 'and gives the focus back to it');
  var handled = await page.evaluate(function () {
    var e = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true });
    document.getElementById('probe').dispatchEvent(e);
    return { prevented: e.defaultPrevented, palette: !!document.querySelector('dialog.palette') };
  });
  t.same(handled, { prevented: false, palette: false }, 'Ctrl+F leaves a text field to the browser');

  t.step('view-only: the workspace steps aside');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(true); });
  var vo = await page.evaluate(function () {
    var C = window.MindRoot.commands;
    return ['palette.open', 'trash.open', 'copies.open', 'settings.open', 'sidebar.newMap', 'map.delete'].map(function (id) { return id + ':' + C.enabled(id); });
  });
  t.same(vo, ['palette.open:false', 'trash.open:false', 'copies.open:false', 'settings.open:false', 'sidebar.newMap:false', 'map.delete:false'], 'nothing that opens a panel or writes');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(false); });

  t.step('the app with the sample, as screenshots');
  for (var kind of ['desktop', 'phone']) {
    var p = await (await W.context(t, kind)).newPage();
    await t.open('welcome=1', { page: p });
    await W.settled(p);
    if (kind === 'phone') {
      await p.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
      await until(p, function () { return window.MindRoot.shell.sidebar.isOpen(); });
    }
    await W.rest(p);
    await t.shot(kind + '-light', p);
    await p.evaluate(function () { window.MindRoot.prefs.set('theme', 'dark'); });
    await until(p, function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
    await W.rest(p);
    await t.shot(kind + '-dark', p);
    var overflow = await p.evaluate(function () { return document.scrollingElement.scrollWidth <= innerWidth; });
    t.eq(overflow, true, kind + ': no sideways scroll');
  }
};
