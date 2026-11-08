/* doc-sides: the side marker of a first-level branch (js/model/doc.js).
 *
 * '<!-- side: left -->' at the end of a first-level branch's line says it
 * grows on the left of its root; no marker is the right. Read in any order
 * among the other markers, written back in the canonical order (title,
 * role, image, draw, fold, side, colour), kept through rename, colour and
 * moves, copied to a sibling added beside it, a word this version does not
 * know kept as it was (and read as the right), and a typed title that
 * looks like one escaped. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var apply = D.apply;
  var pathOf = D.pathOf;

  var MAP = '# R\n\n- one\n- two <!-- side: left -->\n  - inside\n- three\n';

  T.test('parse: the marker, its node, its branch', function () {
    var s = doc.parse(MAP);
    var two = s.byPath[pathOf(s, 'two')];
    T.eq(two.title, 'two', 'the marker is not in the title');
    T.eq(two.side, 'left', 'read as the left');
    T.eq(s.byPath[pathOf(s, 'one')].side, null, 'no marker: no side of its own');
    T.eq(doc.sideAt(s, pathOf(s, 'two')), 'left', 'sideAt: the left');
    T.eq(doc.sideAt(s, pathOf(s, 'one')), 'right', 'sideAt: the right by default');
    T.eq(doc.sideAt(s, pathOf(s, 'inside')), 'left', 'a child grows on its branch\'s side');
    T.eq(doc.sideAt(s, pathOf(s, 'R')), null, 'the root grows on both');
    T.eq(doc.isFirstLevel(s, pathOf(s, 'two')), true, 'a first-level branch');
    T.eq(doc.isFirstLevel(s, pathOf(s, 'inside')), false, 'a child is not');
    T.eq(doc.isTreeRoot(s, pathOf(s, 'R')), true, 'the root is a tree root');
    var tree = doc.viewTree(s);
    T.same(tree.children.map(function (v) { return v.side; }), ['right', 'left', 'right'], 'viewTree carries the side');
    T.eq(tree.side, 'right', 'and a side on every view node');

    var spaced = doc.parse('# R\n\n-   two   <!--side:LEFT-->  \n');
    T.eq(spaced.byPath[pathOf(spaced, 'two')].side, 'left', 'any spacing, any case');
    var heading = doc.parse('# R\n\n## Two <!-- side: left -->\n\n- under\n');
    T.eq(heading.byPath[pathOf(heading, 'Two')].side, 'left', 'on a heading too');
    T.eq(doc.sideAt(heading, pathOf(heading, 'under')), 'left', 'and what is under it');
    var forest = doc.parse('# A\n\n- a1 <!-- side: left -->\n\n# B\n\n- b1\n');
    T.eq(doc.sideAt(forest, pathOf(forest, 'a1')), 'left', 'each root of a map with several has its own sides');
    T.eq(doc.sideAt(forest, pathOf(forest, 'b1')), 'right', 'and its own default');
    T.eq(doc.isTreeRoot(forest, pathOf(forest, 'B')), true, 'every top node is a tree root');
  });

  T.test('parse: other markers in any order, the side among them', function () {
    var s = doc.parse('# R\n\n- two <!-- color: #aabbcc branch --> <!-- side: left --> <!-- markmap: fold -->\n  - x\n');
    var two = s.byPath[pathOf(s, 'two')];
    T.eq(two.title, 'two', 'every marker peeled');
    T.eq(two.side, 'left', 'the side');
    T.eq(two.color, '#aabbcc', 'the colour');
    T.eq(two.fold, 'fold', 'the fold');
    T.eq(apply('# R\n\n- two <!-- color: #aabbcc branch --> <!-- side: left --> <!-- markmap: fold -->\n  - x\n', function (x, p) {
      return doc.setColor(x, p('two'), '#2f7d5a', { branch: true });
    }), '# R\n\n- two <!-- markmap: fold --> <!-- side: left --> <!-- color: #2f7d5a branch -->\n  - x\n',
      'written back in the canonical order: title, role, image, draw, fold, side, colour');
    T.eq(apply('# R\n\n- two <!-- side: left --> <!-- title: h2 -->\n', function (x, p) { return doc.setColor(x, p('two'), '#abc'); }),
      '# R\n\n- two <!-- title: h2 --> <!-- side: left --> <!-- color: #aabbcc -->\n', 'title first, colour last');
  });

  T.test('write: setSide, setSides, and what they leave alone', function () {
    T.eq(apply(MAP, function (x, p) { return doc.setSide(x, p('one'), 'left'); }),
      '# R\n\n- one <!-- side: left -->\n- two <!-- side: left -->\n  - inside\n- three\n', 'to the left: the marker');
    T.eq(apply(MAP, function (x, p) { return doc.setSide(x, p('two'), 'right'); }),
      '# R\n\n- one\n- two\n  - inside\n- three\n', 'to the right: no marker');
    T.eq(apply(MAP, function (x, p) { return doc.setSide(x, p('two'), 'left'); }), null, 'already there: nothing changes');
    T.eq(apply(MAP, function (x, p) { return doc.setSide(x, p('one'), 'right'); }), null, 'the right by default is already the right');
    T.eq(apply(MAP, function (x, p) { return doc.setSide(x, p('inside'), 'right'); }), null, 'a node that is no first-level branch has no side to set');
    T.eq(apply(MAP, function (x, p) { return doc.setSide(x, p('R'), 'left'); }), null, 'nor has the root');
    T.eq(apply('# R\n\n- one <!-- color: #aabbcc -->\n', function (x, p) { return doc.setSide(x, p('one'), 'left'); }),
      '# R\n\n- one <!-- side: left --> <!-- color: #aabbcc -->\n', 'before the colour, which stays last');
    var s = doc.parse(MAP);
    var many = {};
    many[pathOf(s, 'one')] = 'left';
    many[pathOf(s, 'two')] = 'right';
    many[pathOf(s, 'three')] = 'left';
    var r = doc.setSides(s, many);
    T.eq(r.text, '# R\n\n- one <!-- side: left -->\n- two\n  - inside\n- three <!-- side: left -->\n', 'several at once, one edit');
    T.eq(r.anchorLine, 2, 'anchored on the first line it changed');
    var same = {};
    same[pathOf(s, 'two')] = 'left';
    T.eq(doc.setSides(s, same), null, 'nothing to change: null (no undo step)');
    T.eq(apply('# R\n\n## Two\n\n- under\n', function (x, p) { return doc.setSide(x, p('Two'), 'left'); }),
      '# R\n\n## Two <!-- side: left -->\n\n- under\n', 'on a heading');
  });

  T.test('round trip: every other edit keeps the side', function () {
    T.eq(apply(MAP, function (x, p) { return doc.rename(x, p('two'), 'second'); }),
      '# R\n\n- one\n- second <!-- side: left -->\n  - inside\n- three\n', 'rename keeps it');
    T.eq(apply(MAP, function (x, p) { return doc.setColor(x, p('two'), '#c2703d'); }),
      '# R\n\n- one\n- two <!-- side: left --> <!-- color: #c2703d -->\n  - inside\n- three\n', 'a colour keeps it');
    T.eq(apply(MAP, function (x, p) { return doc.setTitleSize(x, p('two'), 'h2'); }),
      '# R\n\n- one\n- two <!-- title: h2 --> <!-- side: left -->\n  - inside\n- three\n', 'a size keeps it');
    T.eq(apply(MAP, function (x, p) { return doc.move(x, p('two'), -1); }),
      '# R\n\n- two <!-- side: left -->\n  - inside\n- one\n- three\n', 'a move carries it with the branch');
    T.eq(apply(MAP, function (x, p) { return doc.addSibling(x, p('two'), 'new'); }),
      '# R\n\n- one\n- two <!-- side: left -->\n  - inside\n- new <!-- side: left -->\n- three\n', 'a sibling added beside a left branch grows on the left');
    T.eq(apply(MAP, function (x, p) { return doc.addSibling(x, p('one'), 'new'); }),
      '# R\n\n- one\n- new\n- two <!-- side: left -->\n  - inside\n- three\n', 'beside a right branch, on the right');
    T.eq(apply(MAP, function (x, p) { return doc.addSibling(x, p('inside'), 'new'); }),
      '# R\n\n- one\n- two <!-- side: left -->\n  - inside\n  - new\n- three\n', 'deeper, no marker: it grows on its branch\'s side');
    T.eq(apply(MAP, function (x, p) { return doc.addChild(x, p('two'), 'new'); }),
      '# R\n\n- one\n- two <!-- side: left -->\n  - inside\n  - new\n- three\n', 'a child needs no marker');
    var s = doc.parse(MAP);
    T.eq(doc.parse(s.lines.join('\n')).byPath[pathOf(s, 'two')].side, 'left', 'parse of the same text, the same side');
    T.eq(doc.titleFor(s, pathOf(s, 'two')), 'two', 'the rename box never shows it');
  });

  T.test('a side this version does not know: read as the right, kept as written', function () {
    var text = '# R\n\n- up <!-- side: up -->\n- down <!-- side: down -->\n';
    var s = doc.parse(text);
    T.eq(s.byPath[pathOf(s, 'up')].title, 'up', 'peeled off the title all the same');
    T.eq(s.byPath[pathOf(s, 'up')].side, null, 'no side this version draws');
    T.eq(doc.sideAt(s, pathOf(s, 'up')), 'right', 'read as the right');
    T.same(doc.viewTree(s).children.map(function (v) { return v.side; }), ['right', 'right'], 'drawn on the right');
    T.eq(apply(text, function (x, p) { return doc.setColor(x, p('up'), '#abc'); }),
      '# R\n\n- up <!-- side: up --> <!-- color: #aabbcc -->\n- down <!-- side: down -->\n', 'kept, in its place, through another edit');
    T.eq(apply(text, function (x, p) { return doc.rename(x, p('down'), 'south'); }),
      '# R\n\n- up <!-- side: up -->\n- south <!-- side: down -->\n', 'and through a rename');
    T.eq(apply(text, function (x, p) { return doc.setSide(x, p('up'), 'left'); }),
      '# R\n\n- up <!-- side: left -->\n- down <!-- side: down -->\n', 'replaced when a side is chosen here');
    T.eq(apply(text, function (x, p) { return doc.setSide(x, p('up'), 'right'); }), null, 'already read as the right');
    T.eq(apply('# R\n\n- x <!-- side: right -->\n', function (x, p) { return doc.rename(x, p('x'), 'y'); }),
      '# R\n\n- y <!-- side: right -->\n', 'an explicit right written by hand stays');
  });

  T.test('stray sides: dropStraySides and titles that look like a marker', function () {
    var stray = '# R\n\n- one\n  - deep <!-- side: left -->\n  - odd <!-- side: up -->\n- two <!-- side: left -->\n';
    var s = doc.parse(stray);
    T.eq(doc.sideAt(s, pathOf(s, 'deep')), 'right', 'a marker below the first level is not read');
    T.eq(doc.dropStraySides(s, [pathOf(s, 'deep')]).text,
      '# R\n\n- one\n  - deep\n  - odd <!-- side: up -->\n- two <!-- side: left -->\n', 'only the node asked about');
    T.eq(doc.dropStraySides(s).text,
      '# R\n\n- one\n  - deep\n  - odd <!-- side: up -->\n- two <!-- side: left -->\n', 'every stray left; an unknown word and a first-level one stay');
    T.eq(doc.dropStraySides(doc.parse(MAP)), null, 'nothing stray: null');
    var down = doc.parse('# R\n\n- one\n  - mid\n    - low <!-- side: left -->\n  - other <!-- side: left -->\n');
    T.eq(doc.dropStraySides(down, [pathOf(down, 'mid')]).text,
      '# R\n\n- one\n  - mid\n    - low\n  - other <!-- side: left -->\n', 'a node asked about: it and everything under it, nothing beside');

    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.rename(x, p('one'), 'word <!-- side: left -->'); }),
      '# R\n\n- word \\<!-- side: left -->\n', 'typed into a title: escaped, never a marker');
    var typed = doc.parse('# R\n\n- word \\<!-- side: left -->\n');
    T.eq(typed.byPath[pathOf(typed, 'word <!-- side: left -->')] ? 'found' : 'missing', 'found', 'read back as words');
    T.eq(doc.sideAt(typed, typed.flat[1].path), 'right', 'and the node stays on the right');
  });
})();
