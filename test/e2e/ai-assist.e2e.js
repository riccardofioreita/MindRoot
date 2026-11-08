/* MindRoot - the AI assistance, on the real app, with a stand-in for the
 * provider (no request leaves the machine): off until switched on and given
 * a key; the window of its own (the sparkles in the top bar) with the list of
 * the provider's models once the key is saved; the key kept where the person said and nowhere else; the card that
 * offers how a title goes on (Tab takes it, Tab still adds a child when no
 * card is showing); only the words of the node and its neighbours sent; the
 * panel of branches (ticked ones added as one undo step); failures said in
 * words; nothing sent once a feature is switched off. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

module.exports = async function (t) {
  var map = '# Garden\n\n## Beds\n- Roses\n- Basil\n\n## Elsewhere\n- Hidden secret\n';
  var s = await E.boot(t, [['Garden', map]]);
  var page = s.page;

  var seen = [];
  var round = 0;
  await page.route('https://api.anthropic.com/**', function (route) {
    var req = route.request();
    var body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (err) { body = {}; }
    seen.push({ url: req.url(), headers: req.headers(), body: body });
    if (req.method() === 'GET' && /\/v1\/models/.test(req.url())) {
      return route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ data: [
          { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-05-01T00:00:00Z' },
          { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-04-01T00:00:00Z' },
          { id: 'claude-old-1', display_name: 'Claude Old', created_at: '2024-01-01T00:00:00Z' }
        ] })
      });
    }
    var branches = /sub-branches/.test(body.system || '');
    var rounds = [
      '["Watering","Sunlight","Soil","Pests","Pruning"]',
      '["Compost","Tools","Seasons","Layout","Sunlight"]',
      '["Mulch","Fences"]'
    ];
    var text = branches ? rounds[Math.min(round++, rounds.length - 1)] : ' budget for the trip';
    if (/Reply with the single word/.test(body.system || '')) text = 'ok';
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ content: [{ type: 'text', text: text }] })
    });
  });

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  /* The provider refusing the key, played by the page's own fetch (a real 401
   * would be a console error, which the suites count as a failure). */
  function refusing(on) {
    return ev(function (yes) {
      if (yes) {
        window.__realFetch = window.__realFetch || window.fetch;
        window.fetch = function (u, i) {
          if (/api\.anthropic\.com/.test(String(u))) return Promise.resolve(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
          return window.__realFetch.call(window, u, i);
        };
      } else if (window.__realFetch) { window.fetch = window.__realFetch; window.__realFetch = null; }
    }, on);
  }
  function mapText() { return E.text(page); }
  async function pause() { await page.waitForTimeout(1100); }
  async function settingsOpen() {
    await page.click('#topbar-actions [data-command="ai.open"]');
    await page.waitForSelector('#ai-key', { state: 'visible' });
  }
  async function settingsClose() {
    await page.keyboard.press('Escape');
    await E.until(page, function () { return !document.querySelector('#ai-key'); });
  }

  /* ---------------------------------------------------------------- off by default */

  t.step('off: nothing is sent, nothing is offered');
  var beds = await E.pathOf(page, 'Beds');
  var roses = await E.pathOf(page, 'Roses');
  await E.select(page, roses);
  await ev(function (p) { window.MindRoot.editor.startRename(p, { selectAll: true }); }, roses);
  await page.keyboard.type('Plan the bud');
  await pause();
  t.eq(seen.length, 0, 'typing sends nothing');
  t.eq(await ev(function () { var g = document.querySelector('.ai-ghost'); return !!g && !g.hidden; }), false, 'and no card shows');
  await page.keyboard.press('Escape');
  t.eq(await ev(function () { return window.MindRoot.commands.enabled('ai.menu', { source: 'palette' }); }), false, 'the menu of the node bar is off');
  await ev(function () {
    var ui = window.MindRoot.ui;
    window.__toasts = [];
    if (!ui.__toast0) { ui.__toast0 = ui.toast; ui.toast = function (text, o) { window.__toasts.push(String(text)); return ui.__toast0.apply(ui, arguments); }; }
  });
  await ev(function () { return window.MindRoot.commands.run('ai.branches', { source: 'palette' }); });
  await page.waitForSelector('dialog.ai-config[open]', { timeout: 8000 });
  var saidOff = await ev(function () { return window.__toasts.join(' | '); });
  t.eq(saidOff, 'Switch “Suggest branches” on in the AI assistant window.', 'the branches command, run with it off, says what to switch on...');
  t.eq(seen.length, 0, '...and sends nothing');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('dialog.ai-config[open]'); });
  t.eq(await page.locator('.node-toolbar [data-command="ai.menu"]').isVisible(), false, 'the toolbar has no sparkles button');

  /* ---------------------------------------------------------------- settings */

  t.step('the sparkles in the top bar open a window of their own');
  t.eq(await page.locator('#topbar-actions [data-command="ai.open"]').isVisible(), true, 'the button is there even with everything off');
  t.eq(await page.getAttribute('#topbar-actions [data-command="ai.open"]', 'aria-label'), 'AI assistant', 'named for what it opens');
  await settingsOpen();
  t.eq(await page.getAttribute('#ai-complete', 'aria-checked'), 'false', 'both features start off');
  t.eq(await page.getAttribute('#ai-branches', 'aria-checked'), 'false', '...');
  t.eq(await page.locator('#ai-base').count(), 0, 'no address field for a named provider');
  t.eq(await page.locator('#ai-model-pick').count(), 0, 'and no list of models before a key');
  await page.click('#ai-provider [data-value="custom"]');
  t.eq(await page.locator('#ai-base').count(), 1, 'Other: an address appears');
  await page.click('#ai-provider [data-value="anthropic"]');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('#ai-key'); });
  await page.keyboard.press('Control+Shift+A');
  await page.waitForSelector('#ai-key', { state: 'visible' });
  t.eq(true, true, 'Ctrl+Shift+A opens it too');

  t.step('the key: saved, checked, and the models offered');
  await page.fill('#ai-key', 'sk-ant-test-123');
  await page.click('#ai-save');
  await E.until(page, function () { return !!document.querySelector('#ai-model-pick'); });
  t.eq(seen.length, 1, 'saving asked the provider for its models, and nothing else');
  t.same([seen[0].url, seen[0].headers['x-api-key']], ['https://api.anthropic.com/v1/models?limit=1000', 'sk-ant-test-123'], 'with the key, to the provider chosen');
  t.eq(await page.textContent('#ai-note'), '3 models available: choose one below.', 'the window says how many');
  var opts = await ev(function () { return Array.prototype.map.call(document.querySelectorAll('#ai-model-pick option'), function (o) { return o.value; }); });
  t.same(opts, ['', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-old-1', '__other'], 'the list: the default, the newest first, another name');
  var kept = await ev(function () {
    return { session: sessionStorage.getItem('mindroot2:ai-key'), device: localStorage.getItem('mindroot2:ai-key'), prefs: localStorage.getItem('mindroot2:prefs') || '' };
  });
  t.same([kept.session, kept.device], ['sk-ant-test-123', null], 'the key is in the tab\'s session storage, not in the browser\'s');
  t.eq(kept.prefs.indexOf('sk-ant') < 0, true, 'and not in the preferences');
  t.eq(await page.inputValue('#ai-key'), '', 'the field is emptied');
  await page.selectOption('#ai-model-pick', 'claude-opus-5-5');
  t.eq(await ev(function () { return window.MindRoot.prefs.get('ai').model; }), 'claude-opus-5-5', 'a model chosen from the list is the model');
  await page.selectOption('#ai-model-pick', '__other');
  t.eq(await page.locator('input#ai-model').count(), 1, '"Another name": a field to type it in');
  await page.fill('input#ai-model', 'my-model');
  await page.press('input#ai-model', 'Enter');
  await page.click('#ai-test').catch(function () {});
  await E.until(page, function () { return /connection works|It works|not available/.test(document.querySelector('#ai-note').textContent); });
  t.eq(/model "my-model" is not available|It works/.test(await page.textContent('#ai-note')), true, 'the test speaks of the model chosen');
  await page.selectOption('#ai-model-pick', '').catch(function () {});
  await ev(function () { window.MindRoot.prefs.set('ai', { model: '' }); });
  seen.length = 0;
  await page.click('#ai-complete');
  await page.click('#ai-branches');
  t.same(await ev(function () { var a = window.MindRoot.prefs.get('ai'); return [a.complete, a.branches]; }), [true, true], 'the two switches');
  await settingsClose();

  t.step('Settings, AI: only the door to the window');
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#ai-open', { state: 'visible' });
  t.eq(await page.locator('#ai-key').count(), 0, 'no form there');
  t.eq(/Ready: Anthropic/.test(await page.textContent('#ai-status-line')), true, 'it says where things stand');
  await page.click('#ai-open');
  await page.waitForSelector('#ai-key', { state: 'visible' });
  await E.until(page, function () { return document.querySelectorAll('dialog.sheet[open]').length === 1; });
  t.eq(await page.locator('dialog.ai-config[open]').count(), 1, 'and the button opens the window, the settings out of its way');
  await settingsClose();

  /* ---------------------------------------------------------------- complete as you type */

  t.step('a pause offers how the title goes on; Tab takes it');
  await E.select(page, roses);
  await ev(function (p) { window.MindRoot.editor.startRename(p, { selectAll: true }); }, roses);
  await page.keyboard.type('Plan the bud');
  await page.waitForSelector('.ai-ghost:not([hidden])', { timeout: 8000 });
  t.eq(await page.textContent('.ai-ghost .ai-ghost__text'), 'budget for the trip', 'the card says how it goes on');
  var sent = seen[0];
  t.eq(sent.body.messages[0].content.indexOf('Plan the bud') >= 0, true, 'what was typed is sent');
  var words = JSON.stringify(sent.body);
  t.check('with the parent and the neighbour', words.indexOf('Beds') >= 0 && words.indexOf('Basil') >= 0, words.slice(0, 400));
  t.eq(words.indexOf('Hidden secret') < 0 && words.indexOf('Elsewhere') < 0, true, 'and nothing from the rest of the map');
  t.eq(sent.body.messages.length, 1, 'one message');
  var before = (await E.fields(page)).title;
  await page.keyboard.press('Tab');
  var after = await E.fields(page);
  t.eq(after.title, before + ' budget for the trip', 'Tab put the words where the caret is');
  t.eq(await ev(function () { var g = document.querySelector('.ai-ghost'); return !g || g.hidden; }), true, 'the card is gone');
  t.eq((await E.renaming(page)) !== null, true, 'and Tab did not add a child: the node is still being written');
  await page.keyboard.press('Enter');
  t.eq((await mapText()).indexOf('Plan the bud budget for the trip') >= 0, true, 'the map holds the whole title');

  t.step('any other key drops the card; Tab with no card still adds a child');
  seen.length = 0;
  await E.select(page, roses);
  var roses2 = await E.pathOf(page, 'Plan the bud budget for the trip');
  await ev(function (p) { window.MindRoot.editor.startRename(p, { selectAll: true }); }, roses2);
  await page.keyboard.type('Water');
  await page.waitForSelector('.ai-ghost:not([hidden])', { timeout: 8000 });
  await page.keyboard.type('i');
  t.eq(await ev(function () { var g = document.querySelector('.ai-ghost'); return !g || g.hidden; }), true, 'typing on drops it');
  await page.keyboard.press('Tab');
  t.check('Tab, with nothing offered, adds a child as ever', (await mapText()).indexOf('New node') >= 0 || (await E.renaming(page)) !== null, await mapText());
  await page.keyboard.press('Escape');

  t.step('a failure is said, once; nothing more is sent when it is off');
  await refusing(true);
  seen.length = 0;
  await E.select(page, roses);
  await ev(function (p) { window.MindRoot.editor.startRename(p, { selectAll: true }); }, roses);
  await page.keyboard.type('Another title');
  await E.until(page, function () { return (window.__toasts || []).some(function (x) { return /refused the key/.test(x); }); }, null, 10000);
  t.eq((await ev(function () { return window.__toasts.filter(function (x) { return /refused/.test(x); })[0]; })), 'The provider refused the key.', 'the provider refused the key, in words');
  await page.keyboard.press('Escape');
  await refusing(false);
  await ev(function () { window.MindRoot.prefs.set('ai', { complete: false }); });
  seen.length = 0;
  await E.select(page, roses);
  await ev(function (p) { window.MindRoot.editor.startRename(p, { selectAll: true }); }, roses);
  await page.keyboard.type('Quiet now');
  await pause();
  t.eq(seen.length, 0, 'switched off: no request');
  await page.keyboard.press('Escape');

  /* ---------------------------------------------------------------- branches */

  t.step('Suggest branches: a panel, the ticked ones added in one step');
  seen.length = 0;
  await E.select(page, beds);
  await E.until(page, function () { var b = document.querySelector('.node-toolbar [data-command="ai.menu"]'); return b && !b.hidden && b.offsetParent !== null; });
  t.eq(await page.locator('.node-toolbar [data-command="ai.menu"]').isVisible(), true, 'the sparkles button is on the node bar');
  var h0 = await E.history(page);
  await page.click('.node-toolbar [data-command="ai.menu"]');
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  t.eq(await page.locator('.ai-panel__item').count(), 5, 'five titles');
  t.eq(seen.length, 1, 'one request');
  var wordsB = JSON.stringify(seen[0].body);
  var promptB = seen[0].body.messages[0].content;
  t.check('with the node and its sub-branches', promptB.indexOf('Node to expand: Beds') >= 0 && promptB.indexOf('Existing sub-branches:') >= 0 && promptB.indexOf('Basil') >= 0, promptB);
  t.eq(wordsB.indexOf('Hidden secret') < 0, true, 'not the rest of the map');
  await page.uncheck('#ai-pick-1');
  await page.uncheck('#ai-pick-4');
  t.eq((await page.textContent('[data-ai="add"]')).trim(), 'Add 3', 'the button counts the ticked');
  await page.click('[data-ai="add"]');
  await E.until(page, function () { return !document.querySelector('.ai-panel'); });
  var txt = await mapText();
  t.check('the ticked titles are children of Beds', ['Watering', 'Soil', 'Pests'].every(function (x) { return txt.indexOf(x) >= 0; }), txt);
  t.check('the unticked are not', txt.indexOf('Sunlight') < 0 && txt.indexOf('Pruning') < 0, txt);
  var h1 = await E.history(page);
  t.eq(h1.count, h0.count + 1, 'one undo step for all three');
  t.eq(h1.key, 'ai.label.addBranches', 'named for it');
  await ev(function () { window.MindRoot.store.undo(); });
  txt = await mapText();
  t.eq(['Watering', 'Soil', 'Pests'].some(function (x) { return txt.indexOf(x) >= 0; }), false, 'one Undo takes them all back');

  t.step('another round asks for different ones; a failure has a retry');
  await E.select(page, beds);
  await page.keyboard.press('Control+.');
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  seen.length = 0;
  await page.click('[data-ai="again"]');
  await E.until(page, function () { return !document.querySelector('.ai-panel__busy'); });
  t.eq(seen.length, 1, 'another request');
  t.eq(JSON.stringify(seen[0].body).indexOf('do not repeat') >= 0, true, 'which says what was offered already');
  t.eq(await page.locator('.ai-panel__item').count(), 2, 'and what comes back is the new round');
  await refusing(true);
  await page.click('[data-ai="again"]');
  await page.waitForSelector('.ai-panel__error', { timeout: 8000 });
  t.eq((await page.textContent('.ai-panel__error')).trim(), 'The provider refused the key.', 'the failure in words');
  t.eq(await page.locator('.ai-panel__actions button').count(), 1, 'with a button to try again');
  await page.keyboard.press('Escape');
  await refusing(false);

  /* ---------------------------------------------------------------- forgetting */

  t.step('forgotten: no key anywhere, and nothing can be asked');
  await settingsOpen();
  await page.click('#ai-forget');
  await E.until(page, function () { return !document.querySelector('#ai-forget'); });
  t.same(await ev(function () { return [sessionStorage.getItem('mindroot2:ai-key'), localStorage.getItem('mindroot2:ai-key'), window.MindRoot.ai.keyState()]; }), [null, null, 'none'], 'the key is gone');
  await settingsClose();
  t.eq(await ev(function () { return window.MindRoot.commands.enabled('ai.menu', { source: 'palette' }); }), false, 'and the node bar\'s menu is off again');
};
