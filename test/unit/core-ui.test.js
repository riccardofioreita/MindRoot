/* core-ui: placement maths, the Escape stack, dialogs, confirm and prompt,
 * menus (keyboard, toggle on the anchor), sheets, popovers, toasts,
 * tooltips, banners, and that every core string exists in both languages. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var UI = ns.ui;
  var U = ns.util;
  ns.i18n.init('en');
  document.addEventListener('keydown', function (e) { ns.commands.handleKey(e); });

  function press(el, k, o) {
    o = o || {};
    var e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift });
    (el || document.activeElement || document.body).dispatchEvent(e);
    return e;
  }
  function gone(sel) { return function () { return !document.querySelector(sel); }; }

  var box = { left: 0, top: 0, right: 1000, bottom: 800 };

  T.test('computePlacement: below, aligned to the start, growing from the anchor', function () {
    var p = UI.computePlacement({ w: 200, h: 150 }, { left: 100, top: 100, right: 140, bottom: 130 }, box, { side: 'bottom', align: 'start', offset: 8 });
    T.same([p.x, p.y, p.side], [100, 138, 'bottom'], 'position');
    T.same([p.originX, p.originY], [20, 0], 'origin at the anchor centre, top edge');
    T.eq(p.maxH, 662, 'room below');
  });

  T.test('computePlacement: a menu too tall for either side slides over its anchor, whole', function () {
    var cut = UI.computePlacement({ w: 200, h: 515 }, { left: 100, top: 400, right: 100, bottom: 400 }, box, { side: 'bottom', offset: 2 });
    T.eq(cut.maxH < 515, true, 'without shift it is cut to the room on one side');
    var p = UI.computePlacement({ w: 200, h: 515 }, { left: 100, top: 400, right: 100, bottom: 400 }, box, { side: 'bottom', offset: 2, shift: true });
    T.eq(p.maxH >= 515, true, 'with shift it keeps its height');
    T.eq(p.y + 515 <= box.bottom && p.y >= box.top, true, 'and fits the box: ' + p.y);
    var fits = UI.computePlacement({ w: 200, h: 100 }, { left: 100, top: 400, right: 100, bottom: 400 }, box, { side: 'bottom', offset: 2, shift: true });
    T.eq(fits.y, 402, 'a menu that fits below stays below the point');
  });

  T.test('computePlacement: flips, clamps and aligns', function () {
    var up = UI.computePlacement({ w: 200, h: 150 }, { left: 100, top: 700, right: 140, bottom: 730 }, box, { side: 'bottom' });
    T.same([up.y, up.side, up.originY], [542, 'top', 150], 'no room below: above, growing from the bottom edge');
    var end = UI.computePlacement({ w: 200, h: 100 }, { left: 900, top: 10, right: 980, bottom: 40 }, box, { align: 'end' });
    T.eq(end.x, 780, 'aligned to the end');
    var clampR = UI.computePlacement({ w: 300, h: 100 }, { left: 900, top: 10, right: 980, bottom: 40 }, box, { align: 'start' });
    T.eq(clampR.x, 700, 'clamped inside on the right');
    var clampL = UI.computePlacement({ w: 300, h: 100 }, { left: -50, top: 10, right: -10, bottom: 40 }, box, {});
    T.eq(clampL.x, 0, 'clamped inside on the left');
    var center = UI.computePlacement({ w: 100, h: 50 }, { left: 400, top: 10, right: 500, bottom: 40 }, box, { align: 'center' });
    T.eq(center.x, 400, 'centred');
    var right = UI.computePlacement({ w: 200, h: 100 }, { left: 900, top: 300, right: 950, bottom: 330 }, box, { side: 'right', offset: 4 });
    T.same([right.side, right.x, right.originX], ['left', 696, 200], 'no room on the right: left side');
    var huge = UI.computePlacement({ w: 200, h: 2000 }, { left: 100, top: 100, right: 140, bottom: 130 }, box, { side: 'bottom', offset: 8 });
    T.eq(huge.side, 'bottom', 'the bigger side');
    T.eq(huge.maxH, 662, 'capped to the room');
    var point = UI.computePlacement({ w: 120, h: 80 }, { left: 990, top: 790, right: 990, bottom: 790 }, box, { offset: 2 });
    T.ok(point.x + 120 <= 1000 && point.y + 80 <= 800 && point.y >= 0, 'a point near the corner stays inside');
  });

  T.test('escape stack: one layer per press, owners pop their own', function () {
    var log = [];
    var popA = UI.escape.push(function () { log.push('a'); });
    UI.escape.push(function () { log.push('b'); });
    var popC = UI.escape.push(function () { log.push('c'); return false; });
    T.eq(UI.escape.handle(), true, 'handled');
    T.same(log, ['c'], 'top first');
    T.eq(UI.escape.size(), 3, 'false keeps it on the stack');
    popC();
    UI.escape.handle();
    T.same(log, ['c', 'b'], 'next');
    popA();
    T.eq(UI.escape.size(), 0, 'empty');
    T.eq(UI.escape.handle(), false, 'nothing to close');
  });

  T.test('icon and button', function () {
    var i = UI.icon('trash', 'icon--sm');
    T.eq(i.getAttribute('class'), 'icon icon--sm', 'class');
    T.eq(i.getAttribute('aria-hidden'), 'true', 'hidden from readers');
    T.eq(i.querySelector('use').getAttribute('href'), '#i-trash', 'sprite reference');
    var clicks = 0;
    var b = UI.button({ icon: 'undo', label: 'Undo', shortcut: 'Mod+Z', onClick: function () { clicks++; } });
    T.eq(b.type, 'button', 'never a submit');
    T.eq(b.getAttribute('aria-label'), 'Undo', 'icon button named');
    T.ok(/Z/.test(b.getAttribute('aria-keyshortcuts')), 'shortcut exposed');
    b.click();
    T.eq(clicks, 1, 'clicked');
    b.setAttribute('aria-disabled', 'true');
    b.click();
    T.eq(clicks, 1, 'aria-disabled stops the action');
    var p = UI.button({ label: 'Make it', kind: 'primary', pressed: false });
    T.eq(p.className, 'btn btn--primary', 'text kind');
    T.eq(p.textContent, 'Make it', 'label shown');
    T.eq(p.getAttribute('aria-pressed'), 'false', 'toggle state');
  });

  T.test('dialog: native, focused, resolves the chosen value', async function () {
    var opener = document.getElementById('anchor');
    opener.focus();
    var p = UI.dialog({ title: 'Pick', body: 'Choose one.', actions: [{ label: 'No', value: 'no' }, { label: 'Yes', kind: 'primary', value: 'yes' }] });
    var dlg = document.querySelector('dialog.dialog[open]');
    T.ok(dlg, 'open');
    T.ok(dlg.matches(':modal'), 'modal: the page behind is inert');
    T.eq(document.activeElement.textContent, 'Yes', 'focus on the primary action');
    T.eq(dlg.getAttribute('aria-labelledby') && document.getElementById(dlg.getAttribute('aria-labelledby')).textContent, 'Pick', 'labelled by its title');
    dlg.querySelectorAll('.dialog__foot .btn')[0].click();
    T.eq(await p, 'no', 'value of the clicked action');
    await T.until(gone('dialog.dialog'), 2000, 'removed after its exit');
    T.eq(document.activeElement, opener, 'focus back where it was');
  });

  T.test('dialog: Escape, the scrim and the close button dismiss with null', async function () {
    var p1 = UI.dialog({ title: 'A', body: 'x' });
    press(document.activeElement, 'Escape');
    T.eq(await p1, null, 'Escape');
    var p2 = UI.dialog({ title: 'B', body: 'x' });
    var d2 = document.querySelector('dialog.dialog[open]');
    d2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    d2.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
    T.eq(await p2, null, 'a press on the scrim');
    var p2b = UI.dialog({ title: 'B2', body: 'x' });
    var d2b = document.querySelector('dialog.dialog[open]');
    var box = d2b.getBoundingClientRect();
    d2b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + 3, clientY: box.bottom - 3 }));
    d2b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + 3, clientY: box.bottom - 3 }));
    T.ok(d2b.open, 'a press on the dialog\'s own padding is not the scrim');
    d2b.querySelector('.dialog__head .btn').click();
    T.eq(await p2b, null, 'closed by its button');
    var p3 = UI.dialog({ title: 'C', body: 'x' });
    document.querySelector('dialog.dialog[open] .dialog__head .btn').click();
    T.eq(await p3, null, 'the close button');
    var p4 = UI.dialog({ title: 'D', body: 'x', dismissable: false, actions: [{ label: 'OK', kind: 'primary', value: 1 }] });
    press(document.activeElement, 'Escape');
    T.ok(document.querySelector('dialog.dialog[open]'), 'not dismissable: Escape does nothing');
    T.eq(document.querySelector('dialog.dialog[open] .dialog__head .btn'), null, 'and has no close button');
    document.querySelector('dialog.dialog[open] .btn--primary').click();
    T.eq(await p4, 1, 'only its action closes it');
    T.eq(UI.escape.size(), 0, 'every escape entry popped');
  });

  T.test('confirm: destructive confirms focus the safe answer', async function () {
    var p = UI.confirm({ title: 'Empty the trash?', text: 'Gone for good.', ok: 'Empty it', danger: true });
    var dlg = document.querySelector('dialog.dialog[open]');
    T.eq(document.activeElement.textContent, 'Cancel', 'focus on Cancel');
    T.ok(dlg.querySelector('.btn--danger'), 'danger button');
    dlg.querySelector('.btn--danger').click();
    T.eq(await p, true, 'true');
    var q = UI.confirm({ title: 'Sure?', text: 'x' });
    press(document.activeElement, 'Escape');
    T.eq(await q, false, 'Escape is false');
  });

  T.test('prompt: Enter submits, empty and invalid are refused inline', async function () {
    var p = UI.prompt({ title: 'Rename', label: 'Name', value: 'Old', validate: function (v) { return v === 'bad' ? 'Not that one.' : null; } });
    var input = document.querySelector('dialog.dialog[open] input');
    T.eq(document.activeElement, input, 'focus in the field');
    T.eq(input.selectionStart === 0 && input.selectionEnd === 3, true, 'text selected');
    input.value = '   ';
    press(input, 'Enter');
    var err = document.querySelector('dialog.dialog[open] .field__error');
    T.eq(err.textContent, 'Write something first.', 'empty refused');
    T.eq(input.getAttribute('aria-invalid'), 'true', 'marked invalid');
    input.value = 'bad';
    input.dispatchEvent(new Event('input'));
    T.eq(err.textContent, '', 'error cleared while typing');
    press(input, 'Enter');
    T.eq(err.textContent, 'Not that one.', 'validate message');
    input.value = '  New name  ';
    press(input, 'Enter');
    T.eq(await p, 'New name', 'trimmed text');
    var q = UI.prompt({ title: 'x', label: 'y' });
    press(document.activeElement, 'Escape');
    T.eq(await q, null, 'cancel gives null');
  });

  T.test('menu: keyboard, selection, toggle on the anchor, outside press', async function () {
    var anchor = document.getElementById('anchor');
    var picked = [];
    var items = [
      { heading: 'Group' },
      { label: 'First', icon: 'plus', shortcut: 'Mod+K', onSelect: function () { picked.push('first'); } },
      '-', '-',
      { label: 'Second', disabled: true, onSelect: function () { picked.push('second'); } },
      { label: 'Third', checked: true, onSelect: function () { picked.push('third'); } },
      null,
      { label: 'Delete', danger: true, onSelect: function () { picked.push('delete'); } },
      '-'
    ];
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    UI.menu(anchor, items);
    var menu = document.querySelector('.menu[role=menu]:not([hidden])');
    T.ok(menu, 'open');
    T.eq(document.activeElement, menu, 'opened by a pointer: the menu has focus, no row looks chosen');
    press(menu, 'ArrowDown');
    T.eq(document.activeElement.querySelector('.menu__label').textContent, 'First', 'the first arrow starts at the top');
    UI.menu(anchor, items);
    T.eq(document.querySelector('.menu:not([hidden])'), null, 'toggled closed');
    press(document.body, 'Enter');
    UI.menu(anchor, items);
    menu = document.querySelector('.menu[role=menu]:not([hidden])');
    T.eq(anchor.getAttribute('aria-expanded'), 'true', 'anchor expanded');
    T.eq(menu.querySelectorAll('.menu__sep').length, 1, 'separators collapsed, none trailing');
    T.eq(document.activeElement.textContent.indexOf('First'), 0, 'opened from the keyboard: first item focused');
    T.ok(/K/.test(menu.querySelector('.menu__kbd').textContent), 'shortcut hint');
    var r = menu.getBoundingClientRect();
    var a = anchor.getBoundingClientRect();
    T.ok(r.top >= a.bottom, 'below its anchor');
    press(menu, 'ArrowDown');
    T.eq(document.activeElement.querySelector('.menu__label').textContent, 'Second', 'arrow down');
    press(menu, 'End');
    T.eq(document.activeElement.querySelector('.menu__label').textContent, 'Delete', 'End');
    press(menu, 'ArrowDown');
    T.eq(document.activeElement.querySelector('.menu__label').textContent, 'First', 'wraps');
    press(menu, 't');
    T.eq(document.activeElement.querySelector('.menu__label').textContent, 'Third', 'type-ahead');
    T.eq(document.activeElement.getAttribute('role'), 'menuitemcheckbox', 'checkbox role');
    T.eq(document.activeElement.getAttribute('aria-checked'), 'true', 'checked');
    menu.querySelectorAll('.menu__item')[1].click();
    T.same(picked, [], 'a disabled item does nothing');
    menu.querySelectorAll('.menu__item')[0].click();
    T.same(picked, ['first'], 'selected');
    T.eq(anchor.getAttribute('aria-expanded'), 'false', 'closed after a choice');
    T.eq(document.activeElement, anchor, 'focus back on the anchor');

    UI.menu(anchor, items);
    T.ok(document.querySelector('.menu:not([hidden])'), 'opened again');
    anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    T.ok(document.querySelector('.menu:not([hidden])'), 'a press on the anchor is not outside');
    UI.menu(anchor, items);
    T.eq(document.querySelector('.menu:not([hidden])'), null, 'the anchor click toggles it closed');

    UI.menu(anchor, items);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    T.eq(document.querySelector('.menu:not([hidden])'), null, 'outside press closes');

    UI.menu(anchor, items);
    press(document.activeElement, 'Escape');
    T.eq(document.querySelector('.menu:not([hidden])'), null, 'Escape closes');
    T.eq(document.activeElement, anchor, 'focus back');
    await T.until(gone('.menu'), 2000, 'removed after the exit');
  });

  T.test('menu flips above an anchor at the bottom and stays on screen', function () {
    var low = document.getElementById('low');
    var many = [];
    for (var i = 0; i < 6; i++) many.push({ label: 'Item ' + i, onSelect: function () {} });
    var m = UI.menu(low, many);
    var el = document.querySelector('.menu:not([hidden])');
    var r = el.getBoundingClientRect();
    T.eq(el.getAttribute('data-side'), 'top', 'flipped');
    T.ok(r.bottom <= low.getBoundingClientRect().top, 'above its anchor');
    T.ok(r.top >= 0, 'inside the window');
    T.ok(/px/.test(el.style.getPropertyValue('--origin')), 'grows from the anchor side');
    m.close();
  });

  T.test('contextMenu at a point', function () {
    var picked = 0;
    UI.contextMenu({ x: 600, y: 300 }, [{ label: 'Open', onSelect: function () { picked++; } }]);
    var el = document.querySelector('.menu:not([hidden])');
    var r = el.getBoundingClientRect();
    T.ok(Math.abs(r.left - 600) < 2 && r.top >= 300, 'at the point');
    el.querySelector('.menu__item').click();
    T.eq(picked, 1, 'selected');
  });

  T.test('sheet: opens as a panel on a wide screen, closes on Escape', async function () {
    var closed = null;
    var s = UI.sheet({ title: 'Settings', body: U.h('p', null, 'Body'), onClose: function (why) { closed = why; } });
    T.ok(s.el.open, 'open');
    T.eq(s.el.getAttribute('data-place'), 'center', 'centred on a wide screen');
    T.ok(s.el.matches(':modal'), 'modal');
    T.eq(s.body.textContent, 'Body', 'body');
    press(document.activeElement, 'Escape');
    T.eq(closed, 'escape', 'closed by Escape');
    T.eq(s.isOpen(), false, 'not open');
    await T.until(gone('dialog.sheet'), 2000, 'removed');
    var t = UI.sheet({ title: 'Side', body: 'x', place: 'side', modal: false });
    T.eq(t.el.getAttribute('data-place'), 'side', 'side panel');
    T.eq(t.el.matches(':modal'), false, 'non-modal');
    t.close('done');
  });

  T.test('a menu inside a modal lives inside it', function () {
    var s = UI.sheet({ title: 'Host', body: U.h('button', { type: 'button', id: 'inner' }, 'More') });
    var inner = document.getElementById('inner');
    UI.menu(inner, [{ label: 'Inside', onSelect: function () {} }]);
    var m = document.querySelector('.menu:not([hidden])');
    T.ok(s.el.contains(m), 'hosted by the sheet (the page outside is inert)');
    press(document.activeElement, 'Escape');
    T.ok(s.isOpen(), 'Escape closed the menu only');
    press(document.activeElement, 'Escape');
    T.eq(s.isOpen(), false, 'the next Escape the sheet');
  });

  T.test('popover: placed, dismissed by Escape and outside press', async function () {
    var anchor = document.getElementById('anchor');
    var closes = 0;
    var p = UI.popover(anchor, U.h('div', { style: { width: '160px', height: '80px' } }, 'Pop'), { onClose: function () { closes++; } });
    var r = p.el.getBoundingClientRect();
    T.ok(r.top >= anchor.getBoundingClientRect().bottom, 'below');
    press(document.body, 'Escape');
    T.eq(closes, 1, 'Escape');
    var q = UI.popover({ left: 500, top: 500, right: 500, bottom: 500 }, U.h('div', null, 'At a rect'), { onClose: function () { closes++; } });
    T.ok(q.el.isConnected, 'rect anchor');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    T.eq(closes, 2, 'outside press');
    await T.until(gone('.popover'), 2000, 'removed');
  });

  T.test('toast: one at a time, action, timer, live region', async function () {
    var ran = 0;
    var first = UI.toast('First');
    await T.until(function () { return document.querySelector('.toast'); }, 2000, 'shown');
    var region = document.querySelector('.toasts');
    T.eq(region.getAttribute('aria-live'), 'polite', 'live region');
    UI.toast('Second', { action: { label: 'Undo', run: function () { ran++; } } });
    await T.until(function () { return document.querySelectorAll('.toast:not([hidden])').length === 1 && /Second/.test(document.querySelector('.toast:not([hidden])').textContent); }, 2000, 'replaced');
    T.ok(first.el.isConnected === false, 'the first went at once');
    document.querySelector('.toast .toast__action').click();
    T.eq(ran, 1, 'action ran');
    await T.until(gone('.toast:not([hidden])'), 2000, 'closed by its action');
    UI.toast('Short', { duration: 60 });
    await T.until(function () { return document.querySelector('.toast:not([hidden])'); }, 2000, 'shown');
    await T.until(gone('.toast:not([hidden])'), 2000, 'expired');
    var e = UI.toast('Broken', { kind: 'error' });
    T.eq(e.el.getAttribute('role'), 'alert', 'errors are alerts');
    e.close();
  });

  T.test('toast pauses while the pointer is on it', async function () {
    var t1 = UI.toast('Hover me', { duration: 120 });
    await T.until(function () { return t1.el.isConnected; }, 2000, 'shown');
    t1.el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await T.sleep(250);
    T.ok(!t1.el.hidden, 'still there while hovered');
    t1.el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await T.until(function () { return t1.el.hidden || !t1.el.isConnected; }, 2000, 'goes after the pointer leaves');
  });

  T.test('toastUndo undoes only its own step', async function () {
    var undone = 0;
    var top = 'h1';
    ns.store = { historyState: function () { return { undoId: top }; }, undo: function () { undone++; } };
    try {
      UI.toastUndo('Moved to the trash.');
      top = 'h2';
      await T.until(function () { return document.querySelector('.toast .toast__action'); }, 2000, 'shown');
      document.querySelector('.toast .toast__action').click();
      T.eq(undone, 0, 'another step happened since: nothing undone');
      await T.until(function () { return /one step/.test((document.querySelector('.toast:not([hidden])') || {}).textContent || ''); }, 2000, 'says why');
      UI.toastUndo('Again.', 'h2');
      await T.until(function () { return document.querySelector('.toast:not([hidden]) .toast__action'); }, 2000, 'shown');
      document.querySelector('.toast:not([hidden]) .toast__action').click();
      T.eq(undone, 1, 'its own step undone');
    } finally {
      delete ns.store;
    }
  });

  T.test('tooltip: after a delay, instantly for the next one, never on touch', async function () {
    var a = document.getElementById('anchor');
    var b = document.getElementById('low');
    UI.tooltip(a, 'Open the menu', 'Mod+M');
    UI.tooltip(b, 'Low one');
    a.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    await T.sleep(600);
    T.ok(!document.querySelector('.tooltip:not([hidden])'), 'not on touch');
    var t0 = Date.now();
    a.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await T.until(function () { return document.querySelector('.tooltip:not([hidden])'); }, 2000, 'shown');
    T.ok(Date.now() - t0 >= 450, 'after about 500ms');
    var tip = document.querySelector('.tooltip');
    T.ok(/Open the menu/.test(tip.textContent) && tip.querySelector('.kbd'), 'text and shortcut');
    T.eq(tip.getAttribute('role'), 'tooltip', 'role');
    a.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    T.ok(tip.hidden, 'hidden on leave');
    b.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    T.ok(!tip.hidden && /Low one/.test(tip.textContent), 'the next one at once');
    T.eq(tip.getAttribute('data-side'), 'top', 'above an element low on the screen');
    press(document.body, 'Escape');
    T.ok(tip.hidden, 'Escape dismisses it');
    UI.tooltip(a, 'Renamed');
    T.eq(a.__mrTip.text, 'Renamed', 'updated in place');
  });

  T.test('banner: one per id, updated, dismissed', async function () {
    var ran = 0;
    UI.banner('storage', { text: 'Nothing is kept.', kind: 'warn', actions: [{ label: 'Export', run: function () { ran++; } }] });
    UI.banner('storage', { text: 'Still nothing is kept.', kind: 'warn' });
    var all = document.querySelectorAll('.banner[data-banner="storage"]');
    T.eq(all.length, 1, 'one banner per id');
    T.eq(all[0].querySelector('.banner__text').textContent, 'Still nothing is kept.', 'updated');
    T.eq(all[0].parentNode.id, 'banners', 'in #banners');
    UI.banner('update', { text: 'A new version.', actions: [{ label: 'Reload', run: function () { ran++; }, dismiss: true }] });
    document.querySelector('.banner[data-banner="update"] .btn--text').click();
    T.eq(ran, 1, 'action ran');
    T.eq(UI.hasBanner('update'), false, 'and dismissed it');
    T.eq(UI.clearBanner('storage'), true, 'cleared');
    T.eq(UI.clearBanner('storage'), false, 'twice is false');
    await T.until(gone('.banner'), 2000, 'removed');
  });

  function settled(el) {
    return function () { return !el.getAnimations().some(function (a) { return a.playState === 'running'; }); };
  }
  function ours() { return !!(history.state && history.state.mindroot2Layer); }
  /* The back gesture, waited for: history.back() is processed later, and a
   * check made before it lands proves nothing. */
  function back() {
    return new Promise(function (resolve) {
      window.addEventListener('popstate', function () { setTimeout(resolve, 0); }, { once: true });
      history.back();
    });
  }

  T.test('back gesture: one history entry for the whole stack of layers', async function () {
    var was = U.isTouch;
    U.isTouch = true;
    try {
      var len = history.length;
      var s = UI.sheet({ title: 'One', body: 'x' });
      T.eq(ours(), true, 'an entry when the first layer opens');
      T.eq(history.length, len + 1, 'one entry');
      s.close('select');
      var p = UI.dialog({ title: 'Two', body: 'y' });
      await T.sleep(120);
      T.eq(ours(), true, 'a layer opening as the last one closes inherits the entry');
      T.eq(history.length, len + 1, 'no second entry');
      await back();
      T.eq(await p, null, 'back closes the dialog');
      await T.until(function () { return !ours(); }, 2000, 'and the entry is gone with it');

      var outer = UI.sheet({ title: 'Outer', body: 'x' });
      var inner = UI.dialog({ title: 'Inner', body: 'y' });
      await back();
      T.eq(await inner, null, 'back closes the top layer only');
      await T.until(ours, 2000, 'an entry again for the next back');
      T.ok(outer.isOpen(), 'the layer under it stays');
      await back();
      await T.until(function () { return !outer.isOpen(); }, 2000, 'the next back closes it');
      await T.sleep(60);
      T.eq(ours(), false, 'nothing left behind');

      var stuck = UI.dialog({ title: 'Answer first', body: 'z', dismissable: false, actions: [{ label: 'OK', kind: 'primary', value: 1 }] });
      await back();
      await T.until(ours, 2000, 'a dialog that cannot be dismissed takes its entry back');
      T.ok(document.querySelector('dialog.dialog[open]'), 'and stays open');
      document.querySelector('dialog.dialog[open] .btn--primary').click();
      T.eq(await stuck, 1, 'its own action closes it');
      await T.until(function () { return !ours(); }, 2000, 'and lets the entry go');

      var later = UI.sheet({ title: 'Later', body: 'x' });
      later.close('done');
      await T.sleep(0);
      var late = UI.sheet({ title: 'While going back', body: 'x' });
      await T.until(ours, 2000, 'a layer opening while the browser goes back gets an entry once it is done');
      late.close('done');
      await T.until(function () { return !ours(); }, 2000, 'released');
      T.eq(history.length, len + 1, 'the history never grew past one entry');
    } finally {
      U.isTouch = was;
    }
  });

  T.test('toast: above a modal, inside its subtree, carried in and out', async function () {
    var s = UI.sheet({ title: 'Host', body: 'x', place: 'bottom', detents: [0.5, 0.92] });
    var tt = UI.toast('Over the sheet', { duration: 20000, action: { label: 'Undo', run: function () {} } });
    await T.until(function () { return tt.el.isConnected; }, 2000, 'shown');
    await T.until(settled(tt.el), 2000, 'entered');
    var region = tt.el.parentNode;
    T.ok(s.el.contains(region), 'in the modal\'s subtree, so not inert');
    if (typeof region.showPopover === 'function') T.ok(region.matches(':popover-open'), 'a manual popover: in the top layer');
    var r = tt.el.getBoundingClientRect();
    T.ok(r.top >= 0 && r.bottom <= window.innerHeight, 'on screen');
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    T.ok(hit && hit.closest('.toast') === tt.el, 'on top of the sheet');
    s.close('done');
    T.ok(document.getElementById('layers').contains(tt.el), 'back in #layers when the sheet goes');
    var p = UI.dialog({ title: 'Adopts', body: 'x' });
    var dlg = document.querySelector('dialog.dialog[open]');
    T.ok(dlg.contains(tt.el), 'a modal opening over a toast takes it in');
    T.ok(tt.el.hasAttribute('data-moved'), 'without a second entrance');
    press(document.activeElement, 'Escape');
    await p;
    T.ok(document.getElementById('layers').contains(tt.el), 'and gives it back');
    var anchor = document.getElementById('anchor');
    var ar = anchor.getBoundingClientRect();
    T.eq(document.elementFromPoint(ar.left + 5, ar.top + 5), anchor, 'the shown region (and its backdrop) lets presses through to the page');
    tt.close();
    var info = UI.toast('Only news', { duration: 20000 });
    await T.until(function () { return info.el.isConnected; }, 2000, 'shown');
    var p2 = UI.dialog({ title: 'Over news', body: 'x' });
    T.ok(!document.querySelector('dialog.dialog[open]').contains(info.el), 'a toast with nothing to do is not carried into the modal');
    await T.until(function () { return !info.el.isConnected || info.el.hidden; }, 2000, 'it leaves instead');
    press(document.activeElement, 'Escape');
    await p2;
  });

  T.test('a menu opening closes a toast that only told something', async function () {
    var news = UI.toast('Only news', { duration: 20000 });
    await T.until(function () { return news.el.isConnected; }, 2000, 'shown');
    var m = UI.menu(document.getElementById('anchor'), [{ label: 'One', onSelect: function () {} }]);
    T.ok(news.el.hidden || !news.el.isConnected, 'gone, so it cannot lie over the menu\'s last rows');
    m.close();
  });

  T.test('a toast a dialog holds is in its Tab cycle', async function () {
    var tt = UI.toast('Moved to the trash.', { action: { label: 'Undo', run: function () {} } });
    await T.until(function () { return tt.el.isConnected; }, 2000, 'shown');
    var p = UI.dialog({ title: 'Keys', body: 'x' });
    var dlg = document.querySelector('dialog.dialog[open]');
    T.ok(dlg.contains(tt.el), 'adopted');
    var close = tt.el.querySelector('.toast__close');
    close.focus();
    var e = press(close, 'Tab');
    T.ok(e.defaultPrevented, "the toast's last button is the end of the cycle");
    T.eq(document.activeElement, dlg.querySelector('.dialog__head .btn'), 'and Tab wraps to the first');
    var last = dlg.querySelectorAll('.dialog__foot .btn');
    var f = press(last[last.length - 1], 'Tab');
    T.eq(f.defaultPrevented, false, "from the dialog's own last button Tab goes on to the toast");
    press(document.activeElement, 'Escape');
    await p;
    tt.close();
  });

  T.test('bottom sheet: rests sized to its detents, actions on screen', async function () {
    var h = U.h;
    var body = h('div', null);
    for (var i = 0; i < 60; i++) body.appendChild(h('p', null, 'Line ' + i));
    var s = UI.sheet({ title: 'Detents', body: body, place: 'bottom', detents: [0.5, 0.92], actions: [{ label: 'Done', kind: 'primary' }] });
    await T.until(settled(s.el), 2000, 'entered');
    var vh = window.innerHeight;
    var r = s.el.getBoundingClientRect();
    T.eq(Math.round(r.height), Math.round(vh * 0.5), 'its height is the low rest');
    T.eq(Math.round(r.bottom), vh, 'on the bottom edge');
    T.eq(s.el.style.translate, '', 'sized, not slid down');
    T.eq(s.detent(), 0, 'the low rest');
    T.eq(s.el.getAttribute('data-detent'), 'low', 'marked low');
    var foot = s.el.querySelector('.sheet__foot').getBoundingClientRect();
    T.ok(foot.bottom <= vh && foot.top >= r.top, 'the actions inside the visible part');
    var b = s.el.querySelector('.sheet__body');
    T.eq(getComputedStyle(b).touchAction, 'none', 'at the low rest a swipe on the body moves the sheet');
    b.scrollTop = b.scrollHeight;
    var lines = b.querySelectorAll('p');
    T.ok(lines[lines.length - 1].getBoundingClientRect().bottom <= foot.top + 1, 'the last line can be scrolled into view');
    s.close('done');
    var c = UI.sheet({ title: 'Content', body: h('p', null, 'Short'), place: 'bottom' });
    await T.until(settled(c.el), 2000, 'entered');
    T.eq(c.el.style.height, '', 'a content sheet keeps its own height');
    T.eq(c.el.getAttribute('data-detent'), 'only', 'one rest');
    T.ok(c.el.getBoundingClientRect().height < vh * 0.5, 'as tall as what it holds');
    c.body.appendChild(h('div', { style: { height: '5000px' } }));
    T.ok(c.el.getBoundingClientRect().height <= Math.round(vh * 0.92) + 1, 'never taller than the top rest');
    c.close('done');
  });

  T.test('a modal closed under its own menu takes the menu along', function () {
    var s = UI.sheet({ title: 'Host', body: U.h('button', { type: 'button', id: 'inner3' }, 'More') });
    UI.menu(document.getElementById('inner3'), [{ label: 'Inside', onSelect: function () {} }]);
    T.eq(UI.escape.size(), 2, 'two layers');
    s.close('back');
    T.eq(UI.escape.size(), 0, 'no Escape entry left for a menu that is gone');
    T.eq(UI.isOpen(), false, 'nothing open');
  });

  T.test('every core string exists in Italian and English', function () {
    var en = ns.i18n.keys('en');
    var it = ns.i18n.keys('it');
    var onlyEn = en.filter(function (k) { return it.indexOf(k) < 0; });
    var onlyIt = it.filter(function (k) { return en.indexOf(k) < 0; });
    T.same(onlyEn, [], 'no English-only string');
    T.same(onlyIt, [], 'no Italian-only string');
    var bad = it.filter(function (k) {
      var s = ns.i18n.t(k);
      ns.i18n.init('it');
      s = ns.i18n.t(k);
      ns.i18n.init('en');
      return /!|—/.test(s);
    });
    T.same(bad, [], 'no exclamation marks or em-dashes in Italian copy');
    T.ok(en.length > 15, 'core strings registered');
  });
})();
