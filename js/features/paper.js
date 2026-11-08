/* MindRoot - paper: the notebook's paper catalogue, page sizes, the drawing
 * of every paper as SVG, its light and dark colours, and the import of a
 * picture to use as the paper instead.
 *
 * A notebook (docs/NOTEBOOK.md) has one paper for all its pages, either on
 * fixed-size pages or on one infinite canvas. This file only answers
 * questions with strings and numbers: what papers there are, how big a page
 * is, and what a paper looks like over a rectangle. It holds no app state,
 * so the notebook view, the ink editor, thumbnails, exports and the saved
 * page files all get the same drawing from the same call.
 *
 * Geometry is real-world: page px are CSS px, 1 mm = 96 / 25.4 px (MM), so
 * squares of 5 mm are 5 mm on a printed A4 and the staff lines of a music
 * paper are as far apart as on a printed one. Every paper is drawn by a
 * function of the rectangle asked for:
 *
 *   - on the infinite canvas (mode 'infinite', the default, as the call in
 *     docs/NOTEBOOK.md reads) the rectangle is what is on screen, in canvas
 *     px; periodic papers are anchored to the origin so the strips the
 *     caller asks for line up whatever the camera did, and papers that only
 *     make sense on a page (planner, storyboard, wireframes, Cornell...)
 *     repeat in page-sized cells (opts.tile, A4 by default);
 *   - on a page (mode 'page', page: true, or a book size in opts.size) the
 *     rectangle is the page; the layout uses the page's size (margins,
 *     Cornell columns, phone frames, the number of decades on a log paper,
 *     staves spread over the page).
 *
 * Only what is inside the rectangle is generated, and density is capped by
 * the zoom (opts.scale, screen px per page px): a family of lines whose
 * spacing on screen falls under a few pixels fades out, the coarsest family
 * thins out by powers of two, and no family ever emits more than MAX_LINES
 * lines. Page layouts on the canvas are budgeted by what their cells would
 * cost (full, frames only, then a pattern of page outlines). So a 2560 x
 * 1440 viewport costs at most a few thousand path segments at any zoom.
 * Dots, the honeycomb and far-out page outlines, which would be tens of
 * thousands of tiny shapes, use an SVG <pattern> anchored the same way.
 * Stroke widths are kept between a hairline and a calm maximum on screen.
 *
 * Colours: the sheet and line colours are data, like ink's PAPER, not theme
 * tokens: they are written into page files that must look the same in
 * Obsidian or a browser. The light sheet is ink's paper. Every element of a
 * paper carries a class (mr-sheet, mr-line, mr-strong, mr-margin, mr-text),
 * and the ink editor marks the semantic ink with mr-ink, so themeSvg() can
 * turn a page saved on light paper into the dark (or a custom) one for
 * display. A custom background derives its line colours by contrast, so the
 * lines stay visible on any colour.
 *
 * importBackground() reads SVG, PNG or JPG. An SVG is sanitised strictly
 * (whitelisted elements; no script, foreignObject, animation, event
 * attribute, external reference or CSS url()/@import/escape; only raster
 * data: images; a DTD only for plain text entities, as Illustrator writes)
 * because it is a file from outside that will be shown inside the app; bad
 * CSS declarations are dropped one by one so the rest of a drawing keeps
 * its colours. PNG and JPG sizes are read from their headers (JPEG EXIF
 * orientation included), without decoding the picture, and a picture
 * larger than a phone can decode (MAX_SIDE, MAX_PIXELS) is refused; an SVG
 * that large is given a smaller size in the same proportions.
 *
 * API (docs/NOTEBOOK.md):
 *   MM, CATALOG [{group, id, label, params}], GROUPS [{id, label}],
 *   SIZES [{id, w, h, label, orientation}]   (label: an i18n key; mm)
 *   label(id) / groupLabel(id) / sizeLabel(id)   translated names
 *   entry(id), normalize(paper), normalizeSize(size)
 *   pageSize(size) -> {w, h} px
 *   patternSvg(paper, {x, y, w, h, mode, page, size, scale, print, tile,
 *                      theme, background, colors, sheet, id}) -> SVG fragment
 *              (a <g class="mr-paper" aria-hidden="true" pointer-events="none">)
 *   pageSvg(paper, {size | w, h, theme, background, scale, print}) -> SVG document
 *   colors(theme, background) -> {sheet, line, strongLine, margin, ink, text, dark}
 *   themeSvg(svgText, theme, background) -> svgText
 *   importBackground(file) -> Promise<{name, type, bytes, w, h, original}>
 *   sanitizeSvg(text) -> {text, w, h}  (throws an Error with .code)
 *   imageSize(bytes) -> {type, w, h} | null
 *   isCellPaper(id)  the paper repeats in page cells on the canvas
 *   contrast(a, b)   the WCAG ratio of two #hex colours */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var MM = 96 / 25.4;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';
  var XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
  /* Text drawn on a paper (planner days, axis numbers) must render inside an
   * <img>, which loads no fonts: the system stack, as ink writes it. */
  var FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, sans-serif';

  /* Density, in screen px between two lines of one family: under FADE_LO a
   * family is not drawn, over FADE_HI it is drawn at full strength, between
   * the two it fades. The coarsest family of a paper doubles its step until
   * it is at least STRIDE_MIN apart, so a zoomed-out canvas still shows its
   * paper, just coarser. */
  var FADE_LO = 2.5;
  var FADE_HI = 7;
  var STRIDE_MIN = 5;
  var MAX_LINES = 3000;
  /* Page layouts on the canvas (planner, wireframes, Cornell...) cost far
   * more per cell than a line family, so they are budgeted by what they
   * would write: every cell in full while the whole view stays under
   * CELL_BUDGET characters of drawing and a cell is at least CELL_FULL_PX
   * on screen; then only their frames (no rules, no small details) under
   * the same budget and down to CELL_FRAME_PX; then one <pattern> of page
   * outlines, which costs the same at any zoom. MAX_CELLS bounds the loop
   * whatever a probe says. */
  var CELL_BUDGET = 96000;
  var CELL_FULL_PX = 120;
  var CELL_FRAME_PX = 40;
  var MAX_CELLS = 400;
  /* Under this size on screen a label is not worth drawing. */
  var TEXT_MIN = 4;
  /* Axis numbers stay at least this far apart on screen. */
  var LABEL_GAP = 28;
  /* A calligraphy row smaller than this on screen loses its slant lines
   * (too small to write in, and they are most of the paper's cost); they
   * come in over SLANT_RAMP px more. */
  var SLANT_ROW = 48;
  var SLANT_RAMP = 32;

  /* Limits for a picture imported as the paper. */
  var MAX_RASTER = 25 * 1024 * 1024;
  var MAX_SVG = 8 * 1024 * 1024;
  /* A background is decoded for every page that shows it: past these a
   * phone or an iPad cannot hold it (a mostly flat 30000 px square PNG is a
   * few MB on disk and 3.6 GB decoded). An SVG larger than this is not
   * refused, it is given a smaller size with the same proportions. */
  var MAX_SIDE = 20000;
  var MAX_PIXELS = 50000000;

  /* ================================================================ strings */

  var STRINGS = {
    it: {
      'paper.group.base': 'Base',
      'paper.group.school': 'Scuola',
      'paper.group.science': 'Matematica e scienze',
      'paper.group.music': 'Musica',
      'paper.group.design': 'Design',
      'paper.group.planning': 'Organizzazione',
      'paper.group.calligraphy': 'Calligrafia',
      'paper.group.import': 'Importa',
      'paper.type.blank': 'Vuoto',
      'paper.type.dots': 'Puntini',
      'paper.type.grid-4': 'Quadretti 4 mm',
      'paper.type.grid-5': 'Quadretti 5 mm',
      'paper.type.grid-10': 'Quadretti 10 mm',
      'paper.type.ruled-narrow': 'Righe strette',
      'paper.type.ruled': 'Righe normali',
      'paper.type.ruled-wide': 'Righe larghe',
      'paper.type.ruled-margin': 'Righe con margine',
      'paper.type.school-1': 'Righe di prima',
      'paper.type.school-2': 'Righe di seconda',
      'paper.type.cornell': 'Cornell',
      'paper.type.two-columns': 'Due colonne (lingue)',
      'paper.type.millimetre': 'Millimetrata',
      'paper.type.semilog': 'Semi-logaritmica',
      'paper.type.log-log': 'Logaritmica (log-log)',
      'paper.type.polar': 'Polare',
      'paper.type.isometric': 'Isometrica',
      'paper.type.honeycomb': "Nido d'ape",
      'paper.type.cartesian': 'Assi cartesiani',
      'paper.type.staff': 'Pentagramma',
      'paper.type.grand-staff': 'Doppio pentagramma (pianoforte)',
      'paper.type.guitar-tab': 'Tablatura per chitarra',
      'paper.type.grid-8pt': 'Griglia 8 pt',
      'paper.type.wireframe-phone': 'Wireframe telefono',
      'paper.type.wireframe-browser': 'Wireframe browser',
      'paper.type.storyboard': 'Storyboard',
      'paper.type.weekly': 'Planner settimanale',
      'paper.type.todo': 'Lista di cose da fare',
      'paper.type.calligraphy': 'Righe guida inclinate',
      'paper.type.image': 'SVG, PNG o JPG come sfondo',
      'paper.size.a3': 'A3',
      'paper.size.a4': 'A4',
      'paper.size.a5': 'A5',
      'paper.size.a6': 'A6',
      'paper.size.b5': 'B5',
      'paper.size.letter': 'Letter',
      'paper.size.legal': 'Legal',
      'paper.size.square': 'Quadrato',
      'paper.size.wide': '16:9',
      'paper.size.standard': '4:3',
      'paper.size.ipad': 'iPad',
      'paper.size.custom': 'Personalizzato',
      'paper.portrait': 'Verticale',
      'paper.landscape': 'Orizzontale',
      'paper.background.auto': 'Automatico',
      'paper.day.1': 'Lunedì',
      'paper.day.2': 'Martedì',
      'paper.day.3': 'Mercoledì',
      'paper.day.4': 'Giovedì',
      'paper.day.5': 'Venerdì',
      'paper.day.6': 'Sabato',
      'paper.day.7': 'Domenica',
      'paper.notes': 'Note',
      'paper.import.unsupported': 'Questo file non si può usare come sfondo. Scegli un SVG, un PNG o un JPG.',
      'paper.import.tooBig': 'Il file è troppo grande per uno sfondo (al massimo {mb} MB).',
      'paper.import.tooLarge': "L'immagine è troppo grande per uno sfondo (al massimo {mp} megapixel e {side} pixel per lato).",
      'paper.import.invalid': 'Questo file non si riesce a leggere.',
      'paper.import.empty': 'Il file è vuoto.'
    },
    en: {
      'paper.group.base': 'Basic',
      'paper.group.school': 'School',
      'paper.group.science': 'Maths and science',
      'paper.group.music': 'Music',
      'paper.group.design': 'Design',
      'paper.group.planning': 'Planning',
      'paper.group.calligraphy': 'Calligraphy',
      'paper.group.import': 'Import',
      'paper.type.blank': 'Blank',
      'paper.type.dots': 'Dots',
      'paper.type.grid-4': 'Grid 4 mm',
      'paper.type.grid-5': 'Grid 5 mm',
      'paper.type.grid-10': 'Grid 10 mm',
      'paper.type.ruled-narrow': 'Narrow ruled',
      'paper.type.ruled': 'Ruled',
      'paper.type.ruled-wide': 'Wide ruled',
      'paper.type.ruled-margin': 'Ruled with margin',
      'paper.type.school-1': 'Year 1 lines (Italian school)',
      'paper.type.school-2': 'Year 2 lines (Italian school)',
      'paper.type.cornell': 'Cornell',
      'paper.type.two-columns': 'Two columns (languages)',
      'paper.type.millimetre': 'Millimetre graph',
      'paper.type.semilog': 'Semi-log',
      'paper.type.log-log': 'Log-log',
      'paper.type.polar': 'Polar',
      'paper.type.isometric': 'Isometric',
      'paper.type.honeycomb': 'Honeycomb',
      'paper.type.cartesian': 'Cartesian axes',
      'paper.type.staff': 'Music staff',
      'paper.type.grand-staff': 'Grand staff (piano)',
      'paper.type.guitar-tab': 'Guitar tab',
      'paper.type.grid-8pt': '8 pt grid',
      'paper.type.wireframe-phone': 'Phone wireframe',
      'paper.type.wireframe-browser': 'Browser wireframe',
      'paper.type.storyboard': 'Storyboard',
      'paper.type.weekly': 'Weekly planner',
      'paper.type.todo': 'To-do list',
      'paper.type.calligraphy': 'Slanted guide lines',
      'paper.type.image': 'SVG, PNG or JPG as background',
      'paper.size.a3': 'A3',
      'paper.size.a4': 'A4',
      'paper.size.a5': 'A5',
      'paper.size.a6': 'A6',
      'paper.size.b5': 'B5',
      'paper.size.letter': 'Letter',
      'paper.size.legal': 'Legal',
      'paper.size.square': 'Square',
      'paper.size.wide': '16:9',
      'paper.size.standard': '4:3',
      'paper.size.ipad': 'iPad',
      'paper.size.custom': 'Custom',
      'paper.portrait': 'Portrait',
      'paper.landscape': 'Landscape',
      'paper.background.auto': 'Automatic',
      'paper.day.1': 'Monday',
      'paper.day.2': 'Tuesday',
      'paper.day.3': 'Wednesday',
      'paper.day.4': 'Thursday',
      'paper.day.5': 'Friday',
      'paper.day.6': 'Saturday',
      'paper.day.7': 'Sunday',
      'paper.notes': 'Notes',
      'paper.import.unsupported': 'This file cannot be used as a background. Choose an SVG, a PNG or a JPG.',
      'paper.import.tooBig': 'The file is too big for a background (at most {mb} MB).',
      'paper.import.tooLarge': 'The picture is too large for a background (at most {mp} megapixels and {side} pixels on a side).',
      'paper.import.invalid': 'This file cannot be read.',
      'paper.import.empty': 'The file is empty.'
    }
  };

  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  /* Through ns.i18n when it is there (it always is in the app); English
   * otherwise, so the module also works on a bare page. */
  function t(key, vars) {
    var text = null;
    if (ns.i18n && typeof ns.i18n.t === 'function') {
      try { text = ns.i18n.t(key, vars); } catch (err) { text = null; }
      if (text != null && text !== key) return text;
    }
    text = STRINGS.en[key] != null ? STRINGS.en[key] : key;
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars && vars[name] != null ? String(vars[name]) : whole;
    });
  }

  /* ================================================================ catalogue */

  /* Every length in params is in millimetres unless the name says px. The
   * values are the real ones: ruled papers at 1/4", 9/32" (college) and
   * 11/32" (wide), the Cornell 2.5" cue column and 2" summary, staff lines
   * 2.25 mm apart (a 9 mm staff, a comfortable size for writing by hand),
   * calligraphy in the 3:2:3 proportion of copperplate on a 55 degree slant. */
  var GROUP_IDS = ['base', 'school', 'science', 'music', 'design', 'planning', 'calligraphy', 'import'];

  var CATALOG = [
    { group: 'base', id: 'blank', params: {} },
    { group: 'base', id: 'dots', params: { step: 5 } },
    { group: 'base', id: 'grid-4', params: { step: 4 } },
    { group: 'base', id: 'grid-5', params: { step: 5 } },
    { group: 'base', id: 'grid-10', params: { step: 10 } },
    { group: 'base', id: 'ruled-narrow', params: { step: 6.35, top: 22, bottom: 12 } },
    { group: 'base', id: 'ruled', params: { step: 7.1, top: 22, bottom: 12 } },
    { group: 'base', id: 'ruled-wide', params: { step: 8.7, top: 22, bottom: 12 } },
    { group: 'base', id: 'ruled-margin', params: { step: 7.1, top: 22, bottom: 12, margin: 25 } },
    { group: 'school', id: 'school-1', params: { band: 10, gap: 5, top: 20, bottom: 12 } },
    { group: 'school', id: 'school-2', params: { ascender: 5, body: 4, descender: 4, top: 20, bottom: 12 } },
    { group: 'school', id: 'cornell', params: { step: 7.1, header: 25, cue: 63.5, summary: 50.8 } },
    { group: 'school', id: 'two-columns', params: { step: 7.1, header: 25 } },
    { group: 'science', id: 'millimetre', params: { margin: 10 } },
    { group: 'science', id: 'semilog', params: { decade: 90, step: 2, margin: 10, label: 6 } },
    { group: 'science', id: 'log-log', params: { decade: 90, margin: 10, label: 6 } },
    { group: 'science', id: 'polar', params: { ring: 5, ray: 15, margin: 14 } },
    { group: 'science', id: 'isometric', params: { side: 5 } },
    { group: 'science', id: 'honeycomb', params: { side: 5 } },
    { group: 'science', id: 'cartesian', params: { step: 5, tick: 10, margin: 10 } },
    { group: 'music', id: 'staff', params: { space: 2.25, period: 22, top: 20, bottom: 15, side: 15 } },
    { group: 'music', id: 'grand-staff', params: { space: 2.25, between: 11, period: 46, top: 20, bottom: 15, side: 15, left: 22 } },
    { group: 'music', id: 'guitar-tab', params: { space: 3, period: 27, top: 20, bottom: 15, side: 15 } },
    { group: 'design', id: 'grid-8pt', params: { stepPx: 8, every: 8 } },
    { group: 'design', id: 'wireframe-phone', params: { margin: 12, gap: 10, label: 8 } },
    { group: 'design', id: 'wireframe-browser', params: { margin: 12, gap: 10, label: 8, toolbar: 9 } },
    { group: 'design', id: 'storyboard', params: { margin: 12, gap: 8, lines: 3, step: 6 } },
    { group: 'planning', id: 'weekly', params: { margin: 10, header: 16, gap: 4, step: 7 } },
    { group: 'planning', id: 'todo', params: { margin: 15, header: 28, step: 9, box: 4.4 } },
    { group: 'calligraphy', id: 'calligraphy', params: { xHeight: 5, ascender: 7.5, descender: 7.5, gap: 5, slant: 55, slantStep: 8, top: 20, bottom: 12, side: 12 } },
    { group: 'import', id: 'image', params: {} }
  ];
  CATALOG.forEach(function (e) { e.label = 'paper.type.' + e.id; Object.freeze(e.params); Object.freeze(e); });
  Object.freeze(CATALOG);

  var GROUPS = Object.freeze(GROUP_IDS.map(function (id) { return Object.freeze({ id: id, label: 'paper.group.' + id }); }));

  var BY_ID = Object.create(null);
  CATALOG.forEach(function (e) { BY_ID[e.id] = e; });

  /* Papers whose layout belongs to a page: on the infinite canvas they
   * repeat in page-sized cells instead of running on forever. */
  var CELL_PAPERS = { 'cornell': 1, 'two-columns': 1, 'wireframe-phone': 1, 'wireframe-browser': 1, 'storyboard': 1, 'weekly': 1, 'todo': 1 };

  function entry(id) { return BY_ID[id] || null; }
  function isCellPaper(id) { return !!CELL_PAPERS[id]; }
  function label(id) { return t('paper.type.' + (BY_ID[id] ? id : 'blank')); }
  function groupLabel(id) { return t('paper.group.' + id); }

  /* The range each parameter may take when book.json overrides it. The
   * file is user data (it can come in an imported project), and some
   * parameters drive loops, so every value is clamped to something a page
   * can mean: lengths from half a millimetre to a metre, rays a whole
   * divisor-friendly 1 to 90 degrees, counts whole numbers ('every' must be
   * an integer: plan() relies on each level dividing the next). */
  var LENGTH = { min: 0.5, max: 1000 };
  var LIMITS = {
    ray: { min: 1, max: 90 },
    slant: { min: 15, max: 90 },
    every: { min: 1, max: 64, whole: true },
    lines: { min: 1, max: 20, whole: true },
    stepPx: { min: 2, max: 512 },
    slantStep: { min: 2, max: 100 },
    decade: { min: 5, max: 1000 }
  };

  /* A paper as book.json stores it ({type, ...overrides}) with the
   * catalogue's parameters under it. An unknown type (a later version's
   * paper) draws as blank rather than failing; an override that is not a
   * positive number is ignored, one out of range is clamped. */
  function normalize(paper) {
    var type = paper && typeof paper === 'object' ? paper.type : paper;
    var e = BY_ID[type] || BY_ID.blank;
    var params = {};
    var k;
    for (k in e.params) params[k] = e.params[k];
    if (paper && typeof paper === 'object') {
      for (k in paper) {
        if (k === 'type' || !Object.prototype.hasOwnProperty.call(e.params, k)) continue;
        var raw = paper[k];
        if (typeof raw !== 'number' && typeof raw !== 'string') continue;
        var v = Number(raw);
        if (!isFinite(v) || !(v > 0)) continue;
        var lim = LIMITS[k] || LENGTH;
        if (lim.whole) v = Math.round(v);
        params[k] = clamp(v, lim.min, lim.max);
      }
    }
    return { type: e.id, params: params };
  }

  /* ================================================================ sizes */

  /* Millimetres, in the orientation the size is usually used in. The
   * screen-shaped sizes are the slide sizes of presentation software
   * (13.33 x 7.5 in and 10 x 7.5 in) and an 11" iPad's screen. */
  var SIZES = Object.freeze([
    { id: 'a3', w: 297, h: 420, orientation: 'portrait' },
    { id: 'a4', w: 210, h: 297, orientation: 'portrait' },
    { id: 'a5', w: 148, h: 210, orientation: 'portrait' },
    { id: 'a6', w: 105, h: 148, orientation: 'portrait' },
    { id: 'b5', w: 176, h: 250, orientation: 'portrait' },
    { id: 'letter', w: 215.9, h: 279.4, orientation: 'portrait' },
    { id: 'legal', w: 215.9, h: 355.6, orientation: 'portrait' },
    { id: 'square', w: 210, h: 210, orientation: 'portrait' },
    { id: 'wide', w: 338.67, h: 190.5, orientation: 'landscape' },
    { id: 'standard', w: 254, h: 190.5, orientation: 'landscape' },
    { id: 'ipad', w: 157.8, h: 227, orientation: 'portrait' },
    { id: 'custom', w: 210, h: 297, orientation: 'portrait' }
  ].map(function (s) { s.label = 'paper.size.' + s.id; return Object.freeze(s); }));

  var SIZE_BY_ID = Object.create(null);
  SIZES.forEach(function (s) { SIZE_BY_ID[s.id] = s; });

  var CUSTOM_MIN = 20;
  var CUSTOM_MAX = 2000;

  function sizeLabel(id) { return t('paper.size.' + (SIZE_BY_ID[id] ? id : 'custom')); }

  /* A size as book.json stores it, made whole: known ids take their own
   * dimensions (a hand-edited w/h cannot make an A4 that is not A4), custom
   * sizes are clamped, the orientation is portrait or landscape. */
  function normalizeSize(size) {
    size = size && typeof size === 'object' ? size : { id: typeof size === 'string' ? size : 'a4' };
    var known = SIZE_BY_ID[size.id];
    var id = known ? known.id : 'custom';
    var w;
    var h;
    if (known && id !== 'custom') {
      w = known.w; h = known.h;
    } else {
      w = Number(size.w); h = Number(size.h);
      if (!(w > 0)) w = 210;
      if (!(h > 0)) h = 297;
      w = clamp(w, CUSTOM_MIN, CUSTOM_MAX);
      h = clamp(h, CUSTOM_MIN, CUSTOM_MAX);
    }
    var orientation = size.orientation === 'landscape' || size.orientation === 'portrait'
      ? size.orientation : (id !== 'custom' ? known.orientation : (w > h ? 'landscape' : 'portrait'));
    var lo = Math.min(w, h);
    var hi = Math.max(w, h);
    if (orientation === 'landscape') { w = hi; h = lo; } else { w = lo; h = hi; }
    return { id: id, w: round2(w), h: round2(h), orientation: orientation };
  }

  function pageSize(size) {
    var s = normalizeSize(size);
    return { w: round2(s.w * MM), h: round2(s.h * MM) };
  }

  /* ================================================================ colours */

  /* The light sheet is ink's PAPER (what page files are saved on). Lines are
   * a cool grey-blue, quiet next to the ink but there when you look for
   * them: about 1.4:1 on the sheet for the ordinary line, 2:1 for the
   * stronger one, the margin a soft red. The dark sheet sits a step above
   * the app's dark paper, so a page reads as a page on the stage. */
  var LIGHT = { sheet: '#fbfaf7', line: '#ccd3dd', strongLine: '#aab3c1', margin: '#e09a96', ink: '#15171c', text: '#6f7785' };
  var DARK = { sheet: '#1c1e22', line: '#383e48', strongLine: '#525b6a', margin: '#94545b', ink: '#e4e6ea', text: '#959dab' };
  var ROLES = ['sheet', 'line', 'strongLine', 'margin', 'ink', 'text'];

  /* The contrast each derived colour aims for on a custom sheet. */
  var TARGET = { line: 1.42, strongLine: 2.05, margin: 2.1, text: 4.0 };

  function hex(value) {
    var m = /^\s*#([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(String(value == null ? '' : value));
    if (!m) return null;
    var d = m[1].toLowerCase();
    if (d.length === 3) d = d[0] + d[0] + d[1] + d[1] + d[2] + d[2];
    return '#' + d;
  }

  function rgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toHex(c) {
    return '#' + c.map(function (v) {
      var x = Math.max(0, Math.min(255, Math.round(v)));
      return (x < 16 ? '0' : '') + x.toString(16);
    }).join('');
  }

  function luminance(h) {
    var c = rgb(h).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* Mixed in linear light, so a line half way to black looks half way. */
  function mix(a, b, amount) {
    var x = rgb(a);
    var y = rgb(b);
    return toHex(x.map(function (v, i) {
      var lx = Math.pow(v / 255, 2.2);
      var ly = Math.pow(y[i] / 255, 2.2);
      return Math.pow(lx + (ly - lx) * amount, 1 / 2.2) * 255;
    }));
  }

  /* The colour between sheet and base that reaches the wanted contrast on
   * the sheet (bisection; contrast grows monotonically along the mix), or
   * null when even the base itself does not. */
  function towards(sheet, base, wanted) {
    if (contrast(sheet, base) < wanted) return null;
    var lo = 0;
    var hi = 1;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (contrast(sheet, mix(sheet, base, mid)) < wanted) lo = mid; else hi = mid;
    }
    return mix(sheet, base, hi);
  }

  /* Lines for a sheet of any colour. On a light sheet they go towards a
   * blue-black, on a dark one towards white; the margin keeps its red when
   * the sheet lets it and turns neutral when it does not (a red sheet). */
  function derive(sheet) {
    var light = contrast(sheet, '#000000') >= contrast(sheet, '#ffffff');
    var base = light ? '#0e1a2c' : '#ffffff';
    var neutral = light ? '#000000' : '#ffffff';
    var red = light ? '#c0392b' : '#ff9c96';
    function pick(b, wanted) { return towards(sheet, b, wanted) || towards(sheet, neutral, wanted) || neutral; }
    /* The ink of the themes when it reads (4.5:1), black or white on the
     * middle tones where neither does. */
    var ink = contrast(sheet, LIGHT.ink) >= contrast(sheet, DARK.ink) ? LIGHT.ink : DARK.ink;
    if (contrast(sheet, ink) < 4.5) ink = light ? '#000000' : '#ffffff';
    return {
      sheet: sheet,
      line: pick(base, TARGET.line),
      strongLine: pick(base, TARGET.strongLine),
      margin: towards(sheet, red, TARGET.margin) || pick(base, TARGET.margin),
      ink: ink,
      text: pick(base, TARGET.text),
      dark: !light
    };
  }

  var derived = Object.create(null);

  /* theme: 'light' | 'dark' (anything else is light: the caller resolves
   * 'system'); background: 'auto' or a #hex colour for the sheet. */
  function colors(theme, background) {
    var custom = background && background !== 'auto' ? hex(background) : null;
    var out;
    if (custom) {
      out = derived[custom] || (derived[custom] = derive(custom));
    } else {
      var preset = theme === 'dark' ? DARK : LIGHT;
      out = { dark: theme === 'dark' };
      ROLES.forEach(function (r) { out[r] = preset[r]; });
    }
    var copy = {};
    for (var k in out) copy[k] = out[k];
    copy.background = custom || 'auto';
    return copy;
  }

  /* ================================================================ small helpers */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* Numbers as they go into SVG: two decimals, no "-0". */
  function n(v) {
    var r = Math.round(v * 100) / 100;
    return r === 0 ? '0' : String(r);
  }

  function xml(s) {
    return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var seq = 0;

  /* ================================================================ painter */

  /* Line styles. width is the stroke in page px at 1:1; on screen it is kept
   * between HAIRLINE and width * WIDTH_MAX, whatever the zoom, so lines
   * neither vanish when zoomed out nor turn into stripes when zoomed in.
   * 'fixed' styles are part of a drawing (a phone's home bar) and scale. */
  var HAIRLINE = 0.45;
  var WIDTH_MAX = 1.6;
  var STYLES = {
    fine: { cls: 'mr-line', role: 'line', width: 0.5, opacity: 0.8 },
    line: { cls: 'mr-line', role: 'line', width: 0.75, opacity: 1 },
    strong: { cls: 'mr-strong', role: 'strongLine', width: 0.9, opacity: 1 },
    bold: { cls: 'mr-strong', role: 'strongLine', width: 1.3, opacity: 1 },
    margin: { cls: 'mr-margin', role: 'margin', width: 1, opacity: 1 },
    frame: { cls: 'mr-strong', role: 'strongLine', width: 1.1, opacity: 1, round: true },
    pill: { cls: 'mr-strong', role: 'strongLine', width: 1.4 * MM, opacity: 1, round: true, fixed: true }
  };
  var STYLE_ORDER = ['fine', 'line', 'strong', 'margin', 'bold', 'frame', 'pill'];

  function painter(ctx) {
    var strokes = Object.create(null);
    var keys = [];
    var fills = [];
    var texts = [];
    var defs = [];
    var under = [];
    var written = 0;

    function widthOf(style) {
      if (style.fixed) return style.width;
      var screen = clamp(style.width * ctx.scale, HAIRLINE, style.width * WIDTH_MAX);
      return screen / ctx.scale;
    }

    /* One path per style and strength: a viewport is a handful of elements. */
    function stroke(name, d, alpha) {
      if (!d) return;
      var a = alpha == null ? 1 : alpha;
      if (a <= 0.02) return;
      var style = STYLES[name];
      var q = Math.round(a * style.opacity * 20) / 20;
      if (q <= 0) return;
      var key = name + '|' + q;
      var s = strokes[key];
      if (!s) {
        s = strokes[key] = { name: name, style: style, alpha: q, parts: [] };
        keys.push(key);
      }
      s.parts.push(d);
      written += d.length;
    }

    function fill(name, d, alpha) {
      var a = alpha == null ? 1 : alpha;
      if (a <= 0.02 || !d) return;
      var style = STYLES[name];
      var el = '<path class="' + style.cls + '" fill="' + ctx.colors[style.role] + '"' +
        (a < 1 ? ' fill-opacity="' + n(a) + '"' : '') + ' d="' + d + '"/>';
      fills.push(el);
      written += el.length;
    }

    /* Labels: skipped when they would be too small to read on screen. */
    function text(x, y, str, o) {
      o = o || {};
      var size = o.size || 2.6 * MM;
      if (size * ctx.density < TEXT_MIN) return;
      var before = texts.length;
      texts.push('<text class="mr-text" x="' + n(x) + '" y="' + n(y) + '" font-family="' + FONT + '" font-size="' + n(size) + '"' +
        (o.weight ? ' font-weight="' + o.weight + '"' : '') +
        (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') +
        ' fill="' + ctx.colors.text + '"' + (o.alpha != null && o.alpha < 1 ? ' fill-opacity="' + n(o.alpha) + '"' : '') +
        '>' + xml(str) + '</text>');
      written += texts[before].length;
    }

    function finish() {
      var out = '';
      if (defs.length) out += '<defs>' + defs.join('') + '</defs>';
      out += under.join('');
      keys.sort(function (a, b) {
        var sa = strokes[a];
        var sb = strokes[b];
        return STYLE_ORDER.indexOf(sa.name) - STYLE_ORDER.indexOf(sb.name) || sa.alpha - sb.alpha;
      });
      for (var i = 0; i < keys.length; i++) {
        var s = strokes[keys[i]];
        var st = s.style;
        out += '<path class="' + st.cls + '" fill="none" stroke="' + ctx.colors[st.role] + '" stroke-width="' + n(widthOf(st)) + '"' +
          (s.alpha < 1 ? ' stroke-opacity="' + n(s.alpha) + '"' : '') +
          (st.round ? ' stroke-linecap="round" stroke-linejoin="round"' : '') +
          ' d="' + s.parts.join('') + '"/>';
      }
      return out + fills.join('') + texts.join('');
    }

    /* Characters of drawing so far: what a page layout would cost. */
    function cost() { return written; }

    return { stroke: stroke, fill: fill, text: text, defs: defs, under: under, finish: finish, widthOf: widthOf, cost: cost };
  }

  /* ================================================================ density */

  function fade(stepPx) { return clamp((stepPx - FADE_LO) / (FADE_HI - FADE_LO), 0, 1); }

  /* The levels of a family of evenly spaced lines, finest first, each with
   * how strongly it shows at this zoom. levels: [{every, style}] with
   * 'every' integer multiples of the unit, each dividing the next. The
   * coarsest is doubled until it shows fully, so the paper never vanishes;
   * no level that would put more than MAX_LINES lines over span shows.
   * strict: no doubling, lines that crowd simply fade away (the rules
   * inside a planner box or a Cornell cell, which mean nothing thinned). */
  function plan(ctx, unit, levels, span, strict) {
    var out = levels.map(function (l) { return { every: l.every, style: l.style, keep: l.keep }; });
    var last = out[out.length - 1];
    var guard = 0;
    while (!strict && (unit * last.every * ctx.density < STRIDE_MIN || span / (unit * last.every) > MAX_LINES) && guard++ < 60) {
      last = { every: last.every * 2, style: last.style };
      out.push(last);
    }
    for (var i = 0; i < out.length; i++) {
      var l = out[i];
      var step = unit * l.every;
      l.alpha = span / step > MAX_LINES ? 0 : fade(step * ctx.density);
    }
    if (!strict) out[out.length - 1].alpha = Math.max(out[out.length - 1].alpha, fade(STRIDE_MIN));
    var finest = out.length - 1;
    for (var j = 0; j < out.length; j++) {
      if (out[j].alpha > 0.02) { finest = j; break; }
    }
    return { levels: out, finest: finest, unit: unit };
  }

  /* Calls fn(position, level) for every visible line of a plan inside
   * [lo, hi], each line at the coarsest level it belongs to. */
  function each(p, origin, lo, hi, fn) {
    var lv = p.levels;
    var f = lv[p.finest];
    if (f.alpha <= 0.02) return;
    var step = p.unit * f.every;
    var k0 = Math.ceil((lo - origin) / step - 1e-9);
    var k1 = Math.floor((hi - origin) / step + 1e-9);
    if (k1 - k0 > MAX_LINES * 2) return;
    for (var k = k0; k <= k1; k++) {
      var idx = k * f.every;
      var level = f;
      for (var i = lv.length - 1; i > p.finest; i--) {
        if (idx % lv[i].every === 0) { level = lv[i]; break; }
      }
      fn(origin + k * step, level, idx);
    }
  }

  /* Horizontal (axis 'y') or vertical (axis 'x') lines at origin + k*unit
   * within [lo, hi], drawn from a to b across. */
  function ladder(P, ctx, axis, origin, unit, levels, lo, hi, a, b, strict) {
    if (!(hi >= lo) || !(b > a)) return;
    var p = plan(ctx, unit, levels, hi - lo, strict);
    var A = n(a);
    var B = n(b);
    each(p, origin, lo, hi, function (pos, level) {
      var v = n(pos);
      P.stroke(level.style, axis === 'y' ? 'M' + A + ' ' + v + 'H' + B : 'M' + v + ' ' + A + 'V' + B, level.alpha);
    });
  }

  /* Lines n.p = origin + k*unit (n a unit normal) clipped to a rectangle:
   * the isometric and slanted families. strict and gain (a factor on the
   * strength) for guides that should simply fade away when far out. */
  function family(P, ctx, nx, ny, origin, unit, levels, r, strict, gain) {
    var cs = [r.x * nx + r.y * ny, (r.x + r.w) * nx + r.y * ny, r.x * nx + (r.y + r.h) * ny, (r.x + r.w) * nx + (r.y + r.h) * ny];
    var lo = Math.min.apply(null, cs);
    var hi = Math.max.apply(null, cs);
    var p = plan(ctx, unit, levels, hi - lo, strict);
    var dx = -ny;
    var dy = nx;
    var g = gain == null ? 1 : gain;
    each(p, origin, lo, hi, function (s, level) {
      var seg = clipLine(nx * s, ny * s, dx, dy, r, -Infinity);
      if (seg) P.stroke(level.style, 'M' + n(seg[0]) + ' ' + n(seg[1]) + 'L' + n(seg[2]) + ' ' + n(seg[3]), level.alpha * g);
    });
  }

  /* The part of the line p + t*d (t >= tmin) inside the rectangle, or null. */
  function clipLine(px, py, dx, dy, r, tmin) {
    var t0 = tmin;
    var t1 = Infinity;
    var axes = [[px, dx, r.x, r.x + r.w], [py, dy, r.y, r.y + r.h]];
    for (var i = 0; i < 2; i++) {
      var p = axes[i][0];
      var d = axes[i][1];
      var lo = axes[i][2];
      var hi = axes[i][3];
      if (Math.abs(d) < 1e-12) {
        if (p < lo || p > hi) return null;
        continue;
      }
      var a = (lo - p) / d;
      var b = (hi - p) / d;
      if (a > b) { var tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return null;
    }
    if (!isFinite(t0) || !isFinite(t1) || t1 - t0 < 1e-6) return null;
    return [px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1];
  }

  /* Rows of lines repeating every period from origin (staves, school
   * rulings, calligraphy): lines [{dy, style, keep}] inside a row. Lines
   * crowding their neighbours fade; 'keep' lines stay as long as the rows
   * do, so a zoomed-out staff reads as its outline. Rows thin out by powers
   * of two when they crowd. onRow(top, k) adds what goes with a row. */
  function rows(P, ctx, origin, period, lines, lo, hi, a, b, onRow, whole) {
    if (!(hi >= lo) || !(b > a)) return;
    var stride = 1;
    while ((period * stride * ctx.density < STRIDE_MIN * 2 || (hi - lo) / (period * stride) * lines.length > MAX_LINES) && stride < 1 << 20) stride *= 2;
    var rowAlpha = Math.max(fade(period * stride * ctx.density / 2), fade(STRIDE_MIN));
    var sorted = lines.slice().sort(function (x, y) { return x.dy - y.dy; });
    var alphas = sorted.map(function (l, i) {
      if (stride > 1) return l.keep ? rowAlpha : 0;
      var prev = i > 0 ? l.dy - sorted[i - 1].dy : sorted[0].dy + period - sorted[sorted.length - 1].dy;
      var next = i < sorted.length - 1 ? sorted[i + 1].dy - l.dy : period - l.dy + sorted[0].dy;
      var gap = Math.min(prev, next);
      var own = fade(gap * ctx.density);
      return l.keep ? Math.max(own, rowAlpha) : own;
    });
    var step = period * stride;
    var minDy = sorted[0].dy;
    var maxDy = sorted[sorted.length - 1].dy;
    var k0 = Math.ceil((lo - origin - maxDy) / step - 1e-9);
    var k1 = Math.floor((hi - origin - minDy) / step + 1e-9);
    var A = n(a);
    var B = n(b);
    for (var k = k0; k <= k1; k++) {
      var top = origin + k * step;
      if (whole && (top + minDy < lo - 1e-6 || top + maxDy > hi + 1e-6)) continue;
      for (var i = 0; i < sorted.length; i++) {
        var y = top + sorted[i].dy;
        if (y < lo - 1e-6 || y > hi + 1e-6) continue;
        P.stroke(sorted[i].style, 'M' + A + ' ' + n(y) + 'H' + B, alphas[i]);
      }
      if (onRow) onRow(top, k, rowAlpha);
    }
  }

  /* ================================================================ shapes */

  function rectD(x, y, w, h) {
    return 'M' + n(x) + ' ' + n(y) + 'H' + n(x + w) + 'V' + n(y + h) + 'H' + n(x) + 'Z';
  }

  function roundRectD(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (r < 0.01) return rectD(x, y, w, h);
    var R = n(r);
    return 'M' + n(x + r) + ' ' + n(y) + 'H' + n(x + w - r) +
      'A' + R + ' ' + R + ' 0 0 1 ' + n(x + w) + ' ' + n(y + r) + 'V' + n(y + h - r) +
      'A' + R + ' ' + R + ' 0 0 1 ' + n(x + w - r) + ' ' + n(y + h) + 'H' + n(x + r) +
      'A' + R + ' ' + R + ' 0 0 1 ' + n(x) + ' ' + n(y + h - r) + 'V' + n(y + r) +
      'A' + R + ' ' + R + ' 0 0 1 ' + n(x + r) + ' ' + n(y) + 'Z';
  }

  function circleD(cx, cy, r) {
    var R = n(r);
    return 'M' + n(cx - r) + ' ' + n(cy) + 'A' + R + ' ' + R + ' 0 1 0 ' + n(cx + r) + ' ' + n(cy) +
      'A' + R + ' ' + R + ' 0 1 0 ' + n(cx - r) + ' ' + n(cy) + 'Z';
  }

  function segD(x1, y1, x2, y2) { return 'M' + n(x1) + ' ' + n(y1) + 'L' + n(x2) + ' ' + n(y2); }

  function inside(r, x, y, pad) {
    pad = pad || 0;
    return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
  }

  function overlaps(r, x, y, w, h) {
    return x <= r.x + r.w && x + w >= r.x && y <= r.y + r.h && y + h >= r.y;
  }

  /* A curly brace from (x, y0) to (x, y1), its point to the left. Drawn as
   * a filled shape (thick in the middle of each half, thin at the tips) in a
   * 1 x 10 box, the way engravers draw the piano brace. */
  function braceD(x, y0, y1, width) {
    var h = (y1 - y0) / 10;
    function p(px, py) { return n(x - px * width) + ' ' + n(y0 + py * h); }
    return 'M' + p(0, 0) +
      'C' + p(0.95, 0.35) + ' ' + p(-0.05, 4.1) + ' ' + p(1, 5) +
      'C' + p(-0.05, 5.9) + ' ' + p(0.95, 9.65) + ' ' + p(0, 10) +
      'C' + p(0.55, 9.4) + ' ' + p(-0.55, 5.8) + ' ' + p(1, 5) +
      'C' + p(-0.55, 4.2) + ' ' + p(0.55, 0.6) + ' ' + p(0, 0) + 'Z';
  }

  /* ================================================================ papers */

  /* Each drawer gets the painter, the context (region r to cover, page box
   * pg in page mode, mode, density) and the paper's parameters in mm. */

  /* Where a periodic pattern starts on a page: centred, so the cut cells at
   * the two edges are equal; for dots never closer to the edge than 40% of
   * a step, so no dot sits on the edge. */
  function centred(len, step, dots) {
    var rest = len % step;
    if (step - rest < 1e-6 * step) rest = 0;
    var o = rest / 2;
    if (dots && o < step * 0.4) o += step / 2;
    return o;
  }

  function anchors(ctx, step, dots) {
    if (ctx.mode === 'infinite') return { x: 0, y: 0 };
    return { x: ctx.pg.x + centred(ctx.pg.w, step, dots), y: ctx.pg.y + centred(ctx.pg.h, step, dots) };
  }

  function drawDots(P, ctx, p) {
    var step = p.step * MM;
    var o = anchors(ctx, step, true);
    var pl = plan(ctx, step, [{ every: 1, style: 'strong' }], Math.max(ctx.r.w, ctx.r.h));
    var lv = pl.levels[pl.finest];
    var s = step * lv.every;
    /* A dot is about 0.6 mm across on paper, and on screen never smaller
     * than 1 px of radius (it would vanish) nor larger than 2 px. */
    var radius = clamp(1.15 * ctx.scale, 1, 2) / ctx.scale;
    var id = ctx.id + '-dots';
    P.defs.push('<pattern id="' + id + '" patternUnits="userSpaceOnUse" x="' + n(o.x - s / 2) + '" y="' + n(o.y - s / 2) +
      '" width="' + n(s) + '" height="' + n(s) + '"><circle class="mr-strong" cx="' + n(s / 2) + '" cy="' + n(s / 2) + '" r="' + n(radius) +
      '" fill="' + ctx.colors.strongLine + '"' + (lv.alpha < 1 ? ' fill-opacity="' + n(lv.alpha) + '"' : '') + '/></pattern>');
    P.under.push('<rect x="' + n(ctx.r.x) + '" y="' + n(ctx.r.y) + '" width="' + n(ctx.r.w) + '" height="' + n(ctx.r.h) + '" fill="url(#' + id + ')"/>');
  }

  function grid(P, ctx, unit, levels, o, box) {
    box = box || ctx.r;
    ladder(P, ctx, 'x', o.x, unit, levels, box.x, box.x + box.w, box.y, box.y + box.h);
    ladder(P, ctx, 'y', o.y, unit, levels, box.y, box.y + box.h, box.x, box.x + box.w);
  }

  function drawGrid(P, ctx, p) {
    var step = p.step * MM;
    grid(P, ctx, step, [{ every: 1, style: 'line' }], anchors(ctx, step));
  }

  function drawGrid8(P, ctx, p) {
    var step = p.stepPx;
    var o = ctx.mode === 'infinite' ? { x: 0, y: 0 } : { x: ctx.pg.x, y: ctx.pg.y };
    grid(P, ctx, step, [{ every: 1, style: 'fine' }, { every: p.every, style: 'line' }], o);
  }

  /* Horizontal rules: on a page from a top margin (room for a title) to a
   * bottom one, on the canvas everywhere. */
  function ruledSpan(ctx, p) {
    if (ctx.mode === 'infinite') return { origin: 0, lo: ctx.r.y, hi: ctx.r.y + ctx.r.h };
    var top = ctx.pg.y + p.top * MM;
    return { origin: top, lo: top, hi: ctx.pg.y + ctx.pg.h - p.bottom * MM };
  }

  function drawRuled(P, ctx, p) {
    var s = ruledSpan(ctx, p);
    ladder(P, ctx, 'y', s.origin, p.step * MM, [{ every: 1, style: 'line' }], s.lo, s.hi, ctx.r.x, ctx.r.x + ctx.r.w);
    if (p.margin) {
      var x = (ctx.mode === 'infinite' ? 0 : ctx.pg.x) + p.margin * MM;
      if (x >= ctx.r.x && x <= ctx.r.x + ctx.r.w) P.stroke('margin', 'M' + n(x) + ' ' + n(ctx.r.y) + 'V' + n(ctx.r.y + ctx.r.h));
    }
  }

  /* First-grade lines (the Italian school ruling A): a band between two lines for the large
   * letters of the first year (the baseline stronger), rows separated by
   * an empty space. */
  function drawSchool1(P, ctx, p) {
    var s = ruledSpan(ctx, p);
    var band = p.band * MM;
    var period = (p.band + p.gap) * MM;
    rows(P, ctx, s.origin, period, [{ dy: 0, style: 'line', keep: true }, { dy: band, style: 'strong', keep: true }],
      s.lo, s.hi, ctx.r.x, ctx.r.x + ctx.r.w, null, ctx.mode !== 'infinite');
  }

  /* Second-grade lines (the Italian school ruling B): two close lines hold the body of the
   * small letters, a lighter line above them limits the ascenders, and the
   * space under the baseline takes the descenders. */
  function drawSchool2(P, ctx, p) {
    var s = ruledSpan(ctx, p);
    var asc = p.ascender * MM;
    var body = p.body * MM;
    var period = (p.ascender + p.body + p.descender) * MM;
    rows(P, ctx, s.origin, period, [
      { dy: 0, style: 'line' },
      { dy: asc, style: 'strong', keep: true },
      { dy: asc + body, style: 'strong', keep: true }
    ], s.lo, s.hi, ctx.r.x, ctx.r.x + ctx.r.w, null, ctx.mode !== 'infinite');
  }

  /* The plotting area of a scientific paper on a page: inside the margins,
   * whole multiples of the unit, centred. */
  function plotArea(ctx, marginMm, unit, extraLeft) {
    var m = marginMm * MM;
    var left = m + (extraLeft || 0);
    var w = Math.floor((ctx.pg.w - left - m) / unit + 1e-3) * unit;
    var h = Math.floor((ctx.pg.h - 2 * m) / unit + 1e-3) * unit;
    var x = ctx.pg.x + left + (ctx.pg.w - left - m - w) / 2;
    var y = ctx.pg.y + m + (ctx.pg.h - 2 * m - h) / 2;
    return { x: x, y: y, w: Math.max(0, w), h: Math.max(0, h) };
  }

  function clipBox(r, box) {
    var x0 = Math.max(r.x, box.x);
    var y0 = Math.max(r.y, box.y);
    var x1 = Math.min(r.x + r.w, box.x + box.w);
    var y1 = Math.min(r.y + r.h, box.y + box.h);
    return x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /* Millimetre graph paper: 1 mm, 5 mm and 1 cm lines. */
  function drawMillimetre(P, ctx, p) {
    var levels = [{ every: 1, style: 'fine' }, { every: 5, style: 'line' }, { every: 10, style: 'strong' }];
    if (ctx.mode === 'infinite') { grid(P, ctx, MM, levels, { x: 0, y: 0 }); return; }
    var area = plotArea(ctx, p.margin, 10 * MM);
    grid(P, ctx, MM, levels, { x: area.x, y: area.y }, area);
  }

  /* Positions of the lines inside one decade of a log scale, as fractions
   * of the decade: the integers 2..9 and the usual subdivisions (tenths up
   * to 2, fifths up to 5, halves up to 10). */
  var LOG_MAIN = [2, 3, 4, 5, 6, 7, 8, 9].map(function (v) { return { f: Math.log10(v), v: v }; });
  var LOG_FINE = (function () {
    var out = [];
    var v;
    for (v = 1.1; v < 1.95; v += 0.1) out.push(Math.log10(v));
    for (v = 2.2; v < 4.95; v += 0.2) if (Math.abs(v - Math.round(v)) > 0.01) out.push(Math.log10(v));
    for (v = 5.5; v < 10; v += 1) out.push(Math.log10(v));
    return out;
  })();

  /* One log axis: decades of length D from origin. dir +1 means values grow
   * with the coordinate (x), -1 against it (y, values grow upwards).
   * line(pos, style, alpha) draws one line. */
  function logAxis(ctx, origin, D, dir, lo, hi, line) {
    var decadeAlpha = 1;
    var stride = 1;
    while (D * stride * ctx.density < STRIDE_MIN * 2 && stride < 1 << 20) stride *= 2;
    var mainAlpha = stride > 1 ? 0 : fade(D * Math.log10(10 / 9) * ctx.density);
    var fineAlpha = stride > 1 ? 0 : fade(D * Math.log10(10 / 9.5) * ctx.density);
    var k0 = Math.floor(Math.min((lo - origin) * dir, (hi - origin) * dir) / D) - 1;
    var k1 = Math.ceil(Math.max((lo - origin) * dir, (hi - origin) * dir) / D) + 1;
    if (k1 - k0 > MAX_LINES) return;
    for (var k = k0; k <= k1; k++) {
      var base = origin + dir * k * D;
      if (k % stride === 0 && base >= lo - 1e-6 && base <= hi + 1e-6) line(base, 'strong', decadeAlpha, k);
      if (mainAlpha > 0.02) {
        for (var i = 0; i < LOG_MAIN.length; i++) {
          var pm = base + dir * D * LOG_MAIN[i].f;
          if (pm >= lo && pm <= hi) line(pm, 'line', mainAlpha);
        }
      }
      if (fineAlpha > 0.02) {
        for (var j = 0; j < LOG_FINE.length; j++) {
          var pf = base + dir * D * LOG_FINE[j];
          if (pf >= lo && pf <= hi) line(pf, 'fine', fineAlpha);
        }
      }
    }
  }

  /* The digits 1..9 (and the next decade's 1) along a log axis on a page. */
  function logLabels(P, ctx, axis, origin, D, dir, count, at) {
    var size = 2.3 * MM;
    for (var k = 0; k < count; k++) {
      for (var v = 1; v <= 10; v++) {
        if (v === 10 && k < count - 1) continue;
        var pos = origin + dir * (k * D + D * Math.log10(v));
        var str = String(v === 10 ? 1 : v);
        if (axis === 'y') P.text(at, pos + size * 0.35, str, { size: size, anchor: 'end' });
        else P.text(pos, at, str, { size: size, anchor: 'middle' });
      }
    }
  }

  function drawSemilog(P, ctx, p) {
    var unit = p.step * MM;
    var levels = [{ every: 1, style: 'fine' }, { every: 5, style: 'line' }];
    var D = p.decade * MM;
    if (ctx.mode === 'infinite') {
      ladder(P, ctx, 'x', 0, unit, levels, ctx.r.x, ctx.r.x + ctx.r.w, ctx.r.y, ctx.r.y + ctx.r.h);
      logAxis(ctx, 0, D, -1, ctx.r.y, ctx.r.y + ctx.r.h, function (y, style, alpha) {
        P.stroke(style, 'M' + n(ctx.r.x) + ' ' + n(y) + 'H' + n(ctx.r.x + ctx.r.w), alpha);
      });
      return;
    }
    var area = plotArea(ctx, p.margin, 10 * MM, p.label * MM);
    var full = Math.max(1, (ctx.pg.h - 2 * p.margin * MM));
    var count = Math.max(1, Math.round(full / D));
    var Dy = full / count;
    area.y = ctx.pg.y + p.margin * MM;
    area.h = full;
    ladder(P, ctx, 'x', area.x, unit, levels, area.x, area.x + area.w, area.y, area.y + area.h);
    P.stroke('strong', 'M' + n(area.x) + ' ' + n(area.y) + 'V' + n(area.y + area.h) + 'M' + n(area.x + area.w) + ' ' + n(area.y) + 'V' + n(area.y + area.h));
    var bottom = area.y + area.h;
    logAxis(ctx, bottom, Dy, -1, area.y, bottom, function (y, style, alpha) {
      P.stroke(style, 'M' + n(area.x) + ' ' + n(y) + 'H' + n(area.x + area.w), alpha);
    });
    logLabels(P, ctx, 'y', bottom, Dy, -1, count, area.x - 1.2 * MM);
  }

  function drawLogLog(P, ctx, p) {
    var D = p.decade * MM;
    if (ctx.mode === 'infinite') {
      logAxis(ctx, 0, D, 1, ctx.r.x, ctx.r.x + ctx.r.w, function (x, style, alpha) {
        P.stroke(style, 'M' + n(x) + ' ' + n(ctx.r.y) + 'V' + n(ctx.r.y + ctx.r.h), alpha);
      });
      logAxis(ctx, 0, D, -1, ctx.r.y, ctx.r.y + ctx.r.h, function (y, style, alpha) {
        P.stroke(style, 'M' + n(ctx.r.x) + ' ' + n(y) + 'H' + n(ctx.r.x + ctx.r.w), alpha);
      });
      return;
    }
    var m = p.margin * MM;
    var left = m + p.label * MM;
    var area = { x: ctx.pg.x + left, y: ctx.pg.y + m, w: ctx.pg.w - left - m, h: ctx.pg.h - 2 * m - p.label * MM };
    var nx = Math.max(1, Math.round(area.w / D));
    var ny = Math.max(1, Math.round(area.h / D));
    var Dx = area.w / nx;
    var Dy = area.h / ny;
    var bottom = area.y + area.h;
    logAxis(ctx, area.x, Dx, 1, area.x, area.x + area.w, function (x, style, alpha) {
      P.stroke(style, 'M' + n(x) + ' ' + n(area.y) + 'V' + n(bottom), alpha);
    });
    logAxis(ctx, bottom, Dy, -1, area.y, bottom, function (y, style, alpha) {
      P.stroke(style, 'M' + n(area.x) + ' ' + n(y) + 'H' + n(area.x + area.w), alpha);
    });
    logLabels(P, ctx, 'y', bottom, Dy, -1, ny, area.x - 1.2 * MM);
    logLabels(P, ctx, 'x', area.x, Dx, 1, nx, bottom + 4 * MM);
  }

  /* Polar: rings every 5 mm (a stronger one every 25 mm) and rays every 15
   * degrees, the axes stronger. On a page the centre is the page's centre
   * and the degrees are written round the outer ring; on the canvas the
   * centre is the origin and rings go on as far as the view does. */
  function drawPolar(P, ctx, p) {
    var r = ctx.r;
    var ring = p.ring * MM;
    var cx;
    var cy;
    var maxR;
    if (ctx.mode === 'infinite') {
      cx = 0; cy = 0; maxR = Infinity;
    } else {
      cx = ctx.pg.x + ctx.pg.w / 2;
      cy = ctx.pg.y + ctx.pg.h / 2;
      maxR = Math.floor((Math.min(ctx.pg.w, ctx.pg.h) / 2 - p.margin * MM) / (2 * ring)) * 2 * ring;
      if (maxR <= 0) maxR = Math.floor((Math.min(ctx.pg.w, ctx.pg.h) / 2 - p.margin * MM) / ring) * ring;
      if (maxR <= 0) return;
    }
    var nearX = clamp(cx, r.x, r.x + r.w) - cx;
    var nearY = clamp(cy, r.y, r.y + r.h) - cy;
    var dmin = Math.sqrt(nearX * nearX + nearY * nearY);
    var farX = Math.max(Math.abs(r.x - cx), Math.abs(r.x + r.w - cx));
    var farY = Math.max(Math.abs(r.y - cy), Math.abs(r.y + r.h - cy));
    var dmax = Math.min(maxR, Math.sqrt(farX * farX + farY * farY));
    if (dmax < dmin) return;
    var pl = plan(ctx, ring, [{ every: 1, style: 'line' }, { every: 5, style: 'strong' }], dmax - dmin);
    each(pl, 0, Math.max(dmin, ring), dmax, function (radius, level) {
      P.stroke(level.style, circleD(cx, cy, radius), level.alpha);
    });
    /* Rays start where they are far enough apart to be told apart. */
    var step = p.ray;
    var sin = Math.sin(step * Math.PI / 180);
    var start = Math.max(ring, (FADE_HI / ctx.density) / Math.max(sin, 1e-6));
    /* The multiples of the step, and the four axes even when the step
     * (an override) does not divide 90. */
    var angles = [];
    for (var k = 0; k * step < 360 - 1e-9; k++) angles.push(k * step);
    [90, 180, 270].forEach(function (ax) {
      if (angles.every(function (v) { return Math.abs(v - ax) > 1e-6; })) angles.push(ax);
    });
    for (var ai = 0; ai < angles.length; ai++) {
      var deg = angles[ai];
      var a = deg * Math.PI / 180;
      var dx = Math.cos(a);
      var dy = -Math.sin(a);
      var axis = Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-9;
      var t0 = axis ? 0 : Math.min(start, maxR);
      var seg = clipLine(cx, cy, dx, dy, r, t0);
      if (!seg) continue;
      var t1 = (seg[2] - cx) * dx + (seg[3] - cy) * dy;
      if (t1 > maxR) { seg[2] = cx + dx * maxR; seg[3] = cy + dy * maxR; }
      var tStart = (seg[0] - cx) * dx + (seg[1] - cy) * dy;
      if (tStart >= Math.min(t1, maxR)) continue;
      P.stroke(axis ? 'strong' : 'line', segD(seg[0], seg[1], seg[2], seg[3]));
    }
    if (ctx.mode !== 'infinite') {
      var size = 2.4 * MM;
      for (var d = 0; d < 360; d += 30) {
        var b = d * Math.PI / 180;
        var lr = maxR + 4 * MM;
        P.text(cx + Math.cos(b) * lr, cy - Math.sin(b) * lr + size * 0.35, d + '°', { size: size, anchor: 'middle' });
      }
    }
  }

  /* Isometric: equilateral triangles of the given side, made by vertical
   * lines and lines at 30 degrees either way (the three axes of an
   * isometric drawing). All three families are d = side * sqrt(3)/2 apart
   * and meet at the same points. */
  function drawIsometric(P, ctx, p) {
    var side = p.side * MM;
    var d = side * Math.sqrt(3) / 2;
    var cx = ctx.mode === 'infinite' ? 0 : ctx.pg.x + ctx.pg.w / 2;
    var cy = ctx.mode === 'infinite' ? 0 : ctx.pg.y + ctx.pg.h / 2;
    var lv = [{ every: 1, style: 'line' }];
    var fams = [[1, 0], [-0.5, Math.sqrt(3) / 2], [0.5, Math.sqrt(3) / 2]];
    for (var i = 0; i < fams.length; i++) {
      var nx = fams[i][0];
      var ny = fams[i][1];
      family(P, ctx, nx, ny, nx * cx + ny * cy, d, lv, ctx.r);
    }
  }

  /* Honeycomb: flat-topped hexagons of the given side, as a pattern tile
   * (3 sides wide, sqrt(3) sides tall). The tile is shifted a quarter of
   * its height so no edge runs along a tile border, where it would be cut
   * in half. Like the coarsest family of plan(), the side doubles while the
   * cells would be under STRIDE_MIN on screen, so a zoomed-out canvas or a
   * small thumbnail still shows a honeycomb, just a coarser one. */
  function drawHoneycomb(P, ctx, p) {
    var s = p.side * MM;
    var guard = 0;
    while (s * ctx.density < STRIDE_MIN && guard++ < 60) s *= 2;
    var alpha = Math.max(fade(s * ctx.density), fade(STRIDE_MIN));
    var hh = s * Math.sqrt(3);
    var tw = 3 * s;
    var cx = ctx.mode === 'infinite' ? 0 : ctx.pg.x + ctx.pg.w / 2;
    var cy = ctx.mode === 'infinite' ? 0 : ctx.pg.y + ctx.pg.h / 2;
    var shift = hh / 4;
    var parts = [];
    /* Every cell near the tile draws its top, upper-right and lower-right
     * edges; the other three belong to its neighbours. */
    for (var i = -1; i <= 2; i++) {
      for (var j = -1; j <= 2; j++) {
        var x = i * 1.5 * s;
        var y = j * hh + ((i % 2 + 2) % 2 ? hh / 2 : 0) + shift;
        parts.push('M' + n(x - s / 2) + ' ' + n(y - hh / 2) + 'H' + n(x + s / 2) + 'L' + n(x + s) + ' ' + n(y) + 'L' + n(x + s / 2) + ' ' + n(y + hh / 2));
      }
    }
    var id = ctx.id + '-hex';
    var width = P.widthOf(STYLES.line);
    P.defs.push('<pattern id="' + id + '" patternUnits="userSpaceOnUse" x="' + n(cx) + '" y="' + n(cy - shift) + '" width="' + n(tw) + '" height="' + n(hh) +
      '"><path class="mr-line" fill="none" stroke="' + ctx.colors.line + '" stroke-width="' + n(width) + '"' +
      (alpha < 1 ? ' stroke-opacity="' + n(alpha) + '"' : '') + ' stroke-linejoin="round" d="' + parts.join('') + '"/></pattern>');
    P.under.push('<rect x="' + n(ctx.r.x) + '" y="' + n(ctx.r.y) + '" width="' + n(ctx.r.w) + '" height="' + n(ctx.r.h) + '" fill="url(#' + id + ')"/>');
  }

  /* Cartesian plane: a 5 mm grid, the two axes with arrows on a page, a
   * tick and a number every centimetre. */
  function drawCartesian(P, ctx, p) {
    var u = p.step * MM;
    var tick = p.tick * MM;
    var r = ctx.r;
    var cx;
    var cy;
    var box;
    if (ctx.mode === 'infinite') {
      cx = 0; cy = 0; box = r;
    } else {
      var m = p.margin * MM;
      cx = ctx.pg.x + ctx.pg.w / 2;
      cy = ctx.pg.y + ctx.pg.h / 2;
      var ax = Math.floor((ctx.pg.w / 2 - m) / u) * u;
      var ay = Math.floor((ctx.pg.h / 2 - m) / u) * u;
      box = { x: cx - ax, y: cy - ay, w: 2 * ax, h: 2 * ay };
    }
    grid(P, ctx, u, [{ every: 1, style: 'line' }], { x: cx, y: cy }, clipBox(r, box) || { x: 0, y: 0, w: 0, h: 0 });
    var x0 = Math.max(box.x, r.x);
    var x1 = Math.min(box.x + box.w, r.x + r.w);
    var y0 = Math.max(box.y, r.y);
    var y1 = Math.min(box.y + box.h, r.y + r.h);
    var arrow = ctx.mode !== 'infinite';
    var head = 2.2 * MM;
    var tl = 1 * MM;
    var size = 2.4 * MM;
    var labelEvery = 1;
    while (tick * labelEvery * ctx.density < LABEL_GAP && labelEvery < 1 << 20) labelEvery *= 2;
    var tickPlan = plan(ctx, tick, [{ every: 1, style: 'bold' }], Math.max(r.w, r.h));
    if (cy >= r.y - head && cy <= r.y + r.h + head && x1 > x0) {
      P.stroke('bold', 'M' + n(x0) + ' ' + n(cy) + 'H' + n(x1));
      if (arrow) P.fill('bold', 'M' + n(box.x + box.w + head * 0.4) + ' ' + n(cy) + 'L' + n(box.x + box.w - head) + ' ' + n(cy - head * 0.45) + 'L' + n(box.x + box.w - head) + ' ' + n(cy + head * 0.45) + 'Z');
      each(tickPlan, cx, x0, x1 - (arrow ? head : 0), function (x, level, idx) {
        if (Math.abs(x - cx) < 1e-6) return;
        P.stroke('bold', 'M' + n(x) + ' ' + n(cy - tl) + 'V' + n(cy + tl), level.alpha);
        if (idx % labelEvery === 0) P.text(x, cy + tl + size * 1.05, String(Math.round((x - cx) / tick)), { size: size, anchor: 'middle' });
      });
      if (arrow) P.text(box.x + box.w - 0.5 * MM, cy - 2.4 * MM, 'x', { size: size * 1.25, anchor: 'end' });
    }
    if (cx >= r.x - head && cx <= r.x + r.w + head && y1 > y0) {
      P.stroke('bold', 'M' + n(cx) + ' ' + n(y0) + 'V' + n(y1));
      if (arrow) P.fill('bold', 'M' + n(cx) + ' ' + n(box.y - head * 0.4) + 'L' + n(cx - head * 0.45) + ' ' + n(box.y + head) + 'L' + n(cx + head * 0.45) + ' ' + n(box.y + head) + 'Z');
      each(tickPlan, cy, y0 + (arrow ? head : 0), y1, function (y, level, idx) {
        if (Math.abs(y - cy) < 1e-6) return;
        P.stroke('bold', 'M' + n(cx - tl) + ' ' + n(y) + 'H' + n(cx + tl), level.alpha);
        if (idx % labelEvery === 0) P.text(cx - tl - 0.8 * MM, y + size * 0.35, String(Math.round((cy - y) / tick)), { size: size, anchor: 'end' });
      });
      if (arrow) P.text(cx + 2.2 * MM, box.y + 1.6 * MM, 'y', { size: size * 1.25 });
    }
    if (inside(r, cx, cy)) P.text(cx - tl - 0.8 * MM, cy + tl + size * 1.05, 'O', { size: size, anchor: 'end' });
  }

  /* Rows of music: on a page spread between margins and centred, on the
   * canvas endless. extra(top, k, alpha, a) draws what starts a row. */
  function music(P, ctx, p, lines, height, period, extra, leftMm) {
    if (ctx.mode === 'infinite') {
      rows(P, ctx, 0, period, lines, ctx.r.y, ctx.r.y + ctx.r.h, ctx.r.x, ctx.r.x + ctx.r.w);
      return;
    }
    var top = ctx.pg.y + p.top * MM;
    var avail = ctx.pg.h - (p.top + p.bottom) * MM;
    var count = Math.max(1, Math.floor((avail - height) / period + 1e-3) + 1);
    var block = (count - 1) * period + height;
    var start = top + Math.max(0, (avail - block) / 2);
    var a = ctx.pg.x + (leftMm != null ? leftMm : p.side) * MM;
    var b = ctx.pg.x + ctx.pg.w - p.side * MM;
    rows(P, ctx, start, period, lines, start - 1e-6, start + block + 1e-6, a, b, function (rowTop, k, alpha) {
      if (extra) extra(rowTop, k, alpha, a);
    });
  }

  function staffLines(dy0, space, count, keepEnds) {
    var out = [];
    for (var i = 0; i < count; i++) out.push({ dy: dy0 + i * space, style: 'strong', keep: keepEnds && (i === 0 || i === count - 1) });
    return out;
  }

  function drawStaff(P, ctx, p) {
    var sp = p.space * MM;
    music(P, ctx, p, staffLines(0, sp, 5, true), 4 * sp, p.period * MM);
  }

  /* The grand staff of piano music: treble and bass staves joined at the
   * left by a line and a brace. */
  function drawGrandStaff(P, ctx, p) {
    var sp = p.space * MM;
    var gap = p.between * MM;
    var lower = 4 * sp + gap;
    var lines = staffLines(0, sp, 5, true).concat(staffLines(lower, sp, 5, true));
    var height = lower + 4 * sp;
    music(P, ctx, p, lines, height, p.period * MM, function (top, k, alpha, a) {
      P.stroke('strong', 'M' + n(a) + ' ' + n(top) + 'V' + n(top + height), alpha);
      P.fill('bold', braceD(a - 1.3 * MM, top, top + height, Math.min(3 * MM, height * 0.09)), alpha);
    }, p.left);
  }

  function drawGuitarTab(P, ctx, p) {
    var sp = p.space * MM;
    var height = 5 * sp;
    music(P, ctx, p, staffLines(0, sp, 6, true), height, p.period * MM, function (top, k, alpha, a) {
      P.stroke('strong', 'M' + n(a) + ' ' + n(top) + 'V' + n(top + height), alpha);
      var size = sp * 1.15;
      var x = a + 2.6 * MM;
      ['T', 'A', 'B'].forEach(function (ch, i) {
        P.text(x, top + sp * (1.3 + i * 1.45) + size * 0.36, ch, { size: size, anchor: 'middle', weight: 600, alpha: alpha });
      });
    });
  }

  /* Calligraphy guides: ascender, waist (x-height), baseline and descender
   * lines in the 3:2:3 copperplate proportion, and slant lines at 55
   * degrees across each row. */
  function drawCalligraphy(P, ctx, p) {
    var asc = p.ascender * MM;
    var xh = p.xHeight * MM;
    var desc = p.descender * MM;
    var height = asc + xh + desc;
    var period = height + p.gap * MM;
    var lines = [
      { dy: 0, style: 'line', keep: true },
      { dy: asc, style: 'strong' },
      { dy: asc + xh, style: 'strong', keep: true },
      { dy: height, style: 'line' }
    ];
    var angle = p.slant * Math.PI / 180;
    var nx = Math.sin(angle);
    var ny = Math.cos(angle);
    var slantStep = p.slantStep * MM * Math.sin(angle);
    var a;
    var b;
    var top0;
    var lo;
    var hi;
    if (ctx.mode === 'infinite') {
      a = ctx.r.x; b = ctx.r.x + ctx.r.w; top0 = 0; lo = ctx.r.y; hi = ctx.r.y + ctx.r.h;
    } else {
      a = ctx.pg.x + p.side * MM;
      b = ctx.pg.x + ctx.pg.w - p.side * MM;
      var avail = ctx.pg.h - (p.top + p.bottom) * MM;
      var count = Math.max(1, Math.floor((avail - height) / period + 1e-3) + 1);
      var block = (count - 1) * period + height;
      top0 = ctx.pg.y + p.top * MM + Math.max(0, (avail - block) / 2);
      lo = top0 - 1e-6; hi = top0 + block + 1e-6;
    }
    var origin = ctx.mode === 'infinite' ? 0 : nx * a + ny * top0;
    /* Slants only help a row big enough to write in: they fade out as the
     * row shrinks under SLANT_ROW px on screen. */
    var gain = clamp((height * ctx.density - SLANT_ROW) / SLANT_RAMP, 0, 1);
    rows(P, ctx, top0, period, lines, lo, hi, a, b, function (top) {
      var band = clipBox(ctx.r, { x: a, y: top, w: b - a, h: height });
      if (band && gain > 0.02) family(P, ctx, nx, ny, origin, slantStep, [{ every: 1, style: 'fine' }], band, true, gain);
    });
  }

  /* ---------------------------------------------------------------- page layouts */

  /* A frame with rounded corners, square when the rounding would be under
   * a couple of pixels on screen (half the path for the same look). */
  function frameD(ctx, x, y, w, h, r) {
    return r * ctx.density < 1.5 ? rectD(x, y, w, h) : roundRectD(x, y, w, h, r);
  }

  /* Ruled lines between two heights of a page or cell. Not in a cell drawn
   * as frames only (ctx.coarse), where they would be the bulk of the cost
   * and too fine to write on anyway. */
  function ruledBetween(P, ctx, x0, x1, y0, y1, step, style) {
    if (ctx.coarse) return;
    var r = clipBox(ctx.r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    if (!r) return;
    ladder(P, ctx, 'y', y0, step, [{ every: 1, style: style || 'line' }], Math.max(r.y, y0 + step * 0.5), r.y + r.h, x0, x1, ctx.mode === 'infinite');
  }

  /* Cornell notes: a title band, the cue column on the left, the notes
   * ruled on the right, the summary across the bottom. Sizes shrink with
   * small pages so an A6 keeps the same proportions. */
  function layoutCornell(P, ctx, p, c) {
    var step = p.step * MM;
    var header = Math.min(p.header * MM, c.h * 0.1);
    var summary = Math.min(p.summary * MM, c.h * 0.2);
    var cue = Math.min(p.cue * MM, c.w * 0.32);
    var top = c.y + header;
    var bottom = c.y + c.h - summary;
    ruledBetween(P, ctx, c.x, c.x + c.w, top, bottom - step * 0.4, step);
    ruledBetween(P, ctx, c.x, c.x + c.w, bottom, c.y + c.h - step * 0.4, step);
    P.stroke('strong', 'M' + n(c.x) + ' ' + n(top) + 'H' + n(c.x + c.w) + 'M' + n(c.x) + ' ' + n(bottom) + 'H' + n(c.x + c.w) +
      'M' + n(c.x + cue) + ' ' + n(top) + 'V' + n(bottom));
  }

  /* Two columns for vocabulary: a title band, rules, a line down the middle. */
  function layoutTwoColumns(P, ctx, p, c) {
    var step = p.step * MM;
    var header = Math.min(p.header * MM, c.h * 0.1);
    var top = c.y + header;
    ruledBetween(P, ctx, c.x, c.x + c.w, top, c.y + c.h - step * 0.4, step);
    P.stroke('strong', 'M' + n(c.x) + ' ' + n(top) + 'H' + n(c.x + c.w) + 'M' + n(c.x + c.w / 2) + ' ' + n(top) + 'V' + n(c.y + c.h));
  }

  /* Phone wireframes: frames in the proportion of a current phone screen
   * (390 x 844), as large as the page allows while fitting at least three
   * when it can, each with the island, the home bar and a line for a name. */
  function layoutPhone(P, ctx, p, c) {
    var m = p.margin * MM;
    var gap = p.gap * MM;
    var lab = p.label * MM;
    var aw = c.w - 2 * m;
    var ah = c.h - 2 * m;
    var ratio = 390 / 844;
    var best = null;
    for (var rws = 1; rws <= 4; rws++) {
      var fh = Math.min(150 * MM, (ah - (rws - 1) * gap - rws * lab) / rws);
      var fw = fh * ratio;
      if (fw > aw) { fw = aw; fh = fw / ratio; }
      if (fh < 40 * MM && best) break;
      var cols = Math.max(1, Math.floor((aw + gap) / (fw + gap) + 1e-6));
      var cand = { rows: rws, cols: cols, fw: fw, fh: fh };
      if (!best || (best.rows * best.cols < 3 && rws * cols > best.rows * best.cols)) best = cand;
      if (best.rows * best.cols >= 3) break;
    }
    if (!best || best.fh <= 0) return;
    var bw = best.cols * best.fw + (best.cols - 1) * gap;
    var bh = best.rows * (best.fh + lab) + (best.rows - 1) * gap;
    var x0 = c.x + m + (aw - bw) / 2;
    var y0 = c.y + m + (ah - bh) / 2;
    for (var i = 0; i < best.rows; i++) {
      for (var j = 0; j < best.cols; j++) {
        var x = x0 + j * (best.fw + gap);
        var y = y0 + i * (best.fh + lab + gap);
        if (!overlaps(ctx.r, x - 2, y - 2, best.fw + 4, best.fh + lab + 4)) continue;
        var W = best.fw;
        var H = best.fh;
        P.stroke('frame', frameD(ctx, x, y, W, H, W * 0.14));
        if (ctx.coarse) continue;
        P.stroke('line', roundRectD(x + W * 0.36, y + H * 0.018, W * 0.28, H * 0.034, H * 0.017));
        P.stroke('pill', 'M' + n(x + W * 0.33) + ' ' + n(y + H - H * 0.022) + 'H' + n(x + W * 0.67), 1);
        P.stroke('line', 'M' + n(x) + ' ' + n(y + H + lab * 0.85) + 'H' + n(x + W));
      }
    }
  }

  /* Browser wireframes: windows the width of the page with a toolbar (the
   * three window buttons and the address field), stacked down the page. */
  function layoutBrowser(P, ctx, p, c) {
    var m = p.margin * MM;
    var gap = p.gap * MM;
    var lab = p.label * MM;
    var bar = p.toolbar * MM;
    var aw = c.w - 2 * m;
    var ah = c.h - 2 * m;
    var W = Math.min(aw, 260 * MM);
    var H = W * 0.625 + bar;
    var count = Math.floor((ah + gap) / (H + lab + gap) + 1e-6);
    /* One more window when it costs at most a fifth of the width (two on
     * a portrait A4 instead of one with half the page empty). */
    var moreW = Math.min(aw, ((ah - count * gap - (count + 1) * lab) / (count + 1) - bar) / 0.625);
    if (moreW >= W * 0.8) { count++; W = moreW; H = W * 0.625 + bar; }
    if (count < 1) {
      count = 1;
      H = ah - lab;
      W = Math.min(aw, (H - bar) / 0.625);
    }
    if (W <= 0 || H <= bar) return;
    var bh = count * (H + lab) + (count - 1) * gap;
    var x = c.x + m + (aw - W) / 2;
    var y0 = c.y + m + (ah - bh) / 2;
    for (var i = 0; i < count; i++) {
      var y = y0 + i * (H + lab + gap);
      if (!overlaps(ctx.r, x - 2, y - 2, W + 4, H + lab + 4)) continue;
      P.stroke('frame', frameD(ctx, x, y, W, H, 2.5 * MM));
      P.stroke('line', 'M' + n(x) + ' ' + n(y + bar) + 'H' + n(x + W));
      if (ctx.coarse) continue;
      for (var k = 0; k < 3; k++) P.stroke('strong', circleD(x + 5 * MM + k * 4.2 * MM, y + bar / 2, 1.25 * MM));
      var fx = x + 20 * MM;
      var fw = W - 30 * MM;
      if (fw > 10 * MM) P.stroke('strong', roundRectD(fx, y + bar / 2 - 2.6 * MM, fw, 5.2 * MM, 2.6 * MM));
      P.stroke('line', 'M' + n(x) + ' ' + n(y + H + lab * 0.85) + 'H' + n(x + W * 0.6));
    }
  }

  /* Storyboard: numbered 16:9 frames with lines for the notes under each,
   * two across on a portrait page, three on a landscape one. */
  function layoutStoryboard(P, ctx, p, c) {
    var m = p.margin * MM;
    var gap = p.gap * MM;
    var step = p.step * MM;
    var aw = c.w - 2 * m;
    var ah = c.h - 2 * m;
    var cols = c.w > c.h ? 3 : 2;
    var fw = (aw - (cols - 1) * gap) / cols;
    var fh = fw * 9 / 16;
    var panel = fh + step * (p.lines + 0.4);
    var count = Math.max(1, Math.floor((ah + gap) / (panel + gap) + 1e-6));
    if (panel > ah) { fh = ah - step * (p.lines + 0.4); fw = fh * 16 / 9; panel = ah; }
    if (fh <= 0) return;
    var bh = count * panel + (count - 1) * gap;
    var bw = cols * fw + (cols - 1) * gap;
    var x0 = c.x + m + (aw - bw) / 2;
    var y0 = c.y + m + (ah - bh) / 2;
    var num = 0;
    for (var i = 0; i < count; i++) {
      for (var j = 0; j < cols; j++) {
        num++;
        var x = x0 + j * (fw + gap);
        var y = y0 + i * (panel + gap);
        if (!overlaps(ctx.r, x - 2, y - 2, fw + 4, panel + 4)) continue;
        P.stroke('frame', frameD(ctx, x, y, fw, fh, 1.2 * MM));
        if (ctx.coarse) continue;
        for (var l = 1; l <= p.lines; l++) P.stroke('line', 'M' + n(x) + ' ' + n(y + fh + l * step) + 'H' + n(x + fw));
        P.text(x + 2 * MM, y + 4.6 * MM, String(num), { size: 2.6 * MM });
      }
    }
  }

  /* Weekly planner: a band for the week's title, then the seven days
   * (Monday first, as in Italy and ISO 8601) and a box for notes, each
   * ruled; two columns on a portrait page, four on a landscape one. */
  function layoutWeekly(P, ctx, p, c) {
    var m = Math.min(p.margin * MM, c.w * 0.06);
    var gap = p.gap * MM;
    var step = p.step * MM;
    var header = p.header * MM;
    var cols = c.w > c.h ? 4 : 2;
    var rws = 8 / cols;
    var top = c.y + m + header;
    P.stroke('strong', 'M' + n(c.x + m) + ' ' + n(top - gap / 2) + 'H' + n(c.x + c.w - m));
    var bw = (c.w - 2 * m - (cols - 1) * gap) / cols;
    var bh = (c.y + c.h - m - top - gap / 2 - (rws - 1) * gap) / rws;
    if (bw <= 0 || bh <= 0) return;
    var size = Math.min(3 * MM, bh * 0.12);
    for (var i = 0; i < 8; i++) {
      var col = i % cols;
      var row = Math.floor(i / cols);
      if (cols === 2) { col = Math.floor(i / rws); row = i % rws; }
      var x = c.x + m + col * (bw + gap);
      var y = top + gap / 2 + row * (bh + gap);
      if (!overlaps(ctx.r, x - 2, y - 2, bw + 4, bh + 4)) continue;
      P.stroke('strong', frameD(ctx, x, y, bw, bh, 1.6 * MM));
      P.text(x + 2.4 * MM, y + 2 * MM + size, i < 7 ? t('paper.day.' + (i + 1)) : t('paper.notes'), { size: size, weight: 600 });
      ruledBetween(P, ctx, x + 2.4 * MM, x + bw - 2.4 * MM, y + 4 * MM + size, y + bh - 1.5 * MM, step);
    }
  }

  /* To-do list: a title line, then rows with a box to tick and a line. */
  function layoutTodo(P, ctx, p, c) {
    var m = Math.min(p.margin * MM, c.w * 0.08);
    var step = p.step * MM;
    var box = p.box * MM;
    var head = Math.min(p.header * MM, c.h * 0.15);
    var x0 = c.x + m;
    var x1 = c.x + c.w - m;
    P.stroke('strong', 'M' + n(x0) + ' ' + n(c.y + head) + 'H' + n(x1));
    var first = c.y + head + step + 2 * MM;
    var last = c.y + c.h - m * 0.7;
    var r = clipBox(ctx.r, { x: c.x, y: first - step, w: c.w, h: last - first + step });
    if (!r) return;
    var pl = plan(ctx, step, [{ every: 1, style: 'line' }], last - first, ctx.mode === 'infinite');
    var lv = pl.levels[pl.finest];
    /* Far out (or thinned) the rows are plain lines: one short command each
     * still reads as a list, where the boxes would cost five. */
    if (lv.every > 1 || ctx.coarse) {
      ladder(P, ctx, 'y', first, step, [{ every: 1, style: 'line' }], Math.max(first, r.y), Math.min(last, r.y + r.h), x0, x1);
      return;
    }
    if (lv.alpha <= 0.02) return;
    /* A box a few pixels wide needs no rounded corners. */
    var plain = box * ctx.density < 12;
    var k0 = Math.max(0, Math.ceil((r.y - first) / step));
    var k1 = Math.floor((Math.min(last, r.y + r.h + box) - first) / step + 1e-6);
    for (var k = k0; k <= k1; k++) {
      var y = first + k * step;
      if (y > last) break;
      P.stroke('strong', plain ? rectD(x0, y - 1.4 * MM - box, box, box) : roundRectD(x0, y - 1.4 * MM - box, box, box, 0.8 * MM), lv.alpha);
      P.stroke('line', 'M' + n(x0 + box + 3 * MM) + ' ' + n(y) + 'H' + n(x1), lv.alpha);
    }
  }

  var LAYOUTS = {
    'cornell': layoutCornell,
    'two-columns': layoutTwoColumns,
    'wireframe-phone': layoutPhone,
    'wireframe-browser': layoutBrowser,
    'storyboard': layoutStoryboard,
    'weekly': layoutWeekly,
    'todo': layoutTodo
  };

  /* A page layout: once on the page, or in every visible tile-sized cell
   * of the canvas, at the richest level the view can afford (CELL_BUDGET):
   * full, frames only, or a pattern of page outlines. What a cell costs is
   * measured by drawing one whole cell into a scratch painter, so the
   * budget holds for any paper, tile and parameters. */
  function drawLayout(P, ctx, p, type) {
    var fn = LAYOUTS[type];
    if (ctx.mode !== 'infinite') { fn(P, ctx, p, ctx.pg); return; }
    var tw = ctx.tile.w;
    var th = ctx.tile.h;
    var r = ctx.r;
    var i0 = Math.floor(r.x / tw);
    var i1 = Math.floor((r.x + r.w) / tw);
    var j0 = Math.floor(r.y / th);
    var j1 = Math.floor((r.y + r.h) / th);
    var cells = (i1 - i0 + 1) * (j1 - j0 + 1);
    var cellPx = Math.min(tw, th) * ctx.density;
    function costOf(coarse) {
      var probeCtx = {};
      for (var k in ctx) probeCtx[k] = ctx[k];
      var cell = { x: i0 * tw, y: j0 * th, w: tw, h: th };
      probeCtx.r = cell;
      probeCtx.coarse = coarse;
      var probe = painter(probeCtx);
      fn(probe, probeCtx, p, cell);
      return probe.cost();
    }
    var coarse = null;
    if (cells <= MAX_CELLS && cellPx >= CELL_FULL_PX && cells * costOf(false) <= CELL_BUDGET) coarse = false;
    else if (cells <= MAX_CELLS && cellPx >= CELL_FRAME_PX && cells * costOf(true) <= CELL_BUDGET) coarse = true;
    if (coarse === null) { outlines(P, ctx, tw, th, cellPx); return; }
    var cctx = ctx;
    if (coarse) {
      cctx = {};
      for (var key in ctx) cctx[key] = ctx[key];
      cctx.coarse = true;
    }
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) fn(P, cctx, p, { x: i * tw, y: j * th, w: tw, h: th });
    }
  }

  /* Far out, each page cell is a faint outline: one pattern tile per cell,
   * the outline inset from the tile's border so no seam can cut it. It
   * fades as the cells become specks. */
  function outlines(P, ctx, tw, th, cellPx) {
    var alpha = 0.6 * clamp((cellPx - 6) / 18, 0, 1);
    if (alpha <= 0.02) return;
    var id = ctx.id + '-cells';
    var width = P.widthOf(STYLES.fine);
    P.defs.push('<pattern id="' + id + '" patternUnits="userSpaceOnUse" x="0" y="0" width="' + n(tw) + '" height="' + n(th) +
      '"><path class="mr-line" fill="none" stroke="' + ctx.colors.line + '" stroke-width="' + n(width) + '" stroke-opacity="' + n(alpha * STYLES.fine.opacity) +
      '" d="' + rectD(tw * 0.04, th * 0.04, tw * 0.92, th * 0.92) + '"/></pattern>');
    P.under.push('<rect x="' + n(ctx.r.x) + '" y="' + n(ctx.r.y) + '" width="' + n(ctx.r.w) + '" height="' + n(ctx.r.h) + '" fill="url(#' + id + ')"/>');
  }

  var DRAW = {
    'blank': null,
    'image': null,
    'dots': drawDots,
    'grid-4': drawGrid,
    'grid-5': drawGrid,
    'grid-10': drawGrid,
    'grid-8pt': drawGrid8,
    'ruled-narrow': drawRuled,
    'ruled': drawRuled,
    'ruled-wide': drawRuled,
    'ruled-margin': drawRuled,
    'school-1': drawSchool1,
    'school-2': drawSchool2,
    'millimetre': drawMillimetre,
    'semilog': drawSemilog,
    'log-log': drawLogLog,
    'polar': drawPolar,
    'isometric': drawIsometric,
    'honeycomb': drawHoneycomb,
    'cartesian': drawCartesian,
    'staff': drawStaff,
    'grand-staff': drawGrandStaff,
    'guitar-tab': drawGuitarTab,
    'calligraphy': drawCalligraphy
  };

  /* ================================================================ pattern */

  var DEFAULT_TILE = { w: 210 * MM, h: 297 * MM };

  /* Which of the two meanings the rectangle has. docs/NOTEBOOK.md gives
   * patternSvg only {w, h, x, y, theme, colors} and says the pattern is
   * anchored to the origin, so a call that does not say otherwise is the
   * infinite canvas: a caller following the contract can never get paper
   * that swims with the camera. A page is asked for by name (mode 'page',
   * or page: true), or by giving a book size, which only pages have. */
  function modeOf(opts) {
    if (opts.mode === 'page' || opts.mode === 'infinite') return opts.mode;
    if (opts.infinite === true) return 'infinite';
    if (opts.page === true || (opts.size != null && opts.size !== false)) return 'page';
    return 'infinite';
  }

  /* The paper over a rectangle, as an SVG fragment in page px.
   *   opts.mode   'infinite' (the default, as in docs/NOTEBOOK.md): x, y, w,
   *               h is the visible part of the canvas; periodic papers are
   *               anchored to the origin, page layouts repeat in opts.tile
   *               cells
   *               'page' (also page: true, or a book size in opts.size):
   *               x, y, w, h is the page (with opts.size and no w/h, the
   *               page of that size at x, y)
   *   opts.scale  screen px per page px (the zoom), default 1: line widths
   *               and density follow it
   *   opts.print  true: every line shows (density as if zoomed in), for PDF
   *               and the paper saved inside page files
   *   opts.tile   {w, h} px: the cell size of page layouts on the canvas
   *               (the notebook's page size; opts.size's page, else A4)
   *   opts.theme, opts.background: see colors(); opts.colors overrides
   *   opts.sheet  false: no sheet rectangle under the lines
   *   opts.id     prefix for pattern ids (unique per call by default)
   * The group is aria-hidden (planner days and axis numbers are decoration,
   * not the person's content) and takes no pointer events (the pen's hit
   * tests go through it). */
  function patternSvg(paper, opts) {
    opts = opts || {};
    var np = normalize(paper);
    var infinite = modeOf(opts) === 'infinite';
    if (!infinite && !(Number(opts.w) > 0 && Number(opts.h) > 0) && opts.size != null) {
      var ps = pageSize(opts.size);
      var o2 = {};
      for (var key in opts) o2[key] = opts[key];
      o2.w = ps.w; o2.h = ps.h;
      opts = o2;
    }
    var w = Number(opts.w);
    var h = Number(opts.h);
    if (!(w > 0) || !(h > 0)) {
      if (infinite) return '';
      w = DEFAULT_TILE.w; h = DEFAULT_TILE.h;
    }
    var x = Number(opts.x) || 0;
    var y = Number(opts.y) || 0;
    var scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    var cols = colors(opts.theme, opts.background);
    if (opts.colors) for (var k in opts.colors) if (hex(opts.colors[k])) cols[k] = hex(opts.colors[k]);
    /* The cells of page layouts on the canvas: opts.tile, else the book
     * size when the caller passed one along, else A4. */
    var tile = opts.tile && opts.tile.w > 0 && opts.tile.h > 0 ? { w: Number(opts.tile.w), h: Number(opts.tile.h) }
      : (infinite && opts.size != null ? pageSize(opts.size) : DEFAULT_TILE);
    var id = String(opts.id || ('mrp' + (++seq).toString(36))).replace(/[^A-Za-z0-9_-]/g, '') || 'mrp';
    var ctx = {
      mode: infinite ? 'infinite' : 'page',
      r: { x: x, y: y, w: w, h: h },
      pg: infinite ? null : { x: x, y: y, w: w, h: h },
      scale: scale,
      density: opts.print ? Math.max(scale, 4) : scale,
      colors: cols,
      tile: tile,
      id: id
    };
    var P = painter(ctx);
    var draw = DRAW[np.type];
    if (draw) draw(P, ctx, np.params);
    else if (LAYOUTS[np.type]) drawLayout(P, ctx, np.params, np.type);
    var out = '<g class="mr-paper" data-paper="' + np.type + '" aria-hidden="true" pointer-events="none">';
    if (opts.sheet !== false) {
      out += '<rect class="mr-sheet" x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" fill="' + cols.sheet + '"/>';
    }
    return out + P.finish() + '</g>';
  }

  /* A whole page as a standalone SVG document: thumbnails, the settings
   * preview, the gallery. opts.size (a book size) or opts.w / opts.h px. */
  function pageSvg(paper, opts) {
    opts = opts || {};
    var box = opts.w > 0 && opts.h > 0 ? { w: Number(opts.w), h: Number(opts.h) } : pageSize(opts.size || 'a4');
    var o = {};
    for (var k in opts) o[k] = opts[k];
    o.mode = 'page'; o.x = 0; o.y = 0; o.w = box.w; o.h = box.h;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n(box.w) + ' ' + n(box.h) + '" width="' + n(box.w) + '" height="' + n(box.h) + '">' +
      patternSvg(paper, o) + '</svg>';
  }

  /* ================================================================ theming */

  var CLASS_ROLE = { 'mr-sheet': 'sheet', 'mr-ink': 'ink', 'mr-line': 'line', 'mr-strong': 'strongLine', 'mr-margin': 'margin', 'mr-text': 'text' };
  var TAG = /<([A-Za-z][^\s/>]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)(\s*\/?)>/g;
  var CLASS_ATTR = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/;

  /* A page saved on light paper with literal colours, shown in the theme
   * (and background) the notebook is displayed in: every element whose
   * class names a role gets that role's colour on its fill and stroke
   * (attributes and inline style), keeping 'none' and references. A light
   * page with the automatic background is returned unchanged. */
  function themeSvg(svgText, theme, background) {
    var text = String(svgText == null ? '' : svgText);
    var custom = background && background !== 'auto' ? hex(background) : null;
    if (theme !== 'dark' && !custom) return text;
    var c = colors(theme, background);
    return text.replace(TAG, function (whole, name, attrs, end) {
      var m = CLASS_ATTR.exec(attrs);
      if (!m) return whole;
      var classes = (m[2] != null ? m[2] : m[3] || '').split(/\s+/);
      var role = null;
      for (var i = 0; i < classes.length; i++) {
        if (CLASS_ROLE[classes[i]]) { role = CLASS_ROLE[classes[i]]; break; }
      }
      if (!role) return whole;
      var colour = c[role];
      var next = attrs.replace(/(\s(fill|stroke)\s*=\s*)("([^"]*)"|'([^']*)')/g, function (all, lead, prop, quoted, dq, sq) {
        var v = (dq != null ? dq : sq || '').trim();
        if (!paintable(v)) return all;
        return lead + '"' + colour + '"';
      }).replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/, function (all, lead, quoted, dq, sq) {
        var css = dq != null ? dq : sq || '';
        var fixed = css.replace(/(^|;)(\s*)(fill|stroke)(\s*:\s*)([^;]*)/g, function (decl, sep, sp, prop, colon, val) {
          return paintable(val.trim()) ? sep + sp + prop + colon + colour : decl;
        });
        return lead + '"' + fixed.replace(/"/g, '&quot;') + '"';
      });
      return '<' + name + next + end + '>';
    });
  }

  function paintable(v) {
    if (!v) return false;
    var low = v.toLowerCase();
    return low !== 'none' && low !== 'transparent' && low.indexOf('url(') < 0 && low !== 'inherit' && low !== 'currentcolor';
  }

  /* ================================================================ import */

  /* message: another string for the same code (a picture too large in
   * pixels is 'tooBig' with its own explanation). */
  function fail(code, vars, message) {
    var err = new Error(t('paper.import.' + (message || code), vars));
    err.code = code;
    return err;
  }

  function readBytes(file) {
    if (file && typeof file.arrayBuffer === 'function') {
      return file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return new Promise(function (resolve, reject) {
      try {
        var reader = new FileReader();
        reader.onload = function () { resolve(new Uint8Array(reader.result)); };
        reader.onerror = function () { reject(reader.error || new Error('read')); };
        reader.readAsArrayBuffer(file);
      } catch (err) { reject(err); }
    });
  }

  function u16(b, i, little) { return little ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]; }
  function u32(b, i, little) {
    return little ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 16777216
      : b[i] * 16777216 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
  }

  /* A PNG's size is in its IHDR chunk, always first. */
  function pngSize(b) {
    var sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.length < 24) return null;
    for (var i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
    if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    return { type: 'image/png', w: u32(b, 16), h: u32(b, 20) };
  }

  /* The EXIF orientation of a JPEG (1 when absent): 5 to 8 mean the picture
   * is shown turned a quarter, which browsers do for <img>, so width and
   * height swap. */
  function exifOrientation(b, start, end) {
    if (end - start < 14 || String.fromCharCode(b[start], b[start + 1], b[start + 2], b[start + 3]) !== 'Exif') return 1;
    var tiff = start + 6;
    var little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
    if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 1;
    var ifd = tiff + u32(b, tiff + 4, little);
    if (ifd + 2 > end) return 1;
    var count = u16(b, ifd, little);
    for (var i = 0; i < count; i++) {
      var e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      if (u16(b, e, little) === 0x0112) {
        var v = u16(b, e + 8, little);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
    return 1;
  }

  /* A JPEG's size is in its first start-of-frame segment. */
  function jpegSize(b) {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    var i = 2;
    var orientation = 1;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) return null;
      var marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      var len = u16(b, i + 2);
      if (len < 2 || i + 2 + len > b.length) return null;
      if (marker === 0xe1) orientation = Math.max(orientation, exifOrientation(b, i + 4, i + 2 + len));
      var sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) {
        if (len < 7) return null;
        var h = u16(b, i + 5);
        var w = u16(b, i + 7);
        if (orientation >= 5) { var tmp = w; w = h; h = tmp; }
        return { type: 'image/jpeg', w: w, h: h, orientation: orientation };
      }
      i += 2 + len;
    }
    return null;
  }

  function imageSize(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    return pngSize(b) || jpegSize(b);
  }

  function decodeText(b) {
    var enc = 'utf-8';
    if (b[0] === 0xff && b[1] === 0xfe) enc = 'utf-16le';
    else if (b[0] === 0xfe && b[1] === 0xff) enc = 'utf-16be';
    try { return new TextDecoder(enc).decode(b).replace(/^﻿/, ''); } catch (err) { return null; }
  }

  function looksLikeSvg(text) {
    var head = text.slice(0, 4096).replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '').trim();
    return /^<svg[\s>]/i.test(head) || /^<[A-Za-z_][\w.-]*:svg[\s>]/.test(head);
  }

  /* --------------------------------------------------------------- SVG sanitiser */

  /* What an imported SVG may contain: shapes, text, paint servers, clips,
   * masks, markers, filters made of primitives that reference nothing
   * outside the file. No script, foreignObject, animation (it can rewrite
   * an href to javascript:), feImage, font machinery or HTML. <a> becomes a
   * plain group. */
  var ALLOWED = {};
  ('svg g defs title desc symbol use switch path rect circle ellipse line polyline polygon text tspan textPath ' +
    'linearGradient radialGradient stop pattern clipPath mask marker image style filter feBlend feColorMatrix ' +
    'feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow ' +
    'feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight ' +
    'feSpecularLighting feSpotLight feTile feTurbulence').split(' ').forEach(function (name) { ALLOWED[name] = true; });

  var DROP_ATTRS = { 'src': 1, 'srcset': 1, 'action': 1, 'formaction': 1, 'data': 1, 'base': 1, 'xml:base': 1, 'ping': 1, 'download': 1 };
  var RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;

  function squash(v) { return String(v).replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '').toLowerCase(); }

  /* A value may only reference this file: url(#id), nothing else. */
  function urlsLocal(v) {
    var rest = String(v).replace(/url\(\s*(["']?)\s*#[^"')]*\1\s*\)/gi, '');
    return !/url\s*\(/i.test(rest) && !/\\/.test(rest);
  }

  /* Comments out, an unterminated one included (it runs to the end). */
  function noComments(css) {
    var s = String(css).replace(/\/\*[\s\S]*?\*\//g, ' ');
    var open = s.indexOf('/*');
    return open >= 0 ? s.slice(0, open) : s;
  }

  /* A piece of CSS checked as a whole: null when it imports, loads,
   * escapes or scripts anything. */
  function cleanCss(css) {
    var s = noComments(css);
    if (/\\/.test(s) || /<\//.test(s)) return null;
    /* Checked again with every space taken out, so a word split by a
     * comment (u, a comment, rl) cannot come back together. */
    var tight = s.replace(/\s+/g, '');
    var bad = /@import|@font-face|@namespace|expression\(|javascript:|vbscript:|-moz-binding|behavior:|image-set|image\(|cross-fade|element\(|paint\(|src\(/i;
    if (bad.test(s) || bad.test(tight)) return null;
    if (!urlsLocal(s) || !urlsLocal(tight)) return null;
    return s;
  }

  /* CSS from an imported file (a style attribute or a <style> sheet) with
   * only the bad parts taken out, so one escaped font name does not cost a
   * drawing all its colours. Every run of text between the delimiters
   * { } ; (a declaration, a selector, an at-rule's prelude) that fails
   * cleanCss is emptied; the delimiters stay, so no two pieces can join into
   * a new token. A selector emptied leaves a rule browsers drop. The result
   * is checked again whole and refused (null) if anything still fails. */
  function cleanSheet(css) {
    var parts = noComments(css).match(/[{};]|[^{};]+/g) || [];
    var out = '';
    var depth = 0;
    for (var i = 0; i < parts.length; i++) {
      var piece = parts[i];
      if (piece === '{') depth++;
      else if (piece === '}') depth = Math.max(0, depth - 1);
      else if (piece !== ';' && cleanCss(piece) == null) {
        /* A statement dropped at the top level (an @import) takes its ';'
         * along, or the next rule would read it as part of its selector. */
        if (depth === 0 && parts[i + 1] === ';') i++;
        continue;
      }
      out += piece;
    }
    return cleanCss(out);
  }

  function cleanElement(el) {
    var attrs = Array.prototype.slice.call(el.attributes);
    var local = el.localName;
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      var name = a.name.toLowerCase();
      var ns2 = a.namespaceURI;
      var value = a.value;
      var keep = true;
      if (ns2 === XMLNS_NS || name === 'xmlns' || name.indexOf('xmlns:') === 0) {
        keep = name === 'xmlns' || name === 'xmlns:xlink';
        if (!keep) { el.removeAttributeNode(a); }
        continue;
      }
      if (ns2 && ns2 !== XLINK_NS && ns2 !== XML_NS) keep = false;
      else if (name.indexOf('on') === 0) keep = false;
      else if (DROP_ATTRS[name] || DROP_ATTRS[a.localName]) keep = false;
      else if (a.localName === 'href') {
        var v = value.trim();
        if (local === 'image') keep = RASTER_DATA.test(v);
        else keep = /^#[^\s]*$/.test(v);
      } else if (name === 'style') {
        var css = cleanSheet(value);
        if (css == null) keep = false;
        else if (css !== value) el.setAttribute('style', css);
      } else {
        var sq = squash(value);
        if (sq.indexOf('javascript:') >= 0 || sq.indexOf('vbscript:') >= 0 || sq.indexOf('data:text') >= 0) keep = false;
        else if (/url\s*\(/i.test(value) && !urlsLocal(value)) keep = false;
      }
      if (!keep) el.removeAttributeNode(a);
    }
  }

  function walk(node) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3 || k.nodeType === 4) continue;
      if (k.nodeType !== 1) { node.removeChild(k); continue; }
      if (k.namespaceURI !== SVG_NS) { node.removeChild(k); continue; }
      var local = k.localName;
      if (local === 'a') {
        var g = k.ownerDocument.createElementNS(SVG_NS, 'g');
        Array.prototype.slice.call(k.attributes).forEach(function (a) {
          if (a.localName !== 'href' && a.localName !== 'target') {
            try { g.setAttributeNS(a.namespaceURI, a.name, a.value); } catch (err) { /* dropped */ }
          }
        });
        while (k.firstChild) g.appendChild(k.firstChild);
        node.replaceChild(g, k);
        k = g;
        local = 'g';
      }
      if (!ALLOWED[local]) { node.removeChild(k); continue; }
      if (local === 'style') {
        var css = cleanSheet(k.textContent || '');
        if (css == null) { node.removeChild(k); continue; }
        while (k.firstChild) k.removeChild(k.firstChild);
        k.appendChild(k.ownerDocument.createTextNode(css));
        cleanElement(k);
        continue;
      }
      cleanElement(k);
      if ((local === 'image' || local === 'use') && !k.getAttribute('href') && !k.getAttributeNS(XLINK_NS, 'href')) {
        node.removeChild(k);
        continue;
      }
      walk(k);
    }
  }

  var UNIT_PX = { px: 1, '': 1, mm: MM, cm: 10 * MM, in: 96, pt: 96 / 72, pc: 16 };

  function lengthPx(v) {
    var m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(px|mm|cm|in|pt|pc)?\s*$/i.exec(v || '');
    if (!m) return NaN;
    return parseFloat(m[1]) * UNIT_PX[(m[2] || '').toLowerCase()];
  }

  /* The size an SVG shows at: width and height (any absolute unit), else
   * the viewBox, else the size browsers give an SVG with neither. */
  function svgBox(root) {
    var w = lengthPx(root.getAttribute('width'));
    var h = lengthPx(root.getAttribute('height'));
    var vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);
    var hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    if (!(w > 0) && !(h > 0) && hasVb) { w = vb[2]; h = vb[3]; }
    else if (!(w > 0) && h > 0 && hasVb) w = h * vb[2] / vb[3];
    else if (!(h > 0) && w > 0 && hasVb) h = w * vb[3] / vb[2];
    if (!(w > 0)) w = 300;
    if (!(h > 0)) h = 150;
    return { w: w, h: h };
  }

  /* The factor that brings a size within MAX_SIDE and MAX_PIXELS. */
  function fitFactor(w, h) {
    return Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
  }

  /* An internal DTD subset is allowed only when it declares plain text
   * entities: Illustrator writes <!ENTITY ns_svg "http://..."> for its
   * namespaces. A parameter entity, an external one (SYSTEM, PUBLIC), one
   * whose text holds markup or other references (the way to a billion
   * laughs), or too many of them, refuse the file. */
  var ENTITY = /<!ENTITY\s+[A-Za-z_][\w.-]*\s+(?:"[^"&<%]{0,512}"|'[^'&<%]{0,512}')\s*>/g;

  function entitiesSafe(src) {
    var all = src.match(/<!ENTITY/gi);
    if (!all) return true;
    var plain = src.match(ENTITY);
    return !!plain && plain.length === all.length && all.length <= 64;
  }

  /* text -> {text, w, h}: the SVG with everything active or external taken
   * out, its width and height written in px so an <img> shows it at its
   * size. Throws an Error with .code 'invalid' when it is not an SVG. */
  function sanitizeSvg(text) {
    var src = String(text == null ? '' : text);
    if (!entitiesSafe(src)) throw fail('invalid');
    if (typeof DOMParser === 'undefined') throw fail('invalid');
    var doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    var root = doc && doc.documentElement;
    if (!root || root.getElementsByTagName('parsererror').length || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) throw fail('invalid');
    cleanElement(root);
    walk(root);
    var box = svgBox(root);
    /* Without a viewBox the drawing's user units are px from the corner, at
     * whatever width and height say: a viewBox of that size keeps it
     * exactly where it was when the size below changes unit or shrinks. */
    if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', '0 0 ' + n(box.w) + ' ' + n(box.h));
    var f = fitFactor(box.w, box.h);
    /* Rounded down when shrunk, so the result is within the limits. */
    var w = Math.max(1, f < 1 ? Math.floor(box.w * f * 100) / 100 : round2(box.w));
    var h = Math.max(1, f < 1 ? Math.floor(box.h * f * 100) / 100 : round2(box.h));
    root.setAttribute('width', n(w));
    root.setAttribute('height', n(h));
    var out = new XMLSerializer().serializeToString(root);
    return { text: out, w: w, h: h };
  }

  /* A picture chosen as the paper: SVG (sanitised), PNG or JPG, decided by
   * its bytes, not its name. Resolves to {name, type, bytes, w, h,
   * original}: name is the file to store in the notebook folder
   * (background.svg/.png/.jpg), original the name it came with. Rejects
   * with an Error whose .code is 'unsupported', 'tooBig', 'invalid' or
   * 'empty' and whose message is ready to show. */
  function importBackground(file) {
    if (!file) return Promise.reject(fail('empty'));
    var original = String(file.name || '');
    var declared = String(file.type || '').toLowerCase();
    var size = Number(file.size);
    if (size === 0) return Promise.reject(fail('empty'));
    var svgish = declared === 'image/svg+xml' || /\.svgz?$/i.test(original);
    if (size > (svgish ? MAX_SVG : MAX_RASTER)) return Promise.reject(fail('tooBig', { mb: Math.round((svgish ? MAX_SVG : MAX_RASTER) / 1048576) }));
    return readBytes(file).then(function (b) {
      if (!b.length) throw fail('empty');
      var img = imageSize(b);
      if (img) {
        if (!(img.w > 0 && img.h > 0)) throw fail('invalid');
        if (img.w > MAX_SIDE || img.h > MAX_SIDE || img.w * img.h > MAX_PIXELS) {
          throw fail('tooBig', { mp: Math.round(MAX_PIXELS / 1e6), side: MAX_SIDE }, 'tooLarge');
        }
        var ext = img.type === 'image/png' ? 'png' : 'jpg';
        return { name: 'background.' + ext, type: img.type, bytes: b, w: img.w, h: img.h, original: original };
      }
      if (b[0] === 0x1f && b[1] === 0x8b) throw fail('unsupported');
      if (b.length > MAX_SVG) throw fail('tooBig', { mb: Math.round(MAX_SVG / 1048576) });
      var text = decodeText(b);
      if (text == null || !looksLikeSvg(text)) throw fail('unsupported');
      var clean = sanitizeSvg(text);
      var bytes = new TextEncoder().encode(clean.text);
      return { name: 'background.svg', type: 'image/svg+xml', bytes: bytes, w: clean.w, h: clean.h, original: original };
    });
  }

  ns.paper = {
    MM: MM,
    CATALOG: CATALOG,
    GROUPS: GROUPS,
    SIZES: SIZES,
    label: label,
    groupLabel: groupLabel,
    sizeLabel: sizeLabel,
    entry: entry,
    normalize: normalize,
    normalizeSize: normalizeSize,
    pageSize: pageSize,
    patternSvg: patternSvg,
    pageSvg: pageSvg,
    colors: colors,
    contrast: contrast,
    themeSvg: themeSvg,
    importBackground: importBackground,
    sanitizeSvg: sanitizeSvg,
    imageSize: imageSize,
    isCellPaper: isCellPaper
  };
})(window.MindRoot);
