/* editor-rename: writing a node where it is drawn. Double click opens the
 * two fields (title and the words under it) as plain text; Enter saves,
 * Shift+Enter in the title goes down to the text and in the text breaks a
 * line, Tab saves and adds a child, Escape cancels, a click elsewhere saves,
 * moving between the two fields does not; paste is plain text; the browser's
 * own bold never gets in. The format bar: marks written into the text (B, I,
 * U, strike, clear), sizes and caption for the title, styles for the text,
 * picture placement and removal - each change merged with what was typed
 * into one undo step, the writing going on where it was. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- Alpha **bold**\n- Beta\n  - > text: under beta\n- ![](assets/pic.png) Pictured\n- Delta\n\n  A paragraph of free text.\n';

function chooseWords(page, which, from, to) {
  return page.evaluate(function (a) {
    var el = document.querySelector(a.which === 'body' ? '.mv-edit--body' : '.mv-edit--title');
    el.focus();
    var node = el.firstChild;
    var r = document.createRange();
    r.setStart(node, a.from);
    r.setEnd(node, a.to);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return sel.toString();
  }, { which: which, from: from, to: to });
}

function fmt(page, name) {
  return page.evaluate(function (n) {
    var b = document.querySelector('.format-bar [data-format="' + n + '"]');
    return b ? { shown: !b.hidden && !b.closest('[hidden]'), disabled: b.getAttribute('aria-disabled') === 'true', pressed: b.getAttribute('aria-pressed') } : null;
  }, name);
}

async function pressFmt(page, name) {
  await page.click('.format-bar [data-format="' + name + '"]');
}

async function pickMenu(page, label) {
  await page.waitForSelector('.menu:not([hidden]) .menu__item', { timeout: 4000 });
  var ok = await page.evaluate(function (want) {
    var items = document.querySelectorAll('.menu:not([hidden]) .menu__item');
    for (var i = 0; i < items.length; i++) {
      if (items[i].querySelector('.menu__label').textContent === want) { items[i].setAttribute('data-test-pick', ''); return true; }
    }
    return false;
  }, label);
  if (!ok) throw new Error('no menu item ' + label);
  await page.click('[data-test-pick]');
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Rename', MAP], ['Other', '# Other\n']]);
  var page = s.page;

  t.step('a double click opens the node for writing');
  var b = await E.box(page, '0');
  await page.mouse.dblclick(b.x + 14, b.y + b.h / 2);
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  var f = await E.fields(page);
  t.same({ title: f.title, body: f.body, focus: f.focus, chosen: f.chosen }, { title: 'Alpha **bold**', body: '', focus: 'title', chosen: '' },
    'the title as plain text, marks and all, caret at the end; an empty field for the words under it');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-edit--title').children.length; }), 0, 'no markup in the field');
  t.eq(await E.visible(page, '.format-bar'), true, 'the format bar is there from the start');
  t.eq(await E.visible(page, '.node-toolbar'), false, 'the node toolbar steps aside');
  var bar = await E.rectOf(page, '.format-bar');
  b = await E.box(page, '0');
  t.check('the bar sits clear of the node, not over its words', bar.bottom <= b.y + 1 || bar.y >= b.bottom - 1, { bar: bar, node: b });

  t.step('Escape cancels and the node is drawn as before');
  await page.keyboard.type(' more');
  await page.keyboard.press('Escape');
  t.eq(await E.renaming(page), null, 'closed');
  t.eq(await E.text(page), MAP, 'nothing written');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-node[data-path="0"] .mv-text').innerHTML; }), 'Alpha <strong>bold</strong>', 'the words drawn again with their marks');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('.mv-node[data-path="0"] .mv-body').length; }), 0, 'the empty text field is gone');

  t.step('a click elsewhere saves');
  var steps = (await E.history(page)).count;
  await page.evaluate(function () { window.MindRoot.editor.startRename('1'); });
  await page.keyboard.type(' two');
  var stage = await E.rectOf(page, '#stage');
  await page.mouse.click(stage.x + 30, stage.bottom - 60);
  t.eq(await E.renaming(page), null, 'closed');
  t.check('saved', /\n- Beta two\n/.test(await E.text(page)), await E.text(page));
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.rename'], 'one step: rename');

  t.step('the words under the title');
  await page.evaluate(function () { window.MindRoot.editor.startRename('1'); });
  f = await E.fields(page);
  t.same([f.title, f.body], ['Beta two', 'under beta'], 'both fields filled');
  var fieldBox = await E.rectOf(page, '.mv-edit--body');
  await page.mouse.click(fieldBox.right - 2, fieldBox.y + fieldBox.h / 2);
  t.eq(await E.renaming(page) !== null, true, 'moving to the other field does not save');
  t.eq((await E.fields(page)).focus, 'body', 'the caret is in the text');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  f = await E.fields(page);
  t.eq(f.body, 'under beta\nsecond line', 'Shift+Enter breaks the line, as a character');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-edit--body').querySelectorAll('div, p, b, span').length; }), 0, 'and no element is written into the field');
  steps = (await E.history(page)).count;
  /* In the text Enter breaks the line too (it goes on with a list); the
   * modified Enter is what saves from there. */
  await page.keyboard.press('Enter');
  t.eq((await E.fields(page)).body, 'under beta\nsecond line\n', 'Enter in the text breaks the line');
  t.eq(await E.renaming(page) !== null, true, 'and does not save');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+Enter');
  t.check('the text is written as a quote under the line, one line per line',
    /\n- Beta two\n {2}- > text: under beta\n {4}> second line\n/.test(await E.text(page)), await E.text(page));
  t.eq((await E.history(page)).count - steps, 1, 'one step');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-node[data-path="1"] .mv-body-text').textContent; }), 'under betasecond line', 'drawn inside the node');

  t.step('Shift+Enter in the title goes down to the text');
  await page.evaluate(function () { window.MindRoot.editor.startRename('2'); });
  await page.keyboard.press('Shift+Enter');
  t.eq((await E.fields(page)).focus, 'body', 'in the text field');
  await page.keyboard.type('a caption');
  await page.keyboard.press('ArrowUp');
  t.eq((await E.fields(page)).focus, 'title', 'Up from the first line goes back to the title');
  await page.keyboard.press('Escape');

  t.step('emptying the title promotes the text');
  await page.evaluate(function () { window.MindRoot.editor.startRename('1'); });
  await page.evaluate(function () {
    var el = document.querySelector('.mv-edit--title');
    el.textContent = '';
  });
  await page.keyboard.press('Enter');
  t.check('the text became the line, its breaks folded', /\n- under beta second line\n/.test(await E.text(page)), await E.text(page));
  t.check('nobody is called untitled', !/untitled/i.test(await E.text(page)));
  await page.keyboard.press('Control+z');
  t.check('one undo brings both back', /\n- Beta two\n {2}- > text: under beta\n {4}> second line\n/.test(await E.text(page)), await E.text(page));

  t.step('Tab saves and adds a child');
  await E.select(page, '1');
  steps = (await E.history(page)).count;
  await page.keyboard.press('F2');
  await page.keyboard.type('!');
  await page.keyboard.press('Tab');
  f = await E.fields(page);
  t.same([f.title, f.chosen], ['New node', 'New node'], 'a child open for typing');
  h = await E.history(page);
  t.same([h.count - steps, h.key], [2, 'editor.label.addChild'], 'the rename and the new child: two steps');
  t.check('renamed first', /\n- Beta two!\n/.test(await E.text(page)), await E.text(page));
  steps = h.count;
  await page.keyboard.press('Enter');
  t.eq((await E.history(page)).count, steps, 'Enter on the untouched placeholder writes nothing more');
  await page.keyboard.press('Delete');

  t.step('paste is plain text');
  await page.evaluate(function () { window.MindRoot.editor.startRename('2'); });
  await page.evaluate(function () {
    var el = document.querySelector('.mv-edit--title');
    var dt = new DataTransfer();
    dt.setData('text/html', '<b>Rich</b> <i>stuff</i>');
    dt.setData('text/plain', 'Rich\nstuff');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  f = await E.fields(page);
  t.eq(f.title, 'PicturedRich stuff', 'the plain words, the line break folded in a title');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-edit--title').querySelectorAll('*').length; }), 0, 'no markup came in');
  await page.keyboard.press('Escape');

  t.step('the browser\'s own bold never gets in; Ctrl+B writes the mark');
  steps = (await E.history(page)).count;
  await page.evaluate(function () { window.MindRoot.editor.startRename('1'); });
  t.same(await fmt(page, 'bold'), { shown: true, disabled: true, pressed: 'false' }, 'B is there but off until words are chosen');
  await chooseWords(page, 'title', 0, 4);
  await E.until(page, function () { return document.querySelector('.format-bar [data-format="bold"]').getAttribute('aria-disabled') !== 'true'; });
  t.same(await fmt(page, 'bold'), { shown: true, disabled: false, pressed: 'false' }, 'choosing words turns it on');
  await page.keyboard.press('Control+b');
  f = await E.fields(page);
  t.same([f.title, f.chosen], ['**Beta** two!', 'Beta'], 'Ctrl+B writes the mark around the choice, which stays chosen');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-edit--title').querySelectorAll('b, strong').length; }), 0, 'no <b> element');
  t.eq((await fmt(page, 'bold')).pressed, 'true', 'B shows pressed on the choice');
  await pressFmt(page, 'bold');
  t.eq((await E.fields(page)).title, 'Beta two!', 'pressing it again takes the mark off');
  t.eq(await E.renaming(page) !== null, true, 'and the writing goes on');
  await page.keyboard.press('Control+u');
  t.eq((await E.fields(page)).title, '<u>Beta</u> two!', 'Ctrl+U underlines in HTML');
  await page.keyboard.press('Control+i');
  t.check('Ctrl+I adds italics', /\*<u>Beta<\/u>\*|<u>\*Beta\*<\/u>/.test((await E.fields(page)).title), (await E.fields(page)).title);
  await pressFmt(page, 'clear');
  t.eq((await E.fields(page)).title, 'Beta two!', 'clear takes every mark around the choice off');
  await pressFmt(page, 'strike');
  t.eq((await E.fields(page)).title, '~~Beta~~ two!', 'strike');
  t.eq((await fmt(page, 'strike')).pressed, 'true', 'shown pressed');
  await pressFmt(page, 'strike');
  t.eq((await E.fields(page)).title, 'Beta two!', 'and off again');
  t.eq((await E.history(page)).count, steps, 'marks write nothing until the rename is saved');

  t.step('sizes for the title, merged with what was typed');
  await page.keyboard.press('End');
  await page.keyboard.type(' x');
  steps = (await E.history(page)).count;
  t.same(await fmt(page, 'size'), { shown: true, disabled: false, pressed: null }, 'the size menu is offered on the title');
  t.eq((await fmt(page, 'role')).shown, false, 'the text styles are not');
  await pressFmt(page, 'size');
  await pickMenu(page, 'Heading 2');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('the size is written at the end of the line, with the typing', /\n- Beta two! x <!-- title: h2 -->\n/.test(await E.text(page)), await E.text(page));
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.format'], 'one step for both: format the node');
  f = await E.fields(page);
  t.same([f.title, f.focus], ['Beta two! x', 'title'], 'the writing goes on, the marker not in the field');
  t.eq(await page.evaluate(function () { return document.querySelector('.mv-node[data-path="1"]').classList.contains('mv-h2'); }), true, 'drawn at that size while writing');
  await pressFmt(page, 'size');
  await pickMenu(page, 'Heading 2');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('choosing the size it has goes back to normal', /\n- Beta two! x\n/.test(await E.text(page)), await E.text(page));
  await pressFmt(page, 'size');
  await pickMenu(page, 'Caption');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('caption', /\n- Beta two! x <!-- role: caption -->\n/.test(await E.text(page)), await E.text(page));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  t.check('undo from the map takes the caption back', /\n- Beta two! x\n/.test(await E.text(page)), await E.text(page));

  t.step('styles for the text under the title');
  await page.evaluate(function () { window.MindRoot.editor.startRename('1', { field: 'body' }); });
  t.eq((await fmt(page, 'role')).shown, true, 'in the text: its styles');
  t.eq((await fmt(page, 'size')).shown, false, 'not the sizes');
  await pressFmt(page, 'role');
  await pickMenu(page, 'Subtitle');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('written on the text', /- > text: under beta <!-- role: subtitle -->/.test(await E.text(page)), await E.text(page));
  t.eq((await E.fields(page)).focus, 'body', 'and the caret back in the text');
  await page.keyboard.press('Enter');

  t.step('pictures: placed and taken out from the bar');
  await page.evaluate(function () { window.MindRoot.editor.startRename('2'); });
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-node[data-path="2"] img.mv-img'); }), true, 'the picture stays in the node while writing');
  t.eq((await E.fields(page)).title, 'Pictured', 'the field holds only the words');
  t.eq((await fmt(page, 'picture')).shown, true, 'the picture menu is offered');
  await pressFmt(page, 'picture');
  await pickMenu(page, 'Picture on the right');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('the picture moves to the end of the line', /\n- Pictured !\[\]\(assets\/pic\.png\)\n/.test(await E.text(page)), await E.text(page));
  steps = (await E.history(page)).count;
  await pressFmt(page, 'picture');
  await pickMenu(page, 'Take the picture out');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('out of the line', /\n- Pictured\n/.test(await E.text(page)), await E.text(page));
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'store.label.takePictureOut'], 'one step');
  var fig = await page.evaluate(function (pid) { return window.MindRoot.store.project(pid).trash.filter(function (e) { return e.kind === 'figure'; }).map(function (e) { return e.path + '|' + e.owner; }); }, s.pid);
  t.same(fig, ['assets/pic.png|Pictured'], 'the file goes to the trash, saying whose it was');
  /* With the media module there the menu still offers to add a picture or
   * draw; what must be gone is everything about the picture taken out. */
  var media = await page.evaluate(function () { return !!(window.MindRoot.media && window.MindRoot.media.pickImages); });
  var after = { shown: (await fmt(page, 'picture')).shown, items: [] };
  if (after.shown) {
    await pressFmt(page, 'picture');
    await page.waitForSelector('.menu:not([hidden]) .menu__item', { timeout: 4000 });
    after.items = await page.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__item .menu__label'), function (n) { return n.textContent; });
    });
    await page.keyboard.press('Escape');
    await E.until(page, function () { return !document.querySelector('.menu:not([hidden])'); });
  }
  t.same(after.items.filter(function (l) { return /^Picture (on the|above)|^Take the picture out$/.test(l); }), [], 'nothing left to place or take out');
  t.eq(after.shown, media, media ? 'the menu stays for adding a picture' : 'no menu without the media module');
  if (media) t.check('adding is offered', after.items.indexOf('Add a picture') >= 0, after.items.join(', '));
  t.eq(!!(await E.renaming(page)), true, 'the menu closed by Escape leaves the writing open');
  if (media) {
    /* A menu of the bar closed without a choice gives the keyboard back to
     * the words, where the caret was. */
    await E.until(page, function () { return document.activeElement && document.activeElement.classList.contains('mv-edit--title'); });
    t.eq((await E.fields(page)).focus, 'title', 'the menu closed by Escape goes back to the words');
  }
  await page.keyboard.press('Escape');
  t.eq(await E.renaming(page), null, 'Escape in the words ends the writing');
  await page.keyboard.press('Control+z');
  t.check('one undo puts it back', /\n- Pictured !\[\]\(assets\/pic\.png\)\n/.test(await E.text(page)), await E.text(page));

  t.step('the bar can be sent away and comes back with a choice; Done saves');
  await page.evaluate(function () { window.MindRoot.editor.startRename('0'); });
  await pressFmt(page, 'hide');
  t.eq(await E.visible(page, '.format-bar'), false, 'hidden');
  await page.keyboard.type('!');
  t.eq(await E.visible(page, '.format-bar'), false, 'typing does not bring it back');
  await chooseWords(page, 'title', 0, 5);
  await E.until(page, function () { var b = document.querySelector('.format-bar'); return b && !b.hidden; });
  t.check('choosing words does', true);
  await pressFmt(page, 'done');
  t.eq(await E.renaming(page), null, 'Done saves and closes');
  t.check('saved', /\n- Alpha \*\*bold\*\*!\n/.test(await E.text(page)), await E.text(page));

  t.step('Ctrl+S saves what is being typed, and the writing goes on');
  await page.evaluate(function () { window.MindRoot.editor.startRename('0'); });
  await page.keyboard.type('?');
  await page.keyboard.press('Control+s');
  await E.until(page, function () { return /- Alpha \*\*bold\*\*!\?\n/.test(window.MindRoot.session.current().text); });
  t.check('written', true);
  t.eq((await E.renaming(page) || {}).path, '0', 'still writing');
  t.eq((await E.fields(page)).focus, 'title', 'in the title');
  await page.keyboard.press('Escape');

  t.step('the keyboard reaches the format bar: Alt+F10, and Escape back');
  await page.evaluate(function () { window.MindRoot.editor.startRename('1'); });
  await page.keyboard.press('Home');
  await page.keyboard.press('Alt+F10');
  t.eq(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.closest('.format-bar')); }), true, 'the focus is on the bar');
  t.eq(await E.renaming(page) !== null, true, 'and the writing goes on');
  await page.keyboard.press('ArrowRight');
  t.eq(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.closest('.format-bar')); }), true, 'the arrows move along the bar');
  await page.keyboard.press('Escape');
  var back = await E.fields(page);
  t.eq(back.focus, 'title', 'Escape brings the keyboard back to the words');
  await page.keyboard.type('>');
  t.eq((await E.fields(page)).title.charAt(0), '>', 'with the caret where it was');
  await page.keyboard.press('Escape');

  t.step('free text the node carries stays in sight while writing');
  var delta = await E.pathOf(page, 'Delta');
  await page.evaluate(function (p) { window.MindRoot.editor.startRename(p, { field: 'body' }); }, delta);
  t.eq(await page.evaluate(function () { var x = document.querySelector('.mv-edit-prose'); return x && x.textContent; }), 'A paragraph of free text.', 'shown under the field');
  t.eq((await E.fields(page)).body, '', 'and not written in it');
  await page.keyboard.type('quoted words');
  await page.keyboard.press('Control+Enter');
  t.check('the words go in as the node\'s text, the paragraph untouched',
    /- Delta\n {2}- > text: quoted words\n\n {2}A paragraph of free text\.\n/.test(await E.text(page)), await E.text(page));
  t.eq(await page.evaluate(function () { return document.querySelectorAll('.mv-edit-prose').length; }), 0, 'gone when the writing ends');

  t.step('the format bar keeps a gap from the node it formats');
  await E.select(page, '0');
  await page.evaluate(function () { window.MindRoot.editor.startRename('0'); });
  await E.until(page, function () { var b = document.querySelector('.format-bar'); return b && !b.hidden; });
  var gap = await E.tokenPx(page, '.format-bar', '--bar-gap');
  var fbr = await E.rectOf(page, '.format-bar');
  var nb = await E.box(page, '0');
  var side = await page.evaluate(function () { return document.querySelector('.format-bar').getAttribute('data-side'); });
  t.check('a gap of --bar-gap between bar and node', side === 'bottom' ? fbr.y >= nb.bottom + gap - 1 : fbr.bottom <= nb.y - gap + 1, { bar: fbr, node: nb, gap: gap, side: side });
  await page.keyboard.press('Escape');

  t.step('F2 on a selected node the map was panned away from brings it back in sight');
  await E.select(page, '1');
  await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var c = v.camera();
    v.setCamera({ x: c.x - 3000, y: c.y, k: c.k });
  });
  await E.settled(page);
  var stageBox = await E.rectOf(page, '#stage');
  var off = await E.box(page, '1');
  t.check('panned off the stage', !off || off.x > stageBox.right || off.right < stageBox.x, { node: off, stage: stageBox });
  await page.keyboard.press('F2');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  var on = await E.box(page, '1');
  t.check('the node is on the stage while it is written', on && on.x >= stageBox.x && on.right <= stageBox.right && on.y >= stageBox.y && on.bottom <= stageBox.bottom, { node: on, stage: stageBox });
  t.eq((await E.fields(page)).focus, 'title', 'with the caret in its title');
  await page.keyboard.press('Escape');

  t.step('Ctrl+Z in the field takes back the run just typed, not one letter');
  await E.select(page, '1');
  var was1 = await page.evaluate(function () { var c = window.MindRoot.session.current(); return window.MindRoot.doc.plainText(c.state.byPath['1']); });
  await page.keyboard.press('F2');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  await page.keyboard.press('End');
  await page.keyboard.type(' changed here', { delay: 40 });
  t.eq((await E.fields(page)).title, was1 + ' changed here', 'typed');
  await page.keyboard.press('Control+z');
  t.eq((await E.fields(page)).title, was1, 'one Ctrl+Z: the whole run is gone');
  await page.keyboard.press('Control+Shift+z');
  t.eq((await E.fields(page)).title, was1 + ' changed here', 'Ctrl+Shift+Z brings it back');
  await page.keyboard.press('Escape');

  t.step('another map opening ends the writing');
  await page.evaluate(function () { window.MindRoot.editor.startRename('0'); });
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.mids[1]); }, { pid: s.pid, mids: s.mids });
  await E.until(page, function (m) { return window.MindRoot.session.current().mapId === m; }, s.mids[1]);
  t.eq(await E.renaming(page), null, 'no writing left open on a map that is gone');
  t.eq(await E.visible(page, '.format-bar'), false, 'nor its bar');
};
