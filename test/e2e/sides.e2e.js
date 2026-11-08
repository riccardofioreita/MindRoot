/* sides: which side of the central node a branch grows on is chosen on the
 * map, branch by branch, and written in the map ('<!-- side: left -->' on a
 * first-level branch's line; no marker is the right). On a root the node
 * toolbar offers 'add a branch on the left' and 'on the right' in place of
 * 'add a child'; Tab adds on the right, Alt+Shift+Left and Alt+Shift+Right
 * on either side; a branch added beside a left one, or under it, grows on
 * the left too; 'Move to the left / right side' (context menu, the toolbar's
 * more menu) and a drag onto the other half of the root, or beside a branch
 * already there, move a branch across, one undo step each; Alt+Up and
 * Alt+Down swap a branch with its neighbour on its own side. Help and the
 * palette list the new commands; the settings have no direction any more.
 * On a phone the thumb bar's two add buttons become the two sides while a
 * root is chosen. A map an older version showed on both sides (its view,
 * or the old global preference, said 'both') opens as it was and keeps
 * those sides as markers, in one undo step, 'keep the branch sides'. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var MAP = '# Root\n\n- A\n  - A1\n- B\n- C\n';
var TOPS = '- R1\n  - a\n- R2\n  - c <!-- side: left -->\n';
var OLD = '# Old\n\n- One\n  - One a\n  - One b\n- Two\n- Three\n- Four\n  - Four a\n- Five\n- Six\n';

function sides(page) {
  return page.evaluate(function () {
    var g = window.MindRoot.session.view.geometry();
    var out = {};
    Object.keys(g.nodes).forEach(function (p) { if (g.nodes[p].parent === '') out[p] = g.nodes[p].side; });
    return out;
  });
}

function sideOfWords(page, words) {
  return page.evaluate(function (w) {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var e = c.state.flat.filter(function (x) { return ns.doc.plainText(x) === w; })[0];
    if (!e) return null;
    var n = ns.session.view.geometry().nodes[e.path];
    return n ? n.side : null;
  }, words);
}

async function named(page, words) {
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  await page.keyboard.press('Control+A');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
  await E.until(page, function () { return !window.MindRoot.editor.renaming(); });
  await E.settled(page);
}

async function toolbarButton(page, id) {
  return page.evaluate(function (cmd) {
    var b = document.querySelector('.node-toolbar [data-command="' + cmd + '"]');
    if (!b || b.hidden) return null;
    var r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: b.getAttribute('aria-label'), icon: b.querySelector('use') ? b.querySelector('use').getAttribute('href') : null };
  }, id);
}

async function menuRow(page, label) {
  await E.until(page, function (l) {
    return Array.prototype.some.call(document.querySelectorAll('[role="menuitem"]'), function (m) { return m.textContent.indexOf(l) >= 0; });
  }, label);
  return page.evaluate(function (l) {
    var m = Array.prototype.filter.call(document.querySelectorAll('[role="menuitem"]'), function (x) { return x.textContent.indexOf(l) >= 0; })[0];
    var r = m.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
}

async function drag(page, fromPath, to) {
  var a = await E.box(page, fromPath);
  var sx = a.x + Math.min(14, a.w / 3);
  var sy = a.cy;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 2 });
  await page.mouse.move(sx + 20, sy + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await require('../fixtures/map/drop.js').decided(page);
  var lit = await page.evaluate(function () {
    var el = document.querySelector('.mv-node--drop');
    return el ? { path: el.getAttribute('data-path'), side: el.getAttribute('data-drop-side') } : null;
  });
  await page.mouse.up();
  await E.settled(page);
  return lit;
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Sides', MAP], ['Old', OLD], ['Tops', TOPS]]);
  var page = s.page;

  /* ------------------------------------------------------------------ */
  t.step('the root offers a branch on each side');
  await E.clickNode(page, '');
  await E.settled(page);
  var bar = await page.evaluate(function () {
    var shown = function (id) { var b = document.querySelector('.node-toolbar [data-command="' + id + '"]'); return !!b && !b.hidden; };
    return { left: shown('node.addLeft'), right: shown('node.addRight'), child: shown('node.addChild'), sibling: shown('node.addSibling') };
  });
  t.same(bar, { left: true, right: true, child: false, sibling: false }, 'on the root: left and right, no plain "add a child"');
  var right = await toolbarButton(page, 'node.addRight');
  var left = await toolbarButton(page, 'node.addLeft');
  t.eq(right.label, 'Add a branch on the right', 'the right button says so');
  t.eq(left.label, 'Add a branch on the left', 'the left button says so');
  t.same([left.icon, right.icon], ['#i-branch-left', '#i-branch-right'], 'with arrows pointing each way');
  t.check('left before right in the bar', left.x < right.x, [left.x, right.x]);
  var rootBox = await E.box(page, '');
  await page.mouse.click(rootBox.x + 10, rootBox.cy, { button: 'right' });
  await menuRow(page, 'Add a branch on the left');
  var order = await page.evaluate(function () {
    var rows = Array.prototype.map.call(document.querySelectorAll('[role="menuitem"]'), function (m) { return m.textContent; });
    var at = function (l) { for (var i = 0; i < rows.length; i++) if (rows[i].indexOf(l) >= 0) return i; return -1; };
    return [at('Add a branch on the left'), at('Add a branch on the right')];
  });
  t.check('the context menu lists the left first too', order[0] >= 0 && order[0] < order[1], order);
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('[role="menuitem"]'); });
  await E.select(page, '');
  await E.settled(page);
  left = await toolbarButton(page, 'node.addLeft');

  var steps = (await E.history(page)).count;
  await page.mouse.click(left.x, left.y);
  await named(page, 'West');
  t.eq(await E.text(page), MAP + '- West <!-- side: left -->\n', 'a left branch: at the end of the root\'s branches, with its marker');
  var h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.addLeft'], 'one step: add a branch on the left');
  t.eq(await sideOfWords(page, 'West'), 'left', 'drawn on the left');
  var geo = await page.evaluate(function () {
    var g = window.MindRoot.session.view.geometry();
    return { west: g.nodes['3'], root: g.nodes[''] };
  });
  t.check('left of the root', geo.west.x + geo.west.w < geo.root.x, geo);

  await E.clickNode(page, '');
  await E.settled(page);
  right = await toolbarButton(page, 'node.addRight');
  await page.mouse.click(right.x, right.y);
  await named(page, 'East');
  t.eq(await E.text(page), MAP + '- West <!-- side: left -->\n- East\n', 'a right branch: no marker');
  t.eq((await E.history(page)).key, 'editor.label.addRight', 'labelled add a branch on the right');
  t.eq(await sideOfWords(page, 'East'), 'right', 'drawn on the right');

  t.step('the other nodes keep "add a child"');
  await E.clickNode(page, '0');
  await E.settled(page);
  t.same(await page.evaluate(function () {
    var shown = function (id) { var b = document.querySelector('.node-toolbar [data-command="' + id + '"]'); return !!b && !b.hidden; };
    return [shown('node.addLeft'), shown('node.addRight'), shown('node.addChild'), shown('node.addSibling')];
  }), [false, false, true, true], 'a branch: child and sibling, no sides');

  /* ------------------------------------------------------------------ */
  t.step('keys: Tab on the root adds on the right, Alt+Shift+arrows on either side');
  await E.select(page, '');
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await named(page, 'West two');
  t.check('Alt+Shift+Left: a branch on the left', /- West two <!-- side: left -->\n/.test(await E.text(page)));
  t.eq(await sideOfWords(page, 'West two'), 'left', 'drawn there');
  await E.select(page, '');
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await named(page, 'East two');
  t.check('Alt+Shift+Right: a branch on the right', /- East two\n/.test(await E.text(page)));
  await E.select(page, '');
  await page.keyboard.press('Tab');
  await named(page, 'East three');
  t.check('Tab on the root: on the right', /- East three\n/.test(await E.text(page)));
  t.eq(await sideOfWords(page, 'East three'), 'right', 'drawn on the right');
  await E.select(page, '0');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('node.addLeft', { source: 'menu' }); }), false, 'the side keys are for a root only');

  t.step('what grows beside or under a left branch stays on the left');
  var westPath = await E.pathOf(page, 'West');
  await E.select(page, westPath);
  await page.keyboard.press('Enter');
  await named(page, 'West sibling');
  t.check('a sibling of a left branch carries the marker', /- West sibling <!-- side: left -->\n/.test(await E.text(page)));
  t.eq(await sideOfWords(page, 'West sibling'), 'left', 'and grows on the left');
  await E.select(page, westPath);
  await page.keyboard.press('Tab');
  await named(page, 'West child');
  t.check('a child needs no marker', /\n {2}- West child\n/.test(await E.text(page)));
  t.eq(await sideOfWords(page, 'West child'), 'left', 'it grows on its branch\'s side');

  /* ------------------------------------------------------------------ */
  t.step('Move to the left side, from the context menu: one step, and back');
  var bPath = await E.pathOf(page, 'B');
  var bb = await E.box(page, bPath);
  steps = (await E.history(page)).count;
  await page.mouse.click(bb.x + 10, bb.cy, { button: 'right' });
  t.eq(await page.evaluate(function () {
    return Array.prototype.some.call(document.querySelectorAll('[role="menuitem"]'), function (m) { return m.textContent.indexOf('Move to the right side') >= 0; });
  }), false, 'a right branch is offered the left only');
  var row = await menuRow(page, 'Move to the left side');
  await page.mouse.click(row.x, row.y);
  await E.settled(page);
  t.check('B carries the marker', /\n- B <!-- side: left -->\n/.test(await E.text(page)));
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.sideLeft'], 'one step: move to the left side');
  t.eq(await sideOfWords(page, 'B'), 'left', 'drawn on the left');
  t.eq(await E.selected(page), bPath, 'still chosen');
  await E.select(page, bPath);
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.run('node.sideRight', { source: 'menu' }); }), true, 'Move to the right side');
  await E.settled(page);
  t.check('back on the right, no marker', /\n- B\n/.test(await E.text(page)));
  await E.select(page, '0.0');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('node.sideLeft', { source: 'menu' }) || window.MindRoot.commands.enabled('node.sideRight', { source: 'menu' }); }), false, 'a deeper node has no side to move');

  t.step('the toolbar\'s more menu offers it too');
  await E.clickNode(page, bPath);
  await E.settled(page);
  await page.click('.node-toolbar .btn--more');
  row = await menuRow(page, 'Move to the left side');
  await page.mouse.click(row.x, row.y);
  await E.settled(page);
  t.eq(await sideOfWords(page, 'B'), 'left', 'B on the left again');
  await page.keyboard.press('Control+z');
  await E.until(page, function () { return /\n- B\n/.test(window.MindRoot.session.current().text); });
  t.eq(await sideOfWords(page, 'B'), 'right', 'Undo takes it back to the right');

  /* ------------------------------------------------------------------ */
  t.step('Alt+Up and Alt+Down swap with the neighbour on the same side');
  var before = await E.text(page);
  var ws = await E.pathOf(page, 'West sibling');
  await E.select(page, ws);
  await page.keyboard.press('Alt+ArrowUp');
  await E.settled(page);
  var order = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var g = ns.session.view.geometry();
    return c.state.root.children.filter(function (e) { return g.nodes[e.path].side === 'left'; })
      .sort(function (a, b) { return g.nodes[a.path].y - g.nodes[b.path].y; })
      .map(function (e) { return ns.doc.plainText(e); });
  });
  t.same(order, ['West sibling', 'West', 'West two'], 'up over the left branch above it, past the right ones between');
  t.eq(await E.selected(page), await E.pathOf(page, 'West sibling'), 'still chosen');
  t.check('one edit', before !== await E.text(page));
  await page.keyboard.press('Alt+ArrowDown');
  await E.settled(page);
  t.eq(await E.text(page), before, 'and down again where it was');

  /* ------------------------------------------------------------------ */
  t.step('a drag onto the other half of the root, or beside a branch there');
  /* The whole map in view, clear of the stage edges (where a drag pans). */
  async function frame() {
    await page.evaluate(function () { return window.MindRoot.session.view.fit({ animate: false, padding: 100 }); });
    await E.settled(page);
  }
  await frame();
  var cPath = await E.pathOf(page, 'C');
  var root = await E.box(page, '');
  steps = (await E.history(page)).count;
  var lit = await drag(page, cPath, { x: root.x + 6, y: root.cy });
  t.same(lit, { path: '', side: 'left' }, 'the root lit, its left side marked');
  t.check('C dropped on the left half: on the left', /\n- C <!-- side: left -->\n/.test(await E.text(page)));
  h = await E.history(page);
  t.same([h.count - steps, h.key], [1, 'editor.label.move'], 'one step: move the branch');
  t.eq(await sideOfWords(page, 'C'), 'left', 'drawn on the left');
  await frame();
  var east = await E.box(page, await E.pathOf(page, 'East'));
  cPath = await E.pathOf(page, 'C');
  await drag(page, cPath, { x: east.x + Math.min(20, east.w / 2), y: east.y + east.h * 0.12 });
  t.check('beside a right branch: on the right, its marker gone', /\n- C\n- East\n/.test(await E.text(page)), await E.text(page));
  t.eq(await sideOfWords(page, 'C'), 'right', 'drawn on the right');
  await frame();
  var wsBox = await E.box(page, await E.pathOf(page, 'West sibling'));
  await drag(page, '0.0', { x: wsBox.x + Math.min(20, wsBox.w / 2), y: wsBox.y + wsBox.h * 0.88 });
  t.check('a deeper node dropped beside a left branch: a left branch', /\n- A1 <!-- side: left -->\n/.test(await E.text(page)), await E.text(page));
  await frame();
  var west = await E.box(page, await E.pathOf(page, 'West'));
  await drag(page, await E.pathOf(page, 'A1'), { x: west.x + Math.min(20, west.w / 2), y: west.cy });
  t.check('and dropped under a branch: its marker goes, it grows on its parent\'s side', /\n {2}- A1\n/.test(await E.text(page)), await E.text(page));
  t.eq(await sideOfWords(page, 'A1'), 'left', 'under West, on the left');

  /* ------------------------------------------------------------------ */
  t.step('help and the palette know the new commands');
  var listed = await page.evaluate(function () {
    var C = window.MindRoot.commands;
    return ['node.addRight', 'node.addLeft', 'node.sideLeft', 'node.sideRight'].map(function (id) {
      var c = C.get(id);
      return c ? [C.label(id), (c.keys || []).map(function (k) { return C.keysLabel(k); }).join(' ')] : null;
    });
  });
  t.eq(listed[0][0], 'Add a branch on the right', 'registered: add on the right');
  t.eq(listed[1][0], 'Add a branch on the left', 'registered: add on the left');
  t.check('with their keys', listed[0][1].length > 0 && listed[1][1].length > 0, listed);
  t.same([listed[2][0], listed[3][0]], ['Move to the left side', 'Move to the right side'], 'and the two moves');
  await page.evaluate(function () { return window.MindRoot.commands.run('help.open', { source: 'menu' }); });
  await E.until(page, function () { return !!document.querySelector('.ws-help__row[data-command="node.addLeft"]'); });
  t.check('the help sheet lists the left first', await page.evaluate(function () {
    var l = document.querySelector('.ws-help__row[data-command="node.addLeft"]');
    var r = document.querySelector('.ws-help__row[data-command="node.addRight"]');
    return !!l && !!r && !!(l.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  }));
  t.check('the help sheet lists both, with their keys', await page.evaluate(function () {
    return ['node.addLeft', 'node.addRight'].every(function (id) {
      var r = document.querySelector('.ws-help__row[data-command="' + id + '"]');
      return r && r.querySelectorAll('kbd').length > 0;
    });
  }));
  t.check('and the side marker among the Markdown', await page.evaluate(function () { return document.querySelector('.ws-help').textContent.indexOf('<!-- side: left -->') >= 0; }));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('dialog.sheet[open]'); });
  await E.select(page, '');
  await page.keyboard.press('Control+k');
  await E.until(page, function () { return !!document.querySelector('dialog.palette[open]'); });
  await page.fill('dialog.palette[open] .palette__input', 'branch on the left');
  await E.until(page, function () { return window.MindRoot.palette.items().some(function (i) { return i.kind === 'command' && i.label === 'Add a branch on the left'; }); });
  t.check('the palette finds "Add a branch on the left"', true);
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('dialog.palette[open]'); });

  /* ------------------------------------------------------------------ */
  t.step('a left branch pasted deeper, or a top node moved under another, keeps no stray marker');
  var westNow = await E.pathOf(page, 'West');
  await E.select(page, westNow);
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  var clip = await page.evaluate(function () {
    var dt = new DataTransfer();
    document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  t.check('the copy carries the marker', /^- West <!-- side: left -->\n/.test(clip), clip);
  var leftBefore = ((await E.text(page)).match(/<!-- side: left -->/g) || []).length;
  await E.select(page, await E.pathOf(page, 'West child'));
  await page.evaluate(function () { window.MindRoot.session.view.el.focus(); });
  steps = (await E.history(page)).count;
  await page.evaluate(function (txt) {
    var dt = new DataTransfer();
    dt.setData('text/plain', txt);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, clip);
  await E.settled(page);
  var pastedText = await E.text(page);
  t.check('pasted under a deeper node: no marker on it', /\n {2}- West child\n {4}- West\n/.test(pastedText), pastedText);
  t.eq((pastedText.match(/<!-- side: left -->/g) || []).length, leftBefore, 'no new marker anywhere');
  t.eq((await E.history(page)).count - steps, 1, 'one step');
  await page.keyboard.press('Control+z');
  await E.settled(page);

  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mids[2]); }, { pid: s.pid, mids: s.mids });
  await E.settled(page);
  await E.select(page, await E.pathOf(page, 'R2'));
  steps = (await E.history(page)).count;
  await page.keyboard.press('Alt+ArrowRight');
  await E.settled(page);
  t.eq(await E.text(page), '- R1\n  - a\n  - R2\n    - c\n', 'a top node under the one above it: its branch loses the marker');
  t.eq((await E.history(page)).count - steps, 1, 'one step');
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mids[0]); }, { pid: s.pid, mids: s.mids });
  await E.settled(page);

  /* ------------------------------------------------------------------ */
  t.step('a map shown on both sides by an older version keeps its sides');
  var mig = await page.evaluate(function (ids) {
    var ns = window.MindRoot;
    ns.store.setMapView(ids.pid, ids.mids[1], { direction: 'both' });
    var before = ns.store.historyState().undoCount;
    return ns.session.open(ids.pid, ids.mids[1]).then(function () {
      return new Promise(function (r) { setTimeout(r, 200); });
    }).then(function () {
      return ns.session.view.settled();
    }).then(function () {
      var c = ns.session.current();
      var g = ns.session.view.geometry();
      var hs = ns.store.historyState();
      var out = {
        text: c.text,
        steps: hs.undoCount - before,
        key: hs.undoLabelKey,
        label: hs.undoLabel,
        view: ns.store.mapView(ids.pid, ids.mids[1]).direction,
        balance: ns.session.view.options().balance,
        sides: c.state.root.children.map(function (e) { return g.nodes[e.path].side; }),
        boxes: c.state.root.children.map(function (e) { return [g.nodes[e.path].x, g.nodes[e.path].y]; })
      };
      /* What the old balanced layout draws of the same map, for comparison. */
      return ns.session.view.setOptions({ balance: true }).then(function () {
        var o = ns.session.view.geometry();
        out.oldSides = c.state.root.children.map(function (e) { return o.nodes[e.path].side; });
        out.oldBoxes = c.state.root.children.map(function (e) { return [o.nodes[e.path].x, o.nodes[e.path].y]; });
        return ns.session.view.setOptions({ balance: false });
      }).then(function () { return out; });
    });
  }, { pid: s.pid, mids: s.mids });
  t.check('some branches were on the left', mig.sides.indexOf('left') > 0, mig.sides);
  t.same(mig.sides, mig.oldSides, 'each branch on the side the old balanced layout gave it');
  t.same(mig.boxes, mig.oldBoxes, 'and exactly where it drew it: nothing moved');
  t.check('written as markers in the map', (mig.text.match(/<!-- side: left -->/g) || []).length === mig.sides.filter(function (x) { return x === 'left'; }).length, mig.text);
  t.same([mig.steps, mig.key, mig.label], [1, 'session.label.keepSides', 'keep the branch sides'], 'one undo step: keep the branch sides');
  t.eq(mig.view, null, 'the old direction is let go');
  t.eq(mig.balance, false, 'the map now follows its markers');
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mids[0]); }, { pid: s.pid, mids: s.mids });
  await E.settled(page);
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mids[1]); }, { pid: s.pid, mids: s.mids });
  await E.settled(page);
  t.eq((await E.history(page)).key, 'session.label.keepSides', 'opened again: nothing more is written');
  await t.shot('migrated');

  /* ------------------------------------------------------------------ */
  t.step('the old global preference: every map that followed it keeps its sides');
  var ctx = await t.newContext({ viewport: { width: 1280, height: 800 } });
  await E.H.stubMissing(ctx, t);
  var p2 = await ctx.newPage();
  var s2 = await E.boot(t, [['Followed', OLD], ['Own', OLD]], { page: p2 });
  await p2.evaluate(function (ids) {
    var ns = window.MindRoot;
    ns.store.setMapView(ids.pid, ids.mids[1], { direction: 'right' });
    return ns.storage.flush();
  }, { pid: s2.pid, mids: s2.mids });
  await p2.evaluate(function () {
    /* Anything the page still holds goes out first, or leaving it would
     * write over the blob this test plants. */
    window.MindRoot.prefs.flush();
    var raw = JSON.parse(localStorage.getItem('mindroot2:prefs') || '{"v":1,"prefs":{}}');
    raw.prefs.direction = 'both';
    localStorage.setItem('mindroot2:prefs', JSON.stringify(raw));
  });
  /* A second tab opens while this one still holds the data (an older
   * version's tab, say): it cannot save the maps' views, so it must leave
   * the old preference for the tab that can - even when it writes other
   * preferences - and show the maps as they were meanwhile. */
  var p3 = await ctx.newPage();
  await p3.goto(p2.url());
  await p3.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await E.until(p3, function () { var c = window.MindRoot.session.current(); return !!c && !!c.text; }, null, 8000);
  await E.settled(p3);
  var ro = await p3.evaluate(function (ids) {
    var ns = window.MindRoot;
    var was = ns.prefs.get('branchText');
    ns.prefs.set('branchText', !was);
    ns.prefs.set('branchText', was);
    ns.prefs.flush();
    var c = ns.session.current();
    var g = ns.session.view.geometry();
    return {
      readOnly: ns.tabs.readOnly(),
      blob: JSON.parse(localStorage.getItem('mindroot2:prefs')).prefs.direction,
      balance: ns.session.balance(),
      sides: c.state.root.children.map(function (e) { return g.nodes[e.path].side; }),
      text: c.text
    };
  }, { pid: s2.pid, mids: s2.mids });
  /* The first tab, which loaded before the preference was planted, writes
   * one of its own: it must not drop the old one either. */
  var after = await p2.evaluate(function () {
    var ns = window.MindRoot;
    var was = ns.prefs.get('notesOpen');
    ns.prefs.set('notesOpen', !was);
    ns.prefs.set('notesOpen', was);
    ns.prefs.flush();
    return JSON.parse(localStorage.getItem('mindroot2:prefs')).prefs.direction;
  });
  t.eq(after, 'both', 'nor does the tab holding the data when it writes its own');
  t.eq(ro.readOnly, true, 'the second tab is read-only');
  t.eq(ro.blob, 'both', 'a read-only tab leaves the old preference in place, though it wrote another one');
  t.eq(ro.balance, true, 'and shows the map the old way meanwhile');
  t.check('some branches on the left there', ro.sides.indexOf('left') > 0, ro.sides);
  t.eq(/side:/.test(ro.text), false, 'without writing anything');
  await p3.close();
  await p2.reload();
  await p2.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await E.until(p2, function () { return /side: left/.test(window.MindRoot.session.current().text); }, null, 8000);
  var g2 = await p2.evaluate(function (ids) {
    var ns = window.MindRoot;
    ns.prefs.flush();
    return {
      key: ns.store.historyState().undoLabelKey,
      blob: JSON.parse(localStorage.getItem('mindroot2:prefs')).prefs.direction,
      own: ns.store.mapView(ids.pid, ids.mids[1]).direction
    };
  }, { pid: s2.pid, mids: s2.mids });
  t.eq(g2.key, 'session.label.keepSides', 'the map that followed the old setting kept its sides');
  t.eq(g2.blob, undefined, 'the old preference is gone from the saved blob');
  var own = await p2.evaluate(function (ids) {
    return window.MindRoot.session.open(ids.pid, ids.mids[1]).then(function () { return window.MindRoot.session.current().text; });
  }, { pid: s2.pid, mids: s2.mids });
  t.eq(own, OLD, 'a map that had chosen the right for itself is left as it was');
  await ctx.close();

  /* ------------------------------------------------------------------ */
  t.step('a phone: the thumb bar\'s add buttons become the two sides on a root');
  var phone = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await E.H.stubMissing(phone, t);
  var pp = await phone.newPage();
  var cdp = await phone.newCDPSession(pp);
  await E.boot(t, [['Phone', MAP]], { page: pp });
  async function tap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x, y: y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  function thumbIds() {
    return pp.evaluate(function () {
      return Array.prototype.map.call(document.querySelectorAll('#thumbbar [data-command]'), function (b) {
        return b.getAttribute('data-command') + (b.getAttribute('aria-disabled') === 'true' ? ':off' : '');
      });
    });
  }
  await E.select(pp, '');
  await E.until(pp, function () { return !!document.querySelector('#thumbbar [data-command="node.addLeft"]'); });
  var ids = await thumbIds();
  t.check('the root chosen: left and right', ids.indexOf('node.addRight') >= 0 && ids.indexOf('node.addLeft') >= 0 && ids.indexOf('node.addChild') < 0, ids);
  var lx = await E.rectOf(pp, '#thumbbar [data-command="node.addLeft"]');
  var rx = await E.rectOf(pp, '#thumbbar [data-command="node.addRight"]');
  t.check('the left one first, as in the node toolbar', ids.indexOf('node.addLeft') < ids.indexOf('node.addRight') && lx.x < rx.x, [ids, lx.x, rx.x]);
  t.eq(await pp.evaluate(function () { return document.querySelector('#thumbbar [data-command="node.addLeft"]').getAttribute('aria-label'); }), 'Add a branch on the left', 'labelled');
  t.eq(await pp.evaluate(function () { return document.querySelector('#thumbbar [data-command="node.addLeft"] use').getAttribute('href'); }), '#i-branch-left', 'with its arrow');
  var lb = await E.rectOf(pp, '#thumbbar [data-command="node.addLeft"]');
  await tap(lb.x + lb.w / 2, lb.y + lb.h / 2);
  await named(pp, 'Thumb west');
  t.check('a tap adds a branch on the left', /- Thumb west <!-- side: left -->\n/.test(await E.text(pp)));
  await E.select(pp, '0');
  await E.until(pp, function () { return !!document.querySelector('#thumbbar [data-command="node.addChild"]'); });
  ids = await thumbIds();
  t.check('a branch chosen: child and sibling again', ids.indexOf('node.addChild') >= 0 && ids.indexOf('node.addSibling') >= 0 && ids.indexOf('node.addLeft') < 0, ids);
  await phone.close();
};
