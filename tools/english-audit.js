#!/usr/bin/env node
/* MindRoot - the English audit: English is the language of the project.
 *
 *     node tools/english-audit.js    prints "ENGLISH AUDIT OK (n files, controls caught: k/k)"
 *                                     and exits 0, or lists every finding and exits 1
 *
 * The app, its docs, its tests and its tools are written in English; Italian
 * is a second language a person can choose, so it lives only in the Italian
 * dictionaries (the `it: { ... }` table each module hands to ns.i18n.add) and
 * in README.it.md. This reads every text file of the project and refuses a
 * common Italian word anywhere else (whole words, any case: the list is
 * WORDS below, Italian words that are not English ones), and a variable
 * declared with an Italian name (WORDS, plus the IDENTS that are English
 * words too, such as 'due', so caught only as a name: `var due`).
 * Four things are not findings:
 *
 *   - a quoted string or regular expression in a test that is Italian on
 *     purpose: one that matches an Italian dictionary string (placeholders
 *     standing for anything), or a piece of one at least two words long,
 *     which is a test checking the translation (a single short word such as
 *     'una' sits inside many Italian strings and proves nothing);
 *   - a quoted string in a test that is a name out of the frozen older
 *     exports ('Uno', 'Navigli'): a test reading a real old export back;
 *   - the suite in ITALIAN_SUITES, which tests the translation machinery
 *     itself with an Italian table of its own;
 *   - the folder name '<map>-lavagna.book' that boards made by earlier
 *     versions still carry (the board marker names it, so they keep working).
 *
 * Left out of the reading: the frozen older exports
 * (test/fixtures/data/old-exports.js, real files of the old app),
 * dist/ and test/out/ (built), and the code in vendor/ (third-party); the
 * Markdown pages in vendor/ are read, since they ship with the app.
 *
 * As in the static audit, the rule is first run over planted controls in
 * memory: an Italian word in a comment, in English test data, in an English
 * dictionary and as a variable name must be caught, and so must a single
 * Italian word that only sits inside a dictionary string; the same word in
 * an Italian dictionary, in a test checking the translation, in a name out
 * of an old export and in the legacy folder name must not.
 * Node built-ins only. */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

var WORDS = ['della', 'delle', 'nella', 'sono', 'questo', 'questa', 'lavagna', 'annulla', 'elimina',
  'nuova', 'nuovo', 'mappa', 'progetto', 'cestino', 'salvato',
  'fuori', 'una', 'uno', 'sotto', 'capitolo', 'liste', 'lavoro', 'appunti', 'perché', 'anche', 'già',
  'più', 'così', 'quando', 'ogni', 'senza', 'dopo', 'impostazioni', 'immagini', 'progetti', 'aggiungi',
  'chiudi', 'esporta', 'cosa', 'navigli', 'spostato'];
/* Italian names that are also English words, caught only as variable names. */
var IDENTS = ['due', 'tre', 'nome', 'testo'];
/* Unicode-aware whole words: 'mapPart' and 'onMapPaste' are not 'mappa'. */
var WORD_RE = new RegExp('(?<![\\p{L}\\p{N}_])(' + WORDS.join('|') + ')(?![\\p{L}\\p{N}_])', 'iu');
/* A variable declared with an Italian name, also one of the IDENTS. */
var IDENT_RE = new RegExp('\\b(?:var|let|const)\\s+(' + WORDS.concat(IDENTS).join('|') + ')(?![\\p{L}\\p{N}_$])', 'iu');
var LEGACY_RE = /-lavagna\.book/gi;

var SKIP_DIRS = ['.git', 'node_modules', 'dist', 'vendor', 'test/out'];
var LEGACY_EXPORTS = 'test/fixtures/data/old-exports.js';
var SKIP_FILES = ['README.it.md', LEGACY_EXPORTS];
/* Suites about the translation machinery, with Italian of their own. */
var ITALIAN_SUITES = {
  'test/unit/core-i18n.test.js': 'tests ns.i18n with an Italian table of its own'
};
var TEXT = /\.(js|css|html|md|json|webmanifest|txt)$/;

/* ---------------------------------------------------------------- the reading */

/* The lines of a file with its Italian dictionaries blanked: from a line
 * `<indent>it: {` to the `}` at the same indent, or the one line when the
 * table closes on it. Returns { lines, italian: [strings in those tables] }. */
function split(text, isJs) {
  var lines = text.split('\n');
  var italian = [];
  if (!isJs) return { lines: lines, italian: italian };
  var end = null;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (end) {
      collect(l, italian);
      if (end.test(l)) end = null;
      lines[i] = '';
      continue;
    }
    var m = /^(\s*)it:\s*\{/.exec(l);
    if (m) {
      collect(l, italian);
      if (!/\}\s*\)?\s*;?\s*,?\s*$/.test(l)) end = new RegExp('^' + m[1] + '\\}');
      lines[i] = '';
    }
  }
  return { lines: lines, italian: italian };
}

var QUOTED = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/(?:[^/\\\n*]|\\.)(?:[^/\\\n]|\\.)*\/[a-z]*/g;

function unquote(q) {
  var body = q[0] === '/' ? q.slice(1, q.lastIndexOf('/')) : q.slice(1, -1);
  return body.replace(/\\([nrt])/g, '\n').replace(/\\(.)/g, '$1').replace(/^\^|\$$/g, '');
}

/* The values of an `it` table line (keys are dotted English ids and never
 * hold the words looked for, so taking every string is enough). */
function collect(line, out) {
  var m = line.match(QUOTED);
  if (m) m.forEach(function (q) { if (q[0] !== '/') out.push(unquote(q)); });
}

/* A pattern for each Italian string: placeholders stand for anything, and
 * each is a group, so what fills them can be read. */
function patterns(italian) {
  return italian.map(function (s) {
    var src = s.split(/\{\w+\}/).map(function (part) { return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('([\\s\\S]*?)');
    return new RegExp('^' + src + '$', 'i');
  });
}

/* Is this quoted string a check of the Italian translation? It is when it
 * is an Italian dictionary string (its placeholders filled in any way) or a
 * piece of one at least two words long: a single short word such as 'una'
 * sits inside many Italian strings and proves nothing. */
function isTranslation(str, pats, italian) {
  var low = str.toLowerCase().trim();
  var phrase = /\S\s+\S/.test(low);
  for (var i = 0; i < pats.length; i++) {
    /* The Italian words must be the dictionary's own, not what fills its
     * placeholders: '{name}, {nodes}' is no licence for any line with a comma. */
    var m = pats[i].exec(str);
    if (m && !m.slice(1).some(function (filled) { return WORD_RE.test(filled); })) return true;
    if (phrase && italian[i].toLowerCase().indexOf(low) >= 0) return true;
  }
  return false;
}

/* A quoted string that checks Italian may hold more than one string: a
 * selector naming an Italian label ('[aria-label="Elimina"]'), a list
 * ('Mappa,Lavagna'), a line of Markdown ('# Nuova mappa\n'). It is a check when every piece left holding an
 * Italian word is a translation. */
function italianCheck(str, pats, italian, legacy) {
  if (isTranslation(str, pats, italian) || isLegacy(str, legacy)) return true;
  var left = str.split(/[,:|"()[\]=#\n]+/).filter(function (piece) {
    piece = piece.trim().replace(/^[-*+>]\s+/, '');
    return piece && !isTranslation(piece, pats, italian) && !isLegacy(piece, legacy);
  }).join(' ');
  return !WORD_RE.test(left);
}

/* Is this quoted string a name out of the frozen older exports? A test
 * that reads a real old export back checks the names that export carries
 * ('Uno', 'Navigli'). */
function isLegacy(str, legacy) {
  return !!legacy && str.trim().length >= 2 && legacy.indexOf(str.trim()) >= 0;
}

function audit(files, italian, legacy) {
  var pats = patterns(italian);
  var findings = [];
  files.forEach(function (f) {
    if (ITALIAN_SUITES[f.rel]) return;
    var isTest = /^test\//.test(f.rel);
    f.lines.forEach(function (line, i) {
      var clean = line.replace(LEGACY_RE, '');
      var ident = IDENT_RE.exec(clean.replace(QUOTED, "''"));
      if (ident) {
        findings.push(f.rel + ':' + (i + 1) + ': variable ' + ident[1] + ': ' + line.trim().slice(0, 160));
        return;
      }
      if (!WORD_RE.test(clean)) return;
      if (isTest && /\.js$/.test(f.rel)) {
        /* Every hit on the line must sit inside an Italian check. */
        var rest = clean.replace(QUOTED, function (q) { return italianCheck(unquote(q), pats, italian, legacy) ? '' : q; });
        if (!WORD_RE.test(rest)) return;
      }
      findings.push(f.rel + ':' + (i + 1) + ': ' + WORD_RE.exec(clean)[1] + ': ' + line.trim().slice(0, 160));
    });
  });
  return findings;
}

function walk(dir, out) {
  fs.readdirSync(dir).forEach(function (name) {
    var full = path.join(dir, name);
    var rel = path.relative(ROOT, full).split(path.sep).join('/');
    var st = fs.statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.indexOf(rel) < 0 && SKIP_DIRS.indexOf(name) < 0) walk(full, out);
      else if (rel === 'vendor') walkDocs(full, out);
    } else if (TEXT.test(name) && SKIP_FILES.indexOf(rel) < 0 && rel !== 'tools/english-audit.js') {
      out.push(rel);
    }
  });
  return out;
}

/* Only the Markdown pages of a third-party folder. */
function walkDocs(dir, out) {
  fs.readdirSync(dir).forEach(function (name) {
    var full = path.join(dir, name);
    if (/\.md$/.test(name) && fs.statSync(full).isFile()) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  });
  return out;
}

function read(entries) {
  var italian = [];
  var files = entries.map(function (e) {
    var parts = split(e.text, /\.js$/.test(e.rel));
    italian.push.apply(italian, parts.italian);
    return { rel: e.rel, lines: parts.lines };
  });
  return { files: files, italian: italian };
}

/* ---------------------------------------------------------------- the controls */

var DICT = "  ns.i18n.add({\n    en: { 'x.undo': 'Undo', 'x.del': 'Delete the map' },\n    it: {\n      'x.undo': 'Annulla',\n      'x.del': 'Elimina la mappa {name}',\n      'x.one': 'Apri una mappa',\n      'x.pair': '{name}, {nodes}'\n    }\n  });\n";
var OLD_EXPORT = '{"name": "Uno", "text": "# Città\\n\\n- Milano\\n  - Navigli\\n"}';
var CONTROLS = [
  { rel: 'js/c1.js', text: '/* The Annulla button. */\n' + DICT, caught: true, why: 'an Italian UI name in a comment' },
  { rel: 'js/c2.js', text: "  ns.i18n.add({\n    en: { 'x.new': 'Nuova mappa' },\n    it: { 'x.new': 'Nuova mappa' }\n  });\n", caught: true, why: 'Italian in the English dictionary' },
  { rel: 'test/e2e/c3.e2e.js', text: "await type('# Orto della nonna');\n", caught: true, why: 'Italian test data' },
  { rel: 'docs/C4.md', text: 'The switch Mappa | Board.\n', caught: true, why: 'an Italian UI name in a doc' },
  { rel: 'test/e2e/c5.e2e.js', text: "t.eq(label, 'Annulla', 'the Italian undo');\nt.check('x', /Elimina la mappa Orto/.test(s));\nawait tap('[aria-label=\"Annulla\"]');\n", caught: false, why: 'a test checking the Italian strings' },
  { rel: 'test/e2e/c9.e2e.js', text: "t.eq(label, 'Annulla tutto il progetto', 'x');\n", caught: true, why: 'Italian that is no dictionary string' },
  { rel: 'js/c6.js', text: DICT, caught: false, why: 'the Italian dictionary itself' },
  { rel: 'test/unit/c7.test.js', text: "var old = 'assets/garden-lavagna.book';\n", caught: false, why: 'the legacy board folder name' },
  { rel: 'js/c8.js', text: 'var mapPart = onMapPaste;\n', caught: false, why: 'a word that only contains one' },
  { rel: 'test/unit/c10.test.js', text: "var due = path('b');\n", caught: true, why: 'an Italian variable name' },
  { rel: 'test/unit/c11.test.js', text: "t.eq(lineage, ['Una'], 'x');\n", caught: true, why: 'a short Italian word that only sits inside a dictionary string' },
  { rel: 'test/e2e/c13.e2e.js', text: "t.same(names, ['Uno', 'Navigli'], 'the old export');\n", caught: false, why: 'names out of the frozen older exports' },
  { rel: 'test/e2e/c14.e2e.js', text: "t.same(names, ['Uno lavoro'], 'x');\n", caught: true, why: 'Italian that is in no old export' },
  { rel: 'test/unit/c15.test.js', text: "T.eq(text, '# R\\n\\n- Apri una mappa\\n', 'x');\n", caught: false, why: 'a translation inside a Markdown list line' },
  { rel: 'test/unit/c16.test.js', text: "var s = 'Piano, Orto della nonna';\n", caught: true, why: 'Italian filling the placeholders of a dictionary string' },
  { rel: 'test/unit/c17.test.js', text: "T.eq(msg, 'Elimina la mappa Orto', 'x');\n", caught: false, why: 'a dictionary string with its placeholder filled' },
  { rel: 'test/unit/c12.test.js', text: "var dueDate = 1; // the due date\n", caught: false, why: 'the English word that is also an Italian name' }
];

function controls() {
  var bad = [];
  CONTROLS.forEach(function (c) {
    var r = read([{ rel: c.rel, text: c.text }].concat([{ rel: 'js/dict.js', text: DICT }]));
    var hits = audit(r.files.filter(function (f) { return f.rel === c.rel; }), r.italian, OLD_EXPORT);
    if ((hits.length > 0) !== c.caught) bad.push((c.caught ? 'missed: ' : 'false alarm: ') + c.why + (hits.length ? ' (' + hits.join('; ') + ')' : ''));
  });
  return bad;
}

/* ---------------------------------------------------------------- main */

function main() {
  var bad = controls();
  if (bad.length) {
    console.log('ENGLISH AUDIT BROKEN: the controls did not behave');
    bad.forEach(function (b) { console.log('  ' + b); });
    process.exit(1);
  }
  var rels = walk(ROOT, []);
  var r = read(rels.map(function (rel) { return { rel: rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }; }));
  var findings = audit(r.files, r.italian, fs.readFileSync(path.join(ROOT, LEGACY_EXPORTS), 'utf8'));
  if (findings.length) {
    console.log('ENGLISH AUDIT FAILED (' + findings.length + ')');
    findings.forEach(function (f) { console.log('  ' + f); });
    process.exit(1);
  }
  console.log('ENGLISH AUDIT OK (' + rels.length + ' files, controls caught: ' + CONTROLS.length + '/' + CONTROLS.length + ')');
}

main();
