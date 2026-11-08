/* MindRoot - the pure tidy-tree layout of a map.
 *
 * Takes the tree the map draws (ns.doc.viewTree) and the measured size of
 * every node box, and answers where each box goes: a horizontal, non-layered
 * tidy tree. Pure and deterministic: no DOM, no clock, no randomness, so the
 * screen, the export and the tests all get the same numbers.
 *
 * Non-layered means a child starts gapX to the right of its own parent's box,
 * not in a column shared with every node of its depth: a wide node pushes its
 * own children out and nobody else's. Vertical placement is contour-based
 * (Reingold-Tilford for variable sizes, after van der Ploeg): each subtree
 * keeps its upper and lower outline as steps over x, and a subtree is slid
 * under its elder siblings until, at every x where both have something, the
 * outlines are a gap apart - gapY between two siblings, cousinGap between
 * nodes of different parents. Short subtrees tuck in beside deep ones instead
 * of being stacked as whole bands. The outline also covers the strip where a
 * parent's links fan out to its children, so a neighbour's node never lands
 * on a link. Parents are centred on their children (midway between the
 * centres of the first and the last).
 *
 * Each first-level branch grows on the side its node says (view.side, from
 * the '<!-- side: left -->' marker the map's Markdown carries; anything else
 * is the right). The left side is the mirror image and still reads top to
 * bottom in document order. Nothing is balanced: a branch stays where the
 * person put it. The one exception is opts.balance, kept only for a map
 * that the previous 'both sides' setting laid out and whose sides are not
 * written yet: the first first-level branches go right and the rest left,
 * at the split that best balances the two heights - what that setting drew,
 * so the session can write it down as markers without the map moving.
 * A synthetic root (several top-level nodes and no single heading) is never
 * drawn: its top nodes become separate trees stacked one under the other,
 * treeGap apart, with no link to a phantom; each grows its own two sides.
 * One of those trees whose root was put somewhere by hand (view.at, from
 * the '<!-- at: x,y -->' marker) stands with its root's box centred on
 * that point; the trees still in the column go under the lowest of them.
 * Any other node with view.at (not the map's one root) hangs from its
 * parent with its middle that far from its parent's middle: it leaves its
 * siblings' stack (they close up), takes its whole branch with it, and
 * grows its children on the side it stands on.
 *
 *   layout(tree, sizes, opts) -> {nodes: {path -> {x, y, w, h, base, side,
 *     depth, parent, hasKids, folded}}, links: [{from, to, x1, y1, x2, y2,
 *     side}], bounds: {x, y, w, h}, order: [path, ...]}
 *   sizes: {path -> {w, h, base}} (an object or a Map); base = the y of the
 *     stub under the title inside the box, where links arrive and leave.
 *   tree nodes: {path, side: 'left'|'right' (first-level only), at: {x, y}
 *     | null (a top node of a synthetic root: its middle on the map; any
 *     node under a real parent: its middle from its parent's), children}
 *   opts: balance false (legacy, see above), gapX 72, gapY 12, cousinGap 24,
 *     treeGap 48, knob 8 (room a fold knob takes past the box end),
 *     line 1 (half the link width), folded: Set|Array|{path: true}.
 *   linkPath(x1, y1, x2, y2) -> SVG path data, shared by screen and export.
 *   linkMidpoint(x1, y1, x2, y2) -> {x, y}, the curve at t = 0.5. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var DEFAULTS = {
    balance: false,
    gapX: 72,
    gapY: 12,
    cousinGap: 24,
    treeGap: 48,
    knob: 8,
    line: 1
  };

  function num(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function options(opts) {
    var out = {};
    for (var key in DEFAULTS) out[key] = DEFAULTS[key];
    if (opts) {
      for (var k in DEFAULTS) {
        if (opts[k] === undefined || opts[k] === null) continue;
        out[k] = k === 'balance' ? opts[k] === true : num(opts[k]);
      }
    }
    out.isFolded = foldTest(opts && opts.folded);
    return out;
  }

  /* Folds arrive however the caller keeps them: a Set (the view), an array
   * (persisted JSON) or a plain object. */
  function foldTest(folded) {
    if (!folded) return function () { return false; };
    if (typeof folded.has === 'function') return function (p) { return folded.has(p); };
    if (Array.isArray(folded)) {
      var set = Object.create(null);
      for (var i = 0; i < folded.length; i++) set[folded[i]] = true;
      return function (p) { return set[p] === true; };
    }
    return function (p) { return Object.prototype.hasOwnProperty.call(folded, p) && !!folded[p]; };
  }

  function sizeReader(sizes) {
    if (!sizes) return function () { return null; };
    if (typeof sizes.get === 'function') return function (p) { return sizes.get(p) || null; };
    return function (p) { return Object.prototype.hasOwnProperty.call(sizes, p) ? sizes[p] : null; };
  }

  /* ---------- the record tree (what is visible, with its sizes) ---------- */

  function build(view, parent, c, size) {
    var s = view.path === null || view.path === undefined ? null : size(view.path);
    var w = num(s && s.w);
    var h = num(s && s.h);
    var base = s && s.base !== undefined && s.base !== null ? Math.min(num(s.base), h) : h;
    var kids = view.children || [];
    var r = {
      path: view.path === undefined ? null : view.path,
      w: w, h: h, base: base,
      parent: parent, root: null,
      kids: [], hasKids: kids.length > 0, folded: false,
      side: null, mark: view.side === 'left' ? 'left' : 'right', depth: parent ? parent.depth + 1 : 0,
      at: view.at && isFinite(view.at.x) && isFinite(view.at.y) ? { x: Number(view.at.x), y: Number(view.at.y) } : null,
      u: 0, rel: 0, x: 0, y: 0,
      top: null, bottom: null
    };
    r.folded = r.hasKids && r.path !== null && c.isFolded(r.path);
    /* A node put somewhere by hand under a real parent (view.at: where its
     * middle stands from its parent's middle) leaves its siblings' stack:
     * it hangs from its parent wherever it was put, and grows its own
     * children on the side it stands. */
    r.float = !!r.at && !!parent && parent.path !== null;
    r.tidy = [];
    r.floats = [];
    if (!r.folded) {
      for (var i = 0; i < kids.length; i++) {
        var k = build(kids[i], r, c, size);
        r.kids.push(k);
        (k.float ? r.floats : r.tidy).push(k);
      }
    }
    return r;
  }

  /* ---------- contours: steps over x, each owned by the node it outlines ---------- */

  function seg(x0, x1, y, owner) { return { x0: x0, x1: x1, y: y, o: owner }; }

  function shift(list, dy) {
    var out = new Array(list.length);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      out[i] = seg(s.x0, s.x1, s.y + dy, s.o);
    }
    return out;
  }

  function push(out, x0, x1, y, owner) {
    var last = out[out.length - 1];
    if (last && last.x1 === x0 && last.y === y && last.o === owner) last.x1 = x1;
    else out.push(seg(x0, x1, y, owner));
  }

  /* The outline of two outlines: the higher step where both have one (upper
   * outline) or the lower one (lower outline), whichever exists elsewhere.
   * Both lists are sorted and disjoint, so one merge walk does it. */
  function envelope(a, b, upper) {
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    var xs = [];
    var i = 0;
    var j = 0;
    var ea = [];
    var eb = [];
    for (var p = 0; p < a.length; p++) ea.push(a[p].x0, a[p].x1);
    for (var q = 0; q < b.length; q++) eb.push(b[q].x0, b[q].x1);
    while (i < ea.length || j < eb.length) {
      var next = j >= eb.length || (i < ea.length && ea[i] <= eb[j]) ? ea[i++] : eb[j++];
      if (!xs.length || xs[xs.length - 1] !== next) xs.push(next);
    }
    var out = [];
    var ia = 0;
    var ib = 0;
    for (var k = 0; k < xs.length - 1; k++) {
      var x0 = xs[k];
      var x1 = xs[k + 1];
      while (ia < a.length && a[ia].x1 <= x0) ia++;
      while (ib < b.length && b[ib].x1 <= x0) ib++;
      var sa = ia < a.length && a[ia].x0 <= x0 ? a[ia] : null;
      var sb = ib < b.length && b[ib].x0 <= x0 ? b[ib] : null;
      var s = !sa ? sb : (!sb ? sa : (upper ? (sb.y < sa.y ? sb : sa) : (sb.y > sa.y ? sb : sa)));
      if (s) push(out, x0, x1, s.y, s.o);
    }
    return out;
  }

  /* How far below the upper block the lower subtree must start (its own
   * y = 0 at its root's top) so that, wherever both have a step, they keep
   * the gap the two owners call for. -Infinity when they share no x. */
  function separation(bottom, top, gap) {
    var i = 0;
    var j = 0;
    var need = -Infinity;
    while (i < bottom.length && j < top.length) {
      var b = bottom[i];
      var t = top[j];
      if (Math.min(b.x1, t.x1) > Math.max(b.x0, t.x0)) {
        var d = b.y + gap(b.o, t.o) - t.y;
        if (d > need) need = d;
      }
      if (b.x1 < t.x1) i++; else j++;
    }
    return need;
  }

  function siblingGap(c) {
    return function (a, b) { return a.parent === b.parent ? c.gapY : c.cousinGap; };
  }

  /* Stacks subtrees one under the other as tightly as their outlines allow.
   * offs[i] is subtree i's root top, measured from subtree 0's root top. */
  function stack(list, gap, fallbackGap) {
    var offs = [0];
    var top = list[0].top;
    var bottom = list[0].bottom;
    for (var i = 1; i < list.length; i++) {
      var d = separation(bottom, list[i].top, gap);
      var floor = offs[i - 1] + list[i - 1].h + fallbackGap;
      if (!isFinite(d)) d = floor;
      offs.push(d);
      top = envelope(top, shift(list[i].top, d), true);
      bottom = envelope(bottom, shift(list[i].bottom, d), false);
    }
    return { offs: offs, top: top, bottom: bottom };
  }

  /* Where the parent's top goes, measured from its first child's top: its
   * centre midway between the centres of its first and last child. */
  function parentTop(r, list, offs) {
    var first = list[0];
    var last = list[list.length - 1];
    var mid = (first.h / 2 + offs[offs.length - 1] + last.h / 2) / 2;
    return mid - r.h / 2;
  }

  /* The strip between a parent and its children where the links run: as high
   * and as low as the first and last link ends, so no neighbour sits on one. */
  function fillSpan(r, list, c) {
    var first = list[0];
    var last = list[list.length - 1];
    return [
      Math.min(r.base, first.rel + first.base) - c.line,
      Math.max(r.base, last.rel + last.base) + c.line
    ];
  }

  function boxRight(r, c) {
    return Math.max(r.w + (r.hasKids ? c.knob : 0), 1);
  }

  /* One subtree on one side, in u (distance outward from the side's start),
   * with y measured from its root's top. */
  function placeSubtree(r, u, c, gap) {
    r.u = u;
    var right = u + boxRight(r, c);
    var top = [seg(u, right, 0, r)];
    var bottom = [seg(u, right, r.h, r)];
    if (r.tidy.length) {
      var cu = u + r.w + c.gapX;
      for (var i = 0; i < r.tidy.length; i++) placeSubtree(r.tidy[i], cu, c, gap);
      var block = stack(r.tidy, gap, c.gapY);
      var pTop = parentTop(r, r.tidy, block.offs);
      for (var k = 0; k < r.tidy.length; k++) r.tidy[k].rel = block.offs[k] - pTop;
      var span = fillSpan(r, r.tidy, c);
      top = envelope(envelope(top, [seg(u + r.w, cu, span[0], r)], true), shift(block.top, -pTop), true);
      bottom = envelope(envelope(bottom, [seg(u + r.w, cu, span[1], r)], false), shift(block.bottom, -pTop), false);
    }
    r.top = top;
    r.bottom = bottom;
  }

  function extent(r) {
    var lo = Infinity;
    var hi = -Infinity;
    for (var i = 0; i < r.top.length; i++) lo = Math.min(lo, r.top[i].y);
    for (var j = 0; j < r.bottom.length; j++) hi = Math.max(hi, r.bottom[j].y);
    return isFinite(lo) && isFinite(hi) ? hi - lo : r.h;
  }

  /* Which first-level branches go right and which go left: each where its
   * marker says, both sides in document order. */
  function split(kids, c) {
    if (c.balance) return balanced(kids, c);
    var right = [];
    var left = [];
    for (var i = 0; i < kids.length; i++) (kids[i].mark === 'left' ? left : right).push(kids[i]);
    return { right: right, left: left };
  }

  /* Legacy (opts.balance): the first k go right, the rest left, both in
   * document order; k is the split whose two heights are closest, ties going
   * to the right. */
  function balanced(kids, c) {
    var n = kids.length;
    if (n < 2) return { right: kids, left: [] };
    var heights = kids.map(extent);
    var total = 0;
    for (var i = 0; i < n; i++) total += heights[i];
    var best = n - 1;
    var bestDiff = Infinity;
    var prefix = 0;
    var prefixes = [0];
    for (var a = 0; a < n; a++) { prefix += heights[a]; prefixes.push(prefix); }
    for (var k = n - 1; k >= 1; k--) {
      var right = prefixes[k] + c.gapY * (k - 1);
      var left = total - prefixes[k] + c.gapY * (n - k - 1);
      var diff = Math.abs(right - left);
      if (diff < bestDiff) { bestDiff = diff; best = k; }
    }
    return { right: kids.slice(0, best), left: kids.slice(best) };
  }

  function markSide(r, side, root) {
    r.side = side;
    r.root = root;
    for (var i = 0; i < r.tidy.length; i++) markSide(r.tidy[i], side, root);
  }

  /* u-space outline of one side, turned into x measured from the root's
   * left edge: the right side starts past the root, the left side is the
   * mirror image ending gapX before it. */
  function toX(list, root, side, c) {
    var out = [];
    if (side === 'right') {
      var at = root.w + c.gapX;
      for (var i = 0; i < list.length; i++) out.push(seg(at + list[i].x0, at + list[i].x1, list[i].y, list[i].o));
    } else {
      for (var j = list.length - 1; j >= 0; j--) out.push(seg(-c.gapX - list[j].x1, -c.gapX - list[j].x0, list[j].y, list[j].o));
    }
    return out;
  }

  /* A whole tree: its root, then each side placed and centred on the root.
   * The outline comes back in x from the root's left edge, for stacking
   * several trees. */
  function placeRoot(r, c, gap) {
    r.u = 0;
    r.side = null;
    r.root = r;
    var top = [seg(0, boxRight(r, c), 0, r)];
    var bottom = [seg(0, boxRight(r, c), r.h, r)];
    if (r.tidy.length) {
      for (var i = 0; i < r.tidy.length; i++) placeSubtree(r.tidy[i], 0, c, gap);
      var sides = split(r.tidy, c);
      [['right', sides.right], ['left', sides.left]].forEach(function (pair) {
        var side = pair[0];
        var list = pair[1];
        if (!list.length) return;
        for (var m = 0; m < list.length; m++) markSide(list[m], side, r);
        var block = stack(list, gap, c.gapY);
        var pTop = parentTop(r, list, block.offs);
        for (var k = 0; k < list.length; k++) list[k].rel = block.offs[k] - pTop;
        var span = fillSpan(r, list, c);
        var fill = side === 'right' ? [r.w, r.w + c.gapX] : [-c.gapX, 0];
        top = envelope(envelope(top, [seg(fill[0], fill[1], span[0], r)], true), toX(shift(block.top, -pTop), r, side, c), true);
        bottom = envelope(envelope(bottom, [seg(fill[0], fill[1], span[1], r)], false), toX(shift(block.bottom, -pTop), r, side, c), false);
      });
    }
    r.top = top;
    r.bottom = bottom;
  }

  /* A node put by hand under its parent: a tree of its own, every child
   * on the side it stands on (left when its middle is left of its
   * parent's), laid out like a root's side. */
  function placeFloat(r, c, gap) {
    var side = r.at.x < 0 ? 'left' : 'right';
    for (var i = 0; i < r.tidy.length; i++) r.tidy[i].mark = side;
    var balance = c.balance;
    c.balance = false;
    placeRoot(r, c, gap);
    c.balance = balance;
    r.side = side;
  }

  function floatsIn(r, out) {
    for (var i = 0; i < r.kids.length; i++) {
      if (r.kids[i].float) out.push(r.kids[i]);
      floatsIn(r.kids[i], out);
    }
    return out;
  }

  /* ---------- absolute positions and the result ---------- */

  function position(r, c) {
    if (r.parent && r.parent.path !== null && !r.float) {
      r.y = r.parent.y + r.rel;
      var root = r.root;
      r.x = r.side === 'left' ? root.x - c.gapX - r.u - r.w : root.x + root.w + c.gapX + r.u;
    }
    for (var i = 0; i < r.tidy.length; i++) position(r.tidy[i], c);
    for (var j = 0; j < r.floats.length; j++) {
      var f = r.floats[j];
      f.x = r.x + r.w / 2 + f.at.x - f.w / 2;
      f.y = r.y + r.h / 2 + f.at.y - f.h / 2;
      position(f, c);
    }
  }

  /* The vertical reach of a placed tree, and the tree moved down by dy. */
  function reach(r, box) {
    box = box || { y0: Infinity, y1: -Infinity };
    box.y0 = Math.min(box.y0, r.y);
    box.y1 = Math.max(box.y1, r.y + r.h);
    for (var i = 0; i < r.kids.length; i++) reach(r.kids[i], box);
    return box;
  }

  function lower(r, dy) {
    r.y += dy;
    for (var i = 0; i < r.kids.length; i++) lower(r.kids[i], dy);
  }

  /* The root of a tree (not a node put by hand under a parent) keeps its knob
   * in the middle of its line, under the words; its links still leave from
   * the line's ends, so the line itself carries them from the knob. */
  function isHub(r) { return r.root === r && !r.float; }

  function emit(r, c, out) {
    if (r.path !== null) {
      var x = Math.round(r.x);
      var y = Math.round(r.y);
      r.x = x;
      r.y = y;
      out.nodes[r.path] = {
        x: x, y: y, w: r.w, h: r.h, base: r.base,
        side: r.side, depth: r.depth,
        parent: r.parent && r.parent.path !== null ? r.parent.path : null,
        hasKids: r.hasKids, folded: r.folded,
        hub: isHub(r)
      };
      out.order.push(r.path);
      var left = x;
      var right = x + r.w;
      if (r.hasKids && !isHub(r)) {
        if (r.side === 'left') left -= c.knob;
        else right += c.knob;
      }
      var b = out.box;
      if (left < b.x0) b.x0 = left;
      if (right > b.x1) b.x1 = right;
      if (y < b.y0) b.y0 = y;
      if (y + r.h > b.y1) b.y1 = y + r.h;
    }
    for (var i = 0; i < r.kids.length; i++) emit(r.kids[i], c, out);
  }

  /* A branch put by hand over or under the root's line leaves from the root's
   * circle (the middle of its line) and comes down on its own line right under
   * it; null for every other branch. */
  function fromTheCircle(r, k) {
    if (!isHub(r) || !(k.x < r.x + r.w && k.x + k.w > r.x)) return null;
    var cx = r.x + r.w / 2;
    var x2 = Math.max(k.x, Math.min(k.x + k.w, cx));
    /* Not quite straight down, so that a gradient along it has a direction. */
    if (Math.abs(x2 - cx) < 1) x2 = cx + 1 <= k.x + k.w ? cx + 1 : cx - 1;
    return { x1: cx, x2: x2 };
  }

  function links(r, out) {
    for (var i = 0; i < r.kids.length; i++) {
      var k = r.kids[i];
      if (r.path !== null) {
        var left = k.side === 'left';
        var circle = fromTheCircle(r, k);
        out.links.push({
          from: r.path, to: k.path,
          /* Over its parent's line (a node put there by hand), from that
           * point of the line, so the link never doubles back: from the
           * circle for a root, else the point of the line over it. */
          x1: circle ? circle.x1 : (left ? Math.max(r.x, Math.min(r.x + r.w, k.x + k.w)) : Math.min(r.x + r.w, Math.max(r.x, k.x))), y1: r.y + r.base,
          x2: circle ? circle.x2 : (left ? k.x + k.w : k.x), y2: k.y + k.base,
          side: k.side
        });
      }
      links(k, out);
    }
  }

  function layout(tree, sizes, opts) {
    var c = options(opts);
    var out = { nodes: {}, links: [], bounds: { x: 0, y: 0, w: 0, h: 0 }, order: [], box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
    if (!tree) { delete out.box; return out; }
    var root = build(tree, null, c, sizeReader(sizes));
    var gap = siblingGap(c);
    var trees = root.path === null ? root.kids : [root];
    if (trees.length) {
      for (var i = 0; i < trees.length; i++) placeRoot(trees[i], c, gap);
      floatsIn(root, []).forEach(function (f) { placeFloat(f, c, gap); });
      /* A tree whose root was put somewhere by hand (only when there are
       * several: view.at) stands with its root's box centred there; the
       * others keep their column, under the lowest of those. */
      var free = root.path === null ? trees.filter(function (r) { return !!r.at; }) : [];
      var column = free.length ? trees.filter(function (r) { return !r.at; }) : trees;
      free.forEach(function (r) {
        r.x = r.at.x - r.w / 2;
        r.y = r.at.y - r.h / 2;
        position(r, c);
      });
      if (column.length) {
        var block = stack(column, function () { return c.treeGap; }, c.treeGap);
        for (var t = 0; t < column.length; t++) {
          column[t].x = 0;
          column[t].y = block.offs[t];
          position(column[t], c);
        }
        if (free.length) {
          var low = -Infinity;
          free.forEach(function (r) { low = Math.max(low, reach(r).y1); });
          var top = Infinity;
          column.forEach(function (r) { top = Math.min(top, reach(r).y0); });
          var dy = low + c.treeGap - top;
          column.forEach(function (r) { lower(r, dy); });
        }
      }
      emit(root, c, out);
      links(root, out);
    }
    var b = out.box;
    if (isFinite(b.x0)) out.bounds = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    delete out.box;
    return out;
  }

  /* ---------- link geometry, shared by the screen and the export ---------- */

  function fmt(v) { return String(Math.round(v * 100) / 100); }

  /* A cubic from one stub end to the other with both handles at mid-x: the
   * curve leaves and arrives level, whatever the side. */
  function linkPath(x1, y1, x2, y2) {
    var mx = (x1 + x2) / 2;
    return 'M' + fmt(x1) + ',' + fmt(y1) + 'C' + fmt(mx) + ',' + fmt(y1) + ' ' + fmt(mx) + ',' + fmt(y2) + ' ' + fmt(x2) + ',' + fmt(y2);
  }

  /* With both handles at mid-x the curve's t = 0.5 is exactly halfway
   * between the two ends, in x and in y. */
  function linkMidpoint(x1, y1, x2, y2) {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }

  ns.layout = {
    DEFAULTS: DEFAULTS,
    layout: layout,
    linkPath: linkPath,
    linkMidpoint: linkMidpoint,
    /* exposed for the unit suite */
    envelope: envelope,
    separation: separation
  };
})(window.MindRoot);
