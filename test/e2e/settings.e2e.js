/* settings: one sheet (Ctrl+,) whose every control applies at once. The
 * theme changes without a reload, the language rewrites the sheet and the
 * rest of the chrome in place (the focus stays on the control), switches
 * and segmented controls write their preferences, the clock's interval is
 * clamped to 1..999. Storage says what is used and whether the browser
 * promised to keep it, and on file:// says why it cannot be asked. Backup
 * downloads every project as one ZIP and remembers when; restoring that ZIP
 * brings the projects back beside the ones there (never over them). After
 * a week without a backup a banner offers one; "Later" waits a week. Over
 * http the persist button is offered. On a phone it is a bottom sheet. */
'use strict';

var fs = require('fs');
var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var DAY = 86400000;

function seg(page, id) {
  return page.evaluate(function (i) {
    var g = document.getElementById(i);
    return Array.prototype.filter.call(g.querySelectorAll('.seg__opt'), function (b) { return b.getAttribute('aria-checked') === 'true'; }).map(function (b) { return b.getAttribute('data-value'); })[0];
  }, id);
}

module.exports = async function (t) {
  var b = await W.boot(t, [{ name: 'Garden', maps: [['Beds', '# Beds\n\n- North\n']] }, { name: 'Kitchen', maps: [['Recipes', '# Recipes\n\n- Soup\n']] }]);
  var page = b.page;

  t.step('Ctrl+, opens the sheet');
  await page.focus('#stage .mv');
  await page.keyboard.press('Control+Comma');
  await until(page, function () { return !!document.querySelector('.ws-settings'); });
  var head = await page.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return {
      title: s.querySelector('.sheet__title').textContent,
      sections: Array.prototype.map.call(s.querySelectorAll('.ws-section__title'), function (h) { return h.textContent; }),
      focus: document.activeElement && document.activeElement.getAttribute('data-value')
    };
  });
  t.eq(head.title, 'Settings', 'titled');
  t.same(head.sections, ['Appearance', 'Map', 'Notebooks', 'AI assistance', 'Copies on the clock', 'Storage and backup', 'About'], 'its sections');
  t.eq(head.focus, 'system', 'the focus starts on the theme in use');
  t.eq(await seg(page, 'set-theme'), 'system', 'the theme follows the system');

  t.step('the theme, at once');
  await page.click('#set-theme .seg__opt[data-value="dark"]');
  await until(page, function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  await until(page, function () { return getComputedStyle(document.body).backgroundColor === 'rgb(19, 21, 25)'; }, null, 3000);
  t.check('dark without a reload', true);
  t.eq(await page.evaluate(function () { try { return localStorage.getItem('mindroot2:theme'); } catch (e) { return null; } }), 'dark', 'kept for the next first paint');
  await page.keyboard.press('ArrowLeft');
  await until(page, function () { return document.documentElement.getAttribute('data-theme') === 'light'; });
  t.eq(await page.evaluate(function () { return document.activeElement.getAttribute('data-value'); }), 'light', 'arrows move along the choices');
  await page.click('#set-theme .seg__opt[data-value="system"]');
  await until(page, function () { return !document.documentElement.hasAttribute('data-theme'); });
  t.check('back to the system', true);

  t.step('switches and choices write their preferences');
  var before = await page.evaluate(function () { var P = window.MindRoot.prefs; return [P.get('reduceTransparency'), P.get('liquidGlass'), P.get('diceColors'), P.get('branchText'), P.get('syncSelection')]; });
  t.same(before, [false, true, false, true, true], 'the defaults');
  for (var id of ['set-transparency', 'set-glass', 'set-dice', 'set-branch', 'set-sync']) await page.click('#' + id);
  var after = await page.evaluate(function () {
    var P = window.MindRoot.prefs;
    return { prefs: [P.get('reduceTransparency'), P.get('liquidGlass'), P.get('diceColors'), P.get('branchText'), P.get('syncSelection')], attr: document.documentElement.getAttribute('data-transparency'), aria: document.getElementById('set-dice').getAttribute('aria-checked') };
  });
  t.same(after.prefs, [true, false, true, false, false], 'each switch flips its preference');
  t.eq(after.attr, 'reduce', 'reduce transparency applies at once');
  t.eq(after.aria, 'true', 'a switch says its state');
  await page.focus('#set-transparency');
  await page.keyboard.press('Space');
  await until(page, function () { return !window.MindRoot.prefs.get('reduceTransparency'); });
  t.check('a switch works from the keyboard', true);
  var noDirection = await page.evaluate(function () {
    return {
      control: !!document.getElementById('set-direction'),
      words: /grow|both sides/i.test(document.querySelector('dialog.sheet[open]').textContent),
      pref: window.MindRoot.prefs.get('direction'),
      command: window.MindRoot.commands.has('map.direction')
    };
  });
  t.same(noDirection, { control: false, words: false, pref: undefined, command: false }, 'no setting for the side branches grow on: it is chosen on the map, branch by branch');
  await page.fill('#set-every', '2000');
  await page.selectOption('#set-unit', 'm');
  await until(page, function () { var c = window.MindRoot.prefs.get('copies'); return c.every === 999 && c.unit === 'm'; });
  t.eq(await page.inputValue('#set-every'), '999', 'the interval is clamped to 999');
  await page.evaluate(function () { window.MindRoot.prefs.set('diceColors', false); });
  await until(page, function () { return document.getElementById('set-dice').getAttribute('aria-checked') === 'false'; });
  t.check('a change made elsewhere shows in the sheet', true);

  t.step('the language rewrites everything in place');
  await page.click('#set-lang .seg__opt[data-value="it"]');
  await until(page, function () { return document.querySelector('dialog.sheet[open] .sheet__title').textContent === 'Impostazioni'; });
  var it = await page.evaluate(function () {
    return {
      lang: document.documentElement.lang,
      sections: Array.prototype.map.call(document.querySelectorAll('.ws-section__title'), function (h) { return h.textContent; }),
      sidebar: document.getElementById('sb-title').textContent,
      focus: document.activeElement && document.activeElement.getAttribute('data-value'),
      pref: window.MindRoot.prefs.get('lang')
    };
  });
  t.eq(it.lang, 'it', 'the page speaks Italian');
  t.same(it.sections, ['Aspetto', 'Mappa', 'Quaderni', 'Assistente AI', 'Copie a tempo', 'Spazio e backup', 'Informazioni'], 'the sheet is rebuilt in it');
  t.eq(it.sidebar, 'Progetti', 'and so is the sidebar');
  t.eq(it.focus, 'it', 'the focus stays on the language');
  t.eq(it.pref, 'it', 'remembered');
  await page.fill('#set-every', '1');
  await page.dispatchEvent('#set-every', 'input');
  t.eq(await page.evaluate(function () { var u = document.getElementById('set-unit'); return Array.prototype.map.call(u.options, function (o) { return o.textContent; }).join('/'); }), 'minuto/ora', 'one: the units in the singular, agreeing with the number');
  await page.fill('#set-every', '3');
  await page.dispatchEvent('#set-every', 'input');
  t.eq(await page.evaluate(function () { var u = document.getElementById('set-unit'); return Array.prototype.map.call(u.options, function (o) { return o.textContent; }).join('/'); }), 'minuti/ore', 'three: the units in the plural');
  await page.click('#set-lang .seg__opt[data-value="en"]');
  await until(page, function () { return document.querySelector('dialog.sheet[open] .sheet__title').textContent === 'Settings'; });

  t.step('storage on file://');
  await until(page, function () { return /used/.test(document.querySelector('.ws-usage').textContent); });
  var st = await page.evaluate(function () {
    return {
      usage: document.querySelector('.ws-usage').textContent,
      badge: document.querySelector('.ws-badge').textContent,
      text: document.querySelector('.ws-storage .ws-set__hint').textContent,
      persistShown: !document.getElementById('set-persist').hidden,
      about: document.querySelector('.ws-about').textContent,
      last: document.querySelector('.ws-last-backup').textContent
    };
  });
  t.check('what is used, of what', /^[\d.,]+ (B|KB|MB|GB) used/.test(st.usage), st.usage);
  t.check('whether it is kept for good', /Kept for good|May be cleared by the browser/.test(st.badge), st.badge);
  t.check('on file:// it says the browser decides by itself', /Opened from a file, the browser decides by itself/.test(st.text) || /promised/.test(st.text), st.text);
  t.eq(st.persistShown, false, 'and offers no button that cannot work');
  t.check('about: version, offline, where the maps live', /MindRoot 2\.0\.0/.test(st.about) && /Works offline/.test(st.about) && /Opened from a file: your maps live in this browser/.test(st.about), st.about);
  t.eq(st.last, 'No backup yet.', 'no backup yet');

  t.step('backup everything');
  var dl = page.waitForEvent('download');
  await page.click('#set-backup');
  var zip = await dl;
  t.check('one ZIP of the whole workspace', /^mindroot-.*\.zip$/.test(zip.suggestedFilename()), zip.suggestedFilename());
  await W.waitToast(page, /^Backup saved: mindroot-/);
  await until(page, function () { return document.querySelector('.ws-last-backup').textContent === 'Last backup just now.'; });
  t.check('the date of the last backup is kept and shown', await page.evaluate(function () { return Date.now() - window.MindRoot.prefs.get('backup').last < 60000; }));
  var entries = await page.evaluate(async function (b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var list = await window.MindRoot.zip.read(new Blob([bytes]));
    return list.map(function (e) { return e.name; }).sort();
  }, fs.readFileSync(await zip.path()).toString('base64'));
  t.check('every project as its .interneuron folder, with plain .md maps', entries.indexOf('garden.interneuron/beds.md') >= 0 && entries.indexOf('kitchen.interneuron/recipes.md') >= 0, entries);

  t.step('restore never overwrites');
  var ids = await page.evaluate(function () { return window.MindRoot.store.projects().map(function (p) { return p.id; }); });
  var chooser = page.waitForEvent('filechooser');
  await page.click('#set-restore');
  await (await chooser).setFiles({ name: zip.suggestedFilename(), mimeType: 'application/zip', buffer: fs.readFileSync(await zip.path()) });
  await until(page, function () { return window.MindRoot.store.projects().length === 4; });
  var restored = await page.evaluate(function (old) {
    var ps = window.MindRoot.store.projects();
    return { names: ps.map(function (p) { return p.name; }), kept: old.every(function (id) { return !!window.MindRoot.store.project(id); }) };
  }, ids);
  t.same(restored.names, ['Garden', 'Kitchen', 'Garden (2)', 'Kitchen (2)'], 'the backup comes in beside, told apart by a number');
  t.eq(restored.kept, true, 'what was there is untouched');
  await W.waitToast(page, /2 projects imported/);
  await page.keyboard.press('Escape');
  await until(page, function () { return !window.MindRoot.settings.isOpen(); });

  t.step('a week without a backup: a quiet banner');
  var remind = await page.evaluate(function (day) {
    var ns = window.MindRoot;
    ns.prefs.set('backup', { last: Date.now() - 9 * day, since: Date.now() - 30 * day, snooze: 0 });
    return ns.settings.checkReminder();
  }, DAY);
  t.eq(remind, true, 'reminded');
  var banner = await page.evaluate(function () {
    var b = document.querySelector('.banner[data-banner="backup-reminder"]:not([hidden])');
    return b && { text: b.querySelector('.banner__text').textContent, actions: Array.prototype.map.call(b.querySelectorAll('.btn'), function (x) { return x.textContent.trim(); }) };
  });
  t.check('it says when the last one was', /^Your last backup was /.test(banner.text), banner);
  t.same(banner.actions, ['Back up everything', 'Later'], 'and offers one, or later');
  await page.click('.banner[data-banner="backup-reminder"] .btn:has-text("Later")');
  await until(page, function () { return !document.querySelector('.banner[data-banner="backup-reminder"]:not([hidden])'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.settings.checkReminder(); }), false, 'Later waits a week');
  var never = await page.evaluate(function (day) {
    var ns = window.MindRoot;
    ns.prefs.set('backup', { last: 0, since: Date.now() - 8 * day, snooze: 0 });
    ns.settings.checkReminder();
    var b = document.querySelector('.banner[data-banner="backup-reminder"]:not([hidden]) .banner__text');
    var text = b && b.textContent;
    ns.ui.clearBanner('backup-reminder');
    ns.prefs.set('backup', { last: 0, since: Date.now() - 2 * day, snooze: 0 });
    return { text: text, fresh: ns.settings.checkReminder() };
  }, DAY);
  t.check('never backed up: it says so', /^You have not backed up/.test(never.text), never);
  t.eq(never.fresh, false, 'but not in the first week');

  t.step('over http the browser can be asked');
  var base = await t.serve();
  var served = await (await W.context(t)).newPage();
  await t.open('', { page: served, base: base });
  await served.evaluate(function () { window.MindRoot.commands.run('settings.open'); });
  await until(served, function () { return /used/.test((document.querySelector('.ws-usage') || {}).textContent || ''); });
  var http = await served.evaluate(function () {
    return { about: document.querySelector('.ws-about').textContent, persisted: document.querySelector('.ws-badge').getAttribute('data-state'), button: !document.getElementById('set-persist').hidden };
  });
  t.check('it says where the maps live', /Opened from a web address/.test(http.about), http.about);
  t.eq(http.button, http.persisted !== 'ok', 'the persist button is there unless already kept for good');
  if (http.button) {
    await served.click('#set-persist');
    await W.waitToast(served, /The browser (will keep your maps|did not promise)/);
    t.check('pressing it says honestly what the browser answered', true);
  }

  t.step('on a phone');
  var ph = await (await W.context(t, 'phone')).newPage();
  await t.open('', { page: ph });
  await ph.evaluate(function () { window.MindRoot.commands.run('settings.open'); });
  await until(ph, function () { return !!document.querySelector('.ws-settings'); });
  var phone = await ph.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    var small = [];
    Array.prototype.forEach.call(s.querySelectorAll('.seg__opt, .btn, input, select'), function (el) {
      if (el.offsetParent === null) return;
      var r = el.getBoundingClientRect();
      if (r.height < 39.5) small.push((el.id || el.getAttribute('data-value') || el.className) + ' ' + Math.round(r.height));
    });
    var rows = Array.prototype.map.call(s.querySelectorAll('.ws-set'), function (r) { return Math.round(r.getBoundingClientRect().height); });
    return { place: s.getAttribute('data-place'), small: small, minRow: Math.min.apply(null, rows), scrollW: document.scrollingElement.scrollWidth <= innerWidth };
  });
  t.eq(phone.place, 'bottom', 'a bottom sheet');
  t.same(phone.small, [], 'controls finger-sized');
  t.check('rows finger-tall', phone.minRow >= 44, phone.minRow);
  t.eq(phone.scrollW, true, 'no sideways scroll');
  await W.rest(ph);
  await t.shot('phone', ph);

  t.step('house style of the strings');
  var copy = await W.copyCheck(page, ['settings', 'help']);
  t.check('strings registered', copy.count > 90, copy.count);
  t.same([copy.onlyEn, copy.onlyIt, copy.bang, copy.dash, copy.emoji], [[], [], [], [], []], 'both languages, no exclamation marks, em-dashes or emoji');

  t.step('forced colours: every switch and the chosen segment can still be seen');
  var fc = await (await t.newContext({ forcedColors: 'active' })).newPage();
  await t.open('', { page: fc });
  await fc.evaluate(function () { window.MindRoot.commands.run('settings.open'); });
  await fc.waitForSelector('dialog.sheet[open] .switch');
  var seen = await fc.evaluate(function () {
    var sw = getComputedStyle(document.querySelector('.switch'));
    var thumb = getComputedStyle(document.querySelector('.switch'), '::before');
    var on = document.querySelector('.seg__opt[aria-checked="true"]');
    var off = document.querySelector('.seg__opt[aria-checked="false"]');
    return { border: sw.borderTopStyle !== 'none', thumb: thumb.backgroundColor !== sw.backgroundColor, chosen: getComputedStyle(on).backgroundColor !== getComputedStyle(off).backgroundColor };
  });
  t.same(seen, { border: true, thumb: true, chosen: true }, 'a track with a border, a thumb unlike its track, the chosen option filled');
};
