/* MindRoot - a stand-in for ns.i18n in the doc-words suite (tests only):
 * the contract's add/t/lang/setLang and nothing else, loaded before doc.js
 * so the model can register its words the way it does in the app. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var dict = { it: Object.create(null), en: Object.create(null) };
  var current = 'it';

  function add(table) {
    ['it', 'en'].forEach(function (l) {
      var part = table && table[l];
      if (part) Object.keys(part).forEach(function (key) { dict[l][key] = String(part[key]); });
    });
  }

  function t(key) {
    if (key in dict[current]) return dict[current][key];
    if (key in dict.en) return dict.en[key];
    return key;
  }

  ns.i18n = {
    add: add,
    t: t,
    lang: function lang() { return current; },
    setLang: function setLang(next) { current = next === 'en' ? 'en' : 'it'; return current; },
    table: function table(l) { return dict[l]; }
  };
})(window.MindRoot);
