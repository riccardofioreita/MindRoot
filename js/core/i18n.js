/* MindRoot - strings and formatting in English, with Italian as a second
 * language the person can choose.
 *
 * Every module registers its own strings with add() when it loads, under
 * dotted keys it owns ('sidebar.newProject'). t() looks a key up in the
 * current language, then in English, then gives the key itself back, so a
 * missing translation shows something readable instead of nothing; under an
 * automated browser it also warns, which is how tests catch it.
 *
 * Static markup in index.html is translated through attributes, so the page
 * needs no second copy of its text:
 *   data-i18n="key"              textContent
 *   data-i18n-title="key"        title
 *   data-i18n-aria-label="key"   aria-label
 *   data-i18n-placeholder="key"  placeholder
 * apply(root) fills them; app.js runs it at boot and on every 'lang'. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var LANGS = ['en', 'it'];
  var dict = { it: Object.create(null), en: Object.create(null) };
  var current = 'en';
  var warned = Object.create(null);
  var WARN = !!(typeof navigator !== 'undefined' && navigator.webdriver);

  function normalize(lang) {
    if (!lang) return null;
    lang = String(lang).toLowerCase();
    if (lang.indexOf('it') === 0) return 'it';
    if (lang.indexOf('en') === 0) return 'en';
    return null;
  }

  function fromQuery() {
    try { return normalize(new URLSearchParams(location.search).get('lang')); } catch (err) { return null; }
  }

  function fromPrefs() {
    try { return ns.prefs ? normalize(ns.prefs.get('lang')) : null; } catch (err) { return null; }
  }

  /* English is the app's language for everyone, whatever the browser says:
   * Italian is a second language a person picks in Settings (or ?lang=it,
   * the tests), and that choice is kept in prefs from then on. */
  function init(lang) {
    current = normalize(lang) || fromQuery() || fromPrefs() || 'en';
    document.documentElement.lang = current;
    return current;
  }

  function lang() { return current; }

  function add(table) {
    if (!table) return;
    for (var i = 0; i < LANGS.length; i++) {
      var l = LANGS[i];
      var part = table[l];
      if (!part) continue;
      for (var key in part) {
        if (Object.prototype.hasOwnProperty.call(part, key)) dict[l][key] = String(part[key]);
      }
    }
  }

  function has(key) { return key in dict[current] || key in dict.en; }

  function fill(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : whole;
    });
  }

  function t(key, vars) {
    var text = dict[current][key];
    if (text === undefined) text = dict.en[key];
    if (text === undefined) {
      if (WARN && !warned[key]) {
        warned[key] = true;
        console.warn('i18n: missing string ' + key);
      }
      text = String(key);
    }
    return fill(text, vars);
  }

  var rules = {};
  var numbers = {};
  function number(n, opts) {
    var k = current + JSON.stringify(opts || {});
    var f = numbers[k] || (numbers[k] = new Intl.NumberFormat(current, opts));
    return f.format(n);
  }

  /* key.one / key.other (and key.zero when a module wants "nothing" said
   * differently). {n} is the formatted count: 1.284 in Italian. */
  function plural(key, n, vars) {
    var pr = rules[current] || (rules[current] = new Intl.PluralRules(current));
    var form = n === 0 && has(key + '.zero') ? 'zero' : pr.select(n);
    var full = key + '.' + form;
    if (!has(full)) full = key + '.other';
    var all = { n: number(n) };
    if (vars) for (var v in vars) all[v] = vars[v];
    return t(full, all);
  }

  function setLang(next) {
    next = normalize(next);
    if (!next) return current;
    var changed = next !== current;
    current = next;
    document.documentElement.lang = current;
    try { if (ns.prefs) ns.prefs.set('lang', next); } catch (err) { /* prefs unavailable: the choice lasts this session */ }
    apply(document);
    if (changed && ns.bus) ns.bus.emit('lang', { key: 'lang', value: current });
    return current;
  }

  var ATTRS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder']
  ];

  function apply(root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    for (var a = 0; a < ATTRS.length; a++) {
      var list = root.querySelectorAll('[' + ATTRS[a][0] + ']');
      for (var j = 0; j < list.length; j++) list[j].setAttribute(ATTRS[a][1], t(list[j].getAttribute(ATTRS[a][0])));
    }
  }

  /* Every key registered for a language: lets a test prove that no string
   * exists in one language only. */
  function keys(l) { return Object.keys(dict[normalize(l) || current]).sort(); }

  /* 'a, b e c' / 'a, b and c'. */
  function list(items, type) {
    if (typeof Intl.ListFormat === 'function') {
      return new Intl.ListFormat(current, { style: 'long', type: type || 'conjunction' }).format(items.map(String));
    }
    return items.join(', ');
  }

  ns.i18n = {
    init: init,
    lang: lang,
    add: add,
    has: has,
    t: t,
    plural: plural,
    number: number,
    list: list,
    setLang: setLang,
    apply: apply,
    keys: keys,
    languages: function languages() { return LANGS.slice(); }
  };
})(window.MindRoot);
