/* MindRoot - settings: how MindRoot looks and behaves, where the maps are
 * kept, and the backup that keeps them safe from the browser.
 *
 * One sheet (Mod+,), every control applied the moment it changes: theme
 * (system, light, dark) and language (the sheet itself is rebuilt in the
 * new language, focus kept on the control), reduce transparency, the
 * liquid-glass decoration, the map's own options (random colours for new
 * nodes, text in the branch colour, map and Markdown following each other)
 * and the clock copies' interval. Which side of the root a branch grows on
 * is no setting: it is chosen on the map, branch by branch, and written in
 * the map itself.
 *
 * Storage: what the browser says is used, and whether it promised to keep
 * the data (navigator.storage.persisted). A browser may evict a site's data
 * under disk pressure unless it was asked not to; the button asks
 * (storage.persist, which only works over http(s): from a file the browser
 * decides by itself, and the sheet says so instead of offering a button
 * that cannot work).
 *
 * Backup: everything, as one ZIP of .interneuron folders (archive
 * workspaceZip, readable without MindRoot: every map is a .md); restore
 * reads such a ZIP (or a JSON export) back in beside what is there - it
 * never overwrites. The date of the last backup is kept, and after a week
 * without one a quiet banner offers it, once a session, snoozed for a week
 * when dismissed. A first visit is not reminded until it has had a week of
 * maps worth keeping. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  /* The release this page is (sw.js names its cache after the same one). */
  var VERSION = '2.0.0';
  var DAY = 86400000;
  var REMIND_AFTER = 7 * DAY;
  var BACKUP_ACCEPT = '.zip,.json,application/zip,application/json';

  ns.i18n.add({
    en: {
      'settings.title': 'Settings',
      'settings.look': 'Appearance',
      'settings.theme': 'Theme',
      'settings.theme.system': 'System',
      'settings.theme.light': 'Light',
      'settings.theme.dark': 'Dark',
      'settings.lang': 'Language',
      'settings.langHint': 'MindRoot is in English. Italian is here as a second language, and stays chosen until you change it.',
      'settings.transparency': 'Reduce transparency',
      'settings.transparencyHint': 'Solid bars instead of frosted glass.',
      'settings.glass': 'Liquid glass effect',
      'settings.glassHint': 'A light refraction on the top bars and the welcome card. Only in Chromium browsers with a mouse, and never with reduced motion.',
      'settings.cursor': 'MindRoot pointer',
      'settings.cursorHint': "The app's own arrow, in the colours of the theme, with a mouse or a trackpad. Off: the system pointer.",
      'settings.map': 'Map',
      'settings.notebooks': 'Notebooks',
      'settings.nbPaper': 'Paper of new notebooks',
      'settings.nbPaperHint': 'What a new board or drawing starts on. A notebook keeps its own once it exists, and each of its canvases can have another (notebook settings, "Applies to").',
      'settings.nbBackground': 'Background of new notebooks',
      'settings.nbBackgroundHint': 'Automatic follows the app theme: light paper in the light theme, dark paper in the dark one.',
      'settings.dice': 'Random colours for new nodes',
      'settings.diceHint': 'A new branch gets a colour of its own instead of the palette.',
      'settings.branchText': 'Text in the branch colour',
      'settings.branchTextHint': 'Node words take the colour of their branch; exports follow.',
      'settings.drop': 'A node let go on top of others',
      'settings.dropHint': 'Nodes stay where you let them go. When that is on top of other nodes, MindRoot can move the node to the nearest free place, move the others out of its way, or leave it as it is.',
      'settings.drop.move': 'Move it to free space',
      'settings.drop.aside': 'Move the others aside',
      'settings.drop.keep': 'Leave it there',
      'settings.sync': 'Map and Markdown follow each other',
      'settings.syncHint': 'Choosing a node moves the Markdown caret to it, and the other way round.',
      'settings.copies': 'Copies on the clock',
      'settings.copiesEvery': 'A copy every',
      'settings.copiesAfter': 'of every map that changed',
      'settings.unit.m': 'minutes',
      'settings.unit.h': 'hours',
      'settings.unitN.m.one': 'minute', 'settings.unitN.m.other': 'minutes',
      'settings.unitN.h.one': 'hour', 'settings.unitN.h.other': 'hours',
      'settings.storage': 'Storage and backup',
      'settings.usage': '{used} used of the {quota} this browser allows',
      'settings.usageOnly': '{used} used',
      'settings.usageUnknown': 'This browser does not say how much space is used.',
      'settings.persisted': 'Kept for good',
      'settings.bestEffort': 'May be cleared by the browser',
      'settings.persistedText': 'The browser promised not to clear your maps to free space.',
      'settings.bestEffortText': 'When the disk is short of space, the browser may clear what it keeps for MindRoot. A backup keeps your maps whatever happens.',
      'settings.persist': 'Keep my maps for good',
      'settings.persistFile': 'Opened from a file, the browser decides by itself whether to keep the data; installed as an app it can be asked. Backups keep your maps in any case.',
      'settings.persistDone': 'The browser will keep your maps.',
      'settings.persistRefused': 'The browser did not promise. Back up from time to time.',
      'settings.memory': 'This browser keeps nothing for this page: export or back up before closing it.',
      'settings.backup': 'Back up everything',
      'settings.backupHint': 'One ZIP with every project as its .interneuron folder (the maps are plain .md, readable without MindRoot) and the AI chats.',
      'settings.restore': 'Restore a backup',
      'settings.restoreHint': 'A backup ZIP or a JSON export comes in beside what is here; nothing is overwritten.',
      'settings.lastBackup': 'Last backup {when}.',
      'settings.noBackup': 'No backup yet.',
      'settings.backedUp': 'Backup saved: {file}',
      'settings.backupFailed': 'The backup did not work: {message}',
      'settings.backupEmpty': 'There is nothing to back up yet.',
      'settings.restoreFailed': 'The restore did not work: {message}',
      'settings.remind': 'Your last backup was {when}. A backup keeps your maps if the browser clears its data.',
      'settings.remindNever': 'You have not backed up your maps yet. A backup keeps them if the browser clears its data.',
      'settings.remindLater': 'Later',
      'settings.about': 'About',
      'settings.version': 'MindRoot {version}',
      'settings.offline': 'Works offline. Nothing you write leaves this device.',
      'settings.fromFile': 'Opened from a file: your maps live in this browser, shared by the pages it opens from files. An installed MindRoot has a storage of its own; to move your maps, back up here and restore there.',
      'settings.installed': 'Installed as an app: your maps live in its own storage. The page opened from a file has another one; back up and restore to move them.',
      'settings.served': 'Opened from a web address: your maps live in this browser, for this address.',
      'settings.cmd.open': 'Settings',
      'settings.cmd.backup': 'Back up everything',
      'settings.cmd.restore': 'Restore a backup',
      'settings.help.open': 'Theme, language, transparency, the map, copies, storage and backup.',
      'settings.help.backup': 'One ZIP with every project, readable without MindRoot.',
      'settings.help.restore': 'Brings a backup in beside what is here, without overwriting.',
      'settings.kw.open': 'settings preferences options theme language dark',
      'settings.kw.backup': 'backup export zip save everything',
      'settings.kw.restore': 'restore import backup'
    },
    it: {
      'settings.title': 'Impostazioni',
      'settings.look': 'Aspetto',
      'settings.theme': 'Tema',
      'settings.theme.system': 'Sistema',
      'settings.theme.light': 'Chiaro',
      'settings.theme.dark': 'Scuro',
      'settings.lang': 'Lingua',
      'settings.langHint': "MindRoot è in inglese. L'italiano è disponibile come seconda lingua e resta scelto finché non lo cambi.",
      'settings.transparency': 'Riduci trasparenza',
      'settings.transparencyHint': 'Barre piene al posto del vetro smerigliato.',
      'settings.glass': 'Effetto vetro liquido',
      'settings.glassHint': 'Una leggera rifrazione sulle barre in alto e sulla scheda di benvenuto. Solo nei browser Chromium con il mouse, e mai con il movimento ridotto.',
      'settings.cursor': 'Puntatore MindRoot',
      'settings.cursorHint': "La freccia dell'app, nei colori del tema, con il mouse o il trackpad. Spento: il puntatore di sistema.",
      'settings.map': 'Mappa',
      'settings.notebooks': 'Quaderni',
      'settings.nbPaper': 'Carta dei nuovi quaderni',
      'settings.nbPaperHint': "Su cosa parte una nuova lavagna o un nuovo disegno. Un quaderno tiene la sua una volta creato, e ogni tela può averne un'altra (impostazioni del quaderno, «Vale per»).",
      'settings.nbBackground': 'Sfondo dei nuovi quaderni',
      'settings.nbBackgroundHint': 'Automatico segue il tema: carta chiara nel tema chiaro, scura in quello scuro.',
      'settings.dice': 'Colori casuali per i nuovi nodi',
      'settings.diceHint': 'Un nuovo ramo prende un colore tutto suo invece di quello della tavolozza.',
      'settings.branchText': 'Testo del colore del ramo',
      'settings.branchTextHint': 'Le parole dei nodi prendono il colore del loro ramo; le esportazioni lo seguono.',
      'settings.drop': 'Un nodo lasciato sopra altri',
      'settings.dropHint': 'I nodi restano dove li lasci. Quando è sopra altri nodi, MindRoot può spostarlo nel punto libero più vicino, spostare gli altri fuori dal suo passaggio, o lasciarlo com\'è.',
      'settings.drop.move': 'Spostalo in uno spazio libero',
      'settings.drop.aside': 'Sposta gli altri',
      'settings.drop.keep': 'Lascialo lì',
      'settings.sync': 'Mappa e Markdown si seguono',
      'settings.syncHint': 'Scegliere un nodo porta lì il cursore del Markdown, e viceversa.',
      'settings.copies': 'Copie a tempo',
      'settings.copiesEvery': 'Una copia ogni',
      'settings.copiesAfter': 'di ogni mappa cambiata',
      'settings.unit.m': 'minuti',
      'settings.unit.h': 'ore',
      'settings.unitN.m.one': 'minuto', 'settings.unitN.m.other': 'minuti',
      'settings.unitN.h.one': 'ora', 'settings.unitN.h.other': 'ore',
      'settings.storage': 'Spazio e backup',
      'settings.usage': '{used} usati su {quota} che questo browser concede',
      'settings.usageOnly': '{used} usati',
      'settings.usageUnknown': 'Questo browser non dice quanto spazio è usato.',
      'settings.persisted': 'Conservato per sempre',
      'settings.bestEffort': 'Il browser può cancellarlo',
      'settings.persistedText': 'Il browser ha promesso di non cancellare le tue mappe per fare spazio.',
      'settings.bestEffortText': 'Quando il disco è pieno, il browser può cancellare quello che conserva per MindRoot. Un backup tiene al sicuro le mappe in ogni caso.',
      'settings.persist': 'Conserva le mie mappe per sempre',
      'settings.persistFile': "Aperto da un file, il browser decide da solo se conservare i dati; installato come app glielo si può chiedere. I backup tengono al sicuro le mappe in ogni caso.",
      'settings.persistDone': 'Il browser conserverà le tue mappe.',
      'settings.persistRefused': 'Il browser non lo ha promesso. Fai un backup ogni tanto.',
      'settings.memory': 'Questo browser non conserva niente per questa pagina: esporta o fai un backup prima di chiuderla.',
      'settings.backup': 'Fai il backup di tutto',
      'settings.backupHint': 'Un solo ZIP con ogni progetto come cartella .interneuron (le mappe sono file .md, leggibili anche senza MindRoot) e le chat AI.',
      'settings.restore': 'Ripristina un backup',
      'settings.restoreHint': "Uno ZIP di backup o un export JSON arriva accanto a quello che c'è; non si sovrascrive niente.",
      'settings.lastBackup': 'Ultimo backup {when}.',
      'settings.noBackup': 'Ancora nessun backup.',
      'settings.backedUp': 'Backup salvato: {file}',
      'settings.backupFailed': 'Il backup non è riuscito: {message}',
      'settings.backupEmpty': "Non c'è ancora niente di cui fare il backup.",
      'settings.restoreFailed': 'Il ripristino non è riuscito: {message}',
      'settings.remind': "L'ultimo backup è di {when}. Un backup tiene al sicuro le mappe se il browser cancella i suoi dati.",
      'settings.remindNever': 'Non hai ancora fatto un backup delle mappe. Un backup le tiene al sicuro se il browser cancella i suoi dati.',
      'settings.remindLater': 'Più tardi',
      'settings.about': 'Informazioni',
      'settings.version': 'MindRoot {version}',
      'settings.offline': 'Funziona senza rete. Niente di quello che scrivi lascia questo dispositivo.',
      'settings.fromFile': "Aperto da un file: le mappe stanno in questo browser, condivise dalle pagine che apre dai file. MindRoot installato ha uno spazio suo; per spostarle, fai il backup qui e ripristinalo lì.",
      'settings.installed': 'Installato come app: le mappe stanno nel suo spazio. La pagina aperta da un file ne ha un altro; per spostarle usa backup e ripristino.',
      'settings.served': 'Aperto da un indirizzo web: le mappe stanno in questo browser, per questo indirizzo.',
      'settings.cmd.open': 'Impostazioni',
      'settings.cmd.backup': 'Fai il backup di tutto',
      'settings.cmd.restore': 'Ripristina un backup',
      'settings.help.open': 'Tema, lingua, trasparenza, la mappa, le copie, lo spazio e il backup.',
      'settings.help.backup': 'Un solo ZIP con ogni progetto, leggibile anche senza MindRoot.',
      'settings.help.restore': "Porta un backup accanto a quello che c'è, senza sovrascrivere.",
      'settings.kw.open': 'settings preferences options theme language dark impostazioni preferenze opzioni tema lingua scuro',
      'settings.kw.backup': 'backup export zip save everything esporta salva tutto',
      'settings.kw.restore': 'restore import backup ripristina importa'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function S() { return ns.store; }
  function ui() { return ns.ui; }
  function P() { return ns.prefs; }
  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }

  /* When the last backup was made, and since when this browser has had
   * maps: kept with the preferences (they are this browser's facts). */
  P().define('backup', { last: 0, since: 0, snooze: 0 });

  /* ================================================================ backup */

  function backupInfo() { return P().get('backup') || { last: 0, since: 0, snooze: 0 }; }

  function backup() {
    var A = ns.archive;
    var store = S();
    if (!A || !store) return Promise.resolve(null);
    if (!store.projects().length) { ui().toast(t('settings.backupEmpty')); return Promise.resolve(null); }
    return A.workspaceZip().then(function (file) {
      A.download(file);
      P().set('backup', { last: Date.now(), snooze: 0 });
      ui().clearBanner('backup-reminder');
      ui().toast(t('settings.backedUp', { file: file.name }));
      if (cur) paintStorage(cur);
      return file.name;
    }, function (err) {
      ui().toast(t('settings.backupFailed', { message: (err && err.message) || String(err) }), { kind: 'error' });
      return null;
    });
  }

  /* Through the same door as any import: one step, one message, nothing
   * replaced. */
  function restore(files) {
    var store = S();
    if (!store || store.readOnly()) return Promise.resolve(null);
    var pick = files && files.length ? Promise.resolve(files) : util.pickFiles({ accept: BACKUP_ACCEPT, multiple: true });
    return pick.then(function (list) {
      if (!list || !list.length) return null;
      if (ns.sidebar && typeof ns.sidebar.importFiles === 'function') return ns.sidebar.importFiles(list);
      return ns.archive.importFiles(list).then(function (out) {
        ui().toast(out.message || '');
        return out;
      });
    }).catch(function (err) {
      ui().toast(t('settings.restoreFailed', { message: (err && err.message) || String(err) }), { kind: 'error' });
      return null;
    });
  }

  /* A week without a backup (or a week of maps never backed up), said once
   * a session; "Later" waits another week. */
  function checkReminder(now) {
    now = now == null ? Date.now() : now;
    var store = S();
    if (!store || store.readOnly() || !store.projects().length) return false;
    var b = backupInfo();
    if (!b.since) { P().set('backup', { since: now }); return false; }
    var from = Math.max(b.last || 0, b.since || 0, b.snooze || 0);
    if (now - from < REMIND_AFTER) return false;
    ui().banner('backup-reminder', {
      kind: 'info',
      icon: 'database',
      text: b.last ? t('settings.remind', { when: util.relativeTime(b.last, now) }) : t('settings.remindNever'),
      dismissable: false,
      actions: [
        { label: t('settings.backup'), kind: 'primary', run: function () { return backup(); }, dismiss: true },
        { label: t('settings.remindLater'), run: function () { P().set('backup', { snooze: Date.now() }); }, dismiss: true }
      ]
    });
    return true;
  }

  /* ================================================================ controls */

  function seg(name, options, value, onPick) {
    var group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name, 'data-name': name });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', class: 'seg__opt', role: 'radio', 'data-value': o.value, 'aria-checked': String(o.value === value), tabindex: o.value === value ? '0' : '-1' },
        o.icon ? ui().icon(o.icon) : null, h('span', { text: o.label }));
      b.addEventListener('click', function () { pickSeg(group, o.value); onPick(o.value); });
      group.appendChild(b);
    });
    group.addEventListener('keydown', function (event) {
      var keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      if (!(event.key in keys)) return;
      event.preventDefault();
      var opts = Array.prototype.slice.call(group.children);
      var i = opts.findIndex(function (b) { return b.getAttribute('aria-checked') === 'true'; });
      var j = (i + keys[event.key] + opts.length) % opts.length;
      opts[j].click();
      opts[j].focus();
    });
    return group;
  }

  function pickSeg(group, value) {
    Array.prototype.forEach.call(group.children, function (b) {
      var on = b.getAttribute('data-value') === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function switchRow(id, label, hint, key) {
    var hintId = id + '-hint';
    var sw = h('button', { type: 'button', class: 'switch', role: 'switch', id: id, 'aria-checked': String(!!P().get(key)), 'aria-labelledby': id + '-label', 'aria-describedby': hint ? hintId : null });
    sw.addEventListener('click', function () {
      var next = sw.getAttribute('aria-checked') !== 'true';
      P().set(key, next);
      sw.setAttribute('aria-checked', String(!!P().get(key)));
    });
    return h('div', { class: 'ws-set ws-set--switch' },
      h('div', { class: 'ws-set__text' },
        h('label', { class: 'ws-set__label', id: id + '-label', for: id, text: label }),
        hint ? h('p', { class: 'ws-set__hint', id: hintId, text: hint }) : null),
      sw);
  }

  function segRow(id, label, hint, control) {
    control.id = id;
    control.setAttribute('aria-labelledby', id + '-label');
    control.removeAttribute('aria-label');
    return h('div', { class: 'ws-set ws-set--seg' },
      h('div', { class: 'ws-set__text' },
        h('span', { class: 'ws-set__label', id: id + '-label', text: label }),
        hint ? h('p', { class: 'ws-set__hint', text: hint }) : null),
      control);
  }

  /* The paper and the background a new notebook starts on (prefs
   * 'notebook'): chosen from ns.paper's catalogue and the notebook's own
   * backgrounds, applied at once, read by ns.notebook when it makes one. */
  function notebookSection() {
    var PA = ns.paper;
    var NB = ns.notebook && ns.notebook.model;
    if (!PA || !PA.CATALOG || !NB || !NB.BACKGROUNDS) return null;
    var sec = section(t('settings.notebooks'), 'set-notebooks');
    var pref = P().get('notebook') || { paper: 'dots', background: 'auto' };
    var paper = h('select', { class: 'select', id: 'set-nb-paper' });
    PA.GROUPS.forEach(function (g) {
      var entries = PA.CATALOG.filter(function (e) { return e.group === g.id && e.id !== 'image'; });
      if (!entries.length) return;
      var group = h('optgroup', { label: PA.groupLabel(g.id) });
      entries.forEach(function (e) { group.appendChild(h('option', { value: e.id, text: PA.label(e.id), selected: e.id === pref.paper })); });
      paper.appendChild(group);
    });
    paper.addEventListener('change', function () { P().set('notebook', { paper: paper.value }); });
    sec.appendChild(h('div', { class: 'ws-set' },
      h('div', { class: 'ws-set__text' },
        h('label', { class: 'ws-set__label', id: 'set-nb-paper-label', for: 'set-nb-paper', text: t('settings.nbPaper') }),
        h('p', { class: 'ws-set__hint', text: t('settings.nbPaperHint') })),
      paper));
    var bg = h('select', { class: 'select', id: 'set-nb-bg' },
      h('option', { value: 'auto', text: t('notebook.bg.auto'), selected: pref.background === 'auto' }));
    var known = false;
    NB.BACKGROUNDS.forEach(function (b) {
      if (b.hex === pref.background) known = true;
      bg.appendChild(h('option', { value: b.hex, text: t('notebook.bg.' + b.id), selected: b.hex === pref.background }));
    });
    if (pref.background !== 'auto' && !known) bg.appendChild(h('option', { value: pref.background, text: pref.background, selected: true }));
    bg.addEventListener('change', function () { P().set('notebook', { background: bg.value }); });
    sec.appendChild(h('div', { class: 'ws-set' },
      h('div', { class: 'ws-set__text' },
        h('label', { class: 'ws-set__label', id: 'set-nb-bg-label', for: 'set-nb-bg', text: t('settings.nbBackground') }),
        h('p', { class: 'ws-set__hint', text: t('settings.nbBackgroundHint') })),
      bg));
    return sec;
  }

  function section(title, id) {
    return h('section', { class: 'ws-section', 'aria-labelledby': id }, h('h3', { class: 'ws-section__title', id: id, text: title }));
  }

  function bytes(n) {
    if (n == null || !isFinite(n)) return '';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var u = 0;
    while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
    return ns.i18n.number(n, { maximumFractionDigits: n < 10 && u ? 1 : 0 }) + ' ' + units[u];
  }

  function isHttp() { return /^https?:$/.test(window.location.protocol); }

  /* ================================================================ the sheet */

  var cur = null;

  function build(c) {
    var body = h('div', { class: 'ws-settings' });

    var look = section(t('settings.look'), 'set-look');
    look.appendChild(segRow('set-theme', t('settings.theme'), null, seg(t('settings.theme'), [
      { value: 'system', label: t('settings.theme.system'), icon: 'monitor' },
      { value: 'light', label: t('settings.theme.light'), icon: 'sun' },
      { value: 'dark', label: t('settings.theme.dark'), icon: 'moon' }
    ], P().get('theme'), function (v) { P().set('theme', v); })));
    look.appendChild(segRow('set-lang', t('settings.lang'), t('settings.langHint'), seg(t('settings.lang'), [
      { value: 'en', label: 'English' },
      { value: 'it', label: 'Italiano' }
    ], ns.i18n.lang(), function (v) { ns.i18n.setLang(v); })));
    look.appendChild(switchRow('set-transparency', t('settings.transparency'), t('settings.transparencyHint'), 'reduceTransparency'));
    look.appendChild(switchRow('set-glass', t('settings.glass'), t('settings.glassHint'), 'liquidGlass'));
    look.appendChild(switchRow('set-cursor', t('settings.cursor'), t('settings.cursorHint'), 'appCursor'));
    body.appendChild(look);

    var map = section(t('settings.map'), 'set-map');
    map.appendChild(switchRow('set-dice', t('settings.dice'), t('settings.diceHint'), 'diceColors'));
    map.appendChild(switchRow('set-branch', t('settings.branchText'), t('settings.branchTextHint'), 'branchText'));
    map.appendChild(switchRow('set-sync', t('settings.sync'), t('settings.syncHint'), 'syncSelection'));
    map.appendChild(segRow('set-drop', t('settings.drop'), t('settings.dropHint'), seg(t('settings.drop'), [
      { value: 'move', label: t('settings.drop.move') },
      { value: 'aside', label: t('settings.drop.aside') },
      { value: 'keep', label: t('settings.drop.keep') }
    ], P().get('dropOverlap'), function (v) { P().set('dropOverlap', v); })));
    body.appendChild(map);

    var nb = notebookSection();
    if (nb) body.appendChild(nb);

    var ai = ns.aiui && typeof ns.aiui.section === 'function' ? ns.aiui.section() : null;
    if (ai) body.appendChild(ai);

    var copies = section(t('settings.copies'), 'set-copies');
    var pref = P().get('copies') || { every: 1, unit: 'h' };
    var every = h('input', { class: 'input ws-every', id: 'set-every', type: 'number', min: '1', max: '999', step: '1', inputmode: 'numeric', value: String(pref.every) });
    var unit = h('select', { class: 'select ws-unit', id: 'set-unit', 'aria-label': t('settings.copies') },
      h('option', { value: 'm', text: t('settings.unit.m'), selected: pref.unit === 'm' }),
      h('option', { value: 'h', text: t('settings.unit.h'), selected: pref.unit !== 'm' }));
    function commit() {
      var n = util.clamp(Math.round(Number(every.value) || 1), 1, 999);
      every.value = String(n);
      P().set('copies', { every: n, unit: unit.value === 'm' ? 'm' : 'h' });
    }
    every.addEventListener('change', commit);
    unit.addEventListener('change', commit);
    /* 'every 1 hour', not 'every 1 hours': the units agree with the number. */
    every.addEventListener('input', function () { unitWords(unit, every.value); });
    unitWords(unit, pref.every);
    copies.appendChild(h('div', { class: 'ws-clock' },
      h('label', { for: 'set-every', text: t('settings.copiesEvery') }), every, unit, h('span', { text: t('settings.copiesAfter') })));
    body.appendChild(copies);

    var storage = section(t('settings.storage'), 'set-storage');
    c.usage = h('p', { class: 'ws-set__text ws-usage', 'aria-live': 'polite' });
    c.badge = h('span', { class: 'ws-badge' });
    c.persistText = h('p', { class: 'ws-set__hint' });
    c.persistBtn = ui().button({ label: t('settings.persist'), icon: 'lock', kind: 'text', id: 'set-persist', onClick: function () { askPersist(c); } });
    c.lastBackup = h('p', { class: 'ws-set__hint ws-last-backup' });
    var backupBtn = ui().button({ label: t('settings.backup'), icon: 'download', kind: 'primary', id: 'set-backup', onClick: function () { backup(); } });
    var restoreBtn = ui().button({ label: t('settings.restore'), icon: 'upload', kind: 'text', id: 'set-restore', onClick: function () { restore(); } });
    if (S() && S().readOnly()) restoreBtn.setAttribute('aria-disabled', 'true');
    storage.appendChild(h('div', { class: 'ws-storage' },
      h('div', { class: 'ws-storage__line' }, c.usage, c.badge),
      c.persistText,
      c.persistBtn));
    storage.appendChild(h('div', { class: 'ws-backup' },
      h('p', { class: 'ws-set__hint', text: t('settings.backupHint') }),
      c.lastBackup,
      h('div', { class: 'ws-backup__actions' }, backupBtn, restoreBtn),
      h('p', { class: 'ws-set__hint', text: t('settings.restoreHint') })));
    body.appendChild(storage);

    var about = section(t('settings.about'), 'set-about');
    var where = util.isStandalone ? t('settings.installed') : isHttp() ? t('settings.served') : t('settings.fromFile');
    about.appendChild(h('div', { class: 'ws-about' },
      h('img', { class: 'ws-about__logo', src: 'icons/logo-compact.svg', alt: '', width: '40', height: '40' }),
      h('div', null,
        h('p', { class: 'ws-about__name', text: t('settings.version', { version: VERSION }) }),
        h('p', { class: 'ws-set__hint' }, ui().icon('offline'), ' ', t('settings.offline')),
        h('p', { class: 'ws-set__hint', text: where }))));
    body.appendChild(about);
    return body;
  }

  function paintStorage(c) {
    var b = backupInfo();
    c.lastBackup.textContent = b.last ? t('settings.lastBackup', { when: util.relativeTime(b.last) }) : t('settings.noBackup');
    var S2 = ns.storage;
    if (S2 && typeof S2.available === 'function' && !S2.available()) {
      c.usage.textContent = t('settings.memory');
      c.badge.hidden = true;
      c.persistText.hidden = true;
      c.persistBtn.hidden = true;
      return;
    }
    var job = S2 && typeof S2.estimate === 'function' ? S2.estimate() : Promise.resolve({ usage: null, quota: null, persisted: false });
    return Promise.resolve(job).then(function (e) {
      if (!c.sheet.isOpen()) return;
      if (e.usage != null && e.quota) c.usage.textContent = t('settings.usage', { used: bytes(e.usage), quota: bytes(e.quota) });
      else if (e.usage != null) c.usage.textContent = t('settings.usageOnly', { used: bytes(e.usage) });
      else c.usage.textContent = t('settings.usageUnknown');
      c.badge.hidden = false;
      c.badge.textContent = e.persisted ? t('settings.persisted') : t('settings.bestEffort');
      c.badge.setAttribute('data-state', e.persisted ? 'ok' : 'warn');
      c.persistText.hidden = false;
      c.persistText.textContent = e.persisted ? t('settings.persistedText') : (isHttp() ? t('settings.bestEffortText') : t('settings.persistFile'));
      c.persistBtn.hidden = !!e.persisted || !isHttp();
      c.persisted = !!e.persisted;
    }, function () {
      c.usage.textContent = t('settings.usageUnknown');
    });
  }

  function askPersist(c) {
    var S2 = ns.storage;
    if (!S2 || typeof S2.persist !== 'function') return Promise.resolve(false);
    return S2.persist().then(function (ok) {
      ui().toast(ok ? t('settings.persistDone') : t('settings.persistRefused'));
      paintStorage(c);
      return ok;
    });
  }

  function open() {
    if (cur && cur.sheet.isOpen()) { cur.sheet.el.focus(); return cur; }
    var c = {};
    c.body = build(c);
    c.sheet = ui().sheet({
      title: t('settings.title'),
      body: c.body,
      cls: 'ws-sheet ws-sheet--settings',
      detents: ['content', 0.92],
      initialFocus: c.body.querySelector('#set-theme [aria-checked="true"]'),
      onClose: function () {
        if (c.off) c.off.forEach(function (off) { off(); });
        if (cur === c) cur = null;
      }
    });
    c.off = [
      ns.bus.on('lang', function () { rebuild(c); }),
      ns.bus.on('prefs', function (d) {
        /* A preference changed elsewhere (another tab, a command, the theme
         * button): the controls follow. Setting what they already show is
         * harmless, so the sheet's own changes need no special case. */
        if (!d || d.key === 'mode' || d.key === 'expanded') return;
        if (d.key === 'backup') { paintStorage(c); return; }
        syncControls(c);
      })
    ];
    cur = c;
    paintStorage(c);
    return c;
  }

  /* The language changed: the sheet is rebuilt in it, the focus kept on the
   * control that had it (by id, and inside a radio group by value). */
  function rebuild(c) {
    if (!c.sheet.isOpen()) return;
    var a = document.activeElement;
    var keep = a && c.body.contains(a) ? (a.closest('[id]') || a) : null;
    var keepId = keep ? keep.id : null;
    var keepValue = a && a.getAttribute ? a.getAttribute('data-value') : null;
    var scroll = c.sheet.body.scrollTop;
    var fresh = build(c);
    c.body.replaceWith(fresh);
    c.body = fresh;
    c.sheet.setTitle(t('settings.title'));
    c.sheet.body.scrollTop = scroll;
    var target = keepId ? document.getElementById(keepId) : null;
    if (target && keepValue) target = target.querySelector('[data-value="' + keepValue + '"]') || target;
    if (target) target.focus({ preventScroll: true });
    paintStorage(c);
  }

  function syncControls(c) {
    if (!c.sheet.isOpen()) return;
    [['set-theme', P().get('theme')], ['set-lang', ns.i18n.lang()], ['set-drop', P().get('dropOverlap')]].forEach(function (pair) {
      var g = document.getElementById(pair[0]);
      if (g) pickSeg(g, pair[1]);
    });
    [['set-transparency', 'reduceTransparency'], ['set-glass', 'liquidGlass'], ['set-cursor', 'appCursor'], ['set-dice', 'diceColors'], ['set-branch', 'branchText'], ['set-sync', 'syncSelection']].forEach(function (pair) {
      var sw = document.getElementById(pair[0]);
      if (sw) sw.setAttribute('aria-checked', String(!!P().get(pair[1])));
    });
    var nbPref = P().get('notebook');
    [['set-nb-paper', nbPref && nbPref.paper], ['set-nb-bg', nbPref && nbPref.background]].forEach(function (pair) {
      var sel = document.getElementById(pair[0]);
      if (sel && pair[1] && sel.value !== pair[1]) sel.value = pair[1];
    });
    var pref = P().get('copies');
    var every = document.getElementById('set-every');
    var unit = document.getElementById('set-unit');
    if (every && document.activeElement !== every) every.value = String(pref.every);
    if (unit) { unit.value = pref.unit; unitWords(unit, every ? every.value : pref.every); }
  }

  function unitWords(select, n) {
    var count = Math.max(1, Math.round(Number(n) || 1));
    var opts = select.options;
    for (var i = 0; i < opts.length; i++) opts[i].textContent = ns.i18n.plural('settings.unitN.' + opts[i].value, count);
  }

  /* ================================================================ init */

  function init() {
    if (!ns.commands) return;
    ns.commands.register({
      id: 'settings.open', label: 'settings.cmd.open', group: 'app', icon: 'settings',
      keys: ['Mod+,'], keywords: t('settings.kw.open'), help: 'settings.help.open',
      when: function () { return !viewOnly(); },
      run: function () { return !!open(); }
    });
    ns.commands.register({
      id: 'file.backup', label: 'settings.cmd.backup', group: 'file', icon: 'download',
      keywords: t('settings.kw.backup'), help: 'settings.help.backup',
      when: function () { return !!S() && S().projects().length > 0; },
      run: function () { return backup(); }
    });
    ns.commands.register({
      id: 'file.restore', label: 'settings.cmd.restore', group: 'file', icon: 'upload',
      keywords: t('settings.kw.restore'), help: 'settings.help.restore',
      when: function () { return !!S() && !S().readOnly() && !viewOnly(); },
      run: function () { return restore(); }
    });
    /* Once the person has used the app a while; not on the startup path. */
    if (ns.bus) {
      ns.bus.once('booted', function () {
        var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
        idle(function () { checkReminder(); });
      });
    }
  }

  ns.settings = {
    init: init,
    open: open,
    close: function close() { if (cur) cur.sheet.close('api'); },
    isOpen: function isOpen() { return !!cur && cur.sheet.isOpen(); },
    backup: backup,
    restore: restore,
    checkReminder: checkReminder,
    VERSION: VERSION
  };
})(window.MindRoot);
