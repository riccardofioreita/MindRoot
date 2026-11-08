/* MindRoot - the colour picker.
 *
 * What it offers, in the order people reach for it: the seven colours of the
 * branch palette, the colours picked lately, "automatic" (back to the
 * palette's choice), a colour drawn at random, and - folded away until asked
 * for - a custom colour: a saturation/brightness area, a hue rail, and the
 * colour written as hex and as rgb, both fields taking whatever is pasted
 * into them ('#abc', 'rgb(1, 2, 3)', '1 2 3', 'hsl(150 45% 34%)') and both
 * with a copy button. The dice switch for new nodes lives here too: it is a
 * preference (prefs.diceColors) the editor reads when a node is made.
 *
 * The picker writes nothing. open(anchor, {color, onPick, onAuto}) hands the
 * chosen colour to whoever asked, once per gesture: dragging on the area
 * previews in the panel only, and the colour is given when the finger comes
 * off (a keyboard step gives it at once; callers coalesce those steps).
 *
 * A solid surface, never glass: a tint behind the swatches would change the
 * colours being chosen. Under its anchor (flipping above when there is no
 * room), clamped to the window, draggable by its head; a bottom sheet on a
 * phone. Escape, a tap outside, or the anchor's owner closing it ends it.
 *
 *   open(anchor: Element | {left, top, right, bottom}, opts) -> handle
 *     opts: color, onPick(hex), onAuto(), onClose(), title, owner
 *   close(), isOpen(), owner(), element
 *   recent() -> [hex]   the colours picked lately (prefs.recentColors) */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var RECENT_MAX = 8;
  var COPIED_MS = 1200;      // how long a copy button says "copied"

  var STRINGS = {
    en: {
      'colorpicker.title': 'Colour',
      'colorpicker.close': 'Close',
      'colorpicker.palette': 'Palette',
      'colorpicker.recent': 'Recent',
      'colorpicker.auto': 'Automatic',
      'colorpicker.autoHint': 'The colour the palette gives this branch',
      'colorpicker.random': 'Random colour',
      'colorpicker.dice': 'Random colour for new nodes',
      'colorpicker.custom': 'Custom',
      'colorpicker.area': 'Saturation and brightness',
      'colorpicker.areaValue': 'Saturation {s}%, brightness {v}%',
      'colorpicker.hue': 'Hue',
      'colorpicker.hex': 'Hex',
      'colorpicker.rgb': 'RGB',
      'colorpicker.copy': 'Copy {what}',
      'colorpicker.copied': 'Copied',
      'colorpicker.invalid': 'Not a colour: {text}',
      'colorpicker.current': 'Current colour {hex}',
      'colorpicker.name.0': 'Green',
      'colorpicker.name.1': 'Orange',
      'colorpicker.name.2': 'Blue',
      'colorpicker.name.3': 'Rose',
      'colorpicker.name.4': 'Olive',
      'colorpicker.name.5': 'Ochre',
      'colorpicker.name.6': 'Teal'
    },
    it: {
      'colorpicker.title': 'Colore',
      'colorpicker.close': 'Chiudi',
      'colorpicker.palette': 'Tavolozza',
      'colorpicker.recent': 'Recenti',
      'colorpicker.auto': 'Automatico',
      'colorpicker.autoHint': 'Il colore che la tavolozza dà a questo ramo',
      'colorpicker.random': 'Colore a caso',
      'colorpicker.dice': 'Colore a caso per i nuovi nodi',
      'colorpicker.custom': 'Personalizzato',
      'colorpicker.area': 'Saturazione e luminosità',
      'colorpicker.areaValue': 'Saturazione {s}%, luminosità {v}%',
      'colorpicker.hue': 'Tinta',
      'colorpicker.hex': 'Hex',
      'colorpicker.rgb': 'RGB',
      'colorpicker.copy': 'Copia {what}',
      'colorpicker.copied': 'Copiato',
      'colorpicker.invalid': 'Non è un colore: {text}',
      'colorpicker.current': 'Colore attuale {hex}',
      'colorpicker.name.0': 'Verde',
      'colorpicker.name.1': 'Arancio',
      'colorpicker.name.2': 'Blu',
      'colorpicker.name.3': 'Rosa',
      'colorpicker.name.4': 'Oliva',
      'colorpicker.name.5': 'Ocra',
      'colorpicker.name.6': 'Verde acqua'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  if (ns.prefs && typeof ns.prefs.define === 'function') ns.prefs.define('recentColors', [], { free: true });

  var panel = null;
  var el = {};
  var session = null;        // { anchor, onPick, onAuto, onClose, owner, sheet, popEsc, returnFocus }
  var hsv = { h: 0, s: 0, v: 0 };
  var dragging = null;       // the rail a pointer holds
  var customOpen = false;
  var ready = false;

  function C() { return ns.colors; }
  function h() { return ns.util.h.apply(null, arguments); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* The picker colours the open map: when the map cannot be written (view
   * only, another tab holding it) there is nothing it can do. */
  function locked() {
    try { return !!(ns.session && typeof ns.session.readOnly === 'function' && ns.session.readOnly()); } catch (err) { return false; }
  }

  function palette() { return C() && C().PALETTE ? C().PALETTE : []; }

  function hexNow() { return C().fromHsv(hsv); }

  function compact() {
    if (ns.ui && typeof ns.ui.useSheets === 'function') return ns.ui.useSheets();
    return window.innerWidth < 640;
  }

  function recent() {
    var list = ns.prefs ? ns.prefs.get('recentColors') : [];
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < RECENT_MAX; i++) {
      var hex = C() ? C().normalizeHex(list[i]) : null;
      if (hex && out.indexOf(hex) < 0) out.push(hex);
    }
    return out;
  }

  /* The palette is always on show, so only colours outside it are worth a
   * place among the recent ones; and one opening of the picker leaves one
   * colour there, the last it gave (a drag or a run of arrow keys passes
   * through many on the way). */
  function remember(hex) {
    if (!ns.prefs || !hex || !session) return;
    var list = recent().filter(function (x) { return x !== hex && x !== session.remembered; });
    if (palette().indexOf(hex) >= 0) {
      session.remembered = null;
    } else {
      list.unshift(hex);
      session.remembered = hex;
    }
    ns.prefs.set('recentColors', list.slice(0, RECENT_MAX));
  }

  /* ---------------------------------------------------------------- building */

  function chip(hex, label, onPick) {
    var b = h('button', { type: 'button', class: 'cp-chip', 'aria-label': label, 'data-hex': hex, style: { '--chip': hex } });
    b.addEventListener('click', function () { onPick(hex); });
    if (ns.ui && ns.ui.tooltip) ns.ui.tooltip(b, label);
    return b;
  }

  function build() {
    panel = h('div', {
      class: 'colorpicker',
      role: 'dialog',
      tabindex: '-1',
      'aria-label': t('colorpicker.title'),
      hidden: true
    });
    el.head = h('div', { class: 'colorpicker__head' });
    el.grip = h('span', { class: 'bar-grip', 'aria-hidden': 'true' });
    el.grip.appendChild(ns.ui.icon('drag-grip'));
    el.title = h('span', { class: 'colorpicker__title', text: t('colorpicker.title') });
    el.sample = h('span', { class: 'colorpicker__sample', role: 'img' });
    el.close = ns.ui.button({ icon: 'close', label: t('colorpicker.close'), tooltip: false, onClick: function () { close(); } });
    el.head.appendChild(el.grip);
    el.head.appendChild(el.sample);
    el.head.appendChild(el.title);
    el.head.appendChild(el.close);

    /* A panel with the keys in it keeps them: Tab past its last control
     * would drop them on the page, where the next key edits the map. */
    if (ns.ui.trapTab) ns.ui.trapTab(panel);
    el.palette = h('div', { class: 'cp-row cp-palette', role: 'group', 'aria-label': t('colorpicker.palette') });
    el.recentLabel = h('div', { class: 'cp-label', text: t('colorpicker.recent') });
    el.recent = h('div', { class: 'cp-row cp-recent', role: 'group', 'aria-label': t('colorpicker.recent') });

    el.actions = h('div', { class: 'cp-actions' });
    el.auto = ns.ui.button({ icon: 'reload', label: t('colorpicker.auto'), kind: 'text', title: t('colorpicker.autoHint'), onClick: function () { auto(); } });
    el.random = ns.ui.button({ icon: 'dice', label: t('colorpicker.random'), kind: 'text', onClick: function () { pick(C().randomColor()); } });
    el.actions.appendChild(el.auto);
    el.actions.appendChild(el.random);

    el.diceRow = h('label', { class: 'cp-switch-row' });
    el.dice = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-label': t('colorpicker.dice') });
    el.dice.addEventListener('click', function () {
      /* The same rule as node.dice: nothing about making nodes changes in
       * view-only. */
      if (ns.prefs && !locked()) ns.prefs.set('diceColors', !ns.prefs.get('diceColors'));
      syncDice();
    });
    el.diceText = h('span', { class: 'cp-switch-text', text: t('colorpicker.dice') });
    el.diceRow.appendChild(el.diceText);
    el.diceRow.appendChild(el.dice);

    el.customToggle = ns.ui.button({ icon: 'chevron-down', label: t('colorpicker.custom'), kind: 'text', cls: 'cp-custom-toggle', onClick: function () { setCustom(!customOpen, true); } });
    el.customToggle.setAttribute('aria-expanded', 'false');
    el.custom = h('div', { class: 'cp-custom', hidden: true });
    el.customToggle.setAttribute('aria-controls', el.custom.id = ns.util.uid('cp-custom'));

    el.area = h('div', { class: 'cp-area', role: 'slider', tabindex: '0', 'aria-label': t('colorpicker.area'), 'aria-valuemin': '0', 'aria-valuemax': '100' });
    el.areaThumb = h('span', { class: 'cp-thumb', 'aria-hidden': 'true' });
    el.area.appendChild(el.areaThumb);
    el.hue = h('div', { class: 'cp-hue', role: 'slider', tabindex: '0', 'aria-label': t('colorpicker.hue'), 'aria-valuemin': '0', 'aria-valuemax': '359', 'aria-orientation': 'horizontal' });
    el.hueThumb = h('span', { class: 'cp-thumb', 'aria-hidden': 'true' });
    el.hue.appendChild(el.hueThumb);

    el.hex = h('input', { class: 'input cp-field', type: 'text', inputmode: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('colorpicker.hex') });
    el.rgb = h('input', { class: 'input cp-field', type: 'text', inputmode: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('colorpicker.rgb') });
    el.copyHex = copyButton(el.hex, t('colorpicker.hex'));
    el.copyRgb = copyButton(el.rgb, t('colorpicker.rgb'));
    el.status = h('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
    var fields = h('div', { class: 'cp-fields' },
      h('label', { class: 'cp-field-row' }, h('span', { class: 'cp-field-label', text: t('colorpicker.hex') }), el.hex, el.copyHex),
      h('label', { class: 'cp-field-row' }, h('span', { class: 'cp-field-label', text: t('colorpicker.rgb') }), el.rgb, el.copyRgb));
    el.custom.appendChild(el.area);
    el.custom.appendChild(el.hue);
    el.custom.appendChild(fields);

    panel.appendChild(el.head);
    panel.appendChild(el.palette);
    panel.appendChild(el.recentLabel);
    panel.appendChild(el.recent);
    panel.appendChild(el.actions);
    panel.appendChild(el.customToggle);
    panel.appendChild(el.custom);
    panel.appendChild(el.diceRow);
    panel.appendChild(el.status);
    buildPalette();

    bindRail(el.area, function (x, y) { hsv.s = x; hsv.v = 1 - y; show(); });
    bindRail(el.hue, function (x) { hsv.h = x * 359.999; show(); });
    el.area.addEventListener('keydown', function (e) { railKey(e, 'area'); });
    el.hue.addEventListener('keydown', function (e) { railKey(e, 'hue'); });
    [el.hex, el.rgb].forEach(function (f) {
      f.addEventListener('change', function () { commitField(f); });
      f.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitField(f); }
        if (e.key !== 'Escape' && !(e.ctrlKey || e.metaKey)) e.stopPropagation();
      });
      f.addEventListener('focus', function () { try { f.select(); } catch (err) { /* nothing to select */ } });
      f.addEventListener('paste', function (e) {
        /* A pasted colour is taken at once, whatever its form. */
        var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        var hex = text ? C().parseColor(text) : null;
        if (!hex) return;
        e.preventDefault();
        setFrom(hex);
        commit(hex);
      });
    });
    var floaters = document.getElementById('floaters') || document.body;
    floaters.appendChild(panel);
    if (ns.float) {
      ns.float.attach(panel, el.grip);
      ns.float.onAnchor(panel, place);
    }
  }

  function copyButton(field, what) {
    var b = ns.ui.button({ icon: 'copy', label: t('colorpicker.copy', { what: what }), onClick: function () { copy(field, b); } });
    b.classList.add('cp-copy');
    return b;
  }

  /* The palette's row is written once per build (it never changes); the
   * recent row whenever a pick changes it. One Tab stop per row of
   * swatches; the arrows move along it. */
  function buildPalette() {
    el.palette.textContent = '';
    palette().forEach(function (hex, i) {
      el.palette.appendChild(chip(hex, t('colorpicker.name.' + i) + ' ' + hex, pick));
    });
    if (!el.rovingPalette && ns.ui.roving) el.rovingPalette = ns.ui.roving(el.palette, { selector: '.cp-chip' });
    if (el.rovingPalette) el.rovingPalette.refresh();
  }

  /* A swatch rebuilt under the focus would leave the focus on the page, where
   * the next key acts on the map behind the open picker: the focus goes to
   * the same colour in the new row, else stays in the panel. */
  function buildRecent() {
    var active = document.activeElement;
    var hadFocus = !!(active && el.recent.contains(active));
    var focusHex = hadFocus ? active.getAttribute('data-hex') : null;
    var list = recent();
    el.recent.textContent = '';
    list.forEach(function (hex) { el.recent.appendChild(chip(hex, hex, pick)); });
    el.recent.hidden = !list.length;
    el.recentLabel.hidden = !list.length;
    if (!el.rovingRecent && ns.ui.roving) el.rovingRecent = ns.ui.roving(el.recent, { selector: '.cp-chip' });
    if (el.rovingRecent) el.rovingRecent.refresh();
    if (hadFocus) {
      var again = focusHex ? el.recent.querySelector('.cp-chip[data-hex="' + focusHex + '"]') : null;
      try { (again || el.palette.querySelector('.cp-chip[tabindex="0"]') || panel).focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
    }
  }

  /* ---------------------------------------------------------------- the area and the rail */

  /* A rail is anything pointed at: the area and the hue strip differ only in
   * what they make of the two numbers. The colour shows live in the panel;
   * whoever asked hears of it when the pointer comes off. */
  function bindRail(rail, report) {
    var box = null;
    function at(e) {
      report(clamp((e.clientX - box.left) / box.width, 0, 1), clamp((e.clientY - box.top) / box.height, 0, 1));
    }
    rail.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.preventDefault();
      box = rail.getBoundingClientRect();
      dragging = { rail: rail, id: e.pointerId };
      try { rail.setPointerCapture(e.pointerId); } catch (err) { /* follows while over the rail */ }
      try { rail.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
      at(e);
    });
    rail.addEventListener('pointermove', function (e) {
      if (!dragging || dragging.rail !== rail || dragging.id !== e.pointerId) return;
      at(e);
    });
    function release(e) {
      if (!dragging || dragging.rail !== rail || (e && dragging.id !== e.pointerId)) return;
      dragging = null;
      commit(hexNow());
    }
    rail.addEventListener('pointerup', release);
    rail.addEventListener('pointercancel', release);
    rail.addEventListener('lostpointercapture', release);
    if (ns.ui && ns.ui.ownTouches) ns.ui.ownTouches(rail);
  }

  /* Arrows move by 1%, with Shift by 10%; Home and End go to the ends. */
  function railKey(e, which) {
    var step = e.shiftKey ? 0.1 : 0.01;
    var handled = true;
    if (which === 'hue') {
      var hstep = e.shiftKey ? 15 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') hsv.h = (hsv.h + hstep) % 360;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') hsv.h = (hsv.h - hstep + 360) % 360;
      else if (e.key === 'Home') hsv.h = 0;
      else if (e.key === 'End') hsv.h = 359;
      else handled = false;
    } else {
      if (e.key === 'ArrowRight') hsv.s = clamp(hsv.s + step, 0, 1);
      else if (e.key === 'ArrowLeft') hsv.s = clamp(hsv.s - step, 0, 1);
      else if (e.key === 'ArrowUp') hsv.v = clamp(hsv.v + step, 0, 1);
      else if (e.key === 'ArrowDown') hsv.v = clamp(hsv.v - step, 0, 1);
      else if (e.key === 'Home') hsv.s = 0;
      else if (e.key === 'End') hsv.s = 1;
      else handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    show();
    commit(hexNow());
  }

  /* ---------------------------------------------------------------- showing one colour everywhere */

  function setFrom(hex) {
    var v = C().hsv(hex);
    if (!v) return;
    /* A grey has no hue of its own: the rail stays where it was. */
    if (!v.s) v.h = hsv.h;
    hsv = v;
    show(hex);
  }

  function show(given) {
    var hex = given || hexNow();
    var pure = C().fromHsv({ h: hsv.h, s: 1, v: 1 });
    el.area.style.setProperty('--hue', pure);
    el.areaThumb.style.left = (hsv.s * 100) + '%';
    el.areaThumb.style.top = ((1 - hsv.v) * 100) + '%';
    el.areaThumb.style.setProperty('--chip', hex);
    el.hueThumb.style.left = (hsv.h / 360 * 100) + '%';
    el.hueThumb.style.setProperty('--chip', pure);
    el.sample.style.setProperty('--chip', hex);
    el.sample.setAttribute('aria-label', t('colorpicker.current', { hex: hex }));
    el.area.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
    el.area.setAttribute('aria-valuetext', t('colorpicker.areaValue', { s: Math.round(hsv.s * 100), v: Math.round(hsv.v * 100) }));
    el.hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    if (document.activeElement !== el.hex) el.hex.value = hex;
    if (document.activeElement !== el.rgb) el.rgb.value = C().rgbText(hex);
    el.hex.removeAttribute('aria-invalid');
    el.rgb.removeAttribute('aria-invalid');
    markChips(hex);
  }

  /* The current colour shows pressed, and is where Tab lands in its row. */
  function markChips(hex) {
    [el.palette, el.recent].forEach(function (row) {
      if (!row) return;
      var chips = row.querySelectorAll('.cp-chip');
      var hit = null;
      Array.prototype.forEach.call(chips, function (b) {
        var on = b.getAttribute('data-hex') === hex;
        b.setAttribute('aria-pressed', String(on));
        if (on) hit = b;
      });
      if (hit) Array.prototype.forEach.call(chips, function (b) { b.tabIndex = b === hit ? 0 : -1; });
    });
  }

  function syncDice() {
    var on = !!(ns.prefs && ns.prefs.get('diceColors'));
    el.dice.setAttribute('aria-checked', String(on));
  }

  function setCustom(open, focus) {
    customOpen = !!open;
    el.custom.hidden = !customOpen;
    el.customToggle.setAttribute('aria-expanded', String(customOpen));
    var use = el.customToggle.querySelector('use');
    if (use) use.setAttribute('href', customOpen ? '#i-chevron-up' : '#i-chevron-down');
    if (session && session.sheet && session.sheet.refit) session.sheet.refit();
    else place();
    if (customOpen && focus) try { el.area.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
  }

  /* ---------------------------------------------------------------- choosing */

  function commit(hex) {
    var clean = C().normalizeHex(hex);
    if (!clean || !session) return;
    remember(clean);
    if (typeof session.onPick === 'function') session.onPick(clean);
  }

  function pick(hex) {
    var clean = C().normalizeHex(hex);
    if (!clean) return;
    setFrom(clean);
    commit(clean);
    buildRecent();
    markChips(clean);
  }

  function auto() {
    if (!session) return;
    var fn = session.onAuto;
    close();
    if (typeof fn === 'function') fn();
  }

  function commitField(field) {
    var text = field.value;
    var hex = C().parseColor(text);
    if (!hex) {
      field.setAttribute('aria-invalid', 'true');
      el.status.textContent = t('colorpicker.invalid', { text: text });
      return;
    }
    setFrom(hex);
    if (document.activeElement === field) {
      /* What was typed is put back in the field's own form. */
      field.value = field === el.hex ? hex : C().rgbText(hex);
    }
    commit(hex);
  }

  /* file:// is not always a secure context, so the clipboard API may be
   * missing: the field itself is then selected and copied the old way. */
  function copy(field, button) {
    var text = field.value;
    function done() {
      button.setAttribute('data-copied', '');
      el.status.textContent = t('colorpicker.copied');
      setTimeout(function () { button.removeAttribute('data-copied'); }, COPIED_MS);
    }
    function legacy() {
      try {
        field.focus({ preventScroll: true });
        field.select();
        if (document.execCommand('copy')) done();
      } catch (err) { /* nothing else to try */ }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(done, legacy);
    } else {
      legacy();
    }
  }

  /* ---------------------------------------------------------------- open, place, close */

  function rectOf(anchor) {
    if (!anchor) return null;
    if (anchor.nodeType === 1) {
      /* An anchor that is not drawn any more (its bar stepped aside) has
       * no place to give: the last one it had stands. */
      if (!anchor.isConnected) return null;
      var r = anchor.getBoundingClientRect();
      return r.width || r.height ? r : null;
    }
    var left = anchor.left != null ? anchor.left : anchor.x;
    var top = anchor.top != null ? anchor.top : anchor.y;
    return { left: left, top: top, right: anchor.right != null ? anchor.right : left, bottom: anchor.bottom != null ? anchor.bottom : top };
  }

  /* Under the anchor, centred on it; above when there is no room below;
   * never off the window. Left alone once a hand has moved it. */
  function place() {
    if (!session || session.sheet || panel.hidden) return;
    if (ns.float && ns.float.moved(panel)) return;
    var r = rectOf(session.anchor) || session.lastRect;
    if (!r) return;
    session.lastRect = r;
    if (ns.ui && typeof ns.ui.position === 'function') {
      ns.ui.position(panel, r, { side: 'bottom', align: 'center', offset: 8 });
      return;
    }
    var w = panel.offsetWidth;
    var hgt = panel.offsetHeight;
    var left = clamp((r.left + r.right) / 2 - w / 2, 8, window.innerWidth - w - 8);
    var top = r.bottom + 8;
    if (top + hgt > window.innerHeight - 8) top = r.top - hgt - 8;
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(clamp(top, 8, window.innerHeight - hgt - 8)) + 'px';
  }

  function open(anchor, opts) {
    if (!ready) init();
    if (!ready) return null;
    opts = opts || {};
    if (session) close();
    var start = C().normalizeHex(opts.color) || palette()[0];
    session = {
      anchor: anchor || null,
      onPick: opts.onPick || null,
      onAuto: opts.onAuto || null,
      onClose: opts.onClose || null,
      owner: opts.owner || null,
      sheet: null,
      popEsc: null,
      lastRect: null,
      remembered: null,
      returnFocus: document.activeElement
    };
    el.title.textContent = opts.title || t('colorpicker.title');
    el.auto.hidden = typeof session.onAuto !== 'function';
    el.diceRow.hidden = opts.dice === false;
    hsv = C().hsv(start) || { h: 0, s: 0, v: 0 };
    buildRecent();
    syncDice();
    show(start);
    /* A colour outside the palette and the recent ones was made by hand:
     * the custom part opens on it. */
    var known = palette().indexOf(start) >= 0 || recent().indexOf(start) >= 0;
    setCustom(customOpen || (!known && !!opts.color), false);
    if (compact()) {
      var job = session;
      panel.hidden = false;
      panel.setAttribute('data-sheet', '');
      job.sheet = ns.ui.sheet({
        title: opts.title || t('colorpicker.title'),
        body: panel,
        cls: 'colorpicker-sheet',
        detents: ['content', 0.92],
        onClose: function () { if (session === job) end(); }
      });
    } else {
      panel.removeAttribute('data-sheet');
      var floaters = document.getElementById('floaters') || document.body;
      if (panel.parentNode !== floaters) floaters.appendChild(panel);
      if (ns.float) ns.float.anchor(panel);
      panel.hidden = false;
      place();
      if (ns.ui && ns.ui.escape) session.popEsc = ns.ui.escape.push(function () { close(); });
      var first = panel.querySelector('.cp-chip[aria-pressed="true"]') || panel.querySelector('.cp-chip');
      if (opts.focus !== false && first) try { first.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
    }
    return { close: close, element: panel };
  }

  function end() {
    var s = session;
    if (!s) return;
    session = null;
    dragging = null;
    if (s.popEsc) s.popEsc();
    var hadFocus = panel.contains(document.activeElement);
    panel.hidden = true;
    panel.removeAttribute('data-sheet');
    if (s.sheet) {
      /* The panel goes back home; the sheet that carried it is gone. */
      var floaters = document.getElementById('floaters') || document.body;
      floaters.appendChild(panel);
    }
    if (hadFocus && s.returnFocus && s.returnFocus.isConnected) {
      try { s.returnFocus.focus({ preventScroll: true }); } catch (err) { /* nowhere to go back to */ }
    }
    if (typeof s.onClose === 'function') s.onClose();
  }

  function close() {
    var s = session;
    if (!s) return;
    if (s.sheet) {
      var sh = s.sheet;
      s.sheet = null;
      end();
      try { sh.close('program'); } catch (err) { /* already closed */ }
      return;
    }
    end();
  }

  function isOpen() { return !!session; }
  function owner() { return session ? session.owner : null; }

  /* A press outside closes it (not one on the anchor, whose owner toggles,
   * and not while a rail is held). */
  function onDocPointerDown(e) {
    if (!session || session.sheet || dragging) return;
    var target = e.target;
    if (panel.contains(target)) return;
    var a = session.anchor;
    if (a && a.nodeType === 1 && a.contains(target)) return;
    close();
  }

  function init() {
    if (ready) return;
    if (!ns.ui || !ns.util || !ns.colors) return;
    ready = true;
    build();
    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener('resize', ns.util.throttleFrame(function () { place(); }));
    if (ns.prefs && ns.prefs.on) ns.prefs.on('diceColors', function () { if (session) syncDice(); });
    if (ns.bus) {
      /* Every word on the panel is written when it is built: a new language
       * builds it again (closed first), the listeners above stay. */
      ns.bus.on('lang', function () {
        if (session) close();
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        el = {};
        build();
      });
      ns.bus.on('map:opened', function () { if (session) close(); });
      /* View-only switched on, or the map taken by another tab, while it is
       * open: swatches that look live but change nothing are worse than no
       * picker. */
      ns.bus.on('prefs', function (d) { if (session && d && d.key === 'mode' && (d.value === 'view' || locked())) close(); });
      ns.bus.on('tabs', function () { if (session && locked()) close(); });
    }
  }

  ns.colorpicker = {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    owner: owner,
    recent: recent,
    get element() { return panel; }
  };
})(window.MindRoot);
