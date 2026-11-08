/* MindRoot - the AI's other two things for a node, on the real app, with the
 * providers played by stand-ins (nothing leaves the machine): an icon (an
 * emoji put in front of the title, replaced or taken off, one undo step) and
 * three pictures made for the node (only the description shown and edited is
 * sent; the one chosen goes into the node; a refusal is said with the
 * provider's own words); the sparkles on the node bar become a menu when
 * there is more than one thing to do. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

module.exports = async function (t) {
  var s = await E.boot(t, [['Garden', '# Garden\n\n## Beds\n- Roses\n- Basil\n']]);
  var page = s.page;
  var asked = [];
  var emojis = [['🌹', '🌸', '🌺', '🪻', '💐'], ['🌷', '🥀']];
  var round = 0;

  await page.route('https://api.anthropic.com/**', function (route) {
    var req = route.request();
    var body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (err) { body = {}; }
    asked.push({ url: req.url(), body: body });
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(emojis[Math.min(round++, emojis.length - 1)]) }] })
    });
  });
  await page.route('https://api.openai.com/**', function (route) {
    var req = route.request();
    var body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (err) { body = {}; }
    asked.push({ url: req.url(), body: body, headers: req.headers() });
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: [{ b64_json: PNG }, { b64_json: PNG }, { b64_json: PNG }] })
    });
  });

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function mapText() { return E.text(page); }
  function prefsSet(p) { return ev(function (v) { window.MindRoot.prefs.set('ai', v); }, p); }
  async function bar() {
    await E.until(page, function () { var b = document.querySelector('.node-toolbar [data-command="ai.menu"]'); return b && !b.hidden && b.offsetParent !== null; });
    await page.click('.node-toolbar [data-command="ai.menu"]');
  }

  var roses = await E.pathOf(page, 'Roses');

  /* ---------------------------------------------------------------- an icon */

  t.step('an icon: asked for, chosen, in front of the title, one undo step');
  await ev(function () { return window.MindRoot.ai.setKey('sk-ant-x', 'session'); });
  await prefsSet({ provider: 'anthropic', emoji: true });
  await E.select(page, roses);
  var h0 = await E.history(page);
  await bar();
  await page.waitForSelector('.ai-emoji__btn', { timeout: 8000 });
  t.eq(await page.locator('.ai-emoji__btn').count(), 5, 'five to choose from (one thing to do: no menu first)');
  t.eq(asked.length, 1, 'one request');
  t.eq(asked[0].body.messages[0].content.indexOf('Node: Roses') >= 0 && JSON.stringify(asked[0].body).indexOf('Basil') >= 0, true, 'about this node and its neighbours');
  await page.click('.ai-emoji__btn[data-emoji="🌹"]');
  await E.until(page, function () { return !document.querySelector('.ai-emoji'); });
  t.eq((await mapText()).indexOf('🌹 Roses') >= 0, true, 'the emoji is in front of the title');
  var h1 = await E.history(page);
  t.same([h1.count, h1.key], [h0.count + 1, 'ai.label.icon'], 'one undo step, named for it');

  t.step('another one replaces it; "No icon" takes it off');
  await E.select(page, roses);
  await bar();
  await page.waitForSelector('.ai-emoji__btn', { timeout: 8000 });
  t.eq(await page.locator('[data-ai="remove"]').count(), 1, 'a title that has an icon offers to drop it');
  await page.click('.ai-emoji__btn[data-emoji="🌷"]');
  await E.until(page, function () { return !document.querySelector('.ai-emoji'); });
  var txt = await mapText();
  t.eq(txt.indexOf('🌷 Roses') >= 0 && txt.indexOf('🌹') < 0, true, 'the second replaced the first, it did not pile up');
  await E.select(page, roses);
  await bar();
  await page.waitForSelector('[data-ai="remove"]', { timeout: 8000 });
  await page.click('[data-ai="remove"]');
  await E.until(page, function () { return !document.querySelector('.ai-panel'); });
  txt = await mapText();
  t.eq(txt.indexOf('🌷') < 0 && /- Roses\b/.test(txt), true, '"No icon": the plain title again');
  var h2 = await E.history(page);
  t.eq(h2.key, 'ai.label.noIcon', 'one step, named for it');

  /* ---------------------------------------------------------------- the pictures */

  t.step('pictures need OpenAI');
  await page.click('#topbar-actions [data-command="ai.open"]');
  await page.waitForSelector('#ai-images', { state: 'visible' });
  t.eq(await page.isDisabled('#ai-images'), true, 'with Anthropic the switch is off and cannot be turned on');
  await page.click('#ai-provider [data-value="openai"]');
  t.eq(await page.isDisabled('#ai-images'), false, 'with OpenAI it can');
  await page.click('#ai-images');
  await page.waitForSelector('#ai-image-model', { state: 'visible' });
  t.eq(await page.getAttribute('#ai-image-model', 'placeholder'), 'gpt-image-1', 'the picture model, with its default');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('#ai-key'); });
  await ev(function () { return window.MindRoot.ai.setKey('sk-openai-x', 'session'); });

  t.step('three pictures, from a description that can be read and changed');
  asked.length = 0;
  await E.select(page, roses);
  await bar();
  await page.waitForSelector('.node-menu, [role="menu"]', { timeout: 5000 }).catch(function () {});
  var items = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('[role="menuitem"]'), function (e) { return e.textContent.trim(); }); });
  t.same(items, ['Suggest an icon', 'Illustrate with pictures', 'AI settings…'], 'with two things to do, the sparkles open a menu of them, and of the AI window');
  await page.click('[role="menuitem"]:has-text("Illustrate")');
  await page.waitForSelector('#ai-images-text', { timeout: 8000 });
  var text = await page.inputValue('#ai-images-text');
  t.check('the description says the node and where it is', text.indexOf('Roses') >= 0 && text.indexOf('Beds') >= 0, text);
  t.eq(asked.length, 0, 'nothing is sent until "Make 3 pictures"');
  await page.fill('#ai-images-text', 'A single red rose, flat style, no text');
  await page.click('[data-ai="make"]');
  await page.waitForSelector('.ai-pic', { timeout: 8000 });
  t.eq(await page.locator('.ai-pic').count(), 3, 'three pictures');
  var sent = asked[0];
  t.same([sent.url, sent.body.model, sent.body.n, sent.body.prompt], ['https://api.openai.com/v1/images/generations', 'gpt-image-1', 3, 'A single red rose, flat style, no text'], 'only the description, as it was edited, went out');
  t.eq(sent.headers.authorization, 'Bearer sk-openai-x', 'with the key');
  t.eq(await page.isDisabled('[data-ai="use"]'), true, '"Use this one" waits for a choice');
  await page.click('.ai-pic[data-pic="1"]');
  t.eq(await page.getAttribute('.ai-pic[data-pic="1"]', 'aria-checked'), 'true', 'the second is chosen');
  var before = await mapText();
  await page.click('[data-ai="use"]');
  await E.until(page, function () { return !document.querySelector('.ai-pics'); });
  await E.until(page, function () { var c = window.MindRoot.session.current(); return /!\[[^\]]*\]\(assets\//.test(c.text); }, null, 10000);
  t.eq(/!\[[^\]]*\]\(assets\//.test(await mapText()) && (await mapText()) !== before, true, 'the picture is in the node (a file of the project)');

  t.step('a refusal is said, with the provider\'s own words');
  await ev(function () {
    window.__realFetch = window.fetch;
    window.fetch = function (u, i) {
      if (/api\.openai\.com\/v1\/images/.test(String(u))) return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Your organization must be verified to use the model gpt-image-1.' } }), { status: 403 }));
      return window.__realFetch.call(window, u, i);
    };
  });
  await E.select(page, roses);
  await bar();
  await page.click('[role="menuitem"]:has-text("Illustrate")');
  await page.waitForSelector('#ai-images-text', { timeout: 8000 });
  await page.click('[data-ai="make"]');
  await page.waitForSelector('.ai-panel__error', { timeout: 8000 });
  t.eq((await page.textContent('.ai-panel__error')).trim(), 'The provider refused the key.', 'the failure in words');
  t.eq(/must be verified/.test(await page.textContent('.ai-pics')), true, 'and what the provider said');
  t.eq(await page.locator('#ai-images-text').count(), 1, 'the description is still there to try again');
  await page.keyboard.press('Escape');
  await ev(function () { window.fetch = window.__realFetch; });

  t.step('off: no sparkles, no commands');
  await prefsSet({ emoji: false, images: false, branches: false, complete: false });
  await E.select(page, roses);
  t.eq(await ev(function () { return window.MindRoot.commands.enabled('ai.menu', { source: 'palette' }); }), false, 'the menu of the node bar is off');
  t.eq(await page.locator('.node-toolbar [data-command="ai.menu"]').isVisible(), false, 'no sparkles on the node bar');
  await ev(function () {
    var ui = window.MindRoot.ui;
    window.__toasts = [];
    if (!ui.__toast0) { ui.__toast0 = ui.toast; ui.toast = function (text, o) { window.__toasts.push(String(text)); return ui.__toast0.apply(ui, arguments); }; }
  });
  await ev(function () { return window.MindRoot.commands.run('ai.emoji', { source: 'palette' }); });
  await page.waitForSelector('dialog.ai-config[open]', { timeout: 8000 });
  var said = (await ev(function () { return window.__toasts.join(' | '); }));
  t.eq(/Suggest an icon/.test(said), true, 'but the palette still offers it: it says what to switch on, and opens the window where to do it');
  await page.keyboard.press('Escape');
};
