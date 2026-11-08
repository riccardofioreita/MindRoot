/* notes: the note bubble and the "every note open" cards. A dot opens its
 * note without selecting the node; Enter breaks a line, Ctrl+Enter saves,
 * Esc cancels, the X saves, a tap outside saves, an emptied note is
 * deleted, the bin deletes with an Undo toast; each write one undo step.
 * The bubble sits by its node, can be carried and resized (the size is
 * remembered); edge notes need a parent link; every note open shows cards
 * that do not cover one another and open the bubble; view-only reads. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- Alpha\n  - > note: remember this\n- Beta\n  - > edge: depends on it\n  - B1\n    - > edge: the first of two links with a long note that wraps over several lines\n  - B2\n    - > edge: the second of two links with a long note that wraps over several lines\n- Gamma\n';

function bubble(page) {
  return page.evaluate(function () {
    var el = document.querySelector('.note-bubble');
    if (!el || el.hidden) return null;
    var r = el.getBoundingClientRect();
    var ta = el.querySelector('textarea');
    return {
      x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, right: r.right,
      title: el.querySelector('.note-bubble__title').textContent,
      text: ta.value, focused: document.activeElement === ta, readOnly: ta.readOnly,
      del: !el.querySelector('.note-bubble__delete').hidden
    };
  });
}

async function openDot(page, selector) {
  await E.settled(page);
  var r = await E.rectOf(page, selector);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await E.until(page, function () { var el = document.querySelector('.note-bubble'); return el && !el.hidden; });
  await E.resting(page, '.note-bubble');
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Notes', MAP]]);
  var page = s.page;
  var start = await E.text(page);

  t.step('a dot opens its note, without selecting the node');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('.mv-node[data-path="0"] .mv-note-dot').length; }), 1, 'a dot inside the node with a note');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('.mv-edge-dot').length; }), 3, 'a dot on each link with a note');
  await openDot(page, '.mv-node[data-path="0"] .mv-note-dot');
  var b = await bubble(page);
  t.same([b.title, b.text, b.focused, b.readOnly], ['Note', 'remember this', true, false], 'the note in the bubble, ready to write');
  t.eq(await E.selected(page), null, 'the node is not selected');
  var n = await E.box(page, '0');
  var gap = await E.tokenPx(page, '.note-bubble', '--note-gap');
  var margin = await E.tokenPx(page, '.note-bubble', '--bar-margin');
  t.check('the tokens resolve to real lengths', gap >= 8 && margin >= 4, { gap: gap, margin: margin });
  t.check('the bubble stands by its node, a gap clear of it', b.bottom <= n.y - gap + 1 || b.y >= n.bottom + gap - 1, { bubble: b, node: n, gap: gap });
  t.check('and close by', Math.min(Math.abs(n.y - b.bottom), Math.abs(b.y - n.bottom)) <= gap + 1, { bubble: b, node: n, gap: gap });
  var st0 = await E.rectOf(page, '#stage');
  t.check('a margin inside the stage', b.x >= st0.x + margin - 1 && b.right <= st0.right - margin + 1 && b.y >= st0.y + margin - 1, { bubble: b, stage: st0, margin: margin });

  t.step('Enter breaks the line; Ctrl+Enter saves');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and this');
  t.eq((await bubble(page)).text, 'remember this\nand this', 'a new line, the bubble still open');
  var steps = (await E.history(page)).count;
  await page.keyboard.press('Control+Enter');
  t.eq(await bubble(page), null, 'closed');
  t.check('written as a quote, one line per line', /- Alpha\n {2}- > note: remember this\n {4}> and this\n/.test(await E.text(page)), await E.text(page));
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'notes.label.write'], 'one step: write a note');
  await page.keyboard.press('Control+z');
  t.eq(await E.text(page), start, 'undo takes it back');

  t.step('Escape cancels; the X saves; a tap outside saves');
  await openDot(page, '.mv-node[data-path="0"] .mv-note-dot');
  await page.keyboard.type(' not kept');
  await page.keyboard.press('Escape');
  t.eq(await bubble(page), null, 'Escape closes');
  t.eq(await E.text(page), start, 'and writes nothing');
  await openDot(page, '.mv-node[data-path="0"] .mv-note-dot');
  await page.keyboard.type(' kept');
  await page.click('.note-bubble__close');
  t.check('the X saves', /- > note: remember this kept\n/.test(await E.text(page)), await E.text(page));
  await openDot(page, '.mv-node[data-path="0"] .mv-note-dot');
  await page.keyboard.type('!');
  var stage = await E.rectOf(page, '#stage');
  await page.mouse.click(stage.x + 20, stage.bottom - 30);
  t.eq(await bubble(page), null, 'a tap outside closes');
  t.check('and saves', /- > note: remember this kept!\n/.test(await E.text(page)), await E.text(page));

  t.step('an edge note');
  await openDot(page, '.mv-edge-dot[data-path="1"]');
  b = await bubble(page);
  t.same([b.title, b.text], ['Note on the link', 'depends on it'], 'its own title and text');
  await page.keyboard.press('Escape');

  t.step('the bin deletes, with an Undo toast; an emptied note is deleted too');
  await openDot(page, '.mv-edge-dot[data-path="1"]');
  steps = (await E.history(page)).count;
  await page.click('.note-bubble__delete');
  t.eq(await bubble(page), null, 'closed');
  t.check('gone from the file', !/depends on it/.test(await E.text(page)), await E.text(page));
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'notes.label.delete'], 'one step: delete the note');
  await E.until(page, function () { var x = document.querySelector('.toast:not([hidden])'); return x && /note is in the trash/.test(x.textContent); });
  await page.click('.toast:not([hidden]) .toast__action');
  await E.until(page, function () { return /depends on it/.test(window.MindRoot.session.current().text); });
  t.check('Undo in the toast brings it back', true);
  await openDot(page, '.mv-edge-dot[data-path="1"]');
  await page.evaluate(function () { var ta = document.querySelector('.note-bubble textarea'); ta.value = ''; });
  await page.keyboard.press('Control+Enter');
  t.check('saving it empty deletes it', !/depends on it/.test(await E.text(page)), await E.text(page));
  await page.keyboard.press('Control+z');

  t.step('a new note from the toolbar');
  var gamma = await E.pathOf(page, 'Gamma');
  await E.select(page, gamma);
  await page.click('.node-toolbar [data-command="node.note"]');
  b = await bubble(page);
  t.same([b.text, b.focused, b.del], ['', true, false], 'an empty bubble, nothing to delete yet');
  t.eq(await page.evaluate(function () { return document.querySelector('.note-bubble textarea').placeholder; }), 'Write the note', 'with its prompt');
  t.eq(await E.visible(page, '.node-toolbar'), false, 'the toolbar steps aside');
  await page.keyboard.type('fresh');
  await page.keyboard.press('Control+Enter');
  t.check('written under the node', /- Gamma\n {2}- > note: fresh\n/.test(await E.text(page)), await E.text(page));
  await E.select(page, '');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('node.edgeNote', { source: 'menu' }); }), false, 'no edge note on the root');
  t.eq(await page.evaluate(function () { return window.MindRoot.notes.open('', 'edge'); }), false, 'and none can be opened');

  t.step('the bubble can be resized and carried');
  await openDot(page, '.mv-node[data-path="0"] .mv-note-dot');
  b = await bubble(page);
  var corner = await E.rectOf(page, '.note-bubble__resize');
  await page.mouse.move(corner.x + corner.w / 2, corner.y + corner.h / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 80, corner.y + 60, { steps: 5 });
  await page.mouse.up();
  var bigger = await bubble(page);
  t.check('bigger', bigger.w > b.w + 60 && bigger.h > b.h + 40, { before: b, after: bigger });
  t.same(await page.evaluate(function () { return window.MindRoot.prefs.get('noteSize'); }), { w: Math.round(bigger.w), h: Math.round(bigger.h) }, 'the size is remembered');
  t.eq(bigger.focused, true, 'the text keeps the keyboard');
  corner = await E.rectOf(page, '.note-bubble__resize');
  await page.mouse.move(corner.x + corner.w / 2, corner.y + corner.h / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x - 600, corner.y - 600, { steps: 5 });
  await page.mouse.up();
  var small = await bubble(page);
  var minW = await E.tokenPx(page, '.note-bubble', '--note-min-w');
  var minH = await E.tokenPx(page, '.note-bubble', '--note-min-h');
  t.check('never smaller than its minimum', small.w >= minW - 1 && small.h >= minH - 1 && small.w <= minW + 1, { small: small, minW: minW, minH: minH });
  var cornerNow = await E.rectOf(page, '.note-bubble__resize');
  await page.mouse.dblclick(cornerNow.x + cornerNow.w / 2, cornerNow.y + cornerNow.h / 2);
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('noteSize'); }), null, 'a double click goes back to the usual size');
  var grip = await E.rectOf(page, '.note-bubble .bar-grip');
  await page.mouse.move(grip.x + grip.w / 2, grip.y + grip.h / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 100, grip.y + 90, { steps: 6 });
  await page.mouse.up();
  t.eq(await page.evaluate(function () { return document.querySelector('.note-bubble').getAttribute('data-moved'); }), 'true', 'carried by its grip');
  t.eq((await bubble(page)) !== null, true, 'still open');
  await page.keyboard.press('Escape');

  t.step('every note open: cards that open the bubble and do not cover one another');
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  await page.keyboard.press('Control+Shift+B');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('notesOpen'); }), true, 'Ctrl+Shift+B keeps every note open');
  await E.until(page, function () { return document.querySelectorAll('.mv-card').length >= 5; });
  await E.settled(page);
  /* Nobody asks for a restack: the cards must sort themselves out once
   * they are drawn. */
  await E.until(page, function () {
    var rs = Array.prototype.map.call(document.querySelectorAll('.mv-card--edge'), function (c) { return c.getBoundingClientRect(); });
    for (var i = 0; i < rs.length; i++) {
      for (var j = i + 1; j < rs.length; j++) {
        var a = rs[i], c = rs[j];
        if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) return false;
      }
    }
    return rs.length === 3;
  }, null, 4000);
  var cards = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.mv-card--edge'), function (c) {
      var r = c.getBoundingClientRect();
      return { path: c.getAttribute('data-path'), x: r.left, y: r.top, right: r.right, bottom: r.bottom, text: c.textContent };
    });
  });
  t.eq(cards.length, 3, 'a card on each link with a note');
  var overlap = false;
  for (var i = 0; i < cards.length; i++) {
    for (var j = i + 1; j < cards.length; j++) {
      var a = cards[i], c = cards[j];
      if (a.x < c.right - 0.5 && c.x < a.right - 0.5 && a.y < c.bottom - 0.5 && c.y < a.bottom - 0.5) overlap = true;
    }
  }
  t.eq(overlap, false, 'the cards stack instead of covering one another');
  await page.evaluate(function () { window.MindRoot.session.select(null); });
  var card = await E.rectOf(page, '.mv-node[data-path="0"] .mv-card--node');
  await page.mouse.click(card.x + 10, card.y + card.h / 2);
  await E.until(page, function () { var el = document.querySelector('.note-bubble'); return el && !el.hidden; });
  t.eq((await bubble(page)).text, 'remember this kept!', 'a card opens its note');
  t.eq(await E.selected(page), null, 'without selecting the node');
  await page.keyboard.press('Escape');
  await page.evaluate(function () { window.MindRoot.commands.run('notes.toggleAll'); });
  await E.until(page, function () { return document.querySelectorAll('.mv-card').length === 0; });
  t.check('and they close again', true);

  t.step('view-only: notes are read, not written');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await E.until(page, function () { return window.MindRoot.session.readOnly(); });
  await E.settled(page);
  await openDot(page, '.mv-node[data-path="0"] .mv-note-dot');
  b = await bubble(page);
  t.same([b.text, b.readOnly, b.del], ['remember this kept!', true, false], 'shown read-only, no bin');
  var closeLabel = function () { return page.evaluate(function () { return document.querySelector('.note-bubble__close').getAttribute('aria-label'); }); };
  t.eq(await closeLabel(), 'Close', 'its X only closes, and says so');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('it'); });
  t.eq(await closeLabel(), 'Chiudi', 'in another language it still only closes');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('en'); });
  t.eq(await closeLabel(), 'Close', 'and back');
  await page.keyboard.press('Escape');
  t.eq(await page.evaluate(function (p) { return window.MindRoot.notes.open(p, 'node'); }, gamma.replace(/\d+$/, function (d) { return d; })), true, 'a node with a note opens');
  await page.keyboard.press('Escape');
  var beta = await E.pathOf(page, 'Beta');
  t.eq(await page.evaluate(function (p) { return window.MindRoot.notes.open(p, 'node'); }, beta), false, 'a node without one does not');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
};
