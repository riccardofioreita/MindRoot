/* MindRoot - the Markdown panel: the map as the text it is, edited by hand.
 *
 * The field is a plain <textarea>, so caret, selection, IME, spellcheck,
 * the phone keyboard and the browser's own undo all keep working. Behind it
 * sits one painted row per line: syntax colour, the line number, the fold
 * arrow, the active line, the tint of the branch the line belongs to. The
 * two layers stay in step only because they wrap identically - same mono
 * font, size, line height, padding, tab size, wrapping rules and width (the
 * field's scrollbar is measured and given to the rows) - so the rows never
 * change a glyph's advance: emphasis is colour, slant and a stroke, never a
 * heavier weight, and badges take no room on the line.
 *
 * Text goes both ways:
 *   - field -> map: every keystroke updates the panel's own copy at once (so
 *     nothing typed can be lost), and ~300 ms after the last one the text is
 *     written with store.setMapText, labelled 'edit the Markdown' and keyed
 *     per map so a burst of typing is one undo step; the session then shows
 *     it. The pause grows with what the last write cost (a map of thousands
 *     of lines takes a fifth of a second to draw). The pending text is also
 *     written on blur, on a map switch, when the page is hidden (bus
 *     'flush') and when another tab takes over.
 *   - map -> field: a change made elsewhere is written into the field only
 *     while the field is not focused ("the field wins while you type"); a
 *     change the panel itself asked for while focused (the colour swatch)
 *     goes in through execCommand as one step of the field's undo.
 * Ctrl+Z in the field is the field's own (util.typingHistory, one step per
 * run of typing): the rows painted on every keystroke close the browser's
 * typing run, so its native undo would take back one letter per press.
 * Every edit the panel makes itself (Tab, chips, Ctrl+B/I/U, the checkbox
 * tap, Enter continuing a list) is a step of its own and goes through
 * document.execCommand('insertText'); setRangeText is only the fallback for
 * an engine that refuses.
 *
 * The caret line and the selected node follow each other (prefs
 * syncSelection), with a guard so neither echoes the other; a node selected
 * on the map unfolds the block hiding its line.
 *
 * Folding: a textarea shows all its text or none, so the panel keeps the
 * whole document in model.full and puts only model.visible in the field,
 * mapping each edit back through the lines that did not change (head/tail
 * diff). An edit that swallows a folded line rescues the hidden lines right
 * after it and opens the fold: nothing hidden is ever lost. A closed block
 * never grows over a line that was on screen (a line typed under a closed
 * heading belongs to it): it opens instead, so nothing typed vanishes
 * under the caret. Tab and Shift+Tab on a closed line move its whole block,
 * which opens. Folding rewrites the field's value; the field's undo keeps
 * whole documents, so a fold in between does not upset it.
 * The field also covers the gutter (as left padding): a press at a line's
 * start lands in the text, and the fold arrows are hit-tested under the
 * glass on pointerdown.
 *
 * Rows are painted incrementally: typing repaints the words of the rows it
 * changed in place, a new or removed line inserts or removes only its own
 * rows, and any other row is touched only when its fold arrow, tint or
 * fence context changed. Line numbers and bands are written on the rows in
 * sight only. A 5,000-line map stays responsive while typing.
 *
 * Placement: docked under the map from 640 px up, its height a share of the
 * main area (prefs.sourceHeight) dragged by a grip; on phones the panel
 * takes the whole main area, in place of the map, with the chip row at the
 * bottom as a keyboard row. A strip under a phone map leaves two lines of
 * text once the keyboard is up, and the map cannot be read at that size
 * anyway; the map is one tap (or Mod+M) away and the selection follows.
 *
 *   init(), toggle(force?) -> bool, isOpen()
 *   text(), visibleText(), apply(chipId), toggleFold(line), foldAll(),
 *   unfoldAll(), folded(), caretLine(), focusLine(line), lineOfRow(row),
 *   flush() (write the pending text now)
 * Command: source.toggle (Mod+M, also from inside a text field). Keys in
 * the field: Tab / Shift+Tab move whole lines, Mod+B/I/U mark the chosen
 * words, Enter continues a list, Escape hands the keyboard back to the
 * map. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var INDENT = '  ';
  var PUSH_DELAY = 300;         // ms after the last keystroke before the map hears it
  var PUSH_EXTRA_MAX = 1200;    // at most this much more on a map slow to draw
  var MIN_PX = 120;             // the docked panel is never shorter
  var DEFAULT_SHARE = 0.34;     // of the main area, when the grip is double-clicked
  var KEY_STEP = 0.05;          // the grip moved from the keyboard
  var LONG_LINE = 2000;         // longer lines are drawn plain
  var PAINT_CACHE = 20000;
  var COMPACT = '(max-width: 639px)';

  var STRINGS = {
    en: {
      'source.cmd.toggle': 'Show the Markdown',
      'source.help.toggle': 'The map as the text it is: write it by hand, with colour, folds and the symbols of the format. The map follows as you type.',
      'source.kw.toggle': 'markdown text source code write edit panel',
      'source.title': 'Markdown',
      'source.field': 'Markdown of the map',
      'source.close': 'Close the Markdown',
      'source.foldAll': 'Fold every block',
      'source.unfoldAll': 'Unfold every block',
      'source.foldLine': 'Fold or unfold this block',
      'source.more.one': '{n} line',
      'source.more.other': '{n} lines',
      'source.sync': 'Follow the selection',
      'source.grip': 'Height of the Markdown panel',
      'source.chips': 'Markdown symbols',
      'source.chip.h1': 'Root of the map (#)',
      'source.chip.h2': 'Child of the root (##)',
      'source.chip.h3': 'Third level heading (###)',
      'source.chip.bullet': 'Node (-)',
      'source.chip.task': 'To-do box: add, tick, untick',
      'source.chip.indent': 'Nest one level',
      'source.chip.outdent': 'Back one level',
      'source.chip.bold': 'Bold',
      'source.chip.italic': 'Italic',
      'source.chip.underline': 'Underline',
      'source.chip.image': 'Picture path',
      'source.chip.note': 'Note under this line',
      'source.chip.edge': 'Note on the link to this line',
      'source.chip.swatch': 'Colour of the node on this line',
      'source.chip.dice': 'Random colour for new nodes',
      'source.placeholder': 'text',
      'source.label.edit': 'edit the Markdown',
      'source.label.color': 'colour the node',
      'source.noMap': 'Open a map to see its Markdown.'
    },
    it: {
      'source.cmd.toggle': 'Mostra il Markdown',
      'source.help.toggle': 'La mappa come il testo che è: scrivila a mano, con colori, pieghe e i simboli del formato. La mappa segue mentre scrivi.',
      'source.kw.toggle': 'markdown text source code write edit panel testo sorgente scrivi pannello',
      'source.title': 'Markdown',
      'source.field': 'Markdown della mappa',
      'source.close': 'Chiudi il Markdown',
      'source.foldAll': 'Piega tutti i blocchi',
      'source.unfoldAll': 'Apri tutti i blocchi',
      'source.foldLine': 'Piega o apri questo blocco',
      'source.more.one': '{n} riga',
      'source.more.other': '{n} righe',
      'source.sync': 'Segui la selezione',
      'source.grip': 'Altezza del pannello Markdown',
      'source.chips': 'Simboli Markdown',
      'source.chip.h1': 'Radice della mappa (#)',
      'source.chip.h2': 'Figlio della radice (##)',
      'source.chip.h3': 'Titolo di terzo livello (###)',
      'source.chip.bullet': 'Nodo (-)',
      'source.chip.task': 'Casella: aggiungi, spunta, togli la spunta',
      'source.chip.indent': 'Annida di un livello',
      'source.chip.outdent': 'Torna indietro di un livello',
      'source.chip.bold': 'Grassetto',
      'source.chip.italic': 'Corsivo',
      'source.chip.underline': 'Sottolineato',
      'source.chip.image': "Percorso di un'immagine",
      'source.chip.note': 'Nota sotto questa riga',
      'source.chip.edge': 'Nota sul collegamento a questa riga',
      'source.chip.swatch': 'Colore del nodo di questa riga',
      'source.chip.dice': 'Colore a caso per i nodi nuovi',
      'source.placeholder': 'testo',
      'source.label.edit': 'modifica il Markdown',
      'source.label.color': 'colora il nodo',
      'source.noMap': 'Apri una mappa per vederne il Markdown.'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  function plural(key, n) {
    if (ns.i18n && typeof ns.i18n.plural === 'function') return ns.i18n.plural(key, n, { n: n });
    return t(key + (n === 1 ? '.one' : '.other'), { n: n });
  }

  /* The chips: what they show is the format itself (a reminder as much as a
   * shortcut), what they say is in their label. */
  var CHIPS = [
    { id: 'h1', text: '#', prefix: '# ' },
    { id: 'h2', text: '##', prefix: '## ' },
    { id: 'h3', text: '###', prefix: '### ' },
    { id: 'bullet', text: '-', prefix: '- ' },
    { id: 'task', text: '[ ]', task: true },
    { id: 'outdent', icon: 'outdent', shift: -1 },
    { id: 'indent', icon: 'indent', shift: 1 },
    { id: 'bold', text: '**', mark: 'bold' },
    { id: 'italic', text: '*', mark: 'italic' },
    { id: 'underline', text: '<u>', mark: 'underline' },
    { id: 'image', text: '![ ]', insert: '![](assets/)', caret: -1 },
    { id: 'note', icon: 'note', note: 'node' },
    { id: 'edge', icon: 'edge-note', note: 'edge' },
    { id: 'swatch', swatch: true },
    { id: 'dice', icon: 'dice', dice: true }
  ];
  var CHIP_BY_ID = {};
  CHIPS.forEach(function (c) { CHIP_BY_ID[c.id] = c; });
  var MARK_KEYS = { b: 'bold', i: 'italic', u: 'underline' };

  /* ---------------------------------------------------------------- the grammar of one line */

  var FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
  var HEADING_RE = /^(\s{0,3})(#{1,6})(\s+|$)(.*)$/;
  var LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
  var QUOTE_RE = /^(\s*)(>\s?)([\s\S]*)$/;
  var BOX_RE = /^\[([ xX])\](\s)/;
  var TASK_RE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](\s)/;
  var NOTE_RE = /^>\s*(nota|note|arco|edge)\s*:/i;
  var BODY_RE = /^>\s*text\s*:/i;
  var COMMENT_LINE_RE = /^\s*<!--.*-->\s*$/;
  /* Trailing markers, peeled from the right the way doc.js reads them. */
  var COLOR_RE = /\s*<!--\s*color\s*:\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\s*(branch)?\s*-->\s*$/i;
  var MARK_RE = /\s*<!--\s*(?:title\s*:\s*h[1-6]|role\s*:\s*[a-z]+|image\s*:\s*above|draw\s*:\s*above|markmap\s*:\s*fold(?:All)?|side\s*:\s*[a-z][a-z-]*)\s*-->\s*$/i;
  var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  /* ---------------------------------------------------------------- state */

  var el = {};
  var ready = false;
  var shown = false;           // the panel is on screen with a map in it
  var model = { full: [''], visible: [''], toFull: [0], regions: [], collapsed: Object.create(null) };
  var tints = [];              // per document line: the branch colour, or ''
  var rows = { text: [], paint: [], meta: [], num: [] };   // per visible row, as drawn (num: the number written, 0 = not yet)
  var bound = null;            // {projectId, mapId} the field's text belongs to
  var dirty = false;           // typed text the store has not seen yet
  var pushTimer = 0;
  var pushCost = 0;            // ms the last write to the map took (store + drawing)
  var composing = false;
  var syncing = false;         // a selection we caused is coming back: ignore it
  var reportedLine = -1;
  var linked = false;          // the caret line was set from the map
  var activeRow = null;
  var scrollbarW = -1;
  var paintCache = new Map();
  var drag = null;             // the grip under a pointer
  var noMapClosed = false;     // hidden because the last map went, not by hand
  var roving = null;

  function doc() { return ns.doc; }
  function session() { return ns.session; }
  function bus() { return ns.bus; }
  function h() { return ns.util.h.apply(null, arguments); }
  function isCompact() { return ns.util.matches(COMPACT); }

  function prefGet(key, fallback) {
    try {
      var v = ns.prefs ? ns.prefs.get(key) : undefined;
      return v === undefined || v === null ? fallback : v;
    } catch (err) { return fallback; }
  }
  function prefSet(key, value) {
    try { if (ns.prefs) ns.prefs.set(key, value); } catch (err) { /* preferences unavailable: the session still works */ }
  }

  function current() {
    var S = session();
    try { return S && typeof S.current === 'function' ? S.current() : null; } catch (err) { return null; }
  }

  function readOnly() {
    var S = session();
    try { return !!(S && typeof S.readOnly === 'function' && S.readOnly()); } catch (err) { return false; }
  }

  function splitLines(value) { return String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n'); }
  function fullText() { return model.full.join('\n'); }
  function visibleText() { return model.visible.join('\n'); }
  function focused() { return !!el.field && document.activeElement === el.field; }

  /* ---------------------------------------------------------------- folding */

  /* What every line is and how far the block it opens reaches: a heading
   * holds everything to the next heading of its rank or higher, a list item
   * what is indented past it, a fence itself. Trailing blank lines are not
   * part of a block. */
  function scan(lines) {
    var info = new Array(lines.length);
    var fence = null;
    var i;
    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lead = /^[ \t]*/.exec(line)[0].length;
      var entry = { kind: 'text', level: 0, indent: lead, fold: 0, fenced: !!fence, opens: false };
      var f = FENCE_RE.exec(line);
      if (f && (!fence || f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length)) {
        entry.kind = 'fence';
        if (!fence) { fence = f[1]; entry.fenced = false; entry.opens = true; } else { fence = null; entry.fenced = true; }
      } else if (!fence) {
        if (line.trim() === '') entry.kind = 'blank';
        else {
          var hd = HEADING_RE.exec(line);
          if (hd) { entry.kind = 'heading'; entry.level = hd[2].length; entry.indent = 0; } else if (LIST_RE.test(line)) entry.kind = 'list';
        }
      }
      info[i] = entry;
    }
    for (i = 0; i < info.length; i++) {
      var here = info[i];
      if (here.fenced) continue;
      var end = i + 1;
      var j;
      if (here.kind === 'heading') {
        for (j = i + 1; j < info.length; j++) if (!info[j].fenced && info[j].kind === 'heading' && info[j].level <= here.level) break;
        end = j;
      } else if (here.kind === 'list') {
        for (j = i + 1; j < info.length; j++) {
          var next = info[j];
          if (next.fenced || next.kind === 'blank' || (next.kind === 'fence' && !next.opens)) continue;
          if (next.indent <= here.indent || next.kind === 'heading') break;
        }
        end = j;
      } else if (here.kind === 'fence' && here.opens) {
        for (j = i + 1; j < info.length; j++) if (info[j].kind === 'fence' && !info[j].opens) { j++; break; }
        end = Math.min(j, info.length);
      }
      while (end > i + 1 && info[end - 1].kind === 'blank') end--;
      if (end > i + 1) here.fold = end;
    }
    return info;
  }

  /* The lines the field gets: everything except what a closed line holds. A
   * fold inside a fold is already hidden; a fold whose block is gone opens. */
  function project() {
    var visible = [];
    var toFull = [];
    var skipTo = -1;
    for (var i = 0; i < model.full.length; i++) {
      if (i < skipTo) continue;
      visible.push(model.full[i]);
      toFull.push(i);
      if (!model.collapsed[i]) continue;
      var region = model.regions[i];
      if (region && region.fold > i + 1) skipTo = Math.max(skipTo, region.fold);
      else delete model.collapsed[i];
    }
    model.visible = visible;
    model.toFull = toFull;
  }

  function foldedLines() {
    return Object.keys(model.collapsed).map(Number).sort(function (a, b) { return a - b; });
  }

  function anyFolded() {
    for (var k in model.collapsed) return true;
    return false;
  }

  function toggleFold(line) {
    var region = model.regions[line];
    if (!region || region.fold <= line + 1) return false;
    var sel = selectionDoc();
    if (model.collapsed[line]) delete model.collapsed[line];
    else model.collapsed[line] = true;
    refresh({ write: true, selection: sel });
    return true;
  }

  function foldAll() {
    var sel = selectionDoc();
    for (var i = 0; i < model.regions.length; i++) if (model.regions[i].fold > i + 1) model.collapsed[i] = true;
    refresh({ write: true, selection: sel });
  }

  function unfoldAll() {
    var sel = selectionDoc();
    model.collapsed = Object.create(null);
    refresh({ write: true, selection: sel });
  }

  /* Opens every closed block that hides `line`. */
  function unfoldTo(line) {
    var changed = false;
    for (var k in model.collapsed) {
      var c = Number(k);
      var region = model.regions[c];
      if (region && c < line && line < region.fold) { delete model.collapsed[k]; changed = true; }
    }
    return changed;
  }

  /* ---------------------------------------------------------------- field <-> document */

  /* Where two line lists differ: the lines that match at both ends did not
   * move. */
  function diffLines(prev, next) {
    var head = 0;
    var max = Math.min(prev.length, next.length);
    while (head < max && prev[head] === next[head]) head++;
    var tail = 0;
    while (tail < prev.length - head && tail < next.length - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
    return { head: head, tail: tail, prevEnd: prev.length - tail, nextEnd: next.length - tail };
  }

  /* Lines [from, to) of the document became `count` lines: closed blocks
   * and tints after the change move with it, the ones inside it go. */
  function shiftLineState(from, to, count) {
    var delta = count - (to - from);
    var moved = Object.create(null);
    for (var k in model.collapsed) {
      var line = Number(k);
      if (line < from) moved[line] = true;
      else if (line >= to) moved[line + delta] = true;
    }
    model.collapsed = moved;
    var fill = tints[from > 0 ? from - 1 : from] || '';
    var added = new Array(count);
    for (var i = 0; i < count; i++) added[i] = i < to - from ? (tints[from + i] || fill) : fill;
    tints.splice.apply(tints, [from, to - from].concat(added));
  }

  /* What the field holds now, spliced into the document. Lines changed in
   * place (typing) are written to their own document lines, so a closed
   * block whose head is being retitled stays closed. When rows come or go,
   * whatever was hidden inside the stretch the edit replaced comes back
   * right after the edit, and its fold opens: nothing hidden is lost. */
  function readField() {
    var next = splitLines(el.field.value);
    var prev = model.visible;
    var d = diffLines(prev, next);
    if (d.head === prev.length && d.head === next.length) return null;
    if (d.prevEnd - d.head === d.nextEnd - d.head) {
      for (var v0 = d.head; v0 < d.prevEnd; v0++) model.full[model.toFull[v0]] = next[v0];
      return { shown: model.toFull.slice(), inPlace: true, lines: next };
    }
    var from = d.head < model.toFull.length ? model.toFull[d.head] : model.full.length;
    var to = d.prevEnd < model.toFull.length ? model.toFull[d.prevEnd] : model.full.length;
    var rescued = [];
    if (anyFolded()) {
      var shownLine = Object.create(null);
      for (var v = d.head; v < d.prevEnd; v++) shownLine[model.toFull[v]] = true;
      for (var i = from; i < to; i++) if (!shownLine[i]) rescued.push(model.full[i]);
    }
    var block = next.slice(d.head, d.nextEnd).concat(rescued);
    /* The lines on screen after the edit, numbered in the new document:
     * the untouched ones moved by the edit, plus everything it wrote (and
     * what it rescued, which comes back into view). */
    var delta = block.length - (to - from);
    var shown = [];
    var k;
    for (k = 0; k < d.head; k++) shown.push(model.toFull[k]);
    for (k = 0; k < block.length; k++) shown.push(from + k);
    for (k = d.prevEnd; k < model.toFull.length; k++) shown.push(model.toFull[k] + delta);
    shiftLineState(from, to, block.length);
    model.full.splice.apply(model.full, [from, to - from].concat(block));
    return { shown: shown };
  }

  /* A closed block may never grow over a line that was on screen: a line
   * typed right after a closed head (a heading holds what follows it; a
   * list item what is indented past it) would vanish under the caret, and
   * the next keystrokes would land elsewhere. Such a block opens instead.
   * `shown` is sorted. */
  function openOverShown(shown) {
    for (var k in model.collapsed) {
      var c = Number(k);
      var region = model.regions[c];
      if (!region || region.fold <= c + 1) continue;
      var lo = 0;
      var hi = shown.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (shown[mid] <= c) lo = mid + 1; else hi = mid;
      }
      if (lo < shown.length && shown[lo] < region.fold) delete model.collapsed[k];
    }
  }

  /* After an edit the visible lines can differ from what the field holds: a
   * fold gave its lines back, or a closed line stopped opening a block. The
   * field then gets them, and the caret keeps its place among the words. */
  function syncFieldToModel() {
    var value = el.field.value;
    var want = visibleText();
    if (value === want) return false;
    var map = offsetMapper(value, want);
    var s = map(el.field.selectionStart);
    var e = map(el.field.selectionEnd);
    var top = el.field.scrollTop;
    el.field.value = want;
    el.field.scrollTop = top;
    try { el.field.setSelectionRange(s, e); } catch (err) { /* detached */ }
    return true;
  }

  /* Offsets in the text `from` carried to the text `to`, two values of the
   * field that differ by whole lines (lines given back by a fold): before
   * the lines that differ an offset stays, after them it moves with them,
   * inside them it keeps its distance from their start as far as it can. */
  function offsetMapper(from, to) {
    var a = splitLines(from);
    var b = splitLines(to);
    var d = diffLines(a, b);
    var headOff = 0;
    var r;
    for (r = 0; r < d.head; r++) headOff += a[r].length + 1;
    var oldEnd = headOff;
    for (r = d.head; r < d.prevEnd; r++) oldEnd += a[r].length + 1;
    var newEnd = headOff;
    for (r = d.head; r < d.nextEnd; r++) newEnd += b[r].length + 1;
    return function (o) {
      var mapped = o < headOff ? o : (o >= oldEnd ? o + newEnd - oldEnd : headOff + Math.min(o - headOff, Math.max(0, newEnd - headOff - 1)));
      return Math.max(0, Math.min(to.length, mapped));
    };
  }

  /* The caret and selection as places in the document, not offsets in the
   * field: the field may be about to hold another set of lines. */
  function docPos(offset) {
    var value = el.field.value;
    var row = 0;
    var start = 0;
    var at;
    while ((at = value.indexOf('\n', start)) >= 0 && at < offset) { start = at + 1; row++; }
    var line = model.toFull[row];
    return { line: line === undefined ? model.full.length - 1 : line, col: offset - start };
  }

  function selectionDoc() {
    if (!el.field) return null;
    return { start: docPos(el.field.selectionStart), end: docPos(el.field.selectionEnd), dir: el.field.selectionDirection };
  }

  function caretLine() { return el.field ? docPos(el.field.selectionStart).line : 0; }

  /* The row a document line shows on; a hidden line shows on the head of
   * the block hiding it. Binary search: toFull is increasing. */
  function rowOfLine(line) {
    var tf = model.toFull;
    var lo = 0;
    var hi = tf.length - 1;
    var row = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (tf[mid] <= line) { row = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return row;
  }

  function offsetOfRow(row) {
    var offset = 0;
    for (var i = 0; i < row && i < model.visible.length; i++) offset += model.visible[i].length + 1;
    return offset;
  }

  function offsetOf(pos) {
    var row = rowOfLine(pos.line);
    var hidden = model.toFull[row] !== pos.line;
    var len = (model.visible[row] || '').length;
    return offsetOfRow(row) + (hidden ? len : Math.min(pos.col, len));
  }

  function restoreSelection(sel) {
    if (!sel) return;
    var a = offsetOf(sel.start);
    var b = offsetOf(sel.end);
    try { el.field.setSelectionRange(Math.min(a, b), Math.max(a, b), sel.dir || 'none'); } catch (err) { /* detached */ }
  }

  /* Assigning the value is reserved for loads and folds (it empties the
   * browser's undo of the field); edits go through replaceRange. */
  function writeField(sel) {
    var wanted = visibleText();
    if (el.field.value !== wanted) {
      var keepScroll = el.field.scrollTop;
      el.field.value = wanted;
      el.field.scrollTop = keepScroll;
    }
    restoreSelection(sel);
  }

  function refresh(opts) {
    opts = opts || {};
    model.regions = scan(model.full);
    if (opts.shown) openOverShown(opts.shown);
    project();
    if (opts.write) writeField(opts.selection);
    render();
  }

  /* ---------------------------------------------------------------- edits through the browser's undo */

  /* Replaces [start, end) of the field with text as one native edit (Ctrl+Z
   * undoes it), then selects [selStart, selEnd). The input event it fires
   * brings the edit into the document like typing does.
   *
   * Whether the engine did the edit is told by that input event, never by
   * comparing the field with the expected text: the input handler may
   * already have given the field lines back (a fold that opened), and
   * redoing the edit then would apply it twice. Offsets asked for are
   * carried over such a change. */
  function replaceRange(start, end, text, selStart, selEnd) {
    var field = el.field;
    if (field.readOnly) return false;
    if (fieldUndo) fieldUndo.record();
    if (document.activeElement !== field) {
      try { field.focus({ preventScroll: true }); } catch (err) { field.focus(); }
    }
    var before = field.value;
    var expected = before.slice(0, start) + text + before.slice(end);
    field.setSelectionRange(start, end);
    var seen = inputCount;
    try {
      if (text !== '') document.execCommand('insertText', false, text);
      else if (start !== end) document.execCommand('delete', false);
    } catch (err) { /* refused: done by hand below */ }
    if (inputCount === seen) {
      /* No input event: an engine without execCommand on textareas (the
       * same edit by hand, without the native undo), or one that edited
       * silently. Either way the edit is announced as typing would be. */
      if (field.value === before && expected !== before) field.setRangeText(text, start, end, 'end');
      if (field.value !== before) field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selStart !== undefined) {
      var a = selStart;
      var b = selEnd === undefined ? selStart : selEnd;
      var now = field.value;
      if (now !== expected) {
        var map = offsetMapper(expected, now);
        a = map(a);
        b = map(b);
      }
      try { field.setSelectionRange(a, b); } catch (err) { /* detached */ }
    }
    scheduleCaret();
    return true;
  }

  /* The smallest replacement turning `from` into `to` (the field's whole
   * value), so an undo step is only what changed. */
  function replaceWhole(to, selStart, selEnd) {
    var from = el.field.value;
    if (from === to) { el.field.setSelectionRange(selStart, selEnd); return false; }
    var p = 0;
    var max = Math.min(from.length, to.length);
    while (p < max && from.charCodeAt(p) === to.charCodeAt(p)) p++;
    var q = 0;
    while (q < from.length - p && q < to.length - p && from.charCodeAt(from.length - 1 - q) === to.charCodeAt(to.length - 1 - q)) q++;
    return replaceRange(p, from.length - q, to.slice(p, to.length - q), selStart, selEnd);
  }

  function lineBounds(value, from, to) {
    var start = value.lastIndexOf('\n', from - 1) + 1;
    var end = value.indexOf('\n', to);
    return { start: start, end: end < 0 ? value.length : end };
  }

  /* Rewrites every line the selection touches. A plain caret stays on its
   * line where the line's own words put it; a selection becomes the whole
   * rewritten block, so the same key can be pressed again. */
  function eachChosenLine(change, opts) {
    var field = el.field;
    var opened = opts && opts.blocks ? openChosenBlocks() : null;
    var last = opened ? opened.last : -1;
    var value = field.value;
    var s = field.selectionStart;
    var e = field.selectionEnd;
    /* A selection ending at the very start of a line does not take that line. */
    var eEff = e > s && value.charAt(e - 1) === '\n' ? e - 1 : e;
    var b = lineBounds(value, s, eEff);
    if (last >= 0) {
      var lastRow = rowOfLine(last);
      b.end = Math.max(b.end, offsetOfRow(lastRow) + model.visible[lastRow].length);
    }
    var oldLines = value.slice(b.start, b.end).split('\n');
    var newLines = oldLines.map(change);
    var block = newLines.join('\n');
    if (block === oldLines.join('\n')) {
      /* Nothing to move (Shift+Tab at the margin): the blocks opened for
       * the edit close again. */
      if (opened) {
        var sel = selectionDoc();
        opened.lines.forEach(function (line) { model.collapsed[line] = true; });
        refresh({ write: true, selection: sel });
      }
      return false;
    }
    var next = value.slice(0, b.start) + block + value.slice(b.end);
    if (s === e) {
      var col = s - b.start;
      var delta = newLines[0].length - oldLines[0].length;
      var caret = b.start + Math.max(0, Math.min(newLines[0].length, col + delta));
      return replaceWhole(next, caret, caret);
    }
    return replaceWhole(next, b.start, b.start + block.length);
  }

  /* A closed line stands for its whole block: moving it in or out moves
   * every line it hides with it, or the block would fall apart. Those
   * blocks (and closed ones inside them) open first, so the edit is one
   * native edit over lines the field holds. Returns the last document line
   * the chosen blocks reach and the lines that were closed, or null when
   * nothing chosen was closed. */
  function openChosenBlocks() {
    var field = el.field;
    var value = field.value;
    var s = field.selectionStart;
    var e = field.selectionEnd;
    var eEff = e > s && value.charAt(e - 1) === '\n' ? e - 1 : e;
    var first = docPos(s).line;
    var lastRowLine = docPos(eEff).line;
    var rowA = rowOfLine(first);
    var rowB = rowOfLine(lastRowLine);
    var last = -1;
    for (var r = rowA; r <= rowB; r++) {
      var c = model.toFull[r];
      var region = model.regions[c];
      if (model.collapsed[c] && region && region.fold > c + 1) last = Math.max(last, region.fold - 1);
    }
    if (last < 0) return null;
    var lines = [];
    for (var k in model.collapsed) {
      var line = Number(k);
      if (line >= model.toFull[rowA] && line <= last) { lines.push(line); delete model.collapsed[k]; }
    }
    refresh({ write: true, selection: selectionDoc() });
    return { last: last, lines: lines };
  }

  function shiftLines(direction) {
    return eachChosenLine(function (line) {
      if (direction > 0) return line === '' ? line : INDENT + line;
      if (line.charAt(0) === '\t') return line.slice(1);
      return line.replace(/^ {1,2}/, '');
    }, { blocks: true });
  }

  /* A marker belongs at the head of the line: it replaces the one there. */
  function prefixLines(prefix) {
    return eachChosenLine(function (line) {
      var indent = /^[ \t]*/.exec(line)[0];
      var rest = line.slice(indent.length).replace(/^(#{1,6}[ \t]+|#{1,6}$|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/, '');
      /* A heading sits at column 0: it cannot be nested. */
      return (/^#/.test(prefix) ? '' : indent) + prefix + rest;
    });
  }

  /* One chip for a checkbox's whole life: add it, tick it, untick it. */
  function taskLines() {
    return eachChosenLine(function (line) {
      var task = TASK_RE.exec(line);
      if (task) return task[1] + '[' + (task[2] === ' ' ? 'x' : ' ') + ']' + task[3] + line.slice(task[0].length);
      var item = LIST_RE.exec(line);
      if (item) return item[1] + item[2] + item[3] + '[ ] ' + item[4];
      var indent = /^[ \t]*/.exec(line)[0];
      return indent + '- [ ] ' + line.replace(/^[ \t]*(#{1,6}[ \t]+)?/, '');
    });
  }

  /* A switch, not a stack (doc.toggleMark counts the marks); with nothing
   * chosen a placeholder word stands in, selected, ready to be typed over. */
  function applyMark(name) {
    var field = el.field;
    var value = field.value;
    var s = field.selectionStart;
    var e = field.selectionEnd;
    var base = value;
    if (s === e) {
      var word = t('source.placeholder');
      base = value.slice(0, s) + word + value.slice(e);
      e = s + word.length;
    }
    var next = doc().toggleMark(base, s, e, name);
    return replaceWhole(next.text, next.start, next.end);
  }

  function insertSnippet(text, caretOffset) {
    var field = el.field;
    var s = field.selectionStart;
    var caret = s + text.length + (caretOffset || 0);
    return replaceRange(s, field.selectionEnd, text, caret, caret);
  }

  /* A note is a child of the line it is written under: one step in (at the
   * line's content column, so it nests under a numbered item too), or at
   * column 0 under a heading, whose children sit there. */
  function appendNote(kind) {
    var field = el.field;
    var value = field.value;
    var b = lineBounds(value, field.selectionStart, field.selectionEnd);
    var line = value.slice(b.start, b.end);
    var indent;
    var item = LIST_RE.exec(line);
    if (HEADING_RE.test(line)) indent = '';
    else if (item) indent = item[1] + new Array(item[2].length + Math.min(item[3].length, 4) + 1).join(' ');
    else indent = /^[ \t]*/.exec(line)[0] + INDENT;
    var text = '\n' + indent + doc().noteMarkup(kind, '');
    var caret = b.end + text.length;
    return replaceRange(b.end, b.end, text, caret, caret);
  }

  /* Enter on a list item starts the next item (numbers count on, a to-do
   * gets a fresh box); Enter on an empty item ends the list there. Shift+
   * Enter is a plain new line. */
  function continueList() {
    var field = el.field;
    var value = field.value;
    var s = field.selectionStart;
    if (s !== field.selectionEnd) return false;
    var b = lineBounds(value, s, s);
    var line = value.slice(b.start, b.end);
    var m = /^([ \t]*)([-*+]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line);
    if (!m || /^[ \t]*[-*+][ \t]+>/.test(line)) return false;
    if (s < b.start + m[0].length) return false;
    if (line.slice(m[0].length).trim() === '' && s === b.end) {
      return replaceRange(b.start, b.end, '', b.start, b.start);
    }
    var marker = m[3] ? String(Number(m[3]) + 1) + m[4] : m[2];
    var text = '\n' + m[1] + marker + ' ' + (m[6] ? '[ ] ' : '');
    var caret = s + text.length;
    return replaceRange(s, s, text, caret, caret);
  }

  /* ---------------------------------------------------------------- chips */

  function apply(id) {
    var chip = CHIP_BY_ID[id];
    if (!chip || !el.field || el.field.readOnly || !shown) return false;
    if (chip.swatch) { openColor(); return true; }
    if (chip.dice) { prefSet('diceColors', !prefGet('diceColors', false)); return true; }
    if (document.activeElement !== el.field) {
      try { el.field.focus({ preventScroll: true }); } catch (err) { el.field.focus(); }
    }
    var done = false;
    if (chip.shift) done = shiftLines(chip.shift);
    else if (chip.prefix) done = prefixLines(chip.prefix);
    else if (chip.task) done = taskLines();
    else if (chip.mark) done = applyMark(chip.mark);
    else if (chip.note) done = appendNote(chip.note);
    else if (chip.insert) done = insertSnippet(chip.insert, chip.caret);
    showMarks();
    return done;
  }

  /* The node on the caret's line, in the session's parse (the text written
   * first so the two agree). */
  function entryAtCaret() {
    push();
    var cur = current();
    if (!cur || !bound || cur.mapId !== bound.mapId || cur.projectId !== bound.projectId) return null;
    if (doc().normalizeText(fullText()) !== cur.text) return null;
    return doc().findByLine(cur.state, caretLine());
  }

  /* The picker belongs to the node of the caret's line. Its owner is named
   * the way the editor names its own ('editor:' + path): the editor closes
   * any other picker when the selection is announced, which every colour
   * picked does (the map is drawn again), so a picker owned otherwise would
   * close at the first pick. The field is where the focus goes back. */
  function openColor() {
    if (readOnly()) return;
    var entry = entryAtCaret();
    if (!entry) return;
    var S = session();
    var path = entry.path;
    var picker = ns.colorpicker;
    var owner = 'editor:' + path;
    if (picker && typeof picker.isOpen === 'function' && picker.isOpen() && typeof picker.owner === 'function' && picker.owner() === owner) {
      picker.close();
      return;
    }
    syncing = true;
    try { S.select(path, { reveal: true }); } finally { syncing = false; }
    if (picker && typeof picker.open === 'function') {
      var cur = current();
      var active = document.activeElement;
      if (active !== el.field && el.panel.contains(active)) {
        try { el.field.focus({ preventScroll: true }); } catch (err) { /* hidden */ }
      }
      picker.open(el.swatch, {
        color: doc().colorFor(cur.state, path),
        owner: owner,
        onPick: function (hex) { recolor(path, hex); },
        onAuto: function () { recolor(path, null); },
        onClose: function () {
          /* Closed with the focus nowhere (its swatch rebuilt, a sheet gone):
           * back to the words, where the writing was. */
          var a = document.activeElement;
          if (shown && (!a || a === document.body)) {
            try { el.field.focus({ preventScroll: true }); } catch (err) { /* hidden */ }
          }
        }
      });
      return;
    }
    var C = ns.commands;
    if (C && typeof C.has === 'function' && C.has('node.color')) C.run('node.color', { source: 'button', anchor: el.swatch });
  }

  function recolor(path, hex) {
    /* Typed words first, so the colour is set on the text the field shows. */
    push();
    var cur = current();
    if (!cur) return;
    var result = doc().setColor(cur.state, path, hex);
    if (result) session().apply(result, { label: 'source.label.color', select: false, origin: 'source' });
  }

  /* ---------------------------------------------------------------- field -> map */

  /* The pause waited for grows with what the last write cost: on a map of
   * thousands of lines the map takes a fifth of a second to be drawn again,
   * and drawing it after every short pause would stall the typing. */
  function pushDelay() { return PUSH_DELAY + Math.min(PUSH_EXTRA_MAX, Math.round(pushCost * 2)); }

  function schedulePush() {
    dirty = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, pushDelay());
  }

  /* The panel's text written to the store: one labelled, coalesced step. */
  function push() {
    clearTimeout(pushTimer);
    pushTimer = 0;
    if (!dirty || !bound) { dirty = false; return false; }
    if (composing) { pushTimer = setTimeout(push, pushDelay()); return false; }
    dirty = false;
    var S = ns.store;
    var map = S ? S.map(bound.projectId, bound.mapId) : null;
    if (!map) return false;
    var text = doc().normalizeText(fullText());
    var wrote = false;
    if (text !== map.text && !readOnly()) {
      var t0 = now();
      wrote = !!S.setMapText(bound.projectId, bound.mapId, text, {
        label: 'source.label.edit', key: 'source:' + bound.mapId, origin: 'source'
      });
      var cur = current();
      if (wrote && cur && cur.projectId === bound.projectId && cur.mapId === bound.mapId) {
        try { session().reload({ origin: 'source' }); } catch (err) { report(err); }
      }
      pushCost = now() - t0;
    }
    takeTints();
    /* The caret moved while the map was behind: say it now that they agree. */
    if (focused() && reportedLine >= 0) followCaret(reportedLine);
    return wrote;
  }

  function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }

  function report(err) { if (window.console) console.error('MindRoot source:', err); }

  /* ---------------------------------------------------------------- map -> field */

  /* The branch colour of every line, from the session's parse, when it is a
   * parse of exactly this text. Children paint over their parents. */
  function takeTints() {
    var cur = current();
    if (!cur || !bound || cur.mapId !== bound.mapId || cur.projectId !== bound.projectId) return false;
    if (cur.text !== doc().normalizeText(fullText())) return false;
    var out = new Array(model.full.length);
    for (var i = 0; i < out.length; i++) out[i] = '';
    var flat = cur.state.flat || [];
    for (var f = 0; f < flat.length; f++) {
      var e = flat[f];
      var c = doc().colorFor(cur.state, e.path) || '';
      if (!HEX_RE.test(c)) c = '';
      var end = Math.min(e.subEnd || e.end || e.start + 1, out.length);
      for (var l = e.start; l < end; l++) out[l] = c;
    }
    tints = out;
    if (shown) { render(); showSwatch(); }
    return true;
  }

  /* A text from outside: folds and tints on lines the change did not touch
   * stay where their lines went. */
  function setText(text, opts) {
    opts = opts || {};
    var lines = splitLines(text);
    var same = lines.length === model.full.length && lines.join('\n') === fullText();
    if (same && !opts.force) return false;
    var sel = selectionDoc();
    if (opts.fresh) {
      model.collapsed = Object.create(null);
      tints = [];
      sel = null;
    } else {
      var d = diffLines(model.full, lines);
      shiftLineState(d.head, d.prevEnd, d.nextEnd - d.head);
      if (sel) sel = { start: movePos(sel.start, d), end: movePos(sel.end, d), dir: sel.dir };
    }
    model.full = lines;
    unsettled = false;
    refresh({ write: true, selection: sel || { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } } });
    if (opts.fresh) el.field.scrollTop = 0;
    return true;
  }

  function movePos(pos, d) {
    if (pos.line < d.head) return pos;
    if (pos.line >= d.prevEnd) return { line: pos.line + (d.nextEnd - d.prevEnd), col: pos.col };
    return { line: Math.min(pos.line, Math.max(d.head, d.nextEnd - 1)), col: pos.col };
  }

  /* A change from outside while the field is focused and holds nothing the
   * store lacks (the swatch, another module): written in as one native edit
   * so the caret stays and Ctrl+Z still has it. A change reaching into a
   * closed block takes the plain way. */
  function mergeIntoField(text) {
    var lines = splitLines(text);
    var d = diffLines(model.full, lines);
    for (var k in model.collapsed) {
      var c = Number(k);
      var region = model.regions[c];
      if (region && d.head <= region.fold && d.prevEnd >= c + 1) return setText(text);
    }
    var rowFrom = d.head >= model.full.length ? model.visible.length : rowOfLine(d.head);
    var next = model.visible.slice(0, rowFrom)
      .concat(lines.slice(d.head, d.nextEnd), model.visible.slice(rowFrom + (d.prevEnd - d.head)));
    var sel = selectionDoc();
    var moved = sel ? { start: movePos(sel.start, d), end: movePos(sel.end, d), dir: sel.dir } : null;
    if (fieldUndo) fieldUndo.record();
    replaceWhole(next.join('\n'), el.field.selectionStart, el.field.selectionEnd);
    if (moved) restoreSelection(moved);
    return true;
  }

  function onDocChanged(d) {
    if (!d || !bound || d.projectId !== bound.projectId || d.mapId !== bound.mapId) return;
    if (!shown) return;
    var text = String(d.text == null ? '' : d.text);
    if (focused()) {
      if (dirty || composing || doc().normalizeText(fullText()) === text) { takeTints(); return; }
      mergeIntoField(text);
      takeTints();
      return;
    }
    if (dirty) push();
    if (setText(text) && fieldUndo) fieldUndo.reset();
    takeTints();
  }

  /* ---------------------------------------------------------------- the caret and the selected node */

  var caretQueued = false;
  function scheduleCaret() {
    if (caretQueued) return;
    caretQueued = true;
    var run = function () { if (!caretQueued) return; caretQueued = false; checkCaret(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 50);
  }

  function checkCaret() {
    if (!shown || !el.field) return;
    var mine = focused();
    if (mine) linked = false;
    markActiveRow();
    if (!mine) return;
    var line = caretLine();
    showMarks();
    if (line === reportedLine) return;
    reportedLine = line;
    showSwatch();
    followCaret(line);
  }

  /* The caret's line selects its node on the map, once the map has this
   * text (else as soon as it has, from push()). */
  function followCaret(line) {
    if (!prefGet('syncSelection', true)) return;
    var cur = current();
    if (!cur || !bound || cur.mapId !== bound.mapId || cur.projectId !== bound.projectId) return;
    if (dirty || cur.text !== doc().normalizeText(fullText())) return;
    var entry = doc().findByLine(cur.state, line);
    if (!entry) return;
    var S = session();
    if (S.selected() === entry.path) return;
    syncing = true;
    try { S.select(entry.path, { reveal: true }); } catch (err) { report(err); } finally { syncing = false; }
  }

  /* A node selected on the map: its first line gets the caret and comes
   * into view, its block unfolded, without taking the focus. */
  function onSelection(d) {
    if (syncing || !shown || !d || !bound) return;
    if (d.mapId !== undefined && d.mapId !== null && (d.mapId !== bound.mapId || d.projectId !== bound.projectId)) return;
    if (!prefGet('syncSelection', true) || focused() || d.path === null || d.path === undefined || !d.entry) return;
    var cur = current();
    if (!cur || cur.text !== doc().normalizeText(fullText())) return;
    focusLine(d.entry.start);
  }

  function focusLine(line) {
    if (!el.field || line == null || line < 0 || line >= model.full.length) return false;
    if (unfoldTo(line)) {
      var sel = selectionDoc();
      refresh({ write: true, selection: sel });
    }
    var row = rowOfLine(line);
    /* At the end of the node's words (before a trailing colour or fold
     * comment): a caret at column 0 makes the first thing typed land in
     * front of '## ' and break the heading. A hidden line shows on its
     * block's head, which is where the caret goes. */
    var words = (model.visible[row] || '').replace(/(\s*<!--[\s\S]*?-->)+\s*$/, '');
    var offset = offsetOfRow(row) + words.length;
    reportedLine = line;
    linked = true;
    try { el.field.setSelectionRange(offset, offset); } catch (err) { /* detached */ }
    scrollRowIntoView(row);
    markActiveRow();
    showSwatch();
    return true;
  }

  function scrollRowIntoView(row) {
    var rowEl = el.lines && el.lines.children[row];
    if (!rowEl) return;
    var view = el.field.clientHeight;
    var top = rowEl.offsetTop;
    var wanted = top - (view - rowEl.offsetHeight) / 2;
    var most = el.field.scrollHeight - view;
    el.field.scrollTop = Math.max(0, Math.min(wanted, most));
    syncScroll();
  }

  function markActiveRow() {
    if (!el.lines) return;
    var row = rowOfLine(caretLine());
    var on = focused() || linked;
    var rowEl = on ? el.lines.children[row] || null : null;
    if (rowEl === activeRow) return;
    if (activeRow) activeRow.classList.remove('is-active');
    if (rowEl) rowEl.classList.add('is-active');
    activeRow = rowEl;
  }

  /* B, I and U chips show whether the selection already carries the mark. */
  function showMarks() {
    if (!el.chipEls) return;
    var state = null;
    try { state = doc().markState(el.field.value, el.field.selectionStart, el.field.selectionEnd); } catch (err) { state = null; }
    ['bold', 'italic', 'underline'].forEach(function (name) {
      var b = el.chipEls[name];
      if (b) b.setAttribute('aria-pressed', String(!!(state && state[name])));
    });
  }

  function showSwatch() {
    if (!el.swatch) return;
    var color = tints[caretLine()] || '';
    if (HEX_RE.test(color)) el.swatch.style.setProperty('--src-chip', color);
    else el.swatch.style.removeProperty('--src-chip');
  }

  function showDice() {
    var b = el.chipEls && el.chipEls.dice;
    if (b) b.setAttribute('aria-checked', String(!!prefGet('diceColors', false)));
  }

  /* ---------------------------------------------------------------- painting */

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tag(cls, value) { return '<span class="' + cls + '">' + esc(value) + '</span>'; }

  /* Every character of the line comes out exactly once, or the rows would
   * wrap where the field does not. */
  function paint(line, fenced) {
    if (line === '') return '\u200b';
    if (fenced) return tag('t-fence', line);
    if (COMMENT_LINE_RE.test(line) && !COLOR_RE.test(line) && !MARK_RE.test(line)) return tag('t-comment', line);
    var tail = '';
    for (var guard = 0; guard < 16; guard++) {
      var mark = COLOR_RE.exec(line);
      if (mark) tail = marker(mark) + tail;
      else if ((mark = MARK_RE.exec(line))) tail = tag('t-mark', mark[0]) + tail;
      else break;
      line = line.slice(0, line.length - mark[0].length);
    }
    return body(line) + tail;
  }

  function marker(mark) {
    var hex = HEX_RE.test(mark[1]) ? mark[1] : '';
    return '<span class="t-tint"' + (hex ? ' style="--src-tint:' + hex + '"' : '') + '>' + esc(mark[0]) + '</span>';
  }

  function body(line) {
    var m = HEADING_RE.exec(line);
    if (m) {
      return esc(m[1]) + tag('t-hash', m[2] + m[3]) + '<span class="t-head t-head-' + Math.min(m[2].length, 3) + '">' + inline(m[4]) + '</span>';
    }
    m = LIST_RE.exec(line);
    if (m) return esc(m[1]) + tag('t-bullet', m[2]) + esc(m[3]) + afterMarker(m[4]);
    m = QUOTE_RE.exec(line);
    if (m) return esc(m[1]) + quoted(m[2], m[3]);
    return inline(line);
  }

  function afterMarker(rest) {
    var quote = QUOTE_RE.exec(rest);
    if (quote && quote[1] === '') return quoted(quote[2], quote[3]);
    var box = BOX_RE.exec(rest);
    if (box) {
      var done = box[1] !== ' ';
      return '<span class="t-box' + (done ? ' is-done' : '') + '">' + esc('[' + box[1] + ']') + '</span>' + esc(box[2]) +
        '<span class="' + (done ? 't-done' : 't-todo') + '">' + inline(rest.slice(box[0].length)) + '</span>';
    }
    return inline(rest);
  }

  /* The node's own words under its line ('> text:') are words, not a note:
   * the marker is dimmed and the words drawn as words. */
  function quoted(mark, rest) {
    var whole = mark + rest;
    var text = BODY_RE.exec(whole);
    if (text) return tag('t-mark', text[0]) + inline(whole.slice(text[0].length));
    var note = NOTE_RE.exec(whole);
    if (note) return tag('t-note', note[0]) + '<span class="t-quote">' + inline(whole.slice(note[0].length)) + '</span>';
    return tag('t-quote-mark', mark) + '<span class="t-quote">' + inline(rest) + '</span>';
  }

  /* Sticky tokenizers. Where a match ends is read BEFORE stepping into its
   * inside: the recursive call reuses the same regexes and leaves their
   * lastIndex elsewhere (the old panel looped forever on ***x*** that way). */
  var RE_PLAIN = /[^`*_~[!<=]+/y;
  var RE_WIKI = /\[\[([^\]\n]+)\]\]/y;
  var RE_LINK = /(!?)\[([^\]]*)\]\(([^)]*)\)/y;
  var RE_CODE = /`[^`]*`/y;
  var RE_TAG = /<\/?(?:u|br|mark|s|del|sub|sup)\s*\/?>/iy;
  var RE_STRONG = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/y;
  var RE_EM = /(\*|_)(?=[^\s*_])([^*_]*[^\s*_]|[^\s*_])\1/y;
  var RE_STRIKE = /~~(?=\S)([\s\S]*?\S)~~/y;
  var RE_HIGHLIGHT = /==(?=\S)([\s\S]*?\S)==/y;

  function inline(value) {
    if (value.length > LONG_LINE) return esc(value);
    var out = '';
    var at = 0;
    var m;
    var next;
    while (at < value.length) {
      RE_PLAIN.lastIndex = at;
      if ((m = RE_PLAIN.exec(value))) { out += esc(m[0]); at = RE_PLAIN.lastIndex; continue; }
      RE_WIKI.lastIndex = at;
      if ((m = RE_WIKI.exec(value))) {
        at = RE_WIKI.lastIndex;
        out += tag('t-link-mark', '[[') + tag('t-link', m[1]) + tag('t-link-mark', ']]');
        continue;
      }
      RE_LINK.lastIndex = at;
      if ((m = RE_LINK.exec(value))) {
        at = RE_LINK.lastIndex;
        var image = m[1] === '!';
        var punct = image ? 't-image' : 't-link-mark';
        out += tag(punct, m[1] + '[') + tag(image ? 't-alt' : 't-link', m[2]) + tag(punct, '](') + tag('t-url', m[3]) + tag(punct, ')');
        continue;
      }
      RE_CODE.lastIndex = at;
      if ((m = RE_CODE.exec(value))) { out += tag('t-code', m[0]); at = RE_CODE.lastIndex; continue; }
      RE_TAG.lastIndex = at;
      if ((m = RE_TAG.exec(value))) { out += tag('t-mark', m[0]); at = RE_TAG.lastIndex; continue; }
      RE_STRONG.lastIndex = at;
      if ((m = RE_STRONG.exec(value))) {
        next = RE_STRONG.lastIndex;
        out += tag('t-mark', m[1]) + '<span class="t-strong">' + inline(m[2]) + '</span>' + tag('t-mark', m[1]);
        at = next;
        continue;
      }
      RE_STRIKE.lastIndex = at;
      if ((m = RE_STRIKE.exec(value))) {
        next = RE_STRIKE.lastIndex;
        out += tag('t-mark', '~~') + '<span class="t-strike">' + inline(m[1]) + '</span>' + tag('t-mark', '~~');
        at = next;
        continue;
      }
      RE_HIGHLIGHT.lastIndex = at;
      if ((m = RE_HIGHLIGHT.exec(value))) {
        next = RE_HIGHLIGHT.lastIndex;
        out += tag('t-mark', '==') + '<span class="t-highlight">' + inline(m[1]) + '</span>' + tag('t-mark', '==');
        at = next;
        continue;
      }
      RE_EM.lastIndex = at;
      if ((m = RE_EM.exec(value))) {
        at = RE_EM.lastIndex;
        out += tag('t-mark', m[1]) + '<span class="t-em">' + esc(m[2]) + '</span>' + tag('t-mark', m[1]);
        continue;
      }
      out += esc(value.charAt(at));
      at++;
    }
    return out;
  }

  function paintCached(line, fenced) {
    var key = (fenced ? 'F' : 'N') + line;
    var html = paintCache.get(key);
    if (html !== undefined) return html;
    html = paint(line, fenced);
    if (paintCache.size >= PAINT_CACHE) paintCache.clear();
    paintCache.set(key, html);
    return html;
  }

  /* ---------------------------------------------------------------- the rows */

  function rowFacts(v) {
    var line = model.toFull[v];
    var region = model.regions[line] || {};
    var foldable = region.fold > line + 1;
    var collapsed = foldable && !!model.collapsed[line];
    var tint = tints[line] || '';
    if (!HEX_RE.test(tint)) tint = '';
    return {
      fenced: !!(region.fenced || region.kind === 'fence'),
      meta: (foldable ? (collapsed ? 'c' : 'o') : '-') + '|' + (collapsed ? region.fold - line - 1 : 0) + '|' + tint,
      foldable: foldable, collapsed: collapsed, hidden: collapsed ? region.fold - line - 1 : 0, tint: tint
    };
  }

  function rowStyle(f) {
    var s = '';
    if (f.tint) s += '--src-branch:' + f.tint + ';';
    return s;
  }

  function sideHtml(f) {
    return '<span class="src-side"' + (f.foldable ? ' data-fold=""' : '') + '><span class="src-num"></span>' +
      '<span class="src-arrow' + (f.foldable ? (f.collapsed ? ' is-closed' : ' is-open') : '') + '"></span></span>';
  }

  function moreHtml(f) {
    return f.collapsed ? '<span class="src-more">' + esc(plural('source.more', f.hidden)) + '</span>' : '';
  }

  function rowHtml(v, f) {
    var style = rowStyle(f);
    return '<div class="src-row"' + (style ? ' style="' + style + '"' : '') + '>' + sideHtml(f) +
      '<div class="src-code">' + paintCached(model.visible[v], f.fenced) + '</div>' + moreHtml(f) + '</div>';
  }

  function patchMeta(rowEl, f) {
    var style = rowStyle(f);
    if (style) rowEl.setAttribute('style', style); else rowEl.removeAttribute('style');
    var side = rowEl.firstChild;
    if (f.foldable) side.setAttribute('data-fold', ''); else side.removeAttribute('data-fold');
    side.lastChild.className = 'src-arrow' + (f.foldable ? (f.collapsed ? ' is-closed' : ' is-open') : '');
    var more = rowEl.querySelector('.src-more');
    if (f.collapsed) {
      if (!more) { more = document.createElement('span'); more.className = 'src-more'; rowEl.appendChild(more); }
      more.textContent = plural('source.more', f.hidden);
    } else if (more) more.parentNode.removeChild(more);
  }

  /* The rows follow the visible lines: the stretch that changed is
   * replaced, the rest kept, then every row whose painting context or
   * gutter changed is patched. */
  function render() {
    if (!el.lines || !shown) return;
    var vis = model.visible;
    var n = vis.length;
    var prev = rows.text;
    var lines = el.lines;
    if (lines.children.length !== prev.length) prev = rows.text = [];
    var d = diffLines(prev, vis);
    var i;
    if (d.prevEnd - d.head === d.nextEnd - d.head) {
      /* Lines changed in place (typing): the rows stay, their words are
       * repainted below. Moving no element is what keeps a long document
       * from being laid out again on every keystroke. */
      for (i = d.head; i < d.nextEnd; i++) rows.text[i] = vis[i];
      d = { head: 0, nextEnd: 0 };
    } else if (d.prevEnd > d.head || d.nextEnd > d.head) {
      for (i = d.prevEnd - 1; i >= d.head; i--) lines.removeChild(lines.children[i]);
      var html = '';
      var paints = [];
      var metas = [];
      for (i = d.head; i < d.nextEnd; i++) {
        var f = rowFacts(i);
        html += rowHtml(i, f);
        paints.push((f.fenced ? 'F' : 'N') + vis[i]);
        metas.push(f.meta);
      }
      if (html) {
        var tpl = document.createElement('template');
        tpl.innerHTML = html;
        lines.insertBefore(tpl.content, lines.children[d.head] || null);
      }
      rows.text.splice.apply(rows.text, [d.head, d.prevEnd - d.head].concat(vis.slice(d.head, d.nextEnd)));
      rows.paint.splice.apply(rows.paint, [d.head, d.prevEnd - d.head].concat(paints));
      rows.meta.splice.apply(rows.meta, [d.head, d.prevEnd - d.head].concat(metas));
      rows.num.splice.apply(rows.num, [d.head, d.prevEnd - d.head].concat(metas.map(function () { return 0; })));
    }
    for (i = 0; i < n; i++) {
      if (i >= d.head && i < d.nextEnd) continue;
      var fr = rowFacts(i);
      var pk = (fr.fenced ? 'F' : 'N') + vis[i];
      var rowEl = null;
      if (rows.paint[i] !== pk) {
        rowEl = lines.children[i];
        rowEl.children[1].innerHTML = paintCached(vis[i], fr.fenced);
        rows.paint[i] = pk;
      }
      if (rows.meta[i] !== fr.meta) {
        patchMeta(rowEl || lines.children[i], fr);
        rows.meta[i] = fr.meta;
      }
    }
    if (activeRow && !activeRow.isConnected) activeRow = null;
    if (activeRow) { activeRow.classList.remove('is-active'); activeRow = null; }
    /* Written only when it changes: a custom property set on the editor
     * restyles every row under it. */
    var digits = String(Math.max(2, String(model.full.length).length));
    if (digits !== el.digits) { el.digits = digits; el.editor.style.setProperty('--src-digits', digits); }
    measureScrollbar();
    showFoldState();
    syncScroll();
    markActiveRow();
  }

  function measureScrollbar() {
    var bar = el.field.offsetWidth - el.field.clientWidth;
    if (bar !== scrollbarW && bar >= 0) {
      scrollbarW = bar;
      el.editor.style.setProperty('--src-scrollbar', bar + 'px');
    }
  }

  function syncScroll() {
    if (!el.lines) return;
    el.lines.style.transform = 'translateY(' + (-el.field.scrollTop) + 'px)';
    numberWindow();
  }

  /* Line numbers and the alternating band are written only on the rows in
   * sight (and a screen's worth around them). A CSS counter or an
   * :nth-child band would be simpler, but either makes inserting one line
   * restyle every row below it: on a 5,000-line map, a tenth of a second
   * per Enter. Rows out of sight may carry an old number until they come
   * into view, which is before they are painted. */
  function rowAtY(y) {
    var kids = el.lines.children;
    var lo = 0;
    var hi = kids.length - 1;
    var best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (kids[mid].offsetTop <= y) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  function numberWindow() {
    var kids = el.lines.children;
    var n = kids.length;
    if (!n || !shown) return;
    var view = el.field.clientHeight || 600;
    var top = el.field.scrollTop;
    var first = Math.max(0, rowAtY(top - view) - 2);
    var last = Math.min(n - 1, rowAtY(top + view * 2) + 2);
    if (n <= 400) { first = 0; last = n - 1; }
    for (var v = first; v <= last; v++) {
      var line = model.toFull[v];
      if (line === undefined || rows.num[v] === line + 1) continue;
      rows.num[v] = line + 1;
      var rowEl = kids[v];
      rowEl.firstChild.firstChild.textContent = String(line + 1);
      if (line % 2) rowEl.classList.add('src-row--alt'); else rowEl.classList.remove('src-row--alt');
    }
  }

  function showFoldState() {
    if (!el.foldBtn) return;
    var folded = anyFolded();
    if (el.foldShown === folded && el.foldLang === currentLang()) return;
    el.foldShown = folded;
    el.foldLang = currentLang();
    el.foldBtn.setAttribute('aria-pressed', String(folded));
    var label = t(folded ? 'source.unfoldAll' : 'source.foldAll');
    el.foldBtn.setAttribute('aria-label', label);
    var use = el.foldBtn.querySelector('use');
    if (use) use.setAttribute('href', folded ? '#i-unfold' : '#i-fold');
    if (ns.ui && ns.ui.tooltip) ns.ui.tooltip(el.foldBtn, label);
  }

  function currentLang() { return ns.i18n && ns.i18n.lang ? ns.i18n.lang() : 'en'; }

  function lineOfRow(row) { return model.toFull[row] === undefined ? -1 : model.toFull[row] + 1; }

  /* ---------------------------------------------------------------- field events */

  var inputCount = 0;          // input events seen: replaceRange asks whether its edit was one
  var unsettled = false;       // words composed since the folds were last worked out

  /* The field's own undo (util.typingHistory): the rows painted on every
   * keystroke close the browser's typing run, so its native undo would take
   * back one letter per Ctrl+Z. Steps hold the whole document and the
   * selection as places in it, so a fold opened or closed in between does
   * not shift them. */
  var fieldUndo = null;

  function makeHistory() {
    fieldUndo = ns.util.typingHistory({
      read: function () {
        var f = el.field;
        if (!f) return null;
        return { text: fullText(), sel: selectionDoc(), caret: f.selectionStart === f.selectionEnd ? f.selectionStart : -1 };
      },
      write: function (state) {
        setText(state.text);
        restoreSelection(state.sel);
        schedulePush();
        scheduleCaret();
      }
    });
  }

  function onBeforeInput(event) {
    if (!fieldUndo || el.field.readOnly) return;
    var type = event.inputType || '';
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (type === 'historyUndo') fieldUndo.undo(); else fieldUndo.redo();
      return;
    }
    fieldUndo.before(type);
  }

  function onInput(event) {
    inputCount++;
    if (fieldUndo) fieldUndo.after();
    if (event && event.isComposing) composing = true;
    var change = readField();
    if (change) {
      if (composing && change.inPlace) {
        /* While a word is being composed (every word, with many phone
         * keyboards) the field is never rewritten: an IME whose text is
         * replaced under it types it twice. The rows follow the words; the
         * folds are settled when the word is done. */
        model.visible = change.lines;
        unsettled = true;
        render();
      } else {
        unsettled = false;
        refresh({ write: false, shown: change.shown });
        if (syncFieldToModel()) render();
      }
      schedulePush();
    }
    if (unsettled && !composing) settleFolds();
    scheduleCaret();
  }

  /* The folds after a composed word: what the word changed is re-read, and
   * a block it made reach over a line on screen opens. */
  function settleFolds() {
    unsettled = false;
    refresh({ write: false, shown: model.toFull.slice() });
    if (syncFieldToModel()) render();
  }

  function onKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    var undoing = ns.util.undoKey ? ns.util.undoKey(event) : null;
    if (undoing && fieldUndo) {
      event.preventDefault();
      event.stopPropagation();
      if (el.field.readOnly) return;
      if (undoing === 'undo') fieldUndo.undo(); else fieldUndo.redo();
      return;
    }
    var mod = ns.util.isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    var key = String(event.key || '').toLowerCase();
    var mark = mod && !event.altKey && !event.shiftKey ? MARK_KEYS[key] : null;
    if (mark) {
      /* Here they are about the chosen words (globally Mod+B is the
       * sidebar): handled and stopped. */
      event.preventDefault();
      event.stopPropagation();
      if (!el.field.readOnly) applyMark(mark);
      return;
    }
    if (event.key === 'Escape') {
      /* A picker or menu open over the panel closes first (the app's
       * Escape stack, on the document); the next Escape leaves the field. */
      if (ns.ui && ns.ui.escape && typeof ns.ui.escape.size === 'function' && ns.ui.escape.size() > 0) return;
      event.preventDefault();
      push();
      var map = session() && session().view ? session().view.el : null;
      if (map && !isCompact()) { try { map.focus({ preventScroll: true }); } catch (err) { el.field.blur(); } } else el.field.blur();
      return;
    }
    if (event.key === 'Tab' && !mod && !event.altKey) {
      /* A field that cannot be written lets Tab move the focus on, as any
       * field does: keyboard users must be able to leave it. */
      if (el.field.readOnly) return;
      event.preventDefault();
      shiftLines(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !mod && !event.altKey && !el.field.readOnly) {
      if (continueList()) event.preventDefault();
    }
  }

  /* A tap on a painted checkbox ticks it: the hit test is on the box drawn
   * behind the glass, so a caret placed near it does not. */
  function onClick(event) {
    scheduleCaret();
    var field = el.field;
    if (field.readOnly || field.selectionStart !== field.selectionEnd || !event || event.detail > 1) return;
    var caret = field.selectionStart;
    var b = lineBounds(field.value, caret, caret);
    var m = TASK_RE.exec(field.value.slice(b.start, b.end));
    if (!m) return;
    var rowEl = el.lines.children[rowOfLine(docPos(caret).line)];
    var box = rowEl && rowEl.querySelector('.t-box');
    if (!box) return;
    var r = box.getBoundingClientRect();
    var slop = event.pointerType === 'touch' || ns.util.isTouch ? 6 : 2;
    if (event.clientX < r.left - slop || event.clientX > r.right + slop || event.clientY < r.top - slop || event.clientY > r.bottom + slop) return;
    var at = b.start + m[1].length + 1;
    replaceRange(at, at + 1, m[2] === ' ' ? 'x' : ' ', caret, caret);
  }

  function onBlur() {
    releaseFrameSelection();
    push();
    linked = false;
    composing = false;
    if (unsettled) settleFolds();
    markActiveRow();
    /* The canonical text, now that the field no longer wins. */
    var cur = current();
    if (cur && bound && cur.projectId === bound.projectId && cur.mapId === bound.mapId && cur.text !== doc().normalizeText(fullText())) setText(cur.text);
  }

  /* Chromium leaves the document's selection inside a textarea that lost
   * the focus to something that cannot be selected (the map's nodes): when
   * the press ends, it puts that old caret back over the one focusLine set
   * for the node just picked, and the panel stops following the map. The
   * textarea keeps its own selection for when it is focused again. */
  function releaseFrameSelection() {
    try {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && sel.anchorNode && sel.anchorNode.contains(el.field)) sel.removeAllRanges();
    } catch (err) { /* nothing to release */ }
  }

  /* ---------------------------------------------------------------- the gutter */

  /* The foldable row under a pointer in the gutter, or -1. */
  function gutterRow(event) {
    if (!el.lines || !el.lines.children.length) return -1;
    var r = el.field.getBoundingClientRect();
    var gutter = el.lines.firstChild.firstChild.offsetWidth;
    if (event.clientX - r.left > gutter) return -1;
    var row = rowAtY(event.clientY - r.top + el.field.scrollTop);
    var rowEl = el.lines.children[row];
    if (!rowEl || !rowEl.firstChild.hasAttribute('data-fold')) return -1;
    var top = rowEl.offsetTop - el.field.scrollTop + r.top;
    if (event.clientY < top || event.clientY > top + rowEl.offsetHeight) return -1;
    return row;
  }

  function onGutterDown(event) {
    if (event.button !== undefined && event.button > 0) return;
    var row = gutterRow(event);
    if (row < 0) return;
    event.preventDefault();
    toggleFold(model.toFull[row]);
  }

  var hoverRow = null;
  function showGutterHover(row) {
    var rowEl = row >= 0 ? el.lines.children[row] : null;
    if (rowEl === hoverRow) return;
    if (hoverRow) hoverRow.classList.remove('is-hover');
    if (rowEl) rowEl.classList.add('is-hover');
    hoverRow = rowEl;
    el.field.toggleAttribute('data-over-fold', !!rowEl);
  }

  function onGutterHover(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    showGutterHover(gutterRow(event));
  }

  /* ---------------------------------------------------------------- open, close, size */

  function isOpen() { return !!el.panel && !el.panel.hidden; }

  function loadFromSession() {
    var cur = current();
    if (!cur) { bound = null; return false; }
    bound = { projectId: cur.projectId, mapId: cur.mapId };
    dirty = false;
    clearTimeout(pushTimer);
    pushCost = 0;
    reportedLine = -1;
    rows = { text: [], paint: [], meta: [], num: [] };
    el.lines.textContent = '';
    activeRow = null;
    setText(cur.text, { fresh: true, force: true });
    if (fieldUndo) fieldUndo.reset();
    takeTints();
    var sel = session().selected ? session().selected() : null;
    var entry = sel !== null && sel !== undefined ? doc().entryAt(cur.state, sel) : null;
    if (entry && prefGet('syncSelection', true)) focusLine(entry.start);
    return true;
  }

  function setOpen(on, opts) {
    opts = opts || {};
    if (!ready) return false;
    noMapClosed = false;
    if (on) {
      if (!current()) return false;
      el.panel.hidden = false;
      shown = true;
      prefSet('sourceOpen', true);
      applyHeight();
      syncReadOnly();
      loadFromSession();
      if (opts.focus && !isCompact() && !ns.util.isTouch) {
        try { el.field.focus({ preventScroll: true }); } catch (err) { /* hidden */ }
      }
    } else {
      push();
      var had = el.panel.contains(document.activeElement);
      shown = false;
      el.panel.hidden = true;
      if (opts.remember !== false) prefSet('sourceOpen', false);
      if (had) {
        var map = session() && session().view ? session().view.el : null;
        try { if (map) map.focus({ preventScroll: true }); } catch (err) { /* gone */ }
      }
    }
    if (ns.shell && typeof ns.shell.refresh === 'function') ns.shell.refresh();
    return true;
  }

  function toggle(force) {
    var want = force === undefined ? !isOpen() : !!force;
    return setOpen(want, { focus: want });
  }

  function mainHeight() {
    var main = document.getElementById('main');
    return main ? main.clientHeight : window.innerHeight;
  }

  function stageMin() {
    var stage = document.getElementById('stage');
    var v = stage ? parseFloat(getComputedStyle(stage).minHeight) : 0;
    return isFinite(v) ? v : 0;
  }

  function thumbSpace() {
    var main = document.getElementById('main');
    if (!main) return 0;
    var rowsList = getComputedStyle(main).gridTemplateRows.split(' ');
    var last = parseFloat(rowsList[rowsList.length - 1]);
    return rowsList.length >= 3 && isFinite(last) ? last : 0;
  }

  /* The docked height: the share of the main area, never under MIN_PX and
   * never so tall the map goes under its minimum. Phones: the CSS gives the
   * panel the whole main area. */
  function heightFor(share) {
    var total = mainHeight();
    var max = Math.max(MIN_PX, total - stageMin() - thumbSpace());
    return Math.round(Math.max(MIN_PX, Math.min(max, share * total)));
  }

  function applyHeight(share) {
    if (!el.panel) return;
    if (isCompact()) { el.panel.style.removeProperty('height'); updateGrip(); return; }
    var s = share === undefined ? Number(prefGet('sourceHeight', DEFAULT_SHARE)) : share;
    if (!isFinite(s)) s = DEFAULT_SHARE;
    el.panel.style.height = heightFor(s) + 'px';
    updateGrip(s);
  }

  function updateGrip(share) {
    if (!el.grip) return;
    var s = share === undefined ? Number(prefGet('sourceHeight', DEFAULT_SHARE)) : share;
    el.grip.setAttribute('aria-valuenow', String(Math.round(s * 100)));
  }

  function saveShare(share) {
    var s = Math.max(0.1, Math.min(0.9, share));
    prefSet('sourceHeight', Math.round(s * 1000) / 1000);
    return s;
  }

  function onGripDown(event) {
    if (event.button !== undefined && event.button > 0) return;
    if (isCompact()) return;
    event.preventDefault();
    drag = { id: event.pointerId, y: event.clientY, h: el.panel.offsetHeight, moved: false };
    try { el.grip.setPointerCapture(event.pointerId); } catch (err) { /* synthetic */ }
    document.documentElement.setAttribute('data-src-resizing', '');
  }

  function onGripMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    var px = drag.h + (drag.y - event.clientY);
    if (!drag.moved && Math.abs(drag.y - event.clientY) < 3) return;
    drag.moved = true;
    var total = mainHeight() || 1;
    el.panel.style.height = heightFor(px / total) + 'px';
  }

  function onGripUp(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    var moved = drag.moved;
    drag = null;
    document.documentElement.removeAttribute('data-src-resizing');
    if (moved) {
      var share = saveShare(el.panel.offsetHeight / (mainHeight() || 1));
      updateGrip(share);
      afterResize();
    }
  }

  function onGripKey(event) {
    var share = Number(prefGet('sourceHeight', DEFAULT_SHARE));
    var next = null;
    if (event.key === 'ArrowUp') next = share + KEY_STEP;
    else if (event.key === 'ArrowDown') next = share - KEY_STEP;
    else if (event.key === 'Home') next = 0.9;
    else if (event.key === 'End') next = 0.1;
    else if (event.key === 'Enter') next = DEFAULT_SHARE;
    if (next === null) return;
    event.preventDefault();
    var s = saveShare(next);
    applyHeight(s);
    afterResize();
  }

  function afterResize() {
    measureScrollbar();
    syncScroll();
  }

  /* ---------------------------------------------------------------- read-only, labels */

  function syncReadOnly() {
    if (!el.field) return;
    var ro = readOnly();
    el.field.readOnly = ro;
    el.panel.toggleAttribute('data-readonly', ro);
    if (el.chipEls) {
      Object.keys(el.chipEls).forEach(function (id) {
        var b = el.chipEls[id];
        if (ro) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      });
    }
  }

  function relabel() {
    if (!el.panel) return;
    el.title.textContent = t('source.title');
    el.field.setAttribute('aria-label', t('source.field'));
    el.grip.setAttribute('aria-label', t('source.grip'));
    el.chips.setAttribute('aria-label', t('source.chips'));
    el.closeBtn.setAttribute('aria-label', t('source.close'));
    el.syncBtn.setAttribute('aria-label', t('source.sync'));
    if (ns.ui && ns.ui.tooltip) {
      ns.ui.tooltip(el.closeBtn, t('source.close'), ['Mod+M']);
      ns.ui.tooltip(el.syncBtn, t('source.sync'));
    }
    Object.keys(el.chipEls).forEach(function (id) {
      var b = el.chipEls[id];
      var label = t('source.chip.' + id);
      b.setAttribute('aria-label', label);
      if (ns.ui && ns.ui.tooltip) ns.ui.tooltip(b, label, id === 'bold' ? ['Mod+B'] : id === 'italic' ? ['Mod+I'] : id === 'underline' ? ['Mod+U'] : id === 'indent' ? ['Tab'] : id === 'outdent' ? ['Shift+Tab'] : undefined);
    });
    var rowsAll = el.lines.querySelectorAll('.src-more');
    if (rowsAll.length) { rows.meta = rows.meta.map(function () { return ''; }); render(); }
    showFoldState();
  }

  /* ---------------------------------------------------------------- building */

  function icon(name) { return ns.ui.icon(name); }

  function chipButton(chip) {
    var attrs = { type: 'button', class: 'src-chip', 'data-chip': chip.id, tabindex: '-1' };
    if (chip.mark) attrs['aria-pressed'] = 'false';
    if (chip.dice) { attrs.role = 'switch'; attrs['aria-checked'] = 'false'; }
    var b = h('button', attrs);
    if (chip.icon) b.appendChild(icon(chip.icon));
    else if (chip.swatch) b.appendChild(h('span', { class: 'src-swatch', 'aria-hidden': 'true' }));
    else b.appendChild(h('span', { class: 'src-chip__text', text: chip.text }));
    if (chip.swatch) b.classList.add('src-chip--swatch');
    if (chip.dice) b.classList.add('src-chip--dice');
    return b;
  }

  function build(panel) {
    panel.classList.add('src');
    panel.textContent = '';
    el.panel = panel;
    el.grip = h('div', {
      class: 'src-grip', role: 'separator', tabindex: '0', 'aria-orientation': 'horizontal',
      'aria-valuemin': '10', 'aria-valuemax': '90', 'aria-valuenow': '34'
    });
    el.title = h('h2', { class: 'src-title' });
    el.chips = h('div', { class: 'src-chips', role: 'toolbar' });
    el.chipEls = {};
    CHIPS.forEach(function (c) {
      var b = chipButton(c);
      el.chipEls[c.id] = b;
      el.chips.appendChild(b);
    });
    el.swatch = el.chipEls.swatch;
    el.foldBtn = ns.ui.button({ icon: 'fold', label: t('source.foldAll'), pressed: false, cls: 'src-action' });
    el.syncBtn = ns.ui.button({ icon: 'sync', label: t('source.sync'), pressed: !!prefGet('syncSelection', true), cls: 'src-action' });
    el.closeBtn = ns.ui.button({ icon: 'close', label: t('source.close'), cls: 'src-action' });
    el.actions = h('div', { class: 'src-actions' }, el.foldBtn, el.syncBtn, el.closeBtn);
    el.lines = h('div', { class: 'src-lines' });
    el.rows = h('div', { class: 'src-rows', 'aria-hidden': 'true' }, el.lines);
    el.field = h('textarea', {
      class: 'src-field', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
      wrap: 'soft', 'data-gramm': 'false', translate: 'no'
    });
    el.editor = h('div', { class: 'src-editor' }, el.rows, el.field);
    panel.appendChild(el.grip);
    panel.appendChild(el.title);
    panel.appendChild(el.chips);
    panel.appendChild(el.actions);
    panel.appendChild(el.editor);
    if (ns.ui.roving) roving = ns.ui.roving(el.chips, { selector: '.src-chip' });
  }

  function wire() {
    var f = el.field;
    makeHistory();
    f.addEventListener('beforeinput', onBeforeInput);
    f.addEventListener('input', onInput);
    f.addEventListener('keydown', onKeyDown);
    f.addEventListener('click', onClick);
    f.addEventListener('keyup', scheduleCaret);
    f.addEventListener('select', scheduleCaret);
    f.addEventListener('focus', function () { linked = false; scheduleCaret(); });
    f.addEventListener('blur', onBlur);
    f.addEventListener('scroll', syncScroll, { passive: true });
    f.addEventListener('compositionstart', function () { composing = true; });
    f.addEventListener('compositionend', function () { composing = false; onInput(); schedulePush(); });
    document.addEventListener('selectionchange', function () { if (focused()) scheduleCaret(); });

    /* Chips keep the field's focus and selection: a pointer press on them
     * must not move the focus (the click still runs). */
    el.chips.addEventListener('mousedown', function (event) { if (event.target.closest('.src-chip')) event.preventDefault(); });
    el.chips.addEventListener('click', function (event) {
      var b = event.target.closest('.src-chip');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      apply(b.getAttribute('data-chip'));
    });

    /* The gutter is under the field's left padding: a press there on a
     * line that opens a block folds it, without moving the caret or the
     * focus; anywhere else in the gutter it is a press in the text. */
    f.addEventListener('pointerdown', onGutterDown);
    f.addEventListener('mousedown', function (event) { if (gutterRow(event) >= 0) event.preventDefault(); });
    f.addEventListener('pointermove', ns.util.throttleFrame(onGutterHover));
    f.addEventListener('pointerleave', function () { showGutterHover(-1); });

    el.foldBtn.addEventListener('click', function () { if (anyFolded()) unfoldAll(); else foldAll(); });
    el.syncBtn.addEventListener('click', function () {
      var on = !prefGet('syncSelection', true);
      prefSet('syncSelection', on);
      el.syncBtn.setAttribute('aria-pressed', String(on));
    });
    el.closeBtn.addEventListener('click', function () { setOpen(false); });

    el.grip.addEventListener('pointerdown', onGripDown);
    el.grip.addEventListener('pointermove', onGripMove);
    el.grip.addEventListener('pointerup', onGripUp);
    if (ns.ui && ns.ui.ownTouches) ns.ui.ownTouches(el.grip);
    el.grip.addEventListener('pointercancel', onGripUp);
    el.grip.addEventListener('lostpointercapture', onGripUp);
    el.grip.addEventListener('keydown', onGripKey);
    el.grip.addEventListener('dblclick', function () { applyHeight(saveShare(DEFAULT_SHARE)); afterResize(); });

    var resize = ns.util.throttleFrame(function () { if (isOpen()) { applyHeight(); afterResize(); } });
    var main = document.getElementById('main');
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(resize).observe(main || document.body);
      new ResizeObserver(function () { if (shown) { measureScrollbar(); syncScroll(); } }).observe(el.editor);
    } else window.addEventListener('resize', resize);

    var B = bus();
    if (B) {
      B.on('map:opened', function (d) {
        if (dirty) push();
        if (!isOpen()) {
          bound = d ? { projectId: d.projectId, mapId: d.mapId } : null;
          /* Closed only because no map was open: back with the map. */
          if (noMapClosed && prefGet('sourceOpen', false)) { noMapClosed = false; setOpen(true, { focus: false }); }
          return;
        }
        loadFromSession();
      });
      B.on('map:closed', function () {
        if (dirty) push();
        bound = null;
        if (isOpen()) {
          var had = el.panel.contains(document.activeElement);
          shown = false;
          el.panel.hidden = true;
          noMapClosed = true;
          if (had && document.activeElement && document.activeElement.blur) document.activeElement.blur();
          if (ns.shell && ns.shell.refresh) ns.shell.refresh();
        }
      });
      B.on('doc:changed', onDocChanged);
      B.on('selection', onSelection);
      B.on('flush', function () { push(); });
      B.on('tabs:yield', function () { push(); });
      B.on('tabs', syncReadOnly);
      B.on('store', function (c) { if (c && c.type === 'readonly') syncReadOnly(); });
      B.on('prefs', function (d) { if (d && d.key === 'mode') { if (d.value === 'view') push(); syncReadOnly(); } });
      B.on('lang', relabel);
    }
    if (ns.prefs && typeof ns.prefs.on === 'function') {
      ns.prefs.on('syncSelection', function (v) { el.syncBtn.setAttribute('aria-pressed', String(v !== false)); });
      ns.prefs.on('diceColors', showDice);
      ns.prefs.on('sourceHeight', function () { if (isOpen() && !drag) { applyHeight(); afterResize(); } });
    }
  }

  function registerCommands() {
    var C = ns.commands;
    if (!C) return;
    C.register({
      id: 'source.toggle', label: 'source.cmd.toggle', group: 'view', icon: 'markdown', keys: [{ key: 'Mod+M', global: true }],
      keywords: t('source.kw.toggle'), help: 'source.help.toggle',
      when: function () {
        var mode = document.documentElement.getAttribute('data-mode') === 'view';
        return !mode && (isOpen() || !!current());
      },
      checked: function () { return isOpen(); },
      run: function () { toggle(); }
    });
  }

  function init() {
    if (ready) return;
    var panel = document.getElementById('source');
    if (!panel || !ns.util || !ns.ui || !ns.doc) return;
    build(panel);
    wire();
    relabel();
    showDice();
    registerCommands();
    ready = true;
    var cur = current();
    bound = cur ? { projectId: cur.projectId, mapId: cur.mapId } : null;
    if (prefGet('sourceOpen', false)) {
      if (cur) setOpen(true, { focus: false });
      else noMapClosed = true;
    }
  }

  ns.source = {
    init: init,
    toggle: toggle,
    isOpen: isOpen,
    text: fullText,
    visibleText: visibleText,
    apply: apply,
    toggleFold: toggleFold,
    foldAll: foldAll,
    unfoldAll: unfoldAll,
    folded: foldedLines,
    caretLine: caretLine,
    focusLine: focusLine,
    lineOfRow: lineOfRow,
    flush: push,
    chips: CHIPS.map(function (c) { return c.id; })
  };
})(window.MindRoot);
