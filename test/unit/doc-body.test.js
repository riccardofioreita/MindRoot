/* MindRoot - golden tests of what a node carries besides its place in the
 * tree: the size of its title and the words under it (the earlier title
 * suite), the pictures in its two boxes (its pictures suite), drawings and
 * the board (its drawings and export suites) and notes (its notes suite). Only the document half of those suites is here:
 * the drawing half belongs to the map and its own tests. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var apply = D.apply;
  var pathOf = D.pathOf;
  var LF = '\n';

  /* ---------- the earlier title suite ---------- */

  T.test('title: the size of the title', function () {
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.setTitleSize(s, p('one'), 'h2'); }),
      '# R\n\n- one <!-- title: h2 -->\n', 'written at the end of the line');
    var s = doc.parse('# R\n\n- one <!-- title: h4 -->\n');
    T.eq(doc.titleSizeAt(s, pathOf(s, 'one')), 'h4', 'read back');
    T.eq(doc.titleSizeAt(doc.parse('# R\n\n- one\n'), '0'), null, 'none without a marker');
    T.eq(apply('# R\n\n- one <!-- title: h2 -->\n', function (x, p) { return doc.setTitleSize(x, p('one'), 'h2'); }),
      null, 'asking for the size it has changes nothing');
    T.eq(apply('# R\n\n- one <!-- title: h2 -->\n', function (x, p) { return doc.setTitleSize(x, p('one'), null); }),
      '# R\n\n- one\n', 'no size takes the marker off');
    T.eq(apply('# R\n\n- one <!-- title: h2 -->\n', function (x, p) { return doc.setTitleSize(x, p('one'), 'h9'); }),
      '# R\n\n- one\n', 'a size that does not exist is no size');
    var all = [];
    for (var i = 1; i <= 6; i++) {
      all.push(apply('# R\n\n- one\n', (function (n) {
        return function (x, p) { return doc.setTitleSize(x, p('one'), 'H' + n); };
      })(i)).split(LF)[2]);
    }
    T.eq(all.join(' | '), '- one <!-- title: h1 --> | - one <!-- title: h2 --> | - one <!-- title: h3 --> | ' +
      '- one <!-- title: h4 --> | - one <!-- title: h5 --> | - one <!-- title: h6 -->', 'all six, any case');
    T.eq(apply('# R\n\n- one <!-- color: #ff0000 -->\n', function (x, p) { return doc.setTitleSize(x, p('one'), 'h3'); }),
      '# R\n\n- one <!-- title: h3 --> <!-- color: #ff0000 -->\n', 'the size keeps the colour');
    T.eq(apply('# R\n\n- one <!-- title: h3 -->\n', function (x, p) { return doc.setColor(x, p('one'), '#ff0000'); }),
      '# R\n\n- one <!-- title: h3 --> <!-- color: #ff0000 -->\n', 'and the colour keeps the size');
    var h = doc.parse('# R\n\n## A <!-- title: h6 -->\n\n### B\n');
    T.eq(h.byPath[pathOf(h, 'A')].level, 2, 'the size does not change the level');
    T.eq(h.byPath[pathOf(h, 'A')].kind, 'heading', 'nor the kind');
    T.eq(doc.parentPath(pathOf(h, 'B')), pathOf(h, 'A'), 'and the child stays a child');
  });

  T.test('title: caption and size are one choice; old roles are sizes', function () {
    T.eq(apply('# R\n\n- one <!-- role: caption -->\n', function (x, p) { return doc.setTitleSize(x, p('one'), 'h2'); }),
      '# R\n\n- one <!-- title: h2 -->\n', 'a size puts the caption down');
    T.eq(apply('# R\n\n- one <!-- title: h2 -->\n', function (x, p) { return doc.setRole(x, p('one'), 'caption'); }),
      '# R\n\n- one <!-- role: caption -->\n', 'a caption puts the size down');
    T.eq(apply('# R\n\n- one <!-- title: h2 -->\n- two <!-- role: caption -->\n', function (x, p) { return doc.setRole(x, p('two'), 'paragraph'); }),
      '# R\n\n- one <!-- title: h2 -->\n- two\n', 'clearing one node touches no other');
    var s = doc.parse('# R\n\n- one <!-- role: title -->\n- two <!-- role: subtitle -->\n- three <!-- role: caption -->\n');
    T.eq(doc.titleSizeAt(s, pathOf(s, 'one')), 'h2', 'the old title reads as h2');
    T.eq(doc.titleSizeAt(s, pathOf(s, 'two')), 'h3', 'the old subtitle as h3');
    T.eq(doc.roleAt(s, pathOf(s, 'one')), 'paragraph', 'neither is a role any more');
    T.eq(doc.roleAt(s, pathOf(s, 'three')), 'caption', 'caption still is');
    T.eq(apply('# R\n\n- one <!-- role: title -->\n', function (x, p) { return doc.setColor(x, p('one'), '#ff0000'); }),
      '# R\n\n- one <!-- title: h2 --> <!-- color: #ff0000 -->\n', 'the first rewrite writes the new marker');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.setRole(x, p('one'), 'title'); }), null, 'the old roles cannot be chosen');
  });

  T.test('title: the words under the line', function () {
    T.eq(apply('# R\n\n- WHAT IT DOES\n', function (s, p) { return doc.setBody(s, p('WHAT IT DOES'), 'It is the verification process.'); }),
      '# R\n\n- WHAT IT DOES\n  - > text: It is the verification process.\n', 'written as a quoted child');
    T.eq(doc.bodyFor(doc.parse('# R\n\n- one\n  - > text: two words\n'), '0'), 'two words', 'read back');
    T.eq(doc.bodyFor(doc.parse('# R\n\n- one\n'), '0'), '', 'none: empty');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.setBody(s, p('one'), 'first\nsecond'); }),
      '# R\n\n- one\n  - > text: first\n    > second\n', 'several lines stay quoted');
    T.eq(doc.bodyFor(doc.parse('# R\n\n- one\n  - > text: first\n    > second\n'), '0'), 'first\nsecond', 'and come back as one');
    T.eq(apply('# R\n\n- one\n  - > text: first\n    > second\n', function (s, p) { return doc.setBody(s, p('one'), 'alone'); }),
      '# R\n\n- one\n  - > text: alone\n', 'shorter takes the extra lines away');
    T.eq(apply('# R\n\n- one\n  - > text: first\n    > second\n', function (s, p) { return doc.setBody(s, p('one'), ''); }),
      '# R\n\n- one\n', 'emptied, it leaves the file');
    T.eq(apply('# R\n\n## A\n\n### B\n', function (s, p) { return doc.setBody(s, p('A'), 'its words'); }),
      '# R\n\n## A\n- > text: its words\n\n### B\n', 'under a heading, right under the line');
  });

  T.test('title: one of the two is enough', function () {
    T.eq(doc.parse('# R\n\n- \n  - > text: just words\n').flat.length, 1, 'an empty bullet is not a node');
    T.eq(apply('# R\n\n- WHAT IT DOES\n  - > text: just words\n', function (s, p) { return doc.setTitleSize(s, p('WHAT IT DOES'), 'h2'); }),
      '# R\n\n- WHAT IT DOES <!-- title: h2 -->\n  - > text: just words\n', 'a size on a node with words');
    /* The previous app wrote an empty '- ' here and relied on the editor to
     * move the words up first; an empty item is no node (its words would
     * hang from the node above), so the model now does it in the same edit. */
    T.eq(apply('# R\n\n- WHAT IT DOES\n  - > text: its words\n', function (s, p) { return doc.rename(s, p('WHAT IT DOES'), ''); }),
      '# R\n\n- its words\n', 'a node with words is not called untitled: they come up to its line');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (s, p) { return doc.rename(s, p('one'), ''); }),
      '# R\n\n- ![](assets/a.png)\n', 'nor one with a picture');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.rename(s, p('one'), ''); }),
      '# R\n\n- untitled\n', 'a node left with nothing is');
  });

  T.test('title: the four ways of writing the words', function () {
    T.eq(apply('# R\n\n- one\n  - > text: its words\n', function (s, p) { return doc.setBodyRole(s, p('one'), 'caption'); }),
      '# R\n\n- one\n  - > text: its words <!-- role: caption -->\n', 'at the end of the first line');
    T.eq(doc.bodyRoleAt(doc.parse('# R\n\n- one\n  - > text: words <!-- role: subtitle -->\n'), '0'), 'subtitle', 'read back');
    T.eq(doc.bodyRoleAt(doc.parse('# R\n\n- one\n  - > text: words\n'), '0'), 'paragraph', 'none is a paragraph');
    T.eq(doc.bodyRoleAt(doc.parse('# R\n\n- one\n'), '0'), null, 'no words, nothing to ask');
    T.eq(doc.bodyFor(doc.parse('# R\n\n- one\n  - > text: words <!-- role: caption -->\n'), '0'), 'words', 'the marker is not in the words');
    T.eq(apply('# R\n\n- one\n  - > text: words <!-- role: title -->\n', function (s, p) { return doc.setBodyRole(s, p('one'), 'paragraph'); }),
      '# R\n\n- one\n  - > text: words\n', 'paragraph takes the marker off');
    T.eq(apply('# R\n\n- one\n  - > text: words <!-- role: caption -->\n', function (s, p) { return doc.setBody(s, p('one'), 'new words'); }),
      '# R\n\n- one\n  - > text: new words <!-- role: caption -->\n', 'rewriting the words keeps the role');
    T.eq(apply('# R\n\n- one\n  - > text: words <!-- role: caption -->\n', function (s, p) { return doc.setBody(s, p('one'), 'first\nsecond'); }),
      '# R\n\n- one\n  - > text: first <!-- role: caption -->\n    > second\n', 'on several lines it stays on the first');
    var s = doc.parse('# R\n\n- one <!-- title: h2 -->\n  - > text: words <!-- role: caption -->\n');
    T.eq(doc.titleSizeAt(s, '0') + '/' + doc.bodyRoleAt(s, '0'), 'h2/caption', 'the body\'s role is not the line\'s');
  });

  T.test('title: the body is neither a node nor a note', function () {
    var s = doc.parse('# R\n\n- one\n  - > text: its words\n  - real child\n');
    var one = s.byPath[pathOf(s, 'one')];
    T.eq(doc.childEntries(s, one).length, 1, 'not among the children');
    T.eq(doc.plainText(doc.childEntries(s, one)[0]), 'real child', 'the real child is there');
    T.eq(s.notes.length, 0, 'not among the notes');
    T.eq(doc.noteFor(s, pathOf(s, 'one'), 'node'), null, 'and not a node note');
    var both = doc.parse('# R\n\n- one\n  - > text: words\n  - > note: jotting\n');
    T.eq(doc.bodyFor(both, '0') + '/' + doc.noteFor(both, '0', 'node').text, 'words/jotting', 'body and note side by side');
    T.eq(both.notes.length, 1, 'one note');
    T.eq(doc.stripNotes('# R\n\n- one\n  - > text: words\n  - > note: jotting\n'), '# R\n\n- one\n  - > text: words\n', 'stripNotes keeps the body');
  });

  T.test('title: the body travels with its node', function () {
    T.eq(apply('# R\n\n- one\n  - > text: words\n- two\n', function (s, p) { return doc.move(s, p('one'), 1); }),
      '# R\n\n- two\n- one\n  - > text: words\n', 'moved');
    T.eq(apply('# R\n\n- one\n  - > text: words\n- two\n', function (s, p) { return doc.remove(s, p('one')); }),
      '# R\n\n- two\n', 'deleted');
    T.eq(apply('# R\n\n- one <!-- title: h2 -->\n  - > text: words\n', function (s, p) { return doc.rename(s, p('one'), 'single'); }),
      '# R\n\n- single <!-- title: h2 -->\n  - > text: words\n', 'renaming leaves it alone');
    var text = '# Root\n\n## WHAT IT DOES <!-- title: h2 --> <!-- color: #c2703d -->\n- > text: It is the verification process\n  > on two lines\n\n- other\n';
    var again = doc.parse(doc.parse(text).text);
    T.eq(again.text, text, 'round trip: the text');
    T.eq(doc.titleSizeAt(again, pathOf(again, 'WHAT IT DOES')), 'h2', 'round trip: the size');
    T.eq(doc.bodyFor(again, pathOf(again, 'WHAT IT DOES')), 'It is the verification process\non two lines', 'round trip: the words');
    T.eq(doc.colorAt(again, pathOf(again, 'WHAT IT DOES')), '#c2703d', 'round trip: the colour');
  });

  T.test('the body keeps every marker when rewritten (bug fixed)', function () {
    /* The previous setBody/setBodyRole rewrote the first line without
     * <!-- draw: above -->, silently. */
    var t = '# R\n\n- one\n  - > text: ![](assets/d.ink.svg) words <!-- draw: above -->\n';
    T.eq(apply(t, function (s, p) { return doc.setBody(s, p('one'), 'others'); }),
      '# R\n\n- one\n  - > text: ![](assets/d.ink.svg) others <!-- draw: above -->\n', 'setBody');
    T.eq(apply(t, function (s, p) { return doc.setBodyRole(s, p('one'), 'caption'); }),
      '# R\n\n- one\n  - > text: ![](assets/d.ink.svg) words <!-- role: caption --> <!-- draw: above -->\n', 'setBodyRole');
    T.eq(apply('# R\n\n- one\n  - > text: words\n', function (s, p) { return doc.setBody(s, p('one'), 'x <!-- role: caption -->'); }),
      '# R\n\n- one\n  - > text: x \\<!-- role: caption -->\n', 'typed words that look like a marker stay words');
    var typed = doc.parse('# R\n\n- one\n  - > text: x \\<!-- role: caption -->\n');
    T.eq(doc.bodyRoleAt(typed, '0'), 'paragraph', 'and are not read as one');
    T.eq(doc.bodyFor(typed, '0'), 'x <!-- role: caption -->', 'the body field shows what was typed');
    T.eq(doc.setBody(typed, '0', doc.bodyFor(typed, '0')), null, 'and writing it back changes nothing');
  });

  /* ---------- the earlier pictures suite ---------- */

  T.test('pictures: the picture goes into the box asked for', function () {
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', '', 'line'); }),
      '# R\n\n- ![](assets/a.png) one\n', 'on the line, in front of the words');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', ''); }),
      '# R\n\n- ![](assets/a.png) one\n', 'no box named is the line');
    T.eq(apply('# R\n\n- one\n  - > text: words\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', '', 'body'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) words\n', 'in the body, into the words');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', '', 'body'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png)\n', 'a body is made for it');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/b.png', '', 'body'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) ![](assets/b.png) words\n', 'beside the first');
    T.eq(apply('# R\n\n- one\n  - > text: words\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', 'photo.png', 'body'); }),
      '# R\n\n- one\n  - > text: ![photo.png](assets/a.png) words\n', 'with its alt text');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/my pic.png', 'a [b]'); }),
      '# R\n\n- ![a \\[b\\]](<assets/my pic.png>) one\n', 'a path with spaces and an alt with brackets stay readable');
  });

  T.test('pictures: words are words, pictures are pictures', function () {
    var s = doc.parse('# R\n\n- ![](assets/a.png) one\n  - > text: ![](assets/b.png) words\n');
    var path = pathOf(s, 'one');
    T.eq(doc.bodyFor(s, path), 'words', 'body without the picture');
    T.eq(doc.labelOf(s.byPath[path]), 'one', 'line without the picture');
    T.eq(doc.imagesIn(s, path, 'body'), '![](assets/b.png)', 'pictures of the body');
    T.eq(doc.imagesIn(s, path, 'line'), '![](assets/a.png)', 'pictures of the line');
    T.eq(doc.imagesOf(s.byPath[path]), '![](assets/a.png) ![](assets/b.png)', 'the node has both');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (x, p) { return doc.setBody(x, p('one'), 'other words'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) other words\n', 'rewriting words keeps the picture');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (x, p) { return doc.setBody(x, p('one'), ''); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png)\n', 'emptying them leaves the picture');
    T.eq(apply('# R\n\n- one\n  - > text: words\n', function (x, p) { return doc.setBody(x, p('one'), ''); }),
      '# R\n\n- one\n', 'with no picture the block goes');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (x, p) { return doc.setBody(x, p('one'), 'first\nsecond'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) first\n    > second\n', 'on several lines the picture leads the first');
  });

  T.test('pictures: where the picture stands, in either box', function () {
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (s, p) { return doc.setImagePosition(s, p('one'), 'right', 'body'); }),
      '# R\n\n- one\n  - > text: words ![](assets/a.png)\n', 'right, in the body');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) first\n    > second\n', function (s, p) { return doc.setImagePosition(s, p('one'), 'right', 'body'); }),
      '# R\n\n- one\n  - > text: first\n    > second ![](assets/a.png)\n', 'right is the end of the last line');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (s, p) { return doc.setImagePosition(s, p('one'), 'above', 'body'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- image: above -->\n', 'above, with the marker');
    T.eq(doc.imagePositionAt(doc.parse('# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- image: above -->\n'), '0', 'body'), 'above', 'read back');
    var both = doc.parse('# R\n\n- ![](assets/a.png) one\n  - > text: words ![](assets/b.png)\n');
    T.eq(doc.imagePositionAt(both, '0', 'line') + ' / ' + doc.imagePositionAt(both, '0', 'body'), 'left / right', 'each box answers for itself');
    T.eq(doc.imagePositionAt(doc.parse('# R\n\n- one\n  - > text: words\n'), '0', 'body'), null, 'no picture, no position');
    T.eq(doc.imagePositionAt(doc.parse('# R\n\n- one\n  - > text: ![](assets/a.png)\n'), '0', 'body'), null, 'only a picture, no position');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- role: caption -->\n', function (s, p) { return doc.setImagePosition(s, p('one'), 'above', 'body'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- role: caption --> <!-- image: above -->\n', 'with the role marker');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- role: caption --> <!-- image: above -->\n', function (s, p) { return doc.setBody(s, p('one'), 'others'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) others <!-- role: caption --> <!-- image: above -->\n', 'rewriting keeps both');
    var rev = doc.parse('# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- image: above --> <!-- role: caption -->\n');
    T.eq(doc.imagePositionAt(rev, '0', 'body') + ' / ' + doc.bodyRoleAt(rev, '0') + ' / ' + doc.bodyFor(rev, '0'),
      'above / caption / words', 'written in reverse order, read the same');
  });

  T.test('pictures: taking a picture off', function () {
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) ![](assets/b.png) words\n', function (s, p) { return doc.removeImage(s, p('one'), 'body'); }),
      '# R\n\n- one\n  - > text: ![](assets/a.png) words\n', 'the last one in goes first');
    T.eq(doc.lastImagePath(doc.parse('# R\n\n- one\n  - > text: ![](assets/a.png) ![](assets/b.png) words\n'), '0', 'body'), 'assets/b.png', 'its file is known first');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words\n', function (s, p) { return doc.removeImage(s, p('one'), 'body'); }),
      '# R\n\n- one\n  - > text: words\n', 'the words stay');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png)\n', function (s, p) { return doc.removeImage(s, p('one'), 'body'); }),
      '# R\n\n- one\n', 'without words the block goes');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- image: above -->\n', function (s, p) { return doc.removeImage(s, p('one'), 'body'); }),
      '# R\n\n- one\n  - > text: words\n', 'and its marker');
    T.eq(apply('# R\n\n- ![](assets/a.png) one <!-- color: #ff0000 -->\n', function (s, p) { return doc.removeImage(s, p('one'), 'line'); }),
      '# R\n\n- one <!-- color: #ff0000 -->\n', 'on the line too');
    T.eq(apply('# R\n\n- ![](assets/a.png)\n', function (s) { return doc.removeImage(s, s.flat[1].path, 'line'); }),
      '# R\n\n- untitled\n', 'a picture-only node stays a node');
    T.eq(apply('# R\n\n- one\n  - > text: words\n', function (s, p) { return doc.removeImage(s, p('one'), 'body'); }), null, 'nothing to take');
    T.eq(doc.lastImagePath(doc.parse('# R\n\n- <img src="assets/x y.png" alt="x"> one\n'), '0', 'line'), 'assets/x y.png', 'an <img> names its file');
    T.eq(apply('# R\n\n- one\n  - > text: ![](assets/a.png) ![](assets/b.png) words\n', function (s, p) { return doc.removeImage(s, p('one'), 'body', doc.PHOTO, 'assets/a.png'); }),
      '# R\n\n- one\n  - > text: ![](assets/b.png) words\n', 'one picture by its file, not the last one');
    T.eq(apply('# R\n\n- ![](assets/x.book/001.ink.svg) ![](assets/y.book/001.ink.svg) one\n', function (s, p) { return doc.removeImage(s, p('one'), 'line', doc.DRAW, 'assets/x.book/002.ink.svg'); }),
      '# R\n\n- ![](assets/y.book/001.ink.svg) one\n', 'a notebook by any page of its folder');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (s, p) { return doc.removeImage(s, p('one'), 'line', doc.PHOTO, 'assets/zzz.png'); }), null, 'a file it does not show: nothing');
  });

  T.test('pictures: round trip and style flags', function () {
    var text = '# Root\n\n- ![](assets/a.png) one <!-- title: h2 -->\n' +
      '  - > text: ![](assets/b.png) words <!-- role: caption --> <!-- image: above -->\n    > and a second line\n';
    var again = doc.parse(doc.parse(text).text);
    var path = pathOf(again, 'one');
    T.eq(again.text, text, 'the text');
    T.eq(doc.bodyFor(again, path), 'words\nand a second line', 'the words');
    T.eq(doc.imagesIn(again, path, 'body'), '![](assets/b.png)', 'the body picture');
    T.eq(doc.bodyRoleAt(again, path), 'caption', 'the role');
    T.eq(doc.imagePositionAt(again, path, 'body'), 'above', 'the place');
    var flag = doc.styleFlags(doc.parse('# R\n\n- one\n  - > text: ![](assets/a.png) words <!-- image: above -->\n'))['0'];
    T.eq(flag.body, 'words', 'flags split words');
    T.eq(flag.bodyImages, '![](assets/a.png)', 'and pictures');
    T.eq(flag.bodyAbove, true, 'and the place');
  });

  /* ---------- the earlier drawings suite (the file half) ---------- */

  T.test('drawings: a drawing is known by its name', function () {
    T.eq(doc.isDrawingPath('assets/kyc.excalidraw.svg'), true, 'the double suffix');
    T.eq(doc.isDrawingPath('assets/sketch.ink.svg'), true, 'and the new one');
    T.eq(doc.isDrawingPath('assets/logo.svg'), false, 'a plain SVG is not');
    T.eq(doc.isDrawingPath('assets/win-20241222.jpg'), false, 'nor a photo');
    T.eq(doc.isDrawingPath('assets/KYC.Excalidraw.SVG'), true, 'in any case');
    T.eq(doc.kindOfImage('![](assets/a.ink.svg)'), doc.DRAW, 'kindOfImage on markup');
    T.eq(doc.kindOfImage('<img src="assets/a.excalidraw.svg">'), doc.DRAW, 'on an <img>');
    T.eq(doc.kindOfImage('assets/a.png'), doc.PHOTO, 'on a path');
  });

  T.test('drawings: the board marker', function () {
    var plain = '# Root\n\n- one\n';
    var s0 = doc.parse(plain);
    T.eq(doc.boardPath(s0), null, 'no marker, no board');
    T.eq(doc.boardPlacement(s0), null, 'nor a place');
    var written = doc.setBoard(s0, 'assets/kyc.excalidraw.svg', { x: 10, y: 20, w: 300, h: 200 }).text;
    T.eq(written, '<!-- board: assets/kyc.excalidraw.svg | 10,20,300,200 -->\n\n' + plain, 'written at the top');
    var s1 = doc.parse(written);
    T.eq(doc.boardPath(s1), 'assets/kyc.excalidraw.svg', 'read back');
    T.same(doc.boardPlacement(s1), { x: 10, y: 20, w: 300, h: 200 }, 'with its place');
    var moved = doc.parse(doc.setBoard(s1, 'assets/kyc.excalidraw.svg', { x: 44, y: 0, w: 300, h: 200 }).text);
    T.eq(moved.lines.filter(function (l) { return /<!--\s*board/i.test(l); }).length, 1, 'moving rewrites the same line');
    T.same(doc.boardPlacement(moved), { x: 44, y: 0, w: 300, h: 200 }, 'with the new place');
    T.eq(doc.setBoard(s1, 'assets/kyc.excalidraw.svg', { x: 10, y: 20, w: 300, h: 200 }), null, 'the same place changes nothing');
    var bare = doc.parse(doc.setBoard(s0, 'assets/kyc.excalidraw.svg', null).text);
    T.eq(bare.lines[0], '<!-- board: assets/kyc.excalidraw.svg -->', 'without a place, only the path');
    T.eq(doc.boardPath(bare), 'assets/kyc.excalidraw.svg', 'still read');
    T.eq(doc.boardPlacement(bare), null, 'with no place');
    T.eq(doc.setBoard(s1, null).text, plain, 'taking it off restores the file');
    T.eq(doc.setBoard(s0, null), null, 'and when there is none, nothing');
    T.eq(s1.flat.length, s0.flat.length, 'the board is not a node');
    T.eq(doc.plainText(s1.flat[0]), doc.plainText(s0.flat[0]), 'the root reads the same');
    T.ok(doc.imageRefs(s1).indexOf('assets/kyc.excalidraw.svg') >= 0, 'the board is a used file');
    T.eq(doc.imageRefs(s0).length, 0, 'and without it nothing is');
    var both = doc.parse(doc.setBoard(doc.parse('# R\n\n- one ![](assets/kyc.excalidraw.svg)\n'), 'assets/kyc.excalidraw.svg', null).text);
    T.eq(doc.imageRefs(both).filter(function (r) { return r === 'assets/kyc.excalidraw.svg'; }).length, 1, 'counted once');
    var fm = doc.setBoard(doc.parse('---\ntitle: x\n---\n# R\n'), 'assets/b.ink.svg', null).text;
    T.eq(fm, '---\ntitle: x\n---\n<!-- board: assets/b.ink.svg -->\n\n# R\n', 'after front matter, which must stay first');
    var live = doc.parse(written);
    var renamed = doc.parse(doc.rename(live, pathOf(live, 'one'), 'first').text);
    T.eq(doc.boardPath(renamed), 'assets/kyc.excalidraw.svg', 'renaming leaves the board');
    var added = doc.parse(doc.addChild(renamed, pathOf(renamed, 'first'), 'below', null).text);
    T.eq(doc.boardPath(added), 'assets/kyc.excalidraw.svg', 'adding too');
    T.eq(added.lines[0].indexOf('<!-- board:'), 0, 'and it stays the first line');
  });

  T.test('drawings: a node drawing is a picture like the others', function () {
    var withDrawing = apply('# R\n\n- one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/one.excalidraw.svg', '', 'line'); });
    T.eq(withDrawing, '# R\n\n- ![](assets/one.excalidraw.svg) one\n', 'written as a picture');
    var sd = doc.parse(withDrawing);
    T.eq(doc.imagesIn(sd, '0', 'line', doc.DRAW), '![](assets/one.excalidraw.svg)', 'among the drawings');
    T.eq(doc.imagesIn(sd, '0', 'line', doc.PHOTO), '', 'not among the photos');
    T.eq(doc.labelOf(doc.entryAt(sd, '0')), 'one', 'the words stay the words');

    var mixed = '# R\n\n- ![](assets/f.png) one ![](assets/d.excalidraw.svg)\n';
    var ms = doc.parse(mixed);
    T.eq(doc.imagePositionAt(ms, '0', 'line', doc.PHOTO) + ' / ' + doc.imagePositionAt(ms, '0', 'line', doc.DRAW), 'left / right', 'two groups, two places');
    T.eq(doc.labelOf(doc.entryAt(ms, '0')), 'one', 'clean words');
    T.eq(apply(mixed, function (s) { return doc.setImagePosition(s, '0', 'left', 'line', doc.DRAW); }),
      '# R\n\n- ![](assets/f.png) ![](assets/d.excalidraw.svg) one\n', 'moving the drawing leaves the photo');
    T.eq(apply(mixed, function (s) { return doc.setImagePosition(s, '0', 'right', 'line', doc.PHOTO); }),
      '# R\n\n- one ![](assets/d.excalidraw.svg) ![](assets/f.png)\n', 'moving the photo leaves the drawing');
    var lifted = apply(mixed, function (s) { return doc.setImagePosition(s, '0', 'above', 'line', doc.DRAW); });
    T.eq(lifted, '# R\n\n- ![](assets/f.png) ![](assets/d.excalidraw.svg) one <!-- draw: above -->\n', 'the drawing above has its marker');
    var ls = doc.parse(lifted);
    T.eq(doc.imagePositionAt(ls, '0', 'line', doc.DRAW), 'above', 'read above');
    T.eq(doc.imagePositionAt(ls, '0', 'line', doc.PHOTO), 'left', 'the photo stayed left');
    var up = apply(lifted, function (s) { return doc.setImagePosition(s, '0', 'above', 'line', doc.PHOTO); });
    T.eq(up, '# R\n\n- ![](assets/f.png) ![](assets/d.excalidraw.svg) one <!-- image: above --> <!-- draw: above -->\n', 'both above, both written');
    var gone = apply(up, function (s) { return doc.removeImage(s, '0', 'line', doc.DRAW); });
    T.eq(gone, '# R\n\n- ![](assets/f.png) one <!-- image: above -->\n', 'taking the drawing off leaves the photo and its marker');
    var body = '# R\n\n- one\n  - > text: ![](assets/f.png) words ![](assets/d.excalidraw.svg)\n';
    var bs = doc.parse(body);
    T.eq(doc.imagePositionAt(bs, '0', 'body', doc.PHOTO) + ' / ' + doc.imagePositionAt(bs, '0', 'body', doc.DRAW), 'left / right', 'in the body too');
    T.eq(apply(body, function (s) { return doc.setImagePosition(s, '0', 'above', 'body', doc.DRAW); }),
      '# R\n\n- one\n  - > text: ![](assets/f.png) ![](assets/d.excalidraw.svg) words <!-- draw: above -->\n', 'the body drawing rises alone');
    T.eq(apply(mixed, function (s) { return doc.rename(s, '0', 'two'); }),
      '# R\n\n- ![](assets/f.png) two ![](assets/d.excalidraw.svg)\n', 'rename keeps each group on its side');
    T.eq(apply(body, function (s) { return doc.setBody(s, '0', 'others'); }),
      '# R\n\n- one\n  - > text: ![](assets/f.png) others ![](assets/d.excalidraw.svg)\n', 'and so does rewriting the words');
  });

  T.test('drawings / export: what an export leaves out', function () {
    var mixed = '<!-- board: assets/kyc.excalidraw.svg | 0,0,1,1 -->\n\n# Root\n\n- one ![](assets/photo.png)\n' +
      '- two ![](assets/two.excalidraw.svg)\n- ![](assets/lone.excalidraw.svg)\n- three ![](assets/t.ink.svg)\n';
    var stripped = doc.stripDrawings(mixed);
    T.eq(stripped.indexOf('board:'), -1, 'the board marker goes');
    T.eq(stripped.indexOf('kyc.excalidraw.svg'), -1, 'with its file');
    T.ok(stripped.indexOf('- two') >= 0, 'a drawing beside words leaves the words');
    T.eq(stripped.indexOf('two.excalidraw.svg'), -1, 'but not the drawing');
    T.ok(stripped.indexOf('lone.excalidraw.svg') === -1 && !/^\s*-\s*$/m.test(stripped), 'a line that was only a drawing goes');
    T.ok(stripped.indexOf('![](assets/photo.png)') >= 0, 'the photo stays');
    T.eq(stripped.indexOf('.ink.svg'), -1, 'ink drawings go too');
    T.ok(doc.stripDrawings(mixed) !== mixed, 'something changed');
    var bothOff = doc.stripDrawings(doc.stripNotes(mixed + '  - > note: a note\n'));
    T.ok(bothOff.indexOf('note:') === -1 && bothOff.indexOf('excalidraw') === -1, 'notes and drawings strip independently');
    T.ok(bothOff.indexOf('# Root') >= 0 && bothOff.indexOf('- one') >= 0, 'and the document is still there');
    T.eq(doc.stripDrawings('# R\n- a  \n'), '# R\n- a  \n', 'lines without drawings are not touched');
    T.eq(doc.stripDrawings('# R\n- [ ] ![](assets/d.ink.svg)\n- [ ]\n'), '# R\n- [ ]\n', 'a to-do that was only a drawing goes, an empty one written so stays');
  });

  T.test('the files a text names (bugs fixed)', function () {
    T.same(doc.refsInText('<!-- board: assets/l.excalidraw.svg | 1,2,3,4 -->\n\n# R\n- ![](assets/a.png) a ![](assets/b.png)\n'),
      ['assets/l.excalidraw.svg', 'assets/a.png', 'assets/b.png'], 'pictures and the board');
    /* The previous scanner missed these, and the trash offered to delete
     * files that maps still used. */
    T.same(doc.refsInText('- <img src="assets/x.png" alt="x"> a\n- ![](<assets/my pic.png>) b\n- ![](assets/my%20pic.png) c\n- ![](assets/loose name.png) d\n'),
      ['assets/x.png', 'assets/my pic.png', 'assets/my%20pic.png', 'assets/loose name.png'], '<img>, angle brackets, %20, spaces');
    T.same(doc.refsInText('![](data:image/png;base64,AAA) ![](https://x.org/a.png) ![](assets/a.png) ![](assets/a.png)'),
      ['assets/a.png'], 'URLs are not files, and each file once');
    T.eq(doc.renameRef('<!-- board: assets/a.png -->\n- ![x](assets/a.png) ![](assets/a.png.bak)', 'assets/a.png', 'assets/a-2.png'),
      '<!-- board: assets/a-2.png -->\n- ![x](assets/a-2.png) ![](assets/a.png.bak)', 'renaming a file in a text');
    T.eq(doc.renameRef('- <img src="assets/a.png"> ![](<assets/a.png>)', 'assets/a.png', 'assets/b c.png'),
      '- <img src="assets/b c.png"> ![](<assets/b c.png>)', 'in <img> and angle brackets');
    T.eq(doc.renameRef('x', '', 'y'), 'x', 'nothing to rename');
  });

  /* ---------- the earlier notes suite (the file half) ---------- */

  T.test('note: writing, rewriting, several lines', function () {
    var SOURCE = '# R\n\n- one\n  - > nota: reminder\n  - > arco: depends\n- two\n';
    var s = doc.parse(SOURCE);
    T.eq(s.flat.length, 3, 'two notes do not become nodes');
    T.eq(doc.noteFor(s, pathOf(s, 'one'), 'node').text, 'reminder', 'the node note');
    T.eq(doc.setNote(s, pathOf(s, 'one'), 'node', 'reminder rewritten').text,
      '# R\n\n- one\n  - > note: reminder rewritten\n  - > arco: depends\n- two\n', 'rewritten note, English word');
    var added = doc.setNote(s, pathOf(s, 'two'), 'node', 'second').text;
    T.eq(added, SOURCE + '  - > note: second\n', 'a new note on a node that had none');
    T.eq(doc.setNote(doc.parse(added), '1', 'node', '').text, SOURCE, 'emptied, it goes');
    var MULTI = 'first line\nsecond line';
    var multi = doc.setNote(s, pathOf(s, 'two'), 'node', MULTI).text;
    T.eq(multi, SOURCE + '  - > note: first line\n    > second line\n', 'lines after the first stay quoted');
    var reread = doc.parse(multi);
    T.eq(reread.notes.length, 3, 'three notes on rereading');
    T.eq(doc.noteFor(reread, '1', 'node').text, MULTI, 'the long one keeps its break');
    T.eq(reread.flat.length, s.flat.length, 'the extra line is no node');
    T.eq(doc.stripNotes(multi), '# R\n\n- one\n- two\n', 'no orphan lines when notes are stripped');
    T.eq(doc.sanitizeNote('a\n\n   \nb\n\n'), 'a\n\nb', 'a run of blank lines is one paragraph break; none at the ends');
    var gap = doc.parse(doc.setNote(doc.parse('# R\n\n- one\n'), '0', 'node', 'line one\nline two\n\nline four').text);
    T.eq(doc.noteFor(gap, '0', 'node').text, 'line one\nline two\n\nline four', 'the paragraph break in a note is kept');
    T.eq(/\n {4}>\n {4}> line four/.test(doc.setNote(doc.parse('# R\n\n- one\n'), '0', 'node', 'line one\n\nline four').text), true, 'written as an empty quote line');
    T.eq(doc.setNote(doc.parse(multi), '1', 'node', '').text, SOURCE, 'emptied, all its lines go');
    T.eq(doc.setNote(s, '0', 'node', 'reminder'), null, 'the same note changes nothing');
    T.eq(doc.setNote(s, '0', 'nonsense', 'x'), null, 'an unknown kind does nothing');
    T.eq(doc.noteMarkup('edge', 'a\nb'), '- > edge: a b', 'noteMarkup');
  });

  T.test('note: a new note goes after the words that run on from the line', function () {
    /* Put straight under the line, a note would swallow them: CommonMark
     * reads a plain line after a quote as more of the quote. */
    T.eq(apply('# H\nPara one\nmore\n\nPara two\n', function (x) { return doc.setNote(x, '', 'node', 'n'); }),
      '# H\nPara one\nmore\n- > note: n\n\nPara two\n', 'after the heading\'s first paragraph');
    var item = apply('# H\n\n- item\n  continued\n  - child\n', function (x, p) { return doc.setNote(x, p('item'), 'node', 'n'); });
    T.eq(item, '# H\n\n- item\n  continued\n  - > note: n\n  - child\n', 'after an item\'s text, ahead of its children');
    var again = doc.parse(item);
    T.eq(doc.noteFor(again, '0', 'node').text, 'n', 'still the item\'s note');
    T.eq(doc.viewTree(again).children[0].body.text, 'continued', 'and the text is still the item\'s');
    T.eq(apply('# H\n\n```\ncode\n```\n', function (x) { return doc.setBody(x, '', 'words'); }),
      '# H\n- > text: words\n\n```\ncode\n```\n', 'a blank line or a fence ends the run');
  });

  T.test('note: under numbered items, notes nest at the content column', function () {
    T.eq(apply('# R\n\n1. one\n', function (x, p) { return doc.setNote(x, p('one'), 'node', 'n'); }),
      '# R\n\n1. one\n   - > note: n\n', 'three columns under "1."');
    T.eq(doc.parse('# R\n\n1. one\n   - > note: n\n   - child\n').flat.length, 3, 'and the note is no node');
  });

  T.test('note: no branch colour sits near the note violet', function () {
    function hue(hex) { return window.MindRoot.colors.hsv(hex).h; }
    ['#8a5fbf', '#b389e0'].forEach(function (note) {
      var nearest = 360;
      window.MindRoot.colors.PALETTE.forEach(function (c) {
        nearest = Math.min(nearest, window.MindRoot.colors.hueDistance(hue(c), hue(note)));
      });
      T.ok(nearest >= 30, 'nearest branch ' + Math.round(nearest) + ' degrees from ' + note);
    });
  });
})();
