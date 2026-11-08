/* MindRoot - helpers shared by the media e2e suites (images*, media*,
 * draw*): the real app with a project of our own (through the editor's
 * helpers), pictures made on the spot with a canvas (no binary fixtures to
 * keep in step), and the three ways files arrive - the picker, a paste and
 * a drop - driven the way the browser delivers them. Every wait is for a
 * condition. */
'use strict';

var zlib = require('zlib');
var E = require('../editor/helpers.js');

/* A picture file inside the page, under window.__files[name]: a canvas of
 * that size and colour, encoded as `type`. */
async function makeImage(page, name, opts) {
  opts = opts || {};
  await page.evaluate(function (o) {
    return new Promise(function (resolve, reject) {
      var c = document.createElement('canvas');
      c.width = o.w || 40;
      c.height = o.h || 30;
      var g = c.getContext('2d');
      g.fillStyle = o.color || '#2f7d5a';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#ffffff';
      g.fillRect(2, 2, Math.max(1, c.width / 4), Math.max(1, c.height / 4));
      c.toBlob(function (b) {
        if (!b) return reject(new Error('no blob'));
        window.__files = window.__files || {};
        window.__files[o.name] = new File([b], o.name, { type: o.type || 'image/png', lastModified: Date.now() });
        resolve(b.size);
      }, o.type || 'image/png', 0.9);
    });
  }, { name: name, w: opts.w, h: opts.h, color: opts.color, type: opts.type });
}

/* Bytes made in Node handed to the page as a File. */
async function putFile(page, name, bytes, type) {
  await page.evaluate(function (o) {
    var bin = atob(o.b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    window.__files = window.__files || {};
    window.__files[o.name] = new File([arr], o.name, { type: o.type || '' });
  }, { name: name, b64: Buffer.from(bytes).toString('base64'), type: type });
}

/* A paste of files, the way a browser fires it: on the focused element,
 * bubbling, with the files on clipboardData. */
async function paste(page, names) {
  return page.evaluate(function (list) {
    var dt = new DataTransfer();
    list.forEach(function (n) { dt.items.add(window.__files[n]); });
    var target = document.activeElement || document.body;
    var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, names);
}

/* A drop of files at a point: dragenter, dragover, then drop on whatever
 * is under the point, with the same DataTransfer throughout. As browsers
 * do, a last dragover comes right before the drop (they fire one every
 * ~50 ms up to it); `later` says whether a node is still lit two frames
 * after the drop. */
async function drop(page, names, x, y) {
  return page.evaluate(function (o) {
    var dt = new DataTransfer();
    o.list.forEach(function (n) { dt.items.add(window.__files[n]); });
    var el = document.elementFromPoint(o.x, o.y) || document.body;
    function fire(type) {
      var ev = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: o.x, clientY: o.y });
      el.dispatchEvent(ev);
      return ev;
    }
    fire('dragenter');
    fire('dragover');
    var lit = !!document.querySelector('.mv-node[data-media-drop]');
    var shown = !document.getElementById('drop').hidden;
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          lit = lit || !!document.querySelector('.mv-node[data-media-drop]');
          var litPath = (document.querySelector('.mv-node[data-media-drop]') || { getAttribute: function () { return null; } }).getAttribute('data-path');
          fire('dragover');
          var d = fire('drop');
          var after = !!document.querySelector('.mv-node[data-media-drop]');
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              resolve({ prevented: d.defaultPrevented, lit: lit, litPath: litPath, overlay: shown, after: after, later: !!document.querySelector('.mv-node[data-media-drop]') });
            });
          });
        });
      });
    });
  }, { list: names, x: x, y: y });
}

/* What the project holds under assets/: path -> asset id. */
function files(page) {
  return page.evaluate(function () {
    var ns = window.MindRoot;
    var p = ns.store.project(ns.store.here().projectId);
    var out = {};
    Object.keys(p.files).forEach(function (k) { out[k] = p.files[k].asset; });
    return out;
  });
}

function trash(page) {
  return page.evaluate(function () {
    var ns = window.MindRoot;
    return ns.store.trash(ns.store.here().projectId).map(function (e) { return { id: e.id, kind: e.kind, path: e.path, owner: e.owner, label: e.label }; });
  });
}

/* Images on the map: path -> {src set, broken}. */
function pictures(page) {
  return page.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll('.mv-node img.mv-img'), function (img) {
      var node = img.closest('.mv-node');
      return { path: img.getAttribute('data-src'), node: node && node.getAttribute('data-path'), kind: img.getAttribute('data-kind'), field: img.getAttribute('data-field'), loaded: !!img.getAttribute('src') && img.complete && img.naturalWidth > 0, broken: img.getAttribute('data-broken') === 'true' };
    });
  });
}

function toast(page) {
  return page.evaluate(function () {
    var all = document.querySelectorAll('.toast:not([hidden]) .toast__text');
    return all.length ? all[all.length - 1].textContent : null;
  });
}

async function waitToast(page, re) {
  try {
    await page.waitForFunction(function (src) {
      var all = document.querySelectorAll('.toast:not([hidden]) .toast__text');
      var last = all.length ? all[all.length - 1].textContent : '';
      return new RegExp(src).test(last);
    }, re.source, { timeout: 6000, polling: 30 });
  } catch (err) { /* the check that follows says what was there */ }
  return toast(page);
}

/* ---------------------------------------------------------------- PNG made in Node */

var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  var td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/* A 2x2 PNG; with `markdown`, carrying it in an iTXt chunk the way a
 * MindRoot export does ('mindroot-markdown'); `variant` changes a pixel,
 * so two files are two sets of bytes. */
function png(markdown, variant) {
  var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  var raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0, 0, (variant || 0) & 255]);
  var parts = [sig, chunk('IHDR', ihdr)];
  if (markdown !== undefined) {
    var text = Buffer.concat([Buffer.from('mindroot-markdown', 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(markdown, 'utf8')]);
    parts.push(chunk('iTXt', text));
  }
  parts.push(chunk('IDAT', zlib.deflateSync(raw)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/* ---------------------------------------------------------------- drawings */

/* The drawing editor in the viewer, laid out, with the pen in hand. */
async function editorReady(page) {
  await E.until(page, function () {
    var v = window.MindRoot.media.viewerState();
    var el = document.querySelector('#viewer .ink');
    return v && v.editor && el && el.getBoundingClientRect().width > 100;
  }, null, 8000);
  await page.evaluate(function () { window.MindRoot.media.viewerState().editor.setTool('pen'); });
}

/* A stroke with the mouse across the middle of the sheet, `dy` px off it. */
async function stroke(page, dy) {
  var r = await E.rectOf(page, '#viewer .ink__surface');
  var x0 = r.x + r.w * 0.3;
  var y0 = r.y + r.h * 0.5 + (dy || 0);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (var i = 1; i <= 12; i++) await page.mouse.move(x0 + i * 12, y0 + Math.sin(i / 2) * 14);
  await page.mouse.up();
}

/* The asset a project file holds now, or null. */
function fileAsset(page, path) {
  return page.evaluate(function (p) {
    var ns = window.MindRoot;
    var ref = ns.store.fileRef(ns.store.here().projectId, p);
    return ref ? ref.asset : null;
  }, path);
}

/* How many elements the drawing stored under an asset id holds. */
function assetElements(page, asset) {
  return page.evaluate(function (a) {
    var ns = window.MindRoot;
    return ns.storage.blobText(a).then(function (svg) { return svg ? ns.ink.parse(svg).elements.length : null; });
  }, asset);
}

module.exports = {
  editorReady: editorReady,
  stroke: stroke,
  fileAsset: fileAsset,
  assetElements: assetElements,
  E: E,
  makeImage: makeImage,
  putFile: putFile,
  paste: paste,
  drop: drop,
  files: files,
  trash: trash,
  pictures: pictures,
  toast: toast,
  waitToast: waitToast,
  png: png
};
