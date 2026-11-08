/* source-edit: what the Markdown panel writes by itself. Each chip writes
 * the format on the lines the caret touches (a marker replaces a marker,
 * the box chip adds, ticks and unticks, B/I/U toggle as switches, a
 * placeholder stands in for nothing chosen, notes go one step under their
 * line or at column 0 under a heading) and the browser's own undo takes
 * each back; Enter continues a list and ends it on an empty item; a tap on
 * the painted box ticks it and a tap on the words does not; folding hides
 * a block from the field and never from the document, line numbers skip
 * it, typing under a fold leaves it closed, and an edit that swallows a
 * folded line brings its lines back and opens it. Tab and the chips on a
 * closed line keep every hidden line exactly once (Tab moves the whole
 * block); a line typed or pasted under a closed block opens it rather than
 * vanish under the caret. A read-only field lets Tab leave; the real colour
 * picker gives the focus back to the field. Everything the panel writes
 * reads back as the same nodes. */
'use strict';

var S = require('../fixtures/source/helpers.js');

var BASE = '# Root\n\n- first line\n- second line\n';

/* The whole field replaced, as a select-all and paste. Folds open first:
 * text pasted over a closed block keeps what it hid (the rescue rule),
 * which is not what a fresh start wants. */
async function setField(page, text) {
  await page.evaluate(function (text) {
    var f = document.querySelector('#source .src-field');
    window.MindRoot.source.unfoldAll();
    f.focus();
    f.select();
    document.execCommand('insertText', false, text);
  }, text);
}

function value(page) { return page.evaluate(function () { return document.querySelector('#source .src-field').value; }); }

function chip(page, id) {
  return page.click('#source .src-chip[data-chip="' + id + '"]');
}

function undo(page) { return page.evaluate(function () { document.execCommand('undo'); }); }

module.exports = async function (t) {
  await S.stubMissing(t.context, t);
  var page = await t.open();
  await S.seed(page, [{ name: 'Notes', text: BASE }]);
  await page.evaluate(function () { window.MindRoot.source.toggle(true); });
  await S.until(page, function () { return !document.getElementById('source').hidden; });

  t.step('heading and bullet chips replace the marker');
  await setField(page, 'first line');
  await S.caret(page, 3);
  await chip(page, 'h1');
  t.eq(await value(page), '# first line', '# puts a heading at the head of the line');
  await chip(page, 'h2');
  t.eq(await value(page), '## first line', '## replaces it rather than adding');
  await chip(page, 'bullet');
  t.eq(await value(page), '- first line', '- replaces it in turn');
  await undo(page);
  t.eq(await value(page), '## first line', 'the browser undo takes a chip back');
  await setField(page, '  - nested');
  await S.caret(page, 5);
  await chip(page, 'bullet');
  t.eq(await value(page), '  - nested', 'a bullet keeps the indent');
  await chip(page, 'h3');
  t.eq(await value(page), '### nested', 'a heading goes to column 0');
  t.eq(await page.evaluate(function () { return document.activeElement === document.querySelector('#source .src-field'); }), true, 'the field keeps the focus');

  t.step('the box chip adds, ticks and unticks');
  await setField(page, '- to do');
  await S.caret(page, 4);
  await chip(page, 'task');
  t.eq(await value(page), '- [ ] to do', 'added after the marker');
  await chip(page, 'task');
  t.eq(await value(page), '- [x] to do', 'ticked');
  await chip(page, 'task');
  t.eq(await value(page), '- [ ] to do', 'unticked');
  await setField(page, 'bare\n1. counted');
  await S.caret(page, 0, 15);
  await chip(page, 'task');
  t.eq(await value(page), '- [ ] bare\n1. [ ] counted', 'every chosen line: a bare line gets a whole item, a numbered one a box');

  t.step('marks are switches; nothing chosen gets a placeholder');
  await setField(page, '- word');
  await S.caret(page, 2, 6);
  await chip(page, 'bold');
  t.eq(await value(page), '- **word**', '** wraps the choice');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart, f.selectionEnd); }), 'word', 'and keeps it chosen');
  t.eq(await page.getAttribute('#source .src-chip[data-chip="bold"]', 'aria-pressed'), 'true', 'the bold chip shows it is on');
  await chip(page, 'italic');
  t.eq(await value(page), '- ***word***', '* adds italic on top');
  await chip(page, 'bold');
  t.eq(await value(page), '- *word*', 'taking bold off keeps italic');
  await chip(page, 'italic');
  t.eq(await value(page), '- word', 'and italic comes off too');
  await chip(page, 'underline');
  t.eq(await value(page), '- <u>word</u>', 'underline is HTML that reads anywhere');
  await chip(page, 'underline');
  t.eq(await value(page), '- word', 'and comes off');
  await S.caret(page, 6);
  await chip(page, 'bold');
  t.eq(await value(page), '- word**text**', 'nothing chosen: a placeholder');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart, f.selectionEnd); }), 'text', 'chosen, to be typed over');
  await page.keyboard.type('more');
  t.eq(await value(page), '- word**more**', 'typing replaces it');
  for (var nested = ['***x***', '**a *b* c**', '~~**s**~~', '`co*de`', '[l*k](u_r)', '![a](assets/b_c.png)'], i = 0; i < nested.length; i++) {
    await setField(page, '- ' + nested[i]);
    var painted = await page.evaluate(function () { return document.querySelector('#source .src-row .src-code').textContent; });
    t.eq(painted, '- ' + nested[i], 'painted once, letter for letter: ' + nested[i]);
  }

  t.step('indent and outdent chips move whole lines');
  await setField(page, '- a\n- b');
  await S.caret(page, 6);
  await chip(page, 'indent');
  t.eq(await value(page), '- a\n  - b', 'indent nests the line, not the caret');
  await chip(page, 'outdent');
  t.eq(await value(page), '- a\n- b', 'outdent takes it back');

  t.step('picture and notes');
  await setField(page, '- line');
  await S.caret(page, 6);
  await chip(page, 'image');
  t.eq(await value(page), '- line![](assets/)', 'the picture path arrives written');
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-field').selectionStart; }), 17, 'the caret waits inside the brackets');
  await setField(page, '- one');
  await S.caret(page, 2);
  await chip(page, 'note');
  t.eq(await value(page), '- one\n  - > note: ', 'a note goes under its line, one step in');
  await setField(page, '  - two');
  await S.caret(page, 4);
  await chip(page, 'edge');
  t.eq(await value(page), '  - two\n    - > edge: ', 'an edge note follows the indent');
  await setField(page, '## Title');
  await S.caret(page, 4);
  await chip(page, 'note');
  t.eq(await value(page), '## Title\n- > note: ', 'under a heading it sits at column 0');
  await setField(page, '1. counted');
  await S.caret(page, 4);
  await chip(page, 'note');
  t.eq(await value(page), '1. counted\n   - > note: ', 'under a numbered item it nests at the content column');

  t.step('what the chips write reads back as the same nodes');
  await setField(page, '# Root\n\n- one\n  - > note: hello\n- [x] two\n');
  await page.evaluate(function () { window.MindRoot.source.flush(); });
  var parsed = await page.evaluate(function () {
    var c = window.MindRoot.session.current();
    return { n: c.state.flat.length, note: c.tree.children[0].notes.node, task: c.tree.children[1].task };
  });
  t.same(parsed, { n: 3, note: 'hello', task: { checked: true } }, 'three nodes, the note on the first, the second done');

  t.step('the swatch colours the node on the caret line; the dice switch');
  await setField(page, '# Root\n\n- first line\n- second line\n');
  await page.evaluate(function () { window.MindRoot.source.flush(); });
  await S.caret(page, 15);
  var picked = await page.evaluate(function () {
    var ns = window.MindRoot;
    var real = ns.colorpicker;
    var seen = null;
    ns.colorpicker = { open: function (anchor, opts) { seen = { anchor: anchor.getAttribute('data-chip'), color: opts.color }; opts.onPick('#b4485f'); } };
    document.querySelector('#source .src-chip[data-chip="swatch"]').click();
    ns.colorpicker = real;
    return { seen: seen, selected: ns.session.selected() };
  });
  t.eq(picked.seen && picked.seen.anchor, 'swatch', 'the picker opens on the swatch');
  t.check('with the colour of that node', /^#[0-9a-f]{6}$/.test(picked.seen && picked.seen.color), picked);
  t.eq(picked.selected, '0', 'the node of the caret line is selected');
  t.eq((await value(page)).split('\n')[2], '- first line <!-- color: #b4485f -->', 'the colour is written on its line, in the focused field');
  t.eq(await page.evaluate(function () { return document.activeElement === document.querySelector('#source .src-field'); }), true, 'the field kept the focus');
  t.eq(await page.evaluate(function () { return document.querySelector('#source .src-chip[data-chip="swatch"]').style.getPropertyValue('--src-chip'); }), '#b4485f', 'the swatch shows it');
  await undo(page);
  t.eq((await value(page)).split('\n')[2], '- first line', 'and the browser undo takes it back');
  await page.evaluate(function () { window.MindRoot.source.flush(); });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.current().text.split('\n')[2]; }), '- first line', 'the map follows the undo');
  var dice0 = await page.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); });
  await chip(page, 'dice');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); }), !dice0, 'the dice switch flips the shared setting');
  t.eq(await page.getAttribute('#source .src-chip[data-chip="dice"]', 'aria-checked'), String(!dice0), 'and shows it');
  await chip(page, 'dice');

  t.step('Enter continues a list');
  await setField(page, '- one');
  await S.caret(page, 5);
  await page.keyboard.press('Enter');
  t.eq(await value(page), '- one\n- ', 'a new item');
  await page.keyboard.press('Enter');
  t.eq(await value(page), '- one\n', 'Enter on an empty item ends the list');
  await setField(page, '  3. third');
  await S.caret(page, 10);
  await page.keyboard.press('Enter');
  t.eq(await value(page), '  3. third\n  4. ', 'numbers count on, indent kept');
  await setField(page, '- [x] done');
  await S.caret(page, 10);
  await page.keyboard.press('Enter');
  t.eq(await value(page), '- [x] done\n- [ ] ', 'a to-do gets a fresh box');
  await setField(page, '- split here');
  await S.caret(page, 7);
  await page.keyboard.press('Enter');
  t.eq(await value(page), '- split\n-  here', 'the rest of the line goes to the new item');
  await setField(page, '# Head');
  await S.caret(page, 6);
  await page.keyboard.press('Enter');
  t.eq(await value(page), '# Head\n', 'a heading gets a plain new line');
  await setField(page, '- a');
  await S.caret(page, 3);
  await page.keyboard.press('Shift+Enter');
  t.eq(await value(page), '- a\n', 'Shift+Enter is a plain new line');

  t.step('a tap on the painted box ticks it, a tap on the words does not');
  await setField(page, '# Root\n\n- [ ] water the plants\n');
  await page.evaluate(function () { document.querySelector('#stage .mv').focus(); });
  var box = await page.evaluate(function () {
    var b = document.querySelector('#source .t-box').getBoundingClientRect();
    var w = document.querySelector('#source .t-todo').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, wx: w.left + w.width / 2, wy: w.top + w.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  t.eq((await value(page)).split('\n')[2], '- [x] water the plants', 'ticked');
  await page.mouse.click(box.x, box.y + 0.5);
  t.eq((await value(page)).split('\n')[2], '- [ ] water the plants', 'unticked');
  await page.mouse.click(box.wx, box.wy);
  t.eq((await value(page)).split('\n')[2], '- [ ] water the plants', 'the words are only words');
  await undo(page);
  t.eq((await value(page)).split('\n')[2], '- [x] water the plants', 'the browser undo takes a tick back');

  t.step('folding hides lines from the field, never from the document');
  var DOC = '# Root\n\n## Part\n- a\n  - a1\n  - a2\n- b\n\n## Other\n- c\n';
  await setField(page, DOC);
  await page.evaluate(function () { document.querySelector('#stage .mv').focus(); window.MindRoot.source.flush(); });
  var arrows = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#source .src-row'), function (r) {
      var a = r.querySelector('.src-arrow');
      return a.classList.contains('is-open') ? 'open' : (a.classList.contains('is-closed') ? 'closed' : '');
    });
  });
  t.same(arrows, ['open', '', 'open', 'open', '', '', '', '', 'open', '', ''], 'an arrow where a block starts, none elsewhere');
  var arrowAt = await page.evaluate(function () {
    var r = document.querySelectorAll('#source .src-row')[3].querySelector('.src-side').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(arrowAt.x, arrowAt.y);
  t.eq(await value(page), '# Root\n\n## Part\n- a\n- b\n\n## Other\n- c\n', 'the block of "- a" leaves the field');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), DOC, 'but not the document');
  t.same(await page.evaluate(function () { var s = window.MindRoot.source; return [0, 1, 2, 3, 4, 5].map(s.lineOfRow); }), [1, 2, 3, 4, 7, 8], 'the numbers skip the hidden lines');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('#source .src-row')[3].querySelector('.src-more').textContent; }), '2 lines', 'the closed line says what it hides');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('#source .src-row')[3].querySelector('.src-arrow').className; }), 'src-arrow is-closed', 'its arrow points right');
  t.eq(await page.evaluate(function () { return document.activeElement === document.querySelector('#source .src-field'); }), false, 'the arrow does not take the focus');

  t.step('typing under a fold leaves it closed');
  var v = await value(page);
  await S.caret(page, v.indexOf('- b') + 3);
  await page.keyboard.type(' bee');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), DOC.replace('- b\n', '- b bee\n'), 'the words land in the document');
  t.same(await page.evaluate(function () { return window.MindRoot.source.folded(); }), [3], 'the fold stays');

  t.step('retitling a closed line keeps it closed; unmaking its block shows the lines');
  v = await value(page);
  await S.caret(page, v.indexOf('- a\n') + 3);
  await page.keyboard.type('a');
  t.same(await page.evaluate(function () { return window.MindRoot.source.folded(); }), [3], 'typing in the closed line keeps it closed');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), DOC.replace('- a\n', '- aa\n').replace('- b\n', '- b bee\n'), 'and the words land on it');
  await page.keyboard.press('Backspace');
  v = await value(page);
  var dash = v.indexOf('- a\n');
  await S.caret(page, dash, dash + 2);
  await page.keyboard.press('Delete');
  t.same(await page.evaluate(function () { return window.MindRoot.source.folded(); }), [], 'a line that no longer opens a block opens');
  t.eq(await value(page), await page.evaluate(function () { return window.MindRoot.source.visibleText(); }), 'the field shows what the panel shows');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), DOC.replace('- a\n', 'a\n').replace('- b\n', '- b bee\n'), 'and nothing was lost');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart - 3, f.selectionStart + 2); }), 'rt\na\n', 'the caret stays at the head of the line');
  await page.evaluate(function () { document.execCommand('insertText', false, '- '); window.MindRoot.source.toggleFold(3); });
  t.same(await page.evaluate(function () { return window.MindRoot.source.folded(); }), [3], 'folded again');

  t.step('an edit swallowing a folded line rescues its lines');
  v = await value(page);
  var head = v.indexOf('- a\n');
  await S.caret(page, head, head + 3);
  await page.keyboard.type('- alpha');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), DOC.replace('- a\n', '- alpha\n').replace('- b\n', '- b bee\n'), 'the hidden lines are still there');
  t.same(await page.evaluate(function () { return window.MindRoot.source.folded(); }), [], 'and the fold opened');
  t.eq(await value(page), await page.evaluate(function () { return window.MindRoot.source.text(); }), 'the field shows everything again');
  v = await value(page);
  await page.evaluate(function () { window.MindRoot.source.toggleFold(3); });
  head = (await value(page)).indexOf('- alpha');
  await S.caret(page, head, head + '- alpha\n- b bee'.length);
  await page.keyboard.press('Backspace');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), '# Root\n\n## Part\n\n  - a1\n  - a2\n\n## Other\n- c\n', 'deleting the closed line keeps what it hid');

  t.step('fold every block, then unfold them all');
  await setField(page, DOC);
  await page.click('#source .src-actions .btn:nth-child(1)');
  t.eq(await value(page), '# Root\n', 'only the root line is left (it holds everything), and the blank line after it');
  t.eq(await page.getAttribute('#source .src-actions .btn:nth-child(1)', 'aria-pressed'), 'true', 'the button shows the folds');
  await page.click('#source .src-actions .btn:nth-child(1)');
  t.eq(await value(page), DOC, 'unfold all puts the document back');
  t.eq(await page.evaluate(function () { return window.MindRoot.source.text(); }), DOC, 'without losing a line');

  t.step('Tab and the chips on a closed line keep every hidden line, once');
  var FOLDED = '# Root\n\n- z\n- a\n  - a1\n- b\n';
  async function foldedAt(line) {
    await setField(page, FOLDED);
    await page.evaluate(function (line) { window.MindRoot.source.flush(); window.MindRoot.source.toggleFold(line); }, line);
    var v = await value(page);
    var at = v.indexOf('- a\n');
    await S.caret(page, at + 2);
    return v;
  }
  async function stored() {
    return page.evaluate(function () {
      var ns = window.MindRoot;
      ns.source.flush();
      var c = ns.session.current();
      return { text: ns.source.text(), store: ns.store.map(c.projectId, c.mapId).text, visible: ns.source.visibleText(), field: document.querySelector('#source .src-field').value, folded: ns.source.folded() };
    });
  }
  t.eq(await foldedAt(3), '# Root\n\n- z\n- a\n- b\n', 'the block of "- a" is closed');
  await page.keyboard.press('Tab');
  var st = await stored();
  t.eq(st.text, '# Root\n\n- z\n  - a\n    - a1\n- b\n', 'Tab moves the whole block in');
  t.eq(st.store, st.text, 'and the map has the same');
  t.eq(st.field, st.visible, 'the field shows what the panel shows');
  t.same(st.folded, [], 'the block opened');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart - 4, f.selectionStart + 2); }), '  - a\n', 'the caret stays on its line');
  await page.keyboard.press('Shift+Tab');
  st = await stored();
  t.eq(st.text, '# Root\n\n- z\n- a\n    - a1\n- b\n', 'on the open block Shift+Tab moves the line alone, as in any editor');
  t.eq(await page.evaluate(function () { var c = window.MindRoot.session.current(); return c.tree.children[1].children.length; }), 1, 'and a1 is still its child');
  await foldedAt(3);
  await page.keyboard.press('Shift+Tab');
  st = await stored();
  t.eq(st.text, FOLDED.replace('  - a1', '- a1'), 'Shift+Tab on a closed line moves its hidden lines out too');
  t.eq(st.store, st.text, 'once each, in the map as well');
  await setField(page, '# Root\n\n## H\n- x\n- y\n');
  await page.evaluate(function () { window.MindRoot.source.flush(); window.MindRoot.source.toggleFold(2); });
  await S.caret(page, (await value(page)).indexOf('## H') + 3);
  await page.keyboard.press('Shift+Tab');
  st = await stored();
  t.eq(st.text, '# Root\n\n## H\n- x\n- y\n', 'at the margin Shift+Tab moves nothing');
  t.same(st.folded, [2], 'and the block it had to open closes again');
  await foldedAt(3);
  await chip(page, 'h3');
  st = await stored();
  t.eq(st.text, '# Root\n\n- z\n### a\n  - a1\n- b\n', 'the ### chip on a closed line writes it once and keeps what it hid');
  t.eq(st.store, st.text, 'the map agrees');
  t.eq(st.field, st.visible, 'and the field shows it: the heading took the next lines, so it opened');
  await foldedAt(3);
  await chip(page, 'task');
  st = await stored();
  t.eq(st.text, '# Root\n\n- z\n- [ ] a\n  - a1\n- b\n', 'the box chip on a closed line');
  t.same(st.folded, [3], 'which stays closed: its block is the same');
  t.eq(st.field, '# Root\n\n- z\n- [ ] a\n- b\n', 'the field still hides the child');
  await foldedAt(3);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('kid');
  st = await stored();
  t.eq(st.text, '# Root\n\n- z\n- a\n  - a1\n  - kid\n- b\n', 'a new item after a closed line, moved in: one line, after the hidden ones');
  t.eq(st.field, st.text, 'the block it joined opened');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart - 3, f.selectionStart + 1); }), 'kid\n', 'and the caret follows the words');

  t.step('a line typed under a closed block never disappears');
  await setField(page, '# Root\n\n- a\n  - b\n- c\n');
  await page.evaluate(function () { window.MindRoot.source.flush(); window.MindRoot.source.foldAll(); });
  t.eq(await value(page), '# Root\n', 'fold all leaves the root');
  await S.caret(page, (await value(page)).length);
  await page.keyboard.type('- new node');
  st = await stored();
  t.eq(st.text, '# Root\n\n- a\n  - b\n- c\n- new node', 'the words land where they were typed');
  t.eq(st.store, st.text, 'and the map has them');
  t.eq(st.field, '# Root\n\n- a\n- c\n- new node', 'the root opened to show them, the inner fold stays');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.selectionStart === f.value.length; }), true, 'the caret is still after them');
  await setField(page, '# Root\n\n## A\n- x\n- y\n## B\n- q\n');
  await page.evaluate(function () { window.MindRoot.source.flush(); window.MindRoot.source.toggleFold(2); });
  var hv = await value(page);
  t.eq(hv, '# Root\n\n## A\n## B\n- q\n', 'heading A closed');
  await S.caret(page, hv.indexOf('## A') + 4);
  await page.keyboard.press('Enter');
  await page.keyboard.type('- z');
  await page.keyboard.type('zz');
  st = await stored();
  t.eq(st.text, '# Root\n\n## A\n- x\n- y\n- zzz\n## B\n- q\n', 'a line typed under a closed heading joins it, at its end');
  t.eq(st.field, st.text, 'and the heading opened to show it');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart - 5, f.selectionStart + 1); }), '- zzz\n', 'every keystroke went to that line');
  await foldedAt(3);
  await page.keyboard.press('End');
  await page.evaluate(function () { document.execCommand('insertText', false, '\n  - pasted one\n  - pasted two'); });
  st = await stored();
  t.eq(st.text, '# Root\n\n- z\n- a\n  - a1\n  - pasted one\n  - pasted two\n- b\n', 'lines pasted after a closed line join its block, once');
  t.eq(st.field, st.text, 'which opens to show them');
  t.eq(await page.evaluate(function () { var f = document.querySelector('#source .src-field'); return f.value.slice(f.selectionStart - 3, f.selectionStart + 1); }), 'two\n', 'the caret after the pasted words');

  t.step('a word being composed is never rewritten under the keyboard');
  await setField(page, '# Root\n\n- a\n  - b\n- c\n');
  await page.evaluate(function () { window.MindRoot.source.flush(); window.MindRoot.source.foldAll(); });
  await S.caret(page, (await value(page)).length);
  var comp = await page.evaluate(function () {
    var ns = window.MindRoot;
    var f = document.querySelector('#source .src-field');
    f.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    document.execCommand('insertText', false, 'w');
    var during = f.value;
    document.execCommand('insertText', false, 'o');
    var during2 = f.value;
    var text = ns.source.text();
    f.dispatchEvent(new CompositionEvent('compositionend', { data: 'wo', bubbles: true }));
    return { during: during, during2: during2, text: text, after: f.value, atEnd: f.selectionStart === f.value.length, folded: ns.source.folded() };
  });
  t.eq(comp.during, '# Root\nw', 'while composing the field keeps what the keyboard wrote');
  t.eq(comp.during2, '# Root\nwo', 'letter after letter');
  t.eq(comp.text, '# Root\n\n- a\n  - b\n- c\nwo', 'the document has the letters already');
  t.eq(comp.after, '# Root\n\n- a\n- c\nwo', 'when the word is done the closed root opens to show it');
  t.eq(comp.atEnd, true, 'with the caret still after it');
  t.same(comp.folded, [2], 'the inner fold stays closed');

  t.step('a read-only field lets Tab move the focus on');
  await setField(page, BASE);
  await page.evaluate(function () { var f = document.querySelector('#source .src-field'); f.readOnly = true; f.focus(); f.setSelectionRange(9, 9); });
  await page.keyboard.press('Tab');
  var ro = await page.evaluate(function () { var f = document.querySelector('#source .src-field'); var r = { focused: document.activeElement === f, value: f.value }; f.readOnly = false; return r; });
  t.eq(ro.focused, false, 'the focus left the field');
  t.eq(ro.value, BASE, 'and nothing was written');

  t.step('the real colour picker hands the focus back to the words');
  await setField(page, BASE);
  await page.evaluate(function () { window.MindRoot.source.flush(); });
  await S.caret(page, 12);
  await chip(page, 'swatch');
  await S.until(page, function () { return window.MindRoot.colorpicker.isOpen(); });
  await page.click('.cp-palette .cp-chip:nth-child(3)');
  var mid = await page.evaluate(function () { return { open: window.MindRoot.colorpicker.isOpen(), line: window.MindRoot.source.text().split('\n')[2] }; });
  t.check('a pick colours the line', /^- first line <!-- color: #[0-9a-f]{6} -->$/.test(mid.line), mid);
  t.eq(mid.open, true, 'and leaves the picker open to try another');
  await page.keyboard.press('Escape');
  await S.until(page, function () { return !window.MindRoot.colorpicker.isOpen(); });
  t.eq(await page.evaluate(function () { return document.activeElement === document.querySelector('#source .src-field'); }), true, 'Escape closes it and the field has the focus again');
  await chip(page, 'swatch');
  await S.until(page, function () { return window.MindRoot.colorpicker.isOpen(); });
  await page.evaluate(function () { document.querySelector('#source .src-chip[data-chip="swatch"]').click(); });
  t.eq(await page.evaluate(function () { return window.MindRoot.colorpicker.isOpen(); }), false, 'the swatch closes its own picker');
  await chip(page, 'swatch');
  await S.until(page, function () { return window.MindRoot.colorpicker.isOpen(); });
  await page.evaluate(function () { document.querySelector('#source .src-field').focus(); });
  await page.keyboard.press('Escape');
  var esc1 = await page.evaluate(function () { return { open: window.MindRoot.colorpicker.isOpen(), field: document.activeElement === document.querySelector('#source .src-field') }; });
  t.same(esc1, { open: false, field: true }, 'Escape in the field closes the picker first and keeps the focus');
  await page.keyboard.press('Escape');
  t.eq(await page.evaluate(function () { return document.activeElement === document.querySelector('#source .src-field'); }), false, 'the next Escape leaves the field');

  t.step('Ctrl+Z in the field takes back a typed run, not one letter');
  await page.evaluate(function () { var f = document.querySelector('#source .src-field'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); });
  var before = await value(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('- typed run of words', { delay: 40 });
  t.check('typed', (await value(page)).indexOf('- typed run of words') > 0, await value(page));
  await page.keyboard.press('Control+z');
  var once = await value(page);
  t.check('one Ctrl+Z takes back the words', once.indexOf('typed') < 0, once);
  await page.keyboard.press('Control+z');
  t.eq(await value(page), before, 'a second one the new line');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  t.check('redo brings both back', (await value(page)).indexOf('- typed run of words') > 0, await value(page));

  t.step('F1 opens the help from the field too');
  await page.evaluate(function () { document.querySelector('#source .src-field').focus(); });
  await page.keyboard.press('F1');
  await page.waitForFunction(function () { return window.MindRoot.help.isOpen(); }, null, { timeout: 3000 });
  t.check('help open', true);
  await page.keyboard.press('Escape');
};
