/* copies: the copies of the open map and the clock that takes them. A copy
 * by hand takes an optional note and is a step of the history. The clock
 * (every N minutes or hours, set in the sheet and kept in prefs) copies
 * only maps that changed - since their last copy, or since the session
 * first saw them - and its copies are not steps and survive undo. A copy is
 * looked at before anything happens: as a read-only map of its own, or as
 * the lines that would change. Going back first takes a copy of the map as
 * it is, all in one step that Undo takes back whole. A copy deleted goes
 * to the trash. The sheet follows the open map; on a phone it is a bottom
 * sheet. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var V1 = '# Beds\n\n- North\n  - Lettuce\n- South\n';
var V2 = '# Beds\n\n- North\n  - Lettuce\n  - Radish\n- South\n- East\n';

function listRows(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.ws-copies .ws-copy'), function (r) {
      return { kind: r.getAttribute('data-kind'), when: r.querySelector('.ws-row__name').textContent, meta: r.querySelector('.ws-row__meta').textContent };
    });
  });
}

module.exports = async function (t) {
  var b = await W.boot(t, [{ name: 'Garden', maps: [['Beds', V1], ['Tools', '# Tools\n'], ['Seeds', '# Seeds\n']] }]);
  var page = b.page;
  var pid = b.projects[0].id;
  var beds = b.projects[0].maps[0];
  var seeds = b.projects[0].maps[2];

  t.step('no copies yet');
  await page.evaluate(function () { window.MindRoot.commands.run('copies.open'); });
  await until(page, function () { return !!document.querySelector('.ws-copies'); });
  var empty = await page.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return { title: s.querySelector('.sheet__title').textContent, note: s.querySelector('.ws-copies .ws-note').textContent, every: document.getElementById('copies-every').value, unit: document.getElementById('copies-unit').value };
  });
  t.eq(empty.title, 'Copies of Beds', 'titled with the open map');
  t.eq(empty.note, 'No copies of Beds yet. One is taken every hour when the map has changed, and the button above takes one now.', 'says how copies come');
  t.same([empty.every, empty.unit], ['1', 'h'], 'the clock as the preferences say');

  t.step('a copy by hand, with a note');
  await page.click('#copies-take');
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] input'); });
  t.eq(await page.getAttribute('dialog.dialog[open] input', 'placeholder'), 'before the rewrite', 'the note suggests itself');
  await page.fill('dialog.dialog[open] input', 'first draft');
  await page.keyboard.press('Enter');
  await until(page, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 1; });
  await W.waitToast(page, /^Copy taken\.$/);
  var r1 = await listRows(page);
  t.same(r1, [{ kind: 'manual', when: 'just now', meta: 'By hand: first draft' }], 'a row: when, how, the note');
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoLabel; }), 'take a copy', 'a step of the history');

  t.step('the clock copies only changed maps');
  await page.evaluate(function (ids) { window.MindRoot.store.setMapText(ids.pid, ids.seeds, '# Seeds\n\n- Beans\n'); window.MindRoot.store.setMapText(ids.pid, ids.beds, ids.v2); }, { pid: pid, beds: beds, seeds: seeds, v2: V2 });
  await page.fill('#copies-every', '5');
  await page.selectOption('#copies-unit', 'm');
  await page.dispatchEvent('#copies-every', 'change');
  await until(page, function () { var c = window.MindRoot.prefs.get('copies'); return c.every === 5 && c.unit === 'm'; });
  t.check('the interval is set from the sheet and kept', true);
  var clock = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var next = ns.copies.clock.next();
    var early = ns.copies.clock.tick(next - 1000);
    var undo = ns.store.historyState().undoCount;
    var taken = ns.copies.clock.tick(next + 1000);
    var list = function (mid) { return ns.store.snapshotsOf(ids.pid, mid).map(function (s) { return s.kind; }); };
    var afterUndo = undo;
    ns.store.undo();
    var survived = list(ids.beds);
    ns.store.redo();
    return {
      inFive: Math.round((next - Date.now()) / 60000), early: early, taken: taken, sameUndo: ns.store.historyState().undoCount === afterUndo,
      beds: list(ids.beds), seeds: list(ids.seeds), tools: list(ids.tools), survived: survived,
      again: ns.copies.clock.tick(ns.copies.clock.next() + 1000)
    };
  }, { pid: pid, beds: beds, seeds: seeds, tools: b.projects[0].maps[1] });
  t.eq(clock.inFive, 5, 'the next copy is due in five minutes');
  t.eq(clock.early, 0, 'nothing before it is due');
  t.eq(clock.taken, 2, 'two maps had changed: two copies');
  t.same(clock.beds, ['auto', 'manual'], 'Beds changed since its last copy');
  t.same(clock.seeds, ['auto'], 'Seeds changed since the session first saw it');
  t.same(clock.tools, [], 'Tools never changed: no copy');
  t.eq(clock.sameUndo, true, 'clock copies are not steps');
  t.same(clock.survived, ['auto', 'manual'], 'and survive undo');
  t.eq(clock.again, 0, 'nothing changed since: nothing more');
  await until(page, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 2; });
  t.eq((await listRows(page))[0].meta, 'On the clock', 'the sheet shows it, newest first');

  t.step('looking at a copy before going back');
  await page.click('.ws-copies .ws-copy[data-kind="manual"] [data-role="look"]');
  await until(page, function () { return !!document.querySelector('.ws-copies__map'); });
  await until(page, function () { return document.querySelectorAll('.ws-copies__map .mv-node').length === 4; });
  var pv = await page.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    return {
      title: s.querySelector('.sheet__title').textContent,
      seg: Array.prototype.map.call(s.querySelectorAll('.seg__opt'), function (b) { return b.textContent + ':' + b.getAttribute('aria-checked'); }),
      words: Array.prototype.map.call(s.querySelectorAll('.ws-copies__map .mv-node .mv-text'), function (e) { return e.textContent; }),
      readOnly: !!s.querySelector('.ws-copies__map .mv--readonly'),
      note: s.querySelector('.ws-hint') ? s.querySelector('.ws-hint').textContent : ''
    };
  });
  t.check('titled with its moment', /^Copy from /.test(pv.title), pv.title);
  t.same(pv.seg, ['Map:true', 'Changes:false'], 'shown as a map first');
  t.same(pv.words, ['Beds', 'North', 'Lettuce', 'South'], 'the copy drawn as a map');
  t.eq(pv.readOnly, true, 'read-only');
  t.eq(pv.note, 'By hand: first draft', 'with its note');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.current().text; }), V2, 'nothing happened to the map');
  await page.click('.ws-copies__bar .seg__opt[data-value="text"]');
  await until(page, function () { return !!document.querySelector('.ws-diff'); });
  var diff = await page.evaluate(function () {
    return {
      summary: document.querySelector('.ws-diff .ws-note').textContent,
      lines: Array.prototype.map.call(document.querySelectorAll('.ws-diff__line'), function (l) { return l.getAttribute('data-op') + ':' + l.querySelector('.ws-diff__words').textContent; })
    };
  });
  t.eq(diff.summary, 'Going back to it: 0 lines come back, 2 go.', 'what going back would change');
  t.check('the lines that go are marked', diff.lines.indexOf('del:  - Radish') >= 0 && diff.lines.indexOf('del:- East') >= 0, diff.lines);
  await page.click('#copies-back');
  await until(page, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 2; });
  t.eq(await page.evaluate(function () { return !!document.querySelector('.ws-copies__map') || document.querySelectorAll('.mv').length; }), 1, 'back to the list; the preview map is gone');
  t.eq(await page.evaluate(function () { return document.activeElement && document.activeElement.getAttribute('data-role'); }), 'look', 'the focus is back on the row it came from');

  t.step('going back: a copy of the map first, one step');
  var steps = await page.evaluate(function () { return window.MindRoot.store.historyState().undoCount; });
  await page.click('.ws-copies .ws-copy[data-kind="manual"] [data-role="look"]');
  await until(page, function () { return !!document.getElementById('copies-go'); });
  await page.click('#copies-go');
  await until(page, function () { return window.MindRoot.session.current().text === '# Beds\n\n- North\n  - Lettuce\n- South\n'; });
  await W.waitToast(page, /^The map is back to the copy from .*What was there is kept as a copy too\.$/);
  var gone = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var safe = ns.store.snapshotsOf(ids.pid, ids.beds).filter(function (s) { return /^before going back to the copy from /.test(s.label); });
    return { count: ns.store.historyState().undoCount, label: ns.store.historyState().undoLabel, safety: safe.length + '|' + safe[0].kind + '|' + (safe[0].text === ids.v2) };
  }, { pid: pid, beds: beds, v2: V2 });
  t.eq(gone.count, steps + 1, 'one step');
  t.eq(gone.label, 'go back to a copy', 'labelled');
  t.eq(gone.safety, '1|manual|true', 'what was there is a copy by hand');
  await until(page, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 3; });
  t.check('the sheet is back on the list, with the new copy', true);
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(page, function (v) { return window.MindRoot.session.current().text === v; }, V2);
  t.check('Undo takes it all back', true);

  t.step('a copy deleted goes to the trash');
  await page.click('.ws-copies .ws-copy:nth-child(1) [data-role="delete"]');
  await until(page, function (p) { return window.MindRoot.store.project(p).trash.length === 1; }, pid);
  await W.waitToast(page, /The copy is in the trash/);
  t.eq(await page.evaluate(function (p) { return window.MindRoot.store.project(p).trash[0].kind; }, pid), 'snapshot', 'as a copy');

  t.step('the sheet follows the open map');
  await page.evaluate(function (ids) { window.MindRoot.session.open(ids.pid, ids.seeds); }, { pid: pid, seeds: seeds });
  await until(page, function () { return document.querySelector('dialog.sheet[open] .sheet__title').textContent === 'Copies of Seeds'; });
  t.eq((await listRows(page)).length, 1, 'with that map\'s copies');
  await page.keyboard.press('Escape');
  await until(page, function () { return !window.MindRoot.copies.isOpen(); });

  t.step('on a phone');
  var ph = await W.boot(t, [{ name: 'Trip', maps: [['Days', '# Days\n\n- Monday\n']] }], { kind: 'phone' });
  var phone = ph.page;
  await phone.evaluate(function () { var ns = window.MindRoot; var h = ns.store.here(); ns.store.takeSnapshot(h.projectId, h.mapId, { kind: 'manual', label: 'start' }); ns.commands.run('copies.open'); });
  await until(phone, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 1; });
  var ps = await phone.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    var small = [];
    Array.prototype.forEach.call(s.querySelectorAll('button, input, select'), function (el) {
      if (el.offsetParent === null) return;
      var r = el.getBoundingClientRect();
      if (r.height < 43.5) small.push((el.id || el.className) + ' ' + Math.round(r.height));
    });
    return { place: s.getAttribute('data-place'), small: small };
  });
  t.eq(ps.place, 'bottom', 'a bottom sheet');
  t.same(ps.small, [], 'controls finger-sized');
  await phone.evaluate(function () { var ns = window.MindRoot; var h = ns.store.here(); ns.store.setMapText(h.projectId, h.mapId, '# Days\n\n- Monday\n- Tuesday\n'); });
  await phone.tap('.ws-copies [data-role="look"]');
  await until(phone, function () { return document.querySelectorAll('.ws-copies__map .mv-node').length === 2; });
  t.check('the preview map draws on a phone too', true);
  await W.rest(phone);
  await t.shot('phone-preview', phone);
  /* The sheet rests at 60% of the screen: the action the preview is for
   * is on screen there, not below it. */
  var reach = await phone.evaluate(function () {
    var s = document.querySelector('dialog.sheet[open]');
    var go = document.getElementById('copies-go');
    var r = go.getBoundingClientRect();
    var m = document.querySelector('.ws-copies__map').getBoundingClientRect();
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { detent: s.getAttribute('data-detent'), inside: r.top >= s.getBoundingClientRect().top && r.bottom <= window.innerHeight + 0.5, hit: !!(hit && hit.closest('#copies-go')), map: Math.round(m.height), mapBelowGo: m.bottom <= r.top + 0.5 };
  });
  t.eq(reach.detent, 'low', 'the sheet at its low rest');
  t.check('"Go back to it" is on screen', reach.inside && reach.hit, JSON.stringify(reach));
  t.check('the map fills what is left above it', reach.map >= 150 && reach.mapBelowGo, JSON.stringify(reach));
  await phone.tap('#copies-go');
  await W.waitToast(phone, /is back to the copy/);
  await until(phone, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 2 && !document.getElementById('copies-go'); });
  t.check('and a tap on it goes back (with a safety copy)', true);

  t.step('house style of the strings');
  var copy = await W.copyCheck(page, ['copies']);
  t.check('strings registered', copy.count > 40, copy.count);
  t.same([copy.onlyEn, copy.onlyIt, copy.bang, copy.dash, copy.emoji], [[], [], [], [], []], 'both languages, no exclamation marks, em-dashes or emoji');
};
