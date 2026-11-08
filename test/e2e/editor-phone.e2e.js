/* editor-phone: editing with a finger on a 390 x 844 phone. No floating
 * node toolbar (a finger would cover it): the thumb bar carries add child,
 * add sibling and rename for the selection; the format bar docks above the
 * thumb bar while writing; a double tap renames; a long press opens the
 * node's menu as a bottom sheet, and moving after it lifts the node to be
 * dropped elsewhere (with a tick of haptics on Android); notes and the
 * colour picker are bottom sheets. Fingers come from the DevTools
 * protocol: real touch PointerEvents. */
'use strict';

var E = require('../fixtures/editor/helpers.js');
var Drop = require('../fixtures/map/drop.js');
var T = require('../fixtures/touch.js');

var MAP = '# Root\n\n- Alpha\n  - > note: remember\n- Beta\n- Gamma\n';
var ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

module.exports = async function (t) {
  var ctx = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: ANDROID });
  await E.H.stubMissing(ctx, t);
  var page = await ctx.newPage();
  var cdp = await ctx.newCDPSession(page);
  await page.addInitScript(function () {
    window.__buzz = [];
    navigator.vibrate = function (ms) { window.__buzz.push(ms); return true; };
  });
  var s = await E.boot(t, [['Phone', MAP]], { page: page });

  function touches(type, list) {
    return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: list.map(function (p) { return { x: p[0], y: p[1], id: p[2] || 1 }; }) });
  }
  async function tap(x, y) {
    await touches('touchStart', [[x, y]]);
    await touches('touchEnd', []);
  }
  /* Tapped where it rests: a sheet slides in, and a tap during the slide
   * lands where the button was a frame ago. */
  async function tapEl(selector) {
    await E.resting(page, selector);
    var r = await E.rectOf(page, selector);
    if (!r) throw new Error('nothing at ' + selector);
    await tap(r.x + r.w / 2, r.y + r.h / 2);
  }
  async function tapNode(path) {
    await E.settled(page);
    var b = await E.box(page, path);
    await tap(b.x + Math.min(14, b.w / 3), b.cy);
  }
  async function press(x, y, ms) {
    await touches('touchStart', [[x, y]]);
    await t.sleep(ms);
  }
  function thumb(id) {
    return page.evaluate(function (cmd) {
      var b = document.querySelector('#thumbbar [data-command="' + cmd + '"]');
      return b ? { on: b.getAttribute('aria-disabled') !== 'true', label: b.getAttribute('aria-label') } : null;
    }, id);
  }

  t.step('a phone: no floating toolbar, the thumb bar acts on the selection');
  t.eq(await page.evaluate(function () { return document.documentElement.getAttribute('data-layout'); }), 'compact', 'compact layout');
  await tapNode('1');
  await E.until(page, function () { return window.MindRoot.session.selected() === '1'; });
  await E.settled(page);
  t.eq(await E.visible(page, '.node-toolbar'), false, 'no toolbar floating by the node');
  t.same(await thumb('node.addChild'), { on: true, label: 'Add a child' }, 'add a child in the thumb bar');
  t.same(await thumb('node.addSibling'), { on: true, label: 'Add a sibling' }, 'add a sibling');
  t.same(await thumb('node.rename'), { on: true, label: 'Rename' }, 'rename');
  var stage = await E.rectOf(page, '#stage');
  await tap(stage.x + 20, stage.y + 140);
  await E.until(page, function () { return window.MindRoot.session.selected() === null; });
  await E.until(page, function () { var b = document.querySelector('#thumbbar [data-command="node.addChild"]'); return b && b.getAttribute('aria-disabled') === 'true'; });
  t.check('nothing selected: no child to add', true);
  t.eq((await thumb('node.addSibling')).label, 'Add a root', 'and the sibling button adds a root');

  t.step('the thumb bar adds a child, ready to type; the format bar docks above the thumb bar');
  await tapNode('1');
  await E.until(page, function () { var b = document.querySelector('#thumbbar [data-command="node.addChild"]'); return b && b.getAttribute('aria-disabled') !== 'true'; });
  await tapEl('#thumbbar [data-command="node.addChild"]');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  var f = await E.fields(page);
  t.same([f.focus, f.chosen], ['title', 'New node'], 'open and chosen, in the tap that asked');
  await E.until(page, function () { var b = document.querySelector('.format-bar'); return b && !b.hidden; });
  var fmt = await page.evaluate(function () {
    var b = document.querySelector('.format-bar');
    var r = b.getBoundingClientRect();
    var tb = document.getElementById('thumbbar').getBoundingClientRect();
    return { docked: b.hasAttribute('data-docked'), position: getComputedStyle(b).position, left: r.left, right: r.right, bottom: r.bottom, thumbTop: tb.top, hideShown: !b.querySelector('[data-format="hide"]').hidden };
  });
  t.same([fmt.docked, fmt.position], [true, 'fixed'], 'docked');
  t.check('above the thumb bar, inside the screen', fmt.bottom <= fmt.thumbTop && fmt.left >= 0 && fmt.right <= 390, fmt);
  t.eq(fmt.hideShown, false, 'no button to send it away on a phone');
  await page.keyboard.type('Beta kid');
  await tapEl('.format-bar [data-format="done"]');
  t.eq(await E.renaming(page), null, 'Done saves');
  t.check('written', /- Beta\n {2}- Beta kid\n/.test(await E.text(page)), await E.text(page));

  t.step('a double tap renames');
  await E.settled(page);
  var k0 = await page.evaluate(function () { return window.MindRoot.session.view.camera().k; });
  var b = await E.box(page, '2');
  /* On the hand's clock (fixtures/touch.js): sent as two plain taps, a
   * loaded runner can deliver the second one past the double-tap window. */
  await T.doubleTap(cdp, [b.x + 12, b.cy]);
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.eq((await E.renaming(page)).path, '2', 'the node opens for writing');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.camera().k; }), k0, 'and the map did not zoom');
  await page.keyboard.press('Escape');

  t.step('a long press opens the node menu as a sheet');
  await E.settled(page);
  b = await E.box(page, '2');
  await press(b.x + 12, b.cy, 650);
  await touches('touchEnd', []);
  await E.until(page, function () { return !!document.querySelector('dialog.sheet--menu[open]'); });
  await t.sleep(150);
  t.eq(await page.evaluate(function () { return !!document.querySelector('dialog.sheet--menu[open]'); }), true, 'lifting the finger does not choose a row');
  t.eq(await E.selected(page), '2', 'the node is selected');
  var labels = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('dialog.sheet--menu[open] .menu__label'), function (e) { return e.textContent; }); });
  t.check('its actions', labels.indexOf('Add a child') >= 0 && labels.indexOf('Delete the branch') >= 0, labels);
  var sheetLook = await page.evaluate(function () {
    var d = document.querySelector('dialog.sheet--menu[open]');
    var plain = getComputedStyle(d).backgroundColor;
    var lit = Array.prototype.filter.call(d.querySelectorAll('.menu__item'), function (it) {
      var bg = getComputedStyle(it).backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== plain;
    }).length;
    return { title: d.querySelector('.sheet__title').textContent, lit: lit };
  });
  t.same(sheetLook, { title: 'Gamma', lit: 0 }, 'the sheet names the node, and no row looks pressed before it is touched');
  await page.evaluate(function () {
    var items = document.querySelectorAll('dialog.sheet--menu[open] .menu__item');
    for (var i = 0; i < items.length; i++) if (items[i].textContent.indexOf('Add a sibling') === 0) { items[i].setAttribute('data-test-pick', ''); return; }
  });
  await tapEl('[data-test-pick]');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  t.check('the sheet acts on the node', /- Gamma\n- New node\n/.test(await E.text(page)), await E.text(page));
  await page.keyboard.press('Escape');
  t.check('Escape takes the new node back', !/New node/.test(await E.text(page)), await E.text(page));
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });

  t.step('a long press then a move lifts the node; dropped on another it becomes its child');
  await page.evaluate(function () { window.__buzz.length = 0; });
  await E.settled(page);
  var from = await E.box(page, '2');
  var onto = await E.box(page, '0');
  await press(from.x + 12, from.cy, 650);
  await touches('touchMove', [[from.x + 20, from.cy - 10]]);
  await touches('touchMove', [[from.x + 30, from.cy - 40]]);
  for (var i = 1; i <= 6; i++) await touches('touchMove', [[from.x + 12 + (onto.x + 14 - from.x - 12) * i / 6, from.cy + (onto.cy - from.cy) * i / 6]]);
  t.eq(await page.evaluate(function () { return !!document.querySelector('.mv-ghost'); }), true, 'lifted');
  t.eq(await page.evaluate(function () { return !!document.querySelector('dialog.sheet--menu[open]'); }), false, 'the menu the long press opened has closed');
  await Drop.decided(page);
  await touches('touchEnd', []);
  await E.settled(page);
  t.check('Gamma is a child of Alpha', /- Alpha\n {2}- > note: remember\n {2}- Gamma\n/.test(await E.text(page)), await E.text(page));
  t.eq((await E.history(page)).key, 'editor.label.move', 'one step: move the branch');
  t.same(await page.evaluate(function () { return window.__buzz; }), [10], 'a short tick when it lifted');

  t.step('a note is a bottom sheet');
  await page.evaluate(function () { window.MindRoot.session.view.center('0', { animate: false }); });
  await E.settled(page);
  await tapEl('.mv-node[data-path="0"] .mv-note-dot');
  await E.until(page, function () { return !!document.querySelector('dialog.note-sheet-dialog[open]'); });
  t.eq(await page.evaluate(function () { return document.querySelector('.note-sheet__text').value; }), 'remember', 'the note in the sheet');
  t.eq(await E.visible(page, '.note-bubble'), false, 'no floating bubble');
  await page.evaluate(function () { var ta = document.querySelector('.note-sheet__text'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  await page.keyboard.type(' this');
  await page.evaluate(function () {
    var btns = document.querySelectorAll('dialog.note-sheet-dialog[open] .sheet__foot .btn');
    for (var i = 0; i < btns.length; i++) if (btns[i].textContent === 'Save') { btns[i].setAttribute('data-test-save', ''); return; }
  });
  await tapEl('[data-test-save]');
  await E.until(page, function () { return !document.querySelector('dialog.note-sheet-dialog'); });
  t.check('Save writes it', /- > note: remember this\n/.test(await E.text(page)), await E.text(page));
  await E.settled(page);
  await tapEl('.mv-node[data-path="0"] .mv-note-dot');
  await E.until(page, function () { return !!document.querySelector('dialog.note-sheet-dialog[open]'); });
  await page.keyboard.type(' not kept');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('dialog.note-sheet-dialog[open]'); });
  t.check('Escape drops what was typed', /- > note: remember this\n/.test(await E.text(page)), await E.text(page));

  t.step('the colour picker is a bottom sheet');
  await E.select(page, '1');
  await page.evaluate(function () { window.MindRoot.commands.run('node.color', { source: 'menu' }); });
  await E.until(page, function () { return !!document.querySelector('dialog.colorpicker-sheet[open] .colorpicker'); });
  await tapEl('dialog.colorpicker-sheet[open] .cp-palette .cp-chip[data-hex="#4a7f8a"]');
  t.check('a tap on a swatch writes it', /- Beta <!-- color: #4a7f8a -->\n/.test(await E.text(page)), await E.text(page));
  var ring = await page.evaluate(function () {
    var c = document.querySelector('dialog.colorpicker-sheet[open] .cp-chip[aria-pressed="true"]');
    var body = c.closest('.sheet__body');
    var r = c.getBoundingClientRect();
    var b = body.getBoundingClientRect();
    return { room: Math.round(r.top - b.top), ring: 2 * parseFloat(getComputedStyle(c).getPropertyValue('--ed-ring')) };
  });
  t.check('the ring round the chosen colour has room above it in the sheet', ring.room >= ring.ring, ring);
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('dialog.colorpicker-sheet[open]'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.colorpicker.isOpen(); }), false, 'closed');
  t.eq(await page.evaluate(function () { var p = document.querySelector('.colorpicker'); return p.parentNode.id; }), 'floaters', 'the panel went back home');

  t.step('nodes added from the thumb bar are written above the docked format bar, and a long name wraps to the screen');
  async function editingClear() {
    return page.evaluate(function () {
      var n = document.querySelector('.mv-node--editing');
      var fb = document.querySelector('.format-bar[data-docked]:not([hidden])');
      if (!n || !fb) return { n: !!n, fb: !!fb };
      var r = n.getBoundingClientRect();
      return { clear: r.bottom <= fb.getBoundingClientRect().top + 0.5 && r.top >= 0, inside: r.left >= -0.5 && r.right <= window.innerWidth + 0.5 };
    });
  }
  await E.select(page, '2');
  for (var add = 0; add < 5; add++) {
    await tapEl('#thumbbar [data-command="node.addSibling"]');
    await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
    await page.keyboard.type('Sib ' + add);
    await page.waitForTimeout(120);
    t.same(await editingClear(), { clear: true, inside: true }, 'sibling ' + add + ': the node being written is above the format bar');
    await page.keyboard.press('Enter');
    await E.until(page, function () { return !window.MindRoot.editor.renaming(); });
  }
  await tapEl('#thumbbar [data-command="node.addChild"]');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  await page.keyboard.type('Tomatoes with a long name that must stay readable');
  await page.waitForTimeout(120);
  t.same(await editingClear(), { clear: true, inside: true }, 'a long name wraps inside the screen while it is written');
  await page.keyboard.press('Enter');
  await E.until(page, function () { return !window.MindRoot.editor.renaming(); });
  await E.settled(page);
  var after = await page.evaluate(function () { var v = window.MindRoot.session.view; var r = v.rect(v.selected()); return { left: r.left, right: r.right, w: window.innerWidth }; });
  t.check('and once written the whole node is in sight', after.left >= -0.5 && after.right <= after.w + 0.5, after);
};
