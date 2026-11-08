/* MindRoot - notes on the map: the bubble that reads and writes a note, and
 * the "every note open" mode.
 *
 * A note is Markdown: a child bullet holding a quote, `- > note: ...` on a
 * node or `- > edge: ...` on the link arriving at it (ns.doc reads and
 * writes them). The map view draws the dots - a node note's inside its box,
 * an edge note's on the middle of the curve - and, when every note is open,
 * the cards: a node's card inside its box (laid out with it) and a link's
 * card on the curve. This file answers a tap on any of them ('note' from
 * the view) with the bubble, keeps the cards on a link from covering one
 * another, and owns the toggle.
 *
 * The bubble: Enter breaks the line, Ctrl/Cmd+Enter saves, Esc cancels, the
 * X saves and closes, a tap outside saves and closes, an empty note is a
 * deleted note, and the bin deletes it explicitly with an Undo toast. Each
 * write is one undo step. It can be dragged by its head and resized by its
 * corner (the size is remembered, prefs.noteSize); on a phone it is a
 * bottom sheet instead, above the keyboard. In view-only mode it opens only
 * on notes that exist, and only to read them.
 *
 *   init()
 *   open(path, kind: 'node' | 'edge') -> bool
 *   close(save) -> bool          save: write what was typed (default true)
 *   isOpen() -> bool, current() -> {path, kind} | null
 *   toggleAll() -> bool          prefs.notesOpen, also notes.toggleAll (Mod+Shift+B)
 *   restack()                    re-stack the link cards now
 *   remove(path, kind) -> bool   the note (or the link's note) taken off, with Undo
 * Bus: 'notes' {open: bool, path, kind} when the bubble opens or closes. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var STRINGS = {
    en: {
      'notes.title.node': 'Note',
      'notes.title.edge': 'Note on the link',
      'notes.placeholder.node': 'Write the note',
      'notes.placeholder.edge': 'What ties these two nodes together',
      'notes.hint': 'Enter starts a new line, {save} saves, Esc cancels.',
      'notes.delete': 'Delete the note',
      'notes.deleteShort': 'Delete',
      'notes.save': 'Save',
      'notes.close': 'Save and close',
      'notes.closeRead': 'Close',
      'notes.resize': 'Drag to resize, double-click for the usual size',
      'notes.deleted': 'The note is in the trash.',
      'notes.label.write': 'write a note',
      'notes.label.delete': 'delete the note',
      'notes.cmd.toggleAll': 'Keep every note open',
      'notes.cmd.closeAll': 'Close the notes',
      'notes.help.toggleAll': 'Shows every note on the map as a card, or puts them back behind their dots.',
      'notes.kw.toggleAll': 'notes cards show all open comments'
    },
    it: {
      'notes.title.node': 'Nota',
      'notes.title.edge': 'Nota sul collegamento',
      'notes.placeholder.node': 'Scrivi la nota',
      'notes.placeholder.edge': 'Che cosa lega questi due nodi',
      'notes.hint': 'Invio va a capo, {save} salva, Esc annulla.',
      'notes.delete': 'Elimina la nota',
      'notes.deleteShort': 'Elimina',
      'notes.save': 'Salva',
      'notes.close': 'Salva e chiudi',
      'notes.closeRead': 'Chiudi',
      'notes.resize': 'Trascina per ridimensionare, doppio clic per la misura solita',
      'notes.deleted': 'La nota è nel cestino.',
      'notes.label.write': 'scrivi una nota',
      'notes.label.delete': 'elimina la nota',
      'notes.cmd.toggleAll': 'Apri tutte le note',
      'notes.cmd.closeAll': 'Chiudi le note',
      'notes.help.toggleAll': 'Mostra ogni nota della mappa come una scheda, o le rimette dietro i loro pallini.',
      'notes.kw.toggleAll': 'notes cards show all open comments note schede mostra tutte aperte'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  var view = null;
  var stage = null;
  var floaters = null;
  var bubble = null;
  var el = {};              // parts of the bubble
  var open_ = null;         // { path, key, kind, was, projectId, mapId, readOnly, sheet }
  var resizing = null;
  var ready = false;

  function S() { return ns.session; }
  function D() { return ns.doc; }
  function cur() { return S() ? S().current() : null; }
  function h() { return ns.util.h.apply(null, arguments); }

  function compact() {
    if (ns.ui && typeof ns.ui.useSheets === 'function') return ns.ui.useSheets();
    return window.innerWidth < 640;
  }

  /* A length the stylesheet owns, in px. A custom property comes back as it
   * was written ('0.75rem', a calc()), so anything but px is resolved by a
   * probe that takes it as its width, inside the element it belongs to. */
  var probe = null;
  function cssPx(target, name, fallback) {
    try {
      var host = target && target.isConnected ? target : document.body;
      var raw = getComputedStyle(host).getPropertyValue(name).trim();
      if (!raw) return fallback;
      if (/^-?(\d+\.?\d*|\.\d+)px$/.test(raw)) return parseFloat(raw);
      if (!probe) {
        probe = document.createElement('span');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;' +
          'display:block;height:0;padding:0;border:0;margin:0;min-width:0;max-width:none';
      }
      probe.style.width = raw;
      host.appendChild(probe);
      var v = parseFloat(getComputedStyle(probe).width);
      host.removeChild(probe);
      return isFinite(v) ? v : fallback;
    } catch (err) {
      if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
      return fallback;
    }
  }

  function prefGet(key, fallback) {
    try {
      var v = ns.prefs ? ns.prefs.get(key) : undefined;
      return v === undefined || v === null ? fallback : v;
    } catch (err) { return fallback; }
  }

  function saveKeyLabel() {
    return ns.commands && ns.commands.keysLabel ? ns.commands.keysLabel('Mod+Enter') : 'Ctrl+Enter';
  }

  /* ---------------------------------------------------------------- the bubble, built once */

  function iconButton(icon, label, onClick, cls) {
    var b = ns.ui.button({ icon: icon, label: label, cls: cls || null, onClick: onClick });
    /* Pressing a button of the bubble must not first blur the text: the
     * press means what the button says, not "leave". */
    b.addEventListener('pointerdown', function (e) { if (e.button <= 0) e.preventDefault(); });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    return b;
  }

  function build() {
    var titleId = ns.util.uid('note-t');
    bubble = h('section', {
      class: 'note-bubble',
      role: 'dialog',
      'aria-labelledby': titleId,
      hidden: true
    });
    var head = h('div', { class: 'note-bubble__head' });
    el.grip = h('span', { class: 'bar-grip', 'aria-hidden': 'true' });
    el.grip.appendChild(ns.ui.icon('drag-grip'));
    el.title = h('h2', { class: 'note-bubble__title', id: titleId });
    /* Said in words, not only a bin: a note is removed here, and a person
     * looking for how must find it at a glance. */
    el.remove = ns.ui.button({ icon: 'trash', label: t('notes.deleteShort'), kind: 'text', cls: 'note-bubble__delete', onClick: function () { removeNote(); } });
    el.remove.setAttribute('aria-label', t('notes.delete'));
    el.remove.addEventListener('pointerdown', function (e) { if (e.button <= 0) e.preventDefault(); });
    el.remove.addEventListener('mousedown', function (e) { e.preventDefault(); });
    el.close = iconButton('close', t('notes.close'), function () { close(true); }, 'note-bubble__close');
    head.appendChild(el.grip);
    head.appendChild(el.title);
    head.appendChild(el.remove);
    head.appendChild(el.close);
    el.text = h('textarea', { class: 'note-bubble__text', rows: '4', spellcheck: 'true', 'aria-labelledby': titleId });
    el.hint = h('p', { class: 'note-bubble__hint' });
    el.corner = h('span', { class: 'note-bubble__resize', 'aria-hidden': 'true', title: t('notes.resize') });
    bubble.appendChild(head);
    bubble.appendChild(el.text);
    bubble.appendChild(el.hint);
    bubble.appendChild(el.corner);
    /* Tab cycles inside the bubble: past its last control the keys would
     * fall on the page, where the next one edits the map. */
    if (ns.ui.trapTab) ns.ui.trapTab(bubble);
    floaters.appendChild(bubble);

    el.text.addEventListener('keydown', onTextKey);
    el.text.addEventListener('focusout', onFocusOut);
    if (ns.float) {
      ns.float.attach(bubble, el.grip);
      ns.float.onAnchor(bubble, place);
    }
    bindResize();
  }

  /* ---------------------------------------------------------------- keys */

  function onTextKey(e) {
    if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(false);
      return;
    }
    /* Typing stays in the note; a modified key goes on to the app, whose
     * dispatcher acts only on the bindings meant for text fields (Ctrl+S).
     * Tab goes on to the bubble, which keeps it among its own controls. */
    if (!mod && e.key !== 'Tab') e.stopPropagation();
  }

  /* The focus going elsewhere (a click, a tool outside the bubble) is
   * leaving it: what was typed is kept. Tab cycles inside the bubble. The
   * window losing focus is not leaving. */
  function onFocusOut(e) {
    if (!open_ || open_.sheet || resizing) return;
    var to = e.relatedTarget;
    if (to && bubble.contains(to)) return;
    if (!to && !document.hasFocus()) return;
    if (!to) return;
    close(true);
  }

  /* A press outside the bubble saves and closes it - except on a note dot
   * or card, whose 'note' answer opens that note (and saves this one). */
  function onDocPointerDown(e) {
    if (!open_ || open_.sheet) return;
    var target = e.target;
    if (!target || !target.closest) return;
    if (bubble.contains(target)) return;
    if (target.closest('.mv-note-dot, .mv-edge-dot, .mv-card')) return;
    if (target.closest('#layers .toast')) return;
    close(true);
  }

  /* ---------------------------------------------------------------- size */

  function minSize() {
    return { w: cssPx(bubble, '--note-min-w', 220), h: cssPx(bubble, '--note-min-h', 140) };
  }

  function stageBox() { return stage.getBoundingClientRect(); }

  /* The size asked for is a wish: the stage of the moment has the last word. */
  function applySize() {
    var want = prefGet('noteSize', null);
    if (!want || !isFinite(want.w) || !isFinite(want.h)) {
      bubble.style.width = '';
      bubble.style.height = '';
      return;
    }
    var box = stageBox();
    var m = minSize();
    var margin = cssPx(bubble, '--bar-margin', 8) * 2;
    bubble.style.width = Math.round(Math.max(m.w, Math.min(want.w, box.width - margin))) + 'px';
    bubble.style.height = Math.round(Math.max(m.h, Math.min(want.h, box.height - margin))) + 'px';
  }

  function setSize(w, hgt) {
    var m = minSize();
    var box = stageBox();
    var margin = cssPx(bubble, '--bar-margin', 8) * 2;
    var size = {
      w: Math.round(Math.max(m.w, Math.min(w, box.width - margin))),
      h: Math.round(Math.max(m.h, Math.min(hgt, box.height - margin)))
    };
    bubble.style.width = size.w + 'px';
    bubble.style.height = size.h + 'px';
    return size;
  }

  /* The corner. The bubble keeps its top-left while it is pulled (moving
   * it under the pointer would take the corner from the hand holding it),
   * and is put back inside the stage when let go. */
  function bindResize() {
    el.corner.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      resizing = { id: e.pointerId, x: e.clientX, y: e.clientY, w: bubble.offsetWidth, h: bubble.offsetHeight, size: null };
      try { el.corner.setPointerCapture(e.pointerId); } catch (err) { /* resizes while over the corner */ }
      bubble.setAttribute('data-resizing', '');
    });
    el.corner.addEventListener('pointermove', function (e) {
      if (!resizing || e.pointerId !== resizing.id) return;
      resizing.size = setSize(resizing.w + e.clientX - resizing.x, resizing.h + e.clientY - resizing.y);
    });
    function release(e) {
      if (!resizing || (e && e.pointerId !== resizing.id)) return;
      var size = resizing.size;
      resizing = null;
      bubble.removeAttribute('data-resizing');
      if (size && ns.prefs) ns.prefs.set('noteSize', size);
      place();
      if (open_ && !open_.readOnly) focusText(false);
    }
    el.corner.addEventListener('pointerup', release);
    el.corner.addEventListener('pointercancel', release);
    el.corner.addEventListener('lostpointercapture', release);
    if (ns.ui && ns.ui.ownTouches) ns.ui.ownTouches(el.corner);
    el.corner.addEventListener('dblclick', function (e) {
      e.preventDefault();
      if (ns.prefs) ns.prefs.set('noteSize', null);
      applySize();
      place();
    });
  }

  /* ---------------------------------------------------------------- placing */

  /* What the bubble points at, on screen: the node's box, or the middle of
   * the curve for an edge note. */
  function anchorRect() {
    if (!open_ || !view) return null;
    var path = pathNow();
    if (path === null) return null;
    if (open_.kind === 'edge') {
      var p = view.edgeMidpoint(path);
      if (p) return { left: p.x, right: p.x, top: p.y, bottom: p.y, width: 0, height: 0 };
    }
    return view.rect(path);
  }

  /* Centred over its anchor, above it with a gap, below when there is no
   * room above, clamped inside the stage. Moved by hand, it stays put until
   * it is opened on another note. */
  function place() {
    if (!open_ || open_.sheet || bubble.hidden) return;
    if (ns.float && ns.float.moved(bubble)) return;
    var a = anchorRect();
    var box = stageBox();
    if (!a) {
      /* Nothing on screen to point at (the node is folded away or off the
       * stage): the bubble keeps its place, or takes the middle when it has
       * none yet. */
      if (bubble.style.left) return;
      var mx = box.left + box.width / 2;
      var my = box.top + box.height / 3;
      a = { left: mx, right: mx, top: my, bottom: my };
    }
    var margin = cssPx(bubble, '--bar-margin', 8);
    var gap = cssPx(bubble, '--note-gap', 12);
    var w = bubble.offsetWidth;
    var hgt = bubble.offsetHeight;
    var ins = { top: 0, bottom: 0 };
    try { if (ns.shell && ns.shell.insets) ins = ns.shell.insets(); } catch (err) { /* no shell */ }
    var left = (a.left + a.right) / 2 - box.left - w / 2;
    var above = a.top - box.top - hgt - gap;
    var below = a.bottom - box.top + gap;
    var top = above >= Math.max(margin, ins.top) ? above : below;
    left = Math.max(margin, Math.min(left, box.width - w - margin));
    top = Math.max(Math.max(margin, ins.top), Math.min(top, box.height - hgt - Math.max(margin, ins.bottom)));
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
    bubble.setAttribute('data-side', top >= a.bottom - box.top ? 'bottom' : 'top');
  }

  /* ---------------------------------------------------------------- open, write, close */

  function hasIncomingEdge(state, path) {
    if (path === null || path === undefined || path === '') return false;
    var i = path.lastIndexOf('.');
    var parent = i < 0 ? '' : path.slice(0, i);
    return !!state.byPath[parent];
  }

  /* Where the note's node is now (an edit elsewhere can move it). */
  function pathNow() {
    var c = cur();
    if (!open_ || !c || c.projectId !== open_.projectId || c.mapId !== open_.mapId) return null;
    if (open_.key !== undefined && c.keys) {
      if (c.keys[open_.path] === open_.key) return open_.path;
      for (var p in c.keys) if (c.keys[p] === open_.key) { open_.path = p; return p; }
    }
    return c.state.byPath[open_.path] ? open_.path : null;
  }

  function open(path, kind) {
    if (!ready) return false;
    kind = kind === 'edge' ? 'edge' : 'node';
    var c = cur();
    if (!c || path === null || path === undefined || !c.state.byPath[path]) return false;
    if (kind === 'edge' && !hasIncomingEdge(c.state, path)) return false;
    var ro = S().readOnly();
    var note = D().noteFor(c.state, path, kind);
    if (ro && !note) return false;
    if (open_) {
      if (open_.path === path && open_.kind === kind && open_.projectId === c.projectId && open_.mapId === c.mapId) {
        if (!open_.readOnly) focusText(false);
        return true;
      }
      close(true, { focus: false });
      c = cur();
      if (!c || !c.state.byPath[path]) return false;
      note = D().noteFor(c.state, path, kind);
    }
    if (ns.editor && ns.editor.isRenaming && ns.editor.isRenaming()) ns.editor.finishRename(true, { focus: false });
    if (ns.colorpicker && ns.colorpicker.isOpen && ns.colorpicker.isOpen()) ns.colorpicker.close();
    var was = note ? note.text : '';
    open_ = {
      path: path, key: c.keys ? c.keys[path] : undefined, kind: kind, was: was,
      projectId: c.projectId, mapId: c.mapId, readOnly: ro, sheet: null, popEsc: null,
      returnFocus: document.activeElement
    };
    if (compact()) openSheet(was);
    else openBubble(was);
    if (ns.bus) ns.bus.emit('notes', { open: true, path: path, kind: kind });
    return true;
  }

  function fill(text) {
    var kind = open_.kind;
    el.title.textContent = t('notes.title.' + kind);
    el.text.value = text;
    el.text.placeholder = open_.readOnly ? '' : t('notes.placeholder.' + kind);
    el.text.readOnly = open_.readOnly;
    el.hint.textContent = t('notes.hint', { save: saveKeyLabel() });
    el.hint.hidden = open_.readOnly;
    el.remove.hidden = open_.readOnly || !text;
    var closeLabel = open_.readOnly ? t('notes.closeRead') : t('notes.close');
    el.close.setAttribute('aria-label', closeLabel);
    if (ns.ui.tooltip) ns.ui.tooltip(el.close, closeLabel);
    bubble.toggleAttribute('data-readonly', open_.readOnly);
    bubble.setAttribute('data-kind', kind);
  }

  function openBubble(text) {
    if (ns.float) ns.float.anchor(bubble);
    fill(text);
    applySize();
    bubble.hidden = false;
    place();
    if (ns.ui && ns.ui.escape) open_.popEsc = ns.ui.escape.push(function () { close(false); });
    if (!open_.readOnly) focusText(false);
    else try { el.close.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
  }

  /* On a phone the note is a sheet from the bottom, above the keyboard. */
  function openSheet(text) {
    var kind = open_.kind;
    var ro = open_.readOnly;
    var area = h('textarea', { class: 'note-sheet__text textarea', rows: '6', spellcheck: 'true', 'aria-label': t('notes.title.' + kind) });
    area.value = text;
    area.readOnly = ro;
    area.placeholder = ro ? '' : t('notes.placeholder.' + kind);
    area.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        finish('save');
      }
    });
    var body = h('div', { class: 'note-sheet' }, area);
    var actions = [];
    if (!ro) {
      if (text) actions.push({ label: t('notes.delete'), icon: 'trash', kind: 'text', onClick: function () { finish('delete'); } });
      actions.push({ label: t('notes.save'), kind: 'primary', onClick: function () { finish('save'); } });
    }
    var job = open_;
    var how = null;
    function finish(what) {
      how = what;
      if (job.sheet) job.sheet.close('done');
    }
    job.area = area;
    job.sheet = ns.ui.sheet({
      title: t('notes.title.' + kind),
      body: body,
      cls: 'note-sheet-dialog',
      detents: ['content', 0.92],
      actions: actions,
      initialFocus: ro ? null : area,
      onClose: function (reason) {
        if (open_ !== job) return;
        var value = area.value;
        if (how === 'delete') value = '';
        var save = !job.readOnly && reason !== 'escape';
        end(save ? value : null);
      }
    });
    if (!ro) {
      try { area.focus({ preventScroll: true }); } catch (err) { /* the sheet focuses itself */ }
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }

  function focusText(selectAll) {
    try { el.text.focus({ preventScroll: true }); } catch (err) { el.text.focus(); }
    if (selectAll) el.text.select();
    else {
      var n = el.text.value.length;
      try { el.text.setSelectionRange(n, n); } catch (err) { /* not a text control */ }
    }
  }

  /* One write, one step: a note written, rewritten or emptied (deleted). */
  function write(text) {
    if (!open_ || open_.readOnly) return false;
    var Dc = D();
    var clean = Dc.sanitizeNote(text);
    if (clean === Dc.sanitizeNote(open_.was)) return false;
    var path = pathNow();
    var c = cur();
    if (path === null || !c || S().readOnly()) return false;
    var r = Dc.setNote(c.state, path, open_.kind, clean);
    if (!r) return false;
    var ok = clean ? S().apply(r, { label: 'notes.label.write', select: false, origin: 'notes' })
      : applyDelete(c, path, open_.kind, r);
    if (ok && !clean && ns.ui && ns.ui.toastUndo) ns.ui.toastUndo(t('notes.deleted'));
    if (ok) open_.was = clean;
    return ok;
  }

  function removeNote() {
    if (!open_ || open_.readOnly) return false;
    end('');
    return true;
  }

  /* A note taken off a node (kind 'node') or off the link reaching it
   * ('edge') without opening it: from the node's menus. One step, with
   * the Undo toast. The bubble open on that very note deletes through it. */
  function removeAt(path, kind) {
    kind = kind === 'edge' ? 'edge' : 'node';
    if (path === null || path === undefined) return false;
    path = String(path);
    if (open_ && open_.path === path && open_.kind === kind) return removeNote();
    var c = cur();
    if (!c || !S() || S().readOnly() || !c.state.byPath[path]) return false;
    var r = D().setNote(c.state, path, kind, '');
    if (!r) return false;
    var ok = applyDelete(c, path, kind, r);
    if (ok && ns.ui && ns.ui.toastUndo) ns.ui.toastUndo(t('notes.deleted'));
    return ok;
  }

  /* A note deleted goes to the project's trash, like everything else taken
   * off a node: the map's new text and the trash entry are one step. */
  function applyDelete(c, path, kind, r) {
    var St = ns.store;
    var had = D().noteFor(c.state, path, kind);
    var words = had && had.text ? had.text : '';
    var owner = c.state.byPath[path] ? D().plainText(c.state.byPath[path]) : '';
    if (!St || typeof St.transaction !== 'function' || typeof St.trashNote !== 'function' || !words) {
      return S().apply(r, { label: 'notes.label.delete', select: false, origin: 'notes' });
    }
    var ok = false;
    St.transaction('notes.label.delete', function () {
      ok = S().apply(r, { label: 'notes.label.delete', select: false, origin: 'notes' });
      if (ok) St.trashNote(c.projectId, c.mapId, { text: words, kind: kind, owner: owner, ownerPath: path });
    });
    return ok;
  }

  /* save: write what was typed (the default); false drops it. */
  function close(save, opts) {
    if (!open_) return false;
    opts = opts || {};
    if (open_.sheet) {
      var job = open_;
      var value = job.area ? job.area.value : job.was;
      open_ = null;
      try { job.sheet.close('program'); } catch (err) { /* already closed */ }
      open_ = job;
      return end(save === false ? null : value, opts);
    }
    return end(save === false ? null : el.text.value, opts);
  }

  /* text: what to write, or null for nothing. */
  function end(text, opts) {
    opts = opts || {};
    var job = open_;
    if (!job) return false;
    var wrote = false;
    if (text !== null && text !== undefined) wrote = write(text);
    open_ = null;
    if (job.popEsc) job.popEsc();
    var hadFocus = !job.sheet && bubble.contains(document.activeElement);
    if (!job.sheet) {
      bubble.hidden = true;
    }
    if (hadFocus && opts.focus !== false) {
      var back = job.returnFocus;
      var target = back && back.isConnected && back !== document.body && !bubble.contains(back) ? back : (view && view.el);
      try { if (target) target.focus({ preventScroll: true }); } catch (err) { /* nowhere to go back to */ }
    }
    if (ns.bus) ns.bus.emit('notes', { open: false, path: job.path, kind: job.kind, saved: wrote });
    return wrote;
  }

  function isOpen() { return !!open_; }
  function current() { return open_ ? { path: open_.path, kind: open_.kind, readOnly: open_.readOnly } : null; }

  /* ---------------------------------------------------------------- every note open */

  function toggleAll() {
    if (!ns.prefs) return false;
    ns.prefs.set('notesOpen', !prefGet('notesOpen', false));
    restackSoon();
    return true;
  }

  /* The cards on the links stand on the middle of their curve; two curves
   * close together would put one card over the other. Whoever comes first
   * in the file keeps its place and the next one steps under it, so cards
   * never swap places as the map moves. Worked in map units (the cards live
   * in the map's own layer), with a margin the view never writes. */
  function restack() {
    if (!view || !view.el) return;
    var cards = Array.prototype.slice.call(view.el.querySelectorAll('.mv-card--edge'));
    if (!cards.length) return;
    if (!prefGet('notesOpen', false)) {
      cards.forEach(function (c) { if (c.style.marginTop) c.style.marginTop = ''; });
      return;
    }
    var g = view.geometry();
    var links = {};
    g.links.forEach(function (l) { links[l.to] = l; });
    var order = {};
    g.order.forEach(function (p, i) { order[p] = i; });
    var gap = cssPx(view.el, '--mv-card-gap', 6);
    cards.sort(function (a, b) {
      var pa = a.getAttribute('data-path');
      var pb = b.getAttribute('data-path');
      return (order[pa] === undefined ? 1e9 : order[pa]) - (order[pb] === undefined ? 1e9 : order[pb]);
    });
    var placed = [];
    cards.forEach(function (card) {
      var l = links[card.getAttribute('data-path')];
      if (!l || card.classList.contains('is-leaving')) { card.style.marginTop = ''; return; }
      var mid = ns.layout && ns.layout.linkMidpoint ? ns.layout.linkMidpoint(l.x1, l.y1, l.x2, l.y2) : { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
      var w = card.offsetWidth;
      var hgt = card.offsetHeight;
      var box = { x: mid.x - w / 2, y: mid.y - hgt / 2, w: w, h: hgt };
      var y0 = box.y;
      for (var pass = 0; pass <= placed.length; pass++) {
        var moved = false;
        for (var i = 0; i < placed.length; i++) {
          var o = placed[i];
          if (box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h) {
            box.y = o.y + o.h + gap;
            moved = true;
          }
        }
        if (!moved) break;
      }
      var dy = Math.round(box.y - y0);
      var want = dy ? dy + 'px' : '';
      if (card.style.marginTop !== want) card.style.marginTop = want;
      placed.push(box);
    });
  }

  var restackSoon = function () { restack(); };

  /* ---------------------------------------------------------------- following the map */

  function onDocChanged() {
    if (!open_) { restackSoon(); return; }
    if (pathNow() === null) {
      /* The node is gone (undone, deleted elsewhere): its note goes with it. */
      close(false, { focus: false });
    } else if (!open_.sheet) {
      place();
    }
    restackSoon();
  }

  /* The page is being left or saved: the note being written goes in now,
   * and the bubble stays open. */
  function onFlush() {
    if (!open_ || open_.readOnly) return;
    var text = open_.sheet ? (open_.area ? open_.area.value : open_.was) : el.text.value;
    write(text);
  }

  function register() {
    var C = ns.commands;
    if (!C) return;
    C.register({
      id: 'notes.toggleAll', label: 'notes.cmd.toggleAll', group: 'view', icon: 'notes-all', keys: ['Mod+Shift+B'],
      keywords: t('notes.kw.toggleAll'), help: 'notes.help.toggleAll',
      title: function () { return prefGet('notesOpen', false) ? t('notes.cmd.closeAll') : t('notes.cmd.toggleAll'); },
      checked: function () { return !!prefGet('notesOpen', false); },
      when: function () { return !!ns.prefs; },
      run: toggleAll
    });
  }

  function init() {
    if (ready) return;
    var session = S();
    if (!session || !session.view || !ns.doc || !ns.ui || !ns.util) return;
    view = session.view;
    stage = document.getElementById('stage');
    floaters = document.getElementById('floaters') || stage;
    if (!stage) return;
    ready = true;
    restackSoon = ns.util.throttleFrame(restack);
    build();
    register();
    view.on('note', function (d) { open(d.path, d.kind); });
    view.on('render', function () { restackSoon(); if (open_) place(); });
    view.on('camera', function () { if (open_) place(); });
    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener('resize', ns.util.throttleFrame(function () {
      if (!open_ || open_.sheet) return;
      applySize();
      place();
    }));
    if (ns.prefs && ns.prefs.on) ns.prefs.on('notesOpen', function () { restackSoon(); setTimeout(restackSoon, 0); });
    var bus = ns.bus;
    if (bus) {
      bus.on('doc:changed', onDocChanged);
      bus.on('map:opened', function () { if (open_) close(false, { focus: false }); restackSoon(); });
      bus.on('map:closed', function () { if (open_) close(false, { focus: false }); });
      bus.on('flush', onFlush);
      bus.on('tabs:yield', onFlush);
      bus.on('layout', function () { if (open_ && !open_.sheet) { applySize(); place(); } });
      bus.on('prefs', function (d) {
        if (d && d.key === 'mode' && open_ && !open_.readOnly) close(true, { focus: false });
      });
      bus.on('tabs', function () { if (open_ && !open_.readOnly && S().readOnly()) close(true, { focus: false }); });
      bus.on('lang', function () {
        /* The idle labels first; an open bubble then says what its own
         * buttons do (a read-only one's X only closes). */
        el.remove.setAttribute('aria-label', t('notes.delete'));
        var words = el.remove.querySelector('.btn__label');
        if (words) words.textContent = t('notes.deleteShort');
        el.close.setAttribute('aria-label', t('notes.close'));
        if (ns.ui.tooltip) ns.ui.tooltip(el.close, t('notes.close'));
        el.corner.setAttribute('title', t('notes.resize'));
        if (open_ && !open_.sheet) fill(el.text.value);
      });
    }
  }

  ns.notes = {
    init: init,
    open: open,
    show: open,
    close: close,
    isOpen: isOpen,
    current: current,
    toggleAll: toggleAll,
    restack: restack,
    remove: removeAt,
    get element() { return bubble; }
  };
})(window.MindRoot);
