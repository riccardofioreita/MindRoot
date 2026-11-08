/* session-persist: a map opens again the way it was left. Folds (as
 * lineage keys), the camera and the sides of the branches survive a reload of
 * the page; the folds written in the file (<!-- markmap: fold -->) apply
 * until the person folds by hand (an edit that only moves a marker-folded
 * node is not a fold by hand); the selection comes back when the person
 * returns to a map in the same session; hiding the page hands the camera to
 * the store at once, ahead of storage's own write; a second tab of the same
 * database shows the map read-only. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

var MAP_A = '# Root\n\n- Alpha\n  - Alpha one\n  - Alpha two\n- Beta\n  - Beta one\n- Gamma <!-- markmap: fold -->\n  - Gamma one\n';
var MAP_B = '# Other\n\n- Xeno <!-- markmap: fold -->\n  - Xeno one\n- Yew\n';

function until(page, fn, arg, timeout) {
  return page.waitForFunction(fn, arg, { timeout: timeout || 8000, polling: 50 });
}

function booted(page) {
  return page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
}

/* Open and settled: map:rendered may already have gone by, so ask the view. */
function settledOn(page, mapId) {
  return page.evaluate(function (mid) {
    var s = window.MindRoot.session;
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function check() {
        var c = s.current();
        if (c && c.mapId === mid && s.view.visiblePaths().length) { s.view.settled().then(function () { resolve(true); }); return; }
        if (++tries > 200) { reject(new Error('map ' + mid + ' did not open')); return; }
        setTimeout(check, 25);
      })();
    });
  }, mapId);
}

function near(a, b) { return Math.abs(a - b) < 0.5; }

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var page = await t.open();

  t.step('a fresh map takes its folds from the file');
  var ids = await page.evaluate(function (maps) {
    var p = window.MindRoot.store.createProject({ name: 'Notes', maps: [{ name: 'Big', text: maps[0] }, { name: 'Small', text: maps[1] }] });
    return { pid: p.id, a: p.maps[0].id, b: p.maps[1].id };
  }, [MAP_A, MAP_B]);
  await settledOn(page, ids.a);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded('2'); }), true, 'Gamma folded by its marker');

  t.step('fold, move the camera, put a branch on the left, then reload');
  await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    v.fold('0', true);
    v.fold('2', false);
  });
  t.same(await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.a).folds; }, ids), ['\u0000', 'Root\u001fAlpha'], 'the fold set as words, marked as folded by hand');
  t.eq(await page.evaluate(function () { return window.MindRoot.editor.moveSide('1', 'left'); }), true, 'Beta moved to the left');
  t.check('the side is written in the map', await page.evaluate(function () { return /- Beta <!-- side: left -->\n/.test(window.MindRoot.session.current().text); }));
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.geometry().nodes['1'].side; }), 'left', 'the view lays it out on the left');
  await page.evaluate(function () { return window.MindRoot.session.view.settled(); });
  await page.evaluate(function () { window.MindRoot.session.view.setCamera({ x: 140, y: 90, k: 0.75 }); });
  await until(page, function (ids) { var c = window.MindRoot.store.mapView(ids.pid, ids.a).camera; return c && c.k === 0.75; }, ids);
  var cam = await page.evaluate(function (ids) { return window.MindRoot.store.mapView(ids.pid, ids.a).camera; }, ids);
  t.check('the camera is written a moment after it rests', near(cam.x, 140) && near(cam.y, 90), cam);
  t.eq(await page.evaluate(function () { return window.MindRoot.storage.flush(); }), true, 'flushed');

  await page.reload();
  await booted(page);
  await settledOn(page, ids.a);
  var back = await page.evaluate(function () {
    var v = window.MindRoot.session.view;
    return { alpha: v.isFolded('0'), gamma: v.isFolded('2'), side: v.geometry().nodes['1'].side, cam: v.camera() };
  });
  t.eq(back.alpha, true, 'Alpha folded again');
  t.eq(back.gamma, false, 'Gamma left open, whatever its marker says');
  t.eq(back.side, 'left', 'Beta on the left again');
  t.check('the camera where it was left', near(back.cam.x, 140) && near(back.cam.y, 90) && near(back.cam.k, 0.75), back.cam);

  t.step('the selection comes back with the map, in the same session');
  await page.evaluate(function () { window.MindRoot.session.select('1.0'); });
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.b); }, ids);
  await settledOn(page, ids.b);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.selected(); }), null, 'the other map starts with nothing selected');
  /* Its first framing is written a moment after it rests. */
  await until(page, function (ids) { return !!window.MindRoot.store.mapView(ids.pid, ids.b).camera; }, ids);
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.a); }, ids);
  await settledOn(page, ids.a);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.selected(); }), '1.0', 'Beta one is selected again');
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.selected(); }), '1.0', 'on screen too');

  t.step('a map only looked at keeps following the folds in its file');
  t.same(await page.evaluate(function (ids) { var v = window.MindRoot.store.mapView(ids.pid, ids.b); return [!!v.camera, v.folds.length]; }, ids), [true, 0], 'Small has a camera and no folds of its own');
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await booted(page);
  await settledOn(page, ids.a);
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.b); }, ids);
  await settledOn(page, ids.b);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded('0'); }), true, 'Xeno folded by its marker after a reload');
  await page.evaluate(function (ids) { window.MindRoot.store.setActive(ids.pid, ids.a); }, ids);
  await settledOn(page, ids.a);

  t.step('hiding the page hands the camera over at once');
  await page.evaluate(function () { window.MindRoot.session.view.setCamera({ x: 60, y: 30, k: 1.2 }); });
  await page.waitForFunction(function () { var c = window.MindRoot.session.view.camera(); return c.k === 1.2; });
  /* Before the 600 ms the session waits: only the hand-over can have written it. */
  var handed = await page.evaluate(function (ids) {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
          document.dispatchEvent(new Event('visibilitychange'));
          var c = window.MindRoot.store.mapView(ids.pid, ids.a).camera;
          delete document.visibilityState;
          resolve({ cam: c, state: window.MindRoot.storage.saveState().state });
        });
      });
    });
  }, ids);
  t.check('in the store before storage writes', handed.cam && near(handed.cam.k, 1.2), handed);
  t.check('and storage is writing it', handed.state === 'saving' || handed.state === 'saved', handed.state);

  t.step('a second tab shows the map read-only');
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });
  var url = page.url();
  var second = await t.context.newPage();
  await second.goto(url);
  await booted(second);
  await settledOn(second, ids.a);
  var ro = await second.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    var applied = ns.session.apply(ns.doc.addChild(c.state, '0', 'Not here'), { label: 'store.label.editMap' });
    return {
      readOnly: ns.session.readOnly(),
      tabs: ns.tabs.readOnly(),
      view: ns.session.view.options().readOnly,
      applied: applied,
      text: ns.session.current().text,
      undo: ns.commands.enabled('history.undo')
    };
  });
  t.eq(ro.tabs, true, 'the tab guard made it read-only');
  t.eq(ro.readOnly, true, 'session.readOnly()');
  t.eq(ro.view, true, 'the view is read-only');
  t.eq(ro.applied, false, 'apply() refuses');
  t.eq(ro.text, MAP_A.replace('- Beta\n', '- Beta <!-- side: left -->\n'), 'the text is untouched');
  t.eq(ro.undo, false, 'undo is off');
  await second.evaluate(function () { window.MindRoot.session.view.fold('1', true); });
  t.eq(await second.evaluate(function () { return window.MindRoot.session.view.isFolded('1'); }), true, 'looking (folding) still works there');
  await second.close();

  t.step('an edit that moves a node folded by its marker is no fold by hand');
  var mk = await page.evaluate(function (ids) {
    var m = window.MindRoot.store.createMap(ids.pid, { name: 'Marks', text: '# Marks\n\n- Alpha\n- Gamma <!-- markmap: fold -->\n  - Gamma one\n' });
    return m.id;
  }, ids);
  await settledOn(page, mk);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded('1'); }), true, 'Gamma folded by its marker');
  await page.evaluate(function () {
    var ns = window.MindRoot;
    var c = ns.session.current();
    ns.session.apply(ns.doc.addSibling(c.state, '0', 'Beta'), { label: 'store.label.editMap' });
    return ns.session.view.settled();
  });
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded('2'); }), true, 'Gamma moved down, still folded');
  t.same(await page.evaluate(function (a) { return window.MindRoot.store.mapView(a[0], a[1]).folds; }, [ids.pid, mk]), [], 'nothing written: the marker still rules');
  await page.evaluate(function (a) {
    var ns = window.MindRoot;
    ns.store.setMapText(a[0], a[1], ns.session.current().text.replace(' <!-- markmap: fold -->', ''), { origin: 'source' });
    ns.store.setActive(a[0], a[2]);
  }, [ids.pid, mk, ids.b]);
  await settledOn(page, ids.b);
  await page.evaluate(function (a) { window.MindRoot.store.setActive(a[0], a[1]); }, [ids.pid, mk]);
  await settledOn(page, mk);
  t.eq(await page.evaluate(function () { return window.MindRoot.session.view.isFolded('2'); }), false, 'its marker removed in the text: open on the next visit');
};
