/* ai: the engine of the AI assistance, with no network. A fake fetch stands in
 * for the provider: what is sent (the address, the headers, the body, only
 * the words of the node), what comes back and how it is read, every way a
 * request can fail, the limits, and the key in each of the three places it
 * can be kept (this tab, this browser, encrypted) - never in a preference. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var ai = ns.ai;

  var realFetch = window.fetch;
  var calls = [];
  var plan = null;

  function reply(status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } });
  }

  window.fetch = function (url, init) {
    calls.push({ url: url, init: init, body: init && init.body ? JSON.parse(init.body) : null });
    if (typeof plan === 'function') return plan(url, init);
    return reply(200, { content: [{ type: 'text', text: 'ok' }] });
  };

  function fresh(over) {
    ai.reset();
    ai.clearKey();
    calls = [];
    plan = null;
    ns.prefs.set('ai', Object.assign({ provider: 'anthropic', model: '', baseUrl: '', keyMode: 'session', complete: true, branches: true, emoji: false, images: false, describe: false, outline: false, lang: '', imageModel: '' }, over || {}));
  }

  function rejects(promise) {
    return promise.then(function () { return null; }, function (e) { return e && e.code; });
  }

  T.test('the preferences: off to begin with, the key never among them', function () {
    ns.prefs.reset && ns.prefs.reset();
    var d = ns.prefs.get('ai');
    T.same([d.complete, d.branches, d.provider, d.keyMode], [false, false, 'anthropic', 'session'], 'both features off, Anthropic, this session');
    T.ok(Object.keys(d).every(function (k) { return !/key$/i.test(k) || k === 'keyMode'; }), 'no key field in the preferences');
    T.eq(ns.prefs.set('ai', { provider: 'nonsense' }), false, 'an unknown provider is refused');
    ns.prefs.set('ai', { provider: 'openai' });
    T.eq(ai.settings().provider, 'openai', 'a known one is taken');
  });

  T.test('readiness: a feature runs only when on, with a key', async function () {
    fresh({ complete: false, branches: false });
    T.eq(ai.status().state, 'off', 'nothing switched on: off');
    ns.prefs.set('ai', { complete: true });
    T.eq(ai.status().state, 'nokey', 'on, no key');
    T.eq(ai.enabled('complete'), false, 'not enabled');
    await ai.setKey('sk-test-123', 'session');
    T.eq(ai.status().state, 'ready', 'a key: ready');
    T.same([ai.enabled('complete'), ai.enabled('branches')], [true, false], 'only the feature switched on');
    ns.prefs.set('ai', { provider: 'custom', baseUrl: 'http://example.com/v1' });
    T.eq(ai.status().state, 'nobase', 'a custom address over plain http that is not this machine: refused');
    ns.prefs.set('ai', { baseUrl: 'http://localhost:11434/v1' });
    T.eq(ai.status().state, 'ready', 'this machine over http is fine');
    ns.prefs.set('ai', { baseUrl: 'https://example.com/v1' });
    T.eq(ai.status().state, 'ready', 'https anywhere is fine');
    ns.prefs.set('ai', { baseUrl: 'javascript:alert(1)' });
    T.eq(ai.status().state, 'nobase', 'anything else is not an address');
  });

  T.test('Anthropic: where it goes, what it carries, how it is read', async function () {
    fresh({ provider: 'anthropic', model: '' });
    await ai.setKey('  sk-ant-abc\n', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'one ' }, { type: 'tool_use' }, { type: 'text', text: 'two' }] }); };
    var out = await ai.request({ kind: 'x', system: 'SYS', prompt: 'PROMPT', maxTokens: 50 });
    T.eq(out, 'one two', 'the text parts, joined');
    var c = calls[0];
    T.eq(c.url, 'https://api.anthropic.com/v1/messages', 'the address');
    T.eq(c.init.method, 'POST', 'a POST');
    T.eq(c.init.headers['x-api-key'], 'sk-ant-abc', 'the key, cleaned of spaces');
    T.eq(c.init.headers['anthropic-version'], '2023-06-01', 'the version');
    T.eq(c.init.headers['anthropic-dangerous-direct-browser-access'], 'true', 'the browser flag');
    T.same([c.body.model, c.body.max_tokens, c.body.system, c.body.messages], ['claude-haiku-5-5', 50, 'SYS', [{ role: 'user', content: 'PROMPT' }]], 'the body');
    T.same([c.init.credentials, c.init.referrerPolicy], ['omit', 'no-referrer'], 'no cookies, no referrer');
    ns.prefs.set('ai', { model: 'claude-opus-5-5' });
    await ai.request({ kind: 'x', system: 'a', prompt: 'b' });
    T.eq(calls[1].body.model, 'claude-opus-5-5', 'the model the person chose');
  });

  T.test('OpenAI and the compatible ones', async function () {
    fresh({ provider: 'openai' });
    await ai.setKey('sk-openai', 'session');
    plan = function () { return reply(200, { choices: [{ message: { content: 'hello' } }] }); };
    T.eq(await ai.request({ kind: 'x', system: 'S', prompt: 'P', maxTokens: 30 }), 'hello', 'the message, read');
    var c = calls[0];
    T.eq(c.url, 'https://api.openai.com/v1/chat/completions', 'the address');
    T.eq(c.init.headers.authorization, 'Bearer sk-openai', 'the key as a bearer');
    T.same([c.body.messages[0], c.body.messages[1], c.body.max_completion_tokens, c.body.max_tokens], [{ role: 'system', content: 'S' }, { role: 'user', content: 'P' }, 30, undefined], 'the body');
    fresh({ provider: 'custom', baseUrl: 'http://127.0.0.1:1234/v1/', model: 'llama3' });
    plan = function () { return reply(200, { choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }); };
    T.eq(await ai.request({ kind: 'x', system: 'S', prompt: 'P', maxTokens: 30 }), 'ab', 'a message in parts is joined');
    T.eq(calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions', 'the person\'s own address, the slash tidied');
    T.same([calls[0].body.max_tokens, calls[0].body.max_completion_tokens, calls[0].init.headers.authorization], [30, undefined, undefined], 'max_tokens for the old API, no key needed');
  });

  T.test('every way it can fail has a name', async function () {
    fresh({});
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'nokey', 'no key');
    await ai.setKey('k', 'session');
    plan = function () { return reply(401, { error: { message: 'bad key' } }); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'auth', '401: auth');
    plan = function () { return reply(403, {}); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'auth', '403: auth');
    plan = function () { return reply(429, { error: { message: 'slow down' } }); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'rate', '429: rate');
    plan = function () { return reply(404, { error: { message: 'model x not found' } }); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'model', '404: model');
    plan = function () { return reply(400, { error: { message: 'invalid model' } }); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'model', '400 about the model: model');
    plan = function () { return reply(500, 'oops'); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'bad', '500: bad');
    plan = function () { return Promise.reject(new TypeError('Failed to fetch')); };
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'network', 'no network: network');
    plan = function (url, init) {
      return new Promise(function (resolve, reject) {
        init.signal.addEventListener('abort', function () { var e = new Error('x'); e.name = 'AbortError'; reject(e); });
      });
    };
    var ctl = new AbortController();
    var p = rejects(ai.request({ system: 'a', prompt: 'b', signal: ctl.signal }));
    ctl.abort();
    T.eq(await p, 'aborted', 'the caller\'s signal: aborted');
    var first = rejects(ai.request({ kind: 'same', system: 'a', prompt: 'b' }));
    var second = ai.request({ kind: 'same', system: 'a', prompt: 'c' });
    second.catch(function () {});
    T.eq(await first, 'aborted', 'a new request of a kind aborts the old one');
  });

  T.test('the limits against a runaway', async function () {
    fresh({});
    await ai.setKey('k', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'x' }] }); };
    var codes = [];
    for (var i = 0; i < 32; i++) codes.push(await rejects(ai.request({ system: 'a', prompt: 'b' })));
    T.eq(codes.filter(function (c) { return c === 'limit'; }).length, 2, 'thirty a minute, then "limit"');
    T.eq(calls.length, 30, 'and nothing more was sent');
    T.eq(ai.stats().requests, 30, 'the count is kept');
    T.same([ai.stats().sent.kind, ai.stats().sent.chars], ['other', 2], 'with what the last one carried: how much, not what');
  });

  T.test('the key: this tab, this browser, encrypted - and forgotten', async function () {
    fresh({});
    var a = await ai.setKey('sk-A', 'session');
    T.eq(a.kept, 'session', 'kept for the session');
    T.eq(sessionStorage.getItem('mindroot2:ai-key'), 'sk-A', 'in sessionStorage');
    T.eq(localStorage.getItem('mindroot2:ai-key'), null, 'not in localStorage');
    var b = await ai.setKey('sk-B', 'device');
    T.eq(b.kept, 'device', 'kept on the device');
    T.same([localStorage.getItem('mindroot2:ai-key'), sessionStorage.getItem('mindroot2:ai-key')], ['sk-B', null], 'in localStorage only: the old place is emptied');
    var c = await ai.setKey('sk-C', 'locked', 'hunter22');
    T.eq(c.kept, 'locked', 'kept locked');
    var blob = localStorage.getItem('mindroot2:ai-key-locked');
    T.ok(blob && blob.indexOf('sk-C') < 0, 'the blob does not hold the key');
    T.same([localStorage.getItem('mindroot2:ai-key'), sessionStorage.getItem('mindroot2:ai-key')], [null, null], 'and no plain copy is left');
    ai.reset();
    T.eq(ai.keyState(), 'locked', 'a fresh page: locked');
    T.eq(await rejects(ai.request({ system: 'a', prompt: 'b' })), 'locked', 'a request refuses until it is opened');
    T.eq(await rejects(ai.unlock('wrong one')), 'auth', 'a wrong passphrase opens nothing');
    T.eq(ai.keyState(), 'locked', 'still locked');
    T.eq(await ai.unlock('hunter22'), true, 'the right one opens it');
    T.eq(ai.keyState(), 'ready', 'ready');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'x' }] }); };
    await ai.request({ system: 'a', prompt: 'b' });
    T.eq(calls[0].init.headers['x-api-key'], 'sk-C', 'and the key used is the one that was sealed');
    T.eq(await rejects(ai.setKey('k', 'locked', 'abc')), 'bad', 'a passphrase under four characters is refused');
    T.eq(await rejects(ai.setKey('   ', 'session')), 'nokey', 'an empty key is refused');
    ai.clearKey();
    T.same([ai.keyState(), localStorage.getItem('mindroot2:ai-key-locked'), localStorage.getItem('mindroot2:ai-key'), sessionStorage.getItem('mindroot2:ai-key')], ['none', null, null, null], 'forgotten everywhere');
    T.ok(JSON.stringify(ns.prefs.get('ai')).indexOf('sk-') < 0, 'and never in the preferences');
  });

  T.test('the models on offer: asked for, read, and only the ones that can chat', async function () {
    fresh({ provider: 'anthropic' });
    await ai.setKey('sk-ant', 'session');
    plan = function () {
      return reply(200, { data: [
        { id: 'claude-old', display_name: 'Claude Old', created_at: '2024-01-01T00:00:00Z' },
        { id: 'claude-new', display_name: 'Claude New', created_at: '2026-06-01T00:00:00Z' },
        { id: 'claude-new', display_name: 'Dup', created_at: '2026-06-01T00:00:00Z' },
        { id: 7 }, null
      ], has_more: false });
    };
    var list = await ai.listModels();
    T.same(list, [{ id: 'claude-new', label: 'Claude New' }, { id: 'claude-old', label: 'Claude Old' }], 'Anthropic: newest first, named, no repeats, no junk');
    T.eq(calls[0].url, 'https://api.anthropic.com/v1/models?limit=1000', 'the address');
    T.same([calls[0].init.method, calls[0].init.headers['x-api-key'], calls[0].init.headers['anthropic-dangerous-direct-browser-access'], calls[0].init.body], ['GET', 'sk-ant', 'true', undefined], 'a GET with the key and the browser flag, no body');
    fresh({ provider: 'openai' });
    await ai.setKey('sk-oa', 'session');
    plan = function () {
      return reply(200, { data: [
        { id: 'gpt-4o-mini', created: 100 }, { id: 'text-embedding-3-small', created: 300 }, { id: 'whisper-1', created: 50 },
        { id: 'gpt-4o-audio-preview', created: 200 }, { id: 'o3-mini', created: 400 }, { id: 'gpt-image-1', created: 500 },
        { id: 'dall-e-3', created: 10 }, { id: 'gpt-4o-realtime-preview', created: 20 }, { id: 'omni-moderation-latest', created: 30 }, { id: 'chatgpt-4o-latest', created: 150 }
      ] });
    };
    list = await ai.listModels();
    T.same(list.map(function (m) { return m.id; }), ['o3-mini', 'chatgpt-4o-latest', 'gpt-4o-mini'], 'OpenAI: only the chat ones, newest first');
    T.eq(calls[0].url, 'https://api.openai.com/v1/models', 'the address');
    T.eq(calls[0].init.headers.authorization, 'Bearer sk-oa', 'with the key as a bearer');
    fresh({ provider: 'custom', baseUrl: 'http://localhost:11434/v1/' });
    plan = function () { return reply(200, { data: [{ id: 'qwen' }, { id: 'llama3' }] }); };
    list = await ai.listModels();
    T.same(list.map(function (m) { return m.id; }), ['llama3', 'qwen'], 'a model on this machine: all of them, by name');
    T.same([calls[0].url, calls[0].init.headers.authorization], ['http://localhost:11434/v1/models', undefined], 'no key asked for');
    plan = function () { return reply(401, { error: { message: 'no' } }); };
    T.eq(await rejects(ai.listModels()), 'auth', 'a refused key is "auth"');
  });

  T.test('the test: the list first, then one question to the model chosen', async function () {
    fresh({ provider: 'anthropic', model: 'good-model' });
    await ai.setKey('k', 'session');
    plan = function (url) {
      if (/\/models/.test(url)) return reply(200, { data: [{ id: 'good-model', display_name: 'Good' }] });
      return reply(200, { content: [{ type: 'text', text: 'ok' }] });
    };
    var r = await ai.test();
    T.same([r.models.length, r.modelOk, typeof r.ms], [1, true, 'number'], 'a key that works with a model that works');
    T.same(calls.map(function (c) { return c.init.method; }), ['GET', 'POST'], 'two requests, the list then the question');
    plan = function (url) {
      if (/\/models/.test(url)) return reply(200, { data: [{ id: 'good-model' }] });
      return reply(404, { error: { message: 'model bad-model not found' } });
    };
    ns.prefs.set('ai', { model: 'bad-model' });
    r = await ai.test();
    T.same([r.modelOk, r.models.length, /not found/.test(r.modelError)], [false, 1, true], 'a model that does not exist is not a failure of the key');
    plan = function (url) { return /\/models/.test(url) ? reply(401, { error: { message: 'bad' } }) : reply(200, { content: [] }); };
    T.eq(await rejects(ai.test()), 'auth', 'a refused key fails the test');
    fresh({ provider: 'custom', baseUrl: 'http://127.0.0.1:1/v1', model: 'm' });
    plan = function (url) { return /\/models/.test(url) ? reply(404, 'no such page') : reply(200, { choices: [{ message: { content: 'ok' } }] }); };
    r = await ai.test();
    T.same([r.models, r.modelOk], [null, true], 'an address with no list of models is let off: the question decides');
  });

  T.test('completion: the prompt carries only the node\'s words, the answer is cleaned', function () {
    var p = ai.completionPrompt({ field: 'title', typed: 'Plan the bud', map: 'Trip', ancestors: ['Trip', 'Money'], siblings: ['Flights', 'Hotels'], body: 'Spend less' });
    T.ok(/ONLY the words that come next/.test(p.system) && /title/.test(p.system), 'the instruction says what to reply with');
    T.ok(p.prompt.indexOf('Trip > Money') >= 0 && p.prompt.indexOf('Flights | Hotels') >= 0 && p.prompt.indexOf('Plan the bud') >= 0, 'the path, the neighbours and the text typed');
    T.ok(p.prompt.indexOf('SECRET') < 0, 'nothing else');
    T.ok(p.maxTokens <= 64, 'a short reply');
    var C = ai.cleanCompletion;
    T.eq(C('get for the trip', 'Plan the bud', 'title'), 'get for the trip', 'a mid-word continuation as it is');
    T.eq(C(' budget for the trip.', 'Plan the', 'title'), ' budget for the trip', 'a leading space kept, the full stop of a title dropped');
    T.eq(C('"get for the trip"', 'Plan the bud', 'title'), 'get for the trip', 'quotes taken off');
    T.eq(C('Plan the budget', 'Plan the', 'title'), ' budget', 'a model that repeats what was typed: only what follows');
    T.eq(C('line one\nline two', 'x', 'title'), 'line one line two', 'one line for a title');
    T.eq(C('line one\n\n\nline two', 'x', 'body'), 'line one\nline two', 'a body keeps a break');
    T.eq(C('   ', 'x', 'title'), '', 'nothing useful: nothing');
    T.eq(C('```\ntext\n```', 'x', 'title'), 'text', 'a code fence is taken off');
    var long = new Array(60).join('word ');
    T.ok(C(long, 'x', 'title').length <= 90, 'a title never runs on');
  });

  T.test('branches: the prompt, and the titles read out of whatever the model wrote', function () {
    var p = ai.branchesPrompt({ node: 'Budget', count: 5, ancestors: ['Trip'], children: ['Flights'], avoid: ['Food'] });
    T.ok(/JSON array of 5/.test(p.system), 'asks for a JSON array of the count');
    T.ok(p.prompt.indexOf('Node to expand: Budget') >= 0 && p.prompt.indexOf('Flights') >= 0 && p.prompt.indexOf('do not repeat: Food') >= 0, 'the node, its sub-branches and what was already offered');
    var P = ai.parseBranches;
    T.same(P('["Flights", "Hotels", "Food"]', []), ['Flights', 'Hotels', 'Food'], 'a plain array');
    T.same(P('Here you go:\n```json\n["A", "B"]\n```\nHope it helps', []), ['A', 'B'], 'an array in the middle of talk');
    T.same(P('["a", "A", "b", "  b  ", "c"]', []), ['a', 'b', 'c'], 'repeats gone, spaces tidied');
    T.same(P('["Flights", "Hotels"]', ['flights']), ['Hotels'], 'what is to be avoided gone, whatever its case');
    T.same(P('1. Flights\n2) Hotels\n- Food\n• Sights.', []), ['Flights', 'Hotels', 'Food', 'Sights'], 'no array: one per line, numbers and bullets off');
    T.same(P('[{"title":"One"},{"title":"Two"},5,null]', []), ['One', 'Two'], 'objects with a title; the rest ignored');
    T.eq(P('["1","2","3","4","5","6","7","8","9","10"]', []).length, 8, 'eight at most');
    T.same(P('[]', []), [], 'nothing');
    T.eq(P('["' + new Array(200).join('x') + '"]', [])[0].length, 80, 'a title is cut to a sane length');
  });

  T.test('complete() and suggestBranches() through the whole path', async function () {
    fresh({});
    await ai.setKey('k', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'get for the trip' }] }); };
    T.eq(await ai.complete({ field: 'title', typed: 'Plan the bud' }), 'get for the trip', 'a completion');
    T.eq(calls[0].body.max_tokens <= 64, true, 'short');
    plan = function () { return reply(200, { content: [{ type: 'text', text: '["Flights","Hotels","Budget","Food"]' }] }); };
    T.same(await ai.suggestBranches({ node: 'Budget', children: ['Flights'] }), ['Hotels', 'Food'], 'branches: no repeat of the existing ones or of the node itself');
    var t = await ai.test();
    T.ok(t && typeof t.ms === 'number', 'test(): one tiny request that says how long it took');
  });

  T.test('emoji: asked for, and read out of whatever came back', async function () {
    var p = ai.emojiPrompt({ node: 'Budget', ancestors: ['Trip'], siblings: ['Flights'] });
    T.ok(/JSON array of 5/.test(p.system) && p.prompt.indexOf('Node: Budget') >= 0 && p.prompt.indexOf('Trip') >= 0, 'the prompt: the node and where it sits');
    var P = ai.parseEmoji;
    T.same(P('["💶","📊","🧾"]'), ['💶', '📊', '🧾'], 'a plain array');
    T.same(P('Sure! ["💶", "💶", " 🌍 ", "x", "", 5]'), ['💶', '🌍'], 'repeats, words and junk dropped');
    T.same(P('💶 📊 🧾'), ['💶', '📊', '🧾'], 'no array: the emoji in the text');
    T.same(P('["👨‍👩‍👧","🇮🇹","👍🏽","❤️"]'), ['👨‍👩‍👧', '🇮🇹', '👍🏽', '❤️'], 'a family, a flag, a skin tone and a heart each stay one');
    T.same(P('none that fit'), [], 'nothing');
    fresh({});
    await ai.setKey('k', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: '["🌱","🪴"]' }] }); };
    T.same(await ai.suggestEmoji({ node: 'Beds' }), ['🌱', '🪴'], 'through the whole path');
  });

  T.test('pictures: OpenAI only, three to choose from, each one checked', async function () {
    var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    fresh({ provider: 'anthropic', images: true });
    await ai.setKey('k', 'session');
    T.eq(ai.enabled('images'), false, 'not offered with another provider');
    T.eq(await rejects(ai.generateImages({ prompt: 'a rose' })), 'bad', 'and refused');
    fresh({ provider: 'openai', images: true });
    await ai.setKey('sk-oa', 'session');
    T.eq(ai.enabled('images'), true, 'offered with OpenAI');
    T.eq(await rejects(ai.generateImages({ prompt: '   ' })), 'bad', 'a picture needs a description');
    plan = function () { return reply(200, { data: [{ b64_json: PNG }, { b64_json: PNG }, { b64_json: 'not base64 !!' }, { b64_json: '/9j/4AAQ' }, { url: 'https://x/y.png' }] }); };
    var got = await ai.generateImages({ prompt: 'a rose, flat style', n: 3 });
    T.same(got.map(function (g) { return g.mime; }), ['image/png', 'image/png', 'image/jpeg'], 'the real pictures, three at most; bad ones and addresses left out');
    var c = calls[0];
    T.eq(c.url, 'https://api.openai.com/v1/images/generations', 'the address');
    T.same([c.body.model, c.body.n, c.body.size, c.body.quality, c.body.response_format], ['gpt-image-1', 3, '1024x1024', 'low', undefined], 'one request for three, low quality');
    T.eq(c.init.headers.authorization, 'Bearer sk-oa', 'with the key');
    fresh({ provider: 'openai', images: true, imageModel: 'dall-e-3' });
    await ai.setKey('sk-oa', 'session');
    plan = function () { return reply(200, { data: [{ b64_json: PNG }] }); };
    got = await ai.generateImages({ prompt: 'a rose' });
    T.same([calls.length, got.length, calls[0].body.n, calls[0].body.response_format], [3, 3, 1, 'b64_json'], 'dall-e-3 gives one at a time: asked three times');
    fresh({ provider: 'openai', images: true });
    await ai.setKey('sk-oa', 'session');
    plan = function () { return reply(200, { data: [{ b64_json: 'AAAA' }] }); };
    T.eq(await rejects(ai.generateImages({ prompt: 'a rose' })), 'bad', 'nothing that is a picture: a failure, not an empty list');
    plan = function () { return reply(403, { error: { message: 'Your organization must be verified to use the model gpt-image-1' } }); };
    var err = await ai.generateImages({ prompt: 'a rose' }).then(function () { return null; }, function (e) { return e; });
    T.same([err.code, /verified/.test(err.message)], ['auth', true], 'a refusal carries the provider\'s own words');
    fresh({ provider: 'openai', images: true });
    await ai.setKey('sk-oa', 'session');
    plan = function () { return reply(200, { data: [{ b64_json: PNG }] }); };
    var codes = [];
    for (var i = 0; i < 17; i++) codes.push(await rejects(ai.generateImages({ prompt: 'a rose', n: 1 })));
    T.eq(codes.filter(function (x) { return x === 'limit'; }).length, 2, 'fifteen picture requests a session, then "limit"');
  });

  T.test('what a picture shows: the picture goes as each provider wants it, the answer is read', async function () {
    var JPG = '/9j/4AAQSkZJRgABAQ';
    var P = ai.parseDescription;
    T.same(P('{"title":"A red rose.","text":"A red rose in a *garden*."}'), { title: 'A red rose', text: 'A red rose in a garden.' }, 'a plain object, marks and the full stop of the title taken off');
    T.same(P('Here:\n```json\n{"title":"Pier at dusk","text":"A wooden pier."}\n```'), { title: 'Pier at dusk', text: 'A wooden pier.' }, 'an object in the middle of talk');
    T.same(P('Pier at dusk\nA wooden pier over still water.'), { title: 'Pier at dusk', text: 'A wooden pier over still water.' }, 'no object: the first line is the title');
    var dp = ai.describePrompt({ node: 'Roses', ancestors: ['Garden', 'Beds'], outline: '  Garden\n→ Roses' });
    T.ok(/ONLY a JSON object/.test(dp.system) && dp.prompt.indexOf('attached to the node: Roses') >= 0 && dp.prompt.indexOf('→ Roses') >= 0, 'the prompt: the node, where it is, the outline when given');
    fresh({ provider: 'anthropic', describe: true });
    await ai.setKey('sk-ant', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: '{"title":"A rose","text":"A single rose."}' }] }); };
    var r = await ai.describeImage({ mime: 'image/jpeg', b64: JPG, ctx: { node: 'Roses' } });
    T.same(r, { title: 'A rose', text: 'A single rose.' }, 'Anthropic: read');
    var c = calls[0].body.messages[0].content;
    T.same([c[0].type, c[0].source.type, c[0].source.media_type, c[0].source.data, c[1].type], ['image', 'base64', 'image/jpeg', JPG, 'text'], 'the picture as an image block, then the words');
    fresh({ provider: 'openai', describe: true });
    await ai.setKey('sk-oa', 'session');
    plan = function () { return reply(200, { choices: [{ message: { content: '{"title":"A rose","text":"One rose."}' } }] }); };
    r = await ai.describeImage({ mime: 'image/png', b64: 'iVBORw0KGgo=', ctx: { node: 'Roses' } });
    T.eq(r.title, 'A rose', 'OpenAI: read');
    c = calls[0].body.messages[1].content;
    T.same([c[0].type, c[1].type, c[1].image_url.url], ['text', 'image_url', 'data:image/png;base64,iVBORw0KGgo='], 'the picture as a data URL, in the user message');
    T.eq(await rejects(ai.describeImage({ mime: 'text/html', b64: 'AAAA' })), 'bad', 'not a picture type: refused before anything is sent');
    T.eq(await rejects(ai.describeImage({ mime: 'image/png', b64: 'not base64 !' })), 'bad', 'not base64: refused');
    T.eq(calls.length, 1, 'and nothing was sent for those');
    plan = function () { return reply(200, { choices: [{ message: { content: '' } }] }); };
    T.eq(await rejects(ai.describeImage({ mime: 'image/png', b64: 'iVBORw0KGgo=' })), 'bad', 'an empty answer is a failure');
    fresh({ provider: 'anthropic', describe: false, complete: false, branches: false });
    T.eq(ai.status().state, 'off', 'with every feature off, off');
  });

  T.test('the language of the answers: said in every prompt that writes words, or left to the node', function () {
    fresh({ lang: '' });
    T.eq(ai.languageName(), '', 'automatic: no language named');
    T.ok(/same language as that text/.test(ai.completionPrompt({ field: 'title', typed: 'x' }).system), 'the completion follows the typed words');
    T.ok(/same language as the node/.test(ai.branchesPrompt({ node: 'x' }).system), 'the branches follow the node');
    T.ok(/language of the map/.test(ai.describePrompt({ node: 'x' }).system), 'the description follows the map');
    fresh({ lang: 'it' });
    T.eq(ai.languageName(), 'Italian', 'a language chosen: its name');
    T.ok(/Write in Italian\./.test(ai.completionPrompt({ field: 'title', typed: 'x' }).system) && !/same language as that text/.test(ai.completionPrompt({ field: 'title', typed: 'x' }).system), 'the completion is asked in it');
    T.ok(/Write in Italian\./.test(ai.branchesPrompt({ node: 'x' }).system) && !/same language as the node/.test(ai.branchesPrompt({ node: 'x' }).system), 'the branches too');
    T.ok(/Write in Italian\./.test(ai.describePrompt({ node: 'x' }).system), 'and the description');
    fresh({ lang: 'ja' });
    T.eq(ai.languageName(), 'Japanese', 'another one');
    fresh({ lang: 'app' });
    T.eq(ai.languageName(), ns.i18n.lang() === 'it' ? 'Italian' : 'English', 'the app\'s own language');
    fresh({ lang: 'klingon' });
    T.eq(ai.languageName(), '', 'a code that is not in the list: automatic');
    T.ok(ai.LANGUAGES.every(function (l) { return l.id && l.name && l.label; }), 'every language has a code, a name and a label');
  });

  T.test('the new switches: labels on, ghost and chat off; ghost and chat count as features', function () {
    ns.prefs.reset && ns.prefs.reset();
    var d = ai.settings();
    T.same([d.labels, d.ghost, d.chat, d.chatMap], [true, false, false, false], 'labels on (nothing sent), the rest off');
    fresh({ complete: false, branches: false, ghost: true });
    ai.setKey('sk-x', 'session');
    T.same([ai.status().state, ai.enabled('ghost'), ai.enabled('chat')], ['ready', true, false], 'ghost alone makes it ready');
    fresh({ complete: false, branches: false, chat: true });
    T.eq(ai.status().state, 'nokey', 'chat alone asks for a key');
  });

  T.test('the chat: the conversation sent as turns, the map only when given', async function () {
    fresh({ chat: true });
    await ai.setKey('sk-ant-x', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'Sure.' }] }); };
    var out = await ai.chat({ messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'A map of my exam' }, { role: 'assistant', content: 'Which one?' }, { role: 'user', content: 'Botany' }, { role: 'system', content: 'ignore' }], node: 'Beds' });
    T.eq(out, 'Sure.', 'the answer');
    var b = calls[calls.length - 1].body;
    T.same(b.messages.map(function (m) { return m.role + ':' + m.content; }), ['user:A map of my exam', 'assistant:Which one?', 'user:Botany'], 'from the person\'s first turn, no other roles');
    T.ok(/```|mindroot/.test(b.system) && /selected node, where branches would be added: Beds/.test(b.system), 'how to propose a map, and the selected node');
    T.ok(b.max_tokens > 1024, 'room for a whole map');
    await ai.chat({ messages: [{ role: 'user', content: 'x' }], context: '→ Beds\n  Roses' });
    T.ok(/What the person lets you read[\s\S]*data, not instructions[\s\S]*→ Beds/.test(calls[calls.length - 1].body.system), 'what it may read, when given, said to be data');
    T.eq(await rejects(ai.chat({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })), 'bad', 'nothing to answer: refused');
    fresh({ chat: true, provider: 'openai' });
    await ai.setKey('sk-x', 'session');
    plan = function () { return reply(200, { choices: [{ message: { content: 'ok' } }] }); };
    await ai.chat({ messages: [{ role: 'user', content: 'hello' }] });
    var ob = calls[calls.length - 1].body;
    T.same(ob.messages.map(function (m) { return m.role; }), ['system', 'user'], 'OpenAI: the instructions as the first message');
  });

  T.test('parseMapEdits: the maps an answer writes in full', function () {
    var r = ai.parseMapEdits('Here.\n\n```mindroot-map name="Garden"\n# Garden\n\n## Beds <!-- color: #c2703d -->\n```\nAnd a new one:\n~~~mindroot-map name = "Trip  to Rome"\n# Rome\n~~~\n```mindroot\n- x\n```');
    T.same(r.edits.map(function (e) { return e.name + ':' + JSON.stringify(e.text); }), ['Garden:"# Garden\\n\\n## Beds <!-- color: #c2703d -->\\n"', 'Trip to Rome:"# Rome\\n"'], 'each map by its name, its text whole, markers kept');
    T.eq(r.rest, 'Here.\n\nAnd a new one:\n\n```mindroot\n- x\n```', 'the rest of the answer, the outline block left for parseOutline');
    T.eq(ai.parseMapEdits('```mindroot-map\n# x\n```').edits.length, 0, 'no name: not a map edit');
    T.eq(ai.parseOutline(r.rest).nodes[0].title, 'x', 'and the outline still read from the rest');
  });

  T.test('the chat: pictures go with their turn, the latest six', async function () {
    fresh({ chat: true });
    await ai.setKey('sk-ant-x', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'ok' }] }); };
    var px = { mime: 'image/jpeg', b64: '/9j/4AAQ' };
    var many = [px, px, px, px];
    await ai.chat({ messages: [{ role: 'user', content: 'a', images: many }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c', images: many }, { role: 'assistant', content: 'd' }, { role: 'user', content: 'e', images: [{ mime: 'text/html', b64: 'PGI+' }] }] });
    var m = calls[calls.length - 1].body.messages;
    T.same([m[0].content.length, m[2].content.length, typeof m[4].content], [3, 5, 'string'], 'two of the first turn\'s, all four of the second, and no picture that is not one');
    T.same([m[2].content[0].type, m[2].content[0].source.media_type, m[2].content[4].text], ['image', 'image/jpeg', 'c'], 'Anthropic: image blocks, then the words');
    fresh({ chat: true, provider: 'openai' });
    await ai.setKey('sk-x', 'session');
    plan = function () { return reply(200, { choices: [{ message: { content: 'ok' } }] }); };
    await ai.chat({ messages: [{ role: 'user', content: 'look', images: [px] }] });
    var o = calls[calls.length - 1].body.messages[1].content;
    T.same([o[0].text, o[1].type, o[1].image_url.url.slice(0, 23)], ['look', 'image_url', 'data:image/jpeg;base64,'], 'OpenAI: the words, then a data URL');
  });

  T.test('the chat: a PDF goes whole where the provider reads one', async function () {
    var pdf = { name: 'paper.pdf', mime: 'application/pdf', b64: 'JVBERi0xLjQK' };
    fresh({ chat: true });
    await ai.setKey('sk-ant-x', 'session');
    plan = function () { return reply(200, { content: [{ type: 'text', text: 'ok' }] }); };
    await ai.chat({ messages: [{ role: 'user', content: 'read', docs: [pdf, { name: 'x', mime: 'text/html', b64: 'PGI+' }] }] });
    var a = calls[calls.length - 1].body.messages[0].content;
    T.same([a.length, a[0].type, a[0].source.media_type, a[0].title, a[1].text], [2, 'document', 'application/pdf', 'paper.pdf', 'read'], 'Anthropic: a document block, then the words; nothing that is not a PDF');
    fresh({ chat: true, provider: 'openai' });
    await ai.setKey('sk-x', 'session');
    plan = function () { return reply(200, { choices: [{ message: { content: 'ok' } }] }); };
    await ai.chat({ messages: [{ role: 'user', content: 'read', docs: [pdf] }] });
    var o = calls[calls.length - 1].body.messages[1].content;
    T.same([o[1].type, o[1].file.filename, o[1].file.file_data.slice(0, 28)], ['file', 'paper.pdf', 'data:application/pdf;base64,'], 'OpenAI: a file part');
    fresh({ chat: true, provider: 'custom', baseUrl: 'http://localhost:11434/v1' });
    plan = function () { return reply(200, { choices: [{ message: { content: 'ok' } }] }); };
    await ai.chat({ messages: [{ role: 'user', content: 'read', docs: [pdf] }] });
    T.eq(typeof calls[calls.length - 1].body.messages[1].content, 'string', 'another provider: no PDF sent');
    T.same([ai.readsPdf('anthropic'), ai.readsPdf('openai'), ai.readsPdf('custom')], [true, true, false], 'who reads a PDF');
  });

  T.test('parseProjects: a whole project an answer writes, and the guide for another AI', function () {
    var r = ai.parseProjects('Here.\n\n```mindroot-project name="Biology  notes"\n=== Cells\n# Cells\n\n- > text: small\n\n=== Genetics ===\n# Genetics\n===\n```\nThen:\n```mindroot-map name="X"\n# X\n```');
    T.same(r.projects.map(function (p) { return p.name + ':' + p.maps.map(function (m) { return m.name + '=' + JSON.stringify(m.text); }).join(','); }), ['Biology notes:Cells="# Cells\\n\\n- > text: small\\n",Genetics="# Genetics\\n===\\n"'], 'its maps by their "===" lines, each text whole');
    T.eq(ai.parseMapEdits(r.rest).edits[0].name, 'X', 'the rest still holds the map edit');
    T.eq(ai.parseProjects('```mindroot-project name="Empty"\nno map line\n```').projects.length, 0, 'no map: no project');
    var g = ai.formatGuide();
    T.ok(/"mindroot": "project"/.test(g) && /"maps": \[/.test(g) && /- > text: /.test(g) && /- > note: /.test(g), 'the guide: the JSON shape, and words and notes under nodes');
    T.ok(/mindroot-project/.test(ai.chatPrompt({}).system) && /- > text: first line/.test(ai.chatPrompt({}).system), 'the chat is told how to propose a project and document nodes');
  });

  T.test('parseOutline: the map an answer proposes', function () {
    var a = ai.parseOutline('Here.\n\n```mindroot\n# Exam\n- Causes\n  - Economic <!-- color: #fff -->\n- Events\n    - 1914\n```\nGood luck.');
    T.eq(a.title, 'Exam', 'the centre');
    T.same(a.nodes.map(function (n) { return n.title + '(' + n.children.map(function (c) { return c.title; }).join(',') + ')'; }), ['Causes(Economic color: #fff)', 'Events(1914)'], 'nested by indent; no marker can be smuggled in');
    T.eq(a.count, 4, 'four nodes under it');
    T.eq(a.prose, 'Here.\n\nGood luck.', 'the words outside the block');
    var b = ai.parseOutline('```\n- A\n  - A1\n* B\n1. C\n```');
    T.same([b.title, b.nodes.length, b.nodes[0].children[0].title], [null, 3, 'A1'], 'branches with no centre; any list marker');
    var c = ai.parseOutline('```markdown\n# Book\n## Part 1\n- ch1\n### Sub\n## Part 2\n```');
    T.same(c.nodes.map(function (n) { return n.title + ':' + n.children.length; }), ['Part 1:2', 'Part 2:0'], 'headings nest by level, items under the last heading');
    T.eq(ai.parseOutline('no block at all'), null, 'no block');
    T.eq(ai.parseOutline('```js\nvar x = 1\n```'), null, 'code is not an outline');
    T.eq(ai.parseOutline('```mindroot\n- one\n```\n```mindroot\n- two\n```').nodes[0].title, 'one', 'the first block');
  });

  /* The page's own fetch is put back for the harness. */
  T.test('done', function () { window.fetch = realFetch; T.ok(true, 'the real fetch is back'); });
})();
