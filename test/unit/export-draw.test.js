/* export-draw: the drawing a map exports to, built off screen without the app.
 *
 * The SVG is plain SVG (no foreignObject), parses as XML, carries
 * Montserrat as a data URL, has every word of every node as <text> inside
 * its bounds, its pictures as data: URLs, gradients where two branch
 * colours meet; the layout is the map's own (a real map view rendering the
 * same tree puts every box at the same place and size); notes, folds,
 * drawings, paper, branch-coloured words and both-sided maps follow their
 * options; user text is escaped. Then the helpers: the PDF page size rule,
 * the canvas limits, the oklab mix, the PNG's iTXt chunk read back by the
 * importer, and the Markdown each option gives. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var X = ns.exporter;
  var D = ns.doc;

  var MAP = [
    '# Garden',
    '',
    '- Vegetables',
    '  - > note: water every morning',
    '  - Tomatoes ![red](assets/dot.png)',
    '  - [x] Beans with **strong** words and `code`',
    '- Flowers <!-- color: #b4485f branch -->',
    '  - > edge: planted in spring',
    '  - Roses',
    '    - Climbing roses',
    '- Sketch ![](assets/plan.ink.svg)',
    '- Tools',
    ''
  ].join('\n');

  var DOT = null;
  function dot() {
    if (DOT) return DOT;
    var c = document.createElement('canvas');
    c.width = 40;
    c.height = 20;
    var g = c.getContext('2d');
    g.fillStyle = '#c33';
    g.fillRect(0, 0, 40, 20);
    DOT = c.toDataURL('image/png');
    return DOT;
  }
  var PLAN = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ddd"/></svg>');

  function input(text, extra) {
    var state = D.parse(text);
    var asked = [];
    var out = {
      name: 'Garden plan',
      text: text,
      tree: D.viewTree(state),
      state: state,
      balance: false,
      folds: new Set(),
      branchText: false,
      asked: asked,
      image: function (path) {
        asked.push(path);
        if (path === 'assets/dot.png') return Promise.resolve(dot());
        if (path === 'assets/plan.ink.svg') return Promise.resolve(PLAN);
        return Promise.resolve(null);
      }
    };
    for (var k in extra || {}) out[k] = extra[k];
    return out;
  }

  function parse(svg) {
    var d = new DOMParser().parseFromString(svg, 'image/svg+xml');
    return d;
  }

  function texts(d) {
    return Array.prototype.map.call(d.querySelectorAll('text'), function (t) { return t.textContent; }).join(' ');
  }

  function wordsOf(d) { return texts(d).replace(/\s+/g, ' '); }

  T.test('the SVG is plain SVG with every word in it', function () {
    var inp = input(MAP);
    return X.build({ notes: true, expand: true, drawings: false, paper: 'light' }, inp).then(function (r) {
      var d = parse(r.svg);
      T.eq(d.getElementsByTagName('parsererror').length, 0, 'parses as XML');
      T.eq(d.documentElement.nodeName, 'svg', 'an svg document');
      T.eq(r.svg.indexOf('foreignObject'), -1, 'no foreignObject');
      T.ok(/@font-face\{font-family:"Montserrat";src:url\(data:font\/woff2;base64,/.test(r.svg), 'Montserrat embedded as a data URL');
      T.eq(d.documentElement.getAttribute('viewBox'), '0 0 ' + r.width + ' ' + r.height, 'viewBox is the drawing');
      T.eq(d.querySelector('title').textContent, 'Garden plan', 'titled with the map name');
      var words = wordsOf(d);
      ['Garden', 'Vegetables', 'Tomatoes', 'Beans with', 'strong', 'words and', 'code', 'Flowers', 'Roses', 'Climbing roses', 'Tools',
        'water every morning', 'planted in spring'].forEach(function (w) {
        T.ok(words.indexOf(w) >= 0, 'has "' + w + '"');
      });
      var inside = Array.prototype.every.call(d.querySelectorAll('text'), function (t) {
        var x = parseFloat(t.getAttribute('x'));
        var y = parseFloat(t.getAttribute('y'));
        return x >= 0 && y >= 0 && x <= r.width && y <= r.height;
      });
      T.ok(inside, 'every text inside the drawing');
      var imgs = d.querySelectorAll('image');
      T.eq(imgs.length, 1, 'one picture (the drawing is left out)');
      T.ok(/^data:image\/png;base64,/.test(imgs[0].getAttributeNS('http://www.w3.org/1999/xlink', 'href')), 'as a data URL');
      T.same(inp.asked, ['assets/dot.png'], 'the drawing was never read');
      T.ok(d.querySelectorAll('linearGradient').length >= 1, 'gradients where two colours meet');
      var flowers = d.querySelector('.node[data-path="1"]');
      T.ok(flowers && flowers.querySelector('rect[stroke-dasharray="3 2"]') && flowers.textContent.indexOf('planted in spring') >= 0,
        'the note on the link to Flowers is a dashed card in its box');
      var veg = d.querySelector('.node[data-path="0"]');
      T.ok(veg && veg.textContent.indexOf('water every morning') >= 0, 'the node note is a card in its node');
      var strong = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent === 'strong'; })[0];
      T.eq(strong && strong.getAttribute('font-weight'), '700', 'strong words are bold');
      var code = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent === 'code'; })[0];
      T.ok(code && /mono|Mono|Menlo|Consolas|Courier/.test(code.getAttribute('font-family') || ''), 'code in a monospace family');
      var beans = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent.indexOf('Beans') === 0; })[0];
      var strikes = Array.prototype.filter.call(d.querySelectorAll('.node path'), function (p) { return p.getAttribute('stroke-opacity') === '0.55'; });
      T.eq(strikes.length, 2, 'a done task is struck through, one line per line of words, at 55%');
      var underline = Array.prototype.filter.call(d.querySelectorAll('.node path'), function (p) { return p.getAttribute('stroke-opacity') === '0.45'; });
      T.eq(underline.length, 0, 'no link, no link underline');
      T.ok(d.querySelectorAll('.node path[stroke-linecap]').length >= 1, 'the done task box has its tick');
      T.eq(d.querySelector('rect.paper').getAttribute('fill'), '#fbfbfc', 'light paper');
      T.ok(r.width > 300 && r.height > 150, 'a drawing of a sensible size');
    });
  });

  T.test('the boxes are where the map view puts them', function () {
    /* Without notes: an exported note card is set in Montserrat (the one
     * font the file carries) where the screen uses the system font. */
    var inp = input(D.stripNotes(MAP));
    var stage = document.getElementById('stage');
    var view = ns.mapview.create(stage, { resolveImage: function (p) { return inp.image(p); } });
    view.setOptions({ notesOpen: false, balance: false });
    var tree = inp.tree;
    return Promise.resolve(view.render(tree, { animate: false })).then(function () {
      return X.build({ notes: false, expand: true, drawings: true, paper: 'light' }, inp);
    }).then(function (r) {
      var g = view.geometry();
      var e = r.geometry.nodes;
      var paths = Object.keys(g.nodes);
      T.eq(Object.keys(e).length, paths.length, 'the same nodes');
      var off = paths.filter(function (p) {
        var a = g.nodes[p];
        var b = e[p];
        return !b || Math.abs(a.w - b.w) > 0.5 || Math.abs(a.h - b.h) > 0.5 || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || a.base !== b.base;
      });
      T.same(off.map(function (p) { return p + ' map ' + JSON.stringify([g.nodes[p].x, g.nodes[p].y, g.nodes[p].w, g.nodes[p].h, g.nodes[p].base]) + ' export ' + JSON.stringify(e[p] && [e[p].x, e[p].y, e[p].w, e[p].h, e[p].base]); }), [], 'every box the same size at the same place (and the stub at the same height)');
      view.destroy();
    });
  });

  T.test('options: notes, folds, drawings, paper, branch colour, both sides', function () {
    var base = input(MAP);
    var jobs = [];
    jobs.push(X.build({ notes: false, expand: true }, input(MAP)).then(function (r) {
      var w = wordsOf(parse(r.svg));
      T.ok(w.indexOf('water every morning') < 0 && w.indexOf('planted in spring') < 0, 'notes off: no note words');
      T.eq(parse(r.svg).querySelectorAll('rect[stroke-dasharray="3 2"]').length, 0, 'and no edge cards');
    }));
    var folded = input(MAP, { folds: new Set(['1']) });
    jobs.push(X.build({ notes: true, expand: false }, folded).then(function (r) {
      var w = wordsOf(parse(r.svg));
      T.ok(w.indexOf('Roses') < 0, 'folds kept: the folded branch is not drawn');
      T.ok(w.indexOf('Flowers') >= 0, 'but its head is');
      T.eq(parse(r.svg).querySelectorAll('circle[r="6"]').length, 1, 'with a filled knob saying something is folded');
    }));
    jobs.push(X.build({ notes: true, expand: true }, input(MAP, { folds: new Set(['1']) })).then(function (r) {
      T.ok(wordsOf(parse(r.svg)).indexOf('Climbing roses') >= 0, 'expand: everything is drawn whatever the screen folds');
    }));
    var withDrawing = input(MAP);
    jobs.push(X.build({ drawings: true }, withDrawing).then(function (r) {
      var imgs = parse(r.svg).querySelectorAll('image');
      T.eq(imgs.length, 2, 'drawings on: the drawing is drawn too');
      T.ok(withDrawing.asked.indexOf('assets/plan.ink.svg') >= 0, 'and was read');
    }));
    jobs.push(X.build({ paper: 'dark' }, input(MAP)).then(function (r) {
      var d = parse(r.svg);
      T.eq(d.querySelector('rect.paper').getAttribute('fill'), '#131519', 'dark paper');
      var tools = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent === 'Tools'; })[0];
      T.eq(tools.getAttribute('fill'), '#e4e6ea', 'light ink on it');
    }));
    jobs.push(X.build({}, input(MAP, { branchText: true })).then(function (r) {
      var d = parse(r.svg);
      var roses = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent === 'Roses'; })[0];
      T.eq(roses.getAttribute('fill'), X.mixOklab('#b4485f', '#15171c', 0.78), 'branch-coloured words: the branch mixed 78% into the ink, as hex');
      T.eq(r.svg.indexOf('color-mix'), -1, 'no color-mix() left in the file');
    }));
    var sided = MAP.replace('- Sketch ![](assets/plan.ink.svg)', '- Sketch ![](assets/plan.ink.svg) <!-- side: left -->').replace('- Tools', '- Tools <!-- side: left -->');
    jobs.push(X.build({}, input(sided)).then(function (r) {
      var nodes = r.geometry.nodes;
      var left = Object.keys(nodes).filter(function (p) { return nodes[p].side === 'left'; }).sort();
      T.same(left, ['2', '3'], 'the branches whose markers say left, and only those');
      T.ok(nodes['3'].x + nodes['3'].w < nodes[''].x, 'drawn left of the root');
    }));
    jobs.push(X.build({}, input(MAP, { balance: true })).then(function (r) {
      var nodes = r.geometry.nodes;
      var left = Object.keys(nodes).filter(function (p) { return nodes[p].side === 'left'; });
      T.ok(left.length > 0, 'a map still waiting for its sides: balanced the old way');
    }));
    void base;
    return Promise.all(jobs);
  });

  T.test('the rest of the dialect: forests, bodies, sizes, captions, code, tables, quotes', function () {
    var text = [
      '- First tree',
      '  > text: words under the line',
      '  - Child <!-- title: h3 -->',
      '  - Small print <!-- role: caption -->',
      '- Second tree',
      '',
      '  ```',
      '  let x = 1',
      '  ```',
      '',
      '  | a | b |',
      '  | - | - |',
      '  | 1 | 2 |',
      '',
      '  > a quoted line',
      '- Third ![above](assets/dot.png) <!-- image: above -->',
      ''
    ].join('\n');
    return X.build({}, input(text.replace('  - Child <!-- title: h3 -->', '  - Child <!-- title: h3 --> <!-- side: left -->'))).then(function (r) {
      var d = parse(r.svg);
      T.eq(d.getElementsByTagName('parsererror').length, 0, 'valid');
      T.eq(r.geometry.nodes['0.0'].side, 'left', 'a tree of several grows its own left side');
      var w = wordsOf(d);
      ['First tree', 'words under the line', 'Child', 'Small print', 'Second tree', 'let x = 1', 'a quoted line', 'Third'].forEach(function (s) {
        T.ok(w.indexOf(s) >= 0, 'has "' + s + '"');
      });
      T.eq(d.querySelectorAll('image').length, 1, 'the picture above its words');
      var nodes = r.geometry.nodes;
      T.ok(!nodes[''] && nodes['0'] && nodes['1'] && nodes['2'], 'several trees, no phantom root');
      var caption = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent === 'Small print'; })[0];
      T.eq(caption && caption.getAttribute('fill'), '#545a66', 'a caption is held back in soft ink');
      var child = Array.prototype.filter.call(d.querySelectorAll('text'), function (t) { return t.textContent === 'Child'; })[0];
      T.ok(child && +child.getAttribute('font-size') > 16, 'a title size wins over the depth');
    });
  });

  T.test('a left-side node reads right-aligned in its box', function () {
    var text = '# Root\n\n- One\n- Two\n- Three is a much longer branch name than the others <!-- side: left -->\n- Four <!-- side: left -->\n';
    return X.build({}, input(text)).then(function (r) {
      var nodes = r.geometry.nodes;
      var left = Object.keys(nodes).filter(function (p) { return nodes[p].side === 'left'; });
      T.ok(left.length > 0, 'some nodes on the left');
      var d = parse(r.svg);
      var ok = left.every(function (p) {
        var g = d.querySelector('.node[data-path="' + p + '"] text');
        return g && parseFloat(g.getAttribute('x')) > nodes[p].x + r.geometry.dx;
      });
      T.ok(ok, 'their words start inside their boxes');
    });
  });

  T.test('user text is escaped, odd characters dropped', function () {
    var text = '# A <b>&amp; "quotes"\n\n- x \u0007bell & <script>alert(1)</script>\n';
    return X.build({}, input(text)).then(function (r) {
      var d = parse(r.svg);
      T.eq(d.getElementsByTagName('parsererror').length, 0, 'still valid XML');
      T.eq(d.getElementsByTagName('script').length, 0, 'no script element');
      T.ok(wordsOf(d).indexOf('<script>') >= 0 || wordsOf(d).indexOf('alert(1)') >= 0, 'the words are kept as words');
    });
  });

  T.test('an empty map is an empty sheet', function () {
    return X.build({}, input('')).then(function (r) {
      var d = parse(r.svg);
      T.eq(d.getElementsByTagName('parsererror').length, 0, 'valid');
      T.eq(d.querySelectorAll('text').length, 0, 'no words');
      T.ok(r.width > 0 && r.height > 0, 'still a sheet');
    });
  });

  T.test('PDF page: 96 dpi to mm, longest side within 297..5080', function () {
    T.same(X.pageSize(0, 0), { w: 297, h: 210 }, 'no size: A4 landscape');
    var p = X.pageSize(1200, 800);
    T.eq(p.w, 317.5, '1200 px = 317.5 mm');
    T.eq(p.h, 211.67, 'and 800 px = 211.67 mm');
    var small = X.pageSize(400, 200);
    T.eq(small.w, 297, 'a small drawing grows to 297 mm');
    T.eq(small.h, 148.5, 'keeping its shape');
    var huge = X.pageSize(40000, 1000);
    T.eq(huge.w, 5080, 'a huge one is held at 5080 mm');
    T.eq(huge.h, 127, 'keeping its shape');
  });

  T.test('PNG: canvas limits', function () {
    T.eq(X.rasterScale(800, 600), 2, 'small: 2x');
    T.eq(X.rasterScale(20000, 100), 16384 / 20000, 'a side never past 16384');
    T.ok(Math.abs(X.rasterScale(5000, 5000) - Math.sqrt(16777216 / 25e6)) < 1e-9, 'the area never past 4096 x 4096');
  });

  T.test('oklab mix', function () {
    T.eq(X.mixOklab('#2f7d5a', '#2f7d5a', 0.3), '#2f7d5a', 'a colour with itself');
    T.eq(X.mixOklab('#ffffff', '#000000', 1), '#ffffff', 'all of the first');
    T.eq(X.mixOklab('#ffffff', '#000000', 0), '#000000', 'none of it');
    T.eq(X.mixOklab('#ffffff', '#000000', 0.5), '#636363', 'oklab middle grey');
  });

  T.test('PNG carries its Markdown and reads back as a map', function () {
    var c = document.createElement('canvas');
    c.width = 3;
    c.height = 2;
    var text = '# Café ☕\n\n- naïve ✓\n- 日本語\n';
    return new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); }).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (buf) {
      var bytes = X.withPngText(new Uint8Array(buf), text);
      var at = 8 + 12 + 13;
      var type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      T.eq(type, 'iTXt', 'the chunk right after IHDR');
      return ns.archive.markdownFromPng(bytes).then(function (md) {
        T.eq(md, text, 'the importer reads the same text back (UTF-8)');
        var url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        return new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () { resolve(img.naturalWidth); };
          img.onerror = function () { resolve(-1); };
          img.src = url;
        }).then(function (w) {
          T.eq(w, 3, 'and the picture still opens');
          return ns.archive.readFile(new File([bytes], 'garden.png', { type: 'image/png' }));
        }).then(function (got) {
          T.same(got.map, { name: 'garden', text: text }, 'dropped as a file it is a map named after it');
        });
      });
    });
  });

  T.test('a real PNG of a map', function () {
    return X.png({ notes: true }, input(MAP)).then(function (blob) {
      T.eq(blob.type, 'image/png', 'a PNG');
      return ns.archive.markdownFromPng(blob).then(function (md) {
        T.eq(md, D.stripDrawings(MAP), 'carrying the map (minus the left-out drawing)');
        T.ok(md.indexOf('plan.ink.svg') < 0, 'the drawing reference is gone');
        return createImageBitmap(blob);
      }).then(function (bmp) {
        return X.build({ notes: true }, input(MAP)).then(function (r) {
          T.eq(bmp.width, Math.round(r.width * 2), 'at twice the drawing size');
          var cv = document.createElement('canvas');
          cv.width = bmp.width;
          cv.height = bmp.height;
          var g = cv.getContext('2d');
          g.drawImage(bmp, 0, 0);
          var data = g.getImageData(0, 0, cv.width, cv.height).data;
          var dark = 0;
          for (var i = 0; i < data.length; i += 4) if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++;
          T.ok(dark > 500, 'with dark ink drawn on it (' + dark + ' pixels)');
        });
      });
    });
  });

  T.test('Markdown per option', function () {
    var inp = input(MAP);
    var all = X.markdownText({ notes: true, drawings: true }, inp);
    T.eq(all, MAP, 'everything: the file as it is');
    var noNotes = X.markdownText({ notes: false, drawings: true }, inp);
    T.ok(noNotes.indexOf('> note:') < 0 && noNotes.indexOf('> edge:') < 0, 'notes off: no notes');
    T.ok(noNotes.indexOf('- Roses') >= 0, 'nodes stay');
    var noDraw = X.markdownText({ notes: true, drawings: false }, inp);
    T.ok(noDraw.indexOf('plan.ink.svg') < 0, 'drawings off: no drawing');
    T.ok(noDraw.indexOf('dot.png') >= 0, 'photos stay');
    return X.markdown({ notes: true, drawings: true }, inp).text().then(function (s) {
      T.eq(s, MAP, 'the blob holds the text');
    });
  });
})();
