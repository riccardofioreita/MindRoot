/* MindRoot - small helpers every module shares.
 *
 * DOM building without innerHTML (h), escaping, ids, slugs, timing helpers,
 * file pickers and downloads that work from file://, hashing with a fallback
 * for engines without crypto.subtle, platform facts, and Intl formatting in
 * the current language. Nothing here keeps state worth persisting; the
 * platform facts are refreshed when the pointer or display mode changes. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  /* ---------------------------------------------------------------- DOM */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  /* Tags built in the SVG namespace. 'a', 'title', 'style' and 'script'
   * exist in both and default to HTML; pass 'svg:title' to force SVG. */
  var SVG_TAGS = {
    svg: 1, use: 1, path: 1, g: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1,
    ellipse: 1, defs: 1, symbol: 1, text: 1, tspan: 1, marker: 1, clipPath: 1, mask: 1,
    linearGradient: 1, radialGradient: 1, stop: 1, pattern: 1, image: 1, foreignObject: 1,
    filter: 1, metadata: 1
  };
  /* Set as properties, not attributes, so the live state is what changes;
   * and set after the children, because a <select>'s value can only pick
   * one of the options it already has. */
  var PROPS = { value: 1, checked: 1, selected: 1, indeterminate: 1, muted: 1 };

  function appendChildren(el, list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) { appendChildren(el, c); continue; }
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  /* h('button', {class: 'btn', on: {click: fn}, 'aria-label': t('x')}, child, ...)
   * Strings become text nodes, so user text can never turn into markup; the
   * one way in for markup is attrs.html, for trusted strings only. */
  function h(tag, attrs) {
    var svg = false;
    if (tag.indexOf('svg:') === 0) { svg = true; tag = tag.slice(4); } else if (SVG_TAGS[tag]) svg = true;
    var el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (attrs && (attrs instanceof Node || Array.isArray(attrs) || typeof attrs !== 'object')) {
      children.unshift(attrs);
      attrs = null;
    }
    var props = null;
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var v = attrs[key];
        /* checked: false is a state to set; value: false is "no value". */
        if (PROPS[key] && !svg && v != null && !(v === false && key === 'value')) { (props || (props = [])).push(key, v); continue; }
        if (v == null || v === false) continue;
        if (key === 'class' || key === 'className') {
          var cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
          if (cls) el.setAttribute('class', cls);
        } else if (key === 'text') {
          el.textContent = String(v);
        } else if (key === 'html') {
          el.innerHTML = String(v);
        } else if (key === 'on') {
          for (var type in v) if (typeof v[type] === 'function') el.addEventListener(type, v[type]);
        } else if (key === 'style' && typeof v === 'object') {
          for (var prop in v) {
            if (v[prop] == null) continue;
            if (prop.indexOf('--') === 0 || prop.indexOf('-') > 0) el.style.setProperty(prop, String(v[prop]));
            else el.style[prop] = String(v[prop]);
          }
        } else if (key === 'dataset' && typeof v === 'object') {
          for (var dk in v) if (v[dk] != null) el.dataset[dk] = String(v[dk]);
        } else if (v === true) {
          el.setAttribute(key, '');
        } else {
          el.setAttribute(key, String(v));
        }
      }
    }
    appendChildren(el, children);
    if (props) for (var p = 0; p < props.length; p += 2) el[props[p]] = props[p + 1];
    return el;
  }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  /* ---------------------------------------------------------------- ids, text */

  var counter = 0;
  /* prefix + time (base 36) + a rolling counter + 4 random characters: sorts
   * roughly by creation, never collides within a page, short enough to read
   * in a file name. */
  function uid(prefix) {
    counter = (counter + 1) % 46656;
    var rnd = '';
    while (rnd.length < 4) rnd += Math.random().toString(36).slice(2);
    return (prefix == null ? 'p' : String(prefix)) + Date.now().toString(36) + counter.toString(36) + rnd.slice(0, 4);
  }

  /* Unicode-aware: 'Città di Mélisande' -> 'citta-di-melisande', '東京 2024'
   * -> '東京-2024'. ASCII-only slugs turn non-Latin titles into nothing. */
  var NON_WORD = /[^\p{L}\p{N}]+/gu;
  var MARKS = /\p{M}+/gu;
  function slugify(name, fallback) {
    var s = String(name == null ? '' : name).normalize('NFD').replace(MARKS, '').normalize('NFC').toLowerCase();
    s = s.replace(NON_WORD, '-').replace(/^-+|-+$/g, '');
    if (s.length > 60) s = Array.from(s).slice(0, 60).join('').replace(/-+$/g, '');
    return s || (fallback == null ? 'untitled' : String(fallback));
  }

  function clamp(v, lo, hi) {
    if (hi < lo) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  var collators = {};
  function naturalCompare(a, b) {
    var lang = locale();
    var c = collators[lang] || (collators[lang] = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' }));
    return c.compare(String(a == null ? '' : a), String(b == null ? '' : b));
  }

  /* ---------------------------------------------------------------- timing */

  function debounce(fn, ms) {
    var timer = null;
    var lastArgs = null;
    var lastThis = null;
    function debounced() {
      lastArgs = arguments;
      lastThis = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    }
    function run() {
      timer = null;
      var args = lastArgs;
      lastArgs = null;
      return fn.apply(lastThis, args || []);
    }
    debounced.flush = function () {
      if (!timer) return undefined;
      clearTimeout(timer);
      return run();
    };
    debounced.cancel = function () {
      if (timer) clearTimeout(timer);
      timer = null;
      lastArgs = null;
    };
    debounced.pending = function () { return !!timer; };
    return debounced;
  }

  /* At most one call per frame, with the latest arguments: pointermove and
   * resize handlers read layout once per frame, not once per event. */
  function throttleFrame(fn) {
    var frame = 0;
    var lastArgs = null;
    var lastThis = null;
    function throttled() {
      lastArgs = arguments;
      lastThis = this;
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        var args = lastArgs;
        lastArgs = null;
        fn.apply(lastThis, args || []);
      });
    }
    throttled.cancel = function () {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastArgs = null;
    };
    return throttled;
  }

  /* A hidden tab gets no animation frames at all, so the timeout keeps an
   * await nextFrame() from hanging there. */
  function nextFrame() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      requestAnimationFrame(finish);
      setTimeout(finish, 50);
    });
  }

  /* ---------------------------------------------------------------- files */

  /* a[download] with the object URL kept alive for 30 s: revoking at once
   * cancels the download in Safari and Firefox. In an iOS home-screen app
   * a[download] does nothing, so the share sheet ("Save to Files") stands in. */
  function download(blob, filename) {
    filename = filename || 'download';
    if (isIOS() && util.isStandalone && navigator.canShare && typeof File === 'function') {
      try {
        var file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: filename }).then(function () { return true; }, function (err) {
            if (err && err.name === 'AbortError') return false;
            return anchorDownload(blob, filename);
          });
        }
      } catch (err) { /* fall through to the anchor */ }
    }
    return Promise.resolve(anchorDownload(blob, filename));
  }

  function anchorDownload(blob, filename) {
    var href = URL.createObjectURL(blob);
    var a = h('a', { href: href, download: filename, rel: 'noopener', style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
    return true;
  }

  /* Resolves with the chosen files, or [] when the picker is dismissed. The
   * 'cancel' event is recent (Chrome 113, Safari 16.4); where it is missing,
   * focus coming back with nothing chosen is read as a cancel, after a pause
   * long enough for the 'change' that follows a real choice. */
  function pickFiles(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var input = h('input', {
        type: 'file',
        accept: opts.accept || null,
        multiple: !!opts.multiple,
        tabindex: -1,
        'aria-hidden': 'true',
        style: { position: 'fixed', left: '-9999px', width: '1px', height: '1px', opacity: '0' }
      });
      if (opts.directory) {
        input.setAttribute('webkitdirectory', '');
        input.setAttribute('directory', '');
      }
      var settled = false;
      function finish(files) {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(files);
      }
      function onFocus() {
        setTimeout(function () { if (!input.files || !input.files.length) finish([]); }, 1000);
      }
      input.addEventListener('change', function () { finish(Array.prototype.slice.call(input.files || [])); });
      input.addEventListener('cancel', function () { finish([]); });
      if (!('oncancel' in input)) window.addEventListener('focus', onFocus);
      document.body.appendChild(input);
      try { input.click(); } catch (err) { finish([]); }
    });
  }

  function read(blob, how, encoding) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.onabort = function () { reject(new Error('read aborted')); };
      if (how === 'text') reader.readAsText(blob, encoding || 'utf-8');
      else if (how === 'buffer') reader.readAsArrayBuffer(blob);
      else reader.readAsDataURL(blob);
    });
  }
  function readAsText(file, encoding) { return read(file, 'text', encoding); }
  function readAsArrayBuffer(file) { return read(file, 'buffer'); }
  function readAsDataURL(blob) { return read(blob, 'url'); }

  /* ---------------------------------------------------------------- hashing */

  function toBytes(input) {
    if (typeof input === 'string') return new TextEncoder().encode(input);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new TypeError('sha256: bytes or a string');
  }

  function hex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  /* crypto.subtle exists only in secure contexts; file:// is one in
   * Chromium and Firefox but not everywhere, so a plain implementation
   * (FIPS 180-4) stands behind it. Same digest either way. */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Sync(bytes) {
    var len = bytes.length;
    var blocks = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(blocks);
    buf.set(bytes);
    buf[len] = 0x80;
    var bits = len * 8;
    var view = new DataView(buf.buffer);
    view.setUint32(blocks - 4, bits >>> 0);
    view.setUint32(blocks - 8, Math.floor(bits / 4294967296));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Uint32Array(64);
    for (var off = 0; off < blocks; off += 64) {
      for (var t = 0; t < 16; t++) W[t] = view.getUint32(off + t * 4);
      for (t = 16; t < 64; t++) {
        var w15 = W[t - 15], w2 = W[t - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t] + W[t]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    var ov = new DataView(out.buffer);
    for (var i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  }

  /* Synchronous, for small inputs and for tests of the fallback. */
  function sha256Hex(input) { return hex(sha256Sync(toBytes(input))); }

  function sha256(input) {
    var bytes;
    try { bytes = toBytes(input); } catch (err) { return Promise.reject(err); }
    var subtle = window.crypto && window.crypto.subtle;
    if (subtle && window.isSecureContext !== false) {
      return subtle.digest('SHA-256', bytes).then(function (buf) { return hex(new Uint8Array(buf)); }, function () {
        return hex(sha256Sync(bytes));
      });
    }
    return Promise.resolve(hex(sha256Sync(bytes)));
  }

  /* ---------------------------------------------------------------- platform */

  function media(q) {
    try { return window.matchMedia ? window.matchMedia(q) : null; } catch (err) { return null; }
  }
  function matches(q) { var m = media(q); return !!(m && m.matches); }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function detectMac() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return /mac|iphone|ipad|ipod/i.test(p) || /Mac OS X/.test(navigator.userAgent || '') && !/Windows/.test(navigator.userAgent || '');
  }

  function reducedMotion() {
    var root = document.documentElement;
    if (root && root.getAttribute('data-motion') === 'reduce') return true;
    return matches('(prefers-reduced-motion: reduce)');
  }

  function reducedTransparency() {
    var root = document.documentElement;
    if (root && root.getAttribute('data-transparency') === 'reduce') return true;
    return matches('(prefers-reduced-transparency: reduce)');
  }

  /* Text fields keep their keys: a shortcut must never steal a letter from
   * someone typing. Checkboxes and buttons are not text fields. */
  var NOT_TEXT = { checkbox: 1, radio: 1, button: 1, submit: 1, reset: 1, color: 1, file: 1, image: 1, hidden: 1 };
  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !NOT_TEXT[(el.getAttribute('type') || 'text').toLowerCase()];
    return !!el.isContentEditable;
  }

  function refreshPlatform() {
    util.isTouch = matches('(pointer: coarse)');
    util.isStandalone = matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)') || navigator.standalone === true;
  }

  /* ---------------------------------------------------------------- dates */

  function currentLang() {
    try { return (ns.i18n && ns.i18n.lang && ns.i18n.lang()) || 'en'; } catch (err) { return 'en'; }
  }

  /* The browser's own regional variant of the interface language, when it
   * has one: an English interface read in Britain shows 14:05, not 2:05 PM.
   * Otherwise the bare language. */
  function locale() {
    var lang = currentLang();
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i] || '');
      if (l.toLowerCase().indexOf(lang) === 0) {
        try { return Intl.DateTimeFormat.supportedLocalesOf([l]).length ? l : lang; } catch (err) { return lang; }
      }
    }
    return lang;
  }

  var STYLES = {
    date: { day: 'numeric', month: 'short', year: 'numeric' },
    short: { day: 'numeric', month: 'short' },
    long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
    time: { hour: '2-digit', minute: '2-digit' },
    datetime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    numeric: { day: '2-digit', month: '2-digit', year: 'numeric' }
  };
  var formatters = {};
  function formatDate(ms, style) {
    var d = ms instanceof Date ? ms : new Date(ms);
    if (isNaN(d.getTime())) return '';
    var loc = locale();
    var key = loc + '|' + (style || 'datetime');
    var f = formatters[key] || (formatters[key] = new Intl.DateTimeFormat(loc, STYLES[style] || STYLES.datetime));
    return f.format(d);
  }

  /* 'now', '5 minutes ago', 'yesterday', then a plain date after a week:
   * "12 days ago" makes the reader do sums. A date in the future (another
   * device's clock) within a minute reads as now, beyond it as a date. */
  var rtfs = {};
  function relativeTime(ms, now) {
    var then = ms instanceof Date ? ms.getTime() : Number(ms);
    if (!isFinite(then)) return '';
    now = now == null ? Date.now() : now;
    var diff = (then - now) / 1000;
    var lang = locale();
    var rtf = rtfs[lang] || (rtfs[lang] = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }));
    var abs = Math.abs(diff);
    if (diff > 60) return formatDate(then, 'datetime');
    /* 'ora' is what Intl says in Italian, and reads as 'hour' in a list
     * of copies: the app's own words when it has them. */
    if (abs < 45) return ns.i18n && ns.i18n.has && ns.i18n.has('time.justNow') ? ns.i18n.t('time.justNow') : rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    var startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    if (then >= startToday.getTime()) return rtf.format(Math.round(diff / 3600), 'hour');
    var days = Math.ceil((startToday.getTime() - then) / 86400000);
    if (days <= 7) return rtf.format(-days, 'day');
    return formatDate(then, 'date');
  }

  /* A text field's own undo, run by run. Chromium closes its typing run
   * whenever script changes any text in the document (a save pill, a live
   * region, a painted row of the Markdown panel), so the native undo of a
   * field the app watches takes back one letter per press. The field keeps
   * its own steps instead: io.read() -> a state ({text, ...}) and
   * io.write(state). before(inputType, data) is called on beforeinput: a run
   * of the same kind of edit (typing, deleting), each starting where the
   * last one left the caret and less than a pause apart, is one step.
   * record() marks a step before an edit the app makes itself (a mark, a
   * chip); reset() forgets everything (the text was replaced from outside). */
  function typingHistory(io) {
    var PAUSE = 1500;
    var LIMIT = 200;
    var past = [];
    var future = [];
    var run = null;           // {kind, at, caret}: the run a next edit may join
    function kindOf(type) {
      if (/^delete/.test(type)) return 'delete';
      if (type === 'insertText' || type === 'insertCompositionText' || type === 'insertReplacementText') return 'type';
      return 'other';
    }
    function keep(state) {
      if (!state) return;
      var top = past[past.length - 1];
      if (top && top.text === state.text) return;
      past.push(state);
      if (past.length > LIMIT) past.shift();
    }
    function before(type) {
      if (type === 'historyUndo' || type === 'historyRedo') return;
      var kind = kindOf(type || '');
      var now = Date.now();
      var state = io.read();
      var joins = run && kind !== 'other' && kind === run.kind && now - run.at < PAUSE &&
        state && state.caret === run.caret;
      if (!joins) keep(state);
      future = [];
      run = kind === 'other' ? null : { kind: kind, at: now, caret: null };
    }
    /* After the edit landed (the input event): where the run continues. */
    function after() {
      if (!run) return;
      var state = io.read();
      run.caret = state ? state.caret : null;
      run.at = Date.now();
    }
    function record() { keep(io.read()); future = []; run = null; }
    function undo() {
      var now = io.read();
      while (past.length && now && past[past.length - 1].text === now.text) past.pop();
      if (!past.length) return false;
      if (now) future.push(now);
      run = null;
      io.write(past.pop());
      return true;
    }
    function redo() {
      if (!future.length) return false;
      keep(io.read());
      run = null;
      io.write(future.pop());
      return true;
    }
    function reset() { past = []; future = []; run = null; }
    return { before: before, after: after, record: record, undo: undo, redo: redo, reset: reset,
      canUndo: function () { return past.length > 0; }, canRedo: function () { return future.length > 0; } };
  }

  /* Mod+Z, Mod+Shift+Z or Mod+Y on a keydown: 'undo', 'redo' or null. */
  function undoKey(e) {
    var mod = detectMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!mod || e.altKey) return null;
    var key = String(e.key || '').toLowerCase();
    if (key === 'z' || e.code === 'KeyZ') return e.shiftKey ? 'redo' : 'undo';
    if ((key === 'y' || e.code === 'KeyY') && !e.shiftKey) return 'redo';
    return null;
  }

  var util = {
    h: h,
    typingHistory: typingHistory,
    undoKey: undoKey,
    escapeHtml: escapeHtml,
    uid: uid,
    slugify: slugify,
    clamp: clamp,
    lerp: lerp,
    debounce: debounce,
    throttleFrame: throttleFrame,
    nextFrame: nextFrame,
    download: download,
    pickFiles: pickFiles,
    readAsText: readAsText,
    readAsArrayBuffer: readAsArrayBuffer,
    readAsDataURL: readAsDataURL,
    sha256: sha256,
    sha256Sync: sha256Hex,
    isMac: detectMac(),
    isIOS: isIOS(),
    isTouch: false,
    isStandalone: false,
    isFileProtocol: location.protocol === 'file:',
    isChromium: !!navigator.userAgentData,
    isTextField: isTextField,
    reducedMotion: reducedMotion,
    reducedTransparency: reducedTransparency,
    matches: matches,
    media: media,
    formatDate: formatDate,
    relativeTime: relativeTime,
    naturalCompare: naturalCompare,
    locale: locale
  };
  refreshPlatform();
  ['(pointer: coarse)', '(display-mode: standalone)'].forEach(function (q) {
    var m = media(q);
    if (m && m.addEventListener) m.addEventListener('change', refreshPlatform);
  });

  ns.util = util;
})(window.MindRoot);
