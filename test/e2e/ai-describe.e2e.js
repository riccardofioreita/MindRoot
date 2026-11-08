/* MindRoot - the AI looking at a picture already in a node, and reading the
 * whole map when asked, on the real app with a stand-in for the provider
 * (nothing leaves the machine): the picture itself goes only when the button
 * is pressed, reduced; a title and a description come back to take or leave,
 * as one undo step; the whole-map option sends the titles of the open map
 * (marking the node) and nothing more, and only when it is switched on. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

module.exports = async function (t) {
  var map = '# Garden\n\n## Beds\n- Roses\n- Basil\n\n## Elsewhere\n- Hidden secret\n';
  var s = await E.boot(t, [['Garden', map]]);
  var page = s.page;
  var asked = [];

  await page.route('https://api.anthropic.com/**', function (route) {
    var req = route.request();
    var body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (err) { body = {}; }
    asked.push({ url: req.url(), body: body });
    var vision = /picture attached to a node/.test(body.system || '');
    var text = vision ? '{"title":"Red rose in bloom","text":"A single red rose with dewdrops on its petals."}' : '["Watering","Soil","Pests"]';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: text }] }) });
  });

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function mapText() { return E.text(page); }
  function prefsSet(p) { return ev(function (v) { window.MindRoot.prefs.set('ai', v); }, p); }
  async function bar() {
    await E.until(page, function () { var b = document.querySelector('.node-toolbar [data-command="ai.menu"]'); return b && !b.hidden && b.offsetParent !== null; });
    await page.click('.node-toolbar [data-command="ai.menu"]');
  }

  var roses = await E.pathOf(page, 'Roses');
  var basil = await E.pathOf(page, 'Basil');
  var beds = await E.pathOf(page, 'Beds');

  await ev(function () { return window.MindRoot.ai.setKey('sk-ant-x', 'session'); });

  /* ---------------------------------------------------------------- a picture is put in the node */

  t.step('only with a picture in the node does the AI offer to describe it');
  await prefsSet({ provider: 'anthropic', describe: true, complete: false, branches: false });
  await E.select(page, roses);
  t.eq(await ev(function (p) { return window.MindRoot.commands.enabled('ai.describe', { source: 'palette' }); }, roses), false, 'a node with no picture: nothing to describe');
  t.eq(await page.locator('.node-toolbar [data-command="ai.menu"]').isVisible(), false, 'and no sparkles on the node bar');
  await ev(function (p) {
    var c = document.createElement('canvas');
    c.width = 1600; c.height = 900;
    var g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 1600, 900);
    gr.addColorStop(0, '#c4314b'); gr.addColorStop(1, '#f2c12e');
    g.fillStyle = gr; g.fillRect(0, 0, 1600, 900);
    return new Promise(function (done) {
      c.toBlob(function (blob) {
        window.MindRoot.media.addFiles([new File([blob], 'rose.png', { type: 'image/png' })], { path: p, field: 'line' }).then(done);
      }, 'image/png');
    });
  }, roses);
  await E.until(page, function () { return /!\[[^\]]*\]\(assets\//.test(window.MindRoot.session.current().text); }, null, 10000);
  await E.settled(page);
  roses = await E.pathOf(page, 'Roses');
  await E.select(page, roses);
  t.eq(await ev(function () { return window.MindRoot.commands.enabled('ai.describe', { source: 'palette' }); }), true, 'a node with a picture: it can');

  t.step('the picture goes only when the button is pressed, reduced');
  asked.length = 0;
  await bar();
  await page.waitForSelector('.ai-desc__pic', { timeout: 8000 });
  t.eq(asked.length, 0, 'opening the panel sends nothing');
  t.eq(/Anthropic/.test(await page.textContent('.ai-desc')), true, 'it says who the picture will go to');
  var shown = await ev(function () { var i = document.querySelector('.ai-desc__pic'); return { w: i.naturalWidth, h: i.naturalHeight }; });
  t.check('the picture shown is the reduced one (1024 px on the longest side)', shown.w === 1024 && shown.h === 576, shown);
  await page.click('#ai-desc-go');
  await page.waitForSelector('#ai-desc-title', { timeout: 8000 });
  t.eq(asked.length, 1, 'one request');
  var m = asked[0].body.messages[0].content;
  t.same([m[0].type, m[0].source.type, m[0].source.media_type, m[1].type], ['image', 'base64', 'image/jpeg', 'text'], 'the picture as an image block, then the words');
  t.check('reduced: a few hundred kilobytes at most', m[0].source.data.length < 400000, m[0].source.data.length);
  t.eq(m[1].text.indexOf('attached to the node: Roses') >= 0 && m[1].text.indexOf('Hidden secret') < 0, true, 'with the node and where it is, not the rest of the map');
  t.eq(await page.inputValue('#ai-desc-title'), 'Red rose in bloom', 'the title proposed');
  t.eq(/dewdrops/.test(await page.inputValue('#ai-desc-text')), true, 'the description proposed');
  t.same(await ev(function () { return [document.getElementById('ai-desc-use-title').checked, document.getElementById('ai-desc-use-text').checked]; }), [false, true], 'the title is not taken for a node that already has one; the description is');

  t.step('taken: one undo step; the title can be taken too');
  var h0 = await E.history(page);
  await page.fill('#ai-desc-text', 'A single red rose.');
  await page.click('#ai-desc-apply');
  await E.until(page, function () { return !document.querySelector('.ai-desc'); });
  var txt = await mapText();
  t.eq(/Roses/.test(txt) && txt.indexOf('A single red rose.') >= 0, true, 'the description is under the title, the title is as it was');
  var h1 = await E.history(page);
  t.same([h1.count, h1.key], [h0.count + 1, 'ai.label.describe'], 'one undo step, named for it');
  await ev(function () { window.MindRoot.store.undo(); });
  t.eq((await mapText()).indexOf('A single red rose.') < 0, true, 'one Undo takes it back');
  await E.select(page, await E.pathOf(page, 'Roses'));
  await bar();
  await page.waitForSelector('#ai-desc-go', { timeout: 8000 });
  await page.click('#ai-desc-go');
  await page.waitForSelector('#ai-desc-title', { timeout: 8000 });
  await page.check('#ai-desc-use-title');
  await page.click('#ai-desc-apply');
  await E.until(page, function () { return !document.querySelector('.ai-desc'); });
  txt = await mapText();
  t.eq(txt.indexOf('Red rose in bloom') >= 0 && /!\[[^\]]*\]\(assets\//.test(txt), true, 'with the title ticked, the title is the new one - and the picture is still there');

  t.step('a refusal is said');
  await ev(function () {
    window.__realFetch = window.fetch;
    window.fetch = function (u, i) {
      if (/api\.anthropic\.com/.test(String(u))) return Promise.resolve(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
      return window.__realFetch.call(window, u, i);
    };
  });
  await E.select(page, await E.pathOf(page, 'Red rose in bloom'));
  await bar();
  await page.waitForSelector('#ai-desc-go', { timeout: 8000 });
  await page.click('#ai-desc-go');
  await page.waitForSelector('.ai-panel__error', { timeout: 8000 });
  t.eq((await page.textContent('.ai-panel__error')).trim(), 'The provider refused the key.', 'in words');
  await page.keyboard.press('Escape');
  await ev(function () { window.fetch = window.__realFetch; });

  /* ---------------------------------------------------------------- the whole map */

  t.step('the whole map, when asked: the titles, the node marked, nothing else');
  await prefsSet({ describe: false, branches: true, outline: false });
  beds = await E.pathOf(page, 'Beds');
  await E.select(page, beds);
  asked.length = 0;
  await bar();
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  t.eq(JSON.stringify(asked[0].body).indexOf('Outline of the whole map') < 0, true, 'off: no outline');
  await page.keyboard.press('Escape');
  await prefsSet({ outline: true });
  asked.length = 0;
  await E.select(page, beds);
  await bar();
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  var prompt = asked[0].body.messages[0].content;
  t.eq(prompt.indexOf('Outline of the whole map') >= 0 && prompt.indexOf('Hidden secret') >= 0 && prompt.indexOf('Elsewhere') >= 0, true, 'on: every title of the map');
  t.eq(/→\s+Beds/.test(prompt), true, 'the node marked with an arrow');
  t.eq(prompt.indexOf('![') < 0 && prompt.indexOf('assets/') < 0, true, 'no picture markup, no file name');
  await page.keyboard.press('Escape');

  t.step('the words under the nodes, when asked too');
  t.eq(prompt.indexOf('titles only') >= 0, true, 'titles only by default');
  await ev(function () { window.MindRoot.store.setMapText(window.MindRoot.session.current().projectId, window.MindRoot.session.current().mapId, window.MindRoot.session.current().text + '\n- Notes node\n  - > text: Words under the notes node, about compost.\n'); });
  await E.settled(page);
  await prefsSet({ outline: true, outlineBodies: true });
  asked.length = 0;
  await E.select(page, beds);
  await bar();
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  prompt = asked[0].body.messages[0].content;
  t.eq(/\n\s+- Words under the notes node, about compost\./.test(prompt), true, 'the words follow their node, on a line of their own');
  t.eq(prompt.indexOf('titles only') < 0 && prompt.indexOf('written under the node above it') >= 0, true, 'and the prompt says what they are');
  await page.keyboard.press('Escape');
  await prefsSet({ outlineBodies: false });
  var long = await ev(function () {
    var D = window.MindRoot.doc;
    var c = window.MindRoot.session.current();
    var lines = ['# Big'];
    for (var i = 0; i < 400; i++) lines.push('- Item number ' + i + ' of a long map');
    var state = D.parse(lines.join('\n') + '\n');
    var out = window.MindRoot.aiui.outlineOf(state, state.flat[5].path);
    return { n: out.split('\n').length, len: out.length, hasNode: /→/.test(out), cut: /…$/.test(out.trim()) };
  });
  t.check('a long map is cut to a size that can be sent, the node kept', long.n <= 252 && long.len <= 6100 && long.hasNode && long.cut, long);
  await prefsSet({ branches: false, outline: false });

  /* ---------------------------------------------------------------- the language of the answers */

  t.step('the language of the answers, chosen in the window');
  await prefsSet({ branches: true });
  await page.click('#topbar-actions [data-command="ai.open"]');
  await page.waitForSelector('#ai-lang', { state: 'visible' });
  t.eq(await page.inputValue('#ai-lang'), '', 'automatic to begin with');
  t.eq(await page.locator('#ai-lang option').count() >= 14, true, 'automatic, the app\'s language and a list');
  await page.selectOption('#ai-lang', 'it');
  t.eq(await ev(function () { return window.MindRoot.prefs.get('ai').lang; }), 'it', 'the choice is kept');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('#ai-lang'); });
  asked.length = 0;
  await E.select(page, beds);
  await bar();
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  t.eq(/Write in Italian\./.test(asked[0].body.system) && !/same language as the node/.test(asked[0].body.system), true, 'the request says to write in Italian');
  await page.keyboard.press('Escape');
  await prefsSet({ branches: false, lang: '' });

  /* ---------------------------------------------------------------- the language, offered where it is used */

  t.step('the panel offers the language, the current one selected; the title is plain words');
  await prefsSet({ describe: true, lang: 'it' });
  var pic = await E.pathOf(page, 'Red rose in bloom');
  await ev(function (p) { return window.MindRoot.editor.setTitle(p, '**Red** rose and *thorns*', 'editor.label.rename'); }, pic);
  await E.settled(page);
  pic = await E.pathOf(page, 'Red rose and thorns');
  await E.select(page, pic);
  await bar();
  await page.waitForSelector('#ai-desc-lang', { timeout: 8000 });
  t.eq(await page.inputValue('#ai-desc-lang'), 'it', 'the language in use is already chosen');
  t.eq((await page.textContent('dialog.ai-sheet .sheet__title')).trim(), 'Describe the picture in \u201cRed rose and thorns\u201d', 'the title shows words, not marks');
  await page.selectOption('#ai-desc-lang', 'fr');
  t.eq(await ev(function () { return window.MindRoot.prefs.get('ai').lang; }), 'it', 'a choice here is for this description, the preference is left as it is');
  asked.length = 0;
  await page.click('#ai-desc-go');
  await page.waitForSelector('#ai-desc-title', { timeout: 8000 });
  t.eq(/Write in French\./.test(asked[0].body.system) && !/Write in Italian/.test(asked[0].body.system), true, 'the request is in French');
  t.eq(asked[0].body.messages[0].content[1].text.indexOf('attached to the node: Red rose and thorns') >= 0, true, 'and says the node in plain words');
  await page.keyboard.press('Escape');

  t.step('the branches panel too: another language asks again');
  await prefsSet({ describe: false, branches: true, lang: 'en' });
  await E.select(page, beds);
  await bar();
  await page.waitForSelector('#ai-branch-lang', { timeout: 8000 });
  t.eq(await page.inputValue('#ai-branch-lang'), 'en', 'the language in use is chosen');
  asked.length = 0;
  await page.selectOption('#ai-branch-lang', 'de');
  await page.waitForSelector('.ai-panel__list', { timeout: 8000 });
  t.eq(asked.length >= 1 && /Write in German\./.test(asked[asked.length - 1].body.system), true, 'a new request, in German');
  await page.keyboard.press('Escape');
  await prefsSet({ branches: false, lang: '' });
};
