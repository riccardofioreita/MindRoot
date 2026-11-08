/* MindRoot - projects out to files, and files back in as projects.
 *
 * The format on the disk is the one MindRoot always had (compatibility is
 * the point: every export of an earlier version imports here, and every
 * export from here opens there):
 *
 *     kyc.interneuron/
 *       interneuron.json      name, description, template flag, the maps in order
 *       kyc.md                one .md per map, the Markdown as it is
 *       citta.md
 *       assets/               pictures and drawings, named as the maps name them
 *       templates/            other files the project keeps
 *       snapshots/            <map>--YYYY-MM-DD-HHMM.md, and snapshots.json
 *       trash/                what is in the bin, and trash.json saying what it was
 *
 * Two ways out. The ZIP is that folder, for people and for the programs that
 * read Markdown: unpacked, Obsidian opens it. The JSON is one file for
 * programs - the store's own record, with a word at the top saying what it
 * holds and the bytes of every file in base64 - lossless by construction.
 *
 * Coming in: a `.interneuron` folder (picked or dropped), a ZIP of one or of
 * several (whatever the ZIP is called), a JSON, a loose .md (a map), or a
 * PNG exported by MindRoot (its Markdown rides in an iTXt chunk
 * 'mindroot-markdown'). Everything that arrives at once is one undo step
 * and one message that also says what was left out; an import adds beside
 * what is there and never replaces anything. Bytes are stored by content,
 * so a picture that is both in assets/ and in trash/ is one record, and a
 * branch put back finds its own picture rather than a rename.
 *
 * The whole workspace (ZIP or JSON) also carries the AI chats, when there
 * are any (ns.aichat.exportData): 'mindroot-ai-chats.json' at the root of
 * the ZIP, `aiChats` in the JSON. Coming back they are added beside the
 * chats kept (ns.aichat.importData); a file of chats alone imports too.
 *
 * Errors carry a stable `code` and a message in the person's language. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  var EXT = '.interneuron';
  var EXT_RE = /\.interneuron$/i;
  var META = 'interneuron.json';
  /* A second copy in the same minute gets a number after the clock, which
   * is read back as the same minute. */
  var SNAP_RE = /^(.*)--(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-\d+)?\.md$/i;
  var PNG_KEY = 'mindroot-markdown';
  var VERSION = 1;
  var CHATS_FILE = 'mindroot-ai-chats.json';

  /* The AI chats to carry in a backup, or null (none, or no chat module). */
  async function chatsData() {
    var A = ns.aichat;
    if (!A || typeof A.exportData !== 'function') return null;
    try {
      var data = await A.exportData();
      return data && data.chats && data.chats.length ? data : null;
    } catch (err) { return null; }
  }

  var STRINGS = {
    en: {
      'archive.err.noProject': 'there is no such project',
      'archive.err.notJson': 'this file is not JSON',
      'archive.err.nothing': 'there is nothing to import in this file',
      'archive.err.ipe': 'this is an IPE file: open it in IPE',
      'archive.err.notMindroot': 'this JSON is not a MindRoot export',
      'archive.err.noProjects': 'there are no projects in this file',
      'archive.err.noFolder': '{name} holds no .interneuron folder',
      'archive.err.noMap': '{name} holds no map',
      'archive.err.pngNoMap': '{name} is a picture with no map inside',
      'archive.err.notImportable': '{name} is not something MindRoot can import: a ZIP, a JSON, a .md or a picture exported by MindRoot',
      'archive.err.unreadable': '{name} could not be read',
      'archive.err.inFile': '{name}: {reason}',
      'archive.notProjects.one': '{names} is not a project folder: a project comes in as a folder whose name ends in .interneuron',
      'archive.notProjects.other': '{names} are not project folders: a project comes in as a folder whose name ends in .interneuron',
      'archive.noMapIn': 'there is no map in {names}: a map is a .md, and a project a folder of them',
      'archive.done.projects.one': '{n} project imported',
      'archive.done.projects.other': '{n} projects imported',
      'archive.done.maps.one': '{n} map added to {project}',
      'archive.done.maps.other': '{n} maps added to {project}',
      'archive.done.newProjects.one': '{n} map imported as a project',
      'archive.done.newProjects.other': '{n} maps imported as projects',
      'archive.done.pictures': 'its pictures stayed behind: a loose .md does not carry them',
      'archive.done.sentence': '{what}.',
      'archive.leftOut': 'Left out: {list}',
      'archive.unsafe.one': '{names} in {name}, whose path leads outside the folder',
      'archive.unsafe.other': '{names} in {name}, whose paths lead outside the folder',
      'archive.more.one': '{n} more',
      'archive.more.other': '{n} more',
      'archive.importedProject': 'Imported project',
      'archive.done.chats.one': '{n} AI chat imported',
      'archive.done.chats.other': '{n} AI chats imported'
    },
    it: {
      'archive.err.noProject': 'questo progetto non esiste',
      'archive.err.notJson': 'questo file non è un JSON',
      'archive.err.nothing': "in questo file non c'è niente da importare",
      'archive.err.ipe': 'questo è un file di IPE: aprilo in IPE',
      'archive.err.notMindroot': 'questo JSON non è un\'esportazione di MindRoot',
      'archive.err.noProjects': 'in questo file non ci sono progetti',
      'archive.err.noFolder': '{name} non contiene una cartella .interneuron',
      'archive.err.noMap': '{name} non contiene mappe',
      'archive.err.pngNoMap': "{name} è un'immagine senza una mappa dentro",
      'archive.err.notImportable': "{name} non è un file che MindRoot sa importare: uno ZIP, un JSON, un .md o un'immagine esportata da MindRoot",
      'archive.err.unreadable': 'non è stato possibile leggere {name}',
      'archive.err.inFile': '{name}: {reason}',
      'archive.notProjects.one': '{names} non è la cartella di un progetto: un progetto arriva come una cartella il cui nome finisce in .interneuron',
      'archive.notProjects.other': '{names} non sono cartelle di progetti: un progetto arriva come una cartella il cui nome finisce in .interneuron',
      'archive.noMapIn': 'in {names} non ci sono mappe: una mappa è un .md, e un progetto una cartella di .md',
      'archive.done.projects.one': '{n} progetto importato',
      'archive.done.projects.other': '{n} progetti importati',
      'archive.done.maps.one': '{n} mappa aggiunta a {project}',
      'archive.done.maps.other': '{n} mappe aggiunte a {project}',
      'archive.done.newProjects.one': '{n} mappa importata come progetto',
      'archive.done.newProjects.other': '{n} mappe importate come progetti',
      'archive.done.pictures': 'le sue immagini sono rimaste indietro: un .md da solo non le porta con sé',
      'archive.done.sentence': '{what}.',
      'archive.leftOut': 'Lasciato fuori: {list}',
      'archive.unsafe.one': '{names} in {name}, il cui percorso esce dalla cartella',
      'archive.unsafe.other': '{names} in {name}, i cui percorsi escono dalla cartella',
      'archive.more.one': 'un altro',
      'archive.more.other': 'altri {n}',
      'archive.importedProject': 'Progetto importato',
      'archive.done.chats.one': '{n} chat AI importata',
      'archive.done.chats.other': '{n} chat AI importate'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, function (w, k) { return vars && vars[k] != null ? String(vars[k]) : w; });
  }

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return fill(STRINGS.en[key] || key, vars);
  }

  function plural(key, n, vars) {
    if (ns.i18n && typeof ns.i18n.plural === 'function') return ns.i18n.plural(key, n, vars);
    return fill(STRINGS.en[key + (n === 1 ? '.one' : '.other')] || key, assign({ n: n }, vars));
  }

  function fail(code, vars) {
    var err = new Error(t(code, vars));
    err.code = code;
    return err;
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (source) Object.keys(source).forEach(function (key) { target[key] = source[key]; });
    }
    return target;
  }

  function slug(text, fallback) { return ns.storage.slugify(text) || fallback || 'map'; }

  function two(n) { return String(n).padStart(2, '0'); }

  /* The clock in a copy's name, in local time: the stamp is read by a
   * person looking at the folder, on their own wall clock. The exact time
   * travels in snapshots.json and trash.json. */
  function stamp(ms) {
    var d = new Date(typeof ms === 'number' ? ms : Date.now());
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes());
  }

  function fileStamp() { return stamp(Date.now()); }

  function iso(ms) { return new Date(typeof ms === 'number' && isFinite(ms) ? ms : Date.now()).toISOString(); }

  function msOf(value, fallback) {
    if (typeof value === 'number' && isFinite(value)) return value;
    var parsed = Date.parse(value);
    return isNaN(parsed) ? fallback : parsed;
  }

  /* A name nothing in `taken` uses (case-insensitively: Windows and macOS
   * file systems are), the second one getting a number before its
   * extension - before both halves of a drawing's double one. */
  function unique(taken, name) {
    var lower = name.toLowerCase();
    if (!taken[lower]) { taken[lower] = true; return name; }
    var m = /^(.*?)((?:\.(?:excalidraw|ink))?\.[^.\/]+)?$/i.exec(name);
    var base = m[1];
    var ext = m[2] || '';
    for (var n = 2; ; n++) {
      var next = base + '-' + n + ext;
      if (!taken[next.toLowerCase()]) { taken[next.toLowerCase()] = true; return next; }
    }
  }

  function toText(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function normalizeText(text) { return ns.doc.normalizeText(text); }

  /* Base64 in 32 KB slices: String.fromCharCode.apply on a whole picture
   * would overflow the stack. */
  function bytesToBase64(bytes) {
    var out = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function base64ToBytes(text) {
    var raw = atob(String(text || '').replace(/\s+/g, ''));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function bytesOf(ref) {
    if (!ref) return null;
    return await ns.storage.blobBytes(ref.asset);
  }

  async function dataOf(f) {
    if (!f) return null;
    if (f.data instanceof Uint8Array) return f.data;
    if (f.data && typeof f.data.arrayBuffer === 'function') return new Uint8Array(await f.data.arrayBuffer());
    if (typeof f.data === 'string') return new TextEncoder().encode(f.data);
    return null;
  }

  /* Bytes into storage by what they are: the same bytes arriving twice in
   * one import (assets/ and trash/) are one record, and putBackFiles finds
   * them equal. Within a run the answer is remembered, so the bytes are
   * hashed once. */
  var seenBytes = null;

  async function keepBytes(bytes, name) {
    var key = seenBytes ? bytes.length + ':' + ns.storage.typeOf(name) : null;
    if (key && seenBytes[key]) {
      var list = seenBytes[key];
      for (var i = 0; i < list.length; i++) if (sameBytes(list[i].bytes, bytes)) return list[i].ref;
    }
    var ref = await ns.storage.putBlob(new Blob([bytes], { type: ns.storage.typeOf(name) }), name);
    if (key) (seenBytes[key] = seenBytes[key] || []).push({ bytes: bytes, ref: ref });
    return ref;
  }

  function sameBytes(a, b) {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function onceEach(run) {
    var outer = !seenBytes;
    if (outer) seenBytes = Object.create(null);
    try {
      return await run();
    } finally {
      if (outer) seenBytes = null;
    }
  }

  /* ---------- a project, written out as its folder ---------- */

  function isReservedPath(path) {
    return path.toLowerCase() === META || /^[^/]+\.(md|markdown)$/i.test(path) || /^(trash|snapshots)\//i.test(path);
  }

  /* [{ name, data, date }] for every file of the folder, the names relative
   * to the folder itself. The maps get file names from their own names, and
   * interneuron.json keeps the names exactly, with accents and capitals. */
  async function projectFiles(p) {
    var out = [];
    var taken = Object.create(null);
    taken[META] = true;
    var mapFile = Object.create(null);

    var maps = p.maps.map(function (m) {
      var file = unique(taken, slug(m.name) + '.md');
      mapFile[m.id] = file;
      out.push({ name: file, data: m.text, date: m.updatedAt });
      return { file: file, name: m.name, createdAt: iso(m.createdAt), updatedAt: iso(m.updatedAt) };
    });

    out.push({
      name: META,
      date: p.updatedAt,
      data: JSON.stringify({
        mindroot: 'project', version: VERSION,
        name: p.name, description: p.description, isTemplate: !!p.isTemplate,
        createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt), maps: maps
      }, null, 2) + '\n'
    });

    /* The project's own files under their own paths - except a path the
     * folder already gives a meaning to (interneuron.json, a .md at the top,
     * which is a map, anything in snapshots/ or trash/). A file there,
     * which only a foreign or hand-made import can bring, would clash with
     * what is written beside it and make the whole backup fail; it goes
     * under files/ instead, so its bytes are still in the backup. */
    var paths = Object.keys(p.files).sort();
    var fileTaken = Object.create(null);
    paths.forEach(function (path) { if (!isReservedPath(path)) fileTaken[path.toLowerCase()] = true; });
    for (var i = 0; i < paths.length; i++) {
      var bytes = await bytesOf(p.files[paths[i]]);
      if (!bytes) continue;
      var name = isReservedPath(paths[i]) ? unique(fileTaken, 'files/' + paths[i]) : paths[i];
      out.push({ name: name, data: bytes, date: p.files[paths[i]].modified || undefined });
    }

    /* The copies: named by the map and the minute, as they always were. */
    var snapTaken = Object.create(null);
    snapTaken['snapshots.json'] = true;
    var snapIndex = [];
    p.snapshots.slice().sort(function (a, b) { return a.when - b.when; }).forEach(function (s) {
      var base = (mapFile[s.mapId] || 'map.md').replace(/\.md$/i, '');
      var file = unique(snapTaken, base + '--' + stamp(s.when) + '.md');
      out.push({ name: 'snapshots/' + file, data: s.text, date: s.when });
      snapIndex.unshift({ file: file, kind: s.kind, label: s.label, when: iso(s.when) });
    });
    if (snapIndex.length) out.push({ name: 'snapshots/snapshots.json', data: JSON.stringify(snapIndex, null, 2) + '\n' });

    /* The bin: every entry is a line in trash.json and one or more files
     * beside it - the lines of a branch as a .md, a picture as itself, a map
     * as its .md with its copies. */
    var trashTaken = Object.create(null);
    trashTaken['trash.json'] = true;
    var trashIndex = [];
    for (var k = 0; k < p.trash.length; k++) {
      var e = p.trash[k];
      var line = { kind: e.kind, label: e.label, when: iso(e.deletedAt) };
      if (e.kind === 'branch') {
        line.file = unique(trashTaken, stamp(e.deletedAt) + '-' + slug(e.fragment.label || e.label, 'branch') + '.md');
        out.push({ name: 'trash/' + line.file, data: e.fragment.text, date: e.deletedAt });
        assign(line, {
          map: mapFile[e.mapId] || e.mapName || '', mapName: e.mapName,
          shape: { kind: e.fragment.kind, level: e.fragment.level, indent: e.fragment.indent, label: e.fragment.label },
          origin: e.origin, assets: await trashAssets(out, trashTaken, e.files, e.deletedAt)
        });
      } else if (e.kind === 'figure' || e.kind === 'asset') {
        line.file = unique(trashTaken, e.path.split('/').pop());
        var fileBytes = await bytesOf(e.file);
        if (fileBytes) out.push({ name: 'trash/' + line.file, data: fileBytes, date: e.deletedAt });
        assign(line, { from: e.path, owner: e.owner });
        if (e.kind === 'figure') assign(line, { map: mapFile[e.mapId] || e.mapName || '', mapName: e.mapName, ownerPath: e.ownerPath, field: e.field });
        /* A notebook binned whole: the other files of its folder beside it. */
        if (e.files && Object.keys(e.files).length) line.assets = await trashAssets(out, trashTaken, e.files, e.deletedAt);
      } else if (e.kind === 'map') {
        line.file = unique(trashTaken, slug(e.map.name) + '.md');
        out.push({ name: 'trash/' + line.file, data: e.map.text, date: e.deletedAt });
        var copies = [];
        e.snapshots.forEach(function (s) {
          var file = unique(trashTaken, line.file.replace(/\.md$/i, '') + '--' + stamp(s.when) + '.md');
          out.push({ name: 'trash/' + file, data: s.text, date: s.when });
          copies.push({ file: file, kind: s.kind, label: s.label, when: iso(s.when) });
        });
        assign(line, {
          name: e.map.name, index: e.index, createdAt: iso(e.map.createdAt),
          assets: await trashAssets(out, trashTaken, e.files, e.deletedAt), snapshots: copies
        });
      } else if (e.kind === 'note') {
        /* A deleted note: its words as a .md, where it was in the line. */
        line.file = unique(trashTaken, stamp(e.deletedAt) + '-' + slug(e.label, 'note') + '.md');
        out.push({ name: 'trash/' + line.file, data: e.text, date: e.deletedAt });
        assign(line, {
          map: mapFile[e.mapId] || e.mapName || '', mapName: e.mapName,
          owner: e.owner, ownerPath: e.ownerPath, noteKind: e.noteKind
        });
      } else if (e.kind === 'snapshot') {
        line.file = unique(trashTaken, slug(e.mapName, 'map') + '--' + stamp(e.snapshot.when) + '.md');
        out.push({ name: 'trash/' + line.file, data: e.snapshot.text, date: e.deletedAt });
        assign(line, {
          map: mapFile[e.snapshot.mapId] || '', mapName: e.mapName,
          snapshotKind: e.snapshot.kind, note: e.snapshot.label, taken: iso(e.snapshot.when)
        });
      }
      trashIndex.push(line);
    }
    if (trashIndex.length) out.push({ name: 'trash/trash.json', data: JSON.stringify(trashIndex, null, 2) + '\n' });
    return out;
  }

  /* The files a binned branch or map took with it, written into trash/ and
   * listed as { path in the text: file in trash/ }. */
  async function trashAssets(out, taken, files, when) {
    var mapping = {};
    var paths = Object.keys(files || {});
    for (var i = 0; i < paths.length; i++) {
      var bytes = await bytesOf(files[paths[i]]);
      if (!bytes) continue;
      var file = unique(taken, paths[i].split('/').pop());
      out.push({ name: 'trash/' + file, data: bytes, date: when });
      mapping[paths[i]] = file;
    }
    return mapping;
  }

  function folderName(p, taken) {
    var name = slug(p.name, 'project') + EXT;
    return taken ? unique(taken, name) : name;
  }

  /* opts: { deflate } - stored by default, as every MindRoot wrote them. */
  async function projectZip(pid, opts) {
    var p = ns.store.project(pid);
    if (!p) throw fail('archive.err.noProject');
    var folder = folderName(p);
    var files = await projectFiles(p);
    var blob = await ns.zip.build(files.map(function (f) {
      return { name: folder + '/' + f.name, data: f.data, date: f.date };
    }), { deflate: !!(opts && opts.deflate) });
    return { name: folder + '.zip', blob: blob };
  }

  async function workspaceZip(opts) {
    var taken = Object.create(null);
    var entries = [];
    var list = ns.store.projects();
    for (var i = 0; i < list.length; i++) {
      var folder = folderName(list[i], taken);
      (await projectFiles(list[i])).forEach(function (f) {
        entries.push({ name: folder + '/' + f.name, data: f.data, date: f.date });
      });
    }
    var chats = await chatsData();
    if (chats) entries.push({ name: CHATS_FILE, data: JSON.stringify(chats, null, 2) + '\n', date: Date.now() });
    var blob = await ns.zip.build(entries, { deflate: !!(opts && opts.deflate) });
    return { name: 'mindroot-' + fileStamp() + '.zip', blob: blob };
  }

  /* ---------- the JSON ---------- */

  async function assetPayload(list) {
    var out = [];
    var ids = Object.keys(ns.storage.referencedAssets(list));
    for (var i = 0; i < ids.length; i++) {
      var blob = await ns.storage.getBlob(ids[i]);
      if (!blob) continue;
      out.push({ id: ids[i], type: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
    return out;
  }

  async function projectJson(pid) {
    var p = ns.store.project(pid);
    if (!p) throw fail('archive.err.noProject');
    var data = ns.store.exportProject(pid);
    data.assets = await assetPayload([p]);
    var text = JSON.stringify(data, null, 2);
    return { name: slug(p.name, 'project') + '-' + fileStamp() + '.json', blob: new Blob([text], { type: 'application/json' }) };
  }

  async function workspaceJson() {
    var list = ns.store.projects();
    var data = {
      mindroot: 'workspace', version: VERSION, exportedAt: Date.now(),
      projects: JSON.parse(JSON.stringify(list)),
      assets: await assetPayload(list)
    };
    var chats = await chatsData();
    if (chats) data.aiChats = chats;
    var text = JSON.stringify(data, null, 2);
    return { name: 'mindroot-workspace-' + fileStamp() + '.json', blob: new Blob([text], { type: 'application/json' }) };
  }

  /* Every reference to a set of bytes in a raw project, renamed. */
  function remapAssets(raw, ids) {
    function ref(r) {
      if (r && typeof r === 'object' && typeof r.asset === 'string' && ids[r.asset]) r.asset = ids[r.asset];
    }
    function files(f) {
      if (f && typeof f === 'object') Object.keys(f).forEach(function (k) { ref(f[k]); });
    }
    files(raw.files);
    (Array.isArray(raw.trash) ? raw.trash : []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      files(e.files);
      ref(e.file);
    });
  }

  /* The bytes a JSON carries go into storage first, by content - so an id
   * in the file can never overwrite other bytes already here - and the
   * references follow the ids they got. */
  async function projectsFromJson(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (err) { throw fail('archive.err.notJson'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('archive.err.nothing');
    if (raw.ipe) throw fail('archive.err.ipe');
    var list;
    if (raw.mindroot === 'workspace') list = Array.isArray(raw.projects) ? raw.projects : [];
    else if (raw.mindroot === 'project' || Array.isArray(raw.maps)) list = [raw];
    else throw fail('archive.err.notMindroot');
    list = list.filter(function (p) { return p && typeof p === 'object'; });
    if (!list.length) throw fail('archive.err.noProjects');
    var ids = Object.create(null);
    var assets = Array.isArray(raw.assets) ? raw.assets : [];
    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a || typeof a.id !== 'string' || typeof a.data !== 'string') continue;
      var bytes;
      try { bytes = base64ToBytes(a.data); } catch (err) { continue; }
      var type = a.type || a.mime || ns.storage.typeOf(a.name || '');
      var ref = await ns.storage.putBlob(new Blob([bytes], { type: type }), a.name || '');
      ids[a.id] = ref.asset;
    }
    list.forEach(function (p) { remapAssets(p, ids); });
    return list.map(function (p) {
      var copy = assign({}, p);
      delete copy.assets;
      delete copy.mindroot;
      delete copy.version;
      delete copy.exportedAt;
      return copy;
    });
  }

  /* ---------- a folder, read back as a project ---------- */

  /* files: [{ path, data: Uint8Array | Blob, lastModified? }], the paths
   * relative to the project folder. Returns the project as the store's
   * import takes it, with the bytes already in storage. Nothing is required
   * but a .md: a folder somebody put together by hand is a project of its
   * .md files. */
  function projectFromFiles(files, fallbackName) {
    return onceEach(function () { return readProject(files, fallbackName); });
  }

  async function readProject(files, fallbackName) {
    var byPath = Object.create(null);
    files.forEach(function (f) { byPath[f.path] = f; });

    async function text(path) {
      var b = await dataOf(byPath[path]);
      return b ? normalizeText(toText(b)) : null;
    }
    async function json(path) {
      var s = await text(path);
      if (s == null) return null;
      try { return JSON.parse(s); } catch (err) { return null; }
    }
    async function ref(path) {
      var b = await dataOf(byPath[path]);
      return b ? await keepBytes(b, path.split('/').pop()) : null;
    }

    var meta = await json(META);
    if (!meta || typeof meta !== 'object') meta = {};
    var top = files.filter(function (f) { return /^[^/]+\.(md|markdown)$/i.test(f.path); }).map(function (f) { return f.path; });
    if (!top.length && !(Array.isArray(meta.maps) && meta.maps.length)) return null;

    /* The maps: in the order interneuron.json gives, then any .md it does
     * not mention, by name. */
    var order = [];
    var named = Object.create(null);
    (Array.isArray(meta.maps) ? meta.maps : []).forEach(function (m) {
      if (m && typeof m.file === 'string' && byPath[m.file] && !named[m.file.toLowerCase()]) {
        order.push({ file: m.file, name: m.name, createdAt: m.createdAt, updatedAt: m.updatedAt });
        named[m.file.toLowerCase()] = true;
      }
    });
    top.sort(function (a, b) { return a.localeCompare(b, 'it', { sensitivity: 'base' }); }).forEach(function (file) {
      if (!named[file.toLowerCase()]) order.push({ file: file });
    });

    var now = Date.now();
    var maps = [];
    var mapByFile = Object.create(null);
    var mapByBase = Object.create(null);
    for (var i = 0; i < order.length; i++) {
      var base = order[i].file.replace(/\.(md|markdown)$/i, '');
      var made = {
        id: 'm' + i + '-' + now.toString(36),
        name: typeof order[i].name === 'string' && order[i].name ? order[i].name : base,
        text: (await text(order[i].file)) || '',
        createdAt: msOf(order[i].createdAt, now), updatedAt: msOf(order[i].updatedAt, now)
      };
      maps.push(made);
      mapByFile[order[i].file.toLowerCase()] = made;
      mapByBase[base.toLowerCase()] = made;
    }

    /* Every other file that is not the bin or the copies is the project's:
     * assets/, templates/, and anything else somebody keeps in the folder. */
    var projectFilesIn = {};
    for (var k = 0; k < files.length; k++) {
      var path = files[k].path;
      if (path === META || /^[^/]+\.(md|markdown)$/i.test(path) || /^(trash|snapshots)\//i.test(path)) continue;
      var r = await ref(path);
      if (r) projectFilesIn[path] = r;
    }

    /* The copies: by the prefix in their name, which says whose they are;
     * the time from snapshots.json (to the second, in any time zone), or
     * from the name (to the minute, local time) when the index is missing. */
    var snapIndex = await json('snapshots/snapshots.json');
    var snapKnown = Object.create(null);
    (Array.isArray(snapIndex) ? snapIndex : []).forEach(function (s) {
      if (s && typeof s.file === 'string') snapKnown[s.file.toLowerCase()] = s;
    });
    var snapshots = [];
    for (var s = 0; s < files.length; s++) {
      var sm = /^snapshots\/([^/]+)$/i.exec(files[s].path);
      if (!sm) continue;
      var parts = SNAP_RE.exec(sm[1]);
      if (!parts) continue;
      var owner = mapByBase[parts[1].toLowerCase()];
      if (!owner) continue;
      var known = snapKnown[sm[1].toLowerCase()] || {};
      var fromName = new Date(+parts[2], +parts[3] - 1, +parts[4], +parts[5], +parts[6]).getTime();
      snapshots.push({
        id: 's' + s + '-' + now.toString(36),
        mapId: owner.id,
        when: msOf(known.when, fromName),
        kind: known.kind === 'manual' ? 'manual' : 'auto',
        label: typeof known.label === 'string' ? known.label : '',
        text: await text(files[s].path)
      });
    }

    var trash = await trashFromFiles(files, byPath, mapByFile, maps, text, now);

    return {
      name: (typeof meta.name === 'string' && meta.name) || fallbackName || (maps[0] && maps[0].name) || t('archive.importedProject'),
      description: typeof meta.description === 'string' ? meta.description : '',
      isTemplate: !!meta.isTemplate,
      createdAt: msOf(meta.createdAt, now), updatedAt: msOf(meta.updatedAt, now),
      maps: maps, files: projectFilesIn, snapshots: snapshots, trash: trash
    };
  }

  /* trash.json read back into entries. A line without a kind is one MindRoot
   * wrote before the bin held anything but files - a picture, with the words
   * of the node it hung from - and a file in trash/ with no line at all is
   * still something somebody threw away: listed as a file, restorable into
   * assets/. */
  async function trashFromFiles(files, byPath, mapByFile, maps, text, now) {
    var index = null;
    if (byPath['trash/trash.json']) {
      try { index = JSON.parse(toText(await dataOf(byPath['trash/trash.json']))); } catch (err) { index = null; }
    }
    var lines = Array.isArray(index) ? index : [];
    var used = Object.create(null);
    used['trash.json'] = true;
    var out = [];

    async function fileRef(name) {
      if (typeof name !== 'string') return null;
      var f = byPath['trash/' + name];
      if (!f) return null;
      used[name] = true;
      return await keepBytes(await dataOf(f), name);
    }
    async function refsOf(mapping) {
      var refs = {};
      var keys = Object.keys(mapping && typeof mapping === 'object' ? mapping : {});
      for (var i = 0; i < keys.length; i++) {
        var r = await fileRef(mapping[keys[i]]);
        if (r) refs[keys[i]] = r;
      }
      return refs;
    }
    function mapIdOf(file) {
      var found = file ? mapByFile[String(file).toLowerCase()] : null;
      return found ? found.id : '';
    }
    function id(prefix, i) { return prefix + i + '-' + now.toString(36); }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || typeof line.file !== 'string') continue;
      var when = msOf(line.when, now);
      var kind = line.kind || 'asset';
      if (kind === 'branch') {
        var fragment = await text('trash/' + line.file);
        if (fragment == null) continue;
        used[line.file] = true;
        var shape = line.shape || {};
        out.push({
          id: id('t', i), kind: 'branch', deletedAt: when, label: line.label,
          mapId: mapIdOf(line.map), mapName: line.mapName || '',
          fragment: { text: fragment, kind: shape.kind, level: shape.level, indent: shape.indent, label: shape.label || line.label },
          origin: line.origin, files: await refsOf(line.assets)
        });
      } else if (kind === 'figure' || kind === 'asset') {
        var r = await fileRef(line.file);
        var entry = {
          id: id('t', i), kind: kind, deletedAt: when, label: line.label || line.file,
          path: line.from || ('assets/' + line.file), file: r, owner: line.owner || '',
          mapId: mapIdOf(line.map), mapName: line.mapName || '', ownerPath: line.ownerPath, field: line.field
        };
        if (line.assets) entry.files = await refsOf(line.assets);
        /* A line from before, when a folder held one map: its `label` was the
         * words of the node the picture hung from, and putting it back meant
         * putting it back on that node. It still does. */
        if (!line.kind) {
          entry.label = line.file;
          entry.owner = line.label || '';
          if (entry.owner && maps.length === 1) {
            entry.kind = 'figure';
            entry.mapId = maps[0].id;
            entry.mapName = maps[0].name;
          }
        }
        out.push(entry);
      } else if (kind === 'map') {
        var mapText = await text('trash/' + line.file);
        if (mapText == null) continue;
        used[line.file] = true;
        var mapId = id('tm', i);
        var copies = [];
        var list = Array.isArray(line.snapshots) ? line.snapshots : [];
        for (var c = 0; c < list.length; c++) {
          if (!list[c] || typeof list[c].file !== 'string') continue;
          var copyText = await text('trash/' + list[c].file);
          if (copyText == null) continue;
          used[list[c].file] = true;
          copies.push({ mapId: mapId, when: msOf(list[c].when, when), kind: list[c].kind, label: list[c].label, text: copyText });
        }
        out.push({
          id: id('t', i), kind: 'map', deletedAt: when, label: line.label || line.name,
          index: line.index,
          map: { id: mapId, name: line.name || line.label, text: mapText, createdAt: msOf(line.createdAt, when), updatedAt: when },
          files: await refsOf(line.assets), snapshots: copies
        });
      } else if (kind === 'note') {
        var noteText = await text('trash/' + line.file);
        if (noteText == null) continue;
        used[line.file] = true;
        out.push({
          id: id('t', i), kind: 'note', deletedAt: when, label: line.label,
          text: noteText, noteKind: line.noteKind === 'edge' ? 'edge' : 'node',
          owner: line.owner || '', ownerPath: typeof line.ownerPath === 'string' ? line.ownerPath : null,
          mapId: mapIdOf(line.map), mapName: line.mapName || ''
        });
      } else if (kind === 'snapshot') {
        var snapText = await text('trash/' + line.file);
        if (snapText == null) continue;
        used[line.file] = true;
        out.push({
          id: id('t', i), kind: 'snapshot', deletedAt: when, label: line.label,
          mapName: line.mapName || '',
          snapshot: {
            mapId: mapIdOf(line.map), when: msOf(line.taken, when),
            kind: line.snapshotKind === 'manual' ? 'manual' : 'auto', label: line.note || '', text: snapText
          }
        });
      }
    }

    for (var f = 0; f < files.length; f++) {
      var m = /^trash\/([^/]+)$/i.exec(files[f].path);
      if (!m || used[m[1]]) continue;
      var loose = await fileRef(m[1]);
      out.push({
        id: id('tl', f), kind: 'asset', deletedAt: files[f].lastModified || now,
        label: m[1], path: 'assets/' + m[1], file: loose, owner: ''
      });
    }
    return out;
  }

  /* ---------- whatever was handed over, sorted into projects ---------- */

  function tidyPath(path) { return String(path).replace(/\\/g, '/').replace(/^\/+/, ''); }

  function isHidden(path) { return /(^|\/)\./.test(path); }

  /* What no project wants and no import may do: litter from other systems,
   * and paths that climb out of the folder. */
  function isRefused(path) {
    return /(^|\/)\.\.(\/|$)/.test(path) || /^[a-z]:/i.test(path) || ns.zip.isJunk(path);
  }

  function isProjectFolder(name) { return EXT_RE.test(String(name || '')); }

  /* What sits at the top of what was handed over, split in two: the
   * `.interneuron` folders, which are projects, and everything else, which
   * is not. Hidden files and litter are neither. */
  function sortTop(entries) {
    var seen = Object.create(null);
    var out = { projects: [], others: [] };
    entries.forEach(function (e) {
      var path = tidyPath(e.path);
      if (!path || isHidden(path) || isRefused(path)) return;
      var slash = path.indexOf('/');
      var top = slash < 0 ? path : path.slice(0, slash);
      if (seen[top]) return;
      seen[top] = true;
      (slash > 0 && isProjectFolder(top) ? out.projects : out.others).push(top);
    });
    return out;
  }

  /* entries: [{ path, data }] with paths as they came - from a ZIP, from a
   * folder picked or dropped. A project comes in as its `<name>.interneuron`
   * folder: each one at the top of what was handed over is a project, and
   * whatever lies beside them is left out.
   *
   * `loose` reads a folder as it is: a `.interneuron` at any depth, and with
   * none the folder itself, if it has a .md in it (a plain folder of notes,
   * brought in after the person said so). */
  function projectsFromEntries(entries, options) {
    var loose = !!(options && options.loose);
    return onceEach(function () { return readEntries(entries, loose); });
  }

  async function readEntries(entries, loose) {
    var clean = entries.map(function (e) {
      return { path: tidyPath(e.path), data: e.data, lastModified: e.lastModified };
    }).filter(function (e) { return e.path && !isHidden(e.path) && !isRefused(e.path); });

    /* The projects of a ZIP in the order they come: a backup writes them in
     * the order of the sidebar, and that order is the person's (sorting by
     * folder name would put 'garden-copy' before 'garden'). */
    var roots = Object.create(null);
    var rootList = [];
    clean.forEach(function (e) {
      var parts = e.path.split('/');
      var depth = loose ? parts.length - 1 : Math.min(1, parts.length - 1);
      for (var i = 0; i < depth; i++) {
        if (EXT_RE.test(parts[i])) {
          var key = parts.slice(0, i + 1).join('/');
          if (!roots[key]) { roots[key] = true; rootList.push(key); }
          break;
        }
      }
    });

    /* A folder read from the disk comes in no order of its own: by name. */
    if (loose) rootList.sort();
    var out = [];
    for (var r = 0; r < rootList.length; r++) {
      var prefix = rootList[r] + '/';
      var files = clean.filter(function (e) { return e.path.indexOf(prefix) === 0; })
        .map(function (e) { return { path: e.path.slice(prefix.length), data: e.data, lastModified: e.lastModified }; });
      var project = await projectFromFiles(files, rootList[r].split('/').pop().replace(EXT_RE, ''));
      if (project) out.push(project);
    }
    if (out.length || !loose) return out;

    /* No `.interneuron` anywhere. A single folder around everything is taken
     * off: it is the folder, and its name is the project's. */
    var first = clean.length ? clean[0].path.split('/')[0] : '';
    var wrapped = first && clean.every(function (e) { return e.path.indexOf(first + '/') === 0; });
    var files2 = wrapped
      ? clean.map(function (e) { return { path: e.path.slice(first.length + 1), data: e.data, lastModified: e.lastModified }; })
      : clean;
    var project2 = await projectFromFiles(files2, wrapped ? first : '');
    return project2 ? [project2] : [];
  }

  /* ---------- reading what the browser hands over ---------- */

  /* A folder dropped on the page, through the entries API every browser has:
   * a directory reader hands its children over in batches until it hands
   * over none. */
  function readDropped(entry, prefix) {
    prefix = prefix || '';
    return new Promise(function (resolve, reject) {
      if (entry.isFile) {
        entry.file(function (file) {
          resolve([{ path: prefix + entry.name, data: file, lastModified: file.lastModified }]);
        }, reject);
        return;
      }
      var reader = entry.createReader();
      var children = [];
      (function more() {
        reader.readEntries(function (batch) {
          if (!batch.length) {
            Promise.all(children.map(function (child) { return readDropped(child, prefix + entry.name + '/'); }))
              .then(function (lists) { resolve([].concat.apply([], lists)); }, reject);
            return;
          }
          children = children.concat(Array.prototype.slice.call(batch));
          more();
        }, reject);
      })();
    });
  }

  /* The files of an <input webkitdirectory>: each one knows its path. */
  function fromDirectoryInput(fileList) {
    return Array.prototype.slice.call(fileList || []).map(function (file) {
      return { path: file.webkitRelativePath || file.name, data: file, lastModified: file.lastModified };
    });
  }

  /* ---------- a picture that carries its map ---------- */

  function latin1(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  async function inflateZlib(bytes) {
    if (typeof DecompressionStream !== 'function') return null;
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      return null;
    }
  }

  /* The text of a tEXt, zTXt or iTXt chunk whose keyword is ours. */
  async function chunkText(type, data) {
    var nul = data.indexOf(0);
    if (nul < 1 || latin1(data.subarray(0, nul)) !== PNG_KEY) return null;
    if (type === 'tEXt') return latin1(data.subarray(nul + 1));
    if (type === 'zTXt') {
      var z = await inflateZlib(data.subarray(nul + 2));
      return z ? latin1(z) : null;
    }
    var compressed = data[nul + 1] === 1;
    var lang = data.indexOf(0, nul + 3);
    if (lang < 0) return null;
    var translated = data.indexOf(0, lang + 1);
    if (translated < 0) return null;
    var body = data.subarray(translated + 1);
    if (compressed) body = await inflateZlib(body);
    if (!body) return null;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(body); } catch (err) { return null; }
  }

  /* The Markdown a PNG exported by MindRoot carries in its iTXt chunk
   * 'mindroot-markdown' (tEXt and zTXt are read too), or null. Chunks are
   * checked against their CRC: a damaged one is not a map. */
  async function markdownFromPng(input) {
    var bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    var SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 8) return null;
    for (var s = 0; s < 8; s++) if (bytes[s] !== SIG[s]) return null;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var at = 8;
    while (at + 12 <= bytes.length) {
      var length = view.getUint32(at);
      var typeBytes = bytes.subarray(at + 4, at + 8);
      var type = latin1(typeBytes);
      if (at + 12 + length > bytes.length) return null;
      if (type === 'IEND') break;
      if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
        var data = bytes.subarray(at + 8, at + 8 + length);
        if (ns.zip.crc32(data, ns.zip.crc32(typeBytes)) === view.getUint32(at + 8 + length)) {
          var found = await chunkText(type, data);
          if (found != null) return normalizeText(found);
        }
      }
      at += 12 + length;
    }
    return null;
  }

  /* ---------- one file handed over on its own ---------- */

  function isZip(file, name) {
    return /\.zip$/i.test(name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
  }

  /* A ZIP, a JSON, a .md or a PNG. Returns { projects: [raw...], skipped }
   * or { map: { name, text } }; `skipped` names the entries of a ZIP that
   * were refused for where their path leads ('..', a drive), so the message
   * can say so.
   *
   * A ZIP comes in when it holds `.interneuron` folders, whatever the ZIP
   * itself is called (a browser renames a second download). A ZIP called
   * `<name>.interneuron.zip` with the files of the folder straight inside
   * is that folder zipped from within, and comes in as it. */
  async function readFile(file) {
    var name = String(file.name || '');
    if (isZip(file, name)) {
      var read = await ns.zip.read(file);
      var entries = read.map(function (e) {
        return { path: e.name, data: e.data, lastModified: e.date ? e.date.getTime() : undefined };
      });
      /* The chats of a backup, at its root: taken out before the projects are read. */
      var chatsIn = null;
      entries = entries.filter(function (e) {
        if (tidyPath(e.path) !== CHATS_FILE) return true;
        try { chatsIn = JSON.parse(toText(e.data)); } catch (err) { chatsIn = null; }
        return false;
      });
      if (chatsIn && !sortTop(entries).projects.length && !/^(.+\.interneuron)\.zip$/i.test(name)) return { projects: [], chats: chatsIn, skipped: (read.skipped || []).slice() };
      if (!sortTop(entries).projects.length) {
        var own = /^(.+\.interneuron)\.zip$/i.exec(name);
        if (!own) throw fail('archive.err.noFolder', { name: name });
        entries = entries.map(function (e) { return assign({}, e, { path: own[1] + '/' + tidyPath(e.path) }); });
      }
      var projects = await projectsFromEntries(entries);
      if (!projects.length) throw fail('archive.err.noMap', { name: name });
      return { projects: projects, chats: chatsIn, skipped: (read.skipped || []).slice() };
    }
    if (/\.json$/i.test(name) || file.type === 'application/json') {
      var text = await file.text();
      var head = null;
      try { head = JSON.parse(text); } catch (err) { head = null; }
      if (head && head.mindroot === 'ai-chats') return { projects: [], chats: head };
      return { projects: await projectsFromJson(text), chats: head && head.aiChats ? head.aiChats : null };
    }
    if (/\.(md|markdown)$/i.test(name)) {
      return { map: { name: name.replace(/\.(md|markdown)$/i, ''), text: normalizeText(await file.text()) } };
    }
    if (/\.png$/i.test(name) || file.type === 'image/png') {
      var markdown = await markdownFromPng(file);
      if (markdown == null) throw fail('archive.err.pngNoMap', { name: name });
      return { map: { name: name.replace(/\.png$/i, '').replace(/\.mindroot$/i, ''), text: markdown } };
    }
    throw fail('archive.err.notImportable', { name: name });
  }

  /* ---------- everything that arrives at once: one step, one message ---------- */

  function errorText(err, name) {
    var reason = (err && err.message) || String(err);
    if (!name || reason.indexOf(name) >= 0) return reason;
    return t('archive.err.inFile', { name: name, reason: reason });
  }

  function listText(items) {
    return ns.i18n && typeof ns.i18n.list === 'function' ? ns.i18n.list(items) : items.join(', ');
  }

  /* A list of names short enough for a toast: the first few, then how many
   * more. */
  function someNames(names) {
    var SHOWN = 4;
    if (names.length <= SHOWN + 1) return listText(names);
    return listText(names.slice(0, SHOWN).concat([plural('archive.more', names.length - SHOWN)]));
  }

  /* projects (raw) and maps ({ name, text }) into the store in ONE step of
   * undo. Loose maps go into `projectId` (the project open when the import
   * started, not the one an import in the same batch just opened), or each
   * becomes a project of its own when there is none. Returns
   * { projects, maps, errors, message }: `message` says what came in and
   * what was left out, in one sentence - a second toast would cover the
   * first. */
  function commitImport(projects, maps, errors, projectId) {
    var store = ns.store;
    var out = { projects: [], maps: [], newProjects: 0, errors: errors.slice(), message: '' };
    if (projects.length || maps.length) {
      var target = projectId && store.project(projectId) ? projectId : null;
      var label = maps.length === 1 && !projects.length ? 'store.label.importMap' : 'store.label.import';
      store.transaction(label, function () {
        if (projects.length) out.projects = store.importProjects(projects, label);
        maps.forEach(function (m) {
          if (!target) {
            var made = store.createProject({ name: m.name, maps: [{ name: m.name, text: m.text }] });
            if (made) { out.projects.push(made); out.newProjects++; }
            return;
          }
          var added = store.createMap(target, { name: m.name, text: m.text, label: 'store.label.importMap' });
          if (added) out.maps.push({ projectId: target, mapId: added.id, name: added.name });
        });
      });
    }
    var said = [];
    var imported = out.projects.length - out.newProjects;
    if (imported) said.push(plural('archive.done.projects', imported));
    if (out.maps.length) {
      said.push(plural('archive.done.maps', out.maps.length, { project: store.project(out.maps[0].projectId).name }));
    }
    if (out.newProjects) said.push(plural('archive.done.newProjects', out.newProjects));
    var looseIn = out.maps.length + out.newProjects > 0;
    if (looseIn && maps.some(function (m) { return ns.doc.refsInText(m.text).length > 0; })) said.push(t('archive.done.pictures'));
    var parts = [];
    if (said.length) parts.push(t('archive.done.sentence', { what: said.join(', ') }));
    if (out.errors.length) parts.push(t('archive.leftOut', { list: out.errors.join(' · ') }));
    out.message = parts.join(' ');
    return out;
  }

  /* Files picked, dropped or launched (ZIP, JSON, .md, PNG), any mix. */
  async function importFiles(files, opts) {
    opts = opts || {};
    var store = ns.store;
    var target = opts.projectId !== undefined ? opts.projectId : store.here().projectId;
    var projects = [];
    var maps = [];
    var errors = [];
    var list = Array.prototype.slice.call(files || []);
    var chatSets = [];
    for (var i = 0; i < list.length; i++) {
      try {
        var got = await readFile(list[i]);
        if (got.chats) chatSets.push(got.chats);
        if (got.projects) projects = projects.concat(got.projects);
        if (got.map) maps.push(got.map);
        if (got.skipped && got.skipped.length) {
          errors.push(plural('archive.unsafe', got.skipped.length, { names: someNames(got.skipped), name: list[i].name }));
        }
      } catch (err) {
        errors.push(errorText(err, list[i] && list[i].name));
      }
    }
    var chatsIn = 0;
    for (var c = 0; c < chatSets.length; c++) {
      try { chatsIn += ns.aichat && ns.aichat.importData ? await ns.aichat.importData(chatSets[c]) : 0; } catch (err) { errors.push(errorText(err)); }
    }
    var out = commitImport(projects, maps, errors, target);
    if (chatsIn) {
      var said = plural('archive.done.chats', chatsIn);
      out.message = out.message ? out.message + ' ' + t('archive.done.sentence', { what: said }) : t('archive.done.sentence', { what: said });
      out.chats = chatsIn;
    }
    return out;
  }

  /* The files of folders picked or dropped. Only a .interneuron folder is a
   * project: one with another name is left out and named in the message
   * (unless `loose`, which reads a plain folder of .md files as a project). */
  async function importEntries(entries, opts) {
    opts = opts || {};
    var loose = !!opts.loose;
    var top = sortTop(entries);
    var errors = [];
    if (!loose && top.others.length) errors.push(plural('archive.notProjects', top.others.length, { names: listText(top.others) }));
    var projects = await projectsFromEntries(entries, { loose: loose });
    var read = loose ? top.others.concat(top.projects) : top.projects;
    if (!projects.length && read.length) errors.push(t('archive.noMapIn', { names: listText(read) }));
    return commitImport(projects, [], errors, null);
  }

  /* ---------- handing a file to the person ---------- */

  /* The tests replace this to catch what would have been downloaded. */
  function defaultDownloader(name, blob) {
    if (ns.util && typeof ns.util.download === 'function') return ns.util.download(blob, name);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 30000);
    return null;
  }

  var downloader = defaultDownloader;

  function download(file) {
    downloader(file.name, file.blob);
    return file.name;
  }

  function setDownloader(fn) { downloader = typeof fn === 'function' ? fn : defaultDownloader; }

  ns.archive = {
    EXT: EXT,
    projectFiles: projectFiles,
    projectZip: projectZip,
    workspaceZip: workspaceZip,
    projectJson: projectJson,
    workspaceJson: workspaceJson,
    projectsFromJson: projectsFromJson,
    projectFromFiles: projectFromFiles,
    projectsFromEntries: projectsFromEntries,
    isProjectFolder: isProjectFolder,
    sortTop: sortTop,
    readDropped: readDropped,
    fromDirectoryInput: fromDirectoryInput,
    readFile: readFile,
    markdownFromPng: markdownFromPng,
    importFiles: importFiles,
    importEntries: importEntries,
    download: download,
    setDownloader: setDownloader,
    stamp: stamp
  };
})(window.MindRoot);
