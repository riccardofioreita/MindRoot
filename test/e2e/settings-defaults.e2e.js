/* settings-defaults: the switches a person finds on a fresh profile, and on
 * a profile written by an older version that never had (or never touched)
 * them. Pinned here because people quote them: "Text in the branch colour -
 * Node words take the colour of their branch; exports follow." (in both
 * languages) is ON by default, the map shows it, the
 * Settings switch says so, and an export follows it. Also "MindRoot
 * pointer", on by default. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

async function state(page) {
  return page.evaluate(function () {
    var ns = window.MindRoot;
    var mv = document.querySelector('#stage .mv');
    return {
      branchText: ns.prefs.get('branchText'),
      appCursor: ns.prefs.get('appCursor'),
      tinted: !!(mv && mv.classList.contains('mv--branch-text')),
      option: ns.session.view.options().branchText
    };
  });
}

async function switches(page) {
  await page.focus('#stage .mv');
  await page.keyboard.press('Control+Comma');
  await until(page, function () { return !!document.getElementById('set-branch'); });
  var out = await page.evaluate(function () {
    function row(id) { return { on: document.getElementById(id).getAttribute('aria-checked'), label: document.getElementById(id + '-label').textContent, hint: (document.getElementById(id + '-hint') || {}).textContent }; }
    return { branch: row('set-branch'), cursor: row('set-cursor') };
  });
  await page.keyboard.press('Escape');
  await until(page, function () { return !document.getElementById('set-branch'); });
  return out;
}

/* The fills of the words in an SVG export of the open map. */
function textFills(page) {
  return page.evaluate(async function () {
    var blob = await window.MindRoot.exporter.svg({});
    var text = await blob.text();
    var seen = {};
    text.replace(/<text\b[^>]*\sfill="([^"]+)"/g, function (w, f) { seen[f] = true; return w; });
    return Object.keys(seen).sort();
  });
}

var MAP = [{ name: 'Garden', maps: [['Beds', '# Beds\n\n- North\n  - Leeks\n- South\n']] }];

module.exports = async function (t) {
  t.step('a fresh profile, in Italian');
  var b = await W.boot(t, MAP, { lang: 'it' });
  var page = b.page;
  t.eq(await page.evaluate(function () { try { return localStorage.getItem('mindroot2:prefs'); } catch (e) { return 'blocked'; } }), null, 'nothing stored yet: these are the defaults');
  t.same(await state(page), { branchText: true, appCursor: true, tinted: true, option: true }, 'branch text on: the map is drawn with it');
  var sw = await switches(page);
  t.same(sw.branch, {
    on: 'true',
    label: 'Testo del colore del ramo',
    hint: 'Le parole dei nodi prendono il colore del loro ramo; le esportazioni lo seguono.'
  }, 'the switch quoted by the person: on, with its words');
  t.eq(sw.cursor.on, 'true', 'Puntatore MindRoot: on');
  t.eq(sw.cursor.label, 'Puntatore MindRoot', 'its label');
  var fillsOn = await textFills(page);
  t.check('an SVG export tints the words by branch', fillsOn.length > 1, fillsOn);

  t.step('a profile from before these settings existed');
  var ctx = await W.context(t);
  await ctx.addInitScript(function () {
    try {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('mindroot2:prefs', JSON.stringify({ v: 1, prefs: { theme: 'dark', diceColors: true, sidebarOpen: true } }));
      }
    } catch (e) { /* storage blocked: the defaults below are the same */ }
  });
  var old = await ctx.newPage();
  await W.boot(t, MAP, { page: old });
  t.same(await state(old), { branchText: true, appCursor: true, tinted: true, option: true }, 'never set: on');
  t.eq(await old.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); }), true, 'what was set is kept');
  var sw2 = await switches(old);
  t.same([sw2.branch.on, sw2.cursor.on], ['true', 'true'], 'and both switches say on');

  t.step('a damaged value falls back to on');
  var ctx3 = await W.context(t);
  await ctx3.addInitScript(function () {
    try {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('mindroot2:prefs', JSON.stringify({ v: 1, prefs: { branchText: 'yes', appCursor: 0 } }));
      }
    } catch (e) { /* as above */ }
  });
  var bad = await ctx3.newPage();
  await W.boot(t, MAP, { page: bad });
  t.same(await state(bad), { branchText: true, appCursor: true, tinted: true, option: true }, 'not a boolean: the default');

  t.step('turned off, it stays off');
  await page.evaluate(function () { window.MindRoot.prefs.set('branchText', false); return window.MindRoot.prefs.flush(); });
  await until(page, function () { return !document.querySelector('#stage .mv').classList.contains('mv--branch-text'); });
  var fillsOff = await textFills(page);
  t.eq(fillsOff.length, 1, 'off: the export draws every word in one ink (' + fillsOff.join(' ') + ')');
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; });
  var after = await state(page);
  t.same([after.branchText, after.tinted], [false, false], 'off after a reload');
  var sw3 = await switches(page);
  t.eq(sw3.branch.on, 'false', 'and the switch says off');
};
