/* MindRoot - helpers shared by the Markdown panel and export e2e suites.
 *
 * Seeding a project through the store (the session opens it by itself),
 * waiting for conditions instead of sleeping, and reading the panel's state
 * in one call. Files of modules not written yet are stubbed by the shell's
 * helper, so these suites run while the rest of the app is being built. */
'use strict';

var H = require('../shell/helpers.js');

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 8000, polling: 50 });
}

/* A project with the given maps, the first one open and rendered. */
async function seed(page, maps, name) {
  var ids = await page.evaluate(function (args) {
    var ns = window.MindRoot;
    window.__rendered = [];
    ns.bus.on('map:rendered', function (d) { window.__rendered.push(d.mapId); });
    var p = ns.store.createProject({ name: args.name, maps: args.maps });
    return { pid: p.id, maps: p.maps.map(function (m) { return m.id; }) };
  }, { maps: maps, name: name || 'Garden' });
  await until(page, function (mid) { return window.__rendered.indexOf(mid) >= 0; }, ids.maps[0]);
  return ids;
}

/* Everything a check usually wants about the panel. */
function panel(page) {
  return page.evaluate(function () {
    var ns = window.MindRoot;
    var src = document.getElementById('source');
    var field = src.querySelector('.src-field');
    var cur = ns.session.current();
    return {
      open: !src.hidden,
      value: field ? field.value : null,
      text: ns.source.text(),
      rows: src.querySelectorAll('.src-row').length,
      focused: document.activeElement === field,
      caretLine: ns.source.caretLine(),
      selected: ns.session.selected(),
      mapText: cur ? cur.text : null,
      storeText: cur ? ns.store.map(cur.projectId, cur.mapId).text : null
    };
  });
}

/* Caret into the field at an offset (or a selection), as a click would. */
function caret(page, start, end) {
  return page.evaluate(function (a) {
    var f = document.querySelector('#source .src-field');
    f.focus();
    f.setSelectionRange(a[0], a[1] === undefined || a[1] === null ? a[0] : a[1]);
    f.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
  }, [start, end]);
}

module.exports = {
  stubMissing: H.stubMissing,
  context: H.context,
  until: until,
  seed: seed,
  panel: panel,
  caret: caret
};
