/* MindRoot - a branch taken out and put back: the trash round trip and the
 * shape a branch takes where it lands (ported from an earlier trash suite), and
 * drag and drop (moveTo), which is the same two steps in one edit. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var SAMPLE = window.DocSamples.trash;

  function pathByLabel(text, label) {
    var s = doc.parse(text);
    for (var i = 0; i < s.flat.length; i++) if (doc.labelOf(s.flat[i]) === label) return s.flat[i].path;
    return null;
  }

  function removeAndRestore(text, path) {
    var s = doc.parse(text);
    var taken = doc.extractBranch(s, path);
    var after = doc.remove(s, path).text;
    var t = doc.parse(after);
    var place = doc.placeFor(t, taken.origin);
    var back = doc.insertBranch(t, place.parent, place.index, taken.fragment);
    return { text: back ? back.text : null, where: place.where, removed: after, anchor: back && back.anchorLine };
  }

  function labels(text) {
    return doc.parse(text).flat.map(function (e) { return doc.labelOf(e); }).sort();
  }

  T.test('trash: every branch taken out and put back is the same text', function () {
    var s = doc.parse(SAMPLE);
    var broken = [];
    s.flat.forEach(function (entry) {
      var round = removeAndRestore(SAMPLE, entry.path);
      if (round.text !== SAMPLE || round.where !== 'same') broken.push(doc.labelOf(entry) + ' -> ' + JSON.stringify(round.text));
    });
    T.same(broken, [], 'all identical');
    T.eq(s.flat.length, 17, 'every node of the sample was tried');
    T.eq(removeAndRestore(SAMPLE, pathByLabel(SAMPLE, 'two')).anchor, 15, 'the anchor is the branch\'s line');
  });

  T.test('trash: the same round trip on the other samples', function () {
    ['welcome', 'kitchen', 'ordered', 'listOnly'].forEach(function (name) {
      var text = window.DocSamples[name];
      var s = doc.parse(text);
      var broken = [];
      s.flat.forEach(function (entry) {
        var round = removeAndRestore(text, entry.path);
        if (round.text !== text) broken.push(entry.path + ' ' + doc.labelOf(entry) + ' -> ' + JSON.stringify(round.text));
      });
      T.same(broken, [], name);
    });
  });

  T.test('trash: what the branch remembers', function () {
    var s = doc.parse(SAMPLE);
    var taken = doc.extractBranch(s, pathByLabel(SAMPLE, 's2'));
    T.eq(taken.origin.parent, pathByLabel(SAMPLE, 'Section'), 'its parent');
    T.eq(taken.origin.index, 1, 'its place among the siblings');
    T.same(taken.origin.lineage, ['Root', 'Chapter', 'Section'], 'the words above it');
    T.eq(taken.fragment.kind, 'bullet', 'its shape');
    T.eq(taken.fragment.text, '- s2\n  - s2a', 'its lines');
    T.eq(doc.extractBranch(s, 'nope'), null, 'nothing for a missing path');
  });

  T.test('trash: when the place is gone', function () {
    var s = doc.parse(SAMPLE);
    var gone = doc.extractBranch(s, pathByLabel(SAMPLE, 'one a'));
    var cut = doc.remove(s, pathByLabel(SAMPLE, 'one a')).text;
    var renamed = doc.rename(doc.parse(cut), pathByLabel(cut, 'one'), 'ONE').text;
    var r1 = doc.parse(renamed);
    var place = doc.placeFor(r1, gone.origin);
    T.eq(place.where, 'top', 'parent renamed: to the end of the root');
    T.eq(place.parent, '', 'under the root');
    T.eq(doc.insertBranch(r1, place.parent, place.index, gone.fragment).text,
      renamed.replace(/\n$/, '') + '\n\n## one a\n', 'as a heading beside the other headings');
    var moved = doc.move(doc.parse(cut), pathByLabel(cut, 'one'), 1).text;
    var r2 = doc.parse(moved);
    var place2 = doc.placeFor(r2, gone.origin);
    T.eq(place2.where, 'moved', 'parent moved: it follows');
    T.eq(place2.parent, pathByLabel(moved, 'one'), 'to its new place');
    var back2 = doc.parse(doc.insertBranch(r2, place2.parent, place2.index, gone.fragment).text);
    T.eq(doc.labelOf(back2.byPath[pathByLabel(moved, 'one') + '.0']), 'one a', 'first under it again');
    T.same(doc.placeFor(r1, { parent: null, index: 0, lineage: [] }), { parent: null, index: 0, where: 'same' }, 'a branch that was the root');
    T.same(doc.placeFor(doc.parse('# A\n\n# B\n'), { parent: '', index: 1, lineage: [] }), { parent: null, index: 1, where: 'same' }, 'a top node of several');
    var lone = doc.parse('- a\n  - a1\n');
    T.same(doc.placeFor(lone, { parent: '', index: 1, lineage: ['Cest'] }), { parent: null, index: Infinity, where: 'top' },
      'an emptied map that got one list branch back: the next branch goes beside it, not under it');
    T.same(doc.placeFor(doc.parse('# Other\n\n## x\n'), { parent: '9', index: 1, lineage: ['Cest', 'Gone'] }), { parent: '', index: Infinity, where: 'top' },
      'a map with its own heading root: at the end under it');
  });

  T.test('trash: the shape adapts to where it lands', function () {
    var heading = { text: '## A\n\n- a1\n\n### B\n\n- b1', kind: 'heading', level: 2 };
    var under = doc.parse('# R\n\n- x\n');
    T.eq(doc.insertBranch(under, '0', Infinity, heading).text,
      '# R\n\n- x\n  - A\n    - a1\n    - B\n      - b1\n', 'a heading under a list item becomes a list');
    var deep = doc.parse('# R\n\n## L2\n\n### L3\n\n#### L4\n\n##### L5\n');
    T.eq(doc.insertBranch(deep, D.pathOf(deep, 'L5'), Infinity, heading).text,
      '# R\n\n## L2\n\n### L3\n\n#### L4\n\n##### L5\n\n- A\n  - a1\n  - B\n    - b1\n', 'past h6 it becomes a list');
    var level = doc.parse('# R\n\n- x\n');
    /* The previous app made this a list item, because markmap hid a heading's
     * list as soon as it had a sub-heading. Both now show, so a heading put
     * at the end of a heading that has a list stays a heading, after it. */
    T.eq(doc.insertBranch(level, '', Infinity, { text: '#### Z\n\n- z', kind: 'heading', level: 4 }).text,
      '# R\n\n- x\n\n## Z\n\n- z\n', 'at the end of a root with a list, a heading stays a heading');
    T.eq(doc.insertBranch(level, '', 0, { text: '#### Z\n\n- z', kind: 'heading', level: 4 }).text,
      '# R\n\n- Z\n  - z\n- x\n', 'inside the list, it becomes a list item');
    T.eq(doc.insertBranch(doc.parse('# R\n\n- x\n\n## A\n'), '', 0, { text: '- y', kind: 'bullet', indent: 0 }).text,
      '# R\n\n- y\n- x\n\n## A\n', 'a list item among the list of a heading that also has sub-headings');
    T.eq(doc.insertBranch(doc.parse('# R\n\n- x\n\n## A\n'), '', 2, { text: '- y', kind: 'bullet', indent: 0 }).text,
      '# R\n\n- x\n\n## A\n\n## y\n', 'and a heading past the sub-headings');
    T.eq(doc.insertBranch(doc.parse(''), null, 0, { text: '- only', kind: 'bullet', indent: 0 }).text,
      '- only\n', 'an empty document takes a list item as it is');
    var titled = doc.parse('# R\n\n## A\n');
    T.eq(doc.insertBranch(titled, '', Infinity, { text: '- p\n  - q', kind: 'bullet', indent: 0 }).text,
      '# R\n\n## A\n\n## p\n\n- q\n', 'under a root with headings, a heading');
    T.eq(doc.insertBranch(titled, D.pathOf(titled, 'A'), Infinity, { text: '# Z', kind: 'heading', level: 1 }).text,
      '# R\n\n## A\n\n### Z\n', 'a heading under a childless heading takes the right level');
    T.eq(doc.insertBranch(level, '0', Infinity, { text: '    - p\n      - q', kind: 'bullet', indent: 4 }).text,
      '# R\n\n- x\n  - p\n    - q\n', 'a list under a list item, one step in');
    var numbered = doc.parse('# R\n\n1. one\n');
    T.eq(doc.insertBranch(numbered, '0', Infinity, { text: '- p', kind: 'bullet', indent: 0 }).text,
      '# R\n\n1. one\n   - p\n', 'under a numbered item, the width of its number');
    T.eq(doc.insertBranch(level, '0', Infinity, { text: 'Just words.', kind: 'text' }).text,
      '# R\n\n- x\n  - Just words.\n', 'a paragraph under a list item becomes a node');
    var two = doc.parse('# One\n\n# Two\n');
    T.eq(doc.insertBranch(two, null, 1, { text: '# Middle', kind: 'heading', level: 1 }).text,
      '# One\n\n# Middle\n\n# Two\n', 'with several roots, at the top of the document');
    var bullets = doc.parse('- a\n- b\n');
    T.eq(doc.insertBranch(bullets, null, 1, { text: '# H\n\n- h1', kind: 'heading', level: 1 }).text,
      '- a\n- H\n  - h1\n- b\n', 'among top-level list items, a list item');
    T.eq(doc.insertBranch(two, null, 0, { text: '', kind: 'bullet' }), null, 'an empty fragment is nothing');
    var fenced = doc.parse('# R\n\n- x\n');
    T.eq(doc.insertBranch(fenced, '0', Infinity, { text: '## ---\n\n- a', kind: 'heading', level: 2 }).text,
      '# R\n\n- x\n  - \\---\n    - a\n', 'a title is escaped for the line it lands on ("- ---" would be a rule)');
    T.eq(doc.insertBranch(titled, '', Infinity, { text: '- Issue #', kind: 'bullet', indent: 0 }).text,
      '# R\n\n## A\n\n## Issue \\#\n', 'and the other way ("## Issue #" would lose its #)');
    T.eq(doc.insertBranch(titled, '', Infinity, { text: '- \\- d', kind: 'bullet', indent: 0 }).text,
      '# R\n\n## A\n\n## - d\n', 'an escape the new line does not need comes off');
    T.eq(doc.insertBranch(fenced, '0', Infinity, { text: '## C\n\n```sh\n# not a heading\n```', kind: 'heading', level: 2 }).text,
      '# R\n\n- x\n  - C\n\n    ```sh\n    # not a heading\n    ```\n', 'code inside a branch is not re-levelled');
    /* Text under a heading stays text when the heading becomes a bullet
     * (an earlier version made each paragraph a node of its own): it moves to
     * the bullet's content column and is drawn in its body. */
    var prose = doc.insertBranch(fenced, '0', Infinity, { text: '## H\nPara one\nline two\n\n- h1', kind: 'heading', level: 2 }).text;
    T.eq(prose, '# R\n\n- x\n  - H\n    Para one\n    line two\n    - h1\n', 'a paragraph rides along as text');
    var pv = doc.viewTree(doc.parse(prose));
    T.eq(pv.children[0].children[0].body.text, 'Para one\nline two', 'and is drawn in the bullet\'s body');
    T.eq(pv.children[0].children[0].children.length, 1, 'with the list under it');
  });

  /* ---------- drag and drop ---------- */

  var MAP = '# R\n\n## A\n\n- a1\n- a2\n  - a2x\n\n## B\n\n- b1\n';

  function drop(text, from, to, where) {
    var s = doc.parse(text);
    var r = doc.moveTo(s, D.pathOf(s, from), D.pathOf(s, to), where);
    return r ? r.text : null;
  }

  T.test('moveTo: child, before, after', function () {
    T.eq(drop(MAP, 'a1', 'b1', 'child'), '# R\n\n## A\n\n- a2\n  - a2x\n\n## B\n\n- b1\n  - a1\n', 'onto a node: its last child');
    T.eq(drop(MAP, 'a2', 'b1', 'before'), '# R\n\n## A\n\n- a1\n\n## B\n\n- a2\n  - a2x\n- b1\n', 'above a node: the sibling before it');
    T.eq(drop(MAP, 'a1', 'b1', 'after'), '# R\n\n## A\n\n- a2\n  - a2x\n\n## B\n\n- b1\n- a1\n', 'below a node: the sibling after it');
    T.eq(drop(MAP, 'a1', 'a2', 'after'), '# R\n\n## A\n\n- a2\n  - a2x\n- a1\n\n## B\n\n- b1\n', 'reorder within the same list');
    T.eq(drop(MAP, 'a2', 'a1', 'before'), '# R\n\n## A\n\n- a2\n  - a2x\n- a1\n\n## B\n\n- b1\n', 'and the other way');
    T.eq(drop(MAP, 'a2x', 'R', 'child'), '# R\n\n## A\n\n- a1\n- a2\n\n## B\n\n- b1\n\n## a2x\n', 'under a root with headings it becomes a heading');
    T.eq(drop(MAP, 'B', 'a1', 'child'), '# R\n\n## A\n\n- a1\n  - B\n    - b1\n- a2\n  - a2x\n', 'a heading under a list item becomes a list');
    T.eq(drop(MAP, 'B', 'A', 'before'), '# R\n\n## B\n\n- b1\n\n## A\n\n- a1\n- a2\n  - a2x\n', 'headings reorder as headings');
    T.eq(drop(MAP, 'a2', 'A', 'child'), null, 'already the last child: nothing to do');
  });

  T.test('moveTo: refusals and no-ops', function () {
    var s = doc.parse(MAP);
    var p = function (t) { return D.pathOf(s, t); };
    T.eq(doc.moveTo(s, p('a2'), p('a2x'), 'child'), null, 'not into its own subtree');
    T.eq(doc.moveTo(s, p('A'), p('a1'), 'after'), null, 'not beside its own descendant');
    T.eq(doc.moveTo(s, p('a1'), p('a1'), 'child'), null, 'not onto itself');
    T.eq(doc.moveTo(s, p('a1'), p('a2'), 'before'), null, 'already there (before the next)');
    T.eq(doc.moveTo(s, p('a2'), p('a1'), 'after'), null, 'already there (after the previous)');
    T.eq(doc.moveTo(s, p('a2'), p('A'), 'child'), null, 'already the last child');
    T.eq(doc.moveTo(s, p('a1'), 'nope', 'child'), null, 'a missing target');
    T.eq(doc.moveTo(s, p('a1'), p('b1'), 'sideways'), null, 'an unknown place');
    T.eq(doc.moveTo(s, '', p('b1'), 'child'), null, 'the root cannot go under its own node');
    T.eq(doc.canMoveTo(s, p('a1'), p('b1'), 'child'), true, 'canMoveTo says yes');
    T.eq(doc.canMoveTo(s, p('a2'), p('a2x'), 'child'), false, 'and no');
  });

  T.test('moveTo: selection, counts and colours travel', function () {
    var text = '# R\n\n- a <!-- color: #3b6ea5 -->\n  - > note: n\n  - a1\n- b\n';
    var s = doc.parse(text);
    var r = doc.moveTo(s, '0', '1', 'child');
    T.eq(r.text, '# R\n\n- b\n  - a <!-- color: #3b6ea5 -->\n    - > note: n\n    - a1\n', 'the subtree, its note and its colour move');
    var after = doc.parse(r.text);
    T.eq(r.selectPath, '0.0', 'selectPath is the moved node');
    T.eq(doc.labelOf(doc.findByLine(after, r.anchorLine)), 'a', 'and so is the anchor');
    T.same(labels(r.text), labels(text), 'no node gained or lost');
    var forest = '# A\n\n# B\n\n- b1\n';
    var f = doc.moveTo(doc.parse(forest), '0', '1', 'child');
    T.eq(f.text, '# B\n\n- b1\n\n## A\n', 'from a forest into a tree: a heading after the list stays a heading');
    T.eq(f.selectPath, '1', 'and the path follows the new single root');
    var list = '- a\n- b\n- c\n';
    T.eq(doc.moveTo(doc.parse(list), '0', '2', 'after').text, '- b\n- c\n- a\n', 'top-level list items stay list items');
    var numbered = '# R\n\n1. a\n2. b\n3. c\n';
    /* The dropped item starts the list at 1 and the old first item steps
     * to 2; later items keep their written numbers, which CommonMark
     * ignores (it counts on from the first). */
    T.eq(doc.moveTo(doc.parse(numbered), '2', '0', 'before').text, '# R\n\n1. c\n2. a\n2. b\n', 'a numbered item dropped first starts at 1');
    T.same(doc.viewTree(doc.parse('# R\n\n1. c\n2. a\n2. b\n')).children.map(function (v) { return v.ordered; }), [1, 2, 3], 'and the map shows 1, 2, 3');
  });

  /* ---------- indent and outdent in the corners ---------- */

  T.test('indent and outdent: refusals', function () {
    var mixed = doc.parse('- a\n# H\n');
    T.eq(doc.canIndent(mixed, '1'), false, 'a heading cannot go under a list item');
    T.eq(doc.canMove(doc.parse('# R\n\n## A\n\n- x\n\n### B\n'), '0.0', 1), false, 'a list item does not swap with a sub-heading');
    var six = doc.parse('# R\n\n##### A\n\n##### B\n\n###### C\n');
    T.eq(doc.canIndent(six, '1'), false, 'not past h6');
    T.eq(doc.indent(six, '1'), null, 'and indent says no');
    var gap = doc.parse('# H\n\n- a\n\nPara of H\n\n- b\n');
    T.eq(doc.indent(gap, '1'), null, 'not when text between the two items would keep them apart');
    T.eq(doc.canOutdent(doc.parse('# R\n\n- a\n'), '0'), false, 'a list item under a heading has nowhere to go');
    T.eq(doc.outdent(doc.parse('# R\n\n## A\n'), '0').text, '# R\n\n# A\n', 'a first-level heading can become a root');
  });
})();
