/* journey-desktop: a person's first hour with MindRoot on a 1440x900
 * laptop, driven the way they would drive it - mouse, keyboard, the bars,
 * the sidebar, the sheets - and checked by what the page then shows and
 * what the store keeps. One story, in order, on one page:
 *
 *   first start with the welcome map -> a new project from the sidebar ->
 *   nodes by keyboard (Tab, Enter, F2) -> undo and redo from the top bar ->
 *   a colour from the node toolbar -> a note -> a picture from a file -> a
 *   drawing -> the Markdown panel, typed into -> drag a node onto another
 *   -> export Markdown and PNG (the PNG carries the map) -> a branch to the
 *   trash and back -> a copy taken from the palette -> settings: dark
 *   theme, Italian, back -> help (F1) -> view only (Mod+E) -> a second map
 *   -> reload: everything is where it was, pictures included.
 *
 * Screenshots (test/out/journey-desktop-*.png) in light and dark. Every
 * wait is for a condition; the runner fails the suite on any network
 * request, page error or console error along the way. */
'use strict';

var fs = require('fs');
var M = require('../fixtures/media/helpers.js');

var VIEW = { width: 1440, height: 900 };

module.exports = async function (t) {
  var ctx = await t.newContext({ viewport: VIEW });
  var page = await ctx.newPage();
  var J = helpers(page);

  /* ------------------------------------------------------------ first start */
  t.step('first start');
  await t.open('welcome=1', { page: page });
  await J.settled();
  var first = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    return {
      projects: ns.store.projects().map(function (p) { return p.name; }),
      map: c && c.map.name,
      nodes: document.querySelectorAll('#stage .mv-node').length,
      title: document.title,
      layout: document.documentElement.getAttribute('data-layout'),
      sidebar: document.documentElement.getAttribute('data-sidebar')
    };
  });
  t.same(first.projects, ['MindRoot'], 'the welcome project is there');
  t.check('its map is open and drawn', first.map && first.nodes > 10, first);
  t.eq(first.title, first.map + ' - MindRoot', 'the window title names the map, and MindRoot once (the project is called MindRoot too)');
  t.eq(first.layout, 'expanded', 'a laptop gets the wide layout');
  t.check('the projects list is a column, open', first.sidebar !== 'closed', first);
  var bars = await J.barIds();
  t.same(bars.top, ['history.undo', 'history.redo', 'source.toggle', 'ai.open', 'ai.chat', 'search.nodes'], 'the top capsule holds undo, redo, Markdown, the AI assistant, the chat and search');
  t.same(bars.zoom, ['view.zoomOut', 'view.fit', 'view.zoomIn', 'map.tidy'], 'the zoom capsule: zoom, fit and tidy up');
  t.eq(await page.isVisible('#zoombar'), true, 'and it is shown');
  await t.shot('welcome-light', page);

  /* ------------------------------------------------------------ a project of my own */
  t.step('a new project from the sidebar');
  await page.click('#sidebar button[aria-label="New project"]');
  await J.dialog();
  await page.keyboard.type('Garden');
  await page.keyboard.press('Enter');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Garden'; });
  await J.settled();
  t.eq(await J.text(), '# Garden\n', 'its first map holds just its title');
  t.eq(await page.evaluate(function () { return document.querySelector('#title .title__project').textContent; }), 'Garden', 'the top bar names it');
  t.check('the sidebar lists it', await page.isVisible('#sidebar .sb-item--project:has-text("Garden")'));

  /* ------------------------------------------------------------ nodes by keyboard */
  t.step('nodes by keyboard');
  await J.clickNode('Garden');
  t.eq(await J.selected(), '', 'a click selects the root');
  await page.keyboard.press('Tab');
  await J.renaming();
  await page.keyboard.type('Roses');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  await page.keyboard.press('Enter');
  await J.renaming();
  await page.keyboard.type('Tulips');
  await page.keyboard.press('Tab');
  await J.renaming();
  await page.keyboard.type('Red');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  t.eq(await J.text(), '# Garden\n\n## Roses\n\n## Tulips\n\n### Red\n', 'Tab adds a child, Enter a sibling, typing names them');
  await page.keyboard.press('F2');
  await J.renaming();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Crimson');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  t.eq(await J.text(), '# Garden\n\n## Roses\n\n## Tulips\n\n### Crimson\n', 'F2 renames the selected node');
  await J.clickNode('Roses');
  await page.keyboard.press('Tab');
  await J.renaming();
  await page.keyboard.type('Climbing');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  t.check('a child of Roses', (await J.text()).indexOf('## Roses\n\n### Climbing\n') >= 0, await J.text());

  t.step('undo and redo from the top bar');
  var before = await J.text();
  await page.click('#topbar-actions [data-command="history.undo"]');
  await J.until(function (b) { return window.MindRoot.session.current().text !== b; }, before);
  t.eq((await J.text()).indexOf('Climbing'), -1, 'undo takes the last node back');
  t.check('and says so', /^Undone/.test(await J.toast()), await J.toast());
  await page.click('#topbar-actions [data-command="history.redo"]');
  await J.until(function (b) { return window.MindRoot.session.current().text === b; }, before);
  t.eq(await J.text(), before, 'redo brings it back');

  /* ------------------------------------------------------------ colour, note */
  t.step('a colour from the node toolbar');
  await J.clickNode('Tulips');
  await J.toolbar();
  await page.click('.node-toolbar [data-command="node.color"]');
  await page.waitForSelector('.colorpicker:not([hidden]) .cp-chip', { state: 'visible' });
  await page.click('.colorpicker .cp-chip[aria-label^="Rose"]');
  await J.until(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var p = c.state.flat.filter(function (e) { return ns.doc.labelOf(e) === 'Tulips'; })[0];
    return p && ns.doc.colorAt(c.state, p.path) === '#b4485f';
  });
  t.check('Tulips is rose, in the file', true);
  await page.keyboard.press('Escape');
  await J.until(function () { var p = document.querySelector('.colorpicker'); return !p || p.hidden; });
  var tulipColor = await page.evaluate(function () {
    var el = Array.prototype.filter.call(document.querySelectorAll('#stage .mv-node'), function (n) { return n.textContent.trim() === 'Tulips'; })[0];
    return el ? el.style.getPropertyValue('--branch').trim().toLowerCase() : null;
  });
  t.eq(tulipColor, '#b4485f', 'and drawn in it');

  t.step('a note');
  await J.clickNode('Roses');
  await J.toolbar();
  await page.click('.node-toolbar [data-command="node.note"]');
  await page.waitForSelector('.note-bubble textarea', { state: 'visible' });
  await page.keyboard.type('Prune in March');
  await page.keyboard.press('Control+Enter');
  await J.until(function () { return window.MindRoot.session.current().text.indexOf('> note: Prune in March') >= 0; });
  t.check('saved as a note under Roses', /## Roses\n- > note: Prune in March\n/.test(await J.text()), await J.text());
  t.check('a note dot on the node', await page.evaluate(function () {
    var el = Array.prototype.filter.call(document.querySelectorAll('#stage .mv-node'), function (n) { return /^Roses/.test(n.textContent.trim()); })[0];
    return !!(el && el.querySelector('[class*="note"]'));
  }));

  /* ------------------------------------------------------------ pictures */
  t.step('a picture from a file');
  await J.clickNode('Crimson');
  await J.toolbar();
  var chooser = page.waitForEvent('filechooser');
  await page.click('.node-toolbar [data-command="media.image"]');
  await (await chooser).setFiles({ name: 'crimson.png', mimeType: 'image/png', buffer: M.png(undefined, 7) });
  await J.until(function () { return /!\[[^\]]*\]\(assets\/[^)]*crimson[^)]*\.png\)/.test(window.MindRoot.session.current().text); }, null, 10000);
  t.check('the node names the picture', true);
  await J.pictureLoaded('png');
  t.check('and shows it', true);

  t.step('a drawing');
  await J.clickNode('Climbing');
  await J.toolbar();
  await page.click('.node-toolbar [data-command="media.draw"]');
  await M.editorReady(page);
  await M.stroke(page, 0);
  await M.stroke(page, 30);
  await page.click('#viewer .viewer__close');
  await J.until(function () { return /\.ink\.svg\)/.test(window.MindRoot.session.current().text) && !document.querySelector('#viewer:not([hidden])'); }, null, 10000);
  t.check('the drawing is a file the node names', /- !\[[^\]]*\]\(assets\/[^)]+\.ink\.svg\) Climbing|### !\[[^\]]*\]\(assets\/[^)]+\.ink\.svg\) Climbing/.test(await J.text()), await J.text());
  await J.pictureLoaded('ink.svg');
  t.check('and the node shows it', true);
  await t.shot('drawn', page);

  /* ------------------------------------------------------------ Markdown */
  t.step('the Markdown panel');
  await page.click('#topbar-actions [data-command="source.toggle"]');
  await page.waitForSelector('#source:not([hidden]) .src-field', { state: 'visible' });
  var field = await page.evaluate(function () { return document.querySelector('#source .src-field').value; });
  t.eq(field, await J.text(), 'it shows the map as Markdown');
  /* The bars are refreshed on the next frame (app.js updateBars): waited
   * for, not read once. */
  try { await J.until(function () { var b = document.querySelector('#topbar-actions [data-command="source.toggle"]'); return !!b && b.getAttribute('aria-pressed') === 'true'; }); } catch (err) { /* checked */ }
  t.eq(await page.getAttribute('#topbar-actions [data-command="source.toggle"]', 'aria-pressed'), 'true', 'its button is pressed');
  await page.click('#source .src-field');
  await page.keyboard.press('Control+End');
  /* Enter may carry the line's own marker onto the new line (lists do):
   * the new line is chosen whole and written over. */
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type('## Lilies');
  await J.until(function () { return /\n## Lilies\n?$/.test(window.MindRoot.session.current().text); }, null, 8000);
  await J.until(function () { return Array.prototype.some.call(document.querySelectorAll('#stage .mv-node'), function (n) { return n.textContent.trim() === 'Lilies'; }); });
  t.check('typed there, drawn on the map', true);
  await t.shot('markdown', page);
  await page.keyboard.press('Control+M');
  await J.until(function () { return document.getElementById('source').hidden; });
  t.check('Mod+M closes it', true);

  /* ------------------------------------------------------------ drag */
  t.step('drag a node onto another');
  await J.settled();
  var from = await J.nodeBox('Lilies');
  var to = await J.nodeBox('Roses');
  await page.mouse.move(from.x + from.w / 2, from.y + from.h / 2);
  await page.mouse.down();
  for (var s = 1; s <= 12; s++) await page.mouse.move(from.x + from.w / 2 + (to.x + to.w / 2 - from.x - from.w / 2) * s / 12, from.y + from.h / 2 + (to.y + to.h / 2 - from.y - from.h / 2) * s / 12);
  await require('../fixtures/map/drop.js').decided(page);
  await page.mouse.up();
  await J.until(function () { return /## Roses\n[\s\S]*### Lilies[\s\S]*## Tulips/.test(window.MindRoot.session.current().text); }, null, 6000).catch(function () {});
  t.check('Lilies is now a child of Roses', /## Roses\n[\s\S]*### Lilies\n[\s\S]*## Tulips/.test(await J.text()), await J.text());
  t.eq((await J.history()).label, 'move the branch', 'one step of undo');

  /* ------------------------------------------------------------ export */
  t.step('export');
  await page.click('#topbar-actions .btn--more');
  await page.waitForSelector('[role="menu"]', { state: 'visible' });
  var moreFit = await page.evaluate(function () {
    var m = document.querySelector('.menu:not([hidden])');
    var r = m.getBoundingClientRect();
    return {
      whole: m.scrollHeight <= m.clientHeight + 1 && r.bottom <= innerHeight,
      cut: Array.prototype.filter.call(m.querySelectorAll('.menu__label'), function (l) { return l.scrollWidth > l.clientWidth + 0.5; }).map(function (l) { return l.textContent; })
    };
  });
  t.same(moreFit, { whole: true, cut: [] }, 'the top bar\'s more menu fits the window, every label whole');
  await page.keyboard.press('Escape');
  var mdDownload = page.waitForEvent('download');
  await J.more('Export as Markdown');
  var md = await mdDownload;
  t.eq(md.suggestedFilename(), 'Garden.md', 'Markdown named after the map');
  var mdText = fs.readFileSync(await md.path(), 'utf8');
  /* Drawings stay out unless asked for (the export's own option). */
  t.eq(mdText, (await J.text()).replace(/!\[\]\(assets\/[^)]+\.ink\.svg\) /g, ''), 'and holding its text, drawings left out by default');
  await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('dialog[open].xp', { state: 'visible' });
  await page.click('dialog[open].xp .seg__opt:has-text("PNG")');
  var pngDownload = page.waitForEvent('download');
  await page.click('dialog[open].xp .btn--primary');
  var png = await pngDownload;
  var bytes = fs.readFileSync(await png.path());
  t.eq(png.suggestedFilename(), 'Garden.png', 'a PNG named after the map');
  t.eq(bytes.slice(1, 4).toString('latin1'), 'PNG', 'a real PNG');
  t.check('carrying the map inside (iTXt mindroot-markdown)', bytes.indexOf(Buffer.from('mindroot-markdown')) > 0 && bytes.indexOf(Buffer.from('### Lilies')) > 0);
  await J.until(function () { return !document.querySelector('dialog[open].xp'); });

  t.step('the PNG dropped back is a map again');
  var exported = await J.text();
  await M.putFile(page, 'Garden.png', bytes, 'image/png');
  var stage = await page.evaluate(function () { var r = document.getElementById('stage').getBoundingClientRect(); return { x: r.right - 40, y: r.bottom - 120 }; });
  await M.drop(page, ['Garden.png'], stage.x, stage.y);
  await J.until(function () { var ns = window.MindRoot; return ns.store.project(ns.store.here().projectId).maps.length === 2; });
  var back = await page.evaluate(function () { var c = window.MindRoot.session.current(); return { name: c.map.name, text: c.text }; });
  t.eq(back.text, exported.replace(/!\[\]\(assets\/[^)]+\.ink\.svg\) /g, ''), 'its words come back as a new map, opened');
  t.check('named after the file', /^Garden/.test(back.name), back.name);
  await page.click('#sidebar .sb-item--map:has-text("Garden") >> nth=0');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.text.indexOf('climbing.book/001.ink.svg') >= 0; });
  await J.settled();

  /* ------------------------------------------------------------ trash */
  t.step('a branch to the trash and back');
  await J.clickNode('Roses');
  await page.keyboard.press('Delete');
  await J.until(function () { return window.MindRoot.session.current().text.indexOf('Roses') < 0; });
  t.check('Delete takes the branch away, note and child with it', (await J.text()).indexOf('Climbing') < 0);
  t.check('with an Undo toast', /Folding|Roses/.test(await J.toast()) || /deleted/i.test(await J.toast()), await J.toast());
  await J.until(function () { return /1/.test((document.querySelector('#sidebar .sb-tool [data-count], #sidebar .sb-badge, #sidebar .sb-tool .badge') || {}).textContent || '') || /1/.test(Array.prototype.map.call(document.querySelectorAll('#sidebar .sb-tool'), function (b) { return b.getAttribute('aria-label'); }).join(' ')); });
  await page.click('#sidebar .sb-tool:has-text("Trash")');
  await page.waitForSelector('dialog[open].ws-sheet--trash .ws-row', { state: 'visible' });
  t.check('the trash lists it', await page.isVisible('dialog[open].ws-sheet--trash .ws-row:has-text("Roses")'));
  await page.click('dialog[open].ws-sheet--trash .ws-row:has-text("Roses") button:has-text("Put back")');
  await J.until(function () { return window.MindRoot.session.current().text.indexOf('## Roses') >= 0; });
  t.check('put back where it was, with its children and note', /## Roses\n- > note: Prune in March\n[\s\S]*Climbing[\s\S]*Lilies[\s\S]*## Tulips/.test(await J.text()), await J.text());
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('dialog[open].ws-sheet--trash'); });

  /* ------------------------------------------------------------ palette, copies */
  t.step('a copy taken from the palette');
  await page.keyboard.press('Control+K');
  await page.waitForSelector('dialog[open].palette input', { state: 'visible' });
  await page.keyboard.type('take a copy');
  await J.until(function () { var a = document.querySelector('dialog[open].palette [aria-selected="true"]'); return a && /copy/i.test(a.textContent); });
  await page.keyboard.press('Enter');
  /* A copy by hand may carry a note: the dialog asks, Enter takes it. */
  await J.until(function () { var d = document.querySelector('dialog[open]:not(.palette)'); return d && d.querySelector('input, textarea') && d.contains(document.activeElement); });
  await page.keyboard.type('before the roses move');
  await page.keyboard.press('Enter');
  await J.until(function () { var ns = window.MindRoot; var h = ns.store.here(); return ns.store.snapshotsOf(h.projectId, h.mapId).length >= 1; });
  t.eq(await page.evaluate(function () { var ns = window.MindRoot; var h = ns.store.here(); return ns.store.snapshotsOf(h.projectId, h.mapId)[0].label; }), 'before the roses move', 'the palette ran it: a copy, with its note');
  await page.click('#sidebar .sb-tool:has-text("Copies")');
  await page.waitForSelector('dialog[open].ws-sheet--copies', { state: 'visible' });
  t.check('the copies sheet lists it', await page.evaluate(function () { return document.querySelectorAll('dialog[open].ws-sheet--copies .ws-row, dialog[open].ws-sheet--copies li').length >= 1; }));
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('dialog[open].ws-sheet--copies'); });

  /* ------------------------------------------------------------ settings */
  t.step('settings: theme and language');
  await page.keyboard.press('Control+,');
  await page.waitForSelector('dialog[open].ws-sheet--settings', { state: 'visible' });
  await page.click('dialog[open].ws-sheet--settings .seg__opt:has-text("Dark")');
  await J.until(function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  t.check('dark at once', true);
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('dialog[open]'); });
  await J.settled();
  await J.rest();
  await t.shot('dark', page);
  var paper = await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; });
  t.check('the page is dark', /rgb\((\d+), (\d+), (\d+)\)/.test(paper) && Number(RegExp.$1) < 60, paper);
  await page.keyboard.press('Control+,');
  await page.waitForSelector('dialog[open].ws-sheet--settings', { state: 'visible' });
  await page.click('dialog[open].ws-sheet--settings .seg__opt:has-text("Italiano")');
  await J.until(function () { return document.documentElement.lang === 'it'; });
  /* The bars are relabelled on the next frame: waited for, not read once. */
  try { await J.until(function () { var b = document.querySelector('#topbar-actions [data-command="history.undo"]'); return !!b && /^Annulla/.test(b.getAttribute('aria-label') || ''); }); } catch (err) { /* checked */ }
  t.eq(await page.getAttribute('#topbar-actions [data-command="history.undo"]', 'aria-label').then(function (s) { return /^Annulla/.test(s); }), true, 'the bars speak Italian');
  t.eq(await page.evaluate(function () { return document.querySelector('dialog[open].ws-sheet--settings h2, dialog[open].ws-sheet--settings .sheet__title').textContent.trim(); }), 'Impostazioni', 'and the sheet too, rebuilt in place');
  await page.click('dialog[open].ws-sheet--settings .seg__opt:has-text("English")');
  await page.click('dialog[open].ws-sheet--settings .seg__opt:has-text("Light")');
  await J.until(function () { return document.documentElement.lang === 'en' && document.documentElement.getAttribute('data-theme') === 'light'; });
  t.check('back to English and light', true);
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('dialog[open]'); });

  /* ------------------------------------------------------------ help */
  t.step('help');
  await page.keyboard.press('F1');
  await page.waitForSelector('dialog[open].ws-sheet--help', { state: 'visible' });
  var help = await page.evaluate(function () { return document.querySelector('dialog[open].ws-sheet--help').textContent; });
  t.check('F1 opens it, listing the keys of this machine', /Add a child/.test(help) && /Tab/.test(help) && /Ctrl\+K/.test(help), help.slice(0, 200));
  await page.fill('dialog[open].ws-sheet--help input[type="search"]', 'trash');
  await J.until(function () { return !/Add a child/.test(document.querySelector('dialog[open].ws-sheet--help').innerText); });
  t.check('its search filters', /trash/i.test(await page.evaluate(function () { return document.querySelector('dialog[open].ws-sheet--help').innerText; })));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('dialog[open]'); });

  /* ------------------------------------------------------------ view only */
  t.step('view only');
  await J.clickNode('Garden');
  await page.keyboard.press('Control+E');
  await J.until(function () { return document.documentElement.getAttribute('data-mode') === 'view'; });
  await J.until(function () { return getComputedStyle(document.getElementById('topbar')).display === 'none'; }, null, 3000).catch(function () {});
  t.eq(await page.isVisible('#topbar-actions'), false, 'the chrome steps aside');
  t.eq(await page.isVisible('.view-exit'), true, 'a way back is shown');
  var still = await J.text();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Delete');
  t.eq(await J.text(), still, 'keys change nothing');
  await page.keyboard.press('Escape');
  await J.until(function () { return document.documentElement.getAttribute('data-mode') !== 'view'; });
  t.eq(await page.isVisible('#topbar-actions'), true, 'Escape brings the controls back');

  /* ------------------------------------------------------------ a second map */
  t.step('a second map, and back');
  await page.click('#sidebar .sb-item--new');
  await J.dialog();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Vegetables');
  await page.keyboard.press('Enter');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Vegetables'; });
  t.eq(await J.text(), '# Vegetables\n', 'a new map opens');
  await page.click('#sidebar .sb-item--map:has-text("Garden")');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Garden'; });
  t.check('the first one opens again with its words', /### !\[crimson\]\(assets\/crimson\.png\) Crimson/.test(await J.text()), await J.text());

  /* ------------------------------------------------------------ reload */
  t.step('reload: everything is where it was');
  var kept = await J.text();
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await J.settled();
  var after = await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    return { map: c && c.map.name, text: c && c.text, maps: ns.store.project(c.projectId).maps.map(function (m) { return m.name; }) };
  });
  t.eq(after.map, 'Garden', 'the map that was open is open');
  t.eq(after.text, kept, 'with every word');
  t.eq(after.maps.length, 3, 'and every map: the first, the one from the PNG, Vegetables');
  t.eq(after.maps[after.maps.length - 1], 'Vegetables', 'in their order');
  await J.pictureLoaded('png');
  await J.pictureLoaded('ink.svg');
  t.check('the picture and the drawing still show', true);
  var counts = await page.evaluate(function () {
    var ns = window.MindRoot;
    var p = ns.store.project(ns.session.current().projectId);
    var c = ns.store.counts(p);
    var named = Object.keys(ns.store.usedByMaps(p.id)).filter(function (f) { return /^assets\//.test(f); });
    return { maps: c.maps, images: c.images, named: named, missing: named.filter(function (f) { return !p.files[f]; }) };
  });
  t.check('the store counts 3 maps and keeps a file for every picture a map names (the photo and the drawing at least)',
    counts.maps === 3 && counts.named.length >= 2 && counts.images >= counts.named.length && counts.missing.length === 0, counts);
  await t.shot('reloaded', page);
};

/* ---------------------------------------------------------------- helpers */

function helpers(page) {
  function until(fn, arg, timeout) {
    return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: timeout || 8000, polling: 30 });
  }
  return {
    until: until,
    text: function () { return page.evaluate(function () { var c = window.MindRoot.session.current(); return c ? c.text : null; }); },
    history: function () {
      return page.evaluate(function () { var h = window.MindRoot.store.historyState(); return { count: h.undoCount, label: h.undoLabel }; });
    },
    selected: function () { return page.evaluate(function () { return window.MindRoot.session.selected(); }); },
    settled: function () {
      return page.evaluate(function () {
        var v = window.MindRoot.session && window.MindRoot.session.view;
        return (v ? v.settled() : Promise.resolve()).then(function () {
          return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
        });
      });
    },
    rest: function () {
      return until(function () { return !document.getAnimations().some(function (a) { return a.playState === 'running'; }); }, null, 4000).catch(function () {});
    },
    nodeBox: function (label) {
      return page.evaluate(function (label) {
        var el = Array.prototype.filter.call(document.querySelectorAll('#stage .mv-node'), function (n) {
          var t = n.querySelector('.mv-title .mv-text');
          return t && t.textContent.trim() === label;
        })[0];
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }, label);
    },
    clickNode: async function (label) {
      await this.settled();
      var b = await this.nodeBox(label);
      if (!b) throw new Error('no node ' + label);
      /* Panned out of reach (under the sidebar, past an edge): the person
       * presses "fit" first, as they would. */
      var reachable = await page.evaluate(function (pt) {
        var hit = document.elementFromPoint(pt.x, pt.y);
        return !!(hit && hit.closest && hit.closest('#stage .mv-node'));
      }, { x: b.x + Math.min(b.w / 2, 30), y: b.y + b.h / 2 });
      if (!reachable) {
        await page.click('#zoombar [data-command="view.fit"]');
        await this.settled();
        b = await this.nodeBox(label);
      }
      await page.mouse.click(b.x + Math.min(b.w / 2, 30), b.y + b.h / 2);
      try {
        await until(function (label) {
          var ns = window.MindRoot;
          var e = ns.session.entry();
          return e && ns.doc.labelOf(e) === label;
        }, label);
      } catch (err) {
        var why = await page.evaluate(function (pt) {
          var ns = window.MindRoot;
          var e = ns.session.entry();
          var hit = document.elementFromPoint(pt.x, pt.y);
          return { selected: e ? ns.doc.labelOf(e) : null, hit: hit ? hit.tagName + '.' + hit.className : null };
        }, { x: b.x + Math.min(b.w / 2, 30), y: b.y + b.h / 2 });
        throw new Error('clicking ' + label + ' did not select it: ' + JSON.stringify(why));
      }
    },
    renaming: function () { return until(function () { var a = document.activeElement; return a && a.closest && a.closest('.mv-node--editing'); }); },
    notRenaming: function () { return until(function () { return !document.querySelector('.mv-node--editing'); }); },
    toolbar: function () { return page.waitForSelector('.node-toolbar:not([hidden])', { state: 'visible' }); },
    dialog: function () {
      return until(function () { var d = document.querySelector('dialog[open]'); return d && d.contains(document.activeElement) && document.activeElement.tagName === 'INPUT'; });
    },
    toast: function () {
      return page.evaluate(function () {
        var all = document.querySelectorAll('.toast .toast__text');
        return all.length ? all[all.length - 1].textContent : '';
      });
    },
    barIds: function () {
      return page.evaluate(function () {
        function ids(sel) { return Array.prototype.map.call(document.querySelectorAll(sel + ' [data-command]'), function (b) { return b.getAttribute('data-command'); }); }
        return { top: ids('#topbar-actions'), thumb: ids('#thumbbar'), zoom: ids('#zoombar') };
      });
    },
    /* A picture on the map whose path ends so, loaded from a blob. */
    pictureLoaded: function (ending) {
      return until(function (ending) {
        return Array.prototype.some.call(document.querySelectorAll('#stage img.mv-img'), function (img) {
          var p = img.getAttribute('data-src') || '';
          return p.slice(-ending.length) === ending && img.complete && img.naturalWidth > 0 && /^blob:/.test(img.src);
        });
      }, ending, 10000);
    },
    /* A row of the top bar's "more" menu, by its words. */
    more: async function (label) {
      await page.click('#topbar-actions .btn--more');
      await page.waitForSelector('[role="menu"]', { state: 'visible' });
      await page.click('[role="menu"] [role^="menuitem"]:has-text("' + label + '")');
    }
  };
}
