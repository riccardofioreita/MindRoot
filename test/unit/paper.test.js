/* MindRoot - paper: catalogue, sizes, the geometry of every paper on a
 * page, colours and their contrast, theming of saved pages, strings. */
(function () {
  'use strict';
  var P = window.MindRoot.paper;
  var H = window.PaperTest;
  var MM = 96 / 25.4;
  var A4 = { w: 210 * MM, h: 297 * MM };

  function page(type, opts) {
    var o = { mode: 'page', w: A4.w, h: A4.h, print: true };
    for (var k in opts || {}) o[k] = opts[k];
    return P.patternSvg(typeof type === 'string' ? { type: type } : type, o);
  }
  function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.02 : tol); }
  function ys(frag, cls) { return H.uniqueSorted(H.segs(frag, 'h', cls).map(function (s) { return s.y1; })); }
  function xs(frag, cls) { return H.uniqueSorted(H.segs(frag, 'v', cls).map(function (s) { return s.x1; })); }

  /* ---------------------------------------------------------------- catalogue */

  T.test('catalogue lists every paper of docs/NOTEBOOK.md, grouped', function () {
    var want = {
      base: ['blank', 'dots', 'grid-4', 'grid-5', 'grid-10', 'ruled-narrow', 'ruled', 'ruled-wide', 'ruled-margin'],
      school: ['school-1', 'school-2', 'cornell', 'two-columns'],
      science: ['millimetre', 'semilog', 'log-log', 'polar', 'isometric', 'honeycomb', 'cartesian'],
      music: ['staff', 'grand-staff', 'guitar-tab'],
      design: ['grid-8pt', 'wireframe-phone', 'wireframe-browser', 'storyboard'],
      planning: ['weekly', 'todo'],
      calligraphy: ['calligraphy'],
      'import': ['image']
    };
    T.same(P.GROUPS.map(function (g) { return g.id; }), Object.keys(want), 'groups in order');
    Object.keys(want).forEach(function (g) {
      T.same(P.CATALOG.filter(function (e) { return e.group === g; }).map(function (e) { return e.id; }), want[g], 'papers of ' + g);
    });
    P.CATALOG.forEach(function (e) {
      T.eq(e.label, 'paper.type.' + e.id, 'label key ' + e.id);
      T.ok(e.params && typeof e.params === 'object', 'params ' + e.id);
      T.ok(Object.isFrozen(e), 'frozen ' + e.id);
    });
    T.eq(P.entry('dots').params.step, 5, 'dots 5 mm');
    T.eq(P.entry('nope'), null, 'unknown entry');
  });

  T.test('normalize: catalogue params, numeric overrides only, unknown type is blank', function () {
    T.same(P.normalize({ type: 'grid-5' }), { type: 'grid-5', params: { step: 5 } }, 'plain');
    T.same(P.normalize({ type: 'grid-5', step: 7 }).params.step, 7, 'override');
    T.same(P.normalize({ type: 'grid-5', step: 'x', evil: 3 }).params, { step: 5 }, 'junk ignored');
    T.same(P.normalize({ type: 'grid-5', step: -1 }).params.step, 5, 'negative ignored');
    T.eq(P.normalize({ type: 'future-paper' }).type, 'blank', 'unknown');
    T.eq(P.normalize('dots').type, 'dots', 'string');
    T.eq(P.normalize(null).type, 'blank', 'null');
  });

  /* ---------------------------------------------------------------- sizes */

  T.test('sizes: real dimensions, orientation, custom clamped', function () {
    var ids = P.SIZES.map(function (s) { return s.id; });
    T.same(ids, ['a3', 'a4', 'a5', 'a6', 'b5', 'letter', 'legal', 'square', 'wide', 'standard', 'ipad', 'custom'], 'ids');
    T.ok(near(P.MM, 3.7795, 0.0001), 'MM');
    var a4 = P.pageSize({ id: 'a4' });
    T.ok(near(a4.w, 793.7, 0.01) && near(a4.h, 1122.52, 0.01), 'A4 px ' + JSON.stringify(a4));
    var a4l = P.pageSize({ id: 'a4', orientation: 'landscape' });
    T.ok(near(a4l.w, a4.h) && near(a4l.h, a4.w), 'A4 landscape swaps');
    var letter = P.pageSize({ id: 'letter' });
    T.ok(near(letter.w, 816) && near(letter.h, 1056), 'Letter is 8.5 x 11 in');
    var legal = P.pageSize('legal');
    T.ok(near(legal.h, 1344), 'Legal is 14 in');
    var a3 = P.normalizeSize({ id: 'a3' });
    T.same([a3.w, a3.h], [297, 420], 'A3 mm');
    T.same([P.normalizeSize('a5').w, P.normalizeSize('a5').h], [148, 210], 'A5');
    T.same([P.normalizeSize('a6').w, P.normalizeSize('a6').h], [105, 148], 'A6');
    T.same([P.normalizeSize('b5').w, P.normalizeSize('b5').h], [176, 250], 'B5');
    var wide = P.normalizeSize({ id: 'wide' });
    T.eq(wide.orientation, 'landscape', '16:9 defaults to landscape');
    T.ok(near(wide.w / wide.h, 16 / 9, 0.002), '16:9 ratio');
    var std = P.normalizeSize({ id: 'standard' });
    T.ok(near(std.w / std.h, 4 / 3, 0.002), '4:3 ratio');
    var wideP = P.normalizeSize({ id: 'wide', orientation: 'portrait' });
    T.ok(wideP.h > wideP.w, '16:9 portrait');
    var sq = P.normalizeSize({ id: 'square', orientation: 'landscape' });
    T.eq(sq.w, sq.h, 'square stays square');
    var fake = P.normalizeSize({ id: 'a4', w: 999, h: 5 });
    T.same([fake.w, fake.h], [210, 297], 'a known id keeps its own size');
    var custom = P.normalizeSize({ id: 'custom', w: 100, h: 60 });
    T.same([custom.w, custom.h, custom.orientation], [100, 60, 'landscape'], 'custom keeps its shape');
    var customP = P.normalizeSize({ id: 'custom', w: 100, h: 60, orientation: 'portrait' });
    T.same([customP.w, customP.h], [60, 100], 'custom portrait');
    var tiny = P.normalizeSize({ id: 'custom', w: 1, h: 99999 });
    T.same([tiny.w, tiny.h], [20, 2000], 'custom clamped');
    T.eq(P.normalizeSize({ id: 'what', w: 'x' }).id, 'custom', 'unknown id is custom');
    T.eq(P.sizeLabel('a4'), 'A4', 'label');
  });

  /* ---------------------------------------------------------------- geometry */

  T.test('squares: 4, 5 and 10 mm squares, centred on the page', function () {
    [4, 5, 10].forEach(function (mm) {
      var f = page('grid-' + mm);
      var vx = xs(f);
      var hy = ys(f);
      T.ok(H.allNear(H.diffs(vx), mm * MM), mm + ' mm vertical spacing');
      T.ok(H.allNear(H.diffs(hy), mm * MM), mm + ' mm horizontal spacing');
      T.ok(near(vx[0], A4.w - vx[vx.length - 1], 0.03), mm + ' mm centred across');
      T.ok(near(hy[0], A4.h - hy[hy.length - 1], 0.03), mm + ' mm centred down');
      T.ok(vx[0] >= -0.01 && vx[vx.length - 1] <= A4.w + 0.01, 'inside the page');
    });
    T.eq(xs(page('grid-5')).length, 43, '43 vertical lines on A4 at 5 mm (0..210)');
    T.eq(ys(page('grid-5')).length, 60, '60 horizontal lines (1..296 mm)');
  });

  T.test('dots: a 5 mm pattern, no dot on the edge', function () {
    var root = H.parse(page('dots'));
    var pat = root.getElementsByTagName('pattern')[0];
    T.ok(pat, 'a pattern');
    T.ok(near(parseFloat(pat.getAttribute('width')), 5 * MM), 'tile 5 mm');
    T.eq(pat.getAttribute('patternUnits'), 'userSpaceOnUse', 'anchored in page units');
    var c = pat.getElementsByTagName('circle')[0];
    var s = 5 * MM;
    var firstDot = parseFloat(pat.getAttribute('x')) + parseFloat(c.getAttribute('cx'));
    var off = ((firstDot % s) + s) % s;
    T.ok(off >= s * 0.4 - 0.01, 'first dot at least 40% of a step from the left edge: ' + off);
    T.eq(c.getAttribute('class'), 'mr-strong', 'dots are themeable');
    var rect = root.querySelector('rect[fill^="url(#"]');
    T.ok(rect && rect.getAttribute('fill') === 'url(#' + pat.getAttribute('id') + ')', 'filled with the pattern');
  });

  T.test('ruled: 1/4", 9/32" and 11/32" lines from a top margin', function () {
    [['ruled-narrow', 6.35], ['ruled', 7.1], ['ruled-wide', 8.7]].forEach(function (pair) {
      var hy = ys(page(pair[0]));
      T.ok(H.allNear(H.diffs(hy), pair[1] * MM), pair[0] + ' spacing');
      T.ok(near(hy[0], 22 * MM), pair[0] + ' first line at 22 mm');
      T.ok(hy[hy.length - 1] <= A4.h - 12 * MM + 0.01, pair[0] + ' bottom margin');
      T.ok(hy[hy.length - 1] > A4.h - 12 * MM - pair[1] * MM, pair[0] + ' goes down to it');
    });
    var f = page('ruled-margin');
    var m = xs(f, 'mr-margin');
    T.same(m.length, 1, 'one margin line');
    T.ok(near(m[0], 25 * MM), 'margin at 25 mm');
    var seg = H.segs(f, 'v', 'mr-margin')[0];
    T.ok(near(seg.y1, 0) && near(seg.y2, A4.h), 'margin runs the whole page');
  });

  T.test('first- and second-grade lines', function () {
    var f1 = page('school-1');
    var thin = ys(f1, 'mr-line');
    var base = ys(f1, 'mr-strong');
    T.ok(H.allNear(H.diffs(thin), 15 * MM), 'first: rows every 15 mm');
    T.ok(H.allNear(H.diffs(base), 15 * MM), 'first: baselines every 15 mm');
    T.ok(near(base[0] - thin[0], 10 * MM), 'first: 10 mm band');
    var f2 = page('school-2');
    var lines = ys(f2);
    var asc = ys(f2, 'mr-line');
    var body = ys(f2, 'mr-strong');
    T.ok(H.allNear(H.diffs(asc), 13 * MM), 'second: rows every 13 mm');
    T.eq(body.length, asc.length * 2, 'second: two body lines per row');
    T.ok(near(body[0] - asc[0], 5 * MM), 'second: ascender space 5 mm');
    T.ok(near(body[1] - body[0], 4 * MM), 'second: body 4 mm');
    T.ok(near(asc[1] - body[1], 4 * MM), 'second: descender 4 mm');
    T.ok(lines.length === asc.length * 3, 'three lines per row');
  });

  T.test('Cornell and two columns', function () {
    var f = page('cornell');
    var cue = xs(f, 'mr-strong');
    T.same(cue.length, 1, 'one cue line');
    T.ok(near(cue[0], 63.5 * MM), 'cue column 2.5 in');
    var strongY = ys(f, 'mr-strong');
    T.ok(near(strongY[0], 25 * MM), 'title band 25 mm');
    T.ok(near(strongY[1], A4.h - 50.8 * MM), 'summary 2 in');
    T.ok(H.allNear(H.diffs(ys(f, 'mr-line').filter(function (y) { return y < strongY[1]; })), 7.1 * MM), 'ruled notes');
    var small = page('cornell', { w: 105 * MM, h: 148 * MM });
    T.ok(near(xs(small, 'mr-strong')[0], 105 * MM * 0.32), 'A6: cue column a third of the width');
    var two = page('two-columns');
    T.ok(near(xs(two, 'mr-strong')[0], A4.w / 2), 'a line down the middle');
  });

  T.test('graph paper: 1, 5 and 10 mm in whole centimetres', function () {
    var f = page('millimetre');
    var fine = xs(f, 'mr-line');
    var strong = xs(f, 'mr-strong');
    T.ok(H.allNear(H.diffs(strong), 10 * MM), 'cm lines');
    var all = H.uniqueSorted(fine.concat(strong));
    T.ok(H.allNear(H.diffs(all), MM), 'every mm');
    T.eq(strong.length, 20, '19 cm across an A4 inside 10 mm margins: 20 lines');
    T.ok(near(strong[0], A4.w - strong[strong.length - 1], 0.03), 'centred');
    /* The three families must look different: each line's look is its
     * class and stroke width, and the 1, 5 and 10 mm lines have one look
     * each, three in all. */
    var look = {};
    H.segs(f, 'v').forEach(function (s) {
      var i = Math.round((s.x1 - strong[0]) / MM);
      var fam = i % 10 === 0 ? 10 : (i % 5 === 0 ? 5 : 1);
      (look[fam] = look[fam] || {})[s.cls + ' ' + s.width] = true;
    });
    [1, 5, 10].forEach(function (fam) { T.eq(Object.keys(look[fam] || {}).length, 1, 'one look for the ' + fam + ' mm lines'); });
    var looks = [1, 5, 10].map(function (fam) { return Object.keys(look[fam] || {})[0]; });
    T.ok(looks[0] !== looks[1] && looks[1] !== looks[2] && looks[0] !== looks[2], 'three different weights: ' + looks.join(' | '));
    var wOf = function (l) { return parseFloat(l.split(' ')[1]); };
    T.ok(wOf(looks[0]) < wOf(looks[1]) && wOf(looks[1]) < wOf(looks[2]), 'heavier as the family gets coarser');
  });

  T.test('semi-log and log-log: decades at log positions', function () {
    var f = page('semilog');
    var decades = ys(f, 'mr-strong');
    T.eq(decades.length, 4, 'three decades on A4: four decade lines');
    var D = decades[1] - decades[0];
    T.ok(H.allNear(H.diffs(decades), D, 0.03), 'equal decades');
    var bottom = decades[decades.length - 1];
    var main = ys(f, 'mr-line');
    [2, 3, 5, 9].forEach(function (v) {
      var want = bottom - D * Math.log10(v);
      T.ok(main.some(function (y) { return near(y, want, 0.03); }), 'value ' + v + ' at log position');
    });
    T.ok(main.some(function (y) { return near(y, bottom - D * Math.log10(1.5), 0.03); }), 'subdivision 1.5');
    var labels = H.texts(f).map(function (t) { return t.text; });
    T.eq(labels.filter(function (s) { return s === '1'; }).length, 4, 'decade labels 1');
    T.eq(labels.filter(function (s) { return s === '5'; }).length, 3, 'digit 5 once per decade');
    var vx = xs(f, 'mr-line');
    T.ok(H.allNear(H.diffs(vx).filter(function (d) { return d > 0.5; }), 2 * MM, 0.03), 'linear axis in 2 mm');

    var g = page('log-log');
    var dx = xs(g, 'mr-strong');
    var dy = ys(g, 'mr-strong');
    T.eq(dx.length, 3, 'two decades across');
    T.eq(dy.length, 4, 'three decades down');
    var Dx = dx[1] - dx[0];
    var mx = xs(g, 'mr-line');
    T.ok(mx.some(function (x) { return near(x, dx[0] + Dx * Math.log10(2), 0.03); }), 'x value 2');
    T.ok(mx.some(function (x) { return near(x, dx[0] + Dx * Math.log10(7), 0.03); }), 'x value 7');
  });

  T.test('polar: rings every 5 mm, rays every 15 degrees', function () {
    var f = page('polar');
    var circles = [];
    H.paths(f).forEach(function (p) { p.circles.forEach(function (c) { circles.push(c); }); });
    var radii = H.uniqueSorted(circles.map(function (c) { return c.r; }));
    T.ok(H.allNear(H.diffs(radii), 5 * MM, 0.03), 'rings 5 mm apart');
    T.ok(circles.every(function (c) { return near(c.cx, A4.w / 2, 0.03) && near(c.cy, A4.h / 2, 0.03); }), 'centred');
    T.ok(near(radii[radii.length - 1], 90 * MM, 0.03), 'outer ring 90 mm on A4');
    var rays = H.segs(f, 'l');
    T.eq(rays.length, 24, '24 rays');
    var angles = H.uniqueSorted(rays.map(function (s) {
      var a = Math.atan2(-(s.y2 - s.y1), s.x2 - s.x1) * 180 / Math.PI;
      return Math.round(((a % 360) + 360) % 360 * 100) / 100;
    }), 0.05);
    T.ok(H.allNear(H.diffs(angles), 15, 0.05), 'every 15 degrees: ' + angles.join(','));
    T.eq(rays.filter(function (s) { return s.cls === 'mr-strong'; }).length, 4, 'four axis rays stronger');
    T.ok(H.texts(f).some(function (t) { return t.text === '90°'; }), 'degrees written');
  });

  T.test('isometric: three families meeting in 60 degree triangles', function () {
    var f = page('isometric');
    var all = H.segs(f, 'l');
    var vertical = H.uniqueSorted(all.filter(function (s) { return Math.abs(s.x2 - s.x1) < 0.02; }).map(function (s) { return s.x1; }));
    var side = 5 * MM;
    T.ok(H.allNear(H.diffs(vertical), side * Math.sqrt(3) / 2, 0.03), 'vertical lines side*sqrt3/2 apart');
    var slants = all.filter(function (s) { return Math.abs(s.x2 - s.x1) >= 0.02 && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 20; });
    var slopes = H.uniqueSorted(slants.map(function (s) { return Math.round((s.y2 - s.y1) / (s.x2 - s.x1) * 1000) / 1000; }), 0.01);
    T.same(slopes.length, 2, 'two slanted families');
    T.ok(near(Math.abs(slopes[0]), Math.tan(Math.PI / 6), 0.01) && near(Math.abs(slopes[1]), Math.tan(Math.PI / 6), 0.01), 'at 30 degrees: ' + slopes);
    /* Lines through the page centre in all three families meet there. */
    var cx = A4.w / 2;
    var cy = A4.h / 2;
    T.ok(vertical.some(function (x) { return near(x, cx, 0.03); }), 'a vertical through the centre');
    var through = slants.filter(function (s) {
      var t = (cx - s.x1) / (s.x2 - s.x1);
      return t >= 0 && t <= 1 && near(s.y1 + t * (s.y2 - s.y1), cy, 0.05);
    });
    T.eq(through.length, 2, 'both slants through the centre');
  });

  T.test('honeycomb: a hexagon tile of the right size', function () {
    var root = H.parse(page('honeycomb'));
    var pat = root.getElementsByTagName('pattern')[0];
    T.ok(near(parseFloat(pat.getAttribute('width')), 15 * MM, 0.02), 'three sides wide');
    T.ok(near(parseFloat(pat.getAttribute('height')), 5 * Math.sqrt(3) * MM, 0.02), 'sqrt3 sides tall');
    var segs = H.paths(root.getElementsByTagName('pattern')[0].outerHTML.replace(/<\/?pattern[^>]*>/g, ''))[0].segs;
    var lens = H.uniqueSorted(segs.map(function (s) { return Math.hypot(s.x2 - s.x1, s.y2 - s.y1); }), 0.03);
    T.same(lens.length, 1, 'every edge one length');
    T.ok(near(lens[0], 5 * MM, 0.03), 'side 5 mm');
  });

  T.test('cartesian axes: arrows, a tick and a number every centimetre', function () {
    var f = page('cartesian');
    var cy = A4.h / 2;
    var cx = A4.w / 2;
    var axes = H.segs(f, 'h', 'mr-strong').filter(function (s) { return Math.abs(s.x2 - s.x1) > 100; });
    T.eq(axes.length, 1, 'one x axis');
    T.ok(near(axes[0].y1, cy, 0.03), 'x axis through the centre');
    var grid = xs(f, 'mr-line');
    T.ok(H.allNear(H.diffs(grid), 5 * MM, 0.03), '5 mm grid');
    var ticks = H.segs(f, 'v', 'mr-strong').filter(function (s) { return Math.abs(s.y2 - s.y1) < 10; });
    var tx = H.uniqueSorted(ticks.map(function (s) { return s.x1; }));
    T.ok(H.allNear(H.diffs(tx).filter(function (d) { return d < 50; }), 10 * MM, 0.03), 'ticks every cm');
    var heads = H.paths(f).filter(function (p) { return p.filled && p.cls === 'mr-strong'; });
    T.eq(heads.length, 2, 'two arrow heads');
    var labels = H.texts(f).map(function (t) { return t.text; });
    ['1', '-1', '9', 'x', 'y', 'O'].forEach(function (s) { T.ok(labels.indexOf(s) >= 0, 'label ' + s); });
    T.ok(near(xs(f, 'mr-strong').filter(function (x) { return near(x, cx, 0.03); })[0], cx, 0.03), 'y axis through the centre');
  });

  T.test('music: staff of 5 lines, grand staff with brace, tab of 6 lines', function () {
    var f = page('staff');
    var lines = ys(f, 'mr-strong');
    T.eq(lines.length % 5, 0, 'staves of five');
    var first = lines.slice(0, 5);
    T.ok(H.allNear(H.diffs(first), 2.25 * MM, 0.03), 'staff lines 2.25 mm apart');
    T.ok(near(lines[5] - lines[0], 22 * MM, 0.03), 'staves 22 mm apart');
    T.ok(lines.length / 5 >= 10, 'ten staves or more on A4: ' + lines.length / 5);
    var seg = H.segs(f, 'h', 'mr-strong')[0];
    T.ok(near(seg.x1, 15 * MM) && near(seg.x2, A4.w - 15 * MM), 'within side margins');

    var g = page('grand-staff');
    var gl = ys(g, 'mr-strong');
    T.eq(gl.length % 10, 0, 'systems of ten lines');
    T.ok(near(gl[5] - gl[4], 11 * MM, 0.03), 'gap between treble and bass');
    var braces = H.paths(g).filter(function (p) { return p.filled; });
    T.eq(braces.length, gl.length / 10, 'one brace per system');
    T.ok(braces.every(function (b) { return b.segs.filter(function (s) { return s.kind === 'c'; }).length === 4; }), 'brace of four curves');

    var tab = page('guitar-tab');
    var tl = ys(tab, 'mr-strong');
    T.eq(tl.length % 6, 0, 'six strings');
    T.ok(H.allNear(H.diffs(tl.slice(0, 6)), 3 * MM, 0.03), 'strings 3 mm apart');
    var letters = H.texts(tab).map(function (t) { return t.text; }).join('');
    T.eq(letters.slice(0, 3), 'TAB', 'TAB at the start of a stave');
  });

  T.test('8 pt grid: 8 px with a stronger line every 64 px from the corner', function () {
    var f = page('grid-8pt');
    var fine = xs(f, 'mr-line');
    T.ok(H.allNear(H.diffs(fine), 8), 'every 8 px');
    T.ok(near(fine[0], 0), 'anchored at the page corner');
    var seg = H.segs(f, 'v', 'mr-line');
    var heavy = H.uniqueSorted(seg.filter(function (s) { return near(s.x1 % 64, 0) || near(s.x1 % 64, 64); }).map(function (s) { return s.width; }));
    var light = H.uniqueSorted(seg.filter(function (s) { return !near(s.x1 % 64, 0) && !near(s.x1 % 64, 64); }).map(function (s) { return s.width; }));
    T.ok(heavy[0] > light[0], 'major lines heavier');
  });

  T.test('wireframes and storyboard', function () {
    function frames(f) {
      return H.paths(f).filter(function (p) { return p.cls === 'mr-strong' && p.width > 1 && p.width < 2 && p.segs.length; })
        .reduce(function (n, p) { return n + p.segs.filter(function (s) { return s.kind === 'h'; }).length / 2; }, 0);
    }
    T.eq(frames(page('wireframe-phone')), 4, 'four phones on a portrait A4');
    T.eq(frames(page('wireframe-phone', { w: A4.h, h: A4.w })), 3, 'three on a landscape A4');
    var phone = H.paths(page('wireframe-phone')).filter(function (p) { return p.cls === 'mr-strong' && p.width > 1 && p.width < 2; })[0];
    var arcs = phone.segs.filter(function (s) { return s.kind === 'a'; });
    T.eq(arcs.length, 16, 'four rounded corners per phone');
    var pill = H.paths(page('wireframe-phone')).filter(function (p) { return p.width > 2; });
    T.eq(pill.length, 1, 'home bars');
    T.eq(pill[0].segs.length, 4, 'one per phone');
    T.eq(frames(page('wireframe-browser')), 2, 'two browser windows on a portrait A4');
    var sb = page('storyboard');
    T.same(H.texts(sb).map(function (t) { return t.text; }), ['1', '2', '3', '4', '5', '6'], 'six numbered frames');
    var land = page('storyboard', { w: A4.h, h: A4.w });
    T.eq(H.texts(land).length % 3, 0, 'three across on landscape');
  });

  T.test('weekly planner and to-do list', function () {
    var f = page('weekly');
    var labels = H.texts(f).map(function (t) { return t.text; });
    T.same(labels, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Notes'], 'days, Monday first, and notes');
    window.MindRoot.i18n.setLang('it');
    var it = H.texts(page('weekly')).map(function (t) { return t.text; });
    window.MindRoot.i18n.setLang('en');
    T.same(it, ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica', 'Note'], 'in Italian');
    var td = page('todo');
    var boxes = H.paths(td).filter(function (p) { return p.cls === 'mr-strong'; });
    var lines = ys(td, 'mr-line');
    var boxCount = (boxes.reduce(function (n, p) { return n + p.segs.filter(function (s) { return s.kind === 'h'; }).length; }, 0) - 1) / 2;
    T.eq(boxCount, lines.length, 'a box for every line');
    T.ok(H.allNear(H.diffs(lines), 9 * MM, 0.03), 'rows 9 mm apart');
  });

  T.test('calligraphy: 3:2:3 rows and 55 degree slants', function () {
    var f = page('calligraphy');
    var strong = ys(f, 'mr-strong');
    T.ok(near(strong[1] - strong[0], 5 * MM, 0.03), 'x-height 5 mm');
    var thin = ys(f, 'mr-line');
    T.ok(near(strong[0] - thin[0], 7.5 * MM, 0.03), 'ascender 7.5 mm');
    T.ok(near(thin[1] - strong[1], 7.5 * MM, 0.03), 'descender 7.5 mm');
    var left = 12 * MM;
    var right = A4.w - 12 * MM;
    var slants = H.segs(f, 'l').filter(function (s) { return Math.min(s.x1, s.x2) > left + 0.05 && Math.max(s.x1, s.x2) < right - 0.05; });
    T.ok(slants.length > 100, 'slant lines');
    var angles = H.uniqueSorted(slants.map(function (s) { return Math.round(Math.atan2(Math.abs(s.y2 - s.y1), Math.abs(s.x2 - s.x1)) * 180 / Math.PI * 10) / 10; }), 0.2);
    T.same(angles, [55], '55 degrees');
    T.ok(slants.every(function (s) {
      var lo = Math.min(s.y1, s.y2);
      var hi = Math.max(s.y1, s.y2);
      return thin.some(function (y) { return near(y, lo, 0.05); }) && thin.some(function (y) { return near(y, hi, 0.05); });
    }), 'slants span a row, ascender to descender');
  });

  T.test('blank and imported: only the sheet', function () {
    ['blank', 'image'].forEach(function (id) {
      var root = H.parse(page(id));
      T.eq(root.getElementsByTagName('path').length, 0, id + ': no lines');
      var sheet = root.querySelector('rect.mr-sheet');
      T.ok(sheet && sheet.getAttribute('fill') === '#fbfaf7', id + ': light sheet');
    });
    var none = H.parse(P.patternSvg({ type: 'grid-5' }, { w: 100, h: 100, sheet: false }));
    T.eq(none.querySelector('rect.mr-sheet'), null, 'sheet: false');
    var offset = P.patternSvg({ type: 'grid-5' }, { mode: 'page', x: 50, y: 1000, w: A4.w, h: A4.h });
    var ox = xs(offset);
    T.ok(near(ox[0], 50 + (xs(page('grid-5'))[0])), 'page at an offset keeps its layout');
  });

  /* ---------------------------------------------------------------- colours */

  T.test('colours: calm lines that stay visible, readable ink', function () {
    ['light', 'dark'].forEach(function (theme) {
      var c = P.colors(theme, 'auto');
      ['sheet', 'line', 'strongLine', 'margin', 'ink', 'text'].forEach(function (k) { T.ok(/^#[0-9a-f]{6}$/.test(c[k]), theme + ' ' + k + ' hex'); });
      var line = P.contrast(c.sheet, c.line);
      var strong = P.contrast(c.sheet, c.strongLine);
      T.ok(line >= 1.35 && line <= 1.8, theme + ' line visible but quiet: ' + line.toFixed(2));
      T.ok(strong >= 1.9 && strong <= 3 && strong > line, theme + ' strong line: ' + strong.toFixed(2));
      T.ok(P.contrast(c.sheet, c.margin) >= 1.9, theme + ' margin');
      T.ok(P.contrast(c.sheet, c.ink) >= 12, theme + ' ink');
      T.ok(P.contrast(c.sheet, c.text) >= 4, theme + ' labels');
      T.eq(c.background, 'auto', theme + ' auto');
    });
    T.eq(P.colors('light').sheet, '#fbfaf7', 'light sheet is ink paper');
    T.eq(P.colors('system').sheet, '#fbfaf7', 'unknown theme is light');
    T.ok(P.colors('dark').dark && !P.colors('light').dark, 'dark flag');
    T.ok(P.colors('dark').sheet !== '#131519', 'dark sheet stands off the app background');
  });

  T.test('custom background: derived lines visible on any colour', function () {
    var seed = 12345;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var samples = ['#ffffff', '#000000', '#808080', '#777777', '#c0392b', '#fff3b0', '#1e3a5f', '#2f7d5a', '#ff00ff', '#00ff00', '#0000ff'];
    for (var i = 0; i < 200; i++) samples.push('#' + ('00000' + Math.floor(rnd() * 0xffffff).toString(16)).slice(-6));
    var bad = [];
    samples.forEach(function (bg) {
      var c = P.colors('light', bg);
      if (c.sheet !== bg) bad.push(bg + ' sheet');
      var line = P.contrast(c.sheet, c.line);
      var strong = P.contrast(c.sheet, c.strongLine);
      if (line < 1.35 || line > 1.6) bad.push(bg + ' line ' + line.toFixed(2));
      if (strong < 1.9 || strong <= line) bad.push(bg + ' strong ' + strong.toFixed(2));
      if (P.contrast(c.sheet, c.margin) < 1.9) bad.push(bg + ' margin');
      if (P.contrast(c.sheet, c.ink) < 4.5) bad.push(bg + ' ink ' + P.contrast(c.sheet, c.ink).toFixed(2));
      if (P.contrast(c.sheet, c.text) < 3.8) bad.push(bg + ' text');
    });
    T.same(bad, [], 'every background: ' + samples.length);
    T.eq(P.colors('dark', '#FFF').sheet, '#ffffff', 'short hex, theme ignored');
    T.eq(P.colors('dark', 'red').sheet, P.colors('dark').sheet, 'invalid colour means automatic');
    T.eq(P.colors('light', '#fff3b0').margin.length, 7, 'margin hex');
    var yellow = P.colors('light', '#fff3b0');
    var r = parseInt(yellow.margin.slice(1, 3), 16);
    var b = parseInt(yellow.margin.slice(5, 7), 16);
    T.ok(r > b, 'the margin stays reddish where it can');
  });

  T.test('patternSvg uses the theme, background and colour overrides', function () {
    var dark = H.parse(page('grid-5', { theme: 'dark' }));
    T.eq(dark.querySelector('rect.mr-sheet').getAttribute('fill'), P.colors('dark').sheet, 'dark sheet');
    T.eq(dark.querySelector('path.mr-line').getAttribute('stroke'), P.colors('dark').line, 'dark lines');
    var custom = H.parse(page('grid-5', { background: '#fff3b0' }));
    T.eq(custom.querySelector('rect.mr-sheet').getAttribute('fill'), '#fff3b0', 'custom sheet');
    var over = H.parse(page('grid-5', { colors: { line: '#123456', sheet: 'nonsense' } }));
    T.eq(over.querySelector('path.mr-line').getAttribute('stroke'), '#123456', 'override');
    T.eq(over.querySelector('rect.mr-sheet').getAttribute('fill'), '#fbfaf7', 'invalid override ignored');
  });

  /* ---------------------------------------------------------------- themeSvg */

  T.test('themeSvg recolours mr-ink, mr-sheet and paper lines, nothing else', function () {
    var light = P.colors('light');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<metadata id="mindroot-ink">{"note":"&lt;path class=\\"mr-ink\\" stroke=\\"#15171c\\"/&gt;"}</metadata>' +
      '<rect class="mr-sheet" x="0" y="0" width="100" height="100" fill="#fbfaf7"/>' +
      P.patternSvg({ type: 'grid-5' }, { w: 100, h: 100, sheet: false }) +
      '<path class="mr-ink" d="M0 0L10 10" fill="none" stroke="#15171c" stroke-width="2"/>' +
      '<path class="ink-stroke mr-ink" d="M0 0L10 10Z" fill="#15171c"/>' +
      '<text class="mr-ink" style="fill: #15171c; font-size: 12px" x="1" y="2">a &lt; b</text>' +
      '<path d="M1 1L2 2" stroke="#ff0000" fill="none"/>' +
      '<path class="mr-ink" stroke=\'#15171c\' fill="url(#g)"/>' +
      '</svg>';
    T.eq(P.themeSvg(svg, 'light', 'auto'), svg, 'light with automatic background: unchanged');
    var dark = P.themeSvg(svg, 'dark', 'auto');
    var c = P.colors('dark');
    var doc = new DOMParser().parseFromString(dark, 'image/svg+xml');
    T.eq(doc.getElementsByTagName('parsererror').length, 0, 'still XML');
    T.eq(doc.querySelector('rect.mr-sheet').getAttribute('fill'), c.sheet, 'sheet');
    var inks = doc.querySelectorAll('.mr-ink');
    T.eq(inks[0].getAttribute('stroke'), c.ink, 'stroke ink');
    T.eq(inks[0].getAttribute('fill'), 'none', 'fill none kept');
    T.eq(inks[1].getAttribute('fill'), c.ink, 'filled ink (class among others)');
    T.ok(/fill: ?#e4e6ea/.test(inks[2].getAttribute('style')) && /font-size: 12px/.test(inks[2].getAttribute('style')), 'inline style: ' + inks[2].getAttribute('style'));
    T.eq(inks[2].textContent, 'a < b', 'text untouched');
    T.eq(inks[3].getAttribute('stroke'), c.ink, 'single quotes');
    T.eq(inks[3].getAttribute('fill'), 'url(#g)', 'references kept');
    T.eq(doc.querySelector('path:not([class])').getAttribute('stroke'), '#ff0000', 'literal colours kept');
    T.eq(doc.querySelector('path.mr-line').getAttribute('stroke'), c.line, 'paper lines');
    T.ok(dark.indexOf('{"note":"&lt;path class=\\"mr-ink\\" stroke=\\"#15171c\\"/&gt;"}') > 0, 'metadata untouched');
    var custom = P.themeSvg(svg, 'light', '#1e3a5f');
    var cc = P.colors('light', '#1e3a5f');
    var d2 = new DOMParser().parseFromString(custom, 'image/svg+xml');
    T.eq(d2.querySelector('rect.mr-sheet').getAttribute('fill'), '#1e3a5f', 'custom sheet');
    T.eq(d2.querySelector('path.mr-ink').getAttribute('stroke'), cc.ink, 'ink readable on it');
    T.ok(light.ink !== cc.ink, 'a dark custom sheet makes the ink light');
    T.eq(P.themeSvg('', 'dark'), '', 'empty');
    T.eq(P.themeSvg(null, 'dark'), '', 'null');
  });

  /* ---------------------------------------------------------------- strings */

  T.test('strings in Italian and English, Italian copy rules', function () {
    var i18n = window.MindRoot.i18n;
    var keys = [];
    P.CATALOG.forEach(function (e) { keys.push(e.label); });
    P.GROUPS.forEach(function (g) { keys.push(g.label); });
    P.SIZES.forEach(function (s) { keys.push(s.label); });
    keys.push('paper.portrait', 'paper.landscape', 'paper.background.auto', 'paper.notes', 'paper.import.unsupported', 'paper.import.tooBig', 'paper.import.invalid', 'paper.import.empty');
    for (var d = 1; d <= 7; d++) keys.push('paper.day.' + d);
    var it = i18n.keys('it');
    var en = i18n.keys('en');
    var paperIt = it.filter(function (k) { return k.indexOf('paper.') === 0; });
    var paperEn = en.filter(function (k) { return k.indexOf('paper.') === 0; });
    T.same(paperIt, paperEn, 'same keys in both languages');
    keys.forEach(function (k) { T.ok(it.indexOf(k) >= 0 && en.indexOf(k) >= 0, 'has ' + k); });
    i18n.setLang('it');
    var bad = paperIt.filter(function (k) {
      var s = i18n.t(k);
      return /!|—|[\u{1F300}-\u{1FAFF}☀-➿]/u.test(s) || (s.charAt(0) !== s.charAt(0).toUpperCase() && !/^\d/.test(s) && s !== 'iPad');
    });
    T.same(bad, [], 'no exclamation, em-dash or emoji; sentence case');
    T.eq(P.label('grid-5'), 'Quadretti 5 mm', 'Italian label');
    T.eq(P.groupLabel('science'), 'Matematica e scienze', 'Italian group');
    i18n.setLang('en');
    T.eq(P.label('honeycomb'), 'Honeycomb', 'English label');
    T.eq(P.label('nope'), 'Blank', 'unknown label');
  });
})();
