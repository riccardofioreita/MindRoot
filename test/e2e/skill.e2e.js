/* skill: the `mindroot` skill an AI coding agent uses to write maps
 * (.claude/skills/mindroot/).
 *
 * The skill is words for a model, so what can be tested is what those words
 * promise: the examples SKILL.md teaches from are read by MindRoot exactly
 * as the skill says (one root, documented nodes, a link, a left branch),
 * the validator beside it passes them and catches the mistakes a model
 * makes (a marker in the middle of a line, a second `text`, a quote that
 * fell out of its bullet, a link or a picture that leads nowhere, a list
 * that names a missing map), tools/skill.js installs a copy that runs on
 * its own, and the app imports the example project with its names, its
 * order and its link. */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var SKILL = path.join(__dirname, '..', '..', '.claude', 'skills', 'mindroot');
var Validate = require(path.join(SKILL, 'validate.js'));
var Skill = require('../../tools/skill.js');

function block(text, lang, n) {
  var re = new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```', 'g');
  var m = null;
  for (var i = 0; i <= n; i++) m = re.exec(text);
  return m ? m[1] + '\n' : '';
}

function write(dir, files) {
  Object.keys(files).forEach(function (rel) {
    var full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, files[rel]);
  });
  return dir;
}

function has(result, level, piece) {
  return result.lines.some(function (l) { return l.indexOf(level) === 0 && l.indexOf(piece) >= 0; });
}

module.exports = async function (t) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroot-skill-'));
  var md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');

  /* ------------------------------------------------------- the skill file */
  t.step('SKILL.md');
  var front = /^---\n([\s\S]*?)\n---\n/.exec(md);
  t.check('opens with front matter', !!front);
  t.check('is named mindroot', /^name: mindroot$/m.test(front ? front[1] : ''));
  t.check('says when to use it', /^description: .{80,}$/m.test(front ? front[1] : ''));
  t.check('asks the person what to make', /Ask the person before you write anything/.test(md) && /A whole project/.test(md) && /A single map/.test(md));
  t.check('sends the model to the validator', md.indexOf('validate.js') > 0);

  /* ------------------------------------------- its examples, as a project */
  t.step('the examples of SKILL.md');
  var example = block(md, 'markdown', 0);
  var meta = block(md, 'json', 0);
  t.check('a map to learn from', /^# Sign-in /.test(example), example.slice(0, 40));
  var json = JSON.parse(meta);
  t.same(json.maps.map(function (m) { return m.file; }), ['sign-in.md', 'sessions.md'], 'the example lists its maps');
  var good = write(path.join(tmp, 'sign-in.interneuron'), {
    'interneuron.json': meta,
    'sign-in.md': example,
    'sessions.md': '# Sessions <!-- by: ai -->\n- > note: Part of [[Sign-in]]\n\n## Cookie <!-- by: ai -->\n'
  });
  var ok = Validate.check(good);
  t.eq(ok.code, 0, 'the example project passes');
  t.eq(ok.lines.join('\n'), 'MINDROOT OK (2 maps, 8 nodes)', 'with nothing to say');
  t.eq(Validate.check(path.join(good, 'sign-in.md')).code, 0, 'a single map passes too');
  t.eq(Validate.slugify('Città di Mélisande'), 'citta-di-melisande', 'slugs as FORMAT.md 10.1');

  /* ------------------------------------------------------------- mistakes */
  t.step('what the validator catches');
  var bad = Validate.check(write(path.join(tmp, 'bad.interneuron'), {
    'interneuron.json': JSON.stringify({ name: 'Bad', maps: [{ file: 'bad.md', name: 'Bad' }, { file: 'gone.md', name: 'Gone' }] }),
    'bad.md': [
      '# Bad',
      '- one <!-- color: #ff0000 --> tail',
      '  - > text: first',
      '  > stray',
      '  - > text: second',
      '- [[Nowhere]] and [[Bad#zzzz1]]',
      '- ![](assets/missing.png) pic',
      '- this title is far too long to be the title of a node of a mind map',
      '# Second root',
      ''
    ].join('\n'),
    'Extra.md': '',
    'EXTRA.md': '# Extra\n'
  }));
  t.eq(bad.code, 1, 'a project with mistakes fails');
  t.check('a marker in the middle of a line', has(bad, 'ERROR bad.md:2', 'not a marker at the end'));
  t.check('a quote out of its bullet', has(bad, 'WARN  bad.md:4', 'quoted line'));
  t.check('a second text', has(bad, 'ERROR bad.md:5', 'second "text"'));
  t.check('a link to no map', has(bad, 'ERROR bad.md:6', '[[Nowhere]]'));
  t.check('a link to no node', has(bad, 'ERROR bad.md:6', 'zzzz1'));
  t.check('a missing picture', has(bad, 'ERROR bad.md', 'assets/missing.png'));
  t.check('a long title', has(bad, 'WARN  bad.md:8', 'words'));
  t.check('two roots', has(bad, 'WARN  bad.md:1', 'top-level'));
  t.check('a listed map that is not there', has(bad, 'ERROR interneuron.json', 'gone.md'));
  t.check('a map with no node', has(bad, 'ERROR Extra.md', 'no node'));
  t.check('two files but for the capitals', has(bad, 'ERROR', 'capitals'));
  t.check('says how many', /^MINDROOT INVALID \(\d+ errors\)$/.test(bad.lines[bad.lines.length - 1]), bad.lines[bad.lines.length - 1]);
  t.eq(Validate.check(path.join(tmp, 'nothing')).code, 2, 'nothing to check is not a pass');

  /* -------------------------------------------------------------- install */
  t.step('tools/skill.js');
  var dest = path.join(tmp, 'elsewhere', '.claude', 'skills', 'mindroot');
  t.same(Skill.install(dest).sort(), ['SKILL.md', 'doc.js', 'validate.js'], 'installs three files');
  t.eq(fs.readFileSync(path.join(dest, 'doc.js'), 'utf8'), fs.readFileSync(path.join(t.root, 'js', 'model', 'doc.js'), 'utf8'), 'the parser is the app\'s');
  var run = child.spawnSync(process.execPath, [path.join(dest, 'validate.js'), good], { encoding: 'utf8', cwd: tmp });
  t.eq(run.status, 0, 'the installed validator runs on its own');
  t.eq(run.stdout.trim(), 'MINDROOT OK (2 maps, 8 nodes)', 'and says the same');
  var lone = path.join(tmp, 'lone');
  fs.mkdirSync(lone);
  fs.copyFileSync(path.join(SKILL, 'validate.js'), path.join(lone, 'validate.js'));
  var none = child.spawnSync(process.execPath, [path.join(lone, 'validate.js'), good], { encoding: 'utf8', cwd: tmp, env: Object.assign({}, process.env, { MINDROOT_DOC: '' }) });
  t.eq(none.status, 2, 'without the parser it says the check did not run');
  t.check('in words', /DID NOT RUN/.test(none.stdout), none.stdout);

  /* -------------------------------------------------------------- the app */
  t.step('the app reads the example project');
  var page = await t.open();
  var files = ['interneuron.json', 'sign-in.md', 'sessions.md'].map(function (f) { return { path: f, text: fs.readFileSync(path.join(good, f), 'utf8') }; });
  var read = await page.evaluate(async function (list) {
    var ns = window.MindRoot;
    var project = await ns.archive.projectFromFiles(list.map(function (f) { return { path: f.path, data: new TextEncoder().encode(f.text) }; }), 'sign-in');
    var state = ns.doc.parse(project.maps[0].text);
    var view = ns.doc.viewTree(state);
    return {
      name: project.name,
      maps: project.maps.map(function (m) { return m.name; }),
      root: state.byPath[''].title,
      body: state.byPath['0.0'].body.text,
      note: state.byPath['0.0'].notes.node.text,
      side: state.byPath['1'].side,
      by: state.flat.every(function (e) { return e.by === 'ai'; }),
      link: ns.doc.wikiRefs(project.maps[0].text).map(function (r) { return r.name; }),
      drawn: !!view
    };
  }, files);
  t.eq(read.name, 'Sign-in', 'the project has its name');
  t.same(read.maps, ['Sign-in', 'Sessions'], 'its maps, in order, by name');
  t.eq(read.root, 'Sign-in', 'one central node');
  t.eq(read.body, '`verify()` compares **hashes**, never the words.\n- wrong three times: the account waits\n- right: a session starts', 'words under a node, with their list');
  t.eq(read.note, 'The delay is in `config/auth.json`.', 'a note on a node');
  t.eq(read.side, 'left', 'a branch on the left');
  t.check('every node says the AI wrote it', read.by);
  t.same(read.link, ['Sessions'], 'a link to the other map');
  t.check('the map draws', read.drawn);

  fs.rmSync(tmp, { recursive: true, force: true });
};
