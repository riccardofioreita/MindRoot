/* MindRoot - the Markdown model: a map's .md text read as a tree of nodes,
 * and every change to the map written back as a splice of its lines.
 *
 * The text is the single source of truth. parse() reads it line by line with
 * a small parser of our own - ATX headings, list items (-, *, + and numbered)
 * (nested by CommonMark content columns), task boxes, the quoted note / edge /
 * text children, end-of-line markers, pictures, the board line and YAML front
 * matter - and remembers for every node the lines it came from. Every edit is
 * a pure function (state, args) -> {text, anchorLine?, selectPath?}, or null
 * when nothing would change (null = no undo step). An edit rewrites only the
 * lines it is about; every other line stays byte for byte as it was, so a file
 * written in Obsidian or VS Code survives being edited here. The exceptions
 * are the few a neighbour needs so that CommonMark still reads it as it did:
 * a blank line in front of a numbered item that would otherwise be read as
 * more of the words above it, a paragraph brought inside the item that owns
 * it when that item moves, siblings written at two columns put at one. An
 * edit that adds or moves nodes is checked by parsing what it wrote - every
 * node there, under the parent it meant - and refused (null) rather than
 * written wrong.
 *
 * Free text that is not a node - paragraphs, code fences, tables, quotes,
 * lazy continuation lines - rides with the node it belongs to: it moves and is
 * deleted with that node, and viewTree() draws it in that node's body, after
 * the node's own quoted words (`- > text:`). What a reader of the map never
 * sees: comments, front matter, the board line, and text before the first
 * node (an introduction that belongs to no node).
 *
 * Inline Markdown becomes HTML only through inlineHtml(), which escapes
 * everything and then lets a short whitelist through. There is no DOM, no
 * network and no third-party code in this file: code fences and $math$ are
 * text, so nothing can ever ask a CDN for a highlighter. The few words the
 * model writes by itself ('untitled', a new map's title) come from ns.i18n
 * when it is loaded, in English when it is not. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  /* ---------- the dialect ---------- */

  /* A line is read for what it starts with. Headings take up to three spaces
   * of indent (four is code); list markers are -, *, + or a number of up to
   * nine digits with . or ); a run of three -, * or _ is a rule, not a list. */
  var HEADING_RE = /^( {0,3})(#{1,6})(?=[ \t]|$)([ \t]*)(.*)$/;
  var LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
  var THEMATIC_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var FENCE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
  var FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
  var SETEXT_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
  var TABLE_RULE_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  /* A checkbox belongs to the marker, not to the title: renaming the node
   * must not rub it out. */
  var TASK_RE = /^\[([ xX])\][ \t]+/;
  var MAX_HEADING = 6;
  var INDENT_STEP = 2;

  /* A note is a real child bullet holding a blockquote, so the file still
   * reads as ordinary Markdown anywhere else. The marker word decides what it
   * is about: the node, the edge reaching it, or - `text` - the node's own
   * words, drawn under its line. The Italian words written by the first
   * version are still read; rewritten, a note gets the English word. */
  var NOTE_RE = /^(\s*)([-*+])(\s+)>\s*(note|edge|nota|arco|text)\s*:\s*(.*)$/i;
  var NOTE_CONT_RE = /^(\s*)>\s?(.*)$/;
  var NOTE_MARKER = { node: 'note', edge: 'edge', body: 'text' };
  var NOTE_KIND = { note: 'node', nota: 'node', edge: 'edge', arco: 'edge', text: 'body' };

  /* Markers ride at the end of a node's line as HTML comments: every Markdown
   * reader hides them, and they travel with the line through every move. They
   * are peeled off from the right, in any order and spacing. A comment written
   * as \<!-- is an escaped one - text the person typed - and never a marker.
   * Each pattern reads one marker from its '<!--' to the end of the line
   * (lastMark finds where that is): a pattern that searched the whole line
   * for leading spaces backtracked quadratically on a long run of them. */
  var COLOR_RE = /^<!--\s*color\s*:\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\s*(branch)?\s*-->\s*$/i;
  var TITLE_RE = /^<!--\s*title\s*:\s*h([1-6])\s*-->\s*$/i;
  var ROLE_RE = /^<!--\s*role\s*:\s*(title|subtitle|caption)\s*-->\s*$/i;
  var IMAGE_RE = /^<!--\s*image\s*:\s*above\s*-->\s*$/i;
  var DRAW_RE = /^<!--\s*draw\s*:\s*above\s*-->\s*$/i;
  /* markmap's own fold comments: kept and handed to the view as a hint, so
   * they neither show up in the rename box nor get lost on a rewrite. */
  var FOLD_RE = /^<!--\s*markmap\s*:\s*(fold|foldAll)\s*-->\s*$/i;
  /* The side of the central node a first-level branch grows on. Only 'left'
   * means something today (no marker: the right); any other word is read as
   * the right and written back as it was, so a file from a later version
   * that knows 'up' or 'down' loses nothing by being edited here. */
  var SIDE_RE = /^<!--\s*side\s*:\s*([a-z][a-z-]*)\s*-->\s*$/i;
  var SIDES = { left: true };
  /* Where a node was put by hand, in whole map units: for a top node of a
   * map with several, the middle of its box on the map; for any node under
   * another, the middle of its box from the middle of its parent's. The
   * map's one root has nowhere to be but the middle: there it is not read. */
  var AT_RE = /^<!--\s*at\s*:\s*(-?\d{1,7})\s*,\s*(-?\d{1,7})\s*-->\s*$/i;
  /* A name for a node that survives edits and moves, given the first time
   * something points at it ([[Map#id]]): a short word of letters and digits. */
  var ID_RE = /^<!--\s*id\s*:\s*([a-z0-9]{4,12})\s*-->\s*$/i;
  /* Who wrote a node: 'ai' (made by the AI assistance and not touched
   * since) or 'mixed' (the AI's words and the person's together). A node
   * with no marker was written by the person alone. */
  var BY_RE = /^<!--\s*by\s*:\s*(ai|mixed)\s*-->\s*$/i;
  var BYS = { ai: true, mixed: true };
  var ROLES = { caption: true };
  var BODY_ROLES = { title: true, subtitle: true, caption: true };
  var SIZES = { h1: true, h2: true, h3: true, h4: true, h5: true, h6: true };
  /* The two roles that were sizes all along, read as the sizes they drew. */
  var OLD_ROLE_SIZE = { title: 'h2', subtitle: 'h3' };

  /* The one drawing that belongs to the whole map, on a line of its own:
   *     <!-- board: assets/kyc.excalidraw.svg | 320,180,640,480 --> */
  var BOARD_HEAD_RE = /^\s*<!--\s*board\s*:/i;
  var BOARD_SPOT_RE = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/;

  /* Two kinds of picture: a drawing is told from a photo by its name alone -
   * the double suffix is the marker. */
  var PHOTO = 'photo';
  var DRAW = 'draw';
  var DRAWING_PATH_RE = /\.(?:excalidraw|ink)\.svg$/i;

  /* What a line of prose is, for the body view. Stored per owning node as
   * line * 8 + type, which keeps parse allocation-light on big maps. */
  var P_TEXT = 0;
  var P_HIDDEN = 1;
  var P_FENCE_OPEN = 2;
  var P_FENCE = 3;
  var P_FENCE_CLOSE = 4;

  /* What each line of a parsed document is, as far as an edit that writes
   * near it needs to know (state.kinds, one byte a line). OPEN starts a
   * block that runs over several lines - a fence, a comment - and INSIDE
   * is the rest of it, closing line included. */
  var K_BLANK = 0;
  var K_NODE = 1;
  var K_TEXT = 2;
  var K_HIDDEN = 3;
  var K_OPEN = 4;
  var K_INSIDE = 5;
  var K_NOTE = 6;
  var K_META = 7;

  /* ---------- small helpers ---------- */

  function repeat(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }
  function spaces(n) { return repeat(' ', n); }

  function isBlank(line) {
    if (line == null) return true;
    for (var k = 0; k < line.length; k++) {
      var c = line.charCodeAt(k);
      if (c !== 32 && c !== 9) return false;
    }
    return true;
  }

  /* JavaScript's \s, one character at a time. */
  var WHITE_RE = /\s/;
  function isWhite(ch) { return WHITE_RE.test(ch); }

  function leadWs(line) {
    var k = 0;
    while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
    return k;
  }

  /* Columns, with tabs to the next multiple of four, as CommonMark counts
   * them: a tab-indented list nests the same as a space-indented one. */
  function colOf(line, from, to, startCol) {
    var col = startCol || 0;
    for (var k = from; k < to; k++) col = line.charCodeAt(k) === 9 ? col + 4 - (col % 4) : col + 1;
    return col;
  }

  function leadCol(line) { line = line || ''; return colOf(line, 0, leadWs(line), 0); }

  /* Where the words of the list item on `line` start, as CommonMark counts
   * it (parse() does the same inline): after the marker and the spaces that
   * follow it, or one column past the marker when there are none, more than
   * four, or no words. -1 when the line is no list item. */
  function contentColOf(line) {
    var s = String(line || '');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    var m = LIST_RE.exec(s);
    if (!m) return -1;
    var markerEnd = colOf(s, 0, m[1].length, 0) + m[2].length;
    var from = m[1].length + m[2].length;
    var gap = m[3] ? colOf(s, from, from + m[3].length, markerEnd) - markerEnd : 0;
    return (!m[3] || isBlank(m[4]) || gap > 4) ? markerEnd + 1 : markerEnd + gap;
  }

  /* A heading line, read past a byte-order mark (which only the first line
   * of a file can carry, and which belongs to the file, not the heading). */
  function matchHeading(line) {
    line = line || '';
    if (line.charCodeAt(0) !== 0xfeff) return HEADING_RE.exec(line);
    var m = HEADING_RE.exec(line.slice(1));
    if (m) m[1] = '\ufeff' + m[1];
    return m;
  }

  /* A line moved to another depth: its leading whitespace is rewritten as
   * plain spaces at the new column (prepending spaces in front of a tab would
   * leave it where the tab stop was). */
  function reindent(line, delta) {
    if (!delta || isBlank(line)) return line;
    var ws = leadWs(line);
    return spaces(Math.max(0, colOf(line, 0, ws, 0) + delta)) + line.slice(ws);
  }

  function normalizeText(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  /* Titles are single-line: fold anything else away so the outline stays valid. */
  function sanitizeInline(title) {
    return String(title == null ? '' : title)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* A note keeps its line breaks and nothing else: each line folded to single
   * spaces, the empty ones dropped - a blank line would close the quote and
   * split one note into two. */
  /* A note's lines, each made safe. A blank line between two paragraphs
   * stays (one, written as an empty '>' line: an earlier version reads it
   * as more of the same note); blank lines at either end go. */
  function sanitizeNote(text) {
    var lines = normalizeText(text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var clean = keepListIndent(lines[i], sanitizeInline(lines[i]), out.length > 0);
      if (clean) out.push(clean);
      else if (out.length && out[out.length - 1] !== '') out.push('');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  }

  /* A list item in a note or in the words under a title (- a, 1. b,
   * - [ ] c) keeps the indent that nests it under the item above; every
   * other line is folded flat. The first line has nothing to nest under
   * (it is written after 'text:'), so it never keeps one. Tabs count to the
   * next multiple of four, as everywhere in the file. */
  var BODY_ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(?:\[([ xX])\](?=[ \t]|$)[ \t]*)?(.*)$/;
  var MAX_LIST_INDENT = 24;

  function keepListIndent(raw, clean, nested) {
    if (!nested || !clean || !BODY_ITEM_RE.test(clean)) return clean;
    return spaces(Math.min(leadCol(raw), MAX_LIST_INDENT)) + clean;
  }

  /* The words of a note as read: the same blank-line rule. */
  function noteParts(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) out.push(parts[i]);
      else if (out.length && out[out.length - 1] !== '') out.push('');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

  function normalizeHex(value) {
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value == null ? '' : value).trim());
    if (!hex) return null;
    var d = hex[1].toLowerCase();
    if (d.length === 3) d = d[0] + d[0] + d[1] + d[1] + d[2] + d[2];
    return '#' + d;
  }

  var ESCAPE_TEST_RE = /[&<>"']/;
  var ESCAPE_ALL_RE = /[&<>"']/g;
  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  function escapeOne(c) { return ESCAPES[c]; }

  function escapeHtml(text) {
    var s = String(text);
    return ESCAPE_TEST_RE.test(s) ? s.replace(ESCAPE_ALL_RE, escapeOne) : s;
  }

  function escapeRe(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* The automatic colour of a branch, from the palette in color.js (loaded
   * first); the fallback only matters to a page that left it out. */
  function paletteColor(branchIndex) {
    if (ns.colors && ns.colors.paletteFor) return ns.colors.paletteFor(branchIndex);
    return '#2f7d5a';
  }

  /* The few words this file writes into a map by itself - a node left with
   * nothing, a new map, the root that loose pictures hang from, the name a
   * picture-only node goes by in breadcrumbs and search - in the reader's
   * language. ns.i18n loads before this file in the app; a page without it
   * (the unit suites) gets the English. */
  var WORDS = {
    en: { 'doc.untitled': 'untitled', 'doc.newMap': 'New map', 'doc.images': 'Images', 'doc.image': 'image' },
    it: { 'doc.untitled': 'senza titolo', 'doc.newMap': 'Nuova mappa', 'doc.images': 'Immagini', 'doc.image': 'immagine' }
  };
  var wordsAdded = false;

  function word(key) {
    var i18n = ns.i18n;
    if (i18n && typeof i18n.t === 'function') {
      if (!wordsAdded && typeof i18n.add === 'function') { i18n.add(WORDS); wordsAdded = true; }
      var said = i18n.t(key);
      if (said && said !== key) return said;
    }
    return WORDS.en[key];
  }
  if (ns.i18n && typeof ns.i18n.add === 'function') { ns.i18n.add(WORDS); wordsAdded = true; }

  /* ---------- inline Markdown ---------- */

  /* One scanner reads the inline syntax for every purpose: the HTML the map
   * shows, the plain text search and breadcrumbs use, the links a node
   * carries, and the mark pairs clearMarks() takes off. It produces tokens,
   * then pairs the emphasis delimiters the way CommonMark does (left/right
   * flanking runs, the rule of three, a delimiter stack with bottoms so it
   * stays linear) - which is what makes '***x***' bold italic and
   * 'snake_case_name' plain, and keeps hostile input from going quadratic. */
  var T_TEXT = 0;
  var T_BR = 1;
  var T_CODE = 2;
  var T_IMG = 3;
  var T_LINK = 4;
  var T_WIKI = 5;
  var T_DELIM = 6;
  var T_HIDE = 7;
  var CH_U = 117;

  var SPECIAL = new Uint8Array(128);
  '\\`*_~=![<&\nh'.split('').forEach(function (c) { SPECIAL[c.charCodeAt(0)] = 1; });

  var UNI_PUNCT_RE = /[\p{P}\p{S}]/u;
  var UNI_SPACE_RE = /\s/u;
  var U_TAG_RE = /<(\/?)u\s*>/iy;
  var BR_TAG_RE = /<br\s*\/?>/iy;
  var IMG_TAG_RE = /<img(?=[\s/>])/iy;
  var AUTOLINK_RE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\u0000-\u0020]*)>/y;
  var BARE_URL_RE = /https?:\/\/[^\s<>"'`]+/y;
  var ENTITY_RE = /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/y;
  var IMG_ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  /* Named entities worth decoding; anything else stays as written. A table
   * without a prototype, so '&constructor;' is not a function. */
  var NAMED = Object.create(null);
  [['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', '\''], ['nbsp', '\u00a0'],
    ['copy', '\u00a9'], ['reg', '\u00ae'], ['trade', '\u2122'], ['hellip', '\u2026'],
    ['mdash', '\u2014'], ['ndash', '\u2013'], ['laquo', '\u00ab'], ['raquo', '\u00bb'],
    ['lsquo', '\u2018'], ['rsquo', '\u2019'], ['ldquo', '\u201c'], ['rdquo', '\u201d'],
    ['euro', '\u20ac'], ['deg', '\u00b0'], ['middot', '\u00b7'], ['bull', '\u2022'],
    ['times', '\u00d7'], ['divide', '\u00f7'], ['plusmn', '\u00b1'], ['le', '\u2264'],
    ['ge', '\u2265'], ['ne', '\u2260'], ['infin', '\u221e'], ['larr', '\u2190'],
    ['rarr', '\u2192'], ['uarr', '\u2191'], ['darr', '\u2193'], ['harr', '\u2194'],
    ['sect', '\u00a7'], ['para', '\u00b6']
  ].forEach(function (pair) { NAMED[pair[0]] = pair[1]; });

  function isAsciiPunct(c) {
    return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
  }

  function unescapeMd(text) { return text.replace(/\\([!-/:-@[-`{-~])/g, '$1'); }

  /* 0 = whitespace (or the edge of the text), 1 = punctuation, 2 = other. */
  function flankClass(ch) {
    if (!ch) return 0;
    var c = ch.charCodeAt(0);
    if (c < 128) {
      if (c === 32 || (c >= 9 && c <= 13)) return 0;
      return isAsciiPunct(c) ? 1 : 2;
    }
    if (UNI_SPACE_RE.test(ch)) return 0;
    return UNI_PUNCT_RE.test(ch) ? 1 : 2;
  }

  function charBefore(s, i) {
    if (i <= 0) return '';
    var c = s.charCodeAt(i - 1);
    if (c >= 0xdc00 && c <= 0xdfff && i >= 2) return s.slice(i - 2, i);
    return s.charAt(i - 1);
  }

  function charFrom(s, i) {
    if (i >= s.length) return '';
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) return s.slice(i, i + 2);
    return s.charAt(i);
  }

  function entityAt(s, i) {
    ENTITY_RE.lastIndex = i;
    var m = ENTITY_RE.exec(s);
    if (!m) return null;
    var ch;
    if (m[1] || m[2]) {
      var cp = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16);
      if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
      ch = String.fromCodePoint(cp);
    } else {
      ch = NAMED[m[3]];
      if (ch === undefined) return null;
    }
    return { ch: ch, end: ENTITY_RE.lastIndex };
  }

  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    var out = '';
    var plain = 0;
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) !== 38) continue;
      var e = entityAt(s, i);
      if (!e) continue;
      out += s.slice(plain, i) + e.ch;
      plain = e.end;
      i = e.end - 1;
    }
    return out + s.slice(plain);
  }

  /* Backtick runs by length, so a code span finds its closing run with a
   * binary search instead of a rescan. */
  function backtickRuns(s) {
    var byLen = Object.create(null);
    for (var i = 0, n = s.length; i < n; i++) {
      if (s.charCodeAt(i) !== 96) continue;
      var j = i;
      while (j < n && s.charCodeAt(j) === 96) j++;
      (byLen[j - i] || (byLen[j - i] = [])).push(i);
      i = j - 1;
    }
    return byLen;
  }

  /* The code span a run of backticks at i opens: {end, content}, or {end}
   * alone when nothing closes it and the run is plain text. */
  function codeSpanAt(ctx, i) {
    var s = ctx.s;
    var n = s.length;
    var j = i;
    while (j < n && s.charCodeAt(j) === 96) j++;
    var len = j - i;
    var list = ctx.runs && ctx.runs[len];
    if (!list) return { end: j };
    var lo = 0;
    var hi = list.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid] < j) lo = mid + 1; else hi = mid;
    }
    if (lo >= list.length) return { end: j };
    var close = list[lo];
    var content = s.slice(j, close).replace(/\n/g, ' ');
    if (content.length > 1 && content.charAt(0) === ' ' && content.charAt(content.length - 1) === ' ' && /[^ ]/.test(content)) {
      content = content.slice(1, -1);
    }
    return { end: close + len, content: content };
  }

  /* Which ']' closes each '[', computed once per text (escapes and code spans
   * skipped), so a link is found in constant time. */
  function bracketIndex(ctx) {
    var s = ctx.s;
    var n = s.length;
    var open = [];
    var match = Object.create(null);
    for (var i = 0; i < n; i++) {
      var c = s.charCodeAt(i);
      if (c === 92) { i++; continue; }
      if (c === 96) { i = codeSpanAt(ctx, i).end - 1; continue; }
      if (c === 91) open.push(i);
      else if (c === 93 && open.length) match[open.pop()] = i;
    }
    return match;
  }

  /* A link or picture destination after its '(': <with spaces>, or a run
   * with balanced parentheses, then an optional "title", then ')'. A path with
   * spaces written by hand and no brackets is read too, as an earlier version
   * did - otherwise its picture would vanish and its file look unused. */
  function parseDest(s, p) {
    var n = s.length;
    var start;
    var dest;
    var angle = false;
    var destStart;
    var destEnd;
    while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
    start = p;
    if (s.charCodeAt(p) === 60) {
      var q = p + 1;
      while (q < n) {
        var cq = s.charCodeAt(q);
        if (cq === 62 || cq === 60 || cq === 10) break;
        if (cq === 92) q++;
        q++;
      }
      if (s.charCodeAt(q) !== 62) return null;
      destStart = p;
      destEnd = q + 1;
      dest = unescapeMd(s.slice(p + 1, q));
      angle = true;
      p = q + 1;
    } else {
      var depth = 0;
      var r = p;
      while (r < n) {
        var c = s.charCodeAt(r);
        if (c === 92 && r + 1 < n && isAsciiPunct(s.charCodeAt(r + 1))) { r += 2; continue; }
        if (c === 40) { if (++depth > 32) return null; } else if (c === 41) {
          if (!depth) break;
          depth--;
        } else if (c <= 32) break;
        r++;
      }
      destStart = p;
      destEnd = r;
      dest = depth ? null : unescapeMd(s.slice(p, r));
      p = r;
    }
    if (dest !== null) {
      var afterDest = p;
      while (p < n && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
      var t = s.charAt(p);
      if (t === ')') return { dest: dest, title: null, end: p + 1, angle: angle, destStart: destStart, destEnd: destEnd };
      if ((t === '"' || t === '\'' || t === '(') && p > afterDest) {
        var closeCh = t === '(' ? ')' : t;
        var e = p + 1;
        while (e < n && s.charAt(e) !== closeCh) { if (s.charCodeAt(e) === 92) e++; e++; }
        if (e < n) {
          var after = e + 1;
          while (after < n && (s.charCodeAt(after) === 32 || s.charCodeAt(after) === 9)) after++;
          if (s.charAt(after) === ')') {
            return { dest: dest, title: unescapeMd(s.slice(p + 1, e)), end: after + 1, angle: angle, destStart: destStart, destEnd: destEnd };
          }
        }
      }
    }
    if (angle) return null;
    var close = s.indexOf(')', start);
    var nl = s.indexOf('\n', start);
    if (close < 0 || (nl >= 0 && nl < close)) return null;
    var loose = s.slice(start, close).trim();
    return { dest: unescapeMd(loose), title: null, end: close + 1, angle: false, destStart: start, destEnd: start + s.slice(start, close).trimEnd().length };
  }

  /* [[Map name]] or [[Map name|shown words]]: a link to another map.
   * [[Map name#id|words]] points at one node of it (its id marker), and
   * [[#id|words]] at a node of the map the link is written in. */
  var WIKI_NODE_RE = /^(.*?)#([a-z0-9]{4,12})$/i;

  function parseWiki(s, i) {
    var limit = Math.min(s.length, i + 402);
    for (var q = i + 2; q < limit; q++) {
      var c = s.charCodeAt(q);
      if (c === 10 || c === 91) return null;
      if (c === 93) {
        if (s.charCodeAt(q + 1) !== 93) return null;
        var inner = s.slice(i + 2, q);
        var bar = inner.indexOf('|');
        var target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
        var node = '';
        var at = WIKI_NODE_RE.exec(target);
        if (at) { target = at[1].trim(); node = at[2].toLowerCase(); }
        var name = target;
        var label = (bar >= 0 ? inner.slice(bar + 1) : '').trim() || name || (node ? '#' + node : '');
        if (!name && !node) return null;
        return { name: name, node: node, label: label, explicit: bar >= 0, end: q + 2 };
      }
    }
    return null;
  }

  function parseImgTag(s, i) {
    var n = s.length;
    var quote = 0;
    var q = i + 4;
    for (; q < n; q++) {
      var c = s.charCodeAt(q);
      if (quote) { if (c === quote) quote = 0; continue; }
      if (c === 34 || c === 39) { quote = c; continue; }
      if (c === 62) break;
      if (c === 60 || c === 10) return null;
    }
    if (q >= n) return null;
    var inner = s.slice(i + 4, q);
    var attrs = Object.create(null);
    var m;
    IMG_ATTR_RE.lastIndex = 0;
    while ((m = IMG_ATTR_RE.exec(inner))) {
      var key = m[1].toLowerCase();
      if (!(key in attrs)) attrs[key] = decodeEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
    }
    return { end: q + 1, src: attrs.src || '', alt: attrs.alt || '' };
  }

  function isAlnum(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }

  /* A bare https:// address is a link, like every Markdown reader with GFM
   * makes it; the punctuation that ends a sentence is not part of it. */
  function bareUrlAt(s, i) {
    if (i > 0 && isAlnum(s.charCodeAt(i - 1))) return null;
    BARE_URL_RE.lastIndex = i;
    var m = BARE_URL_RE.exec(s);
    if (!m) return null;
    var url = m[0];
    var paren = 0;
    var square = 0;
    for (var k = 0; k < url.length; k++) {
      var ch = url.charAt(k);
      if (ch === '(') paren++; else if (ch === ')') paren--;
      else if (ch === '[') square++; else if (ch === ']') square--;
    }
    var end = url.length;
    for (;;) {
      var last = url.charAt(end - 1);
      if ('.,:;!?*_~\'"'.indexOf(last) >= 0) { end--; continue; }
      if (last === ')' && paren < 0) { end--; paren++; continue; }
      if (last === ']' && square < 0) { end--; square++; continue; }
      break;
    }
    url = url.slice(0, end);
    return /^https?:\/\/[^/]/.test(url) ? url : null;
  }

  /* Only http(s), mailto and relative destinations become links. Browsers
   * drop tabs, newlines and leading controls from a URL, so the scheme is
   * judged on the text with those removed: 'java\tscript:' is javascript:. */
  function safeHref(dest) {
    var d = String(dest == null ? '' : dest).trim();
    var probe = d.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '');
    var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
    if (scheme) {
      var name = scheme[1].toLowerCase();
      if (name !== 'http' && name !== 'https' && name !== 'mailto') return null;
    }
    return d.replace(/[\u0000-\u001f\u007f]/g, '').replace(/ /g, '%20');
  }

  function pushText(toks, text) {
    if (!text) return;
    var last = toks[toks.length - 1];
    if (last && last.t === T_TEXT) last.v += text;
    else toks.push({ t: T_TEXT, v: text });
  }

  /* Most node titles are plain words: no scan needed for them. */
  var INLINE_SYNTAX_RE = /[\\`*_~=![<&\n]|https?:\/\//;

  /* links: whether links may start here (not inside the words of a link).
   * base and pairs: where this text sits in a bigger one, and a list to
   * collect the matched mark pairs into (clearMarks). */
  function tokenize(s, links, base, pairs) {
    if (!INLINE_SYNTAX_RE.test(s)) return s ? [{ t: T_TEXT, v: s }] : [];
    var ctx = { s: s, runs: s.indexOf('`') >= 0 ? backtickRuns(s) : null, brackets: null, close: -2 };
    if (s.indexOf('[') >= 0 && s.indexOf(']') >= 0) ctx.brackets = bracketIndex(ctx);
    var toks = [];
    var n = s.length;
    var i = 0;
    var plain = 0;
    var delims = 0;
    base = base || 0;

    function flush(k) { if (k > plain) pushText(toks, s.slice(plain, k)); }

    while (i < n) {
      var c = s.charCodeAt(i);
      if (c >= 128 || !SPECIAL[c]) { i++; continue; }

      if (c === 92) {
        var nx = s.charCodeAt(i + 1);
        if (nx === 10) { flush(i); toks.push({ t: T_BR }); i += 2; plain = i; continue; }
        if (i + 1 < n && isAsciiPunct(nx)) { flush(i); pushText(toks, s.charAt(i + 1)); i += 2; plain = i; continue; }
        i++;
        continue;
      }

      if (c === 96) {
        var span = codeSpanAt(ctx, i);
        if (span.content == null) { i = span.end; continue; }
        flush(i);
        toks.push({ t: T_CODE, v: span.content });
        i = span.end;
        plain = i;
        continue;
      }

      if (c === 42 || c === 95 || c === 126 || c === 61) {
        var j = i;
        while (j < n && s.charCodeAt(j) === c) j++;
        var len = j - i;
        if ((c === 126 || c === 61) && len !== 2) { i = j; continue; }
        var before = flankClass(charBefore(s, i));
        var after = flankClass(charFrom(s, j));
        var left = after !== 0 && (after !== 1 || before !== 2);
        var right = before !== 0 && (before !== 1 || after !== 2);
        var canOpen = left;
        var canClose = right;
        if (c === 95) {
          canOpen = left && (!right || before === 1);
          canClose = right && (!left || after === 1);
        }
        if (!canOpen && !canClose) { i = j; continue; }
        flush(i);
        toks.push({ t: T_DELIM, ch: c, n: len, orig: len, canOpen: canOpen, canClose: canClose, l: i, r: j, raw: s.slice(i, j), opens: null, closes: null });
        delims++;
        i = j;
        plain = i;
        continue;
      }

      if (c === 33) {
        if (s.charCodeAt(i + 1) === 91 && ctx.brackets) {
          var shut = ctx.brackets[i + 1];
          if (shut !== undefined && s.charCodeAt(shut + 1) === 40) {
            var pd = parseDest(s, shut + 2);
            if (pd) {
              flush(i);
              toks.push({ t: T_IMG, alt: inlineText(s.slice(i + 2, shut)), src: pd.dest });
              i = pd.end;
              plain = i;
              continue;
            }
          }
        }
        i++;
        continue;
      }

      if (c === 91) {
        if (links) {
          if (s.charCodeAt(i + 1) === 91) {
            var w = parseWiki(s, i);
            if (w) {
              flush(i);
              toks.push({ t: T_WIKI, name: w.name, node: w.node, label: w.label });
              i = w.end;
              plain = i;
              continue;
            }
          }
          if (ctx.brackets) {
            var cl = ctx.brackets[i];
            if (cl !== undefined && s.charCodeAt(cl + 1) === 40) {
              var ld = parseDest(s, cl + 2);
              if (ld) {
                flush(i);
                toks.push({
                  t: T_LINK, href: safeHref(ld.dest), raw: ld.dest, title: ld.title,
                  kids: tokenize(s.slice(i + 1, cl), false, base + i + 1, pairs)
                });
                i = ld.end;
                plain = i;
                continue;
              }
            }
          }
        }
        i++;
        continue;
      }

      if (c === 60) {
        if (s.startsWith('<!--', i)) {
          /* Where the next '-->' is, remembered: a text full of unclosed
           * '<!--' must not be rescanned once for each of them. */
          if (ctx.close !== -1 && ctx.close < i + 4) ctx.close = s.indexOf('-->', i + 4);
          if (ctx.close >= 0) { flush(i); toks.push({ t: T_HIDE }); i = ctx.close + 3; plain = i; continue; }
          i++;
          continue;
        }
        U_TAG_RE.lastIndex = i;
        var um = U_TAG_RE.exec(s);
        if (um) {
          flush(i);
          var closing = !!um[1];
          toks.push({ t: T_DELIM, ch: CH_U, n: 1, orig: 1, canOpen: !closing, canClose: closing, l: i, r: U_TAG_RE.lastIndex, raw: um[0], opens: null, closes: null });
          delims++;
          i = U_TAG_RE.lastIndex;
          plain = i;
          continue;
        }
        BR_TAG_RE.lastIndex = i;
        if (BR_TAG_RE.test(s)) { flush(i); toks.push({ t: T_BR }); i = BR_TAG_RE.lastIndex; plain = i; continue; }
        IMG_TAG_RE.lastIndex = i;
        if (IMG_TAG_RE.test(s)) {
          var tag = parseImgTag(s, i);
          if (tag) { flush(i); toks.push({ t: T_IMG, alt: tag.alt, src: tag.src }); i = tag.end; plain = i; continue; }
        }
        if (links) {
          AUTOLINK_RE.lastIndex = i;
          var am = AUTOLINK_RE.exec(s);
          if (am) {
            var ah = safeHref(am[1]);
            if (ah) {
              flush(i);
              toks.push({ t: T_LINK, href: ah, raw: am[1], title: null, kids: [{ t: T_TEXT, v: am[1] }] });
              i = AUTOLINK_RE.lastIndex;
              plain = i;
              continue;
            }
          }
        }
        i++;
        continue;
      }

      if (c === 38) {
        var ent = entityAt(s, i);
        if (ent) { flush(i); pushText(toks, ent.ch); i = ent.end; plain = i; continue; }
        i++;
        continue;
      }

      if (c === 10) { flush(i); toks.push({ t: T_BR }); i++; plain = i; continue; }

      if (c === 104 && links && s.charCodeAt(i + 1) === 116) {
        var url = bareUrlAt(s, i);
        if (url) {
          flush(i);
          toks.push({ t: T_LINK, href: safeHref(url), raw: url, title: null, kids: [{ t: T_TEXT, v: url }] });
          i += url.length;
          plain = i;
          continue;
        }
      }
      i++;
    }
    flush(n);
    if (delims) processEmphasis(toks, pairs, base);
    return toks;
  }

  /* CommonMark's "process emphasis", over a linked list of the delimiter
   * tokens. A matched pair takes its marks from the inner side of both runs;
   * whatever is left of a run is literal text. ~~ and == only pair as runs of
   * exactly two, <u> only with </u>. */
  var scratchPrev = new Int32Array(64);
  var scratchNext = new Int32Array(64);

  function processEmphasis(toks, pairs, base) {
    var d = [];
    for (var k = 0; k < toks.length; k++) if (toks[k].t === T_DELIM) d.push(toks[k]);
    var m = d.length;
    /* Scratch links reused between calls: tokenize() finishes the emphasis
     * of a link's words before the text around it starts its own. */
    if (scratchPrev.length < m) { scratchPrev = new Int32Array(m * 2); scratchNext = new Int32Array(m * 2); }
    var prev = scratchPrev;
    var next = scratchNext;
    for (k = 0; k < m; k++) { prev[k] = k - 1; next[k] = k + 1 < m ? k + 1 : -1; }
    function unlink(at) {
      var p = prev[at];
      var q = next[at];
      if (p >= 0) next[p] = q;
      if (q >= 0) prev[q] = p;
    }
    var bottoms = [];
    var cur = m ? 0 : -1;
    while (cur >= 0) {
      var closer = d[cur];
      if (!closer.canClose || !closer.n) { cur = next[cur]; continue; }
      var star = closer.ch === 42 || closer.ch === 95;
      var key = closer.ch * 8 + (closer.canOpen ? 4 : 0) + (closer.orig % 3);
      var bottom = bottoms[key] === undefined ? -1 : bottoms[key];
      var o = prev[cur];
      var found = -1;
      while (o > bottom) {
        var op = d[o];
        if (op.ch === closer.ch && op.canOpen && op.n > 0) {
          if (star && (op.canClose || closer.canOpen) && (op.orig + closer.orig) % 3 === 0 &&
              !(op.orig % 3 === 0 && closer.orig % 3 === 0)) {
            o = prev[o];
            continue;
          }
          found = o;
          break;
        }
        o = prev[o];
      }
      if (found < 0) {
        bottoms[key] = prev[cur];
        var onward = next[cur];
        if (!closer.canOpen) unlink(cur);
        cur = onward;
        continue;
      }
      var opener = d[found];
      var use;
      var tag;
      if (star) { use = closer.n >= 2 && opener.n >= 2 ? 2 : 1; tag = use === 2 ? 'strong' : 'em'; } else if (closer.ch === 126) { use = 2; tag = 'del'; } else if (closer.ch === 61) { use = 2; tag = 'mark'; } else { use = 1; tag = 'u'; }
      var openSpan;
      var closeSpan;
      if (closer.ch === CH_U) {
        openSpan = [opener.l, opener.r];
        closeSpan = [closer.l, closer.r];
      } else {
        openSpan = [opener.r - use, opener.r];
        opener.r -= use;
        closeSpan = [closer.l, closer.l + use];
        closer.l += use;
      }
      opener.n -= use;
      closer.n -= use;
      (opener.opens || (opener.opens = [])).unshift(tag);
      (closer.closes || (closer.closes = [])).push(tag);
      if (pairs) pairs.push({ tag: tag, open: [openSpan[0] + base, openSpan[1] + base], close: [closeSpan[0] + base, closeSpan[1] + base] });
      for (var between = next[found]; between !== cur && between >= 0;) {
        var nb = next[between];
        unlink(between);
        between = nb;
      }
      if (!opener.n) unlink(found);
      if (!closer.n) {
        var then = next[cur];
        unlink(cur);
        cur = then;
      }
    }
  }

  function literalOf(tk) {
    if (!tk.n) return '';
    return tk.ch === CH_U ? tk.raw : repeat(String.fromCharCode(tk.ch), tk.n);
  }

  /* images: 'alt' writes a picture in the words as its alt text (a picture
   * is never drawn inline: the node draws its pictures itself), 'drop' leaves
   * it out because the caller collects it as a picture. */
  function renderHtml(toks, images) {
    var out = '';
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      switch (tk.t) {
        case T_TEXT: out += escapeHtml(tk.v); break;
        case T_BR: out += '<br>'; break;
        case T_CODE: out += '<code>' + escapeHtml(tk.v) + '</code>'; break;
        case T_IMG: if (images !== 'drop' && tk.alt) out += escapeHtml(tk.alt); break;
        case T_LINK:
          var inner = renderHtml(tk.kids, images);
          out += tk.href
            ? '<a class="md-link" href="' + escapeHtml(tk.href) + '"' +
              (tk.title ? ' title="' + escapeHtml(tk.title) + '"' : '') +
              ' target="_blank" rel="noopener noreferrer">' + inner + '</a>'
            : inner;
          break;
        case T_WIKI:
          out += '<a class="md-map" href="#" data-map="' + escapeHtml(tk.name) + '"' + (tk.node ? ' data-node="' + escapeHtml(tk.node) + '"' : '') + '>' + escapeHtml(tk.label) + '</a>';
          break;
        case T_DELIM:
          if (tk.closes) for (var c = 0; c < tk.closes.length; c++) out += '</' + tk.closes[c] + '>';
          out += escapeHtml(literalOf(tk));
          if (tk.opens) for (var o = 0; o < tk.opens.length; o++) out += '<' + tk.opens[o] + '>';
          break;
        default: break;
      }
    }
    return out;
  }

  function renderText(toks, images) {
    var out = '';
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      switch (tk.t) {
        case T_TEXT: out += tk.v; break;
        case T_BR: out += '\n'; break;
        case T_CODE: out += tk.v; break;
        case T_IMG: if (images !== 'drop') out += tk.alt; break;
        case T_LINK: out += renderText(tk.kids, images); break;
        case T_WIKI: out += tk.label; break;
        case T_DELIM: out += literalOf(tk); break;
        default: break;
      }
    }
    return out;
  }

  function collectLinks(toks, out) {
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      if (tk.t === T_LINK && tk.href) out.push({ href: tk.href, text: renderText(tk.kids).trim() || tk.raw, kind: 'url' });
      else if (tk.t === T_WIKI) {
        var ref = { href: tk.name, text: tk.label, kind: 'map' };
        if (tk.node) ref.node = tk.node;
        out.push(ref);
      }
    }
    return out;
  }

  function collectImages(toks, out) {
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      if (tk.t === T_IMG) out.push({ src: tk.src, alt: tk.alt });
      else if (tk.t === T_LINK) collectImages(tk.kids, out);
    }
    return out;
  }

  /* The safe inline renderer: **b** *i* _i_ <u> ~~s~~ ==mark== `code`
   * [text](url) [[Map name]] <br>, newlines as <br>; everything else is
   * escaped and shows as the text it is. */
  function inlineHtml(markdown) {
    return renderHtml(tokenize(String(markdown == null ? '' : markdown), true, 0, null), 'alt');
  }

  /* The same words as plain text: what search, breadcrumbs and exports of
   * plain text read. */
  function inlineText(markdown) {
    return renderText(tokenize(String(markdown == null ? '' : markdown), true, 0, null), 'alt');
  }

  /* ---------- pictures ---------- */

  function isDrawingPath(path) {
    return DRAWING_PATH_RE.test(String(path == null ? '' : path).trim().replace(/[?#].*$/, ''));
  }

  /* What a picture names as a file: brackets gone, %20 read as a space. */
  function decodePath(src) {
    var path = String(src == null ? '' : src).trim();
    if (/%[0-9a-f]{2}/i.test(path)) {
      try { path = decodeURIComponent(path); } catch (err) { /* not encoded after all */ }
    }
    return path;
  }

  function pictureItem(text, start, end, src, alt, extra) {
    var path = decodePath(src);
    var item = {
      start: start, end: end, markup: text.slice(start, end), src: src, path: path, alt: alt,
      kind: isDrawingPath(path) ? DRAW : PHOTO
    };
    if (extra) { item.destStart = extra.destStart; item.destEnd = extra.destEnd; item.angle = extra.angle; }
    return item;
  }

  function pictureAt(text, i) {
    var depth = 0;
    var limit = Math.min(text.length, i + 4096);
    var q = i + 1;
    for (; q < limit; q++) {
      var c = text.charCodeAt(q);
      if (c === 92) { q++; continue; }
      if (c === 91) depth++;
      else if (c === 93) { depth--; if (!depth) break; }
    }
    if (q >= limit || text.charCodeAt(q + 1) !== 40) return null;
    var d = parseDest(text, q + 2);
    if (!d) return null;
    return pictureItem(text, i, d.end, d.dest, unescapeMd(text.slice(i + 2, q)), d);
  }

  /* Every picture in a text, left to right: ![alt](path) and <img src>.
   * Escaped ones and ones inside `code` are words, not pictures. */
  function findPictures(text) {
    var out = [];
    if (text.indexOf('![') < 0 && !/<img/i.test(text)) return out;
    var ctx = { s: text, runs: text.indexOf('`') >= 0 ? backtickRuns(text) : null };
    for (var i = 0, n = text.length; i < n; i++) {
      var c = text.charCodeAt(i);
      if (c === 92) { i++; continue; }
      if (c === 96) { i = codeSpanAt(ctx, i).end - 1; continue; }
      if (c === 33 && text.charCodeAt(i + 1) === 91) {
        var p = pictureAt(text, i);
        if (p) { out.push(p); i = p.end - 1; }
        continue;
      }
      if (c === 60) {
        IMG_TAG_RE.lastIndex = i;
        if (IMG_TAG_RE.test(text)) {
          var tag = parseImgTag(text, i);
          if (tag) { out.push(pictureItem(text, i, tag.end, tag.src, tag.alt, null)); i = tag.end - 1; }
        }
      }
    }
    return out;
  }

  function kindOfImage(markup) {
    var s = String(markup == null ? '' : markup);
    var pics = findPictures(s);
    return isDrawingPath(pics.length ? pics[0].path : s) ? DRAW : PHOTO;
  }

  function isSpaceCode(c) { return c === 32 || (c >= 9 && c <= 13) || c === 0xa0; }

  /* A box read as three things: the pictures in front of the words (they
   * stand on the left), the words, and the pictures after them (on the
   * right). Pictures in the middle of the words stay part of the words. */
  function splitBox(title) {
    var text = String(title == null ? '' : title);
    if (text.indexOf('![') < 0 && text.indexOf('<') < 0) return { lead: [], tail: [], label: text.trim() };
    var pics = findPictures(text);
    var lead = [];
    var tail = [];
    var k = 0;
    var pos = 0;
    while (pos < text.length && isSpaceCode(text.charCodeAt(pos))) pos++;
    var leadEnd = 0;
    while (k < pics.length && pics[k].start === pos) {
      lead.push(pics[k]);
      leadEnd = pics[k].end;
      pos = leadEnd;
      while (pos < text.length && isSpaceCode(text.charCodeAt(pos))) pos++;
      k++;
    }
    var end = text.length;
    while (end > leadEnd && isSpaceCode(text.charCodeAt(end - 1))) end--;
    var tailStart = text.length;
    for (var t = pics.length - 1; t >= k && pics[t].end === end; t--) {
      tail.unshift(pics[t]);
      tailStart = pics[t].start;
      end = tailStart;
      while (end > leadEnd && isSpaceCode(text.charCodeAt(end - 1))) end--;
    }
    return { lead: lead, tail: tail, label: text.slice(leadEnd, Math.max(leadEnd, tailStart)).trim() };
  }

  function runMarkup(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) out.push(items[i].markup);
    return out.join(' ');
  }

  function joinBox(split) {
    var parts = [];
    var lead = runMarkup(split.lead);
    var tail = runMarkup(split.tail);
    if (lead) parts.push(lead);
    if (split.label) parts.push(split.label);
    if (tail) parts.push(tail);
    return parts.join(' ');
  }

  /* One kind's pictures, and the side they stand on (null: none of them). */
  function groupIn(split, kind) {
    var lead = [];
    var tail = [];
    var i;
    for (i = 0; i < split.lead.length; i++) if (split.lead[i].kind === kind) lead.push(split.lead[i]);
    for (i = 0; i < split.tail.length; i++) if (split.tail[i].kind === kind) tail.push(split.tail[i]);
    return { items: lead.concat(tail), side: lead.length ? 'left' : (tail.length ? 'right' : null) };
  }

  function splitImages(title) {
    var split = splitBox(title);
    var lead = runMarkup(split.lead);
    var tail = runMarkup(split.tail);
    return {
      images: lead && tail ? lead + ' ' + tail : (lead || tail),
      label: split.label,
      position: lead ? 'left' : (tail ? 'right' : 'left')
    };
  }

  function pictureViews(items, side, extra) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var view = { path: items[i].path, src: items[i].src, alt: items[i].alt, kind: items[i].kind, side: side };
      if (extra) view.prose = true;
      out.push(view);
    }
    return out;
  }

  /* A destination written so that it reads back as the same path. */
  function formatDest(path, angle) {
    var p = String(path);
    if (angle || /[\s()<>]/.test(p)) return '<' + p.replace(/[<>\n]/g, encodeURIComponent) + '>';
    return p;
  }

  /* ---------- the end-of-line markers ---------- */

  /* A line of nothing but whole comments (from `at`, past its indent) hides
   * and is no text. Walked by hand: the pattern it replaces backtracked
   * exponentially over a line of many comments with words after them. */
  function onlyComments(line, at) {
    while (at < line.length) {
      if (!line.startsWith('<!--', at)) return false;
      var close = line.indexOf('-->', at + 4);
      if (close < 0) return false;
      at = close + 3;
      while (at < line.length && (line.charCodeAt(at) === 32 || line.charCodeAt(at) === 9)) at++;
    }
    return true;
  }

  /* Where the comment that could end `line` as a marker starts: no marker
   * holds a '<!--' of its own, so it can only be the last one, and an
   * escaped one is no marker. `from` takes in the spaces before it. */
  function lastMark(line) {
    var open = line.lastIndexOf('<!--');
    if (open < 0 || (open > 0 && line.charCodeAt(open - 1) === 92)) return null;
    var from = open;
    while (from > 0 && isWhite(line.charAt(from - 1))) from--;
    return { tail: line.slice(open), from: from };
  }

  function peelMarks(text) {
    var out = {
      color: null, colorBranch: false, role: null, titleSize: null,
      imageAbove: false, drawAbove: false, fold: null, side: null, sideWord: null, at: null, id: null, by: null, suffix: '', rest: text
    };
    if (text.indexOf('-->') < 0) return out;
    var line = text;
    for (;;) {
      var found = lastMark(line);
      if (!found) break;
      var mark = COLOR_RE.exec(found.tail);
      if (mark) {
        out.color = normalizeHex(mark[1]);
        out.colorBranch = !!mark[2];
      } else if ((mark = TITLE_RE.exec(found.tail))) {
        out.titleSize = 'h' + mark[1];
      } else if ((mark = ROLE_RE.exec(found.tail))) {
        var word = mark[1].toLowerCase();
        if (ROLES[word]) out.role = word;
        else if (!out.titleSize) out.titleSize = OLD_ROLE_SIZE[word];
      } else if (IMAGE_RE.test(found.tail)) {
        out.imageAbove = true;
      } else if (DRAW_RE.test(found.tail)) {
        out.drawAbove = true;
      } else if ((mark = FOLD_RE.exec(found.tail))) {
        out.fold = mark[1].toLowerCase() === 'foldall' ? 'foldAll' : 'fold';
      } else if ((mark = SIDE_RE.exec(found.tail))) {
        out.sideWord = mark[1].toLowerCase();
        out.side = SIDES[out.sideWord] ? out.sideWord : null;
      } else if ((mark = AT_RE.exec(found.tail))) {
        out.at = { x: Number(mark[1]), y: Number(mark[2]) };
      } else if ((mark = ID_RE.exec(found.tail))) {
        out.id = mark[1].toLowerCase();
      } else if ((mark = BY_RE.exec(found.tail))) {
        out.by = mark[1].toLowerCase();
      } else {
        break;
      }
      out.suffix = line.slice(found.from) + out.suffix;
      line = line.slice(0, found.from);
    }
    out.rest = line;
    return out;
  }

  function colorMarkup(hex, branch) { return '<!-- color: ' + hex + (branch ? ' branch' : '') + ' -->'; }
  function roleMarkup(role) { return '<!-- role: ' + role + ' -->'; }
  function titleMarkup(size) { return '<!-- title: ' + size + ' -->'; }
  function sideMarkup(side) { return '<!-- side: ' + side + ' -->'; }

  function colorSuffix(color, branch) {
    var hex = normalizeHex(color);
    return hex ? ' ' + colorMarkup(hex, branch !== false) : '';
  }

  /* The tail written out from what the node is now, with what changes taken
   * from `changes`. The order is fixed - title, role, image, draw, fold,
   * side, colour - colour last, so a file that only ever had a colour keeps
   * the shape it always had. The side is written as the word it was read
   * as (a word this version does not know survives); setting it to the
   * right writes no marker. */
  function marksFor(entry, changes) {
    var color = 'color' in changes ? normalizeHex(changes.color) : entry.color;
    var branch = 'branch' in changes ? !!changes.branch : entry.colorBranch;
    var size = 'title' in changes ? changes.title : entry.titleSize;
    var role = 'role' in changes ? changes.role : entry.role;
    var above = 'above' in changes ? !!changes.above : entry.imageAbove;
    var drawAbove = 'drawAbove' in changes ? !!changes.drawAbove : entry.drawAbove;
    var out = '';
    if (size && SIZES[size]) out += ' ' + titleMarkup(size);
    if (role && ROLES[role]) out += ' ' + roleMarkup(role);
    if (above) out += ' <!-- image: above -->';
    if (drawAbove) out += ' <!-- draw: above -->';
    var side = 'side' in changes ? (SIDES[changes.side] ? changes.side : null) : entry.sideWord;
    if (entry.fold) out += ' <!-- markmap: ' + entry.fold + ' -->';
    if (side) out += ' ' + sideMarkup(side);
    var at = 'at' in changes ? changes.at : entry.at;
    if (at) out += ' <!-- at: ' + Math.round(at.x) + ',' + Math.round(at.y) + ' -->';
    var id = 'id' in changes ? changes.id : entry.id;
    if (id) out += ' <!-- id: ' + id + ' -->';
    var by = 'by' in changes ? (BYS[changes.by] ? changes.by : null) : entry.by;
    if (by) out += ' <!-- by: ' + by + ' -->';
    if (color) out += ' ' + colorMarkup(color, branch);
    return out;
  }

  /* ---------- titles written safely ---------- */

  /* A title typed on the map must stay a title. At the start of a list item a
   * '#', '- ', '> ', '1. ', '[ ] ', a fence or a rule would change what the
   * line is; at the end, a comment that looks like a marker would be taken
   * for one; on a heading a trailing run of '#' is a closing sequence. Each is
   * escaped with the backslash every Markdown reader honours, and titleFor()
   * takes the backslash off again for the rename box. */
  var BLOCK_START_RE = /^(?:#{1,6}(?=[ \t]|$)|[-*+](?=[ \t]|$)|>|\[[ xX]\](?=[ \t]|$)|`{3,}|~{3,})/;
  var ORDERED_START_RE = /^(\d{1,9})([.)])(?=[ \t]|$)/;
  var HEADING_CLOSE_RE = /(^|[ \t])(#+)[ \t]*$/;
  /* '# Title ##': CommonMark's optional closing #s are not words. The
   * parser keeps them with the line's markers, so a rename leaves them be
   * and a new marker (which would put them mid-line) drops them. Read from
   * the right by hand: the index where the closing run and the spaces before
   * it start, or -1. */
  function closingAt(text) {
    var end = text.length;
    while (end > 0 && (text.charCodeAt(end - 1) === 32 || text.charCodeAt(end - 1) === 9)) end--;
    var at = end;
    while (at > 0 && text.charCodeAt(at - 1) === 35) at--;
    if (at === end) return -1;
    if (at === 0) return 0;
    if (text.charCodeAt(at - 1) !== 32 && text.charCodeAt(at - 1) !== 9) return -1;
    while (at > 0 && (text.charCodeAt(at - 1) === 32 || text.charCodeAt(at - 1) === 9)) at--;
    return at;
  }

  function dropClosing(content) {
    var marks = peelMarks(content);
    var at = closingAt(marks.rest);
    return at >= 0 ? marks.rest.slice(0, at) + marks.suffix : content;
  }

  function guardTail(text) {
    var tail = peelMarks(text);
    if (!tail.suffix) return text;
    var at = text.length - tail.suffix.length;
    return text.slice(0, at) + tail.suffix.replace(/<!--/g, '\\<!--');
  }

  /* guardTail() undone: from the right, every escaped comment that would be
   * a marker without its backslash gets it back. */
  function unguardTail(text) {
    if (text.indexOf('\\<!--') < 0) return text;
    var from = text.length;
    for (;;) {
      var end = from;
      while (end > 0 && isWhite(text.charAt(end - 1))) end--;
      var open = text.lastIndexOf('<!--', end - 1);
      if (open < 1 || text.charCodeAt(open - 1) !== 92 || !peelMarks(text.slice(open, end)).suffix) break;
      from = open - 1;
      while (from > 0 && isWhite(text.charAt(from - 1))) from--;
    }
    return from < text.length ? text.slice(0, from) + text.slice(from).replace(/\\<!--/g, '<!--') : text;
  }

  function escapeTitle(label, kind) {
    var out = String(label == null ? '' : label);
    if (kind === 'bullet') {
      var om = ORDERED_START_RE.exec(out);
      if (om) out = om[1] + '\\' + out.slice(om[1].length);
      else if (BLOCK_START_RE.test(out) || THEMATIC_RE.test(out)) out = '\\' + out;
    } else if (kind === 'heading') {
      var hm = HEADING_CLOSE_RE.exec(out);
      if (hm) {
        var at = hm.index + hm[1].length;
        out = out.slice(0, at) + '\\' + out.slice(at);
      }
    }
    return guardTail(out);
  }

  function unescapeTitle(label, kind) {
    var out = unguardTail(String(label == null ? '' : label));
    if (kind === 'bullet') {
      var om = /^(\d{1,9})\\([.)])/.exec(out);
      if (om && ORDERED_START_RE.test(om[1] + out.slice(om[1].length + 1))) {
        out = om[1] + out.slice(om[1].length + 1);
      } else if (out.charAt(0) === '\\' && (BLOCK_START_RE.test(out.slice(1)) || THEMATIC_RE.test(out.slice(1)))) {
        out = out.slice(1);
      }
    } else if (kind === 'heading') {
      var hm = /(^|[ \t])\\(#+)[ \t]*$/.exec(out);
      if (hm) {
        var at = hm.index + hm[1].length;
        out = out.slice(0, at) + out.slice(at + 1);
      }
    }
    return out;
  }

  /* ---------- reading a document ---------- */

  function frontMatter(lines) {
    var first = (lines[0] || '').replace(/^\ufeff/, '');
    if (!/^---[ \t]*$/.test(first) || lines.length < 2) return null;
    for (var j = 1; j < lines.length; j++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[j])) return { end: j + 1, data: readYamlish(lines.slice(1, j)) };
    }
    return null;
  }

  /* Enough YAML to read `title: x` and friends; anything nested is skipped. */
  function readYamlish(lines) {
    var data = {};
    for (var i = 0; i < lines.length; i++) {
      var m = /^([A-Za-z0-9_-]+)[ \t]*:(.*)$/.exec(lines[i]);
      if (!m) continue;
      /* A key named __proto__ would reach the object's prototype. */
      if (m[1] === '__proto__') continue;
      var value = m[2].replace(/^[ \t]+/, '');
      var cut = value.length;
      while (cut > 0 && (value.charCodeAt(cut - 1) === 32 || value.charCodeAt(cut - 1) === 9)) cut--;
      value = value.slice(0, cut);
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      data[m[1]] = value;
    }
    return data;
  }

  function noteContinuation(line, indent) {
    if (line == null || NOTE_RE.test(line)) return null;
    var m = NOTE_CONT_RE.exec(line);
    if (!m || m[1].length <= indent) return null;
    return keepListIndent(m[2], m[2].trim(), true);
  }

  function readNote(lines, i, m) {
    var indent = m[1].length;
    var kind = NOTE_KIND[m[4].toLowerCase()];
    var first = m[5].trim();
    var role = null;
    var above = false;
    var drawAbove = false;
    /* The body says how it is written the way a node's line does, with
     * markers at the end of its first line, peeled in any order. */
    if (kind === 'body' && first.indexOf('-->') >= 0) {
      for (;;) {
        var found = lastMark(first);
        if (!found) break;
        var mark = ROLE_RE.exec(found.tail);
        if (mark) role = mark[1].toLowerCase();
        else if (IMAGE_RE.test(found.tail)) above = true;
        else if (DRAW_RE.test(found.tail)) drawAbove = true;
        else break;
        first = first.slice(0, found.from);
      }
    }
    var parts = [first];
    var end = i + 1;
    for (var j = i + 1; j < lines.length; j++) {
      var more = noteContinuation(lines[j], indent);
      if (more === null) break;
      parts.push(more);
      end = j + 1;
    }
    return {
      line: i, end: end, indent: indent, prefix: m[1] + m[2] + m[3], kind: kind,
      role: role, above: above, drawAbove: drawAbove,
      text: noteParts(parts).join('\n'), path: null
    };
  }

  /* Every note in a text, fenced code left alone: a note written as an
   * example inside ``` is code. */
  function readNotes(lines) {
    var found = [];
    var fenced = fencedLines(lines);
    for (var i = 0; i < lines.length; i++) {
      if (fenced[i]) continue;
      var m = NOTE_RE.exec(lines[i]);
      if (!m) continue;
      var note = readNote(lines, i, m);
      found.push(note);
      i = note.end - 1;
    }
    return found;
  }

  function makeEntry(line, kind, prefix, marks) {
    return {
      path: '', start: line, end: line + 1, subEnd: line + 1,
      kind: kind, tag: '', level: 0, indent: 0, contentCol: 0,
      prefix: prefix, title: marks.rest, suffix: marks.suffix,
      color: marks.color, colorBranch: marks.colorBranch, role: marks.role,
      titleSize: marks.titleSize, imageAbove: marks.imageAbove, drawAbove: marks.drawAbove,
      fold: marks.fold, side: marks.side, sideWord: marks.sideWord, at: marks.at, id: marks.id, by: marks.by, task: null, box: '', marker: null, ordered: null, delim: null,
      notes: null, body: null, prose: [], children: [], index: 0, depth: 0,
      paint: null, branch: '', handed: null, last: line, flatIndex: -1, parentIndex: -1,
      outside: -1
    };
  }

  /* Whether a table's delimiter row follows its header row: '|' in both and
   * as many cells, the test markdown-it makes before it draws a table. */
  function tableStarts(header, rule) {
    return rule.indexOf('|') >= 0 && TABLE_RULE_RE.test(rule) && splitCells(header).length === splitCells(rule).length;
  }

  /* One pass over the lines. Two stacks say where a line is: the headings
   * above it (by level) and the list items it is inside (by content column,
   * CommonMark's rule, so '1. ' items nest at three columns and not two). A
   * heading closes every list. Notes and empty items sit on the list stack
   * without being nodes, so what is nested under them hangs from the node
   * above them.
   *
   * Text owns itself to the innermost open item, else to the heading it is
   * under. Outside both - after a list has closed, where no heading is above -
   * it belongs to the last top-level node: the text is written at that
   * node's level, as a heading's own text is written at the heading's. It
   * still sits left of that node's content column, outside its item, and
   * `outside` remembers the line where that starts: a child goes in before
   * it, and a branch carried somewhere else takes it inside its item, so the
   * text stays the node's wherever the node goes. */
  function parse(text) {
    text = normalizeText(text);
    var lines = text.split('\n');
    var n = lines.length;
    var fm = frontMatter(lines);
    var flat = [];
    var tops = [];
    var parentOf = [];
    var notes = [];
    var noteOwners = [];
    var hstack = [];
    var lstack = [];
    var lastNode = null;
    var lastTop = null;
    var fallback = false;
    var prevBlank = true;
    /* What the line before was, for the CommonMark rules that look back. A
     * list item may interrupt a paragraph only if it says something and,
     * when numbered, starts at 1 (prevPara). A plain line straight after a
     * paragraph or a quote is more of it, even left of the list it is in
     * (prevLazy). Quotes, table rows and indented code are not paragraphs:
     * markdown-it, which drew earlier maps, starts a list after
     * them whatever its number. prevPipe: a paragraph line with a '|', a
     * table's header row if a delimiter row follows it. */
    var prevPara = false;
    var prevLazy = false;
    var prevQuote = false;
    var prevPipe = false;
    var inTable = false;
    var fence = null;
    var comment = null;
    var kinds = new Uint8Array(n);
    if (fm) for (var fmi = 0; fmi < fm.end; fmi++) kinds[fmi] = K_META;

    function contextNode() {
      var k;
      for (k = lstack.length - 1; k >= 0; k--) if (lstack[k].entry) return lstack[k].entry;
      for (k = hstack.length - 1; k >= 0; k--) if (hstack[k].entry) return hstack[k].entry;
      return null;
    }
    function headingNode() {
      for (var k = hstack.length - 1; k >= 0; k--) if (hstack[k].entry) return hstack[k].entry;
      return null;
    }
    /* Who owns a line that is not a node; `fallback` says it is owned from
     * outside the owner's item. */
    function holder() {
      var ctx = contextNode();
      fallback = !ctx;
      return ctx || lastTop;
    }
    function own(entry, line, type, out) {
      if (!entry) return;
      if (line > entry.last) entry.last = line;
      if (out && entry.outside < 0) entry.outside = line;
      if (type !== P_HIDDEN) entry.prose.push(line * 8 + type);
    }
    function addNode(entry, parent) {
      parentOf.push(parent);
      flat.push(entry);
      if (parent) { entry.index = parent.children.length; parent.children.push(entry); } else {
        entry.index = tops.length;
        tops.push(entry);
        lastTop = entry;
      }
      lastNode = entry;
    }
    function closeLists(col) {
      while (lstack.length && col < lstack[lstack.length - 1].content) lstack.pop();
    }
    function after(blankLine) {
      prevBlank = blankLine;
      prevPara = false;
      prevLazy = false;
      prevQuote = false;
      prevPipe = false;
      inTable = false;
    }

    for (var i = fm ? fm.end : 0; i < n; i++) {
      var raw = lines[i];
      var bom = i === 0 && raw.charCodeAt(0) === 0xfeff ? '\ufeff' : '';
      var line = bom ? raw.slice(1) : raw;
      var blank = isBlank(line);

      if (comment) {
        kinds[i] = K_INSIDE;
        own(comment.owner, i, P_HIDDEN, false);
        if (line.indexOf('-->') >= 0) comment = null;
        after(blank);
        continue;
      }

      if (fence) {
        var fcol = blank ? 0 : leadCol(line);
        if (blank || !fence.ctx || fcol >= fence.ctx) {
          kinds[i] = K_INSIDE;
          var fc = !blank && fcol - fence.ctx <= 3 && FENCE_CLOSE_RE.exec(line);
          if (fc && fc[1].charAt(0) === fence.ch && fc[1].length >= fence.len) {
            own(fence.owner, i, P_FENCE_CLOSE, false);
            fence = null;
          } else {
            own(fence.owner, i, P_FENCE, false);
          }
          after(false);
          continue;
        }
        /* The list item that held the fence has ended, and the fence with it. */
        fence = null;
      }

      if (blank) { after(true); continue; }

      var ws = leadWs(line);
      var col = ws ? colOf(line, 0, ws, 0) : 0;
      var first = line.charCodeAt(ws);
      var m;

      if (first === 35 && col <= 3 && (m = HEADING_RE.exec(line))) {
        lstack.length = 0;
        var level = m[2].length;
        while (hstack.length && hstack[hstack.length - 1].level >= level) hstack.pop();
        var hmarks = peelMarks(m[4]);
        var closing = closingAt(hmarks.rest);
        if (closing >= 0) {
          hmarks.suffix = hmarks.rest.slice(closing) + hmarks.suffix;
          hmarks.rest = hmarks.rest.slice(0, closing);
        }
        if (isBlank(hmarks.rest)) {
          /* An empty heading is no node, but it still closes the sections
           * deeper than it; what it would hold hangs from the one above. */
          var above = headingNode();
          kinds[i] = K_HIDDEN;
          own(above || lastTop, i, P_HIDDEN, !above);
          hstack.push({ level: level, entry: null });
        } else {
          kinds[i] = K_NODE;
          var he = makeEntry(i, 'heading', bom + m[1] + m[2] + m[3], hmarks);
          he.level = level;
          he.tag = 'h' + level;
          addNode(he, headingNode());
          hstack.push({ level: level, entry: he });
        }
        after(false);
        continue;
      }

      if ((first === 45 || first === 42 || first === 95) && col <= 3 && THEMATIC_RE.test(line)) {
        closeLists(col);
        kinds[i] = K_HIDDEN;
        own(holder(), i, P_HIDDEN, fallback);
        after(false);
        continue;
      }

      if ((first === 45 || first === 42 || first === 43 || (first >= 48 && first <= 57)) && (m = LIST_RE.exec(line))) {
        var markerEnd = col + m[2].length;
        var restBlank = isBlank(m[4]);
        var gap = m[3] ? colOf(line, ws + m[2].length, ws + m[2].length + m[3].length, markerEnd) - markerEnd : 0;
        var content = (!m[3] || restBlank || gap > 4) ? markerEnd + 1 : markerEnd + gap;
        var k = lstack.length - 1;
        while (k >= 0 && lstack[k].content > col) k--;
        var container = k >= 0 ? lstack[k].content : 0;
        var ordered = m[2].length > 1 ? parseInt(m[2], 10) : null;
        var valid = col - container <= 3;
        /* A list item may interrupt the paragraph it would otherwise continue
         * only if it says something and, when numbered, starts at 1 - the
         * CommonMark rule that keeps "2019. a year" a sentence. */
        if (valid && k === lstack.length - 1 && prevPara && !prevBlank && (restBlank || (ordered !== null && ordered !== 1))) valid = false;
        var noteMatch = m[4].charCodeAt(0) === 62 ? NOTE_RE.exec(line) : null;

        if (noteMatch) {
          /* Notes are read wherever they are written, as the first version
           * read them; their owner is the node above, by position - or, past
           * the text a top-level item keeps outside its item, that item, as
           * the text is. */
          if (valid) { lstack.length = k + 1; lstack.push({ content: content, entry: null }); }
          var note = readNote(lines, i, noteMatch);
          for (var nk = i; nk < note.end; nk++) kinds[nk] = K_NOTE;
          var noted = lastTop && lastTop.outside >= 0 ? lastTop : lastNode;
          if (noted) {
            if (note.end - 1 > noted.last) noted.last = note.end - 1;
            if (note.kind === 'body') {
              if (!noted.body) { noted.body = note; noteOwners.push(note, noted); }
            } else {
              noted.notes = noted.notes || {};
              if (!noted.notes[note.kind]) {
                noted.notes[note.kind] = note;
                notes.push(note);
                noteOwners.push(note, noted);
              }
            }
          }
          i = note.end - 1;
          /* A note is a quote: what follows it may start a list at any
           * number, and a plain line straight after it is more of it. */
          after(false);
          prevLazy = true;
          prevQuote = true;
          continue;
        }

        if (valid) {
          lstack.length = k + 1;
          var lmarks = peelMarks(m[4]);
          if (isBlank(lmarks.rest)) {
            /* '- ' alone is no node: what hangs under it hangs from the node
             * above, and the editor never leaves one behind. */
            kinds[i] = K_HIDDEN;
            own(holder(), i, P_HIDDEN, fallback);
            lstack.push({ content: content, entry: null });
            after(false);
            continue;
          }
          kinds[i] = K_NODE;
          var le = makeEntry(i, 'bullet', bom + m[1] + m[2] + m[3], lmarks);
          var box = TASK_RE.exec(le.title);
          if (box) {
            le.task = box[1] !== ' ';
            le.box = box[0];
            le.prefix += box[0];
            le.title = le.title.slice(box[0].length);
          }
          le.indent = col;
          le.contentCol = content;
          le.marker = m[2];
          le.ordered = ordered;
          le.delim = ordered !== null ? m[2].slice(-1) : null;
          le.tag = 'li';
          addNode(le, contextNode());
          lstack.push({ content: content, entry: le });
          after(false);
          prevPara = true;
          prevLazy = true;
          continue;
        }
      }

      /* Everything else is text, and text rides with a node. */
      var type = P_TEXT;
      var opens = null;
      var interrupts = false;
      var quote = false;
      if (first === 96 || first === 126) {
        var fo = FENCE_RE.exec(line);
        if (fo && !(fo[2].charCodeAt(0) === 96 && fo[3].indexOf('`') >= 0)) { opens = fo; interrupts = true; }
      } else if (first === 62) {
        interrupts = true;
        quote = true;
      } else if (first === 60 && line.startsWith('<!--', ws)) {
        if (line.indexOf('-->', ws + 4) < 0) interrupts = true;
        else if (onlyComments(line, ws)) type = P_HIDDEN;
      } else if ((first === 61 || first === 45) && prevPara && SETEXT_RE.test(line)) {
        type = P_HIDDEN;
      }
      var lazy = !interrupts && type === P_TEXT && prevLazy;
      if (lstack.length && col < lstack[lstack.length - 1].content && !lazy) closeLists(col);
      var owner = holder();
      var outside = fallback;
      var ctxCol = lstack.length ? lstack[lstack.length - 1].content : 0;
      if (opens) {
        if (col - ctxCol <= 3) {
          fence = { ch: opens[2].charAt(0), len: opens[2].length, ctx: ctxCol, owner: owner };
          kinds[i] = K_OPEN;
          own(owner, i, P_FENCE_OPEN, outside);
          after(false);
          continue;
        }
      } else if (interrupts && first === 60) {
        comment = { owner: owner };
        kinds[i] = K_OPEN;
        own(owner, i, P_HIDDEN, outside);
        after(false);
        continue;
      }
      kinds[i] = type === P_TEXT ? K_TEXT : K_HIDDEN;
      own(owner, i, type, outside);
      /* What this line is to the next one: a quote (or more of one), a table
       * row, indented code, or a paragraph. */
      var quoted = quote || (prevQuote && lazy);
      var code = type === P_TEXT && !lazy && !interrupts && col - ctxCol >= 4;
      var row = type === P_TEXT && !quoted && !code && (inTable || (prevPipe && tableStarts(lines[i - 1], line)));
      var para = type === P_TEXT && !quoted && !code && !row;
      after(false);
      prevPara = para;
      prevLazy = para || quoted;
      prevQuote = quoted;
      prevPipe = para && line.indexOf('|') >= 0;
      inTable = row;
    }

    /* Paths: '' for the one root, '0', '0.1' ... below it; with several
     * top-level nodes a synthetic root holds them as '0', '1' ... */
    var single = tops.length === 1;
    var count = flat.length;
    var pidx = new Int32Array(count);
    var byPath = Object.create(null);
    var f;
    var e;
    var p;
    for (f = 0; f < count; f++) {
      e = flat[f];
      p = parentOf[f];
      e.flatIndex = f;
      if (p) {
        e.path = p.path === '' ? String(e.index) : p.path + '.' + e.index;
        e.depth = p.depth + 1;
        pidx[f] = e.parentIndex = p.flatIndex;
      } else {
        e.path = single ? '' : String(e.index);
        e.depth = 0;
        pidx[f] = e.parentIndex = -1;
      }
      byPath[e.path] = e;
    }

    /* A node's block runs from its line to the last line its subtree owns
     * (its notes, its text, its descendants), minus trailing blank lines:
     * that is what moves, and what goes, with the node. */
    var size = new Int32Array(count);
    var subLast = new Int32Array(count);
    for (f = count - 1; f >= 0; f--) {
      size[f] += 1;
      if (flat[f].last > subLast[f]) subLast[f] = flat[f].last;
      var pi = pidx[f];
      if (pi >= 0) {
        size[pi] += size[f];
        if (subLast[f] > subLast[pi]) subLast[pi] = subLast[f];
      }
    }
    for (f = 0; f < count; f++) {
      e = flat[f];
      var stop = subLast[f] + 1;
      var nextStart = f + size[f] < count ? flat[f + size[f]].start : n;
      if (stop > nextStart) stop = nextStart;
      while (stop > e.start + 1 && isBlank(lines[stop - 1])) stop--;
      e.subEnd = Math.max(stop, e.start + 1);
    }

    /* Colours: a node's own colour wins; a colour marked `branch` is carried
     * down until a descendant has its own. The automatic colour is a
     * branch's: the key is the node's own path for the root and the first
     * level (each top-level node and its children under a synthetic root),
     * the parent's key deeper down. */
    for (f = 0; f < count; f++) {
      e = flat[f];
      p = parentOf[f];
      var carried = p ? p.handed : null;
      e.paint = e.color || carried || null;
      e.handed = (e.color && e.colorBranch) ? e.color : (carried || null);
      e.branch = e.depth <= 1 ? e.path : p.branch;
    }

    for (f = 0; f < noteOwners.length; f += 2) noteOwners[f].path = noteOwners[f + 1].path;

    return {
      text: text,
      lines: lines,
      root: single ? tops[0] : { path: null, synthetic: true, children: tops },
      flat: flat,
      byPath: byPath,
      notes: notes,
      kinds: kinds,
      frontmatter: fm ? fm.data : null,
      synthetic: !single
    };
  }

  /* ---------- reading answers off a parsed document ---------- */

  function entryAt(state, path) {
    if (path == null || !state || !state.byPath) return null;
    return state.byPath[path] || null;
  }

  function parentPath(path) {
    if (!path) return null;
    var i = path.lastIndexOf('.');
    return i < 0 ? '' : path.slice(0, i);
  }

  function isDescendantPath(path, ancestor) {
    if (ancestor === '') return path !== '';
    return path.indexOf(ancestor + '.') === 0;
  }

  function childEntries(state, entry) {
    return entry && entry.children ? entry.children.slice() : [];
  }

  function topEntries(state) {
    return state.root && state.root.synthetic ? state.root.children.slice() : (state.root ? [state.root] : []);
  }

  function siblingEntries(state, entry) {
    var parent = parentPath(entry.path);
    if (parent === null) return [entry];
    var parentEntry = state.byPath[parent];
    if (parentEntry) return childEntries(state, parentEntry);
    return topEntries(state);
  }

  function indexOfEntry(list, entry) {
    for (var i = 0; i < list.length; i++) if (list[i].path === entry.path) return i;
    return -1;
  }

  /* The node a line belongs to: the one starting on it, or the nearest one
   * starting above it. */
  function findByLine(state, line) {
    var flat = state.flat;
    var lo = 0;
    var hi = flat.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (flat[mid].start <= line) lo = mid + 1; else hi = mid;
    }
    return lo > 0 ? flat[lo - 1] : null;
  }

  function entryStartingAt(state, line) {
    var e = findByLine(state, line);
    return e && e.start === line ? e : null;
  }

  function imagesOf(entry) {
    if (!entry) return '';
    var line = splitImages(entry.title).images;
    var under = entry.body ? splitImages(entry.body.text).images : '';
    return line && under ? line + ' ' + under : line || under;
  }

  /* What the node is called, pictures taken off: raw Markdown, marks and
   * escapes included - what search and the trash compare. */
  function labelOf(entry) { return entry ? splitImages(entry.title).label : ''; }

  /* The same words the way the rename box shows them: the escapes this file
   * writes to keep a title a title are taken back off. */
  function titleFor(state, path) {
    var entry = entryAt(state, path);
    return entry ? unescapeTitle(labelOf(entry), entry.kind) : '';
  }

  function isImage(entry) {
    if (!entry) return false;
    var split = splitImages(entry.title);
    return !!split.images && !split.label;
  }

  /* The node a map is named after: its one root, or the first of several. */
  function primaryPath(state) {
    if (!state || !state.byPath) return null;
    if (state.byPath['']) return '';
    return state.byPath['0'] ? '0' : null;
  }

  /* The words of that node as a map's name: its plain text, no marks, no
   * pictures; '' when it has no words of its own. */
  function primaryName(state) {
    var path = primaryPath(state);
    if (path === null) return '';
    return inlineText(labelOf(state.byPath[path])).replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function plainText(entry) {
    if (!entry) return '';
    var text = inlineText(labelOf(entry)).replace(/\s+/g, ' ').trim();
    if (text) return text;
    if (isImage(entry)) return word('doc.image');
    return entry.title || '';
  }

  function breadcrumb(state, entry) {
    var parts = [];
    var path = parentPath(entry.path);
    while (path !== null) {
      var parent = state.byPath[path];
      if (parent) parts.unshift(plainText(parent));
      path = parentPath(path);
    }
    return parts.filter(Boolean).join(' / ');
  }

  function colorAt(state, path) {
    var entry = entryAt(state, path);
    return entry ? (entry.paint || null) : null;
  }

  function branchAt(state, path) {
    var entry = entryAt(state, path);
    return entry ? (entry.branch || '') : '';
  }

  function handedColor(state, path) {
    var entry = entryAt(state, path);
    return entry ? (entry.handed || null) : null;
  }

  /* The ordinal of every branch key in document order, the root's (or the
   * first top node's) being -1: the index paletteFor() turns into a colour. */
  var branchCache = new WeakMap();
  function branchIndexes(state) {
    var known = branchCache.get(state);
    if (known) return known;
    var keys = Object.create(null);
    var next = -1;
    for (var i = 0; i < state.flat.length; i++) {
      var key = state.flat[i].branch;
      if (!(key in keys)) keys[key] = next++;
    }
    branchCache.set(state, keys);
    return keys;
  }

  function branchIndexAt(state, path) {
    var entry = entryAt(state, path);
    return entry ? branchIndexes(state)[entry.branch] : -1;
  }

  /* The colour the node is drawn in, palette included: the same answer the
   * map and the Markdown panel paint with. */
  function colorFor(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    return entry.paint || paletteColor(branchIndexes(state)[entry.branch]);
  }

  /* ---------- writing: shared pieces ---------- */

  /* A byte-order mark belongs to the first line of the file; a splice that
   * moved line 0 elsewhere takes it back to the top. In place. */
  function bomFirst(lines) {
    for (var k = 1; k < lines.length; k++) {
      if (lines[k].charCodeAt(0) === 0xfeff) {
        lines[k] = lines[k].slice(1);
        if (lines[0].charCodeAt(0) !== 0xfeff) lines[0] = '\ufeff' + lines[0];
      }
    }
    return lines;
  }

  function result(lines, anchorLine, selectPath) {
    bomFirst(lines);
    var out = { text: lines.join('\n') };
    if (anchorLine != null) out.anchorLine = anchorLine;
    if (selectPath != null) out.selectPath = selectPath;
    return out;
  }

  function stripMarks(line, entry) {
    if (entry.suffix) line = line.slice(0, line.length - entry.suffix.length);
    return line.trimEnd();
  }

  /* The number a new item takes after `prev` in its list. Lists written
   * '1. 1. 1.' keep writing 1 (a list of one item counts on). */
  function nextNumber(prev, siblings) {
    return lazyNumbers(siblings) ? prev.ordered : prev.ordered + 1;
  }

  /* A list that writes the same number on every item ('1. 1. 1.'). */
  function lazyNumbers(items) {
    var seen = null;
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind !== 'bullet' || items[i].ordered === null) continue;
      if (seen !== null && items[i].ordered !== seen) return false;
      seen = items[i].ordered;
      n++;
    }
    return n > 1;
  }

  /* The marker a new item takes after the list items `items`: the list's own
   * kind of marker, or '-' when there is no list yet. */
  function markerAfter(items) {
    var last = items.length ? items[items.length - 1] : null;
    if (!last || last.kind !== 'bullet') return '-';
    if (last.ordered !== null) return nextNumber(last, items) + last.delim;
    return last.marker;
  }

  /* An item's number changed with its content column kept: '9.' becoming
   * '10.' takes a space from after the marker, '10.' becoming '9.' gives one
   * back, and when there is no space to take, the item's whole block moves
   * with it - otherwise its children would stop being its children. lines
   * [start, end) is the item's block. */
  function renumberLines(lines, start, end, number) {
    var line = lines[start] || '';
    var m = /^(\ufeff?)([ \t]*)(\d{1,9})([.)])([ \t]*)/.exec(line);
    if (!m || String(number) === m[3]) return;
    var rest = line.slice(m[0].length);
    var head = m[1] + m[2];
    var markerCol = colOf(m[2], 0, m[2].length, 0);
    var oldEnd = markerCol + m[3].length + 1;
    var gap = colOf(line, head.length + m[3].length + 1, m[0].length, oldEnd) - oldEnd;
    var content = !rest || !gap || gap > 4 ? oldEnd + 1 : oldEnd + gap;
    var newEnd = markerCol + String(number).length + 1;
    var want = content - newEnd;
    if (!rest) { lines[start] = head + number + m[4] + m[5]; return; }
    if (want >= 1 && want <= 4) { lines[start] = head + number + m[4] + spaces(want) + rest; return; }
    lines[start] = head + number + m[4] + ' ' + rest;
    for (var k = start + 1; k < end; k++) lines[k] = reindent(lines[k], newEnd + 1 - content);
  }

  /* Whether a list item put at `at` would sit straight under a paragraph:
   * the one place CommonMark only lets a list start at 1. */
  function underWords(lines, at) {
    var before = lines[at - 1];
    return at > 0 && !isBlank(before) && !matchHeading(before);
  }

  /* Where the inside of a node's block ends: before the text it owns from
   * outside its item (see parse), so a child written there stays inside the
   * item and the text stays the node's. */
  function innerEnd(state, entry) {
    if (entry.outside < 0) return entry.subEnd;
    var end = entry.outside;
    while (end > entry.start + 1 && isBlank(state.lines[end - 1])) end--;
    return end;
  }

  /* Where a new list item (or note) whose words start at column `col` can
   * go, at `at` or after it. Lines written at that column or deeper right
   * there - indented code under a heading, a node's deeper text - would fall
   * inside the new item and read as its text, or as a list. So it goes after
   * them: they are text with no node among them, so its place among the
   * nodes is the same. A fence or a comment is passed whole; a node, a note,
   * or a line left of `col` stops it. */
  function pastDeeper(state, at, col) {
    var lines = state.lines;
    var kinds = state.kinds;
    if (!kinds) return at;
    var end = at;
    var q = at;
    while (q < lines.length) {
      var k = kinds[q];
      if (k === K_BLANK) { q++; continue; }
      if (k === K_NODE || k === K_NOTE || k === K_META || k === K_INSIDE || leadCol(lines[q]) < col) break;
      q++;
      if (k === K_OPEN) while (q < lines.length && kinds[q] === K_INSIDE) q++;
      end = q;
    }
    return end;
  }

  /* A list item that may not interrupt a paragraph: numbered from anything
   * but 1. (An empty item is never written by an edit.) */
  function waitsForBlank(line) {
    var m = ORDERED_LINE_RE.exec(line || '');
    return !!m && m[1] !== '1' && !/^0+1$/.test(m[1]);
  }
  var ORDERED_LINE_RE = /^\ufeff?[ \t]*(\d{1,9})[.)](?:[ \t]|$)/;

  /* Every line in `starts` was written to begin a node. Straight under a
   * paragraph, CommonMark reads a numbered item other than 1 as more of the
   * paragraph - and whether the line above is a paragraph in the item's own
   * container (and not a quote, a table, code, or text inside another item)
   * is the parser's to say. So it is asked, only when such a line sits under
   * a non-blank one, and a blank line goes in front of each item it would
   * swallow. Returns the lines (changed in place) and how a line index moves. */
  function mendStarts(lines, starts) {
    var risky = [];
    for (var k = 0; k < starts.length; k++) {
      var at = starts[k];
      if (at > 0 && at < lines.length && !isBlank(lines[at - 1]) && waitsForBlank(lines[at]) && risky.indexOf(at) < 0) risky.push(at);
    }
    var gaps = [];
    if (risky.length) {
      var state = parse(lines.join('\n'));
      for (k = 0; k < risky.length; k++) if (!entryStartingAt(state, risky[k])) gaps.push(risky[k]);
      gaps.sort(function (a, b) { return b - a; });
      for (k = 0; k < gaps.length; k++) lines.splice(gaps[k], 0, '');
    }
    return {
      lines: lines,
      shift: function (line) {
        var by = 0;
        for (var g = 0; g < gaps.length; g++) if (gaps[g] <= line) by++;
        return line + by;
      }
    };
  }

  /* A structural edit checked against what it meant: every node still
   * there, on the line `lineMap` moves its line to (the same one by
   * default), under the node `parentOf(entry)` names (null: the top).
   * Hand-written files can hold text a column shift does not get past, or
   * siblings written at different columns; then nothing is written rather
   * than something unintended. `extra` nodes may be new; the parse is
   * returned for a look at them, null when the edit missed. */
  function keptShape(state, lines, parentOf, lineMap, gone, extra) {
    var next = parse(lines.join('\n'));
    var expected = state.flat.length + (extra || 0);
    var f;
    if (gone) for (f = 0; f < state.flat.length; f++) if (gone(state.flat[f])) expected--;
    if (next.flat.length !== expected) return null;
    var at = lineMap || function (line) { return line; };
    for (f = 0; f < state.flat.length; f++) {
      var was = state.flat[f];
      if (gone && gone(was)) continue;
      var now = entryStartingAt(next, at(was.start));
      if (!now) return null;
      var want = parentOf(was);
      var got = now.parentIndex >= 0 ? next.flat[now.parentIndex] : null;
      if (want ? !got || got.start !== at(want.start) : got) return null;
    }
    return next;
  }

  function parentOfEntry(state, entry) {
    return entry.parentIndex >= 0 ? state.flat[entry.parentIndex] : null;
  }

  /* Takes a node's block out of the lines, and tidies only the blank lines
   * where it was: two blank runs that meet become the longer one, nothing
   * blank is left at the top, and the file ends with one newline. The next
   * item of a numbered list the block started takes over its number - a
   * '2.' straight under a paragraph would read as words. */
  function removeBlock(state, entry) {
    var lines = state.lines;
    var s = entry.start;
    var e = entry.subEnd;
    var a = s;
    while (a > 0 && isBlank(lines[a - 1])) a--;
    var b = e;
    while (b < lines.length && isBlank(lines[b])) b++;
    var drops = [];
    var endWithNewline = false;
    if (b >= lines.length) {
      drops.push([a, lines.length]);
      endWithNewline = a > 0;
    } else if (a === 0) {
      drops.push([0, b]);
    } else {
      drops.push([s, e]);
      var before = s - a;
      var after = b - e;
      if (before && after) drops.push([e, e + Math.min(before, after)]);
    }
    var copy = lines.slice();
    /* The item after a first child moves up under the parent's words; if it
     * is numbered it must start the list there (only where it matters:
     * after a blank line or a heading any number starts a list). It takes
     * the number of the item it replaces when that was of its own list. */
    var sibs = siblingEntries(state, entry);
    var at = indexOfEntry(sibs, entry);
    var next = sibs[at + 1];
    if (at === 0 && next && next.kind === 'bullet' && next.ordered !== null && underWords(lines, s)) {
      var sameList = entry.ordered !== null && entry.delim === next.delim && entry.indent === next.indent;
      renumberLines(copy, next.start, next.subEnd, sameList ? entry.ordered : 1);
    }
    function dropped(line) {
      var shift = 0;
      for (var q = 0; q < drops.length; q++) {
        if (line >= drops[q][1]) shift += drops[q][1] - drops[q][0];
        else if (line > drops[q][0]) shift += line - drops[q][0];
      }
      return line - shift;
    }
    /* The node after the block now follows whatever the block followed -
     * the text its parent or the node before owns, say. */
    var f = entry.flatIndex + 1;
    while (f < state.flat.length && state.flat[f].start < e) f++;
    var following = f < state.flat.length ? state.flat[f] : null;
    function cut(from) {
      var out = [];
      var d = 0;
      for (var k = 0; k < from.length; k++) {
        while (d < drops.length && k >= drops[d][1]) d++;
        if (d < drops.length && k >= drops[d][0]) continue;
        out.push(from[k]);
      }
      if (endWithNewline) out.push('');
      /* The first line went, and the file's byte-order mark with it. */
      if (out.length && from[0].charCodeAt(0) === 0xfeff && out[0].charCodeAt(0) !== 0xfeff) out[0] = '\ufeff' + out[0];
      var mended = mendStarts(out, following ? [dropped(following.start)] : []);
      return { lines: mended.lines, map: function (line) { return mended.shift(dropped(line)); } };
    }
    var made = cut(copy);
    /* A list written at two columns ('- a' then text, then '  - b') can
     * nest once what kept its parts apart is gone: then the siblings after
     * the block take its column, which is a sibling's column there. */
    if (following && following.kind === 'bullet' && following.indent > entry.indent && !keptAfterCut(state, entry, made)) {
      for (var t = at + 1; t < sibs.length; t++) {
        if (sibs[t].kind === 'bullet') shiftBullets(copy, sibs[t].start, sibs[t].subEnd, entry.indent - sibs[t].indent);
      }
      var aligned = cut(copy);
      if (keptAfterCut(state, entry, aligned)) made = aligned;
    }
    return made;
  }

  /* Whether every node outside `entry`'s subtree kept its parent once the
   * subtree was cut out (`made` from removeBlock). */
  function keptAfterCut(state, entry, made) {
    var last = entry.flatIndex;
    while (last + 1 < state.flat.length && state.flat[last + 1].start < entry.subEnd) last++;
    return keptShape(state, made.lines, function (e) { return parentOfEntry(state, e); }, made.map,
      function (e) { return e.flatIndex >= entry.flatIndex && e.flatIndex <= last; });
  }

  /* Lines inside fenced code are text, whatever they look like: a '# comment'
   * in a shell snippet is not a heading to re-level. */
  function fencedLines(lines) {
    var inside = [];
    var open = null;
    for (var i = 0; i < lines.length; i++) {
      var m = FENCE_RE.exec(lines[i] || '');
      if (open) {
        inside[i] = true;
        var c = FENCE_CLOSE_RE.exec(lines[i] || '');
        if (c && c[1].charAt(0) === open.ch && c[1].length >= open.len) open = null;
      } else if (m && !(m[2].charCodeAt(0) === 96 && m[3].indexOf('`') >= 0)) {
        open = { ch: m[2].charAt(0), len: m[2].length };
      }
    }
    return inside;
  }

  function deepestHeading(state, entry) {
    var deepest = entry.level;
    var block = state.lines.slice(entry.start, entry.subEnd);
    var fenced = fencedLines(block);
    for (var i = 0; i < block.length; i++) {
      if (fenced[i]) continue;
      var m = matchHeading(block[i]);
      if (m && m[2].length > deepest) deepest = m[2].length;
    }
    return deepest;
  }

  /* ---------- structural edits ---------- */

  /* An empty '- ' or '# ' is no node: what is under it would hang from the
   * node above, and its own words would go with them. So a line about to be
   * left with nothing takes the words written under it instead - they leave
   * the body, which keeps its pictures - and only with none of those the
   * word for "untitled". Changes `lines` (the body's) in place and returns
   * the words for the line, escaped for it. */
  function fillEmptyLine(state, entry, lines) {
    var words = sanitizeInline(bodyFor(state, entry.path));
    if (!words) return { label: escapeTitle(word('doc.untitled'), entry.kind), moved: false };
    var body = entry.body;
    var split = splitBox(body.text);
    var written = [];
    if (split.lead.length + split.tail.length) {
      split.label = '';
      written = noteLinesFor(body.prefix, 'body', joinBox(split), body.role, body.above, body.drawAbove);
    }
    spliceQuote(state, lines, body.line, body.end - body.line, written);
    return { label: escapeTitle(words, entry.kind), moved: true };
  }

  function rename(state, path, title) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    var split = splitBox(entry.title);
    var lines = state.lines.slice();
    var clean = sanitizeInline(title);
    var moved = false;
    /* A node is at least words on its line or a picture there. */
    if (clean || (split.lead.length + split.tail.length)) {
      split.label = escapeTitle(clean, entry.kind);
    } else {
      var filled = fillEmptyLine(state, entry, lines);
      split.label = filled.label;
      moved = filled.moved;
    }
    lines[entry.start] = entry.prefix + joinBox(split) + entry.suffix;
    if (!moved && lines[entry.start] === state.lines[entry.start]) return null;
    return result(lines, entry.start);
  }

  function addRoot(state, title, color) {
    var lines = state.lines.slice();
    while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
    var at = lines.length;
    if (at > 0) { lines.push(''); at++; }
    lines.push('# ' + escapeTitle(sanitizeInline(title) || word('doc.untitled'), 'heading') + colorSuffix(color));
    lines.push('');
    return result(lines, at);
  }

  /* A new item written at `at`: what follows may need a blank line after
   * it (a heading does), and the item itself may need one before it (see
   * mendStarts) - as may the node that followed, if it was one. */
  function insertItem(state, lines, at, block, itemOffset, parent) {
    var col = contentColOf(block[itemOffset]);
    var past = col >= 0 ? pastDeeper(state, at, col) : at;
    if (past > at) {
      /* Past the text, set apart from it; and text that follows straight
       * on would run on into the new item. */
      if (block[0] !== '') { block.unshift(''); itemOffset++; }
      if (past < lines.length && !isBlank(lines[past]) && state.kinds[past] !== K_NODE) block.push('');
    }
    at = past;
    var follows = !!entryStartingAt(state, at);
    if (at < lines.length && matchHeading(lines[at]) && !isBlank(block[block.length - 1])) block.push('');
    lines.splice.apply(lines, [at, 0].concat(block));
    var item = at + itemOffset;
    var starts = [item];
    if (follows) starts.push(at + block.length);
    var mended = mendStarts(lines, starts);
    /* One node more, under `parent`, and every other node where it was. */
    var count = block.length;
    function moved(line) { return mended.shift(line >= at ? line + count : line); }
    var next = keptShape(state, mended.lines, function (e) { return parentOfEntry(state, e); }, moved, null, 1);
    var made = next && entryStartingAt(next, mended.shift(item));
    var under = made && made.parentIndex >= 0 ? next.flat[made.parentIndex] : null;
    if (!made || (parent ? !under || under.start !== moved(parent.start) : under)) return null;
    return result(mended.lines, mended.shift(item));
  }

  /* A bullet child of a heading goes with the heading's list: after its last
   * item, or - with no list yet - before the first sub-heading, otherwise the
   * list would belong to that sub-heading. */
  function bulletInsertPoint(state, entry) {
    var children = entry.children;
    var last = -1;
    for (var i = 0; i < children.length; i++) {
      if (children[i].kind === 'heading') return last >= 0 ? children[last].subEnd : children[i].start;
      last = i;
    }
    return last >= 0 ? children[last].subEnd : entry.subEnd;
  }

  /* A child of a list item goes after its inside - its children and its own
   * text - and before any text it owns from outside its item, which would
   * otherwise cut the new line off from it. */
  function addChild(state, path, title, kind, color) {
    var entry = entryAt(state, path);
    if (!entry) return addRoot(state, title, color);
    var lines = state.lines.slice();
    var clean = sanitizeInline(title) || word('doc.untitled');
    var at;
    var block;
    if (entry.kind === 'heading') {
      var children = entry.children;
      var items = children.filter(function (c) { return c.kind !== 'heading'; });
      var wantsBullet = kind === 'bullet' || entry.level >= MAX_HEADING ||
        (kind !== 'heading' && children.length > 0 && children[0].kind === 'bullet');
      if (wantsBullet) {
        at = bulletInsertPoint(state, entry);
        block = [markerAfter(items) + ' ' + escapeTitle(clean, 'bullet') + colorSuffix(color)];
        if (at > 0 && matchHeading(lines[at - 1])) block.unshift('');
      } else {
        at = entry.subEnd;
        block = ['', repeat('#', entry.level + 1) + ' ' + escapeTitle(clean, 'heading') + colorSuffix(color)];
      }
    } else {
      at = innerEnd(state, entry);
      block = [spaces(entry.contentCol) + markerAfter(entry.children) + ' ' + escapeTitle(clean, 'bullet') + colorSuffix(color)];
    }
    return insertItem(state, lines, at, block, block[0] === '' ? 1 : 0, entry);
  }

  function addSibling(state, path, title, color) {
    var entry = entryAt(state, path);
    if (!entry) return addRoot(state, title, color);
    var lines = state.lines.slice();
    var clean = sanitizeInline(title) || word('doc.untitled');
    var at = entry.subEnd;
    var block;
    /* A sibling of a first-level branch grows on that branch's side. */
    var side = sideSuffix(state, entry);
    if (entry.kind === 'heading') {
      block = ['', repeat('#', entry.level) + ' ' + escapeTitle(clean, 'heading') + side + colorSuffix(color)];
    } else {
      var sibs = siblingEntries(state, entry);
      var marker = entry.ordered !== null ? nextNumber(entry, sibs) + entry.delim : entry.marker;
      /* At the column of the sibling it lands before, when there is one: a
       * list written at two columns would otherwise nest that one under it. */
      var next = sibs[indexOfEntry(sibs, entry) + 1];
      var col = next && next.kind === 'bullet' ? next.indent : entry.indent;
      /* The next item of a to-do list is another to-do. */
      block = [spaces(col) + marker + ' ' + (entry.task !== null ? '[ ] ' : '') +
        escapeTitle(clean, 'bullet') + side + colorSuffix(color)];
      /* After the text the node keeps outside its item, a blank line, as
       * the text was written apart from the list. */
      if (entry.outside >= 0) block.unshift('');
    }
    return insertItem(state, lines, at, block, block[0] === '' ? 1 : 0, parentOfEntry(state, entry));
  }

  function remove(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    return result(removeBlock(state, entry).lines, null, parentPath(entry.path));
  }

  /* Siblings swap only with siblings of their own kind: a list item moved
   * past a sub-heading would end up under it. */
  function canMove(state, path, dir) {
    var entry = entryAt(state, path);
    if (!entry) return false;
    var sibs = siblingEntries(state, entry);
    var i = indexOfEntry(sibs, entry);
    var target = sibs[i + (dir < 0 ? -1 : 1)];
    return i >= 0 && !!target && target.kind === entry.kind;
  }

  function move(state, path, dir) {
    if (!canMove(state, path, dir)) return null;
    var entry = entryAt(state, path);
    var sibs = siblingEntries(state, entry);
    var i = indexOfEntry(sibs, entry);
    var target = sibs[i + (dir < 0 ? -1 : 1)];
    var first = dir < 0 ? target : entry;
    var second = dir < 0 ? entry : target;
    var lines = state.lines;
    var head = lines.slice(0, first.start);
    var blockFirst = lines.slice(first.start, first.subEnd);
    var gap = lines.slice(first.subEnd, second.start);
    var blockSecond = lines.slice(second.start, second.subEnd);
    var tail = lines.slice(second.subEnd);
    /* Two items of one numbered list swap places, not numbers; a numbered
     * item that becomes a first child under its parent's words starts at 1. */
    if (first.ordered !== null && second.ordered !== null && first.delim === second.delim && first.indent === second.indent) {
      renumberLines(blockSecond, 0, blockSecond.length, first.ordered);
      renumberLines(blockFirst, 0, blockFirst.length, second.ordered);
    } else if (second.ordered !== null && indexOfEntry(sibs, first) === 0 && underWords(lines, first.start)) {
      renumberLines(blockSecond, 0, blockSecond.length, 1);
    }
    var later = first.start + blockSecond.length + gap.length;
    var follows = !!entryStartingAt(state, second.subEnd);
    function attempt(upper, lower) {
      var out = bomFirst(head.concat(upper, gap, lower, tail));
      /* Either block may end in text and now stand over a numbered item. */
      var starts = [first.start, later];
      if (follows) starts.push(later + lower.length);
      var mended = mendStarts(out, starts);
      function lineMap(line) {
        var to = line;
        if (line >= first.start && line < first.subEnd) to = later + line - first.start;
        else if (line >= second.start && line < second.subEnd) to = first.start + line - second.start;
        else if (line >= first.subEnd && line < second.start) to = first.start + upper.length + line - first.subEnd;
        return mended.shift(to);
      }
      var ok = keptShape(state, mended.lines, function (e) { return parentOfEntry(state, e); }, lineMap);
      return ok ? result(mended.lines, lineMap(entry.start)) : null;
    }
    /* Siblings written at different columns ('  - a' then '- b') may nest
     * once swapped; each block then takes the column of the place it moves
     * to, which is a sibling's column there. */
    return attempt(blockSecond, blockFirst) ||
      (first.kind === 'bullet' && first.indent !== second.indent
        ? attempt(shiftIndent(blockSecond, second.indent, first.indent), shiftIndent(blockFirst, first.indent, second.indent))
        : null);
  }

  function canIndent(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return false;
    var sibs = siblingEntries(state, entry);
    var i = indexOfEntry(sibs, entry);
    if (i <= 0) return false;
    var prev = sibs[i - 1];
    if (prev.kind !== entry.kind) return false;
    if (entry.kind !== 'heading') return true;
    return deepestHeading(state, entry) + (prev.level + 1 - entry.level) <= MAX_HEADING;
  }

  /* Every heading of a block moved by `delta` levels (text in fences left
   * alone); null if one would leave h1..h6. */
  function shiftHeadings(lines, from, to, delta) {
    var block = lines.slice(from, to);
    var fenced = fencedLines(block);
    for (var i = 0; i < block.length; i++) {
      if (fenced[i]) continue;
      var m = matchHeading(block[i]);
      if (!m) continue;
      var level = m[2].length + delta;
      if (level < 1 || level > MAX_HEADING) return null;
      lines[from + i] = m[1] + repeat('#', level) + m[3] + m[4];
    }
    return lines;
  }

  function shiftBullets(lines, from, to, delta) {
    for (var i = from; i < to; i++) lines[i] = reindent(lines[i], delta);
    return lines;
  }

  /* The text a top-level item owns from outside its item (see parse) moved
   * in, to its content column, keeping its own shape: done before anything
   * is written after the item's inside, which would otherwise cut the text
   * off from it. Lines are changed in place. */
  function bringInside(lines, entry) {
    if (entry.outside < 0) return;
    var low = Infinity;
    var k;
    for (k = entry.outside; k < entry.subEnd; k++) if (!isBlank(lines[k])) low = Math.min(low, leadCol(lines[k]));
    if (low >= entry.contentCol) return;
    for (k = entry.outside; k < entry.subEnd; k++) lines[k] = reindent(lines[k], entry.contentCol - low);
  }

  function indent(state, path) {
    if (!canIndent(state, path)) return null;
    var entry = entryAt(state, path);
    var sibs = siblingEntries(state, entry);
    var prev = sibs[indexOfEntry(sibs, entry) - 1];
    var lines = state.lines.slice();
    if (entry.kind === 'heading') {
      if (!shiftHeadings(lines, entry.start, entry.subEnd, prev.level + 1 - entry.level)) return null;
    } else {
      /* Text a top-level item owns from outside its item (see parse) can
       * only stay outside at the top: the item above takes its own inside,
       * or this one could not get under it, and so does this one, which
       * would otherwise hand it to its new parent. */
      bringInside(lines, prev);
      bringInside(lines, entry);
      shiftBullets(lines, entry.start, entry.subEnd, prev.contentCol - entry.indent);
      if (entry.ordered !== null) {
        var kids = prev.children;
        var last = kids[kids.length - 1];
        var number = last && last.kind === 'bullet' && last.ordered !== null && last.delim === entry.delim
          ? nextNumber(last, kids) : 1;
        renumberLines(lines, entry.start, entry.subEnd, number);
      }
    }
    var ok = keptShape(state, lines, function (e) { return e === entry ? prev : parentOfEntry(state, e); });
    return ok ? result(lines, entry.start) : null;
  }

  function canOutdent(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return false;
    var parent = entryAt(state, parentPath(entry.path));
    return !!parent && parent.kind === entry.kind;
  }

  /* The node steps out beside its parent, and what came after it inside the
   * parent - its later siblings, the parent's text after them - stays below
   * it and so becomes its own, the way a list behaves when its line loses
   * its indent in any editor. */
  function outdent(state, path) {
    if (!canOutdent(state, path)) return null;
    var entry = entryAt(state, path);
    var parent = entryAt(state, parentPath(entry.path));
    var grand = entryAt(state, parentPath(parent.path));
    var sibs = siblingEntries(state, entry);
    var at = indexOfEntry(sibs, entry);
    var later = sibs.slice(at + 1);
    var lines = state.lines.slice();
    if (entry.kind === 'heading') {
      if (!shiftHeadings(lines, entry.start, entry.subEnd, parent.level - entry.level)) return null;
    } else {
      var delta = parent.indent - entry.indent;
      shiftBullets(lines, entry.start, entry.subEnd, delta);
      if (entry.ordered !== null && parent.ordered !== null && parent.delim === entry.delim) {
        renumberLines(lines, entry.start, entry.subEnd, nextNumber(parent, siblingEntries(state, parent)));
      }
      /* What follows must sit at least at the item's new content column to
       * be under it: a '1. ' item is a column wider than the '- ' it may
       * have been under. */
      var push = contentColOf(lines[entry.start]) - parent.contentCol;
      if (later.length && push > 0) shiftBullets(lines, entry.subEnd, innerEnd(state, parent), push);
      /* The first of them now opens a list right under the item's words,
       * where only a 1 starts one. */
      var next = later[0];
      if (next && next.ordered !== null && !entry.children.length && !isBlank(lines[next.start - 1])) {
        renumberLines(lines, next.start, next.subEnd, 1);
      }
    }
    var ok = keptShape(state, lines, function (e) {
      if (e === entry) return grand;
      if (later.indexOf(e) >= 0) return entry;
      return parentOfEntry(state, e);
    });
    return ok ? result(lines, entry.start) : null;
  }

  /* ---------- a branch taken out, and put back ---------- */

  /* The lines of a node and everything under it, with what it takes to put
   * them back: the shape they were written in, and where they hung - the
   * parent's path, the place among its siblings, and the words of every node
   * down to the parent, which survive edits that move positions. */
  function extractBranch(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    var parent = parentPath(entry.path);
    return {
      fragment: {
        text: state.lines.slice(entry.start, entry.subEnd).join('\n').replace(/^\ufeff/, ''),
        kind: entry.kind,
        level: entry.level,
        indent: entry.indent,
        label: labelOf(entry)
      },
      origin: {
        parent: parent,
        index: indexOfEntry(siblingEntries(state, entry), entry),
        lineage: lineageOf(state, parent)
      }
    };
  }

  /* The words of a node and of each node above it, the root first. A
   * synthetic root has no words and is not in the list. */
  function lineageOf(state, path) {
    var out = [];
    while (path !== null && path !== undefined) {
      var entry = state.byPath[path];
      if (entry) out.unshift(labelOf(entry));
      path = parentPath(path);
    }
    return out;
  }

  function sameLineage(state, path, lineage) {
    var got = lineageOf(state, path);
    if (got.length !== lineage.length) return false;
    for (var i = 0; i < got.length; i++) if (got[i] !== lineage[i]) return false;
    return true;
  }

  /* Where a branch goes back to, in the order the answers get less sure:
   * its parent, if still there under the same nodes ('same'); a node with
   * the same words under the same nodes elsewhere, or any node with those
   * words ('moved'); the end of the map under its root ('top'). */
  function placeFor(state, origin) {
    origin = origin || {};
    var lineage = origin.lineage || [];
    var index = typeof origin.index === 'number' && origin.index >= 0 ? origin.index : Infinity;
    /* 'Under the root' only when the root is the map's own (a heading, or
     * the node the branch hung from at the top): a lone list item brought
     * back into an emptied map is not a root for the next branch to nest
     * under, which goes beside it. */
    var root = state.byPath[''];
    var holds = !!root && (root.kind === 'heading' || (lineage.length > 0 && labelOf(root) === lineage[0]));
    var top = { parent: holds ? '' : null, index: Infinity, where: 'top' };
    if (origin.parent === null || origin.parent === undefined) return { parent: null, index: index, where: 'same' };
    /* No node above it: it was one of several top nodes (a synthetic root
     * held them), so it goes back among the top nodes, at its place - also
     * when its going left the document with a single root. */
    if (!lineage.length) return { parent: null, index: index, where: 'same' };
    var at = origin.parent;
    if (state.byPath[at] && sameLineage(state, at, lineage)) return { parent: at, index: index, where: 'same' };
    var last = lineage[lineage.length - 1];
    var i;
    for (i = 0; i < state.flat.length; i++) {
      if (labelOf(state.flat[i]) === last && sameLineage(state, state.flat[i].path, lineage)) {
        return { parent: state.flat[i].path, index: index, where: 'moved' };
      }
    }
    for (i = 0; i < state.flat.length; i++) {
      if (labelOf(state.flat[i]) === last) return { parent: state.flat[i].path, index: Infinity, where: 'moved' };
    }
    return top;
  }

  /* A heading branch at another level: every heading in it shifts by the
   * same amount. Past h6 there is no heading left: null, and the caller
   * writes bullets instead. */
  function relevel(lines, target) {
    var fenced = fencedLines(lines);
    var first = null;
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var m = fenced[i] ? null : matchHeading(lines[i]);
      if (!m) { out.push(lines[i]); continue; }
      if (first === null) first = m[2].length;
      var level = m[2].length + (target - first);
      if (level < 1 || level > MAX_HEADING) return null;
      out.push(m[1] + repeat('#', level) + m[3] + m[4]);
    }
    return out;
  }

  function shiftIndent(lines, from, to) {
    var delta = to - (from || 0);
    var out = [];
    for (var i = 0; i < lines.length; i++) out.push(reindent(lines[i], delta));
    return out;
  }

  /* A node's words written on another kind of line: the markers stay as
   * they were, the words are escaped for the new line ('---' is a fine
   * heading and a rule as a list item; 'Issue #' loses its '#' as a heading). */
  function retitle(text, kind) {
    var marks = peelMarks(text);
    return escapeTitle(unescapeTitle(marks.rest.trim(), kind === 'bullet' ? 'heading' : 'bullet'), kind) + marks.suffix;
  }

  /* A heading branch, or a paragraph, written as bullets from column `base`:
   * the only shape that fits under a bullet, and the one a heading takes past
   * h6. A heading becomes a bullet as deep as it was below the first one;
   * what was written under a heading - its list, its notes, its text - goes
   * to that bullet's content column, so the list nests under it and the text
   * stays text that belongs to it. Blank lines go between list items (the
   * list stays tight) and stay before text and inside code. A lone paragraph
   * becomes a node of its own, since a bullet cannot hold one. */
  function bulletize(lines, kind, base) {
    if (kind !== 'heading') {
      var clean = lines.filter(function (line) { return !isBlank(line); });
      if (kind === 'bullet') return shiftIndent(lines, leadCol(lines[0]), base);
      return [spaces(base) + '- ' + retitle(clean.map(function (line) { return line.trim(); }).join(' '), 'bullet')];
    }
    var fenced = fencedLines(lines);
    var out = [];
    var top = null;
    var depth = 0;
    var gap = false;
    var underHeading = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (fenced[i] && isBlank(line)) { out.push(''); continue; }
      if (isBlank(line)) { gap = out.length > 0; continue; }
      var m = fenced[i] ? null : matchHeading(line);
      if (m) {
        if (top === null) top = m[2].length;
        depth = Math.max(0, m[2].length - top);
        out.push(spaces(base + depth * INDENT_STEP) + '- ' + retitle(dropClosing(m[4]), 'bullet'));
        gap = false;
        underHeading = true;
        continue;
      }
      var item = fenced[i] ? null : LIST_RE.exec(line);
      if (item && THEMATIC_RE.test(line)) item = null;
      /* A numbered item that came right under a heading or after a blank
       * line keeps both its number and its being an item: under the words
       * of the bullet the heading became, or under text, a blank line is
       * what lets a list start at any number. (Straight under text with no
       * blank line it was never an item, only more of the text, and stays
       * so.) Other blank lines between items go: the list stays tight. */
      var numbered = item && item[2].length > 1 && parseInt(item[2], 10) !== 1;
      if ((gap && !item) || (numbered && (underHeading || gap))) out.push('');
      gap = false;
      underHeading = false;
      out.push(reindent(line, base + (depth + 1) * INDENT_STEP));
    }
    return out;
  }

  /* Blank runs outside code folded to one line, none at either end. */
  function tidyBlanks(lines) {
    var fenced = fencedLines(lines);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      if (isBlank(lines[i]) && !fenced[i] && (!out.length || isBlank(out[out.length - 1]))) continue;
      out.push(lines[i]);
    }
    while (out.length && isBlank(out[out.length - 1])) out.pop();
    return out;
  }

  /* A bullet branch, or a paragraph, written as a heading at `level`: its
   * first line becomes the heading, what hung under it comes out to the left
   * edge where a heading's own list (and its text) starts. */
  function headingize(lines, kind, level) {
    var clean = lines.filter(function (line) { return !isBlank(line); });
    if (kind !== 'bullet') {
      return [repeat('#', level) + ' ' + retitle(clean.map(function (line) { return line.trim(); }).join(' '), 'heading')];
    }
    var m = LIST_RE.exec(clean[0]);
    if (!m) return [repeat('#', level) + ' ' + retitle(clean[0].trim(), 'heading')].concat(tidyBlanks(lines.slice(1)));
    var from = colOf(clean[0], 0, m[1].length + m[2].length + m[3].length, 0);
    var under = lines.indexOf(clean[0]) + 1;
    var rest = tidyBlanks(shiftIndent(lines.slice(under), from, 0));
    /* A '7.' straight under the item's words was more of them (a list may
     * not interrupt them at 7); under a heading and a blank line it would
     * start a list, so its number is escaped to stay the text it was. */
    if (rest.length && !isBlank(lines[under]) && waitsForBlank(rest[0])) rest[0] = rest[0].replace(/^(\s*\d{1,9})([.)])/, '$1\\$2');
    var title = m[4];
    var box = TASK_RE.exec(title);
    if (box) title = title.slice(box[0].length);
    return [repeat('#', level) + ' ' + retitle(title, 'heading')].concat(rest.length ? [''].concat(rest) : []);
  }

  /* The number a numbered item takes where it lands: the next one when it
   * joins a list after an item of it; the list's first number when it goes
   * in front of the list and its own would not come first; 1 when it would
   * otherwise sit straight under a paragraph (CommonMark reads a '2.' there
   * as words); its own number in every other case. */
  function renumberFirst(block, kids, prevKid, nextKid, lines, at) {
    var m = /^([ \t]*)(\d{1,9})([.)])/.exec(block[0] || '');
    if (!m) return;
    var col = leadCol(block[0]);
    function sameList(kid) {
      return kid && kid.kind === 'bullet' && kid.ordered !== null && kid.delim === m[3] && kid.indent === col;
    }
    var number = parseInt(m[2], 10);
    if (sameList(prevKid)) {
      number = lazyNumbers(kids) ? prevKid.ordered : prevKid.ordered + 1;
    } else if (!prevKid) {
      if (sameList(nextKid) && number >= nextKid.ordered) number = nextKid.ordered;
      if (underWords(lines, at)) number = 1;
    }
    renumberLines(block, 0, block.length, number);
  }

  function isTaskLine(line) {
    var m = LIST_RE.exec(line || '');
    return !!m && TASK_RE.test(m[4]);
  }

  /* The text a bullet fragment's item owns from outside the item (see
   * parse): the line it starts on, or -1. The fragment is read as a file of
   * its own, moved to the left edge so a deep item still reads as an item. */
  function fragmentOutside(frag, fromIndent) {
    var alone = parse(shiftIndent(frag, fromIndent, 0).join('\n'));
    var head = alone.flat[0];
    return head && head.start === 0 ? head.outside : -1;
  }

  /* A branch written back under `parentPath` (null: the top of the
   * document) at `index` among its children, or at the end. It takes the
   * shape of the children it joins: under a heading, a heading one level
   * down beside its sub-headings and a list item among its list; under a
   * bullet always a bullet one content column in; at the top, the shape of
   * the top nodes. Past h6 a heading branch is written as bullets. A to-do
   * stays a list item wherever it goes (Markdown has no checkbox heading):
   * among sub-headings it joins the heading's list instead. A list item goes
   * in at the column of the item it lands before - a list may be written
   * indented, and at another column the two could nest - and after any text
   * written deeper than its words right there (see pastDeeper). */
  function insertBranch(state, parentPathArg, index, fragment) {
    var frag = normalizeText(fragment && fragment.text).replace(/^\ufeff/, '').split('\n');
    while (frag.length && isBlank(frag[frag.length - 1])) frag.pop();
    while (frag.length && isBlank(frag[0])) frag.shift();
    if (!frag.length) return null;

    var kind = fragment.kind;
    if (kind !== 'heading' && kind !== 'bullet' && kind !== 'text') {
      kind = matchHeading(frag[0]) ? 'heading' : (LIST_RE.test(frag[0]) && !THEMATIC_RE.test(frag[0]) ? 'bullet' : 'text');
    }
    var fromIndent = typeof fragment.indent === 'number' ? fragment.indent : leadCol(frag[0]);
    if (typeof index !== 'number' || index < 0 || index !== index) index = Infinity;
    var task = kind === 'bullet' && isTaskLine(frag[0]);
    var outside = kind === 'bullet' ? fragmentOutside(frag, fromIndent) : -1;

    var lines = state.lines.slice();
    var trailing = 0;
    while (lines.length && isBlank(lines[lines.length - 1])) { lines.pop(); trailing++; }
    var parent = parentPathArg == null ? null : (state.byPath[parentPathArg] || null);
    var block = null;
    var at;
    var kids;
    var prevKid = null;
    /* Whether the branch lands as a top-level list item: the one place the
     * text its item owns from outside can stay outside, still the item's. */
    var atTop = false;

    function asHeading(level) {
      if (level > MAX_HEADING) return null;
      return kind === 'heading' ? relevel(frag, level) : headingize(frag, kind, level);
    }
    function asBullets(base) {
      if (kind !== 'bullet') return bulletize(frag, kind, base);
      var own = frag;
      if (outside >= 0 && !atTop) {
        own = frag.slice();
        bringInside(own, { outside: outside, subEnd: own.length, contentCol: contentColOf(own[0]) });
      }
      return shiftIndent(own, fromIndent, base);
    }
    function amongHeadings(list, end) {
      for (var k = Math.min(index, list.length); k < list.length; k++) {
        if (list[k].kind === 'heading') return list[k].start;
      }
      return end;
    }

    if (!parent) {
      kids = topEntries(state);
      var near = kids.length ? kids[Math.min(index, kids.length - 1)] : null;
      var asList = near ? near.kind === 'bullet' : kind !== 'heading';
      if (!asList && task) {
        /* The list in front of the first top heading is the only list at
         * the top of a document that has headings. */
        var lead = 0;
        while (lead < kids.length && kids[lead].kind === 'bullet') lead++;
        index = Math.min(index, lead);
        asList = true;
      }
      if (!asList) block = asHeading(1);
      if (block) kind = 'heading';
      else {
        atTop = true;
        block = asBullets(index < kids.length && kids[index].kind === 'bullet' ? kids[index].indent : 0);
        kind = 'bullet';
        prevKid = kids[Math.min(index, kids.length) - 1] || null;
      }
      at = index < kids.length ? kids[index].start : lines.length;
    } else if (parent.kind === 'heading') {
      kids = parent.children;
      var items = kids.filter(function (kid) { return kid.kind !== 'heading'; });
      /* A heading's list comes before its sub-headings, so the place asked
       * for decides the shape: inside the list it is a list item, past it
       * (among the sub-headings) a heading, and right at the boundary it
       * keeps the shape it had - which is what puts a branch back exactly
       * where it was taken from. */
      var place = Math.min(index, kids.length);
      var wantHeading = place > items.length || (place === items.length && kind === 'heading');
      if (wantHeading && task) { wantHeading = false; index = items.length; }
      if (wantHeading) block = asHeading(parent.level + 1);
      if (block) {
        kind = 'heading';
        at = amongHeadings(kids, parent.subEnd);
      } else {
        block = asBullets(index < items.length ? items[index].indent : 0);
        kind = 'bullet';
        if (index < items.length) { at = items[index].start; prevKid = items[index - 1] || null; } else if (items.length) { at = items[items.length - 1].subEnd; prevKid = items[items.length - 1]; } else at = bulletInsertPoint(state, parent);
      }
    } else {
      kids = parent.children;
      block = asBullets(index < kids.length ? kids[index].indent : parent.contentCol);
      kind = 'bullet';
      if (index < kids.length) { at = kids[index].start; prevKid = kids[index - 1] || null; } else { at = innerEnd(state, parent); prevKid = kids[kids.length - 1] || null; }
    }
    at = Math.min(at, lines.length);
    var nextKid = null;
    var runsOn = false;
    var skipped = false;
    if (kind === 'bullet') {
      var past = pastDeeper(state, at, contentColOf(block[0]));
      runsOn = past > at && past < lines.length && !isBlank(lines[past]) && state.kinds[past] !== K_NODE;
      skipped = past > at;
      at = Math.min(past, lines.length);
      nextKid = kids && index < kids.length ? kids[index] : null;
      renumberFirst(block, kids || [], prevKid, nextKid, lines, at);
    }

    var appended = at >= lines.length;
    var follows = !appended && !!entryStartingAt(state, at);
    /* A heading needs a blank line on each side to be one; a list right
     * under a heading gets one too, and a list ending where a heading starts
     * needs one or the heading is read into its last item. Text the item
     * keeps outside it ends with a blank line before what comes next, as it
     * was written. */
    var before = lines[at - 1];
    var after = lines[at];
    var gapBefore = at > 0 && !isBlank(before) && (kind === 'heading' || !!matchHeading(before) || skipped);
    var gapAfter = after !== undefined && !isBlank(after) &&
      (kind === 'heading' || !!matchHeading(after) || (atTop && outside >= 0) || runsOn);
    if (gapBefore) block.unshift('');
    if (gapAfter) block.push('');
    /* The item that was first in its numbered list and now follows the
     * inserted one: two '1.' in a row would read as a restart to a person,
     * so it takes the next number (unless the list numbers every item 1). */
    var om = /^[ \t]*(\d{1,9})([.)])/.exec(block[gapBefore ? 1 : 0] || '');
    if (om && nextKid && nextKid.kind === 'bullet' && nextKid.ordered === Number(om[1]) &&
        nextKid.delim === om[2] && nextKid.start === at && !lazyNumbers(kids)) {
      renumberLines(lines, nextKid.start, nextKid.subEnd, nextKid.ordered + 1);
    }
    lines.splice.apply(lines, [at, 0].concat(block));
    var head = at + (gapBefore ? 1 : 0);
    var starts = [head];
    if (follows) starts.push(at + block.length);
    var mended = mendStarts(lines, starts);
    lines = mended.lines;
    if (appended) lines.push('');
    else for (var t = 0; t < trailing; t++) lines.push('');
    return result(lines, mended.shift(head));
  }

  /* Drag and drop: the node and its subtree become the last child of
   * `targetPath`, or its sibling just before or after it - one edit, shaped
   * by insertBranch to fit where it lands. Null for a drop into its own
   * subtree, onto itself, or onto the place it already has. */
  function planMove(state, path, targetPath, where) {
    var entry = entryAt(state, path);
    var target = entryAt(state, targetPath);
    if (!entry || !target || entry === target || isDescendantPath(target.path, entry.path)) return null;
    var own = parentPath(entry.path);
    if (own !== null && !state.byPath[own]) own = null;
    var parent;
    var index;
    if (where === 'child') {
      parent = target.path;
      index = Infinity;
      if (own === parent && target.children[target.children.length - 1] === entry) return null;
    } else if (where === 'before' || where === 'after') {
      parent = parentPath(target.path);
      if (parent !== null && !state.byPath[parent]) parent = null;
      var sibs = siblingEntries(state, target);
      var ti = indexOfEntry(sibs, target);
      index = where === 'before' ? ti : ti + 1;
      if (own === parent) {
        var ei = indexOfEntry(sibs, entry);
        if (ei >= 0 && (index === ei || index === ei + 1)) return null;
      }
    } else {
      return null;
    }
    /* A to-do has no heading shape: dropped among headings it could only
     * land somewhere else, so it does not land. (As a child it joins the
     * heading's list, which is still under that heading.) */
    if (entry.task !== null && where !== 'child' && noListAt(state, entry, parent, index)) return null;
    return { entry: entry, parent: parent, index: index, sameParent: own === parent };
  }

  /* Whether no list item can stand at `index` under `parentPath` (null: the
   * top) once `entry` has left its place: among a heading's sub-headings,
   * or between top headings. The same rule insertBranch shapes by. */
  function noListAt(state, entry, parentPathArg, index) {
    var parent = parentPathArg === null ? null : state.byPath[parentPathArg];
    var kids = parent ? parent.children.slice() : topEntries(state);
    var mine = indexOfEntry(kids, entry);
    if (mine >= 0) {
      kids.splice(mine, 1);
      if (index > mine) index--;
    }
    if (parent && (parent.kind !== 'heading' || parent.level >= MAX_HEADING)) return false;
    var items = 0;
    while (items < kids.length && kids[items].kind !== 'heading') items++;
    return Math.min(index, kids.length) > items;
  }

  function canMoveTo(state, path, targetPath, where) {
    return !!planMove(state, path, targetPath, where);
  }

  function moveTo(state, path, targetPath, where) {
    var plan = planMove(state, path, targetPath, where);
    if (!plan) return null;
    var entry = plan.entry;
    var fragment = extractBranch(state, entry.path).fragment;
    var parentEntry = plan.parent === null ? null : state.byPath[plan.parent];
    var removed = removeBlock(state, entry);
    var after = parse(removed.lines.join('\n'));
    var newParent = null;
    if (parentEntry) {
      var found = entryStartingAt(after, removed.map(parentEntry.start));
      if (!found) return null;
      newParent = found.path;
    }
    var index = plan.index;
    if (plan.sameParent && index !== Infinity && index > indexOfEntry(siblingEntries(state, entry), entry)) index--;
    var put = insertBranch(after, newParent, index, fragment);
    if (!put) return null;
    /* The drop is checked against what it meant: as many nodes as before,
     * the moved one where it was asked to go. A file shape no rule here
     * foresaw refuses the drop rather than rearranging the map. */
    var next = parse(put.text);
    var landedAt = entryStartingAt(next, put.anchorLine);
    if (!landedAt || next.flat.length !== state.flat.length) return null;
    var under = landedAt.parentIndex >= 0 ? next.flat[landedAt.parentIndex] : null;
    if (newParent === null ? under : !under || under.start !== found.start) return null;
    return { text: put.text, anchorLine: put.anchorLine, selectPath: landedAt.path };
  }

  /* ---------- the files a text names ---------- */

  function isFileRef(path) { return !!path && !/^[a-z][a-z0-9+.-]*:/i.test(path); }

  /* Every file a text points at: pictures (Markdown and <img>, paths with
   * spaces or %20 included - a file missing from here is a file the trash
   * would offer to throw away) and the board. Data and web URLs are not
   * files. */
  function refsInText(text) {
    var out = [];
    var seen = Object.create(null);
    var lines = Array.isArray(text) ? text : normalizeText(text).split('\n');
    function add(path) {
      if (!isFileRef(path) || seen[path]) return;
      seen[path] = true;
      out.push(path);
    }
    for (var i = 0; i < lines.length; i++) {
      var board = readBoard(lines[i]);
      if (board) { add(board.path); continue; }
      var pics = findPictures(lines[i]);
      for (var k = 0; k < pics.length; k++) {
        add(pics[k].path);
        if (pics[k].src.trim() !== pics[k].path) add(pics[k].src.trim());
      }
    }
    return out;
  }

  function imageRefs(state) { return refsInText(state.lines); }

  /* A file renamed: every picture naming it and the board marker name the
   * new path. */
  function renameRef(text, from, to) {
    if (!from || from === to) return text;
    var lines = String(text).split('\n');
    var board = new RegExp('(<!--\\s*board\\s*:\\s*)' + escapeRe(from) + '(?=\\s*(?:\\||-->))', 'gi');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var pics = findPictures(line);
      for (var k = pics.length - 1; k >= 0; k--) {
        var pic = pics[k];
        if (pic.path !== from && pic.src.trim() !== from) continue;
        if (pic.destStart !== undefined) {
          line = line.slice(0, pic.destStart) + formatDest(to, pic.angle) + line.slice(pic.destEnd);
        } else {
          var markup = pic.markup.replace(/(\ssrc\s*=\s*)("([^"]*)"|'([^']*)'|[^\s"'=<>`]+)/i, function (all, head) {
            return head + '"' + String(to).replace(/"/g, '&quot;') + '"';
          });
          line = line.slice(0, pic.start) + markup + line.slice(pic.end);
        }
      }
      lines[i] = line.replace(board, function (all, head) { return head + to; });
    }
    return lines.join('\n');
  }

  /* ---------- ids and mentions ---------- */

  var ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

  /* A new id: 'n' and five letters or digits, none of `taken`. */
  function newId(taken) {
    for (var tries = 0; tries < 200; tries++) {
      var id = 'n';
      var bytes = null;
      try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) bytes = crypto.getRandomValues(new Uint8Array(5)); } catch (err) { bytes = null; }
      for (var k = 0; k < 5; k++) id += ID_CHARS.charAt((bytes ? bytes[k] : Math.floor(Math.random() * 256)) % 36);
      if (!taken || !taken[id]) return id;
    }
    return 'n' + Date.now().toString(36).slice(-6);
  }

  /* {id: path} of the nodes that have one (the first of a repeated id). */
  function idsOf(state) {
    var out = {};
    if (!state || !state.flat) return out;
    state.flat.forEach(function (e) { if (e.id && !out[e.id]) out[e.id] = e.path; });
    return out;
  }

  function pathOfId(state, id) {
    var at = idsOf(state)[String(id || '').toLowerCase()];
    return at === undefined ? null : at;
  }

  /* The node's id, given one if it has none: {id, result} where result is
   * the edit that writes it (null when it already had one). */
  function ensureId(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    if (entry.id) return { id: entry.id, result: null };
    var id = newId(idsOf(state));
    var lines = state.lines.slice();
    lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, { id: id });
    return { id: id, result: result(lines, entry.start, path) };
  }

  /* ---------- who wrote a node ---------- */

  /* 'ai', 'mixed' or 'human' (no marker). */
  function byAt(state, path) {
    var entry = entryAt(state, path);
    return entry ? (entry.by || 'human') : null;
  }

  /* The node marked as written by `by` ('ai', 'mixed'; 'human' or null takes
   * the marker off). null when nothing changes. */
  function setBy(state, path, by) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    var want = BYS[by] ? by : null;
    if ((entry.by || null) === want) return null;
    var lines = state.lines.slice();
    lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, { by: want });
    return result(lines, entry.start, path);
  }

  /* What a node becomes once the person changes words the AI wrote in it, or
   * takes the AI's words into words of their own: mixed, either way. */
  function byAfterEdit(was, aiWords) {
    if (was === 'ai' || was === 'mixed') return 'mixed';
    return aiWords ? 'mixed' : null;
  }

  /* A tree of titles ([{title, children}]) added under `path` (a new top of
   * the map with path null), in order, each node marked `by` (or not, with
   * none). At most `max` nodes (200 by default). Returns {result, made}, the
   * result anchored on the first node made, or null when nothing was. */
  function addOutline(state, path, nodes, by, max) {
    var limit = Math.max(1, Math.min(max || 200, 1000));
    var made = 0;
    var first = null;
    var text = null;
    var st = state;
    function under(parent, list) {
      for (var i = 0; i < (list || []).length && made < limit; i++) {
        var n = list[i];
        var title = n && typeof n.title === 'string' ? n.title : '';
        if (!title.trim()) continue;
        var out = parent === null ? addRoot(st, title) : addChild(st, parent, title);
        if (!out || out.anchorLine === undefined) continue;
        var next = parse(out.text);
        var e = findByLine(next, out.anchorLine);
        if (!e) continue;
        var marked = BYS[by] ? setBy(next, e.path, by) : null;
        if (marked) next = parse(marked.text);
        st = next;
        text = st.lines.join('\n');
        made++;
        var at = findByLine(st, out.anchorLine);
        var here = at ? at.path : e.path;
        if (first === null) first = out.anchorLine;
        if (n.children && n.children.length) under(here, n.children);
      }
    }
    if (path !== null && path !== undefined && !entryAt(state, path)) return null;
    under(path === undefined ? null : path, nodes);
    if (!made) return null;
    var res = { text: text };
    if (first !== null) res.anchorLine = first;
    return { result: res, made: made };
  }

  /* Every [[...]] a text writes, with the node it is written in:
   * [{path, name, node, label}] (name '' means the same map). Not read
   * inside a code fence. Cached: every map of a project is asked at each
   * change to see who mentions what. */
  var refCache = new Map();
  function wikiRefs(text) {
    var key = normalizeText(text);
    if (refCache.has(key)) return refCache.get(key);
    var out = [];
    if (key.indexOf('[[') >= 0) {
      var state = parse(key);
      var fenced = fencedLines(state.lines);
      var flat = state.flat;
      var k = -1;
      for (var i = 0; i < state.lines.length; i++) {
        while (k + 1 < flat.length && flat[k + 1].start <= i) k++;
        if (fenced[i] || k < 0) continue;
        var line = state.lines[i];
        var at = 0;
        while ((at = line.indexOf('[[', at)) >= 0) {
          var w = parseWiki(line, at);
          if (w) { out.push({ path: flat[k].path, name: w.name, node: w.node, label: w.label }); at = w.end; } else at += 2;
        }
      }
    }
    if (refCache.size >= 64) refCache.delete(refCache.keys().next().value);
    refCache.set(key, out);
    return out;
  }

  function sameMapName(a, b) {
    function norm(x) { return String(x || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(); }
    return norm(a) === norm(b);
  }

  /* A map renamed: every link that names it names the new name. A link's
   * own words are left as written. */
  function renameMapLinks(text, from, to) {
    var clean = String(to == null ? '' : to).trim();
    if (!from || !clean || sameMapName(from, clean) || /[\[\]|\n#]/.test(clean)) return text;
    var norm = normalizeText(text);
    if (norm.indexOf('[[') < 0) return text;
    var lines = norm.split('\n');
    var fenced = fencedLines(lines);
    var changed = false;
    for (var i = 0; i < lines.length; i++) {
      if (fenced[i] || lines[i].indexOf('[[') < 0) continue;
      var line = lines[i];
      var at = 0;
      while ((at = line.indexOf('[[', at)) >= 0) {
        var w = parseWiki(line, at);
        if (!w) { at += 2; continue; }
        if (w.name && sameMapName(w.name, from)) {
          var inner = line.slice(at + 2, w.end - 2);
          var bar = inner.indexOf('|');
          var rewritten = '[[' + clean + (w.node ? '#' + w.node : '') + (bar >= 0 ? inner.slice(bar) : '') + ']]';
          line = line.slice(0, at) + rewritten + line.slice(w.end);
          at += rewritten.length;
          changed = true;
        } else at = w.end;
      }
      lines[i] = line;
    }
    return changed ? lines.join('\n') : text;
  }

  /* A text with its id markers taken off (a branch copied: the copy must
   * not take the name of the original). With `only` ({id: true}), just the
   * ids it lists are taken off - a branch pasted into another map keeps the
   * ones that name nothing there. */
  function stripIds(text, only) {
    return String(text).replace(/([ \t]*)<!--\s*id\s*:\s*([a-z0-9]{4,12})\s*-->/gi, function (all, space, id, offset, whole) {
      if (!space && offset > 0 && whole.charAt(offset - 1) === '\\') return all;
      return only && !only[id.toLowerCase()] ? all : '';
    });
  }

  var countCache = new Map();
  /* How many nodes a text has - the real parser's answer, cached because the
   * sidebar asks for every map on every change. */
  function countNodes(text) {
    var key = normalizeText(text);
    if (countCache.has(key)) return countCache.get(key);
    var value = parse(key).flat.length;
    if (countCache.size >= 64) countCache.delete(countCache.keys().next().value);
    countCache.set(key, value);
    return value;
  }

  /* ---------- the picture in a box ---------- */

  /* A node is written in two boxes - its line, and the words under it - and
   * a picture stands in either the same way. Every picture question names
   * the box; this is the one place that knows where each box is written. */
  function boxOf(state, path, field) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    if (field === 'body') {
      var body = entry.body || null;
      return {
        entry: entry, field: 'body', body: body,
        text: body ? body.text : '',
        above: !!(body && body.above),
        drawAbove: !!(body && body.drawAbove)
      };
    }
    return { entry: entry, field: 'line', body: null, text: entry.title, above: entry.imageAbove, drawAbove: entry.drawAbove };
  }

  function aboveOf(box, kind) { return kind === DRAW ? box.drawAbove : box.above; }

  function aboveFlags(box, kind, value) {
    return {
      above: kind === DRAW ? box.above : !!value,
      drawAbove: kind === DRAW ? !!value : box.drawAbove
    };
  }

  function writeBox(state, box, split, flags) {
    var entry = box.entry;
    var lines = state.lines.slice();
    var text = joinBox(split);
    var above = flags && 'above' in flags ? !!flags.above : box.above;
    var drawAbove = flags && 'drawAbove' in flags ? !!flags.drawAbove : box.drawAbove;
    /* Nothing of a kind left in the box: nothing to stand above the words. */
    if (!groupIn(split, PHOTO).side) above = false;
    if (!groupIn(split, DRAW).side) drawAbove = false;

    if (box.field === 'body') {
      if (!box.body) return null;
      var written = text ? noteLinesFor(box.body.prefix, 'body', text, box.body.role, above, drawAbove) : [];
      return result(spliceQuote(state, lines, box.body.line, box.body.end - box.body.line, written), null, entry.path);
    }
    /* An empty line is not a node: the last picture off a node that was only
     * a picture leaves what rename would (the words under it, or "untitled"). */
    if (!text) text = fillEmptyLine(state, entry, lines).label;
    lines[entry.start] = entry.prefix + text + marksFor(entry, { above: above, drawAbove: drawAbove });
    return result(lines, entry.start, entry.path);
  }

  function pictureMarkup(relPath, alt) {
    return '![' + sanitizeInline(alt || '').replace(/[[\]\\]/g, '\\$&') + '](' + formatDest(relPath, false) + ')';
  }

  /* The picture goes into the named box, beside the others of its kind on
   * the side they stand (a kind the box has none of starts on the left).
   * With nothing selected it becomes a node of its own under a new root
   * named for pictures ('Images', or its Italian word when Italian is chosen). */
  function addImage(state, path, relPath, alt, field) {
    var markdown = pictureMarkup(relPath, alt);
    var entry = entryAt(state, path);
    if (!entry) {
      var seeded = addRoot(state, word('doc.images'));
      var next = parse(seeded.text);
      var last = next.flat[next.flat.length - 1];
      return addChild(next, last ? last.path : '', markdown, 'bullet');
    }
    var box = boxOf(state, path, field);
    if (box.field === 'body' && !box.body) return setNote(state, path, 'body', markdown);
    var kind = kindOfImage(markdown);
    var split = splitBox(box.text);
    var group = groupIn(split, kind);
    var run = group.side === 'right' ? split.tail : split.lead;
    run.push({ markup: markdown, kind: kind });
    return writeBox(state, box, split, null);
  }

  function imagesIn(state, path, field, kind) {
    var box = boxOf(state, path, field);
    if (!box) return '';
    return runMarkup(groupIn(splitBox(box.text), kind || PHOTO).items);
  }

  /* The file the last picture of that kind points at: the caller sends it to
   * the trash before the picture comes off. */
  function lastImagePath(state, path, field, kind) {
    var box = boxOf(state, path, field);
    if (!box) return null;
    var items = groupIn(splitBox(box.text), kind || PHOTO).items;
    return items.length ? items[items.length - 1].path : null;
  }

  /* The last picture of that kind comes off; with `which` (a file path)
   * the one naming that file - or, for a notebook, any page of its folder. */
  function removeImage(state, path, field, kind, which) {
    var box = boxOf(state, path, field);
    if (!box) return null;
    kind = kind || PHOTO;
    var split = splitBox(box.text);
    var group = groupIn(split, kind);
    if (!group.items.length) return null;
    var gone = group.items[group.items.length - 1];
    if (which) {
      gone = null;
      var folder = /^(.*\.book)\//i.exec(String(which));
      for (var w = group.items.length - 1; w >= 0 && !gone; w--) {
        var at = String(group.items[w].path || '');
        if (at === which || (folder && at.indexOf(folder[1] + '/') === 0)) gone = group.items[w];
      }
      if (!gone) return null;
    }
    var run = split.lead.indexOf(gone) >= 0 ? split.lead : split.tail;
    run.splice(run.indexOf(gone), 1);
    return writeBox(state, box, split, null);
  }

  /* Left and right move a kind's pictures to the head or the end of the box
   * - the file says it, so Obsidian shows it too; above is the head plus a
   * marker. A box with no words has no position to choose. */
  function setImagePosition(state, path, position, field, kind) {
    var box = boxOf(state, path, field);
    if (!box) return null;
    kind = kind || PHOTO;
    var split = splitBox(box.text);
    var group = groupIn(split, kind);
    if (!group.side || !split.label) return null;
    var above = position === 'above';
    var side = position === 'right' ? 'right' : 'left';
    if (above === aboveOf(box, kind) && (above ? group.side === 'left' : side === group.side)) return null;
    var wanted = above ? 'left' : side;
    if (wanted !== group.side || group.items.some(function (item) { return (wanted === 'left' ? split.tail : split.lead).indexOf(item) >= 0; })) {
      var from = wanted === 'left' ? split.tail : split.lead;
      var to = wanted === 'left' ? split.lead : split.tail;
      for (var i = 0; i < group.items.length; i++) {
        var at = from.indexOf(group.items[i]);
        if (at >= 0) { from.splice(at, 1); to.push(group.items[i]); }
      }
    }
    return writeBox(state, box, split, aboveFlags(box, kind, above));
  }

  function imagePositionAt(state, path, field, kind) {
    var box = boxOf(state, path, field);
    if (!box) return null;
    kind = kind || PHOTO;
    var split = splitBox(box.text);
    var group = groupIn(split, kind);
    if (!group.side || !split.label) return null;
    return aboveOf(box, kind) ? 'above' : group.side;
  }

  /* ---------- colour, role, size ---------- */

  function setColor(state, path, color, options) {
    options = options || {};
    var entry = entryAt(state, path);
    if (!entry) return null;
    var hex = normalizeHex(color);
    var branch = !!options.branch;
    if (!hex && !entry.color) return null;
    if (hex && entry.color === hex && entry.colorBranch === branch) return null;
    var lines = state.lines.slice();
    lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, { color: hex, branch: branch });
    return result(lines, entry.start, path);
  }

  /* A caption is the caption of a picture: it stands the line's pictures
   * above the words, and it is the one thing a size cannot also be. */
  function setRole(state, path, role) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    var wanted = ROLES[role] ? role : null;
    var above = entry.imageAbove;
    var drawAbove = entry.drawAbove;
    var size = wanted ? null : entry.titleSize;
    if (wanted === 'caption') {
      var carried = splitBox(entry.title);
      if (groupIn(carried, PHOTO).side) above = true;
      if (groupIn(carried, DRAW).side) drawAbove = true;
    }
    if (wanted === entry.role && above === entry.imageAbove && drawAbove === entry.drawAbove && size === entry.titleSize) return null;
    var lines = state.lines.slice();
    lines[entry.start] = stripMarks(lines[entry.start] || '', entry) +
      marksFor(entry, { role: wanted, above: above, drawAbove: drawAbove, title: size });
    return result(lines, entry.start, path);
  }

  function roleAt(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    return entry.role || 'paragraph';
  }

  function setTitleSize(state, path, size) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    var wanted = SIZES[String(size).toLowerCase()] ? String(size).toLowerCase() : null;
    var role = wanted ? null : entry.role;
    if (wanted === entry.titleSize && role === entry.role) return null;
    var lines = state.lines.slice();
    lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, { title: wanted, role: role });
    return result(lines, entry.start, path);
  }

  function titleSizeAt(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return null;
    return entry.titleSize || null;
  }

  /* ---------- sides ---------- */

  /* A tree root is a node with no node above it: the one root of a map, or
   * each top node of a map with several. Its children are the first-level
   * branches, the ones a side marker is about. */
  function isTreeRoot(entry) { return !!entry && entry.parentIndex < 0; }

  function isFirstLevel(state, entry) {
    return !!entry && entry.parentIndex >= 0 && !!state.flat[entry.parentIndex] && state.flat[entry.parentIndex].parentIndex < 0;
  }

  function sideSuffix(state, entry) {
    return isFirstLevel(state, entry) && entry.side ? ' ' + sideMarkup(entry.side) : '';
  }

  /* The side a node grows on, 'left' or 'right': its first-level branch's
   * (the marker on that branch's line). A tree root grows on both: null. */
  function sideAt(state, path) {
    var entry = entryAt(state, path);
    if (!entry || isTreeRoot(entry)) return null;
    while (!isFirstLevel(state, entry)) entry = state.flat[entry.parentIndex];
    return entry.side === 'left' ? 'left' : 'right';
  }

  /* Moves first-level branches to a side: {path: 'left' | 'right'}, one
   * edit. A path that is not a first-level branch, or already on that side,
   * is left alone; null when nothing changes. Right writes no marker. */
  function setSides(state, sides) {
    var lines = null;
    var first = -1;
    var only = null;
    for (var path in sides) {
      if (!Object.prototype.hasOwnProperty.call(sides, path)) continue;
      var entry = entryAt(state, path);
      if (!isFirstLevel(state, entry)) continue;
      var wanted = sides[path] === 'left' ? 'left' : 'right';
      if ((entry.side === 'left' ? 'left' : 'right') === wanted) continue;
      if (!lines) lines = state.lines.slice();
      lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, { side: wanted === 'left' ? 'left' : null });
      if (first < 0 || entry.start < first) first = entry.start;
      only = only === null ? path : false;
    }
    if (!lines) return null;
    return result(lines, first, only || null);
  }

  function setSide(state, path, side) {
    var one = {};
    one[path] = side;
    return setSides(state, one);
  }

  /* A node moved somewhere else keeps no side it no longer means: off a
   * line that is not a first-level branch, a 'left' marker is taken away
   * (a word this version does not know is left alone). Only the nodes at
   * `paths` and everything under them when given (an edit rewrites only
   * the lines it is about: a branch moved or pasted deeper brings its own
   * first-level children down with it), else every node. */
  function dropStraySides(state, paths) {
    var lines = null;
    var list = state.flat;
    if (paths) {
      var asked = paths.filter(function (p) { return !!entryAt(state, p); });
      list = state.flat.filter(function (e) {
        return asked.some(function (p) { return e.path === p || isDescendantPath(e.path, p); });
      });
    }
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry) continue;
      var straySide = entry.side === 'left' && !isFirstLevel(state, entry);
      if (!straySide) continue;
      var change = { side: null };
      if (!lines) lines = state.lines.slice();
      lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, change);
    }
    return lines ? result(lines) : null;
  }

  /* The nodes put somewhere by hand: {path: {x, y}} (a top node of a map
   * with several: on the map; any other: from its parent's middle). Only
   * those at `under` and below it when given. */
  function positionsOf(state, under) {
    var out = {};
    if (!state || !state.flat) return out;
    state.flat.forEach(function (e) {
      if (!e.at || (e.path === '' && under !== undefined && under !== null && under !== '')) return;
      if (under !== undefined && under !== null && e.path !== under && !isDescendantPath(e.path, under)) return;
      out[e.path] = { x: e.at.x, y: e.at.y };
    });
    return out;
  }

  /* Nodes put where they are asked ({path: {x, y}}), or back where the
   * layout puts them (null): one edit. The map's one root is passed over. */
  function setPositions(state, where) {
    var lines = null;
    var first = -1;
    if (!state) return null;
    for (var path in where) {
      if (!Object.prototype.hasOwnProperty.call(where, path)) continue;
      var entry = entryAt(state, path);
      /* The map's one root takes no place; one left from when it had
       * company is only taken off. */
      if (!entry || (path === '' && where[path])) continue;
      var w = where[path];
      var at = w && isFinite(w.x) && isFinite(w.y) ? { x: Math.round(w.x), y: Math.round(w.y) } : null;
      if ((!at && !entry.at) || (at && entry.at && at.x === entry.at.x && at.y === entry.at.y)) continue;
      if (!lines) lines = state.lines.slice();
      lines[entry.start] = stripMarks(lines[entry.start] || '', entry) + marksFor(entry, { at: at });
      if (first < 0 || entry.start < first) first = entry.start;
    }
    return lines ? result(lines, first) : null;
  }

  /* Every node (or every one of a branch) back where the layout puts it. */
  function clearPositions(state, under) {
    var all = {};
    Object.keys(positionsOf(state, under)).forEach(function (p) { all[p] = null; });
    return setPositions(state, all);
  }

  /* Everything about each node that is not its words, for renderers that
   * still want it flat (viewTree() carries the same in one tree). Plain
   * nodes are left out. */
  function styleFlags(state) {
    var flags = {};
    var list = (state && state.flat) || [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var body = entry.body ? splitBox(entry.body.text) : null;
      var words = body ? body.label : '';
      var photos = body ? groupIn(body, PHOTO) : null;
      var draws = body ? groupIn(body, DRAW) : null;
      var pictures = (photos ? photos.items.length : 0) + (draws ? draws.items.length : 0);
      if (!entry.role && !entry.titleSize && !entry.imageAbove && !entry.drawAbove && !words && !pictures) continue;
      flags[entry.path] = {
        role: entry.role,
        size: entry.titleSize,
        above: entry.imageAbove,
        drawAbove: entry.drawAbove,
        body: words,
        bodyRole: entry.body ? entry.body.role : null,
        bodyImages: photos ? runMarkup(photos.items) : '',
        bodyPosition: (photos && photos.side) || 'left',
        bodyAbove: !!(entry.body && entry.body.above),
        bodyDraws: draws ? runMarkup(draws.items) : '',
        bodyDrawPosition: (draws && draws.side) || 'left',
        bodyDrawAbove: !!(entry.body && entry.body.drawAbove)
      };
    }
    return flags;
  }

  /* ---------- tasks ---------- */

  function toggleTask(state, path) {
    var entry = entryAt(state, path);
    if (!entry || entry.task === null) return null;
    var lines = state.lines.slice();
    var head = entry.prefix.slice(0, entry.prefix.length - entry.box.length);
    lines[entry.start] = head + (entry.task ? '[ ]' : '[x]') + entry.box.slice(3) + lines[entry.start].slice(entry.prefix.length);
    return result(lines, entry.start, path);
  }

  /* A checkbox put on (true) or taken off (false) a list item. */
  function setTask(state, path, on) {
    var entry = entryAt(state, path);
    if (!entry || entry.kind !== 'bullet' || (entry.task !== null) === !!on) return null;
    var lines = state.lines.slice();
    var rest = lines[entry.start].slice(entry.prefix.length);
    if (on) lines[entry.start] = entry.prefix + '[ ] ' + rest;
    else lines[entry.start] = entry.prefix.slice(0, entry.prefix.length - entry.box.length) + rest;
    return result(lines, entry.start, path);
  }

  /* ---------- marks inside a title ---------- */

  /* Bold and italic are Markdown's own, underline is <u> (HTML that Obsidian
   * draws too). These work on a plain string and two offsets, the same for
   * the rename box on the map and the Markdown panel. */
  var UNDERLINE_OPEN = '<u>';
  var UNDERLINE_CLOSE = '</u>';

  function clampRange(text, start, end) {
    var from = Math.max(0, Math.min(text.length, start | 0));
    var to = Math.max(0, Math.min(text.length, end | 0));
    return from <= to ? { start: from, end: to } : { start: to, end: from };
  }

  function unwrapStars(text, start, end) {
    while (end - start > 2 && text.charAt(start) === '*' && text.charAt(end - 1) === '*') { start++; end--; }
    return { start: start, end: end };
  }

  /* How many stars hug the choice on both sides at once: two make it bold,
   * an odd number italic, three both. */
  function starsAround(text, start, end) {
    var before = 0;
    while (start - before > 0 && text.charAt(start - before - 1) === '*') before++;
    var after = 0;
    while (end + after < text.length && text.charAt(end + after) === '*') after++;
    return Math.min(before, after, 3);
  }

  function toggleStars(text, start, end, want) {
    var bounds = unwrapStars(text, start, end);
    var stars = starsAround(text, bounds.start, bounds.end);
    var on = want === 2 ? stars >= 2 : (stars % 2) === 1;
    var chosen = text.slice(bounds.start, bounds.end);
    if (on) {
      return {
        text: text.slice(0, bounds.start - want) + chosen + text.slice(bounds.end + want),
        start: bounds.start - want,
        end: bounds.end - want
      };
    }
    var marks = want === 2 ? '**' : '*';
    return {
      text: text.slice(0, bounds.start) + marks + chosen + marks + text.slice(bounds.end),
      start: bounds.start + marks.length,
      end: bounds.end + marks.length
    };
  }

  function unwrapUnderline(text, start, end) {
    var open = UNDERLINE_OPEN.length;
    var close = UNDERLINE_CLOSE.length;
    if (end - start >= open + close &&
        text.slice(start, start + open).toLowerCase() === UNDERLINE_OPEN &&
        text.slice(end - close, end).toLowerCase() === UNDERLINE_CLOSE) {
      return { start: start + open, end: end - close };
    }
    return { start: start, end: end };
  }

  function hasUnderline(text, start, end) {
    var open = UNDERLINE_OPEN.length;
    var close = UNDERLINE_CLOSE.length;
    return start >= open && end + close <= text.length &&
      text.slice(start - open, start).toLowerCase() === UNDERLINE_OPEN &&
      text.slice(end, end + close).toLowerCase() === UNDERLINE_CLOSE;
  }

  function toggleUnderline(text, start, end) {
    var bounds = unwrapUnderline(text, start, end);
    var chosen = text.slice(bounds.start, bounds.end);
    if (hasUnderline(text, bounds.start, bounds.end)) {
      return {
        text: text.slice(0, bounds.start - UNDERLINE_OPEN.length) + chosen + text.slice(bounds.end + UNDERLINE_CLOSE.length),
        start: bounds.start - UNDERLINE_OPEN.length,
        end: bounds.end - UNDERLINE_OPEN.length
      };
    }
    return {
      text: text.slice(0, bounds.start) + UNDERLINE_OPEN + chosen + UNDERLINE_CLOSE + text.slice(bounds.end),
      start: bounds.start + UNDERLINE_OPEN.length,
      end: bounds.end + UNDERLINE_OPEN.length
    };
  }

  /* A switch, not a stack: bold on something bold takes the marks off. */
  function toggleMark(text, start, end, name) {
    text = String(text == null ? '' : text);
    var bounds = clampRange(text, start, end);
    if (name === 'bold') return toggleStars(text, bounds.start, bounds.end, 2);
    if (name === 'italic') return toggleStars(text, bounds.start, bounds.end, 1);
    if (name === 'underline') return toggleUnderline(text, bounds.start, bounds.end);
    return { text: text, start: bounds.start, end: bounds.end };
  }

  function markState(text, start, end) {
    text = String(text == null ? '' : text);
    var bounds = clampRange(text, start, end);
    var stars = unwrapStars(text, bounds.start, bounds.end);
    var count = starsAround(text, stars.start, stars.end);
    var under = unwrapUnderline(text, bounds.start, bounds.end);
    return {
      bold: count >= 2,
      italic: (count % 2) === 1,
      underline: hasUnderline(text, under.start, under.end)
    };
  }

  /* Takes off the mark pairs the choice touches - bold, italic, underline,
   * strike, highlight - as the inline reader pairs them, and nothing else:
   * the underscores of snake_case_name are letters, not marks. With no
   * choice, the pairs around the caret come off. */
  function clearMarks(text, start, end) {
    text = String(text == null ? '' : text);
    var bounds = clampRange(text, start, end);
    var pairs = [];
    tokenize(text, true, 0, pairs);
    var cuts = [];
    var lo = bounds.start;
    var hi = bounds.end;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      var hit = bounds.start === bounds.end
        ? p.open[1] <= bounds.start && bounds.start <= p.close[0]
        : p.open[0] < bounds.end && p.close[1] > bounds.start;
      if (!hit) continue;
      cuts.push(p.open, p.close);
      lo = Math.min(lo, p.open[0]);
      hi = Math.max(hi, p.close[1]);
    }
    if (!cuts.length) return { text: text, start: bounds.start, end: bounds.end };
    cuts.sort(function (a, b) { return a[0] - b[0]; });
    var out = '';
    var from = 0;
    for (i = 0; i < cuts.length; i++) {
      out += text.slice(from, cuts[i][0]);
      from = cuts[i][1];
    }
    out += text.slice(from);
    function map(pos) {
      var shift = 0;
      for (var k = 0; k < cuts.length; k++) {
        if (pos >= cuts[k][1]) shift += cuts[k][1] - cuts[k][0];
        else if (pos > cuts[k][0]) shift += pos - cuts[k][0];
      }
      return pos - shift;
    }
    return { text: out, start: map(lo), end: map(hi) };
  }

  /* ---------- notes and the words under a node ---------- */

  function quotedAt(entry, kind) {
    if (!entry) return null;
    if (kind === 'body') return entry.body || null;
    return (entry.notes && entry.notes[kind]) || null;
  }

  function noteFor(state, path, kind) { return quotedAt(entryAt(state, path), kind); }

  /* A note's or a body's lines replaced by `written` (none: taken out). The
   * node after them may have followed the quote and now follow words, where
   * a numbered item cannot start a list: mendStarts sees to it. */
  function spliceQuote(state, lines, from, count, written) {
    lines.splice.apply(lines, [from, count].concat(written));
    return mendStarts(lines, entryStartingAt(state, from + count) ? [from + written.length] : []).lines;
  }

  /* The node's own words under its line, pictures taken off, the way the
   * body field of the rename box shows them. */
  function bodyFor(state, path) {
    var found = quotedAt(entryAt(state, path), 'body');
    return found ? unguardTail(splitImages(found.text).label) : '';
  }

  /* An empty text takes the block out - unless a picture stands in it,
   * which is a body as much as a word is. */
  function setBody(state, path, text) {
    var body = quotedAt(entryAt(state, path), 'body');
    var split = body ? splitBox(body.text) : null;
    var words = sanitizeNote(text);
    if (!split || !(split.lead.length + split.tail.length)) return setNote(state, path, 'body', words);
    split.label = words;
    return setNote(state, path, 'body', joinBox(split));
  }

  function setBodyRole(state, path, role) {
    var body = quotedAt(entryAt(state, path), 'body');
    if (!body) return null;
    var wanted = BODY_ROLES[role] ? role : null;
    if (wanted === (body.role || null)) return null;
    var lines = state.lines.slice();
    var written = noteLinesFor(body.prefix, 'body', body.text, wanted, body.above, body.drawAbove);
    lines.splice.apply(lines, [body.line, body.end - body.line].concat(written));
    return result(lines, null, path);
  }

  function bodyRoleAt(state, path) {
    var body = quotedAt(entryAt(state, path), 'body');
    if (!body) return null;
    return body.role || 'paragraph';
  }

  /* The lines a note is written as: the marker opens the first, every other
   * line is quoted again under the bullet's text. A body's markers ride at
   * the end of its first line - all three of them, every time. */
  function noteLinesFor(prefix, kind, text, role, above, drawAbove) {
    var parts = text.split('\n');
    var tail = '';
    if (role && BODY_ROLES[role]) tail += ' ' + roleMarkup(role);
    if (above) tail += ' <!-- image: above -->';
    if (drawAbove) tail += ' <!-- draw: above -->';
    if (kind === 'body') parts[0] = guardTail(parts[0]);
    var out = [prefix + '> ' + NOTE_MARKER[kind] + ': ' + parts[0] + tail];
    for (var i = 1; i < parts.length; i++) out.push(spaces(prefix.length) + (parts[i] ? '> ' + parts[i] : '>'));
    return out;
  }

  /* Where a new note goes: under the node's line and the words that run
   * straight on from it, ahead of every child. Put between the line and
   * those words, the note would swallow them - CommonMark reads a plain line
   * after a quote as more of the quote. */
  function noteSlot(state, entry) {
    var lines = state.lines;
    var at = entry.start + 1;
    var prose = entry.prose;
    for (var k = 0; k < prose.length; k++) {
      var line = Math.floor(prose[k] / 8);
      if (line < at) continue;
      if (line > at || prose[k] % 8 !== P_TEXT || isBlank(lines[line])) break;
      at++;
    }
    /* The note is a list item: it goes past what is written deeper than
     * its words, or that would fall inside it (see pastDeeper). */
    return pastDeeper(state, at, (entry.kind === 'heading' ? 0 : entry.contentCol) + 2);
  }

  /* Writing over a note, creating one, clearing it: one door. */
  function setNote(state, path, kind, text) {
    var entry = entryAt(state, path);
    if (!entry || !NOTE_MARKER[kind]) return null;
    var clean = sanitizeNote(text);
    var existing = quotedAt(entry, kind);
    var lines = state.lines.slice();
    if (existing) {
      if (clean === existing.text) return null;
      var written = clean ? noteLinesFor(existing.prefix, kind, clean, existing.role, existing.above, existing.drawAbove) : [];
      if (written.join('\n') === lines.slice(existing.line, existing.end).join('\n')) return null;
      return result(spliceQuote(state, lines, existing.line, existing.end - existing.line, written), null, path);
    }
    if (!clean) return null;
    var opening = spaces(entry.kind === 'heading' ? 0 : entry.contentCol) + '- ';
    return result(spliceQuote(state, lines, noteSlot(state, entry), 0, noteLinesFor(opening, kind, clean)), null, path);
  }

  /* The document without its notes (an export that asked for that). The
   * body is the node's words and stays. */
  function stripNotes(text) {
    var lines = normalizeText(text).split('\n');
    var notes = readNotes(lines);
    var drop = {};
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].kind === 'body') continue;
      for (var j = notes[i].line; j < notes[i].end; j++) drop[j] = true;
    }
    var out = [];
    for (var k = 0; k < lines.length; k++) if (!drop[k]) out.push(lines[k]);
    return out.join('\n');
  }

  function noteMarkup(kind, text) {
    return '- > ' + (NOTE_MARKER[kind] || NOTE_MARKER.node) + ': ' + sanitizeInline(text || '');
  }

  /* ---------- the board of a document ---------- */

  /* <!-- board: path | x,y,w,h --> read by hand: the one pattern it took
   * backtracked quadratically over spaces inside the path. */
  function readBoard(line) {
    if (!line || line.indexOf('-->') < 0) return null;
    var head = BOARD_HEAD_RE.exec(line);
    if (!head) return null;
    var end = line.length;
    while (end > 0 && isWhite(line.charAt(end - 1))) end--;
    if (end - 3 < head[0].length || line.slice(end - 3, end) !== '-->') return null;
    var inner = line.slice(head[0].length, end - 3);
    var bar = inner.indexOf('|');
    var path = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    if (!path || path.indexOf('>') >= 0) return null;
    if (bar < 0) return { path: path, spot: null };
    var m = BOARD_SPOT_RE.exec(inner.slice(bar + 1));
    if (!m) return null;
    return { path: path, spot: { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } };
  }

  /* The first board line outside fenced code (where it would be an example). */
  function boardAt(state) {
    var lines = state.lines || normalizeText(state).split('\n');
    var fenced = null;
    for (var i = 0; i < lines.length; i++) {
      var board = readBoard(lines[i]);
      if (!board) continue;
      if (!fenced) fenced = fencedLines(lines);
      if (fenced[i]) continue;
      board.line = i;
      return board;
    }
    return null;
  }

  function boardLine(state) {
    var board = boardAt(state);
    return board ? board.line : -1;
  }

  function boardPath(state) {
    var board = boardAt(state);
    return board ? board.path : null;
  }

  function boardPlacement(state) {
    var board = boardAt(state);
    return board ? board.spot : null;
  }

  function boardMarkup(path, spot) {
    var where = spot ? ' | ' + Math.round(spot.x) + ',' + Math.round(spot.y) + ',' + Math.round(spot.w) + ',' + Math.round(spot.h) : '';
    return '<!-- board: ' + path + where + ' -->';
  }

  /* Written at the top (after front matter, which must stay first), with a
   * blank line after it so the heading below stays a heading; taken away by
   * passing no path. */
  function setBoard(state, path, spot) {
    var lines = state.lines.slice();
    var at = boardLine(state);
    if (!path) {
      if (at < 0) return null;
      lines.splice(at, 1);
      if (lines[at] === '') lines.splice(at, 1);
      return result(lines);
    }
    var markup = boardMarkup(path, spot);
    if (at >= 0) {
      if (lines[at] === markup) return null;
      lines[at] = markup;
    } else {
      var fm = frontMatter(lines);
      lines.splice(fm ? fm.end : 0, 0, markup, '');
    }
    return result(lines);
  }

  /* ---------- what an export leaves behind ---------- */

  /* A drawing is a working surface, not something handed over: the pictures
   * that are drawings and the board marker go; a line that was nothing but a
   * drawing goes with it. */
  function stripDrawings(text) {
    var lines = normalizeText(text).split('\n');
    var fenced = fencedLines(lines);
    var out = [];
    var emptied = /^\s*(?:(?:[-*+]|\d{1,9}[.)])(?:\s+\[[ xX]\])?|#{1,6})\s*$/;
    for (var i = 0; i < lines.length; i++) {
      if (fenced[i]) { out.push(lines[i]); continue; }
      if (readBoard(lines[i])) continue;
      var line = lines[i];
      var pics = findPictures(line);
      var cut = false;
      for (var k = pics.length - 1; k >= 0; k--) {
        if (pics[k].kind !== DRAW) continue;
        var end = pics[k].end;
        while (end < line.length && isSpaceCode(line.charCodeAt(end))) end++;
        line = line.slice(0, pics[k].start) + line.slice(end);
        cut = true;
      }
      if (cut) {
        if (emptied.test(line) && !emptied.test(lines[i])) continue;
        line = line.trimEnd();
      }
      out.push(line);
    }
    return out.join('\n');
  }

  function emptyDocument(title) {
    return '# ' + escapeTitle(sanitizeInline(title) || word('doc.newMap'), 'heading') + '\n';
  }

  /* ---------- what the map draws ---------- */

  function splitCells(row) {
    var s = row.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1);
    var cells = [];
    var cell = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') { cell += '|'; i++; continue; }
      if (c === '|') { cells.push(cell.trim()); cell = ''; continue; }
      cell += c;
    }
    cells.push(cell.trim());
    return cells;
  }

  /* The free text a node owns, as blocks under its words: paragraphs (lines
   * kept, quotes marked), code fences (escaped, indentation kept), tables
   * (one row per line). Pictures in it join the body's pictures. */
  function proseView(lines, list, links) {
    var blocks = [];
    var texts = [];
    var images = [];
    var k = 0;
    while (k < list.length) {
      var lineNo = Math.floor(list[k] / 8);
      var type = list[k] % 8;
      if (type === P_FENCE_OPEN || type === P_FENCE || type === P_FENCE_CLOSE) {
        var code = [];
        var indentCut = type === P_FENCE_OPEN ? leadCol(lines[lineNo]) : 0;
        if (type === P_FENCE) code.push(lines[lineNo]);
        k++;
        while (k < list.length && list[k] % 8 === P_FENCE) { code.push(lines[Math.floor(list[k] / 8)]); k++; }
        if (k < list.length && list[k] % 8 === P_FENCE_CLOSE) k++;
        var shown = code.map(function (l) { return reindent(l, -indentCut).replace(/\t/g, '    '); });
        blocks.push('<code class="md-code">' + shown.map(function (l) {
          return escapeHtml(l).replace(/^ +/, function (sp) { return repeat('\u00a0', sp.length); });
        }).join('<br>') + '</code>');
        texts.push(shown.join('\n'));
        continue;
      }
      /* A paragraph: lines that follow each other, all quoted or none. */
      var group = [lines[lineNo]];
      var quote = /^[ \t]*>/.test(lines[lineNo]);
      var last = lineNo;
      k++;
      while (k < list.length && list[k] % 8 === P_TEXT && Math.floor(list[k] / 8) === last + 1 &&
             /^[ \t]*>/.test(lines[last + 1]) === quote) {
        last++;
        group.push(lines[last]);
        k++;
      }
      if (group.length >= 2 && group[0].indexOf('|') >= 0 && group[1].indexOf('|') >= 0 && TABLE_RULE_RE.test(group[1])) {
        var rows = [];
        var rowText = [];
        for (var r = 0; r < group.length; r++) {
          if (r === 1) continue;
          var cells = splitCells(group[r]).map(function (cell) {
            var toks = tokenize(cell, true, 0, null);
            collectLinks(toks, links);
            collectImages(toks, images);
            return { html: renderHtml(toks, 'drop'), text: renderText(toks, 'drop') };
          });
          rows.push(cells.map(function (c) { return c.html; }).join('<span class="md-sep"> | </span>'));
          rowText.push(cells.map(function (c) { return c.text; }).join(' | '));
        }
        blocks.push('<span class="md-table">' + rows.join('<br>') + '</span>');
        texts.push(rowText.join('\n'));
        continue;
      }
      var body = group.map(function (l) {
        var t = l.replace(/^[ \t]+/, '');
        return quote ? t.replace(/^(?:>[ \t]?)+/, '') : t;
      }).join('\n');
      var ptoks = tokenize(body, true, 0, null);
      collectLinks(ptoks, links);
      collectImages(ptoks, images);
      var html = renderHtml(ptoks, 'drop');
      var plain = renderText(ptoks, 'drop');
      if (!html.replace(/<br>/g, '').trim()) continue;
      blocks.push('<span class="' + (quote ? 'md-quote' : 'md-p') + '">' + html + '</span>');
      texts.push(plain);
    }
    var pictures = [];
    for (var i = 0; i < images.length; i++) {
      var path = decodePath(images[i].src);
      pictures.push({ path: path, src: images[i].src, alt: images[i].alt, kind: isDrawingPath(path) ? DRAW : PHOTO, side: 'left', prose: true });
    }
    return { html: blocks.join('<br>'), text: texts.join('\n'), images: pictures };
  }

  /* ---------- lists in the words under a title ---------- */

  function wordsHtml(text, links) {
    var toks = tokenize(text, true, 0, null);
    collectLinks(toks, links);
    return renderHtml(toks, 'alt');
  }

  /* The words under a title as the map draws them: paragraphs as they
   * always were, and list items (bullets, numbers, task boxes, nested by
   * indent as CommonMark nests them) as lines of their own. Every word
   * still goes through the inline renderer, which escapes it. Words with
   * no list in them are drawn exactly as before. */
  function bodyHtml(label, links) {
    var lines = label.split('\n');
    var listed = false;
    for (var q = 0; q < lines.length && !listed; q++) listed = BODY_ITEM_RE.test(lines[q]);
    if (!listed) return wordsHtml(label, links);
    var blocks = [];
    var para = [];
    var items = null;
    var stack = [];
    var counts = [];
    var boxes = 0;
    function closePara() {
      while (para.length && !para[para.length - 1]) para.pop();
      while (para.length && !para[0]) para.shift();
      if (para.length) blocks.push(wordsHtml(para.join('\n'), links));
      para = [];
    }
    function closeList() {
      if (!items) return;
      blocks.push('<span class="md-list">' + items.map(function (it) { return itemHtml(it, links); }).join('') + '</span>');
      items = null;
      stack = [];
      counts = [];
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = BODY_ITEM_RE.exec(line);
      if (m) {
        closePara();
        if (!items) items = [];
        var col = leadCol(line);
        while (stack.length && col < stack[stack.length - 1]) stack.pop();
        var depth = stack.length;
        stack.push(Math.max(contentColOf(line), col + m[2].length + 1));
        counts.length = Math.min(counts.length, depth + 1);
        var num = /^(\d+)([.)])$/.exec(m[2]);
        var n = null;
        if (num) {
          var prev = counts[depth];
          n = prev && prev.delim === num[2] ? prev.n + 1 : Number(num[1]);
          counts[depth] = { n: n, delim: num[2] };
        } else {
          counts[depth] = null;
        }
        var check = m[4] === undefined ? null : m[4] !== ' ';
        items.push({ depth: Math.min(depth, 5), n: n, delim: num ? num[2] : '', check: check, box: check === null ? -1 : boxes++, words: [m[5]] });
        continue;
      }
      if (items && !isBlank(line) && leadCol(line) >= stack[stack.length - 1]) {
        items[items.length - 1].words.push(line.trim());
        continue;
      }
      if (items && isBlank(line)) {
        var next = i + 1;
        while (next < lines.length && isBlank(lines[next])) next++;
        if (next < lines.length && BODY_ITEM_RE.test(lines[next])) continue;
      }
      closeList();
      para.push(line);
    }
    closePara();
    closeList();
    return blocks.join('');
  }

  /* One item: its mark (a dot, its number, or its box - the box stands for
   * the dot of a task, beside the number of a numbered one), then its words.
   * data-i counts the boxes in the order toggleBodyTask counts them. */
  function itemHtml(it, links) {
    var lead = it.n !== null ? '<span class="md-li-num">' + escapeHtml(it.n + it.delim) + '</span>' :
      (it.check === null ? '<span class="md-li-dot" aria-hidden="true"></span>' : '');
    if (it.check !== null) lead += '<span class="md-check" role="checkbox" aria-checked="' + (it.check ? 'true' : 'false') + '" data-i="' + it.box + '"></span>';
    return '<span class="md-li md-li--' + it.depth + (it.check ? ' md-li--done' : '') + '">' + lead +
      '<span class="md-li-text">' + wordsHtml(it.words.join('\n'), links) + '</span></span>';
  }

  /* The index-th task box in the words under a title ticked or unticked:
   * '- [ ]' <-> '- [x]', nothing else on the line touched. */
  function toggleBodyTask(state, path, index) {
    var body = quotedAt(entryAt(state, path), 'body');
    if (!body) return null;
    var split = splitBox(body.text);
    var lines = split.label.split('\n');
    var seen = 0;
    for (var i = 0; i < lines.length; i++) {
      var m = BODY_ITEM_RE.exec(lines[i]);
      if (!m || m[4] === undefined || seen++ !== index) continue;
      var at = m[1].length + m[2].length + m[3].length;
      lines[i] = lines[i].slice(0, at + 1) + (m[4] === ' ' ? 'x' : ' ') + lines[i].slice(at + 2);
      split.label = lines.join('\n');
      return setNote(state, path, 'body', joinBox(split));
    }
    return null;
  }

  /* The task boxes in the words under a title, in order: [checked]. */
  function bodyTasks(state, path) {
    var body = quotedAt(entryAt(state, path), 'body');
    if (!body) return [];
    var out = [];
    splitBox(body.text).label.split('\n').forEach(function (l) {
      var m = BODY_ITEM_RE.exec(l);
      if (m && m[4] !== undefined) out.push(m[4] !== ' ');
    });
    return out;
  }

  function bodyView(state, entry, links) {
    var quoted = entry.body;
    if (!quoted && !entry.prose.length) return null;
    var html = '';
    var text = '';
    var images = [];
    var words = '';
    if (quoted) {
      var split = splitBox(quoted.text);
      words = unguardTail(split.label);
      var toks = tokenize(split.label, true, 0, null);
      text = renderText(toks, 'alt');
      html = bodyHtml(split.label, links);
      images = pictureViews(split.lead, 'left').concat(pictureViews(split.tail, 'right'));
    }
    var hasProse = false;
    if (entry.prose.length) {
      var prose = proseView(state.lines, entry.prose, links);
      if (prose.html) {
        hasProse = true;
        html = html ? html + '<br>' + prose.html : prose.html;
        text = text ? text + '\n' + prose.text : prose.text;
      }
      if (prose.images.length) { hasProse = true; images = images.concat(prose.images); }
    }
    if (!html && !images.length) return null;
    return {
      html: html,
      text: text,
      role: quoted ? (quoted.role || null) : null,
      images: images,
      imageAbove: !!(quoted && quoted.above),
      drawAbove: !!(quoted && quoted.drawAbove),
      words: words,
      quoted: !!quoted,
      prose: hasProse
    };
  }

  function syntheticView(state) {
    var title = state.frontmatter && typeof state.frontmatter.title === 'string' ? sanitizeInline(state.frontmatter.title) : '';
    return {
      path: null, synthetic: true, depth: 0, line: -1, kind: 'text', level: null, ordered: null,
      titleSize: null, role: null, html: escapeHtml(title), text: title, task: null,
      images: [], imageAbove: false, drawAbove: false, body: null,
      notes: { node: null, edge: null }, color: paletteColor(-1), ownColor: false, inherited: false,
      branchIndex: -1, fold: null, side: 'right', links: [], children: []
    };
  }

  /* The numbers a numbered list shows: CommonMark counts on from the first
   * item, whatever the later ones say ('1. 1. 1.' reads 1, 2, 3). */
  function shownNumber(state, entry, sibs, shown) {
    if (entry.ordered === null) return null;
    var prev = sibs[entry.index - 1];
    if (prev && prev.kind === 'bullet' && prev.ordered !== null && prev.delim === entry.delim &&
        prev.indent === entry.indent && shown[prev.path] != null) {
      var gapClean = true;
      for (var l = prev.subEnd; l < entry.start; l++) if (!isBlank(state.lines[l])) { gapClean = false; break; }
      if (gapClean) return shown[prev.path] + 1;
    }
    return entry.ordered;
  }

  /* What the map draws, one plain object per node, computed fresh from the
   * parsed document: no references into it, so the view can keep it. */
  function viewTree(state) {
    if (!state || !state.flat || !state.flat.length) return null;
    var keys = branchIndexes(state);
    var views = new Array(state.flat.length);
    var shown = Object.create(null);
    var root = state.byPath[''] ? null : syntheticView(state);
    var tops = topEntries(state);
    for (var f = 0; f < state.flat.length; f++) {
      var e = state.flat[f];
      var parentEntry = e.parentIndex >= 0 ? state.flat[e.parentIndex] : null;
      var number = null;
      if (e.ordered !== null) {
        number = shownNumber(state, e, parentEntry ? parentEntry.children : tops, shown);
        shown[e.path] = number;
      }
      var split = splitBox(e.title);
      var toks = tokenize(split.label, true, 0, null);
      var links = collectLinks(toks, []);
      var branchIndex = keys[e.branch];
      var plain = renderText(toks, 'alt');
      if (/\s\s|[^\S ]/.test(plain)) plain = plain.replace(/\s+/g, ' ');
      var view = {
        path: e.path,
        synthetic: false,
        depth: 0,
        line: e.start,
        kind: e.kind,
        level: e.kind === 'heading' ? e.level : null,
        ordered: number,
        titleSize: e.titleSize || null,
        role: e.role || null,
        html: renderHtml(toks, 'alt'),
        text: plain.trim(),
        task: e.task === null ? null : { checked: !!e.task },
        images: split.lead.length || split.tail.length ? pictureViews(split.lead, 'left').concat(pictureViews(split.tail, 'right')) : [],
        imageAbove: !!e.imageAbove,
        drawAbove: !!e.drawAbove,
        body: null,
        notes: {
          node: e.notes && e.notes.node ? e.notes.node.text : null,
          edge: e.notes && e.notes.edge ? e.notes.edge.text : null
        },
        color: e.paint || paletteColor(branchIndex),
        ownColor: !!e.color,
        inherited: !e.color && !!e.paint,
        branchIndex: branchIndex,
        fold: e.fold || null,
        side: e.side === 'left' ? 'left' : 'right',
        at: e.at && e.path !== '' ? { x: e.at.x, y: e.at.y } : null,
        by: e.by || 'human',
        links: links,
        children: []
      };
      view.body = e.body || e.prose.length ? bodyView(state, e, links) : null;
      views[f] = view;
      var parentView = parentEntry ? views[e.parentIndex] : (root && root.synthetic ? root : null);
      if (parentView) {
        view.depth = parentView.depth + 1;
        parentView.children.push(view);
      } else {
        root = view;
      }
    }
    return root;
  }

  /* Every link a node carries - its line, its words, its text - in order. */
  function linksOf(state, path) {
    var entry = entryAt(state, path);
    if (!entry) return [];
    var links = collectLinks(tokenize(splitBox(entry.title).label, true, 0, null), []);
    bodyView(state, entry, links);
    /* The links written in its notes open from the node too: a note that
     * says "From [[Another map]]" leads there. */
    ['node', 'edge'].forEach(function (kind) {
      var note = entry.notes && entry.notes[kind];
      if (note && note.text) collectLinks(tokenize(String(note.text), true, 0, null), links);
    });
    return links;
  }

  /* The links in a piece of inline Markdown: [text](url) and [[Map]]. */
  function inlineLinks(markdown) {
    return collectLinks(tokenize(String(markdown == null ? '' : markdown), true, 0, null), []);
  }

  /* A key for a node that survives edits elsewhere: the words from the root
   * down to it. Siblings with the same words are told apart by their order. */
  function keyPart(entry, sibs) {
    var label = labelOf(entry) || imagesOf(entry);
    var seen = 0;
    for (var i = 0; i < sibs.length && sibs[i] !== entry; i++) {
      if ((labelOf(sibs[i]) || imagesOf(sibs[i])) === label) seen++;
    }
    return seen ? label + '\u001e' + (seen + 1) : label;
  }

  function lineageKey(state, path) {
    var parts = [];
    var p = path;
    while (p !== null && p !== undefined) {
      var entry = state.byPath[p];
      if (!entry) return parts.length ? parts.join('\u001f') : '';
      parts.unshift(keyPart(entry, siblingEntries(state, entry)));
      p = parentPath(p);
    }
    return parts.join('\u001f');
  }

  /* lineageKey() for every node at once: {path: key}. Siblings come in
   * document order, so one count per parent and label replaces keyPart's
   * look back (which made a list of 5,000 alike items take a second). */
  function lineageKeys(state) {
    var out = Object.create(null);
    var seen = Object.create(null);
    for (var f = 0; f < state.flat.length; f++) {
      var e = state.flat[f];
      var parent = e.parentIndex >= 0 ? state.flat[e.parentIndex] : null;
      var label = labelOf(e) || imagesOf(e);
      var slot = e.parentIndex + '\u0000' + label;
      var count = seen[slot] || 0;
      seen[slot] = count + 1;
      var part = count ? label + '\u001e' + (count + 1) : label;
      out[e.path] = parent ? out[parent.path] + '\u001f' + part : part;
    }
    return out;
  }

  ns.doc = {
    parse: parse,
    entryAt: entryAt,
    childEntries: childEntries,
    siblingEntries: siblingEntries,
    parentPath: parentPath,
    isImage: isImage,
    imagesOf: imagesOf,
    labelOf: labelOf,
    plainText: plainText,
    breadcrumb: breadcrumb,
    findByLine: findByLine,
    imageRefs: imageRefs,
    boardPath: boardPath,
    boardPlacement: boardPlacement,
    setBoard: setBoard,
    stripDrawings: stripDrawings,
    emptyDocument: emptyDocument,
    normalizeText: normalizeText,
    sanitizeNote: sanitizeNote,
    noteFor: noteFor,
    setNote: setNote,
    bodyFor: bodyFor,
    setBody: setBody,
    setBodyRole: setBodyRole,
    bodyRoleAt: bodyRoleAt,
    setColor: setColor,
    colorAt: colorAt,
    setRole: setRole,
    roleAt: roleAt,
    setTitleSize: setTitleSize,
    titleSizeAt: titleSizeAt,
    sideAt: sideAt,
    setSide: setSide,
    setSides: setSides,
    dropStraySides: dropStraySides,
    isFirstLevel: function (state, path) { return isFirstLevel(state, entryAt(state, path)); },
    isTreeRoot: function (state, path) { return isTreeRoot(entryAt(state, path)); },
    styleFlags: styleFlags,
    setImagePosition: setImagePosition,
    imagePositionAt: imagePositionAt,
    imagesIn: imagesIn,
    PHOTO: PHOTO,
    DRAW: DRAW,
    kindOfImage: kindOfImage,
    lastImagePath: lastImagePath,
    removeImage: removeImage,
    toggleMark: toggleMark,
    markState: markState,
    clearMarks: clearMarks,
    branchAt: branchAt,
    handedColor: handedColor,
    normalizeHex: normalizeHex,
    stripNotes: stripNotes,
    noteMarkup: noteMarkup,
    rename: rename,
    addRoot: addRoot,
    addChild: addChild,
    addSibling: addSibling,
    addImage: addImage,
    remove: remove,
    move: move,
    canMove: canMove,
    indent: indent,
    canIndent: canIndent,
    outdent: outdent,
    canOutdent: canOutdent,
    extractBranch: extractBranch,
    lineageOf: lineageOf,
    placeFor: placeFor,
    insertBranch: insertBranch,
    refsInText: refsInText,
    renameRef: renameRef,
    newId: newId,
    idsOf: idsOf,
    pathOfId: pathOfId,
    ensureId: ensureId,
    byAt: byAt,
    setBy: setBy,
    byAfterEdit: byAfterEdit,
    addOutline: addOutline,
    wikiRefs: wikiRefs,
    renameMapLinks: renameMapLinks,
    stripIds: stripIds,
    countNodes: countNodes,
    /* additions */
    viewTree: viewTree,
    inlineHtml: inlineHtml,
    inlineText: inlineText,
    toggleTask: toggleTask,
    toggleBodyTask: toggleBodyTask,
    primaryPath: primaryPath,
    positionsOf: positionsOf,
    setPositions: setPositions,
    clearPositions: clearPositions,
    primaryName: primaryName,
    bodyTasks: bodyTasks,
    BODY_ITEM_RE: BODY_ITEM_RE,
    setTask: setTask,
    moveTo: moveTo,
    canMoveTo: canMoveTo,
    linksOf: linksOf,
    inlineLinks: inlineLinks,
    isDrawingPath: isDrawingPath,
    lineageKey: lineageKey,
    lineageKeys: lineageKeys,
    titleFor: titleFor,
    colorFor: colorFor,
    branchIndexAt: branchIndexAt,
    sanitizeInline: sanitizeInline,
    escapeHtml: escapeHtml
  };
})(window.MindRoot);
