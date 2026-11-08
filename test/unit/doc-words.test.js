/* MindRoot - the few words the model writes into a map by itself come in
 * the reader's language (review: an Italian session wrote 'untitled' and an
 * 'Images' root). ns.i18n here is the stub in fixtures/doc/i18n-stub.js,
 * loaded before doc.js as core/i18n.js is in the app. */
(function () {
  'use strict';

  var doc = window.MindRoot.doc;
  var i18n = window.MindRoot.i18n;

  T.test('the model registers its words in both languages when it loads', function () {
    var it = i18n.table('it');
    var en = i18n.table('en');
    T.same([it['doc.untitled'], it['doc.newMap'], it['doc.images'], it['doc.image']],
      ['senza titolo', 'Nuova mappa', 'Immagini', 'immagine'], 'Italian');
    T.same([en['doc.untitled'], en['doc.newMap'], en['doc.images'], en['doc.image']],
      ['untitled', 'New map', 'Images', 'image'], 'English');
    Object.keys(it).forEach(function (key) {
      T.ok(!/[!\u2014\u2013]/.test(it[key]), 'no exclamation mark or dash: ' + key);
      T.eq(it[key].charAt(0) + it[key].slice(1).toLowerCase(), it[key], 'sentence case: ' + key);
    });
  });

  T.test('in Italian', function () {
    i18n.setLang('it');
    T.eq(doc.rename(doc.parse('# R\n\n- one\n'), '0', '').text, '# R\n\n- senza titolo\n', 'a node left with nothing');
    T.eq(doc.addChild(doc.parse('# R\n\n- one\n'), '0', '').text, '# R\n\n- one\n  - senza titolo\n', 'a child with no words');
    T.eq(doc.addImage(doc.parse(''), null, 'assets/a.png', '').text, '# Immagini\n\n- ![](assets/a.png)\n', 'loose pictures');
    T.eq(doc.plainText(doc.parse('# R\n\n- ![](assets/a.png)\n').flat[1]), 'immagine', 'a picture-only node in breadcrumbs and search');
    T.eq(doc.emptyDocument(''), '# Nuova mappa\n', 'a new map');
    T.eq(doc.emptyDocument('Garden'), '# Garden\n', 'a given title wins');
  });

  T.test('the language is read when the edit is made', function () {
    i18n.setLang('en');
    T.eq(doc.rename(doc.parse('# R\n\n- one\n'), '0', '').text, '# R\n\n- untitled\n', 'English after a switch');
    T.eq(doc.emptyDocument(''), '# New map\n', 'and a new map');
    i18n.setLang('it');
    T.eq(doc.emptyDocument(''), '# Nuova mappa\n', 'and back');
  });
})();
