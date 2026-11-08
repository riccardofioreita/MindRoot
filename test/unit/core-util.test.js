/* core-util: DOM building, escaping, ids, slugs, timing, hashing, files,
 * platform facts and Intl formatting. */
(function () {
  'use strict';
  var U = window.MindRoot.util;
  var I = window.MindRoot.i18n;
  I.init('en');

  T.test('h builds elements without parsing text as markup', function () {
    var clicked = 0;
    var el = U.h('button', {
      class: ['btn', null, 'btn--icon'], type: 'button', 'aria-label': 'Close', 'data-x': 3,
      style: { color: 'red', '--k': '2px' }, on: { click: function () { clicked++; } }, hidden: false, disabled: true
    }, 'a <b>tag</b>', null, ['x', U.h('i', null, 'y')], false);
    T.eq(el.tagName, 'BUTTON', 'tag');
    T.eq(el.className, 'btn btn--icon', 'class array, falsy skipped');
    T.eq(el.getAttribute('aria-label'), 'Close', 'aria attribute');
    T.eq(el.getAttribute('data-x'), '3', 'data attribute');
    T.eq(el.style.color, 'red', 'style property');
    T.eq(el.style.getPropertyValue('--k'), '2px', 'custom property');
    T.eq(el.hasAttribute('hidden'), false, 'false attributes skipped');
    T.eq(el.hasAttribute('disabled'), true, 'true attributes present');
    T.eq(el.innerHTML.indexOf('&lt;b&gt;tag&lt;/b&gt;') >= 0, true, 'text stays text');
    T.eq(el.querySelector('i').textContent, 'y', 'nested arrays of children');
    el.disabled = false;
    el.click();
    T.eq(clicked, 1, 'listener attached');
    T.eq(U.h('div', { text: '<x>' }).innerHTML, '&lt;x&gt;', 'text attr escapes');
    T.eq(U.h('div', { html: '<b>ok</b>' }).firstChild.tagName, 'B', 'html attr is trusted markup');
    T.eq(U.h('input', { value: 'abc' }).value, 'abc', 'value set as a property');
    T.eq(U.h('div', 'only text').textContent, 'only text', 'children without attrs');
  });

  T.test('h sets live properties after the children', function () {
    var sel = U.h('select', { value: 'b' }, U.h('option', { value: 'a' }, 'A'), U.h('option', { value: 'b' }, 'B'));
    T.eq(sel.value, 'b', 'a select picks among the options it was given');
    var opt = U.h('select', null, U.h('option', { value: 'a' }, 'A'), U.h('option', { value: 'c', selected: true }, 'C'));
    T.eq(opt.value, 'c', 'selected on an option');
    var box = U.h('input', { type: 'checkbox', checked: true });
    T.eq(box.checked, true, 'checked as a property');
    T.eq(box.hasAttribute('checked'), false, 'not as an attribute (a reset would restore it)');
    T.eq(U.h('input', { type: 'checkbox', checked: false }).checked, false, 'checked: false');
    var mixed = U.h('input', { type: 'checkbox', indeterminate: true });
    T.eq(mixed.indeterminate, true, 'indeterminate, which has no attribute at all');
    T.eq(U.h('input', { value: false }).value, '', 'value: false is no value');
    T.eq(U.h('textarea', { value: 'line\nline' }).value, 'line\nline', 'textarea value');
  });

  T.test('h builds SVG in the SVG namespace', function () {
    var svg = U.h('svg', { viewBox: '0 0 24 24', class: 'icon' }, U.h('use', { href: '#i-x' }));
    T.eq(svg.namespaceURI, 'http://www.w3.org/2000/svg', 'svg namespace');
    T.eq(svg.firstChild.namespaceURI, 'http://www.w3.org/2000/svg', 'child namespace');
    T.eq(svg.getAttribute('class'), 'icon', 'class on svg');
    T.eq(U.h('svg:title', null, 'T').namespaceURI, 'http://www.w3.org/2000/svg', 'svg: prefix forces the namespace');
    T.eq(U.h('a').namespaceURI, 'http://www.w3.org/1999/xhtml', 'ambiguous tags default to HTML');
  });

  T.test('escapeHtml', function () {
    T.eq(U.escapeHtml('<script>alert("x") & \'y\'</script>'), '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;', 'all five');
    T.eq(U.escapeHtml(null), '', 'null');
    T.eq(U.escapeHtml(5), '5', 'number');
  });

  T.test('uid: prefixed, unique, compact', function () {
    var seen = {};
    var dup = false;
    for (var i = 0; i < 2000; i++) {
      var id = U.uid('p');
      if (seen[id]) dup = true;
      seen[id] = true;
    }
    T.eq(dup, false, 'no duplicates in 2000');
    T.ok(/^p[0-9a-z]{10,16}$/.test(U.uid('p')), 'p + base36');
    T.ok(/^map[0-9a-z]+$/.test(U.uid('map')), 'own prefix');
    T.ok(U.uid().charAt(0) === 'p', 'default prefix p');
  });

  T.test('slugify is Unicode-aware', function () {
    T.eq(U.slugify('Città di Mélisande'), 'citta-di-melisande', 'accents stripped');
    T.eq(U.slugify('東京 2024'), '東京-2024', 'non-Latin letters kept');
    T.eq(U.slugify('  --Hello, World!--  '), 'hello-world', 'punctuation joined and trimmed');
    T.eq(U.slugify('Q3 Board Deck - FINAL (revised) v12 [approved]'), 'q3-board-deck-final-revised-v12-approved', 'long title');
    T.eq(U.slugify('Ünïcödé Straße'), 'unicode-straße', 'diaeresis');
    T.eq(U.slugify(''), 'untitled', 'empty falls back');
    T.eq(U.slugify('!!!', 'map'), 'map', 'own fallback');
    T.eq(U.slugify('🙂 smile'), 'smile', 'emoji dropped');
    var long = U.slugify(new Array(40).join('word '));
    T.ok(long.length <= 60, 'at most 60 characters');
    T.ok(!/-$/.test(long), 'no trailing dash after the cut');
  });

  T.test('clamp and lerp', function () {
    T.eq(U.clamp(5, 0, 3), 3, 'high');
    T.eq(U.clamp(-1, 0, 3), 0, 'low');
    T.eq(U.clamp(2, 0, 3), 2, 'inside');
    T.eq(U.clamp(2, 5, 3), 5, 'inverted range gives low');
    T.eq(U.lerp(10, 20, 0.25), 12.5, 'lerp');
  });

  T.test('debounce: last call wins, flush and cancel', async function () {
    var calls = [];
    var d = U.debounce(function (v) { calls.push(v); return v * 2; }, 30);
    d(1); d(2); d(3);
    T.eq(calls.length, 0, 'not yet');
    await T.until(function () { return calls.length === 1; }, 1000, 'debounced call');
    T.same(calls, [3], 'last arguments');
    d(4);
    T.eq(d.flush(), 8, 'flush runs now and returns');
    T.same(calls, [3, 4], 'flushed');
    T.eq(d.flush(), undefined, 'nothing pending');
    d(5);
    d.cancel();
    await T.sleep(60);
    T.same(calls, [3, 4], 'cancelled call never runs');
  });

  T.test('throttleFrame: one call per frame with the latest arguments', async function () {
    var calls = [];
    var f = U.throttleFrame(function (v) { calls.push(v); });
    f(1); f(2); f(3);
    await U.nextFrame();
    await U.nextFrame();
    T.same(calls, [3], 'one call');
    f(4);
    f.cancel();
    await U.nextFrame();
    await U.nextFrame();
    T.same(calls, [3], 'cancel drops it');
  });

  T.test('sha256: known vectors, both implementations agree', async function () {
    T.eq(await U.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'empty');
    T.eq(await U.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'abc');
    T.eq(U.sha256Sync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'two blocks (fallback)');
    var bytes = new Uint8Array(1000);
    for (var i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255;
    T.eq(await U.sha256(bytes), U.sha256Sync(bytes), 'subtle and fallback agree on 1000 bytes');
    T.eq(await U.sha256('città'), U.sha256Sync(new TextEncoder().encode('città')), 'strings are UTF-8');
    var rejected = false;
    try { await U.sha256({}); } catch (err) { rejected = true; }
    T.ok(rejected, 'refuses non-bytes');
  });

  T.test('file readers', async function () {
    var blob = new Blob(['hello, café'], { type: 'text/plain' });
    T.eq(await U.readAsText(blob), 'hello, café', 'text');
    var buf = await U.readAsArrayBuffer(blob);
    T.eq(buf.byteLength, 12, 'array buffer (UTF-8 bytes)');
    var url = await U.readAsDataURL(new Blob(['hi'], { type: 'text/plain' }));
    T.eq(url, 'data:text/plain;base64,aGk=', 'data URL');
  });

  T.test('download goes through an anchor and revokes later', async function () {
    var clicked = null;
    var orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked = { name: this.download, href: this.href }; };
    try {
      var r = await U.download(new Blob(['x'], { type: 'text/plain' }), 'map.md');
      T.eq(r, true, 'resolved');
      T.ok(clicked && clicked.name === 'map.md', 'anchor download name');
      T.ok(clicked && /^blob:/.test(clicked.href), 'blob URL');
      T.eq(document.querySelectorAll('a[download]').length, 0, 'anchor removed');
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
  });

  T.test('pickFiles resolves [] on cancel and the files on change', async function () {
    var p = U.pickFiles({ accept: '.md', multiple: true });
    var input = document.querySelector('input[type=file]');
    T.ok(input, 'input in the document while open');
    T.eq(input.getAttribute('accept'), '.md', 'accept');
    T.ok(input.multiple, 'multiple');
    input.dispatchEvent(new Event('cancel'));
    T.same(await p, [], 'cancel gives []');
    T.eq(document.querySelectorAll('input[type=file]').length, 0, 'input removed');

    var p2 = U.pickFiles({ directory: true });
    var input2 = document.querySelector('input[type=file]');
    T.ok(input2.hasAttribute('webkitdirectory'), 'folder picker');
    var dt = new DataTransfer();
    dt.items.add(new File(['# A'], 'a.md', { type: 'text/markdown' }));
    input2.files = dt.files;
    input2.dispatchEvent(new Event('change'));
    var files = await p2;
    T.eq(files.length, 1, 'one file');
    T.eq(files[0].name, 'a.md', 'its name');
  });

  T.test('isTextField', function () {
    function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
    T.eq(U.isTextField(el('<input>')), true, 'input default text');
    T.eq(U.isTextField(el('<input type="search">')), true, 'search');
    T.eq(U.isTextField(el('<input type="checkbox">')), false, 'checkbox');
    T.eq(U.isTextField(el('<input type="radio">')), false, 'radio');
    T.eq(U.isTextField(el('<textarea></textarea>')), true, 'textarea');
    T.eq(U.isTextField(el('<select></select>')), true, 'select');
    T.eq(U.isTextField(el('<button>x</button>')), false, 'button');
    var ce = el('<div contenteditable="true">x</div>');
    document.body.appendChild(ce);
    T.eq(U.isTextField(ce), true, 'contenteditable');
    ce.remove();
    T.eq(U.isTextField(null), false, 'null');
  });

  T.test('platform facts', function () {
    T.eq(typeof U.isMac, 'boolean', 'isMac');
    T.eq(typeof U.isTouch, 'boolean', 'isTouch');
    T.eq(typeof U.isStandalone, 'boolean', 'isStandalone');
    T.eq(U.isFileProtocol, true, 'this page is a file');
    T.eq(typeof U.reducedMotion(), 'boolean', 'reducedMotion live');
    document.documentElement.setAttribute('data-motion', 'reduce');
    T.eq(U.reducedMotion(), true, 'manual reduce wins');
    document.documentElement.removeAttribute('data-motion');
  });

  T.test('dates in the current language', function () {
    var now = new Date(2026, 9, 4, 15, 30).getTime();
    I.init('en');
    T.eq(U.relativeTime(now - 10000, now), 'now', 'seconds ago = now');
    T.eq(U.relativeTime(now - 5 * 60000, now), '5 minutes ago', 'minutes');
    T.eq(U.relativeTime(now - 2 * 3600000, now), '2 hours ago', 'hours today');
    T.eq(U.relativeTime(now - 20 * 3600000, now), 'yesterday', 'yesterday');
    T.ok(/2026/.test(U.relativeTime(now - 12 * 86400000, now)), 'a date after a week');
    T.ok(/2026/.test(U.relativeTime(now + 10 * 60000, now)), 'the future is a date');
    T.eq(U.relativeTime(now + 20000, now), 'now', 'a little in the future is now');
    I.init('it');
    T.eq(U.relativeTime(now - 10000, now), 'ora', 'italian now');
    T.eq(U.relativeTime(now - 5 * 60000, now), '5 minuti fa', 'italian minutes');
    T.eq(U.relativeTime(now - 20 * 3600000, now), 'ieri', 'italian yesterday');
    T.ok(/ott/.test(U.formatDate(now, 'date')), 'italian month');
    T.eq(U.formatDate(now, 'time'), '15:30', 'time');
    I.init('en');
    T.ok(/Oct/.test(U.formatDate(now, 'date')), 'english month');
    T.eq(U.formatDate('nonsense'), '', 'invalid date');
  });

  T.test('naturalCompare', function () {
    var list = ['map 10', 'Map 2', 'map 1', 'àpple', 'apple 2'];
    list.sort(U.naturalCompare);
    T.same(list, ['àpple', 'apple 2', 'map 1', 'Map 2', 'map 10'], 'numeric, case and accent insensitive');
  });
})();
