/* editor-toolbar-dense: the node toolbar never covers another node, nor the
 * words of the node it is for, nor the capsules floating over the stage.
 * Dense maps of several shapes (a history lesson, a wide fan, a two-sided
 * map, a forest of roots, a deep tree, nodes with words under the title)
 * are fitted at 1280x800, 1440x900 and 1024x768, and every node is chosen
 * in turn. Then the same maps where the fit leaves nodes beside the
 * capsules or the zoom bar: panned up and down under them, zoomed in, a
 * short window, the Markdown panel opened over a fitted map. Near the
 * node is preferred (a sparse map never docks); where no place near it is
 * free the bar docks, centred unless the middle is taken, at the stage
 * edge nearer the node (the far edge only when the near one has no room),
 * just inside the chrome or in the top capsules' row between them, and the
 * suite checks it really came to that on these maps, so the fallback is
 * tested and not only the usual case. The bar is measured where it is laid
 * out, not where its entrance animation has got to. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

/* The map the problem was seen on, and a few more children so the root
 * sits between its middle children. */
var CRISIS = [
  '# The 1929 crisis', '',
  '- Cause',
  '  - Overproduction', '  - Stock speculation', '  - Easy credit', '  - Income inequality',
  '- The Twenties boom',
  '  - Buying on credit', '  - Cars',
  '- Wall Street crash',
  '  - Black Thursday', '  - Black Tuesday', '  - Bank panics',
  '- The Great Depression',
  '- Consequences',
  '  - Mass unemployment', '  - Bank failures', '  - Collapse of world trade', '  - Deflation',
  '- Responses',
  '  - New Deal', '    - Banking reforms', '    - Public works', '    - Social security',
  '  - Protectionism', '  - Keynes',
  '- Legacy',
  '  - Bretton Woods', '  - Welfare state', ''
].join('\n');

function fan() {
  var words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen'];
  var out = ['# Numbers', ''];
  words.forEach(function (w, i) {
    out.push('- ' + w);
    if (i % 4 === 1) { out.push('  - ' + w + ' a'); out.push('  - ' + w + ' b'); }
  });
  return out.join('\n') + '\n';
}

function forest() {
  var out = [];
  ['Mercury', 'Venus', 'Earth', 'Mars'].forEach(function (p) {
    out.push('- ' + p);
    ['Mass', 'Orbit', 'Atmosphere', 'Moons'].forEach(function (k) { out.push('  - ' + k + ' of ' + p); });
  });
  return out.join('\n') + '\n';
}

function deep() {
  var out = ['# Tree', ''];
  ['A', 'B', 'C'].forEach(function (a) {
    out.push('- Branch ' + a);
    ['1', '2', '3'].forEach(function (b) {
      out.push('  - Leaf ' + a + b);
      ['x', 'y', 'z'].forEach(function (c) { out.push('    - ' + a + b + c); });
    });
  });
  return out.join('\n') + '\n';
}

var PROSE = [
  '# Notes', '',
  '- Introduction', '', '  Two lines of text under the title, long enough to wrap inside the box.', '',
  '- Method', '  - Data collection', '  - Analysis', '  - Checks',
  '- Results', '', '  The main result in one sentence.', '',
  '- Discussion', '  - Limits', '  - Future work',
  '- Conclusions', ''
].join('\n');

var MAPS = [
  { name: 'Crisis', text: CRISIS },
  { name: 'Crisis both', text: CRISIS, direction: 'both' },
  { name: 'Fan', text: fan() },
  { name: 'Forest', text: forest() },
  { name: 'Deep', text: deep() },
  { name: 'Prose', text: PROSE },
  /* Room everywhere: the bar stays by its node every time. */
  { name: 'Sparse', text: '# Journey\n\n- Departure\n  - Suitcase\n- Stops\n  - Rome\n  - Naples\n- Return\n- Memories\n  - Photo\n  - Diary\n', sparse: true }
];

/* A root and eight children, for the bar of a node at the stage foot. */
var EIGHT = '# Numbers\n\n- One\n- Two\n- Three\n- Four\n- Five\n- Six\n- Seven\n- Eight\n';

var SIZES = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }];

/* Inside the page: choose every node in turn (opts.paths, or every drawn
 * node, or with opts.inside only those wholly inside the stage) and
 * measure the bar against every other node's box, the chosen node's box,
 * the stage and the chrome floating over it. A docked bar is also checked
 * for its edge: at the far one only when no place in the near edge's row
 * is free. Waits for the view to settle and two frames to be painted after
 * each choice (the bar is placed on the frame after). */
function sweep(opts) {
  opts = opts || {};
  var ns = window.MindRoot;
  var v = ns.session.view;
  var stageEl = document.getElementById('stage');
  /* Measured once the frame is drawn, as it is seen: inside a frame's
   * callbacks a capsule may already have grown (the save state's words
   * change in a task) while the bar's resize observer, which places it
   * again before that frame is painted, has not run yet. */
  function frames() {
    return v.settled().then(function () {
      return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(resolve, 0); }); }); });
    });
  }
  /* Overlap beyond the slack, floating-point noise aside: a box laid out at
   * a fractional zoom can end at 420.00000000000006 for a bar drawn at 419. */
  function meet(a, b, slack) {
    var eps = slack + 1e-6;
    return Math.min(a.right, b.right) - Math.max(a.left, b.left) > eps && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > eps;
  }
  function chrome() {
    var els = ['topbar-lead', 'topbar-actions', 'zoombar'].map(function (id) { return document.getElementById(id); })
      .concat(Array.prototype.slice.call(document.querySelectorAll('#banners > *')));
    return els.map(function (el) {
      if (!el || el.hidden || !el.getClientRects().length) return null;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { id: el.id || el.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }).filter(Boolean);
  }
  /* Where the bar is laid out, not where its entrance (a scale from the
   * side facing the node) has got to in this frame. */
  function laidOut(el) {
    var host = el.offsetParent.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var left = host.left + el.offsetLeft;
    var top = host.top + el.offsetTop;
    var w = parseFloat(cs.width);
    var hh = parseFloat(cs.height);
    return { left: left, top: top, right: left + w, bottom: top + hh, width: w, height: hh };
  }
  /* Some place in the row just inside the chrome at that edge where a bar
   * of this size meets no node, no capsule and not the chosen node. */
  function roomAt(edge, el, tb, own, p, st) {
    var ins = ns.shell.insets();
    var margin = parseFloat(getComputedStyle(el).getPropertyValue('--bar-margin')) || 8;
    var w = Math.ceil(tb.width - 0.01);
    var hh = Math.ceil(tb.height - 0.01);
    var y = st.top + Math.round(edge === 'top' ? Math.max(margin, ins.top) : st.height - Math.max(margin, ins.bottom) - hh);
    var others = v.visiblePaths().filter(function (q) { return q !== p; }).map(function (q) { return v.rect(q); }).filter(Boolean);
    var cs = chrome();
    for (var k = Math.ceil(margin); k <= Math.floor(st.width - margin - w); k++) {
      var c = { left: st.left + k, top: y, right: st.left + k + w, bottom: y + hh };
      if (meet(c, own, 0) || cs.some(function (b) { return meet(c, b, 0); })) continue;
      if (others.some(function (r) { return meet(c, r, 1); })) continue;
      return k;
    }
    return null;
  }
  var st0 = stageEl.getBoundingClientRect();
  var paths = opts.paths || v.visiblePaths().filter(function (p) {
    if (!opts.inside) return true;
    var r = v.rect(p);
    return r && r.left >= st0.left && r.right <= st0.right && r.top >= st0.top && r.bottom <= st0.bottom;
  });
  var out = { nodes: paths.length, hidden: [], covers: [], ownWords: [], outside: [], onChrome: [], notAtEdge: [], offCentre: [], farEdge: [], dockedAt: [], rows: {}, rowOf: {}, edgeOf: {}, docked: 0, near: 0 };
  var i = 0;
  function next() {
    if (i >= paths.length) return Promise.resolve(out);
    var p = paths[i++];
    ns.session.select(p, { reveal: opts.reveal !== false, animate: false });
    v.el.focus({ preventScroll: true });
    return frames().then(function () {
      var el = document.querySelector('.node-toolbar');
      if (!el || el.hidden) { out.hidden.push(p); return next(); }
      var tb = laidOut(el);
      var st = stageEl.getBoundingClientRect();
      var side = el.getAttribute('data-side');
      var own = v.rect(p);
      if (el.hasAttribute('data-docked')) {
        out.docked++;
        out.dockedAt.push(p);
        var lead = document.getElementById('topbar-lead').getBoundingClientRect();
        var zoom = document.getElementById('zoombar');
        zoom = zoom && !zoom.hidden ? zoom.getBoundingClientRect() : null;
        var row = tb.bottom <= lead.bottom + 1 ? 'top-chrome' : (zoom && tb.top >= zoom.top - 1 ? 'bottom-chrome' : (tb.top - st.top < st.height / 2 ? 'top-inside' : 'bottom-inside'));
        out.rows[row] = (out.rows[row] || 0) + 1;
        out.rowOf[p] = row;
        /* Docked means at an edge: just inside the chrome or in its row. */
        var ins = ns.shell.insets();
        var y = tb.top - st.top;
        var atTop = y <= Math.max(ins.top, 8) + 1;
        var atBottom = st.bottom - tb.bottom <= Math.max(ins.bottom, 8) + 1;
        if (!atTop && !atBottom) out.notAtEdge.push({ path: p, top: Math.round(y) });
        /* At the edge nearer the node, unless that edge has no room. */
        var minTop = Math.max(8, ins.top);
        var maxBottom = st.height - Math.max(8, ins.bottom);
        var mid = own.top + own.height / 2 - st.top;
        var nearEdge = mid - minTop <= maxBottom - mid ? 'top' : 'bottom';
        var barEdge = tb.top + tb.height / 2 < st.top + st.height / 2 ? 'top' : 'bottom';
        out.edgeOf[p] = barEdge;
        if (barEdge !== nearEdge) {
          var free = roomAt(nearEdge, el, tb, own, p, st);
          if (free !== null) out.farEdge.push({ path: p, near: nearEdge, freeAt: free, bar: [Math.round(tb.left), Math.round(tb.top)] });
        }
        /* Centred, unless the centre of that row is taken. */
        var cx = st.left + st.width / 2;
        var centred = { left: cx - tb.width / 2, right: cx + tb.width / 2, top: tb.top, bottom: tb.bottom };
        var taken = (own && meet(centred, own, 0)) || chrome().some(function (c) { return meet(centred, c, 0); }) ||
          v.visiblePaths().some(function (q) { var r = q !== p && v.rect(q); return r && meet(centred, r, 1); });
        if (!taken && Math.abs(tb.left + tb.width / 2 - cx) > 1) out.offCentre.push({ path: p, centre: Math.round(tb.left + tb.width / 2), stage: Math.round(cx) });
      } else {
        out.near++;
      }
      if (own && meet(tb, own, 0)) out.ownWords.push({ path: p, side: side });
      v.visiblePaths().forEach(function (q) {
        if (q === p) return;
        var r = v.rect(q);
        if (r && meet(tb, r, 1)) out.covers.push({ path: p, side: side, covered: q, bar: [Math.round(tb.left), Math.round(tb.top), Math.round(tb.right), Math.round(tb.bottom)], box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
      });
      if (tb.left < st.left - 0.5 || tb.right > st.right + 0.5 || tb.top < st.top - 0.5 || tb.bottom > st.bottom + 0.5) out.outside.push({ path: p, side: side });
      chrome().forEach(function (c) { if (meet(tb, c, 0)) out.onChrome.push({ path: p, side: side, chrome: c.id, bar: [Math.round(tb.left), Math.round(tb.top), Math.round(tb.right), Math.round(tb.bottom)] }); });
      return next();
    });
  }
  return next();
}

/* What every sweep must find. */
function verdict(t, r) {
  t.same(r.hidden, [], 'the toolbar is there for every node chosen');
  t.same(r.covers, [], 'it never covers another node');
  t.same(r.ownWords, [], 'it never covers the words of its own node');
  t.same(r.outside, [], 'it stays inside the stage');
  t.same(r.onChrome, [], 'it never sits on the top capsules, a banner or the zoom bar');
  t.same(r.notAtEdge, [], 'a docked bar stands at the top or bottom edge');
  t.same(r.farEdge, [], 'at the edge nearer its node whenever that edge has room');
  t.same(r.offCentre, [], 'and centred, unless the centre of the edge is taken');
}

async function openMap(page, s, mi, direction) {
  await page.evaluate(function (a) {
    /* A map an older version showed on both sides: it opens balanced the
     * old way and keeps those sides as markers in its text. */
    if (a.direction === 'both') window.MindRoot.store.setMapView(a.pid, a.mid, { direction: 'both' });
    return window.MindRoot.session.open(a.pid, a.mid);
  }, { pid: s.pid, mid: s.mids[mi], direction: direction || null });
  await E.until(page, function (mid) { var c = window.MindRoot.session.current(); return c && c.mapId === mid; }, s.mids[mi]);
  await E.settled(page);
}

/* The map fitted to the stage as it is now: a window just resized reaches
 * the view on its next frame (a ResizeObserver), so the fit is done again
 * until it no longer moves the camera. */
async function fitted(page) {
  var last = null;
  for (var i = 0; i < 6; i++) {
    var cam = await page.evaluate(function () {
      var v = window.MindRoot.session.view;
      return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); })
        .then(function () { return v.fit({ animate: false }); })
        .then(function () { return v.settled(); })
        .then(function () { var c = v.camera(); return [c.x, c.y, c.k].map(function (n) { return Math.round(n * 1000) / 1000; }).join(','); });
    });
    if (cam === last) break;
    last = cam;
  }
  await E.settled(page);
  return last;
}

/* The camera moved so the map's top (or foot) stands just inside the
 * stage, beside the top capsules (or the zoom bar): the nodes there are
 * outside the band the bar normally takes. */
function pan(page, edge) {
  return page.evaluate(function (edge) {
    var v = window.MindRoot.session.view;
    var st = document.getElementById('stage').getBoundingClientRect();
    var top = Infinity;
    var bottom = -Infinity;
    v.visiblePaths().forEach(function (p) { var r = v.rect(p); top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); });
    var c = v.camera();
    var dy = edge === 'top' ? st.top + 4 - top : st.bottom - 4 - bottom;
    v.setCamera({ x: c.x, y: c.y + dy, k: c.k });
  }, edge).then(function () { return E.settled(page); });
}

/* Zoomed by `by` about the middle of the stage. */
function zoom(page, by) {
  return page.evaluate(function (by) {
    var v = window.MindRoot.session.view;
    var st = document.getElementById('stage').getBoundingClientRect();
    var c = v.camera();
    var cx = st.width / 2;
    var cy = st.height / 2;
    v.setCamera({ x: cx - (cx - c.x) * by, y: cy - (cy - c.y) * by, k: c.k * by });
  }, by).then(function () { return E.settled(page); });
}

module.exports = async function (t) {
  var s = await E.boot(t, MAPS.map(function (m) { return [m.name, m.text]; }).concat([['Eight', EIGHT]]));
  var page = s.page;
  var dockedTotal = 0;
  var shot = false;
  var dense = MAPS.filter(function (m) { return !m.sparse; });

  /* ---- every map fitted, at three window sizes */
  for (var si = 0; si < SIZES.length; si++) {
    var size = SIZES[si];
    await page.setViewportSize(size);
    for (var mi = 0; mi < MAPS.length; mi++) {
      var m = MAPS[mi];
      var where = m.name + ' at ' + size.width + 'x' + size.height;
      t.step(where);
      await openMap(page, s, mi, m.direction);
      var cam = await fitted(page);
      var r = await page.evaluate(sweep);
      dockedTotal += r.docked;
      t.check('a map with something to choose (' + r.nodes + ' nodes)', r.nodes >= 10, r);
      if (m.sparse) t.same(r.dockedAt, [], 'with room near every node, the bar never docks');
      verdict(t, r);
      t.log(where + ' (camera ' + cam + '): ' + r.near + ' near, ' + r.docked + ' docked ' + JSON.stringify(r.rows));
      if (r.docked && !shot) {
        shot = true;
        await page.evaluate(function (p) { window.MindRoot.session.select(p, { reveal: true, animate: false }); }, r.dockedAt[0]);
        await E.settled(page);
        await t.shot('docked');
      }
    }
  }
  t.check('on these maps some nodes have no free place near them, and the bar docks', dockedTotal > 0, { docked: dockedTotal });

  /* ---- nodes beside the chrome: the map panned under the top capsules and
   * down to the zoom bar, in a tall and a short window */
  var bandDocked = { top: 0, bottom: 0 };
  var bandSizes = [{ width: 1280, height: 800 }, { width: 1280, height: 600 }];
  for (var bi = 0; bi < bandSizes.length; bi++) {
    await page.setViewportSize(bandSizes[bi]);
    for (var di = 0; di < dense.length; di++) {
      var dm = dense[di];
      for (var ei = 0; ei < 2; ei++) {
        var edge = ei ? 'bottom' : 'top';
        var at = dm.name + ' at ' + bandSizes[bi].width + 'x' + bandSizes[bi].height + ', panned to the ' + edge;
        t.step(at);
        await openMap(page, s, MAPS.indexOf(dm), dm.direction);
        await fitted(page);
        await pan(page, edge);
        var rb = await page.evaluate(sweep, { inside: true, reveal: false });
        t.check('nodes beside the chrome to choose (' + rb.nodes + ')', rb.nodes >= 5, rb);
        verdict(t, rb);
        Object.keys(rb.edgeOf).forEach(function (p) { bandDocked[rb.edgeOf[p]]++; });
        t.log(at + ': ' + rb.near + ' near, ' + rb.docked + ' docked ' + JSON.stringify(rb.rows));
      }
    }
  }
  t.check('panned under the chrome, bars dock at both edges', bandDocked.top > 0 && bandDocked.bottom > 0, bandDocked);
  await page.setViewportSize({ width: 1280, height: 800 });

  /* ---- zoomed in on a fitted map: the nodes nearer each other's bars */
  var zoomed = ['Crisis', 'Fan', 'Deep', 'Forest'];
  for (var zi = 0; zi < zoomed.length; zi++) {
    var zm = MAPS.filter(function (m) { return m.name === zoomed[zi]; })[0];
    t.step(zm.name + ' at 1280x800, zoomed in 1.6 times');
    await openMap(page, s, MAPS.indexOf(zm), zm.direction);
    await fitted(page);
    await zoom(page, 1.6);
    var rz = await page.evaluate(sweep, { inside: true, reveal: false });
    t.check('nodes to choose (' + rz.nodes + ')', rz.nodes >= 5, rz);
    verdict(t, rz);
    t.log(zm.name + ' zoomed: ' + rz.near + ' near, ' + rz.docked + ' docked ' + JSON.stringify(rz.rows));
  }

  /* ---- the Markdown panel opened over a fitted map: the stage shrinks
   * under the camera, and nodes end up beside the capsules */
  var panelSizes = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }];
  for (var pi = 0; pi < panelSizes.length; pi++) {
    await page.setViewportSize(panelSizes[pi]);
    for (var qi = 0; qi < dense.length; qi++) {
      var qm = dense[qi];
      var pw = qm.name + ' at ' + panelSizes[pi].width + 'x' + panelSizes[pi].height + ', the Markdown panel opened after the fit';
      t.step(pw);
      await openMap(page, s, MAPS.indexOf(qm), qm.direction);
      await fitted(page);
      await page.evaluate(function () { window.MindRoot.source.toggle(true); });
      await E.until(page, function () { return window.MindRoot.source.isOpen(); });
      await E.resting(page, '#stage');
      await E.settled(page);
      var rp = await page.evaluate(sweep, { inside: true, reveal: false });
      t.check('nodes to choose (' + rp.nodes + ')', rp.nodes >= 5, rp);
      verdict(t, rp);
      t.log(pw + ': ' + rp.near + ' near, ' + rp.docked + ' docked ' + JSON.stringify(rp.rows));
      await page.evaluate(function () { window.MindRoot.source.toggle(false); });
      await E.until(page, function () { return !window.MindRoot.source.isOpen(); });
      await E.resting(page, '#stage');
    }
  }

  /* ---- a node beside the zoom bar, Keynes just over it: the bar never
   * lands on Keynes or the zoom bar (it was put over both) */
  t.step('Bretton Woods beside the zoom bar, in a short window');
  await page.setViewportSize({ width: 1280, height: 600 });
  await openMap(page, s, 0);
  await fitted(page);
  await page.evaluate(function () { window.MindRoot.session.view.setCamera({ x: 182, y: 301.2, k: 0.803 }); });
  await E.settled(page);
  var bretton = await E.pathOf(page, 'Bretton Woods');
  var cause = await E.pathOf(page, 'Cause');
  var rbw = await page.evaluate(sweep, { paths: [bretton, cause], reveal: false });
  verdict(t, rbw);
  await page.evaluate(function (p) { window.MindRoot.session.select(p, { reveal: false, animate: false }); }, bretton);
  await E.settled(page);
  await t.shot('beside-zoombar');

  /* ---- the node at the foot of the stage with the middle of that edge
   * its own: the bar docks beside it at the foot, not a screen away */
  t.step('Eight at the stage foot, the middle of the edge taken by it');
  await page.setViewportSize({ width: 1280, height: 800 });
  await openMap(page, s, MAPS.length);
  await fitted(page);
  var eight = await E.pathOf(page, 'Eight');
  await page.evaluate(function (p) {
    var v = window.MindRoot.session.view;
    var st = document.getElementById('stage').getBoundingClientRect();
    var c = v.camera();
    var k = c.k * 0.6;
    v.setCamera({ x: c.x, y: c.y, k: k });
    var r = v.rect(p);
    var now = v.camera();
    v.setCamera({ x: now.x + (st.left + st.width / 2) - (r.left + r.width / 2), y: now.y + (st.bottom - 4) - r.bottom, k: k });
  }, eight);
  await E.settled(page);
  var ro = await page.evaluate(sweep, { paths: [eight], reveal: false });
  verdict(t, ro);
  var oBar = await page.evaluate(function () {
    var el = document.querySelector('.node-toolbar');
    var st = document.getElementById('stage').getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return { docked: el.hasAttribute('data-docked'), lower: r.top + r.height / 2 > st.top + st.height / 2 };
  });
  t.check('the bar stays in the half of the stage its node is in, not a screen away', oBar.lower, oBar);
  await t.shot('foot');

  /* ---- the rows inside the chrome taken */
  t.step('the rows inside the chrome taken: the bar docks in the top capsules\' row, between them');
  await openMap(page, s, 4);
  await fitted(page);
  /* The deep tree moved up until its first leaves stand just under the top
   * capsules, in the row a docked bar would take first. */
  var lifted = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var st = document.getElementById('stage').getBoundingClientRect();
    var lead = document.getElementById('topbar-lead').getBoundingClientRect();
    var top = Infinity;
    v.visiblePaths().forEach(function (p) { top = Math.min(top, v.rect(p).top); });
    var c = v.camera();
    v.setCamera({ x: c.x, y: c.y - (top - (lead.bottom + 4)), k: c.k });
    var upper = v.visiblePaths().filter(function (p) { var r = v.rect(p); return r.top + r.height / 2 < st.top + st.height / 2; });
    return { upper: upper, gap: Math.round(lead.bottom + 4 - st.top) };
  });
  await E.settled(page);
  var z = await page.evaluate(sweep, { paths: lifted.upper, reveal: false });
  verdict(t, z);
  t.check('docked in the capsules\' row at least once', (z.rows['top-chrome'] || 0) > 0, z);
  var inRow = Object.keys(z.rowOf).filter(function (p) { return z.rowOf[p] === 'top-chrome'; });
  if (inRow.length) {
    await page.evaluate(function (p) { window.MindRoot.session.select(p, { reveal: false, animate: false }); }, inRow[0]);
    await E.settled(page);
    await t.shot('chrome-row');
  }

  t.step('the original case: Wall Street crash keeps The 1929 crisis free');
  await openMap(page, s, 0);
  await fitted(page);
  var wall = await E.pathOf(page, 'Wall Street crash');
  await E.clickNode(page, wall);
  await E.settled(page);
  var w = await page.evaluate(sweep, { paths: [wall], reveal: false });
  verdict(t, w);
  await t.shot('wall-street');
};
