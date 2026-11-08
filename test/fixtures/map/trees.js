/* MindRoot - ViewNode trees for the map engine's tests (tests only).
 *
 * Built by hand in the shape ns.doc.viewTree() returns (contract 4.8), so
 * the map suites need neither the parser nor a store: a single root, a
 * synthetic root with several top nodes, a fan of 200, a chain of 30, a map
 * of 2,000, and one "rich" map with every kind of content a node can carry
 * (pictures left / right / above, bodies, notes, tasks, captions, H1-H6,
 * coloured branches, links, numbers, long words, escaped markup, an empty
 * node). Pictures are small SVG data: URLs (no network), plus two asset
 * paths the host page resolves: one to a blob: URL, one to nothing.
 *
 * window.MapTrees.<name>() returns a fresh tree each call; withChild,
 * moved and without return an edited copy (an insert, an indent or outdent
 * or drag, a delete), renumbered the way the parser would. */
(function () {
  'use strict';

  var PALETTE = ['#2f7d5a', '#c2703d', '#3b6ea5', '#b4485f', '#5f8a3f', '#a8843f', '#4a7f8a'];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* A picture of a known shape: width x height, one colour, as a data URL. */
  function picture(w, h, color, label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<rect width="' + w + '" height="' + h + '" rx="8" fill="' + color + '"/>' +
      '<text x="50%" y="55%" font-size="' + Math.round(h / 4) + '" text-anchor="middle" fill="#fff" font-family="sans-serif">' + (label || '') + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  var PICS = {
    wide: picture(440, 220, '#3b6ea5', 'wide'),
    tall: picture(220, 330, '#c2703d', 'tall'),
    square: picture(200, 200, '#5f8a3f', 'sq'),
    sketch: picture(300, 200, '#a8843f', 'ink')
  };

  /* spec: [text, options, children] or a plain string. */
  function build(spec, path, depth, branchIndex, inherited) {
    if (typeof spec === 'string') spec = [spec, {}, []];
    var text = spec[0];
    var o = spec[1] || {};
    var kids = spec[2] || [];
    var own = o.color || null;
    var color = own || inherited || PALETTE[(branchIndex + 1 + PALETTE.length) % PALETTE.length];
    var node = {
      path: path,
      synthetic: false,
      depth: depth,
      kind: o.kind || (depth === 0 ? 'heading' : 'bullet'),
      level: o.kind === 'heading' || (!o.kind && depth === 0) ? (o.level || 1) : null,
      ordered: o.ordered === undefined ? null : o.ordered,
      titleSize: o.titleSize || null,
      role: o.role || null,
      html: o.html !== undefined ? o.html : esc(text),
      text: text,
      task: o.task === undefined ? null : { checked: !!o.task },
      images: o.images || [],
      imageAbove: !!o.imageAbove,
      drawAbove: !!o.drawAbove,
      body: o.body || null,
      notes: { node: o.note || null, edge: o.edge || null },
      color: color,
      ownColor: !!own,
      branchIndex: branchIndex,
      links: o.links || [],
      fold: o.fold || null,
      side: o.side === 'left' ? 'left' : 'right',
      children: []
    };
    /* What the children inherit: a branch colour carries on down; a colour
     * of the node's own stops at the node; the root's children take the
     * palette by their index. */
    var passOn = own && o.branch ? own : (depth === 0 ? null : (own ? inherited || PALETTE[(branchIndex + 1) % PALETTE.length] : color));
    for (var i = 0; i < kids.length; i++) {
      var childPath = path === '' ? String(i) : path + '.' + i;
      node.children.push(build(kids[i], childPath, depth + 1, depth === 0 ? i : branchIndex, passOn));
    }
    return node;
  }

  function tree(spec) { return build(spec, '', 0, -1, null); }

  /* Several top-level nodes and no heading: doc gives a synthetic root. */
  function forest(specs) {
    var root = {
      path: null, synthetic: true, depth: 0, kind: 'text', level: null, ordered: null, titleSize: null, role: null,
      html: '', text: '', task: null, images: [], imageAbove: false, drawAbove: false, body: null,
      notes: { node: null, edge: null }, color: PALETTE[0], ownColor: false, branchIndex: -1, links: [], fold: null, children: []
    };
    for (var i = 0; i < specs.length; i++) root.children.push(build(specs[i], String(i), 1, i, null));
    return root;
  }

  function img(path, kind, side, alt) { return { path: path, src: path, alt: alt || '', kind: kind || 'photo', side: side || 'left' }; }

  var T = {
    single: function () { return tree(['Only the root', {}, []]); },

    /* Three small branches with known shapes: the gesture and fold tests. */
    small: function () {
      return tree(['Root', {}, [
        ['Alpha', {}, ['Alpha one', 'Alpha two']],
        ['Beta', { edge: 'Why beta follows alpha' }, ['Beta one', ['Beta two', {}, ['Deep one', 'Deep two']]]],
        ['Gamma', { note: 'A note on gamma' }, ['Gamma one']]
      ]]);
    },

    forest: function () {
      return forest([
        ['First tree', {}, ['One', 'Two']],
        ['Second tree', {}, ['Three', ['Four', {}, ['Five']]]],
        ['Third tree', {}, []]
      ]);
    },

    fan: function () {
      var kids = [];
      for (var i = 0; i < 200; i++) kids.push('Child ' + (i + 1));
      return tree(['Wide fan', {}, kids]);
    },

    chain: function () {
      var spec = 'Level 30';
      for (var i = 29; i >= 1; i--) spec = ['Level ' + i, {}, [spec]];
      return tree(['Level 0', {}, [spec]]);
    },

    /* 2,000 nodes: 20 sections x 10 items x ~9 children, with the usual mix. */
    big: function () {
      var sections = [];
      var count = 1;
      for (var s = 0; s < 20 && count < 2000; s++) {
        count++;
        var items = [];
        for (var i = 0; i < 10 && count < 2000; i++) {
          count++;
          var kids = [];
          for (var k = 0; k < 9 && count < 2000; k++) {
            count++;
            kids.push(['Child ' + s + '.' + i + '.' + k + (k % 3 === 0 ? ' with a few more words to wrap' : ''),
              { task: k % 4 === 0 ? k % 8 === 0 : undefined, note: k === 5 ? 'note ' + k : null }, []]);
          }
          items.push(['Item ' + s + '.' + i, {
            body: i % 3 === 0 ? { html: 'The body of item ' + i + ' over <strong>two</strong> lines', text: '', role: null, images: [], imageAbove: false, drawAbove: false } : null,
            color: i === 4 ? '#b4485f' : null
          }, kids]);
        }
        sections.push(['Section ' + s, { titleSize: s % 3 === 0 ? 'h3' : null }, items]);
      }
      while (count < 2000) { sections[0][2].push('Extra ' + count); count++; }
      return tree(['Two thousand', {}, sections]);
    },

    rich: function () {
      return tree(['Study plan', { titleSize: 'h1' }, [
        ['Reading', { edge: 'Start here' }, [
          ['Benachrichtigungseinstellungen Donaudampfschifffahrtsgesellschaftskapitan', {}, []],
          ['A long link', { html: '<a class="md-link" href="https://example.com/a/very/long/path/that/goes/on" target="_blank" rel="noopener noreferrer">https://example.com/a/very/long/path/that/goes/on</a>', links: [{ href: 'https://example.com/a/very/long/path/that/goes/on', text: 'link', kind: 'url' }] }, []],
          ['Other map', { html: 'See <a class="md-map" href="#" data-map="Biology">Biology</a>', links: [{ href: 'Biology', text: 'Biology', kind: 'map' }] }, []],
          ['<script>alert(1)</script> & **not bold**', {}, []],
          ['Marks', { html: '<strong>bold</strong> <em>italic</em> <u>under</u> <del>gone</del> <mark>marked</mark> <code>code</code>' }, []]
        ]],
        ['Pictures', { color: '#b4485f', branch: true }, [
          ['Left picture', { images: [img(PICS.wide, 'photo', 'left', 'wide')] }, []],
          ['Right picture', { images: [img(PICS.square, 'photo', 'right', 'square')] }, []],
          ['Picture above the words', { images: [img(PICS.tall, 'photo', 'left', 'tall')], imageAbove: true }, []],
          ['Photo right and sketch above', { images: [img(PICS.sketch, 'draw', 'left'), img(PICS.square, 'photo', 'right')], drawAbove: true }, []],
          ['', { images: [img(PICS.square, 'photo', 'left', 'only a picture')], html: '' }, []],
          ['From the store', { images: [img('assets/blob-picture.png', 'photo', 'left', 'stored')] }, []],
          ['Missing one', { images: [img('assets/missing.png', 'photo', 'right', 'gone')] }, []]
        ]],
        ['Words under', { color: '#3b6ea5' }, [
          ['Paragraph', { body: { html: 'Words under the title, wrapping onto a second line when they are long enough to need it.', text: '', role: null, images: [], imageAbove: false, drawAbove: false } }, []],
          ['Title body', { body: { html: 'A title body', text: '', role: 'title', images: [], imageAbove: false, drawAbove: false } }, []],
          ['Caption body', { body: { html: 'a caption body', text: '', role: 'caption', images: [img(PICS.square, 'photo', 'left')], imageAbove: false, drawAbove: false } }, []],
          ['Caption line', { role: 'caption' }, []]
        ]],
        ['Tasks and notes', {}, [
          ['Done task', { task: true }, []],
          ['Open task', { task: false, note: 'Remember the deadline' }, []],
          ['First', { ordered: 1 }, []],
          ['Second', { ordered: 2, edge: 'Order matters' }, []],
          ['', { html: '' }, []]
        ]],
        ['Sizes', { color: '#5f8a3f', branch: true }, [
          ['Heading one', { titleSize: 'h1' }, []],
          ['Heading two', { titleSize: 'h2' }, []],
          ['Heading three', { titleSize: 'h3' }, []],
          ['Heading four', { titleSize: 'h4' }, []],
          ['Heading five', { titleSize: 'h5' }, []],
          ['Heading six', { titleSize: 'h6' }, []]
        ]]
      ]]);
    }
  };

  /* A copy of a tree with one more child under a node: the no-churn test. */
  T.withChild = function (base, parentPath, index, text) {
    var copy = JSON.parse(JSON.stringify(base));
    function find(n) {
      if (n.path === parentPath) return n;
      for (var i = 0; i < n.children.length; i++) { var f = find(n.children[i]); if (f) return f; }
      return null;
    }
    var parent = find(copy);
    var depth = parent.depth + 1;
    var child = build(text, null, depth, depth === 1 ? index : parent.branchIndex, depth === 1 ? null : parent.color);
    parent.children.splice(index, 0, child);
    (function renumber(n) {
      for (var i = 0; i < n.children.length; i++) {
        var p = n.path === '' ? String(i) : n.path + '.' + i;
        n.children[i].path = p;
        renumber(n.children[i]);
      }
    })(copy);
    return copy;
  };

  /* Paths and depths from the shape of a single-root tree, after an edit. */
  T.renumber = function (tree) {
    (function walk(n, path, depth) {
      n.path = path;
      n.depth = depth;
      for (var i = 0; i < n.children.length; i++) walk(n.children[i], path === '' ? String(i) : path + '.' + i, depth + 1);
    })(tree, '', 0);
    return tree;
  };

  function nodeAt(tree, path) {
    if (path === '') return tree;
    var n = tree;
    path.split('.').forEach(function (i) { n = n.children[+i]; });
    return n;
  }

  /* A copy with the node at `from` (and its branch) moved under `toParent`
   * at `index` (index counted after the removal): an indent, an outdent, a
   * drag. */
  T.moved = function (base, from, toParent, index) {
    var copy = JSON.parse(JSON.stringify(base));
    var parentPath = from.lastIndexOf('.') < 0 ? '' : from.slice(0, from.lastIndexOf('.'));
    var at = +from.slice(from.lastIndexOf('.') + 1);
    var parent = nodeAt(copy, parentPath);
    var target = nodeAt(copy, toParent);
    var node = parent.children.splice(at, 1)[0];
    target.children.splice(index, 0, node);
    return T.renumber(copy);
  };

  /* A copy with the nodes at `lefts` marked to grow on the left (the
   * '<!-- side: left -->' marker doc.viewTree reads into view.side). */
  T.sided = function (base, lefts) {
    var copy = JSON.parse(JSON.stringify(base));
    (function walk(n) {
      if (n.path !== null && lefts.indexOf(n.path) >= 0) n.side = 'left';
      for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
    })(copy);
    return copy;
  };

  /* A copy without the node at `path` (and its branch). */
  T.without = function (base, path) {
    var copy = JSON.parse(JSON.stringify(base));
    var parentPath = path.lastIndexOf('.') < 0 ? '' : path.slice(0, path.lastIndexOf('.'));
    nodeAt(copy, parentPath).children.splice(+path.slice(path.lastIndexOf('.') + 1), 1);
    return T.renumber(copy);
  };

  T.PICS = PICS;
  T.count = function (n) {
    var c = n.path === null ? 0 : 1;
    for (var i = 0; i < n.children.length; i++) c += T.count(n.children[i]);
    return c;
  };

  window.MapTrees = T;
})();
