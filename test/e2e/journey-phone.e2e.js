/* journey-phone: the same app in one hand, on a 390x844 touch phone. Every
 * action is a finger (real touch points through the DevTools protocol, or
 * Playwright's tap), and the checks are what the screen shows and what the
 * store keeps:
 *
 *   an empty first start -> a project from the welcome card -> nodes from
 *   the thumb bar -> rename -> a colour and a note from the "more" sheet ->
 *   undo from the thumb bar -> the Markdown panel over the whole screen ->
 *   a long press opens the node's menu -> the drawer: a second map, and
 *   back -> a branch deleted and its Undo toast -> the palette, settings,
 *   the dark theme -> reload.
 *
 * Along the way every control on screen must be inside it and at least 44
 * px on both sides (a finger), and the page must never scroll sideways.
 * Screenshots: test/out/journey-phone-*.png. */
'use strict';

var VIEW = { width: 390, height: 844 };

module.exports = async function (t) {
  var ctx = await t.newContext({ viewport: VIEW, hasTouch: true, isMobile: true });
  var page = await ctx.newPage();
  var cdp = await ctx.newCDPSession(page);
  var J = helpers(page, cdp, t);

  /* ------------------------------------------------------------ empty start */
  t.step('an empty first start');
  await t.open('', { page: page });
  t.eq(await page.evaluate(function () { return document.documentElement.getAttribute('data-layout'); }), 'compact', 'a phone gets the compact layout');
  await page.waitForSelector('#welcome .welcome__card:has-text("No projects yet")', { state: 'visible' });
  t.check('the welcome card says what to do', true);
  t.eq(await page.isVisible('#topbar-actions'), false, 'no top capsule of actions on a phone');
  t.same((await J.barIds()).thumb, ['node.addChild', 'node.addSibling', 'node.rename', 'history.undo'], 'the thumb bar holds child, sibling, rename and undo');
  t.eq(await page.isVisible('#thumbbar .btn--more'), true, 'and "more"');
  await J.fingerSized('empty');
  await t.shot('empty', page);

  t.step('a project from the welcome card');
  await J.tapEl('#welcome button:has-text("New project")');
  await J.dialog();
  await page.keyboard.type('Garden');
  await page.keyboard.press('Enter');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Garden'; });
  await J.settled();
  t.eq(await J.text(), '# Garden\n', 'a project with one map, open');
  t.eq(await page.isVisible('#welcome .welcome__card'), false, 'the card has gone');

  /* ------------------------------------------------------------ thumb bar */
  t.step('nodes from the thumb bar');
  await J.tapNode('Garden');
  t.eq(await J.selected(), '', 'a tap selects the root');
  t.eq(await page.isVisible('.node-toolbar'), false, 'no toolbar floating by the node on a phone');
  /* On the root the thumb bar's add buttons are the two sides. */
  t.eq(await page.isVisible('#thumbbar [data-command="node.addLeft"]'), true, 'the root chosen: a branch on the left is one tap away');
  await J.tapEl('#thumbbar [data-command="node.addRight"]');
  await J.renaming();
  await page.keyboard.type('Tomatoes');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  await J.tapEl('#thumbbar [data-command="node.addSibling"]');
  await J.renaming();
  await page.keyboard.type('Basil');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  t.eq(await J.text(), '# Garden\n\n## Tomatoes\n\n## Basil\n', 'a child, then a sibling, named as they were made');
  var size = await page.evaluate(function () {
    var el = document.querySelector('#stage .mv-node[aria-selected="true"] .mv-title') || document.querySelector('#stage .mv-node .mv-title');
    var k = window.MindRoot.session.view.camera().k;
    return parseFloat(getComputedStyle(el).fontSize) * k;
  });
  t.check('the names were written large enough to read (16 px or more on screen)', size >= 15.5, size);

  t.step('rename from the thumb bar');
  await J.tapEl('#thumbbar [data-command="node.rename"]');
  await J.renaming();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Genoese basil');
  await J.tapEl('.format-bar[data-docked] button[aria-label="Save"], .format-bar button[aria-label="Done"], .format-bar button[aria-label^="Save"]');
  await J.notRenaming();
  t.eq(await J.text(), '# Garden\n\n## Tomatoes\n\n## Genoese basil\n', 'the format bar\'s tick saves the new name');

  /* ------------------------------------------------------------ more sheet */
  t.step('a colour from the "more" sheet');
  await J.more('Colour');
  await page.waitForSelector('.colorpicker:not([hidden]) .cp-chip', { state: 'visible' });
  t.eq(await page.evaluate(function () { return document.querySelector('.colorpicker').hasAttribute('data-sheet'); }), true, 'the picker is a bottom sheet');
  await J.fingerSized('picker');
  await J.tapEl('.colorpicker .cp-chip[aria-label^="Blue"]');
  await J.until(function () { return /## Genoese basil <!-- color: #3b6ea5 -->/.test(window.MindRoot.session.current().text); });
  t.check('the node is blue, in the file', true);
  await page.keyboard.press('Escape');
  await J.until(function () { var p = document.querySelector('.colorpicker'); return !p || p.hidden || !p.offsetParent; });

  t.step('a note from the "more" sheet');
  await J.more('Note on the node');
  await page.waitForSelector('.note-sheet textarea', { state: 'visible' });
  await page.keyboard.type('Water daily');
  await J.tapEl('button:has-text("Save")');
  await J.until(function () { return /> note: Water daily/.test(window.MindRoot.session.current().text); });
  t.check('the note is written under the node', /## Genoese basil <!-- color: #3b6ea5 -->\n- > note: Water daily\n/.test(await J.text()), await J.text());

  t.step('undo from the thumb bar');
  await J.tapEl('#thumbbar [data-command="history.undo"]');
  await J.until(function () { return !/Water daily/.test(window.MindRoot.session.current().text); });
  t.check('the note is taken back', true);
  await J.more('Redo');
  await J.until(function () { return /Water daily/.test(window.MindRoot.session.current().text); });
  t.check('and Redo (in "more") brings it back', true);

  /* ------------------------------------------------------------ Markdown */
  t.step('the Markdown panel');
  await J.more('Show the Markdown');
  await page.waitForSelector('#source:not([hidden]) .src-field', { state: 'visible' });
  var md = await page.evaluate(function () {
    var r = document.getElementById('source').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, thumb: document.getElementById('thumbbar').getBoundingClientRect().top, value: document.querySelector('#source .src-field').value };
  });
  t.eq(md.value, await J.text(), 'it shows the map as Markdown');
  t.check('over the whole screen, down to the thumb bar', md.top <= 1 && md.bottom >= md.thumb - 24, md);
  await J.fingerSized('markdown');
  await t.shot('markdown', page);
  await J.tapEl('#source button[aria-label="Close the Markdown"]');
  await J.until(function () { return document.getElementById('source').hidden; });
  t.check('its X closes it', true);

  /* ------------------------------------------------------------ long press */
  t.step('a long press opens the node\'s menu');
  await J.settled();
  var b = await J.nodeBox('Tomatoes');
  await J.touch('touchStart', [[b.x + Math.min(20, b.w / 2), b.y + b.h / 2]]);
  await t.sleep(700);
  await J.touch('touchEnd', []);
  await page.waitForSelector('[role="menu"]:visible', { state: 'visible' });
  t.check('a menu of what the node can do', /Delete|Colour|Rename/.test(await page.evaluate(function () { return document.querySelector('[role="menu"]').textContent; })));
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('[role="menu"]'); });

  /* ------------------------------------------------------------ drawer */
  t.step('the drawer: a second map, and back');
  await J.tapEl('#sidebar-toggle');
  await J.until(function () { var r = document.getElementById('sidebar').getBoundingClientRect(); return document.documentElement.getAttribute('data-sidebar') === 'open' && r.left >= -0.5; });
  t.check('the drawer slides in', true);
  var landed = await J.until(function () { var a = document.activeElement; return a && a.closest && a.closest('[role="tree"]') && a.classList.contains('is-current'); }, null, 3000).then(function () { return true; }, function () { return false; });
  t.eq(landed, true, 'focus lands on the open map\'s row');
  if (!landed) t.log('focus on: ' + await page.evaluate(function () { var a = document.activeElement; return a ? a.outerHTML.slice(0, 160) : null; }));
  await J.fingerSized('drawer');
  await t.shot('drawer', page);
  await J.tapEl('#sidebar .sb-item--new');
  await J.dialog();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Sowing');
  await page.keyboard.press('Enter');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Sowing'; });
  await J.until(function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
  t.check('the new map opens and the drawer gets out of the way', true);
  await J.tapEl('#sidebar-toggle');
  await J.until(function () { return document.documentElement.getAttribute('data-sidebar') === 'open'; });
  await J.tapEl('#sidebar .sb-item--map:has-text("Garden")');
  await J.until(function () { var c = window.MindRoot.session.current(); return c && c.map.name === 'Garden'; });
  await J.until(function () { return document.documentElement.getAttribute('data-sidebar') === 'closed'; });
  t.check('choosing the first map opens it and closes the drawer', /Genoese basil/.test(await J.text()));

  /* ------------------------------------------------------------ delete, undo toast */
  t.step('a branch deleted, and its Undo toast');
  await J.tapNode('Tomatoes');
  await J.tapEl('#thumbbar [data-command="node.addChild"]');
  await J.renaming();
  await page.keyboard.type('San Marzano');
  await page.keyboard.press('Enter');
  await J.notRenaming();
  await J.tapNode('Tomatoes');
  /* A branch with something under it says so, with an Undo. */
  await J.more('Delete the branch');
  await J.until(function () { return !/Tomatoes|San Marzano/.test(window.MindRoot.session.current().text); });
  var undoBtn = '.toast:has-text("Branch deleted: Tomatoes") button:has-text("Undo")';
  await page.waitForSelector(undoBtn, { state: 'visible' });
  var toastBox = await page.evaluate(function () {
    var all = document.querySelectorAll('.toast');
    var r = all[all.length - 1].getBoundingClientRect();
    var tb = document.getElementById('thumbbar').getBoundingClientRect();
    return { bottom: r.bottom, thumbTop: tb.top };
  });
  t.check('the toast sits above the thumb bar', toastBox.bottom <= toastBox.thumbTop + 0.5, toastBox);
  await J.tapEl(undoBtn);
  await J.until(function () { return /## Tomatoes\n\n### San Marzano/.test(window.MindRoot.session.current().text); });
  t.check('its Undo puts the branch back, child and all', true);

  /* ------------------------------------------------------------ palette, settings, dark */
  t.step('the palette, settings and the dark theme');
  await J.more('Commands and places');
  await page.waitForSelector('dialog[open].palette input', { state: 'visible' });
  await page.keyboard.type('settings');
  await J.until(function () { var a = document.querySelector('dialog[open].palette [aria-selected="true"]'); return a && /Settings/.test(a.textContent); });
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open].ws-sheet--settings', { state: 'visible' });
  t.check('the palette opened settings, as a bottom sheet', await page.evaluate(function () {
    var r = document.querySelector('dialog[open].ws-sheet--settings').getBoundingClientRect();
    return r.bottom >= window.innerHeight - 1 && r.left <= 1;
  }));
  await J.tapEl('dialog[open].ws-sheet--settings .seg__opt:has-text("Dark")');
  await J.until(function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  await page.keyboard.press('Escape');
  await J.until(function () { return !document.querySelector('dialog[open]'); });
  await J.settled();
  await J.rest();
  t.eq(await page.evaluate(function () { var a = document.activeElement; return !!(a && a.__mrTip) && !!document.querySelector('.tooltip:not([hidden])'); }), false, 'no keyboard tooltip shown on a phone');
  await t.shot('dark', page);
  await J.fingerSized('dark');

  /* ------------------------------------------------------------ reload */
  t.step('reload');
  var kept = await J.text();
  await page.evaluate(function () { return window.MindRoot.storage.flush(); });
  await page.reload();
  await page.waitForFunction(function () { return window.MindRoot && window.MindRoot.booted === true; }, null, { timeout: 20000 });
  await J.settled();
  t.eq(await J.text(), kept, 'the map comes back as it was');
  t.eq(await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); }), 'dark', 'and so does the theme, with no light flash (set before the first paint)');
  t.eq(await page.evaluate(function () { return document.scrollingElement.scrollWidth <= window.innerWidth; }), true, 'never a sideways scroll');
};

/* ---------------------------------------------------------------- helpers */

function helpers(page, cdp, t) {
  function until(fn, arg, timeout) {
    return page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: timeout || 8000, polling: 30 });
  }
  function touch(type, list) {
    return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: list.map(function (p) { return { x: p[0], y: p[1], id: p[2] || 1 }; }) });
  }
  async function tap(x, y) {
    await touch('touchStart', [[x, y]]);
    await touch('touchEnd', []);
  }
  var J = {
    until: until,
    touch: touch,
    tap: tap,
    text: function () { return page.evaluate(function () { var c = window.MindRoot.session.current(); return c ? c.text : null; }); },
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
    /* Tapped where it rests: a sheet slides in, and a tap during the slide
     * lands where the button was a frame ago. */
    tapEl: async function (selector) {
      var loc = page.locator(selector).first();
      await loc.waitFor({ state: 'visible', timeout: 8000 });
      await J.rest();
      /* And still: a sheet can also move without an animation (it grows
       * to full height as its list is scrolled), so the box is read until
       * two frames agree. */
      var r = await loc.boundingBox();
      for (var i = 0; i < 30; i++) {
        await page.evaluate(function () { return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); }); });
        var again = await loc.boundingBox();
        if (r && again && Math.abs(again.x - r.x) < 0.5 && Math.abs(again.y - r.y) < 0.5) break;
        r = again;
      }
      if (!r) throw new Error('nothing at ' + selector);
      await tap(r.x + r.width / 2, r.y + r.height / 2);
    },
    nodeBox: function (label) {
      return page.evaluate(function (label) {
        var el = Array.prototype.filter.call(document.querySelectorAll('#stage .mv-node'), function (n) {
          var x = n.querySelector('.mv-title .mv-text');
          return x && x.textContent.trim() === label;
        })[0];
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }, label);
    },
    tapNode: async function (label) {
      await J.settled();
      var b = await J.nodeBox(label);
      if (!b) throw new Error('no node ' + label);
      var inside = await page.evaluate(function (pt) {
        var hit = document.elementFromPoint(pt.x, pt.y);
        return !!(hit && hit.closest && hit.closest('#stage .mv-node'));
      }, { x: b.x + Math.min(20, b.w / 2), y: b.y + b.h / 2 });
      if (!inside) {
        /* Panned out of reach: a double tap on empty map fits it, as a
         * person would do. Fit is also in "more". */
        await J.more('Fit the map');
        await J.settled();
        b = await J.nodeBox(label);
      }
      await tap(b.x + Math.min(20, b.w / 2), b.y + b.h / 2);
      await until(function (label) {
        var ns = window.MindRoot;
        var e = ns.session.entry();
        return e && ns.doc.labelOf(e) === label;
      }, label);
    },
    renaming: function () { return until(function () { var a = document.activeElement; return a && a.closest && a.closest('.mv-node--editing'); }); },
    notRenaming: function () { return until(function () { return !document.querySelector('.mv-node--editing'); }); },
    dialog: function () {
      return until(function () { var d = document.querySelector('dialog[open]'); return d && d.contains(document.activeElement) && document.activeElement.tagName === 'INPUT'; });
    },
    barIds: function () {
      return page.evaluate(function () {
        function ids(sel) { return Array.prototype.map.call(document.querySelectorAll(sel + ' [data-command]'), function (b) { return b.getAttribute('data-command'); }); }
        return { top: ids('#topbar-actions'), thumb: ids('#thumbbar'), zoom: ids('#zoombar') };
      });
    },
    /* A row of the thumb bar's "more" sheet, by its words. */
    more: async function (label) {
      await J.tapEl('#thumbbar .btn--more');
      await page.waitForSelector('[role="menu"]:visible', { state: 'visible' });
      var row = '[role="menu"]:visible [role^="menuitem"]:has-text("' + label + '")';
      await page.locator(row).first().scrollIntoViewIfNeeded();
      await J.tapEl(row);
      /* Gone from the screen: a component may keep a hidden menu of its
       * own in the page (the drawing editor's). */
      await until(function () {
        return !Array.prototype.some.call(document.querySelectorAll('[role="menu"]'), function (m) { return m.getClientRects().length > 0; });
      });
    },
    /* Every control drawn on screen is inside it and finger-sized. */
    fingerSized: async function (where) {
      var rep = await page.evaluate(function () {
        var sel = 'button, a[href], input, select, textarea, [role="button"], [role="treeitem"], [role="menuitem"]';
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var out = { outside: [], small: [], count: 0 };
        Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
          /* Map nodes may be panned off screen; a switch is reached through
           * its row (its ::after spans the row's height, the label taps it). */
          if (el.closest('[inert], [hidden], .icon-sprite, #stage .mv') || el.classList.contains('switch')) return;
          var cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || el.getClientRects().length === 0) return;
          var r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          /* A box or a radio inside its label is tapped through the label:
           * the label is the target that must fit a finger. */
          var label = (el.type === 'checkbox' || el.type === 'radio') && el.closest('label');
          if (label) r = label.getBoundingClientRect();
          /* Off screen inside a scroller is reachable by scrolling. */
          var scroller = el.parentElement && el.parentElement.closest('.sheet__body, [class*="scroll"], .colorpicker, .format-bar, .src-chips, .src-body, ul, ol');
          out.count++;
          var name = el.getAttribute('aria-label') || el.id || (el.textContent || '').trim().slice(0, 20) || el.className;
          if (!scroller && (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5)) out.outside.push(name + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(','));
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' && el.type !== 'checkbox') return;
          if (r.width < 43.5 || r.height < 43.5) out.small.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        });
        out.sideways = document.scrollingElement.scrollWidth > vw;
        return out;
      });
      t.same(rep.outside, [], where + ': every control on screen');
      t.same(rep.small, [], where + ': every control finger-sized');
      t.eq(rep.sideways, false, where + ': no sideways scroll');
    }
  };
  return J;
}

/* journey-phone-more drives the rest of the story with the same fingers. */
module.exports.helpers = helpers;
