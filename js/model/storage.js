/* MindRoot - where the workspace is kept: IndexedDB, automatic saving, and
 * the bytes of every file.
 *
 * No folder to pick and no permission to grant: the database 'mindroot2'
 * (tests: ?db=<name>) works in every browser, file:// included. Every
 * file:// page of a Chromium profile shares one origin with other apps,
 * hence the name.
 *
 * Three object stores. `projects` holds one record per project, everything
 * the store knows about it with files as references. `blobs` holds the
 * bytes, one immutable record per content: the id is a hash of the bytes and
 * their type, so the same picture added twice, or arriving twice in one
 * import, is stored once, and a drawing saved again is a new record (undo can
 * go back to the old one). `kv` holds the workspace meta (order of the
 * projects, which project and map are open), the map views (folds, camera,
 * the legacy direction).
 *
 * Writing is automatic, a moment after each change (400 ms, at most 4 s
 * during continuous typing), and only the projects that changed are written:
 * the store never edits a project in place, so a project that is still the
 * same object as the one written last time has nothing new in it. The state
 * goes out on the bus ('save': idle, pending, saving, saved, failed, memory)
 * and "saved" is said only after IndexedDB said so: without a usable
 * database the app runs in memory, says so, and offers an export.
 *
 * Bytes nothing refers to any more - in the projects, their trash, or any
 * state the session's history can still go back to - are deleted a few
 * seconds after start, once a day old (room for another tab that has just
 * added a picture), and only by the tab that holds the data. A second tab of
 * the same database is read-only (features/tabs.js), and then save() is a
 * no-op.
 *
 * What goes wrong underneath is said, never papered over: a database
 * deleted while the tab runs (site data cleared) is written whole again,
 * with a banner; an open that hangs gives up into memory mode. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  var DB_VERSION = 1;
  var KV = 'kv';
  var PROJECTS = 'projects';
  var BLOBS = 'blobs';
  var KEY_META = 'workspace';
  var KEY_VIEWS = 'views';
  var DEFAULT_DB = 'mindroot2';
  var NAME_RE = /^[\w.-]{1,60}$/;
  var SAVE_DELAY = 400;
  var SAVE_MAX_WAIT = 4000;
  var GC_AGE = 24 * 60 * 60 * 1000;
  var GC_DELAY = 5000;
  var BLOCKED_WAIT = 8000;
  var DRAWING_EXT = '.ink.svg';
  var DRAWING_RE = /\.(?:excalidraw|ink)\.svg$/i;

  var STRINGS = {
    en: {
      'storage.memory': 'This browser keeps nothing for this page, perhaps because it is a private window. Export what you want to keep before closing it.',
      'storage.blocked': 'Another MindRoot tab is holding the storage, so this one keeps your changes in memory only. Close the other MindRoot tabs, then reload this one.',
      'storage.newer': 'A newer MindRoot has opened your maps in another tab. Reload this one to keep working.',
      'storage.late': 'The storage is free again. Reload this tab to keep your maps in the browser.',
      'storage.cleared': 'The browser deleted what it kept for MindRoot while this tab was open. Your maps are being saved again from this tab; pictures it has not shown may be missing. Export everything to keep a copy.',
      'storage.full': 'There is no room left for MindRoot in this browser, so the last changes are not saved. Export everything, then free some space.',
      'storage.exportAll': 'Export everything',
      'storage.reload': 'Reload',
      'storage.image': 'image',
      'storage.drawing': 'drawing'
    },
    it: {
      'storage.memory': 'Questo browser non conserva nulla per questa pagina, forse perché è una finestra privata. Esporta quello che vuoi tenere prima di chiuderla.',
      'storage.blocked': "Un'altra scheda di MindRoot sta occupando l'archivio, quindi questa tiene le modifiche solo in memoria. Chiudi le altre schede di MindRoot, poi ricarica questa.",
      'storage.newer': "Una versione più recente di MindRoot ha aperto le tue mappe in un'altra scheda. Ricarica questa per continuare.",
      'storage.late': "L'archivio è di nuovo libero. Ricarica questa scheda per conservare le mappe nel browser.",
      'storage.cleared': "Il browser ha cancellato quello che conservava per MindRoot mentre questa scheda era aperta. Le tue mappe vengono salvate di nuovo da questa scheda; le immagini che non ha mostrato potrebbero mancare. Esporta tutto per tenerne una copia.",
      'storage.full': "In questo browser non resta spazio per MindRoot, quindi le ultime modifiche non sono salvate. Esporta tutto, poi libera un po' di spazio.",
      'storage.exportAll': 'Esporta tutto',
      'storage.reload': 'Ricarica',
      'storage.image': 'immagine',
      'storage.drawing': 'disegno'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  function queryParam(name) {
    try {
      var value = new URLSearchParams(window.location.search).get(name);
      return value && NAME_RE.test(value) ? value : null;
    } catch (err) { return null; }
  }

  /* The tests open the page with `?db=<name>`, so that whatever they write
   * lands in a database of their own. */
  var askedDb = queryParam('db');
  var dbName = askedDb || DEFAULT_DB;

  var dbPromise = null;
  var usable = true;
  var failure = null;
  var readOnly = false;
  /* Without IndexedDB the bytes live here for the session. */
  var memoryBlobs = Object.create(null);
  var blobCache = Object.create(null);
  var urlCache = Object.create(null);

  /* What the last write left in the database, so the next one can skip
   * whatever is still the same object. */
  var lastSaved = Object.create(null);
  var lastMeta = '';
  var lastViews;
  /* Whether this session has had the database open (so one made again from
   * nothing was deleted meanwhile), and how many times that happened. */
  var hadDatabase = false;
  var generation = 0;
  var blockedWait = BLOCKED_WAIT;

  /* ---------- the database ---------- */

  function getIDB() {
    try { return window.indexedDB || null; } catch (err) { return null; }
  }

  function req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        reject(request.error || new Error('IndexedDB request failed'));
      };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        reject(tx.error || new Error('IndexedDB transaction failed'));
      };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  }

  function banner(id, opts) {
    try { if (ns.ui && typeof ns.ui.banner === 'function') ns.ui.banner(id, opts); } catch (err) { /* no shell: nothing to show */ }
  }

  function reloadPage() { window.location.reload(); }

  async function exportEverything() {
    if (!ns.archive) return null;
    return ns.archive.download(await ns.archive.workspaceZip());
  }

  /* The session goes on in memory, and says so - with the way out that
   * fits why. */
  function markUnusable(why) {
    usable = false;
    failure = why || 'absent';
    var reload = { label: t('storage.reload'), kind: 'primary', run: reloadPage };
    var save = { label: t('storage.exportAll'), kind: 'primary', run: exportEverything };
    if (failure === 'newer') banner('storage', { kind: 'warning', text: t('storage.newer'), actions: [reload] });
    else if (failure === 'blocked') banner('storage', { kind: 'warning', text: t('storage.blocked'), actions: [save, reload] });
    else banner('storage', { kind: 'warning', text: t('storage.memory'), actions: [save] });
    setState('memory');
  }

  /* Opened at version 1: the stores are made if missing. Another tab
   * upgrading the database (a newer MindRoot, or a test deleting it) makes
   * this connection step aside rather than block it; the next request opens
   * it again. An open that does not succeed in BLOCKED_WAIT - blocked by a
   * connection that will not step aside, or queued behind somebody else's
   * blocked upgrade or delete, which is never told it is blocked - is given
   * up on, and the session goes on in memory; if the database opens after
   * all, it is not adopted half-way through a session (what is in memory and
   * what is stored would disagree), the person is asked to reload instead.
   *
   * A database that has to be made again after this session already had it
   * was deleted under it (site data cleared, another tab, the developer
   * tools): what this session believed was written is not there any more,
   * so the next save writes everything again (see recreated()). */
  function openDB() {
    if (dbPromise) return dbPromise;
    var promise = new Promise(function (resolve) {
      var settled = false;
      var waiting = null;
      var remade = false;
      function done(db, why) {
        if (settled) {
          if (db) {
            db.close();
            banner('storage', { kind: 'info', text: t('storage.late'), actions: [{ label: t('storage.reload'), kind: 'primary', run: reloadPage }] });
          }
          return;
        }
        settled = true;
        clearTimeout(waiting);
        if (!db) markUnusable(why);
        resolve(db);
      }
      var idb = getIDB();
      if (!idb) { done(null, 'absent'); return; }
      var request;
      try { request = idb.open(dbName, DB_VERSION); } catch (err) { done(null, 'absent'); return; }
      waiting = setTimeout(function () { done(null, 'blocked'); }, blockedWait);
      request.onupgradeneeded = function (event) {
        var db = request.result;
        if (event && event.oldVersion === 0 && hadDatabase) remade = true;
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' });
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () {
          db.close();
          if (dbPromise === promise) dbPromise = null;
        };
        db.onclose = function () { if (dbPromise === promise) dbPromise = null; };
        if (!settled) {
          hadDatabase = true;
          if (remade) recreated(db);
        }
        done(db);
      };
      request.onerror = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        done(null, request.error && request.error.name === 'VersionError' ? 'newer' : 'absent');
      };
    });
    dbPromise = promise;
    return promise;
  }

  /* The database was deleted and made again empty under a running session.
   * Nothing written before is there: the next save writes every project,
   * the meta and the views again (and a save already under way notices,
   * by the generation, and goes round once more). The bytes went with it;
   * those this session still holds are put back, and the person is told,
   * with the way to keep a copy of the rest. A read-only tab writes
   * nothing: the tab holding the data sees the same and does all this. */
  function recreated(db) {
    generation++;
    lastSaved = Object.create(null);
    lastMeta = '';
    lastViews = undefined;
    if (readOnly) return;
    var keep = [];
    Object.keys(memoryBlobs).forEach(function (id) { keep.push(memoryBlobs[id]); });
    Object.keys(blobCache).forEach(function (id) {
      if (!memoryBlobs[id]) keep.push({ id: id, blob: blobCache[id], type: blobCache[id].type, size: blobCache[id].size, name: '', createdAt: Date.now() });
    });
    keep.forEach(function (record) {
      /* One transaction each: a set of bytes the browser cannot read back
       * any more (its file went with the database) fails alone. */
      readBack(record.blob).then(function (bytes) {
        if (!bytes) return;
        var tx = db.transaction([BLOBS], 'readwrite');
        tx.objectStore(BLOBS).put({ id: record.id, blob: new Blob([bytes], { type: record.type }), type: record.type, size: bytes.byteLength, name: record.name, createdAt: Date.now() });
        tx.onerror = function (event) { if (event && event.preventDefault) event.preventDefault(); };
      }).catch(function () { /* gone with the database */ });
    });
    var save = { label: t('storage.exportAll'), kind: 'primary', run: exportEverything };
    banner('storage', { kind: 'warning', text: t('storage.cleared'), actions: [save] });
    if (auto) auto.api.again();
  }

  function readBack(blob) {
    return blob.arrayBuffer().then(function (buffer) { return buffer; }, function () { return null; });
  }

  /* A transaction on the open database, opened again once if the
   * connection went away in between (another tab upgraded or deleted it). */
  async function transact(stores, mode) {
    var db = await openDB();
    if (!db) return null;
    try {
      return db.transaction(stores, mode);
    } catch (err) {
      if (!err || err.name !== 'InvalidStateError') throw err;
      dbPromise = null;
      db = await openDB();
      return db ? db.transaction(stores, mode) : null;
    }
  }

  /* A write, all or nothing: if filling the transaction throws (a record
   * the browser cannot clone), it is aborted rather than left to commit
   * half of what it was given. Resolves false when there is no database. */
  async function write(stores, fill) {
    var tx = await transact(stores, 'readwrite');
    if (!tx) return false;
    var done = txDone(tx);
    try {
      fill(tx);
    } catch (err) {
      done.catch(function () { /* the abort below is the answer */ });
      try { tx.abort(); } catch (abortErr) { /* already finished */ }
      throw err;
    }
    /* Nothing more goes in: committed now, not when this page's event loop
     * next turns - a write started as the page unloads gets no next turn. */
    if (typeof tx.commit === 'function') {
      try { tx.commit(); } catch (commitErr) { /* already committing */ }
    }
    await done;
    return true;
  }

  function available() { return usable; }

  function databaseName() { return dbName; }

  /* Only for the tests: point the next open at another database, as a
   * reload would find it. options.blockedWait shortens the wait for a
   * blocked open. */
  function useDatabase(name, options) {
    var old = dbPromise;
    if (old) old.then(function (db) { if (db) db.close(); });
    dbPromise = null;
    usable = true;
    failure = null;
    dbName = name;
    hadDatabase = false;
    blockedWait = options && options.blockedWait > 0 ? options.blockedWait : BLOCKED_WAIT;
    lastSaved = Object.create(null);
    lastMeta = '';
    lastViews = undefined;
    saveState = { state: 'idle', at: null };
    forgetBytes();
  }

  /* ---------- the save state ---------- */

  var saveState = { state: 'idle', at: null };

  function setState(state, error) {
    var at = state === 'saved' ? Date.now() : saveState.at;
    if (state === saveState.state && state !== 'saved') return;
    saveState = { state: state, at: at };
    var detail = { state: state, at: at };
    if (error) detail.error = error;
    try { if (ns.bus) ns.bus.emit('save', detail); } catch (err) { /* nobody listening */ }
  }

  function currentState() { return { state: saveState.state, at: saveState.at }; }

  /* ---------- the workspace ---------- */

  function metaKey(order, ui) { return JSON.stringify({ order: order, ui: ui || null }); }

  /* { projects, ui, views, fresh } - fresh when nothing was ever written,
   * which is what tells the app this is the first time it opens here. */
  async function load() {
    var tx = await transact([KV, PROJECTS], 'readonly');
    if (!tx) return { projects: [], ui: null, views: null, fresh: true };
    var kv = tx.objectStore(KV);
    var got = await Promise.all([req(kv.get(KEY_META)), req(kv.get(KEY_VIEWS)), req(tx.objectStore(PROJECTS).getAll())]);
    var meta = got[0];
    var byId = Object.create(null);
    (got[2] || []).forEach(function (p) { if (p && p.id) byId[p.id] = p; });
    var order = meta && Array.isArray(meta.order) ? meta.order : [];
    var projects = [];
    order.forEach(function (id) {
      if (byId[id]) { projects.push(byId[id]); delete byId[id]; }
    });
    /* A project with no place in the order - a write that landed while the
     * order did not - is kept, at the end, rather than lost. */
    Object.keys(byId).forEach(function (id) { projects.push(byId[id]); });
    lastSaved = Object.create(null);
    projects.forEach(function (p) { lastSaved[p.id] = p; });
    lastMeta = meta ? metaKey(order, meta.ui) : '';
    lastViews = got[1] || undefined;
    return { projects: projects, ui: meta ? meta.ui || null : null, views: got[1] || null, fresh: !meta };
  }

  function pruneViews(views, present) {
    var out = {};
    Object.keys(views || {}).forEach(function (pid) { if (present[pid]) out[pid] = views[pid]; });
    return out;
  }

  /* Writes what changed since the last write, in one transaction. The store
   * hands over its own objects: they are never changed in place, so they can
   * be kept here as they are and compared by identity next time. Resolves
   * true once written (or when there was nothing to write), false when
   * nothing can be written (memory mode, read-only tab). */
  async function save(state, ui, views) {
    if (readOnly || !state) return false;
    if (!(await openDB())) return false;
    var gen = generation;
    var list = state.projects || [];
    var present = Object.create(null);
    var ids = list.map(function (p) { present[p.id] = true; return p.id; });
    var key = metaKey(ids, ui);
    var changed = list.filter(function (p) { return lastSaved[p.id] !== p; });
    var gone = Object.keys(lastSaved).filter(function (id) { return !present[id]; });
    var viewsChanged = views !== undefined && views !== lastViews;
    if (!changed.length && !gone.length && key === lastMeta && !viewsChanged) return true;
    var written = await write([KV, PROJECTS], function (tx) {
      var store = tx.objectStore(PROJECTS);
      changed.forEach(function (p) { store.put(p); });
      gone.forEach(function (id) { store.delete(id); });
      var kv = tx.objectStore(KV);
      if (viewsChanged) kv.put(pruneViews(views, present), KEY_VIEWS);
      kv.put({ version: 1, order: ids, ui: ui || null, savedAt: Date.now() }, KEY_META);
    });
    if (!written) return false;
    /* The database was made again while this was being written: what was
     * compared against is gone, so everything is written again. */
    if (gen !== generation) return save(state, ui, views);
    changed.forEach(function (p) { lastSaved[p.id] = p; });
    gone.forEach(function (id) { delete lastSaved[id]; });
    lastMeta = key;
    if (viewsChanged) lastViews = views;
    return true;
  }

  /* After store.init() with what load() read: the store's objects are new
   * (normalized) but say what the database already holds, so they are
   * taken as written - opening the app must not rewrite every project. */
  function adopt(store) {
    var state = store.state;
    var ids = state.projects.map(function (p) { return p.id; });
    var known = Object.keys(lastSaved);
    if (ids.length !== known.length || ids.some(function (id) { return !lastSaved[id]; })) return false;
    state.projects.forEach(function (p) { lastSaved[p.id] = p; });
    lastMeta = metaKey(ids, store.ui());
    if (typeof store.mapViews === 'function') lastViews = store.mapViews();
    return true;
  }

  /* ---------- automatic saving ---------- */

  var auto = null;
  var lifecycle = false;

  /* The store watched and written a moment after each change; one watcher,
   * however many times this is called (a different store replaces the
   * one watched before). Returns { flush() -> Promise<bool>, pending() ->
   * bool, cancel(), again() }. */
  function autosave(store, options) {
    if (auto && auto.store === store) return auto.api;
    if (auto) { auto.api.cancel(); auto.unsubscribe(); }
    options = options || {};
    var delay = options.delay == null ? SAVE_DELAY : options.delay;
    var maxWait = options.maxWait == null ? SAVE_MAX_WAIT : options.maxWait;
    var timer = null;
    var running = null;
    var again = false;
    var since = 0;
    var status = options.onStatus || function () {};

    function views() { return typeof store.mapViews === 'function' ? store.mapViews() : undefined; }

    function run() {
      clearTimeout(timer);
      timer = null;
      if (running) { again = true; return running; }
      since = 0;
      if (readOnly) { setState('idle'); return Promise.resolve(false); }
      if (!usable) { setState('memory'); status('memory'); return Promise.resolve(false); }
      setState('saving');
      status('saving');
      running = save(store.state, store.ui(), views()).then(function (ok) {
        /* "Saved" only when nothing is left to write: changes made during
         * the write are still waiting (the timer, or `again`). */
        if (ok && (timer || again)) { setState('pending'); status('pending'); } else if (ok) { setState('saved'); status('saved'); } else if (!usable) { setState('memory'); status('memory'); } else if (!readOnly) { setState('failed'); status('error'); }
        return ok;
      }, function (err) {
        setState('failed', err);
        status('error', err);
        if (err && err.name === 'QuotaExceededError') {
          banner('storage-full', { kind: 'error', text: t('storage.full'), actions: [{ label: t('storage.exportAll'), kind: 'primary', run: exportEverything }] });
        }
        return false;
      }).then(function (ok) {
        running = null;
        if (again) { again = false; return run(); }
        return ok;
      });
      return running;
    }

    function schedule() {
      if (!since) since = Date.now();
      clearTimeout(timer);
      var wait = Math.max(0, Math.min(delay, since + maxWait - Date.now()));
      timer = setTimeout(run, wait);
      if (usable) { setState('pending'); status('pending'); } else setState('memory');
    }

    var unsubscribe = store.subscribe(function (change) {
      var type = change && change.type;
      if (type === 'history:changed' || type === 'readonly') return;
      if (type === 'init') { adopt(store); return; }
      if (readOnly) return;
      schedule();
    });

    var api = {
      /* urgent (the page is going away): a change that came in while a
       * write was under way is written at once, beside it, rather than
       * after it - a page being unloaded gets no turn after that write. */
      flush: function flush(urgent) {
        if (urgent && running && (timer || again) && !readOnly && usable) {
          clearTimeout(timer);
          timer = null;
          again = true;
          return save(store.state, store.ui(), views()).catch(function () { return false; });
        }
        if (timer || again) return run();
        return running || Promise.resolve(!readOnly && usable);
      },
      pending: function pending() { return !!timer || !!running || again; },
      /* Everything must be written again (the database was made again):
       * a write soon, as for a change - unless one is under way, which
       * notices by itself (save() checks the generation). */
      again: function writeAgain() { if (!readOnly && usable && !running) schedule(); },
      cancel: function cancel() { clearTimeout(timer); timer = null; again = false; since = 0; }
    };
    auto = { store: store, api: api, unsubscribe: typeof unsubscribe === 'function' ? unsubscribe : function () {} };
    if (!lifecycle) installLifecycle();
    return api;
  }

  /* Leaving the page writes now: a hidden tab may never come back (mobile
   * browsers rarely fire beforeunload), and closing with a write pending
   * asks the browser to hold on. */
  function installLifecycle() {
    lifecycle = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', function () { flush(true); });
    window.addEventListener('beforeunload', function (event) {
      if (!pending()) return;
      flush(true);
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function flush(urgent) { return auto ? auto.api.flush(urgent === true) : Promise.resolve(!readOnly && usable); }
  function pending() { return !!auto && auto.api.pending(); }

  /* Read-only: this tab does not hold the data (another tab does). Nothing
   * is written and nothing is collected until it holds it again. */
  function setReadOnly(flag) {
    readOnly = !!flag;
    if (readOnly) {
      if (auto) auto.api.cancel();
      setState('idle');
    }
    return readOnly;
  }

  function isReadOnly() { return readOnly; }

  /* ---------- opening ---------- */

  var collectTimer = null;

  /* The app's way in: { data: { projects, ui, views }, fresh }.
   * opts: { autosave: bool, collect: bool }. */
  async function open(opts) {
    opts = opts || {};
    var store = opts.store || ns.store;
    await openDB();
    var loaded = await load();
    if (store && opts.autosave !== false) autosave(store);
    if (usable) setState('idle'); else setState('memory');
    if (usable && opts.collect !== false) {
      clearTimeout(collectTimer);
      collectTimer = setTimeout(function () {
        if (readOnly || !usable || !store) return;
        var all = typeof store.retainedProjects === 'function' ? store.retainedProjects() : store.projects();
        collect(all).catch(function () { /* tried again at the next start */ });
      }, GC_DELAY);
    }
    return {
      data: { projects: loaded.projects, ui: loaded.ui, views: loaded.views },
      fresh: loaded.fresh
    };
  }

  /* ---------- the browser's promises about the data ---------- */

  /* Asks the browser not to evict the data under storage pressure. Served
   * over http(s) only, and after something the person did (Firefox asks). */
  async function persist() {
    var s = navigator.storage;
    if (!s || typeof s.persist !== 'function') return false;
    try {
      if (typeof s.persisted === 'function' && await s.persisted()) return true;
      if (!/^https?:$/.test(window.location.protocol)) return false;
      return !!(await s.persist());
    } catch (err) {
      return false;
    }
  }

  async function estimate() {
    var s = navigator.storage;
    var out = { usage: null, quota: null, persisted: false };
    try {
      if (s && typeof s.estimate === 'function') {
        var e = await s.estimate();
        out.usage = typeof e.usage === 'number' ? e.usage : null;
        out.quota = typeof e.quota === 'number' ? e.quota : null;
      }
    } catch (err) { /* unknown */ }
    try { if (s && typeof s.persisted === 'function') out.persisted = !!(await s.persisted()); } catch (err) { /* unknown */ }
    return out;
  }

  /* ---------- the bytes ---------- */

  var TYPES = {
    png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
    tif: 'image/tiff', tiff: 'image/tiff',
    md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json',
    mmd: 'text/plain', csv: 'text/csv', pdf: 'application/pdf', zip: 'application/zip'
  };
  var EXTS = {
    'image/png': '.png', 'image/apng': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
    'image/svg+xml': '.svg', 'image/avif': '.avif', 'image/bmp': '.bmp', 'image/x-icon': '.ico', 'image/tiff': '.tif'
  };

  function typeOf(name, fallback) {
    var ext = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return (ext && TYPES[ext[1].toLowerCase()]) || fallback || 'application/octet-stream';
  }

  function fnv(text) {
    var h = 0x811C9DC5;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function randomId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* The id of a set of bytes is what they are: SHA-256 of the bytes, plus
   * their type (the same bytes as a .svg and as a .txt are two records, so
   * a picture is never served as text). */
  async function contentId(blob, type) {
    if (!ns.util || typeof ns.util.sha256 !== 'function') return randomId();
    var hex = await ns.util.sha256(new Uint8Array(await blob.arrayBuffer()));
    return 'a' + hex.slice(0, 56) + fnv(type);
  }

  /* Bytes in, a reference out: { asset, type, size, modified }. `id` is only
   * given by callers that must keep one (none in the app: imports go by
   * content). Writing the record again for bytes already there renews its
   * date, so a picture brought back an hour after it became garbage is not
   * collected under the person's feet. */
  async function putBlob(data, name, id) {
    var type = (data && typeof data.type === 'string' && data.type) || typeOf(name);
    var blob = typeof Blob === 'function' && data instanceof Blob ? data : new Blob([data == null ? '' : data], { type: type });
    if (blob.type !== type) blob = new Blob([blob], { type: type });
    var asset = id || await contentId(blob, type);
    var record = { id: asset, blob: blob, type: type, size: blob.size, name: String(name || ''), createdAt: Date.now() };
    var written = usable && await write([BLOBS], function (tx) { tx.objectStore(BLOBS).put(record); });
    /* Not cached once stored: the copy read back from IndexedDB is backed
     * by the disk, this one by memory, and an import may put hundreds. */
    if (!written) memoryBlobs[asset] = record;
    return { asset: asset, type: type, size: blob.size, modified: Date.now() };
  }

  async function getBlob(id) {
    if (!id) return null;
    if (blobCache[id]) return blobCache[id];
    var record = memoryBlobs[id] || null;
    if (!record && usable) {
      var tx = await transact([BLOBS], 'readonly');
      if (tx) record = await req(tx.objectStore(BLOBS).get(id));
    }
    if (!record || !record.blob) return null;
    blobCache[id] = record.blob;
    return record.blob;
  }

  /* A blob URL per set of bytes, made once: the bytes behind an id never
   * change, so the URL never goes stale. */
  async function blobURL(id) {
    if (urlCache[id]) return urlCache[id];
    var blob = await getBlob(id);
    if (!blob) return null;
    if (!urlCache[id]) urlCache[id] = URL.createObjectURL(blob);
    return urlCache[id];
  }

  function readAs(blob, how) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader[how](blob);
    });
  }

  async function blobDataURL(id) {
    var blob = await getBlob(id);
    return blob ? await readAs(blob, 'readAsDataURL') : null;
  }

  async function blobText(id) {
    var blob = await getBlob(id);
    return blob ? new TextDecoder('utf-8').decode(new Uint8Array(await blob.arrayBuffer())) : null;
  }

  async function blobBytes(id) {
    var blob = await getBlob(id);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  function forget(id) {
    if (urlCache[id]) URL.revokeObjectURL(urlCache[id]);
    delete urlCache[id];
    delete blobCache[id];
    delete memoryBlobs[id];
  }

  function forgetBytes() {
    Object.keys(urlCache).forEach(function (id) { URL.revokeObjectURL(urlCache[id]); });
    urlCache = Object.create(null);
    blobCache = Object.create(null);
    memoryBlobs = Object.create(null);
  }

  /* Every set of bytes a list of projects still points at: its files, and
   * the files kept in its trash. (A copy names only files the project keeps:
   * deleting a branch or a map leaves those in place.) */
  function referencedAssets(projects) {
    var used = Object.create(null);
    function take(files) {
      Object.keys(files || {}).forEach(function (path) {
        if (files[path] && files[path].asset) used[files[path].asset] = true;
      });
    }
    (projects || []).forEach(function (p) {
      if (!p) return;
      take(p.files);
      (p.trash || []).forEach(function (e) {
        take(e.files);
        if (e.file && e.file.asset) used[e.file.asset] = true;
      });
    });
    return used;
  }

  /* Bytes nothing points at, older than `maxAge` (a day), deleted - with a
   * cursor, in one transaction that awaits nothing else. Pass every project
   * the session can still reach (store.retainedProjects()). */
  async function collect(projects, maxAge) {
    if (readOnly) return 0;
    var used = referencedAssets(projects);
    var limit = Date.now() - (maxAge == null ? GC_AGE : maxAge);
    if (!usable) {
      var dropped = 0;
      Object.keys(memoryBlobs).forEach(function (id) {
        if (!used[id] && memoryBlobs[id].createdAt <= limit) { forget(id); dropped++; }
      });
      return dropped;
    }
    var tx = await transact([BLOBS], 'readwrite');
    if (!tx) return 0;
    var gone = [];
    var request = tx.objectStore(BLOBS).openCursor();
    request.onsuccess = function () {
      var cursor = request.result;
      if (!cursor) return;
      var record = cursor.value;
      if (!used[cursor.key] && !(record && record.createdAt > limit)) {
        cursor.delete();
        gone.push(cursor.key);
      }
      cursor.continue();
    };
    await txDone(tx);
    gone.forEach(forget);
    return gone.length;
  }

  /* ---------- names ---------- */

  /* Unicode-aware: 'Città di Mélisande' -> 'citta-di-melisande', '東京 2024'
   * -> '東京-2024'; '' when nothing is left (callers pick their fallback). */
  function slugify(text) {
    if (ns.util && typeof ns.util.slugify === 'function') return ns.util.slugify(text, '');
    var s = String(text == null ? '' : text).normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase();
    s = s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    if (s.length > 60) s = Array.from(s).slice(0, 60).join('').replace(/-+$/g, '');
    return s;
  }

  /* A drawing is known by its double suffix and by nothing else, so its
   * name is not run through the slug a picture's is: the inner dot is the
   * marker. New drawings are '.ink.svg'; earlier '.excalidraw.svg'
   * are still drawings. */
  function drawingName(title) {
    return (slugify(title) || t('storage.drawing')) + DRAWING_EXT;
  }

  function isDrawingName(name) {
    return DRAWING_RE.test(String(name || ''));
  }

  /* ---------- the files of a project ---------- */

  /* A path as a map writes it, looked up in the project: as written, then
   * with the percent-escapes a Markdown editor may have put in it read back. */
  function refFor(store, pid, relPath) {
    var ref = store.fileRef(pid, relPath);
    if (ref) return ref;
    try {
      var decoded = decodeURI(String(relPath));
      if (decoded !== relPath) return store.fileRef(pid, decoded);
    } catch (err) { /* not escaped */ }
    return null;
  }

  /* A picture into `assets/`, under a clean name nothing in the project
   * uses yet ('My Photo.PNG' -> 'assets/my-photo.png', then my-photo-2.png).
   * A drawing file keeps its double suffix. Returns { path, ref }: the caller
   * writes it into the project in the same step that writes it into the map. */
  async function saveAsset(store, pid, file) {
    var name = String((file && file.name) || 'image.png');
    var drawing = DRAWING_RE.exec(name);
    var base;
    var ext;
    if (drawing) {
      base = slugify(name.slice(0, drawing.index)) || t('storage.drawing');
      ext = name.slice(drawing.index).toLowerCase();
    } else {
      var dot = name.lastIndexOf('.');
      ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
      if (!/^\.[a-z0-9]{1,8}$/.test(ext)) ext = EXTS[file && file.type] || '.png';
      base = slugify(dot > 0 ? name.slice(0, dot) : name) || t('storage.image');
    }
    var ref = await putBlob(file, base + ext);
    return { path: store.freePath(pid, 'assets/' + base + ext), ref: ref };
  }

  function uniqueDrawing(store, pid, title) {
    return store.freePath(pid, 'assets/' + drawingName(title));
  }

  async function readDrawing(store, pid, relPath) {
    var ref = refFor(store, pid, relPath);
    return ref ? await blobText(ref.asset) : null;
  }

  async function assetURL(store, pid, relPath) {
    var ref = refFor(store, pid, relPath);
    return ref ? await blobURL(ref.asset) : null;
  }

  async function assetDataURL(store, pid, relPath) {
    var ref = refFor(store, pid, relPath);
    return ref ? await blobDataURL(ref.asset) : null;
  }

  function compareNames(a, b) {
    if (ns.util && typeof ns.util.naturalCompare === 'function') return ns.util.naturalCompare(a, b);
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  /* Everything in `assets/`, drawings first, each saying whether a map of
   * the project still names it. */
  function listAssets(store, pid) {
    var p = store.project(pid);
    if (!p) return [];
    var used = store.usedByMaps(pid);
    var out = Object.keys(p.files).filter(function (path) { return /^assets\/[^/]+$/.test(path); }).map(function (path) {
      var ref = p.files[path];
      var file = path.slice('assets/'.length);
      return {
        file: file, path: path, kind: isDrawingName(file) ? 'drawing' : 'image',
        used: !!used[path], size: ref.size, when: ref.modified ? new Date(ref.modified) : null
      };
    });
    out.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'drawing' ? -1 : 1;
      return compareNames(a.file, b.file);
    });
    return out;
  }

  ns.storage = {
    open: open,
    available: available,
    useDatabase: useDatabase,
    databaseName: databaseName,
    load: load,
    save: save,
    autosave: autosave,
    flush: flush,
    pending: pending,
    saveState: currentState,
    setReadOnly: setReadOnly,
    readOnly: isReadOnly,
    persist: persist,
    estimate: estimate,
    putBlob: putBlob,
    getBlob: getBlob,
    blobURL: blobURL,
    blobDataURL: blobDataURL,
    blobText: blobText,
    blobBytes: blobBytes,
    typeOf: typeOf,
    referencedAssets: referencedAssets,
    collect: collect,
    slugify: slugify,
    drawingName: drawingName,
    isDrawingName: isDrawingName,
    saveAsset: saveAsset,
    uniqueDrawing: uniqueDrawing,
    readDrawing: readDrawing,
    assetURL: assetURL,
    assetDataURL: assetDataURL,
    listAssets: listAssets,
    refFor: refFor
  };
})(window.MindRoot);
