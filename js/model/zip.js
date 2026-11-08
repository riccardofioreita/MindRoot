/* MindRoot - ZIP archives, written and read, with nothing downloaded.
 *
 * Writing is the smallest ZIP there is: names in UTF-8 (flag 0x0800), a
 * CRC-32 each, no folder entries (every reader makes folders from the
 * names). Stored (method 0) by default - the same bytes the previous
 * MindRoot and IPE write, so a project opens the same way everywhere - or
 * DEFLATE (method 8) through the browser's own CompressionStream when asked,
 * entry by entry, only where it actually saves room.
 *
 * Reading has to take what other programs make: the "compressed folder" of
 * Windows and the Finder both use DEFLATE, which DecompressionStream
 * inflates without a library. Sizes and CRCs come from the central
 * directory, so archives streamed with data descriptors read too; every
 * entry's CRC is checked. Names: UTF-8 when flagged, or the Info-ZIP Unicode
 * path field when present, else UTF-8 if the bytes are valid UTF-8, else
 * the old DOS code page 437. What a ZIP must never do to us is filtered
 * here: entries climbing out of the folder ('..'), absolute or drive paths,
 * and the litter other systems leave (__MACOSX, .DS_Store, Thumbs.db,
 * desktop.ini). ZIP64 (archives past 4 GB) is refused with a clear message:
 * a map that size is not a map.
 *
 * Errors carry a stable `code` (zip.notZip, zip.damaged, ...) and a message
 * in the person's language. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  var SIG_LOCAL = 0x04034B50;
  var SIG_CENTRAL = 0x02014B50;
  var SIG_END = 0x06054B50;
  var SIG_END64_LOCATOR = 0x07064B50;
  var FLAG_UTF8 = 0x0800;
  var MAX32 = 0xFFFFFFFF;

  var STRINGS = {
    en: {
      'zip.notZip': 'this is not a ZIP file',
      'zip.damaged': 'the ZIP file is damaged',
      'zip.encrypted': '{name} is encrypted',
      'zip.method': '{name} is packed in a way this reader does not know (method {method})',
      'zip.noInflate': 'this browser cannot open compressed ZIP files',
      'zip.tooBig': 'the ZIP file is too large to read here',
      'zip.noName': 'a ZIP entry needs a name',
      'zip.badName': '{name} is not a name a ZIP entry can have',
      'zip.duplicate': 'two ZIP entries called {name}'
    },
    it: {
      'zip.notZip': 'questo non è un file ZIP',
      'zip.damaged': 'il file ZIP è danneggiato',
      'zip.encrypted': '{name} è cifrato',
      'zip.method': '{name} è compresso in un modo che questo lettore non conosce (metodo {method})',
      'zip.noInflate': 'questo browser non sa aprire i file ZIP compressi',
      'zip.tooBig': 'il file ZIP è troppo grande per leggerlo qui',
      'zip.noName': 'una voce di uno ZIP deve avere un nome',
      'zip.badName': '{name} non è un nome valido per una voce di uno ZIP',
      'zip.duplicate': 'due voci dello ZIP si chiamano {name}'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (w, k) { return vars && vars[k] != null ? vars[k] : w; });
  }

  function fail(code, vars) {
    var err = new Error(t(code, vars));
    err.code = code;
    return err;
  }

  /* ---------- CRC-32 ---------- */

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  /* `seed` continues a CRC over several pieces (the PNG reader uses it). */
  function crc32(bytes, seed) {
    var crc = seed == null ? 0xFFFFFFFF : (seed ^ 0xFFFFFFFF) >>> 0;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- small things ---------- */

  function toBytes(data) {
    if (data == null) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new TypeError('a zip entry holds a string or bytes');
  }

  async function bytesOf(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof Blob === 'function' && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
    return toBytes(input);
  }

  /* DOS time and date, in local time as every unzip tool shows them. The
   * format starts in 1980 and ends in 2107. */
  function dosStamp(date) {
    var d = date instanceof Date ? date : new Date(typeof date === 'number' ? date : Date.now());
    if (isNaN(d.getTime())) d = new Date();
    var year = Math.min(2107, Math.max(1980, d.getFullYear()));
    return {
      time: ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F),
      date: (((year - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F)
    };
  }

  function dosDate(time, date) {
    var day = date & 0x1F;
    var month = (date >> 5) & 0x0F;
    if (!day || !month) return null;
    return new Date(((date >> 9) & 0x7F) + 1980, month - 1, day, (time >> 11) & 0x1F, (time >> 5) & 0x3F, (time & 0x1F) * 2);
  }

  /* A name a ZIP may carry, as read back: forward slashes, no leading slash
   * or drive, no '.' segments; null when it climbs out of the folder. */
  function safeName(name) {
    var out = String(name).replace(/\\/g, '/');
    if (/^[a-z]:/i.test(out)) return null;
    out = out.replace(/^\/+/, '');
    var parts = out.split('/');
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') return null;
      if (parts[i] === '.' || (parts[i] === '' && i < parts.length - 1)) continue;
      kept.push(parts[i]);
    }
    return kept.join('/');
  }

  /* What a folder carried by some other system leaves in an archive and no
   * map ever wants. */
  function isJunk(name) {
    return /(^|\/)__MACOSX\//.test(name) || /(^|\/)\.DS_Store$/.test(name) ||
      /(^|\/)Thumbs\.db$/i.test(name) || /(^|\/)desktop\.ini$/i.test(name);
  }

  /* ---------- writing ---------- */

  async function deflate(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* entries: [{ name: 'dir/file.md', data: string | Uint8Array, date? }].
   * options: { deflate: bool, date }. Returns Promise<Blob>. */
  async function build(entries, options) {
    options = options || {};
    var canDeflate = !!options.deflate && typeof CompressionStream === 'function';
    var encoder = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    var seen = Object.create(null);
    var list = entries || [];
    if (list.length > 0xFFFF) throw fail('zip.tooBig');

    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || typeof entry.name !== 'string' || !entry.name) throw fail('zip.noName');
      var clean = safeName(entry.name);
      if (clean !== entry.name || /\/$/.test(entry.name)) throw fail('zip.badName', { name: entry.name });
      if (seen[entry.name]) throw fail('zip.duplicate', { name: entry.name });
      seen[entry.name] = true;
      var name = encoder.encode(entry.name);
      var data = toBytes(entry.data);
      var crc = crc32(data);
      var method = 0;
      var packed = data;
      if (canDeflate && data.length > 64) {
        var squeezed = await deflate(data);
        if (squeezed.length < data.length) { packed = squeezed; method = 8; }
      }
      if (packed.length >= MAX32 || data.length >= MAX32 || offset >= MAX32) throw fail('zip.tooBig');
      var stamp = dosStamp(entry.date != null ? entry.date : options.date);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, SIG_LOCAL, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, FLAG_UTF8, true);
      local.setUint16(8, method, true);
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, packed.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, packed);

      var head = new DataView(new ArrayBuffer(46));
      head.setUint32(0, SIG_CENTRAL, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 20, true);
      head.setUint16(8, FLAG_UTF8, true);
      head.setUint16(10, method, true);
      head.setUint16(12, stamp.time, true);
      head.setUint16(14, stamp.date, true);
      head.setUint32(16, crc, true);
      head.setUint32(20, packed.length, true);
      head.setUint32(24, data.length, true);
      head.setUint16(28, name.length, true);
      head.setUint16(30, 0, true);
      head.setUint16(32, 0, true);
      head.setUint16(34, 0, true);
      head.setUint16(36, 0, true);
      head.setUint32(38, 0, true);
      head.setUint32(42, offset, true);
      central.push(new Uint8Array(head.buffer), name);

      offset += 30 + name.length + packed.length;
    }

    var size = 0;
    central.forEach(function (part) { size += part.length; });
    if (offset + size >= MAX32) throw fail('zip.tooBig');
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, SIG_END, true);
    end.setUint16(8, list.length, true);
    end.setUint16(10, list.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  /* ---------- reading ---------- */

  /* 22 bytes plus a comment of up to 64 KB, looked for backwards. The
   * signature can also occur inside the comment, so the record whose
   * comment length reaches exactly the end of the file wins; failing that
   * (bytes appended after the archive), the last signature found. */
  function endRecord(view) {
    var stop = Math.max(0, view.byteLength - 22 - 0xFFFF);
    var fallback = -1;
    for (var i = view.byteLength - 22; i >= stop; i--) {
      if (view.getUint32(i, true) !== SIG_END) continue;
      if (i + 22 + view.getUint16(i + 20, true) === view.byteLength) return i;
      if (fallback < 0) fallback = i;
    }
    return fallback;
  }

  /* The DOS code page every ZIP tool fell back to before UTF-8: the upper
   * half (0x80-0xFF). */
  var CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

  function cp437(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += bytes[i] < 0x80 ? String.fromCharCode(bytes[i]) : CP437.charAt(bytes[i] - 0x80);
    return out;
  }

  /* The Info-ZIP Unicode Path extra field (0x7075): the UTF-8 name, valid
   * as long as its CRC matches the name it stands for. */
  function unicodePath(extra, nameBytes) {
    var view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
    for (var at = 0; at + 4 <= extra.length;) {
      var id = view.getUint16(at, true);
      var len = view.getUint16(at + 2, true);
      if (at + 4 + len > extra.length) break;
      if (id === 0x7075 && len >= 5 && extra[at + 4] === 1 && view.getUint32(at + 5, true) === crc32(nameBytes)) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(extra.subarray(at + 9, at + 4 + len)); } catch (err) { return null; }
      }
      at += 4 + len;
    }
    return null;
  }

  function decodeName(nameBytes, extra, utf8) {
    if (utf8) return new TextDecoder('utf-8').decode(nameBytes);
    var fromExtra = extra.length ? unicodePath(extra, nameBytes) : null;
    if (fromExtra) return fromExtra;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch (err) { return cp437(nameBytes); }
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') throw fail('zip.noInflate');
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* bytes | Blob | ArrayBuffer -> [{ name, data: Uint8Array, date }], folders
   * and litter left out. Entries refused for their name ('..', a drive) are
   * listed in the result's `skipped`. Throws on a file that is not a ZIP,
   * rather than handing back an empty list that would look like an empty
   * archive. */
  async function read(input) {
    var bytes = await bytesOf(input);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = bytes.length >= 22 ? endRecord(view) : -1;
    if (end < 0) throw fail('zip.notZip');
    if (end >= 20 && view.getUint32(end - 20, true) === SIG_END64_LOCATOR) throw fail('zip.tooBig');

    var count = view.getUint16(end + 10, true);
    var at = view.getUint32(end + 16, true);
    if (count === 0xFFFF || at === MAX32) throw fail('zip.tooBig');
    var out = [];
    out.skipped = [];

    for (var i = 0; i < count; i++) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG_CENTRAL) throw fail('zip.damaged');
      var flags = view.getUint16(at + 8, true);
      var method = view.getUint16(at + 10, true);
      var time = view.getUint16(at + 12, true);
      var date = view.getUint16(at + 14, true);
      var crc = view.getUint32(at + 16, true);
      var packed = view.getUint32(at + 20, true);
      var size = view.getUint32(at + 24, true);
      var nameLength = view.getUint16(at + 28, true);
      var extraLength = view.getUint16(at + 30, true);
      var commentLength = view.getUint16(at + 32, true);
      var localAt = view.getUint32(at + 42, true);
      if (at + 46 + nameLength + extraLength > bytes.length) throw fail('zip.damaged');
      var nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
      var extra = bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      var raw = decodeName(nameBytes, extra, !!(flags & FLAG_UTF8));
      at += 46 + nameLength + extraLength + commentLength;

      if (/[\/\\]$/.test(raw)) continue;
      var name = safeName(raw);
      if (name === null || !name) { out.skipped.push(raw); continue; }
      if (isJunk(name)) continue;
      if (flags & 0x0001) throw fail('zip.encrypted', { name: name });
      if (packed === MAX32 || size === MAX32 || localAt === MAX32) throw fail('zip.tooBig');

      if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== SIG_LOCAL) throw fail('zip.damaged');
      var start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
      if (start + packed > bytes.length) throw fail('zip.damaged');
      var stored = bytes.subarray(start, start + packed);
      var data;
      if (method === 0) data = stored.slice();
      else if (method === 8) {
        try { data = await inflate(stored); } catch (err) { throw err && err.code ? err : fail('zip.damaged'); }
      } else throw fail('zip.method', { name: name, method: method });
      if (data.length !== size || crc32(data) !== crc) throw fail('zip.damaged');
      out.push({ name: name, data: data, date: dosDate(time, date) });
    }
    return out;
  }

  ns.zip = { build: build, read: read, crc32: crc32, isJunk: isJunk, safeName: safeName };
})(window.MindRoot);
