/* editor-text: the editor's pure parts, and its words. The strike mark
 * (which the model leaves to the editor) toggles both ways and keeps the
 * choice; a rename field read back as the plain string it stands for,
 * whatever the browser wrote into it; and the strings of the editor, the
 * notes and the colour picker exist in both languages, the Italian kept to
 * the house rules (no exclamation marks, no em-dash, no emoji). The three
 * files load and do nothing until init() is called. */
'use strict';

var ns = window.MindRoot;
var E = ns.editor;

T.test('loading does nothing by itself', function () {
  T.ok(E && typeof E.init === 'function', 'ns.editor is there');
  T.ok(ns.notes && typeof ns.notes.open === 'function', 'ns.notes is there');
  T.ok(ns.colorpicker && typeof ns.colorpicker.open === 'function', 'ns.colorpicker is there');
  T.eq(E.isRenaming(), false, 'nothing is being written');
  T.eq(ns.notes.isOpen(), false, 'no note open');
  T.eq(ns.notes.open('0', 'node'), false, 'a note cannot open before init');
  T.eq(ns.commands.has('node.addChild'), false, 'commands are registered by init, not by loading');
  T.eq(document.querySelectorAll('.node-toolbar, .format-bar, .note-bubble').length, 0, 'no element made yet');
});

T.test('strike: on, off, and from inside or outside the marks', function () {
  T.same(E.toggleStrike('one two', 0, 3), { text: '~~one~~ two', start: 2, end: 5 }, 'wrapped, the choice kept on the words');
  T.same(E.toggleStrike('~~one~~ two', 2, 5), { text: 'one two', start: 0, end: 3 }, 'chosen inside the marks: taken off');
  T.same(E.toggleStrike('~~one~~ two', 0, 7), { text: 'one two', start: 0, end: 3 }, 'chosen with the marks: taken off');
  T.same(E.toggleStrike('one two', 3, 7), { text: 'one ~~two~~', start: 6, end: 9 }, 'the spaces around the choice stay outside the marks');
  T.same(E.toggleStrike('one', 1, 1), { text: 'one', start: 1, end: 1 }, 'nothing chosen: nothing done');
  T.same(E.toggleStrike('a  ', 1, 3), { text: 'a  ', start: 1, end: 3 }, 'only spaces chosen: nothing done');
});

T.test('a field is read as the string it stands for', function () {
  var host = document.getElementById('host');
  host.innerHTML = '';
  var el = document.createElement('span');
  host.appendChild(el);
  el.textContent = 'plain';
  T.eq(E.readField(el), 'plain', 'text');
  el.innerHTML = 'one<br>two';
  T.eq(E.readField(el), 'one\ntwo', 'a <br> inside is a newline');
  el.innerHTML = 'ends here\n<br>';
  T.eq(E.readField(el), 'ends here\n', 'a trailing <br> is the sentinel, not a character');
  el.innerHTML = 'first<div>second</div><div>third</div>';
  T.eq(E.readField(el), 'first\nsecond\nthird', 'a <div> a browser wrote for a line is a newline');
  el.innerHTML = 'a <b>bold</b> word';
  T.eq(E.readField(el), 'a bold word', 'markup a browser slipped in is read as its words');
  el.innerHTML = '';
  T.eq(E.readField(el), '', 'empty');
  host.innerHTML = '';
});

T.test('the words exist in both languages, and the Italian keeps the rules', function () {
  var en = ns.i18n.keys('en');
  var it = ns.i18n.keys('it');
  var mine = /^(editor|notes|colorpicker)\./;
  var enMine = en.filter(function (k) { return mine.test(k); });
  var itMine = it.filter(function (k) { return mine.test(k); });
  T.ok(enMine.length > 150, 'the modules registered their strings (' + enMine.length + ')');
  T.same(enMine.filter(function (k) { return itMine.indexOf(k) < 0; }), [], 'every English string has an Italian one');
  T.same(itMine.filter(function (k) { return enMine.indexOf(k) < 0; }), [], 'and the other way round');
  ns.i18n.setLang('it');
  var bad = itMine.filter(function (k) {
    var s = ns.i18n.t(k);
    return /!|—|[\u{1F300}-\u{1FAFF}☀-➿]/u.test(s);
  });
  T.same(bad, [], 'no exclamation mark, em-dash or emoji in Italian');
  var labels = itMine.filter(function (k) { return /\.label\./.test(k); }).map(function (k) { return ns.i18n.t(k); });
  T.ok(labels.every(function (s) { return s.charAt(0) === s.charAt(0).toLowerCase(); }), 'history labels are lower case (they are read inside a sentence)');
  var commands = itMine.filter(function (k) { return /\.cmd\./.test(k); }).map(function (k) { return ns.i18n.t(k); });
  T.ok(commands.every(function (s) { return s.charAt(0) === s.charAt(0).toUpperCase(); }), 'command names start with a capital (sentence case)');
  ns.i18n.setLang('en');
  T.eq(ns.i18n.t('editor.cmd.addChild'), 'Add a child', 'English back');
});

T.test('lists in the words: Enter goes on, an empty item ends', function () {
  T.same(E.listEnter('- one', 5, 5), { text: '- one\n- ', start: 8, end: 8 }, 'the next bullet');
  T.same(E.listEnter('  * one', 7, 7), { text: '  * one\n  * ', start: 12, end: 12 }, 'its marker and indent kept');
  T.same(E.listEnter('3. three', 8, 8), { text: '3. three\n4. ', start: 12, end: 12 }, 'the next number');
  T.same(E.listEnter('1) a', 4, 4), { text: '1) a\n2) ', start: 8, end: 8 }, 'its delimiter kept');
  T.same(E.listEnter('- [x] done', 10, 10), { text: '- [x] done\n- [ ] ', start: 17, end: 17 }, 'a task goes on as an empty box');
  T.same(E.listEnter('- one two', 5, 5), { text: '- one\n-  two', start: 8, end: 8 }, 'broken at the caret');
  T.same(E.listEnter('x\n- ', 4, 4), { text: 'x\n', start: 2, end: 2 }, 'an empty item ends the list');
  T.same(E.listEnter('- a\n  - ', 8, 8), { text: '- a\n- ', start: 6, end: 6 }, 'a nested empty item steps out first');
  T.eq(E.listEnter('plain words', 5, 5), null, 'not a list: an ordinary line break');
  T.eq(E.listEnter('- one', 1, 1), null, 'the caret in the marker: an ordinary line break');
});

T.test('lists in the words: Tab nests, Shift+Tab brings out', function () {
  T.same(E.listIndent('- a\n- b', 7, 7, 1), { text: '- a\n  - b', start: 9, end: 9 }, 'under the item above');
  T.same(E.listIndent('1. a\n1. b', 9, 9, 1), { text: '1. a\n   1. b', start: 12, end: 12 }, 'to the words of a numbered item');
  T.same(E.listIndent('- a\n  - b', 9, 9, -1), { text: '- a\n- b', start: 7, end: 7 }, 'out a level');
  T.same(E.listIndent('- a', 3, 3, 1), { text: '- a', start: 3, end: 3 }, 'the first item has nothing to nest under: nothing moves, the key is still the list\'s');
  T.eq(E.listIndent('- a', 3, 3, -1), null, 'nothing to bring out');
  T.same(E.listIndent('- a\n- b\n- c', 4, 11, 1), { text: '- a\n  - b\n  - c', start: 4, end: 15 }, 'every item the choice touches');
});

T.test('lists in the words: the buttons', function () {
  T.same(E.listToggle('milk', 2, 2, 'bullet'), { text: '- milk', start: 4, end: 4 }, 'a line becomes an item');
  T.same(E.listToggle('- milk', 4, 4, 'bullet'), { text: 'milk', start: 2, end: 2 }, 'and back');
  T.same(E.listToggle('a\nb\n\nc', 0, 6, 'number'), { text: '1. a\n2. b\n\n3. c', start: 0, end: 15 }, 'numbered on, blank lines passed over');
  T.same(E.listToggle('- a', 3, 3, 'check'), { text: '- [ ] a', start: 7, end: 7 }, 'a bullet becomes a task');
  T.same(E.listToggle('1. [x] a', 8, 8, 'bullet'), { text: '- a', start: 3, end: 3 }, 'a ticked numbered task becomes a bullet');
  T.same(E.listToggle('  - a', 5, 5, 'number'), { text: '  1. a', start: 6, end: 6 }, 'the indent stays');
});
