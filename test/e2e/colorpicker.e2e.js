/* colorpicker: the colour picker on the real app. The palette first, then the
 * colours picked lately, automatic, a random colour, the dice for new
 * nodes, and the custom colour (area, hue rail, hex and rgb fields that
 * take what is pasted, copy buttons). A drag previews in the panel and
 * gives its colour once, when the pointer comes off; keyboard steps in a
 * row are one undo step; Escape, a tap outside and another selection
 * close it. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- Alpha\n- Beta\n- Gamma\n';

function picker(page) {
  return page.evaluate(function () {
    var p = document.querySelector('.colorpicker');
    if (!p || p.hidden) return null;
    var pressed = p.querySelector('.cp-chip[aria-pressed="true"]');
    return {
      hex: p.querySelector('.cp-field[aria-label="Hex"]').value,
      rgb: p.querySelector('.cp-field[aria-label="RGB"]').value,
      pressed: pressed ? pressed.getAttribute('data-hex') : null,
      recent: Array.prototype.map.call(p.querySelectorAll('.cp-recent .cp-chip'), function (c) { return c.getAttribute('data-hex'); }),
      custom: !p.querySelector('.cp-custom').hidden,
      sample: p.querySelector('.colorpicker__sample').style.getPropertyValue('--chip')
    };
  });
}

function colorOf(page, words) {
  return page.evaluate(function (w) {
    var m = new RegExp('- ' + w + ' <!-- color: (#[0-9a-f]{6})( branch)? -->').exec(window.MindRoot.session.current().text);
    return m ? m[1] : null;
  }, words);
}

async function openPicker(page, path) {
  await E.select(page, path);
  await page.click('.node-toolbar [data-command="node.color"]');
  await E.until(page, function () { var p = document.querySelector('.colorpicker'); return p && !p.hidden; });
  await E.resting(page, '.colorpicker');
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Colour', MAP]]);
  var page = s.page;

  t.step('the palette first');
  await openPicker(page, '0');
  var p = await picker(page);
  t.eq(await page.evaluate(function () { return document.querySelectorAll('.colorpicker .cp-palette .cp-chip').length; }), 7, 'the seven branch colours');
  t.same([p.pressed, p.hex, p.rgb], ['#c2703d', '#c2703d', 'rgb(194, 112, 61)'], 'starting from the node\'s colour, as hex and rgb');
  t.same(p.recent, [], 'nothing picked lately yet');
  t.eq(await page.evaluate(function () { return document.querySelector('.cp-recent').hidden; }), true, 'so no recent row');
  t.eq(p.custom, false, 'the custom part folded away');
  var pk = await E.rectOf(page, '.colorpicker');
  var sw = await E.rectOf(page, '.node-toolbar [data-command="node.color"]');
  t.check('next to the swatch that opened it', Math.abs((pk.x + pk.w / 2) - (sw.x + sw.w / 2)) < 2 || pk.x <= 9 || pk.right >= 1271, { picker: pk, swatch: sw });
  t.eq(await page.evaluate(function () { return getComputedStyle(document.querySelector('.colorpicker')).backdropFilter; }), 'none', 'a solid surface, not glass');

  t.step('the custom colour: a drag gives its colour once');
  await page.click('.cp-custom-toggle');
  t.eq((await picker(page)).custom, true, 'unfolded');
  await E.resting(page, '.colorpicker');
  var steps = (await E.history(page)).count;
  var area = await E.resting(page, '.cp-area');
  await page.mouse.move(area.x + area.w * 0.2, area.y + area.h * 0.2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.w * 0.5, area.y + area.h * 0.4, { steps: 4 });
  var mid = await picker(page);
  t.eq((await E.history(page)).count, steps, 'nothing written while the pointer is down');
  t.check('but the panel shows it live', mid.sample !== '#c2703d' && mid.hex === mid.sample, mid);
  await page.mouse.move(area.x + area.w * 0.8, area.y + area.h * 0.3, { steps: 4 });
  await page.mouse.up();
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.color'], 'one step when it comes off');
  var picked = (await picker(page)).hex;
  t.eq(await colorOf(page, 'Alpha'), picked, 'the colour written is the one shown');
  /* Picks in a row in one opening of the picker are one step (the store
   * joins them); a new opening is a new step. */
  await page.keyboard.press('Escape');
  await openPicker(page, '0');
  t.eq((await picker(page)).custom, true, 'opened again on a custom colour: the custom part is open');
  var hue = await E.resting(page, '.cp-hue');
  steps = (await E.history(page)).count;
  await page.mouse.move(hue.x + hue.w * 0.1, hue.y + hue.h / 2);
  await page.mouse.down();
  await page.mouse.move(hue.x + hue.w * 0.6, hue.y + hue.h / 2, { steps: 6 });
  await page.mouse.up();
  t.eq((await E.history(page)).count - steps, 1, 'a hue drag: one step');
  var afterHue = (await picker(page)).hex;
  t.check('the hue moved', afterHue !== picked, [picked, afterHue]);

  t.step('arrow keys on the area and the rail, in a row, are one step');
  await page.keyboard.press('Escape');
  await openPicker(page, '0');
  await page.focus('.cp-hue');
  steps = (await E.history(page)).count;
  for (var i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.focus('.cp-area');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowLeft');
  t.eq((await E.history(page)).count - steps, 1, 'seven steps of the keys, one undo step');
  t.eq(await colorOf(page, 'Alpha'), (await picker(page)).hex, 'the last colour written');
  t.check('the area says where it is', /Saturation \d+%, brightness \d+%/.test(await page.evaluate(function () { return document.querySelector('.cp-area').getAttribute('aria-valuetext'); })));

  t.step('hex and rgb fields take what is typed or pasted');
  await page.click('.cp-field[aria-label="Hex"]', { clickCount: 3 });
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  t.eq(await colorOf(page, 'Alpha'), '#aabbcc', 'three hex digits');
  t.eq((await picker(page)).hex, '#aabbcc', 'written back in full');
  await page.click('.cp-field[aria-label="RGB"]', { clickCount: 3 });
  await page.keyboard.type('10 20 30');
  await page.keyboard.press('Enter');
  t.eq(await colorOf(page, 'Alpha'), '#0a141e', 'rgb numbers with spaces');
  await page.evaluate(function () {
    var f = document.querySelector('.cp-field[aria-label="Hex"]');
    f.focus();
    var dt = new DataTransfer();
    dt.setData('text/plain', 'hsl(150 45% 34%)');
    f.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  var hsl = await page.evaluate(function () { return window.MindRoot.colors.parseColor('hsl(150 45% 34%)'); });
  t.eq(await colorOf(page, 'Alpha'), hsl, 'an hsl() pasted into the hex field');
  var before = await E.text(page);
  await page.click('.cp-field[aria-label="Hex"]', { clickCount: 3 });
  await page.keyboard.type('zzz');
  await page.keyboard.press('Enter');
  t.eq(await E.text(page), before, 'not a colour: nothing written');
  t.eq(await page.evaluate(function () { return document.querySelector('.cp-field[aria-label="Hex"]').getAttribute('aria-invalid'); }), 'true', 'and the field says so');
  t.eq(await E.selected(page), '0', 'typing in the fields never reached the map');

  t.step('copy buttons');
  await page.click('.cp-copy');
  await E.until(page, function () { return document.querySelector('.cp-copy').hasAttribute('data-copied'); });
  t.eq(await page.evaluate(function () { return document.querySelector('.colorpicker [role="status"]').textContent; }), 'Copied', 'it says it copied');

  t.step('recent colours come back next time; automatic; random; the dice');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return document.querySelector('.colorpicker').hidden; });
  t.check('Escape closes', true);
  await openPicker(page, '1');
  p = await picker(page);
  t.check('the last colour of each opening is offered, newest first', p.recent.length === 3 && p.recent[0] === hsl, p.recent);
  t.check('palette colours are not repeated among them', p.recent.every(function (x) { return ['#2f7d5a', '#c2703d', '#3b6ea5', '#b4485f', '#5f8a3f', '#a8843f', '#4a7f8a'].indexOf(x) < 0; }), p.recent);
  await page.click('.cp-recent .cp-chip[data-hex="' + p.recent[1] + '"]');
  t.eq(await colorOf(page, 'Beta'), p.recent[1], 'a recent colour picked');
  await page.click('.colorpicker button:has-text("Random colour")');
  var rnd = await colorOf(page, 'Beta');
  t.check('a random colour written', /^#[0-9a-f]{6}$/.test(rnd) && rnd !== p.recent[1], rnd);
  t.eq(await page.evaluate(function () { return document.querySelector('.colorpicker .switch').getAttribute('aria-checked'); }), 'false', 'the dice for new nodes is up');
  await page.click('.colorpicker .switch');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); }), true, 'pressed down');
  await page.click('.colorpicker .switch');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('diceColors'); }), false, 'and up again');
  await page.click('.colorpicker button:has-text("Automatic")');
  t.check('automatic takes the node\'s colour off', /\n- Beta\n/.test(await E.text(page)), await E.text(page));

  t.step('the swatch that opened it closes it');
  await openPicker(page, '2');
  await page.click('.node-toolbar [data-command="node.color"]');
  await E.until(page, function () { return document.querySelector('.colorpicker').hidden; });
  t.eq(await page.evaluate(function () { return document.querySelector('.node-toolbar [data-command="node.color"]').getAttribute('aria-expanded'); }), 'false', 'and says so');

  t.step('a tap outside and another selection close it');
  await openPicker(page, '2');
  var stage = await E.rectOf(page, '#stage');
  await page.mouse.click(stage.x + 20, stage.bottom - 30);
  t.eq(await picker(page), null, 'a tap outside');
  await openPicker(page, '2');
  await page.evaluate(function () { window.MindRoot.session.select('1'); });
  await E.until(page, function () { return document.querySelector('.colorpicker').hidden; });
  t.check('another node chosen', true);

  t.step('from the context menu, at the node');
  var n = await E.box(page, '2');
  await page.mouse.click(n.x + 10, n.cy, { button: 'right' });
  await page.waitForSelector('.menu:not([hidden]) .menu__item');
  await page.evaluate(function () {
    var items = document.querySelectorAll('.menu:not([hidden]) .menu__item');
    for (var i = 0; i < items.length; i++) if (items[i].textContent.indexOf('Colour') >= 0) { items[i].click(); return; }
  });
  await E.until(page, function () { var p = document.querySelector('.colorpicker'); return p && !p.hidden; });
  var gamma = await page.evaluate(function () { var c = window.MindRoot.session.current(); return window.MindRoot.doc.colorFor(c.state, '2'); });
  t.eq((await picker(page)).pressed, gamma, 'on Gamma\'s colour');
  await page.click('.colorpicker .cp-palette .cp-chip[data-hex="#5f8a3f"]');
  t.eq(await colorOf(page, 'Gamma'), '#5f8a3f', 'written');
  t.eq(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.closest('.colorpicker')); }), true, 'a clicked swatch keeps the focus in the picker');
  await page.keyboard.press('Escape');

  t.step('keyboard only: a swatch chosen with Enter, then Tab, leaves the map alone');
  await E.select(page, '1');
  await page.evaluate(function () {
    /* The toolbar's colour button pressed from the keyboard. */
    var b = document.querySelector('.node-toolbar [data-command="node.color"]');
    b.focus();
  });
  await page.keyboard.press('Enter');
  await E.until(page, function () { var p = document.querySelector('.colorpicker'); return p && !p.hidden; });
  t.eq(await page.evaluate(function () { return document.activeElement.classList.contains('cp-chip'); }), true, 'the focus starts on a swatch');
  var textBefore = await E.text(page);
  await page.keyboard.press('ArrowRight');
  var target = await page.evaluate(function () { return document.activeElement.getAttribute('data-hex'); });
  await page.keyboard.press('Enter');
  t.eq(await colorOf(page, 'Beta'), target, 'the swatch the arrows reached is written');
  t.eq(await page.evaluate(function () { var a = document.activeElement; return a && a.getAttribute('data-hex'); }), target, 'the focus stays on that swatch');
  var afterPick = await E.text(page);
  await page.keyboard.press('Tab');
  t.eq(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.closest('.colorpicker')); }), true, 'Tab moves inside the picker');
  t.eq(await E.text(page), afterPick, 'and nothing happens to the map');
  t.eq(await E.renaming(page), null, 'no node opened for writing');
  t.check('the map changed only by the colour', afterPick !== textBefore);
  /* A recent swatch rebuilt under the focus keeps it too. */
  var rec = await page.evaluate(function () { var c = document.querySelector('.cp-recent .cp-chip'); return c ? c.getAttribute('data-hex') : null; });
  if (rec) {
    await page.focus('.cp-recent .cp-chip[data-hex="' + rec + '"]');
    await page.keyboard.press('Enter');
    t.eq(await page.evaluate(function () { var a = document.activeElement; return a && a.closest('.colorpicker') ? a.getAttribute('data-hex') : null; }), rec, 'a recent swatch picked keeps the focus on its colour');
  }
  await page.keyboard.press('Escape');
  await E.until(page, function () { return document.querySelector('.colorpicker').hidden; });

  t.step('view-only closes the picker; its dice cannot be changed there');
  await openPicker(page, '1');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await E.until(page, function () { return document.querySelector('.colorpicker').hidden; });
  t.eq(await page.evaluate(function () { return window.MindRoot.colorpicker.isOpen(); }), false, 'closed when view-only begins');
  var dice = await page.evaluate(function () {
    var before = !!window.MindRoot.prefs.get('diceColors');
    document.querySelector('.colorpicker .switch').click();
    return [before, !!window.MindRoot.prefs.get('diceColors')];
  });
  t.eq(dice[1], dice[0], 'the dice switch changes nothing in view-only');
  await page.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.readOnly(); }), false, 'editing again');

  t.step('Tab stays inside the open picker and the note; no key falls on the map');
  await E.select(page, '1');
  var before = await E.text(page);
  await page.evaluate(function () { window.MindRoot.commands.run('node.color', { source: 'menu' }); });
  await E.until(page, function () { var p = document.querySelector('.colorpicker'); return p && !p.hidden; });
  await page.evaluate(function () { var b = document.querySelector('.colorpicker .cp-chip'); b.focus(); });
  for (var tb = 0; tb < 14; tb++) await page.keyboard.press('Tab');
  t.eq(await page.evaluate(function () { return !!document.activeElement.closest('.colorpicker'); }), true, 'the keys are still in the picker');
  await page.keyboard.press('Escape');
  await page.evaluate(function () { window.MindRoot.commands.run('node.note', { source: 'menu' }); });
  await E.until(page, function () { return window.MindRoot.notes.isOpen(); });
  await page.keyboard.type('memo');
  for (var tn = 0; tn < 5; tn++) await page.keyboard.press('Tab');
  t.eq(await page.evaluate(function () { return !!document.activeElement.closest('.note-bubble, .note-sheet-dialog'); }), true, 'the keys are still in the note');
  await page.evaluate(function () { document.activeElement.blur(); });
  await page.keyboard.press('Delete');
  await page.keyboard.press('Tab');
  t.eq(await E.renaming(page), null, 'with the focus fallen on the page while the note is open, Tab adds nothing');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !window.MindRoot.notes.isOpen(); });
  t.check('and Delete deleted nothing', (await E.text(page)).indexOf('- Beta') >= 0 && before.indexOf('- Beta') >= 0, await E.text(page));
};
