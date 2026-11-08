/* MindRoot - preferences: one versioned JSON blob in localStorage.
 *
 * Read once when this file loads, so every module can ask for a preference
 * from its own init. What was saved is deep-merged onto the defaults and
 * checked against them: an unknown key is dropped, a value of the wrong type
 * or outside its allowed set falls back to the default, and an object with a
 * known shape keeps only the fields it is supposed to have. A corrupted blob
 * therefore costs the preferences, never the boot.
 *
 * Writes are debounced (a slider sends many values) and flushed when the
 * page is hidden or goes away. localStorage can throw (private windows,
 * blocked site data, some file:// setups): then preferences live in memory
 * for the session and nothing else changes. Another tab changing them is
 * heard through the 'storage' event and applied here too.
 *
 * The theme is also mirrored, synchronously, to 'mindroot2:theme' so the
 * inline script in index.html can apply it before the first paint.
 *
 * Modules that need a preference of their own declare it with define().
 *
 * A preference this version no longer has is dropped like any unknown key,
 * but what the blob said for it can still be read once with legacy(key)
 * (the session reads the old 'direction' to keep the maps it laid out on
 * both sides as they were). A key read that way (or named with keep(key))
 * stays in the blob, whatever else this tab writes, until forget(key)
 * writes the blob without it - a read-only tab, which cannot act on it,
 * leaves it for the tab that can. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var KEY = 'mindroot2:prefs';
  var THEME_KEY = 'mindroot2:theme';
  var VERSION = 1;
  var WRITE_DELAY = 250;

  var DEFAULTS = {
    theme: 'system',
    lang: null,
    reduceTransparency: false,
    liquidGlass: true,
    appCursor: true,
    sidebarOpen: true,
    expanded: {},
    branchText: true,
    syncSelection: true,
    notesOpen: false,
    diceColors: false,
    /* A node let go on top of others: 'move' it to free space, move the others 'aside', or 'keep' as it is. */
    dropOverlap: 'move',
    sourceOpen: false,
    sourceHeight: 0.34,
    copies: { every: 1, unit: 'h' },
    export: { format: 'svg', notes: true, expand: true, drawings: false, paper: 'light' },
    pen: { tool: 'pen', color: '#15171c', size: 2, eraser: 'part' },
    /* What a new notebook (a board, a node's drawing) starts on: a paper of
     * ns.paper's catalogue and a background ('auto' or '#rrggbb'). A notebook
     * keeps its own once it is written. */
    notebook: { paper: 'dots', background: 'auto' },
    /* AI assistance (features/ai.js). The key is never here: it is kept by
     * ns.ai itself, apart from the preferences. Every feature that sends
     * something starts off; `labels` (who wrote each node, drawn on the map)
     * sends nothing and starts on. `chatScope`: what the chat may read of
     * where the person is ('node', 'map' or the whole 'project'); `chatMap`
     * is its older spelling (true: 'map'); `readProjects`: {projectId: true}
     * for the projects any chat may read, wherever it is opened;
     * `chatBoards`: what of the boards of the maps it reads goes too
     * ('off', the 'text' written on them, or also their 'pictures'). */
    ai: { provider: 'anthropic', model: '', baseUrl: '', keyMode: 'session', complete: false, branches: false, emoji: false, images: false, describe: false, outline: false, outlineBodies: false, lang: '', imageModel: '', labels: true, ghost: false, chat: false, chatMap: false, chatScope: 'node', readProjects: {}, chatBoards: 'text' },
    viewer: 'split',
    noteSize: null
  };

  /* Allowed values, by key or by 'key.field'. */
  var ENUMS = {
    theme: ['system', 'light', 'dark'],
    lang: [null, 'en', 'it'],
    viewer: ['split', 'full', 'card'],
    'copies.unit': ['m', 'h'],
    'export.format': ['svg', 'png', 'pdf', 'md'],
    'export.paper': ['light', 'dark'],
    'pen.eraser': ['part', 'stroke', 'area'],
    dropOverlap: ['move', 'aside', 'keep'],
    'ai.provider': ['anthropic', 'openai', 'custom'],
    'ai.keyMode': ['session', 'device', 'locked'],
    'ai.chatScope': ['node', 'map', 'project'],
    'ai.chatBoards': ['off', 'text', 'pictures']
  };
  /* Numbers kept inside a range: a value from an older version or a hand
   * edit must not make a panel zero or 100 times too tall. */
  var RANGES = {
    sourceHeight: [0.1, 0.9],
    'copies.every': [1, 999],
    'pen.size': [0.5, 64]
  };
  /* Objects whose keys are data (project ids), not a fixed shape. */
  var MAPS = { expanded: 'boolean', 'ai.readProjects': 'boolean' };
  /* Values that may be null or any plain JSON value of the module's choosing. */
  var FREE = { noteSize: true };

  var values = clone(DEFAULTS);
  var listeners = Object.create(null);
  var storageOk = true;
  var timer = null;

  function clone(v) { return v == null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isPlain(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  /* The value to keep, or undefined to fall back to the default. */
  function coerce(path, value, def) {
    if (ENUMS[path]) return ENUMS[path].indexOf(value) >= 0 ? value : undefined;
    if (FREE[path]) return value === undefined ? undefined : clone(value);
    if (MAPS[path]) {
      if (!isPlain(value)) return undefined;
      var out = {};
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k) && typeof value[k] === MAPS[path]) out[k] = value[k];
      }
      return out;
    }
    if (typeof def === 'boolean') return typeof value === 'boolean' ? value : undefined;
    if (typeof def === 'number') {
      if (typeof value !== 'number' || !isFinite(value)) return undefined;
      var r = RANGES[path];
      return r ? Math.min(r[1], Math.max(r[0], value)) : value;
    }
    if (typeof def === 'string') return typeof value === 'string' ? value : undefined;
    if (isPlain(def)) {
      if (!isPlain(value)) return undefined;
      var shaped = {};
      for (var f in def) {
        var got = Object.prototype.hasOwnProperty.call(value, f) ? coerce(path + '.' + f, value[f], def[f]) : undefined;
        shaped[f] = got === undefined ? clone(def[f]) : got;
      }
      return shaped;
    }
    if (def === null) return value === null ? null : undefined;
    return undefined;
  }

  function read() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (err) {
      storageOk = false;
      return;
    }
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (err) { return; }
    var body = isPlain(saved) && isPlain(saved.prefs) ? saved.prefs : null;
    if (!body) return;
    for (var key in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      var v = coerce(key, body[key], DEFAULTS[key]);
      if (v !== undefined) values[key] = v;
    }
  }

  function write() {
    timer = null;
    if (!storageOk) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ v: VERSION, prefs: withKept(values) }));
      return true;
    } catch (err) {
      /* Quota or a policy change mid-session: stay in memory. */
      return false;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, WRITE_DELAY);
  }

  function flush() {
    if (!timer) return true;
    clearTimeout(timer);
    return write();
  }

  function mirrorTheme(theme) {
    if (!storageOk) return;
    try {
      if (theme === 'system') window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, theme);
    } catch (err) { /* the next boot follows the system until storage works */ }
  }

  function notify(key, value) {
    var list = (listeners[key] || []).concat(listeners['*'] || []);
    for (var i = 0; i < list.length; i++) {
      try { list[i](clone(value), key); } catch (err) { setTimeout(function () { throw err; }, 0); }
    }
    if (ns.bus) {
      ns.bus.emit('prefs', { key: key, value: clone(value) });
      if (key === 'theme') ns.bus.emit('theme', { key: key, value: value });
    }
  }

  function get(key) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
    return clone(values[key]);
  }

  /* Objects with a fixed shape merge onto what is there, so
   * set('export', {format: 'pdf'}) changes one field. Returns whether
   * anything changed. */
  function set(key, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      if (window.console) console.warn('prefs: unknown key ' + key + ' (declare it with prefs.define)');
      return false;
    }
    var def = DEFAULTS[key];
    var incoming = value;
    if (isPlain(def) && !MAPS[key] && !FREE[key] && isPlain(value)) {
      /* Loading forgives a bad field (it falls back to its default); a
       * set() with one is a bug in the caller, so it is refused whole. */
      for (var g in value) {
        if (!Object.prototype.hasOwnProperty.call(def, g) || coerce(key + '.' + g, value[g], def[g]) === undefined) {
          if (window.console) console.warn('prefs: refused ' + key + '.' + g + ' = ' + JSON.stringify(value[g]));
          return false;
        }
      }
      incoming = clone(values[key]);
      for (var f in value) incoming[f] = value[f];
    }
    var next = coerce(key, incoming, def);
    if (next === undefined) {
      if (window.console) console.warn('prefs: refused ' + key + ' = ' + JSON.stringify(value));
      return false;
    }
    if (same(next, values[key])) return false;
    values[key] = next;
    if (key === 'theme') mirrorTheme(next);
    schedule();
    notify(key, next);
    return true;
  }

  function on(key, fn) {
    (listeners[key] || (listeners[key] = [])).push(fn);
    return function off() {
      var list = listeners[key];
      var i = list ? list.indexOf(fn) : -1;
      if (i >= 0) list.splice(i, 1);
    };
  }

  /* A module's own preference: define('myPanel', {open: false}, {enums: {'myPanel.side': ['l','r']}}).
   * Saved values for it are read back now, since the blob was read before
   * the module could declare it. */
  var savedRaw = null;
  function define(key, def, opts) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return get(key);
    DEFAULTS[key] = clone(def);
    opts = opts || {};
    var e = opts.enums || {};
    for (var p in e) ENUMS[p] = e[p].slice();
    var r = opts.ranges || {};
    for (var q in r) RANGES[q] = r[q].slice();
    if (opts.map) MAPS[key] = opts.map;
    if (opts.free) FREE[key] = true;
    values[key] = clone(def);
    if (savedRaw && Object.prototype.hasOwnProperty.call(savedRaw, key)) {
      var v = coerce(key, savedRaw[key], def);
      if (v !== undefined) values[key] = v;
    }
    return get(key);
  }

  /* What the saved blob said for a key this version does not know (an old
   * preference), or undefined. A key read that way is kept: it stays in the
   * blob, whatever else this tab writes, until forget(key) - a tab that
   * cannot act on it yet (read-only) leaves it for the tab that will - and
   * another tab writing it, or dropping it, is heard (onStorage), so a key
   * another tab has taken care of is gone here too. keep(key) does the same
   * without reading it. */
  var kept = Object.create(null);
  function keep(key) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) kept[key] = true;
  }

  /* The prefs body of the blob as it is in localStorage now; null when
   * there is none or it cannot be read. */
  function currentBody() {
    if (!storageOk) return null;
    try {
      var parsed = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      return isPlain(parsed) && isPlain(parsed.prefs) ? parsed.prefs : null;
    } catch (err) { return null; }
  }

  function legacy(key) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
    keep(key);
    if (!savedRaw || !Object.prototype.hasOwnProperty.call(savedRaw, key)) return undefined;
    return clone(savedRaw[key]);
  }

  /* What is written: this tab's values, and the kept old keys - as this tab
   * read them, or else as the blob has them now (written after this tab
   * loaded, by a tab that knows the key). */
  function withKept(prefs) {
    var body = null;
    var out = prefs;
    for (var key in kept) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
      var from = savedRaw;
      if (!from || !Object.prototype.hasOwnProperty.call(from, key)) {
        if (!body) body = currentBody() || {};
        from = body;
      }
      if (!Object.prototype.hasOwnProperty.call(from, key)) continue;
      if (out === prefs) { out = {}; for (var k in prefs) out[k] = prefs[k]; }
      out[key] = from[key];
    }
    return out;
  }

  /* An old preference has been taken care of: the blob is written again
   * without it, at once, so it is not read a second time - here or in
   * another tab. */
  function forget(key) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
    delete kept[key];
    var body = currentBody();
    var there = (!!savedRaw && Object.prototype.hasOwnProperty.call(savedRaw, key)) || (!!body && Object.prototype.hasOwnProperty.call(body, key));
    if (savedRaw) delete savedRaw[key];
    if (!there) return false;
    if (timer) { clearTimeout(timer); timer = null; }
    write();
    return true;
  }

  function reset(key) {
    if (key) return set(key, clone(DEFAULTS[key]));
    var changed = false;
    for (var k in DEFAULTS) changed = set(k, clone(DEFAULTS[k])) || changed;
    return changed;
  }

  function defaults() { return clone(DEFAULTS); }
  function all() { return clone(values); }
  function available() { return storageOk; }

  /* Another tab wrote: take its values and tell our listeners, without
   * writing back (which would ping-pong between the tabs). */
  function onStorage(event) {
    if (event.key !== KEY || event.newValue == null) return;
    var saved;
    try { saved = JSON.parse(event.newValue); } catch (err) { return; }
    var body = isPlain(saved) && isPlain(saved.prefs) ? saved.prefs : null;
    if (!body) return;
    /* A kept old key follows the other tab: written there, or let go. */
    for (var old in kept) {
      if (Object.prototype.hasOwnProperty.call(body, old)) {
        if (!savedRaw) savedRaw = {};
        savedRaw[old] = body[old];
      } else if (savedRaw) {
        delete savedRaw[old];
      }
    }
    for (var key in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      var v = coerce(key, body[key], DEFAULTS[key]);
      if (v === undefined || same(v, values[key])) continue;
      values[key] = v;
      notify(key, v);
    }
  }

  read();
  try {
    var rawAll = storageOk ? window.localStorage.getItem(KEY) : null;
    var parsed = rawAll ? JSON.parse(rawAll) : null;
    savedRaw = isPlain(parsed) && isPlain(parsed.prefs) ? parsed.prefs : null;
  } catch (err) { savedRaw = null; }

  window.addEventListener('storage', onStorage);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  ns.prefs = {
    get: get,
    set: set,
    on: on,
    define: define,
    legacy: legacy,
    keep: keep,
    forget: forget,
    reset: reset,
    flush: flush,
    defaults: defaults,
    all: all,
    available: available,
    KEY: KEY,
    THEME_KEY: THEME_KEY
  };
})(window.MindRoot);
