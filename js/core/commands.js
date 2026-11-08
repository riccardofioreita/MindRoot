/* MindRoot - the command registry and the one keyboard dispatcher.
 *
 * Every action the person can take by name is registered here once:
 *   register({ id, label, group, icon, keys, when, run, keywords, help,
 *              showInPalette, showInHelp, global, repeat, checked, title })
 * and the palette, the help sheet, button tooltips, the top bar, the phone
 * thumb bar and its "more" sheet are all generated from this list, so they
 * cannot drift apart (an earlier version described the same shortcut in five
 * places, and they disagreed).
 *
 * Fields beyond the contract, all optional:
 *   global: true       every key of the command also works inside text fields
 *   repeat: true       held keys repeat it (arrow navigation); otherwise a held
 *                      key runs it once
 *   checked(ctx)       for toggles: the top bar shows it as pressed
 *   title(ctx)         a live, translated label for tooltips and menus
 *                      ('Undo: rename the node')
 * A key can also be an object, {key: 'Mod+K', global: true}.
 *
 * Key syntax: modifiers Mod, Ctrl, Alt, Shift, Meta joined with '+' to a key
 * name as event.key spells it ('K', 'Enter', 'ArrowUp', 'F2', 'Delete', '=',
 * '?', 'Space'). Mod is Cmd on a Mac and Ctrl elsewhere. Letters match
 * case-insensitively with Shift checked exactly; for other printable
 * characters Shift is ignored unless named, since it is how the character is
 * typed ('?' is Shift+/ on a US layout and a plain key elsewhere). When
 * event.key is not plain ASCII (Alt+K on a Mac types a ring, dead keys type
 * nothing) the physical event.code is used instead.
 *
 * Groups used by the shell to sort and place commands: app, file, project,
 * map, node, format, edit, history, view, navigate, help. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var registry = new Map();
  var order = 0;
  var standDowns = 0;

  var GROUPS = ['history', 'node', 'format', 'edit', 'map', 'view', 'navigate', 'project', 'file', 'app', 'help'];

  /* ---------------------------------------------------------------- parsing */

  var ALIASES = {
    esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace',
    enter: 'Enter', return: 'Enter', tab: 'Tab', space: ' ', spacebar: ' ',
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
    plus: '+', minus: '-', contextmenu: 'ContextMenu'
  };

  function parse(combo) {
    if (combo && typeof combo === 'object') combo = combo.key || combo.keys || combo.combo || '';
    var text = String(combo || '');
    /* 'Mod++' and 'Mod+-' end in the character itself. */
    var parts = text.split('+');
    var key = parts.pop();
    if (key === '' && parts.length && parts[parts.length - 1] === '') { parts.pop(); key = '+'; }
    var out = { mod: false, ctrl: false, alt: false, shift: false, meta: false, key: '' };
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].trim().toLowerCase();
      if (m === 'mod' || m === 'cmdorctrl') out.mod = true;
      else if (m === 'ctrl' || m === 'control') out.ctrl = true;
      else if (m === 'alt' || m === 'option' || m === 'opt') out.alt = true;
      else if (m === 'shift') out.shift = true;
      else if (m === 'meta' || m === 'cmd' || m === 'command') out.meta = true;
    }
    var k = key.length === 1 ? key : (ALIASES[key.toLowerCase()] || key);
    out.key = k.length === 1 ? k.toLowerCase() : k;
    return out;
  }

  /* The physical key, for when event.key is not usable. */
  function fromCode(code) {
    if (!code) return '';
    var m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1].toLowerCase();
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return m[1];
    var map = {
      Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
      Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: ' ',
      NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.', NumpadEnter: 'Enter'
    };
    return map[code] || '';
  }

  function isPlainAscii(k) { return k.length === 1 && k.charCodeAt(0) >= 32 && k.charCodeAt(0) < 127; }

  /* The key as a binding spells it. A character that is not plain ASCII is
   * swapped for the physical key only while a modifier is held: Option+K on
   * a Mac types a ring and Ctrl+Z on a Russian layout types a Cyrillic
   * letter, but an unmodified 'à' on an Italian keyboard is just 'à'. */
  function eventKey(event) {
    var k = event.key || '';
    if (k === 'Spacebar') k = ' ';
    if (k === 'Esc') k = 'Escape';
    if (k === 'Del') k = 'Delete';
    var modified = event.altKey || event.ctrlKey || event.metaKey;
    if (k.length === 1) {
      if (isPlainAscii(k) || !modified) return k.toLowerCase();
      return fromCode(event.code) || k.toLowerCase();
    }
    if (k === 'Dead' || k === 'Unidentified' || k === 'Process' || !k) return (modified && fromCode(event.code)) || k;
    return k;
  }

  function matches(event, combo) {
    /* Either a combo ('Mod+K', {key: 'Mod+K'}) or one parse() already made. */
    var c = combo && typeof combo === 'object' && 'mod' in combo ? combo : parse(combo);
    var mac = !!(ns.util && ns.util.isMac);
    var wantCtrl = c.ctrl || (c.mod && !mac);
    var wantMeta = c.meta || (c.mod && mac);
    if (!!event.ctrlKey !== wantCtrl) return false;
    if (!!event.metaKey !== wantMeta) return false;
    if (!!event.altKey !== c.alt) return false;
    var k = eventKey(event);
    var letter = c.key.length === 1 && /[a-z]/.test(c.key);
    var printable = c.key.length === 1;
    if (letter || !printable || c.key === ' ') {
      if (!!event.shiftKey !== c.shift) return false;
    } else if (c.shift && !event.shiftKey) {
      return false;
    }
    return k === c.key;
  }

  /* ---------------------------------------------------------------- registry */

  function normalizeKeys(keys) {
    if (!keys) return [];
    if (!Array.isArray(keys)) keys = [keys];
    return keys.filter(Boolean).map(function (k) {
      var spec = typeof k === 'object' ? (k.key || k.keys || k.combo) : k;
      return { spec: String(spec), parsed: parse(spec), global: !!(typeof k === 'object' && k.global) };
    });
  }

  function register(def) {
    if (!def || !def.id) throw new Error('commands.register: an id');
    if (typeof def.run !== 'function') throw new Error('commands.register(' + def.id + '): a run function');
    var cmd = {};
    for (var k in def) cmd[k] = def[k];
    cmd.group = cmd.group || 'app';
    cmd.keys = normalizeKeys(def.keys).map(function (b) { return b.spec; });
    cmd._bindings = normalizeKeys(def.keys);
    cmd.showInPalette = def.showInPalette !== false;
    cmd.showInHelp = def.showInHelp !== false;
    var existing = registry.get(def.id);
    cmd._order = existing ? existing._order : ++order;
    registry.set(def.id, cmd);
    if (ns.bus) ns.bus.emit('commands', { type: 'register', id: def.id });
    return function unregister() {
      if (registry.get(def.id) !== cmd) return;
      registry.delete(def.id);
      if (ns.bus) ns.bus.emit('commands', { type: 'unregister', id: def.id });
    };
  }

  function get(id) { return registry.get(id) || null; }
  function has(id) { return registry.has(id); }

  function all() {
    return Array.from(registry.values()).sort(function (a, b) { return a._order - b._order; });
  }

  function t(key, vars) { return ns.i18n ? ns.i18n.t(key, vars) : key; }

  function label(id) {
    var cmd = registry.get(id);
    return cmd ? t(cmd.label || cmd.id) : '';
  }

  /* The label for a menu or tooltip right now: the command's own live title
   * if it has one, else its translated label. */
  function titleOf(id, ctx) {
    var cmd = registry.get(id);
    if (!cmd) return '';
    if (typeof cmd.title === 'function') {
      try { var s = cmd.title(ctx || {}); if (s) return String(s); } catch (err) { /* fall back to the label */ }
    }
    return label(id);
  }

  function enabled(id, ctx) {
    var cmd = typeof id === 'string' ? registry.get(id) : id;
    if (!cmd) return false;
    if (typeof cmd.when !== 'function') return true;
    try { return !!cmd.when(ctx || {}); } catch (err) {
      if (window.console) console.warn('commands: when() of ' + cmd.id + ' threw', err);
      return false;
    }
  }

  function checked(id, ctx) {
    var cmd = typeof id === 'string' ? registry.get(id) : id;
    if (!cmd || typeof cmd.checked !== 'function') return undefined;
    try { return !!cmd.checked(ctx || {}); } catch (err) { return undefined; }
  }

  function reportFailure(cmd, err) {
    if (window.console) console.error('command ' + cmd.id + ' failed', err);
    if (ns.ui && ns.ui.toast) {
      ns.ui.toast(t('commands.failed', { message: (err && err.message) || String(err) }), { kind: 'error' });
    }
  }

  function run(id, ctx) {
    var cmd = registry.get(id);
    if (!cmd) return false;
    ctx = ctx || {};
    if (!enabled(cmd, ctx)) return false;
    var result;
    try {
      result = cmd.run(ctx);
    } catch (err) {
      reportFailure(cmd, err);
      return false;
    }
    if (result && typeof result.then === 'function') {
      result.then(null, function (err) { reportFailure(cmd, err); });
    }
    return result === undefined ? true : result;
  }

  /* ---------------------------------------------------------------- labels */

  var MAC_MODS = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
  var NAMES = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    PageUp: 'PgUp', PageDown: 'PgDn'
  };
  var MAC_NAMES = { Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥' };
  var WORDS = { Enter: 'keys.enter', Backspace: 'keys.backspace', Delete: 'keys.delete', Escape: 'keys.escape', Tab: 'keys.tab', ' ': 'keys.space', ContextMenu: 'keys.contextMenu' };

  function keyName(k, mac) {
    if (NAMES[k]) return NAMES[k];
    if (mac && MAC_NAMES[k]) return MAC_NAMES[k];
    if (WORDS[k]) return t(WORDS[k]);
    if (k.length === 1) return k.toUpperCase();
    return k;
  }

  /* 'Ctrl+Shift+Z' on Windows and Linux, '⇧⌘Z' on a Mac (Apple's order:
   * Control, Option, Shift, Command). Takes one combo or a list (first wins). */
  function keysLabel(keys) {
    if (!keys) return '';
    if (Array.isArray(keys)) keys = keys[0];
    if (!keys) return '';
    var c = parse(keys);
    var mac = !!(ns.util && ns.util.isMac);
    var ctrl = c.ctrl || (c.mod && !mac);
    var meta = c.meta || (c.mod && mac);
    var name = keyName(c.key, mac);
    if (mac) {
      return (ctrl ? MAC_MODS.ctrl : '') + (c.alt ? MAC_MODS.alt : '') + (c.shift ? MAC_MODS.shift : '') + (meta ? MAC_MODS.meta : '') + name;
    }
    var parts = [];
    if (ctrl) parts.push('Ctrl');
    if (c.alt) parts.push('Alt');
    if (c.shift) parts.push(t('keys.shift'));
    if (meta) parts.push('Win');
    parts.push(name);
    return parts.join('+');
  }

  /* For aria-keyshortcuts: 'Control+Shift+Z' / 'Meta+Shift+Z'. */
  function ariaKeys(keys) {
    if (!keys) return '';
    var list = Array.isArray(keys) ? keys : [keys];
    var mac = !!(ns.util && ns.util.isMac);
    return list.map(function (k) {
      var c = parse(k);
      var parts = [];
      if (c.ctrl || (c.mod && !mac)) parts.push('Control');
      if (c.meta || (c.mod && mac)) parts.push('Meta');
      if (c.alt) parts.push('Alt');
      if (c.shift) parts.push('Shift');
      parts.push(c.key === ' ' ? 'Space' : (c.key.length === 1 ? c.key.toUpperCase() : c.key));
      return parts.join('+');
    }).join(' ');
  }

  /* ---------------------------------------------------------------- dispatch */

  /* The palette (and anything else that owns the keyboard for a while) takes
   * the dispatcher out of the way and gives it back with the returned
   * function. Modal dialogs do it by simply being open. */
  function standDown() {
    standDowns++;
    var released = false;
    return function release() {
      if (released) return;
      released = true;
      standDowns = Math.max(0, standDowns - 1);
    };
  }

  function modalOpen() {
    try {
      if (document.querySelector('dialog[open][data-modal]')) return true;
      return !!document.querySelector('dialog:modal');
    } catch (err) {
      return !!document.querySelector('dialog[open]');
    }
  }

  function isStoodDown() { return standDowns > 0 || modalOpen(); }

  /* The single global keydown handler (app.js installs it on document, in
   * the bubble phase, so a focused component that handles a key first and
   * calls preventDefault keeps it). Returns whether it acted. */
  function handleKey(event) {
    if (!event || event.defaultPrevented) return false;
    if (event.isComposing || event.keyCode === 229) return false;
    if (event.key === 'Escape' || event.key === 'Esc') {
      if (ns.ui && ns.ui.escape && ns.ui.escape.handle(event)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    }
    if (isStoodDown()) return false;
    var target = event.target;
    var typing = ns.util ? ns.util.isTextField(target) : false;
    var ctx = { source: 'key', event: event, target: target };
    var list = all();
    for (var i = 0; i < list.length; i++) {
      var cmd = list[i];
      var bindings = cmd._bindings;
      for (var b = 0; b < bindings.length; b++) {
        var binding = bindings[b];
        if (typing && !(binding.global || cmd.global)) continue;
        if (!matches(event, binding.parsed)) continue;
        if (!enabled(cmd, ctx)) continue;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat && !cmd.repeat) return true;
        run(cmd.id, ctx);
        return true;
      }
    }
    return false;
  }

  if (ns.i18n) {
    ns.i18n.add({
      en: {
        'commands.failed': 'That did not work: {message}',
        'keys.shift': 'Shift', 'keys.enter': 'Enter', 'keys.backspace': 'Backspace', 'keys.delete': 'Del',
        'keys.escape': 'Esc', 'keys.tab': 'Tab', 'keys.space': 'Space', 'keys.contextMenu': 'Menu key'
      },
      it: {
        'commands.failed': 'Non ha funzionato: {message}',
        /* The names printed on Italian keyboards: Backspace is the arrow. */
        'keys.shift': 'Maiusc', 'keys.enter': 'Invio', 'keys.backspace': '⌫', 'keys.delete': 'Canc',
        'keys.escape': 'Esc', 'keys.tab': 'Tab', 'keys.space': 'Spazio', 'keys.contextMenu': 'tasto Menu'
      }
    });
  }

  ns.commands = {
    register: register,
    run: run,
    get: get,
    has: has,
    all: all,
    label: label,
    title: titleOf,
    enabled: enabled,
    checked: checked,
    keysLabel: keysLabel,
    ariaKeys: ariaKeys,
    handleKey: handleKey,
    standDown: standDown,
    isStoodDown: isStoodDown,
    matches: matches,
    parse: parse,
    GROUPS: GROUPS
  };
})(window.MindRoot);
