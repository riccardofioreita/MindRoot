/* MindRoot - how to use MindRoot, written by the app itself.
 *
 * The keys and commands part is generated from the command registry each
 * time the sheet opens (and again when a command is added or the language
 * changes), grouped as the registry groups them, with every key a command
 * answers to, written for this machine (Ctrl or ⌘). The previous help was a
 * page of hand-written HTML that had fallen fifteen features behind; this
 * one cannot. The drawing keys come from the drawing editor itself
 * (ns.ink.shortcuts()), which keeps them out of the registry on purpose.
 *
 * After the commands, short how-to sections the registry cannot know: the
 * list on the left, notebooks (the board view, a node's drawing, their
 * settings, pages and the rail, the keys that turn a page, export, where
 * the files live), the Markdown the maps are written in, and the touch
 * gestures. A search field filters everything, ignoring case and accents. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  ns.i18n.add({
    en: {
      'help.title': 'How to use MindRoot',
      'help.search': 'Search the help',
      'help.noMatch': 'Nothing in the help matches "{q}".',
      'help.commands': 'Keys and commands',
      'help.drawing': 'Drawing',
      'help.tree': 'The list of projects',
      'help.markdown': 'The Markdown of a map',
      'help.touch': 'On a touch screen',
      'help.md.root': 'The root of the map',
      'help.md.node': 'A node; indent by two spaces for a child',
      'help.md.task': 'A box to tick',
      'help.md.note': 'A note on the node',
      'help.md.edge': 'A note on the line that reaches the node',
      'help.md.text': 'Words under the node, on the map',
      'help.md.styles': 'Bold, italic, highlight, struck through, code',
      'help.md.link': 'A link that opens',
      'help.md.mapLink': 'A link to another map of the project',
      'help.md.nodeLink': 'A link to a node of this map or of another (type @ in a node to choose one)',
      'help.md.picture': 'A picture from the project',
      'help.md.colour': 'A colour of its own, at the end of a line',
      'help.md.fold': 'Folded when the map opens',
      'help.md.side': 'A branch of the central node on its left (no marker: on its right)',
      'help.touch.tap': 'Tap a node to choose it, the empty map to let go',
      'help.touch.double': 'Double tap a node to write on it',
      'help.touch.long': 'Hold a node for its menu; move on to drag it',
      'help.touch.pan': 'One finger on the empty map moves it, two zoom',
      'help.touch.edge': 'Swipe from the left edge for the projects',
      'help.touch.sheet': 'Pull a sheet down to close it',
      'help.touch.row': 'Hold a row of the list for its menu; move on to reorder',
      'help.touch.draw': 'In a notebook, draw with a pen or a finger; two fingers move and zoom the page',
      'help.touch.rail': 'Drag the page rail at the side to go through the pages; tap it for the thumbnails',
      'help.touch.thumb': 'Hold a page thumbnail and move it to put the page somewhere else',
      'help.notebooks': 'Notebooks: the board and the drawings',
      'help.nb.board': 'The board of a map',
      'help.nb.boardText': 'The Map and Board switch at the top shows the map\'s board where the map was: one notebook for the whole map, made with its first stroke. Each map remembers which of the two it was left on.',
      'help.nb.node': 'A drawing on a node',
      'help.nb.nodeText': 'Draw on the node, from its toolbar or its menu: a notebook of its own, beside the map, over it or as a card. Its first page shows in the node.',
      'help.nb.settings': 'Notebook settings',
      'help.nb.settingsText': 'Notebook settings, in the notebook\'s bar: infinite canvases or pages, the paper (dots, squares, lines, school, maths, music, design, planners, a picture of your own), the page size and orientation, and the background, automatic with the theme or a colour.',
      'help.nb.ink': 'The ink colour',
      'help.nb.inkText': 'The first ink follows the paper: dark on light paper, light on dark paper. Every other colour stays as chosen.',
      'help.nb.pages': 'Pages and the rail',
      'help.nb.pagesText': 'In pages mode the pages scroll one under the other. The slim rail at the side shows where you are; tap it for the thumbnails, where pages are added, duplicated, sent to the trash and dragged into order. An infinite notebook holds canvases the same way, one on screen at a time, each keeping its own pan and zoom: the Canvases button opens their thumbnails, and the rail switches between them.',
      'help.nb.turn': 'Turn the page',
      'help.nb.turnText': 'With the page focused: Page Down and Page Up go to the next and the previous page, Home and End to the first and the last. In infinite mode Page Down and Page Up show the next and the previous canvas.',
      'help.nb.export': 'Export a notebook',
      'help.nb.exportText': 'The export button of the notebook, or the export sheet with the board shown: a PDF of every page, each at its own size, or a PNG of the page in view, on light or dark paper. In infinite mode the PDF has a page per canvas, cut to what is drawn on it, and the PNG is the canvas shown.',
      'help.nb.files': 'Where notebooks are kept',
      'help.nb.filesText': 'A folder in the project\'s files, assets/<name>.book, with book.json and one .ink.svg per page. The map names the first page, so any Markdown viewer shows the cover. Notebooks travel with the ZIP and JSON backups.',
      'help.cmd.open': 'How to use MindRoot',
      'help.help.open': 'Every key and command, the Markdown of a map and the gestures.',
      'help.kw.open': 'help keys shortcuts how guide'
    },
    it: {
      'help.title': 'Come si usa MindRoot',
      'help.search': "Cerca nell'aiuto",
      'help.noMatch': 'Niente nell\'aiuto corrisponde a "{q}".',
      'help.commands': 'Tasti e comandi',
      'help.drawing': 'Disegnare',
      'help.tree': "L'elenco dei progetti",
      'help.markdown': 'Il Markdown di una mappa',
      'help.touch': 'Su uno schermo touch',
      'help.md.root': 'La radice della mappa',
      'help.md.node': 'Un nodo; rientra di due spazi per un figlio',
      'help.md.task': 'Una casella da spuntare',
      'help.md.note': 'Una nota sul nodo',
      'help.md.edge': 'Una nota sulla linea che arriva al nodo',
      'help.md.text': 'Parole sotto il nodo, sulla mappa',
      'help.md.styles': 'Grassetto, corsivo, evidenziato, barrato, codice',
      'help.md.link': 'Un link che si apre',
      'help.md.mapLink': "Un link a un'altra mappa del progetto",
      'help.md.nodeLink': "Un link a un nodo di questa mappa o di un'altra (scrivi @ in un nodo per sceglierlo)",
      'help.md.picture': "Un'immagine del progetto",
      'help.md.colour': 'Un colore tutto suo, in fondo alla riga',
      'help.md.fold': 'Piegato quando la mappa si apre',
      'help.md.side': 'Un ramo del nodo centrale alla sua sinistra (senza segno: alla sua destra)',
      'help.touch.tap': 'Tocca un nodo per sceglierlo, la mappa vuota per lasciarlo',
      'help.touch.double': 'Tocca due volte un nodo per scriverci',
      'help.touch.long': 'Tieni premuto un nodo per il suo menu; continua a muoverti per trascinarlo',
      'help.touch.pan': 'Un dito sulla mappa vuota la sposta, due la ingrandiscono',
      'help.touch.edge': 'Scorri dal bordo sinistro per i progetti',
      'help.touch.sheet': 'Tira giù un pannello per chiuderlo',
      'help.touch.row': "Tieni premuta una riga dell'elenco per il suo menu; continua per riordinarla",
      'help.touch.draw': 'In un quaderno disegna con la penna o con un dito; due dita spostano e ingrandiscono la pagina',
      'help.touch.rail': 'Trascina la barra delle pagine a lato per scorrerle; toccala per le miniature',
      'help.touch.thumb': 'Tieni premuta la miniatura di una pagina e spostala per metterla altrove',
      'help.notebooks': 'Quaderni: la lavagna e i disegni',
      'help.nb.board': 'La lavagna di una mappa',
      'help.nb.boardText': 'Il selettore Mappa e Lavagna in alto mostra la lavagna della mappa al posto della mappa: un quaderno per tutta la mappa, che nasce con il primo tratto. Ogni mappa ricorda quale delle due era aperta.',
      'help.nb.node': 'Un disegno su un nodo',
      'help.nb.nodeText': 'Disegna sul nodo, dalla sua barra o dal suo menu: un quaderno tutto suo, accanto alla mappa, sopra di lei o come scheda. La sua prima pagina compare nel nodo.',
      'help.nb.settings': 'Impostazioni del quaderno',
      'help.nb.settingsText': "Impostazioni del quaderno, nella sua barra: tele infinite o pagine, la carta (puntini, quadretti, righe, scuola, matematica, musica, design, agende, una tua immagine), il formato e l'orientamento della pagina, e lo sfondo, automatico con il tema o di un colore.",
      'help.nb.ink': "Il colore dell'inchiostro",
      'help.nb.inkText': 'Il primo inchiostro segue la carta: scuro sulla carta chiara, chiaro sulla carta scura. Tutti gli altri colori restano come li hai scelti.',
      'help.nb.pages': 'Pagine e barra laterale',
      'help.nb.pagesText': "In modalità pagine le pagine scorrono una sotto l'altra. La barra sottile a lato mostra dove sei; toccala per le miniature, dove si aggiungono, duplicano, spostano nel cestino e riordinano trascinandole. Un quaderno infinito ha le tele allo stesso modo, una alla volta sullo schermo, ciascuna con il suo spostamento e il suo zoom: il pulsante Tele apre le loro miniature, e la barra passa dall'una all'altra.",
      'help.nb.turn': 'Gira pagina',
      'help.nb.turnText': "Con la pagina attiva: Pag giù e Pag su vanno alla pagina dopo e a quella prima, Inizio e Fine alla prima e all'ultima. In modalità infinita Pag giù e Pag su mostrano la tela dopo e quella prima.",
      'help.nb.export': 'Esporta un quaderno',
      'help.nb.exportText': 'Il pulsante Esporta del quaderno, o il pannello di esportazione con la lavagna in vista: un PDF di tutte le pagine, ciascuna nel suo formato, o un PNG della pagina in vista, su carta chiara o scura. In modalità infinita il PDF ha una pagina per tela, tagliata su quello che vi è disegnato, e il PNG è la tela in vista.',
      'help.nb.files': 'Dove stanno i quaderni',
      'help.nb.filesText': 'Una cartella nei file del progetto, assets/<nome>.book, con book.json e un .ink.svg per pagina. La mappa nomina la prima pagina, così qualsiasi visualizzatore Markdown mostra la copertina. I quaderni viaggiano con i backup ZIP e JSON.',
      'help.cmd.open': 'Come si usa MindRoot',
      'help.help.open': 'Ogni tasto e comando, il Markdown di una mappa e i gesti.',
      'help.kw.open': 'help keys shortcuts how guide aiuto tasti scorciatoie guida'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function ui() { return ns.ui; }
  function fold(s) { return String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase(); }

  var MARKDOWN = [
    ['# Title', 'help.md.root'],
    ['- Node', 'help.md.node'],
    ['- [ ] Task', 'help.md.task'],
    ['  - > note: words', 'help.md.note'],
    ['  - > edge: words', 'help.md.edge'],
    ['  - > text: words', 'help.md.text'],
    ['**b** *i* ==mark== ~~s~~ `code`', 'help.md.styles'],
    ['[words](https://example.org)', 'help.md.link'],
    ['[[Another map]]', 'help.md.mapLink'],
    ['[[#id|words]]  [[Map#id|words]]', 'help.md.nodeLink'],
    ['![](assets/photo.jpg)', 'help.md.picture'],
    ['<!-- color: #c2703d -->', 'help.md.colour'],
    ['<!-- markmap: fold -->', 'help.md.fold'],
    ['<!-- side: left -->', 'help.md.side']
  ];

  var TOUCH = ['help.touch.tap', 'help.touch.double', 'help.touch.long', 'help.touch.pan', 'help.touch.edge', 'help.touch.sheet', 'help.touch.row',
    'help.touch.draw', 'help.touch.rail', 'help.touch.thumb'];

  /* Notebooks: what the registry cannot say (the board's command is there
   * with its key; this is how the notebooks themselves work). Keys shown
   * as chips; the board's key is the registry's own. */
  var NOTEBOOK = [
    ['help.nb.board', 'help.nb.boardText', 'view.board'],
    ['help.nb.node', 'help.nb.nodeText'],
    ['help.nb.settings', 'help.nb.settingsText'],
    ['help.nb.ink', 'help.nb.inkText'],
    ['help.nb.pages', 'help.nb.pagesText'],
    ['help.nb.turn', 'help.nb.turnText', ['PageDown', 'PageUp', 'Home', 'End']],
    ['help.nb.export', 'help.nb.exportText'],
    ['help.nb.files', 'help.nb.filesText']
  ];

  function notebookRows() {
    var C = ns.commands;
    return NOTEBOOK.map(function (n) {
      var keys = null;
      if (Array.isArray(n[2])) keys = n[2];
      else if (n[2] && C && C.has(n[2])) keys = C.get(n[2]).keys;
      return row(t(n[0]), keys, t(n[1]));
    });
  }

  function groupLabel(g) {
    var key = 'group.' + g;
    return ns.i18n.has(key) ? t(key) : g.charAt(0).toUpperCase() + g.slice(1);
  }

  function keyChips(keys) {
    var C = ns.commands;
    var box = h('span', { class: 'ws-keys' });
    (keys || []).forEach(function (k, i) {
      if (i) box.appendChild(h('span', { class: 'ws-keys__or', 'aria-hidden': 'true', text: '/' }));
      box.appendChild(h('kbd', { class: 'kbd', text: C ? C.keysLabel(k) : String(k) }));
    });
    return box;
  }

  function row(title, keys, text, extra) {
    var r = h('div', { class: 'ws-help__row', role: 'listitem' },
      h('div', { class: 'ws-help__head' },
        h('span', { class: 'ws-help__title', text: title }),
        keys && keys.length ? keyChips(keys) : null),
      text ? h('p', { class: 'ws-help__text', text: text }) : null,
      extra || null);
    r.setAttribute('data-hay', fold([title, text || '', (keys || []).map(function (k) { return ns.commands ? ns.commands.keysLabel(k) : k; }).join(' '), extra ? extra.textContent : ''].join(' ')));
    return r;
  }

  function section(id, title, rows) {
    if (!rows.length) return null;
    var list = h('div', { class: 'ws-help__list', role: 'list' });
    rows.forEach(function (r) { list.appendChild(r); });
    return h('section', { class: 'ws-section ws-help__section', 'aria-labelledby': id, 'data-section': id },
      h('h3', { class: 'ws-section__title', id: id, text: title }), list);
  }

  /* The registry, grouped in its own order of groups. */
  function commandSections() {
    var C = ns.commands;
    if (!C) return [];
    var groups = {};
    C.all().forEach(function (cmd) {
      if (cmd.showInHelp === false) return;
      (groups[cmd.group] || (groups[cmd.group] = [])).push(cmd);
    });
    var order = (C.GROUPS || []).slice();
    Object.keys(groups).forEach(function (g) { if (order.indexOf(g) < 0) order.push(g); });
    var out = [];
    order.forEach(function (g) {
      if (!groups[g]) return;
      var rows = groups[g].map(function (cmd) {
        var help = cmd.help && ns.i18n.has(cmd.help) ? t(cmd.help) : '';
        var r = row(C.label(cmd.id), cmd.keys, help);
        r.setAttribute('data-command', cmd.id);
        return r;
      });
      var s = section('help-g-' + g, groupLabel(g), rows);
      if (s) out.push(s);
    });
    return out;
  }

  function build(c) {
    var body = h('div', { class: 'ws-help' });
    body.appendChild(c.search);
    body.appendChild(c.note);
    /* On a touch screen the gestures are how things are done: they come
     * first, before the keys a phone has none of. */
    var touchFirst = !!(util.isTouch);
    var touch = section('help-touch', t('help.touch'), TOUCH.map(function (k) { return row(t(k), null, ''); }));
    if (touchFirst) body.appendChild(touch);
    body.appendChild(h('h2', { class: 'ws-help__part', text: t('help.commands') }));
    commandSections().forEach(function (s) { body.appendChild(s); });

    if (ns.sidebar) body.appendChild(section('help-tree', t('help.tree'), [row(t('help.tree'), null, t('sidebar.help.tree'))]));

    if (ns.ink && typeof ns.ink.shortcuts === 'function') {
      var ink = [];
      try { ink = ns.ink.shortcuts() || []; } catch (err) { ink = []; }
      body.appendChild(section('help-ink', t('help.drawing'), ink.map(function (s) { return row(s.label, s.keys, ''); })));
    }

    if (ns.notebook) body.appendChild(section('help-notebooks', t('help.notebooks'), notebookRows()));

    body.appendChild(section('help-md', t('help.markdown'), MARKDOWN.map(function (m) {
      return row(t(m[1]), null, '', h('code', { class: 'ws-help__code', text: m[0] }));
    })));

    if (!touchFirst) body.appendChild(touch);
    return body;
  }

  /* ================================================================ the sheet */

  var cur = null;

  function filter(c) {
    var words = fold(c.search.value.trim()).split(/\s+/).filter(Boolean);
    var shown = 0;
    Array.prototype.forEach.call(c.body.querySelectorAll('.ws-help__section'), function (sec) {
      var any = false;
      Array.prototype.forEach.call(sec.querySelectorAll('.ws-help__row'), function (r) {
        var hay = r.getAttribute('data-hay') + ' ' + fold(sec.querySelector('.ws-section__title').textContent);
        var ok = words.every(function (w) { return hay.indexOf(w) >= 0; });
        r.hidden = !ok;
        if (ok) { any = true; shown++; }
      });
      sec.hidden = !any;
    });
    c.note.textContent = shown ? '' : t('help.noMatch', { q: c.search.value.trim() });
    c.note.hidden = !!shown;
    Array.prototype.forEach.call(c.body.querySelectorAll('.ws-help__part'), function (p) { p.hidden = !!words.length; });
  }

  /* Where the focus starts: the search field for a keyboard (F1, then
   * type), the sheet itself for a finger - a tap is a user gesture, and a
   * focused field there raises the phone's keyboard over half a sheet that
   * was opened to be read. A query handed in is typing too. */
  function typing(opts) {
    return !util.isTouch || !!(opts && (opts.source === 'key' || opts.query));
  }

  function open(opts) {
    opts = opts || {};
    if (cur && cur.sheet.isOpen()) { if (typing(opts)) cur.search.focus(); return cur; }
    var c = {};
    c.search = h('input', { class: 'input ws-search', type: 'search', autocomplete: 'off', placeholder: t('help.search'), 'aria-label': t('help.search') });
    c.note = h('p', { class: 'ws-note', 'aria-live': 'polite', hidden: true });
    c.body = build(c);
    c.search.addEventListener('input', function () { filter(c); });
    c.search.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && c.search.value) {
        event.preventDefault();
        event.stopPropagation();
        c.search.value = '';
        filter(c);
      }
    });
    c.sheet = ui().sheet({
      title: t('help.title'),
      body: c.body,
      cls: 'ws-sheet ws-sheet--help',
      detents: [0.6, 0.92],
      initialFocus: typing(opts) ? c.search : null,
      onClose: function () {
        if (c.off) c.off.forEach(function (off) { off(); });
        if (cur === c) cur = null;
      }
    });
    var again = util.throttleFrame(function () { rebuild(c); });
    c.off = [ns.bus.on('lang', again), ns.bus.on('commands', again)];
    cur = c;
    if (opts.query) { c.search.value = opts.query; filter(c); }
    return c;
  }

  function rebuild(c) {
    if (!c.sheet.isOpen()) return;
    var q = c.search.value;
    var hadFocus = document.activeElement === c.search;
    c.search.placeholder = t('help.search');
    c.search.setAttribute('aria-label', t('help.search'));
    var fresh = build(c);
    c.body.replaceWith(fresh);
    c.body = fresh;
    c.search.value = q;
    filter(c);
    c.sheet.setTitle(t('help.title'));
    if (hadFocus) c.search.focus({ preventScroll: true });
  }

  function init() {
    if (!ns.commands) return;
    ns.commands.register({
      id: 'help.open', label: 'help.cmd.open', group: 'help', icon: 'help',
      /* F1 is no typing key: it opens the help from a text field too. */
      keys: [{ key: 'F1', global: true }, '?'], keywords: t('help.kw.open'), help: 'help.help.open',
      run: function (ctx) {
        if (cur && cur.sheet.isOpen()) { cur.sheet.close('toggle'); return true; }
        return !!open({ source: ctx && ctx.source });
      }
    });
  }

  ns.help = {
    init: init,
    open: open,
    close: function close() { if (cur) cur.sheet.close('api'); },
    isOpen: function isOpen() { return !!cur && cur.sheet.isOpen(); }
  };
})(window.MindRoot);
