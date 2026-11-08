/* export: exporting the open map from the real app. Mod+Shift+E opens the
 * export sheet (formats as a radio group, options remembered in
 * prefs.export, the drawing-only options hidden for Markdown); SVG, PNG and
 * Markdown arrive as downloads named after the map (readably: a PNG
 * dropped back keeps the map's name); the SVG is plain SVG
 * with the font and the pictures inside (a big photo scaled down, the
 * drawing only when asked); the PNG carries the Markdown and comes back as
 * the same map; the PDF sheet cuts the page to the drawing (printed with
 * page.pdf and preferCSSPageSize) and goes away after printing; the
 * clipboard gets the Markdown (with the old execCommand way when the
 * clipboard API refuses); Share hands the file to the system when it can,
 * downloads it when the system refuses, and says why when it fails;
 * a phone gets the sheet from the bottom. */
'use strict';

var fs = require('fs');
var S = require('../fixtures/source/helpers.js');

var MAP = [
  '# Garden plan',
  '',
  '- Vegetables',
  '  - > note: water every morning',
  '  - Tomatoes ![photo](assets/photo.png)',
  '- Flowers',
  '  - Roses',
  '- Sketch ![](assets/plan.ink.svg)',
  ''
].join('\n');

async function addPictures(page, pid) {
  await page.evaluate(async function (pid) {
    var ns = window.MindRoot;
    var c = document.createElement('canvas');
    c.width = 1600;
    c.height = 800;
    var g = c.getContext('2d');
    /* Noise: a photo that does not compress to nothing. */
    var img = g.createImageData(1600, 800);
    for (var i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 256; img.data[i + 1] = Math.random() * 256; img.data[i + 2] = Math.random() * 256; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
    var ref = await ns.storage.putBlob(blob, 'photo.png');
    ns.store.setFile(pid, 'assets/photo.png', ref);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ddd"/></svg>';
    var ref2 = await ns.storage.putBlob(new Blob([svg], { type: 'image/svg+xml' }), 'plan.ink.svg');
    ns.store.setFile(pid, 'assets/plan.ink.svg', ref2);
  }, pid);
}

async function download(page, action) {
  var waiting = page.waitForEvent('download', { timeout: 20000 });
  await action();
  var d = await waiting;
  var file = await d.path();
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(file) };
}

function toast(page) {
  return S.until(page, function () { var t = document.querySelector('.toast'); return t && /Exported/.test(t.textContent) ? t.textContent : false; }).then(function (h) { return h.jsonValue(); });
}

module.exports = async function (t) {
  await S.stubMissing(t.context, t);
  var page = await t.open();
  var ids = await S.seed(page, [{ name: 'Garden plan', text: MAP }]);
  await addPictures(page, ids.pid);

  t.step('Mod+Shift+E opens the export sheet');
  await page.evaluate(function () { document.querySelector('#stage .mv').focus(); });
  await page.keyboard.press('Control+Shift+E');
  await S.until(page, function () { return !!document.querySelector('dialog.sheet.xp[open]'); });
  var sheet = await page.evaluate(function () {
    var d = document.querySelector('dialog.sheet.xp');
    return {
      title: d.querySelector('.sheet__title').textContent,
      formats: Array.prototype.map.call(d.querySelectorAll('.xp-row--format [role="radio"]'), function (b) { return b.textContent + ':' + b.getAttribute('aria-checked'); }),
      checks: Array.prototype.map.call(d.querySelectorAll('input[type="checkbox"]'), function (c) { return c.getAttribute('data-option') + ':' + c.checked; }),
      focus: document.activeElement && document.activeElement.getAttribute('aria-checked')
    };
  });
  t.eq(sheet.title, 'Export', 'titled Export');
  t.same(sheet.formats, ['SVG:true', 'PNG:false', 'PDF:false', 'Markdown:false'], 'four formats, SVG by default');
  t.same(sheet.checks, ['notes:true', 'drawings:false', 'expand:true'], 'notes on, drawings off, every branch open');
  t.eq(sheet.focus, 'true', 'the chosen format has the focus');
  await page.keyboard.press('ArrowRight');
  t.eq(await page.evaluate(function () { return window.MindRoot.prefs.get('export').format; }), 'png', 'arrow keys move the format, remembered');
  await S.until(page, function () { return !document.querySelector('dialog.sheet.xp').getAnimations({ subtree: true }).some(function (a) { return a.playState === 'running'; }); });
  var tabsAt = await page.evaluate(function () { return document.querySelector('dialog.sheet.xp .xp-row--format').getBoundingClientRect().top; });
  await page.click('dialog.sheet.xp [role="radio"][data-value="md"]');
  t.eq(await page.evaluate(function () { return document.querySelector('dialog.sheet.xp .xp-picture').hidden; }), true, 'Markdown hides the options about the picture');
  t.eq(await page.evaluate(function () { return document.querySelector('dialog.sheet.xp .xp-row--format').getBoundingClientRect().top; }), tabsAt, 'and the sheet keeps its top: the formats stay under the pointer');
  await page.click('dialog.sheet.xp input[data-option="notes"]');
  t.same(await page.evaluate(function () { var e = window.MindRoot.prefs.get('export'); return [e.format, e.notes]; }), ['md', false], 'options are remembered as they change');

  t.step('Markdown download, per the options');
  var md = await download(page, function () { return page.click('dialog.sheet.xp .sheet__foot .btn--primary'); });
  t.eq(md.name, 'Garden plan.md', 'named after the map');
  var mdText = md.bytes.toString('utf8');
  t.check('notes left out', mdText.indexOf('> note:') < 0, mdText);
  t.check('the drawing left out', mdText.indexOf('plan.ink.svg') < 0, mdText);
  t.check('the photo kept', mdText.indexOf('assets/photo.png') >= 0, mdText);
  t.eq(await page.evaluate(function () { return !!document.querySelector('dialog.sheet.xp[open]'); }), false, 'the sheet closed');
  t.check('a toast says where it went', /Garden plan\.md/.test(await toast(page)), null);

  t.step('SVG download');
  await page.evaluate(function () { window.MindRoot.prefs.set('export', { format: 'svg', notes: true, drawings: false, expand: true, paper: 'light' }); });
  var svg = await download(page, function () { return page.evaluate(function () { return window.MindRoot.commands.run('export.svg'); }); });
  t.eq(svg.name, 'Garden plan.svg', 'named after the map');
  var text = svg.bytes.toString('utf8');
  t.check('no foreignObject', text.indexOf('foreignObject') < 0, null);
  t.check('Montserrat inside', /@font-face\{font-family:"Montserrat";src:url\(data:font\/woff2;base64,/.test(text), null);
  ['Garden plan', 'Vegetables', 'Tomatoes', 'Roses', 'water every morning'].forEach(function (w) { t.check('has "' + w + '"', text.indexOf('>' + w + '<') >= 0 || text.indexOf(w) >= 0, null); });
  var hrefs = text.match(/xlink:href="([^"]+)"/g) || [];
  t.eq(hrefs.length, 1, 'one picture: the drawing is left out');
  t.check('as a data URL', /^xlink:href="data:image\/png;base64,/.test(hrefs[0] || ''), hrefs);
  var photoW = await page.evaluate(function (href) {
    return new Promise(function (resolve) { var i = new Image(); i.onload = function () { resolve(i.naturalWidth); }; i.onerror = function () { resolve(-1); }; i.src = href; });
  }, (hrefs[0] || '').slice(12, -1));
  t.eq(photoW, 660, 'a 1600 px photo goes in at 660 px');
  var parsed = await page.evaluate(function (s) {
    var d = new DOMParser().parseFromString(s, 'image/svg+xml');
    return { err: d.getElementsByTagName('parsererror').length, w: d.documentElement.getAttribute('width'), vb: d.documentElement.getAttribute('viewBox') };
  }, text);
  t.eq(parsed.err, 0, 'valid XML');
  t.eq(parsed.vb, '0 0 ' + parsed.w + ' ' + parsed.vb.split(' ')[3], 'framed on its own size');
  await page.evaluate(function () { window.MindRoot.prefs.set('export', { drawings: true }); });
  var svg2 = await download(page, function () { return page.evaluate(function () { return window.MindRoot.commands.run('export.svg'); }); });
  t.eq((svg2.bytes.toString('utf8').match(/xlink:href="data:/g) || []).length, 2, 'drawings on: the drawing is in too');

  t.step('PNG carries the map and comes back as it');
  var png = await download(page, function () { return page.evaluate(function () { return window.MindRoot.commands.run('export.png'); }); });
  t.eq(png.name, 'Garden plan.png', 'named after the map, readably');
  t.check('a PNG', png.bytes.slice(1, 4).toString('latin1') === 'PNG', null);
  t.check('with the iTXt chunk mindroot-markdown', png.bytes.indexOf(Buffer.from('iTXtmindroot-markdown', 'latin1')) > 0, null);
  var back = await page.evaluate(async function (b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var got = await window.MindRoot.archive.readFile(new File([bytes], 'Garden plan.png', { type: 'image/png' }));
    return got.map;
  }, png.bytes.toString('base64'));
  t.same(back, { name: 'Garden plan', text: MAP }, 'read back: the same map, with its name');
  var names = await page.evaluate(function () {
    var X = window.MindRoot.exporter;
    return ['Plan: A/B <v2>?', 'Trailing dots...', '  ', 'CON', '***', 'Città di Mélisande', 'x'.repeat(120)].map(function (n) { return X.fileName({ name: n }, 'png'); });
  });
  t.same(names, ['Plan A B v2.png', 'Trailing dots.png', 'mindroot.png', 'mindroot.png', 'mindroot.png', 'Città di Mélisande.png', 'x'.repeat(80) + '.png'],
    'file names keep the words and drop what file systems refuse');

  t.step('PDF: the page is cut to the drawing');
  var prep = await page.evaluate(async function () {
    var r = await window.MindRoot.exporter.pdf({ print: false, notes: true });
    var sheet = document.querySelector('.xp-print');
    return { page: r.page, w: r.width, h: r.height, sheet: !!sheet, svg: !!(sheet && sheet.querySelector('svg')), printing: document.documentElement.hasAttribute('data-printing') };
  });
  t.check('a print sheet with the drawing', prep.sheet && prep.svg && prep.printing, prep);
  var pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  var head = pdf.toString('latin1');
  var box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(head);
  var wantW = prep.page.w * 72 / 25.4;
  var wantH = prep.page.h * 72 / 25.4;
  t.check('the PDF page is the computed size', box && Math.abs(+box[1] - wantW) < 2 && Math.abs(+box[2] - wantH) < 2, { box: box && box.slice(1), want: [wantW, wantH], page: prep.page });
  t.eq((head.match(/\/Type\s*\/Page[^s]/g) || []).length, 1, 'one page');
  t.check('the longest side is at least 297 mm', Math.max(prep.page.w, prep.page.h) >= 297, prep.page);
  await page.evaluate(function () { window.dispatchEvent(new Event('afterprint')); });
  t.eq(await page.evaluate(function () { return !!document.querySelector('.xp-print') || document.documentElement.hasAttribute('data-printing'); }), false, 'after printing the sheet goes');
  var printed = await page.evaluate(async function () {
    var calls = 0;
    var real = window.print;
    window.print = function () { calls++; };
    await window.MindRoot.exporter.run('pdf');
    window.print = real;
    return { calls: calls, sheet: !!document.querySelector('.xp-print'), toast: (document.querySelector('.toast') || {}).textContent };
  });
  t.eq(printed.calls, 1, 'the PDF command opens the print dialog');
  t.check('and says to save as PDF', /Save as PDF/.test(printed.toast || ''), printed);
  await page.evaluate(function () { window.dispatchEvent(new Event('afterprint')); });

  t.step('copy Markdown');
  var copied = await page.evaluate(async function () {
    var got = null;
    var nav = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function (s) { got = s; return Promise.resolve(); } } });
    window.MindRoot.prefs.set('export', { notes: true, drawings: true });
    var ok = await window.MindRoot.exporter.copyMarkdown();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function () { return Promise.reject(new Error('denied')); } } });
    var fallback = null;
    document.addEventListener('copy', function (e) {
      var el = e.target;
      fallback = el && el.value !== undefined ? el.value.slice(el.selectionStart, el.selectionEnd) : String(document.getSelection());
    }, { once: true });
    var ok2 = await window.MindRoot.exporter.copyMarkdown();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: nav });
    return { ok: ok, got: got, ok2: ok2, fallback: fallback, left: document.querySelectorAll('.xp-clip').length };
  });
  t.eq(copied.ok, true, 'the clipboard API takes it');
  t.eq(copied.got, MAP, 'the whole Markdown');
  t.eq(copied.fallback, MAP, 'refused: execCommand copies it instead');
  t.eq(copied.left, 0, 'leaving nothing behind');

  t.step('share, where the system can');
  var shared = await page.evaluate(async function () {
    var got = null;
    navigator.canShare = function (d) { return !!(d && d.files); };
    navigator.share = function (d) { got = { name: d.files[0].name, type: d.files[0].type, title: d.title }; return Promise.resolve(); };
    window.MindRoot.prefs.set('export', { format: 'png' });
    window.MindRoot.exporter.open();
    var btn = Array.prototype.filter.call(document.querySelectorAll('dialog.sheet.xp .sheet__foot .btn'), function (b) { return /Share/.test(b.textContent); })[0];
    if (!btn) return null;
    btn.click();
    for (var i = 0; i < 100 && !got; i++) await new Promise(function (r) { setTimeout(r, 50); });
    return got;
  });
  t.same(shared, { name: 'Garden plan.png', type: 'image/png', title: 'Garden plan' }, 'Share hands the PNG to the system');
  var failed = await page.evaluate(async function () {
    var X = window.MindRoot.exporter;
    var realBuild = window.MindRoot.mapview.contentHtml;
    window.MindRoot.mapview.contentHtml = function () { throw new Error('broken picture'); };
    var ok = await X.share('png');
    window.MindRoot.mapview.contentHtml = realBuild;
    var toast = Array.prototype.map.call(document.querySelectorAll('.toast'), function (el) { return el.textContent; }).join(' | ');
    var refused = null;
    navigator.share = function () { var e = new Error('stale gesture'); e.name = 'NotAllowedError'; return Promise.reject(e); };
    var anchors = [];
    var realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { anchors.push(this.download); };
    refused = await X.share('md');
    HTMLAnchorElement.prototype.click = realClick;
    delete navigator.share;
    delete navigator.canShare;
    return { ok: ok, toast: toast, refused: refused, anchors: anchors };
  });
  t.eq(failed.ok, false, 'a share that fails resolves false, with no page error');
  t.check('and a toast says why', /did not work: broken picture/.test(failed.toast), failed);
  t.eq(failed.refused, true, 'a share sheet that refuses falls back to a download');
  t.same(failed.anchors, ['Garden plan.md'], 'of the same file');

  t.step('Italian, and a phone');
  var phone = await t.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await S.stubMissing(phone, t);
  var pp = await phone.newPage();
  await t.open('', { page: pp, lang: 'it' });
  await S.seed(pp, [{ name: 'Garden', text: '# Garden\n\n- Tomatoes\n' }]);
  await pp.evaluate(function () { window.MindRoot.exporter.open(); });
  await S.until(pp, function () { return !!document.querySelector('dialog.sheet.xp[open]'); });
  var ph = await pp.evaluate(function () {
    var d = document.querySelector('dialog.sheet.xp');
    return { place: d.getAttribute('data-place'), title: d.querySelector('.sheet__title').textContent, run: d.querySelector('.sheet__foot .btn--primary').textContent };
  });
  t.same(ph, { place: 'bottom', title: 'Esporta', run: 'Esporta' }, 'a bottom sheet, in Italian');
  await pp.waitForFunction(function () { var d = document.querySelector('dialog.sheet.xp'); return d && (!d.getAnimations || d.getAnimations().length === 0) && !d.hasAttribute('data-settling'); }, null, { timeout: 4000 });
  await t.shot('phone-sheet', pp);
};
