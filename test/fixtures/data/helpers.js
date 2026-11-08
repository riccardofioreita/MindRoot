/* MindRoot - helpers shared by the data-layer suites (store, zip, storage,
 * archive): IndexedDB housekeeping, byte helpers, a DEFLATE ZIP built the
 * way Windows and the Finder build one, fake dropped folders, and a
 * project-equality check used by the round-trip tests. */
(function () {
  'use strict';

  var ns = window.MindRoot;

  function deleteDB(name) {
    return new Promise(function (resolve) {
      var request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = function () { resolve(); };
    });
  }

  function listDBs() {
    return indexedDB.databases().then(function (list) { return list.map(function (d) { return d.name; }); });
  }

  /* Every record of every store of a database, read without the storage
   * module (and without creating the database if it is not there). */
  function dump(name) {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(name);
      request.onupgradeneeded = function () { request.transaction.abort(); };
      request.onerror = function (e) { e.preventDefault(); resolve(null); };
      request.onsuccess = function () {
        var db = request.result;
        var names = Array.prototype.slice.call(db.objectStoreNames);
        var out = { version: db.version, stores: {} };
        if (!names.length) { db.close(); resolve(out); return; }
        var tx = db.transaction(names, 'readonly');
        names.forEach(function (n) {
          var keys = tx.objectStore(n).getAllKeys();
          var values = tx.objectStore(n).getAll();
          tx.addEventListener('complete', function () {
            out.stores[n] = keys.result.map(function (k, i) { return { key: k, value: values.result[i] }; });
          });
        });
        tx.oncomplete = function () { db.close(); resolve(out); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      };
    });
  }

  function text(bytes) { return new TextDecoder().decode(bytes); }
  function bytes(s) { return new TextEncoder().encode(s); }

  function ref(id, type) { return { asset: id, type: type || 'image/png', size: 3, modified: 1 }; }

  function pathOf(textValue, label) {
    var s = ns.doc.parse(textValue);
    for (var i = 0; i < s.flat.length; i++) if (ns.doc.labelOf(s.flat[i]) === label) return s.flat[i].path;
    return null;
  }

  function base64ToBytes(b64) {
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /* A ZIP the way the system's own compressor writes one: every file
   * DEFLATE-compressed (method 8), with the sizes in the central directory
   * and - like a streaming writer - zeros in the local header (flag bit 3). */
  async function deflateZip(entries, opts) {
    opts = opts || {};
    var parts = [];
    var central = [];
    var offset = 0;
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i].rawName || bytes(entries[i].name);
      var raw = typeof entries[i].data === 'string' ? bytes(entries[i].data) : entries[i].data;
      var stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      var packed = new Uint8Array(await new Response(stream).arrayBuffer());
      var crc = ns.zip.crc32(raw);
      var flags = (opts.utf8 === false ? 0 : 0x0800) | (opts.descriptor ? 0x0008 : 0);
      var extra = entries[i].extra || new Uint8Array(0);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034B50, true); local.setUint16(4, 20, true); local.setUint16(6, flags, true);
      local.setUint16(8, 8, true);
      if (!opts.descriptor) {
        local.setUint32(14, crc, true); local.setUint32(18, packed.length, true); local.setUint32(22, raw.length, true);
      }
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, packed);
      var size = 30 + name.length + packed.length;
      if (opts.descriptor) {
        var desc = new DataView(new ArrayBuffer(16));
        desc.setUint32(0, 0x08074B50, true); desc.setUint32(4, crc, true);
        desc.setUint32(8, packed.length, true); desc.setUint32(12, raw.length, true);
        parts.push(new Uint8Array(desc.buffer));
        size += 16;
      }
      var head = new DataView(new ArrayBuffer(46));
      head.setUint32(0, 0x02014B50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true);
      head.setUint16(8, flags, true); head.setUint16(10, 8, true); head.setUint32(16, crc, true);
      head.setUint32(20, packed.length, true); head.setUint32(24, raw.length, true);
      head.setUint16(28, name.length, true); head.setUint16(30, extra.length, true); head.setUint32(42, offset, true);
      central.push(new Uint8Array(head.buffer), name, extra);
      offset += size;
    }
    var cd = 0;
    central.forEach(function (c) { cd += c.length; });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true); end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true); end.setUint32(12, cd, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  function fakeFile(name, content, type) {
    return new File([content], name, type ? { type: type } : undefined);
  }

  /* The entries API a dropped folder hands over, faked: a directory reader
   * gives its children in batches and then an empty batch. */
  function droppedDir(name, children) {
    return {
      isFile: false, isDirectory: true, name: name,
      createReader: function () {
        var batches = [children.slice(0, 1), children.slice(1), []];
        return { readEntries: function (ok) { setTimeout(function () { ok(batches.shift() || []); }, 0); } };
      }
    };
  }

  function droppedFile(name, content) {
    return { isFile: true, isDirectory: false, name: name, file: function (ok) { ok(fakeFile(name, content)); } };
  }

  async function fileBytes(p, path) {
    var r = p.files[path];
    return r ? Array.from(await ns.storage.blobBytes(r.asset)) : null;
  }

  /* Two projects equal in everything a person can see: maps, texts, files
   * and their bytes, copies (with their map, time, kind, note), trash. */
  async function sameProject(T, label, a, b) {
    T.same(b.maps.map(function (m) { return m.name; }), a.maps.map(function (m) { return m.name; }), label + ': map names');
    T.same(b.maps.map(function (m) { return m.text; }), a.maps.map(function (m) { return m.text; }), label + ': texts');
    T.same(Object.keys(b.files).sort(), Object.keys(a.files).sort(), label + ': files');
    var paths = Object.keys(a.files);
    var equal = true;
    for (var i = 0; i < paths.length; i++) {
      if (JSON.stringify(await fileBytes(a, paths[i])) !== JSON.stringify(await fileBytes(b, paths[i]))) equal = false;
    }
    T.ok(equal, label + ': the same bytes');
    function copies(x) {
      return x.snapshots.map(function (s) {
        var owner = x.maps.filter(function (m) { return m.id === s.mapId; })[0];
        return [owner && owner.name, s.when, s.kind, s.label, s.text];
      }).sort();
    }
    T.same(copies(b), copies(a), label + ': the copies, each with its map');
    T.same(b.trash.map(function (e) { return [e.kind, e.label, e.deletedAt]; }).sort(),
      a.trash.map(function (e) { return [e.kind, e.label, e.deletedAt]; }).sort(), label + ': the trash');
    /* Imported beside the original, it is told apart by a number (store.importProjects). */
    T.eq(b.name.replace(/ \(\d+\)$/, ''), a.name, label + ': the name');
    T.eq(b.description, a.description, label + ': the description');
    T.eq(b.isTemplate, a.isTemplate, label + ': the template flag');
  }

  /* Zip entries as { name: bytes } for comparing two archives. */
  async function entriesOf(blobOrBytes) {
    var list = await ns.zip.read(blobOrBytes);
    var out = {};
    list.forEach(function (e) { out[e.name] = e.data; });
    return out;
  }

  function equalBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  window.DataT = {
    deleteDB: deleteDB,
    listDBs: listDBs,
    dump: dump,
    text: text,
    bytes: bytes,
    ref: ref,
    pathOf: pathOf,
    base64ToBytes: base64ToBytes,
    deflateZip: deflateZip,
    fakeFile: fakeFile,
    droppedDir: droppedDir,
    droppedFile: droppedFile,
    fileBytes: fileBytes,
    sameProject: sameProject,
    entriesOf: entriesOf,
    equalBytes: equalBytes
  };
})();
