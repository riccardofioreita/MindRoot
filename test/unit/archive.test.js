/* MindRoot - out and back in (ported from an earlier archive suite, plus what is
 * new): a project leaves as a ZIP holding its `.interneuron` folder and as a
 * JSON; it comes back from a ZIP (compressed too), a JSON, a folder picked
 * or dropped, a loose .md, a PNG that carries its map; and nothing is lost
 * on the way - maps, files, copies (to the second), trash. Everything that
 * arrives at once is one undo step and one message. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  var storage = ns.storage;
  var archive = ns.archive;
  var zip = ns.zip;
  var doc = ns.doc;
  var D = window.DataT;
  var DB = 'mindroot2-test-archive';
  ns.i18n.init('en');

  async function put(pid, path, data, type) {
    var ref = await storage.putBlob(new Blob([data], { type: type || storage.typeOf(path) }), path);
    store.setFile(pid, path, ref);
    return ref;
  }

  async function rejects(promise) {
    try { await promise; } catch (err) { return err; }
    return null;
  }

  async function entriesOfZip(blob) {
    return (await zip.read(blob)).map(function (e) { return { path: e.name, data: e.data }; });
  }

  var KYC_TEXT = '<!-- board: assets/kyc-board.excalidraw.svg | 1,2,300,200 -->\n\n# KYC\n\n- ![](assets/photo.png) POI\n- POA\n  - ![](assets/lone-branch.png) detail\n- ![](assets/figure.png) SOF\n';
  var p, kyc, files, back;
  var T1 = new Date(2026, 8, 10, 14, 30, 17).getTime();
  var T2 = new Date(2026, 8, 11, 9, 5, 42).getTime();

  T.test('a full project', async function () {
    storage.useDatabase('mindroot2-test-elsewhere');
    await D.deleteDB(DB);
    storage.useDatabase(DB);
    store.init({});
    p = store.createProject({ name: 'Risk & Controls', description: 'everything there is' });
    kyc = store.map(p.id);
    store.renameMap(p.id, kyc.id, 'KYC');
    store.setMapText(p.id, kyc.id, KYC_TEXT);
    var citta = store.createMap(p.id, { name: 'Città', text: '# Città\n\n- Milan\n' });
    store.createMap(p.id, { name: 'KYC', text: '# KYC bis\n' });
    store.createMap(p.id, { name: '東京', text: '# 東京\n' });
    var via = store.createMap(p.id, { name: 'To throw away', text: '# To throw away\n\n- ![](assets/own.png) own\n' });
    await put(p.id, 'assets/photo.png', new Uint8Array([1, 2, 3]));
    await put(p.id, 'assets/lone-branch.png', new Uint8Array([4]));
    await put(p.id, 'assets/figure.png', new Uint8Array([5]));
    await put(p.id, 'assets/panel.png', new Uint8Array([6]));
    await put(p.id, 'assets/own.png', new Uint8Array([7]));
    await put(p.id, 'assets/kyc-board.excalidraw.svg', '<svg>board</svg>');
    await put(p.id, 'assets/new.ink.svg', '<svg>ink</svg>');
    await put(p.id, 'templates/flow.mmd', 'graph TD\n');
    await put(p.id, 'README.txt', 'my notes');
    store.setTemplate(p.id, true);

    store.takeSnapshot(p.id, kyc.id, { kind: 'auto', when: T1 });
    store.takeSnapshot(p.id, citta.id, { kind: 'manual', label: 'before Rome', when: T2 });
    store.takeSnapshot(p.id, via.id, { kind: 'manual', label: 'of the map thrown away', when: T2 });
    var bin = store.createMap(p.id, { name: 'Binned', text: '# Binned\n' });
    store.takeSnapshot(p.id, bin.id, { kind: 'auto', when: T1 });
    store.deleteSnapshot(p.id, store.snapshotsOf(p.id, bin.id)[0].id);

    var parsed = doc.parse(KYC_TEXT);
    var branchPath = D.pathOf(KYC_TEXT, 'POA');
    var cut = doc.extractBranch(parsed, branchPath);
    store.trashBranch(p.id, kyc.id, { text: doc.remove(parsed, branchPath).text, fragment: cut.fragment, origin: cut.origin });
    var afterBranch = doc.parse(store.map(p.id, kyc.id).text);
    var sofPath = D.pathOf(store.map(p.id, kyc.id).text, 'SOF');
    store.transaction('store.label.takePictureOut', function () {
      store.setMapText(p.id, kyc.id, doc.removeImage(afterBranch, sofPath, 'line', doc.PHOTO).text);
      store.trashFigure(p.id, kyc.id, { path: 'assets/figure.png', owner: 'SOF', ownerPath: sofPath, field: 'line' });
    });
    store.trashFiles(p.id, ['assets/panel.png'], { 'assets/panel.png': '' });
    store.deleteMap(p.id, via.id);
    p = store.project(p.id);
    T.same(p.trash.map(function (e) { return e.kind; }).sort(), ['asset', 'branch', 'figure', 'map', 'snapshot'], 'a trash entry of every kind');
  });

  T.test('the folder that goes out', async function () {
    files = await archive.projectFiles(p);
    var names = files.map(function (f) { return f.name; }).sort();
    var branch = p.trash.filter(function (e) { return e.kind === 'branch'; })[0];
    T.same(names, [
      'README.txt', 'assets/figure.png', 'assets/photo.png', 'assets/kyc-board.excalidraw.svg', 'assets/new.ink.svg', 'assets/lone-branch.png',
      'binned.md', 'citta.md', 'interneuron.json', 'kyc-2.md', 'kyc.md',
      'snapshots/citta--2026-09-11-0905.md', 'snapshots/kyc--2026-09-10-1430.md', 'snapshots/snapshots.json',
      'templates/flow.mmd',
      'trash/' + archive.stamp(branch.deletedAt) + '-poa.md',
      'trash/binned--2026-09-10-1430.md', 'trash/to-throw-away--2026-09-11-0905.md', 'trash/to-throw-away.md',
      'trash/figure.png', 'trash/panel.png', 'trash/lone-branch.png', 'trash/own.png', 'trash/trash.json',
      '東京.md'
    ].sort(), 'maps, files, copies and trash');
    function fileOf(name) { return files.filter(function (f) { return f.name === name; })[0]; }
    T.eq(fileOf('kyc.md').data, store.map(p.id, kyc.id).text, 'the .md is the map text as it is');
    T.eq(fileOf('citta.md').data, '# Città\n\n- Milan\n', 'accents in the map name');
    T.eq(fileOf('東京.md').data, '# 東京\n', 'a name in another script keeps its letters (an earlier version wrote map.md)');
    var meta = JSON.parse(fileOf('interneuron.json').data);
    T.eq(meta.mindroot, 'project', 'interneuron.json says what it is');
    T.eq(meta.name, 'Risk & Controls', 'the project name');
    T.eq(meta.description, 'everything there is', 'the description');
    T.eq(meta.isTemplate, true, 'that it is a template');
    T.same(meta.maps.map(function (m) { return [m.file, m.name]; }),
      [['kyc.md', 'KYC'], ['citta.md', 'Città'], ['kyc-2.md', 'KYC'], ['東京.md', '東京'], ['binned.md', 'Binned']], 'the maps in order with their real names');
    var snapIndex = JSON.parse(fileOf('snapshots/snapshots.json').data);
    T.same(snapIndex.map(function (s) { return [s.file, s.kind, s.label, s.when]; }),
      [['citta--2026-09-11-0905.md', 'manual', 'before Rome', new Date(T2).toISOString()], ['kyc--2026-09-10-1430.md', 'auto', '', new Date(T1).toISOString()]],
      'copies say by hand or not, the note, and the exact time');
    var trashIndex = JSON.parse(fileOf('trash/trash.json').data);
    var branchLine = trashIndex.filter(function (l) { return l.kind === 'branch'; })[0];
    T.eq(branchLine.map, 'kyc.md', 'the trashed branch names its map');
    T.same(branchLine.assets, { 'assets/lone-branch.png': 'lone-branch.png' }, 'and the files it took');
    T.eq(fileOf('trash/' + branchLine.file).data, '- POA\n  - ![](assets/lone-branch.png) detail', 'its file holds its lines');
    T.ok(fileOf('kyc.md').date === store.map(p.id, kyc.id).updatedAt, 'each map file dated when the map last changed');
  });

  T.test('the ZIP, and the whole round trip', async function () {
    var out = await archive.projectZip(p.id);
    T.eq(out.name, 'risk-controls.interneuron.zip', 'named after the folder');
    var entries = await entriesOfZip(out.blob);
    T.ok(entries.every(function (e) { return e.path.indexOf('risk-controls.interneuron/') === 0; }), 'holding the folder');
    var raws = await archive.projectsFromEntries(entries);
    T.eq(raws.length, 1, 'one project comes back');
    back = store.importProjects(raws)[0];
    await D.sameProject(T, 'ZIP', p, back);

    var restored = store.restoreTrashMany(back.id, back.trash.map(function (e) { return e.id; }));
    T.eq(restored.length, 5, 'after the round trip every trash entry goes back');
    T.same(restored.map(function (r) { return r.where; }).sort(), ['files', 'same', 'same', 'same', 'same'], 'each where it was (the panel file to assets/)');
    var backKyc = store.project(back.id).maps.filter(function (m) { return m.name === 'KYC'; })[0];
    T.eq(backKyc.text, KYC_TEXT, 'the branch is back in its map, in its place, with the picture');
    T.same(await D.fileBytes(store.project(back.id), 'assets/lone-branch.png'), [4], 'and the files are back in assets/ with their bytes');
    T.ok(!Object.keys(store.project(back.id).files).some(function (f) { return /-2\.png$/.test(f); }), 'without renaming a picture that is its own');
    T.ok(store.project(back.id).maps.some(function (m) { return m.name === 'To throw away'; }), 'the trashed map is back');
  });

  T.test('a deleted note travels in the trash and comes back on its node', async function () {
    var np = store.createProject({ name: 'Note' });
    var nm = store.map(np.id);
    var NOTED = '# Note\n\n- one\n  - > note: line one\n    > line two\n';
    store.setMapText(np.id, nm.id, NOTED);
    var onePath = D.pathOf(NOTED, 'one');
    store.transaction('notes.label.delete', function () {
      store.setMapText(np.id, nm.id, doc.setNote(doc.parse(NOTED), onePath, 'node', '').text);
      store.trashNote(np.id, nm.id, { text: 'line one\nline two', kind: 'node', owner: 'one', ownerPath: onePath });
    });
    var out = await archive.projectFiles(store.project(np.id));
    var index = JSON.parse(out.filter(function (f) { return f.name === 'trash/trash.json'; })[0].data);
    T.same(index.map(function (l) { return [l.kind, l.map, l.owner, l.noteKind]; }), [['note', 'note.md', 'one', 'node']], 'trash.json says what it was and where');
    T.eq(out.filter(function (f) { return f.name === 'trash/' + index[0].file; })[0].data, 'line one\nline two', 'its words in a .md beside it');
    var nb = store.importProjects(await archive.projectsFromEntries(await entriesOfZip((await archive.projectZip(np.id)).blob)))[0];
    var e = store.project(nb.id).trash[0];
    T.same([e.kind, e.text, e.noteKind, e.owner], ['note', 'line one\nline two', 'node', 'one'], 'read back as a note');
    var r = store.restoreTrash(nb.id, e.id);
    T.eq(r && r.where, 'same', 'and put back where it was');
    T.eq(store.map(nb.id, store.project(nb.id).maps[0].id).text, NOTED, 'the map as before the delete');
  });

  T.test('copies keep their seconds and their time zone', async function () {
    var exact = new Date(Date.UTC(2026, 0, 2, 23, 59, 58, 123)).getTime();
    var entries = [
      { path: 'x.interneuron/x.md', data: D.bytes('# X\n') },
      { path: 'x.interneuron/snapshots/x--2026-01-03-0059.md', data: D.bytes('# X then\n') },
      { path: 'x.interneuron/snapshots/x--2026-05-06-0708.md', data: D.bytes('# X no index\n') },
      { path: 'x.interneuron/snapshots/snapshots.json', data: D.bytes(JSON.stringify([{ file: 'x--2026-01-03-0059.md', kind: 'manual', label: 'n', when: new Date(exact).toISOString() }])) }
    ];
    var raw = (await archive.projectsFromEntries(entries))[0];
    var withIndex = raw.snapshots.filter(function (s) { return s.label === 'n'; })[0];
    T.eq(withIndex.when, exact, 'the time comes from snapshots.json, to the millisecond, whatever the zone of the name');
    var noIndex = raw.snapshots.filter(function (s) { return s.label === ''; })[0];
    T.eq(noIndex.when, new Date(2026, 4, 6, 7, 8).getTime(), 'without an index line: the minute in the name, local time');
  });

  T.test('the JSON', async function () {
    var json = await archive.projectJson(p.id);
    T.ok(/^risk-controls-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(json.name), 'named after the project and the time');
    var data = JSON.parse(await json.blob.text());
    T.eq(data.mindroot, 'project', 'says what it holds');
    T.eq(data.version, 1, 'and the version');
    T.eq(typeof data.exportedAt, 'number', 'and when');
    T.eq(data.maps[0].text, store.map(p.id, kyc.id).text, 'maps hold their Markdown as it is');
    T.ok(data.assets.length >= 8 && data.assets.every(function (a) { return a.id && a.type && a.data; }), 'and every file in base64');
    var fromJson = store.importProjects(await archive.projectsFromJson(await json.blob.text()))[0];
    await D.sameProject(T, 'JSON', p, fromJson);
  });

  T.test('an id in a JSON never overwrites other bytes', async function () {
    var mine = await storage.putBlob(new Uint8Array([1, 1, 1]), 'mio.png', 'a-clash');
    T.eq(mine.asset, 'a-clash', 'bytes already here under some id');
    var json = JSON.stringify({
      mindroot: 'project', version: 1, name: 'Stranger', maps: [{ name: 'M', text: '# M\n\n- ![](assets/x.png) x\n' }],
      files: { 'assets/x.png': { asset: 'a-clash', type: 'image/png', size: 2, modified: 1 } },
      trash: [{ kind: 'asset', label: 'y.png', path: 'assets/y.png', file: { asset: 'a-clash', type: 'image/png', size: 2 }, deletedAt: 1 }],
      assets: [{ id: 'a-clash', type: 'image/png', data: btoa('\u0002\u0002') }]
    });
    var raw = (await archive.projectsFromJson(json))[0];
    var added = store.importProjects([raw])[0];
    T.same(Array.from(await storage.blobBytes('a-clash')), [1, 1, 1], 'the bytes here are untouched');
    T.same(await D.fileBytes(added, 'assets/x.png'), [2, 2], 'the imported project has its own');
    T.eq(added.trash[0].file.asset, added.files['assets/x.png'].asset, 'and its trash follows the same bytes');
    var mime = (await archive.projectsFromJson(JSON.stringify({ maps: [{ name: 'A', text: '# A\n' }], files: { 'a.txt': { asset: 'q' } }, assets: [{ id: 'q', mime: 'text/plain', name: 'a.txt', data: btoa('hello') }] })))[0];
    T.eq(await storage.blobText(mime.files['a.txt'].asset), 'hello', 'an asset with "mime" and a name, in a JSON with only maps');
  });

  T.test('two copies by hand in one minute', async function () {
    var twice = store.createProject({ name: 'Two copies' });
    var tm = store.map(twice.id);
    var T3 = new Date(2026, 8, 12, 16, 45, 10).getTime();
    store.takeSnapshot(twice.id, tm.id, { kind: 'manual', label: 'first', when: T3 });
    store.setMapText(twice.id, tm.id, '# Two copies\n\n- after\n');
    store.takeSnapshot(twice.id, tm.id, { kind: 'manual', label: 'after', when: T3 + 30000 });
    var names = (await archive.projectFiles(store.project(twice.id))).map(function (f) { return f.name; })
      .filter(function (n) { return /^snapshots\/.*\.md$/.test(n); }).sort();
    T.same(names, ['snapshots/two-copies--2026-09-12-1645-2.md', 'snapshots/two-copies--2026-09-12-1645.md'], 'go out under two names');
    var twiceBack = store.importProjects(await archive.projectsFromEntries(await entriesOfZip((await archive.projectZip(twice.id)).blob)))[0];
    T.same(twiceBack.snapshots.map(function (s) { return [s.label, s.when]; }).sort(), [['after', T3 + 30000], ['first', T3]], 'and come back two, with their notes and their seconds');
  });

  T.test('a backup keeps the order of the projects', async function () {
    store.init({});
    ['Zeta work', 'Garden', 'Garden copy', 'Alpha home'].forEach(function (n) { store.createProject({ name: n }); });
    var ordered = await archive.projectsFromEntries(await entriesOfZip((await archive.workspaceZip()).blob));
    T.same(ordered.map(function (p) { return p.name; }), ['Zeta work', 'Garden', 'Garden copy', 'Alpha home'], 'it comes back in the order the sidebar had, not by folder name');
  });

  T.test('the whole workspace', async function () {
    store.init({});
    store.createProject({ name: 'One' });
    var two = store.createProject({ name: 'One' });
    await put(two.id, 'assets/x.png', new Uint8Array([9, 9]));
    var wz = await archive.workspaceZip();
    T.ok(/^mindroot-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(wz.name), 'the whole workspace in one ZIP');
    var wzEntries = await entriesOfZip(wz.blob);
    T.same(Object.keys(wzEntries.reduce(function (acc, e) { acc[e.path.split('/')[0]] = 1; return acc; }, {})).sort(),
      ['one-2.interneuron', 'one.interneuron'], 'a folder per project, same names told apart');
    T.eq((await archive.projectsFromEntries(wzEntries)).length, 2, 'and they all come back');
    var deflated = await archive.workspaceZip({ deflate: true });
    T.eq((await archive.projectsFromEntries(await entriesOfZip(deflated.blob))).length, 2, 'compressed on request, and read back');
    var wj = await archive.workspaceJson();
    T.ok(/^mindroot-workspace-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(wj.name), 'the workspace JSON name');
    var wjData = JSON.parse(await wj.blob.text());
    T.eq(wjData.mindroot, 'workspace', 'says what it holds');
    T.eq(wjData.projects.length, 2, 'with the projects');
    var wjBack = await archive.projectsFromJson(await wj.blob.text());
    T.eq(wjBack.length, 2, 'and comes back');
    store.importProjects(wjBack);
    T.same(await D.fileBytes(store.projects()[3], 'assets/x.png'), [9, 9], 'with the bytes');
  });

  T.test('a folder of the version before', async function () {
    var legacy = [
      { path: 'map.interneuron/map.md', data: D.bytes('# Map\n\n- ![](assets/photo.png) node\n') },
      { path: 'map.interneuron/assets/photo.png', data: new Uint8Array([1]) },
      { path: 'map.interneuron/templates/a.mmd', data: D.bytes('graph LR\n') },
      { path: 'map.interneuron/trash/trash.json', data: D.bytes(JSON.stringify([{ file: 'old.png', from: 'assets/old.png', label: 'node', when: '2026-09-10T10:00:00.000Z' }])) },
      { path: 'map.interneuron/trash/old.png', data: new Uint8Array([2]) },
      { path: 'map.interneuron/trash/loose.png', data: new Uint8Array([3]), lastModified: 1234 },
      { path: 'map.interneuron/snapshots/map--2026-09-11-0313.md', data: D.bytes('# Map\n') },
      { path: 'map.interneuron/snapshots/snapshots.json', data: D.bytes(JSON.stringify([{ file: 'map--2026-09-11-0313.md', kind: 'auto', label: '', when: '2026-09-11T01:13:08.496Z' }])) }
    ];
    var old = store.importProjects(await archive.projectsFromEntries(legacy))[0];
    T.eq(old.name, 'map', 'a folder of the version before becomes a project');
    T.eq(old.maps[0].text, '# Map\n\n- ![](assets/photo.png) node\n', 'with its map');
    T.same(Object.keys(old.files).sort(), ['assets/photo.png', 'templates/a.mmd'], 'its files, templates included');
    T.eq(old.snapshots[0].when, Date.parse('2026-09-11T01:13:08.496Z'), 'the copy, at its exact time');
    T.same(old.trash.map(function (e) { return [e.kind, e.label, e.owner]; }).sort(),
      [['asset', 'loose.png', ''], ['figure', 'old.png', 'node']], 'and the trash: the picture with its node, the file with no line');
    T.eq(old.trash.filter(function (e) { return e.label === 'loose.png'; })[0].deletedAt, 1234, 'a file with no line is dated by the file');
    var oldFig = old.trash.filter(function (e) { return e.kind === 'figure'; })[0];
    var oldBack = store.restoreTrash(old.id, oldFig.id);
    T.eq(oldBack.where, 'same', 'the picture goes back on its node');
    T.eq(store.map(old.id, old.maps[0].id).text, '# Map\n\n- ![](assets/photo.png) ![](assets/old.png) node\n', 'beside the one there');
  });

  T.test('folders of every shape', async function () {
    var looseEntries = [
      { path: 'Scratch/one.md', data: D.bytes('# One\n') },
      { path: 'Scratch/two.md', data: D.bytes('# Two\n') },
      { path: 'Scratch/.obsidian/app.json', data: D.bytes('{}') }
    ];
    T.same(await archive.projectsFromEntries(looseEntries), [], 'a folder without the suffix is not a project, even with .md files');
    var nestedEntries = [
      { path: 'backup/2026/kyc.interneuron/kyc.md', data: D.bytes('# KYC\n') },
      { path: 'backup/2026/aml.interneuron/aml.md', data: D.bytes('# AML\n') }
    ];
    T.same(await archive.projectsFromEntries(nestedEntries), [], 'nor one with .interneuron folders deep inside');
    var beside = await archive.projectsFromEntries([
      { path: 'kyc.interneuron/kyc.md', data: D.bytes('# KYC\n') },
      { path: 'Scratch/one.md', data: D.bytes('# One\n') },
      { path: 'loose.md', data: D.bytes('# Loose\n') }
    ]);
    T.same(beside.map(function (x) { return x.name; }), ['kyc'], 'only the .interneuron comes in');
    T.same(archive.sortTop([
      { path: 'kyc.interneuron/kyc.md' }, { path: 'kyc.interneuron/assets/a.png' }, { path: 'Scratch/one.md' },
      { path: 'loose.md' }, { path: '.DS_Store' }, { path: 'fake.interneuron' }, { path: '__MACOSX/kyc.interneuron/x' }, { path: '../outside/x.md' }
    ]), { projects: ['kyc.interneuron'], others: ['Scratch', 'loose.md', 'fake.interneuron'] }, 'and what was left out is known (hidden files, litter and climbs are not even that)');
    T.ok(archive.isProjectFolder('Map.INTERNEURON') && !archive.isProjectFolder('Scratch') && !archive.isProjectFolder('interneuron'), 'a project folder is named .interneuron');
    var dirty = await archive.projectsFromEntries([
      { path: 'k.interneuron/k.md', data: D.bytes('# K\n') },
      { path: 'k.interneuron/../../evil.png', data: new Uint8Array([6]) },
      { path: 'k.interneuron/assets/Thumbs.db', data: new Uint8Array([6]) },
      { path: 'k.interneuron/assets/.hidden.png', data: new Uint8Array([6]) }
    ]);
    T.same(Object.keys(dirty[0].files), [], 'climbs, litter and hidden files never become project files');

    var plain = await archive.projectsFromEntries(looseEntries, { loose: true });
    T.eq(plain.length, 1, 'read loosely, a plain folder with .md files is a project');
    T.eq(plain[0].name, 'Scratch', 'named after the folder');
    T.same(plain[0].maps.map(function (m) { return m.name; }), ['one', 'two'], 'maps by name');
    T.same(Object.keys(plain[0].files), [], 'without hidden files');
    var nested = await archive.projectsFromEntries(nestedEntries, { loose: true });
    T.same(nested.map(function (x) { return x.name; }), ['aml', 'kyc'], 'and finds .interneuron folders at any depth');
    T.same(await archive.projectsFromEntries([{ path: 'x/a.png', data: new Uint8Array([1]) }], { loose: true }), [], 'a folder with no .md is nothing');
  });

  T.test('what the browser hands over', async function () {
    var dropped = await archive.readDropped(D.droppedDir('kyc.interneuron', [
      D.droppedFile('kyc.md', '# KYC\n'),
      D.droppedDir('assets', [D.droppedFile('a.png', 'x'), D.droppedFile('b.png', 'y')])
    ]));
    T.same(dropped.map(function (e) { return e.path; }).sort(),
      ['kyc.interneuron/assets/a.png', 'kyc.interneuron/assets/b.png', 'kyc.interneuron/kyc.md'], 'a dropped folder is read whole, in batches');
    T.same(archive.fromDirectoryInput([{ name: 'k.md', webkitRelativePath: 'k.interneuron/k.md' }, { name: 'solo.md' }]).map(function (e) { return e.path; }),
      ['k.interneuron/k.md', 'solo.md'], 'and so is a folder input');
  });

  T.test('one file at a time', async function () {
    var md = await archive.readFile(D.fakeFile('New idea.md', '# Idea\r\n\r\n- one\r\n'));
    T.same(md.map, { name: 'New idea', text: '# Idea\n\n- one\n' }, 'a loose .md is a map, with its name');
    var packed = await D.deflateZip([
      { name: 'x.interneuron/x.md', data: '# X\n\n- compressed\n' },
      { name: 'x.interneuron/assets/a.png', data: new Uint8Array([1, 1, 2, 3, 5, 8, 13]) }
    ]);
    var zipped = await archive.readFile(new File([packed], 'x.zip'));
    T.eq(zipped.projects[0].maps[0].text, '# X\n\n- compressed\n', 'a compressed ZIP is a project');
    var byType = await archive.readFile(new File([packed], 'download', { type: 'application/x-zip-compressed' }));
    T.eq(byType.projects.length, 1, 'known by its type when the name says nothing');

    var ipe = await rejects(archive.readFile(D.fakeFile('p.json', JSON.stringify({ ipe: 'project' }))));
    T.eq(ipe.code, 'archive.err.ipe', 'an IPE file says so');
    T.eq(ipe.message, 'this is an IPE file: open it in IPE', 'in those words');
    T.eq((await rejects(archive.readFile(D.fakeFile('p.json', '{"other": 1}')))).message, 'this JSON is not a MindRoot export', 'any JSON says so');
    T.eq((await rejects(archive.readFile(D.fakeFile('p.json', 'not json')))).code, 'archive.err.notJson', 'and not JSON at all');
    T.eq((await rejects(archive.readFile(D.fakeFile('p.json', '[1]')))).code, 'archive.err.nothing', 'a list is nothing to import');
    T.eq((await rejects(archive.readFile(D.fakeFile('p.json', '{"mindroot":"workspace","projects":[]}')))).code, 'archive.err.noProjects', 'an empty workspace');
    var strange = await rejects(archive.readFile(D.fakeFile('photo.gif', 'x')));
    T.eq(strange.code, 'archive.err.notImportable', 'a file MindRoot cannot import says so');
    T.ok(/photo\.gif is not something MindRoot can import/.test(strange.message), 'naming it');
    var empty = await rejects(archive.readFile(new File([await zip.build([{ name: 'a.png', data: 'x' }])], 'empty.zip')));
    T.eq(empty.message, 'empty.zip holds no .interneuron folder', 'a ZIP with no .interneuron says so');
    var loose = await rejects(archive.readFile(new File([await zip.build([{ name: 'Scratch/one.md', data: '# One\n' }, { name: 'two.md', data: '# Two\n' }])], 'scratch.zip')));
    T.eq(loose.message, 'scratch.zip holds no .interneuron folder', 'even with .md files inside');
    var renamed = await archive.readFile(new File([await zip.build([{ name: 'kyc.interneuron/kyc.md', data: '# KYC\n' }])], 'kyc.interneuron (1).zip'));
    T.eq(renamed.projects[0].name, 'kyc', 'a ZIP the browser renamed comes in: what is inside counts');
    var flat = await archive.readFile(new File([await zip.build([
      { name: 'interneuron.json', data: JSON.stringify({ mindroot: 'project', name: 'Risk', maps: [{ file: 'kyc.md', name: 'KYC' }] }) },
      { name: 'kyc.md', data: '# KYC\n\n- ![](assets/a.png) one\n' },
      { name: 'assets/a.png', data: new Uint8Array([7]) }
    ])], 'risk.interneuron.zip'));
    T.eq(flat.projects[0].name, 'Risk', 'a .interneuron.zip made from inside the folder is that folder');
    T.same([flat.projects[0].maps.map(function (m) { return m.name; }), Object.keys(flat.projects[0].files)], [['KYC'], ['assets/a.png']], 'with its maps and files');
    var hollow = await rejects(archive.readFile(new File([await zip.build([{ name: 'kyc.interneuron/assets/a.png', data: 'x' }])], 'kyc.interneuron.zip')));
    T.eq(hollow.message, 'kyc.interneuron.zip holds no map', 'an .interneuron with no map says so');
    ns.i18n.init('it');
    T.eq((await rejects(archive.readFile(D.fakeFile('p.json', 'nope')))).message, 'questo file non è un JSON', 'in Italian too');
    ns.i18n.init('en');
  });

  /* A PNG chunk: length, type, data, CRC over type and data. */
  function chunk(type, data) {
    var typeBytes = D.bytes(type);
    var out = new Uint8Array(12 + data.length);
    var view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(typeBytes, 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, zip.crc32(data, zip.crc32(typeBytes)));
    return out;
  }

  function concat(list) {
    var size = list.reduce(function (n, b) { return n + b.length; }, 0);
    var out = new Uint8Array(size);
    var at = 0;
    list.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }

  async function basePng() {
    var c = document.createElement('canvas');
    c.width = 4;
    c.height = 3;
    c.getContext('2d').fillRect(0, 0, 4, 3);
    var blob = await new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); });
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* The chunk goes right after IHDR (8 + 25 bytes), as an exporter writes it. */
  function withChunk(png, extra) { return concat([png.subarray(0, 33), extra, png.subarray(33)]); }

  async function deflateZlib(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  T.test('a picture that carries its map', async function () {
    var png = await basePng();
    var md = '# Map from a PNG\n\n- città\n- 東京\n';
    var plainChunk = concat([D.bytes('mindroot-markdown'), new Uint8Array([0, 0, 0]), D.bytes('it'), new Uint8Array([0, 0]), D.bytes(md)]);
    T.eq(await archive.markdownFromPng(withChunk(png, chunk('iTXt', plainChunk))), md, 'an iTXt chunk, UTF-8');
    var packed = await deflateZlib(D.bytes(md));
    var zChunk = concat([D.bytes('mindroot-markdown'), new Uint8Array([0, 1, 0]), new Uint8Array([0, 0]), packed]);
    T.eq(await archive.markdownFromPng(new Blob([withChunk(png, chunk('iTXt', zChunk))])), md, 'compressed, from a Blob');
    var latin = concat([D.bytes('mindroot-markdown'), new Uint8Array([0]), D.bytes('# Latin\n')]);
    T.eq(await archive.markdownFromPng(withChunk(png, chunk('tEXt', latin))), '# Latin\n', 'a tEXt chunk too');
    var other = concat([D.bytes('Comment'), new Uint8Array([0, 0, 0, 0, 0]), D.bytes('# not ours\n')]);
    T.eq(await archive.markdownFromPng(withChunk(png, chunk('iTXt', other))), null, 'a chunk with another keyword is not a map');
    var broken = withChunk(png, chunk('iTXt', plainChunk));
    broken[33 + 8 + 20] ^= 1;
    T.eq(await archive.markdownFromPng(broken), null, 'a damaged chunk (wrong CRC) is not a map');
    T.eq(await archive.markdownFromPng(png), null, 'a plain PNG carries nothing');
    T.eq(await archive.markdownFromPng(D.bytes('GIF89a, not a png')), null, 'nor does something else');
    T.eq(await archive.markdownFromPng(withChunk(png, chunk('iTXt', plainChunk)).subarray(0, 40)), null, 'nor a cut file');

    var file = new File([withChunk(png, chunk('iTXt', plainChunk))], 'Map.png', { type: 'image/png' });
    T.same((await archive.readFile(file)).map, { name: 'Map', text: md }, 'imported, it is a map named after the file');
    var bare = await rejects(archive.readFile(new File([png], 'photo.png', { type: 'image/png' })));
    T.eq(bare.code, 'archive.err.pngNoMap', 'a picture with no map says so');
    T.eq(bare.message, 'photo.png is a picture with no map inside', 'in those words');
  });

  T.test('everything at once: one step, one message', async function () {
    store.init({});
    var open = store.createProject({ name: 'Open' });
    store.clearHistory();
    var projectZip = new File([await zip.build([{ name: 'kyc.interneuron/kyc.md', data: '# KYC\n' }])], 'kyc.zip');
    var withPictures = D.fakeFile('Loose.md', '# Loose\n\n- ![](assets/a.png) x\n');
    var bad = D.fakeFile('broken.json', 'nope');
    var result = await archive.importFiles([projectZip, withPictures, bad]);
    T.eq(result.projects.length, 1, 'the project came in');
    T.eq(result.maps.length, 1, 'and the map');
    T.eq(result.maps[0].projectId, open.id, 'into the project open when the import started (not the one just imported)');
    T.eq(store.historyState().undoCount, 1, 'all of it one step');
    T.eq(store.historyState().undoLabel, 'import', 'labelled import');
    T.eq(result.message, '1 project imported, 1 map added to Open, its pictures stayed behind: a loose .md does not carry them. Left out: broken.json: this file is not JSON',
      'one message: what came in, and what was left out');
    store.undo();
    T.eq(store.projects().length, 1, 'one undo takes it all back');
    T.eq(store.project(open.id).maps.length, 1, 'the map too');

    var only = await archive.importFiles([D.fakeFile('A.md', '# A\n')]);
    T.eq(store.historyState().undoLabel, 'import a map', 'a single map: "import a map"');
    T.eq(only.message, '1 map added to Open.', 'said so');
    store.init({});
    var none = await archive.importFiles([D.fakeFile('A.md', '# A\n'), D.fakeFile('Two.md', '# Two\n')]);
    T.eq(none.projects.length, 2, 'with no project open, each loose map becomes a project');
    T.eq(none.message, '2 maps imported as projects.', 'said so');
    var nothing = await archive.importFiles([D.fakeFile('x.gif', 'x')]);
    T.eq(nothing.projects.length + nothing.maps.length, 0, 'nothing importable: nothing comes in');
    T.ok(/^Left out: x\.gif is not something/.test(nothing.message), 'and the message says why');

    var folder = await archive.importEntries([
      { path: 'kyc.interneuron/kyc.md', data: D.bytes('# KYC\n') },
      { path: 'Scratch/one.md', data: D.bytes('# One\n') },
      { path: 'Note/two.md', data: D.bytes('# Two\n') }
    ]);
    T.eq(folder.projects.length, 1, 'from folders, the .interneuron one comes in');
    T.eq(folder.message, '1 project imported. Left out: Scratch and Note are not project folders: a project comes in as a folder whose name ends in .interneuron',
      'the others are named');
    var empty = await archive.importEntries([{ path: 'empty.interneuron/assets/a.png', data: new Uint8Array([1]) }]);
    T.eq(empty.message, 'Left out: there is no map in empty.interneuron: a map is a .md, and a project a folder of them', 'a project folder with no map');
    var loose = await archive.importEntries([{ path: 'Scratch/one.md', data: D.bytes('# One\n') }], { loose: true });
    T.eq(loose.projects[0].name, 'Scratch', 'read loosely (after the person said so), a plain folder is a project');
    ns.i18n.init('it');
    var it = await archive.importFiles([D.fakeFile('A.md', '# A\n')], { projectId: loose.projects[0].id });
    T.eq(it.message, '1 mappa aggiunta a Scratch.', 'the message in Italian');
    ns.i18n.init('en');
  });

  T.test('handing a file over', function () {
    var caught = null;
    archive.setDownloader(function (name, blob) { caught = { name: name, size: blob.size }; });
    T.eq(archive.download({ name: 'a.zip', blob: new Blob(['abc']) }), 'a.zip', 'download hands the file over by name');
    T.same(caught, { name: 'a.zip', size: 3 }, 'with its bytes');
    archive.setDownloader(null);
  });

  T.test('the strings, in both languages', function () {
    var I = ns.i18n;
    var en = I.keys('en').filter(function (k) { return /^archive\./.test(k); });
    var it = I.keys('it').filter(function (k) { return /^archive\./.test(k); });
    T.same(en.filter(function (k) { return it.indexOf(k) < 0; }), [], 'none in English only');
    T.same(it.filter(function (k) { return en.indexOf(k) < 0; }), [], 'none in Italian only');
    I.init('it');
    var texts = it.map(function (k) { return I.t(k); });
    I.init('en');
    texts = texts.concat(en.map(function (k) { return I.t(k); }));
    T.same(texts.filter(function (s) { return /!|—/.test(s); }), [], 'no exclamation marks, no em-dashes');
  });

  T.test('a ZIP entry refused for its path is named in the message', async function () {
    var blob = await D.deflateZip([
      { name: 'kyc.interneuron/kyc.md', data: '# KYC\n' },
      { name: '../outside.md', data: '# outside\n' },
      { name: 'kyc.interneuron/../../evil.md', data: '# evil\n' }
    ]);
    var file = new File([blob], 'bundle.zip', { type: 'application/zip' });
    var got = await archive.readFile(file);
    T.same(got.skipped, ['../outside.md', 'kyc.interneuron/../../evil.md'], 'readFile lists what the ZIP reader refused');
    var res = await archive.importFiles([file], { projectId: null });
    T.eq(res.projects.length, 1, 'the project still comes in');
    T.eq(res.message, '1 project imported. Left out: ../outside.md and kyc.interneuron/../../evil.md in bundle.zip, whose paths lead outside the folder',
      'and the message says what was left out');
    store.undo();
    var many = [{ name: 'kyc.interneuron/kyc.md', data: '# KYC\n' }];
    for (var i = 0; i < 7; i++) many.push({ name: '../f' + i + '.md', data: 'x' });
    var res2 = await archive.importFiles([new File([await D.deflateZip(many)], 'many.zip')], { projectId: null });
    T.eq(res2.errors[0], '../f0.md, ../f1.md, ../f2.md, ../f3.md, and 3 more in many.zip, whose paths lead outside the folder', 'a long list is cut short');
    store.undo();
  });

  T.test('a project file where the folder has a meaning of its own never breaks the backup', async function () {
    var raw = {
      mindroot: 'project', version: 1, name: 'Odd',
      maps: [{ id: 'm1', name: 'm', text: '# m\n\n- ![](m.md) x\n' }],
      files: {
        'interneuron.json': { asset: 'k1', type: 'application/json', size: 2, modified: 1 },
        'm.md': { asset: 'k2', type: 'text/markdown', size: 2, modified: 1 },
        'snapshots/x.md': { asset: 'k3', type: 'text/markdown', size: 2, modified: 1 },
        'trash/trash.json': { asset: 'k4', type: 'application/json', size: 2, modified: 1 },
        'files/m.md': { asset: 'k5', type: 'text/markdown', size: 2, modified: 1 },
        'assets/': { asset: 'k6', type: 'image/png', size: 2, modified: 1 },
        'assets/a/.': { asset: 'k7', type: 'image/png', size: 2, modified: 1 }
      },
      trash: [{ id: 't1', kind: 'asset', deletedAt: 5, label: 'z.png', path: 'assets/z.png', file: { asset: 'k1', type: 'image/png', size: 2, modified: 1 }, owner: '' }],
      assets: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'].map(function (id) { return { id: id, type: 'text/plain', data: btoa(id) }; })
    };
    var res = await archive.importFiles([new File([JSON.stringify(raw)], 'odd.json', { type: 'application/json' })], { projectId: null });
    var q = res.projects[0];
    T.ok(!!q, 'the project comes in');
    T.same(Object.keys(q.files).sort(), ['assets/a', 'files/m.md', 'interneuron.json', 'm.md', 'snapshots/x.md', 'trash/trash.json'],
      'a folder path is dropped, a dot is tidied');
    var out = await archive.projectZip(q.id);
    var names = (await zip.read(out.blob)).map(function (e) { return e.name.slice(e.name.indexOf('/') + 1); }).sort();
    T.same(names, ['assets/a', 'files/interneuron.json', 'files/m-2.md', 'files/m.md', 'files/snapshots/x.md', 'files/trash/trash.json',
      'interneuron.json', 'm.md', 'trash/trash.json', 'trash/z.png'].sort(), 'clashing paths go under files/, the backup is written');
    var whole = await archive.workspaceZip();
    T.ok(whole.blob.size > 0, 'and so is the whole workspace');
    var again = await archive.projectFromFiles(await entriesOfZip(out.blob).then(function (list) {
      return list.map(function (e) { return { path: e.path.slice(e.path.indexOf('/') + 1), data: e.data }; });
    }), 'x');
    T.same(again.maps.map(function (m) { return m.name; }), ['m'], 'read back, the maps are the maps');
    store.undo();
  });

  T.test('clean up', async function () {
    storage.useDatabase('mindroot2-test-elsewhere');
    await D.deleteDB(DB);
    T.ok((await D.listDBs()).indexOf(DB) < 0, 'the test database is gone');
  });
})();
