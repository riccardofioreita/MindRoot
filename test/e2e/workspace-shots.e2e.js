/* workspace-shots: every workspace surface on a desktop, light and dark,
 * at rest, as screenshots in test/out (the trash with things in it, the
 * copies list and a preview, settings, help, the palette, the new project
 * dialog, the import-branches dialog). Each one must sit inside the window
 * with nothing scrolling sideways. */
'use strict';

var W = require('../fixtures/workspace/helpers.js');
var until = W.until;

var BEDS = '# Beds\n\n- North\n  - Lettuce\n  - Carrots\n- South\n  - Tomatoes\n- West\n';

async function inside(t, page, name) {
  await W.rest(page);
  var r = await page.evaluate(function () {
    var d = document.querySelector('dialog[open]');
    var b = d ? d.getBoundingClientRect() : null;
    return { ok: !b || (b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5), wide: document.scrollingElement.scrollWidth <= innerWidth };
  });
  t.same(r, { ok: true, wide: true }, name + ': inside the window');
}

module.exports = async function (t) {
  for (var theme of ['light', 'dark']) {
    t.step(theme);
    var b = await W.boot(t, [
      { name: 'Garden', description: 'Vegetables', template: true, maps: [['Beds', BEDS], ['Tools', '# Tools\n\n- Spade\n']] },
      { name: 'Kitchen', maps: [['Recipes', '# Recipes\n\n- Soup\n  - Leek\n- Bread\n']] }
    ]);
    var page = b.page;
    var pid = b.projects[0].id;
    await page.evaluate(function (th) { window.MindRoot.prefs.set('theme', th); }, theme);
    await page.evaluate(function (ids) {
      var ns = window.MindRoot;
      return ns.session.open(ids.pid, ids.beds).then(function () {
        ns.session.select('1');
        ns.commands.run('node.delete');
        ns.store.takeSnapshot(ids.pid, ids.beds, { kind: 'manual', label: 'before the rewrite' });
        ns.store.setMapText(ids.pid, ids.beds, ns.store.map(ids.pid, ids.beds).text + '- East\n');
        ns.store.deleteMap(ids.pid, ids.tools);
      });
    }, { pid: pid, beds: b.projects[0].maps[0], tools: b.projects[0].maps[1] });

    await page.evaluate(function () { window.MindRoot.commands.run('trash.open'); });
    await until(page, function () { return document.querySelectorAll('.ws-trash .ws-row').length === 2; });
    await page.click('.ws-trash .ws-row:nth-child(2) .ws-row__check');
    await page.click('.ws-trash .ws-row:nth-child(1) .ws-row__purge');
    await inside(t, page, 'trash');
    await t.shot('trash-' + theme, page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(page, function () { return !window.MindRoot.trash.isOpen(); });

    await page.evaluate(function () { window.MindRoot.commands.run('copies.open'); });
    await until(page, function () { return document.querySelectorAll('.ws-copies .ws-copy').length === 1; });
    await inside(t, page, 'copies');
    await t.shot('copies-' + theme, page);
    await page.click('.ws-copies [data-role="look"]');
    await until(page, function () { return document.querySelectorAll('.ws-copies__map .mv-node').length > 3; });
    await inside(t, page, 'copy preview');
    await t.shot('copy-map-' + theme, page);
    await page.click('.ws-copies__bar .seg__opt[data-value="text"]');
    await inside(t, page, 'copy changes');
    await t.shot('copy-diff-' + theme, page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(page, function () { return !window.MindRoot.copies.isOpen(); });

    await page.evaluate(function () { window.MindRoot.commands.run('settings.open'); });
    await until(page, function () { return !!document.querySelector('.ws-settings'); });
    await until(page, function () { return /used/.test(document.querySelector('.ws-usage').textContent); });
    await inside(t, page, 'settings');
    await t.shot('settings-' + theme, page);
    await page.keyboard.press('Escape');
    await until(page, function () { return !window.MindRoot.settings.isOpen(); });

    await page.evaluate(function () { window.MindRoot.commands.run('help.open'); });
    await until(page, function () { return !!document.querySelector('.ws-help'); });
    await inside(t, page, 'help');
    await t.shot('help-' + theme, page);
    await page.keyboard.press('Escape');
    await until(page, function () { return !window.MindRoot.help.isOpen(); });

    await page.evaluate(function () { window.MindRoot.palette.open(); });
    await page.fill('dialog.palette[open] .palette__input', 'map');
    await until(page, function () { return window.MindRoot.palette.items().length > 3; });
    await inside(t, page, 'palette');
    await t.shot('palette-' + theme, page);
    await page.keyboard.press('Escape');

    await page.evaluate(function () { window.MindRoot.sidebar.newProject(); });
    await until(page, function () { return !!document.querySelector('dialog.dialog[open] .ws-choices'); });
    await page.click('dialog.dialog[open] .ws-choice:nth-child(2)');
    await inside(t, page, 'new project');
    await t.shot('new-project-' + theme, page);
    await page.keyboard.press('Escape');
    await until(page, function () { return !document.querySelector('dialog.dialog[open]'); });

    await page.evaluate(function () { window.MindRoot.commands.run('map.importBranches'); });
    await until(page, function () { return !!document.querySelector('dialog.dialog[open] .ws-picktree'); });
    await page.click('dialog.dialog[open] .ws-pick:nth-child(2) input');
    await inside(t, page, 'import branches');
    await t.shot('import-branches-' + theme, page);
    await page.keyboard.press('Escape');
  }
};
