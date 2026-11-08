/* MindRoot - pan, zoom, pinch, wheel and inertia on the map surface.
 *
 * Pointer Events only, so mouse, finger and pen go through one path, with
 * pointer capture so a gesture survives leaving the stage. The view (ns.mapview)
 * owns the camera and what is under the pointer; this file owns what the hand
 * is doing and turns it into camera moves and a few named intents:
 *
 *   one pointer on the background ........ pans after 3 px (1:1, rubber band
 *                                           past the pan limits, a fling with
 *                                           momentum on release)
 *   a finger on a node .................... taps within 10 px, else pans
 *   a mouse or pen on a node .............. lifts the node for a drag after
 *                                           10 px when the view allows it
 *   two fingers ........................... pinch about their midpoint, which
 *                                           also pans; rubber band past
 *                                           [minK, maxK], settles on release
 *                                           (with one finger still down the
 *                                           scale settles while it pans)
 *   a second finger during a drag ......... the drag is cancelled and becomes
 *                                           a pinch, without a jump
 *   Ctrl/Cmd + wheel, trackpad pinch ...... zoom at the cursor (Safari's
 *                                           gesture events too)
 *   plain wheel ........................... pans (Shift turns it sideways)
 *   tap, double tap ....................... intents; a double never zooms
 *   long press (500 ms, finger or pen) .... 'context'; moving afterwards lifts
 *                                           the node for a drag
 *   right click ........................... 'context'
 *
 * Nothing waits: a tap is reported on pointerup at once (the double-tap
 * window costs nothing because the first tap already acted), and any new
 * touch or wheel stops a fling or a camera glide where it is. The press that
 * catches a fling or a settle only stops it, as in every native scroll view:
 * it is never a tap or a long press. Reduced motion keeps direct
 * manipulation 1:1 but drops flings, rubber bands and settles. Speeds and
 * double taps are timed by the events' own timestamps (when the hand did
 * it), so a busy main thread cannot turn a flick into a hold.
 *
 * The motion maths is exported for the view and the unit suite: zoomAround,
 * rubberBand, project, bezier, easing, duration, animate, frames. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var PAN_SLOP = 3;            // px a pointer moves on the background before it pans
  var TAP_SLOP = 10;           // px a finger may wander on a node and still tap
  var DRAG_SLOP = 10;          // px of travel that lifts a node (brief: lift after 10 px)
  var LONG_MS = 500;
  var DOUBLE_MS = 400;
  var DOUBLE_DIST = { mouse: 8, pen: 16, touch: 32 };
  var VELOCITY_MS = 100;       // samples this recent decide a fling's speed
  var STILL_MS = 60;           // a release this long after the last move does not fling
  var DECAY = 0.998;           // momentum kept per millisecond (projection d)
  var FLING_MIN = 0.1;         // px/ms: slower releases simply stop
  var STOP_SPEED = 0.015;      // px/ms: a fling ends below this
  var RUBBER = 0.55;
  var RUBBER_K = 0.5;          // the zoom band, in natural-log units of scale
  var WHEEL_ZOOM = 1 / 200;    // octaves of zoom per wheel pixel
  var WHEEL_ZOOM_MAX = 0.35;   // octaves per event: a mouse notch is a step, not a jump
  var WHEEL_IDLE_MS = 160;
  var SETTLE_MS = 280;
  var EASE_OUT = [0.23, 1, 0.32, 1];

  function now() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* When the hand moved, not when the page got round to it: on a busy main
   * thread events queue up, and timing them on arrival would turn a flick
   * into a hold (no fling) or a hold into a flick. Event times share
   * performance.now()'s clock; anything else (an old engine's epoch time)
   * is ignored. */
  function stamp(e) {
    var t = e && e.timeStamp;
    var n = now();
    return t > 0 && t <= n + 1 && n - t < 10000 ? t : n;
  }

  /* ---------- motion maths ---------- */

  /* Past a limit the content follows the finger less and less, never more
   * than dim away (Apple's formula; c = 0.55). */
  function rubberBand(over, dim, c) {
    if (!over) return 0;
    c = c === undefined ? RUBBER : c;
    dim = dim > 0 ? dim : 1;
    var a = Math.abs(over);
    var banded = (a * dim * c) / (dim + c * a);
    return over < 0 ? -banded : banded;
  }

  /* Where a fling released at v px/ms comes to rest with decay d per ms. */
  function project(v, d) {
    d = d === undefined ? DECAY : d;
    return v * d / (1 - d);
  }

  /* The camera with scale k that keeps the content under (px, py) - in the
   * surface's own coordinates - exactly where it is. */
  function zoomAround(cam, k, px, py) {
    var r = k / cam.k;
    return { x: px - (px - cam.x) * r, y: py - (py - cam.y) * r, k: k };
  }

  /* A CSS cubic-bezier as a function of time, solved the way browsers do it
   * (Newton steps, then bisection), so a node arriving in JS and a panel
   * opening in CSS move on one curve. */
  function bezier(p1x, p1y, p2x, p2y) {
    var cx = 3 * p1x;
    var bx = 3 * (p2x - p1x) - cx;
    var ax = 1 - cx - bx;
    var cy = 3 * p1y;
    var by = 3 * (p2y - p1y) - cy;
    var ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dsx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    function solve(x) {
      var t = x;
      for (var i = 0; i < 8; i++) {
        var err = sx(t) - x;
        if (Math.abs(err) < 1e-6) return t;
        var d = dsx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      var lo = 0;
      var hi = 1;
      t = x;
      for (var j = 0; j < 40; j++) {
        var v = sx(t);
        if (Math.abs(v - x) < 1e-6) return t;
        if (x > v) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return t;
    }
    return function ease(x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      return sy(solve(x));
    };
  }

  var NAMED = {
    linear: null,
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1]
  };

  /* An easing function from a CSS value (the motion tokens are read from
   * motion.css at run time); the house ease-out when it cannot be read. */
  function easing(css) {
    var text = String(css || '').trim();
    var m = /^cubic-bezier\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)$/i.exec(text);
    if (m) return bezier(+m[1], +m[2], +m[3], +m[4]);
    if (Object.prototype.hasOwnProperty.call(NAMED, text)) {
      var p = NAMED[text];
      return p ? bezier(p[0], p[1], p[2], p[3]) : function linear(t) { return clamp(t, 0, 1); };
    }
    return bezier(EASE_OUT[0], EASE_OUT[1], EASE_OUT[2], EASE_OUT[3]);
  }

  /* Milliseconds from a CSS time ('220ms', '.28s'); fallback when unreadable. */
  function duration(css, fallback) {
    var m = /^\s*([\d.]+)\s*(ms|s)\s*$/i.exec(String(css || ''));
    if (!m) return fallback;
    var v = parseFloat(m[1]);
    return m[2].toLowerCase() === 's' ? v * 1000 : v;
  }

  function hidden() { return typeof document !== 'undefined' && !!document.hidden; }

  /* A timed animation: step(eased progress) every frame, then done(finished).
   * A hidden tab produces no frames, so the end is also guaranteed by a
   * timeout, and an animation started in one simply lands. */
  function animate(ms, ease, step, done) {
    var stopped = false;
    var handle = 0;
    var guard = 0;
    var t0 = now();
    ease = ease || easing();
    function finish(complete) {
      if (stopped) return;
      stopped = true;
      clearTimeout(guard);
      if (handle) cancelAnimationFrame(handle);
      if (complete) step(1);
      if (done) done(complete);
    }
    function frame() {
      handle = 0;
      if (stopped) return;
      var p = (now() - t0) / ms;
      if (p >= 1) { finish(true); return; }
      step(ease(p));
      handle = requestAnimationFrame(frame);
    }
    if (!(ms > 1) || hidden()) {
      finish(true);
      return { stop: function stop() {}, running: function running() { return false; } };
    }
    guard = setTimeout(function () { finish(true); }, ms + 150);
    handle = requestAnimationFrame(frame);
    return {
      stop: function stop() { finish(false); },
      running: function running() { return !stopped; }
    };
  }

  /* An open-ended loop (momentum): step(elapsed ms) returns true to go on. */
  function frames(step, done) {
    var stopped = false;
    var handle = 0;
    var timer = 0;
    var t0 = now();
    function end(complete) {
      if (stopped) return;
      stopped = true;
      if (handle) cancelAnimationFrame(handle);
      clearTimeout(timer);
      if (done) done(complete);
    }
    function frame() {
      handle = 0;
      timer = 0;
      if (stopped) return;
      if (!step(now() - t0)) { end(true); return; }
      schedule();
    }
    function schedule() {
      if (hidden()) timer = setTimeout(frame, 16);
      else handle = requestAnimationFrame(frame);
    }
    schedule();
    return {
      stop: function stop() { end(false); },
      running: function running() { return !stopped; }
    };
  }

  function velocity(samples, at) {
    if (samples.length < 2) return { x: 0, y: 0 };
    var last = samples[samples.length - 1];
    if (at - last.t > STILL_MS) return { x: 0, y: 0 };
    var first = samples[0];
    for (var i = 0; i < samples.length; i++) {
      if (last.t - samples[i].t <= VELOCITY_MS) { first = samples[i]; break; }
    }
    var dt = last.t - first.t;
    if (dt < 8) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  /* ---------- the controller ---------- */

  var NODE_KINDS = { node: true, image: true, link: true, task: true, bodytask: true, note: true };
  var DOUBLE_KINDS = { node: true, image: true, background: true };

  /* h: camera() / setCamera(cam, {source}) / constrain(cam) -> nearest
   * allowed camera / rect() -> the surface's client rect / classify(target,
   * x, y) -> {kind, key, path, ...} / ignore(event) -> leave it alone (text
   * fields) / canDrag(info, pointerType) / tap, doubleTap, longPress,
   * context, dragStart, dragMove, dragEnd (info) / state(mode) / stop() (the
   * view's own camera glide) / reducedMotion() / minK, maxK. */
  function attach(el, h) {
    var minK = h.minK || 0.1;
    var maxK = h.maxK || 4;
    var pointers = new Map();
    var mode = 'idle';
    var press = null;
    var pan = null;
    var pinch = null;
    var lastTap = null;
    var longTimer = 0;
    var longAt = -Infinity;
    var motion = null;
    var wheelTimer = 0;
    var safari = null;
    var lastMid = null;

    function call(name, arg) {
      if (typeof h[name] === 'function') return h[name](arg);
      return undefined;
    }

    function reduced() { return !!call('reducedMotion'); }

    function setMode(next) {
      if (mode === next) return;
      mode = next;
      call('state', next);
    }

    function local(x, y) {
      var r = h.rect();
      return { x: x - r.left, y: y - r.top };
    }

    function camera() { return h.camera(); }

    function setCamera(cam, source) { h.setCamera(cam, { source: source }); }

    function constrain(cam) { return h.constrain ? h.constrain(cam) : cam; }

    function stopMotion() {
      if (motion) { motion.stop(); motion = null; }
      call('stop');
    }

    function cancelLong() {
      if (longTimer) clearTimeout(longTimer);
      longTimer = 0;
    }

    function infoOf(base, e, x, y) {
      var out = {};
      for (var k in base) out[k] = base[k];
      out.x = x;
      out.y = y;
      out.pointerType = e ? e.pointerType || 'mouse' : (press ? press.type : 'mouse');
      if (e) {
        out.ctrlKey = !!e.ctrlKey;
        out.metaKey = !!e.metaKey;
        out.shiftKey = !!e.shiftKey;
        out.altKey = !!e.altKey;
      }
      return out;
    }

    /* Past the pan limits a finger drags the content on a rubber band;
     * reduced motion holds it at the limit instead. */
    function bandPan(raw) {
      var c = constrain(raw);
      if (reduced()) return c;
      var r = h.rect();
      return {
        x: c.x + rubberBand(raw.x - c.x, r.width || 1),
        y: c.y + rubberBand(raw.y - c.y, r.height || 1),
        k: raw.k
      };
    }

    function bandK(k) {
      if (reduced()) return clamp(k, minK, maxK);
      if (k > maxK) return maxK * Math.exp(rubberBand(Math.log(k / maxK), RUBBER_K));
      if (k < minK) return minK * Math.exp(rubberBand(Math.log(k / minK), RUBBER_K));
      return k;
    }

    /* ---------- pan ---------- */

    /* A pan is the camera it started from (base) plus how far the hand has
     * gone since (x - x0, y - y0). Kept apart so the base can itself move
     * while the hand pans: the scale settling under the finger that stayed
     * down after a pinch. */
    function startPan(x, y, t) {
      cancelLong();
      pan = { base: camera(), x0: x, y0: y, x: x, y: y, samples: [{ t: t === undefined ? now() : t, x: x, y: y }], zoom: null, anchor: null };
      setMode('pan');
    }

    function panWrite() {
      var b = pan.base;
      setCamera(bandPan({ x: b.x + (pan.x - pan.x0), y: b.y + (pan.y - pan.y0), k: b.k }), 'pan');
    }

    function panTo(x, y, at) {
      pan.x = x;
      pan.y = y;
      panWrite();
      var t = at === undefined ? now() : at;
      pan.samples.push({ t: t, x: x, y: y });
      while (pan.samples.length > 2 && t - pan.samples[0].t > VELOCITY_MS * 2) pan.samples.shift();
    }

    function stopPanZoom() {
      if (pan && pan.zoom) { pan.zoom.stop(); pan.zoom = null; }
    }

    /* The finger left after a pinch past the zoom limits: the scale goes
     * back inside them around where the pinch was, on the settle curve,
     * while that finger keeps panning 1:1 - never a jump to the limit. */
    function settleUnderPan(from, k, at) {
      var lk0 = Math.log(from.k);
      var lk1 = Math.log(k);
      pan.anchor = at;
      var mine = pan;
      mine.zoom = animate(SETTLE_MS, easing(), function (p) {
        if (pan !== mine) return;
        mine.base = zoomAround(from, p >= 1 ? k : Math.exp(lk0 + (lk1 - lk0) * p), at.x, at.y);
        panWrite();
      }, function () { mine.zoom = null; });
    }

    function endPan(fling, at) {
      var v = fling ? velocity(pan.samples, at === undefined ? now() : at) : { x: 0, y: 0 };
      var anchor = pan.zoom ? pan.anchor : null;
      stopPanZoom();
      pan = null;
      var cam = camera();
      var c = constrain(cam);
      var outside = Math.abs(c.x - cam.x) > 0.5 || Math.abs(c.y - cam.y) > 0.5 || Math.abs(c.k - cam.k) > 1e-4;
      if (outside) return settle(anchor);
      if (!reduced() && Math.hypot(v.x, v.y) > FLING_MIN) return glide(v);
      setMode('idle');
    }

    /* Momentum: the speed decays by DECAY every millisecond, which lands it
     * where project() says. An axis that meets a pan limit stops there. */
    function glide(v) {
      var c0 = camera();
      var lnd = Math.log(DECAY);
      var vx = v.x;
      var vy = v.y;
      var lockX = c0.x;
      var lockY = c0.y;
      var heldX = false;
      var heldY = false;
      setMode('momentum');
      motion = frames(function (t) {
        var f = (Math.pow(DECAY, t) - 1) / lnd;
        var raw = { x: heldX ? lockX : c0.x + vx * f, y: heldY ? lockY : c0.y + vy * f, k: c0.k };
        var c = constrain(raw);
        if (!heldX && c.x !== raw.x) { heldX = true; lockX = c.x; }
        if (!heldY && c.y !== raw.y) { heldY = true; lockY = c.y; }
        setCamera(c, 'momentum');
        var speed = Math.pow(DECAY, t) * Math.hypot(heldX ? 0 : vx, heldY ? 0 : vy);
        return speed > STOP_SPEED;
      }, function () {
        motion = null;
        if (mode === 'momentum') setMode('idle');
      });
    }

    /* Back inside the limits after a rubber band, around the point the hand
     * left (the pinch midpoint), on the camera curve. */
    function settle(anchor) {
      var from = camera();
      var k = clamp(from.k, minK, maxK);
      var at = anchor || { x: (h.rect().width || 0) / 2, y: (h.rect().height || 0) / 2 };
      var to = constrain(k === from.k ? from : zoomAround(from, k, at.x, at.y));
      /* Already inside: nothing to settle (a no-op glide would swallow the
       * next tap as a catch). */
      if (Math.abs(to.x - from.x) < 0.01 && Math.abs(to.y - from.y) < 0.01 && Math.abs(to.k - from.k) < 1e-9) {
        setMode('idle');
        return;
      }
      if (reduced() || hidden()) {
        setCamera(to, 'settle');
        setMode('idle');
        return;
      }
      setMode('settle');
      var lk0 = Math.log(from.k);
      var lk1 = Math.log(to.k);
      motion = animate(SETTLE_MS, easing(), function (p) {
        /* Exactly the target at the end: exp(log(k)) is not always k. */
        if (p >= 1) { setCamera(to, 'settle'); return; }
        setCamera({ x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, k: Math.exp(lk0 + (lk1 - lk0) * p) }, 'settle');
      }, function () {
        motion = null;
        if (mode === 'settle') setMode('idle');
      });
    }

    /* ---------- pinch ---------- */

    function pinchPair() {
      var ids = [];
      if (press && pointers.has(press.id)) ids.push(press.id);
      pointers.forEach(function (p) { if (ids.length < 2 && ids.indexOf(p.id) < 0) ids.push(p.id); });
      return ids;
    }

    function startPinch() {
      cancelLong();
      if (mode === 'drag') endDrag(true);
      stopPanZoom();
      var ids = pinchPair();
      var a = pointers.get(ids[0]);
      var b = pointers.get(ids[1]);
      var mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = { ids: ids, cam0: camera(), mid0: mid, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
      lastMid = mid;
      press = null;
      pan = null;
      lastTap = null;
      setMode('pinch');
    }

    function pinchMove() {
      var a = pointers.get(pinch.ids[0]);
      var b = pointers.get(pinch.ids[1]);
      if (!a || !b) return;
      var mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      var c0 = pinch.cam0;
      var k = bandK(c0.k * Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0);
      var raw = {
        x: mid.x - (pinch.mid0.x - c0.x) / c0.k * k,
        y: mid.y - (pinch.mid0.y - c0.y) / c0.k * k,
        k: k
      };
      lastMid = mid;
      setCamera(bandPan(raw), 'pinch');
    }

    function endPinch() {
      pinch = null;
      var rest = [];
      pointers.forEach(function (p) { rest.push(p); });
      if (rest.length >= 2) {
        press = { id: rest[0].id, type: rest[0].type, x0: rest[0].x, y0: rest[0].y, x: rest[0].x, y: rest[0].y, info: { kind: 'background', key: 'bg' } };
        startPinch();
        return;
      }
      if (rest.length === 1) {
        /* The finger left behind carries on panning from where it is now:
         * no jump towards where it first landed. Out of the zoom range, the
         * scale settles back around the last midpoint under that pan. */
        var r = rest[0];
        press = { id: r.id, type: r.type, x0: r.x, y0: r.y, x: r.x, y: r.y, info: { kind: 'background', key: 'bg' }, dead: false };
        var cam = camera();
        var k = clamp(cam.k, minK, maxK);
        startPan(r.x, r.y);
        if (k !== cam.k) {
          if (reduced() || hidden()) {
            pan.base = zoomAround(cam, k, lastMid.x, lastMid.y);
            panWrite();
          } else {
            settleUnderPan(cam, k, lastMid);
          }
        }
        return;
      }
      settle(lastMid);
    }

    /* ---------- drag of a node (the editor's) ---------- */

    function onKey(e) {
      if (e.key === 'Escape' && mode === 'drag') {
        e.preventDefault();
        e.stopPropagation();
        endDrag(true);
        if (press) press.dead = true;
      }
    }

    function startDrag() {
      cancelLong();
      var ok = call('dragStart', infoOf(press.info, null, press.x, press.y));
      if (ok === false) { press.dead = true; setMode('idle'); return; }
      setMode('drag');
      window.addEventListener('keydown', onKey, true);
    }

    function endDrag(cancelled) {
      window.removeEventListener('keydown', onKey, true);
      var info = infoOf(press ? press.info : {}, null, press ? press.x : 0, press ? press.y : 0);
      info.cancelled = !!cancelled;
      setMode('idle');
      call('dragEnd', info);
    }

    /* ---------- pointers ---------- */

    function onDown(e) {
      if (call('ignore', e)) return;
      var type = e.pointerType || 'mouse';
      if (type === 'mouse' && e.button !== 0 && e.button !== 1) return;
      if (pointers.size && (type === 'mouse' || pointers.values().next().value.type === 'mouse')) return;
      if (pointers.size >= 2) { pointers.set(e.pointerId, { id: e.pointerId, type: type, x: e.clientX, y: e.clientY }); return; }
      /* This press stops the map the hand set moving: it only catches it. */
      var caught = mode === 'momentum' || mode === 'settle';
      stopMotion();
      if (wheelTimer) { clearTimeout(wheelTimer); wheelTimer = 0; }
      pointers.set(e.pointerId, { id: e.pointerId, type: type, x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already gone */ }
      if (pointers.size === 2) {
        if (mode === 'pan' || mode === 'press' || mode === 'drag' || mode === 'long' || mode === 'idle') startPinch();
        return;
      }
      var info = h.classify(e.target, e.clientX, e.clientY) || { kind: 'background', key: 'bg' };
      press = { id: e.pointerId, type: type, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, info: info, dead: false, caught: caught };
      if (type === 'mouse' && e.button === 1) {
        /* The middle button pans from anywhere, at once; no autoscroll. */
        e.preventDefault();
        startPan(e.clientX, e.clientY);
        return;
      }
      setMode('press');
      if (caught) lastTap = null;
      if (type !== 'mouse' && NODE_KINDS[info.kind] && !caught) {
        longTimer = setTimeout(function () {
          longTimer = 0;
          if (mode !== 'press' || !press) return;
          longAt = now();
          setMode('long');
          call('longPress', infoOf(press.info, null, press.x, press.y));
        }, LONG_MS);
      }
    }

    function onMove(e) {
      var p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (mode === 'pinch') {
        if (pinch && pinch.ids.indexOf(e.pointerId) >= 0) pinchMove();
        return;
      }
      if (!press || press.id !== e.pointerId || press.dead) return;
      press.x = e.clientX;
      press.y = e.clientY;
      var dist = Math.hypot(press.x - press.x0, press.y - press.y0);
      var t = stamp(e);
      if (mode === 'press') {
        /* The move grip of a node is there to be pulled: it lifts the node
         * at once, a finger as much as a mouse. */
        if (press.info.kind === 'grip' || press.info.kind === 'wire') {
          if (dist > DRAG_SLOP && call('canDrag', infoOf(press.info, e, press.x, press.y))) startDrag();
        } else if (!NODE_KINDS[press.info.kind]) {
          if (dist > PAN_SLOP) { startPan(press.x0, press.y0, t); panTo(press.x, press.y, t); }
        } else if (press.type === 'touch') {
          if (dist > TAP_SLOP) { startPan(press.x0, press.y0, t); panTo(press.x, press.y, t); }
        } else {
          var draggable = !!call('canDrag', infoOf(press.info, e, press.x, press.y));
          if (draggable && dist > DRAG_SLOP) startDrag();
          else if (!draggable && dist > PAN_SLOP) { startPan(press.x0, press.y0, t); panTo(press.x, press.y, t); }
        }
      } else if (mode === 'long') {
        if (dist > DRAG_SLOP && call('canDrag', infoOf(press.info, e, press.x, press.y))) startDrag();
      } else if (mode === 'pan') {
        if (pan) panTo(press.x, press.y, t);
      } else if (mode === 'drag') {
        call('dragMove', infoOf(press.info, e, press.x, press.y));
      }
    }

    function release(e, cancelled) {
      var p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      try { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
      if (mode === 'pinch') {
        if (pinch && pinch.ids.indexOf(e.pointerId) >= 0) endPinch();
        return;
      }
      if (!press || press.id !== e.pointerId) {
        if (!pointers.size && mode !== 'momentum' && mode !== 'settle') setMode('idle');
        return;
      }
      cancelLong();
      var was = mode;
      var at = press;
      if (was === 'press' && !cancelled && !at.dead && !at.caught) tap(e, at);
      else if (was === 'pan') endPan(!cancelled, stamp(e));
      else if (was === 'drag') endDrag(cancelled);
      press = null;
      if (mode === 'press' || mode === 'long') setMode('idle');
    }

    function tap(e, at) {
      var info = infoOf(at.info, e, e.clientX, e.clientY);
      var t = stamp(e);
      var near = DOUBLE_DIST[at.type] || DOUBLE_DIST.mouse;
      if (lastTap && DOUBLE_KINDS[info.kind] && lastTap.key === info.key && lastTap.type === at.type &&
          t - lastTap.t <= DOUBLE_MS && Math.hypot(lastTap.x - e.clientX, lastTap.y - e.clientY) <= near) {
        lastTap = null;
        call('doubleTap', info);
        return;
      }
      lastTap = DOUBLE_KINDS[info.kind] ? { key: info.key, type: at.type, t: t, x: e.clientX, y: e.clientY } : null;
      call('tap', info);
    }

    /* Two taps are a double tap only when nothing came between them: a key
     * pressed (Delete, then Undo) or a press anywhere off the map (a
     * viewer's Close) makes the next tap a first one again, however soon it
     * comes. A modifier held down (and its autorepeat) is part of the click,
     * not between the clicks. */
    function forgetTap(e) {
      if (!lastTap) return;
      if (e.type === 'keydown' && (e.repeat || /^(Shift|Control|Alt|Meta|AltGraph|CapsLock)$/.test(e.key))) return;
      if (e.type === 'pointerdown' && el.contains(e.target)) return;
      lastTap = null;
    }
    window.addEventListener('keydown', forgetTap, true);
    window.addEventListener('pointerdown', forgetTap, true);

    function onUp(e) { release(e, false); }
    function onCancel(e) { release(e, true); }

    function onLost(e) {
      /* Capture taken away from the surface while the pointer is still down
       * (another capture won): end it as a cancel. A child losing the
       * implicit capture of a touch to the surface (setPointerCapture
       * above) bubbles here too, and is not a loss. */
      if (e.target !== el) return;
      if (pointers.has(e.pointerId)) release(e, true);
    }

    /* ---------- wheel, trackpad, Safari ---------- */

    function zoomAt(point, factor, source) {
      var cam = camera();
      var k = clamp(cam.k * factor, minK, maxK);
      if (k === cam.k) return;
      setCamera(constrain(zoomAround(cam, k, point.x, point.y)), source);
    }

    function onWheel(e) {
      if (call('ignore', e)) return;
      e.preventDefault();
      if (mode === 'pan' || mode === 'pinch' || mode === 'press' || mode === 'long') return;
      stopMotion();
      var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? (h.rect().height || 800) : 1);
      var dx = e.deltaX * unit;
      var dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        var octaves = clamp(-dy * WHEEL_ZOOM, -WHEEL_ZOOM_MAX, WHEEL_ZOOM_MAX);
        zoomAt(local(e.clientX, e.clientY), Math.pow(2, octaves), 'wheel');
      } else {
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        var cam = camera();
        setCamera(constrain({ x: cam.x - dx, y: cam.y - dy, k: cam.k }), 'wheel');
      }
      if (mode !== 'drag') {
        setMode('wheel');
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(function () {
          wheelTimer = 0;
          if (mode === 'wheel') setMode('idle');
        }, WHEEL_IDLE_MS);
      }
    }

    function touching() {
      var any = false;
      pointers.forEach(function (p) { if (p.type === 'touch') any = true; });
      return any;
    }

    /* Safari on a Mac sends a trackpad pinch as gesture events, not as
     * Ctrl+wheel. On iOS the same events shadow a finger pinch, which the
     * pointers already drive, so they are ignored while a finger is down. */
    function onGestureStart(e) {
      e.preventDefault();
      if (touching()) return;
      stopMotion();
      safari = { k0: camera().k };
    }

    function onGestureChange(e) {
      e.preventDefault();
      if (!safari || touching()) return;
      var cam = camera();
      var k = clamp(safari.k0 * (e.scale || 1), minK, maxK);
      var at = local(e.clientX, e.clientY);
      setCamera(constrain(zoomAround(cam, k, at.x, at.y)), 'wheel');
    }

    function onGestureEnd(e) {
      e.preventDefault();
      safari = null;
    }

    function onContext(e) {
      if (call('ignore', e)) return;
      e.preventDefault();
      /* A finger's long press is the timer's: the browser's own
       * contextmenu for the same press would be a second menu. */
      if (touching() || now() - longAt < 1000) return;
      /* Ctrl+click on a Mac is a right click: the press it came with must
       * not also land as a tap (a deep fold, a selection). */
      if (press && press.type === 'mouse') press.dead = true;
      var info = h.classify(e.target, e.clientX, e.clientY) || { kind: 'background', key: 'bg' };
      var out = infoOf(info, null, e.clientX, e.clientY);
      out.pointerType = 'mouse';
      call('context', out);
    }

    /* Links in nodes are activated by the view's tap (a 'link' intent), never
     * by the browser following them; text fields keep their own clicks. */
    function onClick(e) {
      if (call('ignore', e)) return;
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a && el.contains(a)) e.preventDefault();
    }

    function onNativeDrag(e) {
      if (call('ignore', e)) return;
      e.preventDefault();
    }

    function onDblClick(e) {
      if (call('ignore', e)) return;
      e.preventDefault();
    }

    /* The moves of a touch the map is following are the map's own. Left to
     * the browser, a quick pan also reads as a fling of its own (nothing
     * scrolls: touch-action is none), and the next tap anywhere on the page,
     * up to half a second later, only stops that fling and never clicks: a
     * button of the thumb bar pressed right after a pan did nothing. The
     * pointer events come first and are not affected; text fields keep
     * their touches. */
    function onTouchMove(e) {
      if (!pointers.size || call('ignore', e)) return;
      if (e.cancelable) e.preventDefault();
    }

    var bindings = [
      ['pointerdown', onDown, false],
      ['pointermove', onMove, false],
      ['pointerup', onUp, false],
      ['pointercancel', onCancel, false],
      ['lostpointercapture', onLost, false],
      ['wheel', onWheel, { passive: false }],
      ['contextmenu', onContext, false],
      ['click', onClick, true],
      ['dblclick', onDblClick, false],
      ['touchmove', onTouchMove, { passive: false }],
      ['dragstart', onNativeDrag, false],
      ['gesturestart', onGestureStart, false],
      ['gesturechange', onGestureChange, false],
      ['gestureend', onGestureEnd, false]
    ];
    bindings.forEach(function (b) { el.addEventListener(b[0], b[1], b[2]); });

    /* Ends whatever is going on, as a cancel: a drag is dropped nowhere, a
     * pan stops where it is (and settles back inside the limits). */
    function cancel() {
      cancelLong();
      if (mode === 'drag') endDrag(true);
      if (pan) {
        var anchor = pan.zoom ? pan.anchor : null;
        stopPanZoom();
        pan = null;
        settle(anchor);
      }
      if (pinch) { pinch = null; settle(lastMid); }
      pointers.forEach(function (p) {
        try { if (el.hasPointerCapture && el.hasPointerCapture(p.id)) el.releasePointerCapture(p.id); } catch (err) { /* gone */ }
      });
      pointers.clear();
      press = null;
      if (mode === 'press' || mode === 'long' || mode === 'pan' || mode === 'pinch') setMode('idle');
    }

    function destroy() {
      cancel();
      stopMotion();
      if (wheelTimer) clearTimeout(wheelTimer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', forgetTap, true);
      window.removeEventListener('pointerdown', forgetTap, true);
      bindings.forEach(function (b) { el.removeEventListener(b[0], b[1], b[2]); });
    }

    return {
      destroy: destroy,
      cancel: cancel,
      stop: function stop() { if (motion) { motion.stop(); motion = null; } },
      mode: function getMode() { return mode; }
    };
  }

  ns.gestures = {
    attach: attach,
    zoomAround: zoomAround,
    rubberBand: rubberBand,
    project: project,
    bezier: bezier,
    easing: easing,
    duration: duration,
    animate: animate,
    frames: frames,
    velocity: velocity,
    CONST: {
      PAN_SLOP: PAN_SLOP, TAP_SLOP: TAP_SLOP, DRAG_SLOP: DRAG_SLOP, LONG_MS: LONG_MS,
      DOUBLE_MS: DOUBLE_MS, DECAY: DECAY, RUBBER: RUBBER,
      VELOCITY_MS: VELOCITY_MS, STILL_MS: STILL_MS, FLING_MIN: FLING_MIN, STOP_SPEED: STOP_SPEED
    }
  };
})(window.MindRoot);
