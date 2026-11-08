/* store-mentions: ids on nodes and the [[...]] references that name them
 * (js/model/doc.js), and a map renamed taking its links with it
 * (js/model/store.js). An id is an end-of-line marker, '<!-- id: n3k9a1 -->',
 * given the first time something points at the node; [[Map#id|words]]
 * names a node of a map of the project, [[#id|words]] one of the same map. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var doc = ns.doc;
  var store = ns.store;
  ns.i18n.init('en');

  var MAP = '# Root\n\n- A <!-- id: nabc12 -->\n  - A1\n- B see [[Other#nxyz99|that]] and [[#nabc12|A]] and [[Plain]]\n';

  T.test('the id marker is read, kept through edits and written back in its place', function () {
    var s = doc.parse(MAP);
    T.eq(s.byPath['0'].id, 'nabc12', 'read');
    T.eq(doc.plainText(s.byPath['0']), 'A', 'it is no part of the words');
    T.same(doc.idsOf(s), { nabc12: '0' }, 'the ids of a map');
    T.eq(doc.pathOfId(s, 'NABC12'), '0', 'found by id, in any case');
    T.eq(doc.pathOfId(s, 'nope00'), null, 'not found');
    var painted = doc.setColor(s, '0', '#ff0000');
    T.eq(painted.text.split('\n')[2], '- A <!-- id: nabc12 --> <!-- color: #ff0000 -->', 'a colour comes after it');
    var renamed = doc.rename(s, '0', 'Alpha');
    T.eq(renamed.text.split('\n')[2], '- Alpha <!-- id: nabc12 -->', 'a rename leaves it');
    var moved = doc.moveTo(s, '0', '1', 'child');
    T.ok(moved && moved.text.indexOf('<!-- id: nabc12 -->') > 0, 'a move carries it');
    var escaped = doc.parse('# R\n\n- A \\<!-- id: nabc12 -->\n');
    T.eq(escaped.byPath['0'].id, null, 'an escaped comment is the words typed, not an id');
  });

  T.test('an id is given once, unique in its map, and writes one edit', function () {
    var s = doc.parse(MAP);
    var had = doc.ensureId(s, '0');
    T.same([had.id, had.result], ['nabc12', null], 'a node that has one keeps it');
    var got = doc.ensureId(s, '1');
    T.ok(/^n[a-z0-9]{5}$/.test(got.id), 'a new one is n and five letters or digits: ' + got.id);
    T.ok(got.result.text.indexOf('<!-- id: ' + got.id + ' -->') > 0, 'written on the node\'s line');
    T.eq(doc.parse(got.result.text).byPath['1'].id, got.id, 'and read back');
    T.eq(doc.ensureId(s, '9'), null, 'a node that is not there');
    var seen = {};
    var repeats = 0;
    for (var i = 0; i < 300; i++) { var id = doc.newId(seen); if (seen[id]) repeats++; seen[id] = true; }
    T.eq(repeats, 0, 'a new id is never one already taken');
  });

  T.test('[[...]] reads a node reference, with or without a map', function () {
    var refs = doc.wikiRefs(MAP);
    T.same(refs.map(function (r) { return [r.path, r.name, r.node, r.label]; }), [
      ['1', 'Other', 'nxyz99', 'that'],
      ['1', '', 'nabc12', 'A'],
      ['1', 'Plain', '', 'Plain']
    ], 'who writes what, and where');
    var drawn = doc.parse('# R\n\n- see [[M#nabc12|the note]] and [[Other map]]\n');
    var tree = doc.viewTree(drawn);
    var words = tree.children[0].html;
    T.ok(words.indexOf('data-map="M" data-node="nabc12">the note</a>') > 0, 'a reference carries the map and the node');
    T.ok(words.indexOf('data-map="Other map">Other map</a>') > 0, 'a map link carries no node');
    T.eq(doc.wikiRefs('# R\n\n```\n[[X#nabc12]]\n```\n').length, 0, 'not inside a code fence');
    T.eq(doc.wikiRefs('# R\n\n- [[#nabc12]]\n')[0].label, '#nabc12', 'no words: its id');
  });

  T.test('stripIds takes the markers off a copy, not typed words', function () {
    T.eq(doc.stripIds('- A <!-- id: nabc12 -->\n- B <!-- id: nxyz99 --> <!-- color: #fff -->\n'), '- A\n- B <!-- color: #fff -->\n', 'ids off, the rest stays');
    T.eq(doc.stripIds('- A \\<!-- id: nabc12 -->'), '- A \\<!-- id: nabc12 -->', 'an escaped one is left');
    T.eq(doc.stripIds('- A <!-- id: nabc12 -->\n- B <!-- id: nxyz99 -->\n', { nabc12: true }), '- A\n- B <!-- id: nxyz99 -->\n', 'with a list: only those ids');
  });

  T.test('renaming a map renames the links to it, in every map of the project', function () {
    store.init({});
    var p = store.createProject({ name: 'P' });
    var a = store.map(p.id);
    var b = store.createMap(p.id, { name: 'Other', text: '# Other\n\n- Node <!-- id: nxyz99 -->\n' });
    var c = store.createMap(p.id, { name: 'Links', text: '# Links\n\n- [[Other#nxyz99|the node]] and [[other]] and [[Other|words]] and [[Else]] and [[#nabc12|here]]\n\n```\n[[Other]]\n```\n' });
    var before = store.historyState().undoCount;
    T.eq(store.renameMap(p.id, b.id, 'Renamed'), true, 'renamed');
    T.eq(store.map(p.id, c.id).text, '# Links\n\n- [[Renamed#nxyz99|the node]] and [[Renamed]] and [[Renamed|words]] and [[Else]] and [[#nabc12|here]]\n\n```\n[[Other]]\n```\n', 'links follow, their words and other links stay, a fence is left');
    T.eq(store.historyState().undoCount - before, 1, 'one step');
    store.undo();
    T.ok(store.map(p.id, c.id).text.indexOf('[[Other#nxyz99|the node]]') > 0, 'undone together');
    T.eq(doc.renameMapLinks('[[A]]', 'A', 'B|C'), '[[A]]', 'a name that would break the link is not written');
    T.eq(doc.renameMapLinks('[[A]]', 'A', 'a'), '[[A]]', 'the same name: nothing');
  });
})();
