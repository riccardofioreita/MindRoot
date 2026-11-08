/* MindRoot - what the map draws (viewTree), the keys folds are kept by
 * (lineageKey), the links a node carries (linksOf) and to-dos (toggleTask). */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var colors = window.MindRoot.colors;
  var S = window.DocSamples;

  function find(view, text) {
    if (!view) return null;
    if (view.text === text) return view;
    for (var i = 0; i < view.children.length; i++) {
      var hit = find(view.children[i], text);
      if (hit) return hit;
    }
    return null;
  }

  function walk(view, fn) {
    fn(view);
    view.children.forEach(function (c) { walk(c, fn); });
  }

  T.test('the shape of a view node', function () {
    var view = doc.viewTree(doc.parse(S.kitchen));
    var keys = ['path', 'synthetic', 'depth', 'kind', 'level', 'ordered', 'titleSize', 'role', 'html', 'text', 'task',
      'images', 'imageAbove', 'drawAbove', 'body', 'notes', 'color', 'ownColor', 'branchIndex', 'links', 'children'];
    var missing = [];
    walk(view, function (v) { keys.forEach(function (k) { if (!(k in v)) missing.push(v.path + ':' + k); }); });
    T.same(missing, [], 'every contract field on every node');
    T.eq(view.path, '', 'the drawn root is ""');
    T.eq(view.synthetic, false, 'not synthetic');
    T.eq(view.depth, 0, 'depth 0');
    T.eq(view.branchIndex, -1, 'branch -1');
    T.eq(view.color, '#aabbcc', 'its own colour');
    T.eq(view.ownColor, true, 'is its own');
    T.ok(JSON.stringify(view).length > 0, 'plain data, no cycles');
    var s = doc.parse(S.kitchen);
    T.ok(doc.viewTree(s) !== doc.viewTree(s), 'a fresh tree every call');
  });

  T.test('kinds, levels, numbers, tasks, sizes', function () {
    var v = doc.viewTree(doc.parse(S.kitchen));
    var whatItDoes = find(v, 'WHAT IT DOES');
    T.eq(whatItDoes.kind, 'heading', 'heading');
    T.eq(whatItDoes.level, 2, 'level');
    T.eq(whatItDoes.titleSize, 'h2', 'title size');
    T.eq(whatItDoes.color, '#c2703d', 'own colour');
    var one = find(v, 'one');
    T.eq(one.kind, 'bullet', 'bullet');
    T.eq(one.level, null, 'no level for a bullet');
    T.eq(one.depth, 2, 'depth');
    T.eq(one.color, '#aabbcc', 'inherited branch colour');
    T.eq(one.ownColor, false, 'not its own');
    var task = find(v, 'task');
    T.same(task.task, { checked: false }, 'a to-do');
    T.eq(task.drawAbove, true, 'draw above');
    var ord = doc.viewTree(doc.parse(S.ordered));
    T.same(ord.children.map(function (c) { return c.ordered; }), [1, 2, 3, 10], 'numbers as written: 1. 2. then a new 3) list, then a new 10. list');
    T.same(find(ord, 'second').children.map(function (c) { return c.ordered; }), [1, 2], 'a nested numbered list');
    T.same(doc.viewTree(doc.parse('# R\n\n1. a\n1. b\n1. c\n')).children.map(function (c) { return c.ordered; }), [1, 2, 3], '1. 1. 1. shows 1, 2, 3');
    T.same(doc.viewTree(doc.parse('# R\n\n3. a\n4. b\n')).children.map(function (c) { return c.ordered; }), [3, 4], 'a list may start anywhere');
    T.eq(find(ord, 'detail').ordered, null, 'a bullet has no number');
  });

  T.test('words and pictures', function () {
    var v = doc.viewTree(doc.parse('# R\n\n- ![a](assets/a.png) **one** ![](assets/d.ink.svg) <!-- draw: above -->\n- <img src="assets/my%20pic.png" alt="x"> two\n'));
    var one = v.children[0];
    T.eq(one.html, '<strong>one</strong>', 'html without the pictures');
    T.eq(one.text, 'one', 'plain text');
    T.same(one.images, [
      { path: 'assets/a.png', src: 'assets/a.png', alt: 'a', kind: 'photo', side: 'left' },
      { path: 'assets/d.ink.svg', src: 'assets/d.ink.svg', alt: '', kind: 'draw', side: 'right' }
    ], 'pictures with their side and kind');
    T.eq(one.drawAbove, true, 'and the drawing stands above');
    T.same(v.children[1].images.map(function (i) { return i.path; }), ['assets/my pic.png'], 'an <img> with %20 names the real file');
  });

  T.test('the body: quoted words and the free text a node owns', function () {
    var v = doc.viewTree(doc.parse(S.kitchen));
    var one = find(v, 'one');
    T.eq(one.body.html, 'words<br>and a second line', 'quoted words with their line break');
    T.eq(one.body.role, 'caption', 'role');
    T.eq(one.body.imageAbove, true, 'picture above');
    T.same(one.body.images.map(function (i) { return i.path + ':' + i.side; }), ['assets/b.png:left'], 'body pictures');
    T.same(one.notes, { node: 'reminder', edge: 'depends' }, 'notes');
    T.eq(one.body.quoted, true, 'quoted');
    T.eq(one.body.prose, false, 'no free text');

    var o = doc.viewTree(doc.parse(S.obsidian));
    T.eq(o.path, '', 'one root');
    T.eq(o.body.html, '<span class="md-p">The root has a paragraph<br>over two lines.</span>', 'a paragraph under a heading is its body');
    T.eq(o.body.quoted, false, 'not quoted');
    T.eq(o.body.prose, true, 'free text');
    var code = find(o, 'Code');
    T.eq(code.body.html, '<code class="md-code"># not a heading<br>- not a bullet<br><br>const x = 1;</code>', 'a code fence, escaped, lines kept');
    T.ok(!/<script/i.test(code.body.html), 'nothing loaded for it');
    var table = find(o, 'Table');
    T.eq(table.body.text, 'Name | Value\na | 1\nb | 2', 'a table, row by row');
    T.ok(table.body.html.indexOf('<strong>1</strong>') >= 0, 'with marks in its cells');
    var lists = find(o, 'Lists');
    T.eq(lists.body.text, 'A quote under Lists.', 'a quote after the list is the heading\'s');
    T.eq(lists.body.html, '<span class="md-quote">A quote under Lists.</span>', 'marked as a quote; the comment is hidden');
    T.eq(find(o, 'one').body.text, 'continued lazily', 'a lazy line is its item\'s');
    T.eq(find(o, 'two').body.text, 'A paragraph inside two.\ncode in two', 'paragraph and code inside an item');
    var none = 0;
    walk(o, function (n) { if (n.text.indexOf('introduction') >= 0 || (n.body && n.body.text.indexOf('introduction') >= 0)) none++; });
    T.eq(none, 0, 'the text before the first node belongs to no node');
    var pic = doc.viewTree(doc.parse('# R\n\n![](assets/p.png)\n'));
    T.same(pic.body.images.map(function (i) { return i.path + ':' + i.prose; }), ['assets/p.png:true'], 'a picture on its own line under a node is its picture');
    T.eq(pic.body.html, '', 'and not words');
  });

  T.test('the synthetic root', function () {
    var v = doc.viewTree(doc.parse(S.listOnly));
    T.eq(v.path, null, 'path null');
    T.eq(v.synthetic, true, 'synthetic');
    T.eq(v.depth, 0, 'depth 0');
    T.same(v.children.map(function (c) { return c.path + ':' + c.depth; }), ['0:1', '1:1', '2:1'], 'the top nodes under it');
    T.same(v.children.map(function (c) { return c.branchIndex; }), [-1, 2, 4], 'each top node and each of its children opens a branch, in document order');
    T.eq(v.children[0].color, colors.paletteFor(-1), 'the first tree is green like a single root');
    T.eq(v.children[0].children[0].color, colors.paletteFor(0), 'its first child the next colour');
    var fm = doc.viewTree(doc.parse('---\ntitle: "My map"\n---\n# A\n\n# B\n'));
    T.eq(fm.text, 'My map', 'front matter titles a synthetic root');
    T.eq(doc.viewTree(doc.parse('')), null, 'an empty document draws nothing');
    T.eq(doc.viewTree(doc.parse('just a paragraph\n')), null, 'nor does one with no node');
    T.eq(doc.viewTree(null), null, 'nor nothing');
  });

  T.test('automatic colours are a function of the document', function () {
    var s = doc.parse('# R\n\n## A\n\n- a1\n\n## B\n\n## C\n');
    var v = doc.viewTree(s);
    T.same(v.children.map(function (c) { return c.color; }), [colors.paletteFor(0), colors.paletteFor(1), colors.paletteFor(2)], 'one per first-level branch, in order');
    T.eq(v.color, colors.PALETTE[0], 'the root is the first');
    T.eq(v.children[0].children[0].color, v.children[0].color, 'a branch is one colour');
    T.eq(doc.colorFor(s, '0.0'), v.children[0].children[0].color, 'colorFor agrees with the view');
    T.eq(doc.branchIndexAt(s, '2'), 2, 'branchIndexAt');
    T.eq(doc.colorAt(s, '0'), null, 'colorAt is the written colour only');
    var many = doc.parse('# R\n\n' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return '## B' + i; }).join('\n\n') + '\n');
    T.eq(doc.viewTree(many).children[7].color, colors.paletteFor(7), 'the palette wraps after seven');
  });

  T.test('links on the map', function () {
    var s = doc.parse(S.obsidian);
    T.same(doc.linksOf(s, D.pathOf(s, 'three link and Other map')), [
      { href: 'https://example.com', text: 'link', kind: 'url' },
      { href: 'Other map', text: 'Other map', kind: 'map' }
    ], 'a url and a map link');
    var v = doc.viewTree(s);
    T.same(find(v, 'three link and Other map').links, doc.linksOf(s, D.pathOf(s, 'three link and Other map')), 'the view carries them');
    var body = doc.parse('# R\n\n- a\n  - > text: see https://x.org\n  more at [[Map]]\n');
    T.same(doc.linksOf(body, '0').map(function (l) { return l.href; }), ['https://x.org', 'Map'], 'links in the words and the text under the line');
    T.same(doc.linksOf(body, 'nope'), [], 'no node, no links');
  });

  T.test('lineageKey: folds survive edits elsewhere', function () {
    var s = doc.parse('# R\n\n- a\n  - x\n- b\n  - x\n  - x\n');
    T.eq(doc.lineageKey(s, ''), 'R', 'the root');
    T.eq(doc.lineageKey(s, '0.0'), 'R\u001fa\u001fx', 'titles joined with \\u001f');
    T.eq(doc.lineageKey(s, '1.1'), 'R\u001fb\u001fx\u001e2', 'a second sibling with the same words is told apart');
    var keys = doc.lineageKeys(s);
    T.eq(keys['1.1'], doc.lineageKey(s, '1.1'), 'lineageKeys agrees');
    T.eq(Object.keys(keys).length, s.flat.length, 'one key per node');
    var alike = ['# R', ''];
    for (var i = 0; i < 5000; i++) alike.push('- same');
    var many = doc.parse(alike.join('\n') + '\n');
    var t0 = performance.now();
    var manyKeys = doc.lineageKeys(many);
    var ms = performance.now() - t0;
    T.ok(ms < 100, '5,000 alike siblings in ' + Math.round(ms) + ' ms');
    T.eq(manyKeys['4999'], 'R\u001fsame\u001e5000', 'counted, not looked back for');
    T.eq(manyKeys['4999'], doc.lineageKey(many, '4999'), 'and lineageKey agrees');
    var moved = doc.parse(doc.addSibling(s, '0', 'new').text);
    T.eq(doc.lineageKey(moved, '2.0'), doc.lineageKey(s, '1.0'), 'a node whose path moved keeps its key');
    var forest = doc.parse('# A\n\n# B\n\n- b\n');
    T.eq(doc.lineageKey(forest, '1.0'), 'B\u001fb', 'a synthetic root adds nothing');
    T.eq(doc.lineageKey(s, 'nope'), '', 'a missing path has no key');
    var pics = doc.parse('# R\n\n- ![](assets/a.png)\n- ![](assets/b.png)\n');
    T.ok(doc.lineageKey(pics, '0') !== doc.lineageKey(pics, '1'), 'picture-only nodes are told apart by their pictures');
    var folded = doc.viewTree(doc.parse('# R\n\n- a <!-- markmap: fold -->\n  - b\n'));
    T.eq(folded.children[0].fold, 'fold', 'markmap fold comments are a hint for the view');
    T.eq(doc.titleFor(doc.parse('# R\n\n- a <!-- markmap: fold -->\n'), '0'), 'a', 'and stay out of the rename box');
    T.eq(doc.setColor(doc.parse('# R\n\n- a <!-- markmap: fold -->\n'), '0', '#123456').text,
      '# R\n\n- a <!-- markmap: fold --> <!-- color: #123456 -->\n', 'and survive a rewrite of the markers');
  });

  T.test('toggleTask and setTask', function () {
    var t = '# R\n\n- [ ] one\n- [X] two\n* [x]  three\n- four\n## H\n';
    var s = doc.parse(t);
    T.eq(doc.toggleTask(s, '0').text, '# R\n\n- [x] one\n- [X] two\n* [x]  three\n- four\n## H\n', 'tick');
    T.eq(doc.toggleTask(s, '1').text, '# R\n\n- [ ] one\n- [ ] two\n* [x]  three\n- four\n## H\n', 'untick (X too)');
    T.eq(doc.toggleTask(s, '2').text, '# R\n\n- [ ] one\n- [X] two\n* [ ]  three\n- four\n## H\n', 'spacing kept');
    T.eq(doc.toggleTask(s, '3'), null, 'not a to-do: nothing');
    T.eq(doc.toggleTask(s, '4'), null, 'nor a heading');
    T.eq(doc.toggleTask(s, '0').anchorLine, 2, 'anchor on the line');
    T.eq(doc.setTask(s, '3', true).text, '# R\n\n- [ ] one\n- [X] two\n* [x]  three\n- [ ] four\n## H\n', 'setTask adds a box');
    T.eq(doc.setTask(s, '0', false).text, '# R\n\n- one\n- [X] two\n* [x]  three\n- four\n## H\n', 'and takes it off');
    T.eq(doc.setTask(s, '0', true), null, 'already a to-do');
    T.eq(doc.setTask(s, '4', true), null, 'a heading cannot be one');
  });
})();
