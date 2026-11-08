/* MindRoot - pictures on a board, on the real app: a picture added to the
 * canvas is kept in that canvas's file (once, a format-2 drawing), survives
 * a change of paper (every page file is drawn again), is in the thumbnails,
 * the PDF and the PNG, and belongs to its canvas alone. */
'use strict';

var N = require('../fixtures/notebook/helpers.js');

module.exports = async function (t) {
  var page = t.page;
  await N.openApp(t);
  var ids = await N.project(page, [['Garden', '# Garden\n\n- Rose\n- Basil\n']]);
  var folder = 'assets/garden-board.book';

  function ev(fn, arg) { return page.evaluate(fn, arg); }
  function view(fn, arg) {
    return page.evaluate(function (a) {
      var v = window.MindRoot.notebook.boardView();
      return (new Function('v', 'arg', 'return (' + a.fn + ')(v, arg);'))(v, a.arg);
    }, { fn: String(fn), arg: arg === undefined ? null : arg });
  }
  function file(name) { return N.fileText(page, ids.pid, folder + '/' + name); }
  function picturesIn(svg) { return ev(function (s) { return window.MindRoot.ink.parse(s).elements.filter(function (e) { return e.type === 'image'; }).length; }, svg); }

  var dataUrl = await ev(function () {
    var c = document.createElement('canvas');
    c.width = 300; c.height = 150;
    var g = c.getContext('2d');
    g.fillStyle = '#c4314b'; g.fillRect(0, 0, 150, 150);
    g.fillStyle = '#2f6fb3'; g.fillRect(150, 0, 150, 150);
    return c.toDataURL('image/png');
  });

  t.step('a picture on the first canvas is written into its file');
  await page.click('#topbar-actions .nb-switch [data-value="board"]');
  await N.boardReady(page);
  var box = await ev(function () { var r = document.querySelector('#board .ink__surface').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await N.stroke(page, box.x + 300, box.y + 250, box.x + 420, box.y + 300);
  await N.idle(page);
  var added = await view(function (v, u) { return v.editor().insertImage(u).then(function (id) { return !!id; }); }, dataUrl);
  t.eq(added, true, 'added');
  await N.idle(page);
  var f1 = await file('001.ink.svg');
  t.eq(f1.indexOf('data-mindroot-ink="2"') > 0, true, 'the file is format 2');
  t.eq(f1.split('data:image/png').length - 1, 1, 'with the bytes once');
  t.eq(await picturesIn(f1), 1, 'and it reads back as one picture');
  t.eq(await ev(function (s) { return window.MindRoot.ink.parse(s).elements[0].type; }, f1), 'image', 'behind the stroke');

  t.step('a change of paper draws every file again - the picture stays');
  await view(function (v) { return v.setSetting({ paper: { type: 'grid-5' } }); });
  await N.idle(page);
  f1 = await file('001.ink.svg');
  t.eq(await picturesIn(f1), 1, 'one picture after the paper changed');
  t.eq(f1.split('data:image/png').length - 1, 1, 'still written once');

  t.step('a second canvas has none of its own');
  await view(function (v) { return v.addPage(); });
  await N.idle(page);
  var f2 = await file('002.ink.svg');
  t.eq(await picturesIn(f2), 0, 'the new canvas is empty');
  t.eq(await view(function (v) { return v.editor().elements().length; }), 0, 'and so is the sheet');
  await view(function (v) { v.goTo(1); });
  await N.until(page, function () { var v = window.MindRoot.notebook.boardView(); return v.editor().pageId() === '001.ink.svg'; });
  t.eq(await view(function (v) { return v.editor().elements().filter(function (e) { return e.type === 'image'; }).length; }), 1, 'back on the first: the picture is on the sheet');

  t.step('in the thumbnails, the PDF and the PNG');
  await view(function (v) { v.openThumbs(); });
  await page.waitForSelector('.nb-thumbs__grid .nb-thumb__page', { state: 'visible' });
  /* The thumbnails are drawn after the grid shows: wait for the first picture. */
  await N.until(page, function () { var img = document.querySelector('.nb-thumbs__grid .nb-thumb__page img, .nb-thumbs__grid img'); return !!img && !!img.src; });
  var thumb = await ev(function () {
    var img = document.querySelector('.nb-thumbs__grid .nb-thumb__page img, .nb-thumbs__grid img');
    return img ? { src: !!img.src } : null;
  });
  t.check('a thumbnail picture exists', !!thumb && thumb.src, thumb);
  await page.keyboard.press('Escape');
  await N.until(page, function () { return !document.querySelector('.nb-sheet'); });
  var pdf = await ev(function () {
    var nb = window.MindRoot.notebook;
    var b = nb.boardView().book();
    return nb.exportPdf(b, { print: false, theme: 'light' }).then(function (r) {
      var sheet = document.querySelector('.nb-print');
      var out = { pages: r.pages.length, images: sheet ? sheet.querySelectorAll('image').length : -1 };
      if (r.cleanup) r.cleanup();
      return out;
    });
  });
  t.same([pdf.pages, pdf.images >= 1], [1, true], 'the PDF has the page, with the picture in it (an empty canvas is left out)');
  var png = await ev(function () {
    var nb = window.MindRoot.notebook;
    return nb.exportPng(nb.boardView().book(), 0, { download: false }).then(function (b) { return b && b.size > 500; });
  });
  t.eq(png, true, 'the PNG is made');
};
