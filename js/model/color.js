/* MindRoot - colour maths: the branch palette, hex/rgb/hsv, linear-light
 * mixing, contrast, the fade between two branch colours and a random colour
 * that still belongs to the palette's family.
 *
 * Numbers only, no DOM. The map, the Markdown panel and every export ask the
 * same questions here and get the same answers: the automatic colour of a
 * branch is PALETTE[f(index of its first-level branch)], a pure function of
 * the document, instead of the first-come ordinal scale an earlier version
 * shared between maps. The picker panel that lets a person choose a colour is
 * ns.colorpicker; it calls into this file for every conversion. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  /* The seven colours branches are painted with. They are written into
   * people's files (as the colour a dice or a hand chose), so they never
   * change. There is no violet: that hue is reserved for note markers, and a
   * branch that drifted near it would read as a note. */
  var PALETTE = Object.freeze([
    '#2f7d5a', '#c2703d', '#3b6ea5',
    '#b4485f', '#5f8a3f', '#a8843f', '#4a7f8a'
  ]);

  /* Where the note violet sits on the hue wheel (--note is #8a5fbf light,
   * #b389e0 dark: 267 and 269 degrees). Random colours keep away from it. */
  var NOTE_HUE = 268;
  var NOTE_GAP = 30;

  /* The edge between two differently coloured nodes fades over its middle
   * half: the parent's colour for the first quarter, the child's for the
   * last, so it reads as a passage rather than as a seam. */
  var FADE_FROM = 0.24;
  var FADE_TO = 0.76;

  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  function mod(value, by) { return ((value % by) + by) % by; }

  /* One shape for a colour wherever it is written down: '#' and six
   * lowercase digits, so comparing two colours is comparing two strings.
   * Three-digit hexes are read (files are written by hand) and grown. */
  function normalizeHex(value) {
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value == null ? '' : value).trim());
    if (!hex) return null;
    var d = hex[1].toLowerCase();
    if (d.length === 3) d = d[0] + d[0] + d[1] + d[1] + d[2] + d[2];
    return '#' + d;
  }

  function parseHex(value) {
    var clean = normalizeHex(value);
    if (!clean) return null;
    return {
      r: parseInt(clean.slice(1, 3), 16),
      g: parseInt(clean.slice(3, 5), 16),
      b: parseInt(clean.slice(5, 7), 16)
    };
  }

  function toHex(rgb) {
    function part(v) {
      var n = Math.round(clamp(Number(v) || 0, 0, 255));
      return (n < 16 ? '0' : '') + n.toString(16);
    }
    return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
  }

  /* Accepts a hex string or an {r,g,b} object: most callers hold one or the
   * other, and asking them to convert first is noise. */
  function asRgb(color) {
    if (color && typeof color === 'object' && 'r' in color) return color;
    return parseHex(color);
  }

  function rgbToHsv(rgb) {
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: max ? d / max : 0, v: max };
  }

  function hsvToRgb(value) {
    var h = mod(Number(value.h) || 0, 360) / 60;
    var s = clamp(Number(value.s) || 0, 0, 1);
    var v = clamp(Number(value.v) || 0, 0, 1) * 255;
    var i = Math.floor(h);
    var f = h - i;
    var p = v * (1 - s);
    var q = v * (1 - s * f);
    var t = v * (1 - s * (1 - f));
    var table = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
    var out = table[i % 6];
    return { r: out[0], g: out[1], b: out[2] };
  }

  /* Hex in, hsv out (and back): the two the picker's gradient works in. */
  function hsv(color) {
    var rgb = asRgb(color);
    return rgb ? rgbToHsv(rgb) : null;
  }

  function fromHsv(value) { return toHex(hsvToRgb(value)); }

  function rgbText(color) {
    var rgb = asRgb(color);
    return rgb ? 'rgb(' + Math.round(rgb.r) + ', ' + Math.round(rgb.g) + ', ' + Math.round(rgb.b) + ')' : '';
  }

  function hslToRgb(h, s, l) {
    h = mod(h, 360) / 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    if (!s) return { r: l * 255, g: l * 255, b: l * 255 };
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function channel(t) {
      t = mod(t, 1);
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
  }

  /* Anything a person might paste into a colour field: '#abc', 'abc',
   * '#aabbcc', 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', '1 2 3', '1,2,3',
   * 'hsl(150 45% 34%)'. Three bare hex digits ('123') are a hex, as they
   * always were; numbers with separators between them are rgb. */
  function parseColor(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    if (/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) {
      return normalizeHex(text.charAt(0) === '#' ? text : '#' + text);
    }
    var numbers = text.match(/-?\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length < 3) return null;
    if (/^hsla?\s*\(/i.test(text)) {
      return toHex(hslToRgb(Number(numbers[0]), Number(numbers[1]) / 100, Number(numbers[2]) / 100));
    }
    return toHex({ r: Number(numbers[0]), g: Number(numbers[1]), b: Number(numbers[2]) });
  }

  /* The automatic colour of a branch. -1 is the root, which takes the first
   * colour - the MindRoot green - and branch i takes the colour after it, so
   * a map with one root always opens green with its branches in palette
   * order, whatever was opened before it. */
  function paletteFor(branchIndex) {
    var i = Math.floor(Number(branchIndex));
    if (!isFinite(i)) i = -1;
    return PALETTE[mod(i + 1, PALETTE.length)];
  }

  /* Between two colours, mixed where light adds up rather than where the
   * digits do: a green and a red meet at the colour between them instead of
   * a brown. Gamma 2.2 rather than the exact sRGB curve, on purpose: it is
   * what an earlier version drew, and exported maps should not shift. A missing
   * colour on one side gives the other one back. */
  function mixLinear(a, b, amount) {
    var from = asRgb(a);
    var to = asRgb(b);
    if (!from || !to) return from ? toHex(from) : (to ? toHex(to) : null);
    var t = amount == null ? 0.5 : clamp(Number(amount) || 0, 0, 1);
    function channel(x, y) {
      var lx = Math.pow(x / 255, 2.2);
      var ly = Math.pow(y / 255, 2.2);
      return Math.pow(lx + (ly - lx) * t, 1 / 2.2) * 255;
    }
    return toHex({ r: channel(from.r, to.r), g: channel(from.g, to.g), b: channel(from.b, to.b) });
  }

  /* What the eye reads as light, weighed the way WCAG weighs it. */
  function luminance(color) {
    var rgb = asRgb(color);
    if (!rgb) return 0;
    function channel(value) {
      var x = clamp(value, 0, 255) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  /* The WCAG contrast ratio, 1 to 21. */
  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    var hi = Math.max(la, lb);
    var lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Which of two text colours reads better on a background: white or ink by
   * default, the pair can be passed in (a theme's own paper and ink). */
  function readableOn(background, light, dark) {
    var on = light || '#ffffff';
    var off = dark || '#15171c';
    return contrast(background, on) >= contrast(background, off) ? on : off;
  }

  function hueDistance(a, b) {
    var d = Math.abs(mod(a, 360) - mod(b, 360));
    return Math.min(d, 360 - d);
  }

  /* Five stops for the fade along an edge, from the parent's colour to the
   * child's. Plain data: the map writes them into an SVG gradient, the
   * export into its own. */
  function fadeStops(from, to) {
    var a = normalizeHex(from) || normalizeHex(to);
    var b = normalizeHex(to) || a;
    if (!a) return [];
    return [
      { offset: 0, color: a },
      { offset: FADE_FROM, color: a },
      { offset: 0.5, color: mixLinear(a, b, 0.5) },
      { offset: FADE_TO, color: b },
      { offset: 1, color: b }
    ];
  }

  /* Whether two colours differ enough to be worth a gradient at all. */
  function needsFade(from, to) {
    var a = normalizeHex(from);
    var b = normalizeHex(to);
    return !!(a && b && a !== b);
  }

  /* ---------- a colour drawn at random ---------- */

  /* Chance on its own comes out ugly: three free numbers are as likely to be
   * a near-black or a fluorescent yellow as anything a map can be read in.
   * So only the hue is really free. Saturation is drawn inside the narrow
   * band the seven of the palette keep to, and the lightness is solved for:
   * hsv's value is not lightness (green weighs seven times what blue does), so
   * a relative luminance is drawn in the palette's band and the value that
   * lands on it found by halving, twelve times over. A colour drawn this way
   * sits beside the seven at the same weight.
   *
   * The hue keeps away from the note violet, from the colour drawn last (a
   * promise: it is taken from the arcs that are far enough, not drawn and
   * checked) and, as far as a few tries allow, from the three before it. */
  var RANDOM_SAT = [0.48, 0.68];
  var RANDOM_LUM = [0.15, 0.25];
  var RANDOM_GAP = 45;
  var RANDOM_TRIES = 24;
  var HALVINGS = 12;
  var REMEMBERED = 4;
  var sessionHues = [];

  function valueFor(hue, sat, wanted) {
    var low = 0;
    var high = 1;
    for (var i = 0; i < HALVINGS; i++) {
      var mid = (low + high) / 2;
      if (luminance(hsvToRgb({ h: hue, s: sat, v: mid })) < wanted) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  /* The circle as a list of [from, to) arcs, minus the arc [centre - gap,
   * centre + gap]. */
  function cutArc(arcs, centre, gap) {
    var start = mod(centre - gap, 360);
    var cuts = start + 2 * gap <= 360 ? [[start, start + 2 * gap]] : [[start, 360], [0, start + 2 * gap - 360]];
    var out = arcs;
    for (var c = 0; c < cuts.length; c++) {
      var next = [];
      for (var k = 0; k < out.length; k++) {
        var arc = out[k];
        var cut = cuts[c];
        if (cut[1] <= arc[0] || cut[0] >= arc[1]) { next.push(arc); continue; }
        if (cut[0] > arc[0]) next.push([arc[0], cut[0]]);
        if (cut[1] < arc[1]) next.push([cut[1], arc[1]]);
      }
      out = next;
    }
    return out;
  }

  function sampleArcs(arcs, rnd) {
    var total = 0;
    for (var k = 0; k < arcs.length; k++) total += arcs[k][1] - arcs[k][0];
    var r = rnd() * total;
    for (k = 0; k < arcs.length; k++) {
      var len = arcs[k][1] - arcs[k][0];
      if (r < len) return arcs[k][0] + r;
      r -= len;
    }
    return arcs.length ? arcs[arcs.length - 1][1] - 1e-6 : 0;
  }

  function hueOfEntry(item) {
    if (typeof item === 'number' && isFinite(item)) return mod(item, 360);
    var rgb = asRgb(item);
    if (!rgb) return null;
    var value = rgbToHsv(rgb);
    return value.s ? value.h : null;
  }

  function pickHue(recent, rnd) {
    var arcs = cutArc([[0, 360]], NOTE_HUE, NOTE_GAP);
    var last = recent.length ? recent[recent.length - 1] : null;
    if (last !== null) arcs = cutArc(arcs, last, RANDOM_GAP);
    function farEnough(hue) {
      for (var i = 0; i < recent.length; i++) {
        if (hueDistance(hue, recent[i]) < RANDOM_GAP) return false;
      }
      return true;
    }
    var hue = sampleArcs(arcs, rnd);
    for (var tries = 0; tries < RANDOM_TRIES && !farEnough(hue); tries++) hue = sampleArcs(arcs, rnd);
    return hue;
  }

  /* recent: the colours (hex) or hues to keep away from, oldest first; the
   * last one is the promise. Left out, the colours this function handed out
   * in this session are used. rnd: a Math.random stand-in, for tests. */
  function randomColor(recent, rnd) {
    var random = typeof rnd === 'function' ? rnd : Math.random;
    var source = Array.isArray(recent) ? recent : sessionHues;
    var hues = [];
    for (var i = Math.max(0, source.length - REMEMBERED); i < source.length; i++) {
      var h = hueOfEntry(source[i]);
      if (h !== null) hues.push(h);
    }
    var hue = pickHue(hues, random);
    sessionHues.push(hue);
    if (sessionHues.length > REMEMBERED) sessionHues.shift();
    var sat = RANDOM_SAT[0] + random() * (RANDOM_SAT[1] - RANDOM_SAT[0]);
    var want = RANDOM_LUM[0] + random() * (RANDOM_LUM[1] - RANDOM_LUM[0]);
    return toHex(hsvToRgb({ h: hue, s: sat, v: valueFor(hue, sat, want) }));
  }

  ns.colors = {
    PALETTE: PALETTE,
    palette: PALETTE,
    NOTE_HUE: NOTE_HUE,
    FADE_FROM: FADE_FROM,
    FADE_TO: FADE_TO,
    RANDOM_SAT: RANDOM_SAT,
    RANDOM_LUM: RANDOM_LUM,
    paletteFor: paletteFor,
    normalizeHex: normalizeHex,
    parseHex: parseHex,
    toRgb: parseHex,
    toHex: toHex,
    rgbToHsv: rgbToHsv,
    hsvToRgb: hsvToRgb,
    hsv: hsv,
    fromHsv: fromHsv,
    rgbText: rgbText,
    parse: parseColor,
    parseColor: parseColor,
    mixLinear: mixLinear,
    mix: mixLinear,
    luminance: luminance,
    contrast: contrast,
    readableOn: readableOn,
    hueDistance: hueDistance,
    fadeStops: fadeStops,
    needsFade: needsFade,
    randomColor: randomColor,
    random: randomColor
  };
})(window.MindRoot);
