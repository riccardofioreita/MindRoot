/* core-commands: key parsing and matching (Mod on a Mac and elsewhere,
 * Shift rules, the event.code fallback), the text-field rules, standing
 * down for dialogs, Escape, labels per platform and language. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var C = ns.commands;
  var U = ns.util;
  ns.i18n.init('en');
  document.addEventListener('keydown', function (e) { C.handleKey(e); });

  function key(k, o) {
    o = o || {};
    return new KeyboardEvent('keydown', {
      key: k, code: o.code || '', ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift,
      repeat: !!o.repeat, isComposing: !!o.composing, bubbles: true, cancelable: true
    });
  }
  function onMac(flag, fn) {
    var was = U.isMac;
    U.isMac = flag;
    try { return fn(); } finally { U.isMac = was; }
  }

  T.test('parse', function () {
    T.same(C.parse('Mod+Shift+K'), { mod: true, ctrl: false, alt: false, shift: true, meta: false, key: 'k' }, 'modifiers and lower-cased letter');
    T.eq(C.parse('Mod++').key, '+', 'plus as the key');
    T.eq(C.parse('Mod+-').key, '-', 'minus as the key');
    T.eq(C.parse('Space').key, ' ', 'Space');
    T.eq(C.parse('Esc').key, 'Escape', 'alias');
    T.eq(C.parse('Del').key, 'Delete', 'alias');
    T.eq(C.parse('Alt+Up').key, 'ArrowUp', 'arrow alias');
    T.eq(C.parse({ key: 'Mod+K', global: true }).mod, true, 'object form');
    T.eq(C.parse('F2').key, 'F2', 'function key');
  });

  T.test('Mod is Ctrl elsewhere and Cmd on a Mac', function () {
    onMac(false, function () {
      T.ok(C.matches(key('k', { ctrl: true }), 'Mod+K'), 'ctrl+k');
      T.ok(!C.matches(key('k', { meta: true }), 'Mod+K'), 'meta is not mod');
      T.ok(!C.matches(key('k', { ctrl: true, alt: true }), 'Mod+K'), 'extra alt refused');
      T.ok(C.matches(key('k', { ctrl: true }), 'Ctrl+K'), 'explicit ctrl');
    });
    onMac(true, function () {
      T.ok(C.matches(key('k', { meta: true }), 'Mod+K'), 'cmd+k');
      T.ok(!C.matches(key('k', { ctrl: true }), 'Mod+K'), 'ctrl is not mod on a Mac');
      T.ok(C.matches(key('k', { ctrl: true }), 'Ctrl+K'), 'explicit Ctrl on a Mac');
      T.ok(!C.matches(key('k', { ctrl: true, meta: true }), 'Mod+K'), 'ctrl+cmd is not cmd');
    });
  });

  T.test('Shift: exact for letters and named keys, implied for symbols', function () {
    onMac(false, function () {
      T.ok(C.matches(key('Z', { ctrl: true, shift: true }), 'Mod+Shift+Z'), 'redo');
      T.ok(!C.matches(key('Z', { ctrl: true, shift: true }), 'Mod+Z'), 'redo is not undo');
      T.ok(!C.matches(key('z', { ctrl: true }), 'Mod+Shift+Z'), 'undo is not redo');
      T.ok(C.matches(key('?', { shift: true }), '?'), '? typed with shift');
      T.ok(C.matches(key('?'), '?'), '? typed without shift (other layouts)');
      T.ok(C.matches(key('+', { ctrl: true, shift: true }), 'Mod++'), 'ctrl + plus');
      T.ok(C.matches(key('+', { ctrl: true, code: 'NumpadAdd' }), 'Mod++'), 'numpad plus');
      T.ok(!C.matches(key('+', { ctrl: true, shift: true }), 'Mod+='), 'plus is not equals');
      T.ok(C.matches(key('=', { ctrl: true }), 'Mod+='), 'equals');
      T.ok(C.matches(key('Enter', { shift: true }), 'Shift+Enter'), 'shift+enter');
      T.ok(!C.matches(key('Enter', { shift: true }), 'Enter'), 'enter needs no shift');
      T.ok(C.matches(key('Tab', { shift: true }), 'Shift+Tab'), 'shift+tab');
      T.ok(C.matches(key(' '), 'Space'), 'space');
      T.ok(!C.matches(key(' ', { shift: true }), 'Space'), 'shift+space is not space');
    });
  });

  T.test('event.code stands in when event.key is not plain ASCII', function () {
    onMac(true, function () {
      T.ok(C.matches(key('˚', { alt: true, code: 'KeyK' }), 'Alt+K'), 'option+k on a Mac types a ring');
      T.ok(C.matches(key('Dead', { alt: true, code: 'KeyE' }), 'Alt+E'), 'dead key');
    });
    onMac(false, function () {
      T.ok(C.matches(key('я', { ctrl: true, code: 'KeyZ' }), 'Mod+Z'), 'russian layout ctrl+z');
      T.ok(C.matches(key('a', { ctrl: true, code: 'KeyQ' }), 'Mod+A'), 'AZERTY: the letter typed wins');
      T.ok(!C.matches(key('a', { ctrl: true, code: 'KeyQ' }), 'Mod+Q'), 'not the physical key');
      T.ok(C.matches(key('à', { ctrl: true, code: 'Digit0' }), 'Mod+0'), 'AZERTY digit row');
      T.ok(!C.matches(key('à', { code: 'Digit0' }), '0'), 'no fallback without a modifier');
    });
  });

  T.test('named keys', function () {
    onMac(false, function () {
      T.ok(C.matches(key('F2'), 'F2'), 'F2');
      T.ok(C.matches(key('Delete'), 'Delete'), 'Delete');
      T.ok(C.matches(key('Del'), 'Delete'), 'old Edge spelling');
      T.ok(C.matches(key('Escape'), 'Escape'), 'Escape');
      T.ok(C.matches(key('ArrowUp', { alt: true }), 'Alt+ArrowUp'), 'alt+up');
      T.ok(!C.matches(key('ArrowUp'), 'Alt+ArrowUp'), 'up alone');
    });
  });

  T.test('register, all, label, title, enabled, checked', function () {
    var events = [];
    var off = ns.bus.on('commands', function (d) { events.push(d.type + ':' + d.id); });
    ns.i18n.add({ en: { 't.one': 'First thing' }, it: { 't.one': 'First thing' } });
    var flag = { on: true, checked: false };
    var unregister = C.register({
      id: 't.one', label: 't.one', group: 'view', icon: 'fit', keys: 'Mod+J',
      when: function () { return flag.on; },
      checked: function () { return flag.checked; },
      title: function (ctx) { return ctx.extra ? 'Live: ' + ctx.extra : ''; },
      run: function () { return 'ran'; }
    });
    T.same(C.get('t.one').keys, ['Mod+J'], 'keys normalised to a list');
    T.eq(C.label('t.one'), 'First thing', 'translated label');
    T.eq(C.title('t.one', { extra: 'x' }), 'Live: x', 'live title');
    T.eq(C.title('t.one', {}), 'First thing', 'title falls back to the label');
    T.eq(C.enabled('t.one'), true, 'enabled');
    T.eq(C.checked('t.one'), false, 'checked');
    T.eq(C.run('t.one'), 'ran', 'run returns the result');
    flag.on = false;
    T.eq(C.run('t.one'), false, 'not run when disabled');
    T.eq(C.run('t.missing'), false, 'unknown id');
    T.ok(C.all().some(function (c) { return c.id === 't.one'; }), 'listed');
    T.throws(function () { C.register({ id: 'x' }); }, 'needs run');
    unregister();
    T.eq(C.has('t.one'), false, 'unregistered');
    T.same(events, ['register:t.one', 'unregister:t.one'], 'bus events');
    off();
  });

  T.test('a failing command reports instead of throwing', async function () {
    var logged = 0;
    var orig = console.error;
    console.error = function () { logged++; };
    try {
      C.register({ id: 't.bad', label: 't.bad', run: function () { throw new Error('nope'); } });
      T.eq(C.run('t.bad'), false, 'returns false');
      C.register({ id: 't.badAsync', label: 't.badAsync', run: function () { return Promise.reject(new Error('later')); } });
      C.run('t.badAsync');
      await T.until(function () { return logged === 2; }, 2000, 'async failure logged');
    } finally {
      console.error = orig;
    }
    T.eq(logged, 2, 'both logged');
    var toast = document.querySelector('.toast[data-kind="error"]');
    T.ok(toast && /later/.test(toast.textContent), 'the person is told');
    if (toast) toast.remove();
  });

  T.test('handleKey: dispatch, text fields, global bindings, when()', function () {
    var ran = [];
    C.register({ id: 't.local', label: 't.local', keys: ['Mod+B'], run: function () { ran.push('local'); } });
    C.register({ id: 't.global', label: 't.global', keys: [{ key: 'Mod+K', global: true }], run: function () { ran.push('global'); } });
    C.register({ id: 't.off', label: 't.off', keys: ['F9'], when: function () { return false; }, run: function () { ran.push('off'); } });
    var input = document.createElement('input');
    var check = document.createElement('input');
    check.type = 'checkbox';
    var editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(input, check, editable);
    onMac(false, function () {
      var e = key('b', { ctrl: true });
      document.body.dispatchEvent(e);
      T.same(ran, ['local'], 'dispatched from the page');
      T.eq(e.defaultPrevented, true, 'browser default prevented');
      input.dispatchEvent(key('b', { ctrl: true }));
      T.same(ran, ['local'], 'not inside a text field (Ctrl+B is bold there)');
      editable.dispatchEvent(key('b', { ctrl: true }));
      T.same(ran, ['local'], 'not inside contenteditable');
      check.dispatchEvent(key('b', { ctrl: true }));
      T.same(ran, ['local', 'local'], 'a checkbox is not a text field');
      input.dispatchEvent(key('k', { ctrl: true }));
      T.same(ran, ['local', 'local', 'global'], 'global binding works in a text field');
      var off = key('F9');
      document.body.dispatchEvent(off);
      T.eq(off.defaultPrevented, false, 'a disabled command leaves the key alone');
      var composing = key('b', { ctrl: true, composing: true });
      document.body.dispatchEvent(composing);
      T.same(ran, ['local', 'local', 'global'], 'IME composition ignored');
      var pre = key('b', { ctrl: true });
      pre.preventDefault();
      T.eq(C.handleKey(pre), false, 'already handled by a component');
    });
    input.remove(); check.remove(); editable.remove();
  });

  T.test('held keys run once unless the command repeats', function () {
    var n = { once: 0, rep: 0 };
    C.register({ id: 't.once', label: 't.once', keys: ['F7'], run: function () { n.once++; } });
    C.register({ id: 't.rep', label: 't.rep', keys: ['F8'], repeat: true, run: function () { n.rep++; } });
    document.body.dispatchEvent(key('F7'));
    var held = key('F7', { repeat: true });
    document.body.dispatchEvent(held);
    T.eq(n.once, 1, 'repeat ignored');
    T.eq(held.defaultPrevented, true, 'but still kept from the browser');
    document.body.dispatchEvent(key('F8'));
    document.body.dispatchEvent(key('F8', { repeat: true }));
    T.eq(n.rep, 2, 'repeat allowed');
  });

  T.test('dialogs and the palette stand the dispatcher down', function () {
    var n = 0;
    C.register({ id: 't.sd', label: 't.sd', keys: ['F6'], run: function () { n++; } });
    var release = C.standDown();
    document.body.dispatchEvent(key('F6'));
    T.eq(n, 0, 'stood down');
    release();
    release();
    document.body.dispatchEvent(key('F6'));
    T.eq(n, 1, 'back, and releasing twice is harmless');
    var d = document.createElement('dialog');
    d.innerHTML = '<button>x</button>';
    document.body.appendChild(d);
    d.showModal();
    d.querySelector('button').dispatchEvent(key('F6'));
    T.eq(n, 1, 'a modal dialog stands it down');
    T.eq(C.isStoodDown(), true, 'reported');
    d.close();
    d.remove();
    T.eq(C.isStoodDown(), false, 'and gives it back');
  });

  T.test('Escape closes the top layer first', function () {
    var closed = [];
    C.register({ id: 't.esc', label: 't.esc', keys: ['Escape'], run: function () { closed.push('command'); } });
    var pop1 = ns.ui.escape.push(function () { closed.push('lower'); });
    ns.ui.escape.push(function () { closed.push('upper'); });
    T.eq(C.handleKey(key('Escape')), true, 'handled');
    T.same(closed, ['upper'], 'only the top layer');
    pop1();
    T.eq(ns.ui.escape.size(), 0, 'popped by its owner');
    C.handleKey(key('Escape'));
    T.same(closed, ['upper', 'command'], 'with no layer, the Escape command runs');
  });

  T.test('keysLabel per platform and language', function () {
    onMac(false, function () {
      ns.i18n.init('en');
      T.eq(C.keysLabel('Mod+Shift+Z'), 'Ctrl+Shift+Z', 'windows/linux');
      T.eq(C.keysLabel(['Mod+K', 'F1']), 'Ctrl+K', 'first of a list');
      T.eq(C.keysLabel('Delete'), 'Del', 'delete');
      T.eq(C.keysLabel('Alt+ArrowUp'), 'Alt+↑', 'arrow');
      T.eq(C.keysLabel('Space'), 'Space', 'space');
      T.eq(C.keysLabel('Mod++'), 'Ctrl++', 'plus');
      ns.i18n.init('it');
      T.eq(C.keysLabel('Mod+Shift+Z'), 'Ctrl+Maiusc+Z', 'italian shift');
      T.eq(C.keysLabel('Delete'), 'Canc', 'italian delete');
      T.eq(C.keysLabel('Shift+Enter'), 'Maiusc+Invio', 'italian enter');
      T.eq(C.keysLabel('Backspace'), '⌫', 'italian backspace: the arrow on the key');
      T.eq(C.keysLabel('Shift+ContextMenu'), 'Maiusc+tasto Menu', 'italian menu key, not the DOM name');
      ns.i18n.init('en');
      T.eq(C.ariaKeys(['Mod+Shift+Z', 'Mod+Y']), 'Control+Shift+Z Control+Y', 'aria-keyshortcuts');
    });
    onMac(true, function () {
      T.eq(C.keysLabel('Mod+Shift+Z'), '⇧⌘Z', 'mac symbols in Apple order');
      T.eq(C.keysLabel('Mod+Alt+K'), '⌥⌘K', 'option before command');
      T.eq(C.keysLabel('Ctrl+Mod+F'), '⌃⌘F', 'control first');
      T.eq(C.keysLabel('Delete'), '⌦', 'forward delete');
      T.eq(C.keysLabel('Backspace'), '⌫', 'backspace');
      T.eq(C.ariaKeys('Mod+K'), 'Meta+K', 'aria on a Mac');
    });
    T.eq(C.keysLabel(''), '', 'nothing');
  });
})();
