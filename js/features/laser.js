/* MindRoot - laser: a laser pointer over the map (ns.laser).
 *
 * The drawing editor has its own laser on the pen (js/features/ink.js); this
 * one points at the map itself, for presenting or for a call: command
 * view.laser (Mod+Alt+L, the dot-and-rays button in the zoom capsule).
 * While it is on, a layer over the stage takes the pointer: a mouse or a
 * pen leaves a red trail wherever it moves (pressed or not), a finger where
 * it drags. Points older than LIFE fall off, so the trail fades from behind
 * and is gone within a second of stopping. The map does not move and
 * nothing is selected, edited or saved; Escape or the button again turns it
 * off. It works in view-only mode too.
 *
 *   init()
 *   toggle(on?) -> bool     the state after
 *   isOn() -> bool
 * Bus: 'laser' {on}. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var LIFE = 700;
  var MAX_POINTS = 400;
  var SVG = 'http://www.w3.org/2000/svg';

  ns.i18n.add({
    en: {
      'laser.cmd': 'Laser pointer',
      'laser.kw': 'laser pointer present presentation point highlight call',
      'laser.help': 'Points at the map with a red trail that fades within a second: a mouse or a pen just moves, a finger drags. Nothing is selected or changed. Escape or the button again turns it off.',
      'laser.on': 'Laser pointer on. Press the button again (or Escape) to turn it off.'
    },
    it: {
      'laser.cmd': 'Puntatore laser',
      'laser.kw': 'laser puntatore presenta presentazione indica evidenzia chiamata',
      'laser.help': 'Indica la mappa con una scia rossa che svanisce entro un secondo: con mouse o penna basta muoversi, con il dito si trascina. Non seleziona né cambia nulla. Esc o di nuovo il pulsante lo spegne.',
      'laser.on': 'Puntatore laser attivo. Premi di nuovo il pulsante (o Esc) per spegnerlo.'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }

  var on = false;
  var layer = null;
  var svg = null;
  var glow = null;
  var core = null;
  var dot = null;
  var trail = [];
  var frame = 0;
  var down = null;
  var popEsc = null;

  function stage() { return document.getElementById('stage'); }
  function hasMap() { var S = ns.session; return !!(S && S.current && S.current()); }
  function now() { return Date.now(); }

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function build() {
    layer = document.createElement('div');
    layer.className = 'map-laser';
    layer.setAttribute('aria-hidden', 'true');
    svg = svgEl('svg', { 'class': 'map-laser__svg', 'data-off': '' });
    glow = svgEl('path', { 'class': 'map-laser__glow' });
    core = svgEl('path', { 'class': 'map-laser__core' });
    dot = svgEl('circle', { 'class': 'map-laser__dot', r: '7' });
    svg.appendChild(glow);
    svg.appendChild(core);
    svg.appendChild(dot);
    layer.appendChild(svg);
    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('pointercancel', onUp);
    layer.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') down = null; });
    layer.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function add(e) {
    var r = layer.getBoundingClientRect();
    var list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (!list.length) list = [e];
    for (var i = 0; i < list.length; i++) trail.push({ x: list[i].clientX - r.left, y: list[i].clientY - r.top, t: now() });
    if (trail.length > MAX_POINTS) trail.splice(0, trail.length - MAX_POINTS);
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    down = e.pointerId;
    try { layer.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    add(e);
  }

  function onMove(e) {
    if (e.pointerType === 'touch' && down !== e.pointerId) return;
    add(e);
  }

  function onUp(e) {
    if (down === e.pointerId) down = null;
    try { layer.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
  }

  function path(pts) {
    if (pts.length < 2) return '';
    var d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (var i = 1; i < pts.length; i++) d += 'L' + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1);
    return d;
  }

  function paint() {
    frame = 0;
    if (!svg) return;
    var t0 = now();
    var last = trail[trail.length - 1];
    var held = down !== null;
    trail = trail.filter(function (p) { return t0 - p.t < LIFE || (held && p === last); });
    if (!trail.length) {
      svg.setAttribute('data-off', '');
      glow.removeAttribute('d');
      core.removeAttribute('d');
      return;
    }
    svg.removeAttribute('data-off');
    var d = path(trail);
    glow.setAttribute('d', d);
    core.setAttribute('d', d);
    var head = trail[trail.length - 1];
    dot.setAttribute('cx', head.x.toFixed(1));
    dot.setAttribute('cy', head.y.toFixed(1));
    var age = held ? 0 : (t0 - head.t) / LIFE;
    svg.style.opacity = String(Math.max(0, 1 - age * age));
    frame = requestAnimationFrame(paint);
  }

  function toggle(want) {
    var next = want === undefined ? !on : !!want;
    if (next && !hasMap()) next = false;
    if (next === on) return on;
    on = next;
    var host = stage();
    if (on) {
      if (!layer) build();
      trail = [];
      if (host && layer.parentNode !== host) host.appendChild(layer);
      document.documentElement.setAttribute('data-laser', '');
      if (ns.ui && ns.ui.escape) popEsc = ns.ui.escape.push(function () { toggle(false); return true; });
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('laser.on'));
    } else {
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      document.documentElement.removeAttribute('data-laser');
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      down = null;
      trail = [];
      if (popEsc) { try { popEsc(); } catch (err) { /* already gone */ } popEsc = null; }
    }
    if (ns.bus) { ns.bus.emit('laser', { on: on }); ns.bus.emit('commands', { id: 'view.laser' }); }
    return on;
  }

  function init() {
    var C = ns.commands;
    if (C) {
      C.register({
        id: 'view.laser', label: 'laser.cmd', group: 'view', icon: 'laser', keys: ['Mod+Alt+L'],
        keywords: t('laser.kw'), help: 'laser.help',
        when: function () { return hasMap() || on; },
        checked: function () { return on; },
        run: function () { toggle(); return true; }
      });
    }
    /* Another map, the board, or no map at all: the laser goes off. */
    if (ns.bus) {
      ns.bus.on('board', function (e) { if (e && e.open) toggle(false); });
      ns.bus.on('store', function () { if (on && !hasMap()) toggle(false); });
    }
  }

  ns.laser = { init: init, toggle: toggle, isOn: function () { return on; } };
})(window.MindRoot);
