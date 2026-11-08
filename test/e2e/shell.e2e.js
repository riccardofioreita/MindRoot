/* shell: the behaviours of the chrome in the real page. Shortcuts and the
 * text-field rule, view-only mode, bar buttons generated from commands,
 * menus that toggle on their anchor (the old reopen bug), dialogs keeping
 * focus, the Escape stack, toasts, tooltips, the drop overlay, the zoom
 * capsule, title and save state; on a phone, menus as bottom sheets, the
 * back gesture closing exactly one layer (also when one layer closes and
 * the next opens in the same moment), sheets that rest at their detents
 * with their actions on screen, real-finger drags and flicks, toasts above
 * the thumb bar, sheets and the keyboard, dialogs above the keyboard.
 *
 * The suite runs against whatever modules exist. It never deletes or fakes
 * another module's namespace for longer than one measured moment, always
 * restores what it swapped, and talks to the shell directly (shell.refresh)
 * instead of emitting store events other modules would act on. */
'use strict';

var H = require('../fixtures/shell/helpers.js');

/* A sheet whose entrance, glide or spring back has finished. */
function sheetSettled() {
  var d = document.querySelector('dialog.sheet[open]');
  if (!d) return false;
  var running = d.getAnimations().some(function (a) { return a.playState === 'running'; });
  return !running && !d.hasAttribute('data-dragging') && !d.hasAttribute('data-settling');
}

function noLayerEntry() {
  return !(history.state && history.state.mindroot2Layer);
}

function state(page, attr) {
  return page.evaluate(function (a) { return document.documentElement.getAttribute(a); }, attr);
}

/* Page helpers: a stand-in for store.here()/project()/map() that leaves the
 * rest of a real store reachable (other modules may read it meanwhile), and
 * the way back to exactly what was there. */
function installHelpers() {
  var ns = window.MindRoot;
  window.__fakeTitle = function (projectName, mapName) {
    if (!window.__savedStore) window.__savedStore = { had: Object.prototype.hasOwnProperty.call(ns, 'store'), value: ns.store };
    var real = window.__savedStore.value;
    var over = {
      here: function () { return { projectId: 'p-shell-test', mapId: 'm-shell-test' }; },
      project: function () { return { id: 'p-shell-test', name: projectName }; },
      map: function () { return { id: 'm-shell-test', name: mapName }; }
    };
    ns.store = real ? new Proxy(real, {
      get: function (target, key) {
        if (Object.prototype.hasOwnProperty.call(over, key)) return over[key];
        var v = target[key];
        return typeof v === 'function' ? v.bind(target) : v;
      }
    }) : over;
    ns.shell.refresh();
  };
  window.__restoreStore = function () {
    var s = window.__savedStore;
    if (!s) return;
    window.__savedStore = null;
    if (s.had) ns.store = s.value; else delete ns.store;
    ns.shell.refresh();
  };
}

/* A real finger (CDP touch input goes through the browser's gesture
 * handling, touch-action and pointercancel included; synthetic
 * PointerEvents would not). */
async function finger(cdp, from, to, steps, ms) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (var i = 1; i <= steps; i++) {
    var x = from.x + (to.x - from.x) * i / steps;
    var y = from.y + (to.y - from.y) * i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x, y: y, id: 1 }] });
    await new Promise(function (r) { setTimeout(r, ms); });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tapAt(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x, y: y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

module.exports = async function (t) {
  await H.stubMissing(t.context, t);
  var page = t.page;
  await t.open();
  await page.evaluate(installHelpers);

  t.step('Mod+B, and Ctrl+B stays bold inside a text field');
  t.eq(await state(page, 'data-sidebar'), 'open', 'open at start');
  await page.keyboard.press('Control+B');
  t.eq(await state(page, 'data-sidebar'), 'closed', 'Mod+B closes');
  await page.keyboard.press('Control+B');
  t.eq(await state(page, 'data-sidebar'), 'open', 'Mod+B opens');
  await page.evaluate(function () {
    var input = document.createElement('input');
    input.id = 'probe';
    input.className = 'input';
    document.getElementById('floaters').appendChild(input);
  });
  await page.focus('#probe');
  await page.keyboard.press('Control+B');
  t.eq(await state(page, 'data-sidebar'), 'open', 'not from a text field');
  await page.evaluate(function () { document.getElementById('probe').remove(); });

  t.step('view-only mode');
  var modes = await page.evaluate(function () {
    window.__modes = [];
    window.MindRoot.bus.on('prefs', function (d) { if (d.key === 'mode') window.__modes.push(d.value); });
    return true;
  });
  t.check('listening', modes);
  await page.keyboard.press('Control+E');
  t.eq(await state(page, 'data-mode'), 'view', 'Mod+E sets data-mode=view');
  /* The bars fade out (display is held to the end of the transition). */
  await H.until(page, function () { return getComputedStyle(document.getElementById('topbar')).display === 'none'; });
  var hidden = await page.evaluate(function () {
    return {
      topbar: getComputedStyle(document.getElementById('topbar')).display,
      sidebar: getComputedStyle(document.getElementById('sidebar')).display,
      exit: !document.querySelector('.view-exit').hidden,
      mainLeft: document.getElementById('main').getBoundingClientRect().left
    };
  });
  t.same(hidden, { topbar: 'none', sidebar: 'none', exit: true, mainLeft: 0 }, 'chrome hidden, the map takes the window, a way back shown');
  var exitBox = await page.evaluate(function () {
    var r = document.querySelector('.view-exit').getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, w: window.innerWidth, size: r.width };
  });
  t.check('the way back sits in the top-right corner, whole', exitBox.right <= exitBox.w && exitBox.right >= exitBox.w - 40 && exitBox.top >= 0 && exitBox.top < 30 && exitBox.size >= 32, exitBox);
  await page.keyboard.press('Escape');
  t.eq(await state(page, 'data-mode'), null, 'Escape leaves it');
  await page.keyboard.press('Control+E');
  await page.click('.view-exit');
  t.eq(await state(page, 'data-mode'), null, 'the exit button leaves it');
  t.same(await page.evaluate(function () { return window.__modes; }), ['view', 'edit', 'view', 'edit'], "bus 'prefs' {key:'mode'} each time");

  t.step('bar buttons come from commands');
  var plan = await page.evaluate(function () {
    var C = window.MindRoot.commands;
    var B = window.MindRoot.shell.bars;
    function filled(slots) { return slots.filter(function (s) { return s.ids.some(function (id) { return C.has(id); }); }).length; }
    return { slots: filled(B.top), buttons: document.querySelectorAll('#topbar-actions .btn:not(#sidebar-toggle)').length, more: document.querySelectorAll('#topbar-actions .btn--more').length, toggle: !!document.querySelector('#topbar-actions > #sidebar-toggle') };
  });
  t.eq(plan.buttons, plan.slots + 1, 'one button per filled slot, plus "more"');
  t.eq(plan.toggle, true, 'the projects button leads the dock');
  t.eq(plan.more, 1, 'and "more" is last but always there');
  await page.evaluate(function () {
    var B = window.MindRoot.shell.bars;
    window.__probe = { can: false, ran: 0 };
    B.top.push({ slot: 'probe', ids: ['test.probe'] });
    B.thumb.push({ slot: 'probe', ids: ['test.probe'] });
    window.__unProbe = window.MindRoot.commands.register({
      id: 'test.probe', label: 'ui.ok', group: 'app', icon: 'check', keys: ['Mod+Alt+P'],
      when: function () { return window.__probe.can; },
      run: function () { window.__probe.ran++; }
    });
  });
  await H.until(page, function () {
    var b = document.querySelector('#topbar-actions [data-command="test.probe"]');
    return b && b.getAttribute('aria-disabled') === 'true';
  });
  t.check('a registration lights its slot up, disabled while when() is false', true);
  await page.click('#topbar-actions [data-command="test.probe"]', { force: true });
  t.eq(await page.evaluate(function () { return window.__probe.ran; }), 0, 'a disabled button does nothing');
  await page.evaluate(function () { window.__probe.can = true; window.MindRoot.shell.refresh(); });
  await H.until(page, function () { return !document.querySelector('#topbar-actions [data-command="test.probe"]').hasAttribute('aria-disabled'); });
  await page.click('#topbar-actions [data-command="test.probe"]');
  t.eq(await page.evaluate(function () { return window.__probe.ran; }), 1, 'enabled and run');
  t.eq(await page.$$eval('#thumbbar [data-command="test.probe"]', function (b) { return b.length; }), 1, 'also in the thumb bar slot');
  await page.evaluate(function () {
    window.__unProbe();
    var B = window.MindRoot.shell.bars;
    B.top.pop();
    B.thumb.pop();
  });
  await H.until(page, function () { return !document.querySelector('[data-command="test.probe"]'); });
  t.check('unregistered: the button goes', true);

  t.step('a menu toggles on its anchor and closes in every expected way');
  var more = '#topbar-actions .btn--more';
  await page.click(more);
  await H.until(page, function () { return document.querySelector('.menu:not([hidden])'); });
  t.eq(await page.getAttribute(more, 'aria-expanded'), 'true', 'open');
  t.check('focus in the menu', await page.evaluate(function () { return !!document.activeElement.closest('.menu'); }));
  t.check('lists shell commands', /Theme: System/.test(await page.textContent('.menu:not([hidden])')));
  await page.click(more);
  /* Long enough for a wrongly reopened menu to have appeared. */
  await page.waitForTimeout(250);
  t.eq(await page.$('.menu:not([hidden])'), null, 'a second click on the anchor closes it (and does not reopen it)');
  t.eq(await page.getAttribute(more, 'aria-expanded'), 'false', 'collapsed');
  await page.click(more);
  await H.until(page, function () { return document.querySelector('.menu:not([hidden])'); });
  await page.keyboard.press('Escape');
  t.eq(await page.$('.menu:not([hidden])'), null, 'Escape closes it');
  t.eq(await page.evaluate(function () { return document.activeElement.classList.contains('btn--more'); }), true, 'focus back on the anchor');
  await page.click(more);
  await H.until(page, function () { return document.querySelector('.menu:not([hidden])'); });
  await page.mouse.click(700, 500);
  t.eq(await page.$('.menu:not([hidden])'), null, 'a press outside closes it');

  t.step('theme from the menu');
  await page.click(more);
  await H.until(page, function () { return document.querySelector('.menu:not([hidden])'); });
  await page.click('.menu:not([hidden]) .menu__item:has-text("Theme: System")');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('theme'); }), 'light', 'system -> light');
  await H.until(page, function () { return document.documentElement.getAttribute('data-theme') === 'light'; });
  await page.evaluate(function () { window.MindRoot.commands.run('view.theme'); });
  await H.until(page, function () { return document.documentElement.getAttribute('data-theme') === 'dark'; });
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('theme'); }), 'dark', 'light -> dark');
  await page.evaluate(function () { window.MindRoot.commands.run('view.theme'); });
  await H.until(page, function () { return !document.documentElement.hasAttribute('data-theme'); });
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('theme'); }), 'system', 'dark -> system');

  t.step('a dialog keeps focus and gives it back');
  await page.focus(more);
  var answer = page.evaluate(function () { return window.MindRoot.ui.confirm({ title: 'Delete the project?', text: 'Its maps go with it.', ok: 'Delete', danger: true }); });
  await H.until(page, function () { return document.querySelector('dialog.dialog[open]'); });
  var inside = true;
  for (var i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    inside = inside && await page.evaluate(function () { return !!document.activeElement.closest('dialog.dialog'); });
  }
  t.check('Tab stays inside the dialog', inside);
  await page.keyboard.press('Control+B');
  t.eq(await state(page, 'data-sidebar'), 'open', 'shortcuts stand down while it is open');
  await page.keyboard.press('Escape');
  t.eq(await answer, false, 'Escape answers no');
  t.eq(await page.evaluate(function () { return document.activeElement.classList.contains('btn--more'); }), true, 'focus back on the trigger');

  t.step('Escape closes one layer at a time');
  await page.evaluate(function () {
    var ui = window.MindRoot.ui;
    window.__sheet = ui.sheet({ title: 'Layers', body: window.MindRoot.util.h('button', { type: 'button', id: 'inner' }, 'Inner') });
    ui.menu(document.getElementById('inner'), [{ label: 'One', onSelect: function () {} }]);
  });
  t.check('menu and sheet open', await page.evaluate(function () { return !!document.querySelector('.menu:not([hidden])') && window.__sheet.isOpen(); }));
  await page.keyboard.press('Escape');
  t.check('first Escape: the menu', await page.evaluate(function () { return !document.querySelector('.menu:not([hidden])') && window.__sheet.isOpen(); }));
  await page.keyboard.press('Escape');
  t.check('second Escape: the sheet', await page.evaluate(function () { return !window.__sheet.isOpen(); }));
  t.eq(await state(page, 'data-sidebar'), 'open', 'the sidebar was not touched');
  var leak = await page.evaluate(function () {
    var ui = window.MindRoot.ui;
    var base = ui.escape.size();
    var s = ui.sheet({ title: 'Closed under its menu', body: window.MindRoot.util.h('button', { type: 'button', id: 'inner2' }, 'Inner') });
    ui.menu(document.getElementById('inner2'), [{ label: 'One', onSelect: function () {} }]);
    var during = ui.escape.size() - base;
    s.close('api');
    return { during: during, after: ui.escape.size() - base, menu: !!document.querySelector('.menu:not([hidden])') };
  });
  t.same(leak, { during: 2, after: 0, menu: false }, 'a sheet closed by its owner takes its menu with it, Escape entry included');

  t.step('tooltip with the shortcut, after a pause');
  /* Past the one-second warm window of the previous tooltip, so this one
   * has to wait its full delay: the wait is the feature under test. */
  await page.mouse.move(10, 790);
  await page.waitForTimeout(1100);
  await page.hover('#sidebar-toggle');
  await H.until(page, function () { var tip = document.querySelector('.tooltip'); return tip && !tip.hidden; }, null, 3000);
  var tip = await page.textContent('.tooltip');
  t.check('label and Ctrl+B', /projects/.test(tip) && /Ctrl\+B/.test(tip), tip);
  await page.mouse.move(700, 500);
  await H.until(page, function () { return document.querySelector('.tooltip').hidden; });

  t.step('drop overlay');
  /* The shell's own part only: what it emits is recorded and not passed on,
   * so an importer listening on the bus does not import the probe file. */
  var dropped = await page.evaluate(function () {
    var bus = window.MindRoot.bus;
    var realEmit = bus.emit;
    var got = [];
    bus.emit = function (type, detail) {
      if (type === 'drop') { got.push(detail.files.map(function (f) { return f.name; }).join(',')); return 1; }
      return realEmit.apply(bus, arguments);
    };
    try {
      var dt = new DataTransfer();
      dt.items.add(new File(['# Map\n'], 'map.md', { type: 'text/markdown' }));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      var shown = !document.getElementById('drop').hidden;
      var over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      window.dispatchEvent(over);
      var drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 300 });
      window.dispatchEvent(drop);
      return { shown: shown, overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented, hiddenAfter: document.getElementById('drop').hidden, got: got };
    } finally {
      bus.emit = realEmit;
    }
  });
  t.same(dropped, { shown: true, overPrevented: true, dropPrevented: true, hiddenAfter: true, got: ['map.md'] }, 'shown while dragging, handed over on drop, never a navigation');

  t.step('zoom capsule and zoom keys follow the map view');
  var zoomState = await page.evaluate(function () {
    var s = window.MindRoot.session;
    var cur = null;
    try { cur = s && s.view && typeof s.current === 'function' ? s.current() : null; } catch (err) { cur = null; }
    return { hasView: !!cur, hidden: document.getElementById('zoombar').hidden, session: !!s };
  });
  t.eq(zoomState.hidden, !zoomState.hasView, 'the capsule shows exactly when a map view is open');
  /* With a real open map, its view is watched (and still zooms); with no
   * session module at all, a stand-in view is put in and taken out again.
   * A session with no map open is left alone. */
  var zoomMode = await page.evaluate(function () {
    var ns = window.MindRoot;
    window.__zoom = [];
    var s = ns.session;
    var cur = null;
    try { cur = s && s.view && typeof s.current === 'function' ? s.current() : null; } catch (err) { cur = null; }
    if (cur) {
      var v = s.view;
      var realZoom = v.zoomBy;
      var realFit = v.fit;
      v.zoomBy = function (f, at) { window.__zoom.push('zoom ' + f + (at && at.x ? ' at' : '')); return realZoom.apply(v, arguments); };
      v.fit = function (o) { window.__zoom.push('fit ' + !!(o && o.animate)); return realFit.apply(v, arguments); };
      window.__unzoom = function () { v.zoomBy = realZoom; v.fit = realFit; ns.shell.refresh(); };
      return 'real';
    }
    if (s) return 'skip';
    ns.session = {
      view: {
        zoomBy: function (f, at) { window.__zoom.push('zoom ' + f + (at && at.x ? ' at' : '')); },
        fit: function (o) { window.__zoom.push('fit ' + !!(o && o.animate)); }
      },
      current: function () { return { projectId: 'p', mapId: 'm' }; }
    };
    window.__unzoom = function () { delete ns.session; ns.shell.refresh(); };
    ns.shell.refresh();
    return 'stand-in';
  });
  if (zoomMode === 'skip') {
    t.log('a session with no open map: the zoom buttons are not exercised');
    t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('view.zoomIn'); }), false, 'zoom commands off with no map');
  } else {
    await H.until(page, function () { return !document.getElementById('zoombar').hidden; });
    t.eq(await page.evaluate(function () { return Array.prototype.filter.call(document.querySelectorAll('#zoombar button'), function (b) { return b.tabIndex === 0; }).length; }), 1,
      'the zoom bar, shown after it was hidden, is one Tab stop');
    await page.click('#zoombar [data-command="view.zoomIn"]');
    await page.click('#zoombar [data-command="view.fit"]');
    await page.focus('#zoombar [data-command="view.fit"]');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');
    t.same(await page.evaluate(function () { return window.__zoom; }), ['zoom 1.25 at', 'fit true', 'zoom 0.8 at', 'fit false'], 'buttons glide, keys jump (' + zoomMode + ' view)');
    await page.evaluate(function () { window.__unzoom(); });
  }

  t.step('title and save state');
  await page.evaluate(function () { window.__fakeTitle('Biology', 'The cell'); });
  /* The tab title names the project too. */
  await H.until(page, function () { return document.title === 'The cell - Biology - MindRoot'; });
  t.eq(await page.textContent('#title'), 'Biology/The cell', 'project / map');
  t.eq(await page.getAttribute('#title', 'title'), 'Biology / The cell', 'full title for truncation');
  await page.evaluate(function () { window.__restoreStore(); });
  await page.evaluate(function () { window.MindRoot.bus.emit('save', { state: 'saved', at: new Date(2026, 0, 1, 9, 5).getTime() }); });
  t.eq(await page.getAttribute('#save-state', 'data-state'), 'saved', 'saved dot');
  t.check('saved text', /^Saved at 0?9:05/.test(await page.textContent('#save-state .save__text')), await page.textContent('#save-state .save__text'));
  t.eq(await page.textContent('#save-status'), '', 'routine saves are not announced');
  await page.evaluate(function () { window.MindRoot.bus.emit('save', { state: 'failed' }); });
  t.eq(await page.textContent('#save-status'), 'Saving failed', 'a failure is announced');
  await page.evaluate(function () { window.MindRoot.bus.emit('save', { state: 'saved', at: Date.now() }); });
  t.check('and so is the recovery', /Saved at/.test(await page.textContent('#save-status')));

  t.step('a long title truncates on a desktop too');
  await page.evaluate(function () { window.__fakeTitle(new Array(30).join('Project '), new Array(40).join('Map ')); });
  await H.until(page, function () { return /Map/.test(document.title); });
  var dt = await page.evaluate(function () {
    var lead = document.getElementById('topbar-lead').getBoundingClientRect();
    var actions = document.getElementById('topbar-actions').getBoundingClientRect();
    return { leadLeft: lead.left, leadRight: lead.right, leadBottom: lead.bottom, actionsTop: actions.top, scroll: document.scrollingElement.scrollWidth, w: window.innerWidth };
  });
  await page.evaluate(function () { window.__restoreStore(); });
  /* Layout v3: the title floats alone at the top left, the dock at the foot. */
  t.check('the title capsule stays bounded, clear of the dock', dt.leadRight - dt.leadLeft <= 577 && dt.leadBottom < dt.actionsTop && dt.scroll <= dt.w, dt);

  t.step('liquid glass: optional, on the top capsules only, cleanly undone');
  await H.until(page, function () { return document.documentElement.getAttribute('data-glass') === 'liquid'; }, null, 5000);
  var lg = await page.evaluate(function () {
    return {
      roots: document.querySelectorAll('.lg-root').length,
      wrapped: Array.prototype.map.call(document.querySelectorAll('.lg-root [data-liquid]'), function (e) { return e.id || e.className; }),
      textColor: getComputedStyle(document.querySelector('.title__project')).color,
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
    };
  });
  t.check('both top capsules, at most three surfaces', lg.roots <= 3 && lg.wrapped.indexOf('topbar-lead') >= 0 && lg.wrapped.indexOf('topbar-actions') >= 0, lg);
  t.eq(lg.textColor, 'rgb(21, 23, 28)', 'text keeps the ink colour (no forced white)');
  await page.focus('#sidebar-toggle');
  await page.evaluate(function () { window.MindRoot.prefs.set('liquidGlass', false); });
  await H.until(page, function () { return !document.querySelector('.lg-root'); }, null, 3000);
  var undone = await page.evaluate(function () {
    return {
      attr: document.documentElement.getAttribute('data-glass'),
      inSlots: document.getElementById('topbar-lead').parentNode.classList.contains('topbar__slot') && document.getElementById('topbar-actions').parentNode.classList.contains('topbar__slot'),
      classes: document.querySelectorAll('.is-liquid').length,
      focus: document.activeElement && document.activeElement.id
    };
  });
  t.same(undone, { attr: null, inSlots: true, classes: 0, focus: 'sidebar-toggle' }, 'switched off: the capsules are back where they were, focus kept');
  await page.evaluate(function () { window.MindRoot.prefs.set('liquidGlass', true); });
  await H.until(page, function () { return document.querySelectorAll('.lg-root').length >= 2; }, null, 3000);
  await page.evaluate(function () { window.MindRoot.prefs.set('reduceTransparency', true); });
  await H.until(page, function () { return !document.querySelector('.lg-root') && document.documentElement.getAttribute('data-transparency') === 'reduce'; }, null, 3000);
  t.eq(await page.evaluate(function () { return getComputedStyle(document.getElementById('topbar-lead')).backdropFilter; }), 'none', 'reduce transparency: solid capsules, no glass at all');
  await page.evaluate(function () { window.MindRoot.prefs.set('reduceTransparency', false); });
  await H.until(page, function () { return document.querySelectorAll('.lg-root').length >= 2; }, null, 3000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await H.until(page, function () { return !document.querySelector('.lg-root'); }, null, 3000);
  t.check('reduced motion turns it off', true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  t.step('a language switch relabels the chrome');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('it'); });
  await H.until(page, function () { return document.querySelector('#topbar-actions .btn--more').getAttribute('aria-label') === 'Altro'; });
  var it = await page.evaluate(function () {
    return {
      toggle: document.getElementById('sidebar-toggle').getAttribute('aria-label'),
      exit: document.querySelector('.view-exit').getAttribute('aria-label'),
      stage: document.getElementById('stage').getAttribute('aria-label'),
      lang: document.documentElement.lang
    };
  });
  t.same(it, { toggle: 'Mostra o nascondi i progetti', exit: 'Torna ai comandi', stage: 'Mappa', lang: 'it' }, 'Italian everywhere');
  await page.evaluate(function () { window.MindRoot.i18n.setLang('en'); });
  await H.until(page, function () { return document.querySelector('#topbar-actions .btn--more').getAttribute('aria-label') === 'More'; });

  t.step('insets for the map');
  var ins = await page.evaluate(function () { return window.MindRoot.shell.insets(); });
  t.check('top capsules take room over the stage', ins.top >= 40 && ins.top <= 80, ins);

  t.step('phone: menus are bottom sheets, back closes them');
  var phoneCtx = await H.context(t, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  var phone = await phoneCtx.newPage();
  var lgRequested = false;
  phone.on('request', function (r) { if (/liquid-glass/.test(r.url())) lgRequested = true; });
  await t.open('', { page: phone });
  await phone.evaluate(installHelpers);
  var cdp = await phoneCtx.newCDPSession(phone);
  var depth = await phone.evaluate(function () { return history.length; });
  await phone.tap('#thumbbar .btn--more');
  await H.until(phone, function () { return document.querySelector('dialog.sheet[data-place="bottom"][open]'); });
  await H.until(phone, sheetSettled, null, 3000);
  var sheet = await phone.evaluate(function () {
    var d = document.querySelector('dialog.sheet[open]');
    var r = d.getBoundingClientRect();
    return { rows: d.querySelectorAll('[role^="menuitem"]').length, bottom: Math.round(r.bottom), h: window.innerHeight, w: Math.round(r.width), grip: !!d.querySelector('.sheet__grip'), history: history.length, ours: !!(history.state && history.state.mindroot2Layer) };
  });
  t.check('a bottom sheet of menu rows with a grab pill', sheet.rows >= 3 && sheet.grip, sheet);
  t.eq(sheet.bottom, sheet.h, 'sits on the bottom edge');
  t.eq(sheet.w, 390, 'full width');
  t.same([sheet.history, sheet.ours], [depth + 1, true], 'a history entry for the back gesture');
  await phone.goBack();
  await H.until(phone, function () { return !document.querySelector('dialog.sheet[open]'); });
  t.eq(await phone.evaluate(function () { return window.MindRoot.booted && /index\.html/.test(location.href); }), true, 'back closed the sheet, not the app');
  await phone.tap('#thumbbar .btn--more');
  await H.until(phone, function () { return document.querySelector('dialog.sheet[open] [role^="menuitem"]'); });
  await phone.tap('dialog.sheet[open] [role^="menuitem"]:has-text("Theme: System")');
  await H.until(phone, function () { return !document.querySelector('dialog.sheet[open]'); });
  t.eq(await phone.evaluate(function () { return window.MindRoot.prefs.get('theme'); }), 'light', 'a row runs its command and closes the sheet');
  await H.until(phone, noLayerEntry);
  t.eq(await phone.evaluate(function () { return history.length; }), depth + 1, 'the entry was taken back (no history growth)');

  t.step('phone: one layer closing as the next opens keeps the back gesture in the app');
  await phone.evaluate(function () {
    var ns = window.MindRoot;
    window.__asked = [];
    ns.i18n.add({
      en: { 'test.ask': 'Probe the confirm', 'test.panel': 'Probe a panel' },
      it: { 'test.ask': 'Prova la conferma', 'test.panel': 'Prova un pannello' }
    });
    window.__unAsk = ns.commands.register({
      id: 'test.ask', label: 'test.ask', group: 'app', icon: 'warning',
      run: function () { return ns.ui.confirm({ title: 'Delete it?', text: 'For good.', ok: 'Delete', danger: true }).then(function (v) { window.__asked.push(v); }); }
    });
    window.__unPanel = ns.commands.register({
      id: 'test.panel', label: 'test.panel', group: 'app', icon: 'settings',
      run: function () { window.__panel = ns.ui.sheet({ title: 'A panel', body: 'Opened from a menu row.' }); }
    });
  });
  await phone.tap('#thumbbar .btn--more');
  await H.until(phone, function () { return document.querySelector('dialog.sheet[open] [role^="menuitem"]'); });
  await phone.tap('dialog.sheet[open] [role^="menuitem"]:has-text("Probe the confirm")');
  await H.until(phone, function () { return document.querySelector('dialog.dialog[open]') && !document.querySelector('dialog.sheet[open]'); });
  /* Past the moment the menu's entry would have been taken back. */
  await phone.waitForTimeout(150);
  t.eq(await phone.evaluate(function () { return !!(history.state && history.state.mindroot2Layer); }), true, 'the dialog holds the entry the menu sheet let go');
  await phone.tap('dialog.dialog[open] .btn:has-text("Cancel")');
  await H.until(phone, function () { return window.__asked.length === 1; });
  await H.until(phone, noLayerEntry);
  await phone.waitForTimeout(150);
  t.same(await phone.evaluate(function () { return { booted: window.MindRoot.booted, here: /index\.html/.test(location.href), asked: window.__asked }; }),
    { booted: true, here: true, asked: [false] }, 'a confirm from a menu row: Cancel closes it and the app stays');

  await phone.tap('#thumbbar .btn--more');
  await H.until(phone, function () { return document.querySelector('dialog.sheet[open] [role^="menuitem"]'); });
  await phone.tap('dialog.sheet[open] [role^="menuitem"]:has-text("Probe a panel")');
  await H.until(phone, function () { return window.__panel && window.__panel.isOpen() && document.querySelectorAll('dialog.sheet[open]').length === 1; });
  await H.until(phone, sheetSettled, null, 3000);
  await phone.tap('dialog.sheet[open] .sheet__head .btn');
  await H.until(phone, function () { return !document.querySelector('dialog.sheet[open]'); });
  await H.until(phone, noLayerEntry);
  await phone.waitForTimeout(150);
  t.eq(await phone.evaluate(function () { return window.MindRoot.booted && /index\.html/.test(location.href); }), true, 'a sheet from a menu row: its close button closes it and the app stays');

  var prompted = phone.evaluate(function () {
    var ns = window.MindRoot;
    return new Promise(function (resolve) {
      ns.ui.sheet({
        title: 'Rename',
        body: 'A sheet whose action asks for a name.',
        actions: [{ label: 'Rename', kind: 'primary', onClick: function (e, s) { s.close('action'); ns.ui.prompt({ title: 'New name', label: 'Name', value: 'Old' }).then(resolve); } }]
      });
    });
  });
  await H.until(phone, function () { return document.querySelector('dialog.sheet[open] .sheet__foot .btn'); });
  await H.until(phone, sheetSettled, null, 3000);
  await phone.tap('dialog.sheet[open] .sheet__foot .btn');
  await H.until(phone, function () { return document.querySelector('dialog.dialog[open] input'); });
  await phone.fill('dialog.dialog[open] input', 'New');
  await phone.tap('dialog.dialog[open] .btn--primary');
  t.eq(await prompted, 'New', 'a prompt from a sheet action answers');
  await H.until(phone, noLayerEntry);
  await phone.waitForTimeout(150);
  t.eq(await phone.evaluate(function () { return window.MindRoot.booted && /index\.html/.test(location.href); }), true, 'and the app stays');

  var backAnswer = phone.evaluate(function () { return window.MindRoot.ui.confirm({ title: 'Leave?', text: 'x' }); });
  await H.until(phone, function () { return document.querySelector('dialog.dialog[open]') && history.state && history.state.mindroot2Layer; });
  await phone.goBack();
  t.eq(await backAnswer, false, 'back with a dialog open answers it no');
  await H.until(phone, function () { return !document.querySelector('dialog.dialog[open]'); });
  t.eq(await phone.evaluate(function () { return window.MindRoot.booted && /index\.html/.test(location.href); }), true, 'and does not leave the app');

  await phone.evaluate(function () {
    var ns = window.MindRoot;
    window.__outer = ns.ui.sheet({ title: 'Outer', body: 'Under a dialog.' });
    window.__innerAnswer = 'pending';
    ns.ui.dialog({ title: 'Inner', body: 'On top.' }).then(function (v) { window.__innerAnswer = v; });
  });
  await H.until(phone, function () { return document.querySelector('dialog.dialog[open]') && history.state && history.state.mindroot2Layer; });
  await phone.goBack();
  await H.until(phone, function () { return window.__innerAnswer !== 'pending'; });
  await H.until(phone, function () { return history.state && history.state.mindroot2Layer; });
  t.same(await phone.evaluate(function () { return { inner: window.__innerAnswer, outer: window.__outer.isOpen() }; }), { inner: null, outer: true }, 'nested: back closes the dialog only, the sheet keeps an entry');
  await phone.goBack();
  await H.until(phone, function () { return !window.__outer.isOpen(); });
  await phone.waitForTimeout(150);
  t.eq(await phone.evaluate(function () { return window.MindRoot.booted && /index\.html/.test(location.href); }), true, 'a second back closes the sheet, the app stays');
  await phone.evaluate(function () { window.__unAsk(); window.__unPanel(); });

  t.step('phone: drag a sheet down to dismiss it');
  await phone.evaluate(function () {
    window.__dragSheet = window.MindRoot.ui.sheet({ title: 'Notes', body: window.MindRoot.util.h('p', null, 'Body') });
  });
  await H.until(phone, sheetSettled, null, 3000);
  await phone.evaluate(async function () {
    var grip = document.querySelector('dialog.sheet[open] .sheet__grip');
    var d = grip.closest('dialog');
    var r = grip.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    function fire(el, type, yy) {
      el.dispatchEvent(new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: x, clientY: yy, bubbles: true, cancelable: true }));
    }
    fire(grip, 'pointerdown', y);
    for (var k = 1; k <= 8; k++) {
      fire(d, 'pointermove', y + k * 30);
      await new Promise(function (res) { setTimeout(res, 12); });
    }
    fire(d, 'pointerup', y + 240);
  });
  await H.until(phone, function () { return !window.__dragSheet.isOpen(); });
  t.check('a flick down closes it', true);
  await phone.evaluate(function () {
    window.__stay = window.MindRoot.ui.sheet({ title: 'Stays', body: 'x' });
  });
  await H.until(phone, sheetSettled, null, 3000);
  await phone.evaluate(async function () {
    var grip = document.querySelector('dialog.sheet[open] .sheet__grip');
    var d = grip.closest('dialog');
    var r = grip.getBoundingClientRect();
    function fire(el, type, yy) {
      el.dispatchEvent(new PointerEvent(type, { pointerId: 6, pointerType: 'touch', isPrimary: true, clientX: r.left + 5, clientY: yy, bubbles: true, cancelable: true }));
    }
    fire(grip, 'pointerdown', r.top + 5);
    fire(d, 'pointermove', r.top + 20);
    await new Promise(function (res) { setTimeout(res, 150); });
    fire(d, 'pointermove', r.top + 30);
    await new Promise(function (res) { setTimeout(res, 150); });
    fire(d, 'pointerup', r.top + 30);
  });
  await H.until(phone, sheetSettled, null, 3000);
  t.check('a small slow pull springs back', await phone.evaluate(function () {
    var d = document.querySelector('dialog.sheet[open]');
    return window.__stay.isOpen() && !d.style.translate && Math.round(d.getBoundingClientRect().bottom) === window.innerHeight;
  }));
  await phone.evaluate(function () { window.__stay.close(); });

  t.step('phone: a real finger pulls a sheet down by its body when the body is at its top');
  await phone.tap('#thumbbar .btn--more');
  await H.until(phone, function () { return document.querySelector('dialog.sheet[open] [role^="menuitem"]'); });
  await H.until(phone, sheetSettled, null, 3000);
  var rowBox = await phone.evaluate(function () {
    var r = document.querySelector('dialog.sheet[open] [role^="menuitem"]').getBoundingClientRect();
    return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
  });
  await finger(cdp, rowBox, { x: rowBox.x, y: rowBox.y + 300 }, 10, 12);
  await H.until(phone, function () { return !document.querySelector('dialog.sheet[open]'); }, null, 3000);
  t.check('dismissed by a pull on the list (touch-action and pointercancel included)', true);

  t.step('phone: a sheet with detents rests sized, its actions and last line on screen');
  await phone.evaluate(function () {
    var h = window.MindRoot.util.h;
    var body = h('div', null);
    for (var i = 0; i < 40; i++) body.appendChild(h('p', null, 'Line ' + i));
    window.__detent = window.MindRoot.ui.sheet({ title: 'Long', body: body, detents: [0.5, 0.92], actions: [{ label: 'Empty the trash', kind: 'danger' }] });
  });
  await H.until(phone, sheetSettled, null, 3000);
  /* It opens at its highest rest, nothing to drag up first; a pull on the
   * pill brings it down to the low one. */
  t.eq(await phone.evaluate(function () { return window.__detent.detent(); }), 1, 'it opens at the highest rest');
  var gripFirst = await phone.evaluate(function () {
    var r = document.querySelector('dialog.sheet[open] .sheet__grip').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await finger(cdp, gripFirst, { x: gripFirst.x, y: gripFirst.y + 330 }, 22, 16);
  await H.until(phone, sheetSettled, null, 3000);
  var low = await phone.evaluate(function () {
    var d = document.querySelector('dialog.sheet[open]');
    var body = d.querySelector('.sheet__body');
    body.scrollTop = body.scrollHeight;
    var foot = d.querySelector('.sheet__foot').getBoundingClientRect();
    var lines = body.querySelectorAll('p');
    var last = lines[lines.length - 1].getBoundingClientRect();
    var hit = document.elementFromPoint(foot.left + 30, foot.top + foot.height / 2);
    return {
      shown: Math.round(window.innerHeight - d.getBoundingClientRect().top),
      footBottom: Math.round(foot.bottom), h: window.innerHeight,
      lastBottom: Math.round(last.bottom), footTop: Math.round(foot.top),
      footHit: !!(hit && hit.closest('.sheet__foot')),
      detent: window.__detent.detent(),
      bodyTouch: getComputedStyle(body).touchAction
    };
  });
  t.check('rests at about half the screen', Math.abs(low.shown - 422) < 12, low);
  t.check('its actions are on screen and reachable', low.footBottom <= low.h && low.footHit, low);
  t.check('the end of the body scrolls into view above them', low.lastBottom <= low.footTop + 1, low);
  t.same([low.detent, low.bodyTouch], [0, 'none'], 'at the low rest a swipe on the body moves the sheet');
  await phone.evaluate(function () { window.MindRoot.ui.toast('Restored to its place.'); });
  await H.until(phone, function () {
    var el = document.querySelector('.toast:not([hidden])');
    return el && !el.getAnimations().some(function (a) { return a.playState === 'running'; });
  }, null, 3000);
  var toastOver = await phone.evaluate(function () {
    var el = document.querySelector('.toast:not([hidden])');
    var r = el.getBoundingClientRect();
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight, hit: !!(hit && hit.closest('.toast')), inSheet: !!el.closest('dialog.sheet') };
  });
  t.check('a toast shown over the sheet is on screen and on top', toastOver.bottom <= toastOver.h && toastOver.top >= 0 && toastOver.hit && toastOver.inSheet, toastOver);
  var lowBody = await phone.evaluate(function () {
    var b = document.querySelector('dialog.sheet[open] .sheet__body').getBoundingClientRect();
    return { x: Math.round(b.left + 60), y: Math.round(b.top + 40) };
  });
  await finger(cdp, lowBody, { x: lowBody.x, y: lowBody.y - 320 }, 10, 12);
  await H.until(phone, sheetSettled, null, 3000);
  var high = await phone.evaluate(function () {
    var d = document.querySelector('dialog.sheet[open]');
    return { shown: Math.round(window.innerHeight - d.getBoundingClientRect().top), detent: window.__detent.detent(), bodyTouch: getComputedStyle(d.querySelector('.sheet__body')).touchAction, footBottom: Math.round(d.querySelector('.sheet__foot').getBoundingClientRect().bottom) };
  });
  t.check('a real finger on the body lifts it to the 92% rest', Math.abs(high.shown - Math.round(844 * 0.92)) < 12 && high.detent === 1, high);
  t.eq(high.bodyTouch, 'auto', 'there the body scrolls');
  t.check('actions still on screen', high.footBottom <= 844, high);
  await phone.evaluate(function () { var b = document.querySelector('dialog.sheet[open] .sheet__body'); b.scrollTop = 0; });
  var gripBox = await phone.evaluate(function () {
    var r = document.querySelector('dialog.sheet[open] .sheet__grip').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await finger(cdp, gripBox, { x: gripBox.x, y: gripBox.y + 330 }, 22, 16);
  await H.until(phone, sheetSettled, null, 3000);
  t.eq(await phone.evaluate(function () { return window.__detent.isOpen() && window.__detent.detent(); }), 0, 'a steady pull on the pill down from the top rest lands on the low one');
  await phone.evaluate(function () { window.__detent.close(); });
  await H.until(phone, function () { return !document.querySelector('dialog.sheet[open]'); });

  t.step('phone: a real finger flicks a toast away sideways');
  await phone.evaluate(function () { window.MindRoot.ui.toast('Flick me away.', { duration: 20000 }); });
  await H.until(phone, function () {
    var el = document.querySelector('.toast:not([hidden])');
    return el && !el.getAnimations().some(function (a) { return a.playState === 'running'; });
  }, null, 3000);
  var tb = await phone.evaluate(function () {
    var r = document.querySelector('.toast:not([hidden]) .toast__text').getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
  });
  await finger(cdp, tb, { x: tb.x + 200, y: tb.y }, 10, 12);
  await H.until(phone, function () { return !document.querySelector('.toast:not([hidden])'); }, null, 3000);
  t.check('gone', true);

  t.step('phone: a long title truncates instead of pushing anything off screen');
  await phone.evaluate(function () { window.__fakeTitle('Benachrichtigungseinstellungen und Verwaltung', 'Q3 Board Deck - FINAL (revised) v12 [approved] Benachrichtigungseinstellungen'); });
  await H.until(phone, function () { return /approved/.test(document.title); });
  var title = await phone.evaluate(function () {
    var cap = document.getElementById('topbar-lead').getBoundingClientRect();
    var map = document.querySelector('.title__map');
    return { right: cap.right, w: window.innerWidth, truncated: map.scrollWidth > map.clientWidth, project: getComputedStyle(document.querySelector('.title__project')).display, scroll: document.scrollingElement.scrollWidth };
  });
  await phone.evaluate(function () { window.__restoreStore(); });
  t.check('the capsule stays inside, the map name is cut, the project hidden on a phone', title.right <= title.w - 7 && title.truncated && title.project === 'none' && title.scroll <= title.w, title);

  t.step('phone: toasts above the thumb bar, dialogs stack their buttons');
  await phone.evaluate(function () { window.MindRoot.ui.toast('Moved to the trash.', { action: { label: 'Undo', run: function () {} } }); });
  await H.until(phone, function () {
    var el = document.querySelector('.toast:not([hidden])');
    return el && !el.getAnimations().some(function (a) { return a.playState === 'running'; });
  }, null, 3000);
  var pos = await phone.evaluate(function () {
    return { toast: document.querySelector('.toast:not([hidden])').getBoundingClientRect().bottom, thumb: document.getElementById('thumbbar').getBoundingClientRect().top };
  });
  t.check('the toast clears the thumb bar', pos.toast <= pos.thumb, pos);
  phone.evaluate(function () { return window.MindRoot.ui.confirm({ title: 'Empty the trash?', text: 'For good.', ok: 'Empty it', danger: true }); }).catch(function () {});
  await H.until(phone, function () { return document.querySelector('dialog.dialog[open]'); });
  var foot = await phone.evaluate(function () {
    var b = document.querySelectorAll('dialog.dialog[open] .dialog__foot .btn');
    var r0 = b[0].getBoundingClientRect();
    var r1 = b[1].getBoundingClientRect();
    var toast = document.querySelector('.toast:not([hidden])');
    return {
      stacked: r1.top > r0.bottom - 1, full: Math.abs(r0.width - r1.width) < 1 && r0.width > 300, primaryLast: b[1].classList.contains('btn--danger'),
      toastAdopted: !!(toast && toast.closest('dialog.dialog'))
    };
  });
  t.same(foot, { stacked: true, full: true, primaryLast: true, toastAdopted: true }, 'full-width buttons, the primary nearest the thumb; the toast came along above the scrim');
  await phone.keyboard.press('Escape');
  await phone.evaluate(function () { window.MindRoot.ui.toast('The sample is open.'); });
  phone.evaluate(function () { return window.MindRoot.ui.confirm({ title: 'Empty the trash?', text: 'For good.', ok: 'Empty it', danger: true }); }).catch(function () {});
  await H.until(phone, function () { return document.querySelector('dialog.dialog[open]'); });
  await H.until(phone, function () { return !document.querySelector('.toast:not([hidden])'); }, null, 3000);
  t.check('a toast that only told something leaves when a dialog opens over it, rather than lying on its rows', true);
  await phone.keyboard.press('Escape');
  await phone.evaluate(function () { window.MindRoot.ui.toast('Undone: add a child under the selected node of this map', { action: { label: 'Redo again', run: function () {} } }); });
  var act = await phone.evaluate(function () { var b = document.querySelector('.toast:not([hidden]) .toast__action .btn__label') || document.querySelector('.toast:not([hidden]) .toast__action'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
  t.check('the action keeps its whole word on a phone; the message wraps', act.sw <= act.cw + 1, act);

  t.step('phone: the thumb bar, toasts and dialogs ride above the on-screen keyboard');
  /* Chromium cannot emulate a soft keyboard, so the visual viewport is
   * replaced by a stand-in whose height shrinks the way iOS's does. */
  var kbCtx = await H.context(t, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  var kb = await kbCtx.newPage();
  await kb.addInitScript(function () {
    var vv = new EventTarget();
    window.__kb = 0;
    Object.defineProperty(vv, 'width', { get: function () { return window.innerWidth; } });
    Object.defineProperty(vv, 'height', { get: function () { return window.innerHeight - window.__kb; } });
    ['offsetTop', 'offsetLeft', 'pageTop', 'pageLeft'].forEach(function (k) { Object.defineProperty(vv, k, { get: function () { return 0; } }); });
    Object.defineProperty(vv, 'scale', { get: function () { return 1; } });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: function () { return vv; } });
    window.__vv = vv;
  });
  await t.open('', { page: kb });
  var before = await kb.evaluate(function () { return document.getElementById('thumbbar').getBoundingClientRect().bottom; });
  await kb.evaluate(function () { window.__kb = 336; window.__vv.dispatchEvent(new Event('resize')); });
  await H.until(kb, function () { return getComputedStyle(document.documentElement).getPropertyValue('--kb').trim() === '336px'; });
  var lifted = await kb.evaluate(async function () {
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    window.MindRoot.ui.toast('Above the keyboard');
    await new Promise(function (r) { setTimeout(r, 450); });
    var tb = document.getElementById('thumbbar').getBoundingClientRect();
    var toast = document.querySelector('.toast:not([hidden])').getBoundingClientRect();
    return { thumbBottom: tb.bottom, toastBottom: toast.bottom, thumbTop: tb.top, visibleBottom: window.innerHeight - 336, keyboard: document.documentElement.hasAttribute('data-keyboard') };
  });
  t.check('the thumb bar sits just above the keyboard', lifted.thumbBottom <= lifted.visibleBottom - 7 && lifted.thumbBottom > lifted.visibleBottom - 30, { before: before, after: lifted });
  t.check('the toast above the thumb bar', lifted.toastBottom <= lifted.thumbTop, lifted);
  t.eq(lifted.keyboard, true, 'data-keyboard while it is up');
  var kbIns = await kb.evaluate(function () { return window.MindRoot.shell.insets().bottom; });
  t.check('the map fits and reveals above the keyboard and the lifted thumb bar', kbIns >= 844 - lifted.thumbTop, { insets: kbIns, thumbTop: lifted.thumbTop });
  kb.evaluate(function () { return window.MindRoot.ui.prompt({ title: 'Rename the map', label: 'Name', value: 'Cell' }); }).catch(function () {});
  await H.until(kb, function () {
    var d = document.querySelector('dialog.dialog[open]');
    return d && !d.getAnimations().some(function (a) { return a.playState === 'running'; });
  }, null, 3000);
  var dlgBox = await kb.evaluate(function () {
    var d = document.querySelector('dialog.dialog[open]').getBoundingClientRect();
    var ok = document.querySelector('dialog.dialog[open] .btn--primary').getBoundingClientRect();
    return { top: Math.round(d.top), bottom: Math.round(d.bottom), okBottom: Math.round(ok.bottom), visibleBottom: window.innerHeight - 336 };
  });
  t.check('a dialog is centred above the keyboard, its buttons in sight', dlgBox.top >= 0 && dlgBox.bottom <= dlgBox.visibleBottom && dlgBox.okBottom <= dlgBox.visibleBottom, dlgBox);
  await kb.keyboard.press('Escape');
  await kb.evaluate(function () {
    var h = window.MindRoot.util.h;
    var body = h('div', null);
    for (var i = 0; i < 30; i++) body.appendChild(h('p', null, 'Line ' + i));
    window.__kbSheet = window.MindRoot.ui.sheet({ title: 'Above the keyboard', body: body, detents: [0.5, 0.92], actions: [{ label: 'Done', kind: 'primary' }] });
  });
  await H.until(kb, sheetSettled, null, 3000);
  var kbSheet = await kb.evaluate(function () {
    var d = document.querySelector('dialog.sheet[open]');
    var r = d.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), foot: Math.round(d.querySelector('.sheet__foot').getBoundingClientRect().bottom), visibleBottom: window.innerHeight - 336 };
  });
  /* It opens at its highest rest: 92% of what the keyboard leaves visible. */
  t.check('a sheet rests on the keyboard, at its highest rest, its actions in sight', kbSheet.bottom === kbSheet.visibleBottom && Math.abs((kbSheet.bottom - kbSheet.top) - Math.round(kbSheet.visibleBottom * 0.92)) < 12 && kbSheet.foot <= kbSheet.visibleBottom, kbSheet);
  await kb.evaluate(function () { window.__kbSheet.close(); });
  await kb.evaluate(function () { window.__kb = 0; window.__vv.dispatchEvent(new Event('resize')); });
  await H.until(kb, function () { return getComputedStyle(document.documentElement).getPropertyValue('--kb').trim() === '0px'; });
  t.check('and back down when it goes', true);
  await kbCtx.close();

  t.step('phone: no liquid glass on touch');
  t.eq(lgRequested, false, 'the library is never even loaded');
  t.eq(await phone.evaluate(function () { return document.querySelectorAll('.lg-root').length; }), 0, 'no wrapper');

  t.step('phone: view-only hides the thumb bar');
  await phone.evaluate(function () { window.MindRoot.commands.run('view.readOnly'); });
  await H.until(phone, function () { return getComputedStyle(document.getElementById('thumbbar')).display === 'none'; });
  t.check('hidden', true);
  await phone.tap('.view-exit');
  await H.until(phone, function () { return getComputedStyle(document.getElementById('thumbbar')).display === 'flex'; });
  t.check('back', true);
};
