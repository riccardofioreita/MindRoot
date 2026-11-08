/* MindRoot - boot, the wiring between the modules, and the shell around
 * the map.
 *
 * Boot order: strings, theme, the shell (layout, sidebar, bars, keyboard),
 * then storage.open() and store.init() with what it read, then every feature
 * module's init() in a fixed order - the tab guard first, since it decides
 * whether this tab may write before anything opens a map (it needs storage
 * opened to know whether there is anything to guard), then sidebar,
 * session, editor ... welcome (which seeds the first-run project), pwa -
 * and finally the open map. When it is done ns.booted is true and ns.ready
 * resolves (tests wait on it). Every module past the core is optional: a
 * missing file means its feature is absent, not that the app stops. If boot
 * itself fails, a screen says so and offers the raw stored data as a
 * download: never a blank page.
 *
 * Wiring kept here because it spans modules:
 *   - store changes go out on the bus as 'store' (the session listens first
 *     and follows them: the store says which map is open);
 *   - saving: Mod+S ('file.save') and the page being hidden or left hand
 *     everything held outside the store to it - the session's camera, the
 *     drawings being edited (ns.ink.flush), and whatever modules pass to
 *     the bus 'flush' {reason, waitUntil} - before storage writes; Mod+S
 *     then says truthfully how it went;
 *   - the save state in the top bar (bus 'save'): a dot on phones, words on
 *     wider screens, spoken only for failures and the recovery after them;
 *   - the title: '<map> - <project> - MindRoot'.
 *
 * The shell (ns.shell) owns what is around the map:
 *   - layout: compact < 640 < medium < 1024 <= expanded, mirrored on
 *     <html data-layout>; the CSS uses the same numbers in media queries;
 *   - the sidebar: a column on expanded screens (open state remembered), an
 *     overlay drawer below (starts closed, tap outside closes it, swipe from
 *     the left edge opens it, swipe it back to close);
 *   - the top capsules and the phone thumb bar, whose buttons are generated
 *     from command ids: a command registered later lights its button up, a
 *     command nobody registered leaves no button;
 *   - title, save state, view-only mode, the keyboard inset (--kb), the drop
 *     overlay, the theme and transparency attributes.
 *
 * Bar slots list the ids that may fill them, first registered wins, so the
 * shell does not need to know which module provides "undo" (ns.shell.bars;
 * integration may reorder them).
 *
 * ns.shell, for the other modules:
 *   layout() 'compact'|'medium'|'expanded'      isCompact()
 *   sidebar.open() .close() .toggle() .isOpen() .isDrawer()
 *   viewOnly() / setViewOnly(bool)               theme() resolved 'light'|'dark'
 *   insets() {top, right, bottom, left}          the stage area under floating chrome
 *   refresh()                                    re-read every bar button now
 *   opened()                                     storage.open()'s answer at boot
 * Bus events added by the shell: 'sidebar' {open, drawer}, 'drop' {event,
 * dataTransfer, files, x, y} (synchronous, inside the browser's drop event),
 * 'commands' {type, id} (from commands.js), 'launch' {files} (from pwa.js),
 * and 'prefs' {key: 'mode', value: 'view'|'edit'} for view-only mode. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var resolveReady;
  var rejectReady;
  ns.ready = new Promise(function (resolve, reject) { resolveReady = resolve; rejectReady = reject; });
  /* The failure screen reports a failed boot; this keeps the rejection from
   * also surfacing as an unhandled one for code that never awaits ready. */
  ns.ready.catch(function () {});
  ns.booted = false;

  /* Read once; if one of these is missing (a core file failed to load),
   * boot() fails into the failure screen, which needs none of them. */
  var util = ns.util;
  var h = util ? util.h : null;
  var ui = ns.ui;
  var bus = ns.bus;
  var prefs = ns.prefs;
  var commands = ns.commands;
  var i18n = ns.i18n;
  var root = document.documentElement;

  /* English for the failure screen, for when i18n itself is what broke. */
  var FALLBACK = {
    'app.boot.title': 'MindRoot did not start',
    'app.boot.text': 'Your maps are still stored in this browser. Export them to keep a copy, then reload the page.',
    'app.boot.export': 'Export raw data',
    'app.boot.reload': 'Reload',
    'app.boot.exporting': 'Reading the stored data',
    'app.boot.exported': 'Exported: {file}',
    'app.boot.nothing': 'There is nothing stored in this browser.',
    'app.boot.exportFailed': 'The export did not work: {message}'
  };

  function t(key, vars) {
    var out = key;
    try { out = i18n.t(key, vars); } catch (err) { out = key; }
    if (out === key && FALLBACK[key]) {
      out = FALLBACK[key].replace(/\{(\w+)\}/g, function (w, n) { return vars && vars[n] != null ? String(vars[n]) : w; });
    }
    return out;
  }

  /* Breakpoints: the same numbers as tokens.css and chrome.css. */
  var LAYOUT = { compact: '(max-width: 639px)', expanded: '(min-width: 1024px)' };

  /* Feature modules, initialised in this order once the store is ready. The
   * tab guard goes first: it decides whether this tab may write before
   * anything opens a map. */
  var MODULES = ['tabs', 'sidebar', 'session', 'editor', 'notes', 'colorpicker', 'source', 'exporter', 'media', 'ink',
    'notebook', 'aiui', 'aichat', 'mentions', 'laser', 'trash', 'copies', 'palette', 'settings', 'help', 'welcome', 'pwa'];

  /* The ids the modules register (session: history.*, editor: node.*,
   * workspace: search.nodes and palette.open). */
  var UNDO = ['history.undo'];
  var REDO = ['history.redo'];
  var BARS = {
    top: [
      { slot: 'undo', ids: UNDO },
      { slot: 'redo', ids: REDO },
      /* The Markdown the map is written in, one press away on every screen
       * with a top capsule (phones reach it from "more"). */
      { slot: 'source', ids: ['source.toggle'] },
      /* The AI assistant's window (the sparkles). */
      { slot: 'ai', ids: ['ai.open'] },
      /* The chat with the AI, one press away (it says what to switch on when it is off). */
      { slot: 'chat', ids: ['ai.chat'] },
      /* The palette searches nodes too, so it stands in for a search command. */
      { slot: 'search', ids: ['search.nodes', 'palette.open'] }
    ],
    /* swap: while one of these commands can run, the button is that one
     * instead (on a root, 'add a child' and 'add a sibling' become a branch
     * on the left and one on the right - left first, as on the screen and
     * in the node toolbar: a phone has no room for four). */
    thumb: [
      { slot: 'child', ids: ['node.addChild'], swap: ['node.addLeft'] },
      { slot: 'sibling', ids: ['node.addSibling'], swap: ['node.addRight'] },
      { slot: 'edit', ids: ['node.rename'] },
      { slot: 'undo', ids: UNDO }
    ],
    /* A phone's top right: what the thumb bar has no room for and is
     * wanted often - the Markdown, the chat with the AI, the laser. */
    quick: [
      { slot: 'source', ids: ['source.toggle'] },
      { slot: 'chat', ids: ['ai.chat'] },
      { slot: 'laser', ids: ['view.laser'] }
    ],
    zoom: [
      { slot: 'zoomOut', ids: ['view.zoomOut'] },
      { slot: 'fit', ids: ['view.fit'] },
      { slot: 'zoomIn', ids: ['view.zoomIn'] },
      { slot: 'laser', ids: ['view.laser'] },
      { slot: 'tidy', ids: ['map.tidy'] }
    ]
  };
  /* What the desktop "more" menu lists: what is done to the open map and
   * how it is seen, plus a few ways out (export, import, settings, help).
   * It stays short enough to fit the window: the project and map chores
   * live in the sidebar's own menus, zoom in its capsule, and every
   * command in the palette (first row here). On phones the sheet lists
   * every group. */
  var MORE_GROUPS_WIDE = ['map', 'view', 'help'];
  var MORE_ADD_WIDE = ['file.import', 'export.open', 'export.markdown', 'settings.open'];
  var MORE_SKIP_WIDE = ['sidebar.newMap', 'map.rename', 'map.duplicate', 'map.importBranches', 'map.delete',
    'view.zoomIn', 'view.zoomOut', 'view.fit', 'view.sidebar', 'welcome.sample'];

  function addStrings() {
  i18n.add({
    en: {
      'app.region.sidebar': 'Projects and maps',
      'app.region.stage': 'Map',
      'app.region.source': 'Markdown',
      'app.region.quick': 'Markdown and AI',
      'app.region.actions': 'Actions',
      'app.region.zoom': 'Zoom',
      'app.cmd.sidebar': 'Show or hide the projects',
      'app.cmd.theme': 'Change the theme',
      'app.cmd.themeIs': 'Theme: {theme}',
      'app.cmd.viewOnly': 'View only',
      'app.cmd.fullscreen': 'Full screen',
      'app.cmd.zoomIn': 'Zoom in',
      'app.cmd.zoomOut': 'Zoom out',
      'app.cmd.fit': 'Fit the map',
      'app.help.sidebar': 'The list of projects and their maps. A drawer on phones and tablets.',
      'app.help.theme': 'System, light or dark, in turn.',
      'app.help.viewOnly': 'Look without changing anything. Escape comes back.',
      'theme.system': 'System',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'app.more': 'More',
      'app.moreTitle': 'More commands',
      'app.viewExit': 'Back to the controls',
      'app.drop': 'Drop to bring it in',
      'app.save.pending': 'Not saved yet',
      'app.save.saving': 'Saving',
      'app.save.saved': 'Saved at {time}',
      'app.save.failed': 'Saving failed',
      'app.save.memory': 'Not kept in this browser: export to keep it',
      'app.cmd.save': 'Save now',
      'app.help.save': 'MindRoot saves by itself a moment after each change. This writes everything at once.',
      'app.kw.save': 'save write store keep',
      'app.kw.sidebar': 'projects maps list drawer panel',
      'app.kw.theme': 'dark light mode appearance',
      'app.kw.viewOnly': 'read only presentation lock',
      'app.kw.fullscreen': 'full screen focus',
      'app.kw.zoom': 'zoom scale size',
      'app.saveDone': 'Saved',
      'app.saveReadOnly': 'This tab saves nothing: another tab keeps your maps.',
      'app.moduleFailed': 'Part of MindRoot did not start ({name}). The rest works.',
      'app.mapFailed': 'This map could not be opened.',
      'app.boot.title': 'MindRoot did not start',
      'app.boot.text': 'Your maps are still stored in this browser. Export them to keep a copy, then reload the page.',
      'app.boot.export': 'Export raw data',
      'app.boot.reload': 'Reload',
      'app.boot.exporting': 'Reading the stored data',
      'app.boot.exported': 'Exported: {file}',
      'app.boot.nothing': 'There is nothing stored in this browser.',
      'app.boot.exportFailed': 'The export did not work: {message}',
      'group.history': 'History',
      'group.node': 'Node',
      'group.format': 'Format',
      'group.edit': 'Edit',
      'group.map': 'Map',
      'group.view': 'View',
      'group.navigate': 'Move around',
      'group.project': 'Project',
      'group.file': 'Files',
      'group.app': 'MindRoot',
      'group.help': 'Help'
    },
    it: {
      'app.region.sidebar': 'Progetti e mappe',
      'app.region.stage': 'Mappa',
      'app.region.source': 'Markdown',
      'app.region.quick': 'Markdown e AI',
      'app.region.actions': 'Azioni',
      'app.region.zoom': 'Zoom',
      'app.cmd.sidebar': 'Mostra o nascondi i progetti',
      'app.cmd.theme': 'Cambia il tema',
      'app.cmd.themeIs': 'Tema: {theme}',
      'app.cmd.viewOnly': 'Sola lettura',
      'app.cmd.fullscreen': 'Schermo intero',
      'app.cmd.zoomIn': 'Ingrandisci',
      'app.cmd.zoomOut': 'Riduci',
      'app.cmd.fit': 'Adatta la mappa',
      'app.help.sidebar': "L'elenco dei progetti e delle loro mappe. Su telefono e tablet è un cassetto.",
      'app.help.theme': 'Sistema, chiaro o scuro, a turno.',
      'app.help.viewOnly': 'Guarda senza cambiare niente. Esc torna indietro.',
      'theme.system': 'Sistema',
      'theme.light': 'Chiaro',
      'theme.dark': 'Scuro',
      'app.more': 'Altro',
      'app.moreTitle': 'Altri comandi',
      'app.viewExit': 'Torna ai comandi',
      'app.drop': 'Rilascia per importare',
      'app.save.pending': 'Non ancora salvato',
      'app.save.saving': 'Salvataggio in corso',
      'app.save.saved': 'Salvato alle {time}',
      'app.save.failed': 'Salvataggio non riuscito',
      'app.save.memory': 'Non conservato in questo browser: esporta per tenerlo',
      'app.cmd.save': 'Salva ora',
      'app.help.save': 'MindRoot salva da solo poco dopo ogni modifica. Questo scrive tutto subito.',
      'app.kw.save': 'save write store keep salva scrivi conserva',
      'app.kw.sidebar': 'projects maps list drawer panel progetti mappe elenco cassetto pannello',
      'app.kw.theme': 'dark light mode appearance tema scuro chiaro aspetto',
      'app.kw.viewOnly': 'read only presentation lock sola lettura presentazione blocca',
      'app.kw.fullscreen': 'full screen focus schermo intero',
      'app.kw.zoom': 'zoom scale size ingrandisci riduci scala',
      'app.saveDone': 'Salvato',
      'app.saveReadOnly': "Questa scheda non salva niente: le tue mappe le conserva un'altra scheda.",
      'app.moduleFailed': 'Una parte di MindRoot non si è avviata ({name}). Il resto funziona.',
      'app.mapFailed': 'Questa mappa non si è aperta.',
      'app.boot.title': 'MindRoot non si è avviato',
      'app.boot.text': 'Le tue mappe sono ancora salvate in questo browser. Esportale per tenerne una copia, poi ricarica la pagina.',
      'app.boot.export': 'Esporta i dati grezzi',
      'app.boot.reload': 'Ricarica',
      'app.boot.exporting': 'Lettura dei dati salvati',
      'app.boot.exported': 'Esportato: {file}',
      'app.boot.nothing': "In questo browser non c'è niente di salvato.",
      'app.boot.exportFailed': "L'esportazione non è riuscita: {message}",
      'group.history': 'Cronologia',
      'group.node': 'Nodo',
      'group.format': 'Formato',
      'group.edit': 'Modifica',
      'group.map': 'Mappa',
      'group.view': 'Vista',
      'group.navigate': 'Spostamenti',
      'group.project': 'Progetto',
      'group.file': 'File',
      'group.app': 'MindRoot',
      'group.help': 'Aiuto'
    }
  });
  }

  /* ================================================================ shell state */

  var els = {};
  var shell = {
    layout: null,
    bars: { top: [], thumb: [], zoom: [], quick: [] },
    viewEsc: null,
    drawerEsc: null,
    themeMetas: []
  };

  function byId(id) { return document.getElementById(id); }

  function computeLayout() {
    if (util.matches(LAYOUT.compact)) return 'compact';
    if (util.matches(LAYOUT.expanded)) return 'expanded';
    return 'medium';
  }

  function isDrawer() { return shell.layout !== 'expanded'; }

  function viewOnly() { return root.getAttribute('data-mode') === 'view'; }

  /* ================================================================ theme */

  var mqDark = util.media('(prefers-color-scheme: dark)');

  function resolvedTheme() {
    var p = prefs.get('theme');
    if (p === 'light' || p === 'dark') return p;
    return mqDark && mqDark.matches ? 'dark' : 'light';
  }

  /* data-theme absent = follow the system; the two theme-color metas with
   * media queries then do the right thing on their own. A manual choice
   * sets both to the chosen paper, read from the tokens. */
  function paintTheme() {
    var pref = prefs.get('theme');
    if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
    else root.removeAttribute('data-theme');
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', pref === 'light' || pref === 'dark' ? pref : 'light dark');
    var paper = getComputedStyle(root).getPropertyValue('--paper').trim();
    shell.themeMetas.forEach(function (m) {
      m.el.setAttribute('content', pref === 'light' || pref === 'dark' ? (paper || m.initial) : m.initial);
    });
  }

  /* One crossfade of the whole page, never a transition on every element;
   * instant when motion is reduced or the API is missing. */
  function applyTheme(animate) {
    if (animate && typeof document.startViewTransition === 'function' && !util.reducedMotion() && document.visibilityState === 'visible') {
      try {
        var vt = document.startViewTransition(paintTheme);
        /* A second change while the first one fades skips the first: its promises
         * then reject ("Transition was skipped"), which nobody is waiting for. */
        if (vt) ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { if (vt[k] && typeof vt[k].catch === 'function') vt[k].catch(function () {}); });
        return;
      } catch (err) { /* fall through */ }
    }
    paintTheme();
  }

  function applyTransparency() {
    if (prefs.get('reduceTransparency')) root.setAttribute('data-transparency', 'reduce');
    else root.removeAttribute('data-transparency');
  }

  /* MindRoot's own arrow (css/tokens.css) unless the person asked for the
   * system's cursor; the theme, the kind of pointer and forced colours are
   * the stylesheet's business. */
  function applyCursor() {
    if (prefs.get('appCursor') === false) root.setAttribute('data-cursor', 'system');
    else root.removeAttribute('data-cursor');
  }

  function cycleTheme() {
    var order = ['system', 'light', 'dark'];
    var i = order.indexOf(prefs.get('theme'));
    prefs.set('theme', order[(i + 1) % order.length]);
  }

  /* ================================================================ sidebar */

  function sidebarIsOpen() {
    var state = root.getAttribute('data-sidebar');
    return isDrawer() ? state === 'open' : state !== 'closed';
  }

  function setSidebar(open, opts) {
    opts = opts || {};
    open = !!open;
    var wasOpen = sidebarIsOpen();
    root.setAttribute('data-sidebar', open ? 'open' : 'closed');
    if (els.sidebar) {
      els.sidebar.inert = !open;
      if (open) els.sidebar.removeAttribute('aria-hidden');
      else els.sidebar.setAttribute('aria-hidden', 'true');
    }
    if (els.toggle) els.toggle.setAttribute('aria-expanded', String(open));
    if (!isDrawer() && opts.persist !== false) prefs.set('sidebarOpen', open);
    if (isDrawer() && open) {
      if (!shell.drawerEsc) shell.drawerEsc = ui.escape.push(function () { setSidebar(false, { focus: true }); });
      if (opts.focus !== false) {
        /* The open map's row (the tree's roving stop) before the header's
         * buttons: that is where the person is in the list. */
        var target = els.sidebar.querySelector('[role="tree"] [tabindex="0"]') ||
          els.sidebar.querySelector('[tabindex="0"], [aria-current], button, a, input') || els.sidebar;
        util.nextFrame().then(function () { try { target.focus({ preventScroll: true }); } catch (err) { /* gone */ } });
      }
    } else if (shell.drawerEsc) {
      shell.drawerEsc();
      shell.drawerEsc = null;
    }
    if (!open && els.sidebar && els.sidebar.contains(document.activeElement) && els.toggle) {
      try { els.toggle.focus({ preventScroll: true }); } catch (err) { /* hidden */ }
    }
    if (wasOpen !== open) bus.emit('sidebar', { open: open, drawer: isDrawer() });
    scheduleBars();
  }

  function toggleSidebar() { setSidebar(!sidebarIsOpen(), { focus: true }); }

  /* A tap outside the open drawer closes it and does nothing else: the tap
   * that dismisses must not also select or pan the map underneath. Taps on
   * menus and dialogs opened from the drawer are not "outside". */
  function onOutsidePointer(event) {
    if (!isDrawer() || !sidebarIsOpen()) return;
    var target = event.target;
    if (!target || !target.closest) return;
    if (els.sidebar.contains(target) || (els.toggle && els.toggle.contains(target))) return;
    if (els.layers.contains(target) || target.closest('dialog')) return;
    setSidebar(false, { focus: false });
    event.preventDefault();
    event.stopPropagation();
    swallowNextClick();
  }

  function swallowNextClick() {
    function swallow(e) {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
    function cleanup() {
      window.removeEventListener('click', swallow, true);
      clearTimeout(timer);
    }
    window.addEventListener('click', swallow, true);
    var timer = setTimeout(cleanup, 500);
  }

  /* Swipe from the left edge to open the drawer, and swipe it back to close
   * it. The drawer follows the finger 1:1; on release it opens or closes by
   * distance (35% of its width) or by a flick. */
  var swipe = null;

  /* The edge is a thin strip of its own (.edge-swipe, touch-action: none)
   * over the stage's left border, under the chrome: a finger landing there
   * belongs to the drawer, not to the map, and the browser does not start a
   * pan of its own. Buttons near the edge sit above it and stay tappable. */
  function onSwipeDown(event) {
    if (event.pointerType === 'mouse' || !isDrawer() || viewOnly() || swipe) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var open = sidebarIsOpen();
    if (!open) {
      if (target !== els.edge || ui.isOpen()) return;
      event.preventDefault();
    } else if (!els.sidebar.contains(target)) {
      return;
    }
    swipe = { id: event.pointerId, x0: event.clientX, y0: event.clientY, open: open, live: false, samples: [], width: 0 };
  }

  function onSwipeMove(event) {
    if (!swipe || event.pointerId !== swipe.id) return;
    var dx = event.clientX - swipe.x0;
    var dy = event.clientY - swipe.y0;
    if (!swipe.live) {
      var horizontal = Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2;
      var rightWay = swipe.open ? dx < 0 : dx > 0;
      if (horizontal && rightWay) {
        swipe.live = true;
        swipe.width = els.sidebar.offsetWidth || 300;
        root.setAttribute('data-sidebar-drag', '');
        try { els.sidebar.setPointerCapture(event.pointerId); } catch (err) { /* fine without */ }
      } else if (Math.abs(dy) > 10 || Math.abs(dx) > 10) {
        swipe = null;
      }
      return;
    }
    event.preventDefault();
    var x = swipe.open ? util.clamp(dx, -swipe.width, 0) : util.clamp(dx - swipe.width, -swipe.width, 0);
    els.sidebar.style.translate = x + 'px 0';
    var now = performance.now();
    swipe.samples.push({ t: now, x: event.clientX });
    while (swipe.samples.length > 2 && now - swipe.samples[0].t > 100) swipe.samples.shift();
  }

  function onSwipeEnd(event) {
    if (!swipe || (event && event.pointerId !== swipe.id)) return;
    var s = swipe;
    swipe = null;
    if (!s.live) return;
    root.removeAttribute('data-sidebar-drag');
    els.sidebar.style.removeProperty('translate');
    var dx = (event ? event.clientX : s.x0) - s.x0;
    var samples = s.samples;
    var v = samples.length > 1 ? (samples[samples.length - 1].x - samples[0].x) / Math.max(1, samples[samples.length - 1].t - samples[0].t) : 0;
    var open;
    if (s.open) open = !(dx < -s.width * 0.35 || v < -0.3);
    else open = dx > s.width * 0.35 || v > 0.3;
    setSidebar(open, { focus: false });
    if (s.open && !open) swallowNextClick();
  }

  /* ================================================================ layout */

  function applyLayout() {
    var prev = shell.layout;
    var next = computeLayout();
    if (prev === next) return;
    shell.layout = next;
    root.setAttribute('data-layout', next);
    if (next === 'expanded') setSidebar(prefs.get('sidebarOpen'), { persist: false, focus: false });
    else setSidebar(false, { persist: false, focus: false });
    if (els.toggleUse) els.toggleUse.setAttribute('href', next === 'compact' ? '#i-menu' : '#i-sidebar');
    renderBars();
    /* A bar that comes into sight with the new layout gets its Tab stop. */
    if (shell.rovingThumb) shell.rovingThumb.refresh();
    if (shell.rovingZoom) shell.rovingZoom.refresh();
  }

  /* The share of the layout viewport an on-screen keyboard covers. iOS does
   * not shrink the layout viewport for the keyboard, so bottom bars and
   * toasts lift by this much; Chrome on Android resizes the layout itself
   * (interactive-widget) and this stays 0. Page zoom is not a keyboard. */
  function updateKeyboard() {
    var vv = window.visualViewport;
    if (!vv) return;
    var kb = 0;
    var top = 0;
    if (vv.scale <= 1.01) {
      kb = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
      /* With the keyboard up iOS also pans the page to show the field: the
       * band above offsetTop is out of sight, and modals centre below it. */
      top = Math.max(0, Math.round(vv.offsetTop));
    }
    if (kb < 60) { kb = 0; top = 0; }
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vv-top', top + 'px');
    root.toggleAttribute('data-keyboard', kb > 0);
    ui.placeToasts();
  }

  /* The room the floating chrome takes over the stage, for a map fitting
   * itself into what is actually visible. */
  function insets() {
    var out = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!els.stage || viewOnly()) return out;
    var stage = els.stage.getBoundingClientRect();
    var gap = 8;
    [els.lead, els.actions].forEach(function (el) {
      if (!el || el.offsetParent === null) return;
      var r = el.getBoundingClientRect();
      if (r.height) out.top = Math.max(out.top, Math.round(r.bottom - stage.top + gap));
    });
    /* The format bar docked above the thumb bar (a phone writing a name)
     * covers the map as much as the thumb bar does: a node opened for
     * writing behind it would be typed into blind. */
    var bar = ns.editor ? ns.editor.formatBar : null;
    var docked = bar && !bar.hidden && bar.hasAttribute('data-docked') ? bar : null;
    [els.thumbbar, els.zoombar, docked].forEach(function (el) {
      if (!el || el.hidden || !el.getClientRects().length) return;
      var r = el.getBoundingClientRect();
      if (r.height) out.bottom = Math.max(out.bottom, Math.round(stage.bottom - r.top + gap));
    });
    /* An iOS keyboard does not shrink the stage: it covers its foot. */
    var kb = parseFloat(root.style.getPropertyValue('--kb')) || 0;
    if (kb > 0) out.bottom = Math.max(out.bottom, Math.round(stage.bottom - (window.innerHeight - kb) + gap));
    out.top = Math.max(0, out.top);
    out.bottom = Math.max(0, out.bottom);
    return out;
  }

  /* Where toasts go (ui.placeToasts): centred over the free part of the
   * stage, above the chrome floating over its foot, clear of the panels
   * docked beside or under it. Null when the stage is too small to hold
   * one (a phone with the Markdown panel over everything). */
  function toastArea() {
    if (!els.stage) return null;
    var s = els.stage.getBoundingClientRect();
    if (s.width < 240 || s.height < 160) return null;
    var ins = insets();
    var vw = document.documentElement.clientWidth || window.innerWidth;
    return {
      left: s.left + ins.left,
      right: vw - s.right + ins.right,
      bottom: window.innerHeight - s.bottom + Math.max(ins.bottom, 8)
    };
  }

  /* ================================================================ bars */

  function resolveSlot(slot) {
    for (var i = 0; i < slot.ids.length; i++) if (commands.has(slot.ids[i])) return slot.ids[i];
    return null;
  }

  function barButton(id) {
    var cmd = commands.get(id);
    var b = ui.button({
      icon: cmd.icon || 'command',
      label: commands.title(id, { source: 'button' }),
      shortcut: cmd.keys && cmd.keys.length ? cmd.keys : null,
      command: id,
      onClick: function (event) {
        /* The command the button stands for now (a slot's swap). */
        commands.run(b.getAttribute('data-command') || id, { source: 'button', event: event });
        scheduleBars();
      }
    });
    return b;
  }

  /* The command a slot's button stands for now: the first of its swaps
   * that can run, else its own. */
  function slotCommand(entry) {
    var swaps = entry.slot && entry.slot.swap;
    if (swaps) {
      for (var i = 0; i < swaps.length; i++) {
        if (commands.has(swaps[i]) && commands.enabled(swaps[i], { source: 'button' })) return swaps[i];
      }
    }
    return entry.base;
  }

  function swapButton(entry, id) {
    if (entry.id === id) return;
    entry.id = id;
    var cmd = commands.get(id);
    entry.el.setAttribute('data-command', id);
    var use = entry.el.querySelector('use');
    if (use) use.setAttribute('href', '#i-' + ((cmd && cmd.icon) || 'command'));
    /* The label and tooltip follow in updateBars. */
    entry.el.removeAttribute('aria-label');
  }

  function moreButton() {
    var b = ui.button({ icon: 'more', label: t('app.more'), cls: 'btn--more' });
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () { openMore(b); });
    return b;
  }

  /* Controls a feature module places in the top capsule among the
   * generated buttons ({el, before: slot name}; notebook.js puts its
   * Map | Board switch ahead of search). Kept across rebuilds. */
  var topControls = [];

  function addTopControl(el, opts) {
    if (!el || el.nodeType !== 1) return function () {};
    var entry = { el: el, before: (opts && opts.before) || null };
    topControls.push(entry);
    shell.plan = null;
    shell.dirtyBars = true;
    scheduleBars();
    return function removeTopControl() {
      var i = topControls.indexOf(entry);
      if (i < 0) return;
      topControls.splice(i, 1);
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }

  function fillBar(container, slots, withMore, controls) {
    if (!container) return [];
    container.textContent = '';
    var list = [];
    var placed = [];
    slots.forEach(function (slot) {
      (controls || []).forEach(function (c) {
        if (c.before === slot.slot) { container.appendChild(c.el); placed.push(c); }
      });
      var id = resolveSlot(slot);
      if (!id) return;
      var b = barButton(id);
      container.appendChild(b);
      list.push({ id: id, base: id, slot: slot, el: b });
    });
    (controls || []).forEach(function (c) { if (placed.indexOf(c) < 0) container.appendChild(c.el); });
    if (withMore) container.appendChild(moreButton());
    return list;
  }

  function resolvedIds(slots) {
    return slots.map(resolveSlot).filter(Boolean).join(' ');
  }

  /* Rebuilt only when the set of commands behind the buttons changed (a
   * module registered one later), and focus survives the rebuild. */
  function renderBars() {
    if (!els.actions) return;
    var plan = { top: resolvedIds(BARS.top), thumb: resolvedIds(BARS.thumb), zoom: resolvedIds(BARS.zoom), quick: resolvedIds(BARS.quick) };
    if (shell.plan && shell.plan.top === plan.top && shell.plan.thumb === plan.thumb && shell.plan.zoom === plan.zoom && shell.plan.quick === plan.quick) {
      updateBars();
      return;
    }
    shell.plan = plan;
    var active = document.activeElement;
    var bar = active && active.closest ? active.closest('#topbar-actions, #thumbbar, #zoombar, #topbar-quick') : null;
    var key = bar ? (active.getAttribute('data-command') || (active.classList.contains('btn--more') ? 'more' : null)) : null;
    shell.bars.top = fillBar(els.actions, BARS.top, true, topControls);
    shell.bars.thumb = fillBar(els.thumbbar, BARS.thumb, true);
    shell.bars.zoom = fillBar(els.zoombar, BARS.zoom, false);
    shell.bars.quick = fillBar(els.quick, BARS.quick, false);
    if (shell.rovingQuick) shell.rovingQuick.refresh();
    if (shell.rovingTop) shell.rovingTop.refresh();
    if (shell.rovingZoom) shell.rovingZoom.refresh();
    if (shell.rovingThumb) shell.rovingThumb.refresh();
    if (bar && key) {
      var again = bar.querySelector(key === 'more' ? '.btn--more' : '[data-command="' + key + '"]');
      if (again) again.focus({ preventScroll: true });
    }
    updateBars();
  }

  /* Enabled, pressed and labelled from each command's when(), checked() and
   * title(), on every event that can change them (one pass per frame). */
  function updateBars() {
    var ctx = { source: 'button' };
    ['top', 'thumb', 'zoom', 'quick'].forEach(function (name) {
      (shell.bars[name] || []).forEach(function (b) {
        swapButton(b, slotCommand(b));
        if (!commands.has(b.id)) return;
        var on = commands.enabled(b.id, ctx);
        if (on) b.el.removeAttribute('aria-disabled');
        else b.el.setAttribute('aria-disabled', 'true');
        var pressed = commands.checked(b.id, ctx);
        if (pressed === undefined) b.el.removeAttribute('aria-pressed');
        else b.el.setAttribute('aria-pressed', String(pressed));
        var label = commands.title(b.id, ctx);
        if (b.el.getAttribute('aria-label') !== label) {
          b.el.setAttribute('aria-label', label);
          ui.tooltip(b.el, label, commands.get(b.id).keys);
        }
      });
    });
    /* The thumb bar always holds at least "more", the phone's way in to
     * every command without a button. */
    if (els.thumbbar) els.thumbbar.hidden = false;
    if (els.zoombar) {
      var anyZoom = shell.bars.zoom.some(function (b) { return commands.enabled(b.id, ctx); });
      var wasHidden = els.zoombar.hidden;
      els.zoombar.hidden = !anyZoom;
      /* Its roving stop is worked out from the buttons on show: one set
       * while the bar was hidden found none, and the bar was no Tab stop. */
      if (wasHidden && anyZoom && shell.rovingZoom) shell.rovingZoom.refresh();
    }
    if (els.toggle) {
      var cmd = commands.get('view.sidebar');
      ui.tooltip(els.toggle, commands.label('view.sidebar'), cmd ? cmd.keys : null);
    }
  }

  var scheduleBars = util.throttleFrame(function () {
    if (shell.dirtyBars) {
      shell.dirtyBars = false;
      renderBars();
    } else {
      updateBars();
    }
    renderTitle();
  });

  function groupLabel(g) {
    var key = 'group.' + g;
    return i18n.has(key) ? t(key) : g.charAt(0).toUpperCase() + g.slice(1);
  }

  /* Everything the bars do not show, grouped: on phones every group (the
   * sheet is the way in to whatever has no button), on wider screens the
   * map, view, project, file, app and help commands. */
  function moreItems() {
    var compact = shell.layout === 'compact';
    var shown = {};
    (compact ? shell.bars.thumb : shell.bars.top).forEach(function (b) { shown[b.id] = true; });
    var ctx = { source: 'menu' };
    var groups = {};
    commands.all().forEach(function (cmd) {
      if (cmd.showInPalette === false || shown[cmd.id] || cmd.id === 'palette.open') return;
      if (!compact && (MORE_GROUPS_WIDE.indexOf(cmd.group) < 0 && MORE_ADD_WIDE.indexOf(cmd.id) < 0)) return;
      if (!compact && MORE_SKIP_WIDE.indexOf(cmd.id) >= 0) return;
      if (!commands.enabled(cmd, ctx)) return;
      (groups[cmd.group] || (groups[cmd.group] = [])).push(cmd);
    });
    var items = [];
    if (commands.has('palette.open') && commands.enabled('palette.open', ctx)) {
      var p = commands.get('palette.open');
      items.push({ label: commands.title('palette.open', ctx), icon: p.icon || 'command', shortcut: p.keys, onSelect: function () { commands.run('palette.open', ctx); } });
    }
    var order = commands.GROUPS.slice();
    Object.keys(groups).forEach(function (g) { if (order.indexOf(g) < 0) order.push(g); });
    order.forEach(function (g) {
      if (!groups[g]) return;
      if (items.length) items.push('-');
      items.push({ heading: groupLabel(g) });
      groups[g].forEach(function (cmd) {
        items.push({
          label: commands.title(cmd.id, ctx),
          icon: cmd.icon,
          shortcut: cmd.keys,
          checked: commands.checked(cmd, ctx),
          onSelect: function () { commands.run(cmd.id, ctx); scheduleBars(); }
        });
      });
    });
    return items;
  }

  function openMore(anchor) {
    ui.menu(anchor, moreItems(), { align: 'end', title: t('app.moreTitle'), label: t('app.moreTitle') });
  }

  /* ================================================================ title, save */

  function renderTitle() {
    if (!els.title) return;
    var store = ns.store;
    var here = null;
    var project = null;
    var map = null;
    try {
      here = store && typeof store.here === 'function' ? store.here() : null;
      project = here && here.projectId ? store.project(here.projectId) : null;
      map = here && here.mapId ? store.map(here.projectId, here.mapId) : null;
    } catch (err) { project = map = null; }
    var pName = project && project.name ? String(project.name) : 'MindRoot';
    var mName = map && map.name ? String(map.name) : '';
    if (els.titleProject.textContent !== pName) els.titleProject.textContent = pName;
    if (els.titleMap.textContent !== mName) els.titleMap.textContent = mName;
    els.title.toggleAttribute('data-has-map', !!mName);
    var full = mName ? pName + ' / ' + mName : pName;
    if (els.title.getAttribute('title') !== full) els.title.setAttribute('title', full);
    /* A part that only repeats the app's name (the sample project is called
     * MindRoot) is said once. */
    var parts = [mName, project ? pName : ''].filter(function (s) { return s && s !== 'MindRoot'; });
    var doc = parts.concat(['MindRoot']).join(' - ');
    if (document.title !== doc) document.title = doc;
  }

  var lastSave = 'idle';
  function onSave(detail) {
    var state = (detail && detail.state) || 'idle';
    var text = '';
    if (state === 'pending') text = t('app.save.pending');
    else if (state === 'saving') text = t('app.save.saving');
    else if (state === 'saved') text = t('app.save.saved', { time: util.formatDate((detail && detail.at) || Date.now(), 'time') });
    else if (state === 'failed') text = t('app.save.failed');
    else if (state === 'memory') text = t('app.save.memory');
    els.save.setAttribute('data-state', state);
    els.saveText.textContent = text;
    if (text) els.save.setAttribute('title', text); else els.save.removeAttribute('title');
    /* Spoken only when it matters: a failure, the memory-only state, and
     * the recovery after them. Every "saving / saved" would be noise. */
    var bad = state === 'failed' || state === 'memory';
    if (bad || ((lastSave === 'failed' || lastSave === 'memory') && state === 'saved')) els.saveStatus.textContent = text;
    lastSave = state;
  }

  /* ================================================================ view only, fullscreen */

  function setViewOnly(on) {
    on = !!on;
    if (on === viewOnly()) return;
    var active = document.activeElement;
    if (on) {
      ui.closeTransient();
      if (isDrawer() && sidebarIsOpen()) setSidebar(false, { focus: false });
      root.setAttribute('data-mode', 'view');
      els.viewExit.hidden = false;
      shell.viewEsc = ui.escape.push(function () { setViewOnly(false); });
      /* The control that had focus is about to disappear with the chrome:
       * focus goes to the way back, and returns there afterwards. */
      if (active && active.closest && active.closest('#topbar, #thumbbar, #sidebar, #zoombar, #source')) {
        shell.viewFocus = active;
        els.viewExit.focus({ preventScroll: true });
      }
    } else {
      root.removeAttribute('data-mode');
      els.viewExit.hidden = true;
      if (shell.viewEsc) { shell.viewEsc(); shell.viewEsc = null; }
      var back = shell.viewFocus;
      shell.viewFocus = null;
      if (active === els.viewExit || active === document.body) {
        if (back && back.isConnected) back.focus({ preventScroll: true });
        else if (els.toggle) els.toggle.focus({ preventScroll: true });
      }
    }
    bus.emit('prefs', { key: 'mode', value: on ? 'view' : 'edit' });
    scheduleBars();
  }

  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fullscreenAvailable() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }
  function toggleFullscreen() {
    var p = null;
    if (fullscreenElement()) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) p = exit.call(document);
    } else {
      var el = document.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) p = req.call(el);
    }
    if (p && typeof p.catch === 'function') p.catch(function () { /* refused by the browser: nothing to undo */ });
  }

  /* ================================================================ the map view */

  function mapView() {
    var s = ns.session;
    if (!s || !s.view) return null;
    try {
      var cur = typeof s.current === 'function' ? s.current() : null;
      if (cur === null) return null;
    } catch (err) { return null; }
    return s.view;
  }

  function stageCenter() {
    var r = els.stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ================================================================ saving */

  var HANDOVER_WAIT = 2500;

  /* Whatever is held outside the store is handed to it first: the camera
   * the session has not written yet, the drawings being edited (ink saves
   * them through their host). Modules with work of their own in flight hear
   * 'flush' on the bus and may pass a promise to waitUntil; it is waited
   * for (up to 2.5 s) when there is time to wait - Mod+S - and not when the
   * page is going away, where only what is synchronous can still happen. */
  function handOver(reason) {
    var waits = [];
    try { if (ns.session && typeof ns.session.flush === 'function') ns.session.flush(); } catch (err) { report(err); }
    try { if (ns.ink && typeof ns.ink.flush === 'function') ns.ink.flush(); } catch (err) { report(err); }
    bus.emit('flush', { reason: reason, waitUntil: function waitUntil(p) { waits.push(Promise.resolve(p).catch(report)); } });
    return waits;
  }

  function report(err) {
    if (window.console) console.error('MindRoot: saving what was open failed', err);
  }

  function storageFlush() {
    var S = ns.storage;
    if (!S || typeof S.flush !== 'function') return Promise.resolve(false);
    return Promise.resolve(S.flush()).catch(function (err) { report(err); return false; });
  }

  /* Mod+S: everything written now, and a word on how it went - the truth,
   * not a "saved" from a tab or a browser that keeps nothing. */
  async function saveNow() {
    var waits = handOver('save');
    if (waits.length) {
      await Promise.race([Promise.all(waits), new Promise(function (r) { setTimeout(r, HANDOVER_WAIT); })]);
    }
    /* A drawing handed over above reaches the store a moment later. */
    await util.nextFrame();
    var ok = await storageFlush();
    var S = ns.storage;
    var state = S && typeof S.saveState === 'function' ? S.saveState().state : null;
    var lockedOut = !!(ns.tabs && typeof ns.tabs.readOnly === 'function' && ns.tabs.readOnly());
    if (lockedOut) ui.toast(t('app.saveReadOnly'));
    else if (ok && state !== 'failed') ui.toast(t('app.saveDone'));
    else if (state === 'memory' || (S && typeof S.available === 'function' && !S.available())) ui.toast(t('app.save.memory'), { kind: 'error' });
    else ui.toast(t('app.save.failed'), { kind: 'error' });
    return ok;
  }

  /* Leaving or hiding the page: the hand-over runs ahead of storage's own
   * listeners (capture on the target runs first), so the write storage
   * starts already holds the drawing and the camera. */
  function installLifecycle() {
    function leave() {
      handOver('leave');
      storageFlush();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') leave();
    }, true);
    window.addEventListener('pagehide', leave, true);
    /* A reload or a closed tab: what is being written (a name, the Markdown
     * panel's last keys) reaches the store here, ahead of storage's own
     * beforeunload, which then sees a change pending: it starts the write
     * and asks the browser to hold the page. By pagehide it is too late for
     * the write to finish. */
    window.addEventListener('beforeunload', function () { handOver('leave'); }, true);
  }

  /* ================================================================ commands */

  function registerCommands() {
    commands.register({
      id: 'file.save', label: 'app.cmd.save', group: 'file', icon: 'save', keys: [{ key: 'Mod+S', global: true }],
      keywords: t('app.kw.save'), help: 'app.help.save',
      run: function () { return saveNow(); }
    });
    commands.register({
      id: 'view.sidebar', label: 'app.cmd.sidebar', group: 'view', icon: 'sidebar', keys: ['Mod+B'],
      keywords: t('app.kw.sidebar'), help: 'app.help.sidebar',
      when: function () { return !viewOnly(); },
      checked: function () { return sidebarIsOpen(); },
      run: function () { toggleSidebar(); }
    });
    commands.register({
      id: 'view.theme', label: 'app.cmd.theme', group: 'view', icon: 'sun',
      keywords: t('app.kw.theme'), help: 'app.help.theme',
      title: function () { return t('app.cmd.themeIs', { theme: t('theme.' + prefs.get('theme')) }); },
      run: function () { cycleTheme(); }
    });
    commands.register({
      id: 'view.readOnly', label: 'app.cmd.viewOnly', group: 'view', icon: 'eye', keys: ['Mod+E'],
      keywords: t('app.kw.viewOnly'), help: 'app.help.viewOnly',
      checked: function () { return viewOnly(); },
      run: function () { setViewOnly(!viewOnly()); }
    });
    commands.register({
      id: 'view.fullscreen', label: 'app.cmd.fullscreen', group: 'view', icon: 'fullscreen',
      keywords: t('app.kw.fullscreen'),
      when: fullscreenAvailable,
      checked: function () { return !!fullscreenElement(); },
      run: toggleFullscreen
    });
    commands.register({
      id: 'view.zoomIn', label: 'app.cmd.zoomIn', group: 'view', icon: 'zoom-in', keys: ['Mod++', 'Mod+='], repeat: true,
      keywords: t('app.kw.zoom'),
      when: function () { return !!mapView(); },
      run: function () { mapView().zoomBy(1.25, stageCenter()); }
    });
    commands.register({
      id: 'view.zoomOut', label: 'app.cmd.zoomOut', group: 'view', icon: 'zoom-out', keys: ['Mod+-'], repeat: true,
      keywords: t('app.kw.zoom'),
      when: function () { return !!mapView(); },
      run: function () { mapView().zoomBy(0.8, stageCenter()); }
    });
    commands.register({
      id: 'view.fit', label: 'app.cmd.fit', group: 'view', icon: 'fit', keys: ['Mod+0'],
      keywords: t('app.kw.zoom'),
      when: function () { return !!mapView(); },
      /* From the keyboard the camera jumps; from a button it glides. */
      run: function (ctx) { mapView().fit({ animate: ctx.source !== 'key' && !util.reducedMotion() }); }
    });
  }

  /* ================================================================ drag and drop */

  /* Files dragged over the window show the overlay; a drop anywhere is
   * handed to whoever listens on the bus ('drop', synchronously, so they
   * can read the DataTransfer inside the event). Without the preventDefault
   * on dragover and drop the browser would navigate to the dropped file and
   * leave the app. */
  var dragDepth = 0;
  function hasFiles(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  }
  function dropReset() {
    dragDepth = 0;
    if (els.drop) els.drop.hidden = true;
  }
  function installDrop() {
    window.addEventListener('dragenter', function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth++;
      if (!viewOnly()) els.drop.hidden = false;
    });
    window.addEventListener('dragover', function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = viewOnly() ? 'none' : 'copy';
    });
    window.addEventListener('dragleave', function (event) {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) els.drop.hidden = true;
    });
    window.addEventListener('drop', function (event) {
      var files = hasFiles(event);
      dropReset();
      if (!files) return;
      event.preventDefault();
      if (viewOnly()) return;
      bus.emit('drop', {
        event: event,
        dataTransfer: event.dataTransfer,
        files: Array.prototype.slice.call(event.dataTransfer.files || []),
        x: event.clientX,
        y: event.clientY
      });
    });
    window.addEventListener('dragend', dropReset);
    window.addEventListener('blur', function () { if (dragDepth) dropReset(); });
  }

  /* ================================================================ shell setup */

  function shellInit() {
    els.app = byId('app');
    els.sidebar = byId('sidebar');
    els.main = byId('main');
    els.stage = byId('stage');
    els.source = byId('source');
    els.topbar = byId('topbar');
    els.lead = byId('topbar-lead');
    els.actions = byId('topbar-actions');
    els.thumbbar = byId('thumbbar');
    els.quick = byId('topbar-quick');
    els.layers = byId('layers') || document.body;
    els.drop = byId('drop');
    els.banners = byId('banners');
    els.toggle = byId('sidebar-toggle');
    els.toggleUse = els.toggle ? els.toggle.querySelector('use') : null;
    els.title = byId('title');
    els.titleProject = els.title.querySelector('.title__project');
    els.titleMap = els.title.querySelector('.title__map');
    els.save = byId('save-state');
    els.saveText = els.save.querySelector('.save__text');
    els.saveStatus = byId('save-status');

    shell.themeMetas = Array.prototype.map.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) {
      var media = m.getAttribute('media') || '';
      return { el: m, initial: /dark/.test(media) ? '#131519' : '#fbfbfc' };
    });

    /* The zoom capsule (thin glass), over the stage's bottom-right corner on
     * screens with a mouse or a tablet; phones pinch. */
    els.zoombar = h('div', {
      id: 'zoombar',
      class: 'capsule glass glass--thin',
      role: 'toolbar',
      'aria-label': t('app.region.zoom'),
      'data-i18n-aria-label': 'app.region.zoom',
      hidden: true
    });
    els.main.appendChild(els.zoombar);

    /* In the stage, ahead of #floaters: bounded by the map's own box (so
     * never over the Markdown panel) and painted under whatever the stage
     * holds after it (see .edge-swipe in chrome.css). */
    els.edge = h('div', { class: 'edge-swipe', 'aria-hidden': 'true' });
    els.stage.insertBefore(els.edge, byId('floaters'));
    ui.ownTouches(els.edge);

    els.viewExit = ui.button({ icon: 'close', label: t('app.viewExit'), shortcut: 'Escape', cls: 'view-exit glass', onClick: function () { setViewOnly(false); } });
    els.viewExit.hidden = true;
    els.layers.appendChild(els.viewExit);

    els.toggle.addEventListener('click', function () { commands.run('view.sidebar', { source: 'button' }); });

    shell.rovingTop = ui.roving(els.actions);
    shell.rovingZoom = ui.roving(els.zoombar);
    /* The phone's thumb bar is a toolbar too: one Tab stop, arrows inside. */
    shell.rovingThumb = els.thumbbar ? ui.roving(els.thumbbar) : null;
    shell.rovingQuick = els.quick ? ui.roving(els.quick) : null;

    applyLayout();
    ['(max-width: 639px)', '(min-width: 1024px)'].forEach(function (q) {
      var m = util.media(q);
      if (m && m.addEventListener) m.addEventListener('change', applyLayout);
    });
    window.addEventListener('resize', util.throttleFrame(applyLayout));

    if (window.visualViewport) {
      var kb = util.throttleFrame(updateKeyboard);
      window.visualViewport.addEventListener('resize', kb);
      window.visualViewport.addEventListener('scroll', kb);
    }
    updateKeyboard();

    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('pointerdown', onSwipeDown, true);
    window.addEventListener('pointermove', onSwipeMove, { passive: false });
    window.addEventListener('pointerup', onSwipeEnd);
    window.addEventListener('pointercancel', onSwipeEnd);

    /* The source module shows and hides #source; the phone layout needs to
     * know, to keep the panel above the thumb bar. */
    function syncSource() {
      var open = !!els.source && !els.source.hidden;
      if (open) root.setAttribute('data-source', 'open'); else root.removeAttribute('data-source');
    }
    if (els.source && typeof MutationObserver === 'function') {
      new MutationObserver(syncSource).observe(els.source, { attributes: true, attributeFilter: ['hidden'] });
    }
    syncSource();

    /* 'layout' = the stage changed size (sidebar, panel, window, keyboard). */
    var emitLayout = util.throttleFrame(function () { bus.emit('layout'); ui.placeToasts(); });
    if (typeof ResizeObserver === 'function') new ResizeObserver(emitLayout).observe(els.stage);
    else window.addEventListener('resize', emitLayout);

    if (mqDark && mqDark.addEventListener) {
      mqDark.addEventListener('change', function () {
        if (prefs.get('theme') === 'system') bus.emit('theme', { key: 'theme', value: 'system', resolved: resolvedTheme() });
      });
    }
    prefs.on('theme', function () { applyTheme(true); scheduleBars(); });
    prefs.on('reduceTransparency', applyTransparency);
    prefs.on('appCursor', applyCursor);
    prefs.on('sidebarOpen', function (v) { if (!isDrawer() && v !== sidebarIsOpen()) setSidebar(v, { persist: false, focus: false }); });

    bus.on('save', onSave);
    bus.on('lang', function () {
      i18n.apply(document);
      /* Every label the shell wrote itself is rebuilt in the new language. */
      shell.plan = null;
      shell.dirtyBars = true;
      els.viewExit.setAttribute('aria-label', t('app.viewExit'));
      ui.tooltip(els.viewExit, t('app.viewExit'), 'Escape');
      scheduleBars();
    });
    bus.on('commands', function () { shell.dirtyBars = true; scheduleBars(); });
    bus.on('map:opened', function (d) {
      /* A map chosen in the drawer closes it; the neighbour that opens when
       * the open map is deleted from the drawer does not. */
      if (isDrawer() && sidebarIsOpen() && !(d && d.cause === 'gone')) setSidebar(false, { focus: false });
      scheduleBars();
    });
    /* Not 'view': the camera moves every frame of a pan, and nothing in the
     * bars depends on where it is. */
    ['store', 'selection', 'map:rendered', 'tabs', 'prefs', 'booted'].forEach(function (type) {
      bus.on(type, function () { scheduleBars(); });
    });
    /* What floats over the map's foot changed without the stage changing
     * size: a format bar docked on a phone, the viewer, view-only mode. */
    var placeToastsSoon = util.throttleFrame(function () { ui.placeToasts(); });
    ['editor:rename', 'media:viewer', 'prefs', 'sidebar'].forEach(function (type) { bus.on(type, placeToastsSoon); });
    document.addEventListener('fullscreenchange', function () { scheduleBars(); });
    document.addEventListener('webkitfullscreenchange', function () { scheduleBars(); });

    installDrop();
    registerCommands();
    renderBars();
    renderTitle();
  }

  function installKeys() {
    document.addEventListener('keydown', function (event) { commands.handleKey(event); });
  }

  /* ================================================================ boot */

  async function initModules() {
    for (var i = 0; i < MODULES.length; i++) {
      var name = MODULES[i];
      var mod = ns[name];
      if (!mod || typeof mod.init !== 'function') continue;
      try {
        var r = mod.init();
        if (r && typeof r.then === 'function') await r;
      } catch (err) {
        if (window.console) console.error('MindRoot: ' + name + '.init failed', err);
        ui.banner('module-' + name, { kind: 'error', text: t('app.moduleFailed', { name: name }) });
      }
    }
  }

  /* The session's init() (or welcome's seeding) has usually started opening
   * this map already; open() then hands back that same render, and it is
   * awaited all the same: ready means the first map is laid out and
   * map:rendered has been said, not merely that it was asked for. */
  async function openLastMap() {
    var s = ns.session;
    var store = ns.store;
    if (!s || typeof s.open !== 'function' || !store || typeof store.here !== 'function') return;
    var here = store.here();
    if (!here || !here.projectId || !here.mapId) return;
    try {
      await s.open(here.projectId, here.mapId);
    } catch (err) {
      if (window.console) console.error('MindRoot: the last map did not open', err);
      ui.banner('map-open', { kind: 'error', text: t('app.mapFailed') });
    }
  }

  async function boot() {
    try {
      var absent = ['util', 'i18n', 'bus', 'prefs', 'ui', 'commands'].filter(function (k) { return !ns[k]; });
      if (absent.length) throw new Error('core files did not load: ' + absent.join(', '));
      addStrings();
      i18n.init();
      i18n.apply(document);
      applyTheme(false);
      applyTransparency();
      applyCursor();
      shellInit();
      installKeys();

      var data = null;
      if (ns.storage && typeof ns.storage.open === 'function') {
        var opened = await ns.storage.open();
        shell.opened = opened || null;
        data = opened ? opened.data : null;
      }
      installLifecycle();
      if (ns.store && typeof ns.store.init === 'function') {
        if (typeof ns.store.subscribe === 'function') {
          ns.store.subscribe(function (change) { bus.emit('store', change); });
        }
        ns.store.init(data || null);
      }

      await initModules();
      await openLastMap();

      /* The bars are built before the app says it has booted (not on the
       * next frame): whoever waits for booted finds the buttons there. */
      shell.dirtyBars = false;
      renderBars();
      renderTitle();
      ns.booted = true;
      root.setAttribute('data-booted', '');
      bus.emit('booted');
      resolveReady();
      afterBoot();
    } catch (err) {
      bootFailed(err);
    }
  }

  /* Decoration stays off the startup path. */
  function afterBoot() {
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 250); };
    idle(function () { if (ns.glass) ns.glass.sync(); });
  }

  /* ================================================================ boot failure */

  function dbName() {
    try { return new URLSearchParams(location.search).get('db') || 'mindroot2'; } catch (err) { return 'mindroot2'; }
  }

  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function saveFile(blob, name) {
    if (util && util.download) return util.download(blob, name);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    return Promise.resolve(true);
  }

  /* Blobs, bytes and dates survive JSON as tagged objects. */
  async function encodeValue(v) {
    if (v == null || typeof v !== 'object') return v;
    if (typeof Blob === 'function' && v instanceof Blob) return { $blob: await blobToDataURL(v), type: v.type, size: v.size };
    if (v instanceof ArrayBuffer) return { $bytes: toBase64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { $bytes: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Date) return { $date: v.toISOString() };
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < v.length; i++) arr.push(await encodeValue(v[i]));
      return arr;
    }
    var out = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = await encodeValue(v[k]);
    return out;
  }

  /* Reads every store of the database as it is, without the storage module
   * (which may be the part that broke). A database that does not exist is
   * not created: the upgrade is aborted. */
  function dumpDatabase(name) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { resolve(null); return; }
      var req;
      try { req = window.indexedDB.open(name); } catch (err) { reject(err); return; }
      var fresh = false;
      req.onupgradeneeded = function () {
        fresh = true;
        try { req.transaction.abort(); } catch (err) { /* nothing to abort */ }
      };
      req.onerror = function () { if (fresh) resolve(null); else reject(req.error || new Error('IndexedDB')); };
      req.onblocked = function () { reject(new Error('blocked')); };
      req.onsuccess = function () {
        var db = req.result;
        var names = Array.prototype.slice.call(db.objectStoreNames);
        if (!names.length) { db.close(); resolve(null); return; }
        var tx = db.transaction(names, 'readonly');
        var raw = {};
        names.forEach(function (n) {
          var store = tx.objectStore(n);
          var keys = store.getAllKeys();
          var values = store.getAll();
          raw[n] = { keys: keys, values: values };
        });
        tx.oncomplete = function () {
          db.close();
          var stores = {};
          names.forEach(function (n) {
            var ks = raw[n].keys.result || [];
            var vs = raw[n].values.result || [];
            stores[n] = ks.map(function (k, i) { return { key: k, value: vs[i] }; });
          });
          resolve(stores);
        };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB')); };
      };
    });
  }

  async function exportRaw(status) {
    var name = dbName();
    status.textContent = t('app.boot.exporting');
    try {
      var stores = await dumpDatabase(name);
      if (!stores) { status.textContent = t('app.boot.nothing'); return; }
      var encoded = await encodeValue(stores);
      var payload = { format: 'mindroot2-raw', version: 1, database: name, exportedAt: new Date().toISOString(), stores: encoded };
      var file = 'mindroot2-raw-' + new Date().toISOString().slice(0, 10) + '.json';
      await saveFile(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), file);
      status.textContent = t('app.boot.exported', { file: file });
    } catch (err) {
      status.textContent = t('app.boot.exportFailed', { message: (err && err.message) || String(err) });
    }
  }

  function bootFailed(err) {
    ns.bootError = err;
    if (window.console) console.error('MindRoot did not start', err);
    try { showBootFailure(err); } catch (screenErr) { /* the console has it */ }
    rejectReady(err);
  }

  /* The failure screen is built with plain DOM calls: util.js may be the
   * very thing that failed. */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function showBootFailure(err) {
    var app = byId('app');
    if (app) { app.inert = true; app.setAttribute('aria-hidden', 'true'); }
    var status = el('p', 'boot-fail__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var exportBtn = el('button', 'btn btn--primary');
    exportBtn.type = 'button';
    exportBtn.appendChild(el('span', 'btn__label', t('app.boot.export')));
    var reloadBtn = el('button', 'btn btn--text');
    reloadBtn.type = 'button';
    reloadBtn.appendChild(el('span', 'btn__label', t('app.boot.reload')));
    exportBtn.addEventListener('click', function () { exportRaw(status); });
    reloadBtn.addEventListener('click', function () { location.reload(); });
    var detail = (err && (err.stack || err.message)) || String(err);
    var actions = el('div', 'boot-fail__actions');
    actions.appendChild(exportBtn);
    actions.appendChild(reloadBtn);
    var card = el('div', 'boot-fail__card');
    card.appendChild(el('h1', 'boot-fail__title', t('app.boot.title')));
    card.appendChild(el('p', 'boot-fail__text', t('app.boot.text')));
    card.appendChild(el('pre', 'boot-fail__error', detail));
    card.appendChild(actions);
    card.appendChild(status);
    var screen = el('div', 'boot-fail');
    screen.setAttribute('role', 'alert');
    screen.appendChild(card);
    document.body.appendChild(screen);
    exportBtn.focus();
  }

  /* ================================================================ public */

  ns.shell = {
    layout: function layout() { return shell.layout; },
    isCompact: function isCompact() { return shell.layout === 'compact'; },
    sidebar: {
      open: function open() { setSidebar(true); },
      close: function close() { setSidebar(false); },
      toggle: toggleSidebar,
      isOpen: sidebarIsOpen,
      isDrawer: isDrawer
    },
    viewOnly: viewOnly,
    setViewOnly: setViewOnly,
    theme: resolvedTheme,
    insets: insets,
    toastArea: toastArea,
    refresh: function refresh() { shell.dirtyBars = true; scheduleBars(); },
    addTopControl: addTopControl,
    bars: BARS,
    /* What storage.open() answered at boot ({data, fresh}), for the
     * welcome to tell a first run. */
    opened: function opened() { return shell.opened || null; },
    moreItems: moreItems,
    dumpDatabase: dumpDatabase,
    exportRaw: exportRaw
  };

  boot();
})(window.MindRoot);
