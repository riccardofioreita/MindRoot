/* MindRoot - the workspace: every project, map, file, copy and trash entry
 * as one immutable value, and one labelled history over all of it.
 *
 * A project is what a `.interneuron` folder holds - several maps, `assets/`,
 * `trash/`, `snapshots/`, `templates/` - kept in the browser instead of on
 * the disk, and written back out in exactly that shape when it is exported
 * (archive.js):
 *
 *     project  { id, name, description, isTemplate, createdAt, updatedAt,
 *                maps: [map], files: { path: file }, trash: [entry],
 *                snapshots: [copy] }
 *     map      { id, name, text, createdAt, updatedAt }
 *     file     { asset, type, size, modified }     the bytes live in storage.js
 *     copy     { id, mapId, when, kind: auto|manual, label, text }
 *     entry    { id, kind: branch|figure|asset|map|snapshot, deletedAt, label, ... }
 *
 * The value is never changed in place: every change makes a new one, sharing
 * whatever it did not touch. That one idea pays three times. A step of undo
 * is simply the value as it was (two steps apart share every map neither of
 * them changed); storage.js tells which projects need writing by asking
 * whether they are still the same object; and node counts are cached per map
 * object. An in-place mutation anywhere would silently break all three.
 *
 * One history covers everything: a node written, a branch binned, a map
 * deleted, a project made from a template are all steps, each with a label
 * (an i18n key, translated when it is shown, so a language switch relabels
 * the whole history). Transactions make several changes one step; changes
 * that carry the same key within a sliding 1.5 s are one step (typing in the
 * Markdown panel). Undo goes back to the project and map where the change
 * happened, and to the node that was selected; redo to where it landed.
 * Copies taken by the clock are written into every state the history holds,
 * so undoing never takes one away.
 *
 * A notebook (docs/NOTEBOOK.md) is a folder of files, 'assets/x.book/',
 * and a map names only its first page; to everything here that weighs files
 * - what a map or a branch takes to the trash, what is still used, what
 * goes back, what is copied with a branch - the folder is one thing: a
 * reference into it means every file in it, and a folder coming back into
 * a place another folder took moves whole to a free name.
 *
 * Outside the value, and outside the history: which project and map are open
 * (ui) and how each map is looked at (views: folds as lineage keys, camera,
 * the face shown, the canvas and cameras of its notebooks, and the old 'direction' a previous version kept, read only so the session
 * can write a 'both sides' map's sides into it once). Opening a map or folding a branch is not something to undo,
 * and undoing an edit must not unfold the map.
 *
 * A second tab of the same database is read-only (features/tabs.js): then
 * setReadOnly(true) makes every change a no-op that returns false, so the
 * tab that holds the data is the only one writing it. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  var VERSION = 1;
  var HISTORY_LIMIT = 300;
  var COALESCE_MS = 1500;
  var SNAPSHOT_KEEP = 24;
  var NAME_MAX = 120;
  var DESCRIPTION_MAX = 500;
  var COPY_LABEL_MAX = 300;
  var FOLDS_MAX = 5000;
  var TRASH_KINDS = { branch: true, figure: true, asset: true, map: true, snapshot: true, note: true };
  /* A drawing is known by its double suffix; numbering goes before both
   * halves of it ('kyc-2.ink.svg'), or the name stops being a drawing. */
  var DRAWING_RE = /\.(?:excalidraw|ink)\.svg$/i;
  /* A file directly inside a notebook folder: the folder is group 1. The
   * same rule notebook.js reads folders by. */
  var BOOK_FILE_RE = /^(.*\.book)\/[^/]+$/;
  var BOOK_JSON = 'book.json';

  /* ---------- strings ---------- */

  /* History labels are written in lower case: they are read inside a
   * sentence ("Undo: delete the branch"). */
  var STRINGS = {
    en: {
      'store.untitledProject': 'Untitled project',
      'store.untitledMap': 'Untitled map',
      'store.copySuffix': '(copy)',
      'store.restoredMap': 'Restored map',
      'store.restoredCopy': 'Restored copy',
      'store.copyOf': '{map} - copy',
      'store.someMap': 'map',
      'store.branch': 'branch',
      'store.label.change': 'change',
      'store.label.newProject': 'new project',
      'store.label.editProject': 'edit the project',
      'store.label.useTemplate': 'use as a template',
      'store.label.stopTemplate': 'stop using as a template',
      'store.label.duplicateProject': 'duplicate the project',
      'store.label.deleteProject': 'delete the project',
      'store.label.moveProject': 'move the project',
      'store.label.import': 'import',
      'store.label.importMap': 'import a map',
      'store.label.newMap': 'new map',
      'store.label.duplicateMap': 'duplicate the map',
      'store.label.renameMap': 'rename the map',
      'store.label.moveMap': 'move the map',
      'store.label.deleteMap': 'delete the map',
      'store.label.editMap': 'edit the map',
      'store.label.addFile': 'add a file',
      'store.label.takeCopy': 'take a copy',
      'store.label.deleteCopy': 'delete the copy',
      'store.label.deleteBranch': 'delete the branch',
      'store.label.takePictureOut': 'take the picture out',
      'store.label.deleteNote': 'delete the note',
      'store.label.trashFiles.one': 'send the file to the trash',
      'store.label.trashFiles.other': 'send {n} files to the trash',
      'store.label.trashNotebook': 'send the notebook to the trash',
      'store.label.restore.one': 'restore from the trash',
      'store.label.restore.other': 'restore {n} from the trash',
      'store.label.purge.one': 'delete for good',
      'store.label.purge.other': 'delete {n} for good',
      'store.label.emptyTrash': 'empty the trash',
      'store.label.importBranches.one': 'import a branch',
      'store.label.importBranches.other': 'import {n} branches',
      'store.label.splitBranches.one': 'turn a branch into a map',
      'store.label.splitBranches.other': 'turn {n} branches into maps',
      'store.splitFrom': 'From [[{map}]]'
    },
    it: {
      'store.untitledProject': 'Progetto senza titolo',
      'store.untitledMap': 'Mappa senza titolo',
      'store.copySuffix': '(copia)',
      'store.restoredMap': 'Mappa ripristinata',
      'store.restoredCopy': 'Copia ripristinata',
      'store.copyOf': '{map} - copia',
      'store.someMap': 'mappa',
      'store.branch': 'ramo',
      'store.label.change': 'modifica',
      'store.label.newProject': 'nuovo progetto',
      'store.label.editProject': 'modifica il progetto',
      'store.label.useTemplate': 'usa come modello',
      'store.label.stopTemplate': 'smetti di usare come modello',
      'store.label.duplicateProject': 'duplica il progetto',
      'store.label.deleteProject': 'elimina il progetto',
      'store.label.moveProject': 'sposta il progetto',
      'store.label.import': 'importa',
      'store.label.importMap': 'importa una mappa',
      'store.label.newMap': 'nuova mappa',
      'store.label.duplicateMap': 'duplica la mappa',
      'store.label.renameMap': 'rinomina la mappa',
      'store.label.moveMap': 'sposta la mappa',
      'store.label.deleteMap': 'elimina la mappa',
      'store.label.editMap': 'modifica la mappa',
      'store.label.addFile': 'aggiungi un file',
      'store.label.takeCopy': 'fai una copia',
      'store.label.deleteCopy': 'elimina la copia',
      'store.label.deleteBranch': 'elimina il ramo',
      'store.label.takePictureOut': "togli l'immagine",
      'store.label.deleteNote': 'elimina la nota',
      'store.label.trashFiles.one': 'manda il file nel cestino',
      'store.label.trashFiles.other': 'manda {n} file nel cestino',
      'store.label.trashNotebook': 'manda il quaderno nel cestino',
      'store.label.restore.one': 'ripristina dal cestino',
      'store.label.restore.other': 'ripristina {n} elementi dal cestino',
      'store.label.purge.one': 'elimina per sempre',
      'store.label.purge.other': 'elimina per sempre {n} elementi',
      'store.label.emptyTrash': 'svuota il cestino',
      'store.label.importBranches.one': 'importa un ramo',
      'store.label.importBranches.other': 'importa {n} rami',
      'store.label.splitBranches.one': 'trasforma un ramo in mappa',
      'store.label.splitBranches.other': 'trasforma {n} rami in mappe',
      'store.splitFrom': 'Da [[{map}]]'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function fill(text, vars) {
    return !vars ? text : String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] != null ? String(vars[name]) : whole;
    });
  }

  /* English from this file when i18n.js is not loaded (unit pages that test
   * the model alone): a project must never be called 'store.untitledProject'. */
  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return fill(STRINGS.en[key] != null ? STRINGS.en[key] : key, vars);
  }

  /* A label is an i18n key ('store.label.newMap', or another module's own
   * 'editor.addChild'), a counted key { key, n }, or - from a caller that has
   * no key - words, which are shown as they are. */
  var KEY_RE = /^[a-z][\w-]*(\.[\w-]+)+$/i;
  function labelText(label) {
    if (label == null || label === '') label = 'store.label.change';
    if (typeof label === 'object') {
      var n = typeof label.n === 'number' ? label.n : null;
      if (n === null) return t(label.key, label.vars);
      if (ns.i18n && typeof ns.i18n.plural === 'function') return ns.i18n.plural(label.key, n, label.vars);
      return t(label.key + (n === 1 ? '.one' : '.other'), assign({ n: n }, label.vars));
    }
    label = String(label);
    return KEY_RE.test(label) ? t(label) : label;
  }

  function counted(key, n) { return { key: key, n: n }; }

  /* ---------- small things ---------- */

  function now() { return Date.now(); }

  var counter = 0;
  function uid(prefix) {
    if (ns.util && typeof ns.util.uid === 'function') return ns.util.uid(prefix);
    counter = (counter + 1) % 46656;
    return prefix + now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (!source) continue;
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
      }
    }
    return target;
  }

  function cleanName(text, fallback) {
    var out = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (out.length > NAME_MAX) out = Array.from(out).slice(0, NAME_MAX).join('').trim();
    return out || fallback || '';
  }

  function cleanText(text, max) {
    var out = String(text == null ? '' : text).trim();
    return out.length > max ? Array.from(out).slice(0, max).join('').trim() : out;
  }

  function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function normalizeText(text) {
    return ns.doc ? ns.doc.normalizeText(text) : String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  }

  function emptyDocument(name) { return ns.doc.emptyDocument(name); }

  /* A path inside the project folder: forward slashes, no `.` segments, no
   * doubled slashes, and nothing that climbs out of the folder, names a
   * folder rather than a file (a trailing slash), or points somewhere else
   * entirely (a drive, a URL). The rules are the ZIP writer's (zip.safeName),
   * so every path the store keeps can be written into a backup. What does
   * not pass is null. */
  function cleanPath(path) {
    var raw = String(path == null ? '' : path).replace(/\\/g, '/');
    if (!raw || /\0/.test(raw) || /\/$/.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    var parts = raw.replace(/^\/+/, '').split('/');
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') return null;
      if (parts[i] === '.' || parts[i] === '') continue;
      kept.push(parts[i]);
    }
    return kept.length ? kept.join('/') : null;
  }

  /* The keys of project.files a reference written in a map can mean: the
   * path cleaned ('./assets/x.png' is 'assets/x.png'), and the same with the
   * percent-escapes a Markdown editor puts in read back ('a%20b.png'). Every
   * question "does anything still use this file" asks it through here, so
   * two spellings of one picture are one picture. */
  function refKeys(ref) {
    var out = [];
    var clean = cleanPath(ref);
    if (clean) out.push(clean);
    try {
      var decoded = cleanPath(decodeURI(String(ref)));
      if (decoded && out.indexOf(decoded) < 0) out.push(decoded);
    } catch (err) { /* a lone '%': not escaped */ }
    return out;
  }

  /* The same name with a number in it: before the extension, before both
   * halves of a drawing's double suffix, or at the end when there is none. */
  function numberedPath(path, n) {
    var drawing = DRAWING_RE.exec(path);
    if (drawing) return path.slice(0, drawing.index) + '-' + n + path.slice(drawing.index);
    var slash = path.lastIndexOf('/');
    var dot = path.lastIndexOf('.');
    if (dot <= slash + 1) return path + '-' + n;
    return path.slice(0, dot) + '-' + n + path.slice(dot);
  }

  function freePathIn(files, path) {
    if (!files[path]) return path;
    var n = 2;
    while (files[numberedPath(path, n)]) n++;
    return numberedPath(path, n);
  }

  /* The notebook folder a path is directly in ('assets/x.book'), or null. */
  function bookOf(path) {
    var m = BOOK_FILE_RE.exec(String(path || ''));
    return m ? m[1] : null;
  }

  /* Every file of `files` in that folder, as { path: file }. */
  function folderIn(files, folder) {
    var out = {};
    var prefix = folder + '/';
    Object.keys(files).forEach(function (path) {
      if (path.indexOf(prefix) === 0 && path.indexOf('/', prefix.length) < 0) out[path] = files[path];
    });
    return out;
  }

  /* `picked` ({ path: file }) with every other file of each notebook folder
   * one of them is in, from the project's files: a notebook goes and comes
   * back whole. */
  function withBooks(projectFiles, picked) {
    var out = assign({}, picked);
    var done = Object.create(null);
    Object.keys(picked).forEach(function (path) {
      var folder = bookOf(path);
      if (!folder || done[folder]) return;
      done[folder] = true;
      assign(out, folderIn(projectFiles, folder));
    });
    return out;
  }

  /* A folder name no file of `files` is in: 'assets/x-2.book', '-3', ... */
  function freeFolderIn(files, folder) {
    var base = folder.replace(/\.book$/, '');
    var taken = function (name) {
      var prefix = name + '/';
      return Object.keys(files).some(function (path) { return path.indexOf(prefix) === 0; });
    };
    if (!taken(folder)) return folder;
    var n = 2;
    while (taken(base + '-' + n + '.book')) n++;
    return base + '-' + n + '.book';
  }

  /* ---------- the shapes, made and checked ---------- */

  function makeProject(name, description) {
    var at = now();
    return {
      id: uid('p'), name: cleanName(name, t('store.untitledProject')), description: cleanText(description, DESCRIPTION_MAX),
      isTemplate: false, createdAt: at, updatedAt: at,
      maps: [], files: {}, trash: [], snapshots: []
    };
  }

  function makeMap(name, text) {
    var at = now();
    var clean = cleanName(name, t('store.untitledMap'));
    return {
      id: uid('m'), name: clean,
      text: normalizeText(text == null ? emptyDocument(clean) : text),
      createdAt: at, updatedAt: at
    };
  }

  function normalizeRef(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.asset !== 'string' || !raw.asset) return null;
    return {
      asset: raw.asset,
      type: String(raw.type || ''),
      size: num(raw.size, 0),
      modified: num(raw.modified, 0)
    };
  }

  function normalizeFiles(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var path = cleanPath(key);
      var ref = normalizeRef(raw[key]);
      if (path && ref) out[path] = ref;
    });
    return out;
  }

  function normalizeMap(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var at = now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('m'),
      name: cleanName(raw.name, t('store.untitledMap')),
      text: normalizeText(raw.text == null ? '' : raw.text),
      createdAt: num(raw.createdAt, at),
      updatedAt: num(raw.updatedAt, at)
    };
  }

  function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('s'),
      mapId: String(raw.mapId || ''),
      when: num(raw.when, now()),
      kind: raw.kind === 'manual' ? 'manual' : 'auto',
      label: cleanText(raw.label, COPY_LABEL_MAX),
      text: normalizeText(raw.text)
    };
  }

  function normalizeFragment(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') return null;
    return {
      text: normalizeText(raw.text),
      kind: raw.kind === 'heading' || raw.kind === 'bullet' ? raw.kind : 'text',
      level: num(raw.level, 0),
      indent: num(raw.indent, 0),
      label: cleanName(raw.label)
    };
  }

  function normalizeOrigin(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      parent: typeof raw.parent === 'string' ? raw.parent : null,
      index: num(raw.index, -1),
      lineage: Array.isArray(raw.lineage) ? raw.lineage.map(function (x) { return String(x); }) : []
    };
  }

  /* A trash entry, whatever it holds. Anything that cannot be put back is
   * dropped here rather than listed as a row that would fail when pressed. */
  function normalizeTrashEntry(raw) {
    if (!raw || typeof raw !== 'object' || !TRASH_KINDS[raw.kind]) return null;
    var entry = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('t'),
      kind: raw.kind,
      deletedAt: num(raw.deletedAt, now()),
      label: cleanName(raw.label)
    };
    if (raw.kind === 'branch') {
      var fragment = normalizeFragment(raw.fragment);
      if (!fragment) return null;
      return assign(entry, {
        mapId: String(raw.mapId || ''), mapName: cleanName(raw.mapName),
        fragment: fragment, origin: normalizeOrigin(raw.origin), files: normalizeFiles(raw.files)
      });
    }
    if (raw.kind === 'figure' || raw.kind === 'asset') {
      var path = cleanPath(raw.path);
      if (!path) return null;
      assign(entry, { path: path, file: normalizeRef(raw.file), owner: cleanName(raw.owner) });
      /* In the order trashFigure writes them, so a record read back and
       * written out again is the same JSON. */
      if (raw.kind === 'figure') {
        assign(entry, {
          ownerPath: typeof raw.ownerPath === 'string' ? raw.ownerPath : null,
          field: raw.field === 'body' ? 'body' : 'line',
          mapId: String(raw.mapId || ''), mapName: cleanName(raw.mapName)
        });
      }
      /* A notebook binned whole: the other files of its folder. */
      var others = normalizeFiles(raw.files);
      if (Object.keys(others).length) entry.files = others;
      return entry;
    }
    if (raw.kind === 'note') {
      if (typeof raw.text !== 'string' || !raw.text.trim()) return null;
      return assign(entry, {
        text: String(raw.text), noteKind: raw.noteKind === 'edge' ? 'edge' : 'node',
        owner: cleanName(raw.owner), ownerPath: typeof raw.ownerPath === 'string' ? raw.ownerPath : null,
        mapId: String(raw.mapId || ''), mapName: cleanName(raw.mapName)
      });
    }
    if (raw.kind === 'map') {
      var map = normalizeMap(raw.map);
      if (!map) return null;
      return assign(entry, {
        index: num(raw.index, 0), map: map, files: normalizeFiles(raw.files),
        snapshots: (Array.isArray(raw.snapshots) ? raw.snapshots : []).map(normalizeSnapshot).filter(Boolean)
      });
    }
    var copy = normalizeSnapshot(raw.snapshot);
    if (!copy) return null;
    return assign(entry, { mapName: cleanName(raw.mapName), snapshot: copy });
  }

  /* Ids that appear twice in one list get fresh ones: a lookup by id must
   * find one thing. */
  function uniqueIds(list, prefix) {
    var seen = Object.create(null);
    list.forEach(function (item) {
      if (seen[item.id]) item.id = uid(prefix);
      seen[item.id] = true;
    });
    return list;
  }

  function normalizeProject(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var p = makeProject(raw.name, raw.description);
    if (typeof raw.id === 'string' && raw.id) p.id = raw.id;
    p.isTemplate = !!raw.isTemplate;
    p.createdAt = num(raw.createdAt, p.createdAt);
    p.updatedAt = num(raw.updatedAt, p.updatedAt);
    p.maps = uniqueIds((Array.isArray(raw.maps) ? raw.maps : []).map(normalizeMap).filter(Boolean), 'm');
    p.files = normalizeFiles(raw.files);
    p.snapshots = uniqueIds((Array.isArray(raw.snapshots) ? raw.snapshots : []).map(normalizeSnapshot).filter(Boolean), 's');
    p.trash = uniqueIds((Array.isArray(raw.trash) ? raw.trash : []).map(normalizeTrashEntry).filter(Boolean), 't');
    p.trash.sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    return p;
  }

  /* Fresh ids for everything in a project - an import, a duplicate - with
   * every reference to a map following the map to its new id. */
  function reassignIds(p) {
    var mapIds = Object.create(null);
    var out = assign({}, p, { id: uid('p') });
    out.maps = p.maps.map(function (m) {
      var id = uid('m');
      mapIds[m.id] = id;
      return assign({}, m, { id: id });
    });
    function remap(id) { return mapIds[id] || id; }
    out.snapshots = p.snapshots.map(function (s) {
      return assign({}, s, { id: uid('s'), mapId: remap(s.mapId) });
    });
    out.trash = p.trash.map(function (e) {
      var copy = assign({}, e, { id: uid('t') });
      if (e.kind === 'branch' || e.kind === 'figure' || e.kind === 'note') copy.mapId = remap(e.mapId);
      if (e.kind === 'map') {
        var id = uid('m');
        copy.map = assign({}, e.map, { id: id });
        copy.snapshots = e.snapshots.map(function (s) { return assign({}, s, { id: uid('s'), mapId: id }); });
      }
      if (e.kind === 'snapshot') copy.snapshot = assign({}, e.snapshot, { id: uid('s'), mapId: remap(e.snapshot.mapId) });
      return copy;
    });
    return out;
  }

  /* ---------- the value, and who is watching it ---------- */

  var state = { projects: [] };
  /* Which project is showing and which map of each was open last. */
  var ui = { activeProjectId: null, activeMaps: {} };
  /* How each map is looked at: { pid: { mid: { folds, direction, camera } } }.
   * Replaced, never edited, so storage can tell a change by identity. */
  var views = {};
  var listeners = [];
  var history = freshHistory();
  var readOnly = false;

  function freshHistory() {
    return {
      undo: [], redo: [], depth: 0, txStart: null, txHere: null, txTouched: null, txFromWhere: null,
      txSelFrom: null, txFromSet: false, txSelTo: null, lastKey: '', lastAt: 0, seq: 0
    };
  }

  /* One listener that throws does not stop the others; its error still
   * reaches the console (and fails a test) on a task of its own. */
  function emit(change) {
    var list = listeners.slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](change); } catch (err) { setTimeout(function () { throw err; }, 0); }
    }
  }

  /* ---------- reading ---------- */

  function getProject(id) {
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === id) return state.projects[i];
    return null;
  }

  function indexOfProject(id) {
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === id) return i;
    return -1;
  }

  function findMap(p, id) {
    if (!p) return null;
    for (var i = 0; i < p.maps.length; i++) if (p.maps[i].id === id) return p.maps[i];
    return null;
  }

  function indexOfMap(p, id) {
    for (var i = 0; i < p.maps.length; i++) if (p.maps[i].id === id) return i;
    return -1;
  }

  function activeProject() { return getProject(ui.activeProjectId); }

  function activeMapOf(pid) {
    var p = getProject(pid);
    if (!p) return null;
    return findMap(p, ui.activeMaps[pid]) || p.maps[0] || null;
  }

  /* Where the person is: the project on show and the map open in it. */
  function here() {
    var p = activeProject();
    var m = p ? activeMapOf(p.id) : null;
    return { projectId: p ? p.id : null, mapId: m ? m.id : null };
  }

  /* After anything that can take a project or a map away, the pointers are
   * made to point at something that is still there. */
  function fixUI() {
    if (!getProject(ui.activeProjectId)) {
      ui.activeProjectId = state.projects.length ? state.projects[0].id : null;
    }
    var kept = {};
    state.projects.forEach(function (p) {
      var m = findMap(p, ui.activeMaps[p.id]) || p.maps[0] || null;
      if (m) kept[p.id] = m.id;
    });
    ui.activeMaps = kept;
  }

  /* ---------- writing ---------- */

  /* A new value with one project swapped for what `fn` makes of it. `fn`
   * hands back the same project to say nothing changed. */
  function updateIn(s, pid, fn) {
    var list = s.projects;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== pid) continue;
      var next = fn(list[i]);
      if (!next || next === list[i]) return s;
      next.updatedAt = now();
      var copy = list.slice();
      copy[i] = next;
      return { projects: copy };
    }
    return s;
  }

  function replaceMap(p, mid, fn) {
    var i = indexOfMap(p, mid);
    if (i < 0) return p;
    var next = fn(p.maps[i]);
    if (!next || next === p.maps[i]) return p;
    next.updatedAt = now();
    var maps = p.maps.slice();
    maps[i] = next;
    return assign({}, p, { maps: maps });
  }

  function mergeWhere(base, extra) {
    var out = assign({}, base);
    if (extra) {
      if ('selected' in extra) out.selected = extra.selected;
      if ('selectPath' in extra) out.selectPath = extra.selectPath;
      if ('anchorLine' in extra) out.anchorLine = extra.anchorLine;
    }
    return out;
  }

  function pushUndo(entry) {
    history.undo.push(entry);
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo = [];
  }

  /* The project and map a change was made to. Undoing it goes there: the
   * point of undoing is to see the thing come back. */
  function touched(change) {
    if (!change || !change.projectId) return null;
    return { projectId: change.projectId, mapId: change.mapId || null };
  }

  function stillThere(where) {
    var p = where && getProject(where.projectId);
    return !!p && (!where.mapId || !!findMap(p, where.mapId));
  }

  /* Back: where the person was, if the change says so - making something is
   * undone by going back to where you were before you made it - and
   * otherwise what the change touched. Forward: what the change touched, if
   * it is still there afterwards. */
  function placesOf(fromWhere, target) {
    return {
      from: fromWhere || target || here(),
      to: target && stillThere(target) ? target : here()
    };
  }

  /* What subscribers hear: the change with its label in words, and the key
   * the words came from (a toast may want either). */
  function announce(change) {
    var out = assign({}, change);
    if ('label' in change) {
      out.labelKey = change.label;
      out.label = labelText(change.label);
    }
    delete out.fromWhere;
    emit(out);
  }

  /* Every change goes through here. Inside a transaction it only moves the
   * value on - the transaction writes the one step at its end. Outside one,
   * the value it replaced becomes a step, unless it continues the step
   * before it: typing in the Markdown panel is one step per pause. */
  function commit(next, change) {
    if (readOnly || next === state) return false;
    var prev = state;
    state = next;
    fixUI();
    change = change || {};

    if (history.depth > 0) {
      if (!history.txTouched && touched(change)) history.txTouched = touched(change);
      if (change.fromWhere && !history.txFromWhere) history.txFromWhere = change.fromWhere;
      if (change.from && !history.txFromSet) {
        history.txSelFrom = mergeWhere(history.txSelFrom || {}, change.from);
        history.txFromSet = true;
      }
      if (change.to) history.txSelTo = mergeWhere(history.txSelTo || {}, change.to);
    } else {
      var at = now();
      var key = change.key || '';
      var top = history.undo[history.undo.length - 1];
      var places = placesOf(change.fromWhere, touched(change));
      /* change.join: this change finishes the step with that id, if it is
       * still the last one (a node added, then named). */
      var joins = change.join && top && top.id === change.join && !history.redo.length;
      var merge = joins || (key && top && top.key === key && at - history.lastAt < COALESCE_MS && !history.redo.length);
      if (merge) {
        top.to = mergeWhere(places.to, change.to);
      } else {
        pushUndo({
          id: ++history.seq,
          state: prev,
          label: change.label || 'store.label.change',
          key: key,
          from: mergeWhere(places.from, change.from),
          to: mergeWhere(places.to, change.to)
        });
      }
      history.lastAt = at;
      history.lastKey = key;
    }
    announce(change);
    if (history.depth === 0) emit({ type: 'history:changed' });
    return true;
  }

  /* Everything `fn` changes is one step, under `label`. `where` can carry the
   * selection before and after, which is what an edit made on the map adds:
   * undo puts the node that was chosen back under the finger. Nested
   * transactions are one step under the outer label; one that changes
   * nothing is no step at all. */
  function transaction(label, fn, where) {
    var outer = history.depth === 0;
    if (outer) {
      history.txStart = state;
      history.txHere = here();
      history.txTouched = null;
      history.txFromWhere = null;
      history.txSelFrom = where && where.from ? assign({}, where.from) : null;
      history.txFromSet = !!(where && where.from);
      history.txSelTo = where && where.to ? assign({}, where.to) : null;
    }
    history.depth++;
    try {
      return fn();
    } finally {
      history.depth--;
      if (outer) {
        var start = history.txStart;
        history.txStart = null;
        if (start !== state) {
          var places = placesOf(history.txFromWhere || (history.txTouched ? null : history.txHere), history.txTouched);
          pushUndo({
            id: ++history.seq,
            state: start,
            label: label || 'store.label.change',
            key: '',
            from: mergeWhere(places.from, history.txSelFrom),
            to: mergeWhere(places.to, history.txSelTo)
          });
          history.lastKey = '';
          history.lastAt = now();
          emit({ type: 'history:changed' });
        }
        history.txTouched = null;
        history.txFromWhere = null;
        history.txSelFrom = null;
        history.txSelTo = null;
        history.txHere = null;
      }
    }
  }

  /* A change that belongs to every moment at once rather than to this one:
   * a copy taken by the clock. Written into the value and into every value
   * the history holds, so undoing past it does not take the copy with it. */
  function applyEverywhere(fn) {
    state = fn(state);
    history.undo.forEach(function (entry) { entry.state = fn(entry.state); });
    history.redo.forEach(function (entry) { entry.state = fn(entry.state); });
    fixUI();
  }

  function travel(from, to, action) {
    if (readOnly || history.depth > 0) return null;
    var stack = history[from];
    if (!stack.length) return null;
    var entry = stack.pop();
    history[to].push({ id: entry.id, state: state, label: entry.label, key: '', from: entry.from, to: entry.to });
    state = entry.state;
    history.lastKey = '';
    var where = action === 'undo' ? entry.from : entry.to;
    if (where && getProject(where.projectId)) {
      ui.activeProjectId = where.projectId;
      if (where.mapId && findMap(getProject(where.projectId), where.mapId)) ui.activeMaps[where.projectId] = where.mapId;
    }
    fixUI();
    var text = labelText(entry.label);
    emit({ type: 'history', action: action, label: text, labelKey: entry.label, where: where || null, id: entry.id });
    emit({ type: 'history:changed' });
    return { action: action, label: text, labelKey: entry.label, where: where || null, id: entry.id };
  }

  /* A step taken back as if it had never been made, leaving nothing to
   * redo: the person cancelled it before it was finished (a node added and
   * dropped with Escape before it had a name). Only the step on top, and
   * only that very one. */
  function withdraw(id) {
    if (readOnly || history.depth > 0 || history.redo.length) return false;
    var entry = history.undo[history.undo.length - 1];
    if (!entry || entry.id !== id) return false;
    history.undo.pop();
    state = entry.state;
    history.lastKey = '';
    fixUI();
    emit({ type: 'history', action: 'withdraw', label: labelText(entry.label), labelKey: entry.label, where: entry.from || null, id: entry.id });
    emit({ type: 'history:changed' });
    return true;
  }

  function undo() { return travel('undo', 'redo', 'undo'); }
  function redo() { return travel('redo', 'undo', 'redo'); }
  function canUndo() { return !readOnly && history.undo.length > 0; }
  function canRedo() { return !readOnly && history.redo.length > 0; }

  function historyState() {
    var u = readOnly ? null : history.undo[history.undo.length - 1];
    var r = readOnly ? null : history.redo[history.redo.length - 1];
    return {
      canUndo: !!u, canRedo: !!r,
      undoLabel: u ? labelText(u.label) : null, redoLabel: r ? labelText(r.label) : null,
      undoLabelKey: u ? u.label : null, redoLabelKey: r ? r.label : null,
      undoId: u ? u.id : null, redoId: r ? r.id : null,
      /* Where the next undo and redo would take the person, so that whoever
       * asks can say something before it happens - a drawing left unsaved
       * on the map being left. */
      undoWhere: u ? u.from : null, redoWhere: r ? r.to : null,
      undoCount: history.undo.length, redoCount: history.redo.length
    };
  }

  function clearHistory() {
    history = freshHistory();
    emit({ type: 'history:changed' });
  }

  /* ---------- reading the trash and the files ---------- */

  /* Every file a project still needs: the ones its maps name and the ones
   * its copies name - a copy is a way back, and a way back to a picture that
   * is not there any more is not one. */
  function refsOfProject(p, skipMapId) {
    var used = Object.create(null);
    function mark(text) {
      ns.doc.refsInText(text).forEach(function (r) {
        used[r] = true;
        refKeys(r).forEach(function (key) { used[key] = true; });
      });
    }
    p.maps.forEach(function (m) { if (m.id !== skipMapId) mark(m.text); });
    p.snapshots.forEach(function (s) { if (s.mapId !== skipMapId) mark(s.text); });
    return withUsedBooks(p.files, used);
  }

  /* A notebook any of whose files is used is used whole: its other pages,
   * its book.json and its background are what that reference shows. */
  function withUsedBooks(files, used) {
    var folders = Object.create(null);
    var any = false;
    Object.keys(used).forEach(function (path) {
      var folder = bookOf(path);
      if (folder) { folders[folder] = true; any = true; }
    });
    if (!any) return used;
    Object.keys(files).forEach(function (path) {
      var folder = bookOf(path);
      if (folder && folders[folder]) used[path] = true;
    });
    return used;
  }

  /* The files a text names that the project has, as { path: file }. */
  function filesNamedBy(p, texts) {
    var out = {};
    texts.forEach(function (text) {
      ns.doc.refsInText(text).forEach(function (ref) {
        refKeys(ref).forEach(function (path) { if (p.files[path]) out[path] = p.files[path]; });
      });
    });
    return withBooks(p.files, out);
  }

  /* Files coming back into a project. A path already taken by the same bytes
   * is fine as it is; taken by other bytes, the one coming back gets the
   * next free name, and `renames` says which, so the text that names it can
   * be told. A whole notebook coming back (its book.json is among the
   * files) is one thing: when its folder now holds anything else - another
   * notebook made since under the same name, or other bytes - every file of
   * it moves together to a free folder ('x-2.book'), since book.json names
   * its pages by their names inside the folder. A lone page coming back
   * (a page deleted from a notebook) is a file like any other. */
  function putBackFiles(files, back) {
    var out = assign({}, files);
    var renames = {};
    back = back || {};
    var paths = Object.keys(back).filter(function (path) { return !!back[path]; });
    var wholes = Object.create(null);
    paths.forEach(function (path) {
      var folder = bookOf(path);
      if (folder && back[folder + '/' + BOOK_JSON]) wholes[folder] = true;
    });
    Object.keys(wholes).forEach(function (folder) {
      var mine = paths.filter(function (path) { return bookOf(path) === folder; });
      var there = folderIn(out, folder);
      var clash = Object.keys(there).some(function (path) {
        return !back[path] || back[path].asset !== there[path].asset;
      });
      var target = clash ? freeFolderIn(out, folder) : folder;
      mine.forEach(function (path) {
        var to = target === folder ? path : target + path.slice(folder.length);
        out[to] = back[path];
        if (to !== path) renames[path] = to;
      });
    });
    paths.forEach(function (path) {
      var folder = bookOf(path);
      if (folder && wholes[folder]) return;
      var ref = back[path];
      var there = out[path];
      if (!there) { out[path] = ref; return; }
      if (there.asset === ref.asset) return;
      var free = freePathIn(out, path);
      out[free] = ref;
      renames[path] = free;
    });
    return { files: out, renames: renames };
  }

  /* `renames` is keyed by the path in project.files; the text may spell it
   * another way ('./assets/x.png', 'a%20b.png'), and every spelling that
   * means it is renamed. */
  function applyRenames(text, renames) {
    var froms = Object.keys(renames);
    if (!froms.length) return text;
    ns.doc.refsInText(text).forEach(function (ref) {
      var keys = refKeys(ref);
      for (var i = 0; i < froms.length; i++) {
        if (ref === froms[i] || keys.indexOf(froms[i]) >= 0) { text = ns.doc.renameRef(text, ref, renames[froms[i]]); return; }
      }
    });
    return text;
  }

  function minuteOf(ms) { return Math.floor(ms / 60000); }

  /* Only the clock's copies are counted and cut, and only this map's: a copy
   * taken by hand was taken because that moment mattered to somebody. */
  function pruneSnapshots(list, mapId) {
    var autos = list.filter(function (s) { return s.mapId === mapId && s.kind === 'auto'; });
    if (autos.length <= SNAPSHOT_KEEP) return list;
    autos.sort(function (a, b) { return a.when - b.when; });
    var doomed = Object.create(null);
    autos.slice(0, autos.length - SNAPSHOT_KEEP).forEach(function (s) { doomed[s.id] = true; });
    return list.filter(function (s) { return !doomed[s.id]; });
  }

  /* Node counts, kept per map object: a map that has not changed is the same
   * object, so the count is worked out once per version of the text. */
  var nodeCounts = new WeakMap();
  function nodesIn(map) {
    var n = nodeCounts.get(map);
    if (n === undefined) { n = ns.doc.countNodes(map.text); nodeCounts.set(map, n); }
    return n;
  }

  /* ---------- putting things back ---------- */

  /* Each of these takes the project and the entry and hands back the project
   * with the thing restored, plus a word on how it went. */

  function restoreBranch(p, entry) {
    var map = findMap(p, entry.mapId);
    var made = false;
    if (!map) {
      /* The map it came from is gone. It is made again, empty, under its old
       * name, so that the branch has somewhere to go that says where it was. */
      var name = entry.mapName || t('store.restoredMap');
      map = makeMap(name, emptyDocument(name));
      made = true;
    }
    var back = putBackFiles(p.files, entry.files);
    var fragment = assign({}, entry.fragment, { text: applyRenames(entry.fragment.text, back.renames) });
    var parsed = ns.doc.parse(map.text);
    var place = made ? { parent: parsed.byPath[''] ? '' : null, index: Infinity, where: 'top' }
      : ns.doc.placeFor(parsed, entry.origin);
    var result = ns.doc.insertBranch(parsed, place.parent, place.index, fragment);
    if (!result) return null;
    var nextMap = assign({}, map, { text: result.text, updatedAt: now() });
    var maps = made ? p.maps.concat([nextMap]) : p.maps.map(function (m) { return m.id === map.id ? nextMap : m; });
    return {
      project: assign({}, p, { maps: maps, files: back.files }),
      mapId: nextMap.id, anchorLine: result.anchorLine, where: made ? 'new map' : place.where
    };
  }

  function nodeFor(parsed, path, label) {
    if (path != null && parsed.byPath[path] && ns.doc.labelOf(parsed.byPath[path]) === label) return path;
    if (!label) return null;
    for (var i = 0; i < parsed.flat.length; i++) {
      if (ns.doc.labelOf(parsed.flat[i]) === label) return parsed.flat[i].path;
    }
    return null;
  }

  /* A picture (or a file from the images panel) back - a notebook with
   * every file of its folder. When its bytes were never kept - it was
   * already missing when it went - and the project has nothing at that path
   * either, nothing can come back, and the text is not given a reference to
   * a picture that does not exist: 'gone'. */
  function restoreFigure(p, entry) {
    var wanted = assign({}, entry.files);
    if (entry.file) wanted[entry.path] = entry.file;
    var back = putBackFiles(p.files, wanted);
    var path = back.renames[entry.path] || entry.path;
    var out = assign({}, p, { files: back.files });
    if (!back.files[path]) return { project: out, mapId: null, where: 'gone', path: path };
    var map = entry.kind === 'figure' ? findMap(p, entry.mapId) : null;
    if (!map) return { project: out, mapId: null, where: 'files', path: path };

    var parsed = ns.doc.parse(map.text);
    var node = nodeFor(parsed, entry.ownerPath, entry.owner);
    if (node == null) return { project: out, mapId: map.id, where: 'files', path: path };
    var result = ns.doc.addImage(parsed, node, path, '', entry.field);
    if (!result) return { project: out, mapId: map.id, where: 'files', path: path };
    out = replaceMap(out, map.id, function (m) { return assign({}, m, { text: result.text }); });
    return { project: out, mapId: map.id, anchorLine: result.anchorLine, where: 'same', path: path };
  }

  function restoreMap(p, entry) {
    var back = putBackFiles(p.files, entry.files);
    var map = assign({}, entry.map, { text: applyRenames(entry.map.text, back.renames) });
    if (findMap(p, map.id)) map.id = uid('m');
    var maps = p.maps.slice();
    maps.splice(Math.max(0, Math.min(entry.index, maps.length)), 0, map);
    var copies = entry.snapshots.map(function (s) {
      var copy = assign({}, s, { mapId: map.id, text: applyRenames(s.text, back.renames) });
      if (p.snapshots.some(function (x) { return x.id === s.id; })) copy.id = uid('s');
      return copy;
    });
    return {
      project: assign({}, p, { maps: maps, files: back.files, snapshots: p.snapshots.concat(copies) }),
      mapId: map.id, where: 'same'
    };
  }

  function restoreSnapshot(p, entry) {
    var copy = entry.snapshot;
    if (p.snapshots.some(function (x) { return x.id === copy.id; })) copy = assign({}, copy, { id: uid('s') });
    var map = findMap(p, copy.mapId);
    if (map) {
      return { project: assign({}, p, { snapshots: p.snapshots.concat([copy]) }), mapId: map.id, where: 'same' };
    }
    /* A copy of a map that is not there any more would be a row in a list
     * nobody can open. It comes back as the map it was a copy of. */
    var made = makeMap(entry.mapName || t('store.restoredCopy'), copy.text);
    return {
      project: assign({}, p, {
        maps: p.maps.concat([made]),
        snapshots: p.snapshots.concat([assign({}, copy, { mapId: made.id })])
      }),
      mapId: made.id, where: 'new map'
    };
  }

  /* A note (or a link's note) back on the node it was on. A note written
   * there since is kept, the one coming back below it. The node gone, it
   * goes on the root (a link's note too: the root has no link); the map
   * gone, on the root of a map made again under the old name. */
  function restoreNote(p, entry) {
    var map = findMap(p, entry.mapId);
    var made = false;
    if (!map) {
      var name = entry.mapName || t('store.restoredMap');
      map = makeMap(name, emptyDocument(name));
      made = true;
    }
    var parsed = ns.doc.parse(map.text);
    var node = made ? null : nodeFor(parsed, entry.ownerPath, entry.owner);
    var kind = entry.noteKind === 'edge' ? 'edge' : 'node';
    var where = made ? 'new map' : 'same';
    if (node == null) {
      node = parsed.flat.length ? parsed.flat[0].path : null;
      if (node == null) return null;
      kind = 'node';
      if (!made) where = 'top';
    }
    /* A link's note needs a link: a node under another one. */
    if (kind === 'edge') {
      var cut = String(node).lastIndexOf('.');
      var up = node === '' ? null : (cut < 0 ? '' : String(node).slice(0, cut));
      if (up === null || !parsed.byPath[up]) kind = 'node';
    }
    function put(k) {
      var had = ns.doc.noteFor(parsed, node, k);
      return ns.doc.setNote(parsed, node, k, had && had.text ? had.text + '\n\n' + entry.text : entry.text);
    }
    var result = put(kind);
    if (!result) return null;
    var nextMap = assign({}, map, { text: result.text, updatedAt: now() });
    var maps = made ? p.maps.concat([nextMap]) : p.maps.map(function (m) { return m.id === map.id ? nextMap : m; });
    return { project: assign({}, p, { maps: maps }), mapId: nextMap.id, anchorLine: result.anchorLine, where: where };
  }

  var RESTORERS = {
    branch: restoreBranch, figure: restoreFigure, asset: restoreFigure,
    map: restoreMap, snapshot: restoreSnapshot, note: restoreNote
  };

  /* ---------- the store: whole workspace ---------- */

  /* data: { projects, ui, views } as storage.js read it back, or nothing for
   * an empty workspace. The history starts empty: it belongs to a session. */
  function init(data) {
    data = data || {};
    var seen = Object.create(null);
    var projects = [];
    (Array.isArray(data.projects) ? data.projects : []).forEach(function (raw) {
      var p = normalizeProject(raw);
      if (seen[p.id]) p.id = uid('p');
      seen[p.id] = true;
      projects.push(p);
    });
    state = { projects: projects };
    var savedUI = data.ui && typeof data.ui === 'object' ? data.ui : {};
    ui = {
      activeProjectId: typeof savedUI.activeProjectId === 'string' ? savedUI.activeProjectId : null,
      activeMaps: assign({}, savedUI.activeMaps)
    };
    fixUI();
    views = normalizeViews(data.views);
    history = freshHistory();
    emit({ type: 'init' });
    emit({ type: 'history:changed' });
    return state;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function uiState() { return { activeProjectId: ui.activeProjectId, activeMaps: assign({}, ui.activeMaps) }; }
  function projects() { return state.projects; }
  function project(id) { return id === undefined ? activeProject() : getProject(id); }

  function map(pid, mid) {
    if (pid === undefined) { var w = here(); return w.mapId ? findMap(getProject(w.projectId), w.mapId) : null; }
    return mid === undefined ? activeMapOf(pid) : findMap(getProject(pid), mid);
  }

  function templates() { return state.projects.filter(function (p) { return p.isTemplate; }); }

  /* What the sidebar shows under a project. */
  function counts(p) {
    p = p || activeProject();
    if (!p) return { maps: 0, nodes: 0, images: 0, trash: 0 };
    var nodes = 0;
    p.maps.forEach(function (m) { nodes += nodesIn(m); });
    var images = Object.keys(p.files).filter(function (path) { return /^assets\//.test(path); }).length;
    return { maps: p.maps.length, nodes: nodes, images: images, trash: p.trash.length };
  }

  /* Which files of the project its maps name - "on a map" in the images
   * panel. The copies are left out on purpose: this is the question of
   * whether anything you can see still uses the file. A notebook a map
   * names is used whole. */
  function usedByMaps(pid) {
    var p = getProject(pid);
    var used = Object.create(null);
    if (!p) return used;
    p.maps.forEach(function (m) {
      ns.doc.refsInText(m.text).forEach(function (r) {
        used[r] = true;
        refKeys(r).forEach(function (key) { used[key] = true; });
      });
    });
    return withUsedBooks(p.files, used);
  }

  function freePath(pid, path) {
    var p = getProject(pid);
    return p ? freePathIn(p.files, cleanPath(path) || path) : path;
  }

  /* Every project the session can still reach: the value now and every
   * value the history holds. Garbage collection keeps whatever any of them
   * names, so that undoing a deletion never comes back to missing bytes. */
  function retainedProjects() {
    var seen = new Set();
    var out = [];
    function take(s) {
      if (!s) return;
      s.projects.forEach(function (p) { if (!seen.has(p)) { seen.add(p); out.push(p); } });
    }
    take(state);
    history.undo.forEach(function (e) { take(e.state); });
    history.redo.forEach(function (e) { take(e.state); });
    if (history.txStart) take(history.txStart);
    return out;
  }

  /* ---------- where the person is, and how a map is looked at ---------- */

  function setActive(pid, mid) {
    var p = getProject(pid);
    if (!p) return false;
    var target = mid ? findMap(p, mid) : activeMapOf(pid);
    var changed = ui.activeProjectId !== pid || (!!target && ui.activeMaps[pid] !== target.id);
    ui.activeProjectId = pid;
    if (target) ui.activeMaps[pid] = target.id;
    if (changed) emit({ type: 'ui', projectId: pid, mapId: target ? target.id : null });
    return changed;
  }

  /* Legacy: the per-map direction of earlier versions. Still read and kept
   * (nothing new writes 'both'): the session turns a 'both' into side
   * markers in the map the first time it opens, then clears it. */
  var DIRECTIONS = { right: true, both: true };

  function normalizeCamera(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var x = num(raw.x, null), y = num(raw.y, null), k = num(raw.k, null);
    return x === null || y === null || k === null || k <= 0 ? null : { x: x, y: y, k: k };
  }

  function normalizeFolds(raw) {
    if (!Array.isArray(raw)) return [];
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < raw.length && out.length < FOLDS_MAX; i++) {
      var key = typeof raw[i] === 'string' ? raw[i] : null;
      if (key === null || seen[key]) continue;
      seen[key] = true;
      out.push(key);
    }
    return out;
  }

  /* notebooks: how the notebooks of a map (its board, its node drawings)
   * are looked at, by the folder (or lone file) of each: the canvas shown
   * last ('at', a page file name) and the camera of each canvas of an
   * infinite notebook ('cams', by page file name). notebook.js reads and
   * writes it whole; here it is only kept in bounds. Absent when empty. */
  var NOTEBOOKS_MAX = 40;
  var NOTEBOOK_CAMS_MAX = 200;

  function normalizeNotebooks(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var out = {};
    var n = 0;
    Object.keys(raw).forEach(function (key) {
      var v = raw[key];
      if (n >= NOTEBOOKS_MAX || !key || key.length > 300 || !v || typeof v !== 'object') return;
      var entry = {};
      if (typeof v.at === 'string' && v.at && v.at.length <= 120) entry.at = v.at;
      var cams = {};
      var c = 0;
      if (v.cams && typeof v.cams === 'object') {
        Object.keys(v.cams).forEach(function (file) {
          if (c >= NOTEBOOK_CAMS_MAX || !file || file.length > 120) return;
          var cam = normalizeCamera(v.cams[file]);
          if (!cam) return;
          cams[file] = cam;
          c++;
        });
      }
      if (c) entry.cams = cams;
      if (!entry.at && !c) return;
      out[key] = entry;
      n++;
    });
    return n ? out : null;
  }

  /* view: which face of the map is shown, the map itself (null) or its
   * board (notebook.js, 'board'). Kept only when it is the board, so a view
   * that never chose stays what it was. */
  function normalizeView(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var out = {
      folds: normalizeFolds(raw.folds),
      direction: DIRECTIONS[raw.direction] ? raw.direction : null,
      camera: normalizeCamera(raw.camera)
    };
    if (raw.view === 'board') out.view = 'board';
    var books = normalizeNotebooks(raw.notebooks);
    if (books) out.notebooks = books;
    return out;
  }

  function emptyView(v) { return !v.folds.length && !v.direction && !v.camera && !v.view && !v.notebooks; }

  /* Views of projects that are not there any more are left behind. */
  function normalizeViews(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (pid) {
      if (!getProject(pid) || !raw[pid] || typeof raw[pid] !== 'object') return;
      var maps = {};
      Object.keys(raw[pid]).forEach(function (mid) {
        var v = normalizeView(raw[pid][mid]);
        if (!emptyView(v)) maps[mid] = v;
      });
      if (Object.keys(maps).length) out[pid] = maps;
    });
    return out;
  }

  /* How a map is looked at: { folds: [lineage keys], direction, camera,
   * view ('board' when its board is the face shown; absent otherwise),
   * notebooks (see normalizeNotebooks; absent when empty) }.
   * Only the fields given change. Not a step of the history - undoing an
   * edit must not unfold the map - but kept with the workspace, so a map
   * opens again the way it was left. Allowed in a read-only tab too (it is
   * looking, not writing); only the tab that holds the data saves it. */
  function setMapView(pid, mid, patch) {
    if (!pid || !mid || !patch || typeof patch !== 'object') return false;
    var before = (views[pid] && views[pid][mid]) || normalizeView(null);
    var next = {
      folds: 'folds' in patch ? normalizeFolds(patch.folds) : before.folds,
      direction: 'direction' in patch ? (DIRECTIONS[patch.direction] ? patch.direction : null) : before.direction,
      camera: 'camera' in patch ? normalizeCamera(patch.camera) : before.camera
    };
    var face = 'view' in patch ? patch.view : before.view;
    if (face === 'board') next.view = 'board';
    var books = 'notebooks' in patch ? normalizeNotebooks(patch.notebooks) : (before.notebooks || null);
    if (books) next.notebooks = books;
    if (JSON.stringify(next) === JSON.stringify(before)) return false;
    var maps = assign({}, views[pid]);
    if (emptyView(next)) delete maps[mid]; else maps[mid] = next;
    var all = assign({}, views);
    if (Object.keys(maps).length) all[pid] = maps; else delete all[pid];
    views = all;
    emit({ type: 'view', projectId: pid, mapId: mid });
    return true;
  }

  function mapView(pid, mid) {
    var v = views[pid] && views[pid][mid];
    var out = v ? { folds: v.folds.slice(), direction: v.direction, camera: v.camera ? assign({}, v.camera) : null }
      : { folds: [], direction: null, camera: null };
    if (v && v.view) out.view = v.view;
    if (v && v.notebooks) out.notebooks = JSON.parse(JSON.stringify(v.notebooks));
    return out;
  }

  /* The whole table, for storage: the same object until a view changes. */
  function mapViews() { return views; }

  /* ---------- read-only ---------- */

  function setReadOnly(flag) {
    flag = !!flag;
    if (flag === readOnly) return false;
    readOnly = flag;
    emit({ type: 'readonly', readOnly: readOnly });
    emit({ type: 'history:changed' });
    return true;
  }

  function isReadOnly() { return readOnly; }

  /* ---------- projects ---------- */

  /* data: { name, description, fromTemplateId, withContent, maps: [{ name, text }], files }
   * A template gives its maps and the files they name (and its templates/
   * folder), or - with withContent false - its maps with nothing in them but
   * their title. The copies and the trash of a template stay with it. */
  function createProject(data) {
    if (readOnly) return null;
    data = data || {};
    var from = here();
    var name = cleanName(data.name, t('store.untitledProject'));
    var p = makeProject(name, data.description);
    var source = data.fromTemplateId ? getProject(data.fromTemplateId) : null;
    if (source) {
      var withContent = data.withContent !== false;
      var kept = {};
      Object.keys(source.files).forEach(function (path) {
        if (/^templates\//.test(path)) kept[path] = source.files[path];
      });
      p.maps = source.maps.map(function (m) {
        return makeMap(m.name, withContent ? m.text : emptyDocument(m.name));
      });
      p.files = assign(kept, withContent ? filesNamedBy(source, source.maps.map(function (m) { return m.text; })) : {});
    } else if (Array.isArray(data.maps) && data.maps.length) {
      p.maps = data.maps.map(function (m) { return makeMap(m && m.name, m && m.text); });
      p.files = normalizeFiles(data.files);
    } else {
      p.maps = [makeMap(name, emptyDocument(name))];
    }
    ui.activeProjectId = p.id;
    if (p.maps[0]) ui.activeMaps[p.id] = p.maps[0].id;
    commit({ projects: state.projects.concat([p]) },
      { type: 'project:create', label: 'store.label.newProject', projectId: p.id, fromWhere: from });
    return getProject(p.id);
  }

  function updateProject(pid, patch) {
    if (readOnly) return false;
    patch = patch || {};
    var next = updateIn(state, pid, function (p) {
      var name = patch.name !== undefined ? cleanName(patch.name) : p.name;
      if (!name) return p;
      var description = patch.description !== undefined ? cleanText(patch.description, DESCRIPTION_MAX) : p.description;
      if (name === p.name && description === p.description) return p;
      return assign({}, p, { name: name, description: description });
    });
    return commit(next, { type: 'project:update', label: 'store.label.editProject', projectId: pid });
  }

  function setTemplate(pid, flag) {
    if (readOnly) return false;
    var next = updateIn(state, pid, function (p) {
      return p.isTemplate === !!flag ? p : assign({}, p, { isTemplate: !!flag });
    });
    return commit(next, {
      type: 'project:update', label: flag ? 'store.label.useTemplate' : 'store.label.stopTemplate', projectId: pid
    });
  }

  /* A fork, right after the original: the maps and every file of the
   * project, under new ids, sharing the bytes (they never change). Not the
   * trash and not the copies, which are the history of the one it came from. */
  function duplicateProject(pid, suffix) {
    if (readOnly) return null;
    var source = getProject(pid);
    if (!source) return null;
    var from = here();
    var copy = reassignIds(assign({}, source, { trash: [], snapshots: [] }));
    var at = now();
    copy.name = cleanName(source.name + ' ' + (suffix || t('store.copySuffix')));
    copy.isTemplate = false;
    copy.createdAt = at;
    copy.updatedAt = at;
    var list = state.projects.slice();
    list.splice(indexOfProject(pid) + 1, 0, copy);
    ui.activeProjectId = copy.id;
    if (copy.maps[0]) ui.activeMaps[copy.id] = copy.maps[0].id;
    commit({ projects: list }, { type: 'project:create', label: 'store.label.duplicateProject', projectId: copy.id, fromWhere: from });
    return getProject(copy.id);
  }

  /* Gone from the list, and back with one undo for as long as the page is
   * open. The next project (same place, else the last) opens. */
  function deleteProject(pid) {
    if (readOnly) return false;
    var i = indexOfProject(pid);
    if (i < 0) return false;
    var list = state.projects.slice();
    list.splice(i, 1);
    if (ui.activeProjectId === pid) {
      var next = list[Math.min(i, list.length - 1)];
      ui.activeProjectId = next ? next.id : null;
    }
    return commit({ projects: list }, { type: 'project:delete', label: 'store.label.deleteProject', projectId: pid });
  }

  /* The sidebar reorders projects by dragging (and Alt+arrows). */
  function moveProject(pid, toIndex) {
    if (readOnly) return false;
    var i = indexOfProject(pid);
    if (i < 0) return false;
    var list = state.projects.slice();
    var moved = list.splice(i, 1)[0];
    var at = Math.max(0, Math.min(Math.floor(num(toIndex, i)), list.length));
    if (at === i) return false;
    list.splice(at, 0, moved);
    return commit({ projects: list }, { type: 'project:move', label: 'store.label.moveProject', projectId: pid });
  }

  /* Projects read from a file - a JSON export, a ZIP, a folder. They come
   * in beside the ones already here with fresh ids, and replace nothing. */
  function importProjects(raws, label) {
    if (readOnly) return [];
    var from = here();
    var added = (raws || []).map(function (raw) { return reassignIds(normalizeProject(raw)); });
    if (!added.length) return [];
    /* A project coming in under a name the sidebar already shows gets a
     * number after it, as a second copy of a file does: three 'Garden'
     * side by side cannot be told apart anywhere (sidebar, title, palette). */
    var taken = Object.create(null);
    state.projects.forEach(function (p) { taken[p.name.toLowerCase()] = true; });
    added = added.map(function (p) {
      var name = p.name;
      for (var n = 2; taken[name.toLowerCase()]; n++) name = p.name + ' (' + n + ')';
      taken[name.toLowerCase()] = true;
      return name === p.name ? p : assign({}, p, { name: name });
    });
    ui.activeProjectId = added[0].id;
    if (added[0].maps[0]) ui.activeMaps[added[0].id] = added[0].maps[0].id;
    commit({ projects: state.projects.concat(added) },
      { type: 'project:create', label: label || 'store.label.import', projectId: added[0].id, fromWhere: from });
    return added.map(function (p) { return getProject(p.id); });
  }

  /* The project as plain data, ready for JSON - the IPE shape, with a word
   * at the top saying what kind of file this is. */
  function exportProject(pid) {
    var p = getProject(pid);
    if (!p) return null;
    return assign({ mindroot: 'project', version: VERSION, exportedAt: now() }, JSON.parse(JSON.stringify(p)));
  }

  /* ---------- maps ---------- */

  function createMap(pid, data) {
    if (readOnly) return null;
    data = data || {};
    var p = getProject(pid);
    if (!p) return null;
    var from = here();
    var made = makeMap(data.name, data.text);
    var next = updateIn(state, pid, function (proj) {
      var maps = proj.maps.slice();
      var at = typeof data.index === 'number' ? Math.max(0, Math.min(data.index, maps.length)) : maps.length;
      maps.splice(at, 0, made);
      return assign({}, proj, { maps: maps, files: assign({}, proj.files, normalizeFiles(data.files)) });
    });
    ui.activeProjectId = pid;
    ui.activeMaps[pid] = made.id;
    commit(next, { type: 'map:create', label: data.label || 'store.label.newMap', projectId: pid, mapId: made.id, fromWhere: from });
    return findMap(getProject(pid), made.id);
  }

  function renameMap(pid, mid, name) {
    if (readOnly) return false;
    var clean = cleanName(name);
    if (!clean) return false;
    var was = '';
    var next = updateIn(state, pid, function (p) {
      var renamed = replaceMap(p, mid, function (m) { was = m.name; return m.name === clean ? m : assign({}, m, { name: clean }); });
      if (renamed === p || !was || !ns.doc || !ns.doc.renameMapLinks) return renamed;
      /* The links that name the map ([[Old name]], [[Old name#id|words]]) follow it. */
      var changed = false;
      var maps = renamed.maps.map(function (m) {
        var text = ns.doc.renameMapLinks(m.text, was, clean);
        if (text === m.text) return m;
        changed = true;
        return assign({}, m, { text: text, updatedAt: now() });
      });
      return changed ? assign({}, renamed, { maps: maps }) : renamed;
    });
    return commit(next, { type: 'map:update', label: 'store.label.renameMap', projectId: pid, mapId: mid });
  }

  /* Right after the original, same text, no copies (they are the history
   * of the original). */
  function duplicateMap(pid, mid, suffix) {
    var p = getProject(pid);
    var source = findMap(p, mid);
    if (!source) return null;
    return createMap(pid, {
      name: source.name + ' ' + (suffix || t('store.copySuffix')), text: source.text,
      index: indexOfMap(p, mid) + 1, label: 'store.label.duplicateMap'
    });
  }

  function moveMap(pid, mid, toIndex) {
    if (readOnly) return false;
    var next = updateIn(state, pid, function (p) {
      var i = indexOfMap(p, mid);
      if (i < 0) return p;
      var maps = p.maps.slice();
      var moved = maps.splice(i, 1)[0];
      var at = Math.max(0, Math.min(Math.floor(num(toIndex, i)), maps.length));
      if (at === i) return p;
      maps.splice(at, 0, moved);
      return assign({}, p, { maps: maps });
    });
    return commit(next, { type: 'map:move', label: 'store.label.moveMap', projectId: pid, mapId: mid });
  }

  /* A map into the trash, and with it its copies and every file only it
   * named - a picture another map (or another map's copy) still shows stays
   * where it is, and is also recorded in the entry so that putting the map
   * back never depends on it. */
  function deleteMap(pid, mid) {
    if (readOnly) return null;
    var p = getProject(pid);
    var target = findMap(p, mid);
    if (!target) return null;
    var mine = p.snapshots.filter(function (s) { return s.mapId === mid; });
    var files = filesNamedBy(p, [target.text].concat(mine.map(function (s) { return s.text; })));
    var used = refsOfProject(p, mid);
    var kept = assign({}, p.files);
    Object.keys(files).forEach(function (path) { if (!used[path]) delete kept[path]; });
    var entry = {
      id: uid('t'), kind: 'map', deletedAt: now(), label: target.name,
      index: indexOfMap(p, mid), map: target, files: files, snapshots: mine
    };
    var next = updateIn(state, pid, function (proj) {
      return assign({}, proj, {
        maps: proj.maps.filter(function (m) { return m.id !== mid; }),
        files: kept,
        snapshots: proj.snapshots.filter(function (s) { return s.mapId !== mid; }),
        trash: [entry].concat(proj.trash)
      });
    });
    commit(next, { type: 'map:delete', label: 'store.label.deleteMap', projectId: pid, mapId: mid });
    return entry;
  }

  /* The text of a map. `options.key` joins this change to the one before
   * with the same key if it came within a second and a half (sliding):
   * the Markdown panel, typed into, is one step per pause. `origin` says who
   * wrote it, so the one who did can tell its own echo from news. */
  function setMapText(pid, mid, text, options) {
    if (readOnly) return false;
    options = options || {};
    var clean = normalizeText(text);
    var next = updateIn(state, pid, function (p) {
      return replaceMap(p, mid, function (m) { return m.text === clean ? m : assign({}, m, { text: clean }); });
    });
    return commit(next, {
      type: 'map:text', label: options.label || 'store.label.editMap', projectId: pid, mapId: mid,
      origin: options.origin || null, key: options.key || '', join: options.join || null, from: options.from, to: options.to
    });
  }

  /* ---------- files ---------- */

  function setFile(pid, path, ref, options) {
    if (readOnly) return false;
    var clean = cleanPath(path);
    var file = normalizeRef(ref);
    if (!clean || !file) return false;
    var next = updateIn(state, pid, function (p) {
      var there = p.files[clean];
      if (there && there.asset === file.asset && there.type === file.type && there.size === file.size) return p;
      var files = assign({}, p.files);
      files[clean] = file;
      return assign({}, p, { files: files });
    });
    return commit(next, { type: 'files', label: (options && options.label) || 'store.label.addFile', projectId: pid });
  }

  /* The file a map's reference means, however it is spelt (see refKeys). */
  function fileRef(pid, path) {
    var p = getProject(pid);
    if (!p) return null;
    var keys = refKeys(path);
    for (var i = 0; i < keys.length; i++) if (p.files[keys[i]]) return p.files[keys[i]];
    return null;
  }

  /* ---------- copies ---------- */

  /* A copy of a map as it reads now. The clock's go in without becoming a
   * step (see applyEverywhere); a copy taken by hand is a step like any
   * other. Two clock copies of one map in the same minute are one, the later
   * replacing the earlier, and the clock takes none in a minute that already
   * has one taken by hand (exported copies are named to the minute). A copy
   * taken by hand is always a copy of its own. */
  function takeSnapshot(pid, mid, options) {
    if (readOnly) return null;
    options = options || {};
    var target = findMap(getProject(pid), mid);
    if (!target) return null;
    var when = num(options.when, now());
    var kind = options.kind === 'manual' ? 'manual' : 'auto';
    var copy = { id: uid('s'), mapId: mid, when: when, kind: kind, label: cleanText(options.label, COPY_LABEL_MAX), text: target.text };
    var minute = minuteOf(when);
    function clashIn(p) {
      return p.snapshots.filter(function (x) { return x.mapId === mid && minuteOf(x.when) === minute; });
    }
    function add(s) {
      return updateIn(s, pid, function (p) {
        if (!findMap(p, mid)) return p;
        var clash = clashIn(p);
        if (kind === 'auto' && clash.some(function (x) { return x.kind === 'manual'; })) return p;
        var replaced = kind === 'auto' ? clash : [];
        var list = p.snapshots.filter(function (x) { return replaced.indexOf(x) < 0; }).concat([copy]);
        return assign({}, p, { snapshots: pruneSnapshots(list, mid) });
      });
    }
    if (kind === 'auto') {
      if (clashIn(getProject(pid)).some(function (x) { return x.kind === 'manual'; })) return null;
      applyEverywhere(add);
      emit({ type: 'snapshot', projectId: pid, mapId: mid });
    } else {
      commit(add(state), { type: 'snapshot', label: 'store.label.takeCopy', projectId: pid, mapId: mid });
    }
    return copy;
  }

  function snapshotsOf(pid, mid) {
    var p = getProject(pid);
    if (!p) return [];
    return p.snapshots.filter(function (s) { return s.mapId === mid; })
      .sort(function (a, b) { return b.when - a.when; });
  }

  function snapshot(pid, sid) {
    var p = getProject(pid);
    if (!p) return null;
    for (var i = 0; i < p.snapshots.length; i++) if (p.snapshots[i].id === sid) return p.snapshots[i];
    return null;
  }

  function deleteSnapshot(pid, sid) {
    if (readOnly) return null;
    var p = getProject(pid);
    var copy = snapshot(pid, sid);
    if (!copy) return null;
    var owner = findMap(p, copy.mapId);
    var entry = {
      id: uid('t'), kind: 'snapshot', deletedAt: now(),
      label: cleanName(t('store.copyOf', { map: owner ? owner.name : t('store.someMap') })),
      mapName: owner ? owner.name : '', snapshot: copy
    };
    var next = updateIn(state, pid, function (proj) {
      return assign({}, proj, {
        snapshots: proj.snapshots.filter(function (s) { return s.id !== sid; }),
        trash: [entry].concat(proj.trash)
      });
    });
    commit(next, { type: 'trash', label: 'store.label.deleteCopy', projectId: pid, mapId: copy.mapId });
    return entry;
  }

  /* ---------- the trash ---------- */

  function trash(pid) {
    var p = getProject(pid === undefined ? ui.activeProjectId : pid);
    return p ? p.trash : [];
  }

  /* A branch deleted on the map: the map gets its new text and the trash
   * gets the lines that went, where they hung, and the files they named.
   * A file nothing else in the project names leaves `assets/` with them. */
  function trashBranch(pid, mid, data) {
    if (readOnly) return null;
    var p = getProject(pid);
    var target = findMap(p, mid);
    var fragment = data && normalizeFragment(data.fragment);
    if (!target || !fragment || typeof data.text !== 'string') return null;
    var files = filesNamedBy(p, [fragment.text]);
    var entry = {
      id: uid('t'), kind: 'branch', deletedAt: now(),
      label: cleanName(data.label || fragment.label, t('store.branch')),
      mapId: mid, mapName: target.name, fragment: fragment,
      origin: normalizeOrigin(data.origin), files: files
    };
    var text = normalizeText(data.text);
    var next = updateIn(state, pid, function (proj) {
      var withText = replaceMap(proj, mid, function (m) { return m.text === text ? m : assign({}, m, { text: text }); });
      var used = refsOfProject(withText);
      var kept = assign({}, proj.files);
      Object.keys(files).forEach(function (path) { if (!used[path]) delete kept[path]; });
      return assign({}, withText, { files: kept, trash: [entry].concat(proj.trash) });
    });
    commit(next, {
      type: 'trash', label: 'store.label.deleteBranch', projectId: pid, mapId: mid,
      origin: data.changeOrigin || 'editor', from: data.from, to: data.to
    });
    return entry;
  }

  /* A picture taken out of a node. The text has already lost it (the caller
   * does both in one transaction); this is the file's half of the gesture.
   * A notebook's page takes its whole folder with it (entry.files: the
   * folder's other files), unless something else still shows the notebook. */
  function trashFigure(pid, mid, data) {
    if (readOnly) return null;
    var p = getProject(pid);
    var target = findMap(p, mid);
    /* The path as the project keeps it, however the node spelt it. */
    var keys = refKeys(data && data.path);
    var path = keys.filter(function (k) { return p && p.files[k]; })[0] || keys[0];
    if (!target || !path) return null;
    var folder = bookOf(path);
    var others = folder ? folderIn(p.files, folder) : {};
    delete others[path];
    var entry = {
      id: uid('t'), kind: 'figure', deletedAt: now(),
      label: folder ? bookLabel(folder) : path.split('/').pop(), path: path, file: p.files[path] || null,
      owner: cleanName(data.owner), ownerPath: typeof data.ownerPath === 'string' ? data.ownerPath : null,
      field: data.field === 'body' ? 'body' : 'line', mapId: mid, mapName: target.name
    };
    if (Object.keys(others).length) entry.files = others;
    var next = updateIn(state, pid, function (proj) {
      var used = refsOfProject(proj);
      var kept = proj.files;
      [path].concat(Object.keys(others)).forEach(function (f) {
        if (used[f] || !kept[f]) return;
        if (kept === proj.files) kept = assign({}, kept);
        delete kept[f];
      });
      return assign({}, proj, { files: kept, trash: [entry].concat(proj.trash) });
    });
    commit(next, { type: 'trash', label: 'store.label.takePictureOut', projectId: pid, mapId: mid });
    return entry;
  }

  /* A note deleted on the map (or the note on the link to a node): the
   * caller writes the map's new text in the same transaction; the trash
   * keeps the words, the node they were on and the map. */
  function trashNote(pid, mid, data) {
    if (readOnly) return null;
    var p = getProject(pid);
    var target = findMap(p, mid);
    var text = data && typeof data.text === 'string' ? data.text : '';
    if (!target || !text.trim()) return null;
    var first = text.replace(/\s+/g, ' ').trim();
    var entry = {
      id: uid('t'), kind: 'note', deletedAt: now(),
      label: cleanName(first.length > 60 ? first.slice(0, 59) + '\u2026' : first),
      text: text, noteKind: data.kind === 'edge' ? 'edge' : 'node',
      owner: cleanName(data.owner), ownerPath: typeof data.ownerPath === 'string' ? data.ownerPath : null,
      mapId: mid, mapName: target.name
    };
    var next = updateIn(state, pid, function (proj) {
      return assign({}, proj, { trash: [entry].concat(proj.trash) });
    });
    commit(next, { type: 'trash', label: 'store.label.deleteNote', projectId: pid, mapId: mid });
    return entry;
  }

  /* A notebook's name in the trash: its folder's, without '.book'. */
  function bookLabel(folder) {
    return cleanName(folder.split('/').pop().replace(/\.book$/, ''), folder);
  }

  /* Files sent from the images panel: out of the folder, whether or not a
   * map still names them - which is what the panel says it does. One entry
   * per file; with opts.whole, the files given of one notebook folder are
   * ONE entry (a notebook binned from the panel), named after the folder,
   * whose path is the first of them given (the cover) and whose `files` are
   * the rest - put back together, never half a notebook. Without it (a page
   * deleted inside a notebook) a page is a file of its own. */
  function trashFiles(pid, paths, owners, opts) {
    if (readOnly) return [];
    var p = getProject(pid);
    if (!p) return [];
    var whole = !!(opts && opts.whole);
    var entries = [];
    var books = Object.create(null);
    var seen = Object.create(null);
    (paths || []).forEach(function (raw) {
      var path = cleanPath(raw);
      if (!path || !p.files[path] || seen[path]) return;
      seen[path] = true;
      var folder = whole ? bookOf(path) : null;
      if (folder && books[folder]) {
        var book = books[folder];
        book.files = book.files || {};
        book.files[path] = p.files[path];
        return;
      }
      var entry = {
        id: uid('t'), kind: 'asset', deletedAt: now(), label: folder ? bookLabel(folder) : path.split('/').pop(),
        path: path, file: p.files[path], owner: cleanName(owners && owners[path])
      };
      if (folder) books[folder] = entry;
      entries.push(entry);
    });
    if (!entries.length) return [];
    var gone = [];
    entries.forEach(function (e) { gone.push(e.path); gone.push.apply(gone, Object.keys(e.files || {})); });
    var next = updateIn(state, pid, function (proj) {
      var kept = assign({}, proj.files);
      gone.forEach(function (path) { delete kept[path]; });
      return assign({}, proj, { files: kept, trash: entries.slice().reverse().concat(proj.trash) });
    });
    var label = entries.length === 1 && entries[0].files ? 'store.label.trashNotebook' : counted('store.label.trashFiles', gone.length);
    commit(next, { type: 'trash', label: label, projectId: pid });
    return entries;
  }

  /* One entry back where it came from. Returns what happened: the entry,
   * the map it went back into, the line to select there, and `where`:
   * 'same' when it went back exactly where it was, 'moved' when its place
   * had moved and it followed it, 'top' when its place was gone and it went
   * to the end of the map, 'files' when only the file came back, 'new map'
   * when the map it belonged to had to be made again, 'gone' when nothing
   * could come back (the bytes were never kept). */
  function restoreTrash(pid, id) {
    var results = restoreTrashMany(pid, [id]);
    return results.length ? results[0] : null;
  }

  /* Several at once, one step of undo, the newest first - so a node deleted
   * before its parent goes back inside the parent. */
  function restoreTrashMany(pid, ids) {
    if (readOnly) return [];
    var p = getProject(pid);
    if (!p) return [];
    var wanted = Object.create(null);
    (ids || []).forEach(function (id) { wanted[id] = true; });
    var entries = p.trash.filter(function (e) { return wanted[e.id]; })
      .sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    if (!entries.length) return [];
    var results = [];
    transaction(counted('store.label.restore', entries.length), function () {
      entries.forEach(function (entry) {
        var done = RESTORERS[entry.kind](getProject(pid), entry);
        if (!done) return;
        var next = updateIn(state, pid, function () {
          return assign({}, done.project, {
            trash: done.project.trash.filter(function (e) { return e.id !== entry.id; })
          });
        });
        commit(next, { type: 'trash:restore', projectId: pid, mapId: done.mapId || null });
        results.push({ entry: entry, mapId: done.mapId || null, anchorLine: done.anchorLine, where: done.where, path: done.path });
      });
      var last = null;
      for (var i = results.length - 1; i >= 0 && !last; i--) if (results[i].mapId) last = results[i];
      if (last) setActive(pid, last.mapId);
    });
    return results;
  }

  function purgeTrash(pid, id) {
    return purgeTrashMany(pid, [id]).length === 1;
  }

  /* For good: only the entry goes; its bytes, named by nothing any more,
   * are collected at a later start once they are a day old. */
  function purgeTrashMany(pid, ids) {
    if (readOnly) return [];
    var wanted = Object.create(null);
    (ids || []).forEach(function (id) { wanted[id] = true; });
    var gone = [];
    var next = updateIn(state, pid, function (p) {
      var kept = p.trash.filter(function (e) {
        if (wanted[e.id]) { gone.push(e); return false; }
        return true;
      });
      return gone.length ? assign({}, p, { trash: kept }) : p;
    });
    commit(next, { type: 'trash:purge', label: counted('store.label.purge', gone.length), projectId: pid });
    return gone;
  }

  function emptyTrash(pid) {
    if (readOnly) return 0;
    var p = getProject(pid);
    if (!p || !p.trash.length) return 0;
    var n = p.trash.length;
    commit(updateIn(state, pid, function (proj) { return assign({}, proj, { trash: [] }); }),
      { type: 'trash:purge', label: 'store.label.emptyTrash', projectId: pid });
    return n;
  }

  /* ---------- branches from one map into another ---------- */

  /* opts: { from: { projectId, mapId }, paths: [...], to: { projectId, mapId },
   *         parent: path | null }
   * The chosen nodes are copied with everything under them, in the order
   * they have in their map; a node chosen together with one of its
   * ancestors comes along with the ancestor rather than twice. The files
   * they name are copied into the other project when it is another one
   * (renamed, and the text with them, when the name is taken by other
   * bytes). The source does not change. One step of undo. */
  function importBranches(opts) {
    if (readOnly) return null;
    opts = opts || {};
    var from = opts.from || {};
    var to = opts.to || {};
    var sourceProject = getProject(from.projectId);
    var source = findMap(sourceProject, from.mapId);
    var targetProject = getProject(to.projectId);
    var target = findMap(targetProject, to.mapId);
    if (!source || !target) return null;

    var parsed = ns.doc.parse(source.text);
    var chosen = (opts.paths || []).filter(function (path) { return typeof path === 'string' && !!parsed.byPath[path]; });
    chosen = chosen.filter(function (path, i) {
      return chosen.indexOf(path) === i && !chosen.some(function (other) {
        return other !== path && (other === '' ? path !== '' : path.indexOf(other + '.') === 0);
      });
    });
    chosen.sort(function (a, b) { return parsed.byPath[a].start - parsed.byPath[b].start; });
    if (!chosen.length) return { count: 0 };

    var fragments = chosen.map(function (path) { return ns.doc.extractBranch(parsed, path).fragment; });
    var files = targetProject.id === sourceProject.id ? {} : filesNamedBy(sourceProject, fragments.map(function (f) { return f.text; }));
    var back = putBackFiles(targetProject.files, files);
    var text = target.text;
    var anchor = null;
    var check = ns.doc.parse(text);
    var parent = opts.parent != null && check.byPath[opts.parent] ? opts.parent : (check.byPath[''] ? '' : null);
    var count = 0;
    var tops = [];
    fragments.forEach(function (fragment) {
      var current = ns.doc.parse(text);
      var result = ns.doc.insertBranch(current, parent, Infinity,
        assign({}, fragment, { text: applyRenames(fragment.text, back.renames) }));
      if (!result) return;
      text = result.text;
      count++;
      if (anchor === null) anchor = result.anchorLine;
      if (typeof result.anchorLine === 'number') tops.push(result.anchorLine);
    });
    if (!count) return { count: 0 };
    /* A first-level branch copied deeper keeps no 'left' marker, nor do
     * the nodes under a copied node (each copy lands after the one before,
     * so the lines of the earlier ones still hold). */
    var landed = ns.doc.parse(text);
    var copied = tops.map(function (line) { var e = ns.doc.findByLine(landed, line); return e ? e.path : null; })
      .filter(function (path) { return path !== null; });
    var tidy = copied.length ? ns.doc.dropStraySides(landed, copied) : null;
    if (tidy) text = tidy.text;
    var next = updateIn(state, targetProject.id, function (p) {
      var withText = replaceMap(p, target.id, function (m) { return assign({}, m, { text: text }); });
      return assign({}, withText, { files: back.files });
    });
    commit(next, {
      type: 'map:text', label: counted('store.label.importBranches', count),
      projectId: targetProject.id, mapId: target.id, to: { anchorLine: anchor }
    });
    return { count: count, anchorLine: anchor, mapId: target.id };
  }

  /* Branches of a map turned into maps of their own, in the same project:
   * each chosen node becomes the root of a new map (its words, its body and
   * every node under it), and in the source map it stays as a single node
   * that links to the new map ([[Name]]). The new map's root carries a note
   * that links back. One undo step for the whole lot; the source map stays
   * open. opts: { link: false } keeps the branches where they are and only
   * copies them out. Returns { count, maps: [{ id, name, path }] }. */
  function splitBranches(pid, mid, paths, opts) {
    if (readOnly) return null;
    opts = opts || {};
    var D = ns.doc;
    var p = getProject(pid);
    var source = findMap(p, mid);
    if (!source) return null;
    var parsed = D.parse(source.text);
    var chosen = (paths || []).filter(function (path) { return typeof path === 'string' && path !== '' && !!parsed.byPath[path]; });
    /* A node chosen with one of its ancestors goes with the ancestor. */
    chosen = chosen.filter(function (path, i) {
      return chosen.indexOf(path) === i && !chosen.some(function (other) { return other !== path && path.indexOf(other + '.') === 0; });
    });
    /* A node that is nothing but a link to a map, with nothing under it,
     * is already where a split would leave it. */
    chosen = chosen.filter(function (path) {
      var e = parsed.byPath[path];
      return (e.children && e.children.length) || !/^\s*\[\[[^\]]+\]\]\s*$/.test(D.labelOf(e));
    });
    if (!chosen.length) return { count: 0, maps: [] };
    /* Last in the file first: what is taken out of a later branch never
     * moves the path of an earlier one. */
    chosen.sort(function (a, b) { return parsed.byPath[b].start - parsed.byPath[a].start; });
    var taken = {};
    p.maps.forEach(function (m) { taken[m.name.toLowerCase()] = true; });
    function freeName(base) {
      var name = cleanName(base, t('store.untitledMap'));
      var n = 2;
      var out = name;
      while (taken[out.toLowerCase()]) out = name + ' ' + (n++);
      taken[out.toLowerCase()] = true;
      return out;
    }
    var text = source.text;
    var made = [];
    chosen.forEach(function (path) {
      var cur = D.parse(text);
      var entry = cur.byPath[path];
      if (!entry) return;
      var name = freeName(D.plainText(entry));
      /* The new map: the node as its root, its children as the branches. */
      var mapText = D.emptyDocument(name);
      var body = D.bodyFor(cur, path);
      if (body) { var b = D.setBody(D.parse(mapText), '', body); if (b) mapText = b.text; }
      (entry.children || []).forEach(function (child) {
        var frag = D.extractBranch(cur, child.path).fragment;
        var r = D.insertBranch(D.parse(mapText), '', Infinity, frag);
        if (r) mapText = r.text;
      });
      var back = D.setNote(D.parse(mapText), '', 'node', t('store.splitFrom', { map: source.name }));
      if (back) mapText = back.text;
      made.unshift({ name: name, text: mapText, path: path });
      if (opts.link === false) return;
      /* The source: the children and the body go, the node links out. */
      for (var i = (entry.children || []).length - 1; i >= 0; i--) {
        var gone = D.remove(D.parse(text), entry.children[i].path);
        if (gone) text = gone.text;
      }
      if (body) { var nb = D.setBody(D.parse(text), path, ''); if (nb) text = nb.text; }
      var linked = D.rename(D.parse(text), path, '[[' + name + ']]');
      if (linked) text = linked.text;
    });
    if (!made.length) return { count: 0, maps: [] };
    var from = here();
    var fresh = made.map(function (m) { return assign(makeMap(m.name, m.text), { name: m.name }); });
    var next = updateIn(state, pid, function (proj) {
      var maps = proj.maps.slice();
      var at = indexOfMap(proj, mid) + 1;
      if (text !== source.text) maps = maps.map(function (m) { return m.id === mid ? assign({}, m, { text: normalizeText(text) }) : m; });
      maps.splice.apply(maps, [at, 0].concat(fresh));
      return assign({}, proj, { maps: maps });
    });
    commit(next, { type: 'map:create', label: counted('store.label.splitBranches', fresh.length), projectId: pid, mapId: mid, fromWhere: from });
    return { count: fresh.length, maps: fresh.map(function (m, i) { return { id: m.id, name: m.name, path: made[i].path }; }) };
  }

  ns.store = {
    VERSION: VERSION,
    HISTORY_LIMIT: HISTORY_LIMIT,
    SNAPSHOT_KEEP: SNAPSHOT_KEEP,
    COALESCE_MS: COALESCE_MS,

    init: init,
    subscribe: subscribe,
    get state() { return state; },
    ui: uiState,
    projects: projects,
    project: project,
    map: map,
    here: here,
    templates: templates,
    counts: counts,
    nodesIn: nodesIn,
    usedByMaps: usedByMaps,
    freePath: freePath,
    retainedProjects: retainedProjects,

    setActive: setActive,
    setMapView: setMapView,
    mapView: mapView,
    mapViews: mapViews,
    setReadOnly: setReadOnly,
    readOnly: isReadOnly,

    transaction: transaction,
    undo: undo,
    withdraw: withdraw,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    historyState: historyState,
    clearHistory: clearHistory,
    labelText: labelText,

    createProject: createProject,
    updateProject: updateProject,
    setTemplate: setTemplate,
    duplicateProject: duplicateProject,
    deleteProject: deleteProject,
    moveProject: moveProject,
    importProjects: importProjects,
    exportProject: exportProject,

    createMap: createMap,
    splitBranches: splitBranches,
    renameMap: renameMap,
    duplicateMap: duplicateMap,
    moveMap: moveMap,
    deleteMap: deleteMap,
    setMapText: setMapText,

    setFile: setFile,
    fileRef: fileRef,
    cleanPath: cleanPath,

    takeSnapshot: takeSnapshot,
    snapshotsOf: snapshotsOf,
    snapshot: snapshot,
    deleteSnapshot: deleteSnapshot,

    trash: trash,
    trashBranch: trashBranch,
    trashFigure: trashFigure,
    trashNote: trashNote,
    trashFiles: trashFiles,
    restoreTrash: restoreTrash,
    restoreTrashMany: restoreTrashMany,
    purgeTrash: purgeTrash,
    purgeTrashMany: purgeTrashMany,
    emptyTrash: emptyTrash,

    importBranches: importBranches,

    /* For the tests: the normalizer the store runs on everything it is given. */
    _normalizeProject: normalizeProject
  };
})(window.MindRoot);
