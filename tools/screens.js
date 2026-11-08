#!/usr/bin/env node
/* MindRoot - the screenshots of the README, taken from the real app.
 *
 *     node tools/screens.js            writes docs/screens/*.png
 *
 * Dark theme (the browser asks for it), English, a fresh database of its
 * own, the welcome project plus a small study map. The AI is played by a
 * stand-in (page.route): nothing leaves the machine, no key is real. Needs
 * Playwright (as the tests do). */
'use strict';

var path = require('path');
var fs = require('fs');
var chromium = require('playwright').chromium;

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'docs', 'screens');
var URL = 'file://' + path.join(ROOT, 'index.html');

var STUDY = [
  '# Photosynthesis',
  '',
  '## Light reactions <!-- color: #4fae82 branch -->',
  '- > text: In the thylakoids, light splits water and makes **ATP** and NADPH.',
  '- Photosystem II',
  '  - > text: Absorbs light at 680 nm.',
  '- Photosystem I',
  '- Oxygen released',
  '',
  '## Calvin cycle <!-- color: #d08a3c branch -->',
  '- Carbon fixation <!-- by: ai -->',
  '- Reduction <!-- by: ai -->',
  '- Regeneration of RuBP <!-- by: mixed -->',
  '',
  '## Factors <!-- side: left --> <!-- color: #7c8cf0 branch -->',
  '- Light intensity',
  '- CO2 concentration',
  '- Temperature',
  '  - > note: Enzymes slow down above 35 °C.',
  ''
].join('\n');

var ANSWER = 'Here is a map of the chapter you attached, one branch per stage.\n\n' +
  '```mindroot\n# Cell respiration\n- Glycolysis\n  - Glucose to pyruvate\n  - 2 ATP\n- Krebs cycle\n  - In the mitochondria\n- Electron transport chain\n  - Most of the ATP\n```';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  var browser = await chromium.launch();
  async function context(opts) {
    var ctx = await browser.newContext(Object.assign({ colorScheme: 'dark', locale: 'en-GB', deviceScaleFactor: 2 }, opts || {}));
    await ctx.route('https://api.anthropic.com/**', function (route) {
      var body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (err) { body = {}; }
      var sys = body.system || '';
      var text = /sub-branches/.test(sys) ? '["Chlorophyll","Stomata","Glucose"]' : (/assistant inside MindRoot/.test(sys) ? ANSWER : ' and the light reactions');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: text }] }) });
    });
    return ctx;
  }

  async function open(page, db) {
    await page.goto(URL + '?db=' + db + '&lang=en&welcome=1');
    await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; });
    await page.evaluate(function (study) {
      var ns = window.MindRoot;
      var p = ns.store.project();
      var m = ns.store.createMap(p.id, { name: 'Photosynthesis', text: study });
      ns.session.open(p.id, m.id);
    }, STUDY);
    await page.waitForTimeout(600);
    await page.evaluate(function () { return window.MindRoot.session.view.settled(); });
    await page.evaluate(function () { window.MindRoot.session.view.fit({ animate: false }); });
    await page.waitForTimeout(400);
  }

  async function shot(page, name) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  ' + name + '.png');
  }

  var ctx = await context({ viewport: { width: 1440, height: 900 } });
  var page = await ctx.newPage();
  await open(page, 'screens-desk');

  /* The map, clean. */
  await page.evaluate(function () { window.MindRoot.prefs.set('ai', { labels: false }); });
  await shot(page, 'map');

  /* The Markdown beside it. */
  await page.evaluate(function () { return window.MindRoot.commands.run('source.toggle', { source: 'palette' }); });
  await page.waitForTimeout(500);
  await shot(page, 'markdown');
  await page.evaluate(function () { return window.MindRoot.commands.run('source.toggle', { source: 'palette' }); });
  await page.waitForTimeout(300);

  /* Who wrote each node, and ghost branches beside the selected one. */
  await page.evaluate(function () {
    var ns = window.MindRoot;
    ns.ai.setKey('sk-demo', 'session');
    ns.prefs.set('ai', { provider: 'anthropic', labels: true, ghost: true, chat: true, chatScope: 'map', chatMap: true });
  });
  var leaf = await page.evaluate(function () {
    var c = window.MindRoot.session.current();
    var e = c.state.flat.filter(function (x) { return window.MindRoot.doc.plainText(x) === 'Oxygen released'; })[0];
    return e.path;
  });
  /* A leaf at the far right, the view moved left: the faint branches have room beside it. */
  await page.evaluate(function (p) { window.MindRoot.session.select(p, { reveal: false }); }, leaf);
  await page.evaluate(function () { var v = window.MindRoot.session.view; var c = v.camera(); v.setCamera({ x: c.x - 380, y: c.y, k: c.k }, { animate: false }); });
  await page.waitForSelector('.ai-sprouts:not([hidden]) .ai-sprout', { timeout: 8000 });
  await page.waitForTimeout(400);
  await shot(page, 'ai-labels-ghost');
  await page.keyboard.press('Escape');

  /* The chat, with a map proposed. */
  await page.evaluate(function () { return window.MindRoot.commands.run('ai.chat', { source: 'palette' }); });
  await page.waitForSelector('#aichat-box');
  await page.fill('#aichat-box', 'Make a study map of the chapter on cell respiration');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.aichat__proposal', { timeout: 8000 });
  await shot(page, 'ai-chat');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* The AI window. */
  await page.evaluate(function () { return window.MindRoot.commands.run('ai.open', { source: 'palette' }); });
  await page.waitForSelector('#ai-key');
  await page.evaluate(function () { var el = document.querySelector('#ai-chat'); if (el) el.scrollIntoView({ block: 'center' }); });
  await shot(page, 'ai-window');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* The board, with something drawn on it. */
  await page.evaluate(function () { window.MindRoot.notebook.showBoard(); });
  await page.waitForTimeout(1200);
  var stage = await page.evaluate(function () { var r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  async function stroke(points) {
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (var i = 1; i < points.length; i++) await page.mouse.move(points[i][0], points[i][1], { steps: 6 });
    await page.mouse.up();
  }
  var cx = stage.x + stage.w / 2;
  var cy = stage.y + stage.h / 2;
  var circle = [];
  for (var a = 0; a <= 32; a++) circle.push([cx - 160 + Math.cos(a / 32 * Math.PI * 2) * 90, cy + Math.sin(a / 32 * Math.PI * 2) * 70]);
  await stroke(circle);
  await stroke([[cx - 60, cy], [cx + 40, cy - 10], [cx + 120, cy - 40]]);
  var box = [[cx + 140, cy - 100], [cx + 330, cy - 100], [cx + 330, cy + 20], [cx + 140, cy + 20], [cx + 140, cy - 100]];
  await stroke(box);
  await stroke([[cx - 220, cy + 140], [cx - 120, cy + 120], [cx, cy + 150], [cx + 120, cy + 120], [cx + 240, cy + 150]]);
  await page.waitForTimeout(500);
  await shot(page, 'board');
  await ctx.close();

  /* A phone. */
  var phone = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  var pp = await phone.newPage();
  await open(pp, 'screens-phone');
  await pp.evaluate(function () { window.MindRoot.prefs.set('ai', { labels: false }); });
  /* Fitted whole, a map is tiny on a phone: closer, round its middle. */
  await pp.evaluate(function () {
    var v = window.MindRoot.session.view;
    var c = v.camera();
    var k = Math.min(1, c.k * 1.4);
    var r = v.el.getBoundingClientRect();
    var cx = r.width / 2;
    var cy = r.height / 2;
    v.setCamera({ x: cx - (cx - c.x) * (k / c.k), y: cy - (cy - c.y) * (k / c.k), k: k }, { animate: false });
  });
  await pp.waitForTimeout(500);
  await shot(pp, 'phone');
  await phone.close();

  await browser.close();
}

main().catch(function (err) { console.error(err); process.exit(1); });
