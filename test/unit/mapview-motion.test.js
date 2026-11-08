/* mapview-motion: the pure parts of the gesture layer and the view.
 *
 * The motion maths in js/map/gestures.js (rubber band, fling projection,
 * zoom about a point, the cubic-bezier solver that lets JS move on the CSS
 * curves, reading the motion tokens, velocity from samples, the timed and
 * open-ended frame loops landing even without frames) and the node markup
 * js/map/mapview.js builds (escaping, room classes, picture placement,
 * which changes re-measure a node and which do not, which keep its element
 * through a change of depth), and how folds follow their nodes through an
 * edit. Loaded without the core modules: the map files must stand alone. */
(function () {
  'use strict';

  var G = window.MindRoot.gestures;
  var V = window.MindRoot.mapview;

  function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

  T.test('rubber band: follows less and less, never past dim', function () {
    T.eq(G.rubberBand(0, 400), 0, 'nothing over, nothing banded');
    var a = G.rubberBand(50, 400);
    var b = G.rubberBand(500, 400);
    var c = G.rubberBand(1e9, 400);
    T.ok(a > 0 && a < 50, 'banded less than the overshoot');
    T.ok(b > a && c > b, 'still growing');
    T.ok(c < 400, 'bounded by dim');
    T.ok(near(G.rubberBand(-50, 400), -a), 'symmetric');
    T.ok(near(G.rubberBand(100, 400, 0.55), 100 * 400 * 0.55 / (400 + 0.55 * 100)), "Apple's formula");
  });

  T.test('fling projection with d = 0.998', function () {
    T.ok(near(G.project(1), 499, 1e-9), '1 px/ms comes to rest 499 px on');
    T.ok(near(G.project(-0.5, 0.99), -49.5, 1e-9), 'a snappier decay, either way');
  });

  T.test('zoom about a point keeps that point still', function () {
    var cam = { x: 120, y: -40, k: 0.8 };
    var px = 300;
    var py = 200;
    var before = { x: (px - cam.x) / cam.k, y: (py - cam.y) / cam.k };
    var next = G.zoomAround(cam, 2.4, px, py);
    T.eq(next.k, 2.4, 'new scale');
    T.ok(near((px - next.x) / next.k, before.x) && near((py - next.y) / next.k, before.y), 'same map point under it');
  });

  T.test('cubic-bezier solver matches the browser curves', function () {
    var ease = G.bezier(0.25, 0.1, 0.25, 1);
    T.eq(ease(0), 0, 'starts at 0');
    T.eq(ease(1), 1, 'ends at 1');
    T.ok(near(ease(0.5), 0.8024033877399112, 1e-4), 'CSS ease at 0.5');
    var out = G.easing('cubic-bezier(0.23, 1, 0.32, 1)');
    var prev = 0;
    var mono = true;
    for (var i = 1; i <= 100; i++) { var v = out(i / 100); if (v < prev - 1e-9) mono = false; prev = v; }
    T.ok(mono, 'the house ease-out never runs backwards');
    T.ok(out(0.25) > 0.6, 'and front-loads the motion');
    T.ok(near(G.easing('linear')(0.3), 0.3), 'linear');
    T.ok(near(G.easing('ease')(0.5), ease(0.5)), 'named curves');
    T.ok(near(G.easing('nonsense')(0.25), out(0.25)), 'anything unreadable is the house ease-out');
  });

  T.test('durations read from the motion tokens', function () {
    T.eq(G.duration(' 220ms', 0), 220, 'milliseconds');
    T.eq(G.duration('.28s', 0), 280, 'seconds');
    T.eq(G.duration('1ms', 0), 1, 'reduced motion is 1 ms, not 0');
    T.eq(G.duration('', 220), 220, 'the fallback when the token is missing');
  });

  T.test('velocity from the last 100 ms of samples', function () {
    var s = [];
    for (var i = 0; i <= 10; i++) s.push({ t: i * 16, x: i * 8, y: -i * 4 });
    var v = G.velocity(s, 160);
    T.ok(near(v.x, 0.5, 1e-9) && near(v.y, -0.25, 1e-9), 'px per ms');
    T.same(G.velocity(s, 400), { x: 0, y: 0 }, 'a hand held still before release does not fling');
    T.same(G.velocity([{ t: 0, x: 0, y: 0 }], 0), { x: 0, y: 0 }, 'one sample is no speed');
  });

  T.test('a timed animation lands, even with no frames', function () {
    var seen = [];
    return new Promise(function (resolve) {
      G.animate(60, null, function (p) { seen.push(p); }, function (complete) {
        T.ok(complete, 'finished');
        T.eq(seen[seen.length - 1], 1, 'last step at 1');
        resolve();
      });
    }).then(function () {
      var stops = [];
      var a = G.animate(1000, null, function (p) { stops.push(p); }, function (complete) { stops.push(complete ? 'done' : 'stopped'); });
      a.stop();
      T.same(stops, ['stopped'], 'a stopped animation stays where it is');
      var instant = [];
      G.animate(0, null, function (p) { instant.push(p); });
      T.same(instant, [1], 'zero length lands at once');
    }).then(function () {
      var raf = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
      var landed = null;
      var started = Date.now();
      return new Promise(function (resolve) {
        G.animate(80, null, function (p) { landed = p; }, function () {
          window.requestAnimationFrame = raf;
          T.eq(landed, 1, 'with frames withheld it still lands (timeout)');
          T.ok(Date.now() - started < 1000, 'soon after its duration');
          resolve();
        });
      });
    });
  });

  T.test('an open-ended loop runs until its step says stop', function () {
    var n = 0;
    return new Promise(function (resolve) {
      G.frames(function () { n++; return n < 4; }, function (complete) {
        T.ok(complete, 'ended by the step');
        T.eq(n, 4, 'four steps');
        resolve();
      });
    });
  });

  function view(o) {
    var base = {
      path: '0', synthetic: false, depth: 1, kind: 'bullet', level: null, ordered: null, titleSize: null, role: null,
      html: 'Words', text: 'Words', task: null, images: [], imageAbove: false, drawAbove: false, body: null,
      notes: { node: null, edge: null }, color: '#2f7d5a', ownColor: false, branchIndex: 0, links: [], children: []
    };
    for (var k in o) base[k] = o[k];
    return base;
  }

  var OPTS = { notesOpen: false, readOnly: false };

  T.test('node markup: classes, escaping, never raw user text', function () {
    var c = V.contentHtml(view({ titleSize: 'h2', role: 'caption', task: { checked: true }, ordered: 3, notes: { node: '<b>x</b>', edge: null } }), { notesOpen: true, readOnly: true });
    T.ok(/\bmv-node\b/.test(c.cls) && /\bmv-d1\b/.test(c.cls) && /\bmv-h2\b/.test(c.cls) && /\bmv-caption\b/.test(c.cls) && /\bmv-node--done\b/.test(c.cls), 'classes from the view node: ' + c.cls);
    T.ok(c.html.indexOf('aria-checked="true"') > 0 && c.html.indexOf('aria-disabled="true"') > 0, 'a ticked, read-only task box');
    T.ok(c.html.indexOf('<span class="mv-num">3.</span>') > 0, 'the list number');
    T.ok(c.html.indexOf('&lt;b&gt;x&lt;/b&gt;') > 0 && c.html.indexOf('<b>x</b>') < 0, 'a note card is escaped');
    T.ok(c.html.indexOf('class="mv-note-dot"') > 0, 'a note dot inside the box');
    var bad = V.contentHtml(view({ titleSize: 'h9" onclick="x', images: [{ path: 'a.png', alt: '"><script>', kind: 'photo', side: 'left' }] }), OPTS);
    T.ok(bad.cls.indexOf('onclick') < 0, 'an unknown title size never reaches the class list');
    T.ok(bad.html.indexOf('<script>') < 0 && bad.html.indexOf('&quot;&gt;&lt;script&gt;') > 0, 'alt text is escaped');
    var depth = V.contentHtml(view({ depth: 9 }), OPTS);
    T.ok(/\bmv-d3\b/.test(depth.cls), 'deep nodes share the last depth step');
    T.ok(/mv-text--empty/.test(V.contentHtml(view({ html: '' }), OPTS).html), 'an empty line keeps a tappable box');
  });

  T.test('pictures: placement in DOM order, room by layout', function () {
    var img = function (kind, side) { return { path: kind + side + '.png', alt: '', kind: kind, side: side }; };
    function shape(v) {
      var c = V.contentHtml(view(v), OPTS);
      var box = document.createElement('div');
      box.innerHTML = c.html;
      var title = box.firstChild;
      var parts = Array.prototype.map.call(title.querySelectorAll('.mv-pics, .mv-text'), function (el) {
        return el.classList.contains('mv-text') ? 'text' : el.className.replace('mv-pics ', '').replace(/mv-pics--/g, '');
      });
      var room = /mv-node--(row|col|pair)/.exec(c.cls);
      return { parts: parts, room: room ? room[1] : '' };
    }
    T.same(shape({ images: [img('photo', 'left')] }), { parts: ['photo left', 'text'], room: 'row' }, 'left of the words');
    T.same(shape({ images: [img('photo', 'right')] }), { parts: ['text', 'photo right'], room: 'row' }, 'right of the words');
    T.same(shape({ images: [img('photo', 'left')], imageAbove: true }), { parts: ['photo above', 'text'], room: 'col' }, 'above: a column');
    T.same(shape({ images: [img('photo', 'left'), img('draw', 'right')] }), { parts: ['photo left', 'text', 'draw right'], room: 'pair' }, 'two beside: a pair');
    T.same(shape({ images: [img('draw', 'left'), img('photo', 'right')], drawAbove: true }), { parts: ['draw above', 'text', 'photo right'], room: 'row' }, 'one above, one beside: a row');
    var body = V.contentHtml(view({ body: { html: 'b', text: 'b', role: 'caption', images: [img('photo', 'left')], imageAbove: false, drawAbove: false } }), OPTS);
    T.ok(/mv-node--row/.test(body.cls), 'pictures in the body widen the box too');
    T.ok(/mv-body mv-role--caption/.test(body.html), 'the body role');
  });

  T.test('what re-measures a node and what does not', function () {
    var a = view({});
    T.eq(V.signature(a, OPTS), V.signature(view({}), OPTS), 'the same node, the same signature');
    T.eq(V.signature(view({ color: '#c2703d' }), OPTS), V.signature(a, OPTS), 'a colour change is not a re-measure');
    T.eq(V.signature(view({ notes: { node: null, edge: 'edge note' } }), OPTS), V.signature(a, OPTS), 'an edge note is not in the box');
    T.ok(V.signature(view({ html: 'Other' }), OPTS) !== V.signature(a, OPTS), 'new words are');
    T.ok(V.signature(view({ titleSize: 'h1' }), OPTS) !== V.signature(a, OPTS), 'a title size is');
    T.ok(V.signature(view({ depth: 2 }), OPTS) !== V.signature(a, OPTS), 'a new depth is (the type scale)');
    T.eq(V.contentSig(view({ depth: 2 }), OPTS), V.contentSig(a, OPTS), 'but the content is the same: an indent keeps the element');
    T.ok(V.contentSig(view({ html: 'Other', depth: 2 }), OPTS) !== V.contentSig(a, OPTS), 'new words at a new depth are new content');
    var noted = view({ notes: { node: 'one', edge: null } });
    T.eq(V.signature(noted, OPTS), V.signature(view({ notes: { node: 'two', edge: null } }), OPTS), 'with notes closed, the note text only changes a label');
    T.ok(V.signature(noted, { notesOpen: true }) !== V.signature(view({ notes: { node: 'two', edge: null } }), { notesOpen: true }), 'with notes open it changes the card');
  });

  T.test('folds follow their nodes through an edit', function () {
    var exists = function (list) { return function (p) { return list.indexOf(p) >= 0; }; };
    function carry(folds, moves, have) {
      return Array.from(V.carryFolds(new Set(folds), new Map(moves), exists(have))).sort();
    }
    /* small: '' > 0 (Alpha), 1 (Beta) > 1.1 (Beta two); a branch inserted first. */
    var shift = [['', ''], ['0', '1'], ['1', '2'], ['2', '3']];
    T.same(carry(['1'], shift, ['', '1', '2', '2.1', '3']), ['2'], 'a drawn folded node: to its new path');
    T.same(carry(['1', '1.1'], shift, ['', '1', '2', '2.1', '3']), ['2', '2.1'], 'a fold hidden inside it: along, at the same place under it');
    T.same(carry(['1'], [['', ''], ['0', '0'], ['1', null], ['2', '1']], ['', '0', '1']), [], 'a deleted node takes its fold (the sibling taking its path does not)');
    T.same(carry(['1.1'], [['', ''], ['1', null]], ['', '1', '1.1']), [], 'and the folds hidden under it');
    T.same(carry(['5'], [['', '']], ['', '5']), ['5'], 'a fold under the root keeps its path when the root stays');
    T.same(carry(['0', '1'], [], ['0', '1']), ['0', '1'], 'nothing known about them: they stay (several top nodes, nothing drawn)');
    T.same(carry(['1'], shift, ['', '1', '3']), [], 'a node that lost its children loses its fold');
    T.same(carry([], shift, ['']), [], 'no folds, no work');
  });

  T.test('the view exports its limits', function () {
    T.eq(V.MIN_K, 0.1, 'min zoom');
    T.eq(V.MAX_K, 4, 'max zoom');
    T.same(V.GAPS, { gapX: 72, gapY: 12, cousinGap: 24 }, 'the layout gaps the contract names');
  });
})();
