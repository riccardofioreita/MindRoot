#!/usr/bin/env node
/* MindRoot - the check of the `mindroot` skill: does MindRoot read these
 * maps the way they were meant?
 *
 *     node validate.js <path>      a project folder (.interneuron or any folder
 *                                  of .md files) or one .md file
 *
 * Every map is read with MindRoot's own parser (js/model/doc.js), so what
 * this says is what the app would draw. One line per finding,
 *
 *     ERROR sessions.md:12 a second "text" on this node is ignored
 *     WARN  sessions.md:30 title of 14 words (keep it to 8)
 *
 * then `MINDROOT OK (3 maps, 87 nodes)` and exit 0, or `MINDROOT INVALID
 * (2 errors)` and exit 1. An ERROR is something MindRoot would read
 * differently from what the file means to say, or would not find; a WARN is
 * a map that reads but could be better. Exit 2: nothing to check, or the
 * parser is not there.
 *
 * The parser is looked for in MINDROOT_DOC, then beside this file (doc.js,
 * where tools/skill.js puts a copy when it installs the skill), then in the
 * MindRoot repository this file is part of. Node built-ins only. */
'use strict';

var fs = require('fs');
var path = require('path');

var K_TEXT = 2;
var K_NOTE = 6;
var MAX_WORDS = 12;
var MAX_NODES = 150;
var MAP_RE = /\.(md|markdown)$/i;
var NOTE_RE = /^[ \t]*[-*+][ \t]+>[ \t]*(note|nota|edge|arco|text)[ \t]*:/i;

var parser = null;

function loadParser() {
  if (parser) return parser;
  var places = [process.env.MINDROOT_DOC, path.join(__dirname, 'doc.js'), path.join(__dirname, '..', '..', '..', 'js', 'model', 'doc.js')];
  for (var i = 0; i < places.length; i++) {
    if (!places[i] || !fs.existsSync(places[i])) continue;
    var had = global.window;
    global.window = {};
    try {
      require(path.resolve(places[i]));
      if (global.window.MindRoot && global.window.MindRoot.doc) return (parser = global.window.MindRoot.doc);
    } finally {
      global.window = had;
    }
  }
  return null;
}

/* FORMAT.md 10.1. */
function slugify(text) {
  return String(text || '').normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

/* How the app compares the name in a [[link]] with a map's. */
function nameKey(s) { return String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(); }

function walk(dir, rel, out) {
  fs.readdirSync(dir).sort().forEach(function (name) {
    if (name[0] === '.') return;
    var full = path.join(dir, name);
    var r = rel ? rel + '/' + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, r, out);
    else out.push(r);
  });
  return out;
}

/* What is at `target`: {maps: [{file, name, text}], files: {path: true} or null, findings}. */
function collect(target) {
  var findings = [];
  if (!fs.statSync(target).isDirectory()) {
    var base = path.basename(target);
    return { maps: [{ file: base, name: base.replace(MAP_RE, ''), text: fs.readFileSync(target, 'utf8') }], files: null, findings: findings };
  }
  var files = {};
  walk(target, '', []).forEach(function (f) { files[f] = true; });
  var onDisk = Object.keys(files).filter(function (f) { return f.indexOf('/') < 0 && MAP_RE.test(f); });
  var names = {};
  var listed = [];
  if (files['interneuron.json']) {
    var meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(target, 'interneuron.json'), 'utf8')); }
    catch (e) { findings.push({ level: 'ERROR', file: 'interneuron.json', text: 'is not JSON: ' + e.message }); }
    if (meta && typeof meta.name !== 'string') findings.push({ level: 'WARN', file: 'interneuron.json', text: 'no "name": the project takes the folder\'s' });
    if (meta && !Array.isArray(meta.maps)) findings.push({ level: 'ERROR', file: 'interneuron.json', text: '"maps" must be a list of {file, name}' });
    ((meta && Array.isArray(meta.maps) && meta.maps) || []).forEach(function (m) {
      if (!m || typeof m.file !== 'string' || onDisk.indexOf(m.file) < 0) {
        findings.push({ level: 'ERROR', file: 'interneuron.json', text: 'lists the map "' + (m && m.file) + '", which is not in the folder' });
        return;
      }
      listed.push(m.file);
      if (typeof m.name === 'string' && m.name) names[m.file] = m.name;
      else findings.push({ level: 'WARN', file: 'interneuron.json', text: '"' + m.file + '" has no "name": it takes the file\'s' });
    });
    onDisk.forEach(function (f) {
      if (listed.indexOf(f) < 0) findings.push({ level: 'WARN', file: 'interneuron.json', text: 'does not list "' + f + '": it goes last, named after its file' });
    });
  } else if (onDisk.length > 1) {
    findings.push({ level: 'WARN', file: path.basename(target), text: 'no interneuron.json: the maps are named after their files, so [[links]] must use the file names' });
  }
  var order = listed.concat(onDisk.filter(function (f) { return listed.indexOf(f) < 0; }));
  var seen = {};
  var maps = order.map(function (f) {
    var name = names[f] || f.replace(MAP_RE, '');
    var lower = f.toLowerCase();
    if (seen[lower]) findings.push({ level: 'ERROR', file: f, text: 'same file name as "' + seen[lower] + '" but for the capitals' });
    seen[lower] = f;
    if (names[f] && f.replace(MAP_RE, '') !== (slugify(name) || 'map')) {
      findings.push({ level: 'WARN', file: f, text: 'MindRoot would name the file of "' + name + '" ' + (slugify(name) || 'map') + '.md' });
    }
    return { file: f, name: name, text: fs.readFileSync(path.join(target, f), 'utf8') };
  });
  return { maps: maps, files: files, findings: findings };
}

function isUrl(p) { return /^[a-z][a-z0-9+.-]*:/i.test(p) || p.indexOf('//') === 0; }

function inProject(files, ref) {
  var p = ref.replace(/[?#].*$/, '').replace(/^\.\//, '');
  if (files[p]) return true;
  try { return !!files[decodeURIComponent(p)]; } catch (e) { return false; }
}

function checkMap(doc, map, project, out) {
  function add(level, line, text) { out.push({ level: level, file: map.file, line: line, text: text }); }
  var state = doc.parse(map.text);
  var flat = state.flat || [];
  if (!flat.length) { add('ERROR', 0, 'no node: a map starts with "# " and its central title'); return { nodes: 0, ids: {} }; }
  if (state.synthetic) add('WARN', flat[0].start + 1, 'several top-level nodes: keep one "# " heading, the central title, and hang the rest from it');
  else if (flat[0].kind !== 'heading' || flat[0].level !== 1) add('WARN', flat[0].start + 1, 'the central node should be a "# " heading');
  if (flat.length > MAX_NODES) add('WARN', 0, flat.length + ' nodes: split the larger branches into maps of their own');

  var owned = {};
  flat.forEach(function (e) {
    if (e.body) owned[e.body.line] = true;
    Object.keys(e.notes || {}).forEach(function (k) { if (e.notes[k]) owned[e.notes[k].line] = true; });
    var title = String(e.title || '');
    if (/(^|[^\\])<!--/.test(title)) add('ERROR', e.start + 1, 'a comment that is not a marker at the end of the line: it stays in the title ("' + title.slice(0, 60) + '")');
    var words = doc.inlineText ? String(doc.inlineText(title) || '') : title;
    var count = words.trim() ? words.trim().split(/\s+/).length : 0;
    if (count > MAX_WORDS) add('WARN', e.start + 1, 'title of ' + count + ' words: keep it to 8 and put the rest in a "- > text:" under it');
  });
  var kinds = state.kinds || {};
  (state.lines || []).forEach(function (line, i) {
    if (kinds[i] === K_NOTE && NOTE_RE.test(line) && !owned[i]) {
      add('ERROR', i + 1, 'a second "' + NOTE_RE.exec(line)[1].toLowerCase() + '" on the same node is ignored: join it with the first');
    } else if (kinds[i] === K_TEXT && /^[ \t]*>/.test(line)) {
      add('WARN', i + 1, 'a quoted line that belongs to no "- > text:" or "- > note:": indent it under the words of that bullet');
    }
  });

  doc.imageRefs(state).forEach(function (ref) {
    if (isUrl(ref)) return;
    if (!project.files) add('WARN', 0, 'the picture "' + ref + '" does not travel with a single .md file');
    else if (!inProject(project.files, ref)) add('ERROR', 0, 'the picture "' + ref + '" is not in the project');
  });
  return { nodes: flat.length, ids: doc.idsOf(state), refs: doc.wikiRefs(map.text), state: state };
}

function lineOfPath(read, p) {
  var e = read.state && read.state.byPath && read.state.byPath[p];
  return e ? e.start + 1 : 0;
}

function check(target) {
  var doc = loadParser();
  if (!doc) return { code: 2, lines: ['MINDROOT CHECK DID NOT RUN: MindRoot\'s parser (js/model/doc.js) was not found. Set MINDROOT_DOC to its path, or put a copy named doc.js beside validate.js.'] };
  if (!target || !fs.existsSync(target)) return { code: 2, lines: ['usage: node validate.js <project folder or map.md>'] };
  var project = collect(target);
  if (!project.maps.length) return { code: 2, lines: ['MINDROOT CHECK DID NOT RUN: no .md map in ' + target] };
  var out = project.findings.slice();
  var reads = project.maps.map(function (m) { return checkMap(doc, m, project, out); });
  var byName = {};
  project.maps.forEach(function (m, i) { if (!(nameKey(m.name) in byName)) byName[nameKey(m.name)] = i; });
  project.maps.forEach(function (m, i) {
    (reads[i].refs || []).forEach(function (r) {
      var line = lineOfPath(reads[i], r.path);
      var to = r.name ? byName[nameKey(r.name)] : i;
      if (to === undefined) {
        if (project.files) out.push({ level: 'ERROR', file: m.file, line: line, text: '[[' + r.name + ']] names no map of the project' });
        return;
      }
      if (r.node && !(r.node in reads[to].ids)) {
        out.push({ level: 'ERROR', file: m.file, line: line, text: '[[' + r.name + '#' + r.node + ']]: no node of "' + project.maps[to].name + '" carries <!-- id: ' + r.node + ' -->' });
      }
    });
  });
  var lines = out.map(function (f) {
    return (f.level === 'ERROR' ? 'ERROR ' : 'WARN  ') + f.file + (f.line ? ':' + f.line : '') + ' ' + f.text;
  });
  var errors = out.filter(function (f) { return f.level === 'ERROR'; }).length;
  var nodes = reads.reduce(function (n, r) { return n + r.nodes; }, 0);
  var warns = out.length - errors;
  if (errors) lines.push('MINDROOT INVALID (' + errors + (errors === 1 ? ' error' : ' errors') + ')');
  else lines.push('MINDROOT OK (' + project.maps.length + (project.maps.length === 1 ? ' map, ' : ' maps, ') + nodes + ' nodes' + (warns ? ', ' + warns + (warns === 1 ? ' warning' : ' warnings') : '') + ')');
  return { code: errors ? 1 : 0, lines: lines };
}

module.exports = { check: check, slugify: slugify };

if (require.main === module) {
  var result = check(process.argv[2]);
  console.log(result.lines.join('\n'));
  process.exit(result.code);
}
