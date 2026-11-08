/* MindRoot - what the store adds to the previous one: map views (folds,
 * camera, direction) outside the history, the read-only mode of a second
 * tab, the projects GC must keep, and its strings in both languages. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  ns.i18n.init('en');

  var p, m;

  T.test('map views: not a step, and they survive undo', function () {
    store.init({});
    p = store.createProject({ name: 'P' });
    m = store.map(p.id);
    T.same(store.mapView(p.id, m.id), { folds: [], direction: null, camera: null }, 'a map with no view yet');
    var heard = [];
    var off = store.subscribe(function (c) { heard.push(c.type); });
    var steps = store.historyState().undoCount;
    T.eq(store.setMapView(p.id, m.id, { folds: ['P\u001fa', 'P\u001fa', 7, 'P\u001fb'], direction: 'both' }), true, 'folds and direction set');
    T.same(store.mapView(p.id, m.id).folds, ['P\u001fa', 'P\u001fb'], 'folds kept as unique strings');
    T.eq(store.mapView(p.id, m.id).direction, 'both', 'direction kept');
    T.eq(store.historyState().undoCount, steps, 'not a step of the history');
    T.same(heard, ['view'], 'listeners hear a view change (storage saves it)');
    off();
    var table = store.mapViews();
    T.eq(store.setMapView(p.id, m.id, { folds: ['P\u001fa', 'P\u001fb'] }), false, 'the same view again: no change');
    T.eq(store.mapViews(), table, 'and the table is the same object');
    T.eq(store.setMapView(p.id, m.id, { camera: { x: 10, y: -4, k: 1.5 } }), true, 'the camera');
    T.ok(store.mapViews() !== table, 'a change makes a new table (storage tells by identity)');
    T.same(store.mapView(p.id, m.id), { folds: ['P\u001fa', 'P\u001fb'], direction: 'both', camera: { x: 10, y: -4, k: 1.5 } }, 'only the fields given change');
    T.eq(store.setMapView(p.id, m.id, { direction: 'sideways', camera: { x: NaN, y: 0, k: 1 } }), true, 'nonsense is dropped');
    T.same(store.mapView(p.id, m.id), { folds: ['P\u001fa', 'P\u001fb'], direction: null, camera: null }, 'as nothing');
    var v = store.mapView(p.id, m.id);
    v.folds.push('mutated');
    T.eq(store.mapView(p.id, m.id).folds.length, 2, 'what mapView hands out is a copy');

    store.setMapText(p.id, m.id, '# P\n\n- a\n');
    store.undo();
    T.eq(store.mapView(p.id, m.id).folds.length, 2, 'undoing an edit does not unfold the map');
    store.redo();
    T.eq(store.mapView(p.id, m.id).folds.length, 2, 'nor does redo');
    T.eq(store.setMapView(p.id, m.id, { folds: [] }), true, 'unfolding everything');
    T.eq(store.mapViews()[p.id], undefined, 'an empty view leaves the table');
    T.eq(store.setMapView(null, m.id, { folds: [] }), false, 'no project, nothing');
  });

  T.test('map views come back from init, for projects that are there', function () {
    store.setMapView(p.id, m.id, { folds: ['x'], camera: { x: 1, y: 2, k: 0.5 } });
    var saved = JSON.parse(JSON.stringify({ projects: store.projects(), ui: store.ui(), views: store.mapViews() }));
    saved.views.gone = { m: { folds: ['y'] } };
    store.init(saved);
    T.same(store.mapView(p.id, m.id), { folds: ['x'], direction: null, camera: { x: 1, y: 2, k: 0.5 } }, 'the view of a map is back');
    T.eq(store.mapViews().gone, undefined, 'the view of a project that is not there is left behind');
  });

  T.test('read-only: the store accepts nothing', function () {
    store.init({});
    p = store.createProject({ name: 'P' });
    m = store.map(p.id);
    var other = store.createMap(p.id, { name: 'Other' });
    store.setActive(p.id, m.id);
    store.setMapText(p.id, m.id, '# P\n\n- a\n');
    var heard = [];
    var off = store.subscribe(function (c) { heard.push(c); });
    T.eq(store.setReadOnly(true), true, 'read-only on');
    T.eq(store.readOnly(), true, 'and says so');
    T.eq(heard[0].type, 'readonly', 'listeners hear it');
    T.eq(heard[0].readOnly, true, 'with the new state');
    var before = store.state;
    T.eq(store.setMapText(p.id, m.id, '# P\n\n- b\n'), false, 'setMapText refused');
    T.eq(store.createProject({ name: 'Q' }), null, 'createProject refused');
    T.eq(store.createMap(p.id, { name: 'M' }), null, 'createMap refused');
    T.eq(store.renameMap(p.id, m.id, 'Z'), false, 'renameMap refused');
    T.eq(store.deleteMap(p.id, m.id), null, 'deleteMap refused');
    T.eq(store.deleteProject(p.id), false, 'deleteProject refused');
    T.eq(store.updateProject(p.id, { name: 'Z' }), false, 'updateProject refused');
    T.eq(store.setTemplate(p.id, true), false, 'setTemplate refused');
    T.eq(store.duplicateProject(p.id), null, 'duplicateProject refused');
    T.eq(store.duplicateMap(p.id, m.id), null, 'duplicateMap refused');
    T.eq(store.moveProject(p.id, 3), false, 'moveProject refused');
    T.eq(store.moveMap(p.id, m.id, 3), false, 'moveMap refused');
    T.same(store.importProjects([{ name: 'X', maps: [] }]), [], 'importProjects refused');
    T.eq(store.setFile(p.id, 'assets/x.png', { asset: 'x', type: 'image/png' }), false, 'setFile refused');
    T.eq(store.takeSnapshot(p.id, m.id, { kind: 'auto' }), null, 'a clock copy refused');
    T.eq(store.takeSnapshot(p.id, m.id, { kind: 'manual' }), null, 'a copy by hand refused');
    T.eq(store.trashBranch(p.id, m.id, { text: '# P\n', fragment: { text: '- a', kind: 'bullet' } }), null, 'trashBranch refused');
    T.eq(store.trashFigure(p.id, m.id, { path: 'assets/x.png' }), null, 'trashFigure refused');
    T.same(store.trashFiles(p.id, ['assets/x.png']), [], 'trashFiles refused');
    T.same(store.restoreTrashMany(p.id, ['x']), [], 'restore refused');
    T.same(store.purgeTrashMany(p.id, ['x']), [], 'purge refused');
    T.eq(store.emptyTrash(p.id), 0, 'emptyTrash refused');
    T.eq(store.importBranches({}), null, 'importBranches refused');
    var tx = store.transaction('nothing gets through', function () { store.setMapText(p.id, m.id, '# no\n'); return 'ran'; });
    T.eq(tx, 'ran', 'a transaction still runs its function');
    T.eq(store.state, before, 'and the value never changed');
    T.eq(store.canUndo(), false, 'no undo offered');
    T.eq(store.undo(), null, 'and undo refused (it would change the data)');
    T.eq(store.historyState().undoLabel, null, 'history state says nothing to undo');
    T.eq(store.setActive(p.id, other.id), true, 'opening another map still works');
    T.eq(store.here().mapId, other.id, 'and it is open');
    T.eq(store.setMapView(p.id, m.id, { folds: ['P'] }), true, 'folding still works (it is looking)');
    store.setReadOnly(false);
    T.eq(store.canUndo(), true, 'writable again: the history is still there');
    T.eq(store.setMapText(p.id, m.id, '# P\n\n- c\n'), true, 'and changes go in again');
    T.eq(store.setReadOnly(false), false, 'setting the same mode again changes nothing');
    off();
  });

  T.test('the projects garbage collection must keep', function () {
    store.init({});
    var a = store.createProject({ name: 'A' });
    var b = store.createProject({ name: 'B' });
    store.deleteProject(b.id);
    var kept = store.retainedProjects();
    T.ok(kept.some(function (x) { return x.id === b.id; }), 'a deleted project undo can bring back is kept');
    T.ok(kept.some(function (x) { return x.id === a.id; }), 'and the ones there now');
    T.eq(new Set(kept).size, kept.length, 'each object once');
    store.clearHistory();
    T.ok(!store.retainedProjects().some(function (x) { return x.id === b.id; }), 'once the history is cleared it is not');
  });

  T.test('strings: both languages, house style', function () {
    var I = ns.i18n;
    var en = I.keys('en').filter(function (k) { return /^store\./.test(k); });
    var it = I.keys('it').filter(function (k) { return /^store\./.test(k); });
    T.ok(en.length > 30, 'strings registered');
    T.same(en.filter(function (k) { return it.indexOf(k) < 0; }), [], 'none in English only');
    T.same(it.filter(function (k) { return en.indexOf(k) < 0; }), [], 'none in Italian only');
    I.init('it');
    var itText = it.map(function (k) { return I.t(k); });
    I.init('en');
    var enText = en.map(function (k) { return I.t(k); });
    var all = itText.concat(enText);
    T.same(all.filter(function (s) { return /!/.test(s); }), [], 'no exclamation marks');
    T.same(all.filter(function (s) { return /—/.test(s); }), [], 'no em-dashes');
    T.same(all.filter(function (s) { return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s); }), [], 'no emoji');
    T.eq(store.labelText('store.label.newMap'), 'new map', 'a key in words');
    T.eq(store.labelText({ key: 'store.label.purge', n: 1 }), 'delete for good', 'a counted key, one');
    T.eq(store.labelText({ key: 'store.label.purge', n: 4 }), 'delete 4 for good', 'a counted key, many');
    T.eq(store.labelText(''), 'change', 'no label: "change"');
    T.eq(store.labelText('just words'), 'just words', 'words are shown as they are');
  });
})();
