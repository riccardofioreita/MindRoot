/* images: pictures coming into a map and standing in a node, on the real
 * app - the file picker (Mod+Shift+I, several at once, one undo step), a
 * paste on the map, in a field being renamed and in a text field elsewhere
 * (left alone), a drop onto the node under the pointer (lit while the files
 * hover) and onto the empty map, a new 'Images' root when nothing is
 * selected, a huge photo made smaller on the way in, the placement menu
 * (left / right / above, written as Markdown), taking a picture out (its
 * file to the trash in the same step, Undo from the toast, restore from the
 * trash back into its node), and what a drop brings that is not a picture
 * - a PNG carrying a map, a ZIP of a project, a text file - imported instead
 * of inserted. */
'use strict';

var M = require('../fixtures/media/helpers.js');
var E = M.E;

var MAP = '# Root\n\n- Alpha\n- Beta words\n  - > text: body words\n- Gamma\n';

module.exports = async function (t) {
  var s = await E.boot(t, [['Pics', MAP]]);
  var page = s.page;
  var mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  function text() { return E.text(page); }
  async function waitText(re) {
    try { await E.until(page, function (src) { var c = window.MindRoot.session.current(); return c && new RegExp(src).test(c.text); }, re.source, 6000); } catch (err) { /* checked below */ }
    return text();
  }
  async function loadedPictures(n) {
    try {
      await E.until(page, function (want) {
        var imgs = document.querySelectorAll('.mv-node img.mv-img');
        if (imgs.length < want) return false;
        return Array.prototype.every.call(imgs, function (i) { return i.getAttribute('data-broken') === 'true' || (i.complete && i.naturalWidth > 0); });
      }, n, 6000);
    } catch (err) { /* the check says */ }
    return M.pictures(page);
  }

  t.step('the commands are registered with their keys');
  var cmds = await page.evaluate(function () {
    var C = window.MindRoot.commands;
    return ['media.image', 'media.draw', 'view.board', 'media.panel'].map(function (id) {
      var c = C.get(id);
      return c ? { id: id, keys: c.keys, group: c.group, icon: c.icon } : null;
    });
  });
  t.same(cmds[0], { id: 'media.image', keys: ['Mod+Shift+I'], group: 'node', icon: 'image' }, 'media.image');
  t.check('draw, board (the Board view) and panel too', cmds[1] && cmds[2] && cmds[3], cmds);
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.has('media.board'); }), false, 'the board has one command, view.board, not a second one here');

  t.step('the picker: two pictures with the same name, one step');
  await E.select(page, '0');
  var before = await E.history(page);
  var chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.keyboard.press(mod + '+Shift+I');
  var fc = await chooser;
  t.check('several at once, pictures only', fc.isMultiple(), 'not multiple');
  t.eq(await fc.element().getAttribute('accept'), 'image/*', 'accepts pictures');
  await fc.setFiles([
    { name: 'Cat.PNG', mimeType: 'image/png', buffer: M.png() },
    { name: 'cat.png', mimeType: 'image/png', buffer: M.png(undefined, 7) }
  ]);
  var tx = await waitText(/cat-2\.png/);
  t.check('both in the node, on its left, deduped names', tx.indexOf('- ![Cat](assets/cat.png) ![cat](assets/cat-2.png) Alpha') >= 0, tx);
  var f = await M.files(page);
  t.check('both files in the project', !!f['assets/cat.png'] && !!f['assets/cat-2.png'], f);
  var after = await E.history(page);
  t.eq(after.count, before.count + 1, 'one undo step');
  t.eq(after.label, 'add 2 pictures', 'labelled');
  t.eq(await E.selected(page), '0', 'the node stays selected');
  var pics0 = null;
  var pics = await loadedPictures(2);
  t.check('shown on the map', pics.filter(function (p) { return p.node === '0' && p.loaded; }).length === 2, pics);
  t.eq(await M.waitToast(page, /pictures added/), '2 pictures added.', 'said once');
  await page.evaluate(function () { window.MindRoot.session.undo(); });
  tx = await waitText(/^# Root\n\n- Alpha\n/);
  t.eq(tx, MAP, 'undo takes the pictures and the line back');
  f = await M.files(page);
  t.check('and the files', !f['assets/cat.png'] && !f['assets/cat-2.png'], f);
  await page.evaluate(function () { window.MindRoot.session.redo(); });
  tx = await waitText(/cat-2\.png/);
  t.check('redo brings them back', tx.indexOf('assets/cat-2.png') > 0, tx);

  t.step('a cancelled picker changes nothing');
  var h0 = await E.history(page);
  chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  var picking = page.evaluate(function () { return window.MindRoot.media.pickImages({ path: '2', field: 'line' }); });
  fc = await chooser;
  await fc.setFiles([]);
  await page.evaluate(function () {
    var inputs = document.querySelectorAll('input[type=file]');
    inputs.forEach(function (i) { i.dispatchEvent(new Event('cancel')); });
  });
  var res = await picking;
  t.eq(res.added, 0, 'nothing added');
  t.eq((await E.history(page)).count, h0.count, 'no step');

  t.step('a paste on the map goes into the selected node');
  await M.makeImage(page, 'shot.png', { w: 60, h: 40 });
  await E.select(page, '2');
  t.eq(await M.paste(page, ['shot.png']), true, 'the paste is taken');
  tx = await waitText(/shot\.png/);
  t.check('into Gamma', tx.indexOf('- ![shot](assets/shot.png) Gamma') >= 0, tx);
  t.eq((await E.history(page)).label, 'add a picture', 'one picture, one step');
  t.eq(await M.waitToast(page, /Picture added/), 'Picture added to assets/shot.png.', 'the toast names the file');

  t.step('the same bytes again are named again, not stored twice');
  var filesBefore = Object.keys(await M.files(page)).length;
  await E.select(page, '2');
  await M.paste(page, ['shot.png']);
  tx = await waitText(/!\[shot\]\(assets\/shot\.png\) !\[shot\]\(assets\/shot\.png\) Gamma/);
  t.check('the node names the file it already had', tx.indexOf('- ![shot](assets/shot.png) ![shot](assets/shot.png) Gamma') >= 0, tx);
  t.eq(Object.keys(await M.files(page)).length, filesBefore, 'no second file');
  await page.evaluate(function () { window.MindRoot.session.undo(); });
  await waitText(/- !\[shot\]\(assets\/shot\.png\) Gamma/);

  t.step('a paste in a text field elsewhere stays there');
  var h1 = await E.history(page);
  var kept = await page.evaluate(function () {
    var input = document.createElement('input');
    input.id = 'elsewhere';
    document.body.appendChild(input);
    input.focus();
    return true;
  });
  t.check('a field to paste into', kept);
  t.eq(await M.paste(page, ['shot.png']), false, 'not taken from the field');
  await page.waitForTimeout(150);
  t.eq((await E.history(page)).count, h1.count, 'nothing written');
  await page.evaluate(function () { document.getElementById('elsewhere').remove(); window.MindRoot.session.view.el.focus(); });

  t.step('a paste into the words under a node, while renaming');
  await M.makeImage(page, 'b.png', { w: 30, h: 30, color: '#c4314b' });
  await page.evaluate(function () { window.MindRoot.editor.startRename('1', { field: 'body' }); });
  await E.until(page, function () { return !!document.querySelector('.mv-edit--body'); });
  await M.paste(page, ['b.png']);
  tx = await waitText(/b\.png/);
  t.check('the picture joins the words under the line', tx.indexOf('  - > text: ![b](assets/b.png) body words') >= 0, tx);
  t.check('the line is untouched', tx.indexOf('- Beta words\n') >= 0, tx);
  try { await E.until(page, function () { return !!window.MindRoot.editor.renaming(); }, null, 3000); } catch (err) { /* checked */ }
  t.same(await E.renaming(page), { path: '1', field: 'body' }, 'the rename goes on where it was');
  await page.keyboard.press('Escape');

  t.step('nothing selected: a new root called Images');
  await page.evaluate(function () { window.MindRoot.session.select(null); window.MindRoot.session.view.el.focus(); });
  await M.makeImage(page, 'loose.png', { w: 20, h: 20, color: '#2f6fb3' });
  await M.paste(page, ['loose.png']);
  tx = await waitText(/loose\.png/);
  t.check('a root of pictures', /\n# Images\n\n- !\[loose\]\(assets\/loose\.png\)\n?$/.test(tx), tx);
  var sel = await E.selected(page);
  var selText = await page.evaluate(function (p) { var c = window.MindRoot.session.current(); return c.state.byPath[p] ? c.state.byPath[p].title : null; }, sel);
  t.eq(selText, '![loose](assets/loose.png)', 'the new node is selected');
  await page.evaluate(function () { window.MindRoot.session.undo(); });
  await waitText(/^(?![\s\S]*loose)/);

  t.step('a drop onto the node under the pointer');
  await M.makeImage(page, 'drop.png', { w: 50, h: 50, color: '#d9731c' });
  await E.select(page, '0');
  var beta = await E.box(page, '1');
  var d = await M.drop(page, ['drop.png'], beta.x + 6, beta.y + Math.min(10, beta.h / 2));
  t.check('the drop is taken and the browser does not navigate', d.prevented, d);
  t.check('the node under the pointer is lit while the files hover', d.lit && d.litPath === '1', d);
  t.check('and no longer once dropped', !d.after, d);
  t.check('nor a frame later (a dragover just before the drop lights nothing)', !d.later, d);
  tx = await waitText(/drop\.png/);
  t.check('into Beta, not the selection', tx.indexOf('- ![drop](assets/drop.png) Beta words') >= 0, tx);

  t.step('a drop on the empty map goes into the selection');
  await M.makeImage(page, 'drop2.png', { w: 50, h: 50 });
  await E.select(page, '2');
  var stage = await E.rectOf(page, '#stage');
  d = await M.drop(page, ['drop2.png'], stage.right - 30, stage.bottom - 90);
  tx = await waitText(/drop2\.png/);
  t.check('into Gamma, beside its picture', /- !\[shot\]\(assets\/shot\.png\) !\[drop2\]\(assets\/drop2\.png\) Gamma/.test(tx), tx);

  t.step('a huge photo is made smaller on the way in');
  await M.makeImage(page, 'huge.jpg', { w: 5000, h: 1000, type: 'image/jpeg' });
  await E.select(page, '2');
  await M.paste(page, ['huge.jpg']);
  tx = await waitText(/huge\.jpg/);
  t.check('in the node as a JPEG', tx.indexOf('![huge](assets/huge.jpg)') > 0, tx);
  var dims = await page.evaluate(function () {
    var ns = window.MindRoot;
    var ref = ns.store.fileRef(ns.store.here().projectId, 'assets/huge.jpg');
    return ns.storage.getBlob(ref.asset).then(function (b) {
      return createImageBitmap(b).then(function (bmp) { return { w: bmp.width, h: bmp.height, type: b.type }; });
    });
  });
  t.same(dims, { w: 4096, h: 819, type: 'image/jpeg' }, '4096 px on its longer side, still a JPEG');
  t.check('the toast says so', /made smaller, to 4096 px/.test(await M.waitToast(page, /smaller/)), await M.toast(page));

  t.step('placement: one menu, left / right / above, written as Markdown');
  await E.select(page, '0');
  var labels = await page.evaluate(function () {
    window.__anchor = document.createElement('button');
    window.__anchor.style.cssText = 'position:fixed;left:300px;top:300px;width:10px;height:10px';
    document.body.appendChild(window.__anchor);
    window.MindRoot.media.pictureMenu(window.__anchor, { path: '0', field: 'line' });
    return Array.prototype.map.call(document.querySelectorAll('.menu:not([hidden]) .menu__item .menu__label'), function (e) { return e.textContent; });
  });
  t.same(labels, ['Add a picture', 'Draw in this box', 'Show the picture', 'To the left of the words', 'To the right of the words', 'Above the words', 'Take the picture out'], 'the items for a box with photos');
  var checked = await page.evaluate(function () {
    var el = Array.prototype.find.call(document.querySelectorAll('.menu:not([hidden]) .menu__item'), function (e) { return e.getAttribute('aria-checked') === 'true'; });
    return el ? el.querySelector('.menu__label').textContent : null;
  });
  t.eq(checked, 'To the left of the words', 'where they stand now is checked');
  await page.evaluate(function () {
    var el = Array.prototype.find.call(document.querySelectorAll('.menu:not([hidden]) .menu__item'), function (e) { return e.textContent.indexOf('To the right') >= 0; });
    el.click();
  });
  tx = await waitText(/- Alpha !\[Cat\]/);
  t.check('right: after the words', tx.indexOf('- Alpha ![Cat](assets/cat.png) ![cat](assets/cat-2.png)\n') >= 0, tx);
  t.eq((await E.history(page)).label, 'move the picture', 'labelled');
  await page.evaluate(function () { return window.MindRoot.media.setPicturePosition('0', 'line', 'photo', 'above'); });
  tx = await waitText(/image: above/);
  t.check('above: in front, with the marker', tx.indexOf('- ![Cat](assets/cat.png) ![cat](assets/cat-2.png) Alpha <!-- image: above -->\n') >= 0, tx);
  var side = await page.evaluate(function () { var c = window.MindRoot.session.current(); return window.MindRoot.doc.imagePositionAt(c.state, '0', 'line', 'photo'); });
  t.eq(side, 'above', 'and read back');
  pics0 = await loadedPictures(3);
  t.check('drawn above the words on the map', await page.evaluate(function () {
    var n = window.MindRoot.session.view.nodeEl('0');
    return !!n.querySelector('.mv-pics--above img');
  }), pics0);
  await page.evaluate(function () { return window.MindRoot.media.setPicturePosition('0', 'line', 'photo', 'left'); });
  tx = await waitText(/- !\[Cat\]\(assets\/cat\.png\) !\[cat\]\(assets\/cat-2\.png\) Alpha\n/);
  t.check('left again: the marker goes', tx.indexOf('image: above') < 0, tx);
  var noWords = await page.evaluate(function () {
    window.MindRoot.ui.closeTransient && window.MindRoot.ui.closeTransient();
    var items = window.MindRoot.media.pictureItems('2', 'line');
    return items.filter(function (i) { return i && i.label === 'Above the words'; }).map(function (i) { return !!i.disabled; });
  });
  t.same(noWords, [false], 'a box with words offers the sides');

  t.step('placing while the node is being renamed keeps what was typed');
  await page.evaluate(function () { window.MindRoot.editor.startRename('0'); });
  await E.until(page, function () { return !!document.querySelector('.mv-edit--title'); });
  await page.keyboard.press('End');
  await page.keyboard.type(' typed');
  await page.evaluate(function () { return window.MindRoot.media.setPicturePosition('0', 'line', 'photo', 'right'); });
  tx = await waitText(/Alpha typed !\[Cat\]/);
  t.check('the words and the move, both in', tx.indexOf('- Alpha typed ![Cat](assets/cat.png) ![cat](assets/cat-2.png)\n') >= 0, tx);
  try { await E.until(page, function () { return !!window.MindRoot.editor.renaming(); }, null, 3000); } catch (err) { /* checked */ }
  t.same(await E.renaming(page), { path: '0', field: 'line' }, 'and the writing goes on');
  await page.keyboard.press('Escape');
  await page.evaluate(function () { window.MindRoot.session.undo(); window.MindRoot.session.undo(); });
  tx = await waitText(/- !\[Cat\]\(assets\/cat\.png\) !\[cat\]\(assets\/cat-2\.png\) Alpha\n/);
  t.check('undone', tx.indexOf('typed') < 0, tx);

  t.step('the words under a node have their own placement');
  await page.evaluate(function () { return window.MindRoot.media.setPicturePosition('1', 'body', 'photo', 'right'); });
  tx = await waitText(/body words !\[b\]/);
  t.check('right of the words under the line', tx.indexOf('  - > text: body words ![b](assets/b.png)\n') >= 0, tx);
  t.check('the line keeps its own', tx.indexOf('- ![drop](assets/drop.png) Beta words\n') >= 0, tx);
  await page.evaluate(function () { return window.MindRoot.media.setPicturePosition('1', 'body', 'photo', 'above'); });
  tx = await waitText(/image: above/);
  t.check('above, the marker on the words under the line', /  - > text: !\[b\]\(assets\/b\.png\) body words <!-- image: above -->\n/.test(tx), tx);

  t.step('taking a picture out: the file goes to the trash in the same step');
  var hb = await E.history(page);
  await page.evaluate(function () { return window.MindRoot.media.takePictureOut('0', 'line', 'photo'); });
  tx = await waitText(/- !\[Cat\]\(assets\/cat\.png\) Alpha\n/);
  t.check('the last one comes off', tx.indexOf('cat-2.png') < 0, tx);
  var tr = await M.trash(page);
  t.check('a figure in the trash, with its node', tr.length && tr[0].kind === 'figure' && tr[0].path === 'assets/cat-2.png' && tr[0].owner === 'Alpha', tr);
  f = await M.files(page);
  t.check('the file left assets/', !f['assets/cat-2.png'] && !!f['assets/cat.png'], f);
  var ha = await E.history(page);
  t.eq(ha.count, hb.count + 1, 'one step');
  t.eq(ha.label, 'take the picture out', 'labelled');
  t.eq(await M.waitToast(page, /trash/), 'The picture is in the trash.', 'the toast');
  await page.click('.toast:not([hidden]) .toast__action');
  tx = await waitText(/cat-2\.png/);
  t.check('Undo from the toast puts it back', tx.indexOf('- ![Cat](assets/cat.png) ![cat](assets/cat-2.png) Alpha') >= 0, tx);
  t.eq((await M.trash(page)).length, 0, 'and the trash is empty again');
  await page.evaluate(function () { return window.MindRoot.media.takePictureOut('0', 'line', 'photo'); });
  await waitText(/- !\[Cat\]\(assets\/cat\.png\) Alpha\n/);
  tr = await M.trash(page);
  var back = await page.evaluate(function (id) {
    var ns = window.MindRoot;
    var r = ns.store.restoreTrash(ns.store.here().projectId, id);
    return r ? r.where : null;
  }, tr[0].id);
  t.eq(back, 'same', 'restored from the trash');
  tx = await waitText(/cat-2\.png/);
  t.check('back in its node', /- !\[Cat\]\(assets\/cat\.png\)\s*!\[\]\(assets\/cat-2\.png\) Alpha/.test(tx), tx);
  f = await M.files(page);
  t.check('with its file', !!f['assets/cat-2.png'], f);

  t.step('what a drop brings that is not a picture is imported');
  var counts = await page.evaluate(function () {
    var ns = window.MindRoot;
    return { projects: ns.store.projects().length, maps: ns.store.project(ns.store.here().projectId).maps.length };
  });
  await M.putFile(page, 'Carried.png', M.png('# Carried\n\n- one\n- two\n'), 'image/png');
  var hx = await E.history(page);
  var node2 = await E.box(page, '2');
  await M.drop(page, ['Carried.png'], node2.x + 4, node2.y + 4);
  try {
    await E.until(page, function (n) { var ns = window.MindRoot; return ns.store.project(ns.store.here().projectId).maps.length > n; }, counts.maps, 6000);
  } catch (err) { /* checked */ }
  var mapsNow = await page.evaluate(function () {
    var ns = window.MindRoot;
    return ns.store.project(ns.store.here().projectId).maps.map(function (m) { return m.name; });
  });
  t.check('a PNG that carries a map comes in as a map', mapsNow.indexOf('Carried') >= 0, mapsNow);
  var pics = await page.evaluate(function (ids) { return window.MindRoot.store.map(ids.pid, ids.mid).text; }, { pid: s.pid, mid: s.mid });
  t.check('and not as a picture in the node', pics.indexOf('Carried') < 0 && pics.indexOf('carried.png') < 0, pics);
  t.eq((await E.history(page)).count, hx.count + 1, 'one step for the import');
  await page.evaluate(function (ids) { return window.MindRoot.session.open(ids.pid, ids.mid); }, { pid: s.pid, mid: s.mid });
  await E.settled(page);
  node2 = await E.box(page, '2');

  await page.evaluate(function () {
    var ns = window.MindRoot;
    return ns.archive.projectZip(ns.store.here().projectId).then(function (z) {
      window.__files['Pics.interneuron.zip'] = new File([z.blob], 'Pics.interneuron.zip', { type: 'application/zip' });
    });
  });
  await M.drop(page, ['Pics.interneuron.zip'], node2.x + 4, node2.y + 4);
  try {
    await E.until(page, function (n) { return window.MindRoot.store.projects().length > n; }, counts.projects, 6000);
  } catch (err) { /* checked */ }
  t.eq(await page.evaluate(function () { return window.MindRoot.store.projects().length; }), counts.projects + 1, 'a ZIP of a project comes in as a project');
  t.check('said in one toast', /project imported/i.test(await M.waitToast(page, /imported/)), await M.toast(page));

  await M.putFile(page, 'notes.txt', Buffer.from('hello'), 'text/plain');
  var ht = await E.history(page);
  await M.drop(page, ['notes.txt'], node2.x + 4, node2.y + 4);
  var said = await M.waitToast(page, /not something MindRoot can import/);
  t.check('a file nobody can import is named, nothing written', /notes\.txt/.test(said || ''), said);
  t.eq((await E.history(page)).count, ht.count, 'no step');

  t.step('read only: nothing comes in');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(true); });
  await M.makeImage(page, 'ro.png', { w: 10, h: 10 });
  await E.select(page, '2');
  var hr = await E.history(page);
  await M.paste(page, ['ro.png']);
  await page.waitForTimeout(200);
  t.eq((await E.history(page)).count, hr.count, 'a paste in view-only mode writes nothing');
  t.eq(await page.evaluate(function () { return window.MindRoot.commands.enabled('media.image'); }), false, 'the picker is off');
  await page.evaluate(function () { window.MindRoot.shell.setViewOnly(false); });
};
