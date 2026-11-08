/* MindRoot - copies of a map: the list, a look before going back, and the
 * clock that takes them.
 *
 * A copy is the map's whole text at a moment (store.takeSnapshot). Some are
 * taken by hand, with an optional note ("before the rewrite"); the clock
 * takes the others every N minutes or hours (prefs.copies, 1..999), and only
 * of maps that changed - since their last copy, or for a map that has none,
 * since this session first saw it - so a map nobody touched never fills its
 * list. Clock copies are not steps of the history and survive undo (the
 * store writes them into every state it keeps); the store keeps the last 24
 * of each map and never prunes one taken by hand.
 *
 * Going back to a copy is never blind: the sheet shows the copy first, as a
 * map (a read-only view of its own, which pans and zooms) or as its
 * Markdown with the lines that would change marked. "Go back to it" then
 * takes a copy of the map as it is, and puts the copy's text in place: one
 * step, which Undo takes back whole; the toast says what was kept.
 *
 * The sheet follows the open map: it repaints on store changes, and when
 * another map opens it shows that map's copies (or closes, with none). */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  var TICK_MS = 15000;      // how often the clock looks at the time
  var CONTEXT = 3;          // unchanged lines kept around a change in the diff
  var DIFF_MAX = 4000000;   // cells of the line diff before it gives up on detail

  ns.i18n.add({
    en: {
      'copies.title': 'Copies of {map}',
      'copies.take': 'Take a copy now',
      'copies.noteTitle': 'Take a copy',
      'copies.noteLabel': 'A note for this copy (optional)',
      'copies.notePlaceholder': 'before the rewrite',
      'copies.noteOk': 'Take the copy',
      'copies.taken': 'Copy taken.',
      'copies.clock': 'A copy every',
      'copies.clockAfter': 'when the map has changed',
      'copies.unit.m': 'minutes',
      'copies.unit.h': 'hours',
      'copies.unitN.m.one': 'minute', 'copies.unitN.m.other': 'minutes',
      'copies.unitN.h.one': 'hour', 'copies.unitN.h.other': 'hours',
      'copies.everyLabel': 'Interval of the clock copies',
      'copies.unitLabel': 'Unit',
      'copies.hint': 'The clock keeps its last 24 copies of each map; the ones taken by hand are never pruned. Going back to a copy takes one of the map as it is first.',
      'copies.last': 'Last copy: {when}.',
      'copies.none': 'No copies of {map} yet. One is taken every {every} when the map has changed, and the button above takes one now.',
      'copies.byHand': 'By hand',
      'copies.byClock': 'On the clock',
      'copies.look': 'Look',
      'copies.lookAt': 'Look at the copy from {when}',
      'copies.delete': 'Delete',
      'copies.deleteNamed': 'Delete the copy from {when}',
      'copies.deleted': 'The copy is in the trash.',
      'copies.back': 'Back to the list',
      'copies.previewTitle': 'Copy from {when}',
      'copies.asMap': 'Map',
      'copies.asText': 'Changes',
      'copies.view': 'How to look at it',
      'copies.goBack': 'Go back to it',
      'copies.same': 'The map is already like this copy.',
      'copies.summary': 'Going back to it: {added} lines come back, {removed} go.',
      'copies.summarySame': 'The map reads exactly like this copy.',
      'copies.unchanged.one': '{n} line as it is',
      'copies.unchanged.other': '{n} lines as they are',
      'copies.tooBig': 'Too many changes to mark line by line: this is the copy as it is.',
      'copies.wentBack': 'The map is back to the copy from {when}. What was there is kept as a copy too.',
      'copies.safety': 'before going back to the copy from {when}',
      'copies.label.goBack': 'go back to a copy',
      'copies.readOnly': 'This tab only shows the copies: another tab keeps your maps.',
      'copies.empty': 'This copy is empty.',
      'copies.mapRegion': 'The copy as a map',
      'copies.cmd.open': 'The copies of this map',
      'copies.cmd.take': 'Take a copy now',
      'copies.help.open': 'Every copy of the open map, by hand and on the clock. Look at one before going back to it.',
      'copies.help.take': 'A copy of the map as it is, with a note if you like. Never pruned.',
      'copies.kw.open': 'copies snapshots versions history backup restore',
      'copies.kw.take': 'copy snapshot save version',
      'copies.every.m.one': 'minute',
      'copies.every.m.other': '{n} minutes',
      'copies.every.h.one': 'hour',
      'copies.every.h.other': '{n} hours'
    },
    it: {
      'copies.title': 'Copie di {map}',
      'copies.take': 'Fai una copia ora',
      'copies.noteTitle': 'Fai una copia',
      'copies.noteLabel': 'Una nota per questa copia (facoltativa)',
      'copies.notePlaceholder': 'prima di riscriverla',
      'copies.noteOk': 'Fai la copia',
      'copies.taken': 'Copia fatta.',
      'copies.clock': 'Una copia ogni',
      'copies.clockAfter': 'quando la mappa è cambiata',
      'copies.unit.m': 'minuti',
      'copies.unit.h': 'ore',
      'copies.unitN.m.one': 'minuto', 'copies.unitN.m.other': 'minuti',
      'copies.unitN.h.one': 'ora', 'copies.unitN.h.other': 'ore',
      'copies.everyLabel': 'Intervallo delle copie a tempo',
      'copies.unitLabel': 'Unità',
      'copies.hint': "L'orologio tiene le sue ultime 24 copie di ogni mappa; quelle fatte a mano non vengono mai tolte. Tornare a una copia fa prima una copia della mappa com'è.",
      'copies.last': 'Ultima copia: {when}.',
      'copies.none': 'Ancora nessuna copia di {map}. Se ne fa una ogni {every} quando la mappa è cambiata, e il pulsante qui sopra ne fa una adesso.',
      'copies.byHand': 'A mano',
      'copies.byClock': "Dall'orologio",
      'copies.look': 'Guarda',
      'copies.lookAt': 'Guarda la copia del {when}',
      'copies.delete': 'Elimina',
      'copies.deleteNamed': 'Elimina la copia del {when}',
      'copies.deleted': 'La copia è nel cestino.',
      'copies.back': "Torna all'elenco",
      'copies.previewTitle': 'Copia del {when}',
      'copies.asMap': 'Mappa',
      'copies.asText': 'Cambiamenti',
      'copies.view': 'Come guardarla',
      'copies.goBack': 'Torna a questa copia',
      'copies.same': 'La mappa è già come questa copia.',
      'copies.summary': 'Tornando a questa copia: {added} righe tornano, {removed} se ne vanno.',
      'copies.summarySame': 'La mappa è identica a questa copia.',
      'copies.unchanged.one': '{n} riga com\'è',
      'copies.unchanged.other': '{n} righe come sono',
      'copies.tooBig': 'Troppi cambiamenti per segnarli riga per riga: questa è la copia così com\'è.',
      'copies.wentBack': "La mappa è tornata alla copia del {when}. Quello che c'era è salvato anche lui come copia.",
      'copies.safety': 'prima di tornare alla copia del {when}',
      'copies.label.goBack': 'torna a una copia',
      'copies.readOnly': "Questa scheda mostra soltanto le copie: le mappe le conserva un'altra scheda.",
      'copies.empty': 'Questa copia è vuota.',
      'copies.mapRegion': 'La copia come mappa',
      'copies.cmd.open': 'Le copie di questa mappa',
      'copies.cmd.take': 'Fai una copia ora',
      'copies.help.open': 'Tutte le copie della mappa aperta, a mano e a tempo. Guardane una prima di tornarci.',
      'copies.help.take': "Una copia della mappa com'è, con una nota se vuoi. Non viene mai tolta.",
      'copies.kw.open': 'copies snapshots versions history backup restore copie versioni cronologia ripristina',
      'copies.kw.take': 'copy snapshot save version copia salva versione',
      'copies.every.m.one': 'minuto',
      'copies.every.m.other': '{n} minuti',
      'copies.every.h.one': 'ora',
      'copies.every.h.other': '{n} ore'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function plural(key, n, vars) { return ns.i18n.plural(key, n, vars); }

  function unitWords(select, n) {
    var count = Math.max(1, Math.round(Number(n) || 1));
    var opts = select.options;
    for (var i = 0; i < opts.length; i++) opts[i].textContent = plural('copies.unitN.' + opts[i].value, count);
  }
  function S() { return ns.store; }
  function ui() { return ns.ui; }
  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }
  function editable() { return !!S() && !S().readOnly() && !viewOnly(); }

  /* ================================================================ the clock */

  var baselines = new Map();   // mapId -> the text this session first saw
  var next = 0;                // when the clock copies next (ms)
  var timer = 0;

  function intervalMs() {
    var c = ns.prefs.get('copies') || { every: 1, unit: 'h' };
    var every = util.clamp(Math.round(Number(c.every) || 1), 1, 999);
    return every * (c.unit === 'm' ? 60000 : 3600000);
  }

  function everyText() {
    var c = ns.prefs.get('copies') || { every: 1, unit: 'h' };
    return plural('copies.every.' + (c.unit === 'm' ? 'm' : 'h'), c.every || 1);
  }

  function noteBaselines() {
    var store = S();
    if (!store) return;
    store.projects().forEach(function (p) {
      p.maps.forEach(function (m) { if (!baselines.has(m.id)) baselines.set(m.id, m.text); });
    });
  }

  /* Copies every map that changed since its last copy (or since this
   * session first saw it). Returns how many were taken. */
  function tick(now) {
    now = now == null ? Date.now() : now;
    if (now < next) return 0;
    next = now + intervalMs();
    var store = S();
    if (!store || store.readOnly()) return 0;
    var n = 0;
    store.projects().forEach(function (p) {
      p.maps.forEach(function (m) {
        var list = store.snapshotsOf(p.id, m.id);
        var ref = list.length ? list[0].text : baselines.get(m.id);
        if (ref === undefined || ref === m.text) return;
        if (store.takeSnapshot(p.id, m.id, { kind: 'auto', when: now })) n++;
      });
    });
    return n;
  }

  function restartClock() {
    next = Date.now() + intervalMs();
  }

  function startClock() {
    restartClock();
    clearInterval(timer);
    timer = setInterval(function () { tick(); }, TICK_MS);
  }

  /* ================================================================ the line diff */

  /* What going back would change, line by line: the map as it is against
   * the copy. Common head and tail are taken off first; the middle is an
   * LCS table, unless it would be too big to be worth it. */
  function diff(from, to) {
    var a = from.split('\n');
    var b = to.split('\n');
    var head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    var tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    var am = a.slice(head, a.length - tail);
    var bm = b.slice(head, b.length - tail);
    var ops = [];
    a.slice(0, head).forEach(function (l) { ops.push({ op: ' ', text: l }); });
    if (am.length * bm.length > DIFF_MAX) return null;
    var n = am.length, m = bm.length;
    var w = m + 1;
    var table = new Uint32Array((n + 1) * w);
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        table[i * w + j] = am[i] === bm[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { ops.push({ op: ' ', text: am[i] }); i++; j++; }
      else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) { ops.push({ op: '-', text: am[i] }); i++; }
      else { ops.push({ op: '+', text: bm[j] }); j++; }
    }
    while (i < n) ops.push({ op: '-', text: am[i++] });
    while (j < m) ops.push({ op: '+', text: bm[j++] });
    a.slice(a.length - tail).forEach(function (l) { ops.push({ op: ' ', text: l }); });
    return ops;
  }

  function diffView(current, copy) {
    var box = h('div', { class: 'ws-diff' });
    var ops = diff(current, copy);
    if (!ops) {
      box.appendChild(h('p', { class: 'ws-note', text: t('copies.tooBig') }));
      box.appendChild(h('pre', { class: 'ws-diff__text' }, copy));
      return box;
    }
    var added = ops.filter(function (o) { return o.op === '+'; }).length;
    var removed = ops.filter(function (o) { return o.op === '-'; }).length;
    box.appendChild(h('p', { class: 'ws-note', text: added || removed ? t('copies.summary', { added: ns.i18n.number(added), removed: ns.i18n.number(removed) }) : t('copies.summarySame') }));
    var pre = h('div', { class: 'ws-diff__text', role: 'list' });
    /* Long unchanged runs fold to a line that says how many. */
    var keep = ops.map(function () { return false; });
    ops.forEach(function (o, k) {
      if (o.op === ' ') return;
      for (var d = Math.max(0, k - CONTEXT); d <= Math.min(ops.length - 1, k + CONTEXT); d++) keep[d] = true;
    });
    if (!added && !removed) keep = keep.map(function () { return true; });
    var run = 0;
    function flush() {
      if (!run) return;
      pre.appendChild(h('div', { class: 'ws-diff__skip', role: 'listitem', text: plural('copies.unchanged', run) }));
      run = 0;
    }
    ops.forEach(function (o, k) {
      if (!keep[k]) { run++; return; }
      flush();
      pre.appendChild(h('div', { class: 'ws-diff__line', 'data-op': o.op === '+' ? 'add' : o.op === '-' ? 'del' : 'same', role: 'listitem' },
        h('span', { class: 'ws-diff__mark', 'aria-hidden': 'true', text: o.op === ' ' ? '' : o.op === '+' ? '+' : '−' }),
        h('span', { class: 'ws-diff__words', text: o.text || ' ' })));
    });
    flush();
    box.appendChild(pre);
    return box;
  }

  /* ================================================================ the sheet */

  var cur = null;

  function whenLabel(ms) { return util.formatDate(ms, 'datetime'); }

  function open(opts) {
    opts = opts || {};
    var store = S();
    if (!store) return null;
    var here = store.here();
    if (!here.mapId) return null;
    if (cur && cur.sheet.isOpen()) {
      cur.pid = here.projectId;
      cur.mid = here.mapId;
      showList(cur);
      return cur;
    }
    var c = { pid: here.projectId, mid: here.mapId, mode: 'list', copyId: null, view: null, as: 'map' };
    c.body = h('div', { class: 'ws-panel ws-copies' });
    c.sheet = ui().sheet({
      title: '',
      body: c.body,
      cls: 'ws-sheet ws-sheet--copies',
      desktop: 'side',
      detents: [0.6, 0.92],
      onClose: function () {
        dropView(c);
        if (c.off) c.off.forEach(function (off) { off(); });
        if (cur === c) cur = null;
      }
    });
    c.sheet.el.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !event.defaultPrevented && c.mode === 'preview') {
        event.preventDefault();
        event.stopPropagation();
        showList(c);
      }
    });
    c.off = [
      ns.bus.on('store', function (change) {
        if (!change || change.type === 'history:changed' || change.type === 'view') return;
        schedule(c);
      }),
      ns.bus.on('map:opened', function (d) {
        if (!d || (d.projectId === c.pid && d.mapId === c.mid)) return;
        c.pid = d.projectId;
        c.mid = d.mapId;
        showList(c);
      }),
      ns.bus.on('lang', function () {
        c.frameKey = null;
        if (c.mode === 'preview' && c.copyId) showPreview(c, c.copyId);
        else schedule(c);
      }),
      ns.bus.on('prefs', function (d) { if (d && d.key === 'copies' && c.mode === 'list') schedule(c); })
    ];
    cur = c;
    if (opts.copyId) showPreview(c, opts.copyId); else showList(c);
    return c;
  }

  function schedule(c) {
    if (c.frame) return;
    c.frame = requestAnimationFrame(function () {
      c.frame = 0;
      if (!c.sheet.isOpen()) return;
      var store = S();
      if (!store.map(c.pid, c.mid)) {
        var here = store.here();
        if (!here.mapId) { c.sheet.close('gone'); return; }
        c.pid = here.projectId;
        c.mid = here.mapId;
        showList(c);
        return;
      }
      if (c.mode === 'preview') {
        if (!store.snapshot(c.pid, c.copyId)) showList(c);
        else c.sheet.setTitle(t('copies.previewTitle', { when: whenLabel(store.snapshot(c.pid, c.copyId).when) }));
        return;
      }
      showList(c);
    });
  }

  function dropView(c) {
    if (c.view) {
      try { c.view.destroy(); } catch (err) { /* already gone */ }
      c.view = null;
    }
  }

  /* The list: its frame (the button, the clock's controls) is built once
   * per map and language; a store change only repaints the rows, so a
   * number being typed into the clock's field is never thrown away. */
  function showList(c, opts) {
    opts = opts || {};
    var store = S();
    var map = store.map(c.pid, c.mid);
    if (!map) { c.sheet.close('gone'); return; }
    var cameBack = c.mode === 'preview' ? c.copyId : null;
    var frameKey = c.pid + '|' + c.mid + '|' + ns.i18n.lang() + '|' + editable();
    if (c.mode !== 'list' || c.frameKey !== frameKey || opts.rebuild) {
      dropView(c);
      c.mode = 'list';
      c.body.setAttribute('data-mode', 'list');
      c.copyId = null;
      c.frameKey = frameKey;
      buildFrame(c);
    }
    c.sheet.setTitle(t('copies.title', { map: map.name }));
    paintRows(c, map);
    if (cameBack) {
      var back = c.rows.querySelector('[data-id="' + CSS.escape(cameBack) + '"] [data-role="look"]');
      if (back) back.focus();
    }
    if (!c.body.contains(document.activeElement)) c.take.focus({ preventScroll: true });
  }

  function buildFrame(c) {
    var w = editable();
    c.take = ui().button({ label: t('copies.take'), icon: 'plus', kind: 'primary', id: 'copies-take', onClick: function () { takeNow(c); } });
    if (!w) c.take.setAttribute('aria-disabled', 'true');
    var pref = ns.prefs.get('copies') || { every: 1, unit: 'h' };
    var every = h('input', { class: 'input ws-every', id: 'copies-every', type: 'number', min: '1', max: '999', step: '1', inputmode: 'numeric', value: String(pref.every), 'aria-label': t('copies.everyLabel') });
    var unit = h('select', { class: 'select ws-unit', id: 'copies-unit', 'aria-label': t('copies.unitLabel') },
      h('option', { value: 'm', text: t('copies.unit.m'), selected: pref.unit === 'm' }),
      h('option', { value: 'h', text: t('copies.unit.h'), selected: pref.unit !== 'm' }));
    function commitClock() {
      var n = util.clamp(Math.round(Number(every.value) || 1), 1, 999);
      every.value = String(n);
      if (ns.prefs.set('copies', { every: n, unit: unit.value === 'm' ? 'm' : 'h' })) restartClock();
    }
    every.addEventListener('change', commitClock);
    unit.addEventListener('change', commitClock);
    /* 'every 1 hour', not 'every 1 hours': the units agree with the number. */
    every.addEventListener('input', function () { unitWords(unit, every.value); });
    unitWords(unit, pref.every);
    c.every = every;
    c.unit = unit;
    c.hint = h('p', { class: 'ws-hint' });
    c.rows = h('div', { class: 'ws-copies__rows' });
    c.body.textContent = '';
    c.body.appendChild(h('div', { class: 'ws-panel__top' },
      c.take,
      h('div', { class: 'ws-clock' },
        h('span', { text: t('copies.clock') }), every, unit, h('span', { text: t('copies.clockAfter') })),
      c.hint));
    c.body.appendChild(c.rows);
    if (!w) c.body.appendChild(h('p', { class: 'ws-note', text: t('copies.readOnly') }));
  }

  /* The clock's controls follow a change made elsewhere (settings, another
   * tab), unless the person is typing in them right now. */
  function syncClock(c) {
    if (!c.every || c.mode !== 'list') return;
    var pref = ns.prefs.get('copies') || { every: 1, unit: 'h' };
    if (document.activeElement !== c.every) c.every.value = String(pref.every);
    if (document.activeElement !== c.unit) c.unit.value = pref.unit === 'm' ? 'm' : 'h';
    unitWords(c.unit, c.every.value);
  }

  function paintRows(c, map) {
    var store = S();
    var focusId = focusedKey(c);
    var list = store.snapshotsOf(c.pid, c.mid);
    var last = list.length ? list[0].when : null;
    c.hint.textContent = t('copies.hint') + (last ? ' ' + t('copies.last', { when: util.relativeTime(last) }) : '');
    c.rows.textContent = '';
    if (list.length) {
      var ul = h('ul', { class: 'ws-list ws-copies__list' });
      var w = editable();
      list.forEach(function (s) { ul.appendChild(copyRow(c, s, w)); });
      c.rows.appendChild(ul);
    } else {
      c.rows.appendChild(h('p', { class: 'ws-note', text: t('copies.none', { map: map.name, every: everyText() }) }));
    }
    syncClock(c);
    c.sheet.refit();
    if (focusId && focusId.indexOf('|') > 0) {
      var parts = focusId.split('|');
      var target = c.rows.querySelector('[data-id="' + CSS.escape(parts[0]) + '"] [data-role="' + parts[1] + '"]');
      if (target) target.focus({ preventScroll: true });
    }
  }

  /* Which control had the focus, to give it back after a repaint: a row's
   * button by its copy id and role, or anything else by its id. */
  function focusedKey(c) {
    var a = document.activeElement;
    if (!a || !c.body.contains(a)) return null;
    var row = a.closest('[data-id]');
    if (row && a.getAttribute('data-role')) return row.getAttribute('data-id') + '|' + a.getAttribute('data-role');
    return a.id || null;
  }

  function copyRow(c, s, w) {
    var when = whenLabel(s.when);
    var look = ui().button({ label: t('copies.look'), icon: 'eye', kind: 'text', cls: 'ws-row__look' });
    look.setAttribute('data-role', 'look');
    look.setAttribute('aria-label', t('copies.lookAt', { when: when }));
    look.addEventListener('click', function () { showPreview(c, s.id); });
    var del = ui().button({ label: t('copies.deleteNamed', { when: when }), icon: 'trash', cls: 'ws-row__purge btn--destructive' });
    del.setAttribute('data-role', 'delete');
    if (!w) del.setAttribute('aria-disabled', 'true');
    del.addEventListener('click', function () {
      if (del.getAttribute('aria-disabled') === 'true') return;
      if (S().deleteSnapshot(c.pid, s.id)) ui().toastUndo(t('copies.deleted'));
    });
    var kind = s.kind === 'manual' ? t('copies.byHand') : t('copies.byClock');
    return h('li', { class: 'ws-row ws-copy', 'data-id': s.id, 'data-kind': s.kind },
      ui().icon(s.kind === 'manual' ? 'history' : 'clock', 'ws-row__icon'),
      h('div', { class: 'ws-row__main' },
        h('span', { class: 'ws-row__name', title: when, text: util.relativeTime(s.when) }),
        h('span', { class: 'ws-row__meta', text: s.label ? kind + ': ' + s.label : kind })),
      h('div', { class: 'ws-row__actions' }, look, del));
  }

  function takeNow(c) {
    if (!editable()) { ui().toast(t('copies.readOnly')); return Promise.resolve(null); }
    return ui().prompt({
      title: t('copies.noteTitle'),
      label: t('copies.noteLabel'),
      placeholder: t('copies.notePlaceholder'),
      ok: t('copies.noteOk'),
      allowEmpty: true,
      maxLength: 300
    }).then(function (note) {
      if (note === null) return null;
      var here = c ? { projectId: c.pid, mapId: c.mid } : S().here();
      var copy = S().takeSnapshot(here.projectId, here.mapId, { kind: 'manual', label: note });
      if (copy) ui().toast(t('copies.taken'));
      return copy;
    });
  }

  /* The copy, before anything happens to the map: as a map, or as the lines
   * that would change. */
  function showPreview(c, copyId) {
    var store = S();
    var copy = store.snapshot(c.pid, copyId);
    var map = store.map(c.pid, c.mid);
    if (!copy || !map) { showList(c); return; }
    dropView(c);
    c.mode = 'preview';
    c.body.setAttribute('data-mode', 'preview');
    c.copyId = copyId;
    var when = whenLabel(copy.when);
    c.sheet.setTitle(t('copies.previewTitle', { when: when }));
    var back = ui().button({ label: t('copies.back'), icon: 'chevron-left', kind: 'text', id: 'copies-back', onClick: function () { showList(c); } });
    var go = ui().button({ label: t('copies.goBack'), icon: 'history', kind: 'primary', id: 'copies-go', onClick: function () { goBack(c, copyId); } });
    if (!editable()) go.setAttribute('aria-disabled', 'true');
    var seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('copies.view') });
    var stage = h('div', { class: 'ws-copies__map', role: 'region', 'aria-label': t('copies.mapRegion') });
    var textBox = h('div', { class: 'ws-copies__text' });
    function choose(as) {
      c.as = as;
      Array.prototype.forEach.call(seg.children, function (b) {
        var on = b.getAttribute('data-value') === as;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      stage.hidden = as !== 'map';
      textBox.hidden = as !== 'text';
      if (as === 'map') drawMap(c, stage, copy.text);
      else if (!textBox.firstChild) textBox.appendChild(diffView(map.text, copy.text));
    }
    [['map', t('copies.asMap')], ['text', t('copies.asText')]].forEach(function (pair) {
      var b = h('button', { type: 'button', class: 'seg__opt', role: 'radio', 'data-value': pair[0], text: pair[1] });
      b.addEventListener('click', function () { choose(pair[0]); });
      seg.appendChild(b);
    });
    seg.addEventListener('keydown', function (event) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) < 0) return;
      event.preventDefault();
      var next = c.as === 'map' ? 'text' : 'map';
      choose(next);
      seg.querySelector('[data-value="' + next + '"]').focus();
    });
    c.body.textContent = '';
    c.body.appendChild(h('div', { class: 'ws-copies__bar' }, back, seg));
    if (copy.label) c.body.appendChild(h('p', { class: 'ws-hint', text: (copy.kind === 'manual' ? t('copies.byHand') : t('copies.byClock')) + ': ' + copy.label }));
    c.body.appendChild(stage);
    c.body.appendChild(textBox);
    c.body.appendChild(h('div', { class: 'ws-panel__foot' }, go));
    choose(c.as || 'map');
    c.sheet.refit();
    back.focus({ preventScroll: true });
  }

  /* A read-only map view of its own, inside the sheet. */
  function drawMap(c, host, text) {
    if (c.view || !ns.mapview || !ns.doc) return;
    var tree = ns.doc.viewTree(ns.doc.parse(text));
    if (!tree) { host.textContent = ''; host.appendChild(h('p', { class: 'ws-note', text: t('copies.empty') })); return; }
    var resolve = ns.session && typeof ns.session.resolveImage === 'function' ? ns.session.resolveImage : null;
    var view = ns.mapview.create(host, { resolveImage: resolve });
    c.view = view;
    view.setInsets({ top: 8, right: 8, bottom: 8, left: 8 });
    view.setOptions({
      readOnly: true,
      balance: !!(ns.session && typeof ns.session.balance === 'function' && ns.session.balance()),
      branchText: !!ns.prefs.get('branchText'),
      notesOpen: false
    });
    view.on('select', function (d) { view.select(d.path); });
    view.on('background', function () { view.select(null); });
    view.on('knob', function (d) { view.fold(d.path, d.folded, { deep: !!d.deep }); });
    util.nextFrame().then(function () {
      if (c.view !== view) return;
      view.render(tree, { animate: false });
    });
  }

  /* One step: a copy of the map as it is, then the copy's text in place. */
  function goBack(c, copyId) {
    if (!editable()) { ui().toast(t('copies.readOnly')); return false; }
    var store = S();
    var copy = store.snapshot(c.pid, copyId);
    var map = store.map(c.pid, c.mid);
    if (!copy || !map) return false;
    if (copy.text === map.text) { ui().toast(t('copies.same')); return false; }
    var when = whenLabel(copy.when);
    store.transaction('copies.label.goBack', function () {
      store.takeSnapshot(c.pid, c.mid, { kind: 'manual', label: t('copies.safety', { when: when }) });
      store.setMapText(c.pid, c.mid, copy.text, { origin: 'copies' });
    });
    ui().toastUndo(t('copies.wentBack', { when: when }));
    showList(c);
    return true;
  }

  /* ================================================================ init */

  function init() {
    if (!ns.commands || !S()) return;
    ns.commands.register({
      id: 'copies.open', label: 'copies.cmd.open', group: 'map', icon: 'history',
      keywords: t('copies.kw.open'), help: 'copies.help.open',
      when: function () { return !!S().here().mapId && !viewOnly(); },
      run: function () { return !!open(); }
    });
    ns.commands.register({
      id: 'copies.take', label: 'copies.cmd.take', group: 'map', icon: 'clock',
      keywords: t('copies.kw.take'), help: 'copies.help.take',
      when: function () { return !!S().here().mapId && editable(); },
      run: function () { return takeNow(cur && cur.sheet.isOpen() ? cur : null); }
    });
    noteBaselines();
    ns.bus.on('store', function (change) { if (change && change.type !== 'history:changed' && change.type !== 'view') noteBaselines(); });
    ns.prefs.on('copies', restartClock);
    startClock();
  }

  ns.copies = {
    init: init,
    open: open,
    close: function close() { if (cur) cur.sheet.close('api'); },
    isOpen: function isOpen() { return !!cur && cur.sheet.isOpen(); },
    take: takeNow,
    goBack: function goBackTo(copyId) { return cur ? goBack(cur, copyId) : false; },
    preview: function preview(copyId) { var c = open(); if (c) showPreview(c, copyId); return c; },
    diff: diff,
    clock: {
      tick: tick,
      next: function nextAt() { return next; },
      restart: restartClock,
      baseline: function baseline(mapId) { return baselines.get(mapId); }
    }
  };
})(window.MindRoot);
