/* mentions: a node's words point at another node or map of the project.
 * "Mention..." (or '@' typed in the words) lists the project's maps and nodes
 * with a search box; the choice is written as [[#id|words]] (this map) or
 * [[Map#id|words]] (another), the target getting an '<!-- id: ... -->'
 * marker in the same undo step. Clicking the link selects the node (opening
 * its map first when it is another). "Mentioned by" lists who points at a
 * node, or at a map through its primary node, and goes there. */
'use strict';

var E = require('../fixtures/editor/helpers.js');

var ONE = '# Plan\n\n- Alpha\n  - Alpha one\n- Beta\n- Gamma\n';
var TWO = '# Other\n\n- Delta\n- Epsilon\n';

module.exports = async function (t) {
  var s = await E.boot(t, [['Plan', ONE], ['Other', TWO]]);
  var page = s.page;

  function run(id) { return page.evaluate(function (i) { return window.MindRoot.commands.run(i, { source: 'palette' }); }, id); }
  async function pickFrom(query, nth) {
    await page.waitForSelector('.mn-sheet .mn-search', { state: 'visible' });
    if (query) await page.fill('.mn-sheet .mn-search', query);
    await E.until(page, function () { return document.querySelectorAll('.mn-sheet .mn-row').length > 0; });
    if (nth) for (var i = 0; i < nth; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await E.until(page, function () { return !document.querySelector('.mn-sheet'); });
    await E.settled(page);
  }

  t.step('Mention...: a node of this map');
  await E.select(page, '1');
  var steps = (await E.history(page)).count;
  await run('node.mention');
  var rows = await page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.mn-sheet .mn-row'), function (r) { return r.querySelector('.mn-row__label').textContent; });
  });
  t.check('the maps and nodes of the project, this map first', rows[0] === 'Plan' && rows.indexOf('Delta') > rows.indexOf('Gamma'), rows.join(' | '));
  t.check('the node being written is not offered', rows.indexOf('Beta') < 0, rows.join(' | '));
  await pickFrom('alpha one');
  var text = await E.text(page);
  var id = (/- Alpha one <!-- id: (n[a-z0-9]{5}) -->/.exec(text) || [])[1];
  t.check('the target got an id', !!id, text);
  t.check('and the mention is written under Beta', text.indexOf('[[#' + id + '|Alpha one]]') > 0, text);
  var h = await E.history(page);
  t.eq(h.count - steps, 1, 'one undo step for both');
  await page.keyboard.press('Control+z');
  await E.settled(page);
  t.eq(await E.text(page), ONE, 'undone together');
  await page.keyboard.press('Control+y');
  await E.settled(page);
  t.check('and redone', (await E.text(page)).indexOf('[[#' + id + '|Alpha one]]') > 0, await E.text(page));

  t.step('clicking a mention selects the node');
  await E.select(page, '0');
  var link = await page.evaluate(function () {
    var a = Array.prototype.filter.call(document.querySelectorAll('.mv-node a.md-map'), function (x) { return x.getAttribute('data-node'); })[0];
    if (!a) return null;
    var r = a.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  t.check('the link is drawn', !!link, JSON.stringify(link));
  await page.mouse.click(link.x, link.y);
  await E.until(page, function () { return window.MindRoot.session.selected() === '0.0'; });
  t.eq(await E.selected(page), '0.0', 'Alpha one is selected');

  t.step('Mentioned by: who points at a node');
  t.eq(await page.evaluate(function () { return window.MindRoot.mentions.count('0.0'); }), 1, 'one mention');
  await run('node.mentionedBy');
  await page.waitForSelector('.mn-sheet .mn-row--button', { state: 'visible' });
  var by = await page.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('.mn-sheet .mn-row--button .mn-row__label'), function (x) { return x.textContent; }); });
  t.same(by, ['Beta'], 'Beta mentions it');
  await E.select(page, '2');
  await E.select(page, '0.0');
  await page.click('.mn-sheet .mn-row--button');
  await E.until(page, function () { return window.MindRoot.session.selected() === '1'; });
  t.eq(await E.selected(page), '1', 'the row goes to Beta');

  t.step('a node of another map, and a map');
  await run('node.mention');
  await pickFrom('epsilon');
  var plan = await E.text(page);
  var other = await page.evaluate(function (a) { return window.MindRoot.store.map(a.pid, a.mid).text; }, { pid: s.pid, mid: s.mids[1] });
  var oid = (/- Epsilon <!-- id: (n[a-z0-9]{5}) -->/.exec(other) || [])[1];
  t.check('the other map\'s node got its id', !!oid, other);
  t.check('and the words name the map', plan.indexOf('[[Other#' + oid + '|Epsilon]]') > 0, plan);
  await run('node.mention');
  await pickFrom('Other');
  plan = await E.text(page);
  t.check('a map is written as [[Map]]', /\[\[Other\]\]/.test(plan), plan);
  var link2 = await page.evaluate(function () {
    var a = Array.prototype.filter.call(document.querySelectorAll('.mv-node a.md-map'), function (x) { return x.getAttribute('data-map') === 'Other' && x.getAttribute('data-node'); })[0];
    if (!a) return null;
    var r = a.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  t.check('the node mention is drawn', !!link2, '');
  await page.mouse.click(link2.x, link2.y);
  await E.until(page, function (m) { var c = window.MindRoot.session.current(); return c && c.mapId === m && window.MindRoot.session.selected() === '1'; }, s.mids[1]);
  t.eq(await E.selected(page), '1', 'the other map opens on that node');

  t.step('the map mentioned is listed through its primary node');
  await E.select(page, '');
  t.eq(await page.evaluate(function () { return window.MindRoot.mentions.count(''); }), 1, 'Other is mentioned once as a map');
  t.eq(await page.evaluate(function () { return window.MindRoot.mentions.count('1'); }), 1, 'and its node Epsilon once');

  t.step('@ in the words of a node asks for a mention');
  await page.evaluate(function (a) { return window.MindRoot.session.open(a.pid, a.mid); }, { pid: s.pid, mid: s.mids[0] });
  await E.until(page, function (m) { var c = window.MindRoot.session.current(); return c && c.mapId === m; }, s.mids[0]);
  await E.settled(page);
  await E.select(page, '2');
  await page.keyboard.press('Enter');
  await E.until(page, function () { return window.MindRoot.editor.isRenaming(); });
  await page.keyboard.type('see @');
  await page.waitForSelector('.mn-sheet .mn-search', { state: 'visible' });
  await pickFrom('delta');
  t.eq(await page.evaluate(function () { return window.MindRoot.editor.isRenaming(); }), true, 'the words are still being written');
  var typed = await page.evaluate(function () { return window.MindRoot.editor.typing().text; });
  t.check('the @ became the mention', /^see \[\[Other#n[a-z0-9]{5}\|Delta\]\]$/.test(typed), typed);
  await page.keyboard.press('Escape');
  await E.settled(page);

  t.step('Escape on the list keeps the @ typed');
  await E.select(page, '2');
  await page.keyboard.press('Enter');
  await E.until(page, function () { return window.MindRoot.editor.isRenaming(); });
  await page.keyboard.press('End');
  await page.keyboard.type(' @');
  await page.waitForSelector('.mn-sheet .mn-search', { state: 'visible' });
  await page.keyboard.press('Escape');
  await E.until(page, function () { return !document.querySelector('.mn-sheet'); });
  var kept = await page.evaluate(function () { var ty = window.MindRoot.editor.typing(); return ty ? ty.text : null; });
  t.check('the @ is still there', typeof kept === 'string' && /@$/.test(kept), String(kept));
  await page.keyboard.press('Escape');

  t.step('a branch pasted keeps no id the map already has');
  await E.select(page, '2');
  var taken = (/<!-- id: (n[a-z0-9]{5}) -->/.exec(await E.text(page)) || [])[1];
  await page.evaluate(function (id) {
    var dt = new DataTransfer();
    dt.setData('text/plain', '- Copy <!-- id: ' + id + ' -->\n- Fresh <!-- id: nfresh -->\n');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, taken);
  await E.settled(page);
  var pasted = await E.text(page);
  t.eq(pasted.split('<!-- id: ' + taken + ' -->').length - 1, 1, 'the id is on one node only');
  t.check('an id that names nothing here is kept', pasted.indexOf('- Fresh <!-- id: nfresh -->') > 0, pasted);

  t.step('a mention of a node that is gone says so');
  await E.settled(page);
  var gone = await page.evaluate(function (a) {
    var ns = window.MindRoot;
    return ns.editor.jumpTo(a.pid, a.mid, 'nzzzzz');
  }, { pid: s.pid, mid: s.mids[0] });
  t.eq(gone, false, 'no such node');
};
