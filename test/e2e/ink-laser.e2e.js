/* ink-laser: the laser pointer of the pen. A button beside the pen (wide
 * layout) and an Ink | Laser choice in the pen's options: with the laser on
 * the pen leaves a red trail that fades within a second and draws nothing
 * (no element, nothing dirty, no undo step); another tool turns it off. */
'use strict';

module.exports = async function (t) {
  var page = t.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(t.fileUrl('test/fixtures/ink/host.html'));
  await page.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
  await page.evaluate(function () { window.mount({}); window.editor.setCamera({ x: 0, y: 0, k: 1 }); window.editor.setTool('select'); });
  function ev(fn) { return page.evaluate(fn); }
  async function stroke(y) {
    await page.mouse.move(300, y);
    await page.mouse.down();
    for (var i = 1; i <= 10; i++) await page.mouse.move(300 + i * 20, y + i * 3);
    return true;
  }

  t.step('the button takes the pen, with the laser');
  await page.click('.ink__laser-btn');
  t.eq(await ev(function () { return window.editor.tool() + ',' + document.querySelector('.ink').hasAttribute('data-laser') + ',' + document.querySelector('.ink__laser-btn').getAttribute('aria-pressed'); }), 'pen,true,true', 'pen in hand, laser on, the button pressed');

  t.step('a trail, and nothing drawn');
  await stroke(300);
  var mid = await ev(function () { var svg = document.querySelector('.ink__laser'); return !svg.hasAttribute('data-off') && !!svg.querySelector('.ink__laser-core').getAttribute('d'); });
  t.eq(mid, true, 'the trail is drawn while the pen moves');
  await page.mouse.up();
  t.eq(await ev(function () { return window.editor.scene().length + ',' + window.editor.isDirty() + ',' + window.editor.history().undo; }), '0,false,0', 'no element, nothing to save, no undo step');
  await page.waitForFunction(function () { return document.querySelector('.ink__laser').hasAttribute('data-off'); }, null, { timeout: 3000 });
  t.check('the trail fades away by itself', true);

  t.step('the pen\'s options: Ink | Laser');
  await page.click('.ink__tool[data-tool="pen"]');
  await page.waitForSelector('.ink__pop:not([hidden])');
  await page.click('.ink__pop [aria-label="Ink"]');
  t.eq(await ev(function () { return document.querySelector('.ink').hasAttribute('data-laser'); }), false, 'Ink turns the laser off');
  await page.keyboard.press('Escape');
  await stroke(450);
  await page.mouse.up();
  t.eq(await ev(function () { return window.editor.scene().length; }), 1, 'and the pen draws again');

  t.step('another tool turns it off');
  await page.click('.ink__laser-btn');
  t.eq(await ev(function () { return document.querySelector('.ink').hasAttribute('data-laser'); }), true, 'on again');
  await page.click('.ink__tool[data-tool="eraser"]');
  t.eq(await ev(function () { return document.querySelector('.ink').hasAttribute('data-laser') + ',' + document.querySelector('.ink__laser-btn').getAttribute('aria-pressed'); }), 'false,false', 'the eraser takes it off');
};
