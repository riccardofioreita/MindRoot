/* MindRoot - pictures and drawings in maps: bringing pictures in, placing
 * them in a node, the viewer that shows a photo or a node's drawing (a
 * notebook), and the panel of a project's pictures.
 *
 * A picture is a project file under assets/ named by the map in plain
 * Markdown (`![name](assets/cat.png)`); the bytes live in IndexedDB
 * (ns.storage) and the map view asks for them through the session. A drawing
 * is the same thing with a name that says it is editable ('*.ink.svg', and
 * earlier '*.excalidraw.svg'): the file is the picture, and the
 * editor (ns.ink) reads its scene back out of it.
 *
 * Intake. The media.image command (a file picker, several at once), a paste
 * of image files (into the field being renamed when there is one - the
 * editor hands those over - else into the selected node), and a drop of
 * files (onto the node under the pointer, else the selection, else a new
 * 'Images' root, which doc.addImage makes). Everything that arrives at once
 * is ONE undo step: the bytes are stored first (storage.saveAsset, by
 * content), then one store transaction names every file in the project and
 * writes the map once. Photos bigger than 4096 px on a side are made smaller
 * first (a node shows them at 220 px; IndexedDB, exports and phones carry
 * the full size), and a toast says so. What a drop brings that is not a
 * picture - a ZIP, a JSON, a .md, a PNG that carries a map, a folder - goes
 * to the import (ns.archive), never into a node.
 *
 * Placement is Markdown too (doc.setImagePosition: pictures before the words
 * stand left, after them right, before plus a marker above). One menu
 * offers it for photos and for drawings in either box of a node
 * (pictureMenu); 'take it out' removes the last picture of that kind and
 * sends its file to the trash as a figure in the same step.
 *
 * The viewer is one panel next to the map (split: beside it on a wide
 * screen, under it on a tall one or a phone), over all of it (full) or a
 * card floating over it, as prefs.viewer says; the seam and the card's
 * place and size are remembered per device (prefs.mediaViewer). A photo can
 * be zoomed and moved. A node's drawing is a notebook (docs/NOTEBOOK.md):
 * the viewer hosts ns.notebook.open(..., {kind: 'node'}), with everything a
 * notebook has (pages, the rail, paper, size, settings, export). The
 * notebook owns its files and its saving - nothing exists until the first
 * stroke, which makes the '<node>.book' folder and puts its first page in
 * the node in one step; later strokes are one step per pause; Mod+S, the
 * page hidden, another tab taking over, a press outside it and a map switch
 * write what it holds; undo and redo are the app's. An old lone
 * '*.ink.svg' or '*.excalidraw.svg' opens as a one-page notebook and is
 * moved into a folder only by the first change that needs one. The viewer
 * only places the notebook, titles it and closes it (Done, Escape, the
 * close button: the notebook writes first, then goes).
 *
 * The map's board is no longer shown here: it is the map's second face,
 * the Board view of notebook.js (view.board). A board's page reached
 * from here (the media panel) switches to that view, on its own map.
 *
 * The media panel (media.panel) is the project's assets/ as a grid of
 * thumbnails - painted lazily, a few at a time, each once per set of bytes -
 * with 'on a map' / 'on no map', multi-select, send to the trash (warning
 * when a map still shows one) and open in the viewer. A notebook is one
 * tile (its cover, its pages counted; a folder left with no page is still
 * listed, so it can be cleared), and goes to the trash whole, as one entry
 * that comes back whole (store.trashFiles, whole). Taking a notebook out
 * of a node or deleting its node takes the whole folder too (the store
 * weighs a .book folder as one thing).
 *
 *   init()
 *   pickImages(target?) -> Promise          target: {path, field} | path | null (a new root)
 *   addFiles(files, target?) -> Promise<{added, paths}>
 *   openViewer(path, {owner, field, projectId})   a photo or a drawing
 *   openDrawing({path, field})              the drawing in that box, or a new one
 *   openBoard() / toggleBoard()             the map's board view (ns.notebook)
 *   closeViewer() -> bool                   Done for a drawing
 *   viewerState() -> {kind, path, mode, side, created, editor, notebook} | null
 *   pictureMenu(anchor | {x, y}, {path, field}) -> menu handle
 *   setPicturePosition(path, field, kind, 'left'|'right'|'above') -> bool
 *   takePictureOut(path, field, kind, which?, {toast, ask}) -> Promise<bool>
 *                                          the last picture of that kind, or
 *                                          the one naming `which`; ask: a
 *                                          whole drawing asks first (a person
 *                                          chose it: a menu, Delete, the viewer)
 *   askDrawingOut() -> Promise<bool>       the confirmation itself
 *   picturesOf(path) -> [{path, field, kind, name}]   the pictures of a node
 *   togglePanel() / openPanel() / closePanel(), panelOpen()
 *   importFiles(files, entries?) -> Promise   what is not a picture
 *   setViewerMode('split'|'full'|'card'), flush()   (open notebooks write now)
 *   settle(projectId, paths) -> Promise    open notebooks write what they
 *                                          hold, before another module moves files
 * Commands: media.image (Mod+Shift+I), media.draw, media.panel (the board
 * is view.board, notebook.js).
 * Preferences: viewer (the place), mediaViewer {split, card} (per device).
 * Heard on the bus: drop, store, map:opened, map:closed, notebook, board
 * (the board coming up closes the viewer; a viewer opening brings the map
 * back), tabs, prefs (view-only), lang. Said: media:viewer {open, kind, path}.
 * A drop is shared with the workspace (sidebar.js takes folders and
 * .zip/.json/.md from the same event); everything else is taken here. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var MAX_SIDE = 4096;          // px: a photo larger than this on a side is made smaller on intake
  var SPLIT_MIN = 0.25;
  var SPLIT_MAX = 0.75;
  var SPLIT_DEFAULT = 0.42;
  var SPLIT_STEP = 0.05;
  var BESIDE_MIN = 720;         // px of main width under which the split stands under the map
  var CARD_MIN_W = 280;
  var CARD_MIN_H = 200;
  var CARD_MARGIN = 8;
  var DRAG_SLOP = 3;
  var ZOOM_MAX = 8;
  var ZOOM_STEP = 1.25;
  var THUMBS_AT_ONCE = 4;
  var DRAWING_RE = /\.(?:excalidraw|ink)\.svg$/i;
  /* A file inside a notebook's folder (docs/NOTEBOOK.md), and its pages. */
  var BOOK_FILE_RE = /^(assets\/[^/]+\.book)\/([^/]+)$/;
  var PAGE_RE = /\.ink\.svg$/i;
  var IMAGE_EXT_RE = /\.(png|apng|jpe?g|jfif|gif|webp|avif|bmp|ico|svg|tiff?)$/i;
  /* Pictures a canvas would spoil: vectors, animations, icons. */
  var KEEP_AS_IS_RE = /^image\/(svg\+xml|gif|x-icon|vnd\.microsoft\.icon)$/i;

  var STRINGS = {
    en: {
      'media.cmd.image': 'Add a picture',
      'media.cmd.draw': 'Draw on the node',
      'media.cmd.drawOpen': 'Open the drawing',
      'media.cmd.panel': 'Pictures and drawings',
      'media.help.image': 'Puts pictures from this device in the selected node, or in a new node under a root called Images. You can also paste them or drop them on a node.',
      'media.help.draw': 'Opens the drawing of the selected node, or starts one: a notebook with its own paper, pages and settings, beside the map, over it or as a card. It is made with the first stroke and its first page shows in the node.',
      'media.help.panel': 'Every picture and drawing of the project, with the ones no map shows any more.',
      'media.kw.image': 'picture image photo add insert file',
      'media.kw.draw': 'draw drawing sketch pen ink notebook pages',
      'media.kw.panel': 'pictures images drawings assets files panel',
      'media.label.add.one': 'add a picture',
      'media.label.add.other': 'add {n} pictures',
      'media.label.placePicture': 'move the picture',
      'media.label.placeDrawing': 'move the drawing',
      'media.label.pictureOut': 'take the picture out',
      'media.label.drawingOut': 'take the drawing out',
      'media.added.one': 'Picture added to {path}.',
      'media.added.other': '{n} pictures added.',
      'media.shrunk.one': 'A large photo was made smaller, to {size} px on its longer side.',
      'media.shrunk.other': '{n} large photos were made smaller, to {size} px on their longer side.',
      'media.failed': 'The picture could not be added: {reason}',
      'media.failedSome': 'Left out: {list}',
      'media.openMapFirst': 'Open a map first: a picture goes into a node.',
      'media.readOnly': 'This map cannot be changed here.',
      'media.inTrash': 'The picture is in the trash.',
      'media.drawingInTrash': 'The drawing is in the trash.',
      'media.pictureMenu': 'Picture',
      'media.menu.add': 'Add a picture',
      'media.menu.draw': 'Draw in this box',
      'media.menu.openDrawing': 'Open the drawing',
      'media.menu.showPicture': 'Show the picture',
      'media.menu.photo': 'Picture',
      'media.menu.drawing': 'Drawing',
      'media.menu.left': 'To the left of the words',
      'media.menu.right': 'To the right of the words',
      'media.menu.above': 'Above the words',
      'media.menu.pictureOut': 'Take the picture out',
      'media.menu.drawingOut': 'Take the drawing out',
      'media.menu.noWords': 'A box with no words has no side',
      'media.viewer.photo': 'Picture: {name}',
      'media.viewer.drawingOf': 'Drawing: {name}',
      'media.viewer.newDrawing': 'New drawing: {name}',
      'media.viewer.close': 'Close the viewer',
      'media.viewer.deleteDrawing': 'Delete the drawing',
      'media.viewer.deletePicture': 'Delete the picture',
      'media.emptyDrawingGone': 'The empty drawing went to the trash.',
      'media.askDrawingOut.title': 'Delete this drawing?',
      'media.askDrawingOut.text': 'The drawing and all its pages go to the project\'s trash. You can restore it from there, or undo.',
      'media.askDrawingOut.ok': 'Delete',
      'media.viewer.more': 'Zoom and place',
      'media.viewer.modes': 'Where the viewer stands',
      'media.viewer.split': 'Beside the map',
      'media.viewer.full': 'Over the whole map',
      'media.viewer.card': 'As a card',
      'media.viewer.seam': 'Size of the viewer',
      'media.viewer.move': 'Drag to move the card',
      'media.viewer.resize': 'Drag to resize the card',
      'media.viewer.zoom': 'Zoom',
      'media.viewer.zoomIn': 'Zoom in',
      'media.viewer.zoomOut': 'Zoom out',
      'media.viewer.fit': 'Fit the picture',
      'media.viewer.missing': 'This picture is not in the project: {path}',
      'media.viewer.unreadable': 'This drawing could not be read.',
      'media.viewer.hint': 'Scroll or pinch to zoom, drag to move, double click to zoom in or back.',
      'media.panel.title': 'Pictures and drawings',
      'media.panel.empty': 'No pictures or drawings in this project yet. Paste one, drop one on a node, or draw on a node.',
      'media.panel.noProject': 'Open a project to see its pictures.',
      'media.panel.drawing': 'Drawing',
      'media.panel.notebook': 'Notebook',
      'media.panel.pages.one': '{n} page',
      'media.panel.pages.other': '{n} pages',
      'media.panel.image': 'Picture',
      'media.panel.used': 'On a map',
      'media.panel.unused': 'On no map',
      'media.panel.open': 'Open {name}',
      'media.panel.choose': 'Choose {name}',
      'media.panel.chooseAll': 'Choose all',
      'media.panel.chosen.one': '{n} chosen',
      'media.panel.chosen.other': '{n} chosen',
      'media.panel.count.one': '{n} file',
      'media.panel.count.other': '{n} files',
      'media.panel.trash': 'Send to the trash',
      'media.panel.trashTitle': 'Send to the trash',
      'media.panel.usedWarn.one': 'One of these is still on a map: the node will show a missing picture until you restore it from the trash.',
      'media.panel.usedWarn.other': '{n} of these are still on a map: those nodes will show a missing picture until you restore them from the trash.',
      'media.panel.trashed.one': 'The file is in the trash.',
      'media.panel.trashed.other': '{n} files are in the trash.',
      'media.panel.trashedBook.one': 'The notebook is in the trash.',
      'media.panel.trashedBook.other': '{n} notebooks are in the trash.',
      'media.panel.trashedItems.one': 'It is in the trash.',
      'media.panel.trashedItems.other': '{n} things are in the trash.',
      'media.panel.noPages': 'This notebook has no pages left: send it to the trash to tidy up.',
      'media.panel.thumbMissing': 'The bytes of this file are missing',
      'media.size.b': '{n} B',
      'media.size.kb': '{n} KB',
      'media.size.mb': '{n} MB'
    },
    it: {
      'media.cmd.image': "Aggiungi un'immagine",
      'media.cmd.draw': 'Disegna sul nodo',
      'media.cmd.drawOpen': 'Apri il disegno',
      'media.cmd.panel': 'Immagini e disegni',
      'media.help.image': 'Mette immagini di questo dispositivo nel nodo scelto, o in un nodo nuovo sotto una radice chiamata Immagini. Puoi anche incollarle o rilasciarle su un nodo.',
      'media.help.draw': 'Apre il disegno del nodo scelto, o ne comincia uno: un quaderno con carta, pagine e impostazioni sue, accanto alla mappa, sopra o come scheda. Nasce con il primo tratto e la sua prima pagina compare nel nodo.',
      'media.help.panel': 'Tutte le immagini e i disegni del progetto, anche quelli che nessuna mappa mostra più.',
      'media.kw.image': 'picture image photo add insert file immagine foto figura aggiungi inserisci',
      'media.kw.draw': 'draw drawing sketch pen ink notebook pages disegna disegno schizzo penna quaderno pagine',
      'media.kw.panel': 'pictures images drawings assets files panel immagini disegni file pannello',
      'media.label.add.one': "aggiungi un'immagine",
      'media.label.add.other': 'aggiungi {n} immagini',
      'media.label.placePicture': "sposta l'immagine",
      'media.label.placeDrawing': 'sposta il disegno',
      'media.label.pictureOut': "togli l'immagine",
      'media.label.drawingOut': 'togli il disegno',
      'media.added.one': 'Immagine aggiunta in {path}.',
      'media.added.other': '{n} immagini aggiunte.',
      'media.shrunk.one': 'Una foto grande è stata ridotta a {size} px sul lato lungo.',
      'media.shrunk.other': '{n} foto grandi sono state ridotte a {size} px sul lato lungo.',
      'media.failed': "Non è stato possibile aggiungere l'immagine: {reason}",
      'media.failedSome': 'Lasciati fuori: {list}',
      'media.openMapFirst': "Apri prima una mappa: un'immagine va dentro un nodo.",
      'media.readOnly': 'Questa mappa qui non si può modificare.',
      'media.inTrash': "L'immagine è nel cestino.",
      'media.drawingInTrash': 'Il disegno è nel cestino.',
      'media.pictureMenu': 'Immagine',
      'media.menu.add': "Aggiungi un'immagine",
      'media.menu.draw': 'Disegna in questo riquadro',
      'media.menu.openDrawing': 'Apri il disegno',
      'media.menu.showPicture': "Mostra l'immagine",
      'media.menu.photo': 'Immagine',
      'media.menu.drawing': 'Disegno',
      'media.menu.left': 'A sinistra delle parole',
      'media.menu.right': 'A destra delle parole',
      'media.menu.above': 'Sopra le parole',
      'media.menu.pictureOut': "Togli l'immagine",
      'media.menu.drawingOut': 'Togli il disegno',
      'media.menu.noWords': 'Un riquadro senza parole non ha un lato',
      'media.viewer.photo': 'Immagine: {name}',
      'media.viewer.drawingOf': 'Disegno: {name}',
      'media.viewer.newDrawing': 'Nuovo disegno: {name}',
      'media.viewer.close': 'Chiudi il visore',
      'media.viewer.deleteDrawing': 'Elimina disegno',
      'media.viewer.deletePicture': 'Elimina immagine',
      'media.emptyDrawingGone': 'Il disegno vuoto è nel cestino.',
      'media.askDrawingOut.title': 'Eliminare questo disegno?',
      'media.askDrawingOut.text': 'Il disegno, con tutte le sue pagine, va nel cestino del progetto. Da lì puoi ripristinarlo, oppure annullare.',
      'media.askDrawingOut.ok': 'Elimina',
      'media.viewer.more': 'Zoom e posizione',
      'media.viewer.modes': 'Dove sta il visore',
      'media.viewer.split': 'Accanto alla mappa',
      'media.viewer.full': 'Su tutta la mappa',
      'media.viewer.card': 'Come scheda',
      'media.viewer.seam': 'Dimensione del visore',
      'media.viewer.move': 'Trascina per spostare la scheda',
      'media.viewer.resize': 'Trascina per ridimensionare la scheda',
      'media.viewer.zoom': 'Zoom',
      'media.viewer.zoomIn': 'Ingrandisci',
      'media.viewer.zoomOut': 'Riduci',
      'media.viewer.fit': "Adatta l'immagine",
      'media.viewer.missing': "Questa immagine non c'è nel progetto: {path}",
      'media.viewer.unreadable': 'Non è stato possibile leggere questo disegno.',
      'media.viewer.hint': 'Scorri o pizzica per lo zoom, trascina per spostare, doppio clic per ingrandire o tornare indietro.',
      'media.panel.title': 'Immagini e disegni',
      'media.panel.empty': 'Questo progetto non ha ancora immagini né disegni. Incollane una, rilasciala su un nodo o disegna su un nodo.',
      'media.panel.noProject': 'Apri un progetto per vederne le immagini.',
      'media.panel.drawing': 'Disegno',
      'media.panel.notebook': 'Quaderno',
      'media.panel.pages.one': '{n} pagina',
      'media.panel.pages.other': '{n} pagine',
      'media.panel.image': 'Immagine',
      'media.panel.used': 'In una mappa',
      'media.panel.unused': 'In nessuna mappa',
      'media.panel.open': 'Apri {name}',
      'media.panel.choose': 'Scegli {name}',
      'media.panel.chooseAll': 'Scegli tutti',
      'media.panel.chosen.one': '{n} scelto',
      'media.panel.chosen.other': '{n} scelti',
      'media.panel.count.one': '{n} file',
      'media.panel.count.other': '{n} file',
      'media.panel.trash': 'Sposta nel cestino',
      'media.panel.trashTitle': 'Sposta nel cestino',
      'media.panel.usedWarn.one': "Uno di questi è ancora in una mappa: il nodo mostrerà un'immagine mancante finché non lo ripristini dal cestino.",
      'media.panel.usedWarn.other': "{n} di questi sono ancora in una mappa: quei nodi mostreranno un'immagine mancante finché non li ripristini dal cestino.",
      'media.panel.trashed.one': 'Il file è nel cestino.',
      'media.panel.trashed.other': '{n} file sono nel cestino.',
      'media.panel.trashedBook.one': 'Il quaderno è nel cestino.',
      'media.panel.trashedBook.other': '{n} quaderni sono nel cestino.',
      'media.panel.trashedItems.one': 'È nel cestino.',
      'media.panel.trashedItems.other': '{n} elementi sono nel cestino.',
      'media.panel.noPages': 'Questo quaderno non ha più pagine: mandalo nel cestino per fare ordine.',
      'media.panel.thumbMissing': 'I byte di questo file mancano',
      'media.size.b': '{n} B',
      'media.size.kb': '{n} KB',
      'media.size.mb': '{n} MB'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  function plural(key, n, vars) {
    if (ns.i18n && typeof ns.i18n.plural === 'function') return ns.i18n.plural(key, n, vars);
    var all = { n: n };
    for (var k in vars || {}) all[k] = vars[k];
    return t(key + (n === 1 ? '.one' : '.other'), all);
  }

  /* ================================================================ reaching the others */

  function store() { return ns.store; }
  function doc() { return ns.doc; }
  function storage() { return ns.storage; }
  function session() { return ns.session; }
  function h() { return ns.util.h.apply(null, arguments); }
  function emit(type, detail) { if (ns.bus) ns.bus.emit(type, detail); }

  function report(what, err) {
    if (window.console) console.error('MindRoot media: ' + what, err);
  }

  function toast(text, opts) {
    if (ns.ui && typeof ns.ui.toast === 'function') return ns.ui.toast(text, opts);
    return null;
  }

  /* The open map, or null. */
  function openMap() {
    var s = session();
    var cur = s && typeof s.current === 'function' ? s.current() : null;
    return cur && cur.projectId && cur.mapId ? cur : null;
  }

  /* View-only mode, a tab that does not hold the data, a read-only store. */
  function readOnly() {
    var s = session();
    if (s && typeof s.readOnly === 'function') return !!s.readOnly();
    if (document.documentElement.getAttribute('data-mode') === 'view') return true;
    var st = store();
    return !!(st && typeof st.readOnly === 'function' && st.readOnly());
  }

  function storeLocked() {
    var st = store();
    try {
      if (st && typeof st.readOnly === 'function' && st.readOnly()) return true;
      if (ns.tabs && typeof ns.tabs.readOnly === 'function' && ns.tabs.readOnly()) return true;
    } catch (err) { /* a module that is not there locks nothing */ }
    return false;
  }

  function writable() { return !!openMap() && !readOnly(); }

  /* Changing the project, with or without a map open. */
  function canWrite() {
    return !storeLocked() && document.documentElement.getAttribute('data-mode') !== 'view';
  }

  function selectedPath() {
    var s = session();
    var p = s && typeof s.selected === 'function' ? s.selected() : null;
    return p === undefined ? null : p;
  }

  function mapView() {
    var s = session();
    return s && s.view && openMap() ? s.view : null;
  }

  function baseName(path) { return String(path || '').split('/').pop(); }

  /* The words a node goes by, for titles and file names. */
  function nodeName(state, path) {
    var e = state && path !== null && path !== undefined ? state.byPath[path] : null;
    return e ? doc().plainText(e) : '';
  }

  /* The path a lineage key names in a parse, else the path itself if it is
   * still a node, else null. Work that waits (bytes being stored, a first
   * stroke) finds its node again this way after edits moved it. */
  function findNode(state, path, key) {
    if (key !== undefined && key !== null) {
      var keys = doc().lineageKeys(state);
      for (var p in keys) if (keys[p] === key) return p;
    }
    if (path !== null && path !== undefined && state.byPath[path]) return String(path);
    return null;
  }

  function keyOf(state, path) {
    if (path === null || path === undefined || !state.byPath[path]) return null;
    return doc().lineageKey(state, path);
  }

  /* Paths a map's text names (pictures and the board). */
  function namesFile(text, path) {
    return doc().refsInText(text).indexOf(path) >= 0;
  }

  function fileOf(pid, path) {
    var st = store();
    var S = storage();
    if (!st || !path) return null;
    try { return S && typeof S.refFor === 'function' ? S.refFor(st, pid, path) : st.fileRef(pid, path); } catch (err) { return null; }
  }

  function forgetPicture(path) {
    var v = mapView();
    if (v && typeof v.forgetImage === 'function') {
      try { v.forgetImage(path); } catch (err) { report('forgetImage', err); }
    }
  }

  /* ================================================================ intake */

  function isImageFile(file) {
    if (!file) return false;
    var type = String(file.type || '');
    if (/^image\//i.test(type)) return true;
    return !type && IMAGE_EXT_RE.test(String(file.name || ''));
  }

  function isPng(file) {
    return /^image\/png$/i.test(String(file.type || '')) || /\.png$/i.test(String(file.name || ''));
  }

  /* Image files from a clipboard: the files list, or the items of kind
   * 'file' (some browsers fill only one of the two). */
  function clipboardImages(cd) {
    var out = [];
    var files = cd.files ? Array.prototype.slice.call(cd.files) : [];
    files.forEach(function (f) { if (isImageFile(f)) out.push(f); });
    if (out.length) return out;
    var items = cd.items ? Array.prototype.slice.call(cd.items) : [];
    items.forEach(function (it) {
      if (it.kind !== 'file') return;
      var f = it.getAsFile && it.getAsFile();
      if (f && isImageFile(f)) out.push(f);
    });
    return out;
  }

  /* Where pictures go: an explicit {path, field}, a bare path, null for a
   * new 'Images' root, or (undefined) the field being renamed, else the
   * selected node's line, else a new root. */
  function resolveTarget(target) {
    if (target && typeof target === 'object') {
      return { path: target.path === undefined ? selectedPath() : target.path, field: target.field === 'body' ? 'body' : 'line' };
    }
    if (typeof target === 'string') return { path: target, field: 'line' };
    if (target === null) return { path: null, field: 'line' };
    var E = ns.editor;
    var r = E && typeof E.renaming === 'function' ? E.renaming() : null;
    if (r && r.path !== null && r.path !== undefined) return { path: r.path, field: r.field === 'body' ? 'body' : 'line' };
    return { path: selectedPath(), field: 'line' };
  }

  function decode(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).then(function (bmp) {
        return { source: bmp, w: bmp.width, h: bmp.height, done: function () { if (bmp.close) bmp.close(); } };
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ source: img, w: img.naturalWidth, h: img.naturalHeight, done: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      try { canvas.toBlob(function (b) { resolve(b); }, type, quality); } catch (err) { resolve(null); }
    });
  }

  var EXT_OF = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

  /* A photo larger than MAX_SIDE on a side, drawn again at MAX_SIDE. JPEG
   * and WebP stay what they were (quality 0.92); anything else becomes a
   * PNG so transparency survives. A picture that cannot be decoded here, or
   * that a canvas would spoil (vectors, animations), goes in as it is. */
  async function shrink(file) {
    var type = String(file.type || '').toLowerCase();
    if (KEEP_AS_IS_RE.test(type) || /\.(svg|gif|ico)$/i.test(file.name || '')) return { file: file, shrunk: false };
    var pic;
    try { pic = await decode(file); } catch (err) { return { file: file, shrunk: false }; }
    try {
      var side = Math.max(pic.w, pic.h);
      if (!(side > MAX_SIDE)) return { file: file, shrunk: false };
      var scale = MAX_SIDE / side;
      var w = Math.max(1, Math.round(pic.w * scale));
      var hgt = Math.max(1, Math.round(pic.h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      var ctx = canvas.getContext('2d');
      if (!ctx) return { file: file, shrunk: false };
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pic.source, 0, 0, w, hgt);
      var want = type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
      var blob = await canvasBlob(canvas, want, want === 'image/png' ? undefined : 0.92);
      canvas.width = canvas.height = 0;
      if (!blob || !blob.size) return { file: file, shrunk: false };
      var ext = EXT_OF[blob.type] || '.png';
      var name = String(file.name || 'image').replace(/\.[a-z0-9]+$/i, '') + ext;
      var out;
      try { out = new File([blob], name, { type: blob.type, lastModified: file.lastModified }); } catch (err) {
        out = blob;
        out.name = name;
      }
      return { file: out, shrunk: true };
    } finally {
      try { pic.done(); } catch (err) { /* released already */ }
    }
  }

  /* The original name, extension off: what the picture says it is
   * (Obsidian shows it on hover and when the file is missing). */
  function altOf(file) {
    return String((file && file.name) || '').replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  }

  var intakeChain = Promise.resolve();

  /* Pictures into a node. Several at once are one step; the bytes are
   * stored first, then the project names every file and the map is written
   * once. The node is found again by its lineage when the bytes take a
   * while and the map changed meanwhile. */
  function addFiles(files, target, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(files || []).filter(isImageFile);
    if (!list.length) return Promise.resolve({ added: 0, paths: [] });
    var cur = openMap();
    if (!cur) {
      toast(t('media.openMapFirst'));
      return Promise.resolve({ added: 0, paths: [] });
    }
    if (readOnly()) {
      toast(t('media.readOnly'));
      return Promise.resolve({ added: 0, paths: [] });
    }
    var where = resolveTarget(target);
    var job = {
      projectId: cur.projectId,
      mapId: cur.mapId,
      path: where.path,
      key: keyOf(cur.state, where.path),
      field: where.field,
      selected: selectedPath()
    };
    /* One batch at a time: two quick pastes must not both name
     * 'assets/image.png'. */
    var run = intakeChain.then(function () { return intake(list, job, opts); });
    intakeChain = run.catch(function () {});
    return run;
  }

  async function intake(list, job, opts) {
    var S = storage();
    var st = store();
    var saved = [];
    var failed = [];
    var shrunk = 0;
    for (var i = 0; i < list.length; i++) {
      try {
        var small = await shrink(list[i]);
        if (small.shrunk) shrunk++;
        var put = await S.saveAsset(st, job.projectId, small.file);
        saved.push({ path: put.path, ref: put.ref, alt: altOf(list[i]) });
      } catch (err) {
        report('storing a picture', err);
        failed.push(String((list[i] && list[i].name) || '?'));
      }
    }
    if (!saved.length) {
      toast(t('media.failed', { reason: failed.join(', ') || '?' }), { kind: 'error' });
      return { added: 0, paths: [] };
    }
    var map = st.map(job.projectId, job.mapId);
    if (!map || storeLocked()) {
      toast(t(map ? 'media.readOnly' : 'media.openMapFirst'), { kind: 'error' });
      return { added: 0, paths: [] };
    }
    var D = doc();
    var state = D.parse(map.text);
    var node = findNode(state, job.path, job.key);
    var field = job.field;
    var paths = [];
    var text = map.text;
    var lastLine = null;
    var label = { key: 'media.label.add', n: saved.length };
    var where = { from: { selected: job.selected } };
    st.transaction(label, function () {
      saved.forEach(function (s) {
        /* The same bytes already in assets/ (the same screenshot pasted
         * twice) are named again, not stored under a second name. */
        var same = sameBytesPath(job.projectId, s.ref);
        var path = same || st.freePath(job.projectId, s.path);
        var r = D.addImage(state, node, path, s.alt, field);
        if (!r) return;
        if (!same && !st.setFile(job.projectId, path, s.ref, { label: label })) return;
        paths.push(path);
        text = r.text;
        state = D.parse(text);
        if (typeof r.anchorLine === 'number') lastLine = r.anchorLine;
        /* The first picture with no node made one (under 'Images'); the
         * others join it. */
        if (node === null || !state.byPath[node]) {
          var e = typeof r.anchorLine === 'number' ? D.findByLine(state, r.anchorLine) : null;
          node = e ? e.path : (r.selectPath !== undefined && r.selectPath !== null ? String(r.selectPath) : null);
          field = 'line';
        }
      });
      if (!paths.length) return;
      var to = node !== null ? { selectPath: node } : (lastLine !== null ? { anchorLine: lastLine } : {});
      st.setMapText(job.projectId, job.mapId, text, { label: label, origin: 'media', from: where.from, to: to });
    }, where);
    paths.forEach(forgetPicture);
    if (!opts.quiet) {
      var said = [paths.length === 1 ? t('media.added.one', { path: paths[0] }) : plural('media.added', paths.length)];
      if (shrunk) said.push(plural('media.shrunk', shrunk, { size: MAX_SIDE }));
      if (failed.length) said.push(t('media.failedSome', { list: failed.join(', ') }));
      if (paths.length) toast(said.join(' '), failed.length ? { kind: 'error' } : undefined);
    }
    return { added: paths.length, paths: paths, node: node };
  }

  function sameBytesPath(pid, ref) {
    var p = store().project(pid);
    if (!p || !ref) return null;
    var paths = Object.keys(p.files).filter(function (k) {
      return /^assets\//.test(k) && p.files[k].asset === ref.asset && !DRAWING_RE.test(k);
    });
    paths.sort();
    return paths[0] || null;
  }

  /* The picker, for the selection or the box being renamed. Resolves once
   * whatever was picked is in (or nothing was). */
  function pickImages(target) {
    if (!openMap()) { toast(t('media.openMapFirst')); return Promise.resolve({ added: 0, paths: [] }); }
    if (readOnly()) { toast(t('media.readOnly')); return Promise.resolve({ added: 0, paths: [] }); }
    var where = resolveTarget(target);
    return ns.util.pickFiles({ accept: 'image/*', multiple: true }).then(function (files) {
      if (!files || !files.length) return { added: 0, paths: [] };
      return addFiles(files, { path: where.path, field: where.field });
    });
  }

  /* ---------------------------------------------------------------- paste */

  function inTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (ns.util && typeof ns.util.isTextField === 'function') return ns.util.isTextField(el);
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
  }

  /* A picture pasted anywhere that is not a text field goes into the
   * selected node (the rename fields hand theirs over themselves; the
   * drawing editor keeps its own pastes). */
  function onPaste(e) {
    if (e.defaultPrevented || !e.clipboardData) return;
    var target = e.target;
    if (inTextField(target) || inTextField(document.activeElement)) return;
    if (target && target.closest && target.closest('.ink, dialog, .menu')) return;
    if (ns.ui && typeof ns.ui.isOpen === 'function' && ns.ui.isOpen()) return;
    var files = clipboardImages(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  }

  /* ---------------------------------------------------------------- drop */

  var dropMark = null;     // the node element lit as the drop target

  function hasFiles(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') >= 0;
  }

  /* The node under a point of the screen, only where the map is seen: a
   * point over the viewer beside it is not over the map. */
  function nodeUnder(x, y) {
    var v = mapView();
    var stage = document.getElementById('stage');
    if (!v || typeof v.pathAt !== 'function' || !stage || typeof x !== 'number') return null;
    var r = stage.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    var hit = document.elementFromPoint(x, y);
    if (hit && !stage.contains(hit) && hit.id !== 'drop' && !hit.closest('#drop')) return null;
    var p = v.pathAt(x, y);
    return p === undefined ? null : p;
  }

  function litDrop(path) {
    var v = mapView();
    var el = v && path !== null ? v.nodeEl(path) : null;
    if (el === dropMark) return;
    if (dropMark) dropMark.removeAttribute('data-media-drop');
    dropMark = el || null;
    if (dropMark) dropMark.setAttribute('data-media-drop', '');
  }

  var trackDrag = null;

  function onDragOver(e) {
    if (!hasFiles(e) || readOnly()) return;
    trackDrag(e.clientX, e.clientY);
  }

  /* The mark goes with the drag. A dragover's frame still pending would
   * light the node again after the drop, so it is cancelled first. */
  function unlightDrop() {
    if (trackDrag && typeof trackDrag.cancel === 'function') trackDrag.cancel();
    litDrop(null);
  }

  function onDragEnd() { unlightDrop(); }

  function onDragLeave(e) {
    if (!e.relatedTarget) unlightDrop();
  }

  /* Folders, read through the entries API while the drop event lasts. */
  function droppedEntries(dt) {
    var out = [];
    var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
    items.forEach(function (it) {
      if (it.kind !== 'file' || typeof it.webkitGetAsEntry !== 'function') return;
      var entry = null;
      try { entry = it.webkitGetAsEntry(); } catch (err) { entry = null; }
      if (entry && entry.isDirectory) out.push(entry);
    });
    return out;
  }

  /* What the workspace's own drop handler takes (sidebar.js reads folders
   * and these files from the same bus event, and hears it first): when it
   * is there, they are left to it, so nothing comes in twice. */
  var WORKSPACE_TAKES = /\.(zip|json|md|markdown)$/i;

  function workspaceTakesDrops() {
    return !!(ns.sidebar && typeof ns.sidebar.importFiles === 'function');
  }

  /* The shell hands every drop over (bus 'drop', inside the browser's drop
   * event). Pictures go into the node under the pointer; what is not a
   * picture is imported. A drop someone else claimed whole is left alone. */
  function onDrop(d) {
    unlightDrop();
    if (!d || d.handled) return;
    var workspace = workspaceTakesDrops();
    var folders = workspace ? [] : droppedEntries(d.dataTransfer);
    var folderNames = droppedEntries(d.dataTransfer).map(function (f) { return f.name; });
    var files = (d.files || []).filter(function (f) { return folderNames.indexOf(f.name) < 0 || f.size > 0 || f.type; });
    var pictures = files.filter(isImageFile);
    var others = files.filter(function (f) { return !isImageFile(f) && !(workspace && WORKSPACE_TAKES.test(f.name || '')); });
    var under = nodeUnder(d.x, d.y);
    var target = under !== null ? { path: under, field: 'line' } : undefined;
    return sortPictures(pictures).then(function (sorted) {
      var jobs = [];
      if (sorted.pictures.length) jobs.push(addFiles(sorted.pictures, target));
      var imports = others.concat(sorted.maps);
      if (imports.length || folders.length) jobs.push(importFiles(imports, folders));
      return Promise.all(jobs);
    }).catch(function (err) { report('drop', err); });
  }

  /* A PNG MindRoot exported carries its map: it is a map, not a picture. */
  async function sortPictures(list) {
    var out = { pictures: [], maps: [] };
    var A = ns.archive;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var isMap = false;
      if (isPng(f) && A && typeof A.markdownFromPng === 'function') {
        try { isMap = (await A.markdownFromPng(f)) !== null; } catch (err) { isMap = false; }
      }
      (isMap ? out.maps : out.pictures).push(f);
    }
    return out;
  }

  /* What is not a picture: the workspace's import when it offers one (it
   * may want to say more), else the archive's, with its one message. */
  async function importFiles(files, entries) {
    files = files || [];
    entries = entries || [];
    if (!canWrite()) {
      toast(t('media.readOnly'));
      return null;
    }
    var side = ns.sidebar;
    if (side && typeof side.importFiles === 'function' && !entries.length) return side.importFiles(files);
    var A = ns.archive;
    if (!A) return null;
    var messages = [];
    var errors = false;
    if (files.length) {
      var r = await A.importFiles(files);
      if (r && r.message) messages.push(r.message);
      if (r && r.errors && r.errors.length) errors = true;
    }
    if (entries.length) {
      var lists = await Promise.all(entries.map(function (e) {
        return A.readDropped(e).catch(function (err) { report('reading a folder', err); return []; });
      }));
      var all = [].concat.apply([], lists);
      var r2 = await A.importEntries(all);
      if (r2 && r2.message) messages.push(r2.message);
      if (r2 && r2.errors && r2.errors.length) errors = true;
    }
    if (messages.length) toast(messages.join(' '), errors ? { kind: 'error' } : undefined);
    return true;
  }

  /* ================================================================ placement */

  /* Inside a rename the writing is put down first and picked up after, so
   * the change and what was typed are not fighting over the same line. */
  function aroundWriting(path, fn) {
    var E = ns.editor;
    var info = E && typeof E.renaming === 'function' ? E.renaming() : null;
    var mark = info && typeof E.suspendWriting === 'function' ? E.suspendWriting() : null;
    /* The node being written may have a new path once its words are in. */
    var target = mark && String(info.path) === String(path) ? mark.path : path;
    var out;
    try { out = fn(target); } finally {
      if (mark && typeof E.resumeWriting === 'function') {
        try { E.resumeWriting(mark); } catch (err) { report('resuming the rename', err); }
      }
    }
    return out;
  }

  function kindOf(kind) {
    var D = doc();
    return kind === 'draw' || kind === D.DRAW ? D.DRAW : D.PHOTO;
  }

  /* Left, right or above for every picture of that kind in that box. */
  function setPicturePosition(path, field, kind, where) {
    if (!writable()) return false;
    field = field === 'body' ? 'body' : 'line';
    var k = kindOf(kind);
    return aroundWriting(path, function (p) {
      var cur = openMap();
      if (!cur || !cur.state.byPath[p]) return false;
      var r = doc().setImagePosition(cur.state, p, where, field, k);
      if (!r) return false;
      return session().apply(r, { label: k === doc().DRAW ? 'media.label.placeDrawing' : 'media.label.placePicture', select: p });
    });
  }

  /* "Delete this drawing?" - Delete (danger) or Cancel; Escape, the
   * scrim and the back gesture are Cancel. The focus goes back where it
   * was (the dialog's own rule), so a viewer that then closes hands it to
   * its opener and a menu's anchor gets it back. Resolves true to go on. */
  var asking = null;
  function askDrawingOut() {
    if (!ns.ui || typeof ns.ui.confirm !== 'function') return Promise.resolve(true);
    if (asking) return asking.then(function () { return false; });
    asking = ns.ui.confirm({
      title: t('media.askDrawingOut.title'),
      text: t('media.askDrawingOut.text'),
      ok: t('media.askDrawingOut.ok'),
      cancel: t('ui.cancel'),
      danger: true,
      cls: 'dialog--drawing-out'
    }).then(function (ok) { asking = null; return ok && writable(); }, function () { asking = null; return false; });
    return asking;
  }

  /* The last picture of that kind out of the box, and its file to the
   * trash as a figure that can go back into its node: one step. A drawing
   * open in the viewer is kept whole first (settleFiles), so the trash
   * holds its last strokes and the take-out is the step Undo takes back.
   * Resolves to whether it was taken out. */
  function takePictureOut(path, field, kind, which, opts) {
    if (!writable()) return Promise.resolve(false);
    var k = kindOf(kind);
    /* A drawing is hours of work and every page of a notebook: one a
     * person asked to remove (a menu row, Delete, the viewer's button) is
     * asked about first. A picture is one file and keeps its Undo toast. */
    if (opts && opts.ask && k === doc().DRAW) {
      var rest = Object.assign({}, opts, { ask: false });
      return askDrawingOut().then(function (ok) {
        return ok ? takePictureOut(path, field, kind, which, rest) : false;
      });
    }
    field = field === 'body' ? 'body' : 'line';
    var D = doc();
    var cur = openMap();
    var first = which || (cur && cur.state.byPath[path] ? D.lastImagePath(cur.state, path, field, k) : null);
    return settleFiles(cur ? cur.projectId : null, first ? [first] : []).then(function () {
      return takeOutNow(path, field, k, which || null, opts || {});
    });
  }

  /* The pictures a node shows, in its line and its body, each with the
   * file it names: for menus that offer to take one out. */
  function picturesOf(path) {
    var cur = openMap();
    var D = doc();
    if (!cur || path === null || path === undefined || !cur.state.byPath[path]) return [];
    var out = [];
    ['line', 'body'].forEach(function (field) {
      [D.PHOTO, D.DRAW].forEach(function (k) {
        picturesIn(cur.state, path, field, k).forEach(function (file) {
          out.push({ path: file, field: field, kind: k === D.DRAW ? 'draw' : 'photo', name: k === D.DRAW ? bookName(file) : baseName(file) });
        });
      });
    });
    return out;
  }

  function takeOutNow(path, field, k, which, opts) {
    opts = opts || {};
    if (!writable()) return false;
    var D = doc();
    var gone = null;
    var pid = null;
    var stepId = null;
    var done = aroundWriting(path, function (p) {
      var cur = openMap();
      if (!cur || !cur.state.byPath[p]) return false;
      pid = cur.projectId;
      gone = D.lastImagePath(cur.state, p, field, k);
      if (which) {
        var named = picturesIn(cur.state, p, field, k).filter(function (f) { return f === which || sameDrawing(f, which); });
        gone = named.length ? named[named.length - 1] : null;
        if (!gone) return false;
      }
      var r = D.removeImage(cur.state, p, field, k, which || undefined);
      if (!r) return false;
      var owner = D.plainText(cur.state.byPath[p]);
      var label = k === D.DRAW ? 'media.label.drawingOut' : 'media.label.pictureOut';
      var st = store();
      var wrote = false;
      /* keepSelection: the take-out follows something else the person
       * did (the viewer went on to another picture), whose node stays the
       * chosen one. */
      var sel = opts.keepSelection ? selectedPath() : p;
      st.transaction(label, function () {
        wrote = session().apply(r, opts.keepSelection ? { label: label, select: false } : { label: label, select: p });
        if (wrote && gone) st.trashFigure(cur.projectId, cur.mapId, { path: gone, ownerPath: p, field: field, owner: owner });
      }, { from: { selected: sel }, to: { selected: sel } });
      if (wrote) stepId = st.historyState().undoId;
      return wrote;
    });
    if (!done) return false;
    /* The drawing taken out was open in the viewer: it goes with its file
     * (everything it held was written first, by takePictureOut). */
    if (gone && (showsAny(shown, pid, [gone]) || (shown && shown.kind === 'photo' && shown.projectId === pid && shown.path === gone))) closeNow();
    if (ns.ui && typeof ns.ui.toastUndo === 'function') ns.ui.toastUndo(t(opts.toast || (k === D.DRAW ? 'media.drawingInTrash' : 'media.inTrash')), stepId);
    return true;
  }

  /* The pictures of the box whose path says where they are. */
  function picturesIn(state, path, field, kind) {
    var markup = doc().imagesIn(state, path, field, kind);
    return markup ? doc().refsInText(markup) : [];
  }

  function pictureItems(path, field) {
    var cur = openMap();
    var D = doc();
    if (!cur || path === null || path === undefined || !cur.state.byPath[path]) return [];
    field = field === 'body' ? 'body' : 'line';
    var ro = readOnly();
    var state = cur.state;
    var drawing = D.lastImagePath(state, path, field, D.DRAW);
    var items = [];
    if (!ro) items.push({ label: t('media.menu.add'), icon: 'image', onSelect: function () { return pickImages({ path: path, field: field }); } });
    if (!ro || drawing) {
      items.push({
        label: t(drawing ? 'media.menu.openDrawing' : 'media.menu.draw'), icon: 'draw',
        onSelect: function () { openDrawing({ path: path, field: field }); }
      });
    }
    [D.PHOTO, D.DRAW].forEach(function (k) {
      var last = D.lastImagePath(state, path, field, k);
      if (!last) return;
      var place = D.imagePositionAt(state, path, field, k);
      var photo = k === D.PHOTO;
      items.push('-');
      items.push({ heading: t(photo ? 'media.menu.photo' : 'media.menu.drawing') });
      if (photo) items.push({ label: t('media.menu.showPicture'), icon: 'eye', onSelect: function () { openViewer(last, { owner: path, field: field }); } });
      if (ro) return;
      ['left', 'right', 'above'].forEach(function (where) {
        items.push({
          label: t('media.menu.' + where), icon: (photo ? 'image-' : 'draw-') + where,
          checked: place === where, radio: true, disabled: !place,
          hint: place ? null : t('media.menu.noWords'),
          onSelect: function () { setPicturePosition(path, field, k, where); }
        });
      });
      items.push({
        label: t(photo ? 'media.menu.pictureOut' : 'media.menu.drawingOut'), icon: photo ? 'image-off' : 'draw-off', danger: true,
        onSelect: function () { takePictureOut(path, field, k, null, { ask: true }); }
      });
    });
    return items;
  }

  /* One menu for everything about the pictures of a box: add, draw, the
   * side each kind stands on, take one out. At an element (a toolbar
   * button) or at a point (a context menu). */
  function pictureMenu(anchor, opts) {
    opts = opts || {};
    var path = opts.path !== undefined ? opts.path : selectedPath();
    var items = pictureItems(path, opts.field);
    if (!items.length || !ns.ui) return null;
    var menuOpts = { label: t('media.pictureMenu'), onClose: opts.onClose };
    if (anchor && anchor.nodeType === 1) return ns.ui.menu(anchor, items, menuOpts);
    var point = anchor || {};
    if (typeof point.x !== 'number') {
      var v = mapView();
      var r = v ? v.rect(path) : null;
      point = r ? { x: r.left, y: r.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    return ns.ui.contextMenu(point, items, menuOpts);
  }

  /* ================================================================ the viewer */

  var root = document.documentElement;
  var V = null;              // the viewer's elements, made on first use
  var shown = null;          // what it shows: a record (see photoRecord, drawingRecord)
  var viewerEsc = null;

  function prefsOk() { return ns.prefs && typeof ns.prefs.get === 'function'; }

  function mode() {
    var m = prefsOk() ? ns.prefs.get('viewer') : 'split';
    return m === 'full' || m === 'card' ? m : 'split';
  }

  function geometry() {
    var g = prefsOk() ? ns.prefs.get('mediaViewer') : null;
    return g && typeof g === 'object' ? g : {};
  }

  function setGeometry(patch) {
    if (!prefsOk()) return;
    var g = Object.assign({}, geometry(), patch);
    ns.prefs.set('mediaViewer', g);
  }

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function splitFraction() {
    var f = Number(geometry().split);
    return isFinite(f) && f > 0 ? clampNum(f, SPLIT_MIN, SPLIT_MAX) : SPLIT_DEFAULT;
  }

  function compact() {
    return !!(ns.util && ns.util.matches && ns.util.matches('(max-width: 639px)'));
  }

  /* Beside the map when there is width for both and the screen lies
   * flat; under it on a phone or an upright screen. */
  function splitSide() {
    var main = document.getElementById('main');
    if (!main || compact()) return 'bottom';
    var w = main.clientWidth;
    var hgt = main.clientHeight || 1;
    return w >= BESIDE_MIN && w / hgt >= 1.05 ? 'right' : 'bottom';
  }

  function buildViewer() {
    if (V) return V;
    var main = document.getElementById('main');
    if (!main || !ns.ui) return null;
    var titleId = 'viewer-title';
    var el = h('section', {
      id: 'viewer', class: 'viewer', hidden: true, tabindex: '-1',
      role: 'region', 'aria-labelledby': titleId
    });
    var seam = h('div', {
      class: 'viewer__seam', role: 'separator', tabindex: '0',
      'aria-label': t('media.viewer.seam'), 'aria-valuemin': String(Math.round(SPLIT_MIN * 100)),
      'aria-valuemax': String(Math.round(SPLIT_MAX * 100))
    });
    var bar = h('div', { class: 'viewer__bar' });
    var title = h('h2', { class: 'viewer__title', id: titleId });
    var tools = h('div', { class: 'viewer__tools', role: 'group', 'aria-label': t('media.viewer.zoom') });
    var zoomOut = ns.ui.button({ icon: 'zoom-out', label: t('media.viewer.zoomOut'), shortcut: '-', onClick: function () { photoZoomCenter(1 / ZOOM_STEP); } });
    var zoomIn = ns.ui.button({ icon: 'zoom-in', label: t('media.viewer.zoomIn'), shortcut: '+', onClick: function () { photoZoomCenter(ZOOM_STEP); } });
    var fit = ns.ui.button({ icon: 'fit', label: t('media.viewer.fit'), shortcut: '0', onClick: function () { photoFit(true); } });
    tools.appendChild(zoomOut);
    tools.appendChild(zoomIn);
    tools.appendChild(fit);
    var modes = h('div', { class: 'viewer__modes', role: 'group', 'aria-label': t('media.viewer.modes') });
    var modeButtons = {};
    ['split', 'full', 'card'].forEach(function (m) {
      var b = ns.ui.button({ icon: m, label: t('media.viewer.' + m), pressed: false, onClick: function () { setMode(m); } });
      b.setAttribute('data-mode', m);
      modeButtons[m] = b;
      modes.appendChild(b);
    });
    /* A narrow viewer (a phone, a small card) folds the zoom and the places
     * into one menu instead of squeezing the title out. */
    var more = ns.ui.button({ icon: 'more', label: t('media.viewer.more'), cls: 'viewer__more', onClick: function () { openViewerMenu(more); } });
    more.setAttribute('aria-haspopup', 'menu');
    var close = ns.ui.button({ icon: 'close', label: t('media.viewer.close'), shortcut: 'Escape', cls: 'viewer__close', onClick: function () { closeViewer(); } });
    /* What is shown, taken out of its node and into the trash (one step,
     * with Undo): the plain way to be rid of a drawing or a picture. */
    var trash = ns.ui.button({ icon: 'trash', label: t('media.viewer.deleteDrawing'), kind: 'text', cls: 'viewer__trash', onClick: function () { removeShown(); } });
    trash.hidden = true;
    bar.appendChild(title);
    bar.appendChild(tools);
    bar.appendChild(modes);
    bar.appendChild(trash);
    bar.appendChild(more);
    bar.appendChild(close);
    var body = h('div', { class: 'viewer__body' });
    var grip = h('div', { class: 'viewer__grip', 'aria-hidden': 'true', title: t('media.viewer.resize') });
    el.appendChild(seam);
    el.appendChild(bar);
    el.appendChild(body);
    el.appendChild(grip);
    main.appendChild(el);
    el.addEventListener('keydown', armedDelete, true);
    el.addEventListener('pointerdown', function () { if (shown) shown.armed = false; }, true);
    el.addEventListener('keydown', guardKeys);
    V = { el: el, main: main, seam: seam, bar: bar, title: title, tools: tools, zoomIn: zoomIn, zoomOut: zoomOut, fit: fit, modes: modeButtons, more: more, close: close, trash: trash, body: body, grip: grip };
    wireSeam(V);
    wireCard(V);
    if (typeof ResizeObserver === 'function') {
      V.ro = new ResizeObserver(function () { onViewerResize(); });
      V.ro.observe(body);
      V.ro.observe(main);
    } else {
      window.addEventListener('resize', onViewerResize);
    }
    return V;
  }

  var onViewerResize = function () {};

  /* Keys pressed in the viewer belong to it: Delete, Enter, the arrows or a
   * letter must never act on the selected node of the map behind it. What
   * passes is what is app-wide - Escape (the viewer's own close, through
   * the escape stack), Tab, the function keys and the modifier shortcuts
   * (Mod+S, Mod+K). The drawing editor keeps its own keys the same way. */
  function guardKeys(e) {
    var key = e.key || '';
    if (key === 'Escape' || key === 'Tab' || /^F\d+$/.test(key)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopPropagation();
  }

  /* A picture clicked on the map is picked there (a ring round it) and
   * shown here, and the focus comes here with it. Delete or Backspace
   * pressed next - before anything else is done in the viewer - means
   * what it means on the map: that picture leaves its node (the trash,
   * with Undo). Any press or other key in the viewer first, and the keys
   * are the viewer's (the drawing editor's Delete takes out strokes). */
  function armedFor(rec) {
    var v = mapView();
    var p = v && typeof v.picked === 'function' ? v.picked() : null;
    if (!p || !rec || !rec.owner || !p.file) return false;
    if (rec.kind === 'photo') return p.kind !== 'draw' && p.file === rec.path;
    return p.kind === 'draw' && !!rec.source && sameDrawing(p.file, rec.source);
  }

  function armedDelete(e) {
    var rec = shown;
    if (!rec || !rec.armed) return;
    var key = e.key || '';
    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return;
    rec.armed = false;
    if ((key !== 'Delete' && key !== 'Backspace') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (inTextField(e.target) || !canRemoveShown()) return;
    e.preventDefault();
    e.stopPropagation();
    var v = mapView();
    removeShown().then(function (ok) {
      if (ok && v && typeof v.pickImage === 'function') v.pickImage(null);
    });
  }

  function openViewerMenu(anchor) {
    if (!shown || !ns.ui) return;
    var m = mode();
    var items = [];
    var p = photoNow();
    if (p) {
      items.push({ label: t('media.viewer.zoomIn'), icon: 'zoom-in', disabled: p.k >= ZOOM_MAX - 1e-6, onSelect: function () { photoZoomCenter(ZOOM_STEP); } });
      items.push({ label: t('media.viewer.zoomOut'), icon: 'zoom-out', disabled: p.k <= p.fitK + 1e-6, onSelect: function () { photoZoomCenter(1 / ZOOM_STEP); } });
      items.push({ label: t('media.viewer.fit'), icon: 'fit', disabled: p.fit, onSelect: function () { photoFit(true); } });
      items.push('-');
    }
    ['split', 'full', 'card'].forEach(function (k) {
      items.push({ label: t('media.viewer.' + k), icon: k, checked: k === m, radio: true, onSelect: function () { setMode(k); } });
    });
    ns.ui.menu(anchor, items, { label: t('media.viewer.more') });
  }

  function relabelViewer() {
    if (!V) return;
    V.seam.setAttribute('aria-label', t('media.viewer.seam'));
    V.tools.setAttribute('aria-label', t('media.viewer.zoom'));
    V.el.querySelector('.viewer__modes').setAttribute('aria-label', t('media.viewer.modes'));
    [['zoomIn', 'media.viewer.zoomIn', '+'], ['zoomOut', 'media.viewer.zoomOut', '-'], ['fit', 'media.viewer.fit', '0'], ['more', 'media.viewer.more', null], ['close', 'media.viewer.close', 'Escape']].forEach(function (p) {
      V[p[0]].setAttribute('aria-label', t(p[1]));
      if (ns.ui.tooltip) ns.ui.tooltip(V[p[0]], t(p[1]), p[2] || undefined);
    });
    Object.keys(V.modes).forEach(function (m) {
      V.modes[m].setAttribute('aria-label', t('media.viewer.' + m));
      if (ns.ui.tooltip) ns.ui.tooltip(V.modes[m], t('media.viewer.' + m));
    });
    V.grip.title = t('media.viewer.resize');
    paintTrash();
    if (shown) {
      shown.title = titleOf(shown);
      V.title.textContent = shown.title;
      if (shown.photo) shown.photo.wrap.setAttribute('aria-label', shown.title);
    }
  }

  /* Where the viewer stands, written on <html> for the stylesheet:
   * data-viewer = split | full | card, data-viewer-side = right | bottom. */
  function applyMode() {
    if (!V) return;
    if (!shown) {
      root.removeAttribute('data-viewer');
      root.removeAttribute('data-viewer-side');
      root.removeAttribute('data-viewer-kind');
      V.main.style.removeProperty('--viewer-frac');
      setStageInert(false);
      return;
    }
    var m = mode();
    var side = splitSide();
    var frac = splitFraction();
    root.setAttribute('data-viewer', m);
    root.setAttribute('data-viewer-side', side);
    /* A drawing brings its own tools and its own undo: on a phone the
     * map's thumb bar steps aside (css/media.css), or its Undo, an arrow
     * just like the drawing's, would undo the map under the drawing. */
    root.setAttribute('data-viewer-kind', shown.kind === 'photo' ? 'photo' : 'draw');
    V.main.style.setProperty('--viewer-frac', String(frac));
    V.seam.setAttribute('aria-orientation', side === 'right' ? 'vertical' : 'horizontal');
    V.seam.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    V.seam.hidden = m !== 'split';
    V.grip.hidden = m !== 'card';
    V.bar.toggleAttribute('data-handle', m === 'card');
    V.bar.title = m === 'card' ? t('media.viewer.move') : '';
    Object.keys(V.modes).forEach(function (k) { V.modes[k].setAttribute('aria-pressed', String(k === m)); });
    if (m === 'card') placeCard();
    else ['left', 'top', 'width', 'height'].forEach(function (p) { V.el.style.removeProperty(p); });
    setStageInert(m === 'full');
  }

  /* Over the whole map, the map is not reachable by the keyboard either. */
  function setStageInert(on) {
    var stage = document.getElementById('stage');
    if (!stage) return;
    if (on) stage.setAttribute('inert', '');
    else stage.removeAttribute('inert');
  }

  function setMode(m) {
    if (m !== 'split' && m !== 'full' && m !== 'card') return;
    if (prefsOk()) ns.prefs.set('viewer', m);
    applyMode();
    keepSelectionInSight();
  }

  /* The map got narrower or shorter: the selected node stays in sight. */
  function keepSelectionInSight() {
    var v = mapView();
    var sel = selectedPath();
    if (!v || sel === null) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try { v.ensureVisible(sel, { animate: !(ns.util && ns.util.reducedMotion && ns.util.reducedMotion()) }); } catch (err) { /* gone */ }
      });
    });
  }

  /* ---------------------------------------------------------------- the seam */

  function wireSeam(v) {
    var drag = null;
    v.seam.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || mode() !== 'split') return;
      e.preventDefault();
      var main = v.main.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, frac: splitFraction(), w: main.width, h: main.height, side: splitSide(), now: splitFraction() };
      try { v.seam.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      root.setAttribute('data-viewer-resizing', '');
    });
    v.seam.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var delta = drag.side === 'right' ? (drag.x - e.clientX) / (drag.w || 1) : (drag.y - e.clientY) / (drag.h || 1);
      drag.now = clampNum(drag.frac + delta, SPLIT_MIN, SPLIT_MAX);
      v.main.style.setProperty('--viewer-frac', String(drag.now));
      v.seam.setAttribute('aria-valuenow', String(Math.round(drag.now * 100)));
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var now = drag.now;
      drag = null;
      root.removeAttribute('data-viewer-resizing');
      setGeometry({ split: Math.round(now * 1000) / 1000 });
      applyMode();
      keepSelectionInSight();
    }
    v.seam.addEventListener('pointerup', end);
    v.seam.addEventListener('pointercancel', end);
    v.seam.addEventListener('lostpointercapture', end);
    if (ns.ui && ns.ui.ownTouches) ns.ui.ownTouches(v.seam);
    v.seam.addEventListener('keydown', function (e) {
      var side = splitSide();
      var grow = side === 'right' ? 'ArrowLeft' : 'ArrowUp';
      var shrinkKey = side === 'right' ? 'ArrowRight' : 'ArrowDown';
      var f = splitFraction();
      if (e.key === grow) f += SPLIT_STEP;
      else if (e.key === shrinkKey) f -= SPLIT_STEP;
      else if (e.key === 'Home') f = SPLIT_MIN;
      else if (e.key === 'End') f = SPLIT_MAX;
      else return;
      e.preventDefault();
      e.stopPropagation();
      setGeometry({ split: Math.round(clampNum(f, SPLIT_MIN, SPLIT_MAX) * 1000) / 1000 });
      applyMode();
    });
    v.seam.addEventListener('dblclick', function () {
      setGeometry({ split: SPLIT_DEFAULT });
      applyMode();
    });
  }

  /* ---------------------------------------------------------------- the card */

  /* The card's place is kept as fractions of the main area, so it lands in
   * the same spot on a window of another size; it is always clamped whole
   * inside the area (above the thumb bar on a phone). */
  function cardBox() {
    var main = V.main.getBoundingClientRect();
    var W = main.width;
    var H = main.height;
    var bottomRoom = 0;
    var bar = document.getElementById('thumbbar');
    if (bar && !bar.hidden && compact()) {
      var br = bar.getBoundingClientRect();
      if (br.height) bottomRoom = Math.max(0, main.bottom - br.top);
    }
    return { W: W, H: H - bottomRoom };
  }

  function cardRect(g) {
    var box = cardBox();
    var W = box.W;
    var H = box.H;
    var c = g || geometry().card || null;
    var w;
    var hgt;
    var x;
    var y;
    if (c && isFinite(c.w) && isFinite(c.h) && isFinite(c.x) && isFinite(c.y)) {
      w = c.w * W; hgt = c.h * H; x = c.x * W; y = c.y * H;
    } else {
      w = Math.min(560, W * 0.5);
      hgt = Math.min(440, H * 0.6);
      x = W - w - 16;
      y = Math.min(72, Math.max(CARD_MARGIN, H - hgt - CARD_MARGIN));
    }
    var minW = Math.min(CARD_MIN_W, W - 2 * CARD_MARGIN);
    var minH = Math.min(CARD_MIN_H, H - 2 * CARD_MARGIN);
    w = clampNum(w, minW, Math.max(minW, W - 2 * CARD_MARGIN));
    hgt = clampNum(hgt, minH, Math.max(minH, H - 2 * CARD_MARGIN));
    x = clampNum(x, CARD_MARGIN, Math.max(CARD_MARGIN, W - w - CARD_MARGIN));
    y = clampNum(y, CARD_MARGIN, Math.max(CARD_MARGIN, H - hgt - CARD_MARGIN));
    return { x: x, y: y, w: w, h: hgt, W: W, H: H };
  }

  function writeCard(r) {
    V.el.style.left = Math.round(r.x) + 'px';
    V.el.style.top = Math.round(r.y) + 'px';
    V.el.style.width = Math.round(r.w) + 'px';
    V.el.style.height = Math.round(r.h) + 'px';
  }

  function placeCard() { writeCard(cardRect()); }

  function saveCard(r) {
    if (!r.W || !r.H) return;
    setGeometry({ card: { x: r.x / r.W, y: r.y / r.H, w: r.w / r.W, h: r.h / r.H } });
  }

  function wireCard(v) {
    var drag = null;
    function start(e, kind) {
      if (e.button !== 0 || mode() !== 'card') return;
      if (kind === 'move' && e.target.closest('button, input, a, [tabindex="0"]')) return;
      var r = cardRect();
      drag = { id: e.pointerId, kind: kind, x: e.clientX, y: e.clientY, r: r, now: r, moved: false, el: e.currentTarget };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    }
    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        root.setAttribute('data-viewer-resizing', '');
      }
      e.preventDefault();
      var r = drag.r;
      var next = drag.kind === 'move' ?
        { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h } :
        { x: r.x, y: r.y, w: r.w + dx, h: r.h + dy };
      var fr = { x: next.x / r.W, y: next.y / r.H, w: next.w / r.W, h: next.h / r.H };
      drag.now = cardRect(fr);
      writeCard(drag.now);
    }
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var d = drag;
      drag = null;
      root.removeAttribute('data-viewer-resizing');
      if (d.moved) {
        saveCard(d.now);
        placeCard();
      }
    }
    v.bar.addEventListener('pointerdown', function (e) { start(e, 'move'); });
    v.grip.addEventListener('pointerdown', function (e) { start(e, 'size'); });
    [v.bar, v.grip].forEach(function (el) {
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
      if (ns.ui && ns.ui.ownTouches) ns.ui.ownTouches(el);
    });
    /* Double click on the card's bar puts it back where a card starts. */
    v.bar.addEventListener('dblclick', function (e) {
      if (mode() !== 'card' || e.target.closest('button')) return;
      setGeometry({ card: null });
      placeCard();
    });
  }

  /* ---------------------------------------------------------------- what is shown */

  function ownerName(rec) {
    if (!rec.owner) return '';
    var map = rec.mapId ? store().map(rec.projectId, rec.mapId) : null;
    if (!map) return '';
    var state = doc().parse(map.text);
    var p = findNode(state, rec.owner.path, rec.owner.key);
    return p !== null ? nodeName(state, p) : '';
  }

  function titleOf(rec) {
    if (rec.kind === 'photo') return t('media.viewer.photo', { name: baseName(rec.path) });
    var name = ownerName(rec) || bookName(rec.source || '');
    return t(rec.source ? 'media.viewer.drawingOf' : 'media.viewer.newDrawing', { name: name });
  }

  /* The node of the open map that shows this picture: the selected one if
   * it does, else the first that does; with the box it is in. */
  function ownerOf(cur, path, prefer) {
    var D = doc();
    if (!cur) return null;
    var state = cur.state;
    function holds(p) {
      var fields = ['line', 'body'];
      for (var i = 0; i < fields.length; i++) {
        if (picturesIn(state, p, fields[i], D.DRAW).concat(picturesIn(state, p, fields[i], D.PHOTO)).indexOf(path) >= 0) return fields[i];
      }
      return null;
    }
    var order = [];
    if (prefer !== null && prefer !== undefined && state.byPath[prefer]) order.push(prefer);
    state.flat.forEach(function (e) { if (e.path !== prefer) order.push(e.path); });
    for (var i = 0; i < order.length; i++) {
      var f = holds(order[i]);
      if (f) return { path: order[i], key: keyOf(state, order[i]), field: f };
    }
    return null;
  }

  /* What a record shows, as one string: the same thing asked for twice is
   * focused, not opened again. A notebook is the same notebook whichever of
   * its pages names it. */
  function recordKey(rec) {
    var what = rec.source ? (bookFolder(rec.source) || rec.source) :
      ('new:' + (rec.owner ? rec.owner.key + '|' + rec.owner.field : ''));
    return (rec.kind === 'photo' ? 'photo' : 'drawing') + '|' + rec.projectId + '|' + what;
  }

  function sameRecord(a, b) { return !!a && !!b && recordKey(a) === recordKey(b); }

  function photoRecord(pid, mid, path, owner) {
    return { kind: 'photo', projectId: pid, mapId: mid, path: path, owner: owner || null };
  }

  /* A node's drawing to show: `source` is what it opens (a page of a
   * notebook folder, a lone old drawing, or null for one not drawn yet);
   * the notebook it mounts (`view`) owns the files from there. */
  function drawingRecord(pid, mid, source, owner) {
    return { kind: 'drawing', projectId: pid, mapId: mid, owner: owner || null, source: source || null, view: null };
  }

  /* The notebook folder a path is in ('assets/x.book'), or null. */
  function bookFolder(path) {
    var m = BOOK_FILE_RE.exec(String(path || ''));
    return m ? m[1] : null;
  }

  /* A readable name for a drawing's file: the folder's for a notebook. */
  function bookName(path) {
    var folder = bookFolder(path);
    return folder ? baseName(folder).replace(/\.book$/i, '') : baseName(path);
  }

  /* Whether two paths are the same drawing: the same file, or two files
   * of one notebook folder. */
  function sameDrawing(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    var fa = bookFolder(a);
    return !!fa && fa === bookFolder(b);
  }

  /* The map of the project whose board is this file (a page of its
   * notebook, or its old lone board), the open map first. */
  function boardOwner(pid, path) {
    var p = store().project(pid);
    if (!p) return null;
    var cur = openMap();
    var maps = p.maps.slice();
    if (cur && cur.projectId === pid) {
      maps.sort(function (x, y) { return (x.id === cur.mapId ? 0 : 1) - (y.id === cur.mapId ? 0 : 1); });
    }
    for (var i = 0; i < maps.length; i++) {
      var m = maps[i];
      if (m.text.indexOf('board:') < 0) continue;
      var ref = null;
      try { ref = doc().boardPath(doc().parse(m.text)); } catch (err) { ref = null; }
      if (ref && sameDrawing(ref, path)) return m.id;
    }
    return null;
  }

  /* Opens a picture or a drawing of the open project. */
  function openViewer(path, opts) {
    opts = opts || {};
    if (!path) return false;
    path = String(path);
    var cur = openMap();
    var pid = opts.projectId || (cur && cur.projectId) || (store() && store().here().projectId);
    if (!pid || !store().project(pid)) return false;
    var mid = cur && cur.projectId === pid ? cur.mapId : null;
    if (doc().isDrawingPath(path) || bookFolder(path)) {
      /* A map's board is that map's Board view, never a window here. */
      var boardMap = boardOwner(pid, path);
      if (boardMap) return showBoardOf(pid, boardMap);
    }
    /* What is left of a notebook with no page (its book.json) is not a
     * picture to show. */
    if (bookFolder(path) && !doc().isDrawingPath(path)) { toast(t('media.panel.noPages')); return false; }
    var owner = null;
    if (mid && opts.owner !== null) {
      if (opts.owner !== undefined && cur.state.byPath[opts.owner]) {
        owner = { path: String(opts.owner), key: keyOf(cur.state, opts.owner), field: opts.field === 'body' ? 'body' : 'line' };
      } else if (opts.owner === undefined) {
        owner = ownerOf(cur, path, selectedPath());
      }
    }
    if (doc().isDrawingPath(path)) return openRecord(drawingRecord(pid, mid, path, owner));
    return openRecord(photoRecord(pid, mid, path, owner));
  }

  /* The drawing in that box, or a new one for it. */
  function openDrawing(opts) {
    opts = opts || {};
    var cur = openMap();
    if (!cur) { toast(t('media.openMapFirst')); return false; }
    var path = opts.path !== undefined && opts.path !== null ? String(opts.path) : selectedPath();
    if (path === null || !cur.state.byPath[path]) return false;
    var field = opts.field === 'body' ? 'body' : 'line';
    var D = doc();
    var existing = D.lastImagePath(cur.state, path, field, D.DRAW);
    if (!existing && readOnly()) { toast(t('media.readOnly')); return false; }
    var owner = { path: path, key: keyOf(cur.state, path), field: field };
    return openRecord(drawingRecord(cur.projectId, cur.mapId, existing || null, owner));
  }

  /* The board, kept as media's API for older callers: the Board view. */
  function boardShown() {
    return !!(ns.notebook && typeof ns.notebook.boardShown === 'function' && ns.notebook.boardShown());
  }

  function openBoard() {
    if (!ns.notebook || typeof ns.notebook.showBoard !== 'function') return false;
    return ns.notebook.showBoard();
  }

  function toggleBoard() {
    if (!ns.notebook || typeof ns.notebook.toggleBoard !== 'function') return false;
    return ns.notebook.toggleBoard();
  }

  /* The board of a map of the project: that map, on its Board face. The
   * face is remembered before the map opens, so the notebook comes up with
   * it (notebook.js follows the map that opens). */
  function showBoardOf(pid, mid) {
    var N = ns.notebook;
    if (!N || typeof N.showBoard !== 'function') return false;
    if (shown && shown.kind !== 'photo') closeViewer();
    var cur = openMap();
    if (cur && cur.projectId === pid && cur.mapId === mid) return N.showBoard();
    try { store().setMapView(pid, mid, { view: 'board' }); } catch (err) { report('remembering the view', err); }
    var S = session();
    if (S && typeof S.open === 'function') {
      Promise.resolve(S.open(pid, mid, { cause: 'open' })).then(function () {
        if (!N.boardShown()) N.showBoard();
      }, function (err) { report('opening the map of the board', err); });
    }
    return true;
  }

  function openRecord(rec) {
    /* The viewer sits beside the map, over it or floats on it: with the
     * board up there is no map, so the map comes back first (a picture or
     * a node's notebook reached from the panel or the palette). */
    if (boardShown() && ns.notebook && typeof ns.notebook.showMap === 'function') ns.notebook.showMap();
    var v = buildViewer();
    if (!v) return false;
    if (shown && sameRecord(shown, rec)) {
      shown.armed = armedFor(shown);
      focusViewer();
      return true;
    }
    var opener = document.activeElement && document.activeElement !== document.body && !(V && V.el.contains(document.activeElement)) ?
      document.activeElement : (shown ? shown.opener : null);
    if (shown) closeNow({ keepOpen: true });
    rec.opener = rec.opener || opener;
    rec.title = titleOf(rec);
    rec.armed = armedFor(rec);
    shown = rec;
    v.title.textContent = rec.title;
    v.el.setAttribute('data-kind', rec.kind);
    v.tools.hidden = rec.kind !== 'photo';
    v.body.textContent = '';
    var wasHidden = v.el.hidden;
    v.el.hidden = false;
    applyMode();
    if (!viewerEsc && ns.ui && ns.ui.escape) {
      viewerEsc = ns.ui.escape.push(function () {
        /* A drawing closes once it is kept: the press is used either way,
         * and the viewer takes itself off the stack when it really closes. */
        closeViewer();
        return false;
      });
    }
    if (rec.kind === 'photo') showPhoto(rec);
    else showDrawing(rec);
    paintTrash();
    if (wasHidden) keepSelectionInSight();
    emit('media:viewer', { open: true, kind: rec.kind, path: rec.path || rec.source || null });
    refreshBars();
    return true;
  }

  function editorOf(rec) {
    var v = rec && rec.view;
    return v && typeof v.editor === 'function' ? v.editor() : null;
  }

  function focusViewer() {
    if (!shown || !V) return;
    var ed = editorOf(shown);
    var target = ed && ed.el ? ed.el : (shown.photo ? shown.photo.wrap : V.el);
    try { target.focus({ preventScroll: true }); } catch (err) { /* hidden */ }
  }

  function refreshBars() {
    if (ns.shell && typeof ns.shell.refresh === 'function') {
      try { ns.shell.refresh(); } catch (err) { /* no shell */ }
    }
  }

  /* The close button and Escape: a notebook writes what it holds, then
   * goes (its onClose closes the viewer). */
  function closeViewer() {
    if (!shown) return false;
    var rec = shown;
    if (rec.view) {
      try { rec.view.done(); } catch (err) { report('closing the drawing', err); closeNow(); }
      return true;
    }
    closeNow();
    return true;
  }

  /* Closes at once (another map opened, the file went to the trash): the
   * notebook writes what it holds as it goes. */
  function closeNow(opts) {
    opts = opts || {};
    var rec = shown;
    if (!rec) return false;
    shown = null;
    var hadFocus = V && V.el.contains(document.activeElement);
    if (rec.view) {
      var view = rec.view;
      rec.view = null;
      try { view.close(); } catch (err) { report('closing the drawing', err); }
    }
    stopPhoto(rec);
    if (opts.keepOpen) return true;
    if (V) {
      V.body.textContent = '';
      V.el.hidden = true;
      V.el.removeAttribute('data-kind');
    }
    applyMode();
    if (viewerEsc) { viewerEsc(); viewerEsc = null; }
    if (hadFocus) {
      var back = rec.opener && rec.opener.isConnected && !rec.opener.closest('[inert]') ? rec.opener : (mapView() ? mapView().el : null);
      if (back) { try { back.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
    }
    keepSelectionInSight();
    emit('media:viewer', { open: false });
    refreshBars();
    return true;
  }

  /* path: the drawing's first page (or lone file) as the project has it
   * now, null while nothing is drawn; editor: the ink editor of the page
   * being drawn on; notebook: the notebook view. */
  function viewerState() {
    if (!shown) return null;
    var drawing = shown.kind !== 'photo';
    var book = drawing && shown.view && typeof shown.view.book === 'function' ? shown.view.book() : null;
    var path = drawing ? ((book && book.ref) || (book ? null : shown.source)) : shown.path;
    return {
      kind: shown.kind, path: path || null, source: shown.source || null,
      projectId: shown.projectId, mapId: shown.mapId, mode: mode(), side: splitSide(),
      created: drawing ? !!(book && !book.fresh && book.ref) : true,
      editor: drawing ? editorOf(shown) : null, notebook: drawing ? shown.view || null : null
    };
  }

  /* ---------------------------------------------------------------- a photo */

  function showPhoto(rec) {
    var wrap = h('div', { class: 'viewer__photo', tabindex: '0', role: 'img', 'aria-label': rec.title, 'aria-describedby': 'viewer-hint' });
    var img = h('img', { class: 'viewer__img', alt: '', draggable: 'false', decoding: 'async' });
    var hint = h('p', { class: 'visually-hidden', id: 'viewer-hint', text: t('media.viewer.hint') });
    var missing = h('p', { class: 'viewer__missing', hidden: true });
    wrap.appendChild(img);
    V.body.appendChild(wrap);
    V.body.appendChild(hint);
    V.body.appendChild(missing);
    rec.asset = (fileOf(rec.projectId, rec.path) || {}).asset || null;
    var p = rec.photo = { wrap: wrap, img: img, missing: missing, k: 1, x: 0, y: 0, nw: 0, nh: 0, fitK: 1, fit: true, pointers: new Map(), pinch: null, pan: null, lastTap: null };
    wirePhoto(rec, p);
    var S = storage();
    Promise.resolve(S && S.assetURL ? S.assetURL(store(), rec.projectId, rec.path) : null).then(function (url) {
      if (shown !== rec) return;
      if (!url) { showMissing(p, rec.path); return; }
      img.onload = function () {
        if (shown !== rec) return;
        p.nw = img.naturalWidth || 800;
        p.nh = img.naturalHeight || 600;
        img.style.width = p.nw + 'px';
        img.style.height = p.nh + 'px';
        wrap.setAttribute('data-ready', '');
        photoFit(false);
      };
      img.onerror = function () { if (shown === rec) showMissing(p, rec.path); };
      img.src = url;
    }, function (err) {
      report('reading a picture', err);
      if (shown === rec) showMissing(p, rec.path);
    });
    try { wrap.focus({ preventScroll: true }); } catch (err) { /* hidden */ }
  }

  function showMissing(p, path) {
    p.img.hidden = true;
    p.missing.hidden = false;
    p.missing.textContent = t('media.viewer.missing', { path: path });
  }

  function stopPhoto(rec) {
    if (rec && rec.photo) {
      rec.photo.pointers.clear();
      rec.photo = null;
    }
  }

  function photoNow() { return shown && shown.photo ? shown.photo : null; }

  function photoBox(p) { return { w: p.wrap.clientWidth, h: p.wrap.clientHeight }; }

  function paintPhoto(p) {
    p.img.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) scale(' + p.k + ')';
  }

  function clampPhoto(p) {
    var b = photoBox(p);
    var sw = p.nw * p.k;
    var sh = p.nh * p.k;
    p.x = sw <= b.w ? (b.w - sw) / 2 : clampNum(p.x, b.w - sw, 0);
    p.y = sh <= b.h ? (b.h - sh) / 2 : clampNum(p.y, b.h - sh, 0);
  }

  /* Whole and centred, never blown up past its own size. */
  function photoFit(animate) {
    var p = photoNow();
    if (!p || !p.nw) return;
    var b = photoBox(p);
    var pad = 16;
    p.fitK = Math.min(1, Math.max(0.01, (b.w - 2 * pad) / p.nw), Math.max(0.01, (b.h - 2 * pad) / p.nh));
    p.k = p.fitK;
    p.fit = true;
    clampPhoto(p);
    p.wrap.toggleAttribute('data-animate', !!animate && !(ns.util && ns.util.reducedMotion && ns.util.reducedMotion()));
    paintPhoto(p);
    updateZoomButtons(p);
  }

  function updateZoomButtons(p) {
    if (!V) return;
    V.zoomOut.setAttribute('aria-disabled', String(p.k <= p.fitK + 1e-6));
    V.zoomIn.setAttribute('aria-disabled', String(p.k >= ZOOM_MAX - 1e-6));
    V.fit.setAttribute('aria-disabled', String(p.fit));
  }

  /* Zoom keeping the point under the hand (client coordinates) still. */
  function photoZoom(p, factor, cx, cy, animate) {
    if (!p.nw) return;
    var r = p.wrap.getBoundingClientRect();
    var px = cx - r.left;
    var py = cy - r.top;
    var k = clampNum(p.k * factor, p.fitK, Math.max(ZOOM_MAX, p.fitK));
    if (k === p.k) return;
    p.x = px - (px - p.x) * (k / p.k);
    p.y = py - (py - p.y) * (k / p.k);
    p.k = k;
    p.fit = Math.abs(k - p.fitK) < 1e-6;
    clampPhoto(p);
    p.wrap.toggleAttribute('data-animate', !!animate && !(ns.util && ns.util.reducedMotion && ns.util.reducedMotion()));
    paintPhoto(p);
    updateZoomButtons(p);
  }

  function photoZoomCenter(factor) {
    var p = photoNow();
    if (!p) return;
    var r = p.wrap.getBoundingClientRect();
    photoZoom(p, factor, r.left + r.width / 2, r.top + r.height / 2, true);
  }

  /* When the hand did it: the event's own timestamp, or now when the
   * browser gives none that makes sense. Taps and double taps are timed by
   * it (as the map's gestures are), so a busy main thread that handles the
   * second tap late does not turn a double tap into two taps. */
  function handTime(e) {
    var n = performance.now();
    var t = e && e.timeStamp;
    return t > 0 && t <= n + 1 && n - t < 10000 ? t : n;
  }

  function wirePhoto(rec, p) {
    var wrap = p.wrap;
    wrap.addEventListener('wheel', function (e) {
      if (!p.nw) return;
      e.preventDefault();
      var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
      var dy = e.deltaY * unit;
      /* A trackpad pinch arrives as a wheel with ctrlKey and small steps. */
      var factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002));
      photoZoom(p, factor, e.clientX, e.clientY, false);
    }, { passive: false });
    wrap.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: handTime(e) });
      wrap.removeAttribute('data-animate');
      if (p.pointers.size === 2) {
        var pts = Array.from(p.pointers.values());
        p.pan = null;
        p.pinch = { d: dist(pts[0], pts[1]), k: p.k };
      } else if (p.pointers.size === 1) {
        p.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, px: p.x, py: p.y, moved: false };
      }
    });
    wrap.addEventListener('pointermove', function (e) {
      var pt = p.pointers.get(e.pointerId);
      if (!pt) return;
      pt.x = e.clientX;
      pt.y = e.clientY;
      if (p.pinch && p.pointers.size >= 2) {
        var pts = Array.from(p.pointers.values());
        var d = dist(pts[0], pts[1]);
        var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        var want = p.pinch.k * (d / (p.pinch.d || 1));
        photoZoom(p, want / p.k, mid.x, mid.y, false);
        return;
      }
      if (p.pan && p.pan.id === e.pointerId) {
        var dx = e.clientX - p.pan.x;
        var dy = e.clientY - p.pan.y;
        if (!p.pan.moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        p.pan.moved = true;
        wrap.setAttribute('data-grabbing', '');
        p.x = p.pan.px + dx;
        p.y = p.pan.py + dy;
        clampPhoto(p);
        paintPhoto(p);
      }
    });
    function up(e) {
      var pt = p.pointers.get(e.pointerId);
      if (!pt) return;
      p.pointers.delete(e.pointerId);
      wrap.removeAttribute('data-grabbing');
      var tap = e.type === 'pointerup' && !p.pinch && Math.abs(e.clientX - pt.x0) < 8 && Math.abs(e.clientY - pt.y0) < 8 && handTime(e) - pt.t < 400;
      if (p.pointers.size < 2) p.pinch = null;
      if (!p.pointers.size) p.pan = null;
      else if (p.pointers.size === 1) {
        var rest = Array.from(p.pointers.entries())[0];
        p.pan = { id: rest[0], x: rest[1].x, y: rest[1].y, px: p.x, py: p.y, moved: true };
      }
      if (!tap) return;
      /* Two taps: in where it was tapped, or back to the whole picture. */
      var now = handTime(e);
      var last = p.lastTap;
      p.lastTap = { t: now, x: e.clientX, y: e.clientY };
      if (last && now - last.t < 350 && Math.abs(last.x - e.clientX) < 24 && Math.abs(last.y - e.clientY) < 24) {
        p.lastTap = null;
        if (p.fit || p.k < p.fitK * 1.5) photoZoom(p, Math.max(2, 1 / p.fitK) * p.fitK / p.k, e.clientX, e.clientY, true);
        else photoFit(true);
      }
    }
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('dblclick', function (e) { e.preventDefault(); });
    /* The picture moves with its own touches: left to the browser, a quick
     * pan or pinch also reads as a fling (nothing scrolls, touch-action:
     * none), and the next tap on the page, up to half a second later, only
     * stops it and never clicks. */
    wrap.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    wrap.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var step = 48;
      var handled = true;
      if (e.key === '+' || e.key === '=') photoZoomCenter(ZOOM_STEP);
      else if (e.key === '-' || e.key === '_') photoZoomCenter(1 / ZOOM_STEP);
      else if (e.key === '0') photoFit(true);
      else if (e.key === 'ArrowLeft') { p.x += step; clampPhoto(p); paintPhoto(p); }
      else if (e.key === 'ArrowRight') { p.x -= step; clampPhoto(p); paintPhoto(p); }
      else if (e.key === 'ArrowUp') { p.y += step; clampPhoto(p); paintPhoto(p); }
      else if (e.key === 'ArrowDown') { p.y -= step; clampPhoto(p); paintPhoto(p); }
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  onViewerResize = frameThrottled(function () {
    if (!shown || !V) return;
    /* A card being dragged or resized is placed by the hand, not from the
     * stored geometry (which is written when the hand lets go). */
    if (mode() === 'card' && !root.hasAttribute('data-viewer-resizing')) placeCard();
    var side = splitSide();
    if (root.getAttribute('data-viewer-side') !== side) applyMode();
    var p = photoNow();
    if (p && p.nw) {
      if (p.fit) photoFit(false);
      else { clampPhoto(p); paintPhoto(p); }
    }
  });

  function frameThrottled(fn) {
    return ns.util && typeof ns.util.throttleFrame === 'function' ? ns.util.throttleFrame(fn) : fn;
  }

  /* ---------------------------------------------------------------- a drawing: a notebook */

  function showDrawing(rec) {
    rec.sourceSeen = !!rec.source;
    var host = h('div', { class: 'viewer__ink viewer__book' });
    V.body.appendChild(host);
    var N = ns.notebook;
    if (!N || typeof N.open !== 'function' || !ns.ink) {
      V.body.appendChild(h('p', { class: 'viewer__missing', text: t('media.viewer.unreadable') }));
      return;
    }
    try {
      rec.view = N.open(host, {
        projectId: rec.projectId, mapId: rec.mapId, ref: rec.source, kind: 'node',
        nodePath: rec.owner ? rec.owner.path : null, field: rec.owner ? rec.owner.field : 'line',
        readOnly: readOnly(),
        title: ownerName(rec) || (rec.source ? bookName(rec.source) : '') || undefined,
        returnFocus: rec.opener && rec.opener.isConnected ? rec.opener : undefined,
        onClose: function (info) { onNotebookClosed(rec, info); }
      });
      /* Whether there is a drawing to delete is known once the notebook
       * has read its files: an existing one shows the viewer's Delete
       * from the start, not only after a stroke made here. */
      var view = rec.view;
      if (view && view.ready && typeof view.ready.then === 'function') {
        view.ready.then(function () { if (shown === rec && rec.view === view) paintTrash(); }, function () { /* said by the notebook */ });
      }
    } catch (err) {
      report('opening the notebook', err);
      host.appendChild(h('p', { class: 'viewer__missing', text: t('media.viewer.unreadable') }));
    }
  }

  /* Closed by its own Done (or by closeViewer): the viewer goes too. */
  function onNotebookClosed(rec, info) {
    var mine = shown === rec;
    if (mine) {
      rec.view = null;
      closeNow();
    }
    /* Closed with nothing on any page (every stroke erased, or a notebook
     * an older version wrote empty) - by its own Done, or because the
     * viewer went on to another picture, another map or the board: an
     * empty box next to the words is not something to keep, so it goes -
     * to the trash, with Undo, like any picture taken out. Whatever the
     * viewer shows now keeps the selection it has. */
    if (info && info.empty && info.saved !== false && info.ref) {
      removeDrawingOf(rec, info.ref, 'media.emptyDrawingGone', { keepSelection: !mine });
    }
  }

  /* The node of the open map a viewer record belongs to, found again. */
  function ownerNow(rec) {
    var cur = openMap();
    if (!cur || !rec || !rec.owner || cur.projectId !== rec.projectId || cur.mapId !== rec.mapId) return null;
    var p = findNode(cur.state, rec.owner.path, rec.owner.key);
    return p === null || p === undefined ? null : p;
  }

  function removeDrawingOf(rec, ref, toastKey, opts) {
    opts = opts || {};
    var cur = openMap();
    if (cur && rec && cur.projectId === rec.projectId && cur.mapId === rec.mapId) {
      var p = ownerNow(rec);
      if (p === null) return Promise.resolve(false);
      return takePictureOut(p, rec.owner.field, doc().DRAW, ref, { toast: toastKey, keepSelection: !!opts.keepSelection });
    }
    return Promise.resolve(takeOutElsewhere(rec, ref, toastKey));
  }

  /* The same take-out on a map that is not the open one (the notebook
   * finished closing after another map was opened): its text and the
   * trash change in the store, one step, with Undo. */
  function takeOutElsewhere(rec, ref, toastKey) {
    if (!rec || !rec.owner || !ref || readOnly() || !canWrite()) return false;
    var S = store();
    var D = doc();
    var map = S.map(rec.projectId, rec.mapId);
    if (!map) return false;
    var state;
    try { state = D.parse(map.text); } catch (err) { report('reading the map', err); return false; }
    var p = findNode(state, rec.owner.path, rec.owner.key);
    if (p === null) return false;
    var field = rec.owner.field === 'body' ? 'body' : 'line';
    var named = picturesIn(state, p, field, D.DRAW).filter(function (f) { return f === ref || sameDrawing(f, ref); });
    if (!named.length) return false;
    var gone = named[named.length - 1];
    var r = D.removeImage(state, p, field, D.DRAW, ref);
    if (!r || typeof r.text !== 'string') return false;
    var owner = D.plainText(state.byPath[p]);
    var label = 'media.label.drawingOut';
    var wrote = false;
    S.transaction(label, function () {
      wrote = S.setMapText(rec.projectId, rec.mapId, r.text, { label: label, origin: 'media' });
      if (wrote) S.trashFigure(rec.projectId, rec.mapId, { path: gone, ownerPath: p, field: field, owner: owner });
    });
    if (!wrote) return false;
    var stepId = S.historyState().undoId;
    if (ns.ui && typeof ns.ui.toastUndo === 'function') ns.ui.toastUndo(t(toastKey || 'media.drawingInTrash'), stepId);
    return true;
  }

  /* The viewer's own Delete: the drawing (or the picture) shown leaves its
   * node for the trash, and the viewer closes with it. */
  function removeShown() {
    var rec = shown;
    if (!rec || readOnly()) return Promise.resolve(false);
    if (rec.kind === 'photo') {
      var p = ownerNow(rec);
      if (p === null) return Promise.resolve(false);
      return takePictureOut(p, rec.owner.field, doc().PHOTO, rec.path).then(function (ok) {
        if (ok && shown === rec) closeNow();
        return ok;
      });
    }
    var st = viewerState();
    if (!st || !st.created || !st.path) return Promise.resolve(false);
    var ref = st.path;
    return askDrawingOut().then(function (ok) {
      /* Still this drawing on screen: the dialog did not see it change. */
      if (!ok || shown !== rec) return false;
      return removeDrawingOf(rec, ref, null);
    });
  }

  var trashTimer = 0;
  function paintTrashSoon() {
    if (trashTimer) return;
    trashTimer = setTimeout(function () {
      trashTimer = 0;
      var rec = shown;
      var job = rec && rec.view && typeof rec.view.idle === 'function' ? rec.view.idle() : null;
      Promise.resolve(job).then(function () { if (shown === rec) paintTrash(); }, function () { paintTrash(); });
    }, 0);
  }

  /* Whether the viewer's Delete has something to take out: a picture of
   * a node, or a node's drawing that exists. */
  function canRemoveShown() {
    var st = shown ? viewerState() : null;
    if (!st || readOnly() || !shown.owner) return false;
    return st.kind === 'photo' ? !!shown.path : !!(st.created && st.path);
  }

  function paintTrash() {
    if (!V || !V.trash) return;
    var photo = !!(shown && shown.kind === 'photo');
    V.trash.hidden = !canRemoveShown();
    var label = t(photo ? 'media.viewer.deletePicture' : 'media.viewer.deleteDrawing');
    V.trash.setAttribute('aria-label', label);
    var words = V.trash.querySelector('.btn__label');
    if (words) words.textContent = label;
    if (ns.ui.tooltip) ns.ui.tooltip(V.trash, label);
  }

  /* A notebook wrote: the one in the viewer may have been born (its first
   * stroke) or moved (an old lone file into a folder, a new first page).
   * The record follows, so the title says 'Drawing' and the same notebook
   * asked for again is the one already open. */
  function onNotebookWrote() {
    var rec = shown;
    if (!rec || rec.kind === 'photo' || !rec.view || typeof rec.view.book !== 'function') return;
    var b = rec.view.book();
    var ref = b && !b.fresh ? b.ref : null;
    if (ref) rec.sourceSeen = true;
    paintTrash();
    if (!ref || ref === rec.source) return;
    rec.source = ref;
    if (V) {
      rec.title = titleOf(rec);
      V.title.textContent = rec.title;
    }
    refreshBars();
  }

  /* Whether any map of the project names a page of that notebook (or that
   * lone file). */
  function namesBook(pid, b) {
    var p = store().project(pid);
    if (!p) return false;
    var folder = b.folder ? b.folder + '/' : null;
    return p.maps.some(function (m) {
      if (folder && m.text.indexOf(folder) >= 0) return true;
      return (b.lone && namesFile(m.text, b.lone)) || (b.ref && namesFile(m.text, b.ref));
    });
  }

  /* The drawing in the viewer left the project by another hand (its node
   * sent to the trash, the panel's trash): its first page is gone and no
   * map names it any more. Its own changes (a first page deleted, a lone
   * file moved into a folder) keep a page named, so they never count. */
  function drawingGone(rec) {
    var b = rec.view && typeof rec.view.book === 'function' ? rec.view.book() : null;
    if (!b) return false;
    /* A notebook whose whole folder went has nothing left to read and
     * shows itself as new: the page it had (rec.source) still says what it
     * was - unless the history took it back (an undo of its first stroke),
     * which leaves a new drawing open on purpose (sourceSeen). */
    var ref = !b.fresh && b.ref ? b.ref : (rec.sourceSeen ? rec.source : null);
    if (!ref || fileOf(rec.projectId, ref)) return false;
    return !namesBook(rec.projectId, { folder: b.folder || bookFolder(ref), lone: b.lone, ref: ref });
  }

  var goneCheck = 0;

  /* Looked at once the store has finished the change (and the notebook has
   * taken in what it wrote itself). */
  function checkGoneSoon() {
    if (goneCheck) return;
    goneCheck = setTimeout(function () {
      goneCheck = 0;
      var rec = shown;
      if (rec && rec.kind !== 'photo' && drawingGone(rec)) closeNow();
    }, 0);
  }

  /* Whether the drawing in the viewer is one of these files. */
  function showsAny(rec, pid, paths) {
    if (!rec || rec.kind === 'photo' || rec.projectId !== pid || !paths || !paths.length) return false;
    var b = rec.view && typeof rec.view.book === 'function' ? rec.view.book() : null;
    var mine = [rec.source, b && b.ref, b && b.lone].filter(Boolean);
    var folder = b && b.folder;
    return paths.some(function (p) {
      if (folder && bookFolder(p) === folder) return true;
      return mine.some(function (m) { return sameDrawing(p, m); });
    });
  }

  /* The open notebooks of these files write what they hold now, before
   * another module moves the files (takes the drawing out of its node,
   * sends it to the trash): the trash gets the last strokes, and its step
   * is the last one, the one an Undo takes back. */
  function settleFiles(pid, paths) {
    var N = ns.notebook;
    if (!N || typeof N.views !== 'function' || !paths || !paths.length) return Promise.resolve();
    var jobs = [];
    N.views().forEach(function (v) {
      var b = typeof v.book === 'function' ? v.book() : null;
      if (!b || b.projectId !== pid) return;
      var mine = paths.some(function (p) {
        return (b.folder && bookFolder(p) === b.folder) || sameDrawing(p, b.ref) || sameDrawing(p, b.lone);
      });
      if (mine) jobs.push(Promise.resolve(v.flush()).catch(function (err) { report('saving the notebook', err); }));
    });
    return Promise.all(jobs);
  }

  /* Every open notebook writes what it holds, now. */
  function flushAll() {
    var N = ns.notebook;
    if (!N || typeof N.flush !== 'function') return Promise.resolve();
    return Promise.resolve(N.flush()).catch(function (err) { report('saving the notebooks', err); });
  }

  /* ================================================================ the media panel */

  var panel = null;

  function panelOpen() { return !!panel; }

  function sizeText(bytes) {
    var n = Number(bytes) || 0;
    var num = ns.i18n && ns.i18n.number ? ns.i18n.number : function (x) { return String(x); };
    if (n < 1024) return t('media.size.b', { n: num(n) });
    if (n < 1024 * 1024) return t('media.size.kb', { n: num(Math.round(n / 1024)) });
    return t('media.size.mb', { n: num(Math.round(n / 104857.6) / 10) });
  }

  function togglePanel() {
    if (panel) { closePanel(); return true; }
    return openPanel();
  }

  function openPanel() {
    if (panel) return true;
    var st = store();
    var pid = st && st.here().projectId;
    if (!pid || !ns.ui) { toast(t('media.panel.noProject')); return false; }
    var count = h('span', { class: 'media-panel__count', 'aria-live': 'polite' });
    var all = h('input', { type: 'checkbox', class: 'media-panel__all' });
    var allLabel = h('label', { class: 'media-panel__pickall' }, all, h('span', { text: t('media.panel.chooseAll') }));
    var trashBtn = ns.ui.button({ icon: 'trash', label: t('media.panel.trash'), kind: 'danger', cls: 'media-panel__trash', onClick: function () { trashChosen(); } });
    var head = h('div', { class: 'media-panel__head' }, allLabel, count, trashBtn);
    var grid = h('ul', { class: 'media-panel__grid', role: 'list' });
    var empty = h('p', { class: 'media-panel__empty', hidden: true, text: t('media.panel.empty') });
    var body = h('div', { class: 'media-panel' }, head, grid, empty);
    var modal = compact();
    panel = {
      pid: pid, body: body, grid: grid, empty: empty, count: count, all: all, allLabel: allLabel, trash: trashBtn,
      tiles: new Map(), chosen: new Set(), queue: [], running: 0, modal: modal, io: null, sheet: null
    };
    var mine = panel;
    if (typeof IntersectionObserver === 'function') {
      panel.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { mine.io.unobserve(en.target); enqueueThumb(mine, en.target); }
        });
      }, { rootMargin: '200px 0px' });
    }
    all.addEventListener('change', function () {
      if (all.checked) mine.tiles.forEach(function (tile, path) { mine.chosen.add(path); });
      else mine.chosen.clear();
      paintChoice(mine);
    });
    panel.sheet = ns.ui.sheet({
      title: t('media.panel.title'), body: body, cls: 'sheet--media', desktop: 'side', modal: modal,
      detents: [0.5, 0.92],
      onClose: function () {
        if (mine.io) mine.io.disconnect();
        if (panel === mine) panel = null;
        refreshBars();
      }
    });
    renderPanel();
    refreshBars();
    return true;
  }

  function closePanel() {
    if (!panel) return false;
    var p = panel;
    p.sheet.close('media');
    if (panel === p) panel = null;
    return true;
  }

  /* Re-read from the store; tiles are kept by path, so a change repaints
   * only what changed and the choice survives. */
  function renderPanel() {
    var p = panel;
    if (!p) return;
    var st = store();
    var pid = st.here().projectId || p.pid;
    if (pid !== p.pid) {
      p.pid = pid;
      p.chosen.clear();
      p.tiles.forEach(function (tile) { tile.remove(); });
      p.tiles.clear();
    }
    var list = pid && st.project(pid) ? panelList(pid) : [];
    var seen = new Set();
    var before = null;
    for (var i = list.length - 1; i >= 0; i--) {
      var a = list[i];
      seen.add(a.path);
      var tile = p.tiles.get(a.path) || makeTile(p, a);
      updateTile(p, tile, a);
      if (tile.nextSibling !== before || tile.parentNode !== p.grid) p.grid.insertBefore(tile, before);
      before = tile;
    }
    p.tiles.forEach(function (tile, path) {
      if (seen.has(path)) return;
      tile.remove();
      p.tiles.delete(path);
      p.chosen.delete(path);
    });
    p.empty.hidden = list.length > 0;
    p.empty.textContent = pid ? t('media.panel.empty') : t('media.panel.noProject');
    p.allLabel.hidden = !list.length;
    paintChoice(p);
    if (p.sheet && typeof p.sheet.refit === 'function') p.sheet.refit();
  }

  /* What the panel lists: the pictures and lone drawings at the top of
   * assets/ (storage.listAssets), and one entry per notebook folder - its
   * cover (the page a map names, else its first page by number), its pages
   * counted, its size the whole folder's. A folder left with no page (only
   * its book.json or its background) is listed too, as a notebook of no
   * pages, so whatever is left of it can still be seen and sent to the
   * trash. Notebooks come first, by name. */
  function panelList(pid) {
    var st = store();
    var list = storage().listAssets(st, pid);
    var p = st.project(pid);
    if (!p) return list;
    var used = st.usedByMaps(pid);
    var books = Object.create(null);
    Object.keys(p.files).forEach(function (path) {
      var m = BOOK_FILE_RE.exec(path);
      if (!m) return;
      var b = books[m[1]] || (books[m[1]] = { folder: m[1], pages: [], others: [], size: 0, named: null, used: false });
      b.size += p.files[path].size || 0;
      if (used[path]) b.used = true;
      if (!PAGE_RE.test(m[2])) { b.others.push(path); return; }
      b.pages.push(path);
      if (used[path] && !b.named) b.named = path;
    });
    var compare = ns.util && ns.util.naturalCompare ? ns.util.naturalCompare : function (x, y) { return x < y ? -1 : x > y ? 1 : 0; };
    var out = [];
    Object.keys(books).forEach(function (folder) {
      var b = books[folder];
      b.pages.sort(compare);
      b.others.sort(compare);
      out.push({
        file: bookName(folder + '/x'), path: b.named || b.pages[0] || b.others[0], kind: 'notebook', folder: folder,
        pages: b.pages.length, used: b.used, size: b.size
      });
    });
    out.sort(function (x, y) { return compare(x.file, y.file); });
    return out.concat(list);
  }

  /* Every file of a notebook folder. */
  function filesIn(pid, folder) {
    var p = store().project(pid);
    if (!p) return [];
    return Object.keys(p.files).filter(function (path) { return bookFolder(path) === folder; });
  }

  function makeTile(p, a) {
    var img = h('img', { class: 'media-tile__img', alt: '', draggable: 'false', decoding: 'async' });
    var open = h('button', { type: 'button', class: 'media-tile__open' }, h('span', { class: 'media-tile__thumb' }, img));
    var pick = h('input', { type: 'checkbox', class: 'media-tile__check' });
    var name = h('span', { class: 'media-tile__name' });
    var info = h('span', { class: 'media-tile__info' });
    var badge = h('span', { class: 'media-tile__badge' });
    var tile = h('li', { class: 'media-tile' },
      open,
      h('label', { class: 'media-tile__pick' }, pick),
      h('div', { class: 'media-tile__meta' }, name, info, badge));
    tile.__media = { path: a.path, img: img, open: open, pick: pick, name: name, info: info, badge: badge, painted: null, asset: null };
    open.addEventListener('click', function () {
      var path = tile.__media.path;
      if (tile.__media.empty) { toast(t('media.panel.noPages')); return; }
      if (p.modal) closePanel();
      openViewer(path, { projectId: p.pid, owner: null });
    });
    pick.addEventListener('change', function () {
      if (pick.checked) p.chosen.add(tile.__media.path); else p.chosen.delete(tile.__media.path);
      paintChoice(p);
    });
    p.tiles.set(a.path, tile);
    return tile;
  }

  function updateTile(p, tile, a) {
    var m = tile.__media;
    /* A notebook of no pages has nothing to show: its book.json is not a
     * picture. */
    var empty = a.kind === 'notebook' && !a.pages;
    var ref = empty ? null : fileOf(p.pid, a.path);
    var kindWord = t(a.kind === 'notebook' ? 'media.panel.notebook' : a.kind === 'drawing' ? 'media.panel.drawing' : 'media.panel.image');
    tile.setAttribute('data-kind', a.kind);
    tile.toggleAttribute('data-unused', !a.used);
    m.used = !!a.used;
    m.name.textContent = a.file;
    m.name.title = a.folder || a.path;
    m.info.textContent = [kindWord].concat(a.kind === 'notebook' ? [plural('media.panel.pages', a.pages)] : [], [sizeText(a.size)]).join(' · ');
    m.badge.textContent = t(a.used ? 'media.panel.used' : 'media.panel.unused');
    m.open.setAttribute('aria-label', t('media.panel.open', { name: a.file }));
    m.pick.setAttribute('aria-label', t('media.panel.choose', { name: a.file }));
    m.pick.checked = p.chosen.has(a.path);
    m.empty = empty;
    tile.toggleAttribute('data-empty', empty);
    if (empty) { m.img.removeAttribute('src'); m.painted = null; }
    var asset = ref ? ref.asset : null;
    if (m.asset !== asset) {
      m.asset = asset;
      if (m.painted !== asset) {
        if (p.io) p.io.observe(tile);
        else enqueueThumb(p, tile);
      }
    }
  }

  /* Thumbnails a few at a time, each once per set of bytes (a drawing
   * saved again is new bytes, so it is painted again). */
  function enqueueThumb(p, tile) {
    if (p.queue.indexOf(tile) < 0) p.queue.push(tile);
    pumpThumbs(p);
  }

  function pumpThumbs(p) {
    while (p.running < THUMBS_AT_ONCE && p.queue.length) {
      var tile = p.queue.shift();
      var m = tile.__media;
      if (!tile.isConnected || !m.asset || m.painted === m.asset) continue;
      p.running++;
      paintThumb(p, tile, m.asset).then(function () {
        p.running--;
        pumpThumbs(p);
      });
    }
  }

  function paintThumb(p, tile, asset) {
    var m = tile.__media;
    return Promise.resolve(storage().blobURL(asset)).then(function (url) {
      if (m.asset !== asset) return;
      m.painted = asset;
      if (url) {
        tile.removeAttribute('data-missing');
        m.img.title = '';
        if (m.img.getAttribute('src') !== url) m.img.src = url;
      } else {
        tile.setAttribute('data-missing', '');
        m.img.removeAttribute('src');
        m.img.title = t('media.panel.thumbMissing');
      }
    }, function (err) { report('a thumbnail', err); });
  }

  function paintChoice(p) {
    var n = p.chosen.size;
    var total = p.tiles.size;
    p.count.textContent = n ? plural('media.panel.chosen', n) : (total ? plural('media.panel.count', total) : '');
    p.trash.setAttribute('aria-disabled', String(!n || !canWrite()));
    p.all.checked = !!total && n === total;
    p.all.indeterminate = n > 0 && n < total;
    p.tiles.forEach(function (tile, path) {
      tile.toggleAttribute('data-chosen', p.chosen.has(path));
      tile.__media.pick.checked = p.chosen.has(path);
    });
  }

  /* Who named each file: a node's words, kept with the trash entry so the
   * trash can say what it belonged to. */
  function ownersOf(pid, paths) {
    var out = ownersByRef(pid, paths);
    /* The pages and settings of a notebook belong to whoever shows it. */
    var byFolder = {};
    Object.keys(out).forEach(function (path) {
      var f = bookFolder(path);
      if (f && !byFolder[f]) byFolder[f] = out[path];
    });
    paths.forEach(function (path) {
      var f = bookFolder(path);
      if (!out[path] && f && byFolder[f]) out[path] = byFolder[f];
    });
    return out;
  }

  /* Each named file's owner, read from the maps that name it. */
  function ownersByRef(pid, paths) {
    var out = {};
    var D = doc();
    var proj = store().project(pid);
    if (!proj) return out;
    proj.maps.forEach(function (m) {
      var refs = D.refsInText(m.text);
      var want = paths.filter(function (path) { return !out[path] && refs.indexOf(path) >= 0; });
      if (!want.length) return;
      var state = D.parse(m.text);
      state.flat.forEach(function (e) {
        var named = D.refsInText([e.title].concat(e.body ? [e.body.text] : []));
        want.forEach(function (path) { if (!out[path] && named.indexOf(path) >= 0) out[path] = D.plainText(e); });
      });
      want.forEach(function (path) { if (!out[path]) out[path] = m.name; });
    });
    return out;
  }

  async function trashChosen() {
    var p = panel;
    if (!p || !p.chosen.size || !canWrite()) return false;
    var chosen = Array.from(p.chosen);
    var onMaps = chosen.filter(function (path) {
      var tile = p.tiles.get(path);
      return !!(tile && tile.__media.used);
    }).length;
    if (onMaps) {
      var ok = await ns.ui.confirm({
        title: t('media.panel.trashTitle'),
        text: plural('media.panel.usedWarn', onMaps),
        ok: t('media.panel.trash'),
        danger: true
      });
      if (!ok || panel !== p) return false;
    }
    /* A notebook open on one of them writes what it holds first: the
     * trash gets its last strokes, and the trash is the last step. */
    await settleFiles(p.pid, chosen);
    if (panel !== p || !canWrite()) return false;
    /* A notebook goes whole: every file of its folder, its cover first,
     * as one trash entry (store.trashFiles, whole) that comes back whole. */
    var paths = [];
    var books = 0;
    chosen.forEach(function (path) {
      var folder = bookFolder(path);
      if (folder) books++;
      var all = folder ? [path].concat(filesIn(p.pid, folder)) : [path];
      all.forEach(function (f) { if (paths.indexOf(f) < 0) paths.push(f); });
    });
    var entries = store().trashFiles(p.pid, paths, ownersOf(p.pid, paths), { whole: true });
    if (!entries || !entries.length) return false;
    var stepId = store().historyState().undoId;
    p.chosen.clear();
    if (showsAny(shown, p.pid, paths)) closeNow();
    renderPanel();
    var said = books === chosen.length ? 'media.panel.trashedBook' : books ? 'media.panel.trashedItems' : 'media.panel.trashed';
    if (ns.ui.toastUndo) ns.ui.toastUndo(plural(said, chosen.length), stepId);
    return true;
  }

  /* ================================================================ following the others */

  /* The board takes the stage the map had: a viewer placed beside the map,
   * over it or floating on it has nothing left to sit with, and a node's
   * notebook next to the board would leave it unclear which is which. The
   * viewer closes - a notebook writes what it holds first. */
  function onBoard(d) {
    if (d && d.open && shown) closeViewer();
  }

  var renderPanelSoon = frameThrottled(function () { renderPanel(); });

  function onStore(change) {
    if (!change) return;
    var type = change.type;
    if (type === 'history:changed' || type === 'view') return;
    if (type === 'readonly') { syncReadOnly(); return; }
    if (panel) renderPanelSoon();
    if (!shown) return;
    if (!store().project(shown.projectId)) { closeNow(); return; }
    if (shown.kind === 'drawing') {
      /* The notebook follows the store itself (an undo shows what the
       * files say); the viewer only goes when its drawing left the
       * project by another hand. */
      if (type !== 'history') checkGoneSoon();
      else shown.sourceSeen = !!(shown.source && fileOf(shown.projectId, shown.source));
      /* An undo can take a drawing back to not written yet, a redo bring
       * it again: the Delete follows once the notebook has read that. */
      paintTrashSoon();
      return;
    }
    if (shown.kind === 'photo' && shown.photo) {
      var ref = fileOf(shown.projectId, shown.path);
      var asset = ref ? ref.asset : null;
      if (asset !== shown.asset) {
        var again = photoRecord(shown.projectId, shown.mapId, shown.path, shown.owner);
        again.asset = asset;
        again.opener = shown.opener;
        closeNow({ keepOpen: true });
        openRecord(again);
      }
    }
  }

  function syncReadOnly() {
    if (shown && shown.view && typeof shown.view.setReadOnly === 'function') {
      try { shown.view.setReadOnly(readOnly()); } catch (err) { report('read only', err); }
    }
    if (panel) paintChoice(panel);
  }

  /* Another map: its drawings go with it (a notebook writes what it holds
   * as it closes); a photo stays while the project does. */
  function onMapOpened(d) {
    if (!shown || !d) return;
    if (shown.projectId !== d.projectId) { closeNow(); return; }
    if (shown.kind !== 'photo' && shown.mapId !== d.mapId) closeNow();
    else if (shown.kind === 'photo' && shown.mapId !== d.mapId) { shown.mapId = d.mapId; shown.owner = null; }
  }

  /* ================================================================ commands */

  function drawingOfSelection(ctx) {
    var cur = openMap();
    var path = ctx && ctx.path !== undefined && ctx.path !== null ? ctx.path : selectedPath();
    if (!cur || path === null || !cur.state.byPath[path]) return { ok: false };
    var field = ctx && ctx.field === 'body' ? 'body' : 'line';
    return { ok: true, path: path, field: field, existing: doc().lastImagePath(cur.state, path, field, doc().DRAW) };
  }

  function registerCommands() {
    var C = ns.commands;
    if (!C) return;
    C.register({
      id: 'media.image', label: 'media.cmd.image', group: 'node', icon: 'image', keys: ['Mod+Shift+I'],
      keywords: t('media.kw.image'), help: 'media.help.image',
      when: function () { return writable(); },
      run: function (ctx) {
        var target = ctx && ctx.path !== undefined && ctx.source !== 'toolbar' ? { path: ctx.path, field: ctx.field } : undefined;
        return pickImages(target).then(function () { return true; });
      }
    });
    C.register({
      id: 'media.draw', label: 'media.cmd.draw', group: 'node', icon: 'draw',
      keywords: t('media.kw.draw'), help: 'media.help.draw',
      when: function (ctx) {
        var d = drawingOfSelection(ctx);
        return d.ok && (!readOnly() || !!d.existing);
      },
      title: function (ctx) { return drawingOfSelection(ctx).existing ? t('media.cmd.drawOpen') : t('media.cmd.draw'); },
      run: function (ctx) {
        var d = drawingOfSelection(ctx);
        return d.ok ? openDrawing({ path: d.path, field: d.field }) : false;
      }
    });
    C.register({
      id: 'media.panel', label: 'media.cmd.panel', group: 'project', icon: 'folder',
      keywords: t('media.kw.panel'), help: 'media.help.panel',
      when: function () { return !!(store() && store().here().projectId); },
      checked: function () { return panelOpen(); },
      run: function () { return togglePanel(); }
    });
  }

  /* ================================================================ init */

  var inited = false;

  function init() {
    if (inited) return;
    inited = true;
    if (ns.prefs && typeof ns.prefs.define === 'function') {
      try { ns.prefs.define('mediaViewer', { split: SPLIT_DEFAULT, card: null }, { free: true }); } catch (err) { report('prefs', err); }
    }
    registerCommands();
    trackDrag = frameThrottled(function (x, y) { litDrop(nodeUnder(x, y)); });
    document.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('drop', onDragEnd, true);
    var B = ns.bus;
    if (B) {
      B.on('drop', onDrop);
      B.on('store', onStore);
      B.on('map:opened', onMapOpened);
      B.on('map:closed', function () { closeNow(); });
      /* The notebooks write what they hold on 'flush' and 'tabs:yield'
       * themselves; the viewer only follows what they wrote. */
      B.on('notebook', onNotebookWrote);
      B.on('board', onBoard);
      B.on('tabs', syncReadOnly);
      B.on('prefs', function (d) { if (d && d.key === 'mode') syncReadOnly(); });
      B.on('lang', function () {
        relabelViewer();
        if (panel) {
          panel.sheet.setTitle(t('media.panel.title'));
          panel.trash.setAttribute('aria-label', t('media.panel.trash'));
          var lbl = panel.trash.querySelector('.btn__label');
          if (lbl) lbl.textContent = t('media.panel.trash');
          panel.allLabel.lastChild.textContent = t('media.panel.chooseAll');
          renderPanel();
        }
      });
    }
    if (ns.prefs && typeof ns.prefs.on === 'function') {
      ns.prefs.on('viewer', function () { if (shown) applyMode(); });
    }
  }

  ns.media = {
    init: init,
    pickImages: pickImages,
    addFiles: addFiles,
    importFiles: importFiles,
    openViewer: openViewer,
    openDrawing: openDrawing,
    openBoard: openBoard,
    toggleBoard: toggleBoard,
    closeViewer: closeViewer,
    viewerState: viewerState,
    setViewerMode: setMode,
    pictureMenu: pictureMenu,
    pictureItems: pictureItems,
    setPicturePosition: setPicturePosition,
    takePictureOut: takePictureOut,
    askDrawingOut: askDrawingOut,
    picturesOf: picturesOf,
    removeShown: removeShown,
    togglePanel: togglePanel,
    openPanel: openPanel,
    closePanel: closePanel,
    panelOpen: panelOpen,
    flush: flushAll,
    settle: settleFiles,
    MAX_SIDE: MAX_SIDE
  };
})(window.MindRoot);
