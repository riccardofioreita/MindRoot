/* MindRoot - moving a floating panel by hand.
 *
 * Everything that floats over the map is placed for you: the node bar above
 * its node, the bubble beside its dot, the picker under its swatch, a panel
 * in its corner. That is right nearly always, and wrong in the one case
 * nobody can plan for: what you were about to read is behind it. So each of
 * them can be carried by a handle and dropped anywhere, and while it sits
 * where a hand put it, whoever normally places it keeps its hands off. Not
 * for ever: the next time the panel is aimed at something else (another
 * node, another note, or simply opened again) it goes back to being placed,
 * because a bar that belongs to a node has to be near that node to say so.
 *
 * The contract, for the owners of panels:
 *   attach(panel, grip)  the grip carries the panel; double-click puts it back
 *   moved(panel)         ask before placing: true means hands off
 *   anchor(panel)        call when the panel is aimed at something new
 *   place(panel, rect)   put the panel at rect.left/top (screen coordinates),
 *                        kept inside its frame
 * A press becomes a drag only after 3px (a finger never presses without
 * sliding a little), the panel stays inside the stage with at least 48px of
 * it graspable, and a smaller window or a phone keyboard pulls moved panels
 * back into view. Nothing is written to disk. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var KEEP = 48;
  var MARGIN = 4;
  var THRESHOLD = 3;

  var placed = new WeakSet();
  var known = [];
  var dragging = null;

  function clamp(value, low, high) {
    if (high < low) return low;
    return Math.max(low, Math.min(value, high));
  }

  /* Absolute panels are placed against their offset parent, fixed ones
   * against the window, and offsetParent is null for exactly the second
   * case, which is what lets one function do both. */
  function frameOf(el) {
    var parent = el.offsetParent;
    var vv = window.visualViewport;
    var view = {
      left: vv ? vv.offsetLeft : 0,
      top: vv ? vv.offsetTop : 0,
      right: vv ? vv.offsetLeft + vv.width : window.innerWidth,
      bottom: vv ? vv.offsetTop + vv.height : window.innerHeight
    };
    if (!parent || parent === document.body || parent === document.documentElement) return { frame: view, view: view, origin: { x: 0, y: 0 } };
    var box = parent.getBoundingClientRect();
    return {
      frame: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      view: view,
      origin: { x: box.left, y: box.top }
    };
  }

  /* Where a panel may go: inside its frame and inside what is visible of the
   * window (the keyboard shrinks the visual viewport, not the frame). */
  function roomFor(el) {
    var f = frameOf(el);
    return {
      left: Math.max(f.view.left + MARGIN, f.frame.left + MARGIN),
      top: Math.max(f.view.top + MARGIN, f.frame.top + MARGIN),
      right: Math.min(f.view.right - MARGIN, f.frame.right - MARGIN),
      bottom: Math.min(f.view.bottom - MARGIN, f.frame.bottom - MARGIN),
      originX: f.origin.x,
      originY: f.origin.y
    };
  }

  /* The pure part, for tests: where a box of size w x h asked to go to
   * (left, top) ends up inside room. All of it inside when it fits; when it
   * is bigger than the room, its start edge stays visible and at least KEEP
   * pixels of it remain on screen. */
  function fit(left, top, w, h, room) {
    var wide = w > room.right - room.left;
    var tall = h > room.bottom - room.top;
    var x = wide ? clamp(left, room.right - KEEP - w, room.left) : clamp(left, room.left, room.right - w);
    var y = tall ? clamp(top, room.bottom - KEEP - h, room.top) : clamp(top, room.top, room.bottom - h);
    return { left: x, top: y };
  }

  function put(el, left, top, rect) {
    rect = rect || el.getBoundingClientRect();
    var room = roomFor(el);
    var p = fit(left, top, rect.width, rect.height, room);
    el.style.left = Math.round(p.left - room.originX) + 'px';
    el.style.top = Math.round(p.top - room.originY) + 'px';
    return p;
  }

  function moved(el) { return !!el && placed.has(el); }

  /* Back to whoever places it. The inline offsets go too: some panels are
   * placed by the stylesheet alone, and for them removing the offsets is the
   * way back. */
  function anchor(el) {
    if (!el || !placed.has(el)) return false;
    placed.delete(el);
    el.removeAttribute('data-moved');
    el.style.left = '';
    el.style.top = '';
    return true;
  }

  function anchorAll() {
    for (var i = 0; i < known.length; i++) anchor(known[i]);
  }

  /* An owner placing its panel programmatically, kept inside the frame. A
   * rect without a size is a point: the panel's top-left goes there. */
  function place(el, rect) {
    if (!el || !rect) return null;
    var left = rect.left != null ? rect.left : rect.x;
    var top = rect.top != null ? rect.top : rect.y;
    return put(el, left, top);
  }

  function begin(el, grip, event) {
    if (event.button != null && event.button > 0) return;
    if (dragging) return;
    var rect = el.getBoundingClientRect();
    dragging = {
      el: el,
      grip: grip,
      id: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      x0: event.clientX,
      y0: event.clientY,
      x: event.clientX,
      y: event.clientY,
      live: false,
      frame: 0
    };
    try { grip.setPointerCapture(event.pointerId); } catch (err) { /* no capture: the grip still works while under the pointer */ }
    event.preventDefault();
  }

  /* Layout is read and written once per frame, however many pointermoves a
   * 120Hz pen sends. */
  function step() {
    var d = dragging;
    if (!d) return;
    d.frame = 0;
    if (!d.live) {
      var rect = d.el.getBoundingClientRect();
      d.live = true;
      placed.add(d.el);
      d.el.setAttribute('data-moved', 'true');
      d.el.setAttribute('data-moving', 'true');
      document.documentElement.setAttribute('data-gesture', 'panel');
      put(d.el, rect.left, rect.top, rect);
    }
    put(d.el, d.x - d.dx, d.y - d.dy);
  }

  function drag(event) {
    var d = dragging;
    if (!d || event.pointerId !== d.id) return;
    d.x = event.clientX;
    d.y = event.clientY;
    if (!d.live && Math.abs(d.x - d.x0) <= THRESHOLD && Math.abs(d.y - d.y0) <= THRESHOLD) return;
    event.preventDefault();
    if (!d.frame) d.frame = requestAnimationFrame(step);
  }

  function end(event) {
    var d = dragging;
    if (!d || (event && event.pointerId !== d.id)) return;
    if (d.frame) {
      cancelAnimationFrame(d.frame);
      if (d.live) step();
    }
    dragging = null;
    d.el.removeAttribute('data-moving');
    if (document.documentElement.getAttribute('data-gesture') === 'panel') document.documentElement.removeAttribute('data-gesture');
    try { d.grip.releasePointerCapture(event.pointerId); } catch (err) { /* already released */ }
  }

  /* A handle is a strip with nothing to read, so it says what it is for in
   * its title, and answers a double click by putting the panel back. */
  function attach(el, grip) {
    if (!el || !grip) return;
    if (known.indexOf(el) < 0) known.push(el);
    if (grip.__mrFloat) return;
    grip.__mrFloat = true;
    if (ns.i18n && !grip.hasAttribute('title')) {
      grip.setAttribute('data-i18n-title', 'float.grip');
      grip.setAttribute('title', ns.i18n.t('float.grip'));
    }
    grip.addEventListener('pointerdown', function (event) { begin(el, grip, event); });
    grip.addEventListener('pointermove', drag);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    if (ns.ui && ns.ui.ownTouches) ns.ui.ownTouches(grip);
    grip.addEventListener('lostpointercapture', end);
    grip.addEventListener('dblclick', function (event) {
      event.preventDefault();
      if (anchor(el) && typeof el.__mrReplace === 'function') el.__mrReplace();
    });
  }

  /* For panels placed by a function rather than by the stylesheet: what a
   * double click on the grip runs to put the panel back. */
  function onAnchor(el, fn) {
    if (el) el.__mrReplace = fn;
  }

  /* A window that got smaller can leave a moved panel outside it. It keeps
   * the place it was given and is only pulled back far enough to be seen. */
  function reflow() {
    for (var i = known.length - 1; i >= 0; i--) {
      var el = known[i];
      if (!el.isConnected) { known.splice(i, 1); continue; }
      if (!placed.has(el) || el.hidden) continue;
      var rect = el.getBoundingClientRect();
      put(el, rect.left, rect.top, rect);
    }
  }

  var reflowSoon = ns.util ? ns.util.throttleFrame(reflow) : reflow;
  window.addEventListener('resize', reflowSoon);
  /* The visual viewport is the one that changes when a phone keyboard comes
   * up, and window.resize does not always fire then. */
  if (window.visualViewport) window.visualViewport.addEventListener('resize', reflowSoon);

  if (ns.i18n) {
    ns.i18n.add({
      en: { 'float.grip': 'Drag to move it, double-click to put it back' },
      it: { 'float.grip': 'Trascina per spostarlo, doppio clic per rimetterlo a posto' }
    });
  }

  ns.float = {
    attach: attach,
    moved: moved,
    anchor: anchor,
    anchorAll: anchorAll,
    place: place,
    onAnchor: onAnchor,
    reflow: reflow,
    fit: fit,
    KEEP: KEEP
  };
})(window.MindRoot);
