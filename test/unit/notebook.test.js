/* MindRoot - notebook: book.json, the pages of a folder, and the changes a
 * notebook makes to a project (first stroke, settings, pages added,
 * duplicated, moved, deleted and restored, a lone drawing moved into a
 * folder), each one undo step with the Markdown pointing at the first page.
 * Runs the real store, storage (bytes in memory: no database is opened),
 * paper, ink and notebook, with a notebook view on a real host. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var M = ns.notebook.model;
  var host = document.getElementById('host');

  ns.i18n.init('en');
  ns.store.init({});
  ns.store.subscribe(function (c) { ns.bus.emit('store', c); });

  function project(text, files) {
    var p = ns.store.createProject({ name: 'Notebooks', maps: [{ name: 'Garden', text: text || '# Garden\n\n- Tomatoes\n- Basil\n' }] });
    return { pid: p.id, mid: p.maps[0].id };
  }

  function files(pid, folder) {
    var p = ns.store.project(pid);
    var out = {};
    Object.keys(p.files).forEach(function (k) { if (!folder || k.indexOf(folder + '/') === 0) out[folder ? k.slice(folder.length + 1) : k] = p.files[k].asset; });
    return out;
  }

  function mapText(ids) { return ns.store.map(ids.pid, ids.mid).text; }

  function fire(el, type, x, y, buttons) {
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: buttons,
      clientX: x, clientY: y, bubbles: true, cancelable: true, pressure: 0.5
    }));
  }

  /* A stroke on the editor's sheet, in pixels from its corner. */
  function draw(view, x0, y0, x1, y1) {
    var surface = view.el.querySelector('.ink__surface');
    var r = surface.getBoundingClientRect();
    fire(surface, 'pointerdown', r.left + x0, r.top + y0, 1);
    for (var i = 1; i <= 10; i++) fire(surface, 'pointermove', r.left + x0 + (x1 - x0) * i / 10, r.top + y0 + (y1 - y0) * i / 10, 1);
    fire(surface, 'pointerup', r.left + x1, r.top + y1, 0);
  }

  function settle(view) {
    return view.flush().then(function () { return view.idle(); }).then(function () { return T.sleep(30); }).then(function () { return view.idle(); });
  }

  function text(ids, path) { return ns.storage.readDrawing(ns.store, ids.pid, path); }

  function undoLabel() { return ns.store.historyState().undoLabelKey; }

  /* ================================================================ book.json */

  T.test('book.json: defaults and a hostile file made whole', function () {
    var d = M.defaults();
    T.same([d.mode, d.paper.type, d.size.id, d.size.orientation, d.background, d.pages.length, d.pages[0].file],
      ['infinite', 'dots', 'a4', 'portrait', 'auto', 1, '001.ink.svg'], 'infinite, dots, A4 portrait, automatic, one page');
    var n = M.normalize({
      mode: 'scroll', paper: { type: 'nonsense' }, size: { id: 'custom', w: 99999, h: -3, orientation: 'sideways' },
      background: 'red', backgroundImage: { file: '../../etc/passwd', w: 10, h: 10 },
      pages: [{ file: '001.ink.svg' }, { file: '001.ink.svg' }, { file: '../x.ink.svg' }, { file: 'notes.txt' }, 'b.ink.svg', null],
      trashed: [{ file: '004.ink.svg', at: -5 }, { file: '001.ink.svg', at: 1 }]
    });
    T.eq(n.mode, 'infinite', 'an unknown mode is infinite');
    T.eq(n.paper.type, 'dots', 'an unknown paper is the default paper');
    T.ok(n.size.w <= 2000 && n.size.h >= 20, 'a custom size is clamped');
    T.eq(n.background, 'auto', 'a background that is not #rrggbb is automatic');
    T.eq(n.backgroundImage, null, 'a background picture outside the folder is refused');
    T.same(n.pages.map(function (p) { return p.file; }), ['001.ink.svg', 'b.ink.svg'], 'pages: drawings of the folder, once each, nothing outside it');
    T.same(n.trashed, [{ file: '004.ink.svg', at: 0 }], 'trashed: listed pages and bad places cleaned');
    var known = M.normalize({ size: { id: 'a5', w: 1, h: 1, orientation: 'landscape' }, paper: { type: 'ruled', step: 9 } });
    T.same([known.size.w, known.size.h], [210, 148], 'a known size keeps its own millimetres, turned');
    T.same(known.paper, { type: 'ruled', step: 9 }, 'a paper keeps its overrides');
    T.same(M.normalize({ paper: { type: 'image' } }).paper.type, 'dots', 'a picture paper without a picture falls back');
  });

  T.test('book.json: written and read back, a later version refused', function () {
    var m = M.normalize({ mode: 'pages', paper: { type: 'grid-5' }, size: { id: 'letter' }, background: '#F6F0E1', pages: [{ file: '001.ink.svg' }, { file: '003.ink.svg' }] });
    var json = M.toJson(m);
    var raw = JSON.parse(json);
    T.same([raw.mindroot, raw.version, raw.mode, raw.background], ['book', 1, 'pages', '#f6f0e1'], 'the header and the settings');
    T.same(raw.pages, [{ file: '001.ink.svg' }, { file: '003.ink.svg' }], 'pages as {file}');
    T.same(M.parseJson(json), m, 'read back as written');
    T.eq(M.parseJson('{"mindroot":"book","version":99}'), null, 'a newer version is not read');
    T.eq(M.parseJson('not json'), null, 'nor is something that is not JSON');
    T.eq(M.parseJson('{"mindroot":"map"}'), null, 'nor another kind of file');
  });

  T.test('book.json: a canvas\'s own paper and background', function () {
    var n = M.normalize({
      mode: 'infinite', paper: { type: 'dots' }, background: 'auto',
      pages: [{ file: '001.ink.svg' }, { file: '002.ink.svg' }],
      looks: {
        '002.ink.svg': { paper: { type: 'grid-10' }, background: '#F6F0E1' },
        '001.ink.svg': { paper: { type: 'image' }, background: 'red' },
        '../x.ink.svg': { paper: { type: 'grid-5' } },
        '003.ink.svg': { paper: { type: 'nonsense' } },
        '004.ink.svg': 'grid-5'
      }
    });
    T.same(Object.keys(n.looks), ['002.ink.svg'], 'only well-formed entries for drawing files are kept (a picture is never a canvas\'s paper)');
    T.same(n.looks['002.ink.svg'], { paper: { type: 'grid-10' }, background: '#f6f0e1' }, 'a paper and a background, cleaned');
    T.eq(M.normalize({}).looks, undefined, 'no looks, none written');
    T.same(M.normalize({ looks: { '001.ink.svg': { background: 'auto' } } }).looks, { '001.ink.svg': { background: 'auto' } }, 'automatic is an answer too');

    var l2 = M.lookOf(n, '002.ink.svg');
    T.same([l2.paper.type, l2.background], ['grid-10', '#f6f0e1'], 'a canvas with a look of its own draws on it');
    var l1 = M.lookOf(n, '001.ink.svg');
    T.same([l1.paper.type, l1.background, l1.own], ['dots', 'auto', null], 'the others on the notebook\'s');
    T.eq(M.metaFor(n, '001.ink.svg'), n, 'metaFor gives the notebook itself when the canvas has no look');
    var mf = M.metaFor(n, '002.ink.svg');
    T.same([mf.paper.type, mf.background, mf.mode], ['grid-10', '#f6f0e1', 'infinite'], 'metaFor lays the canvas\'s look over the notebook');
    T.eq(n.paper.type, 'dots', 'and leaves the notebook alone');
    var pages = M.normalize(Object.assign({}, n, { mode: 'pages' }));
    T.eq(M.lookOf(pages, '002.ink.svg').paper.type, 'dots', 'pages mode ignores them: every page is on the notebook\'s paper');
    T.eq(M.metaFor(pages, '002.ink.svg'), pages, 'metaFor: the notebook itself');

    var raw = JSON.parse(M.toJson(n));
    T.same(Object.keys(raw.looks), ['002.ink.svg'], 'written with the notebook');
    var gone = Object.assign({}, n, { pages: [{ file: '001.ink.svg' }] });
    T.eq(JSON.parse(M.toJson(gone)).looks, undefined, 'the look of a canvas that is gone is dropped...');
    var kept = Object.assign({}, n, { pages: [{ file: '001.ink.svg' }], trashed: [{ file: '002.ink.svg', at: 1 }] });
    T.same(Object.keys(JSON.parse(M.toJson(kept)).looks), ['002.ink.svg'], '...unless it is in the trash (it comes back with it)');
    T.same(M.parseJson(M.toJson(n)), n, 'read back as written');
  });

  T.test('names and folders', function () {
    T.eq(M.folderOf('assets/garden-board.book/001.ink.svg'), 'assets/garden-board.book', 'the folder of a page');
    T.eq(M.folderOf('assets/x.ink.svg'), null, 'a lone file has none');
    T.ok(M.isLone('assets/x.ink.svg') && M.isLone('assets/old.excalidraw.svg'), 'lone drawings');
    T.ok(!M.isLone('assets/x.book/001.ink.svg') && !M.isLone('assets/cat.png'), 'a page and a picture are not');
    T.same([M.pageName(1), M.pageName(12), M.pageName(1234)], ['001.ink.svg', '012.ink.svg', '1234.ink.svg'], 'page names');
    T.eq(M.nextPageNumber(['001.ink.svg', '007.ink.svg', 'book.json', 'x.ink.svg']), 8, 'the next number follows the highest');
  });

  T.test('the pages of a folder: listed, missing, put back', function () {
    var meta = M.normalize({ pages: [{ file: '001.ink.svg' }, { file: '002.ink.svg' }, { file: '003.ink.svg' }], trashed: [{ file: '005.ink.svg', at: 1 }] });
    var r = M.reconcile(meta, ['book.json', '001.ink.svg', '003.ink.svg', '005.ink.svg', '004.ink.svg', 'background.png']);
    T.same(r.pages.map(function (p) { return p.file; }), ['001.ink.svg', '005.ink.svg', '003.ink.svg', '004.ink.svg'],
      'a page gone from the folder is dropped; one put back stands where it was; one unknown goes last');
    T.eq(r.trashed, undefined, 'a page back from the trash is no longer remembered as trashed');
  });

  /* ================================================================ a board, from its first stroke */

  var ids = null;
  var view = null;

  T.test('a board is nothing until its first stroke, then one step', function () {
    ids = project();
    var before = Object.keys(files(ids.pid)).length;
    view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: null, kind: 'board', focus: false });
    return view.ready.then(function () {
      T.eq(Object.keys(files(ids.pid)).length, before, 'opening it makes no file');
      T.eq(view.mode(), 'infinite', 'infinite by default');
      var steps = ns.store.historyState().undoCount;
      draw(view, 200, 200, 400, 300);
      return settle(view).then(function () {
        var b = view.book();
        T.eq(b.folder, 'assets/garden-board.book', 'the folder is named after the map');
        T.same(Object.keys(files(ids.pid, b.folder)).sort(), ['001.ink.svg', 'book.json'], 'book.json and the first page');
        T.ok(mapText(ids).indexOf('<!-- board: assets/garden-board.book/001.ink.svg -->') === 0, 'the board marker names the first page');
        T.eq(ns.store.historyState().undoCount, steps + 1, 'one step');
        T.eq(undoLabel(), 'notebook.label.newBoard', 'labelled as the start of the board');
        return text(ids, b.ref);
      });
    }).then(function (svg) {
      T.ok(/class="mr-ink"/.test(svg), 'the stroke is in the semantic ink, marked');
      T.ok(svg.indexOf('fill="' + ns.ink.lightInk() + '"') > 0, 'written in the light paper\'s literal ink');
      T.ok(/class="mr-sheet"/.test(svg) && /data-paper="dots"/.test(svg), 'on the light sheet, with its paper');
    });
  });

  T.test('strokes after a pause are one more step each', function () {
    var steps = ns.store.historyState().undoCount;
    draw(view, 220, 260, 420, 330);
    draw(view, 230, 280, 430, 360);
    return settle(view).then(function () {
      T.eq(ns.store.historyState().undoCount, steps + 1, 'two strokes held together are one step');
      T.eq(undoLabel(), 'notebook.label.draw', 'labelled draw');
    });
  });

  T.test('undo takes the strokes back and the editor follows', function () {
    var count = view.editor().elements().length;
    ns.store.undo();
    return T.until(function () { return view.editor() && view.editor().elements().length === count - 2; }, 4000, 'the editor to follow the undo').then(function () {
      T.ok(true, 'the page shows what its file says');
      ns.store.redo();
      return T.until(function () { return view.editor().elements().length === count; }, 4000, 'the redo');
    }).then(function () { T.ok(true, 'and redo brings them back'); });
  });

  T.test('settings: pages mode, A4 landscape, a paper, one step', function () {
    var steps = ns.store.historyState().undoCount;
    return view.setSetting({ mode: 'pages', size: { id: 'a4', orientation: 'landscape' }, paper: { type: 'grid-5' } }).then(function () {
      return settle(view);
    }).then(function () {
      var b = view.book();
      T.same([b.meta.mode, b.meta.size.w, b.meta.size.h, b.meta.paper.type], ['pages', 297, 210, 'grid-5'], 'the book says so');
      T.eq(ns.store.historyState().undoCount, steps + 1, 'one step');
      return text(ids, b.folder + '/' + 'book.json');
    }).then(function (json) {
      T.eq(JSON.parse(json).mode, 'pages', 'book.json written');
      return text(ids, view.book().ref);
    }).then(function (svg) {
      var page = ns.ink.parse(svg).page;
      T.ok(page && Math.abs(page.w - 297 * ns.paper.MM) < 0.1, 'the page file is a landscape A4 page');
      T.ok(/data-paper="grid-5"/.test(svg), 'drawn on the new paper');
      T.eq(ns.ink.parse(svg).elements.length, 3, 'its drawing kept');
    });
  });

  T.test('pages: added, duplicated, the Markdown still on the first', function () {
    return view.addPage().then(function () { return view.addPage(); }).then(function () { return settle(view); }).then(function () {
      var b = view.book();
      T.same(b.pages.map(function (p) { return p.file; }), ['001.ink.svg', '002.ink.svg', '003.ink.svg'], 'three pages');
      T.eq(undoLabel(), 'notebook.label.addPage', 'labelled');
      return view.duplicatePage(1);
    }).then(function () { return settle(view); }).then(function () {
      var b = view.book();
      T.same(b.pages.map(function (p) { return p.file; }), ['001.ink.svg', '004.ink.svg', '002.ink.svg', '003.ink.svg'], 'the copy right after the page');
      return Promise.all([text(ids, b.folder + '/001.ink.svg'), text(ids, b.folder + '/004.ink.svg')]);
    }).then(function (two) {
      T.eq(ns.ink.parse(two[1]).elements.length, ns.ink.parse(two[0]).elements.length, 'with the same drawing');
      T.ok(mapText(ids).indexOf('board: assets/garden-board.book/001.ink.svg') > 0, 'the marker unchanged');
    });
  });

  T.test('a reorder that changes the first page renames the reference, in the same step', function () {
    var steps = ns.store.historyState().undoCount;
    return view.movePage(4, 1).then(function () { return settle(view); }).then(function () {
      var b = view.book();
      T.same(b.pages.map(function (p) { return p.file; }), ['003.ink.svg', '001.ink.svg', '004.ink.svg', '002.ink.svg'], 'the last page first');
      T.ok(mapText(ids).indexOf('board: assets/garden-board.book/003.ink.svg') > 0, 'the marker names the new first page');
      T.eq(ns.store.historyState().undoCount, steps + 1, 'one step');
      T.eq(undoLabel(), 'notebook.label.movePage', 'labelled');
      ns.store.undo();
      return T.until(function () { return view.book().pages[0].file === '001.ink.svg'; }, 4000, 'the undo');
    }).then(function () {
      T.ok(mapText(ids).indexOf('board: assets/garden-board.book/001.ink.svg') > 0, 'undone: order and marker together');
      ns.store.redo();
      return T.until(function () { return view.book().pages[0].file === '003.ink.svg'; }, 4000, 'the redo');
    }).then(function () { T.ok(true, 'redone'); });
  });

  T.test('a page deleted goes to the trash and comes back where it was', function () {
    var b = view.book();
    var gone = b.folder + '/003.ink.svg';
    return view.deletePage(1).then(function () { return settle(view); }).then(function () {
      var after = view.book();
      T.same(after.pages.map(function (p) { return p.file; }), ['001.ink.svg', '004.ink.svg', '002.ink.svg'], 'three pages left');
      T.eq(files(ids.pid)[gone], undefined, 'its file left the folder');
      var entry = ns.store.trash(ids.pid).filter(function (e) { return e.path === gone; })[0];
      T.ok(entry && entry.file && entry.kind === 'asset', 'the trash holds it, bytes and all');
      T.ok(mapText(ids).indexOf('board: assets/garden-board.book/001.ink.svg') > 0, 'the first page changed: the marker follows');
      T.eq(undoLabel(), 'notebook.label.deletePage', 'one step, labelled');
      ns.store.restoreTrash(ids.pid, entry.id);
      return T.until(function () { return view.book().pages.length === 4; }, 4000, 'the restore');
    }).then(function () {
      /* The marker in the map follows the pages back; on a busy runner it
       * can land a moment after them. Waited for, then checked below. */
      return T.until(function () { return mapText(ids).indexOf('board: assets/garden-board.book/003.ink.svg') > 0; }, 4000, 'the cover').catch(function () {});
    }).then(function () {
      var back = view.book();
      T.same(back.pages.map(function (p) { return p.file; }), ['003.ink.svg', '001.ink.svg', '004.ink.svg', '002.ink.svg'], 'back as the first page');
      T.ok(mapText(ids).indexOf('board: assets/garden-board.book/003.ink.svg') > 0, 'and the cover with it');
      T.eq(ns.store.historyState().undoLabelKey.key || ns.store.historyState().undoLabelKey, 'store.label.restore', 'in the restore\'s own step');
    });
  });

  T.test('settings: a custom size in mm, a chosen background', function () {
    return view.setSetting({ size: { id: 'custom', w: 100, h: 150 } }).then(function () { return settle(view); }).then(function () {
      var b = view.book();
      T.same([b.meta.size.id, b.meta.size.w, b.meta.size.h, b.meta.size.orientation], ['custom', 100, 150, 'portrait'], 'kept in millimetres');
      var page = view.editor().page();
      T.ok(Math.abs(page.w - 100 * ns.paper.MM) < 0.01 && Math.abs(page.h - 150 * ns.paper.MM) < 0.01, 'the editor\'s page is that size');
      return view.setSetting({ background: '#25362e' });
    }).then(function () { return settle(view); }).then(function () {
      var look = view.editor().look();
      var c = ns.paper.colors('light', '#25362e');
      T.same([look.sheet, look.ink, look.dark], [c.sheet, c.ink, true], 'the sheet is the colour, the ink light on it, whatever the theme');
      return text(ids, view.book().ref);
    }).then(function (svg) {
      T.ok(/class="mr-sheet"[^>]*fill="#25362e"|fill="#25362e"[^>]*class="mr-sheet"/.test(svg), 'the file is written on that colour');
      return view.setSetting({ background: 'auto', size: { id: 'a4', orientation: 'landscape' } });
    }).then(function () { return settle(view); }).then(function () {
      T.eq(view.book().meta.background, 'auto', 'back to automatic');
    });
  });

  T.test('the paper follows the theme', function () {
    var shell = ns.shell;
    ns.shell = { theme: function () { return 'dark'; } };
    ns.bus.emit('theme', { key: 'theme', value: 'dark', resolved: 'dark' });
    var dark = view.editor().look();
    ns.shell = { theme: function () { return 'light'; } };
    ns.bus.emit('theme', { key: 'theme', value: 'light', resolved: 'light' });
    var light = view.editor().look();
    ns.shell = shell;
    T.same([dark.sheet, dark.ink], [ns.paper.colors('dark').sheet, ns.paper.colors('dark').ink], 'dark paper, light ink in the dark theme');
    T.same([light.sheet, light.ink], [ns.paper.colors('light').sheet, ns.paper.colors('light').ink], 'and light again');
  });

  T.test('the last page stays', function () {
    var pages = view.pages();
    var chain = Promise.resolve();
    for (var i = 1; i < pages; i++) chain = chain.then(function () { return view.deletePage(1); }).then(function () { return settle(view); });
    return chain.then(function () {
      T.eq(view.pages(), 1, 'one page left');
      return view.deletePage(1);
    }).then(function (out) {
      T.eq(out, false, 'deleting it is refused');
      T.eq(view.pages(), 1, 'it is still there');
      return view.close();
    });
  });

  /* ================================================================ a lone drawing */

  T.test('a lone drawing opens as a notebook and is not converted by opening', function () {
    var svg = ns.ink.serialize({ elements: [ns.ink.engine.makeShape('rect', [10, 10], [80, 60], { color: '#2f6fb3', width: 4 })] });
    var lone = null;
    return ns.storage.putBlob(svg, 'sketch.ink.svg').then(function (ref) {
      ids = project('# Garden\n\n- Tomatoes ![](assets/sketch.ink.svg)\n');
      ns.store.setFile(ids.pid, 'assets/sketch.ink.svg', ref);
      lone = ref.asset;
      view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: 'assets/sketch.ink.svg', kind: 'node', nodePath: '0', focus: false });
      return view.ready;
    }).then(function () {
      T.eq(view.book().lone, 'assets/sketch.ink.svg', 'a lone file');
      T.eq(view.mode(), 'infinite', 'with the default settings');
      T.ok(mapText(ids).indexOf('![](assets/sketch.ink.svg)') > 0, 'the Markdown untouched');
      draw(view, 300, 300, 420, 360);
      return settle(view);
    }).then(function () {
      T.eq(view.book().lone, 'assets/sketch.ink.svg', 'a stroke is written to the file itself');
      T.ok(files(ids.pid)['assets/sketch.ink.svg'] !== lone, 'the file changed');
      T.eq(Object.keys(files(ids.pid)).filter(function (k) { return /\.book\//.test(k); }).length, 0, 'no folder yet');
      var steps = ns.store.historyState().undoCount;
      return view.setSetting({ paper: { type: 'ruled' } }).then(function () { return settle(view); }).then(function () {
        var b = view.book();
        T.eq(b.folder, 'assets/sketch.book', 'settings need book.json: the drawing moves into its folder');
        T.same(Object.keys(files(ids.pid, b.folder)).sort(), ['001.ink.svg', 'book.json'], 'as its first page, with book.json');
        T.ok(mapText(ids).indexOf('![](assets/sketch.book/001.ink.svg)') > 0, 'the Markdown points at the new place');
        T.eq(ns.store.historyState().undoCount, steps + 1, 'all in one step');
        ns.store.undo();
        return T.until(function () { return view.book() && view.book().lone === 'assets/sketch.ink.svg'; }, 4000, 'the undo');
      });
    }).then(function () {
      T.ok(mapText(ids).indexOf('![](assets/sketch.ink.svg)') > 0, 'undone: the lone file and its reference again');
      return view.close();
    });
  });

  T.test('an old Excalidraw drawing moves into a folder at its first stroke', function () {
    var old = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><!-- svg-source:excalidraw --><rect x="10" y="10" width="50" height="30" fill="#c4314b"/></svg>';
    return ns.storage.putBlob(old, 'old.excalidraw.svg').then(function (ref) {
      ids = project('# Garden\n\n- Tomatoes ![](assets/old.excalidraw.svg)\n');
      ns.store.setFile(ids.pid, 'assets/old.excalidraw.svg', ref);
      view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: 'assets/old.excalidraw.svg', kind: 'node', nodePath: '0', focus: false });
      return view.ready;
    }).then(function () {
      T.eq(view.editor().loaded().kind, 'foreign', 'it opens as the background of a new drawing');
      draw(view, 300, 300, 420, 360);
      return settle(view);
    }).then(function () {
      var b = view.book();
      T.eq(b.folder, 'assets/old.book', 'moved into a folder');
      T.ok(mapText(ids).indexOf('![](assets/old.book/001.ink.svg)') > 0, 'the reference follows');
      T.ok(!!files(ids.pid)['assets/old.excalidraw.svg'], 'the old file stays where copies may still name it');
      return text(ids, b.ref);
    }).then(function (svg) {
      T.eq(ns.ink.parse(svg).kind, 'ink', 'the page is a drawing of ours');
      T.ok(!!ns.ink.parse(svg).background, 'with the old one behind it');
      return view.close();
    });
  });

  /* ================================================================ a node drawing */

  T.test('a new node drawing is named in the node at its first stroke', function () {
    ids = project();
    view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: null, kind: 'node', nodePath: '1', focus: false });
    return view.ready.then(function () {
      draw(view, 200, 200, 300, 300);
      return settle(view);
    }).then(function () {
      var b = view.book();
      T.eq(b.folder, 'assets/basil.book', 'the folder is named after the node');
      T.ok(/- !\[\]\(assets\/basil\.book\/001\.ink\.svg\) Basil/.test(mapText(ids)), 'the node shows the first page: ' + JSON.stringify(mapText(ids)));
      T.eq(undoLabel(), 'notebook.label.newDrawing', 'labelled');
      T.ok(!view.isDirty(), 'nothing left to write');
      return view.close();
    }).then(function (ok) {
      T.eq(ok, true, 'closed with everything kept');
      T.eq(host.children.length, 0, 'and gone from the page');
    });
  });

  T.test('read() of a folder without book.json, and of nothing', function () {
    ids = project();
    var page = ns.ink.serialize({ elements: [] });
    return Promise.all([ns.storage.putBlob(page, 'b.ink.svg'), ns.storage.putBlob(page, 'a.ink.svg')]).then(function (refs) {
      ns.store.setFile(ids.pid, 'assets/hand.book/b.ink.svg', refs[0]);
      ns.store.setFile(ids.pid, 'assets/hand.book/a.ink.svg', refs[1]);
      return ns.notebook.read(ids.pid, 'assets/hand.book/b.ink.svg');
    }).then(function (b) {
      T.same(b.pages.map(function (p) { return p.file; }), ['a.ink.svg', 'b.ink.svg'], 'the drawings of the folder in name order');
      T.eq(b.hasJson, false, 'no book.json yet');
      T.eq(b.ref, 'assets/hand.book/a.ink.svg', 'its first page is the cover');
      return ns.notebook.read(ids.pid, null);
    }).then(function (b) {
      T.ok(b.fresh && b.ref === null && b.pages.length === 1, 'nothing: a fresh book of one page');
    });
  });
  /* ================================================================ review fixes */

  function putFolder(pid, folder, entries) {
    return Promise.all(entries.map(function (e) { return ns.storage.putBlob(e[1], e[0]); })).then(function (refs) {
      entries.forEach(function (e, i) { ns.store.setFile(pid, folder + '/' + e[0], refs[i]); });
    });
  }

  T.test('the PDF export runs nothing a page file holds', function () {
    ids = project();
    var good = ns.ink.serialize({ elements: [ns.ink.engine.makeShape('rect', [10, 10], [80, 60], { color: '#2f6fb3', width: 4 })], page: { w: 200, h: 150 } });
    var hostile = good.replace(/(<svg\b[^>]*>)/, '$1<script>window.__nbx1=1</script>' +
      '<image href="data:image/png;base64,AAAA" onerror="window.__nbx2=1"/>' +
      '<animate onbegin="window.__nbx3=1" attributeName="x" dur="0.1s"/>' +
      '<style>body{display:none}</style>' +
      '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="window.__nbx6=1"/></div></foreignObject>');
    var foreign = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="50" height="50" onload="window.__nbx4=1"><script>window.__nbx5=1</script><rect width="50" height="50" fill="#c4314b"/></svg>';
    var json = JSON.stringify({ mindroot: 'book', version: 1, mode: 'pages', pages: [{ file: '001.ink.svg' }, { file: '002.ink.svg' }] });
    var out = null;
    return putFolder(ids.pid, 'assets/x.book', [['001.ink.svg', hostile], ['002.ink.svg', foreign], ['book.json', json]]).then(function () {
      return ns.notebook.read(ids.pid, 'assets/x.book/001.ink.svg');
    }).then(function (book) {
      return ns.notebook.exportPdf(book, { print: false });
    }).then(function (o) {
      out = o;
      return T.sleep(400);
    }).then(function () {
      var sheet = document.querySelector('.nb-print');
      T.ok(!!sheet, 'the print sheet is in the page');
      T.eq(sheet.querySelectorAll('.nb-print__page').length, 2, 'both pages');
      T.eq(sheet.querySelectorAll('script, style, foreignObject, animate, set').length, 0, 'no script, style, foreign HTML or animation inlined');
      var handlers = 0;
      Array.prototype.forEach.call(sheet.querySelectorAll('*'), function (el) {
        Array.prototype.forEach.call(el.attributes, function (a) { if (/^on/i.test(a.name)) handlers++; });
      });
      T.eq(handlers, 0, 'no event attribute');
      T.same([window.__nbx1, window.__nbx2, window.__nbx3, window.__nbx4, window.__nbx5, window.__nbx6], [undefined, undefined, undefined, undefined, undefined, undefined], 'nothing ran');
      T.eq(sheet.querySelectorAll('.nb-print__page')[0].querySelectorAll('[stroke="#2f6fb3"]').length, 1, 'the page\'s own drawing is printed');
      var pic = sheet.querySelectorAll('.nb-print__page')[1].querySelector('image');
      T.ok(pic && /^data:image\/svg\+xml;base64,/.test(pic.getAttribute('href')), 'a page that is not ours is printed as a picture of itself');
      T.ok(getComputedStyle(document.body).display !== 'none', 'and the app is not restyled');
      out.cleanup();
      T.eq(document.querySelector('.nb-print'), null, 'cleaned up');
    });
  });

  T.test('a first page put back while no notebook is open is the cover again', function () {
    ids = project();
    var folder = 'assets/garden-board.book';
    view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: null, kind: 'board', focus: false });
    var entry = null;
    return view.ready.then(function () {
      draw(view, 200, 200, 400, 300);
      return settle(view);
    }).then(function () {
      return view.addPage();
    }).then(function () { return settle(view); }).then(function () {
      return view.deletePage(1);
    }).then(function () { return settle(view); }).then(function () {
      T.ok(mapText(ids).indexOf('board: ' + folder + '/002.ink.svg') > 0, 'the first page deleted: the marker names the second');
      return view.close();
    }).then(function () {
      entry = ns.store.trash(ids.pid).filter(function (e) { return e.path === folder + '/001.ink.svg'; })[0];
      var steps = ns.store.historyState().undoCount;
      ns.store.restoreTrash(ids.pid, entry.id);
      return T.until(function () { return mapText(ids).indexOf('board: ' + folder + '/001.ink.svg') > 0; }, 4000, 'the marker to name the first page').then(function () {
        T.ok(true, 'restored with no notebook open: the marker names the first page again');
        T.eq(ns.store.historyState().undoCount, steps + 1, 'in the restore\'s own step');
        ns.store.undo();
        T.ok(mapText(ids).indexOf('board: ' + folder + '/002.ink.svg') > 0, 'one undo takes back the restore and the marker together');
        ns.store.redo();
      });
    }).then(function () {
      /* A map left behind (by an older version, by hand): the next stroke
       * puts it right. */
      var behind = mapText(ids).replace(folder + '/001.ink.svg', folder + '/002.ink.svg');
      ns.store.setMapText(ids.pid, ids.mid, behind, { label: 'test' });
      view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: folder + '/002.ink.svg', kind: 'board', focus: false });
      return view.ready;
    }).then(function () {
      T.eq(view.book().pages[0].file, '001.ink.svg', 'the notebook opens on its real first page');
      draw(view, 220, 220, 380, 300);
      return settle(view);
    }).then(function () {
      T.ok(mapText(ids).indexOf('board: ' + folder + '/001.ink.svg') > 0, 'a stroke names the first page again');
      return view.close();
    });
  });

  /* Boards made before the folder names went English were called
   * '<map>-lavagna.book'. The marker names the folder, so such a board opens
   * as it is and its new pages land in it: nothing is renamed, nothing is
   * made beside it. */
  T.test('a board in a folder named by an earlier version keeps its folder', function () {
    ids = project();
    var made = null;
    var old = 'assets/garden-lavagna.book';
    view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: null, kind: 'board', focus: false });
    return view.ready.then(function () {
      draw(view, 200, 200, 400, 300);
      return settle(view);
    }).then(function () {
      made = view.book().folder;
      T.eq(made, 'assets/garden-board.book', 'a new board gets the English folder name');
      return view.close();
    }).then(function () {
      var p = ns.store.project(ids.pid);
      Object.keys(p.files).forEach(function (k) {
        if (k.indexOf(made + '/') === 0) ns.store.setFile(ids.pid, old + k.slice(made.length), p.files[k], { label: 'test' });
      });
      ns.store.setMapText(ids.pid, ids.mid, mapText(ids).split(made).join(old), { label: 'test' });
      view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: old + '/001.ink.svg', kind: 'board', focus: false });
      return view.ready;
    }).then(function () {
      T.eq(view.book().folder, old, 'it opens from the folder the marker names');
      return view.addPage();
    }).then(function () { return settle(view); }).then(function () {
      T.same(Object.keys(files(ids.pid, old)).sort(), ['001.ink.svg', '002.ink.svg', 'book.json'], 'the new page is written into the old folder');
      T.ok(mapText(ids).indexOf('<!-- board: ' + old + '/001.ink.svg -->') === 0, 'and the marker still names it');
      return view.close();
    });
  });

  T.test('a page added to an old Excalidraw drawing: both pages are ours', function () {
    var old = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><!-- svg-source:excalidraw --><rect x="10" y="10" width="50" height="30" fill="#c4314b"/></svg>';
    return ns.storage.putBlob(old, 'ancient.excalidraw.svg').then(function (ref) {
      ids = project('# Garden\n\n- Tomatoes ![](assets/ancient.excalidraw.svg)\n');
      ns.store.setFile(ids.pid, 'assets/ancient.excalidraw.svg', ref);
      view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: 'assets/ancient.excalidraw.svg', kind: 'node', nodePath: '0', focus: false });
      return view.ready;
    }).then(function () {
      return view.addPage();
    }).then(function () { return settle(view); }).then(function () {
      var b = view.book();
      T.eq(b.folder, 'assets/ancient.book', 'moved into a folder');
      T.same(b.pages.map(function (p) { return p.file; }), ['001.ink.svg', '002.ink.svg'], 'two pages');
      T.ok(mapText(ids).indexOf('![](assets/ancient.book/001.ink.svg)') > 0, 'the reference follows');
      return text(ids, b.folder + '/001.ink.svg');
    }).then(function (svg) {
      var parsed = ns.ink.parse(svg);
      T.eq(parsed.kind, 'ink', 'the first page is a drawing of ours, not the Excalidraw bytes');
      T.ok(!!parsed.background, 'with the old drawing behind its scene');
      T.ok(svg.indexOf('svg-source:excalidraw') < 0, 'the old markup only as a picture inside it');
      return view.close();
    });
  });

  T.test('undo in the editor is the app\'s: a setting goes back, the strokes stay', function () {
    ids = project();
    view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: null, kind: 'board', focus: false });
    var count = 0;
    return view.ready.then(function () {
      draw(view, 200, 200, 400, 300);
      return settle(view);
    }).then(function () {
      draw(view, 220, 260, 420, 330);
      return settle(view);
    }).then(function () {
      return view.setSetting({ paper: { type: 'ruled' } });
    }).then(function () { return settle(view); }).then(function () {
      count = view.editor().elements().length;
      var steps = ns.store.historyState().undoCount;
      view.editor().el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
      return T.until(function () { return view.book().meta.paper.type === 'dots'; }, 4000, 'the paper to go back').then(function () {
        T.ok(true, 'Mod+Z in the editor took back the paper');
        T.eq(view.editor().elements().length, count, 'the strokes are still there');
        T.eq(ns.store.historyState().undoCount, steps - 1, 'one step back, no step of its own');
        T.eq(ns.store.historyState().redoLabelKey, 'notebook.label.settings', 'the setting is what redo would bring back');
        view.editor().redo();
        return T.until(function () { return view.book().meta.paper.type === 'ruled'; }, 4000, 'the redo');
      });
    }).then(function () {
      T.ok(true, 'and the editor\'s redo brings it back');
      draw(view, 240, 280, 430, 360);
      view.editor().undo();
      return T.until(function () { return view.editor().elements().length === count && ns.store.historyState().canRedo; }, 4000, 'the stroke to go');
    }).then(function () {
      T.eq(ns.store.historyState().redoLabelKey, 'notebook.label.draw', 'a stroke undone at once: written as its step, then undone');
      return view.close();
    });
  });

  T.test('a big picture as the paper: whole on the sheet, a light copy in the pages', function () {
    ids = project();
    var c = document.createElement('canvas');
    c.width = 900;
    c.height = 700;
    var g = c.getContext('2d');
    var px = g.createImageData(900, 700);
    var seed = 7;
    for (var i = 0; i < px.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      px.data[i] = seed & 255; px.data[i + 1] = (seed >> 8) & 255; px.data[i + 2] = (seed >> 16) & 255; px.data[i + 3] = 255;
    }
    g.putImageData(px, 0, 0);
    var url = c.toDataURL('image/png');
    var bin = atob(url.split(',')[1]);
    var bytes = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    T.ok(bytes.length > 1000000, 'a picture of ' + Math.round(bytes.length / 1024) + ' kB');
    var folder = 'assets/paper.book';
    var json = JSON.stringify({ mindroot: 'book', version: 1, mode: 'pages', paper: { type: 'image' }, backgroundImage: { file: 'background.png', w: 900, h: 700 }, pages: [{ file: '001.ink.svg' }] });
    var node = null;
    return putFolder(ids.pid, folder, [['background.png', new Blob([bytes], { type: 'image/png' })], ['book.json', json], ['001.ink.svg', ns.ink.serialize({ elements: [], page: M.pagePx(M.normalize({})) })]]).then(function () {
      ids.text = '# Garden\n\n- Tomatoes ![](' + folder + '/001.ink.svg)\n';
      ns.store.setMapText(ids.pid, ids.mid, ids.text, { label: 'test' });
      view = ns.notebook.open(host, { projectId: ids.pid, mapId: ids.mid, ref: folder + '/001.ink.svg', kind: 'node', nodePath: '0', focus: false });
      return view.ready;
    }).then(function () {
      return T.until(function () { return !!view.el.querySelector('.ink__paper-image image'); }, 6000, 'the picture on the sheet');
    }).then(function () {
      node = view.el.querySelector('.ink__paper-image image');
      T.eq(node.getAttribute('href').length, url.length, 'the sheet shows the picture whole');
      var cam = view.editor().camera();
      view.editor().setCamera({ x: cam.x, y: cam.y, k: cam.k * 2.5 });
      return T.sleep(80);
    }).then(function () {
      T.ok(view.el.querySelector('.ink__paper-image image') === node, 'a zoom moves the same node, the picture is not set again');
      draw(view, 300, 300, 420, 360);
      return settle(view);
    }).then(function () {
      return text(ids, folder + '/001.ink.svg');
    }).then(function (svg) {
      T.ok(/class="mr-image"/.test(svg), 'the page file carries the picture');
      T.ok(svg.length < 300 * 1024, 'a light copy of it: ' + Math.round(svg.length / 1024) + ' kB for the page');
      T.eq(ns.ink.parse(svg).elements.length, 1, 'with the stroke');
      return view.close();
    });
  });

  /* ================================================================ infinite notebooks: several canvases */

  T.test('the view state keeps the notebooks of a map in bounds', function () {
    var p = project();
    var cams = {};
    for (var i = 0; i < 260; i++) cams[M.pageName(i + 1)] = { x: i, y: -i, k: 1 };
    cams['002.ink.svg'] = { x: 'no', y: 0, k: 1 };
    ns.store.setMapView(p.pid, p.mid, { notebooks: { 'assets/a.book': { at: '003.ink.svg', cams: cams }, 'assets/b.book': { nothing: true }, '': { at: 'x' } } });
    var v = ns.store.mapView(p.pid, p.mid);
    T.same(Object.keys(v.notebooks), ['assets/a.book'], 'an entry with nothing to keep, or no name, is dropped');
    T.eq(v.notebooks['assets/a.book'].at, '003.ink.svg', 'the canvas shown');
    T.eq(Object.keys(v.notebooks['assets/a.book'].cams).length, 200, 'at most 200 cameras a notebook');
    T.eq(v.notebooks['assets/a.book'].cams['002.ink.svg'], undefined, 'a camera that is not one is dropped');
    T.same(ns.store.mapView(p.pid, p.mid).folds, [], 'the rest of the view as it was');
    ns.store.setMapView(p.pid, p.mid, { notebooks: null });
    T.eq(ns.store.mapView(p.pid, p.mid).notebooks, undefined, 'and taken away');
  });

  var cv = null;
  var cvIds = null;
  var cvFolder = 'assets/garden-board.book';

  function camOf(v) { var c = v.editor().camera(); return { x: Math.round(c.x), y: Math.round(c.y), k: Math.round(c.k * 1000) / 1000 }; }

  /* A camera of the person's: panned and zoomed a little from where it is,
   * the drawing still in sight. */
  function nudge(v, dx, dy, k) {
    var c = v.editor().camera();
    v.editor().setCamera({ x: Math.round(c.x + dx), y: Math.round(c.y + dy), k: Math.round(c.k * k * 1000) / 1000 });
    return camOf(v);
  }

  T.test('an infinite board gets more canvases, one shown at a time', function () {
    cvIds = project();
    cv = ns.notebook.open(host, { projectId: cvIds.pid, mapId: cvIds.mid, ref: null, kind: 'board', focus: false });
    return cv.ready.then(function () {
      T.ok(cv.el.querySelector('.nb__rail').hidden, 'one canvas: no rail');
      T.eq(cv.el.querySelector('[data-nb="pages"]').getAttribute('aria-label'), 'Canvases', 'the pages button speaks of canvases');
      draw(cv, 200, 200, 400, 300);
      return settle(cv);
    }).then(function () {
      var steps = ns.store.historyState().undoCount;
      return cv.addPage().then(function () { return settle(cv); }).then(function () {
        T.eq(ns.store.historyState().undoCount, steps + 1, 'one step');
        T.eq(undoLabel(), 'notebook.label.addCanvas', 'labelled: add a canvas');
      });
    }).then(function () {
      var b = cv.book();
      T.eq(b.meta.mode, 'infinite', 'still an infinite notebook');
      T.same(b.pages.map(function (p) { return p.file; }), ['001.ink.svg', '002.ink.svg'], 'two page files, as pages are');
      T.same([cv.page(), cv.active(), cv.editor().pageId()], [2, 1, '002.ink.svg'], 'the new canvas is the one shown');
      T.eq(cv.editor().elements().length, 0, 'empty');
      T.eq(cv.editor().page(), null, 'and without edges');
      var rail = cv.el.querySelector('.nb__rail');
      T.same([rail.hidden, rail.getAttribute('aria-valuetext'), rail.querySelectorAll('.nb__tick').length], [false, 'Canvas 2 of 2', 2], 'the rail: a stretch per canvas');
      return text(cvIds, cvFolder + '/book.json');
    }).then(function (json) {
      var raw = JSON.parse(json);
      T.same([raw.mode, raw.pages.length], ['infinite', 2], 'book.json: mode infinite with its pages');
      draw(cv, 100, 120, 160, 200);
      return settle(cv);
    }).then(function () {
      return Promise.all([text(cvIds, cvFolder + '/001.ink.svg'), text(cvIds, cvFolder + '/002.ink.svg')]);
    }).then(function (two) {
      T.same([ns.ink.parse(two[0]).elements.length, ns.ink.parse(two[1]).elements.length], [1, 1], 'each canvas its own file and strokes');
      T.eq(ns.ink.parse(two[1]).page, null, 'a canvas file has no page');
      T.ok(mapText(cvIds).indexOf('<!-- board: ' + cvFolder + '/001.ink.svg -->') === 0, 'the Markdown still names the first canvas');
    });
  });

  T.test('each canvas keeps its own camera', function () {
    var two = nudge(cv, 40, 30, 1.3);
    T.eq(cv.goTo(1), true, 'canvas 1 shown');
    T.same([cv.active(), cv.editor().pageId(), cv.editor().elements().length], [0, '001.ink.svg', 1], 'with its own drawing');
    T.ok(camOf(cv).k !== two.k, 'and not the camera of canvas 2');
    var one = nudge(cv, -20, 10, 0.8);
    cv.goTo(2);
    T.same(camOf(cv), two, 'canvas 2 again: its camera back');
    cv.goTo(1);
    T.same(camOf(cv), one, 'canvas 1: its own');
    cv.goTo(2);
    cv.editor().setCamera({ x: -5000, y: -4000, k: 1 });
    cv.goTo(1);
    cv.goTo(2);
    T.same(camOf(cv), { x: -5000, y: -4000, k: 1 }, 'panned away from the drawing (to draw elsewhere): kept as it was');
    cv.editor().setCamera(two);
  });

  T.test('Page Down and Page Up on the sheet switch canvases', function () {
    var ink = cv.el.querySelector('.ink');
    ink.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }));
    T.eq(cv.active(), 0, 'Page Up: the canvas before');
    ink.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
    T.eq(cv.active(), 1, 'Page Down: the one after');
    ink.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
    T.eq(cv.active(), 1, 'none after the last');
  });

  T.test('the rail: a press on a stretch, a swipe along it', function () {
    var track = cv.el.querySelector('.nb__track');
    var r = track.getBoundingClientRect();
    function press(type, y) {
      track.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + r.width / 2, clientY: y, bubbles: true, cancelable: true }));
    }
    press('pointerdown', r.top + 5);
    press('pointerup', r.top + 5);
    T.eq(cv.active(), 0, 'a press on the first stretch shows canvas 1');
    var y = r.top + r.height * 0.75;
    press('pointerdown', y);
    press('pointermove', y + 1);
    press('pointerup', y);
    T.eq(cv.active(), 1, 'a press on the second shows canvas 2');
    /* A swipe from the first stretch (off the handle, which is on 2). */
    press('pointerdown', r.top + 10);
    for (var j = 1; j <= 5; j++) press('pointermove', r.top + 10 + j * 8);
    press('pointerup', r.top + 50);
    T.eq(cv.active(), 1, 'a swipe down from the last stays on the last');
    cv.goTo(1);
    press('pointerdown', r.top + 50);
    for (var k = 1; k <= 5; k++) press('pointermove', r.top + 50 + k * 8);
    press('pointerup', r.top + 90);
    T.eq(cv.active(), 1, 'a swipe down on canvas 1: canvas 2');
  });

  T.test('a canvas duplicated, moved first, deleted and restored', function () {
    return cv.duplicatePage(1).then(function () { return settle(cv); }).then(function () {
      T.eq(undoLabel(), 'notebook.label.duplicateCanvas', 'labelled: duplicate the canvas');
      T.same(cv.book().pages.map(function (p) { return p.file; }), ['001.ink.svg', '003.ink.svg', '002.ink.svg'], 'the copy right after it');
      T.same([cv.active(), cv.editor().elements().length], [1, 1], 'the copy is shown, with the drawing');
      return cv.movePage(3, 1);
    }).then(function () { return settle(cv); }).then(function () {
      T.eq(undoLabel(), 'notebook.label.moveCanvas', 'labelled: move the canvas');
      T.same(cv.book().pages.map(function (p) { return p.file; }), ['002.ink.svg', '001.ink.svg', '003.ink.svg'], 'canvas 2 first');
      T.eq(cv.editor().pageId(), '003.ink.svg', 'the canvas shown stays shown');
      T.ok(mapText(cvIds).indexOf('<!-- board: ' + cvFolder + '/002.ink.svg -->') === 0, 'the Markdown names the new first canvas, in the same step');
      return cv.deletePage(3);
    }).then(function () { return settle(cv); }).then(function () {
      T.eq(undoLabel(), 'notebook.label.deleteCanvas', 'labelled: move the canvas to the trash');
      T.same(cv.book().pages.map(function (p) { return p.file; }), ['002.ink.svg', '001.ink.svg'], 'two left');
      T.eq(cv.editor().pageId(), '001.ink.svg', 'the canvas shown went: the one before it is shown');
      var entry = ns.store.trash(cvIds.pid).filter(function (e) { return e.path === cvFolder + '/003.ink.svg'; })[0];
      T.ok(entry && /canvas 3/.test(entry.owner), 'in the trash, named as a canvas: ' + (entry && entry.owner));
      ns.store.restoreTrash(cvIds.pid, entry.id);
      return T.until(function () { return cv.pages() === 3; }, 4000, 'the restore');
    }).then(function () {
      T.same(cv.book().pages.map(function (p) { return p.file; }), ['002.ink.svg', '001.ink.svg', '003.ink.svg'], 'back where it was');
      T.eq(cv.editor().pageId(), '001.ink.svg', 'the canvas shown stays shown');
      ns.store.undo();
      return T.until(function () { return cv.pages() === 2; }, 4000, 'the undo of the restore');
    }).then(function () {
      ns.store.redo();
      return T.until(function () { return cv.pages() === 3; }, 4000, 'the redo');
    }).then(function () { T.ok(true, 'undo and redo follow'); });
  });

  T.test('closed and opened again: the canvas shown and the cameras are remembered', function () {
    cv.goTo(3);
    var want = nudge(cv, 15, 25, 1.5);
    return cv.close().then(function () {
      var books = ns.store.mapView(cvIds.pid, cvIds.mid).notebooks;
      var entry = books && books[cvFolder];
      T.ok(!!entry, 'kept in the map\'s view state, by folder');
      T.eq(entry && entry.at, '003.ink.svg', 'the canvas shown');
      T.same(entry && entry.cams['003.ink.svg'], want, 'its camera');
      T.eq(Object.keys(entry ? entry.cams : {}).length, 3, 'a camera for each canvas');
      cv = ns.notebook.open(host, { projectId: cvIds.pid, mapId: cvIds.mid, ref: cvFolder + '/002.ink.svg', kind: 'board', focus: false });
      return cv.ready;
    }).then(function () {
      T.same([cv.page(), cv.editor().pageId()], [3, '003.ink.svg'], 'opens on the canvas left');
      T.same(camOf(cv), want, 'under its camera');
      cv.editor().setCamera({ x: -9000, y: -9000, k: 1 });
      return cv.close();
    }).then(function () {
      cv = ns.notebook.open(host, { projectId: cvIds.pid, mapId: cvIds.mid, ref: cvFolder + '/002.ink.svg', kind: 'board', focus: false });
      return cv.ready;
    }).then(function () {
      var c = camOf(cv);
      T.ok(c.x !== -9000, 'a remembered camera that would show none of the drawing (another screen): the drawing is fitted instead');
      return cv.close();
    });
  });

  T.test('PDF: a page per drawn canvas, cut to it; PNG: the canvas asked for', function () {
    var shape = function (x, y, w, h) { return ns.ink.engine.makeShape('rect', [x, y], [x + w, y + h], { color: '#2f6fb3', width: 4 }); };
    var a = ns.ink.serialize({ elements: [shape(0, 0, 400, 100)] });
    var b = ns.ink.serialize({ elements: [] });
    var c = ns.ink.serialize({ elements: [shape(-50, -50, 100, 300)] });
    return ns.notebook.read(cvIds.pid, cvFolder + '/002.ink.svg').then(function (book) {
      T.eq(book.pages.length, 3, 'three canvases');
      return ns.notebook.exportPdf(book, { print: false, texts: [a, b, c] }).then(function (out) {
        T.eq(out.pages.length, 2, 'the empty canvas is left out');
        T.ok(out.pages[0].w > out.pages[0].h && out.pages[1].h > out.pages[1].w, 'each page cut to its own drawing: ' + JSON.stringify(out.pages));
        T.eq(document.querySelectorAll('.nb-print .nb-print__page > svg').length, 2, 'inlined as vectors');
        out.cleanup();
        return ns.notebook.exportPng(book, 2, { text: c, download: false, scale: 1 });
      }).then(function (blob) {
        return createImageBitmap(blob);
      }).then(function (bmp) {
        T.ok(bmp.height > bmp.width * 2, 'the PNG is canvas 3 (tall): ' + bmp.width + 'x' + bmp.height);
      });
    });
  });

  T.test('an older infinite book with several pages opens them as canvases; a lone drawing is one canvas', function () {
    var p = project();
    var json = JSON.stringify({ mindroot: 'book', version: 1, mode: 'infinite', paper: { type: 'dots' }, pages: [{ file: '001.ink.svg' }, { file: '002.ink.svg' }] });
    var one = ns.ink.serialize({ elements: [ns.ink.engine.makeShape('rect', [10, 10], [80, 60], { color: '#2f6fb3', width: 4 })] });
    var page2 = ns.ink.serialize({ elements: [], page: M.pagePx(M.normalize({})) });
    var v = null;
    return putFolder(p.pid, 'assets/old.book', [['book.json', json], ['001.ink.svg', one], ['002.ink.svg', page2]]).then(function () {
      v = ns.notebook.open(host, { projectId: p.pid, mapId: p.mid, ref: 'assets/old.book/001.ink.svg', kind: 'node', nodePath: '0', focus: false });
      return v.ready;
    }).then(function () {
      T.same([v.mode(), v.pages(), v.page()], ['infinite', 2, 1], 'two canvases, the first shown');
      T.eq(v.editor().elements().length, 1, 'the first one\'s drawing');
      T.ok(!v.el.querySelector('.nb__rail').hidden, 'the rail is there');
      T.eq(Object.keys(files(p.pid, 'assets/old.book')).length, 3, 'nothing written by opening it');
      return v.close();
    }).then(function () {
      return ns.storage.putBlob(one, 'sketch.ink.svg');
    }).then(function (ref) {
      ns.store.setFile(p.pid, 'assets/sketch.ink.svg', ref);
      v = ns.notebook.open(host, { projectId: p.pid, mapId: p.mid, ref: 'assets/sketch.ink.svg', kind: 'node', nodePath: '0', focus: false });
      return v.ready;
    }).then(function () {
      T.same([v.mode(), v.pages(), v.el.querySelector('.nb__rail').hidden], ['infinite', 1, true], 'a lone drawing: one canvas, no rail');
      return v.close();
    });
  });

  T.test('switching to pages mode: each canvas a page, its drawing moved onto it', function () {
    var p = project();
    var v = ns.notebook.open(host, { projectId: p.pid, mapId: p.mid, ref: null, kind: 'board', focus: false });
    return v.ready.then(function () {
      draw(v, 200, 200, 300, 260);
      return settle(v);
    }).then(function () {
      return v.addPage();
    }).then(function () { return settle(v); }).then(function () {
      v.editor().setCamera({ x: 600, y: 500, k: 1 });
      draw(v, 20, 20, 120, 80);
      return settle(v);
    }).then(function () {
      var box = ns.ink.engine.contentBox(v.editor().elements(), null);
      T.ok(box[0] < 0, 'canvas 2 drawn left of its origin');
      return v.setSetting({ mode: 'pages' });
    }).then(function () { return settle(v); }).then(function () {
      T.same([v.mode(), v.pages()], ['pages', 2], 'two pages');
      return text(p, v.book().folder + '/' + v.book().pages[1].file);
    }).then(function (svg) {
      var parsed = ns.ink.parse(svg);
      var box = ns.ink.engine.contentBox(parsed.elements, null);
      T.ok(parsed.page && box[0] >= 0 && box[1] >= 0, 'the second page holds its drawing on the page');
      return v.close();
    });
  });

  T.test('canvases added before the first stroke are held; the stroke writes them in one step', function () {
    var p = project();
    var v = ns.notebook.open(host, { projectId: p.pid, mapId: p.mid, ref: null, kind: 'board', focus: false });
    var before = 0;
    return v.ready.then(function () {
      before = ns.store.historyState().undoCount;
      return v.addPage();
    }).then(function () { return settle(v); }).then(function () {
      T.same([v.pages(), v.page()], [2, 2], 'two canvases, the second shown');
      T.eq(Object.keys(files(p.pid)).length, 0, 'nothing written yet');
      T.eq(ns.store.historyState().undoCount, before, 'no step');
      draw(v, 200, 200, 400, 300);
      return settle(v);
    }).then(function () {
      var b = v.book();
      T.same(Object.keys(files(p.pid, b.folder)).sort(), ['001.ink.svg', '002.ink.svg', 'book.json'], 'the board is born with both canvases');
      T.eq(ns.store.historyState().undoCount, before + 1, 'in one step');
      T.ok(mapText(p).indexOf('<!-- board: ' + b.folder + '/001.ink.svg -->') === 0, 'the marker names the first canvas');
      return Promise.all([text(p, b.folder + '/001.ink.svg'), text(p, b.folder + '/002.ink.svg')]);
    }).then(function (two) {
      T.same([ns.ink.parse(two[0]).elements.length, ns.ink.parse(two[1]).elements.length], [0, 1], 'the stroke on the second canvas, the first empty');
      return v.addPage();
    }).then(function () { return settle(v); }).then(function () {
      T.eq(v.editor().pageId(), '003.ink.svg', 'a third canvas, shown');
      ns.store.undo();
      return T.until(function () { return v.pages() === 2 && v.editor().pageId() === '002.ink.svg'; }, 4000, 'the undo of the add');
    }).then(function () {
      T.same([v.page(), v.editor().elements().length], [2, 1], 'undone: the canvas before it is shown, with its stroke');
      return v.close();
    });
  });
})();
