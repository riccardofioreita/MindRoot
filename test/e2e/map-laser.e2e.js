/* map-laser: the laser pointer over the map (js/features/laser.js) and the
 * phone's quick capsule. The zoom capsule's button and Mod+Alt+L turn it on;
 * a mouse trails without a press and the map neither pans nor selects;
 * nothing becomes an undo step; Escape turns it off. On a phone the quick
 * capsule top right holds the Markdown, the AI chat and the laser, and a
 * finger drag leaves the trail. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

module.exports = async function (t) {
  var s = await E.boot(t, [['Laser', '# Root\n\n- One\n- Two\n']]);
  var page = s.page;
  function ev(fn) { return page.evaluate(fn); }

  t.step('the zoom capsule turns it on');
  var before = await E.history(page);
  var cam0 = await ev(function () { return JSON.stringify(window.MindRoot.session.view.camera()); });
  await page.click('#zoombar [data-command="view.laser"]');
  await page.waitForFunction(function () { return document.querySelector('#zoombar [data-command="view.laser"]').getAttribute('aria-pressed') === 'true'; }, null, { timeout: 2000 }).catch(function () {});
  t.eq(await ev(function () { return window.MindRoot.laser.isOn() + ',' + document.querySelector('#zoombar [data-command="view.laser"]').getAttribute('aria-pressed'); }), 'true,true', 'on, the button pressed');
  await page.mouse.move(400, 300);
  for (var i = 1; i <= 10; i++) await page.mouse.move(400 + i * 25, 300 + i * 8);
  t.eq(await ev(function () { var svg = document.querySelector('.map-laser__svg'); return !svg.hasAttribute('data-off') && !!svg.querySelector('.map-laser__core').getAttribute('d'); }), true, 'a mouse trails without a press');
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 6 });
  await page.mouse.up();
  t.eq(await ev(function () { return JSON.stringify(window.MindRoot.session.view.camera()); }), cam0, 'a drag does not pan the map');
  t.same(await E.history(page), before, 'nothing to undo');
  await page.waitForFunction(function () { return document.querySelector('.map-laser__svg').hasAttribute('data-off'); }, null, { timeout: 3000 });
  t.check('the trail fades by itself', true);

  t.step('Escape and the key');
  await page.keyboard.press('Escape');
  t.eq(await ev(function () { return window.MindRoot.laser.isOn() + ',' + !!document.querySelector('.map-laser'); }), 'false,false', 'Escape turns it off, the layer goes');
  await ev(function () { window.MindRoot.commands.run('view.laser', { source: 'key' }); });
  t.eq(await ev(function () { return window.MindRoot.laser.isOn(); }), true, 'the command turns it on again');
  await ev(function () { window.MindRoot.commands.run('view.laser', { source: 'key' }); });
  t.eq(await ev(function () { return window.MindRoot.laser.isOn(); }), false, 'and off');

  t.step('a phone: the quick capsule');
  var ctx = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  var phone = await ctx.newPage();
  await E.boot(t, [['Laser', '# Root\n\n- One\n- Two\n']], { page: phone });
  t.eq(await phone.evaluate(function () {
    var q = document.getElementById('topbar-quick');
    var r = q.getBoundingClientRect();
    return getComputedStyle(q.parentNode).display !== 'none' && r.top < 80 && r.right > innerWidth - 40 ? Array.prototype.map.call(q.querySelectorAll('button'), function (b) { return b.getAttribute('data-command'); }).join() : 'hidden';
  }), 'source.toggle,ai.chat,view.laser', 'Markdown, AI chat and laser at the top right');
  await phone.tap('#topbar-quick [data-command="source.toggle"]');
  await phone.waitForFunction(function () { return document.documentElement.getAttribute('data-source') === 'open'; }, null, { timeout: 5000 });
  t.check('one tap opens the Markdown', true);
};
