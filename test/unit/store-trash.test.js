/* MindRoot - the project trash (store parts of an earlier trash suite): branches,
 * pictures taken out of a node, files from the images panel, maps and
 * copies go in; they come back where they were, one or many at once, with
 * an honest word on how it went; and they leave for good only when asked. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  var doc = ns.doc;
  var D = window.DataT;
  ns.i18n.init('en');

  var ref = D.ref;
  var pathOf = D.pathOf;
  var TEXT = '# Root\n\n- one\n  - ![](assets/a.png) one a\n- two\n  - ![](assets/b.png) two a\n';
  var p, m, m2;

  function trashNode(label, mapId) {
    mapId = mapId || m.id;
    var text = store.map(p.id, mapId).text;
    var parsed = doc.parse(text);
    var path = pathOf(text, label);
    var x = doc.extractBranch(parsed, path);
    return store.trashBranch(p.id, mapId, { text: doc.remove(parsed, path).text, fragment: x.fragment, origin: x.origin });
  }

  T.test('a branch goes in, and its file with it', function () {
    store.init({});
    p = store.createProject({ name: 'P' });
    m = store.map(p.id);
    store.setMapText(p.id, m.id, TEXT);
    m2 = store.createMap(p.id, { name: 'Second', text: '# S\n\n- ![](assets/b.png) here too\n' });
    store.setFile(p.id, 'assets/a.png', ref('A'));
    store.setFile(p.id, 'assets/b.png', ref('B'));
    store.setActive(p.id, m.id);

    var e1 = trashNode('one');
    T.eq(store.trash(p.id).length, 1, 'the branch is in the trash');
    T.eq(store.trash().length, 1, 'trash() without an id is the open project\'s');
    T.eq(e1.label, 'one', 'with its name');
    T.eq(e1.mapName, 'P', 'and its map name');
    T.eq(e1.fragment.kind, 'bullet', 'and its shape');
    T.same(e1.origin.lineage, ['Root'], 'and where it hung');
    T.eq(store.map(p.id, m.id).text, '# Root\n\n- two\n  - ![](assets/b.png) two a\n', 'the map loses it');
    T.ok(!store.fileRef(p.id, 'assets/a.png'), 'a file only it named leaves assets/');
    T.eq(e1.files['assets/a.png'].asset, 'A', 'and goes with it');
    T.eq(store.historyState().undoLabel, 'delete the branch', 'one step');

    store.undo();
    T.eq(store.map(p.id, m.id).text, TEXT, 'undo puts the branch back');
    T.eq(store.trash(p.id).length, 0, 'and takes the entry out of the trash');
    T.eq(store.fileRef(p.id, 'assets/a.png').asset, 'A', 'and the file is back');
    store.redo();

    var res = store.restoreTrash(p.id, e1.id);
    T.eq(store.map(p.id, m.id).text, TEXT, 'restoring puts it where it was');
    T.eq(res.where, 'same', 'and says so');
    T.eq(res.mapId, m.id, 'in its map');
    T.eq(typeof res.anchorLine, 'number', 'with the line to select');
    T.eq(store.fileRef(p.id, 'assets/a.png').asset, 'A', 'with the file');
    T.eq(store.trash(p.id).length, 0, 'and the trash is empty');
    T.eq(store.historyState().undoLabel, 'restore from the trash', 'restoring is a step');
    T.eq(store.restoreTrash(p.id, 'nope'), null, 'an entry that is not there: null');
  });

  T.test('a file another map uses stays, and is recorded too', function () {
    var e2 = trashNode('two a');
    T.ok(!!store.fileRef(p.id, 'assets/b.png'), 'a file another map uses stays');
    T.ok(!!e2.files['assets/b.png'], 'but also goes with the branch');
    store.restoreTrash(p.id, e2.id);
    T.eq(Object.keys(store.project(p.id).files).length, 2, 'and coming back it is not doubled');
  });

  T.test('a name taken meanwhile by other bytes', function () {
    var e3 = trashNode('one');
    store.setFile(p.id, 'assets/a.png', ref('NEW'));
    store.restoreTrash(p.id, e3.id);
    T.eq(store.fileRef(p.id, 'assets/a-2.png').asset, 'A', 'the file coming back takes a free name');
    T.eq(store.fileRef(p.id, 'assets/a.png').asset, 'NEW', 'the new one stays');
    T.eq(store.map(p.id, m.id).text, TEXT.replace('assets/a.png', 'assets/a-2.png'), 'and the branch names the new name');
    store.undo();
    store.undo();
    store.restoreTrash(p.id, e3.id);
    T.eq(store.map(p.id, m.id).text, TEXT, 'without the new file the old name comes back');
    T.eq(store.trash(p.id).length, 0, 'and the trash is empty again');
  });

  T.test('child then parent: back together, in one step', function () {
    store.setMapText(p.id, m.id, TEXT);
    var child = trashNode('one a');
    var parent = trashNode('one');
    var alone = store.map(p.id, m.id).text;
    var many = store.restoreTrashMany(p.id, [child.id, parent.id, 'nope']);
    T.eq(many.length, 2, 'two entries restored');
    T.eq(many[0].entry.id, parent.id, 'newest first: the parent first');
    T.eq(store.map(p.id, m.id).text, TEXT, 'the child goes back inside the parent, in its place');
    T.eq(store.historyState().undoLabel, 'restore 2 from the trash', 'one step');
    store.undo();
    T.eq(store.trash(p.id).length, 2, 'one undo puts both back in the trash');
    T.eq(store.map(p.id, m.id).text, alone, 'with the text before');

    var onlyChild = store.restoreTrash(p.id, child.id);
    T.eq(onlyChild.where, 'top', 'the child without its parent goes to the end of the root');
    T.eq(store.map(p.id, m.id).text, '# Root\n\n- two\n  - ![](assets/b.png) two a\n- ![](assets/a.png) one a\n', 'there');
    store.undo();
    T.same(store.restoreTrashMany(p.id, []), [], 'nothing chosen: nothing');
  });

  T.test('a branch whose map is gone comes back in a map made again', function () {
    var loose = trashNode('two');
    var gm = store.createMap(p.id, { name: 'Via', text: '# Via\n' });
    store.setActive(p.id, m.id);
    var e4 = store.trashBranch(p.id, gm.id, { text: '# Via\n', fragment: { text: '- lone', kind: 'bullet', indent: 0 }, origin: { parent: '', index: 0, lineage: ['Via'] } });
    store.deleteMap(p.id, gm.id);
    var rebuilt = store.restoreTrash(p.id, e4.id);
    T.eq(rebuilt.where, 'new map', 'the map of the branch is made again');
    T.eq(store.map(p.id, rebuilt.mapId).text, '# Via\n\n- lone\n', 'with its name and the branch inside');
    T.eq(store.here().mapId, rebuilt.mapId, 'and it opens');
    store.undo();
    store.restoreTrash(p.id, loose.id);
    T.eq(store.trashBranch(p.id, m.id, { text: 'x' }), null, 'a branch without a fragment is refused');
  });

  T.test('a picture taken out of a node', function () {
    store.setActive(p.id, m.id);
    store.setMapText(p.id, m.id, TEXT);
    store.setFile(p.id, 'assets/a.png', ref('A'));
    var figText = store.map(p.id, m.id).text;
    var parsedFig = doc.parse(figText);
    var node = pathOf(figText, 'one a');
    var fig;
    store.transaction('store.label.takePictureOut', function () {
      store.setMapText(p.id, m.id, doc.removeImage(parsedFig, node, 'line', doc.PHOTO).text);
      fig = store.trashFigure(p.id, m.id, { path: 'assets/a.png', owner: 'one a', ownerPath: node, field: 'line' });
    });
    T.eq(fig.kind, 'figure', 'the picture is in the trash');
    T.eq(fig.label, 'a.png', 'labelled by its file');
    T.ok(!store.fileRef(p.id, 'assets/a.png'), 'the file leaves assets/');
    T.eq(store.historyState().undoLabel, 'take the picture out', 'text and picture: one step');
    var figBack = store.restoreTrash(p.id, fig.id);
    T.eq(store.map(p.id, m.id).text, TEXT, 'restored, it goes back on its node');
    T.eq(figBack.where, 'same', 'and says so');
    T.eq(figBack.path, 'assets/a.png', 'under its path');
    store.undo();
    store.setMapText(p.id, m.id, store.map(p.id, m.id).text.replace('one a', 'other name'));
    var figAlone = store.restoreTrash(p.id, fig.id);
    T.eq(figAlone.where, 'files', 'when its node is gone only the file comes back');
    T.eq(store.fileRef(p.id, 'assets/a.png').asset, 'A', 'and the file is there');
  });

  T.test('a picture whose bytes were never kept comes back as nothing', function () {
    store.setMapText(p.id, m.id, '# Root\n\n- ![](assets/never.png) without bytes\n');
    var text = store.map(p.id, m.id).text;
    var parsed = doc.parse(text);
    var node = pathOf(text, 'without bytes');
    var fig;
    store.transaction('store.label.takePictureOut', function () {
      store.setMapText(p.id, m.id, doc.removeImage(parsed, node, 'line', doc.PHOTO).text);
      fig = store.trashFigure(p.id, m.id, { path: 'assets/never.png', owner: 'without bytes', ownerPath: node, field: 'line' });
    });
    T.eq(fig.file, null, 'the entry knows it has no bytes');
    var back = store.restoreTrash(p.id, fig.id);
    T.eq(back.where, 'gone', 'restoring says nothing could come back');
    T.eq(store.map(p.id, m.id).text, '# Root\n\n- without bytes\n', 'and does not write a broken picture into the node');
    T.eq(store.trash(p.id).filter(function (e) { return e.id === fig.id; }).length, 0, 'the useless entry leaves the trash');
    store.setMapText(p.id, m.id, TEXT);
  });

  T.test('files from the images panel', function () {
    var sent = store.trashFiles(p.id, ['assets/b.png', 'assets/nobody.png', 'assets/b.png'], { 'assets/b.png': 'two a' });
    T.eq(sent.length, 1, 'a file goes, one that is not there does not, nor twice');
    T.ok(!store.fileRef(p.id, 'assets/b.png'), 'and leaves assets/ even if a map names it');
    T.eq(sent[0].owner, 'two a', 'remembering the node');
    T.eq(store.historyState().undoLabel, 'send the file to the trash', 'labelled in the singular');
    store.restoreTrash(p.id, sent[0].id);
    T.eq(store.fileRef(p.id, 'assets/b.png').asset, 'B', 'and comes back');
    var two = store.trashFiles(p.id, ['assets/a.png', 'assets/b.png']);
    T.eq(two.length, 2, 'two at once');
    T.eq(store.historyState().undoLabel, 'send 2 files to the trash', 'labelled in the plural');
    store.undo();
    T.same(store.trashFiles(p.id, []), [], 'nothing: nothing');
  });

  T.test('a map', function () {
    store.takeSnapshot(p.id, m2.id, { kind: 'manual', label: 'note' });
    store.setFile(p.id, 'assets/only-second.png', ref('S2'));
    store.setMapText(p.id, m2.id, '# S\n\n- ![](assets/b.png) here too\n- ![](assets/only-second.png) mine\n');
    var index = store.project(p.id).maps.map(function (x) { return x.id; }).indexOf(m2.id);
    var em = store.deleteMap(p.id, m2.id);
    T.ok(!store.map(p.id, m2.id), 'the map leaves the project');
    T.eq(em.kind, 'map', 'into the trash');
    T.eq(em.label, 'Second', 'under its name');
    T.eq(store.historyState().undoLabel, 'delete the map', 'one step');
    T.eq(em.snapshots.length, 1, 'with its copies');
    T.eq(store.snapshotsOf(p.id, m2.id).length, 0, 'which leave the project');
    T.ok(!store.fileRef(p.id, 'assets/only-second.png'), 'a file only it named goes with it');
    T.ok(!!store.fileRef(p.id, 'assets/b.png'), 'one another map uses stays');
    store.restoreTrash(p.id, em.id);
    T.eq(store.project(p.id).maps.map(function (x) { return x.id; }).indexOf(m2.id), index, 'restored, it goes back to its place');
    T.eq(store.snapshotsOf(p.id, m2.id).length, 1, 'with its copies');
    T.eq(store.fileRef(p.id, 'assets/only-second.png').asset, 'S2', 'and its file');
    T.eq(store.deleteMap(p.id, 'nope'), null, 'a map that is not there');
  });

  T.test('a copy', function () {
    var copy = store.snapshotsOf(p.id, m2.id)[0];
    var ec = store.deleteSnapshot(p.id, copy.id);
    T.eq(ec.kind, 'snapshot', 'the copy goes into the trash');
    T.eq(ec.label, 'Second - copy', 'named after its map');
    T.eq(store.historyState().undoLabel, 'delete the copy', 'one step');
    T.eq(store.snapshotsOf(p.id, m2.id).length, 0, 'and leaves the list');
    store.restoreTrash(p.id, ec.id);
    T.eq(store.snapshotsOf(p.id, m2.id)[0].id, copy.id, 'and comes back');
    store.deleteSnapshot(p.id, copy.id);
    var ec2 = store.trash(p.id)[0];
    store.deleteMap(p.id, m2.id);
    var orphan = store.restoreTrash(p.id, ec2.id);
    T.eq(orphan.where, 'new map', 'a copy of a map that is gone comes back as a map');
    T.eq(store.map(p.id, orphan.mapId).text, copy.text, 'with the text of the copy');
    T.eq(store.snapshotsOf(p.id, orphan.mapId).length, 1, 'and the copy beside it');
    T.eq(store.deleteSnapshot(p.id, 'nope'), null, 'a copy that is not there');
  });

  T.test('for good', function () {
    var before = store.trash(p.id).length;
    T.ok(before > 0, 'the trash has entries');
    T.same(store.trash(p.id).map(function (e) { return e.deletedAt; }),
      store.trash(p.id).map(function (e) { return e.deletedAt; }).sort(function (a, b) { return b - a; }), 'newest on top');
    var first = store.trash(p.id)[0];
    T.eq(store.purgeTrash(p.id, first.id), true, 'delete one entry for good');
    T.eq(store.trash(p.id).length, before - 1, 'one fewer');
    T.eq(store.historyState().undoLabel, 'delete for good', 'labelled');
    store.undo();
    T.eq(store.trash(p.id).length, before, 'and undoable while the page is open');
    var ids = store.trash(p.id).slice(0, 2).map(function (e) { return e.id; });
    T.eq(store.purgeTrashMany(p.id, ids).length, 2, 'two at once');
    T.eq(store.historyState().undoLabel, 'delete 2 for good', 'one step');
    T.eq(store.purgeTrash(p.id, 'nope'), false, 'one that is not there');
    T.eq(store.emptyTrash(p.id), before - 2, 'empty the trash');
    T.eq(store.trash(p.id).length, 0, 'empty');
    T.eq(store.historyState().undoLabel, 'empty the trash', 'labelled');
    store.undo();
    T.eq(store.trash(p.id).length, before - 2, 'emptying is undoable too');
    T.eq(store.emptyTrash(store.createProject({ name: 'V' }).id), 0, 'emptying an empty trash does nothing');
  });

  T.test('a restored map or copy never takes an id that is already there', function () {
    store.init({});
    var q = store.createProject({ name: 'Q' });
    var qm = store.map(q.id);
    store.takeSnapshot(q.id, qm.id, { kind: 'manual', label: 'one' });
    var copy = store.snapshotsOf(q.id, qm.id)[0];
    var entry = store.deleteSnapshot(q.id, copy.id);
    store.undo();
    /* the copy is back by undo, and its entry is (by undo) not in the trash
     * any more; put the entry back by hand to restore it a second time. */
    var raw = JSON.parse(JSON.stringify(store.project(q.id)));
    raw.trash = [entry];
    store.init({ projects: [raw] });
    var res = store.restoreTrash(raw.id, entry.id);
    var ids = store.snapshotsOf(raw.id, qm.id).map(function (s) { return s.id; });
    T.eq(res.where, 'same', 'restored into its map');
    T.eq(ids.length, 2, 'two copies');
    T.ok(ids[0] !== ids[1], 'with two ids');
  });

  /* A map may spell one file several ways: './assets/x.png' (what many
   * Markdown editors write), 'assets/a%20b.png' (escaped). Asking "is this
   * file still used" must hear every spelling, or deleting one map breaks
   * the picture in another. */
  T.test('a file another map or node names in another spelling stays', function () {
    store.init({});
    var q = store.createProject({ name: 'Q' });
    var a = store.map(q.id);
    store.setMapText(q.id, a.id, '# A\n\n- ![](assets/x.png) a\n- ![](<assets/a b.png>) space\n');
    var b = store.createMap(q.id, { name: 'B', text: '# B\n\n- ![](./assets/x.png) b\n- ![](assets/a%20b.png) b2\n' });
    store.setFile(q.id, 'assets/x.png', ref('X'));
    store.setFile(q.id, 'assets/a b.png', ref('AB'));
    T.eq(store.fileRef(q.id, './assets/x.png').asset, 'X', "fileRef reads './'");
    T.eq(store.fileRef(q.id, 'assets/a%20b.png').asset, 'AB', 'fileRef reads %20');
    T.ok(store.usedByMaps(q.id)['assets/a b.png'], 'usedByMaps hears %20');

    var entry = store.deleteMap(q.id, a.id);
    T.eq(store.fileRef(q.id, 'assets/x.png').asset, 'X', "deleteMap keeps a file another map names as './'");
    T.eq(store.fileRef(q.id, 'assets/a b.png').asset, 'AB', 'deleteMap keeps a file another map names escaped');
    T.ok(!!entry.files['assets/x.png'] && !!entry.files['assets/a b.png'], 'and records both in the entry');
    store.undo();

    /* trashBranch: the branch names it plainly, another node with './'. */
    var text = store.map(q.id, b.id).text;
    store.setMapText(q.id, b.id, '# B\n\n- ![](./assets/x.png) b\n- lone ![](assets/x.png)\n');
    var parsed = doc.parse(store.map(q.id, b.id).text);
    var path = pathOf(store.map(q.id, b.id).text, 'lone');
    var x = doc.extractBranch(parsed, path);
    store.trashBranch(q.id, b.id, { text: doc.remove(parsed, path).text, fragment: x.fragment, origin: x.origin });
    T.eq(store.fileRef(q.id, 'assets/x.png').asset, 'X', "trashBranch keeps a file another node names as './'");
    store.setMapText(q.id, b.id, text);

    /* trashFigure: the picture leaves one node, another node of another
     * map still shows it through an escaped name. */
    store.deleteMap(q.id, a.id);
    store.setMapText(q.id, b.id, '# B\n\n- b\n- ![](assets/a%20b.png) b2\n');
    var fig = store.trashFigure(q.id, b.id, { path: './assets/a b.png', owner: 'b', field: 'line' });
    T.eq(fig.path, 'assets/a b.png', 'the entry keeps the path as the project has it');
    T.eq(fig.file && fig.file.asset, 'AB', 'with its bytes');
    T.eq(store.fileRef(q.id, 'assets/a b.png').asset, 'AB', 'trashFigure keeps a file another node names escaped');
    store.setMapText(q.id, b.id, '# B\n\n- b\n');
    var fig2 = store.trashFigure(q.id, b.id, { path: 'assets/a%20b.png', owner: 'b', field: 'line' });
    T.eq(fig2.path, 'assets/a b.png', 'an escaped spelling finds the file too');
    T.ok(!store.fileRef(q.id, 'assets/a b.png'), 'and with nothing else naming it, it goes');
  });

  T.test("a file coming back under a new name is renamed in every spelling", function () {
    store.init({});
    var q = store.createProject({ name: 'Q' });
    var a = store.map(q.id);
    store.setMapText(q.id, a.id, '# A\n\n- branch ![](./assets/x.png)\n- other\n');
    store.setFile(q.id, 'assets/x.png', ref('X'));
    var parsed = doc.parse(store.map(q.id, a.id).text);
    var path = pathOf(store.map(q.id, a.id).text, 'branch');
    var x = doc.extractBranch(parsed, path);
    var e = store.trashBranch(q.id, a.id, { text: doc.remove(parsed, path).text, fragment: x.fragment, origin: x.origin });
    T.eq(e.files['assets/x.png'].asset, 'X', "the './' picture goes with the branch");
    store.setFile(q.id, 'assets/x.png', ref('OTHER'));
    store.restoreTrash(q.id, e.id);
    T.eq(store.fileRef(q.id, 'assets/x-2.png').asset, 'X', 'it comes back under a free name');
    T.ok(store.map(q.id, a.id).text.indexOf('](assets/x-2.png)') > 0, "and the './' reference is pointed at it");
  });

  T.test('a note goes in, with its map text, as one step; it comes back where it was', function () {
    store.init({});
    var q = store.createProject({ name: 'Q' });
    var a = store.map(q.id);
    var NOTED = '# R\n\n- one\n  - > note: first line\n    > second\n- two\n  - > edge: because\n';
    store.setMapText(q.id, a.id, NOTED);
    store.setActive(q.id, a.id);
    var before = store.historyState().undoCount;
    var parsed = doc.parse(NOTED);
    var onePath = pathOf(NOTED, 'one');
    var e;
    store.transaction('notes.label.delete', function () {
      store.setMapText(q.id, a.id, doc.setNote(parsed, onePath, 'node', '').text);
      e = store.trashNote(q.id, a.id, { text: 'first line\nsecond', kind: 'node', owner: 'one', ownerPath: onePath });
    });
    T.eq(store.historyState().undoCount, before + 1, 'one step');
    T.same([e.kind, e.label, e.noteKind, e.owner, e.mapName], ['note', 'first line second', 'node', 'one', 'Q'], 'the entry: its words, the node, the map');
    T.eq(store.map(q.id, a.id).text, '# R\n\n- one\n- two\n  - > edge: because\n', 'the map loses the note');
    store.undo();
    T.eq(store.map(q.id, a.id).text, NOTED, 'undo: the note back');
    T.eq(store.trash(q.id).length, 0, 'and out of the trash');
    store.redo();
    var res = store.restoreTrash(q.id, e.id);
    T.eq(res.where, 'same', 'restored where it was');
    T.eq(store.map(q.id, a.id).text, NOTED, 'the same lines');
    T.eq(store.trash(q.id).length, 0, 'and out of the trash');

    var twoPath = pathOf(store.map(q.id, a.id).text, 'two');
    var edge = store.trashNote(q.id, a.id, { text: 'because', kind: 'edge', owner: 'two', ownerPath: twoPath });
    store.setMapText(q.id, a.id, '# R\n\n- one\n');
    res = store.restoreTrash(q.id, edge.id);
    T.eq(res.where, 'top', 'its node gone: on the root, and it says so');
    T.eq(store.map(q.id, a.id).text, '# R\n- > note: because\n\n- one\n', 'as the root\'s note (the root has no link)');
    T.eq(store.trashNote(q.id, a.id, { text: '  ', kind: 'node' }), null, 'an empty note is not an entry');
  });

  T.test('paths the store keeps are paths a backup can write', function () {
    store.init({});
    var q = store.createProject({ name: 'Q' });
    T.eq(store.setFile(q.id, 'assets/', ref('D')), false, 'a folder is not a file');
    T.eq(store.setFile(q.id, '../outside.png', ref('D')), false, 'nothing climbs out');
    T.eq(store.setFile(q.id, 'c:/x.png', ref('D')), false, 'no drive');
    T.eq(store.setFile(q.id, '.', ref('D')), false, 'no bare dot');
    T.ok(store.setFile(q.id, 'assets/a/.', ref('D')), "a trailing '.' is the folder's own name");
    T.ok(store.setFile(q.id, './x//./y.png', ref('E')), 'dots and doubled slashes are tidied');
    T.same(Object.keys(store.project(q.id).files).sort(), ['assets/a', 'x/y.png'], 'kept as clean paths');
    var raw = { name: 'R', maps: [{ name: 'm', text: '# m\n' }], files: { 'assets/': ref('D'), 'a/./b.png': ref('F'), 'z/../../e.png': ref('G') } };
    var made = store.importProjects([raw])[0];
    T.same(Object.keys(made.files), ['a/b.png'], 'an import is tidied the same way');
  });
})();
