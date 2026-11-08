/* MindRoot - a minimal ns.i18n for the ink host page.
 *
 * The drawing editor is a component: its test page loads ink.js and nothing
 * of the app, so this stands in for core/i18n.js with the three calls ink.js
 * makes (add, t, lang). ?lang=it picks Italian. A key asked for that no
 * table has is recorded in window.inkMissingStrings, which the e2e suite
 * checks is empty. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';
  var tables = { it: {}, en: {} };
  var current = /[?&]lang=it\b/.test(location.search) ? 'it' : 'en';
  window.inkMissingStrings = [];

  function add(more) {
    ['it', 'en'].forEach(function (lang) {
      var part = more && more[lang];
      if (!part) return;
      Object.keys(part).forEach(function (key) { tables[lang][key] = String(part[key]); });
    });
  }

  function t(key, vars) {
    var text = tables[current][key];
    if (text === undefined) text = tables.en[key];
    if (text === undefined) {
      window.inkMissingStrings.push(key);
      return key;
    }
    return text.replace(/\{(\w+)\}/g, function (whole, name) {
      return vars && vars[name] != null ? String(vars[name]) : whole;
    });
  }

  function keys(lang) { return Object.keys(tables[lang] || {}).sort(); }

  ns.i18n = { add: add, t: t, keys: keys, lang: function lang() { return current; } };
})(window.MindRoot);
