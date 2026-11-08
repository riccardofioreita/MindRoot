/* MindRoot - paper on the infinite canvas: only the visible rectangle is
 * generated, patterns are anchored to the origin (strips line up), the
 * density is capped at every zoom, line widths stay calm on screen, every
 * paper is valid SVG that an <img> can show, and it is fast. */
(function () {
  'use strict';
  var P = window.MindRoot.paper;
  var H = window.PaperTest;
  var MM = P.MM;
  var A4 = { w: 210 * MM, h: 297 * MM };

  function view(type, x, y, w, h, scale, more) {
    var o = { mode: 'infinite', x: x, y: y, w: w, h: h, scale: scale };
    for (var k in more || {}) o[k] = more[k];
    return P.patternSvg({ type: type }, o);
  }
  function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.02 : tol); }
  function mod(a, b) { var m = a % b; if (m < 0) m += b; return Math.min(m, b - m); }

  var LINE_PAPERS = ['grid-4', 'grid-5', 'grid-10', 'ruled-narrow', 'ruled', 'ruled-wide', 'ruled-margin', 'school-1', 'school-2',
    'millimetre', 'semilog', 'log-log', 'isometric', 'cartesian', 'staff', 'grand-staff', 'guitar-tab', 'grid-8pt', 'calligraphy',
    'cornell', 'two-columns', 'weekly', 'todo', 'storyboard', 'wireframe-browser', 'wireframe-phone'];

  T.test('only the visible rectangle: every segment inside it', function () {
    var rects = [[-300, -200, 800, 500], [12345.6, -9876.5, 640, 360], [-50000, 70000, 2000, 1200]];
    var bad = [];
    LINE_PAPERS.forEach(function (id) {
      [0.3, 1, 3].forEach(function (k) {
        rects.forEach(function (r) {
          var f = view(id, r[0], r[1], r[2] / k, r[3] / k, k);
          H.segs(f).forEach(function (s) {
            if (s.kind !== 'h' && s.kind !== 'v' && s.kind !== 'l') return;
            var pad = 0.05;
            var x0 = r[0] - pad;
            var y0 = r[1] - pad;
            var x1 = r[0] + r[2] / k + pad;
            var y1 = r[1] + r[3] / k + pad;
            /* Page layouts draw whole frames of the cells they touch: for
             * them the bound is the union of those A4 cells. */
            if (P.isCellPaper(id)) {
              x0 = Math.floor(r[0] / A4.w) * A4.w - pad;
              y0 = Math.floor(r[1] / A4.h) * A4.h - pad;
              x1 = (Math.floor((r[0] + r[2] / k) / A4.w) + 1) * A4.w + pad;
              y1 = (Math.floor((r[1] + r[3] / k) / A4.h) + 1) * A4.h + pad;
            }
            var inside = function (x, y) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
            if (!inside(s.x1, s.y1) || !inside(s.x2, s.y2)) bad.push(id + '@' + k + ' ' + JSON.stringify(s));
          });
        });
      });
    });
    T.same(bad.slice(0, 5), [], 'segments outside the view');
  });

  T.test('anchored to the origin: two strips line up', function () {
    ['grid-5', 'millimetre', 'isometric', 'ruled', 'staff', 'calligraphy', 'grid-8pt'].forEach(function (id) {
      var a = view(id, 0, 0, 400, 300, 1);
      var b = view(id, 400, 0, 400, 300, 1);
      var both = view(id, 0, 0, 800, 300, 1);
      var ya = H.uniqueSorted(H.segs(a, 'h').map(function (s) { return s.y1; }));
      var yb = H.uniqueSorted(H.segs(b, 'h').map(function (s) { return s.y1; }));
      T.same(ya, yb, id + ': rows at the same heights in both strips');
      var count = function (f) { return H.segs(f).length; };
      T.ok(count(both) >= count(a) && count(both) <= count(a) + count(b) + 2, id + ': the whole is the sum of the strips');
    });
    var g = view('grid-5', -1234.5, 777.7, 500, 500, 1);
    var step = 5 * MM;
    var off = H.segs(g, 'v').filter(function (s) { return mod(s.x1, step) > 0.02; });
    T.eq(off.length, 0, 'every vertical of the 5 mm grid at k * 5 mm from the origin');
    var d = H.parse(view('dots', -1234.5, 777.7, 500, 500, 1)).getElementsByTagName('pattern')[0];
    var dotX = parseFloat(d.getAttribute('x')) + parseFloat(d.getElementsByTagName('circle')[0].getAttribute('cx'));
    T.ok(mod(dotX, step) < 0.02, 'dots at multiples of 5 mm');
    var hex = H.parse(view('honeycomb', 300, 300, 500, 500, 1)).getElementsByTagName('pattern')[0];
    T.ok(near(parseFloat(hex.getAttribute('x')), 0), 'honeycomb anchored at the origin');
    var polar = H.paths(view('polar', -400, -300, 800, 600, 1));
    var circles = [];
    polar.forEach(function (p) { circles = circles.concat(p.circles); });
    T.ok(circles.length > 5 && circles.every(function (c) { return near(c.cx, 0) && near(c.cy, 0); }), 'polar centred on the origin');
    var semi = view('semilog', -300, -2000, 600, 4000, 0.5);
    var decades = H.uniqueSorted(H.segs(semi, 'h', 'mr-strong').map(function (s) { return s.y1; }));
    T.ok(decades.every(function (y) { return mod(y, 90 * MM) < 0.03; }), 'decades at multiples of 90 mm');
    var cells = view('weekly', -100, -100, 2000, 2000, 0.5);
    var texts = H.texts(cells);
    T.ok(texts.length >= 8, 'page layouts repeat in cells');
  });

  T.test('fine lines fade out and coarse lines thin out when zoomed out', function () {
    function fineAt(k) {
      var f = view('millimetre', 0, 0, 1000 / k, 800 / k, k);
      var xs = H.uniqueSorted(H.segs(f, 'v').map(function (s) { return s.x1; }));
      return Math.min.apply(null, H.diffs(xs));
    }
    T.ok(near(fineAt(4), MM, 0.02), '1 mm lines when zoomed in');
    T.ok(fineAt(0.4) >= 5 * MM - 0.02, 'no 1 mm lines at 0.4');
    var mmLines = H.paths(view('millimetre', 0, 0, 1000, 800, 1)).filter(function (p) { return p.cls === 'mr-line'; });
    var alphas = H.uniqueSorted(mmLines.map(function (p) { return p.opacity; }), 0.001);
    T.ok(alphas[0] < 0.6, 'at 1:1 the 1 mm lines are faded: ' + alphas.join(','));
    [0.02, 0.05, 0.1, 0.25, 1, 4, 8].forEach(function (k) {
      var W = 1600;
      var Hh = 1000;
      var f = view('grid-5', -W / 2 / k, -Hh / 2 / k, W / k, Hh / k, k);
      var xs = H.uniqueSorted(H.segs(f, 'v').map(function (s) { return s.x1; }));
      var minGap = Math.min.apply(null, H.diffs(xs)) * k;
      T.ok(xs.length >= 2, 'grid still shows at zoom ' + k + ' (' + xs.length + ' lines)');
      T.ok(minGap >= 2.5 - 0.01, 'lines at least 2.5 screen px apart at zoom ' + k + ': ' + minGap.toFixed(2));
      T.ok(xs.length <= W / 2.5 + 2, 'no more lines than the screen can show at zoom ' + k);
    });
  });

  T.test('density capped at any zoom: bounded output for every paper', function () {
    var report = [];
    var worst = { bytes: 0 };
    var zooms = [0.004, 0.02, 0.05, 0.1, 0.13, 0.15, 0.165, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 3, 8];
    var centres = [[1000, -500], [777, -333], [0, 0], [-123456.7, 98765.4]];
    P.CATALOG.forEach(function (e) {
      zooms.forEach(function (k) {
        centres.forEach(function (c) {
          var W = 2560;
          var Hh = 1440;
          var t0 = performance.now();
          var f = view(e.id, c[0] - W / 2 / k, c[1] - Hh / 2 / k, W / k, Hh / k, k);
          var ms = performance.now() - t0;
          var segs = H.segs(f).length;
          if (f.length > worst.bytes) worst = { bytes: f.length, at: e.id + '@' + k };
          if (f.length > 200000 || segs > 6000) report.push(e.id + '@' + k + ' (' + c + ') ' + f.length + 'B ' + segs + ' segs');
          if (ms > 60) report.push(e.id + '@' + k + ' ' + ms.toFixed(1) + ' ms');
        });
      });
    });
    T.same(report, [], 'every paper under 200 kB, 6000 segments and 60 ms for a 2560 x 1440 view (largest: ' + worst.bytes + ' B, ' + worst.at + ')');
    var huge = view('millimetre', -1e6, -1e6, 2e6, 2e6, 1);
    T.ok(huge.length < 600000, 'a caller asking for a huge rectangle at 1:1 still gets a bounded answer: ' + huge.length);
    var far = view('polar', 1e7, 1e7, 1000, 800, 1);
    T.ok(H.parse(far) && far.length < 600000, 'polar far from the origin');
  });

  T.test('stroke widths stay between a hairline and a calm maximum on screen', function () {
    [0.1, 0.5, 1, 2, 6].forEach(function (k) {
      var ps = H.paths(view('millimetre', 0, 0, 1000 / k, 800 / k, k)).filter(function (p) { return !p.filled; });
      ps.forEach(function (p) {
        var screen = p.width * k;
        T.ok(screen >= 0.44 && screen <= 2.1, 'zoom ' + k + ' ' + p.cls + ' ' + screen.toFixed(2) + ' px');
      });
    });
  });

  T.test('print: every line shows at 1:1', function () {
    var screen = H.segs(P.patternSvg({ type: 'millimetre' }, { mode: 'page', w: 793.7, h: 1122.5, scale: 0.5 }), 'v').length;
    var print = H.segs(P.patternSvg({ type: 'millimetre' }, { mode: 'page', w: 793.7, h: 1122.5, scale: 0.5, print: true }), 'v').length;
    T.ok(print > screen, 'print draws the 1 mm lines a small screen leaves out');
    T.eq(print, 191, 'every mm of 19 cm');
  });

  T.test('every paper is valid SVG and shows in an <img>, light and dark', function () {
    var jobs = [];
    P.CATALOG.forEach(function (e) {
      ['light', 'dark'].forEach(function (theme) {
        var svg = P.pageSvg({ type: e.id }, { size: { id: 'a4' }, theme: theme });
        jobs.push(H.decodes(svg).then(function (r) {
          T.ok(r.ok && near(r.w, 793.7, 1) && near(r.h, 1122.52, 1), e.id + ' ' + theme + ' decodes at A4');
        }));
      });
      var land = P.pageSvg({ type: e.id }, { size: { id: 'a5', orientation: 'landscape' }, background: '#1e3a5f', scale: 0.3 });
      jobs.push(H.decodes(land).then(function (r) { T.ok(r.ok && r.w > r.h, e.id + ' A5 landscape on a custom colour'); }));
      var inf = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-200 -100 400 200" width="400" height="200">' + view(e.id, -200, -100, 400, 200, 1) + '</svg>';
      jobs.push(H.decodes(inf).then(function (r) { T.ok(r.ok, e.id + ' infinite view decodes'); }));
    });
    return Promise.all(jobs);
  });

  T.test('pattern ids are unique per call unless the caller names them', function () {
    var a = H.parse(view('dots', 0, 0, 100, 100, 1)).getElementsByTagName('pattern')[0].id;
    var b = H.parse(view('dots', 0, 0, 100, 100, 1)).getElementsByTagName('pattern')[0].id;
    T.ok(a !== b, 'two calls, two ids');
    var named = H.parse(view('dots', 0, 0, 100, 100, 1, { id: 'page 3"<x>' })).getElementsByTagName('pattern')[0].id;
    T.eq(named, 'page3x-dots', 'named, cleaned');
  });

  T.test('a tile size for page layouts on the canvas', function () {
    var a5 = { w: 148 * MM, h: 210 * MM };
    var f = view('todo', 0, 0, a5.w * 2 - 1, a5.h - 1, 1, { tile: a5 });
    var titles = H.segs(f, 'h', 'mr-strong').filter(function (s) { return Math.abs(s.x2 - s.x1) > 300; });
    T.eq(titles.length, 2, 'two A5 cells side by side');
    T.ok(near(titles[1].x1 - titles[0].x1, a5.w, 0.05), 'one A5 apart');
    var bySize = view('todo', 0, 0, a5.w * 2 - 1, a5.h - 1, 1, { size: { id: 'a5' } });
    var t2 = H.segs(bySize, 'h', 'mr-strong').filter(function (s) { return Math.abs(s.x2 - s.x1) > 300; });
    T.ok(t2.length === 2 && near(t2[1].x1 - t2[0].x1, a5.w, 0.05), 'on the canvas, the book size given as size is the cell size');
    var far = view('weekly', 0, 0, 100000, 100000, 0.004);
    T.ok(far.length < 600000, 'a whole field of cells is bounded');
    T.eq(view('grid-5', 0, 0, 0, 100, 1), '', 'empty rectangle on the canvas: nothing');
  });

  T.test('the contract call (no mode) is the infinite canvas: paper does not swim', function () {
    var step = 5 * MM;
    [0, 10, 20, 333.3, -71.5].forEach(function (x) {
      var f = P.patternSvg({ type: 'grid-5' }, { x: x, y: 0, w: 800, h: 600 });
      var v = H.segs(f, 'v');
      T.ok(v.length > 10 && v.every(function (s) { return mod(s.x1, step) < 0.02; }), 'verticals at k * 5 mm for x = ' + x);
    });
    var rule = 7.1 * MM;
    [0, 100, -250.25].forEach(function (y) {
      var h = H.segs(P.patternSvg({ type: 'ruled' }, { x: 0, y: y, w: 800, h: 600 }), 'h');
      T.ok(h.length > 5 && h.every(function (s) { return mod(s.y1, rule) < 0.02; }), 'rules at k * 9/32 in for y = ' + y);
      T.ok(near(Math.min.apply(null, h.map(function (s) { return s.y1; })), Math.ceil(y / rule - 1e-9) * rule, 0.03), 'first rule is the first multiple inside the view for y = ' + y);
    });
    var a = P.patternSvg({ type: 'weekly' }, { x: 0, y: 0, w: 2000, h: 1300, scale: 0.6 });
    T.ok(H.texts(a).length >= 8, 'page layouts repeat in cells by default');
    var paged = P.patternSvg({ type: 'ruled' }, { page: true, w: A4.w, h: A4.h });
    T.ok(near(H.uniqueSorted(H.segs(paged, 'h').map(function (s) { return s.y1; }))[0], 22 * MM, 0.03), 'page: true asks for a page (rules from the top margin)');
    var sized = P.patternSvg({ type: 'ruled' }, { size: { id: 'a5' } });
    var sheet = H.parse(sized).querySelector('rect.mr-sheet');
    T.ok(near(parseFloat(sheet.getAttribute('width')), 148 * MM, 0.02) && near(parseFloat(sheet.getAttribute('height')), 210 * MM, 0.02), 'a book size asks for that page');
    var forced = H.segs(P.patternSvg({ type: 'ruled' }, { mode: 'infinite', size: 'a4', x: 0, y: 0, w: A4.w, h: A4.h }), 'h');
    T.ok(near(Math.min.apply(null, forced.map(function (s) { return s.y1; })), 0), 'an explicit mode wins over a size (rules from the origin, no top margin)');
  });

  T.test('cell papers stay cheap just above the outline threshold', function () {
    ['weekly', 'todo', 'wireframe-phone', 'wireframe-browser', 'storyboard', 'cornell', 'two-columns'].forEach(function (id) {
      [0.13, 0.15, 0.165, 0.2, 0.3].forEach(function (k) {
        var W = 2560;
        var Hh = 1440;
        var f = view(id, 777 - W / 2 / k, -333 - Hh / 2 / k, W / k, Hh / k, k);
        T.ok(f.length < 120000, id + '@' + k + ': ' + f.length + ' B');
        T.ok(H.parse(f).querySelector('path, rect[fill^="url"]'), id + '@' + k + ': something drawn');
      });
    });
    var far = H.parse(view('weekly', -1e5, -1e5, 2e5, 2e5, 0.02));
    T.eq(far.getElementsByTagName('pattern').length, 1, 'far out: one pattern of page outlines');
    T.eq(H.segs(view('weekly', -1e5, -1e5, 2e5, 2e5, 0.02)).length, 0, 'and no per-cell paths');
    var close = view('weekly', 0, 0, 2560 / 0.8, 1440 / 0.8, 0.8);
    T.ok(H.texts(close).some(function (t) { return t.text === 'Monday'; }), 'close: the full planner with its days');
  });

  T.test('honeycomb never vanishes: it coarsens like the other papers', function () {
    [0.02, 0.05, 0.1, 0.13, 0.3, 1].forEach(function (k) {
      var root = H.parse(view('honeycomb', -1000, -1000, 2560 / k, 1440 / k, k));
      var pat = root.getElementsByTagName('pattern')[0];
      T.ok(!!pat, 'a honeycomb at zoom ' + k);
      if (!pat) return;
      var side = parseFloat(pat.getAttribute('width')) / 3;
      T.ok(side * k >= 5 - 0.01, 'cells at least 5 px on screen at zoom ' + k + ': ' + (side * k).toFixed(2));
      var power = Math.log2(side / (5 * MM));
      T.ok(near(power, Math.round(power), 1e-3), 'side a power of two of 5 mm at zoom ' + k + ': 2^' + power.toFixed(4));
      var op = parseFloat(pat.getElementsByTagName('path')[0].getAttribute('stroke-opacity') || '1');
      T.ok(op >= 0.5, 'visible at zoom ' + k + ': ' + op);
    });
    var thumb = H.parse(P.pageSvg({ type: 'honeycomb' }, { size: 'a4', scale: 0.12 }));
    T.eq(thumb.getElementsByTagName('pattern').length, 1, 'a page thumbnail at 0.12 shows the honeycomb');
  });

  T.test('the paper group is decoration: hidden from screen readers, no pointer events', function () {
    P.CATALOG.forEach(function (e) {
      var g = H.parse(view(e.id, 0, 0, 400, 300, 1)).querySelector('g.mr-paper');
      T.ok(g && g.getAttribute('aria-hidden') === 'true' && g.getAttribute('pointer-events') === 'none', e.id);
    });
  });

  T.test('hostile parameters from book.json are clamped, rendering stays bounded', function () {
    T.eq(P.normalize({ type: 'polar', ray: 0.001 }).params.ray, 1, 'ray at least 1 degree');
    T.eq(P.normalize({ type: 'polar', ray: 400 }).params.ray, 90, 'ray at most 90 degrees');
    T.eq(P.normalize({ type: 'grid-8pt', every: 0.5 }).params.every, 1, 'every a whole number, at least 1');
    T.eq(P.normalize({ type: 'grid-8pt', every: 3.5 }).params.every, 4, 'every rounded');
    T.eq(P.normalize({ type: 'grid-8pt', every: 1e9 }).params.every, 64, 'every at most 64');
    T.eq(P.normalize({ type: 'grid-5', step: 0.0001 }).params.step, 0.5, 'lengths at least half a millimetre');
    T.eq(P.normalize({ type: 'grid-5', step: 1e12 }).params.step, 1000, 'lengths at most a metre');
    T.eq(P.normalize({ type: 'grid-5', step: -3 }).params.step, 5, 'a negative value is ignored');
    T.eq(P.normalize({ type: 'grid-5', step: 'NaN' }).params.step, 5, 'not a number: ignored');
    T.eq(P.normalize({ type: 'grid-5', step: [7] }).params.step, 5, 'an array is not a number');
    T.eq(P.normalize({ type: 'grid-5', step: '6' }).params.step, 6, 'a numeric string is read');
    T.eq(P.normalize({ type: 'storyboard', lines: 1e6 }).params.lines, 20, 'note lines at most 20');
    var t0 = performance.now();
    var hostile = [
      { type: 'polar', ray: 0.001, ring: 0.001 },
      { type: 'grid-8pt', stepPx: 0.0001, every: 0.5 },
      { type: 'calligraphy', slantStep: 0.0001, xHeight: 0.0001, ascender: 0.0001, descender: 0.0001, gap: 0.0001 },
      { type: 'storyboard', lines: 1e6, step: 0.0001 },
      { type: 'todo', step: 0.0001, box: 0.0001 },
      { type: 'school-1', band: 0.0001, gap: 0.0001 },
      { type: 'staff', space: 0.0001, period: 0.0001 }
    ];
    hostile.forEach(function (paper) {
      [0.1, 1, 6].forEach(function (k) {
        var f = P.patternSvg(paper, { mode: 'page', w: A4.w, h: A4.h, scale: k });
        T.ok(f.length < 400000, paper.type + ' page @' + k + ': ' + f.length + ' B');
        var g = P.patternSvg(paper, { x: -500, y: -500, w: 2560 / k, h: 1440 / k, scale: k });
        T.ok(g.length < 400000, paper.type + ' canvas @' + k + ': ' + g.length + ' B');
      });
      var pr = P.patternSvg(paper, { mode: 'page', w: A4.w, h: A4.h, print: true });
      T.ok(pr.length < 2000000, paper.type + ' print: ' + pr.length + ' B');
    });
    T.ok(performance.now() - t0 < 2000, 'all of it quickly: ' + (performance.now() - t0).toFixed(0) + ' ms');
    var odd = H.segs(P.patternSvg({ type: 'polar', ray: 7 }, { mode: 'page', w: A4.w, h: A4.h, print: true }), 'l', 'mr-strong');
    T.eq(odd.length, 4, 'a step that does not divide 90 still draws the four axes');
  });
})();
