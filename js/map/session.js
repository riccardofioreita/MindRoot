/* MindRoot - the open map: its text read into a tree, drawn by the map view,
 * edited through the store, and looked at the way it was left.
 *
 * One map is open at a time (or none: an empty workspace, a project with no
 * maps). The session owns the map view on #stage and the link between three
 * things that must agree: the store's text of the map, the parsed document
 * (ns.doc.parse) and the tree on screen (ns.doc.viewTree). Every edit goes
 * the same way round: a doc edit makes {text, anchorLine?, selectPath?},
 * apply() writes it to the store as one labelled undo step, parses the new
 * text, renders it and selects where the edit says. A change made anywhere
 * else - undo and redo, the Markdown panel, a restore from the trash, an
 * import - arrives as a store change and is reloaded the same way, keeping
 * the selected node by its lineage (the words from the root down to it), or
 * where the change says to look.
 *
 * The session follows the store rather than the other way round: whatever
 * the store says is the open map (store.here()) is what is shown. A click in
 * the sidebar, a new map, an undo that travels to another map, a map or a
 * project deleted under the person's eyes all simply change the store, and
 * the next change notice opens the right map, or closes the view when there
 * is nothing to show (ns.welcome then says what to do). One exception: an
 * open map deleted with nobody saying where to go next gives way to its
 * neighbour, not to the store's first map; the store hears of that choice
 * once the deletion has been announced to everyone (see steerTo). Store
 * changes reach the session through the bus 'store' event, which app.js
 * forwards from store.subscribe; the listener is added when this file
 * loads, ahead of every feature module, so anyone hearing 'store' after it
 * reads a session that is already up to date.
 *
 * How a map is looked at - folds, camera - is kept per map with
 * store.setMapView, outside the history (undoing an edit must not refold the
 * map). Folds are kept as lineage keys, so they survive edits that shift
 * paths and survive reopening; the camera is saved a moment after it comes
 * to rest. While the map is open the view itself carries folds and the
 * selection to the new paths of an edited tree (it matches nodes by
 * content), and every change of the fold set is written back.
 *
 * Pictures are project files: the view asks resolveImage(path), which turns
 * the path into a blob: URL through storage (one URL per set of bytes); when
 * the bytes behind a path change - a drawing saved again, a missing picture
 * added - the view is told to ask again for that path only. A drawing of
 * ours (a notebook's page) is shown themed in the dark theme, as its
 * notebook shows it: its file keeps the light paper, with the semantic ink
 * and the automatic sheet marked (ns.paper.themeSvg recolours them).
 *
 * Undo and redo live here too (history.undo, history.redo): the store goes
 * back and moves to the project and map where the step happened; the
 * session then opens that map and selects what the step says.
 *
 *   init()                                   creates the view, wires it
 *   open(projectId, mapId, {select, where}) -> Promise<bool>   resolves after map:rendered
 *   current() -> {projectId, mapId, map, text, state, tree, keys} | null
 *   apply(result, {label, key, select, origin, animate}) -> bool
 *   reload({origin, where})                  the text changed elsewhere
 *   select(path|null, {reveal}) -> bool, selected(), entry()
 *   readOnly()                               view-only mode, another tab, a read-only store
 *   undo() / redo() -> bool                  with the toast
 *   balance() -> bool                        the open map still waits for its sides (below)
 *   flush()                                  write the pending camera now
 *   close()                                  nothing open
 *   view                                     the mapview instance (after init)
 * Bus events out: map:opened {projectId, mapId, cause: 'open' (asked for
 * directly), 'gone' (the open map was deleted and this one took its place)
 * or the type of the store change that opened it ('ui', 'history',
 * 'map:create', ...)}, map:rendered (once the layout has settled),
 * map:closed {projectId, mapId}, doc:changed {projectId, mapId, text,
 * origin}, selection {path, entry, projectId, mapId}.
 *
 * Which side of the central node a branch grows on is part of the map (a
 * '<!-- side: left -->' marker on the branch's line, see ns.doc). Earlier
 * versions had a setting instead, 'grows on both sides', that balanced the
 * branches by itself; a map shown that way (its view said 'both', or it
 * followed the old global preference) is laid out the old way once more
 * when it opens, and the sides that layout drew are written as markers in
 * one undo step, 'keep the branch sides', so nothing moves and Undo can
 * still take it back. A tab that cannot write keeps showing the old layout
 * until one can. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var CAMERA_DELAY = 600;   // ms after the camera stops before it is written
  var RENDER_WAIT = 2000;   // ms open() waits for the motion to land before it resolves anyway
  /* First in a fold list written by the session: the person has folded this
   * map by hand, so the list wins over the file's own fold markers - even
   * when it is otherwise empty (everything unfolded on purpose). A map never
   * folded by hand keeps following its markers. Views stay in this browser
   * (they are never exported), so the marker never reaches a file. */
  var BY_HAND = '\u0000';

  var STRINGS = {
    en: {
      'session.cmd.undo': 'Undo',
      'session.cmd.redo': 'Redo',
      'session.undoLabel': 'Undo: {label}',
      'session.redoLabel': 'Redo: {label}',
      'session.nothingToUndo': 'Nothing to undo',
      'session.nothingToRedo': 'Nothing to redo',
      'session.undone': 'Undone: {label}',
      'session.redone': 'Redone: {label}',
      'session.help.undo': 'Takes back the last change, on whichever map it was made, and goes there.',
      'session.help.redo': 'Brings back a change you have just undone.',
      'session.kw.undo': 'undo back history revert',
      'session.kw.redo': 'redo again forward history',
      'session.openFailed': 'This map could not be opened.',
      'session.label.keepSides': 'keep the branch sides'
    },
    it: {
      'session.cmd.undo': 'Annulla',
      'session.cmd.redo': 'Ripeti',
      'session.undoLabel': 'Annulla: {label}',
      'session.redoLabel': 'Ripeti: {label}',
      'session.nothingToUndo': 'Niente da annullare',
      'session.nothingToRedo': 'Niente da ripetere',
      'session.undone': 'Annullato «{label}»',
      'session.redone': 'Ripetuto «{label}»',
      'session.help.undo': "Annulla l'ultima modifica, su qualunque mappa sia stata fatta, e ti porta lì.",
      'session.help.redo': 'Rifà una modifica che hai appena annullato.',
      'session.kw.undo': 'undo back history revert annulla indietro cronologia',
      'session.kw.redo': 'redo again forward history ripeti avanti cronologia',
      'session.openFailed': 'Questa mappa non si è aperta.',
      'session.label.keepSides': 'mantieni i lati dei rami'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  /* ---------------------------------------------------------------- state */

  var view = null;
  var cur = null;            // the open map (see current())
  var selected = null;       // the selected path in cur.state
  var seq = 0;               // bumps on every open/close: late renders of an earlier map are ignored
  var opening = null;        // { projectId, mapId, promise } while an open is rendering
  var applying = null;       // inside apply(): how to show its own store change
  var ready = false;
  var refs = new Map();      // picture path -> asset id the resolver answered (null: missing)
  var filesSeen = null;      // the open project's files object when refs was last checked
  var lastSelection = new Map();   // 'pid/mid' -> lineage key of the selection when the map was left
  var pendingCamera = null;  // { projectId, mapId, camera }
  var cameraTimer = 0;
  var unreadable = new WeakSet();  // map objects whose text could not be read (said once each)

  function store() { return ns.store; }
  function doc() { return ns.doc; }
  function emit(type, detail) { if (ns.bus) ns.bus.emit(type, detail); }
  function mapKey(pid, mid) { return pid + '/' + mid; }

  /* ---------------------------------------------------------------- reading */

  function current() {
    if (!cur) return null;
    return {
      projectId: cur.projectId, mapId: cur.mapId, map: cur.map, text: cur.text,
      state: cur.state, tree: cur.tree, keys: cur.keys
    };
  }

  function getSelected() { return selected; }

  function entry() {
    return cur && selected !== null ? doc().entryAt(cur.state, selected) : null;
  }

  function readOnly() {
    if (document.documentElement.getAttribute('data-mode') === 'view') return true;
    try {
      if (ns.tabs && typeof ns.tabs.readOnly === 'function' && ns.tabs.readOnly()) return true;
      if (ns.store && typeof ns.store.readOnly === 'function' && ns.store.readOnly()) return true;
    } catch (err) { /* a module that is not there cannot lock anything */ }
    return false;
  }

  function prefGet(key, fallback) {
    try {
      var v = ns.prefs ? ns.prefs.get(key) : undefined;
      return v === undefined || v === null ? fallback : v;
    } catch (err) { return fallback; }
  }

  /* The text, its parse, the tree and the lineage keys, always together. */
  function readMap(map) {
    var D = doc();
    var state = D.parse(map.text);
    return { map: map, text: map.text, state: state, tree: D.viewTree(state), keys: D.lineageKeys(state) };
  }

  function exists(path) { return !!cur && path !== null && path !== undefined && !!cur.state.byPath[path]; }

  /* The path a lineage key names now, or null. */
  function pathOfKey(key) {
    if (!cur || key === undefined || key === null) return null;
    var keys = cur.keys;
    for (var p in keys) if (keys[p] === key) return p;
    return null;
  }

  function parentOf(path) {
    if (!path) return null;
    var i = path.lastIndexOf('.');
    return i < 0 ? '' : path.slice(0, i);
  }

  /* The nearest node still there, walking up from a path that may have gone. */
  function nearest(path) {
    var p = path;
    while (p !== null && p !== undefined) {
      if (exists(p)) return p;
      p = parentOf(p);
    }
    return null;
  }

  /* Where a history step, or a store change, says the selection belongs:
   * a path, null (nothing), or undefined (it says nothing). */
  function pathFromWhere(where) {
    if (!where || !cur) return undefined;
    if (where.selectPath !== undefined && where.selectPath !== null && exists(String(where.selectPath))) return String(where.selectPath);
    if (typeof where.anchorLine === 'number' && where.anchorLine >= 0) {
      var e = doc().findByLine(cur.state, where.anchorLine);
      if (e) return e.path;
    }
    if ('selected' in where) {
      if (where.selected === null) return null;
      if (exists(String(where.selected))) return String(where.selected);
      return nearest(String(where.selected));
    }
    return undefined;
  }

  /* ---------------------------------------------------------------- pictures */

  /* A picture path of the open project as a blob: URL (never fetched: the
   * bytes come out of IndexedDB). The answer is remembered so a change of
   * the bytes behind the path can be told from one that does not concern it. */
  function resolveImage(path) {
    var S = ns.storage;
    if (!cur || !S || typeof S.refFor !== 'function') return null;
    var ref = null;
    try { ref = S.refFor(store(), cur.projectId, path); } catch (err) { ref = null; }
    refs.set(path, ref ? ref.asset : null);
    if (!ref) return null;
    if (/\.ink\.svg$/i.test(path) && darkTheme()) return themedDrawing(path, ref.asset);
    return S.blobURL(ref.asset);
  }

  /* (Integration: notebooks.) The theme as shown, 'dark' or not. */
  function darkTheme() {
    try { return !!(ns.shell && typeof ns.shell.theme === 'function' && ns.shell.theme() === 'dark'); } catch (err) { return false; }
  }

  /* One themed copy per path, made again only when its bytes change (the
   * previous copy's URL is let go then). A file with nothing marked (an
   * older drawing, a foreign SVG) is shown as it is. */
  var themedCopies = new Map();   // path -> {asset, url: Promise<string>}

  function themedDrawing(path, asset) {
    var S = ns.storage;
    var had = themedCopies.get(path);
    if (had && had.asset === asset) return had.url;
    if (had) had.url.then(dropThemedUrl, function () {});
    var url = Promise.resolve(S.blobText(asset)).then(function (text) {
      var P = ns.paper;
      if (!text || !P || typeof P.themeSvg !== 'function' || !/mr-(ink|sheet)/.test(text)) return S.blobURL(asset);
      var own = URL.createObjectURL(new Blob([P.themeSvg(text, 'dark', 'auto')], { type: 'image/svg+xml' }));
      ownThemed.add(own);
      return own;
    }).catch(function () { return S.blobURL(asset); });
    themedCopies.set(path, { asset: asset, url: url });
    return url;
  }

  function dropThemedUrl(url) {
    /* Only the copies made here: storage keeps its own blob: URLs. */
    if (typeof url === 'string' && url.indexOf('blob:') === 0 && ownThemed.has(url)) {
      ownThemed.delete(url);
      try { URL.revokeObjectURL(url); } catch (err) { /* gone */ }
    }
  }

  var ownThemed = new Set();

  /* The theme changed: every drawing on the map is asked for again. */
  function onThemeChange() {
    if (!view) return;
    themedCopies.forEach(function (c) { c.url.then(dropThemedUrl, function () {}); });
    themedCopies = new Map();
    refs.forEach(function (asset, path) { if (/\.ink\.svg$/i.test(path)) view.forgetImage(path); });
  }

  /* The project's files changed: every picture whose path now names other
   * bytes (or bytes it did not find before) is asked for again. */
  function checkFiles() {
    if (!cur || !view) return;
    var p = store().project(cur.projectId);
    var files = p ? p.files : null;
    if (files === filesSeen) return;
    filesSeen = files;
    var S = ns.storage;
    refs.forEach(function (asset, path) {
      var ref = null;
      try { ref = S && S.refFor ? S.refFor(store(), cur.projectId, path) : null; } catch (err) { ref = null; }
      var now = ref ? ref.asset : null;
      if (now !== asset) {
        refs.set(path, now);
        view.forgetImage(path);
      }
    });
  }

  function resetPictures() {
    refs = new Map();
    var p = cur ? store().project(cur.projectId) : null;
    filesSeen = p ? p.files : null;
  }

  /* ---------------------------------------------------------------- view state */

  /* Folds as the store keeps them (lineage keys) -> paths of this parse. */
  function foldsFor(keyList) {
    var wanted = new Set(keyList);
    var out = new Set();
    var keys = cur.keys;
    for (var p in keys) if (wanted.has(keys[p])) out.add(p);
    return out;
  }

  /* d is the view's 'fold' report. A remapped set (an edit moved folded
   * nodes to new paths) is not a fold made by hand: on a map that follows
   * its file's markers it writes nothing - the markers, moved with their
   * lines, still say the same - and on a map folded by hand it rewrites the
   * same list under the new keys. */
  function saveFolds(d) {
    var set = d && d.folds;
    if (!cur || !set) return;
    if (d.remapped && !store().mapView(cur.projectId, cur.mapId).folds.length) return;
    var keys = cur.keys;
    var list = [BY_HAND];
    set.forEach(function (p) { if (keys[p] !== undefined) list.push(keys[p]); });
    store().setMapView(cur.projectId, cur.mapId, { folds: list });
  }

  function writeCamera() {
    clearTimeout(cameraTimer);
    cameraTimer = 0;
    var job = pendingCamera;
    pendingCamera = null;
    if (!job || !store().map(job.projectId, job.mapId)) return;
    store().setMapView(job.projectId, job.mapId, { camera: job.camera });
  }

  function noteCamera(c) {
    if (!cur || !c) return;
    pendingCamera = { projectId: cur.projectId, mapId: cur.mapId, camera: { x: c.x, y: c.y, k: c.k } };
    clearTimeout(cameraTimer);
    cameraTimer = setTimeout(writeCamera, CAMERA_DELAY);
  }

  function flush() { writeCamera(); }

  /* ---------------------------------------------------------------- the sides of an older map */

  /* Whether a map was shown by the old 'both sides' setting and has not had
   * its sides written yet. The store still reads the view's old direction;
   * nothing writes 'both' any more. */
  function waitsForSides(projectId, mapId) {
    var S = store();
    if (!S) return false;
    var direction = S.mapView(projectId, mapId).direction;
    return direction === 'both' || (oldBoth && !direction);
  }

  function balance() { return !!cur && !!cur.balance; }

  /* The old global setting said 'both': every map that followed it (no
   * direction of its own) is marked as shown that way, once, and the old
   * preference is let go. Only a tab that saves the data does this: a tab
   * that cannot write would mark the maps in its memory alone and still let
   * the preference go, and the next tab would open them all on the right.
   * Until then (oldBoth) it shows those maps the old way, and it does the
   * marking when it may write (syncReadOnly). */
  var oldBoth = false;
  function canSave() {
    try {
      if (ns.tabs && typeof ns.tabs.readOnly === 'function' && ns.tabs.readOnly()) return false;
      if (ns.store && typeof ns.store.readOnly === 'function' && ns.store.readOnly()) return false;
    } catch (err) { /* a module that is not there cannot lock anything */ }
    return true;
  }

  function adoptOldPreference() {
    var P = ns.prefs;
    if (!P || typeof P.legacy !== 'function') return;
    var old = P.legacy('direction');
    if (old !== 'both') {
      oldBoth = false;
      if (old !== undefined) P.forget('direction');
      return;
    }
    var S = store();
    if (!S || !canSave()) { oldBoth = true; return; }
    S.projects().forEach(function (p) {
      p.maps.forEach(function (m) {
        if (!S.mapView(p.id, m.id).direction) S.setMapView(p.id, m.id, { direction: 'both' });
      });
    });
    oldBoth = false;
    P.forget('direction');
  }

  /* The open map waits for its sides: once the old layout has been drawn
   * with every first-level branch in it, the side each one landed on is
   * written as its marker - one undo step - and the map's old direction is
   * let go. Nothing moves: the markers say what the old layout drew. A
   * folded root (no branch drawn) waits for the render that shows them. */
  var keepingSides = false;
  function keepSides() {
    if (!cur || !cur.balance || !view || keepingSides || readOnly()) return;
    var D = doc();
    var g = view.geometry();
    var sides = {};
    var tops = cur.state.root ? (cur.state.root.synthetic ? cur.state.root.children : [cur.state.root]) : [];
    for (var i = 0; i < tops.length; i++) {
      var kids = tops[i].children || [];
      for (var k = 0; k < kids.length; k++) {
        var n = g.nodes[kids[k].path];
        if (!n) return;
        sides[kids[k].path] = n.side === 'left' ? 'left' : 'right';
      }
    }
    var pid = cur.projectId;
    var mid = cur.mapId;
    var result = D.setSides(cur.state, sides);
    keepingSides = true;
    try {
      cur.balance = false;
      /* The text first, drawn the old way (which ignores markers), then the
       * layout that reads the markers: both draw the same map. */
      if (result && !apply(result, { label: 'session.label.keepSides', select: false, origin: 'sides', animate: false })) {
        cur.balance = true;
        return;
      }
      view.setOptions({ balance: false });
      store().setMapView(pid, mid, { direction: null });
    } finally {
      keepingSides = false;
    }
  }

  function viewOptions() {
    return {
      balance: balance(),
      branchText: !!prefGet('branchText', true),
      notesOpen: !!prefGet('notesOpen', false),
      readOnly: readOnly()
    };
  }

  function syncReadOnly() {
    /* A tab that may write now marks the maps of the old preference first. */
    if (oldBoth) adoptOldPreference();
    if (view) view.setOptions({ readOnly: readOnly() });
    /* A tab that may write again writes the sides it was waiting with. */
    if (cur && cur.balance) Promise.resolve().then(keepSides);
  }

  /* Drawings being edited are saved before the map they belong to is left. */
  function flushInk() {
    try { if (ns.ink && typeof ns.ink.flush === 'function') ns.ink.flush(); } catch (err) {
      if (window.console) console.error('MindRoot: saving the open drawing failed', err);
    }
  }

  /* ---------------------------------------------------------------- selection */

  function announceSelection() {
    emit('selection', {
      path: selected,
      entry: selected !== null ? doc().entryAt(cur.state, selected) : null,
      projectId: cur ? cur.projectId : null,
      mapId: cur ? cur.mapId : null
    });
  }

  /* opts.reveal (default true) brings the node into view, unfolding what
   * hides it; opts.announce says 'selection' even when the path is the same
   * (the node under it changed). Returns false for a path that is not a node. */
  function select(path, opts) {
    opts = opts || {};
    if (!cur || !view) return false;
    var next = path === undefined || path === null ? null : String(path);
    if (next !== null && !exists(next)) return false;
    var changed = next !== selected;
    selected = next;
    view.select(next, { reveal: next !== null && opts.reveal !== false, animate: opts.animate });
    if (changed || opts.announce) announceSelection();
    return true;
  }

  function rememberSelection() {
    if (!cur) return;
    var k = mapKey(cur.projectId, cur.mapId);
    if (selected !== null && cur.keys[selected] !== undefined) lastSelection.set(k, cur.keys[selected]);
    else lastSelection.delete(k);
  }

  /* After a new parse: the node that was selected, found by its words from
   * the root, by where the view carried it, by its old path, or the nearest
   * node above where it was. */
  function keepSelection(oldPath, oldKey) {
    if (oldPath === null) return null;
    var byKey = pathOfKey(oldKey);
    if (byKey !== null) return byKey;
    var carried = view ? view.selected() : null;
    if (carried !== null && exists(carried)) return carried;
    return nearest(oldPath);
  }

  /* ---------------------------------------------------------------- render */

  /* 'map:rendered' once every motion has landed; resolves false when
   * another map opened (or none) in the meantime. */
  function rendered(token) {
    if (!view) return Promise.resolve(false);
    return view.settled().then(function () {
      if (token !== seq || !cur) return false;
      emit('map:rendered', { projectId: cur.projectId, mapId: cur.mapId });
      return true;
    });
  }

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* A camera kept from another window size can leave the whole map off the
   * stage; then it is framed again. */
  function offStage() {
    var g = view.geometry();
    var b = g && g.bounds;
    var el = view.el;
    if (!b || !b.w || !el || !el.clientWidth || !el.clientHeight) return false;
    var c = view.camera();
    var x1 = b.x * c.k + c.x, y1 = b.y * c.k + c.y;
    var x2 = x1 + b.w * c.k, y2 = y1 + b.h * c.k;
    return x2 < 0 || y2 < 0 || x1 > el.clientWidth || y1 > el.clientHeight;
  }

  /* ---------------------------------------------------------------- open */

  /* Opens a map: its text parsed, its folds and camera as they were left,
   * and the selection it had when it was last left in this session (or
   * opts.select, or what opts.where says). Resolves true once laid out and
   * announced as rendered (map:rendered; a motion that will not land -
   * someone panning - is not waited for past RENDER_WAIT), false when it
   * could not be opened or another map took its place first. The map
   * already open, or already opening, is not opened again, but opts.select
   * and opts.where are still honoured: a search hit on the open map selects
   * its node. opts.steer (from the store notice only) leaves telling the
   * store for later, see steerTo(). */
  function open(projectId, mapId, opts) {
    opts = opts || {};
    if (!view) return Promise.resolve(false);
    var S = store();
    var map = S.map(projectId, mapId);
    if (!map) return Promise.resolve(false);
    if (cur && cur.projectId === projectId && cur.mapId === mapId && !opts.force) {
      if (!opts.steer) { steer = null; S.setActive(projectId, mapId); }
      var wanted = opts.select !== undefined ? opts.select : pathFromWhere(opts.where);
      if (wanted !== undefined) select(wanted, { reveal: true });
      return opening && opening.projectId === projectId && opening.mapId === mapId ? opening.promise : Promise.resolve(true);
    }
    flushInk();
    writeCamera();
    rememberSelection();
    var token = ++seq;
    var projectChanged = !cur || cur.projectId !== projectId;
    var read;
    try {
      read = readMap(map);
    } catch (err) {
      /* Every later store change would try again: said once per version. */
      if (!unreadable.has(map)) {
        unreadable.add(map);
        if (window.console) console.error('MindRoot: the map could not be read', err);
        if (ns.ui && ns.ui.toast) ns.ui.toast(t('session.openFailed'), { kind: 'error' });
      }
      return Promise.resolve(false);
    }
    cur = { projectId: projectId, mapId: mapId, map: read.map, text: read.text, state: read.state, tree: read.tree, keys: read.keys,
      balance: waitsForSides(projectId, mapId) };
    selected = null;
    rememberSiblings();
    /* The store says this is the open map before anyone hears about it, and
     * the change notice that follows finds it already open. */
    if (!opts.steer) { steer = null; S.setActive(projectId, mapId); }

    view.clear();
    resetPictures();
    if (projectChanged) view.setImageResolver(resolveImage);
    view.setOptions(viewOptions());
    var saved = S.mapView(projectId, mapId);
    if (saved.camera) view.setCamera(saved.camera);
    var job = view.render(cur.tree, {
      animate: false,
      keepCamera: !!saved.camera,
      folds: saved.folds.length ? foldsFor(saved.folds) : undefined
    });

    var target = opts.select !== undefined ? opts.select : pathFromWhere(opts.where);
    if (target === undefined) target = pathOfKey(lastSelection.get(mapKey(projectId, mapId)));
    if (target !== null && target !== undefined && exists(String(target))) {
      selected = String(target);
      view.select(selected, { reveal: !!opts.where || opts.select !== undefined, animate: false });
    }

    emit('map:opened', { projectId: projectId, mapId: mapId, cause: opts.cause || 'open' });
    emit('doc:changed', { projectId: projectId, mapId: mapId, text: cur.text, origin: 'open' });
    announceSelection();

    var promise = Promise.resolve(job).then(function () {
      if (token !== seq) return false;
      if (saved.camera && offStage()) view.fit({ animate: false });
      return Promise.race([rendered(token), delay(RENDER_WAIT).then(function () { return token === seq; })]);
    }, function (err) {
      if (window.console) console.error('MindRoot: the map could not be drawn', err);
      return false;
    }).then(function (ok) {
      if (opening && opening.promise === promise) opening = null;
      return ok;
    });
    opening = { projectId: projectId, mapId: mapId, promise: promise };
    return promise;
  }

  /* Nothing to show: the workspace or the project is empty. */
  function close() {
    if (!cur) return;
    flushInk();
    writeCamera();
    rememberSelection();
    var was = { projectId: cur.projectId, mapId: cur.mapId };
    ++seq;
    opening = null;
    steer = null;
    cur = null;
    selected = null;
    if (view) view.clear();
    resetPictures();
    emit('selection', { path: null, entry: null, projectId: null, mapId: null });
    emit('map:closed', was);
    showWelcome();
  }

  function showWelcome() {
    var W = ns.welcome;
    if (W && typeof W.show === 'function') {
      try { W.show(); } catch (err) { if (window.console) console.error('MindRoot: welcome.show failed', err); }
    }
  }

  /* ---------------------------------------------------------------- edits */

  /* A doc edit's result written as one undo step (null: nothing changed, no
   * step). The selection follows opts.select (a path, or null for none;
   * false keeps it), else the result's selectPath, else its anchorLine, else
   * the node that was selected. The new text is read and drawn while the
   * store's change notice goes round - the session hears it first - so the
   * other modules hearing it already find the session up to date. */
  function apply(result, opts) {
    opts = opts || {};
    if (!result || typeof result.text !== 'string' || !cur || readOnly()) return false;
    var S = store();
    /* Where the selection lands is also what the step records as its 'to',
     * so a redo lands on the very node this edit selected. */
    var to = {};
    var where = null;
    if (opts.select !== undefined && opts.select !== false) {
      to.selected = opts.select === null ? null : String(opts.select);
      where = to;
    } else if (opts.select === undefined) {
      if (result.selectPath !== undefined && result.selectPath !== null) to.selectPath = String(result.selectPath);
      if (typeof result.anchorLine === 'number') to.anchorLine = result.anchorLine;
      if ('selectPath' in to || 'anchorLine' in to) where = to;
    }
    /* select: false keeps the selection by its words; so does a redo with
     * nothing recorded. */
    var job = { projectId: cur.projectId, mapId: cur.mapId, origin: opts.origin || 'map', where: where, animate: opts.animate, done: false };
    var outer = applying;
    applying = job;
    var written;
    try {
      written = S.setMapText(cur.projectId, cur.mapId, result.text, {
        label: opts.label, key: opts.key, join: opts.join, origin: job.origin,
        from: { selected: selected }, to: to
      });
    } finally {
      applying = outer;
    }
    if (!written) return false;
    /* Without app.js forwarding the store to the bus, nobody told us. */
    if (!job.done && cur && cur.projectId === job.projectId && cur.mapId === job.mapId) {
      var map = S.map(cur.projectId, cur.mapId);
      if (map && map !== cur.map) refresh(map, job);
      checkFiles();
    }
    return true;
  }

  /* The text of the open map changed elsewhere (undo, the Markdown panel,
   * an import, a restore from the trash): read it again. */
  function reload(opts) {
    opts = opts || {};
    if (!cur) return false;
    var map = store().map(cur.projectId, cur.mapId);
    if (!map) return false;
    if (map.text === cur.text && !opts.force) { cur.map = map; return false; }
    refresh(map, opts);
    return true;
  }

  function refresh(map, opts) {
    var oldPath = selected;
    var oldKey = oldPath !== null ? cur.keys[oldPath] : undefined;
    var read = readMap(map);
    cur.map = read.map;
    cur.text = read.text;
    cur.state = read.state;
    cur.tree = read.tree;
    cur.keys = read.keys;
    var token = seq;
    /* The view carries folds and the selection over to the new paths by
     * itself (and reports a remapped fold set, saved below). */
    var job = view.render(cur.tree, { animate: opts.animate !== false });
    var target = pathFromWhere(opts.where);
    if (target === undefined) target = keepSelection(oldPath, oldKey);
    selected = target;
    view.select(target, { reveal: target !== null && !!opts.where });
    announceSelection();
    emit('doc:changed', { projectId: cur.projectId, mapId: cur.mapId, text: cur.text, origin: opts.origin || null });
    Promise.resolve(job).then(function () { rendered(token); });
  }

  /* ---------------------------------------------------------------- following the store */

  /* Which map to show after a change: the store's open map, except that an
   * open map deleted with nobody saying where to go next gives way to its
   * neighbour (the one after it, else the one before) rather than to the
   * first map, which is all the store's own repair knows. A change that
   * says where to go - an undo or a redo (back to where the person was:
   * undoing "new map" returns to the map it was made from), a restore with
   * its 'to', a fresh workspace, a sidebar click - is followed as it is. */
  function chosen(change) {
    var type = change && change.type;
    return type === 'history' || type === 'init' || type === 'ui' || !!(change && (change.where || change.to));
  }

  function successor(change) {
    var S = store();
    var here = S.here();
    if (!cur || !here.projectId) return here;
    if (S.map(cur.projectId, cur.mapId) || chosen(change)) return here;
    var p = S.project(cur.projectId);
    if (!p || here.projectId !== cur.projectId || !p.maps.length || !cur.siblings) return here;
    var at = cur.siblings.indexOf(cur.mapId);
    for (var i = at + 1; i < cur.siblings.length; i++) {
      if (p.maps.some(function (m) { return m.id === cur.siblings[i]; })) return { projectId: p.id, mapId: cur.siblings[i] };
    }
    return { projectId: p.id, mapId: p.maps[p.maps.length - 1].id };
  }

  function rememberSiblings() {
    if (!cur) return;
    var p = store().project(cur.projectId);
    cur.siblings = p ? p.maps.map(function (m) { return m.id; }) : null;
  }

  /* The neighbour of a deleted map opens at once - whoever hears the
   * deletion after the session finds it already open - but the store is
   * told only once the deletion has been announced to everyone: setActive
   * announces a 'ui' change of its own, and nobody should hear the
   * consequence before its cause. Until then the store's pointer still
   * names its own choice (`fallback`), and a change in between that does
   * not choose (a 'history:changed', another listener's write) must not
   * send the session there. */
  var steer = null;      // { projectId, mapId, fallback: {projectId, mapId} }

  function steerTo(go, fallback) {
    var job = { projectId: go.projectId, mapId: go.mapId, fallback: fallback };
    steer = job;
    Promise.resolve().then(function () {
      if (steer !== job) return;
      steer = null;
      var S = store();
      var here = S.here();
      if (!cur || cur.projectId !== job.projectId || cur.mapId !== job.mapId) return;
      if (here.projectId !== fallback.projectId || here.mapId !== fallback.mapId) return;
      S.setActive(job.projectId, job.mapId);
    });
  }

  function steered(change, go) {
    if (!steer) return go;
    var S = store();
    if (!chosen(change) && go.projectId === steer.fallback.projectId && go.mapId === steer.fallback.mapId &&
        S.map(steer.projectId, steer.mapId)) {
      return { projectId: steer.projectId, mapId: steer.mapId };
    }
    steer = null;
    return go;
  }

  function onStore(change) {
    if (!ready || !view || !change) return;
    var type = change.type;
    if (type === 'history:changed' || type === 'view') return;
    if (type === 'readonly') { syncReadOnly(); return; }
    var S = store();
    if (applying && !applying.done && type === 'map:text' && cur && change.projectId === applying.projectId && change.mapId === applying.mapId &&
        cur.projectId === applying.projectId && cur.mapId === applying.mapId) {
      applying.done = true;
      var mine = S.map(cur.projectId, cur.mapId);
      if (mine && mine !== cur.map) refresh(mine, applying);
      checkFiles();
      return;
    }
    var go = steered(change, successor(change));
    var where = type === 'history' ? change.where : (change.to || null);
    if (!go.projectId || !go.mapId) {
      steer = null;
      close();
      return;
    }
    if (!cur || go.projectId !== cur.projectId || go.mapId !== cur.mapId || type === 'init') {
      /* 'gone': the open map (or its project) was deleted, and this one
       * takes its place - nobody chose it. */
      var gone = !!cur && !S.map(cur.projectId, cur.mapId);
      var here = S.here();
      var neighbour = go.projectId !== here.projectId || go.mapId !== here.mapId;
      open(go.projectId, go.mapId, { where: where || undefined, force: type === 'init', cause: gone ? 'gone' : type, steer: neighbour });
      if (neighbour) steerTo(go, here);
      return;
    }
    var map = S.map(cur.projectId, cur.mapId);
    if (map !== cur.map) {
      if (map.text !== cur.text) {
        refresh(map, { origin: change.origin || type, where: where, animate: true });
      } else {
        cur.map = map;
      }
    }
    rememberSiblings();
    checkFiles();
  }

  /* ---------------------------------------------------------------- history */

  function undoTitle() {
    var hs = store() ? store().historyState() : null;
    return hs && hs.canUndo ? t('session.undoLabel', { label: hs.undoLabel }) : t('session.nothingToUndo');
  }

  function redoTitle() {
    var hs = store() ? store().historyState() : null;
    return hs && hs.canRedo ? t('session.redoLabel', { label: hs.redoLabel }) : t('session.nothingToRedo');
  }

  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }

  /* Back or forward one step. The store moves to where it happened and the
   * change notice opens that map; the toast says what was undone and offers
   * the way back. */
  function travel(action) {
    var S = store();
    if (!S || viewOnly()) return false;
    var res = action === 'undo' ? S.undo() : S.redo();
    if (!res) return false;
    if (ns.ui && typeof ns.ui.toast === 'function') {
      var other = action === 'undo' ? 'redo' : 'undo';
      var id = res.id;
      var shown = ns.ui.toast(t(action === 'undo' ? 'session.undone' : 'session.redone', { label: res.label }), {
        action: {
          label: t(other === 'undo' ? 'session.cmd.undo' : 'session.cmd.redo'),
          run: function () {
            var hs = S.historyState();
            /* Only the very step this toast is about. */
            if ((other === 'redo' ? hs.redoId : hs.undoId) !== id) return;
            travel(other);
          }
        }
      });
      /* A new edit drops the step the toast offers to take back (a redo
       * stack is cleared by any change): the toast goes with it, rather
       * than staying with a button that does nothing. */
      if (ns.bus && shown) {
        var off = ns.bus.on('store', function () {
          var hs = S.historyState();
          if ((other === 'redo' ? hs.redoId : hs.undoId) === id) return;
          off();
          shown.close();
        });
      }
    }
    return true;
  }

  function undo() { return travel('undo'); }
  function redo() { return travel('redo'); }

  /* The Undo and Redo commands (top bar, Mod+Z, the palette) wait for the
   * open notebooks first: they write a pen's strokes a moment after it
   * lifts, as one step, and that write may be on its way. Undo then takes
   * back those strokes, not the step before them. (Integration: notebooks.) */
  function afterNotebooks(fn) {
    var N = ns.notebook;
    var open = false;
    try { open = !!(N && typeof N.views === 'function' && N.views().length && typeof N.flush === 'function'); } catch (err) { open = false; }
    if (!open) return fn();
    return Promise.resolve(N.flush()).then(function () { return fn(); }, function () { return fn(); });
  }

  function registerCommands() {
    var C = ns.commands;
    if (!C) return;
    C.register({
      id: 'history.undo', label: 'session.cmd.undo', group: 'history', icon: 'undo', keys: ['Mod+Z'],
      keywords: t('session.kw.undo'), help: 'session.help.undo',
      when: function () { return !viewOnly() && !!store() && store().canUndo(); },
      title: undoTitle,
      run: function () { return afterNotebooks(undo); }
    });
    C.register({
      id: 'history.redo', label: 'session.cmd.redo', group: 'history', icon: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'],
      keywords: t('session.kw.redo'), help: 'session.help.redo',
      when: function () { return !viewOnly() && !!store() && store().canRedo(); },
      title: redoTitle,
      run: function () { return afterNotebooks(redo); }
    });
  }

  /* ---------------------------------------------------------------- init */

  function init() {
    if (ready) return;
    var stage = document.getElementById('stage');
    if (!stage || !ns.mapview || !ns.doc || !ns.store) return;
    view = ns.mapview.create(stage, { resolveImage: resolveImage });
    api.view = view;
    view.on('select', function (d) { select(d.path, { reveal: false }); });
    view.on('background', function () { select(null); });
    view.on('knob', function (d) { view.fold(d.path, d.folded, { deep: !!d.deep }); });
    view.on('fold', saveFolds);
    view.on('camera', noteCamera);
    /* Out of the render's own stack: writing the sides renders again. */
    view.on('render', function () { if (cur && cur.balance) Promise.resolve().then(keepSides); });
    if (ns.prefs && typeof ns.prefs.on === 'function') {
      ns.prefs.on('branchText', function (v) { view.setOptions({ branchText: !!v }); });
      ns.prefs.on('notesOpen', function (v) { view.setOptions({ notesOpen: !!v }); });
    }
    adoptOldPreference();
    if (ns.bus) {
      ns.bus.on('prefs', function (d) { if (d && d.key === 'mode') syncReadOnly(); });
      ns.bus.on('tabs', syncReadOnly);
      ns.bus.on('tabs:yield', writeCamera);
      ns.bus.on('theme', onThemeChange);
    }
    registerCommands();
    ready = true;
    var here = store().here();
    if (here.projectId && here.mapId) open(here.projectId, here.mapId);
  }

  /* Ahead of every feature module: whoever hears 'store' after this reads
   * a session that has already caught up. */
  if (ns.bus) ns.bus.on('store', onStore);

  var api = {
    init: init,
    open: open,
    close: close,
    current: current,
    apply: apply,
    reload: reload,
    select: select,
    selected: getSelected,
    entry: entry,
    readOnly: readOnly,
    undo: undo,
    redo: redo,
    balance: balance,
    flush: flush,
    resolveImage: resolveImage,
    BY_HAND: BY_HAND,
    view: null
  };
  ns.session = api;
})(window.MindRoot);
