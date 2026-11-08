/* MindRoot - the first run, and what the stage says when there is no map.
 *
 * First run: a workspace that has never been written (storage.open() says
 * fresh) gets one project, "MindRoot", with one map that
 * teaches the app by being an example of it: its nodes name the keys (read
 * from the command registry, so they are the keys that work on this
 * machine), it has a note, a colour of its own, a box to tick, a folded
 * branch and the clock copies' real interval. It is written in the language
 * the app speaks, is not a step of the history, and is saved at once - a
 * browser opened, looked at and closed must not meet a fresh workspace
 * again next time. A page that names its own database (?db=, the tests)
 * starts empty unless it also says ?welcome=1.
 *
 * Empty states: no projects ("make one, bring one in, or look at the
 * sample"), and a project with no maps. The session calls show() when it
 * closes the map; the card goes away when a map opens. It names a drop as a
 * way in, since the page takes ZIPs, JSON, .md and folders dropped anywhere.
 * The card may carry the optional liquid-glass decoration (ns.glass); its
 * wrapper leaves the page with the card. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  ns.i18n.add({
    en: {
      'welcome.region': 'Getting started',
      'welcome.none.title': 'No projects yet',
      'welcome.none.text': 'A project is a folder of maps, kept in this browser. Make one, or bring one in: a ZIP or a JSON exported from MindRoot, a .interneuron folder, a loose .md.',
      'welcome.empty.title': '{project} has no maps',
      'welcome.empty.text': 'Make one, or bring a map in: a .md becomes a map of this project.',
      'welcome.drop': 'You can also drop files or a folder anywhere on the page.',
      'welcome.newProject': 'New project',
      'welcome.newMap': 'New map',
      'welcome.import': 'Import',
      'welcome.sample': 'Open the sample',
      'welcome.importFile': 'A file (ZIP, JSON, .md)',
      'welcome.importFolder': 'A .interneuron folder',
      'welcome.readOnly': 'This tab only shows the maps another tab keeps.',
      'welcome.cmd.sample': 'Add the sample map',
      'welcome.help.sample': 'A map that shows how MindRoot works, in the language you use.',
      'welcome.kw.sample': 'sample example welcome tutorial guide',
      'welcome.project': 'MindRoot',
      'welcome.projectDescription': 'A first project to look around in. Delete it whenever you like.',
      'welcome.map': 'Welcome',
      'welcome.sampleAdded': 'The sample map is open.',
      /* The sample map, one line a key. {k:...} are filled from the command
       * registry with the keys of this machine. */
      'welcome.t.title': 'Welcome to MindRoot',
      'welcome.t.maps': 'Projects and maps',
      'welcome.t.mapsText': 'A project holds several maps, the way a folder holds files. The list on the left has them all.',
      'welcome.t.newProject': 'New project: the + above the list',
      'welcome.t.newMap': 'New map: {keys}, or the row under the maps of a project',
      'welcome.t.find': '{keys} finds any command, any map and any node',
      'welcome.t.writing': 'Writing on the map',
      'welcome.t.child': '{tab} adds a child, {enter} a sibling',
      'welcome.t.rename': '{keys} or a double tap writes on a node',
      'welcome.t.drag': 'Drag a node onto another to move it there',
      'welcome.t.delete': '{keys} sends a branch to the trash',
      'welcome.t.words': 'Notes and words',
      'welcome.t.noted': 'This node has a note: the dot beside it opens it',
      'welcome.t.note': 'Notes keep what does not fit on the map.',
      'welcome.t.styles': '**Bold**, *italic* and ==highlight==, as in Markdown',
      'welcome.t.task': 'A box to tick on the map',
      'welcome.t.colours': 'Colours, pictures and drawings',
      'welcome.t.branch': 'Every branch has a colour of its own',
      'welcome.t.ownColour': 'A node can have a different one',
      'welcome.t.pictures': 'Paste, drop or pick a picture on a node',
      'welcome.t.drawings': 'Draw on a node: a notebook of its own, with pages and papers',
      'welcome.t.board': 'Board, at the top ({keys}): one notebook for the whole map',
      'welcome.t.folds': 'Folding',
      'welcome.t.fold': '{keys} folds and unfolds the chosen branch',
      'welcome.t.folded': 'This branch is folded: open it',
      'welcome.t.hidden': 'This is what it was hiding',
      'welcome.t.safe': 'Nothing is lost',
      'welcome.t.undo': 'Every change can be undone: {keys}',
      'welcome.t.undoText': 'Undo takes you back to the map where it happened.',
      'welcome.t.trash': 'The trash keeps branches, pictures, maps and copies',
      'welcome.t.copies': 'A copy of each changed map is taken every {every}',
      'welcome.t.files': 'Files',
      'welcome.t.kept': 'Everything stays in this browser, and works offline',
      'welcome.t.markdown': 'The map is Markdown: {keys} shows it',
      'welcome.t.backup': 'Settings ({keys}) makes a backup of everything',
      'welcome.t.export': 'A project exports as a ZIP of its .interneuron folder',
      'welcome.every.m.one': 'minute',
      'welcome.every.m.other': '{n} minutes',
      'welcome.every.h.one': 'hour',
      'welcome.every.h.other': '{n} hours'
    },
    it: {
      'welcome.region': 'Per cominciare',
      'welcome.none.title': 'Ancora nessun progetto',
      'welcome.none.text': 'Un progetto è una cartella di mappe, conservata in questo browser. Creane uno, o portalo qui: uno ZIP o un JSON esportato da MindRoot, una cartella .interneuron, un file .md.',
      'welcome.empty.title': '{project} non ha mappe',
      'welcome.empty.text': 'Creane una, o portala qui: un .md diventa una mappa di questo progetto.',
      'welcome.drop': 'Puoi anche trascinare file o una cartella in un punto qualsiasi della pagina.',
      'welcome.newProject': 'Nuovo progetto',
      'welcome.newMap': 'Nuova mappa',
      'welcome.import': 'Importa',
      'welcome.sample': "Apri l'esempio",
      'welcome.importFile': 'Un file (ZIP, JSON, .md)',
      'welcome.importFolder': 'Una cartella .interneuron',
      'welcome.readOnly': "Questa scheda mostra soltanto le mappe che conserva un'altra scheda.",
      'welcome.cmd.sample': 'Aggiungi la mappa di esempio',
      'welcome.help.sample': 'Una mappa che mostra come funziona MindRoot, nella tua lingua.',
      'welcome.kw.sample': 'sample example welcome tutorial guide esempio benvenuto guida',
      'welcome.project': 'MindRoot',
      'welcome.projectDescription': 'Un primo progetto per guardarsi intorno. Eliminalo quando vuoi.',
      'welcome.map': 'Benvenuto',
      'welcome.sampleAdded': 'La mappa di esempio è aperta.',
      'welcome.t.title': 'Benvenuto in MindRoot',
      'welcome.t.maps': 'Progetti e mappe',
      'welcome.t.mapsText': "Un progetto contiene più mappe, come una cartella contiene dei file. L'elenco a sinistra le ha tutte.",
      'welcome.t.newProject': "Nuovo progetto: il + sopra l'elenco",
      'welcome.t.newMap': 'Nuova mappa: {keys}, o la riga sotto le mappe di un progetto',
      'welcome.t.find': '{keys} trova ogni comando, ogni mappa e ogni nodo',
      'welcome.t.writing': 'Scrivere sulla mappa',
      'welcome.t.child': '{tab} aggiunge un figlio, {enter} un fratello',
      'welcome.t.rename': '{keys} o un doppio tocco scrivono su un nodo',
      'welcome.t.drag': 'Trascina un nodo su un altro per spostarlo lì',
      'welcome.t.delete': '{keys} manda un ramo nel cestino',
      'welcome.t.words': 'Note e parole',
      'welcome.t.noted': 'Questo nodo ha una nota: la apre il pallino accanto',
      'welcome.t.note': 'Le note tengono quello che sulla mappa non ci sta.',
      'welcome.t.styles': '**Grassetto**, *corsivo* e ==evidenziato==, come in Markdown',
      'welcome.t.task': 'Una casella da spuntare sulla mappa',
      'welcome.t.colours': 'Colori, immagini e disegni',
      'welcome.t.branch': 'Ogni ramo ha un suo colore',
      'welcome.t.ownColour': 'Un nodo può averne uno diverso',
      'welcome.t.pictures': "Incolla, trascina o scegli un'immagine su un nodo",
      'welcome.t.drawings': 'Disegna su un nodo: un quaderno tutto suo, con pagine e carte',
      'welcome.t.board': 'Lavagna, in alto ({keys}): un quaderno per tutta la mappa',
      'welcome.t.folds': 'Pieghe',
      'welcome.t.fold': '{keys} piega e apre il ramo scelto',
      'welcome.t.folded': 'Questo ramo è piegato: aprilo',
      'welcome.t.hidden': 'Ecco quello che nascondeva',
      'welcome.t.safe': 'Niente va perso',
      'welcome.t.undo': 'Ogni modifica si annulla: {keys}',
      'welcome.t.undoText': 'Annulla ti riporta sulla mappa dove era successo.',
      'welcome.t.trash': 'Il cestino tiene rami, immagini, mappe e copie',
      'welcome.t.copies': 'Ogni {every} si fa una copia di ogni mappa cambiata',
      'welcome.t.files': 'File',
      'welcome.t.kept': 'Tutto resta in questo browser, e funziona senza rete',
      'welcome.t.markdown': 'La mappa è Markdown: {keys} la mostra',
      'welcome.t.backup': 'Le impostazioni ({keys}) fanno il backup di tutto',
      'welcome.t.export': 'Un progetto si esporta come ZIP della sua cartella .interneuron',
      'welcome.every.m.one': 'minuto',
      'welcome.every.m.other': '{n} minuti',
      'welcome.every.h.one': 'ora',
      'welcome.every.h.other': '{n} ore'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function S() { return ns.store; }
  function ui() { return ns.ui; }

  var host = null;
  var card = null;
  var shownFor = null;     // the state the card was built for
  var inited = false;

  /* ================================================================ the sample map */

  /* The keys that work here, as this machine writes them: 'Ctrl+K' or '⌘K'.
   * A command that is not registered falls back to the given keys. */
  function keysOf(id, fallback) {
    var C = ns.commands;
    var cmd = C && C.get(id);
    var keys = cmd && cmd.keys && cmd.keys.length ? cmd.keys : (fallback ? [fallback] : null);
    if (!keys) return '';
    return C ? C.keysLabel(keys[0]) : keys[0];
  }

  function everyText() {
    var c = ns.prefs.get('copies') || { every: 1, unit: 'h' };
    var unit = c.unit === 'm' ? 'm' : 'h';
    return ns.i18n.plural('welcome.every.' + unit, c.every || 1);
  }

  /* One escaped line of the sample: what the person sees must never turn
   * into Markdown it did not mean (a key label like '+' or '*' is text). */
  function plain(s) { return String(s).replace(/([\\`*_~=[\]<&])/g, '\\$1'); }

  function sampleText() {
    var k = {
      newMap: plain(keysOf('sidebar.newMap', 'Mod+Alt+N')),
      palette: plain(keysOf('palette.open', 'Mod+K')),
      tab: plain(keysOf('node.addChild', 'Tab')),
      enter: plain(keysOf('node.addSibling', 'Enter')),
      rename: plain(keysOf('node.rename', 'F2')),
      del: plain(keysOf('node.delete', 'Delete')),
      fold: plain(keysOf('node.fold', 'Space')),
      undo: plain(keysOf('history.undo', 'Mod+Z')),
      source: plain(keysOf('source.toggle', 'Mod+M')),
      board: plain(keysOf('view.board', 'Mod+Shift+L')),
      settings: plain(keysOf('settings.open', 'Mod+,'))
    };
    var lines = [
      '# ' + plain(t('welcome.t.title')),
      '',
      '- ' + plain(t('welcome.t.maps')),
      '  - > text: ' + plain(t('welcome.t.mapsText')),
      '  - ' + plain(t('welcome.t.newProject')),
      '  - ' + t('welcome.t.newMap', { keys: k.newMap }),
      '  - ' + t('welcome.t.find', { keys: k.palette }),
      '- ' + plain(t('welcome.t.writing')),
      '  - ' + t('welcome.t.child', { tab: k.tab, enter: k.enter }),
      '  - ' + t('welcome.t.rename', { keys: k.rename }),
      '  - ' + plain(t('welcome.t.drag')),
      '  - ' + t('welcome.t.delete', { keys: k.del }),
      '- ' + plain(t('welcome.t.words')),
      '  - ' + plain(t('welcome.t.noted')),
      '    - > note: ' + plain(t('welcome.t.note')),
      '  - ' + t('welcome.t.styles'),
      '  - [ ] ' + plain(t('welcome.t.task')),
      '- ' + plain(t('welcome.t.colours')),
      '  - ' + plain(t('welcome.t.branch')),
      '  - ' + plain(t('welcome.t.ownColour')) + ' <!-- color: #c2703d -->',
      '  - ' + plain(t('welcome.t.pictures')),
      '  - ' + plain(t('welcome.t.drawings')),
      '  - ' + t('welcome.t.board', { keys: k.board }),
      '- ' + plain(t('welcome.t.folds')),
      '  - ' + t('welcome.t.fold', { keys: k.fold }),
      '  - ' + plain(t('welcome.t.folded')) + ' <!-- markmap: fold -->',
      '    - ' + plain(t('welcome.t.hidden')),
      '- ' + plain(t('welcome.t.safe')),
      '  - ' + t('welcome.t.undo', { keys: k.undo }),
      '    - > text: ' + plain(t('welcome.t.undoText')),
      '  - ' + plain(t('welcome.t.trash')),
      '  - ' + plain(t('welcome.t.copies', { every: everyText() })),
      '- ' + plain(t('welcome.t.files')),
      '  - ' + plain(t('welcome.t.kept')),
      '  - ' + t('welcome.t.markdown', { keys: k.source }),
      '  - ' + t('welcome.t.backup', { keys: k.settings }),
      '  - ' + plain(t('welcome.t.export')),
      ''
    ];
    return lines.join('\n');
  }

  /* The project as the first run writes it. */
  function sampleProject() {
    return {
      name: t('welcome.project'),
      description: t('welcome.projectDescription'),
      maps: [{ name: t('welcome.map'), text: sampleText() }]
    };
  }

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (err) { return null; }
  }

  /* The person's own database seeds; a database named in the address (the
   * tests) does only when asked. */
  function seedingAllowed() {
    var asked = queryParam('welcome');
    if (asked === '0') return false;
    if (asked === '1') return true;
    return !queryParam('db');
  }

  function firstRun() {
    var opened = ns.shell && typeof ns.shell.opened === 'function' ? ns.shell.opened() : null;
    if (!opened || !opened.fresh) return false;
    var store = S();
    return !!store && !store.readOnly() && store.projects().length === 0;
  }

  function seed() {
    var store = S();
    var made = store.createProject(sampleProject());
    if (!made) return null;
    /* Not a step: nobody should undo their way into an empty workspace. */
    store.clearHistory();
    if (ns.storage && typeof ns.storage.flush === 'function') {
      Promise.resolve(ns.storage.flush()).catch(function () { /* the autosave tries again */ });
    }
    return made;
  }

  /* The sample on demand, as an ordinary step: into the open project, or as
   * a project of its own when there is none. */
  function addSample() {
    var store = S();
    if (!store || store.readOnly()) return null;
    var here = store.here();
    var made = null;
    if (here.projectId && store.project(here.projectId)) {
      made = store.createMap(here.projectId, { name: t('welcome.map'), text: sampleText() });
    } else {
      var p = store.createProject(sampleProject());
      made = p ? p.maps[0] : null;
    }
    if (made) ui().toast(t('welcome.sampleAdded'));
    return made;
  }

  /* ================================================================ the card */

  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }

  function stateNow() {
    var store = S();
    if (!store) return null;
    var cur = ns.session && typeof ns.session.current === 'function' ? ns.session.current() : null;
    if (cur) return null;
    var here = store.here();
    if (here.mapId) return null;
    var p = here.projectId ? store.project(here.projectId) : null;
    return { kind: p ? 'empty' : 'none', projectId: p ? p.id : null, name: p ? p.name : '', readOnly: store.readOnly() };
  }

  function same(a, b) {
    return !!a && !!b && a.kind === b.kind && a.projectId === b.projectId && a.name === b.name && a.readOnly === b.readOnly && a.lang === b.lang;
  }

  function run(id) {
    if (ns.commands && ns.commands.has(id)) ns.commands.run(id, { source: 'welcome' });
  }

  function importMenu(anchor) {
    ui().menu(anchor, [
      { label: t('welcome.importFile'), icon: 'import', onSelect: function () { if (ns.sidebar) ns.sidebar.pickImport(); } },
      { label: t('welcome.importFolder'), icon: 'folder', onSelect: function () { if (ns.sidebar) ns.sidebar.pickFolder(); } }
    ], { title: t('welcome.import'), label: t('welcome.import') });
  }

  function build(st) {
    var none = st.kind === 'none';
    var title = none ? t('welcome.none.title') : t('welcome.empty.title', { project: st.name });
    var text = none ? t('welcome.none.text') : t('welcome.empty.text');
    var actions = h('div', { class: 'empty__actions' });
    if (st.readOnly) {
      text = t('welcome.readOnly');
    } else {
      actions.appendChild(ui().button({
        label: t(none ? 'welcome.newProject' : 'welcome.newMap'), icon: 'plus', kind: 'primary', id: 'welcome-new',
        onClick: function () {
          if (none) run('sidebar.newProject');
          else if (ns.sidebar) ns.sidebar.newMap(st.projectId);
        }
      }));
      var imp = ui().button({ label: t('welcome.import'), icon: 'import', kind: 'text', id: 'welcome-import' });
      imp.setAttribute('aria-haspopup', 'menu');
      imp.addEventListener('click', function () { importMenu(imp); });
      actions.appendChild(imp);
      actions.appendChild(ui().button({ label: t('welcome.sample'), icon: 'map', kind: 'text', id: 'welcome-sample', onClick: addSample }));
    }
    var titleId = util.uid('wl');
    return h('section', {
      class: 'welcome__card glass glass--thick empty',
      'aria-labelledby': titleId,
      'data-liquid': '',
      'data-liquid-radius': '24'
    },
      h('img', { class: 'welcome__logo', src: 'icons/logo-compact.svg', alt: '', width: '48', height: '48' }),
      h('h2', { class: 'empty__title', id: titleId, text: title }),
      h('p', { class: 'empty__text', text: text }),
      actions.children.length ? actions : null,
      st.readOnly ? null : h('p', { class: 'welcome__drop' }, ui().icon('import'), h('span', { text: t('welcome.drop') })));
  }

  function removeCard() {
    if (!card) return;
    var wrapper = card.closest('.lg-root');
    (wrapper && host.contains(wrapper) ? wrapper : card).remove();
    card = null;
  }

  function glassSoon() {
    if (!ns.glass) return;
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 200); };
    idle(function () { try { ns.glass.sync(); } catch (err) { /* decoration only */ } });
  }

  /* Shows the card that fits the workspace now, or hides it when a map is
   * open. Called by the session when it closes the map, and here on every
   * change that could alter what the card says. */
  function show() {
    if (!host) return false;
    var st = stateNow();
    if (!st || viewOnly()) { hide(); return false; }
    st.lang = ns.i18n.lang();
    if (card && same(st, shownFor) && !host.hidden) return true;
    var hadFocus = card && card.contains(document.activeElement);
    removeCard();
    card = build(st);
    shownFor = st;
    host.appendChild(card);
    host.hidden = false;
    if (hadFocus) {
      var first = card.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
    glassSoon();
    return true;
  }

  function hide() {
    if (!host || host.hidden) return;
    var hadFocus = card && card.contains(document.activeElement);
    host.hidden = true;
    removeCard();
    shownFor = null;
    if (hadFocus) {
      var stage = document.getElementById('stage');
      var mv = stage && stage.querySelector('.mv');
      try { (mv || stage).focus({ preventScroll: true }); } catch (err) { /* fine */ }
    }
    glassSoon();
  }

  var refresh = util.throttleFrame(function () { show(); });

  /* ================================================================ init */

  function init() {
    if (inited) return;
    inited = true;
    var stage = document.getElementById('stage');
    if (!stage) return;
    host = h('div', { id: 'welcome', class: 'welcome', role: 'region', 'aria-label': t('welcome.region'), hidden: true });
    /* Above the map, under the edge strip that swipes the drawer out and
     * under the floaters: the stage's own order says so (same layer). */
    stage.insertBefore(host, stage.querySelector('.edge-swipe') || document.getElementById('floaters'));
    if (ns.commands) {
      ns.commands.register({
        id: 'welcome.sample', label: 'welcome.cmd.sample', group: 'help', icon: 'map',
        keywords: t('welcome.kw.sample'), help: 'welcome.help.sample',
        when: function () { return !!S() && !S().readOnly() && !viewOnly(); },
        run: addSample
      });
    }
    if (seedingAllowed() && firstRun()) seed();
    ns.bus.on('map:opened', hide);
    ns.bus.on('map:closed', refresh);
    ns.bus.on('store', function (c) { if (c && c.type !== 'history:changed' && c.type !== 'view') refresh(); });
    ns.bus.on('lang', function () { if (host) host.setAttribute('aria-label', t('welcome.region')); refresh(); });
    ns.bus.on('tabs', refresh);
    ns.bus.on('prefs', function (d) { if (d && d.key === 'mode') refresh(); });
    show();
  }

  ns.welcome = {
    init: init,
    show: show,
    hide: hide,
    seed: seed,
    addSample: addSample,
    sampleText: sampleText,
    sampleProject: sampleProject,
    isShown: function isShown() { return !!host && !host.hidden; }
  };
})(window.MindRoot);
