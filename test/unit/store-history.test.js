/* MindRoot - one history (ported from an earlier history suite): every change to the
 * data is a labelled step, transactions make one step, undo goes back to
 * the map where the change happened, typing coalesces by key in a sliding
 * 1.5 s, clock copies survive undo, 300 steps at most. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  ns.i18n.init('en');

  var p, a, b;

  T.test('one step per change, with its label', function () {
    store.init({});
    p = store.createProject({ name: 'P' });
    a = store.map(p.id);
    b = store.createMap(p.id, { name: 'B', text: '# B\n' });
    var hs = store.historyState();
    T.eq(hs.undoLabel, 'new map', 'making a map is a step');
    T.eq(hs.undoLabelKey, 'store.label.newMap', 'labelled by an i18n key');
    T.eq(hs.undoCount, 2, 'two steps so far');
    T.eq(hs.canRedo, false, 'nothing to redo');
    store.setMapText(p.id, a.id, '# P\n\n- one\n', { label: 'add a child' });
    T.eq(store.historyState().undoLabel, 'add a child', 'the label given (words are shown as they are)');
  });

  T.test('undo and redo travel to where the change happened', function () {
    store.setActive(p.id, b.id);
    var back = store.undo();
    T.eq(back.label, 'add a child', 'undo says what it undid');
    T.eq(store.map(p.id, a.id).text, '# P\n', 'the text comes back');
    T.same(store.here(), { projectId: p.id, mapId: a.id }, 'and the map of the change is open');
    T.eq(store.canRedo(), true, 'now there is something to redo');
    T.eq(store.historyState().redoLabel, 'add a child', 'redo says what');

    store.setActive(p.id, b.id);
    var again = store.redo();
    T.eq(store.map(p.id, a.id).text, '# P\n\n- one\n', 'redo writes it again');
    T.same(store.here(), { projectId: p.id, mapId: a.id }, 'and goes to the map too');
    T.eq(again.label, 'add a child', 'redo says what');

    store.undo();
    store.setMapText(p.id, b.id, '# B\n\n- other\n');
    T.eq(store.canRedo(), false, 'a new change clears what could be redone');
  });

  T.test('the selection before and after', function () {
    store.setMapText(p.id, a.id, '# P\n\n- two\n', { label: 'rename', from: { selected: '0' }, to: { selectPath: '0', anchorLine: 2 } });
    var u = store.undo();
    T.eq(u.where.selected, '0', 'undo brings back the node chosen before');
    var r = store.redo();
    T.eq(r.where.anchorLine, 2, 'redo the line after');
    T.eq(r.where.selectPath, '0', 'and the path after');
  });

  T.test('a transaction is one step', function () {
    var count = store.historyState().undoCount;
    store.transaction('three things at once', function () {
      store.setMapText(p.id, a.id, '# P\n\n- three\n');
      store.renameMap(p.id, b.id, 'Bi');
      store.setFile(p.id, 'assets/x.png', { asset: 'x', type: 'image/png', size: 1 });
    });
    T.eq(store.historyState().undoCount, count + 1, 'three changes, one step');
    T.eq(store.historyState().undoLabel, 'three things at once', 'under the transaction label');
    store.undo();
    T.eq(store.map(p.id, a.id).text, '# P\n\n- two\n', 'undoing it brings back the text');
    T.eq(store.map(p.id, b.id).name, 'B', 'the name');
    T.eq(store.fileRef(p.id, 'assets/x.png'), null, 'and the file');
    store.redo();

    var nested = store.historyState().undoCount;
    store.transaction('outer', function () {
      store.transaction('inner', function () { store.setMapText(p.id, a.id, '# P\n\n- four\n'); });
      T.eq(store.undo(), null, 'no undo inside a transaction');
    });
    T.eq(store.historyState().undoCount, nested + 1, 'nested transactions are one step');
    T.eq(store.historyState().undoLabel, 'outer', 'with the outer label');
    var empty = store.historyState().undoCount;
    store.transaction('nothing', function () {});
    T.eq(store.historyState().undoCount, empty, 'a transaction that changes nothing is no step');
  });

  T.test('a transaction label can be a counted key', function () {
    store.transaction({ key: 'store.label.restore', n: 3 }, function () { store.setMapText(p.id, b.id, '# B\n\n- x\n'); });
    T.eq(store.historyState().undoLabel, 'restore 3 from the trash', 'plural from i18n');
    store.undo();
  });

  T.test('typing in the Markdown panel: one step per pause', function () {
    var typing = store.historyState().undoCount;
    store.setMapText(p.id, a.id, '# P\n\n- c\n', { key: 'source:' + a.id, label: 'edit the Markdown' });
    store.setMapText(p.id, a.id, '# P\n\n- ci\n', { key: 'source:' + a.id, label: 'edit the Markdown' });
    store.setMapText(p.id, a.id, '# P\n\n- cia\n', { key: 'source:' + a.id, label: 'edit the Markdown' });
    T.eq(store.historyState().undoCount, typing + 1, 'three keys in a row are one step');
    var realNow = Date.now;
    var shifted = realNow() + 2000;
    Date.now = function () { return shifted; };
    try {
      store.setMapText(p.id, a.id, '# P\n\n- hello\n', { key: 'source:' + a.id, label: 'edit the Markdown' });
    } finally {
      Date.now = realNow;
    }
    T.eq(store.historyState().undoCount, typing + 2, 'after a pause, a new step');
    store.undo();
    store.undo();
    T.eq(store.map(p.id, a.id).text, '# P\n\n- four\n', 'and undo goes back past every key');
    store.redo();
    store.redo();
    T.eq(store.map(p.id, a.id).text, '# P\n\n- hello\n', 'redo forward again');
    store.setMapText(p.id, a.id, '# P\n\n- hello!\n', { key: 'source:' + a.id, label: 'edit the Markdown' });
    T.eq(store.historyState().undoCount, typing + 3, 'typing after a travel never merges into the travelled step');
    store.undo();
  });

  T.test('the coalescing window slides', function () {
    var count = store.historyState().undoCount;
    var realNow = Date.now;
    var at = realNow();
    try {
      for (var i = 0; i < 4; i++) {
        Date.now = function () { return at; };
        store.setMapText(p.id, b.id, '# B\n\n- slide ' + i + '\n', { key: 'board:' + b.id });
        at += 1000;
      }
    } finally {
      Date.now = realNow;
    }
    T.eq(store.historyState().undoCount, count + 1, 'each within 1.5 s of the previous: one step over 3 s');
    store.undo();
  });

  T.test('opening is not a step', function () {
    var views = store.historyState().undoCount;
    store.setActive(p.id, b.id);
    store.setActive(p.id, a.id);
    T.eq(store.historyState().undoCount, views, 'changing map is not a step');
  });

  T.test('clock copies stay', function () {
    store.setMapText(p.id, a.id, '# P\n\n- five\n');
    store.takeSnapshot(p.id, a.id, { kind: 'auto' });
    T.eq(store.snapshotsOf(p.id, a.id).length, 1, 'the copy is there');
    T.eq(store.historyState().undoLabel, 'edit the map', 'a clock copy is not a step');
    store.undo();
    T.eq(store.snapshotsOf(p.id, a.id).length, 1, 'undoing the change before keeps the copy');
    T.eq(store.snapshotsOf(p.id, a.id)[0].text, '# P\n\n- five\n', 'with the text it was taken from');
    store.redo();
    T.eq(store.snapshotsOf(p.id, a.id).length, 1, 'and redo keeps it too');

    store.takeSnapshot(p.id, a.id, { kind: 'manual', label: 'by hand', when: Date.now() + 120000 });
    T.eq(store.historyState().undoLabel, 'take a copy', 'a copy by hand is a step');
    store.undo();
    T.eq(store.snapshotsOf(p.id, a.id).length, 1, 'and undoing it takes it away');
    store.redo();
  });

  T.test('projects: undo brings them back, and goes back to where you were', function () {
    var q = store.createProject({ name: 'Q' });
    T.eq(store.here().projectId, q.id, 'Q made and open');
    store.undo();
    T.eq(store.project(q.id), null, 'undoing takes Q away');
    T.eq(store.here().projectId, p.id, 'and goes back to the project before');
    store.redo();
    T.eq(!!store.project(q.id), true, 'redo puts Q back');
    T.eq(store.here().projectId, q.id, 'and opens it');

    store.deleteProject(p.id);
    T.eq(store.project(p.id), null, 'P deleted');
    var del = store.undo();
    T.eq(del.label, 'delete the project', 'undoing the deletion');
    T.ok(!!store.project(p.id), 'brings P back');
    T.eq(store.here().projectId, p.id, 'and opens it');
    T.eq(store.project(p.id).maps.length, 2, 'with its maps');
  });

  T.test('the limit', function () {
    for (var i = 0; i < store.HISTORY_LIMIT + 5; i++) store.setMapText(p.id, b.id, '# B\n\n- n' + i + '\n');
    T.eq(store.historyState().undoCount, store.HISTORY_LIMIT, 'the history keeps the last 300 steps');
    T.eq(store.HISTORY_LIMIT, 300, 'which is 300');
  });

  T.test('who is listening', function () {
    var heard = [];
    var labels = [];
    var off = store.subscribe(function (change) { heard.push(change.type); if (change.labelKey) labels.push([change.label, change.labelKey]); });
    store.setMapText(p.id, b.id, '# B\n');
    store.undo();
    off();
    store.redo();
    T.ok(heard.indexOf('map:text') >= 0, 'listeners hear the change');
    T.ok(heard.indexOf('history') >= 0, 'and the travel');
    T.eq(heard.filter(function (t) { return t === 'history'; }).length, 1, 'and stop hearing once removed');
    T.same(labels[0], ['edit the map', 'store.label.editMap'], 'with the label in words and its key');
    var calls = 0;
    var off1 = store.subscribe(function () { calls++; throw new Error('listener broke (on purpose)'); });
    var off2 = store.subscribe(function () { calls++; });
    var original = window.setTimeout;
    var deferred = [];
    window.setTimeout = function (fn) { deferred.push(fn); return 0; };
    try { store.setMapText(p.id, b.id, '# B\n\n- y\n'); } finally { window.setTimeout = original; }
    off1();
    off2();
    T.eq(calls, 4, 'a listener that throws does not stop the next one (change + history:changed)');
    T.eq(deferred.length, 2, 'its error is rethrown on a task of its own');
  });

  T.test('labels follow the language', function () {
    store.setMapText(p.id, b.id, '# B\n\n- z\n');
    ns.i18n.init('it');
    T.eq(store.historyState().undoLabel, 'modifica la mappa', 'the same step, in Italian');
    store.deleteProject(p.id);
    var back = store.undo();
    T.eq(back.label, 'elimina il progetto', 'undo says it in Italian');
    ns.i18n.init('en');
    T.eq(store.historyState().redoLabel, 'delete the project', 'and back in English');
    store.redo();
    store.undo();
  });

  T.test('clearing the history', function () {
    store.clearHistory();
    T.eq(store.canUndo(), false, 'an emptied history has no steps');
    T.eq(store.canRedo(), false, 'nor anything to redo');
  });
  T.test('join finishes a step; withdraw takes the top step back with nothing to redo', function () {
    store.init({});
    var q = store.createProject({ name: 'Q' });
    var m = store.map(q.id);
    store.setMapText(q.id, m.id, '# Q\n\n- New node\n', { label: 'add a child' });
    var id = store.historyState().undoId;
    var count = store.historyState().undoCount;
    store.setMapText(q.id, m.id, '# Q\n\n- Named\n', { label: 'rename', join: id });
    T.same([store.historyState().undoCount, store.historyState().undoLabel], [count, 'add a child'], 'the name joins the add');
    store.undo();
    T.eq(store.map(q.id, m.id).text, '# Q\n', 'one undo takes both back');
    store.redo();
    store.setMapText(q.id, m.id, '# Q\n\n- Named\n- New node\n', { label: 'add a sibling' });
    var id2 = store.historyState().undoId;
    T.eq(store.withdraw(id2 + 1), false, 'only that very step');
    T.eq(store.withdraw(id2), true, 'withdrawn');
    T.same([store.map(q.id, m.id).text, store.canRedo()], ['# Q\n\n- Named\n', false], 'gone, nothing to redo');
  });

})();
