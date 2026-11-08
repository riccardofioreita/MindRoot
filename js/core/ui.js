/* MindRoot - the interface primitives every module builds with.
 *
 * Icons, buttons, menus (bottom sheets on phones), context menus, popovers,
 * tooltips, dialogs on native <dialog> (top layer, inert page, focus kept
 * inside), confirm and prompt, sheets with a grab pill and drag to dismiss,
 * one-at-a-time toasts, banners for persistent problems, and the Escape
 * stack that closes one layer per press. Plus ns.glass, the optional liquid
 * glass decoration.
 *
 * Decisions that shape the code:
 *   - A menu toggles on its anchor's click. The previous app closed menus on
 *     pointerdown outside and the click that followed on the anchor opened
 *     the menu again; here a pointerdown on the anchor is not "outside".
 *   - Layers go into #layers, or into the topmost open modal <dialog> when
 *     there is one: a modal makes the rest of the page inert, so a menu or a
 *     toast outside it could neither be clicked nor be heard.
 *   - Escape is one stack: whoever opens a layer pushes a closer and gets a
 *     pop function back. The handler is a document keydown listener in the
 *     bubble phase, so a field that handles Escape itself (clearing a search)
 *     calls preventDefault and keeps it. commands.handleKey consults the same
 *     stack, so either path closes exactly one layer.
 *   - On touch devices (and installed apps, which have no browser back
 *     button) the open sheets and dialogs hold one history entry, so
 *     Android's back gesture closes the top one instead of leaving the app.
 *   - Toasts are a manual popover where the engine has them: in the top
 *     layer, above a modal and outside any box that moves, yet inside the
 *     modal's subtree, so they are not inert while it is open.
 *   - Positions are computed by computePlacement(), a pure function (tested
 *     on its own): flip to the side with room, clamp inside the visual
 *     viewport minus the safe areas, and grow from the side facing the anchor. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  function t(key, vars) { return ns.i18n ? ns.i18n.t(key, vars) : key; }
  function noop() {}

  if (ns.i18n) {
    ns.i18n.add({
      en: {
        'ui.close': 'Close',
        'ui.cancel': 'Cancel',
        'ui.ok': 'OK',
        'ui.undo': 'Undo',
        'ui.undoMoved': 'Something else changed since then: use Undo one step at a time.',
        'ui.required': 'Write something first.',
        'ui.dismiss': 'Dismiss',
        'time.justNow': 'just now',
        'ui.menu': 'Menu',
        'ui.notifications': 'Notifications'
      },
      it: {
        'ui.close': 'Chiudi',
        'ui.cancel': 'Annulla',
        'ui.ok': 'OK',
        'ui.undo': 'Annulla',
        'ui.undoMoved': 'Nel frattempo è cambiato altro: usa Annulla un passo alla volta.',
        'ui.required': 'Scrivi qualcosa.',
        'ui.dismiss': 'Chiudi',
        'time.justNow': 'adesso',
        'ui.menu': 'Menu',
        'ui.notifications': 'Notifiche'
      }
    });
  }

  /* ================================================================ environment */

  function layersRoot() { return document.getElementById('layers') || document.body; }

  var modals = [];

  function isModal(d) {
    if (d.hasAttribute('data-modal')) return true;
    try { return d.matches(':modal'); } catch (err) { return false; }
  }

  /* The modal on top: ours are tracked in the order they opened (top-layer
   * order is not DOM order); a modal some other module opened is found by
   * asking the document. */
  function topModal() {
    for (var i = modals.length - 1; i >= 0; i--) {
      if (modals[i].isConnected && modals[i].open) return modals[i];
    }
    var open = document.querySelectorAll('dialog[open]');
    for (var j = open.length - 1; j >= 0; j--) if (isModal(open[j])) return open[j];
    return null;
  }

  function layerHost() { return topModal() || layersRoot(); }

  function isCompact() { return util.matches('(max-width: 639px)'); }
  /* Phones in either orientation present menus and sheets from the bottom. */
  function useSheets() { return isCompact() || (util.matches('(pointer: coarse)') && util.matches('(max-height: 480px)')); }
  function useHistory() { return util.isTouch || util.isStandalone; }

  var probe = null;
  function safeInsets() {
    if (!document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (!probe || !probe.isConnected) {
      probe = h('div', {
        'aria-hidden': 'true',
        style: {
          position: 'fixed', left: '0', top: '0', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none',
          paddingTop: 'env(safe-area-inset-top, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)'
        }
      });
      document.body.appendChild(probe);
    }
    var cs = getComputedStyle(probe);
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0
    };
  }

  /* What can be seen: the visual viewport (smaller than the layout one when
   * a phone keyboard is up), less the safe areas, less a margin. */
  function viewportBox(margin) {
    margin = margin == null ? 8 : margin;
    var vv = window.visualViewport;
    var s = safeInsets();
    var left = vv ? vv.offsetLeft : 0;
    var top = vv ? vv.offsetTop : 0;
    var width = vv ? vv.width : window.innerWidth;
    var height = vv ? vv.height : window.innerHeight;
    return {
      left: left + Math.max(margin, s.left),
      top: top + Math.max(margin, s.top),
      right: left + width - Math.max(margin, s.right),
      bottom: top + height - Math.max(margin, s.bottom)
    };
  }

  /* How long an element's exit transition takes, from its computed style. */
  function exitDuration(el) {
    var cs;
    try { cs = getComputedStyle(el); } catch (err) { return 0; }
    var durations = String(cs.transitionDuration || '0s').split(',');
    var delays = String(cs.transitionDelay || '0s').split(',');
    var max = 0;
    for (var i = 0; i < durations.length; i++) {
      var d = parseFloat(durations[i]) * (/ms/.test(durations[i]) ? 1 : 1000) || 0;
      var dl = parseFloat(delays[i % delays.length]) * (/ms/.test(delays[i % delays.length] || '') ? 1 : 1000) || 0;
      max = Math.max(max, d + dl);
    }
    return max;
  }

  /* Removes the element once its exit transition is over (it has already
   * been given [hidden] or lost [open]); a timeout covers engines and
   * states where no transitionend arrives. */
  function removeAfterExit(el, done) {
    var finished = false;
    var ms = exitDuration(el);
    function finish() {
      if (finished) return;
      finished = true;
      el.removeEventListener('transitionend', onEnd);
      el.removeEventListener('transitioncancel', onEnd);
      el.remove();
      if (done) done();
    }
    function onEnd(event) {
      if (event.target === el && /opacity|translate|display|overlay/.test(event.propertyName)) finish();
    }
    if (ms <= 2) { finish(); return; }
    el.addEventListener('transitionend', onEnd);
    el.addEventListener('transitioncancel', onEnd);
    setTimeout(finish, ms + 60);
  }

  /* Drawn means it has a box: offsetParent would also rule out anything
   * inside a fixed box, like the toast a dialog holds. */
  function drawn(el) { return el.getClientRects().length > 0; }

  function focusable(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('button, a[href], area[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'),
      function (el) { return !el.disabled && drawn(el) && !el.closest('[inert]'); }
    );
  }

  /* A modal keeps Tab inside itself. showModal() makes the page inert, but
   * Chromium lets Tab leave a dialog for the browser's own toolbar, and
   * from there the next Tab lands on nothing at all. */
  function trapTab(container) {
    container.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      var list = focusable(container);
      if (!list.length) { event.preventDefault(); return; }
      var first = list[0];
      var last = list[list.length - 1];
      var active = document.activeElement;
      var inside = container.contains(active) && active !== container;
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function restoreFocus(el) {
    if (el && el.isConnected && typeof el.focus === 'function' && !el.closest('[inert]')) {
      try { el.focus({ preventScroll: true }); } catch (err) { /* not focusable any more */ }
    }
  }

  /* ================================================================ icons, buttons */

  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function keysText(shortcut) {
    if (!shortcut) return '';
    if (ns.commands && ns.commands.keysLabel) return ns.commands.keysLabel(shortcut);
    return Array.isArray(shortcut) ? String(shortcut[0]) : String(shortcut);
  }

  /* kind 'icon' is a square button whose name lives in aria-label and in a
   * tooltip (with its shortcut); the other kinds show their label. */
  function button(opts) {
    opts = opts || {};
    var kind = opts.kind || (opts.label && !opts.icon ? 'text' : 'icon');
    var cls = ['btn', 'btn--' + kind];
    if (opts.cls) cls.push(opts.cls);
    var el = h('button', {
      type: 'button',
      id: opts.id || null,
      class: cls,
      disabled: !!opts.disabled,
      'aria-pressed': opts.pressed === undefined || opts.pressed === null ? null : String(!!opts.pressed),
      'data-command': opts.command || null
    });
    if (opts.icon) el.appendChild(icon(opts.icon));
    if (kind === 'icon') {
      el.setAttribute('aria-label', opts.label || opts.title || '');
      if (opts.tooltip !== false) tooltip(el, opts.title || opts.label || '', opts.shortcut);
    } else {
      el.appendChild(h('span', { class: 'btn__label', text: opts.label || '' }));
      if (opts.title || opts.shortcut) tooltip(el, opts.title || opts.label || '', opts.shortcut);
    }
    if (typeof opts.onClick === 'function') {
      el.addEventListener('click', function (event) {
        if (el.getAttribute('aria-disabled') === 'true') return;
        opts.onClick(event);
      });
    }
    return el;
  }

  /* ================================================================ placement */

  var OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

  /* size {w, h}, anchor {left, top, right, bottom}, box {left, top, right,
   * bottom}, opts {side, align, offset}. Returns {x, y, side, maxW, maxH,
   * originX, originY}: where the element's top-left goes, the side it ended
   * on, how much room it has, and the point it should grow from. */
  function computePlacement(size, anchor, box, opts) {
    opts = opts || {};
    var side = opts.side || 'bottom';
    var align = opts.align || 'start';
    var off = opts.offset == null ? 8 : opts.offset;
    var vertical = side === 'top' || side === 'bottom';
    var space = {
      top: anchor.top - box.top - off,
      bottom: box.bottom - anchor.bottom - off,
      left: anchor.left - box.left - off,
      right: box.right - anchor.right - off
    };
    var need = vertical ? size.h : size.w;
    if (space[side] < need && space[OPPOSITE[side]] > space[side]) side = OPPOSITE[side];
    vertical = side === 'top' || side === 'bottom';
    var avail = Math.max(0, space[side]);
    var w = size.w;
    var hgt = size.h;
    var x;
    var y;
    /* opts.shift (menus): a list too tall for either side but not for the
     * window slides up or down over its anchor and stays whole, rather than
     * being cut to the room on one side - the last rows of a node's menu are
     * the destructive ones, and a scroll hides them without a cue. */
    var shifted = vertical && opts.shift && avail < hgt && hgt <= box.bottom - box.top;
    if (vertical) {
      if (!shifted) hgt = Math.min(hgt, Math.max(avail, 0) || hgt);
      y = side === 'bottom' ? anchor.bottom + off : anchor.top - off - hgt;
      y = clampTo(y, box.top, box.bottom - hgt);
      if (align === 'end') x = anchor.right - w;
      else if (align === 'center') x = (anchor.left + anchor.right) / 2 - w / 2;
      else x = anchor.left;
      x = clampTo(x, box.left, box.right - w);
    } else {
      w = Math.min(w, Math.max(avail, 0) || w);
      x = side === 'right' ? anchor.right + off : anchor.left - off - w;
      x = clampTo(x, box.left, box.right - w);
      if (align === 'end') y = anchor.bottom - hgt;
      else if (align === 'center') y = (anchor.top + anchor.bottom) / 2 - hgt / 2;
      else y = anchor.top;
      y = clampTo(y, box.top, box.bottom - hgt);
    }
    var ax = (anchor.left + anchor.right) / 2;
    var ay = (anchor.top + anchor.bottom) / 2;
    var originX = vertical ? clampTo(ax - x, 0, w) : (side === 'right' ? 0 : w);
    var originY = vertical ? (side === 'bottom' ? 0 : hgt) : clampTo(ay - y, 0, hgt);
    return {
      x: Math.round(x),
      y: Math.round(y),
      side: side,
      maxW: vertical ? box.right - box.left : avail,
      maxH: vertical && !shifted ? avail : box.bottom - box.top,
      originX: Math.round(originX),
      originY: Math.round(originY)
    };
  }

  function clampTo(v, lo, hi) { return hi < lo ? lo : Math.max(lo, Math.min(hi, v)); }

  function rectOf(anchor) {
    if (!anchor) return null;
    if (typeof anchor.getBoundingClientRect === 'function') return anchor.getBoundingClientRect();
    if (anchor.x != null && anchor.left == null) return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
    return {
      left: anchor.left,
      top: anchor.top,
      right: anchor.right != null ? anchor.right : anchor.left + (anchor.width || 0),
      bottom: anchor.bottom != null ? anchor.bottom : anchor.top + (anchor.height || 0)
    };
  }

  /* Places a fixed element next to an anchor. Sizes come from offsetWidth and
   * offsetHeight, which ignore the entry scale, so the first frame of the
   * animation does not shrink the measurement. */
  function position(el, anchor, opts) {
    opts = opts || {};
    var rect = rectOf(anchor);
    if (!rect) return null;
    var box = viewportBox(opts.margin);
    el.style.removeProperty('--avail-h');
    el.style.left = '0px';
    el.style.top = '0px';
    var h0 = el.offsetHeight;
    var p = computePlacement({ w: el.offsetWidth, h: h0 }, rect, box, opts);
    el.style.setProperty('--avail-h', Math.max(64, Math.floor(p.maxH)) + 'px');
    /* The new cap changes the size - down to the room there is, or up from
     * the fallback cap it was measured under: measure again so the flip and
     * the clamp use what will really be drawn. */
    if (Math.abs(el.offsetHeight - h0) > 1) p = computePlacement({ w: el.offsetWidth, h: el.offsetHeight }, rect, box, opts);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.style.setProperty('--origin', p.originX + 'px ' + p.originY + 'px');
    el.setAttribute('data-side', p.side);
    return p;
  }

  /* ================================================================ escape stack */

  var escStack = [];

  /* fn returns false to stay open (a dialog that cannot be dismissed): the
   * press is still consumed, and the entry stays on the stack. */
  function escPush(fn) {
    var entry = { fn: fn };
    escStack.push(entry);
    return function pop() {
      var i = escStack.indexOf(entry);
      if (i >= 0) escStack.splice(i, 1);
    };
  }

  function escHandle(event) {
    if (!escStack.length) return false;
    var entry = escStack[escStack.length - 1];
    var keep = false;
    try { keep = entry.fn(event) === false; } catch (err) { setTimeout(function () { throw err; }, 0); }
    if (!keep) {
      var i = escStack.indexOf(entry);
      if (i >= 0) escStack.splice(i, 1);
    }
    return true;
  }

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (escHandle(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  var escape = {
    push: escPush,
    handle: escHandle,
    size: function size() { return escStack.length; }
  };

  /* ================================================================ back button */

  /* On touch devices and in installed apps the open sheets and dialogs hold
   * ONE history entry between them, so Android's back gesture (or an
   * installed app's back) closes the top layer instead of leaving the app.
   *
   * One entry for the whole stack, never a push and a back per layer:
   * history.back() is asynchronous, so a layer closing and another opening
   * in the same task (a menu row that opens a dialog) would have the queued
   * back undo the new layer's push, and closing that layer later would then
   * step out of the app. So the entry is pushed when the first layer opens.
   * When the last one closes, the entry is let go one task later, and a
   * layer opening before that inherits it as it is. A layer opening while
   * the browser is still going back pushes once the going back is over. A
   * back press closes the top layer; if layers remain open, the entry is
   * pushed again for the next press. Our entries carry {mindroot2Layer},
   * which is how a stale one (left by a reload) is recognised and reused. */

  var hist = { layers: [], onEntry: false, timer: 0, backing: false, guard: 0 };

  function isLayerState(state) { return !!(state && state.mindroot2Layer); }

  try { hist.onEntry = isLayerState(history.state); } catch (err) { hist.onEntry = false; }

  function historyEnsureEntry() {
    if (hist.onEntry || hist.backing || !hist.layers.length) return;
    try {
      history.pushState({ mindroot2Layer: true }, '');
      hist.onEntry = true;
    } catch (err) { /* a sandboxed frame: back simply is not ours */ }
  }

  function historyPush(close) {
    if (!useHistory()) return null;
    var token = { close: close, live: true };
    hist.layers.push(token);
    if (hist.timer) { clearTimeout(hist.timer); hist.timer = 0; }
    historyEnsureEntry();
    return token;
  }

  /* The layer closed by other means (Escape, a button, a choice). */
  function historyRelease(token) {
    if (!token || !token.live) return;
    token.live = false;
    var i = hist.layers.indexOf(token);
    if (i >= 0) hist.layers.splice(i, 1);
    if (!hist.layers.length && !hist.timer) hist.timer = setTimeout(historyLetGo, 0);
  }

  function historyLetGo() {
    hist.timer = 0;
    if (hist.layers.length || !hist.onEntry || hist.backing) return;
    hist.onEntry = false;
    /* Only our own entry is taken back: if something else is on top now,
     * going back would undo that instead. */
    var ours = false;
    try { ours = isLayerState(history.state); } catch (err) { ours = false; }
    if (!ours) return;
    hist.backing = true;
    /* A back that never arrives (the page is being left) must not leave
     * every later layer waiting to push. */
    hist.guard = setTimeout(historyBackDone, 2000);
    try { history.back(); } catch (err) { historyBackDone(); }
  }

  function historyBackDone() {
    clearTimeout(hist.guard);
    hist.guard = 0;
    hist.backing = false;
    historyEnsureEntry();
  }

  window.addEventListener('popstate', function (event) {
    hist.onEntry = isLayerState(event.state);
    if (hist.backing) { historyBackDone(); return; }
    var token = hist.layers.pop();
    if (token) {
      token.live = false;
      var kept = false;
      try { kept = token.close('back') === false; } catch (err) { setTimeout(function () { throw err; }, 0); }
      /* A layer that cannot be dismissed stays, and so does its entry. */
      if (kept) { token.live = true; hist.layers.push(token); }
    }
    historyEnsureEntry();
  });

  /* ================================================================ menus */

  var currentMenu = null;
  var typeahead = { text: '', at: 0 };

  /* How the person is driving right now. A menu opened from the keyboard
   * puts focus on its first row; one opened with a pointer focuses itself,
   * so no row looks chosen before the pointer reaches it (arrows still
   * start from the top). */
  var lastInput = 'pointer';
  document.addEventListener('pointerdown', function () { lastInput = 'pointer'; }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Meta') lastInput = 'key';
  }, true);

  function focusMenuStart(el, last) {
    var list = menuItems(el);
    if (lastInput === 'key' && list.length) focusItem(list, last ? -1 : 0);
    else {
      try { el.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
    }
  }

  function menuItems(el) {
    return Array.prototype.slice.call(el.querySelectorAll('.menu__item'));
  }

  /* Focus without letting the browser scroll anything (a fixed menu inside
   * a dialog could scroll the dialog); a long menu scrolls itself. */
  function focusItem(list, i) {
    if (!list.length) return;
    var item = list[(i + list.length) % list.length];
    try { item.focus({ preventScroll: true }); } catch (err) { item.focus(); }
    var box = item.parentNode;
    if (box && box.scrollHeight > box.clientHeight) {
      if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight;
    }
  }

  function menuKeydown(event, el) {
    var list = menuItems(el);
    var i = list.indexOf(document.activeElement);
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusItem(list, i + 1); return;
      case 'ArrowUp': event.preventDefault(); focusItem(list, i < 0 ? -1 : i - 1); return;
      case 'Home': event.preventDefault(); focusItem(list, 0); return;
      case 'End': event.preventDefault(); focusItem(list, -1); return;
      default: break;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      var now = Date.now();
      typeahead.text = (now - typeahead.at > 600 ? '' : typeahead.text) + event.key.toLowerCase();
      typeahead.at = now;
      for (var k = 1; k <= list.length; k++) {
        var cand = list[(Math.max(i, 0) + (typeahead.text.length > 1 ? k - 1 : k)) % list.length];
        var lab = (cand.querySelector('.menu__label') || cand).textContent.trim().toLowerCase();
        if (lab.indexOf(typeahead.text) === 0) { focusItem([cand], 0); event.preventDefault(); return; }
      }
    }
  }

  /* items: {label, icon, shortcut, danger, disabled, checked, radio,
   * onSelect, hint} | '-' | {heading} | null (skipped, so lists can be
   * written with conditions inline). */
  function buildMenu(items, pick, label) {
    var el = h('div', { class: 'menu', role: 'menu', tabindex: '-1', 'aria-label': label || null, 'aria-orientation': 'vertical' });
    var lastWasSep = true;
    (items || []).forEach(function (item) {
      if (!item) return;
      if (item === '-' || item.sep) {
        if (!lastWasSep) el.appendChild(h('div', { class: 'menu__sep', role: 'separator' }));
        lastWasSep = true;
        return;
      }
      if (item.heading) {
        el.appendChild(h('div', { class: 'menu__heading', role: 'presentation', text: item.heading }));
        lastWasSep = false;
        return;
      }
      var hasCheck = item.checked !== undefined && item.checked !== null;
      var role = hasCheck ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem';
      var shortcut = item.shortcut || item.keys;
      var row = h('button', {
        type: 'button',
        class: ['menu__item', item.danger && 'menu__item--danger'],
        role: role,
        tabindex: '-1',
        'aria-disabled': item.disabled ? 'true' : null,
        'aria-checked': hasCheck ? String(!!item.checked) : null,
        'aria-keyshortcuts': shortcut && ns.commands ? ns.commands.ariaKeys(shortcut) : null,
        title: item.hint || null
      });
      /* A toggle with an icon of its own keeps it, and says "on" with a
       * check at the end of the row; without one, the check leads. */
      if (item.icon) row.appendChild(icon(item.icon));
      else if (hasCheck) row.appendChild(icon('check', 'icon--check'));
      else row.appendChild(h('span', { 'aria-hidden': 'true' }));
      row.appendChild(h('span', { class: 'menu__label', text: item.label }));
      var hint = item.kbd || keysText(shortcut);
      var trailingCheck = hasCheck && item.icon;
      if (hint || trailingCheck) {
        var end = h('span', { class: 'menu__end', 'aria-hidden': 'true' });
        if (hint) end.appendChild(h('span', { class: 'menu__kbd', text: hint }));
        if (trailingCheck) end.appendChild(icon('check', 'icon--check menu__check'));
        row.appendChild(end);
      }
      row.addEventListener('click', function (event) {
        event.preventDefault();
        if (item.disabled) return;
        pick(item);
      });
      row.addEventListener('pointermove', function (event) {
        if (event.pointerType === 'mouse' && document.activeElement !== row) row.focus({ preventScroll: true });
      });
      el.appendChild(row);
      lastWasSep = false;
    });
    var lastChild = el.lastElementChild;
    if (lastChild && lastChild.classList.contains('menu__sep')) lastChild.remove();
    el.addEventListener('keydown', function (event) { menuKeydown(event, el); });
    return el;
  }

  function runItem(item) {
    if (typeof item.onSelect !== 'function') return;
    try {
      var r = item.onSelect();
      if (r && typeof r.then === 'function') r.then(null, reportError);
    } catch (err) {
      reportError(err);
    }
  }

  function reportError(err) {
    if (window.console) console.error(err);
    toast(t('commands.failed', { message: (err && err.message) || String(err) }), { kind: 'error' });
  }

  /* Opens a menu under (or over) its anchor. Called again with the same
   * anchor while open, it closes: that is the toggle. */
  function menu(anchor, items, opts) {
    opts = opts || {};
    if (currentMenu && anchor && currentMenu.anchor === anchor) {
      currentMenu.close({ restore: true });
      return { close: noop, el: null, closed: true };
    }
    if (currentMenu) currentMenu.close({ restore: false });
    /* A toast that only told something would lie over the menu's last rows
     * (the destructive ones): the menu is what the person turned to. */
    if (currentToast && !currentToast.action) currentToast.close();
    if (useSheets() && opts.sheet !== false) return menuSheet(anchor, items, opts);

    var handle = { anchor: anchor || null, el: null, close: null };
    var prevFocus = document.activeElement;
    var closed = false;
    var el = buildMenu(items, pick, opts.label || opts.title);
    el.classList.add('glass', 'glass--thick');
    handle.el = el;
    layerHost().appendChild(el);
    var placeAt = anchor || opts.rect;
    position(el, placeAt, { side: opts.side || 'bottom', align: opts.align || 'start', offset: opts.offset == null ? 6 : opts.offset, shift: true });
    if (anchor) {
      anchor.setAttribute('aria-expanded', 'true');
      if (!anchor.hasAttribute('aria-haspopup')) anchor.setAttribute('aria-haspopup', 'menu');
    }
    focusMenuStart(el, opts.focusLast);
    var popEsc = escPush(function () { close({ restore: true }); });

    function outside(event) {
      if (el.contains(event.target)) return;
      if (anchor && anchor.contains(event.target)) return;
      close({ restore: false });
    }
    function onKey(event) {
      if (event.key === 'Tab') close({ restore: true });
    }
    var lastWidth = window.innerWidth;
    function onResize() {
      if (window.innerWidth !== lastWidth) close({ restore: false });
      else position(el, anchor || opts.rect, { side: opts.side || 'bottom', align: opts.align || 'start', offset: opts.offset == null ? 6 : opts.offset, shift: true });
    }
    /* The anchor scrolled away from under the menu: close. A scroll of
     * something that holds the menu too (its own dialog) moves nothing. */
    function onScroll(event) {
      var target = event.target;
      if (!anchor || !target || !target.contains || target.contains(el)) return;
      if (target.contains(anchor)) close({ restore: false });
    }
    document.addEventListener('pointerdown', outside, true);
    el.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    /* Rows can grow after the first placement (a label or a count filled
     * in late): placed again, a menu that opens upwards - from the dock at
     * the foot of the map - keeps its foot by its anchor, whole on screen. */
    var lastH = el.offsetHeight;
    var sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(function () {
      if (closed || el.offsetHeight === lastH) return;
      lastH = el.offsetHeight;
      position(el, anchor || opts.rect, { side: opts.side || 'bottom', align: opts.align || 'start', offset: opts.offset == null ? 6 : opts.offset, shift: true });
    }) : null;
    if (sizeWatch) sizeWatch.observe(el);

    function close(o) {
      if (closed) return;
      closed = true;
      o = o || {};
      if (sizeWatch) sizeWatch.disconnect();
      popEsc();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, true);
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      if (currentMenu === handle) currentMenu = null;
      var hadFocus = el.contains(document.activeElement);
      el.hidden = true;
      removeAfterExit(el);
      if (o.restore !== false && hadFocus) restoreFocus(anchor || prevFocus);
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    function pick(item) {
      close({ restore: true });
      runItem(item);
    }
    handle.close = close;
    currentMenu = handle;
    return handle;
  }

  function menuSheet(anchor, items, opts) {
    var handle = { anchor: anchor || null, el: null, close: null };
    var list = buildMenu(items, pick, opts.label || opts.title || t('ui.menu'));
    list.classList.add('menu--sheet');
    var s = sheet({
      title: opts.title || '',
      label: opts.label || opts.title || t('ui.menu'),
      body: list,
      cls: 'sheet--menu',
      place: 'bottom',
      onClose: function () {
        if (anchor) anchor.setAttribute('aria-expanded', 'false');
        if (currentMenu === handle) currentMenu = null;
        if (typeof opts.onClose === 'function') opts.onClose();
      }
    });
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    focusMenuStart(list, false);
    function pick(item) {
      s.close('select');
      runItem(item);
    }
    handle.el = s.el;
    handle.close = function () { s.close('menu'); };
    currentMenu = handle;
    return handle;
  }

  function contextMenu(point, items, opts) {
    opts = opts || {};
    var x = point.x != null ? point.x : point.clientX;
    var y = point.y != null ? point.y : point.clientY;
    return menu(null, items, {
      rect: { left: x, top: y, right: x, bottom: y },
      side: 'bottom',
      align: 'start',
      offset: 2,
      title: opts.title,
      label: opts.label,
      onClose: opts.onClose
    });
  }

  /* ================================================================ popover */

  var popovers = [];

  function popover(anchor, content, opts) {
    opts = opts || {};
    var dismiss = opts.dismiss !== false;
    var el = h('div', {
      class: ['popover', opts.glass && 'glass glass--thick', opts.cls],
      role: opts.role || 'dialog',
      'aria-label': opts.label || null
    }, content);
    var prevFocus = document.activeElement;
    layerHost().appendChild(el);
    var closed = false;
    var popEsc = dismiss ? escPush(function () { close(); }) : noop;
    var anchorEl = anchor && anchor.nodeType === 1 ? anchor : null;
    var lastRect = rectOf(anchor);
    function update(next) {
      if (closed) return;
      if (next) { anchorEl = next.nodeType === 1 ? next : null; lastRect = rectOf(next); }
      if (anchorEl && anchorEl.isConnected) lastRect = anchorEl.getBoundingClientRect();
      position(el, lastRect, { side: opts.side || 'bottom', align: opts.align || 'start', offset: opts.offset == null ? 8 : opts.offset, margin: opts.margin });
    }
    function outside(event) {
      if (el.contains(event.target)) return;
      if (anchorEl && anchorEl.contains(event.target)) return;
      close();
    }
    var onResize = util.throttleFrame(function () { update(); });
    if (dismiss) document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    function close() {
      if (closed) return;
      closed = true;
      popEsc();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
      var i = popovers.indexOf(handle);
      if (i >= 0) popovers.splice(i, 1);
      var hadFocus = el.contains(document.activeElement);
      el.hidden = true;
      removeAfterExit(el);
      if (hadFocus) restoreFocus(anchorEl || prevFocus);
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    update();
    if (opts.focus) {
      var f = focusable(el);
      if (f.length) f[0].focus({ preventScroll: true });
    }
    var handle = { el: el, close: close, update: update, dismiss: dismiss };
    popovers.push(handle);
    return handle;
  }

  /* ================================================================ tooltips */

  var tip = null;
  var tipOwner = null;
  var tipTimer = 0;
  var tipHiddenAt = 0;
  var WARM = 1000;
  var DELAY = 500;

  function hoverCapable() { return util.matches('(hover: hover) and (pointer: fine)'); }

  /* What the person used last: a key, or a pointer (finger, pen, mouse). */
  var lastInput = 'none';
  document.addEventListener('keydown', function () { lastInput = 'key'; }, true);
  document.addEventListener('pointerdown', function () { lastInput = 'pointer'; }, true);

  function tipElement() {
    var host = layerHost();
    if (!tip) tip = h('div', { class: 'tooltip', role: 'tooltip', id: 'mr-tooltip', hidden: true });
    if (tip.parentNode !== host) host.appendChild(tip);
    return tip;
  }

  /* An owner removed or hidden while its tooltip shows (a bar re-rendered,
   * a panel closed) gets no pointerleave: check while one is visible. */
  var tipWatch = 0;
  function tipWatchStart() {
    if (tipWatch) return;
    tipWatch = setInterval(function () {
      if (!tipOwner || !tipOwner.isConnected || tipOwner.getClientRects().length === 0 || tipOwner.closest('[inert]')) tipHide(null);
      if (!tipOwner) { clearInterval(tipWatch); tipWatch = 0; }
    }, 400);
  }

  function tipShow(el, instant) {
    tipTimer = 0;
    var rec = el.__mrTip;
    if (!rec || !el.isConnected || !rec.text) return;
    var node = tipElement();
    node.textContent = '';
    node.appendChild(h('span', { text: rec.text }));
    var keys = keysText(rec.shortcut);
    if (keys) node.appendChild(h('span', { class: 'kbd', text: keys }));
    node.toggleAttribute('data-instant', !!instant);
    node.hidden = false;
    var r = el.getBoundingClientRect();
    var lower = r.top > (window.innerHeight * 0.6);
    position(node, r, { side: lower ? 'top' : 'bottom', align: 'center', offset: 6, margin: 6 });
    tipOwner = el;
    tipWatchStart();
  }

  function tipHide(el) {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = 0; }
    if (el && tipOwner !== el) return;
    if (tip && !tip.hidden) {
      tip.hidden = true;
      tipHiddenAt = Date.now();
    }
    tipOwner = null;
  }

  function tipSchedule(el) {
    if (tipTimer) clearTimeout(tipTimer);
    var warm = Date.now() - tipHiddenAt < WARM || (tipOwner && tipOwner !== el);
    if (warm) { tipShow(el, true); return; }
    tipTimer = setTimeout(function () { tipShow(el, false); }, DELAY);
  }

  /* Touch never shows tooltips (a long-press there is a context menu), and
   * the name of an icon button is in its aria-label already, so the tooltip
   * adds the shortcut for sighted mouse and keyboard users. */
  function tooltip(el, text, shortcut) {
    if (!el) return null;
    var rec = el.__mrTip;
    if (rec) {
      rec.text = text || '';
      rec.shortcut = shortcut;
      applyTipAria(el, rec);
      if (tipOwner === el) tipShow(el, true);
      return rec.handle;
    }
    rec = el.__mrTip = { text: text || '', shortcut: shortcut };
    applyTipAria(el, rec);
    function enter(event) {
      if (event.pointerType === 'touch' || !hoverCapable()) return;
      tipSchedule(el);
    }
    function leave() { tipHide(el); }
    function focus() {
      var visible = false;
      try { visible = el.matches(':focus-visible'); } catch (err) { visible = false; }
      /* On a touch screen the browser may call a focus moved by code
       * "visible" because a key was pressed once, long ago; the tip (a
       * shortcut) is for a person at a keyboard now. */
      if (visible && (hoverCapable() || lastInput === 'key')) tipSchedule(el);
    }
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', leave);
    el.addEventListener('focus', focus);
    el.addEventListener('blur', leave);
    rec.handle = {
      update: function (nextText, nextShortcut) { tooltip(el, nextText, nextShortcut === undefined ? rec.shortcut : nextShortcut); },
      destroy: function () {
        tipHide(el);
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
        el.removeEventListener('pointerdown', leave);
        el.removeEventListener('focus', focus);
        el.removeEventListener('blur', leave);
        el.__mrTip = null;
      }
    };
    return rec.handle;
  }

  function applyTipAria(el, rec) {
    if (rec.shortcut && ns.commands) el.setAttribute('aria-keyshortcuts', ns.commands.ariaKeys(rec.shortcut));
    else el.removeAttribute('aria-keyshortcuts');
  }

  /* WCAG 1.4.13: a tooltip can be dismissed without moving pointer or focus. */
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && tipOwner) tipHide(null);
  }, true);
  document.addEventListener('scroll', function () { if (tipOwner) tipHide(null); }, true);

  /* ================================================================ dialogs */

  function trackModal(dlg) { modals.push(dlg); }
  function untrackModal(dlg) {
    var i = modals.indexOf(dlg);
    if (i >= 0) modals.splice(i, 1);
  }

  /* A press on the ::backdrop targets the dialog element itself, and so
   * does one on the dialog's own padding (a sheet's safe-area inset): only
   * a point outside the dialog's box is the scrim. */
  function onScrim(event, dlg) {
    if (event.target !== dlg) return false;
    var r = dlg.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }

  /* A toast shown while a dialog was open lives inside it; when the dialog
   * goes, the toast moves back to #layers instead of vanishing with it. */
  function rescueLayers(dlg) {
    /* A menu or popover opened inside it goes with it, Escape entry and
     * listeners included (the back gesture closes a sheet under its menu). */
    if (currentMenu && currentMenu.el && dlg.contains(currentMenu.el)) currentMenu.close({ restore: false });
    popovers.slice().forEach(function (p) { if (dlg.contains(p.el)) p.close(); });
    var stray = dlg.querySelectorAll(':scope > .toasts, :scope > .tooltip');
    for (var i = 0; i < stray.length; i++) {
      if (stray[i].classList.contains('toasts')) {
        var toasts = stray[i].querySelectorAll('.toast:not([hidden])');
        var host = topModal();
        var target = toastRegion(host && host !== dlg ? host : layersRoot());
        for (var j = 0; j < toasts.length; j++) moveToast(toasts[j], target);
        stray[i].remove();
      } else if (stray[i] === tip) {
        tipHide(null);
        layersRoot().appendChild(tip);
      }
    }
  }

  /* Native <dialog>: top layer, an inert page behind, focus kept inside and
   * given back to where it was. Resolves with the value of the chosen action,
   * or null when dismissed (Escape, the close button, a press on the scrim,
   * Android back). */
  function dialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var dismissable = opts.dismissable !== false;
      var titleId = util.uid('dlg-t');
      var textId = util.uid('dlg-d');
      var actions = opts.actions && opts.actions.length ? opts.actions : [{ label: t('ui.ok'), kind: 'primary', value: true }];
      var bodyNode = typeof opts.body === 'string' || typeof opts.body === 'number'
        ? h('p', { class: 'dialog__text', id: textId, text: String(opts.body) })
        : (opts.body || null);
      var dlg = h('dialog', {
        class: ['dialog', opts.cls],
        'data-modal': '',
        'aria-labelledby': opts.title ? titleId : null,
        'aria-label': opts.title ? null : (opts.label || null),
        'aria-describedby': typeof opts.body === 'string' ? textId : null
      });
      var head = h('div', { class: 'dialog__head' },
        h('h2', { class: 'dialog__title', id: titleId, text: opts.title || '' }),
        dismissable ? button({ icon: 'close', label: t('ui.close'), tooltip: false, onClick: function () { finish(null, 'close'); } }) : null
      );
      var body = h('div', { class: 'dialog__body' }, bodyNode);
      var foot = h('div', { class: 'dialog__foot' });
      var buttons = actions.map(function (a) {
        var kind = a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : a.kind === 'quiet' ? 'quiet' : 'text';
        var b = button({ label: a.label, kind: kind, icon: a.icon, cls: a.start ? 'btn--start' : null, disabled: !!a.disabled });
        b.addEventListener('click', function () { choose(a); });
        foot.appendChild(b);
        return b;
      });
      dlg.appendChild(head);
      dlg.appendChild(body);
      dlg.appendChild(foot);

      var primaryIndex = -1;
      actions.forEach(function (a, i) { if (a.kind === 'primary' || a.kind === 'danger') primaryIndex = i; });
      if (primaryIndex < 0) primaryIndex = actions.length - 1;

      var done = false;
      var busy = false;
      var prevFocus = document.activeElement;
      var api = {
        el: dlg,
        body: body,
        close: function (value) { finish(value === undefined ? null : value, 'api'); },
        button: function (i) { return typeof i === 'number' ? buttons[i] : buttons[actions.findIndex(function (a) { return a.value === i; })]; }
      };

      function choose(a) {
        if (done || busy || a.disabled) return;
        if (typeof opts.onAction === 'function') {
          var r;
          try { r = opts.onAction(a.value, api); } catch (err) { reportError(err); return; }
          if (r === false) return;
          if (r && typeof r.then === 'function') {
            busy = true;
            r.then(function (ok) { busy = false; if (ok !== false) finish(a.value, 'action'); }, function (err) { busy = false; reportError(err); });
            return;
          }
        }
        finish(a.value, 'action');
      }

      function finish(value, reason) {
        if (done) return;
        done = true;
        popEsc();
        historyRelease(entry);
        untrackModal(dlg);
        rescueLayers(dlg);
        try { dlg.close(); } catch (err) { /* already closed */ }
        restoreFocus(prevFocus);
        removeAfterExit(dlg);
        resolve(value);
      }

      dlg.addEventListener('cancel', function (event) {
        event.preventDefault();
        if (dismissable) finish(null, 'escape');
      });
      /* A browser may close a dialog on its own (a repeated close request
       * skips 'cancel'): settle the promise and the bookkeeping anyway. */
      dlg.addEventListener('close', function () { if (!done) finish(null, 'native'); });
      var downOnScrim = false;
      dlg.addEventListener('pointerdown', function (event) { downOnScrim = onScrim(event, dlg); });
      dlg.addEventListener('click', function (event) {
        if (downOnScrim && onScrim(event, dlg) && dismissable) finish(null, 'scrim');
        downOnScrim = false;
      });
      dlg.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' || event.isComposing) return;
        var target = event.target;
        var mod = event.ctrlKey || event.metaKey;
        var singleLine = target && target.tagName === 'INPUT' && util.isTextField(target);
        if (mod || singleLine) {
          event.preventDefault();
          choose(actions[primaryIndex]);
        }
      });

      closeTransient();
      trapTab(dlg);
      layersRoot().appendChild(dlg);
      trackModal(dlg);
      dlg.showModal();
      adoptToast(dlg);
      var popEsc = escPush(function () {
        if (!dismissable) return false;
        finish(null, 'escape');
        return true;
      });
      /* A dialog that cannot be dismissed still holds the entry, and turns
       * the back gesture down: leaving the app is not the way out of it. */
      var entry = historyPush(function () {
        if (!dismissable) return false;
        finish(null, 'back');
        return true;
      });

      var first = null;
      if (opts.initialFocus === 'primary') first = buttons[primaryIndex];
      else if (opts.initialFocus === 'cancel') first = buttons.find(function (b, i) { return i !== primaryIndex; }) || buttons[0];
      else if (opts.initialFocus && opts.initialFocus.nodeType === 1) first = opts.initialFocus;
      else if (typeof opts.initialFocus === 'string') first = dlg.querySelector(opts.initialFocus);
      if (!first) first = body.querySelector('input:not([type=hidden]), textarea, select') || buttons[primaryIndex];
      if (first) {
        first.focus({ preventScroll: true });
        if (first.select && first.tagName === 'INPUT') first.select();
      }
      if (typeof opts.onOpen === 'function') opts.onOpen(api);
    });
  }

  function confirm(opts) {
    opts = opts || {};
    return dialog({
      title: opts.title,
      body: opts.text != null ? String(opts.text) : opts.body,
      cls: opts.cls,
      initialFocus: opts.danger ? 'cancel' : 'primary',
      actions: [
        { label: opts.cancel || t('ui.cancel'), kind: 'text', value: false },
        { label: opts.ok || t('ui.ok'), kind: opts.danger ? 'danger' : 'primary', value: true }
      ]
    }).then(function (v) { return v === true; });
  }

  /* Resolves with the trimmed text, or null when cancelled. Empty text is
   * refused unless allowEmpty; validate(text) returns a message to refuse. */
  function prompt(opts) {
    opts = opts || {};
    var id = util.uid('fld');
    var errId = util.uid('err');
    var hintId = opts.hint ? util.uid('hint') : null;
    var input = h(opts.multiline ? 'textarea' : 'input', {
      class: opts.multiline ? 'textarea' : 'input',
      id: id,
      type: opts.multiline ? null : (opts.type || 'text'),
      value: opts.value == null ? '' : String(opts.value),
      placeholder: opts.placeholder || null,
      maxlength: opts.maxLength || null,
      autocomplete: 'off',
      enterkeyhint: opts.multiline ? null : 'done',
      'aria-describedby': [hintId, errId].filter(Boolean).join(' ')
    });
    if (opts.multiline) input.value = opts.value == null ? '' : String(opts.value);
    var error = h('p', { class: 'field__error', id: errId, 'aria-live': 'polite' });
    var field = h('div', { class: 'field' },
      h('label', { class: 'field__label', for: id, text: opts.label || opts.title || '' }),
      input,
      opts.hint ? h('p', { class: 'field__hint', id: hintId, text: opts.hint }) : null,
      error
    );
    input.addEventListener('input', function () {
      if (error.textContent) { error.textContent = ''; input.removeAttribute('aria-invalid'); }
    });
    var result = null;
    return dialog({
      title: opts.title,
      body: field,
      cls: opts.cls,
      initialFocus: input,
      actions: [
        { label: opts.cancel || t('ui.cancel'), kind: 'text', value: false },
        { label: opts.ok || t('ui.ok'), kind: 'primary', value: true }
      ],
      onAction: function (value) {
        if (value !== true) return true;
        var text = String(input.value).trim();
        var msg = null;
        if (!text && !opts.allowEmpty) msg = t('ui.required');
        else if (typeof opts.validate === 'function') {
          var v = opts.validate(text);
          if (typeof v === 'string' && v) msg = v;
        }
        if (msg) {
          error.textContent = msg;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return false;
        }
        result = text;
        return true;
      }
    }).then(function (v) { return v === true ? result : null; });
  }

  /* ================================================================ sheets */

  /* A bottom sheet on phones, a centred (or side) panel elsewhere.
   * opts: title, label, body, actions [{label, kind, onClick}], onClose(reason),
   * detents (where a bottom sheet rests: 'content' and fractions of the
   * visible height, e.g. ['content', 0.92] or [0.5, 0.92]; default ['content'],
   * the content's own height up to 92%), modal (default true), place
   * ('auto' | 'bottom' | 'center' | 'side'), desktop ('center' | 'side',
   * where 'auto' goes on wide screens), cls, initialFocus.
   * Returns {el, body, head, close(reason), setTitle(text), isOpen(), detent()}. */
  function sheet(opts) {
    opts = opts || {};
    var place = opts.place && opts.place !== 'auto' ? opts.place : (useSheets() ? 'bottom' : (opts.desktop || 'center'));
    var modal = opts.modal !== false;
    var titleId = util.uid('sheet-t');
    var dlg = h('dialog', {
      class: ['sheet', opts.cls],
      'data-place': place,
      'data-modal': modal ? '' : null,
      tabindex: '-1',
      'aria-labelledby': opts.title ? titleId : null,
      'aria-label': opts.title ? null : (opts.label || null)
    });
    var grip = place === 'bottom' ? h('div', { class: 'sheet__grip', 'aria-hidden': 'true' }) : null;
    var title = h('h2', { class: 'sheet__title', id: titleId, text: opts.title || '' });
    var head = h('div', { class: 'sheet__head' }, title,
      opts.closeButton === false ? null : button({ icon: 'close', label: t('ui.close'), tooltip: false, onClick: function () { close('button'); } }));
    var bodyContent = typeof opts.body === 'string' ? h('p', { text: opts.body }) : opts.body;
    var body = h('div', { class: 'sheet__body' }, bodyContent || null);
    var foot = null;
    if (opts.actions && opts.actions.length) {
      foot = h('div', { class: 'sheet__foot' });
      opts.actions.forEach(function (a) {
        foot.appendChild(button({ label: a.label, kind: a.kind || 'text', icon: a.icon, onClick: function (e) { if (a.onClick) a.onClick(e, handle); } }));
      });
    }
    if (grip) dlg.appendChild(grip);
    dlg.appendChild(head);
    dlg.appendChild(body);
    if (foot) dlg.appendChild(foot);

    var prevFocus = document.activeElement;
    var closed = false;
    closeTransient();
    layersRoot().appendChild(dlg);
    if (modal) {
      trapTab(dlg);
      trackModal(dlg);
      dlg.showModal();
      adoptToast(dlg);
    } else {
      dlg.show();
    }
    /* Measured and sized in the same task it opens (it has to be displayed
     * to be measured), so the first frame already slides in the final box. */
    var drag = place === 'bottom' ? sheetDrag(dlg, body, opts.detents, function () { close('drag'); }) : null;

    var popEsc = escPush(function () { close('escape'); });
    var entry = historyPush(function () { close('back'); });

    dlg.addEventListener('cancel', function (event) {
      event.preventDefault();
      close('escape');
    });
    dlg.addEventListener('close', function () { if (!closed) close('native'); });
    var downOnScrim = false;
    dlg.addEventListener('pointerdown', function (event) { downOnScrim = onScrim(event, dlg); });
    dlg.addEventListener('click', function (event) {
      if (modal && downOnScrim && onScrim(event, dlg)) close('scrim');
      downOnScrim = false;
    });

    var first = null;
    if (opts.initialFocus && opts.initialFocus.nodeType === 1) first = opts.initialFocus;
    else if (typeof opts.initialFocus === 'string') first = dlg.querySelector(opts.initialFocus);
    try { (first || dlg).focus({ preventScroll: true }); } catch (err) { /* nothing focusable */ }

    function close(reason) {
      if (closed) return;
      closed = true;
      popEsc();
      historyRelease(entry);
      if (drag) drag.destroy();
      untrackModal(dlg);
      rescueLayers(dlg);
      dlg.removeAttribute('data-dragging');
      dlg.removeAttribute('data-settling');
      /* The exit slides on from wherever a finger left it. */
      dlg.style.removeProperty('translate');
      try { dlg.close(); } catch (err) { /* already closed */ }
      if (dlg.contains(document.activeElement) || document.activeElement === document.body) restoreFocus(prevFocus);
      removeAfterExit(dlg);
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(reason); } catch (err) { reportError(err); }
      }
    }

    var handle = {
      el: dlg,
      body: body,
      head: head,
      close: close,
      setTitle: function (text) { title.textContent = text || ''; },
      isOpen: function () { return !closed; },
      /* Which rest a bottom sheet sits at (0 = the lowest), or -1. */
      detent: function () { return drag ? drag.index() : -1; },
      /* Re-measure after the content changed (a 'content' detent follows it). */
      refit: function () { if (drag) drag.refit(); }
    };
    return handle;
  }

  /* Rubber band past an edge: the further you pull, the less it follows. */
  function rubber(over, dim) {
    var c = 0.55;
    return (over * dim * c) / (dim + c * Math.abs(over));
  }

  var SHEET_FLICK = 0.11;   // px/ms: a release faster than this, downward, is a flick
  var SHEET_PROJECT = 99;   // release projection, d/(1-d) with d = 0.99 (per px/ms)

  /* The touch moves of a drag the page follows itself are the page's own.
   * Where an element says touch-action: none (a grip, a seam, a sheet's
   * header, a toast to flick away), the browser does not pan, but Chromium
   * still reads a quick drag there as a fling with nothing to scroll, and
   * takes the next tap anywhere on the page, up to half a second later, as
   * the touch that stops that fling: the tap never becomes a click (a
   * button pressed right after a drag did nothing, and only when the hand
   * was quick). A touch whose moves are consumed starts no fling. So, for a
   * touch that lands where touch-action is none, between the finger and
   * `el` and before any scroller that could still pan, every cancelable
   * move is consumed. The pointer events come first and are not affected,
   * a tap (no move) stays the browser's own, and a touch that lands where
   * the browser may pan keeps its pan. */
  function noPanAt(from, el) {
    for (var n = from; n && n.nodeType === 1; n = n.parentElement) {
      var cs = window.getComputedStyle(n);
      if (cs.touchAction === 'none') return true;
      if (n === el) return false;
      if ((/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) ||
          (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth)) return false;
    }
    return false;
  }
  function ownTouches(el) {
    if (!el || el.__mrOwnTouches) return el;
    el.__mrOwnTouches = true;
    var own = false;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) own = noPanAt(e.target, el);
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (own && e.cancelable) e.preventDefault();
    }, { passive: false });
    return el;
  }

  /* Where a bottom sheet rests, and how a finger moves it between rests and
   * away. The sheet is sized to its rest (its height, not a slide of a tall
   * box), so whatever it holds at the bottom, the actions and the last line,
   * stays on screen at every rest.
   *
   * A drag tracks the finger 1:1. Above the highest rest the sheet stretches
   * with a rubber band; below the lowest it slides down whole. On release the
   * velocity of the last 100ms is projected forward and the nearest rest
   * wins; a flick down below the lowest rest, or a pull past a third of it,
   * dismisses.
   *
   * Where a drag starts: the grab pill and the header always. The body, when
   * the sheet rests below its highest rest: there a vertical swipe moves the
   * sheet (the body "scrolls only at the top detent"), so its touch-action is
   * none. At the highest rest the body scrolls natively; pulled down while it
   * is scrolled to the top, it drags the sheet. That last case is driven by
   * touch events, not pointer events: with touch-action pan-y the browser
   * cancels the pointer as soon as it starts a pan, so the first downward
   * touchmove at the top is prevented instead (there is nothing above to
   * scroll to anyway). */
  function sheetDrag(dlg, body, detents, onDismiss) {
    var spec = (Array.isArray(detents) && detents.length ? detents : ['content']).filter(function (d) {
      return d === 'content' || (typeof d === 'number' && d > 0 && d <= 1);
    });
    if (!spec.length) spec = ['content'];
    var rests = [];
    var index = 0;
    var fixed = false;
    var g = null;
    var frame = 0;
    var settleTimer = 0;

    function token(name, fallback) {
      var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
      return isFinite(v) ? v : fallback;
    }
    /* The visible height the sheet stands in: above the keyboard. */
    function avail() { return Math.max(1, window.innerHeight - token('--kb', 0)); }

    function natural() {
      var prevH = dlg.style.height;
      var prevM = dlg.style.maxHeight;
      dlg.style.height = 'auto';
      dlg.style.maxHeight = 'none';
      var out = dlg.offsetHeight;
      dlg.style.height = prevH;
      dlg.style.maxHeight = prevM;
      return out;
    }

    function measure() {
      var a = avail();
      /* The highest rest, as a share of the visible height (tokens.css). */
      var top = Math.round(a * token('--sheet-top', 0.92));
      var list = spec.map(function (d) {
        return d === 'content' ? Math.min(natural(), top) : Math.min(Math.round(d * a), top);
      }).sort(function (x, y) { return x - y; });
      rests = list.filter(function (v, i) { return i === 0 || v - list[i - 1] > 24; });
      fixed = rests.length > 1;
    }

    function setRest(i) {
      index = Math.max(0, Math.min(rests.length - 1, i));
      if (fixed) dlg.style.height = rests[index] + 'px';
      else dlg.style.removeProperty('height');
      dlg.style.removeProperty('translate');
      dlg.setAttribute('data-detent', !fixed ? 'only' : (index === rests.length - 1 ? 'top' : 'low'));
    }

    /* p: how much of the sheet shows (mid-animation included, read from its
     * box when a gesture starts); a: the visible height, measured once per
     * gesture (reading a computed style every frame, right after writing
     * one, would force a restyle). */
    function render(p, a) {
      var low = rests[0];
      var top = rests[rests.length - 1];
      if (p > top) {
        p = util.reducedMotion() ? top : top + rubber(p - top, Math.max(1, a - top));
        p = Math.min(p, a);
      }
      if (p >= low) {
        dlg.style.height = Math.round(p) + 'px';
        dlg.style.removeProperty('translate');
      } else {
        dlg.style.height = low + 'px';
        dlg.style.translate = '0 ' + Math.round(low - p) + 'px';
      }
    }

    function stopSettling() {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
      dlg.removeEventListener('transitionend', onSettled);
      dlg.removeAttribute('data-settling');
    }

    function onSettled(event) {
      if (event && (event.target !== dlg || !/height|translate/.test(event.propertyName))) return;
      stopSettling();
      setRest(index);
    }

    /* Glide to a rest, then hand the size back to the rest rules. */
    function settle(i) {
      index = Math.max(0, Math.min(rests.length - 1, i));
      var from = dlg.getBoundingClientRect();
      dlg.setAttribute('data-settling', '');
      var target = rests[index];
      if (Math.abs(from.height - target) < 1 && !dlg.style.translate) { stopSettling(); setRest(index); return; }
      dlg.addEventListener('transitionend', onSettled);
      dlg.style.height = target + 'px';
      dlg.style.removeProperty('translate');
      dlg.setAttribute('data-detent', !fixed ? 'only' : (index === rests.length - 1 ? 'top' : 'low'));
      settleTimer = setTimeout(onSettled, exitDuration(dlg) + 80);
    }

    function begin(kind, id, y, x, fromBody, target) {
      if (g) return;
      var a = avail();
      var p = Math.max(0, a - dlg.getBoundingClientRect().top);
      stopSettling();
      g = { kind: kind, id: id, y0: y, x0: x, base: p, p: p, avail: a, live: false, fromBody: fromBody, samples: [{ t: performance.now(), y: y }], target: target, captured: null };
    }

    function goLive() {
      g.live = true;
      dlg.setAttribute('data-dragging', '');
      /* Fixed during the drag: the rest's height rule would fight the finger. */
      dlg.style.height = Math.round(Math.max(g.base, rests[0])) + 'px';
      if (g.kind === 'pointer' && g.target) {
        try {
          g.target.setPointerCapture(g.id);
          g.captured = g.target;
        } catch (err) { /* capture is a nicety */ }
      }
    }

    /* Returns false when the gesture turned out not to be the sheet's. */
    function track(y, x) {
      var dy = y - g.y0;
      var dx = x - g.x0;
      if (!g.live) {
        if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(dx)) {
          if (Math.abs(dx) > 10) { g = null; return false; }
          return true;
        }
        goLive();
      }
      var now = performance.now();
      g.samples.push({ t: now, y: y });
      while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
      g.p = g.base - dy;
      if (!frame) {
        frame = requestAnimationFrame(function () {
          frame = 0;
          if (g && g.live) render(g.p, g.avail);
        });
      }
      return true;
    }

    function finish(cancelled) {
      var was = g;
      g = null;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (!was || !was.live) return;
      dlg.removeAttribute('data-dragging');
      render(was.p, was.avail);
      var s = was.samples;
      var v = s.length > 1 ? (s[s.length - 1].y - s[0].y) / Math.max(1, s[s.length - 1].t - s[0].t) : 0;
      var p = Math.max(0, was.avail - dlg.getBoundingClientRect().top);
      var low = rests[0];
      var projected = cancelled ? p : p - v * SHEET_PROJECT;
      if (!cancelled && (projected < low * 0.65 || (v > SHEET_FLICK && p < low - 8))) {
        onDismiss();
        return;
      }
      var best = 0;
      for (var i = 1; i < rests.length; i++) {
        if (Math.abs(rests[i] - projected) < Math.abs(rests[best] - projected)) best = i;
      }
      settle(best);
    }

    var FIELDS = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

    /* Something between the finger and the body that has scrolled itself
     * (a long field, a list): a pull down there scrolls it, not the sheet. */
    function innerScrolled(el) {
      for (var n = el; n && n !== body; n = n.parentElement) {
        if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight) return true;
      }
      return false;
    }

    /* Pointer path: the pill and the header always; the body at a low rest.
     * Never from a field (a finger there selects text or moves the caret). */
    function onPointerDown(event) {
      if (event.button != null && event.button > 0) return;
      var target = event.target;
      var fromBody = body.contains(target);
      if (fromBody) {
        if (dlg.getAttribute('data-detent') !== 'low' || event.pointerType === 'mouse' || target.closest(FIELDS)) return;
      } else if (target.closest('button, a, ' + FIELDS)) {
        return;
      }
      begin('pointer', event.pointerId, event.clientY, event.clientX, fromBody, event.currentTarget);
    }
    function onPointerMove(event) {
      if (!g || g.kind !== 'pointer' || event.pointerId !== g.id) return;
      if (track(event.clientY, event.clientX) && g && g.live) event.preventDefault();
    }
    function onPointerUp(event) {
      if (!g || g.kind !== 'pointer' || event.pointerId !== g.id) return;
      /* A finger's pointer starts captured by whatever it landed on; taking
       * the capture over makes that element lose it, which is not the end
       * of the gesture. Only losing our own capture is. */
      if (event.type === 'lostpointercapture' && event.target !== g.captured) return;
      finish(event.type !== 'pointerup');
    }

    /* Touch path: the body at the highest rest, pulled down from its top. */
    function touchOf(event, id) {
      for (var i = 0; i < event.changedTouches.length; i++) if (event.changedTouches[i].identifier === id) return event.changedTouches[i];
      return null;
    }
    function onTouchStart(event) {
      if (g || event.touches.length !== 1 || dlg.getAttribute('data-detent') === 'low') return;
      var touch = event.changedTouches[0];
      var target = event.target;
      if (body.scrollTop > 0 || (target.closest && target.closest(FIELDS)) || innerScrolled(target)) return;
      begin('touch', touch.identifier, touch.clientY, touch.clientX, true, null);
    }
    function onTouchMove(event) {
      if (!g || g.kind !== 'touch') return;
      var touch = touchOf(event, g.id);
      if (!touch) return;
      if (event.touches.length > 1) { finish(true); return; }
      var dy = touch.clientY - g.y0;
      if (!g.live) {
        /* Upward, or the body has scrolled meanwhile: it is a scroll. */
        if (dy < 0 || body.scrollTop > 0) { g = null; return; }
        if (event.cancelable) event.preventDefault();
      } else if (event.cancelable) {
        event.preventDefault();
      }
      track(touch.clientY, touch.clientX);
    }
    function onTouchEnd(event) {
      if (!g || g.kind !== 'touch' || !touchOf(event, g.id)) return;
      finish(event.type === 'touchcancel');
    }

    var grabbers = [dlg.querySelector('.sheet__grip'), dlg.querySelector('.sheet__head')].filter(Boolean);
    grabbers.forEach(function (el) { el.addEventListener('pointerdown', onPointerDown); });
    body.addEventListener('pointerdown', onPointerDown);
    dlg.addEventListener('pointermove', onPointerMove);
    dlg.addEventListener('pointerup', onPointerUp);
    dlg.addEventListener('pointercancel', onPointerUp);
    dlg.addEventListener('lostpointercapture', onPointerUp);
    body.addEventListener('touchstart', onTouchStart, { passive: true });
    body.addEventListener('touchmove', onTouchMove, { passive: false });
    body.addEventListener('touchend', onTouchEnd);
    body.addEventListener('touchcancel', onTouchEnd);
    /* The pill, the header and the body at a low rest move the sheet: their
     * touch moves are its own (ownTouches). */
    ownTouches(dlg);

    /* A rotation or the keyboard changes what "half the screen" is. */
    var onResize = util.throttleFrame(function () {
      if (g) return;
      stopSettling();
      measure();
      setRest(index);
    });
    window.addEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

    measure();
    setRest(0);

    return {
      index: function () { return index; },
      refit: function () { if (!g) { measure(); setRest(index); } },
      destroy: function () {
        stopSettling();
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        grabbers.forEach(function (el) { el.removeEventListener('pointerdown', onPointerDown); });
        body.removeEventListener('pointerdown', onPointerDown);
        dlg.removeEventListener('pointermove', onPointerMove);
        dlg.removeEventListener('pointerup', onPointerUp);
        dlg.removeEventListener('pointercancel', onPointerUp);
        dlg.removeEventListener('lostpointercapture', onPointerUp);
        body.removeEventListener('touchstart', onTouchStart);
        body.removeEventListener('touchmove', onTouchMove);
        body.removeEventListener('touchend', onTouchEnd);
        body.removeEventListener('touchcancel', onTouchEnd);
        window.removeEventListener('resize', onResize);
        if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
        onResize.cancel();
        g = null;
      }
    };
  }

  /* ================================================================ toasts */

  var currentToast = null;

  /* The Popover API (Chromium 114, Safari 17, Firefox 125). Without it a
   * toast is a fixed box in the same place, inside the modal it belongs to. */
  var POPOVER = typeof HTMLElement === 'function' && typeof HTMLElement.prototype.showPopover === 'function';

  /* The live region toasts appear in, one per host (#layers, or the modal
   * on top). A manual popover sits in the top layer: above the modal's
   * scrim and outside the modal's own box, which a sheet being dragged or a
   * dialog scaling in would otherwise make the frame of every fixed child;
   * and, being in the modal's subtree, it is not inert while the modal is
   * open. */
  function toastRegion(host) {
    var region = null;
    for (var i = 0; i < host.children.length; i++) {
      if (host.children[i].classList && host.children[i].classList.contains('toasts')) { region = host.children[i]; break; }
    }
    if (!region) {
      region = h('div', {
        class: 'toasts',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': t('ui.notifications'),
        popover: POPOVER ? 'manual' : null
      });
      host.appendChild(region);
      region.__fresh = true;
    }
    if (POPOVER) {
      try { if (!region.matches(':popover-open')) region.showPopover(); } catch (err) { /* shown as a plain fixed box */ }
    }
    return region;
  }

  /* Moving a toast between regions re-inserts it, which would replay its
   * entrance: it moves without one. */
  function moveToast(el, region) {
    if (el.parentNode === region) return;
    el.setAttribute('data-moved', '');
    region.appendChild(el);
    util.nextFrame().then(function () { el.removeAttribute('data-moved'); });
  }

  /* A modal opening over a toast with an action (Undo) takes it in: left
   * outside, the toast would sit under the scrim with its action out of
   * reach. A toast that only told something is done telling: the modal is
   * what the person turned to, and the toast would lie on its rows (a small
   * window's dialog fills it). */
  function adoptToast(dlg) {
    if (!currentToast || !currentToast.el.isConnected || dlg.contains(currentToast.el)) return;
    if (!currentToast.action) { currentToast.close(); return; }
    moveToast(currentToast.el, toastRegion(dlg));
  }

  /* In the main window toasts sit over the free part of the map, above what
   * floats over its foot (the thumb bar, the zoom bar, a format bar docked
   * on a phone, an iOS keyboard) and clear of panels docked beside or under
   * it (a picture viewer, the Markdown panel): ns.shell.toastArea() gives
   * that box as distances from the window's edges, or null to keep the
   * strip along the window's foot. Asked again whenever the shell says the
   * room changed. */
  function placeToasts() {
    var host = layersRoot();
    var region = null;
    for (var i = 0; i < host.children.length; i++) {
      if (host.children[i].classList && host.children[i].classList.contains('toasts')) { region = host.children[i]; break; }
    }
    if (!region) return;
    var area = null;
    try { area = ns.shell && typeof ns.shell.toastArea === 'function' ? ns.shell.toastArea() : null; } catch (err) { area = null; }
    ['left', 'right', 'bottom'].forEach(function (side) {
      if (area && isFinite(area[side])) region.style.setProperty('--toast-' + side, Math.max(0, Math.round(area[side])) + 'px');
      else region.style.removeProperty('--toast-' + side);
    });
  }

  /* One message at a time: a new one replaces the old, so callers combine
   * facts into one sentence. 6s, 8s with an action or for an error; the
   * timer pauses while the pointer or focus is on it and while the tab is
   * hidden. Flick it away on touch. */
  function toast(text, opts) {
    opts = opts || {};
    if (currentToast) currentToast.close(true);
    var kind = opts.kind || 'info';
    var action = opts.action || null;
    var duration = opts.duration != null ? opts.duration : (action || kind === 'error' ? 8000 : 6000);
    var el = h('div', { class: 'toast', 'data-kind': kind, role: kind === 'error' ? 'alert' : null });
    if (kind === 'error') el.appendChild(icon('warning'));
    el.appendChild(h('span', { class: 'toast__text', text: String(text) }));
    if (action) {
      var actionBtn = button({ label: action.label, kind: 'text', cls: 'toast__action' });
      actionBtn.addEventListener('click', function () {
        close();
        try {
          var r = action.run && action.run();
          if (r && typeof r.then === 'function') r.then(null, reportError);
        } catch (err) { reportError(err); }
      });
      el.appendChild(actionBtn);
    }
    if (action || duration === Infinity || opts.closable) {
      el.appendChild(button({ icon: 'close', label: t('ui.dismiss'), cls: 'toast__close', tooltip: false, onClick: function () { close(); } }));
    }

    var region = toastRegion(layerHost());
    if (region.parentNode === layersRoot()) placeToasts();
    var closed = false;
    var timer = 0;
    var remaining = duration;
    var startedAt = 0;
    var hovering = false;

    function startTimer() {
      if (closed || timer || remaining === Infinity || hovering || document.visibilityState === 'hidden') return;
      startedAt = Date.now();
      timer = setTimeout(function () { close(); }, Math.max(0, remaining));
    }
    function pauseTimer() {
      if (!timer) return;
      clearTimeout(timer);
      timer = 0;
      remaining -= Date.now() - startedAt;
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') pauseTimer(); else startTimer();
    }
    el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hovering = true; pauseTimer(); } });
    el.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hovering = false; if (!el.contains(document.activeElement)) startTimer(); } });
    el.addEventListener('focusin', function () { hovering = true; pauseTimer(); });
    el.addEventListener('focusout', function (e) { if (!el.contains(e.relatedTarget)) { hovering = false; startTimer(); } });
    document.addEventListener('visibilitychange', onVisibility);

    /* touch-action: none on .toast keeps the browser from taking the pan
     * (and cancelling the pointer) before the flick is recognised. */
    var swipe = null;
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    });
    el.addEventListener('pointermove', function (e) {
      if (!swipe || e.pointerId !== swipe.id) return;
      swipe.dx = e.clientX - swipe.x;
      swipe.dy = Math.max(0, e.clientY - swipe.y);
      if (Math.abs(swipe.dx) > 6 || swipe.dy > 6) {
        el.setAttribute('data-dragging', '');
        el.style.translate = swipe.dx + 'px ' + swipe.dy + 'px';
        el.style.opacity = String(Math.max(0.2, 1 - Math.max(Math.abs(swipe.dx), swipe.dy) / 160));
      }
    });
    /* A flick sideways or down sends it on its way along the flick; a
     * shorter pull lets it settle back. */
    function swipeEnd() {
      if (!swipe) return;
      var s = swipe;
      swipe = null;
      el.removeAttribute('data-dragging');
      if (Math.abs(s.dx) > 48 || s.dy > 32) {
        el.style.translate = Math.abs(s.dx) > s.dy ? (s.dx > 0 ? '110%' : '-110%') + ' ' + s.dy + 'px' : s.dx + 'px 100%';
        el.style.opacity = '0';
        close();
        return;
      }
      el.style.removeProperty('translate');
      el.style.removeProperty('opacity');
    }
    el.addEventListener('pointerup', swipeEnd);
    el.addEventListener('pointercancel', swipeEnd);
    ownTouches(el);

    function close(immediate) {
      if (closed) return;
      closed = true;
      pauseTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      if (currentToast === handle) currentToast = null;
      if (immediate === true) { el.remove(); return; }
      el.hidden = true;
      removeAfterExit(el);
    }

    var handle = { el: el, close: close, action: !!action };
    currentToast = handle;
    /* A live region created a moment ago is not yet watched by screen
     * readers: give it a frame before the text arrives. */
    if (region.__fresh) {
      region.__fresh = false;
      util.nextFrame().then(function () {
        if (closed) return;
        /* The modal it was meant for may have closed in that frame. */
        (region.isConnected ? region : toastRegion(layerHost())).appendChild(el);
        startTimer();
      });
    } else {
      region.appendChild(el);
      startTimer();
    }
    return handle;
  }

  /* The "Undo" toast after something was thrown away: it undoes exactly
   * that step, and only while it is still the last one. */
  function toastUndo(text, historyId) {
    var store = ns.store;
    var id = historyId;
    if (id === undefined && store && typeof store.historyState === 'function') id = store.historyState().undoId;
    return toast(text, {
      action: {
        label: t('ui.undo'),
        run: function () {
          if (!store || typeof store.historyState !== 'function') return;
          var hs = store.historyState();
          if (id == null || hs.undoId !== id) {
            toast(t('ui.undoMoved'));
            return;
          }
          var cmd = ns.commands && (ns.commands.get('history.undo') || ns.commands.get('edit.undo'));
          if (cmd) ns.commands.run(cmd.id, { source: 'toast' });
          else store.undo();
        }
      }
    });
  }

  /* ================================================================ banners */

  var banners = new Map();

  /* Persistent problems that need a decision: storage unavailable, a
   * read-only tab, an update waiting. Same id = same banner, updated. */
  function banner(id, opts) {
    opts = opts || {};
    var host = document.getElementById('banners') || layersRoot();
    var rec = banners.get(id);
    var kind = opts.kind || 'info';
    if (!rec) {
      rec = { el: h('div', { class: 'banner', 'data-banner': id }) };
      banners.set(id, rec);
      host.appendChild(rec.el);
    }
    var el = rec.el;
    el.className = 'banner banner--' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = '';
    el.appendChild(icon(opts.icon || (kind === 'info' ? 'info' : 'warning')));
    el.appendChild(h('p', { class: 'banner__text', text: opts.text || '' }));
    var acts = h('div', { class: 'banner__actions' });
    (opts.actions || []).forEach(function (a) {
      acts.appendChild(button({
        label: a.label,
        kind: a.kind || 'text',
        icon: a.icon,
        onClick: function () {
          try {
            var r = a.run && a.run();
            if (r && typeof r.then === 'function') r.then(null, reportError);
          } catch (err) { reportError(err); }
          if (a.dismiss) clearBanner(id);
        }
      }));
    });
    if (opts.dismissable !== false) {
      acts.appendChild(button({ icon: 'close', label: t('ui.dismiss'), tooltip: false, onClick: function () { clearBanner(id); } }));
    }
    if (acts.children.length) el.appendChild(acts);
    el.hidden = false;
    return { el: el, close: function () { clearBanner(id); } };
  }

  function clearBanner(id) {
    var rec = banners.get(id);
    if (!rec) return false;
    banners.delete(id);
    rec.el.hidden = true;
    removeAfterExit(rec.el);
    return true;
  }

  function hasBanner(id) { return banners.has(id); }

  /* ================================================================ helpers */

  /* Fades a scroller's content under a floating header or footer, only once
   * it has scrolled (design brief G6). */
  function scrollEdge(el) {
    if (!el) return null;
    el.classList.add('scroll-edge');
    var update = util.throttleFrame(function () {
      el.toggleAttribute('data-scrolled', el.scrollTop > 1);
      el.toggleAttribute('data-more', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    });
    el.addEventListener('scroll', update, { passive: true });
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { update(); }) : null;
    if (ro) ro.observe(el);
    update();
    return {
      update: update,
      destroy: function () {
        el.removeEventListener('scroll', update);
        if (ro) ro.disconnect();
      }
    };
  }

  /* Roving tabindex for a toolbar or list: one Tab stop, arrows move inside. */
  function roving(container, opts) {
    opts = opts || {};
    var selector = opts.selector || '.btn';
    var vertical = opts.orientation === 'vertical';
    function items() {
      return Array.prototype.filter.call(container.querySelectorAll(selector), function (el) {
        return !el.disabled && !el.hidden && drawn(el);
      });
    }
    function refresh() {
      var list = items();
      var current = list.filter(function (el) { return el.tabIndex === 0; })[0];
      if (!current || list.indexOf(current) < 0) current = list[0];
      Array.prototype.forEach.call(container.querySelectorAll(selector), function (el) { el.tabIndex = el === current ? 0 : -1; });
    }
    container.addEventListener('keydown', function (event) {
      var next = vertical ? 'ArrowDown' : 'ArrowRight';
      var prev = vertical ? 'ArrowUp' : 'ArrowLeft';
      if ([next, prev, 'Home', 'End'].indexOf(event.key) < 0) return;
      var list = items();
      var i = list.indexOf(document.activeElement);
      if (i < 0) return;
      event.preventDefault();
      var j = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (i + (event.key === next ? 1 : -1) + list.length) % list.length;
      list.forEach(function (el, k) { el.tabIndex = k === j ? 0 : -1; });
      list[j].focus();
    });
    container.addEventListener('focusin', function (event) {
      if (!event.target.matches || !event.target.matches(selector)) return;
      items().forEach(function (el) { el.tabIndex = el === event.target ? 0 : -1; });
    });
    refresh();
    return { refresh: refresh };
  }

  /* Closes what floats and is not a decision in progress: menus, light
   * popovers, the tooltip. Used when a dialog opens and on rotation. */
  function closeTransient() {
    tipHide(null);
    if (currentMenu) currentMenu.close({ restore: false });
    popovers.slice().forEach(function (p) { if (p.dismiss) p.close(); });
  }

  function isOpen() { return !!topModal() || !!currentMenu; }

  /* iOS only applies :active with a touch listener somewhere, and a
   * pointerdown-set attribute is the dependable press state everywhere. */
  document.addEventListener('touchstart', noop, { passive: true });
  document.addEventListener('pointerdown', function (event) {
    var b = event.target && event.target.closest ? event.target.closest('.btn, .seg__opt') : null;
    if (!b || b.disabled) return;
    b.setAttribute('data-pressed', '');
    function up() {
      b.removeAttribute('data-pressed');
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      b.removeEventListener('pointerleave', up);
    }
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    b.addEventListener('pointerleave', up);
  }, true);

  var lastOrientationWidth = window.innerWidth;
  window.addEventListener('resize', util.throttleFrame(function () {
    if (Math.abs(window.innerWidth - lastOrientationWidth) > 80) closeTransient();
    lastOrientationWidth = window.innerWidth;
  }));

  /* ================================================================ liquid glass */

  /* The optional refraction from vendor/liquid-glass.iife.js, on at most
   * three elements marked [data-liquid]: the top capsules, and a welcome card
   * that opts in (data-liquid, data-liquid-radius="24", then ns.glass.sync()).
   * Loaded by injecting a classic script (that
   * works from file://) and only when every condition holds: the setting is
   * on, the engine is Chromium (the SVG refraction renders nowhere else;
   * 'userAgentData' is the honest test, CSS.supports can lie), the pointer is
   * a mouse (the library follows the mouse only and sticks on touch), motion
   * and transparency are not reduced, no forced colours or high contrast. It
   * is used static: elasticity 0 and a fixed light, so nothing moves under
   * the cursor and no layout is read per mousemove. Without it the CSS
   * material is the complete design. */
  var glassState = { gen: 0, instances: [], loader: null, failed: false };

  function glassAllowed() {
    var prefs = ns.prefs;
    if (!prefs || !prefs.get('liquidGlass') || prefs.get('reduceTransparency')) return false;
    if (!('userAgentData' in navigator)) return false;
    if (!util.matches('(hover: hover) and (pointer: fine)')) return false;
    if (util.reducedMotion() || util.reducedTransparency()) return false;
    if (util.matches('(forced-colors: active)') || util.matches('(prefers-contrast: more)')) return false;
    return true;
  }

  function glassLoad() {
    if (window.LiquidGlass) return Promise.resolve(window.LiquidGlass);
    if (glassState.loader) return glassState.loader;
    glassState.loader = new Promise(function (resolve, reject) {
      var s = h('script', { src: 'vendor/liquid-glass.iife.js', async: true });
      s.onload = function () { if (window.LiquidGlass) resolve(window.LiquidGlass); else reject(new Error('liquid-glass did not load')); };
      s.onerror = function () { reject(new Error('liquid-glass could not load')); };
      document.head.appendChild(s);
    });
    return glassState.loader;
  }

  function glassTargets() {
    return Array.prototype.filter.call(document.querySelectorAll('[data-liquid]'), drawn).slice(0, 3);
  }

  function glassApply() {
    var gen = ++glassState.gen;
    return glassLoad().then(function (LG) {
      if (gen !== glassState.gen || !glassAllowed()) return;
      /* A wrapped element that left the page (a welcome card closed) takes
       * its instance with it. */
      glassState.instances = glassState.instances.filter(function (rec) {
        if (rec.inst.element && rec.inst.element.isConnected) return true;
        try { rec.inst.destroy(); } catch (err) { /* already detached */ }
        rec.el.__mrGlass = null;
        return false;
      });
      glassTargets().forEach(function (el) {
        if (el.__mrGlass) return;
        var focused = el.contains(document.activeElement) ? document.activeElement : null;
        var inst;
        try {
          inst = LG.create(el, {
            mode: 'polar',
            displacementScale: 56,
            aberrationIntensity: 1.5,
            elasticity: 0,
            blurAmount: 0.375,
            saturation: 170,
            cornerRadius: Number(el.getAttribute('data-liquid-radius')) || 999,
            padding: '0px',
            overLight: false,
            globalMousePos: { x: 0, y: 0 },
            mouseOffset: { x: 0, y: 0 },
            contentStyle: { color: 'inherit', font: 'inherit', textShadow: 'none' }
          });
        } catch (err) {
          glassState.failed = true;
          return;
        }
        el.classList.add('is-liquid');
        el.__mrGlass = inst;
        glassState.instances.push({ el: el, inst: inst });
        if (focused) restoreFocus(focused);
      });
      if (glassState.instances.length) document.documentElement.setAttribute('data-glass', 'liquid');
    }, function () {
      glassState.failed = true;
    });
  }

  function glassDestroy() {
    glassState.gen++;
    glassState.instances.forEach(function (rec) {
      var focused = rec.el.contains(document.activeElement) ? document.activeElement : null;
      try { rec.inst.destroy(); } catch (err) { /* the node may already be gone */ }
      rec.el.classList.remove('is-liquid');
      rec.el.__mrGlass = null;
      if (focused) restoreFocus(focused);
    });
    glassState.instances = [];
    document.documentElement.removeAttribute('data-glass');
  }

  function glassSync() {
    if (glassAllowed() && !glassState.failed) return glassApply();
    glassDestroy();
    return Promise.resolve();
  }

  var glassWatching = false;
  function glassWatch() {
    if (glassWatching) return;
    glassWatching = true;
    var soon = util.debounce(glassSync, 120);
    if (ns.prefs) {
      ns.prefs.on('liquidGlass', soon);
      ns.prefs.on('reduceTransparency', soon);
    }
    ['(hover: hover) and (pointer: fine)', '(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)',
      '(forced-colors: active)', '(prefers-contrast: more)', '(max-width: 639px)'].forEach(function (q) {
      var m = util.media(q);
      if (m && m.addEventListener) m.addEventListener('change', soon);
    });
  }

  ns.glass = {
    sync: function sync() { glassWatch(); return glassSync(); },
    destroy: glassDestroy,
    allowed: glassAllowed,
    active: function active() { return glassState.instances.length > 0; }
  };

  ns.ui = {
    icon: icon,
    button: button,
    menu: menu,
    contextMenu: contextMenu,
    dialog: dialog,
    confirm: confirm,
    prompt: prompt,
    sheet: sheet,
    toast: toast,
    toastUndo: toastUndo,
    placeToasts: placeToasts,
    trapTab: trapTab,
    popover: popover,
    tooltip: tooltip,
    escape: escape,
    banner: banner,
    clearBanner: clearBanner,
    hasBanner: hasBanner,
    scrollEdge: scrollEdge,
    ownTouches: ownTouches,
    roving: roving,
    closeTransient: closeTransient,
    isOpen: isOpen,
    isCompact: isCompact,
    useSheets: useSheets,
    layerHost: layerHost,
    computePlacement: computePlacement,
    position: position,
    viewportBox: viewportBox
  };
})(window.MindRoot);
