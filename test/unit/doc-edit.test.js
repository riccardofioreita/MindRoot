/* MindRoot - structural edits where a map's text does more than hold its
 * nodes: paragraphs a node keeps outside its list item, lists written at
 * two columns, indented code, quotes and tables before a numbered item,
 * to-dos among headings, a node emptied of its words. Each case is a bug a
 * review or the stress fuzz found; each expectation says what the edit must
 * keep - every node, its parent, its text - not only the bytes it writes. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;

  function nodes(text) {
    return doc.parse(text).flat.map(function (e) { return doc.plainText(e); });
  }

  function byLabel(state, label) {
    for (var i = 0; i < state.flat.length; i++) if (doc.labelOf(state.flat[i]) === label) return state.flat[i];
    return null;
  }

  /* Each node's parent and the text drawn in its body, by its words. */
  function shape(text) {
    var state = doc.parse(text);
    var out = {};
    (function walk(v, parent) {
      if (!v) return;
      if (!v.synthetic) out[v.text] = { parent: parent, body: v.body ? v.body.text : null };
      v.children.forEach(function (c) { walk(c, v.synthetic ? null : v.text); });
    })(doc.viewTree(state), null);
    return out;
  }

  function trash(text, label) {
    var s = doc.parse(text);
    var path = byLabel(s, label).path;
    var taken = doc.extractBranch(s, path);
    var cut = doc.parse(doc.remove(s, path).text);
    var place = doc.placeFor(cut, taken.origin);
    var back = doc.insertBranch(cut, place.parent, place.index, taken.fragment);
    return { where: place.where, text: back ? back.text : null };
  }

  /* ---------- text a node keeps outside its item ---------- */

  var RECIPE = '1. Mix\n2. Bake\n\nSome text.\n\n3. Serve\n';

  T.test('a paragraph after a list with no heading is the last top node\'s', function () {
    var s = doc.parse(RECIPE);
    var bake = byLabel(s, 'Bake');
    T.eq(bake.outside, 3, 'Bake owns it, from outside its item');
    T.eq(bake.subEnd, 4, 'and it is part of Bake\'s block');
    T.eq(shape(RECIPE).Bake.body, 'Some text.', 'drawn in Bake\'s body');
    var deep = doc.parse('- a\n  - a1\n\npara\n\n- b\n');
    T.eq(byLabel(deep, 'a1').subEnd, 2, 'not the deepest item\'s: a1 ends with its line');
    T.eq(shape('- a\n  - a1\n\npara\n\n- b\n').a.body, 'para', 'it is the top node\'s, written at its level');
    T.eq(byLabel(doc.parse('# R\n\n- a\n\npara\n'), 'a').outside, -1, 'under a heading the heading keeps it, as before');
  });

  T.test('moving or restoring an item keeps every node and the text it owns (review: Mix vanished)', function () {
    var s = doc.parse(RECIPE);
    var dropped = doc.moveTo(s, '1', '0', 'before').text;
    T.eq(dropped, '1. Bake\n\nSome text.\n\n2. Mix\n\n3. Serve\n', 'drop Bake before Mix');
    T.same(nodes(dropped), ['Bake', 'Mix', 'Serve'], 'Mix is still a node');
    T.eq(shape(dropped).Bake.body, 'Some text.', 'and the text is still Bake\'s');
    T.eq(doc.move(s, '1', -1).text, dropped, 'the arrow key does the same');
    T.same(trash(RECIPE, 'Bake'), { where: 'same', text: '1. Mix\n\n2. Bake\n\nSome text.\n\n3. Serve\n' }, 'trash round trip of Bake');
    T.same(trash(RECIPE, 'Serve'), { where: 'same', text: RECIPE }, 'and of Serve, behind the text');
    var child = doc.moveTo(s, '1', '0', 'child').text;
    T.eq(child, '1. Mix\n   1. Bake\n\n      Some text.\n\n3. Serve\n', 'under another item the text comes inside its own item');
    T.eq(shape(child).Bake.body, 'Some text.', 'and stays Bake\'s');
    T.eq(shape(child).Bake.parent, 'Mix', 'Bake is Mix\'s child');
    T.same(nodes(doc.remove(s, '1').text), ['Mix', 'Serve'], 'deleting Bake takes only Bake');
    var under = doc.insertBranch(doc.parse('# R\n\n- x\n'), '', Infinity, doc.extractBranch(s, '1').fragment).text;
    T.eq(under, '# R\n\n- x\n2. Bake\n\n   Some text.\n', 'under a heading too (where the heading would take it)');
    T.eq(shape(under).Bake.body, 'Some text.', 'still Bake\'s');
  });

  T.test('Tab and Enter next to a node\'s outside text (review: child became a sibling, sibling vanished)', function () {
    var ideas = '- Ideas\n\nSome notes about ideas.\n\n- Tasks\n';
    var c = doc.addChild(doc.parse(ideas), '0', 'child');
    T.eq(c.text, '- Ideas\n  - child\n\nSome notes about ideas.\n\n- Tasks\n', 'a child goes inside the item, before the text');
    T.eq(shape(c.text).child.parent, 'Ideas', 'and is a child');
    T.eq(shape(c.text).Ideas.body, 'Some notes about ideas.', 'the text stays Ideas\'s');
    T.eq(doc.findByLine(doc.parse(c.text), c.anchorLine).title, 'child', 'the anchor is the new node');
    var sib = doc.addSibling(doc.parse(ideas), '0', 'new');
    T.eq(sib.text, '- Ideas\n\nSome notes about ideas.\n\n- new\n\n- Tasks\n', 'a sibling goes after the text, set apart');
    var numbered = '1. Ideas\n\nSome notes about ideas.\n\n2. Tasks\n';
    var n = doc.addSibling(doc.parse(numbered), '0', 'new');
    T.eq(n.text, '1. Ideas\n\nSome notes about ideas.\n\n2. new\n\n2. Tasks\n', 'a numbered sibling is not glued to the text');
    T.same(nodes(n.text), ['Ideas', 'new', 'Tasks'], 'so it is a node');
    T.eq(doc.findByLine(doc.parse(n.text), n.anchorLine).title, 'new', 'and the anchor is on it');
    T.eq(doc.addChild(doc.parse(numbered), '0', 'child').text, '1. Ideas\n   - child\n\nSome notes about ideas.\n\n2. Tasks\n', 'a child of a numbered item');
    var tab = doc.indent(doc.parse(ideas), '1').text;
    T.eq(tab, '- Ideas\n\n  Some notes about ideas.\n\n  - Tasks\n', 'Tab on the next item: the text goes inside so the item can');
    T.eq(shape(tab).Tasks.parent, 'Ideas', 'Tasks is Ideas\'s child');
    T.eq(shape(tab).Ideas.body, 'Some notes about ideas.', 'and the text is still Ideas\'s');
    var own = doc.indent(doc.parse('+ a\n- b\n  - c\n\n```\ncode\n```\n'), '1').text;
    T.eq(own, '+ a\n  - b\n    - c\n\n    ```\n    code\n    ```\n', 'Tab on an item with outside text: it comes inside with it');
    T.eq(shape(own).b.body, 'code', 'still b\'s');
  });

  T.test('trash: a top node of several goes back to the top (review: became a child of the other root)', function () {
    var two = '# Work\n\n- w1\n\n# Home\n\n- h1\n';
    T.same(trash(two, 'Work'), { where: 'same', text: two }, 'the first of two roots');
    T.same(trash(two, 'Home'), { where: 'same', text: two }, 'the second');
    var list = '- [x] done task\n  - sub\n- other\n';
    T.same(trash(list, 'done task'), { where: 'same', text: list }, 'a list-only map');
    T.same(trash(list, 'other'), { where: 'same', text: list }, 'its last item');
    T.same(doc.placeFor(doc.parse('# Home\n'), { parent: '', index: 0, lineage: [] }), { parent: null, index: 0, where: 'same' },
      'no node above it means the top, even when one root is left');
  });

  /* ---------- what may start a list ---------- */

  T.test('CommonMark look-back: quotes, tables and code are not paragraphs (review)', function () {
    T.same(nodes('# R\n\n> A quote\n2. two\n3. three\n'), ['R', 'two', 'three'], 'a numbered item after a quote');
    T.same(nodes('# R\n\n> A quote\ncontinued\n2. two\n'), ['R', 'two'], 'after a quote\'s lazy line');
    T.same(nodes('# R\n\n| a | b |\n|---|---|\n| 1 | 2 |\n2. two\n'), ['R', 'two'], 'after a table row');
    T.same(nodes('    - c\n10. ten\n'), ['ten'], 'after indented code');
    T.same(nodes('# R\n\n- a\n  - > note: n\n  2. b\n'), ['R', 'a', 'b'], 'after a note, which is a quote');
    T.same(nodes('# R\n\nA paragraph\n2. two\n'), ['R'], 'a paragraph still keeps "2." as its words');
    T.same(nodes('# R\n\n| a | b |\n|---|\n2. two\n'), ['R'], 'a table needs as many cells in its rule row');
    T.same(nodes('# R\n\npara\n    more\n2. two\n'), ['R'], 'an indented line under a paragraph is more of it, not code');
  });

  T.test('outdent: the siblings after it become its children at its content column (review)', function () {
    var a = doc.outdent(doc.parse('# R\n\n- a\n  1. b\n  2. c\n'), '0.0').text;
    T.eq(a, '# R\n\n- a\n1. b\n   1. c\n', 'under a "1." they move one column in, and c starts the list at 1');
    T.eq(shape(a).c.parent, 'b', 'c is b\'s child');
    T.eq(doc.outdent(doc.parse('# R\n\n- a\n  - b\n  - c\n'), '0.0').text, '# R\n\n- a\n- b\n  - c\n', 'with bullets as before');
    T.eq(doc.outdent(doc.parse('# R\n\n- a\n  1. b\n     - b1\n  2. c\n'), '0.0').text, '# R\n\n- a\n1. b\n   - b1\n   2. c\n',
      'after b\'s own children c keeps its number');
  });

  /* ---------- to-dos and headings ---------- */

  T.test('a to-do never becomes a heading (review: the checkbox was dropped)', function () {
    var text = '# R\n\n## A\n\n## B\n\n- [x] done\n- [ ] open\n';
    var s = doc.parse(text);
    T.eq(doc.moveTo(s, '1.0', '0', 'after'), null, 'dropped among sub-headings it does not land');
    T.eq(doc.canMoveTo(s, '1.0', '0', 'after'), false, 'and canMoveTo says so');
    T.eq(doc.moveTo(s, '1.0', '', 'child').text, '# R\n\n- [x] done\n\n## A\n\n## B\n\n- [ ] open\n', 'as a child it joins the heading\'s list');
    T.eq(doc.moveTo(s, '1.0', '0', 'child').text, '# R\n\n## A\n\n- [x] done\n\n## B\n\n- [ ] open\n', 'under a childless heading, a list item');
    T.eq(doc.moveTo(doc.parse('# R\n\n## A\n\n## B\n\n- plain\n'), '1.0', '0', 'after').text, '# R\n\n## A\n\n## plain\n\n## B\n',
      'a plain item still becomes a heading there');
    T.eq(doc.insertBranch(doc.parse('# A\n\n# B\n'), null, 1, { text: '- [x] t', kind: 'bullet', indent: 0 }).text,
      '- [x] t\n\n# A\n\n# B\n', 'restored between top headings it goes to the list in front of them');
    T.eq(doc.insertBranch(doc.parse('# R\n\n## A\n'), '', Infinity, { text: '- [ ] t\n  - u', kind: 'bullet', indent: 0 }).text,
      '# R\n\n- [ ] t\n  - u\n\n## A\n', 'restored past the sub-headings it goes to the list');
  });

  /* ---------- a line left with nothing ---------- */

  T.test('rename to nothing brings the words under the line up (review: the node vanished)', function () {
    var r = doc.rename(doc.parse('# R\n\n- one\n- two\n  - > text: its words\n  - child\n'), '1', '');
    T.eq(r.text, '# R\n\n- one\n- its words\n  - child\n', 'one edit, no empty item');
    T.eq(shape(r.text).child.parent, 'its words', 'its child stays its child');
    T.eq(doc.rename(doc.parse('# R\n\n- two\n  - > text: ![](a.png) words <!-- role: caption -->\n'), '0', '').text,
      '# R\n\n- words\n  - > text: ![](a.png) <!-- role: caption -->\n', 'the body keeps its picture and its role');
    T.eq(doc.rename(doc.parse('# R\n- > text: below\n'), '', '').text, '# below\n', 'a heading too');
    T.eq(doc.rename(doc.parse('# R\n\n- two\n  - > text: ![](a.png)\n'), '0', '').text, '# R\n\n- untitled\n  - > text: ![](a.png)\n',
      'a body of pictures only gives no words: untitled');
    T.eq(doc.removeImage(doc.parse('# R\n\n- ![](a.png)\n  - > text: words\n'), '0', 'line').text, '# R\n\n- words\n',
      'the last picture off the line does the same');
  });

  /* ---------- exports leave code alone ---------- */

  T.test('stripNotes, stripDrawings and the board skip fenced code (review)', function () {
    T.eq(doc.stripNotes('# R\n\n```md\n- > note: example\n```\n- a\n  - > note: real\n'), '# R\n\n```md\n- > note: example\n```\n- a\n', 'a note in code stays');
    T.eq(doc.stripDrawings('# R\n\n```md\n- ![](a.excalidraw.svg)\n<!-- board: b.ink.svg -->\n```\n- ![](c.ink.svg) x\n'),
      '# R\n\n```md\n- ![](a.excalidraw.svg)\n<!-- board: b.ink.svg -->\n```\n- x\n', 'a drawing and a board line in code stay');
    T.eq(doc.boardPath(doc.parse('# R\n\n```\n<!-- board: a.ink.svg -->\n```\n')), null, 'a board line in code is no board');
    T.eq(doc.boardPath(doc.parse('```\n<!-- board: a.ink.svg -->\n```\n<!-- board: b.ink.svg -->\n# R\n')), 'b.ink.svg', 'the real one after it is');
  });

  /* ---------- found by the stress fuzz ---------- */

  T.test('reshaping keeps what was text, text', function () {
    var h = doc.moveTo(doc.parse('# R\n\n## A\n\n- p\n  7. q\n  8. r\n'), '0.0', '0', 'after').text;
    T.eq(h, '# R\n\n## A\n\n## p\n\n7\\. q\n8. r\n', 'a "7." that was more of the item\'s words is escaped under the heading');
    T.same(nodes(h), ['R', 'A', 'p'], 'so it is not a node');
    T.eq(doc.viewTree(doc.parse(h)).children[1].body.text, '7. q\n8. r', 'and reads the same');
    var b = doc.moveTo(doc.parse('# R\n\n- x\n\n## H\n\n- a\n  5. t\n\n  7. u\n'), '1', '0', 'child').text;
    T.eq(b, '# R\n\n- x\n  - H\n    - a\n      5. t\n\n      7. u\n', 'a numbered item after a blank line keeps the blank line');
    T.same(nodes(b), ['R', 'x', 'H', 'a', 'u'], 'u stays a node, t stays text');
  });

  T.test('lists written at two columns stay as they were', function () {
    T.eq(doc.addSibling(doc.parse('* a\n\npara\n  * b\n'), '0', 'new').text, '* a\n\npara\n\n  * new\n  * b\n',
      'a sibling takes the column of the one it lands before');
    T.eq(doc.insertBranch(doc.parse('# R\n\n  - a\n  - b\n'), '', 0, { text: '- x', kind: 'bullet', indent: 0 }).text,
      '# R\n\n  - x\n  - a\n  - b\n', 'so does a restored or dropped branch');
    T.eq(doc.remove(doc.parse('* a\n* b\n\n```\nx\n```\n\n  - [ ] c\n'), '1').text, '* a\n\n- [ ] c\n',
      'when what kept them apart is gone, the next item takes the removed one\'s column');
    var m = doc.move(doc.parse('- p\n  7) q\n     1. a\n\n     3. b\n  8) c\n  9) d\n'), '2', -1);
    T.eq(m.text, '- p\n  7) q\n     1. a\n\n     8) c\n  3. b\n  9) d\n', 'swapped siblings take each other\'s column');
    T.same(nodes(m.text), ['p', 'a', 'c', 'b', 'd'], 'and stay siblings');
  });

  T.test('new items and notes go past deeper text, never into it', function () {
    var text = '# R\n\n1. a\n\n  text of R\n';
    var r = doc.insertBranch(doc.parse(text), '', Infinity, { text: '- x', kind: 'bullet', indent: 0 }).text;
    T.eq(r, '# R\n\n1. a\n\n  text of R\n\n- x\n', 'a "- x" before the text would take it in');
    T.eq(doc.viewTree(doc.parse(r)).body.text, 'text of R', 'the text stays the heading\'s');
    var code = doc.setNote(doc.parse('# H\n\n    1. code\n\n- a\n'), '', 'node', 'n').text;
    T.eq(code, '# H\n\n    1. code\n- > note: n\n\n- a\n', 'a note after indented code, which it would turn into a list');
    T.same(nodes(code), ['H', 'a'], 'no node made of code');
    T.eq(doc.setNote(doc.parse('# H\n\n  ```\ncode at 0\n  ```\n- a\n'), '', 'node', 'n').text, '# H\n\n  ```\ncode at 0\n  ```\n- > note: n\n- a\n',
      'a fence is passed whole');
    T.eq(doc.setBody(doc.parse('# R\n\n- p\n  - > text: words\n  8) q\n'), '0', '').text, '# R\n\n- p\n\n  8) q\n',
      'a body taken out leaves the numbered item after it a node');
  });

  T.test('Tab and Enter always add a node, on every node of every sample', function () {
    var missed = [];
    Object.keys(window.DocSamples).forEach(function (name) {
      var s = doc.parse(window.DocSamples[name]);
      s.flat.forEach(function (e) {
        var child = doc.addChild(s, e.path, 'x');
        var sib = doc.addSibling(s, e.path, 'x');
        if (!child || doc.parse(child.text).flat.length !== s.flat.length + 1) missed.push(name + ' child of ' + e.path);
        if (!sib || doc.parse(sib.text).flat.length !== s.flat.length + 1) missed.push(name + ' sibling of ' + e.path);
      });
    });
    T.same(missed, [], 'none refused, none lost');
  });

  T.test('a byte-order mark stays on the first line', function () {
    var s = doc.parse('\ufeff# A\n\n# B\n');
    T.eq(doc.remove(s, '0').text, '\ufeff# B\n', 'when the first line is deleted');
    T.eq(doc.move(s, '1', -1).text, '\ufeff# B\n\n# A\n', 'when it moves');
    T.eq(doc.moveTo(s, '0', '1', 'child').text, '\ufeff# B\n\n## A\n', 'when it is dropped elsewhere');
  });
})();
