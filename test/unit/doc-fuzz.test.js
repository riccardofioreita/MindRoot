/* MindRoot - random edit sequences over real sample maps, each edit checked
 * against what it promises: the file stays lossless and re-parses, an edit
 * touches only the lines it is about, nodes are neither lost nor invented,
 * and the view always matches the parse. Then the same on generated maps
 * with every node's words its own, so each node can be followed and its
 * parent, its text, its notes and its checkbox checked after every edit.
 * Seeded, so a failure names the seed and step that reproduce it. Then the
 * performance budget on a 5,000-line map. */
(function () {
  'use strict';

  var D = window.DocT;
  var doc = D.doc;
  var S = window.DocSamples;

  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var TITLES = ['plain', 'Two words', '# h', '- d', '* s', '+ p', '> note: q', '1. n', '2) m', '[ ] t', '[x] done',
    '**b** and _i_', '<u>u</u>', '`c`', '<!-- color: #fff -->', 'x <!-- title: h2 -->', '```', '~~~', '***', '---',
    'Issue #', '#', '-', '[l](https://x.y)', '[[Map]]', 'a | b', 'tab\there', 'line\nbreak', 'àè 中文 🙂',
    'end \\', '<script>x</script>', '2019. year', 'C#', '<!--', 'a <!-- x --> b', '&amp; &lt;'];
  var NOTES = ['a note', 'two\nlines', '', '> quoted', '- > note: nested', 'x <!-- role: caption -->', '  spaced  out  '];
  var PICS = ['assets/a.png', 'assets/b c.png', 'assets/d.ink.svg', 'assets/e.excalidraw.svg', 'assets/%28x%29.png'];
  var COLORS = ['#2f7d5a', '#abc', null, 'red', '#C2703D'];

  function pick(r, list) { return list[Math.floor(r() * list.length)]; }

  function shown(state) {
    return state.flat.map(function (e) { return doc.plainText(e); }).sort();
  }

  function sameList(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function minus(all, gone) {
    var out = all.slice();
    gone.forEach(function (x) { var at = out.indexOf(x); if (at >= 0) out.splice(at, 1); });
    return out;
  }

  /* The first and last line an edit changed, as [from, oldTo) in the old
   * lines: everything before and after is byte for byte the same. */
  function changedRange(a, b) {
    var from = 0;
    while (from < a.length && from < b.length && a[from] === b[from]) from++;
    var ea = a.length;
    var eb = b.length;
    while (ea > from && eb > from && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    return { from: from, to: ea, newTo: eb };
  }

  /* Whether an edit stayed inside the block of `e`: a change of lines within
   * it, or an insertion anywhere from its first line to the blank lines that
   * follow it (an insertion among identical blank lines has no one place). */
  function inBlock(a, b, e) {
    var c = changedRange(a, b);
    if (c.to > c.from) return c.from >= e.start && c.to <= e.subEnd;
    /* A pure insertion: inserted lines equal to their neighbours make every
     * place between the leftmost and the rightmost reading the same edit. */
    var ea = a.length;
    var eb = b.length;
    while (ea > 0 && eb > 0 && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    var leftmost = 0;
    while (leftmost < ea && a[leftmost] === b[leftmost]) leftmost++;
    var limit = e.subEnd;
    while (limit < a.length && !a[limit].trim()) limit++;
    return leftmost <= limit && c.from >= e.start;
  }

  function nonBlank(lines) {
    return lines.filter(function (l) { return l.trim(); }).map(function (l) { return l.replace(/^(\s*)\d{1,9}([.)])\s*/, '$1#$2 '); });
  }

  /* What must hold for any document, whatever made it. */
  function checkState(state, text, where, problems) {
    if (state.text !== doc.normalizeText(text)) problems.push(where + ': text not kept');
    if (state.lines.join('\n') !== state.text) problems.push(where + ': lines do not join back');
    var last = -1;
    for (var i = 0; i < state.flat.length; i++) {
      var e = state.flat[i];
      if (e.start <= last) problems.push(where + ': flat out of order at ' + e.path);
      last = e.start;
      if (!(e.subEnd > e.start && e.subEnd <= state.lines.length)) problems.push(where + ': bad block ' + e.path);
      if (state.byPath[e.path] !== e) problems.push(where + ': byPath ' + e.path);
      var pp = doc.parentPath(e.path);
      var parent = pp === null ? null : state.byPath[pp];
      if (parent && (e.start < parent.start || e.subEnd > parent.subEnd)) problems.push(where + ': block outside parent ' + e.path);
    }
    var view = doc.viewTree(state);
    var count = 0;
    (function walk(v) { if (!v.synthetic) count++; v.children.forEach(walk); })(view || { synthetic: true, children: [] });
    if (count !== state.flat.length) problems.push(where + ': view has ' + count + ' nodes, parse ' + state.flat.length);
    try { JSON.stringify(view); } catch (err) { problems.push(where + ': view not plain data'); }
  }

  var OPS = [
    function rename(st, e, r) {
      var title = pick(r, TITLES);
      var clean = doc.sanitizeInline(title);
      return {
        res: doc.rename(st, e.path, title),
        check: function (next, res, fail) {
          var c = changedRange(st.lines, next.lines);
          if (c.to - c.from > 1 || c.newTo - c.from > 1 || (c.to > c.from && c.from !== e.start)) fail('changed more than its line');
          if (shown(next).length !== st.flat.length) fail('node count changed');
          var again = next.byPath[e.path];
          if (!again) return fail('node gone');
          if (doc.titleFor(next, e.path) !== clean) fail('titleFor ' + JSON.stringify(doc.titleFor(next, e.path)) + ' for ' + JSON.stringify(clean));
          if (doc.rename(next, e.path, doc.titleFor(next, e.path)) !== null) fail('rename of its own title is not a no-op');
          if (again.color !== e.color || again.titleSize !== e.titleSize || again.task !== e.task) fail('markers or box lost');
        },
        skip: !clean
      };
    },
    function color(st, e, r) {
      var c = pick(r, COLORS);
      return {
        res: doc.setColor(st, e.path, c, { branch: r() < 0.5 }),
        check: function (next, res, fail) {
          var d = changedRange(st.lines, next.lines);
          if (d.to - d.from > 1 || d.newTo - d.from > 1) fail('changed more than its line');
          if (next.byPath[e.path].color !== doc.normalizeHex(c)) fail('colour not written');
          if (doc.labelOf(next.byPath[e.path]) !== doc.labelOf(e)) fail('words changed');
        }
      };
    },
    function size(st, e, r) {
      var v = pick(r, ['h1', 'h4', null, 'caption']);
      var res = v === 'caption' ? doc.setRole(st, e.path, 'caption') : doc.setTitleSize(st, e.path, v);
      return {
        res: res,
        check: function (next, out, fail) {
          var d = changedRange(st.lines, next.lines);
          if (d.to - d.from > 1 || d.newTo - d.from > 1) fail('changed more than its line');
          if (next.byPath[e.path].color !== e.color) fail('colour lost');
        }
      };
    },
    function task(st, e, r) {
      var res = r() < 0.5 ? doc.toggleTask(st, e.path) : doc.setTask(st, e.path, r() < 0.5);
      return {
        res: res,
        check: function (next, out, fail) {
          var d = changedRange(st.lines, next.lines);
          if (d.to - d.from > 1 || d.newTo - d.from > 1) fail('changed more than its line');
          if (doc.labelOf(next.byPath[e.path]) !== doc.labelOf(e)) fail('words changed');
        }
      };
    },
    function note(st, e, r) {
      var kind = pick(r, ['node', 'edge', 'body']);
      var text = pick(r, NOTES);
      var res = kind === 'body' && r() < 0.5 ? doc.setBody(st, e.path, text) : doc.setNote(st, e.path, kind, text);
      return {
        res: res,
        check: function (next, out, fail) {
          if (!sameList(shown(next), shown(st))) fail('nodes changed');
          if (!inBlock(st.lines, next.lines, e) || changedRange(st.lines, next.lines).from <= e.start) fail('changed outside its block');
          var clean = doc.sanitizeNote(text);
          if (kind === 'body') {
            if (doc.bodyFor(next, e.path) !== clean) fail('body ' + JSON.stringify(doc.bodyFor(next, e.path)));
          } else {
            var n = doc.noteFor(next, e.path, kind);
            if ((n ? n.text : '') !== clean) fail('note ' + JSON.stringify(n && n.text));
          }
        }
      };
    },
    function child(st, e, r) {
      var title = pick(r, TITLES);
      var clean = doc.sanitizeInline(title) || 'untitled';
      var res = r() < 0.5 ? doc.addChild(st, e.path, title, r() < 0.3 ? 'bullet' : undefined) : doc.addSibling(st, e.path, title);
      return {
        res: res,
        check: function (next, out, fail) {
          if (next.flat.length !== st.flat.length + 1) fail('not exactly one node more');
          var made = next.flat.filter(function (x) { return x.start === out.anchorLine; })[0];
          if (!made) return fail('the anchor is not the new node');
          if (doc.titleFor(next, made.path) !== clean) fail('new title ' + JSON.stringify(doc.titleFor(next, made.path)));
          if (!sameList(minus(shown(next), [doc.plainText(made)]), shown(st))) fail('other nodes changed');
          if (!inBlock(st.lines, next.lines, e)) fail('changed outside its block');
        }
      };
    },
    function remove(st, e) {
      var gone = st.flat.filter(function (x) { return x === e || doc.parentPath(x.path) !== null && (x.path.indexOf(e.path + '.') === 0 || e.path === ''); })
        .map(function (x) { return doc.plainText(x); });
      return {
        res: doc.remove(st, e.path),
        check: function (next, out, fail) {
          if (!sameList(shown(next), minus(shown(st), gone))) fail('not exactly the subtree went');
          var kept = st.lines.slice(0, e.start).concat(st.lines.slice(e.subEnd));
          if (!sameList(nonBlank(next.lines), nonBlank(kept))) fail('other lines changed');
        }
      };
    },
    function move(st, e, r) {
      var res = r() < 0.5 ? doc.move(st, e.path, r() < 0.5 ? -1 : 1) : (r() < 0.5 ? doc.indent(st, e.path) : doc.outdent(st, e.path));
      return {
        res: res,
        check: function (next, out, fail) {
          if (!sameList(shown(next), shown(st))) fail('nodes gained or lost');
          var at = next.flat.filter(function (x) { return x.start === out.anchorLine; })[0];
          if (!at || doc.plainText(at) !== doc.plainText(e)) fail('the anchor is not the moved node');
        }
      };
    },
    function drop(st, e, r) {
      var target = pick(r, st.flat);
      var where = pick(r, ['child', 'before', 'after']);
      return {
        res: doc.moveTo(st, e.path, target.path, where),
        check: function (next, out, fail) {
          if (!sameList(shown(next), shown(st))) fail('nodes gained or lost (' + where + ' ' + target.path + ')');
          var moved = next.byPath[out.selectPath];
          if (!moved || doc.plainText(moved) !== doc.plainText(e)) fail('selectPath is not the moved node');
          if (doc.canMoveTo(st, e.path, target.path, where) !== true) fail('canMoveTo disagrees');
        }
      };
    },
    function trash(st, e) {
      var taken = doc.extractBranch(st, e.path);
      var cut = doc.parse(doc.remove(st, e.path).text);
      var place = doc.placeFor(cut, taken.origin);
      return {
        res: doc.insertBranch(cut, place.parent, place.index, taken.fragment),
        check: function (next, out, fail) {
          if (!sameList(shown(next), shown(st))) fail('the branch did not come back whole');
          /* Back where it was: same path, same words, same shape. (Byte
           * identity is the trash suite's golden check; here the parent can
           * own text whose place relative to a re-created list is free.) */
          var back = next.byPath[e.path];
          if (place.where === 'same' && (!back || doc.labelOf(back) !== doc.labelOf(e) || back.kind !== e.kind)) fail('not back in place');
        }
      };
    },
    function picture(st, e, r) {
      var field = r() < 0.5 ? 'line' : 'body';
      var kind = r() < 0.5 ? doc.PHOTO : doc.DRAW;
      var what = r();
      var res = what < 0.4 ? doc.addImage(st, e.path, pick(r, PICS), pick(r, ['', 'alt', 'a]b']), field)
        : what < 0.7 ? doc.removeImage(st, e.path, field, kind)
          : doc.setImagePosition(st, e.path, pick(r, ['left', 'right', 'above']), field, kind);
      return {
        res: res,
        check: function (next, out, fail) {
          if (next.flat.length !== st.flat.length) fail('node count changed');
          if (!inBlock(st.lines, next.lines, e)) fail('changed outside its block');
        }
      };
    }
  ];

  function fuzz(name, text, seed, steps, problems) {
    var r = rng(seed);
    var state = doc.parse(text);
    checkState(state, text, name + ' start', problems);
    for (var step = 0; step < steps && problems.length < 10; step++) {
      if (!state.flat.length) state = doc.parse(text);
      var op = pick(r, OPS);
      var e = pick(r, state.flat);
      var where = name + ' seed ' + seed + ' step ' + step + ' ' + op.name + ' ' + e.path;
      var made;
      try { made = op(state, e, r); } catch (err) { problems.push(where + ' threw ' + err.message); break; }
      if (made.skip || made.res == null) continue;
      if (typeof made.res.text !== 'string') { problems.push(where + ': no text'); continue; }
      var next;
      try { next = doc.parse(made.res.text); } catch (err2) { problems.push(where + ': re-parse threw ' + err2.message); break; }
      checkState(next, made.res.text, where, problems);
      if (made.res.anchorLine != null && !(made.res.anchorLine >= 0 && made.res.anchorLine < next.lines.length)) problems.push(where + ': anchor out of range');
      try {
        made.check(next, made.res, function (msg) { problems.push(where + ': ' + msg + '\n' + JSON.stringify(state.text) + '\n=> ' + JSON.stringify(made.res.text)); });
      } catch (err3) { problems.push(where + ': check threw ' + err3.message); }
      state = next;
    }
  }

  T.test('random edit sequences on every sample', function () {
    var names = Object.keys(S);
    names.forEach(function (name, i) {
      for (var round = 0; round < 3; round++) {
        var problems = [];
        var seed = 1000 + i * 97 + round;
        fuzz(name, S[name], seed, 160, problems);
        T.same(problems, [], name + ' seed ' + seed);
      }
    });
  });

  T.test('random edits on hand-written oddities', function () {
    var odd = [
      '\ufeff# R\r\n\r\n- a\r\n\t- tab child\r\n-   wide gap\r\n* star\r\n+ plus\r\n',
      '# R\n- a\nlazy line\n  - b\n\n    indented para of b\n\n> quote\n- c\n',
      '# R\n\n1. one\n2. two\n   - x\n10) ten\n\n- after\n',
      '- only\n  - list\n- doc\n',
      '# A\n## B\n### C\n#### D\n##### E\n###### F\n- deep\n',
      '# R\n\n```\n- fenced\n# fenced\n```\n\n- real\n  ```\n  code in item\n  ```\n  - nested\n',
      '---\ntitle: t\n---\n<!-- board: assets/b.ink.svg -->\n\nintro\n\n# R\n- a <!-- markmap: fold -->\n  - b\n',
      '# R\n- [ ] task <!-- color: #abc branch -->\n  - > text: ![](assets/x.png) words <!-- draw: above -->\n  - > note: n\n- [x] done\n'
    ];
    odd.forEach(function (text, i) {
      var problems = [];
      fuzz('odd ' + i, text, 77 + i, 200, problems);
      T.same(problems, [], 'oddity ' + i);
    });
  });

  T.test('the inline string tools never break on random text', function () {
    var r = rng(4242);
    var alphabet = ['*', '**', '_', '~~', '==', '`', '<u>', '</u>', '[', ']', '(', ')', '![', 'a', 'b', ' ', '\\', '<', '>', '&', '#', '\n', '[[', ']]', 'https://x.y'];
    var problems = [];
    for (var k = 0; k < 600; k++) {
      var len = 1 + Math.floor(r() * 30);
      var text = '';
      for (var c = 0; c < len; c++) text += pick(r, alphabet);
      var a = Math.floor(r() * (text.length + 1));
      var b = Math.floor(r() * (text.length + 1));
      try {
        var html = doc.inlineHtml(text);
        var tpl = document.createElement('template');
        tpl.innerHTML = html;
        if (tpl.content.querySelector('script, img, iframe, [onerror], [onclick]')) problems.push('unsafe: ' + JSON.stringify(text));
        ['bold', 'italic', 'underline'].forEach(function (mark) {
          var t = doc.toggleMark(text, a, b, mark);
          if (!(t.start >= 0 && t.end <= t.text.length && t.start <= t.end)) problems.push('toggle range ' + JSON.stringify(text));
          var back = doc.toggleMark(t.text, t.start, t.end, mark);
          if (back.text.length > t.text.length + 8) problems.push('toggle grows ' + JSON.stringify(text));
        });
        var cl = doc.clearMarks(text, a, b);
        if (!(cl.start >= 0 && cl.end <= cl.text.length && cl.start <= cl.end)) problems.push('clear range ' + JSON.stringify(text));
        if (cl.text.length > text.length) problems.push('clear grew ' + JSON.stringify(text));
        doc.markState(text, a, b);
        doc.inlineText(text);
      } catch (err) {
        problems.push('threw on ' + JSON.stringify(text) + ': ' + err.message);
      }
      if (problems.length > 5) break;
    }
    T.same(problems, [], '600 random strings');
  });

  /* ---------- ownership: every node keeps its parent, its text, its notes ---------- */

  /* Each node by its words: its parent, the text drawn in its body, its
   * notes, its checkbox, its children in order. */
  function shapeOf(state) {
    var out = {};
    (function walk(v, parent) {
      if (!v) return;
      if (!v.synthetic) {
        out[v.text] = {
          parent: parent, body: v.body ? v.body.text : null, notes: JSON.stringify(v.notes),
          task: v.task ? v.task.checked : null, kids: v.children.map(function (c) { return c.text; })
        };
      }
      v.children.forEach(function (c) { walk(c, v.synthetic ? null : v.text); });
    })(doc.viewTree(state), null);
    return out;
  }

  function topOrder(state) {
    return state.flat.filter(function (e) { return e.parentIndex < 0; }).map(function (e) { return doc.plainText(e); });
  }

  /* One random structural edit and what it promises. */
  function ownershipStep(state, r, fresh) {
    var G = window.DocGenerate;
    var e = G.pick(r, state.flat);
    var label = doc.plainText(e);
    var before = shapeOf(state);
    var op = G.pick(r, ['moveTo', 'moveTo', 'trash', 'indent', 'outdent', 'move', 'child', 'sibling', 'remove', 'rename', 'note']);
    var rule = { what: op + ' ' + label };
    var res = null;
    if (op === 'moveTo') {
      var target = G.pick(r, state.flat);
      var how = G.pick(r, ['child', 'before', 'after']);
      var tl = doc.plainText(target);
      rule.what += ' ' + how + ' ' + tl;
      res = doc.moveTo(state, e.path, target.path, how);
      if (res && !doc.canMoveTo(state, e.path, target.path, how)) rule.fail = 'canMoveTo said no';
      rule.parent = function (k, p) { return k === label ? (how === 'child' ? tl : before[tl].parent) : p; };
      rule.order = how === 'child' ? null : { target: tl, how: how };
    } else if (op === 'trash') {
      var taken = doc.extractBranch(state, e.path);
      var cut = doc.parse(doc.remove(state, e.path).text);
      var place = doc.placeFor(cut, taken.origin);
      res = doc.insertBranch(cut, place.parent, place.index, taken.fragment);
      if (place.where !== 'same') rule.fail = 'restored to ' + place.where;
    } else if (op === 'indent') {
      var sibs = doc.siblingEntries(state, e);
      var prev = sibs[sibs.indexOf(e) - 1];
      res = doc.indent(state, e.path);
      rule.parent = function (k, p) { return k === label && prev ? doc.plainText(prev) : p; };
    } else if (op === 'outdent') {
      res = doc.outdent(state, e.path);
      var par = before[label].parent;
      var later = par ? before[par].kids.slice(before[par].kids.indexOf(label) + 1) : [];
      rule.parent = function (k, p) { return k === label ? (par ? before[par].parent : null) : (later.indexOf(k) >= 0 ? label : p); };
      /* What followed the node inside its parent is now under it, text too. */
      rule.free = function () { return true; };
    } else if (op === 'move') {
      res = doc.move(state, e.path, r() < 0.5 ? -1 : 1);
    } else if (op === 'child' || op === 'sibling') {
      var made = fresh();
      res = op === 'child' ? doc.addChild(state, e.path, made, r() < 0.3 ? 'bullet' : undefined) : doc.addSibling(state, e.path, made);
      rule.added = made;
      rule.parent = function (k, p) { return k === made ? (op === 'child' ? label : before[label].parent) : p; };
    } else if (op === 'remove') {
      res = doc.remove(state, e.path);
      rule.gone = {};
      (function mark(k) { rule.gone[k] = true; before[k].kids.forEach(mark); })(label);
    } else if (op === 'rename') {
      var words = doc.sanitizeInline(doc.bodyFor(state, e.path));
      var to = words && r() < 0.5 ? '' : fresh();
      res = doc.rename(state, e.path, to);
      rule.renamed = [label, to || words];
    } else {
      res = doc.setNote(state, e.path, G.pick(r, ['node', 'edge', 'body']), r() < 0.2 ? '' : 'w ' + fresh());
      rule.free = function (k) { return k === label; };
    }
    return { res: res, rule: rule, before: before, label: label };
  }

  function ownershipCheck(step, next, problems) {
    var rule = step.rule;
    var before = step.before;
    var after = shapeOf(next);
    if (rule.fail) problems.push(rule.what + ': ' + rule.fail);
    if (rule.renamed) {
      var from = rule.renamed[0];
      var to = rule.renamed[1];
      var renamed = {};
      Object.keys(before).forEach(function (k) {
        var v = JSON.parse(JSON.stringify(before[k]));
        if (v.parent === from) v.parent = to;
        renamed[k === from ? to : k] = v;
      });
      before = renamed;
      rule.free = function (k) { return k === to; };
    }
    var want = Object.keys(before).filter(function (k) { return !(rule.gone && rule.gone[k]); });
    if (rule.added) want.push(rule.added);
    if (JSON.stringify(want.sort()) !== JSON.stringify(Object.keys(after).sort())) {
      problems.push(rule.what + ': nodes ' + JSON.stringify(want) + ' became ' + JSON.stringify(Object.keys(after).sort()));
      return;
    }
    Object.keys(after).forEach(function (k) {
      if (!before[k]) {
        if (rule.parent && after[k].parent !== rule.parent(k, null)) problems.push(rule.what + ': new node under ' + after[k].parent);
        return;
      }
      var parent = rule.parent ? rule.parent(k, before[k].parent) : before[k].parent;
      if (after[k].parent !== parent) problems.push(rule.what + ': ' + k + ' under ' + after[k].parent + ', not ' + parent);
      if (rule.free && rule.free(k)) return;
      if (after[k].body !== before[k].body) problems.push(rule.what + ': text of ' + k + ' ' + JSON.stringify(before[k].body) + ' became ' + JSON.stringify(after[k].body));
      if (after[k].notes !== before[k].notes) problems.push(rule.what + ': notes of ' + k);
      if (after[k].task !== before[k].task) problems.push(rule.what + ': checkbox of ' + k);
    });
    if (rule.order) {
      var p = after[step.label].parent;
      var row = p ? after[p].kids : topOrder(next);
      var at = row.indexOf(step.label);
      var there = row.indexOf(rule.order.target);
      if (there >= 0 && at !== there + (rule.order.how === 'before' ? -1 : 1)) problems.push(rule.what + ': order ' + JSON.stringify(row));
    }
  }

  T.test('random maps: every edit keeps each node\'s parent, text, notes and checkbox', function () {
    var G = window.DocGenerate;
    var problems = [];
    var made = 0;
    function fresh() { return 'n' + (made++); }
    for (var seed = 1; seed <= 500 && problems.length < 6; seed++) {
      var r = G.rng(seed);
      var state = doc.parse(G.generate(r, fresh));
      for (var k = 0; k < 40 && problems.length < 6 && state.flat.length > 1; k++) {
        var step = ownershipStep(state, r, fresh);
        if (!step.res) continue;
        var next = doc.parse(step.res.text);
        var count = problems.length;
        ownershipCheck(step, next, problems);
        if (step.rule.added) {
          var anchored = doc.findByLine(next, step.res.anchorLine);
          if (!anchored || anchored.start !== step.res.anchorLine || doc.plainText(anchored) !== step.rule.added) problems.push(step.rule.what + ': the anchor is not the new node');
        }
        if (problems.length > count) problems.push('  seed ' + seed + ' step ' + k + '\n  ' + JSON.stringify(state.text) + '\n  => ' + JSON.stringify(step.res.text));
        state = next;
      }
    }
    T.same(problems, [], '500 maps x 40 edits');
  });

  /* ---------- performance ---------- */

  function median(fn, runs) {
    var times = [];
    for (var k = 0; k < runs; k++) {
      var t0 = performance.now();
      fn();
      times.push(performance.now() - t0);
    }
    times.sort(function (x, y) { return x - y; });
    return times[Math.floor(runs / 2)];
  }

  T.test('a 5,000-line map: parse under 50 ms, viewTree under 30 ms', function () {
    var text = window.DocBigMap(5000);
    T.eq(text.split('\n').length, 5001, '5,000 lines');
    var state = doc.parse(text);
    T.ok(state.flat.length > 3500, state.flat.length + ' nodes');
    doc.viewTree(state);
    doc.parse(text);
    var parseMs = median(function () { state = doc.parse(text); }, 9);
    var viewMs = median(function () { doc.viewTree(state); }, 9);
    T.ok(parseMs < 50, 'parse ' + parseMs.toFixed(1) + ' ms');
    T.ok(viewMs < 30, 'viewTree ' + viewMs.toFixed(1) + ' ms');
    var keysMs = median(function () { doc.lineageKeys(state); }, 5);
    T.ok(keysMs < 30, 'lineageKeys ' + keysMs.toFixed(1) + ' ms');
    var editMs = median(function () { doc.rename(state, state.flat[2000].path, 'x'); }, 5);
    T.ok(editMs < 10, 'an edit ' + editMs.toFixed(1) + ' ms');
    var dropMs = median(function () { doc.moveTo(state, state.flat[100].path, state.flat[3000].path, 'child'); }, 3);
    T.ok(dropMs < 100, 'a drag and drop ' + dropMs.toFixed(1) + ' ms');
    /* The edits that check their result with one more parse. */
    function first(test) { return state.flat.filter(test)[500]; }
    var tab = first(function (e) { return e.kind === 'bullet' && doc.canIndent(state, e.path); });
    var back = first(function (e) { return e.kind === 'bullet' && doc.canOutdent(state, e.path); });
    var up = first(function (e) { return doc.canMove(state, e.path, -1); });
    [['indent', function () { return doc.indent(state, tab.path); }],
      ['outdent', function () { return doc.outdent(state, back.path); }],
      ['move', function () { return doc.move(state, up.path, -1); }],
      ['addChild', function () { return doc.addChild(state, state.flat[2000].path, 'x'); }],
      ['remove', function () { return doc.remove(state, state.flat[2000].path); }]].forEach(function (edit) {
      T.ok(edit[1]() !== null, edit[0] + ' does something');
      var ms = median(edit[1], 5);
      T.ok(ms < 40, edit[0] + ' ' + ms.toFixed(1) + ' ms');
    });
  });

  T.test('random edits on the big map stay consistent', function () {
    var problems = [];
    fuzz('big', window.DocBigMap(1500), 9001, 40, problems);
    T.same(problems, [], 'big map');
  });
})();
