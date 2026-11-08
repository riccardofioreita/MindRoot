/* session: the open map on the real index.html. A project made in the store
 * opens by itself (the session follows the store), draws, and announces it;
 * a click selects; a doc edit applied through the session is one labelled
 * step, on screen at once with its new node selected; a change written
 * elsewhere (the Markdown panel's way) is reloaded keeping the selection by
 * its words; undo and redo travel across maps and select where the step
 * says; view-only mode makes the session read-only; a map deleted while
 * open gives way to its neighbour, and the last one to the empty state;
 * pictures resolve to blob: URLs and are asked again when their bytes
 * change. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

var MAP_A = '# Root\n\n- Alpha\n  - Alpha one\n- Beta\n';
var MAP_B = '# Other\n\n- Xeno\n- Yarrow\n';
var MAP_C = '# Third\n\n- Zed\n';

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 8000, polling: 50 });
}

/* Records the bus events the session sends, in order. */
function listen(page) {
  return page.evaluate(function () {
    var ns = window.MindRoot;
    window.__ev = [];
    ['map:opened', 'map:rendered', 'map:closed', 'doc:changed', 'selection'].forEach(function (type) {
      ns.bus.on(type, function (d) {
        window.__ev.push({ type: type, path: d && d.path !== undefined ? d.path : undefined, origin: d && d.origin, mapId: d && d.mapId, cause: d && d.cause });
      });
    });
  });
}

function events(page, type) {
  return page.evaluate(function (type) { return window.__ev.filter(function (e) { return e.type === type; }); }, type);
}

function nodeTexts(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('#stage .mv-node:not(.mv-node--leaving) .mv-title .mv-text'), function (el) { return el.textContent; });
  });
}

function rendered(page, mapId) {
  return until(page, function (mid) {
    return window.__ev.some(function (e) { return e.type === 'map:rendered' && e.mapId === mid; });
  }, mapId);
}

function sessionState(page) {
  return page.evaluate(function () {
    var s = window.MindRoot.session;
    var c = s.current();
    return { mapId: c && c.mapId, projectId: c && c.projectId, selected: s.selected(), text: c && c.text, readOnly: s.readOnly() };
  });
}

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var page = await t.open();
  await listen(page);

  t.step('a project made in the store opens by itself');
  var ids = await page.evaluate(function (maps) {
    var ns = window.MindRoot;
    var p = ns.store.createProject({ name: 'Garden', maps: [{ name: 'Plants', text: maps[0] }, { name: 'Tools', text: maps[1] }, { name: 'Sheds', text: maps[2] }] });
    return { pid: p.id, a: p.maps[0].id, b: p.maps[1].id, c: p.maps[2].id };
  }, [MAP_A, MAP_B, MAP_C]);
  await rendered(page, ids.a);
  var st = await sessionState(page);
  t.eq(st.mapId, ids.a, 'the first map is open');
  t.eq(st.text, MAP_A, 'with its text');
  t.same(await nodeTexts(page), ['Root', 'Alpha', 'Alpha one', 'Beta'], 'every node drawn');
  var opened = await events(page, 'map:opened');
  t.eq(opened.length, 1, 'map:opened once');
  t.eq(opened[0].cause, 'project:create', 'with what opened it');
  var order = await page.evaluate(function () { return window.__ev.map(function (e) { return e.type; }); });
  t.check('map:rendered comes after map:opened', order.indexOf('map:rendered') > order.indexOf('map:opened'), order);
  await until(page, function (want) { return document.title === want; }, 'Plants - Garden - MindRoot');
  t.check('the tab title names map and project', true);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view === window.MindRoot.session.view && !!window.MindRoot.session.view.el.closest('#stage'); }), true, 'the view lives on #stage');
  var cur = await page.evaluate(function () {
    var c = window.MindRoot.session.current();
    return { hasState: !!c.state.byPath, tree: c.tree.text, keys: Object.keys(c.keys).length };
  });
  t.same(cur, { hasState: true, tree: 'Root', keys: 4 }, 'current() holds the parse, the tree and the lineage keys');

  t.step('a click selects, the background deselects');
  await page.click('#stage .mv-node[data-path="1"] .mv-text');
  await until(page, function () { return window.MindRoot.session.selected() === '1'; });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.selected(); }), '1', 'the view shows it');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.entry().title; }), 'Beta', 'entry() is the doc entry');
  var sel = await events(page, 'selection');
  t.eq(sel[sel.length - 1].path, '1', "bus 'selection' with the path");
  var box = await page.evaluate(function () {
    var r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.left + 40, y: r.bottom - 120 };
  });
  t.eq(await page.evaluate(function (b) { return window.MindRoot.session.view.pathAt(b.x, b.y); }, box), null, 'an empty spot');
  await page.mouse.click(box.x, box.y);
  await until(page, function () { return window.MindRoot.session.selected() === null; });
  t.check('a tap on the empty map deselects', true);

  t.step('an edit applied through the session');
  await page.evaluate(function () { window.MindRoot.session.select('1'); });
  var applied = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var r = ns.doc.addChild(c.state, '1', 'Beta child');
    return ns.session.apply(r, { label: 'store.label.editMap' });
  });
  t.eq(applied, true, 'apply() says it wrote');
  await until(page, function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage .mv-node .mv-text'), function (el) { return el.textContent === 'Beta child'; });
  });
  st = await sessionState(page);
  t.eq(st.selected, '1.0', 'the new node is selected');
  t.eq(st.text, '# Root\n\n- Alpha\n  - Alpha one\n- Beta\n  - Beta child\n', 'the store has the new text');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.selected(); }), '1.0', 'and the view shows it selected');
  var changed = await events(page, 'doc:changed');
  t.eq(changed[changed.length - 1].origin, 'map', "doc:changed {origin: 'map'}");
  var hs = await page.evaluate(function () { return window.MindRoot.store.historyState(); });
  t.eq(hs.undoCount, 2, 'one step (after the project)');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.title('history.undo'); }), 'Undo: edit the map', 'the undo command names the step');
  var inOrder = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var seen = [];
    var off = ns.bus.on('store', function (c) {
      if (c.type === 'map:text') seen.push(ns.session.current().text === ns.store.map(ids.pid, ids.a).text && ns.session.selected());
    });
    var c = ns.session.current();
    ns.session.apply(ns.doc.addSibling(c.state, '1.0', 'Beta two'), { label: 'store.label.editMap' });
    ns.store.setMapText(ids.pid, ids.a, ns.session.current().text.replace('- Beta two\n', ''), { origin: 'probe' });
    off();
    return seen;
  }, ids);
  t.same(inOrder, ['1.1', '1'], "a module hearing 'store' finds the session already up to date (apply, and elsewhere: the removed node gives way to its parent)");
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoCount; }), 4, 'two more steps');
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); window.MindRoot.commands.run('history.undo'); });
  t.eq((await sessionState(page)).text, '# Root\n\n- Alpha\n  - Alpha one\n- Beta\n  - Beta child\n', 'both undone');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.apply(null); }), false, 'a null result writes nothing');
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoCount; }), 2, 'and is no step');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.select('9.9'); }), false, 'select() refuses a path that is not a node');

  t.step('a change written elsewhere is reloaded, the selection kept by its words');
  await page.evaluate(function () { window.MindRoot.session.select('1'); });
  await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    ns.store.setMapText(ids.pid, ids.a, '# Root\n\n- Aardvark\n- Alpha\n  - Alpha one\n- Beta\n  - Beta child\n', { origin: 'source', key: 'source:' + ids.a });
  }, ids);
  st = await sessionState(page);
  t.eq(st.selected, '2', 'Beta moved down one place and stays selected');
  changed = await events(page, 'doc:changed');
  t.eq(changed[changed.length - 1].origin, 'source', 'doc:changed carries the origin');
  await until(page, function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage .mv-node .mv-text'), function (el) { return el.textContent === 'Aardvark'; });
  });
  t.check('drawn', true);
  await page.evaluate(function (ids) {
    window.MindRoot.store.setMapText(ids.pid, ids.a, '# Root\n\n- Aardvark\n- Alpha\n  - Alpha one\n- Bet\n  - Beta child\n', { origin: 'source', key: 'source:' + ids.a });
  }, ids);
  t.eq((await sessionState(page)).selected, '2', 'renamed under it: kept by its place');
  await page.evaluate(function (ids) {
    window.MindRoot.store.setMapText(ids.pid, ids.a, '# Root\n\n- Aardvark\n- Alpha\n  - Alpha one\n- Beta\n  - Beta child\n', { origin: 'source', key: 'source:' + ids.a });
  }, ids);

  t.step('a map with no nodes left draws nothing, and comes back');
  var empty = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var before = ns.session.current().text;
    ns.session.select('2');
    ns.store.setMapText(ids.pid, ids.a, '', { origin: 'source' });
    var out = { tree: ns.session.current().tree, selected: ns.session.selected(), nodes: document.querySelectorAll('#stage .mv-node:not(.mv-node--leaving)').length };
    ns.store.setMapText(ids.pid, ids.a, before, { origin: 'source' });
    out.back = ns.session.current().tree && ns.session.current().tree.text;
    return out;
  }, ids);
  t.same(empty, { tree: null, selected: null, nodes: 0, back: 'Root' }, 'no tree, no selection, no nodes; then the map again');
  await page.evaluate(function () { return window.MindRoot.session.view.settled(); });

  t.step('undo and redo travel across maps');
  await page.evaluate(function () { window.MindRoot.session.select('1.0'); });
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    ns.session.apply(ns.doc.rename(c.state, '1.0', 'Alpha first'), { label: 'store.label.editMap' });
  });
  t.eq((await sessionState(page)).selected, '1.0', 'renamed and still selected');
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.b); }, ids);
  await rendered(page, ids.b);
  t.eq((await sessionState(page)).mapId, ids.b, 'a sidebar-style switch opens the other map');
  t.same(await nodeTexts(page), ['Other', 'Xeno', 'Yarrow'], 'drawn');
  t.eq((await sessionState(page)).selected, null, 'nothing selected there yet');
  await page.evaluate(function () { window.MindRoot.session.select('1'); });
  /* Undo from the other map: back to Plants, the rename taken back. */
  await page.click('#stage .mv-node[data-path="0"] .mv-text');
  await page.keyboard.press('Control+Z');
  await until(page, function (a) { var c = window.MindRoot.session.current(); return c && c.mapId === a; }, ids.a);
  st = await sessionState(page);
  t.check('the undone text', /- Alpha one\n/.test(st.text), st.text);
  t.eq(st.selected, '1.0', 'the node that was selected when the step was made');
  await until(page, function () { var el = document.querySelector('.toast .toast__text'); return el && /^Undone: /.test(el.textContent); });
  t.eq(await page.textContent('.toast .toast__text'), 'Undone: edit the map', 'a toast says what was undone');
  await until(page, function () { return document.title === 'Plants - Garden - MindRoot'; });
  t.check('the title follows', true);
  /* Leave again and redo: back to Plants with the rename. */
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.c); }, ids);
  await rendered(page, ids.c);
  await page.evaluate(function () { window.MindRoot.commands.run('history.redo'); });
  await until(page, function (a) { var c = window.MindRoot.session.current(); return c && c.mapId === a; }, ids.a);
  st = await sessionState(page);
  t.check('redone', /- Alpha first\n/.test(st.text), st.text);
  t.eq(st.selected, '1.0', 'selected where the step landed');
  await until(page, function () {
    return Array.prototype.some.call(document.querySelectorAll('#stage .mv-node .mv-text'), function (el) { return el.textContent === 'Alpha first'; });
  });
  t.check('on screen', true);
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.title('history.redo'); }), 'Nothing to redo', 'the redo command says so');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('history.redo'); }), false, 'and is off');
  /* The toast's own action undoes exactly that step. */
  await until(page, function () { var el = document.querySelector('.toast .toast__text'); return el && /^Redone: /.test(el.textContent); });
  await page.click('.toast .toast__action');
  await until(page, function () { var c = window.MindRoot.session.current(); return c && /- Alpha one\n/.test(c.text); });
  t.check("the toast's Undo takes it back", true);
  await page.evaluate(function () { window.MindRoot.commands.run('history.redo'); });
  t.check('redo again', /- Alpha first\n/.test((await sessionState(page)).text));
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(page, function () { var el = document.querySelector('.toast:not([hidden]) .toast__text'); return el && /^Undone: /.test(el.textContent); });
  await page.evaluate(function () { var c = window.MindRoot.session.current(); window.MindRoot.store.setMapText(c.projectId, c.mapId, c.text + '- Another\n'); });
  await until(page, function () { return !document.querySelector('.toast:not([hidden]) .toast__action'); });
  t.check('a new edit clears the redo, and the toast offering it goes too', true);

  t.step('making a map and taking it back returns to where you were');
  var made = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var m = ns.store.createMap(ids.pid, { name: 'Fresh' });
    var opened = ns.session.current().mapId === m.id;
    ns.commands.run('history.undo');
    return { opened: opened, now: ns.session.current().mapId, here: ns.store.here().mapId };
  }, ids);
  t.same(made, { opened: true, now: ids.a, here: ids.a }, 'undoing "new map" opens Plants again, not a neighbour of the map that went');
  await page.waitForTimeout(0);
  t.eq(await page.evaluate(function () { return window.MindRoot.store.here().mapId; }), ids.a, 'and the store still says so afterwards');
  var dup = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var m = ns.store.duplicateMap(ids.pid, ids.a);
    var opened = ns.session.current().mapId === m.id;
    ns.commands.run('history.undo');
    return { opened: opened, now: ns.session.current().mapId };
  }, ids);
  t.same(dup, { opened: true, now: ids.a }, 'the same for "duplicate map"');
  await page.waitForTimeout(0);
  t.eq(await page.evaluate(function () { return window.MindRoot.store.here().mapId; }), ids.a, 'the store agrees');
  await rendered(page, ids.a);

  t.step('open() on the map already open still selects what it is asked to');
  var sameMap = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    ns.session.select(null);
    return ns.session.open(ids.pid, ids.a, { select: '1' }).then(function (ok) {
      var first = ns.session.selected();
      return ns.session.open(ids.pid, ids.a, { where: { selectPath: '0' } }).then(function () {
        return { ok: ok, first: first, second: ns.session.selected(), view: ns.session.view.selected() };
      });
    });
  }, ids);
  t.same(sameMap, { ok: true, first: '1', second: '0', view: '0' }, 'a search hit on the open map selects its node');

  t.step('an edit that chose its selection is redone onto it');
  var redoSel = await page.evaluate(function () {
    var ns = window.MindRoot;
    ns.session.select('1');
    var c = ns.session.current();
    ns.session.apply(ns.doc.addSibling(c.state, '1', 'Gamma'), { label: 'store.label.editMap', select: '0' });
    var applied = ns.session.selected();
    ns.commands.run('history.undo');
    var undone = ns.session.selected();
    ns.commands.run('history.redo');
    var redone = ns.session.selected();
    ns.commands.run('history.undo');
    return { applied: applied, undone: undone, redone: redone };
  });
  t.same(redoSel, { applied: '0', undone: '1', redone: '0' }, 'redo lands where the edit did, not on the new node');
  t.eq(await page.evaluate(function () { return /Gamma/.test(window.MindRoot.session.current().text); }), false, 'taken back again');

  t.step('folds are kept as words, through edits that move them');
  await page.evaluate(function () { window.MindRoot.session.view.fold('1', true); });
  var folds = await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.a).folds; }, ids);
  t.same(folds, ['\u0000', 'Root\u001fAlpha'], 'a fold is written as its lineage key (after the folded-by-hand mark)');
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    ns.session.apply(ns.doc.addSibling(c.state, '0', 'Ant'), { label: 'store.label.editMap' });
  });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded('2'); }), true, 'the folded node moved to a new path and stays folded');
  folds = await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.a).folds; }, ids);
  t.same(folds, ['\u0000', 'Root\u001fAlpha'], 'and its key is unchanged');
  /* The knob is a report: the session folds. */
  /* Measured once the map has landed (an edit just moved it). */
  function knobAt(path) {
    return page.evaluate(function (p) {
      return window.MindRoot.session.view.settled().then(function () {
        var k = document.querySelector('#stage .mv-knob[data-path="' + p + '"] .mv-knob-dot').getBoundingClientRect();
        return { x: k.left + k.width / 2, y: k.top + k.height / 2 };
      });
    }, path);
  }
  var kp = await knobAt('2');
  await page.mouse.click(kp.x, kp.y);
  await until(page, function () { return window.MindRoot.session.view.isFolded('2') === false; });
  t.check('a click on the knob unfolds', true);
  t.same(await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.a).folds; }, ids), ['\u0000'], 'and that is written (nothing folded, by hand)');
  /* Apart from the first click by more than a double click's span. */
  await page.waitForTimeout(450);
  kp = await knobAt('2');
  await page.mouse.click(kp.x, kp.y);
  await until(page, function () { return window.MindRoot.session.view.isFolded('2') === true; });
  t.same(await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.a).folds; }, ids), ['\u0000', 'Root\u001fAlpha'], 'folded again by the knob');
  await page.evaluate(function () { window.MindRoot.session.view.fold('2', false); });

  t.step('view-only mode makes the session read-only');
  await page.keyboard.press('Control+E');
  t.eq((await sessionState(page)).readOnly, true, 'readOnly() in view-only mode');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.options().readOnly; }), true, 'the view knows');
  var refused = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var before = c.text;
    var ok = ns.session.apply(ns.doc.addChild(c.state, '0', 'Nope'), { label: 'store.label.editMap' });
    return { ok: ok, same: ns.session.current().text === before, undo: ns.commands.enabled('history.undo') };
  });
  t.same(refused, { ok: false, same: true, undo: false }, 'apply() and undo refuse');
  await page.keyboard.press('Escape');
  t.eq((await sessionState(page)).readOnly, false, 'Escape gives editing back');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.options().readOnly; }), false, 'to the view too');

  t.step('pictures come out of storage as blob: URLs, and are asked again when their bytes change');
  await page.evaluate(async function (ids) {
    var ns = window.MindRoot;
    var png = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="#c33"/></svg>';
    var ref = await ns.storage.putBlob(new Blob([png], { type: 'image/svg+xml' }), 'dot.svg');
    ns.store.setFile(ids.pid, 'assets/dot.svg', ref);
    var c = ns.session.current();
    ns.session.apply({ text: c.text + '- ![dot](assets/dot.svg) Pic\n' }, { label: 'store.label.editMap' });
  }, ids);
  await until(page, function () { var img = document.querySelector('#stage img.mv-img[data-src="assets/dot.svg"]'); return img && /^blob:/.test(img.getAttribute('src') || ''); });
  var src1 = await page.getAttribute('#stage img.mv-img[data-src="assets/dot.svg"]', 'src');
  t.check('a blob: URL', /^blob:/.test(src1), src1);
  await page.evaluate(async function (ids) {
    var ns = window.MindRoot;
    var png = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><rect width="20" height="12" fill="#3c3"/></svg>';
    var ref = await ns.storage.putBlob(new Blob([png], { type: 'image/svg+xml' }), 'dot.svg');
    ns.store.setFile(ids.pid, 'assets/dot.svg', ref);
  }, ids);
  await until(page, function (old) { var img = document.querySelector('#stage img.mv-img[data-src="assets/dot.svg"]'); return img && img.getAttribute('src') !== old && /^blob:/.test(img.getAttribute('src') || ''); }, src1);
  t.check('new bytes behind the same path: a new URL', true);
  var missing = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    ns.session.apply({ text: c.text + '- ![](assets/none.png) Gone\n' }, { label: 'store.label.editMap' });
    return true;
  });
  await until(page, function () { var img = document.querySelector('#stage img.mv-img[data-src="assets/none.png"]'); return img && img.getAttribute('data-broken') === 'true'; });
  t.check('a missing picture shows as missing', missing);
  var src2 = await page.getAttribute('#stage img.mv-img[data-src="assets/dot.svg"]', 'src');
  var other = await page.evaluate(function () {
    var p = window.MindRoot.store.createProject({ name: 'Yard', maps: [{ name: 'Pots', text: '# Pots\n\n- ![dot](assets/dot.svg) Pot\n' }] });
    return p.id;
  });
  await until(page, function (pid) { var c = window.MindRoot.session.current(); return c && c.projectId === pid; }, other);
  await until(page, function () { var img = document.querySelector('#stage img.mv-img[data-src="assets/dot.svg"]'); return img && img.getAttribute('data-broken') === 'true'; });
  t.check('another project with the same path and no such file: missing, not the first project\'s picture', true);
  await page.evaluate(async function (pid) {
    var ns = window.MindRoot;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#33c"/></svg>';
    var ref = await ns.storage.putBlob(new Blob([svg], { type: 'image/svg+xml' }), 'dot.svg');
    ns.store.setFile(pid, 'assets/dot.svg', ref);
  }, other);
  await until(page, function (old) { var img = document.querySelector('#stage img.mv-img[data-src="assets/dot.svg"]'); var s = img && img.getAttribute('src'); return s && /^blob:/.test(s) && s !== old; }, src2);
  t.check('its own bytes, its own URL', true);
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.a); }, ids);
  await until(page, function (a) { var c = window.MindRoot.session.current(); return c && c.mapId === a; }, ids.a);
  await until(page, function (old) { var img = document.querySelector('#stage img.mv-img[data-src="assets/dot.svg"]'); var s = img && img.getAttribute('src'); return s && /^blob:/.test(s); }, src2);
  var yardSrc = await page.evaluate(function (pid) {
    var ns = window.MindRoot;
    return ns.storage.blobURL(ns.store.project(pid).files['assets/dot.svg'].asset);
  }, other);
  var gardenSrc = await page.getAttribute('#stage img.mv-img[data-src="assets/dot.svg"]', 'src');
  t.check('back in the first project, its picture again', gardenSrc !== yardSrc, [gardenSrc, yardSrc]);
  await page.evaluate(function (pid) { window.MindRoot.store.deleteProject(pid); }, other);

  t.step('a map deleted while open gives way to its neighbour');
  var inked = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var real = ns.ink.flush;
    var n = 0;
    ns.ink.flush = function () { n++; return real.apply(this, arguments); };
    ns.store.setActive(ids.pid, ids.b);
    ns.ink.flush = real;
    return n;
  }, ids);
  t.eq(inked, 1, 'the drawings being edited are saved before the map is left');
  await rendered(page, ids.b);
  var heard = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    var seen = [];
    var off = ns.bus.on('store', function (c) {
      seen.push(c.type + (c.type === 'map:delete' ? ':' + (ns.session.current().mapId === ids.c) : ''));
    });
    ns.store.deleteMap(ids.pid, ids.b);
    return Promise.resolve().then(function () { return null; }).then(function () { off(); return seen; });
  }, ids);
  t.same(heard, ['map:delete:true', 'history:changed', 'ui'], 'later listeners hear the deletion (the neighbour already open), then the store being told');
  await until(page, function (c) { var x = window.MindRoot.session.current(); return x && x.mapId === c; }, ids.c);
  t.eq((await sessionState(page)).mapId, ids.c, 'the map after it, not the first');
  var lastOpen = (await events(page, 'map:opened')).pop();
  t.eq(lastOpen.cause, 'gone', "map:opened says it took a deleted map's place");
  t.eq(await page.evaluate(function (ids) { return window.MindRoot.store.here().mapId; }, ids), ids.c, 'and the store agrees');
  await rendered(page, ids.c);
  t.same(await nodeTexts(page), ['Third', 'Zed'], 'drawn');
  await page.evaluate(function (ids) { window.MindRoot.store.deleteMap(ids.pid, ids.c); }, ids);
  await until(page, function (a) { var x = window.MindRoot.session.current(); return x && x.mapId === a; }, ids.a);
  t.check('the last one gives way to the one before', true);
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(page, function (c) { var x = window.MindRoot.session.current(); return x && x.mapId === c; }, ids.c);
  t.check('undoing the delete brings the map back, open', true);

  t.step('the last map gone: nothing open, and the bars know');
  await page.evaluate(function (ids) { window.MindRoot.store.deleteProject(ids.pid); }, ids);
  await until(page, function () { return window.MindRoot.session.current() === null; });
  var closed = await events(page, 'map:closed');
  t.eq(closed.length >= 1, true, 'map:closed');
  t.eq(await page.evaluate(function () { return document.querySelectorAll('#stage .mv-node').length; }), 0, 'the stage is empty');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('view.fit'); }), false, 'zoom commands off');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.selected(); }), null, 'no selection');
  await until(page, function () { return document.title === 'MindRoot'; });
  t.check('the plain title', true);
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(page, function (a) { var x = window.MindRoot.session.current(); return x && x.projectId === a; }, ids.pid);
  t.check('undo brings the project back, open', true);
};
