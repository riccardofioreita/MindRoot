/* ink: what a notebook asks of the editor (docs/NOTEBOOK.md) - the
 * semantic ink (dark on light paper, light on dark paper, written as the
 * light paper's literal ink with mr-ink), the sheet and paper of a look
 * (mr-sheet, ns.paper's paper under the drawing, a picture as paper), page
 * files (the page as the viewBox, its size in the scene, clipped on
 * screen), presses off the page handed to the host, setPage keeping each
 * page's own undo, the host's camera bounds, and the old settings' black
 * becoming the ink that adapts, an old file's default black read as
 * the ink, a host history taking undo and redo, and a picture as the paper
 * kept in one node. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var ink = ns.ink;
  var E = ink.engine;
  var P = ns.paper;
  var host = document.getElementById('host');

  function rect(id, x, y, color) { return E.makeShape('rect', [x, y], [x + 60, y + 40], { id: id, color: color || ink.INK, width: 4, fill: 'none' }); }

  function fire(el, type, x, y, buttons) {
    el.dispatchEvent(new PointerEvent(type, {
      pointerId: 3, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: buttons,
      clientX: x, clientY: y, bubbles: true, cancelable: true
    }));
  }

  function draw(ed, x0, y0, x1, y1) {
    var surface = ed.el.querySelector('.ink__surface');
    fire(surface, 'pointerdown', x0, y0, 1);
    for (var i = 1; i <= 8; i++) fire(surface, 'pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, 1);
    fire(surface, 'pointerup', x1, y1, 0);
  }

  T.test('the semantic ink: a name in the scene, the light ink in the file', function () {
    var svg = ink.serialize({ elements: [rect('a', 0, 0), rect('b', 100, 0, '#c4314b'), E.makeText(0, 80, 'words', { id: 't', size: 20, color: ink.INK })] });
    var light = P.colors('light').ink;
    T.eq(ink.lightInk(), light, 'the light paper\'s ink is ns.paper\'s');
    T.ok(/<rect class="mr-ink"[^>]*stroke="#15171c"/.test(svg) || (svg.indexOf('class="mr-ink"') > 0 && svg.indexOf('stroke="' + light + '"') > 0), 'a shape in the ink: literal light ink, marked');
    T.ok(/<text [^>]*class="mr-ink"/.test(svg), 'text too');
    T.ok(svg.indexOf('stroke="#c4314b"') > 0 && !/class="mr-ink"[^>]*stroke="#c4314b"/.test(svg), 'another colour stays literal and unmarked');
    var back = ink.parse(svg);
    T.same(back.elements.map(function (el) { return el.color; }), ['ink', '#c4314b', 'ink'], 'read back: the semantic ink by name');
    var dark = P.themeSvg(svg, 'dark');
    T.ok(dark.indexOf('stroke="' + P.colors('dark').ink + '"') > 0, 'ns.paper shows it light on dark paper');
    T.ok(dark.indexOf('stroke="#c4314b"') > 0, 'and leaves the literal colour alone');
  });

  T.test('the old defaults become the ink that adapts', function () {
    var s = E.cleanSettings({ pens: { pen: { color: '#1f2328' }, pencil: { color: '#4a4f57' }, marker: { color: '#1f2328' } }, shapes: { color: '#1f2328' }, text: { color: '#1F2328' } });
    T.same([s.pens.pen.color, s.pens.pencil.color, s.pens.marker.color, s.shapes.color, s.text.color], ['ink', 'ink', '#1f2328', 'ink', 'ink'],
      'pen, pencil, shapes and text left on black: ink; a marker chosen black stays black');
    var d = E.cleanSettings(null);
    T.same([d.pens.pen.color, d.pens.pencil.color, d.pens.highlighter.color], ['ink', 'ink', '#f2c12e'], 'new hands start with the ink');
    T.eq(ink.SWATCHES[0], 'ink', 'the first swatch is the ink');
  });

  T.test('a page file: the page is the viewBox, on its paper', function () {
    var page = P.pageSize({ id: 'a5' });
    var svg = ink.serialize({ elements: [rect('a', 20, 20)], page: page, paper: { type: 'grid-5' }, sheet: 'auto' });
    var root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    T.eq(root.getAttribute('viewBox'), '0 0 ' + page.w + ' ' + page.h, 'the page');
    T.same(ink.parse(svg).page, { w: page.w, h: page.h }, 'its size in the scene');
    T.ok(/<g class="mr-paper" data-paper="grid-5"/.test(svg), 'the paper drawn in');
    T.ok(svg.indexOf('class="mr-sheet"') > 0 && svg.indexOf(P.colors('light').sheet) > 0, 'on the light sheet');
    var custom = ink.serialize({ elements: [], page: page, paper: { type: 'blank' }, sheet: '#f6f0e1' });
    T.ok(custom.indexOf('fill="#f6f0e1"') > 0, 'a chosen background is written as it is');
    var none = ink.serialize({ elements: [rect('a', 20, 20)] });
    T.ok(/<rect class="mr-sheet"[^>]*fill="#fbfaf7"/.test(none), 'no paper asked for: the plain light sheet, marked');
  });

  T.test('a picture as the paper is written into the file', function () {
    var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    var page = P.pageSize({ id: 'a6' });
    var svg = ink.serialize({ elements: [], page: page, paper: { type: 'image' }, image: { href: png, w: 1, h: 1 } });
    T.ok(/<image class="mr-image"[^>]*preserveAspectRatio="xMidYMid meet"/.test(svg), 'shown whole on the page');
    var inf = ink.serialize({ elements: [rect('a', 0, 0)], paper: { type: 'image' }, image: { href: png, w: 10, h: 10 } });
    T.ok(/<pattern id="mrbg[^"]*" patternUnits="userSpaceOnUse" x="0" y="0" width="10" height="10">/.test(inf), 'repeated from the origin on the infinite sheet');
    var bad = ink.serialize({ elements: [], page: page, paper: { type: 'image' }, image: { href: 'http://example.com/x.png', w: 1, h: 1 } });
    T.ok(bad.indexOf('example.com') < 0, 'a picture that is not a data URL is never written');
  });

  T.test('the editor in a dark look: dark sheet, light ink, the file still light', function () {
    var ed = ink.open(host, { focus: false, look: { theme: 'dark', paper: { type: 'dots' } } });
    var dark = P.colors('dark');
    T.eq(ed.el.style.getPropertyValue('--ink-sheet'), dark.sheet, 'the sheet is the dark paper');
    T.eq(ed.el.getAttribute('data-sheet'), 'dark', 'marked dark');
    T.eq(ed.el.getAttribute('data-paper'), 'dots', 'the paper in place of the dot grid');
    T.ok(!!ed.el.querySelector('.ink__paper [data-paper="dots"]'), 'drawn under the drawing');
    draw(ed, 300, 300, 500, 360);
    var path = ed.el.querySelector('.ink__scene path');
    T.eq(path && path.getAttribute('fill'), dark.ink, 'the stroke in the semantic ink shows light');
    var svg = ed.svg();
    T.ok(svg.indexOf(dark.ink) < 0 && svg.indexOf(ink.lightInk()) > 0, 'the file keeps the light ink');
    ed.setLook({ theme: 'light' });
    T.eq(ed.el.querySelector('.ink__scene path').getAttribute('fill'), ink.lightInk(), 'a new look paints it again');
    T.ok(!ed.el.hasAttribute('data-sheet') && !ed.el.hasAttribute('data-paper'), 'light, no paper: the old sheet');
    var pen = ed.el.querySelector('.ink__tool[data-tool="pen"]').style.getPropertyValue('--swatch');
    T.eq(pen, ink.lightInk(), 'the pen\'s swatch shows the ink as it is drawn');
    ed.close();
  });

  T.test('a highlighter screens on dark paper and multiplies in the file', function () {
    var hl = E.makeStroke([[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5]], { pen: 'highlighter', color: '#f2c12e', size: 20, opacity: 0.4, thinning: 0, smoothing: 0.6, streamline: 0.6, cap: false, blend: 'multiply', sim: true });
    T.eq(E.specOf(hl, null, E.resolveLook({ theme: 'dark' })).attrs.style, 'mix-blend-mode:screen', 'screen on dark paper');
    T.eq(E.specOf(hl, 'file').attrs.style, 'mix-blend-mode:multiply', 'multiply in the file');
  });

  T.test('a page: bounded, clipped, presses off it go to the host', function () {
    var page = P.pageSize({ id: 'a6' });
    var asked = [];
    var ed = ink.open(host, {
      focus: false, page: page, pageId: 'one', hostCamera: true, camera: { x: 20, y: 20, k: 1 },
      look: { paper: { type: 'ruled' } },
      onOutside: function (p) { asked.push(p); return false; }
    });
    T.eq(ed.el.getAttribute('data-page'), '', 'marked as a page');
    T.ok(/url\(#ink-clip-/.test(ed.el.querySelector('.ink__scene').getAttribute('clip-path')), 'the drawing is clipped to the page');
    T.same(ed.camera(), { x: 20, y: 20, k: 1 }, 'the host placed the camera; nothing was fitted');
    var r = ed.el.querySelector('.ink__surface').getBoundingClientRect();
    draw(ed, r.left + 20 + page.w + 40, r.top + 60, r.left + 20 + page.w + 120, r.top + 90);
    T.eq(asked.length, 1, 'a press off the page is offered to the host');
    T.eq(ed.elements().length, 0, 'refused: nothing drawn');
    T.ok(ed.camera().x !== 20, 'it moved the sheet');
    ed.setCamera({ x: 20, y: 20, k: 1 });
    draw(ed, r.left + 60, r.top + 60, r.left + 160, r.top + 120);
    T.eq(ed.elements().length, 1, 'on the page it draws');
    var svg = ed.svg();
    T.same(ink.parse(svg).page, { w: page.w, h: page.h }, 'saved as the page');
    ed.close();
  });

  T.test('setPage: one editor walks the pages, each keeping its undo', function () {
    var page = P.pageSize({ id: 'a6' });
    var saves = [];
    var texts = { one: '', two: '' };
    var ed = ink.open(host, {
      focus: false, page: page, pageId: 'one', hostCamera: true, camera: { x: 20, y: 20, k: 1 },
      onSave: function (svg, info) { saves.push(info.page); texts[info.page] = svg; return true; }
    });
    var r = ed.el.querySelector('.ink__surface').getBoundingClientRect();
    draw(ed, r.left + 60, r.top + 60, r.left + 160, r.top + 120);
    draw(ed, r.left + 60, r.top + 160, r.left + 160, r.top + 200);
    T.eq(ed.history().undo, 2, 'two steps on page one');
    T.eq(ed.setPage({ id: 'two', svgText: texts.two, page: page }), true, 'turned to page two');
    T.same(saves, ['one'], 'page one handed over, named, on the way out');
    T.eq(ed.pageId(), 'two', 'on page two');
    T.eq(ed.elements().length, 0, 'an empty page');
    T.eq(ed.history().undo, 0, 'with no undo of its own yet');
    draw(ed, r.left + 80, r.top + 80, r.left + 120, r.top + 140);
    T.eq(ed.setPage({ id: 'one', svgText: texts.one, page: page }), true, 'back to page one');
    T.same(saves, ['one', 'two'], 'page two handed over');
    T.eq(ed.elements().length, 2, 'its drawing');
    T.eq(ed.history().undo, 2, 'and its undo, kept while the file is as it left it');
    ed.undo();
    T.eq(ed.elements().length, 1, 'undo on page one undoes page one');
    var changed = ink.serialize({ elements: [] });
    ed.setPage({ id: 'two', svgText: changed, page: page });
    T.eq(ed.history().undo, 0, 'a page whose file changed meanwhile opens fresh');
    ed.setPageId('deux');
    T.eq(ed.pageId(), 'deux', 'a page renamed keeps its place');
    ed.close();
  });

  T.test('the host bounds and follows the camera', function () {
    var seen = [];
    var ed = ink.open(host, {
      focus: false, hostCamera: true,
      clampCamera: function (c) { return { x: Math.min(c.x, 0), y: Math.min(c.y, 0), k: Math.min(c.k, 2) }; },
      onCamera: function (c) { seen.push(c); }
    });
    ed.setCamera({ x: 100, y: 50, k: 5 });
    T.same(ed.camera(), { x: 0, y: 0, k: 2 }, 'clamped');
    T.same(seen[seen.length - 1], { x: 0, y: 0, k: 2 }, 'and heard');
    ed.close();
  });

  /* A file of the first version: no page, no mr-sheet or mr-ink anywhere,
   * drawn with the default black (and the pencil's graphite) as literal
   * colours. */
  function legacyFile(elements) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100" data-mindroot-ink="1">' +
      '<metadata id="mindroot-ink">' + JSON.stringify({ v: 1, elements: elements }) + '</metadata>' +
      '<rect x="0" y="0" width="200" height="100" fill="#fbfaf7"/></svg>';
  }

  T.test('an old drawing\'s default black reads as the ink, so it shows on dark paper', function () {
    var els = [
      { id: 'a', type: 'rect', x: 10, y: 10, w: 40, h: 30, color: '#1f2328', width: 3, fill: 'none' },
      { id: 'b', type: 'rect', x: 60, y: 10, w: 40, h: 30, color: '#c4314b', width: 3, fill: 'none' },
      { id: 'c', type: 'stroke', pen: 'pencil', color: '#4A4F57', points: [[110, 20], [150, 60], [180, 70]], sim: true }
    ];
    var old = legacyFile(els);
    T.same(ink.parse(old).elements.map(function (el) { return el.color; }), ['ink', '#c4314b', 'ink'],
      'black and graphite are the ink; a colour chosen by hand stays');
    var now = ink.serialize({ elements: [rect('x', 0, 0, '#1f2328')] });
    T.eq(ink.parse(now).elements[0].color, '#1f2328', 'in a file of this version the same black is a colour like any other');
    var paged = old.replace('"elements"', '"page":{"w":200,"h":100},"elements"');
    T.eq(ink.parse(paged).elements[0].color, '#1f2328', 'a page file is never an old one');
    var ed = ink.open(host, { focus: false, svgText: old, look: { theme: 'dark' } });
    var dark = P.colors('dark');
    var shape = ed.el.querySelector('.ink__scene rect');
    T.eq(shape && shape.getAttribute('stroke'), dark.ink, 'on dark paper the old black draws in the light ink');
    T.ok(!ed.isDirty(), 'reading it so is not a change: opening writes nothing');
    ed.close();
  });

  T.test('a host with its own history takes undo and redo', function () {
    var calls = [];
    var state = { undo: false, redo: false };
    var saved = [];
    var ed = ink.open(host, {
      focus: false,
      history: { undo: function () { calls.push('undo'); }, redo: function () { calls.push('redo'); }, state: function () { return state; } },
      onSave: function (svg) { saved.push(svg); return true; }
    });
    var undoBtn = ed.el.querySelector('[data-key="ink.undo"]');
    var redoBtn = ed.el.querySelector('[data-key="ink.redo"]');
    T.ok(undoBtn.disabled && redoBtn.disabled, 'nothing in the host\'s history: both off');
    state = { undo: true, redo: true };
    ed.refreshHistory();
    T.ok(!undoBtn.disabled && !redoBtn.disabled, 'refreshHistory: the buttons say what the host can do');
    state = { undo: false, redo: false };
    ed.refreshHistory();
    var r = ed.el.querySelector('.ink__surface').getBoundingClientRect();
    draw(ed, r.left + 100, r.top + 100, r.left + 200, r.top + 160);
    T.ok(!undoBtn.disabled, 'a stroke not yet handed over can be undone');
    ed.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    T.same(calls, ['undo'], 'Mod+Z goes to the host');
    T.eq(saved.length, 1, 'the stroke handed over first, so the host undoes it as its last step');
    T.eq(ed.elements().length, 1, 'the editor leaves its scene to the host (which reloads the page)');
    redoBtn.disabled = false;
    redoBtn.click();
    ed.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    T.same(calls, ['undo', 'redo', 'redo'], 'the redo button and Mod+Y too');
    T.eq(saved.length, 1, 'nothing new to hand over: no second save');
    ed.close();
  });

  T.test('a picture as the paper: one node, moved, never parsed again', function () {
    var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    var light = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    var ed = ink.open(host, { focus: false, look: { paper: { type: 'image' }, image: { href: png, w: 30, h: 20, fileHref: light } } });
    var rectNode = ed.el.querySelector('.ink__paper-image rect.mr-image');
    T.ok(!!rectNode, 'on the infinite sheet: a rectangle filled with the repeated picture');
    T.eq(ed.el.querySelectorAll('.ink__paper-image image').length, 1, 'the picture once');
    var x0 = rectNode.getAttribute('x');
    ed.setCamera({ x: -4000, y: -3000, k: 0.2 });
    return T.until(function () { return rectNode.getAttribute('x') !== x0; }, 2000, 'the paper drawn again').then(function () {
      T.ok(ed.el.querySelector('.ink__paper-image rect.mr-image') === rectNode, 'after the camera moved far: the same node, moved to what is on screen');
      var svg = ed.svg();
      T.ok(svg.indexOf(light) > 0 && svg.indexOf(png) < 0, 'the file carries the lighter copy, the sheet the picture itself');
      ed.setPage({ id: 'p', svgText: '', page: P.pageSize({ id: 'a6' }) });
      var img = ed.el.querySelector('.ink__paper-image image.mr-image');
      T.ok(img && img.getAttribute('preserveAspectRatio') === 'xMidYMid meet' && img.getAttribute('href') === png, 'on a page: the picture whole');
      ed.setLook({ paper: { type: 'dots' } });
      T.eq(ed.el.querySelectorAll('.ink__paper-image *').length, 0, 'another paper: the picture goes');
      ed.close();
    });
  });
})();
