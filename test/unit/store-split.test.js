/* MindRoot - branches turned into maps of their own (store.splitBranches):
 * the new maps in the project, the [[links]] left in the source map, the
 * link back, one undo step for the whole lot. The model alone. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  var doc = ns.doc;
  ns.i18n.init('en');

  var SRC = [
    '# Gym app',
    '',
    '- Athlete',
    '  - > text: what the athlete sees',
    '  - Weight history',
    '  - QR check-in',
    '    - fast',
    '- Trainer <!-- side: left -->',
    '  - Templates',
    '- Admin',
    '  - KPI dashboard',
    ''
  ].join('\n');

  function pathOf(text, title) {
    var s = doc.parse(text);
    for (var i = 0; i < s.flat.length; i++) if (doc.plainText(s.flat[i]) === title) return s.flat[i].path;
    return null;
  }

  var p, m;

  function fresh() {
    store.init({});
    p = store.createProject({ name: 'Gym' });
    m = store.createMap(p.id, { name: 'Gym app', text: SRC });
  }

  T.test('one branch becomes a map, linked both ways', function () {
    fresh();
    var before = store.project(p.id).maps.length;
    var res = store.splitBranches(p.id, m.id, [pathOf(SRC, 'Athlete')]);
    T.eq(res.count, 1, 'one map made');
    var maps = store.project(p.id).maps;
    T.eq(maps.length, before + 1, 'a map more in the project');
    var at = maps.map(function (x) { return x.id; }).indexOf(res.maps[0].id);
    T.eq(maps[at - 1].id, m.id, 'right after the source');
    var newMap = maps[at];
    T.eq(newMap.name, 'Athlete', 'named after the node');
    var made = doc.parse(newMap.text);
    T.eq(doc.plainText(made.byPath['']), 'Athlete', 'the node is the new root');
    T.eq(made.byPath[''].children.length, 2, 'its children are the branches');
    T.ok(pathOf(newMap.text, 'fast') !== null, 'the grandchildren come along');
    T.eq(doc.bodyFor(made, ''), 'what the athlete sees', 'the words under it come along');
    T.ok(/\[\[Gym app\]\]/.test(newMap.text), 'the new map links back');
    var src = store.map(p.id, m.id).text;
    T.ok(/^- \[\[Athlete\]\]$/m.test(src), 'the source keeps a link to the new map');
    T.eq(pathOf(src, 'Weight history'), null, 'the children left the source');
    T.ok(!/what the athlete sees/.test(src), 'so did the words under it');
    T.eq(store.here().mapId, m.id, 'the source map stays open');
  });

  T.test('one undo takes the whole split back', function () {
    fresh();
    var count = store.project(p.id).maps.length;
    store.splitBranches(p.id, m.id, [pathOf(SRC, 'Athlete'), pathOf(SRC, 'Trainer'), pathOf(SRC, 'Admin')]);
    T.eq(store.project(p.id).maps.length, count + 3, 'three maps');
    store.undo();
    T.eq(store.project(p.id).maps.length, count, 'gone in one step');
    T.eq(store.map(p.id, m.id).text, doc.normalizeText(SRC), 'the source as it was');
  });

  T.test('every first-level branch, in order, names kept free', function () {
    fresh();
    store.createMap(p.id, { name: 'Admin' });
    store.setActive(p.id, m.id);
    var res = store.splitBranches(p.id, m.id, [pathOf(SRC, 'Admin'), pathOf(SRC, 'Athlete'), pathOf(SRC, 'Trainer')]);
    T.eq(res.count, 3, 'three maps');
    T.same(res.maps.map(function (x) { return x.name; }), ['Athlete', 'Trainer', 'Admin 2'], 'file order; a taken name gets a number');
    var src = store.map(p.id, m.id).text;
    T.ok(/\[\[Admin 2\]\]/.test(src), 'the link names the free name');
    T.ok(/\[\[Trainer\]\] <!-- side: left -->/.test(src), 'the side of the branch stays');
  });

  T.test('a child chosen with its parent goes with the parent; the root is refused', function () {
    fresh();
    var res = store.splitBranches(p.id, m.id, [pathOf(SRC, 'Athlete'), pathOf(SRC, 'QR check-in'), '']);
    T.eq(res.count, 1, 'only the parent');
    T.same(store.splitBranches(p.id, m.id, ['']), { count: 0, maps: [] }, 'nothing for the root alone');
    T.same(store.splitBranches(p.id, m.id, ['9.9']), { count: 0, maps: [] }, 'nothing for a path not there');
    T.same(store.splitBranches(p.id, m.id, [pathOf(store.map(p.id, m.id).text, 'Athlete')]), { count: 0, maps: [] }, 'nothing for a branch that is already a link');
  });
})();
