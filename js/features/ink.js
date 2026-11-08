/* MindRoot - ink: the drawing editor that replaces Excalidraw.
 *
 * What people actually did with Excalidraw inside MindRoot was freehand with
 * pressure, a few shapes, some text and MindRoot's own eraser; for that the
 * old app carried 4.7 MB of React, roughjs and a mermaid chunk pinned to the
 * last UMD build. This is the same set of things in one classic script:
 *
 *   - freehand strokes outlined the way perfect-freehand does it (the MIT
 *     algorithm by Steve Ruiz, reimplemented below: streamline, smoothing,
 *     thinning, pressure simulated from speed when the hand is a mouse or a
 *     finger), five instruments (pen, pencil, marker, brush, highlighter);
 *   - rectangle, ellipse, diamond, line and arrow, Shift to constrain;
 *   - text placed with a tap and written in a real textarea over the sheet;
 *   - select, marquee, move, resize, duplicate, bring to front, delete;
 *   - the eraser of the old app, ported with its geometry and its gesture
 *     rules (part / whole stroke / area, the fade, one undo step, the back
 *     of a pen, the barrel button, palm rejection, pinch and cancel putting
 *     everything back, window blur keeping what was erased, Escape);
 *   - an infinite sheet with pan, wheel and pinch zoom, undo and redo.
 *
 * The file is the picture: a drawing saves as a plain, self-contained SVG
 * (light paper, system fonts, nothing external, so it shows the same in an
 * <img>, in Obsidian and in a browser) that carries its editable scene as
 * JSON in <metadata id="mindroot-ink">. An SVG without that metadata - an
 * old .excalidraw.svg - opens as a locked picture behind the sheet, which
 * the new drawing keeps in its own file. A file this version cannot write
 * back faithfully (a later format, or one that cannot be read at all) opens
 * view only with a notice, never as an empty sheet that the first stroke
 * would save over it.
 *
 * Saving is the host's business; this module only says when there is
 * something to save. onSave(svgText) is called 600 ms after the last
 * committed gesture, and when the editor closes, and only when the scene is
 * not the one last saved (element ids and versions, never the camera or the
 * tool), so a drawing nobody drew in never creates a file. A save the host
 * refuses keeps the drawing to be saved: Done then leaves the editor open,
 * and a close by the host hands the drawing back in onClose.
 *
 * Elements are plain immutable objects in absolute scene coordinates; every
 * change makes a new object with a fresh version, so undo is a stack of
 * arrays, dirty tracking is a comparison of id:version lists and caches can
 * be keyed by the object itself.
 *
 * Notebooks (docs/NOTEBOOK.md) add four things, all optional, so a bare
 * editor behaves as it always did:
 *   - the look: opts.look {theme, background, paper, tile} draws the paper
 *     of ns.paper under the drawing (on the infinite sheet only the part on
 *     screen, regenerated when the camera leaves it or the zoom moves by a
 *     quarter octave, so it stays fast at any zoom) on the sheet colour of
 *     the theme or the one chosen;
 *   - the semantic ink: the colour 'ink' (the default of the pen, the
 *     pencil, shapes and text) is dark on light paper and light on dark
 *     paper. Files keep it as the light paper's literal ink with the class
 *     mr-ink, and the sheet with mr-sheet, so ns.paper.themeSvg can show a
 *     saved page in either theme; every other colour is literal;
 *   - a page: opts.page {w, h} bounds the drawing (clipped to the page,
 *     saved with the page as its viewBox); a press outside it is offered to
 *     the host (opts.onOutside), which may turn the editor to another page
 *     with setPage() - one editor, so one toolbar, walks a whole notebook,
 *     each page keeping its own undo while the editor lives;
 *   - a camera the host follows (opts.onCamera) and bounds
 *     (opts.clampCamera), for the notebook's scroll of pages.
 * The sheet is the light paper the file is saved with unless a look says
 * otherwise; the file is always written on the light paper.
 *
 * API (docs/ARCHITECTURE.md 4.16):
 *   ns.ink.open(host, opts) -> editor     mounts inside host (give it a size)
 *     opts.svgText     the file to edit ('' or absent: a new drawing)
 *     opts.background  SVG text or an image data URL to lock behind a new
 *                      drawing (an SVG without our scene becomes this anyway)
 *     opts.title       names the editor for screen readers
 *     opts.onSave(svg) called when there is something new to keep; may
 *                      return a promise, which must settle; false, a throw
 *                      or a rejection means not kept (it stays to be saved)
 *     opts.onClose({saved, svg})  once, after the last save has settled:
 *                      saved says whether the final drawing is kept, svg is
 *                      that drawing (null when nothing needed saving) - a
 *                      host that could not store it must keep it from here
 *     opts.onChange({dirty, count}), opts.readOnly, opts.focus (false: do
 *     not take the focus), opts.returnFocus (where the focus goes on close;
 *     default: what had it when the editor opened)
 *     opts.look {theme: 'light'|'dark', background: 'auto'|'#hex',
 *                paper: {type, ...} | null, tile: {w, h} px | null,
 *                image: {href, w, h, fileHref?, embed?} | null}   a picture
 *                      as the paper: href on the sheet, fileHref (a lighter
 *                      copy) in the file; embed false and no fileHref keep
 *                      it out of the file
 *     opts.page {w, h} px, opts.pageId     a bounded page (see above)
 *     opts.onOutside([x, y], event) -> bool   a press off the page; true
 *                      when the host turned the editor to the page there
 *     opts.onCamera({x, y, k}, rect)   after every camera change
 *     opts.clampCamera({x, y, k}, rect) -> {x, y, k}   keeps it in bounds
 *     opts.hostCamera  true: no fitting on open or resize (the host places it)
 *     opts.actions     extra buttons for the actions bar, before Done
 *     opts.done        false: no Done button (a view that never closes)
 *     opts.momentum    true: a pan let go keeps gliding (a notebook's pages)
 *     opts.history {undo(), redo(), state() -> {undo, redo}}   a host whose
 *                      history holds the strokes (one app history): undo
 *                      and redo, keys and buttons, go to it; the editor
 *                      hands its drawing over first. editor.refreshHistory()
 *                      when that history moved.
 *     onSave(svg, {count, page}) names the page (opts.pageId / setPage id);
 *     a host that pages must answer it at once (true/false, no promise)
 *   editor.close() -> svg|null   hands over what is waiting, unmounts, then
 *                                onClose; the svg is the final drawing
 *   editor.done()                the Done button: closes once saved, stays
 *                                open (and says so) when the host cannot
 *   editor.save() -> svg|null    saves now if anything changed
 *   editor.loaded()              how the file opened ({kind, locked, ...})
 *   editor.isDirty(), editor.setReadOnly(bool), editor.svg(), and the
 *   helpers the tests drive (scene, tool, setTool, undo, redo, camera ...)
 *   editor.setLook(look), editor.setPage({id, svgText, page, look}) -> bool (look: the
 *   page's own paper, if it has one),
 *   editor.pageId(), editor.paint() (repaint after a host relayout)
 *   ns.ink.isDirty()  any editor with something not yet kept
 *   ns.ink.flush()    saves every open editor now (before the page goes)
 *   ns.ink.parse(svg) / serialize({elements, background, page, paper, sheet,
 *   tile}) / isInkSvg(svg), ns.ink.INK (the semantic colour's name) */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';

  /* The paper a drawing is saved on, and the sheet it is drawn on. Data
   * written into files, like the branch palette: not a theme colour. */
  var PAPER = '#fbfaf7';
  /* The semantic ink: a name in the scene, the light paper's ink in the
   * file (ns.paper's LIGHT.ink, repeated for a page without ns.paper), the
   * theme's ink on screen. */
  var INK = 'ink';
  var LIGHT_INK = '#15171c';
  var DARK_SHEET = '#1c1e22';
  var DARK_INK = '#e4e6ea';
  /* The defaults of the first version, black and graphite: a hand that
   * never chose another colour gets the ink that adapts. */
  var OLD_BLACK = '#1f2328';
  var OLD_GRAPHITE = '#4a4f57';
  /* The paper on screen is drawn for a margin around what is visible and
   * again when the camera leaves it, or when the zoom has moved by a
   * quarter octave (line weights and density follow the zoom). */
  var PAPER_MARGIN = 0.5;
  var PAPER_STEPS = 4;
  /* Momentum of a pan let go (px per ms): under FLING_MIN it stops where
   * the hand left it; it decays by FLING_DECAY per ms (about 0.9 a frame)
   * and stops under FLING_STOP. */
  var FLING_MIN = 0.35;
  var FLING_DECAY = 0.9935;
  var FLING_STOP = 0.02;
  /* Text in a saved drawing must render wherever the SVG goes, and an SVG
   * inside <img> loads no fonts: the system stack, written into the file. */
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var LINE_HEIGHT = 1.25;
  var FORMAT = 1;
  /* A file with a picture on its sheet is written as format 2, so a build
   * that does not know pictures opens it read-only ('newer') instead of
   * saving it back without them. Everything else stays format 1. */
  var IMAGE_FORMAT = 2;
  var MAX_FORMAT = 2;
  var IMAGE_ID = 'mrimg-';          // the id prefix of a picture's <image> in the file
  var IMAGE_MAX_CHARS = 14 * 1024 * 1024;   // a picture's data URL, at most
  var IMAGE_MAX_SIDE = 2048;        // px: a bigger picture is scaled down when it is added
  var IMAGE_MAX_SIZE = 20000;       // a picture on the sheet, in sheet units
  var META_ID = 'mindroot-ink';
  var BG_ID = 'mindroot-ink-bg';

  var PAD = 16;                 // around the content, in the saved viewBox
  var ZOOM_MIN = 0.1;
  var ZOOM_MAX = 8;
  var HISTORY = 300;
  var SAVE_DELAY = 600;
  var FADED = 0.2;              // what the eraser is about to take
  var SLOP = 10;                // a barrel press travels this far before it erases
  var TAP = 4;                  // under this a press is a tap, not a drag (screen px)
  var TAP_TOUCH = 8;
  var DOUBLE_TAP = 350;
  var MENU_SWALLOW = 800;
  var HIT = 6;                  // reach of a tap that selects (screen px)
  var DUPLICATE_OFFSET = 16;
  var NUDGE = 1;
  var NUDGE_BIG = 10;

  /* The back of a pen arrives as button 5 (buttons bit 32), its side
   * (barrel) button as button 2. */
  var BACK = 5;
  var BACK_BIT = 32;
  var SIDE = 2;

  var TOOLS = ['select', 'hand', 'pen', 'eraser', 'rect', 'ellipse', 'diamond', 'line', 'arrow', 'text'];
  var SHAPES = ['rect', 'ellipse', 'diamond', 'line', 'arrow'];
  var KEYS = { v: 'select', h: 'hand', p: 'pen', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', t: 'text' };
  var TOOL_KEYS = { select: 'V', hand: 'H', pen: 'P', eraser: 'E', rect: 'R', ellipse: 'O', diamond: 'D', line: 'L', arrow: 'A', text: 'T' };

  /* Eight inks. Chosen to sit with the map's branch colours, dark enough on
   * the paper to read as lines, with one yellow for the highlighter. */
  var SWATCHES = [
    { id: 'ink', hex: INK },
    { id: 'grey', hex: '#7a828e' },
    { id: 'red', hex: '#c4314b' },
    { id: 'orange', hex: '#d9731c' },
    { id: 'yellow', hex: '#f2c12e' },
    { id: 'green', hex: '#2f7d5a' },
    { id: 'blue', hex: '#2f6fb3' },
    { id: 'violet', hex: '#8a5fbf' }
  ];

  /* An instrument is a nib (diameter in sheet pixels at mid pressure), an
   * ink and the three perfect-freehand numbers that make it behave like
   * itself. The numbers are written into every stroke, so changing them here
   * later never changes a drawing already made. */
  var PENS = [
    { id: 'pen', size: 3, opacity: 1, thinning: 0.6, smoothing: 0.5, streamline: 0.5, cap: true, blend: 'normal', color: INK },
    { id: 'pencil', size: 2, opacity: 0.72, thinning: 0.3, smoothing: 0.35, streamline: 0.3, cap: true, blend: 'normal', color: INK },
    { id: 'marker', size: 10, opacity: 0.6, thinning: 0, smoothing: 0.6, streamline: 0.55, cap: true, blend: 'normal', color: '#2f6fb3' },
    { id: 'brush', size: 14, opacity: 0.95, thinning: 0.8, smoothing: 0.6, streamline: 0.45, cap: true, blend: 'normal', color: '#c4314b' },
    { id: 'highlighter', size: 20, opacity: 0.4, thinning: 0, smoothing: 0.6, streamline: 0.6, cap: false, blend: 'multiply', color: '#f2c12e' }
  ];
  var PEN_MIN = 1;
  var PEN_MAX = 48;

  var ERASER_MODES = ['part', 'stroke', 'area'];
  var ERASER_MIN = 4;
  var ERASER_MAX = 80;
  var ERASER_STEP = 2;

  var WIDTHS = { s: 2, m: 4, l: 8 };          // shape outlines
  var TEXT_SIZES = { s: 16, m: 24, l: 36 };   // never under 16: iOS zooms into smaller fields
  var FILLS = ['none', 'soft', 'solid'];
  var SOFT_FILL = 0.2;

  /* ================================================================ strings */

  var STRINGS = {
    en: {
      'ink.surface': 'Drawing',
      'ink.surfaceTitled': 'Drawing: {title}',
      'ink.hint': 'Draw with a pen, a finger or the mouse. Two fingers move and zoom the sheet. Keys: P pen, E eraser, V select, H pan, R rectangle, O ellipse, D diamond, L line, A arrow, T text.',
      'ink.tools': 'Drawing tools',
      'ink.actions': 'Drawing actions',
      'ink.zoomBar': 'Zoom',
      'ink.tool.select': 'Select',
      'ink.tool.hand': 'Pan',
      'ink.tool.pen': 'Pen',
      'ink.laser': 'Laser pointer (pen)',
      'ink.laser.mode': 'The pen leaves',
      'ink.laser.mode.ink': 'Ink',
      'ink.laser.mode.laser': 'Laser',
      'ink.laser.on': 'Laser pointer on: the pen leaves a trail that fades and draws nothing',
      'ink.tool.eraser': 'Eraser',
      'ink.tool.rect': 'Rectangle',
      'ink.tool.ellipse': 'Ellipse',
      'ink.tool.diamond': 'Diamond',
      'ink.tool.line': 'Line',
      'ink.tool.arrow': 'Arrow',
      'ink.tool.text': 'Text',
      'ink.tool.shapes': 'Shapes',
      'ink.withKey': '{label} ({key})',
      'ink.againForOptions': '{label}: press again for its options',
      'ink.coach.pen': 'Tap again for pen options',
      'ink.coach.penClick': 'Click again for pen options',
      'ink.coach.eraser': 'Tap again for eraser options',
      'ink.coach.eraserClick': 'Click again for eraser options',
      'ink.coach.shape': 'Tap again for shape options',
      'ink.coach.shapeClick': 'Click again for shape options',
      'ink.coach.text': 'Tap again for text options',
      'ink.coach.textClick': 'Click again for text options',
      'ink.style': 'Colour and size',
      'ink.more': 'More',
      'ink.pen.pen': 'Pen',
      'ink.pen.pencil': 'Pencil',
      'ink.pen.marker': 'Marker',
      'ink.pen.brush': 'Brush',
      'ink.pen.highlighter': 'Highlighter',
      'ink.penNote.pen': 'Full strength, with a clean edge.',
      'ink.penNote.pencil': 'Lighter and thinner.',
      'ink.penNote.marker': 'Broad and see-through: where it crosses itself it goes darker.',
      'ink.penNote.brush': 'Follows the pressure of the hand.',
      'ink.penNote.highlighter': 'Lets what is underneath show through.',
      'ink.pens': 'Instrument',
      'ink.eraser.part': 'Part',
      'ink.eraser.stroke': 'Whole stroke',
      'ink.eraser.area': 'Area',
      'ink.eraserNote.part': 'Cuts the ink where it passes. A shape or a text it touches goes whole.',
      'ink.eraserNote.stroke': 'Whatever it touches goes whole.',
      'ink.eraserNote.area': 'Draw a loop: the ink inside goes, and whatever lies entirely inside.',
      'ink.eraserModes': 'Eraser',
      'ink.colors': 'Colour',
      'ink.color.ink': 'Ink',
      'ink.color.inkNote': 'Ink: dark on light paper, light on dark paper.',
      'ink.color.grey': 'Grey',
      'ink.color.red': 'Red',
      'ink.color.orange': 'Orange',
      'ink.color.yellow': 'Yellow',
      'ink.color.green': 'Green',
      'ink.color.blue': 'Blue',
      'ink.color.violet': 'Violet',
      'ink.color.custom': 'Another colour',
      'ink.size': 'Size',
      'ink.px': '{n} px',
      'ink.width': 'Line',
      'ink.width.s': 'Thin',
      'ink.width.m': 'Medium',
      'ink.width.l': 'Thick',
      'ink.fill': 'Fill',
      'ink.fill.none': 'None',
      'ink.fill.soft': 'Light',
      'ink.fill.solid': 'Full',
      'ink.textSize': 'Text size',
      'ink.textSize.s': 'Small',
      'ink.textSize.m': 'Medium',
      'ink.textSize.l': 'Large',
      'ink.textField': 'Text on the drawing',
      'ink.textPlaceholder': 'Write',
      'ink.undo': 'Undo',
      'ink.redo': 'Redo',
      'ink.done': 'Done',
      'ink.selection': 'Selection',
      'ink.duplicate': 'Duplicate',
      'ink.image': 'Picture',
      'ink.image.pick': 'Add a picture',
      'ink.image.added': 'Picture added. Drag it, resize it by its handles; draw and write over it.',
      'ink.image.failed': 'That picture could not be added.',
      'ink.image.badType': 'Only PNG, JPEG, WebP, GIF or SVG pictures can be added.',
      'ink.image.tooBig': 'That picture is too big to keep in the drawing.',
      'ink.lock': 'Lock the picture',
      'ink.unlock': 'Unlock the picture',
      'ink.locked': 'Locked picture. Press its padlock to move it again.',
      'ink.front': 'Bring to front',
      'ink.delete': 'Delete',
      'ink.zoomIn': 'Zoom in',
      'ink.zoomOut': 'Zoom out',
      'ink.zoomReset': 'Back to 100%',
      'ink.fit': 'Fit the drawing',
      'ink.zoomLevel': '{n}%',
      'ink.status.clean': 'No changes',
      'ink.status.dirty': 'Unsaved',
      'ink.status.saving': 'Saving',
      'ink.status.saved': 'Saved',
      'ink.status.failed': 'Not saved',
      'ink.status.readonly': 'View only',
      'ink.background': 'Earlier drawing, locked in the background',
      'ink.notSavedStay': 'Not saved. The drawing stays open.',
      'ink.notice.newer': 'This drawing was made with a newer version of MindRoot. It opens view only, so that it is not written over.',
      'ink.notice.invalid': 'This drawing cannot be read. It opens view only, so that it is not written over.',
      'ink.notice.damaged': 'The editable part of this drawing cannot be read. It is kept as a picture behind the sheet, and you can draw over it.'
    },
    it: {
      'ink.surface': 'Disegno',
      'ink.surfaceTitled': 'Disegno: {title}',
      'ink.hint': 'Disegna con la penna, con un dito o con il mouse. Due dita spostano e ingrandiscono il foglio. Tasti: P penna, E gomma, V seleziona, H sposta, R rettangolo, O ellisse, D rombo, L linea, A freccia, T testo.',
      'ink.tools': 'Strumenti di disegno',
      'ink.actions': 'Azioni sul disegno',
      'ink.zoomBar': 'Zoom',
      'ink.tool.select': 'Seleziona',
      'ink.tool.hand': 'Sposta la vista',
      'ink.tool.pen': 'Penna',
      'ink.laser': 'Puntatore laser (penna)',
      'ink.laser.mode': 'La penna lascia',
      'ink.laser.mode.ink': 'Inchiostro',
      'ink.laser.mode.laser': 'Laser',
      'ink.laser.on': 'Puntatore laser attivo: la penna lascia una scia che svanisce e non disegna nulla',
      'ink.tool.eraser': 'Gomma',
      'ink.tool.rect': 'Rettangolo',
      'ink.tool.ellipse': 'Ellisse',
      'ink.tool.diamond': 'Rombo',
      'ink.tool.line': 'Linea',
      'ink.tool.arrow': 'Freccia',
      'ink.tool.text': 'Testo',
      'ink.tool.shapes': 'Forme',
      'ink.withKey': '{label} ({key})',
      'ink.againForOptions': '{label}: premi di nuovo per le opzioni',
      'ink.coach.pen': 'Tocca di nuovo per le opzioni della penna',
      'ink.coach.penClick': 'Fai clic di nuovo per le opzioni della penna',
      'ink.coach.eraser': 'Tocca di nuovo per le opzioni della gomma',
      'ink.coach.eraserClick': 'Fai clic di nuovo per le opzioni della gomma',
      'ink.coach.shape': 'Tocca di nuovo per le opzioni delle forme',
      'ink.coach.shapeClick': 'Fai clic di nuovo per le opzioni delle forme',
      'ink.coach.text': 'Tocca di nuovo per le opzioni del testo',
      'ink.coach.textClick': 'Fai clic di nuovo per le opzioni del testo',
      'ink.style': 'Colore e misura',
      'ink.more': 'Altro',
      'ink.pen.pen': 'Penna',
      'ink.pen.pencil': 'Matita',
      'ink.pen.marker': 'Pennarello',
      'ink.pen.brush': 'Pennello',
      'ink.pen.highlighter': 'Evidenziatore',
      'ink.penNote.pen': 'Piena, con il bordo netto.',
      'ink.penNote.pencil': 'Più leggera e sottile.',
      'ink.penNote.marker': 'Larga e trasparente: dove si incrocia diventa più scura.',
      'ink.penNote.brush': 'Segue la pressione della mano.',
      'ink.penNote.highlighter': 'Lascia vedere quello che c\'è sotto.',
      'ink.pens': 'Strumento',
      'ink.eraser.part': 'Parziale',
      'ink.eraser.stroke': 'Tratto intero',
      'ink.eraser.area': 'Area',
      'ink.eraserNote.part': 'Taglia l\'inchiostro dove passa. Una forma o un testo che tocca va via intero.',
      'ink.eraserNote.stroke': 'Quello che tocca va via intero.',
      'ink.eraserNote.area': 'Disegna un anello: va via l\'inchiostro dentro e quello che ci sta tutto dentro.',
      'ink.eraserModes': 'Gomma',
      'ink.colors': 'Colore',
      'ink.color.ink': 'Inchiostro',
      'ink.color.inkNote': 'Inchiostro: scuro sulla carta chiara, chiaro su quella scura.',
      'ink.color.grey': 'Grigio',
      'ink.color.red': 'Rosso',
      'ink.color.orange': 'Arancio',
      'ink.color.yellow': 'Giallo',
      'ink.color.green': 'Verde',
      'ink.color.blue': 'Blu',
      'ink.color.violet': 'Viola',
      'ink.color.custom': 'Un altro colore',
      'ink.size': 'Misura',
      'ink.px': '{n} px',
      'ink.width': 'Linea',
      'ink.width.s': 'Sottile',
      'ink.width.m': 'Media',
      'ink.width.l': 'Spessa',
      'ink.fill': 'Riempimento',
      'ink.fill.none': 'Nessuno',
      'ink.fill.soft': 'Leggero',
      'ink.fill.solid': 'Pieno',
      'ink.textSize': 'Dimensione del testo',
      'ink.textSize.s': 'Piccolo',
      'ink.textSize.m': 'Medio',
      'ink.textSize.l': 'Grande',
      'ink.textField': 'Testo sul disegno',
      'ink.textPlaceholder': 'Scrivi',
      'ink.undo': 'Annulla',
      'ink.redo': 'Ripeti',
      'ink.done': 'Fine',
      'ink.selection': 'Selezione',
      'ink.duplicate': 'Duplica',
      'ink.image': 'Immagine',
      'ink.image.pick': 'Aggiungi un\'immagine',
      'ink.image.added': 'Immagine aggiunta. Trascinala, ridimensionala dalle maniglie; disegna e scrivi sopra.',
      'ink.image.failed': 'Non è stato possibile aggiungere quell\'immagine.',
      'ink.image.badType': 'Si possono aggiungere solo immagini PNG, JPEG, WebP, GIF o SVG.',
      'ink.image.tooBig': 'Quell\'immagine è troppo grande per restare nel disegno.',
      'ink.lock': 'Blocca l\'immagine',
      'ink.unlock': 'Sblocca l\'immagine',
      'ink.locked': 'Immagine bloccata. Premi il suo lucchetto per spostarla di nuovo.',
      'ink.front': 'Porta in primo piano',
      'ink.delete': 'Elimina',
      'ink.zoomIn': 'Ingrandisci',
      'ink.zoomOut': 'Riduci',
      'ink.zoomReset': 'Torna al 100%',
      'ink.fit': 'Adatta il disegno',
      'ink.zoomLevel': '{n}%',
      'ink.status.clean': 'Nessuna modifica',
      'ink.status.dirty': 'Da salvare',
      'ink.status.saving': 'Salvataggio',
      'ink.status.saved': 'Salvato',
      'ink.status.failed': 'Non salvato',
      'ink.status.readonly': 'Sola lettura',
      'ink.background': 'Disegno precedente, bloccato sullo sfondo',
      'ink.notSavedStay': 'Non salvato. Il disegno resta aperto.',
      'ink.notice.newer': 'Questo disegno è stato fatto con una versione più recente di MindRoot. Si apre in sola lettura, per non sovrascriverlo.',
      'ink.notice.invalid': 'Questo disegno non si riesce a leggere. Si apre in sola lettura, per non sovrascriverlo.',
      'ink.notice.damaged': 'La parte modificabile di questo disegno non si riesce a leggere. Resta come immagine dietro il foglio, e ci puoi disegnare sopra.'
    }
  };

  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  /* Through ns.i18n when it is there (it always is in the app); the English
   * table otherwise, so the component also stands on a bare page. */
  function t(key, vars) {
    var text = null;
    if (ns.i18n && typeof ns.i18n.t === 'function') {
      try { text = ns.i18n.t(key, vars); } catch (err) { text = null; }
      if (text !== key && text != null) return text;
    }
    text = STRINGS.en[key] != null ? STRINGS.en[key] : key;
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars && vars[name] != null ? String(vars[name]) : whole;
    });
  }

  /* ================================================================ small helpers */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function sq(x) { return x * x; }
  function round2(n) { var r = Math.round(n * 100) / 100; return r === 0 ? 0 : r; }
  function round3(n) { var r = Math.round(n * 1000) / 1000; return r === 0 ? 0 : r; }
  function num(n) { return String(round2(n)); }
  function finite(n) { return typeof n === 'number' && isFinite(n) && Math.abs(n) < 1e7; }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  /* A colour an element or a tool may hold: #rrggbb, or the semantic ink. */
  function isColor(c) { return c === INK || isHex(c); }
  function cleanColor(c, fallback) { return c === INK ? INK : (isHex(c) ? c.toLowerCase() : fallback); }

  function paperModule() { return ns.paper && typeof ns.paper.colors === 'function' ? ns.paper : null; }

  /* The light paper's ink: what the semantic colour is written as in a file. */
  function lightInk() {
    var P = paperModule();
    if (P) {
      try { return P.colors('light', 'auto').ink || LIGHT_INK; } catch (err) { return LIGHT_INK; }
    }
    return LIGHT_INK;
  }

  /* A look as the editor uses it: the theme and background given, resolved
   * into the sheet and ink colours to paint with (ns.paper's when it is
   * there, so the notebook, its thumbnails and this sheet agree). */
  function resolveLook(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var theme = raw.theme === 'dark' ? 'dark' : 'light';
    var background = isHex(raw.background) ? raw.background.toLowerCase() : 'auto';
    var sheet;
    var inkHex;
    var dark;
    var P = paperModule();
    var c = null;
    if (P) {
      try { c = P.colors(theme, background); } catch (err) { c = null; }
    }
    if (c && isHex(c.sheet) && isHex(c.ink)) {
      sheet = c.sheet;
      inkHex = c.ink;
      dark = !!c.dark;
    } else if (background !== 'auto') {
      sheet = background;
      dark = luminance(background) < 0.4;
      inkHex = dark ? DARK_INK : LIGHT_INK;
    } else {
      dark = theme === 'dark';
      sheet = dark ? DARK_SHEET : PAPER;
      inkHex = dark ? DARK_INK : LIGHT_INK;
    }
    var paper = raw.paper && typeof raw.paper === 'object' && typeof raw.paper.type === 'string' ? raw.paper : null;
    var tile = raw.tile && raw.tile.w > 0 && raw.tile.h > 0 ? { w: Number(raw.tile.w), h: Number(raw.tile.h) } : null;
    /* embed false: shown on the sheet but left out of the file (a picture
     * too big to repeat in every page), unless a fileHref is given. */
    var image = raw.image && isImageDataUrl(raw.image.href) && raw.image.w > 0 && raw.image.h > 0 ?
      { href: raw.image.href, w: Number(raw.image.w), h: Number(raw.image.h), embed: raw.image.embed !== false } : null;
    /* fileHref: a smaller copy of the picture for the files (every page
     * carries it, written at every pause); the sheet shows href. */
    if (image) image.fileHref = isImageDataUrl(raw.image.fileHref) ? raw.image.fileHref : (image.embed ? image.href : null);
    return { theme: theme, background: background, paper: paper, tile: tile, image: image, sheet: sheet, ink: inkHex, dark: dark };
  }

  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  }
  function now() { return Date.now(); }

  /* XML 1.0 has no place for the control characters other than tab, line
   * feed and carriage return, for U+FFFE and U+FFFF, or for half of a
   * surrogate pair (the u flag makes the class match only lone halves). One
   * of them in a saved file makes the whole file unreadable: by the editor,
   * and as an <img> on the map. Word and PowerPoint put a vertical tab on
   * the clipboard for a soft line break, so they do arrive, by paste. */
  var NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/gu;
  var LINE_LIKE = /[\u000b\u000c\u0085\u2028\u2029]/g;

  /* What a person wrote, as it can be kept: line breaks of every kind made
   * plain line feeds (a vertical tab was meant as one), the rest of what
   * XML refuses taken out. */
  function cleanText(s) {
    return String(s).replace(/\r\n?/g, '\n').replace(LINE_LIKE, '\n').replace(NOT_XML, '');
  }

  function escapeXml(s) {
    return String(s).replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Element content needs no quotes escaped, and the scene JSON is mostly
   * quotes: escaping them would make the metadata half as big again. The
   * characters XML refuses are dropped here too, whatever the caller did:
   * this is the last thing between a string and the file. */
  function escapeText(s) {
    return String(s).replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* The five entities XML predefines and numeric references: enough to read
   * back what escapeText and escapeXml wrote, for the repair of a file the
   * XML parser refuses. */
  function unescapeXml(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|lt|gt|quot|apos|amp);/gi, function (whole, name) {
      var low = name.toLowerCase();
      if (low === 'lt') return '<';
      if (low === 'gt') return '>';
      if (low === 'quot') return '"';
      if (low === 'apos') return '\'';
      if (low === 'amp') return '&';
      var code = low.charAt(1) === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
      try { return String.fromCodePoint(code); } catch (err) { return ''; }
    });
  }

  function validPage(p) {
    if (!p || typeof p !== 'object') return null;
    var w = Number(p.w);
    var h = Number(p.h);
    return finite(w) && finite(h) && w > 0 && h > 0 ? { w: w, h: h } : null;
  }

  /* Ids need only be unique inside one drawing; crypto when it is there. */
  function uid() {
    var out = '';
    var bytes = new Uint8Array(10);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < bytes.length; j++) out += (bytes[j] % 36).toString(36);
    return 'k' + out;
  }

  /* UTF-8 text to base64, in chunks: String.fromCharCode.apply has an
   * argument limit, and a big old drawing is hundreds of kilobytes. */
  function base64Utf8(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  var seq = 0;
  function nextVersion() { return ++seq; }

  /* Every change is a new object with a new version: undo keeps the old
   * one, caches keyed by the object stay right, and dirty tracking is a
   * comparison of versions. */
  function changed(el, changes) {
    var out = {};
    var k;
    for (k in el) if (Object.prototype.hasOwnProperty.call(el, k)) out[k] = el[k];
    for (k in changes) if (Object.prototype.hasOwnProperty.call(changes, k)) out[k] = changes[k];
    out.version = nextVersion();
    return out;
  }

  /* ================================================================ freehand
   *
   * A reimplementation of perfect-freehand (MIT, Copyright (c) 2021 Steve
   * Ruiz, https://github.com/steveruiz/perfect-freehand): the input points
   * are streamlined (each one pulled part of the way towards the last), then
   * walked to lay an outline on either side at a radius that follows the
   * pressure (or, for a mouse or a finger, a pressure simulated from speed),
   * with round caps at sharp turns and at the ends. The outline is a polygon,
   * drawn as one filled path through the midpoints of its sides. Tapers are
   * left out: nothing here uses them. */

  var RATE_OF_PRESSURE_CHANGE = 0.275;
  var FIXED_PI = Math.PI + 0.0001;

  function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function vSub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function vMul(a, n) { return [a[0] * n, a[1] * n]; }
  function vPer(a) { return [a[1], -a[0]]; }
  function vNeg(a) { return [-a[0], -a[1]]; }
  function vDot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function vLen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
  function vUni(a) { var l = vLen(a); return l ? [a[0] / l, a[1] / l] : [0, 0]; }
  function vDist(a, b) { return Math.sqrt(sq(a[0] - b[0]) + sq(a[1] - b[1])); }
  function vDist2(a, b) { return sq(a[0] - b[0]) + sq(a[1] - b[1]); }
  function vLrp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function vPrj(a, b, c) { return vAdd(a, vMul(b, c)); }
  function vRotAround(a, c, r) {
    var s = Math.sin(r);
    var co = Math.cos(r);
    var px = a[0] - c[0];
    var py = a[1] - c[1];
    return [px * co - py * s + c[0], px * s + py * co + c[1]];
  }

  /* The streamlined points, each with its pressure, its direction from the
   * previous one, and how far along the line it is. */
  function strokePoints(input, o) {
    var streamline = o.streamline == null ? 0.5 : o.streamline;
    var size = o.size || 16;
    var complete = !!o.last;
    if (!input || !input.length) return [];
    var t = 0.15 + (1 - streamline) * 0.85;
    var pts = input.map(function (p) { return [p[0], p[1], p[2] == null ? 0.5 : p[2]]; });
    /* Two points make a line too short to streamline: fill it in, so the
     * pressure walk has something to walk. */
    if (pts.length === 2) {
      var last = pts[1];
      var first = pts[0];
      pts = [first];
      for (var f = 1; f < 5; f++) {
        var q = vLrp(first, last, f / 4);
        pts.push([q[0], q[1], first[2] + (last[2] - first[2]) * f / 4]);
      }
    }
    if (pts.length === 1) pts.push([pts[0][0] + 1, pts[0][1] + 1, pts[0][2]]);

    var out = [{ point: [pts[0][0], pts[0][1]], pressure: pts[0][2] >= 0 ? pts[0][2] : 0.25, vector: [1, 1], distance: 0, runningLength: 0 }];
    var reached = false;
    var running = 0;
    var prev = out[0];
    var max = pts.length - 1;
    for (var i = 1; i < pts.length; i++) {
      var point = complete && i === max ? [pts[i][0], pts[i][1]] : vLrp(prev.point, pts[i], t);
      if (point[0] === prev.point[0] && point[1] === prev.point[1]) continue;
      var distance = vDist(point, prev.point);
      running += distance;
      /* The first few pixels of a stroke are mostly the hand settling:
       * skipped until the line is as long as the nib is wide. */
      if (i < max && !reached) {
        if (running < size) continue;
        reached = true;
      }
      prev = { point: point, pressure: pts[i][2] >= 0 ? pts[i][2] : 0.5, vector: vUni(vSub(prev.point, point)), distance: distance, runningLength: running };
      out.push(prev);
    }
    out[0].vector = out[1] ? out[1].vector : [0, 0];
    return out;
  }

  function strokeRadius(size, thinning, pressure) {
    return size * (0.5 - thinning * (0.5 - pressure));
  }

  /* The outline polygon of streamlined points. */
  function strokeOutlinePoints(points, o) {
    var size = o.size || 16;
    var smoothing = o.smoothing == null ? 0.5 : o.smoothing;
    var thinning = o.thinning == null ? 0.5 : o.thinning;
    var simulate = o.simulatePressure !== false;
    var capStart = o.cap !== false;
    var capEnd = o.cap !== false;
    if (!points.length || size <= 0) return [];

    var total = points[points.length - 1].runningLength;
    var minDistance = Math.pow(size * smoothing, 2);
    var left = [];
    var right = [];

    var prevPressure = points.slice(0, 10).reduce(function (acc, cur) {
      var pressure = cur.pressure;
      if (simulate) {
        var sp = Math.min(1, cur.distance / size);
        var rp = Math.min(1, 1 - sp);
        pressure = Math.min(1, acc + (rp - acc) * (sp * RATE_OF_PRESSURE_CHANGE));
      }
      return (acc + pressure) / 2;
    }, points[0].pressure);

    var radius = strokeRadius(size, thinning, points[points.length - 1].pressure);
    var firstRadius;
    var prevVector = points[0].vector;
    var pl = points[0].point;
    var pr = pl;
    var tl = pl;
    var tr = pr;
    var prevSharp = false;

    for (var i = 0; i < points.length; i++) {
      var sp2 = points[i];
      var pressure = sp2.pressure;
      var point = sp2.point;
      var vector = sp2.vector;
      if (i < points.length - 1 && total - sp2.runningLength < 3) continue;

      if (thinning) {
        if (simulate) {
          var s1 = Math.min(1, sp2.distance / size);
          var r1 = Math.min(1, 1 - s1);
          pressure = Math.min(1, prevPressure + (r1 - prevPressure) * (s1 * RATE_OF_PRESSURE_CHANGE));
        }
        radius = strokeRadius(size, thinning, pressure);
      } else {
        radius = size / 2;
      }
      if (firstRadius === undefined) firstRadius = radius;
      radius = Math.max(0.01, radius);

      var nextVector = (i < points.length - 1 ? points[i + 1] : points[i]).vector;
      var nextDpr = i < points.length - 1 ? vDot(vector, nextVector) : 1.0;
      var prevDpr = vDot(vector, prevVector);
      var sharp = prevDpr < 0 && !prevSharp;
      var nextSharp = nextDpr < 0;

      /* A turn sharper than a right angle: a half circle of points around
       * it, so the outline does not fold over itself. */
      if (sharp || nextSharp) {
        var offset = vMul(vPer(prevVector), radius);
        for (var step = 1 / 13, k = 0; k <= 1; k += step) {
          tl = vRotAround(vSub(point, offset), point, FIXED_PI * k);
          left.push(tl);
          tr = vRotAround(vAdd(point, offset), point, FIXED_PI * -k);
          right.push(tr);
        }
        pl = tl;
        pr = tr;
        if (nextSharp) prevSharp = true;
        continue;
      }
      prevSharp = false;

      if (i === points.length - 1) {
        var end = vMul(vPer(vector), radius);
        left.push(vSub(point, end));
        right.push(vAdd(point, end));
        continue;
      }

      var off = vMul(vPer(vLrp(nextVector, vector, nextDpr)), radius);
      tl = vSub(point, off);
      if (i <= 1 || vDist2(pl, tl) > minDistance) {
        left.push(tl);
        pl = tl;
      }
      tr = vAdd(point, off);
      if (i <= 1 || vDist2(pr, tr) > minDistance) {
        right.push(tr);
        pr = tr;
      }
      prevPressure = pressure;
      prevVector = vector;
    }

    var firstPoint = [points[0].point[0], points[0].point[1]];
    var lastPoint = points.length > 1 ? [points[points.length - 1].point[0], points[points.length - 1].point[1]] : vAdd(points[0].point, [1, 1]);
    var startCap = [];
    var endCap = [];

    /* One point: a dot. */
    if (points.length === 1) {
      var start = vPrj(firstPoint, vUni(vPer(vSub(firstPoint, lastPoint))), -(firstRadius || radius));
      var dot = [];
      for (var st = 1 / 13, d = st; d <= 1; d += st) dot.push(vRotAround(start, firstPoint, FIXED_PI * 2 * d));
      return dot;
    }

    if (capStart) {
      for (var cs = 1 / 13, c = cs; c <= 1; c += cs) startCap.push(vRotAround(right[0], firstPoint, FIXED_PI * c));
    } else {
      var corners = vSub(left[0], right[0]);
      var oa = vMul(corners, 0.5);
      var ob = vMul(corners, 0.51);
      startCap.push(vSub(firstPoint, oa), vSub(firstPoint, ob), vAdd(firstPoint, ob), vAdd(firstPoint, oa));
    }

    var direction = vPer(vNeg(points[points.length - 1].vector));
    if (capEnd) {
      var from = vPrj(lastPoint, direction, radius);
      for (var ce = 1 / 29, e = ce; e < 1; e += ce) endCap.push(vRotAround(from, lastPoint, FIXED_PI * 3 * e));
    } else {
      endCap.push(vAdd(lastPoint, vMul(direction, radius)), vAdd(lastPoint, vMul(direction, radius * 0.99)),
        vSub(lastPoint, vMul(direction, radius * 0.99)), vSub(lastPoint, vMul(direction, radius)));
    }

    return left.concat(endCap, right.reverse(), startCap);
  }

  /* The outline of a stroke: raw points [x, y, pressure] to polygon. */
  function strokeOutline(points, o) {
    o = o || {};
    return strokeOutlinePoints(strokePoints(points, o), o);
  }

  function num1(n) { var r = Math.round(n * 10) / 10; return String(r === 0 ? 0 : r); }

  /* A polygon as one closed path of quadratic curves through the midpoints
   * of its sides, each vertex the control point of its curve: smooth, and a
   * fraction of the size of a polyline. Written with T after the first
   * curve: a T reflects the last control point about the point it starts
   * from, and the reflection of a vertex about the midpoint of the side it
   * starts is exactly the next vertex - the same curves for half the
   * numbers. Two decimals on screen, where the sheet can be zoomed eight
   * times; one in the file, which is looked at near its own size and where
   * the outlines are most of the bytes. */
  function outlinePath(poly, decimals) {
    var n = poly.length;
    if (!n) return '';
    var f = decimals === 1 ? num1 : num;
    function mid(i) {
      var a = poly[i % n];
      var b = poly[(i + 1) % n];
      return f((a[0] + b[0]) / 2) + ' ' + f((a[1] + b[1]) / 2);
    }
    var d = 'M' + f(poly[0][0]) + ' ' + f(poly[0][1]) + 'Q' + f(poly[0][0]) + ' ' + f(poly[0][1]) + ' ' + mid(0);
    if (n > 1) {
      d += 'T';
      for (var i = 1; i < n; i++) d += (i > 1 ? ' ' : '') + mid(i);
    }
    return d + 'Z';
  }

  /* A mouse or a finger has no pressure, and perfect-freehand simulates one
   * from speed: at the speed a hand sketches, that makes every quick line a
   * hairline under the nib the slider promised. Simulated strokes thin half
   * as much (the file keeps the instrument's number and `sim`, so this is
   * part of how a stroke is drawn, not a change to it). */
  function strokeOptions(el, last) {
    return {
      size: el.size,
      thinning: el.sim ? el.thinning / 2 : el.thinning,
      smoothing: el.smoothing,
      streamline: el.streamline,
      simulatePressure: el.sim,
      cap: el.cap,
      last: last !== false
    };
  }

  /* The outline of a finished stroke is computed once per element object
   * (elements never change in place); the path for the screen and the one
   * for the file are written from it. A stroke still being drawn is not
   * finished, and is outlined afresh each frame. */
  var outlineCache = new WeakMap();
  var pathCache = new WeakMap();
  var filePathCache = new WeakMap();

  function strokeD(el, mode) {
    if (mode === 'live') return outlinePath(strokeOutline(el.points, strokeOptions(el, false)));
    var cache = mode === 'file' ? filePathCache : pathCache;
    var known = cache.get(el);
    if (known === undefined) {
      var poly = outlineCache.get(el);
      if (!poly) {
        poly = strokeOutline(el.points, strokeOptions(el, true));
        outlineCache.set(el, poly);
      }
      known = outlinePath(poly, mode === 'file' ? 1 : 2);
      cache.set(el, known);
    }
    return known;
  }

  /* ================================================================ elements */

  function penById(id) {
    for (var i = 0; i < PENS.length; i++) if (PENS[i].id === id) return PENS[i];
    return null;
  }

  function makeStroke(points, style) {
    return {
      id: style.id || uid(),
      type: 'stroke',
      version: nextVersion(),
      pen: style.pen || 'pen',
      color: style.color,
      size: style.size,
      opacity: style.opacity,
      thinning: style.thinning,
      smoothing: style.smoothing,
      streamline: style.streamline,
      cap: style.cap !== false,
      blend: style.blend === 'multiply' ? 'multiply' : 'normal',
      sim: !!style.sim,
      points: points
    };
  }

  function makeShape(type, a, b, style) {
    if (type === 'line' || type === 'arrow') {
      return { id: style.id || uid(), type: type, version: nextVersion(), points: [[a[0], a[1]], [b[0], b[1]]], color: style.color, width: style.width };
    }
    return {
      id: style.id || uid(), type: type, version: nextVersion(),
      x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]),
      color: style.color, width: style.width, fill: style.fill || 'none'
    };
  }

  /* ---------- text measuring ---------- */

  var measureCtx = null;
  var metricsCache = {};

  function context2d() {
    if (!measureCtx) {
      try { measureCtx = document.createElement('canvas').getContext('2d'); } catch (err) { measureCtx = null; }
    }
    return measureCtx;
  }

  /* Ascent and descent of the font, as fractions of its size: where the
   * first baseline falls inside a line box of LINE_HEIGHT, the same way the
   * textarea that edits the text lays it out. */
  function fontMetrics() {
    if (metricsCache.font) return metricsCache.font;
    var ctx = context2d();
    var asc = 0.8;
    var desc = 0.2;
    if (ctx) {
      ctx.font = '100px ' + FONT;
      var m = ctx.measureText('Hg');
      if (m.fontBoundingBoxAscent > 0) {
        asc = m.fontBoundingBoxAscent / 100;
        desc = (m.fontBoundingBoxDescent || 20) / 100;
      } else if (m.actualBoundingBoxAscent > 0) {
        asc = Math.max(0.7, m.actualBoundingBoxAscent / 100 + 0.08);
        desc = Math.max(0.15, (m.actualBoundingBoxDescent || 20) / 100);
      }
    }
    metricsCache.font = { asc: asc, desc: desc };
    return metricsCache.font;
  }

  function measureText(text, size) {
    var lines = String(text).split('\n');
    var ctx = context2d();
    var w = 0;
    for (var i = 0; i < lines.length; i++) {
      var lw;
      if (ctx) {
        ctx.font = size + 'px ' + FONT;
        lw = ctx.measureText(lines[i]).width;
      } else {
        lw = lines[i].length * size * 0.55;
      }
      if (lw > w) w = lw;
    }
    return { w: Math.max(w, size * 0.3), h: lines.length * size * LINE_HEIGHT };
  }

  function makeText(x, y, text, style) {
    var m = measureText(text, style.size);
    return { id: style.id || uid(), type: 'text', version: nextVersion(), x: x, y: y, text: text, size: style.size, color: style.color, w: m.w, h: m.h };
  }

  /* ---------- reading elements back from a file, never trusting them ---------- */

  function pointList(raw, withPressure, limit) {
    if (!Array.isArray(raw) || !raw.length || raw.length > limit) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) return null;
      if (withPressure) out.push([p[0], p[1], finite(p[2]) ? clamp(p[2], 0, 1) : 0.5]);
      else out.push([p[0], p[1]]);
    }
    return out;
  }

  function normalizeElement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : uid();
    var color = cleanColor(raw.color, INK);
    var type = raw.type;
    if (type === 'stroke') {
      var pts = pointList(raw.points, true, 200000);
      if (!pts) return null;
      /* A simulated pressure starts from the middle: whatever a file says,
       * the stroke draws as it did when it was saved. */
      if (raw.sim) pts.forEach(function (p) { p[2] = 0.5; });
      var pen = penById(raw.pen) || PENS[0];
      return makeStroke(pts, {
        id: id, pen: pen.id, color: color,
        size: finite(raw.size) && raw.size > 0 ? clamp(raw.size, 0.1, 400) : pen.size,
        opacity: finite(raw.opacity) ? clamp(raw.opacity, 0.02, 1) : pen.opacity,
        thinning: finite(raw.thinning) ? clamp(raw.thinning, -1, 1) : pen.thinning,
        smoothing: finite(raw.smoothing) ? clamp(raw.smoothing, 0, 1) : pen.smoothing,
        streamline: finite(raw.streamline) ? clamp(raw.streamline, 0, 1) : pen.streamline,
        cap: raw.cap !== false,
        blend: raw.blend === 'multiply' ? 'multiply' : 'normal',
        sim: !!raw.sim
      });
    }
    var width = finite(raw.width) && raw.width > 0 ? clamp(raw.width, 0.1, 200) : WIDTHS.m;
    if (type === 'line' || type === 'arrow') {
      var lp = pointList(raw.points, false, 2);
      if (!lp || lp.length !== 2) return null;
      return { id: id, type: type, version: nextVersion(), points: lp, color: color, width: width };
    }
    if (type === 'rect' || type === 'ellipse' || type === 'diamond') {
      if (!finite(raw.x) || !finite(raw.y) || !finite(raw.w) || !finite(raw.h)) return null;
      return {
        id: id, type: type, version: nextVersion(),
        x: raw.w < 0 ? raw.x + raw.w : raw.x, y: raw.h < 0 ? raw.y + raw.h : raw.y, w: Math.abs(raw.w), h: Math.abs(raw.h),
        color: color, width: width, fill: FILLS.indexOf(raw.fill) >= 0 ? raw.fill : 'none'
      };
    }
    if (type === 'image') {
      /* The picture's bytes are in the file's markup (an <image> with the
       * element's id), handed over by the reader as raw.href: they are
       * written once. */
      if (!finite(raw.x) || !finite(raw.y) || !finite(raw.w) || !finite(raw.h) || !(raw.w > 0) || !(raw.h > 0)) return null;
      if (!isImageDataUrl(raw.href) || raw.href.length > IMAGE_MAX_CHARS) return null;
      return {
        id: id, type: 'image', version: nextVersion(),
        x: raw.x, y: raw.y, w: Math.min(raw.w, IMAGE_MAX_SIZE), h: Math.min(raw.h, IMAGE_MAX_SIZE),
        href: raw.href, locked: raw.locked === true
      };
    }
    if (type === 'text') {
      if (!finite(raw.x) || !finite(raw.y) || typeof raw.text !== 'string') return null;
      /* Cut first and cleaned after: a cut through a surrogate pair leaves
       * half of it, which the cleaning takes out. */
      var text = cleanText(raw.text.slice(0, 20000));
      if (!text.trim()) return null;
      var size = finite(raw.size) && raw.size > 0 ? clamp(raw.size, 2, 512) : TEXT_SIZES.m;
      var el = makeText(raw.x, raw.y, text, { id: id, size: size, color: color });
      /* The box it was measured with on the machine that wrote it: the
       * same box everywhere, whatever fonts this machine has. */
      if (finite(raw.w) && raw.w > 0) el.w = raw.w;
      if (finite(raw.h) && raw.h > 0) el.h = raw.h;
      return el;
    }
    return null;
  }

  /* An element as it is written into the file: rounded, and without the
   * version, which belongs to this session. */
  function elementJson(el) {
    var out = { id: el.id, type: el.type };
    if (el.type === 'stroke') {
      out.pen = el.pen;
      out.color = el.color;
      out.size = round2(el.size);
      out.opacity = round3(el.opacity);
      out.thinning = round3(el.thinning);
      out.smoothing = round3(el.smoothing);
      out.streamline = round3(el.streamline);
      out.cap = el.cap;
      out.blend = el.blend;
      out.sim = el.sim;
      /* A simulated pressure is worked out from the points: storing it
       * would be a third more bytes saying nothing. */
      out.points = el.sim ?
        el.points.map(function (p) { return [round2(p[0]), round2(p[1])]; }) :
        el.points.map(function (p) { return [round2(p[0]), round2(p[1]), round3(p[2])]; });
    } else if (el.type === 'line' || el.type === 'arrow') {
      out.points = el.points.map(function (p) { return [round2(p[0]), round2(p[1])]; });
      out.color = el.color;
      out.width = round2(el.width);
    } else if (el.type === 'image') {
      out.x = round2(el.x);
      out.y = round2(el.y);
      out.w = round2(el.w);
      out.h = round2(el.h);
      if (el.locked) out.locked = true;
    } else if (el.type === 'text') {
      out.x = round2(el.x);
      out.y = round2(el.y);
      out.text = el.text;
      out.size = round2(el.size);
      out.color = el.color;
      out.w = round2(el.w);
      out.h = round2(el.h);
    } else {
      out.x = round2(el.x);
      out.y = round2(el.y);
      out.w = round2(el.w);
      out.h = round2(el.h);
      out.color = el.color;
      out.width = round2(el.width);
      out.fill = el.fill;
    }
    return out;
  }

  /* ================================================================ geometry, in scene coordinates
   *
   * Ported from the old eraser (an earlier version): an element is the line it
   * is drawn along - a stroke's points, a shape's outline - and the eraser
   * (or a tap) touches it when it comes within its reach plus half the ink. */

  function pointsBox(points) {
    var box = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p[0] < box[0]) box[0] = p[0];
      if (p[1] < box[1]) box[1] = p[1];
      if (p[0] > box[2]) box[2] = p[0];
      if (p[1] > box[3]) box[3] = p[1];
    }
    return box;
  }

  function toSegment(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = dx * dx + dy * dy;
    var t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.sqrt(sq(p[0] - a[0] - t * dx) + sq(p[1] - a[1] - t * dy));
  }

  function side(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  /* The distance between two segments: nothing if they cross, otherwise the
   * nearest an end of one comes to the other. */
  function between(a, b, c, d) {
    if ((side(c, d, a) > 0) !== (side(c, d, b) > 0) &&
        (side(a, b, c) > 0) !== (side(a, b, d) > 0)) return 0;
    return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
  }

  function inside(p, loop) {
    var hit = false;
    for (var i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      var a = loop[i];
      var b = loop[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }

  /* The two short strokes of an arrow's head, at the end it points to. */
  function arrowHead(el) {
    var a = el.points[0];
    var b = el.points[1];
    var len = vDist(a, b);
    if (len < 0.01) return null;
    var head = Math.min(Math.max(10, el.width * 3.5), len * 0.45);
    var u = [(a[0] - b[0]) / len, (a[1] - b[1]) / len];
    var ang = 0.5;   // about 28 degrees either side
    var c = Math.cos(ang);
    var s = Math.sin(ang);
    var l = [b[0] + (u[0] * c - u[1] * s) * head, b[1] + (u[0] * s + u[1] * c) * head];
    var r = [b[0] + (u[0] * c + u[1] * s) * head, b[1] + (-u[0] * s + u[1] * c) * head];
    return [l, r];
  }

  function ellipseOutline(x, y, w, h, n) {
    var out = [];
    for (var k = 0; k < n; k++) {
      var a = k / n * 2 * Math.PI;
      out.push([x + w / 2 + w / 2 * Math.cos(a), y + h / 2 + h / 2 * Math.sin(a)]);
    }
    return out;
  }

  /* An element as the eraser sees it: the line it is drawn along, whether
   * that line closes, and the box round it. Kept per object: an element
   * never changes in place, so the object is the version. */
  var shapes = new WeakMap();

  function shapeOf(el) {
    var known = shapes.get(el);
    if (known) return known;
    var line;
    var closed = false;
    if (el.type === 'stroke' || el.type === 'line' || el.type === 'arrow') {
      line = el.points.map(function (p) { return [p[0], p[1]]; });
    } else if (el.type === 'ellipse') {
      line = ellipseOutline(el.x, el.y, el.w, el.h, 48);
      closed = true;
    } else if (el.type === 'diamond') {
      line = [[el.x + el.w / 2, el.y], [el.x + el.w, el.y + el.h / 2], [el.x + el.w / 2, el.y + el.h], [el.x, el.y + el.h / 2]];
      closed = true;
    } else {
      line = [[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]];
      closed = true;
    }
    known = { line: line, box: pointsBox(line), closed: closed };
    shapes.set(el, known);
    return known;
  }

  /* How far the ink reaches from its line. */
  function inkOf(el) {
    if (el.type === 'stroke') return el.size / 2;
    if (el.type === 'text') return 0;
    return (el.width || 0) / 2;
  }

  /* A shape with no fill is its outline; text and filled shapes are the
   * whole of their box. */
  function solid(el) {
    if (el.type === 'text' || el.type === 'image') return true;
    if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'diamond') return el.fill !== 'none';
    return false;
  }

  function near(box, a, b, reach) {
    return Math.min(a[0], b[0]) - reach <= box[2] && Math.max(a[0], b[0]) + reach >= box[0] &&
      Math.min(a[1], b[1]) - reach <= box[3] && Math.max(a[1], b[1]) + reach >= box[1];
  }

  /* Does a pointer swept from a to b, `reach` wide on each side, touch the
   * element's ink. */
  function touches(el, a, b, reach) {
    var shape = shapeOf(el);
    var r = reach + inkOf(el);
    if (!near(shape.box, a, b, r)) return false;
    var line = shape.line;
    if (line.length === 1) return toSegment(line[0], a, b) <= r;
    var last = shape.closed ? line.length : line.length - 1;
    for (var i = 0; i < last; i++) {
      if (between(line[i], line[(i + 1) % line.length], a, b) <= r) return true;
    }
    if (el.type === 'arrow') {
      var head = arrowHead(el);
      if (head && (between(head[0], el.points[1], a, b) <= r || between(head[1], el.points[1], a, b) <= r)) return true;
    }
    return shape.closed && solid(el) && (inside(a, line) || inside(b, line));
  }

  function within(el, loop) {
    var line = shapeOf(el).line;
    for (var i = 0; i < line.length; i++) if (!inside(line[i], loop)) return false;
    return true;
  }

  function lengthOf(run) {
    var total = 0;
    for (var i = 1; i < run.length; i++) total += vDist(run[i].p, run[i - 1].p);
    return total;
  }

  /* A stroke with every point `gone` says is gone taken out. Null when
   * nothing of it was gone, otherwise the pieces that are left - none, when
   * all of it was.
   *
   * The points of a stroke can be far apart - a quick line is a handful of
   * them - so the stroke is filled in every `step` to find where a cut falls,
   * and the pieces keep their own points plus the one at each cut: the ink
   * that stays is drawn exactly as it was drawn. A piece shorter than half
   * the nib would be drawn as a dot bigger than itself, and is dropped as
   * the crumb it is. The first piece keeps the stroke's id. */
  function cut(el, gone, step) {
    var line = el.points;
    var dense = [];
    for (var i = 0; i < line.length; i++) {
      if (i) {
        var a = line[i - 1];
        var b = line[i];
        var n = Math.ceil(vDist(a, b) / step);
        for (var k = 1; k < n; k++) {
          dense.push({
            p: [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n],
            pr: a[2] + (b[2] - a[2]) * k / n,
            own: false
          });
        }
      }
      dense.push({ p: [line[i][0], line[i][1]], pr: line[i][2], own: true });
    }

    var runs = [];
    var run = null;
    var hit = false;
    for (var j = 0; j < dense.length; j++) {
      if (gone(dense[j].p)) {
        hit = true;
        run = null;
      } else {
        if (!run) runs.push(run = []);
        run.push(dense[j]);
      }
    }
    if (!hit) return null;

    var crumb = inkOf(el);
    var kept = runs.map(function (r) {
      return r.filter(function (d, at) { return d.own || at === 0 || at === r.length - 1; });
    }).filter(function (r) { return r.length > 1 && lengthOf(r) >= crumb; });
    return kept.map(function (r, at) {
      return changed(el, {
        id: at === 0 ? el.id : uid(),
        points: r.map(function (d) { return [d.p[0], d.p[1], d.pr]; })
      });
    });
  }

  /* The box an element covers on the sheet, ink included. */
  var boxes = new WeakMap();
  function boundsOf(el) {
    var known = boxes.get(el);
    if (known) return known;
    var box;
    if (el.type === 'stroke') {
      box = pointsBox(el.points);
      var reach = el.size * (0.5 + 0.5 * Math.max(0, el.thinning)) + 0.5;
      box = [box[0] - reach, box[1] - reach, box[2] + reach, box[3] + reach];
    } else if (el.type === 'line' || el.type === 'arrow') {
      var pts = el.points.slice();
      var head = el.type === 'arrow' ? arrowHead(el) : null;
      if (head) pts = pts.concat(head);
      box = pointsBox(pts);
      var w = el.width / 2;
      box = [box[0] - w, box[1] - w, box[2] + w, box[3] + w];
    } else if (el.type === 'text' || el.type === 'image') {
      box = [el.x, el.y, el.x + el.w, el.y + el.h];
    } else {
      var half = el.width / 2;
      box = [el.x - half, el.y - half, el.x + el.w + half, el.y + el.h + half];
    }
    boxes.set(el, box);
    return box;
  }

  function unionBox(list) {
    var box = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b) continue;
      if (!box) box = b.slice();
      else {
        if (b[0] < box[0]) box[0] = b[0];
        if (b[1] < box[1]) box[1] = b[1];
        if (b[2] > box[2]) box[2] = b[2];
        if (b[3] > box[3]) box[3] = b[3];
      }
    }
    return box;
  }

  function contentBox(elements, background) {
    var list = elements.map(boundsOf);
    if (background) list.push([background.x, background.y, background.x + background.w, background.y + background.h]);
    return unionBox(list);
  }

  /* The box of an element's geometry, without its ink: what a resize
   * scales. The ink (half a nib, half a line) stays the same width. */
  function geometryOf(el) {
    if (el.type === 'stroke' || el.type === 'line' || el.type === 'arrow') return pointsBox(el.points);
    return [el.x, el.y, el.x + el.w, el.y + el.h];
  }

  function boxInside(box, outer) {
    return box[0] >= outer[0] && box[1] >= outer[1] && box[2] <= outer[2] && box[3] <= outer[3];
  }

  /* ---------- moving and resizing ---------- */

  function translateEl(el, dx, dy) {
    if (el.type === 'stroke') return changed(el, { points: el.points.map(function (p) { return [p[0] + dx, p[1] + dy, p[2]]; }) });
    if (el.type === 'line' || el.type === 'arrow') return changed(el, { points: el.points.map(function (p) { return [p[0] + dx, p[1] + dy]; }) });
    return changed(el, { x: el.x + dx, y: el.y + dy });
  }

  /* Scaled about (ax, ay). A stroke keeps its nib and a shape its line
   * width, the way a drawing program does it: what grows is the drawing,
   * not the pen. Text grows as a whole, by the mean of the two factors. */
  function scaleEl(el, ax, ay, sx, sy) {
    function at(p) { return [ax + (p[0] - ax) * sx, ay + (p[1] - ay) * sy]; }
    if (el.type === 'stroke') {
      return changed(el, { points: el.points.map(function (p) { var q = at(p); return [q[0], q[1], p[2]]; }) });
    }
    if (el.type === 'line' || el.type === 'arrow') return changed(el, { points: el.points.map(at) });
    var a = at([el.x, el.y]);
    var b = at([el.x + el.w, el.y + el.h]);
    if (el.type === 'text') {
      var f = Math.sqrt(Math.abs(sx * sy));
      var size = clamp(el.size * f, 2, 512);
      var g = size / el.size;
      return changed(el, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), size: size, w: el.w * g, h: el.h * g });
    }
    return changed(el, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
  }

  /* ================================================================ the eraser, as data
   *
   * A gesture is a working copy of the scene that the eraser's track is
   * swept over a stretch at a time. Ink cut in part mode is cut at once;
   * everything else is marked, shown faded while the gesture lasts, and
   * goes when it ends. The editor commits the result once, so the whole
   * gesture is one undo step; abandoning it is dropping the copy. */

  function eraseBegin(elements, opts) {
    return {
      mode: ERASER_MODES.indexOf(opts.mode) >= 0 ? opts.mode : 'part',
      zoom: opts.zoom || 1,
      reach: opts.reach,
      before: elements,
      work: elements,
      marked: Object.create(null),
      changed: false,
      loop: []
    };
  }

  /* One stretch of the eraser's track, from a to b. */
  function eraseSweep(g, a, b) {
    var reach = g.reach;
    var step = Math.max(0.5 / g.zoom, reach / 3);
    var next = [];
    for (var i = 0; i < g.work.length; i++) {
      var el = g.work[i];
      /* A picture is never rubbed out by passing over it: it goes with
       * Delete, from the selection. */
      if (g.marked[el.id] || el.type === 'image') { next.push(el); continue; }
      if (el.type === 'stroke' && g.mode === 'part') {
        /* Its own points first, which is cheap: filling a long stroke in
         * every few pixels is for the strokes the eraser has really met. */
        if (!touches(el, a, b, reach)) { next.push(el); continue; }
        var r = reach + inkOf(el);
        var pieces = cut(el, function (p) { return toSegment(p, a, b) <= r; }, step);
        if (!pieces) { next.push(el); continue; }
        g.changed = true;
        Array.prototype.push.apply(next, pieces);
        continue;
      }
      if (touches(el, a, b, reach)) {
        g.marked[el.id] = true;
        g.changed = true;
      }
      next.push(el);
    }
    g.work = next;
  }

  function eraseLoop(g, p) { g.loop.push(p); }

  /* The loop, closed, over everything it could hold: ink inside is cut at
   * the loop, and whatever lies entirely inside goes. */
  function eraseEnclose(g) {
    var loop = g.loop;
    if (loop.length < 3) return;
    var step = 2 / g.zoom;
    var fence = pointsBox(loop);
    var next = [];
    for (var i = 0; i < g.work.length; i++) {
      var el = g.work[i];
      var box = shapeOf(el).box;
      if (g.marked[el.id] || el.type === 'image' || box[2] < fence[0] || box[0] > fence[2] || box[3] < fence[1] || box[1] > fence[3]) {
        next.push(el);
        continue;
      }
      if (el.type === 'stroke') {
        var pieces = cut(el, function (p) { return inside(p, loop); }, step);
        if (!pieces) { next.push(el); continue; }
        g.changed = true;
        Array.prototype.push.apply(next, pieces);
        continue;
      }
      if (within(el, loop)) {
        g.marked[el.id] = true;
        g.changed = true;
      }
      next.push(el);
    }
    g.work = next;
  }

  /* What the gesture leaves, or null when it changed nothing. */
  function eraseResult(g) {
    if (!g.changed) return null;
    return g.work.filter(function (el) { return !g.marked[el.id]; });
  }

  /* A whole gesture at once, for tests and for anyone with a track. */
  function erase(elements, track, opts) {
    var g = eraseBegin(elements, opts);
    if (g.mode === 'area') {
      track.forEach(function (p) { eraseLoop(g, p); });
      eraseEnclose(g);
    } else {
      for (var i = 0; i < track.length; i++) eraseSweep(g, track[i > 0 ? i - 1 : 0], track[i]);
    }
    return eraseResult(g);
  }

  /* ================================================================ drawing elements as SVG
   *
   * One description per element, turned into DOM nodes on screen and into
   * markup in the file: what is on the sheet and what is saved cannot drift
   * apart. */

  function textBaselines(el) {
    var m = fontMetrics();
    var lineBox = el.size * LINE_HEIGHT;
    var first = (lineBox - (m.asc + m.desc) * el.size) / 2 + m.asc * el.size;
    return String(el.text).split('\n').map(function (line, i) {
      return { text: line, y: el.y + i * lineBox + first };
    });
  }

  /* `mode`: 'live' (being drawn), 'file' (being saved), or the screen.
   * `look` (a resolved look) gives the screen its ink and says whether the
   * sheet is dark. The semantic ink is the theme's ink on screen; in the
   * file it is the light paper's, marked mr-ink for ns.paper.themeSvg. A
   * highlighter multiplies on light paper; on dark paper multiplying would
   * make it vanish, so there it screens. */
  function specOf(el, mode, look) {
    var a;
    var semantic = el.color === INK;
    var color = semantic ? (mode === 'file' || !look ? lightInk() : look.ink) : el.color;
    var cls = semantic && mode === 'file' ? 'mr-ink' : null;
    if (el.type === 'stroke') {
      a = { d: strokeD(el, mode), fill: color };
      if (cls) a['class'] = cls;
      if (el.opacity < 1) a.opacity = num(el.opacity);
      if (el.blend === 'multiply') a.style = 'mix-blend-mode:' + (mode !== 'file' && look && look.dark ? 'screen' : 'multiply');
      return { tag: 'path', attrs: a };
    }
    var stroke = { stroke: color, 'stroke-width': num(el.width), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    function withFill(attrs) {
      if (cls) attrs['class'] = cls;
      if (el.fill === 'soft' || el.fill === 'solid') {
        attrs.fill = color;
        if (el.fill === 'soft') attrs['fill-opacity'] = String(SOFT_FILL);
      } else {
        attrs.fill = 'none';
      }
      for (var k in stroke) attrs[k] = stroke[k];
      return attrs;
    }
    if (el.type === 'rect') {
      var rx = Math.min(6, Math.min(el.w, el.h) / 6);
      a = { x: num(el.x), y: num(el.y), width: num(el.w), height: num(el.h) };
      if (rx > 0.5) a.rx = num(rx);
      return { tag: 'rect', attrs: withFill(a) };
    }
    if (el.type === 'ellipse') {
      return { tag: 'ellipse', attrs: withFill({ cx: num(el.x + el.w / 2), cy: num(el.y + el.h / 2), rx: num(el.w / 2), ry: num(el.h / 2) }) };
    }
    if (el.type === 'diamond') {
      var d = 'M' + num(el.x + el.w / 2) + ' ' + num(el.y) + 'L' + num(el.x + el.w) + ' ' + num(el.y + el.h / 2) +
        'L' + num(el.x + el.w / 2) + ' ' + num(el.y + el.h) + 'L' + num(el.x) + ' ' + num(el.y + el.h / 2) + 'Z';
      return { tag: 'path', attrs: withFill({ d: d }) };
    }
    if (el.type === 'line' || el.type === 'arrow') {
      var p = el.points;
      var path = 'M' + num(p[0][0]) + ' ' + num(p[0][1]) + 'L' + num(p[1][0]) + ' ' + num(p[1][1]);
      var head = el.type === 'arrow' ? arrowHead(el) : null;
      if (head) {
        path += 'M' + num(head[0][0]) + ' ' + num(head[0][1]) + 'L' + num(p[1][0]) + ' ' + num(p[1][1]) +
          'L' + num(head[1][0]) + ' ' + num(head[1][1]);
      }
      a = { d: path, fill: 'none' };
      if (cls) a['class'] = cls;
      for (var s in stroke) a[s] = stroke[s];
      return { tag: 'path', attrs: a };
    }
    if (el.type === 'image') {
      a = { x: num(el.x), y: num(el.y), width: num(el.w), height: num(el.h), preserveAspectRatio: 'none', href: el.href };
      if (mode === 'file') { a.id = IMAGE_ID + el.id; a['class'] = 'mr-pic'; }
      return { tag: 'image', attrs: a };
    }
    if (el.type === 'text') {
      a = { 'font-family': FONT, 'font-size': num(el.size), fill: color, 'xml:space': 'preserve', style: 'white-space:pre' };
      if (cls) a['class'] = cls;
      return {
        tag: 'text',
        attrs: a,
        lines: textBaselines(el).map(function (l) { return { x: num(el.x), y: num(l.y), text: l.text }; })
      };
    }
    return null;
  }

  function specMarkup(spec) {
    if (!spec) return '';
    var out = '<' + spec.tag;
    for (var k in spec.attrs) out += ' ' + k + '="' + escapeXml(spec.attrs[k]) + '"';
    if (!spec.lines) return out + '/>';
    out += '>';
    for (var i = 0; i < spec.lines.length; i++) {
      var l = spec.lines[i];
      out += '<tspan x="' + l.x + '" y="' + l.y + '">' + escapeText(l.text) + '</tspan>';
    }
    return out + '</' + spec.tag + '>';
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] == null) continue;
        if (k === 'xml:space') node.setAttributeNS(XML_NS, 'xml:space', attrs[k]);
        else node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function specNode(spec) {
    var node = svgEl(spec.tag, spec.attrs);
    if (spec.lines) {
      for (var i = 0; i < spec.lines.length; i++) {
        var l = spec.lines[i];
        var span = svgEl('tspan', { x: l.x, y: l.y });
        span.textContent = l.text;
        node.appendChild(span);
      }
    }
    return node;
  }

  /* ================================================================ the file */

  /* The saved picture: viewBox round the content (or the page), the light
   * paper, the old drawing (if any) as a picture, then the elements, and
   * the scene itself in the metadata to open it again.
   *   scene.page {w, h}   a notebook page: the viewBox is the page
   *   scene.paper         a paper of ns.paper, drawn under the drawing over
   *                       the whole viewBox (print density, light theme)
   *   scene.sheet         'auto' (the light paper) or a #hex chosen colour
   *   scene.tile {w, h}   the cell of page layouts on an infinite sheet
   * The sheet and the paper carry their classes (mr-sheet, mr-line ...) and
   * the semantic ink mr-ink, so the app can show the file in the dark
   * theme; anywhere else it reads as it is: light paper, dark ink. */
  function serialize(scene) {
    var elements = (scene && scene.elements) || [];
    var bg = (scene && scene.background) || null;
    var page = scene && scene.page && scene.page.w > 0 && scene.page.h > 0 ? { w: Number(scene.page.w), h: Number(scene.page.h) } : null;
    var sheet = scene && isHex(scene.sheet) ? scene.sheet.toLowerCase() : 'auto';
    var x;
    var y;
    var w;
    var h;
    if (page) {
      x = 0; y = 0; w = round2(page.w); h = round2(page.h);
    } else {
      var box = contentBox(elements, bg);
      if (box) {
        x = Math.floor(box[0] - PAD);
        y = Math.floor(box[1] - PAD);
        w = Math.ceil(box[2] + PAD) - x;
        h = Math.ceil(box[3] + PAD) - y;
      } else {
        x = 0; y = 0; w = 320; h = 200;
      }
    }
    var format = elements.some(function (el) { return el.type === 'image'; }) ? IMAGE_FORMAT : FORMAT;
    var meta = { v: format, elements: elements.map(elementJson) };
    if (page) meta.page = { w: w, h: h };
    if (bg) meta.background = { x: round2(bg.x), y: round2(bg.y), w: round2(bg.w), h: round2(bg.h) };
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + x + ' ' + y + ' ' + w + ' ' + h +
      '" width="' + w + '" height="' + h + '" data-mindroot-ink="' + format + '">';
    out += '<metadata id="' + META_ID + '">' + escapeText(JSON.stringify(meta)) + '</metadata>';
    out += paperMarkup(scene && scene.paper, { x: x, y: y, w: w, h: h }, sheet, !!page, scene && scene.tile, scene && scene.image);
    if (bg) {
      out += '<image id="' + BG_ID + '" x="' + num(bg.x) + '" y="' + num(bg.y) + '" width="' + num(bg.w) + '" height="' + num(bg.h) +
        '" preserveAspectRatio="none" href="' + escapeXml(bg.href) + '"/>';
    }
    for (var i = 0; i < elements.length; i++) out += specMarkup(specOf(elements[i], 'file'));
    return out + '</svg>';
  }

  /* The paper of a file: ns.paper's drawing when a paper is named and the
   * module is there, else the plain sheet. Never fails a save: a paper that
   * cannot be drawn leaves the plain sheet. */
  function paperMarkup(paper, r, sheet, isPage, tile, image) {
    var P = paperModule();
    var out = '';
    if (paper && P && typeof P.patternSvg === 'function') {
      try {
        var o = { x: r.x, y: r.y, w: r.w, h: r.h, mode: isPage ? 'page' : 'infinite', print: true, theme: 'light', background: sheet, scale: 1 };
        if (tile && tile.w > 0 && tile.h > 0) o.tile = { w: tile.w, h: tile.h };
        out = P.patternSvg(paper, o) || '';
      } catch (err) { warn('the paper could not be drawn into the file', err); out = ''; }
    }
    if (!out) out = '<rect class="mr-sheet" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + (sheet !== 'auto' ? sheet : PAPER) + '"/>';
    return out + imageMarkup(image, r, isPage, 'mrbg');
  }

  /* A picture chosen as the paper (a notebook's imported background): on a
   * page it is shown whole, centred; on the infinite sheet it repeats at
   * its own size from the origin, like any paper. `image` is a data URL
   * with its size, so the file stays self-contained. */
  function imageMarkup(image, r, isPage, idBase) {
    if (!image || !isImageDataUrl(image.href) || !(image.w > 0) || !(image.h > 0)) return '';
    var href = escapeXml(image.href);
    if (isPage) {
      return '<image class="mr-image" x="' + num(r.x) + '" y="' + num(r.y) + '" width="' + num(r.w) + '" height="' + num(r.h) +
        '" preserveAspectRatio="xMidYMid meet" href="' + href + '"/>';
    }
    var id = idBase + uid();
    return '<defs><pattern id="' + id + '" patternUnits="userSpaceOnUse" x="0" y="0" width="' + num(image.w) + '" height="' + num(image.h) + '">' +
      '<image width="' + num(image.w) + '" height="' + num(image.h) + '" href="' + href + '"/></pattern></defs>' +
      '<rect class="mr-image" x="' + num(r.x) + '" y="' + num(r.y) + '" width="' + num(r.w) + '" height="' + num(r.h) + '" fill="url(#' + id + ')"/>';
  }

  /* The size an SVG says it is: width and height when they are plain
   * numbers (or pixels), the viewBox otherwise. */
  function svgSize(root) {
    function length(v) {
      var m = /^\s*([0-9.]+)\s*(px)?\s*$/.exec(v || '');
      return m ? parseFloat(m[1]) : NaN;
    }
    var w = length(root.getAttribute('width'));
    var h = length(root.getAttribute('height'));
    var vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
    if (!(w > 0) && vb.length === 4 && vb[2] > 0) w = vb[2];
    if (!(h > 0) && vb.length === 4 && vb[3] > 0) h = vb[3];
    if (!(w > 0) || !(h > 0)) { w = 800; h = 600; }
    return { w: Math.min(w, 1e5), h: Math.min(h, 1e5) };
  }

  function isImageDataUrl(href) {
    return typeof href === 'string' && /^data:image\/(svg\+xml|png|jpeg|jpg|gif|webp)[;,]/i.test(href);
  }

  function foreignBackground(text, root) {
    var size = svgSize(root);
    return { href: 'data:image/svg+xml;base64,' + base64Utf8(text), x: 0, y: 0, w: size.w, h: size.h };
  }

  /* The scene of a drawing of ours, from its metadata JSON: every element
   * checked and rebuilt, a repeated id renamed, and the background taken
   * only when the file holds it as an image data URL. */
  function readScene(data, result, bgHref, text, imageHref) {
    var seen = Object.create(null);
    var legacy = isLegacy(data, text);
    data.elements.forEach(function (raw) {
      var c = legacy && raw && typeof raw === 'object' && typeof raw.color === 'string' ? raw.color.toLowerCase() : null;
      if (c === OLD_BLACK || c === OLD_GRAPHITE) {
        raw = Object.assign({}, raw, { color: INK });
      }
      if (raw && typeof raw === 'object' && raw.type === 'image') {
        /* The picture's bytes are the <image> of the file that carries the
         * element's id (taken before a repeated id is renamed below). */
        var rid = typeof raw.id === 'string' ? raw.id : '';
        raw = Object.assign({}, raw, { href: typeof imageHref === 'function' ? imageHref(rid) : null });
      }
      var el = normalizeElement(raw);
      if (!el) return;
      if (seen[el.id]) el.id = uid();
      seen[el.id] = true;
      result.elements.push(el);
    });
    var bgData = data.background;
    if (bgData && finite(bgData.x) && finite(bgData.y) && finite(bgData.w) && finite(bgData.h) && bgData.w > 0 && bgData.h > 0 && isImageDataUrl(bgHref)) {
      result.background = { href: bgHref, x: bgData.x, y: bgData.y, w: bgData.w, h: bgData.h };
    }
    var pg = data.page;
    if (pg && finite(pg.w) && finite(pg.h) && pg.w > 0 && pg.h > 0) result.page = { w: pg.w, h: pg.h };
    result.ok = true;
    result.kind = 'ink';
    return result;
  }

  /* A file written before the semantic ink (no page, no mr-sheet or
   * mr-ink mark anywhere in it) drew with the first version's default
   * black and graphite as literal colours: they were "the ink" then, and
   * read as it, so the drawing stays legible on dark paper. A colour chosen
   * by hand is anything else and stays literal. */
  function isLegacy(data, text) {
    if (data.page || typeof text !== 'string') return false;
    return !/\bmr-(?:sheet|ink)\b/.test(text);
  }

  function sceneData(json) {
    var data;
    try { data = JSON.parse(json); } catch (err) { return null; }
    return data && typeof data === 'object' && typeof data.v === 'number' && Array.isArray(data.elements) ? data : null;
  }

  /* A file of ours the XML parser refuses (a control character in a text,
   * written by an early build of this editor, or a careless hand) still
   * carries its scene intact: the JSON escapes what the markup did not. It
   * is read back from the raw text, and the editor saves it again whole. */
  function repair(text, result) {
    var m = new RegExp('<metadata id="' + META_ID + '">([^<]*)</metadata>').exec(text);
    var data = m ? sceneData(unescapeXml(m[1])) : null;
    if (!data || (data.v !== FORMAT && data.v !== IMAGE_FORMAT)) return result;
    var img = new RegExp('<image id="' + BG_ID + '"[^>]*?\\shref="([^"]*)"').exec(text);
    result.repaired = true;
    return readScene(data, result, img ? unescapeXml(img[1]) : null, text, function (id) {
      if (!/^[\w-]{1,64}$/.test(id)) return null;
      var pic = new RegExp('<image id="' + IMAGE_ID + id + '"[^>]*?\\shref="([^"]*)"').exec(text);
      return pic ? unescapeXml(pic[1]) : null;
    });
  }

  /* A saved drawing back into a scene. Kinds:
   *   'ink'      ours (`repaired` when it had to be read past an XML fault)
   *   'foreign'  an SVG without our scene, such as an .excalidraw.svg: the
   *              picture becomes the locked background of a new drawing
   *   'damaged'  ours, but the scene cannot be read: the picture is still
   *              good, and is kept the same way as a foreign one
   *   'newer'    ours, from a later format this version does not know: the
   *              picture is shown, and the editor will not write over it
   *   'empty'    nothing at all: a new drawing
   *   'invalid'  not a picture that can be read in any way
   * Nothing in the file is trusted: every element is checked and rebuilt,
   * and only an image data URL is taken as the background. */
  function parse(text) {
    var result = { ok: false, kind: 'empty', elements: [], background: null, excalidraw: false, repaired: false, version: null, page: null };
    if (typeof text !== 'string' || !text.trim()) return result;
    result.kind = 'invalid';
    var doc = null;
    try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); } catch (err) { doc = null; }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return repair(text, result);
    var root = doc.documentElement;
    if (root.localName !== 'svg') return result;
    result.excalidraw = /svg-source:excalidraw|payload-type:application\/vnd\.excalidraw/.test(text);

    var meta = null;
    var metas = root.getElementsByTagName('metadata');
    for (var i = 0; i < metas.length; i++) if (metas[i].getAttribute('id') === META_ID) meta = metas[i];
    if (!meta) {
      result.ok = true;
      result.kind = 'foreign';
      result.background = foreignBackground(text, root);
      return result;
    }
    var data = sceneData(meta.textContent);
    if (data && data.v > MAX_FORMAT) {
      result.ok = true;
      result.kind = 'newer';
      result.version = data.v;
      result.background = foreignBackground(text, root);
      return result;
    }
    if (!data || (data.v !== FORMAT && data.v !== IMAGE_FORMAT)) {
      result.ok = true;
      result.kind = 'damaged';
      result.background = foreignBackground(text, root);
      return result;
    }
    var bgHref = null;
    var pictures = Object.create(null);
    var images = root.getElementsByTagName('image');
    for (var j = 0; j < images.length; j++) {
      var iid = images[j].getAttribute('id') || '';
      var ihref = images[j].getAttribute('href') || images[j].getAttributeNS(XLINK_NS, 'href');
      if (iid === BG_ID) bgHref = ihref;
      else if (iid.indexOf(IMAGE_ID) === 0) pictures[iid.slice(IMAGE_ID.length)] = ihref;
    }
    return readScene(data, result, bgHref, text, function (id) { return pictures[id] || null; });
  }

  function isInkSvg(text) {
    return typeof text === 'string' && text.indexOf('id="' + META_ID + '"') >= 0 && parse(text).kind === 'ink';
  }

  /* What the host handed over as a background: SVG text, or an image data
   * URL (its size learnt once it has decoded). */
  function backgroundFrom(value) {
    if (!value) return null;
    if (typeof value === 'object' && isImageDataUrl(value.href)) {
      return { href: value.href, x: finite(value.x) ? value.x : 0, y: finite(value.y) ? value.y : 0, w: value.w > 0 ? value.w : 800, h: value.h > 0 ? value.h : 600, measure: !(value.w > 0) };
    }
    if (typeof value !== 'string') return null;
    if (isImageDataUrl(value)) return { href: value, x: 0, y: 0, w: 800, h: 600, measure: true };
    var parsed = parse(value);
    if (parsed.kind === 'foreign' || parsed.kind === 'damaged' || parsed.kind === 'newer') return parsed.background;
    if (parsed.kind === 'ink' && !parsed.repaired) {
      var size = svgSizeOfText(value);
      return { href: 'data:image/svg+xml;base64,' + base64Utf8(value), x: 0, y: 0, w: size.w, h: size.h };
    }
    return null;
  }

  function svgSizeOfText(text) {
    try {
      var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return svgSize(doc.documentElement);
    } catch (err) { return { w: 800, h: 600 }; }
  }

  /* Ids and versions, in order: the scene as far as saving is concerned. */
  var signatures = new WeakMap();
  function signature(elements, background) {
    var known = signatures.get(elements);
    if (known === undefined) {
      known = elements.map(function (el) { return el.id + ':' + el.version; }).join(',');
      signatures.set(elements, known);
    }
    return known + '|' + (background ? background.href.length + ':' + background.x + ',' + background.y : '');
  }

  /* ================================================================ what the hand holds
   *
   * Which instrument, its colour and size, the shape style, the text size,
   * the eraser: remembered between sessions and not per drawing - what you
   * draw with belongs to your hand. Through ns.prefs in the app (its own
   * 'ink' entry, plus the contract's 'pen' summary), straight to
   * localStorage on a page without it. */

  var STORE_KEY = 'mindroot2:ink';

  function defaultSettings() {
    var pens = {};
    PENS.forEach(function (p) { pens[p.id] = { color: p.color, size: p.size }; });
    return {
      tool: 'pen',
      pen: 'pen',
      pens: pens,
      shape: 'rect',
      shapes: { color: INK, width: 'm', fill: 'none' },
      text: { color: INK, size: 'm' },
      eraser: { mode: 'part', size: 20 },
      custom: null
    };
  }

  function eraserSize(v) {
    return clamp(Math.round((Number(v) || ERASER_MIN) / ERASER_STEP) * ERASER_STEP, ERASER_MIN, ERASER_MAX);
  }

  /* The first version's default colours become the ink that adapts: a
   * hand that never chose them should not keep black on a dark page (the
   * pen, the pencil, shapes and text had them; marker, brush and
   * highlighter defaults were colours, and stay what they are). */
  function adapting(color, oldDefault) { return color === oldDefault ? INK : color; }

  /* Whatever was stored, folded onto the defaults field by field. */
  function cleanSettings(raw) {
    var s = defaultSettings();
    if (!raw || typeof raw !== 'object') return s;
    if (TOOLS.indexOf(raw.tool) >= 0 && raw.tool !== 'hand') s.tool = raw.tool;
    if (penById(raw.pen)) s.pen = raw.pen;
    if (raw.pens && typeof raw.pens === 'object') {
      PENS.forEach(function (p) {
        var got = raw.pens[p.id];
        if (!got || typeof got !== 'object') return;
        if (isColor(got.color)) {
          var c = cleanColor(got.color);
          s.pens[p.id].color = p.id === 'pen' ? adapting(c, OLD_BLACK) : (p.id === 'pencil' ? adapting(c, OLD_GRAPHITE) : c);
        }
        if (finite(got.size)) s.pens[p.id].size = clamp(Math.round(got.size * 2) / 2, PEN_MIN, PEN_MAX);
      });
    }
    if (SHAPES.indexOf(raw.shape) >= 0) s.shape = raw.shape;
    if (raw.shapes && typeof raw.shapes === 'object') {
      if (isColor(raw.shapes.color)) s.shapes.color = adapting(cleanColor(raw.shapes.color), OLD_BLACK);
      if (WIDTHS[raw.shapes.width]) s.shapes.width = raw.shapes.width;
      if (FILLS.indexOf(raw.shapes.fill) >= 0) s.shapes.fill = raw.shapes.fill;
    }
    if (raw.text && typeof raw.text === 'object') {
      if (isColor(raw.text.color)) s.text.color = adapting(cleanColor(raw.text.color), OLD_BLACK);
      if (TEXT_SIZES[raw.text.size]) s.text.size = raw.text.size;
    }
    if (raw.eraser && typeof raw.eraser === 'object') {
      if (ERASER_MODES.indexOf(raw.eraser.mode) >= 0) s.eraser.mode = raw.eraser.mode;
      if (finite(raw.eraser.size)) s.eraser.size = eraserSize(raw.eraser.size);
    }
    if (isHex(raw.custom)) s.custom = raw.custom.toLowerCase();
    return s;
  }

  var settings = null;
  var settingsTimer = 0;

  function prefsUsable() {
    return !!(ns.prefs && typeof ns.prefs.define === 'function' && typeof ns.prefs.get === 'function');
  }

  function loadSettings() {
    var raw = null;
    if (prefsUsable()) {
      try { raw = ns.prefs.define('ink', null, { free: true }); } catch (err) { raw = null; }
      if (!raw) {
        /* First run with ns.prefs: the contract's 'pen' summary may already
         * hold a choice made elsewhere. */
        try {
          var pen = ns.prefs.get('pen');
          if (pen) raw = { eraser: { mode: pen.eraser } };
        } catch (err) { raw = null; }
      }
    } else {
      try { raw = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null'); } catch (err) { raw = null; }
    }
    settings = cleanSettings(raw);
    return settings;
  }

  function currentSettings() { return settings || loadSettings(); }

  function writeSettings() {
    settingsTimer = 0;
    var s = currentSettings();
    if (prefsUsable()) {
      try {
        ns.prefs.set('ink', JSON.parse(JSON.stringify(s)));
        var pen = s.pens[s.pen];
        ns.prefs.set('pen', { tool: s.tool, color: pen.color, size: clamp(pen.size, 0.5, 64), eraser: s.eraser.mode });
      } catch (err) { /* preferences unavailable: the choice lasts this session */ }
      return;
    }
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (err) { /* private mode */ }
  }

  /* A slider sends a value per pixel of travel: written once it settles. */
  function rememberSettings() {
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(writeSettings, 250);
  }

  /* A tool picked just before the page goes away is still remembered: the
   * pending write happens now rather than never. */
  function flushSettings() {
    if (!settingsTimer) return;
    clearTimeout(settingsTimer);
    settingsTimer = 0;
    writeSettings();
    /* prefs flushed on its own pagehide already (it loads first): again. */
    if (prefsUsable() && typeof ns.prefs.flush === 'function') {
      try { ns.prefs.flush(); } catch (err) { /* storage refused: nothing more to do */ }
    }
  }
  window.addEventListener('pagehide', flushSettings);

  /* ================================================================ the options hint
   *
   * A tool with options (the pen, the eraser, the shapes, the text) shows
   * a small chevron, and the first times one is picked with a press a
   * bubble says "Tap again for pen options". Once options have been opened
   * from a tool button the bubble never comes back; it is also shown at
   * most COACH_MAX times in all and once per editor, so it stays calm for
   * a person who does not want the options. Through ns.prefs in the app
   * ('inkCoach'), straight to localStorage on a page without it. */

  var COACH_KEY = 'mindroot2:ink-coach';
  var COACH_MAX = 3;
  var COACH_SHOWN_MS = 5000;
  var coachMemo = null;

  function coachState() {
    if (coachMemo) return coachMemo;
    var raw = null;
    if (prefsUsable()) {
      try { raw = ns.prefs.define('inkCoach', { used: false, shown: 0 }); } catch (err) { raw = null; }
    } else {
      try { raw = JSON.parse(window.localStorage.getItem(COACH_KEY) || 'null'); } catch (err) { raw = null; }
    }
    coachMemo = {
      used: !!(raw && raw.used === true),
      shown: raw && finite(raw.shown) ? clamp(Math.round(raw.shown), 0, COACH_MAX) : 0
    };
    return coachMemo;
  }

  function writeCoach() {
    var c = coachState();
    var value = { used: c.used, shown: c.shown };
    if (prefsUsable()) {
      try { ns.prefs.set('inkCoach', value); } catch (err) { /* this session only */ }
      return;
    }
    try { window.localStorage.setItem(COACH_KEY, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }

  /* ================================================================ icons
   *
   * The component draws its own: it is mounted inside the app (where the
   * sprite exists) and on bare pages (tests, an embedding) where it does
   * not. Same 24-unit stroke family as the app sprite. Static, trusted
   * markup: no user text ever goes through here. */

  var SWASH = 'M2.5 16.6c3-7 5.5-9 7.5-9s2.5 4 4.5 4 3.5-3.5 5-6.6';
  var ICONS = {
    select: '<path d="M5.5 3.5l12.5 7-5.8 1.6-2.7 5.9z"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v6"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L4.3 14.6a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>',
    pen: '<path d="M12 21v-3.5"/><path d="M8.5 13.5L12 3l3.5 10.5L12 17.5z"/><path d="M12 10.5v2"/>',
    laser: '<circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18"/>',
    pencil: '<path d="M4 20l1.5-5.5L15.5 4.5l4 4-10 10z"/><path d="M5.5 14.5l4 4"/><path d="M13 7l4 4"/>',
    marker: '<path d="M9.5 15l-3.5 3.5V20h3.5l3.5-3.5"/><path d="M9.5 15l7-9.5a2 2 0 0 1 3 0l.5.5a2 2 0 0 1 0 3L13 16.5z"/>',
    brush: '<path d="M18.5 3.5l2 2-8 8-2-2z"/><path d="M10.5 11.5c-2.5 0-4 1.5-4 3.5 0 1.5-1 2.5-3 3 2 1.5 6 1.5 7.5-.5 1-1.3 1.5-2.5 1.5-4"/>',
    highlighter: '<path d="M4 20.5h7"/><path d="M8 16.5l-2-2 9-9 4 4-9 9z"/><path d="M11 15.5l-4-4"/><path d="M7.5 18.5l-1.5 1.5"/>',
    eraser: '<path d="M8.5 18.5 4.2 14.2a1.8 1.8 0 0 1 0-2.5l7.5-7.5a1.8 1.8 0 0 1 2.5 0l5.1 5.1a1.8 1.8 0 0 1 0 2.5l-7 7"/><path d="M8.5 9.4l6.1 6.1"/><path d="M3 20.5h18"/>',
    'eraser-part': '<path d="' + SWASH + '" pathLength="100" stroke-dasharray="36 26 100"/>',
    'eraser-stroke': '<path d="' + SWASH + '" opacity=".35"/>',
    'eraser-area': '<path d="M3.5 12a8.5 6 0 1 0 17 0a8.5 6 0 1 0 -17 0" stroke-dasharray="3 3"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
    diamond: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>',
    line: '<path d="M5 19L19 5"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
    text: '<path d="M5 6.5V4.5h14v2"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    undo: '<path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="M8 5L4 9l4 4"/>',
    redo: '<path d="M20 9H9a5 5 0 0 0 0 10h6"/><path d="M16 5l4 4-4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'zoom-in': '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/><path d="M8.5 11h5M11 8.5v5"/>',
    'zoom-out': '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/><path d="M8.5 11h5"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    duplicate: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/>',
    front: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".3"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    style: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3L16 12l4 4"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    unlock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'fill-none': '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
    'fill-soft': '<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="currentColor" fill-opacity=".3"/>',
    'fill-solid': '<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="currentColor"/>'
  };

  function icon(name) {
    var node = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', 'class': 'ink__icon' });
    node.innerHTML = ICONS[name] || '';
    return node;
  }

  function h(tag, cls, attrs) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    return el;
  }

  var IS_MAC = /Mac|iPhone|iPad|iPod/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));

  function keysText(keys) {
    return keys.map(function (k) { return k.replace('Mod', IS_MAC ? '⌘' : 'Ctrl'); }).join(' / ');
  }

  /* The app's tooltip when the app is there (delay, none on touch, the
   * shortcut as a key cap); a title otherwise. */
  function tip(el, label, keys) {
    if (ns.ui && typeof ns.ui.tooltip === 'function') {
      try {
        ns.ui.tooltip(el, label, keys && keys.length ? keys : undefined);
        el.removeAttribute('title');
        return;
      } catch (err) { /* fall back to a title */ }
    }
    el.title = keys && keys.length ? t('ink.withKey', { label: label, key: keysText(keys) }) : label;
  }

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    if (target.isContentEditable) return true;
    var tag = target.tagName;
    return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && target.type !== 'button' && target.type !== 'checkbox' && target.type !== 'radio');
  }

  function isBack(e) { return e.pointerType === 'pen' && (e.button === BACK || (e.buttons & BACK_BIT) !== 0); }
  function isSide(e) { return e.pointerType === 'pen' && e.button === SIDE; }

  function coalesced(e) {
    var list = null;
    try { list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null; } catch (err) { list = null; }
    return list && list.length ? list : [e];
  }

  function warn(what, err) {
    if (window.console && console.warn) console.warn('ink: ' + what, err);
  }

  /* ================================================================ the pointer over the sheet
   *
   * With a pen in hand the pointer is the nib: the outline of the mark it
   * will leave, as wide as the line on screen (so it grows and shrinks with
   * the zoom), and for the highlighter the outline of the chisel. It is
   * hollow on purpose: the point being aimed at stays in view, and the pen's
   * colour only tints the inside, as a preview of the mark. The 1 px outline
   * is the sheet's own ink (dark on light paper, light on dark), softened,
   * with a hair of the sheet's colour outside it so it still reads over any
   * ink; it follows the theme and never shouts.
   *
   * The page draws it (div.ink__pen-ring, as the eraser draws its circle), not the
   * browser: a CSS cursor image is dropped by some browsers - the system
   * crosshair shows instead - above all under a hovering stylus. It follows
   * every mouse or pen move over the sheet (no media query decides it: a
   * finger has no pointer to show and sends no hover), hides while a stroke
   * is drawn, and the system cursor is hidden while it is live. Every other
   * tool has a system cursor (css/ink.css); the eraser keeps its own circle. */

  var NIB_MIN = 6;                 // px across: a fine nib zoomed out still shows, with its middle open
  var NIB_DARK_RING = '#15171c';
  var NIB_LIGHT_RING = '#f4f5f7';

  /* ================================================================ the editor */

  var editors = [];

  function open(host, opts) {
    opts = opts || {};
    if (!host || typeof host.appendChild !== 'function') throw new Error('ink.open needs a host element');
    var s = currentSettings();

    var parsed = parse(typeof opts.svgText === 'string' ? opts.svgText : '');
    var elements = parsed.kind === 'ink' ? parsed.elements : [];
    /* opts.background is for a new drawing; a file brings its own. */
    var background = parsed.background || (parsed.kind === 'empty' ? backgroundFrom(opts.background) : null);
    /* A file this editor cannot write back faithfully - one from a newer
     * version, or one it cannot read at all - opens locked, whatever the
     * host says later: an empty sheet in its place would be saved over it
     * at the first stroke. */
    var locked = parsed.kind === 'newer' || parsed.kind === 'invalid';
    /* The look (paper, sheet and ink colours) and the page, both optional:
     * see the header. pageId names the page in onSave. */
    var look = resolveLook(opts.look);
    var page = validPage(opts.page) || null;
    var pageId = opts.pageId != null ? String(opts.pageId) : null;
    /* Pages left while this editor lives keep their scene and their undo:
     * coming back to a page whose file is as it was left gives both back. */
    var pageCache = new Map();
    /* The file as it was last handed over or loaded (the host gives it back
     * when the editor returns to the page). */
    var currentText = typeof opts.svgText === 'string' ? opts.svgText : '';
    var hostReadOnly = !!opts.readOnly;
    var readOnly = hostReadOnly || locked;
    var tool = readOnly ? 'hand' : s.tool;
    var toolBeforeEraser = null;
    var toolBeforeReadOnly = null;
    var selection = [];
    var cam = { x: 0, y: 0, k: 1 };
    var fitted = false;
    var undoStack = [];
    var redoStack = [];
    var lastKey = null;
    var lastKeyAt = 0;
    /* savedSig: the scene as last handed to the host (optimistically, while
     * its answer is awaited); confirmedSig: as last known kept. A refused
     * save falls back to the confirmed one, so it is offered again. */
    var savedSig = signature(elements, background);
    var confirmedSig = savedSig;
    var everSaved = false;
    var saveFailed = false;
    var pendingSaves = 0;
    var inSave = false;
    var settleWaiters = [];
    var saveTimer = 0;
    var saveState = '';
    var savedSaid = false;
    var failedSaid = false;
    var closed = false;           // unmounted: no input any more
    var closing = false;
    var ended = false;            // onClose delivered, gone from ns.ink.editors()
    var closeResult = null;
    var doneWaiting = false;
    /* A file read past an XML fault is rewritten whole as soon as it may
     * be: on the map it shows as a broken picture until then. */
    if (parsed.repaired && !readOnly) savedSig = confirmedSig = '';

    var pointers = new Map();
    var gesture = null;
    var pinch = null;
    var safariPinch = null;
    var penSeen = false;
    var dismissing = null;
    var spaceDown = false;
    var menuOwed = 0;
    var lastTap = null;
    var textEdit = null;
    var rect = { left: 0, top: 0, width: 0, height: 0 };
    var layout = '';
    var pop = null;
    var nodes = new Map();
    var liveNode = null;
    var frame = 0;
    var observer = null;
    var selBarSize = null;
    var coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    var coarse = !!(coarseQuery && coarseQuery.matches);
    /* The nib as the pointer (see the section above): never in forced
     * colours, where the system's own cursors are the readable ones. */
    var forcedQuery = window.matchMedia ? window.matchMedia('(forced-colors: active)') : null;
    var nibKey = null;
    var nibBuilds = 0;
    var nibW = 0;           // the nib's size on screen, for placing it
    var nibH = 0;
    var hoverCursor = '';

    /* ---------------------------------------------------------------- the DOM */

    /* Focus goes back to whatever had it when the editor opened (the
     * button that opened it), unless the host names another place. */
    var opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

    var hintId = 'ink-hint-' + uid();
    var noticeKey = parsed.kind === 'newer' || parsed.kind === 'invalid' || parsed.kind === 'damaged' ? 'ink.notice.' + parsed.kind : null;
    var root = h('div', 'ink', {
      tabindex: '0', role: 'application',
      'aria-label': opts.title ? t('ink.surfaceTitled', { title: opts.title }) : t('ink.surface'),
      'aria-describedby': hintId + (noticeKey ? ' ' + hintId + '-notice' : '')
    });
    root.style.setProperty('--ink-sheet', look.sheet);
    root.style.setProperty('--ink-on-sheet', look.ink);
    if (look.dark) root.setAttribute('data-sheet', 'dark');
    if (look.paper) root.setAttribute('data-paper', look.paper.type);
    if (page) root.setAttribute('data-page', '');
    if (readOnly) root.setAttribute('data-readonly', '');
    var hint = h('p', 'ink__sr', { id: hintId, text: t('ink.hint') });
    var announcer = h('p', 'ink__sr', { role: 'status', 'aria-live': 'polite' });
    /* What must interrupt: the drawing could not be kept. */
    var alertEl = h('p', 'ink__sr', { role: 'alert' });
    /* Why a file opened as it did, in words, when it did not open as a
     * drawing of ours. */
    var notice = h('p', 'ink__notice', { id: hintId + '-notice', hidden: !noticeKey });
    if (noticeKey) notice.textContent = t(noticeKey);

    var surface = svgEl('svg', { 'class': 'ink__surface', 'aria-hidden': 'true' });
    var world = svgEl('g', { 'class': 'ink__world' });
    var bgNode = null;
    /* The paper, under everything else; the drawing above it is clipped to
     * the page when there is one. */
    var paperG = svgEl('g', { 'class': 'ink__paper' });
    /* A picture used as the paper: its nodes are made once per picture and
     * only moved as the paper is drawn again, never re-parsed (a picture is
     * megabytes of data URL; going through innerHTML at every pan would
     * stutter a pinch). */
    var imageG = svgEl('g', { 'class': 'ink__paper-image' });
    var imageNodes = null;      // {href, page, image, rect, pattern}
    var clipId = 'ink-clip-' + uid();
    var defs = svgEl('defs');
    var clipRect = svgEl('rect', { x: 0, y: 0, width: 0, height: 0 });
    var clipPath = svgEl('clipPath', { id: clipId });
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    var sceneG = svgEl('g', { 'class': 'ink__scene' });
    var liveG = svgEl('g', { 'class': 'ink__live' });
    var overlay = svgEl('g', { 'class': 'ink__overlay' });
    surface.appendChild(defs);
    world.appendChild(paperG);
    world.appendChild(imageG);
    world.appendChild(sceneG);
    world.appendChild(liveG);
    surface.appendChild(world);
    surface.appendChild(overlay);

    var cursor = h('div', 'ink__cursor', { hidden: true, 'aria-hidden': 'true' });
    var nib = h('div', 'ink__pen-ring', { hidden: true, 'aria-hidden': 'true' });
    /* The laser pointer: a trail of recent pen positions in screen pixels,
     * drawn on a layer of its own above the sheet. It is never part of the
     * drawing: nothing is committed, saved or put on the undo stack. */
    var laserOn = false;
    var laserSvg = svgEl('svg', { 'class': 'ink__laser', 'aria-hidden': 'true', 'data-off': '' });
    var laserGlow = svgEl('path', { 'class': 'ink__laser-glow' });
    var laserCore = svgEl('path', { 'class': 'ink__laser-core' });
    var laserDot = svgEl('circle', { 'class': 'ink__laser-dot', r: '7' });
    laserSvg.appendChild(laserGlow);
    laserSvg.appendChild(laserCore);
    laserSvg.appendChild(laserDot);
    var laserTrail = [];
    var laserFrame = 0;
    var ta = h('textarea', 'ink__text', {
      hidden: true, rows: '1', wrap: 'off', spellcheck: 'true',
      'aria-label': t('ink.textField'), placeholder: t('ink.textPlaceholder')
    });

    var toolButtons = {};
    var toolsBar = h('div', 'ink__bar ink__tools', { role: 'toolbar' });
    var actionsBar = h('div', 'ink__bar ink__actions', { role: 'toolbar' });
    var zoomBar = h('div', 'ink__bar ink__zoom', { role: 'toolbar' });
    var selBar = h('div', 'ink__bar ink__selbar', { role: 'toolbar', hidden: true });
    var popEl = h('div', 'ink__pop', { role: 'dialog', hidden: true });
    /* "Tap again for pen options" (see coachState): a picture of the
     * advice for the eye; the button's aria-haspopup says it to a screen
     * reader. */
    var coachEl = h('p', 'ink__coach', { hidden: true, 'aria-hidden': 'true' });
    var coachTimer = 0;
    var coachAnchor = null;
    var coachedHere = false;

    /* Everything with a name, by string key, so a change of language
     * renames the editor in place. Buttons in the popover are rebuilt each
     * time it opens and are not kept here. */
    var labelled = [];

    function name(el, key, keys, withTip) {
      el.setAttribute('aria-label', t(key));
      if (withTip) tip(el, t(key), keys);
    }

    function button(cls, key, iconName, onClick, keys, transient) {
      var b = h('button', 'ink__btn' + (cls ? ' ' + cls : ''), { type: 'button', 'data-key': key });
      b.appendChild(icon(iconName));
      name(b, key, keys, true);
      if (!transient) labelled.push({ el: b, key: key, keys: keys, tip: true });
      b.addEventListener('click', onClick);
      return b;
    }

    function region(el, key) {
      name(el, key, null, false);
      labelled.push({ el: el, key: key, tip: false });
    }

    region(toolsBar, 'ink.tools');
    region(actionsBar, 'ink.actions');
    region(zoomBar, 'ink.zoomBar');
    region(selBar, 'ink.selection');
    region(ta, 'ink.textField');

    function separator(cls) { return h('span', 'ink__sep' + (cls ? ' ' + cls : ''), { 'aria-hidden': 'true' }); }

    function toolLabel(name) { return t('ink.tool.' + name); }

    /* Tool buttons are named by updateToolbar (the name changes with the
     * state: pressed again, it opens the options), so they are not kept in
     * `labelled`. */
    /* The tools that have options, by the kind of popover they open. */
    function optionsOf(id) {
      if (id === 'pen' || id === 'eraser' || id === 'text') return id;
      if (SHAPES.indexOf(id) >= 0) return 'shape';
      return null;
    }

    /* The chevron that says a button holds more: pointing at where its
     * options open (down from the top bar, up from the bottom one). A
     * press on it opens them at once; it is part of the button, so the
     * keyboard and screen readers meet the button's name and its
     * aria-haspopup. */
    function addCaret(b) {
      b.setAttribute('aria-haspopup', 'dialog');
      b.setAttribute('aria-expanded', 'false');
      var c = h('span', 'ink__caret', { 'aria-hidden': 'true' });
      var g = svgEl('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false', 'class': 'ink__caret-icon' });
      g.appendChild(svgEl('path', { d: 'M3.75 5L6 7.25 8.25 5' }));
      c.appendChild(g);
      b.appendChild(c);
    }

    function onCaret(e) { return !!(e && e.target && e.target.closest && e.target.closest('.ink__caret')); }

    function addTool(id, cls) {
      var b = button('ink__tool' + (cls ? ' ' + cls : ''), 'ink.tool.' + id, id === 'pen' ? s.pen : id,
        function (e) { toolPressed(id, b, e); }, [TOOL_KEYS[id]], true);
      b.setAttribute('data-tool', id);
      b.setAttribute('aria-pressed', 'false');
      if (id === 'pen') b.appendChild(h('span', 'ink__swatch', { 'aria-hidden': 'true' }));
      if (optionsOf(id)) addCaret(b);
      toolButtons[id] = b;
      toolsBar.appendChild(b);
      return b;
    }

    addTool('select');
    addTool('hand', 'ink__wide');
    toolsBar.appendChild(separator('ink__wide'));
    addTool('pen');
    var laserBtn = button('ink__laser-btn ink__wide', 'ink.laser', 'laser', function () {
      if (tool !== 'pen') { if (setTool('pen')) setLaser(true); }
      else setLaser(!laserOn);
    }, null, true);
    laserBtn.setAttribute('aria-pressed', 'false');
    toolsBar.appendChild(laserBtn);
    addTool('eraser');
    toolsBar.appendChild(separator('ink__wide'));
    SHAPES.forEach(function (name) { addTool(name, 'ink__wide'); });
    var shapeBtn = button('ink__tool ink__compact', 'ink.tool.shapes', s.shape, function (e) { shapesPressed(shapeBtn, e); });
    shapeBtn.setAttribute('aria-pressed', 'false');
    addCaret(shapeBtn);
    toolsBar.appendChild(shapeBtn);
    addTool('text');
    var imageBtn = button('ink__wide', 'ink.image.pick', 'image', function () { pickImage(); });
    toolsBar.appendChild(imageBtn);
    toolsBar.appendChild(separator('ink__wide'));
    var styleBtn = button('ink__wide', 'ink.style', 'style', function (e) { togglePop('style', styleBtn, e); });
    var styleDot = h('span', 'ink__swatch', { 'aria-hidden': 'true' });
    styleBtn.appendChild(styleDot);
    addCaret(styleBtn);
    toolsBar.appendChild(styleBtn);
    var moreBtn = button('ink__compact', 'ink.more', 'more', function (e) { togglePop('more', moreBtn, e); });
    moreBtn.setAttribute('aria-haspopup', 'dialog');
    toolsBar.appendChild(moreBtn);

    var undoBtn = button('', 'ink.undo', 'undo', function () { undo(); }, ['Mod+Z']);
    var redoBtn = button('', 'ink.redo', 'redo', function () { redo(); }, ['Mod+Shift+Z', 'Mod+Y']);
    var status = h('span', 'ink__status', { 'aria-hidden': 'true' });
    var statusDot = h('span', 'ink__status-dot');
    var statusText = h('span', 'ink__status-text');
    status.appendChild(statusDot);
    status.appendChild(statusText);
    var doneBtn = h('button', 'ink__btn ink__done', { type: 'button' });
    doneBtn.appendChild(icon('check'));
    var doneText = h('span', 'ink__done-text', { text: t('ink.done') });
    doneBtn.appendChild(doneText);
    region(doneBtn, 'ink.done');
    doneBtn.addEventListener('click', function () { done(); });
    actionsBar.appendChild(undoBtn);
    actionsBar.appendChild(redoBtn);
    actionsBar.appendChild(separator('ink__sep--history'));
    actionsBar.appendChild(status);
    /* The host's own buttons (a notebook's pages, settings, export) sit
     * with the actions, so one bar serves the whole surface. */
    if (Array.isArray(opts.actions) && opts.actions.length) {
      actionsBar.appendChild(separator('ink__sep--host'));
      opts.actions.forEach(function (el) { if (el && el.nodeType === 1) actionsBar.appendChild(el); });
    }
    if (opts.done !== false) actionsBar.appendChild(doneBtn);

    var zoomOutBtn = button('', 'ink.zoomOut', 'zoom-out', function () { zoomBy(1 / 1.25); }, ['Mod+-']);
    var zoomLabel = h('button', 'ink__btn ink__zoom-level', { type: 'button' });
    name(zoomLabel, 'ink.zoomReset', ['Mod+0'], true);
    labelled.push({ el: zoomLabel, key: 'ink.zoomReset', keys: ['Mod+0'], tip: true });
    zoomLabel.addEventListener('click', function () { zoomTo(1); });
    var zoomInBtn = button('', 'ink.zoomIn', 'zoom-in', function () { zoomBy(1.25); }, ['Mod+=']);
    var fitBtn = button('', 'ink.fit', 'fit', function () { fit(4); }, ['Shift+1']);
    zoomBar.appendChild(zoomOutBtn);
    zoomBar.appendChild(zoomLabel);
    zoomBar.appendChild(zoomInBtn);
    zoomBar.appendChild(fitBtn);

    var selColorBtn = button('', 'ink.colors', 'style', function (e) { togglePop('selection', selColorBtn, e); });
    selColorBtn.setAttribute('aria-haspopup', 'dialog');
    selColorBtn.appendChild(h('span', 'ink__swatch', { 'aria-hidden': 'true' }));
    var dupBtn = button('', 'ink.duplicate', 'duplicate', function () { duplicateSelection(); }, ['Mod+D']);
    var frontBtn = button('', 'ink.front', 'front', function () { bringToFront(); }, ['Mod+Shift+]']);
    var delBtn = button('ink__danger', 'ink.delete', 'trash', function () { deleteSelection(); }, ['Delete']);
    var lockBtn = button('', 'ink.lock', 'lock', function () { lockSelection(true); });
    lockBtn.hidden = true;
    selBar.appendChild(selColorBtn);
    selBar.appendChild(dupBtn);
    selBar.appendChild(frontBtn);
    selBar.appendChild(lockBtn);
    selBar.appendChild(delBtn);

    root.appendChild(hint);
    root.appendChild(announcer);
    root.appendChild(alertEl);
    root.appendChild(surface);
    root.appendChild(cursor);
    root.appendChild(nib);
    root.appendChild(laserSvg);
    root.appendChild(ta);
    root.appendChild(toolsBar);
    root.appendChild(actionsBar);
    root.appendChild(zoomBar);
    root.appendChild(selBar);
    root.appendChild(notice);
    root.appendChild(coachEl);
    root.appendChild(popEl);

    /* ---------------------------------------------------------------- camera */

    function refreshRect() {
      var r = surface.getBoundingClientRect();
      rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function toScene(cx, cy) { return [(cx - rect.left - cam.x) / cam.k, (cy - rect.top - cam.y) / cam.k]; }
    function toLocal(p) { return [p[0] * cam.k + cam.x, p[1] * cam.k + cam.y]; }

    function applyCamera() {
      if (typeof opts.clampCamera === 'function') {
        try {
          var c = opts.clampCamera({ x: cam.x, y: cam.y, k: cam.k }, rect);
          if (c && finite(c.x) && finite(c.y) && finite(c.k) && c.k > 0) {
            cam.x = c.x;
            cam.y = c.y;
            cam.k = clamp(c.k, ZOOM_MIN, ZOOM_MAX);
          }
        } catch (err) { warn('clampCamera failed', err); }
      }
      world.setAttribute('transform', 'matrix(' + cam.k + ' 0 0 ' + cam.k + ' ' + cam.x + ' ' + cam.y + ')');
      paintPaperSoon();
      /* A faint dot grid that moves with the sheet: on an infinite page it
       * is the only thing that shows the page moved. Its pitch doubles
       * when zooming out, so it never turns into a grey wash. */
      var pitch = 24 * cam.k;
      while (pitch < 12) pitch *= 2;
      while (pitch > 48) pitch /= 2;
      surface.style.backgroundSize = pitch + 'px ' + pitch + 'px';
      surface.style.backgroundPosition = cam.x + 'px ' + cam.y + 'px';
      zoomLabel.textContent = t('ink.zoomLevel', { n: Math.round(cam.k * 100) });
      refreshNibCursor();
      paintOverlay();
      placeText();
      if (pop) paintNib();
      if (typeof opts.onCamera === 'function') {
        try { opts.onCamera({ x: cam.x, y: cam.y, k: cam.k }, rect); } catch (err) { warn('onCamera failed', err); }
      }
    }

    /* ---------------------------------------------------------------- paper */

    var paperDrawn = null;      // {x, y, w, h, step, key}: what paperG holds
    var paperFrame = 0;

    function paperStep(k) { return Math.round(Math.log(k) / Math.LN2 * PAPER_STEPS); }

    /* The sheet under a page is the page itself: a page with no paper is
     * blank paper. An infinite sheet with no paper keeps the dot grid of the
     * stylesheet, which costs nothing. */
    function paperOf() { return look.paper || (page ? { type: 'blank' } : null); }

    function paintPaperSoon() {
      if (paperFrame || closed || !paperOf()) return;
      if (!paperDrawn) { paintPaper(); return; }
      paperFrame = requestAnimationFrame(function () {
        paperFrame = 0;
        if (!closed) paintPaper();
      });
    }

    /* Drawn over a rectangle: the page, or what is on screen of the
     * infinite sheet plus a margin. Drawn again only when the camera has
     * left that rectangle, the zoom has moved a quarter octave, or the look
     * changed. */
    function paintPaper(force) {
      var paper = paperOf();
      var P = paperModule();
      if (!paper || !P || typeof P.patternSvg !== 'function') {
        if (paperDrawn) {
          paperG.textContent = '';
          paperDrawn = null;
        }
        paintImage(null);
        return;
      }
      var step = paperStep(cam.k);
      var scale = Math.pow(2, step / PAPER_STEPS);
      var key = JSON.stringify(paper) + '|' + look.theme + '|' + look.background + '|' + (look.tile ? look.tile.w + 'x' + look.tile.h : '') +
        '|' + (look.image ? look.image.href.length + ':' + look.image.href.slice(-24) : '') +
        '|' + (page ? page.w + 'x' + page.h : '');
      var want;
      if (page) {
        want = { x: 0, y: 0, w: page.w, h: page.h };
        if (!force && paperDrawn && paperDrawn.key === key && paperDrawn.step === step) return;
      } else {
        if (!rect.width || !rect.height) return;
        var vx = -cam.x / cam.k;
        var vy = -cam.y / cam.k;
        var vw = rect.width / cam.k;
        var vh = rect.height / cam.k;
        var d = paperDrawn;
        if (!force && d && d.key === key && d.step === step && vx >= d.x && vy >= d.y && vx + vw <= d.x + d.w && vy + vh <= d.y + d.h) return;
        want = { x: vx - vw * PAPER_MARGIN, y: vy - vh * PAPER_MARGIN, w: vw * (1 + 2 * PAPER_MARGIN), h: vh * (1 + 2 * PAPER_MARGIN) };
      }
      var markup = '';
      try {
        var o = { x: want.x, y: want.y, w: want.w, h: want.h, mode: page ? 'page' : 'infinite', scale: scale, theme: look.theme, background: look.background };
        if (look.tile) o.tile = look.tile;
        markup = P.patternSvg(paper, o);
      } catch (err) {
        warn('the paper could not be drawn', err);
        markup = '';
      }
      paperG.innerHTML = markup;
      paintImage(want);
      paperDrawn = { x: want.x, y: want.y, w: want.w, h: want.h, step: step, key: key };
    }

    /* The picture of the look over the rectangle the paper covers: on a
     * page shown whole and centred, on the infinite sheet repeated at its
     * own size from the origin (as in the file, imageMarkup). */
    function paintImage(r) {
      var img = r ? look.image : null;
      if (!img) {
        if (imageNodes) {
          imageG.textContent = '';
          imageNodes = null;
        }
        return;
      }
      var isPage = !!page;
      var n = imageNodes;
      if (!n || n.page !== isPage || n.href !== img.href || n.w !== img.w || n.h !== img.h) {
        imageG.textContent = '';
        n = imageNodes = { page: isPage, href: img.href, w: img.w, h: img.h, image: null, rect: null };
        if (isPage) {
          n.image = svgEl('image', { 'class': 'mr-image', preserveAspectRatio: 'xMidYMid meet', href: img.href });
          imageG.appendChild(n.image);
        } else {
          var id = 'inkbg' + uid();
          var pdefs = svgEl('defs');
          var pattern = svgEl('pattern', { id: id, patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: num(img.w), height: num(img.h) });
          pattern.appendChild(svgEl('image', { width: num(img.w), height: num(img.h), href: img.href }));
          pdefs.appendChild(pattern);
          imageG.appendChild(pdefs);
          n.rect = svgEl('rect', { 'class': 'mr-image', fill: 'url(#' + id + ')' });
          imageG.appendChild(n.rect);
        }
      }
      var target = isPage ? n.image : n.rect;
      target.setAttribute('x', num(r.x));
      target.setAttribute('y', num(r.y));
      target.setAttribute('width', num(r.w));
      target.setAttribute('height', num(r.h));
    }

    /* The page bounds: the clip of everything drawn, the attribute the
     * stylesheet reads. */
    function applyPage() {
      if (page) {
        clipRect.setAttribute('width', num(page.w));
        clipRect.setAttribute('height', num(page.h));
        sceneG.setAttribute('clip-path', 'url(#' + clipId + ')');
        liveG.setAttribute('clip-path', 'url(#' + clipId + ')');
        root.setAttribute('data-page', '');
      } else {
        sceneG.removeAttribute('clip-path');
        liveG.removeAttribute('clip-path');
        root.removeAttribute('data-page');
      }
      if (bgNode) {
        if (page) bgNode.setAttribute('clip-path', 'url(#' + clipId + ')');
        else bgNode.removeAttribute('clip-path');
      }
    }

    function onPage(p) { return !page || (p[0] >= 0 && p[1] >= 0 && p[0] <= page.w && p[1] <= page.h); }

    /* A new look (the theme changed, the notebook's paper or background):
     * the sheet, the paper and every element drawn in the semantic ink are
     * painted again. */
    function takeLook(next) {
      look = resolveLook(next);
      root.style.setProperty('--ink-sheet', look.sheet);
      root.style.setProperty('--ink-on-sheet', look.ink);
      if (look.dark) root.setAttribute('data-sheet', 'dark');
      else root.removeAttribute('data-sheet');
      if (look.paper) root.setAttribute('data-paper', look.paper.type);
      else root.removeAttribute('data-paper');
    }

    function setLook(next) {
      if (closed) return;
      takeLook(next);
      repaintEverything();
    }

    function repaintEverything() {
      nodes.forEach(function (rec) { if (rec.node.parentNode) rec.node.parentNode.removeChild(rec.node); });
      nodes.clear();
      if (liveNode) liveNode.remove();
      liveNode = null;
      paintPaper(true);
      paintAll();
      updateToolbar();
      if (pop) refreshPop();
      if (textEdit) styleText();
    }

    function setCamera(next) {
      if (finite(next.k)) cam.k = clamp(next.k, ZOOM_MIN, ZOOM_MAX);
      if (finite(next.x)) cam.x = next.x;
      if (finite(next.y)) cam.y = next.y;
      applyCamera();
    }

    function zoomAt(cx, cy, factor) {
      var at = toScene(cx, cy);
      var k = clamp(cam.k * factor, ZOOM_MIN, ZOOM_MAX);
      cam.k = k;
      cam.x = cx - rect.left - at[0] * k;
      cam.y = cy - rect.top - at[1] * k;
      applyCamera();
    }

    function zoomBy(factor) {
      refreshRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }

    function zoomTo(k) { zoomBy(k / cam.k); }

    /* What the bars cover at the top and the bottom, so a fitted drawing is
     * not under them. Read when fitting, never while a hand moves. */
    function insets() {
      var top = 0;
      var bottom = 0;
      [toolsBar, actionsBar, zoomBar].forEach(function (bar) {
        if (bar.hidden || getComputedStyle(bar).display === 'none') return;
        var r = bar.getBoundingClientRect();
        if (!r.height) return;
        if (r.top - rect.top < rect.height / 2) top = Math.max(top, r.bottom - rect.top);
        else bottom = Math.max(bottom, rect.top + rect.height - r.top);
      });
      return { top: top, bottom: bottom };
    }

    function fit(maxK) {
      refreshRect();
      var W = rect.width;
      var H = rect.height;
      if (!W || !H) return false;
      var inset = insets();
      var margin = 24;
      var box = page ? [0, 0, page.w, page.h] : contentBox(elements, background);
      if (!box) {
        cam.k = 1;
        cam.x = W / 2;
        cam.y = inset.top + (H - inset.top - inset.bottom) / 2;
        applyCamera();
        return true;
      }
      var bw = Math.max(box[2] - box[0], 1);
      var bh = Math.max(box[3] - box[1], 1);
      var aw = Math.max(W - 2 * margin, 40);
      var ah = Math.max(H - inset.top - inset.bottom - 2 * margin, 40);
      var k = clamp(Math.min(aw / bw, ah / bh), ZOOM_MIN, maxK || 1);
      cam.k = k;
      cam.x = (W - bw * k) / 2 - box[0] * k;
      cam.y = inset.top + margin + (ah - bh * k) / 2 - box[1] * k;
      applyCamera();
      return true;
    }

    /* ---------------------------------------------------------------- painting */

    /* What a colour looks like on this sheet: the semantic ink is the
     * look's ink. */
    function shownColor(c) { return c === INK ? look.ink : c; }

    function paintBackground() {
      if (!background) {
        if (bgNode) bgNode.remove();
        bgNode = null;
        return;
      }
      if (!bgNode) {
        bgNode = svgEl('image', { 'class': 'ink__bg', preserveAspectRatio: 'none' });
        var title = svgEl('title');
        title.textContent = t('ink.background');
        bgNode.appendChild(title);
        world.insertBefore(bgNode, sceneG);
      }
      bgNode.setAttribute('x', background.x);
      bgNode.setAttribute('y', background.y);
      bgNode.setAttribute('width', background.w);
      bgNode.setAttribute('height', background.h);
      bgNode.setAttribute('href', background.href);
    }

    /* The elements on the sheet, one node per element kept by id and
     * rebuilt only when the element object changed. `faded` marks what the
     * eraser is about to take; `hidden` is the text being edited. */
    function paintScene(list, faded, hidden) {
      var prev = null;
      var keep = Object.create(null);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (hidden && el.id === hidden) continue;
        var rec = nodes.get(el.id);
        if (rec && rec.el !== el && el.type === 'image' && rec.el.type === 'image' && rec.el.href === el.href) {
          /* The same picture moved or resized: the node stays (its bytes are
           * not handed to the browser again at every frame of a drag). */
          rec.node.setAttribute('x', num(el.x));
          rec.node.setAttribute('y', num(el.y));
          rec.node.setAttribute('width', num(el.w));
          rec.node.setAttribute('height', num(el.h));
          rec.el = el;
        }
        if (!rec || rec.el !== el) {
          var node = specNode(specOf(el, null, look));
          node.setAttribute('data-id', el.id);
          if (rec && rec.node.parentNode) rec.node.parentNode.replaceChild(node, rec.node);
          rec = { el: el, node: node, faded: false };
          nodes.set(el.id, rec);
        }
        var fade = !!(faded && faded[el.id]);
        if (fade !== rec.faded) {
          rec.faded = fade;
          rec.node.style.opacity = fade ? String(FADED) : '';
          if (fade) rec.node.setAttribute('data-faded', '');
          else rec.node.removeAttribute('data-faded');
        }
        var want = prev ? prev.nextSibling : sceneG.firstChild;
        if (rec.node !== want) sceneG.insertBefore(rec.node, want);
        prev = rec.node;
        keep[el.id] = true;
      }
      nodes.forEach(function (rec, id) {
        if (keep[id]) return;
        if (rec.node.parentNode) rec.node.parentNode.removeChild(rec.node);
        nodes.delete(id);
      });
    }

    function paintLive() {
      var g = gesture;
      var draft = g && g.draft;
      if (!draft) {
        if (liveNode) liveNode.remove();
        liveNode = null;
        return;
      }
      if (draft.type === 'stroke' && liveNode && liveNode.getAttribute('data-kind') === 'stroke') {
        liveNode.setAttribute('d', strokeD(draft, 'live'));
        return;
      }
      var node = specNode(specOf(draft, 'live', look));
      node.setAttribute('data-kind', draft.type);
      if (liveNode) liveG.replaceChild(node, liveNode);
      else liveG.appendChild(node);
      liveNode = node;
    }

    function paintAll() {
      paintScene(elements, null, textEdit && textEdit.existing ? textEdit.existing.id : null);
      paintLive();
      paintOverlay();
    }

    function paintGesture() {
      var g = gesture;
      if (!g) return paintAll();
      if (g.kind === 'erase') paintScene(g.er.work, g.er.marked);
      else if (g.work) paintScene(g.work);
      paintLive();
      paintOverlay();
    }

    function schedulePaint() {
      if (frame || closed) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        if (!closed) paintGesture();
      });
    }

    /* ---------------------------------------------------------------- selection on screen */

    function selectedSet() {
      var set = Object.create(null);
      selection.forEach(function (id) { set[id] = true; });
      return set;
    }

    function selectedIn(list) {
      var set = selectedSet();
      return list.filter(function (el) { return set[el.id]; });
    }

    function selectionBox(list) { return unionBox(selectedIn(list || elements).map(boundsOf)); }

    function handleSize() { return coarse ? 12 : 8; }

    /* Where the handles of the selection stand, on screen: the two ends of
     * a single line or arrow, the corners and sides of a box otherwise. */
    function handleSpots(list) {
      var picked = selectedIn(list || elements);
      if (!picked.length) return [];
      if (picked.length === 1 && (picked[0].type === 'line' || picked[0].type === 'arrow')) {
        var p0 = toLocal(picked[0].points[0]);
        var p1 = toLocal(picked[0].points[1]);
        return [{ id: 'p0', x: p0[0], y: p0[1] }, { id: 'p1', x: p1[0], y: p1[1] }];
      }
      var box = unionBox(picked.map(boundsOf));
      var a = toLocal([box[0], box[1]]);
      var b = toLocal([box[2], box[3]]);
      var pad = 4;
      var x0 = a[0] - pad;
      var y0 = a[1] - pad;
      var x1 = b[0] + pad;
      var y1 = b[1] + pad;
      var xm = (x0 + x1) / 2;
      var ym = (y0 + y1) / 2;
      var spots = [
        { id: 'nw', x: x0, y: y0 }, { id: 'ne', x: x1, y: y0 }, { id: 'se', x: x1, y: y1 }, { id: 'sw', x: x0, y: y1 }
      ];
      /* Sides only when there is room for them between the corners. */
      if (x1 - x0 > handleSize() * 4) spots.push({ id: 'n', x: xm, y: y0 }, { id: 's', x: xm, y: y1 });
      if (y1 - y0 > handleSize() * 4) spots.push({ id: 'e', x: x1, y: ym }, { id: 'w', x: x0, y: ym });
      return spots;
    }

    function handleAt(cx, cy, type) {
      if (!selection.length || readOnly) return null;
      var x = cx - rect.left;
      var y = cy - rect.top;
      var reach = type === 'touch' ? 22 : Math.max(handleSize(), 9);
      var spots = handleSpots();
      for (var i = 0; i < spots.length; i++) {
        if (Math.abs(spots[i].x - x) <= reach && Math.abs(spots[i].y - y) <= reach) return spots[i];
      }
      return null;
    }

    function overlayRect(x, y, w, hgt, cls) {
      overlay.appendChild(svgEl('rect', { x: num(x), y: num(y), width: num(Math.max(w, 0)), height: num(Math.max(hgt, 0)), 'class': cls }));
    }

    function paintOverlay() {
      overlay.textContent = '';
      var g = gesture;
      if (g && g.kind === 'select' && g.mode === 'marquee' && g.box) {
        var m0 = toLocal([g.box[0], g.box[1]]);
        var m1 = toLocal([g.box[2], g.box[3]]);
        overlayRect(m0[0], m0[1], m1[0] - m0[0], m1[1] - m0[1], 'ink__marquee');
      }
      if (g && g.kind === 'erase' && g.er.mode === 'area' && g.er.loop.length > 1) {
        var pts = g.er.loop.map(toLocal);
        var d = 'M' + pts.map(function (p) { return num(p[0]) + ' ' + num(p[1]); }).join('L');
        overlay.appendChild(svgEl('path', { d: d, 'class': 'ink__lasso' }));
        var first = pts[0];
        var last = pts[pts.length - 1];
        overlay.appendChild(svgEl('path', { d: 'M' + num(last[0]) + ' ' + num(last[1]) + 'L' + num(first[0]) + ' ' + num(first[1]), 'class': 'ink__lasso ink__lasso--close' }));
      }
      paintLocks();
      var list = g && g.work ? g.work : elements;
      if (readOnly || textEdit || !selection.length || !selectedIn(list).length) {
        hideSelBar();
        if (!g) setHoverCursor('');
        return;
      }
      var spots = handleSpots(list);
      var single = spots.length === 2 && spots[0].id === 'p0';
      if (!single) {
        var nw = spots[0];
        var se = spots[2];
        overlayRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y, 'ink__frame');
      } else {
        overlay.appendChild(svgEl('path', { d: 'M' + num(spots[0].x) + ' ' + num(spots[0].y) + 'L' + num(spots[1].x) + ' ' + num(spots[1].y), 'class': 'ink__frame' }));
      }
      var hs = handleSize();
      spots.forEach(function (spot) {
        var node = svgEl('rect', { x: num(spot.x - hs / 2), y: num(spot.y - hs / 2), width: hs, height: hs, rx: single ? hs / 2 : 2, 'class': 'ink__handle', 'data-handle': spot.id });
        overlay.appendChild(node);
      });
      if (g) hideSelBar();
      else {
        var picked = selectedIn(list);
        var inked = picked.filter(function (el) { return !isPicture(el); });
        selColorBtn.hidden = !inked.length;
        if (inked.length) selColorBtn.style.setProperty('--swatch', shownColor(inked[inked.length - 1].color));
        lockBtn.hidden = !picked.some(isPicture);
        placeSelBar(spots);
      }
    }

    function hideSelBar() {
      if (selBar.hidden) return;
      /* A button that vanishes under the focus would leave the keys with
       * nowhere to go: the sheet takes them. */
      if (pop && selBar.contains(pop.anchor)) closePop(false);
      if (selBar.contains(document.activeElement)) focusRoot();
      selBar.hidden = true;
    }

    /* The little bar of what can be done to a selection, above it (below
     * when there is no room above), kept inside the editor. */
    function placeSelBar(spots) {
      if (selBar.hidden) {
        selBar.hidden = false;
        selBarSize = null;
      }
      if (!selBarSize) selBarSize = { w: selBar.offsetWidth, h: selBar.offsetHeight };
      var xs = spots.map(function (p) { return p.x; });
      var ys = spots.map(function (p) { return p.y; });
      var left = Math.min.apply(null, xs);
      var right = Math.max.apply(null, xs);
      var top = Math.min.apply(null, ys);
      var bottom = Math.max.apply(null, ys);
      var gap = 14;
      var x = (left + right) / 2 - selBarSize.w / 2;
      var y = top - gap - selBarSize.h;
      /* Clear of the bars: the actions are at the top in both layouts, the
       * tools at the bottom on a phone. */
      var minTop = 8 + selBarSize.h + 8;
      var maxTop = rect.height - selBarSize.h - 8 - (layout === 'compact' ? selBarSize.h + 16 : 0);
      if (y < minTop) y = bottom + gap;
      x = clamp(x, 8, Math.max(8, rect.width - selBarSize.w - 8));
      y = clamp(y, 8, Math.max(8, maxTop));
      selBar.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }

    /* ---------------------------------------------------------------- history and saving */

    function sameScene(a, b) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    /* One step of undo. `key` coalesces repeated small steps (arrow-key
     * nudges) into the one step they read as. */
    function commit(next, key) {
      if (closed || readOnly || next === elements || sameScene(next, elements)) return false;
      var t0 = now();
      var coalesce = key && key === lastKey && t0 - lastKeyAt < 1000 && undoStack.length;
      if (!coalesce) {
        undoStack.push(elements);
        if (undoStack.length > HISTORY) undoStack.shift();
      }
      lastKey = key || null;
      lastKeyAt = t0;
      redoStack = [];
      elements = next;
      afterChange();
      return true;
    }

    function exists(id) {
      for (var i = 0; i < elements.length; i++) if (elements[i].id === id) return true;
      return false;
    }

    function afterChange() {
      selection = selection.filter(exists);
      paintAll();
      paintHistory();
      /* "The editable part could not be read" is in the way once the
       * drawing over it has begun. */
      if (noticeKey === 'ink.notice.damaged' && undoStack.length) hideNotice();
      if (isDirtyNow()) {
        refreshSaveState();
        scheduleSave();
      } else {
        clearTimeout(saveTimer);
        saveTimer = 0;
        refreshSaveState();
      }
      if (typeof opts.onChange === 'function') {
        try { opts.onChange({ dirty: isDirtyNow(), count: elements.length }); } catch (err) { warn('onChange failed', err); }
      }
    }

    /* A host with a history of its own (a notebook: its strokes are steps
     * of the app's one labelled history, beside its settings and pages)
     * takes undo and redo, from the keys and the buttons alike. A gesture
     * under way is put back first and that is the whole undo; otherwise
     * the words being written go on the sheet and the drawing is handed
     * over, so the host's last step is the latest one. */
    function hosted() { return !!(opts.history && typeof opts.history.undo === 'function' && typeof opts.history.redo === 'function'); }

    function hostHistory(which) {
      if (readOnly || closed) return false;
      if (gesture) {
        var drew = gesture.kind !== 'pan';
        abandon(gesture);
        if (drew && which === 'undo') return true;
      }
      if (textEdit) commitText();
      saveNow();
      try { opts.history[which](); } catch (err) { warn('the host\'s ' + which + ' failed', err); }
      return true;
    }

    function hostState() {
      var st = null;
      try { st = typeof opts.history.state === 'function' ? opts.history.state() : null; } catch (err) { st = null; }
      return {
        undo: !!(st && st.undo) || isDirtyNow(),
        redo: !!(st && st.redo) && !isDirtyNow()
      };
    }

    function undo() {
      if (hosted()) return hostHistory('undo');
      if (readOnly || closed) return false;
      if (gesture) abandon(gesture);
      if (textEdit) commitText();
      if (!undoStack.length) return false;
      redoStack.push(elements);
      elements = undoStack.pop();
      lastKey = null;
      afterChange();
      return true;
    }

    function redo() {
      if (hosted()) return hostHistory('redo');
      if (readOnly || closed) return false;
      if (gesture) abandon(gesture);
      if (textEdit) commitText();
      if (!redoStack.length) return false;
      undoStack.push(elements);
      elements = redoStack.pop();
      lastKey = null;
      afterChange();
      return true;
    }

    /* A button that turns disabled under the focus drops it to the page,
     * and every key after that would reach the app: the other one of the
     * pair takes it, or the sheet. */
    function paintHistory() {
      var active = document.activeElement;
      var hs = hosted() ? hostState() : { undo: !!undoStack.length, redo: !!redoStack.length };
      imageBtn.disabled = readOnly;
      undoBtn.disabled = readOnly || !hs.undo;
      redoBtn.disabled = readOnly || !hs.redo;
      if ((active === undoBtn || active === redoBtn) && active.disabled) {
        var other = active === undoBtn ? redoBtn : undoBtn;
        if (!other.disabled && shown(other)) other.focus();
        else focusRoot();
      }
    }

    function isDirtyNow() { return signature(elements, background) !== savedSig; }

    /* The drawing as its file: on its page and its paper when it has them. */
    function fileSvg() {
      return serialize({
        elements: elements, background: background, page: page, paper: look.paper,
        sheet: look.background, tile: look.tile,
        image: look.image && look.image.fileHref ? { href: look.image.fileHref, w: look.image.w, h: look.image.h } : null
      });
    }

    /* While a hand is drawing the save waits (writing a big file mid-stroke
     * would stutter the line, and the gesture ends in a commit that asks
     * again). A text being written does not hold it back: what is already
     * on the sheet is saved while the words are still being typed. */
    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveTimer = 0;
        if (closed) return;
        if (gesture) scheduleSave();
        else saveNow();
      }, SAVE_DELAY);
    }

    /* Hand the picture to the host, if it changed since the last time. The
     * host may answer at once or with a promise; a throw, a rejection or a
     * plain false means it was not kept, and the drawing stays to be saved.
     * Says what happened: 'unchanged', 'saved', 'failed' or 'pending' (with
     * `settle`, a promise of 'saved' or 'failed'), and the svg handed over. */
    function saveNow() {
      clearTimeout(saveTimer);
      saveTimer = 0;
      var sig = signature(elements, background);
      if (sig === savedSig) return { status: 'unchanged', svg: null };
      var svg = fileSvg();
      savedSig = sig;
      currentText = svg;
      if (typeof opts.onSave !== 'function') {
        kept(sig, true);
        return { status: 'saved', svg: svg };
      }
      var result;
      inSave = true;
      try {
        result = opts.onSave(svg, { count: elements.length, page: pageId });
      } catch (err) {
        inSave = false;
        warn('saving failed', err);
        lost(sig);
        settled();
        return { status: 'failed', svg: svg };
      }
      inSave = false;
      if (result === false) {
        lost(sig);
        settled();
        return { status: 'failed', svg: svg };
      }
      if (result && typeof result.then === 'function') {
        pendingSaves++;
        refreshSaveState();
        var settle = Promise.resolve(result).then(function (value) { return value !== false; }, function (err) {
          warn('saving failed', err);
          return false;
        }).then(function (ok) {
          pendingSaves--;
          if (ok) kept(sig, savedSig === sig);
          else lost(sig);
          settled();
          return ok ? 'saved' : 'failed';
        });
        return { status: 'pending', svg: svg, settle: settle };
      }
      kept(sig, true);
      settled();
      return { status: 'saved', svg: svg };
    }

    /* `latest`: no later save was handed over meanwhile, so this one is
     * what the host now holds. */
    function kept(sig, latest) {
      everSaved = true;
      if (latest) {
        confirmedSig = sig;
        saveFailed = false;
      }
      refreshSaveState();
    }

    function lost(sig) {
      if (savedSig === sig) savedSig = confirmedSig;
      saveFailed = true;
      refreshSaveState();
    }

    /* Nothing more to hear from the host: whoever waits for the saves to be
     * over (Done, a close) goes on. */
    function settled() {
      if (inSave || pendingSaves) return;
      var list = settleWaiters;
      settleWaiters = [];
      list.forEach(function (fn) { fn(); });
      maybeEnd();
    }

    function whenSettled(fn) {
      if (!inSave && !pendingSaves) fn();
      else settleWaiters.push(fn);
    }

    function say(text, urgent) {
      var el = urgent ? alertEl : announcer;
      /* The same words twice in a row are a change too. */
      if (el.textContent === text) el.textContent = '';
      el.textContent = text;
    }

    function refreshSaveState(quiet) {
      var next;
      var dirty = isDirtyNow();
      if (pendingSaves) next = 'saving';
      else if (dirty && saveFailed) next = 'failed';
      else if (readOnly) next = 'readonly';
      else if (dirty) next = 'dirty';
      else next = everSaved ? 'saved' : 'clean';
      if (next === saveState) return;
      saveState = next;
      root.setAttribute('data-save', next);
      statusText.textContent = next === 'clean' ? '' : t('ink.status.' + next);
      status.title = t('ink.status.' + next);
      if (quiet) return;
      /* Said aloud only when it means something: every stroke going
       * through "unsaved" and "saved" would be noise to someone drawing. The
       * first save is said, a failure is said, and so is the save that
       * comes after a failure. */
      if (next === 'failed') {
        say(t('ink.status.failed'));
        failedSaid = true;
      } else if (next === 'readonly') {
        say(t('ink.status.readonly'));
      } else if (next === 'saved' && (!savedSaid || failedSaid)) {
        say(t('ink.status.saved'));
        savedSaid = true;
        failedSaid = false;
      }
    }

    /* ---------------------------------------------------------------- text */

    function textAt(p) {
      for (var i = elements.length - 1; i >= 0; i--) {
        var el = elements[i];
        if (el.type === 'text' && touches(el, p, p, HIT / cam.k)) return el;
      }
      return null;
    }

    function beginText(at, existing) {
      if (readOnly) return;
      var size = existing ? existing.size : TEXT_SIZES[s.text.size];
      textEdit = {
        existing: existing || null,
        x: existing ? existing.x : at[0],
        y: existing ? existing.y : at[1] - size * LINE_HEIGHT / 2,
        size: size,
        color: existing ? existing.color : s.text.color
      };
      ta.value = existing ? existing.text : '';
      ta.hidden = false;
      root.setAttribute('data-typing', '');
      styleText();
      placeText();
      closePop(false);
      paintAll();
      try { ta.focus({ preventScroll: true }); } catch (err) { ta.focus(); }
      var end = ta.value.length;
      try { ta.setSelectionRange(end, end); } catch (err) { /* not focusable yet */ }
    }

    /* The field is laid out at a real font size of at least 16px (smaller
     * makes iOS zoom the page on focus) and scaled to the sheet. */
    function styleText() {
      var te = textEdit;
      if (!te) return;
      var F = Math.max(16, te.size);
      var m = measureText(ta.value || ' ', F);
      ta.style.fontFamily = FONT;
      ta.style.fontSize = F + 'px';
      ta.style.lineHeight = String(LINE_HEIGHT);
      ta.style.color = shownColor(te.color);
      ta.style.width = Math.ceil(m.w + F) + 'px';
      ta.style.height = Math.ceil(m.h) + 'px';
    }

    function placeText() {
      var te = textEdit;
      if (!te) return;
      var p = toLocal([te.x, te.y]);
      var F = Math.max(16, te.size);
      ta.style.transform = 'translate(' + num(p[0]) + 'px,' + num(p[1]) + 'px) scale(' + (cam.k * te.size / F) + ')';
    }

    /* The words in the field as they would be kept. */
    function typedText() { return cleanText(ta.value).replace(/\s+$/, ''); }

    /* Whether the open field holds anything the scene does not: an empty
     * field, or a text opened and left as it was, is nothing to save. */
    function textPending() {
      var te = textEdit;
      if (!te) return false;
      var text = typedText();
      if (!te.existing) return !!text.trim();
      return isEdited(te, text);
    }

    /* A text opened and given back as it was is no edit, though the field
     * trims what trails its last line and a file may keep it. */
    function isEdited(te, text) {
      var old = te.existing;
      return text !== old.text.replace(/\s+$/, '') || te.color !== old.color || te.size !== old.size;
    }

    function commitText() {
      var te = textEdit;
      if (!te) return;
      textEdit = null;
      var text = typedText();
      var hadFocus = document.activeElement === ta;
      ta.hidden = true;
      ta.value = '';
      root.removeAttribute('data-typing');
      var next = elements;
      if (te.existing) {
        var old = te.existing;
        if (!text.trim()) {
          next = elements.filter(function (el) { return el.id !== old.id; });
        } else if (isEdited(te, text)) {
          var m = measureText(text, te.size);
          var edited = changed(old, { text: text, color: te.color, size: te.size, w: m.w, h: m.h });
          next = elements.map(function (el) { return el.id === old.id ? edited : el; });
        }
      } else if (text.trim()) {
        var made = makeText(te.x, te.y, text, { size: te.size, color: te.color });
        next = elements.concat([made]);
      }
      if (!commit(next)) paintAll();
      if (hadFocus) focusRoot();
    }

    /* ---------------------------------------------------------------- changing the scene */

    function deleteSelection() {
      if (readOnly || !selection.length) return false;
      var set = selectedSet();
      selection = [];
      return commit(elements.filter(function (el) { return !set[el.id]; }));
    }

    function duplicateSelection() {
      if (readOnly || !selection.length) return false;
      var set = selectedSet();
      var copies = [];
      elements.forEach(function (el) {
        if (!set[el.id]) return;
        var copy = translateEl(el, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
        copy.id = uid();
        copies.push(copy);
      });
      if (!copies.length) return false;
      selection = copies.map(function (el) { return el.id; });
      return commit(elements.concat(copies));
    }

    /* ---------------------------------------------------------------- pictures */

    function isPicture(el) { return el && el.type === 'image'; }

    /* A locked picture cannot be selected, moved or erased, so writing and
     * drawing over it never drags it along; a small padlock on it (with the
     * select tool) gives it back. */
    function lockSelection(on) {
      if (readOnly || !selection.length) return false;
      var set = selectedSet();
      var ok = commit(elements.map(function (el) { return set[el.id] && isPicture(el) && !!el.locked !== on ? changed(el, { locked: on }) : el; }));
      if (ok && on) {
        selection = selection.filter(function (id) { return !(elementById(id) || {}).locked; });
        paintOverlay();
        say(t('ink.locked'));
      }
      return ok;
    }

    function elementById(id) {
      for (var i = 0; i < elements.length; i++) if (elements[i].id === id) return elements[i];
      return null;
    }

    function lockSpot(el) {
      var p = toLocal([el.x, el.y]);
      return { x: p[0] + 16, y: p[1] + 16 };
    }

    function paintLocks() {
      if (tool !== 'select' || readOnly || textEdit) return;
      var list = gesture && gesture.work ? gesture.work : elements;
      list.forEach(function (el) {
        if (!isPicture(el) || !el.locked) return;
        var at = lockSpot(el);
        var grp = svgEl('g', { 'class': 'ink__lock', transform: 'translate(' + num(at.x) + ' ' + num(at.y) + ')', 'data-lock': el.id });
        grp.appendChild(svgEl('circle', { r: 13, 'class': 'ink__lock-disc' }));
        var glyph = svgEl('svg', { x: -8, y: -8, width: 16, height: 16, viewBox: '0 0 24 24', 'class': 'ink__lock-icon' });
        glyph.innerHTML = ICONS.lock;
        grp.appendChild(glyph);
        overlay.appendChild(grp);
      });
    }

    function lockAt(cx, cy, type) {
      if (tool !== 'select' || readOnly) return null;
      var x = cx - rect.left;
      var y = cy - rect.top;
      var reach = type === 'touch' ? 22 : 16;
      for (var i = elements.length - 1; i >= 0; i--) {
        var el = elements[i];
        if (!isPicture(el) || !el.locked) continue;
        var at = lockSpot(el);
        if (Math.abs(at.x - x) <= reach && Math.abs(at.y - y) <= reach) return el;
      }
      return null;
    }

    function tell(text) {
      say(text, true);
      try { if (ns.ui && typeof ns.ui.toast === 'function') ns.ui.toast(text, { kind: 'error' }); } catch (err) { /* said already */ }
    }

    /* A file or a data URL as a picture for the sheet: its bytes as a data
     * URL and its size. A big one is scaled down (the longest side to
     * IMAGE_MAX_SIDE) and kept as JPEG, WebP or PNG; a picture that is still
     * too big for the file is refused. */
    function loadPicture(src) {
      return new Promise(function (resolve, reject) {
        function fail(code) { reject(new Error(code)); }
        function decoded(href, type, bytes) {
          var img = new Image();
          img.onerror = function () { fail('failed'); };
          img.onload = function () {
            var nw = img.naturalWidth || 320;
            var nh = img.naturalHeight || 200;
            var svg = /svg/i.test(type);
            var out = href;
            if (!svg && (Math.max(nw, nh) > IMAGE_MAX_SIDE || (bytes > 3 * 1024 * 1024 && type !== 'image/gif'))) {
              var f = Math.min(1, IMAGE_MAX_SIDE / Math.max(nw, nh));
              var cv = document.createElement('canvas');
              cv.width = Math.max(1, Math.round(nw * f));
              cv.height = Math.max(1, Math.round(nh * f));
              try {
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                var want = type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
                out = cv.toDataURL(want, 0.88);
                if (out.indexOf('data:' + want) !== 0) out = cv.toDataURL('image/png');
                nw = cv.width;
                nh = cv.height;
              } catch (err) { out = href; }
            }
            if (out.length > IMAGE_MAX_CHARS) return fail('big');
            resolve({ href: out, w: nw, h: nh });
          };
          img.src = href;
        }
        if (typeof src === 'string') {
          if (!isImageDataUrl(src)) return fail('type');
          if (src.length > IMAGE_MAX_CHARS * 2) return fail('big');
          return decoded(src, (/^data:([^;,]+)/.exec(src) || [])[1] || '', src.length * 0.75);
        }
        if (!src || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/i.test(src.type || '')) return fail('type');
        if (src.size > 40 * 1024 * 1024) return fail('big');
        var reader = new FileReader();
        reader.onerror = function () { fail('failed'); };
        reader.onload = function () { decoded(String(reader.result), src.type.toLowerCase(), src.size); };
        reader.readAsDataURL(src);
      });
    }

    /* A picture put on the sheet (src: a File, a Blob or an image data URL;
     * at: the scene point for its middle, else the middle of what is in
     * view): behind the ink already there, ink and writing go over it. One
     * undo step; it is left selected, with the select tool. */
    function insertImage(src, at) {
      if (readOnly || closed) return Promise.resolve(null);
      return loadPicture(src).then(function (pic) {
        if (readOnly || closed) return null;
        refreshRect();
        var visW = rect.width / cam.k;
        var visH = rect.height / cam.k;
        var f = Math.min(1, 0.6 * visW / pic.w, 0.6 * visH / pic.h);
        var w = Math.max(8, pic.w * f);
        var hh = Math.max(8, pic.h * f);
        var c = at && finite(at[0]) && finite(at[1]) ? at : toScene(rect.left + rect.width / 2, rect.top + rect.height / 2);
        var el = { id: uid(), type: 'image', version: nextVersion(), x: c[0] - w / 2, y: c[1] - hh / 2, w: w, h: hh, href: pic.href, locked: false };
        if (textEdit) commitText();
        if (!commit([el].concat(elements))) return null;
        selection = [el.id];
        if (tool !== 'select') setTool('select', true);
        paintOverlay();
        updateToolbar();
        say(t('ink.image.added'));
        return el.id;
      }, function (err) {
        var code = err && err.message;
        tell(t(code === 'type' ? 'ink.image.badType' : (code === 'big' ? 'ink.image.tooBig' : 'ink.image.failed')));
        return null;
      });
    }

    function pickImage() {
      if (readOnly || closed) return Promise.resolve(null);
      var accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
      var pick;
      if (ns.util && ns.util.pickFiles) pick = ns.util.pickFiles({ accept: accept });
      else {
        /* On a page without the app's helpers (a host of its own). */
        pick = new Promise(function (resolve) {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = accept;
          input.style.display = 'none';
          input.addEventListener('change', function () { resolve(Array.prototype.slice.call(input.files || [])); input.remove(); });
          input.addEventListener('cancel', function () { resolve([]); input.remove(); });
          document.body.appendChild(input);
          input.click();
        });
      }
      return pick.then(function (files) {
        return files && files.length ? insertImage(files[0], null) : null;
      });
    }

    function bringToFront() {
      if (readOnly || !selection.length) return false;
      var set = selectedSet();
      var rest = elements.filter(function (el) { return !set[el.id]; });
      var picked = elements.filter(function (el) { return set[el.id]; });
      return commit(rest.concat(picked));
    }

    /* Dragging through the colour field recolours many times a second:
     * one undo step for the lot. */
    function recolorSelection(hex) {
      var set = selectedSet();
      return commit(elements.map(function (el) { return set[el.id] && el.type !== 'image' && el.color !== hex ? changed(el, { color: hex }) : el; }), 'recolor');
    }

    function nudge(dx, dy) {
      var set = selectedSet();
      return commit(elements.map(function (el) { return set[el.id] ? translateEl(el, dx, dy) : el; }), 'nudge');
    }

    function selectAll() {
      selection = elements.filter(function (el) { return !el.locked; }).map(function (el) { return el.id; });
      if (tool !== 'select') setTool('select', true);
      paintOverlay();
    }

    function select(ids) {
      selection = (ids || []).filter(exists);
      paintOverlay();
      updateToolbar();
    }

    function hitAt(p, reach) {
      for (var i = elements.length - 1; i >= 0; i--) {
        if (elements[i].locked) continue;
        if (touches(elements[i], p, p, reach)) return elements[i];
      }
      return null;
    }

    /* ---------------------------------------------------------------- laser pointer */

    var LASER_LIFE = 700;

    function laserPath(pts) {
      if (pts.length < 2) return '';
      var d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
      for (var i = 1; i < pts.length; i++) d += 'L' + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1);
      return d;
    }

    function paintLaser() {
      laserFrame = 0;
      if (closed) return;
      var t0 = now();
      var held = !!(gesture && gesture.laser);
      /* The head stays while the pen is down; the tail fades from behind. */
      var last = laserTrail[laserTrail.length - 1];
      laserTrail = laserTrail.filter(function (p) { return t0 - p.t < LASER_LIFE || (held && p === last); });
      var keep = laserTrail;
      if (!keep.length) {
        laserSvg.setAttribute('data-off', '');
        laserGlow.removeAttribute('d');
        laserCore.removeAttribute('d');
        return;
      }
      laserSvg.removeAttribute('data-off');
      var d = laserPath(keep);
      laserGlow.setAttribute('d', d);
      laserCore.setAttribute('d', d);
      var head = keep[keep.length - 1];
      laserDot.setAttribute('cx', head.x.toFixed(1));
      laserDot.setAttribute('cy', head.y.toFixed(1));
      var age = held ? 0 : (t0 - head.t) / LASER_LIFE;
      laserSvg.style.opacity = String(Math.max(0, 1 - age * age));
      laserFrame = requestAnimationFrame(paintLaser);
    }

    function laserTo(clientX, clientY) {
      laserTrail.push({ x: clientX - rect.left, y: clientY - rect.top, t: now() });
      if (laserTrail.length > 400) laserTrail.splice(0, laserTrail.length - 400);
      if (!laserFrame) laserFrame = requestAnimationFrame(paintLaser);
    }

    function setLaser(on) {
      on = !!on && !readOnly;
      if (on === laserOn) return;
      laserOn = on;
      laserTrail = [];
      root.toggleAttribute('data-laser', on);
      if (on) say(t('ink.laser.on'));
      updateToolbar();
      updateCursor();
    }

    /* ---------------------------------------------------------------- tools */

    function setTool(name, keepSelection) {
      if (TOOLS.indexOf(name) < 0) return false;
      if (readOnly && name !== 'hand') return false;
      if (gesture) return false;
      if (textEdit) commitText();
      hideCoach();
      if (name === 'eraser' && tool !== 'eraser') toolBeforeEraser = tool;
      tool = name;
      if (name !== 'hand' && !readOnly) s.tool = name;
      if (SHAPES.indexOf(name) >= 0) s.shape = name;
      rememberSettings();
      if (name !== 'select' && !keepSelection && selection.length) {
        selection = [];
        paintOverlay();
      }
      closePop(false);
      updateToolbar();
      updateCursor();
      return true;
    }

    /* The eraser gives back whatever was in hand before it. */
    function toggleEraser() {
      if (tool === 'eraser') return setTool(toolBeforeEraser && toolBeforeEraser !== 'eraser' ? toolBeforeEraser : 'pen');
      return setTool('eraser');
    }

    function choosePen(id) {
      if (!penById(id)) return;
      s.pen = id;
      rememberSettings();
      if (tool !== 'pen') setTool('pen');
      else updateToolbar();
    }

    function styleTarget() {
      if (textEdit) return 'text';
      if (tool === 'select' && selection.length) return 'selection';
      if (tool === 'pen') return 'pen';
      if (SHAPES.indexOf(tool) >= 0) return 'shape';
      if (tool === 'text') return 'text';
      if (tool === 'eraser') return 'eraser';
      return 'pen';
    }

    function currentColor() {
      var target = styleTarget();
      if (target === 'text') return textEdit ? textEdit.color : s.text.color;
      if (target === 'shape') return s.shapes.color;
      if (target === 'selection') {
        var picked = selectedIn(elements);
        return picked.length ? picked[picked.length - 1].color : s.pens[s.pen].color;
      }
      return s.pens[s.pen].color;
    }

    /* `live` is the native colour field being dragged: the popover is
     * updated in place, since rebuilding it would take the field (and the
     * system picker hanging off it) away under the hand. */
    function pickColor(hex, live) {
      if (!isColor(hex)) return;
      hex = cleanColor(hex);
      var target = styleTarget();
      if (target === 'selection') recolorSelection(hex);
      else if (target === 'text') {
        s.text.color = hex;
        if (textEdit) {
          textEdit.color = hex;
          styleText();
        }
      } else if (target === 'shape') s.shapes.color = hex;
      else s.pens[s.pen].color = hex;
      if (!SWATCHES.some(function (sw) { return sw.hex === hex; })) s.custom = hex;
      rememberSettings();
      if (live) {
        updateToolbar();
        markColors(hex);
        paintNib();
      } else {
        refreshPop();
      }
    }

    function markColors(hex) {
      var isCustom = !SWATCHES.some(function (sw) { return sw.hex === hex; });
      var radios = popEl.querySelectorAll('.ink__colors [role="radio"]');
      for (var i = 0; i < radios.length; i++) {
        var value = radios[i].getAttribute('data-value');
        var on = value === 'custom' ? isCustom : value === hex;
        radios[i].setAttribute('aria-checked', String(on));
        radios[i].tabIndex = on ? 0 : -1;
        if (value === 'custom' && isCustom) {
          radios[i].style.setProperty('--swatch', hex);
          var plus = radios[i].querySelector('.ink__icon');
          if (plus) plus.remove();
        }
      }
    }

    function setPenSize(v) {
      var size = clamp(Math.round(Number(v) * 2) / 2 || PEN_MIN, PEN_MIN, PEN_MAX);
      s.pens[s.pen].size = size;
      rememberSettings();
      refreshNibCursor();
      paintNib();
    }

    function setEraser(mode, size) {
      if (ERASER_MODES.indexOf(mode) >= 0) s.eraser.mode = mode;
      if (size != null) s.eraser.size = eraserSize(size);
      rememberSettings();
      updateCursor();
      paintNib();
    }

    function setTextSize(key) {
      if (!TEXT_SIZES[key]) return;
      s.text.size = key;
      if (textEdit) {
        textEdit.size = TEXT_SIZES[key];
        styleText();
        placeText();
      }
      rememberSettings();
    }

    /* ---------------------------------------------------------------- the toolbar */

    function updateToolbar() {
      TOOLS.forEach(function (id) {
        var b = toolButtons[id];
        if (!b) return;
        var on = tool === id;
        var label = toolLabel(id);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', label);
        /* The tooltip tells what a second press does; the name stays the
         * name, with aria-pressed saying it is in hand. */
        if (on && (id === 'pen' || id === 'eraser' || id === 'text' || SHAPES.indexOf(id) >= 0)) label = t('ink.againForOptions', { label: label });
        tip(b, label, [TOOL_KEYS[id]]);
      });
      var showLaser = tool === 'pen' && !readOnly;
      if (!showLaser && laserOn) { laserOn = false; laserTrail = []; root.removeAttribute('data-laser'); }
      laserBtn.disabled = readOnly;
      laserBtn.setAttribute('aria-pressed', String(laserOn));
      laserBtn.setAttribute('aria-label', t('ink.laser'));
      tip(laserBtn, t('ink.laser'), null);
      var penBtn = toolButtons.pen;
      var penIcon = penBtn.querySelector('.ink__icon');
      if (penIcon.getAttribute('data-icon') !== s.pen) {
        var fresh = icon(s.pen);
        fresh.setAttribute('data-icon', s.pen);
        penBtn.replaceChild(fresh, penIcon);
      }
      penBtn.style.setProperty('--swatch', shownColor(s.pens[s.pen].color));
      var shapeOn = SHAPES.indexOf(tool) >= 0;
      shapeBtn.setAttribute('aria-pressed', String(shapeOn));
      var shapeIcon = shapeBtn.querySelector('.ink__icon');
      if (shapeIcon.getAttribute('data-icon') !== s.shape) {
        var next = icon(s.shape);
        next.setAttribute('data-icon', s.shape);
        shapeBtn.replaceChild(next, shapeIcon);
      }
      styleBtn.style.setProperty('--swatch', shownColor(currentColor()));
      root.setAttribute('data-tool', tool);
      refreshNibCursor();
      paintHistory();
    }

    function updateCursor() {
      root.setAttribute('data-tool', tool);
      root.setAttribute('data-eraser', s.eraser.mode);
      var d = s.eraser.size;
      cursor.style.width = d + 'px';
      cursor.style.height = d + 'px';
      if (tool !== 'eraser' && !(gesture && gesture.kind === 'erase')) cursor.hidden = true;
      if (tool !== 'select') setHoverCursor('');
      refreshNibCursor();
    }

    /* The pen's pointer: the nib in hand at its size on screen, in its
     * colour, on this sheet. Called when any of those may have changed
     * (the toolbar, the camera, the look, the size); the key makes every
     * call after the first a string comparison. */
    function refreshNibCursor() {
      var spec = null;
      var key = '';
      if (tool === 'pen' && !laserOn && !readOnly && !(forcedQuery && forcedQuery.matches)) {
        var preset = penById(s.pen) || PENS[0];
        var held = s.pens[s.pen] || preset;
        var bar = preset.id === 'highlighter';
        var d = Math.max(NIB_MIN, Number(held.size * cam.k) || 0);
        spec = {
          shape: bar ? 'bar' : 'dot',
          w: bar ? Math.max(NIB_MIN, d * 0.45) : d,
          h: d,
          color: shownColor(held.color),
          ring: look.dark ? NIB_LIGHT_RING : NIB_DARK_RING,
          halo: look.sheet
        };
        key = [spec.shape, num(spec.w), num(spec.h), spec.color, spec.ring, spec.halo].join('|');
      }
      if (key === nibKey) return;
      nibKey = key;
      nibBuilds++;
      if (spec) {
        nibW = spec.w;
        nibH = spec.h;
        nib.style.width = num(spec.w) + 'px';
        nib.style.height = num(spec.h) + 'px';
        nib.style.borderRadius = spec.shape === 'bar' ? num(Math.min(spec.w, spec.h) * 0.3) + 'px' : '50%';
        nib.style.setProperty('--nib-color', spec.color);
        nib.style.setProperty('--nib-ring', spec.ring);
        nib.style.setProperty('--nib-halo', spec.halo);
        root.setAttribute('data-nib', spec.shape);
      } else {
        root.removeAttribute('data-nib');
        root.removeAttribute('data-nib-live');
        nib.hidden = true;
      }
    }

    /* Over the selection the arrow says what a press there does: move it,
     * or, on a handle, resize it. Only an attribute, and only when it
     * changes. */
    var HANDLE_CURSORS = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew', p0: 'move', p1: 'move' };
    function setHoverCursor(kind) {
      if (kind === hoverCursor) return;
      hoverCursor = kind;
      if (kind) root.setAttribute('data-hover', kind);
      else root.removeAttribute('data-hover');
    }

    function selectHover(cx, cy, type) {
      if (tool !== 'select' || readOnly || textEdit || !selection.length) return '';
      var handle = handleAt(cx, cy, type);
      if (handle) return HANDLE_CURSORS[handle.id] || 'move';
      var box = selectionBox();
      if (!box) return '';
      var at = toScene(cx, cy);
      return at[0] >= box[0] && at[0] <= box[2] && at[1] >= box[1] && at[1] <= box[3] ? 'move' : '';
    }

    /* The nib follows the mouse or the pen over the sheet; a stroke being
     * drawn hides it (the line is the nib then). */
    function showNib(cx, cy) {
      if (nibKey === '' || nibKey === null || gesture) {
        if (!nib.hidden) nib.hidden = true;
        return;
      }
      nib.style.transform = 'translate(' + num(cx - rect.left - nibW / 2) + 'px,' + num(cy - rect.top - nibH / 2) + 'px)';
      if (nib.hidden) nib.hidden = false;
      if (!root.hasAttribute('data-nib-live')) root.setAttribute('data-nib-live', '');
    }

    function showCursor(cx, cy, forced) {
      showNib(cx, cy);
      var erasing = forced || (tool === 'eraser' && !readOnly);
      if (!erasing || s.eraser.mode === 'area') {
        if (!cursor.hidden) cursor.hidden = true;
        return;
      }
      var r = s.eraser.size / 2;
      cursor.style.transform = 'translate(' + num(cx - rect.left - r) + 'px,' + num(cy - rect.top - r) + 'px)';
      if (cursor.hidden) cursor.hidden = false;
    }

    /* A tool pressed is taken in hand; pressed again, or on its chevron,
     * it opens its options (taken in hand first if need be). */
    function toolPressed(name, btn, e) {
      if (readOnly && name !== 'hand') return;
      var kind = optionsOf(name);
      if (kind && (tool === name || onCaret(e))) {
        if (tool !== name && !setTool(name)) return;
        toolOptions(kind, btn, e);
        return;
      }
      if (setTool(name) && kind) offerCoach(kind, btn, e);
    }

    function shapesPressed(btn, e) {
      if (readOnly) return;
      if (SHAPES.indexOf(tool) >= 0 || onCaret(e)) {
        if (SHAPES.indexOf(tool) < 0 && !setTool(s.shape)) return;
        toolOptions('shape', btn, e);
        return;
      }
      if (setTool(s.shape)) offerCoach('shape', btn, e);
    }

    function toolOptions(kind, btn, e) {
      hideCoach();
      var c = coachState();
      if (!c.used) {
        c.used = true;
        writeCoach();
      }
      togglePop(kind, btn, e);
    }

    /* The bubble under (or over) the tool just taken: only for a press
     * (keys have the tooltip and aria-haspopup), and only while the
     * options were never opened from a tool. */
    function offerCoach(kind, btn, e) {
      if (!e || !e.detail || readOnly || coachedHere) return;
      var c = coachState();
      if (c.used || c.shown >= COACH_MAX) return;
      coachedHere = true;
      c.shown += 1;
      writeCoach();
      var touch = e.pointerType ? e.pointerType !== 'mouse' : coarse;
      coachEl.textContent = t('ink.coach.' + kind + (touch ? '' : 'Click'));
      coachAnchor = btn;
      coachEl.hidden = false;
      placeCoach();
      clearTimeout(coachTimer);
      coachTimer = setTimeout(hideCoach, COACH_SHOWN_MS);
    }

    function placeCoach() {
      if (coachEl.hidden || !coachAnchor) return;
      refreshRect();
      var a = coachAnchor.getBoundingClientRect();
      if (!a.width) {
        hideCoach();
        return;
      }
      fitCoach();
      var w = coachEl.offsetWidth;
      var hgt = coachEl.offsetHeight;
      var margin = 8;
      var gap = 10;
      var mid = a.left + a.width / 2 - rect.left;
      var left = clamp(mid - w / 2, margin, Math.max(margin, rect.width - w - margin));
      var above = layout === 'compact';
      var top = above ? a.top - rect.top - gap - hgt : a.bottom - rect.top + gap;
      coachEl.style.left = Math.round(left) + 'px';
      coachEl.style.top = Math.round(top) + 'px';
      coachEl.setAttribute('data-side', above ? 'above' : 'below');
      coachEl.style.setProperty('--coach-arrow', Math.round(clamp(mid - left, 14, w - 14)) + 'px');
    }

    /* A box that wraps keeps its full max width while balanced lines
     * take far less of it, leaving an empty strip on the right and the
     * arrow off the middle (narrow phones, long Italian strings): once
     * laid out, the box shrinks to its widest line. */
    function fitCoach() {
      coachEl.style.width = '';
      var text = coachEl.firstChild;
      if (!text || !document.createRange) return;
      var range = document.createRange();
      range.selectNodeContents(coachEl);
      var lines = range.getClientRects();
      if (lines.length < 2) return;
      /* Rects carry the entrance scale; offsetWidth does not. */
      var shown = coachEl.getBoundingClientRect().width;
      var k = shown && coachEl.offsetWidth ? coachEl.offsetWidth / shown : 1;
      var widest = 0;
      for (var i = 0; i < lines.length; i++) widest = Math.max(widest, lines[i].width * k);
      var cs = getComputedStyle(coachEl);
      var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      var want = Math.ceil(widest + pad + 1);
      if (want < coachEl.offsetWidth) coachEl.style.width = want + 'px';
    }

    function hideCoach() {
      clearTimeout(coachTimer);
      coachTimer = 0;
      coachAnchor = null;
      if (!coachEl.hidden) coachEl.hidden = true;
    }

    /* ---------------------------------------------------------------- the options popover */

    function sectionLabel(text) { return h('p', 'ink__label', { text: text }); }

    /* A row of choices that is one stop for Tab and walked with the arrows,
     * which is what role="radio" promises. */
    function radioRow(items, current, onPick, label, cls) {
      var row = h('div', 'ink__radios' + (cls ? ' ' + cls : ''), { role: 'radiogroup', 'aria-label': label });
      items.forEach(function (item) {
        var on = item.id === current;
        var b = h('button', 'ink__choice' + (item.text ? ' ink__choice--text' : ''), {
          type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1',
          'aria-label': item.label, 'data-value': item.id
        });
        if (item.icon) b.appendChild(icon(item.icon));
        if (item.text) b.appendChild(h('span', 'ink__choice-text', { text: item.text }));
        if (item.swatch) {
          b.classList.add('ink__color');
          b.style.setProperty('--swatch', item.swatch);
        }
        if (item.note) b.title = item.note;
        else b.title = item.label;
        b.addEventListener('click', function () { onPick(item.id, 'press'); });
        row.appendChild(item.wrap ? item.wrap(b) : b);
      });
      if (!items.some(function (item) { return item.id === current; }) && row.firstChild) row.firstChild.tabIndex = 0;
      row.addEventListener('keydown', function (e) {
        var steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
        var step = steps[e.key];
        if (step === undefined) return;
        var all = Array.prototype.slice.call(row.querySelectorAll('[role="radio"]'));
        var at = all.indexOf(e.target.closest('[role="radio"]'));
        if (at < 0) return;
        var to = step === 'first' ? 0 : (step === 'last' ? all.length - 1 : (at + step + all.length) % all.length);
        e.preventDefault();
        e.stopPropagation();
        var value = all[to].getAttribute('data-value');
        onPick(value, 'key');
        var again = popEl.querySelector('[role="radiogroup"][aria-label="' + label.replace(/"/g, '\\"') + '"] [data-value="' + value + '"]');
        (again || all[to]).focus();
      });
      return row;
    }

    /* The eight inks and one more: "another colour" is a radio of the same
     * group, which opens the system's colour picker when pressed (through a
     * colour field kept out of the way of assistive technology) and, walked
     * onto with the arrows, takes the last colour picked there. */
    function colorSection() {
      var current = currentColor();
      var wrap = h('div', 'ink__section');
      wrap.appendChild(sectionLabel(t('ink.colors')));
      var isCustom = !SWATCHES.some(function (sw) { return sw.hex === current; });
      var customHex = isCustom ? current : s.custom;
      var input = h('input', 'ink__custom-input', { type: 'color', value: customHex || '#ffffff', tabindex: '-1', 'aria-hidden': 'true' });
      input.addEventListener('input', function () { pickColor(input.value, true); });
      input.addEventListener('change', function () { pickColor(input.value, true); });
      var items = SWATCHES.map(function (sw) {
        return { id: sw.hex, label: t('ink.color.' + sw.id), swatch: shownColor(sw.hex), note: sw.hex === INK ? t('ink.color.inkNote') : null };
      });
      items.push({
        id: 'custom', label: t('ink.color.custom'), swatch: customHex || 'var(--ink-rainbow)',
        wrap: function (b) {
          var holder = h('span', 'ink__custom');
          if (!customHex) b.appendChild(icon('plus'));
          holder.appendChild(b);
          holder.appendChild(input);
          return holder;
        }
      });
      wrap.appendChild(radioRow(items, isCustom ? 'custom' : current, function (id, how) {
        if (id !== 'custom') return pickColor(id);
        if (how === 'press') {
          try {
            if (typeof input.showPicker === 'function') input.showPicker();
            else input.click();
          } catch (err) { input.click(); }
        } else if (s.custom) {
          pickColor(s.custom);
        }
      }, t('ink.colors'), 'ink__colors'));
      return wrap;
    }

    var nibNode = null;
    var nibValue = null;

    /* The size slider with the nib drawn next to it at the size it will be
     * on screen, in the colour and the ink of the instrument. */
    function sizeSection(kind) {
      var wrap = h('div', 'ink__section ink__size');
      wrap.appendChild(sectionLabel(t('ink.size')));
      var row = h('div', 'ink__size-row');
      var erasing = kind === 'eraser';
      var input = h('input', 'ink__range', {
        type: 'range', min: erasing ? ERASER_MIN : PEN_MIN, max: erasing ? ERASER_MAX : PEN_MAX,
        step: erasing ? ERASER_STEP : 0.5, value: erasing ? s.eraser.size : s.pens[s.pen].size, 'aria-label': t('ink.size')
      });
      input.addEventListener('input', function () {
        if (erasing) setEraser(null, input.value);
        else setPenSize(input.value);
      });
      var preview = svgEl('svg', { 'class': 'ink__nib', viewBox: '0 0 48 48', 'aria-hidden': 'true' });
      nibNode = svgEl('circle', { cx: 24, cy: 24, r: 2 });
      preview.appendChild(nibNode);
      nibValue = h('span', 'ink__size-value');
      row.appendChild(input);
      row.appendChild(preview);
      row.appendChild(nibValue);
      wrap.appendChild(row);
      nibNode.__kind = kind;
      nibNode.__range = input;
      return wrap;
    }

    function paintNib() {
      if (!nibNode || !nibNode.isConnected) return;
      var erasing = nibNode.__kind === 'eraser';
      var screen = erasing ? s.eraser.size : s.pens[s.pen].size * cam.k;
      nibNode.setAttribute('r', num(clamp(screen / 2, 0.75, 23)));
      if (erasing) {
        nibNode.setAttribute('class', 'ink__nib-eraser');
        nibNode.removeAttribute('fill');
        nibNode.removeAttribute('opacity');
      } else {
        var pen = penById(s.pen);
        nibNode.setAttribute('class', '');
        nibNode.setAttribute('fill', shownColor(s.pens[s.pen].color));
        nibNode.setAttribute('opacity', String(pen.opacity));
      }
      var said = t('ink.px', { n: erasing ? s.eraser.size : s.pens[s.pen].size });
      nibValue.textContent = said;
      var range = nibNode.__range;
      if (range) range.setAttribute('aria-valuetext', said);
    }

    function penPanel(box) {
      var sec = h('div', 'ink__section');
      sec.appendChild(sectionLabel(t('ink.pens')));
      sec.appendChild(radioRow(PENS.map(function (p) {
        return { id: p.id, icon: p.id, label: t('ink.pen.' + p.id), note: t('ink.pen.' + p.id) + '. ' + t('ink.penNote.' + p.id) };
      }), s.pen, function (id) { choosePen(id); refreshPop(); }, t('ink.pens')));
      sec.appendChild(h('p', 'ink__note', { text: t('ink.penNote.' + s.pen) }));
      box.appendChild(sec);
      box.appendChild(segmented(t('ink.laser.mode'), ['ink', 'laser'], laserOn ? 'laser' : 'ink', 'ink.laser.mode.', function (id) {
        setLaser(id === 'laser');
        refreshPop();
      }));
      box.appendChild(colorSection());
      box.appendChild(sizeSection('pen'));
    }

    function eraserPanel(box) {
      var sec = h('div', 'ink__section');
      sec.appendChild(sectionLabel(t('ink.eraserModes')));
      sec.appendChild(radioRow(ERASER_MODES.map(function (m) {
        return { id: m, icon: 'eraser-' + m, text: t('ink.eraser.' + m), label: t('ink.eraser.' + m), note: t('ink.eraserNote.' + m) };
      }), s.eraser.mode, function (id) { setEraser(id); if (tool !== 'eraser') setTool('eraser'); refreshPop(); }, t('ink.eraserModes'), 'ink__radios--stack'));
      sec.appendChild(h('p', 'ink__note', { text: t('ink.eraserNote.' + s.eraser.mode) }));
      box.appendChild(sec);
      if (s.eraser.mode !== 'area') box.appendChild(sizeSection('eraser'));
    }

    function segmented(title, keys, current, prefix, onPick, icons) {
      var sec = h('div', 'ink__section');
      sec.appendChild(sectionLabel(title));
      sec.appendChild(radioRow(keys.map(function (k) {
        return { id: k, text: icons ? null : t(prefix + k), icon: icons ? icons[k] : null, label: t(prefix + k) };
      }), current, onPick, title, 'ink__radios--segmented'));
      return sec;
    }

    function shapePanel(box) {
      var sec = h('div', 'ink__section');
      sec.appendChild(sectionLabel(t('ink.tool.shapes')));
      sec.appendChild(radioRow(SHAPES.map(function (name) {
        return { id: name, icon: name, label: t('ink.tool.' + name) };
      }), SHAPES.indexOf(tool) >= 0 ? tool : s.shape, function (id) {
        /* A new tool closes the popover and this one opens it again, on
         * the new shape: the focus goes back to the shape it was on. */
        var mark = popFocus();
        setTool(id);
        openPopAgain('shape');
        restorePopFocus(mark);
      }, t('ink.tool.shapes')));
      box.appendChild(sec);
      box.appendChild(colorSection());
      box.appendChild(segmented(t('ink.width'), ['s', 'm', 'l'], s.shapes.width, 'ink.width.', function (k) {
        s.shapes.width = k;
        rememberSettings();
        refreshPop();
      }));
      if (tool !== 'line' && tool !== 'arrow') {
        box.appendChild(segmented(t('ink.fill'), FILLS, s.shapes.fill, 'ink.fill.', function (k) {
          s.shapes.fill = k;
          rememberSettings();
          refreshPop();
        }, { none: 'fill-none', soft: 'fill-soft', solid: 'fill-solid' }));
      }
    }

    function textPanel(box) {
      box.appendChild(colorSection());
      var current = s.text.size;
      if (textEdit) {
        for (var k in TEXT_SIZES) if (TEXT_SIZES[k] === textEdit.size) current = k;
      }
      box.appendChild(segmented(t('ink.textSize'), ['s', 'm', 'l'], current, 'ink.textSize.', function (key) {
        setTextSize(key);
        refreshPop();
      }));
    }

    function selectionPanel(box) {
      box.appendChild(colorSection());
      var row = h('div', 'ink__section ink__row');
      row.appendChild(button('', 'ink.duplicate', 'duplicate', function () { duplicateSelection(); refreshPop(); }, null, true));
      row.appendChild(button('', 'ink.front', 'front', function () { bringToFront(); }, null, true));
      if (selectedIn(elements).some(isPicture)) row.appendChild(button('', 'ink.lock', 'lock', function () { lockSelection(true); closePop(true); }, null, true));
      row.appendChild(button('ink__danger', 'ink.delete', 'trash', function () { deleteSelection(); closePop(true); }, null, true));
      box.appendChild(row);
    }

    function morePanel(box) {
      var row = h('div', 'ink__section ink__row');
      var hand = button('', 'ink.tool.hand', 'hand', function () { setTool(tool === 'hand' && !readOnly ? (s.tool || 'pen') : 'hand'); }, ['H'], true);
      hand.setAttribute('aria-pressed', String(tool === 'hand'));
      row.appendChild(hand);
      row.appendChild(button('', 'ink.image.pick', 'image', function () { closePop(false); pickImage(); }, null, true));
      row.appendChild(button('', 'ink.zoomOut', 'zoom-out', function () { zoomBy(1 / 1.25); refreshPop(); }, null, true));
      var level = h('button', 'ink__btn ink__zoom-level', { type: 'button', 'data-key': 'ink.zoomReset', 'aria-label': t('ink.zoomReset'), text: t('ink.zoomLevel', { n: Math.round(cam.k * 100) }) });
      level.addEventListener('click', function () { zoomTo(1); refreshPop(); });
      row.appendChild(level);
      row.appendChild(button('', 'ink.zoomIn', 'zoom-in', function () { zoomBy(1.25); refreshPop(); }, null, true));
      row.appendChild(button('', 'ink.fit', 'fit', function () { fit(4); closePop(true); }, null, true));
      box.appendChild(row);
    }

    function popKindFor(kind) {
      if (kind !== 'style') return kind;
      var target = styleTarget();
      if (target === 'selection') return 'selection';
      if (target === 'shape') return 'shape';
      if (target === 'text') return 'text';
      if (target === 'eraser') return 'eraser';
      return 'pen';
    }

    /* Rebuilt from scratch each time: every choice reads the state it is
     * opened on. The control that had the focus has it again afterwards,
     * or the focus would fall out of the editor with the old content. */
    function fillPop() {
      var mark = popFocus();
      popEl.textContent = '';
      nibNode = null;
      var kind = popKindFor(pop.kind);
      pop.shown = kind;
      var titles = { pen: t('ink.tool.pen'), eraser: t('ink.tool.eraser'), shape: t('ink.tool.shapes'), text: t('ink.tool.text'), selection: t('ink.selection'), more: t('ink.more') };
      popEl.setAttribute('aria-label', titles[kind] || t('ink.style'));
      popEl.setAttribute('data-kind', kind);
      if (kind === 'pen') penPanel(popEl);
      else if (kind === 'eraser') eraserPanel(popEl);
      else if (kind === 'shape') shapePanel(popEl);
      else if (kind === 'text') textPanel(popEl);
      else if (kind === 'selection') selectionPanel(popEl);
      else if (kind === 'more') morePanel(popEl);
      paintNib();
      restorePopFocus(mark);
    }

    function placePop() {
      if (!pop) return;
      refreshRect();
      var a = pop.anchor.getBoundingClientRect();
      var w = popEl.offsetWidth;
      var hgt = popEl.offsetHeight;
      var margin = 8;
      var left = a.left + a.width / 2 - w / 2 - rect.left;
      var below = a.bottom - rect.top + margin;
      var above = a.top - rect.top - margin - hgt;
      var top = below;
      var flipped = false;
      if (layout === 'compact' || below + hgt > rect.height - margin) {
        if (above >= margin || layout === 'compact') {
          top = above;
          flipped = true;
        }
      }
      left = clamp(left, margin, Math.max(margin, rect.width - w - margin));
      top = clamp(top, margin, Math.max(margin, rect.height - hgt - margin));
      popEl.style.left = Math.round(left) + 'px';
      popEl.style.top = Math.round(top) + 'px';
      popEl.setAttribute('data-flip', String(flipped));
      var origin = Math.round(clamp(a.left + a.width / 2 - rect.left - left, 0, w)) + 'px ' + (flipped ? '100%' : '0');
      popEl.style.setProperty('--origin', origin);
    }

    function openPop(kind, anchor, byKeyboard) {
      hideCoach();
      if (pop && pop.anchor && pop.anchor !== anchor) pop.anchor.setAttribute('aria-expanded', 'false');
      pop = { kind: kind, anchor: anchor };
      fillPop();
      popEl.hidden = false;
      anchor.setAttribute('aria-expanded', 'true');
      placePop();
      if (byKeyboard) {
        var first = popEl.querySelector('[role="radio"][tabindex="0"], button, input');
        if (first) first.focus();
      }
    }

    function openPopAgain(kind) {
      var anchor = layout === 'compact' ? shapeBtn : toolButtons[tool] || shapeBtn;
      openPop(kind, anchor, false);
    }

    /* However the popover closes, a focus inside it goes somewhere that
     * keeps the keys in the editor: back to the button that opened it, or
     * the sheet when that button is not on screen. */
    function closePop(returnFocus) {
      if (!pop) return false;
      var anchor = pop.anchor;
      var had = popEl.contains(document.activeElement);
      pop = null;
      popEl.hidden = true;
      nibNode = null;
      anchor.setAttribute('aria-expanded', 'false');
      if (returnFocus || had) focusOn(anchor);
      return true;
    }

    function togglePop(kind, anchor, e) {
      if (pop && pop.anchor === anchor) {
        closePop(false);
        return;
      }
      openPop(kind, anchor, !!(e && e.detail === 0));
    }

    function refreshPop() {
      if (!pop) {
        updateToolbar();
        return;
      }
      fillPop();
      placePop();
      updateToolbar();
    }

    /* The control of the popover that has the focus, said in a way that
     * finds it again among new nodes: its radio group and value, or the key
     * of its label. */
    function popFocus() {
      var active = document.activeElement;
      if (!active || active === popEl || !popEl.contains(active)) return null;
      var group = active.closest('[role="radiogroup"]');
      return {
        group: group ? group.getAttribute('aria-label') : null,
        value: active.getAttribute('data-value'),
        key: active.getAttribute('data-key')
      };
    }

    function restorePopFocus(mark) {
      if (!mark) return;
      var found = null;
      if (pop && !popEl.hidden) {
        var list = popEl.querySelectorAll('[data-key], [data-value]');
        for (var i = 0; i < list.length && !found; i++) {
          var el = list[i];
          if (mark.key && el.getAttribute('data-key') === mark.key) found = el;
          else if (mark.value != null && el.getAttribute('data-value') === mark.value) {
            var group = el.closest('[role="radiogroup"]');
            if ((group ? group.getAttribute('aria-label') : null) === mark.group) found = el;
          }
        }
        if (!found) found = popEl.querySelector('[role="radio"][tabindex="0"], button:not([disabled])');
      }
      if (found && shown(found)) found.focus();
      else if (pop) focusOn(pop.anchor);
      else focusRoot();
    }

    /* ---------------------------------------------------------------- layout */

    /* Wide: the tools float at the top as a capsule, the actions at the top
     * right, the zoom at the bottom left. Compact (a phone, a tablet held
     * upright, or a viewer pane split in two): the main tools sit at the
     * bottom under the thumb and the rest is one tap away in a popover.
     *
     * Wide is used when the two top bars fit side by side, measured on the
     * bars themselves: their size follows the language, the pointer (44 px
     * targets on touch, so an upright iPad cannot hold both) and the fonts.
     * The longest save state is put in for the measure, so a word that
     * appears later never makes them collide. Decided by the editor's own
     * width, since a host pane can be narrow on a wide screen; the measure
     * is kept until the language or the pointer changes. */
    var wideNeed = 0;

    function longestStatus() {
      var ctx = context2d();
      var cs = getComputedStyle(statusText);
      var best = '';
      var bestW = -1;
      ['dirty', 'saving', 'saved', 'failed', 'readonly'].forEach(function (k) {
        var text = t('ink.status.' + k);
        var w = text.length;
        if (ctx) {
          ctx.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
          w = ctx.measureText(text).width;
        }
        if (w > bestW) {
          bestW = w;
          best = text;
        }
      });
      return best;
    }

    function measureWide() {
      var keep = {
        layout: root.getAttribute('data-layout'),
        readonly: root.hasAttribute('data-readonly'),
        save: root.getAttribute('data-save'),
        text: statusText.textContent
      };
      root.setAttribute('data-layout', 'wide');
      root.setAttribute('data-measure', '');
      root.removeAttribute('data-readonly');
      root.setAttribute('data-save', 'dirty');
      statusText.textContent = longestStatus();
      var tools = toolsBar.getBoundingClientRect().width;
      var actions = actionsBar.getBoundingClientRect().width;
      var left = parseFloat(getComputedStyle(toolsBar).left) || 0;
      var right = parseFloat(getComputedStyle(actionsBar).right) || 0;
      statusText.textContent = keep.text;
      if (keep.save) root.setAttribute('data-save', keep.save);
      else root.removeAttribute('data-save');
      if (keep.readonly) root.setAttribute('data-readonly', '');
      root.removeAttribute('data-measure');
      if (keep.layout) root.setAttribute('data-layout', keep.layout);
      else root.removeAttribute('data-layout');
      if (!tools || !actions) return 0;
      return Math.ceil(left + tools + Math.max(left, right) + actions + right);
    }

    function updateLayout() {
      var w = root.clientWidth || rect.width;
      if (w && !wideNeed) wideNeed = measureWide();
      var next = w && w < (wideNeed || 720) ? 'compact' : 'wide';
      if (next === layout) return;
      var hadFocus = root.contains(document.activeElement);
      layout = next;
      root.setAttribute('data-layout', layout);
      hideCoach();
      if (pop) closePop(false);
      selBarSize = null;
      /* A tool button of the other layout may have had the focus. */
      keepFocus(hadFocus);
    }

    /* The sheet changed size (a window resized, the viewer turned into a
     * card or docked beside the map): what was in the middle stays in the
     * middle, and a drawing that would then lie wholly outside the new
     * sheet is fitted again - an empty-looking sheet reads as a lost
     * drawing. */
    function onResize() {
      if (closed) return;
      var oldW = rect ? rect.width : 0;
      var oldH = rect ? rect.height : 0;
      var wasWhole = oldW > 0 && oldH > 0 && drawingSeen() === 'whole';
      refreshRect();
      updateLayout();
      /* The host places the camera: it hears the new size through
         onCamera (and its clamp), and the paper is drawn for it. */
      if (opts.hostCamera) {
        applyCamera();
        paintPaper();
        if (pop) placePop();
        return;
      }
      if (!fitted && rect.width > 0 && rect.height > 0) fitted = fit(1);
      else {
        if (oldW > 0 && oldH > 0 && rect.width > 0 && rect.height > 0) {
          cam.x += (rect.width - oldW) / 2;
          cam.y += (rect.height - oldH) / 2;
        }
        var seen = drawingSeen();
        /* Seen whole before, it stays whole (zoomed out if it must be);
         * nowhere in sight, it is fitted at its natural size. */
        if (seen === 'none') fit(1);
        else if (wasWhole && seen !== 'whole') fit(cam.k);
        else applyCamera();
      }
      if (pop) placePop();
    }

    /* How much of the drawing the sheet shows, clear of its bars:
     * 'whole', 'part' or 'none' ('whole' for an empty sheet). */
    function drawingSeen() {
      var box = page ? [0, 0, page.w, page.h] : contentBox(elements, background);
      if (!box || !rect.width || !rect.height) return 'whole';
      var inset = insets();
      var a = toLocal([box[0], box[1]]);
      var b = toLocal([box[2], box[3]]);
      var top = inset.top;
      var bottom = rect.height - inset.bottom;
      if (a[0] >= rect.width || b[0] <= 0 || a[1] >= bottom || b[1] <= top) return 'none';
      return a[0] >= 0 && b[0] <= rect.width && a[1] >= top && b[1] <= bottom ? 'whole' : 'part';
    }

    /* A tablet that gets a mouse, or loses it: targets change size, and
     * the layout is measured again. */
    function onPointerKind() {
      if (closed) return;
      coarse = !!(coarseQuery && coarseQuery.matches);
      wideNeed = 0;
      layout = '';
      onResize();
      paintOverlay();
    }

    /* ---------------------------------------------------------------- focus */

    function shown(el) {
      return !!(el && el.isConnected && !el.closest('[hidden]') && el.getClientRects().length);
    }

    function focusRoot() {
      if (document.activeElement === root) return;
      try { root.focus({ preventScroll: true }); } catch (err) { root.focus(); }
    }

    /* There, if it is on screen; the sheet otherwise. Keys go where the
     * focus is, and a focus that falls to the page takes them to the app. */
    function focusOn(el) {
      if (closed) return;
      if (el && el !== root && root.contains(el) && shown(el)) {
        try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
        return;
      }
      focusRoot();
    }

    /* After something vanished: if the editor had the focus, it keeps it. */
    function keepFocus(hadFocus) {
      if (!hadFocus || closed) return;
      var active = document.activeElement;
      if (active === root) return;
      if (!active || !root.contains(active) || !shown(active)) focusRoot();
    }

    function hideNotice() {
      if (notice.hidden) return;
      notice.hidden = true;
      root.setAttribute('aria-describedby', hintId);
    }

    /* ---------------------------------------------------------------- the pointer router */

    function touchIds() {
      var ids = [];
      pointers.forEach(function (p, id) { if (p.type === 'touch') ids.push(id); });
      return ids;
    }

    function capture(id) {
      try { surface.setPointerCapture(id); } catch (err) { /* a synthetic or vanished pointer */ }
    }

    function releaseCapture(id) {
      try { if (surface.hasPointerCapture && surface.hasPointerCapture(id)) surface.releasePointerCapture(id); } catch (err) { /* already gone */ }
    }

    /* What a press on the sheet becomes. */
    function decide(e, type) {
      if (readOnly) return type === 'mouse' && e.button !== 0 && e.button !== 1 ? null : 'pan';
      if (isBack(e)) return 'erase-back';
      if (isSide(e)) return 'erase-side';
      if (type === 'mouse' && e.button === 1) return 'pan';
      if (type === 'mouse' && e.button !== 0) return null;
      /* Palm rejection: once a pen has been seen, a finger only moves the
       * sheet - on a tablet the palm rests on the glass while the pen
       * writes. */
      if (type === 'touch' && penSeen) return 'pan';
      if (spaceDown || tool === 'hand') return 'pan';
      if (tool === 'pen') return 'draw';
      if (tool === 'eraser') return 'erase';
      if (tool === 'text') return 'text';
      if (tool === 'select') return 'select';
      if (SHAPES.indexOf(tool) >= 0) return 'shape';
      return null;
    }

    function onPointerDown(e) {
      if (closed) return;
      stopFling();
      var type = e.pointerType || 'mouse';
      if (type === 'pen') {
        penSeen = true;
        /* The palm often lands before the pen does: whatever it started
         * (a pan, a pinch) gives way, and the pen writes. */
        if (gesture && gesture.pointerType === 'touch') abandon(gesture);
        if (pinch) endPinch();
      }
      /* A palm landing while the pen works is not a second finger. */
      if (gesture && gesture.pointerType === 'pen' && type === 'touch') return;
      if (pinch && type === 'touch') return;
      refreshRect();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: type });
      if (gesture) {
        /* A second pointer of the same kind is a pinch, or a mistake: the
         * gesture lets go and puts back everything it changed. */
        if (type === gesture.pointerType && e.pointerId !== gesture.id) {
          abandon(gesture);
          if (type === 'touch') beginPinch();
        }
        return;
      }
      if (type === 'touch' && touchIds().length >= 2) {
        beginPinch();
        return;
      }
      if (e.cancelable) e.preventDefault();
      if (dismissing === e.pointerId) {
        /* Only the popover goes: a text being written stays open. */
        dismissing = null;
        pointers.delete(e.pointerId);
        if (!textEdit) focusRoot();
        return;
      }
      focusRoot();
      if (pop) closePop(false);
      if (textEdit) {
        commitText();
        pointers.delete(e.pointerId);
        return;
      }
      var kind = decide(e, type);
      if (!kind) {
        pointers.delete(e.pointerId);
        return;
      }
      /* Off the page: the host may turn the editor to the page under the
       * pen (and the press goes on there); elsewhere it moves the sheet. */
      if (page && kind !== 'pan' && !onPage(toScene(e.clientX, e.clientY))) {
        var turned = false;
        if (typeof opts.onOutside === 'function') {
          try { turned = opts.onOutside(toScene(e.clientX, e.clientY), e) === true; } catch (err) { warn('onOutside failed', err); }
        }
        if (closed) return;
        refreshRect();
        if (!turned || readOnly || !page || !onPage(toScene(e.clientX, e.clientY))) kind = 'pan';
      }
      var g = {
        kind: kind,
        id: e.pointerId,
        pointerType: type,
        from: [e.clientX, e.clientY],
        at: toScene(e.clientX, e.clientY),
        moved: false
      };
      if (!nib.hidden) nib.hidden = true;
      if (kind === 'pan') beginPan(g);
      else if (kind === 'draw') beginDraw(g, e);
      else if (kind === 'erase' || kind === 'erase-back' || kind === 'erase-side') beginErase(g, e, kind === 'erase' ? null : kind.slice(6));
      else if (kind === 'shape') beginShape(g, e);
      else if (kind === 'select') beginSelect(g, e);
      gesture = g;
      root.setAttribute('data-gesture', g.kind);
      capture(e.pointerId);
      schedulePaint();
    }

    function onPointerMove(e) {
      var p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinch) {
        if (pinch.ids.indexOf(e.pointerId) >= 0) movePinch();
        return;
      }
      var g = gesture;
      if (!g || e.pointerId !== g.id) return;
      if (g.own) e.stopPropagation();
      var dist = Math.sqrt(sq(e.clientX - g.from[0]) + sq(e.clientY - g.from[1]));
      /* A finger or a pen tip slips a little on a tap; a mouse does not. */
      if (dist > (g.pointerType === 'mouse' ? TAP : TAP_TOUCH)) g.moved = true;
      if (g.kind === 'pan') movePan(g, e);
      else if (g.kind === 'draw') moveDraw(g, e);
      else if (g.kind === 'erase') moveErase(g, e);
      else if (g.kind === 'shape') moveShape(g, e);
      else if (g.kind === 'select') moveSelect(g, e);
    }

    function onPointerUp(e) {
      var known = pointers.delete(e.pointerId);
      if (!known) return;
      if (pinch && pinch.ids.indexOf(e.pointerId) >= 0) {
        endPinch();
        return;
      }
      if (gesture && e.pointerId === gesture.id) {
        if (gesture.own) e.stopPropagation();
        release(gesture, e);
      }
    }

    function onPointerCancel(e) {
      var known = pointers.delete(e.pointerId);
      if (!known) return;
      if (pinch && pinch.ids.indexOf(e.pointerId) >= 0) endPinch();
      if (gesture && e.pointerId === gesture.id) abandon(gesture);
    }

    /* The window lost in the middle of a gesture: the hand may come up
     * somewhere this page never hears of. What was done is kept, as if it
     * had come up here; a gesture waiting for an up that never arrives would
     * take no gesture ever again. */
    function onBlur() {
      if (gesture) release(gesture, null);
      if (pinch) endPinch();
      pointers.clear();
      if (spaceDown) {
        spaceDown = false;
        root.removeAttribute('data-space');
      }
    }

    function onHover(e) {
      if (gesture && gesture.kind === 'erase') return;
      if (e.pointerType === 'touch') return;
      showCursor(e.clientX, e.clientY, false);
      if (!gesture && tool === 'select') setHoverCursor(selectHover(e.clientX, e.clientY, e.pointerType));
    }

    function onLeave() {
      if (!(gesture && gesture.kind === 'erase') && !cursor.hidden) cursor.hidden = true;
      if (!nib.hidden) nib.hidden = true;
      if (!gesture) setHoverCursor('');
    }

    function finish(g) {
      releaseCapture(g.id);
      if (gesture === g) gesture = null;
      root.removeAttribute('data-gesture');
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (g.kind === 'erase' && !(tool === 'eraser')) cursor.hidden = true;
    }

    function release(g, e) {
      finish(g);
      if (e && e.pointerType && e.pointerType !== 'touch' && e.clientX !== undefined) showNib(e.clientX, e.clientY);
      if (g.kind === 'draw') {
        if (g.laser) {
          paintAll();
          return;
        }
        var stroke = changed(g.draft, { points: g.points.slice() });
        g.draft = null;
        if (!commit(elements.concat([stroke]))) paintAll();
        return;
      }
      if (g.kind === 'erase') {
        if (!g.started) {
          paintAll();
          return;
        }
        if (g.er.mode === 'area') eraseEnclose(g.er);
        if (g.own === 'side') menuOwed = now() + MENU_SWALLOW;
        var result = eraseResult(g.er);
        if (!result || !commit(result)) paintAll();
        return;
      }
      if (g.kind === 'shape') {
        var made = g.draft;
        g.draft = null;
        if (made && g.moved) commit(elements.concat([changed(made, {})]));
        else paintAll();
        return;
      }
      if (g.kind === 'text') {
        paintAll();
        if (!g.moved && e) beginText(g.at, textAt(g.at));
        return;
      }
      if (g.kind === 'select') {
        releaseSelect(g, e);
        return;
      }
      if (g.kind === 'pan' && e) startFling();
      paintAll();
    }

    /* Put back exactly what was there: nothing changed, so nothing to save
     * and nothing to undo. */
    function abandon(g) {
      finish(g);
      g.draft = null;
      g.work = null;
      /* A pan that becomes a pinch keeps where it got to (the pinch takes
       * over from there); a selection gesture gives the selection back. */
      if (g.kind === 'select' && g.selection0) selection = g.selection0;
      paintAll();
    }

    /* ---------- pan and pinch ---------- */

    function beginPan(g) {
      stopFling();
      g.cam0 = { x: cam.x, y: cam.y, k: cam.k };
    }

    function movePan(g, e) {
      cam.x = g.cam0.x + (e.clientX - g.from[0]);
      cam.y = g.cam0.y + (e.clientY - g.from[1]);
      applyCamera();
      trackCamera();
    }

    /* ---------- momentum (opts.momentum: a notebook's pages) ----------
     * A hand that lets go of the sheet while it moves leaves it gliding,
     * slowing down, the way a page of a notebook app slides: the speed of
     * the last tenth of a second carries on and decays. Any press, wheel
     * or key stops it. None under reduced motion. */
    var flingTrack = [];
    var fling = 0;

    function trackCamera() {
      if (!opts.momentum) return;
      var t0 = now();
      flingTrack.push({ x: cam.x, y: cam.y, t: t0 });
      while (flingTrack.length > 2 && t0 - flingTrack[0].t > 100) flingTrack.shift();
    }

    function reduced() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (err) { return false; }
    }

    function stopFling() {
      if (fling) cancelAnimationFrame(fling);
      fling = 0;
      flingTrack = [];
    }

    function startFling() {
      var list = flingTrack;
      flingTrack = [];
      if (!opts.momentum || list.length < 2 || reduced() || closed) return;
      var a = list[0];
      var b = list[list.length - 1];
      var dt = b.t - a.t;
      if (dt <= 0 || now() - b.t > 60) return;
      var vx = (b.x - a.x) / dt;
      var vy = (b.y - a.y) / dt;
      if (Math.sqrt(vx * vx + vy * vy) < FLING_MIN) return;
      var last = now();
      function step() {
        fling = 0;
        if (closed) return;
        var t1 = now();
        var d = Math.min(48, t1 - last);
        last = t1;
        var x0 = cam.x;
        var y0 = cam.y;
        cam.x += vx * d;
        cam.y += vy * d;
        applyCamera();
        var decay = Math.pow(FLING_DECAY, d);
        vx *= decay;
        vy *= decay;
        /* Stopped by the speed running out, or by the host's bounds. */
        if (Math.sqrt(vx * vx + vy * vy) < FLING_STOP || (Math.abs(cam.x - x0) < 0.05 && Math.abs(cam.y - y0) < 0.05)) return;
        fling = requestAnimationFrame(step);
      }
      fling = requestAnimationFrame(step);
    }

    function beginPinch() {
      stopFling();
      var ids = touchIds().slice(0, 2);
      if (ids.length < 2) return;
      var a = pointers.get(ids[0]);
      var b = pointers.get(ids[1]);
      var mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      refreshRect();
      pinch = {
        ids: ids,
        d0: Math.max(Math.sqrt(sq(a.x - b.x) + sq(a.y - b.y)), 1),
        k0: cam.k,
        anchor: toScene(mid[0], mid[1])
      };
      root.setAttribute('data-gesture', 'pinch');
    }

    function movePinch() {
      var a = pointers.get(pinch.ids[0]);
      var b = pointers.get(pinch.ids[1]);
      if (!a || !b) return;
      var d = Math.max(Math.sqrt(sq(a.x - b.x) + sq(a.y - b.y)), 1);
      var mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      var k = clamp(pinch.k0 * d / pinch.d0, ZOOM_MIN, ZOOM_MAX);
      cam.k = k;
      cam.x = mid[0] - rect.left - pinch.anchor[0] * k;
      cam.y = mid[1] - rect.top - pinch.anchor[1] * k;
      applyCamera();
      trackCamera();
    }

    function endPinch() {
      startFling();
      pinch.ids.forEach(releaseCapture);
      pinch = null;
      root.removeAttribute('data-gesture');
    }

    var lastWheel = 0;

    function onWheel(e) {
      if (closed) return;
      e.preventDefault();
      stopFling();
      /* The rect is read once per burst of wheel events: reading it on
       * every one, right after the camera was written, would lay the page
       * out sixty times a second. */
      var t0 = now();
      if (t0 - lastWheel > 200) refreshRect();
      lastWheel = t0;
      var dx = e.deltaX;
      var dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= rect.width; dy *= rect.height; }
      if (e.ctrlKey || e.metaKey) {
        /* A trackpad pinch arrives as a wheel with Ctrl held, in small
         * deltas; a mouse wheel with Ctrl in big ones, capped so one notch
         * is a step and not a leap. */
        zoomAt(e.clientX, e.clientY, Math.exp(-clamp(dy, -50, 50) / 100));
        return;
      }
      if (e.shiftKey && !dx) {
        dx = dy;
        dy = 0;
      }
      cam.x -= dx;
      cam.y -= dy;
      applyCamera();
    }

    /* Safari on a Mac sends a trackpad pinch as gesture events, not as a
     * wheel; on iOS it sends them as well as the pointers, which already
     * pinch, so they only count when no pointer pinch is running. */
    function onGestureStart(e) {
      e.preventDefault();
      safariPinch = { scale: 1 };
    }

    function onGestureChange(e) {
      e.preventDefault();
      if (!safariPinch || pinch || gesture) return;
      refreshRect();
      var cx = e.clientX || rect.left + rect.width / 2;
      var cy = e.clientY || rect.top + rect.height / 2;
      zoomAt(cx, cy, e.scale / safariPinch.scale);
      safariPinch.scale = e.scale;
    }

    function onGestureEnd(e) {
      e.preventDefault();
      safariPinch = null;
    }

    /* ---------- freehand ---------- */

    function pressureOf(e, sim) {
      if (sim) return 0.5;
      var p = e.pressure;
      return p > 0 ? clamp(p, 0.05, 1) : 0.5;
    }

    function beginDraw(g, e) {
      if (laserOn) {
        g.laser = true;
        g.points = [];
        g.draft = null;
        g.last = [e.clientX, e.clientY];
        laserTrail = [];
        laserTo(e.clientX, e.clientY);
        return;
      }
      var pen = penById(s.pen) || PENS[0];
      var mine = s.pens[pen.id];
      g.sim = g.pointerType !== 'pen';
      g.points = [[g.at[0], g.at[1], pressureOf(e, g.sim)]];
      g.last = [e.clientX, e.clientY];
      g.draft = makeStroke(g.points, {
        pen: pen.id, color: mine.color, size: mine.size, opacity: pen.opacity, thinning: pen.thinning,
        smoothing: pen.smoothing, streamline: pen.streamline, cap: pen.cap, blend: pen.blend, sim: g.sim
      });
    }

    function moveDraw(g, e) {
      var list = coalesced(e);
      if (g.laser) {
        for (var j = 0; j < list.length; j++) laserTo(list[j].clientX, list[j].clientY);
        return;
      }
      var added = false;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        /* Points closer than half a screen pixel add weight and nothing
         * else. */
        if (sq(c.clientX - g.last[0]) + sq(c.clientY - g.last[1]) < 0.25) continue;
        g.last = [c.clientX, c.clientY];
        var p = toScene(c.clientX, c.clientY);
        g.points.push([p[0], p[1], pressureOf(c, g.sim)]);
        added = true;
      }
      if (added) schedulePaint();
    }

    /* ---------- the eraser ---------- */

    function beginErase(g, e, own) {
      g.kind = 'erase';
      g.own = own || null;
      g.started = false;
      g.last = g.at;
      g.er = eraseBegin(elements, { mode: s.eraser.mode, reach: s.eraser.size / 2 / cam.k, zoom: cam.k });
      showCursor(e.clientX, e.clientY, true);
      /* A side-button press is nothing until it has travelled: a tap with
       * it must not nick the drawing. */
      if (own !== 'side') startErase(g);
    }

    function startErase(g) {
      g.started = true;
      if (g.er.mode === 'area') {
        eraseLoop(g.er, g.last);
        return;
      }
      eraseSweep(g.er, g.last, g.last);
    }

    function moveErase(g, e) {
      showCursor(e.clientX, e.clientY, true);
      if (!g.started) {
        if (Math.sqrt(sq(e.clientX - g.from[0]) + sq(e.clientY - g.from[1])) < SLOP) return;
        startErase(g);
      }
      var list = coalesced(e);
      for (var i = 0; i < list.length; i++) {
        var at = toScene(list[i].clientX, list[i].clientY);
        if (g.er.mode === 'area') eraseLoop(g.er, at);
        else eraseSweep(g.er, g.last, at);
        g.last = at;
      }
      schedulePaint();
    }

    /* ---------- shapes ---------- */

    function shapeStyle() {
      return { color: s.shapes.color, width: WIDTHS[s.shapes.width], fill: s.shapes.fill };
    }

    /* Shift: a square, a circle, a diamond with equal sides; a line or an
     * arrow on the nearest 15 degrees. */
    function constrain(type, a, b, shift) {
      if (!shift) return b;
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      if (type === 'line' || type === 'arrow') {
        var len = Math.sqrt(dx * dx + dy * dy);
        var snap = Math.PI / 12;
        var ang = Math.round(Math.atan2(dy, dx) / snap) * snap;
        return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
      }
      var m = Math.max(Math.abs(dx), Math.abs(dy));
      return [a[0] + (dx < 0 ? -m : m), a[1] + (dy < 0 ? -m : m)];
    }

    function beginShape(g, e) {
      g.type = tool;
      g.shift = e.shiftKey;
      g.end = g.at;
      g.style = shapeStyle();
      g.id0 = uid();
      g.draft = null;
    }

    function shapeDraft(g) {
      var style = { id: g.id0, color: g.style.color, width: g.style.width, fill: g.style.fill };
      g.draft = makeShape(g.type, g.at, constrain(g.type, g.at, g.end, g.shift), style);
    }

    function moveShape(g, e) {
      g.end = toScene(e.clientX, e.clientY);
      g.shift = e.shiftKey;
      if (!g.moved) return;
      shapeDraft(g);
      schedulePaint();
    }

    /* ---------- select, move, resize ---------- */

    function beginSelect(g, e) {
      var padlock = lockAt(e.clientX, e.clientY, g.pointerType);
      if (padlock) {
        /* The padlock of a locked picture: it opens, and the picture is
         * the selection. */
        g.mode = 'none';
        g.padlock = true;
        commit(elements.map(function (el) { return el === padlock ? changed(el, { locked: false }) : el; }));
        selection = [padlock.id];
        paintOverlay();
        updateToolbar();
        return;
      }
      var handle = handleAt(e.clientX, e.clientY, g.pointerType);
      g.selection0 = selection.slice();
      if (handle) {
        g.mode = 'resize';
        g.handle = handle.id;
        g.base = elements;
        g.box = selectionBox();
        g.geo = unionBox(selectedIn(elements).map(geometryOf));
        g.single = handle.id === 'p0' || handle.id === 'p1';
        /* Where on the handle it was taken: the corner follows the hand
         * from there, without a jump to the pointer. */
        var west = handle.id.indexOf('w') >= 0;
        var north = handle.id.indexOf('n') >= 0;
        g.grab = [(west ? g.box[0] : g.box[2]) - g.at[0], (north ? g.box[1] : g.box[3]) - g.at[1]];
        return;
      }
      var hit = hitAt(g.at, (g.pointerType === 'touch' ? HIT * 2 : HIT) / cam.k);
      /* Inside the frame of what is selected, a drag moves it: a hollow
       * shape has nothing to grab in its middle. */
      var box = !hit && !e.shiftKey && selection.length ? selectionBox() : null;
      if (box && g.at[0] >= box[0] && g.at[0] <= box[2] && g.at[1] >= box[1] && g.at[1] <= box[3]) {
        g.mode = 'move';
        g.base = elements;
        updateToolbar();
        return;
      }
      if (hit) {
        var already = selection.indexOf(hit.id) >= 0;
        if (e.shiftKey) {
          selection = already ? selection.filter(function (id) { return id !== hit.id; }) : selection.concat([hit.id]);
        } else if (!already) {
          selection = [hit.id];
        }
        g.mode = selection.indexOf(hit.id) >= 0 ? 'move' : 'none';
        g.hit = hit;
        g.base = elements;
      } else {
        g.mode = 'marquee';
        g.keep = e.shiftKey ? selection.slice() : [];
        if (!e.shiftKey) selection = [];
      }
      updateToolbar();
    }

    function moveSelect(g, e) {
      var at = toScene(e.clientX, e.clientY);
      if (g.mode === 'move') {
        if (!g.moved) return;
        var dx = at[0] - g.at[0];
        var dy = at[1] - g.at[1];
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        var set = selectedSet();
        g.work = g.base.map(function (el) { return set[el.id] ? translateEl(el, dx, dy) : el; });
        schedulePaint();
      } else if (g.mode === 'resize') {
        g.work = resized(g, at, e.shiftKey);
        schedulePaint();
      } else if (g.mode === 'marquee') {
        if (!g.moved) return;
        g.box = [Math.min(g.at[0], at[0]), Math.min(g.at[1], at[1]), Math.max(g.at[0], at[0]), Math.max(g.at[1], at[1])];
        var inside2 = elements.filter(function (el) { return !el.locked && boxInside(boundsOf(el), g.box); }).map(function (el) { return el.id; });
        selection = g.keep.concat(inside2.filter(function (id) { return g.keep.indexOf(id) < 0; }));
        schedulePaint();
      }
    }

    /* The selection, resized by dragging one handle: the opposite corner or
     * side stays put. Shift keeps the proportions; text alone always does. */
    function resized(g, at, shift) {
      var set = selectedSet();
      if (g.single) {
        var which = g.handle === 'p0' ? 0 : 1;
        return g.base.map(function (el) {
          if (!set[el.id]) return el;
          var other = el.points[1 - which];
          var moved = constrain('line', other, at, shift);
          var pts = el.points.slice();
          pts[which] = moved;
          return changed(el, { points: pts });
        });
      }
      /* The handles sit on the box of the ink, the scaling is done on the
       * geometry (the ink keeps its width): so the corner of the ink that
       * was taken is put under the hand, and the opposite one stays. */
      var box = g.box;
      var geo = g.geo;
      var h0 = g.handle;
      var west = h0.indexOf('w') >= 0;
      var east = h0.indexOf('e') >= 0;
      var north = h0.indexOf('n') >= 0;
      var south = h0.indexOf('s') >= 0;
      var corner = [at[0] + g.grab[0], at[1] + g.grab[1]];
      var tx = west ? corner[0] + (geo[0] - box[0]) : corner[0] - (box[2] - geo[2]);
      var ty = north ? corner[1] + (geo[1] - box[1]) : corner[1] - (box[3] - geo[3]);
      var ax = west ? geo[2] : (east ? geo[0] : (geo[0] + geo[2]) / 2);
      var ay = north ? geo[3] : (south ? geo[1] : (geo[1] + geo[3]) / 2);
      var mx = west ? geo[0] : geo[2];
      var my = north ? geo[1] : geo[3];
      var horizontal = west || east;
      var vertical = north || south;
      var sx = horizontal && Math.abs(mx - ax) > 1e-6 ? (tx - ax) / (mx - ax) : 1;
      var sy = vertical && Math.abs(my - ay) > 1e-6 ? (ty - ay) / (my - ay) : 1;
      var picked = selectedIn(g.base);
      var onlyText = picked.every(function (el) { return el.type === 'text'; });
      /* A picture keeps its proportions from a corner (a side stretches it). */
      var onlyPictures = horizontal && vertical && picked.every(function (el) { return el.type === 'image'; });
      if (shift || onlyText || onlyPictures) {
        if (horizontal && vertical) {
          var m = Math.max(Math.abs(sx), Math.abs(sy));
          sx = (sx < 0 ? -1 : 1) * m;
          sy = (sy < 0 ? -1 : 1) * m;
        } else if (horizontal) sy = Math.abs(sx);
        else sx = Math.abs(sy);
      }
      if (Math.abs(sx) < 0.02) sx = sx < 0 ? -0.02 : 0.02;
      if (Math.abs(sy) < 0.02) sy = sy < 0 ? -0.02 : 0.02;
      return g.base.map(function (el) { return set[el.id] ? scaleEl(el, ax, ay, sx, sy) : el; });
    }

    function releaseSelect(g, e) {
      if (g.padlock) return;
      if ((g.mode === 'move' || g.mode === 'resize') && g.work && g.moved) {
        var work = g.work;
        g.work = null;
        if (!commit(work)) paintAll();
        updateToolbar();
        return;
      }
      g.work = null;
      /* A second tap, quickly and in the same place, writes: in the text
       * tapped, or a new text on empty paper. */
      if (!g.moved && e) {
        var t0 = now();
        var key = g.hit ? g.hit.id : '';
        var again = lastTap && lastTap.id === key && t0 - lastTap.at < DOUBLE_TAP &&
          Math.abs(lastTap.x - e.clientX) < 12 && Math.abs(lastTap.y - e.clientY) < 12;
        if (again && (!g.hit || g.hit.type === 'text')) {
          lastTap = null;
          paintAll();
          beginText(g.at, g.hit || null);
          return;
        }
        lastTap = { id: key, at: t0, x: e.clientX, y: e.clientY };
      }
      paintAll();
      updateToolbar();
    }

    /* ---------------------------------------------------------------- keys */

    function onKeyDown(e) {
      if (closed || e.isComposing || e.keyCode === 229) return;
      stopFling();
      var target = e.target;
      /* The app's keys that work while typing (contract: Mod+S, Mod+K) go
       * on to it from anywhere in the editor, the text field included,
       * untouched: the app's dispatcher ignores a key already handled. Mod+S
       * first puts the words on the sheet and hands this drawing over, so
       * the app's save that follows has it. */
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        /* By the key, or by its place on a layout without Latin letters. */
        var letter = (e.key || '').toLowerCase();
        var latin = /^[a-z]$/.test(letter);
        if (letter === 's' || (!latin && e.code === 'KeyS')) {
          if (textEdit) commitText();
          saveNow();
          return;
        }
        if (letter === 'k' || (!latin && e.code === 'KeyK')) return;
      }
      if (target === ta) {
        if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
          e.preventDefault();
          commitText();
        }
        /* Typing is typing: the app never hears these keys. */
        e.stopPropagation();
        return;
      }
      if (isTyping(target)) {
        if (e.key === 'Escape' && pop) {
          e.preventDefault();
          e.stopPropagation();
          closePop(true);
          return;
        }
        if (e.key !== 'Escape') e.stopPropagation();
        return;
      }
      var handled = handleKey(e);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      /* Unhandled keys stay inside the drawing too (Tab, Enter, arrows,
       * letters would otherwise reach the map underneath), except the
       * app-wide ones: Escape with nothing left to close here, function
       * keys, and the modifier shortcuts the editor does not use. */
      var lone = /^(Control|Shift|Alt|AltGraph|Meta|OS|CapsLock|Fn)$/.test(e.key);
      var passes = !lone && (e.key === 'Escape' || /^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey);
      if (!passes) e.stopPropagation();
    }

    function handleKey(e) {
      var mod = e.ctrlKey || e.metaKey;
      var key = e.key || '';
      var lower = key.length === 1 ? key.toLowerCase() : key;
      if (mod && !e.altKey) {
        if (lower === 'z') return e.shiftKey ? redo() || true : undo() || true;
        if (lower === 'y') return redo() || true;
        /* Taken even with nothing to duplicate: the browser would open
         * its bookmark dialog, and the app would act on the map. */
        if (lower === 'd') {
          duplicateSelection();
          return true;
        }
        if (lower === 'a') {
          if (readOnly) return false;
          selectAll();
          return true;
        }
        if (key === '=' || key === '+') { zoomBy(1.25); return true; }
        if (key === '-' || key === '_') { zoomBy(1 / 1.25); return true; }
        if (key === '0') { zoomTo(1); return true; }
        if (e.shiftKey && (key === ']' || key === '}' || e.code === 'BracketRight')) return bringToFront() || !!selection.length;
        return false;
      }
      if (e.altKey) return false;
      if (key === 'Escape') {
        if (gesture) {
          abandon(gesture);
          return true;
        }
        if (pop) return closePop(true);
        if (selection.length) {
          selection = [];
          paintOverlay();
          updateToolbar();
          return true;
        }
        return false;
      }
      if (key === ' ') {
        if (targetIsControl(e.target)) return false;
        if (!spaceDown) {
          spaceDown = true;
          root.setAttribute('data-space', '');
        }
        return true;
      }
      if (targetIsControl(e.target) && (key === 'Enter' || key.indexOf('Arrow') === 0)) return false;
      if (readOnly) {
        if (key === '!' || (e.shiftKey && e.code === 'Digit1')) { fit(4); return true; }
        return false;
      }
      if (key === 'Delete' || key === 'Backspace') return deleteSelection() || !!selection.length;
      if (key === 'Enter' && selection.length === 1) {
        var only = selectedIn(elements)[0];
        if (only && only.type === 'text') {
          beginText(null, only);
          return true;
        }
      }
      if (key.indexOf('Arrow') === 0 && selection.length && !gesture) {
        var step = e.shiftKey ? NUDGE_BIG : NUDGE;
        var dx = key === 'ArrowLeft' ? -step : (key === 'ArrowRight' ? step : 0);
        var dy = key === 'ArrowUp' ? -step : (key === 'ArrowDown' ? step : 0);
        nudge(dx / cam.k, dy / cam.k);
        return true;
      }
      if (key === '!' || (e.shiftKey && e.code === 'Digit1')) { fit(4); return true; }
      if (e.shiftKey) return false;
      if (lower === 'e' || key === '0') {
        if (!gesture && toggleEraser()) say(toolLabel(tool));
        return true;
      }
      if (KEYS[lower]) {
        /* A key gives no visible press to whoever cannot see the bar. */
        if (!gesture && setTool(KEYS[lower])) say(toolLabel(tool));
        return true;
      }
      return false;
    }

    function targetIsControl(target) {
      return !!(target && target !== root && target.closest && target.closest('button, input, select, a[href]'));
    }

    function onKeyUp(e) {
      if (e.key === ' ' && spaceDown) {
        spaceDown = false;
        root.removeAttribute('data-space');
      }
      if (e.key === 'Shift' && gesture && gesture.kind === 'shape' && gesture.moved) {
        gesture.shift = false;
        shapeDraft(gesture);
        schedulePaint();
      }
    }

    function onShiftDown(e) {
      if (e.key === 'Shift' && gesture && gesture.kind === 'shape' && gesture.moved) {
        gesture.shift = true;
        shapeDraft(gesture);
        schedulePaint();
      }
    }

    /* ---------------------------------------------------------------- menus and focus */

    /* The browser's own menu has nothing to offer over a drawing (a long
     * press on a phone would select or save the sheet). The barrel button
     * erases, and Windows then sends a contextmenu when it comes up: that
     * one is swallowed wherever it lands, for a moment. */
    function onContextMenu(e) {
      if (isTyping(e.target)) return;
      e.preventDefault();
    }

    function onWindowContextMenu(e) {
      if (!menuOwed || now() > menuOwed) return;
      menuOwed = 0;
      e.preventDefault();
      e.stopPropagation();
    }

    /* A tap outside the popover closes it. While a text is being written,
     * pressing a control must not take the focus from it (the colour or
     * size pressed applies to the text), so the press is kept from moving
     * the focus. */
    function onRootPointerDown(e) {
      dismissing = null;
      if (coachAnchor && !coachAnchor.contains(e.target)) hideCoach();
      if (pop && !popEl.contains(e.target) && !pop.anchor.contains(e.target)) {
        closePop(false);
        /* A press on the sheet that closes the popover does only that: the
         * tap that puts a popover away (on a phone, the usual way out after
         * picking a colour) must not leave a dot, erase or start a text. */
        if (surface.contains(e.target)) dismissing = e.pointerId;
      }
      if (textEdit && e.target !== ta && !isTyping(e.target) && e.target.closest && e.target.closest('.ink__bar, .ink__pop')) {
        e.preventDefault();
      }
    }

    function onRootMouseDown(e) {
      if (textEdit && e.target !== ta && !isTyping(e.target) && e.target.closest && e.target.closest('.ink__bar, .ink__pop')) {
        e.preventDefault();
      }
    }

    function onTextBlur() {
      /* Focus moving inside the popover (the colour field) keeps the text
       * open; anywhere else writes it. */
      setTimeout(function () {
        if (!textEdit || closed) return;
        var active = document.activeElement;
        if (active === ta) return;
        if (active && popEl.contains(active)) return;
        commitText();
      }, 0);
    }

    /* The app turns a pasted picture into a node of the map: a paste here,
     * text into the text field or nothing at all, is the drawing's. */
    function onClipboard(e) {
      e.stopPropagation();
      if (e.type !== 'paste' || readOnly || textEdit || e.target === ta || !e.clipboardData) return;
      var files = Array.prototype.slice.call(e.clipboardData.files || []).filter(function (f) { return /^image\//i.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      insertImage(files[0], null);
    }

    /* A picture dropped on the sheet lands where it was let go. */
    function onDragOver(e) {
      if (readOnly || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }

    function onDrop(e) {
      if (readOnly || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      var files = Array.prototype.slice.call(e.dataTransfer.files).filter(function (f) { return /^image\//i.test(f.type); });
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      refreshRect();
      insertImage(files[0], toScene(e.clientX, e.clientY));
    }

    /* A toolbar is walked with the arrows, as role="toolbar" promises. */
    function onBarKey(e) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.metaKey && optionsByKey(e)) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      var bar = e.currentTarget;
      var all = Array.prototype.filter.call(bar.querySelectorAll('button'), function (b) {
        return !b.disabled && b.getClientRects().length > 0;
      });
      var at = all.indexOf(document.activeElement);
      if (at < 0) return;
      var to = e.key === 'Home' ? 0 : (e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length);
      e.preventDefault();
      e.stopPropagation();
      all[to].focus();
    }

    /* The arrow across a horizontal toolbar opens the options of the
     * button with the focus, as a menu button does; the focus goes into
     * them. */
    function optionsByKey(e) {
      var b = document.activeElement;
      if (readOnly || !b || b.getAttribute('aria-haspopup') !== 'dialog' || !e.currentTarget.contains(b)) return false;
      var kind = null;
      if (b === styleBtn) kind = 'style';
      else if (b === shapeBtn) kind = 'shape';
      else kind = optionsOf(b.getAttribute('data-tool'));
      if (!kind) return false;
      e.preventDefault();
      e.stopPropagation();
      if (kind !== 'style') {
        var name = b === shapeBtn ? (SHAPES.indexOf(tool) >= 0 ? tool : s.shape) : b.getAttribute('data-tool');
        if (tool !== name && !setTool(name)) return true;
        var c = coachState();
        if (!c.used) {
          c.used = true;
          writeCoach();
        }
      }
      if (pop && pop.anchor === b) {
        var first = popEl.querySelector('[role="radio"][tabindex="0"], button, input');
        if (first) first.focus();
      } else {
        openPop(kind, b, true);
      }
      return true;
    }

    /* The last save on the way out. The app's storage flush listens too and
     * was there first: the app calls ns.ink.flush() ahead of it, and this
     * stays for hosts that do not. */
    function onPageHide() { if (!closed) leaving(); }
    function onVisibility() { if (document.visibilityState === 'hidden' && !closed) leaving(); }

    /* A hidden page may be discarded without another word (phones do it to
     * background tabs): words still in the field go on the sheet and are
     * saved with it. */
    function leaving() {
      if (textPending()) commitText();
      saveNow();
    }

    /* ---------------------------------------------------------------- read only, close */

    /* The host's view-only switch. A locked file stays locked whatever it
     * says: nothing this editor wrote over it would be what it was. */
    function setReadOnly(on) {
      if (closed) return;
      hostReadOnly = !!on;
      var next = hostReadOnly || locked;
      if (next === readOnly) return;
      var hadFocus = root.contains(document.activeElement);
      if (next) {
        if (textEdit) commitText();
        if (gesture) release(gesture, null);
        closePop(false);
        selection = [];
        toolBeforeReadOnly = tool;
        readOnly = true;
        tool = 'hand';
      } else {
        readOnly = false;
        tool = toolBeforeReadOnly && toolBeforeReadOnly !== 'hand' ? toolBeforeReadOnly : (s.tool || 'pen');
      }
      if (next) root.setAttribute('data-readonly', '');
      else root.removeAttribute('data-readonly');
      hideCoach();
      updateToolbar();
      updateCursor();
      paintAll();
      refreshSaveState();
      /* The tools vanish in view only: a focused one would drop the focus
       * to the page. */
      keepFocus(hadFocus);
    }

    /* The editor turned to another page of the notebook: the page it was
     * on is handed over (the host answers that save at once) and kept with
     * its undo; the new one opens from its file - with the undo it had, if
     * the file is the one this editor last wrote or read for it. The camera
     * is the host's to place afterwards (page coordinates changed). Refused
     * (false) while a save is still being answered. */
    function setPage(spec) {
      if (closed || !spec) return false;
      var nextId = spec.id != null ? String(spec.id) : null;
      var text = typeof spec.svgText === 'string' ? spec.svgText : '';
      flushEdits();
      if (pendingSaves || inSave) return false;
      if (!readOnly) saveNow();
      if (pendingSaves || inSave) return false;
      if (pageId != null) {
        pageCache.set(pageId, {
          text: currentText, elements: elements, background: background,
          undo: undoStack, redo: redoStack, parsed: parsed
        });
      }
      var cached = nextId != null ? pageCache.get(nextId) : null;
      if (cached && cached.text === text) {
        parsed = cached.parsed;
        elements = cached.elements;
        background = cached.background;
        undoStack = cached.undo;
        redoStack = cached.redo;
      } else {
        parsed = parse(text);
        elements = parsed.kind === 'ink' ? parsed.elements : [];
        background = parsed.background || null;
        undoStack = [];
        redoStack = [];
      }
      pageId = nextId;
      currentText = text;
      page = validPage(spec.page) || page;
      locked = parsed.kind === 'newer' || parsed.kind === 'invalid';
      var wasReadOnly = readOnly;
      readOnly = hostReadOnly || locked;
      if (readOnly !== wasReadOnly) {
        if (readOnly) {
          hideCoach();
          toolBeforeReadOnly = tool;
          tool = 'hand';
          root.setAttribute('data-readonly', '');
        } else {
          tool = toolBeforeReadOnly && toolBeforeReadOnly !== 'hand' ? toolBeforeReadOnly : (s.tool || 'pen');
          root.removeAttribute('data-readonly');
        }
        updateCursor();
      }
      savedSig = confirmedSig = signature(elements, background);
      if (parsed.repaired && !readOnly) savedSig = confirmedSig = '';
      saveFailed = false;
      selection = [];
      lastKey = null;
      lastTap = null;
      /* A page with a paper of its own (spec.look): the sheet takes it
       * before the page is painted. */
      if (spec.look) takeLook(spec.look);
      noticeKey = parsed.kind === 'newer' || parsed.kind === 'invalid' || parsed.kind === 'damaged' ? 'ink.notice.' + parsed.kind : null;
      if (noticeKey) {
        notice.textContent = t(noticeKey);
        notice.hidden = false;
        root.setAttribute('aria-describedby', hintId + ' ' + hintId + '-notice');
      } else hideNotice();
      paintBackground();
      applyPage();
      paintPaper(true);
      paintAll();
      paintHistory();
      updateToolbar();
      refreshSaveState(true);
      if (parsed.repaired && !readOnly) scheduleSave();
      return true;
    }

    /* What is in hand is put down: the text being written goes on the
     * sheet, a gesture under way is kept as it is. */
    function flushEdits() {
      try {
        if (textEdit) commitText();
        if (gesture) release(gesture, null);
      } catch (err) { warn('closing with a gesture open', err); }
    }

    /* Done: the drawing is saved, and the editor closes once the host has
     * it. When the host cannot keep it, the editor stays open, says so, and
     * Done tries again: closing would leave the drawing nowhere. A host that
     * closes the editor itself (editor.close()) is told the outcome and
     * handed the drawing instead. */
    function done(handed) {
      if (closed || closing || doneWaiting) return;
      flushEdits();
      var out = saveNow();
      if (out.status === 'failed') {
        notSaved();
        return;
      }
      /* The drawing this Done handed over is the one onClose reports. */
      var svg = out.svg || (typeof handed === 'string' ? handed : null);
      if (inSave || pendingSaves) {
        doneWaiting = true;
        doneBtn.setAttribute('aria-disabled', 'true');
        root.setAttribute('data-closing', '');
        whenSettled(function () {
          doneWaiting = false;
          doneBtn.removeAttribute('aria-disabled');
          root.removeAttribute('data-closing');
          if (closed) return;
          if (!isDirtyNow()) close(svg);
          else if (saveFailed) notSaved();
          /* Drawn on while the host was answering: that goes too. */
          else done(svg);
        });
        return;
      }
      if (isDirtyNow()) notSaved();
      else close(svg);
    }

    function notSaved() {
      refreshSaveState();
      say(t('ink.notSavedStay'), true);
    }

    /* The host's close: whatever is waiting is handed over at once and the
     * editor leaves the page. onClose({saved, svg}) follows once the host
     * has answered every save: `saved` is whether the drawing as it was at
     * the end is kept; `svg` is that drawing (null when nothing needed
     * saving), so a host whose storage failed still has it. Returns the
     * same svg. */
    function close(handed) {
      /* A host closing the editor from inside onSave (or onClose) gets the
       * one close that is already happening. */
      if (closed || closing) return closeResult;
      closing = true;
      flushEdits();
      var out = saveNow();
      closeResult = out.svg || (isDirtyNow() ? fileSvg() : (typeof handed === 'string' ? handed : null));
      closed = true;
      teardown();
      maybeEnd();
      return closeResult;
    }

    function maybeEnd() {
      if (!closed || ended || inSave || pendingSaves) return;
      ended = true;
      var i = editors.indexOf(api);
      if (i >= 0) editors.splice(i, 1);
      var saved = !isDirtyNow();
      var svg = closeResult || (saved ? null : fileSvg());
      if (typeof opts.onClose === 'function') {
        try { opts.onClose({ saved: saved, svg: svg }); } catch (err) { warn('onClose failed', err); }
      }
    }

    function teardown() {
      clearTimeout(saveTimer);
      hideCoach();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (paperFrame) cancelAnimationFrame(paperFrame);
      paperFrame = 0;
      stopFling();
      if (observer) observer.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', onWindowContextMenu, true);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      listenPointerKind(false);
      if (typeof offLang === 'function') offLang();
      var hadFocus = root.contains(document.activeElement);
      if (root.parentNode) root.parentNode.removeChild(root);
      var back = opts.returnFocus || opener;
      if (hadFocus && back && back.isConnected && typeof back.focus === 'function') {
        try { back.focus({ preventScroll: true }); } catch (err) { /* gone */ }
      }
    }

    /* ---------------------------------------------------------------- language */

    function relabel() {
      if (closed) return;
      labelled.forEach(function (r) { name(r.el, r.key, r.keys, r.tip); });
      root.setAttribute('aria-label', opts.title ? t('ink.surfaceTitled', { title: opts.title }) : t('ink.surface'));
      hint.textContent = t('ink.hint');
      doneText.textContent = t('ink.done');
      ta.setAttribute('placeholder', t('ink.textPlaceholder'));
      if (bgNode && bgNode.firstChild) bgNode.firstChild.textContent = t('ink.background');
      if (noticeKey) notice.textContent = t(noticeKey);
      hideCoach();
      saveState = '';
      refreshSaveState(true);
      updateToolbar();
      /* Other words, other widths: the layout is measured again. */
      wideNeed = 0;
      updateLayout();
      applyCamera();
      if (pop) refreshPop();
    }

    /* Forced colours turned on or off: the pen's pointer is decided again. */
    function onCursorKind() {
      if (closed) return;
      nibKey = null;
      refreshNibCursor();
    }

    function listenQuery(query, fn, on) {
      if (!query) return;
      try {
        if (query.addEventListener) query[on ? 'addEventListener' : 'removeEventListener']('change', fn);
        else if (query.addListener) query[on ? 'addListener' : 'removeListener'](fn);
      } catch (err) { /* a browser without media query events: the first measure stays */ }
    }

    function listenPointerKind(on) {
      listenQuery(coarseQuery, onPointerKind, on);
      listenQuery(forcedQuery, onCursorKind, on);
    }

    var offLang = null;
    if (ns.bus && typeof ns.bus.on === 'function') {
      try { offLang = ns.bus.on('lang', relabel); } catch (err) { offLang = null; }
    }

    /* ---------------------------------------------------------------- wiring */

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onHover);
    surface.addEventListener('pointerleave', onLeave);
    surface.addEventListener('pointerenter', function () { if (!gesture) refreshRect(); });
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('gesturestart', onGestureStart);
    surface.addEventListener('gesturechange', onGestureChange);
    surface.addEventListener('gestureend', onGestureEnd);
    surface.addEventListener('dblclick', function (e) { e.preventDefault(); });
    /* The sheet moves its own touches. touch-action: none keeps the browser
     * from panning it, but Chromium still reads a quick stroke or pan as a
     * fling with nothing to scroll, and takes the next tap anywhere on the
     * page, up to half a second later, as the touch that stops that fling:
     * it never becomes a click (a tool pressed right after a stroke did
     * nothing). A touch whose moves the page consumes starts no fling; its
     * pointer events come first and are not affected, and a tap (no move)
     * stays the browser's own. */
    surface.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('keydown', onShiftDown, true);
    root.addEventListener('keyup', onKeyUp);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('pointerdown', onRootPointerDown, true);
    root.addEventListener('mousedown', onRootMouseDown, true);
    root.addEventListener('paste', onClipboard);
    surface.addEventListener('dragover', onDragOver);
    surface.addEventListener('drop', onDrop);
    root.addEventListener('copy', onClipboard);
    root.addEventListener('cut', onClipboard);
    [toolsBar, actionsBar, zoomBar, selBar].forEach(function (bar) { bar.addEventListener('keydown', onBarKey); });
    ta.addEventListener('input', function () { styleText(); });
    ta.addEventListener('blur', onTextBlur);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('contextmenu', onWindowContextMenu, true);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    listenPointerKind(true);

    host.appendChild(root);
    paintBackground();
    if (background && background.measure) {
      var probe = new Image();
      probe.onload = function () {
        if (closed || !background || background.href !== probe.src) return;
        /* The signature reads the picture and its place, not its size, so
         * learning the size does not make the drawing need saving. */
        background = { href: background.href, x: background.x, y: background.y, w: probe.naturalWidth || 800, h: probe.naturalHeight || 600 };
        paintBackground();
        if (!undoStack.length && !gesture) fit(1);
      };
      probe.src = background.href;
    }
    if (window.ResizeObserver) {
      observer = new ResizeObserver(function () { onResize(); });
      observer.observe(root);
    } else {
      window.addEventListener('resize', onResize);
    }
    refreshRect();
    updateLayout();
    applyPage();
    if (opts.hostCamera) {
      if (opts.camera && finite(opts.camera.k)) setCamera(opts.camera);
      else applyCamera();
      fitted = true;
    } else if (rect.width > 0 && rect.height > 0) fitted = fit(1);
    else applyCamera();
    updateToolbar();
    updateCursor();
    paintAll();
    refreshSaveState();
    if (parsed.repaired && !readOnly) scheduleSave();
    if (opts.focus !== false) focusRoot();

    var api = {
      el: root,
      /* Wrapped: a host passing these as listeners must not hand an event
       * in as the drawing. */
      close: function () { return close(); },
      done: function () { done(); },
      /* Something not yet kept: a change not handed over, a save the host
       * has not answered, words typed, a stroke under way. A closed editor
       * is dirty until the host has answered its last save. */
      isDirty: function isDirty() {
        if (ended) return false;
        if (isDirtyNow() || pendingSaves || inSave) return true;
        if (closed) return false;
        return textPending() || !!(gesture && (gesture.kind === 'draw' || (gesture.er && gesture.er.changed) || gesture.work));
      },
      save: function save() {
        if (closed) return null;
        if (textEdit) commitText();
        var out = saveNow();
        return out.status === 'saved' || out.status === 'pending' ? out.svg : null;
      },
      /* How the file opened: kind as ns.ink.parse says ('ink', 'empty',
       * 'foreign', 'damaged', 'newer', 'invalid'), whether it is locked
       * view only, whether it had to be repaired. */
      loaded: function () { return { kind: parsed.kind, locked: locked, repaired: !!parsed.repaired, excalidraw: !!parsed.excalidraw, version: parsed.version }; },
      setReadOnly: setReadOnly,
      readOnly: function () { return readOnly; },
      svg: function () { return fileSvg(); },
      scene: function () { return elements.map(elementJson); },
      elements: function () { return elements.slice(); },
      background: function () { return background ? { x: background.x, y: background.y, w: background.w, h: background.h } : null; },
      selection: function () { return selection.slice(); },
      select: select,
      tool: function () { return tool; },
      setTool: setTool,
      undo: undo,
      redo: redo,
      canUndo: function () { return !!undoStack.length; },
      canRedo: function () { return !!redoStack.length; },
      /* The host's history moved: the buttons say what it can do now. */
      refreshHistory: function () { if (!closed) paintHistory(); },
      history: function () { return { undo: undoStack.length, redo: redoStack.length }; },
      camera: function () { return { x: cam.x, y: cam.y, k: cam.k }; },
      /* The pen's pointer as set on the editor ('' when the tool has a
       * system cursor), and how many times it was decided anew. */
      nibCursor: function () { return { builds: nibBuilds, hover: hoverCursor, shown: !nib.hidden, w: nibW, h: nibH, shape: root.getAttribute('data-nib') || '' }; },
      setCamera: setCamera,
      fit: function (maxK) { return fit(maxK || 4); },
      zoomBy: zoomBy,
      toScene: function (cx, cy) { refreshRect(); return toScene(cx, cy); },
      toClient: function (x, y) { refreshRect(); var p = toLocal([x, y]); return [p[0] + rect.left, p[1] + rect.top]; },
      setPen: choosePen,
      setColor: pickColor,
      setSize: setPenSize,
      setEraser: function (o) { o = o || {}; setEraser(o.mode, o.size); if (pop) refreshPop(); },
      settings: function () { return JSON.parse(JSON.stringify(s)); },
      saveState: function () { return saveState; },
      layout: function () { return layout; },
      busy: function () { return !!gesture || !!pinch; },
      penSeen: function () { return penSeen; },
      focus: function () { if (!closed) focusRoot(); },
      text: function () { return textEdit ? { value: ta.value, x: textEdit.x, y: textEdit.y, size: textEdit.size } : null; },
      setLook: setLook,
      look: function () { return { theme: look.theme, background: look.background, paper: look.paper, sheet: look.sheet, ink: look.ink, dark: look.dark }; },
      setPage: setPage,
      insertImage: insertImage,
      lockSelection: lockSelection,
      pageId: function () { return pageId; },
      /* The page is the same, its name changed (it got its file). */
      setPageId: function (id) {
        var next = id != null ? String(id) : null;
        if (pageId != null && pageCache.has(pageId)) {
          pageCache.set(next, pageCache.get(pageId));
          pageCache.delete(pageId);
        }
        pageId = next;
      },
      page: function () { return page ? { w: page.w, h: page.h } : null; },
      /* After the host moved or resized what is around the sheet. */
      paint: function () { if (!closed) { refreshRect(); applyCamera(); paintPaper(); } },
      rect: function () { refreshRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; }
    };
    editors.push(api);
    return api;
  }

  /* ================================================================ module */

  function isDirty() {
    for (var i = 0; i < editors.length; i++) if (editors[i].isDirty()) return true;
    return false;
  }

  /* Save every open drawing now: before the page goes, or before the host
   * switches map. */
  function flush() {
    var saved = 0;
    editors.slice().forEach(function (ed) { if (ed.save()) saved++; });
    return saved;
  }

  function init() {
    loadSettings();
  }

  /* The editor's keys, for the help sheet. They are not commands of the
   * app: the global dispatcher would fire them on the map. */
  function shortcuts() {
    var list = TOOLS.map(function (id) {
      return { keys: id === 'eraser' ? ['E', '0'] : [TOOL_KEYS[id]], label: t('ink.tool.' + id) };
    });
    return list.concat([
      { keys: ['Mod+Z'], label: t('ink.undo') },
      { keys: ['Mod+Shift+Z', 'Mod+Y'], label: t('ink.redo') },
      { keys: ['Mod+D'], label: t('ink.duplicate') },
      { keys: ['Mod+Shift+]'], label: t('ink.front') },
      { keys: ['Delete'], label: t('ink.delete') },
      { keys: ['Mod+='], label: t('ink.zoomIn') },
      { keys: ['Mod+-'], label: t('ink.zoomOut') },
      { keys: ['Mod+0'], label: t('ink.zoomReset') },
      { keys: ['Shift+1'], label: t('ink.fit') }
    ]);
  }

  ns.ink = {
    init: init,
    open: open,
    isDirty: isDirty,
    flush: flush,
    parse: parse,
    serialize: serialize,
    isInkSvg: isInkSvg,
    shortcuts: shortcuts,
    editors: function () { return editors.slice(); },
    PAPER: PAPER,
    INK: INK,
    lightInk: lightInk,
    FONT: FONT,
    PENS: PENS.map(function (p) { return p.id; }),
    SWATCHES: SWATCHES.map(function (sw) { return sw.hex; }),
    engine: {
      strokePoints: strokePoints,
      strokeOutline: strokeOutline,
      outlinePath: outlinePath,
      makeStroke: makeStroke,
      makeShape: makeShape,
      makeText: makeText,
      measureText: measureText,
      normalizeElement: normalizeElement,
      elementJson: elementJson,
      boundsOf: boundsOf,
      contentBox: contentBox,
      shapeOf: shapeOf,
      touches: touches,
      within: within,
      inside: inside,
      cut: cut,
      erase: erase,
      eraseBegin: eraseBegin,
      eraseSweep: eraseSweep,
      eraseLoop: eraseLoop,
      eraseEnclose: eraseEnclose,
      eraseResult: eraseResult,
      translateEl: translateEl,
      scaleEl: scaleEl,
      signature: signature,
      specOf: specOf,
      specMarkup: specMarkup,
      cleanSettings: cleanSettings,
      resolveLook: resolveLook,
      penPreset: function (id) { var p = penById(id); return p ? JSON.parse(JSON.stringify(p)) : null; }
    }
  };
})(window.MindRoot);
