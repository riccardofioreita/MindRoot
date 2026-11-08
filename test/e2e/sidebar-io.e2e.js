/* sidebar-io: what comes in and goes out through the sidebar. A project
 * exports as the ZIP of its .interneuron folder and as JSON (downloads);
 * a file picked in "Import a file" comes in (a .md as a map of the open
 * project, a ZIP as projects beside what is there, never over it), and so
 * do files dropped on the page, folders (only .interneuron ones, the
 * others named in the message) and files opened with the installed app;
 * every import is one step with an Undo toast. The import-branches dialog
 * lists another map's nodes as boxes (a ticked node takes its branch, its
 * boxes greyed), filters them ignoring accents, indents the target list
 * with no-break spaces, and copies the branches under the chosen node in
 * one step. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var BEDS = '# Beds\n\n- North\n  - Lettuce\n- South\n  - Tomatoes\n';
var RECIPES = '# Recipes\n\n- Soup\n  - Leek\n- Bread\n';

function menuLabels(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__item'), function (i) {
      return i.querySelector('.menu__label').textContent + (i.getAttribute('aria-disabled') === 'true' ? ' (off)' : '');
    });
  });
}

module.exports = async function (t) {
  var b = await W.boot(t, [
    { name: 'Garden', maps: [['Beds', BEDS]] },
    { name: 'Kitchen', maps: [['Recipes', RECIPES]] }
  ]);
  var page = b.page;
  var garden = b.projects[0];
  var kitchen = b.projects[1];

  t.step('the import and export menu');
  await page.click('#sb-io');
  await until(page, function () { return !!document.querySelector('.menu:not([hidden])'); });
  t.same(await menuLabels(page), ['New project', 'Import branches from another map', 'Import a file (ZIP, JSON, .md)', 'Import a .interneuron folder',
    'Export everything as ZIP', 'Export everything as JSON', 'Restore from a backup'], 'everything that comes in or goes out');
  await page.keyboard.press('Escape');

  t.step('a project goes out as ZIP and JSON');
  var dl = page.waitForEvent('download');
  await page.evaluate(function (pid) { window.MindRoot.sidebar.exportProject(pid, 'zip'); }, garden.id);
  var zip = await dl;
  t.eq(zip.suggestedFilename(), 'garden.interneuron.zip', 'the .interneuron folder as a ZIP');
  await W.waitToast(page, /Exported: garden\.interneuron\.zip/);
  var zipPath = await zip.path();
  var dl2 = page.waitForEvent('download');
  await page.evaluate(function () { window.MindRoot.commands.run('project.exportJson'); });
  var json = await dl2;
  t.check('and as JSON', /^kitchen-.*\.json$/.test(json.suggestedFilename()), json.suggestedFilename());
  var fs = require('fs');
  var jsonText = fs.readFileSync(await json.path(), 'utf8');
  t.check('the JSON holds the project', /"name": "Kitchen"/.test(jsonText) && /Recipes/.test(jsonText));

  t.step('a ZIP comes back in beside, never over');
  var chooser = page.waitForEvent('filechooser');
  await page.evaluate(function () { window.MindRoot.commands.run('file.import'); });
  var fc = await chooser;
  t.eq(fc.isMultiple(), true, 'several files at once');
  await fc.setFiles({ name: 'garden.interneuron.zip', mimeType: 'application/zip', buffer: fs.readFileSync(zipPath) });
  await until(page, function () { return window.MindRoot.store.projects().length === 3; });
  var names = await page.evaluate(function () { return window.MindRoot.store.projects().map(function (p) { return p.name; }); });
  t.same(names, ['Garden', 'Kitchen', 'Garden (2)'], 'the project comes in beside the one it was exported from, told apart by a number');
  await W.waitToast(page, /1 project imported/);
  t.check('one message, with Undo', await page.evaluate(function () { return !!document.querySelector('.toast:not([hidden]) .toast__action'); }));
  await page.click('.toast:not([hidden]) .toast__action');
  await until(page, function () { return window.MindRoot.store.projects().length === 2; });
  t.check('Undo takes the whole import back', true);

  t.step('a .md picked becomes a map of the open project');
  var c2 = page.waitForEvent('filechooser');
  await page.evaluate(function () { window.MindRoot.sidebar.pickImport(); });
  await (await c2).setFiles({ name: 'Spices.md', mimeType: 'text/markdown', buffer: Buffer.from('# Spices\n\n- Pepper\n') });
  await until(page, function (pid) { return window.MindRoot.store.project(pid).maps.length === 2; }, kitchen.id);
  await W.waitToast(page, /1 map added to Kitchen/);
  t.check('added to Kitchen, said so', true);

  t.step('files dropped on the page come in');
  await page.evaluate(function () {
    var dt = new DataTransfer();
    dt.items.add(new File(['# Herbs\n\n- Basil\n'], 'Herbs.md', { type: 'text/markdown' }));
    var target = document.getElementById('stage');
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 600, clientY: 400 }));
  });
  await until(page, function (pid) { return window.MindRoot.store.project(pid).maps.some(function (m) { return m.name === 'Herbs'; }); }, kitchen.id);
  t.check('a dropped .md is a map of the open project', true);
  var ignored = await page.evaluate(function (pid) {
    var before = window.MindRoot.store.project(pid).maps.length;
    var dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' }));
    document.getElementById('stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return new Promise(function (r) { setTimeout(function () { r(window.MindRoot.store.project(pid).maps.length === before); }, 300); });
  }, kitchen.id);
  t.eq(ignored, true, 'a picture is left to the pictures, not imported as a project');

  t.step('files opened with the installed app come in');
  await page.evaluate(function () {
    window.MindRoot.bus.emit('launch', { files: [new File(['# Pantry\n\n- Rice\n'], 'Pantry.md', { type: 'text/markdown' })] });
  });
  await until(page, function () { return window.MindRoot.store.projects().some(function (p) { return p.maps.some(function (m) { return m.name === 'Pantry'; }); }); });
  t.check('a launched .md is a map', true);

  t.step('folders: only .interneuron ones are projects');
  var folder = await page.evaluate(function () {
    return window.MindRoot.sidebar.importEntries([
      { path: 'Trip.interneuron/days.md', data: new File(['# Days\n\n- Monday\n'], 'days.md') },
      { path: 'Loose notes/x.md', data: new File(['# X\n'], 'x.md') }
    ]).then(function (out) { return { projects: out.projects.map(function (p) { return p.name; }), message: out.message }; });
  });
  t.same(folder.projects, ['Trip'], 'the .interneuron folder is a project');
  t.check('the other is named in the message', /Loose notes/.test(folder.message) && /not a project folder/.test(folder.message), folder.message);
  await page.evaluate(function () { window.MindRoot.commands.run('history.undo'); });
  await until(page, function () { return !window.MindRoot.store.projects().some(function (p) { return p.name === 'Trip'; }); });

  t.step('import branches from another map');
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.p, ids.m); }, { p: kitchen.id, m: kitchen.maps[0] });
  await page.evaluate(function () { window.MindRoot.session.select('1'); });
  await page.evaluate(function () { window.MindRoot.commands.run('map.importBranches'); });
  await until(page, function () { return !!document.querySelector('dialog.dialog[open] .ws-picktree'); });
  var ib = await page.evaluate(function () {
    var d = document.querySelector('dialog.dialog[open]');
    var from = d.querySelector('select');
    return {
      title: d.querySelector('.dialog__title').textContent,
      groups: Array.prototype.map.call(from.querySelectorAll('optgroup'), function (g) { return g.label + ':' + Array.prototype.map.call(g.children, function (o) { return o.textContent; }).join('|'); }),
      nodes: Array.prototype.map.call(d.querySelectorAll('.ws-pick'), function (li) { return li.style.getPropertyValue('--depth') + ':' + li.querySelector('.ws-pick__text').textContent + (li.querySelector('.ws-pick__count') ? li.querySelector('.ws-pick__count').textContent : ''); }),
      under: Array.prototype.map.call(d.querySelectorAll('select')[1].options, function (o) { return o.textContent; }),
      chosenUnder: d.querySelectorAll('select')[1].value,
      go: d.querySelector('.btn--primary').textContent,
      off: d.querySelector('.btn--primary').disabled
    };
  });
  t.eq(ib.title, 'Import branches', 'the dialog');
  t.check('every other map, grouped by project', ib.groups.some(function (g) { return /^Garden:Beds/.test(g); }) && !ib.groups.some(function (g) { return /Recipes/.test(g); }), ib.groups);
  t.same(ib.nodes, ['0:Beds+4', '1:North+1', '2:Lettuce', '1:South+1', '2:Tomatoes'], 'the nodes as a tree, with what hangs under each');
  t.same(ib.under, ['The root: Recipes', '   Soup', '      Leek', '   Bread'], 'the target list indented with no-break spaces');
  t.eq(ib.chosenUnder, '1', 'under the node selected on the map');
  t.check('nothing chosen, nothing to import', ib.off && ib.go === 'Import', ib);
  await page.check('dialog.dialog[open] .ws-pick:nth-child(2) input');
  var ticked = await page.evaluate(function () {
    var d = document.querySelector('dialog.dialog[open]');
    var boxes = d.querySelectorAll('.ws-pick input');
    return { lettuce: [boxes[2].checked, boxes[2].disabled], south: boxes[3].checked, go: d.querySelector('.btn--primary').textContent, off: d.querySelector('.btn--primary').disabled };
  });
  t.same(ticked, { lettuce: [true, true], south: false, go: 'Import 1 branch', off: false }, 'a ticked node takes its branch along, greyed');
  await page.fill('dialog.dialog[open] input[type=search]', 'tomàtoes');
  await until(page, function () { return document.querySelectorAll('dialog.dialog[open] .ws-pick').length === 3; });
  t.same(await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('dialog.dialog[open] .ws-pick__text'), function (x) { return x.textContent; }); }), ['Beds', 'South', 'Tomatoes'], 'the filter ignores accents and keeps the ancestors');
  await page.fill('dialog.dialog[open] input[type=search]', '');
  await page.selectOption('dialog.dialog[open] select >> nth=1', '0');
  await page.click('dialog.dialog[open] .btn--primary');
  await until(page, function () { return /- Soup\n  - Leek\n  - North\n    - Lettuce\n/.test(window.MindRoot.session.current().text); });
  t.check('the branch lands under Soup, with its child', true);
  await W.waitToast(page, /1 branch imported/);
  t.eq(await page.evaluate(function () { return window.MindRoot.store.historyState().undoLabel; }), 'import a branch', 'one step');
  await until(page, function () { return window.MindRoot.session.selected() === '0.1'; });
  t.check('the imported node is selected', true);
  t.eq(await page.evaluate(function (p) { return window.MindRoot.store.project(p).maps[0].text; }, garden.id), BEDS, 'the source map is untouched');

  t.step('a refused import branches, with no other map');
  var lone = await (await W.context(t)).newPage();
  await t.open('', { page: lone });
  await lone.evaluate(function () { window.MindRoot.store.createProject({ name: 'Solo', maps: [{ name: 'One', text: '# One\n' }] }); });
  await until(lone, function () { return !!window.MindRoot.session.current(); });
  t.eq(await lone.evaluate(function () { return window.MindRoot.commands.enabled('map.importBranches'); }), false, 'off with a single map');
  await lone.evaluate(function () { window.MindRoot.sidebar.importBranches({}); });
  await W.waitToast(lone, /no other map/);
  t.check('and says why when asked anyway', true);
};
