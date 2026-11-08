/* MindRoot - where the work stays (ported from an earlier persistence suite, plus
 * what is new): IndexedDB in a database of the tests' own, the workspace
 * surviving a reopen, only changed projects written, bytes stored once by
 * content, garbage collected by cursor and never what undo can bring back,
 * the save state on the bus (never "saved" without IndexedDB), map views
 * kept, the read-only mode of a second tab, and the browser's promises. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var store = ns.store;
  var storage = ns.storage;
  var D = window.DataT;
  var DB = 'mindroot2-test-storage';
  ns.i18n.init('en');

  /* A reload, as far as storage.js can tell: every cache and every memory
   * of the last write dropped, and the database opened again. */
  function reopen() { storage.useDatabase(DB); }

  var states = [];
  ns.bus.on('save', function (detail) { states.push(detail); });
  function lastState() { return states.length ? states[states.length - 1].state : null; }

  var p, m, img, second, auto;

  T.test('a database of the tests\' own, fresh', async function () {
    storage.useDatabase('mindroot2-test-elsewhere');
    await D.deleteDB(DB);
    reopen();
    T.eq(storage.databaseName(), DB, 'the tests write into their own database');
    var first = await storage.load();
    T.eq(first.fresh, true, 'a new database says so');
    T.same(first.projects, [], 'and has no projects');
    T.ok(storage.available(), 'IndexedDB is there');
    var dump = await D.dump(DB);
    T.eq(dump.version, 1, 'version 1');
    T.same(Object.keys(dump.stores).sort(), ['blobs', 'kv', 'projects'], 'with kv, projects and blobs');
  });

  T.test('the bytes, stored by what they are', async function () {
    var note = await storage.putBlob(new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    T.ok(/^a[0-9a-f]{64}$/.test(note.asset), 'an id from the content');
    T.eq(note.size, 5, 'with its size');
    T.eq(note.type, 'text/plain', 'and its type');
    T.eq(await storage.blobText(note.asset), 'hello', 'read back');
    var same = await storage.putBlob(new Uint8Array(D.bytes('hello')), 'other.txt');
    T.eq(same.asset, note.asset, 'the same bytes again: the same record');
    var other = await storage.putBlob(new Uint8Array(D.bytes('hello')), 'hello.svg');
    T.ok(other.asset !== note.asset, 'the same bytes as another type: another record');
    T.eq(other.type, 'image/svg+xml', 'typed by name when the data has none');
    var url = await storage.blobURL(note.asset);
    T.eq(await storage.blobURL(note.asset), url, 'one URL per set of bytes');
    T.eq(await (await fetch(url)).text(), 'hello', 'and it leads to the bytes');
    T.ok(/^data:text\/plain/.test(await storage.blobDataURL(note.asset)), 'as a data URL too');
    T.same(Array.from(await storage.blobBytes(note.asset)), [104, 101, 108, 108, 111], 'and as bytes');
    T.eq(storage.typeOf('PHOTO.PNG'), 'image/png', 'type from the name');
    T.eq(storage.typeOf('kyc.excalidraw.svg'), 'image/svg+xml', 'a drawing is an svg');
    T.eq(storage.typeOf('kyc.ink.svg'), 'image/svg+xml', 'a new drawing too');
    T.eq(storage.typeOf('x.bin'), 'application/octet-stream', 'unknown is bytes');
    T.eq(storage.typeOf('x.bin', 'text/plain'), 'text/plain', 'or the fallback given');
    T.eq(await storage.getBlob('a-nobody'), null, 'an id that is not there gives nothing');
    T.eq(await storage.getBlob(''), null, 'nor does no id');
    var kept = await storage.putBlob(new Blob(['x']), 'x.txt', 'a-explicit');
    T.eq(kept.asset, 'a-explicit', 'an explicit id is kept');
  });

  T.test('the workspace, reopened', async function () {
    store.init({});
    p = store.createProject({ name: 'Persistent', description: 'stays' });
    m = store.map(p.id);
    store.setMapText(p.id, m.id, '# Persistent\n\n- one\n');
    img = await storage.saveAsset(store, p.id, new File([new Uint8Array([1, 2, 3])], 'My Photo.PNG', { type: 'image/png' }));
    T.eq(img.path, 'assets/my-photo.png', 'a picture gets a clean name in assets/');
    store.setFile(p.id, img.path, img.ref);
    var img2 = await storage.saveAsset(store, p.id, new File([new Uint8Array([9])], 'my-photo.png', { type: 'image/png' }));
    T.eq(img2.path, 'assets/my-photo-2.png', 'the second with the same name a number');
    var tokyo = await storage.saveAsset(store, p.id, new File([new Uint8Array([8])], '東京 タワー.jpg', { type: 'image/jpeg' }));
    T.eq(tokyo.path, 'assets/東京-タワー.jpg', 'a name in another script keeps its letters');
    var noExt = await storage.saveAsset(store, p.id, new File([new Uint8Array([7])], 'pasted', { type: 'image/webp' }));
    T.eq(noExt.path, 'assets/pasted.webp', 'no extension: the one of its type');
    var drawn = await storage.saveAsset(store, p.id, new File(['<svg/>'], 'My Sketch.Ink.SVG', { type: 'image/svg+xml' }));
    T.eq(drawn.path, 'assets/my-sketch.ink.svg', 'a drawing file keeps its double suffix');
    second = store.createMap(p.id, { name: 'Second' });
    store.setActive(p.id, m.id);
    store.setMapView(p.id, m.id, { folds: ['Persistent\u001fone'], direction: 'both' });
    T.eq(await storage.save(store.state, store.ui(), store.mapViews()), true, 'the write goes through');

    reopen();
    var again = await storage.load();
    T.eq(again.fresh, false, 'reopened it is not fresh');
    T.eq(again.projects.length, 1, 'the project is there');
    T.eq(again.projects[0].name, 'Persistent', 'with its name');
    T.eq(again.projects[0].description, 'stays', 'and its description');
    T.same(again.projects[0].maps.map(function (x) { return x.name; }), ['Persistent', 'Second'], 'and the maps in order');
    T.eq(again.projects[0].maps[0].text, '# Persistent\n\n- one\n', 'with their text');
    T.eq(again.projects[0].files['assets/my-photo.png'].asset, img.ref.asset, 'and the files');
    T.eq(again.ui.activeMaps[p.id], m.id, 'and the open map');
    T.same(again.views[p.id][m.id].folds, ['Persistent\u001fone'], 'and how the map was folded');
    T.same(Array.from(await storage.blobBytes(img.ref.asset)), [1, 2, 3], 'and the bytes, read from the database');
    store.init(again);
    T.same(store.here(), { projectId: p.id, mapId: m.id }, 'the workspace picks up where it was');
    T.eq(store.mapView(p.id, m.id).direction, 'both', 'with the map view');
    T.eq(store.canUndo(), false, 'no history: it belongs to a session');
  });

  T.test('only what changed is written', async function () {
    var q = store.createProject({ name: 'Other' });
    await storage.save(store.state, store.ui(), store.mapViews());
    var puts = [];
    var put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      puts.push(this.name + ':' + (value && value.id ? 'project ' + (value.id === q.id ? 'Other' : value.name) : key));
      return put.apply(this, arguments);
    };
    try {
      store.setMapText(q.id, store.map(q.id).id, '# Other\n\n- x\n');
      await storage.save(store.state, store.ui(), store.mapViews());
      T.same(puts, ['projects:project Other', 'kv:workspace'], 'one map of one project changed: only that project');
      puts.length = 0;
      await storage.save(store.state, store.ui(), store.mapViews());
      T.same(puts, [], 'nothing changed: nothing written');
      store.setActive(p.id, second.id);
      await storage.save(store.state, store.ui(), store.mapViews());
      T.same(puts, ['kv:workspace'], 'another map opened: only the meta');
      puts.length = 0;
      store.setMapView(p.id, second.id, { camera: { x: 1, y: 2, k: 2 } });
      await storage.save(store.state, store.ui(), store.mapViews());
      T.same(puts, ['kv:views', 'kv:workspace'], 'a view changed: the views');
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    store.deleteProject(q.id);
    await storage.save(store.state, store.ui(), store.mapViews());
    reopen();
    T.eq((await storage.load()).projects.length, 1, 'a deleted project leaves the database too');
  });

  T.test('a project with no place in the order is kept', async function () {
    var raw = await new Promise(function (resolve) {
      var r = indexedDB.open(DB);
      r.onsuccess = function () {
        var db = r.result;
        var tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: 'p-stray', name: 'Lost', maps: [{ id: 'mx', name: 'X', text: '# X\n' }] });
        tx.oncomplete = function () { db.close(); resolve(true); };
      };
    });
    T.ok(raw, 'a record written without the order');
    reopen();
    var got = await storage.load();
    T.same(got.projects.map(function (x) { return x.name; }), ['Persistent', 'Lost'], 'it comes at the end rather than being lost');
    store.init(got);
    store.deleteProject('p-stray');
    store.clearHistory();
    await storage.save(store.state, store.ui(), store.mapViews());
  });

  T.test('garbage: unreferenced bytes go, by cursor, a day after', async function () {
    reopen();
    store.init(await storage.load());
    var orphan = await storage.putBlob(new Blob(['orphan']), 'o.txt');
    var young = await storage.putBlob(new Blob(['young']), 'y.txt');
    var getAll = IDBObjectStore.prototype.getAll;
    var getAllKeys = IDBObjectStore.prototype.getAllKeys;
    var bulk = 0;
    IDBObjectStore.prototype.getAll = function () { bulk++; return getAll.apply(this, arguments); };
    IDBObjectStore.prototype.getAllKeys = function () { bulk++; return getAllKeys.apply(this, arguments); };
    var gone;
    try { gone = await storage.collect(store.projects(), 0); } finally {
      IDBObjectStore.prototype.getAll = getAll;
      IDBObjectStore.prototype.getAllKeys = getAllKeys;
    }
    T.eq(bulk, 0, 'walked with a cursor, not read whole');
    T.ok(gone >= 2, 'bytes nothing names are deleted');
    reopen();
    T.eq(await storage.getBlob(orphan.asset), null, 'really');
    T.eq(await storage.getBlob(young.asset), null, 'all of them');
    T.ok(!!(await storage.getBlob(img.ref.asset)), 'bytes a project names stay');
    var fresh = await storage.putBlob(new Blob(['z']), 'z.txt');
    await storage.collect(store.projects());
    T.ok(!!(await storage.getBlob(fresh.asset)), 'bytes just added stay for a day (another tab may be using them)');
    store.trashFiles(p.id, [img.path]);
    await storage.collect(store.projects(), 0);
    reopen();
    T.ok(!!(await storage.getBlob(img.ref.asset)), 'bytes held by the trash stay');
    store.undo();

    var gonePicture = await storage.putBlob(new Uint8Array([4, 4, 4]), 'via.png');
    var doomed = store.createProject({ name: 'To delete' });
    store.setFile(doomed.id, 'assets/via.png', gonePicture);
    store.deleteProject(doomed.id);
    await storage.collect(store.retainedProjects(), 0);
    T.ok(!!(await storage.getBlob(gonePicture.asset)), 'bytes of a deleted project undo can bring back stay');
    store.undo();
    T.eq(store.project(doomed.id).files['assets/via.png'].asset, gonePicture.asset, 'and undo finds them');
    store.deleteProject(doomed.id);
    store.clearHistory();
    T.ok(storage.referencedAssets([store.project(p.id)])[img.ref.asset], 'referencedAssets names the files of a project');
  });

  T.test('the files of a project', async function () {
    var drawing = storage.uniqueDrawing(store, p.id, 'KYC Map');
    T.eq(drawing, 'assets/kyc-map.ink.svg', 'a new drawing gets the .ink.svg double suffix');
    T.eq(storage.drawingName(''), 'drawing.ink.svg', 'with no title: "drawing"');
    T.eq(storage.drawingName('Città'), 'citta.ink.svg', 'accents dropped, letters kept');
    T.ok(storage.isDrawingName('a.ink.svg') && storage.isDrawingName('A.EXCALIDRAW.SVG'), 'both kinds are drawings');
    T.ok(!storage.isDrawingName('a.svg') && !storage.isDrawingName('ink.svg.png'), 'a plain svg is not');
    var first = await storage.putBlob(new Blob(['<svg>a</svg>'], { type: 'image/svg+xml' }), drawing);
    store.setFile(p.id, drawing, first, { label: 'save the drawing' });
    T.eq(await storage.readDrawing(store, p.id, drawing), '<svg>a</svg>', 'saved, it is in the project');
    T.eq(storage.uniqueDrawing(store, p.id, 'KYC Map'), 'assets/kyc-map-2.ink.svg', 'a second one with that title gets a number before the suffix');
    var next = await storage.putBlob(new Blob(['<svg>b</svg>'], { type: 'image/svg+xml' }), drawing);
    store.setFile(p.id, drawing, next, { label: 'save the drawing' });
    T.ok(store.fileRef(p.id, drawing).asset !== first.asset, 'saved again: new bytes, a new record');
    T.eq(await storage.readDrawing(store, p.id, drawing), '<svg>b</svg>', 'the new one is read');
    store.undo();
    T.eq(await storage.readDrawing(store, p.id, drawing), '<svg>a</svg>', 'undo brings back the drawing before');
    T.eq(await storage.readDrawing(store, p.id, 'assets/never.ink.svg'), null, 'a drawing that is not there is null');

    T.ok(/^blob:/.test(await storage.assetURL(store, p.id, 'assets/my-photo.png')), 'a picture has a URL');
    T.eq(await storage.assetURL(store, p.id, './assets/my-photo.png'), await storage.assetURL(store, p.id, 'assets/my-photo.png'), 'also written with ./');
    var spaced = await storage.putBlob(new Blob([new Uint8Array([7])], { type: 'image/png' }), 'a space.png');
    store.setFile(p.id, 'assets/a space.png', spaced);
    T.ok(/^blob:/.test(await storage.assetURL(store, p.id, 'assets/a%20space.png')), 'and with spaces written %20');
    T.eq(await storage.assetURL(store, p.id, 'assets/%E0%A4%A.png'), null, 'a malformed escape is simply not found');
    T.eq(await storage.assetURL(store, p.id, 'assets/no.png'), null, 'a file that is not there has no URL');
    T.ok(/^data:image\/png/.test(await storage.assetDataURL(store, p.id, 'assets/my-photo.png')), 'and a data URL for exports');

    store.setMapText(p.id, m.id, '# Persistent\n\n- ![](assets/my-photo.png) one\n');
    var assets = storage.listAssets(store, p.id);
    T.eq(assets[0].kind, 'drawing', 'the images panel lists drawings first');
    T.same(assets.slice(1).map(function (a) { return a.file; }), ['a space.png', 'my-photo.png'], 'then pictures by name');
    T.eq(assets.filter(function (a) { return a.file === 'my-photo.png'; })[0].used, true, 'saying whether a map uses it');
    T.eq(assets[0].used, false, 'or not');
    T.same(storage.listAssets(store, 'nope'), [], 'a project that is not there has none');
  });

  T.test('saving by itself, and saying so on the bus', async function () {
    states.length = 0;
    auto = storage.autosave(store, { delay: 20 });
    T.eq(storage.autosave(store), auto, 'one watcher per store, however often asked');
    store.setMapText(p.id, m.id, '# Persistent\n\n- written on its own\n');
    T.ok(auto.pending() && storage.pending(), 'after a change there is something to write');
    T.eq(lastState(), 'pending', 'the bus says pending');
    T.eq(await storage.flush(), true, 'flush writes now');
    var seen = states.map(function (s) { return s.state; });
    T.same(seen, ['pending', 'saving', 'saved'], 'pending, saving, saved');
    T.eq(typeof states[2].at, 'number', 'saved, with the time');
    T.ok(!auto.pending(), 'and nothing is pending any more');
    T.same(storage.saveState().state, 'saved', 'saveState() tells a late listener');
    reopen();
    T.eq((await storage.load()).projects[0].maps[0].text, '# Persistent\n\n- written on its own\n', 'and reopening finds it');
    store.init(await storage.load());

    states.length = 0;
    store.setMapText(p.id, m.id, '# Persistent\n\n- a\n');
    await T.until(function () { return lastState() === 'saved'; }, 2000, 'the save after the delay');
    T.eq(storage.pending(), false, 'written a moment after the change, without a flush');
  });

  T.test('init does not rewrite every project', async function () {
    reopen();
    store.init(await storage.load());
    var puts = [];
    var put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { puts.push(this.name + ':' + (value && value.id ? value.id : key)); return put.apply(this, arguments); };
    try {
      await storage.flush();
      T.same(puts, [], 'what was just read is not written back');
      var other = store.createProject({ name: 'New' });
      await storage.flush();
      T.same(puts, ['projects:' + other.id, 'kv:workspace'], 'the first change writes only the project it made');
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    store.deleteProject(other.id);
    await storage.flush();
  });

  T.test('a long run of changes is still saved now and then', async function () {
    storage.useDatabase(DB);
    var store2 = Object.create(store);
    var listeners = [];
    store2.subscribe = function (fn) { listeners.push(fn); return function () {}; };
    store2.ui = function () { return store.ui(); };
    var written = [];
    states.length = 0;
    /* a second watcher on a stand-in store, with a short delay and max wait */
    var probe = storage.autosave(store2, { delay: 200, maxWait: 300, onStatus: function (s) { if (s === 'saved') written.push(Date.now()); } });
    var start = Date.now();
    while (Date.now() - start < 700) {
      listeners.forEach(function (fn) { fn({ type: 'map:text' }); });
      await T.sleep(40);
    }
    T.ok(written.length >= 1, 'saved during the typing, not only after it (max wait)');
    await probe.flush();
    T.ok(storage.autosave(store) !== probe, 'watching the real store again replaces the stand-in');
  });

  T.test('read-only: a second tab writes nothing', async function () {
    storage.useDatabase(DB);
    auto = storage.autosave(store);
    states.length = 0;
    storage.setReadOnly(true);
    T.eq(storage.readOnly(), true, 'read-only on');
    T.eq(storage.saveState().state, 'idle', 'the save state is idle (nothing to save here)');
    var puts = 0;
    var put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { puts++; return put.apply(this, arguments); };
    try {
      var copy = store.createProject({ name: 'Should not be saved' });
      T.eq(auto.pending(), false, 'a change schedules nothing');
      T.eq(await storage.save(store.state, store.ui(), store.mapViews()), false, 'save() is a no-op');
      T.eq(await storage.flush(), false, 'flush too');
      T.eq(await storage.collect(store.projects(), 0), 0, 'and garbage is left for the tab that holds the data');
      T.eq(puts, 0, 'nothing was written');
      store.deleteProject(copy.id);
    } finally {
      IDBObjectStore.prototype.put = put;
      storage.setReadOnly(false);
    }
    store.clearHistory();
    T.eq(await storage.save(store.state, store.ui(), store.mapViews()), true, 'writable again');
  });

  T.test('a failed write says failed, not saved', async function () {
    states.length = 0;
    var put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('no room', 'QuotaExceededError'); };
    try {
      store.setMapText(p.id, m.id, '# Persistent\n\n- quota\n');
      T.eq(await storage.flush(), false, 'flush says it did not save');
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    T.eq(lastState(), 'failed', 'the bus says failed');
    T.eq(states[states.length - 1].error.name, 'QuotaExceededError', 'with the reason');
    store.setMapText(p.id, m.id, '# Persistent\n\n- resumed\n');
    T.eq(await storage.flush(), true, 'the next write goes through');
    T.eq(lastState(), 'saved', 'and the bus says saved again');
  });

  T.test('a database a newer MindRoot upgraded', async function () {
    var name = 'mindroot2-test-newer';
    await D.deleteDB(name);
    await new Promise(function (resolve) {
      var r = indexedDB.open(name, 2);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { r.result.close(); resolve(); };
    });
    states.length = 0;
    storage.useDatabase(name);
    var got = await storage.load();
    T.eq(got.fresh, true, 'nothing can be read');
    T.eq(storage.available(), false, 'the storage is not usable');
    T.eq(lastState(), 'memory', 'and the bus says memory, not saved');
    storage.useDatabase(DB);
    await D.deleteDB(name);
  });

  T.test('another tab deleting the database is not blocked by this one', async function () {
    storage.useDatabase(DB);
    await storage.load();
    var blocked = false;
    await new Promise(function (resolve) {
      var r = indexedDB.deleteDatabase(DB);
      r.onblocked = function () { blocked = true; };
      r.onsuccess = r.onerror = function () { resolve(); };
    });
    T.eq(blocked, false, 'the connection stepped aside');
    var after = await storage.load();
    T.eq(after.fresh, true, 'and the next request opens the database again');
    T.ok(storage.available(), 'still usable');
  });

  T.test('a database deleted under a running tab is written whole again', async function () {
    var banners = [];
    ns.ui = { banner: function (id, opts) { banners.push({ id: id, text: opts.text }); }, clearBanner: function () {} };
    try {
      var kept = JSON.parse(JSON.stringify({ projects: store.projects() }));
      reopen();
      await storage.load();
      store.init(kept);
      auto = storage.autosave(store);
      store.createProject({ name: 'Two' });
      store.createProject({ name: 'Three' });
      T.eq(await storage.flush(), true, 'three projects or more, saved');
      var count = store.projects().length;
      T.ok(count >= 3, 'there are ' + count);
      await new Promise(function (resolve) {
        var r = indexedDB.deleteDatabase(DB);
        r.onsuccess = r.onerror = r.onblocked = function () { resolve(); };
      });
      states.length = 0;
      store.setMapText(p.id, m.id, '# Persistent\n\n- after the deletion\n');
      T.eq(await storage.flush(), true, 'the next save goes through');
      T.eq(lastState(), 'saved', 'and says saved');
      T.ok(/deleted what it kept for MindRoot/.test((banners.filter(function (b) { return b.id === 'storage'; }).pop() || {}).text || ''), 'a banner says what happened');
      reopen();
      var back = await storage.load();
      T.eq(back.projects.length, count, 'every project is in the database again, not only the one edited');
      T.eq(back.projects.filter(function (x) { return x.id === p.id; })[0].maps[0].text, '# Persistent\n\n- after the deletion\n', 'with the edit');
      T.eq(back.fresh, false, 'and the meta');

      /* Deleted again, and this time noticed by a read, with no change to
       * save: the workspace is written again by itself. */
      store.init(back);
      await new Promise(function (resolve) {
        var r = indexedDB.deleteDatabase(DB);
        r.onsuccess = r.onerror = r.onblocked = function () { resolve(); };
      });
      states.length = 0;
      T.eq(await storage.getBlob('nothing-here'), null, 'a read opens the database again');
      await T.until(function () { return lastState() === 'saved'; }, 3000, 'and a save follows by itself');
      reopen();
      T.eq((await storage.load()).projects.length, count, 'with every project');
    } finally {
      delete ns.ui;
    }
    store.init(await storage.load());
  });

  T.test('"saved" only when nothing is left to write', async function () {
    reopen();
    store.init(await storage.load());
    auto = storage.autosave(store);
    states.length = 0;
    store.setMapText(p.id, m.id, '# Persistent\n\n- one\n');
    var writing = storage.flush();
    store.setMapText(p.id, m.id, '# Persistent\n\n- one and two\n');
    await writing;
    T.same(states.map(function (x) { return x.state; }), ['pending', 'saving', 'pending'], 'a change during the write keeps the state pending');
    T.ok(storage.pending(), 'something is still to write');
    T.eq(await storage.flush(), true, 'written');
    T.eq(lastState(), 'saved', 'and now saved');
  });

  function holdOpen(name) {
    return new Promise(function (resolve) {
      var r = indexedDB.open(name, 1);
      r.onupgradeneeded = function () {
        r.result.createObjectStore('kv');
        r.result.createObjectStore('projects', { keyPath: 'id' });
        r.result.createObjectStore('blobs', { keyPath: 'id' });
      };
      /* A connection that does not step aside (a frozen tab). */
      r.onsuccess = function () { resolve(r.result); };
    });
  }

  T.test('an open queued behind a blocked upgrade gives up, and the tab works in memory', async function () {
    var name = 'mindroot2-test-queued';
    var banners = [];
    ns.ui = { banner: function (id, opts) { banners.push({ id: id, text: opts.text }); }, clearBanner: function () {} };
    try {
      await D.deleteDB(name);
      var holder = await holdOpen(name);
      var blocked = false;
      var upgrade = indexedDB.open(name, 2);
      upgrade.onblocked = function () { blocked = true; };
      upgrade.onsuccess = function () { upgrade.result.close(); };
      upgrade.onerror = function (e) { e.preventDefault(); };
      await T.until(function () { return blocked; }, 3000, 'the upgrade is blocked');
      states.length = 0;
      storage.useDatabase(name, { blockedWait: 300 });
      var t0 = Date.now();
      var opened = await storage.open({ autosave: false, collect: false });
      T.ok(Date.now() - t0 < 3000, 'open() answers, it does not hang');
      T.eq(opened.fresh, true, 'with an empty workspace');
      T.eq(storage.available(), false, 'in memory');
      T.eq(lastState(), 'memory', 'the bus says memory');
      T.ok(/holding the storage/.test((banners.filter(function (b) { return b.id === 'storage'; }).pop() || {}).text || ''), 'and a banner says why');
      var done = new Promise(function (resolve) { upgrade.addEventListener('success', resolve); upgrade.addEventListener('error', resolve); });
      holder.close();
      await done;
    } finally {
      delete ns.ui;
    }
    storage.useDatabase(DB);
    await D.deleteDB(name);
  });

  T.test('a database that opens after the tab gave up asks for a reload', async function () {
    var name = 'mindroot2-test-late';
    var banners = [];
    ns.ui = { banner: function (id, opts) { banners.push({ id: id, text: opts.text }); }, clearBanner: function () {} };
    try {
      await D.deleteDB(name);
      var holder = await holdOpen(name);
      var blocked = false;
      var del = indexedDB.deleteDatabase(name);
      del.onblocked = function () { blocked = true; };
      await T.until(function () { return blocked; }, 3000, 'the delete is blocked');
      storage.useDatabase(name, { blockedWait: 300 });
      await storage.load();
      T.eq(storage.available(), false, 'given up on: memory');
      holder.close();
      await T.until(function () {
        return banners.some(function (b) { return b.id === 'storage' && /free again/.test(b.text); });
      }, 5000, 'once it opens');
      T.eq(banners.filter(function (b) { return /free again/.test(b.text); }).length, 1, 'the banner asks for a reload rather than adopting the database half-way');
      T.eq(storage.available(), false, 'and the session stays in memory until then');
    } finally {
      delete ns.ui;
    }
    storage.useDatabase(DB);
    await D.deleteDB(name);
    T.ok((await D.listDBs()).indexOf(name) < 0, 'cleaned up');
  });

  T.test('without IndexedDB: memory, said honestly', async function () {
    var desc = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: function () { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    try {
      states.length = 0;
      storage.useDatabase('mindroot2-test-memory');
      var got = await storage.load();
      T.eq(got.fresh, true, 'an empty workspace');
      T.eq(storage.available(), false, 'not available');
      T.eq(lastState(), 'memory', 'the bus says memory');
      var r = await storage.putBlob(new Blob(['in memory']), 'm.txt');
      T.eq(await storage.blobText(r.asset), 'in memory', 'bytes still work for the session');
      T.eq(await storage.save(store.state, store.ui()), false, 'save says it kept nothing');
      store.setMapText(p.id, m.id, '# Persistent\n\n- in memory\n');
      T.eq(await storage.flush(), false, 'flush too');
      T.ok(states.every(function (s) { return s.state !== 'saved'; }), 'and "saved" is never said');
      T.eq(await storage.collect([], 0), 1, 'memory bytes nothing names are let go');
      var opened = await storage.open({ autosave: false, collect: false });
      T.eq(opened.fresh, true, 'open() in memory: fresh');
    } finally {
      if (desc) Object.defineProperty(window, 'indexedDB', desc); else delete window.indexedDB;
    }
    storage.useDatabase(DB);
    T.ok(!!window.indexedDB, 'IndexedDB back for the rest');
  });

  T.test('open(): the app\'s way in', async function () {
    await D.deleteDB('mindroot2-test-open');
    storage.useDatabase('mindroot2-test-open');
    var opened = await storage.open({ collect: false });
    T.eq(opened.fresh, true, 'a fresh database is fresh');
    T.same(opened.data.projects, [], 'and nothing in it');
    store.init(opened.data);
    var q = store.createProject({ name: 'Seed' });
    store.clearHistory();
    await storage.flush();
    storage.useDatabase('mindroot2-test-open');
    var again = await storage.open({ collect: false });
    T.eq(again.fresh, false, 'once something was saved it is not fresh');
    T.eq(again.data.projects[0].id, q.id, 'and its data is there');
    T.ok(Array.isArray(again.data.projects) && 'ui' in again.data && 'views' in again.data, '{ data: { projects, ui, views } }');
    storage.useDatabase(DB);
    await D.deleteDB('mindroot2-test-open');
  });

  T.test('the browser\'s promises about the data', async function () {
    var e = await storage.estimate();
    T.ok(typeof e.usage === 'number' && typeof e.quota === 'number', 'usage and quota');
    T.eq(typeof e.persisted, 'boolean', 'and whether it is persistent');
    var asked = await storage.persist();
    T.eq(typeof asked, 'boolean', 'persist() answers yes or no (from file:// it only asks)');
  });

  T.test('the strings, in both languages', function () {
    var I = ns.i18n;
    var en = I.keys('en').filter(function (k) { return /^(storage|zip)\./.test(k); });
    var it = I.keys('it').filter(function (k) { return /^(storage|zip)\./.test(k); });
    T.same(en.filter(function (k) { return it.indexOf(k) < 0; }), [], 'none in English only');
    T.same(it.filter(function (k) { return en.indexOf(k) < 0; }), [], 'none in Italian only');
    I.init('it');
    var texts = it.map(function (k) { return I.t(k); });
    I.init('en');
    texts = texts.concat(en.map(function (k) { return I.t(k); }));
    T.same(texts.filter(function (s) { return /!|—/.test(s); }), [], 'no exclamation marks, no em-dashes');
  });

  T.test('clean up', async function () {
    storage.useDatabase('mindroot2-test-elsewhere');
    await D.deleteDB(DB);
    T.ok((await D.listDBs()).indexOf(DB) < 0, 'the test database is gone');
  });
})();
