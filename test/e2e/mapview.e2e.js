/* mapview: the map engine under a mouse, at a desktop size.
 *
 * test/fixtures/map/host.html mounts the view alone (tokens, the font,
 * base / motion / map styles, strings, colours, layout, gestures, mapview)
 * and wires selection and knobs the way a session would. Playwright's mouse
 * and keyboard drive it for real.
 *
 * Covered: rendering (nodes in their placing boxes, curves and stubs sharing
 * one path per colour, knobs and their targets, gradients where colours
 * change with their stops, the note dot inside its box, the edge-note dot on
 * the curve's midpoint, pictures from data:, blob: and missing assets,
 * escaped text, long words held to the column, a hostile colour kept out of
 * styles and strokes), the tree semantics, keyed DOM reuse (an insert
 * creates one element and the rest follow their content; an outdent keeps
 * the branch's elements and only restyles them), folds and the selection
 * following their nodes through inserts, undo, deletes and a fold hidden
 * inside a fold, render(tree, {folds}), the first-render fit, select and the
 * halo, a click that is not a gesture, tap on the background, double click
 * (activate, never a zoom; fit on the background), right click, knob folds
 * (plain and deep), a fold interrupted mid-way and one with no frames at
 * all, links / tasks / notes / pictures as intents, mouse pan with and
 * without a fling, wheel pan, Ctrl+wheel zoom at the cursor, zoom and pan
 * limits, pathAt, dropTarget, a node dragged onto another with its ghost
 * held by the grabbed point, its target and auto-pan, Escape cancelling a
 * drag, keyboard neighbours over the visible tree only, branches on both
 * sides where their markers say (and the legacy balance, settled and kept
 * in view), a drop onto either half of the root, insets, ensureVisible, reveal through a fold, the selected
 * node held still across a re-render, invalidate, a new image resolver,
 * pictures asked for again after clear / forgetImage / invalidate, a
 * synthetic root as stacked trees, read-only, notes open, the fit owed while
 * hidden, reduced motion, 2,000 nodes (render through the first paint, pan
 * frame rate), the camera composing with a layout still playing (render
 * then reveal, a hand pan mid-flight, two renders 40 ms apart, setCamera
 * mid-flight), strings in both languages, and screenshots in both themes,
 * each taken once everything has settled. */
'use strict';

module.exports = async function (t) {
  var page = t.page;

  async function load(query) {
    await page.goto(t.fileUrl('test/fixtures/map/host.html') + (query || ''));
    await page.waitForFunction(function () { return !!(window.view && window.MapTrees); });
  }

  function ev(fn, arg) { return page.evaluate(fn, arg); }

  async function until(fn, arg, what, ms) {
    try {
      await page.waitForFunction(fn, arg, { timeout: ms || 5000, polling: 20 });
      return true;
    } catch (err) {
      t.check('waited for ' + (what || 'a condition'), false, 'timed out');
      return false;
    }
  }

  /* The camera has stopped moving (fling, settle, glide all done). */
  /* Everything has landed (view.settled) and the camera holds still. */
  function still() {
    return ev(function () {
      return window.view.settled().then(function () {
        return new Promise(function (resolve) {
        var last = JSON.stringify(window.view.camera());
        var same = 0;
        (function poll() {
          setTimeout(function () {
            var now = JSON.stringify(window.view.camera());
            if (now === last && !document.querySelector('.mv-node--leaving')) { if (++same >= 4) return resolve(); } else { same = 0; last = now; }
            poll();
          }, 25);
        })();
        });
      });
    });
  }

  function textPoint(path) {
    return ev(function (p) {
      var el = window.view.nodeEl(p).querySelector('.mv-text');
      var r = el.getBoundingClientRect();
      return { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2 };
    }, path);
  }

  function boxCentre(path) {
    return ev(function (p) {
      var r = window.view.rect(p);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, path);
  }

  /* A point on the stage that is nothing: not a node, a knob, a link or a dot. */
  function emptyPoint() {
    return ev(function () {
      for (var y = 12; y < innerHeight; y += 37) {
        for (var x = 12; x < innerWidth; x += 41) {
          var el = document.elementFromPoint(x, y);
          if (el && el.classList.contains('mv') && window.view.pathAt(x, y) === null) return { x: x, y: y };
        }
      }
      return null;
    });
  }

  function events(type) { return ev(function (ty) { return window.events(ty); }, type); }
  function clearLog() { return ev(function () { window.log.length = 0; }); }
  function cam() { return ev(function () { return window.view.camera(); }); }
  function sleep(ms) { return t.sleep(ms); }

  await load();

  /* ------------------------------------------------------------------ */
  t.step('render the small map: nodes, links, stubs, knobs, fades, dots');
  await ev(function () { return window.show('small'); });
  var shape = await ev(function () {
    var q = function (s) { return document.querySelectorAll(s).length; };
    var grads = Array.prototype.map.call(document.querySelectorAll('.mv-under linearGradient'), function (g) { return g.querySelectorAll('stop').length; });
    var ds = Array.prototype.map.call(document.querySelectorAll('.mv-link'), function (l) { return l.getAttribute('d') || ''; });
    var count = function (re) { return ds.reduce(function (n, d) { return n + (d.match(re) || []).length; }, 0); };
    return {
      nodes: q('.mv-node'), places: q('.mv-pos'), curves: count(/C/g), stubs: count(/H/g), elements: ds.length, knobs: q('.mv-knob'), hits: q('.mv-knob-hit'),
      grads: grads, fadeLinks: Array.prototype.filter.call(document.querySelectorAll('.mv-link'), function (l) { return /^url\(/.test(l.getAttribute('stroke')); }).length,
      paths: window.view.visiblePaths()
    };
  });
  t.same(shape.paths, ['', '0', '0.0', '0.1', '1', '1.0', '1.1', '1.1.0', '1.1.1', '2', '2.0'], 'every node, in document order');
  t.eq(shape.nodes, 11, 'one div per node');
  t.eq(shape.places, 11, 'each in a box that only places it');
  t.eq(shape.curves, 10, 'one curve per parent-child pair');
  t.eq(shape.stubs, 11, 'one stub per node');
  t.check('lines of one colour share a path (stubs and links)', shape.elements <= 7 && shape.elements < shape.curves, shape.elements);
  t.eq(shape.knobs, 5, 'a knob on each node with children');
  t.eq(shape.hits, 5, 'each with a target beneath the words');
  t.same(shape.grads, [5, 5, 5], 'three hand-overs, five stops each');
  t.eq(shape.fadeLinks, 3, 'the links from the root fade between branch colours');

  var dots = await ev(function () {
    var node = window.view.nodeEl('2');
    var dot = node.querySelector('.mv-note-dot');
    var nr = node.getBoundingClientRect();
    var dr = dot.getBoundingClientRect();
    var mid = window.view.edgeMidpoint('1');
    var hit = document.elementFromPoint(mid.x, mid.y);
    return {
      inside: dr.left >= nr.left && dr.right <= nr.right && dr.top >= nr.top && dr.bottom <= nr.bottom,
      label: dot.getAttribute('aria-label'),
      edgeHit: hit && hit.className,
      edgeLabel: hit && hit.getAttribute('aria-label'),
      noEdge: window.view.edgeMidpoint('')
    };
  });
  t.check('the node-note dot is inside its box', dots.inside);
  t.eq(dots.label, 'Note: A note on gamma', 'labelled with the note');
  t.eq(dots.edgeHit, 'mv-edge-dot', 'the edge-note dot sits on the curve midpoint');
  t.eq(dots.edgeLabel, 'Note on the link: Why beta follows alpha', 'and says so to the pointer');
  t.eq(await ev(function () { return window.view.nodeEl('1').getAttribute('aria-description'); }), 'Note on the link: Why beta follows alpha', 'the node says it to assistive technology');
  t.same(await ev(function () {
    return Array.prototype.map.call(document.querySelector('.mv-under linearGradient').querySelectorAll('stop'), function (s) { return +s.getAttribute('offset'); });
  }), [0, 0.24, 0.5, 0.76, 1], 'a fade holds each colour for a quarter and mixes in the middle');
  t.eq(dots.noEdge, null, 'the root has no incoming edge');

  var fitted = await ev(function () {
    var out = true;
    window.view.visiblePaths().forEach(function (p) {
      var r = window.view.rect(p);
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) out = false;
    });
    return { all: out, k: window.view.camera().k };
  });
  t.check('the first render fits the map on the stage', fitted.all, fitted);
  t.check('a small map is shown at its own size, not blown up', fitted.k <= 1 + 1e-9, fitted.k);

  var aria = await ev(function () {
    var root = window.view.nodeEl('');
    var beta = window.view.nodeEl('1');
    return {
      tree: window.view.el.getAttribute('role'),
      label: window.view.el.getAttribute('aria-label'),
      role: beta.getAttribute('role'), level: beta.getAttribute('aria-level'), pos: beta.getAttribute('aria-posinset'),
      size: beta.getAttribute('aria-setsize'), expanded: beta.getAttribute('aria-expanded'), rootLevel: root.getAttribute('aria-level'),
      leaf: window.view.nodeEl('0.0').hasAttribute('aria-expanded')
    };
  });
  t.same(aria, { tree: 'tree', label: 'Mind map', role: 'treeitem', level: '2', pos: '2', size: '3', expanded: 'true', rootLevel: '1', leaf: false }, 'a tree for assistive technology');

  var hostile = await ev(function () {
    var v = window.view;
    var tree = window.MapTrees.small();
    tree.children[0].color = 'url(https://example.com/x.svg)';
    tree.children[0].children[0].color = 'red;background:url(https://example.com/y.png)';
    return v.render(tree, { animate: false }).then(function () {
      var out = {
        node: v.nodeEl('0').style.getPropertyValue('--branch'),
        child: v.nodeEl('0.0').style.getPropertyValue('--branch'),
        strokes: Array.prototype.map.call(document.querySelectorAll('.mv-link'), function (l) { return l.getAttribute('stroke'); })
          .filter(function (s) { return !/^#[0-9a-f]{6}$/.test(s) && !/^url\(#mv\d+-g-/.test(s); })
      };
      return window.show('small').then(function () { return out; });
    });
  });
  t.same(hostile, { node: '#c2703d', child: '#c2703d', strokes: [] }, 'a colour that is not a hex colour never reaches a style or a stroke');

  /* ------------------------------------------------------------------ */
  t.step('select, halo, background tap');
  await clearLog();
  var beta = await textPoint('1');
  await page.mouse.click(beta.x, beta.y);
  t.same((await events('select')).map(function (e) { return e.detail.path; }), ['1'], 'a click on a node reports select');
  t.eq((await events('gesture')).length, 0, 'a click is not a gesture: the floating bars stay put');
  var halo = await ev(function () {
    var h = document.querySelector('.mv-halo').getBoundingClientRect();
    var r = window.view.rect('1');
    var k = window.view.camera().k;
    return {
      shown: getComputedStyle(document.querySelector('.mv-halo')).display !== 'none',
      dx: Math.abs(h.left - (r.left - 4 * k)), dy: Math.abs(h.top - (r.top - 4 * k)), dw: Math.abs(h.width - (r.width + 8 * k)),
      selected: window.view.selected(),
      aria: window.view.nodeEl('1').getAttribute('aria-selected'),
      active: window.view.el.getAttribute('aria-activedescendant') === window.view.nodeEl('1').id,
      focus: document.activeElement === window.view.el
    };
  });
  t.check('the halo frames the selected node', halo.shown && halo.dx < 2 && halo.dy < 2 && halo.dw < 3, halo);
  t.eq(halo.selected, '1', 'selected');
  t.eq(halo.aria, 'true', 'aria-selected');
  t.check('the map names the selected node as its active descendant', halo.active);
  t.check('pressing the map gives it the keyboard', halo.focus);
  var empty = await emptyPoint();
  t.check('found an empty spot', !!empty);
  await page.mouse.click(empty.x, empty.y);
  t.eq((await events('background')).length, 1, 'a tap on the empty map reports background');
  t.eq(await ev(function () { return window.view.selected(); }), null, 'and the session deselects');
  t.eq(await ev(function () { return getComputedStyle(document.querySelector('.mv-halo')).display; }), 'none', 'no halo');

  /* ------------------------------------------------------------------ */
  t.step('double click: a node activates and never zooms; the background fits');
  await sleep(450);
  await clearLog();
  var before = await cam();
  var alpha = await textPoint('0');
  await page.mouse.dblclick(alpha.x, alpha.y);
  t.same((await events('activate')).map(function (e) { return e.detail.path; }), ['0'], 'activate on a double click');
  t.same(await cam(), before, 'the camera did not move');
  await ev(function () { window.view.setCamera({ x: -300, y: 200, k: 0.5 }); });
  var fitCam = await ev(function () {
    var v = window.view;
    var saved = v.camera();
    return v.fit().then(function () { var c = v.camera(); v.setCamera(saved); return c; });
  });
  await sleep(450);
  empty = await emptyPoint();
  await page.mouse.dblclick(empty.x, empty.y);
  await still();
  var after = await cam();
  t.check('a double click on the background fits the map', Math.abs(after.x - fitCam.x) < 1 && Math.abs(after.y - fitCam.y) < 1 && Math.abs(after.k - fitCam.k) < 1e-6, { after: after, fit: fitCam });

  /* ------------------------------------------------------------------ */
  t.step('two clicks with a key or a press elsewhere between them are two clicks');
  /* On the hand's clock (each event stamped, 30 ms down, the clicks 100 ms
   * apart): a loaded runner cannot stretch the pair past the double click
   * window, so the control below is a double click on any machine. A
   * click, Delete, Undo, click on the same node is two clicks, however
   * quick the hand: only two clicks in a row are a double click. */
  var mcdp = await page.context().newCDPSession(page);
  async function stampedClicks(p, between) {
    /* The clock starts 250 ms back: the wait keeps the first click more
     * than the double click window (400 ms) after the last of the pair
     * before, so it never pairs with that one. */
    await sleep(750);
    var h0 = Date.now() / 1000 - 0.25;
    function mouse(type, at) { return mcdp.send('Input.dispatchMouseEvent', { type: type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, timestamp: at }); }
    await mouse('mousePressed', h0);
    await mouse('mouseReleased', h0 + 0.03);
    if (between) await between(h0 + 0.06);
    await mouse('mousePressed', h0 + 0.1);
    await mouse('mouseReleased', h0 + 0.13);
  }
  await ev(function () { return window.view.fit(); });
  await still();
  alpha = await textPoint('0');
  await clearLog();
  await stampedClicks(alpha, null);
  t.same((await events('activate')).map(function (e) { return e.detail.path; }), ['0'], 'control: the same two clicks in a row are a double click');
  await clearLog();
  await stampedClicks(alpha, function (at) {
    return mcdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, timestamp: at }).then(function () {
      return mcdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, timestamp: at + 0.01 });
    });
  });
  t.same((await events('activate')).map(function (e) { return e.detail.path; }), [], 'a key between them: no double click');
  t.eq((await events('select')).length, 2, 'two clicks, each a select');
  await ev(function () {
    var b = document.createElement('button');
    b.id = 'elsewhere';
    b.textContent = 'elsewhere';
    b.style.cssText = 'position:fixed;left:0;bottom:0;width:60px;height:30px;z-index:9';
    document.body.appendChild(b);
  });
  var off = await ev(function () { var r = document.getElementById('elsewhere').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await clearLog();
  await stampedClicks(alpha, function (at) {
    return mcdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: off.x, y: off.y, button: 'left', buttons: 1, clickCount: 1, timestamp: at }).then(function () {
      return mcdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: off.x, y: off.y, button: 'left', buttons: 0, clickCount: 1, timestamp: at + 0.01 });
    });
  });
  t.same((await events('activate')).map(function (e) { return e.detail.path; }), [], 'a press off the map between them: no double click');
  await ev(function () { document.getElementById('elsewhere').remove(); });
  await mcdp.detach();

  /* ------------------------------------------------------------------ */
  t.step('right click is the context menu, on a node or on the map');
  await clearLog();
  var gamma = await textPoint('2');
  await page.mouse.click(gamma.x, gamma.y, { button: 'right' });
  empty = await emptyPoint();
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  var ctx = await events('context');
  t.same(ctx.map(function (e) { return e.detail.path; }), ['2', null], 'context on the node, then on the map');
  t.eq((await events('select')).length, 0, 'a right click does not select');

  /* ------------------------------------------------------------------ */
  t.step('knobs fold and unfold, Ctrl+click folds the whole branch');
  await clearLog();
  async function knobPoint(path) {
    return ev(function (p) {
      var k = document.querySelector('.mv-knob[data-path="' + p + '"] .mv-knob-dot').getBoundingClientRect();
      return { x: k.left + k.width / 2, y: k.top + k.height / 2 };
    }, path);
  }
  var kb = await knobPoint('1');
  await page.mouse.click(kb.x, kb.y);
  await still();
  var folded = await ev(function () {
    return {
      folded: window.view.isFolded('1'), set: Array.from(window.view.folded()),
      hiddenEl: !!window.view.nodeEl('1.0') || !!document.querySelector('[data-path="1.0"]'),
      paths: window.view.visiblePaths(), expanded: window.view.nodeEl('1').getAttribute('aria-expanded'),
      filled: document.querySelector('.mv-knob[data-path="1"]').classList.contains('is-folded')
    };
  });
  t.check('folded', folded.folded);
  t.same(folded.set, ['1'], 'the fold set');
  t.eq(folded.hiddenEl, false, 'a folded subtree is not rendered at all');
  t.same(folded.paths, ['', '0', '0.0', '0.1', '1', '2', '2.0'], 'visible paths skip it');
  t.eq(folded.expanded, 'false', 'aria-expanded false');
  t.check('the knob is filled', folded.filled);
  var kev = await events('knob');
  t.same(kev.map(function (e) { return e.detail; }), [{ path: '1', deep: false, folded: true }], 'knob reported after the fact');
  t.eq((await events('fold')).length, 1, 'and a fold event for persistence');
  kb = await knobPoint('1');
  await page.mouse.click(kb.x, kb.y);
  await still();
  t.eq(await ev(function () { return window.view.visiblePaths().length; }), 11, 'unfolded again');
  await sleep(450);
  var kr = await knobPoint('');
  await page.keyboard.down('Control');
  await page.mouse.click(kr.x, kr.y);
  await page.keyboard.up('Control');
  await still();
  t.same(await ev(function () { return Array.from(window.view.folded()).sort(); }), ['', '0', '1', '1.1', '2'], 'Ctrl+click folds every node of the branch');
  t.same(await ev(function () { return window.view.visiblePaths(); }), [''], 'only the root shows');
  await sleep(450);
  kr = await knobPoint('');
  await page.keyboard.down('Control');
  await page.mouse.click(kr.x, kr.y);
  await page.keyboard.up('Control');
  await still();
  t.eq(await ev(function () { return window.view.folded().size; }), 0, 'Ctrl+click again opens them all');

  /* ------------------------------------------------------------------ */
  t.step('a fold is interruptible, and lands even with no frames');
  await still();
  var flip = await ev(function () {
    var v = window.view;
    var el = v.nodeEl('1.0');
    var expect = JSON.stringify(v.geometry().nodes);
    v.fold('1', true);
    return new Promise(function (r) { setTimeout(r, 60); }).then(function () {
      var mid = document.querySelectorAll('.mv-node--leaving').length;
      v.fold('1', false);
      return new Promise(function (r) { setTimeout(r, 450); }).then(function () {
        var n = v.geometry().nodes['1.0'];
        return {
          mid: mid, same: v.nodeEl('1.0') === el, geo: JSON.stringify(v.geometry().nodes) === expect,
          transform: el.parentNode.style.left + ' ' + el.parentNode.style.top + ' ' + el.parentNode.style.transform, want: n.x + 'px ' + n.y + 'px ', opacity: el.parentNode.style.opacity,
          leaving: document.querySelectorAll('.mv-node--leaving').length
        };
      });
    });
  });
  t.check('mid-fold, the children were on their way into the parent', flip.mid > 0, flip.mid);
  t.check('unfolding mid-way brings back the same elements', flip.same);
  t.check('and lands exactly where the layout says', flip.geo && flip.transform === flip.want && flip.opacity === '' && flip.leaving === 0, flip);
  var noFrames = await ev(function () {
    var v = window.view;
    var raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function () { return 0; };
    v.fold('1', true);
    var c = v.camera();
    v.setCamera({ x: c.x + 200, y: c.y, k: c.k });
    var fitted = false;
    v.fit({ animate: true }).then(function () { fitted = true; });
    return new Promise(function (r) { setTimeout(r, 800); }).then(function () {
      window.requestAnimationFrame = raf;
      var out = { fitted: fitted, leaving: document.querySelectorAll('.mv-node--leaving').length, gone: !document.querySelector('[data-path="1.0"]') };
      return v.fold('1', false).then(function () { return out; });
    });
  });
  t.same(noFrames, { fitted: true, leaving: 0, gone: true }, 'with frames withheld (a hidden tab) the fold and the glide still land');
  await still();

  /* ------------------------------------------------------------------ */
  t.step('one insert creates one element; the rest follow their content');
  var churn = await ev(function () {
    var v = window.view;
    var before = new Map();
    v.visiblePaths().forEach(function (p) { var el = v.nodeEl(p); el.__mark = p; before.set(p, el); });
    var alphaOne = v.nodeEl('0.0');
    var next = window.MapTrees.withChild(window.MapTrees.small(), '0', 0, 'New first');
    return v.render(next, { animate: false }).then(function () {
      var fresh = 0;
      var kept = 0;
      v.visiblePaths().forEach(function (p) { if (v.nodeEl(p).__mark === undefined) fresh++; else kept++; });
      var gone = 0;
      before.forEach(function (el) { if (!el.isConnected) gone++; });
      return { fresh: fresh, kept: kept, gone: gone, follows: v.nodeEl('0.1') === alphaOne, text: v.nodeEl('0.1').textContent, newText: v.nodeEl('0.0').textContent };
    });
  });
  t.eq(churn.fresh, 1, 'exactly one new element');
  t.eq(churn.kept, 11, 'every other element kept');
  t.eq(churn.gone, 0, 'none thrown away');
  t.check('"Alpha one" kept its element at its new path', churn.follows);
  t.eq(churn.text, 'Alpha one', 'with its words');
  t.eq(churn.newText, 'New first', 'the new node at 0.0');
  await ev(function () { return window.show('small'); });

  /* ------------------------------------------------------------------ */
  t.step('folds and the selection follow their nodes through an edit');
  var carried = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    var out = {};
    function snap() {
      return { folded: Array.from(v.folded()).sort(), selected: v.selected(), visible: v.visiblePaths(), leaving: document.querySelectorAll('.mv-node--leaving').length };
    }
    return window.show('small').then(function () {
      v.select(null);
      return v.fold('1', true, { animate: false });
    }).then(function () {
      v.select('1');
      var gammaKid = v.nodeEl('2.0');
      window.log.length = 0;
      return v.render(T.withChild(T.small(), '', 0, 'New first branch')).then(function () {
        out.insert = snap();
        out.insert.kept = v.nodeEl('3.0') === gammaKid;
        out.insert.events = window.events('fold').map(function (e) { return e.detail; });
        return v.settled();
      });
    }).then(function () {
      return v.render(T.small(), { animate: false });
    }).then(function () {
      out.back = snap();
      return v.fold('1.1', true, { animate: false });
    }).then(function () {
      return v.fold('1', true, { animate: false });
    }).then(function () {
      return v.render(T.withChild(T.small(), '', 0, 'X'), { animate: false });
    }).then(function () {
      out.nested = snap();
      return v.render(T.without(T.withChild(T.small(), '', 0, 'X'), '2'), { animate: false });
    }).then(function () {
      out.deleted = snap();
      return v.render(T.small(), { animate: false, folds: new Set(['2']) });
    }).then(function () {
      out.given = snap();
      return v.setFolded(new Set(), { animate: false });
    }).then(function () { return out; });
  });
  t.same(carried.insert.folded, ['2'], 'a branch inserted above: the fold moves with Beta to its new path');
  t.eq(carried.insert.selected, '2', 'and so does the selection');
  t.same(carried.insert.visible, ['', '0', '1', '1.0', '1.1', '2', '3', '3.0'], 'Alpha (now at Beta\'s old path) stays open, Beta stays shut');
  t.eq(carried.insert.leaving, 0, 'nothing folds away or grows in that did not change');
  t.check('Gamma\'s child keeps its element', carried.insert.kept);
  t.same(carried.insert.events, [{ path: null, folded: null, deep: false, folds: ['2'], remapped: true }], 'the new fold set is reported for persistence');
  t.same(carried.back.folded, ['1'], 'undo: it goes back with it');
  t.same(carried.nested.folded, ['2', '2.1'], 'a fold hidden inside a fold rides along');
  t.same(carried.deleted.folded, [], 'a deleted node takes its folds with it (Gamma does not inherit them)');
  t.eq(carried.deleted.selected, null, 'and its selection');
  t.same(carried.given.folded, ['2'], 'render(tree, {folds}) applies the folds of the new tree in the same update');
  t.same(carried.given.visible, ['', '0', '0.0', '0.1', '1', '1.0', '1.1', '1.1.0', '1.1.1', '2'], 'exactly those');

  /* ------------------------------------------------------------------ */
  t.step('an outdent or an indent keeps the elements of the branch');
  var outdent = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    return window.show('small').then(function () {
      var els = ['1.1', '1.1.0', '1.1.1'].map(function (p) { return v.nodeEl(p); });
      var before = new Set(Array.prototype.slice.call(document.querySelectorAll('.mv-node')));
      var w0 = v.geometry().nodes['1.1'].w;
      return v.render(T.moved(T.small(), '1.1', '', 2)).then(function () {
        var now = ['2', '2.0', '2.1'].map(function (p) { return v.nodeEl(p); });
        var out = {
          same: now.every(function (el, i) { return el === els[i]; }),
          fresh: Array.prototype.filter.call(document.querySelectorAll('.mv-node'), function (el) { return !before.has(el); }).length,
          leaving: document.querySelectorAll('.mv-node--leaving').length,
          depth: now.map(function (el) { return (/mv-d\d/.exec(el.className) || [''])[0]; }),
          grew: v.geometry().nodes['2'].w > w0
        };
        return v.settled().then(function () {
          var n = v.geometry().nodes['2'];
          out.landed = els[0].parentNode.style.left === n.x + 'px' && els[0].parentNode.style.top === n.y + 'px' && !els[0].parentNode.style.transform;
          return v.render(T.small());
        }).then(function () {
          out.back = ['1.1', '1.1.0', '1.1.1'].map(function (p) { return v.nodeEl(p); }).every(function (el, i) { return el === els[i]; });
          return v.settled();
        }).then(function () { return out; });
      });
    });
  });
  t.check('the moved branch keeps its three elements', outdent.same, outdent);
  t.eq(outdent.fresh, 0, 'no element made');
  t.eq(outdent.leaving, 0, 'none folding away');
  t.same(outdent.depth, ['mv-d1', 'mv-d2', 'mv-d2'], 'only their type size changes');
  t.check('measured again at the new size', outdent.grew);
  t.check('and it flies to its new place', outdent.landed);
  t.check('an indent back keeps them too', outdent.back);

  /* ------------------------------------------------------------------ */
  t.step('mouse drag pans 1:1; a quick release flings on');
  await still();
  empty = await emptyPoint();
  before = await cam();
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  for (var i = 1; i <= 8; i++) await page.mouse.move(empty.x + i * 15, empty.y + i * 10);
  await sleep(120);
  await page.mouse.up();
  await sleep(80);
  after = await cam();
  t.check('the content moved exactly with the mouse', Math.abs(after.x - before.x - 120) < 0.01 && Math.abs(after.y - before.y - 80) < 0.01, { before: before, after: after });
  t.eq((await events('select')).length, 0, 'a pan selects nothing');
  await ev(function () { return window.view.fit(); });
  await still();
  empty = await emptyPoint();
  before = await cam();
  /* A flick on its own clock (16 ms a move, released 4 ms after the last),
   * whatever a busy runner does to the delivery: the speed the map
   * measures is the flick's. The clock starts a little in the past, after a
   * longer pause, so it never runs back before the previous events. */
  var mcdp = await page.context().newCDPSession(page);
  await sleep(600);
  var mclock = Date.now() / 1000 - 0.5;
  var mouseAt = function (type, x, y, at, buttons) {
    return mcdp.send('Input.dispatchMouseEvent', { type: type, x: x, y: y, button: 'left', buttons: buttons, clickCount: 1, timestamp: at });
  };
  await mouseAt('mouseMoved', empty.x, empty.y, mclock, 0);
  await mouseAt('mousePressed', empty.x, empty.y, mclock + 0.004, 1);
  for (var f = 1; f <= 6; f++) await mouseAt('mouseMoved', empty.x + f * 12, empty.y, mclock + 0.004 + f * 0.016, 1);
  await mouseAt('mouseReleased', empty.x + 72, empty.y, mclock + 0.008 + 6 * 0.016, 0);
  await still();
  after = await cam();
  t.check('momentum carries the map on past where the hand let go', after.x - before.x > 72 + 20, { before: before.x, rest: after.x });
  t.eq(after.y, before.y, 'along the direction of the fling only');

  /* ------------------------------------------------------------------ */
  t.step('the wheel pans; Ctrl+wheel zooms about the cursor');
  await ev(function () { window.view.fit(); });
  empty = await emptyPoint();
  await page.mouse.move(empty.x, empty.y);
  before = await cam();
  await page.mouse.wheel(30, 100);
  await sleep(50);
  after = await cam();
  t.check('a plain wheel pans by its deltas', Math.abs(before.y - after.y - 100) < 0.01 && Math.abs(before.x - after.x - 30) < 0.01 && after.k === before.k, { before: before, after: after });
  /* Whole pixels: that is what a MouseEvent carries in Chromium. */
  var spot = await boxCentre('1.1');
  spot = { x: Math.round(spot.x), y: Math.round(spot.y) };
  await page.mouse.move(spot.x, spot.y);
  var under = await ev(function (s) { var c = window.view.camera(); var r = window.view.el.getBoundingClientRect(); return { x: (s.x - r.left - c.x) / c.k, y: (s.y - r.top - c.y) / c.k }; }, spot);
  before = await cam();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await sleep(50);
  after = await cam();
  var stays = await ev(function (s) { var c = window.view.camera(); var r = window.view.el.getBoundingClientRect(); return { x: (s.x - r.left - c.x) / c.k, y: (s.y - r.top - c.y) / c.k }; }, spot);
  t.check('zoomed in', after.k > before.k * 1.2, { before: before.k, after: after.k });
  t.check('the point under the cursor stays under it', Math.abs(stays.x - under.x) < 0.01 && Math.abs(stays.y - under.y) < 0.01, { under: under, stays: stays });
  t.eq(await ev(function () { return window.view.pathAt(arguments[0].x, arguments[0].y); }, spot), '1.1', 'and it is still that node');

  /* ------------------------------------------------------------------ */
  t.step('zoom stays within [0.1, 4]; the camera round-trips');
  var limits = await ev(function () {
    var v = window.view;
    var out = {};
    return v.zoomTo(50).then(function () {
      out.max = v.camera().k;
      return v.zoomTo(0.0001);
    }).then(function () {
      out.min = v.camera().k;
      return v.zoomBy(1e6);
    }).then(function () {
      out.by = v.camera().k;
      v.setCamera({ x: 12.5, y: -40, k: 1.25 });
      out.round = v.camera();
      v.setCamera({ x: 0, y: 0, k: 99 });
      out.clamped = v.camera().k;
      return out;
    });
  });
  t.eq(limits.max, 4, 'zoomTo clamps at 4');
  t.eq(limits.min, 0.1, 'and at 0.1');
  t.eq(limits.by, 4, 'zoomBy clamps too');
  t.same(limits.round, { x: 12.5, y: -40, k: 1.25 }, 'setCamera / camera round-trip');
  t.eq(limits.clamped, 4, 'a stored camera is clamped');
  await page.keyboard.down('Control');
  await ev(function () { window.view.setCamera({ x: 400, y: 300, k: 3.9 }); });
  for (var w = 0; w < 8; w++) await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  t.eq((await cam()).k, 4, 'the wheel stops at 4');
  await ev(function () { window.view.setCamera({ x: 400, y: 300, k: 0.15 }); });
  await page.keyboard.down('Control');
  for (var w2 = 0; w2 < 8; w2++) await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  t.eq((await cam()).k, 0.1, 'and at 0.1');
  var kept = await ev(function () {
    var v = window.view;
    v.setCamera({ x: -100000, y: 50000, k: 1 });
    var c = v.camera();
    var b = v.geometry().bounds;
    var r = v.el.getBoundingClientRect();
    var left = c.x + b.x * c.k;
    var right = c.x + (b.x + b.w) * c.k;
    var top = c.y + b.y * c.k;
    var bottom = c.y + (b.y + b.h) * c.k;
    return right >= Math.min(64, b.w) - 0.5 && left <= r.width && bottom >= 0 && top <= r.height - Math.min(64, b.h) + 0.5;
  });
  t.check('a camera far away is pulled back until part of the map shows', kept);
  await ev(function () { return window.view.fit(); });

  /* ------------------------------------------------------------------ */
  t.step('links, tasks, notes and pictures are intents');
  await ev(function () { return window.show('rich').then(function () { return window.view.fit(); }); });
  await until(function () { return !!document.querySelector('img[src^="blob:"]'); }, null, 'the stored picture');
  var pics = await ev(function () {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img.mv-img'));
    return {
      resolved: window.resolved.slice().sort(),
      srcs: imgs.map(function (i) { return (i.getAttribute('src') || '').slice(0, 5); }),
      broken: imgs.filter(function (i) { return i.getAttribute('data-broken') === 'true'; }).map(function (i) { return i.alt; }),
      dataSrc: imgs.map(function (i) { return i.getAttribute('data-src'); }).filter(function (s) { return /^assets/.test(s); }).sort(),
      escaped: window.view.nodeEl('0.3').textContent,
      scripts: window.view.el.querySelectorAll('script').length,
      longest: Math.max.apply(null, window.view.visiblePaths().map(function (p) { return window.view.nodeEl(p).offsetWidth; })),
      wordBox: window.view.nodeEl('0.0').offsetWidth
    };
  });
  t.same(pics.resolved, ['assets/blob-picture.png', 'assets/missing.png'], 'only asset paths go through the resolver');
  t.check('pictures load only from data: and blob:', pics.srcs.every(function (s) { return s === 'data:' || s === 'blob:' || s === ''; }), pics.srcs);
  t.same(pics.broken, ['Missing picture: assets/missing.png'], 'a missing asset shows as missing, with its path');
  t.same(pics.dataSrc, ['assets/blob-picture.png', 'assets/missing.png'], 'the original path stays on the picture (for the export)');
  t.eq(pics.escaped, '<script>alert(1)</script> & **not bold**', 'markup in the words is shown, not run');
  t.eq(pics.scripts, 0, 'no script element on the map');
  t.check('a long unbreakable word wraps inside the 320 px column', pics.wordBox <= 344, pics.wordBox);
  t.check('no box is wider than a pair of pictures allows', pics.longest <= 744, pics.longest);

  var layoutOfPics = await ev(function () {
    var v = window.view;
    function r(el) { return el.getBoundingClientRect(); }
    function parts(p) { var n = v.nodeEl(p); return { img: r(n.querySelector('img')), text: r(n.querySelector('.mv-text')) }; }
    var left = parts('1.0');
    var right = parts('1.1');
    var above = parts('1.2');
    return {
      left: left.img.right <= left.text.left,
      right: right.img.left >= right.text.right,
      above: above.img.bottom <= above.text.top,
      sizes: ['1.0', '1.1', '1.2', '1.3'].map(function (p) { var n = v.nodeEl(p); return n.classList.contains('mv-node--row') ? 'row' : n.classList.contains('mv-node--col') ? 'col' : n.classList.contains('mv-node--pair') ? 'pair' : ''; })
    };
  });
  t.check('a picture on the left stands left of the words', layoutOfPics.left);
  t.check('on the right, right of them', layoutOfPics.right);
  t.check('above, over them', layoutOfPics.above);
  t.same(layoutOfPics.sizes, ['row', 'row', 'col', 'row'], 'each box gets the room its pictures need');

  await clearLog();
  async function clickIn(path, selector, opts) {
    await ev(function (a) {
      var el = window.view.nodeEl(a.p).querySelector(a.s);
      var b = window.view.rect(a.p);
      window.view.setCamera({ x: window.view.camera().x - (b.left - 300), y: window.view.camera().y - (b.top - 300), k: window.view.camera().k });
      return !!el;
    }, { p: path, s: selector });
    /* The first line box: a wrapped link's bounding box spans the gap
     * between its lines. */
    var pt = await ev(function (a) {
      var r = window.view.nodeEl(a.p).querySelector(a.s).getClientRects()[0];
      return { x: r.left + Math.min(r.width / 2, 12), y: r.top + r.height / 2 };
    }, { p: path, s: selector });
    await page.mouse.click(pt.x, pt.y, opts);
    await sleep(30);
  }
  await ev(function () { window.view.setCamera({ x: 0, y: 0, k: 1 }); });
  await clickIn('0.1', 'a');
  await clickIn('0.2', 'a.md-map');
  await clickIn('3.0', '.mv-task');
  await clickIn('3.1', '.mv-note-dot');
  await clickIn('1.0', 'img');
  var intents = await ev(function () {
    return window.log.filter(function (e) { return e.type !== 'render' && e.type !== 'gesture'; }).map(function (e) {
      var d = e.detail;
      if (e.type === 'link') return 'link ' + d.path + ' ' + d.kind + ' ' + d.href;
      if (e.type === 'note') return 'note ' + d.path + ' ' + d.kind;
      if (e.type === 'image') return 'image ' + d.path + ' ' + d.image.kind + ' ' + (d.image.path === window.MapTrees.PICS.wide);
      return e.type + ' ' + d.path;
    });
  });
  t.same(intents, [
    'link 0.1 url https://example.com/a/very/long/path/that/goes/on',
    'link 0.2 map Biology',
    'task 3.0',
    'note 3.1 node',
    'select 1.0',
    'image 1.0 photo true'
  ], 'link, map link, task, note, picture: each its own intent');
  t.eq(page.url().indexOf('example.com'), -1, 'the browser never followed the link');
  await clearLog();
  var mid = await ev(function () {
    var v = window.view;
    var m = v.edgeMidpoint('0');
    var c = v.camera();
    v.setCamera({ x: c.x - (m.x - 400), y: c.y - (m.y - 300), k: c.k });
    return v.edgeMidpoint('0');
  });
  await page.mouse.click(mid.x, mid.y);
  t.same((await events('note')).map(function (e) { return e.detail; }), [{ path: '0', kind: 'edge' }], 'the edge-note dot opens the edge note');

  /* ------------------------------------------------------------------ */
  t.step('pathAt and dropTarget');
  await ev(function () { return window.show('small').then(function () { return window.view.fit(); }); });
  var hits = await ev(function () {
    var v = window.view;
    function at(p, fy) { var r = v.rect(p); return { x: r.left + r.width / 2, y: r.top + r.height * fy }; }
    function dt(p, fy, dragged) { var q = at(p, fy); return v.dropTarget(q.x, q.y, dragged); }
    var c = at('1', 0.5);
    var gapY = (function () { var a = v.rect('0.0'); var b = v.rect('0.1'); return { x: a.left + 5, y: (a.bottom + b.top) / 2 }; })();
    return {
      path: v.pathAt(c.x, c.y),
      none: v.pathAt(2, 2),
      upper: dt('1', 0.1, '2.0'),
      middle: dt('1', 0.5, '2.0'),
      lower: dt('1', 0.9, '2.0'),
      self: dt('1', 0.5, '1'),
      inside: dt('1.1.0', 0.5, '1'),
      root: dt('', 0.1, '2.0'),
      noopAfterPrev: dt('0', 0.9, '1'),
      noopBeforeNext: dt('2', 0.1, '1'),
      noopLastChild: dt('', 0.5, '2'),
      between: v.dropTarget(gapY.x, gapY.y, '2.0'),
      nothing: v.dropTarget(2, 2, '2.0')
    };
  });
  t.eq(hits.path, '1', 'pathAt finds the node under a point');
  t.eq(hits.none, null, 'and nothing on the empty map');
  t.same(hits.upper, { path: '1', where: 'before', side: 'right' }, 'upper third: before (beside a right branch: the right side)');
  t.same(hits.middle, { path: '1', where: 'child', side: null }, 'middle: child (deeper: no side)');
  t.same(hits.lower, { path: '1', where: 'after', side: 'right' }, 'lower third: after');
  t.eq(hits.self, null, 'never onto itself');
  t.eq(hits.inside, null, 'never into its own branch');
  t.same(hits.root, { path: '', where: 'child', side: 'right' }, 'the root takes children only (its right half: the right side)');
  t.eq(hits.noopAfterPrev, null, 'after the node before it changes nothing');
  t.eq(hits.noopBeforeNext, null, 'before the node after it changes nothing');
  t.eq(hits.noopLastChild, null, 'the last child onto its own parent changes nothing');
  t.check('the gap between two siblings still answers', !!hits.between && (hits.between.where === 'after' || hits.between.where === 'before'), hits.between);
  t.eq(hits.nothing, null, 'nothing far from any node');

  /* ------------------------------------------------------------------ */
  t.step('drag a node with the mouse: ghost, target, drop');
  await load('?drag');
  await ev(function () { return window.show('small'); });
  await still();
  var from = await textPoint('2.0');
  var onto = await boxCentre('0');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 2);
  t.eq((await events('dragstart')).length, 0, 'a few pixels do not lift the node');
  for (var d = 1; d <= 10; d++) await page.mouse.move(from.x + (onto.x - from.x) * d / 10, from.y + (onto.y - from.y) * d / 10);
  /* Held still over Alpha a moment: a drop there means onto it. */
  await require('../fixtures/map/drop.js').decided(page);
  await page.mouse.move(onto.x, onto.y);
  var mid2 = await ev(function (pt) {
    var g = document.querySelector('.mv-ghost');
    var orig = window.view.nodeEl('2.0');
    var gr = g ? g.getBoundingClientRect() : null;
    var from = window.dragFrom;
    return {
      ghost: !!g, ghostText: g && g.textContent, lifted: !!(g && g.classList.contains('mv-ghost--lift')),
      /* The point of the node the hand picked it up by stays under it,
       * lifted or not. */
      offset: gr && from ? {
        dx: Math.round(((pt.x - gr.left) / gr.width - (from.x - from.left) / from.width) * 1000) / 1000,
        dy: Math.round(((pt.y - gr.top) / gr.height - (from.y - from.top) / from.height) * 1000) / 1000,
        lift: Math.round(gr.width / from.width * 1000) / 1000
      } : null,
      dim: orig.classList.contains('mv-node--dragging'),
      lit: Array.prototype.map.call(document.querySelectorAll('.mv-node--drop'), function (n) { return n.getAttribute('data-path'); }),
      target: window.lastTarget,
      started: window.events('dragstart').map(function (e) { return e.detail.path; })
    };
  }, onto);
  t.same(mid2.started, ['2.0'], 'the node lifts after 10 px');
  t.check('a lifted copy of the node', mid2.ghost && mid2.ghostText === 'Gamma one', mid2);
  t.check('follows the pointer by the point it was picked up by', mid2.offset && Math.abs(mid2.offset.dx) < 0.01 && Math.abs(mid2.offset.dy) < 0.01, mid2.offset);
  /* Measured as a ratio of two rectangles snapped to pixels: the 2% is --mv-lift, within a pixel's rounding. */
  t.check('lifted: 2% bigger', !!mid2.offset && Math.abs(mid2.offset.lift - 1.02) <= 0.01, mid2.offset);
  t.check('the original is dimmed in place', mid2.dim);
  t.same(mid2.lit, ['0'], 'the target node lights up');
  t.same(mid2.target, { path: '0', where: 'child', side: null }, 'over the middle of Alpha: as its child');
  await page.mouse.up();
  var end = await events('dragend');
  t.same(end.map(function (e) { return e.detail; }), [{ path: '2.0', cancelled: false, target: { path: '0', where: 'child', side: null } }], 'the drop reports where');
  await until(function () { return !document.querySelector('.mv-ghost') && !document.querySelector('.mv-node--drop') && !document.querySelector('.mv-node--dragging'); }, null, 'the ghost to go');
  t.eq((await events('select')).length, 0, 'a drag selects nothing');

  await clearLog();
  from = await textPoint('2.0');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (var e1 = 1; e1 <= 5; e1++) await page.mouse.move(from.x - e1 * 10, from.y - e1 * 10);
  await page.keyboard.press('Escape');
  await page.mouse.move(from.x - 80, from.y - 80);
  await page.mouse.up();
  t.same((await events('dragend')).map(function (e) { return e.detail.cancelled; }), [true], 'Escape cancels the drag');
  t.eq((await events('dragend')).length, 1, 'once');
  await until(function () { return !document.querySelector('.mv-ghost'); }, null, 'the ghost to fly back and go');

  await clearLog();
  from = await textPoint('2.0');
  before = await cam();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (var e2 = 1; e2 <= 6; e2++) await page.mouse.move(from.x + (8 - from.x) * e2 / 6, from.y);
  await sleep(300);
  after = await cam();
  t.check('held near the left edge, the map pans by itself', after.x - before.x > 40, { before: before.x, after: after.x });
  await page.mouse.up();
  await until(function () { return !document.querySelector('.mv-ghost'); }, null, 'the ghost to go');

  /* ------------------------------------------------------------------ */
  t.step('arrow neighbours walk the visible tree only');
  await ev(function () { return window.show('small'); });
  var nb = await ev(function () {
    var v = window.view;
    var out = {};
    out.down = v.neighbor('0', 'down');
    out.up = v.neighbor('1', 'up');
    out.right = v.neighbor('1', 'right');
    out.left = v.neighbor('1.1', 'left');
    out.first = v.neighbor(null, 'down');
    out.pastEnd = v.neighbor('0.1', 'down');
    return v.fold('1', true).then(function () {
      out.foldedRight = v.neighbor('1', 'right');
      out.skip = v.neighbor('0.1', 'down');
      out.visible = v.visiblePaths();
      return v.fold('1', false);
    }).then(function () { return out; });
  });
  t.eq(nb.down, '1', 'down: the next sibling');
  t.eq(nb.up, '0', 'up: the previous sibling');
  t.eq(nb.right, '1.0', 'right: the first child');
  t.eq(nb.left, '1', 'left: the parent');
  t.eq(nb.first, '', 'with nothing selected: the root');
  t.eq(nb.pastEnd, '1.0', 'past the last sibling: the nearest node below at the same depth');
  t.eq(nb.foldedRight, null, 'right on a folded node goes nowhere hidden');
  t.check('down skips what a fold hides', nb.visible.indexOf(nb.skip) >= 0 && nb.skip === '2.0', nb.skip);

  /* ------------------------------------------------------------------ */
  t.step("branches on both sides");
  var both = await ev(function () {
    var v = window.view;
    var whole = function () {
      return v.visiblePaths().every(function (p) { var r = v.nodeEl(p).getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    };
    var before = whole();
    return v.setOptions({ balance: true }).then(function () { return v.settled(); }).then(function () {
      var left = v.visiblePaths().filter(function (p) { return v.nodeEl(p).classList.contains('mv-node--left'); });
      var g = v.geometry();
      return {
        before: before, after: whole(), moving: document.querySelectorAll('.mv-node--leaving').length,
        left: left, rightOfRoot: g.nodes['0'].x > g.nodes[''].x,
        leftOfRoot: left.length ? g.nodes[left[0]].x + g.nodes[left[0]].w < g.nodes[''].x : false,
        outward: left.length ? v.neighbor(left[0], 'left') : null,
        home: left.length ? v.neighbor(left[0], 'right') : null,
        rootLeft: v.neighbor('', 'left')
      };
    });
  });
  t.check('some branches go left', both.left.length > 0, both.left);
  t.check('the first branch stays right', both.rightOfRoot);
  t.check('left branches end before the root', both.leftOfRoot);
  t.eq(both.home, '', 'on the left side, right goes back to the root');
  t.eq(both.rootLeft, both.left[0], 'from the root, left goes to the first left branch');
  t.check('the whole map was in view, and still is once it has taken its new shape', both.before && both.after, both);
  await t.shot('both-light');
  await ev(function () { return window.view.setOptions({ balance: false }); });

  var marked = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    var lefts = ['0', '2'];
    return v.render(T.sided(T.small(), lefts), { animate: false }).then(function () { return v.settled(); }).then(function () {
      var g = v.geometry();
      var first = Object.keys(g.nodes).filter(function (p) { return g.nodes[p].parent === ''; }).sort();
      var deep = Object.keys(g.nodes).filter(function (p) { return p.indexOf('.') >= 0; });
      var boxes = Object.keys(g.nodes).map(function (p) { return g.nodes[p]; });
      var overlap = false;
      for (var i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) {
        var a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
      }
      return {
        sides: first.map(function (p) { return g.nodes[p].side; }),
        deepFollow: deep.every(function (p) { return g.nodes[p].side === g.nodes[p.split('.')[0]].side; }),
        leftOfRoot: g.nodes['0'].x + g.nodes['0'].w < g.nodes[''].x && g.nodes['2'].x + g.nodes['2'].w < g.nodes[''].x,
        rightOfRoot: g.nodes['1'].x > g.nodes[''].x + g.nodes[''].w,
        classes: v.nodeEl('0').classList.contains('mv-node--left') && !v.nodeEl('1').classList.contains('mv-node--left'),
        overlap: overlap,
        dropLeft: (function () { var r = v.rect(''); return v.dropTarget(r.left + 3, r.top + r.height / 2, '1'); })(),
        dropRight: (function () { var r = v.rect(''); return v.dropTarget(r.right - 3, r.top + r.height / 2, '0'); })(),
        dropBeside: (function () { var r = v.rect('2'); return v.dropTarget(r.left + r.width / 2, r.top + 1, '1'); })(),
        dropDeep: (function () { var r = v.rect('1.0'); return v.dropTarget(r.left + r.width / 2, r.top + 1, '0'); })()
      };
    });
  });
  t.same(marked.sides, ['left', 'right', 'left'], 'each first-level branch where its marker says, nothing balanced');
  t.check('their children grow on their side', marked.deepFollow);
  t.check('left branches end before the root, right ones start after it', marked.leftOfRoot && marked.rightOfRoot, marked);
  t.check('the left ones are drawn as left nodes', marked.classes);
  t.check('no two boxes overlap', !marked.overlap);
  t.eq(marked.dropLeft && marked.dropLeft.side, 'left', 'a drop on the left half of the root: the left side');
  t.eq(marked.dropRight && marked.dropRight.side, 'right', 'on the right half: the right side');
  t.check('a right branch dropped onto the root\'s left half is a move even as its last branch', !!marked.dropLeft && marked.dropLeft.where === 'child');
  t.eq(marked.dropBeside && marked.dropBeside.side, 'left', 'a drop beside a left branch: the left side');
  t.eq(marked.dropDeep && marked.dropDeep.side, null, 'deeper: no side, it grows on its parent\'s');
  await t.shot('sides-light');

  /* ------------------------------------------------------------------ */
  t.step('what the session and the editor lean on');
  var helpers = await ev(function () {
    var v = window.view;
    var out = {};
    return window.show('small').then(function () {
      v.setInsets({ top: 120, right: 0, bottom: 0, left: 0 });
      return v.fit();
    }).then(function () {
      out.insetTop = Math.min.apply(null, v.visiblePaths().map(function (p) { return v.rect(p).top; }));
      v.setInsets(null);
      v.setCamera({ x: -2000, y: 0, k: 1 });
      return v.ensureVisible('1.1.1', { animate: false });
    }).then(function () {
      var r = v.rect('1.1.1');
      out.revealed = r.left >= 24 && r.right <= innerWidth - 24 && r.top >= 24 && r.bottom <= innerHeight - 24;
      var g = v.geometry().nodes['1.1.1'];
      out.bigK = (innerWidth - 100) / g.w;
      v.setCamera({ x: 0, y: 0, k: Math.min(4, out.bigK * 1.5) });
      return v.ensureVisible('1.1.1', { animate: false });
    }).then(function () {
      var r = v.rect('1.1.1');
      out.steppedBack = r.left >= 23.5 && r.right <= innerWidth - 23.5 && v.camera().k < out.bigK * 1.5;
      return v.fold('1', true, { animate: false });
    }).then(function () {
      return v.select('1.1.0', { reveal: true, animate: false });
    }).then(function () {
      out.unfolded = !v.isFolded('1') && !!v.nodeEl('1.1.0');
      var r = v.rect('1.1.0');
      out.selectedShown = r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      var before = v.rect('1.1.0');
      var next = window.MapTrees.withChild(window.MapTrees.small(), '1', 0, 'A new first child of beta');
      return v.render(next, { animate: false }).then(function () {
        v.select('1.2.0');
        var after = v.rect('1.2.0');
        out.anchored = Math.abs(after.left - before.left) < 0.5 && Math.abs(after.top - before.top) < 0.5;
        out.moved = JSON.stringify(v.geometry().nodes['1.2.0']) !== JSON.stringify(null);
      });
    }).then(function () {
      var text = v.nodeEl('0').querySelector('.mv-text');
      text.textContent = 'typed by the editor';
      return window.show('small');
    }).then(function () {
      out.staleKept = v.nodeEl('0').querySelector('.mv-text').textContent;
      v.invalidate('0');
      return window.show('small');
    }).then(function () {
      out.restored = v.nodeEl('0').querySelector('.mv-text').textContent;
      return window.show('rich');
    }).then(function () {
      var blobUrl = document.querySelector('img[src^="blob:"]');
      var url = blobUrl ? blobUrl.getAttribute('src') : null;
      return v.setImageResolver(function (path) { return path === 'assets/missing.png' ? url : null; });
    }).then(function () {
      var missing = document.querySelector('img[data-src="assets/missing.png"]');
      out.reResolved = !!missing && missing.getAttribute('data-broken') !== 'true' && /^blob:/.test(missing.getAttribute('src') || '');
      out.nowMissing = !!document.querySelector('img[data-src="assets/blob-picture.png"][data-broken="true"]');
      v.clear();
      return v.setOptions({ balance: true });
    }).then(function () {
      return window.show('forest');
    }).then(function () {
      var g = v.geometry();
      out.forestTops = ['0', '1', '2'].map(function (p) { return g.nodes[p].x; });
      out.forestLinks = g.links.filter(function (l) { return l.from === null; }).length;
      out.forestLeft = v.visiblePaths().some(function (p) { return g.nodes[p].side === 'left'; });
      return v.fit();
    }).then(function () { return out; });
  });
  t.check('fit keeps clear of the floating chrome (insets)', helpers.insetTop >= 120 + 32 - 1, helpers.insetTop);
  t.check('ensureVisible brings a node fully on screen', helpers.revealed);
  t.check('a node wider than the stage: the camera steps back until all of it shows', helpers.steppedBack, helpers);
  t.check('select with reveal unfolds what hides the node', helpers.unfolded);
  t.check('and shows it', helpers.selectedShown);
  t.check('a re-render keeps the selected node where it was on screen', helpers.anchored);
  t.eq(helpers.staleKept, 'typed by the editor', 'an unchanged node is not rebuilt behind the editor\'s back');
  t.eq(helpers.restored, 'Alpha', 'invalidate() has it rebuilt from the tree');
  t.check('a new image resolver is asked again for every stored picture', helpers.reResolved && helpers.nowMissing, helpers);
  t.same(helpers.forestTops, [0, 0, 0], 'several top nodes: separate trees, one under the other');
  t.eq(helpers.forestLinks, 0, 'with no phantom root and no links to one');
  t.check('the legacy balance splits each of those trees', helpers.forestLeft);
  await ev(function () { return window.view.settled(); });
  await t.shot('forest-both');
  await ev(function () { return window.view.setOptions({ balance: false }); });
  var forestMarked = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    return v.render(T.sided(T.forest(), ['0.0', '1.1']), { animate: false }).then(function () {
      var g = v.geometry();
      return Object.keys(g.nodes).filter(function (p) { return g.nodes[p].side === 'left' && p.split('.').length === 2; }).sort();
    });
  });
  t.same(forestMarked, ['0.0', '1.1'], 'each tree of a forest grows its own left side from its markers');

  /* ------------------------------------------------------------------ */
  t.step('pictures: asked for again when the map, the bytes or the asset change');
  var pictures = await ev(function () {
    window.mount();
    var v = window.view;
    var out = {};
    var stored = function () { return document.querySelector('img[data-src="assets/blob-picture.png"]'); };
    var missing = function () { return document.querySelector('img[data-src="assets/missing.png"]'); };
    function until(fn, what) {
      return new Promise(function (resolve, reject) {
        var t0 = Date.now();
        (function poll() {
          var ok = false;
          try { ok = fn(); } catch (err) { ok = false; }
          if (ok) return resolve();
          if (Date.now() - t0 > 3000) return reject(new Error('timed out: ' + what));
          setTimeout(poll, 20);
        })();
      });
    }
    var red = window.assets['assets/blob-picture.png'] = window.pictureUrl('#c0392b');
    return window.show('rich').then(function () {
      return until(function () { return stored().getAttribute('src') === red; }, 'first map');
    }).then(function () {
      /* Another project opens: the same path, other bytes. */
      var blue = window.assets['assets/blob-picture.png'] = window.pictureUrl('#2e86de');
      v.clear();
      return window.show('rich').then(function () {
        return until(function () { return stored().getAttribute('src') === blue; }, 'after clear');
      }).then(function () { out.cleared = true; });
    }).then(function () {
      /* The bytes behind the path changed (a drawing saved again): taller. */
      var green = window.assets['assets/blob-picture.png'] = window.pictureUrl('#27ae60', 160);
      var h0 = v.geometry().nodes['1.5'].h;
      return v.forgetImage('assets/blob-picture.png').then(function () {
        return until(function () { return stored().getAttribute('src') === green; }, 'forgotten');
      }).then(function () {
        return until(function () { return v.geometry().nodes['1.5'].h > h0; }, 'measured again');
      }).then(function () { out.forgotten = true; });
    }).then(function () {
      var purple = window.assets['assets/blob-picture.png'] = window.pictureUrl('#8e44ad');
      v.invalidate('1.5');
      return window.show('rich').then(function () {
        return until(function () { return stored().getAttribute('src') === purple; }, 'invalidated');
      }).then(function () { out.invalidated = true; });
    }).then(function () {
      out.wasMissing = missing().getAttribute('data-broken') === 'true';
      var added = window.assets['assets/missing.png'] = window.pictureUrl('#e67e22');
      return v.forgetImage('assets/missing.png').then(function () {
        return until(function () { return missing().getAttribute('src') === added; }, 'added');
      }).then(function () {
        out.found = { broken: missing().getAttribute('data-broken'), alt: missing().alt };
        delete window.assets['assets/missing.png'];
        out.asked = window.resolved.filter(function (p) { return p === 'assets/blob-picture.png'; }).length;
      });
    }).then(function () { return out; }, function (err) { out.error = String(err); return out; });
  });
  t.check('another map with the same picture path asks again (clear forgets)', pictures.cleared, pictures);
  t.check('forgetImage(path) shows the new bytes, and the box is measured again', pictures.forgotten, pictures);
  t.check("invalidate(path) then render asks for that node's pictures again", pictures.invalidated, pictures);
  t.check('a picture that was missing', pictures.wasMissing);
  t.same(pictures.found, { broken: null, alt: 'gone' }, 'shows once its asset is there, with its own alt text');
  t.eq(pictures.asked, 4, 'the resolver was asked once per map, per forget and per invalidate');

  /* ------------------------------------------------------------------ */
  t.step('read only: no drag, no task, still selects and folds');
  await ev(function () { return window.show('rich').then(function () { return window.view.setOptions({ readOnly: true }); }); });
  await clearLog();
  await ev(function () { window.view.setCamera({ x: 0, y: 0, k: 1 }); });
  await clickIn('3.0', '.mv-task');
  t.eq((await events('task')).length, 0, 'a task does not tick in read only');
  t.same((await events('select')).map(function (e) { return e.detail.path; }), ['3.0'], 'it selects instead');
  t.eq(await ev(function () { return window.view.nodeEl('3.0').querySelector('.mv-task').getAttribute('aria-disabled'); }), 'true', 'the box says so');
  var p0 = await textPoint('3.1');
  before = await cam();
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (var r1 = 1; r1 <= 6; r1++) await page.mouse.move(p0.x + r1 * 10, p0.y);
  await sleep(100);
  await page.mouse.up();
  after = await cam();
  t.eq((await events('dragstart')).length, 0, 'no drag');
  t.check('dragging a node pans instead', Math.abs(after.x - before.x - 60) < 0.01, { before: before.x, after: after.x });
  await ev(function () { return window.view.setOptions({ readOnly: false }); });

  /* ------------------------------------------------------------------ */
  t.step('every note open: cards, measured into the boxes');
  var notes = await ev(function () {
    var v = window.view;
    var h0 = v.geometry().nodes['3.1'].h;
    return v.setOptions({ notesOpen: true }).then(function () {
      var card = v.nodeEl('3.1').querySelector('.mv-card--node');
      var edge = document.querySelector('.mv-card--edge');
      var h1 = v.geometry().nodes['3.1'].h;
      return { card: card && card.textContent, grew: h1 - h0, edge: edge && edge.textContent, dots: document.querySelectorAll('.mv-edge-dot').length, overlaps: (function () {
        var g = v.geometry();
        var ps = Object.keys(g.nodes);
        for (var i = 0; i < ps.length; i++) for (var j = i + 1; j < ps.length; j++) {
          var a = g.nodes[ps[i]]; var b = g.nodes[ps[j]];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return ps[i] + '/' + ps[j];
        }
        return null;
      })() };
    });
  });
  t.eq(notes.card, 'Remember the deadline', 'the node note as a card in its box');
  t.check('the box grew to hold it', notes.grew > 10, notes.grew);
  t.check('edge notes become cards on their curve', notes.edge === 'Start here' || notes.edge === 'Order matters', notes.edge);
  t.eq(notes.dots, 0, 'no dots while the cards show');
  t.eq(notes.overlaps, null, 'nothing overlaps');
  await ev(function () { return window.view.settled(); });
  await t.shot('notes-open');
  await ev(function () { return window.view.setOptions({ notesOpen: false }); });

  /* ------------------------------------------------------------------ */
  t.step('a fit asked for while the stage is hidden is paid when it shows');
  var owed = await ev(function () {
    var stage = document.getElementById('stage');
    var v = window.view;
    v.clear();
    stage.style.display = 'none';
    var paid = false;
    var rendered = false;
    v.render(window.MapTrees.small(), { animate: false }).then(function () { rendered = true; });
    v.fit().then(function () { paid = true; });
    return new Promise(function (r) { setTimeout(r, 120); }).then(function () {
      var early = { paid: paid, rendered: rendered };
      stage.style.display = '';
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function poll() {
          if ((paid && rendered) || Date.now() - t0 > 3000) {
            var all = v.visiblePaths().every(function (p) { var r = v.rect(p); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
            return resolve({ early: early, paid: paid, rendered: rendered, all: all });
          }
          setTimeout(poll, 20);
        })();
      });
    });
  });
  t.same(owed.early, { paid: false, rendered: false }, 'nothing is measured or fitted on a hidden stage');
  t.check('shown: measured, laid out and fitted', owed.paid && owed.rendered && owed.all, owed);
  var dropped = await ev(function () {
    var stage = document.getElementById('stage');
    var v = window.view;
    stage.style.display = 'none';
    var done = false;
    v.render(window.MapTrees.small(), { animate: false }).then(function () { done = true; });
    v.clear();
    return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
      stage.style.display = '';
      return new Promise(function (r) { setTimeout(r, 120); });
    }).then(function () {
      var out = { done: done, nodes: document.querySelectorAll('.mv-node').length, paths: v.visiblePaths().length };
      return window.show('small').then(function () { return out; });
    });
  });
  t.same(dropped, { done: true, nodes: 0, paths: 0 }, 'clear() lets go of a render still waiting for a hidden stage');

  /* ------------------------------------------------------------------ */
  t.step('reduced motion: folds and camera moves land at once');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  var instant = await ev(function () {
    var v = window.view;
    v.fold('1', true);
    var leaving = document.querySelectorAll('.mv-node--leaving').length;
    var gone = !document.querySelector('[data-path="1.0"]');
    v.setCamera({ x: -500, y: -500, k: 0.3 });
    v.fit({ animate: true });
    var c1 = v.camera();
    v.fold('1', false);
    return { leaving: leaving, gone: gone, glide: c1.k !== 0.3 };
  });
  t.eq(instant.leaving, 0, 'no node lingers to fold away');
  t.check('the folded children are gone at once', instant.gone);
  t.check('an animated fit lands on the same frame', instant.glide);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* ------------------------------------------------------------------ */
  t.step('2,000 nodes: render under 300 ms, pan at frame rate');
  /* From an empty view each time, up to eight tries spread over a few
   * seconds, and the best of up to eight pans: when the runner works in
   * parallel other suites share the CPU, and a stolen time slice is not the
   * map's cost. It stops at the first try within budget; every try is
   * reported. */
  var perf = await ev(function () {
    var v = window.view;
    var runs = [];
    function once() {
      v.clear();
      var tree = window.MapTrees.big();
      var t0 = performance.now();
      /* Through the first paint: the frame after the render's task has
       * painted when the second animation frame comes. */
      return v.render(tree, { animate: false }).then(function () {
        return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      }).then(function () { runs.push(performance.now() - t0); });
    }
    function more() {
      if (runs.length >= 8 || (runs.length && Math.min.apply(null, runs) < 300)) return null;
      return new Promise(function (r) { setTimeout(r, runs.length ? 700 : 0); }).then(once).then(more);
    }
    return window.show('single').then(more).then(function () {
      return { ms: Math.min.apply(null, runs), runs: runs.map(Math.round), count: v.visiblePaths().length, nodes: document.querySelectorAll('.mv-node').length };
    });
  });
  t.eq(perf.count, 2000, 'two thousand nodes laid out');
  t.eq(perf.nodes, 2000, 'two thousand elements, nothing left over');
  t.check('rendered and painted in under 300 ms', perf.ms < 300, perf.runs.join(', ') + ' ms');
  t.log('2,000 nodes rendered and painted in ' + perf.runs.join(' / ') + ' ms');
  async function panFrames(first) {
    await ev(function () { window.view.setCamera({ x: 200, y: 300, k: 0.6 }); });
    await sleep(first ? 600 : 200);
    var at = await emptyPoint();
    await ev(function () {
      window.__frames = [];
      var stop = false;
      window.__stopFrames = function () { stop = true; };
      (function tick(ts) { window.__frames.push(ts); if (!stop) requestAnimationFrame(tick); })(performance.now());
    });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 6, at.y + 6);
    var hand = first ? await ev(function (pt) {
      var el = document.elementFromPoint(pt.x, pt.y);
      return { cursor: getComputedStyle(el).cursor, gesture: window.view.el.getAttribute('data-gesture') };
    }, { x: at.x + 6, y: at.y + 6 }) : null;
    for (var pm = 1; pm <= 60; pm++) await page.mouse.move(at.x + Math.sin(pm / 6) * 150, at.y + pm * 2);
    await sleep(100);
    await page.mouse.up();
    var out = await ev(function () {
      window.__stopFrames();
      var f = window.__frames;
      var gaps = [];
      for (var i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
      gaps.sort(function (a, b) { return a - b; });
      return { count: gaps.length, median: gaps[Math.floor(gaps.length / 2)], p90: gaps[Math.floor(gaps.length * 0.9)], max: gaps[gaps.length - 1] };
    });
    out.hand = hand;
    return out;
  }
  var pans = [await panFrames(true)];
  while (pans.length < 8 && Math.min.apply(null, pans.map(function (f) { return f.max; })) >= 50) {
    await sleep(500);
    pans.push(await panFrames(false));
  }
  t.same(pans[0].hand, { cursor: 'grabbing', gesture: 'pan' }, 'a grabbing hand while panning');
  var frames = pans.reduce(function (a, b) { return a.max <= b.max ? a : b; });
  t.log('pan frames: ' + JSON.stringify(pans.map(function (f) { return { median: f.median, p90: f.p90, max: f.max }; })));
  t.check('the pan keeps frame rate (median frame under 20 ms)', frames.median < 20, frames);
  t.check('no long frame in a 2,000-node pan (longest under 50 ms)', frames.max < 50, frames);

  /* ------------------------------------------------------------------ */
  t.step('the camera and a layout still playing compose');
  await load();
  /* Slow layout and camera motion, so the hand and the API act mid-flight. */
  await ev(function () {
    document.documentElement.style.setProperty('--dur-map', '3000ms');
    document.documentElement.style.setProperty('--dur-camera', '600ms');
    return window.show('small').then(function () { return window.view.settled(); });
  });
  var reveal = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    v.select('1.1.1');
    var r = v.rect('1.1.1');
    var c = v.camera();
    v.setCamera({ x: c.x + (innerWidth - 20 - r.right), y: c.y + (innerHeight - 20 - r.bottom), k: c.k });
    v.render(T.withChild(T.small(), '1.1.1', 0, 'A new grandchild, far out to the right of the map'));
    return v.select('1.1.1.0', { reveal: true }).then(function () { return v.settled(); }).then(function () {
      var want = v.rect('1.1.1.0');
      var drawn = v.nodeEl('1.1.1.0').getBoundingClientRect();
      return { want: { l: want.left, t: want.top }, drawn: { l: drawn.left, t: drawn.top, r: drawn.right, b: drawn.bottom }, w: innerWidth, h: innerHeight };
    });
  });
  t.check('render, then select with reveal: the new node ends on screen', reveal.drawn.l >= 0 && reveal.drawn.t >= 0 && reveal.drawn.r <= reveal.w && reveal.drawn.b <= reveal.h, reveal);
  t.check('where rect() said it would be', Math.abs(reveal.drawn.l - reveal.want.l) < 0.5 && Math.abs(reveal.drawn.t - reveal.want.t) < 0.5, reveal);

  await ev(function () { return window.show('small').then(function () { window.view.select('1.1'); return window.view.fit(); }).then(function () { return window.view.settled(); }); });
  var spot = await emptyPoint();
  var held = await ev(function () { var r = window.view.nodeEl('1.1').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await ev(function () { window.view.render(window.MapTrees.withChild(window.MapTrees.small(), '', 0, 'A new first branch')); window.__t0 = performance.now(); });
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  var xs = [];
  for (var hp = 1; hp <= 10; hp++) { await page.mouse.move(spot.x + hp * 10, spot.y); xs.push((await cam()).x); }
  var during = await ev(function () { return performance.now() - window.__t0; });
  await sleep(100);
  await page.mouse.up();
  await ev(function () { return window.view.settled(); });
  var moved = await ev(function () { var r = window.view.nodeEl('2.1').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  var steps = xs.slice(1).map(function (x, i) { return Math.round((x - xs[i]) * 100) / 100; });
  t.check('the moves came while the layout was still playing', during < 3000, during);
  t.check('mid-flight, every 10 px of the hand moves the camera 10 px', steps.length === 9 && steps.every(function (d) { return d === 10; }), steps);
  t.check('and the selected node ends exactly where the hand took it', Math.abs(moved.x - held.x - 100) < 0.5 && Math.abs(moved.y - held.y) < 0.5, { held: held, moved: moved });

  var twice = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    return window.show('small').then(function () { v.select('1.1'); return v.settled(); }).then(function () {
      var el = v.nodeEl('1.1');
      var r0 = el.getBoundingClientRect();
      var worst = 0;
      var frames = 0;
      var stop = false;
      (function watch() {
        if (stop) return;
        var r = el.getBoundingClientRect();
        frames++;
        worst = Math.max(worst, Math.abs(r.left - r0.left), Math.abs(r.top - r0.top));
        requestAnimationFrame(watch);
      })();
      var one = T.withChild(T.small(), '', 0, 'First insert');
      v.render(one);
      return new Promise(function (res) { setTimeout(res, 40); }).then(function () {
        v.render(T.withChild(one, '', 0, 'Second insert'));
        return v.settled();
      }).then(function () {
        stop = true;
        var r1 = el.getBoundingClientRect();
        return { same: v.nodeEl('3.1') === el, dx: r1.left - r0.left, dy: r1.top - r0.top, worst: Math.round(worst * 100) / 100, frames: frames };
      });
    });
  });
  t.check('two renders 40 ms apart: the selected node never drifts, during or after', twice.same && Math.abs(twice.dx) < 0.5 && Math.abs(twice.dy) < 0.5 && twice.worst < 1 && twice.frames > 5, twice);

  var given = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    return window.show('small').then(function () { v.select('1.1'); return v.settled(); }).then(function () {
      v.render(T.withChild(T.small(), '', 0, 'An insert'));
      v.setCamera({ x: 40, y: 60, k: 1 });
      return v.settled();
    }).then(function () {
      return { cam: v.camera(), layer: v.el.querySelector('.mv-layer').style.transform };
    });
  });
  t.same(given.cam, { x: 40, y: 60, k: 1 }, 'a camera set mid-flight is where it rests');
  t.eq(given.layer, 'translate(40px, 60px) scale(1)', 'and where it is drawn once the layout lands');

  var late = await ev(function () {
    var v = window.view;
    var T = window.MapTrees;
    var w0 = 0;
    return window.show('small').then(function () { return v.settled(); }).then(function () {
      v.render(T.withChild(T.small(), '', 0, 'An insert'));
      w0 = v.geometry().nodes['2'].w;
      return new Promise(function (r) { setTimeout(r, 100); });
    }).then(function () {
      /* The editor types into Beta while the insert still plays. */
      v.nodeEl('2').querySelector('.mv-text').textContent = 'Beta, renamed by the editor to something longer';
      return new Promise(function (r) { setTimeout(r, 150); });
    }).then(function () {
      var g = v.geometry().nodes['3'];
      var out = { wider: v.geometry().nodes['2'].w > w0, midway: v.nodeEl('3').parentNode.style.left + ' ' + v.nodeEl('3').parentNode.style.top !== g.x + 'px ' + g.y + 'px' };
      return v.settled().then(function () {
        var g2 = v.geometry().nodes['3'];
        out.landed = v.nodeEl('3').parentNode.style.left === g2.x + 'px' && v.nodeEl('3').parentNode.style.top === g2.y + 'px';
        v.invalidate('2');
        return out;
      });
    });
  });
  t.same(late, { wider: true, midway: true, landed: true }, 'a node growing mid-flight is laid out again, and the flight carries on to the new places');

  /* ------------------------------------------------------------------ */
  t.step('strings in both languages');
  var strings = await ev(function () {
    var i18n = window.MindRoot.i18n;
    var en = i18n.keys('en').filter(function (k) { return k.indexOf('mapview.') === 0; });
    var it = i18n.keys('it').filter(function (k) { return k.indexOf('mapview.') === 0; });
    i18n.init('it');
    /* House rules for Italian copy: no exclamation marks, no em dash. */
    var bad = it.filter(function (k) { return /[!\u2014]/.test(i18n.t(k)); });
    i18n.init('en');
    return { en: en, it: it, bad: bad };
  });
  t.check('the map registers its strings', strings.en.length >= 5, strings.en);
  t.same(strings.it, strings.en, 'every string in Italian too');
  t.same(strings.bad, [], 'Italian copy keeps the house rules');
  await load('?lang=it');
  await ev(function () { return window.show('small'); });
  var it = await ev(function () {
    return {
      label: window.view.el.getAttribute('aria-label'),
      note: window.view.nodeEl('2').querySelector('.mv-note-dot').getAttribute('aria-label'),
      edge: window.view.nodeEl('1').getAttribute('aria-description')
    };
  });
  t.same(it, { label: 'Mappa mentale', note: 'Nota: A note on gamma', edge: 'Nota sul collegamento: Why beta follows alpha' }, 'Italian labels');

  /* ------------------------------------------------------------------ */
  t.step('screenshots in both themes');
  await ev(function () {
    return window.show('small').then(function () {
      window.view.setOptions({ branchText: true });
      window.view.select('1.1');
      return window.view.fit();
    }).then(function () { return window.view.settled(); });
  });
  await t.shot('desktop-light');
  await ev(function () { document.documentElement.setAttribute('data-theme', 'dark'); });
  await sleep(50);
  await t.shot('desktop-dark');
  await ev(function () { return window.show('rich').then(function () { return window.view.center('3', { animate: false }); }).then(function () { return window.view.settled(); }); });
  await t.shot('rich-dark');
  await ev(function () { document.documentElement.removeAttribute('data-theme'); });
  await t.shot('rich-light');
};

/* Render and frame budgets are measured on a quiet machine: the runner
 * runs this suite alone, after the parallel pool. */
module.exports.solo = true;
