/* editor-bigmap: writing a name on a big map (3,000 nodes) stays light.
 * Each node's place is left/top (no transform per node: thousands of
 * compositing nodes re-sorted on every repaint), each place box contains
 * its own layout (the node typed into lays out alone), and the map is laid
 * out again once the typing pauses, not behind every few keys - then it
 * catches up in one go. The per-key time is logged (4x CPU slowdown). */
'use strict';

var E = require('../fixtures/editor/helpers.js');

function bigMap(n) {
  var lines = ['# Big root', ''];
  var c = 1;
  var b = 0;
  while (c < n) {
    lines.push('## Branch ' + b); c++;
    for (var i = 0; i < 20 && c < n; i++) {
      lines.push('- Item ' + b + '.' + i + ' with some words'); c++;
      for (var j = 0; j < 4 && c < n; j++) { lines.push('  - Child ' + b + '.' + i + '.' + j); c++; }
    }
    lines.push('');
    b++;
  }
  return lines.join('\n') + '\n';
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Big', bigMap(3000)]]);
  var page = s.page;

  t.step('a node\'s place: left and top, its layout contained');
  var places = await page.evaluate(function () {
    var all = document.querySelectorAll('#stage .mv-pos');
    var withTransform = 0;
    var placed = 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i].style.transform) withTransform++;
      if (all[i].style.left && all[i].style.top) placed++;
    }
    var cs = getComputedStyle(all[0]);
    return { count: all.length, withTransform: withTransform, placed: placed, contain: cs.contain };
  });
  t.eq(places.count, 3000, 'three thousand places');
  t.eq(places.withTransform, 0, 'none at rest carries a transform');
  t.eq(places.placed, 3000, 'every one is placed by left and top');
  t.check('each contains its size and layout', /size/.test(places.contain) && /layout/.test(places.contain), places.contain);

  t.step('typing a name: the node grows, the map waits for a pause, then catches up');
  var leaf = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    var st = document.getElementById('stage').getBoundingClientRect();
    var pick = null;
    v.visiblePaths().forEach(function (p) {
      var g = v.geometry().nodes[p];
      var r = v.rect(p);
      if (pick || !g || g.hasKids || !r) return;
      if (r.left > st.left + 200 && r.right < st.right - 300 && r.top > st.top + 120 && r.bottom < st.bottom - 120) pick = p;
    });
    return pick;
  });
  t.check('a leaf in the middle of the stage', leaf !== null, leaf);
  await E.select(page, leaf);
  await page.keyboard.press('F2');
  await E.until(page, function () { return !!window.MindRoot.editor.renaming(); });
  await page.keyboard.press('End');
  /* The open field's own size change is laid out first. */
  await page.evaluate(function () { return window.MindRoot.session.view.settled(); });
  var cdp = await t.context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  var w0 = await page.evaluate(function (p) { return window.MindRoot.session.view.geometry().nodes[p].w; }, leaf);
  await page.evaluate(function () {
    window.__lat = [];
    document.addEventListener('keydown', function () {
      var t0 = performance.now();
      requestAnimationFrame(function () { setTimeout(function () { window.__lat.push(performance.now() - t0); }, 0); });
    }, true);
  });
  var keys = 'abcdefghij';
  var grownMid = null;
  for (var i = 0; i < keys.length; i++) {
    await page.keyboard.press(keys[i]);
    await page.waitForTimeout(120);
    if (i === 6) {
      grownMid = await page.evaluate(function (p) {
        var v = window.MindRoot.session.view;
        return { laid: v.geometry().nodes[p].w, drawn: v.nodeEl(p).offsetWidth };
      }, leaf);
    }
  }
  t.eq(grownMid.laid, w0, 'while the keys come, the map is not laid out again');
  t.check('but the node itself grows with its words', grownMid.drawn > w0, { w0: w0, mid: grownMid });
  await E.until(page, function (a) { return window.MindRoot.session.view.geometry().nodes[a.p].w > a.w0; }, { p: leaf, w0: w0 }, 8000);
  t.check('a pause, and the map catches up', true);
  var lat = await page.evaluate(function () { return window.__lat.map(Math.round).sort(function (a, b) { return a - b; }); });
  t.log('3,000 nodes, 4x CPU: per-key latency median ' + lat[lat.length >> 1] + ' ms, max ' + lat[lat.length - 1] + ' ms (' + lat.join(' ') + ')');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.keyboard.press('Enter');
  t.check('saved with the typed words', /with some wordsabcdefghij|Child [\d.]+abcdefghij/.test(await E.text(page)));
};

/* It measures time (key latency under a 4x CPU throttle, a layout held
 * back while keys come 120 ms apart): it runs alone, after the rest. */
module.exports.solo = true;
