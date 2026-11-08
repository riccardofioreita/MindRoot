/* core-prefs-blocked: with storage throwing, preferences live in memory and
 * nothing else changes. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var P = ns.prefs;

  T.test('defaults, in memory, without a throw', function () {
    T.eq(P.available(), false, 'storage reported unavailable');
    T.eq(P.get('theme'), 'system', 'default theme');
    T.eq(P.set('theme', 'dark'), true, 'set works');
    T.eq(P.get('theme'), 'dark', 'kept in memory');
    T.eq(P.flush(), false, 'flush reports that nothing could be written');
    T.eq(P.flush(), true, 'nothing pending any more');
    P.set('notesOpen', true);
    T.eq(P.get('notesOpen'), true, 'another key in memory');
    T.eq(ns.i18n.init(), ns.i18n.lang(), 'i18n still initialises');
  });
})();
