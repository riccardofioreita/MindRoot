/* core-prefs: validation of what was saved, defaults, deep merge, events,
 * the theme mirror, debounced writes, define(), other tabs. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var P = ns.prefs;

  function saved() { return JSON.parse(localStorage.getItem('mindroot2:prefs')); }

  T.test('what was saved is checked against the defaults', function () {
    T.eq(P.available(), true, 'storage available');
    T.eq(P.get('theme'), 'dark', 'valid enum kept');
    T.eq(P.get('lang'), null, 'invalid enum falls back to the default');
    T.eq(P.get('liquidGlass'), true, 'wrong type falls back');
    T.eq(P.get('sidebarOpen'), false, 'valid boolean kept');
    T.eq(P.get('sourceHeight'), 0.9, 'number clamped into its range');
    T.same(P.get('expanded'), { p1: true, p3: false }, 'map keeps only boolean values');
    T.same(P.get('copies'), { every: 1, unit: 'h' }, 'shaped object: clamped, invalid field defaulted, extra dropped');
    T.same(P.get('export'), { format: 'pdf', notes: false, expand: true, drawings: false, paper: 'light' }, 'shaped object merged onto defaults');
    T.same(P.get('pen'), { tool: 'marker', color: '#123456', size: 64, eraser: 'stroke' }, 'pen size clamped');
    T.same(P.get('noteSize'), { w: 300, h: 200 }, 'free value kept');
    T.eq(P.get('removedLongAgo'), undefined, 'unknown key dropped');
    T.eq(P.get('branchText'), true, 'missing key gets its default');
    T.eq(P.get('direction'), undefined, 'a preference this version no longer has is dropped');
    T.same(Object.keys(P.all()).sort(), Object.keys(P.defaults()).sort(), 'exactly the known keys');
  });

  T.test('get returns copies, never the stored object', function () {
    var e = P.get('export');
    e.format = 'md';
    T.eq(P.get('export').format, 'pdf', 'outside mutation has no effect');
  });

  T.test('set validates, merges shaped objects and notifies once', function () {
    var seen = [];
    var busSeen = [];
    var off = P.on('export', function (v, key) { seen.push(key + ':' + v.format); });
    var offBus = ns.bus.on('prefs', function (d) { busSeen.push(d.key); });
    T.eq(P.set('export', { format: 'svg' }), true, 'changed');
    T.same(P.get('export'), { format: 'svg', notes: false, expand: true, drawings: false, paper: 'light' }, 'one field changed, others kept');
    T.eq(P.set('export', { format: 'svg' }), false, 'same value is no change');
    T.eq(P.set('export', { format: 'gif' }), false, 'refused value');
    T.eq(P.set('export', { format: 'md', bogus: 1 }), false, 'unknown field refuses the whole set');
    T.eq(P.get('export').format, 'svg', 'nothing changed');
    T.eq(P.set('theme', 'sepia'), false, 'refused enum');
    T.eq(P.set('nope', 1), false, 'unknown key refused');
    T.same(seen, ['export:svg'], 'one listener call');
    T.same(busSeen, ['export'], 'one bus event');
    off();
    offBus();
    T.eq(P.set('expanded', { a: true }), true, 'maps are replaced, not merged');
    T.same(P.get('expanded'), { a: true }, 'replaced');
  });

  T.test('the theme is mirrored at once and announced', function () {
    var themes = [];
    var off = ns.bus.on('theme', function (d) { themes.push(d.value); });
    P.set('theme', 'light');
    T.eq(localStorage.getItem('mindroot2:theme'), 'light', 'mirror written synchronously');
    P.set('theme', 'system');
    T.eq(localStorage.getItem('mindroot2:theme'), null, 'system removes the mirror');
    T.same(themes, ['light', 'system'], 'theme events');
    off();
  });

  T.test('writes are debounced and flushed', async function () {
    P.set('branchText', false);
    T.eq(saved().prefs.branchText === false, false, 'not written yet');
    P.flush();
    T.eq(saved().v, 1, 'versioned');
    T.eq(saved().prefs.branchText, false, 'flushed');
    P.set('branchText', true);
    await T.until(function () { return saved().prefs.branchText === true; }, 2000, 'debounced write');
    T.eq(saved().prefs.removedLongAgo, undefined, 'unknown keys are not written back');
  });

  T.test('define adds a module preference and reads its saved value', function () {
    var v = P.define('myModule', { open: false, side: 'l' }, { enums: { 'myModule.side': ['l', 'r'] } });
    T.same(v, { open: true, side: 'r' }, 'saved value found');
    T.eq(P.set('myModule', { side: 'x' }), false, 'its enum is enforced');
    T.eq(P.set('myModule', { side: 'l' }), true, 'valid change');
    T.same(P.get('myModule'), { open: true, side: 'l' }, 'merged');
    T.same(P.define('myModule', { other: 1 }), { open: true, side: 'l' }, 'a second define does not reset it');
  });

  T.test('another tab writing is heard and not written back', function () {
    var seen = [];
    var off = P.on('*', function (v, key) { seen.push(key); });
    var other = { v: 1, prefs: Object.assign(P.all(), { notesOpen: true, viewer: 'card', theme: 'bogus' }) };
    window.dispatchEvent(new StorageEvent('storage', { key: 'mindroot2:prefs', newValue: JSON.stringify(other) }));
    T.eq(P.get('notesOpen'), true, 'applied');
    T.eq(P.get('viewer'), 'card', 'applied');
    T.eq(P.get('theme'), 'system', 'invalid values from the other tab ignored');
    T.same(seen.sort(), ['notesOpen', 'viewer'], 'listeners told once per change');
    window.dispatchEvent(new StorageEvent('storage', { key: 'mindroot2:prefs', newValue: '{broken' }));
    T.eq(P.get('notesOpen'), true, 'a corrupted value is ignored');
    off();
  });

  T.test('an old preference can be read once, then is forgotten', async function () {
    T.eq(P.legacy('direction'), 'both', 'what the blob said for a key this version dropped');
    T.eq(P.legacy('theme'), undefined, 'a known key is no legacy');
    T.eq(P.legacy('neverThere'), undefined, 'nor is a key the blob never had');
    /* Read but not taken care of yet (a read-only tab): other writes keep it. */
    P.set('viewer', P.get('viewer') === 'card' ? 'split' : 'card');
    P.flush();
    T.eq(saved().prefs.direction, 'both', 'a read old preference survives other writes until forgotten');
    T.eq(P.legacy('direction'), 'both', 'and can still be read');
    T.eq(P.forget('theme'), false, 'a known key cannot be forgotten');
    T.eq(P.forget('direction'), true, 'forgotten');
    T.eq(P.legacy('direction'), undefined, 'not read a second time');
    T.eq(P.forget('direction'), false, 'forgetting twice changes nothing');
    P.flush();
    T.eq(saved().prefs.direction, undefined, 'the blob is written without it');
  });

  T.test('an old preference another tab took care of is let go here too', function () {
    T.eq(P.legacy('removedLongAgo') !== undefined, true, 'read, so held');
    var other = { v: 1, prefs: P.all() };
    window.dispatchEvent(new StorageEvent('storage', { key: 'mindroot2:prefs', newValue: JSON.stringify(other) }));
    T.eq(P.legacy('removedLongAgo'), undefined, 'the other tab wrote the blob without it');
    P.set('viewer', P.get('viewer') === 'card' ? 'split' : 'card');
    P.flush();
    T.eq(saved().prefs.removedLongAgo, undefined, 'and this tab does not write it back');
  });

  T.test('a kept old key written after this tab loaded is carried, until forgotten', function () {
    P.keep('fromLater');
    var raw = saved();
    raw.prefs.fromLater = 'x';
    localStorage.setItem('mindroot2:prefs', JSON.stringify(raw));
    P.set('viewer', P.get('viewer') === 'card' ? 'split' : 'card');
    P.flush();
    T.eq(saved().prefs.fromLater, 'x', 'another tab wrote it: this tab\'s write keeps it');
    T.eq(P.forget('fromLater'), true, 'forgotten');
    T.eq(saved().prefs.fromLater, undefined, 'written without it at once');
  });

  T.test('reset', function () {
    P.reset('viewer');
    T.eq(P.get('viewer'), 'split', 'one key');
    P.reset();
    T.same(P.all().copies, { every: 1, unit: 'h' }, 'everything');
  });
})();
