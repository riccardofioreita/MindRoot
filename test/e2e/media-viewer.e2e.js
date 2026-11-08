/* media-viewer: the viewer on the real app, at a desktop and on a phone.
 *
 * A tap on a picture on the map opens it; split stands beside the map on a
 * wide screen (the stage really shrinks, the top bar stays over the map) and
 * under it on a phone (the thumb bar keeps its row under it); the seam
 * resizes it by hand and by keyboard and is remembered; full covers the map
 * (which leaves the keyboard's reach) and on a phone the thumb bar too; the
 * card floats, moves by its bar, resizes by its corner, stays inside the
 * screen and comes back where it was left; the photo zooms with the wheel,
 * the buttons, the keys and a double tap, and pans by drag; a missing file
 * says so; Escape closes and gives the focus back. Screenshots for review in
 * test/out. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;
var T = require('../fixtures/touch.js');

var MAP = '# Pics\n\n- Alpha\n- Beta\n';

async function addPhoto(page, path, w, h) {
  await M.makeImage(page, 'photo.png', { w: w, h: h, color: '#2f6fb3' });
  return page.evaluate(function (p) {
    return window.MindRoot.media.addFiles([window.__files['photo.png']], { path: p, field: 'line' }, { quiet: true });
  }, path);
}

async function clickPicture(page, path) {
  await E.until(page, function (p) {
    var img = window.MindRoot.session.view.nodeEl(p).querySelector('img.mv-img');
    return img && img.complete && img.naturalWidth > 0;
  }, path, 6000);
  var at = await page.evaluate(function (p) {
    var r = window.MindRoot.session.view.nodeEl(p).querySelector('img.mv-img').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, path);
  await page.mouse.click(at.x, at.y);
}

function photo(page) {
  return page.evaluate(function () {
    var img = document.querySelector('#viewer .viewer__img');
    var wrap = document.querySelector('#viewer .viewer__photo');
    if (!img || !wrap) return null;
    var m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(img.style.transform || '');
    var w = wrap.getBoundingClientRect();
    return { ready: wrap.hasAttribute('data-ready'), nw: img.naturalWidth, x: m ? +m[1] : null, y: m ? +m[2] : null, k: m ? +m[3] : null, ww: w.width, wh: w.height };
  });
}

async function waitPhoto(page) {
  await E.until(page, function () { var w = document.querySelector('#viewer .viewer__photo'); return w && w.hasAttribute('data-ready'); }, null, 6000);
  return photo(page);
}

async function closed(page) {
  try { await E.until(page, function () { return !window.MindRoot.media.viewerState(); }, null, 4000); } catch (err) { /* checked */ }
  return page.evaluate(function () { return !window.MindRoot.media.viewerState() && document.getElementById('viewer').hidden; });
}

module.exports = async function (t) {
  var s = await E.boot(t, [['Pics', MAP]]);
  var page = s.page;
  await addPhoto(page, '0', 400, 300);
  await E.settled(page);

  t.step('a double click on the picture of a selected node opens the viewer and nothing else');
  await E.select(page, '0');
  await E.settled(page);
  await E.until(page, function () {
    var img = window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img');
    return img && img.complete && img.naturalWidth > 0;
  }, null, 6000);
  var dbl = await page.evaluate(function () { var r = window.MindRoot.session.view.nodeEl('0').querySelector('img.mv-img').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.dblclick(dbl.x, dbl.y);
  await E.until(page, function () { return !!window.MindRoot.media.viewerState(); }, null, 12000);
  await page.waitForTimeout(150);
  t.eq(await E.renaming(page), null, 'the viewer opens, and the node is not opened for writing');
  await page.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await closed(page);
  /* The stage takes the room back when the viewer goes: the picture is
   * clicked where it stands once that has settled, not where it was. */
  await E.settled(page);

  t.step('a tap on a picture on the map opens it beside the map');
  await page.evaluate(function () { window.MindRoot.prefs.set('viewer', 'split'); });
  var stageBefore = await E.rectOf(page, '#stage');
  await clickPicture(page, '0');
  await E.until(page, function () { return !!window.MindRoot.media.viewerState(); }, null, 12000);
  var vs = await page.evaluate(function () { var v = window.MindRoot.media.viewerState(); return { kind: v.kind, path: v.path, mode: v.mode, side: v.side }; });
  t.same(vs, { kind: 'photo', path: 'assets/photo.png', mode: 'split', side: 'right' }, 'a photo, split, on the right');
  t.eq(await E.selected(page), '0', 'its node is selected');
  var p = await waitPhoto(page);
  t.eq(p.nw, 400, 'the picture is shown');
  t.check('whole and centred, not blown up', p.k <= 1 && Math.abs(p.x - (p.ww - 400 * p.k) / 2) < 1.5 && Math.abs(p.y - (p.wh - 300 * p.k) / 2) < 1.5, p);
  var viewer = await E.resting(page, '#viewer');
  var stage = await E.rectOf(page, '#stage');
  var main = await E.rectOf(page, '#main');
  t.check('on the right of the main area', Math.abs(viewer.right - main.right) < 1.5 && Math.abs(viewer.w - main.w * 0.42) < 2, { viewer: viewer, main: main });
  t.check('the stage shrank beside it', stage.right <= viewer.x + 1 && stage.w < stageBefore.w - 100, { stage: stage, viewer: viewer });
  var topbar = await E.rectOf(page, '#topbar');
  t.check('the top bar stays over the map', topbar.right <= viewer.x + 1, { topbar: topbar, viewer: viewer });
  t.eq(await page.evaluate(function () { return document.getElementById('viewer-title').textContent; }), 'Picture: photo.png', 'titled');
  t.check('the photo has the keyboard', await page.evaluate(function () { return document.activeElement === document.querySelector('#viewer .viewer__photo'); }));
  await t.shot('desktop-split');

  t.step('the photo zooms and pans');
  var c = await E.rectOf(page, '#viewer .viewer__photo');
  await page.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
  await page.mouse.wheel(0, -400);
  try { await E.until(page, function (k0) { var img = document.querySelector('#viewer .viewer__img'); return /scale\(([\d.]+)\)/.test(img.style.transform) && +RegExp.$1 > k0 * 1.5; }, p.k, 3000); } catch (err) { /* checked */ }
  var z = await photo(page);
  t.check('the wheel zooms in at the pointer', z.k > p.k * 1.5, [p, z]);
  var cx = (c.w / 2 - z.x) / z.k;
  t.check('keeping the point under it still', Math.abs(cx - (c.w / 2 - p.x) / p.k) < 2, [p, z]);
  /* Zoomed in far enough that the drag below moves the picture on both
   * axes without meeting an edge: a clamped axis would not show the pan. */
  await page.mouse.wheel(0, -500);
  try { await E.until(page, function (box) { var img = document.querySelector('#viewer .viewer__img'); return /scale\(([\d.]+)\)/.test(img.style.transform) && 300 * +RegExp.$1 > box.h + 200 && 400 * +RegExp.$1 > box.w + 200; }, { w: c.w, h: c.h }, 3000); } catch (err) { /* checked */ }
  z = await photo(page);
  t.check('room to move both ways', z.x < -80 && z.y < -50 && z.x + 400 * z.k > c.w + 80 && z.y + 300 * z.k > c.h + 50, z);
  await page.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.w / 2 + 60, c.y + c.h / 2 + 30, { steps: 6 });
  await page.mouse.up();
  var pan = await photo(page);
  t.check('a drag moves it, across and down', Math.abs(pan.x - z.x - 60) < 2 && Math.abs(pan.y - z.y - 30) < 2 && Math.abs(pan.k - z.k) < 1e-9, [z, pan]);
  await page.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.w / 2 + 5000, c.y + c.h / 2 + 5000, { steps: 4 });
  await page.mouse.up();
  var edge = await photo(page);
  t.check('but never past its edges', Math.abs(edge.x) < 0.5 && Math.abs(edge.y) < 0.5, edge);
  t.eq(await page.evaluate(function () { return document.querySelector('#viewer [aria-label="Fit the picture"]').getAttribute('aria-disabled'); }), 'false', 'fit is offered');
  await page.click('#viewer [aria-label="Fit the picture"]');
  await page.waitForTimeout(300);
  t.check('fit puts it back', Math.abs((await photo(page)).k - p.k) < 1e-6);
  var textBefore = await E.text(page);
  await page.focus('#viewer .viewer__photo');
  await page.keyboard.press('+');
  t.check('+ zooms in', (await photo(page)).k > p.k);
  await page.keyboard.press('0');
  t.check('0 fits', Math.abs((await photo(page)).k - p.k) < 1e-6);
  await page.keyboard.press('Delete');
  t.eq(await E.text(page), textBefore, 'keys in the viewer never reach the map');
  await page.mouse.dblclick(c.x + c.w / 2, c.y + c.h / 2);
  await page.waitForTimeout(350);
  t.check('a double click zooms in', (await photo(page)).k >= p.k * 1.9, await photo(page));
  await page.mouse.dblclick(c.x + c.w / 2, c.y + c.h / 2);
  await page.waitForTimeout(350);
  t.check('and back to the whole picture', Math.abs((await photo(page)).k - p.k) < 1e-6, await photo(page));

  t.step('the seam');
  var seam = await E.rectOf(page, '#viewer .viewer__seam');
  await page.mouse.move(seam.x + seam.w / 2, seam.y + seam.h / 2);
  await page.mouse.down();
  await page.mouse.move(seam.x + seam.w / 2 - main.w * 0.1, seam.y + seam.h / 2, { steps: 5 });
  await page.mouse.up();
  var frac = await page.evaluate(function () { return window.MindRoot.prefs.get('mediaViewer').split; });
  t.check('dragged wider and remembered', Math.abs(frac - 0.52) < 0.01, frac);
  viewer = await E.resting(page, '#viewer');
  t.check('the viewer follows', Math.abs(viewer.w - main.w * frac) < 2, viewer);
  await page.focus('#viewer .viewer__seam');
  await page.keyboard.press('ArrowRight');
  frac = await page.evaluate(function () { return window.MindRoot.prefs.get('mediaViewer').split; });
  t.check('the arrows move it too', Math.abs(frac - 0.47) < 0.01, frac);
  t.eq(await page.getAttribute('#viewer .viewer__seam', 'aria-valuenow'), '47', 'and it says how much');

  t.step('full: over the whole map');
  await page.click('#viewer .viewer__modes [data-mode="full"]');
  viewer = await E.resting(page, '#viewer');
  t.check('covers the main area', Math.abs(viewer.x - main.x) < 1.5 && Math.abs(viewer.w - main.w) < 1.5 && Math.abs(viewer.h - main.h) < 1.5, { viewer: viewer, main: main });
  t.eq(await page.evaluate(function () { return document.getElementById('stage').hasAttribute('inert'); }), true, 'the map is out of the keyboard\'s reach');
  t.eq(await page.getAttribute('#viewer .viewer__modes [data-mode="full"]', 'aria-pressed'), 'true', 'the button says so');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('viewer'); }), 'full', 'remembered');

  t.step('card: floats, moves, resizes, comes back where it was');
  await page.click('#viewer .viewer__modes [data-mode="card"]');
  viewer = await E.resting(page, '#viewer');
  t.check('inside the main area', viewer.x >= main.x && viewer.right <= main.right && viewer.y >= main.y && viewer.bottom <= main.bottom, { viewer: viewer, main: main });
  t.eq(await page.evaluate(function () { return document.getElementById('stage').hasAttribute('inert'); }), false, 'the map is reachable again');
  var title = await E.rectOf(page, '#viewer .viewer__title');
  await page.mouse.move(title.x + 20, title.y + title.h / 2);
  await page.mouse.down();
  await page.mouse.move(title.x - 180, title.y + title.h / 2 + 60, { steps: 8 });
  await page.mouse.up();
  var moved = await E.rectOf(page, '#viewer');
  t.check('dragged by its bar', Math.abs(moved.x - (viewer.x - 200)) < 2 && Math.abs(moved.y - (viewer.y + 60)) < 2, { before: viewer, after: moved });
  var grip = await E.rectOf(page, '#viewer .viewer__grip');
  await page.mouse.move(grip.x + grip.w / 2, grip.y + grip.h / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.w / 2 + 50, grip.y + grip.h / 2 + 40, { steps: 6 });
  await page.mouse.up();
  var sized = await E.rectOf(page, '#viewer');
  t.check('resized by its corner', Math.abs(sized.w - moved.w - 50) < 2 && Math.abs(sized.h - moved.h - 40) < 2, { moved: moved, sized: sized });
  var title2 = await E.rectOf(page, '#viewer .viewer__title');
  await page.mouse.move(title2.x + 10, title2.y + title2.h / 2);
  await page.mouse.down();
  await page.mouse.move(-500, 2000, { steps: 4 });
  await page.mouse.up();
  var clamped = await E.rectOf(page, '#viewer');
  t.check('never past the edges', clamped.x >= main.x && clamped.bottom <= main.bottom + 0.5, clamped);
  var kept = await E.rectOf(page, '#viewer');
  await page.click('#viewer .viewer__modes [data-mode="split"]');
  await page.click('#viewer .viewer__modes [data-mode="card"]');
  var back = await E.rectOf(page, '#viewer');
  t.check('back where it was left', Math.abs(back.x - kept.x) < 1.5 && Math.abs(back.y - kept.y) < 1.5 && Math.abs(back.w - kept.w) < 1.5, { kept: kept, back: back });
  await t.shot('desktop-card');

  t.step('Escape closes it and gives the focus back');
  await page.focus('#viewer .viewer__photo');
  await page.keyboard.press('Escape');
  t.eq(await closed(page), true, 'closed');
  t.eq(await page.evaluate(function () { return document.activeElement === window.MindRoot.session.view.el; }), true, 'the map has the keyboard');
  t.eq(await page.evaluate(function () { return document.documentElement.hasAttribute('data-viewer'); }), false, 'nothing left on <html>');

  t.step('a picture that is not in the project says so');
  await page.evaluate(function () { window.MindRoot.media.openViewer('assets/nothing.png', { owner: null }); });
  try { await E.until(page, function () { var m = document.querySelector('#viewer .viewer__missing'); return m && !m.hidden; }, null, 4000); } catch (err) { /* checked */ }
  t.eq(await page.evaluate(function () { var m = document.querySelector('#viewer .viewer__missing'); return m ? m.textContent : null; }), 'This picture is not in the project: assets/nothing.png', 'missing');
  await page.click('#viewer .viewer__close');
  t.eq(await closed(page), true, 'the close button closes it');

  t.step('Italian');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('it'); window.MindRoot.media.openViewer('assets/photo.png'); });
  t.eq(await page.evaluate(function () { return document.getElementById('viewer-title').textContent; }), 'Immagine: photo.png', 'the title');
  t.eq(await page.getAttribute('#viewer .viewer__close', 'aria-label'), 'Chiudi il visore', 'the close button');
  await page.evaluate(function () { window.MindRoot.media.closeViewer(); window.MindRoot.i18n.setLang('en'); });
  await closed(page);

  t.step('a phone: under the map, the thumb bar below it');
  var ctx = await t.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await E.H.stubMissing(ctx, t);
  var phone = await ctx.newPage();
  var ps = await E.boot(t, [['Pics', MAP]], { page: phone });
  await phone.evaluate(function () { window.MindRoot.prefs.set('viewer', 'split'); });
  await addPhoto(phone, '0', 300, 400);
  await E.settled(phone);
  await phone.evaluate(function () { window.MindRoot.session.select('0'); window.MindRoot.media.openViewer('assets/photo.png'); });
  await waitPhoto(phone);
  var pv = await phone.evaluate(function () { var v = window.MindRoot.media.viewerState(); return [v.mode, v.side]; });
  t.same(pv, ['split', 'bottom'], 'split stands under the map');
  var pViewer = await E.resting(phone, '#viewer');
  var pStage = await E.rectOf(phone, '#stage');
  var thumb = await E.rectOf(phone, '#thumbbar');
  t.check('under the stage', pViewer.y >= pStage.bottom - 1, { viewer: pViewer, stage: pStage });
  t.check('the thumb bar stays, under it', thumb && thumb.h > 0 && thumb.y >= pViewer.bottom - 1, { viewer: pViewer, thumb: thumb });
  t.check('inside the screen', pViewer.x >= 0 && pViewer.right <= 390.5 && pViewer.bottom <= 844.5, pViewer);
  var tapAt = await E.rectOf(phone, '#viewer .viewer__photo');
  var before = await photo(phone);
  /* Fingers through CDP, the way a touch screen delivers them: pointer
   * events of type touch. The double tap on the hand's clock
   * (fixtures/touch.js): two plain taps can reach a loaded page further
   * apart than a double tap. */
  var pcdp = await ctx.newCDPSession(phone);
  await T.doubleTap(pcdp, [tapAt.x + tapAt.w / 2, tapAt.y + tapAt.h / 2]);
  try { await E.until(phone, function (k0) { var img = document.querySelector('#viewer .viewer__img'); return /scale\(([\d.]+)\)/.test(img.style.transform) && +RegExp.$1 > k0 * 1.5; }, before.k, 3000); } catch (err) { /* checked */ }
  t.check('a double tap zooms in', (await photo(phone)).k > before.k * 1.5, [before, await photo(phone)]);

  /* Two fingers: the second joining the first. */
  function touches(type, list) {
    return pcdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: list.map(function (q) { return { x: q[0], y: q[1], id: q[2] }; }) });
  }
  async function pinch(cx, cy, from, to) {
    await touches('touchStart', [[cx - from, cy, 1]]);
    await touches('touchStart', [[cx - from, cy, 1], [cx + from, cy, 2]]);
    for (var i = 1; i <= 8; i++) {
      var d = from + (to - from) * i / 8;
      await touches('touchMove', [[cx - d, cy, 1], [cx + d, cy, 2]]);
    }
    await touches('touchEnd', []);
  }
  await phone.evaluate(function () { document.querySelector('#viewer .viewer__photo').focus(); });
  await phone.keyboard.press('0');
  var fitted = await photo(phone);
  var mid = { x: tapAt.x + tapAt.w / 2, y: tapAt.y + tapAt.h / 2 };
  await phone.waitForTimeout(400);
  await pinch(mid.x, mid.y, 30, 90);
  var pinched = await photo(phone);
  t.check('a pinch outwards zooms in, about as far as the fingers spread', pinched.k > fitted.k * 2.4 && pinched.k < fitted.k * 3.6, [fitted, pinched]);
  var sceneX = (mid.x - tapAt.x - fitted.x) / fitted.k;
  var sceneX2 = (mid.x - tapAt.x - pinched.x) / pinched.k;
  t.check('around the point between the fingers', Math.abs(sceneX - sceneX2) < 3, [sceneX, sceneX2]);
  await pinch(mid.x, mid.y, 90, 20);
  t.check('a pinch inwards zooms back out, never below the whole picture', Math.abs((await photo(phone)).k - fitted.k) < 1e-6, await photo(phone));
  await t.shot('phone-split', phone);
  var bar = await phone.evaluate(function () {
    var title = document.getElementById('viewer-title');
    var vis = function (sel) { var el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
    return { full: title.scrollWidth <= title.clientWidth + 1, tools: vis('#viewer .viewer__tools'), modes: vis('#viewer .viewer__modes'), more: vis('#viewer .viewer__more') };
  });
  t.same(bar, { full: true, tools: false, modes: false, more: true }, 'the zoom and the places fold into one menu, the title reads whole');
  await phone.tap('#viewer .viewer__more');
  await phone.waitForSelector('.menu__item', { timeout: 12000 });
  var rows = await phone.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.menu__item .menu__label'), function (e) { return e.textContent; }); });
  t.same(rows, ['Zoom in', 'Zoom out', 'Fit the picture', 'Beside the map', 'Over the whole map', 'As a card'], 'the menu');
  await phone.evaluate(function () {
    var row = Array.prototype.find.call(document.querySelectorAll('.menu__item'), function (e) { return e.textContent.indexOf('Over the whole map') >= 0; });
    row.click();
  });
  await E.until(phone, function () { return document.documentElement.getAttribute('data-viewer') === 'full'; }, null, 12000);
  var pFull = await E.resting(phone, '#viewer');
  t.check('full covers the screen', pFull.y <= 0.5 && pFull.h >= 843, pFull);
  t.eq(await phone.evaluate(function () { var b = document.getElementById('thumbbar'); return getComputedStyle(b).display; }), 'none', 'the thumb bar steps aside');
  await phone.evaluate(function () { window.MindRoot.media.setViewerMode('card'); });
  var pCard = await E.resting(phone, '#viewer');
  var pThumb = await E.rectOf(phone, '#thumbbar');
  t.check('the card fits the screen', pCard.x >= 0 && pCard.right <= 390.5 && pCard.y >= 0 && pCard.bottom <= 844.5, pCard);
  t.check('and stays clear of the thumb bar', pCard.bottom <= pThumb.y + 0.5, { card: pCard, thumb: pThumb });
  await t.shot('phone-card', phone);
  await phone.evaluate(function () { window.MindRoot.media.closeViewer(); });
  t.eq(await closed(phone), true, 'closed on the phone too');

  t.step('a phone with the Markdown panel open: one layer at a time');
  await phone.evaluate(function () { window.MindRoot.media.setViewerMode('split'); window.MindRoot.commands.run('source.toggle'); });
  await E.until(phone, function () { return document.documentElement.getAttribute('data-source') === 'open'; }, null, 12000);
  var srcAlone = await E.resting(phone, '#source');
  await phone.evaluate(function () { window.MindRoot.media.openViewer('assets/photo.png'); });
  await waitPhoto(phone);
  var withSrc = await E.resting(phone, '#viewer');
  var srcUnder = await E.rectOf(phone, '#source');
  var pMain = await E.rectOf(phone, '#main');
  t.check('the viewer covers the panel, whole', Math.abs(withSrc.y - pMain.y) < 1 && withSrc.h > pMain.h * 0.8 && Math.abs(withSrc.w - pMain.w) < 1, { viewer: withSrc, main: pMain });
  t.check('the panel keeps its size under it', Math.abs(srcUnder.h - srcAlone.h) < 1 && Math.abs(srcUnder.y - srcAlone.y) < 1, { alone: srcAlone, under: srcUnder });
  t.eq(await phone.evaluate(function () { return document.elementFromPoint(195, 400).closest('#viewer') !== null; }), true, 'what is seen and touched is the viewer');
  await phone.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await closed(phone);
  var srcBack = await E.resting(phone, '#source');
  t.check('closing it gives the panel back as it was', Math.abs(srcBack.h - srcAlone.h) < 1 && Math.abs(srcBack.y - srcAlone.y) < 1, { alone: srcAlone, back: srcBack });
  await phone.evaluate(function () { window.MindRoot.commands.run('source.toggle'); });

  t.step('an upright tablet: stage, viewer and Markdown panel all fit');
  var tctx = await t.newContext({ viewport: { width: 800, height: 1100 } });
  await E.H.stubMissing(tctx, t);
  var tab = await tctx.newPage();
  await E.boot(t, [['Pics', MAP]], { page: tab });
  await tab.evaluate(function () { window.MindRoot.prefs.set('viewer', 'split'); });
  await addPhoto(tab, '0', 300, 200);
  await E.settled(tab);
  await tab.evaluate(function () { window.MindRoot.commands.run('source.toggle'); });
  await E.until(tab, function () { return document.documentElement.getAttribute('data-source') === 'open'; }, null, 12000);
  await tab.evaluate(function () { window.MindRoot.media.openViewer('assets/photo.png'); });
  await waitPhoto(tab);
  var tSide = await tab.evaluate(function () { return window.MindRoot.media.viewerState().side; });
  t.eq(tSide, 'bottom', 'the viewer stands under the map');
  var tMain = await E.rectOf(tab, '#main');
  var tStage = await E.rectOf(tab, '#stage');
  var tViewer = await E.resting(tab, '#viewer');
  var tSrc = await E.resting(tab, '#source');
  t.check('in that order, top to bottom', tStage.bottom <= tViewer.y + 1 && tViewer.bottom <= tSrc.y + 1, { stage: tStage, viewer: tViewer, source: tSrc });
  t.check('none past the bottom of the main area', tSrc.bottom <= tMain.bottom + 0.5 && tSrc.h > 40, { source: tSrc, main: tMain });
  await tab.evaluate(function () { window.MindRoot.media.closeViewer(); });
  await closed(tab);
};
