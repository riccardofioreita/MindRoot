/* MindRoot - colour maths (ns.colors): the palette, conversions, linear-light
 * mixing, contrast, the edge fade and the random colour. The picker's own
 * behaviour is tested with the picker. */
(function () {
  'use strict';

  var C = window.MindRoot.colors;

  /* A seeded stand-in for Math.random, so every run draws the same colours. */
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  T.test('the palette is the one written in people\'s files', function () {
    T.same(Array.prototype.slice.call(C.PALETTE), ['#2f7d5a', '#c2703d', '#3b6ea5', '#b4485f', '#5f8a3f', '#a8843f', '#4a7f8a'], 'seven colours, unchanged');
    T.ok(Object.isFrozen(C.PALETTE), 'and frozen');
    T.eq(C.palette, C.PALETTE, 'the old name still answers');
    T.eq(C.paletteFor(-1), '#2f7d5a', 'the root is the MindRoot green');
    T.eq(C.paletteFor(0), '#c2703d', 'branch 0 the next one');
    T.eq(C.paletteFor(5), '#4a7f8a', 'branch 5 the last');
    T.eq(C.paletteFor(6), '#2f7d5a', 'then it wraps');
    T.eq(C.paletteFor(13), C.paletteFor(6), 'every seven');
    T.eq(C.paletteFor(-8), C.paletteFor(-1), 'negative indexes wrap too');
    T.eq(C.paletteFor('x'), C.paletteFor(-1), 'nonsense is the root colour');
    T.eq(C.paletteFor(2.7), C.paletteFor(2), 'fractions floor');
  });

  T.test('no branch colour sits near the note violet', function () {
    ['#8a5fbf', '#b389e0'].forEach(function (note) {
      var noteHue = C.hsv(note).h;
      C.PALETTE.forEach(function (c) {
        T.ok(C.hueDistance(C.hsv(c).h, noteHue) >= 30, c + ' is far from ' + note);
      });
    });
  });

  T.test('hex, rgb, hsv', function () {
    T.eq(C.normalizeHex('#ABC'), '#aabbcc', '3 digits grow to 6');
    T.eq(C.normalizeHex(' #C2703D '), '#c2703d', 'lowercase, trimmed');
    T.eq(C.normalizeHex('c2703d'), null, 'a hex needs its #');
    T.eq(C.normalizeHex('#12345'), null, 'five digits are no colour');
    T.eq(C.normalizeHex(null), null, 'nothing is no colour');
    T.same(C.parseHex('#c2703d'), { r: 194, g: 112, b: 61 }, 'parseHex');
    T.eq(C.toRgb, C.parseHex, 'toRgb is parseHex');
    T.eq(C.parseHex('red'), null, 'names are not hex');
    T.eq(C.toHex({ r: 194, g: 112, b: 61 }), '#c2703d', 'toHex');
    T.eq(C.toHex({ r: -5, g: 300, b: 15.6 }), '#00ff10', 'clamped and rounded');
    C.PALETTE.forEach(function (c) {
      T.eq(C.fromHsv(C.hsv(c)), c, 'hsv round trip ' + c);
      T.eq(C.toHex(C.hsvToRgb(C.rgbToHsv(C.parseHex(c)))), c, 'rgb/hsv round trip ' + c);
    });
    T.same(C.hsv('#ff0000'), { h: 0, s: 1, v: 1 }, 'red');
    T.same(C.hsv('#00ff00'), { h: 120, s: 1, v: 1 }, 'green');
    T.same(C.hsv('#808080'), { h: 0, s: 0, v: 128 / 255 }, 'grey has no hue');
    T.eq(C.fromHsv({ h: 360 + 240, s: 1, v: 1 }), '#0000ff', 'hue wraps');
    T.eq(C.hsv('nope'), null, 'nothing to convert');
    T.eq(C.rgbText('#c2703d'), 'rgb(194, 112, 61)', 'rgbText');
    T.eq(C.rgbText('x'), '', 'rgbText of nothing');
  });

  T.test('parse what a person pastes', function () {
    var cases = [
      ['#abc', '#aabbcc'], ['abc', '#aabbcc'], ['#AABBCC', '#aabbcc'], ['aabbcc', '#aabbcc'],
      ['rgb(1, 2, 3)', '#010203'], ['rgba(1,2,3,.5)', '#010203'], ['1 2 3', '#010203'], ['1,2,3', '#010203'],
      ['300, -4, 12.6', '#ff000d'], ['123', '#112233'], ['hsl(0, 100%, 50%)', '#ff0000'], ['hsl(120 100% 25%)', '#008000'],
      ['', null], ['red', null], ['1 2', null], [null, null]
    ];
    cases.forEach(function (c) { T.eq(C.parse(c[0]), c[1], JSON.stringify(c[0])); });
    T.eq(C.parseColor, C.parse, 'parseColor is parse');
  });

  T.test('mixing in linear light', function () {
    T.eq(C.mixLinear('#000000', '#ffffff', 0.5), '#bababa', 'black and white meet above the arithmetic grey');
    T.eq(C.mixLinear('#ff0000', '#00ff00'), '#baba00', 'red and green meet in yellow, not brown');
    T.eq(C.mixLinear('#2f7d5a', '#c2703d', 0), '#2f7d5a', 't = 0 is the first');
    T.eq(C.mixLinear('#2f7d5a', '#c2703d', 1), '#c2703d', 't = 1 is the second');
    T.eq(C.mixLinear('#2f7d5a', '#c2703d', 7), '#c2703d', 't is clamped');
    T.eq(C.mixLinear(null, '#c2703d'), '#c2703d', 'one colour missing gives the other');
    T.eq(C.mixLinear('#2f7d5a', 'nope'), '#2f7d5a', 'either way');
    T.eq(C.mixLinear(null, null), null, 'none gives none');
    T.eq(C.mix, C.mixLinear, 'mix is mixLinear');
  });

  T.test('contrast and readable text', function () {
    T.ok(Math.abs(C.contrast('#000000', '#ffffff') - 21) < 1e-9, 'black on white is 21:1');
    T.eq(C.contrast('#777777', '#777777'), 1, 'a colour on itself is 1:1');
    T.eq(C.contrast('#2f7d5a', '#ffffff'), C.contrast('#ffffff', '#2f7d5a'), 'symmetric');
    T.ok(C.contrast('#2f7d5a', '#ffffff') >= 4.5, 'white on the accent passes AA');
    T.eq(C.readableOn('#2f7d5a'), '#ffffff', 'white on green');
    T.eq(C.readableOn('#f5e6a8'), '#15171c', 'ink on a pale colour');
    T.eq(C.readableOn('#1e1e1e', '#fafafa', '#000000'), '#fafafa', 'with a pair of its own');
    /* Two palette colours sit mid-way (#5f8a3f, #4a7f8a reach 4.43 and 4.47
     * at best): readableOn takes the better of the two, which is always at
     * least 4:1 on the palette - over the 3:1 asked of large text and UI. */
    C.PALETTE.forEach(function (c) {
      var chosen = C.contrast(c, C.readableOn(c));
      T.ok(chosen >= C.contrast(c, '#ffffff') && chosen >= C.contrast(c, '#15171c'), 'the better text colour on ' + c);
      T.ok(chosen >= 4, 'at least 4:1 on ' + c + ' (' + chosen.toFixed(2) + ')');
    });
    T.ok(Math.abs(C.luminance('#ffffff') - 1) < 1e-9 && C.luminance('#000000') === 0, 'luminance ends');
  });

  T.test('the fade along an edge', function () {
    var stops = C.fadeStops('#2f7d5a', '#c2703d');
    T.same(stops.map(function (s) { return s.offset; }), [0, 0.24, 0.5, 0.76, 1], 'five stops, as the old export drew them');
    T.same(stops.map(function (s) { return s.color; }), ['#2f7d5a', '#2f7d5a', C.mixLinear('#2f7d5a', '#c2703d', 0.5), '#c2703d', '#c2703d'], 'from, mix, to');
    T.same(C.fadeStops('#ABC', null).map(function (s) { return s.color; }), ['#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc'], 'one colour missing: a plain one');
    T.same(C.fadeStops(null, null), [], 'none: no stops');
    T.eq(C.needsFade('#2f7d5a', '#c2703d'), true, 'two colours need a fade');
    T.eq(C.needsFade('#2F7D5A', '#2f7d5a'), false, 'one colour does not');
    T.eq(C.needsFade('#2f7d5a', null), false, 'nor a missing one');
  });

  T.test('a random colour belongs to the palette\'s family', function () {
    var random = rng(7);
    var recent = [];
    var lastHue = null;
    var problems = [];
    for (var i = 0; i < 400; i++) {
      var c = C.randomColor(recent, random);
      var v = C.hsv(c);
      var lum = C.luminance(c);
      if (!/^#[0-9a-f]{6}$/.test(c)) problems.push('not a hex: ' + c);
      if (v.s < 0.46 || v.s > 0.70) problems.push(c + ' saturation ' + v.s.toFixed(2));
      if (lum < 0.14 || lum > 0.26) problems.push(c + ' luminance ' + lum.toFixed(3));
      if (C.hueDistance(v.h, C.NOTE_HUE) < 29) problems.push(c + ' too near the note violet');
      if (lastHue !== null && C.hueDistance(v.h, lastHue) < 44) problems.push(c + ' too near the one before');
      lastHue = v.h;
      recent.push(c);
      if (recent.length > 4) recent.shift();
    }
    T.same(problems.slice(0, 5), [], '400 colours: saturation and luminance in band, away from notes and from the last');
  });

  T.test('random colours spread and keep away from the recent ones when they can', function () {
    var random = rng(99);
    var near = 0;
    var recent = [];
    var buckets = {};
    for (var i = 0; i < 300; i++) {
      var c = C.randomColor(recent, random);
      var h = C.hsv(c).h;
      buckets[Math.floor(h / 60)] = true;
      recent.forEach(function (r) { if (C.hueDistance(h, C.hsv(r).h) < 45) near++; });
      recent.push(c);
      if (recent.length > 4) recent.shift();
    }
    T.ok(Object.keys(buckets).length >= 5, 'hues all round the wheel (' + Object.keys(buckets).length + ' sextants)');
    T.ok(near < 30, 'rarely near any of the four recent ones (' + near + ' of 900)');
    var a = C.randomColor([], rng(3));
    var b = C.randomColor([], rng(3));
    T.eq(a, b, 'the same seed draws the same colour');
    T.ok(/^#[0-9a-f]{6}$/.test(C.randomColor()), 'without arguments it draws from Math.random and remembers on its own');
    T.eq(C.random, C.randomColor, 'random is randomColor');
    T.ok(/^#[0-9a-f]{6}$/.test(C.randomColor([12, '#2f7d5a', 'nonsense', null], rng(5))), 'hues and hexes mixed, junk ignored');
  });
})();
