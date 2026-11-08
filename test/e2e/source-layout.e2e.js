/* source-layout: where the Markdown panel sits and how big it is. Docked
 * under the map on a desktop, its grip drags it taller or shorter (and the
 * keyboard moves it too), the share of the main area is kept in
 * prefs.sourceHeight and comes back - open - after a reload; it never
 * squeezes the map under its minimum. On a phone it takes the whole main
 * area above the thumb bar, its chips at the bottom; with the field focused
 * the thumb bar steps aside so the chips sit on the keyboard. View-only
 * hides it; a read-only store makes the field read-only. Italian labels.
 * A 5,000-line map opens and a keystroke stays fast (rows are painted
 * incrementally); writing it to the map is timed, and the pause waited
 * for grows when the map is slow to draw. */
'use strict';

var S = require('../fixtures/source/helpers.js');

var MAP = '# Root\n\n- Alpha\n  - Alpha one\n- Beta\n';

function big(lines) {
  var out = ['# Big map', ''];
  var n = 0;
  while (out.length < lines) {
    out.push('- Branch ' + n + ' with a few words');
    for (var k = 0; k < 4 && out.length < lines; k++) out.push('  - Leaf ' + n + '.' + k + ' **bold** and `code`');
    n++;
  }
  return out.join('\n') + '\n';
}

/* The panel rises in: measure where it rests. */
function settled(page) {
  return page.waitForFunction(function () {
    var s = document.getElementById('source');
    return !s.getAnimations || s.getAnimations().length === 0;
  }, null, { timeout: 4000, polling: 50 });
}

function rect(page, sel) {
  return page.evaluate(function (sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width, shown: !!(el.offsetParent || el.getClientRects().length) };
  }, sel);
}

module.exports = async function (t) {
  await S.stubMissing(t.context, t);
  var page = await t.open();
  var ids = await S.seed(page, [{ name: 'Plants', text: MAP }]);
  var url = page.url();

  t.step('docked under the map at its remembered share');
  await page.evaluate(function () { window.MindRoot.source.toggle(true); });
  await S.until(page, function () { return !document.getElementById('source').hidden; });
  await settled(page);
  var main = await rect(page, '#main');
  var src = await rect(page, '#source');
  var stage = await rect(page, '#stage');
  t.check('at the bottom of the main area', Math.abs(src.bottom - main.bottom) <= 1, { src: src, main: main });
  t.check('about 34% of it', Math.abs(src.height / main.height - 0.34) < 0.02, src.height / main.height);
  t.check('the map ends where the panel starts', Math.abs(stage.bottom - src.top) <= 1, { stage: stage, src: src });
  t.check('chips beside the title on a wide screen', Math.abs((await rect(page, '#source .src-chips')).top - (await rect(page, '#source .src-title')).top) < 20, null);

  t.step('the grip drags the height, and it is remembered');
  var grip = await rect(page, '#source .src-grip');
  await page.mouse.move(grip.left + grip.width / 2, grip.top + grip.height / 2);
  await page.mouse.down();
  var gy = grip.top + grip.height / 2;
  await page.mouse.move(grip.left + grip.width / 2, gy - 60, { steps: 4 });
  await page.mouse.move(grip.left + grip.width / 2, gy - 120, { steps: 4 });
  await page.mouse.up();
  var after = await rect(page, '#source');
  t.check('dragged up 120 px, the panel is 120 px taller', Math.abs(after.height - src.height - 120) <= 2, { before: src.height, after: after.height });
  var share = await page.evaluate(function () { return window.MindRoot.prefs.get('sourceHeight'); });
  t.check('prefs.sourceHeight holds the new share', Math.abs(share - after.height / main.height) < 0.01, share);
  await page.mouse.move(grip.left + grip.width / 2, gy - 120);
  await page.mouse.down();
  await page.mouse.move(grip.left + grip.width / 2, 0, { steps: 6 });
  await page.mouse.up();
  var stageMin = await page.evaluate(function () { return parseFloat(getComputedStyle(document.getElementById('stage')).minHeight); });
  stage = await rect(page, '#stage');
  t.check('dragged to the top, the map keeps its minimum', stage.height >= stageMin - 1, { stage: stage.height, min: stageMin });
  await page.focus('#source .src-grip');
  var h0 = (await rect(page, '#source')).height;
  await page.keyboard.press('Enter');
  t.check('Enter on the grip puts the default height back', Math.abs((await rect(page, '#source')).height / main.height - 0.34) < 0.02, null);
  await page.keyboard.press('ArrowUp');
  var h1 = (await rect(page, '#source')).height;
  t.check('ArrowUp makes it taller', h1 > main.height * 0.34 + 10, { h0: h0, h1: h1 });
  t.eq(await page.getAttribute('#source .src-grip', 'aria-valuenow'), '39', 'the separator says its value');
  await page.evaluate(function () { window.MindRoot.prefs.flush && window.MindRoot.prefs.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; });
  await S.until(page, function () { return window.MindRoot.session.current() && !document.getElementById('source').hidden; });
  await settled(page);
  var reloaded = await rect(page, '#source');
  t.check('after a reload the panel is open at the same height', Math.abs(reloaded.height - h1) <= 2, { before: h1, after: reloaded.height });
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-field').value; }), MAP, 'with the map in it');

  t.step('view-only hides it; a read-only store locks the field');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(true); });
  t.eq((await rect(page, '#source')).shown, false, 'view-only hides the panel');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(false); });
  t.eq((await rect(page, '#source')).shown, true, 'and it comes back');
  var ro = await page.evaluate(function () {
    var ns = window.MindRoot;
    if (typeof ns.store.setReadOnly !== 'function') return null;
    ns.store.setReadOnly(true);
    var f = document.querySelector('#source .src-field');
    var out = { ro: f.readOnly };
    ns.store.setReadOnly(false);
    out.back = f.readOnly;
    return out;
  });
  if (ro) t.same(ro, { ro: true, back: false }, 'the field follows the store being read-only');
  else t.log('store.setReadOnly not available: read-only check skipped');

  t.step('Italian labels');
  var it = await t.newContext();
  await S.stubMissing(it, t);
  var pit = await it.newPage();
  await t.open('', { page: pit, lang: 'it' });
  await S.seed(pit, [{ name: 'Plants', text: MAP }]);
  await pit.evaluate(function () { window.MindRoot.source.toggle(true); });
  var labels = await pit.evaluate(function () {
    return {
      field: document.querySelector('#source .src-field').getAttribute('aria-label'),
      close: document.querySelector('#source .src-actions .btn:last-child').getAttribute('aria-label'),
      note: document.querySelector('#source .src-chip[data-chip="note"]').getAttribute('aria-label'),
      cmd: window.MindRoot.commands.label('source.toggle')
    };
  });
  t.same(labels, { field: 'Markdown della mappa', close: 'Chiudi il Markdown', note: 'Nota sotto questa riga', cmd: 'Mostra il Markdown' }, 'the panel speaks Italian');

  t.step('a phone: the whole main area, chips at the bottom');
  var phone = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await S.stubMissing(phone, t);
  var pp = await phone.newPage();
  await t.open('', { page: pp });
  await S.seed(pp, [{ name: 'Plants', text: MAP }]);
  await pp.evaluate(function () { window.MindRoot.source.toggle(true); });
  await S.until(pp, function () { return !document.getElementById('source').hidden; });
  await settled(pp);
  var pmain = await rect(pp, '#main');
  var psrc = await rect(pp, '#source');
  var thumb = await rect(pp, '#thumbbar');
  var chips = await rect(pp, '#source .src-chips');
  var editor = await rect(pp, '#source .src-editor');
  t.check('from the top of the main area', Math.abs(psrc.top - pmain.top) <= 1, { psrc: psrc, pmain: pmain });
  if (thumb && thumb.shown && thumb.height) t.check('down to the thumb bar, not under it', psrc.bottom <= thumb.top + 1, { psrc: psrc, thumb: thumb });
  t.check('chips under the text, at the bottom', chips.top >= editor.bottom - 1 && Math.abs(chips.bottom - psrc.bottom) <= 1, { chips: chips, editor: editor, psrc: psrc });
  t.eq(await pp.evaluate(function () { return getComputedStyle(document.querySelector('#source .src-grip')).display; }), 'none', 'no grip on a phone');
  var sizes = await pp.evaluate(function () {
    var f = document.querySelector('#source .src-field');
    var c = document.querySelector('#source .src-chip');
    return { font: parseFloat(getComputedStyle(f).fontSize), chip: c.getBoundingClientRect().height };
  });
  t.check('the field text is at least 16px (iOS does not zoom)', sizes.font >= 16, sizes);
  t.check('chips are 44px targets', sizes.chip >= 44, sizes);
  await pp.tap('#source .src-field');
  await S.until(pp, function () { return document.activeElement === document.querySelector('#source .src-field'); });
  await S.until(pp, function () { var tb = document.getElementById('thumbbar'); return !tb || getComputedStyle(tb).display === 'none'; });
  await settled(pp);
  var thumbTyping = await rect(pp, '#thumbbar');
  var srcTyping = await rect(pp, '#source');
  t.check('typing: the thumb bar steps aside', !thumbTyping || !thumbTyping.shown, thumbTyping);
  t.check('and the panel reaches the bottom', Math.abs(srcTyping.bottom - pmain.bottom) <= 1, { srcTyping: srcTyping, pmain: pmain });
  await t.shot('phone', pp);
  await pp.tap('#source .src-chip[data-chip="h2"]');
  t.check('a chip tapped keeps the field focused', await pp.evaluate(function () { return document.activeElement === document.querySelector('#source .src-field'); }), null);

  t.step('a 5,000-line map stays fast');
  var text = big(5000);
  var bigIds = await page.evaluate(function (text) {
    var ns = window.MindRoot;
    window.__bigRendered = false;
    var off = ns.bus.on('map:rendered', function () { window.__bigRendered = true; });
    var p = ns.store.createProject({ name: 'Big', maps: [{ name: 'Big', text: text }] });
    return { pid: p.id, mid: p.maps[0].id };
  }, text);
  await S.until(page, function () { return window.__bigRendered; }, null, 60000);
  await S.until(page, function (n) { return document.querySelectorAll('#source .src-row').length === n; }, text.split('\n').length, 20000);
  t.check('one row per line', true);
  var timing = await page.evaluate(function () {
    var f = document.querySelector('#source .src-field');
    f.focus();
    var at = f.value.indexOf('Leaf 500.2');
    f.setSelectionRange(at, at);
    var times = [];
    for (var i = 0; i < 10; i++) {
      var t0 = performance.now();
      document.execCommand('insertText', false, 'x');
      times.push(performance.now() - t0);
    }
    var t1 = performance.now();
    document.execCommand('insertText', false, '\n- new line');
    var enter = performance.now() - t1;
    times.sort(function (a, b) { return a - b; });
    return { median: times[5], max: times[9], enter: enter, rows: document.querySelectorAll('#source .src-row').length };
  });
  t.log('5,000 lines: keystroke median ' + timing.median.toFixed(1) + ' ms, max ' + timing.max.toFixed(1) + ' ms; a new line ' + timing.enter.toFixed(1) + ' ms');
  t.check('a keystroke is handled in under 30 ms (median)', timing.median < 30, timing);
  t.check('a new line in under 60 ms', timing.enter < 60, timing);
  t.eq(timing.rows, text.split('\n').length + 1, 'the new line got its row');
  var flushMs = await page.evaluate(function () {
    var t0 = performance.now();
    window.MindRoot.source.flush();
    return performance.now() - t0;
  });
  await S.until(page, function () { return window.MindRoot.session.current().text.indexOf('xxxxxxxxxx\n- new lineLeaf 500.2') >= 0; }, null, 20000);
  t.check('and every keystroke reached the map', true);
  var pauses = await page.evaluate(function () {
    var ns = window.MindRoot;
    var f = document.querySelector('#source .src-field');
    f.focus();
    var parts = {};
    var S0 = ns.store.setMapText;
    var R0 = ns.session.reload;
    ns.store.setMapText = function () { var t0 = performance.now(); try { return S0.apply(this, arguments); } finally { parts.store = performance.now() - t0; } };
    ns.session.reload = function () { var t0 = performance.now(); try { return R0.apply(this, arguments); } finally { parts.reload = performance.now() - t0; } };
    document.execCommand('insertText', false, 'y');
    var t1 = performance.now();
    ns.source.flush();
    parts.flush = performance.now() - t1;
    ns.store.setMapText = S0;
    ns.session.reload = R0;
    /* The next pause is longer than the plain 300 ms: one keystroke now,
     * and the map must not have it 300 ms later. */
    document.execCommand('insertText', false, 'z');
    return new Promise(function (resolve) {
      setTimeout(function () {
        parts.early = ns.session.current().text.indexOf('yz') >= 0;
        resolve(parts);
      }, 340);
    });
  });
  t.log('5,000 lines: writing the map ' + flushMs.toFixed(0) + ' ms (store ' + (pauses.store || 0).toFixed(0) + ', drawing ' + (pauses.reload || 0).toFixed(0) + ', whole ' + pauses.flush.toFixed(0) + ')');
  t.check('writing a 5,000-line map takes under two seconds (half a second on its own, more under load)', flushMs < 2000 && pauses.flush < 2000, { flushMs: flushMs, pauses: pauses });
  t.check('a map slow to draw waits longer for the typing to pause', pauses.flush < 30 || !pauses.early, pauses);
  await S.until(page, function () { return window.MindRoot.session.current().text.indexOf('yz') >= 0; }, null, 20000);
  t.check('and then hears it', true);
  var far = await page.evaluate(function () {
    var ns = window.MindRoot;
    document.querySelector('#source .src-field').blur();
    ns.source.focusLine(3999);
    var rows = document.querySelectorAll('#source .src-row');
    var active = document.querySelector('#source .src-row.is-active');
    var idx = Array.prototype.indexOf.call(rows, active);
    var side = active.querySelector('.src-side');
    var num = active.querySelector('.src-num');
    var digit = (function () { var c = document.createElement('span'); c.textContent = '0000'; side.appendChild(c); var w = c.getBoundingClientRect().width; c.remove(); return w; })();
    return { num: num.textContent, line: ns.source.lineOfRow(idx), fits: num.getBoundingClientRect().width <= side.getBoundingClientRect().width, gutter: side.getBoundingClientRect().width, four: digit };
  });
  t.eq(far.num, String(far.line), 'a row brought into view far down shows its own line number');
  t.check('the gutter is wide enough for four digits', far.fits && far.gutter > far.four, far);
  void ids; void bigIds; void url;
};

/* It times keystrokes and writes on a 5,000-line map against budgets: run
 * alone after the parallel pool (test/run.js), so it measures the panel and
 * not three other suites sharing the machine. */
module.exports.solo = true;
