/* MindRoot - golden tests of the Markdown model: the structural edits and
 * the reading rules, ported check by check from an earlier model suite
 * (and the document checks of its Markdown suite),
 * plus the parser's own rules and the bugs it fixes. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var apply = D.apply;
  var pathOf = D.pathOf;

  /* ---------- the earlier model suite, 1-19: structure ---------- */

  T.test('model: children and siblings', function () {
    T.eq(apply('# Root\n', function (s, p) { return doc.addChild(s, p('Root'), 'Branch'); }),
      '# Root\n\n## Branch\n', 'child of h1 is an h2');
    T.eq(apply('# R\n\n## A\n', function (s, p) { return doc.addChild(s, p('A'), 'B'); }),
      '# R\n\n## A\n\n### B\n', 'child of h2 is an h3');
    T.eq(apply('# R\n\n## A\n', function (s, p) { return doc.addChild(s, p('A'), 'b', 'bullet'); }),
      '# R\n\n## A\n\n- b\n', 'explicit bullet child');
    T.eq(apply('# R\n\n## A\n\n- one\n', function (s, p) { return doc.addChild(s, p('A'), 'two'); }),
      '# R\n\n## A\n\n- one\n- two\n', 'a heading with bullet children keeps adding bullets');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.addChild(s, p('one'), 'two'); }),
      '# R\n\n- one\n  - two\n', 'child of a bullet nests by its content column');
    /* The previous app left '- b' glued to '### A1'; a heading gets a blank
     * line on each side, as insertBranch already writes it. */
    T.eq(apply('# R\n\n## A\n\n### A1\n', function (s, p) { return doc.addChild(s, p('A'), 'b', 'bullet'); }),
      '# R\n\n## A\n\n- b\n\n### A1\n', 'a bullet child goes before the sub-headings');
    T.eq(apply('# R\n\n## A\n', function (s, p) { return doc.addSibling(s, p('A'), 'B'); }),
      '# R\n\n## A\n\n## B\n', 'sibling of an h2 is an h2');
    T.eq(apply('# R\n\n- one\n  - a\n', function (s, p) { return doc.addSibling(s, p('a'), 'b'); }),
      '# R\n\n- one\n  - a\n  - b\n', 'sibling of a nested bullet keeps the indent');
    T.eq(apply('# R\n\n- one\n  - a\n  - b\n- two\n', function (s, p) { return doc.addSibling(s, p('one'), 'three'); }),
      '# R\n\n- one\n  - a\n  - b\n- three\n- two\n', 'a sibling lands after the whole subtree');
  });

  T.test('model: rename, delete, move, indent', function () {
    T.eq(apply('# R\n\n- old\n', function (s, p) { return doc.rename(s, p('old'), 'new'); }),
      '# R\n\n- new\n', 'rename a bullet');
    T.eq(apply('# R\n\n## old\n', function (s, p) { return doc.rename(s, p('old'), 'new'); }),
      '# R\n\n## new\n', 'rename a heading');
    T.eq(apply('# R\n\n- one\n  - a\n  - b\n- two\n', function (s, p) { return doc.remove(s, p('one')); }),
      '# R\n\n- two\n', 'delete takes the subtree');
    T.eq(apply('# R\n\n## A\n\n### A1\n\n## B\n', function (s, p) { return doc.remove(s, p('A')); }),
      '# R\n\n## B\n', 'delete a heading with its children');
    T.eq(apply('# R\n\n- one\n  - a\n- two\n', function (s, p) { return doc.move(s, p('one'), 1); }),
      '# R\n\n- two\n- one\n  - a\n', 'move down carries the subtree');
    T.eq(apply('# R\n\n- one\n- two\n', function (s, p) { return doc.move(s, p('two'), -1); }),
      '# R\n\n- two\n- one\n', 'move up');
    T.eq(apply('# R\n\n- one\n- two\n  - x\n', function (s, p) { return doc.indent(s, p('two')); }),
      '# R\n\n- one\n  - two\n    - x\n', 'indent a bullet and its descendants');
    T.eq(apply('# R\n\n- one\n  - two\n', function (s, p) { return doc.outdent(s, p('two')); }),
      '# R\n\n- one\n- two\n', 'outdent a bullet');
    T.eq(apply('# R\n\n## A\n\n## B\n', function (s, p) { return doc.indent(s, p('B')); }),
      '# R\n\n## A\n\n### B\n', 'indent a heading');
    T.eq(apply('# R\n\n## A\n\n### B\n', function (s, p) { return doc.outdent(s, p('B')); }),
      '# R\n\n## A\n\n## B\n', 'outdent a heading');
  });

  T.test('model: guards', function () {
    var s = doc.parse('# R\n\n- one\n- two\n');
    T.eq(doc.canIndent(s, pathOf(s, 'one')), false, 'the first sibling cannot be indented');
    T.eq(doc.canIndent(s, pathOf(s, 'two')), true, 'the second can');
    T.eq(doc.canOutdent(s, pathOf(s, 'one')), false, 'a top bullet cannot be outdented');
    T.eq(doc.canMove(s, pathOf(s, 'one'), -1), false, 'the first cannot move up');
    T.eq(doc.canMove(s, pathOf(s, 'one'), 1), true, 'the first can move down');
  });

  T.test('model: several roots', function () {
    var s = doc.parse('# A\n\n# B\n');
    T.eq(s.root.children.length, 2, 'two roots are read');
    T.eq(s.root.synthetic, true, 'under a synthetic root');
    T.eq(s.byPath[''], undefined, 'which is no entry');
    T.eq(doc.addRoot(s, 'C').text, '# A\n\n# B\n\n# C\n', 'a new root goes at the end');
  });

  T.test('model: pictures on the line', function () {
    T.eq(apply('# R\n', function (s, p) { return doc.addImage(s, p('R'), 'assets/photo.png', 'photo'); }),
      '# ![photo](assets/photo.png) R\n', 'a picture goes in front of the words');
    T.eq(apply('# R\n\n- one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', ''); }),
      '# R\n\n- ![](assets/a.png) one\n', 'also on a bullet');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/b.png', ''); }),
      '# R\n\n- ![](assets/a.png) ![](assets/b.png) one\n', 'a second one goes beside the first');
    T.eq(apply('# R\n\n- [ ] one <!-- color: #ff0000 -->\n', function (s, p) { return doc.addImage(s, p('one'), 'assets/a.png', ''); }),
      '# R\n\n- [ ] ![](assets/a.png) one <!-- color: #ff0000 -->\n', 'after the checkbox, before the colour');
    T.eq(apply('# R\n', function (s) { return doc.addImage(s, null, 'assets/photo.png', 'photo'); }),
      '# R\n\n# Images\n\n- ![photo](assets/photo.png)\n', 'with nothing selected it is a node of its own');

    var s = doc.parse('# R\n\n- ![](assets/a.png)\n- ![](assets/b.png) two\n');
    T.eq(doc.isImage(s.flat[1]), true, 'a picture-only node is recognised');
    T.eq(doc.isImage(s.flat[2]), false, 'a node with words is not picture-only');
    T.eq(doc.labelOf(s.flat[2]), 'two', 'the words without the picture');
    T.eq(doc.imagesOf(s.flat[2]), '![](assets/b.png)', 'the picture of the node');
    T.same(doc.imageRefs(s), ['assets/a.png', 'assets/b.png'], 'the files the map names');

    T.eq(apply('# R\n\n- ![](assets/a.png) one <!-- color: #ff0000 -->\n', function (s2, p) { return doc.rename(s2, p('one'), 'two'); }),
      '# R\n\n- ![](assets/a.png) two <!-- color: #ff0000 -->\n', 'rename keeps the picture');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (s2, p) { return doc.rename(s2, p('one'), '   '); }),
      '# R\n\n- ![](assets/a.png)\n', 'renamed to nothing, the picture stays alone');
    T.eq(apply('# R\n', function (s2, p) { return doc.rename(s2, p('R'), 'a\nb   c'); }),
      '# a b c\n', 'titles stay on one line');
  });

  T.test('model: anchor and breadcrumb', function () {
    var s = doc.parse('# R\n\n- one\n');
    var r = doc.addChild(s, pathOf(s, 'one'), 'two');
    var next = doc.parse(r.text);
    var entry = doc.findByLine(next, r.anchorLine);
    T.eq(entry ? doc.plainText(entry) : null, 'two', 'the anchor is the node just made');
    var b = doc.parse('# R\n\n## A\n\n- leaf\n');
    T.eq(doc.breadcrumb(b, b.byPath[pathOf(b, 'leaf')]), 'R / A', 'breadcrumb');
  });

  /* ---------- the earlier model suite, 20-32: notes ---------- */

  T.test('model: notes', function () {
    var s = doc.parse('# R\n\n- one\n  - > nota: reminder\n- two\n');
    T.eq(doc.noteFor(s, pathOf(s, 'one'), 'node').text, 'reminder', 'attached to its node');
    T.eq(doc.noteFor(s, pathOf(s, 'two'), 'node'), null, 'and not to the sibling');
    T.eq(s.flat.length, 3, 'a note is not a node');

    var two = doc.parse('# R\n\n- one\n  - > nota: on the node\n  - > arco: on the branch\n');
    T.eq(doc.noteFor(two, pathOf(two, 'one'), 'node').text, 'on the node', 'node note');
    T.eq(doc.noteFor(two, pathOf(two, 'one'), 'edge').text, 'on the branch', 'edge note');
    T.eq(two.flat.length, 2, 'two notes, no extra node');

    var plain = doc.parse('# R\n\n- one\n- two\n');
    var noted = doc.parse('# R\n\n- one\n  - > nota: x\n- two\n');
    T.eq(pathOf(noted, 'two'), pathOf(plain, 'two'), 'a note does not shift the paths after it');

    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.setNote(x, p('one'), 'node', 'hello'); }),
      '# R\n\n- one\n  - > note: hello\n', 'a new note goes under its bullet');
    T.eq(apply('# R\n\n## A\n', function (x, p) { return doc.setNote(x, p('A'), 'node', 'hello'); }),
      '# R\n\n## A\n- > note: hello\n', 'under a heading at column zero');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.setNote(x, p('one'), 'edge', 'depends'); }),
      '# R\n\n- one\n  - > edge: depends\n', 'an edge note has its own word');
    T.eq(apply('# R\n\n- one\n  - > nota: old\n  - child\n', function (x, p) { return doc.setNote(x, p('one'), 'node', 'new'); }),
      '# R\n\n- one\n  - > note: new\n  - child\n', 'rewritten in place');
    T.eq(apply('# R\n\n- one\n  - > nota: old\n  - child\n', function (x, p) { return doc.setNote(x, p('one'), 'node', '  '); }),
      '# R\n\n- one\n  - child\n', 'emptied, it leaves the file');
    T.eq(apply('# R\n\n- one\n  - > nota: a\n  - > arco: b\n', function (x, p) { return doc.setNote(x, p('one'), 'edge', ''); }),
      '# R\n\n- one\n  - > nota: a\n', 'only the note of that kind is touched');
    T.eq(apply('# R\n\n- one\n  - > nota: x\n- two\n', function (x, p) { return doc.remove(x, p('one')); }),
      '# R\n\n- two\n', 'deleting a node takes its notes');

    var deep = doc.parse('# R\n\n- one\n  - > nota: x\n    - grandchild\n');
    T.ok(pathOf(deep, 'grandchild') !== null, 'a child deeper than the note stays on the tree');
    T.eq(doc.breadcrumb(deep, deep.byPath[pathOf(deep, 'grandchild')]), 'R / one', 'and hangs from the node, not the note');

    T.eq(doc.stripNotes('# R\n\n- one\n  - > nota: x\n  - > arco: y\n- two > is not a note\n'),
      '# R\n\n- one\n- two > is not a note\n', 'stripNotes takes the notes and nothing else');
    var hand = doc.parse('# R\n\n* one\n  * >  NOTA :   badly spaced  \n');
    T.eq(doc.noteFor(hand, pathOf(hand, 'one'), 'node').text, 'badly spaced', 'a note written by hand is read');
  });

  /* ---------- the earlier model suite, 33-42: colour ---------- */

  T.test('model: colour', function () {
    var s = doc.parse('# R\n\n- one <!-- color: #C2703D -->\n  - two\n');
    var one = s.byPath[pathOf(s, 'one')];
    T.eq(one.title, 'one', 'the marker is not in the title');
    T.eq(one.color, '#c2703d', 'read and normalised');
    T.eq(one.colorBranch, false, 'not a branch colour');
    T.eq(s.byPath[pathOf(s, 'two')].paint, null, 'so the child does not inherit it');

    var b = doc.parse('# R\n\n- one <!-- color: #c2703d branch -->\n  - two\n    - three <!-- color: #3b6ea5 -->\n      - four\n');
    T.eq(b.byPath[pathOf(b, 'two')].paint, '#c2703d', 'a branch colour goes down');
    T.eq(b.byPath[pathOf(b, 'three')].paint, '#3b6ea5', 'an own colour wins');
    T.eq(b.byPath[pathOf(b, 'four')].paint, '#c2703d', 'and below it the branch colour is back');

    T.eq(apply('# R\n\n- one <!-- color: #c2703d branch -->\n', function (x, p) { return doc.rename(x, p('one'), 'first'); }),
      '# R\n\n- first <!-- color: #c2703d branch -->\n', 'rename keeps the colour');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.setColor(x, p('one'), '#abc'); }),
      '# R\n\n- one <!-- color: #aabbcc -->\n', 'setColor writes the marker');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.setColor(x, p('one'), '#c2703d', { branch: true }); }),
      '# R\n\n- one <!-- color: #c2703d branch -->\n', 'with branch');
    T.eq(apply('# R\n\n- one <!-- color: #aabbcc branch -->\n', function (x, p) { return doc.setColor(x, p('one'), '#2f7d5a'); }),
      '# R\n\n- one <!-- color: #2f7d5a -->\n', 'rewritten, not stacked');
    T.eq(apply('# R\n\n- one <!-- color: #aabbcc -->\n', function (x, p) { return doc.setColor(x, p('one'), null); }),
      '# R\n\n- one\n', 'cleared back to the palette');
    T.eq(apply('# R\n\n- one <!-- color: #aabbcc -->\n', function (x, p) { return doc.setColor(x, p('one'), '#AABBCC'); }),
      null, 'the same colour changes nothing');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.addChild(x, p('one'), 'two', null, '#2f7d5a'); }),
      '# R\n\n- one\n  - two <!-- color: #2f7d5a branch -->\n', 'a child born with a followed colour');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.addSibling(x, p('one'), 'two', '#2f7d5a'); }),
      '# R\n\n- one\n- two <!-- color: #2f7d5a branch -->\n', 'and a sibling');
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.addChild(x, p('one'), 'two', null, null); }),
      '# R\n\n- one\n  - two\n', 'no colour, clean line');

    var h = doc.parse('# R\n\n- one <!-- color: #c2703d branch -->\n- two <!-- color: #c2703d -->\n');
    T.eq(doc.handedColor(h, pathOf(h, 'one')), '#c2703d', 'a branch colour is handed down');
    T.eq(doc.handedColor(h, pathOf(h, 'two')), null, 'a node colour is not');

    T.eq(apply('# R\n\n- one\n- two <!-- color: #aabbcc -->\n', function (x, p) { return doc.move(x, p('two'), -1); }),
      '# R\n\n- two <!-- color: #aabbcc -->\n- one\n', 'moving carries the colour');
    T.eq(apply('# R\n\n- one\n- two <!-- color: #aabbcc -->\n', function (x, p) { return doc.indent(x, p('two')); }),
      '# R\n\n- one\n  - two <!-- color: #aabbcc -->\n', 'indenting carries the colour');

    var br = doc.parse('# R\n\n## One\n\n- first\n  - inside\n- second\n\n## Two\n\n- other\n');
    var key = doc.branchAt(br, pathOf(br, 'One'));
    T.eq(key, pathOf(br, 'One'), 'a first-level branch opens its colour');
    T.eq(doc.branchAt(br, pathOf(br, 'first')), key, 'its child follows it');
    T.eq(doc.branchAt(br, pathOf(br, 'inside')), key, 'and the grandchild');
    T.eq(doc.branchAt(br, pathOf(br, 'second')), key, 'and the later sibling');
    T.ok(doc.branchAt(br, pathOf(br, 'other')) !== key, 'the next branch opens another');
    T.eq(doc.branchAt(br, pathOf(br, 'R')), '', 'the root has its own');

    var many = doc.parse('# A\n\n## A1\n\n- leaf\n\n# B\n\n## B1\n');
    T.ok(doc.branchAt(many, pathOf(many, 'A')) !== doc.branchAt(many, pathOf(many, 'B')), 'every root opens its own colour');
    T.eq(doc.branchAt(many, pathOf(many, 'A1')), pathOf(many, 'A1'), 'a root\'s branch is its own');
    T.eq(doc.branchAt(many, pathOf(many, 'leaf')), pathOf(many, 'A1'), 'and the leaf follows it');

    var marked = doc.parse('# Root <!-- color: #aabbcc branch -->\n\n- one\n  - > note: annotated\n');
    T.eq(marked.byPath[pathOf(marked, 'Root')].kind, 'heading', 'a coloured title stays a title');
    T.eq(marked.byPath[pathOf(marked, 'one')].paint, '#aabbcc', 'and its colour goes down');
    T.eq(doc.noteFor(marked, pathOf(marked, 'one'), 'node').text, 'annotated', 'the note below stays a note');
  });

  /* ---------- the earlier model suite, 43-45: role and picture place ---------- */

  T.test('model: role and picture position', function () {
    T.eq(apply('# R\n\n- one\n', function (x, p) { return doc.setRole(x, p('one'), 'caption'); }),
      '# R\n\n- one <!-- role: caption -->\n', 'caption written at the end of the line');
    T.eq(apply('# R\n\n- one <!-- role: caption -->\n', function (x, p) { return doc.setRole(x, p('one'), 'paragraph'); }),
      '# R\n\n- one\n', 'no role is the plain state');
    T.eq(apply('# R\n\n- one <!-- color: #ff0000 -->\n', function (x, p) { return doc.setRole(x, p('one'), 'caption'); }),
      '# R\n\n- one <!-- role: caption --> <!-- color: #ff0000 -->\n', 'the role keeps the colour');
    T.eq(apply('# R\n\n- one <!-- role: caption -->\n', function (x, p) { return doc.setColor(x, p('one'), '#ff0000'); }),
      '# R\n\n- one <!-- role: caption --> <!-- color: #ff0000 -->\n', 'and the colour keeps the role');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (x, p) { return doc.setImagePosition(x, p('one'), 'right'); }),
      '# R\n\n- one ![](assets/a.png)\n', 'right moves the picture to the end');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (x, p) { return doc.setImagePosition(x, p('one'), 'above'); }),
      '# R\n\n- ![](assets/a.png) one <!-- image: above -->\n', 'above needs a marker');
    T.eq(apply('# R\n\n- one ![](assets/a.png) <!-- image: above -->\n', function (x, p) { return doc.setImagePosition(x, p('one'), 'left'); }),
      '# R\n\n- ![](assets/a.png) one\n', 'back to the left drops the marker');
    T.eq(apply('# R\n\n- ![](assets/a.png) one\n', function (x, p) { return doc.setRole(x, p('one'), 'caption'); }),
      '# R\n\n- ![](assets/a.png) one <!-- role: caption --> <!-- image: above -->\n', 'a caption stands the picture above');
    T.eq(apply('# R\n\n- one ![](assets/a.png) <!-- role: caption -->\n', function (x, p) { return doc.rename(x, p('one'), 'two'); }),
      '# R\n\n- two ![](assets/a.png) <!-- role: caption -->\n', 'rename keeps the side and the markers');
    T.eq(apply('# R\n\n- one ![](assets/a.png)\n', function (x, p) { return doc.addImage(x, p('one'), 'assets/b.png', ''); }),
      '# R\n\n- one ![](assets/a.png) ![](assets/b.png)\n', 'a second picture joins the side of the others');

    var s = doc.parse('# R\n\n- ![](assets/a.png) one <!-- role: caption --> <!-- image: above -->\n- two\n- ![](assets/b.png)\n');
    T.eq(doc.roleAt(s, pathOf(s, 'one')), 'caption', 'role read');
    T.eq(doc.imagePositionAt(s, pathOf(s, 'one')), 'above', 'position read');
    T.eq(doc.roleAt(s, pathOf(s, 'two')), 'paragraph', 'no role is a paragraph');
    T.eq(doc.imagePositionAt(s, pathOf(s, 'two')), null, 'no picture, no position');
    T.eq(doc.imagePositionAt(s, pathOf(s, 'image')), null, 'a picture-only node has no position');
  });

  /* ---------- the earlier Markdown suite: what the panel writes, read back ---------- */

  T.test('markdown: checkboxes and notes from the panel', function () {
    var s = doc.parse('# R\n- [x] done\n');
    var entry = s.flat[1];
    T.eq(entry.title, 'done', 'the box stays out of the title');
    T.eq(entry.task, true, 'and the document knows it is ticked');
    T.eq(doc.rename(s, entry.path, 'other name').text, '# R\n- [x] other name\n', 'renaming keeps the box');
    T.eq(doc.plainText(entry), 'done', 'the text of the node is the words');

    var written = doc.parse('# Root\n- one\n  - > note: written by hand');
    T.eq(doc.noteFor(written, pathOf(written, 'one'), 'node').text, 'written by hand', 'a note typed in the panel is read');
    T.eq(written.flat.length, 2, 'and is not a node');
    var legacy = doc.parse('# R\n- one\n  - > nota: old marker\n');
    T.eq(legacy.notes.length ? legacy.notes[0].text : null, 'old marker', 'the Italian marker is still read');
  });

  T.test('markdown: toggles on a string', function () {
    function sel(text, a, b, name) {
      var r = doc.toggleMark(text, a, b, name);
      return r.text + ' [' + r.text.slice(r.start, r.end) + ']';
    }
    T.eq(sel('- text', 2, 6, 'bold'), '- **text** [text]', 'bold wraps and keeps the choice');
    T.eq(sel('- **text**', 4, 8, 'bold'), '- text [text]', 'pressed again it unwraps');
    T.eq(sel('- text', 2, 6, 'italic'), '- *text* [text]', 'italic');
    T.eq(sel('- *text*', 3, 7, 'bold'), '- ***text*** [text]', 'bold on top of italic');
    T.eq(sel('- ***text***', 5, 9, 'italic'), '- **text** [text]', 'italic off leaves bold');
    T.eq(sel('- text', 2, 6, 'underline'), '- <u>text</u> [text]', 'underline is HTML');
    T.eq(sel('- <u>text</u>', 5, 9, 'underline'), '- text [text]', 'and comes off again');
    T.same(doc.markState('- ***text***', 5, 9), { bold: true, italic: true, underline: false }, 'markState reads both');
    T.same(doc.markState('- <u>a</u>', 5, 6), { bold: false, italic: false, underline: true }, 'and underline');
    T.same(doc.toggleMark('ab', 0, 2, 'nonsense'), { text: 'ab', start: 0, end: 2 }, 'an unknown mark changes nothing');
  });

  /* ---------- the parser's own rules ---------- */

  T.test('parse is lossless', function () {
    var texts = ['', '\n', '# A', '# A\r\n- b\r\n', '\ufeff# A\n- b\n', 'text\n\n\n', '- a\n\t- b\n'];
    Object.keys(window.DocSamples).forEach(function (name) { texts.push(window.DocSamples[name]); });
    texts.forEach(function (t, i) {
      var s = doc.parse(t);
      T.eq(s.text, doc.normalizeText(t), 'text kept ' + i);
      T.eq(s.lines.join('\n'), doc.normalizeText(t), 'lines join back ' + i);
      T.eq(doc.parse(s.text).text, s.text, 'twice ' + i);
    });
  });

  T.test('a heading keeps its list beside its sub-headings', function () {
    /* markmap showed only the lowest class of children (headings), so this
     * list vanished from the map; the own parser shows both, in file order. */
    var s = doc.parse('# R\n\n## A\n\n- x\n- y\n\n### B\n\n- z\n');
    var a = s.byPath[pathOf(s, 'A')];
    T.same(a.children.map(function (c) { return doc.labelOf(c); }), ['x', 'y', 'B'], 'list items then the sub-heading');
    T.eq(doc.breadcrumb(s, s.byPath[pathOf(s, 'z')]), 'R / A / B', 'a list after a sub-heading is the sub-heading\'s');
  });

  T.test('ordered lists nest at their content column', function () {
    var s = doc.parse(window.DocSamples.ordered);
    T.eq(doc.breadcrumb(s, s.byPath[pathOf(s, 'detail')]), 'Steps / first', 'three spaces under "1." nest');
    T.eq(doc.breadcrumb(s, s.byPath[pathOf(s, 'sub two')]), 'Steps / second', 'a numbered list inside a numbered one');
    T.eq(s.byPath[pathOf(s, 'third')].ordered, 3, 'the number is read');
    T.eq(s.byPath[pathOf(s, 'third')].delim, ')', 'and its delimiter');
    var two = doc.parse('# R\n\n1. one\n  - two\n');
    T.eq(doc.parentPath(pathOf(two, 'two')), '', 'two spaces under "1." do not nest (CommonMark)');
    T.eq(apply('# R\n\n1. one\n', function (x, p) { return doc.addChild(x, p('one'), 'two'); }),
      '# R\n\n1. one\n   - two\n', 'a child of "1." is written three columns in');
    T.eq(apply('# R\n\n1. one\n', function (x, p) { return doc.addSibling(x, p('one'), 'two'); }),
      '# R\n\n1. one\n2. two\n', 'a sibling continues the numbering');
    T.eq(apply('# R\n\n1) one\n', function (x, p) { return doc.addSibling(x, p('one'), 'two'); }),
      '# R\n\n1) one\n2) two\n', 'with the same delimiter');
    T.eq(apply('# R\n\n1. one\n1. two\n', function (x, p) { return doc.addSibling(x, p('two'), 'three'); }),
      '# R\n\n1. one\n1. two\n1. three\n', 'a list that numbers every item 1 keeps doing so');
    T.eq(apply('# R\n\n- a\n\n1. b\n', function (x, p) { return doc.addSibling(x, p('b'), 'c'); }),
      '# R\n\n- a\n\n1. b\n2. c\n', 'a bullet beside a one-item numbered list does not make it a "1. 1." list');
    T.eq(apply('# R\n\n1. one\n2. two\n', function (x, p) { return doc.indent(x, p('two')); }),
      '# R\n\n1. one\n   1. two\n', 'indent under "1." moves three columns and starts at 1');
    T.eq(apply('# R\n\n1. one\n   1. two\n', function (x, p) { return doc.outdent(x, p('two')); }),
      '# R\n\n1. one\n2. two\n', 'outdent comes back and continues the parent\'s numbering');
    T.eq(apply('# R\n\n* one\n', function (x, p) { return doc.addSibling(x, p('one'), 'two'); }),
      '# R\n\n* one\n* two\n', 'a sibling reuses the list\'s marker');
    T.eq(apply('# R\n\n- [ ] one\n', function (x, p) { return doc.addSibling(x, p('one'), 'two'); }),
      '# R\n\n- [ ] one\n- [ ] two\n', 'the next item of a to-do list is a to-do');
  });

  T.test('CommonMark: a numbered line cannot interrupt a paragraph unless it is 1', function () {
    var s = doc.parse('# R\n\nIn\n2019. was a year\n');
    T.eq(s.flat.length, 1, '"2019." under a paragraph is a sentence');
    var t = doc.parse('# R\n\n- p\n  2. b\n');
    T.eq(t.flat.length, 2, '"2." right under an item\'s text is that text');
    var u = doc.parse('# R\n\n- p\n  1. b\n');
    T.eq(u.flat.length, 3, '"1." starts a nested list');
    T.eq(apply('# R\n\n- p\n  1. a\n  2. b\n', function (x, p) { return doc.remove(x, p('a')); }),
      '# R\n\n- p\n  1. b\n', 'removing the first item hands its number to the next');
    T.eq(apply('# R\n\n- p\n  1. a\n  2. b\n', function (x, p) { return doc.move(x, p('b'), -1); }),
      '# R\n\n- p\n  1. b\n  2. a\n', 'moving swaps places, not numbers');
  });

  T.test('a list-only document has no ghost root', function () {
    var s = doc.parse(window.DocSamples.listOnly);
    T.eq(s.byPath[''], undefined, 'no entry at the root path');
    T.eq(s.root.synthetic, true, 'a synthetic root');
    T.same(s.root.children.map(function (e) { return e.path; }), ['0', '1', '2'], 'three top nodes');
    T.eq(doc.rename(s, '', 'x'), null, 'renaming the root does nothing');
    T.eq(doc.remove(s, ''), null, 'removing it does nothing');
    var one = doc.parse('- lone\n  - child\n');
    T.eq(one.byPath[''].title, 'lone', 'one top bullet is the root');
    T.eq(doc.breadcrumb(one, one.byPath['0']), 'lone', 'and its child hangs from it');
  });

  T.test('empty items and headings are not nodes', function () {
    T.eq(doc.parse('# R\n\n- \n  - > text: just words\n').flat.length, 1, 'an empty bullet is not a node');
    var s = doc.parse('# R\n- \n  - child\n');
    T.eq(doc.breadcrumb(s, s.byPath[pathOf(s, 'child')]), 'R', 'what is under it hangs from the node above');
    var h = doc.parse('# R\n##\n### x\n');
    T.eq(h.flat.length, 2, 'an empty heading is not a node');
    T.eq(doc.parentPath(pathOf(h, 'x')), '', 'its sub-heading hangs from the one above');
    T.eq(doc.parse('# R\n- <!-- color: #fff -->\n').flat.length, 1, 'a bullet with only markers is empty');
    T.eq(doc.parse('#hashtag\n').flat.length, 0, '#hashtag is not a heading');
    T.eq(doc.parse('# R\n- [ ] \n').flat[1].task, false, 'an empty to-do is still a to-do');
  });

  T.test('front matter, board, comments and code are no nodes', function () {
    var s = doc.parse(window.DocSamples.obsidian);
    T.eq(s.frontmatter.title, 'Field notes', 'front matter is read');
    T.same(s.flat.map(function (e) { return doc.plainText(e); }),
      ['Field notes', 'Code', 'Table', 'Lists', 'one', 'two', 'three link and Other map', 'Deeper', 'star item', 'plus item'],
      'only headings and items are nodes');
    T.eq(s.flat[0].start, 6, 'the front matter and the intro come first');
    var b = doc.parse('<!-- board: assets/k.excalidraw.svg -->\n\n# R\n');
    T.eq(b.flat.length, 1, 'the board line is not a node');
    var c = doc.parse('# R\n\n<!--\n# hidden\n- hidden\n-->\n- shown\n');
    T.same(c.flat.map(function (e) { return e.title; }), ['R', 'shown'], 'a comment block hides its lines');
    var f = doc.parse('# R\n\n- a\n  ```\n  - in code\n  ```\n  - b\n');
    T.same(f.flat.map(function (e) { return e.title; }), ['R', 'a', 'b'], 'a fence inside an item');
    var unclosed = doc.parse('# R\n\n```\n# A\n');
    T.eq(unclosed.flat.length, 1, 'an unclosed fence runs to the end, as in CommonMark');
    T.eq(doc.parse('# R\n---\n- a\n***\n').flat.length, 2, 'rules are not items');
    var hidden = doc.viewTree(doc.parse('# R\n<!-- a -->  <!-- b -->\n<!-- a --> x <!-- b -->\n'));
    T.eq(hidden.body.text, ' x ', 'a line of whole comments hides; words between comments are text');
    var big = doc.parse('  <!-- BOARD:x|-1,-2,3,4-->  \n\n# R\n');
    T.same([doc.boardPath(big), doc.boardPlacement(big)], ['x', { x: -1, y: -2, w: 3, h: 4 }], 'the board line in any case and spacing');
    T.eq(doc.boardPath(doc.parse('<!-- board: a | 1,2,3 -->\n')), null, 'a placement needs all four numbers');
    T.eq(doc.boardPath(doc.parse('<!-- board: a>b -->\n')), null, 'and a path has no >');
    var odd = doc.parse('---\n__proto__: x\ntitle: T\nconstructor: y\n---\n- a\n- b\n');
    T.eq(Object.getPrototypeOf(odd.frontmatter), Object.prototype, 'a __proto__ key cannot reach the prototype');
    T.eq(odd.frontmatter.title, 'T', 'and the other keys are read');
  });

  T.test('free text rides with the node it belongs to', function () {
    var s = doc.parse('# R\n\n## A\n\n- x\n  - y\n\nPara about A\n\n## B\n');
    var a = s.byPath[pathOf(s, 'A')];
    var x = s.byPath[pathOf(s, 'x')];
    T.eq(x.subEnd, x.start + 2, 'a paragraph that closes the list is not the item\'s');
    T.eq(a.subEnd, 8, 'it is the heading\'s');
    T.eq(apply('# R\n\n## A\n\n- x\n  - y\n\nPara about A\n\n## B\n', function (z, p) { return doc.remove(z, p('x')); }),
      '# R\n\n## A\n\nPara about A\n\n## B\n', 'removing the item leaves it with the heading');
    var lazy = doc.parse('- a\ncontinued\n- b\n');
    T.eq(lazy.byPath['0'].subEnd, 2, 'a lazy continuation line is the item\'s');
    var tab = doc.parse('- a\n\t- b\n');
    T.eq(doc.parentPath(pathOf(tab, 'b')), '', 'a tab indent nests like four spaces');
  });

  T.test('a byte-order mark is kept on the first line', function () {
    var s = doc.parse('\ufeff# A\n\n# B\n');
    T.eq(s.flat.length, 2, 'the first heading is read through the mark');
    T.eq(doc.rename(s, '0', 'Z').text, '\ufeff# Z\n\n# B\n', 'rename keeps it');
    T.eq(doc.move(s, '1', -1).text, '\ufeff# B\n\n# A\n', 'a move keeps it at the top');
  });

  T.test('titles are written so they stay titles', function () {
    var cases = [
      ['# x', '- \\# x'], ['- x', '- \\- x'], ['* x', '- \\* x'], ['> note: x', '- \\> note: x'],
      ['1. x', '- 1\\. x'], ['[ ] x', '- \\[ ] x'], ['```js', '- \\```js'], ['***', '- \\***'],
      ['a <!-- color: #fff -->', '- a \\<!-- color: #fff -->'], ['plain words', '- plain words']
    ];
    cases.forEach(function (c) {
      var out = apply('# R\n\n- one\n', function (s, p) { return doc.rename(s, p('one'), c[0]); });
      T.eq(out.split('\n')[2], c[1], 'escaped: ' + c[0]);
      var back = doc.parse(out);
      T.eq(back.flat.length, 2, 'still two nodes: ' + c[0]);
      T.eq(doc.titleFor(back, '0'), c[0], 'the rename box shows what was typed: ' + c[0]);
      T.eq(doc.rename(back, '0', doc.titleFor(back, '0')), null, 'and writing it back changes nothing: ' + c[0]);
      T.eq(back.flat[1].color, null, 'no marker was made: ' + c[0]);
    });
    T.eq(apply('# R\n', function (s, p) { return doc.rename(s, p('R'), 'Issue #'); }), '# Issue \\#\n', 'a heading keeps its trailing #');
    T.eq(doc.plainText(doc.parse('# Issue \\#\n').flat[0]), 'Issue #', 'and shows it');
  });

  T.test('CommonMark: a heading\'s closing #s are not words', function () {
    var s = doc.parse('# Title ##\n\n## x # #\n\n### C#\n');
    T.same(s.flat.map(function (e) { return doc.titleFor(s, e.path); }), ['Title', 'x #', 'C#'], 'the closing run goes, a # inside a word stays');
    T.eq(doc.parse('# R\n### ###\n').flat.length, 1, 'a heading of only #s is empty');
    T.eq(doc.parse('# Title ##\n').text, '# Title ##\n', 'the file keeps them');
    T.eq(apply('# Title ##\n', function (x) { return doc.rename(x, '', 'New'); }), '# New ##\n', 'a rename leaves them be');
    T.eq(apply('# Title ##\n', function (x) { return doc.setColor(x, '', '#c2703d'); }),
      '# Title <!-- color: #c2703d -->\n', 'a marker, which would put them mid-line, drops them');
    T.eq(doc.parse('# Title ## <!-- color: #c2703d -->\n').flat[0].color, '#c2703d', 'a marker after them is still read');
    T.eq(apply('# R\n\n- a\n\n## Sub ##\n', function (x, p) { return doc.moveTo(x, p('Sub'), p('a'), 'child'); }),
      '# R\n\n- a\n  - Sub\n', 'a heading written as a bullet leaves them behind');
  });

  T.test('edits leave every other line alone', function () {
    var t = '# R\n\n- one  \n\n\n- two\n  continues\n- three\t\n';
    var s = doc.parse(t);
    var r = doc.rename(s, pathOf(s, 'two'), 'TWO');
    var a = t.split('\n');
    var b = r.text.split('\n');
    T.eq(b.length, a.length, 'same number of lines');
    var changed = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    T.eq(changed, 1, 'one line changed');
    T.eq(doc.remove(s, pathOf(s, 'three')).text, '# R\n\n- one  \n\n\n- two\n  continues\n', 'trailing spaces and blank runs elsewhere survive a delete');
  });

  T.test('the parse result keeps the old shapes', function () {
    var s = doc.parse(window.DocSamples.kitchen);
    var one = s.byPath[pathOf(s, 'one')];
    T.eq(one.kind, 'bullet', 'kind');
    T.eq(one.prefix, '- ', 'prefix');
    T.eq(one.suffix, ' <!-- title: h2 -->', 'suffix');
    T.eq(one.titleSize, 'h2', 'title size');
    T.eq(one.body.text, '![](assets/b.png) words\nand a second line', 'body text');
    T.eq(one.body.role, 'caption', 'body role');
    T.eq(one.body.above, true, 'body picture above');
    T.eq(one.notes.node.text, 'reminder', 'node note');
    T.eq(one.notes.edge.text, 'depends', 'edge note');
    var task = s.byPath[pathOf(s, 'task')];
    T.eq(task.task, false, 'task');
    T.eq(task.drawAbove, true, 'draw above');
    T.eq(task.color, '#2f7d5a', 'colour');
    T.eq(s.notes.length, 2, 'notes list holds node and edge notes');
    T.eq(s.notes[0].path, one.path, 'with their owner\'s path');
    T.eq(doc.boardPath(s), 'assets/kyc.excalidraw.svg', 'board');
    T.eq(s.byPath[pathOf(s, 'first')].ordered, 1, 'ordered item');
    T.eq(doc.countNodes(window.DocSamples.kitchen), s.flat.length, 'countNodes agrees with parse');
    T.eq(doc.countNodes('# A\n- b\n  - > note: hello\n  - > text: below\n'), 2, 'a note is not counted');
  });

  T.test('long and odd lines stay fast (no regex backtracking)', function () {
    function rep(x, n) { return new Array(n + 1).join(x); }
    var sp = rep(' ', 20000);
    var cases = [
      '# R\n\n- a' + sp + '<!-- x -->\n', '# R\n\n- a' + sp + 'x -->\n', '# a' + sp + 'b #\n',
      '# R\n\n- a' + rep(' <!-- color: #fff -->', 3000) + '\n', '# R\n\n- a\n  - > text: x' + sp + 'y -->\n',
      '# R\n\n- a' + rep('\t', 20000) + '<!-- y -->\n', '# R\n\n- a' + rep(' \\<!-- color: #fff -->', 2000) + '\n',
      '# R\n' + rep('<!-- a -->', 40) + 'x\n', '<!-- board: a' + sp + 'b\n\n# R\n', '---\ntitle: a' + sp + 'b\n---\n# R\n',
      '# R\n\n- [x](a' + sp + 'b)\n', '# R\n\n- a' + sp + '\n  - b\n'
    ];
    cases.forEach(function (text, i) {
      var t0 = performance.now();
      var s = doc.parse(text);
      doc.viewTree(s);
      var last = s.flat[s.flat.length - 1];
      if (last) {
        doc.titleFor(s, last.path);
        doc.bodyFor(s, last.path);
        doc.rename(s, last.path, 'x');
        doc.setColor(s, last.path, '#c2703d');
      }
      doc.boardPath(s);
      doc.stripDrawings(text);
      var ms = performance.now() - t0;
      T.ok(ms < 150, 'case ' + i + ' in ' + Math.round(ms) + ' ms');
    });
  });

  T.test('emptyDocument', function () {
    T.eq(doc.emptyDocument('Map'), '# Map\n', 'a title');
    T.eq(doc.emptyDocument(''), '# New map\n', 'the default');
    T.eq(doc.emptyDocument('a\nb'), '# a b\n', 'one line');
  });

  T.test('who wrote a node: the by marker, read, kept, written, taken off', function () {
    var s = doc.parse('# R\n\n## A <!-- by: ai -->\n- B <!-- by: MIXED --> <!-- color: #c2703d -->\n- C\n- D <!-- by: robot -->\n');
    T.same(s.flat.map(function (e) { return doc.byAt(s, e.path); }), ['human', 'ai', 'mixed', 'human', 'human'], 'ai, mixed (any case), none, and an unknown word is no marker');
    T.eq(doc.plainText(doc.entryAt(s, '0.0')), 'B', 'the marker is not part of the words');
    T.same([doc.entryAt(s, '0.2').by, /robot/.test(doc.entryAt(s, '0.2').title)], [null, true], 'an unknown one is no marker: it stays in the title');
    var v = doc.viewTree(s);
    T.same([v.by, v.children[0].by, v.children[0].children[0].by], ['human', 'ai', 'mixed'], 'the view carries it');
    var r = doc.setBy(s, '0.1', 'ai');
    T.eq(r.text.split('\n')[4], '- C <!-- by: ai -->', 'written at the end of the line');
    var s2 = doc.parse(r.text);
    T.eq(doc.setBy(s2, '0.1', 'ai'), null, 'the same again changes nothing');
    T.eq(doc.setBy(s2, '0.0', null).text.split('\n')[3], '- B <!-- color: #c2703d -->', 'human takes it off, the colour stays');
    T.eq(doc.setColor(s2, '0.1', '#336699').text.split('\n')[4], '- C <!-- by: ai --> <!-- color: #336699 -->', 'another marker written keeps it, the colour last');
    T.eq(doc.rename(s2, '0.1', 'Sea').text.split('\n')[4], '- Sea <!-- by: ai -->', 'a rename keeps it');
    T.same([doc.byAfterEdit('ai', false), doc.byAfterEdit('mixed', false), doc.byAfterEdit('human', true), doc.byAfterEdit('human', false), doc.byAfterEdit(null, false)], ['mixed', 'mixed', 'mixed', null, null], 'what an edit makes of it');
  });

  T.test('addOutline: a tree under a node, or a new top, each node marked', function () {
    var s = doc.parse('# Book\n\n## Part\n- Chapter\n');
    var got = doc.addOutline(s, '', [{ title: 'Themes', children: [{ title: 'Love' }, { title: 'War', children: [{ title: 'Battles' }] }] }, { title: '  ' }, { title: 'Cast' }], 'ai');
    T.eq(got.made, 5, 'five nodes (an empty title is skipped)');
    var n = doc.parse(got.result.text);
    T.same(n.flat.map(function (e) { return e.path + ':' + doc.plainText(e) + ':' + doc.byAt(n, e.path); }),
      [':Book:human', '0:Part:human', '0.0:Chapter:human', '1:Themes:ai', '1.0:Love:ai', '1.1:War:ai', '1.1.0:Battles:ai', '2:Cast:ai'], 'in order, nested, marked');
    var under = doc.parse(doc.addOutline(s, '0.0', [{ title: 'Scene' }], null).result.text);
    T.same([doc.plainText(doc.entryAt(under, '0.0.0')), doc.byAt(under, '0.0.0')], ['Scene', 'human'], 'under a list item, unmarked with no by');
    T.eq(doc.addOutline(s, '9', [{ title: 'x' }], 'ai'), null, 'no such node: nothing');
    T.eq(doc.addOutline(s, '', [], 'ai'), null, 'nothing to add: nothing');
    T.eq(doc.addOutline(s, '', [{ title: 'a' }, { title: 'b' }, { title: 'c' }], 'ai', 2).made, 2, 'at most max');
    var top = doc.addOutline(doc.parse(''), null, [{ title: 'Exam', children: [{ title: 'Topic' }] }], 'ai');
    T.eq(top.result.text, '# Exam <!-- by: ai -->\n\n## Topic <!-- by: ai -->\n', 'a map from nothing');
  });

  T.test('no DOM, no network, by construction', function () {
    var before = document.head.innerHTML;
    var s = doc.parse('# R\n\n```js\nvar x = 1;\n```\n\n- $x^2$ and `code`\n');
    doc.viewTree(s);
    doc.inlineHtml('$x^2$ <script src="https://cdn.jsdelivr.net/x.js"></script>');
    T.eq(document.head.innerHTML, before, 'nothing was added to the page');
    T.eq(document.querySelectorAll('script[src*="http"]').length, 0, 'no remote script');
    Object.keys(doc).forEach(function (name) {
      if (typeof doc[name] !== 'function') return;
      var src = String(doc[name]);
      T.ok(!/document\.|createElement|fetch\(|XMLHttpRequest/.test(src), 'no DOM or network in ' + name);
    });
  });
})();
