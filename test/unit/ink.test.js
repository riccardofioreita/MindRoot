/* ink: the drawing engine without a hand on it.
 *
 * The freehand outline (perfect-freehand, reimplemented), the box and the
 * hit-testing every tool shares, the eraser's geometry ported from the old
 * app with its checks (an earlier eraser suite, G1-G5: cut, whole stroke,
 * area, one gesture one result), the file format both ways (round trip,
 * escaping, characters XML refuses, hostile files, an old Excalidraw
 * drawing becoming the locked background, files that are damaged, newer or
 * unreadable, a malformed file repaired from its scene), and the editor's
 * dirty tracking, debounced saves, failing saves on Done and on close,
 * announcements and keys, driven by synthetic pointer and key events. Real
 * input (mouse, pen pressure, pinch) is the e2e suites'. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var ink = ns.ink;
  var E = ink.engine;
  var S = window.INK_SAMPLES;

  function near(a, b, within) { return Math.abs(a - b) <= within; }

  function line(x1, y1, x2, y2, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
    return pts;
  }

  /* A pen stroke across the page at height y, from x 300 to 700, every 20. */
  function stroke(id, y, extra) {
    var pts = [];
    for (var i = 0; i <= 20; i++) pts.push([300 + i * 20, y, extra && extra.ramp ? i / 20 : 0.5]);
    var pen = E.penPreset('pen');
    return E.makeStroke(pts, {
      id: id, pen: 'pen', color: '#1f2328', size: 3, opacity: 1, thinning: pen.thinning,
      smoothing: pen.smoothing, streamline: pen.streamline, cap: true, sim: !(extra && extra.ramp)
    });
  }

  function rect(id, x, y, w, h, fill) {
    return E.makeShape('rect', [x, y], [x + w, y + h], { id: id, color: '#1f2328', width: 4, fill: fill || 'none' });
  }

  function ids(list) { return list.map(function (el) { return el.id; }); }
  function strokes(list) { return list.filter(function (el) { return el.type === 'stroke'; }); }

  /* ---------------------------------------------------------------- strings */

  T.test('every ink string exists in Italian and English', function () {
    var it = ns.i18n.keys('it').filter(function (k) { return k.indexOf('ink.') === 0; });
    var en = ns.i18n.keys('en').filter(function (k) { return k.indexOf('ink.') === 0; });
    T.ok(en.length > 60, 'the strings are registered');
    T.same(it, en, 'same keys in both languages');
    var bad = it.filter(function (k) {
      ns.i18n.init('it');
      var text = ns.i18n.t(k);
      return /!|—|[\u{1F300}-\u{1FAFF}]/u.test(text);
    });
    ns.i18n.init('en');
    T.same(bad, [], 'Italian copy: no exclamation marks, em-dashes or emoji');
  });

  /* ---------------------------------------------------------------- freehand */

  T.test('freehand: empty input and a single point', function () {
    T.same(E.strokeOutline([], { size: 8 }), [], 'nothing in, nothing out');
    var dot = E.strokeOutline([[50, 50, 0.5]], { size: 10, thinning: 0, last: true });
    T.ok(dot.length >= 10, 'a tap is a dot: a ring of points (' + dot.length + ')');
    var off = dot.map(function (p) { return Math.sqrt(Math.pow(p[0] - 50, 2) + Math.pow(p[1] - 50, 2)); });
    T.ok(off.every(function (d) { return d > 3.5 && d < 7; }), 'round the point, at about the radius');
  });

  T.test('freehand: a straight line is as wide as the nib', function () {
    var pts = line(0, 100, 300, 100, 60).map(function (p) { return [p[0], p[1], 0.5]; });
    var poly = E.strokeOutline(pts, { size: 10, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last: true });
    var mid = poly.filter(function (p) { return p[0] > 50 && p[0] < 250; });
    var top = Math.min.apply(null, mid.map(function (p) { return p[1]; }));
    var bottom = Math.max.apply(null, mid.map(function (p) { return p[1]; }));
    T.ok(near(top, 95, 0.05) && near(bottom, 105, 0.05), 'half the nib on each side: ' + top.toFixed(2) + '..' + bottom.toFixed(2));
    var xs = poly.map(function (p) { return p[0]; });
    T.ok(near(Math.max.apply(null, xs), 305, 0.5), 'the round cap reaches half a nib past the end');
    T.ok(near(Math.min.apply(null, xs), -5, 0.5), 'and before the start');
  });

  function halfWidth(pressure, opts) {
    var pts = line(0, 100, 300, 100, 60).map(function (p) { return [p[0], p[1], pressure]; });
    var o = { size: 10, thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last: true };
    for (var k in opts || {}) o[k] = opts[k];
    var poly = E.strokeOutline(pts, o);
    var mid = poly.filter(function (p) { return p[0] > 100 && p[0] < 200; });
    return Math.max.apply(null, mid.map(function (p) { return Math.abs(p[1] - 100); }));
  }

  T.test('freehand: thinning follows the pressure', function () {
    var light = halfWidth(0.2);
    var mid = halfWidth(0.5);
    var hard = halfWidth(1);
    T.ok(light < mid && mid < hard, 'harder is wider: ' + [light, mid, hard].map(function (n) { return n.toFixed(2); }).join(' < '));
    T.ok(near(mid, 5, 0.05), 'mid pressure is the nominal nib');
    T.ok(near(hard, 8, 0.05), 'full pressure with thinning .6 is 1.6 times the nib');
    T.ok(near(halfWidth(0.2, { thinning: 0 }), 5, 0.05), 'no thinning: the pressure does not matter');
  });

  T.test('freehand: simulated pressure makes a fast line thinner', function () {
    function width(step) {
      var n = Math.round(300 / step);
      var pts = line(0, 100, 300, 100, n).map(function (p) { return [p[0], p[1], 0.5]; });
      var poly = E.strokeOutline(pts, { size: 8, thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: true, last: true });
      var mid = poly.filter(function (p) { return p[0] > 100 && p[0] < 200; });
      return Math.max.apply(null, mid.map(function (p) { return Math.abs(p[1] - 100); }));
    }
    var slow = width(1);
    var fast = width(25);
    T.ok(fast < slow, 'fast ' + fast.toFixed(2) + ' thinner than slow ' + slow.toFixed(2));
  });

  T.test('freehand: streamline pulls the line behind the hand, and a finished stroke ends where the hand did', function () {
    var pts = [[0, 0, 0.5], [40, 0, 0.5], [80, 0, 0.5], [120, 0, 0.5]];
    var loose = E.strokePoints(pts, { size: 4, streamline: 0.9, last: false });
    var tight = E.strokePoints(pts, { size: 4, streamline: 0.1, last: false });
    T.ok(loose[loose.length - 1].point[0] < tight[tight.length - 1].point[0], 'more streamline, more lag');
    var done = E.strokePoints(pts, { size: 4, streamline: 0.9, last: true });
    T.same(done[done.length - 1].point, [120, 0], 'last: the final point is the real one');
  });

  T.test('freehand: the compact T path draws exactly the curves of one Q per vertex', function () {
    var poly = E.strokeOutline(line(0, 0, 200, 80, 30).map(function (p, i) { return [p[0], p[1] + Math.sin(i / 3) * 10, 0.5]; }), { size: 8, thinning: 0.5, last: true });
    var full = 'M' + poly[0][0] + ' ' + poly[0][1];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i];
      var b = poly[(i + 1) % poly.length];
      full += 'Q' + a[0] + ' ' + a[1] + ' ' + (a[0] + b[0]) / 2 + ' ' + (a[1] + b[1]) / 2;
    }
    full += 'Z';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);
    var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    var p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p1.setAttribute('d', full);
    p2.setAttribute('d', E.outlinePath(poly));
    svg.appendChild(p1);
    svg.appendChild(p2);
    var l1 = p1.getTotalLength();
    var l2 = p2.getTotalLength();
    T.ok(Math.abs(l1 - l2) < 0.5, 'the same length (' + l1.toFixed(2) + ' / ' + l2.toFixed(2) + ')');
    var worst = 0;
    for (var k = 0; k <= 40; k++) {
      var q1 = p1.getPointAtLength(l1 * k / 40);
      var q2 = p2.getPointAtLength(l2 * k / 40);
      worst = Math.max(worst, Math.hypot(q1.x - q2.x, q1.y - q2.y));
    }
    T.ok(worst < 0.1, 'the same points along it (worst ' + worst.toFixed(3) + ')');
    var counts = (E.outlinePath(poly).match(/-?[\d.]+/g) || []).length;
    T.eq(counts, 2 * poly.length + 4, 'two numbers a vertex');
    svg.remove();
  });

  T.test('freehand: the outline as one compact path', function () {
    var poly = E.strokeOutline(line(0, 0, 100, 40, 20).map(function (p) { return [p[0], p[1], 0.5]; }), { size: 6, last: true });
    var d = E.outlinePath(poly);
    T.ok(/^M-?[\d.]+ -?[\d.]+Q/.test(d), 'starts with a move and a curve');
    T.ok(/Z$/.test(d), 'closed');
    T.ok(!/\d\.\d{3}/.test(d), 'two decimals at most');
    T.eq(E.outlinePath([]), '', 'nothing for nothing');
  });

  /* ---------------------------------------------------------------- boxes */

  T.test('boxes: ink included', function () {
    var a = stroke('a', 100);
    var b = E.boundsOf(a);
    var reach = 3 * (0.5 + 0.5 * a.thinning) + 0.5;
    T.ok(near(b[0], 300 - reach, 1e-9) && near(b[2], 700 + reach, 1e-9) && near(b[1], 100 - reach, 1e-9), 'a stroke: its points plus the widest the nib can go');
    T.same(E.boundsOf(rect('r', 10, 20, 100, 50)), [8, 18, 112, 72], 'a rectangle: half its line outside');
    var arrow = E.makeShape('arrow', [0, 0], [100, 0], { color: '#000000', width: 2 });
    var ab = E.boundsOf(arrow);
    T.ok(ab[1] < -5 && ab[3] > 5, 'an arrow: its head counts');
    var text = E.makeText(10, 10, 'hello\nworld', { size: 20, color: '#000000' });
    T.same(E.boundsOf(text).slice(0, 2), [10, 10], 'text: its box');
    T.ok(near(text.h, 2 * 20 * 1.25, 1e-9), 'two lines at the line height');
    T.eq(E.contentBox([], null), null, 'an empty sheet has no box');
  });

  /* ---------------------------------------------------------------- G1: hit-testing */

  T.test('G1 hit-testing, as the eraser and a tap see it', function () {
    var hollow = rect('h', 0, 0, 100, 100);
    var full = rect('f', 0, 0, 100, 100, 'soft');
    var oval = E.makeShape('ellipse', [0, 0], [100, 60], { color: '#000000', width: 2, fill: 'none' });
    var kite = E.makeShape('diamond', [0, 0], [100, 100], { color: '#000000', width: 2, fill: 'none' });
    var words = E.makeText(0, 0, 'words', { size: 20, color: '#000000' });
    var rule = E.makeShape('line', [0, 0], [100, 0], { color: '#000000', width: 2 });
    function hit(e, x, y, r) { return E.touches(e, [x, y], [x, y], r); }
    T.eq(hit(hollow, 2, 50, 5) + ',' + hit(hollow, 50, 50, 5), 'true,false', 'a shape with no fill on its edge, not inside');
    T.eq(hit(full, 50, 50, 5), true, 'a filled shape inside too');
    T.eq(hit(oval, 50, 1, 3) + ',' + hit(oval, 50, 30, 3), 'true,false', 'an ellipse on its curve, not at the centre');
    T.eq(hit(kite, 50, 1, 3) + ',' + hit(kite, 5, 5, 3), 'true,false', 'a diamond on its edge, not in the corner of its box');
    T.eq(hit(words, words.w / 2, words.h / 2, 1), true, 'a text anywhere in its box');
    T.eq(hit(rule, 50, 3, 2) + ',' + hit(rule, 50, 20, 2), 'true,false', 'a line near, not far');
    T.eq(E.touches(rule, [50, -30], [50, 30], 1), true, 'a sweep crossing a line touches it even with no point near');
    T.eq(
      E.within(hollow, [[-10, -10], [110, -10], [110, 110], [-10, 110]]) + ',' +
      E.within(hollow, [[-10, -10], [60, -10], [60, 110], [-10, 110]]) + ',' +
      E.inside([5, 5], [[0, 0], [10, 0], [10, 10], [0, 10]]) + ',' +
      E.inside([15, 5], [[0, 0], [10, 0], [10, 10], [0, 10]]),
      'true,false,true,false', 'a loop knows what it holds');
    var moved = E.translateEl(hollow, 0, 350);
    T.eq(hit(moved, 2, 50, 5) + ',' + hit(moved, 2, 400, 5), 'false,true', 'a moved shape is hit where it is now');
  });

  /* ---------------------------------------------------------------- G1: cutting a stroke */

  T.test('G1 cutting a stroke', function () {
    var A = stroke('g1', 100);
    function band(from, to) { return function (p) { return p[0] - 300 >= from && p[0] - 300 <= to; }; }
    var two = E.cut(A, band(88, 112), 1);
    T.eq(two.length, 2, 'cut in the middle: two pieces');
    T.eq(two[0].id === 'g1' && two[1].id !== 'g1', true, 'the first keeps the name, the second does not');
    T.eq(Math.round(two[0].points[two[0].points.length - 1][0] - 300), 87, 'the first ends where the eraser begins');
    T.eq(Math.round(two[1].points[0][0] - 300), 113, 'the second starts where it ends');
    T.eq(two[0].points.length, 6, 'pieces keep their own points plus the one at the cut');
    T.ok(two[0].version > A.version && two[1].version > A.version, 'pieces are new versions');
    T.eq(two[0].size + ',' + two[0].color + ',' + two[0].thinning, A.size + ',' + A.color + ',' + A.thinning, 'and the same ink');

    var one = E.cut(A, band(150, 400), 1);
    T.eq(one.length, 1, 'cut at the end: one piece');
    T.eq(Math.round(one[0].points[one[0].points.length - 1][0] - 300), 149, 'ending before the eraser');
    T.same(E.cut(A, function () { return true; }, 1), [], 'all of it gone: nothing left');
    T.eq(E.cut(A, function () { return false; }, 1), null, 'missed: nothing changes');
    T.same(E.cut(A, band(2, 400), 1), [], 'a crumb shorter than the ink is wide does not stay');

    var sparse = E.makeStroke([[300, 0, 0.5], [500, 0, 0.5]], { id: 's', color: '#000000', size: 3, opacity: 1, thinning: 0.6, smoothing: 0.5, streamline: 0.5, sim: true });
    T.eq(E.cut(sparse, band(88, 112), 1).length, 2, 'a two-point stroke is still cut in the middle');

    var pressed = stroke('g1p', 100, { ramp: true });
    var cutPressed = E.cut(pressed, band(88, 112), 1);
    var pr = cutPressed[0].points.map(function (p) { return p[2]; });
    T.eq(pr.length + ',' + pr[0] + ',' + near(pr[pr.length - 1], 87 / 400, 0.001), '6,0,true', 'pressures follow their points');
  });

  /* ---------------------------------------------------------------- G2-G4: the eraser */

  function scene() {
    return [stroke('A', 200), stroke('B', 300), stroke('D', 400), rect('R', 750, 150, 120, 100), rect('P', 880, 230, 100, 60),
      E.makeText(400, 520, 'words', { id: 'W', size: 20, color: '#1f2328' })];
  }

  T.test('G2 part: ink is cut where the eraser passes, shapes go whole', function () {
    var start = scene();
    var after = E.erase(start, line(500, 150, 500, 450, 15), { mode: 'part', reach: 10, zoom: 1 });
    T.eq(strokes(after).length, 6, 'three strokes, six pieces');
    T.ok(strokes(after).every(function (el) { return el.points.every(function (p) { return p[1] === 200 || p[1] === 300 || p[1] === 400; }); }), 'pieces stay on their strokes');
    T.ok(['A', 'B', 'D'].every(function (id) { return ids(after).indexOf(id) >= 0; }), 'each stroke keeps its name on one piece');
    T.ok(['R', 'P', 'W'].every(function (id) { return ids(after).indexOf(id) >= 0; }), 'the rest is untouched');
    T.eq(start.length, 6, 'the scene it started from is not changed');

    var g = E.eraseBegin(after, { mode: 'part', reach: 10, zoom: 1 });
    E.eraseSweep(g, [752, 170], [752, 230]);
    T.eq(!!g.marked.R, true, 'a shape touched is marked, to show faded');
    T.ok(ids(g.work).indexOf('R') >= 0, 'and is still on the sheet while the gesture lasts');
    T.ok(ids(E.eraseResult(g)).indexOf('R') < 0, 'and gone when it ends');

    var inside = E.erase(after, [[810, 200], [812, 202]], { mode: 'part', reach: 5, zoom: 1 });
    T.eq(inside, null, 'rubbing inside a shape with no fill takes nothing');
    var words = E.erase(after, [[410, 530], [420, 530]], { mode: 'part', reach: 4, zoom: 1 });
    T.ok(words && ids(words).indexOf('W') < 0, 'a text touched goes whole');
  });

  T.test('G3 whole stroke: anything touched goes whole', function () {
    var after = E.erase(scene(), line(500, 150, 500, 250, 5), { mode: 'stroke', reach: 10, zoom: 1 });
    T.eq(strokes(after).length + ',' + (ids(after).indexOf('A') >= 0), '2,false', 'the stroke touched goes, no pieces');
    T.ok(strokes(after).every(function (el) { return el.points.length === 21; }), 'the others are whole');
    var shape = E.erase(scene(), line(752, 170, 752, 230, 4), { mode: 'stroke', reach: 10, zoom: 1 });
    T.ok(ids(shape).indexOf('R') < 0, 'and a shape touched too');
  });

  T.test('G4 area: the loop cuts the ink at its edge, takes what is wholly inside', function () {
    var loop = [].concat(line(580, 120, 900, 120, 8), line(900, 120, 900, 260, 4), line(900, 260, 580, 260, 8), line(580, 260, 580, 125, 4));
    var after = E.erase(scene(), loop, { mode: 'area', zoom: 1 });
    var leftOfA = strokes(after).filter(function (el) { return el.points[0][1] === 200; });
    T.eq(leftOfA.length, 1, 'the stroke the loop crosses keeps the piece outside');
    var end = leftOfA[0].points[leftOfA[0].points.length - 1][0];
    T.ok(near(end, 580, 3), 'cut where the loop passes (' + end.toFixed(1) + ')');
    T.ok(ids(after).indexOf('R') < 0, 'what lies inside goes');
    T.ok(ids(after).indexOf('P') >= 0, 'what lies half inside stays');
    var B = after.filter(function (el) { return el.id === 'B'; })[0];
    T.eq(B && B.points.length, 21, 'what lies outside is not touched');
    T.eq(E.erase(scene(), [[0, 0], [1, 1]], { mode: 'area', zoom: 1 }), null, 'a loop of two points takes nothing');
  });

  /* ---------------------------------------------------------------- moving and resizing */

  T.test('moving and resizing keep the ink and make new versions', function () {
    var r = rect('r', 0, 0, 100, 50);
    var bigger = E.scaleEl(r, 0, 0, 2, 3);
    T.same([bigger.x, bigger.y, bigger.w, bigger.h, bigger.width], [0, 0, 200, 150, 4], 'a shape grows, its line does not');
    var flipped = E.scaleEl(r, 100, 0, -1, 1);
    T.same([flipped.x, flipped.w], [100, 100], 'dragged past its anchor it flips and stays a box');
    var s = stroke('s', 0);
    var half = E.scaleEl(s, 300, 0, 0.5, 1);
    T.eq(half.points[20][0] + ',' + half.size, '500,3', 'a stroke shrinks, its nib does not');
    var text = E.makeText(0, 0, 'hello', { size: 20, color: '#000000' });
    var t2 = E.scaleEl(text, 0, 0, 2, 2);
    T.eq(t2.size, 40, 'text grows as a whole');
    T.ok(E.translateEl(r, 5, 5).version > r.version, 'a move is a new version');
  });

  /* ---------------------------------------------------------------- the file */

  function sampleScene() {
    var pressed = stroke('st', 40, { ramp: true });
    var hl = E.makeStroke([[10, 10, 0.5], [60, 12, 0.5], [120, 9, 0.5]], {
      id: 'hl', pen: 'highlighter', color: '#f2c12e', size: 20, opacity: 0.4, thinning: 0, smoothing: 0.6, streamline: 0.6, cap: false, blend: 'multiply', sim: true
    });
    return [
      pressed, hl,
      E.makeShape('rect', [10.123, 20.456], [110.789, 80.001], { id: 'r', color: '#2f6fb3', width: 4, fill: 'soft' }),
      E.makeShape('ellipse', [200, 20], [260, 60], { id: 'e', color: '#c4314b', width: 2, fill: 'none' }),
      E.makeShape('diamond', [300, 20], [360, 80], { id: 'd', color: '#2f7d5a', width: 8, fill: 'solid' }),
      E.makeShape('line', [0, 200], [100, 250], { id: 'l', color: '#1f2328', width: 2 }),
      E.makeShape('arrow', [120, 200], [220, 200], { id: 'a', color: '#1f2328', width: 4 }),
      E.makeText(30, 300, 'One <b>&amp; "two"</b>\n  three  ', { id: 't', size: 24, color: '#8a5fbf' })
    ];
  }

  T.test('the file: a standalone SVG with the scene inside, both ways', function () {
    var els = sampleScene();
    var svg = ink.serialize({ elements: els });
    var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    T.eq(doc.getElementsByTagName('parsererror').length, 0, 'well-formed XML');
    var root = doc.documentElement;
    var box = E.contentBox(els, null);
    var vb = root.getAttribute('viewBox').split(' ').map(Number);
    T.same(vb, [Math.floor(box[0] - 16), Math.floor(box[1] - 16), Math.ceil(box[2] + 16) - Math.floor(box[0] - 16), Math.ceil(box[3] + 16) - Math.floor(box[1] - 16)], 'viewBox: the content plus 16 all round');
    T.eq(root.getAttribute('width'), String(vb[2]), 'and a size of its own, for <img>');
    var paper = root.getElementsByTagName('rect')[0];
    T.eq(paper.getAttribute('fill') + ',' + paper.getAttribute('width'), ink.PAPER + ',' + vb[2], 'light paper under everything');
    T.ok(root.getElementsByTagName('metadata')[0].getAttribute('id') === 'mindroot-ink', 'the scene in <metadata id="mindroot-ink">');
    T.eq(root.getElementsByTagName('text')[0].getAttribute('font-family'), ink.FONT, 'text in the system font stack');
    T.eq(root.getElementsByTagName('tspan').length, 2, 'one tspan per line');
    T.eq(root.getElementsByTagName('tspan')[0].textContent, 'One <b>&amp; "two"</b>', 'user text escaped, kept literally');
    T.ok(svg.indexOf('<b>') < 0, 'no markup from the text gets into the file');
    T.ok(/style="mix-blend-mode:multiply"/.test(svg), 'the highlighter multiplies');
    T.ok(!/(href|src)="(https?:|\/\/)/.test(svg), 'nothing external');

    var back = ink.parse(svg);
    T.eq(back.kind + ',' + back.ok, 'ink,true', 'read back as a drawing');
    T.same(back.elements.map(E.elementJson), els.map(E.elementJson), 'every element as it was (to two decimals)');
    T.eq(ink.serialize({ elements: back.elements }), svg, 'and written again, the same file');
    T.ok(ink.isInkSvg(svg), 'known as a drawing of ours');
    T.ok(!ink.isInkSvg(S.EXCALIDRAW), 'an Excalidraw file is not');
    T.eq(ink.serialize({ elements: [] }).indexOf('viewBox="0 0 320 200"') > 0, true, 'an empty drawing still makes a picture');
  });

  /* A 2 x 1 PNG, and a second one, as data URLs. */
  var PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEklEQVR4nGP4z8Dwn+E/A8N/AAcAAv/nHX0ZAAAAAElFTkSuQmCC';
  var PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

  function picture(id, x, y, w, h, href, locked) {
    return { id: id, type: 'image', version: 1, x: x, y: y, w: w, h: h, href: href, locked: !!locked };
  }

  T.test('pictures: written once in the file, read back, a newer format so older builds do not drop them', function () {
    var els = [picture('P1', 10, 20, 200, 100, PNG_A), stroke('S', 80), picture('P2', 400, 20, 50, 50, PNG_B, true)];
    var svg = ink.serialize({ elements: els });
    var doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    T.eq(doc.getElementsByTagName('parsererror').length, 0, 'well-formed XML');
    T.eq(doc.documentElement.getAttribute('data-mindroot-ink'), '2', 'a file with a picture is format 2');
    T.eq(ink.serialize({ elements: [stroke('S', 80)] }).indexOf('data-mindroot-ink="1"') > 0, true, 'and one without stays format 1');
    var imgs = doc.getElementsByTagName('image');
    T.eq(imgs.length, 2, 'one <image> per picture');
    T.eq(imgs[0].getAttribute('id'), 'mrimg-P1', 'named for its element');
    T.eq(imgs[0].getAttribute('href'), PNG_A, 'the bytes are there');
    T.eq(svg.split(PNG_A).length - 1, 1, 'and only once (the scene in the metadata names the picture, never holds it)');
    var meta = JSON.parse(doc.getElementsByTagName('metadata')[0].textContent);
    T.same(meta.elements[0], { id: 'P1', type: 'image', x: 10, y: 20, w: 200, h: 100 }, 'the scene: place and size');
    T.eq(meta.elements[2].locked, true, 'a locked picture says so');
    var back = ink.parse(svg);
    T.eq(back.kind, 'ink', 'read back as a drawing');
    T.same(back.elements.map(function (el) { return el.type + ':' + el.id; }), ['image:P1', 'stroke:S', 'image:P2'], 'in the same order');
    T.same([back.elements[0].href === PNG_A, back.elements[0].locked, back.elements[2].locked], [true, false, true], 'the bytes back, the lock kept');
    T.eq(ink.serialize({ elements: back.elements }), svg, 'written again, the same file');
    var box = E.contentBox(els, null);
    T.same([box[0] <= 10, box[2] >= 450], [true, true], 'the picture counts in the drawing\'s box');
    T.eq(E.boundsOf(els[0]).join(','), '10,20,210,120', 'its box is exactly its place');
  });

  T.test('pictures: a hostile file gives none, a newer one is left alone, a damaged XML is repaired', function () {
    function file(meta, body, v) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" data-mindroot-ink="' + (v || 2) + '"><metadata id="mindroot-ink">' +
        JSON.stringify({ v: v || 2, elements: meta }).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</metadata>' + body + '</svg>';
    }
    var okEl = { id: 'A', type: 'image', x: 1, y: 2, w: 30, h: 20 };
    T.eq(ink.parse(file([okEl], '<image id="mrimg-A" href="' + PNG_A + '"/>')).elements.length, 1, 'the good file reads');
    T.eq(ink.parse(file([okEl], '')).elements.length, 0, 'a picture with no bytes is dropped');
    T.eq(ink.parse(file([okEl], '<image id="mrimg-A" href="https://example.com/a.png"/>')).elements.length, 0, 'an external address is never a picture');
    T.eq(ink.parse(file([okEl], '<image id="mrimg-A" href="data:text/html;base64,PGI+"/>')).elements.length, 0, 'nor is a data URL that is not an image');
    T.eq(ink.parse(file([okEl], '<image id="mrimg-A" href="javascript:alert(1)"/>')).elements.length, 0, 'nor a script');
    T.eq(ink.parse(file([{ id: 'A', type: 'image', x: 1, y: 2, w: -5, h: 20 }], '<image id="mrimg-A" href="' + PNG_A + '"/>')).elements.length, 0, 'a picture with no size is dropped');
    T.eq(ink.parse(file([{ id: 'A', type: 'image', x: 1, y: 2, w: 5e6, h: 5 }], '<image id="mrimg-A" href="' + PNG_A + '"/>')).elements[0].w, 20000, 'and a giant one is held to a size');
    var two = ink.parse(file([okEl, { id: 'A', type: 'image', x: 5, y: 5, w: 9, h: 9 }], '<image id="mrimg-A" href="' + PNG_A + '"/>')).elements;
    T.eq(two.length === 2 && two[0].id !== two[1].id, true, 'a repeated id is renamed');
    var newer = ink.parse(file([okEl], '<image id="mrimg-A" href="' + PNG_A + '"/>', 3));
    T.eq(newer.kind, 'newer', 'a later format is shown, not edited');
    var broken = file([okEl], '<image id="mrimg-A" href="' + PNG_A + '"/>').replace('</svg>', '<b>\u0001</b></svg>').replace('<b>', '<b ').replace('<b \u0001', '<b>\u0001');
    var fixed = ink.parse(broken.replace('</metadata>', '</metadata>\u0001'));
    T.ok(fixed.repaired ? fixed.elements.length === 1 && fixed.elements[0].href === PNG_A : true, 'a file the XML parser refuses is repaired with its picture');
  });

  T.test('pictures: moved, scaled, and never rubbed out by the eraser', function () {
    var pic = picture('P', 100, 100, 200, 100, PNG_A);
    var moved = E.translateEl(pic, 15, -5);
    T.same([moved.x, moved.y, moved.w, moved.h, moved.href === PNG_A, moved.version > pic.version], [115, 95, 200, 100, true, true], 'moved: a new version, the same bytes');
    var big = E.scaleEl(pic, 100, 100, 2, 2);
    T.same([big.x, big.y, big.w, big.h], [100, 100, 400, 200], 'scaled about a corner');
    var els = [pic, stroke('S', 150)];
    var part = E.erase(els, line(150, 150, 350, 150, 8), { mode: 'part', reach: 12, zoom: 1 });
    T.eq(part.filter(function (el) { return el.type === 'image'; }).length, 1, 'the part eraser leaves it');
    var whole = E.erase(els, line(150, 150, 350, 150, 8), { mode: 'stroke', reach: 12, zoom: 1 });
    T.eq(whole.filter(function (el) { return el.type === 'image'; }).length, 1, 'and the whole-stroke eraser');
    T.eq(whole.filter(function (el) { return el.type === 'stroke'; }).length, 0, 'which still takes the ink');
    var area = E.erase(els, line(90, 90, 310, 90, 4).concat(line(310, 90, 310, 210, 4), line(310, 210, 90, 210, 4), line(90, 210, 90, 90, 4)), { mode: 'area', reach: 6, zoom: 1 });
    T.eq(area.filter(function (el) { return el.type === 'image'; }).length, 1, 'and a loop round it');
    T.eq(E.touches(pic, [150, 150], [150, 150], 2), true, 'a tap inside it touches it (to select it)');
    T.eq(E.touches(pic, [50, 50], [50, 50], 2), false, 'and outside does not');
  });

  T.test('the file shows as a picture on its own', function () {
    var svg = ink.serialize({ elements: sampleScene() });
    var w = Number(/width="(\d+)"/.exec(svg)[1]);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        T.eq(img.naturalWidth, w, 'decodes in an <img>, at its own size');
        resolve();
      };
      img.onerror = function () {
        T.ok(false, 'decodes in an <img>');
        resolve();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  });

  T.test('reading a file trusts nothing in it', function () {
    T.eq(ink.parse('').kind, 'empty', 'nothing');
    T.eq(ink.parse('not xml at all <').kind, 'invalid', 'not XML');
    T.eq(ink.parse('<html><body></body></html>').kind, 'invalid', 'not an SVG');
    var broken = ink.parse('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40"><metadata id="mindroot-ink">{broken</metadata></svg>');
    T.eq(broken.kind + ',' + broken.elements.length + ',' + (broken.background && broken.background.w), 'damaged,0,50', 'a broken scene: damaged, its picture kept as the background');
    var later = ink.parse('<svg xmlns="http://www.w3.org/2000/svg"><metadata id="mindroot-ink">{"v":3,"elements":[]}</metadata></svg>');
    T.eq(later.kind + ',' + later.version + ',' + later.elements.length + ',' + !!later.background, 'newer,3,0,true', 'a future version is not guessed at: newer, shown as a picture');
    var got = ink.parse(S.HOSTILE);
    T.eq(got.kind, 'ink', 'a hostile file still opens');
    var types = got.elements.map(function (el) { return el.type; });
    T.same(types, ['rect', 'line', 'text', 'stroke'], 'unknown types and broken numbers are dropped');
    var r = got.elements[0];
    T.same([r.x, r.y, r.w, r.h, r.color, r.fill], [1, -18, 30, 20, '#abcdef', 'none'], 'a negative size normalised, a bad fill defaulted, colour lowercased');
    T.eq(got.elements[1].color, 'ink', 'a colour that is not #rrggbb becomes the semantic ink');
    T.ok(got.elements[0].id !== got.elements[1].id, 'a repeated id is renamed');
    T.eq(got.elements[2].text, '<script>alert(1)</script>', 'text is text');
    T.ok(/^k[0-9a-z]+$/.test(got.elements[2].id), 'an id with spaces is replaced');
    T.eq(got.elements[2].size, 24, 'a negative text size defaulted');
    T.same(got.elements[3].points.map(function (p) { return p[2]; }), [1, 0.5], 'pressures clamped or defaulted');
    T.eq(got.elements[3].opacity, 1, 'opacity clamped');
    T.eq(got.background, null, 'a background that is not an image data URL is refused');
    T.eq(window.hostileRan, undefined, 'and nothing in the file ran');
  });

  /* ---------------------------------------------------------------- an old Excalidraw drawing */

  T.test('an old Excalidraw drawing becomes the locked background, and stays in the new file', function () {
    var got = ink.parse(S.EXCALIDRAW);
    T.eq(got.kind + ',' + got.excalidraw, 'foreign,true', 'known as foreign, from Excalidraw');
    T.same(got.elements, [], 'no editable elements');
    var bg = got.background;
    T.same([bg.x, bg.y, bg.w, bg.h], [0, 0, 240, 140], 'its size from the file');
    T.ok(/^data:image\/svg\+xml;base64,/.test(bg.href), 'as an image data URL');
    var decoded = new TextDecoder().decode(Uint8Array.from(atob(bg.href.split(',')[1]), function (c) { return c.charCodeAt(0); }));
    T.eq(decoded, S.EXCALIDRAW, 'carrying the original file byte for byte (UTF-8 included)');

    var drawn = [stroke('over', 70)];
    var svg = ink.serialize({ elements: drawn, background: bg });
    T.ok(svg.indexOf('<image id="mindroot-ink-bg"') > 0, 'the new file holds the old drawing as an <image>');
    T.ok(svg.indexOf('svg-source:excalidraw') < 0, 'inside a data URL, not as markup');
    var vb = /viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
    T.ok(vb[0] <= -16 && vb[1] <= -16 && vb[0] + vb[2] >= 716, 'the picture frames both the old drawing and the new ink');
    var again = ink.parse(svg);
    T.eq(again.kind, 'ink', 'opened again it is a drawing of ours');
    T.same([again.background.x, again.background.y, again.background.w, again.background.h, again.background.href === bg.href], [0, 0, 240, 140, true], 'with the same background');
    T.eq(again.elements.length, 1, 'and the ink drawn over it');
    var only = ink.serialize({ elements: [], background: bg });
    T.eq(ink.parse(only).background.w, 240, 'a background alone is kept too');
  });

  /* ---------------------------------------------------------------- what the hand holds */

  T.test('settings are cleaned, never trusted', function () {
    var d = E.cleanSettings(null);
    T.eq(d.tool + ',' + d.pen + ',' + d.eraser.mode + ',' + d.eraser.size, 'pen,pen,part,20', 'defaults');
    var odd = E.cleanSettings({ tool: 'hand', pen: 'crayon', pens: { pen: { color: 'red', size: 999 }, brush: { color: '#ABCDEF', size: 0.2 } }, eraser: { mode: 'stroke', size: 21 }, shapes: { width: 'xl', fill: 'soft' }, text: { size: 'l' } });
    T.eq(odd.tool, 'pen', 'the hand is not remembered as the tool');
    T.eq(odd.pen, 'pen', 'an unknown instrument falls back');
    T.eq(odd.pens.pen.size + ',' + odd.pens.pen.color, '48,ink', 'a size clamped, a bad colour dropped (the default ink)');
    T.eq(odd.pens.brush.size + ',' + odd.pens.brush.color, '1,#abcdef', 'clamped at the low end, colour kept');
    T.eq(odd.eraser.mode + ',' + odd.eraser.size, 'stroke,22', 'the eraser size goes on its even step');
    T.eq(odd.shapes.width + ',' + odd.shapes.fill + ',' + odd.text.size, 'm,soft,l', 'shape and text styles');
  });

  /* ---------------------------------------------------------------- the editor: dirty and saving */

  var pid = 100;
  function fire(target, type, x, y, o) {
    var e = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: o.id, pointerType: o.type || 'mouse', isPrimary: true,
      clientX: x, clientY: y, button: type === 'pointermove' ? -1 : (o.button || 0),
      buttons: type === 'pointerup' ? 0 : (o.buttons == null ? 1 : o.buttons),
      pressure: type === 'pointerup' ? 0 : (o.pressure == null ? 0.5 : o.pressure)
    });
    target.dispatchEvent(e);
    return e;
  }

  function drag(ed, pts, o) {
    o = Object.assign({ type: 'mouse' }, o || {});
    o.id = ++pid;
    var surface = ed.el.querySelector('.ink__surface');
    fire(surface, 'pointerdown', pts[0][0], pts[0][1], o);
    for (var i = 1; i < pts.length; i++) fire(surface, 'pointermove', pts[i][0], pts[i][1], o);
    if (!o.hold) fire(surface, 'pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], o);
    return o.id;
  }

  var host = document.getElementById('host');

  /* The sheet is painted on the next animation frame. */
  function frame() {
    return new Promise(function (resolve) {
      var done = false;
      function go() { if (!done) { done = true; setTimeout(resolve, 0); } }
      requestAnimationFrame(go);
      setTimeout(go, 100);
    });
  }

  T.test('editor: only real changes are saved, 600 ms after the gesture', async function () {
    var saves = [];
    var closes = [];
    var ed = ink.open(host, { title: 'Trial', onSave: function (svg) { saves.push(svg); }, onClose: function (info) { closes.push(info); } });
    T.eq(ed.isDirty() + ',' + ed.saveState(), 'false,clean', 'a new drawing is clean');
    T.eq(ed.el.getAttribute('aria-label'), 'Drawing: Trial', 'the editor says what it is');
    ed.setCamera({ x: 30, y: 40, k: 2 });
    ed.zoomBy(1.5);
    ed.setTool('rect');
    ed.setTool('pen');
    T.eq(ed.isDirty(), false, 'camera and tools are not edits');
    drag(ed, line(100, 100, 300, 200, 12));
    T.eq(ed.scene().length + ',' + ed.isDirty() + ',' + ink.isDirty(), '1,true,true', 'a stroke is an edit');
    T.eq(saves.length, 0, 'not saved at once');
    await T.until(function () { return saves.length === 1; }, 3000, 'the first save');
    T.eq(ink.parse(saves[0]).elements.length, 1, 'the saved file holds the stroke');
    T.eq(ed.isDirty() + ',' + ed.saveState(), 'false,saved', 'and the drawing is clean again');

    ed.setCamera({ x: 0, y: 0, k: 1 });
    ed.fit();
    await T.sleep(800);
    T.eq(saves.length, 1, 'panning and zooming save nothing');

    ed.undo();
    T.eq(ed.isDirty(), true, 'undo is a change');
    await T.until(function () { return saves.length === 2; }, 3000, 'the save after undo');
    T.eq(ink.parse(saves[1]).elements.length, 0, 'saved empty');
    ed.redo();
    ed.undo();
    T.eq(ed.isDirty(), false, 'undo and redo back to what was saved: clean');
    await T.sleep(800);
    T.eq(saves.length, 2, 'and nothing saved');

    ed.redo();
    var closed = ed.close();
    T.eq(saves.length, 3, 'closing saves what was waiting, at once');
    T.ok(typeof closed === 'string' && ink.parse(closed).elements.length === 1, 'close() gives the file back');
    T.same(closes, [{ saved: true, svg: closed }], 'onClose once, saying it saved, with the drawing');
    T.eq(host.querySelector('.ink'), null, 'the editor is gone from the page');
    T.eq(ink.isDirty(), false, 'nothing left to save');
    T.eq(ed.close(), closed, 'closing twice is harmless');
    T.eq(closes.length, 1, 'and onClose is not called again');
  });

  T.test('editor: a save that fails keeps the drawing to be saved', async function () {
    var tries = 0;
    var ed = ink.open(host, { onSave: function () { tries++; return Promise.reject(new Error('disk full')); } });
    drag(ed, line(100, 100, 200, 120, 6));
    await T.until(function () { return ed.saveState() === 'failed'; }, 3000, 'the failure');
    T.eq(ed.isDirty() + ',' + tries, 'true,1', 'still dirty, tried once');
    T.eq(ed.el.getAttribute('data-save'), 'failed', 'and the indicator says so');
    ed.close();
  });

  T.test('editor: one gesture, one undo step; pinch and cancel leave none', async function () {
    var ed = ink.open(host, { onSave: function () {} });
    ed.setCamera({ x: 0, y: 0, k: 1 });
    ed.setTool('pen');
    drag(ed, line(100, 300, 500, 300, 20));
    drag(ed, line(100, 400, 500, 400, 20));
    T.eq(ed.scene().length, 2, 'two strokes');
    ed.setEraser({ mode: 'part', size: 20 });
    ed.setTool('eraser');
    drag(ed, line(300, 250, 300, 450, 20));
    T.eq(ed.scene().length, 4, 'one pass cuts both');
    ed.undo();
    T.eq(ed.scene().length, 2, 'one undo puts both back');
    ed.redo();
    T.eq(ed.scene().length, 4, 'one redo cuts both again');
    ed.undo();

    function onSheet() { return ed.el.querySelectorAll('.ink__scene [data-id]').length; }
    var depth = ed.history().undo;
    var first = drag(ed, line(300, 250, 300, 450, 10), { type: 'touch', hold: true });
    await frame();
    T.eq(onSheet() + ',' + ed.elements().length, '4,2', 'while the finger is down the sheet shows both strokes cut, nothing committed yet');
    fire(ed.el.querySelector('.ink__surface'), 'pointerdown', 600, 500, { id: 999, type: 'touch' });
    T.eq(ed.busy(), true, 'a second finger turns it into a pinch');
    fire(ed.el.querySelector('.ink__surface'), 'pointerup', 600, 500, { id: 999, type: 'touch' });
    fire(ed.el.querySelector('.ink__surface'), 'pointerup', 300, 450, { id: first, type: 'touch' });
    await frame();
    T.eq(ed.scene().length + ',' + onSheet() + ',' + ed.busy(), '2,2,false', 'the erasing is given back on the sheet too, nothing left behind');
    T.eq(ed.history().undo, depth, 'and no undo step is added');
    ed.undo();
    T.eq(ed.scene().length, 1, 'the next undo takes the step before (the second stroke)');
    ed.redo();

    var id2 = drag(ed, line(300, 250, 300, 450, 10), { hold: true });
    await frame();
    T.eq(onSheet(), 4, 'a mouse erasing: cut on the sheet');
    fire(ed.el.querySelector('.ink__surface'), 'pointercancel', 300, 450, { id: id2 });
    await frame();
    T.eq(ed.scene().length + ',' + onSheet() + ',' + ed.canRedo() + ',' + ed.history().undo, '2,2,true,' + depth, 'a cancelled pointer puts everything back, and the redo a commit would clear is still there');

    var id3 = drag(ed, line(300, 250, 300, 350, 10), { hold: true });
    window.dispatchEvent(new Event('blur'));
    T.eq(ed.scene().length + ',' + ed.busy(), '3,false', 'losing the window keeps what was erased');
    fire(ed.el.querySelector('.ink__surface'), 'pointerup', 300, 350, { id: id3 });
    drag(ed, line(300, 380, 300, 450, 10));
    T.eq(ed.scene().length, 4, 'and the eraser takes the next gesture');
    ed.close();
  });

  T.test('editor: the eraser cursor, the hand and read only', function () {
    var ed = ink.open(host, { onSave: function () {} });
    ed.setTool('eraser');
    ed.setEraser({ mode: 'part', size: 30 });
    var surface = ed.el.querySelector('.ink__surface');
    fire(surface, 'pointermove', 200, 200, { id: 1, buttons: 0 });
    var cur = ed.el.querySelector('.ink__cursor');
    T.eq(cur.hidden + ',' + cur.style.width, 'false,30px', 'a circle as big as the eraser follows the pointer');
    ed.setEraser({ mode: 'area' });
    fire(surface, 'pointermove', 210, 200, { id: 1, buttons: 0 });
    T.eq(cur.hidden, true, 'not for the loop');
    ed.setTool('pen');
    T.eq(cur.hidden, true, 'and gone with the eraser');

    ed.setReadOnly(true);
    T.eq(ed.tool() + ',' + ed.el.hasAttribute('data-readonly'), 'hand,true', 'read only: the hand');
    var before = ed.camera();
    drag(ed, line(300, 300, 400, 340, 5));
    var after = ed.camera();
    T.eq(ed.scene().length, 0, 'nothing drawn');
    T.eq(Math.round(after.x - before.x) + ',' + Math.round(after.y - before.y), '100,40', 'the sheet moves instead');
    T.eq(ed.setTool('pen'), false, 'no tool can be taken');
    ed.setReadOnly(false);
    T.eq(ed.tool(), 'pen', 'back to the tool that was in hand');
    ed.close();
  });

  T.test('editor: a change of language renames it in place', function () {
    ns.i18n.init('en');
    var ed = ink.open(host, { title: 'Garden', onSave: function () {} });
    function label(sel) { return ed.el.querySelector(sel).getAttribute('aria-label'); }
    T.eq(label('.ink__tool[data-tool="eraser"]'), 'Eraser', 'English first');
    ns.i18n.setLang('it');
    T.eq(label('.ink__tool[data-tool="eraser"]'), 'Gomma', 'a tool');
    T.eq(label('.ink__tools'), 'Strumenti di disegno', 'a toolbar');
    T.eq(ed.el.querySelector('.ink__done').textContent, 'Fine', 'the Done button');
    T.eq(ed.el.getAttribute('aria-label'), 'Disegno: Garden', 'the editor');
    T.eq(ed.el.querySelector('.ink__text').getAttribute('placeholder'), 'Scrivi', 'the text field');
    ns.i18n.setLang('en');
    T.eq(label('.ink__actions .ink__btn'), 'Undo', 'and back');
    ed.close();
  });

  T.test('what the hand holds is remembered for next time', async function () {
    var ed = ink.open(host, { onSave: function () {} });
    ed.setEraser({ mode: 'area', size: 26 });
    ed.setPen('marker');
    ed.setColor('#2F7D5A');
    await T.until(function () {
      var raw = JSON.parse(localStorage.getItem('mindroot2:ink') || 'null');
      return raw && raw.eraser.mode === 'area';
    }, 2000, 'the settings written');
    var raw = JSON.parse(localStorage.getItem('mindroot2:ink'));
    T.same(raw.eraser, { mode: 'area', size: 26 }, 'the eraser, mode and size');
    T.eq(raw.pen + ',' + raw.pens.marker.color + ',' + raw.tool, 'marker,#2f7d5a,pen', 'the instrument, its colour, the tool');
    ed.close();
    var again = ink.open(host, { onSave: function () {} });
    T.eq(again.settings().pen + ',' + again.tool(), 'marker,pen', 'a new editor starts with them');
    again.setEraser({ mode: 'part', size: 20 });
    again.setPen('pen');
    again.close();
  });

  T.test('editor: a host closing it from inside onSave gets one close', function () {
    var closes = 0;
    var ed = ink.open(host, {
      onSave: function () { ed.close(); },
      onClose: function () { closes++; }
    });
    drag(ed, line(100, 100, 200, 140, 6));
    var svg = ed.close();
    T.eq(closes, 1, 'onClose once');
    T.ok(typeof svg === 'string' && ink.parse(svg).elements.length === 1, 'and the drawing handed over');
    T.eq(host.querySelector('.ink'), null, 'gone');
  });

  T.test('editor: opened in a hidden pane, it fits the drawing once it is shown', async function () {
    var pane = document.createElement('div');
    pane.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;display:none';
    document.body.appendChild(pane);
    var svg = ink.serialize({ elements: [rect('far', 2000, 1500, 300, 200)] });
    var ed = ink.open(pane, { svgText: svg, focus: false });
    T.eq(ed.camera().k, 1, 'nothing to fit while it has no size');
    pane.style.display = 'block';
    await T.until(function () { return ed.camera().k !== 1 || ed.camera().x !== 0; }, 2000, 'the fit');
    var a = ed.toClient(2000, 1500);
    var b = ed.toClient(2300, 1700);
    T.ok(a[0] >= 0 && a[1] >= 0 && b[0] <= 600 && b[1] <= 400, 'the drawing is in view: ' + a.concat(b).map(Math.round).join(','));
    ed.close();
    pane.remove();
  });

  T.test('the keys, for the help sheet', function () {
    var keys = ink.shortcuts();
    T.ok(keys.length >= 15 && keys.every(function (k) { return k.keys.length && k.label && k.label.indexOf('ink.') !== 0; }), 'each with keys and a translated name');
    T.same(keys.filter(function (k) { return k.keys[0] === 'E'; })[0].keys, ['E', '0'], 'the eraser on two keys');
  });

  T.test('editor: leaving the page saves what is waiting', function () {
    var saves = 0;
    var ed = ink.open(host, { onSave: function () { saves++; }, focus: false });
    drag(ed, line(100, 100, 180, 130, 6));
    T.eq(saves, 0, 'nothing saved yet (the 600 ms have not passed)');
    window.dispatchEvent(new Event('pagehide'));
    T.eq(saves + ',' + ed.isDirty(), '1,false', 'pagehide saves at once');
    drag(ed, line(100, 200, 180, 230, 6));
    T.eq(ink.flush() + ',' + saves, '1,2', 'and so does ns.ink.flush(), for the app to call before its own flush');
    ed.close();
  });

  /* ---------------------------------------------------------------- review regressions */

  function wellFormed(svg) {
    return new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length === 0;
  }

  function decodes(svg) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img.naturalWidth > 0); };
      img.onerror = function () { resolve(false); };
      img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    });
  }

  T.test('text: characters XML refuses never reach the file', async function () {
    var raw = 'Line one\u000bLine two\u000cThree Four\u0000\u0007￾￿\ud800 fine 😀\tok';
    var el = E.normalizeElement({ id: 'w', type: 'text', x: 10, y: 10, text: raw, size: 20, color: '#1f2328' });
    T.eq(el.text, 'Line one\nLine two\nThree\nFour fine 😀\tok', 'a vertical tab, a form feed and a line separator become line breaks; the rest goes; a whole emoji stays');
    var svg = ink.serialize({ elements: [stroke('s1', 40), el] });
    T.ok(wellFormed(svg), 'the file is well-formed XML');
    T.eq(await decodes(svg), true, 'and shows as an <img>');
    var back = ink.parse(svg);
    T.eq(back.kind + ',' + back.elements.length + ',' + back.elements[1].text, 'ink,2,' + el.text, 'and opens again with the same text');
    T.eq(back.elements[1].h, 4 * 20 * 1.25, 'four lines');

    var raw2 = E.makeText(0, 0, 'a\u000bb\u0001c', { id: 'raw', size: 16, color: '#1f2328' });
    var svg2 = ink.serialize({ elements: [raw2] });
    T.ok(wellFormed(svg2), 'even text that skipped the cleaning cannot break the file: the writer drops what XML refuses');

    var cut = E.normalizeElement({ type: 'text', x: 0, y: 0, text: new Array(20000).join('a') + '😀' });
    T.ok(cut && !/[\ud800-\udfff]/.test(cut.text.slice(-1)), 'cutting a long text never leaves half an emoji');
    T.eq(E.normalizeElement({ type: 'text', x: 0, y: 0, text: '\u000b\u0000 ' }), null, 'a text of nothing but control characters is no text');
  });

  T.test('text: what is typed is cleaned when it goes on the sheet', async function () {
    var saves = [];
    var ed = ink.open(host, { onSave: function (svg) { saves.push(svg); }, focus: false });
    ed.setCamera({ x: 0, y: 0, k: 1 });
    drag(ed, line(100, 100, 300, 140, 8));
    ed.setTool('text');
    var surface = ed.el.querySelector('.ink__surface');
    fire(surface, 'pointerdown', 200, 300, { id: ++pid });
    fire(surface, 'pointerup', 200, 300, { id: pid });
    var ta = ed.el.querySelector('.ink__text');
    T.eq(ta.hidden, false, 'a field is open');
    ta.value = 'Line one\u000bLine two';
    T.eq(ed.isDirty(), true, 'words typed are something to save');
    ed.save();
    var last = saves[saves.length - 1];
    T.ok(wellFormed(last), 'the saved file is well-formed');
    var words = ink.parse(last).elements.filter(function (x) { return x.type === 'text'; })[0];
    T.eq(words && words.text, 'Line one\nLine two', 'with the soft line break as a line break');
    ed.close();
  });

  T.test('a file the XML parser refuses is read from its scene and written whole again', async function () {
    var good = ink.serialize({ elements: [stroke('a', 40), E.makeText(10, 80, 'hello', { id: 't', size: 20, color: '#1f2328' })] });
    var bad = good.replace('>hello<', '>ci\u000bao<');
    T.ok(!wellFormed(bad), 'a file as an early build wrote it: not well-formed');
    var got = ink.parse(bad);
    T.eq(got.kind + ',' + got.repaired + ',' + got.elements.length, 'ink,true,2', 'read past the fault, every element back');
    T.ok(ink.isInkSvg(bad), 'and known as ours');
    var saves = [];
    var ed = ink.open(host, { svgText: bad, onSave: function (svg) { saves.push(svg); }, focus: false });
    T.eq(ed.loaded().kind + ',' + ed.loaded().repaired + ',' + ed.readOnly() + ',' + ed.isDirty(), 'ink,true,false,true', 'it opens writable, to be saved again');
    await T.until(function () { return saves.length === 1; }, 3000, 'the repairing save');
    T.ok(wellFormed(saves[0]) && ink.parse(saves[0]).elements.length === 2, 'the file is whole again, with both elements');
    ed.close();
    var viewOnly = ink.open(host, { svgText: bad, readOnly: true, onSave: function () { saves.push('x'); }, focus: false });
    T.eq(viewOnly.isDirty(), false, 'a view-only editor does not write it');
    viewOnly.close();
    T.eq(saves.length, 1, 'and nothing was saved on close either');
  });

  T.test('a file that cannot be read never opens as an empty sheet to be saved over', function () {
    var saves = [];
    var closes = [];
    function open(svgText) {
      return ink.open(host, { svgText: svgText, onSave: function (svg) { saves.push(svg); }, onClose: function (info) { closes.push(info); }, focus: false });
    }
    var ed = open('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg');
    var info = ed.loaded();
    T.eq(info.kind + ',' + info.locked + ',' + ed.readOnly() + ',' + ed.tool(), 'invalid,true,true,hand', 'a truncated file: locked, view only');
    var notice = ed.el.querySelector('.ink__notice');
    T.eq(!notice.hidden && notice.textContent === 'This drawing cannot be read. It opens view only, so that it is not written over.', true, 'a notice says why');
    T.ok(ed.el.getAttribute('aria-describedby').indexOf(notice.id) >= 0, 'and the editor is described by it');
    ed.setReadOnly(false);
    T.eq(ed.readOnly() + ',' + ed.setTool('pen'), 'true,false', 'the host cannot unlock it');
    drag(ed, line(100, 100, 300, 140, 8));
    T.eq(ed.scene().length + ',' + ed.isDirty(), '0,false', 'nothing can be drawn');
    T.eq(ed.close(), null, 'closing hands nothing over');
    T.same(closes, [{ saved: true, svg: null }], 'the file is left as it was');
    T.eq(saves.length, 0, 'and never written');

    var newer = open('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200"><metadata id="mindroot-ink">{"v":3,"elements":[{"type":"stroke2"}]}</metadata><path d="M20 20L280 180" stroke="#c4314b" stroke-width="6"/></svg>');
    T.eq(newer.loaded().kind + ',' + newer.loaded().version + ',' + newer.readOnly(), 'newer,3,true', 'a later format: view only');
    T.same(newer.background(), { x: 0, y: 0, w: 300, h: 200 }, 'shown as the picture it is');
    T.ok(/newer version/.test(newer.el.querySelector('.ink__notice').textContent), 'with its own notice');
    newer.close();

    var damaged = open('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200"><metadata id="mindroot-ink">{"v":1,"elements":"oops"}</metadata><path d="M20 20L280 180" stroke="#c4314b" stroke-width="6"/></svg>');
    T.eq(damaged.loaded().kind + ',' + damaged.readOnly() + ',' + !!damaged.background(), 'damaged,false,true', 'a damaged scene: the picture behind the sheet, writable');
    var dn = damaged.el.querySelector('.ink__notice');
    T.eq(dn.hidden, false, 'a notice says the editable part is lost');
    damaged.setCamera({ x: 0, y: 0, k: 1 });
    damaged.setTool('pen');
    drag(damaged, line(100, 100, 200, 140, 8));
    T.eq(dn.hidden, true, 'the notice goes once the drawing over it begins');
    var kept = damaged.close();
    var again = ink.parse(kept);
    T.eq(again.kind + ',' + again.elements.length + ',' + (again.background && again.background.w), 'ink,1,300', 'saved as a drawing of ours, the old picture kept behind the new ink');
    var inside = new TextDecoder().decode(Uint8Array.from(atob(again.background.href.split(',')[1]), function (c) { return c.charCodeAt(0); }));
    T.ok(inside.indexOf('M20 20L280 180') > 0, 'the old file, byte for byte, inside the new one');
  });

  T.test('a final save that fails never loses the drawing', async function () {
    var modes = ['false', 'throw', 'reject'];
    for (var m = 0; m < modes.length; m++) {
      var mode = modes[m];
      var closes = [];
      var ed = ink.open(host, {
        focus: false,
        onSave: function () {
          if (mode === 'false') return false;
          if (mode === 'throw') throw new Error('QuotaExceededError');
          return Promise.reject(new Error('QuotaExceededError'));
        },
        onClose: function (info) { closes.push(info); }
      });
      ed.setCamera({ x: 0, y: 0, k: 1 });
      drag(ed, line(100, 100, 300, 140, 8));
      ed.done();
      if (mode === 'reject') {
        T.eq(ed.el.getAttribute('data-closing') === '' && ed.el.querySelector('.ink__done').getAttribute('aria-disabled'), 'true', mode + ': Done waits for the answer');
        await T.until(function () { return ed.saveState() === 'failed'; }, 3000, 'the rejection');
      }
      T.eq(!!ed.el.parentNode + ',' + ed.saveState() + ',' + closes.length, 'true,failed,0', mode + ': Done leaves the editor open, saying it is not saved');
      T.eq(ed.el.querySelector('[role="alert"]').textContent, 'Not saved. The drawing stays open.', mode + ': and says so out loud');
      T.eq(ink.isDirty(), true, mode + ': still something to keep');
      var svg = ed.close();
      if (mode === 'reject') {
        T.eq(ink.isDirty() + ',' + closes.length, 'true,0', mode + ': closed by the host, it stays dirty until the host has answered');
        await T.until(function () { return closes.length === 1; }, 3000, 'the late onClose');
      }
      T.eq(closes.length + ',' + closes[0].saved, '1,false', mode + ': the host is told the truth');
      T.ok(typeof svg === 'string' && closes[0].svg === svg && ink.parse(svg).elements.length === 1, mode + ': and handed the drawing, to keep it another way');
      T.eq(ink.isDirty(), false, mode + ': nothing left in the editor');
    }
  });

  T.test('Done waits for a slow save, and tries again after a failure', async function () {
    var answer = null;
    var closes = [];
    var tries = 0;
    var ed = ink.open(host, {
      focus: false,
      onSave: function () {
        tries++;
        return new Promise(function (resolve) { answer = resolve; });
      },
      onClose: function (info) { closes.push(info); }
    });
    ed.setCamera({ x: 0, y: 0, k: 1 });
    drag(ed, line(100, 100, 300, 140, 8));
    ed.done();
    T.eq(tries + ',' + ed.saveState() + ',' + closes.length + ',' + ed.isDirty(), '1,saving,0,true', 'handed over, waiting');
    ed.done();
    T.eq(tries, 1, 'pressing Done again while waiting does nothing more');
    answer(false);
    await T.until(function () { return ed.saveState() === 'failed'; }, 2000, 'the refusal');
    T.eq(!!ed.el.parentNode + ',' + closes.length, 'true,0', 'refused: the editor stays');
    ed.done();
    T.eq(tries, 2, 'Done again tries again');
    answer(true);
    await T.until(function () { return closes.length === 1; }, 2000, 'the close');
    T.eq(closes[0].saved + ',' + !!ed.el.parentNode + ',' + ink.isDirty(), 'true,false,false', 'kept: it closes');
  });

  T.test('an open text field is unsaved work only when it holds new words', function () {
    var ed = ink.open(host, { onSave: function () {}, focus: false });
    ed.setCamera({ x: 0, y: 0, k: 1 });
    ed.setTool('text');
    var surface = ed.el.querySelector('.ink__surface');
    fire(surface, 'pointerdown', 200, 300, { id: ++pid });
    fire(surface, 'pointerup', 200, 300, { id: pid });
    var ta = ed.el.querySelector('.ink__text');
    T.eq(!ta.hidden + ',' + ed.isDirty() + ',' + ink.isDirty(), 'true,false,false', 'an empty field is nothing to save');
    ta.value = '   ';
    T.eq(ed.isDirty(), false, 'nor are spaces');
    ta.value = 'hello';
    T.eq(ed.isDirty(), true, 'words are');
    ed.save();
    T.eq(ed.isDirty(), false, 'saved');
    var t0 = ed.elements().filter(function (x) { return x.type === 'text'; })[0];
    ed.setTool('select');
    ed.select([t0.id]);
    ed.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    T.eq(!ta.hidden + ',' + ta.value + ',' + ed.isDirty(), 'true,hello,false', 'a text opened and left as it was is nothing to save');
    ta.value = 'hello!';
    T.eq(ed.isDirty(), true, 'changed, it is');
    ed.save();
    var t1 = ed.elements().filter(function (x) { return x.type === 'text'; })[0];
    T.eq(t1.id + ',' + t1.text + ',' + ta.hidden, t0.id + ',hello!,true', 'and saving writes the change into the same text');
    ed.close();

    var trailing = ink.serialize({ elements: [E.makeText(10, 10, 'line  \nother  ', { id: 'tr', size: 20, color: '#1f2328' })] });
    var ed2 = ink.open(host, { svgText: trailing, onSave: function () {}, focus: false });
    var before = ed2.elements()[0];
    ed2.setTool('select');
    ed2.select(['tr']);
    ed2.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    T.eq(ed2.isDirty(), false, 'a text from a file with spaces at its end, opened: nothing to save');
    ed2.el.querySelector('.ink__text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    T.eq(ed2.elements()[0] === before && !ed2.isDirty() && ed2.history().undo === 0, true, 'and given back untouched: the same element, no undo step');
    ed2.close();
  });

  T.test('the save state is said aloud only when it means something', async function () {
    var saves = 0;
    var ok = true;
    var ed = ink.open(host, { onSave: function () { saves++; return ok; }, focus: false });
    ed.setCamera({ x: 0, y: 0, k: 1 });
    ed.setTool('pen');
    var said = [];
    var status = ed.el.querySelector('[role="status"]');
    new MutationObserver(function () { if (status.textContent) said.push(status.textContent); }).observe(status, { childList: true, characterData: true, subtree: true });
    for (var i = 0; i < 3; i++) {
      drag(ed, line(100, 100 + i * 40, 300, 140 + i * 40, 8));
      ed.save();
      await T.sleep(0);
    }
    ok = false;
    drag(ed, line(100, 300, 300, 340, 8));
    ed.save();
    await T.sleep(0);
    ok = true;
    ed.save();
    await T.sleep(0);
    T.eq(saves, 5, 'five saves');
    T.same(said, ['Saved', 'Not saved', 'Saved'], 'the first save, the failure, and the save after it; not every stroke');
    ed.close();
  });

  T.test('keys the browser or the app would take are kept or passed on purpose', function () {
    var ed = ink.open(host, { onSave: function () {} });
    var seen = [];
    function listen(e) { seen.push(e.key + ':' + e.defaultPrevented); }
    document.addEventListener('keydown', listen);
    function key(target, k, mods) {
      var e = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {}));
      target.dispatchEvent(e);
      return e;
    }
    var d = key(ed.el, 'd', { ctrlKey: true });
    T.eq(d.defaultPrevented + ',' + seen.length, 'true,0', 'Mod+D with nothing selected is still the editor\'s (no bookmark dialog, nothing on the map)');
    ed.setCamera({ x: 0, y: 0, k: 1 });
    drag(ed, line(100, 100, 300, 140, 8));
    ed.setTool('text');
    var surface = ed.el.querySelector('.ink__surface');
    fire(surface, 'pointerdown', 200, 300, { id: ++pid });
    fire(surface, 'pointerup', 200, 300, { id: pid });
    var ta = ed.el.querySelector('.ink__text');
    ta.value = 'abc';
    var typed = key(ta, 'x');
    T.eq(seen.length + ',' + typed.defaultPrevented, '0,false', 'typing stays in the field');
    var save = key(ta, 's', { ctrlKey: true });
    T.same(seen, ['s:false'], 'Mod+S from the text field goes on to the app, untouched');
    T.eq(ta.hidden + ',' + ed.isDirty() + ',' + ed.saveState(), 'true,false,saved', 'the words put on the sheet and the drawing saved first');
    key(ed.el, 'k', { metaKey: true });
    T.eq(seen.length, 2, 'Mod+K goes on to the app as well');
    document.removeEventListener('keydown', listen);
    ed.close();
  });

  T.test('the history, step by step', function () {
    var ed = ink.open(host, { onSave: function () {}, focus: false });
    ed.setCamera({ x: 0, y: 0, k: 1 });
    ed.setTool('pen');
    T.same(ed.history(), { undo: 0, redo: 0 }, 'empty');
    drag(ed, line(100, 100, 300, 140, 8));
    drag(ed, line(100, 200, 300, 240, 8));
    T.same(ed.history(), { undo: 2, redo: 0 }, 'a step a stroke');
    ed.undo();
    T.same(ed.history(), { undo: 1, redo: 1 }, 'undo moves one');
    ed.close();
  });
})();
