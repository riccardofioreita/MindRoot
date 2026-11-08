/* MindRoot - ZIP written and read: stored and DEFLATE round trips, the
 * archives other systems make (DEFLATE, data descriptors, DOS code page
 * names, the Info-ZIP Unicode path), what must be refused ('..', drives,
 * litter, damage, encryption, unknown methods, ZIP64), and byte-for-byte
 * the same stored archive an earlier version wrote. */
(function () {
  'use strict';

  var ns = window.MindRoot;
  var zip = ns.zip;
  var D = window.DataT;
  ns.i18n.init('en');

  async function rejects(promise) {
    try { await promise; } catch (err) { return err; }
    return null;
  }

  /* Central directory fields of every entry, read by hand. */
  function central(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = bytes.length - 22;
    while (view.getUint32(end, true) !== 0x06054B50) end--;
    var count = view.getUint16(end + 10, true);
    var at = view.getUint32(end + 16, true);
    var out = [];
    for (var i = 0; i < count; i++) {
      var nameLength = view.getUint16(at + 28, true);
      out.push({
        flags: view.getUint16(at + 8, true), method: view.getUint16(at + 10, true),
        time: view.getUint16(at + 12, true), date: view.getUint16(at + 14, true),
        packed: view.getUint32(at + 20, true), size: view.getUint32(at + 24, true),
        name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
      });
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return out;
  }

  async function bytesOf(blob) { return new Uint8Array(await blob.arrayBuffer()); }

  T.test('CRC-32', function () {
    T.eq(zip.crc32(D.bytes('123456789')), 0xCBF43926, 'the check value of the standard');
    T.eq(zip.crc32(new Uint8Array(0)), 0, 'of nothing');
    T.eq(zip.crc32(D.bytes('6789'), zip.crc32(D.bytes('12345'))), 0xCBF43926, 'continued over two pieces');
  });

  T.test('stored: written and read back', async function () {
    var when = new Date(2026, 8, 10, 14, 30, 18);
    var blob = await zip.build([
      { name: 'città/è.md', data: '# È\n' },
      { name: 'assets/b.bin', data: new Uint8Array([0, 255, 7]), date: new Date(2001, 0, 2, 3, 4, 6) },
      { name: 'empty.txt', data: '' }
    ], { date: when });
    T.ok(blob instanceof Blob, 'a Blob');
    T.eq(blob.type, 'application/zip', 'of type application/zip');
    var read = await zip.read(blob);
    T.same(read.map(function (e) { return e.name; }), ['città/è.md', 'assets/b.bin', 'empty.txt'], 'names in UTF-8, in order');
    T.eq(D.text(read[0].data), '# È\n', 'the text');
    T.same(Array.from(read[1].data), [0, 255, 7], 'the bytes');
    T.eq(read[2].data.length, 0, 'an empty file');
    T.eq(read[0].date.getTime(), when.getTime(), 'the archive date (to the even second)');
    T.eq(read[1].date.getTime(), new Date(2001, 0, 2, 3, 4, 6).getTime(), 'an entry\'s own date');
    var heads = central(await bytesOf(blob));
    T.same(heads.map(function (h) { return h.method; }), [0, 0, 0], 'stored (method 0)');
    T.ok(heads.every(function (h) { return h.flags === 0x0800; }), 'names flagged UTF-8');
    T.eq((await zip.read(await bytesOf(blob))).length, 3, 'read from bytes as well as from a Blob');
    T.eq((await zip.read((await bytesOf(blob)).buffer)).length, 3, 'and from an ArrayBuffer');
    var early = await zip.read(await zip.build([{ name: 'a', data: 'x' }], { date: new Date(1970, 0, 1) }));
    T.eq(early[0].date.getFullYear(), 1980, 'dates before 1980 are 1980 (the format starts there)');
  });

  T.test('DEFLATE: written and read back', async function () {
    var long = '# Map\n\n' + new Array(200).join('- a node that repeats\n');
    var blob = await zip.build([
      { name: 'long.md', data: long },
      { name: 'short.md', data: '# A\n' },
      { name: 'noise.bin', data: crypto.getRandomValues(new Uint8Array(400)) }
    ], { deflate: true });
    var heads = central(await bytesOf(blob));
    T.eq(heads[0].method, 8, 'a long text is compressed');
    T.ok(heads[0].packed < heads[0].size / 5, 'to a fraction of its size');
    T.eq(heads[1].method, 0, 'a tiny one is stored');
    T.eq(heads[2].method, 0, 'bytes that do not shrink are stored');
    var read = await zip.read(blob);
    T.eq(D.text(read[0].data), long, 'and inflated back');
  });

  T.test('archives other systems make', async function () {
    var packed = await D.deflateZip([
      { name: 'x.interneuron/x.md', data: '# X\n\n- compressed\n' },
      { name: 'x.interneuron/assets/a.png', data: new Uint8Array([1, 1, 2, 3, 5, 8, 13]) },
      { name: 'x.interneuron/', data: '' },
      { name: '__MACOSX/x.interneuron/._x.md', data: 'litter' },
      { name: 'x.interneuron/.DS_Store', data: 'litter' },
      { name: 'x.interneuron/assets/Thumbs.db', data: 'litter' },
      { name: 'x.interneuron/desktop.ini', data: 'litter' }
    ], { descriptor: true });
    var read = await zip.read(packed);
    T.same(read.map(function (e) { return e.name; }), ['x.interneuron/x.md', 'x.interneuron/assets/a.png'],
      'compressed, streamed with data descriptors: read, without folders and without the litter of the Finder and Windows');
    T.eq(D.text(read[0].data), '# X\n\n- compressed\n', 'inflated');
    T.same(Array.from(read[1].data), [1, 1, 2, 3, 5, 8, 13], 'bytes intact');

    var dos = new Uint8Array([0x63, 0x69, 0x74, 0x74, 0x85, 0x2E, 0x6D, 0x64]);
    var old = await D.deflateZip([{ name: '', rawName: dos, data: '# Città\n' }], { utf8: false });
    T.eq((await zip.read(old))[0].name, 'città.md', 'an old DOS name (code page 437, no UTF-8 flag)');

    var plain = await D.deflateZip([{ name: 'café.md', data: 'x' }], { utf8: false });
    T.eq((await zip.read(plain))[0].name, 'café.md', 'UTF-8 bytes without the flag are still UTF-8');

    var utf8Name = D.bytes('日本.md');
    var extra = new Uint8Array(9 + utf8Name.length);
    var ev = new DataView(extra.buffer);
    ev.setUint16(0, 0x7075, true);
    ev.setUint16(2, 5 + utf8Name.length, true);
    extra[4] = 1;
    var fallbackName = D.bytes('__.md');
    ev.setUint32(5, zip.crc32(fallbackName), true);
    extra.set(utf8Name, 9);
    var unicode = await D.deflateZip([{ name: '', rawName: fallbackName, extra: extra, data: 'x' }], { utf8: false });
    T.eq((await zip.read(unicode))[0].name, '日本.md', 'the Info-ZIP Unicode path field');
  });

  T.test('an archive comment that looks like an end record', async function () {
    var good = await bytesOf(await zip.build([{ name: 'a.md', data: '# A\n' }]));
    var fake = new Uint8Array(30);
    new DataView(fake.buffer).setUint32(0, 0x06054B50, true);
    var withComment = new Uint8Array(good.length + fake.length);
    withComment.set(good, 0);
    withComment.set(fake, good.length);
    new DataView(withComment.buffer).setUint16(good.length - 2, fake.length, true);
    var read = await zip.read(withComment);
    T.same(read.map(function (e) { return e.name; }), ['a.md'], 'the real end record is the one whose comment reaches the end');
    var trailing = new Uint8Array(good.length + 5);
    trailing.set(good, 0);
    T.eq((await zip.read(trailing)).length, 1, 'bytes appended after the archive are tolerated');
  });

  T.test('names that climb out of the folder are refused', async function () {
    var evil = await D.deflateZip([
      { name: '../evil.md', data: 'x' },
      { name: 'a/../../b.md', data: 'x' },
      { name: 'C:/Windows/c.md', data: 'x' },
      { name: '/absolute/d.md', data: 'ok' },
      { name: 'a\\e.md', data: 'ok' },
      { name: './f.md', data: 'ok' }
    ]);
    var read = await zip.read(evil);
    T.same(read.map(function (e) { return e.name; }), ['absolute/d.md', 'a/e.md', 'f.md'], 'only what stays inside, tidied');
    T.same(read.skipped, ['../evil.md', 'a/../../b.md', 'C:/Windows/c.md'], 'and the refused ones are named');
    T.eq(zip.safeName('a/./b//c.md'), 'a/b/c.md', 'dot segments and doubled slashes go');
    T.eq(zip.safeName('x/../y'), null, 'a climb is null');
  });

  T.test('what is not a ZIP, or is a broken one', async function () {
    var err = await rejects(zip.read(D.bytes('not a zip, just some text long enough to look like something')));
    T.eq(err && err.code, 'zip.notZip', 'not a ZIP: code');
    T.eq(err && err.message, 'this is not a ZIP file', 'and message');
    T.eq((await rejects(zip.read(new Uint8Array(3)))).code, 'zip.notZip', 'three bytes are not a ZIP');

    var good = await bytesOf(await zip.build([{ name: 'a.md', data: '# hello\n' }]));
    var damaged = good.slice();
    damaged[30 + 4 + 2] ^= 0xFF;
    T.eq((await rejects(zip.read(damaged))).code, 'zip.damaged', 'a changed byte fails its CRC');
    var cut = good.slice();
    new DataView(cut.buffer).setUint32(cut.length - 22 + 16, 9999, true);
    T.eq((await rejects(zip.read(cut))).code, 'zip.damaged', 'a central directory in the wrong place');

    var locked = good.slice();
    var cd = new DataView(locked.buffer).getUint32(locked.length - 22 + 16, true);
    new DataView(locked.buffer).setUint16(cd + 8, 0x0801, true);
    var enc = await rejects(zip.read(locked));
    T.eq(enc.code, 'zip.encrypted', 'an encrypted entry');
    T.eq(enc.message, 'a.md is encrypted', 'named');

    var bzip = good.slice();
    new DataView(bzip.buffer).setUint16(cd + 10, 12, true);
    var meth = await rejects(zip.read(bzip));
    T.eq(meth.code, 'zip.method', 'an unknown method');
    T.eq(meth.message, 'a.md is packed in a way this reader does not know (method 12)', 'named, with its number');

    var big = new Uint8Array(good.length + 20);
    big.set(good.subarray(0, good.length - 22), 0);
    new DataView(big.buffer).setUint32(good.length - 22, 0x07064B50, true);
    big.set(good.subarray(good.length - 22), good.length - 2);
    T.eq((await rejects(zip.read(big))).code, 'zip.tooBig', 'a ZIP64 archive is refused, said plainly');

    ns.i18n.init('it');
    T.eq((await rejects(zip.read(D.bytes('no zip here, just text long enough')))).message, 'questo non è un file ZIP', 'the message in Italian');
    ns.i18n.init('en');
  });

  T.test('what the writer refuses', async function () {
    T.eq((await rejects(zip.build([{ name: 'a', data: '' }, { name: 'a', data: '' }]))).code, 'zip.duplicate', 'two entries with one name');
    T.eq((await rejects(zip.build([{ name: '', data: '' }]))).code, 'zip.noName', 'an entry with no name');
    T.eq((await rejects(zip.build([{ name: '../x', data: '' }]))).code, 'zip.badName', 'a name climbing out');
    T.eq((await rejects(zip.build([{ name: '/x', data: '' }]))).code, 'zip.badName', 'an absolute name');
    T.eq((await rejects(zip.build([{ name: 'dir/', data: '' }]))).code, 'zip.badName', 'a folder entry');
    var empty = await zip.read(await zip.build([]));
    T.same(empty.map(function (e) { return e.name; }), [], 'an empty archive reads as empty');
  });

  T.test('byte for byte the stored ZIP an earlier version wrote', async function () {
    var old = D.base64ToBytes(window.OldExports.projectZip.base64);
    var heads = central(old);
    var entries = await zip.read(old);
    T.eq(entries.length, heads.length, 'every entry of the old archive read');
    var h = heads[0];
    var date = new Date(((h.date >> 9) & 0x7F) + 1980, ((h.date >> 5) & 0x0F) - 1, h.date & 0x1F, (h.time >> 11) & 0x1F, (h.time >> 5) & 0x3F, (h.time & 0x1F) * 2);
    var again = await bytesOf(await zip.build(entries.map(function (e) { return { name: e.name, data: e.data }; }), { date: date }));
    T.eq(again.length, old.length, 'the same length');
    T.ok(D.equalBytes(again, old), 'the same bytes, header for header');
  });
})();
