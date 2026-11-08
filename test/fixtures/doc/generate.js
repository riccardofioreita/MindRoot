/* MindRoot - random maps for the ownership fuzz (tests only).
 *
 * Every node has words of its own ('n17'), so a node can be followed
 * through any edit by what it says. The maps mix what real files hold and
 * what makes structural edits hard: headings at drifting levels, -, *, +
 * and numbered lists (some starting past 1, so their first item is only
 * more of the text above), to-dos, notes and bodies, paragraphs inside and
 * outside items, quotes, tables, fences, comments, lazy lines, lists
 * indented a column or two off, closing #s, list-only maps and an intro. */
(function () {
  'use strict';

  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  function pad(n) { return new Array(n + 1).join(' '); }

  function generate(r, words) {
    var lines = [];
    function prose(col) {
      var at = pad(col);
      var k = r();
      if (k < 0.35) lines.push(at + 'para ' + words() + ' text');
      else if (k < 0.5) lines.push(at + '> quote ' + words());
      else if (k < 0.62) lines.push(at + '| a | b |', at + '|---|---|', at + '| 1 | 2 |');
      else if (k < 0.75) lines.push(at + '```', at + 'code ' + words(), at + '```');
      else if (k < 0.85) lines.push(at + 'para ' + words(), at + 'second line');
      else lines.push(at + '<!-- c -->');
    }
    function list(col, depth, n) {
      var ordered = r() < 0.35;
      var marker = pick(r, ['-', '*', '+']);
      var first = r() < 0.8 ? 1 : 1 + Math.floor(r() * 9);
      var delim = r() < 0.8 ? '.' : ')';
      for (var i = 0; i < n; i++) {
        var m = ordered ? (first + i) + delim : marker;
        var task = r() < 0.15 ? (r() < 0.5 ? '[ ] ' : '[x] ') : '';
        var off = r() < 0.08 ? 1 + Math.floor(r() * 2) : 0;
        lines.push(pad(col + off) + m + ' ' + task + words() + (r() < 0.05 ? ' <!-- color: #c2703d -->' : ''));
        if (r() < 0.06) lines.push(pad(col + off) + 'lazy ' + words());
        var inner = col + off + m.length + 1;
        if (r() < 0.15) lines.push(pad(inner) + '- > text: body ' + words());
        if (r() < 0.12) lines.push(pad(inner) + '- > note: note ' + words());
        if (r() < 0.15) { if (r() < 0.5) lines.push(''); prose(inner); }
        if (depth < 3 && r() < 0.4) list(inner, depth + 1, 1 + Math.floor(r() * 3));
        if (r() < 0.1) lines.push('');
      }
    }
    if (r() < 0.2) lines.push('Intro ' + words(), '');
    if (r() < 0.6) {
      var level = 1;
      var count = 1 + Math.floor(r() * 5);
      for (var h = 0; h < count; h++) {
        lines.push((r() < 0.1 ? '  ' : '') + new Array(level + 1).join('#') + ' ' + words() + (r() < 0.1 ? ' ##' : ''), '');
        if (r() < 0.3) { prose(0); lines.push(''); }
        if (r() < 0.6) { list(r() < 0.15 ? 2 : 0, 0, 1 + Math.floor(r() * 3)); lines.push(''); }
        if (r() < 0.3) { prose(0); lines.push(''); }
        level = Math.max(1, Math.min(6, level + pick(r, [-1, 0, 1, 1])));
      }
    } else {
      var tops = 1 + Math.floor(r() * 4);
      for (var t = 0; t < tops; t++) {
        list(0, 0, 1);
        if (r() < 0.4) { lines.push(''); prose(0); lines.push(''); }
      }
    }
    return lines.join('\n') + '\n';
  }

  window.DocGenerate = { rng: rng, pick: pick, generate: generate };
})();
