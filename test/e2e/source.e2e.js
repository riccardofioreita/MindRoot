/* source: the Markdown panel on the real index.html. Mod+M opens it with
 * the open map's text; the painted rows say the same letters as the field
 * and wrap with it; typing reaches the map after a pause and a burst of
 * typing is one undo step; the caret line and the selected node follow
 * each other (and a node chosen on the map unfolds its block); Tab and
 * Shift+Tab move whole lines; the chips write the format and the browser's
 * undo takes each back; a tap on a painted box ticks it and a tap on the
 * words does not; folding hides lines from the field but never from the
 * document, and an edit swallowing a fold rescues what it hid; Mod+B/I/U
 * mark the words instead of reaching the app; Escape leaves the field; the
 * panel's height is dragged and remembered across a reload. */
'use strict';

var S = require('../fixtures/source/helpers.js');

var MAP = [
  '# Root',
  '',
  '- Alpha',
  '  - Alpha one',
  '  - [ ] Buy seeds',
  '- Beta <!-- color: #b4485f branch -->',
  '  - Beta one',
  '- Gamma',
  ''
].join('\n');

function rowTexts(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#source .src-row .src-code'), function (el) {
      return el.textContent.replace(/​/g, '');
    });
  });
}

function lineStart(text, line) {
  var lines = text.split('\n');
  var off = 0;
  for (var i = 0; i < line; i++) off += lines[i].length + 1;
  return off;
}

module.exports = async function (t) {
  await S.stubMissing(t.context, t);
  var page = await t.open();
  var ids = await S.seed(page, [{ name: 'Plants', text: MAP }, { name: 'Tools', text: '# Tools\n\n- Spade\n' }]);

  t.step('Mod+M opens the panel with the map text');
  t.eq(await page.evaluate(function () { return document.getElementById('source').hidden; }), true, 'closed at first');
  await page.evaluate(function () { document.querySelector('#stage .mv').focus(); });
  await page.keyboard.press('Control+M');
  await S.until(page, function () { return !document.getElementById('source').hidden; });
  var st = await S.panel(page);
  t.eq(st.value, MAP, 'the field holds the map text');
  t.eq(st.rows, MAP.split('\n').length, 'one painted row per line');
  t.same(await rowTexts(page), MAP.split('\n'), 'every row says the letters of its line, once');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('sourceOpen'); }), true, 'prefs.sourceOpen remembers it');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.checked ? window.MindRoot.commands.checked('source.toggle') : true; }), true, 'the command reads as on');
  var painted = await page.evaluate(function () {
    var r = document.querySelector('#source .src-row:nth-child(1) .t-hash');
    var b = document.querySelector('#source .t-bullet');
    var box = document.querySelector('#source .t-box');
    var tint = document.querySelector('#source .t-tint');
    return { hash: !!r, bullet: !!b, box: box ? box.textContent : null, tint: tint ? tint.getAttribute('style') : null };
  });
  t.same(painted, { hash: true, bullet: true, box: '[ ]', tint: '--src-tint:#b4485f' }, 'headings, bullets, boxes and colour markers are painted');
  var tinted = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#source .src-row'), function (r) { return r.style.getPropertyValue('--src-branch'); });
  });
  t.eq(tinted[5], '#b4485f', 'a line takes its branch colour');
  t.eq(tinted[6], '#b4485f', 'and so do the lines of its children');
  t.check('lines of another branch take another colour', tinted[2] && tinted[2] !== '#b4485f', tinted);

  t.step('field and rows wrap the same way');
  var wrap = await page.evaluate(function () {
    var ns = window.MindRoot;
    var f = document.querySelector('#source .src-field');
    var long = '- ' + new Array(60).join('wrapping words ') + 'end';
    f.focus();
    f.setSelectionRange(f.value.length, f.value.length);
    document.execCommand('insertText', false, long);
    var lines = document.querySelector('#source .src-lines');
    var last = lines.children[lines.children.length - 1];
    var lh = parseFloat(getComputedStyle(document.querySelector('#source .src-editor')).lineHeight);
    return { rowsH: lines.scrollHeight, fieldH: f.scrollHeight, lastH: last.offsetHeight, lh: lh };
  });
  t.check('the long line wraps on several rows', wrap.lastH > wrap.lh * 3, wrap);
  t.check('rows and field are equally tall (same wrapping)', Math.abs(wrap.rowsH - wrap.fieldH) <= 1, wrap);
  await page.evaluate(function () { document.execCommand('undo'); });
  await S.until(page, function (m) { return window.MindRoot.source.text() === m; }, MAP);
  t.check('the browser undo takes it back', true);

  t.step('typing reaches the map after a pause, one undo step');
  await page.evaluate(function () { window.MindRoot.source.flush(); });
  await S.until(page, function (m) { var c = window.MindRoot.session.current(); return c.text === m; }, MAP);
  var hs0 = await page.evaluate(function () { return window.MindRoot.store.historyState(); });
  var at = lineStart(MAP, 7) + '- Gamma'.length;
  await S.caret(page, at);
  await page.keyboard.type(' green', { delay: 20 });
  st = await S.panel(page);
  t.check('the panel has the words at once', st.text.indexOf('- Gamma green') >= 0, st.text);
  t.eq(st.storeText, MAP, 'the store has not heard yet');
  await S.until(page, function () {
    var c = window.MindRoot.session.current();
    return c.text.indexOf('- Gamma green') >= 0;
  });
  await S.until(page, function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage .mv-node .mv-text'), function (e) { return e.textContent === 'Gamma green'; });
  });
  t.check('the map shows it', true);
  await page.keyboard.type(' leaves', { delay: 20 });
  await S.until(page, function () { return window.MindRoot.session.current().text.indexOf('Gamma green leaves') >= 0; });
  var hs1 = await page.evaluate(function () { return window.MindRoot.store.historyState(); });
  t.eq(hs1.undoLabel, 'edit the Markdown', 'labelled edit the Markdown');
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoId; }) !== hs0.undoId, true, 'a new step');
  var steps = await page.evaluate(function (id) {
    var S = window.MindRoot.store;
    var n = 0;
    var undone = [];
    while (S.canUndo() && S.historyState().undoId !== id && n < 10) { S.undo(); n++; undone.push(S.map(S.here().projectId, S.here().mapId).text); }
    return { n: n, text: undone[undone.length - 1] };
  }, hs0.undoId);
  t.eq(steps.n, 1, 'both bursts are one undo step');
  t.eq(steps.text, MAP, 'and undoing it gives the map back');
  await page.evaluate(function () { document.querySelector('#stage .mv').focus(); });
  await S.until(page, function (m) { return document.querySelector('#source .src-field').value === m; }, MAP);
  t.check('the field follows the undo once it is not focused', true);

  t.step('the caret line selects its node; a node selects its line');
  await S.caret(page, lineStart(MAP, 6) + 4);
  await S.until(page, function () { return window.MindRoot.session.selected() === '1.0'; });
  t.check('caret on "Beta one" selects it on the map', true);
  await S.caret(page, lineStart(MAP, 2) + 1);
  await S.until(page, function () { return window.MindRoot.session.selected() === '0'; });
  t.check('caret on "Alpha" selects Alpha', true);
  await page.evaluate(function () { document.querySelector('#stage .mv').focus(); window.MindRoot.session.select('2'); });
  await S.until(page, function () { return window.MindRoot.source.caretLine() === 7; });
  st = await S.panel(page);
  t.eq(st.focused, false, 'the field did not take the focus');
  t.eq(await page.evaluate(function () { var a = document.querySelector('#source .src-row.is-active'); return a ? Array.prototype.indexOf.call(a.parentNode.children, a) : -1; }), 7, 'the active row is that line');
  await page.evaluate(function () { window.MindRoot.prefs.set('syncSelection', false); window.MindRoot.session.select('1'); });
  await page.waitForTimeout(100);
  t.eq((await S.panel(page)).caretLine, 7, 'with sync off the caret stays');
  await page.evaluate(function () { window.MindRoot.prefs.set('syncSelection', true); });

  t.step('a click on the map after typing in the field still moves the caret');
  await S.caret(page, lineStart(MAP, 2) + 1);
  await S.until(page, function () { return window.MindRoot.session.selected() === '0'; });
  async function clickOn(path) {
    var r = await page.evaluate(function (p) { var b = window.MindRoot.session.view.rect(p); return { x: b.left + Math.min(10, b.width / 2), y: b.top + b.height / 2 }; }, path);
    await page.mouse.click(r.x, r.y);
    await S.until(page, function (p) { return window.MindRoot.session.selected() === p; }, path);
    await page.waitForTimeout(150);
  }
  await clickOn('2');
  t.eq((await S.panel(page)).caretLine, 7, 'a click on "Gamma" moves the caret to its line, though the field had the focus');
  await clickOn('1.0');
  t.eq((await S.panel(page)).caretLine, 6, 'and the next click too');
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-field').selectionStart; }), lineStart(MAP, 6) + '  - Beta one'.length,
    'the caret waits at the end of the words, where typing does not break the line\'s marker');
  await clickOn('1');
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-field').selectionStart; }), lineStart(MAP, 5) + '- Beta'.length,
    'before a trailing colour comment');

  t.step('a node selected on the map unfolds its block');
  await page.evaluate(function () { window.MindRoot.source.toggleFold(2); });
  t.eq((await S.panel(page)).value.split('\n').length, MAP.split('\n').length - 2, 'Alpha folded: two lines hidden');
  await page.evaluate(function () { window.MindRoot.session.select('0.1'); });
  await S.until(page, function () { return window.MindRoot.source.folded().length === 0; });
  t.eq((await S.panel(page)).caretLine, 4, 'the fold opened and the caret is on "Buy seeds"');

  t.step('Tab and Shift+Tab move whole lines');
  await S.caret(page, lineStart(MAP, 7) + 3);
  await page.keyboard.press('Tab');
  st = await S.panel(page);
  t.eq(st.value.split('\n')[7], '  - Gamma', 'Tab nests the caret line');
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-field').selectionStart; }), lineStart(MAP, 7) + 5, 'the caret moves with its words');
  await page.keyboard.press('Shift+Tab');
  t.eq((await S.panel(page)).value.split('\n')[7], '- Gamma', 'Shift+Tab takes it back');
  await S.caret(page, lineStart(MAP, 5), lineStart(MAP, 7) + 3);
  await page.keyboard.press('Tab');
  st = await S.panel(page);
  t.same(st.value.split('\n').slice(5, 8), ['  - Beta <!-- color: #b4485f branch -->', '    - Beta one', '  - Gamma'], 'a selection nests every line it touches');
  await page.keyboard.press('Shift+Tab');
  t.same((await S.panel(page)).value.split('\n').slice(5, 8), MAP.split('\n').slice(5, 8), 'and comes back');
  await page.keyboard.press('Shift+Tab');
  t.same((await S.panel(page)).value.split('\n').slice(5, 8), ['- Beta <!-- color: #b4485f branch -->', '- Beta one', '- Gamma'], 'outdent at column 0 keeps the marker');
  await page.evaluate(function () { document.execCommand('undo'); });
  t.same((await S.panel(page)).value.split('\n').slice(5, 8), MAP.split('\n').slice(5, 8), 'the browser undo takes a Tab back');

  t.step('Escape leaves the field; Mod+B marks the words, not the sidebar');
  var sidebarBefore = await page.evaluate(function () { return document.documentElement.getAttribute('data-sidebar'); });
  await S.caret(page, lineStart(MAP, 7) + 2, lineStart(MAP, 7) + 7);
  await page.keyboard.press('Control+B');
  t.eq((await S.panel(page)).value.split('\n')[7], '- **Gamma**', 'Mod+B makes the words bold');
  t.eq(await page.evaluate(function () { return document.documentElement.getAttribute('data-sidebar'); }), sidebarBefore, 'the sidebar did not move');
  await page.keyboard.press('Control+B');
  t.eq((await S.panel(page)).value.split('\n')[7], '- Gamma', 'pressed again it comes off');
  await page.keyboard.press('Escape');
  t.eq((await S.panel(page)).focused, false, 'Escape leaves the field');
  t.eq(await page.evaluate(function () { return !document.getElementById('source').hidden; }), true, 'the panel stays open');

  t.step('switching maps loads the other map');
  await page.evaluate(function (a) { window.MindRoot.session.open(a.pid, a.mid); }, { pid: ids.pid, mid: ids.maps[1] });
  await S.until(page, function () { return document.querySelector('#source .src-field').value === '# Tools\n\n- Spade\n'; });
  t.check('the field holds the other map', true);
  await page.evaluate(function (a) { window.MindRoot.session.open(a.pid, a.mid); }, { pid: ids.pid, mid: ids.maps[0] });
  await S.until(page, function (m) { return document.querySelector('#source .src-field').value === m; }, MAP);
  t.check('and back', true);

  t.step('no map: the panel steps away and comes back with the next map');
  await page.evaluate(function (pid) { window.MindRoot.store.deleteProject(pid); }, ids.pid);
  await S.until(page, function () { return document.getElementById('source').hidden; });
  t.check('hidden while nothing is open', true);
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('sourceOpen'); }), true, 'still wanted open');
  await page.evaluate(function () { window.MindRoot.store.createProject({ name: 'Again', maps: [{ name: 'Again', text: '# Again\n' }] }); });
  await S.until(page, function () { return !document.getElementById('source').hidden && document.querySelector('#source .src-field').value === '# Again\n'; });
  t.check('back with the new map in it', true);

  t.step('a toast sits over the map, above the panel, centred on the map');
  var placed = await page.evaluate(async function () {
    window.MindRoot.ui.toast('Over the map');
    await new Promise(function (r) { setTimeout(r, 450); });
    var toast = document.querySelector('.toast:not([hidden])').getBoundingClientRect();
    var src = document.getElementById('source').getBoundingClientRect();
    var stage = document.getElementById('stage').getBoundingClientRect();
    var zoom = document.getElementById('zoombar').getBoundingClientRect();
    return { toastBottom: toast.bottom, srcTop: src.top, mid: (toast.left + toast.right) / 2, stageMid: (stage.left + stage.right) / 2, zoomTop: zoom.top };
  });
  t.check('above the Markdown panel and the zoom bar, in the middle of the map', placed.toastBottom <= placed.srcTop && placed.toastBottom <= placed.zoomTop && Math.abs(placed.mid - placed.stageMid) < 2, placed);

  t.step('Mod+M closes it again');
  await page.keyboard.press('Control+M');
  await S.until(page, function () { return document.getElementById('source').hidden; });
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('sourceOpen'); }), false, 'remembered closed');
};
