/* MindRoot - the workspace (ported from an earlier workspace suite): projects of
 * several maps, their files, templates, duplicates, the sidebar counts,
 * branches carried from one map to another, imports, copies. The model
 * alone: no page, no IndexedDB. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  var doc = ns.doc;
  var D = window.DataT;
  ns.i18n.init('en');

  function names(list) { return list.map(function (x) { return x.name; }); }
  var ref = D.ref;
  var pathOf = D.pathOf;

  var p, kyc, copy;

  T.test('an empty workspace', function () {
    store.init({});
    T.eq(store.projects().length, 0, 'no projects');
    T.same(store.here(), { projectId: null, mapId: null }, 'nothing open');
    T.eq(store.canUndo(), false, 'nothing to undo');
    T.same(store.counts(), { maps: 0, nodes: 0, images: 0, trash: 0 }, 'empty counts');
  });

  T.test('a project', function () {
    p = store.createProject({ name: '  Risk   and controls ', description: 'anti-money laundering' });
    T.eq(p.name, 'Risk and controls', 'the name is cleaned');
    T.eq(p.description, 'anti-money laundering', 'the description stays');
    T.eq(p.maps.length, 1, 'a new project has one map');
    T.eq(p.maps[0].name, 'Risk and controls', 'named after the project');
    T.eq(p.maps[0].text, '# Risk and controls\n', 'with only a title');
    T.same(store.here(), { projectId: p.id, mapId: p.maps[0].id }, 'and it is open');
    T.eq(store.createProject({ name: '   ' }).name, 'Untitled project', 'no name gets one');
    ns.i18n.init('it');
    T.eq(store.createProject({ name: '' }).name, 'Progetto senza titolo', 'in the language of the person');
    ns.i18n.init('en');
    store.deleteProject(store.projects()[2].id);
    store.deleteProject(store.projects()[1].id);
    T.eq(store.createProject({ name: 'x'.repeat(200) }).name.length, 120, 'names stop at 120 characters');
    store.deleteProject(store.projects()[1].id);
  });

  T.test('maps', function () {
    kyc = store.createMap(p.id, { name: 'KYC', text: '# KYC\n\n- POI\n- POA\n' });
    T.eq(kyc.text, '# KYC\n\n- POI\n- POA\n', 'the new map has its text');
    T.eq(store.here().mapId, kyc.id, 'and becomes the open one');
    T.same(names(store.project(p.id).maps), ['Risk and controls', 'KYC'], 'after the others');
    T.eq(store.createMap(p.id, { name: 'CRLF', text: '# A\r\n- b\r\n' }).text, '# A\n- b\n', 'line ends become LF');
    store.undo();

    T.eq(store.renameMap(p.id, kyc.id, ' Know your customer '), true, 'rename a map');
    T.eq(store.map(p.id, kyc.id).name, 'Know your customer', 'with the name cleaned');
    T.eq(store.renameMap(p.id, kyc.id, '  '), false, 'an empty name is refused');
    T.eq(store.renameMap(p.id, kyc.id, 'Know your customer'), false, 'the same name changes nothing');

    copy = store.duplicateMap(p.id, kyc.id);
    T.same(names(store.project(p.id).maps), ['Risk and controls', 'Know your customer', 'Know your customer (copy)'], 'the duplicate sits right after');
    T.eq(copy.text, store.map(p.id, kyc.id).text, 'with the same text');
    T.ok(copy.id !== kyc.id, 'and an id of its own');
    T.eq(store.historyState().undoLabel, 'duplicate the map', 'one step');

    T.eq(store.moveMap(p.id, copy.id, 0), true, 'move a map to the top');
    T.eq(store.project(p.id).maps[0].id, copy.id, 'it is first');
    T.eq(store.historyState().undoLabel, 'move the map', 'a step of its own');
    T.eq(store.moveMap(p.id, copy.id, 0), false, 'moving it where it is changes nothing');
    T.eq(store.moveMap(p.id, copy.id, 99), true, 'past the end goes to the end');
    T.eq(store.project(p.id).maps[2].id, copy.id, 'last');
    store.undo();

    store.setMapText(p.id, kyc.id, '# KYC\n\n- POI\n- POA\n- SOF\n');
    T.eq(store.map(p.id, kyc.id).text, '# KYC\n\n- POI\n- POA\n- SOF\n', 'the text of a map changes');
    var before = store.project(p.id);
    T.eq(store.setMapText(p.id, kyc.id, '# KYC\n\n- POI\n- POA\n- SOF\n'), false, 'the same text changes nothing');
    T.eq(store.project(p.id), before, 'the project is the same object');
    store.setMapText(p.id, kyc.id, '# KYC\n\n- POI\n- POA\n- SOF\n- SOW\n');
    T.ok(store.project(p.id) !== before, 'a changed map makes a new project');
    T.eq(store.project(p.id).maps[0], before.maps[0], 'and the other maps stay the same object');
    T.ok(store.project(p.id).updatedAt >= before.updatedAt, 'stamped');
    store.setMapText(p.id, kyc.id, '# KYC\n\n- POI\n- POA\n- SOF\n');
  });

  T.test('the project itself', function () {
    store.updateProject(p.id, { name: 'Risk', description: 'three maps' });
    T.eq(store.project(p.id).name, 'Risk', 'name changed');
    T.eq(store.project(p.id).description, 'three maps', 'description changed');
    T.eq(store.updateProject(p.id, { name: ' ' }), false, 'an empty name does not pass');
    T.eq(store.updateProject(p.id, { name: 'Risk' }), false, 'nothing changed, no step');
    T.eq(store.historyState().undoLabel, 'edit the project', 'one step');
  });

  T.test('files', function () {
    T.eq(store.setFile(p.id, './assets/photo.png', ref('a1')), true, 'a file comes into the project');
    T.eq(store.fileRef(p.id, 'assets/photo.png').asset, 'a1', 'with its path cleaned');
    T.eq(store.setFile(p.id, '../outside.png', ref('a2')), false, 'a path climbing out is refused');
    T.eq(store.setFile(p.id, 'assets/../../x.png', ref('a2')), false, 'even inside the path');
    T.eq(store.setFile(p.id, 'C:/Windows/x.png', ref('a2')), false, 'a drive is refused');
    T.eq(store.setFile(p.id, 'https://example.com/x.png', ref('a2')), false, 'a URL is refused');
    T.eq(store.setFile(p.id, 'assets/photo.png', null), false, 'no ref, no file');
    T.eq(store.cleanPath('\\assets\\\\a.png'), 'assets/a.png', 'backslashes and doubled slashes');
    T.eq(store.freePath(p.id, 'assets/other.png'), 'assets/other.png', 'a free name stays');
    T.eq(store.freePath(p.id, 'assets/photo.png'), 'assets/photo-2.png', 'a taken name gets a number');
    store.setFile(p.id, 'assets/kyc.excalidraw.svg', ref('d1', 'image/svg+xml'));
    T.eq(store.freePath(p.id, 'assets/kyc.excalidraw.svg'), 'assets/kyc-2.excalidraw.svg', 'a drawing gets it before the double suffix');
    store.setFile(p.id, 'assets/kyc.ink.svg', ref('d2', 'image/svg+xml'));
    T.eq(store.freePath(p.id, 'assets/kyc.ink.svg'), 'assets/kyc-2.ink.svg', 'an ink drawing too');
    store.setFile(p.id, 'assets/kyc-2.ink.svg', ref('d3', 'image/svg+xml'));
    T.eq(store.freePath(p.id, 'assets/kyc.ink.svg'), 'assets/kyc-3.ink.svg', 'and counts on');
    T.eq(store.freePath(p.id, 'README'), 'README', 'no extension, free');
    store.setFile(p.id, 'README', ref('l1', 'text/plain'));
    T.eq(store.freePath(p.id, 'README'), 'README-2', 'no extension: the number at the end');
    store.setFile(p.id, 'templates/flow.mmd', ref('t1', 'text/plain'));
    var steps = store.historyState().undoCount;
    T.eq(store.setFile(p.id, 'templates/flow.mmd', ref('t1', 'text/plain')), false, 'the same reference again is no change');
    T.eq(store.historyState().undoCount, steps, 'and no step');

    store.setMapText(p.id, kyc.id, '# KYC\n\n- ![](assets/photo.png) POI\n- POA\n- SOF\n');
    var used = store.usedByMaps(p.id);
    T.ok(used['assets/photo.png'], 'a map that names a file uses it');
    T.ok(!used['assets/kyc.excalidraw.svg'], 'a file nobody names is not used');
  });

  T.test('the sidebar counts', function () {
    var counts = store.counts(store.project(p.id));
    T.eq(counts.maps, 3, 'maps counted');
    T.eq(counts.images, 4, 'files under assets/ counted');
    T.eq(counts.nodes, 1 + 4 + 3, 'nodes counted over every map');
    T.eq(counts.trash, 0, 'empty trash');
    T.eq(doc.countNodes('# A\n- b\n  - > note: hello\n  - > text: below\n'), 2, 'a note is not a node');
    var m = store.project(p.id).maps[0];
    T.eq(store.nodesIn(m), store.nodesIn(m), 'cached per map object');
  });

  T.test('templates', function () {
    T.eq(store.setTemplate(p.id, true), true, 'use as a template');
    T.eq(store.historyState().undoLabel, 'use as a template', 'labelled');
    T.eq(store.setTemplate(p.id, true), false, 'already one: no change');
    T.same(names(store.templates()), ['Risk'], 'the templates listed');
    store.takeSnapshot(p.id, kyc.id, { kind: 'manual', label: 'first' });

    var fromTemplate = store.createProject({ name: 'Client X', fromTemplateId: p.id });
    T.eq(fromTemplate.maps.length, 3, 'the maps come from the template');
    T.same(names(fromTemplate.maps), names(store.project(p.id).maps), 'with their names');
    T.ok(fromTemplate.maps[0].id !== store.project(p.id).maps[0].id, 'but new ids');
    T.eq(fromTemplate.maps[2].text, store.project(p.id).maps[2].text, 'and their text');
    T.ok(!!fromTemplate.files['assets/photo.png'], 'the files the maps name come too');
    T.ok(!!fromTemplate.files['templates/flow.mmd'], 'and the templates/ folder');
    T.ok(!fromTemplate.files['assets/kyc.excalidraw.svg'], 'not a file no map names');
    T.eq(fromTemplate.snapshots.length, 0, 'the copies stay with the template');
    T.eq(fromTemplate.isTemplate, false, 'the new project is not a template');

    var skeleton = store.createProject({ name: 'Skeleton', fromTemplateId: p.id, withContent: false });
    T.same(skeleton.maps.map(function (m) { return m.text; }),
      store.project(p.id).maps.map(function (m) { return doc.emptyDocument(m.name); }), 'without content: titles only');
    T.ok(!skeleton.files['assets/photo.png'], 'and no pictures');
    T.ok(!!skeleton.files['templates/flow.mmd'], 'but the templates/ folder');
  });

  T.test('duplicating a project', function () {
    var twin = store.duplicateProject(p.id);
    T.eq(twin.name, 'Risk (copy)', 'named after the original');
    T.eq(store.projects()[store.projects().indexOf(store.project(p.id)) + 1].id, twin.id, 'right after it');
    T.eq(twin.isTemplate, false, 'not a template');
    T.eq(twin.snapshots.length, 0, 'no copies');
    T.eq(twin.maps.length, 3, 'the maps');
    T.eq(twin.files['assets/photo.png'].asset, 'a1', 'sharing the same bytes');
    T.eq(store.here().projectId, twin.id, 'and it is open');
    var count = store.projects().length;
    store.deleteProject(twin.id);
    T.eq(store.projects().length, count - 1, 'a project deleted');
    T.ok(store.here().projectId && store.here().projectId !== twin.id, 'another one opens');
  });

  T.test('moving projects', function () {
    var ids = store.projects().map(function (x) { return x.id; });
    T.eq(store.moveProject(ids[0], 2), true, 'move the first one to the third place');
    T.same(store.projects().map(function (x) { return x.id; }), [ids[1], ids[2], ids[0]].concat(ids.slice(3)), 'in its new place');
    T.eq(store.historyState().undoLabel, 'move the project', 'a step');
    T.eq(store.moveProject(ids[0], 2), false, 'where it is: nothing');
    T.eq(store.moveProject('nope', 0), false, 'a project that is not there: nothing');
    store.undo();
    T.same(store.projects().map(function (x) { return x.id; }), ids, 'undo puts it back');
  });

  T.test('branches from one map into another', function () {
    var source = store.createMap(p.id, {
      name: 'Source',
      text: '# Source\n\n## One\n\n- a\n  - a1\n- b\n\n## Two\n\n- ![](assets/photo.png) c\n'
    });
    var target = store.createMap(p.id, { name: 'Destination', text: '# Dest\n\n- x\n' });
    var src = source.text;
    var res = store.importBranches({
      from: { projectId: p.id, mapId: source.id },
      to: { projectId: p.id, mapId: target.id },
      paths: [pathOf(src, 'a1'), pathOf(src, 'a'), pathOf(src, 'Two'), pathOf(src, 'a')],
      parent: pathOf(target.text, 'Dest')
    });
    T.eq(res.count, 2, 'a node chosen with its ancestor comes once');
    /* doc.js keeps a heading put at the end of a root with a list a heading
     * (an earlier version made it a list item; see doc-trash). */
    T.eq(store.map(p.id, target.id).text, '# Dest\n\n- x\n- a\n  - a1\n\n## Two\n\n- ![](assets/photo.png) c\n',
      'under the chosen node, in source order, each in the shape doc.insertBranch gives it');
    T.eq(store.map(p.id, source.id).text, src, 'the source does not change');
    T.eq(store.historyState().undoLabel, 'import 2 branches', 'one step');
    T.eq(res.mapId, target.id, 'says where');
    T.same(store.importBranches({ from: { projectId: p.id, mapId: source.id }, to: { projectId: p.id, mapId: target.id }, paths: ['9.9'] }),
      { count: 0 }, 'nothing valid chosen: nothing');

    var other = store.createProject({ name: 'Other' });
    store.setFile(other.id, 'assets/photo.png', ref('zzz'));
    var into = store.map(other.id);
    var res2 = store.importBranches({
      from: { projectId: p.id, mapId: source.id },
      to: { projectId: other.id, mapId: into.id },
      paths: [pathOf(src, 'c')],
      parent: null
    });
    T.eq(res2.count, 1, 'into another project the branch goes under the root');
    T.eq(store.historyState().undoLabel, 'import a branch', 'singular label');
    T.eq(store.map(other.id, into.id).text, '# Other\n\n- ![](assets/photo-2.png) c\n', 'a name taken by other bytes is renamed, and the text follows');
    T.eq(store.fileRef(other.id, 'assets/photo-2.png').asset, 'a1', 'the file comes with its bytes');
    T.eq(store.fileRef(other.id, 'assets/photo.png').asset, 'zzz', 'the one there stays');

    /* A left branch copied below the first level keeps no side marker; one
     * copied as a branch of the root keeps it. */
    var sided = store.createMap(p.id, { name: 'Sided', text: '# S\n\n- L <!-- side: left -->\n  - L1\n- R\n' });
    var deep = store.createMap(p.id, { name: 'Deep', text: '# D\n\n- d\n' });
    store.importBranches({
      from: { projectId: p.id, mapId: sided.id }, to: { projectId: p.id, mapId: deep.id },
      paths: [pathOf(sided.text, 'L')], parent: pathOf(deep.text, 'd')
    });
    T.eq(store.map(p.id, deep.id).text, '# D\n\n- d\n  - L\n    - L1\n', 'copied under a deeper node: no left marker');
    T.eq(store.historyState().undoLabel, 'import a branch', 'still one step');
    store.importBranches({
      from: { projectId: p.id, mapId: sided.id }, to: { projectId: p.id, mapId: deep.id },
      paths: [pathOf(sided.text, 'L')], parent: ''
    });
    T.eq(store.map(p.id, deep.id).text, '# D\n\n- d\n  - L\n    - L1\n- L <!-- side: left -->\n  - L1\n', 'copied as a branch of the root: on the left');
    var tops = store.createMap(p.id, { name: 'Tops', text: '- T\n  - t <!-- side: left -->\n' });
    store.importBranches({
      from: { projectId: p.id, mapId: tops.id }, to: { projectId: p.id, mapId: deep.id },
      paths: [pathOf(tops.text, 'T')], parent: pathOf(store.map(p.id, deep.id).text, 'd')
    });
    T.eq(store.map(p.id, deep.id).text, '# D\n\n- d\n  - L\n    - L1\n  - T\n    - t\n- L <!-- side: left -->\n  - L1\n',
      'a top node copied deeper: its branches lose their markers');
  });

  T.test('importing projects', function () {
    var raw = {
      name: 'From outside', maps: [{ id: 'm1', name: 'One', text: '# One\n' }, { id: 'm1', name: 'Double', text: '# Double\n' }],
      snapshots: [{ id: 's1', mapId: 'm1', when: 1000, kind: 'manual', label: 'n', text: '# One\n' }],
      trash: [{ id: 't1', kind: 'branch', deletedAt: 5, label: 'b', mapId: 'm1', mapName: 'One',
        fragment: { text: '- b', kind: 'bullet', indent: 0 }, origin: { parent: '', index: 0, lineage: ['One'] } },
      { id: 't2', kind: 'nonsense' }, { id: 't3', kind: 'figure', path: '../x.png' }],
      files: { 'assets/x.png': ref('q'), '../via.png': ref('r'), 'assets/y.png': { type: 'image/png' } }
    };
    var added = store.importProjects([raw])[0];
    T.eq(added.name, 'From outside', 'the imported project comes in');
    T.ok(added.maps[0].id !== 'm1', 'with new ids');
    T.ok(added.maps[0].id !== added.maps[1].id, 'two maps with one id get two');
    T.eq(added.snapshots[0].mapId, added.maps[0].id, 'the copy follows its map');
    T.eq(added.trash[0].mapId, added.maps[0].id, 'the trashed branch follows its map');
    T.eq(added.trash.length, 1, 'trash entries that cannot be put back are left out');
    T.same(Object.keys(added.files), ['assets/x.png'], 'files outside the folder, or without bytes, are left out');
    T.eq(store.here().projectId, added.id, 'and it is open');
    T.eq(store.historyState().undoLabel, 'import', 'one step');
    T.same(store.importProjects([]), [], 'nothing to import: nothing');
  });

  T.test('exporting', function () {
    var out = store.exportProject(p.id);
    T.eq(out.mindroot, 'project', 'the export says what it holds');
    T.eq(out.version, 1, 'and the version');
    T.eq(typeof out.exportedAt, 'number', 'and when');
    T.eq(out.maps.length, store.project(p.id).maps.length, 'with the maps');
    T.ok(out.maps !== store.project(p.id).maps, 'a copy, not the value');
    T.eq(store.exportProject('nope'), null, 'no such project: null');
  });

  T.test('opening is not a step', function () {
    var steps = store.historyState().undoCount;
    T.eq(store.setActive(p.id, kyc.id), true, 'opening a map');
    T.eq(store.historyState().undoCount, steps, 'is not a step');
    T.same(store.here(), { projectId: p.id, mapId: kyc.id }, 'but opens it');
    T.eq(store.setActive(p.id, kyc.id), false, 'opening it again changes nothing');
    T.eq(store.setActive('nope'), false, 'a project that is not there');
    T.same(store.ui().activeMaps[p.id], kyc.id, 'ui() says which map of each project');
  });

  T.test('copies', function () {
    var cp = store.createProject({ name: 'Copies' });
    var cm = store.map(cp.id);
    var other2 = store.createMap(cp.id, { name: 'Other' });
    var t0 = new Date(2026, 8, 10, 8, 0).getTime();
    for (var k = 0; k < 30; k++) {
      store.setMapText(cp.id, cm.id, '# Copies\n\n- version ' + k + '\n');
      store.takeSnapshot(cp.id, cm.id, { kind: 'auto', when: t0 + k * 3600000 });
    }
    store.takeSnapshot(cp.id, cm.id, { kind: 'manual', label: 'to keep', when: t0 - 86400000 });
    store.takeSnapshot(cp.id, other2.id, { kind: 'auto', when: t0 });
    var mine = store.snapshotsOf(cp.id, cm.id);
    T.eq(mine.length, 25, 'the clock keeps 24, plus the one by hand');
    T.eq(mine[0].text, '# Copies\n\n- version 29\n', 'the newest first');
    T.eq(mine[23].text, '# Copies\n\n- version 6\n', 'the oldest clock copies go');
    T.eq(mine[24].label, 'to keep', 'the one by hand stays, even if the oldest');
    T.eq(mine[24].kind, 'manual', 'and stays by hand');
    T.eq(store.snapshotsOf(cp.id, other2.id).length, 1, 'another map has its own');

    var minute = new Date(2026, 8, 12, 10, 30, 5).getTime();
    store.setMapText(cp.id, other2.id, '# Other\n\n- first\n');
    store.takeSnapshot(cp.id, other2.id, { kind: 'auto', when: minute });
    store.setMapText(cp.id, other2.id, '# Other\n\n- second\n');
    store.takeSnapshot(cp.id, other2.id, { kind: 'manual', label: 'note', when: minute + 20000 });
    var sameMinute = store.snapshotsOf(cp.id, other2.id).filter(function (s) { return Math.floor(s.when / 60000) === Math.floor(minute / 60000); });
    T.eq(sameMinute.length, 2, 'a copy by hand does not replace the clock one');
    T.eq(sameMinute[0].kind, 'manual', 'the newest is the one by hand');
    T.eq(sameMinute[0].text, '# Other\n\n- second\n', 'with its text');
    store.setMapText(cp.id, other2.id, '# Other\n\n- third\n');
    T.eq(store.takeSnapshot(cp.id, other2.id, { kind: 'auto', when: minute + 40000 }), null, 'the clock does not write over a copy by hand in the same minute');
    T.eq(store.snapshotsOf(cp.id, other2.id).filter(function (s) { return s.kind === 'manual'; })[0].text, '# Other\n\n- second\n', 'which stays as it was');
    T.eq(store.snapshot(cp.id, sameMinute[0].id).label, 'note', 'a copy is found by id');
    T.eq(store.snapshot(cp.id, 'nope'), null, 'and not one that is not there');
    store.takeSnapshot(cp.id, other2.id, { kind: 'manual', label: 'again', when: minute + 50000 });
    T.eq(store.snapshotsOf(cp.id, other2.id).filter(function (s) { return s.kind === 'manual'; }).length, 2, 'two by hand in one minute stay two');
    var clock = new Date(2026, 8, 13, 10, 30, 5).getTime();
    store.setMapText(cp.id, other2.id, '# Other\n\n- clock one\n');
    store.takeSnapshot(cp.id, other2.id, { kind: 'auto', when: clock });
    store.setMapText(cp.id, other2.id, '# Other\n\n- clock two\n');
    store.takeSnapshot(cp.id, other2.id, { kind: 'auto', when: clock + 20000 });
    var clockMinute = store.snapshotsOf(cp.id, other2.id).filter(function (s) { return Math.floor(s.when / 60000) === Math.floor(clock / 60000); });
    T.eq(clockMinute.length, 1, 'two clock copies in one minute are one');
    T.eq(clockMinute[0].text, '# Other\n\n- clock two\n', 'with the text of the second');
    T.eq(store.takeSnapshot(cp.id, 'nope', { kind: 'manual' }), null, 'no map, no copy');
    var long = store.takeSnapshot(cp.id, other2.id, { kind: 'manual', label: 'x'.repeat(400), when: clock + 3600000 });
    T.eq(long.label.length, 300, 'a note stops at 300 characters');
  });

  T.test('the last project', function () {
    store.init({ projects: [{ name: 'Solo', maps: [{ name: 'M', text: '# M\n' }] }] });
    store.deleteProject(store.projects()[0].id);
    T.eq(store.projects().length, 0, 'the last one can go too');
    T.same(store.here(), { projectId: null, mapId: null }, 'and then nothing is open');
    T.eq(store.deleteProject('nope'), false, 'a project that is not there');
  });

  T.test('init normalizes what it is given', function () {
    var data = {
      projects: [
        { id: 'p1', name: 'One', maps: [{ id: 'm1', name: 'A', text: '# A\r\n' }], snapshots: [{ id: 's', mapId: 'm1', text: 'x' }, { id: 's', mapId: 'm1', text: 'y' }] },
        { id: 'p1', name: 'Double', maps: [] },
        null
      ],
      ui: { activeProjectId: 'p1', activeMaps: { p1: 'm1' } }
    };
    store.init(data);
    T.eq(store.projects().length, 3, 'every project, even an empty record');
    T.ok(store.projects()[0].id !== store.projects()[1].id, 'two projects with one id get two');
    T.ok(store.projects()[0].snapshots[0].id !== store.projects()[0].snapshots[1].id, 'two copies with one id get two');
    T.eq(store.projects()[0].maps[0].text, '# A\n', 'line ends normalized');
    T.same(store.here(), { projectId: 'p1', mapId: 'm1' }, 'the open map from the saved ui');
    T.eq(store.project().id, 'p1', 'project() without an id is the open one');
    T.eq(store.map().id, 'm1', 'map() without ids is the open one');
    T.eq(store.map('p1').id, 'm1', 'map(pid) is the open map of that project');
    T.eq(store.projects()[2].name, 'Untitled project', 'a project with nothing gets a name');
  });
})();
