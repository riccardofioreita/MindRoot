/* mapview-touch: the map engine under fingers, on a phone.
 *
 * A 390 x 844 touch screen; fingers come from the DevTools protocol (real
 * touch PointerEvents, several at once), on the bare host page
 * (test/fixtures/map/host.html).
 *
 * Covered: a tap selects (and is not a gesture), a double tap on a node
 * activates and never zooms (the old app's bug), a double tap on the empty
 * map fits, a long press is the context menu unless the finger moved first,
 * a finger on a node pans instead of selecting, one-finger pan with a fling,
 * the touch that catches a fling only stops it, a pinch zooms about its
 * midpoint and pans with it, the rubber band past 4x glides back to 4x over
 * several frames while the last finger still pans (never a jump), the
 * bigger knob target for fingers at the fitted zoom and at 0.2, a long press
 * then a move lifts a node, a second finger turns that drag into a pinch,
 * and screenshots in both themes at phone size. */
'use strict';

var T = require('../fixtures/touch.js');

module.exports = async function (t) {
  var context = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  var page = await context.newPage();
  var cdp = await context.newCDPSession(page);

  async function load(query) {
    await page.goto(t.fileUrl('test/fixtures/map/host.html') + (query || ''));
    await page.waitForFunction(function () { return !!(window.view && window.MapTrees); });
  }

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function sleep(ms) { return t.sleep(ms); }
  function cam() { return ev(function () { return window.view.camera(); }); }
  function events(type) { return ev(function (ty) { return window.events(ty); }, type); }
  function clearLog() { return ev(function () { window.log.length = 0; }); }

  function touches(type, list, at) {
    var msg = { type: type, touchPoints: list.map(function (p) { return { x: p[0], y: p[1], id: p[2] }; }) };
    if (at !== undefined) msg.timestamp = at;
    return cdp.send('Input.dispatchTouchEvent', msg);
  }

  /* A flick on its own clock: each event says when the finger was there
   * (16 ms apart, lifted 4 ms after the last move), however long a busy
   * runner takes to deliver it, so the speed the map measures is the
   * flick's. The clock starts a little in the past, so no event claims to
   * come from the future, and only after a pause longer than that, so it
   * never runs back before the previous gesture's events.
   * Each event is handed over only once the page has seen the one before
   * it, and the flick ends only once the page has seen the finger lift:
   * on a busy runner frames come late, and the browser folds every move
   * queued for a frame into one pointer event (so a whole flick could
   * reach the map as one jump, with no speed to measure) or is still
   * holding them when the test looks. */
  async function seen(type, n) {
    await page.waitForFunction(function (a) { return (window.touchSeen[a[0]] || 0) >= a[1]; }, [type, n], { polling: 10, timeout: 10000 });
  }

  /* Counts the finger's pointer events as the page gets them, with their
   * own times (t) and when they arrived (at); returns the counts so far. */
  function armTrail() {
    return ev(function () {
      if (!window.touchSeen) {
        window.touchSeen = {};
        window.touchTrail = [];
        ['pointerdown', 'pointermove', 'pointerup'].forEach(function (type) {
          window.addEventListener(type, function (e) {
            if (e.pointerType !== 'touch') return;
            window.touchSeen[type] = (window.touchSeen[type] || 0) + 1;
            window.touchTrail.push({ type: type, t: e.timeStamp, at: performance.now(), x: e.clientX, y: e.clientY });
          }, true);
        });
      }
      window.touchTrail = [];
      return { down: window.touchSeen.pointerdown || 0, move: window.touchSeen.pointermove || 0, up: window.touchSeen.pointerup || 0 };
    });
  }

  async function flick(points) {
    await sleep(600);
    var base = await armTrail();
    var t0 = Date.now() / 1000 - 0.5;
    await touches('touchStart', [[points[0][0], points[0][1], 1]], t0);
    await seen('pointerdown', base.down + 1);
    for (var i = 1; i < points.length; i++) {
      await touches('touchMove', [[points[i][0], points[i][1], 1]], t0 + i * 0.016);
      await seen('pointermove', base.move + i);
    }
    await touches('touchEnd', [], t0 + (points.length - 1) * 0.016 + 0.004);
    await seen('pointerup', base.up + 1);
  }

  async function tap(x, y) {
    await touches('touchStart', [[x, y, 1]]);
    await touches('touchEnd', []);
  }

  async function finger(points, gap) {
    await touches('touchStart', [[points[0][0], points[0][1], 1]]);
    for (var i = 1; i < points.length; i++) {
      await touches('touchMove', [[points[i][0], points[i][1], 1]]);
      if (gap) await sleep(gap);
    }
    await touches('touchEnd', []);
  }

  async function pinch(mid, from, to, steps, shift) {
    shift = shift || [0, 0];
    await touches('touchStart', [[mid[0] - from, mid[1], 1]]);
    await touches('touchStart', [[mid[0] - from, mid[1], 1], [mid[0] + from, mid[1], 2]]);
    for (var i = 1; i <= steps; i++) {
      var d = from + (to - from) * i / steps;
      var sx = shift[0] * i / steps;
      var sy = shift[1] * i / steps;
      await touches('touchMove', [[mid[0] - d + sx, mid[1] + sy, 1], [mid[0] + d + sx, mid[1] + sy, 2]]);
    }
  }

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
      var r = window.view.nodeEl(p).querySelector('.mv-text').getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(r.width / 2, 24)), y: Math.round(r.top + r.height / 2) };
    }, path);
  }

  function emptyPoint() {
    return ev(function () {
      for (var y = 40; y < innerHeight - 40; y += 37) {
        for (var x = 20; x < innerWidth - 20; x += 23) {
          var el = document.elementFromPoint(x, y);
          if (el && el.classList.contains('mv') && window.view.pathAt(x, y) === null) return { x: x, y: y };
        }
      }
      return null;
    });
  }

  function mapPoint(p) {
    return ev(function (q) {
      var c = window.view.camera();
      var r = window.view.el.getBoundingClientRect();
      return { x: (q.x - r.left - c.x) / c.k, y: (q.y - r.top - c.y) / c.k };
    }, p);
  }

  await load();
  await ev(function () { return window.show('small'); });
  await still();

  /* ------------------------------------------------------------------ */
  t.step('fingers get the bigger targets');
  var targets = await ev(function () {
    var hit = document.querySelector('.mv-knob-hit').getBoundingClientRect();
    return { d: hit.width, k: window.view.camera().k, touch: getComputedStyle(window.view.el).touchAction };
  });
  t.check('a knob target of at least 22 px on screen for a finger', targets.d >= 21.5, targets);
  t.eq(targets.touch, 'none', 'the browser leaves panning and zooming to the map');

  /* ------------------------------------------------------------------ */
  t.step('a tap selects; a double tap on a node activates and never zooms');
  await clearLog();
  var p = await textPoint('1');
  await tap(p.x, p.y);
  t.same((await events('select')).map(function (e) { return e.detail.path; }), ['1'], 'tap: select');
  t.eq((await events('gesture')).length, 0, 'a tap is not a gesture (no "press" state to hide the bars on)');
  await sleep(450);
  await clearLog();
  var before = await cam();
  p = await textPoint('0');
  /* On the hand's clock (fixtures/touch.js): two plain taps can reach a
   * loaded page further apart than a double tap. */
  await T.doubleTap(cdp, [p.x, p.y], [p.x + 3, p.y + 2]);
  t.same((await events('activate')).map(function (e) { return e.detail.path; }), ['0'], 'double tap: activate (rename)');
  t.same(await cam(), before, 'and the map did not zoom');

  /* ------------------------------------------------------------------ */
  t.step('a double tap on the empty map fits it');
  await sleep(450);
  var fitCam = await ev(function () {
    var v = window.view;
    return v.fit().then(function () { var c = v.camera(); v.setCamera({ x: c.x + 60, y: c.y - 90, k: c.k * 0.6 }); return c; });
  });
  var e = await emptyPoint();
  await T.doubleTap(cdp, [e.x, e.y]);
  await still();
  var after = await cam();
  t.check('fitted', Math.abs(after.x - fitCam.x) < 1 && Math.abs(after.y - fitCam.y) < 1 && Math.abs(after.k - fitCam.k) < 1e-6, { after: after, fit: fitCam });
  t.eq(await ev(function () { return window.view.selected(); }), null, 'the first tap deselected');

  /* ------------------------------------------------------------------ */
  t.step('a long press is the context menu, unless the finger moved');
  await sleep(450);
  await clearLog();
  p = await textPoint('2');
  await touches('touchStart', [[p.x, p.y, 1]]);
  await page.waitForFunction(function () { return window.events('context').length > 0; }, null, { timeout: 3000, polling: 20 }).catch(function () {});
  var during = await events('context');
  await touches('touchEnd', []);
  t.same(during.map(function (x) { return x.detail.path; }), ['2'], 'context after 500 ms, while the finger is still down');
  t.eq((await events('select')).length, 0, 'the release after a long press is not a tap');
  await clearLog();
  e = await emptyPoint();
  before = await cam();
  await touches('touchStart', [[e.x, e.y, 1]]);
  await touches('touchMove', [[e.x + 20, e.y + 30, 1]]);
  await sleep(650);
  await touches('touchEnd', []);
  t.eq((await events('context')).length, 0, 'no context menu once the finger has moved');
  after = await cam();
  t.check('it panned instead', Math.abs(after.x - before.x - 20) < 0.01 && Math.abs(after.y - before.y - 30) < 0.01, { before: before, after: after });

  /* ------------------------------------------------------------------ */
  t.step('a finger on a node pans, and a quick one flings');
  /* Each event waits for the page to have the one before it, so the map
   * is read only after the whole pan reached it. The finger moves at once;
   * a runner so busy that the first move reaches the page only after a
   * long press would have begun (500 ms) did not do what this step is
   * about, and the step is played again (at most three times). */
  for (var attempt = 1; ; attempt++) {
    await ev(function () { return window.view.fit(); });
    await still();
    await clearLog();
    p = await textPoint('1.1');
    before = await cam();
    var nb = await armTrail();
    var path = [[p.x, p.y], [p.x - 10, p.y], [p.x - 30, p.y + 10], [p.x - 60, p.y + 20]];
    await touches('touchStart', [[path[0][0], path[0][1], 1]]);
    await seen('pointerdown', nb.down + 1);
    for (var m = 1; m < path.length; m++) {
      await touches('touchMove', [[path[m][0], path[m][1], 1]]);
      await seen('pointermove', nb.move + m);
    }
    await touches('touchEnd', []);
    await seen('pointerup', nb.up + 1);
    await still();
    var late = await ev(function () {
      var tr = window.touchTrail;
      var d = tr.filter(function (x) { return x.type === 'pointerdown'; })[0];
      var mv = tr.filter(function (x) { return x.type === 'pointermove'; })[0];
      return mv.at - d.at >= window.MindRoot.gestures.CONST.LONG_MS;
    });
    if (!late || attempt >= 3) break;
    t.log('the first move reached the page after the long-press time: played again');
  }
  after = await cam();
  t.check('the map followed the finger', after.x < before.x - 30, { before: before.x, after: after.x });
  t.eq((await events('select')).length, 0, 'a pan from a node does not select it');
  t.eq((await events('context')).length, 0, 'nor open a menu');
  await ev(function () { return window.view.fit(); });
  await still();
  /* The map raised to the top of the screen first, so the glide down has
   * all the room it needs and never meets the pan limit (a glide that
   * stops at the limit says nothing about how far it would have gone). */
  var room = await ev(function () {
    var c = window.view.camera();
    var top = Infinity;
    document.querySelectorAll('.mv-node').forEach(function (n) { top = Math.min(top, n.getBoundingClientRect().top); });
    window.view.setCamera({ x: c.x, y: c.y - (top - 30), k: c.k });
    return { raised: top - 30 };
  });
  await still();
  e = await emptyPoint();
  before = await cam();
  var pts = [];
  for (var i = 0; i <= 8; i++) pts.push([e.x, e.y + i * 9]);
  /* The finger itself moves the map 72 px; then the map glides on. Where
   * it comes to rest is not a matter of frames: the glide is a closed form
   * of the time since the lift (gestures.js), so from the speed measured
   * on the events the page received (the app's own velocity()) the rest
   * lies between where the speed falls under STOP_SPEED (the last frame
   * can come no earlier) and the whole projection (no frame can pass it). */
  await ev(function () {
    var rec = window.flingRec = { states: [] };
    rec.off = window.view.on('gesture', function (d) {
      rec.states.push({ state: d.state, cam: window.view.camera() });
    });
  });
  await flick(pts);
  await page.waitForFunction(function () {
    var st = window.flingRec.states.map(function (x) { return x.state; });
    return st.indexOf('momentum') >= 0 && st[st.length - 1] === 'idle';
  }, null, { polling: 25, timeout: 10000 }).catch(function () {});
  await still();
  after = await cam();
  var fling = await ev(function () {
    var rec = window.flingRec;
    rec.off();
    var G = window.MindRoot.gestures;
    var trail = window.touchTrail;
    var down = trail.filter(function (e) { return e.type === 'pointerdown'; })[0];
    var moves = trail.filter(function (e) { return e.type === 'pointermove'; });
    var up = trail.filter(function (e) { return e.type === 'pointerup'; })[0];
    /* The pan starts at the first move past the slop, from where the
     * finger went down (gestures.js startPan). */
    var samples = [{ t: moves[0].t, x: down.x, y: down.y }].concat(moves.map(function (m) { return { t: m.t, x: m.x, y: m.y }; }));
    var v = G.velocity(samples, up.t);
    var lift = rec.states.filter(function (x) { return x.state === 'momentum'; })[0];
    var lnd = -Math.log(G.CONST.DECAY);
    var speed = Math.abs(v.y);
    return {
      moves: moves.length,
      v: v,
      lift: lift ? lift.cam : null,
      states: rec.states.map(function (x) { return x.state; }),
      near: Math.max(0, speed - G.CONST.STOP_SPEED) / lnd,
      far: speed / lnd
    };
  });
  t.eq(fling.moves, 8, 'every move of the flick reached the page as its own event');
  t.check('the flick was measured at its own speed (9 px per 16 ms)', Math.abs(fling.v.y - 9 / 16) < 0.01 && Math.abs(fling.v.x) < 1e-6, fling.v);
  t.check('the map glided after the finger lifted', !!fling.lift, fling.states);
  var lift = fling.lift || before;
  t.check('up to the lift the map followed the finger (72 px)', Math.abs(lift.y - before.y - 72) < 0.5, { before: before.y, lift: lift.y });
  var glide = after.y - lift.y;
  t.check('the fling carries on after the finger lifts', glide > 15 && glide >= fling.near - 1 && glide <= fling.far + 1 && Math.abs(after.x - lift.x) < 0.5,
    { before: before.y, lift: lift.y, rest: after.y, glide: glide, expected: [fling.near, fling.far], raised: room.raised });

  /* ------------------------------------------------------------------ */
  t.step('the touch that catches a fling only stops it');
  await ev(function () { return window.view.fit(); });
  await still();
  e = await emptyPoint();
  var fpts = [];
  for (var c1 = 0; c1 <= 8; c1++) fpts.push([e.x, e.y + c1 * 12]);
  await flick(fpts);
  await sleep(30);
  var gliding = await ev(function () { return window.view.gesture(); });
  await clearLog();
  p = await textPoint('');
  await tap(p.x, p.y);
  var caught = await ev(function () {
    return { taps: window.events('select').length + window.events('background').length, gesture: window.view.gesture() };
  });
  await sleep(450);
  p = await textPoint('');
  await tap(p.x, p.y);
  var later = (await events('select')).map(function (x) { return x.detail.path; });
  t.eq(gliding, 'momentum', 'the map was gliding');
  t.eq(caught.taps, 0, 'the touch that stopped it selected nothing and deselected nothing');
  t.eq(caught.gesture, 'idle', 'and the glide stopped there');
  t.same(later, [''], 'the next tap selects as usual');

  t.step('a button pressed right after a flick answers');
  /* The map takes its touch moves for itself: left to the browser, the
   * flick would also be a fling of the browser's own, and a tap anywhere
   * on the page in the next half second would only stop it, never click
   * (a thumb bar button pressed right after a pan did nothing). */
  await ev(function () {
    var b = document.createElement('button');
    b.id = 'probe';
    b.textContent = 'probe';
    b.style.cssText = 'position:fixed;left:10px;bottom:10px;width:80px;height:48px;z-index:9';
    b.addEventListener('click', function () { window.probeClicks = (window.probeClicks || 0) + 1; });
    document.body.appendChild(b);
  });
  await ev(function () { return window.view.fit(); });
  await still();
  e = await emptyPoint();
  var gpts = [];
  for (var g1 = 0; g1 <= 8; g1++) gpts.push([e.x, e.y + g1 * 12]);
  await flick(gpts);
  await page.tap('#probe');
  t.eq(await ev(function () { return window.probeClicks || 0; }), 1, 'the tap that follows the flick is a click');
  await ev(function () { document.getElementById('probe').remove(); });
  /* The map's own glide, which nothing caught, ends before the next step. */
  await still();

  /* ------------------------------------------------------------------ */
  t.step('two fingers pinch about their midpoint, and pan with it');
  await ev(function () { return window.view.fit(); });
  await still();
  before = await cam();
  var mid = { x: 195, y: 420 };
  var under = await mapPoint(mid);
  await pinch([mid.x, mid.y], 40, 80, 8);
  var during2 = await cam();
  var stays = await mapPoint(mid);
  await touches('touchEnd', []);
  t.check('zoomed by the spread (x2)', Math.abs(during2.k / before.k - 2) < 0.02, { before: before.k, during: during2.k });
  t.check('the point between the fingers stays between them', Math.abs(stays.x - under.x) < 0.2 && Math.abs(stays.y - under.y) < 0.2, { under: under, stays: stays });
  await still();
  await ev(function () { return window.view.fit(); });
  await still();
  before = await cam();
  under = await mapPoint(mid);
  await pinch([mid.x, mid.y], 60, 60, 6, [40, -50]);
  var moved = await mapPoint({ x: mid.x + 40, y: mid.y - 50 });
  after = await cam();
  await touches('touchEnd', []);
  t.check('two fingers moving together pan the map', Math.abs(after.k - before.k) < 1e-6 && Math.abs(moved.x - under.x) < 0.2 && Math.abs(moved.y - under.y) < 0.2, { under: under, moved: moved });

  /* ------------------------------------------------------------------ */
  t.step('past 4x the pinch stretches on a rubber band, then settles at 4x');
  await still();
  await ev(function () { window.view.setCamera({ x: 0, y: 0, k: 3.5 }); });
  await pinch([mid.x, mid.y], 40, 100, 8);
  var banded = await cam();
  await ev(function () {
    window.__ks = [];
    window.__afterUp = null;
    /* Right after the view has handled the lift (the window hears the
     * event last), before any frame: the old code had already snapped to
     * 4 here. */
    window.addEventListener('pointerup', function once() {
      window.removeEventListener('pointerup', once);
      window.__afterUp = window.view.camera().k;
    });
    var t0 = performance.now();
    (function tick() {
      window.__ks.push(window.view.camera().k);
      if (performance.now() - t0 < 500) requestAnimationFrame(tick);
    })();
  });
  /* The fingers leave one at a time: the second one first. */
  await touches('touchEnd', [[mid.x + 100, mid.y, 2]]);
  await sleep(550);
  var ks = await ev(function () { return window.__ks; });
  var afterUp = await ev(function () { return window.__afterUp; });
  var oneDown = await ev(function () { return window.view.gesture(); });
  await touches('touchEnd', []);
  await still();
  var settled = await cam();
  var glide = ks.filter(function (k) { return k < banded.k - 1e-6 && k > 4 + 1e-6; });
  t.check('over the limit while held, less than the fingers ask', banded.k > 4 && banded.k < 3.5 * 2.5, banded.k);
  t.check('one finger lifted: no snap to the limit', afterUp !== null && Math.abs(afterUp - banded.k) < 1e-6, { banded: banded.k, afterUp: afterUp });
  t.check('the scale glides back through the frames that follow', glide.length >= 1, { banded: banded.k, ks: ks.map(function (k) { return Math.round(k * 1000) / 1000; }) });
  t.log('settle frames: ' + glide.length + ' between ' + banded.k.toFixed(3) + ' and 4');
  t.eq(ks[ks.length - 1], 4, 'down to 4 while the other finger is still on the map');
  t.eq(oneDown, 'pan', 'which pans meanwhile');
  t.eq(settled.k, 4, 'and it rests at 4');
  await ev(function () { window.view.setCamera({ x: 100, y: 300, k: 0.12 }); });
  await pinch([mid.x, mid.y], 120, 40, 8);
  var low = await cam();
  await touches('touchEnd', []);
  await still();
  t.check('under 0.1 while held', low.k < 0.1, low.k);
  t.eq((await cam()).k, 0.1, 'back to 0.1 on release');

  /* ------------------------------------------------------------------ */
  t.step('a knob takes a finger near it');
  await ev(function () { return window.show('small').then(function () { return window.view.fit(); }); });
  await still();
  var knob = await ev(function () {
    var r = document.querySelector('.mv-knob[data-path="1"] .mv-knob-dot').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, k: window.view.camera().k };
  });
  var off = 9;
  await tap(Math.round(knob.x), Math.round(knob.y + off));
  await still();
  t.check('a tap 9 px below the knob still folds, at a phone-fitted zoom of ' + knob.k.toFixed(2), await ev(function () { return window.view.isFolded('1'); }), knob);
  await sleep(450);
  knob = await ev(function () {
    var r = document.querySelector('.mv-knob[data-path="1"] .mv-knob-dot').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await tap(Math.round(knob.x), Math.round(knob.y));
  await still();
  t.eq(await ev(function () { return window.view.isFolded('1'); }), false, 'and unfolds');

  /* ------------------------------------------------------------------ */
  t.step('a knob keeps a finger-sized target at a low zoom');
  await ev(function () {
    return window.show('small').then(function () {
      window.view.setCamera({ x: 0, y: 0, k: 0.2 });
      return window.view.center('1', { animate: false });
    });
  });
  await still();
  var low = await ev(function () {
    var dot = document.querySelector('.mv-knob[data-path="1"] .mv-knob-dot').getBoundingClientRect();
    var hit = document.querySelector('.mv-knob-hit[data-path="1"]').getBoundingClientRect();
    var box = window.view.rect('1');
    return { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2, hit: hit.width, k: window.view.camera().k, box: { l: box.left, r: box.right, t: box.top, b: box.bottom } };
  });
  t.check('22 px across on screen at zoom 0.2', low.hit >= 21.5 && low.hit <= 23, low);
  await clearLog();
  await tap(Math.round(low.x + 9), Math.round(low.y));
  await still();
  t.check('a tap 9 px from the knob, off its box, folds it', await ev(function () { return window.view.isFolded('1'); }), low);
  await sleep(450);
  await clearLog();
  await tap(Math.round((low.box.l + low.box.r) / 2), Math.round((low.box.t + low.box.b) / 2));
  t.same((await events('select')).map(function (x) { return x.detail.path; }), ['1'], 'the words of the node beside it still select the node');
  t.eq((await events('knob')).length, 0, 'and do not fold anything');

  /* ------------------------------------------------------------------ */
  t.step('long press then move lifts a node; a second finger makes it a pinch');
  await load('?drag');
  await ev(function () { return window.show('small'); });
  await still();
  await clearLog();
  p = await textPoint('2.0');
  var target = await ev(function () { var r = window.view.rect('0'); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  await touches('touchStart', [[p.x, p.y, 1]]);
  await page.waitForFunction(function () { return window.events('context').length > 0; }, null, { timeout: 3000, polling: 20 }).catch(function () {});
  for (var s = 1; s <= 8; s++) await touches('touchMove', [[p.x + (target.x - p.x) * s / 8, p.y + (target.y - p.y) * s / 8, 1]]);
  /* Held still over Alpha a moment: a drop there means onto it. */
  await require('../fixtures/map/drop.js').decided(page);
  await touches('touchMove', [[target.x + 1, target.y, 1]]);
  var lifted = await ev(function () { return { ghost: !!document.querySelector('.mv-ghost'), target: window.lastTarget }; });
  await touches('touchEnd', []);
  var log = await ev(function () { return window.log.map(function (x) { return x.type; }).filter(function (x) { return x !== 'render' && x !== 'gesture'; }); });
  t.same(log, ['context', 'dragstart', 'dragend'], 'context at 500 ms, then the move lifts the node, then the drop');
  t.check('a ghost followed the finger', lifted.ghost);
  t.same(lifted.target, { path: '0', where: 'child', side: null }, 'onto Alpha as a child');
  t.same((await events('dragend'))[0].detail.target, { path: '0', where: 'child', side: null }, 'the drop says where');
  await sleep(300);
  await clearLog();
  p = await textPoint('2.0');
  await touches('touchStart', [[p.x, p.y, 1]]);
  await page.waitForFunction(function () { return window.events('context').length > 0; }, null, { timeout: 3000, polling: 20 }).catch(function () {});
  for (var s2 = 1; s2 <= 4; s2++) await touches('touchMove', [[p.x - s2 * 8, p.y - s2 * 8, 1]]);
  before = await cam();
  var f1 = [p.x - 32, p.y - 32];
  await touches('touchStart', [[f1[0], f1[1], 1], [f1[0] + 60, f1[1], 2]]);
  for (var s3 = 1; s3 <= 6; s3++) await touches('touchMove', [[f1[0] - s3 * 5, f1[1], 1], [f1[0] + 60 + s3 * 5, f1[1], 2]]);
  after = await cam();
  await touches('touchEnd', []);
  var ends = await events('dragend');
  t.same(ends.map(function (x) { return x.detail.cancelled; }), [true], 'the drag ends, cancelled, as the second finger lands');
  t.check('and the two fingers zoom', after.k > before.k * 1.2, { before: before.k, after: after.k });
  await sleep(300);
  t.eq(await ev(function () { return document.querySelectorAll('.mv-ghost').length; }), 0, 'no ghost left behind');

  /* ------------------------------------------------------------------ */
  t.step('phone screenshots in both themes');
  await ev(function () {
    return window.show('rich').then(function () {
      window.view.setOptions({ branchText: true });
      window.view.select('3.1');
      window.view.setCamera({ x: 0, y: 0, k: 0.8 });
      return window.view.center('3', { animate: false });
    });
  });
  t.eq(await ev(function () { return window.view.el.matches(':focus-visible'); }), false, 'a tap leaves no focus ring on the map');
  var fits = await ev(function () { return document.documentElement.scrollWidth <= innerWidth; });
  t.check('no sideways page scroll', fits);
  await t.shot('phone-light', page);
  await ev(function () { document.documentElement.setAttribute('data-theme', 'dark'); });
  await sleep(50);
  await t.shot('phone-dark', page);
};
