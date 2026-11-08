/* MindRoot - the trash of a project: look, find, put back, let go.
 *
 * What lands in it is the store's business (a branch deleted on the map, a
 * picture taken off a node, files sent from the images panel, a deleted
 * map with its copies, a deleted copy); this is the sheet that shows it.
 * Every row says what the thing was, where it came from and when, with a
 * preview (the lines under a branch or a map, the picture itself) that a
 * press opens wide. A notebook (a .book folder) is one row, its pages
 * counted, and goes back whole.
 *
 * Choosing: a checkbox per row, Shift for a range from the last row chosen,
 * Ctrl/Cmd+A for every row the search shows, one box that chooses all or
 * none (and shows "some"). The bar with the bulk actions is always there,
 * so choosing the first row never pushes the list down under the pointer.
 * The choice only ever holds rows that can be seen: a search drops the rest.
 *
 * Putting back is never asked about: one row or many, it is one step of
 * undo, newest first (a node deleted before its parent goes back inside
 * it), and the toast says honestly how it went - back in place, under a
 * parent that had moved, at the end of the map because its place was gone,
 * only the file, in a map of its own, or not at all when its bytes were
 * never kept. The map it went into opens with the node chosen. Deleting
 * for good is a second press within three seconds; emptying the trash asks
 * first. Both are still undoable while the page is open, and say so.
 *
 * Escape unwinds in three steps: the search, then the choice, then the
 * sheet. The sheet repaints on every store change while it is open (which
 * also disarms a pending second press) and closes itself if its project
 * goes away. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  var ARM_MS = 3000;
  var PREVIEW_MAX = 240;

  ns.i18n.add({
    en: {
      'trash.title': 'Trash of {project}',
      'trash.search': 'Search the trash',
      'trash.chooseAll': 'Choose all',
      'trash.chosen.one': '{n} chosen',
      'trash.chosen.other': '{n} chosen',
      'trash.chooseNone': 'Choose none',
      'trash.choose': 'Choose {name}',
      'trash.putBack': 'Put back',
      'trash.putBackN': 'Put back ({n})',
      'trash.putBackNamed': 'Put back {name}',
      'trash.purgeNamed': 'Delete {name} for good',
      'trash.purge': 'Delete for good',
      'trash.purgeN': 'Delete for good ({n})',
      'trash.sure': 'Sure? Press again',
      'trash.sureN.one': 'Sure? Delete {n} for good',
      'trash.sureN.other': 'Sure? Delete {n} for good',
      'trash.armHint': 'Press again within 3 seconds to delete it for good',
      'trash.empty': 'Empty the trash',
      'trash.total.one': '{n} item',
      'trash.total.other': '{n} items',
      'trash.hint': 'Nothing here is gone until you say so. Put back returns each thing where it was.',
      'trash.nothing': 'The trash of {project} is empty. A deleted branch lands here, and so do a picture or a drawing taken off a node, a deleted note, a file sent from the images panel, a deleted map and a deleted copy.',
      'trash.noMatch': 'Nothing in the trash matches "{q}".',
      'trash.untitled': '(untitled)',
      'trash.kind.branch': 'Branch',
      'trash.kind.figure': 'Picture',
      'trash.kind.asset': 'File',
      'trash.kind.map': 'Map',
      'trash.kind.snapshot': 'Copy',
      'trash.kind.book': 'Notebook',
      'trash.kind.note': 'Note',
      'trash.meta.note': 'Note that was on {owner} in {map}, {when}',
      'trash.meta.edgeNote': 'Note on the link to {owner} in {map}, {when}',
      'trash.back.top.note': '"{name}": the node it was on is gone, so it is a note of the root.',
      'trash.meta.branch': 'Branch from {map}, {when}',
      'trash.meta.figure': 'Picture that was on {owner} in {map}, {when}',
      'trash.meta.figureNoOwner': 'Picture from {map}, {when}',
      'trash.meta.asset': 'File {path}, {when}',
      'trash.meta.assetOwner': 'File that was on {owner}, {when}',
      'trash.meta.book.one': 'Notebook of {n} page, {when}',
      'trash.meta.book.other': 'Notebook of {n} pages, {when}',
      'trash.meta.bookOwner.one': 'Notebook of {n} page that was on {owner}, {when}',
      'trash.meta.bookOwner.other': 'Notebook of {n} pages that was on {owner}, {when}',
      'trash.meta.map.zero': 'Map with no copies, {when}',
      'trash.meta.map.one': 'Map with {n} copy, {when}',
      'trash.meta.map.other': 'Map with {n} copies, {when}',
      'trash.meta.snapshot': 'Copy of {map} from {taken}, {when}',
      'trash.deletedAt': 'Deleted {when}',
      'trash.showMore': 'Show all of it',
      'trash.back.same': '"{name}" is back where it was.',
      'trash.back.moved': '"{name}" is back under the node it hung from, which had moved.',
      'trash.back.top': '"{name}": its place was gone, so it is at the end of the map.',
      'trash.back.files': '"{name}": the file is back in assets/; the node it was on is gone.',
      'trash.back.newMap': '"{name}": its map was gone, so it is back in a map of its own.',
      'trash.back.gone': '"{name}" could not come back: its bytes were never kept.',
      'trash.backMany.one': '{n} thing put back.',
      'trash.backMany.other': '{n} things put back.',
      'trash.backLost': 'Some had lost their place and went to the end of their map.',
      'trash.backGone.one': '{n} could not come back: its bytes were never kept.',
      'trash.backGone.other': '{n} could not come back: their bytes were never kept.',
      'trash.purged': 'Deleted for good: {name}. Undo still brings it back while this page is open.',
      'trash.purgedMany.one': '{n} thing deleted for good. Undo still brings it back while this page is open.',
      'trash.purgedMany.other': '{n} things deleted for good. Undo still brings them back while this page is open.',
      'trash.emptied': 'The trash is empty. Undo still brings it all back while this page is open.',
      'trash.confirm.title': 'Empty the trash of {project}?',
      'trash.confirm.text.one': 'The {n} thing in it goes for good. Undo still brings it back while this page is open; after that, nothing does.',
      'trash.confirm.text.other': 'The {n} things in it go for good. Undo still brings them back while this page is open; after that, nothing does.',
      'trash.confirm.ok': 'Empty it',
      'trash.readOnly': 'This tab only shows the trash: another tab keeps your maps.',
      'trash.cmd.open': 'Open the trash',
      'trash.help.open': 'What was deleted in this project, ready to go back where it was.',
      'trash.kw.open': 'trash bin restore deleted recycle',
      'trash.label.list': 'Things in the trash'
    },
    it: {
      'trash.title': 'Cestino di {project}',
      'trash.search': 'Cerca nel cestino',
      'trash.chooseAll': 'Scegli tutto',
      'trash.chosen.one': '{n} scelto',
      'trash.chosen.other': '{n} scelti',
      'trash.chooseNone': 'Non sceglierne nessuno',
      'trash.choose': 'Scegli {name}',
      'trash.putBack': 'Rimetti a posto',
      'trash.putBackN': 'Rimetti a posto ({n})',
      'trash.putBackNamed': 'Rimetti a posto {name}',
      'trash.purgeNamed': 'Elimina {name} per sempre',
      'trash.purge': 'Elimina per sempre',
      'trash.purgeN': 'Elimina per sempre ({n})',
      'trash.sure': 'Sicuro? Premi di nuovo',
      'trash.sureN.one': 'Sicuro? Elimina {n} per sempre',
      'trash.sureN.other': 'Sicuro? Elimina {n} per sempre',
      'trash.armHint': 'Premi di nuovo entro 3 secondi per eliminarlo per sempre',
      'trash.empty': 'Svuota il cestino',
      'trash.total.one': '{n} elemento',
      'trash.total.other': '{n} elementi',
      'trash.hint': 'Qui niente è perso finché non lo dici tu. Rimetti a posto riporta ogni cosa dov\'era.',
      'trash.nothing': 'Il cestino di {project} è vuoto. Qui arrivano i rami eliminati, le immagini e i disegni tolti da un nodo, le note eliminate, i file mandati dal pannello delle immagini, le mappe e le copie eliminate.',
      'trash.noMatch': 'Niente nel cestino corrisponde a "{q}".',
      'trash.untitled': '(senza titolo)',
      'trash.kind.branch': 'Ramo',
      'trash.kind.figure': 'Immagine',
      'trash.kind.asset': 'File',
      'trash.kind.map': 'Mappa',
      'trash.kind.snapshot': 'Copia',
      'trash.kind.book': 'Quaderno',
      'trash.kind.note': 'Nota',
      'trash.meta.note': 'Nota che era su {owner} in {map}, {when}',
      'trash.meta.edgeNote': "Nota sull'arco verso {owner} in {map}, {when}",
      'trash.back.top.note': '"{name}": il nodo su cui stava non c\'è più, quindi è una nota della radice.',
      'trash.meta.branch': 'Ramo da {map}, {when}',
      'trash.meta.figure': 'Immagine che era su {owner} in {map}, {when}',
      'trash.meta.figureNoOwner': 'Immagine da {map}, {when}',
      'trash.meta.asset': 'File {path}, {when}',
      'trash.meta.assetOwner': 'File che era su {owner}, {when}',
      'trash.meta.book.one': 'Quaderno di {n} pagina, {when}',
      'trash.meta.book.other': 'Quaderno di {n} pagine, {when}',
      'trash.meta.bookOwner.one': 'Quaderno di {n} pagina che era su {owner}, {when}',
      'trash.meta.bookOwner.other': 'Quaderno di {n} pagine che era su {owner}, {when}',
      'trash.meta.map.zero': 'Mappa senza copie, {when}',
      'trash.meta.map.one': 'Mappa con {n} copia, {when}',
      'trash.meta.map.other': 'Mappa con {n} copie, {when}',
      'trash.meta.snapshot': 'Copia di {map} del {taken}, {when}',
      'trash.deletedAt': 'Eliminato {when}',
      'trash.showMore': 'Mostra tutto',
      'trash.back.same': '"{name}" è di nuovo dov\'era.',
      'trash.back.moved': '"{name}" è di nuovo sotto il nodo da cui pendeva, che si era spostato.',
      'trash.back.top': '"{name}": il suo posto non c\'era più, quindi è in fondo alla mappa.',
      'trash.back.files': '"{name}": il file è di nuovo in assets/; il nodo su cui stava non c\'è più.',
      'trash.back.newMap': '"{name}": la sua mappa non c\'era più, quindi è tornato in una mappa tutta sua.',
      'trash.back.gone': '"{name}" non è potuto tornare: i suoi byte non erano mai stati conservati.',
      'trash.backMany.one': '{n} cosa rimessa a posto.',
      'trash.backMany.other': '{n} cose rimesse a posto.',
      'trash.backLost': 'Alcune avevano perso il loro posto e sono finite in fondo alla mappa.',
      'trash.backGone.one': '{n} non è potuta tornare: i suoi byte non erano mai stati conservati.',
      'trash.backGone.other': '{n} non sono potute tornare: i loro byte non erano mai stati conservati.',
      'trash.purged': 'Eliminato per sempre: {name}. Finché questa pagina resta aperta, Annulla lo riporta ancora.',
      'trash.purgedMany.one': '{n} cosa eliminata per sempre. Finché questa pagina resta aperta, Annulla la riporta ancora.',
      'trash.purgedMany.other': '{n} cose eliminate per sempre. Finché questa pagina resta aperta, Annulla le riporta ancora.',
      'trash.emptied': 'Il cestino è vuoto. Finché questa pagina resta aperta, Annulla riporta ancora tutto.',
      'trash.confirm.title': 'Svuotare il cestino di {project}?',
      'trash.confirm.text.one': 'L\'unica cosa che contiene se ne va per sempre. Finché questa pagina resta aperta, Annulla la riporta ancora; dopo, niente.',
      'trash.confirm.text.other': 'Le {n} cose che contiene se ne vanno per sempre. Finché questa pagina resta aperta, Annulla le riporta ancora; dopo, niente.',
      'trash.confirm.ok': 'Svuota',
      'trash.readOnly': "Questa scheda mostra soltanto il cestino: le mappe le conserva un'altra scheda.",
      'trash.cmd.open': 'Apri il cestino',
      'trash.help.open': 'Quello che è stato eliminato in questo progetto, pronto a tornare dov\'era.',
      'trash.kw.open': 'trash bin restore deleted recycle cestino ripristina eliminati recupera',
      'trash.label.list': 'Cose nel cestino'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function plural(key, n, vars) { return ns.i18n.plural(key, n, vars); }
  function S() { return ns.store; }
  function ui() { return ns.ui; }

  var ICONS = { branch: 'child', figure: 'image', asset: 'image', map: 'map', snapshot: 'history', note: 'note' };

  /* The open sheet, or null. */
  var cur = null;

  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }
  function editable() { return !!S() && !S().readOnly() && !viewOnly(); }

  function fold(s) { return String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase(); }

  /* ================================================================ what a row says */

  function mapName(p, id, fallback) {
    var m = id && S().map(p.id, id);
    return m ? m.name : (fallback || t('trash.untitled'));
  }

  function nameOf(entry) {
    return entry.label || t('trash.untitled');
  }

  function whenText(ms) { return util.relativeTime(ms); }

  /* A notebook binned whole (store: a picture or file entry that carries
   * the other files of its .book folder): its pages, counted. */
  var PAGE_RE = /\.(?:ink|excalidraw)\.svg$/i;
  function bookPages(entry) {
    if (!(entry.kind === 'figure' || entry.kind === 'asset') || !entry.files || !/\.book\/[^/]+$/.test(entry.path || '')) return 0;
    return [entry.path].concat(Object.keys(entry.files)).filter(function (path) { return PAGE_RE.test(path); }).length || 1;
  }

  function kindName(entry) {
    return t(bookPages(entry) ? 'trash.kind.book' : 'trash.kind.' + entry.kind);
  }

  function metaOf(p, entry) {
    var when = whenText(entry.deletedAt);
    var pages = bookPages(entry);
    if (pages) {
      return entry.owner ? plural('trash.meta.bookOwner', pages, { owner: entry.owner, when: when })
        : plural('trash.meta.book', pages, { when: when });
    }
    switch (entry.kind) {
      case 'branch': return t('trash.meta.branch', { map: mapName(p, entry.mapId, entry.mapName), when: when });
      case 'figure':
        return entry.owner
          ? t('trash.meta.figure', { owner: entry.owner, map: mapName(p, entry.mapId, entry.mapName), when: when })
          : t('trash.meta.figureNoOwner', { map: mapName(p, entry.mapId, entry.mapName), when: when });
      case 'asset':
        return entry.owner ? t('trash.meta.assetOwner', { owner: entry.owner, when: when }) : t('trash.meta.asset', { path: entry.path || '', when: when });
      case 'note':
        return t(entry.noteKind === 'edge' ? 'trash.meta.edgeNote' : 'trash.meta.note', {
          owner: entry.owner || t('trash.untitled'), map: mapName(p, entry.mapId, entry.mapName), when: when
        });
      case 'map': return plural('trash.meta.map', (entry.snapshots || []).length, { when: when });
      case 'snapshot':
        return t('trash.meta.snapshot', {
          map: mapName(p, entry.snapshot && entry.snapshot.mapId, entry.mapName),
          taken: util.formatDate(entry.snapshot ? entry.snapshot.when : entry.deletedAt, 'datetime'),
          when: when
        });
      default: return when;
    }
  }

  /* The words under a branch, a map or a copy, without the Markdown that
   * spells them: the first line is left out, the name already says it. */
  var STRIP = [/<!--[\s\S]*?-->/g, /!\[[^\]]*\]\([^)]*\)/g];
  function preview(entry) {
    var text = entry.kind === 'branch' ? entry.fragment && entry.fragment.text
      : entry.kind === 'map' ? entry.map && entry.map.text
        : entry.kind === 'snapshot' ? entry.snapshot && entry.snapshot.text : '';
    /* A note is its words: the name shows the first of them, the rest
     * here (a short note has nothing more to show). */
    if (entry.kind === 'note') {
      var words = String(entry.text || '').replace(/\s+/g, ' ').trim();
      return words.length > (entry.label || '').length ? (words.length > PREVIEW_MAX * 4 ? words.slice(0, PREVIEW_MAX * 4) + '…' : words) : '';
    }
    if (!text) return '';
    STRIP.forEach(function (re) { text = text.replace(re, ''); });
    var lines = text.split('\n').map(function (line) {
      return line.replace(/^\s*(#{1,6}|[-*+]|\d{1,9}[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s+/, '')
        .replace(/^>\s*(note|edge|text|nota|arco)\s*:\s*/i, '')
        .replace(/[*_~=`]+/g, '')
        .trim();
    }).filter(Boolean);
    lines.shift();
    var out = lines.join(' · ');
    return out.length > PREVIEW_MAX * 4 ? out.slice(0, PREVIEW_MAX * 4) + '…' : out;
  }

  /* ================================================================ the sheet */

  /* Where the focus starts: the search field for a keyboard, the sheet
   * itself for a finger - a tap is a user gesture, and a focused field
   * there raises the phone's keyboard over half a sheet that was opened
   * to be read. */
  function typing(ctx) {
    return !util.isTouch || !!(ctx && ctx.source === 'key');
  }

  function open(pid, ctx) {
    var store = S();
    if (!store) return null;
    pid = pid || store.here().projectId;
    var p = pid && store.project(pid);
    if (!p) return null;
    if (cur && cur.pid === pid && cur.sheet.isOpen()) {
      if (typing(ctx)) cur.search.focus();
      return cur;
    }
    if (cur) cur.sheet.close('replaced');
    var c = {
      pid: pid, query: '', chosen: new Set(), anchor: null, armed: null, bulkArmed: false,
      opened: new Set(), thumbs: Object.create(null), visible: []
    };
    c.search = h('input', { class: 'input ws-search', type: 'search', autocomplete: 'off', placeholder: t('trash.search'), 'aria-label': t('trash.search') });
    c.total = h('p', { class: 'ws-hint', 'aria-live': 'polite' });
    c.all = h('input', { type: 'checkbox', class: 'ws-all' });
    c.allLabel = h('span', { text: t('trash.chooseAll') });
    c.restoreBtn = ui().button({ label: t('trash.putBack'), icon: 'restore', kind: 'text', cls: 'ws-bulk__restore' });
    c.purgeBtn = ui().button({ label: t('trash.purge'), icon: 'trash', kind: 'text', cls: 'ws-bulk__purge btn--destructive' });
    c.noneBtn = ui().button({ icon: 'close', label: t('trash.chooseNone'), cls: 'ws-bulk__none' });
    c.bulk = h('div', { class: 'ws-bulk', role: 'group', 'aria-label': t('trash.chooseAll') },
      h('label', { class: 'check ws-bulk__all' }, c.all, c.allLabel),
      h('span', { class: 'ws-bulk__actions' }, c.restoreBtn, c.purgeBtn, c.noneBtn));
    c.list = h('ul', { class: 'ws-list ws-trash__list', 'aria-label': t('trash.label.list') });
    c.note = h('p', { class: 'ws-note' });
    c.emptyBtn = ui().button({ label: t('trash.empty'), icon: 'trash', kind: 'text', cls: 'btn--destructive ws-trash__empty' });
    c.body = h('div', { class: 'ws-panel ws-trash' },
      h('div', { class: 'ws-panel__top' }, c.search, c.total),
      c.bulk, c.list, c.note,
      h('div', { class: 'ws-panel__foot' }, c.emptyBtn));

    c.search.addEventListener('input', function () { c.query = c.search.value; paint(c); });
    c.all.addEventListener('change', function () { chooseAll(c, c.all.checked); });
    c.restoreBtn.addEventListener('click', function () { if (!isOff(c.restoreBtn)) putBack(c, Array.from(c.chosen)); });
    c.purgeBtn.addEventListener('click', function () { if (!isOff(c.purgeBtn)) bulkPurge(c); });
    c.noneBtn.addEventListener('click', function () { c.chosen.clear(); c.anchor = null; paint(c); c.all.focus(); });
    c.emptyBtn.addEventListener('click', function () { if (!isOff(c.emptyBtn)) emptyAll(c); });
    c.list.addEventListener('click', function (event) { onListClick(c, event); });
    c.list.addEventListener('keydown', function (event) { onListKey(c, event); });

    c.sheet = ui().sheet({
      title: t('trash.title', { project: p.name }),
      body: c.body,
      cls: 'ws-sheet ws-sheet--trash',
      desktop: 'side',
      detents: [0.6, 0.92],
      initialFocus: typing(ctx) ? c.search : null,
      onClose: function () {
        disarm(c);
        if (c.off) c.off.forEach(function (off) { off(); });
        if (cur === c) cur = null;
      }
    });
    c.sheet.el.addEventListener('keydown', function (event) { onSheetKey(c, event); });
    c.off = [
      ns.bus.on('store', function (change) {
        if (!change || change.type === 'history:changed' || change.type === 'view') return;
        repaint(c);
      }),
      ns.bus.on('lang', function () { relabel(c); }),
      ns.bus.on('tabs', function () { repaint(c); })
    ];
    cur = c;
    paint(c);
    return c;
  }

  function repaint(c) {
    if (c.frame) return;
    c.frame = requestAnimationFrame(function () {
      c.frame = 0;
      if (!c.sheet.isOpen()) return;
      if (!S().project(c.pid)) { c.sheet.close('gone'); return; }
      disarm(c);
      paint(c);
    });
  }

  function relabel(c) {
    var p = S().project(c.pid);
    if (!p) return;
    c.sheet.setTitle(t('trash.title', { project: p.name }));
    c.search.placeholder = t('trash.search');
    c.search.setAttribute('aria-label', t('trash.search'));
    c.noneBtn.setAttribute('aria-label', t('trash.chooseNone'));
    c.emptyBtn.querySelector('.btn__label').textContent = t('trash.empty');
    c.list.setAttribute('aria-label', t('trash.label.list'));
    paint(c);
  }

  function isOff(btn) { return btn.getAttribute('aria-disabled') === 'true' || btn.disabled; }
  function setOff(btn, off) { if (off) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled'); }

  /* The rows the search lets through, newest first (the store keeps them so). */
  function visibleEntries(c, p) {
    var words = fold(c.query.trim()).split(/\s+/).filter(Boolean);
    return p.trash.filter(function (e) {
      if (!words.length) return true;
      var hay = fold([nameOf(e), metaOf(p, e), preview(e), e.path || ''].join(' '));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  function paint(c) {
    var p = S().project(c.pid);
    if (!p) return;
    var focus = rememberFocus(c);
    var scroll = c.sheet.body.scrollTop;
    var entries = visibleEntries(c, p);
    c.visible = entries.map(function (e) { return e.id; });
    /* The choice holds what can be seen, nothing else. */
    var seen = new Set(c.visible);
    Array.from(c.chosen).forEach(function (id) { if (!seen.has(id)) c.chosen.delete(id); });
    if (c.anchor && !seen.has(c.anchor)) c.anchor = null;

    c.list.textContent = '';
    var w = editable();
    entries.forEach(function (e) { c.list.appendChild(row(c, p, e, w)); });

    var n = p.trash.length;
    c.total.textContent = n ? plural('trash.total', n) + '. ' + t('trash.hint') : '';
    c.total.hidden = !n;
    if (!n) c.note.textContent = t('trash.nothing', { project: p.name });
    else if (!entries.length) c.note.textContent = t('trash.noMatch', { q: c.query.trim() });
    else c.note.textContent = '';
    c.note.hidden = !c.note.textContent;
    if (!w && n) { c.note.textContent = t('trash.readOnly'); c.note.hidden = false; }
    c.search.disabled = !n;
    c.bulk.hidden = !n;
    c.emptyBtn.hidden = !n;
    setOff(c.emptyBtn, !w);
    paintBulk(c);
    c.sheet.body.scrollTop = scroll;
    restoreFocus(c, focus);
    loadThumbs(c, p, entries);
  }

  function row(c, p, e, w) {
    var chosen = c.chosen.has(e.id);
    var name = nameOf(e);
    var box = h('input', { type: 'checkbox', class: 'ws-row__check', checked: chosen, 'aria-label': t('trash.choose', { name: name }), 'data-role': 'check' });
    var pv = preview(e);
    var isPicture = e.kind === 'figure' || e.kind === 'asset';
    var expanded = c.opened.has(e.id);
    var body = null;
    if (isPicture && e.file && e.file.asset) {
      body = h('span', { class: 'ws-thumb', 'data-asset': e.file.asset });
    } else if (pv) {
      body = h('button', { type: 'button', class: 'ws-preview', 'aria-expanded': String(expanded), 'data-role': 'preview', title: expanded ? null : t('trash.showMore') }, pv);
    }
    var restore = ui().button({ label: t('trash.putBack'), icon: 'restore', kind: 'text', cls: 'ws-row__restore' });
    restore.setAttribute('data-role', 'restore');
    restore.setAttribute('aria-label', t('trash.putBackNamed', { name: name }));
    var purge = ui().button({ label: t('trash.purgeNamed', { name: name }), icon: 'trash', cls: 'ws-row__purge btn--destructive' });
    purge.setAttribute('data-role', 'purge');
    purge.setAttribute('data-name', name);
    /* Shown only while armed: the press that would delete says so. */
    purge.appendChild(h('span', { class: 'btn__label', text: t('trash.sure') }));
    if (c.armed === e.id) arm(purge);
    setOff(restore, !w);
    setOff(purge, !w);
    /* The box sits in a label of its own: on a touch screen the label is a
     * finger-sized target around the small native box (workspace.css). */
    var li = h('li', { class: ['ws-row', chosen && 'is-chosen'], 'data-id': e.id, 'data-kind': e.kind },
      h('label', { class: 'ws-row__hit' }, box),
      h('span', { class: 'ws-row__icon', 'data-role': 'toggle', title: kindName(e) }, ui().icon(bookPages(e) ? 'draw' : (ICONS[e.kind] || 'trash'))),
      h('div', { class: 'ws-row__main' },
        h('span', { class: 'ws-row__name', 'data-role': 'toggle', text: name }),
        h('span', { class: 'ws-row__meta', 'data-role': 'toggle', title: t('trash.deletedAt', { when: util.formatDate(e.deletedAt, 'datetime') }), text: metaOf(p, e) }),
        body),
      h('div', { class: 'ws-row__actions' }, restore, purge));
    return li;
  }

  /* Pictures load after the rows are there; a picture whose bytes are gone
   * leaves its place empty rather than a broken icon. */
  function loadThumbs(c, p, entries) {
    if (!ns.storage || typeof ns.storage.blobURL !== 'function') return;
    entries.forEach(function (e) {
      if (!(e.kind === 'figure' || e.kind === 'asset') || !e.file || !e.file.asset) return;
      var id = e.file.asset;
      var slot = c.list.querySelector('.ws-thumb[data-asset="' + CSS.escape(id) + '"]');
      if (!slot) return;
      function put(url) {
        if (!url || !slot.isConnected) return;
        var img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', function () { img.remove(); });
        slot.appendChild(img);
      }
      if (c.thumbs[id] !== undefined) { put(c.thumbs[id]); return; }
      ns.storage.blobURL(id).then(function (url) { c.thumbs[id] = url || null; put(url); }, function () { c.thumbs[id] = null; });
    });
  }

  function paintBulk(c) {
    var n = c.chosen.size;
    var total = c.visible.length;
    c.all.checked = n > 0 && n === total;
    c.all.indeterminate = n > 0 && n < total;
    c.all.disabled = !total;
    c.allLabel.textContent = n ? plural('trash.chosen', n) : t('trash.chooseAll');
    var w = editable();
    c.restoreBtn.querySelector('.btn__label').textContent = n ? t('trash.putBackN', { n: ns.i18n.number(n) }) : t('trash.putBack');
    c.purgeBtn.querySelector('.btn__label').textContent = c.bulkArmed ? plural('trash.sureN', n) : (n ? t('trash.purgeN', { n: ns.i18n.number(n) }) : t('trash.purge'));
    c.purgeBtn.toggleAttribute('data-armed', !!c.bulkArmed);
    setOff(c.restoreBtn, !n || !w);
    setOff(c.purgeBtn, !n || !w);
    c.noneBtn.hidden = !n;
    Array.prototype.forEach.call(c.list.children, function (li) {
      var on = c.chosen.has(li.getAttribute('data-id'));
      li.classList.toggle('is-chosen', on);
      var box = li.querySelector('.ws-row__check');
      if (box) box.checked = on;
    });
  }

  /* Focus survives a repaint: the same control of the same row. */
  function rememberFocus(c) {
    var a = document.activeElement;
    if (!a || !c.list.contains(a)) return null;
    var li = a.closest('.ws-row');
    return li ? { id: li.getAttribute('data-id'), role: a.getAttribute('data-role'), index: Array.prototype.indexOf.call(c.list.children, li) } : null;
  }

  function restoreFocus(c, f) {
    if (!f) return;
    var li = c.list.querySelector('.ws-row[data-id="' + CSS.escape(f.id) + '"]');
    if (!li) {
      /* The row went (put back, deleted): its neighbour takes the focus. */
      var next = c.list.children[Math.min(f.index, c.list.children.length - 1)];
      var target = next ? next.querySelector('.ws-row__check') : (c.search.disabled ? null : c.search);
      if (target) target.focus({ preventScroll: true });
      else c.sheet.el.focus({ preventScroll: true });
      return;
    }
    var el = (f.role && li.querySelector('[data-role="' + f.role + '"]')) || li.querySelector('.ws-row__check');
    if (el) el.focus({ preventScroll: true });
  }

  /* ================================================================ choosing */

  function setChosen(c, id, on, range) {
    if (range && c.anchor && c.anchor !== id) {
      var a = c.visible.indexOf(c.anchor);
      var b = c.visible.indexOf(id);
      if (a >= 0 && b >= 0) {
        var lo = Math.min(a, b), hi = Math.max(a, b);
        for (var i = lo; i <= hi; i++) { if (on) c.chosen.add(c.visible[i]); else c.chosen.delete(c.visible[i]); }
      }
    } else if (on) {
      c.chosen.add(id);
    } else {
      c.chosen.delete(id);
    }
    c.anchor = id;
    c.bulkArmed = false;
    disarmBulk(c);
    paintBulk(c);
  }

  function chooseAll(c, on) {
    if (on) c.visible.forEach(function (id) { c.chosen.add(id); });
    else c.chosen.clear();
    c.anchor = null;
    disarmBulk(c);
    paintBulk(c);
  }

  function onListClick(c, event) {
    var li = event.target.closest('.ws-row');
    if (!li) return;
    var id = li.getAttribute('data-id');
    var roleEl = event.target.closest('[data-role]');
    var role = roleEl ? roleEl.getAttribute('data-role') : null;
    if (role === 'check') {
      setChosen(c, id, event.target.checked, event.shiftKey);
      return;
    }
    if (role === 'toggle') {
      setChosen(c, id, !c.chosen.has(id), event.shiftKey);
      return;
    }
    if (role === 'preview') {
      if (c.opened.has(id)) c.opened.delete(id); else c.opened.add(id);
      var btn = event.target.closest('.ws-preview');
      btn.setAttribute('aria-expanded', String(c.opened.has(id)));
      if (c.opened.has(id)) btn.removeAttribute('title'); else btn.setAttribute('title', t('trash.showMore'));
      return;
    }
    if (role === 'restore') {
      if (!isOff(event.target.closest('button'))) putBack(c, [id]);
      return;
    }
    if (role === 'purge') {
      var b = event.target.closest('button');
      if (isOff(b)) return;
      if (c.armed === id) { disarm(c); purge(c, [id]); return; }
      disarm(c);
      c.armed = id;
      arm(b);
      c.armTimer = setTimeout(function () { disarm(c); }, ARM_MS);
    }
  }

  /* Up and down walk the rows' boxes; with Shift they choose on the way. */
  function onListKey(c, event) {
    var target = event.target;
    if (!target.classList || !target.classList.contains('ws-row__check')) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    var li = target.closest('.ws-row');
    var next = event.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
    if (!next) return;
    event.preventDefault();
    var box = next.querySelector('.ws-row__check');
    box.focus();
    if (event.shiftKey) setChosen(c, next.getAttribute('data-id'), true, false);
  }

  function onSheetKey(c, event) {
    if (event.defaultPrevented || event.isComposing) return;
    var inSearch = event.target === c.search;
    if (event.key === 'Escape') {
      if (c.search.value) {
        c.search.value = '';
        c.query = '';
        paint(c);
        c.search.focus();
      } else if (c.chosen.size || c.armed || c.bulkArmed) {
        c.chosen.clear();
        c.anchor = null;
        disarm(c);
        paintBulk(c);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'a' || event.key === 'A') && !inSearch) {
      event.preventDefault();
      event.stopPropagation();
      chooseAll(c, true);
    }
  }

  /* Shift+click on a name must not select the text it ranges over. */
  document.addEventListener('mousedown', function (event) {
    if (event.shiftKey && event.target.closest && event.target.closest('.ws-trash [data-role="toggle"]')) event.preventDefault();
  }, true);

  /* ================================================================ arming */

  function arm(btn) {
    btn.setAttribute('data-armed', '');
    btn.setAttribute('aria-label', t('trash.sure'));
    var lab = btn.querySelector('.btn__label');
    if (lab) lab.textContent = t('trash.sure');
    ui().tooltip(btn, t('trash.armHint'));
  }

  function disarm(c) {
    clearTimeout(c.armTimer);
    if (c.armed) {
      var b = c.list.querySelector('.ws-row[data-id="' + CSS.escape(c.armed) + '"] .ws-row__purge');
      c.armed = null;
      if (b) {
        var label = t('trash.purgeNamed', { name: b.getAttribute('data-name') || '' });
        b.removeAttribute('data-armed');
        b.setAttribute('aria-label', label);
        ui().tooltip(b, label);
      }
    }
    disarmBulk(c);
  }

  function disarmBulk(c) {
    clearTimeout(c.bulkTimer);
    if (!c.bulkArmed) return;
    c.bulkArmed = false;
    paintBulk(c);
  }

  function bulkPurge(c) {
    if (!c.chosen.size) return;
    if (c.bulkArmed) {
      var ids = Array.from(c.chosen);
      disarmBulk(c);
      purge(c, ids);
      return;
    }
    c.bulkArmed = true;
    paintBulk(c);
    clearTimeout(c.bulkTimer);
    c.bulkTimer = setTimeout(function () { disarmBulk(c); }, ARM_MS);
  }

  /* ================================================================ acting */

  function refuse() {
    ui().toast(t('trash.readOnly'));
    return false;
  }

  function backText(r) {
    var name = nameOf(r.entry);
    var key = { same: 'same', moved: 'moved', top: 'top', files: 'files', 'new map': 'newMap', gone: 'gone' }[r.where] || 'same';
    if (key === 'top' && r.entry.kind === 'note') key = 'top.note';
    return t('trash.back.' + key, { name: name });
  }

  /* Back where they were, one step; the toast tells how it went for real. */
  function putBack(c, ids) {
    if (!editable()) return refuse();
    if (!ids.length) return false;
    var store = S();
    var results = store.restoreTrashMany(c.pid, ids);
    if (!results.length) return false;
    ids.forEach(function (id) { c.chosen.delete(id); });
    var text;
    if (results.length === 1) {
      text = backText(results[0]);
    } else {
      var gone = results.filter(function (r) { return r.where === 'gone'; }).length;
      var parts = [plural('trash.backMany', results.length - gone)];
      if (results.some(function (r) { return r.where === 'top'; })) parts.push(t('trash.backLost'));
      if (gone) parts.push(plural('trash.backGone', gone));
      text = parts.join(' ');
    }
    ui().toastUndo(text);
    /* The map it went into is open (the store moved there); the node that
     * came back is chosen on it. */
    var last = null;
    for (var i = results.length - 1; i >= 0 && !last; i--) if (results[i].mapId) last = results[i];
    if (last && ns.session && typeof ns.session.open === 'function') {
      var where = typeof last.anchorLine === 'number' ? { anchorLine: last.anchorLine } : undefined;
      ns.session.open(c.pid, last.mapId, where ? { where: where } : {});
    }
    return results;
  }

  function purge(c, ids) {
    if (!editable()) return refuse();
    var p = S().project(c.pid);
    var names = {};
    p.trash.forEach(function (e) { names[e.id] = nameOf(e); });
    var gone = S().purgeTrashMany(c.pid, ids);
    if (!gone.length) return false;
    ids.forEach(function (id) { c.chosen.delete(id); });
    ui().toastUndo(gone.length === 1 ? t('trash.purged', { name: names[gone[0].id] }) : plural('trash.purgedMany', gone.length));
    return true;
  }

  function emptyAll(c) {
    if (!editable()) return Promise.resolve(refuse());
    var p = S().project(c.pid);
    if (!p || !p.trash.length) return Promise.resolve(false);
    return ui().confirm({
      title: t('trash.confirm.title', { project: p.name }),
      text: plural('trash.confirm.text', p.trash.length),
      ok: t('trash.confirm.ok'),
      danger: true
    }).then(function (yes) {
      if (!yes) return false;
      var n = S().emptyTrash(c.pid);
      if (!n) return false;
      c.chosen.clear();
      ui().toastUndo(t('trash.emptied'));
      return true;
    });
  }

  /* ================================================================ init */

  function close() { if (cur) cur.sheet.close('api'); }

  function init() {
    if (!ns.commands) return;
    ns.commands.register({
      id: 'trash.open', label: 'trash.cmd.open', group: 'project', icon: 'trash',
      keywords: t('trash.kw.open'), help: 'trash.help.open',
      when: function () { return !!S() && !!S().here().projectId && !viewOnly(); },
      run: function (ctx) { return !!open(null, ctx); }
    });
  }

  ns.trash = {
    init: init,
    open: open,
    close: close,
    isOpen: function isOpen() { return !!cur && cur.sheet.isOpen(); },
    preview: preview,
    /* For tests and other panels: the open sheet's state. */
    state: function state() {
      return cur ? { projectId: cur.pid, query: cur.query, chosen: Array.from(cur.chosen), visible: cur.visible.slice(), armed: cur.armed, bulkArmed: cur.bulkArmed } : null;
    }
  };
})(window.MindRoot);
