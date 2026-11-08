/* MindRoot - helpers shared by the doc unit suites (tests only).
 *
 * The previous suites found a node by the text it shows (pathOfTitle); the
 * same helper is kept so every ported check reads as it did. */
(function () {
  'use strict';

  var doc = window.MindRoot.doc;

  function pathOf(state, title) {
    for (var i = 0; i < state.flat.length; i++) {
      if (doc.plainText(state.flat[i]) === title) return state.flat[i].path;
    }
    return null;
  }

  /* Parse, run one edit, hand back the new text (or null when the edit
   * changed nothing). */
  function apply(text, fn) {
    var state = doc.parse(text);
    var result = fn(state, function (title) { return pathOf(state, title); });
    return result ? result.text : null;
  }

  function lines() { return Array.prototype.slice.call(arguments).join('\n'); }

  window.DocT = { doc: doc, pathOf: pathOf, apply: apply, lines: lines, LF: '\n' };
})();
