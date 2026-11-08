#!/usr/bin/env node
/* MindRoot - the static audit: what the page ships may never need a server
 * or the network.
 *
 *     node tools/static-audit.js     prints "STATIC AUDIT OK (controls caught: n/n)"
 *                                     and exits 0, or lists every finding and exits 1
 *
 * It reads index.html, every js/**.js, every css/**.css and vendor/*.js (all
 * of which the page loads, directly or lazily) and refuses:
 *
 *   module        <script type="module">, an import or export statement, a
 *                 dynamic import(), import.meta, a script element made with type 'module'
 *                 (modules do not load from file://);
 *   fetch         fetch( or XMLHttpRequest, bare or through window.,
 *                 self. or globalThis.: on file:// the browser refuses
 *                 them, and over http they would be the network. A line that
 *                 only ever reads blob: or data: URLs may say so with the
 *                 comment "audit: blob-or-data" and is then let through;
 *                 the one network call the app has - the optional AI
 *                 assistance, which the person switches on and feeds a key
 *                 (docs/ARCHITECTURE.md, promise 2) - is let through only in
 *                 js/features/ai.js, on a line saying "audit: ai-provider";
 *                 the same words anywhere else are a finding;
 *                 new Worker(, new SharedWorker( and importScripts( load a
 *                 file the same way and are held to the same rule;
 *   network       new WebSocket(, new EventSource(, sendBeacon(, new
 *                 RTCPeerConnection(: a connection out, whatever the address;
 *   remote        an address on another host - http(s)://, ws(s)://, ftp://
 *                 or protocol-relative //host - used as a resource: in src=,
 *                 href=, srcset= (every candidate), poster=, data= or action=
 *                 of the markup, quoted either way or not at all; in a
 *                 stylesheet's url() or @import, or a style attribute's; or
 *                 assigned to src, href or srcset in code, set with
 *                 setAttribute, or handed to new Worker() and the like; and
 *                 any string holding such an address of a file (.js, .css,
 *                 a picture, a font...), wherever it goes next (an address
 *                 in words, a comment, a page link or the SVG namespace is
 *                 not a resource);
 *   worker        a navigator.serviceWorker.register( in a file with no test
 *                 of location.protocol for http(s) ahead of it, or one run
 *                 straight at load time rather than from a function.
 *
 * Code is read token by token (strings, template literals, regular
 * expressions and comments told apart), so words in comments and strings
 * never count as code, and code inside strings never hides. A file whose
 * brackets no longer balance once that is done is reported too (rule
 * 'lexer'): the reading went wrong there, and a clean result would be a
 * guess.
 *
 * An absence check proves nothing unless it can see what it looks for: the
 * same rules are first run over planted controls in memory - one file per
 * mistake, each of which must be caught by the rule meant for it - and over
 * clean look-alikes that must not be. Only when every control behaves is
 * the real tree read. Node built-ins only. */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

/* ---------------------------------------------------------------- the JS lexer */

/* Splits source into code (with strings, regexes and comments blanked to
 * spaces, newlines kept so line numbers hold) and the list of string
 * literals with their lines. Good enough for hand-written ES2020. */
function lex(src) {
  var code = '';
  var strings = [];
  var i = 0;
  var n = src.length;
  var line = 1;
  var lastSignificant = '';
  var lastWord = '';
  var templateDepth = [];
  /* What opened each round bracket: after the ) of if (...), while (...),
   * for (...) or with (...) a slash starts a regular expression, after any
   * other ) it divides. */
  var parens = [];
  var afterCondition = false;
  function blank(text) { return text.replace(/[^\n]/g, ' '); }
  function regexAllowed() {
    if (!lastSignificant) return true;
    if (lastSignificant === ')') return afterCondition;
    if (/[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant)) return true;
    return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(lastWord);
  }
  while (i < n) {
    var c = src[i];
    var d = src[i + 1];
    if (c === '/' && d === '/') {
      var end = src.indexOf('\n', i);
      if (end < 0) end = n;
      code += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      var close = src.indexOf('*/', i + 2);
      if (close < 0) close = n - 2;
      var chunk = src.slice(i, close + 2);
      line += (chunk.match(/\n/g) || []).length;
      code += blank(chunk);
      i = close + 2;
      continue;
    }
    if (c === '\'' || c === '"') {
      var j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      strings.push({ value: src.slice(i + 1, j), line: line, at: code.length });
      code += c + blank(src.slice(i + 1, j)) + c;
      i = j + 1;
      lastSignificant = c;
      lastWord = '';
      continue;
    }
    if (c === '`' || (c === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === 0)) {
      if (c === '}') templateDepth.pop();
      var k = i + 1;
      var text = '';
      while (k < n && src[k] !== '`' && !(src[k] === '$' && src[k + 1] === '{')) {
        if (src[k] === '\\') { text += src.slice(k, k + 2); k += 2; continue; }
        text += src[k];
        k++;
      }
      strings.push({ value: text, line: line, at: code.length });
      line += (text.match(/\n/g) || []).length;
      code += c + blank(text);
      if (src[k] === '$') { code += '${'; templateDepth.push(0); i = k + 2; } else { code += '`'; i = k + 1; }
      lastSignificant = '`';
      lastWord = '';
      continue;
    }
    if (c === '{' && templateDepth.length) templateDepth[templateDepth.length - 1]++;
    if (c === '}' && templateDepth.length) templateDepth[templateDepth.length - 1]--;
    if (c === '/' && regexAllowed()) {
      var r = i + 1;
      var inClass = false;
      while (r < n && src[r] !== '\n') {
        if (src[r] === '\\') { r += 2; continue; }
        if (src[r] === '[') inClass = true;
        else if (src[r] === ']') inClass = false;
        else if (src[r] === '/' && !inClass) break;
        r++;
      }
      while (r + 1 < n && /[a-z]/i.test(src[r + 1])) r++;
      code += '/' + blank(src.slice(i + 1, r)) + (src[r] === '/' ? '/' : ' ');
      i = r + 1;
      lastSignificant = '/';
      lastWord = '';
      continue;
    }
    if (c === '\n') line++;
    if (c === '(') parens.push(/^(if|while|for|with)$/.test(lastWord) && lastSignificant === lastWord[lastWord.length - 1]);
    if (c === ')') afterCondition = !!parens.pop();
    code += c;
    if (!/\s/.test(c)) {
      lastSignificant = c;
      if (/[A-Za-z_$]/.test(c)) {
        var w = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))[0];
        code += w.slice(1);
        i += w.length;
        lastWord = w;
        lastSignificant = w[w.length - 1];
        continue;
      }
      lastWord = '';
    }
    i++;
  }
  return { code: code, strings: strings };
}

function lineAt(text, index) { return text.slice(0, index).split('\n').length; }

/* An address on another host: a scheme that reaches out, or // and a host
 * (protocol-relative, which on http means the network and on file:// means
 * a file share). */
var REMOTE = /^\s*(?:(?:https?|wss?|ftp):)?\/\/[^\/\s'"]/i;
function isRemote(value) { return REMOTE.test(String(value)); }
/* srcset (and imagesrcset): candidates split by commas, each an address and
 * an optional descriptor. The first remote one, or null. */
function remoteInSrcset(value) {
  var parts = String(value).split(/,\s+|,(?=\S)/);
  for (var i = 0; i < parts.length; i++) {
    var addr = parts[i].trim().split(/\s+/)[0];
    if (addr && isRemote(addr)) return addr;
  }
  return null;
}
function remoteValue(name, value) {
  if (/srcset$/i.test(name)) return remoteInSrcset(value);
  return isRemote(value) ? String(value).trim() : null;
}

/* ---------------------------------------------------------------- the rules */

/* The lexer kept its place through the file when every bracket it left as
 * code closes: a regular expression read as a division, or a quote missed,
 * would blank or expose the wrong text and almost always unbalance them. */
function balanced(code) {
  var counts = { '{': 0, '(': 0, '[': 0 };
  var pair = { '}': '{', ')': '(', ']': '[' };
  for (var i = 0; i < code.length; i++) {
    var ch = code[i];
    if (counts[ch] !== undefined) counts[ch]++;
    else if (pair[ch]) counts[pair[ch]]--;
  }
  return !counts['{'] && !counts['('] && !counts['['];
}

/* The one file that may call fetch( at a provider the person chose. */
var AI_PROVIDER_FILE = /(^|\/)js\/features\/ai\.js$/;

function auditJs(file, src) {
  var out = [];
  var L = lex(src);
  var code = L.code;
  if (!balanced(code)) out.push({ rule: 'lexer', file: file, line: 1, what: 'brackets do not balance once strings, regexes and comments are set aside: the audit lost its place here' });
  var lines = src.split('\n');
  function add(rule, index, what) { out.push({ rule: rule, file: file, line: lineAt(code, index), what: what }); }
  var m;
  var re;

  re = /(^|[;{}\n])\s*(import(?:\s+[\w$*{]|\s*[{*(]|\s*['"`])|export\s+(?:default|function|class|const|let|var|async|\{|\*)|export\s*[{*])/g;
  while ((m = re.exec(code))) add('module', m.index + m[1].length, m[2].trim().split(/\s+/).slice(0, 2).join(' '));
  re = /(^|[^\w$.])import\s*\(/g;
  while ((m = re.exec(code))) add('module', m.index, 'dynamic import()');
  re = /(^|[^\w$.])import\s*\.\s*meta\b/g;
  while ((m = re.exec(code))) add('module', m.index, 'import.meta');
  L.strings.forEach(function (s) {
    if (s.value === 'module') {
      var before = code.slice(Math.max(0, s.at - 40), s.at);
      if (/type\s*[:=]\s*$|['"]type['"]\s*,\s*$/.test(before)) add('module', s.at, "a script of type 'module'");
    }
  });

  /* fetch( and XMLHttpRequest, bare or as a property of the global object;
   * a member of anything else (cache.fetch, a module's own) is not them. */
  re = /(^|[^\w$.])((?:(?:window|self|globalThis)\s*\.\s*)?(?:fetch\s*\(|XMLHttpRequest\b))/g;
  while ((m = re.exec(code))) {
    var ln = lineAt(code, m.index);
    if (/audit:\s*blob-or-data/.test(lines[ln - 1] || '')) continue;
    if (AI_PROVIDER_FILE.test(String(file).replace(/\\/g, '/')) && /audit:\s*ai-provider/.test(lines[ln - 1] || '') && /^fetch\(/.test(m[2])) continue;
    add('fetch', m.index + m[1].length, m[2].replace(/\s+/g, '').replace(/\($/, '('));
  }
  re = /(^|[^\w$])(new\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:WebSocket|EventSource|RTCPeerConnection|webkitRTCPeerConnection)\b|sendBeacon\s*\()/g;
  while ((m = re.exec(code))) add('network', m.index + m[1].length, m[2].replace(/\s+/g, ' '));
  /* A worker script is loaded the way fetch loads: from file:// the browser
   * refuses it. One made from a blob: or data: URL may say so. */
  re = /(^|[^\w$.])(new\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:Worker|SharedWorker)\s*\(|importScripts\s*\()/g;
  while ((m = re.exec(code))) {
    if (/audit:\s*blob-or-data/.test(lines[lineAt(code, m.index) - 1] || '')) continue;
    add('fetch', m.index + m[1].length, m[2].replace(/\s+/g, ' '));
  }

  L.strings.forEach(function (s, idx) {
    var before = code.slice(Math.max(0, s.at - 60), s.at);
    /* setAttribute('src', 'https://...'): the name is the string before. */
    var prev = L.strings[idx - 1];
    var attrName = !!prev && /^(src|href|srcset|imagesrcset|poster|xlink:href|data|action|formaction)$/i.test(prev.value) &&
      /^['"][^'"]*['"]\s*,\s*$/.test(code.slice(prev.at, s.at)) &&
      /setAttribute(?:NS)?\s*\(\s*(?:[^,()]*,\s*)?$/.test(code.slice(Math.max(0, prev.at - 60), prev.at)) ? prev.value : null;
    var prop = /(?:^|[^\w$])(src|href|srcset|imagesrcset|poster|data|action|formaction)\s*[:=]\s*$/i.exec(before);
    var name = attrName || (prop && prop[1]);
    var hit = name ? remoteValue(name, s.value) : null;
    if (!hit && (/url\(\s*$/.test(before) || /(new\s+(?:Worker|SharedWorker|EventSource|WebSocket)|importScripts|sendBeacon|open)\s*\(\s*$/.test(before)) && isRemote(s.value)) hit = s.value;
    /* Kept in a variable first: an address on another host that names a
     * file the page could load (a script, a sheet, a font, a picture...) is
     * a resource wherever it ends up. A page address (a credit's link) is
     * not. */
    if (!hit && isRemote(s.value) && /^\s*\S+\.(m?js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|json|wasm|mp[34]|webm)(?:[?#]\S*)?\s*$/i.test(s.value)) hit = s.value;
    if (hit) add('remote', s.at, hit);
    /* Markup or CSS written inside a string. */
    var mm = /url\(\s*['"]?((?:(?:https?|wss?|ftp):)?\/\/[^\/\s'")][^'")\s]*)/i.exec(s.value);
    if (mm) add('remote', s.at, 'url(' + mm[1] + ')');
    var tagRe = /<[a-z][\w-]*\b[^>]*?\s(src|href|srcset|poster|data|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"]+))/gi;
    var tm;
    while ((tm = tagRe.exec(s.value))) {
      var v = tm[2] !== undefined ? tm[2] : tm[3] !== undefined ? tm[3] : tm[4];
      var r = remoteValue(tm[1], v);
      if (r) add('remote', s.at, tm[1] + '=' + r);
    }
  });

  re = /serviceWorker\s*\.\s*register\s*\(/g;
  while ((m = re.exec(code))) {
    var head = code.slice(0, m.index);
    var guarded = /location\s*\.\s*protocol/.test(head) && /https\?:|https?:/.test(src.slice(0, m.index));
    if (!guarded) { add('worker', m.index, 'register() with no location.protocol test before it'); continue; }
    /* Inside a function body, not run straight at load: some "function"
     * opens before it and its braces are still open. */
    var depth = 0;
    var inFunction = false;
    var fnRe = /function\b[^{]*\{|=>\s*\{|[{}]/g;
    var f;
    var stack = [];
    while ((f = fnRe.exec(head))) {
      if (f[0] === '}') { stack.pop(); continue; }
      stack.push(f[0] !== '{');
    }
    depth = stack.length;
    /* The module's own IIFE is the outermost function: a call there runs
     * at load. A guarded call must be one level deeper. */
    inFunction = stack.filter(Boolean).length >= 2;
    if (!inFunction || !depth) add('worker', m.index, 'register() runs at load time, not from a function');
  }
  return out;
}

function auditCss(file, src) {
  var out = [];
  var code = src.replace(/\/\*[\s\S]*?\*\//g, function (c) { return c.replace(/[^\n]/g, ' '); });
  /* url(...) quoted or not, @import url(...) or @import "..."; image-set()
   * and src: lists are made of url()s and strings, so both are read. */
  var re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')|image-set\(([^)]*)\)/gi;
  var m;
  while ((m = re.exec(code))) {
    var vals = m[6] !== undefined ? (m[6].match(/"[^"]*"|'[^']*'/g) || []).map(function (q) { return q.slice(1, -1); })
      : [m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]];
    vals.forEach(function (v) {
      if (v && isRemote(v)) out.push({ rule: 'remote', file: file, line: lineAt(code, m.index), what: v.trim() });
    });
  }
  return out;
}

function auditHtml(file, src) {
  var out = [];
  var noComments = src.replace(/<!--[\s\S]*?-->/g, function (c) { return c.replace(/[^\n]/g, ' '); });
  var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(noComments))) {
    var attrs = m[1];
    var at = lineAt(noComments, m.index);
    if (/\btype\s*=\s*['"]?module\b/i.test(attrs)) out.push({ rule: 'module', file: file, line: at, what: '<script type="module">' });
    if (!/\bsrc\s*=/.test(attrs) && m[2].trim()) {
      auditJs(file + ' (inline script, line ' + at + ')', m[2]).forEach(function (f) { f.line = at + f.line - 1; out.push(f); });
    }
  }
  /* Every attribute of every tag, quoted with " or ' or not at all. The
   * text of <script> and <style> is blanked first (read above and below as
   * code), so a '<' inside them never starts a tag here. */
  var tagsOnly = noComments.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, function (all, open, name, body, close) {
    return open + body.replace(/[^\n]/g, ' ') + close;
  });
  var tagRe = /<[a-z][\w-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  var t;
  while ((t = tagRe.exec(tagsOnly))) {
    var attrRe = /\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
    var a;
    while ((a = attrRe.exec(t[0]))) {
      var name = a[1].toLowerCase();
      var value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      var where = lineAt(tagsOnly, t.index);
      if (name === 'style') {
        auditCss(file, value).forEach(function (f) { f.line = where; out.push(f); });
        continue;
      }
      if (!/^(src|href|srcset|imagesrcset|poster|data|action|formaction|xlink:href|background|manifest)$/.test(name)) continue;
      var r = remoteValue(name, value);
      if (r) out.push({ rule: 'remote', file: file, line: where, what: name + '=' + r });
    }
  }
  re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = re.exec(noComments))) {
    var sl = lineAt(noComments, m.index);
    auditCss(file + ' (inline style)', m[1]).forEach(function (f) { f.line = sl + f.line - 1; out.push(f); });
  }
  return out;
}

function auditFile(file, src) {
  if (/\.html?$/i.test(file)) return auditHtml(file, src);
  if (/\.css$/i.test(file)) return auditCss(file, src);
  return auditJs(file, src);
}

/* ---------------------------------------------------------------- planted controls */

/* Each must be caught, by its own rule. */
var CONTROLS = [
  { name: 'a module script tag', rule: 'module', file: 'c1.html', src: '<!doctype html><script type="module" src="app.js"></script>' },
  { name: 'an import statement', rule: 'module', file: 'c2.js', src: "import { a } from './a.js';\nwindow.x = a;\n" },
  { name: 'an export statement', rule: 'module', file: 'c3.js', src: 'export function f() { return 1; }\n' },
  { name: 'a dynamic import()', rule: 'module', file: 'c4.js', src: "(function () { import('./late.js').then(function () {}); })();\n" },
  { name: 'a script element made a module', rule: 'module', file: 'c5.js', src: "var s = document.createElement('script');\ns.type = 'module';\n" },
  { name: 'a fetch of a local file', rule: 'fetch', file: 'c6.js', src: "fetch('maps/x.md').then(function (r) { return r.text(); });\n" },
  { name: 'an XMLHttpRequest', rule: 'fetch', file: 'c7.js', src: "var x = new XMLHttpRequest();\nx.open('GET', 'data.json');\n" },
  { name: 'a script from a CDN', rule: 'remote', file: 'c8.html', src: '<script src="https://cdn.example.com/lib.js"></script>' },
  { name: 'a remote stylesheet link', rule: 'remote', file: 'c9.html', src: '<link rel="stylesheet" href="http://fonts.example.com/css">' },
  { name: 'a remote font in CSS', rule: 'remote', file: 'c10.css', src: '@font-face { font-family: X; src: url("https://fonts.example.com/x.woff2"); }' },
  { name: 'a remote @import', rule: 'remote', file: 'c11.css', src: "@import 'https://example.com/more.css';\n" },
  { name: 'a remote picture set from code', rule: 'remote', file: 'c12.js', src: "var img = new Image();\nimg.src = 'https://example.com/a.png';\n" },
  { name: 'a remote attribute set from code', rule: 'remote', file: 'c13.js', src: "el.setAttribute('href', 'https://example.com/x.css');\n" },
  { name: 'markup with a remote image, in a string', rule: 'remote', file: 'c14.js', src: "host.innerHTML = '<img src=\"https://example.com/t.gif\">';\n" },
  { name: 'an unguarded service worker', rule: 'worker', file: 'c15.js', src: "(function () {\n  function start() { navigator.serviceWorker.register('sw.js'); }\n  start();\n})();\n" },
  { name: 'a guarded worker run at load', rule: 'worker', file: 'c16.js', src: "(function () {\n  if (location.protocol === 'https:') navigator.serviceWorker.register('sw.js');\n})();\n" },
  { name: 'code the reader loses its place in', rule: 'lexer', file: 'c17.js', src: "var a = { b: (1 + 2;\n" },
  { name: 'the AI provider words in another file', rule: 'fetch', file: 'js/features/other.js', src: "fetch(url, init); // audit: ai-provider\n" },
  { name: 'the AI provider words on window.fetch', rule: 'fetch', file: 'js/features/ai.js', src: "window.fetch(url, init); // audit: ai-provider\n" },
  { name: 'fetch through window.', rule: 'fetch', file: 'c18.js', src: "(function () { window.fetch('maps/x.md'); })();\n" },
  { name: 'XMLHttpRequest through window.', rule: 'fetch', file: 'c19.js', src: "var x = new window.XMLHttpRequest();\n" },
  { name: 'fetch through globalThis. and self.', rule: 'fetch', file: 'c20.js', src: "globalThis . fetch('a'); self.fetch('b');\n" },
  { name: 'a remote srcset candidate with a descriptor', rule: 'remote', file: 'c21.html', src: '<img src="icons/a.png" srcset="icons/a.png 1x, https://x.example/a.png 2x">' },
  { name: 'a single-quoted style attribute', rule: 'remote', file: 'c22.html', src: "<div style='background:url(https://x.example/a.png)'></div>" },
  { name: 'an unquoted protocol-relative link', rule: 'remote', file: 'c23.html', src: '<link rel=stylesheet href=//cdn.example.com/x.css>' },
  { name: 'a protocol-relative picture from code', rule: 'remote', file: 'c24.js', src: "img.src = '//cdn.example.com/a.png';\n" },
  { name: 'a web socket', rule: 'network', file: 'c25.js', src: "var ws = new WebSocket('wss://example.com/live');\n" },
  { name: 'a beacon', rule: 'network', file: 'c26.js', src: "navigator.sendBeacon('/log', data);\n" },
  { name: 'a protocol-relative url() in CSS, unquoted', rule: 'remote', file: 'c27.css', src: '.a { background: url(//cdn.example.com/a.png); }' },
  { name: 'a remote srcset set from code', rule: 'remote', file: 'c28.js', src: "img.srcset = 'icons/a.png 1x, https://x.example/b.png 2x';\n" },
  { name: 'a remote attribute in single-quoted markup in a string', rule: 'remote', file: 'c29.js', src: "host.innerHTML = \"<img src='https://example.com/t.gif'>\";\n" },
  { name: 'a remote script address kept in a template literal', rule: 'remote', file: 'c30.js', src: "var u = `https://cdn.example.com/x.js`; s.src = u;\n" },
  { name: 'a fetch after a regex that follows if (...)', rule: 'fetch', file: 'c31.js', src: "if (a) /foo'/.test(b); fetch('x');\n" },
  { name: 'import.meta', rule: 'module', file: 'c32.js', src: "var u = import.meta.url;\n" },
  { name: 'a worker from a file', rule: 'fetch', file: 'c33.js', src: "var w = new Worker('w.js');\n" },
  { name: 'a remote image-set() in CSS', rule: 'remote', file: 'c34.css', src: ".a { background-image: image-set('https://x.example/a.png' 1x); }" },
  { name: 'a remote @import url()', rule: 'remote', file: 'c35.css', src: '@import url(https://example.com/a.css);' }
];

/* Look-alikes that are fine: none may be reported. */
var CLEAN = [
  { name: 'words in comments and strings', file: 'k1.js', src: "/* import the map, export it: fetch(nothing) */\n// see https://example.org\nvar help = 'export the map, import a file, https://example.org';\nvar ns = 'http://www.w3.org/2000/svg';\n" },
  { name: 'a regex with slashes and quotes', file: 'k2.js', src: "var re = /^https?:\\/\\/[^'\"]+$/i; var t = a / b / c; var u = x.import; var v = obj.export;\n" },
  { name: 'a guarded worker inside a function', file: 'k3.js', src: "(function () {\n  function isHttp() { return /^https?:$/.test(location.protocol); }\n  function start() { return navigator.serviceWorker.register('sw.js'); }\n  function init() { if (!isHttp()) return; start(); }\n  window.x = init;\n})();\n" },
  { name: 'data: and local URLs in CSS', file: 'k4.css', src: '/* url(https://example.com/in-a-comment.png) */ .a { background: url("data:image/png;base64,AAAA"); } @font-face { src: url("fonts/x.woff2"); }' },
  { name: 'markup with local resources', file: 'k5.html', src: '<!-- <script src="https://example.com/x.js"></script> --><link rel="icon" href="icons/a.svg"><a href="#top">top</a><svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  { name: 'the AI provider call, said so, in the one file allowed', file: 'js/features/ai.js', src: "fetch(url, init); // audit: ai-provider\n" },
  { name: 'a fetch of a blob, said so', file: 'k6.js', src: "fetch(blobUrl); // audit: blob-or-data\n" },
  { name: 'a template literal with code-like text', file: 'k7.js', src: "var s = `import x from 'y'; ${a + b} fetch('z')`;\n" },
  { name: 'names that start with import or export', file: 'k8.js', src: "var api = {\n  importFiles: importFiles,\n  exportAll: exportAll\n};\nimportFiles(list);\nexporter.run();\n" },
  { name: 'local addresses, slashes and member calls named fetch', file: 'k9.js', src: "var sep = '//';\na.href = '#top';\nimg.src = 'icons/x.svg';\nimg.srcset = 'icons/a.png 1x, icons/b.png 2x';\ncache.fetch(key);\nrefetch();\nvar re = new RegExp('//');\n" },
  { name: 'local srcset and single-quoted local styles', file: 'k10.html', src: "<img srcset=\"icons/a.png 1x, icons/b.png 2x\" alt=\"a > b\"><div style='background:url(icons/a.svg)'></div><script>var lt = 1 < 2, s = \"<a href='#x'>\";</script>" },
  { name: 'division after a call, a worker from a blob said so, a page link', file: 'k11.js', src: "var r = f(a) / g(b) / 2;\nvar w = new Worker(blobUrl); // audit: blob-or-data\nvar credit = 'https://github.com/steveruiz/perfect-freehand';\nwhile (x) /re'/.test(y);\n" }
];

function runControls() {
  var caught = 0;
  var problems = [];
  CONTROLS.forEach(function (c) {
    var found = auditFile(c.file, c.src);
    if (found.some(function (f) { return f.rule === c.rule; })) caught++;
    else problems.push('control not caught: ' + c.name + ' (' + c.rule + ')' + (found.length ? '; found instead: ' + found.map(function (f) { return f.rule; }).join(', ') : ''));
  });
  CLEAN.forEach(function (c) {
    var found = auditFile(c.file, c.src);
    if (found.length) problems.push('false alarm on ' + c.name + ': ' + found.map(function (f) { return f.rule + ' ' + f.what; }).join('; '));
  });
  return { caught: caught, total: CONTROLS.length, problems: problems };
}

/* ---------------------------------------------------------------- the real tree */

function walk(dir, ext, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    var p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, ext, out);
    else if (ext.test(d.name)) out.push(p);
  });
  return out;
}

function shippedFiles() {
  var files = [path.join(ROOT, 'index.html')];
  walk(path.join(ROOT, 'js'), /\.js$/, files);
  walk(path.join(ROOT, 'css'), /\.css$/, files);
  walk(path.join(ROOT, 'vendor'), /\.js$/, files);
  return files;
}

function main() {
  var controls = runControls();
  if (controls.problems.length) {
    console.log('STATIC AUDIT CANNOT BE TRUSTED: ' + controls.caught + '/' + controls.total + ' controls caught');
    controls.problems.forEach(function (p) { console.log('  ' + p); });
    return 1;
  }
  var files = shippedFiles();
  var findings = [];
  files.forEach(function (file) {
    var rel = path.relative(ROOT, file).split(path.sep).join('/');
    findings = findings.concat(auditFile(rel, fs.readFileSync(file, 'utf8')));
  });
  if (findings.length) {
    console.log('STATIC AUDIT FAILED: ' + findings.length + ' finding(s) in ' + files.length + ' files');
    findings.forEach(function (f) { console.log('  ' + f.rule + '  ' + f.file + ':' + f.line + '  ' + f.what); });
    return 1;
  }
  console.log(files.length + ' files read: index.html, ' + files.filter(function (f) { return /\.js$/.test(f); }).length + ' scripts, ' +
    files.filter(function (f) { return /\.css$/.test(f); }).length + ' stylesheets; clean look-alikes passed: ' + CLEAN.length + '/' + CLEAN.length);
  console.log('STATIC AUDIT OK (controls caught: ' + controls.caught + '/' + controls.total + ')');
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { lex: lex, auditFile: auditFile, runControls: runControls };
