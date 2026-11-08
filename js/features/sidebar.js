/* MindRoot - the projects and maps list, and everything a project or a map
 * can be asked from it.
 *
 * #sidebar holds a tree: every project, and under each open project its
 * maps and a "New map" row. It is rebuilt whole from the store at most once
 * a frame when the tree itself changes (keeping a diff in step would cost
 * more than it saves), and the row that had the focus gets it back by its
 * key ('p:<id>', 'm:<id>', 'n:<id>'). Edits of a map's text, which come
 * with every keystroke, only repaint the numbers they change; and a closed
 * sidebar is not rebuilt at all, only marked stale and built as it comes
 * into view. One row holds tabindex 0 (roving
 * tabindex), so the tree is one Tab stop; arrows, Home/End and type-ahead
 * move inside it, Enter or Space open, F2 renames, Delete throws away,
 * Alt+arrows move a row, the ContextMenu key opens the row's menu. Every key
 * the tree handles stops there: the map's own keys (Enter adds a node,
 * Delete deletes one) must never fire from a row.
 *
 * Projects and maps are reordered by dragging - a mouse after a few pixels,
 * a finger after a long press (which first opens the row's menu: moving on
 * closes it and starts the drag) - and with Alt+Up/Down. A map moves only
 * within its project: the store has no move between projects, and a copy
 * would not be a move (its copies and trash stay behind).
 *
 * Also here, because the sidebar is where people look for them: the new
 * project dialog (empty or from a template, with or without its content),
 * project and map menus and dialogs, import (files, a .interneuron folder,
 * a drop on the page, files opened with the installed app) and export, and
 * the import-branches dialog. Deleting a map sends it to the trash at once
 * with an Undo toast; deleting a project, which has no trash to go to, asks
 * first. The footer opens the copies, the images panel (when the media
 * module is there) and the trash, whose count badge bumps when it changes.
 *
 * Which projects are open in the tree is prefs.expanded (stale ids pruned
 * on every write); a project never toggled is open when it is the active
 * one. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var util = ns.util;
  var h = util.h;

  var LONG_PRESS = 500;     // ms: a finger held this long on a row opens its menu
  var TOUCH_SLOP = 8;       // px a finger may wander before a press becomes a scroll
  var MOUSE_SLOP = 5;       // px before a mouse press on a row becomes a drag
  var EDGE = 28;            // px from the list's edge where a drag scrolls it
  var TYPEAHEAD_MS = 700;
  var IMPORT_ACCEPT = '.zip,.json,.md,.markdown,.png,application/zip,application/json,text/markdown';

  ns.i18n.add({
    en: {
      'sidebar.title': 'Projects',
      'sidebar.tree': 'Projects and maps',
      'sidebar.newProject': 'New project',
      'sidebar.newMap': 'New map',
      'sidebar.newMapIn': 'New map in {project}',
      'sidebar.ioMenu': 'Import and export',
      'sidebar.moreProject': 'Actions for {name}',
      'sidebar.moreMap': 'Actions for {name}',
      'sidebar.template': 'Template',
      'sidebar.maps.one': '{n} map',
      'sidebar.maps.other': '{n} maps',
      'sidebar.nodes.one': '{n} node',
      'sidebar.nodes.other': '{n} nodes',
      'sidebar.mapTitle': '{name}, {nodes}',
      'sidebar.empty': 'No projects yet. Make one with the + above, or bring one in from the menu beside it.',
      'sidebar.copies': 'Copies',
      'sidebar.images': 'Images',
      'sidebar.trash': 'Trash',
      'sidebar.settings': 'Settings',
      'sidebar.help': 'Help',
      'sidebar.footer': 'Tools of the project',
      'sidebar.trashOf': 'The trash of {project}',
      'sidebar.trashCount.zero': 'The trash of {project} is empty',
      'sidebar.trashCount.one': 'The trash of {project}: {n} item',
      'sidebar.trashCount.other': 'The trash of {project}: {n} items',
      'sidebar.menu.open': 'Open',
      'sidebar.menu.newMap': 'New map',
      'sidebar.menu.editProject': 'Rename and describe',
      'sidebar.menu.rename': 'Rename',
      'sidebar.menu.duplicate': 'Duplicate',
      'sidebar.menu.useTemplate': 'Use as a template',
      'sidebar.menu.stopTemplate': 'Stop using as a template',
      'sidebar.menu.importInto': 'Import its branches into the open map',
      'sidebar.menu.importHint': 'Open a map of another project first',
      'sidebar.menu.exportZip': 'Export as ZIP',
      'sidebar.menu.exportJson': 'Export as JSON',
      'sidebar.menu.images': 'Images and drawings',
      'sidebar.menu.trash': 'Trash ({n})',
      'sidebar.menu.copies': 'The copies',
      'sidebar.menu.moveUp': 'Move up',
      'sidebar.menu.moveDown': 'Move down',
      'sidebar.menu.deleteProject': 'Delete the project',
      'sidebar.menu.deleteMap': 'Delete the map',
      'sidebar.menu.importFile': 'Import a file (ZIP, JSON, .md)',
      'sidebar.menu.importFolder': 'Import a .interneuron folder',
      'sidebar.menu.importBranches': 'Import branches from another map',
      'sidebar.menu.exportAllZip': 'Export everything as ZIP',
      'sidebar.menu.exportAllJson': 'Export everything as JSON',
      'sidebar.menu.restore': 'Restore from a backup',
      'sidebar.dlg.newProject': 'New project',
      'sidebar.dlg.name': 'Name',
      'sidebar.dlg.description': 'Description',
      'sidebar.dlg.descriptionHint': 'Optional. It shows under the name in the sidebar.',
      'sidebar.dlg.startFrom': 'Start from',
      'sidebar.dlg.empty': 'Empty',
      'sidebar.dlg.emptyHint': 'One map, with nothing in it but its title.',
      'sidebar.dlg.templateMaps.one': '{n} map: {names}',
      'sidebar.dlg.templateMaps.other': '{n} maps: {names}',
      'sidebar.dlg.withContent': 'Take what is in its maps, not only their titles',
      'sidebar.dlg.noTemplates': 'Any project can be a template: its menu has "Use as a template".',
      'sidebar.dlg.make': 'Make it',
      'sidebar.dlg.save': 'Save',
      'sidebar.dlg.editProject': 'Rename and describe',
      'sidebar.dlg.newMap': 'New map',
      'sidebar.dlg.renameMap': 'Rename the map',
      'sidebar.dlg.mapName': 'Name of the map',
      'sidebar.dlg.deleteProject': 'Delete {name}?',
      'sidebar.dlg.deleteProjectText.one': '{name} goes with its map, the copies and its trash. Undo brings it back while this page is open; after that only an export does.',
      'sidebar.dlg.deleteProjectText.other': '{name} goes with its {n} maps, their copies and its trash. Undo brings it back while this page is open; after that only an export does.',
      'sidebar.dlg.delete': 'Delete',
      'sidebar.made': 'Made {name}.',
      'sidebar.madeFrom': 'Made {name}, from {template}.',
      'sidebar.duplicated': 'Made {name}: the maps and their files, not the trash or the copies.',
      'sidebar.mapDuplicated': 'Made {name}.',
      'sidebar.isTemplate': '{name} is a template: New project can start from it.',
      'sidebar.notTemplate': '{name} is not a template any more.',
      'sidebar.projectDeleted': '{name} deleted.',
      'sidebar.mapTrashed': '{name} is in the trash.',
      'sidebar.exported': 'Exported: {file}',
      'sidebar.exportFailed': 'The export did not work: {message}',
      'sidebar.importFailed': 'The import did not work: {message}',
      'sidebar.nothingImported': 'Nothing was imported.',
      'sidebar.readOnly': 'This tab only shows your maps: another tab keeps them.',
      'sidebar.moved': 'Moved.',
      'sidebar.notAcross': 'A map moves within its project.',
      'sidebar.ib.title': 'Import branches',
      'sidebar.ib.from': 'From',
      'sidebar.ib.filter': 'Filter the nodes',
      'sidebar.ib.all': 'All',
      'sidebar.ib.none': 'None',
      'sidebar.ib.nodes': 'Nodes to bring in',
      'sidebar.ib.under': 'Into {map}, under',
      'sidebar.ib.root': 'The root: {label}',
      'sidebar.ib.top': 'The top of the map',
      'sidebar.ib.go.zero': 'Import',
      'sidebar.ib.go.one': 'Import {n} branch',
      'sidebar.ib.go.other': 'Import {n} branches',
      'sidebar.ib.descendants': '+{n}',
      'sidebar.ib.noMatch': 'No node matches "{q}".',
      'sidebar.ib.emptyMap': 'This map has no nodes.',
      'sidebar.ib.needMap': 'Open a map first: the branches go into it.',
      'sidebar.ib.noOther': 'There is no other map to take branches from.',
      'sidebar.ib.done.one': '{n} branch imported. Undo takes it out again.',
      'sidebar.ib.done.other': '{n} branches imported. Undo takes them out again.',
      'sidebar.ib.nothing': 'Nothing was imported: the map refused those branches.',
      'sidebar.cmd.newProject': 'New project',
      'sidebar.cmd.newMap': 'New map',
      'sidebar.cmd.renameProject': 'Rename and describe the project',
      'sidebar.cmd.duplicateProject': 'Duplicate the project',
      'sidebar.cmd.deleteProject': 'Delete the project',
      'sidebar.cmd.templateProject': 'Use the project as a template',
      'sidebar.cmd.exportProject': 'Export the project as ZIP',
      'sidebar.cmd.exportProjectJson': 'Export the project as JSON',
      'sidebar.cmd.renameMap': 'Rename the map',
      'sidebar.cmd.duplicateMap': 'Duplicate the map',
      'sidebar.cmd.deleteMap': 'Delete the map',
      'sidebar.cmd.importBranches': 'Import branches from another map',
      'sidebar.cmd.import': 'Import a file',
      'sidebar.cmd.importFolder': 'Import a .interneuron folder',
      'sidebar.cmd.exportAll': 'Export everything as JSON',
      'sidebar.cmd.focus': 'Go to the projects list',
      'sidebar.help.newProject': 'Empty, or from a project used as a template.',
      'sidebar.help.newMap': 'A new map in the open project.',
      'sidebar.help.renameProject': 'Its name, and a line about it.',
      'sidebar.help.duplicateProject': 'The maps and their files, not the trash or the copies.',
      'sidebar.help.deleteProject': 'Asks first. Undo brings it back while the page is open.',
      'sidebar.help.templateProject': 'New project can then start from it.',
      'sidebar.help.exportProject': 'The .interneuron folder as a ZIP: Obsidian and any editor read it.',
      'sidebar.help.exportProjectJson': 'One file with everything, pictures included.',
      'sidebar.help.renameMap': 'In the list, F2 does it too.',
      'sidebar.help.duplicateMap': 'A copy right after it, without its copies.',
      'sidebar.help.deleteMap': 'It goes to the trash, with its copies.',
      'sidebar.help.importBranches': 'Pick nodes of another map and copy them, with everything under them, into this one.',
      'sidebar.help.import': 'A ZIP or a JSON brings projects; a .md becomes a map of the open project.',
      'sidebar.help.importFolder': 'A folder whose name ends in .interneuron.',
      'sidebar.help.exportAll': 'Every project in one JSON file, pictures included.',
      'sidebar.help.tree': 'In the list: arrows move, Enter opens, F2 renames, Del deletes, Alt+arrows move the row, the menu key opens its menu.',
      'sidebar.kw.newProject': 'project create add template',
      'sidebar.kw.newMap': 'map create add',
      'sidebar.kw.project': 'project',
      'sidebar.kw.map': 'map',
      'sidebar.kw.import': 'import open zip json markdown md interneuron',
      'sidebar.kw.export': 'export backup download zip json interneuron',
      'sidebar.kw.branches': 'import branches nodes copy'
    },
    it: {
      'sidebar.title': 'Progetti',
      'sidebar.tree': 'Progetti e mappe',
      'sidebar.newProject': 'Nuovo progetto',
      'sidebar.newMap': 'Nuova mappa',
      'sidebar.newMapIn': 'Nuova mappa in {project}',
      'sidebar.ioMenu': 'Importa ed esporta',
      'sidebar.moreProject': 'Azioni per {name}',
      'sidebar.moreMap': 'Azioni per {name}',
      'sidebar.template': 'Modello',
      'sidebar.maps.one': '{n} mappa',
      'sidebar.maps.other': '{n} mappe',
      'sidebar.nodes.one': '{n} nodo',
      'sidebar.nodes.other': '{n} nodi',
      'sidebar.mapTitle': '{name}, {nodes}',
      'sidebar.empty': 'Ancora nessun progetto. Creane uno con il + qui sopra, o importalo dal menu accanto.',
      'sidebar.copies': 'Copie',
      'sidebar.images': 'Immagini',
      'sidebar.trash': 'Cestino',
      'sidebar.settings': 'Impostazioni',
      'sidebar.help': 'Aiuto',
      'sidebar.footer': 'Strumenti del progetto',
      'sidebar.trashOf': 'Il cestino di {project}',
      'sidebar.trashCount.zero': 'Il cestino di {project} è vuoto',
      'sidebar.trashCount.one': 'Il cestino di {project}: {n} elemento',
      'sidebar.trashCount.other': 'Il cestino di {project}: {n} elementi',
      'sidebar.menu.open': 'Apri',
      'sidebar.menu.newMap': 'Nuova mappa',
      'sidebar.menu.editProject': 'Rinomina e descrivi',
      'sidebar.menu.rename': 'Rinomina',
      'sidebar.menu.duplicate': 'Duplica',
      'sidebar.menu.useTemplate': 'Usa come modello',
      'sidebar.menu.stopTemplate': 'Smetti di usare come modello',
      'sidebar.menu.importInto': 'Importa i suoi rami nella mappa aperta',
      'sidebar.menu.importHint': 'Apri prima una mappa di un altro progetto',
      'sidebar.menu.exportZip': 'Esporta come ZIP',
      'sidebar.menu.exportJson': 'Esporta come JSON',
      'sidebar.menu.images': 'Immagini e disegni',
      'sidebar.menu.trash': 'Cestino ({n})',
      'sidebar.menu.copies': 'Le copie',
      'sidebar.menu.moveUp': 'Sposta su',
      'sidebar.menu.moveDown': 'Sposta giù',
      'sidebar.menu.deleteProject': 'Elimina il progetto',
      'sidebar.menu.deleteMap': 'Elimina la mappa',
      'sidebar.menu.importFile': 'Importa un file (ZIP, JSON, .md)',
      'sidebar.menu.importFolder': 'Importa una cartella .interneuron',
      'sidebar.menu.importBranches': "Importa rami da un'altra mappa",
      'sidebar.menu.exportAllZip': 'Esporta tutto come ZIP',
      'sidebar.menu.exportAllJson': 'Esporta tutto come JSON',
      'sidebar.menu.restore': 'Ripristina da un backup',
      'sidebar.dlg.newProject': 'Nuovo progetto',
      'sidebar.dlg.name': 'Nome',
      'sidebar.dlg.description': 'Descrizione',
      'sidebar.dlg.descriptionHint': 'Facoltativa. Compare sotto il nome, nella barra laterale.',
      'sidebar.dlg.startFrom': 'Parti da',
      'sidebar.dlg.empty': 'Vuoto',
      'sidebar.dlg.emptyHint': 'Una mappa, con dentro solo il titolo.',
      'sidebar.dlg.templateMaps.one': '{n} mappa: {names}',
      'sidebar.dlg.templateMaps.other': '{n} mappe: {names}',
      'sidebar.dlg.withContent': 'Prendi quello che c\'è nelle mappe, non solo i titoli',
      'sidebar.dlg.noTemplates': 'Ogni progetto può fare da modello: nel suo menu c\'è «Usa come modello».',
      'sidebar.dlg.make': 'Crea',
      'sidebar.dlg.save': 'Salva',
      'sidebar.dlg.editProject': 'Rinomina e descrivi',
      'sidebar.dlg.newMap': 'Nuova mappa',
      'sidebar.dlg.renameMap': 'Rinomina la mappa',
      'sidebar.dlg.mapName': 'Nome della mappa',
      'sidebar.dlg.deleteProject': 'Eliminare {name}?',
      'sidebar.dlg.deleteProjectText.one': '{name} se ne va con la sua mappa, le copie e il cestino. Annulla lo riporta finché questa pagina resta aperta; dopo, solo un export.',
      'sidebar.dlg.deleteProjectText.other': '{name} se ne va con le sue {n} mappe, le loro copie e il cestino. Annulla lo riporta finché questa pagina resta aperta; dopo, solo un export.',
      'sidebar.dlg.delete': 'Elimina',
      'sidebar.made': 'Creato {name}.',
      'sidebar.madeFrom': 'Creato {name}, dal modello {template}.',
      'sidebar.duplicated': 'Creato {name}: le mappe e i loro file, non il cestino né le copie.',
      'sidebar.mapDuplicated': 'Creata {name}.',
      'sidebar.isTemplate': '{name} è un modello: Nuovo progetto può partire da qui.',
      'sidebar.notTemplate': '{name} non è più un modello.',
      'sidebar.projectDeleted': '{name} eliminato.',
      'sidebar.mapTrashed': '{name} è nel cestino.',
      'sidebar.exported': 'Esportato: {file}',
      'sidebar.exportFailed': "L'esportazione non è riuscita: {message}",
      'sidebar.importFailed': "L'importazione non è riuscita: {message}",
      'sidebar.nothingImported': 'Non è stato importato niente.',
      'sidebar.readOnly': "Questa scheda mostra soltanto le mappe: le conserva un'altra scheda.",
      'sidebar.moved': 'Spostato.',
      'sidebar.notAcross': 'Una mappa si sposta dentro il suo progetto.',
      'sidebar.ib.title': 'Importa rami',
      'sidebar.ib.from': 'Da',
      'sidebar.ib.filter': 'Filtra i nodi',
      'sidebar.ib.all': 'Tutti',
      'sidebar.ib.none': 'Nessuno',
      'sidebar.ib.nodes': 'Nodi da portare',
      'sidebar.ib.under': 'In {map}, sotto',
      'sidebar.ib.root': 'La radice: {label}',
      'sidebar.ib.top': "L'inizio della mappa",
      'sidebar.ib.go.zero': 'Importa',
      'sidebar.ib.go.one': 'Importa {n} ramo',
      'sidebar.ib.go.other': 'Importa {n} rami',
      'sidebar.ib.descendants': '+{n}',
      'sidebar.ib.noMatch': 'Nessun nodo corrisponde a "{q}".',
      'sidebar.ib.emptyMap': 'Questa mappa non ha nodi.',
      'sidebar.ib.needMap': 'Apri prima una mappa: i rami arrivano lì.',
      'sidebar.ib.noOther': "Non c'è un'altra mappa da cui prendere rami.",
      'sidebar.ib.done.one': '{n} ramo importato. Annulla lo toglie di nuovo.',
      'sidebar.ib.done.other': '{n} rami importati. Annulla li toglie di nuovo.',
      'sidebar.ib.nothing': 'Non è stato importato niente: la mappa ha rifiutato quei rami.',
      'sidebar.cmd.newProject': 'Nuovo progetto',
      'sidebar.cmd.newMap': 'Nuova mappa',
      'sidebar.cmd.renameProject': 'Rinomina e descrivi il progetto',
      'sidebar.cmd.duplicateProject': 'Duplica il progetto',
      'sidebar.cmd.deleteProject': 'Elimina il progetto',
      'sidebar.cmd.templateProject': 'Usa il progetto come modello',
      'sidebar.cmd.exportProject': 'Esporta il progetto come ZIP',
      'sidebar.cmd.exportProjectJson': 'Esporta il progetto come JSON',
      'sidebar.cmd.renameMap': 'Rinomina la mappa',
      'sidebar.cmd.duplicateMap': 'Duplica la mappa',
      'sidebar.cmd.deleteMap': 'Elimina la mappa',
      'sidebar.cmd.importBranches': "Importa rami da un'altra mappa",
      'sidebar.cmd.import': 'Importa un file',
      'sidebar.cmd.importFolder': 'Importa una cartella .interneuron',
      'sidebar.cmd.exportAll': 'Esporta tutto come JSON',
      'sidebar.cmd.focus': "Vai all'elenco dei progetti",
      'sidebar.help.newProject': 'Vuoto, o da un progetto usato come modello.',
      'sidebar.help.newMap': 'Una nuova mappa nel progetto aperto.',
      'sidebar.help.renameProject': 'Il nome, e una riga che lo descrive.',
      'sidebar.help.duplicateProject': 'Le mappe e i loro file, non il cestino né le copie.',
      'sidebar.help.deleteProject': 'Chiede prima. Annulla lo riporta finché la pagina resta aperta.',
      'sidebar.help.templateProject': 'Nuovo progetto potrà partire da qui.',
      'sidebar.help.exportProject': 'La cartella .interneuron in uno ZIP: la leggono Obsidian e ogni editor.',
      'sidebar.help.exportProjectJson': 'Un solo file con tutto, immagini comprese.',
      'sidebar.help.renameMap': "Nell'elenco lo fa anche F2.",
      'sidebar.help.duplicateMap': 'Una copia subito dopo, senza le sue copie.',
      'sidebar.help.deleteMap': 'Va nel cestino, con le sue copie.',
      'sidebar.help.importBranches': "Scegli dei nodi di un'altra mappa e copiali, con tutto quello che hanno sotto, in questa.",
      'sidebar.help.import': 'Uno ZIP o un JSON portano progetti; un .md diventa una mappa del progetto aperto.',
      'sidebar.help.importFolder': 'Una cartella il cui nome finisce in .interneuron.',
      'sidebar.help.exportAll': 'Tutti i progetti in un solo file JSON, immagini comprese.',
      'sidebar.help.tree': "Nell'elenco: le frecce si spostano, Invio apre, F2 rinomina, Canc elimina, Alt+frecce spostano la riga, il tasto menu apre il suo menu.",
      'sidebar.kw.newProject': 'project create add template progetto crea nuovo modello',
      'sidebar.kw.newMap': 'map create add mappa crea nuova',
      'sidebar.kw.project': 'project progetto',
      'sidebar.kw.map': 'map mappa',
      'sidebar.kw.import': 'import open zip json markdown md interneuron importa apri',
      'sidebar.kw.export': 'export backup download zip json interneuron esporta scarica',
      'sidebar.kw.branches': 'import branches nodes copy importa rami nodi copia'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function plural(key, n, vars) { return ns.i18n.plural(key, n, vars); }
  function S() { return ns.store; }
  function ui() { return ns.ui; }

  /* ================================================================ state */

  var els = {};
  var rows = [];             // the visible tree items, in order
  var focusKey = null;       // the row holding tabindex 0
  var lastTrash = null;      // {pid, n}: the badge bumps when n changes for the same project
  var drag = null;
  var draggedAt = 0;
  var lastPointer = 'mouse';
  var press = null;
  var typeahead = { text: '', at: 0 };
  var inited = false;

  function viewOnly() { return document.documentElement.getAttribute('data-mode') === 'view'; }

  /* Writing is refused in a tab that only shows the maps (another tab
   * holds them) and in view-only mode. */
  function editable() {
    var store = S();
    return !!store && !store.readOnly() && !viewOnly();
  }

  /* Says why nothing happened, once, instead of a silent no. */
  function refuse() {
    if (S() && S().readOnly()) ui().toast(t('sidebar.readOnly'));
    return false;
  }

  function hereNow() { return S() ? S().here() : { projectId: null, mapId: null }; }

  /* ================================================================ expanded projects */

  function expandedPrefs() {
    var v = ns.prefs.get('expanded');
    return v && typeof v === 'object' ? v : {};
  }

  function isExpanded(pid) {
    var e = expandedPrefs();
    if (Object.prototype.hasOwnProperty.call(e, pid)) return !!e[pid];
    return pid === hereNow().projectId;
  }

  /* Ids of projects that are gone are dropped at every write. */
  function setExpanded(pid, open) {
    var e = expandedPrefs();
    var next = {};
    S().projects().forEach(function (p) {
      if (Object.prototype.hasOwnProperty.call(e, p.id)) next[p.id] = !!e[p.id];
    });
    next[pid] = !!open;
    ns.prefs.set('expanded', next);
    schedule();
  }

  /* ================================================================ building */

  function countsLine(p) {
    var c = S().counts(p);
    var parts = [];
    if (p.isTemplate) parts.push(t('sidebar.template'));
    parts.push(plural('sidebar.maps', c.maps));
    parts.push(plural('sidebar.nodes', c.nodes));
    return parts.join(', ');
  }

  function moreButton(label) {
    var b = ui().button({ icon: 'more', label: label, cls: 'sb-more', tooltip: false });
    b.tabIndex = -1;
    b.setAttribute('aria-haspopup', 'menu');
    /* The keys belong to the row, never to its button: a menu closing (or a
     * dialog it opened) gives the focus back to the button it was anchored
     * on, where the tree's arrows would not work. */
    b.addEventListener('focus', function () {
      var row = b.closest('.sb-item');
      if (row && rows.indexOf(row) >= 0) focusRow(row);
    });
    return b;
  }

  function projectItem(p, here, index, total) {
    var open = isExpanded(p.id);
    var active = here.projectId === p.id;
    var li = h('li', {
      class: ['sb-item', 'sb-item--project', active && 'is-active'],
      role: 'treeitem',
      'aria-level': '1',
      'aria-expanded': String(open),
      'aria-setsize': String(total),
      'aria-posinset': String(index + 1),
      'aria-label': p.name + ', ' + (p.description ? p.description + ', ' : '') + countsLine(p),
      tabindex: '-1',
      'data-key': 'p:' + p.id,
      'data-pid': p.id
    });
    var caret = h('span', { class: 'sb-caret', 'aria-hidden': 'true' }, ui().icon('chevron-right'));
    var row = h('div', { class: 'sb-row', title: p.description ? p.name + ' - ' + p.description : p.name },
      caret,
      ui().icon(p.isTemplate ? 'template' : 'project', 'sb-icon'),
      h('span', { class: 'sb-text' },
        h('span', { class: 'sb-name', text: p.name }),
        /* The description, under the name where a finger can see it too
         * (a title tooltip is a mouse's only). */
        p.description ? h('span', { class: 'sb-desc', text: p.description }) : null,
        h('span', { class: 'sb-meta', text: countsLine(p) })),
      moreButton(t('sidebar.moreProject', { name: p.name })));
    li.appendChild(row);
    if (open) {
      var group = h('ul', { class: 'sb-group', role: 'group' });
      var n = p.maps.length + 1;
      p.maps.forEach(function (m, i) { group.appendChild(mapItem(p, m, here, i, n)); });
      group.appendChild(h('li', {
        class: 'sb-item sb-item--new',
        role: 'treeitem',
        'aria-level': '2',
        'aria-setsize': String(n),
        'aria-posinset': String(n),
        tabindex: '-1',
        'data-key': 'n:' + p.id,
        'data-pid': p.id
      }, h('div', { class: 'sb-row' }, ui().icon('plus', 'sb-icon'), h('span', { class: 'sb-name', text: t('sidebar.newMap') }))));
      li.appendChild(group);
    }
    return li;
  }

  function mapItem(p, m, here, index, total) {
    var current = here.projectId === p.id && here.mapId === m.id;
    var nodes = S().nodesIn(m);
    var title = t('sidebar.mapTitle', { name: m.name, nodes: plural('sidebar.nodes', nodes) });
    return h('li', {
      class: ['sb-item', 'sb-item--map', current && 'is-current'],
      role: 'treeitem',
      'aria-level': '2',
      'aria-setsize': String(total),
      'aria-posinset': String(index + 1),
      'aria-current': current ? 'page' : null,
      'aria-label': title,
      tabindex: '-1',
      'data-key': 'm:' + m.id,
      'data-pid': p.id,
      'data-mid': m.id
    }, h('div', { class: 'sb-row', title: title },
      ui().icon('map', 'sb-icon'),
      h('span', { class: 'sb-name', text: m.name }),
      h('span', { class: 'sb-count', text: ns.i18n.number(nodes), 'aria-hidden': 'true' }),
      moreButton(t('sidebar.moreMap', { name: m.name }))));
  }

  function build() {
    if (!els.root) return;
    if (drag) { pendingRender = true; return; }
    stale = false;
    countsFor = {};
    var store = S();
    var here = hereNow();
    var list = store.projects();
    var hadFocus = els.tree.contains(document.activeElement);
    var wasAt = focusKey && byKey(focusKey) ? rows.indexOf(byKey(focusKey)) : -1;
    var scroll = els.scroll.scrollTop;
    var frag = document.createDocumentFragment();
    list.forEach(function (p, i) { frag.appendChild(projectItem(p, here, i, list.length)); });
    els.tree.textContent = '';
    els.tree.appendChild(frag);
    els.tree.hidden = !list.length;
    els.empty.hidden = list.length > 0;
    rows = Array.prototype.slice.call(els.tree.querySelectorAll('.sb-item'));
    var keep = focusKey && byKey(focusKey);
    /* The focused row went away (deleted, moved out of sight): its
     * neighbour in the list takes the focus, as in any list. */
    if (!keep && hadFocus && wasAt >= 0) keep = rows[Math.min(wasAt, rows.length - 1)] || null;
    if (!keep) {
      keep = (here.mapId && byKey('m:' + here.mapId)) || (here.projectId && byKey('p:' + here.projectId)) || rows[0] || null;
    }
    rows.forEach(function (r) { r.tabIndex = r === keep ? 0 : -1; });
    focusKey = keep ? keep.getAttribute('data-key') : null;
    els.scroll.scrollTop = scroll;
    if (hadFocus && keep) keep.focus({ preventScroll: true });
    else if (hadFocus) els.newProject.focus({ preventScroll: true });
    paintHead();
    paintFooter();
    if (els.edge) els.edge.update();
  }

  var pendingRender = false;
  var buildSoon = util.throttleFrame(build);

  /* Nobody sees a closed sidebar (a closed column, or the drawer of a phone,
   * closed nearly all the time), and every edit of a map is a store change:
   * while it is closed the tree is only marked stale, and built when it
   * opens. */
  var stale = false;

  function shown() {
    if (document.documentElement.hasAttribute('data-sidebar-drag')) return true;
    return !(ns.shell && ns.shell.sidebar && !ns.shell.sidebar.isOpen());
  }

  /* A stale tree built as it comes into view: the row that will take the
   * focus is the open map's, as when the tree is first shown. */
  function freshen() {
    var here = hereNow();
    if (here.mapId && !els.tree.contains(document.activeElement)) focusKey = 'm:' + here.mapId;
    build();
  }

  /* A finger pulling the drawer in shows it before it is open (the shell
   * marks the page while the drawer follows the finger, and says nothing
   * on the bus): a stale tree is built as soon as it starts to show. */
  function watchShown() {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      if (stale && shown()) freshen();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-sidebar-drag', 'data-sidebar'] });
  }

  function schedule() {
    if (!shown()) { stale = true; buildSoon.cancel(); return; }
    buildSoon();
  }

  /* An edit of a map's text changes only the numbers: the node count of
   * its row and the counts line of its project. Those are repainted in
   * place; a whole build is kept for changes of the tree itself. */
  var countsFor = {};       // pid -> {mid: true}
  var paintCountsSoon = util.throttleFrame(paintCounts);

  function onStoreChange(change) {
    if (!change || change.type === 'history:changed' || change.type === 'view') return;
    if (change.type === 'map:text' && change.projectId && change.mapId && shown() && !stale && !drag) {
      var mids = countsFor[change.projectId] || (countsFor[change.projectId] = {});
      mids[change.mapId] = true;
      paintCountsSoon();
      return;
    }
    schedule();
  }

  function paintCounts() {
    var todo = countsFor;
    countsFor = {};
    if (!els.root || stale) return;
    var store = S();
    Object.keys(todo).forEach(function (pid) {
      var p = store.project(pid);
      var prow = byKey('p:' + pid);
      if (!p) { schedule(); return; }
      if (prow) {
        var meta = prow.querySelector(':scope > .sb-row .sb-meta');
        if (meta) meta.textContent = countsLine(p);
      }
      Object.keys(todo[pid]).forEach(function (mid) {
        var m = store.map(pid, mid);
        var row = byKey('m:' + mid);
        if (!m || !row) return;
        var nodes = store.nodesIn(m);
        var title = t('sidebar.mapTitle', { name: m.name, nodes: plural('sidebar.nodes', nodes) });
        row.setAttribute('aria-label', title);
        var r = row.querySelector(':scope > .sb-row');
        if (r) r.setAttribute('title', title);
        var count = row.querySelector(':scope > .sb-row .sb-count');
        if (count) count.textContent = ns.i18n.number(nodes);
      });
    });
  }

  function byKey(key) {
    for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute('data-key') === key) return rows[i];
    return null;
  }

  function paintHead() {
    setOff(els.newProject, !editable());
  }

  /* The footer acts on the open project and map. */
  function paintFooter() {
    var store = S();
    var here = hereNow();
    var p = here.projectId ? store.project(here.projectId) : null;
    setOff(els.copies, !here.mapId);
    var media = !!(ns.commands && ns.commands.has('media.panel'));
    els.images.hidden = !media;
    if (media) setOff(els.images, !ns.commands.enabled('media.panel'));
    els.trash.hidden = false;
    setOff(els.trash, !p);
    var n = p ? p.trash.length : 0;
    var label = p ? plural('sidebar.trashCount', n, { project: p.name }) : t('sidebar.trash');
    els.trash.setAttribute('aria-label', label);
    ui().tooltip(els.trash, label);
    els.trashBadge.textContent = n ? ns.i18n.number(n) : '';
    els.trashBadge.hidden = !n;
    if (lastTrash && p && lastTrash.pid === p.id && lastTrash.n !== n && n > 0) bump(els.trashBadge);
    lastTrash = p ? { pid: p.id, n: n } : null;
  }

  function setOff(btn, off) {
    if (off) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  /* One bump: the scale is a transition (motion.css), so a second change
   * while it plays retargets instead of restarting. */
  function bump(el) {
    el.setAttribute('data-bump', '');
    setTimeout(function () { el.removeAttribute('data-bump'); }, 90);
  }

  /* ================================================================ the shell of the sidebar */

  /* Copies, images and trash carry their word under the icon; settings and
   * help, which every screen has elsewhere too, are icons with a tooltip. */
  function footButton(id, icon, labelKey, onClick, iconOnly) {
    var b = h('button', { type: 'button', class: ['btn', 'sb-tool', iconOnly && 'sb-tool--icon'], id: id, 'aria-label': t(labelKey) },
      ui().icon(icon), h('span', { class: 'sb-tool__label', text: t(labelKey) }));
    b.addEventListener('click', function () {
      if (b.getAttribute('aria-disabled') === 'true') return;
      onClick(b);
    });
    if (iconOnly) ui().tooltip(b, t(labelKey));
    return b;
  }

  function mount() {
    var host = document.getElementById('sidebar');
    if (!host) return false;
    host.textContent = '';
    els.newProject = ui().button({ icon: 'plus', label: t('sidebar.newProject'), onClick: function () { runCmd('sidebar.newProject'); } });
    els.newProject.id = 'sb-new-project';
    els.io = ui().button({ icon: 'more', label: t('sidebar.ioMenu') });
    els.io.id = 'sb-io';
    els.io.setAttribute('aria-haspopup', 'menu');
    els.io.addEventListener('click', function () { ioMenu(els.io); });
    els.title = h('h2', { class: 'sb__title', id: 'sb-title', text: t('sidebar.title') });
    els.tree = h('ul', { class: 'sb-tree', role: 'tree', 'aria-labelledby': 'sb-title' });
    els.empty = h('p', { class: 'sb-empty', text: t('sidebar.empty'), hidden: true });
    els.line = h('div', { class: 'sb-drop', 'aria-hidden': 'true', hidden: true });
    els.scroll = h('div', { class: 'sb__scroll' }, els.tree, els.empty, els.line);
    els.copies = footButton('sb-copies', 'history', 'sidebar.copies', function () { runCmd('copies.open'); });
    els.images = footButton('sb-images', 'image', 'sidebar.images', function () { runCmd('media.panel'); });
    els.trash = footButton('sb-trash', 'trash', 'sidebar.trash', function () { runCmd('trash.open'); });
    els.trashBadge = h('span', { class: 'btn__badge sb-badge', 'aria-hidden': 'true', hidden: true });
    els.trash.appendChild(els.trashBadge);
    els.settings = footButton('sb-settings', 'settings', 'sidebar.settings', function () { runCmd('settings.open'); }, true);
    els.help = footButton('sb-help', 'help', 'sidebar.help', function () { runCmd('help.open'); }, true);
    els.foot = h('div', { class: 'sb__foot', role: 'toolbar', 'aria-label': t('sidebar.footer') },
      els.copies, els.images, els.trash, els.settings, els.help);
    els.root = h('div', { class: 'sb' },
      h('div', { class: 'sb__head' }, els.title, h('span', { class: 'sb__actions' }, els.newProject, els.io)),
      els.scroll,
      els.foot);
    host.appendChild(els.root);
    els.edge = ui().scrollEdge(els.scroll);
    ui().roving(els.foot, { selector: '.sb-tool' });

    els.tree.addEventListener('click', onClick);
    els.tree.addEventListener('dblclick', onDblClick);
    els.tree.addEventListener('contextmenu', onContextMenu);
    els.tree.addEventListener('keydown', onKey);
    els.tree.addEventListener('focusin', onFocusIn);
    els.tree.addEventListener('pointerdown', onPointerDown);
    /* Non-passive, so a long-pressed row can keep the list from scrolling
     * while the finger carries it. */
    els.tree.addEventListener('touchmove', function (event) { if (drag || (press && press.long)) event.preventDefault(); }, { passive: false });
    return true;
  }

  function runCmd(id, ctx) {
    if (!ns.commands || !ns.commands.has(id)) return false;
    return ns.commands.run(id, Object.assign({ source: 'sidebar' }, ctx || {}));
  }

  /* ================================================================ rows: what they do */

  function itemOf(el) { return el && el.closest ? el.closest('.sb-item') : null; }

  function info(item) {
    if (!item) return null;
    var key = item.getAttribute('data-key');
    return { kind: key[0] === 'p' ? 'project' : key[0] === 'm' ? 'map' : 'new', pid: item.getAttribute('data-pid'), mid: item.getAttribute('data-mid'), el: item, key: key };
  }

  /* A project row: an inactive project opens (its last map) and unfolds;
   * the active one folds and unfolds. In the drawer a project row only
   * folds and unfolds: opening its last map would close the drawer (it
   * closes on map:opened), and whoever taps a project there wants to see
   * its maps, to choose one. */
  function inDrawer() {
    return !!(ns.shell && ns.shell.sidebar && ns.shell.sidebar.isDrawer());
  }

  function activateProject(pid) {
    var here = hereNow();
    if (inDrawer()) {
      setExpanded(pid, !isExpanded(pid));
    } else if (here.projectId !== pid) {
      setExpanded(pid, true);
      S().setActive(pid);
    } else {
      setExpanded(pid, !isExpanded(pid));
    }
  }

  function openMap(pid, mid) {
    var s = ns.session;
    var was = hereNow();
    var drawer = !!(ns.shell && ns.shell.sidebar.isDrawer() && ns.shell.sidebar.isOpen());
    var job = null;
    if (s && typeof s.open === 'function') job = s.open(pid, mid);
    else S().setActive(pid, mid);
    /* The drawer closes on map:opened; the map already open says nothing,
     * so it is closed here too. */
    if (drawer && was.projectId === pid && was.mapId === mid && ns.shell.sidebar.isOpen()) ns.shell.sidebar.close();
    /* A map chosen from the drawer is where the keys should go next, not
     * the button the closing drawer handed the focus to. */
    if (drawer) {
      Promise.resolve(job).then(function () {
        var a = document.activeElement;
        var toggle = document.getElementById('sidebar-toggle');
        var view = s && s.view && s.view.el;
        if (view && (!a || a === document.body || a === toggle)) {
          try { view.focus({ preventScroll: true }); } catch (err) { /* fine where it is */ }
        }
      });
    }
  }

  function activate(item) {
    var d = info(item);
    if (!d) return;
    if (d.kind === 'project') activateProject(d.pid);
    else if (d.kind === 'map') openMap(d.pid, d.mid);
    else newMap(d.pid);
  }

  function onClick(event) {
    /* The click that ends a long press or a drag is not a choice. */
    if ((press && press.fired) || Date.now() - draggedAt < 400) { press = null; event.preventDefault(); return; }
    var item = itemOf(event.target);
    if (!item) return;
    var d = info(item);
    focusRow(item, false);
    var more = event.target.closest('.sb-more');
    if (more) { rowMenu(d, more); return; }
    if (d.kind === 'project' && event.target.closest('.sb-caret')) { setExpanded(d.pid, !isExpanded(d.pid)); return; }
    activate(item);
  }

  /* A mouse's double click renames; two taps of a finger are two choices
   * (the second often a moment after the drawer opened again). */
  function onDblClick(event) {
    if (lastPointer !== 'mouse') return;
    var item = itemOf(event.target);
    if (!item || event.target.closest('.sb-more')) return;
    var d = info(item);
    if (d.kind === 'map') renameMap(d.pid, d.mid);
  }

  function onContextMenu(event) {
    var item = itemOf(event.target);
    if (!item) return;
    event.preventDefault();
    if (press && press.fired) return;   // the long press already opened it
    /* A browser that says "context menu" for a long press before our own
     * timer does: this is that long press, opened once. */
    if (press && press.type !== 'mouse') {
      clearTimeout(press.timer);
      press.long = true;
      press.fired = true;
    }
    focusRow(item, false);
    var handle = rowMenu(info(item), null, { x: event.clientX, y: event.clientY });
    if (press && press.type !== 'mouse') press.menu = handle;
  }

  function onFocusIn(event) {
    var item = itemOf(event.target);
    if (!item || event.target !== item) return;
    focusRow(item, false);
  }

  function focusRow(item, move) {
    if (!item) return;
    rows.forEach(function (r) { r.tabIndex = r === item ? 0 : -1; });
    focusKey = item.getAttribute('data-key');
    if (move !== false) {
      item.focus({ preventScroll: true });
      scrollIntoView(item);
    }
  }

  function scrollIntoView(item) {
    var row = item.querySelector('.sb-row') || item;
    var r = row.getBoundingClientRect();
    var box = els.scroll.getBoundingClientRect();
    if (r.top < box.top) els.scroll.scrollTop -= box.top - r.top + 4;
    else if (r.bottom > box.bottom) els.scroll.scrollTop += r.bottom - box.bottom + 4;
  }

  /* ================================================================ keys */

  function onKey(event) {
    var item = event.target;
    if (!item || !item.classList || !item.classList.contains('sb-item')) return;
    if (event.isComposing) return;
    var d = info(item);
    var i = rows.indexOf(item);
    var mod = event.ctrlKey || event.metaKey;
    var handled = true;
    switch (event.key) {
      case 'ArrowDown':
        if (event.altKey && !mod) moveBy(d, 1);
        else if (!mod) focusRow(rows[Math.min(rows.length - 1, i + 1)]);
        else handled = false;
        break;
      case 'ArrowUp':
        if (event.altKey && !mod) moveBy(d, -1);
        else if (!mod) focusRow(rows[Math.max(0, i - 1)]);
        else handled = false;
        break;
      case 'Home': focusRow(rows[0]); break;
      case 'End': focusRow(rows[rows.length - 1]); break;
      case 'ArrowRight':
        if (d.kind !== 'project') { handled = !event.altKey; break; }
        if (!isExpanded(d.pid)) { setExpanded(d.pid, true); }
        else { var first = rows[i + 1]; if (first && first.getAttribute('data-pid') === d.pid && first !== item) focusRow(first); }
        break;
      case 'ArrowLeft':
        if (d.kind === 'project') {
          if (isExpanded(d.pid)) setExpanded(d.pid, false);
        } else {
          focusRow(byKey('p:' + d.pid));
        }
        break;
      case 'Enter':
      case ' ':
        if (mod || event.altKey) { handled = false; break; }
        activate(item);
        break;
      case 'F2':
        if (d.kind === 'map') renameMap(d.pid, d.mid);
        else if (d.kind === 'project') editProject(d.pid);
        break;
      case 'Delete':
      case 'Backspace':
        if (mod || event.altKey) { handled = false; break; }
        if (d.kind === 'map') deleteMap(d.pid, d.mid);
        else if (d.kind === 'project') deleteProject(d.pid);
        break;
      case 'ContextMenu':
        rowMenu(d, item.querySelector('.sb-more') || item);
        break;
      case 'F10':
        if (event.shiftKey) rowMenu(d, item.querySelector('.sb-more') || item);
        else handled = false;
        break;
      default:
        handled = false;
        if (event.key.length === 1 && !mod && !event.altKey && event.key !== ' ') handled = typeAhead(event.key, i);
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /* Letters jump to the next row whose name starts with what was typed. */
  function typeAhead(ch, from) {
    var now = Date.now();
    typeahead.text = (now - typeahead.at > TYPEAHEAD_MS ? '' : typeahead.text) + fold(ch);
    typeahead.at = now;
    var start = typeahead.text.length > 1 ? from : from + 1;
    for (var k = 0; k < rows.length; k++) {
      var r = rows[(start + k) % rows.length];
      var name = r.querySelector('.sb-name');
      if (name && fold(name.textContent).indexOf(typeahead.text) === 0) { focusRow(r); return true; }
    }
    /* No row starts so: the key is not the tree's (? still opens the help). */
    return false;
  }

  function fold(s) { return String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase(); }

  /* Alt+Up/Down: the project among projects, the map among its siblings. */
  function moveBy(d, delta) {
    if (!editable()) { refuse(); return; }
    var store = S();
    if (d.kind === 'project') {
      var list = store.projects();
      var i = list.findIndex(function (p) { return p.id === d.pid; });
      var to = i + delta;
      if (i < 0 || to < 0 || to >= list.length) return;
      store.moveProject(d.pid, to);
    } else if (d.kind === 'map') {
      var p = store.project(d.pid);
      var j = p.maps.findIndex(function (m) { return m.id === d.mid; });
      var to2 = j + delta;
      if (j < 0 || to2 < 0 || to2 >= p.maps.length) return;
      store.moveMap(d.pid, d.mid, to2);
    } else {
      return;
    }
    focusKey = d.key;
    build();
    var again = byKey(d.key);
    if (again) focusRow(again);
  }

  /* ================================================================ pointer: long press and drag */

  function onPointerDown(event) {
    lastPointer = event.pointerType || 'mouse';
    /* A new press is a new gesture: only the click that ends a drag is
     * swallowed, not a quick tap after it. */
    draggedAt = 0;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    var item = itemOf(event.target);
    if (!item || event.target.closest('.sb-more')) return;
    var d = info(item);
    if (d.kind === 'new') return;
    press = {
      id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, d: d,
      long: false, fired: false, timer: 0, menu: null
    };
    if (event.pointerType !== 'mouse') {
      press.timer = setTimeout(function () {
        if (!press || press.d !== d) return;
        press.long = true;
        press.fired = true;
        focusRow(item, false);
        press.menu = rowMenu(d, null, { x: press.x, y: press.y });
      }, LONG_PRESS);
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(event) {
    if (!press || event.pointerId !== press.id) return;
    if (drag) { event.preventDefault(); dragMove(event.clientX, event.clientY); return; }
    var dx = event.clientX - press.x;
    var dy = event.clientY - press.y;
    var far = Math.hypot(dx, dy);
    if (press.type === 'mouse') {
      if (far > MOUSE_SLOP && editable()) startDrag(event);
      return;
    }
    if (!press.long) {
      if (far > TOUCH_SLOP) { clearTimeout(press.timer); endPress(); }
      return;
    }
    if (far > TOUCH_SLOP && editable()) {
      if (press.menu && press.menu.close) press.menu.close({ restore: false });
      event.preventDefault();
      startDrag(event);
    }
  }

  function onPointerUp(event) {
    if (!press || event.pointerId !== press.id) return;
    clearTimeout(press.timer);
    if (drag) { finishDrag(true); endPress(); press = null; draggedAt = Date.now(); return; }
    /* A long press keeps press.fired for the click that follows it. */
    var done = press;
    endPress();
    if (!done.fired) press = null;
    else setTimeout(function () { if (press === done) press = null; }, 400);
  }

  function onPointerCancel(event) {
    if (!press || event.pointerId !== press.id) return;
    clearTimeout(press.timer);
    if (drag) finishDrag(false);
    endPress();
    press = null;
  }

  function endPress() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function startDrag(event) {
    var d = press.d;
    var row = d.el.querySelector('.sb-row');
    var r = row.getBoundingClientRect();
    var ghost = row.cloneNode(true);
    ghost.classList.add('sb-ghost');
    ghost.removeAttribute('title');
    ghost.style.width = r.width + 'px';
    (document.getElementById('layers') || document.body).appendChild(ghost);
    d.el.setAttribute('data-dragging', '');
    drag = { d: d, ghost: ghost, dx: press.x - r.left, dy: press.y - r.top, target: null, x: event.clientX, y: event.clientY, raf: 0 };
    drag.popEsc = ui().escape.push(function () { finishDrag(false); endPress(); press = null; });
    document.documentElement.setAttribute('data-sb-dragging', '');
    dragMove(event.clientX, event.clientY);
    autoScroll();
  }

  function dragMove(x, y) {
    drag.x = x;
    drag.y = y;
    drag.ghost.style.translate = (x - drag.dx) + 'px ' + (y - drag.dy) + 'px';
    drag.target = dropTarget(x, y);
    paintDrop();
  }

  /* Where a drop would land: {before: item | null, after: item | null,
   * index} in the list the dragged row belongs to, or null (not here). */
  function dropTarget(x, y) {
    var box = els.scroll.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top - EDGE || y > box.bottom + EDGE) return null;
    var d = drag.d;
    var store = S();
    if (d.kind === 'project') {
      var items = Array.prototype.slice.call(els.tree.children);
      if (!items.length) return null;
      for (var i = 0; i < items.length; i++) {
        var r = items[i].querySelector('.sb-row').getBoundingClientRect();
        var whole = items[i].getBoundingClientRect();
        if (y < r.top + r.height / 2) return { line: whole.top, index: i, ok: true };
        if (y < whole.bottom) return { line: whole.bottom, index: i + 1, ok: true };
      }
      return { line: items[items.length - 1].getBoundingClientRect().bottom, index: items.length, ok: true };
    }
    var p = store.project(d.pid);
    var proj = byKey('p:' + d.pid);
    if (!p || !proj) return null;
    var maps = Array.prototype.slice.call(proj.querySelectorAll('.sb-item--map'));
    var under = document.elementFromPoint(Math.min(Math.max(x, box.left + 1), box.right - 1), y);
    var over = itemOf(under);
    if (over && over.getAttribute('data-pid') !== d.pid) return { ok: false };
    for (var j = 0; j < maps.length; j++) {
      var mr = maps[j].getBoundingClientRect();
      if (y < mr.top + mr.height / 2) return { line: mr.top, index: j, ok: true };
    }
    var last = maps[maps.length - 1];
    var lr = last ? last.getBoundingClientRect() : proj.querySelector('.sb-row').getBoundingClientRect();
    return { line: lr.bottom, index: maps.length, ok: true };
  }

  function paintDrop() {
    var tgt = drag.target;
    drag.ghost.toggleAttribute('data-refused', !!(tgt && !tgt.ok));
    if (!tgt || !tgt.ok) { els.line.hidden = true; return; }
    var box = els.scroll.getBoundingClientRect();
    els.line.hidden = false;
    els.line.style.top = (tgt.line - box.top + els.scroll.scrollTop) + 'px';
    els.line.toggleAttribute('data-inner', drag.d.kind === 'map');
  }

  /* Near the top or bottom edge the list scrolls under the dragged row. */
  function autoScroll() {
    if (!drag) return;
    var box = els.scroll.getBoundingClientRect();
    var v = 0;
    if (drag.y < box.top + EDGE) v = -Math.ceil((box.top + EDGE - drag.y) / 3);
    else if (drag.y > box.bottom - EDGE) v = Math.ceil((drag.y - box.bottom + EDGE) / 3);
    if (v) {
      els.scroll.scrollTop += v;
      drag.target = dropTarget(drag.x, drag.y);
      paintDrop();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  /* toIndex counts the rows as they are before the move; the store wants
   * the place in the list without the moved one. */
  function finishDrag(commit) {
    var dr = drag;
    if (!dr) return;
    drag = null;
    cancelAnimationFrame(dr.raf);
    if (dr.popEsc) dr.popEsc();
    dr.ghost.remove();
    els.line.hidden = true;
    dr.d.el.removeAttribute('data-dragging');
    document.documentElement.removeAttribute('data-sb-dragging');
    var tgt = dr.target;
    if (commit && tgt && !tgt.ok && dr.d.kind === 'map') ui().toast(t('sidebar.notAcross'));
    if (commit && tgt && tgt.ok && editable()) {
      var store = S();
      if (dr.d.kind === 'project') {
        var i = store.projects().findIndex(function (p) { return p.id === dr.d.pid; });
        var to = tgt.index > i ? tgt.index - 1 : tgt.index;
        if (i >= 0 && to !== i) store.moveProject(dr.d.pid, to);
      } else {
        var p = store.project(dr.d.pid);
        var j = p ? p.maps.findIndex(function (m) { return m.id === dr.d.mid; }) : -1;
        var to2 = tgt.index > j ? tgt.index - 1 : tgt.index;
        if (j >= 0 && to2 !== j) store.moveMap(dr.d.pid, dr.d.mid, to2);
      }
      focusKey = dr.d.key;
    }
    pendingRender = false;
    build();
  }

  /* ================================================================ menus */

  function rowMenu(d, anchor, point) {
    if (!d) return null;
    var items = d.kind === 'project' ? projectItems(d.pid) : d.kind === 'map' ? mapItems(d.pid, d.mid) : null;
    if (!items) return null;
    var label = d.kind === 'project' ? S().project(d.pid).name : (S().map(d.pid, d.mid) || {}).name;
    var key = d.kind === 'project' ? 'p:' + d.pid : 'm:' + d.mid;
    /* The list may have been rebuilt under an open menu (a clock copy, an
     * edit of another map, an undo that travelled): the anchor the menu
     * would give the focus back to is gone, so the focus stays on the
     * closed menu's item - hidden but still in the page until its exit
     * transition ends - and then drops to the body. The row is found again
     * by its key, at once and once more a frame later (a menu item chosen
     * may have opened a dialog meanwhile: that keeps the focus). A menu
     * that gave the focus back, or lost it to a tap elsewhere, is left
     * alone. */
    function lost() {
      var a = document.activeElement;
      return !a || a === document.body || !a.isConnected ||
        !!(a.closest && a.closest('.menu, .sheet--menu, [hidden]'));
    }
    function regain() {
      if (!lost()) return;
      var row = byKey(key);
      if (row && !row.closest('[inert]')) focusRow(row);
    }
    function onClose() {
      if (!lost()) return;
      regain();
      util.nextFrame().then(regain);
    }
    if (anchor) return ui().menu(anchor, items, { align: 'end', title: label, label: label, onClose: onClose });
    return ui().contextMenu(point, items, { title: label, label: label, onClose: onClose });
  }

  function projectItems(pid) {
    var store = S();
    var p = store.project(pid);
    if (!p) return null;
    var w = editable();
    var here = hereNow();
    var list = store.projects();
    var i = list.indexOf(p);
    /* Its branches can go into the open map when it has a map other than
     * that one. */
    var otherOpen = !!here.mapId && p.maps.some(function (m) { return !(here.projectId === pid && here.mapId === m.id); });
    var media = ns.commands && ns.commands.has('media.panel');
    return [
      { label: t('sidebar.menu.newMap'), icon: 'plus', disabled: !w, onSelect: function () { newMap(pid); } },
      { label: t('sidebar.menu.editProject'), icon: 'rename', shortcut: 'F2', disabled: !w, onSelect: function () { editProject(pid); } },
      { label: t('sidebar.menu.duplicate'), icon: 'copy', disabled: !w, onSelect: function () { duplicateProject(pid); } },
      { label: t(p.isTemplate ? 'sidebar.menu.stopTemplate' : 'sidebar.menu.useTemplate'), icon: 'template', disabled: !w, onSelect: function () { toggleTemplate(pid); } },
      { label: t('sidebar.menu.importInto'), icon: 'import', disabled: !w || !otherOpen, hint: otherOpen ? null : t('sidebar.menu.importHint'),
        onSelect: function () { importBranches({ projectId: pid }); } },
      '-',
      { label: t('sidebar.menu.exportZip'), icon: 'export', onSelect: function () { exportProject(pid, 'zip'); } },
      { label: t('sidebar.menu.exportJson'), icon: 'download', onSelect: function () { exportProject(pid, 'json'); } },
      '-',
      media ? { label: t('sidebar.menu.images'), icon: 'image', onSelect: function () { S().setActive(pid); runCmd('media.panel'); } } : null,
      { label: t('sidebar.menu.trash', { n: ns.i18n.number(p.trash.length) }), icon: 'trash', onSelect: function () { S().setActive(pid); runCmd('trash.open'); } },
      '-',
      { label: t('sidebar.menu.moveUp'), icon: 'arrow-up', shortcut: 'Alt+ArrowUp', disabled: !w || i <= 0, onSelect: function () { moveBy({ kind: 'project', pid: pid, key: 'p:' + pid }, -1); } },
      { label: t('sidebar.menu.moveDown'), icon: 'arrow-down', shortcut: 'Alt+ArrowDown', disabled: !w || i >= list.length - 1, onSelect: function () { moveBy({ kind: 'project', pid: pid, key: 'p:' + pid }, 1); } },
      '-',
      { label: t('sidebar.menu.deleteProject'), icon: 'trash', danger: true, shortcut: 'Delete', disabled: !w, onSelect: function () { deleteProject(pid); } }
    ];
  }

  function mapItems(pid, mid) {
    var store = S();
    var p = store.project(pid);
    var m = store.map(pid, mid);
    if (!p || !m) return null;
    var w = editable();
    var here = hereNow();
    var isOpen = here.projectId === pid && here.mapId === mid;
    var j = p.maps.indexOf(m);
    return [
      isOpen ? null : { label: t('sidebar.menu.open'), icon: 'open', onSelect: function () { openMap(pid, mid); } },
      { label: t('sidebar.menu.rename'), icon: 'rename', shortcut: 'F2', disabled: !w, onSelect: function () { renameMap(pid, mid); } },
      { label: t('sidebar.menu.duplicate'), icon: 'copy', disabled: !w, onSelect: function () { duplicateMap(pid, mid); } },
      { label: t('sidebar.menu.copies'), icon: 'history', onSelect: function () { openMap(pid, mid); runCmd('copies.open'); } },
      isOpen ? null : { label: t('sidebar.menu.importInto'), icon: 'import', disabled: !w || !here.mapId,
        onSelect: function () { importBranches({ projectId: pid, mapId: mid }); } },
      '-',
      { label: t('sidebar.menu.moveUp'), icon: 'arrow-up', shortcut: 'Alt+ArrowUp', disabled: !w || j <= 0, onSelect: function () { moveBy({ kind: 'map', pid: pid, mid: mid, key: 'm:' + mid }, -1); } },
      { label: t('sidebar.menu.moveDown'), icon: 'arrow-down', shortcut: 'Alt+ArrowDown', disabled: !w || j >= p.maps.length - 1, onSelect: function () { moveBy({ kind: 'map', pid: pid, mid: mid, key: 'm:' + mid }, 1); } },
      '-',
      { label: t('sidebar.menu.deleteMap'), icon: 'trash', danger: true, shortcut: 'Delete', disabled: !w, onSelect: function () { deleteMap(pid, mid); } }
    ];
  }

  /* The header's menu: everything that comes in or goes out. */
  function ioMenu(anchor) {
    var w = editable();
    var any = S().projects().length > 0;
    var items = [
      { label: t('sidebar.newProject'), icon: 'plus', disabled: !w, onSelect: function () { runCmd('sidebar.newProject'); } },
      { label: t('sidebar.menu.importBranches'), icon: 'child', disabled: !w || !ns.commands.enabled('map.importBranches'), onSelect: function () { runCmd('map.importBranches'); } },
      '-',
      { label: t('sidebar.menu.importFile'), icon: 'import', disabled: !w, onSelect: function () { pickImport(); } },
      { label: t('sidebar.menu.importFolder'), icon: 'folder', disabled: !w, onSelect: function () { pickFolder(); } },
      '-',
      { label: t('sidebar.menu.exportAllZip'), icon: 'export', disabled: !any, onSelect: function () { runCmd('file.backup'); } },
      { label: t('sidebar.menu.exportAllJson'), icon: 'download', disabled: !any, onSelect: function () { exportAllJson(); } },
      ns.commands.has('file.restore') ? { label: t('sidebar.menu.restore'), icon: 'restore', disabled: !w, onSelect: function () { runCmd('file.restore'); } } : null
    ];
    return ui().menu(anchor, items, { align: 'end', title: t('sidebar.ioMenu'), label: t('sidebar.ioMenu') });
  }

  /* ================================================================ projects */

  function field(label, control, hint) {
    var id = util.uid('fld');
    control.id = id;
    var hintEl = hint ? h('p', { class: 'field__hint', id: id + '-h', text: hint }) : null;
    if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
    return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id, text: label }), control, hintEl);
  }

  function newProjectDialog(opts) {
    opts = opts || {};
    if (!editable()) return Promise.resolve(refuse());
    var store = S();
    var name = h('input', { class: 'input', type: 'text', autocomplete: 'off', maxlength: '120', value: opts.name || '' });
    var error = h('p', { class: 'field__error', 'aria-live': 'polite' });
    var desc = h('textarea', { class: 'textarea', rows: '2', maxlength: '500' });
    var templates = store.templates();
    var group = util.uid('from');
    var choices = h('div', { class: 'ws-choices', role: 'radiogroup', 'aria-labelledby': group + '-l' });
    var withContent = h('input', { type: 'checkbox', checked: true });
    var withRow = h('label', { class: 'check ws-choices__sub', hidden: true }, withContent, h('span', { text: t('sidebar.dlg.withContent') }));
    function choice(value, title, hint, checked) {
      var input = h('input', { type: 'radio', name: group, value: value, checked: !!checked });
      input.addEventListener('change', function () { withRow.hidden = choices.querySelector('input:checked').value === ''; });
      return h('label', { class: 'ws-choice' }, input, h('span', { class: 'ws-choice__text' },
        h('span', { class: 'ws-choice__title', text: title }), h('span', { class: 'ws-choice__hint', text: hint })));
    }
    choices.appendChild(choice('', t('sidebar.dlg.empty'), t('sidebar.dlg.emptyHint'), !opts.templateId));
    templates.forEach(function (tp) {
      var names = tp.maps.map(function (m) { return m.name; });
      var shown = names.length > 3 ? names.slice(0, 3).concat('\u2026') : names;
      choices.appendChild(choice(tp.id, tp.name, plural('sidebar.dlg.templateMaps', names.length, { names: shown.join(', ') }), opts.templateId === tp.id));
    });
    withRow.hidden = !opts.templateId;
    var nameField = field(t('sidebar.dlg.name'), name);
    error.id = name.id + '-e';
    name.setAttribute('aria-describedby', error.id);
    nameField.appendChild(error);
    var body = h('div', { class: 'ws-form' },
      nameField,
      field(t('sidebar.dlg.description'), desc, t('sidebar.dlg.descriptionHint')),
      h('div', { class: 'field' },
        h('span', { class: 'field__label', id: group + '-l', text: t('sidebar.dlg.startFrom') }),
        choices,
        withRow,
        templates.length ? null : h('p', { class: 'field__hint', text: t('sidebar.dlg.noTemplates') })));
    name.addEventListener('input', function () { error.textContent = ''; name.removeAttribute('aria-invalid'); });
    var made = null;
    var template = null;
    return ui().dialog({
      title: t('sidebar.dlg.newProject'),
      body: body,
      initialFocus: name,
      actions: [{ label: t('ui.cancel'), value: false }, { label: t('sidebar.dlg.make'), kind: 'primary', value: true }],
      onAction: function (value) {
        if (value !== true) return true;
        var text = name.value.trim();
        if (!text) {
          error.textContent = t('ui.required');
          name.setAttribute('aria-invalid', 'true');
          name.focus();
          return false;
        }
        var from = choices.querySelector('input:checked');
        var tid = from ? from.value : '';
        made = store.createProject({
          name: text, description: desc.value.trim(),
          fromTemplateId: tid || null, withContent: !!withContent.checked
        });
        template = tid ? store.project(tid) : null;
        return true;
      }
    }).then(function () {
      if (!made) return null;
      setExpanded(made.id, true);
      ui().toast(template ? t('sidebar.madeFrom', { name: made.name, template: template.name }) : t('sidebar.made', { name: made.name }));
      keysToNewMap();
      return made;
    });
  }

  /* A map just made is where the person goes next: the keys land on it
   * with its root chosen, so Tab and Enter start building it at once (and
   * a screen reader says where they are), rather than staying on a
   * sidebar button or falling on the page. */
  function keysToNewMap() {
    var go = function () {
      var s = ns.session;
      var v = s && s.view;
      if (!v || !v.el || !s.current()) return;
      /* The person may already be there (a click on the map, a name being
       * written): the keys are not taken from them. */
      var a = document.activeElement;
      if ((a && v.el.contains(a)) || (ns.editor && ns.editor.isRenaming && ns.editor.isRenaming())) return;
      var first = v.visiblePaths()[0];
      if (s.selected() === null && first !== undefined) s.select(first, { reveal: false });
      try { v.el.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
    };
    util.nextFrame().then(go);
  }

  function editProject(pid) {
    if (!editable()) return Promise.resolve(refuse());
    var store = S();
    var p = store.project(pid);
    if (!p) return Promise.resolve(null);
    var name = h('input', { class: 'input', type: 'text', autocomplete: 'off', maxlength: '120', value: p.name });
    var error = h('p', { class: 'field__error', 'aria-live': 'polite' });
    var desc = h('textarea', { class: 'textarea', rows: '3', maxlength: '500' });
    desc.value = p.description || '';
    var nameField = field(t('sidebar.dlg.name'), name);
    error.id = name.id + '-e';
    name.setAttribute('aria-describedby', error.id);
    nameField.appendChild(error);
    name.addEventListener('input', function () { error.textContent = ''; name.removeAttribute('aria-invalid'); });
    return ui().dialog({
      title: t('sidebar.dlg.editProject'),
      body: h('div', { class: 'ws-form' }, nameField, field(t('sidebar.dlg.description'), desc, t('sidebar.dlg.descriptionHint'))),
      initialFocus: name,
      actions: [{ label: t('ui.cancel'), value: false }, { label: t('sidebar.dlg.save'), kind: 'primary', value: true }],
      onAction: function (value) {
        if (value !== true) return true;
        if (!name.value.trim()) {
          error.textContent = t('ui.required');
          name.setAttribute('aria-invalid', 'true');
          name.focus();
          return false;
        }
        store.updateProject(pid, { name: name.value, description: desc.value });
        return true;
      }
    });
  }

  function duplicateProject(pid) {
    if (!editable()) return refuse();
    var copy = S().duplicateProject(pid);
    if (!copy) return false;
    setExpanded(copy.id, true);
    ui().toastUndo(t('sidebar.duplicated', { name: copy.name }));
    return true;
  }

  function toggleTemplate(pid) {
    if (!editable()) return refuse();
    var p = S().project(pid);
    if (!p) return false;
    S().setTemplate(pid, !p.isTemplate);
    ui().toast(t(p.isTemplate ? 'sidebar.notTemplate' : 'sidebar.isTemplate', { name: p.name }));
    return true;
  }

  /* The one delete that asks: a project has no trash to go to. */
  function deleteProject(pid) {
    if (!editable()) return Promise.resolve(refuse());
    var p = S().project(pid);
    if (!p) return Promise.resolve(false);
    var n = p.maps.length;
    return ui().confirm({
      title: t('sidebar.dlg.deleteProject', { name: p.name }),
      text: plural('sidebar.dlg.deleteProjectText', n, { name: p.name }),
      ok: t('sidebar.dlg.delete'),
      danger: true
    }).then(function (yes) {
      if (!yes) return false;
      if (!S().deleteProject(pid)) return false;
      ui().toastUndo(t('sidebar.projectDeleted', { name: p.name }));
      return true;
    });
  }

  function exportProject(pid, kind) {
    var A = ns.archive;
    if (!A) return Promise.resolve(null);
    var job = kind === 'json' ? A.projectJson(pid) : A.projectZip(pid);
    return job.then(function (file) {
      A.download(file);
      ui().toast(t('sidebar.exported', { file: file.name }));
      return file.name;
    }, function (err) {
      ui().toast(t('sidebar.exportFailed', { message: (err && err.message) || String(err) }), { kind: 'error' });
      return null;
    });
  }

  function exportAllJson() {
    var A = ns.archive;
    if (!A) return Promise.resolve(null);
    return A.workspaceJson().then(function (file) {
      A.download(file);
      ui().toast(t('sidebar.exported', { file: file.name }));
      return file.name;
    }, function (err) {
      ui().toast(t('sidebar.exportFailed', { message: (err && err.message) || String(err) }), { kind: 'error' });
      return null;
    });
  }

  /* ================================================================ maps */

  function newMap(pid) {
    if (!editable()) return Promise.resolve(refuse());
    var store = S();
    pid = pid || hereNow().projectId;
    if (!pid || !store.project(pid)) return newProjectDialog();
    return ui().prompt({
      title: t('sidebar.dlg.newMap'),
      label: t('sidebar.dlg.mapName'),
      value: t('sidebar.newMap'),
      ok: t('sidebar.dlg.make'),
      maxLength: 120
    }).then(function (name) {
      if (!name) return null;
      setExpanded(pid, true);
      var made = store.createMap(pid, { name: name, text: ns.doc.emptyDocument(name) });
      if (made) keysToNewMap();
      return made;
    });
  }

  function renameMap(pid, mid) {
    if (!editable()) return Promise.resolve(refuse());
    var m = S().map(pid, mid);
    if (!m) return Promise.resolve(null);
    return ui().prompt({
      title: t('sidebar.dlg.renameMap'),
      label: t('sidebar.dlg.mapName'),
      value: m.name,
      ok: t('sidebar.dlg.save'),
      maxLength: 120
    }).then(function (name) {
      if (!name || name === m.name) return null;
      renameMapAndRoot(pid, mid, name);
      return name;
    });
  }

  /* A map and its primary node (its root, or the first of several) share
   * a name: renaming the map writes the new name on that node too, one
   * undo step. A node with no words of its own (a picture) is left as it is. */
  function renameMapAndRoot(pid, mid, name) {
    var store = S();
    var D = ns.doc;
    var m = store.map(pid, mid);
    var state = m && D ? D.parse(m.text || '') : null;
    var path = state ? D.primaryPath(state) : null;
    if (path === null || !D.primaryName(state) || D.primaryName(state) === name.trim() || typeof store.transaction !== 'function') {
      store.renameMap(pid, mid, name);
      return;
    }
    store.transaction('store.label.renameMap', function () {
      if (!store.renameMap(pid, mid, name)) return;
      var renamed = D.rename(state, path, store.map(pid, mid).name);
      if (renamed) store.setMapText(pid, mid, renamed.text, { label: 'store.label.renameMap', origin: 'sidebar' });
    });
  }

  function duplicateMap(pid, mid) {
    if (!editable()) return refuse();
    var copy = S().duplicateMap(pid, mid);
    if (!copy) return false;
    ui().toastUndo(t('sidebar.mapDuplicated', { name: copy.name }));
    return true;
  }

  /* To the trash at once, no question: the way back is right there. */
  function deleteMap(pid, mid) {
    if (!editable()) return refuse();
    var m = S().map(pid, mid);
    if (!m) return false;
    var entry = S().deleteMap(pid, mid);
    if (!entry) return false;
    ui().toastUndo(t('sidebar.mapTrashed', { name: m.name }));
    return true;
  }

  /* ================================================================ import branches */

  /* Nodes of another map, ticked, copied with everything under them into
   * the open map under the chosen node. A node ticked ticks (and greys) its
   * whole branch: it comes along anyway. Unticking it gives the branch back
   * the ticks it had by hand. */
  function importBranches(opts) {
    opts = opts || {};
    if (!editable()) return Promise.resolve(refuse());
    var store = S();
    var cur = ns.session && ns.session.current ? ns.session.current() : null;
    if (!cur) { ui().toast(t('sidebar.ib.needMap')); return Promise.resolve(null); }
    var target = { projectId: cur.projectId, mapId: cur.mapId };
    var sources = [];
    store.projects().forEach(function (p) {
      p.maps.forEach(function (m) {
        if (p.id === target.projectId && m.id === target.mapId) return;
        sources.push({ pid: p.id, mid: m.id, project: p, map: m });
      });
    });
    if (!sources.length) { ui().toast(t('sidebar.ib.noOther')); return Promise.resolve(null); }
    var start = sources.filter(function (s) { return s.mid === opts.mapId; })[0] ||
      sources.filter(function (s) { return s.pid === opts.projectId; })[0] || sources[0];

    var from = h('select', { class: 'select' });
    var byProject = {};
    sources.forEach(function (s) {
      var g = byProject[s.pid];
      if (!g) { g = byProject[s.pid] = h('optgroup', { label: s.project.name }); from.appendChild(g); }
      g.appendChild(h('option', { value: s.pid + '\n' + s.mid, text: s.map.name, selected: s === start }));
    });
    var filter = h('input', { class: 'input', type: 'search', autocomplete: 'off', placeholder: t('sidebar.ib.filter'), 'aria-label': t('sidebar.ib.filter') });
    var allBtn = ui().button({ label: t('sidebar.ib.all'), kind: 'text' });
    var noneBtn = ui().button({ label: t('sidebar.ib.none'), kind: 'text' });
    var list = h('ul', { class: 'ws-picktree', 'aria-label': t('sidebar.ib.nodes') });
    var note = h('p', { class: 'ws-note', 'aria-live': 'polite' });
    var under = h('select', { class: 'select' });
    var underLabel = h('label', { class: 'field__label', text: t('sidebar.ib.under', { map: store.map(target.projectId, target.mapId).name }) });
    var underId = util.uid('fld');
    under.id = underId;
    underLabel.setAttribute('for', underId);

    var fromId = util.uid('fld');
    from.id = fromId;

    var targetState = ns.doc.parse(store.map(target.projectId, target.mapId).text);
    var rootEntry = targetState.byPath[''];
    under.appendChild(h('option', { value: rootEntry ? '' : '\u0000', text: rootEntry ? t('sidebar.ib.root', { label: ns.doc.plainText(rootEntry) }) : t('sidebar.ib.top') }));
    var selected = ns.session.selected ? ns.session.selected() : null;
    targetState.flat.forEach(function (e) {
      if (e.path === '') return;
      var depth = e.path.split('.').length - (rootEntry ? 0 : 1);
      under.appendChild(h('option', { value: e.path, text: '   '.repeat(Math.max(0, depth)) + ns.doc.plainText(e), selected: e.path === selected }));
    });

    var hand = new Set();
    var source = null;   // {pid, mid, state}
    var actions = [{ label: t('ui.cancel'), value: false }, { label: plural('sidebar.ib.go', 0), kind: 'primary', value: true, disabled: true }];
    var api = null;

    function covered(path) {
      for (var p of hand) if (p !== path && (p === '' ? path !== '' : path.indexOf(p + '.') === 0)) return true;
      return false;
    }
    function chosen() {
      return Array.from(hand).filter(function (p) { return !covered(p); });
    }
    function loadSource() {
      var parts = from.value.split('\n');
      var m = store.map(parts[0], parts[1]);
      source = { pid: parts[0], mid: parts[1], state: ns.doc.parse(m ? m.text : '') };
      hand.clear();
      paintTree();
    }
    function paintTree() {
      var q = fold(filter.value.trim());
      var words = q ? q.split(/\s+/) : [];
      var flat = source.state.flat;
      var show = new Set();
      flat.forEach(function (e) {
        var text = fold(ns.doc.plainText(e));
        if (words.every(function (w) { return text.indexOf(w) >= 0; })) {
          var p = e.path;
          while (p !== null && p !== undefined) { show.add(p); p = ns.doc.parentPath(p); }
        }
      });
      list.textContent = '';
      var rootHere = !!source.state.byPath[''];
      flat.forEach(function (e) {
        if (!show.has(e.path)) return;
        var depth = e.path === '' ? 0 : e.path.split('.').length - (rootHere ? 0 : 1);
        var cov = covered(e.path);
        var box = h('input', { type: 'checkbox', checked: hand.has(e.path) || cov, disabled: cov, 'data-path': e.path });
        var n = countUnder(e.path);
        list.appendChild(h('li', { class: 'ws-pick', style: { '--depth': String(depth) } },
          h('label', { class: 'check' }, box, h('span', { class: 'ws-pick__text', text: ns.doc.plainText(e) }),
            n ? h('span', { class: 'ws-pick__count', text: t('sidebar.ib.descendants', { n: ns.i18n.number(n) }) }) : null)));
      });
      if (!flat.length) note.textContent = t('sidebar.ib.emptyMap');
      else if (!list.children.length) note.textContent = t('sidebar.ib.noMatch', { q: filter.value.trim() });
      else note.textContent = '';
      paintCount();
    }
    function countUnder(path) {
      var n = 0;
      var pre = path === '' ? '' : path + '.';
      source.state.flat.forEach(function (e) { if (e.path !== path && (path === '' || e.path.indexOf(pre) === 0)) n++; });
      return n;
    }
    function paintCount() {
      var n = chosen().length;
      actions[1].disabled = n === 0;
      if (api) {
        var b = api.button(1);
        b.disabled = n === 0;
        b.querySelector('.btn__label').textContent = plural('sidebar.ib.go', n);
      }
    }
    list.addEventListener('change', function (event) {
      var box = event.target;
      if (!box.matches('input[type=checkbox]')) return;
      var path = box.getAttribute('data-path');
      if (box.checked) hand.add(path); else hand.delete(path);
      var keep = list.scrollTop;
      paintTree();
      list.scrollTop = keep;
      var again = list.querySelector('input[data-path="' + CSS.escape(path) + '"]');
      if (again) again.focus();
    });
    allBtn.addEventListener('click', function () {
      Array.prototype.forEach.call(list.querySelectorAll('input[type=checkbox]:not(:disabled)'), function (b) { hand.add(b.getAttribute('data-path')); });
      paintTree();
    });
    noneBtn.addEventListener('click', function () { hand.clear(); paintTree(); });
    from.addEventListener('change', loadSource);
    filter.addEventListener('input', paintTree);
    filter.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && filter.value) { event.preventDefault(); event.stopPropagation(); filter.value = ''; paintTree(); }
    });

    var body = h('div', { class: 'ws-form ws-ib' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: fromId, text: t('sidebar.ib.from') }), from),
      h('div', { class: 'ws-ib__bar' }, filter, allBtn, noneBtn),
      list, note,
      h('div', { class: 'field' }, underLabel, under));
    loadSource();
    var result = null;
    return ui().dialog({
      title: t('sidebar.ib.title'),
      body: body,
      cls: 'dialog--wide',
      initialFocus: from,
      actions: actions,
      onOpen: function (a) { api = a; paintCount(); },
      onAction: function (value) {
        if (value !== true) return true;
        var paths = chosen();
        if (!paths.length) return false;
        var parent = under.value === '\u0000' ? null : under.value;
        result = store.importBranches({ from: { projectId: source.pid, mapId: source.mid }, to: target, paths: paths, parent: parent });
        return true;
      }
    }).then(function () {
      if (!result) return null;
      if (!result.count) { ui().toast(t('sidebar.ib.nothing')); return result; }
      if (ns.session && typeof ns.session.open === 'function') {
        ns.session.open(target.projectId, target.mapId, { where: { anchorLine: result.anchorLine } });
      }
      ui().toastUndo(plural('sidebar.ib.done', result.count));
      return result;
    });
  }

  /* ================================================================ import */

  function said(out) {
    if (!out) return;
    var any = (out.projects && out.projects.length) || (out.maps && out.maps.length);
    var text = out.message || t('sidebar.nothingImported');
    if (any) {
      out.projects.forEach(function (p) { if (p) setExpandedQuiet(p.id); });
      ui().toastUndo(text);
    } else {
      ui().toast(text, { kind: out.errors && out.errors.length ? 'error' : 'info' });
    }
  }

  function setExpandedQuiet(pid) {
    var e = expandedPrefs();
    if (Object.prototype.hasOwnProperty.call(e, pid)) return;
    setExpanded(pid, true);
  }

  function failed(err) {
    ui().toast(t('sidebar.importFailed', { message: (err && err.message) || String(err) }), { kind: 'error' });
    return null;
  }

  /* Files of any kind the archive reads (ZIP, JSON, .md, a PNG with its
   * map inside); everything at once is one step and one message. */
  function importFiles(files) {
    if (!editable()) return Promise.resolve(refuse());
    if (!files || !files.length || !ns.archive) return Promise.resolve(null);
    return ns.archive.importFiles(files).then(function (out) { said(out); return out; }, failed);
  }

  function importEntries(entries) {
    if (!editable()) return Promise.resolve(refuse());
    if (!entries || !entries.length || !ns.archive) return Promise.resolve(null);
    return ns.archive.importEntries(entries).then(function (out) { said(out); return out; }, failed);
  }

  function pickImport() {
    if (!editable()) return Promise.resolve(refuse());
    return util.pickFiles({ accept: IMPORT_ACCEPT, multiple: true }).then(importFiles);
  }

  function pickFolder() {
    if (!editable()) return Promise.resolve(refuse());
    return util.pickFiles({ directory: true, multiple: true }).then(function (files) {
      if (!files.length) return null;
      return importEntries(ns.archive.fromDirectoryInput(files));
    });
  }

  var IMPORTABLE = /\.(zip|json|md|markdown)$/i;

  /* A drop on the page: folders and the files the archive reads come in
   * here. Pictures are left to the media module (they go into a node); a
   * PNG exported by MindRoot is a picture too until someone asks for it as
   * a map. The DataTransfer is read now, inside the browser's event. */
  function onDrop(d) {
    if (!d || !d.dataTransfer) return;
    var items = d.dataTransfer.items ? Array.prototype.slice.call(d.dataTransfer.items) : [];
    var folders = [];
    var files = [];
    items.forEach(function (item) {
      if (item.kind !== 'file') return;
      var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) { folders.push(entry); return; }
      var f = item.getAsFile();
      if (f && IMPORTABLE.test(f.name)) files.push(f);
    });
    if (!items.length) (d.files || []).forEach(function (f) { if (IMPORTABLE.test(f.name)) files.push(f); });
    if (!folders.length && !files.length) return;
    if (!editable()) { refuse(); return; }
    if (folders.length) {
      Promise.all(folders.map(function (e) { return ns.archive.readDropped(e); })).then(function (lists) {
        return importEntries([].concat.apply([], lists));
      }).then(function () { if (files.length) return importFiles(files); }, failed);
    } else {
      importFiles(files);
    }
  }

  /* ================================================================ commands */

  function activePid() { return hereNow().projectId; }
  function hasProject() { return !!activePid(); }
  function hasMap() { return !!hereNow().mapId; }

  function register() {
    var C = ns.commands;
    var defs = [
      { id: 'sidebar.newProject', label: 'sidebar.cmd.newProject', group: 'project', icon: 'plus', keywords: t('sidebar.kw.newProject'), help: 'sidebar.help.newProject',
        when: editable, run: function () { return newProjectDialog(); } },
      { id: 'sidebar.newMap', label: 'sidebar.cmd.newMap', group: 'map', icon: 'new', keys: ['Mod+Alt+N'], keywords: t('sidebar.kw.newMap'), help: 'sidebar.help.newMap',
        when: editable,
        title: function () { var p = S().project(activePid()); return p ? t('sidebar.newMapIn', { project: p.name }) : t('sidebar.cmd.newMap'); },
        run: function () { return newMap(activePid()); } },
      { id: 'project.rename', label: 'sidebar.cmd.renameProject', group: 'project', icon: 'rename', keywords: t('sidebar.kw.project'), help: 'sidebar.help.renameProject',
        when: function () { return editable() && hasProject(); }, run: function () { return editProject(activePid()); } },
      { id: 'project.duplicate', label: 'sidebar.cmd.duplicateProject', group: 'project', icon: 'copy', keywords: t('sidebar.kw.project'), help: 'sidebar.help.duplicateProject',
        when: function () { return editable() && hasProject(); }, run: function () { return duplicateProject(activePid()); } },
      { id: 'project.template', label: 'sidebar.cmd.templateProject', group: 'project', icon: 'template', keywords: t('sidebar.kw.project'), help: 'sidebar.help.templateProject',
        when: function () { return editable() && hasProject(); },
        checked: function () { var p = S().project(activePid()); return !!(p && p.isTemplate); },
        run: function () { return toggleTemplate(activePid()); } },
      { id: 'project.export', label: 'sidebar.cmd.exportProject', group: 'file', icon: 'export', keywords: t('sidebar.kw.export'), help: 'sidebar.help.exportProject',
        when: hasProject, run: function () { return exportProject(activePid(), 'zip'); } },
      { id: 'project.exportJson', label: 'sidebar.cmd.exportProjectJson', group: 'file', icon: 'download', keywords: t('sidebar.kw.export'), help: 'sidebar.help.exportProjectJson',
        when: hasProject, run: function () { return exportProject(activePid(), 'json'); } },
      { id: 'project.delete', label: 'sidebar.cmd.deleteProject', group: 'project', icon: 'trash', keywords: t('sidebar.kw.project'), help: 'sidebar.help.deleteProject',
        when: function () { return editable() && hasProject(); }, run: function () { return deleteProject(activePid()); } },
      { id: 'map.rename', label: 'sidebar.cmd.renameMap', group: 'map', icon: 'rename', keywords: t('sidebar.kw.map'), help: 'sidebar.help.renameMap',
        when: function () { return editable() && hasMap(); }, run: function () { var w = hereNow(); return renameMap(w.projectId, w.mapId); } },
      { id: 'map.duplicate', label: 'sidebar.cmd.duplicateMap', group: 'map', icon: 'copy', keywords: t('sidebar.kw.map'), help: 'sidebar.help.duplicateMap',
        when: function () { return editable() && hasMap(); }, run: function () { var w = hereNow(); return duplicateMap(w.projectId, w.mapId); } },
      { id: 'map.importBranches', label: 'sidebar.cmd.importBranches', group: 'map', icon: 'child', keywords: t('sidebar.kw.branches'), help: 'sidebar.help.importBranches',
        when: function () {
          if (!editable() || !hasMap()) return false;
          var n = 0;
          S().projects().forEach(function (p) { n += p.maps.length; });
          return n > 1;
        },
        run: function () { return importBranches({}); } },
      { id: 'map.delete', label: 'sidebar.cmd.deleteMap', group: 'map', icon: 'trash', keywords: t('sidebar.kw.map'), help: 'sidebar.help.deleteMap',
        when: function () { return editable() && hasMap(); }, run: function () { var w = hereNow(); return deleteMap(w.projectId, w.mapId); } },
      { id: 'file.import', label: 'sidebar.cmd.import', group: 'file', icon: 'import', keys: ['Mod+O'], keywords: t('sidebar.kw.import'), help: 'sidebar.help.import',
        when: editable, run: function () { return pickImport(); } },
      { id: 'file.importFolder', label: 'sidebar.cmd.importFolder', group: 'file', icon: 'folder', keywords: t('sidebar.kw.import'), help: 'sidebar.help.importFolder',
        when: editable, run: function () { return pickFolder(); } },
      { id: 'file.exportJson', label: 'sidebar.cmd.exportAll', group: 'file', icon: 'download', keywords: t('sidebar.kw.export'), help: 'sidebar.help.exportAll',
        when: function () { return S().projects().length > 0; }, run: function () { return exportAllJson(); } },
      { id: 'sidebar.focus', label: 'sidebar.cmd.focus', group: 'navigate', icon: 'sidebar', help: 'sidebar.help.tree',
        when: function () { return !viewOnly(); }, run: function () { return focus(); } }
    ];
    defs.forEach(function (d) { C.register(d); });
  }

  /* Into the tree, on the row that holds the Tab stop (the drawer opens
   * first on narrow screens). */
  function focus() {
    if (ns.shell && !ns.shell.sidebar.isOpen()) ns.shell.sidebar.open();
    if (stale) freshen();
    var row = focusKey && byKey(focusKey);
    if (row) focusRow(row);
    else if (els.newProject) els.newProject.focus();
    return true;
  }

  /* The shell moves the focus into an opened drawer on the first control
   * it finds, which is the header's + button; the row of the open map is
   * where the person wants to be. This runs a frame after the shell's own
   * move, and only when that move happened. */
  function onDrawer(d) {
    if (!d || !d.open) return;
    /* Built now, before anything looks at it: the shell's focus move comes
     * a frame later. The row with the focus is the open map's, as when the
     * tree is first shown. */
    if (stale) freshen();
    if (!d.drawer) return;
    util.nextFrame().then(function () { return util.nextFrame(); }).then(function () {
      var a = document.activeElement;
      if (!els.root || !a || !els.root.contains(a) || els.tree.contains(a)) return;
      if (a !== els.newProject) return;
      var row = focusKey && byKey(focusKey);
      if (row) focusRow(row);
    });
  }

  /* ================================================================ init */

  function relabel() {
    if (!els.root) return;
    els.title.textContent = t('sidebar.title');
    els.newProject.setAttribute('aria-label', t('sidebar.newProject'));
    ui().tooltip(els.newProject, t('sidebar.newProject'));
    els.io.setAttribute('aria-label', t('sidebar.ioMenu'));
    ui().tooltip(els.io, t('sidebar.ioMenu'));
    els.empty.textContent = t('sidebar.empty');
    els.foot.setAttribute('aria-label', t('sidebar.footer'));
    [[els.copies, 'sidebar.copies'], [els.images, 'sidebar.images'], [els.trash, 'sidebar.trash'], [els.settings, 'sidebar.settings'], [els.help, 'sidebar.help']].forEach(function (pair) {
      pair[0].setAttribute('aria-label', t(pair[1]));
      pair[0].querySelector('.sb-tool__label').textContent = t(pair[1]);
      if (pair[0].classList.contains('sb-tool--icon')) ui().tooltip(pair[0], t(pair[1]));
    });
    build();
  }

  function init() {
    if (inited) return;
    if (!ns.store || !ns.commands) return;
    inited = true;
    register();
    if (!mount()) return;
    ns.bus.on('store', onStoreChange);
    watchShown();
    ns.bus.on('lang', relabel);
    ns.bus.on('commands', function () { schedule(); });
    ns.bus.on('tabs', schedule);
    ns.bus.on('prefs', function (d) { if (d && (d.key === 'mode' || d.key === 'expanded')) schedule(); });
    ns.bus.on('map:opened', schedule);
    ns.bus.on('sidebar', onDrawer);
    ns.bus.on('drop', onDrop);
    ns.bus.on('launch', function (d) { if (d && d.files && d.files.length) importFiles(d.files); });
    build();
  }

  ns.sidebar = {
    init: init,
    render: build,
    focus: focus,
    newProject: newProjectDialog,
    newMap: newMap,
    editProject: editProject,
    deleteProject: deleteProject,
    duplicateProject: duplicateProject,
    toggleTemplate: toggleTemplate,
    renameMap: renameMap,
    duplicateMap: duplicateMap,
    deleteMap: deleteMap,
    exportProject: exportProject,
    exportAllJson: exportAllJson,
    importBranches: importBranches,
    importFiles: importFiles,
    importEntries: importEntries,
    pickImport: pickImport,
    pickFolder: pickFolder,
    projectMenu: function projectMenu(pid, anchor) { return rowMenu({ kind: 'project', pid: pid }, anchor); },
    mapMenu: function mapMenu(pid, mid, anchor) { return rowMenu({ kind: 'map', pid: pid, mid: mid }, anchor); },
    ioMenu: ioMenu,
    isExpanded: isExpanded,
    setExpanded: setExpanded
  };
})(window.MindRoot);
