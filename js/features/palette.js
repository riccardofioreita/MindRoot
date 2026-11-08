/* MindRoot - the palette (Mod+K) and node search (Mod+F): one list to go
 * anywhere and do anything by typing.
 *
 * One <dialog> with a field and a listbox. Focus never leaves the field:
 * the active row is aria-activedescendant, arrows move it (wrapping), Enter
 * runs it, Escape closes and gives the focus back. It opens with no motion
 * at all - it is reached from the keyboard, and must be there when the next
 * key lands.
 *
 * What it finds:
 *   - commands, from the registry (every registered command that asks to be
 *     in the palette), with their live title, group and keys, dimmed when
 *     they cannot run now;
 *   - projects and maps of the whole workspace ("Go to");
 *   - nodes: of the open map (a few, as soon as two letters are typed), and
 *     in node mode (Mod+F, or a query that starts with '#') of the open map
 *     or of every map, a toggle (Tab) away. A node chosen opens its map and
 *     is selected there. A query that starts with '>' finds commands only.
 *
 * Matching ignores case and accents, every word must match, and a word that
 * starts the label beats one that starts a word in it, which beats one
 * found inside a word; the rest of the row (group, keywords, path) only
 * helps. What was chosen lately comes first on an empty query (kept per
 * browser in localStorage 'mindroot2:recent', where it may also be missing). */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  var MAX = 60;
  var RECENT_KEY = 'mindroot2:recent';
  var RECENT_MAX = 8;
  var IN_MAP_ALL = 5;      // nodes (of every map, the open one's first) shown among commands and maps
  var PAGE = 8;

  ns.i18n.add({
    en: {
      'palette.placeholder': 'Type a command or the name of a map',
      'palette.placeholderNodes': 'Search for a node',
      'palette.label': 'Commands and places',
      'palette.labelNodes': 'Nodes',
      'palette.results': 'Results',
      'palette.recent': 'Recent',
      'palette.commands': 'Commands',
      'palette.goto': 'Go to',
      'palette.nodesHere': 'Nodes in this map',
      'palette.nodesAll': 'Nodes in every map',
      'palette.scope': 'Where to look',
      'palette.scopeMap': 'This map',
      'palette.scopeAll': 'Every map',
      'palette.scopeHint': 'Tab switches',
      'palette.noneHere': 'Nothing in this map matches "{q}". Tab looks in every map.',
      'palette.none': 'Nothing matches "{q}".',
      'palette.noneCommand': 'No command matches "{q}".',
      'palette.noMap': 'Open a map to search its nodes, or look in every map.',
      'palette.emptyMap': 'This map has no nodes.',
      'palette.project': 'Project',
      'palette.projectMeta.one': 'Project, {n} map',
      'palette.projectMeta.other': 'Project, {n} maps',
      'palette.map': 'Map',
      'palette.open': 'open',
      'palette.unavailable': 'not now',
      'palette.count.zero': 'No results',
      'palette.count.one': '{n} result',
      'palette.count.other': '{n} results',
      'palette.cmd.open': 'Commands and places',
      'palette.cmd.nodes': 'Search the nodes',
      'palette.help.open': 'Find any command, project, map or node by typing. # searches nodes, > only commands.',
      'palette.help.nodes': 'Find a node of this map or of every map; Enter takes you there.',
      'palette.kw.open': 'palette command search go to find',
      'palette.kw.nodes': 'search find node text'
    },
    it: {
      'palette.placeholder': 'Scrivi un comando o il nome di una mappa',
      'palette.placeholderNodes': 'Cerca un nodo',
      'palette.label': 'Comandi e luoghi',
      'palette.labelNodes': 'Nodi',
      'palette.results': 'Risultati',
      'palette.recent': 'Recenti',
      'palette.commands': 'Comandi',
      'palette.goto': 'Vai a',
      'palette.nodesHere': 'Nodi in questa mappa',
      'palette.nodesAll': 'Nodi in tutte le mappe',
      'palette.scope': 'Dove cercare',
      'palette.scopeMap': 'Questa mappa',
      'palette.scopeAll': 'Tutte le mappe',
      'palette.scopeHint': 'Tab per cambiare',
      'palette.noneHere': 'In questa mappa niente corrisponde a «{q}». Tab cerca in tutte le mappe.',
      'palette.none': 'Niente corrisponde a "{q}".',
      'palette.noneCommand': 'Nessun comando corrisponde a "{q}".',
      'palette.noMap': 'Apri una mappa per cercare tra i suoi nodi, o cerca in tutte le mappe.',
      'palette.emptyMap': 'Questa mappa non ha nodi.',
      'palette.project': 'Progetto',
      'palette.projectMeta.one': 'Progetto, {n} mappa',
      'palette.projectMeta.other': 'Progetto, {n} mappe',
      'palette.map': 'Mappa',
      'palette.open': 'aperta',
      'palette.unavailable': 'non disponibile',
      'palette.count.zero': 'Nessun risultato',
      'palette.count.one': '{n} risultato',
      'palette.count.other': '{n} risultati',
      'palette.cmd.open': 'Comandi e luoghi',
      'palette.cmd.nodes': 'Cerca tra i nodi',
      'palette.help.open': 'Trova un comando, un progetto, una mappa o un nodo scrivendo. # cerca tra i nodi, > solo tra i comandi.',
      'palette.help.nodes': 'Trova un nodo di questa mappa o di tutte; Invio ti ci porta.',
      'palette.kw.open': 'palette command search go to find comandi cerca vai trova',
      'palette.kw.nodes': 'search find node text cerca trova nodo testo'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function S() { return ns.store; }
  function ui() { return ns.ui; }
  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }

  /* ================================================================ matching */

  function fold(s) { return String(s == null ? '' : s).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase(); }

  /* The folded text and, for each of its characters, where it came from in
   * the original: a match found without accents is marked on the words as
   * written. */
  function foldMapped(s) {
    s = String(s == null ? '' : s);
    var out = '';
    var map = [];
    for (var i = 0; i < s.length; i++) {
      var f = fold(s[i]);
      for (var k = 0; k < f.length; k++) { out += f[k]; map.push(i); }
    }
    map.push(s.length);
    return { text: out, map: map };
  }

  var WORD_START = /[\s\-_/.,:;()[\]'"]/;

  /* Where a word starts in a folded text, or -1: the start of the text, or
   * just after a space or punctuation. */
  function wordStart(hay, w) {
    var at = hay.indexOf(w);
    while (at >= 0) {
      if (at === 0 || WORD_START.test(hay[at - 1])) return at;
      at = hay.indexOf(w, at + 1);
    }
    return -1;
  }

  /* A score for one row, or -1 when a word does not match it at all. */
  function score(item, words) {
    if (!words.length) return 0;
    var label = item.f || (item.f = fold(item.label));
    var rest = item.r || (item.r = fold([item.meta, item.keywords, item.group].join(' ')));
    var total = 0;
    var inLabel = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (label.indexOf(w) >= 0) inLabel++;
      if (label.indexOf(w) === 0) total += 100;
      else if (wordStart(label, w) >= 0) total += 70;
      else if (label.indexOf(w) >= 0) total += 40;
      else if (wordStart(rest, w) >= 0) total += 20;
      else if (rest.indexOf(w) >= 0) total += 10;
      else return -1;
    }
    /* A node is found by its own words: the path above it only narrows
     * the search (it would list every node under a branch called 'Guerra',
     * with nothing in their names to show why). */
    if (item.kind === 'node' && !inLabel) return -1;
    /* Nodes of the open map before the same words elsewhere. */
    if (item.here) total += 5;
    /* Shorter labels that match as well are the likelier meaning. */
    total += Math.max(0, 12 - Math.floor(label.length / 8));
    return total;
  }

  function highlight(label, words) {
    if (!words.length) return [document.createTextNode(label)];
    var fm = foldMapped(label);
    var ranges = [];
    words.forEach(function (w) {
      var at = wordStart(fm.text, w);
      if (at < 0) at = fm.text.indexOf(w);
      if (at < 0) return;
      ranges.push([fm.map[at], fm.map[at + w.length - 1] + 1]);
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    var out = [];
    var pos = 0;
    merged.forEach(function (r) {
      if (r[0] > pos) out.push(document.createTextNode(label.slice(pos, r[0])));
      out.push(h('mark', { class: 'hit', text: label.slice(r[0], r[1]) }));
      pos = r[1];
    });
    if (pos < label.length) out.push(document.createTextNode(label.slice(pos)));
    return out;
  }

  /* ================================================================ recents */

  function readRecent() {
    try {
      var v = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (k) { return typeof k === 'string'; }).slice(0, RECENT_MAX) : [];
    } catch (err) { return []; }
  }

  var recentMemory = null;
  function recents() { return recentMemory || (recentMemory = readRecent()); }

  function remember(key) {
    var list = recents().filter(function (k) { return k !== key; });
    list.unshift(key);
    recentMemory = list.slice(0, RECENT_MAX);
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentMemory)); } catch (err) { /* kept for this session */ }
  }

  /* ================================================================ the rows */

  function groupLabel(g) {
    var key = 'group.' + g;
    return ns.i18n.has(key) ? t(key) : g;
  }

  function commandItems() {
    var C = ns.commands;
    if (!C) return [];
    var ctx = { source: 'palette' };
    return C.all().filter(function (cmd) {
      return cmd.showInPalette !== false && cmd.id !== 'palette.open';
    }).map(function (cmd) {
      var help = cmd.help && ns.i18n.has(cmd.help) ? t(cmd.help) : '';
      var checked = C.checked(cmd, ctx);
      return {
        key: 'c:' + cmd.id, kind: 'command', id: cmd.id,
        label: C.title(cmd.id, ctx), icon: cmd.icon || 'command',
        group: groupLabel(cmd.group), meta: groupLabel(cmd.group),
        keywords: [cmd.keywords || '', help, cmd.id].join(' '),
        keys: cmd.keys && cmd.keys.length ? C.keysLabel(cmd.keys) : '',
        checked: checked, enabled: C.enabled(cmd, ctx)
      };
    });
  }

  function placeItems() {
    var store = S();
    if (!store) return [];
    var here = store.here();
    var out = [];
    store.projects().forEach(function (p) {
      out.push({
        key: 'p:' + p.id, kind: 'project', pid: p.id, label: p.name, icon: p.isTemplate ? 'template' : 'project',
        group: t('palette.goto'), meta: ns.i18n.plural('palette.projectMeta', p.maps.length), keywords: p.description || '', enabled: true
      });
      p.maps.forEach(function (m) {
        var open = here.projectId === p.id && here.mapId === m.id;
        out.push({
          key: 'm:' + p.id + ':' + m.id, kind: 'map', pid: p.id, mid: m.id, label: m.name, icon: 'map',
          group: t('palette.goto'), meta: p.name + (open ? ', ' + t('palette.open') : ''), keywords: t('palette.map'), enabled: true
        });
      });
    });
    return out;
  }

  /* Each map's nodes, worked out once per version of its text (the store
   * hands out a new map object whenever the text changes). */
  var nodeCache = new WeakMap();
  function nodesOf(p, m) {
    var cached = nodeCache.get(m);
    if (cached) return cached;
    var list = [];
    try {
      var state = ns.doc.parse(m.text);
      state.flat.forEach(function (e) {
        var text = ns.doc.plainText(e);
        if (!text) return;
        var crumb = ns.doc.breadcrumb(state, e);
        list.push({ path: e.path, text: text, crumb: crumb });
      });
    } catch (err) { list = []; }
    nodeCache.set(m, list);
    return list;
  }

  /* Where a node is, for a list of nodes from every map: the map's name,
   * then the path under it - without the root when it only repeats the
   * map's name, as a map's root usually does. */
  function whereIn(m, n) {
    var crumb = n.crumb || '';
    if (crumb === m.name) crumb = '';
    else if (crumb.indexOf(m.name + ' / ') === 0) crumb = crumb.slice(m.name.length + 3);
    return crumb ? m.name + ' / ' + crumb : m.name;
  }

  function nodeItems(scope) {
    var store = S();
    if (!store) return [];
    var here = store.here();
    var out = [];
    function add(p, m) {
      var open = here.projectId === p.id && here.mapId === m.id;
      nodesOf(p, m).forEach(function (n) {
        out.push({
          key: 'n:' + p.id + ':' + m.id + ':' + n.path, kind: 'node', pid: p.id, mid: m.id, path: n.path,
          label: n.text, icon: 'tag', group: open ? t('palette.nodesHere') : t('palette.nodesAll'),
          meta: scope === 'all' ? whereIn(m, n) : n.crumb,
          keywords: '', enabled: true, here: open
        });
      });
    }
    if (scope === 'all') {
      store.projects().forEach(function (p) { p.maps.forEach(function (m) { add(p, m); }); });
    } else if (here.mapId) {
      add(store.project(here.projectId), store.map(here.projectId, here.mapId));
    }
    return out;
  }

  /* ================================================================ the dialog */

  var st = null;   // the open palette

  function open(opts) {
    opts = opts || {};
    if (st) { setMode(opts.mode || 'all', opts.query); return st; }
    var prev = document.activeElement;
    var input = h('input', {
      class: 'palette__input', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
      autocapitalize: 'off', enterkeyhint: 'go', 'aria-expanded': 'true', 'aria-autocomplete': 'list'
    });
    var listId = util.uid('pal');
    var list = h('div', { class: 'palette__list', id: listId, role: 'listbox' });
    input.setAttribute('aria-controls', listId);
    var count = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
    var seg = h('div', { class: 'seg palette__scope', role: 'radiogroup' });
    var bar = h('div', { class: 'palette__bar', hidden: true }, seg, h('span', { class: 'palette__hint', text: t('palette.scopeHint') }));
    /* What is said when nothing matches sits beside the list, not in it: a
     * listbox holds options only. */
    var notes = h('div', { class: 'palette__notes' });
    var dlg = h('dialog', { class: 'palette', 'data-modal': '', 'aria-label': t('palette.label') }, input, bar, list, notes, count);
    st = {
      dlg: dlg, input: input, list: list, notes: notes, seg: seg, bar: bar, count: count, prev: prev,
      mode: 'all', scope: 'map', items: [], active: -1, words: [], release: null, popEsc: null
    };
    [['map', 'palette.scopeMap'], ['all', 'palette.scopeAll']].forEach(function (pair) {
      var b = h('button', { type: 'button', class: 'seg__opt', role: 'radio', tabindex: '-1', 'data-value': pair[0], text: t(pair[1]) });
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { setScope(pair[0]); input.focus(); });
      seg.appendChild(b);
    });
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('pointermove', onHover);
    list.addEventListener('click', onPick);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('close', function () { if (st && st.dlg === dlg) close(); });

    ui().closeTransient();
    (document.getElementById('layers') || document.body).appendChild(dlg);
    st.release = ns.commands && ns.commands.standDown ? ns.commands.standDown() : null;
    dlg.showModal();
    st.popEsc = ui().escape.push(function () { close(); });
    input.focus();
    setMode(opts.mode || 'all', opts.query);
    return st;
  }

  function close(opts) {
    var s = st;
    if (!s) return;
    st = null;
    if (s.popEsc) s.popEsc();
    if (s.release) s.release();
    try { s.dlg.close(); } catch (err) { /* already closed */ }
    s.dlg.remove();
    if (!(opts && opts.keepFocus) && s.prev && s.prev.isConnected && typeof s.prev.focus === 'function') {
      try { s.prev.focus({ preventScroll: true }); } catch (err) { /* gone */ }
    }
  }

  function setMode(mode, query) {
    st.mode = mode === 'nodes' ? 'nodes' : 'all';
    if (st.mode === 'nodes') {
      var here = S() ? S().here() : {};
      if (!here.mapId) st.scope = 'all';
    }
    st.input.value = query != null ? String(query) : '';
    relabel();
    refresh();
    st.input.select();
  }

  function setScope(scope) {
    if (!st) return;
    st.scope = scope === 'all' ? 'all' : 'map';
    relabel();
    refresh();
  }

  function relabel() {
    var nodes = effectiveMode() === 'nodes';
    st.input.placeholder = nodes ? t('palette.placeholderNodes') : t('palette.placeholder');
    st.input.setAttribute('aria-label', nodes ? t('palette.labelNodes') : t('palette.label'));
    st.dlg.setAttribute('aria-label', nodes ? t('palette.labelNodes') : t('palette.label'));
    st.list.setAttribute('aria-label', t('palette.results'));
    st.seg.setAttribute('aria-label', t('palette.scope'));
    st.bar.hidden = !nodes;
    Array.prototype.forEach.call(st.seg.children, function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-value') === st.scope));
      b.textContent = t(b.getAttribute('data-value') === 'map' ? 'palette.scopeMap' : 'palette.scopeAll');
    });
  }

  /* '#' at the start searches nodes, '>' commands only. */
  function parseQuery() {
    var raw = st.input.value;
    var trimmed = raw.replace(/^\s+/, '');
    if (trimmed[0] === '#') return { mode: 'nodes', text: trimmed.slice(1) };
    if (trimmed[0] === '>') return { mode: 'commands', text: trimmed.slice(1) };
    return { mode: st.mode, text: raw };
  }

  function effectiveMode() { return parseQuery().mode === 'nodes' ? 'nodes' : st.mode; }

  function onInput() { relabel(); refresh(); }

  /* ================================================================ results */

  function refresh() {
    var q = parseQuery();
    var words = fold(q.text).split(/\s+/).filter(Boolean);
    st.words = words;
    var groups = [];
    if (q.mode === 'nodes') {
      groups = nodeResults(words);
    } else if (!words.length) {
      groups = emptyResults(q.mode === 'commands');
    } else {
      var pool = commandItems();
      if (q.mode !== 'commands') {
        pool = pool.concat(placeItems());
        /* Nodes of every map, the open one's first (score). */
        if (words.join('').length >= 2) pool = pool.concat(nodeItems('all'));
      }
      groups = [{ label: null, items: rank(pool, words, q.mode !== 'commands') }];
    }
    paint(groups, q);
  }

  /* Ranked, recent ones nudged up, disabled commands last; at most a few
   * nodes of the open map among commands and places. */
  function rank(pool, words, capNodes) {
    var rec = recents();
    var scored = [];
    pool.forEach(function (item, i) {
      var s = score(item, words);
      if (s < 0) return;
      var r = rec.indexOf(item.key);
      if (r >= 0) s += 30 - r * 3;
      if (!item.enabled) s -= 1000;
      scored.push({ item: item, s: s, i: i });
    });
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var out = [];
    var nodes = 0;
    for (var k = 0; k < scored.length && out.length < MAX; k++) {
      if (capNodes && scored[k].item.kind === 'node' && ++nodes > IN_MAP_ALL) continue;
      out.push(scored[k].item);
    }
    return out;
  }

  function emptyResults(commandsOnly) {
    var all = commandItems().concat(commandsOnly ? [] : placeItems());
    var byKey = {};
    all.forEach(function (it) { byKey[it.key] = it; });
    var recent = [];
    if (!commandsOnly) {
      recents().forEach(function (k) {
        var it = byKey[k] || recentNode(k);
        if (it && it.enabled) recent.push(it);
      });
    }
    var seen = new Set(recent.map(function (it) { return it.key; }));
    var cmds = commandItems().filter(function (it) { return it.enabled && !seen.has(it.key); });
    var groups = [];
    if (recent.length) groups.push({ label: t('palette.recent'), items: recent });
    groups.push({ label: t('palette.commands'), items: cmds.slice(0, MAX - recent.length) });
    return groups;
  }

  /* A node remembered by map and path is offered again only while that
   * path still holds the same words. */
  function recentNode(key) {
    var m = /^n:([^:]+):([^:]+):(.*)$/.exec(key);
    if (!m) return null;
    var store = S();
    var p = store.project(m[1]);
    var map = p && store.map(m[1], m[2]);
    if (!map) return null;
    var hit = nodesOf(p, map).filter(function (n) { return n.path === m[3]; })[0];
    if (!hit) return null;
    return { key: key, kind: 'node', pid: p.id, mid: map.id, path: hit.path, label: hit.text, icon: 'tag', group: t('palette.nodesAll'), meta: map.name, keywords: '', enabled: true };
  }

  function nodeResults(words) {
    var store = S();
    var here = store ? store.here() : {};
    if (st.scope === 'map' && !here.mapId) return [{ label: null, items: [], note: t('palette.noMap') }];
    var pool = nodeItems(st.scope);
    if (!pool.length) return [{ label: null, items: [], note: t('palette.emptyMap') }];
    if (!words.length) return [{ label: st.scope === 'all' ? t('palette.nodesAll') : t('palette.nodesHere'), items: pool.slice(0, MAX) }];
    var found = rank(pool, words, false);
    /* Nothing here: say where else to look, rather than only 'nothing'. */
    if (!found.length && st.scope === 'map') return [{ label: null, items: [], note: t('palette.noneHere', { q: words.join(' ') }) }];
    return [{ label: null, items: found }];
  }

  function paint(groups, q) {
    var list = st.list;
    list.textContent = '';
    st.notes.textContent = '';
    st.items = [];
    var n = 0;
    groups.forEach(function (g, gi) {
      if (!g.items.length) {
        if (g.note) st.notes.appendChild(h('p', { class: 'palette__empty', text: g.note }));
        return;
      }
      var box = list;
      if (g.label) {
        var hid = st.list.id + '-g' + gi;
        box = h('div', { role: 'group', 'aria-labelledby': hid });
        box.appendChild(h('div', { class: 'palette__group', id: hid, role: 'presentation', text: g.label }));
        list.appendChild(box);
      }
      g.items.forEach(function (item) {
        var id = st.list.id + '-o' + (n++);
        item.el = optionEl(item, id);
        st.items.push(item);
        box.appendChild(item.el);
      });
    });
    if (!st.items.length && !st.notes.firstChild) {
      var text = q.text.trim();
      st.notes.appendChild(h('p', { class: 'palette__empty', text: text ? t(q.mode === 'commands' ? 'palette.noneCommand' : 'palette.none', { q: text }) : t('palette.none', { q: '' }) }));
    }
    st.count.textContent = ns.i18n.plural('palette.count', st.items.length);
    var first = st.items.findIndex(function (it) { return it.enabled; });
    setActive(first >= 0 ? first : (st.items.length ? 0 : -1));
  }

  function optionEl(item, id) {
    var labelBox = h('span', { class: 'palette__label' }, highlight(item.label, st.words));
    var main = h('span', { class: 'palette__main' }, labelBox);
    if (item.meta && (item.kind !== 'command')) main.appendChild(h('span', { class: 'palette__sub', text: item.meta }));
    var end = h('span', { class: 'palette__meta' });
    if (item.kind === 'command') {
      if (!item.enabled) end.appendChild(h('span', { class: 'palette__state', text: t('palette.unavailable') }));
      else if (item.keys) end.appendChild(h('kbd', { class: 'kbd', text: item.keys }));
      else end.appendChild(h('span', { text: item.meta }));
    } else if (item.kind === 'project' || item.kind === 'map') {
      end.appendChild(h('span', { text: item.kind === 'project' ? t('palette.project') : t('palette.map') }));
    }
    var el = h('div', {
      class: ['palette__item', 'palette__item--' + item.kind],
      id: id, role: 'option', 'aria-selected': 'false',
      'aria-disabled': item.enabled ? null : 'true',
      'aria-checked': item.checked === undefined || item.checked === null ? null : String(!!item.checked),
      'data-key': item.key
    }, ui().icon(item.icon || 'command'), main, end);
    return el;
  }

  function setActive(i) {
    if (!st) return;
    if (st.active >= 0 && st.items[st.active]) st.items[st.active].el.setAttribute('aria-selected', 'false');
    st.active = i;
    var item = st.items[i];
    if (!item) { st.input.removeAttribute('aria-activedescendant'); return; }
    item.el.setAttribute('aria-selected', 'true');
    st.input.setAttribute('aria-activedescendant', item.el.id);
    keepInView(item.el);
  }

  function keepInView(el) {
    var box = st.list;
    var top = el.offsetTop;
    var bottom = top + el.offsetHeight;
    if (top < box.scrollTop + 4) box.scrollTop = Math.max(0, top - 28);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 4;
  }

  function move(delta, wrap) {
    var n = st.items.length;
    if (!n) return;
    var i = st.active < 0 ? (delta > 0 ? -1 : n) : st.active;
    var j = i + delta;
    if (wrap) j = ((j % n) + n) % n;
    else j = Math.max(0, Math.min(n - 1, j));
    setActive(j);
  }

  /* ================================================================ keys and pointer */

  function onKey(event) {
    if (event.isComposing) return;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1, true); break;
      case 'ArrowUp': event.preventDefault(); move(-1, true); break;
      case 'PageDown': event.preventDefault(); move(PAGE, false); break;
      case 'PageUp': event.preventDefault(); move(-PAGE, false); break;
      case 'Enter':
        event.preventDefault();
        if (st.items[st.active]) choose(st.items[st.active]);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        event.preventDefault();
        if (effectiveMode() === 'nodes') setScope(st.scope === 'map' ? 'all' : 'map');
        break;
      default:
        /* Mod+K again closes; Mod+F switches to the nodes. */
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          var k = event.key.toLowerCase();
          if (k === 'k') { event.preventDefault(); close(); }
          else if (k === 'f') { event.preventDefault(); setMode(st.mode === 'nodes' ? 'all' : 'nodes', st.input.value.replace(/^\s*[#>]/, '')); }
        }
    }
  }

  function onHover(event) {
    if (event.pointerType !== 'mouse') return;
    var el = event.target.closest('.palette__item');
    if (!el) return;
    var i = st.items.findIndex(function (it) { return it.el === el; });
    if (i >= 0 && i !== st.active) setActive(i);
  }

  function onPick(event) {
    var el = event.target.closest('.palette__item');
    if (!el || !st) return;
    var item = st.items.filter(function (it) { return it.el === el; })[0];
    if (item) choose(item);
  }

  /* ================================================================ choosing */

  function choose(item) {
    if (!item || !item.enabled) return;
    remember(item.key);
    if (item.kind === 'command') {
      close();
      ns.commands.run(item.id, { source: 'palette' });
      return;
    }
    close({ keepFocus: item.kind === 'node' });
    var store = S();
    if (item.kind === 'project') {
      store.setActive(item.pid);
      if (ns.sidebar && ns.sidebar.setExpanded) ns.sidebar.setExpanded(item.pid, true);
    } else if (item.kind === 'map') {
      goTo(item.pid, item.mid, undefined);
    } else if (item.kind === 'node') {
      goTo(item.pid, item.mid, item.path);
    }
  }

  /* Opens the map and selects the node there; the map keeps the focus, so
   * the next key acts on the node. */
  function goTo(pid, mid, path) {
    var s = ns.session;
    var opts = path === undefined ? {} : { select: path };
    var done;
    if (s && typeof s.open === 'function') done = s.open(pid, mid, opts);
    else { S().setActive(pid, mid); done = Promise.resolve(true); }
    if (path === undefined) return done;
    return Promise.resolve(done).then(function () {
      if (s && typeof s.select === 'function' && s.selected() !== path) s.select(path, { reveal: true });
      var view = s && s.view;
      /* Found is seen: on a map fitted small the node comes in at a size
       * that can be read. */
      if (view && typeof view.ensureVisible === 'function' && s.selected() === path) view.ensureVisible(path, { read: true });
      var el = view && view.el;
      if (el) { try { el.focus({ preventScroll: true }); } catch (err) { /* fine */ } }
    });
  }

  /* ================================================================ init */

  function init() {
    if (!ns.commands) return;
    ns.commands.register({
      id: 'palette.open', label: 'palette.cmd.open', group: 'navigate', icon: 'command',
      keys: [{ key: 'Mod+K', global: true }], keywords: t('palette.kw.open'), help: 'palette.help.open',
      when: function () { return !viewOnly(); },
      run: function () { if (st) close(); else open({ mode: 'all' }); }
    });
    ns.commands.register({
      id: 'search.nodes', label: 'palette.cmd.nodes', group: 'navigate', icon: 'search',
      keys: ['Mod+F'], keywords: t('palette.kw.nodes'), help: 'palette.help.nodes',
      when: function () { return !viewOnly() && !!S() && S().projects().length > 0; },
      run: function () { open({ mode: 'nodes' }); }
    });
    ns.bus.on('lang', function () { if (st) { relabel(); refresh(); } });
  }

  ns.palette = {
    init: init,
    open: open,
    close: close,
    isOpen: function isOpen() { return !!st; },
    fold: fold,
    score: score,
    /* For tests: what the list holds now. */
    items: function items() {
      return st ? st.items.map(function (it) { return { key: it.key, kind: it.kind, label: it.label, enabled: it.enabled }; }) : [];
    },
    active: function active() { return st && st.items[st.active] ? st.items[st.active].key : null; }
  };
})(window.MindRoot);
