/* layout: at phone, tablet and desktop sizes, with touch where a person
 * would have it, the page never scrolls sideways, every visible control is
 * on screen (and finger-sized on touch), the stage never collapses, the
 * sidebar is a column or a drawer that opens and closes, and the thumb bar
 * exists only on phones. Light and dark screenshots go to test/out/. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

var SIZES = [
  { name: '320x640', viewport: { width: 320, height: 640 }, touch: true, layout: 'compact' },
  { name: '390x844-touch', viewport: { width: 390, height: 844 }, touch: true, layout: 'compact' },
  { name: '768x1024-touch', viewport: { width: 768, height: 1024 }, touch: true, layout: 'medium' },
  /* A phone on its side: short, but still a finger (44 px), with the map's name in the bar. */
  { name: '844x390-touch', viewport: { width: 844, height: 390 }, touch: true, layout: 'medium' },
  { name: '1024x768-touch', viewport: { width: 1024, height: 768 }, touch: true, layout: 'expanded' },
  { name: '1280x800', viewport: { width: 1280, height: 800 }, touch: false, layout: 'expanded' },
  { name: '1920x1080', viewport: { width: 1920, height: 1080 }, touch: false, layout: 'expanded' }
];

/* Everything a person could press, if it is drawn and not hidden away. */
function controlsReport() {
  var sel = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var out = { outside: [], small: [], count: 0 };
  Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
    if (el.closest('[inert], [hidden], .icon-sprite')) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.getClientRects().length === 0) return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    out.count++;
    var name = el.id || el.getAttribute('aria-label') || el.className || el.tagName;
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.outside.push(name + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
    if (r.width < 43.5 || r.height < 43.5) out.small.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return out;
}

module.exports = async function (t) {
  for (var i = 0; i < SIZES.length; i++) {
    var size = SIZES[i];
    var opts = { viewport: size.viewport };
    if (size.touch) { opts.hasTouch = true; opts.isMobile = true; }
    var ctx = await H.context(t, opts);
    var page = await ctx.newPage();

    t.step(size.name);
    await t.open('', { page: page });
    var geo = await page.evaluate(function () {
      var se = document.scrollingElement;
      return {
        layout: document.documentElement.getAttribute('data-layout'),
        innerWidth: window.innerWidth,
        scrollWidth: se.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        stageH: document.getElementById('stage').getBoundingClientRect().height,
        coarse: matchMedia('(pointer: coarse)').matches
      };
    });
    t.eq(geo.innerWidth, size.viewport.width, 'device width honoured (viewport meta)');
    t.eq(geo.layout, size.layout, 'layout');
    t.check('no horizontal page scroll', geo.scrollWidth <= geo.innerWidth && geo.bodyWidth <= geo.innerWidth, geo);
    t.check('the stage has room', geo.stageH > 200, geo);
    t.eq(geo.coarse, size.touch, 'pointer kind');

    var rep = await page.evaluate(controlsReport);
    t.check('controls found', rep.count > 0, rep);
    t.same(rep.outside, [], 'every visible control inside the viewport');
    if (size.touch) t.same(rep.small, [], 'every control at least 44px on touch');
    t.same(await page.evaluate(async function () {
      /* In Italian, whose words are the longer ones. */
      window.MindRoot.i18n.setLang('it');
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      var cut = Array.prototype.filter.call(document.querySelectorAll('#sidebar .sb-tool:not(.sb-tool--icon) .sb-tool__label'), function (l) {
        return l.getClientRects().length && l.scrollWidth > l.clientWidth + 0.5;
      }).map(function (l) { return l.textContent; });
      window.MindRoot.i18n.setLang('en');
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      return cut;
    }), [], 'no word in the sidebar footer is cut short');
    if (size.viewport.height < 480) t.eq(await page.evaluate(function () { var el = document.querySelector('.title'); return !!el && getComputedStyle(el).display !== 'none'; }), true, 'the title stays in the top bar');

    var thumb = await page.evaluate(function () {
      var tb = document.getElementById('thumbbar');
      var actions = document.getElementById('topbar-actions');
      return { thumb: tb.offsetParent !== null && getComputedStyle(tb).display !== 'none', actions: actions.offsetParent !== null };
    });
    t.eq(thumb.thumb, size.layout === 'compact', 'thumb bar only on phones');
    t.eq(thumb.actions, size.layout !== 'compact', 'top actions capsule off phones');
    if (size.layout === 'compact') {
      var tb = await page.evaluate(function () {
        var r = document.getElementById('thumbbar').getBoundingClientRect();
        return { bottom: r.bottom, h: window.innerHeight, centre: (r.left + r.right) / 2, w: window.innerWidth };
      });
      t.check('thumb bar near the bottom', tb.h - tb.bottom >= 7 && tb.h - tb.bottom <= 40, tb);
      t.check('thumb bar centred', Math.abs(tb.centre - tb.w / 2) < 2, tb);
    }

    await t.shot(size.name + '-light', page);
    await page.evaluate(function () { window.MindRoot.prefs.set('theme', 'dark'); });
    await H.until(page, function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
    /* The theme crossfade (a view transition) finished before the shot. */
    await H.until(page, function () { return !document.getAnimations().some(function (a) { return a.playState === 'running'; }); }, null, 3000);
    t.eq(await page.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }), 'rgb(19, 21, 25)', 'dark theme applied');
    await t.shot(size.name + '-dark', page);
    await page.evaluate(function () { window.MindRoot.prefs.set('theme', 'system'); });

    t.step(size.name + ' sidebar');
    if (size.layout === 'expanded') {
      var col = await page.evaluate(function () {
        var s = document.getElementById('sidebar').getBoundingClientRect();
        var m = document.getElementById('main').getBoundingClientRect();
        return { sw: s.width, sr: s.right, ml: m.left };
      });
      /* Layout v3: a floating panel inside its column, the map right after it. */
      t.check('a column beside the map', col.sw > 200 && col.sr <= col.ml + 1 && col.ml - col.sr < 24, col);
      await page.click('#sidebar-toggle');
      await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
      var closedCol = await page.evaluate(function () {
        return { ml: document.getElementById('main').getBoundingClientRect().left, inert: document.getElementById('sidebar').inert, pref: window.MindRoot.prefs.get('sidebarOpen') };
      });
      t.same(closedCol, { ml: 0, inert: true, pref: false }, 'closed: the map takes the width, the column is inert, the choice is kept');
      await page.click('#sidebar-toggle');
      await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; });
      t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('sidebarOpen'); }), true, 'reopened and kept');
    } else {
      var start = await page.evaluate(function () {
        var r = document.getElementById('sidebar').getBoundingClientRect();
        return { state: document.documentElement.getAttribute('data-sidebar'), right: r.right, inert: document.getElementById('sidebar').inert };
      });
      t.check('a drawer, closed at start and off screen', start.state === 'closed' && start.right <= 1 && start.inert, start);
      await page.click('#sidebar-toggle');
      await H.until(page, function () {
        var r = document.getElementById('sidebar').getBoundingClientRect();
        return document.documentElement.getAttribute('data-sidebar') === 'open' && r.left >= -0.5;
      });
      var open = await page.evaluate(function () {
        var r = document.getElementById('sidebar').getBoundingClientRect();
        return { left: r.left, right: r.right, w: window.innerWidth, expanded: document.getElementById('sidebar-toggle').getAttribute('aria-expanded'), focusInside: document.getElementById('sidebar').contains(document.activeElement) };
      });
      t.check('open over the map, inside the screen', open.left >= -0.5 && open.right <= open.w && open.right > 200, open);
      t.eq(open.expanded, 'true', 'toggle says expanded');
      t.eq(open.focusInside, true, 'focus moved into the drawer');
      var rep2 = await page.evaluate(controlsReport);
      t.same(rep2.outside, [], 'controls inside the viewport with the drawer open');
      await page.keyboard.press('Escape');
      await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
      t.eq(await page.evaluate(function () { return document.activeElement && document.activeElement.id; }), 'sidebar-toggle', 'Escape closes it and focus returns');
      await page.click('#sidebar-toggle');
      await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; });
      var w = size.viewport.width;
      var tapped = await page.evaluate(function () {
        window.__stageTaps = 0;
        document.getElementById('stage').addEventListener('click', function () { window.__stageTaps++; });
        return true;
      });
      t.check('listener set', tapped);
      await page.mouse.click(w - 10, Math.round(size.viewport.height / 2));
      await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
      t.eq(await page.evaluate(function () { return window.__stageTaps; }), 0, 'a tap outside closes it and does nothing else');
      t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('sidebarOpen'); }), true, 'drawer state is not persisted');

      if (size.touch && size.viewport.height > 450) {
        /* Swipe from the left edge with a finger (synthetic touch pointers). */
        var edgeHit = await page.evaluate(async function () {
          /* What a finger at the very edge lands on. */
          var target = document.elementFromPoint(6, 400);
          function fire(type, el, x, y) {
            el.dispatchEvent(new PointerEvent(type, { pointerId: 42, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
          }
          fire('pointerdown', target, 6, 400);
          for (var x = 20; x <= 240; x += 20) {
            fire('pointermove', target, x, 402);
            await new Promise(function (r) { requestAnimationFrame(r); });
          }
          fire('pointerup', target, 240, 402);
          return target.className;
        });
        t.eq(edgeHit, 'edge-swipe', 'the edge strip catches the finger');
        await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; });
        t.check('edge swipe opens the drawer', true);
        await page.evaluate(function () { window.MindRoot.shell.sidebar.close(); });
        await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
        /* The strip belongs to the map: the start of every line of a docked
         * Markdown panel, and a floater near the edge, keep their taps. The
         * floaters are probed with the panel closed (on phones the real
         * panel covers the whole main area by design, floaters included);
         * the panel is probed as what source.js builds in it, whatever
         * element of it the finger lands on. */
        var under = await page.evaluate(async function () {
          function frames() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
          var floaters = document.getElementById('floaters');
          var low = document.createElement('button');
          low.type = 'button';
          low.id = 'probe-floater';
          low.style.cssText = 'position:absolute;left:4px;top:120px;width:44px;height:44px;z-index:var(--z-map-overlay)';
          var plain = document.createElement('button');
          plain.type = 'button';
          plain.id = 'probe-plain';
          plain.style.cssText = 'position:absolute;left:4px;top:200px;width:44px;height:44px';
          floaters.appendChild(low);
          floaters.appendChild(plain);
          await frames();
          var stage = document.getElementById('stage').getBoundingClientRect();
          var hits = {
            floater: (document.elementFromPoint(10, stage.top + 140) || {}).id,
            plain: (document.elementFromPoint(10, stage.top + 220) || {}).id,
            map: (document.elementFromPoint(8, stage.top + 320) || {}).className,
            stripBottom: Math.round(document.querySelector('.edge-swipe').getBoundingClientRect().bottom),
            stageBottom: Math.round(stage.bottom)
          };
          low.remove();
          plain.remove();
          var src = document.getElementById('source');
          var ta = null;
          if (!src.children.length) {
            /* No Markdown module on this page: a stand-in field. */
            ta = document.createElement('textarea');
            ta.className = 'textarea';
            ta.style.cssText = 'display:block;width:100%;height:100%;margin:0';
            src.appendChild(ta);
          }
          src.style.height = '200px';
          src.hidden = false;
          await frames();
          var sr = src.getBoundingClientRect();
          var hit = document.elementFromPoint(8, sr.top + sr.height / 2);
          hits.source = hit && hit.closest && hit.closest('#source') ? 'source' : (hit ? hit.tagName + '.' + hit.className : null);
          if (ta) ta.remove();
          src.hidden = true;
          src.style.height = '';
          await frames();
          return hits;
        });
        t.same([under.source, under.floater, under.plain], ['source', 'probe-floater', 'probe-plain'], 'the Markdown panel and floaters near the edge keep their taps');
        t.check('the strip ends with the stage, above the docked panel', under.map === 'edge-swipe' && under.stripBottom === under.stageBottom, under);
        await page.evaluate(function () { window.MindRoot.shell.sidebar.open(); });
        await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; });
        await page.evaluate(async function () {
          var sb = document.getElementById('sidebar');
          function fire(type, x, y) {
            sb.dispatchEvent(new PointerEvent(type, { pointerId: 43, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
          }
          fire('pointerdown', 200, 300);
          for (var x = 180; x >= 20; x -= 20) {
            fire('pointermove', x, 302);
            await new Promise(function (r) { requestAnimationFrame(r); });
          }
          fire('pointerup', 20, 302);
        });
        await H.until(page, function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
        t.check('swiping it back closes it', true);
        t.eq(await page.evaluate(function () { return document.getElementById('sidebar').style.translate; }), '', 'no inline position left behind');
      }
    }

    t.step(size.name + ' the stage never collapses');
    var squeezed = await page.evaluate(async function () {
      var src = document.getElementById('source');
      src.hidden = false;
      src.style.height = '5000px';
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      var stage = document.getElementById('stage').getBoundingClientRect();
      var s = src.getBoundingClientRect();
      var out = { stage: stage.height, sourceBottom: s.bottom, vh: window.innerHeight, attr: document.documentElement.getAttribute('data-source'), scroll: document.scrollingElement.scrollHeight };
      src.hidden = true;
      src.style.height = '';
      return out;
    });
    t.check('stage keeps its minimum with a huge panel docked', squeezed.stage >= 95, squeezed);
    t.check('the page still does not scroll', squeezed.scroll <= squeezed.vh, squeezed);
    t.eq(squeezed.attr, 'open', 'the shell noticed the panel');
    if (size.layout === 'compact') {
      var clear = await page.evaluate(async function () {
        var src = document.getElementById('source');
        src.hidden = false;
        src.style.height = '200px';
        await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
        var out = { srcBottom: src.getBoundingClientRect().bottom, thumbTop: document.getElementById('thumbbar').getBoundingClientRect().top };
        src.hidden = true;
        src.style.height = '';
        return out;
      });
      t.check('a docked panel ends above the thumb bar', clear.srcBottom <= clear.thumbTop + 0.5, clear);
    }
    await ctx.close();
  }
};
