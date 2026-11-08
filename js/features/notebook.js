/* MindRoot - notebooks: the map's board and every node drawing as a
 * notebook of pages (docs/NOTEBOOK.md).
 *
 * A notebook is a folder of the project's files:
 *
 *     assets/<slug>.book/book.json      settings and the order of the pages
 *     assets/<slug>.book/001.ink.svg    one self-contained drawing per page
 *     assets/<slug>.book/background.*   a picture used as the paper
 *
 * and the Markdown names its first page, so any viewer shows the cover:
 * `![](assets/x.book/001.ink.svg)` in a node, `<!-- board: ... -->` for the
 * map's board. Nothing here is a format of its own beyond book.json: pages
 * are ns.ink files (scene in their metadata, light paper, literal colours,
 * the semantic ink and the sheet marked mr-ink / mr-sheet so the app shows
 * them in either theme), drawn on the paper of ns.paper.
 *
 * Model. read(projectId, ref) turns whatever a reference names into a book:
 * a .book folder (book.json, missing or broken, falls back to the defaults;
 * page files of the folder that book.json does not list - a page put back
 * from the trash - are taken in, where they were when they left), a lone
 * .ink.svg or .excalidraw.svg (a one-page infinite notebook with default
 * settings, NOT converted by opening it), or nothing yet (a board or node
 * drawing not drawn on). The first change that needs book.json (settings,
 * a second page) moves a lone file into a new folder, and every reference
 * to it in the project's maps is rewritten, in the same undo step; an old
 * .excalidraw.svg moves at its first stroke, since it cannot be written
 * back. A reorder or a delete that changes the first page rewrites the
 * references the same way. A page deleted goes to the project's trash as a
 * file (store.trashFiles: the bytes are kept and restorable; book.json
 * remembers where it stood, so a restore puts it back there). A first page
 * put back is the cover again: the maps are renamed to it inside the
 * restore's own step, whether or not a notebook is open (and any write
 * finds and fixes maps that still name another page of the book).
 *
 * Saving follows the drawing viewer's rules (media.js): nothing exists
 * until the first stroke (then the folder, book.json, the page and the
 * reference to it are one step); ink hands over a page 600 ms after a
 * gesture, and those saves are held and written as ONE labelled step per
 * pause (SAVE_PAUSE, at most SAVE_MAX_WAIT behind), keyed by the page; a
 * press or a key anywhere outside the notebook, Mod+S, the page going away,
 * another tab taking over and every page turn write them at once. The
 * notebook follows the store: an undo or a redo that changes its files (or
 * the reference) reloads what changed, and the page under the pen shows
 * what its file says. There is one history: the editor's Undo and Redo
 * (buttons and Mod+Z) write what is held and then undo the app's last
 * step, a stroke, a setting or a page alike.
 *
 * A picture as the paper is kept whole in the folder and shown whole on
 * the sheet; the page files carry a lighter copy of it (fileCopy), since
 * each page is written again at every pause.
 *
 * View. open(host, opts) mounts one ns.ink editor for the whole notebook:
 *   - infinite mode: the pages are canvases, each unbounded (the paper tiles
 *     forever), shown one at a time - they never stack. The editor turns
 *     from one to another (setPage, each keeping its undo meanwhile) when a
 *     thumbnail is picked, on Page Up / Page Down, and from the rail (shown
 *     from two canvases on: one stretch per canvas, the handle dragged
 *     along it, a press on a stretch, a swipe along it for the next or the
 *     one before). Each canvas keeps its own camera (pan and zoom), and the
 *     canvas shown and the cameras are remembered for the session and in
 *     the map's view state (store.setMapView notebooks, by folder);
 *   - pages mode: pages at their size in mm (1 mm = 96 / 25.4 px), stacked
 *     on a desk, scrolled and zoomed by the editor's own pan, wheel and
 *     pinch (a camera the notebook bounds and follows). Only the page being
 *     drawn on is live in the editor; the others are pictures of their
 *     files, themed (ns.paper.themeSvg), made only for the pages near the
 *     screen. A press on another page turns the editor to it (one editor,
 *     one toolbar, each page keeping its own undo meanwhile). The rail at
 *     the side is GoodNotes' scrollbar: page ticks, a handle to drag, the
 *     "n / N" bubble while scrolling, and a tap that opens the thumbnails
 *     (a side sheet, a bottom sheet on phones) to add, duplicate, delete
 *     and drag pages into order - canvases alike, in infinite mode.
 * The notebook's buttons (pages, settings, export) sit in the editor's
 * action bar. Settings: mode, paper (grouped, with previews drawn by
 * ns.paper), size and orientation (or a custom size in mm), background
 * (automatic with the theme, or a colour), a picture as the paper. Export:
 * a PDF of every page through the print engine (each page its own size by
 * named @page rules; vector, offline) or a PNG of the page in view; in
 * infinite mode a PDF page per canvas cut to its drawn area (empty
 * canvases left out) and a PNG of the canvas shown. Light paper by
 * default, dark on request.
 * Every exported page is drawn again from its scene by ink.serialize (a
 * page file is never put into the document as it is: it may come from an
 * imported project, and would run what it holds), then scrubbed again.
 * The automatic background follows the app theme live.
 *
 * The board view. The map's board is the map's second face: the command
 * view.board (Mod+Shift+L) and the segmented control Map | Board in the
 * top bar (ns.shell.addTopControl; on phones in the top capsule) swap the
 * stage between the map and the board notebook, which fills #stage. The
 * board is created at its first stroke as '<map>-board.book' (boards made
 * before were named '<map>-lavagna.book'; the map's board marker names the
 * folder, so those open as they are, never renamed). The face
 * chosen is remembered per map (store.setMapView view: 'board'). While the
 * board is up the hidden map's keys are kept from it (guardKeys), a node
 * chosen on purpose (a search result) brings the map back, and on a phone
 * the board's bar carries the app's "more" in place of the thumb bar.
 *
 * API (docs/NOTEBOOK.md):
 *   open(host, {projectId, mapId, ref, kind: 'board'|'node', nodePath,
 *               field, readOnly, onClose({saved, ref}), title, focus,
 *               done (false: no Done button), returnFocus}) -> view
 *     view: close() -> Promise (written), done(), flush() -> Promise,
 *           isDirty(), page() -> n (the page in view, the canvas shown),
 *           pages() -> N, goTo(n) (a page, or a canvas), mode(), book(),
 *           editor(), active(), el, ready (Promise: mounted),
 *           setReadOnly(bool), setSetting(patch), setCanvasLook(n, {paper,
 *           background | reset}), addPage(after),
 *           duplicatePage(n), deletePage(n), movePage(from, to),
 *           openThumbs(), openSettings(), exportBook(), idle(), relayout()
 *           (pages are counted from 1)
 *   read(projectId, ref) -> Promise<book>
 *   write(projectId, book, label) -> Promise<bool>   book.json as given
 *   exportPdf(book, {theme, print, texts, image}) -> Promise<{pages, cleanup}>
 *   exportPng(book, pageIndex, {theme, scale, download, text, name, image}) -> Promise<Blob>
 *   board: showBoard(), showMap(), toggleBoard(), boardShown(), boardView()
 *   themed(svgText, theme, background) -> svgText   a page as shown
 *   model (pure, for tests): defaults, normalize, toJson, parseJson,
 *     folderOf, pageName, reconcile, nextPageNumber, isLone, lookOf, metaFor, ...
 *   init(), isDirty(), flush()
 * Command: view.board (Mod+Shift+L). Bus: says 'notebook' {projectId, ref,
 * kind} after it wrote, 'board' {open, projectId, mapId}; hears store,
 * flush, tabs:yield, tabs, theme, lang, layout, sidebar, prefs (view-only),
 * map:opened, map:closed. Starts with the app's init() or, loaded after
 * the app's module list was written, with the first map that opens. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var FORMAT = 1;
  var BOOK_JSON = 'book.json';
  var BOOK_RE = /^(.*\.book)\/([^/]+)$/;
  var DRAWING_RE = /\.(?:excalidraw|ink)\.svg$/i;
  var EXCALIDRAW_RE = /\.excalidraw\.svg$/i;
  var PAGE_RE = /\.ink\.svg$/i;
  var SAVE_PAUSE = 1500;
  var SAVE_MAX_WAIT = 10000;
  /* Pages on the desk: the gap between two, and the room kept around the
   * column (screen px) so a page never sits under the editor's bars. */
  var GAP = 28;
  var SIDE = 24;
  var TOP_WIDE = 68;
  var TOP_COMPACT = 64;
  var BOTTOM_WIDE = 28;
  var BOTTOM_COMPACT = 84;
  var RAIL_ROOM = 20;
  /* Fitted to the width of the screen, a page is never shown bigger than
   * its real size at first: an A4 on a desktop is an A4. */
  var FIT_MAX = 1;
  var ZOOM_MAX = 8;
  /* Pages drawn as pictures: those within this many screens of the view. */
  var NEAR = 1;
  /* A picture used as the paper is kept whole in the folder
   * (background.*) and shown whole on the sheet; every page file carries a
   * lighter copy of it (so each stays self-contained) of at most about
   * FILE_IMAGE_MAX bytes and FILE_IMAGE_SIDE px on its longest side: page
   * files are written again at every pause, and each superseded one stays
   * in the history for a while. */
  var FILE_IMAGE_MAX = 200 * 1024;
  var FILE_IMAGE_SIDE = 1600;
  var FILE_IMAGE_MIN_SIDE = 320;
  var BUBBLE_MS = 900;
  var LONG_PRESS = 350;
  var DRAG_SLOP = 6;
  /* How far a swipe along the rail travels to show the next canvas. */
  var SWIPE_MIN = 24;
  /* Backgrounds offered beside "automatic": paper colours, not theme
   * colours (they are written into the files). */
  var BACKGROUNDS = [
    { id: 'white', hex: '#ffffff' },
    { id: 'cream', hex: '#f6f0e1' },
    { id: 'grey', hex: '#e8eaee' },
    { id: 'slate', hex: '#2b3038' },
    { id: 'green', hex: '#25362e' },
    { id: 'black', hex: '#141517' }
  ];
  var DEFAULT_PAPER = 'dots';
  var BOARD_SUFFIX = '-board';

  /* ================================================================ strings */

  var STRINGS = {
    en: {
      'notebook.view.label': 'View',
      'notebook.view.map': 'Map',
      'notebook.view.board': 'Board',
      'notebook.cmd.board': 'Map or board',
      'notebook.cmd.showBoard': 'Show the board',
      'notebook.cmd.showMap': 'Show the map',
      'notebook.help.board': 'Switches between the map and its board, one notebook for the whole map, shown in place of the map.',
      'notebook.kw.board': 'board whiteboard notebook draw drawing sketch view map',
      'notebook.region': 'Board of {map}',
      'notebook.title': 'Notebook',
      'notebook.pages': 'Pages',
      'notebook.settings': 'Notebook settings',
      'notebook.export': 'Export',
      'notebook.more': 'More commands',
      'notebook.moreTitle': 'More commands',
      'notebook.pageOf': 'Page {n} of {count}',
      'notebook.pageShort': '{n} / {count}',
      'notebook.rail': 'Pages of the notebook',
      'notebook.page': 'Page {n}',
      'notebook.addPage': 'Add a page',
      'notebook.duplicatePage': 'Duplicate the page',
      'notebook.deletePage': 'Move the page to the trash',
      'notebook.moveEarlier': 'Move up',
      'notebook.moveLater': 'Move down',
      'notebook.pageMenu': 'Page {n}: options',
      'notebook.thumbsHint': 'Drag a page to move it. Pages moved to the trash can be restored from there.',
      'notebook.lastPage': 'A notebook keeps at least one page.',
      'notebook.pageTrashed': 'Page {n} moved to the trash.',
      'notebook.pageAdded': 'Page {n} added.',
      'notebook.pageMoved': 'Page moved to position {n}.',
      'notebook.mode': 'Mode',
      'notebook.mode.infinite': 'Infinite',
      'notebook.mode.pages': 'Pages',
      'notebook.modeNote.infinite': 'Canvases without edges, shown one at a time.',
      'notebook.modeNote.pages': 'Pages of a fixed size, one under the other.',
      'notebook.morePages': 'In pages mode each canvas becomes a page.',
      'notebook.moreCanvases': 'In infinite mode each page becomes a canvas.',
      'notebook.canvases': 'Canvases',
      'notebook.canvasOf': 'Canvas {n} of {count}',
      'notebook.railCanvases': 'Canvases of the notebook',
      'notebook.addCanvas': 'Add a canvas',
      'notebook.duplicateCanvas': 'Duplicate the canvas',
      'notebook.deleteCanvas': 'Move the canvas to the trash',
      'notebook.canvasMenu': 'Canvas {n}: options',
      'notebook.thumbsHintCanvases': 'One canvas is shown at a time: pick one to switch to it, drag one to move it. Canvases moved to the trash can be restored from there.',
      'notebook.lastCanvas': 'A notebook keeps at least one canvas.',
      'notebook.canvasTrashed': 'Canvas {n} moved to the trash.',
      'notebook.canvasAdded': 'Canvas {n} added.',
      'notebook.canvasMoved': 'Canvas moved to position {n}.',
      'notebook.canvasRemoved': 'Canvas {n} removed',
      'notebook.trashOwnerCanvas': '{name}, canvas {n}',
      'notebook.export.pdfCanvases': 'PDF of every canvas',
      'notebook.export.pngCanvas': 'PNG of this canvas',
      'notebook.label.addCanvas': 'add a canvas',
      'notebook.label.duplicateCanvas': 'duplicate the canvas',
      'notebook.label.deleteCanvas': 'move the canvas to the trash',
      'notebook.label.moveCanvas': 'move the canvas',
      'notebook.paper': 'Paper',
      'notebook.size': 'Size',
      'notebook.orientation': 'Orientation',
      'notebook.width': 'Width (mm)',
      'notebook.height': 'Height (mm)',
      'notebook.background': 'Background',
      'notebook.bg.auto': 'Automatic',
      'notebook.bg.autoNote': 'Light paper in the light theme, dark paper in the dark theme.',
      'notebook.bg.colour': 'Colour',
      'notebook.bg.white': 'White',
      'notebook.bg.cream': 'Cream',
      'notebook.bg.grey': 'Grey',
      'notebook.bg.slate': 'Slate',
      'notebook.bg.green': 'Blackboard green',
      'notebook.bg.black': 'Black',
      'notebook.bg.other': 'Another colour',
      'notebook.import': 'Choose a picture',
      'notebook.importChange': 'Change the picture',
      'notebook.importNote': 'An SVG, PNG or JPG, kept in the notebook.',
      'notebook.imported': 'The picture is now the paper.',
      'notebook.export.pdfAll': 'PDF of every page',
      'notebook.export.pdfArea': 'PDF of the drawn area',
      'notebook.export.pngPage': 'PNG of this page',
      'notebook.export.pngArea': 'PNG of the drawn area',
      'notebook.export.paper': 'Paper',
      'notebook.export.light': 'Light paper',
      'notebook.export.dark': 'Dark paper',
      'notebook.export.printing': 'Choose "Save as PDF" in the print dialog.',
      'notebook.export.failed': 'The export did not work.',
      'notebook.export.empty': 'Nothing is drawn yet.',
      'notebook.pageRemoved': 'Page {n} removed',
      'notebook.export.done': 'Exported: {file}',
      'notebook.label.draw': 'draw',
      'notebook.label.newBoard': 'start the board',
      'notebook.label.newDrawing': 'draw on the node',
      'notebook.label.settings': 'change the notebook',
      'notebook.label.canvasLook': 'change the paper of a canvas',
      'notebook.scope': 'Applies to',
      'notebook.scope.book': 'Whole notebook',
      'notebook.scope.canvas': 'This canvas ({n})',
      'notebook.scope.note': 'This canvas has its own paper and background; the others keep the notebook\'s.',
      'notebook.scope.note.inherit': 'This canvas uses the notebook\'s paper and background. What you choose below is only for it.',
      'notebook.scope.reset': 'Use the notebook\'s',
      'notebook.label.addPage': 'add a page',
      'notebook.label.duplicatePage': 'duplicate the page',
      'notebook.label.deletePage': 'move the page to the trash',
      'notebook.label.movePage': 'move the page',
      'notebook.label.background': 'use a picture as the paper',
      'notebook.notKept': 'The notebook could not be saved here. Download the page to keep it.',
      'notebook.download': 'Download',
      'notebook.noMap': 'Open a map first.',
      'notebook.trashOwner': '{name}, page {n}',
      'notebook.boardOf': 'Board of {map}',
      'notebook.slug': 'notebook',
      'notebook.unreadable': 'This notebook cannot be read.',
      'notebook.readOnly': 'View only'
    },
    it: {
      'notebook.view.label': 'Vista',
      'notebook.view.map': 'Mappa',
      'notebook.view.board': 'Lavagna',
      'notebook.cmd.board': 'Mappa o lavagna',
      'notebook.cmd.showBoard': 'Mostra la lavagna',
      'notebook.cmd.showMap': 'Mostra la mappa',
      'notebook.help.board': 'Passa dalla mappa alla sua lavagna, un quaderno per tutta la mappa, mostrato al posto della mappa.',
      'notebook.kw.board': 'board whiteboard notebook draw drawing sketch view map lavagna quaderno disegna disegno vista mappa',
      'notebook.region': 'Lavagna di {map}',
      'notebook.title': 'Quaderno',
      'notebook.pages': 'Pagine',
      'notebook.settings': 'Impostazioni del quaderno',
      'notebook.export': 'Esporta',
      'notebook.more': 'Altri comandi',
      'notebook.moreTitle': 'Altri comandi',
      'notebook.pageOf': 'Pagina {n} di {count}',
      'notebook.pageShort': '{n} / {count}',
      'notebook.rail': 'Pagine del quaderno',
      'notebook.page': 'Pagina {n}',
      'notebook.addPage': 'Aggiungi una pagina',
      'notebook.duplicatePage': 'Duplica la pagina',
      'notebook.deletePage': 'Sposta la pagina nel cestino',
      'notebook.moveEarlier': 'Sposta prima',
      'notebook.moveLater': 'Sposta dopo',
      'notebook.pageMenu': 'Pagina {n}: opzioni',
      'notebook.thumbsHint': 'Trascina una pagina per spostarla. Le pagine spostate nel cestino si possono ripristinare da lì.',
      'notebook.lastPage': 'Un quaderno ha almeno una pagina.',
      'notebook.pageTrashed': 'Pagina {n} spostata nel cestino.',
      'notebook.pageAdded': 'Pagina {n} aggiunta.',
      'notebook.pageMoved': 'Pagina spostata in posizione {n}.',
      'notebook.mode': 'Modalità',
      'notebook.mode.infinite': 'Infinita',
      'notebook.mode.pages': 'Pagine',
      'notebook.modeNote.infinite': 'Tele senza bordi, mostrate una alla volta.',
      'notebook.modeNote.pages': "Pagine di misura fissa, una sotto l'altra.",
      'notebook.morePages': 'In modalità pagine ogni tela diventa una pagina.',
      'notebook.moreCanvases': 'In modalità infinita ogni pagina diventa una tela.',
      'notebook.canvases': 'Tele',
      'notebook.canvasOf': 'Tela {n} di {count}',
      'notebook.railCanvases': 'Tele del quaderno',
      'notebook.addCanvas': 'Aggiungi una tela',
      'notebook.duplicateCanvas': 'Duplica la tela',
      'notebook.deleteCanvas': 'Sposta la tela nel cestino',
      'notebook.canvasMenu': 'Tela {n}: opzioni',
      'notebook.thumbsHintCanvases': "Si vede una tela alla volta: toccane una per passarci, trascinala per spostarla. Le tele spostate nel cestino si possono ripristinare da lì.",
      'notebook.lastCanvas': 'Un quaderno ha almeno una tela.',
      'notebook.canvasTrashed': 'Tela {n} spostata nel cestino.',
      'notebook.canvasAdded': 'Tela {n} aggiunta.',
      'notebook.canvasMoved': 'Tela spostata in posizione {n}.',
      'notebook.canvasRemoved': 'Tela {n} tolta',
      'notebook.trashOwnerCanvas': '{name}, tela {n}',
      'notebook.export.pdfCanvases': 'PDF di tutte le tele',
      'notebook.export.pngCanvas': 'PNG di questa tela',
      'notebook.label.addCanvas': 'aggiungi una tela',
      'notebook.label.duplicateCanvas': 'duplica la tela',
      'notebook.label.deleteCanvas': 'sposta la tela nel cestino',
      'notebook.label.moveCanvas': 'sposta la tela',
      'notebook.paper': 'Carta',
      'notebook.size': 'Formato',
      'notebook.orientation': 'Orientamento',
      'notebook.width': 'Larghezza (mm)',
      'notebook.height': 'Altezza (mm)',
      'notebook.background': 'Sfondo',
      'notebook.bg.auto': 'Automatico',
      'notebook.bg.autoNote': 'Carta chiara nel tema chiaro, carta scura nel tema scuro.',
      'notebook.bg.colour': 'Colore',
      'notebook.bg.white': 'Bianco',
      'notebook.bg.cream': 'Crema',
      'notebook.bg.grey': 'Grigio',
      'notebook.bg.slate': 'Ardesia',
      'notebook.bg.green': 'Verde lavagna',
      'notebook.bg.black': 'Nero',
      'notebook.bg.other': 'Un altro colore',
      'notebook.import': "Scegli un'immagine",
      'notebook.importChange': "Cambia l'immagine",
      'notebook.importNote': 'Un SVG, un PNG o un JPG, conservato nel quaderno.',
      'notebook.imported': "L'immagine ora è la carta.",
      'notebook.export.pdfAll': 'PDF di tutte le pagine',
      'notebook.export.pdfArea': "PDF dell'area disegnata",
      'notebook.export.pngPage': 'PNG di questa pagina',
      'notebook.export.pngArea': "PNG dell'area disegnata",
      'notebook.export.paper': 'Carta',
      'notebook.export.light': 'Carta chiara',
      'notebook.export.dark': 'Carta scura',
      'notebook.export.printing': 'Nella finestra di stampa scegli «Salva come PDF».',
      'notebook.export.failed': "L'esportazione non è riuscita.",
      'notebook.export.empty': "Non c'è ancora niente di disegnato.",
      'notebook.pageRemoved': 'Pagina {n} tolta',
      'notebook.export.done': 'Esportato: {file}',
      'notebook.label.draw': 'disegna',
      'notebook.label.newBoard': 'inizia la lavagna',
      'notebook.label.newDrawing': 'disegna sul nodo',
      'notebook.label.settings': 'cambia il quaderno',
      'notebook.label.canvasLook': 'cambia la carta di una tela',
      'notebook.scope': 'Vale per',
      'notebook.scope.book': 'Tutto il quaderno',
      'notebook.scope.canvas': 'Questa tela ({n})',
      'notebook.scope.note': 'Questa tela ha carta e sfondo suoi; le altre tengono quelli del quaderno.',
      'notebook.scope.note.inherit': 'Questa tela usa carta e sfondo del quaderno. Quello che scegli qui sotto vale solo per lei.',
      'notebook.scope.reset': 'Usa quelli del quaderno',
      'notebook.label.addPage': 'aggiungi una pagina',
      'notebook.label.duplicatePage': 'duplica la pagina',
      'notebook.label.deletePage': 'sposta la pagina nel cestino',
      'notebook.label.movePage': 'sposta la pagina',
      'notebook.label.background': "usa un'immagine come carta",
      'notebook.notKept': 'Il quaderno non si è potuto salvare qui. Scarica la pagina per tenerla.',
      'notebook.download': 'Scarica',
      'notebook.noMap': 'Apri prima una mappa.',
      'notebook.trashOwner': '{name}, pagina {n}',
      'notebook.boardOf': 'Lavagna di {map}',
      'notebook.slug': 'quaderno',
      'notebook.unreadable': 'Questo quaderno non si riesce a leggere.',
      'notebook.readOnly': 'Sola lettura'
    }
  };

  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    var text = null;
    if (ns.i18n && typeof ns.i18n.t === 'function') {
      try { text = ns.i18n.t(key, vars); } catch (err) { text = null; }
      if (text != null && text !== key) return text;
    }
    text = STRINGS.en[key] != null ? STRINGS.en[key] : key;
    return String(text).replace(/\{(\w+)\}/g, function (w, n) { return vars && vars[n] != null ? String(vars[n]) : w; });
  }

  /* ================================================================ small helpers */

  function store() { return ns.store; }
  function doc() { return ns.doc; }
  function storage() { return ns.storage; }
  function paperMod() { return ns.paper || null; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  function baseName(path) { return String(path || '').split('/').pop(); }
  function emit(type, detail) { if (ns.bus) ns.bus.emit(type, detail); }

  function warn(what, err) {
    if (window.console && console.warn) console.warn('notebook: ' + what, err);
  }

  function h(tag, attrs) {
    var args = Array.prototype.slice.call(arguments);
    if (ns.util && typeof ns.util.h === 'function') return ns.util.h.apply(null, args);
    var el = document.createElement(tag);
    if (attrs && attrs.class) el.className = Array.isArray(attrs.class) ? attrs.class.filter(Boolean).join(' ') : attrs.class;
    if (attrs && attrs.text != null) el.textContent = attrs.text;
    for (var i = 2; i < args.length; i++) if (args[i]) el.appendChild(typeof args[i] === 'string' ? document.createTextNode(args[i]) : args[i]);
    return el;
  }

  function toast(text, opts) {
    if (ns.ui && typeof ns.ui.toast === 'function') {
      try { return ns.ui.toast(text, opts); } catch (err) { warn('toast', err); }
    }
    return null;
  }

  function uiIcon(name) {
    var el;
    if (ns.ui && typeof ns.ui.icon === 'function') {
      try { el = ns.ui.icon(name); } catch (err) { el = null; }
    }
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.setAttribute('aria-hidden', 'true');
    }
    return el;
  }

  /* The notebook's own icons, in the 24-unit stroke family of the sprite:
   * static, trusted markup. */
  var ICONS = {
    pages: '<rect x="7.5" y="3.5" width="12" height="15" rx="1.5"/><path d="M4.5 7v12a1.5 1.5 0 0 0 1.5 1.5h10"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    export: '<path d="M12 3.5v11"/><path d="M7.5 8L12 3.5 16.5 8"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    duplicate: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8"/>'
  };

  function icon(name, cls) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    el.setAttribute('class', cls || 'ink__icon');
    el.innerHTML = ICONS[name] || '';
    return el;
  }

  function currentTheme() {
    if (ns.shell && typeof ns.shell.theme === 'function') {
      try { return ns.shell.theme() === 'dark' ? 'dark' : 'light'; } catch (err) { /* below */ }
    }
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (err) { return 'light'; }
  }

  function slug(text) {
    var S = storage();
    var out = '';
    if (S && typeof S.slugify === 'function') out = S.slugify(text);
    else if (ns.util && typeof ns.util.slugify === 'function') out = ns.util.slugify(text, '');
    else out = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return out;
  }

  /* ================================================================ the model (pure)
   *
   * book.json, made whole: whatever a file says (it may come from an
   * imported project or a hand) is checked field by field and folded onto
   * the defaults, so the view never meets a value it cannot draw. */

  /* What a new notebook starts on: the paper and background the person chose
   * for all of them in the settings (prefs 'notebook'), checked; the built-in
   * ones when there is none or it is not usable. */
  function appLook() {
    var out = { paper: DEFAULT_PAPER, background: 'auto' };
    var v = null;
    try { v = ns.prefs && typeof ns.prefs.get === 'function' ? ns.prefs.get('notebook') : null; } catch (err) { v = null; }
    var P = paperMod();
    if (v && typeof v === 'object') {
      if (typeof v.paper === 'string' && v.paper !== 'image' && P && P.entry(v.paper)) out.paper = v.paper;
      if (isHex(v.background)) out.background = v.background.toLowerCase();
    }
    return out;
  }

  function defaults() {
    var app = appLook();
    return {
      mindroot: 'book', version: FORMAT,
      mode: 'infinite',
      paper: { type: app.paper },
      size: { id: 'a4', w: 210, h: 297, orientation: 'portrait' },
      background: app.background,
      backgroundImage: null,
      pages: [{ file: pageName(1) }]
    };
  }

  function cleanSize(size) {
    var P = paperMod();
    if (P && typeof P.normalizeSize === 'function') {
      try { return P.normalizeSize(size); } catch (err) { /* below */ }
    }
    return { id: 'a4', w: 210, h: 297, orientation: 'portrait' };
  }

  /* A paper as book.json keeps it: its type and the overrides the file
   * gave, each cleaned by ns.paper. */
  function cleanPaper(paper) {
    var P = paperMod();
    if (!paper || typeof paper !== 'object' || typeof paper.type !== 'string') return { type: DEFAULT_PAPER };
    if (!P || typeof P.normalize !== 'function' || !P.entry(paper.type)) return { type: P && P.entry(paper.type) ? paper.type : DEFAULT_PAPER };
    var n = P.normalize(paper);
    var out = { type: n.type };
    var base = P.entry(n.type).params || {};
    Object.keys(n.params).forEach(function (k) {
      if (n.params[k] !== base[k]) out[k] = n.params[k];
    });
    return out;
  }

  function cleanFile(name) {
    var s = String(name == null ? '' : name);
    if (!s || s.length > 120 || /[\/\\\0]/.test(s) || s === '.' || s === '..') return null;
    return s;
  }

  function normalize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    var out = {
      mindroot: 'book', version: FORMAT,
      mode: raw.mode === 'pages' ? 'pages' : 'infinite',
      paper: cleanPaper(raw.paper),
      size: cleanSize(raw.size || d.size),
      background: isHex(raw.background) ? raw.background.toLowerCase() : 'auto',
      backgroundImage: null,
      pages: []
    };
    var bi = raw.backgroundImage;
    if (bi && typeof bi === 'object' && cleanFile(bi.file) && /^background\.(svg|png|jpe?g)$/i.test(bi.file)) {
      out.backgroundImage = {
        file: bi.file,
        type: /\.svg$/i.test(bi.file) ? 'image/svg+xml' : (/\.png$/i.test(bi.file) ? 'image/png' : 'image/jpeg'),
        w: Number(bi.w) > 0 ? Math.min(Number(bi.w), 20000) : 800,
        h: Number(bi.h) > 0 ? Math.min(Number(bi.h), 20000) : 600
      };
    }
    if (out.paper.type === 'image' && !out.backgroundImage) out.paper = { type: DEFAULT_PAPER };
    var seen = Object.create(null);
    (Array.isArray(raw.pages) ? raw.pages : []).forEach(function (p) {
      var f = cleanFile(p && typeof p === 'object' ? p.file : p);
      if (!f || !DRAWING_RE.test(f) || seen[f]) return;
      seen[f] = true;
      out.pages.push({ file: f });
    });
    if (Array.isArray(raw.trashed)) {
      var gone = [];
      raw.trashed.forEach(function (e) {
        var f = e && cleanFile(e.file);
        if (!f || seen[f] || !DRAWING_RE.test(f)) return;
        gone.push({ file: f, at: Math.max(0, Math.floor(Number(e.at) || 0)) });
      });
      if (gone.length) out.trashed = gone.slice(-200);
    }
    if (!out.pages.length) out.pages = d.pages;
    var looks = cleanLooks(raw.looks);
    if (looks) out.looks = looks;
    return out;
  }

  /* The paper and the background a canvas has of its own (infinite mode),
   * by page file: {paper?, background?}; whatever it leaves out is the
   * notebook's. A picture is never a canvas's paper (it is the notebook's). */
  function cleanLooks(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var out = null;
    Object.keys(raw).slice(0, 500).forEach(function (f) {
      var v = raw[f];
      if (!cleanFile(f) || !DRAWING_RE.test(f) || !v || typeof v !== 'object') return;
      var one = {};
      if (v.paper && typeof v.paper === 'object' && typeof v.paper.type === 'string' && v.paper.type !== 'image') {
        var P = paperMod();
        if (P && P.entry(v.paper.type)) one.paper = cleanPaper(v.paper);
      }
      if (v.background === 'auto' || isHex(v.background)) one.background = v.background === 'auto' ? 'auto' : v.background.toLowerCase();
      if (!one.paper && !one.background) return;
      (out = out || {})[f] = one;
    });
    return out;
  }

  /* The paper and background a page is drawn on: its own where the notebook
   * is infinite and the canvas has one, the notebook's otherwise. */
  function lookOf(meta, file) {
    var own = meta && meta.mode !== 'pages' && meta.looks && file ? meta.looks[file] : null;
    return {
      paper: own && own.paper ? own.paper : meta.paper,
      background: own && own.background ? own.background : meta.background,
      own: own || null
    };
  }

  /* The notebook as one of its canvases sees it: the same meta with the
   * canvas's own paper and background laid over it. */
  function metaFor(meta, file) {
    var l = lookOf(meta, file);
    if (!l.own) return meta;
    var out = {};
    for (var k in meta) out[k] = meta[k];
    out.paper = l.paper;
    out.background = l.background;
    return out;
  }

  function toJson(meta) {
    var m = normalize(meta);
    var out = {
      mindroot: 'book', version: FORMAT, mode: m.mode, paper: m.paper, size: m.size,
      background: m.background, backgroundImage: m.backgroundImage,
      pages: m.pages.map(function (p) { return { file: p.file }; })
    };
    var listed = Object.create(null);
    m.pages.forEach(function (p) { listed[p.file] = true; });
    (m.trashed || []).forEach(function (e) { listed[e.file] = true; });
    var kept = null;
    Object.keys(m.looks || {}).forEach(function (f) { if (listed[f]) (kept = kept || {})[f] = m.looks[f]; });
    if (kept) out.looks = kept;
    if (m.trashed && m.trashed.length) out.trashed = m.trashed;
    return JSON.stringify(out, null, 2) + '\n';
  }

  function parseJson(text) {
    var raw = null;
    try { raw = JSON.parse(String(text)); } catch (err) { return null; }
    if (!raw || typeof raw !== 'object' || (raw.mindroot && raw.mindroot !== 'book')) return null;
    if (typeof raw.version === 'number' && raw.version > FORMAT) return null;
    return normalize(raw);
  }

  /* 'assets/x.book/001.ink.svg' -> 'assets/x.book'; anything else -> null. */
  function folderOf(ref) {
    var m = BOOK_RE.exec(String(ref || ''));
    return m ? m[1] : null;
  }

  function isLone(ref) {
    return !!ref && DRAWING_RE.test(String(ref)) && !folderOf(ref);
  }

  function pageName(n) {
    var s = String(Math.max(1, Math.floor(n)));
    while (s.length < 3) s = '0' + s;
    return s + '.ink.svg';
  }

  function pageNumber(name) {
    var m = /^(\d{1,6})/.exec(String(name || ''));
    return m ? parseInt(m[1], 10) : 0;
  }

  /* The next free page name: after every page the folder has, lists, or
   * holds in the trash (a name in the trash would be taken again by its
   * restore). */
  function nextPageNumber(names) {
    var max = 0;
    (names || []).forEach(function (n) { max = Math.max(max, pageNumber(n)); });
    return max + 1;
  }

  /* The pages of a book as they really are: the ones book.json lists that
   * the folder still has, then the drawing files of the folder it does not
   * list (put back from the trash), each where it stood when it left when
   * book.json remembers it, else at the end in name order. `files` is the
   * list of names in the folder. */
  function reconcile(meta, files) {
    var have = Object.create(null);
    (files || []).forEach(function (f) { have[f] = true; });
    var pages = meta.pages.filter(function (p) { return have[p.file]; }).map(function (p) { return { file: p.file }; });
    var listed = Object.create(null);
    pages.forEach(function (p) { listed[p.file] = true; });
    var orphans = (files || []).filter(function (f) { return DRAWING_RE.test(f) && !listed[f]; });
    var cmp = ns.util && ns.util.naturalCompare ? ns.util.naturalCompare : function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); };
    orphans.sort(cmp);
    var where = Object.create(null);
    (meta.trashed || []).forEach(function (e) { where[e.file] = e.at; });
    var placed = orphans.filter(function (f) { return where[f] != null; }).sort(function (a, b) { return where[a] - where[b]; });
    var rest = orphans.filter(function (f) { return where[f] == null; });
    placed.forEach(function (f) { pages.splice(Math.min(where[f], pages.length), 0, { file: f }); });
    rest.forEach(function (f) { pages.push({ file: f }); });
    var out = {};
    for (var k in meta) out[k] = meta[k];
    out.pages = pages;
    var kept = (meta.trashed || []).filter(function (e) { return !have[e.file]; });
    if (kept.length) out.trashed = kept; else delete out.trashed;
    return out;
  }

  /* ================================================================ files of a project */

  function project(pid) { var st = store(); return st ? st.project(pid) : null; }

  function fileRef(pid, path) {
    var st = store();
    if (!st || !path) return null;
    try {
      var S = storage();
      return S && typeof S.refFor === 'function' ? S.refFor(st, pid, path) : st.fileRef(pid, path);
    } catch (err) { return null; }
  }

  /* The names directly inside a folder, with their files. */
  function folderFiles(pid, folder) {
    var p = project(pid);
    var out = {};
    if (!p || !folder) return out;
    var prefix = folder + '/';
    Object.keys(p.files).forEach(function (path) {
      if (path.indexOf(prefix) !== 0) return;
      var rest = path.slice(prefix.length);
      if (rest.indexOf('/') >= 0) return;
      out[rest] = p.files[path];
    });
    return out;
  }

  function folderExists(pid, folder) { return Object.keys(folderFiles(pid, folder)).length > 0; }

  /* A folder name nothing in the project uses: 'assets/<base>.book', then
   * '<base>-2.book' and on. */
  function freeFolder(pid, base) {
    var p = project(pid);
    var b = base || t('notebook.slug');
    var n = 1;
    function taken(folder) {
      if (!p) return false;
      var prefix = folder + '/';
      return Object.keys(p.files).some(function (k) { return k === folder || k.indexOf(prefix) === 0; }) ||
        p.trash.some(function (e) { return e.path && e.path.indexOf(prefix) === 0; });
    }
    var folder = 'assets/' + b + '.book';
    while (taken(folder)) {
      n++;
      folder = 'assets/' + b + '-' + n + '.book';
    }
    return folder;
  }

  /* Names a folder's pages had that are now in the project's trash. */
  function trashedNames(pid, folder) {
    var p = project(pid);
    if (!p || !folder) return [];
    var prefix = folder + '/';
    return p.trash.filter(function (e) { return e.path && e.path.indexOf(prefix) === 0; }).map(function (e) { return e.path.slice(prefix.length); });
  }

  var textCache = new Map();

  /* The text of a file, by its bytes' id: the same bytes are read once. */
  async function readText(pid, path) {
    var ref = fileRef(pid, path);
    if (!ref) return null;
    if (textCache.has(ref.asset)) return textCache.get(ref.asset);
    var S = storage();
    var text = null;
    try { text = S && typeof S.blobText === 'function' ? await S.blobText(ref.asset) : null; } catch (err) { warn('reading ' + path, err); text = null; }
    if (text != null) {
      if (textCache.size > 400) textCache.delete(textCache.keys().next().value);
      textCache.set(ref.asset, text);
    }
    return text;
  }

  async function readDataUrl(pid, path) {
    var ref = fileRef(pid, path);
    if (!ref) return null;
    var S = storage();
    try { return S && typeof S.blobDataURL === 'function' ? await S.blobDataURL(ref.asset) : null; } catch (err) { warn('reading ' + path, err); return null; }
  }

  /* What a reference names, as a book (see the header):
   *   {projectId, ref, folder, lone, fresh, meta, hasJson, pages: [{file,
   *    path, asset}], jsonAsset}
   * `ref` null or unknown is a book not drawn on yet. */
  async function read(pid, ref) {
    var book = { projectId: pid, ref: ref || null, folder: null, lone: null, fresh: false, meta: defaults(), hasJson: false, pages: [], jsonAsset: null, unreadable: false };
    var folder = folderOf(ref) || (ref && /\.book\/?$/.test(ref) ? String(ref).replace(/\/$/, '') : null);
    if (folder && folderExists(pid, folder)) {
      book.folder = folder;
      var files = folderFiles(pid, folder);
      var meta = null;
      if (files[BOOK_JSON]) {
        book.hasJson = true;
        book.jsonAsset = files[BOOK_JSON].asset;
        var text = await readText(pid, folder + '/' + BOOK_JSON);
        meta = text != null ? parseJson(text) : null;
        if (!meta) book.unreadable = text != null;
      }
      if (!meta) {
        meta = defaults();
        /* No book.json (or one this version cannot read): the pages are
         * the drawings of the folder, in name order. */
        meta.pages = [];
      }
      meta = reconcile(meta, Object.keys(files));
      if (!meta.pages.length) meta.pages = [{ file: pageName(1) }];
      book.meta = meta;
      book.pages = meta.pages.map(function (p) {
        var path = folder + '/' + p.file;
        var r = files[p.file];
        return { file: p.file, path: r ? path : null, asset: r ? r.asset : null };
      });
      book.ref = book.pages[0].path || ref;
      return book;
    }
    if (ref && isLone(ref) && fileRef(pid, ref)) {
      book.lone = ref;
      book.meta = defaults();
      var r2 = fileRef(pid, ref);
      book.pages = [{ file: baseName(ref), path: ref, asset: r2 ? r2.asset : null }];
      book.meta.pages = [{ file: baseName(ref) }];
      return book;
    }
    book.fresh = true;
    book.ref = null;
    book.pages = [{ file: pageName(1), path: null, asset: null }];
    return book;
  }

  /* ================================================================ drawing the pages */

  function pagePx(meta) {
    var P = paperMod();
    if (P && typeof P.pageSize === 'function') {
      try { return P.pageSize(meta.size); } catch (err) { /* below */ }
    }
    return { w: 793.7, h: 1122.52 };
  }

  /* A page file shown in a theme: the paper and the semantic ink recoloured
   * (ns.paper.themeSvg), and a highlighter, which multiplies on light
   * paper, screened on dark paper where multiplying would hide it. */
  function themed(text, theme, background) {
    var P = paperMod();
    var out = String(text || '');
    if (P && typeof P.themeSvg === 'function') {
      try { out = P.themeSvg(out, theme, background); } catch (err) { warn('theming a page', err); }
    }
    var dark = theme === 'dark';
    if (background && background !== 'auto' && P && typeof P.colors === 'function') {
      try { dark = !!P.colors(theme, background).dark; } catch (err) { /* keep */ }
    }
    if (dark) out = out.replace(/mix-blend-mode:\s*multiply/g, 'mix-blend-mode:screen');
    return out;
  }

  /* The picture of an infinite canvas for its thumbnail: the file's own
   * picture (its drawn area, at its own shape) set in a 4:3 box round its
   * middle, the paper drawn over the whole box, so the picture fills the
   * landscape frame of the tile instead of floating in bands of the
   * button's colour. The canvas's paper is anchored to the origin, so the
   * paper added round it meets the file's own without a seam. A file not
   * written by the editor is left as it is. */
  var CANVAS_RATIO = 4 / 3;

  function canvasPicture(text, meta, image) {
    var src = String(text || '');
    var open = /^\s*<svg\b[^>]*>/.exec(src);
    if (!open || open[0].indexOf('data-mindroot-ink') < 0) return src;
    var vb = /\sviewBox="([^"]+)"/.exec(open[0]);
    var nums = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [];
    if (nums.length !== 4 || !nums.every(isFinite) || !(nums[2] > 0) || !(nums[3] > 0)) return src;
    var x = nums[0];
    var y = nums[1];
    var w = nums[2];
    var h = nums[3];
    if (Math.abs(w / h - CANVAS_RATIO) < 0.01) return src;
    var W = w / h > CANVAS_RATIO ? w : h * CANVAS_RATIO;
    var H = w / h > CANVAS_RATIO ? w / CANVAS_RATIO : h;
    var X = x - (W - w) / 2;
    var Y = y - (H - h) / 2;
    var box = [X, Y, W, H].map(function (v) { return Math.round(v * 100) / 100; });
    var paper = '';
    var P = paperMod();
    if (meta && meta.paper && P && typeof P.patternSvg === 'function') {
      try {
        paper = P.patternSvg(meta.paper, {
          x: box[0], y: box[1], w: box[2], h: box[3], mode: 'infinite', print: true, theme: 'light',
          background: meta.background, scale: 1, tile: pagePx(meta), id: 'mrthumb'
        }) || '';
      } catch (err) { paper = ''; }
    }
    if (!paper) {
      var sheet = meta && isHex(meta.background) ? meta.background.toLowerCase() : '#fbfaf7';
      paper = '<rect class="mr-sheet" x="' + box[0] + '" y="' + box[1] + '" width="' + box[2] + '" height="' + box[3] + '" fill="' + sheet + '"/>';
    }
    if (image && /^data:image\//.test(String(image.href || '')) && image.w > 0 && image.h > 0) {
      paper += '<defs><pattern id="mrthumbimg" patternUnits="userSpaceOnUse" x="0" y="0" width="' + image.w + '" height="' + image.h + '">' +
        '<image width="' + image.w + '" height="' + image.h + '" href="' + xmlAttr(image.href) + '"/></pattern></defs>' +
        '<rect class="mr-image" x="' + box[0] + '" y="' + box[1] + '" width="' + box[2] + '" height="' + box[3] + '" fill="url(#mrthumbimg)"/>';
    }
    /* The file itself, nested at its place: its own size dropped for the
     * one of its viewBox, in the same units as the box round it. */
    var inner = open[0].replace(/\s(x|y|width|height)="[^"]*"/g, '')
      .replace(/^\s*<svg\b/, '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + box.join(' ') + '" width="' + box[2] + '" height="' + box[3] + '">' +
      paper + inner + src.slice(open[0].length) + '</svg>';
  }

  function xmlAttr(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* An empty page of this book, as its file. */
  function blankPage(meta, image) {
    var ink = ns.ink;
    if (!ink || typeof ink.serialize !== 'function') return '';
    var scene = { elements: [], page: meta.mode === 'pages' ? pagePx(meta) : null, paper: meta.paper, sheet: meta.background, tile: pagePx(meta), image: image || null };
    return ink.serialize(scene);
  }

  /* A page file drawn again on the book's current paper, size and
   * background (its scene unchanged). `asPage` false writes it as the
   * infinite canvas (no page bounds). `shift` moves the scene. */
  function redraw(text, meta, image, asPage, shift) {
    var ink = ns.ink;
    if (!ink) return text;
    var parsed = ink.parse(String(text || ''));
    if (parsed.kind !== 'ink' && parsed.kind !== 'empty' && parsed.kind !== 'foreign' && parsed.kind !== 'damaged') return text;
    var elements = parsed.kind === 'ink' ? parsed.elements : [];
    if (shift && (shift[0] || shift[1]) && ink.engine && ink.engine.translateEl) {
      elements = elements.map(function (el) { return ink.engine.translateEl(el, shift[0], shift[1]); });
    }
    var bg = parsed.background;
    if (bg && shift) bg = { href: bg.href, x: bg.x + shift[0], y: bg.y + shift[1], w: bg.w, h: bg.h };
    return ink.serialize({
      elements: elements, background: bg, page: asPage ? pagePx(meta) : null, paper: meta.paper,
      sheet: meta.background, tile: pagePx(meta), image: image || null
    });
  }

  /* Where the drawing of an infinite page lies, to fit it on a page. */
  function sceneBox(text) {
    var ink = ns.ink;
    if (!ink || !ink.engine) return null;
    var parsed = ink.parse(String(text || ''));
    if (parsed.kind !== 'ink' || !parsed.elements.length) return null;
    return ink.engine.contentBox(parsed.elements, parsed.background);
  }

  /* Whether a page or a canvas holds anything to show: strokes, or the
   * picture of an old drawing behind them (the paper does not count). */
  function hasDrawing(text) {
    if (!text) return false;
    if (sceneBox(text)) return true;
    var ink = ns.ink;
    try { return !!(ink && ink.parse(String(text)).background); } catch (err) { return false; }
  }

  /* ================================================================ writing
   *
   * Every change goes through apply(): the bytes are stored first (by
   * content, so nothing is written twice), then one store transaction names
   * them in the project, trashes what went, and points the Markdown at the
   * first page - one undo step under one label. A book that needs a folder
   * and has none gets one here. Returns the book as it is afterwards, or
   * null when nothing could be written (another tab holds the data, the
   * project went away). */

  function storeWritable(pid) {
    var st = store();
    if (!st || !project(pid)) return false;
    try { if (typeof st.readOnly === 'function' && st.readOnly()) return false; } catch (err) { return false; }
    return true;
  }

  /* plan:
   *   kind, mapId, owner {path, key, field} (node), title (for names)
   *   meta       the book.json to write (implies a folder)
   *   texts      { pageIndex: svgText } for the pages in plan.pages
   *   pages      the page list after the change [{file, path, asset}]
   *              (default: book.pages)
   *   trash      [{path, owner}] files going to the trash
   *   files      [{path, data, type}] other files (a background picture)
   *   folder     true: the book must live in a folder after this */
  async function apply(book, label, plan) {
    var pid = book.projectId;
    var st = store();
    var S = storage();
    if (!st || !S || typeof S.putBlob !== 'function' || !storeWritable(pid)) return null;
    /* A new book is born as a folder; an old Excalidraw file cannot be
     * written back, so its first change moves it into one. */
    var needFolder = !!(plan.folder || plan.meta || book.fresh || (book.lone && EXCALIDRAW_RE.test(book.lone)));
    var folder = book.folder;
    var pages = (plan.pages || book.pages).map(function (p) { return { file: p.file, path: p.path, asset: p.asset }; });
    /* The plan's own object: a page converted below is what the caller
     * then shows and caches for it. */
    if (!plan.texts) plan.texts = {};
    var texts = plan.texts;
    if (!folder && needFolder) {
      /* A lone file keeps its name as the folder's; a new book takes the
       * name the view gives it (the map's board, the node). */
      var base = (book.lone ? slug(baseName(book.lone).replace(DRAWING_RE, '')) : '') || plan.slug || t('notebook.slug');
      folder = freeFolder(pid, base);
    }
    /* The page paths in their final place: in the folder, or the lone
     * file that stays lone. */
    pages.forEach(function (p, i) {
      if (folder) {
        if (!p.file || !PAGE_RE.test(p.file) || p.path !== folder + '/' + p.file) {
          var name = p.path && folderOf(p.path) === folder ? baseName(p.path) : null;
          if (!name) name = PAGE_RE.test(p.file || '') && !book.lone ? p.file : pageName(i + 1);
          p.file = name;
          p.target = folder + '/' + name;
        } else {
          p.target = p.path;
        }
      } else {
        p.target = p.path || null;
      }
    });
    if (folder) {
      /* Two pages never share a name (a lone file moved in becomes 001,
       * and a new page takes the next free number). */
      var used = Object.create(null);
      var taken = Object.keys(folderFiles(pid, folder)).concat(trashedNames(pid, folder));
      pages.forEach(function (p) {
        if (used[p.file]) {
          p.file = pageName(nextPageNumber(Object.keys(used).concat(taken)));
          p.target = folder + '/' + p.file;
        }
        used[p.file] = true;
      });
    }
    var refs = [];
    var bookText = null;
    var meta = plan.meta ? normalize(plan.meta) : (folder ? book.meta : null);
    if (meta && folder) {
      meta = normalize(meta);
      meta.pages = pages.map(function (p) { return { file: p.file }; });
      if (plan.meta && plan.meta.trashed) meta.trashed = plan.meta.trashed;
      else if (book.meta.trashed) meta.trashed = book.meta.trashed;
      if (plan.meta || needFolder || !book.hasJson || (plan.pages && pagesChanged(book.pages, pages))) bookText = toJson(meta);
    }
    /* Every page of a folder is a drawing of ours: an old Excalidraw file
     * moved in (as it is, or as the text a caller gave) is drawn again as
     * one, its picture behind an empty scene - what its first stroke
     * would have made of it. */
    if (folder) {
      var pageMeta = meta || book.meta;
      for (var c = 0; c < pages.length; c++) {
        var given = texts[c];
        var moved = given == null && book.lone && EXCALIDRAW_RE.test(book.lone) && pages[c].path === book.lone;
        if (!moved && (given == null || !given || String(given).indexOf('data-mindroot-ink') >= 0)) continue;
        var src = moved ? await readText(pid, book.lone) : given;
        if (src == null) continue;
        texts[c] = redraw(src, metaFor(pageMeta, pages[c].file), plan.image || null, pageMeta.mode === 'pages');
      }
    }
    try {
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var text = texts[i];
        if (text != null) {
          refs.push({ path: p.target, ref: await S.putBlob(text, p.file || 'page.ink.svg') });
          continue;
        }
        /* Moved, not changed: the same bytes under the new name. */
        if (p.target && p.path && p.target !== p.path) {
          var old = fileRef(pid, p.path);
          if (old) refs.push({ path: p.target, ref: old });
          continue;
        }
        /* A page that has no file yet gets an empty one, so the folder
         * and book.json always agree. */
        if (p.target && !p.path) {
          var blank = blankPage(metaFor(meta || book.meta, p.file), plan.image || null);
          refs.push({ path: p.target, ref: await S.putBlob(blank, p.file) });
        }
      }
      if (bookText != null) refs.push({ path: folder + '/' + BOOK_JSON, ref: await S.putBlob(bookText, BOOK_JSON) });
      var extra = plan.files || [];
      for (var j = 0; j < extra.length; j++) {
        var blob = typeof Blob === 'function' ? new Blob([extra[j].data], { type: extra[j].type }) : extra[j].data;
        refs.push({ path: folder + '/' + extra[j].name, ref: await S.putBlob(blob, extra[j].name) });
      }
    } catch (err) {
      warn('storing the notebook', err);
      return null;
    }
    if (!storeWritable(pid)) return null;
    var oldFirst = book.ref || null;
    var newFirst = pages[0].target || pages[0].path || null;
    var ok = true;
    var trashed = [];
    writing++;
    try {
      st.transaction(label, function () {
        refs.forEach(function (r) {
          if (!st.setFile(pid, r.path, r.ref, { label: label })) {
            var there = fileRef(pid, r.path);
            if (!there || there.asset !== r.ref.asset) ok = false;
          }
        });
        if (!ok) return;
        if (plan.trash && plan.trash.length) {
          var owners = {};
          plan.trash.forEach(function (x) { owners[x.path] = x.owner || ''; });
          trashed = st.trashFiles(pid, plan.trash.map(function (x) { return x.path; }), owners) || [];
        }
        /* The maps are made to name the first page whenever they name
         * another page of the book: after a change that moved the cover,
         * and after one that did not but found them behind (a first page
         * put back from the trash while no notebook was open). Maps that
         * do not mention the book are passed over by a plain text search. */
        pointAt(book, plan, newFirst, label);
      });
    } catch (err) {
      warn('writing the notebook', err);
      ok = false;
    } finally {
      writing--;
    }
    if (!ok) return null;
    forgetPicture(oldFirst);
    forgetPicture(newFirst);
    var after = {
      projectId: pid, ref: newFirst, folder: folder, lone: folder ? null : book.lone, fresh: !newFirst,
      meta: meta || book.meta, hasJson: !!(folder && (bookText != null || book.hasJson)), unreadable: false,
      jsonAsset: folder ? ((fileRef(pid, folder + '/' + BOOK_JSON) || {}).asset || null) : null,
      pages: pages.map(function (p) {
        var path = p.target || p.path;
        var r = path ? fileRef(pid, path) : null;
        return { file: p.file, path: r ? path : null, asset: r ? r.asset : null };
      }),
      trashed: trashed
    };
    return after;
  }

  function pagesChanged(a, b) {
    if (a.length !== b.length) return true;
    for (var i = 0; i < a.length; i++) if (a[i].file !== b[i].file) return true;
    return false;
  }

  /* The Markdown names the first page. A new book is named where it
   * belongs (the board marker, the node's picture); every reference in the
   * project's maps to a page of the book that is not the first (it was the
   * first before a reorder, a delete, the move of a lone file into its
   * folder) is renamed to the first. Inside apply's transaction, or joined
   * to the step on top (opts.join: a restore from the trash that brought
   * back a first page). Returns whether a map changed. */
  function pointAt(book, plan, newFirst, label, opts) {
    var st = store();
    var D = doc();
    var pid = book.projectId;
    if (!newFirst || !D) return false;
    var p = st.project(pid);
    if (!p) return false;
    var folder = folderOf(newFirst);
    var olds = [book.ref, book.lone].filter(function (r) { return r && r !== newFirst; });
    var changed = false;
    var options = { label: label, origin: 'notebook' };
    if (opts && opts.join != null) options.join = opts.join;
    p.maps.forEach(function (m) {
      var next = m.text;
      /* Read only a map that names something to rename: a plain text
       * search first, so a stroke's write costs nothing on maps that name
       * only the first page, or not the book at all. */
      if (!namesOther(m.text, olds, folder, newFirst)) return;
      D.refsInText(m.text).forEach(function (r) {
        if (r === newFirst) return;
        var mine = olds.indexOf(r) >= 0 || (folder && folderOf(r) === folder);
        if (mine) next = D.renameRef(next, r, newFirst);
      });
      if (next !== m.text) {
        st.setMapText(pid, m.id, next, options);
        changed = true;
      }
    });
    if (changed || !book.fresh || !plan) return changed;
    var map = plan.mapId ? st.map(pid, plan.mapId) : null;
    if (!map) return false;
    var state = D.parse(map.text);
    if (plan.kind === 'board') {
      var r = D.setBoard(state, newFirst, D.boardPlacement(state));
      if (r) st.setMapText(pid, plan.mapId, r.text, options);
      return !!r;
    }
    if (!plan.owner) return false;
    var node = findNode(state, plan.owner.path, plan.owner.key);
    if (node === null) return false;
    var res = D.addImage(state, node, newFirst, '', plan.owner.field === 'body' ? 'body' : 'line');
    if (res) st.setMapText(pid, plan.mapId, res.text, { label: label, origin: 'notebook', to: { selectPath: node } });
    return !!res;
  }

  /* Whether a map's text may name a page of the book other than newFirst:
   * one of the old names, or the folder followed by anything but the first
   * page's name - as written, or as the Markdown may spell it (a space as
   * %20). A yes is checked properly by the caller; a no is certain. */
  function namesOther(text, olds, folder, newFirst) {
    var forms = function (s) { var e = encodeURI(s); return e !== s ? [s, e] : [s]; };
    for (var i = 0; i < olds.length; i++) {
      if (forms(olds[i]).some(function (n) { return text.indexOf(n) >= 0; })) return true;
    }
    if (!folder) return false;
    var first = forms(newFirst);
    return forms(folder + '/').some(function (dir, k) {
      var at = text.indexOf(dir);
      while (at >= 0) {
        if (text.substr(at, first[Math.min(k, first.length - 1)].length) !== first[Math.min(k, first.length - 1)]) return true;
        at = text.indexOf(dir, at + dir.length);
      }
      return false;
    });
  }

  function keyOf(state, path) {
    var D = doc();
    try { return D.lineageKey ? D.lineageKey(state, path) : null; } catch (err) { return null; }
  }

  /* The node a drawing belongs to, found again after edits moved it: by
   * path when it still has the same lineage, else by lineage. */
  function findNode(state, path, key) {
    if (path != null && state.byPath[path] && (!key || keyOf(state, path) === key)) return path;
    if (!key) return path != null && state.byPath[path] ? path : null;
    for (var i = 0; i < state.flat.length; i++) if (keyOf(state, state.flat[i].path) === key) return state.flat[i].path;
    return null;
  }

  function forgetPicture(path) {
    var v = ns.session && ns.session.view;
    if (!path || !v || typeof v.forgetImage !== 'function') return;
    try { v.forgetImage(path); } catch (err) { warn('forgetImage', err); }
  }

  /* book.json written as given (settings changed by a caller that is not a
   * view), one step. */
  async function write(pid, book, label) {
    var b = book && book.projectId ? book : await read(pid, book && book.ref);
    var out = await apply(b, label || 'notebook.label.settings', { meta: book && book.meta ? book.meta : b.meta, folder: true });
    return !!out;
  }

  var writing = 0;

  /* Settings of notebooks not drawn on yet, by view (see holdFresh): kept
   * for this session only, never written. */
  var heldBooks = new Map();

  /* The canvas shown last and the camera of each canvas of the infinite
   * notebooks opened in this session, by notebook ({at, cams}; see the
   * view's recallCanvases): here for the session, and in the map's view
   * state (store.setMapView, notebooks) for the next one. */
  var canvasMemory = new Map();
  var CANVAS_MEMORY_MAX = 60;
  var REMEMBER_MS = 800;

  /* ================================================================ the cover after a restore
   *
   * A page put back from the trash where it stood can be the first page
   * again, with or without a notebook open on it (a node drawing's
   * notebook usually is not): the Markdown names it as the cover, in the
   * step that brought it back, joined to it while it is still the last
   * one. Heard for the whole app, once the restore's transaction is over. */

  var coverDue = Object.create(null);

  function onAnyStore(c) {
    if (!c || c.type !== 'trash:restore' || !c.projectId || coverDue[c.projectId]) return;
    var pid = c.projectId;
    coverDue[pid] = true;
    setTimeout(function () {
      delete coverDue[pid];
      var st = store();
      var hs = st && st.historyState ? st.historyState() : null;
      if (!hs || hs.undoId == null || hs.canRedo) return;
      repairCovers(pid, hs.undoId).catch(function (err) { warn('naming the first page', err); });
    }, 0);
  }

  async function repairCovers(pid, joinId) {
    var p = project(pid);
    var D = doc();
    if (!p || !D) return 0;
    var folders = [];
    p.maps.forEach(function (m) {
      if (m.text.indexOf('.book/') < 0) return;
      D.refsInText(m.text).forEach(function (r) {
        var f = folderOf(r);
        if (f && folders.indexOf(f) < 0) folders.push(f);
      });
    });
    var fixed = 0;
    for (var i = 0; i < folders.length; i++) {
      if (!folderExists(pid, folders[i])) continue;
      var book = await read(pid, folders[i] + '/' + BOOK_JSON);
      if (!book.folder || !book.ref || !storeWritable(pid)) continue;
      var hs = store().historyState();
      if (hs.undoId !== joinId || hs.canRedo) return fixed;
      if (pointAt(book, null, book.ref, 'notebook.label.draw', { join: joinId })) fixed++;
    }
    return fixed;
  }

  if (ns.bus && typeof ns.bus.on === 'function') ns.bus.on('store', onAnyStore);

  /* ================================================================ export */

  var PX_TO_MM = 25.4 / 96;
  var PDF_MAX = 5080;

  function mmOf(px) { return Math.round(px * PX_TO_MM * 100) / 100; }

  function svgSizeOf(text) {
    try {
      var d = new DOMParser().parseFromString(String(text), 'image/svg+xml');
      var root = d.documentElement;
      if (!root || root.localName !== 'svg' || d.getElementsByTagName('parsererror').length) return null;
      var vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
      var w = parseFloat(root.getAttribute('width'));
      var hh = parseFloat(root.getAttribute('height'));
      return w > 0 && hh > 0 ? { x: 0, y: 0, w: w, h: hh } : null;
    } catch (err) { return null; }
  }

  /* The texts of every page of a book, in order (null where a page has no
   * file yet). */
  async function pageTexts(book) {
    var out = [];
    for (var i = 0; i < book.pages.length; i++) {
      var p = book.pages[i];
      out.push(p.path ? await readText(book.projectId, p.path) : null);
    }
    return out;
  }

  /* Ids made unique per page, so several pages inlined in one document do
   * not take each other's patterns. */
  function prefixIds(text, prefix) {
    return String(text)
      .replace(/\sid="([^"]+)"/g, function (w, id) { return ' id="' + prefix + id + '"'; })
      .replace(/url\(#([^)]+)\)/g, function (w, id) { return 'url(#' + prefix + id + ')'; })
      .replace(/(\s(?:xlink:)?href=")#([^"]+)"/g, function (w, head, id) { return head + '#' + prefix + id + '"'; });
  }

  var printJob = null;

  function clearPrint() {
    var job = printJob;
    printJob = null;
    if (!job) return;
    if (job.sheet.parentNode) job.sheet.parentNode.removeChild(job.sheet);
    if (job.style.parentNode) job.style.parentNode.removeChild(job.style);
    document.documentElement.removeAttribute('data-nb-printing');
    window.removeEventListener('afterprint', job.after);
    if (job.mq && job.mq.removeEventListener) job.mq.removeEventListener('change', job.onMq);
  }

  /* A page as it is exported: drawn again from its scene, on the book's
   * paper, size and background, by ink.serialize - never the file's own
   * markup. A page file can come from anywhere (an imported project, a
   * folder made by hand) and the PDF puts it straight into this document,
   * where a script or an event attribute in it would run; what serialize
   * writes is only ever elements it made itself, and a picture (the old
   * drawing of a foreign file, the background) only as an <image> data
   * URL, which never runs anything. Old files are read the way the editor
   * reads them (their default black becomes the ink). */
  function exportedPage(text, meta, image) {
    var ink = ns.ink;
    if (!ink || typeof ink.parse !== 'function') return '';
    var parsed = ink.parse(String(text || ''));
    var elements = parsed.kind === 'ink' ? parsed.elements : [];
    return ink.serialize({
      elements: elements, background: parsed.background || null,
      page: meta.mode === 'pages' ? pagePx(meta) : null, paper: meta.paper, sheet: meta.background,
      tile: pagePx(meta), image: image || null
    });
  }

  var SVG_SAFE_HREF = /^(#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,])/i;

  /* Every url() in a style names the page itself or a picture it holds. */
  function safeUrls(css) {
    var re = /url\(([^)]*)\)/gi;
    var m;
    while ((m = re.exec(css))) {
      if (!SVG_SAFE_HREF.test(m[1].trim().replace(/^['"]|['"]$/g, '').trim())) return false;
    }
    return !/@import|expression\(/i.test(css);
  }

  /* A second line behind exportedPage, for whatever goes into the document:
   * no script, no foreign HTML, no event attribute, no reference that is
   * not to the page itself or a picture held in it. */
  function scrubSvg(root) {
    /* A <style> inlined in the document would restyle the app itself;
     * the animation elements can set a reference after the fact. */
    var gone = root.querySelectorAll('script, style, foreignObject, iframe, object, embed, animate, set, animateMotion, animateTransform, animateColor');
    for (var i = 0; i < gone.length; i++) gone[i].remove();
    var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    all.forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var name = a.name.toLowerCase();
        if (name.indexOf('on') === 0) el.removeAttribute(a.name);
        else if ((name === 'href' || name === 'xlink:href' || name === 'src') && !SVG_SAFE_HREF.test(a.value.trim())) el.removeAttribute(a.name);
        else if (name === 'style' && !safeUrls(a.value)) el.removeAttribute(a.name);
      });
    });
    return root;
  }

  /* The book's background picture, whole (for an export), or null. */
  async function bookImage(book) {
    var bi = book.meta.backgroundImage;
    if (!bi || book.meta.paper.type !== 'image' || !book.folder) return null;
    var href = await readDataUrl(book.projectId, book.folder + '/' + bi.file);
    return href ? { href: href, w: bi.w, h: bi.h } : null;
  }

  /* A picture repeated in every page of a printed notebook is held once per
   * page in the document: past this many bytes in all, the lighter copy of
   * the page files is printed instead of the whole picture. */
  var PRINT_IMAGE_BUDGET = 40 * 1024 * 1024;

  /* Every page in a print-only sheet, each on a page of its own size (a
   * named @page per size), the SVG inlined so it prints as vectors. In
   * infinite mode every canvas with something drawn on it is a page cut to
   * its drawn area (an empty canvas is left out; when all are empty, the
   * first one is the page). Prints unless
   * opts.print === false (tests print with page.pdf). opts.theme: 'light'
   * (default) or 'dark' paper; opts.texts the pages' texts (default: the
   * files); opts.image the background picture {href, w, h} (default: read
   * from the folder). Resolves {pages: [{w, h}] in mm, cleanup}. */
  async function exportPdf(book, opts) {
    opts = opts || {};
    var theme = opts.theme === 'dark' ? 'dark' : 'light';
    var texts = opts.texts || await pageTexts(book);
    var meta = book.meta;
    var order = texts.map(function (x, i) { return i; });
    if (meta.mode !== 'pages') {
      order = order.filter(function (i) { return hasDrawing(texts[i]); });
      if (!order.length) order = texts.length ? [0] : [];
    }
    var list = order.map(function (i) { return texts[i]; });
    var image = opts.image !== undefined ? opts.image : await bookImage(book);
    if (image && image.href.length * list.length > PRINT_IMAGE_BUDGET) {
      var light = await fileCopy(image.href, image.w, image.h);
      image = light ? { href: light, w: image.w, h: image.h } : null;
    }
    var pages = [];
    var sheet = document.createElement('div');
    sheet.className = 'nb-print';
    sheet.setAttribute('aria-hidden', 'true');
    var sizes = [];
    list.forEach(function (text, i) {
      /* A canvas with a paper of its own is printed on it. */
      var own = metaFor(meta, book.pages[order[i]] ? book.pages[order[i]].file : null);
      var src = exportedPage(text, own, own.paper.type === 'image' ? image : null);
      var box = svgSizeOf(src) || { x: 0, y: 0, w: 320, h: 200 };
      var w = mmOf(box.w);
      var hh = mmOf(box.h);
      var longest = Math.max(w, hh);
      if (longest > PDF_MAX) { w = Math.round(w * PDF_MAX / longest * 100) / 100; hh = Math.round(hh * PDF_MAX / longest * 100) / 100; }
      var key = w + 'x' + hh;
      var at = sizes.indexOf(key);
      if (at < 0) { sizes.push(key); at = sizes.length - 1; }
      var holder = document.createElement('section');
      holder.className = 'nb-print__page';
      holder.setAttribute('data-size', String(at));
      var parsed = new DOMParser().parseFromString(prefixIds(themed(src, theme, own.background), 'p' + (i + 1) + '-'), 'image/svg+xml');
      var root = parsed.documentElement;
      if (root && root.localName === 'svg' && !parsed.getElementsByTagName('parsererror').length) {
        var svg = document.importNode(scrubSvg(root), true);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        var metaEl = svg.querySelector('metadata');
        if (metaEl) metaEl.remove();
        holder.appendChild(svg);
      }
      sheet.appendChild(holder);
      pages.push({ w: w, h: hh });
    });
    var css = '';
    sizes.forEach(function (key, i) {
      var wh = key.split('x');
      css += '@page nbp' + i + '{size:' + wh[0] + 'mm ' + wh[1] + 'mm;margin:0}' +
        '.nb-print__page[data-size="' + i + '"]{page:nbp' + i + ';width:' + wh[0] + 'mm;height:' + wh[1] + 'mm}';
    });
    clearPrint();
    var style = document.createElement('style');
    style.textContent = '@media print{' + css + '}';
    document.head.appendChild(style);
    document.body.appendChild(sheet);
    document.documentElement.setAttribute('data-nb-printing', '');
    var job = { sheet: sheet, style: style, after: null, mq: null, onMq: null };
    job.after = function () { if (printJob === job) clearPrint(); };
    window.addEventListener('afterprint', job.after);
    try {
      job.mq = window.matchMedia('print');
      job.onMq = function (e) { if (!e.matches) setTimeout(job.after, 500); };
      if (job.mq.addEventListener) job.mq.addEventListener('change', job.onMq);
    } catch (err) { job.mq = null; }
    printJob = job;
    var out = { pages: pages, cleanup: clearPrint };
    if (opts.print === false) return out;
    await new Promise(function (r) { setTimeout(r, 60); });
    window.print();
    return out;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image')); };
      img.src = url;
    });
  }

  /* ================================================================ the picture in the files */

  var fileCopies = new Map();

  /* The copy of a background picture written into the page files: the
   * picture itself when it is light enough, else drawn again smaller (a
   * JPEG, or a PNG when it has transparent parts), stepping down quality
   * and size until it fits. Resolves a data URL, or null when it cannot be
   * made (a browser that will not read a picture back from a canvas): the
   * page files then go without it, and the folder still has it. Kept per
   * picture, so a notebook reopened does not draw it again. */
  function fileCopy(href, w, h) {
    if (!href) return Promise.resolve(null);
    if (href.length <= FILE_IMAGE_MAX * 1.37) return Promise.resolve(href);
    var key = href.length + ':' + href.slice(-64) + ':' + w + 'x' + h;
    if (fileCopies.has(key)) return fileCopies.get(key);
    var job = loadImage(href).then(function (img) {
      var nw = img.naturalWidth || w || 800;
      var nh = img.naturalHeight || h || 600;
      var side = FILE_IMAGE_SIDE;
      var quality = 0.85;
      var png = null;
      var best = null;
      for (var tries = 0; tries < 12; tries++) {
        var k = Math.min(1, side / Math.max(nw, nh));
        var W = Math.max(1, Math.round(nw * k));
        var H = Math.max(1, Math.round(nh * k));
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        if (png === null) png = hasTransparency(ctx, W, H);
        var url = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
        if (!best || url.length < best.length) best = url;
        if (url.length <= FILE_IMAGE_MAX * 1.37) return url;
        if (!png && quality > 0.62) quality -= 0.1;
        else if (side > FILE_IMAGE_MIN_SIDE) side = Math.max(FILE_IMAGE_MIN_SIDE, Math.round(side * 0.75));
        else break;
      }
      return best;
    }).catch(function (err) {
      warn('the picture could not be made lighter for the pages', err);
      return null;
    });
    if (fileCopies.size > 8) fileCopies.delete(fileCopies.keys().next().value);
    fileCopies.set(key, job);
    return job;
  }

  /* Whether any pixel is not fully opaque (a JPEG would turn it black). */
  function hasTransparency(ctx, W, H) {
    var data = ctx.getImageData(0, 0, W, H).data;
    for (var i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  }

  /* One page (or the drawn area of one canvas of an infinite notebook) as a
   * PNG, at twice its size (capped so a phone can hold the canvas).
   * Downloads it unless opts.download === false; resolves the blob. */
  async function exportPng(book, index, opts) {
    opts = opts || {};
    var theme = opts.theme === 'dark' ? 'dark' : 'light';
    var i = clamp(index | 0, 0, book.pages.length - 1);
    var meta = metaFor(book.meta, book.pages[i] ? book.pages[i].file : null);
    var image = opts.image !== undefined ? opts.image : await bookImage(book);
    if (meta.paper.type !== 'image') image = null;
    var text = exportedPage(opts.text || (book.pages[i].path ? await readText(book.projectId, book.pages[i].path) : null) || '', meta, image);
    var box = svgSizeOf(text) || { w: 320, h: 200 };
    var scale = opts.scale || 2;
    var longest = Math.max(box.w, box.h) * scale;
    if (longest > 8192) scale = scale * 8192 / longest;
    var W = Math.max(1, Math.round(box.w * scale));
    var H = Math.max(1, Math.round(box.h * scale));
    var shown = themed(text, theme, meta.background);
    /* Sized in the file for the raster (an SVG without width and height
     * draws at 300 x 150 in an <img>). */
    shown = shown.replace(/<svg\b([^>]*)>/, function (w, attrs) {
      return '<svg' + attrs.replace(/\s(width|height)="[^"]*"/g, '') + ' width="' + W + '" height="' + H + '">';
    });
    var url = URL.createObjectURL(new Blob([shown], { type: 'image/svg+xml' }));
    try {
      var img = await loadImage(url);
      var canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      canvas.getContext('2d').drawImage(img, 0, 0, W, H);
      var blob = await new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('png')); }, 'image/png');
      });
      if (opts.download !== false && ns.util && typeof ns.util.download === 'function') {
        ns.util.download(blob, (opts.name || 'notebook') + (meta.mode === 'pages' || book.pages.length > 1 ? '-' + (i + 1) : '') + '.png');
      }
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ================================================================ the view */

  var views = [];

  function prefsGet(key, fallback) {
    try { return ns.prefs && typeof ns.prefs.get === 'function' ? (ns.prefs.get(key) || fallback) : fallback; } catch (err) { return fallback; }
  }

  /* The paper of an export, remembered for the next one (a preference of
   * this module: prefs keeps only the keys declared to it). */
  if (ns.prefs && typeof ns.prefs.define === 'function') {
    try { ns.prefs.define('notebookExport', { paper: 'light' }, { enums: { 'notebookExport.paper': ['light', 'dark'] } }); } catch (err) { /* this session only */ }
  }

  function exportPaper() {
    var v = prefsGet('notebookExport', null);
    return v && v.paper === 'dark' ? 'dark' : 'light';
  }

  function setExportPaper(paper) {
    try { if (ns.prefs) ns.prefs.set('notebookExport', { paper: paper === 'dark' ? 'dark' : 'light' }); } catch (err) { /* this session only */ }
  }

  function open(host, opts) {
    opts = opts || {};
    if (!host || typeof host.appendChild !== 'function') throw new Error('notebook.open needs a host element');
    var pid = opts.projectId;
    var kind = opts.kind === 'board' ? 'board' : 'node';
    var S = {
      book: null,
      texts: {},             // page file name (or '#i' while it has none) -> its text
      pending: new Map(),    // page key -> svg held back
      pendingSince: 0,
      timer: 0,
      chain: Promise.resolve(),
      sig: '',
      active: 0,             // the page live in the editor
      cam: null,             // pages mode: the column's camera {x, y, k}
      cams: {},              // infinite mode: each canvas's camera, by page key
      recalled: {},          // page keys whose camera came from memory, not yet shown
      switching: false,      // the editor is being turned or placed: its camera is not the person's
      memTimer: 0,
      kr: 0,                 // the scale the page pictures were laid out at
      origin: opts.ref || null,
      places: opts.ref ? [opts.ref] : [],
      applying: 0,
      storeMissed: false,
      urls: new Map(),
      readOnly: !!opts.readOnly,
      closed: false,
      ended: false,
      editor: null,
      image: null,           // the background picture {href (whole), file (the copy in the pages), w, h}
      imageKey: null
    };
    var owner = null;
    if (kind === 'node' && opts.nodePath != null) {
      var mp = opts.mapId ? store().map(pid, opts.mapId) : null;
      var st0 = mp ? doc().parse(mp.text) : null;
      owner = { path: String(opts.nodePath), key: st0 ? keyOf(st0, String(opts.nodePath)) : null, field: opts.field === 'body' ? 'body' : 'line' };
    }
    /* Where settings chosen before the first stroke wait (holdFresh): the
     * map's board, or the node's drawing by its lineage and box. */
    var heldKey = [kind, pid, opts.mapId || '', owner ? (owner.key || owner.path) + '|' + owner.field : ''].join('\u0000');

    var root = h('div', { class: 'nb', 'data-kind': kind, 'data-loading': '' });
    var desk = h('div', { class: 'nb__desk', 'aria-hidden': 'true' });
    var layer = h('div', { class: 'nb__layer' });
    desk.appendChild(layer);
    var inkHost = h('div', { class: 'nb__ink', id: (ns.util && ns.util.uid ? ns.util.uid('nb') : 'nb' + Date.now().toString(36)) });
    root.appendChild(desk);
    root.appendChild(inkHost);
    var rail = buildRail();
    root.appendChild(rail.el);
    host.appendChild(root);

    /* ---------------------------------------------------------------- buttons in the editor's bar */

    function hostButton(name, label, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ink__btn ink__host';
      b.setAttribute('aria-label', label);
      b.setAttribute('data-nb', name);
      b.appendChild(icon(name));
      b.addEventListener('click', onClick);
      if (ns.ui && typeof ns.ui.tooltip === 'function') {
        try { ns.ui.tooltip(b, label); } catch (err) { b.title = label; }
      } else b.title = label;
      return b;
    }

    var pagesBtn = hostButton('pages', t('notebook.pages'), function () { openThumbs(); });
    pagesBtn.setAttribute('aria-haspopup', 'dialog');
    var settingsBtn = hostButton('settings', t('notebook.settings'), function () { openSettings(); });
    settingsBtn.setAttribute('aria-haspopup', 'dialog');
    var exportBtn = hostButton('export', t('notebook.export'), function () { openExport(exportBtn); });
    exportBtn.setAttribute('aria-haspopup', 'menu');
    /* The board on a phone covers the thumb bar, and with it the app's
     * "more" (the palette, settings, help, export, back to the map): the
     * board's own bar carries it there (notebook.css shows it on phones
     * only, where the thumb bar is hidden). */
    var moreBtn = hostButton('more', t('notebook.more'), function () { openAppMore(moreBtn); });
    moreBtn.setAttribute('aria-haspopup', 'menu');

    function openAppMore(anchor) {
      var items = boardMoreItems();
      if (!items.length || !ns.ui || typeof ns.ui.menu !== 'function') return;
      ns.ui.menu(anchor, items, { align: 'end', title: t('notebook.moreTitle'), label: t('notebook.moreTitle') });
    }

    /* The pages (or canvases) of the notebook, its settings and its export,
     * in both modes. */
    function hostActions() {
      var list = [pagesBtn, settingsBtn, exportBtn];
      if (kind === 'board' && ns.commands && typeof ns.commands.all === 'function') list.push(moreBtn);
      return list;
    }

    function relabelButtons() {
      [[pagesBtn, word('notebook.pages')], [settingsBtn, 'notebook.settings'], [exportBtn, 'notebook.export'], [moreBtn, 'notebook.more']].forEach(function (pair) {
        pair[0].setAttribute('aria-label', t(pair[1]));
        if (ns.ui && typeof ns.ui.tooltip === 'function') {
          try { ns.ui.tooltip(pair[0], t(pair[1])); } catch (err) { pair[0].title = t(pair[1]); }
        } else pair[0].title = t(pair[1]);
      });
    }

    /* ---------------------------------------------------------------- state helpers */

    function meta() { return S.book.meta; }
    function isPages() { return !!S.book && meta().mode === 'pages'; }

    /* The words for the pages of an infinite notebook, its canvases. */
    var CANVAS_WORDS = {
      'notebook.pages': 'notebook.canvases',
      'notebook.pageOf': 'notebook.canvasOf',
      'notebook.rail': 'notebook.railCanvases',
      'notebook.addPage': 'notebook.addCanvas',
      'notebook.duplicatePage': 'notebook.duplicateCanvas',
      'notebook.deletePage': 'notebook.deleteCanvas',
      'notebook.pageMenu': 'notebook.canvasMenu',
      'notebook.thumbsHint': 'notebook.thumbsHintCanvases',
      'notebook.lastPage': 'notebook.lastCanvas',
      'notebook.pageTrashed': 'notebook.canvasTrashed',
      'notebook.pageAdded': 'notebook.canvasAdded',
      'notebook.pageMoved': 'notebook.canvasMoved',
      'notebook.pageRemoved': 'notebook.canvasRemoved',
      'notebook.trashOwner': 'notebook.trashOwnerCanvas',
      'notebook.label.addPage': 'notebook.label.addCanvas',
      'notebook.label.duplicatePage': 'notebook.label.duplicateCanvas',
      'notebook.label.deletePage': 'notebook.label.deleteCanvas',
      'notebook.label.movePage': 'notebook.label.moveCanvas'
    };
    function word(key) { return S.book && !isPages() && CANVAS_WORDS[key] ? CANVAS_WORDS[key] : key; }
    function tw(key, vars) { return t(word(key), vars); }
    function count() { return S.book ? S.book.pages.length : 1; }
    function pageKey(i) { var p = S.book.pages[i]; return p ? (p.file || '#' + i) : '#' + i; }
    function keyIndex(key) {
      for (var i = 0; i < S.book.pages.length; i++) if (pageKey(i) === key) return i;
      return -1;
    }
    function size() { return pagePx(meta()); }
    function pageTop(i) { return i * (size().h + GAP); }
    function columnHeight() { var s = size(); return count() * s.h + (count() - 1) * GAP; }

    /* The look of the sheet: the notebook's, or a canvas's own (i, 0-based;
     * the canvas shown by default). */
    function look(i) {
      var m = metaFor(meta(), S.book.pages[i == null ? S.active : i] ? S.book.pages[i == null ? S.active : i].file : null);
      return { theme: currentTheme(), background: m.background, paper: m.paper, tile: size(), image: imageFor(m) };
    }

    /* The background picture, when the paper is the picture: shown whole
     * on the sheet, its lighter copy written into the page files. */
    function imageFor(m) {
      if (!S.image || m.paper.type !== 'image') return null;
      return { href: S.image.href, w: S.image.w, h: S.image.h, fileHref: S.image.file, embed: !!S.image.file };
    }

    function fileImage(m) {
      if (!S.image || !S.image.file || m.paper.type !== 'image') return null;
      return { href: S.image.file, w: S.image.w, h: S.image.h };
    }

    function title() {
      if (opts.title) return opts.title;
      if (kind === 'board') {
        var m = opts.mapId ? store().map(pid, opts.mapId) : null;
        return t('notebook.boardOf', { map: m ? m.name : '' });
      }
      return t('notebook.title');
    }

    /* The book's state as the store has it, in one string: a change of it
     * that is not our own write means the history (or another hand) moved
     * the notebook's files. */
    function storeSig() {
      var p = project(pid);
      if (!p) return 'gone';
      var parts = [];
      if (kind === 'board' && opts.mapId) parts.push('ref:' + (boardRef() || ''));
      var b = S.book;
      if (b && b.folder) {
        var files = folderFiles(pid, b.folder);
        Object.keys(files).sort().forEach(function (k) { parts.push(k + '=' + files[k].asset); });
      } else if (b && b.lone) {
        var r = fileRef(pid, b.lone);
        parts.push('lone=' + (r ? r.asset : ''));
      } else if (b && b.fresh) {
        if (S.origin) {
          var o = fileRef(pid, S.origin);
          parts.push('origin=' + (o ? o.asset : ''));
        }
        /* Back to new by an undo: a redo brings back a place it had. */
        S.places.forEach(function (r) {
          var f = folderOf(r);
          parts.push('place:' + r + '=' + (f ? folderExists(pid, f) : !!fileRef(pid, r)));
        });
      }
      return parts.join('|');
    }

    /* The board marker of the map, read again only when the text changed
     * (every store change asks; typing in the Markdown panel is many). */
    var boardMemo = { text: null, ref: null };
    function boardRef() {
      var m = opts.mapId ? store().map(pid, opts.mapId) : null;
      if (!m) return null;
      if (m.text === boardMemo.text) return boardMemo.ref;
      var ref = null;
      try { ref = doc().boardPath(doc().parse(m.text)); } catch (err) { ref = null; }
      boardMemo = { text: m.text, ref: ref };
      return ref;
    }

    /* Where the notebook is now: the board marker of the map; for a node
     * drawing the folder or lone file it was on, else the file it opened. */
    function currentRef() {
      if (kind === 'board') return boardRef();
      var b = S.book;
      if (b && b.folder && folderExists(pid, b.folder)) return b.folder + '/' + (b.pages[0] ? b.pages[0].file : pageName(1));
      if (b && b.lone && fileRef(pid, b.lone)) return b.lone;
      /* Undone past a move: the last place it had that is still there. */
      for (var i = S.places.length - 1; i >= 0; i--) {
        var r = S.places[i];
        var f = folderOf(r);
        if (f ? folderExists(pid, f) : fileRef(pid, r)) return r;
      }
      return null;
    }

    function remember(ref) {
      if (!ref || S.places[S.places.length - 1] === ref) return;
      S.places.push(ref);
      if (S.places.length > 20) S.places.shift();
    }

    /* ---------------------------------------------------------------- loading */

    async function load(ref, keep) {
      var book = takeHeld(await read(pid, ref));
      if (S.closed) return;
      S.book = book;
      var texts = {};
      /* Every page's file, read together (a notebook of a hundred pages
       * opens in the time of its slowest page, not of all of them). */
      var got = await Promise.all(book.pages.map(function (p) { return p.path ? readText(pid, p.path) : Promise.resolve(''); }));
      if (S.closed) return;
      got.forEach(function (tx, i) { texts[pageKey(i)] = tx != null ? tx : ''; });
      S.texts = texts;
      await loadBackground();
      if (S.closed) return;
      S.sig = storeSig();
      if (!keep) S.active = 0;
      S.active = clamp(S.active, 0, count() - 1);
    }

    async function loadBackground() {
      var bi = meta().backgroundImage;
      var key = bi && S.book.folder ? S.book.folder + '/' + bi.file + '#' + ((fileRef(pid, S.book.folder + '/' + bi.file) || {}).asset || '') : null;
      if (key === S.imageKey) return;
      S.imageKey = key;
      S.image = null;
      if (!key) return;
      var href = await readDataUrl(pid, S.book.folder + '/' + bi.file);
      if (!href || S.imageKey !== key) return;
      var file = await fileCopy(href, bi.w, bi.h);
      if (S.imageKey !== key) return;
      S.image = { href: href, file: file, w: bi.w, h: bi.h };
    }

    /* ---------------------------------------------------------------- the editor */

    function textOf(i) {
      var tx = S.texts[pageKey(i)];
      return tx != null ? tx : '';
    }

    function buildEditor() {
      /* The editor being replaced hands over what it holds (onSave) and
       * closes; S.editor is let go first, so its onClose is not taken for
       * the notebook's own Done. */
      var old = S.editor;
      S.editor = null;
      if (old) {
        try { old.close(); } catch (err) { warn('closing the editor', err); }
      }
      inkHost.textContent = '';
      var pages = isPages();
      root.setAttribute('data-mode', pages ? 'pages' : 'infinite');
      relabelButtons();
      var editorOpts = {
        svgText: textOf(S.active),
        title: title(),
        readOnly: S.readOnly,
        focus: opts.focus !== false,
        returnFocus: opts.returnFocus,
        look: look(),
        page: pages ? size() : null,
        pageId: pageKey(S.active),
        actions: hostActions(),
        onCamera: onCamera,
        done: kind === 'board' ? false : opts.done !== false,
        history: { undo: function () { appHistory('undo'); }, redo: function () { appHistory('redo'); }, state: historyNow },
        onSave: onInkSave,
        onClose: onInkClose
      };
      if (pages) {
        editorOpts.hostCamera = true;
        editorOpts.clampCamera = clampCamera;
        editorOpts.onOutside = onOutside;
        editorOpts.momentum = true;
        if (!S.cam) S.cam = fitCam(0);
        editorOpts.camera = inkCam(S.cam);
      }
      /* The editor fits the drawing as it opens: not a camera of the
       * person's, so not one to remember. */
      S.switching = true;
      try { S.editor = ns.ink.open(inkHost, editorOpts); } finally { S.switching = false; }
      if (pages) {
        S.editor.setCamera(inkCam(S.cam));
        layoutDesk(true);
      } else placeCanvas();
      paintRail();
      /* The first editor was made while the notebook was still hidden
       * (data-loading), where it cannot take the focus it asked for. */
      var first = root.hasAttribute('data-loading');
      root.removeAttribute('data-loading');
      if (first && editorOpts.focus && S.editor && typeof S.editor.focus === 'function') S.editor.focus();
    }

    function onInkSave(svg, info) {
      if (S.closed && S.ended) return false;
      var key = info && info.page != null ? info.page : pageKey(S.active);
      S.texts[key] = svg;
      dropUrl(key);
      if (S.readOnly) return false;
      /* Moved to the end: the last entry is always the newest page. */
      S.pending.delete(key);
      S.pending.set(key, svg);
      if (S.editor) S.editor.refreshHistory();
      if (!S.pendingSince) S.pendingSince = Date.now();
      clearTimeout(S.timer);
      var wait = Math.max(0, Math.min(SAVE_PAUSE, S.pendingSince + SAVE_MAX_WAIT - Date.now()));
      S.timer = setTimeout(function () { commitPending(); }, wait);
      paintThumbSoon(key);
      return true;
    }

    /* ---------------------------------------------------------------- one history
     *
     * The notebook's strokes are steps of the app's history, with its
     * settings and its pages: undo and redo in the editor (keys and
     * buttons) are the app's own, once what the editor handed over is a
     * step. Through the history.* commands when the app has them (they say
     * what was undone), else straight to the store. */

    function appHistory(which) {
      if (S.closed || S.readOnly) return;
      commitPending().then(function (written) {
        /* Strokes that could not be written are not a step: undoing now
         * would take back the one before them instead (the person has been
         * offered the page to download). */
        if (S.closed || written === false) return;
        var C = ns.commands;
        if (C && typeof C.has === 'function' && C.has('history.' + which)) {
          C.run('history.' + which, { source: 'notebook' });
          return;
        }
        var st = store();
        if (st && typeof st[which] === 'function') st[which]();
      });
    }

    function historyNow() {
      var st = store();
      var hs = st && st.historyState ? st.historyState() : null;
      var held = S.pending.size > 0;
      return { undo: held || !!(hs && hs.canUndo), redo: !held && !!(hs && hs.canRedo) };
    }

    function onInkClose(info) {
      if (S.closing || !S.editor) return;
      /* Done in the editor (a node drawing in the viewer): the notebook
       * closes with it, once what it holds is written. */
      if (info && info.svg && !info.saved && !S.readOnly) S.pending.set(info.page != null ? info.page : pageKey(S.active), info.svg);
      S.editor = null;
      close();
    }

    /* ---------------------------------------------------------------- held saves */

    /* What ink handed over becomes one step now: the label says what the
     * step is (the first stroke makes the board or the node's drawing). */
    function commitPending() {
      clearTimeout(S.timer);
      S.timer = 0;
      S.chain = S.chain.then(async function () {
        if (!S.pending.size || !S.book) return true;
        var held = S.pending;
        S.pending = new Map();
        S.pendingSince = 0;
        var texts = {};
        held.forEach(function (svg, key) {
          var i = keyIndex(key);
          if (i >= 0) texts[i] = svg;
        });
        if (!Object.keys(texts).length) return true;
        var label = S.book.fresh ? (kind === 'board' ? 'notebook.label.newBoard' : 'notebook.label.newDrawing') : 'notebook.label.draw';
        S.applying++;
        var out;
        try {
          out = await apply(S.book, label, { texts: texts, kind: kind, mapId: opts.mapId, owner: owner, slug: newSlug(), image: fileImage(meta()) });
          if (out) adopt(out, texts);
        } finally {
          S.applying--;
        }
        if (!out) {
          offerDownload(held);
          return false;
        }
        afterApply();
        return true;
      });
      return S.chain;
    }

    /* The name a new book gets: '<map>-board' for the board, the node's
     * name for a node drawing. */
    function newSlug() {
      if (kind === 'board') {
        var m = opts.mapId ? store().map(pid, opts.mapId) : null;
        return (slug(m ? m.name : '') || 'map') + BOARD_SUFFIX;
      }
      var mp = opts.mapId ? store().map(pid, opts.mapId) : null;
      if (mp && owner) {
        try {
          var state = doc().parse(mp.text);
          var node = findNode(state, owner.path, owner.key);
          if (node !== null) return slug(doc().labelOf(state.byPath[node])) || t('notebook.slug');
        } catch (err) { /* below */ }
      }
      return t('notebook.slug');
    }

    /* The book as apply() left it becomes the view's: texts of the pages
     * written are what the files now say. */
    function adopt(out, texts) {
      var oldKeys = S.book.pages.map(function (p, i) { return pageKey(i); });
      var next = {};
      out.pages.forEach(function (p, i) {
        var was = oldKeys[i];
        var tx = texts && texts[i] != null ? texts[i] : (S.texts[was] != null ? S.texts[was] : '');
        next[p.file || '#' + i] = tx;
        if (p.asset && tx) textCache.set(p.asset, tx);
      });
      /* The live page's key may have changed (a fresh page got its file). */
      var liveWas = oldKeys[S.active];
      remapPending(oldKeys, out, null);
      remapCams(oldKeys, out, null);
      S.book = out;
      S.texts = next;
      S.sig = storeSig();
      if (!out.fresh) heldBooks.delete(heldKey);
      remember(out.ref);
      var liveNow = pageKey(S.active);
      if (liveWas !== liveNow) renameLive(liveWas, liveNow);
      /* Born or moved into a folder: remembered under it from now on. */
      rememberSoon();
      emit('notebook', { projectId: pid, ref: out.ref, kind: kind });
    }

    /* The editor names pages by key; a page whose key changed under it (it
     * got its file) is the same page: the editor is told its new name by
     * turning to it with its own text, which keeps its undo. */
    function renameLive(from, to) {
      var ed = S.editor;
      if (!ed || ed.pageId() !== from) return;
      ed.setPageId(to);
    }

    /* Saves held under a page's old name (it got its file, or moved) follow
     * it to its new one. */
    function remapPending(oldKeys, out, sources) {
      if (!S.pending.size) return;
      var to = {};
      out.pages.forEach(function (p, i) {
        var src = sources ? sources[i] : i;
        if (src != null && oldKeys[src] != null) to[oldKeys[src]] = p.file || '#' + i;
      });
      var next = new Map();
      S.pending.forEach(function (svg, key) { next.set(to[key] != null ? to[key] : key, svg); });
      S.pending = next;
    }

    /* A store change heard while our own write was in flight is looked at
     * again once the view knows what it wrote. */
    function afterApply() {
      if (S.storeMissed && !S.applying) {
        S.storeMissed = false;
        onStore();
      }
    }

    /* What could not be written, offered as a file: the page the write
     * was for (the first held), or with `latest` the page held last (the
     * newest strokes). Named after the notebook and the page, so a person
     * keeping several knows which is which. */
    function offerDownload(held, latest) {
      var svg = null;
      var key = null;
      held.forEach(function (v, k) { if (!svg || latest) { svg = v; key = k; } });
      if (!svg) return;
      var b = S.book;
      var base = b && b.folder ? baseName(b.folder).replace(/\.book$/i, '') : (b && b.lone ? baseName(b.lone).replace(DRAWING_RE, '') : '');
      var page = PAGE_RE.test(String(key || '')) ? String(key) : 'page.ink.svg';
      var name = base ? base + '-' + page : page;
      toast(t('notebook.notKept'), {
        kind: 'error', duration: Infinity,
        action: { label: t('notebook.download'), run: function () { if (ns.util) ns.util.download(new Blob([svg], { type: 'image/svg+xml' }), name); } }
      });
    }

    /* Everything held, written now; with the write passed to waitUntil. */
    function flush(waitUntil) {
      if (S.editor && !S.readOnly) {
        try { S.editor.save(); } catch (err) { warn('saving the page', err); }
      }
      var job = commitPending();
      if (typeof waitUntil === 'function') waitUntil(job);
      return job;
    }

    /* ---------------------------------------------------------------- following the store */

    var reloading = null;

    function onStore(change) {
      if (S.closed) return;
      if (S.editor) S.editor.refreshHistory();
      if (writing || !S.book) return;
      if (S.applying) { S.storeMissed = true; return; }
      if (!project(pid)) { close(); return; }
      var sig = storeSig();
      if (sig === S.sig) return;
      /* Not the history but another hand moved the files under strokes not
       * written yet (in use a press outside writes them first, so this is
       * a script or a module acting alone): they are not the project's any
       * more, and not lost either - offered as a download. */
      if (change && change.type !== 'history') keepHeldAside();
      if (reloading) { reloading.again = true; return; }
      reload();
    }

    function keepHeldAside() {
      if (S.readOnly) return;
      if (S.editor && S.editor.isDirty()) {
        try { S.editor.save(); } catch (err) { warn('saving the page', err); }
      }
      if (!S.pending.size) return;
      var held = S.pending;
      S.pending = new Map();
      S.pendingSince = 0;
      clearTimeout(S.timer);
      offerDownload(held, true);
    }

    /* The files moved under the notebook (an undo, a redo, a restore from
     * the trash): it shows what they say now. Saves still held were newer
     * than the step the history moved past and go with it (a press outside
     * the notebook has already written them; this only meets an undo in
     * the same instant as a stroke). */
    function reload() {
      var job = reloading = { again: false };
      clearTimeout(S.timer);
      S.pending = new Map();
      S.pendingSince = 0;
      var wasMode = S.book ? meta().mode : null;
      var wasSize = S.book ? JSON.stringify(meta().size) : null;
      var wasLook = S.book ? JSON.stringify([meta().paper, meta().background, meta().looks || null, S.imageKey]) : null;
      var at = S.active;
      var atKey = S.book ? pageKey(S.active) : null;
      var cam = S.editor ? S.editor.camera() : null;
      if (cam && S.book && !isPages()) S.cams[atKey] = cam;
      return load(currentRef(), true).then(function () {
        if (S.closed) return;
        reloading = null;
        S.active = clamp(at, 0, count() - 1);
        /* The canvas shown stays the one shown when the history only
         * added, took or moved others. */
        if (!isPages() && atKey != null && keyIndex(atKey) >= 0) S.active = keyIndex(atKey);
        var modeChanged = wasMode !== meta().mode || wasSize !== JSON.stringify(meta().size);
        if (modeChanged || !S.editor) {
          if (modeChanged) S.cam = null;
          buildEditor();
        } else {
          if (wasLook !== JSON.stringify([meta().paper, meta().background, meta().looks || null, S.imageKey])) S.editor.setLook(look());
          var liveWas = S.editor.pageId();
          S.switching = true;
          try { S.editor.setPage({ id: pageKey(S.active), svgText: textOf(S.active), page: isPages() ? size() : null, look: look() }); } finally { S.switching = false; }
          if (isPages()) {
            S.editor.setCamera(inkCam(S.cam || fitCam(S.active)));
            dropAllUrls();
            layoutDesk(true);
          } else if (liveWas !== pageKey(S.active)) placeCanvas();
          else if (cam) {
            S.switching = true;
            try { S.editor.setCamera(cam); } finally { S.switching = false; }
          }
        }
        if (!isPages()) dropAllUrls();
        paintRail();
        refreshSheets();
        rememberSoon();
        if (job.again) onStore();
      }, function (err) {
        reloading = null;
        warn('reloading the notebook', err);
      });
    }

    /* ---------------------------------------------------------------- pages mode: camera */

    function insetsNow() {
      var compact = S.editor && S.editor.layout && S.editor.layout() === 'compact';
      return { top: compact ? TOP_COMPACT : TOP_WIDE, bottom: compact ? BOTTOM_COMPACT : BOTTOM_WIDE };
    }

    /* The editor's box. The editor hands it over with every camera change
     * (read once per resize, never in the middle of a hand's move); asked
     * outside of that, it is measured. */
    var lastRect = null;
    function viewRect(fresh) {
      if (lastRect && !fresh) return lastRect;
      var r = S.editor ? S.editor.rect() : inkHost.getBoundingClientRect();
      lastRect = { width: r.width || inkHost.clientWidth || 800, height: r.height || inkHost.clientHeight || 600 };
      return lastRect;
    }

    function noteRect(r) {
      if (r && r.width > 0 && r.height > 0) lastRect = { width: r.width, height: r.height };
    }

    function fitK(W) {
      var s = size();
      return clamp((W - 2 * SIDE - RAIL_ROOM) / s.w, 0.05, FIT_MAX);
    }

    /* The column fitted to the width, with page i at the top. */
    function fitCam(i) {
      var r = viewRect(true);
      var k = fitK(r.width);
      var ins = insetsNow();
      return clampCol({ x: (r.width - size().w * k) / 2, y: ins.top - pageTop(i) * k, k: k }, r);
    }

    function inkCam(c) { return { x: c.x, y: c.y + pageTop(S.active) * c.k, k: c.k }; }
    function colCam(c) { return { x: c.x, y: c.y - pageTop(S.active) * c.k, k: c.k }; }

    /* The column stays on the desk: centred while narrower than the view,
     * never scrolled past its first page or its last, and zoomed between a
     * third of the fitted width (an overview of pages) and 800%. */
    function clampCol(c, r) {
      var W = r.width;
      var H = r.height;
      var s = size();
      var kFit = fitK(W);
      var k = clamp(c.k, Math.max(0.05, kFit / 3), ZOOM_MAX);
      var x = c.x;
      var y = c.y;
      var cw = s.w * k;
      if (cw + 2 * SIDE + RAIL_ROOM <= W) x = (W - cw) / 2;
      else x = clamp(x, W - cw - SIDE - RAIL_ROOM, SIDE);
      var ins = insetsNow();
      var ch = columnHeight() * k;
      var minY = H - ins.bottom - ch;
      var maxY = ins.top;
      y = minY > maxY ? maxY : clamp(y, minY, maxY);
      return { x: x, y: y, k: k };
    }

    /* The editor's camera kept on the desk. A column fitted to the width
     * stays fitted when the width changes (a window resized, a tablet
     * turned, the sidebar opened), the page at the top kept in place. */
    function clampCamera(cam, r) {
      if (!S.book || !isPages()) return cam;
      var was = lastRect;
      noteRect(r);
      var box = lastRect || viewRect(true);
      var c = colCam(cam);
      if (was && box.width !== was.width && Math.abs(c.k - fitK(was.width)) < 0.002) {
        var k = fitK(box.width);
        var top = insetsNow().top;
        c = { x: c.x, y: top - (top - c.y) * k / c.k, k: k };
      }
      return inkCam(clampCol(c, box));
    }

    var idleTimer = 0;

    function onCamera(cam, r) {
      if (!S.book) return;
      if (!isPages()) {
        onCanvasCamera(cam);
        return;
      }
      noteRect(r);
      S.cam = colCam(cam);
      layoutDesk(false);
      paintRail();
      showBubble();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { if (!S.closed) layoutDesk(true); }, 140);
    }

    /* A press off the live page: on another page, the editor turns to it
     * (its saves first, so the page left is handed over). */
    function onOutside(p) {
      if (!S.book || !isPages() || S.readOnly) return false;
      var y = p[1] + pageTop(S.active);
      var x = p[0];
      var s = size();
      if (x < 0 || x > s.w) return false;
      var i = Math.floor(y / (s.h + GAP));
      if (i < 0 || i >= count() || i === S.active) return false;
      if (y - pageTop(i) > s.h) return false;
      return turnTo(i);
    }

    function turnTo(i) {
      var ed = S.editor;
      if (!ed || i === S.active) return false;
      var col = S.cam;
      var prev = S.active;
      var ok = ed.setPage({ id: pageKey(i), svgText: textOf(i), page: size() });
      if (!ok) return false;
      S.active = i;
      ed.setCamera(inkCam(col));
      markLive(prev);
      markLive(i);
      /* What the page left held is a step now: turning a page is a pause. */
      commitPending();
      paintRail();
      return true;
    }

    /* ---------------------------------------------------------------- infinite mode: the canvases
     *
     * The pages of an infinite notebook are its canvases, shown one at a
     * time by the one editor (setPage, each keeping its undo while the
     * editor lives). Each canvas keeps its own camera: noted as the person
     * pans and zooms (S.cams, by page key), put back when the canvas is
     * shown again. A camera recalled from memory (another screen, another
     * session) is put back only when it shows some of the drawing; else the
     * drawing is fitted. The
     * canvas shown and the cameras are remembered for the session
     * (canvasMemory) and in the map's view state, so the notebook opens
     * again where it was left. */

    function onCanvasCamera(cam) {
      if (S.switching || !S.editor || isPages()) return;
      var key = pageKey(S.active);
      S.cams[key] = { x: cam.x, y: cam.y, k: cam.k };
      delete S.recalled[key];
      rememberSoon();
    }

    /* Whether a camera shows some of the drawing on the live canvas (an
     * empty canvas: any camera does). */
    function camShowsDrawing(cam) {
      var ed = S.editor;
      var E = ns.ink && ns.ink.engine;
      if (!ed || !E || typeof E.contentBox !== 'function') return true;
      var box = null;
      try { box = E.contentBox(ed.elements(), ed.background()); } catch (err) { box = null; }
      if (!box) return true;
      var r = viewRect(true);
      var x0 = box[0] * cam.k + cam.x;
      var y0 = box[1] * cam.k + cam.y;
      var x1 = box[2] * cam.k + cam.x;
      var y1 = box[3] * cam.k + cam.y;
      return x1 > 0 && y1 > 0 && x0 < r.width && y0 < r.height;
    }

    /* The live canvas under its own camera, or fitted when it has none. */
    function placeCanvas() {
      var ed = S.editor;
      if (!ed || isPages()) return;
      var key = pageKey(S.active);
      var cam = S.cams[key];
      S.switching = true;
      try {
        if (cam && isFinite(cam.k) && cam.k > 0 && (!S.recalled[key] || camShowsDrawing(cam))) ed.setCamera(cam);
        else ed.fit(1);
      } finally { S.switching = false; }
      delete S.recalled[key];
      S.cams[key] = ed.camera();
    }

    /* Canvas i (0-based) in the editor: what the one shown held is handed
     * over first (a switch is a pause, like a page turn). */
    function showCanvas(i) {
      var ed = S.editor;
      if (!ed || !S.book || isPages()) return false;
      i = clamp(i | 0, 0, count() - 1);
      if (i === S.active && ed.pageId() === pageKey(i)) return true;
      S.cams[pageKey(S.active)] = ed.camera();
      var ok;
      S.switching = true;
      try { ok = ed.setPage({ id: pageKey(i), svgText: textOf(i), page: null, look: look(i) }); } finally { S.switching = false; }
      if (!ok) return false;
      S.active = i;
      placeCanvas();
      commitPending();
      paintRail();
      if (thumbs) renderThumbs(false);
      say(tw('notebook.pageOf', { n: i + 1, count: count() }));
      rememberSoon();
      return true;
    }

    /* Who the notebook is, to remember its canvases by: its folder or lone
     * file; a notebook not drawn on yet only for the session, by view. */
    function bookId() {
      var b = S.book;
      if (!b) return null;
      if (b.folder) return b.folder;
      if (b.lone) return b.lone;
      return null;
    }

    function memoryKey() {
      var id = bookId();
      return pid + '\u0000' + (id || 'held\u0000' + heldKey);
    }

    /* The canvas shown and the cameras, as they are now. */
    function canvasState() {
      var cams = {};
      S.book.pages.forEach(function (p, i) {
        var c = S.cams[pageKey(i)];
        if (!p.file || !c || !isFinite(c.x) || !isFinite(c.y) || !(c.k > 0)) return;
        cams[p.file] = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, k: Math.round(c.k * 10000) / 10000 };
      });
      var at = S.book.pages[S.active] ? S.book.pages[S.active].file : null;
      return { at: at || null, cams: cams };
    }

    /* Read back as the notebook opens: from this session if it was open
     * before, else from the map's view state. */
    function recallCanvases() {
      if (!S.book || isPages()) return;
      var got = canvasMemory.get(memoryKey()) || null;
      var id = bookId();
      if (!got && id && opts.mapId) {
        try {
          var books = store().mapView(pid, opts.mapId).notebooks;
          got = books && books[id] ? books[id] : null;
        } catch (err) { got = null; }
      }
      if (!got) return;
      S.cams = {};
      S.recalled = {};
      Object.keys(got.cams || {}).forEach(function (file) {
        var c = got.cams[file];
        if (!c || !isFinite(c.x) || !isFinite(c.y) || !(c.k > 0)) return;
        S.cams[file] = { x: c.x, y: c.y, k: c.k };
        S.recalled[file] = true;
      });
      var at = got.at ? keyIndex(got.at) : -1;
      if (at >= 0) S.active = at;
    }

    /* Noted for the session at once; written into the map's view state a
     * moment after the camera rests (and when the notebook closes). */
    function rememberSoon() {
      if (!S.book || isPages() || S.closed) return;
      var key = memoryKey();
      canvasMemory.delete(key);
      canvasMemory.set(key, canvasState());
      if (canvasMemory.size > CANVAS_MEMORY_MAX) canvasMemory.delete(canvasMemory.keys().next().value);
      clearTimeout(S.memTimer);
      S.memTimer = setTimeout(function () { S.memTimer = 0; rememberNow(); }, REMEMBER_MS);
    }

    function rememberNow() {
      clearTimeout(S.memTimer);
      S.memTimer = 0;
      var id = bookId();
      if (!S.book || isPages() || !id || !opts.mapId) return;
      var st = store();
      if (!st || typeof st.setMapView !== 'function' || !st.map(pid, opts.mapId)) return;
      try {
        var books = Object.assign({}, st.mapView(pid, opts.mapId).notebooks || {});
        delete books[id];
        books[id] = canvasState();
        /* The notebooks looked at last are kept (the store keeps a few). */
        var keys = Object.keys(books);
        while (keys.length > 30) delete books[keys.shift()];
        st.setMapView(pid, opts.mapId, { notebooks: books });
      } catch (err) { warn('remembering the canvases', err); }
    }

    /* Cameras noted under a page's old name (it got its file, or a copy
     * of it was made) follow it to its new one. */
    function remapCams(oldKeys, out, sources) {
      var next = {};
      var recalled = {};
      out.pages.forEach(function (p, i) {
        var src = sources ? sources[i] : i;
        var was = src != null ? oldKeys[src] : null;
        if (was == null || !S.cams[was]) return;
        next[p.file || '#' + i] = S.cams[was];
        if (S.recalled[was]) recalled[p.file || '#' + i] = true;
      });
      S.cams = next;
      S.recalled = recalled;
    }

    /* ---------------------------------------------------------------- pages mode: the desk */

    var pageEls = new Map();

    function urlKey(key, i) { return key + '|' + currentTheme() + '|' + JSON.stringify(lookKey(i)); }

    /* What a page's picture depends on besides its file: the paper and
     * background it is drawn on. */
    function lookKey(i) {
      var m = metaFor(meta(), S.book.pages[i] && S.book.pages[i].file);
      return [m.paper, m.background];
    }

    function pageUrl(i) {
      var key = pageKey(i);
      var k = urlKey(key, i);
      if (S.urls.has(k)) return S.urls.get(k);
      var text = textOf(i);
      if (!text) return null;
      var pm = metaFor(meta(), S.book.pages[i] && S.book.pages[i].file);
      if (!isPages()) text = canvasPicture(text, pm, fileImage(pm));
      var url = URL.createObjectURL(new Blob([themed(text, currentTheme(), pm.background)], { type: 'image/svg+xml' }));
      S.urls.set(k, url);
      return url;
    }

    /* A picture of a page that changed: the pictures showing it let go of
     * it first, and its URL is revoked a little later, so no <img> (a
     * thumbnail still loading lazily) ever asks for a revoked one. */
    function dropUrl(key) {
      var gone = [];
      S.urls.forEach(function (url, k) {
        if (k.indexOf(key + '|') === 0) {
          gone.push(url);
          S.urls.delete(k);
        }
      });
      if (!gone.length) return;
      pageEls.forEach(function (rec) {
        if (rec.key !== key) return;
        rec.src = null;
        if (rec.index !== S.active) paintPage(rec);
      });
      if (thumbs) thumbs.tiles.forEach(function (tile) {
        if (tile.key !== key || !tile.img.getAttribute('src')) return;
        var url = pageUrl(tile.index);
        if (url) tile.img.src = url; else tile.img.removeAttribute('src');
      });
      retire(gone);
    }

    function dropAllUrls() {
      var gone = [];
      S.urls.forEach(function (url) { gone.push(url); });
      S.urls.clear();
      pageEls.forEach(function (rec) { rec.el.remove(); });
      pageEls.clear();
      retire(gone);
    }

    function retire(urls) {
      if (!urls.length) return;
      setTimeout(function () { urls.forEach(function (u) { URL.revokeObjectURL(u); }); }, 4000);
    }

    function markLive(i) {
      pageEls.forEach(function (rec) {
        if (rec.index === i) {
          if (i === S.active) rec.el.setAttribute('data-live', '');
          else rec.el.removeAttribute('data-live');
          if (i !== S.active) paintPage(rec);
        }
      });
    }

    function paintPage(rec) {
      var live = rec.index === S.active;
      if (live) {
        if (rec.img.getAttribute('src')) rec.img.removeAttribute('src');
        rec.img.hidden = true;
        return;
      }
      var url = pageUrl(rec.index);
      if (url && rec.src !== url) {
        rec.img.src = url;
        rec.src = url;
      }
      rec.img.hidden = !url;
    }

    /* The pages near the screen, laid out at the scale kr; between two
     * layouts the layer is only moved and scaled (one transform per frame
     * while a hand pans or pinches), and laid out again at the new scale
     * once the camera rests, so the pictures are sharp. */
    function layoutDesk(full) {
      if (!S.book || !isPages() || !S.cam) {
        root.removeAttribute('data-desk');
        return;
      }
      root.setAttribute('data-desk', '');
      var c = S.cam;
      var r = viewRect();
      if (full || !S.kr) S.kr = c.k;
      var kr = S.kr;
      layer.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px) scale(' + (c.k / kr) + ')';
      var s = size();
      var lo = -c.y / c.k - r.height / c.k * NEAR;
      var hi = (-c.y + r.height) / c.k + r.height / c.k * NEAR;
      var keep = Object.create(null);
      for (var i = 0; i < count(); i++) {
        var top = pageTop(i);
        if (top + s.h < lo || top > hi) continue;
        var key = pageKey(i);
        keep[key] = true;
        var rec = pageEls.get(key);
        if (!rec) {
          var el = h('div', { class: 'nb__page' });
          var img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          img.draggable = false;
          img.hidden = true;
          el.appendChild(img);
          layer.appendChild(el);
          rec = { el: el, img: img, key: key, index: i, src: null, laid: '' };
          pageEls.set(key, rec);
        }
        rec.index = i;
        var laid = (top * kr) + ',' + (s.w * kr) + ',' + (s.h * kr);
        if (rec.laid !== laid) {
          rec.el.style.transform = 'translate(0px,' + (top * kr) + 'px)';
          rec.el.style.width = (s.w * kr) + 'px';
          rec.el.style.height = (s.h * kr) + 'px';
          rec.laid = laid;
        }
        if (i === S.active) rec.el.setAttribute('data-live', '');
        else rec.el.removeAttribute('data-live');
        paintPage(rec);
      }
      pageEls.forEach(function (rec, key) {
        if (keep[key]) return;
        rec.el.remove();
        pageEls.delete(key);
      });
    }

    var thumbTimer = 0;
    function paintThumbSoon(key) {
      clearTimeout(thumbTimer);
      thumbTimer = setTimeout(function () {
        if (S.closed) return;
        pageEls.forEach(function (rec) { if (rec.key === key) paintPage(rec); });
        if (thumbs) thumbs.refreshTile(key);
      }, 250);
    }

    /* The page in view: the one under the middle of the screen. */
    function pageInView() {
      if (S.book && !isPages()) return clamp(S.active, 0, count() - 1);
      if (!S.book || !S.cam) return 0;
      var r = viewRect();
      var mid = (r.height / 2 - S.cam.y) / S.cam.k;
      var s = size();
      return clamp(Math.floor((mid + GAP / 2) / (s.h + GAP)), 0, count() - 1);
    }

    /* Page n (0-based) at the top of the view, the zoom kept; in infinite
     * mode canvas n in the editor. */
    function goTo(i) {
      if (!S.book) return false;
      i = clamp(i | 0, 0, count() - 1);
      if (!isPages()) return showCanvas(i);
      if (!S.editor) return false;
      var r = viewRect();
      var ins = insetsNow();
      var c = clampCol({ x: S.cam.x, y: ins.top - pageTop(i) * S.cam.k, k: S.cam.k }, r);
      S.editor.setCamera(inkCam(c));
      S.cam = c;
      layoutDesk(true);
      paintRail();
      return true;
    }

    /* ---------------------------------------------------------------- the rail */

    function buildRail() {
      var el = h('div', { class: 'nb__rail', role: 'scrollbar', tabindex: '0', 'aria-orientation': 'vertical', 'aria-valuemin': '1', 'aria-controls': inkHost.id });
      var track = h('div', { class: 'nb__track' });
      var ticks = h('div', { class: 'nb__ticks', 'aria-hidden': 'true' });
      var thumb = h('div', { class: 'nb__handle', 'aria-hidden': 'true' });
      var bubble = h('button', { type: 'button', class: 'nb__bubble', tabindex: '-1' });
      track.appendChild(ticks);
      track.appendChild(thumb);
      el.appendChild(track);
      el.appendChild(bubble);
      return { el: el, track: track, ticks: ticks, thumb: thumb, bubble: bubble, tickSig: '' };
    }

    var bubbleTimer = 0;

    function showBubble() {
      if (!S.book || rail.el.hidden) return;
      rail.el.setAttribute('data-active', '');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () { rail.el.removeAttribute('data-active'); }, BUBBLE_MS);
    }

    function paintRail() {
      if (S.book && !isPages()) {
        paintCanvasRail();
        return;
      }
      if (!S.book || !S.cam) {
        rail.el.hidden = true;
        return;
      }
      rail.el.hidden = false;
      var n = count();
      var r = viewRect();
      var k = S.cam.k;
      var total = columnHeight() * k;
      var current = pageInView();
      rail.el.setAttribute('aria-label', t('notebook.rail'));
      rail.el.setAttribute('aria-valuemax', String(n));
      rail.el.setAttribute('aria-valuenow', String(current + 1));
      rail.el.setAttribute('aria-valuetext', t('notebook.pageOf', { n: current + 1, count: n }));
      if (rail.tickSig !== 'pages' + n) {
        rail.ticks.textContent = '';
        for (var i = 0; i < n; i++) {
          var tick = h('span', { class: 'nb__tick' });
          tick.style.top = (n > 1 ? (pageTop(i) / columnHeight()) * 100 : 0) + '%';
          rail.ticks.appendChild(tick);
        }
        rail.tickSig = 'pages' + n;
      }
      var view = Math.max(0, r.height);
      var from = clamp(-S.cam.y / Math.max(total, 1), 0, 1);
      var span = clamp(view / Math.max(total, 1), 0.04, 1);
      rail.thumb.style.top = (from * 100) + '%';
      rail.thumb.style.height = (Math.min(span, 1 - from) * 100) + '%';
      rail.bubble.textContent = t('notebook.pageShort', { n: current + 1, count: n });
      rail.bubble.setAttribute('aria-label', t('notebook.pageOf', { n: current + 1, count: n }));
      rail.bubble.style.top = ((from + Math.min(span, 1 - from) / 2) * 100) + '%';
    }

    /* Infinite mode: the rail is the canvases, one equal stretch each, the
     * handle on the one shown. Shown once there are two. */
    function paintCanvasRail() {
      var n = count();
      if (n < 2 || !S.editor) {
        rail.el.hidden = true;
        return;
      }
      rail.el.hidden = false;
      var current = clamp(S.active, 0, n - 1);
      rail.el.setAttribute('aria-label', tw('notebook.rail'));
      rail.el.setAttribute('aria-valuemax', String(n));
      rail.el.setAttribute('aria-valuenow', String(current + 1));
      rail.el.setAttribute('aria-valuetext', tw('notebook.pageOf', { n: current + 1, count: n }));
      if (rail.tickSig !== 'canvases' + n) {
        rail.ticks.textContent = '';
        for (var i = 0; i < n; i++) {
          var tick = h('span', { class: 'nb__tick' });
          tick.style.top = (i / n * 100) + '%';
          rail.ticks.appendChild(tick);
        }
        rail.tickSig = 'canvases' + n;
      }
      rail.thumb.style.top = (current / n * 100) + '%';
      rail.thumb.style.height = (100 / n) + '%';
      rail.bubble.textContent = t('notebook.pageShort', { n: current + 1, count: n });
      rail.bubble.setAttribute('aria-label', tw('notebook.pageOf', { n: current + 1, count: n }));
      rail.bubble.style.top = ((current + 0.5) / n * 100) + '%';
    }

    /* The canvas under a point of the track. */
    function canvasAt(clientY) {
      var tr = rail.track.getBoundingClientRect();
      return clamp(Math.floor((clientY - tr.top) / Math.max(tr.height, 1) * count()), 0, count() - 1);
    }

    /* Infinite mode on the rail: dragging the handle walks the canvases
     * under it, a press on the track shows the canvas there, a swipe along
     * the rail (off the handle) shows the next canvas (down) or the one
     * before (up), and a tap on the handle opens the thumbnails. */
    function canvasRailDown(e) {
      var tr = rail.track.getBoundingClientRect();
      return { id: e.pointerId, y: e.clientY, x: e.clientX, at: Date.now(), moved: false, onHandle: e.target === rail.thumb, h: tr.height, canvas: true };
    }

    function canvasRailMove(drag, e) {
      var dy = e.clientY - drag.y;
      if (Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.onHandle) {
        var i = canvasAt(e.clientY);
        if (i !== S.active) showCanvas(i);
      }
      showBubble();
    }

    function canvasRailUp(drag, e) {
      if (e.type !== 'pointerup') return;
      var dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (drag.onHandle) openThumbs();
        else showCanvas(canvasAt(e.clientY));
      } else if (!drag.onHandle && Math.abs(dy) >= SWIPE_MIN && Math.abs(dy) >= Math.abs(e.clientX - drag.x)) {
        showCanvas(S.active + (dy > 0 ? 1 : -1));
      }
      showBubble();
    }

    /* Dragging the handle scrolls the column; a press on the track jumps
     * there; a tap on the handle (or on the bubble) opens the thumbnails.
     * In infinite mode the same gestures walk the canvases (above). */
    function wireRail() {
      var drag = null;
      rail.track.addEventListener('pointerdown', function (e) {
        if (!S.book || e.button > 0) return;
        if (!isPages()) {
          if (!S.editor) return;
          e.preventDefault();
          e.stopPropagation();
          drag = canvasRailDown(e);
          try { rail.track.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
          showBubble();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        var tr = rail.track.getBoundingClientRect();
        var onHandle = e.target === rail.thumb;
        if (!onHandle) {
          var frac = clamp((e.clientY - tr.top) / Math.max(tr.height, 1), 0, 1);
          var page = clamp(Math.floor(frac * count()), 0, count() - 1);
          goTo(page);
        }
        drag = { id: e.pointerId, y: e.clientY, y0: S.cam.y, h: tr.height, moved: false, onHandle: onHandle };
        try { rail.track.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
        showBubble();
      });
      rail.track.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (drag.canvas) {
          if (!isPages()) canvasRailMove(drag, e);
          return;
        }
        var dy = e.clientY - drag.y;
        if (Math.abs(dy) > 3) drag.moved = true;
        if (!drag.moved) return;
        var total = columnHeight() * S.cam.k;
        var c = clampCol({ x: S.cam.x, y: drag.y0 - dy * total / Math.max(drag.h, 1), k: S.cam.k }, viewRect());
        S.editor.setCamera(inkCam(c));
        showBubble();
      });
      function end(e) {
        if (!drag || e.pointerId !== drag.id) return;
        var was = drag;
        var tap = !drag.moved && drag.onHandle;
        drag = null;
        try { rail.track.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
        if (was.canvas) {
          if (!isPages()) canvasRailUp(was, e);
          return;
        }
        layoutDesk(true);
        if (tap && e.type === 'pointerup') openThumbs();
      }
      rail.track.addEventListener('pointerup', end);
      rail.track.addEventListener('pointercancel', end);
      /* The drag's touch moves are the rail's own: left to the browser, a
       * quick drag reads as a fling (nothing scrolls, touch-action: none)
       * and the next tap on the page, up to half a second later, only
       * stops that fling and never clicks (ink.js says the same of the
       * sheet). */
      rail.track.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
      rail.bubble.addEventListener('click', function () { openThumbs(); });
      rail.el.addEventListener('keydown', function (e) {
        var i = pageInView();
        var to = null;
        if (e.key === 'ArrowDown' || e.key === 'PageDown') to = i + 1;
        else if (e.key === 'ArrowUp' || e.key === 'PageUp') to = i - 1;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = count() - 1;
        else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          openThumbs();
          return;
        } else return;
        e.preventDefault();
        e.stopPropagation();
        goTo(clamp(to, 0, count() - 1));
        showBubble();
      });
      rail.el.addEventListener('pointerenter', showBubble);
    }

    /* ---------------------------------------------------------------- operations on pages and settings */

    function busy() { return !S.book || S.readOnly; }

    /* Writes held strokes first (the step before this one is theirs), then
     * the change. */
    function change(label, build) {
      if (busy()) return Promise.resolve(false);
      if (S.editor) {
        try { S.editor.save(); } catch (err) { warn('saving the page', err); }
      }
      commitPending();
      S.chain = S.chain.then(async function () {
        if (S.closed || !S.book) return false;
        var plan = await build();
        if (!plan) return false;
        if (S.book.fresh && !(plan.files && plan.files.length)) {
          /* Not drawn on yet: held, not written (see holdFresh). */
          var heldOut = holdFresh(plan);
          adoptChange(heldOut, plan.texts || {}, plan);
          return heldOut;
        }
        plan.kind = kind;
        plan.mapId = opts.mapId;
        plan.owner = owner;
        plan.slug = plan.slug || newSlug();
        S.applying++;
        var out;
        try {
          out = await apply(S.book, label, plan);
          if (out) adoptChange(out, plan.texts || {}, plan);
        } finally {
          S.applying--;
        }
        if (!out) {
          toast(t('notebook.notKept'), { kind: 'error' });
          return false;
        }
        afterApply();
        return out;
      });
      return S.chain;
    }

    /* After a change of pages or settings: the view is rebuilt from the
     * new book (the editor only when the mode or size changed). */
    function adoptChange(out, texts, plan) {
      var oldTexts = S.texts;
      var keysBefore = plan.keys || S.book.pages.map(function (p, i) { return pageKey(i); });
      var next = {};
      out.pages.forEach(function (p, i) {
        var src = plan.sources ? plan.sources[i] : i;
        var tx = texts[i] != null ? texts[i] : (src != null && keysBefore[src] != null ? oldTexts[keysBefore[src]] : '');
        next[p.file || '#' + i] = tx != null ? tx : '';
        if (p.asset && tx) textCache.set(p.asset, tx);
      });
      var wasMode = meta().mode;
      var wasSize = JSON.stringify(meta().size);
      remapPending(keysBefore, out, plan.sources || null);
      if (S.editor && !isPages()) S.cams[S.editor.pageId()] = S.editor.camera();
      remapCams(keysBefore, out, plan.sources || null);
      /* The page live in the editor keeps its undo under its new name. */
      if (S.editor) {
        var liveKey = S.editor.pageId();
        var was = keysBefore.indexOf(liveKey);
        var now = was < 0 ? -1 : (plan.sources ? plan.sources.indexOf(was) : was);
        if (now >= 0 && out.pages[now]) S.editor.setPageId(out.pages[now].file || '#' + now);
      }
      var liveAfter = S.editor ? S.editor.pageId() : null;
      S.book = out;
      S.texts = next;
      S.sig = storeSig();
      remember(out.ref);
      if (plan.active != null) S.active = clamp(plan.active, 0, count() - 1);
      else S.active = clamp(S.active, 0, count() - 1);
      /* In infinite mode a canvas added or copied is the one shown. */
      if (!isPages() && plan.show != null && !plan.rebuild) S.active = clamp(plan.show, 0, count() - 1);
      loadBackground().then(function () {
        if (S.closed) return;
        S.sig = storeSig();
        dropAllUrls();
        if (wasMode !== meta().mode || wasSize !== JSON.stringify(meta().size) || plan.rebuild) {
          S.cam = null;
          if (isPages() && plan.goTo != null) S.cam = fitCam(plan.goTo);
          buildEditor();
        } else {
          S.editor.setLook(look());
          /* Only the paper or the background changed: the page under the
           * pen keeps its scene and its undo (the editor writes the new
           * paper with its next save). */
          if (!plan.lookOnly) {
            S.switching = true;
            try { S.editor.setPage({ id: pageKey(S.active), svgText: textOf(S.active), page: isPages() ? size() : null, look: look() }); } finally { S.switching = false; }
            if (!isPages() && liveAfter !== pageKey(S.active)) placeCanvas();
          }
          if (isPages()) {
            if (plan.goTo != null) S.cam = clampCol({ x: S.cam.x, y: insetsNow().top - pageTop(plan.goTo) * S.cam.k, k: S.cam.k }, viewRect());
            S.editor.setCamera(inkCam(S.cam));
            layoutDesk(true);
          }
        }
        paintRail();
        refreshSheets();
        rememberSoon();
        if (!out.held) emit('notebook', { projectId: pid, ref: out.ref, kind: kind });
      });
    }

    /* Every page drawn again on new settings (paper, size, background),
     * the live page from the editor's own scene; shifts[i] moves page i. */
    function liveText(i) { return i === S.active && S.editor ? S.editor.svg() : textOf(i); }

    async function redrawAll(nextMeta, image, shifts) {
      var texts = {};
      var asPage = nextMeta.mode === 'pages';
      for (var i = 0; i < count(); i++) {
        /* A canvas with a paper of its own keeps it. */
        var own = metaFor(nextMeta, S.book.pages[i].file);
        texts[i] = redraw(liveText(i), own, own.paper.type === 'image' ? image : null, asPage, shifts && shifts[i] ? shifts[i] : null);
      }
      return texts;
    }

    function setSetting(patch) {
      return change('notebook.label.settings', async function () {
        var cur = meta();
        var next = normalize(Object.assign({}, cur, patch));
        if (JSON.stringify(next) === JSON.stringify(cur) && S.book.hasJson) return null;
        var shift = null;
        if (patch.mode === 'pages' && cur.mode !== 'pages') {
          /* The drawing of a canvas put on a page starts at the page's
           * margin when it lay outside it. */
          var s = pagePx(next);
          shift = {};
          for (var i = 0; i < count(); i++) {
            var box = sceneBox(liveText(i));
            if (box && (box[0] < 0 || box[1] < 0 || box[2] > s.w || box[3] > s.h)) shift[i] = [24 - box[0], 24 - box[1]];
          }
        }
        var lookOnly = next.mode === cur.mode && JSON.stringify(next.size) === JSON.stringify(cur.size);
        return {
          meta: next,
          texts: await redrawAll(next, fileImage(next), shift),
          lookOnly: lookOnly,
          rebuild: patch.mode != null && patch.mode !== cur.mode,
          active: patch.mode != null ? 0 : S.active,
          goTo: patch.mode === 'pages' ? 0 : null
        };
      });
    }

    /* A canvas's own paper and background (infinite mode): patch {paper},
     * {background}, or {reset: true} to go back to the notebook's. Only that
     * canvas is drawn again. */
    function setCanvasLook(i, patch) {
      return change('notebook.label.canvasLook', async function () {
        var cur = meta();
        var file = S.book.pages[i] ? S.book.pages[i].file : null;
        if (!file || cur.mode === 'pages') return null;
        var looks = Object.assign({}, cur.looks || {});
        if (patch.reset) delete looks[file];
        else {
          var own = Object.assign({}, looks[file] || {});
          if (patch.paper) own.paper = patch.paper;
          if (patch.background) own.background = patch.background;
          looks[file] = own;
        }
        var next = normalize(Object.assign({}, cur, { looks: Object.keys(looks).length ? looks : undefined }));
        if (!next.looks) delete next.looks;
        if (JSON.stringify(next) === JSON.stringify(cur) && S.book.hasJson) return null;
        var mine = metaFor(next, file);
        var texts = {};
        texts[i] = redraw(liveText(i), mine, mine.paper.type === 'image' ? fileImage(next) : null, false, null);
        return { meta: next, texts: texts, lookOnly: true, rebuild: false, active: S.active };
      });
    }

    async function importPicture() {
      if (busy() || !paperMod() || typeof paperMod().importBackground !== 'function') return false;
      var files = ns.util && ns.util.pickFiles ? await ns.util.pickFiles({ accept: '.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg' }) : [];
      if (!files || !files.length) return false;
      var got;
      try { got = await paperMod().importBackground(files[0]); } catch (err) {
        toast(err && err.message ? err.message : t('notebook.export.failed'), { kind: 'error' });
        return false;
      }
      var href = await bytesUrl(got.bytes, got.type);
      var light = await fileCopy(href, got.w, got.h);
      var image = light ? { href: light, w: got.w, h: got.h } : null;
      var ok = await change('notebook.label.background', async function () {
        var next = normalize(Object.assign({}, meta(), { paper: { type: 'image' }, backgroundImage: { file: got.name, w: got.w, h: got.h } }));
        var old = meta().backgroundImage;
        return {
          meta: next,
          files: [{ name: got.name, data: got.bytes, type: got.type }],
          texts: await redrawAll(next, image, null),
          image: image,
          trash: old && old.file !== got.name && S.book.folder ? [{ path: S.book.folder + '/' + old.file, owner: title() }] : null
        };
      });
      if (ok) toast(t('notebook.imported'));
      return !!ok;
    }

    function bytesUrl(bytes, type) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
        r.readAsDataURL(new Blob([bytes], { type: type }));
      });
    }

    function addPage(after) {
      var at = after == null ? count() : clamp(after + 1, 0, count());
      return change(word('notebook.label.addPage'), async function () {
        var names = S.book.pages.map(function (p) { return p.file; });
        if (S.book.folder) names = names.concat(Object.keys(folderFiles(pid, S.book.folder)), trashedNames(pid, S.book.folder));
        var name = pageName(nextPageNumber(names.filter(function (n) { return PAGE_RE.test(n || ''); })));
        var pages = S.book.pages.slice();
        pages.splice(at, 0, { file: name, path: null, asset: null });
        var keys = S.book.pages.map(function (p, i) { return pageKey(i); });
        var sources = pages.map(function (p, i) { return i < at ? i : (i === at ? null : i - 1); });
        var texts = {};
        texts[at] = blankPage(meta(), fileImage(meta()));
        return { pages: pages, texts: texts, folder: true, meta: meta(), keys: keys, sources: sources, active: S.active >= at ? S.active + 1 : S.active, goTo: at, show: at, announce: at };
      }).then(function (out) {
        if (out) say(tw('notebook.pageAdded', { n: at + 1 }));
        return out;
      });
    }

    function duplicatePage(i) {
      return change(word('notebook.label.duplicatePage'), async function () {
        var names = S.book.pages.map(function (p) { return p.file; });
        if (S.book.folder) names = names.concat(Object.keys(folderFiles(pid, S.book.folder)), trashedNames(pid, S.book.folder));
        var name = pageName(nextPageNumber(names.filter(function (n) { return PAGE_RE.test(n || ''); })));
        var pages = S.book.pages.slice();
        pages.splice(i + 1, 0, { file: name, path: null, asset: null });
        var keys = S.book.pages.map(function (p, j) { return pageKey(j); });
        var sources = pages.map(function (p, j) { return j <= i ? j : (j === i + 1 ? i : j - 1); });
        var texts = {};
        var src = i === S.active && S.editor ? S.editor.svg() : textOf(i);
        texts[i + 1] = src || blankPage(meta(), null);
        if (S.book.lone && !S.book.folder) texts[i] = src;
        /* The copy keeps the canvas's own paper. */
        var nm = meta();
        var from = S.book.pages[i].file;
        if (nm.looks && nm.looks[from]) {
          var copied = Object.assign({}, nm.looks);
          copied[name] = nm.looks[from];
          nm = Object.assign({}, nm, { looks: copied });
        }
        return { pages: pages, texts: texts, folder: true, meta: nm, keys: keys, sources: sources, active: S.active > i ? S.active + 1 : S.active, goTo: i + 1, show: i + 1 };
      });
    }

    function deletePage(i) {
      if (count() <= 1) {
        toast(tw('notebook.lastPage'));
        return Promise.resolve(false);
      }
      var n = i + 1;
      var words = { owner: word('notebook.trashOwner'), removed: word('notebook.pageRemoved'), trashed: word('notebook.pageTrashed') };
      return change(word('notebook.label.deletePage'), async function () {
        var gone = S.book.pages[i];
        var pages = S.book.pages.slice();
        pages.splice(i, 1);
        var keys = S.book.pages.map(function (p, j) { return pageKey(j); });
        var sources = pages.map(function (p, j) { return j < i ? j : j + 1; });
        var next = normalize(meta());
        if (gone.path) next.trashed = (meta().trashed || []).concat([{ file: gone.file, at: i }]);
        var texts = {};
        if (S.book.lone && !S.book.folder) texts[0] = textOf(sources[0]);
        return {
          pages: pages, folder: true, meta: next, keys: keys, sources: sources, texts: texts,
          trash: gone.path ? [{ path: gone.path, owner: t(words.owner, { name: title(), n: n }) }] : null,
          active: S.active > i ? S.active - 1 : (S.active === i ? clamp(i, 0, pages.length - 1) : S.active),
          goTo: clamp(i, 0, pages.length - 1)
        };
      }).then(function (out) {
        if (out && out.held) say(t(words.removed, { n: n }));
        else if (out) {
          var st = store();
          var id = st && st.historyState ? st.historyState().undoId : null;
          if (ns.ui && typeof ns.ui.toastUndo === 'function' && id != null) ns.ui.toastUndo(t(words.trashed, { n: n }), id);
          else toast(t(words.trashed, { n: n }));
        }
        return out;
      });
    }

    function movePage(from, to) {
      to = clamp(to, 0, count() - 1);
      if (from === to) return Promise.resolve(false);
      var movedWord = word('notebook.pageMoved');
      return change(word('notebook.label.movePage'), async function () {
        var pages = S.book.pages.slice();
        var moved = pages.splice(from, 1)[0];
        pages.splice(to, 0, moved);
        var keys = S.book.pages.map(function (p, j) { return pageKey(j); });
        var order = S.book.pages.map(function (p, j) { return j; });
        var o = order.splice(from, 1)[0];
        order.splice(to, 0, o);
        var activeKey = pageKey(S.active);
        var texts = {};
        /* A lone page joined by others moves into a folder as it is. */
        return {
          pages: pages, folder: true, meta: meta(), keys: keys, sources: order, texts: texts,
          active: Math.max(0, order.indexOf(keys.indexOf(activeKey))), goTo: to
        };
      }).then(function (out) {
        if (out) say(t(movedWord, { n: to + 1 }));
        return out;
      });
    }

    /* ---------------------------------------------------------------- announcements */

    var live = h('p', { class: 'nb__sr', role: 'status', 'aria-live': 'polite' });
    root.appendChild(live);

    function say(text) {
      if (live.textContent === text) live.textContent = '';
      live.textContent = text;
    }

    /* ---------------------------------------------------------------- thumbnails */

    var thumbs = null;

    function openThumbs() {
      if (!S.book || thumbs || !ns.ui || typeof ns.ui.sheet !== 'function') return;
      var body = h('div', { class: 'nb-thumbs', 'data-mode': meta().mode });
      var head = h('div', { class: 'nb-thumbs__bar' });
      var add = ns.ui.button({ label: tw('notebook.addPage'), icon: 'plus', kind: 'text', onClick: function () { addPage(pageInView()); } });
      add.disabled = S.readOnly;
      head.appendChild(add);
      var hint = h('p', { class: 'nb-thumbs__hint', text: tw('notebook.thumbsHint') });
      var grid = h('div', { class: 'nb-thumbs__grid', role: 'list', 'aria-label': tw('notebook.pages') });
      body.appendChild(head);
      body.appendChild(hint);
      body.appendChild(grid);
      var handle = ns.ui.sheet({
        title: tw('notebook.pages'), body: body, desktop: 'side', cls: 'nb-sheet', detents: ['content', 0.92],
        onClose: function () {
          if (thumbs && thumbs.seen) thumbs.seen.disconnect();
          thumbs = null;
        }
      });
      thumbs = { handle: handle, grid: grid, add: add, tiles: [], seen: null, mode: meta().mode };
      if (window.IntersectionObserver) {
        thumbs.seen = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting || !thumbs) return;
            var img = en.target;
            thumbs.seen.unobserve(img);
            var url = pageUrl(+img.getAttribute('data-index'));
            if (url) img.src = url;
          });
        }, { root: handle.body || null, rootMargin: '200px 0px' });
      }
      thumbs.render = function () { renderThumbs(); };
      thumbs.refreshTile = function (key) {
        thumbs.tiles.forEach(function (tile) {
          if (tile.key !== key || !tile.img.getAttribute('src')) return;
          var url = pageUrl(tile.index);
          if (url) tile.img.src = url;
        });
      };
      renderThumbs(true);
    }

    function renderThumbs(focus) {
      if (!thumbs) return;
      var grid = thumbs.grid;
      if (thumbs.seen) thumbs.seen.disconnect();
      var current = pageInView();
      var had = grid.contains(document.activeElement) ? document.activeElement.getAttribute('data-index') : null;
      grid.textContent = '';
      thumbs.tiles = [];
      thumbs.add.disabled = S.readOnly;
      var s = size();
      /* A canvas has no size of its own: its picture (the drawn area) sits
       * in a landscape frame. */
      var ratio = isPages() ? s.w + ' / ' + s.h : '4 / 3';
      for (var i = 0; i < count(); i++) {
        (function (i) {
          var key = pageKey(i);
          var tile = h('div', { class: 'nb-thumb', role: 'listitem', 'data-index': String(i) });
          var main = h('button', {
            type: 'button', class: 'nb-thumb__page', 'data-index': String(i),
            'aria-current': i === current ? 'page' : null, 'aria-label': tw('notebook.pageOf', { n: i + 1, count: count() }),
            tabindex: i === current ? '0' : '-1'
          });
          main.style.aspectRatio = ratio;
          var img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.setAttribute('data-index', String(i));
          /* A picture is made for a page only once its thumbnail comes into
           * view: a long notebook does not theme every page at once. */
          if (thumbs.seen) thumbs.seen.observe(img);
          else {
            var url = pageUrl(i);
            if (url) img.src = url;
          }
          main.appendChild(img);
          var label = h('span', { class: 'nb-thumb__n', text: String(i + 1), 'aria-hidden': 'true' });
          var more = h('button', { type: 'button', class: 'nb-thumb__more', 'aria-label': tw('notebook.pageMenu', { n: i + 1 }), 'aria-haspopup': 'menu', tabindex: '-1' });
          more.appendChild(icon('more'));
          more.hidden = S.readOnly;
          main.addEventListener('click', function () {
            if (main.__dragged) { main.__dragged = false; return; }
            goTo(i);
            if (thumbs) thumbs.handle.close('pick');
          });
          more.addEventListener('click', function (e) { e.stopPropagation(); pageMenu(more, i); });
          main.addEventListener('keydown', function (e) { thumbKey(e, i); });
          tile.appendChild(main);
          tile.appendChild(label);
          tile.appendChild(more);
          grid.appendChild(tile);
          wireDrag(main, tile, i);
          thumbs.tiles.push({ key: key, index: i, img: img, el: tile, main: main });
        })(i);
      }
      var target = had != null ? grid.querySelector('.nb-thumb__page[data-index="' + clamp(+had, 0, count() - 1) + '"]') : null;
      if (focus && !target) target = grid.querySelector('.nb-thumb__page[tabindex="0"]');
      if (target) {
        try { target.focus({ preventScroll: false }); } catch (err) { target.focus(); }
      }
      if (thumbs.handle.refit) thumbs.handle.refit();
    }

    function pageMenu(anchor, i) {
      if (!ns.ui || typeof ns.ui.menu !== 'function') return;
      ns.ui.menu(anchor, [
        { label: tw('notebook.addPage'), icon: 'plus', onSelect: function () { addPage(i); } },
        { label: tw('notebook.duplicatePage'), icon: 'copy', onSelect: function () { duplicatePage(i); } },
        { label: t('notebook.moveEarlier'), icon: 'arrow-up', disabled: i === 0, onSelect: function () { movePage(i, i - 1); } },
        { label: t('notebook.moveLater'), icon: 'arrow-down', disabled: i === count() - 1, onSelect: function () { movePage(i, i + 1); } },
        '-',
        { label: tw('notebook.deletePage'), icon: 'trash', danger: true, disabled: count() <= 1, onSelect: function () { deletePage(i); } }
      ], { align: 'end' });
    }

    /* The grid is one stop for Tab, walked with the arrows; Alt with an
     * arrow moves the page, Delete sends it to the trash, the context key
     * opens its menu. */
    function thumbKey(e, i) {
      var cols = Math.max(1, Math.round(thumbs.grid.clientWidth / Math.max(1, thumbs.tiles[0] ? thumbs.tiles[0].el.offsetWidth : 1)));
      var step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (step && e.altKey && !S.readOnly) {
        e.preventDefault();
        e.stopPropagation();
        movePage(i, i + (step > 0 ? 1 : -1));
        return;
      }
      if (step || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        var to = e.key === 'Home' ? 0 : (e.key === 'End' ? count() - 1 : clamp(i + step, 0, count() - 1));
        var all = thumbs.grid.querySelectorAll('.nb-thumb__page');
        all.forEach(function (b, j) { b.tabIndex = j === to ? 0 : -1; });
        if (all[to]) all[to].focus();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !S.readOnly) {
        e.preventDefault();
        e.stopPropagation();
        deletePage(i);
        return;
      }
      if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && !S.readOnly) {
        e.preventDefault();
        var tile = thumbs.tiles[i];
        if (tile) pageMenu(tile.el.querySelector('.nb-thumb__more'), i);
      }
    }

    /* Drag to reorder: a mouse or a pen picks a page up once it travels a
     * few pixels, a finger after a long press (a quick swipe scrolls the
     * sheet); a ghost follows, a bar shows where it will land. */
    function wireDrag(main, tile, i) {
      var press = null;
      main.addEventListener('pointerdown', function (e) {
        if (S.readOnly || e.button > 0) return;
        press = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, armed: e.pointerType !== 'touch', drag: null, timer: 0 };
        if (e.pointerType === 'touch') {
          press.timer = setTimeout(function () {
            if (!press) return;
            press.armed = true;
            startDrag(e.clientX, e.clientY);
          }, LONG_PRESS);
        }
      });
      main.addEventListener('pointermove', function (e) {
        if (!press || e.pointerId !== press.id) return;
        /* A page picked up is ours: the bottom sheet under it must not take
         * the same finger to move itself. */
        if (press.armed && press.type === 'touch') e.stopPropagation();
        var d = Math.hypot(e.clientX - press.x, e.clientY - press.y);
        if (!press.drag) {
          if (press.type === 'touch' && d > DRAG_SLOP && !press.armed) {
            clearTimeout(press.timer);
            press = null;
            return;
          }
          if (press.armed && d > DRAG_SLOP) startDrag(e.clientX, e.clientY);
          return;
        }
        e.preventDefault();
        moveDrag(e.clientX, e.clientY);
      });
      function end(e) {
        if (!press || e.pointerId !== press.id) return;
        clearTimeout(press.timer);
        var p = press;
        press = null;
        if (!p.drag) return;
        main.__dragged = true;
        setTimeout(function () { main.__dragged = false; }, 0);
        finishDrag(p.drag, e.type === 'pointerup');
      }
      main.addEventListener('pointerup', end);
      main.addEventListener('pointercancel', end);
      main.addEventListener('contextmenu', function (e) { if (press && press.type === 'touch') e.preventDefault(); });
      /* A page picked up by a finger is carried, not scrolled: once the long
       * press has armed it, the sheet's own scroll stays still (the
       * thumbnail lets the sheet scroll vertically otherwise). */
      main.addEventListener('touchmove', function (e) {
        if (press && press.armed && press.type === 'touch' && e.cancelable) e.preventDefault();
      }, { passive: false });

      function startDrag(x, y) {
        if (!press || press.drag) return;
        try { main.setPointerCapture(press.id); } catch (err) { /* gone */ }
        var r = tile.getBoundingClientRect();
        var ghost = tile.cloneNode(true);
        ghost.classList.add('nb-thumb--ghost');
        ghost.style.width = r.width + 'px';
        ghost.style.height = r.height + 'px';
        ghost.setAttribute('aria-hidden', 'true');
        document.body.appendChild(ghost);
        var mark = h('div', { class: 'nb-thumbs__drop', 'aria-hidden': 'true' });
        thumbs.grid.appendChild(mark);
        tile.setAttribute('data-dragging', '');
        press.drag = { ghost: ghost, mark: mark, from: i, to: i, dx: x - r.left, dy: y - r.top };
        moveDrag(x, y);
      }

      function moveDrag(x, y) {
        var d = press.drag;
        d.ghost.style.transform = 'translate(' + (x - d.dx) + 'px,' + (y - d.dy) + 'px)';
        var best = null;
        thumbs.tiles.forEach(function (tl) {
          var r = tl.el.getBoundingClientRect();
          var cx = r.left + r.width / 2;
          var cy = r.top + r.height / 2;
          var dist = Math.hypot(x - cx, y - cy);
          if (!best || dist < best.dist) best = { dist: dist, index: tl.index, after: x > cx, r: r };
        });
        if (!best) return;
        var to = best.index + (best.after ? 1 : 0);
        if (to > d.from) to -= 1;
        d.to = clamp(to, 0, count() - 1);
        var gr = thumbs.grid.getBoundingClientRect();
        var edge = best.after ? best.r.right : best.r.left;
        d.mark.style.transform = 'translate(' + (edge - gr.left - 2 + thumbs.grid.scrollLeft) + 'px,' + (best.r.top - gr.top + thumbs.grid.scrollTop) + 'px)';
        d.mark.style.height = best.r.height + 'px';
        /* Near the edges of the sheet, the sheet scrolls. */
        var scroller = thumbs.handle.body || thumbs.grid;
        var sr = scroller.getBoundingClientRect();
        if (y < sr.top + 40) scroller.scrollTop -= 12;
        else if (y > sr.bottom - 40) scroller.scrollTop += 12;
      }

      function finishDrag(d, drop) {
        d.ghost.remove();
        d.mark.remove();
        tile.removeAttribute('data-dragging');
        if (drop && d.to !== d.from) movePage(d.from, d.to);
      }
    }

    /* ---------------------------------------------------------------- settings */

    var settings = null;

    function openSettings() {
      if (!S.book || settings || !ns.ui || typeof ns.ui.sheet !== 'function') return;
      var body = h('div', { class: 'nb-set' });
      var handle = ns.ui.sheet({
        title: t('notebook.settings'), body: body, desktop: 'side', cls: 'nb-sheet', detents: [0.6, 0.92],
        onClose: function () { settings = null; }
      });
      settings = { handle: handle, body: body, scope: 'book' };
      settings.render = function () { renderSettings(); };
      renderSettings();
    }

    function seg(name, options, value, onPick, disabled) {
      var group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name });
      options.forEach(function (o) {
        var b = h('button', {
          type: 'button', class: 'seg__opt', role: 'radio', 'data-value': o.value,
          'aria-checked': String(o.value === value), tabindex: o.value === value ? '0' : '-1', disabled: disabled ? true : null
        }, h('span', { text: o.label }));
        b.addEventListener('click', function () { if (o.value !== value) onPick(o.value); });
        group.appendChild(b);
      });
      group.addEventListener('keydown', function (e) {
        var step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
        if (!step) return;
        e.preventDefault();
        var all = Array.prototype.slice.call(group.children);
        var at = all.findIndex(function (b) { return b.getAttribute('aria-checked') === 'true'; });
        var next = all[(at + step + all.length) % all.length];
        next.focus();
        next.click();
      });
      return group;
    }

    function section(title, content, note) {
      var sec = h('section', { class: 'nb-set__section' });
      sec.appendChild(h('h3', { class: 'nb-set__title', text: title }));
      if (content) sec.appendChild(content);
      if (note) sec.appendChild(h('p', { class: 'nb-set__note', text: note }));
      return sec;
    }

    var previewCache = new Map();

    /* A small picture of a paper, drawn by ns.paper on the size of the
     * notebook (a portrait A5-like card on the infinite canvas), in the
     * theme and background chosen. */
    function previewUrl(type, shown) {
      var P = paperMod();
      if (!P || typeof P.pageSvg !== 'function') return null;
      var m = shown || meta();
      var sz = m.mode === 'pages' ? pagePx(m) : { w: 148 * P.MM, h: 210 * P.MM };
      var key = type + '|' + currentTheme() + '|' + m.background + '|' + Math.round(sz.w) + 'x' + Math.round(sz.h);
      if (previewCache.has(key)) return previewCache.get(key);
      var url = null;
      try {
        var svg = P.pageSvg({ type: type }, { w: sz.w, h: sz.h, theme: currentTheme(), background: m.background, scale: 0.18 });
        url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      } catch (err) { url = null; }
      previewCache.set(key, url);
      return url;
    }

    function renderSettings() {
      if (!settings) return;
      var body = settings.body;
      var focusKey = body.contains(document.activeElement) ? focusMark(document.activeElement) : null;
      var scroll = settings.handle.body ? settings.handle.body.scrollTop : 0;
      body.textContent = '';
      var m = meta();
      var ro = S.readOnly;
      var P = paperMod();

      body.appendChild(section(t('notebook.mode'), seg(t('notebook.mode'), [
        { value: 'infinite', label: t('notebook.mode.infinite') },
        { value: 'pages', label: t('notebook.mode.pages') }
      ], m.mode, function (v) { setSetting({ mode: v }); }, ro),
      t('notebook.modeNote.' + m.mode) + (count() > 1 ? ' ' + t(m.mode === 'pages' ? 'notebook.moreCanvases' : 'notebook.morePages') : '')));

      if (m.mode === 'pages' && P) {
        var sizeBox = h('div', { class: 'nb-set__size' });
        var select = h('select', { class: 'nb-set__select', 'aria-label': t('notebook.size'), disabled: ro ? true : null });
        P.SIZES.forEach(function (sz) {
          var opt = h('option', { value: sz.id, text: P.sizeLabel(sz.id) + (sz.id !== 'custom' ? ' (' + sz.w + ' × ' + sz.h + ' mm)' : '') });
          if (sz.id === m.size.id) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener('change', function () {
          var known = P.SIZES.filter(function (sz) { return sz.id === select.value; })[0];
          var next = select.value === 'custom' ? { id: 'custom', w: m.size.w, h: m.size.h, orientation: m.size.orientation } : { id: select.value, orientation: known ? known.orientation : m.size.orientation };
          setSetting({ size: next });
        });
        sizeBox.appendChild(select);
        sizeBox.appendChild(seg(t('notebook.orientation'), [
          { value: 'portrait', label: t('paper.portrait') },
          { value: 'landscape', label: t('paper.landscape') }
        ], m.size.orientation, function (v) { setSetting({ size: { id: m.size.id, w: m.size.w, h: m.size.h, orientation: v } }); }, ro));
        if (m.size.id === 'custom') {
          var dims = h('div', { class: 'nb-set__dims' });
          [['w', 'notebook.width'], ['h', 'notebook.height']].forEach(function (pair) {
            var label = h('label', { class: 'nb-set__dim' });
            label.appendChild(h('span', { text: t(pair[1]) }));
            var input = h('input', { type: 'number', min: '20', max: '2000', step: '1', inputmode: 'decimal', value: String(m.size[pair[0]]), disabled: ro ? true : null });
            input.addEventListener('change', function () {
              var v = Number(input.value);
              if (!(v > 0)) return;
              var next = { id: 'custom', w: m.size.w, h: m.size.h, orientation: m.size.orientation };
              next[pair[0]] = v;
              next.orientation = next.w > next.h ? 'landscape' : 'portrait';
              setSetting({ size: next });
            });
            label.appendChild(input);
            dims.appendChild(label);
          });
          sizeBox.appendChild(dims);
        }
        body.appendChild(section(t('notebook.size'), sizeBox));
      }

      /* Infinite mode: the paper and the background below are the notebook's
       * or, picked here, the shown canvas's own. */
      var pick = setSetting;
      if (m.mode !== 'pages') {
        var activeFile = S.book.pages[S.active] ? S.book.pages[S.active].file : null;
        var ownLook = m.looks && activeFile ? m.looks[activeFile] : null;
        var onCanvas = settings.scope === 'canvas';
        var scopeBox = h('div', { class: 'nb-set__scope' });
        scopeBox.appendChild(seg(t('notebook.scope'), [
          { value: 'book', label: t('notebook.scope.book') },
          { value: 'canvas', label: t('notebook.scope.canvas', { n: S.active + 1 }) }
        ], onCanvas ? 'canvas' : 'book', function (v) { settings.scope = v; renderSettings(); }, false));
        if (onCanvas && ownLook && !ro) {
          var back = h('button', { type: 'button', class: 'btn nb-set__reset', text: t('notebook.scope.reset') });
          back.addEventListener('click', function () { setCanvasLook(S.active, { reset: true }); });
          scopeBox.appendChild(back);
        }
        body.appendChild(section(t('notebook.scope'), scopeBox, onCanvas ? t(ownLook ? 'notebook.scope.note' : 'notebook.scope.note.inherit') : null));
        if (onCanvas) {
          m = metaFor(m, activeFile);
          pick = function (patch) { return setCanvasLook(S.active, patch); };
        }
      }
      var forCanvas = pick !== setSetting;

      if (P) {
        var papers = h('div', { class: 'nb-set__papers', role: 'radiogroup', 'aria-label': t('notebook.paper') });
        var psz = m.mode === 'pages' ? pagePx(m) : { w: 148, h: 210 };
        var ratio = Math.round(psz.w) + ' / ' + Math.round(psz.h);
        var current = m.paper.type;
        P.GROUPS.forEach(function (g) {
          var entries = P.CATALOG.filter(function (e) { return e.group === g.id && !(forCanvas && e.id === 'image'); });
          if (!entries.length) return;
          papers.appendChild(h('h4', { class: 'nb-set__group', text: P.groupLabel(g.id) }));
          var row = h('div', { class: 'nb-set__grid' });
          entries.forEach(function (e) {
            var isImage = e.id === 'image';
            var on = current === e.id;
            var b = h('button', {
              type: 'button', class: 'nb-paper', role: 'radio', 'data-value': e.id,
              'aria-checked': String(on), tabindex: on ? '0' : '-1', disabled: ro ? true : null
            });
            var pic = h('span', { class: 'nb-paper__pic', 'aria-hidden': 'true' });
            pic.style.aspectRatio = ratio;
            if (isImage && S.image) pic.style.backgroundImage = 'url("' + (S.image.file || S.image.href).replace(/"/g, '%22') + '")';
            else if (isImage) pic.appendChild(icon('image', 'nb-paper__icon'));
            else {
              var url = previewUrl(e.id, forCanvas ? m : null);
              if (url) pic.style.backgroundImage = 'url("' + url + '")';
            }
            b.appendChild(pic);
            b.appendChild(h('span', { class: 'nb-paper__label', text: isImage ? (m.backgroundImage ? t('notebook.importChange') : t('notebook.import')) : P.label(e.id) }));
            b.addEventListener('click', function () {
              if (isImage) {
                if (m.backgroundImage && !on) pick({ paper: { type: 'image' } });
                else importPicture();
                return;
              }
              if (!on) pick({ paper: { type: e.id } });
            });
            row.appendChild(b);
          });
          papers.appendChild(row);
        });
        papers.addEventListener('keydown', function (e) {
          var step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
          if (!step) return;
          var all = Array.prototype.slice.call(papers.querySelectorAll('.nb-paper'));
          var at = all.indexOf(document.activeElement);
          if (at < 0) return;
          e.preventDefault();
          var next = all[clamp(at + step, 0, all.length - 1)];
          all.forEach(function (b) { b.tabIndex = b === next ? 0 : -1; });
          next.focus();
        });
        body.appendChild(section(t('notebook.paper'), papers, !forCanvas && (current === 'image' || m.backgroundImage) ? t('notebook.importNote') : null));
      }

      var bg = h('div', { class: 'nb-set__bg' });
      var custom = m.background !== 'auto';
      bg.appendChild(seg(t('notebook.background'), [
        { value: 'auto', label: t('notebook.bg.auto') },
        { value: 'colour', label: t('notebook.bg.colour') }
      ], custom ? 'colour' : 'auto', function (v) {
        pick({ background: v === 'auto' ? 'auto' : (custom ? m.background : BACKGROUNDS[1].hex) });
      }, ro));
      if (custom) {
        var swatches = h('div', { class: 'nb-set__swatches', role: 'radiogroup', 'aria-label': t('notebook.bg.colour') });
        var known = false;
        BACKGROUNDS.forEach(function (sw) {
          var on = sw.hex === m.background;
          if (on) known = true;
          var b = h('button', { type: 'button', class: 'nb-swatch', role: 'radio', 'aria-checked': String(on), 'aria-label': t('notebook.bg.' + sw.id), tabindex: on ? '0' : '-1', disabled: ro ? true : null });
          b.style.setProperty('--swatch', sw.hex);
          b.title = t('notebook.bg.' + sw.id);
          b.addEventListener('click', function () { if (!on) pick({ background: sw.hex }); });
          swatches.appendChild(b);
        });
        var other = h('label', { class: 'nb-swatch nb-swatch--other', title: t('notebook.bg.other') });
        other.style.setProperty('--swatch', known ? 'transparent' : m.background);
        if (!known) other.setAttribute('data-on', '');
        var input = h('input', { type: 'color', value: m.background, 'aria-label': t('notebook.bg.other'), disabled: ro ? true : null });
        /* Dragging through the system picker previews on the sheet; the
         * colour settles (one step) when the picker says it changed. */
        input.addEventListener('input', function () {
          if (S.editor && isHex(input.value)) S.editor.setLook(Object.assign(look(), { background: input.value.toLowerCase() }));
        });
        input.addEventListener('change', function () { if (isHex(input.value)) pick({ background: input.value.toLowerCase() }); });
        other.appendChild(input);
        swatches.appendChild(other);
        swatches.addEventListener('keydown', function (e) {
          var step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
          if (!step) return;
          var all = Array.prototype.slice.call(swatches.querySelectorAll('button.nb-swatch'));
          var at = all.indexOf(document.activeElement);
          if (at < 0) return;
          e.preventDefault();
          var next = all[(at + step + all.length) % all.length];
          next.focus();
          next.click();
        });
        bg.appendChild(swatches);
      }
      body.appendChild(section(t('notebook.background'), bg, custom ? null : t('notebook.bg.autoNote')));

      if (focusKey) {
        var again = findMark(body, focusKey);
        if (again) { try { again.focus({ preventScroll: true }); } catch (err) { again.focus(); } }
      }
      if (settings.handle.body) settings.handle.body.scrollTop = scroll;
    }

    /* The control that had the focus, found again after a rebuild. */
    function focusMark(el) {
      var group = el.closest('[role="radiogroup"], select, input');
      return {
        group: group ? (group.getAttribute('aria-label') || group.tagName) : null,
        value: el.getAttribute('data-value') || el.getAttribute('aria-checked') && el.getAttribute('aria-label') || null,
        tag: el.tagName
      };
    }

    function findMark(body, mark) {
      if (!mark) return null;
      if (mark.tag === 'SELECT') return body.querySelector('select');
      if (mark.group) {
        var groups = body.querySelectorAll('[role="radiogroup"]');
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].getAttribute('aria-label') !== mark.group) continue;
          return groups[i].querySelector('[aria-checked="true"]') || groups[i].querySelector('button');
        }
      }
      return null;
    }

    function refreshSheets() {
      if (thumbs) {
        /* Pages became canvases or the other way: the sheet is named for
         * the other, and goes. */
        if (thumbs.mode !== meta().mode) thumbs.handle.close('mode');
        else renderThumbs(false);
      }
      if (settings) renderSettings();
    }

    /* ---------------------------------------------------------------- export */

    /* Pages mode: a PDF of every page, a PNG of the page in view. Infinite
     * mode: a PDF of every canvas (each page cut to its drawn area) and a
     * PNG of the canvas shown - "the drawn area" while there is one. */
    function openExport(anchor) {
      if (!S.book || !ns.ui || typeof ns.ui.menu !== 'function') return;
      var pages = isPages();
      var several = count() > 1;
      var paper = exportPaper();
      ns.ui.menu(anchor, [
        { label: t(pages ? 'notebook.export.pdfAll' : (several ? 'notebook.export.pdfCanvases' : 'notebook.export.pdfArea')), icon: 'export', onSelect: function () { runExport('pdf'); } },
        { label: t(pages ? 'notebook.export.pngPage' : (several ? 'notebook.export.pngCanvas' : 'notebook.export.pngArea')), icon: 'image', onSelect: function () { runExport('png'); } },
        '-',
        { heading: t('notebook.export.paper') },
        { label: t('notebook.export.light'), checked: paper === 'light', onSelect: function () { setExportPaper('light'); } },
        { label: t('notebook.export.dark'), checked: paper === 'dark', onSelect: function () { setExportPaper('dark'); } }
      ], { align: 'end', label: t('notebook.export') });
    }

    /* The book as the files say, with the strokes still held. */
    async function exportBook() {
      if (S.editor && !S.readOnly) {
        try { S.editor.save(); } catch (err) { warn('saving the page', err); }
      }
      var texts = S.book.pages.map(function (p, i) { return textOf(i) || null; });
      if (S.editor) texts[S.active] = S.editor.svg();
      return texts;
    }

    function wholeImage() {
      return S.image && meta().paper.type === 'image' ? { href: S.image.href, w: S.image.w, h: S.image.h } : null;
    }

    async function runExport(format) {
      try {
        var texts = await exportBook();
        var name = slug(title()) || 'notebook';
        /* An infinite notebook with nothing drawn (on the canvas shown, for
         * a PNG; on any, for the PDF) has nothing to export. */
        if (!isPages() && !(format === 'pdf' ? texts.some(hasDrawing) : hasDrawing(texts[pageInView()]))) {
          toast(t('notebook.export.empty'));
          return;
        }
        if (format === 'pdf') {
          await exportPdf(S.book, { theme: exportPaper(), texts: texts, image: wholeImage() });
          toast(t('notebook.export.printing'));
        } else {
          var i = pageInView();
          await exportPng(S.book, i, { theme: exportPaper(), text: texts[i], name: name, image: wholeImage() });
        }
      } catch (err) {
        warn('export', err);
        toast(t('notebook.export.failed'), { kind: 'error' });
      }
    }

    /* ---------------------------------------------------------------- living with the app */

    function onTheme() {
      if (S.closed || !S.editor) return;
      S.editor.setLook(look());
      dropAllUrls();
      layoutDesk(true);
      previewCache.clear();
      refreshSheets();
    }

    function onLang() {
      if (S.closed) return;
      relabelButtons();
      paintRail();
      refreshSheets();
    }

    /* A press or a key outside the notebook: what it holds is written
     * first, so the top bar's Undo takes back the last strokes. */
    function onInteraction(e) {
      if (S.closed || !S.pending.size && !(S.editor && S.editor.isDirty())) return;
      var target = e.target;
      if (target && target.nodeType === 1 && root.contains(target)) return;
      if (S.editor && S.editor.isDirty()) {
        try { S.editor.save(); } catch (err) { warn('saving the page', err); }
      }
      commitPending();
    }

    /* The app hands everything over ('flush': Mod+S, the page hidden or
     * going away; 'tabs:yield'): the canvas shown and the cameras waiting
     * for their moment of rest are written into the map's view state too,
     * at once, so a reload right after a switch or a zoom finds them. */
    function onFlush(d) {
      flush(d && d.waitUntil);
      if (S.memTimer && !S.closed) rememberNow();
    }

    function setReadOnly(on) {
      S.readOnly = !!on;
      if (S.editor) S.editor.setReadOnly(S.readOnly);
      root.toggleAttribute('data-readonly', S.readOnly);
      refreshSheets();
    }

    var offs = [];
    if (ns.bus && typeof ns.bus.on === 'function') {
      offs.push(ns.bus.on('store', onStore));
      offs.push(ns.bus.on('flush', onFlush));
      offs.push(ns.bus.on('tabs:yield', onFlush));
      /* 'theme' comes for a choice in the settings and for the system's
       * own change while following it. */
      offs.push(ns.bus.on('theme', onTheme));
      offs.push(ns.bus.on('lang', onLang));
    }
    document.addEventListener('pointerdown', onInteraction, true);
    document.addEventListener('keydown', onInteraction, true);
    wireRail();

    /* Page Up and Page Down on the sheet turn the pages (the editor keeps
     * every other key); Home and End go to the first and the last. In
     * infinite mode Page Up and Page Down show the canvas before or after
     * (showCanvas says which). */
    root.addEventListener('keydown', function (e) {
      if (!S.editor || e.altKey || e.ctrlKey || e.metaKey) return;
      if (!e.target || !e.target.classList || !e.target.classList.contains('ink')) return;
      var i = pageInView();
      var keys = isPages() ? { PageDown: i + 1, PageUp: i - 1, Home: 0, End: count() - 1 } : { PageDown: i + 1, PageUp: i - 1 };
      var to = keys[e.key];
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      goTo(clamp(to, 0, count() - 1));
      showBubble();
      if (isPages()) say(t('notebook.pageOf', { n: pageInView() + 1, count: count() }));
    }, true);

    /* ---------------------------------------------------------------- an empty notebook
     *
     * A notebook not drawn on yet is not written anywhere: a setting, a
     * page added or moved before the first stroke is held here (and for
     * the next opening of the same drawing, heldBooks) and becomes part of
     * the step the first stroke makes. Only a picture chosen as the paper
     * writes the notebook at once: that is something to show.
     *
     * A notebook that exists but has nothing on any page (every stroke
     * erased, or one written empty by an older version) says so when it
     * closes (onClose {empty: true}); its owner offers to take it away. */

    function holdFresh(plan) {
      var next = normalize(plan.meta || meta());
      var pages = (plan.pages || S.book.pages).map(function (p, i) { return { file: p.file || pageName(i + 1), path: null, asset: null }; });
      next.pages = pages.map(function (p) { return { file: p.file }; });
      delete next.trashed;
      heldBooks.set(heldKey, JSON.parse(JSON.stringify(next)));
      return {
        projectId: pid, ref: null, folder: null, lone: null, fresh: true, held: true,
        meta: next, hasJson: false, unreadable: false, jsonAsset: null, pages: pages, trashed: []
      };
    }

    function takeHeld(book) {
      if (!book || !book.fresh || !heldBooks.has(heldKey)) return book;
      var m = normalize(heldBooks.get(heldKey));
      var pages = (m.pages && m.pages.length ? m.pages : [{ file: pageName(1) }]).map(function (p) { return { file: p.file, path: null, asset: null }; });
      m.pages = pages.map(function (p) { return { file: p.file }; });
      book.meta = m;
      book.pages = pages;
      return book;
    }

    /* Nothing drawn on any page, no picture behind them: an existing
     * notebook that shows only its paper. */
    function blankBook() {
      var b = S.book;
      var ink = ns.ink;
      if (!b || b.fresh || b.unreadable || S.readOnly || !ink || typeof ink.parse !== 'function') return false;
      if (b.meta && b.meta.backgroundImage) return false;
      if (!b.pages.length) return false;
      for (var i = 0; i < b.pages.length; i++) {
        var parsed;
        try { parsed = ink.parse(String(textOf(i) || '')); } catch (err) { return false; }
        if (parsed.kind !== 'ink' || parsed.elements.length || parsed.background) return false;
      }
      return true;
    }

    /* ---------------------------------------------------------------- close */

    /* Closing writes what is held (the last strokes included) and leaves
     * the page. Resolves once written. */
    function close() {
      if (S.closed) return S.closeJob || Promise.resolve(true);
      S.closing = true;
      if (S.editor) {
        /* Strokes the notebook could not take (it turned read-only under
         * them: another tab holds the data) are held all the same, so the
         * write below fails over to the download offer instead of losing
         * them. */
        try {
          var key = pageKey(S.active);
          S.editor.save();
          if (!S.pending.has(key) && S.editor.isDirty() && typeof S.editor.svg === 'function') S.pending.set(key, S.editor.svg());
        } catch (err) { warn('saving the page', err); }
      }
      var job = commitPending();
      if (S.book && !isPages()) {
        if (S.editor) S.cams[pageKey(S.active)] = S.editor.camera();
        rememberSoon();
        rememberNow();
      }
      S.closed = true;
      if (thumbs) thumbs.handle.close('close');
      if (settings) settings.handle.close('close');
      var ed = S.editor;
      S.editor = null;
      if (ed) {
        try { ed.close(); } catch (err) { warn('closing the editor', err); }
      }
      offs.forEach(function (off) { if (typeof off === 'function') off(); });
      document.removeEventListener('pointerdown', onInteraction, true);
      document.removeEventListener('keydown', onInteraction, true);
      clearTimeout(idleTimer);
      clearTimeout(bubbleTimer);
      clearTimeout(thumbTimer);
      clearTimeout(S.memTimer);
      dropAllUrls();
      if (root.parentNode) root.parentNode.removeChild(root);
      var i = views.indexOf(api);
      if (i >= 0) views.splice(i, 1);
      S.closeJob = job.then(function (ok) {
        S.ended = true;
        if (typeof opts.onClose === 'function') {
          try { opts.onClose({ saved: ok !== false, ref: S.book ? S.book.ref : null, empty: ok !== false && blankBook() }); } catch (err) { warn('onClose', err); }
        }
        return ok !== false;
      });
      return S.closeJob;
    }

    var api = {
      el: root,
      close: close,
      /* Done (the viewer's close button): closes once written. */
      done: function () { return close(); },
      flush: function () { return flush(); },
      isDirty: function () { return !S.ended && (S.pending.size > 0 || !!(S.editor && S.editor.isDirty())); },
      /* The page in view, or the canvas shown (from 1). */
      page: function () { return pageInView() + 1; },
      pages: function () { return count(); },
      goTo: function (n) { return goTo((n | 0) - 1); },
      mode: function () { return S.book ? meta().mode : null; },
      book: function () { return S.book; },
      editor: function () { return S.editor; },
      active: function () { return S.active; },
      ready: null,
      setReadOnly: setReadOnly,
      setSetting: setSetting,
      setCanvasLook: function (n, patch) { return setCanvasLook((n | 0) - 1, patch || {}); },
      addPage: function (after) { return addPage(after == null ? null : after - 1); },
      duplicatePage: function (n) { return duplicatePage((n | 0) - 1); },
      deletePage: function (n) { return deletePage((n | 0) - 1); },
      movePage: function (from, to) { return movePage((from | 0) - 1, (to | 0) - 1); },
      openThumbs: openThumbs,
      openSettings: openSettings,
      exportBook: exportBook,
      /* The export sheet's way in (export.js, with the board up): the same
       * export as the notebook's own menu, on the paper chosen there. */
      exportAs: function (format, paper) {
        if (paper === 'light' || paper === 'dark') setExportPaper(paper);
        return runExport(format === 'png' ? 'png' : 'pdf');
      },
      exportPaper: exportPaper,
      idle: function () { return S.chain.then(function () { return reloading ? new Promise(function (r) { setTimeout(r, 30); }) : null; }); },
      relayout: function () { if (S.editor) S.editor.paint(); }
    };
    views.push(api);

    api.ready = load(opts.ref || null).then(function () {
      if (S.closed) return false;
      if (S.book.unreadable) toast(t('notebook.unreadable'), { kind: 'error' });
      recallCanvases();
      buildEditor();
      return true;
    }, function (err) {
      warn('opening the notebook', err);
      root.removeAttribute('data-loading');
      toast(t('notebook.unreadable'), { kind: 'error' });
      return false;
    });
    return api;
  }

  /* ================================================================ the board view */

  var boardHost = null;
  var boardViewApi = null;
  var boardFor = null;          // {projectId, mapId}
  var seg = { top: null, lead: null };
  var inited = false;

  function openMap() {
    var s = ns.session;
    var cur = s && typeof s.current === 'function' ? s.current() : null;
    return cur && cur.projectId && cur.mapId ? cur : null;
  }

  function appReadOnly() {
    var s = ns.session;
    try { if (s && typeof s.readOnly === 'function' && s.readOnly()) return true; } catch (err) { /* below */ }
    try { if (ns.shell && ns.shell.viewOnly && ns.shell.viewOnly()) return true; } catch (err) { /* below */ }
    try { if (store() && store().readOnly && store().readOnly()) return true; } catch (err) { /* below */ }
    return false;
  }

  function boardShown() { return !!boardViewApi; }

  function stage() { return document.getElementById('stage'); }

  /* The board fills the stage below the top bar (whose capsules float over
   * the stage on every screen). */
  function placeBoard() {
    if (!boardHost) return;
    var top = 0;
    try { top = ns.shell && ns.shell.insets ? ns.shell.insets().top : 0; } catch (err) { top = 0; }
    boardHost.style.setProperty('--nb-top', Math.max(0, top - 8) + 'px');
    if (boardViewApi) boardViewApi.relayout();
  }

  function showBoard(opts) {
    opts = opts || {};
    var cur = openMap();
    if (!cur) { toast(t('notebook.noMap')); return false; }
    if (boardViewApi && boardFor && boardFor.projectId === cur.projectId && boardFor.mapId === cur.mapId) {
      focusBoard();
      return true;
    }
    hideBoard({ keepView: true });
    var host = stage();
    if (!host || !ns.ink) return false;
    var ref = null;
    try { ref = doc().boardPath(cur.state); } catch (err) { ref = null; }
    document.documentElement.setAttribute('data-board', '');
    boardHost = h('div', { id: 'board', class: 'nb-stage', role: 'region', 'aria-label': t('notebook.region', { map: cur.map ? cur.map.name : '' }) });
    boardHost.addEventListener('focusout', onBoardFocusOut);
    /* The map's own focus, if it had it, goes: a hidden map holds no keys. */
    if (inHiddenMap(document.activeElement)) {
      try { document.activeElement.blur(); } catch (err) { /* nothing focused */ }
    }
    var floaters = document.getElementById('floaters');
    host.insertBefore(boardHost, floaters || null);
    placeBoard();
    boardFor = { projectId: cur.projectId, mapId: cur.mapId };
    /* The map's own keys must not act on a map nobody sees. */
    try { if (ns.session && ns.session.select) ns.session.select(null); } catch (err) { /* nothing selected */ }
    boardViewApi = open(boardHost, {
      projectId: cur.projectId, mapId: cur.mapId, ref: ref, kind: 'board',
      readOnly: appReadOnly(), focus: opts.focus !== false
    });
    if (!opts.restoring) {
      try { store().setMapView(cur.projectId, cur.mapId, { view: 'board' }); } catch (err) { warn('remembering the view', err); }
    }
    paintSeg();
    emit('board', { open: true, projectId: cur.projectId, mapId: cur.mapId });
    if (ns.bus) ns.bus.emit('layout');
    return true;
  }

  function hideBoard(opts) {
    opts = opts || {};
    if (!boardViewApi && !boardHost) return false;
    var api = boardViewApi;
    var was = boardFor;
    var hadFocus = boardHost && boardHost.contains(document.activeElement);
    boardViewApi = null;
    if (api) api.close();
    if (boardHost && boardHost.parentNode) boardHost.parentNode.removeChild(boardHost);
    boardHost = null;
    boardFor = null;
    document.documentElement.removeAttribute('data-board');
    if (was && !opts.keepView) {
      try { store().setMapView(was.projectId, was.mapId, { view: null }); } catch (err) { warn('remembering the view', err); }
    }
    paintSeg();
    if (hadFocus && opts.focus !== false) {
      var v = ns.session && ns.session.view;
      var el = v && v.el;
      if (el) { try { el.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
    }
    emit('board', { open: false });
    if (ns.bus) ns.bus.emit('layout');
    return true;
  }

  /* ---------------------------------------------------------------- the hidden map keeps still
   *
   * While the board is up the map is laid out but unseen, and its keys must
   * not reach it: with the focus nowhere (on the page itself, after a press
   * on something that takes no focus or a sheet closed) the arrows would
   * select a node and Enter, Delete or Alt+arrows edit a map nobody sees.
   * Such a key does nothing but bring the focus back to the board; keys
   * meant for the app (the palette, undo, the board switch, Escape, the
   * function keys) go on. A node chosen deliberately (a search result, a
   * command of the palette) is a wish to see it: the map comes back. */

  var MAP_ONLY = /^(?:node|navigate|format)\./;
  var MAP_ONLY_IDS = ['view.zoomIn', 'view.zoomOut', 'view.fit'];

  /* What acts on the map's nodes, its selection or its camera: nothing
   * the board's "more" should offer while the map is out of sight (undo
   * and redo are in the board's own bar). */
  var NOT_ON_BOARD = ['media.image', 'media.draw', 'media.board', 'notes.toggleAll', 'history.undo', 'history.redo'];

  function mapOnly(cmd) {
    return MAP_ONLY.test(cmd.id) || cmd.group === 'node' || cmd.group === 'format' ||
      MAP_ONLY_IDS.indexOf(cmd.id) >= 0 || NOT_ON_BOARD.indexOf(cmd.id) >= 0;
  }

  function groupName(g) {
    var key = 'group.' + g;
    var text = t(key);
    return text !== key ? text : g.charAt(0).toUpperCase() + g.slice(1);
  }

  /* The board's "more" on a phone (the thumb bar's, which the board
   * covers): the palette first, then every command that means something
   * with the map out of sight, by group, as the app's own menu lists them. */
  function boardMoreItems() {
    var C = ns.commands;
    if (!C || typeof C.all !== 'function') return [];
    var ctx = { source: 'menu' };
    var groups = {};
    C.all().forEach(function (cmd) {
      if (cmd.showInPalette === false || cmd.id === 'palette.open' || mapOnly(cmd)) return;
      if (!C.enabled(cmd, ctx)) return;
      (groups[cmd.group] || (groups[cmd.group] = [])).push(cmd);
    });
    var items = [];
    if (C.has('palette.open') && C.enabled('palette.open', ctx)) {
      var p = C.get('palette.open');
      items.push({ label: C.title('palette.open', ctx), icon: p.icon || 'command', shortcut: p.keys, onSelect: function () { C.run('palette.open', ctx); } });
    }
    var order = (C.GROUPS || []).slice();
    Object.keys(groups).forEach(function (g) { if (order.indexOf(g) < 0) order.push(g); });
    order.forEach(function (g) {
      if (!groups[g]) return;
      if (items.length) items.push('-');
      items.push({ heading: groupName(g) });
      groups[g].forEach(function (cmd) {
        items.push({
          label: C.title(cmd.id, ctx), icon: cmd.icon, shortcut: cmd.keys, checked: C.checked(cmd, ctx),
          onSelect: function () { C.run(cmd.id, ctx); }
        });
      });
    });
    return items;
  }

  function mapCommandFor(e) {
    var C = ns.commands;
    if (!C || typeof C.all !== 'function' || typeof C.matches !== 'function') return null;
    var list = C.all();
    for (var i = 0; i < list.length; i++) {
      var cmd = list[i];
      if (!MAP_ONLY.test(cmd.id) && MAP_ONLY_IDS.indexOf(cmd.id) < 0) continue;
      var keys = cmd.keys || [];
      for (var k = 0; k < keys.length; k++) {
        try { if (C.matches(e, keys[k])) return cmd.id; } catch (err) { /* an odd key spec */ }
      }
    }
    return null;
  }

  function nowhere(el) {
    return !el || el === document.body || el === document.documentElement || el.nodeType !== 1;
  }

  function inHiddenMap(el) {
    var v = ns.session && ns.session.view;
    return !!(v && v.el && el && el.nodeType === 1 && (el === v.el || v.el.contains(el)));
  }

  function guardKeys(e) {
    if (!boardViewApi || !boardHost || e.defaultPrevented || e.isComposing) return;
    var target = e.target;
    if (boardHost.contains(target)) return;
    var hidden = inHiddenMap(target);
    if (!hidden && !nowhere(target)) return;
    if (/^(Control|Shift|Alt|AltGraph|Meta|OS|CapsLock|Fn|Escape|Tab)$/.test(e.key || '')) return;
    if (ns.commands && ns.commands.isStoodDown && ns.commands.isStoodDown()) return;
    var appKey = (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key || '')) && !mapCommandFor(e);
    if (appKey) return;
    if (!hidden && !mapCommandFor(e)) return;
    e.preventDefault();
    e.stopPropagation();
    focusBoard();
  }

  /* The focus fell to the page from inside the board (a control that went
   * away, a press on something that takes no focus): it comes back. */
  function onBoardFocusOut(e) {
    if (e.relatedTarget) return;
    setTimeout(function () {
      if (!boardViewApi || !nowhere(document.activeElement)) return;
      if (ns.commands && ns.commands.isStoodDown && ns.commands.isStoodDown()) return;
      focusBoard();
    }, 0);
  }

  function onSelection(d) {
    if (!boardViewApi || !boardFor || !d || d.path == null) return;
    if (d.mapId && d.mapId !== boardFor.mapId) return;
    hideBoard({ focus: false });
  }

  function showMap() { return hideBoard(); }

  function toggleBoard() { return boardShown() ? hideBoard() : showBoard(); }

  function focusBoard() {
    var ed = boardViewApi && boardViewApi.editor();
    if (ed) ed.focus();
  }

  /* The map opened (or another one did): it shows the face it was left
   * on. */
  function followMap() {
    var cur = openMap();
    if (!cur) { hideBoard({ keepView: true, focus: false }); return; }
    var wanted = false;
    try { wanted = store().mapView(cur.projectId, cur.mapId).view === 'board'; } catch (err) { wanted = false; }
    if (boardFor && (boardFor.projectId !== cur.projectId || boardFor.mapId !== cur.mapId)) hideBoard({ keepView: true, focus: false });
    if (wanted && !boardViewApi) showBoard({ restoring: true, focus: false });
    else if (!wanted && boardViewApi) hideBoard({ keepView: true, focus: false });
    paintSeg();
  }

  /* ---------------------------------------------------------------- the switch Map | Board */

  function buildSeg(compact) {
    var group = h('div', { class: 'seg nb-switch' + (compact ? ' nb-switch--compact' : ''), role: 'radiogroup' });
    [['map', 'map'], ['board', 'board']].forEach(function (pair) {
      var b = h('button', { type: 'button', class: 'seg__opt nb-switch__opt', role: 'radio', 'data-value': pair[0] });
      b.appendChild(uiIcon(pair[1]));
      b.appendChild(h('span', { class: 'nb-switch__label' }));
      b.addEventListener('click', function () {
        if (pair[0] === 'board') showBoard();
        else hideBoard();
      });
      group.appendChild(b);
    });
    group.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowRight') showBoard({ focus: false });
      else hideBoard({ focus: false });
      var on = group.querySelector('[aria-checked="true"]');
      if (on) on.focus();
    });
    return group;
  }

  function paintSeg() {
    var shown = boardShown();
    var has = !!openMap();
    [seg.top, seg.lead].forEach(function (g) {
      if (!g) return;
      g.setAttribute('aria-label', t('notebook.view.label'));
      g.hidden = !has;
      Array.prototype.forEach.call(g.children, function (b) {
        var v = b.getAttribute('data-value');
        var on = v === 'board' ? shown : !shown;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        var label = t(v === 'board' ? 'notebook.view.board' : 'notebook.view.map');
        b.setAttribute('aria-label', label);
        var span = b.querySelector('.nb-switch__label');
        if (span) span.textContent = label;
      });
    });
  }

  function mountSeg() {
    if (!seg.top && ns.shell && typeof ns.shell.addTopControl === 'function') {
      seg.top = buildSeg(false);
      try { ns.shell.addTopControl(seg.top, { before: 'search' }); } catch (err) { warn('the top bar', err); seg.top = null; }
    }
    var lead = document.getElementById('topbar-lead');
    if (!seg.lead && lead) {
      seg.lead = buildSeg(true);
      lead.appendChild(seg.lead);
    }
    paintSeg();
  }

  function registerCommands() {
    var C = ns.commands;
    if (!C || typeof C.register !== 'function') return;
    C.register({
      id: 'view.board', label: 'notebook.cmd.board', group: 'view', icon: 'board', keys: ['Mod+Shift+L'],
      keywords: t('notebook.kw.board'), help: 'notebook.help.board',
      when: function () { return !!openMap(); },
      checked: function () { return boardShown(); },
      title: function () { return t(boardShown() ? 'notebook.cmd.showMap' : 'notebook.cmd.showBoard'); },
      run: function () { return toggleBoard(); }
    });
  }

  function onReadOnlyChange() {
    var ro = appReadOnly();
    views.forEach(function (v) { if (v === boardViewApi) v.setReadOnly(ro); });
  }

  /* The page goes away with strokes held: the browser asks first. */
  function onBeforeUnload(e) {
    if (!isDirty()) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  }

  function init() {
    if (inited) return;
    inited = true;
    registerCommands();
    mountSeg();
    if (ns.bus && typeof ns.bus.on === 'function') {
      ns.bus.on('map:opened', followMap);
      ns.bus.on('map:closed', function () { hideBoard({ keepView: true, focus: false }); paintSeg(); });
      ns.bus.on('lang', function () {
        paintSeg();
        if (boardHost) {
          var cur = openMap();
          boardHost.setAttribute('aria-label', t('notebook.region', { map: cur && cur.map ? cur.map.name : '' }));
        }
      });
      ns.bus.on('layout', placeBoard);
      ns.bus.on('selection', onSelection);
      ns.bus.on('sidebar', placeBoard);
      ns.bus.on('tabs', onReadOnlyChange);
      ns.bus.on('prefs', function (d) {
        if (d && d.key === 'mode') {
          onReadOnlyChange();
          placeBoard();
        }
      });
      ns.bus.on('store', function (c) {
        if (c && (c.type === 'map:delete' || c.type === 'project:delete') && boardFor && !store().map(boardFor.projectId, boardFor.mapId)) {
          hideBoard({ keepView: true, focus: false });
        }
      });
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('resize', placeBoard);
    window.addEventListener('keydown', guardKeys, true);
    followMap();
  }

  /* The app's module list starts the notebook (after ink, before the
   * workspace). A page that loads this file without the app listing it (a
   * test page, an older shell) still gets it, at the boot: not earlier, so
   * the modules keep the order the app gives them. */
  if (ns.bus && typeof ns.bus.on === 'function') {
    var offBooted = ns.bus.on('booted', function () {
      if (offBooted) { offBooted(); offBooted = null; }
      if (!inited && ns.store && ns.session) init();
    });
  }

  function isDirty() {
    for (var i = 0; i < views.length; i++) if (views[i].isDirty()) return true;
    return false;
  }

  function flushAll() {
    return Promise.all(views.map(function (v) { return v.flush(); }));
  }

  ns.notebook = {
    init: init,
    open: open,
    read: read,
    write: write,
    exportPdf: exportPdf,
    exportPng: exportPng,
    isDirty: isDirty,
    flush: flushAll,
    views: function () { return views.slice(); },
    showBoard: showBoard,
    showMap: showMap,
    toggleBoard: toggleBoard,
    boardShown: boardShown,
    boardView: function () { return boardViewApi; },
    themed: themed,
    model: {
      defaults: defaults,
      normalize: normalize,
      toJson: toJson,
      parseJson: parseJson,
      folderOf: folderOf,
      isLone: isLone,
      pageName: pageName,
      pageNumber: pageNumber,
      nextPageNumber: nextPageNumber,
      reconcile: reconcile,
      lookOf: lookOf,
      metaFor: metaFor,
      appLook: appLook,
      BACKGROUNDS: BACKGROUNDS,
      apply: apply,
      blankPage: blankPage,
      redraw: redraw,
      pagePx: pagePx,
      freeFolder: freeFolder
    }
  };
})(window.MindRoot);
