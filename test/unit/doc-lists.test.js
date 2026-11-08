/* doc-lists: lists in the words under a title, the node a map is named
 * after, and roots put anywhere (js/model/doc.js, js/map/layout.js).
 *
 * A list item written after the first line of a quoted text keeps the
 * indent that nests it, is drawn as a list (bullets, numbers counted on,
 * task boxes ticked on the map), and every word still goes through the
 * inline renderer; words with no list are drawn as they always were.
 * '<!-- at: x,y -->' on a top node of a map with several puts its tree
 * there; any node under another with the marker hangs that far from its
 * parent's middle, its branch with it, its children on the side it stands. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var L = window.MindRoot.layout;

  function bodyHtml(text) {
    var tree = doc.viewTree(doc.parse(text));
    var n = tree.children && tree.children.length ? tree.children[0] : tree;
    return n.body ? n.body.html : null;
  }

  T.test('a list keeps its indent through writing and reading', function () {
    T.eq(doc.sanitizeNote('first\n  - a\n\t- b\n   plain   words'), 'first\n  - a\n    - b\nplain words', 'items keep their indent (a tab counts to four), other lines fold flat');
    T.eq(doc.sanitizeNote('   - first line'), '- first line', 'the first line has nothing to nest under');
    T.eq(doc.sanitizeNote('x\n' + new Array(60).join(' ') + '- deep'), 'x\n' + new Array(25).join(' ') + '- deep', 'at most 24 columns');
    var s = doc.parse('# R\n\n## A\n');
    var r = doc.setBody(s, '0', 'Things:\n- one\n  - under\n1. first\n- [ ] todo');
    T.eq(r.text, '# R\n\n## A\n- > text: Things:\n  > - one\n  >   - under\n  > 1. first\n  > - [ ] todo\n', 'written as quoted lines');
    var back = doc.parse(r.text);
    T.eq(doc.bodyFor(back, '0'), 'Things:\n- one\n  - under\n1. first\n- [ ] todo', 'read back the same');
    T.eq(back.flat.length, 2, 'no line of it became a node');
    T.eq(doc.setBody(back, '0', 'Things:\n- one\n  - under\n1. first\n- [ ] todo'), null, 'the same words again: nothing to write');
  });

  T.test('the body draws its lists', function () {
    var html = bodyHtml('# R\n- > text: intro\n  > - one\n  >   - deeper\n  > - [x] done\n  > 3. three\n  > 9. four\n  >    1. inner\n  >\n  > after');
    var host = document.createElement('div');
    host.innerHTML = html;
    var items = host.querySelectorAll('.md-li');
    T.eq(items.length, 6, 'one line per item');
    T.eq(items[0].className, 'md-li md-li--0', 'depth 0');
    T.eq(items[1].className, 'md-li md-li--1', 'nested one level');
    T.ok(items[0].querySelector('.md-li-dot'), 'a bullet has a dot');
    T.eq(items[2].querySelector('.md-check').getAttribute('aria-checked'), 'true', 'a ticked box');
    T.ok(/md-li--done/.test(items[2].className), 'its words marked done');
    T.eq(items[3].querySelector('.md-li-num').textContent, '3.', 'numbers start where the run starts');
    T.eq(items[4].querySelector('.md-li-num').textContent, '4.', 'and count on, whatever is written');
    T.eq(items[5].querySelector('.md-li-num').textContent, '1.', 'a nested run counts on its own');
    T.eq(host.textContent.indexOf('intro'), 0, 'the paragraph before');
    T.ok(/after$/.test(host.textContent), 'and after');
    T.eq(bodyHtml('# R\n- > text: one\n  > two'), 'one<br>two', 'no list: drawn as before');
  });

  T.test('every word of an item is escaped', function () {
    var html = bodyHtml('# R\n- > text: x\n  > - <img src=x onerror=alert(1)> **b** [l](javascript:alert(1))');
    var host = document.createElement('div');
    host.innerHTML = html;
    T.eq(host.querySelectorAll('img').length, 0, 'no element from the words');
    T.ok(host.querySelector('strong'), 'marks still drawn');
    T.eq(host.querySelectorAll('a[href^="javascript"]').length, 0, 'no script link');
  });

  T.test('a task box in the body ticks', function () {
    var s = doc.parse('# R\n- > text: list\n  > - [ ] a\n  >   - [X] b\n  > - c');
    T.same(doc.bodyTasks(s, ''), [false, true], 'the boxes in order');
    var r = doc.toggleBodyTask(s, '', 1);
    T.eq(r.text, '# R\n- > text: list\n  > - [ ] a\n  >   - [ ] b\n  > - c', 'the second one, only its box');
    T.eq(doc.toggleBodyTask(doc.parse(r.text), '', 0).text.split('\n')[2], '  > - [x] a', 'and back');
    T.eq(doc.toggleBodyTask(s, '', 5), null, 'no such box');
  });

  T.test('the node a map is named after', function () {
    T.eq(doc.primaryPath(doc.parse('# Garden\n## Beds\n')), '', 'the one root');
    T.eq(doc.primaryPath(doc.parse('# A\n# B\n')), '0', 'the first of several');
    T.eq(doc.primaryPath(doc.parse('just text\n')), null, 'none');
    T.eq(doc.primaryName(doc.parse('# My **big** [[Garden]] ![](assets/a.png)\n')), 'My big Garden', 'its plain words');
    T.eq(doc.primaryName(doc.parse('# ![](assets/a.png)\n')), '', 'a picture alone has no name');
  });

  T.test('roots put anywhere: the marker', function () {
    var text = '# One <!-- color: #ff0000 -->\n\n## a <!-- side: left -->\n\n# Two\n';
    var s = doc.parse(text);
    var r = doc.setPositions(s, { '0': { x: 10.4, y: -20 }, '1': { x: 300, y: 5 } });
    T.eq(r.text, '# One <!-- at: 10,-20 --> <!-- color: #ff0000 -->\n\n## a <!-- side: left -->\n\n# Two <!-- at: 300,5 -->\n', 'written before the colour, whole numbers');
    var s2 = doc.parse(r.text);
    T.same(doc.positionsOf(s2), { '0': { x: 10, y: -20 }, '1': { x: 300, y: 5 } }, 'read back');
    T.eq(s2.byPath['0'].title, 'One', 'not part of the words');
    T.same(doc.viewTree(s2).children.map(function (c) { return c.at; }), [{ x: 10, y: -20 }, { x: 300, y: 5 }], 'on the view');
    T.eq(doc.setPositions(s2, { '0': { x: 10, y: -20 } }), null, 'the same place: nothing to write');
    T.eq(doc.clearPositions(s2).text, text, 'every one off again');
    var one = doc.parse('# Solo <!-- at: 5,5 -->\n## a\n');
    T.eq(doc.viewTree(one).at, null, 'the one root of a map has no place of its own');
    T.eq(doc.setPositions(one, { '': { x: 1, y: 1 } }), null, 'and gets none');
    T.eq(doc.setPositions(one, { '': null }).text, '# Solo\n## a\n', 'a place left from before can be taken off');
    T.eq(doc.rename(s2, '1', 'Deux').text.split('\n')[4], '# Deux <!-- at: 300,5 -->', 'a rename keeps it');
    var deep = doc.parse('# R\n## a\n### b\n## c\n');
    var placed = doc.setPositions(deep, { '0.0': { x: -150, y: 40 } });
    T.eq(placed.text, '# R\n## a\n### b <!-- at: -150,40 -->\n## c\n', 'any node under another takes a place, from its parent');
    var p2 = doc.parse(placed.text);
    T.same(doc.viewTree(p2).children[0].children[0].at, { x: -150, y: 40 }, 'on the view');
    T.same(doc.positionsOf(p2, '1'), {}, 'positionsOf a branch: only what is in it');
    T.same(Object.keys(doc.positionsOf(p2, '0')), ['0.0'], 'and below it');
    T.eq(doc.clearPositions(p2, '0').text, '# R\n## a\n### b\n## c\n', 'a branch put back in order');
    T.eq(doc.dropStraySides(p2), null, 'a place under a parent is no stray marker');
  });

  T.test('roots put anywhere: the layout', function () {
    var sizes = { '0': { w: 100, h: 20, base: 18 }, '0.0': { w: 40, h: 20, base: 18 }, '1': { w: 60, h: 30, base: 28 }, '2': { w: 50, h: 20, base: 18 } };
    var tree = { path: null, children: [
      { path: '0', at: { x: 500, y: 400 }, children: [{ path: '0.0', side: 'right', children: [] }] },
      { path: '1', at: null, children: [] },
      { path: '2', at: null, children: [] }
    ] };
    var g = L.layout(tree, sizes, {});
    T.eq(g.nodes['0'].x + 50, 500, 'centred on its place across');
    T.eq(g.nodes['0'].y + 10, 400, 'and down');
    T.eq(g.nodes['0.0'].x, g.nodes['0'].x + 100 + 72, 'its branch grows from it');
    T.eq(g.nodes['1'].x, 0, 'the others keep their column');
    T.ok(g.nodes['1'].y >= 410 + 48, 'under the lowest placed tree');
    T.ok(g.nodes['2'].y > g.nodes['1'].y, 'in their order');
    var single = L.layout({ path: '', at: { x: 999, y: 999 }, children: [] }, { '': { w: 10, h: 10, base: 9 } }, {});
    T.eq(single.nodes[''].x, 0, 'a single root ignores it');
  });

  T.test('a node put by hand stays on its parent', function () {
    var sz = function (w) { return { w: w, h: 20, base: 18 }; };
    var sizes = { '': sz(60), '0': sz(60), '0.0': sz(40), '1': sz(60), '1.0': sz(40), '1.1': sz(40), '2': sz(60) };
    var tree = { path: '', children: [
      { path: '0', side: 'right', children: [{ path: '0.0', children: [] }] },
      { path: '1', side: 'right', at: { x: -200, y: 150 }, children: [{ path: '1.0', children: [] }, { path: '1.1', children: [] }] },
      { path: '2', side: 'right', children: [] }
    ] };
    var g = L.layout(tree, sizes, {});
    var root = g.nodes[''];
    var one = g.nodes['1'];
    T.eq(one.x + one.w / 2 - (root.x + root.w / 2), -200, 'its middle that far across from its parent\'s');
    T.eq(one.y + one.h / 2 - (root.y + root.h / 2), 150, 'and down');
    T.eq(one.side, 'left', 'left of its parent: it stands on the left');
    T.eq(g.nodes['1.0'].side, 'left', 'and its children grow on the left');
    T.eq(g.nodes['1.0'].x + 40, one.x - 72, 'from it');
    var without = L.layout({ path: '', children: [tree.children[0], tree.children[2]] }, sizes, {});
    T.eq(g.nodes['2'].y - g.nodes['0'].y, without.nodes['2'].y - without.nodes['0'].y, 'its siblings close up where it was');
    T.ok(g.links.some(function (l) { return l.from === '' && l.to === '1' && l.side === 'left'; }), 'still linked to its parent');
    var moved = L.layout({ path: '', children: [{ path: '0', side: 'right', at: { x: 300, y: 0 }, children: [{ path: '0.0', at: { x: 0, y: 80 }, children: [] }] }] }, sizes, {});
    T.eq(moved.nodes['0.0'].y + 10 - (moved.nodes['0'].y + 10), 80, 'a node put by hand under one put by hand follows it');
  });

  T.test('a branch of the root put under it leaves from the root\'s circle', function () {
    var sz = function (w) { return { w: w, h: 20, base: 18 }; };
    var sizes = { '': sz(200), '0': sz(60), '1': sz(120), '2': sz(60), '1.0': sz(40) };
    var tree = { path: '', children: [
      { path: '0', side: 'right', children: [] },
      { path: '1', side: 'right', at: { x: -30, y: 200 }, children: [{ path: '1.0', children: [] }] },
      { path: '2', side: 'right', at: { x: 400, y: 150 }, children: [] }
    ] };
    var g = L.layout(tree, sizes, {});
    var root = g.nodes[''];
    var cx = root.x + root.w / 2;
    var under = g.links.filter(function (l) { return l.to === '1'; })[0];
    T.eq(under.x1, cx, 'from the middle of the root\'s line, the circle');
    var kid = g.nodes['1'];
    T.ok(under.x2 >= kid.x && under.x2 <= kid.x + kid.w && Math.abs(under.x2 - cx) <= 1, 'and down onto its own line, right under the circle');
    T.ok(under.y2 > under.y1, 'going down');
    var beyond = g.links.filter(function (l) { return l.to === '2'; })[0];
    T.eq(beyond.x1, root.x + root.w, 'a branch beyond the end of the line leaves from the end, as it always did');
    var tidy = g.links.filter(function (l) { return l.to === '0'; })[0];
    T.eq(tidy.x1, root.x + root.w, 'and the ones in the stack');
    var below = g.links.filter(function (l) { return l.to === '1.0'; })[0];
    var one = g.nodes['1'];
    T.ok(below.x1 === one.x || below.x1 === one.x + one.w, 'a branch of a branch is not a root\'s: from the end of its parent\'s line');
  });
})();
