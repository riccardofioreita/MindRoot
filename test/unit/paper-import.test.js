/* MindRoot - paper: a picture imported as the paper. Hostile SVGs come out
 * inert (no script, event, foreignObject, animation, external reference or
 * CSS url()/@import), harmless SVG keeps its drawing, PNG and JPEG sizes are
 * read from their headers, anything else is refused with a message. */
(function () {
  'use strict';
  var P = window.MindRoot.paper;
  var H = window.PaperTest;

  function file(content, name, type) { return new File([content], name, { type: type || '' }); }
  function svg(body, attrs) { return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50"' + (attrs || '') + '>' + body + '</svg>'; }

  /* Nothing left in the text that could run or fetch. */
  function inert(text) {
    var low = text.toLowerCase();
    var problems = [];
    if (/<script/.test(low)) problems.push('script');
    if (/\son[a-z]+\s*=/.test(low)) problems.push('event attribute');
    if (/foreignobject/.test(low)) problems.push('foreignObject');
    if (/javascript:|vbscript:/.test(low.replace(/\s+/g, ''))) problems.push('javascript:');
    if (/https?:|\/\/evil|file:/.test(low.replace(/xmlns(:\w+)?="[^"]*"/g, ''))) problems.push('external');
    if (/@import/.test(low)) problems.push('@import');
    if (/<(animate|set)\b/.test(low)) problems.push('animation');
    if (/<iframe|<embed|<object|<html/.test(low)) problems.push('html');
    var urls = low.match(/url\([^)]*\)/g) || [];
    urls.forEach(function (u) { if (!/^url\(\s*['"]?#/.test(u)) problems.push('url ' + u); });
    if (/data:image\/svg|data:text/.test(low)) problems.push('data svg/text');
    return problems;
  }

  var HOSTILE = {
    'onload on the root': svg('<rect width="10" height="10"/>', ' onload="alert(1)"'),
    'uppercase event': svg('<rect ONCLICK="alert(1)" OnMouseOver="x()" width="10" height="10"/>'),
    'script element': svg('<script>alert(1)</script><script xlink:href="http://evil/x.js"/><rect width="1" height="1"/>'),
    'script in a namespace prefix': '<s:svg xmlns:s="http://www.w3.org/2000/svg" width="10" height="10"><s:script>alert(1)</s:script><s:rect width="1" height="1"/></s:svg>',
    'javascript link': svg('<a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a><a href=" JaVa&#x0A;ScRiPt:alert(2)"><circle r="3"/></a>'),
    'entity-encoded javascript': svg('<a href="&#106;avascript:alert(1)"><rect width="10" height="10"/></a>'),
    'foreignObject with html': svg('<foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>'),
    'iframe in the xhtml namespace': svg('<iframe xmlns="http://www.w3.org/1999/xhtml" src="http://evil/"></iframe>'),
    'external image': svg('<image href="http://evil/track.png" width="10" height="10"/><image xlink:href="//evil/x.png"/><image href="file:///etc/passwd"/>'),
    'svg data image': svg('<image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+" width="10" height="10"/>'),
    'external use': svg('<use href="http://evil/sprite.svg#a"/><use xlink:href="data:image/svg+xml,&lt;svg&gt;#x"/>'),
    'feImage external': svg('<filter id="f"><feImage href="http://evil/x.png"/></filter><rect filter="url(#f)" width="10" height="10"/>'),
    'animation rewriting href': svg('<a><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="onmouseover" to="alert(1)"/><rect width="5" height="5"/></a>'),
    'CSS url in style attribute': svg('<rect style="fill:url(http://evil/#g);stroke:red" width="10" height="10"/>'),
    'CSS url in presentation attribute': svg('<rect fill="url(\'https://evil/x.svg#g\')" width="10" height="10"/>'),
    'CSS @import in style element': svg('<style>@import url(http://evil/x.css); rect { fill: red }</style><rect width="10" height="10"/>'),
    'CSS escaped url': svg('<style>rect { background: u\\72l(http://evil/x) }</style><rect width="10" height="10"/>'),
    'CSS image-set without url': svg('<style>rect { fill: image-set("http://evil/x.png" 1x) }</style><rect width="10" height="10"/>'),
    'CSS comment tricks': svg('<rect style="fill: u/**/rl(http://evil)" width="10" height="10"/><style>/* */@im/**/port "http://evil/x.css";</style>'),
    'font-face src': svg('<style>@font-face { font-family: x; src: url(http://evil/f.woff) }</style><text>a</text>'),
    'xml:base and src': svg('<g xml:base="http://evil/"><rect src="http://evil/" width="1" height="1"/></g>'),
    'metadata and editor junk': svg('<metadata><x:y xmlns:x="urn:x" onload="1">http://evil/</x:y></metadata><sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" onload="x"/><rect width="1" height="1" inkscape:label="http://evil" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>'),
    'processing instruction and comment': '<?xml version="1.0"?><?xml-stylesheet href="http://evil/x.css"?><!-- http://evil/ -->' + svg('<rect width="1" height="1"/>')
  };

  T.test('hostile SVGs come out inert and still valid', function () {
    Object.keys(HOSTILE).forEach(function (name) {
      var out;
      try { out = P.sanitizeSvg(HOSTILE[name]); } catch (err) { out = { error: err.code }; }
      if (out.error) { T.ok(out.error === 'invalid', name + ': refused as invalid'); return; }
      T.same(inert(out.text), [], name + ': ' + out.text.slice(0, 300));
      var doc = new DOMParser().parseFromString(out.text, 'image/svg+xml');
      T.eq(doc.getElementsByTagName('parsererror').length, 0, name + ': still XML');
    });
  });

  T.test('entities that nest or reach outside are refused (billion laughs, XXE)', function () {
    var bomb = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg">&b;</svg>';
    T.throws(function () { P.sanitizeSvg(bomb); }, 'entities');
    var code = null;
    try { P.sanitizeSvg(bomb); } catch (err) { code = err.code; }
    T.eq(code, 'invalid', 'code invalid');
    var hostile = {
      'external entity': '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
      'public entity': '<!DOCTYPE svg [<!ENTITY x PUBLIC "-//x" "http://evil/x.dtd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
      'parameter entity': '<!DOCTYPE svg [<!ENTITY % p SYSTEM "http://evil/x.dtd"> %p;]><svg xmlns="http://www.w3.org/2000/svg"/>',
      'markup in an entity': '<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      'character reference to markup': '<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      'a huge entity': '<!DOCTYPE svg [<!ENTITY x "' + new Array(2000).join('a') + '">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      'entity spelled in lower case': '<!DOCTYPE svg [<!entity x SYSTEM "http://evil/">]><svg xmlns="http://www.w3.org/2000/svg"/>'
    };
    Object.keys(hostile).forEach(function (name) {
      var c = null;
      try { P.sanitizeSvg(hostile[name]); } catch (err) { c = err.code; }
      T.eq(c, 'invalid', name + ': refused');
    });
    var many = '<!DOCTYPE svg [' + new Array(70).join('x').split('').map(function (x, i) { return '<!ENTITY e' + i + ' "v">'; }).join('') + ']><svg xmlns="http://www.w3.org/2000/svg"/>';
    T.throws(function () { P.sanitizeSvg(many); }, 'more than 64 entities');
    T.throws(function () { P.sanitizeSvg('<svg'); }, 'broken XML');
    T.throws(function () { P.sanitizeSvg('<html xmlns="http://www.w3.org/1999/xhtml"></html>'); }, 'not an SVG');
    T.throws(function () { P.sanitizeSvg('<svg><rect/></svg>'); }, 'no SVG namespace');
  });

  T.test('a harmless drawing keeps its content', function () {
    var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    var src = svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
      '<clipPath id="c"><circle cx="5" cy="5" r="5"/></clipPath><symbol id="s"><path d="M0 0L5 5"/></symbol>' +
      '<filter id="f"><feGaussianBlur stdDeviation="1"/></filter></defs>' +
      '<style>.a { fill: url(#g); stroke: #333 }</style>' +
      '<rect class="a" width="10" height="10" fill="url(#g)" clip-path="url(#c)" filter="url(#f)" style="opacity: .5"/>' +
      '<use href="#s"/><use xlink:href="#s" x="3"/><text x="1" y="9" font-family="serif">Hello &amp; thanks</text>' +
      '<image href="' + png + '" width="1" height="1"/><a href="https://example.org"><path d="M1 1H9"/></a>');
    var out = P.sanitizeSvg(src).text;
    ['linearGradient', 'clipPath', 'symbol', 'feGaussianBlur', 'fill="url(#g)"', 'clip-path="url(#c)"', 'filter="url(#f)"',
      'href="#s"', 'Hello &amp; thanks', 'data:image/png;base64', 'fill: url(#g)', 'opacity: .5', 'd="M1 1H9"'].forEach(function (s) {
      T.ok(out.indexOf(s) >= 0, 'kept ' + s);
    });
    T.ok(out.indexOf('example.org') < 0, 'link target dropped, its drawing kept');
    T.same(inert(out), [], 'inert');
  });

  T.test('the size of an SVG: units, viewBox, defaults', function () {
    function size(attrs) { var r = P.sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"' + attrs + '><rect/></svg>'); return [r.w, r.h]; }
    T.same(size(' width="200" height="100"'), [200, 100], 'px');
    T.same(size(' width="210mm" height="297mm"'), [793.7, 1122.52], 'mm');
    T.same(size(' width="1in" height="72pt"'), [96, 96], 'in and pt');
    T.same(size(' viewBox="0 0 400 300"'), [400, 300], 'viewBox');
    T.same(size(' width="100%" height="100%" viewBox="0 0 40 30"'), [40, 30], 'percent falls back to the viewBox');
    T.same(size(' width="80" viewBox="0 0 40 30"'), [80, 60], 'one side and the viewBox');
    T.same(size(''), [300, 150], 'nothing: the browser default');
    var mm = P.sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><rect width="5" height="5"/></svg>').text;
    T.ok(/viewBox="0 0 37.8 37.8"/.test(mm) && /width="37.8"/.test(mm), 'mm without viewBox keeps its scale: ' + mm);
  });

  /* ---------------------------------------------------------------- raster */

  function canvasBlob(w, h, type) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = '#c0392b';
    g.fillRect(0, 0, w, h);
    return new Promise(function (resolve) { c.toBlob(resolve, type, 0.9); });
  }

  /* A JPEG header by hand: SOI, an APP1 Exif segment with one IFD entry
   * (orientation), a SOF0 of w x h, EOI. Enough for the size reader. */
  function fakeJpeg(w, h, orientation, little) {
    var b = [0xff, 0xd8];
    if (orientation) {
      var tiff = little ? [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]
        : [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
      var app = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff);
      b = b.concat([0xff, 0xe1, (app.length + 2) >> 8, (app.length + 2) & 255]).concat(app);
    }
    b = b.concat([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    b = b.concat([0xff, 0xd9]);
    return new Uint8Array(b);
  }

  T.test('PNG and JPEG sizes from their headers', function () {
    T.same(P.imageSize(fakeJpeg(640, 480)), { type: 'image/jpeg', w: 640, h: 480, orientation: 1 }, 'plain JPEG');
    T.same(P.imageSize(fakeJpeg(640, 480, 6, false)), { type: 'image/jpeg', w: 480, h: 640, orientation: 6 }, 'EXIF 6 (big endian) turns it');
    T.same(P.imageSize(fakeJpeg(640, 480, 8, true)), { type: 'image/jpeg', w: 480, h: 640, orientation: 8 }, 'EXIF 8 (little endian) turns it');
    T.same(P.imageSize(fakeJpeg(640, 480, 3, true)).w, 640, 'EXIF 3 upside down: same size');
    var png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x30, 0x39, 0, 1, 0, 0, 8, 6, 0, 0, 0]);
    T.same(P.imageSize(png), { type: 'image/png', w: 12345, h: 65536 }, 'PNG IHDR');
    T.eq(P.imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null, 'GIF is not ours');
    T.eq(P.imageSize(new Uint8Array([0xff, 0xd8, 0xff])), null, 'truncated JPEG');
    T.eq(P.imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])), null, 'segment longer than the file');
  });

  T.test('importBackground: real PNG and JPEG files', function () {
    return Promise.all([canvasBlob(321, 123, 'image/png'), canvasBlob(200, 300, 'image/jpeg')]).then(function (blobs) {
      return Promise.all([
        P.importBackground(new File([blobs[0]], 'Photo.PNG', { type: 'image/png' })),
        P.importBackground(new File([blobs[1]], 'scan.jpeg', { type: 'image/jpeg' })),
        P.importBackground(new File([blobs[0]], 'wrong-name.svg', { type: 'image/svg+xml' }))
      ]);
    }).then(function (r) {
      T.same([r[0].name, r[0].type, r[0].w, r[0].h, r[0].original], ['background.png', 'image/png', 321, 123, 'Photo.PNG'], 'PNG');
      T.ok(r[0].bytes instanceof Uint8Array && r[0].bytes.length > 50, 'PNG bytes kept as they are');
      T.same([r[1].name, r[1].type, r[1].w, r[1].h], ['background.jpg', 'image/jpeg', 200, 300], 'JPEG');
      T.same([r[2].name, r[2].type], ['background.png', 'image/png'], 'decided by the bytes, not the name');
    });
  });

  T.test('importBackground: SVG sanitised, sized, and shown by an <img>', function () {
    var hostile = svg('<script>alert(1)</script><rect width="100" height="50" fill="#2f7d5a" onclick="x()"/><image href="http://evil/x.png"/>');
    return P.importBackground(file('﻿' + hostile, 'drawing.svg', 'image/svg+xml')).then(function (r) {
      T.same([r.name, r.type, r.w, r.h], ['background.svg', 'image/svg+xml', 100, 50], 'SVG');
      var text = new TextDecoder().decode(r.bytes);
      T.same(inert(text), [], 'stored inert');
      T.ok(text.indexOf('#2f7d5a') > 0, 'drawing kept');
      return H.decodes(text).then(function (d) { T.ok(d.ok && d.w === 100 && d.h === 50, 'decodes at its size'); });
    }).then(function () {
      return P.importBackground(file(svg('<rect width="1" height="1"/>'), 'no-type'));
    }).then(function (r) {
      T.eq(r.type, 'image/svg+xml', 'an SVG with no type or extension is sniffed');
    });
  });

  T.test('importBackground: refusals with a ready message', function () {
    function code(p) { return p.then(function () { return 'accepted'; }, function (err) { T.ok(err.message && err.message !== 'paper.import.' + err.code, err.code + ' message: ' + err.message); return err.code; }); }
    var huge = { name: 'big.png', type: 'image/png', size: 300 * 1024 * 1024, arrayBuffer: function () { throw new Error('must not read'); } };
    var hugeSvg = { name: 'big.svg', type: 'image/svg+xml', size: 9 * 1024 * 1024, arrayBuffer: function () { throw new Error('must not read'); } };
    return Promise.all([
      code(P.importBackground(file(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]), 'a.gif', 'image/gif'))),
      code(P.importBackground(file('hello', 'notes.txt', 'text/plain'))),
      code(P.importBackground(file('', 'empty.png', 'image/png'))),
      code(P.importBackground(huge)),
      code(P.importBackground(hugeSvg)),
      code(P.importBackground(file('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>', 'broken.svg', 'image/svg+xml'))),
      code(P.importBackground(file(new Uint8Array([0x1f, 0x8b, 8, 0]), 'a.svgz', 'image/svg+xml'))),
      code(P.importBackground(file(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'a.pdf', 'application/pdf'))),
      code(P.importBackground(null)),
      code(P.importBackground(file(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0]), 'zero.png')))
    ]).then(function (codes) {
      T.same(codes, ['unsupported', 'unsupported', 'empty', 'tooBig', 'tooBig', 'invalid', 'unsupported', 'unsupported', 'empty', 'invalid'], 'codes');
    });
  });

  T.test('refusal messages in Italian', function () {
    window.MindRoot.i18n.setLang('it');
    return P.importBackground(file('hello', 'notes.txt')).then(null, function (err) {
      window.MindRoot.i18n.setLang('en');
      T.eq(err.message, 'Questo file non si può usare come sfondo. Scegli un SVG, un PNG o un JPG.', 'Italian');
    });
  });

  /* What Illustrator writes with 'Preserve Illustrator Editing
   * Capabilities': namespace entities in the DOCTYPE, used in xmlns
   * attributes, and the editing data in a foreignObject / i:pgf. */
  var ILLUSTRATOR = '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
    '\t<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">\n' +
    '\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">\n' +
    '\t<!ENTITY ns_graphs "http://ns.adobe.com/Graphs/1.0/">\n' +
    '\t<!ENTITY ns_vars "http://ns.adobe.com/Variables/1.0/">\n' +
    '\t<!ENTITY ns_imrep "http://ns.adobe.com/ImageReplacement/1.0/">\n' +
    '\t<!ENTITY ns_sfw "http://ns.adobe.com/SaveForWeb/1.0/">\n' +
    '\t<!ENTITY ns_custom "http://ns.adobe.com/GenericCustomNamespace/1.0/">\n' +
    '\t<!ENTITY ns_adobe_xpath "http://ns.adobe.com/XPath/1.0/">\n' +
    ']>\n' +
    '<svg version="1.1" id="Layer_1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns:graph="&ns_graphs;"\n' +
    '\t xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 200 100"\n' +
    '\t style="enable-background:new 0 0 200 100;" xml:space="preserve">\n' +
    '<style type="text/css">\n\t.st0{fill:#E30613;}\n\t.st1{font-family:\'\\5FAE\\8F6F\\96C5\\9ED1\';font-size:12px;fill:#1D71B8;}\n</style>\n' +
    '<switch>\n\t<foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1">\n\t\t<i:pgfRef xlink:href="#adobe_illustrator_pgf"></i:pgfRef>\n\t</foreignObject>\n' +
    '\t<g i:extraneous="self">\n\t\t<rect class="st0" width="120" height="60"/>\n\t\t<text class="st1" x="10" y="80">Title</text>\n\t</g>\n</switch>\n' +
    '<i:pgf id="adobe_illustrator_pgf">\n\t<![CDATA[\n\teJzt...\n\t]]>\n</i:pgf>\n' +
    '</svg>\n';

  T.test('an Illustrator file with namespace entities is accepted and keeps its colours', function () {
    var out = P.sanitizeSvg(ILLUSTRATOR);
    T.same([out.w, out.h], [200, 100], 'sized from the viewBox');
    T.same(inert(out.text), [], 'inert');
    T.ok(out.text.indexOf('<!ENTITY') < 0 && out.text.indexOf('&ns_') < 0, 'no DTD or entity left');
    T.ok(/\.st0\s*\{\s*fill:#E30613;?\s*\}/.test(out.text), 'the red class kept: ' + out.text.slice(0, 600));
    T.ok(/\.st1\{[^}]*fill:#1D71B8/.test(out.text), 'the blue text class keeps its fill without its escaped font');
    T.ok(out.text.indexOf('\\') < 0, 'no escape left');
    T.ok(out.text.indexOf('Title') > 0 && out.text.indexOf('class="st0"') > 0, 'drawing kept');
    T.ok(out.text.indexOf('pgf') < 0 && out.text.toLowerCase().indexOf('foreignobject') < 0, 'editing data dropped');
    return H.decodes(out.text).then(function (d) {
      T.ok(d.ok && d.w === 200 && d.h === 100, 'shows in an <img>');
      var img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.text);
      return img.decode().then(function () {
        var c = document.createElement('canvas');
        c.width = 200; c.height = 100;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        var px = g.getImageData(60, 30, 1, 1).data;
        T.ok(px[0] > 200 && px[1] < 40 && px[2] < 60, 'the rectangle renders red: ' + Array.prototype.join.call(px, ','));
      });
    });
  });

  T.test('a style attribute loses only its bad declarations', function () {
    var out = P.sanitizeSvg(svg('<rect id="r" style="fill:#ff0000;font-family:\'\\5FAE\\8F6F\';stroke:url(http://evil/x);stroke-width:2" width="10" height="10"/>')).text;
    var style = /id="r"[^>]*style="([^"]*)"|style="([^"]*)"[^>]*id="r"/.exec(out);
    var css = style ? (style[1] || style[2]) : '';
    T.ok(/fill:#ff0000/.test(css), 'fill kept: ' + css);
    T.ok(/stroke-width:2/.test(css), 'stroke-width kept');
    T.ok(css.indexOf('\\') < 0 && css.indexOf('evil') < 0 && css.indexOf('font-family') < 0, 'escaped font and external url dropped');
    var tricks = [
      'fill:red;x:u/*;*/rl(http://evil/a)',
      'fill:red;u/*;*/rl(http://evil/a)',
      'fill:red/*;stroke:u*/;stroke:url(http://evil/b)',
      'fill:u\\72l(http://evil/c)',
      'fill:red;stroke:u/*',
      'fill:red;@import "http://evil/d.css"'
    ];
    tricks.forEach(function (t) {
      var o = P.sanitizeSvg(svg('<rect style="' + t.replace(/"/g, '&quot;') + '" width="1" height="1"/>')).text;
      T.same(inert(o), [], 'inert: ' + t + ' -> ' + o);
      T.ok(o.indexOf('evil') < 0 && o.indexOf('/*') < 0, 'nothing of it left: ' + o);
    });
    var sheet = P.sanitizeSvg(svg('<style>.a{fill:#00ff00;font-family:"\\31 23"} @import url(http://evil/x.css); .b{fill:url(http://evil/#g);stroke:#0000ff} .\\31 c{fill:red}</style><rect class="a" width="1" height="1"/>')).text;
    T.ok(/\.a\{fill:#00ff00;/.test(sheet) && /stroke:#0000ff/.test(sheet), 'a sheet keeps its good rules: ' + sheet);
    T.ok(/\}\s*\.b\{/.test(sheet), 'the rule after a dropped @import is still a rule (its ; went with it)');
    T.same(inert(sheet), [], 'and is inert');
    T.ok(sheet.indexOf('\\') < 0 && sheet.indexOf('evil') < 0, 'escapes and external urls gone');
  });

  T.test('pictures too large to decode are refused, large SVGs shrink in proportion', function () {
    function png(w, h) {
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
        (w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, (h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 6, 0, 0, 0]);
    }
    function outcome(bytes, name) {
      return P.importBackground(file(bytes, name)).then(function (r) { return [r.w, r.h]; }, function (err) { return err.code + ':' + err.message; });
    }
    return Promise.all([
      outcome(png(30000, 30000), 'flat.png'),
      outcome(png(8000, 7000), 'mp56.png'),
      outcome(png(20001, 100), 'wide.png'),
      outcome(png(7000, 7000), 'mp49.png'),
      outcome(fakeJpeg(9000, 6000), 'mp54.jpg'),
      outcome(fakeJpeg(8064, 6048, 6, true), 'iphone48.jpg')
    ]).then(function (r) {
      T.ok(/^tooBig:.*50 megapixels/.test(r[0]), '30000 x 30000 refused, the message says why: ' + r[0]);
      T.ok(/^tooBig:/.test(r[1]), '56 MP refused');
      T.ok(/^tooBig:/.test(r[2]), 'a side over 20000 refused');
      T.same(r[3], [7000, 7000], '49 MP accepted');
      T.ok(/^tooBig:/.test(r[4]), '54 MP JPEG refused');
      T.same(r[5], [6048, 8064], 'a 48 MP phone photo accepted (turned by EXIF)');
      window.MindRoot.i18n.setLang('it');
      return outcome(png(30000, 30000), 'flat.png');
    }).then(function (it) {
      window.MindRoot.i18n.setLang('en');
      T.eq(it, 'tooBig:L\'immagine è troppo grande per uno sfondo (al massimo 50 megapixel e 20000 pixel per lato).', 'in Italian');
      var wide = P.sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="1000"><rect width="40000" height="1000"/></svg>');
      T.same([wide.w, wide.h], [20000, 500], 'a wide SVG halves, keeping its proportions');
      T.ok(/viewBox="0 0 40000 1000"/.test(wide.text), 'its drawing still fits: the viewBox is its own size');
      var big = P.sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000" width="10000" height="10000"/>');
      T.ok(big.w * big.h <= 50000000 + 1 && Math.abs(big.w - big.h) < 0.01, '100 MP SVG brought under 50 MP: ' + big.w + ' x ' + big.h);
    });
  });
})();
