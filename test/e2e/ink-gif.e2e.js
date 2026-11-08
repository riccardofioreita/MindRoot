/* ink-gif: an animated GIF on a drawing sheet stays a GIF. Pictures wider
 * than IMAGE_MAX_SIDE are drawn again smaller on a canvas, which would keep
 * only a GIF's first frame: a GIF goes in as it is, so it still moves. A
 * small one too, of course. (The fixture is 2600 x 40 px, three frames.) */
'use strict';

var fs = require('fs');
var path = require('path');

module.exports = async function (t) {
  var page = t.page;
  await page.goto(t.fileUrl('test/fixtures/ink/host.html'));
  await page.waitForFunction(function () { return !!(window.MindRoot && window.MindRoot.ink && window.mount); });
  await page.evaluate(function () { window.mount({}); window.editor.setCamera({ x: 0, y: 0, k: 1 }); });
  var b64 = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ink', 'wide-anim.gif')).toString('base64');

  t.step('a GIF wider than the limit, from a file');
  var got = await page.evaluate(function (b) {
    var bytes = Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); });
    var f = new File([bytes], 'wide-anim.gif', { type: 'image/gif' });
    return window.editor.insertImage(f).then(function () {
      var pics = window.editor.scene().filter(function (e) { return e.type === 'image'; });
      var drawn = Array.prototype.map.call(document.querySelectorAll('.ink image'), function (i) { return i.getAttribute('href') || i.getAttribute('xlink:href') || ''; });
      return pics.length ? { gif: drawn.length > 0 && drawn.every(function (h) { return /^data:image\/gif;/.test(h); }), n: drawn.length } : null;
    });
  }, b64);
  t.check('added', !!got, got);
  t.eq(got && got.gif, true, 'kept as a GIF (all its frames), not redrawn as a still');

  t.step('a GIF as a data URL');
  var small = await page.evaluate(function (b) {
    return window.editor.insertImage('data:image/gif;base64,' + b).then(function () {
      var pics = window.editor.scene().filter(function (e) { return e.type === 'image'; });
      var drawn = Array.prototype.map.call(document.querySelectorAll('.ink image'), function (i) { return i.getAttribute('href') || i.getAttribute('xlink:href') || ''; });
      return pics.length + ',' + (drawn.length >= 2 && drawn.every(function (h) { return /^data:image\/gif;/.test(h); }));
    });
  }, b64);
  t.eq(small, '2,true', 'kept as a GIF too');
};
