/* MindRoot - export a map: SVG, PNG, PDF, Markdown, the clipboard, share.
 *
 * The picture is never a screen capture. The map is drawn again off screen,
 * whole: every node box is built with the very markup and stylesheet the
 * map uses (ns.mapview.contentHtml, css/map.css), measured the way the view
 * measures it, and laid out by the same pure layout (ns.layout) with the
 * same gaps and the same sides - so the export is what view.geometry() would be
 * for that tree, with every branch open (or the folds of the screen), the
 * notes open as cards (a note on a link as a dashed card in the box of the
 * node it arrives at: a card on a 72 px curve would cover the neighbours)
 * and the drawings left out when asked. Then the
 * drawing is written as native SVG: links and stubs as paths with the
 * branch gradients, pictures as <image> with data: URLs, task boxes and
 * note cards as shapes, and every word as <text>, placed line by line where
 * the browser broke the lines (DOM ranges over the measured boxes: the same
 * font, the same metrics, nothing re-wrapped by guesswork). No
 * foreignObject, no CSS the reader must understand, colour-mix() resolved
 * to hex - so the file opens in Inkscape, Illustrator and Office, and
 * rasterises to PNG on a canvas in every browser (Safari taints canvases
 * that draw foreignObject). Montserrat travels inside the file as an
 * @font-face data URL (vendor/montserrat-font.js, injected by <script> the
 * first time something is exported: a file:// page cannot read its own font
 * file back).
 *
 *   PNG  the SVG on a canvas at 2x (less when the canvas would pass what
 *        browsers allow), with the map's Markdown in an iTXt chunk
 *        'mindroot-markdown': dropped back on MindRoot it is a map again
 *        (ns.archive.markdownFromPng).
 *   PDF  the browser's print engine, no library: the SVG in a print-only
 *        sheet, an @page rule cut to the drawing (96 dpi to mm, the longest
 *        side clamped to 297..5080 mm), window.print(); the sheet stays
 *        until afterprint (Chrome prints the live DOM). Vector, selectable.
 *   MD   the map's text, minus notes and drawings when asked.
 * Options (prefs.export): notes, expand (else the screen's folds),
 * drawings, paper light|dark. File names: the map's name, minus what file
 * systems refuse (a PNG dropped back keeps its map's name).
 *
 *   open()                                  the export sheet; with the board up
 *                                           (notebook.js, the Board view) it
 *                                           offers the board first: PDF of every
 *                                           page or PNG of the page in view (of
 *                                           the drawn area on an infinite board,
 *                                           a page per canvas when it has several),
 *                                           light or dark paper, through the
 *                                           board's own export (view.exportAs)
 *   svg(opts) -> Promise<Blob>, png(opts) -> Promise<Blob>,
 *   pdf(opts) -> Promise<{page, cleanup}>, markdown(opts) -> Blob,
 *   copyMarkdown(opts) -> Promise<bool>, share(format, opts) -> Promise<bool>,
 *   run(format, opts) -> Promise (download + toast)
 *   build(opts, input?) -> Promise<{svg, width, height, text, name, geometry}>
 *       input defaults to the open map (session); tests pass their own:
 *       {name, text, tree, balance, folds:Set, branchText,
 *        image(path) -> Promise<dataURL|null>}
 *   pageSize(w, h), withPngText(bytes, text), markdownText(opts, input),
 *   palette(paper), ensureFont() */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var PAD = 28;                  // px of paper around the drawing
  var PNG_SCALE = 2;
  var CANVAS_SIDE = 16384;       // the longest canvas side every engine draws
  var CANVAS_AREA = 16777216;    // Safari's canvas area limit (4096 x 4096)
  var PX_TO_MM = 25.4 / 96;
  var PAGE_MIN = 297;            // mm: the longest side never under A4 landscape
  var PAGE_MAX = 5080;           // mm: 200 in, the PDF page limit
  var PHOTO_MAX = 660;           // px: a 220 px picture kept sharp at 3x
  var GIF_KEEP_CHARS = 2 * 1024 * 1024; // an animated GIF up to about 1.5 MB stays animated in an SVG
  var IMAGE_WAIT = 4000;
  var KNOB_R = 6;
  var STUB_DROP = 1;
  var PNG_KEY = 'mindroot-markdown';
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* The font file, next to this script whatever page loaded it. */
  var FONT_SRC = (function () {
    var me = document.currentScript;
    try { return new URL('../../vendor/montserrat-font.js', me && me.src ? me.src : location.href).href; } catch (err) { return 'vendor/montserrat-font.js'; }
  })();

  var STRINGS = {
    en: {
      'export.title': 'Export',
      'export.format': 'Format',
      'export.fmt.svg': 'SVG',
      'export.fmt.png': 'PNG',
      'export.fmt.pdf': 'PDF',
      'export.fmt.md': 'Markdown',
      'export.notes': 'Include the notes',
      'export.expand': 'Open every branch',
      'export.drawings': 'Include the drawings',
      'export.paper': 'Paper',
      'export.paper.light': 'Light',
      'export.paper.dark': 'Dark',
      'export.hint.svg': 'One drawing of the whole map, with its font inside. Opens in any drawing program.',
      'export.hint.png': 'A picture of the map that carries the map: drop it back on MindRoot and it is a map again.',
      'export.hint.pdf': 'The print dialog opens with one page cut to the map: choose "Save as PDF".',
      'export.hint.md': 'The text file of this map, readable in any editor.',
      'export.run': 'Export',
      'export.copy': 'Copy Markdown',
      'export.share': 'Share',
      'export.working': 'Preparing the export',
      'export.saved': 'Exported: {file}',
      'export.printing': 'Choose "Save as PDF" in the print dialog.',
      'export.copied': 'Markdown copied',
      'export.copyFailed': 'The Markdown could not be copied.',
      'export.failed': 'The export did not work: {message}',
      'export.noMap': 'Open a map to export it.',
      'export.cmd.open': 'Export the map',
      'export.cmd.markdown': 'Export as Markdown',
      'export.cmd.copyMarkdown': 'Copy as Markdown',
      'export.cmd.png': 'Export as PNG',
      'export.cmd.svg': 'Export as SVG',
      'export.cmd.pdf': 'Export as PDF',
      'export.help.open': 'SVG, PNG, PDF or Markdown, with or without the notes and the drawings, on light or dark paper. With the board shown, its pages as a PDF or the page in view as a PNG.',
      'export.help.markdown': 'Downloads the map as a .md file, with the options last chosen in the export sheet.',
      'export.help.copyMarkdown': 'Puts the text of the map on the clipboard.',
      'export.help.png': 'A picture of the whole map that carries its Markdown inside.',
      'export.help.svg': 'A drawing of the whole map, with its font inside.',
      'export.help.pdf': 'One page cut to the map, through the print dialog.',
      'export.kw': 'export download save share print picture image pdf svg png markdown',
      'export.cmd.openBoard': 'Export the board or the map',
      'export.kw.board': 'board notebook pages',
      'export.kw.copy': 'clipboard copy',
      'export.kw.pdf': 'print',
      'export.what': 'What to export',
      'export.what.board': 'Board',
      'export.what.map': 'Map',
      'export.hint.board.pdfPages': 'Every page of the board, each at its own size, through the print dialog: choose "Save as PDF".',
      'export.hint.board.pngPages': 'The page in view, as a picture at twice its size.',
      'export.hint.board.pdfArea': 'What is drawn on the board, on one page cut to it, through the print dialog: choose "Save as PDF".',
      'export.hint.board.pngArea': 'What is drawn on the board, as a picture.',
      'export.hint.board.pdfCanvases': 'Every canvas of the board, each on a page cut to what is drawn on it, through the print dialog: choose "Save as PDF".',
      'export.hint.board.pngCanvases': 'What is drawn on the canvas shown, as a picture.'
    },
    it: {
      'export.title': 'Esporta',
      'export.format': 'Formato',
      'export.fmt.svg': 'SVG',
      'export.fmt.png': 'PNG',
      'export.fmt.pdf': 'PDF',
      'export.fmt.md': 'Markdown',
      'export.notes': 'Includi le note',
      'export.expand': 'Apri tutti i rami',
      'export.drawings': 'Includi i disegni',
      'export.paper': 'Carta',
      'export.paper.light': 'Chiara',
      'export.paper.dark': 'Scura',
      'export.hint.svg': 'Un disegno di tutta la mappa, con il suo font dentro. Si apre in qualsiasi programma di disegno.',
      'export.hint.png': "Un'immagine della mappa che porta con sé la mappa: trascinala di nuovo su MindRoot e torna mappa.",
      'export.hint.pdf': 'Si apre la stampa con una pagina tagliata sulla mappa: scegli «Salva come PDF».',
      'export.hint.md': 'Il file di testo di questa mappa, leggibile in qualsiasi editor.',
      'export.run': 'Esporta',
      'export.copy': 'Copia il Markdown',
      'export.share': 'Condividi',
      'export.working': "Preparazione dell'esportazione",
      'export.saved': 'Esportato: {file}',
      'export.printing': 'Nella finestra di stampa scegli «Salva come PDF».',
      'export.copied': 'Markdown copiato.',
      'export.copyFailed': 'Non è stato possibile copiare il Markdown.',
      'export.failed': "L'esportazione non è riuscita: {message}",
      'export.noMap': 'Apri una mappa per esportarla.',
      'export.cmd.open': 'Esporta la mappa',
      'export.cmd.markdown': 'Esporta in Markdown',
      'export.cmd.copyMarkdown': 'Copia come Markdown',
      'export.cmd.png': 'Esporta in PNG',
      'export.cmd.svg': 'Esporta in SVG',
      'export.cmd.pdf': 'Esporta in PDF',
      'export.help.open': 'SVG, PNG, PDF o Markdown, con o senza note e disegni, su carta chiara o scura. Con la lavagna in vista, le sue pagine in PDF o la pagina in vista in PNG.',
      'export.help.markdown': 'Scarica la mappa come file .md, con le opzioni scelte per ultime.',
      'export.help.copyMarkdown': 'Mette il testo della mappa negli appunti.',
      'export.help.png': "Un'immagine di tutta la mappa che porta dentro il suo Markdown.",
      'export.help.svg': 'Un disegno di tutta la mappa, con il suo font dentro.',
      'export.help.pdf': 'Una pagina tagliata sulla mappa, dalla finestra di stampa.',
      'export.kw': 'export download save share print picture image pdf svg png markdown esporta scarica salva condividi stampa immagine',
      'export.cmd.openBoard': 'Esporta la lavagna o la mappa',
      'export.kw.board': 'board notebook pages lavagna quaderno pagine',
      'export.kw.copy': 'clipboard copy appunti copia',
      'export.kw.pdf': 'print stampa',
      'export.what': 'Cosa esportare',
      'export.what.board': 'Lavagna',
      'export.what.map': 'Mappa',
      'export.hint.board.pdfPages': 'Tutte le pagine della lavagna, ciascuna nel suo formato, dalla finestra di stampa: scegli «Salva come PDF».',
      'export.hint.board.pngPages': 'La pagina in vista, come immagine al doppio della sua misura.',
      'export.hint.board.pdfArea': 'Quello che è disegnato sulla lavagna, su una pagina tagliata su misura, dalla finestra di stampa: scegli «Salva come PDF».',
      'export.hint.board.pngArea': 'Quello che è disegnato sulla lavagna, come immagine.',
      'export.hint.board.pdfCanvases': 'Tutte le tele della lavagna, ciascuna su una pagina tagliata su quello che vi è disegnato, dalla finestra di stampa: scegli «Salva come PDF».',
      'export.hint.board.pngCanvases': 'Quello che è disegnato sulla tela in vista, come immagine.'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  var FORMATS = ['svg', 'png', 'pdf', 'md'];
  var EXT = { svg: 'svg', png: 'png', pdf: 'pdf', md: 'md' };
  var DEFAULTS = { format: 'svg', notes: true, expand: true, drawings: false, paper: 'light' };

  /* ---------------------------------------------------------------- options and input */

  function options(over) {
    var saved = null;
    try { saved = ns.prefs ? ns.prefs.get('export') : null; } catch (err) { saved = null; }
    var out = {};
    for (var k in DEFAULTS) out[k] = saved && saved[k] !== undefined && saved[k] !== null ? saved[k] : DEFAULTS[k];
    if (over) for (var j in over) if (over[j] !== undefined) out[j] = over[j];
    if (FORMATS.indexOf(out.format) < 0) out.format = 'svg';
    out.paper = out.paper === 'dark' ? 'dark' : 'light';
    out.notes = !!out.notes;
    out.expand = !!out.expand;
    out.drawings = !!out.drawings;
    return out;
  }

  function remember(opts) {
    try {
      if (ns.prefs) ns.prefs.set('export', { format: opts.format, notes: opts.notes, expand: opts.expand, drawings: opts.drawings, paper: opts.paper });
    } catch (err) { /* preferences unavailable: the choice holds for this export */ }
  }

  function prefGet(key, fallback) {
    try {
      var v = ns.prefs ? ns.prefs.get(key) : undefined;
      return v === undefined || v === null ? fallback : v;
    } catch (err) { return fallback; }
  }

  /* The open map, as the export reads it. */
  function fromSession() {
    var S = ns.session;
    var cur = S && typeof S.current === 'function' ? S.current() : null;
    if (!cur) return null;
    var folds = new Set();
    try { if (S.view && typeof S.view.folded === 'function') S.view.folded().forEach(function (p) { folds.add(p); }); } catch (err) { /* no view */ }
    var pid = cur.projectId;
    return {
      name: cur.map && cur.map.name ? cur.map.name : 'mindroot',
      text: cur.text,
      tree: cur.tree,
      balance: typeof S.balance === 'function' ? S.balance() : false,
      folds: folds,
      branchText: !!prefGet('branchText', true),
      image: function (path) { return assetData(pid, path); }
    };
  }

  function requireInput(input) {
    var got = input || fromSession();
    if (!got) throw new Error(t('export.noMap'));
    return got;
  }

  /* A project picture as a data: URL; a big photo is scaled down to what a
   * 220 px picture needs, so the file does not carry the camera's 12 MP. */
  function assetData(pid, path) {
    var St = ns.storage;
    if (!St || typeof St.assetDataURL !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return St.assetDataURL(ns.store, pid, path); }).then(function (url) {
      if (!url) return null;
      /* An animated GIF stays itself in an SVG (it moves there too), unless
       * it would swell the file: then, like any photo, its first frame
       * scaled down. */
      if (/^data:image\/gif/i.test(url) && url.length <= GIF_KEEP_CHARS) return url;
      if (/^data:image\/(png|jpeg|webp|gif|bmp)/i.test(url)) return downscale(url, PHOTO_MAX);
      return url;
    }, function () { return null; });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var timer = setTimeout(function () { reject(new Error('image timeout')); }, IMAGE_WAIT * 2);
      img.onload = function () { clearTimeout(timer); resolve(img); };
      img.onerror = function () { clearTimeout(timer); reject(new Error('image')); };
      img.src = src;
    });
  }

  function downscale(url, max) {
    return loadImage(url).then(function (img) {
      var w = img.naturalWidth;
      var hgt = img.naturalHeight;
      if (!w || !hgt || w <= max) return url;
      var c = document.createElement('canvas');
      c.width = max;
      c.height = Math.max(1, Math.round(hgt * max / w));
      var g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      var small = /^data:image\/jpeg/i.test(url) ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
      return small.length < url.length ? small : url;
    }, function () { return url; });
  }

  /* ---------------------------------------------------------------- the font */

  var fontJob = null;
  function ensureFont() {
    if (ns.montserratDataURL) return Promise.resolve(ns.montserratDataURL);
    if (fontJob) return fontJob;
    fontJob = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = FONT_SRC;
      s.async = true;
      s.onload = function () { resolve(ns.montserratDataURL || null); };
      s.onerror = function () { fontJob = null; resolve(null); };
      document.head.appendChild(s);
    });
    return fontJob;
  }

  /* The map's font must be in before boxes are measured. */
  function fontsReady() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
    var loads = ['400', '500', '600', '700', '800'].map(function (w) { return document.fonts.load(w + ' 16px Montserrat').catch(function () {}); });
    var cap = new Promise(function (resolve) { setTimeout(resolve, 1500); });
    return Promise.race([Promise.all(loads), cap]);
  }

  /* ---------------------------------------------------------------- colours */

  var PALETTE_KEYS = ['paper', 'raised', 'sunken', 'ink', 'ink-soft', 'ink-faint', 'line', 'line-strong', 'line-control',
    'accent', 'accent-ink', 'on-accent', 'note', 'danger', 'mark'];
  /* Used only when css/source.css (which names both papers) did not load. */
  var FALLBACK = {
    light: { paper: '#fbfbfc', raised: '#ffffff', sunken: '#f3f4f6', ink: '#15171c', 'ink-soft': '#545a66', 'ink-faint': '#6b717c', line: '#e3e5ea', 'line-strong': '#c6cad2', 'line-control': '#8a909b', accent: '#2f7d5a', 'accent-ink': '#2a6f50', 'on-accent': '#ffffff', note: '#8a5fbf', danger: '#b4485f', mark: '#cfe2d9' },
    dark: { paper: '#131519', raised: '#1a1d22', sunken: '#0f1114', ink: '#e4e6ea', 'ink-soft': '#9ba1ac', 'ink-faint': '#858b95', line: '#282c33', 'line-strong': '#3a3f48', 'line-control': '#727883', accent: '#4fae82', 'accent-ink': '#5cbb8f', 'on-accent': '#131519', note: '#b389e0', danger: '#d4667c', mark: '#253a33' }
  };
  var palettes = {};

  /* The paper's colours, read from css/source.css (.xp-paper--light/dark):
   * the screen's tokens follow the theme, an export follows the paper. */
  function palette(paper) {
    paper = paper === 'dark' ? 'dark' : 'light';
    if (palettes[paper]) return palettes[paper];
    var out = {};
    var probe = document.createElement('div');
    probe.className = 'xp-paper xp-paper--' + paper;
    probe.style.display = 'none';
    (document.body || document.documentElement).appendChild(probe);
    var cs = getComputedStyle(probe);
    PALETTE_KEYS.forEach(function (k) {
      var v = toHex(cs.getPropertyValue('--xp-' + k).trim());
      out[k] = v || FALLBACK[paper][k];
    });
    probe.parentNode.removeChild(probe);
    palettes[paper] = out;
    return out;
  }

  function toHex(value) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value || '');
    if (!m) return null;
    var s = m[1].toLowerCase();
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    return '#' + s;
  }

  function rgbOf(hex) {
    var h = toHex(hex);
    if (!h) return null;
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexOf(rgb) {
    return '#' + rgb.map(function (v) {
      var c = Math.max(0, Math.min(255, Math.round(v)));
      return (c < 16 ? '0' : '') + c.toString(16);
    }).join('');
  }

  function toLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function fromLinear(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }

  function oklab(rgb) {
    var r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }

  function fromOklab(lab) {
    var l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    var m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    var s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2], 3);
    return [fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }

  /* color-mix(in oklab, a share, b): what the screen computes, as a hex. */
  function mixOklab(a, b, share) {
    var x = rgbOf(a);
    var y = rgbOf(b);
    if (!x) return toHex(b) || '#000000';
    if (!y) return toHex(a);
    var p = oklab(x);
    var q = oklab(y);
    return hexOf(fromOklab([p[0] * share + q[0] * (1 - share), p[1] * share + q[1] * (1 - share), p[2] * share + q[2] * (1 - share)]));
  }

  /* An alpha colour laid on the paper, flattened: tools without alpha-mix
   * draw it the same. */
  function over(color, alpha, paper) {
    var c = rgbOf(color);
    var p = rgbOf(paper);
    if (!c || !p) return toHex(color) || paper;
    return hexOf([0, 1, 2].map(function (i) { return c[i] * alpha + p[i] * (1 - alpha); }));
  }

  function stopsFor(from, to) {
    if (ns.colors && typeof ns.colors.fadeStops === 'function') return ns.colors.fadeStops(from, to);
    var mid = mixOklab(from, to, 0.5);
    return [{ offset: 0, color: from }, { offset: 0.24, color: from }, { offset: 0.5, color: mid }, { offset: 0.76, color: to }, { offset: 1, color: to }];
  }

  /* ---------------------------------------------------------------- XML */

  function xml(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function n2(v) { return String(Math.round(v * 100) / 100); }

  /* ---------------------------------------------------------------- the tree to draw */

  /* A copy of the view tree with what the options leave out taken out:
   * notes when they are not wanted, drawings unless asked for (never even
   * read then). A node whose only content was a drawing goes with it. */
  function prepareTree(v, opts) {
    if (!v) return null;
    var c = {};
    for (var k in v) c[k] = v[k];
    c.notes = opts.notes && v.notes ? { node: v.notes.node || null, edge: v.notes.edge || null } : { node: null, edge: null };
    var dropped = false;
    if (!opts.drawings) {
      var keep = function (list) { return (list || []).filter(function (im) { if (im.kind === 'draw') { dropped = true; return false; } return true; }); };
      c.images = keep(v.images);
      c.drawAbove = false;
      if (v.body) {
        c.body = {};
        for (var b in v.body) c.body[b] = v.body[b];
        c.body.images = keep(v.body.images);
        c.body.drawAbove = false;
        if (!c.body.html && !c.body.images.length) c.body = null;
      }
    }
    c.children = [];
    (v.children || []).forEach(function (child) {
      var cc = prepareTree(child, opts);
      if (cc) c.children.push(cc);
    });
    if (dropped && !v.synthetic && !c.html && !c.images.length && !c.body && !c.children.length) return null;
    return c;
  }

  function walk(v, fn) {
    if (!v) return;
    fn(v);
    for (var i = 0; i < v.children.length; i++) walk(v.children[i], fn);
  }

  /* ---------------------------------------------------------------- measuring off screen */

  function makeHost() {
    var host = document.createElement('div');
    host.className = 'xp-host';
    host.setAttribute('aria-hidden', 'true');
    var mv = document.createElement('div');
    mv.className = 'mv xp-map';
    host.appendChild(mv);
    document.body.appendChild(host);
    return { host: host, mv: mv };
  }

  /* Pictures into the off-screen boxes, as data URLs, decoded before the
   * boxes are measured; one that cannot be read is drawn as missing. */
  function fillImages(nodeEls, input) {
    var jobs = [];
    var cache = new Map();
    nodeEls.forEach(function (rec) {
      var imgs = rec.el.querySelectorAll('img.mv-img');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var list = img.getAttribute('data-field') === 'b' ? (rec.v.body && rec.v.body.images) : rec.v.images;
        var im = list ? list[Number(img.getAttribute('data-i'))] : null;
        var path = im ? (im.path || im.src || '') : '';
        img.setAttribute('data-src', path);
        jobs.push(fillOne(img, path, input, cache));
      }
    });
    return Promise.all(jobs);
  }

  function fillOne(img, path, input, cache) {
    var job = cache.get(path);
    if (!job) {
      job = /^data:/i.test(path) ? Promise.resolve(path) :
        Promise.resolve().then(function () { return input.image ? input.image(path) : null; }).catch(function () { return null; });
      cache.set(path, job);
    }
    return job.then(function (url) {
      if (!url || !/^data:/i.test(url)) { img.setAttribute('data-broken', 'true'); return; }
      img.src = url;
      var decoded = typeof img.decode === 'function' ? img.decode() : new Promise(function (res, rej) { img.onload = res; img.onerror = rej; });
      var cap = new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error('slow')); }, IMAGE_WAIT); });
      return Promise.race([decoded, cap]).catch(function () {
        img.removeAttribute('src');
        img.setAttribute('data-broken', 'true');
      });
    });
  }

  /* ---------------------------------------------------------------- reading the boxes back */

  var ratioCache = {};
  var ctx2d = null;
  /* Where the baseline sits in a text box of this font: the share of the
   * content area above it (the font's own ascent and descent). */
  function ascentRatio(cs) {
    var key = cs.fontStyle + '|' + cs.fontWeight + '|' + cs.fontFamily;
    if (ratioCache[key] !== undefined) return ratioCache[key];
    var ratio = 0.79;
    try {
      if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
      ctx2d.font = cs.fontStyle + ' ' + cs.fontWeight + ' 100px ' + cs.fontFamily;
      var m = ctx2d.measureText('Hg');
      if (m.fontBoundingBoxAscent > 0 && m.fontBoundingBoxDescent >= 0) ratio = m.fontBoundingBoxAscent / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    } catch (err) { /* keep the usual share */ }
    ratioCache[key] = ratio;
    return ratio;
  }

  /* Each text node cut where the browser broke its lines: one fragment per
   * line, placed at the first glyph's box. Words are measured whole; a word
   * broken across lines (overflow-wrap) is measured by its characters. */
  function lineFragments(tn, range) {
    var data = tn.data;
    var out = [];
    var cur = null;
    function place(start, end, r) {
      if (!r || (!r.width && !r.height)) return;
      if (cur && Math.abs(r.top - cur.top) < 1 && start >= cur.end) {
        cur.end = end;
        cur.right = r.right;
        return;
      }
      cur = { start: start, end: end, top: r.top, left: r.left, right: r.right, height: r.height };
      out.push(cur);
    }
    var re = /\S+/g;
    var m;
    while ((m = re.exec(data))) {
      range.setStart(tn, m.index);
      range.setEnd(tn, m.index + m[0].length);
      var rects = range.getClientRects();
      var oneLine = rects.length <= 1;
      for (var r = 1; r < rects.length && oneLine; r++) if (Math.abs(rects[r].top - rects[0].top) >= 1) oneLine = false;
      if (oneLine) {
        place(m.index, m.index + m[0].length, rects.length ? range.getBoundingClientRect() : null);
        continue;
      }
      for (var k = 0; k < m[0].length; k++) {
        var at = m.index + k;
        var code = data.charCodeAt(at);
        var len = code >= 0xD800 && code <= 0xDBFF ? 2 : 1;
        range.setStart(tn, at);
        range.setEnd(tn, at + len);
        place(at, at + len, range.getBoundingClientRect());
        k += len - 1;
      }
    }
    return out.map(function (f) { return { text: data.slice(f.start, f.end), top: f.top, left: f.left, right: f.right, height: f.height }; });
  }

  /* What a run of words is, for its colour. */
  function roleOf(parent, nodeEl) {
    if (parent.closest('.mv-card')) return 'card';
    if (parent.closest('a')) return 'link';
    if (parent.closest('.mv-num')) return 'soft';
    if (parent.closest('.md-sep')) return 'faint';
    if (parent.closest('.md-quote')) return 'soft';
    if (parent.closest('.mv-role--caption')) return 'soft';
    if (nodeEl.classList.contains('mv-caption') && parent.closest('.mv-title')) return 'caption';
    return 'ink';
  }

  /* The lines an element's words sit on, each as one span from its first
   * glyph to its last: what an underline or a strike covers. */
  function lineSpans(el, range) {
    range.selectNodeContents(el);
    var rects = Array.prototype.filter.call(range.getClientRects(), function (r) { return r.width > 0 && r.height > 0; });
    rects.sort(function (a, b) { return a.top - b.top || a.left - b.left; });
    var lines = [];
    rects.forEach(function (r) {
      var mid = (r.top + r.bottom) / 2;
      var line = null;
      for (var i = 0; i < lines.length; i++) if (mid >= lines[i].top && mid <= lines[i].bottom) { line = lines[i]; break; }
      if (!line) lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      else {
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
      }
    });
    return lines;
  }

  /* Underlines and strikes, drawn as lines the way the screen draws them
   * (a link underlined at 45%, a done task struck at 55%): SVG
   * text-decoration has no colour or offset of its own, and several
   * editors ignore it. */
  function readDecorations(nodeEl, origin, cache, range, out) {
    var list = nodeEl.querySelectorAll('a, u, s, del, strike, .mv-node--done .mv-title .mv-text');
    if (nodeEl.matches('.mv-node--done')) {
      var own = nodeEl.querySelector('.mv-title .mv-text');
      if (own && Array.prototype.indexOf.call(list, own) < 0) list = Array.prototype.concat.call([own], Array.prototype.slice.call(list));
    }
    Array.prototype.forEach.call(list, function (el) {
      var cs = cache.style(el);
      var size = parseFloat(cs.fontSize) || 15;
      var ratio = ascentRatio(cs);
      var link = el.tagName === 'A';
      var strike = /^(S|DEL|STRIKE)$/.test(el.tagName) || el.classList.contains('mv-text');
      lineSpans(el, range).forEach(function (l) {
        out.push({
          kind: strike ? 'strike' : 'underline',
          link: link,
          role: link ? 'link' : roleOf(el, nodeEl),
          x: l.left - origin.left,
          w: l.right - l.left,
          y: l.top - origin.top + (l.bottom - l.top) * ratio,
          size: size
        });
      });
    });
  }

  function styleCache() {
    var map = new Map();
    return {
      style: function (el) {
        var s = map.get(el);
        if (!s) { s = getComputedStyle(el); map.set(el, s); }
        return s;
      }
    };
  }

  /* Everything drawn inside one box, relative to the box's corner. */
  function readBox(nodeEl, cache, range) {
    var origin = nodeEl.getBoundingClientRect();
    var out = { texts: [], fills: [], images: [], tasks: [], dots: [], cards: [], decos: [] };
    function rel(r) { return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }; }

    var cards = nodeEl.querySelectorAll('.mv-card');
    for (var c = 0; c < cards.length; c++) out.cards.push({ edge: cards[c].classList.contains('xp-edge'), box: rel(cards[c].getBoundingClientRect()) });

    var fills = nodeEl.querySelectorAll('code, mark');
    for (var f = 0; f < fills.length; f++) {
      var fe = fills[f];
      var kind = fe.tagName === 'MARK' ? 'mark' : (fe.classList.contains('md-code') ? 'block' : 'code');
      var rects = kind === 'block' ? [fe.getBoundingClientRect()] : fe.getClientRects();
      for (var r = 0; r < rects.length; r++) if (rects[r].width && rects[r].height) out.fills.push({ kind: kind, box: rel(rects[r]) });
    }

    var imgs = nodeEl.querySelectorAll('img.mv-img');
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      out.images.push({ box: rel(im.getBoundingClientRect()), src: im.getAttribute('src') || '', broken: im.getAttribute('data-broken') === 'true', path: im.getAttribute('data-src') || '' });
    }

    var tasks = nodeEl.querySelectorAll('.mv-task');
    for (var k = 0; k < tasks.length; k++) out.tasks.push({ box: rel(tasks[k].getBoundingClientRect()), checked: tasks[k].getAttribute('aria-checked') === 'true' });

    var dots = nodeEl.querySelectorAll('.mv-note-dot');
    for (var d = 0; d < dots.length; d++) out.dots.push({ box: rel(dots[d].getBoundingClientRect()) });

    readTexts(nodeEl, nodeEl, origin, cache, range, out.texts);
    readDecorations(nodeEl, origin, cache, range, out.decos);
    return out;
  }

  function readTexts(scope, nodeEl, origin, cache, range, out) {
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    var tn;
    var clipped = new Map();
    while ((tn = walker.nextNode())) {
      if (!/\S/.test(tn.data)) continue;
      var parent = tn.parentElement;
      if (!parent) continue;
      var cs = cache.style(parent);
      if (cs.display === 'none') continue;
      var card = parent.closest('.mv-card');
      var limit = card ? card.getBoundingClientRect().bottom - (parseFloat(cache.style(card).paddingBottom) || 0) + 0.5 : Infinity;
      var frags = lineFragments(tn, range);
      var ratio = ascentRatio(cs);
      var role = roleOf(parent, nodeEl);
      for (var i = 0; i < frags.length; i++) {
        var fr = frags[i];
        if (fr.top + fr.height > limit) { if (card) clipped.set(card, true); continue; }
        out.push({
          text: fr.text,
          x: fr.left - origin.left,
          y: fr.top - origin.top + fr.height * ratio,
          size: parseFloat(cs.fontSize) || 15,
          weight: cs.fontWeight,
          italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
          family: cs.fontFamily,
          spacing: cs.letterSpacing,
          role: role,
          card: card || null
        });
      }
    }
    /* A note clamped on screen ends in an ellipsis here too. */
    clipped.forEach(function (yes, card) {
      for (var j = out.length - 1; j >= 0; j--) {
        if (out[j].card === card) { out[j].text = out[j].text.replace(/\s*\S?$/, '') + '\u2026'; break; }
      }
    });
  }

  /* ---------------------------------------------------------------- build */

  function mapviewGaps() {
    var g = ns.mapview && ns.mapview.GAPS;
    return g || { gapX: 72, gapY: 12, cousinGap: 24 };
  }

  /* The drawing of a map, as SVG markup. */
  async function build(opts, input) {
    opts = options(opts);
    input = requireInput(input);
    if (!ns.mapview || typeof ns.mapview.contentHtml !== 'function' || !ns.layout) throw new Error('mapview');
    var pal = palette(opts.paper);
    var tree = prepareTree(input.tree, opts);
    var fontURL = await ensureFont();
    await fontsReady();
    var text = markdownText(opts, input);
    var name = input.name || 'mindroot';
    if (!tree) return finish(emptyDrawing(pal, fontURL, name), text, name);

    var made = makeHost();
    try {
      var recs = new Map();
      var order = [];
      walk(tree, function (v) { if (!v.synthetic && v.path !== null && v.path !== undefined) { order.push(v); } });
      var html = '';
      var o = { notesOpen: opts.notes, readOnly: true };
      for (var i = 0; i < order.length; i++) {
        var content = ns.mapview.contentHtml(order[i], o);
        html += '<div class="mv-pos"><div class="' + content.cls + '" data-k="' + i + '">' + content.html + '</div></div>';
      }
      var box = document.createElement('div');
      box.className = 'mv-nodes';
      box.innerHTML = html;
      made.mv.appendChild(box);
      var els = box.querySelectorAll('.mv-node');
      for (var e = 0; e < els.length; e++) {
        var v = order[Number(els[e].getAttribute('data-k'))];
        recs.set(v.path, { el: els[e], v: v });
        if (opts.notes && v.notes && v.notes.edge) els[e].appendChild(edgeCard(v.notes.edge));
      }
      await fillImages(recs, input);

      var sizes = new Map();
      recs.forEach(function (rec, path) {
        var w = rec.el.offsetWidth;
        var hgt = rec.el.offsetHeight;
        var title = rec.el.querySelector('.mv-title');
        var base = title ? title.offsetTop + title.offsetHeight + STUB_DROP : hgt;
        sizes.set(path, { w: w, h: hgt, base: Math.min(base, hgt) });
      });
      var folds = new Set();
      if (!opts.expand && input.folds) input.folds.forEach(function (p) { if (recs.has(p)) folds.add(p); });
      var gaps = mapviewGaps();
      var geo = ns.layout.layout(tree, sizes, {
        balance: input.balance === true, folded: folds,
        gapX: gaps.gapX, gapY: gaps.gapY, cousinGap: gaps.cousinGap, knob: KNOB_R + 2
      });
      geo.order.forEach(function (p) { if (geo.nodes[p].side === 'left') recs.get(p).el.classList.add('mv-node--left'); });

      var cache = styleCache();
      var range = document.createRange();
      var drawn = [];
      geo.order.forEach(function (p) {
        var rec = recs.get(p);
        drawn.push({ path: p, v: rec.v, g: geo.nodes[p], box: readBox(rec.el, cache, range) });
      });
      return finish(compose(geo, drawn, pal, input, fontURL, name), text, name);
    } finally {
      if (made.host.parentNode) made.host.parentNode.removeChild(made.host);
    }
  }

  function finish(r, text, name) {
    r.text = text;
    r.name = name;
    return r;
  }

  /* A note on the link arriving at a node. On screen it is a dot on the
   * curve (a card when every note is open); in a picture a card on the
   * curve would sit on the neighbours - links are only 72 px long - so it
   * rides in the node's own box under its words, dashed, where the layout
   * makes room for it. */
  function edgeCard(note) {
    var card = document.createElement('div');
    card.className = 'mv-card xp-edge';
    var lines = String(note).split('\n');
    lines.forEach(function (line, i) {
      if (i) card.appendChild(document.createElement('br'));
      card.appendChild(document.createTextNode(line));
    });
    return card;
  }

  function emptyDrawing(pal, fontURL, name) {
    var w = PAD * 2 + 64;
    var hgt = PAD * 2 + 32;
    return { svg: head(w, hgt, pal, fontURL, name, '') + '</svg>', width: w, height: hgt };
  }

  function head(w, hgt, pal, fontURL, name, defs) {
    var style = fontURL && /^data:font\//.test(fontURL)
      ? '<style>@font-face{font-family:"Montserrat";src:url(' + fontURL + ') format("woff2");font-weight:100 900;font-style:normal}</style>'
      : '';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="' + SVGNS + '" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="' + n2(w) + '" height="' + n2(hgt) +
      '" viewBox="0 0 ' + n2(w) + ' ' + n2(hgt) + '">' +
      '<title>' + xml(name) + '</title>' +
      '<defs>' + style + defs + '</defs>' +
      '<rect class="paper" x="0" y="0" width="' + n2(w) + '" height="' + n2(hgt) + '" fill="' + pal.paper + '"/>';
  }

  /* ---------------------------------------------------------------- writing the SVG */

  function familyAttr(family) {
    var f = String(family || '').replace(/"/g, "'");
    if (/^\s*'?Montserrat'?\s*(,|$)/i.test(f)) return '';
    return f;
  }

  function textColor(role, branch, pal, branchText) {
    switch (role) {
      case 'card': return pal['ink-soft'];
      case 'link': return pal['accent-ink'];
      case 'soft': return pal['ink-soft'];
      case 'faint': return pal['ink-faint'];
      case 'caption': return branchText && branch ? mixOklab(branch, pal['ink-soft'], 0.5) : pal['ink-soft'];
      default: return branchText && branch ? mixOklab(branch, pal.ink, 0.78) : pal.ink;
    }
  }

  function textEl(tx, dx, dy, branch, pal, branchText) {
    var attrs = ' x="' + n2(tx.x + dx) + '" y="' + n2(tx.y + dy) + '"';
    var fam = familyAttr(tx.family);
    if (fam) attrs += ' font-family="' + xml(fam) + '"';
    attrs += ' font-size="' + n2(tx.size) + '"';
    if (tx.weight && String(tx.weight) !== '400') attrs += ' font-weight="' + xml(tx.weight) + '"';
    if (tx.italic) attrs += ' font-style="italic"';
    var ls = parseFloat(tx.spacing);
    if (isFinite(ls) && ls) attrs += ' letter-spacing="' + n2(ls) + '"';
    attrs += ' fill="' + textColor(tx.role, branch, pal, branchText) + '"';
    return '<text' + attrs + '>' + xml(tx.text) + '</text>';
  }

  function decoEl(dc, dx, dy, branch, pal, branchText) {
    var color = textColor(dc.role, branch, pal, branchText);
    var x1 = n2(dc.x + dx);
    var x2 = n2(dc.x + dx + dc.w);
    var thick = n2(Math.max(1, dc.size / 15));
    if (dc.kind === 'strike') {
      return '<path d="M' + x1 + ',' + n2(dc.y + dy - 0.28 * dc.size) + 'H' + x2 + '" stroke="' + color + '" stroke-width="' + thick + '" stroke-opacity="0.55"/>';
    }
    var uy = dc.y + dy + (dc.link ? 0.15 : 0.11) * dc.size + 0.5;
    return '<path d="M' + x1 + ',' + n2(uy) + 'H' + x2 + '" stroke="' + color + '" stroke-width="' + (dc.link ? 1 : thick) + '"' + (dc.link ? ' stroke-opacity="0.45"' : '') + '/>';
  }

  function compose(geo, drawn, pal, input, fontURL, name) {
    var b = geo.bounds;
    var minX = b.x - KNOB_R;
    var minY = b.y;
    var maxX = b.x + b.w + KNOB_R;
    var maxY = b.y + b.h;
    var dx = PAD - minX;
    var dy = PAD - minY;
    var w = Math.ceil(maxX - minX + PAD * 2);
    var hgt = Math.ceil(maxY - minY + PAD * 2);
    var branchText = !!input.branchText;
    var defs = '';
    var clipN = 0;
    var gradN = 0;
    var colorOf = {};
    drawn.forEach(function (d) { colorOf[d.path] = toHex(d.v.color) || pal['ink-soft']; });

    /* Lines: every stub and same-colour link in one path per colour, a
     * link between two colours on its own with its gradient. */
    var byColor = {};
    var lines = '';
    drawn.forEach(function (d) {
      var g = d.g;
      var y = g.y + g.base + dy;
      var seg = 'M' + n2(g.x + dx) + ',' + n2(y) + 'H' + n2(g.x + g.w + dx);
      var c = colorOf[d.path];
      (byColor[c] = byColor[c] || []).push(seg);
    });
    geo.links.forEach(function (l) {
      var from = colorOf[l.from];
      var to = colorOf[l.to];
      var dPath = ns.layout.linkPath(l.x1 + dx, l.y1 + dy, l.x2 + dx, l.y2 + dy);
      if (!from || !to || from === to) {
        var c = to || from || pal['ink-soft'];
        (byColor[c] = byColor[c] || []).push(dPath);
        return;
      }
      var id = 'g' + (++gradN);
      defs += '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + n2(l.x1 + dx) + '" y1="' + n2(l.y1 + dy) +
        '" x2="' + n2(l.x2 + dx) + '" y2="' + n2(l.y2 + dy) + '">' +
        stopsFor(from, to).map(function (s) { return '<stop offset="' + n2(s.offset) + '" stop-color="' + s.color + '"/>'; }).join('') +
        '</linearGradient>';
      lines += '<path d="' + dPath + '" stroke="url(#' + id + ')"/>';
    });
    var plain = '';
    Object.keys(byColor).forEach(function (c) { plain += '<path d="' + byColor[c].join('') + '" stroke="' + c + '"/>'; });
    var linkLayer = '<g class="links" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + plain + lines + '</g>';

    var knobs = '';
    drawn.forEach(function (d) {
      if (!d.g.folded || !d.g.hasKids) return;
      var cx = (d.g.side === 'left' ? d.g.x : d.g.x + d.g.w) + dx;
      var cy = d.g.y + d.g.base + dy;
      knobs += '<circle cx="' + n2(cx) + '" cy="' + n2(cy) + '" r="' + KNOB_R + '" fill="' + colorOf[d.path] + '" stroke="' + colorOf[d.path] + '" stroke-width="1.5"/>';
    });

    var nodes = '';
    drawn.forEach(function (d) {
      var ox = d.g.x + dx;
      var oy = d.g.y + dy;
      var box = d.box;
      var branch = colorOf[d.path];
      var out = '';
      box.fills.forEach(function (f) {
        var fill = f.kind === 'mark' ? pal.mark : pal.sunken;
        var r = f.kind === 'block' ? 6 : (f.kind === 'mark' ? 2 : 4);
        out += rect(f.box, ox, oy, r, ' fill="' + fill + '"');
      });
      box.cards.forEach(function (c) {
        var cb = c.box;
        var id = 'c' + (++clipN);
        defs += '<clipPath id="' + id + '">' + rect(cb, ox, oy, 6, '') + '</clipPath>';
        out += rect(cb, ox, oy, 6, ' fill="' + pal.raised + '"') +
          '<rect x="' + n2(cb.x + ox) + '" y="' + n2(cb.y + oy) + '" width="3" height="' + n2(cb.h) + '" fill="' + pal.note + '" clip-path="url(#' + id + ')"/>' +
          rect({ x: cb.x + 0.5, y: cb.y + 0.5, w: cb.w - 1, h: cb.h - 1 }, ox, oy, 5.5, ' fill="none" stroke="' + pal['line-strong'] + '" stroke-width="1"' +
            (c.edge ? ' stroke-dasharray="3 2"' : ''));
      });
      box.images.forEach(function (im) {
        var ib = im.box;
        if (im.broken || !im.src) {
          out += rect({ x: ib.x + 0.5, y: ib.y + 0.5, w: ib.w - 1, h: ib.h - 1 }, ox, oy, 6, ' fill="' + pal.raised + '" stroke="' + pal.danger + '" stroke-dasharray="4 3" stroke-width="1"');
          var label = String(im.path || '').split('/').pop();
          if (label) {
            var id0 = 'c' + (++clipN);
            defs += '<clipPath id="' + id0 + '">' + rect(ib, ox, oy, 6, '') + '</clipPath>';
            out += '<text x="' + n2(ib.x + ox + 8) + '" y="' + n2(ib.y + oy + ib.h / 2 + 4) + '" font-size="12" fill="' + pal['ink-soft'] + '" clip-path="url(#' + id0 + ')">' + xml(label) + '</text>';
          }
          return;
        }
        var id = 'c' + (++clipN);
        defs += '<clipPath id="' + id + '">' + rect(ib, ox, oy, 6, '') + '</clipPath>';
        out += rect(ib, ox, oy, 6, ' fill="' + pal.raised + '"') +
          '<image x="' + n2(ib.x + ox) + '" y="' + n2(ib.y + oy) + '" width="' + n2(ib.w) + '" height="' + n2(ib.h) +
          '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + id + ')" xlink:href="' + xml(im.src) + '"/>' +
          rect({ x: ib.x + 0.5, y: ib.y + 0.5, w: ib.w - 1, h: ib.h - 1 }, ox, oy, 5.5, ' fill="none" stroke="' + pal.line + '" stroke-width="1"');
      });
      box.tasks.forEach(function (tk) {
        var tb = tk.box;
        var inset = { x: tb.x + 0.75, y: tb.y + 0.75, w: tb.w - 1.5, h: tb.h - 1.5 };
        if (tk.checked) {
          out += rect(inset, ox, oy, 3.25, ' fill="' + pal.accent + '" stroke="' + pal.accent + '" stroke-width="1.5"');
          out += '<path d="M' + n2(ox + tb.x + tb.w * 0.26) + ',' + n2(oy + tb.y + tb.h * 0.52) + 'L' + n2(ox + tb.x + tb.w * 0.43) + ',' + n2(oy + tb.y + tb.h * 0.7) +
            'L' + n2(ox + tb.x + tb.w * 0.75) + ',' + n2(oy + tb.y + tb.h * 0.3) + '" fill="none" stroke="' + pal['on-accent'] + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        } else {
          out += rect(inset, ox, oy, 3.25, ' fill="' + pal.raised + '" stroke="' + pal['line-control'] + '" stroke-width="1.5"');
        }
      });
      box.dots.forEach(function (dot) {
        var db = dot.box;
        out += '<circle cx="' + n2(ox + db.x + db.w / 2) + '" cy="' + n2(oy + db.y + db.h / 2) + '" r="' + n2(Math.max(1, db.w / 2 - 0.75)) +
          '" fill="' + over(pal.note, 0.22, pal.paper) + '" stroke="' + pal.note + '" stroke-width="1.5"/>';
      });
      box.texts.forEach(function (tx) { out += textEl(tx, ox, oy, branch, pal, branchText); });
      box.decos.forEach(function (dc) { out += decoEl(dc, ox, oy, branch, pal, branchText); });
      nodes += '<g class="node" data-path="' + xml(d.path) + '">' + out + '</g>';
    });

    var svg = head(w, hgt, pal, fontURL, name, defs) +
      '<g font-family="Montserrat, \'Helvetica Neue\', Arial, sans-serif" xml:space="preserve">' +
      linkLayer + knobs + '<g class="nodes">' + nodes + '</g>' +
      '</g></svg>';
    return { svg: svg, width: w, height: hgt, geometry: { nodes: geo.nodes, bounds: geo.bounds, dx: dx, dy: dy } };
  }

  function rect(b, ox, oy, r, attrs) {
    return '<rect x="' + n2(b.x + ox) + '" y="' + n2(b.y + oy) + '" width="' + n2(Math.max(0, b.w)) + '" height="' + n2(Math.max(0, b.h)) +
      '"' + (r ? ' rx="' + n2(r) + '"' : '') + attrs + '/>';
  }

  /* ---------------------------------------------------------------- formats */

  function markdownText(opts, input) {
    opts = options(opts);
    var text = String((input || requireInput()).text || '');
    var D = ns.doc;
    if (D) {
      if (!opts.notes && typeof D.stripNotes === 'function') text = D.stripNotes(text);
      if (!opts.drawings && typeof D.stripDrawings === 'function') text = D.stripDrawings(text);
    }
    return text;
  }

  function markdown(opts, input) {
    return new Blob([markdownText(opts, requireInput(input))], { type: 'text/markdown;charset=utf-8' });
  }

  async function svg(opts, input) {
    var r = await build(opts, input);
    return new Blob([r.svg], { type: 'image/svg+xml' });
  }

  /* How far a drawing of w x h can be scaled on a canvas every engine
   * draws: 2x, less when a side or the area would pass the limits. */
  function rasterScale(w, hgt) {
    var s = PNG_SCALE;
    s = Math.min(s, CANVAS_SIDE / Math.max(1, w), CANVAS_SIDE / Math.max(1, hgt));
    s = Math.min(s, Math.sqrt(CANVAS_AREA / Math.max(1, w * hgt)));
    return Math.max(0.05, s);
  }

  async function png(opts, input) {
    var r = await build(opts, input);
    var url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
    var img;
    try {
      img = await loadImage(url);
      if (typeof img.decode === 'function') await img.decode().catch(function () {});
    } finally {
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    var scale = rasterScale(r.width, r.height);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(r.width * scale));
    canvas.height = Math.max(1, Math.round(r.height * scale));
    var g = canvas.getContext('2d');
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    var blob = await new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('canvas')); }, 'image/png');
    });
    var bytes = new Uint8Array(await blob.arrayBuffer());
    return new Blob([withPngText(bytes, r.text)], { type: 'image/png' });
  }

  /* The PNG with an iTXt chunk holding `text` (UTF-8, uncompressed) right
   * after IHDR, where every reader looks first. */
  function withPngText(bytes, text) {
    if (bytes.length < 33) return bytes;
    var key = [];
    for (var i = 0; i < PNG_KEY.length; i++) key.push(PNG_KEY.charCodeAt(i));
    var body = new TextEncoder().encode(String(text == null ? '' : text));
    var data = new Uint8Array(key.length + 5 + body.length);
    data.set(key, 0);
    /* null, compression flag 0, method 0, empty language + null, empty translated keyword + null */
    data.set(body, key.length + 5);
    var type = new Uint8Array([105, 84, 88, 116]);   // 'iTXt'
    var crc = ns.zip.crc32(data, ns.zip.crc32(type));
    var chunk = new Uint8Array(12 + data.length);
    var view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(type, 4);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc);
    var ihdrEnd = 8 + 12 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
    var out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, ihdrEnd), 0);
    out.set(chunk, ihdrEnd);
    out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
    return out;
  }

  /* px of the drawing -> mm of the page: 96 dpi, the longest side brought
   * into [297, 5080] mm, both sides scaled together. */
  function pageSize(w, hgt) {
    if (!(w > 0) || !(hgt > 0)) return { w: 297, h: 210 };
    var mw = w * PX_TO_MM;
    var mh = hgt * PX_TO_MM;
    var longest = Math.max(mw, mh);
    var k = longest > PAGE_MAX ? PAGE_MAX / longest : (longest < PAGE_MIN ? PAGE_MIN / longest : 1);
    return { w: Math.round(mw * k * 100) / 100, h: Math.round(mh * k * 100) / 100 };
  }

  var printJob = null;

  function clearPrint() {
    var job = printJob;
    printJob = null;
    if (!job) return;
    if (job.sheet.parentNode) job.sheet.parentNode.removeChild(job.sheet);
    if (job.style.parentNode) job.style.parentNode.removeChild(job.style);
    document.documentElement.removeAttribute('data-printing');
    window.removeEventListener('afterprint', job.after);
    if (job.mq && job.mq.removeEventListener) job.mq.removeEventListener('change', job.onMq);
  }

  /* The drawing in a print-only sheet with the page cut to it. Prints
   * unless opts.print === false (tests print with page.pdf). */
  async function pdf(opts, input) {
    var r = await build(opts, input);
    clearPrint();
    var page = pageSize(r.width, r.height);
    var parsed = new DOMParser().parseFromString(r.svg, 'image/svg+xml');
    var root = parsed.documentElement;
    if (!root || root.nodeName !== 'svg') throw new Error('svg');
    var svgEl = document.importNode(root, true);
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var sheet = document.createElement('div');
    sheet.className = 'xp-print';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.appendChild(svgEl);
    var style = document.createElement('style');
    style.textContent = '@media print{@page{size:' + page.w + 'mm ' + page.h + 'mm;margin:0}}';
    document.head.appendChild(style);
    document.body.appendChild(sheet);
    document.documentElement.setAttribute('data-printing', '');
    var job = { sheet: sheet, style: style, after: null, mq: null, onMq: null };
    job.after = function () { if (printJob === job) clearPrint(); };
    window.addEventListener('afterprint', job.after);
    /* Some mobile browsers never say afterprint: the end of print media does. */
    try {
      job.mq = window.matchMedia('print');
      job.onMq = function (e) { if (!e.matches) setTimeout(job.after, 500); };
      if (job.mq.addEventListener) job.mq.addEventListener('change', job.onMq);
    } catch (err) { job.mq = null; }
    printJob = job;
    var out = { page: page, width: r.width, height: r.height, cleanup: clearPrint };
    if (opts && opts.print === false) return out;
    await new Promise(function (resolve) { setTimeout(resolve, 60); });
    window.print();
    return out;
  }

  /* ---------------------------------------------------------------- clipboard, share, download */

  async function copyText(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* refused (file://, no permission): the old way below */ }
    var host = document.querySelector('dialog[open]') || document.body;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'xp-clip';
    var prev = document.activeElement;
    host.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    host.removeChild(ta);
    try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (err) { /* gone */ }
    return ok;
  }

  async function copyMarkdown(opts, input) {
    var ok = await copyText(markdownText(opts, requireInput(input)));
    toast(ok ? t('export.copied') : t('export.copyFailed'), ok ? null : 'error');
    return ok;
  }

  /* The map's own name, minus what a file system refuses (Windows is the
   * strictest: <>:"/\|?* control characters, trailing dots and spaces,
   * device names). A readable name, not a slug: a PNG dropped back on
   * MindRoot is named after its file, so 'Garden plan.png' comes back as
   * 'Garden plan'. A name with nothing left falls back to its slug, then
   * to 'mindroot'. */
  var UNSAFE_FILE = /[\u0000-\u001f\u007f<>:"\/\\|?*]+/g;
  var DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
  var NAME_MAX = 80;

  function fileBase(name) {
    var s = String(name == null ? '' : name);
    if (s.normalize) s = s.normalize('NFC');
    s = s.replace(UNSAFE_FILE, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    var chars = Array.from(s);
    if (chars.length > NAME_MAX) s = chars.slice(0, NAME_MAX).join('');
    s = s.replace(/[. ]+$/, '');
    if (!s || DEVICE_NAME.test(s)) {
      var slug = ns.util && ns.util.slugify ? ns.util.slugify(name, '') : '';
      return slug && !DEVICE_NAME.test(slug) ? slug : 'mindroot';
    }
    return s;
  }

  function fileName(input, format) {
    return fileBase(input.name) + '.' + EXT[format];
  }

  function canShareFiles() {
    try {
      return !!(navigator.canShare && typeof File === 'function' && navigator.canShare({ files: [new File(['x'], 'x.png', { type: 'image/png' })] }));
    } catch (err) { return false; }
  }

  function blobFor(format, opts, input) {
    if (format === 'svg') return svg(opts, input);
    if (format === 'png') return png(opts, input);
    return Promise.resolve(markdown(opts, input));
  }

  /* The file handed to the system's share sheet (a PDF goes as its PNG:
   * the print dialog cannot be shared). With no share sheet, or one that
   * refuses (the gesture went stale while the picture was drawn), it is
   * downloaded instead; the toasts say which, or why it failed. Resolves
   * true when shared or downloaded, false when cancelled or failed. */
  async function share(format, over, input) {
    var opts = options(Object.assign({}, over || {}, format ? { format: format } : {}));
    format = opts.format === 'pdf' ? 'png' : opts.format;
    try {
      input = requireInput(input);
    } catch (err) {
      toast(t('export.noMap'), 'error');
      return false;
    }
    var waiting = format === 'md' ? null : toast(t('export.working'));
    try {
      var blob = await blobFor(format, opts, input);
      var name = fileName(input, format);
      var file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
      if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: input.name });
          if (waiting && waiting.close) waiting.close();
          return true;
        } catch (err) {
          if (err && err.name === 'AbortError') {
            if (waiting && waiting.close) waiting.close();
            return false;
          }
        }
      }
      await download(blob, name);
      toast(t('export.saved', { file: name }));
      return true;
    } catch (err) {
      if (window.console) console.warn('MindRoot export:', err);
      if (waiting && waiting.close) waiting.close();
      toast(t('export.failed', { message: err && err.message ? err.message : String(err) }), 'error');
      return false;
    }
  }

  function download(blob, name) {
    if (ns.util && typeof ns.util.download === 'function') return Promise.resolve(ns.util.download(blob, name));
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return Promise.resolve(true);
  }

  function toast(text, kind) {
    if (ns.ui && typeof ns.ui.toast === 'function') return ns.ui.toast(text, kind ? { kind: kind } : {});
    return null;
  }

  /* One export, with the toasts that say how it went. */
  async function run(format, over, input) {
    var opts = options(Object.assign({}, over || {}, format ? { format: format } : {}));
    format = opts.format;
    try {
      input = requireInput(input);
    } catch (err) {
      toast(t('export.noMap'), 'error');
      return false;
    }
    var waiting = format === 'md' ? null : toast(t('export.working'));
    try {
      if (format === 'pdf') {
        await pdf(opts, input);
        toast(t('export.printing'));
        return true;
      }
      var blob = await blobFor(format, opts, input);
      var name = fileName(input, format);
      await download(blob, name);
      toast(t('export.saved', { file: name }));
      return true;
    } catch (err) {
      if (window.console) console.warn('MindRoot export:', err);
      if (waiting && waiting.close) waiting.close();
      toast(t('export.failed', { message: err && err.message ? err.message : String(err) }), 'error');
      return false;
    }
  }

  /* ---------------------------------------------------------------- the export sheet */

  var sheetHandle = null;

  function seg(name, items, value, onChange) {
    var h = ns.util.h;
    var group = h('div', { class: 'seg xp-seg', role: 'radiogroup', 'aria-label': t(name) });
    var buttons = items.map(function (it) {
      var b = h('button', { type: 'button', class: 'seg__opt', role: 'radio', 'data-value': it.value, 'aria-checked': String(it.value === value), tabindex: it.value === value ? '0' : '-1' }, it.label);
      b.addEventListener('click', function () { pick(it.value, false); });
      return b;
    });
    function pick(v, focus) {
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-value') === v;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      onChange(v);
    }
    group.addEventListener('keydown', function (e) {
      var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      var i = buttons.findIndex(function (b) { return b.getAttribute('aria-checked') === 'true'; });
      var next = buttons[(i + keys[e.key] + buttons.length) % buttons.length];
      pick(next.getAttribute('data-value'), true);
    });
    buttons.forEach(function (b) { group.appendChild(b); });
    return { el: group, set: function (v) { pick(v, false); } };
  }

  function checkRow(key, value, onChange) {
    var h = ns.util.h;
    var input = h('input', { type: 'checkbox', checked: !!value, 'data-option': key });
    input.addEventListener('change', function () { onChange(input.checked); });
    return h('label', { class: 'check xp-check' }, input, h('span', { text: t('export.' + key) }));
  }

  /* The board's notebook view while the Board face is up, else null. */
  function boardView() {
    var N = ns.notebook;
    try {
      var v = N && typeof N.boardShown === 'function' && N.boardShown() ? N.boardView() : null;
      return v && typeof v.exportAs === 'function' ? v : null;
    } catch (err) { return null; }
  }

  function open() {
    if (!ns.ui || typeof ns.ui.sheet !== 'function') return null;
    if (sheetHandle && sheetHandle.isOpen()) return sheetHandle;
    var input = null;
    try { input = requireInput(); } catch (err) { toast(t('export.noMap'), 'error'); return null; }
    var h = ns.util.h;
    var opts = options();
    var hint = h('p', { class: 'xp-hint', 'aria-live': 'polite' });
    var picture = h('div', { class: 'xp-picture' });
    /* With the board up, what is on the stage is what the sheet offers
     * first; the map stays one choice away. */
    var board = boardView();
    var what = board ? 'board' : 'map';
    var nb = { format: 'pdf', paper: board && typeof board.exportPaper === 'function' ? board.exportPaper() : 'light' };
    var boardPart = null;
    var mapPart = null;
    var foot = {};
    function update() {
      var onBoard = what === 'board' && !!board;
      if (onBoard) {
        var pages = typeof board.mode === 'function' && board.mode() === 'pages';
        var canvases = !pages && typeof board.pages === 'function' && board.pages() > 1;
        hint.textContent = t('export.hint.board.' + nb.format + (pages ? 'Pages' : (canvases ? 'Canvases' : 'Area')));
      } else {
        hint.textContent = t('export.hint.' + opts.format);
      }
      picture.hidden = opts.format === 'md';
      if (boardPart) boardPart.hidden = !onBoard;
      if (mapPart) mapPart.hidden = onBoard;
      if (foot.copy) foot.copy.hidden = onBoard;
      if (foot.share) foot.share.hidden = onBoard;
      remember(opts);
    }
    var formats = seg('export.format', FORMATS.map(function (f) { return { value: f, label: t('export.fmt.' + f) }; }), opts.format, function (v) { opts.format = v; update(); });
    var paper = seg('export.paper', [{ value: 'light', label: t('export.paper.light') }, { value: 'dark', label: t('export.paper.dark') }], opts.paper, function (v) { opts.paper = v; update(); });
    picture.appendChild(checkRow('expand', opts.expand, function (v) { opts.expand = v; update(); }));
    picture.appendChild(h('div', { class: 'xp-row' }, h('span', { class: 'xp-label', text: t('export.paper') }), paper.el));
    mapPart = h('div', { class: 'xp-part xp-part--map' },
      h('div', { class: 'xp-row xp-row--format' }, formats.el),
      checkRow('notes', opts.notes, function (v) { opts.notes = v; update(); }),
      checkRow('drawings', opts.drawings, function (v) { opts.drawings = v; update(); }),
      picture);
    var body = h('div', { class: 'xp-sheet' });
    if (board) {
      var whatSeg = seg('export.what', [{ value: 'board', label: t('export.what.board') }, { value: 'map', label: t('export.what.map') }], what, function (v) { what = v; update(); });
      var nbFormats = seg('export.format', [{ value: 'pdf', label: t('export.fmt.pdf') }, { value: 'png', label: t('export.fmt.png') }], nb.format, function (v) { nb.format = v; update(); });
      var nbPaper = seg('export.paper', [{ value: 'light', label: t('export.paper.light') }, { value: 'dark', label: t('export.paper.dark') }], nb.paper, function (v) { nb.paper = v; update(); });
      boardPart = h('div', { class: 'xp-part xp-part--board' },
        h('div', { class: 'xp-row xp-row--format' }, nbFormats.el),
        h('div', { class: 'xp-row' }, h('span', { class: 'xp-label', text: t('export.paper') }), nbPaper.el));
      body.appendChild(h('div', { class: 'xp-row xp-row--what' }, whatSeg.el));
      body.appendChild(boardPart);
    }
    body.appendChild(mapPart);
    body.appendChild(hint);
    var actions = [{ label: t('export.copy'), icon: 'copy', kind: 'text', id: 'copy', onClick: function () { copyMarkdown(opts, input); } }];
    if (canShareFiles()) {
      actions.push({ label: t('export.share'), icon: 'share', kind: 'text', id: 'share', onClick: function (e, handle) { handle.close('share'); share(opts.format, opts, input); } });
    }
    actions.push({
      label: t('export.run'), icon: 'export', kind: 'primary', id: 'run',
      onClick: function (e, handle) {
        handle.close('run');
        if (what === 'board' && board) board.exportAs(nb.format, nb.paper);
        else run(opts.format, opts, input);
      }
    });
    sheetHandle = ns.ui.sheet({ title: t('export.title'), body: body, actions: actions, cls: 'xp', initialFocus: '.xp-seg [aria-checked="true"]', onClose: function () { sheetHandle = null; } });
    /* The foot's buttons, in the order given: Copy and Share are the map's. */
    var buttons = sheetHandle && sheetHandle.el ? sheetHandle.el.querySelectorAll('.sheet__foot button') : [];
    actions.forEach(function (a, i) { if (buttons[i]) foot[a.id] = buttons[i]; });
    update();
    return sheetHandle;
  }

  /* ---------------------------------------------------------------- commands */

  function hasMap() {
    var S = ns.session;
    try { return !!(S && typeof S.current === 'function' && S.current()); } catch (err) { return false; }
  }

  function registerCommands() {
    var C = ns.commands;
    if (!C) return;
    var kw = t('export.kw');
    C.register({
      id: 'export.open', label: 'export.cmd.open', group: 'file', icon: 'export', keys: ['Mod+Shift+E'], keywords: kw + ' ' + t('export.kw.board'), help: 'export.help.open', when: hasMap,
      title: function () { return t(boardView() ? 'export.cmd.openBoard' : 'export.cmd.open'); },
      run: function () { open(); }
    });
    C.register({ id: 'export.markdown', label: 'export.cmd.markdown', group: 'file', icon: 'markdown', keywords: kw, help: 'export.help.markdown', when: hasMap, run: function () { return run('md'); } });
    C.register({ id: 'export.copyMarkdown', label: 'export.cmd.copyMarkdown', group: 'file', icon: 'copy', keywords: kw + ' ' + t('export.kw.copy'), help: 'export.help.copyMarkdown', when: hasMap, run: function () { return copyMarkdown(); } });
    C.register({ id: 'export.png', label: 'export.cmd.png', group: 'file', icon: 'image', keywords: kw, help: 'export.help.png', when: hasMap, run: function () { return run('png'); } });
    C.register({ id: 'export.svg', label: 'export.cmd.svg', group: 'file', icon: 'download', keywords: kw, help: 'export.help.svg', when: hasMap, run: function () { return run('svg'); } });
    C.register({ id: 'export.pdf', label: 'export.cmd.pdf', group: 'file', icon: 'download', keywords: kw + ' ' + t('export.kw.pdf'), help: 'export.help.pdf', when: hasMap, run: function () { return run('pdf'); } });
  }

  var ready = false;
  function init() {
    if (ready) return;
    ready = true;
    registerCommands();
  }

  ns.exporter = {
    init: init,
    open: open,
    svg: svg,
    png: png,
    pdf: pdf,
    markdown: markdown,
    markdownText: markdownText,
    copyMarkdown: copyMarkdown,
    share: share,
    run: run,
    build: build,
    options: options,
    pageSize: pageSize,
    fileName: fileName,
    withPngText: withPngText,
    rasterScale: rasterScale,
    palette: palette,
    mixOklab: mixOklab,
    ensureFont: ensureFont,
    clearPrint: clearPrint
  };
})(window.MindRoot);
