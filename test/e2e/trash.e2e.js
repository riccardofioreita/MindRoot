/* trash: the trash sheet of a project. One row per thing thrown away -
 * branches, a file, a map, a copy - each saying what it was, where from
 * and when, with a preview that opens wide. Search ignores accents and
 * needs every word. Choosing: boxes, Shift for a range, Ctrl+A, one box for
 * all (showing "some"), a bulk bar that is always there. Put back, one or
 * many, is one step; the toast says how it went, and the node that came
 * back is chosen on its map, where it was. Delete for good waits for a
 * second press within three seconds; emptying asks first; both undo while
 * the page is open. Escape clears the search, then the choice, then closes.
 * On a phone it is a bottom sheet with finger-sized controls. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var BEDS = '# Beds\n\n- North\n  - Lettuce\n  - Carrots\n- South\n  - Tomatoes\n  - Peppers\n- West\n';

function rows(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.ws-trash .ws-row'), function (r) {
      return { kind: r.getAttribute('data-kind'), name: r.querySelector('.ws-row__name').textContent, meta: r.querySelector('.ws-row__meta').textContent, chosen: r.classList.contains('is-chosen'), preview: r.querySelector('.ws-preview') ? r.querySelector('.ws-preview').textContent : null };
    });
  });
}

function bulk(page) {
  return page.evaluate(function () {
    var all = document.querySelector('.ws-trash .ws-all');
    return {
      label: document.querySelector('.ws-bulk__all span').textContent,
      checked: all.checked, mixed: all.indeterminate,
      restore: document.querySelector('.ws-bulk__restore .btn__label').textContent,
      restoreOff: document.querySelector('.ws-bulk__restore').getAttribute('aria-disabled') === 'true'
    };
  });
}

module.exports = async function (t) {
  var b = await W.boot(t, [{ name: 'Garden', maps: [['Beds', BEDS], ['Tools', '# Tools\n\n- Spade\n  - Steel\n']] }]);
  var page = b.page;
  var pid = b.projects[0].id;
  var beds = b.projects[0].maps[0];

  t.step('things thrown away');
  await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    ns.session.select('0.0');
    ns.commands.run('node.delete');
    ns.session.select('1');
    ns.commands.run('node.delete');
    ns.store.setFile(ids.pid, 'assets/pic.png', { asset: 'nobytes', type: 'image/png', size: 3 });
    ns.store.trashFiles(ids.pid, ['assets/pic.png'], {});
    var copy = ns.store.takeSnapshot(ids.pid, ids.beds, { kind: 'manual', label: 'before' });
    ns.store.deleteSnapshot(ids.pid, copy.id);
    var tools = ns.store.project(ids.pid).maps[1];
    ns.store.deleteMap(ids.pid, tools.id);
  }, { pid: pid, beds: beds });
  await until(page, function (p) { return window.MindRoot.store.project(p).trash.length === 5; }, pid);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.current().text; }), '# Beds\n\n- North\n  - Carrots\n- West\n', 'the map lost its branches');

  t.step('the sheet');
  await page.evaluate(function () { window.MindRoot.commands.run('trash.open'); });
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 5; });
  var head = await page.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return { title: s.querySelector('.sheet__title').textContent, place: s.getAttribute('data-place'), focus: document.activeElement.classList.contains('ws-search'), total: document.querySelector('.ws-trash .ws-hint').textContent };
  });
  t.eq(head.title, 'Trash of Garden', 'titled with its project');
  t.eq(head.place, 'side', 'a side sheet on a desktop');
  t.eq(head.focus, true, 'the search has the focus');
  t.check('says how many, and that nothing is gone yet', /^5 items\. Nothing here is gone/.test(head.total), head.total);
  var r = await rows(page);
  t.same(r.map(function (x) { return x.kind + ':' + x.name; }), ['map:Tools', 'snapshot:Beds - copy', 'asset:pic.png', 'branch:South', 'branch:Lettuce'], 'newest first, one row per thing');
  t.check('a branch says where from', /^Branch from Beds, /.test(r[3].meta), r[3].meta);
  t.check('a map counts its copies', /^Map with no copies/.test(r[0].meta), r[0].meta);
  t.check('a copy says of what and when it was taken', /^Copy of Beds from /.test(r[1].meta), r[1].meta);
  t.check('a file says its path', /^File assets\/pic\.png/.test(r[2].meta), r[2].meta);
  t.eq(r[3].preview, 'Tomatoes · Peppers', 'the preview: the words under it, without Markdown');
  t.eq(r[0].preview, 'Spade · Steel', 'a map previews its words too');
  await page.click('.ws-trash .ws-row[data-kind="branch"] .ws-preview');
  t.eq(await page.evaluate(function () { return document.querySelector('.ws-trash .ws-row[data-kind="branch"] .ws-preview').getAttribute('aria-expanded'); }), 'true', 'a press opens the preview wide');

  t.step('search: accents ignored, every word');
  await page.fill('.ws-trash .ws-search', 'tomàtoes');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 1; });
  t.eq((await rows(page))[0].name, 'South', 'found by a word under it, accent or not');
  await page.fill('.ws-trash .ws-search', 'beds lettuce');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 1; });
  t.eq((await rows(page))[0].name, 'Lettuce', 'every word must match');
  await page.fill('.ws-trash .ws-search', 'zucchini');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 0; });
  t.eq(await page.textContent('.ws-trash .ws-note'), 'Nothing in the trash matches "zucchini".', 'says so when nothing matches');
  await page.fill('.ws-trash .ws-search', '');

  t.step('choosing');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 5; });
  t.same(await bulk(page), { label: 'Choose all', checked: false, mixed: false, restore: 'Put back', restoreOff: true }, 'nothing chosen: the bar is there, its actions off');
  await page.click('.ws-trash .ws-row:nth-child(1) .ws-row__check');
  await page.click('.ws-trash .ws-row:nth-child(3) .ws-row__check', { modifiers: ['Shift'] });
  t.same((await rows(page)).map(function (x) { return x.chosen; }), [true, true, true, false, false], 'Shift chooses the range');
  t.same(await bulk(page), { label: '3 chosen', checked: false, mixed: true, restore: 'Put back (3)', restoreOff: false }, 'the box for all shows "some"');
  await page.click('.ws-trash .ws-row:nth-child(5) .ws-row__name');
  t.eq((await rows(page))[4].chosen, true, 'a press on the name chooses too');
  await page.focus('.ws-trash .ws-row:nth-child(2) .ws-row__check');
  await page.keyboard.press('Control+a');
  t.same(await bulk(page), { label: '5 chosen', checked: true, mixed: false, restore: 'Put back (5)', restoreOff: false }, 'Ctrl+A chooses every row');
  await page.fill('.ws-trash .ws-search', 'south');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 1; });
  t.eq((await bulk(page)).label, '1 chosen', 'the choice keeps only what can be seen');

  t.step('Escape: the search, the choice, then the sheet');
  await page.focus('.ws-trash .ws-search');
  await page.keyboard.press('Escape');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 5; });
  t.eq(await page.inputValue('.ws-trash .ws-search'), '', 'first the search');
  t.eq((await bulk(page)).label, '1 chosen', 'the choice is still there');
  await page.keyboard.press('Escape');
  t.eq((await bulk(page)).label, 'Choose all', 'then the choice');
  t.eq(await page.evaluate(function () { return window.MindRoot.trash.isOpen(); }), true, 'the sheet still open');
  await page.keyboard.press('Escape');
  await until(page, function () { return !window.MindRoot.trash.isOpen(); });
  t.check('then the sheet', true);

  t.step('put back one: in its place, chosen on the map');
  await page.evaluate(function () { window.MindRoot.trash.open(); });
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 5; });
  t.eq(await page.getAttribute('.ws-trash .ws-row:nth-child(5) .ws-row__restore', 'aria-label'), 'Put back Lettuce', 'each row\'s buttons name their row');
  await page.click('.ws-trash .ws-row:nth-child(5) .ws-row__restore');
  await until(page, function () { return /Lettuce/.test(window.MindRoot.session.current().text); });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.current().text; }), '# Beds\n\n- North\n  - Lettuce\n  - Carrots\n- West\n', 'back where it was');
  await W.waitToast(page, /"Lettuce" is back where it was/);
  await until(page, function () { return window.MindRoot.session.selected() === '0.0'; });
  t.check('and chosen on the map', true);
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoLabel; }), 'restore from the trash', 'one step');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 4; }).catch(function () {});
  t.eq(await page.evaluate(function () { return document.querySelectorAll('.ws-trash .ws-row').length; }), 4, 'the row leaves the trash');

  t.step('put back many: one step, an honest message');
  await page.evaluate(function () { window.MindRoot.session.select('1'); window.MindRoot.commands.run('node.delete'); });
  await until(page, function () { return !/West/.test(window.MindRoot.session.current().text); });
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 5; });
  await page.click('.ws-trash .ws-row[data-kind="branch"]:nth-child(1) .ws-row__check').catch(function () {});
  await page.evaluate(function () {
    Array.prototype.forEach.call(document.querySelectorAll('.ws-trash .ws-row'), function (r) {
      var box = r.querySelector('.ws-row__check');
      if (/^(West|South|Tools)$/.test(r.querySelector('.ws-row__name').textContent) && !box.checked) box.click();
    });
  });
  t.eq((await bulk(page)).label, '3 chosen', 'three chosen');
  var undoBefore = await page.evaluate(function () { return window.MindRoot.store.historyState().undoCount; });
  await page.click('.ws-bulk__restore');
  await until(page, function (p) { return window.MindRoot.store.project(p).trash.length === 2; }, pid);
  await W.waitToast(page, /^3 things put back\./);
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoCount; }), undoBefore + 1, 'one step for the three');
  var after = await page.evaluate(function (p) { var pr = window.MindRoot.store.project(p); return { maps: pr.maps.map(function (m) { return m.name; }), text: pr.maps[0].text }; }, pid);
  t.same(after.maps, ['Beds', 'Tools'], 'the map is back in its place');
  t.eq(after.text, BEDS, 'and both branches, in order');

  t.step('delete for good: a second press');
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 2; });
  await page.click('.ws-trash .ws-row:nth-child(1) .ws-row__purge');
  await until(page, function () {
    var b = document.querySelector('.ws-trash .ws-row:nth-child(1) .ws-row__purge');
    return !b.getAnimations().length;
  }, null, 2000).catch(function () {});
  var armed = await page.evaluate(function () {
    var b = document.querySelector('.ws-trash .ws-row:nth-child(1) .ws-row__purge');
    var words = b.querySelector('.btn__label');
    return { armed: b.hasAttribute('data-armed'), label: b.getAttribute('aria-label'), shown: words && getComputedStyle(words).display !== 'none' ? words.textContent : null, red: getComputedStyle(b).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue('--danger').trim().replace(/^#(..)(..)(..)$/, function (w, r, g, bl) { return 'rgb(' + parseInt(r, 16) + ', ' + parseInt(g, 16) + ', ' + parseInt(bl, 16) + ')'; }) };
  });
  t.same(armed, { armed: true, label: 'Sure? Press again', shown: 'Sure? Press again', red: true }, 'the first press arms it: it says so, in red, even under the pointer');
  var fitsRow = await page.evaluate(function () {
    var row = document.querySelector('.ws-trash .ws-row:nth-child(1)').getBoundingClientRect();
    var b = document.querySelector('.ws-trash .ws-row:nth-child(1) .ws-row__purge').getBoundingClientRect();
    var body = document.querySelector('dialog.sheet[open] .sheet__body');
    var r = body.getBoundingClientRect();
    return { inRow: b.right <= row.right + 0.5, rowIn: row.right <= r.right - 0.5 + 1, scroll: body.scrollWidth <= body.clientWidth };
  });
  t.same(fitsRow, { inRow: true, rowIn: true, scroll: true }, 'armed, the button stays inside its row and the row inside the sheet');
  t.eq(await page.evaluate(function (p) { return window.MindRoot.store.project(p).trash.length; }, pid), 2, 'nothing gone yet');
  await until(page, function () { return !document.querySelector('.ws-trash .ws-row:nth-child(1) .ws-row__purge').hasAttribute('data-armed'); }, null, 5000);
  t.check('it disarms itself after three seconds', true);
  await page.click('.ws-trash .ws-row:nth-child(1) .ws-row__purge');
  await page.click('.ws-trash .ws-row:nth-child(1) .ws-row__purge');
  await until(page, function (p) { return window.MindRoot.store.project(p).trash.length === 1; }, pid);
  await W.waitToast(page, /^Deleted for good: Beds - copy\. Undo still brings it back/);
  t.check('two presses delete it for good, and say Undo still works', true);

  t.step('empty the trash: asked first');
  await page.click('.ws-trash__empty');
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] .btn--danger'); });
  var ask = await page.evaluate(function () { var d = document.querySelector('dialog.dialog[open]'); return { title: d.querySelector('.dialog__title').textContent, text: d.querySelector('.dialog__text').textContent }; });
  t.eq(ask.title, 'Empty the trash of Garden?', 'it asks');
  t.check('saying it is for good, and what Undo still does', /goes for good/.test(ask.text) && /Undo still brings it back/.test(ask.text), ask.text);
  await page.click('dialog.dialog[open] .btn--danger');
  await until(page, function (p) { return window.MindRoot.store.project(p).trash.length === 0; }, pid);
  await until(page, function () { return /is empty/.test(document.querySelector('.ws-trash .ws-note').textContent); });
  t.check('the empty trash says what lands in it', /A deleted branch lands here/.test(await page.textContent('.ws-trash .ws-note')));
  t.eq(await page.evaluate(function () { return document.querySelector('.ws-trash__empty').hidden && document.querySelector('.ws-bulk').hidden; }), true, 'no bar and no Empty with nothing in it');
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(page, function (p) { return window.MindRoot.store.project(p).trash.length === 1; }, pid);
  t.check('Undo brings the emptied trash back', true);
  await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 1; });
  t.check('and the open sheet follows', true);
  await page.keyboard.press('Escape');

  t.step('on a phone');
  var ph = await W.boot(t, [{ name: 'Trip', maps: [['Days', '# Days\n\n- Monday\n  - Train\n- Tuesday\n']] }], { kind: 'phone' });
  var phone = ph.page;
  await phone.evaluate(function () { var ns = window.MindRoot; ns.session.select('0'); ns.commands.run('node.delete'); });
  await until(phone, function (p) { return window.MindRoot.store.project(p).trash.length === 1; }, ph.projects[0].id);
  await phone.tap('#sidebar-toggle');
  await until(phone, function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return window.MindRoot.shell.sidebar.isOpen() && r.left >= -0.5; });
  await W.rest(phone);
  await phone.tap('#sb-trash');
  await until(phone, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 1; });
  t.eq(await phone.evaluate(function () { var a = document.activeElement; return a && a.matches('dialog.sheet') ? 'sheet' : (a && a.className); }), 'sheet',
    'opened by a finger: the sheet has the focus, not the search (no keyboard over it)');
  var sheet = await phone.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    var small = [];
    Array.prototype.forEach.call(s.querySelectorAll('button, input'), function (el) {
      if (el.hidden || el.closest('[hidden]') || el.offsetParent === null) return;
      var r = el.getBoundingClientRect();
      if (el.type === 'checkbox') { var row = el.closest('.ws-row, label'); r = row ? row.getBoundingClientRect() : r; }
      if (r.height < 43.5) small.push((el.className || el.type) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    return { place: s.getAttribute('data-place'), small: small };
  });
  t.eq(sheet.place, 'bottom', 'a bottom sheet');
  t.same(sheet.small, [], 'controls finger-sized');
  await W.rest(phone);
  await t.shot('phone', phone);
  await phone.tap('.ws-trash .ws-row__restore');
  await until(phone, function () { return /Monday/.test(window.MindRoot.session.current().text); });
  t.check('a tap puts it back', true);

  t.step('house style of the strings');
  var copy = await W.copyCheck(page, ['trash']);
  t.check('strings registered', copy.count > 60, copy.count);
  t.same([copy.onlyEn, copy.onlyIt, copy.bang, copy.dash, copy.emoji], [[], [], [], [], []], 'both languages, no exclamation marks, em-dashes or emoji');
};
