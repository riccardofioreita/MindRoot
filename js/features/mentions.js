/* MindRoot - mentions: a link from the words of one node to another node or
 * map of the same project, and who links to what (ns.mentions).
 *
 * A mention is written in the words as [[Map#id|words]] (a node of another
 * map), [[#id|words]] (a node of this map) or [[Map]] (a map): the id is an
 * end-of-line marker on the node, '<!-- id: n3k9a1 -->', given the first time
 * something points at it. Clicking a mention opens the map and selects the
 * node (editor.openLink); "Mentioned by" lists the nodes that point at a node
 * or at the map, and each row goes there.
 *
 * Mention... (command node.mention, or '@' typed in the words of a node)
 * opens a list of the project's maps and nodes with a search box; the choice
 * is written where the caret is, or at the end of the words under the
 * selected node. Giving the target its id and writing the mention are one
 * undo step.
 *
 *   places(query, from) -> [{kind: 'map'|'node', mid, path, label, map}]
 *   mentionsOf(pid, mid, path|null) -> [{mid, map, path, label}]
 *   pick(opts)            the list: {from: {mid, path}, onPick(place), onCancel()}
 *   mention(path)         pick a place and write it in the node
 *   openBy(path)          the "Mentioned by" panel
 * Bus heard: 'editor:typed' ('@' typed). */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var MAX_ROWS = 50;
  var MAX_PARSED = 24;   // other maps parsed for the list at most this many nodes each

  ns.i18n.add({
    en: {
      'mentions.cmd.mention': 'Mention…',
      'mentions.cmd.by': 'Mentioned by…',
      'mentions.cmd.byCount': 'Mentioned by ({n})',
      'mentions.kw.mention': 'mention tag link reference at node map',
      'mentions.kw.by': 'mentioned by backlinks tagged references who cites',
      'mentions.help.mention': 'Write a link to a node or a map of this project in the words of the node. Typing @ in the words does it too. Clicking the link goes there.',
      'mentions.help.by': 'The nodes of this project that mention this node (or this map), each one a click away.',
      'mentions.pick.title': 'Mention a node or a map',
      'mentions.pick.search': 'Search nodes and maps',
      'mentions.pick.list': 'Nodes and maps of this project',
      'mentions.pick.none': 'Nothing matches.',
      'mentions.pick.more': 'Keep typing to narrow the list.',
      'mentions.pick.map': 'Map',
      'mentions.pick.here': 'this map',
      'mentions.by.title': 'Mentioned by',
      'mentions.by.none': 'Nobody mentions this yet.',
      'mentions.by.list': 'Nodes that mention it',
      'mentions.cantWrite': 'That cannot be mentioned: the map’s name has brackets, a bar or a # tag in it. Rename the map first.',
      'mentions.nothingHere': 'Choose a node first.'
    },
    it: {
      'mentions.cmd.mention': 'Menziona…',
      'mentions.cmd.by': 'Citato da…',
      'mentions.cmd.byCount': 'Citato da ({n})',
      'mentions.kw.mention': 'menziona tag link riferimento chiocciola nodo mappa',
      'mentions.kw.by': 'citato da backlink taggato riferimenti chi cita',
      'mentions.help.mention': 'Scrive un link a un nodo o a una mappa di questo progetto nel testo del nodo. Anche digitare @ nel testo lo fa. Cliccando il link ci si arriva.',
      'mentions.help.by': 'I nodi di questo progetto che citano questo nodo (o questa mappa), ognuno a un clic.',
      'mentions.pick.title': 'Menziona un nodo o una mappa',
      'mentions.pick.search': 'Cerca nodi e mappe',
      'mentions.pick.list': 'Nodi e mappe di questo progetto',
      'mentions.pick.none': 'Nessun risultato.',
      'mentions.pick.more': 'Continua a scrivere per restringere l’elenco.',
      'mentions.pick.map': 'Mappa',
      'mentions.pick.here': 'questa mappa',
      'mentions.by.title': 'Citato da',
      'mentions.by.none': 'Per ora nessuno lo cita.',
      'mentions.by.list': 'Nodi che lo citano',
      'mentions.cantWrite': 'Non si può menzionare: il nome della mappa ha parentesi, una barra o un tag # dentro. Rinomina prima la mappa.',
      'mentions.nothingHere': 'Scegli prima un nodo.'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function h() { return ns.util.h.apply(null, arguments); }
  function D() { return ns.doc; }
  function store() { return ns.store; }
  function ed() { return ns.editor; }

  function norm(s) { return String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(); }

  function here() {
    var c = ns.session && ns.session.current ? ns.session.current() : null;
    return c ? { pid: c.projectId, mid: c.mapId, state: c.state } : null;
  }

  /* A map's parsed text, kept for as long as the store holds that very text. */
  var parsed = new WeakMap();
  function stateOf(map) {
    var s = parsed.get(map);
    if (!s) { s = D().parse(map.text); parsed.set(map, s); }
    return s;
  }

  function projectMaps(pid) {
    var p = store().project(pid);
    return p ? p.maps : [];
  }

  /* ---------------------------------------------------------------- what can be mentioned */

  /* The maps and nodes of the project that `query` matches (words of the
   * title or of the map's name), the map shown first, then in file order;
   * a title that starts with the query before one that only has it inside.
   * `from` (a node being written) is left out: no node mentions itself. */
  function places(query, from) {
    var h0 = here();
    if (!h0) return [];
    var q = norm(query);
    var out = [];
    var maps = projectMaps(h0.pid).slice().sort(function (a, b) { return (a.id === h0.mid ? 0 : 1) - (b.id === h0.mid ? 0 : 1); });
    maps.forEach(function (m) {
      var inMap = m.id === h0.mid;
      var mapHit = !q || norm(m.name).indexOf(q) >= 0;
      if (mapHit && !(inMap && from && from.path === null)) out.push({ kind: 'map', mid: m.id, path: null, label: m.name, map: m.name, rank: !q || norm(m.name).indexOf(q) === 0 ? 0 : 1, here: inMap });
      var state = inMap ? h0.state : stateOf(m);
      state.flat.forEach(function (e) {
        if (from && inMap && from.path === e.path) return;
        var label = D().plainText(e);
        if (!label) return;
        var n = norm(label);
        if (q && n.indexOf(q) < 0) return;
        out.push({ kind: 'node', mid: m.id, path: e.path, label: label, map: m.name, rank: !q || n.indexOf(q) === 0 ? 0 : 1, here: inMap, trail: D().breadcrumb ? D().breadcrumb(state, e) : '' });
      });
    });
    var rows = out.map(function (r, i) { r.order = i; return r; });
    rows.sort(function (a, b) { return a.rank - b.rank || a.order - b.order; });
    return rows;
  }

  /* ---------------------------------------------------------------- who mentions what */

  /* The nodes of the project that point at a node of a map (by its id) or,
   * with no path, at the map itself ([[Map]]); a map's primary node stands
   * for the map, so it is also pointed at by the links to the map. */
  function mentionsOf(pid, mid, path) {
    var S = store();
    var target = S.map(pid, mid);
    if (!target) return [];
    var id = null;
    var primary = false;
    if (path !== null && path !== undefined) {
      var state = stateOf(target);
      var entry = D().entryAt(state, path);
      if (!entry) return [];
      id = entry.id || null;
      primary = D().primaryPath(state) === path;
      if (!id && !primary) return [];
    }
    var seen = {};
    var out = [];
    projectMaps(pid).forEach(function (m) {
      if (m.text.indexOf('[[') < 0) return;
      D().wikiRefs(m.text).forEach(function (r) {
        var toThisMap = r.name ? norm(r.name) === norm(target.name) : m.id === mid;
        if (!toThisMap) return;
        var hit = path === null || path === undefined ? !r.node : (r.node ? r.node === id : primary);
        if (!hit) return;
        var key = m.id + '\u001f' + r.path;
        if (seen[key]) return;
        seen[key] = true;
        var e = D().entryAt(stateOf(m), r.path);
        out.push({ mid: m.id, map: m.name, path: r.path, label: e ? D().plainText(e) : '', here: false });
      });
    });
    return out;
  }

  function countFor(path) {
    var h0 = here();
    if (!h0 || path === null || path === undefined) return 0;
    return mentionsOf(h0.pid, h0.mid, path).length;
  }

  /* ---------------------------------------------------------------- the list to choose from */

  var open = null;

  function closePick() {
    var o = open;
    open = null;
    if (o && o.handle && o.handle.close) o.handle.close();
  }

  /* opts: {from, onPick(place), onCancel()}. Escape or closing the panel
   * is a cancel; a choice closes it first, then reports. */
  function pick(opts) {
    opts = opts || {};
    if (!ns.ui || !ns.ui.sheet || !here()) return false;
    closePick();
    var st = { q: '', rows: [], at: 0, done: false };
    var input = h('input', { class: 'input mn-search', type: 'search', placeholder: t('mentions.pick.search'), 'aria-label': t('mentions.pick.search'), autocomplete: 'off', spellcheck: 'false' });
    var list = h('ul', { class: 'mn-list', role: 'listbox', 'aria-label': t('mentions.pick.list') });
    var note = h('p', { class: 'mn-note', 'aria-live': 'polite' });
    var body = h('div', { class: 'mn-pick' }, input, list, note);

    function finish(place) {
      if (st.done) return;
      st.done = true;
      closePick();
      if (place) { if (opts.onPick) opts.onPick(place); } else if (opts.onCancel) opts.onCancel();
    }

    function paint() {
      st.rows = places(st.q, opts.from);
      var shown = st.rows.slice(0, MAX_ROWS);
      st.at = Math.max(0, Math.min(st.at, shown.length - 1));
      list.textContent = '';
      shown.forEach(function (r, i) {
        var li = h('li', { class: 'mn-row' + (i === st.at ? ' is-active' : ''), role: 'option', id: 'mn-row-' + i, 'aria-selected': i === st.at ? 'true' : 'false', 'data-kind': r.kind });
        li.appendChild(h('span', { class: 'mn-row__icon', 'aria-hidden': 'true' }, ns.ui.icon(r.kind === 'map' ? 'map' : 'child')));
        var words = h('span', { class: 'mn-row__words' }, h('span', { class: 'mn-row__label', text: r.label }));
        words.appendChild(h('span', { class: 'mn-row__where', text: r.kind === 'map' ? t('mentions.pick.map') : (r.here ? '' : r.map) }));
        li.appendChild(words);
        li.addEventListener('click', function () { finish(r); });
        li.addEventListener('pointermove', function () { if (st.at !== i) { st.at = i; mark(); } });
        list.appendChild(li);
      });
      note.textContent = shown.length === 0 ? t('mentions.pick.none') : (st.rows.length > shown.length ? t('mentions.pick.more') : '');
      mark();
    }

    function mark() {
      var rows = list.children;
      for (var i = 0; i < rows.length; i++) {
        var on = i === st.at;
        rows[i].classList.toggle('is-active', on);
        rows[i].setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) { input.setAttribute('aria-activedescendant', rows[i].id); if (rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest' }); }
      }
    }

    input.addEventListener('input', function () { st.q = input.value; st.at = 0; paint(); });
    input.addEventListener('keydown', function (e) {
      var shown = Math.min(st.rows.length, MAX_ROWS);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (shown) { st.at = (st.at + 1) % shown; mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown) { st.at = (st.at - 1 + shown) % shown; mark(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown) finish(st.rows[st.at]); }
    });

    var handle = ns.ui.sheet({
      title: t('mentions.pick.title'), body: body, desktop: 'side', cls: 'mn-sheet', detents: ['content', 0.8],
      onClose: function () { if (!st.done) { st.done = true; open = null; if (opts.onCancel) opts.onCancel(); } }
    });
    open = { handle: handle, st: st };
    paint();
    setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (err) { /* gone */ } }, 0);
    return true;
  }

  /* ---------------------------------------------------------------- writing a mention */

  /* The words that mention a place (see editor.referenceTo); said when they
   * cannot be written. */
  function referenceFor(place) {
    var ref = ed().referenceTo(place.pid || here().pid, place.mid, place.kind === 'map' ? null : place.path);
    if (!ref && ns.ui && ns.ui.toast) ns.ui.toast(t('mentions.cantWrite'), { kind: 'error' });
    return ref;
  }

  /* From the selected node (or the one being written): choose, then write.
   * Written where the caret was when the words are being edited, else at
   * the end of the words under the node. One undo step with the id given. */
  function mention(path, opts) {
    opts = opts || {};
    var E = ed();
    var h0 = here();
    if (!E || !h0) return false;
    var ty = E.typing ? E.typing() : null;
    if (path === undefined || path === null) path = ty ? ty.path : (ns.session.selected ? ns.session.selected() : null);
    if (path === null || path === undefined || !D().entryAt(h0.state, path)) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('mentions.nothingHere'));
      return false;
    }
    var caret = ty ? ty.end : null;
    var swallow = opts.swallow || 0;
    var release = ty && E.holdWriting ? E.holdWriting() : function () {};
    var opened = pick({
      from: { mid: h0.mid, path: path },
      onCancel: function () { release(true); },
      onPick: function (place) {
        release(false);
        var st = store();
        var done = false;
        var run = function () {
          var ref = referenceFor(place);
          if (!ref) return;
          if (ty && E.isRenaming && E.isRenaming()) {
            done = E.replaceBefore(swallow, ref, caret);
            return;
          }
          var words = D().bodyFor(ns.session.current().state, path);
          done = E.setTexts(path, { body: (words ? words + ' ' : '') + ref }, 'editor.label.mention');
        };
        if (st && st.transaction) st.transaction('editor.label.mention', run); else run();
        if (!done && ty) release(true);
        return done;
      }
    });
    if (!opened) release(true);
    return opened;
  }

  /* ---------------------------------------------------------------- who points here */

  function openBy(path) {
    var h0 = here();
    if (!h0 || !ns.ui || !ns.ui.sheet) return false;
    if (path === undefined || path === null) path = ns.session.selected ? ns.session.selected() : null;
    if (path === null || path === undefined) return false;
    var rows = mentionsOf(h0.pid, h0.mid, path);
    var list = h('ul', { class: 'mn-list', role: 'list', 'aria-label': t('mentions.by.list') });
    var body = h('div', { class: 'mn-pick' }, rows.length ? list : h('p', { class: 'mn-note', text: t('mentions.by.none') }));
    var handle = null;
    rows.forEach(function (r) {
      var b = h('button', { class: 'mn-row mn-row--button', type: 'button' });
      b.appendChild(h('span', { class: 'mn-row__icon', 'aria-hidden': 'true' }, ns.ui.icon('child')));
      var words = h('span', { class: 'mn-row__words' }, h('span', { class: 'mn-row__label', text: r.label || '…' }));
      words.appendChild(h('span', { class: 'mn-row__where', text: r.mid === h0.mid ? t('mentions.pick.here') : r.map }));
      b.appendChild(words);
      b.addEventListener('click', function () {
        if (handle && handle.close) handle.close();
        if (ed() && ed().isRenaming && ed().isRenaming()) ed().finishRename(true, { focus: false });
        ns.session.open(h0.pid, r.mid, { select: r.path });
      });
      list.appendChild(h('li', {}, b));
    });
    handle = ns.ui.sheet({ title: t('mentions.by.title'), body: body, desktop: 'side', cls: 'mn-sheet', detents: ['content', 0.8] });
    return true;
  }

  /* ---------------------------------------------------------------- commands and the '@' */

  function nodeOk(ctx) {
    return !!ns.session && !!ns.session.selected && ns.session.selected() !== null && !!here() && (!ed() || !ed().canAct || ed().canAct(ctx));
  }

  var lastLen = { key: '', n: 0 };

  /* '@' typed at the start of a word in the words of a node asks for a
   * mention; only when the text grew by that one character (typing, not
   * deleting back to it). */
  function typed(d) {
    var E = ed();
    if (!E || !E.typing || open) return;
    var ty = E.typing();
    if (!ty) { lastLen = { key: '', n: 0 }; return; }
    var key = ty.path + '|' + ty.field;
    var grew = lastLen.key === key && ty.text.length === lastLen.n + 1;
    lastLen = { key: key, n: ty.text.length };
    if (!grew || ty.start !== ty.end || ty.text.charAt(ty.start - 1) !== '@') return;
    var before = ty.start >= 2 ? ty.text.charAt(ty.start - 2) : '';
    if (before && !/\s/.test(before)) return;
    mention(ty.path, { swallow: 1 });
  }

  function register() {
    var C = ns.commands;
    if (!C) return;
    C.register({
      id: 'node.mention', label: 'mentions.cmd.mention', group: 'node', icon: 'link',
      keywords: t('mentions.kw.mention'), help: 'mentions.help.mention',
      when: function (ctx) { return nodeOk(ctx); },
      run: function () { return mention(); }
    });
    C.register({
      id: 'node.mentionedBy', label: 'mentions.cmd.by', group: 'node', icon: 'link',
      keywords: t('mentions.kw.by'), help: 'mentions.help.by',
      title: function () {
        var n = countFor(ns.session && ns.session.selected ? ns.session.selected() : null);
        return n ? t('mentions.cmd.byCount', { n: n }) : t('mentions.cmd.by');
      },
      when: function () { return !!here() && !!ns.session.selected && countFor(ns.session.selected()) > 0; },
      run: function () { return openBy(); }
    });
  }

  function init() {
    register();
    if (ns.bus) ns.bus.on('editor:typed', typed);
  }

  ns.mentions = {
    init: init,
    places: places,
    mentionsOf: mentionsOf,
    pick: pick,
    mention: mention,
    openBy: openBy,
    count: countFor
  };
})(window.MindRoot);
