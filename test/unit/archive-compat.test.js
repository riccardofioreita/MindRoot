/* MindRoot - compatibility with older exports. The fixtures in
 * test/fixtures/data/old-exports.js were written by an earlier
 * archive.js (a frozen fixture; its header says how): a project ZIP, a project JSON, a
 * workspace ZIP and a workspace JSON, with maps, pictures, a drawing, copies
 * by hand and by the clock, and a trash entry of every kind. They must come
 * in losslessly, and go out again as the same files, byte for byte. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  var storage = ns.storage;
  var archive = ns.archive;
  var D = window.DataT;
  var OLD = window.OldExports;
  var DB = 'mindroot2-test-compat';
  ns.i18n.init('en');

  var record = OLD.record;
  var imported;

  function fileFromBase64(item) {
    return new File([D.base64ToBytes(item.base64)], item.name, { type: 'application/zip' });
  }

  /* The names the old export wrote carry its local time; this machine's
   * export carries this machine's. The fixture lists the instant behind
   * every stamp, so the expected name here is computed, not assumed. */
  function localName(name) {
    return name.replace(/\d{4}-\d{2}-\d{2}-\d{4}/g, function (s) {
      return OLD.stamps[s] != null ? archive.stamp(OLD.stamps[s]) : s;
    });
  }

  function mapName(p, id) {
    var m = p.maps.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : null;
  }

  /* A trash entry as a person sees it, without ids. */
  function entryShape(p, e) {
    var out = { kind: e.kind, label: e.label, deletedAt: e.deletedAt };
    if (e.kind === 'branch') {
      out.map = mapName(p, e.mapId);
      out.mapName = e.mapName;
      out.fragment = e.fragment;
      out.origin = e.origin;
      out.files = Object.keys(e.files).sort();
    } else if (e.kind === 'figure' || e.kind === 'asset') {
      out.path = e.path;
      out.owner = e.owner;
      out.file = !!e.file;
      if (e.kind === 'figure') { out.map = mapName(p, e.mapId); out.mapName = e.mapName; out.ownerPath = e.ownerPath; out.field = e.field; }
    } else if (e.kind === 'map') {
      out.index = e.index;
      out.map = { name: e.map.name, text: e.map.text, createdAt: e.map.createdAt };
      out.files = Object.keys(e.files).sort();
      out.snapshots = e.snapshots.map(function (s) { return [s.when, s.kind, s.label, s.text]; });
    } else {
      out.mapName = e.mapName;
      out.snapshot = [mapName(p, e.snapshot.mapId), e.snapshot.when, e.snapshot.kind, e.snapshot.label, e.snapshot.text];
    }
    return out;
  }

  T.test('an earlier version\'s project ZIP comes in losslessly', async function () {
    storage.useDatabase('mindroot2-test-elsewhere');
    await D.deleteDB(DB);
    storage.useDatabase(DB);
    store.init({});
    var got = await archive.readFile(fileFromBase64(OLD.projectZip));
    T.eq(got.projects.length, 1, 'one project');
    imported = store.importProjects(got.projects)[0];
    T.eq(imported.name, record.name, 'its name');
    T.eq(imported.description, record.description, 'its description');
    T.eq(imported.isTemplate, record.isTemplate, 'its template flag');
    T.eq(imported.createdAt, record.createdAt, 'when it was made');
    T.eq(imported.updatedAt, record.updatedAt, 'and last changed');
    T.same(imported.maps.map(function (m) { return [m.name, m.text, m.createdAt, m.updatedAt]; }),
      record.maps.map(function (m) { return [m.name, m.text, m.createdAt, m.updatedAt]; }), 'every map: name, text, times');
    T.same(Object.keys(imported.files).sort(), Object.keys(record.files).sort(), 'every file');
    var json = JSON.parse(OLD.projectJson.text);
    var bytesById = {};
    json.assets.forEach(function (a) { bytesById[a.id] = Array.from(D.base64ToBytes(a.data)); });
    var paths = Object.keys(record.files);
    var same = true;
    for (var i = 0; i < paths.length; i++) {
      if (JSON.stringify(await D.fileBytes(imported, paths[i])) !== JSON.stringify(bytesById[record.files[paths[i]].asset])) same = false;
    }
    T.ok(same, 'with the same bytes');
    function copies(p) {
      return p.snapshots.map(function (s) { return [mapName(p, s.mapId), s.when, s.kind, s.label, s.text]; }).sort();
    }
    T.same(copies(imported), copies(record), 'every copy, with its map, its exact time (seconds included), kind and note');
    T.same(imported.trash.map(function (e) { return entryShape(imported, e); }), record.trash.map(function (e) { return entryShape(record, e); }),
      'every trash entry of every kind, in order, with all it knows');
    var oldRead = OLD.oldReread.snapshots.map(function (s) { return s.when; }).sort();
    var newRead = got.projects[0].snapshots.map(function (s) { return s.when; }).sort();
    T.ok(oldRead.some(function (w, i) { return w !== newRead[i]; }), 'an earlier version lost the seconds of copies here; this one does not');
  });

  T.test('and goes out again as the same files', async function () {
    var oldEntries = await D.entriesOf(D.base64ToBytes(OLD.projectZip.base64));
    var again = await archive.projectZip(imported.id);
    T.eq(again.name, OLD.projectZip.name, 'the same ZIP name');
    var newEntries = await D.entriesOf(again.blob);
    var expected = Object.keys(oldEntries).map(localName).sort();
    T.same(Object.keys(newEntries).sort(), expected, 'the same file names');
    var differ = Object.keys(oldEntries).filter(function (name) {
      return !D.equalBytes(oldEntries[name], newEntries[localName(name)]);
    });
    T.same(differ, [], 'every file the same bytes: maps, interneuron.json, assets, snapshots.json, trash.json and the rest');
  });

  T.test('every entry of its trash goes back', function () {
    var res = store.restoreTrashMany(imported.id, imported.trash.map(function (e) { return e.id; }));
    T.eq(res.length, 5, 'all five');
    var kyc = store.project(imported.id).maps.filter(function (m) { return m.name === 'KYC'; })[0];
    T.eq(kyc.text, OLD.kycBefore, 'the map gets back the branch and the picture: the text it had before');
    T.ok(store.project(imported.id).maps.some(function (m) { return m.name === 'Da buttare'; }), 'the map comes back');
    T.ok(!!store.fileRef(imported.id, 'assets/pannello.png'), 'the panel file comes back');
    T.ok(store.snapshotsOf(imported.id, store.project(imported.id).maps.filter(function (m) { return m.name === 'Cestinata'; })[0].id).length === 1, 'and the copy');
  });

  T.test('an earlier version\'s project JSON comes in losslessly', async function () {
    var raws = await archive.projectsFromJson(OLD.projectJson.text);
    var p = store.importProjects(raws)[0];
    T.same(p.maps.map(function (m) { return [m.name, m.text]; }), record.maps.map(function (m) { return [m.name, m.text]; }), 'maps');
    T.same(p.snapshots.map(function (s) { return [mapName(p, s.mapId), s.when, s.kind, s.label]; }).sort(),
      record.snapshots.map(function (s) { return [mapName(record, s.mapId), s.when, s.kind, s.label]; }).sort(), 'copies');
    T.same(p.trash.map(function (e) { return entryShape(p, e); }), record.trash.map(function (e) { return entryShape(record, e); }), 'trash');
    T.same(await D.fileBytes(p, 'assets/foto.png'), await D.fileBytes(imported, 'assets/foto.png'), 'bytes');

    var out = JSON.parse(await (await archive.projectJson(p.id)).blob.text());
    var old = JSON.parse(OLD.projectJson.text);
    T.same(Object.keys(out), Object.keys(old), 'the new JSON has the same fields, in the same order');
    function strip(x) {
      return JSON.parse(JSON.stringify(x, function (k, v) {
        return k === 'id' || k === 'mapId' || k === 'asset' || k === 'exportedAt' || k === 'assets' || k === 'updatedAt' ? undefined : v;
      }));
    }
    out.name = out.name.replace(/ \(\d+\)$/, '');
    T.same(strip(out), strip(old), 'and the same content (ids, byte ids and export times aside, and the number a name already taken gets)');
    T.eq(out.assets.length, old.assets.length, 'as many files in base64');
  });

  T.test('an earlier version\'s workspace ZIP and JSON', async function () {
    var got = await archive.readFile(fileFromBase64(OLD.workspaceZip));
    T.same(got.projects.map(function (p) { return p.name; }), ['Rischio & Controlli', 'Uno'], 'both projects from the ZIP');
    var secondProject = got.projects[1];
    T.eq(secondProject.maps[0].name, '東京 2024', 'a map named in another script keeps its name (the file was "2024.md")');
    T.eq(secondProject.maps[0].text, '# 東京 2024\n\n- ![](assets/x.png) 渋谷\n', 'and its text');
    var fromJson = await archive.projectsFromJson(OLD.workspaceJson.text);
    T.same(fromJson.map(function (p) { return p.name; }), ['Rischio & Controlli', 'Uno'], 'both projects from the JSON');
    var added = store.importProjects(fromJson);
    T.same(await D.fileBytes(added[1], 'assets/x.png'), await D.fileBytes(store.importProjects([secondProject])[0], 'assets/x.png'), 'the same picture either way');
    var files = (await archive.projectFiles(added[1])).map(function (f) { return f.name; });
    T.ok(files.indexOf('東京-2024.md') >= 0, 'going out again, its file is named with its letters');
  });

  T.test('clean up', async function () {
    storage.useDatabase('mindroot2-test-elsewhere');
    await D.deleteDB(DB);
    T.ok((await D.listDBs()).indexOf(DB) < 0, 'the test database is gone');
  });
})();
