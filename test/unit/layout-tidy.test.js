/* layout-tidy: the pure tidy-tree layout (js/map/layout.js).
 *
 * Random trees of random box sizes (seeded, so a failure reproduces), in
 * every first-level branch on the right, on sides chosen by markers, and
 * the legacy balanced layout, with and without a synthetic root: no two
 * boxes overlap
 * and keep at least the sibling gap; no link crosses a box; parents sit
 * midway between their first and last child; children start gapX past their
 * parent on the right, and end gapX before it on the left; siblings stay in
 * document order top to bottom; each branch grows on the side its marker
 * says; the legacy balance splits them; the bounds are
 * exactly the union of the boxes (plus knobs); folds hide subtrees; the
 * result is deterministic; 2,000 nodes lay out fast. */
(function () {
  'use strict';

  var L = window.MindRoot.layout;
  var GAP_X = 72;
  var GAP_Y = 12;

  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* A random tree: random parents (fans and chains both happen), boxes from
   * 20x18 to 340x260 with the base somewhere in the box. */
  function randomTree(seed, n, synthetic, marked) {
    var r = rng(seed);
    var sizes = {};
    var count = 0;
    function make(path, depth) {
      var h = 18 + Math.floor(r() * (r() < 0.12 ? 240 : 40));
      sizes[path] = { w: 20 + Math.floor(r() * 320), h: h, base: Math.max(10, Math.min(h, 16 + Math.floor(r() * h))) };
      count++;
      return { path: path, depth: depth, children: [] };
    }
    var root = synthetic ? { path: null, synthetic: true, depth: 0, children: [] } : make('', 0);
    var all = [root];
    while (count < n) {
      var p = all[Math.floor(r() * all.length)];
      if (p.depth > 7 && r() < 0.85) continue;
      var path = p.path === null || p.path === '' ? String(p.children.length) : p.path + '.' + p.children.length;
      var c = make(path, p.depth + 1);
      p.children.push(c);
      all.push(c);
    }
    /* Side markers on the first-level branches (and, ignored, deeper). */
    if (marked) {
      all.forEach(function (node) { node.side = r() < 0.5 ? 'left' : 'right'; });
    }
    return { tree: root, sizes: sizes };
  }

  /* The modes every random check runs in. */
  var MODES = [
    { name: 'right', marked: false, opts: {} },
    { name: 'marked', marked: true, opts: {} },
    { name: 'balance', marked: false, opts: { balance: true } }
  ];

  function overlaps(a, b, gap) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  }

  function boxOverlaps(res, gap) {
    var paths = Object.keys(res.nodes);
    var bad = [];
    for (var i = 0; i < paths.length; i++) {
      for (var j = i + 1; j < paths.length; j++) {
        var a = res.nodes[paths[i]];
        var b = res.nodes[paths[j]];
        /* Boxes that share x must be at least `gap` apart vertically. */
        if (a.w && b.w && overlaps(a, b, gap - 0.5)) bad.push(paths[i] + ' / ' + paths[j]);
      }
    }
    return bad;
  }

  function linkCrossings(res) {
    var paths = Object.keys(res.nodes);
    var hits = [];
    res.links.forEach(function (l) {
      var mx = (l.x1 + l.x2) / 2;
      for (var t = 0.04; t < 0.97; t += 0.04) {
        var u = 1 - t;
        var x = u * u * u * l.x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * l.x2;
        var y = u * u * u * l.y1 + 3 * u * u * t * l.y1 + 3 * u * t * t * l.y2 + t * t * t * l.y2;
        for (var i = 0; i < paths.length; i++) {
          if (paths[i] === l.from || paths[i] === l.to) continue;
          var b = res.nodes[paths[i]];
          if (x > b.x + 0.5 && x < b.x + b.w - 0.5 && y > b.y + 0.5 && y < b.y + b.h - 0.5) { hits.push(l.to + ' over ' + paths[i]); return; }
        }
      }
    });
    return hits;
  }

  function childrenOf(res, path) {
    return res.order.filter(function (p) { return res.nodes[p].parent === path; });
  }

  T.test('an empty tree lays out to nothing', function () {
    var res = L.layout(null, {}, {});
    T.same(res.nodes, {}, 'no nodes');
    T.same(res.links, [], 'no links');
    T.same(res.bounds, { x: 0, y: 0, w: 0, h: 0 }, 'empty bounds');
  });

  T.test('a single root sits at the origin', function () {
    var res = L.layout({ path: '', children: [] }, { '': { w: 120, h: 30, base: 28 } }, {});
    T.same(res.nodes[''], { x: 0, y: 0, w: 120, h: 30, base: 28, side: null, depth: 0, parent: null, hasKids: false, folded: false, hub: true }, 'root record');
    T.same(res.bounds, { x: 0, y: 0, w: 120, h: 30 }, 'bounds are the box');
    T.eq(res.links.length, 0, 'no links');
  });

  T.test('sizes may be a Map; a missing size is an empty box', function () {
    var tree = { path: '', children: [{ path: '0', children: [] }, { path: '1', children: [] }] };
    var m = new Map([['', { w: 50, h: 20, base: 18 }], ['0', { w: 30, h: 20, base: 18 }]]);
    var res = L.layout(tree, m, {});
    T.eq(res.nodes['0'].w, 30, 'read from the Map');
    T.eq(res.nodes['1'].w, 0, 'missing: zero width');
    T.eq(res.nodes['1'].h, 0, 'missing: zero height');
    T.ok(res.nodes['1'].y >= res.nodes['0'].y + 20, 'still placed after its sibling');
  });

  T.test('children start gapX past their parent and keep document order', function () {
    var tree = { path: '', children: [{ path: '0', children: [] }, { path: '1', children: [] }, { path: '2', children: [] }] };
    var sizes = { '': { w: 100, h: 30, base: 28 }, '0': { w: 60, h: 20, base: 18 }, '1': { w: 80, h: 40, base: 22 }, '2': { w: 50, h: 20, base: 18 } };
    var res = L.layout(tree, sizes, {});
    ['0', '1', '2'].forEach(function (p) { T.eq(res.nodes[p].x, 100 + GAP_X, p + ' starts gapX past the root'); });
    T.eq(res.nodes['1'].y - (res.nodes['0'].y + 20), GAP_Y, 'sibling gap 12');
    T.eq(res.nodes['2'].y - (res.nodes['1'].y + 40), GAP_Y, 'sibling gap 12 again');
    var mid = (res.nodes['0'].y + 10 + res.nodes['2'].y + 10) / 2;
    T.ok(Math.abs(res.nodes[''].y + 15 - mid) <= 0.5, 'the root is centred on its children');
    T.same(res.order, ['', '0', '1', '2'], 'document order');
    T.same(res.links[1], { from: '', to: '1', x1: 100, y1: res.nodes[''].y + 28, x2: 172, y2: res.nodes['1'].y + 22, side: 'right' }, 'a link runs from stub end to stub start');
  });

  T.test('cousins keep the wider gap', function () {
    var tree = { path: '', children: [
      { path: '0', children: [{ path: '0.0', children: [] }] },
      { path: '1', children: [{ path: '1.0', children: [] }] }
    ] };
    var s = { w: 40, h: 20, base: 18 };
    var res = L.layout(tree, { '': s, '0': s, '1': s, '0.0': s, '1.0': s }, {});
    T.ok(res.nodes['1.0'].y - (res.nodes['0.0'].y + 20) >= 24 - 0.5, 'cousin gap at least 24');
  });

  T.test('a short subtree tucks in beside a deep one', function () {
    /* Branch 0 is one small node with a tall descendant far to the right;
     * branch 1 is a single wide-but-short node: it may rise into the space
     * under branch 0's head, which a band-stacking layout would waste. */
    var tree = { path: '', children: [
      { path: '0', children: [{ path: '0.0', children: [{ path: '0.0.0', children: [] }] }] },
      { path: '1', children: [] }
    ] };
    var sizes = { '': { w: 40, h: 20, base: 18 }, '0': { w: 40, h: 20, base: 18 }, '0.0': { w: 40, h: 20, base: 18 },
      '0.0.0': { w: 60, h: 300, base: 20 }, '1': { w: 40, h: 20, base: 18 } };
    var res = L.layout(tree, sizes, {});
    var deepBottom = res.nodes['0.0.0'].y + 300;
    T.ok(res.nodes['1'].y < deepBottom, 'branch 1 starts above the bottom of the deep descendant');
    T.eq(boxOverlaps(res, GAP_Y).length, 0, 'and still overlaps nothing');
  });

  T.test('random trees never overlap, never cross a box with a link, centre every parent', function () {
    var bad = 0;
    var crossings = 0;
    var off = 0;
    var order = 0;
    var detail = [];
    for (var seed = 1; seed <= 48; seed++) {
      MODES.forEach(function (mode) {
        var dir = mode.name;
        var g = randomTree(seed * 7919, 15 + seed * 3, seed % 3 === 0, mode.marked);
        var res = L.layout(g.tree, g.sizes, mode.opts);
        var o = boxOverlaps(res, GAP_Y);
        if (o.length) { bad++; detail.push(dir + ' seed ' + seed + ': ' + o[0]); }
        var c = linkCrossings(res);
        if (c.length) { crossings++; detail.push(dir + ' seed ' + seed + ': ' + c[0]); }
        res.order.forEach(function (p) {
          var kids = childrenOf(res, p);
          if (!kids.length) return;
          var n = res.nodes[p];
          ['right', 'left'].forEach(function (side) {
            var list = kids.filter(function (k) { return res.nodes[k].side === side; });
            if (!list.length) return;
            var a = res.nodes[list[0]];
            var b = res.nodes[list[list.length - 1]];
            var mid = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
            if (Math.abs(n.y + n.h / 2 - mid) > 1) { off++; detail.push(dir + ' seed ' + seed + ': ' + p + ' not centred'); }
            for (var i = 1; i < list.length; i++) {
              if (res.nodes[list[i]].y <= res.nodes[list[i - 1]].y) { order++; detail.push(dir + ' seed ' + seed + ': order at ' + list[i]); }
            }
            list.forEach(function (k) {
              var c = res.nodes[k];
              var expect = side === 'right' ? n.x + n.w + GAP_X : n.x - GAP_X;
              var got = side === 'right' ? c.x : c.x + c.w;
              if (Math.abs(expect - got) > 0.5) { off++; detail.push(dir + ' seed ' + seed + ': ' + k + ' not gapX from its parent'); }
            });
          });
        });
      });
    }
    T.eq(bad, 0, 'no overlapping boxes' + (detail.length ? ' (' + detail.slice(0, 3).join('; ') + ')' : ''));
    T.eq(crossings, 0, 'no link through a box');
    T.eq(off, 0, 'every parent centred, every child gapX away');
    T.eq(order, 0, 'siblings top to bottom in document order');
  });

  T.test('bounds are the union of the boxes and knobs', function () {
    for (var seed = 3; seed <= 12; seed++) {
      var mode = MODES[seed % 3];
      var g = randomTree(seed * 31, 40, seed % 2 === 0, mode.marked);
      var res = L.layout(g.tree, g.sizes, mode.opts);
      var x0 = Infinity; var y0 = Infinity; var x1 = -Infinity; var y1 = -Infinity;
      Object.keys(res.nodes).forEach(function (p) {
        var n = res.nodes[p];
        var l = n.x - (n.hasKids && n.side === 'left' ? 8 : 0);
        var r = n.x + n.w + (n.hasKids && n.side !== 'left' ? 8 : 0);
        x0 = Math.min(x0, l); x1 = Math.max(x1, r);
        y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y + n.h);
      });
      T.same(res.bounds, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 'seed ' + seed);
    }
  });

  T.test('the layout is deterministic', function () {
    var g = randomTree(4242, 300, false, true);
    var a = JSON.stringify(L.layout(g.tree, g.sizes, {}));
    var b = JSON.stringify(L.layout(JSON.parse(JSON.stringify(g.tree)), JSON.parse(JSON.stringify(g.sizes)), {}));
    T.eq(a, b, 'same input, same output');
    T.ok(a.indexOf('NaN') < 0 && a.indexOf('null,"y"') < 0, 'no NaN anywhere');
  });

  T.test('each first-level branch grows on the side its marker says', function () {
    var kids = [];
    var sizes = { '': { w: 80, h: 30, base: 28 } };
    var marks = ['right', 'left', 'left', 'right', 'left', 'right'];
    for (var i = 0; i < 6; i++) {
      kids.push({ path: String(i), side: marks[i], children: [{ path: i + '.0', side: 'left', children: [] }] });
      sizes[String(i)] = { w: 50, h: 20, base: 18 };
      sizes[i + '.0'] = { w: 40, h: 20, base: 18 };
    }
    var res = L.layout({ path: '', children: kids }, sizes, {});
    T.same(kids.map(function (k) { return res.nodes[k.path].side; }), marks, 'every branch where its marker says, nothing balanced');
    T.same(kids.map(function (k) { return res.nodes[k.path + '.0'].side; }), marks, 'a child grows on its branch\'s side, whatever its own marker');
    T.eq(res.nodes['1'].x + 50, -GAP_X, 'the left side ends gapX before the root');
    T.eq(res.nodes['0'].x, 80 + GAP_X, 'the right side starts gapX past the root');
    T.ok(res.nodes['2'].y > res.nodes['1'].y && res.nodes['4'].y > res.nodes['2'].y, 'the left side reads top to bottom in file order');
    T.ok(res.nodes['3'].y > res.nodes['0'].y && res.nodes['5'].y > res.nodes['3'].y, 'so does the right');
    T.eq(boxOverlaps(res, GAP_Y).length, 0, 'no overlaps');
    var allLeft = L.layout({ path: '', children: kids.map(function (k) { return { path: k.path, side: 'left', children: [] }; }) }, sizes, {});
    T.ok(Object.keys(allLeft.nodes).every(function (p) { return p === '' || allLeft.nodes[p].side === 'left'; }), 'every branch on the left when every marker says so');
    var unmarked = L.layout({ path: '', children: kids.map(function (k) { return { path: k.path, children: [] }; }) }, sizes, {});
    T.ok(Object.keys(unmarked.nodes).every(function (p) { return p === '' || unmarked.nodes[p].side === 'right'; }), 'no marker: the right');
    var odd = L.layout({ path: '', children: [{ path: '0', side: 'up', children: [] }] }, sizes, {});
    T.eq(odd.nodes['0'].side, 'right', 'a side this version does not know grows on the right');
    var balanced = L.layout({ path: '', children: kids }, sizes, { balance: true });
    T.same(kids.map(function (k) { return balanced.nodes[k.path].side; }), ['right', 'right', 'right', 'left', 'left', 'left'], 'the legacy balance ignores the markers');
  });

  T.test('legacy balance splits first-level branches, first ones right, balanced', function () {
    var kids = [];
    var sizes = { '': { w: 80, h: 30, base: 28 } };
    for (var i = 0; i < 6; i++) { kids.push({ path: String(i), children: [] }); sizes[String(i)] = { w: 50, h: 20, base: 18 }; }
    var res = L.layout({ path: '', children: kids }, sizes, { balance: true });
    var sides = kids.map(function (k) { return res.nodes[k.path].side; });
    T.same(sides, ['right', 'right', 'right', 'left', 'left', 'left'], 'three and three, in order');
    T.eq(res.nodes['3'].x + 50, -GAP_X, 'the left side ends gapX before the root');
    T.ok(res.nodes['4'].y > res.nodes['3'].y, 'the left side reads top to bottom too');
    var left = res.links.filter(function (l) { return l.side === 'left'; })[0];
    T.eq(left.x1, 0, 'left links leave from the root\'s left edge');
    T.eq(left.x2, res.nodes[left.to].x + 50, 'and arrive at the child\'s right edge');
    var one = L.layout({ path: '', children: [kids[0]] }, sizes, { balance: true });
    T.eq(one.nodes['0'].side, 'right', 'a single branch goes right');
    /* An uneven pair: the tall branch alone on one side. */
    var uneven = { path: '', children: [{ path: '0', children: [] }, { path: '1', children: [] }, { path: '2', children: [] }] };
    var us = { '': sizes[''], '0': { w: 50, h: 300, base: 20 }, '1': { w: 50, h: 20, base: 18 }, '2': { w: 50, h: 20, base: 18 } };
    var u = L.layout(uneven, us, { balance: true });
    T.same(['0', '1', '2'].map(function (p) { return u.nodes[p].side; }), ['right', 'left', 'left'], 'the tall branch alone on the right');
  });

  T.test('a synthetic root is a stack of separate trees with no phantom links', function () {
    var g = randomTree(77, 60, true);
    var res = L.layout(g.tree, g.sizes, {});
    var tops = g.tree.children.map(function (c) { return c.path; });
    T.ok(tops.length > 1, 'several tops');
    T.eq(res.links.filter(function (l) { return l.from === null; }).length, 0, 'no link from the synthetic root');
    tops.forEach(function (p) {
      T.eq(res.nodes[p].x, 0, 'top ' + p + ' at x 0');
      T.eq(res.nodes[p].parent, null, 'top ' + p + ' has no parent');
    });
    for (var i = 1; i < tops.length; i++) T.ok(res.nodes[tops[i]].y > res.nodes[tops[i - 1]].y, 'tops stacked in order');
    T.eq(res.order.indexOf(null), -1, 'the synthetic root is not laid out');
    var both = L.layout(g.tree, g.sizes, { balance: true });
    T.eq(boxOverlaps(both, GAP_Y).length, 0, 'balanced trees stacked without overlap');
    var m = randomTree(77, 60, true, true);
    var marked = L.layout(m.tree, m.sizes, {});
    T.eq(boxOverlaps(marked, GAP_Y).length, 0, 'trees with branches on both sides stacked without overlap');
    var lefts = m.tree.children.filter(function (top) { return top.children.some(function (k) { return k.side === 'left'; }); });
    T.ok(lefts.length > 0 && lefts.every(function (top) { return top.children.every(function (k) { return marked.nodes[k.path].side === k.side; }); }), 'each top grows its own two sides');
  });

  T.test('folded nodes keep their box, lose their subtree', function () {
    var tree = { path: '', children: [{ path: '0', children: [{ path: '0.0', children: [] }] }, { path: '1', children: [] }] };
    var s = { w: 40, h: 20, base: 18 };
    var sizes = { '': s, '0': s, '0.0': s, '1': s };
    [new Set(['0']), ['0'], { '0': true }].forEach(function (folded, i) {
      var res = L.layout(tree, sizes, { folded: folded });
      T.eq(res.nodes['0.0'], undefined, 'hidden (' + i + ')');
      T.eq(res.nodes['0'].folded, true, 'marked folded (' + i + ')');
      T.eq(res.nodes['0'].hasKids, true, 'still has children (' + i + ')');
      T.eq(res.links.length, 2, 'no link to the hidden child (' + i + ')');
    });
    var leaf = L.layout(tree, sizes, { folded: new Set(['1']) });
    T.eq(leaf.nodes['1'].folded, false, 'a leaf cannot be folded');
  });

  T.test('a wide fan, a deep chain', function () {
    var fan = { path: '', children: [] };
    var sizes = { '': { w: 90, h: 30, base: 28 } };
    for (var i = 0; i < 200; i++) { fan.children.push({ path: String(i), children: [] }); sizes[String(i)] = { w: 70, h: 20, base: 18 }; }
    var res = L.layout(fan, sizes, {});
    T.eq(res.bounds.h, 200 * 20 + 199 * GAP_Y, 'two hundred rows, twelve apart');
    T.ok(Math.abs(res.nodes[''].y + 15 - (res.bounds.y + res.bounds.h / 2)) <= 1, 'root in the middle of the fan');
    var chain = { path: '', children: [] };
    var cs = { '': { w: 50, h: 20, base: 18 } };
    var cur = chain;
    var p = '';
    for (var d = 0; d < 30; d++) {
      p = p === '' ? '0' : p + '.0';
      var n = { path: p, children: [] };
      cur.children.push(n);
      cur = n;
      cs[p] = { w: 40, h: 20, base: 18 };
    }
    var cr = L.layout(chain, cs, {});
    T.eq(cr.bounds.h, 20, 'a chain is one row');
    T.eq(cr.nodes[p].x, 50 + 29 * (40 + GAP_X) + GAP_X, 'the last of thirty is where the sum says');
  });

  T.test('2,000 nodes lay out in well under the frame budget', function () {
    var g = randomTree(2024, 2000, false, true);
    var t0 = performance.now();
    var res = L.layout(g.tree, g.sizes, {});
    var ms = performance.now() - t0;
    T.eq(Object.keys(res.nodes).length, 2000, 'every node placed');
    T.ok(ms < 120, '2,000 nodes in ' + Math.round(ms) + ' ms');
  });

  T.test('link geometry helpers', function () {
    T.eq(L.linkPath(0, 10, 100, 50), 'M0,10C50,10 50,50 100,50', 'cubic with both handles at mid-x');
    T.same(L.linkMidpoint(0, 10, 100, 50), { x: 50, y: 30 }, 'the curve at t = 0.5');
    T.eq(L.linkPath(10.123, 0, 0.5, 1), 'M10.12,0C5.31,0 5.31,1 0.5,1', 'rounded to hundredths, mirrored too');
  });

  T.test('contours: envelope and separation', function () {
    var seg = function (x0, x1, y) { return { x0: x0, x1: x1, y: y, o: {} }; };
    var top = L.envelope([seg(0, 10, 5)], [seg(5, 20, 2)], true);
    T.same(top.map(function (s) { return [s.x0, s.x1, s.y]; }), [[0, 5, 5], [5, 20, 2]], 'upper envelope takes the higher step');
    var bottom = L.envelope([seg(0, 10, 5)], [seg(5, 20, 2)], false);
    T.same(bottom.map(function (s) { return [s.x0, s.x1, s.y]; }), [[0, 10, 5], [10, 20, 2]], 'lower envelope takes the lower step');
    T.eq(L.separation([seg(0, 10, 30)], [seg(5, 8, 0)], function () { return 12; }), 42, 'separation where they share x');
    T.eq(L.separation([seg(0, 10, 30)], [seg(10, 18, 0)], function () { return 12; }), -Infinity, 'touching ends share nothing');
  });
})();
