/* MindRoot - editing on the map: the keys, the inline rename, the node
 * toolbar and the format bar, drag and drop to reparent, the context menu,
 * and what a tap on a task box, a link or a picture does.
 *
 * Nothing here writes a map's text by itself. Every change is a doc edit
 * (ns.doc) handed to ns.session.apply(), which makes it one labelled undo
 * step, re-parses, redraws and selects where the edit says. A change made of
 * two edits (a rename and the format pressed while renaming, a branch and the
 * trash entry it goes to) is one store transaction, so it is one step too.
 *
 * The rename happens where the node is drawn: two plain-text fields, the
 * title and the words under it, written into the node box the view drew
 * (view.nodeEl). They hold plain strings - the same characters the file
 * holds, marks included - so a caret or a choice counted in characters means
 * the same thing in the field, in the format bar and in the file. The
 * browser is never allowed to write markup into them: Enter, paste, drop and
 * its own Bold/Italic/Underline are all steered here. Pictures in the node
 * stay where they are and are never typed over. When the rename ends the
 * box is put back as it was and the view rebuilds it from the tree
 * (view.invalidate) on the next render.
 *
 * The node toolbar is a glass capsule above the selected node (below it when
 * there is no room above, or when below covers less of the other nodes;
 * never over its words, nor under the capsules floating over the stage).
 * It never covers another node: when no place near the node is free (a
 * dense map seen whole) it docks, centred, to the stage edge nearer the
 * node, like a contextual bar clear of the floating chrome, and the node's
 * selection halo says whose bar it is ([data-docked]). It steps aside
 * while the map moves under the hand and comes back where the node lands. On compact widths there is none: a finger would cover whatever
 * sits next to the node, so the thumb bar carries the node's actions (the
 * shell fills it from the node.* commands registered here).
 *
 * Sides: on a root (the map's one root, or each top node of a map with
 * several) the toolbar, the context menu and the phone's thumb bar offer a
 * branch on the left and one on the right (Tab, Alt+Shift+Right: the right;
 * Alt+Shift+Left: the left). The side is the branch's marker in the file
 * (ns.doc); what grows under a branch, or beside it, grows on its side. A
 * first-level branch moves across with 'Move to the left / right side' or
 * a drop onto the other half of its root; Alt+Up / Alt+Down swap it with
 * its neighbour on its own side; an edit that makes a node a first-level
 * branch gives it a side, one that takes it deeper takes its marker off.
 *
 * Keys are commands (ns.commands), so the palette, the help sheet, the
 * tooltips and the thumb bar all read the same list. A key only acts on the
 * map when the focus is on the map: Enter on a focused button presses that
 * button, Delete in the sidebar deletes a map, not a node. Motion never
 * follows the keyboard: a selection moved by arrow keys jumps.
 *
 *   init()                                  wires the view, builds the bars,
 *                                           registers the node.* and navigate.* commands
 *   startRename(path, {selectAll, field: 'line'|'body', start, end}) -> bool
 *   finishRename(save, {focus}) -> bool     commit (true) or cancel (false)
 *   cancelRename(), isRenaming(), renaming() -> {path, field} | null
 *   suspendWriting() -> mark, resumeWriting(mark)   around a file dialog
 *   applyMark('bold'|'italic'|'underline'|'strike'|'clear') -> bool
 *   add(kind, path?) -> bool                'child' | 'sibling' | 'before' | 'root',
 *                                           on a root 'right' | 'left'
 *   moveSide(path, 'left'|'right') -> bool  a first-level branch to that side
 *   remove(path) -> bool                    the branch to the trash
 *   moveBranch(path, target, where, side?) -> bool   drag and drop's edit
 *   paint(path, hex|null, {key}) -> bool    a colour picked, or the palette's
 *   openColor(anchor, path) -> bool         the picker for that node
 *   toggleTask(path), setTask(path, on), openLink(href, 'url'|'map')
 *   foldAll(), unfoldAll(), placeBars()
 *   toggleStrike(text, start, end), readField(el)   pure, for the unit suite
 *   toolbar, formatBar                      the two elements (after init)
 * Bus out: 'editor:rename' {path, state: 'start'|'end', saved}. Heard:
 * selection, doc:changed, map:opened/closed, flush and tabs:yield (what is
 * typed is written), layout, prefs (view-only), tabs, commands, notes, lang. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var STRINGS = {
    en: {
      'editor.newNode': 'New node',
      'editor.toolbar': 'Node',
      'editor.formatBar': 'Format',
      'editor.bodyPlaceholder': 'Text',
      'editor.titlePlaceholder': 'Title',
      'editor.label.addChild': 'add a child',
      'editor.label.addSibling': 'add a sibling',
      'editor.label.addRoot': 'add a root',
      'editor.label.addRight': 'add a branch on the right',
      'editor.label.addLeft': 'add a branch on the left',
      'editor.label.sideLeft': 'move to the left side',
      'editor.label.sideRight': 'move to the right side',
      'editor.label.rename': 'rename',
      'editor.label.format': 'format the node',
      'editor.label.color': 'change the colour',
      'editor.label.indent': 'move down a level',
      'editor.label.outdent': 'move up a level',
      'editor.label.moveUp': 'move up',
      'editor.label.moveDown': 'move down',
      'editor.label.move': 'move the branch',
      'editor.label.place': 'move the branch on the map',
      'editor.label.tidy': 'put the branch back in order',
      'editor.label.tidyMap': 'put the map back in order',
      'editor.label.detach': 'detach the branch',
      'editor.label.attach': 'attach the branch',
      'editor.cmd.tidy': 'Put the branch back in order',
      'editor.cmd.tidyMap': 'Tidy up the map',
      'editor.cmd.detach': 'Detach',
      'editor.cmd.attach': 'Attach to\u2026',
      'editor.help.tidy': 'A node dragged onto the map stays where it was let go, still on its parent, and its branch goes with it. This puts it (or every node of the map) back where the map lays it out.',
      'editor.help.detach': 'Detach: the branch becomes a root of its own, where it stands. Attach to: then choose the node it should hang from (or hold a dragged node still over that node).',
      'editor.attachPick': 'Choose the node to attach it to. Esc cancels.',
      'editor.label.task': 'tick the to-do',
      'editor.label.untask': 'untick the to-do',
      'editor.label.taskOn': 'make it a to-do',
      'editor.label.taskOff': 'stop being a to-do',
      'editor.label.drawingOut': 'take the drawing out',
      'editor.cmd.addChild': 'Add a child',
      'editor.cmd.addSibling': 'Add a sibling',
      'editor.cmd.addRoot': 'Add a root',
      'editor.cmd.addSiblingBefore': 'Add a sibling before',
      'editor.cmd.addRight': 'Add a branch on the right',
      'editor.cmd.addLeft': 'Add a branch on the left',
      'editor.cmd.sideLeft': 'Move to the left side',
      'editor.cmd.sideRight': 'Move to the right side',
      'editor.cmd.rename': 'Rename',
      'editor.cmd.delete': 'Delete the branch',
      'editor.cmd.removeDrawing': 'Remove the drawing',
      'editor.cmd.removeDrawingNamed': 'Remove the drawing {name}',
      'editor.cmd.removePicture': 'Remove the picture',
      'editor.cmd.removePictureNamed': 'Remove the picture {name}',
      'editor.cmd.deleteNote': 'Delete the note',
      'editor.cmd.deleteEdgeNote': 'Delete the note on the link',
      'editor.cmd.indent': 'Move down a level',
      'editor.cmd.outdent': 'Move up a level',
      'editor.cmd.moveUp': 'Move up',
      'editor.cmd.moveDown': 'Move down',
      'editor.cmd.fold': 'Fold or unfold',
      'editor.cmd.foldIt': 'Fold the branch',
      'editor.cmd.unfoldIt': 'Unfold the branch',
      'editor.cmd.foldAll': 'Fold everything',
      'editor.cmd.unfoldAll': 'Unfold everything',
      'editor.cmd.color': 'Colour',
      'editor.cmd.dice': 'Random colour for new nodes',
      'editor.cmd.note': 'Note on the node',
      'editor.cmd.edgeNote': 'Note on the link that arrives here',
      'editor.cmd.task': 'To-do',
      'editor.cmd.taskOn': 'Make it a to-do',
      'editor.cmd.taskOff': 'Stop being a to-do',
      'editor.cmd.openLink': 'Open the link',
      'editor.cmd.openLinkTo': 'Open {text}',
      'editor.cmd.copyBranch': 'Copy the branch to a map',
      'editor.cmd.toMap': 'Turn the branch into a map',
      'editor.cmd.splitMap': 'Split the branches into maps',
      'editor.cmd.deselect': 'Deselect',
      'editor.help.deselect': 'Lets go of the node. With no node chosen, Tab and Shift+Tab move out of the map (with a node chosen they add a child and move it up a level).',
      'editor.cmd.menu': 'Node actions',
      'editor.cmd.up': 'Go up',
      'editor.cmd.down': 'Go down',
      'editor.cmd.left': 'Go left',
      'editor.cmd.right': 'Go right',
      'editor.cmd.first': 'First sibling',
      'editor.cmd.last': 'Last sibling',
      'editor.cmd.more': 'More',
      'editor.moveHint': 'Pull this grip to move the branch anywhere; it stays attached. Hold it still over a node to hang it there.',
      'editor.alreadyTidy': 'Everything is already where the layout puts it.',
      'editor.label.tag': 'give the node a name',
      'editor.label.mention': 'mention',
      'editor.noNode': 'That node is no longer there.',
      'editor.wireInHint': 'Pull this thread off its parent: let go on a node to plug the branch into it, or in the open to detach it.',
      'editor.wireOutHint': 'Pull a thread out to another node to take it in as a branch of this one.',
      'editor.help.addChild': 'Adds a node under the selected one and opens it for typing.',
      'editor.help.addSibling': 'Adds a node after the selected one; on the map\'s one root, a child; with nothing selected, a new root.',
      'editor.help.addSiblingBefore': 'Adds a node before the selected one.',
      'editor.help.addSide': 'On the central node: adds a branch on that side of it and opens it for typing. Tab adds one on the right. Whatever grows under a branch stays on its side.',
      'editor.help.side': 'Takes a branch that starts at the central node, with everything under it, to the other side. You can also drag it onto that half of the central node, or beside a branch already there.',
      'editor.help.rename': 'Writes the node where it is drawn (typing a letter on a selected node starts it, over the old name). In the title Enter saves; in the text under it Enter breaks the line and goes on with a list (start a line with - , 1. or - [ ] ), Tab and Shift+Tab nest a list item; Ctrl+Enter (Cmd+Enter on a Mac) saves from either. Tab saves and adds a child, Esc cancels, Alt+F10 goes to the format bar. A double tap on a node does the same.',
      'editor.help.delete': 'Deletes the node and everything under it. The branch goes to the trash, and Undo brings it back. With a picture of the node picked (clicked, a ring round it) the key takes out that picture only.',
      'editor.help.indent': 'Makes the node a child of the one above it.',
      'editor.help.outdent': 'Moves the node out beside its parent.',
      'editor.help.move': 'Swaps the node with its neighbour. You can also drag a node onto another one, or between two.',
      'editor.help.fold': 'Hides or shows what hangs under the node. Ctrl+click on a knob folds the whole branch.',
      'editor.help.color': 'Chooses the colour of the node. Its existing children keep theirs.',
      'editor.help.dice': 'Gives every node you make from now on a colour of its own, drawn at random.',
      'editor.help.note': 'A private note on the node, written in the Markdown as a quote.',
      'editor.help.edgeNote': 'A note on the link that arrives at the node.',
      'editor.help.task': 'Puts a check box on the node, or takes it off. Tap the box on the map to tick it.',
      'editor.help.openLink': 'Opens the link the node carries. A link to [[another map]] opens that map.',
      'editor.help.copyBranch': 'Copies the node and everything under it into another map.',
      'editor.help.toMap': 'Moves the node and everything under it into a new map of the project; here it stays as a link to that map, and the new map links back.',
      'editor.help.splitMap': 'Turns every branch of the central node into a map of its own in the project, each linked from here and linking back.',
      'editor.help.navigate': 'The arrows move between the nodes you can see: up and down among siblings, left to the parent, right to the first child.',
      'editor.help.menu': 'Everything you can do to the selected node.',
      'editor.kw.addChild': 'new node child add insert',
      'editor.kw.addSibling': 'new node sibling add root',
      'editor.kw.side': 'side left right branch central root add move',
      'editor.kw.rename': 'rename edit write title text',
      'editor.kw.delete': 'delete remove branch trash',
      'editor.kw.move': 'move reorder indent outdent',
      'editor.kw.fold': 'fold collapse expand hide show',
      'editor.kw.color': 'colour color paint palette',
      'editor.kw.dice': 'dice random colour color',
      'editor.kw.note': 'note comment annotation',
      'editor.kw.task': 'task todo check box',
      'editor.kw.link': 'link url web open map',
      'editor.kw.copy': 'copy branch map import',
      'editor.kw.toMap': 'split extract branch new map link project',
      'editor.fmt.size': 'Size',
      'editor.fmt.sizeIs': 'Size: {size}',
      'editor.fmt.normal': 'Normal',
      'editor.fmt.h': 'Heading {n}',
      'editor.fmt.caption': 'Caption',
      'editor.fmt.role': 'Style of the text',
      'editor.fmt.roleIs': 'Text style: {role}',
      'editor.fmt.paragraph': 'Paragraph',
      'editor.fmt.title': 'Title',
      'editor.fmt.subtitle': 'Subtitle',
      'editor.fmt.bold': 'Bold',
      'editor.fmt.italic': 'Italic',
      'editor.fmt.underline': 'Underline',
      'editor.fmt.strike': 'Strikethrough',
      'editor.fmt.clear': 'Clear the marks',
      'editor.fmt.picture': 'Pictures',
      'editor.fmt.addPicture': 'Add a picture',
      'editor.fmt.draw': 'Draw',
      'editor.fmt.pictureLeft': 'Picture on the left',
      'editor.fmt.pictureRight': 'Picture on the right',
      'editor.fmt.pictureAbove': 'Picture above',
      'editor.fmt.drawingLeft': 'Drawing on the left',
      'editor.fmt.drawingRight': 'Drawing on the right',
      'editor.fmt.drawingAbove': 'Drawing above',
      'editor.fmt.pictureOut': 'Take the picture out',
      'editor.fmt.drawingOut': 'Take the drawing out',
      'editor.fmt.done': 'Done',
      'editor.fmt.listBullet': 'Bulleted list',
      'editor.fmt.listNumber': 'Numbered list',
      'editor.fmt.listCheck': 'Checklist',
      'editor.fmt.hide': 'Hide the bar',
      'editor.deleted': 'Branch deleted: {label}',
      'editor.rootStays': 'The central node stays: delete its branches one by one, or start a new map.',
      'editor.copied': 'Copied to {map}',
      'editor.madeMaps.one': 'New map: {map}',
      'editor.madeMaps.other': '{n} new maps in the project',
      'editor.splitNothing': 'The central node has no branches to turn into maps.',
      'editor.copiedMd': 'Copied as Markdown: {label}',
      'editor.label.paste': 'paste',
      'editor.copyOpen': 'Open',
      'editor.copyNothing': 'There is no other map to copy the branch to.',
      'editor.copyTitle': 'Copy the branch to',
      'editor.noMap': 'There is no map called {name} in this project.',
      'editor.makeMap': 'Make it',
      'editor.badLink': 'This link cannot be opened.',
      'editor.links': 'Links',
      'editor.refused': 'The node cannot go there.',
      'editor.nothingThere': 'Nothing changed: the map is not written that way.'
    },
    it: {
      'editor.newNode': 'Nuovo nodo',
      'editor.toolbar': 'Nodo',
      'editor.formatBar': 'Formato',
      'editor.bodyPlaceholder': 'Testo',
      'editor.titlePlaceholder': 'Titolo',
      'editor.label.addChild': 'aggiungi un figlio',
      'editor.label.addSibling': 'aggiungi un fratello',
      'editor.label.addRoot': 'aggiungi una radice',
      'editor.label.addRight': 'aggiungi un ramo a destra',
      'editor.label.addLeft': 'aggiungi un ramo a sinistra',
      'editor.label.sideLeft': 'sposta sul lato sinistro',
      'editor.label.sideRight': 'sposta sul lato destro',
      'editor.label.rename': 'rinomina',
      'editor.label.format': 'formatta il nodo',
      'editor.label.color': 'cambia il colore',
      'editor.label.indent': 'scendi di un livello',
      'editor.label.outdent': 'sali di un livello',
      'editor.label.moveUp': 'sposta su',
      'editor.label.moveDown': 'sposta giù',
      'editor.label.move': 'sposta il ramo',
      'editor.label.place': 'sposta il ramo sulla mappa',
      'editor.label.tidy': 'rimetti in ordine il ramo',
      'editor.label.tidyMap': 'rimetti in ordine la mappa',
      'editor.label.detach': 'scollega il ramo',
      'editor.label.attach': 'collega il ramo',
      'editor.cmd.tidy': 'Rimetti in ordine il ramo',
      'editor.cmd.tidyMap': 'Riordina la mappa',
      'editor.cmd.detach': 'Scollega',
      'editor.cmd.attach': 'Collega a\u2026',
      'editor.help.tidy': 'Un nodo trascinato sulla mappa resta dove lo lasci, sempre attaccato al suo genitore, e il suo ramo lo segue. Questo lo rimette (o rimette ogni nodo della mappa) dove la mappa lo dispone da sola.',
      'editor.help.detach': 'Scollega: il ramo diventa una radice a sé, dove si trova. Collega a: poi scegli il nodo a cui attaccarlo (oppure tieni fermo un nodo trascinato sopra quel nodo).',
      'editor.attachPick': 'Scegli il nodo a cui attaccarlo. Esc annulla.',
      'editor.label.task': 'spunta il compito',
      'editor.label.untask': 'togli la spunta',
      'editor.label.taskOn': 'rendi un compito',
      'editor.label.taskOff': 'togli il compito',
      'editor.label.drawingOut': 'togli il disegno',
      'editor.cmd.addChild': 'Aggiungi un figlio',
      'editor.cmd.addSibling': 'Aggiungi un fratello',
      'editor.cmd.addRoot': 'Aggiungi una radice',
      'editor.cmd.addSiblingBefore': 'Aggiungi un fratello prima',
      'editor.cmd.addRight': 'Aggiungi un ramo a destra',
      'editor.cmd.addLeft': 'Aggiungi un ramo a sinistra',
      'editor.cmd.sideLeft': 'Sposta sul lato sinistro',
      'editor.cmd.sideRight': 'Sposta sul lato destro',
      'editor.cmd.rename': 'Rinomina',
      'editor.cmd.delete': 'Elimina il ramo',
      'editor.cmd.removeDrawing': 'Rimuovi disegno',
      'editor.cmd.removeDrawingNamed': 'Rimuovi disegno {name}',
      'editor.cmd.removePicture': 'Rimuovi immagine',
      'editor.cmd.removePictureNamed': 'Rimuovi immagine {name}',
      'editor.cmd.deleteNote': 'Elimina nota',
      'editor.cmd.deleteEdgeNote': "Elimina nota sull'arco",
      'editor.cmd.indent': 'Scendi di un livello',
      'editor.cmd.outdent': 'Sali di un livello',
      'editor.cmd.moveUp': 'Sposta su',
      'editor.cmd.moveDown': 'Sposta giù',
      'editor.cmd.fold': 'Piega o apri',
      'editor.cmd.foldIt': 'Piega il ramo',
      'editor.cmd.unfoldIt': 'Apri il ramo',
      'editor.cmd.foldAll': 'Piega tutto',
      'editor.cmd.unfoldAll': 'Apri tutto',
      'editor.cmd.color': 'Colore',
      'editor.cmd.dice': 'Colore a caso per i nuovi nodi',
      'editor.cmd.note': 'Nota sul nodo',
      'editor.cmd.edgeNote': 'Nota sul collegamento che arriva qui',
      'editor.cmd.task': 'Compito',
      'editor.cmd.taskOn': 'Trasforma in compito',
      'editor.cmd.taskOff': 'Togli il compito',
      'editor.cmd.openLink': 'Apri il link',
      'editor.cmd.openLinkTo': 'Apri {text}',
      'editor.cmd.copyBranch': 'Copia il ramo in una mappa',
      'editor.cmd.toMap': 'Trasforma il ramo in una mappa',
      'editor.cmd.splitMap': 'Dividi i rami in mappe',
      'editor.cmd.deselect': 'Deseleziona',
      'editor.help.deselect': 'Lascia il nodo. Senza un nodo scelto, Tab e Maiusc+Tab escono dalla mappa (con un nodo scelto aggiungono un figlio e lo spostano su di un livello).',
      'editor.cmd.menu': 'Azioni sul nodo',
      'editor.cmd.up': 'Vai su',
      'editor.cmd.down': 'Vai giù',
      'editor.cmd.left': 'Vai a sinistra',
      'editor.cmd.right': 'Vai a destra',
      'editor.cmd.first': 'Primo fratello',
      'editor.cmd.last': 'Ultimo fratello',
      'editor.cmd.more': 'Altro',
      'editor.moveHint': 'Tira questa maniglia per spostare il ramo dove vuoi: resta attaccato. Fermati sopra un nodo per attaccarlo lì.',
      'editor.alreadyTidy': 'È già tutto dove lo mette il layout.',
      'editor.label.tag': 'dai un nome al nodo',
      'editor.label.mention': 'menzione',
      'editor.noNode': 'Quel nodo non c\'è più.',
      'editor.wireInHint': 'Tira questo filo per staccarlo dal genitore: rilascialo su un nodo per collegarvi il ramo, o nel vuoto per scollegarlo.',
      'editor.wireOutHint': 'Tira un filo fino a un altro nodo per prenderlo come ramo di questo.',
      'editor.help.addChild': 'Aggiunge un nodo sotto quello scelto e lo apre per scrivere.',
      'editor.help.addSibling': 'Aggiunge un nodo dopo quello scelto; sulla sola radice della mappa, un figlio; senza nessuno scelto, una nuova radice.',
      'editor.help.addSiblingBefore': 'Aggiunge un nodo prima di quello scelto.',
      'editor.help.addSide': 'Sul nodo centrale: aggiunge un ramo da quel lato e lo apre per scrivere. Tab ne aggiunge uno a destra. Quello che cresce sotto un ramo resta dal suo lato.',
      'editor.help.side': "Porta un ramo che parte dal nodo centrale, con tutto quello che ha sotto, dall'altro lato. Puoi anche trascinarlo su quella metà del nodo centrale, o accanto a un ramo che è già lì.",
      'editor.help.rename': 'Scrive il nodo dove è disegnato (una lettera digitata su un nodo scelto lo apre, al posto del vecchio nome). Nel titolo Invio salva; nel testo sotto Invio va a capo e continua un elenco (una riga che inizia con - , 1. o - [ ] ), Tab e Maiusc+Tab spostano una voce di livello; Ctrl+Invio (Cmd+Invio su Mac) salva da entrambi. Tab salva e aggiunge un figlio, Esc annulla, Alt+F10 porta alla barra di formato. Anche un doppio tocco sul nodo.',
      'editor.help.delete': "Elimina il nodo e tutto quello che ha sotto. Il ramo va nel cestino, e Annulla lo riporta. Con un'immagine del nodo scelta (cliccata, con un anello attorno) il tasto toglie solo quell'immagine.",
      'editor.help.indent': 'Fa del nodo un figlio di quello sopra.',
      'editor.help.outdent': 'Porta il nodo fuori, accanto al suo genitore.',
      'editor.help.move': 'Scambia il nodo con il vicino. Puoi anche trascinare un nodo su un altro, o fra due.',
      'editor.help.fold': 'Nasconde o mostra quello che sta sotto il nodo. Ctrl+clic su un pomello piega tutto il ramo.',
      'editor.help.color': 'Sceglie il colore del nodo. I figli che ha già tengono il loro.',
      'editor.help.dice': 'Dà a ogni nodo che fai da ora in poi un colore suo, tirato a caso.',
      'editor.help.note': 'Una nota privata sul nodo, scritta nel Markdown come citazione.',
      'editor.help.edgeNote': 'Una nota sul collegamento che arriva al nodo.',
      'editor.help.task': 'Mette una casella sul nodo, o la toglie. Tocca la casella sulla mappa per spuntarla.',
      'editor.help.openLink': 'Apre il link del nodo. Un link a [[un\'altra mappa]] apre quella mappa.',
      'editor.help.copyBranch': 'Copia il nodo e tutto quello che ha sotto in un\'altra mappa.',
      'editor.help.toMap': 'Sposta il nodo e tutto quello che ha sotto in una nuova mappa del progetto; qui resta un link a quella mappa, e la nuova mappa rimanda qui.',
      'editor.help.splitMap': 'Trasforma ogni ramo del nodo centrale in una mappa a sé nel progetto, ciascuna collegata da qui e con un link di ritorno.',
      'editor.help.navigate': 'Le frecce si spostano fra i nodi che vedi: su e giù fra i fratelli, a sinistra al genitore, a destra al primo figlio.',
      'editor.help.menu': 'Tutto quello che puoi fare al nodo scelto.',
      'editor.kw.addChild': 'new node child add insert nuovo nodo figlio aggiungi',
      'editor.kw.addSibling': 'new node sibling add root nuovo nodo fratello aggiungi radice',
      'editor.kw.side': 'side left right branch central root add move lato sinistra destra ramo centrale radice aggiungi sposta',
      'editor.kw.rename': 'rename edit write title text rinomina modifica scrivi titolo testo',
      'editor.kw.delete': 'delete remove branch trash elimina cancella ramo cestino',
      'editor.kw.move': 'move reorder indent outdent sposta riordina livello',
      'editor.kw.fold': 'fold collapse expand hide show piega comprimi espandi nascondi',
      'editor.kw.color': 'colour color paint palette colore tinta tavolozza',
      'editor.kw.dice': 'dice random colour color dado caso colore',
      'editor.kw.note': 'note comment annotation nota commento',
      'editor.kw.task': 'task todo check box compito spunta casella',
      'editor.kw.link': 'link url web open map collegamento apri mappa',
      'editor.kw.copy': 'copy branch map import copia ramo mappa',
      'editor.kw.toMap': 'split extract branch new map link project dividi estrai ramo nuova mappa progetto',
      'editor.fmt.size': 'Misura',
      'editor.fmt.sizeIs': 'Misura: {size}',
      'editor.fmt.normal': 'Normale',
      'editor.fmt.h': 'Titolo {n}',
      'editor.fmt.caption': 'Didascalia',
      'editor.fmt.role': 'Stile del testo',
      'editor.fmt.roleIs': 'Stile del testo: {role}',
      'editor.fmt.paragraph': 'Paragrafo',
      'editor.fmt.title': 'Titolo',
      'editor.fmt.subtitle': 'Sottotitolo',
      'editor.fmt.bold': 'Grassetto',
      'editor.fmt.italic': 'Corsivo',
      'editor.fmt.underline': 'Sottolineato',
      'editor.fmt.strike': 'Barrato',
      'editor.fmt.clear': 'Togli i segni',
      'editor.fmt.picture': 'Immagini',
      'editor.fmt.addPicture': 'Aggiungi un\'immagine',
      'editor.fmt.draw': 'Disegna',
      'editor.fmt.pictureLeft': 'Immagine a sinistra',
      'editor.fmt.pictureRight': 'Immagine a destra',
      'editor.fmt.pictureAbove': 'Immagine sopra',
      'editor.fmt.drawingLeft': 'Disegno a sinistra',
      'editor.fmt.drawingRight': 'Disegno a destra',
      'editor.fmt.drawingAbove': 'Disegno sopra',
      'editor.fmt.pictureOut': 'Togli l\'immagine',
      'editor.fmt.drawingOut': 'Togli il disegno',
      'editor.fmt.done': 'Fatto',
      'editor.fmt.listBullet': 'Elenco puntato',
      'editor.fmt.listNumber': 'Elenco numerato',
      'editor.fmt.listCheck': 'Elenco di cose da fare',
      'editor.fmt.hide': 'Nascondi la barra',
      'editor.deleted': 'Ramo eliminato: {label}',
      'editor.rootStays': 'Il nodo centrale resta: elimina i suoi rami uno alla volta, oppure crea una nuova mappa.',
      'editor.copied': 'Copiato in {map}',
      'editor.madeMaps.one': 'Nuova mappa: {map}',
      'editor.madeMaps.other': '{n} nuove mappe nel progetto',
      'editor.splitNothing': 'Il nodo centrale non ha rami da trasformare in mappe.',
      'editor.copiedMd': 'Copiato come Markdown: {label}',
      'editor.label.paste': 'incolla',
      'editor.copyOpen': 'Apri',
      'editor.copyNothing': 'Non c\'è un\'altra mappa in cui copiare il ramo.',
      'editor.copyTitle': 'Copia il ramo in',
      'editor.noMap': 'In questo progetto non c\'è una mappa che si chiama {name}.',
      'editor.makeMap': 'Creala',
      'editor.badLink': 'Questo link non si può aprire.',
      'editor.links': 'Link',
      'editor.refused': 'Il nodo non può andare lì.',
      'editor.nothingThere': 'Niente è cambiato: la mappa non è scritta in quel modo.'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    return String(STRINGS.en[key] || key).replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] != null ? String(vars[name]) : all;
    });
  }

  /* ---------------------------------------------------------------- state */

  var view = null;
  var stage = null;
  var floaters = null;
  var toolbar = null;
  var formatBar = null;
  var tb = {};               // toolbar buttons by name
  var fb = {};               // format bar buttons by name
  var renaming = null;       // the rename in progress (see startRename)
  var gesture = 'idle';      // the view's gesture state: bars hide while it is not idle
  var lastInput = 'pointer'; // 'key' while the keyboard drives: nothing animates then
  var dragging = null;       // { path, ghost, popEsc }
  var contextHandle = null;  // the context menu a long press opened
  var formatHidden = false;  // the format bar sent away by its own button, until words are chosen
  var toolbarShownFor = null;
  var toolbarDirty = true;   // the buttons' states need asking again (selection, text, commands changed)
  var ready = false;

  function S() { return ns.session; }
  function D() { return ns.doc; }
  function store() { return ns.store; }
  function cur() { return S() ? S().current() : null; }
  function selected() { return S() ? S().selected() : null; }
  function readOnly() { return !S() || S().readOnly(); }
  function editable() { return !!cur() && !readOnly(); }
  function h() { return ns.util.h.apply(null, arguments); }
  function emit(type, detail) { if (ns.bus) ns.bus.emit(type, detail); }

  function entryOf(path) {
    var c = cur();
    if (!c || path === null || path === undefined) return null;
    return c.state.byPath[path] || null;
  }

  function hasSel() { return entryOf(selected()) !== null; }

  /* The one root a map grows from. Enter on it grows the map (a child): a
   * second root would be a separate tree with nothing joining it to the
   * first. (A map that already has several roots adds another; with
   * nothing chosen, Enter and the empty map's menu still add a root.) */
  function loneRoot(path) {
    var c = cur();
    return path === '' && !!c && !!c.state.root && !c.state.root.synthetic && entryOf(path) !== null;
  }

  /* A node no other node hangs from: the map's one root, or each top node
   * of a map with several. Its branches grow on two sides of it, each where
   * the person put it (a side marker on the branch's line, ns.doc). */
  function treeRoot(path) {
    var e = entryOf(path);
    return !!e && e.parentIndex < 0;
  }

  /* A branch that starts at a tree root: the node whose side it is. */
  function firstLevel(path) {
    var c = cur();
    return !!c && entryOf(path) !== null && D().isFirstLevel(c.state, path);
  }

  /* 'left' or 'right' for a node under a tree root, null for a tree root. */
  function sideOf(path) {
    var c = cur();
    return c && entryOf(path) !== null ? D().sideAt(c.state, path) : null;
  }

  function compact() {
    if (ns.ui && typeof ns.ui.isCompact === 'function') return ns.ui.isCompact();
    return window.innerWidth < 640;
  }

  function prefGet(key, fallback) {
    try {
      var v = ns.prefs ? ns.prefs.get(key) : undefined;
      return v === undefined || v === null ? fallback : v;
    } catch (err) { return fallback; }
  }

  /* A length the stylesheet owns (editor.css), in px, read where it is used.
   * A custom property comes back as it was written ('0.5rem', a calc()), not
   * in px, so anything but a px value is resolved by a probe that takes it
   * as its width - inside the element, so an em counts that element's type. */
  var probe = null;
  /* What a probe answered, by the value as written and the type sizes it
   * can depend on: the bars ask on every key typed, and a probe makes the
   * browser lay the whole page out again (thousands of nodes on a big map). */
  var probed = new Map();
  function cssPx(el, name, fallback) {
    try {
      var host = el && el.isConnected ? el : document.body;
      var style = getComputedStyle(host);
      var raw = style.getPropertyValue(name).trim();
      if (!raw) return fallback;
      if (/^-?(\d+\.?\d*|\.\d+)px$/.test(raw)) return parseFloat(raw);
      var key = raw + '|' + style.fontSize + '|' + getComputedStyle(document.documentElement).fontSize;
      if (/%|v[whib]|vmin|vmax|cq/.test(raw)) key = null;
      if (key !== null && probed.has(key)) return probed.get(key);
      if (!probe) {
        probe = document.createElement('span');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;' +
          'display:block;height:0;padding:0;border:0;margin:0;min-width:0;max-width:none';
      }
      probe.style.width = raw;
      host.appendChild(probe);
      var v = parseFloat(getComputedStyle(probe).width);
      host.removeChild(probe);
      if (!isFinite(v)) return fallback;
      if (key !== null) {
        if (probed.size > 64) probed.clear();
        probed.set(key, v);
      }
      return v;
    } catch (err) {
      if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
      return fallback;
    }
  }

  function reduced() { return !!(ns.util && ns.util.reducedMotion && ns.util.reducedMotion()); }

  /* ---------------------------------------------------------------- keys belong to the map only from the map */

  var REGIONS = '#sidebar, #source, #layers, dialog, [role="dialog"], [role="menu"], .note-bubble, .colorpicker';
  var CONTROLS = 'button, a[href], input, select, textarea, summary, [contenteditable], [role="button"], [role="tab"], ' +
    '[role="menuitem"], [role="option"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="spinbutton"]';

  /* A key reaches the map only when the focus is on the map (or nowhere in
   * particular). controlKey: Enter, Space, Tab and the arrows also mean
   * something to a focused control, which keeps them. */
  function panelOpen() {
    if (renaming) return true;
    if (ns.notes && typeof ns.notes.isOpen === 'function' && ns.notes.isOpen()) return true;
    return !!(ns.colorpicker && typeof ns.colorpicker.isOpen === 'function' && ns.colorpicker.isOpen());
  }

  function keyAllowed(ctx, controlKey) {
    if (!ctx || ctx.source !== 'key') return true;
    var el = ctx.target;
    if (!el || el.nodeType !== 1) return true;
    /* Keys with the focus on the page itself act on the map (a keyboard
     * used before anything was clicked) - but not while a panel over the
     * map is open (a note, the colour picker, a node being written): the
     * focus fell out of it, and a key meant there must not edit the map. */
    if (el === document.body || el === document.documentElement) return !panelOpen();
    if (!el.closest) return true;
    if (el.closest(REGIONS)) return false;
    if (view && view.el && (el === view.el || view.el.contains(el)) && !el.closest('[contenteditable]')) return true;
    if (controlKey && el.closest(CONTROLS)) return false;
    return true;
  }

  /* ---------------------------------------------------------------- applying edits */

  /* One edit, one step. A null edit is nothing done (no step); a refused
   * one is said once, quietly. */
  function apply(result, label, opts) {
    if (!result) return false;
    opts = opts || {};
    var o = { label: label, origin: 'editor' };
    if (opts.select !== undefined) o.select = opts.select;
    if (opts.key) o.key = opts.key;
    if (opts.join) o.join = opts.join;
    /* An edit made from the keyboard lands at once: no motion on a path
     * walked a hundred times a day. */
    o.animate = opts.animate !== undefined ? opts.animate : lastInput !== 'key';
    return S().apply(result, o);
  }

  function transaction(label, fn, where) {
    var st = store();
    if (st && typeof st.transaction === 'function') return st.transaction(label, fn, where);
    return fn();
  }

  function parentOf(path) {
    if (path === null || path === undefined || path === '') return null;
    var i = path.lastIndexOf('.');
    return i < 0 ? '' : path.slice(0, i);
  }

  /* The edge note needs a link to sit on: a parent that is drawn. */
  function hasIncomingEdge(path) {
    var c = cur();
    if (!c || path === null || path === undefined) return false;
    var p = parentOf(path);
    return p !== null && !!c.state.byPath[p];
  }

  /* ---------------------------------------------------------------- the colour a new node is born with */

  /* Worked out on the text the edit produced: until the line exists the node
   * has no path. The dice gives every new node a colour of its own, written
   * as the branch's so what grows under it later comes out the same; without
   * it a node that opens a branch (a root or a child of one) takes the
   * palette's colour for that branch, and a deeper one the colour of the node
   * it was made from - a marker written only where it would otherwise come
   * out different. */
  function bornColor(result, source) {
    if (!result || result.anchorLine === undefined || result.anchorLine === null) return result;
    var Dc = D();
    var next = Dc.parse(result.text);
    var e = Dc.findByLine(next, result.anchorLine);
    if (!e || e.color) return result;
    if (prefGet('diceColors', false) && ns.colors && ns.colors.randomColor) {
      var hex = ns.colors.randomColor();
      return carry(result, Dc.setColor(next, e.path, hex, { branch: true }));
    }
    if (!source || e.branch === e.path) return result;
    if (Dc.colorFor(next, e.path) === source) return result;
    return carry(result, Dc.setColor(next, e.path, source, { branch: false }));
  }

  /* An edit made on top of another keeps the first one's anchor. */
  function carry(first, second) {
    if (!second) return first;
    var out = { text: second.text };
    if (first.anchorLine !== undefined) out.anchorLine = first.anchorLine;
    if (first.selectPath !== undefined) out.selectPath = first.selectPath;
    return out;
  }

  /* ---------------------------------------------------------------- adding nodes */

  function placeholder() { return t('editor.newNode'); }

  /* kind: 'child' | 'sibling' | 'before' | 'root', or on a tree root
   * 'right' | 'left' (a branch on that side of it). The new node opens for
   * typing with its words chosen, in the same task: a phone's keyboard comes
   * up only for a field focused inside the tap that asked for it. */
  function add(kind, path, opts) {
    opts = opts || {};
    if (!editable()) return false;
    var c = cur();
    var Dc = D();
    if (path === undefined) path = selected();
    if (path !== null && !c.state.byPath[path]) path = null;
    if (kind !== 'root' && path === null) kind = kind === 'child' || kind === 'right' || kind === 'left' ? null : 'root';
    if ((kind === 'right' || kind === 'left') && !treeRoot(path)) kind = null;
    if (!kind) return false;
    /* The colour of the node it was made from: the parent for a child, the
     * neighbour for a sibling (a branch head ignores it, see bornColor). */
    var source = kind !== 'root' && path !== null ? Dc.colorFor(c.state, path) : null;
    var result = null;
    var label;
    if (kind === 'child') {
      result = Dc.addChild(c.state, path, placeholder());
      label = 'editor.label.addChild';
    } else if (kind === 'right' || kind === 'left') {
      /* At the end of the root's branches, which is the foot of its side. */
      result = Dc.addChild(c.state, path, placeholder());
      if (result && kind === 'left') result = settleSide(result, 'left');
      label = kind === 'left' ? 'editor.label.addLeft' : 'editor.label.addRight';
    } else if (kind === 'sibling') {
      result = Dc.addSibling(c.state, path, placeholder());
      label = 'editor.label.addSibling';
    } else if (kind === 'before') {
      result = siblingBefore(c.state, path);
      label = 'editor.label.addSibling';
    } else {
      result = Dc.addRoot(c.state, placeholder());
      label = 'editor.label.addRoot';
    }
    if (!result) return false;
    result = bornColor(result, source);
    if (!apply(result, label)) return false;
    var made = selected();
    /* The node is named in the same step that made it: one Undo takes back
     * the gesture, and Escape before a name is given takes the node back. */
    var st = store();
    var born = st && typeof st.historyState === 'function' ? st.historyState().undoId : null;
    if (made !== null && opts.rename !== false) startRename(made, { selectAll: true, born: born });
    return true;
  }

  /* Before: written after, then moved in front, as one edit. */
  function siblingBefore(state, path) {
    var Dc = D();
    var after = Dc.addSibling(state, path, placeholder());
    if (!after) return null;
    var next = Dc.parse(after.text);
    var made = Dc.findByLine(next, after.anchorLine);
    if (!made) return after;
    var moved = Dc.moveTo(next, made.path, path, 'before') || Dc.move(next, made.path, -1);
    return moved || after;
  }

  /* ---------------------------------------------------------------- deleting, moving */

  /* A branch deleted goes to the trash of its project in the same step: Undo
   * or the trash brings it back, so nothing asks first. */
  function remove(path) {
    if (!editable()) return false;
    if (path === undefined) path = selected();
    var c = cur();
    var Dc = D();
    var e = entryOf(path);
    if (!e) return false;
    /* The one root holds the whole map: taking it out leaves an empty file
     * with nothing to click and nothing for Tab or Enter to grow from, all
     * from one Backspace the person may have meant for a text field. */
    var removed = path === '' ? null : Dc.remove(c.state, path);
    if (path === '' || (removed && !Dc.parse(removed.text).flat.length)) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.rootStays'));
      return false;
    }
    if (!removed) return false;
    var taken = Dc.extractBranch(c.state, path);
    var next = landingAfterRemove(c.state, path);
    var big = e.children && e.children.length > 0;
    var label = Dc.plainText(e);
    var st = store();
    var done = false;
    if (st && typeof st.trashBranch === 'function' && taken) {
      /* The text goes through the session (so a delete from the keyboard
       * lands without motion, like every other key), and the branch into
       * the trash in the same transaction: one step. */
      transaction('store.label.deleteBranch', function () {
        done = apply(removed, 'store.label.deleteBranch', { select: next });
        if (done) {
          st.trashBranch(c.projectId, c.mapId, {
            fragment: taken.fragment, origin: taken.origin, label: label, text: removed.text,
            from: { selected: path }, to: { selected: next }, changeOrigin: 'editor'
          });
        }
      }, { from: { selected: path }, to: { selected: next } });
    } else {
      done = apply(removed, 'store.label.deleteBranch', { select: next });
    }
    if (done && big && ns.ui && ns.ui.toastUndo) ns.ui.toastUndo(t('editor.deleted', { label: label }));
    return done;
  }

  /* Where the selection goes when a node is deleted: the node that takes its
   * place (the next sibling), else the one before it, else the parent. */
  function landingAfterRemove(state, path) {
    var Dc = D();
    var e = state.byPath[path];
    var sibs = Dc.siblingEntries(state, e);
    var i = -1;
    for (var k = 0; k < sibs.length; k++) if (sibs[k].path === path) i = k;
    if (i >= 0 && i + 1 < sibs.length) return path;
    if (i > 0) return sibs[i - 1].path;
    return parentOf(path);
  }

  /* ---------------------------------------------------------------- sides */

  /* An edit that moved a node (its result's selectPath, else its anchor
   * line) may have changed what the node is. Now a first-level branch, it
   * grows on `side` when one is given (else it keeps the marker its line
   * carried); now deeper, it grows on its parent's side and loses a 'left'
   * marker it no longer means. So do the nodes under it: a tree root moved
   * under another node brings its first-level branches down with it.
   * Written on top of the edit: one step. */
  function settleSide(result, side) {
    if (!result || typeof result.text !== 'string') return result;
    var Dc = D();
    var next = Dc.parse(result.text);
    var e = result.selectPath !== undefined && result.selectPath !== null ? next.byPath[result.selectPath] : null;
    if (!e && typeof result.anchorLine === 'number') e = Dc.findByLine(next, result.anchorLine);
    if (!e) return result;
    var path = e.path;
    var fix = null;
    if (side && Dc.isFirstLevel(next, path)) {
      fix = Dc.setSide(next, path, side);
      if (fix) next = Dc.parse(fix.text);
    }
    fix = Dc.dropStraySides(next, [path]) || fix;
    return carry(result, fix);
  }

  /* A first-level branch to the other side of its root, with all it holds.
   * Its place in the file stays: each side reads in file order. */
  function moveSide(path, side) {
    if (!editable() || !firstLevel(path) || sideOf(path) === side) return false;
    var r = D().setSide(cur().state, path, side);
    if (!r) return false;
    return apply(r, side === 'left' ? 'editor.label.sideLeft' : 'editor.label.sideRight');
  }

  /* The sibling a first-level branch swaps with: the next one on its own
   * side (the ones between, on the other side, are not its neighbours on
   * the map). Null for a node that is not a first-level branch. */
  function sideNeighbour(path, dir) {
    var c = cur();
    var e = entryOf(path);
    if (!c || !e) return null;
    var sibs = D().siblingEntries(c.state, e);
    var at = -1;
    for (var i = 0; i < sibs.length; i++) if (sibs[i].path === e.path) at = i;
    if (at < 0) return null;
    if (!firstLevel(path)) return null;
    var side = sideOf(path);
    for (var k = at + dir; k >= 0 && k < sibs.length; k += dir) {
      if (sideOf(sibs[k].path) === side) return { entry: sibs[k], adjacent: k === at + dir };
    }
    return null;
  }

  /* The edit Alt+Up / Alt+Down / Alt+Right make, or null. */
  function shiftEdit(how, path) {
    var c = cur();
    var Dc = D();
    if (how === 'outdent') {
      /* Out beside its parent: a node that becomes a first-level branch
       * stays on the side it grew on. */
      var was = sideOf(path);
      return unplace(settleSide(Dc.outdent(c.state, path), was));
    }
    var first = firstLevel(path);
    if (how === 'indent') {
      /* A tree root moved under the one above it: its branches are no
       * longer first-level and lose their 'left' markers. */
      if (!first) return unplace(treeRoot(path) ? settleSide(Dc.indent(c.state, path), null) : Dc.indent(c.state, path));
      /* Under the branch above it on its own side. */
      var above = sideNeighbour(path, -1);
      if (!above) return null;
      var r = above.adjacent ? Dc.indent(c.state, path) : Dc.moveTo(c.state, path, above.entry.path, 'child');
      return unplace(settleSide(r, null));
    }
    var dir = how === 'up' ? -1 : (how === 'down' ? 1 : 0);
    if (!dir) return null;
    if (!first) return Dc.move(c.state, path, dir);
    var n = sideNeighbour(path, dir);
    if (!n) return null;
    return n.adjacent ? Dc.move(c.state, path, dir) : Dc.moveTo(c.state, path, n.entry.path, dir < 0 ? 'before' : 'after');
  }

  var SHIFT_LABELS = { indent: 'editor.label.indent', outdent: 'editor.label.outdent', up: 'editor.label.moveUp', down: 'editor.label.moveDown' };

  function shift(how) {
    if (!editable() || !hasSel()) return false;
    var r = SHIFT_LABELS[how] ? shiftEdit(how, selected()) : null;
    if (!r) return false;
    return apply(r, SHIFT_LABELS[how], { animate: lastInput !== 'key' });
  }

  function canShift(how) {
    if (!editable() || !hasSel()) return false;
    var c = cur();
    var Dc = D();
    var path = selected();
    if (how === 'outdent') return Dc.canOutdent(c.state, path);
    if (!firstLevel(path)) {
      if (how === 'indent') return Dc.canIndent(c.state, path);
      if (how === 'up') return Dc.canMove(c.state, path, -1);
      if (how === 'down') return Dc.canMove(c.state, path, 1);
      return false;
    }
    var n = sideNeighbour(path, how === 'down' ? 1 : -1);
    if (!n) return false;
    if (how === 'indent') return n.adjacent ? Dc.canIndent(c.state, path) : Dc.canMoveTo(c.state, path, n.entry.path, 'child');
    if (how === 'up' || how === 'down') return n.adjacent ? Dc.canMove(c.state, path, how === 'up' ? -1 : 1) : Dc.canMoveTo(c.state, path, n.entry.path, how === 'up' ? 'before' : 'after');
    return false;
  }

  /* Whether a drop is a side change only: a first-level branch let go on
   * the other side of its root where its place in the file would not
   * change (the drop line next to itself, its root's last branch onto
   * the root). */
  function onlySide(path, side) {
    return !!side && firstLevel(path) && sideOf(path) !== side;
  }

  /* Drag and drop: one edit, refused where the model would write it wrong.
   * side: where the drop lands as a first-level branch, the side it grows
   * on (view.dropTarget says which). */
  function moveBranch(path, target, where, side, label) {
    if (!editable()) return false;
    var c = cur();
    var Dc = D();
    if (!Dc.canMoveTo(c.state, path, target, where)) {
      return onlySide(path, side) ? moveSide(path, side) : false;
    }
    var r = settleSide(Dc.moveTo(c.state, path, target, where), side || null);
    var newParent = where === 'child' ? target : parentOf(target);
    if (newParent !== parentOf(path)) r = unplace(r);
    if (!r) return false;
    return apply(r, label || 'editor.label.move');
  }

  /* ---------------------------------------------------------------- roots anywhere */

  /* The nodes no other node hangs from, in file order. */
  function topPaths(state) {
    return state.flat.filter(function (e) { return e.parentIndex < 0; }).map(function (e) { return e.path; });
  }

  /* The centre of every tree root as drawn now: a free move writes these
   * for the roots it does not move, so none of them jumps when one leaves
   * the column. */
  function rootCentres() {
    var out = {};
    var g = view && typeof view.geometry === 'function' ? view.geometry() : null;
    if (!g) return out;
    Object.keys(g.nodes).forEach(function (p) {
      var n = g.nodes[p];
      if (n.parent === null) out[p] = { x: Math.round(n.x + n.w / 2), y: Math.round(n.y + n.h / 2) };
    });
    /* A root that has a place keeps it to the unit: measured back from the
     * drawn box, a half-pixel would creep in at every move of another. */
    var placed = cur() ? D().positionsOf(cur().state) : {};
    Object.keys(placed).forEach(function (p) { if (out[p]) out[p] = placed[p]; });
    return out;
  }

  /* Let go anywhere that is no node to drop onto: the branch stays on its
   * parent, its middle where the copy's was (a top node of a map with
   * several: on the map, every other top node keeping its place). The
   * map's one root has nowhere else to be (the camera moves the map). */
  function canPlace(path) {
    return !!cur() && !!entryOf(path) && !loneRoot(path);
  }

  function centreOf(path) {
    var g = view && typeof view.geometry === 'function' ? view.geometry() : null;
    var n = g ? g.nodes[path] : null;
    return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null;
  }

  /* ---------------------------------------------------------------- letting a node go on another
   *
   * A node let go anywhere stays where it was let go. Two things are worked
   * out on the layout the edit would give, not on the one on screen (the
   * layout is asked for it, without drawing): the parent of a node that
   * leaves its siblings' stack is centred on those that stay, so its place
   * from the parent has to be counted from there; and the siblings close up.
   * When the node is then on top of other nodes, what the person chose
   * (Settings, "dropOverlap") decides:
   *   'move'   the node goes to the free place nearest to where it was let
   *            go (the default); the others stay as they are;
   *   'aside'  the node stays where it was let go, and each branch it covers
   *            goes to the free place nearest to where it stood (one that is
   *            its own ancestor cannot: then the node moves instead);
   *   'keep'   nothing is moved: they overlap, as asked.
   * A branch is the node with everything under it (it moves as one); a gap
   * is kept between boxes. */

  var DROP_GAP = 10;
  var DROP_STEP = 12;
  var DROP_REACH = 900;
  var DROP_BUDGET_MS = 80;

  function dropMode() {
    var m = prefGet('dropOverlap', 'move');
    return m === 'aside' || m === 'keep' ? m : 'move';
  }

  function inBranch(p, path) { return p === path || p.indexOf(path + '.') === 0; }

  function boxList(geo) {
    return Object.keys(geo.nodes).map(function (p) { var n = geo.nodes[p]; return { p: p, x: n.x, y: n.y, w: n.w, h: n.h }; });
  }

  /* The first box of `others` that any of `boxes`, moved by (dx, dy), touches. */
  function clash(boxes, dx, dy, others) {
    for (var i = 0; i < boxes.length; i++) {
      var m = boxes[i];
      var x0 = m.x + dx - DROP_GAP;
      var y0 = m.y + dy - DROP_GAP;
      var x1 = m.x + m.w + dx + DROP_GAP;
      var y1 = m.y + m.h + dy + DROP_GAP;
      for (var j = 0; j < others.length; j++) {
        var o = others[j];
        if (x0 < o.x + o.w && x1 > o.x && y0 < o.y + o.h && y1 > o.y) return o;
      }
    }
    return null;
  }

  /* The nearest shift of the branch straight up or down (its column kept)
   * that touches nothing: flush against a box in its way, a gap away from it,
   * so what is moved aside stays in line and evenly spaced. null when none. */
  function slideFree(boxes, others, dx0, dy0) {
    var top = Infinity;
    var bottom = -Infinity;
    boxes.forEach(function (b) { top = Math.min(top, b.y); bottom = Math.max(bottom, b.y + b.h); });
    var cands = [];
    others.forEach(function (o) {
      cands.push(Math.round(o.y - DROP_GAP - bottom), Math.round(o.y + o.h + DROP_GAP - top));
    });
    cands.sort(function (a, b) { return Math.abs(a - dy0) - Math.abs(b - dy0); });
    var t0 = Date.now();
    for (var i = 0; i < cands.length; i++) {
      if (Math.abs(cands[i] - dy0) > DROP_REACH) break;
      if (!clash(boxes, dx0, cands[i], others)) return { dx: dx0, dy: cands[i] };
      if ((i & 31) === 31 && Date.now() - t0 > DROP_BUDGET_MS) break;
    }
    return null;
  }

  /* The nearest shift to (dx0, dy0) that touches nothing; null when none is
   * found within reach and the time allowed. Straight up or down, flush, when
   * that is close; else looking outward in rings. */
  function nearestFree(boxes, others, dx0, dy0) {
    if (!clash(boxes, dx0, dy0, others)) return { dx: dx0, dy: dy0 };
    var slide = slideFree(boxes, others, dx0, dy0);
    if (slide && Math.abs(slide.dy - dy0) <= 160) return slide;
    var t0 = Date.now();
    var ring = null;
    for (var r = DROP_STEP; r <= DROP_REACH && !ring; r += DROP_STEP) {
      var n = Math.max(12, Math.min(96, Math.round(Math.PI * r / DROP_STEP)));
      for (var i = 0; i < n; i++) {
        var a = 2 * Math.PI * i / n;
        var dx = Math.round(dx0 + r * Math.cos(a));
        var dy = Math.round(dy0 + r * Math.sin(a));
        if (!clash(boxes, dx, dy, others)) { ring = { dx: dx, dy: dy }; break; }
      }
      if (!ring && Date.now() - t0 > DROP_BUDGET_MS) break;
    }
    if (!ring) return slide;
    /* A column kept is worth a longer way. */
    if (slide && Math.abs(slide.dy - dy0) <= 2 * Math.hypot(ring.dx - dx0, ring.dy - dy0)) return slide;
    return ring;
  }

  /* A node let go close to the column its siblings stand in (a few units off)
   * is put in it: left edges line up for the right side, right edges for the
   * left. Only against siblings the layout placed, and only a little: the
   * rest is where the hand put it. */
  var SNAP = 14;

  function snapColumn(path, x, y) {
    var c = cur();
    var g = view && typeof view.geometry === 'function' ? view.geometry() : null;
    var n = g ? g.nodes[path] : null;
    if (!c || !n || n.parent === null || n.parent === undefined) return { x: x, y: y };
    var parent = g.nodes[n.parent];
    if (!parent) return { x: x, y: y };
    var onLeft = x < parent.x + parent.w / 2;
    var best = null;
    Object.keys(g.nodes).forEach(function (p) {
      var q = g.nodes[p];
      var e = c.state.byPath[p];
      if (p === path || q.parent !== n.parent || (e && e.at)) return;
      if ((q.x + q.w / 2 < parent.x + parent.w / 2) !== onLeft) return;
      var edge = onLeft ? q.x + q.w : q.x;
      var mine = onLeft ? x + n.w / 2 : x - n.w / 2;
      var d = Math.abs(edge - mine);
      if (d <= SNAP && (!best || d < best.d)) best = { d: d, edge: edge };
    });
    return best ? { x: Math.round(onLeft ? best.edge - n.w / 2 : best.edge + n.w / 2), y: y } : { x: x, y: y };
  }

  function middleIn(geo, p) {
    var n = p === null || p === undefined ? null : geo.nodes[p];
    return n ? { x: n.x + n.w / 2, y: n.y + n.h / 2 } : null;
  }

  /* The positions (what setPositions takes) that put these nodes' middles
   * where `placed` says, on the layout `geo` would draw: a root counts from
   * the map, any other from its parent's middle. */
  function positionsFor(placed, geo) {
    var where = {};
    var roots = Object.keys(placed).some(treeRoot);
    if (roots) where = rootCentres();
    for (var i = 0, keys = Object.keys(placed); i < keys.length; i++) {
      var q = keys[i];
      if (treeRoot(q)) { where[q] = { x: placed[q].x, y: placed[q].y }; continue; }
      var pc = middleIn(geo, parentOf(q));
      if (!pc) return null;
      where[q] = { x: placed[q].x - pc.x, y: placed[q].y - pc.y };
    }
    return where;
  }

  /* What the layout would be, and the text it would be written as, with
   * these nodes put where `placed` says; repeated until their middles are
   * where they were meant to be (a parent's middle depends on who stays). */
  function trialPlace(placed) {
    var c = cur();
    var Dc = D();
    var geo = view.geometry();
    var result = null;
    for (var round = 0; round < 3; round++) {
      var where = positionsFor(placed, geo);
      if (!where) return null;
      var r = Dc.setPositions(c.state, where);
      if (!r) return { geo: geo, result: result, where: where };
      result = r;
      var next = view.layoutOf(Dc.viewTree(Dc.parse(r.text)));
      var stable = true;
      Object.keys(placed).forEach(function (q) {
        var m = middleIn(next, q);
        if (!m || Math.abs(m.x - placed[q].x) > 0.5 || Math.abs(m.y - placed[q].y) > 0.5) stable = false;
      });
      geo = next;
      if (stable) return { geo: geo, result: result, where: where };
    }
    return { geo: geo, result: result, where: positionsFor(placed, geo) };
  }

  /* Every pair of boxes in a layout that touch, as 'a|b' keys. */
  function touching(boxes) {
    var sorted = boxes.slice().sort(function (a, b) { return a.x - b.x; });
    var out = Object.create(null);
    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      for (var j = i + 1; j < sorted.length; j++) {
        var b = sorted[j];
        if (b.x >= a.x + a.w) break;
        if (a.y < b.y + b.h && a.y + a.h > b.y) out[a.p < b.p ? a.p + '|' + b.p : b.p + '|' + a.p] = [a.p, b.p];
      }
    }
    return out;
  }

  /* The edit moved what it did not touch: a parent whose child left its stack
   * is centred on those that stayed, and every node put by hand under it
   * moved with it - on top of others, maybe. Whatever touches now and did not
   * before is put right by moving the branch put by hand (never one the
   * layout placed): the nearest free place, as for the node itself. */
  function fixAll(plan, path, before) {
    var c = cur();
    var state = c.state;
    function handed(p) {
      for (var a = p; a !== null; a = parentOf(a)) {
        var e = state.byPath[a];
        if ((e && e.at) || plan.placed[a] || (e && treeRoot(a))) return a;
      }
      return null;
    }
    for (var round = 0; round < 4; round++) {
      var geo = plan.trial.geo;
      var boxes = boxList(geo);
      var now = touching(boxes);
      var moved = Object.create(null);
      var any = false;
      Object.keys(now).forEach(function (k) {
        if (before[k]) return;
        var a = now[k][0];
        var b = now[k][1];
        var ta = handed(a);
        var tb = handed(b);
        var pick = null;
        if (tb && !inBranch(b, path)) pick = tb;
        else if (ta && !inBranch(a, path)) pick = ta;
        else pick = tb || ta;
        if (!pick || moved[pick]) return;
        var branch = boxes.filter(function (q) { return inBranch(q.p, pick); });
        var rest = boxes.filter(function (q) { return !inBranch(q.p, pick); });
        var f = nearestFree(branch, rest, 0, 0);
        var m = middleIn(geo, pick);
        if (!f || !m) return;
        plan.placed[pick] = { x: m.x + f.dx, y: m.y + f.dy };
        moved[pick] = true;
        any = true;
      });
      if (!any) break;
      var t = trialPlace(plan.placed);
      if (!t) break;
      plan.trial = t;
    }
    return plan;
  }

  function settle(path, x, y) {
    var geo0 = view.geometry();
    var before = touching(boxList(geo0));
    var plan = settleCore(path, x, y);
    return plan && dropMode() !== 'keep' ? fixAll(plan, path, before) : plan;
  }

  /* Where the node (and, in 'aside', the others) end up for a drop with the
   * node's middle at (x, y): {placed: {path: middle}, trial}. */
  function settleCore(path, x, y) {
    var placed = {};
    placed[path] = { x: x, y: y };
    var first = trialPlace(placed);
    if (!first) return null;
    var mode = dropMode();
    if (mode === 'keep') return { placed: placed, trial: first };

    function parts(geo, branchPath) {
      var all = boxList(geo);
      return { mine: all.filter(function (b) { return inBranch(b.p, branchPath); }), rest: all.filter(function (b) { return !inBranch(b.p, branchPath); }) };
    }
    var sp = parts(first.geo, path);
    if (!clash(sp.mine, 0, 0, sp.rest)) return { placed: placed, trial: first };

    function moveNode() {
      var one = {};
      one[path] = { x: x, y: y };
      var t1 = trialPlace(one);
      if (!t1) return { placed: placed, trial: first };
      var p1 = parts(t1.geo, path);
      var f = nearestFree(p1.mine, p1.rest, 0, 0);
            if (!f) return { placed: one, trial: t1 };
      one[path] = { x: x + f.dx, y: y + f.dy };
      var t2 = trialPlace(one);
      return { placed: one, trial: t2 || t1 };
    }
    if (mode === 'move') return moveNode();

    /* 'aside': each branch the node covers goes to the nearest free place; the
     * siblings of one that leaves close up, so it is looked at again. */
    var cur2 = { placed: placed, trial: first };
    for (var round = 0; round < 4; round++) {
      var geo = cur2.trial.geo;
      var q = parts(geo, path);
      var hit = Object.create(null);
      q.rest.forEach(function (o) { if (clash([o], 0, 0, q.mine)) hit[o.p] = true; });
      var tops = Object.keys(hit).filter(function (p) {
        for (var a = parentOf(p); a !== null; a = parentOf(a)) if (hit[a]) return false;
        return true;
      });
      if (!tops.length) return cur2;
      if (tops.some(function (p) { return inBranch(path, p); })) return moveNode();
      var nextPlaced = Object.assign({}, cur2.placed);
      var boxes = boxList(geo);
      for (var i = 0; i < tops.length; i++) {
        var top = tops[i];
        var branch = boxes.filter(function (b) { return inBranch(b.p, top); });
        var others = boxes.filter(function (b) { return !inBranch(b.p, top); });
        var f = nearestFree(branch, others, 0, 0);
        if (!f) return moveNode();
        var m = middleIn(geo, top);
        nextPlaced[top] = { x: m.x + f.dx, y: m.y + f.dy };
        branch.forEach(function (b) { b.x += f.dx; b.y += f.dy; });
      }
      var t3 = trialPlace(nextPlaced);
      if (!t3) return moveNode();
      cur2 = { placed: nextPlaced, trial: t3 };
    }
    var q2 = parts(cur2.trial.geo, path);
    return clash(q2.mine, 0, 0, q2.rest) ? moveNode() : cur2;
  }

  function placeFree(path, x, y) {
    if (!editable() || !canPlace(path) || !isFinite(x) || !isFinite(y)) return false;
    var c = cur();
    var Dc = D();
    if (!treeRoot(path)) { var snapped = snapColumn(path, x, y); x = snapped.x; y = snapped.y; }
    var plan = view && typeof view.layoutOf === 'function' ? settle(path, x, y) : null;
    if (plan && plan.trial) {
      /* No edit: the place found is the one it already has. */
      if (!plan.trial.result) return false;
      return apply(plan.trial.result, 'editor.label.place', { select: path });
    }
    /* Without a layout to ask: where it was let go, counted from where its parent is now. */
    var where = {};
    if (treeRoot(path)) {
      where = rootCentres();
      where[path] = { x: x, y: y };
    } else {
      var p = centreOf(parentOf(path) === '' && !c.state.byPath[''] ? null : parentOf(path));
      if (!p) return false;
      where[path] = { x: x - p.x, y: y - p.y };
    }
    return apply(Dc.setPositions(c.state, where), 'editor.label.place', { select: path });
  }

  /* A branch hung on another parent forgets where it stood by the old one. */
  function unplace(result) {
    if (!result || typeof result.text !== 'string') return result;
    var Dc = D();
    var next = Dc.parse(result.text);
    var e = result.selectPath !== undefined && result.selectPath !== null ? next.byPath[result.selectPath] : null;
    if (!e && typeof result.anchorLine === 'number') e = Dc.findByLine(next, result.anchorLine);
    var one = {};
    if (e && e.at && !(treeRoot(e.path) && !next.byPath[''])) one[e.path] = null;
    /* Back to one root: the place it had among several goes too. */
    if (next.byPath[''] && next.byPath[''].at) one[''] = null;
    return carry(result, Dc.setPositions(next, one));
  }

  /* The branch off its parent: a root of its own, where it stands now. */
  function detach(path) {
    if (!editable() || !entryOf(path) || treeRoot(path)) return false;
    var c = cur();
    var Dc = D();
    var here = centreOf(path);
    var where = rootCentres();
    var tops = topPaths(c.state);
    var moved = Dc.moveTo(c.state, path, tops[tops.length - 1], 'after');
    if (!moved || !here) return false;
    var next = Dc.parse(moved.text);
    var now = topPaths(next);
    if (now.length !== tops.length + 1) return false;
    var at = {};
    tops.forEach(function (p, i) { if (where[p]) at[now[i]] = where[p]; });
    var mine = now[now.length - 1];
    at[mine] = { x: Math.round(here.x), y: Math.round(here.y) };
    var r = carry(moved, Dc.setPositions(next, at));
    r = carry(r, Dc.dropStraySides(Dc.parse(r.text), [mine]));
    return apply(r, 'editor.label.detach', { select: mine });
  }

  /* Attach to: the next node chosen (a tap, a click) becomes its parent. */
  var linking = null;

  function startAttach(path) {
    if (!editable() || !entryOf(path) || loneRoot(path)) return false;
    endAttach();
    var c = cur();
    linking = { path: path, key: c && c.keys ? c.keys[path] : undefined, toast: null, pop: null };
    document.documentElement.setAttribute('data-linking', '');
    if (ns.ui && ns.ui.escape) linking.pop = ns.ui.escape.push(endAttach);
    if (ns.ui && ns.ui.toast) linking.toast = ns.ui.toast(t('editor.attachPick'), { duration: 8000 });
    return true;
  }

  function endAttach() {
    var l = linking;
    if (!l) return;
    linking = null;
    document.documentElement.removeAttribute('data-linking');
    if (l.pop) l.pop();
    if (l.toast && l.toast.close) l.toast.close();
  }

  function attachTo(target) {
    var l = linking;
    endAttach();
    var c = cur();
    if (!l || !c || target === null || target === undefined) return false;
    var path = l.path;
    if (l.key !== undefined && c.keys && c.keys[path] !== l.key) {
      for (var p in c.keys) if (c.keys[p] === l.key) path = p;
    }
    if (!entryOf(path) || path === target) return false;
    if (!D().canMoveTo(c.state, path, target, 'child')) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.refused'));
      return false;
    }
    return moveBranch(path, target, 'child', null, 'editor.label.attach');
  }

  function tidy(path) {
    if (!editable() || !cur()) return false;
    var whole = path === null || path === undefined;
    var r = D().clearPositions(cur().state, whole ? undefined : path);
    if (!r) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.alreadyTidy'));
      return false;
    }
    return apply(r, whole ? 'editor.label.tidyMap' : 'editor.label.tidy', { select: false });
  }

  function hasPlaced(path) {
    var c = cur();
    return !!c && Object.keys(D().positionsOf(c.state, path === undefined ? undefined : path)).length > 0;
  }

  /* ---------------------------------------------------------------- colour */

  /* A colour picked by hand is that node's: the children it already has keep
   * theirs. A node the dice opened a branch with keeps the branch reach. A
   * null colour hands the node back to the palette. */
  function paint(path, hex, opts) {
    opts = opts || {};
    if (!editable()) return false;
    if (path === undefined) path = selected();
    var e = entryOf(path);
    if (!e) return false;
    var r = D().setColor(cur().state, path, hex || null, { branch: !!(hex && e.colorBranch) });
    return apply(r, 'editor.label.color', { select: false, key: opts.key });
  }

  function colorOf(path) {
    var c = cur();
    if (!c || !entryOf(path)) return null;
    return D().colorFor(c.state, path);
  }

  function openColor(anchor, path) {
    if (path === undefined) path = selected();
    if (!editable() || !entryOf(path) || !ns.colorpicker) return false;
    /* The swatch that opened the picker closes it again. */
    if (ns.colorpicker.isOpen() && ns.colorpicker.owner() === 'editor:' + path && anchor && anchor === tb.color) {
      ns.colorpicker.close();
      return true;
    }
    var key = 'editor.color:' + path + ':' + Date.now();
    ns.colorpicker.open(anchor || nodeAnchor(path), {
      color: colorOf(path),
      owner: 'editor:' + path,
      onPick: function (hex) { paint(path, hex, { key: key }); },
      onAuto: function () { paint(path, null, { key: key }); },
      onClose: function () { if (tb.color) tb.color.setAttribute('aria-expanded', 'false'); }
    });
    if (tb.color && anchor === tb.color) tb.color.setAttribute('aria-expanded', 'true');
    return true;
  }

  function nodeAnchor(path) {
    var r = view && path !== null ? view.rect(path) : null;
    if (r) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    var s = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    var x = s.left + s.width / 2;
    var y = s.top + s.height / 3;
    return { left: x, top: y, right: x, bottom: y };
  }

  /* ---------------------------------------------------------------- tasks, links, pictures */

  function toggleTask(path) {
    if (!editable() || !entryOf(path)) return false;
    var e = entryOf(path);
    var r = D().toggleTask(cur().state, path);
    return apply(r, e.task ? 'editor.label.untask' : 'editor.label.task', { select: false });
  }

  /* A task box in the words under a title: ticked where it is drawn,
   * one step like the node's own box. */
  function toggleBodyTask(path, index) {
    if (!editable() || !entryOf(path)) return false;
    var done = D().bodyTasks(cur().state, path)[index];
    var r = D().toggleBodyTask(cur().state, path, index);
    return apply(r, done ? 'editor.label.untask' : 'editor.label.task', { select: false });
  }

  function setTask(path, on) {
    if (!editable() || !entryOf(path)) return false;
    var r = D().setTask(cur().state, path, on);
    return apply(r, on ? 'editor.label.taskOn' : 'editor.label.taskOff', { select: false });
  }

  function canBeTask(path) {
    var e = entryOf(path);
    return !!e && e.kind === 'bullet';
  }

  var SAFE_URL = /^(https?:|mailto:)/i;

  /* A web link opens in a new tab that cannot reach back into this one; a
   * [[Map]] link opens that map of the project, or offers to make it. */
  function openLink(href, kind, node) {
    if (kind === 'map') return openMapLink(href, node);
    var url = String(href || '').trim();
    if (!SAFE_URL.test(url)) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.badLink'), { kind: 'error' });
      return false;
    }
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    try { a.click(); } finally { a.remove(); }
    return true;
  }

  function sameName(a, b) {
    function norm(s) { return String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(); }
    return norm(a) === norm(b);
  }

  /* A [[Map]] link opens that map; [[Map#id]] goes on to the node that
   * carries the id, [[#id]] to a node of the map shown. */
  function openMapLink(name, node) {
    var c = cur();
    var st = store();
    if (!c || !st) return false;
    var p = st.project(c.projectId);
    if (!p) return false;
    var target = null;
    if (!name) target = st.map(c.projectId, c.mapId);
    for (var i = 0; !target && i < p.maps.length; i++) if (sameName(p.maps[i].name, name)) target = p.maps[i];
    if (target) return jumpTo(p.id, target.id, node);
    if (ns.ui && ns.ui.toast) {
      ns.ui.toast(t('editor.noMap', { name: name }), readOnly() ? {} : {
        action: { label: t('editor.makeMap'), run: function () { st.createMap(p.id, { name: name }); } }
      });
    }
    return false;
  }

  function linksOf(path) {
    var c = cur();
    if (!c || !entryOf(path) || typeof D().linksOf !== 'function') return [];
    return D().linksOf(c.state, path) || [];
  }

  /* The node's link, or a menu of them when it carries several. */
  function openLinks(path, anchor) {
    var links = linksOf(path);
    if (!links.length) return false;
    if (links.length === 1) return openLink(links[0].href, links[0].kind);
    var items = links.map(function (l) {
      return { label: l.text || l.href, icon: l.kind === 'map' ? 'map' : 'external', onSelect: function () { openLink(l.href, l.kind); } };
    });
    if (anchor && anchor.nodeType === 1) ns.ui.menu(anchor, items, { label: t('editor.links') });
    else {
      var a = nodeAnchor(path);
      ns.ui.contextMenu({ x: a.left, y: a.bottom }, items, { label: t('editor.links') });
    }
    return true;
  }

  function openViewer(image) {
    if (!image || !image.path || !ns.media || typeof ns.media.openViewer !== 'function') return false;
    try { ns.media.openViewer(image.path); } catch (err) {
      if (window.console) console.error('MindRoot: the picture viewer failed', err);
      return false;
    }
    return true;
  }

  /* Pictures come from the media module, which says whether it is there by
   * registering its commands. */
  function mediaCommand(id, ctx) {
    var C = ns.commands;
    if (!C || !C.has(id)) return false;
    return C.run(id, ctx || { source: 'editor' }) !== false;
  }

  /* ---------------------------------------------------------------- folding */

  function hasKids(path) {
    var e = entryOf(path);
    return !!e && e.children && e.children.length > 0;
  }

  function toggleFold(path, deep) {
    if (!view || !hasKids(path)) return false;
    view.fold(path, undefined, { deep: !!deep, animate: lastInput !== 'key' });
    return true;
  }

  /* Fold all: every branch closed but the top nodes, which stay open so the
   * first level still shows. Unfold all: everything open. */
  function tops() {
    var c = cur();
    if (!c || !c.tree) return [];
    return c.tree.synthetic ? c.tree.children.map(function (v) { return v.path; }) : [c.tree.path];
  }

  function foldAll() {
    if (!view) return false;
    tops().forEach(function (p) {
      if (!hasKids(p)) return;
      view.fold(p, true, { deep: true, animate: false });
      view.fold(p, false, { animate: !reduced() && lastInput !== 'key' });
    });
    return true;
  }

  function unfoldAll() {
    if (!view) return false;
    tops().forEach(function (p) { if (hasKids(p)) view.fold(p, false, { deep: true, animate: lastInput !== 'key' }); });
    return true;
  }

  /* ---------------------------------------------------------------- navigating */

  function go(dir) {
    if (!view || !cur()) return false;
    var from = selected();
    var next = view.neighbor(from, dir);
    if (next === null || next === undefined) return from !== null;
    S().select(next, { reveal: true, animate: false });
    return true;
  }

  /* Home and End: the first and the last of the siblings on screen. */
  function goEnd(last) {
    if (!view || !hasSel()) return false;
    var g = view.geometry();
    var me = g.nodes[selected()];
    if (!me) return false;
    var sibs = g.order.filter(function (p) {
      var n = g.nodes[p];
      return n.parent === me.parent && n.side === me.side;
    });
    if (!sibs.length) return false;
    sibs.sort(function (a, b) { return g.nodes[a].y - g.nodes[b].y; });
    S().select(last ? sibs[sibs.length - 1] : sibs[0], { reveal: true, animate: false });
    return true;
  }

  /* ---------------------------------------------------------------- copying a branch to another map */

  function copyBranch(path, anchor) {
    var c = cur();
    var st = store();
    if (!c || !st || !entryOf(path) || readOnly()) return false;
    var items = [];
    st.projects().forEach(function (p) {
      var maps = p.maps.filter(function (m) { return !(p.id === c.projectId && m.id === c.mapId); });
      if (!maps.length) return;
      items.push({ heading: p.name });
      maps.forEach(function (m) {
        items.push({ label: m.name, icon: 'map', onSelect: function () { copyTo(path, p.id, m.id, m.name); } });
      });
    });
    if (!items.length) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.copyNothing'));
      return false;
    }
    if (anchor && anchor.nodeType === 1) ns.ui.menu(anchor, items, { title: t('editor.copyTitle'), label: t('editor.copyTitle') });
    else {
      var a = anchor || nodeAnchor(path);
      ns.ui.contextMenu({ x: a.left, y: a.bottom }, items, { title: t('editor.copyTitle'), label: t('editor.copyTitle') });
    }
    return true;
  }

  function copyTo(path, pid, mid, name) {
    var c = cur();
    var st = store();
    if (!c || !st) return false;
    var res = st.importBranches({ from: { projectId: c.projectId, mapId: c.mapId }, to: { projectId: pid, mapId: mid }, paths: [path] });
    if (!res || !res.count) return false;
    if (ns.ui && ns.ui.toast) {
      ns.ui.toast(t('editor.copied', { map: name }), {
        action: { label: t('editor.copyOpen'), run: function () { S().open(pid, mid, { where: { anchorLine: res.anchorLine } }); } }
      });
    }
    return true;
  }

  /* ---------------------------------------------------------------- branches into maps of their own */

  /* The chosen branches leave this map for maps of their own in the same
   * project (store.splitBranches): each stays here as a [[link]] to its new
   * map, which links back. One undo step; this map stays open. */
  function toMaps(paths) {
    var c = cur();
    var st = store();
    if (!c || !st || readOnly() || typeof st.splitBranches !== 'function') return false;
    var res = st.splitBranches(c.projectId, c.mapId, paths);
    if (!res || !res.count) return false;
    if (ns.ui && ns.ui.toast) {
      var first = res.maps[0];
      var msg = res.count === 1 ? t('editor.madeMaps.one', { map: first.name }) : t('editor.madeMaps.other', { n: res.count });
      ns.ui.toast(msg, { action: { label: t('editor.copyOpen'), run: function () { S().open(c.projectId, first.id); } } });
    }
    return true;
  }

  /* Every first-level branch: the children of the tree roots. */
  function firstLevelPaths() {
    var c = cur();
    if (!c) return [];
    var out = [];
    tops().forEach(function (p) {
      var e = c.state.byPath[p];
      if (e && e.children) e.children.forEach(function (k) { out.push(k.path); });
    });
    return out;
  }

  /* ================================================================ the rename */

  /* Both fields hold a plain string: what is read back is the characters,
   * with the line breaks a browser may have written as <br> or <div> counted
   * as the newlines they stand for. A <br> at the very end is the sentinel
   * that gives a trailing newline a line box (setField), not a character. */
  function readNode(root, out, isRoot) {
    for (var n = root.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out.s += n.data;
      else if (n.nodeName === 'BR') {
        if (!(isRoot && !n.nextSibling)) out.s += '\n';
      } else if (n.nodeType === 1) {
        var block = /^(DIV|P|LI)$/.test(n.nodeName);
        if (block && out.s && out.s.charAt(out.s.length - 1) !== '\n') out.s += '\n';
        readNode(n, out, false);
      }
    }
    return out.s;
  }

  function readField(el) { return readNode(el, { s: '' }, true); }

  /* The string back into a field, as one text node: a trailing newline
   * needs a <br> after it or the browser draws no last line, and the first
   * thing typed after Shift+Enter would land on the line before. */
  function setField(el, text) {
    el.textContent = text;
    if (/\n$/.test(text)) el.appendChild(document.createElement('br'));
  }

  /* Where a range falls in a field, counted in characters of readField. */
  function offsetsOf(el, range) {
    var before = document.createRange();
    before.setStart(el, 0);
    before.setEnd(range.startContainer, range.startOffset);
    var start = readNode(before.cloneContents(), { s: '' }, false).length;
    var inside = readNode(range.cloneContents(), { s: '' }, false).length;
    return { start: start, end: start + inside };
  }

  /* The caret (or the choice) put back at character offsets. */
  function chooseRange(el, start, end) {
    var texts = [];
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) texts.push(c);
        else walk(c);
      }
    })(el);
    if (!texts.length) {
      var empty = document.createTextNode('');
      el.insertBefore(empty, el.firstChild);
      texts.push(empty);
    }
    function point(at) {
      var left = Math.max(0, at);
      for (var i = 0; i < texts.length; i++) {
        var len = texts[i].data.length;
        if (left <= len) return { node: texts[i], offset: left };
        left -= len;
      }
      var last = texts[texts.length - 1];
      return { node: last, offset: last.data.length };
    }
    var a = point(start);
    var b = point(end === undefined ? start : end);
    var range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  /* The range of the current selection, if it lies in that field. */
  function rangeIn(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    return el.contains(r.startContainer) && el.contains(r.endContainer) ? r : null;
  }

  function fieldOfRange() {
    if (!renaming) return null;
    var fields = [renaming.title.el, renaming.body.el];
    for (var i = 0; i < fields.length; i++) if (rangeIn(fields[i])) return fields[i];
    return null;
  }

  /* Which field is being written in: the caret's, else the focused one,
   * else the last one that was. */
  function currentField() {
    if (!renaming) return null;
    var f = fieldOfRange();
    if (f) return f;
    var a = document.activeElement;
    if (a === renaming.title.el || a === renaming.body.el) return a;
    return renaming.field === 'body' ? renaming.body.el : renaming.title.el;
  }

  function fieldName(el) { return renaming && el === renaming.body.el ? 'body' : 'line'; }

  function caretOffsets(el) {
    var r = rangeIn(el);
    return r ? offsetsOf(el, r) : null;
  }

  /* Text put in at the caret by rewriting the string and counting the caret
   * back: left to the browser a newline comes back as an element, and the
   * field would stop holding the string the file holds. */
  function insertPlain(el, text) {
    var hist = historyOf(el);
    if (hist) hist.record();
    var at = caretOffsets(el);
    var whole = readField(el);
    if (!at) at = { start: whole.length, end: whole.length };
    if (text.indexOf('\n') < 0 && document.queryCommandSupported && document.queryCommandSupported('insertText')) {
      /* Typed as the browser types (caret, spellcheck); the undo step was recorded above. */
      try {
        if (document.execCommand('insertText', false, text)) {
          normalize(el);
          return;
        }
      } catch (err) { /* written by hand below */ }
    }
    setField(el, whole.slice(0, at.start) + text + whole.slice(at.end));
    chooseRange(el, at.start + text.length);
  }

  /* After the browser typed: if it wrote anything but text (a <div> for a
   * line, a <b> it was not asked for), the string is put back as text, the
   * caret where it was. */
  function normalize(el) {
    var clean = true;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) continue;
      if (n.nodeName === 'BR' && !n.nextSibling) continue;
      clean = false;
      break;
    }
    var textNodes = 0;
    for (var m = el.firstChild; m; m = m.nextSibling) if (m.nodeType === 3) textNodes++;
    if (clean && textNodes <= 1) return;
    var at = caretOffsets(el);
    var text = readField(el);
    setField(el, text);
    if (at && document.activeElement === el) chooseRange(el, at.start, at.end);
  }

  /* ---------------------------------------------------------------- strike, which the model leaves to the editor */

  function trimRange(text, start, end) {
    while (start < end && /\s/.test(text.charAt(start))) start++;
    while (end > start && /\s/.test(text.charAt(end - 1))) end--;
    return { start: start, end: end };
  }

  function strikeState(text, start, end) {
    var b = trimRange(text, start, end);
    if (b.end <= b.start) return false;
    if (text.slice(b.start - 2, b.start) === '~~' && text.slice(b.end, b.end + 2) === '~~') return true;
    return b.end - b.start >= 4 && text.slice(b.start, b.start + 2) === '~~' && text.slice(b.end - 2, b.end) === '~~';
  }

  function toggleStrike(text, start, end) {
    var b = trimRange(text, start, end);
    if (b.end <= b.start) return { text: text, start: start, end: end };
    if (text.slice(b.start - 2, b.start) === '~~' && text.slice(b.end, b.end + 2) === '~~') {
      return { text: text.slice(0, b.start - 2) + text.slice(b.start, b.end) + text.slice(b.end + 2), start: b.start - 2, end: b.end - 2 };
    }
    if (b.end - b.start >= 4 && text.slice(b.start, b.start + 2) === '~~' && text.slice(b.end - 2, b.end) === '~~') {
      return { text: text.slice(0, b.start) + text.slice(b.start + 2, b.end - 2) + text.slice(b.end), start: b.start, end: b.end - 4 };
    }
    return { text: text.slice(0, b.start) + '~~' + text.slice(b.start, b.end) + '~~' + text.slice(b.end), start: b.start + 2, end: b.end + 2 };
  }

  /* ---------------------------------------------------------------- starting and ending */

  /* Writing needs letters that can be read: on a map fitted small (a big
   * map on a phone fits at a third of its size) the camera first zooms
   * around the node until its title reaches the reading size - editor.css's
   * --ed-ios-floor (16 px, below which iOS would zoom the page itself) on a
   * touch screen, --ed-read-fine (12 px) with a mouse - and brings it into
   * view. Returns whether the camera moved. */
  function readable(path) {
    var el = view.nodeEl(path);
    var title = el && (el.querySelector('.mv-title') || el);
    if (!title) return false;
    var cam = view.camera();
    var fs = parseFloat(getComputedStyle(title).fontSize) || 16;
    var want = ns.util && ns.util.isTouch ? cssPx(el, '--ed-ios-floor', 16) : cssPx(el, '--ed-read-fine', 12);
    if (!(cam.k > 0) || fs * cam.k >= want - 0.5) return false;
    var r = view.rect(path);
    if (!r) return false;
    view.zoomBy(want / (fs * cam.k), { x: r.left + r.width / 2, y: r.top + r.height / 2 }, { animate: false });
    view.ensureVisible(path, { animate: false, zoom: false });
    return true;
  }

  /* Opens the node for writing where it is drawn. opts.selectAll chooses the
   * words (a new node's placeholder), opts.field / start / end put the caret
   * back where a format action found it. */
  function startRename(path, opts) {
    opts = opts || {};
    if (!editable() || !view) return false;
    var c = cur();
    if (path === undefined) path = selected();
    if (!c.state.byPath[path]) return false;
    if (renaming) {
      if (renaming.path === path && !renaming.done) return focusField(opts);
      finishRename(true);
      c = cur();
      if (!c || !c.state.byPath[path]) return false;
    }
    /* Revealed even when it is already the selection: the map may have been
     * panned away from it, and a caret off the stage cannot be seen. */
    S().select(path, { reveal: true, animate: false });
    var el = view.nodeEl(path);
    if (!el) {
      /* Hidden under a fold: unfold to it, then write once it is drawn. */
      view.unfoldTo(path);
      el = view.nodeEl(path);
      if (!el) return false;
    }
    var titleSpan = el.querySelector('.mv-title .mv-text');
    if (!titleSpan) return false;
    if (readable(path)) el = view.nodeEl(path) || el;
    closeContext();
    if (ns.colorpicker && ns.colorpicker.isOpen && ns.colorpicker.isOpen()) ns.colorpicker.close();

    var Dc = D();
    var title0 = Dc.titleFor(c.state, path);
    var body0 = Dc.bodyFor(c.state, path);
    var r = {
      path: path,
      projectId: c.projectId,
      mapId: c.mapId,
      key: c.keys ? c.keys[path] : undefined,
      el: el,
      title: { el: titleSpan, html: titleSpan.innerHTML, cls: titleSpan.className, start: title0 },
      body: null,
      field: opts.field === 'body' ? 'body' : 'line',
      born: opts.born || null,
      held: 0,
      done: false
    };
    var bodySpan = el.querySelector('.mv-body .mv-body-text');
    if (bodySpan) {
      r.body = { el: bodySpan, html: bodySpan.innerHTML, cls: bodySpan.className, start: body0, made: null, prose: keepProse(bodySpan) };
    } else {
      var block = h('div', { class: 'mv-body mv-body--new' });
      bodySpan = h('span', { class: 'mv-body-text' });
      block.appendChild(bodySpan);
      var card = el.querySelector(':scope > .mv-card');
      el.insertBefore(block, card || null);
      r.body = { el: bodySpan, html: '', cls: bodySpan.className, start: body0, made: block };
    }
    makeField(r.title.el, title0, t('editor.titlePlaceholder'), 'title');
    makeField(r.body.el, body0, t('editor.bodyPlaceholder'), 'body');
    el.classList.add('mv-node--editing');
    fitWidth(r);
    renaming = r;
    formatHidden = false;
    if (formatBar && ns.float) ns.float.anchor(formatBar);
    hideToolbar();
    focusField({ field: r.field, selectAll: opts.selectAll || title0 === placeholder(), start: opts.start, end: opts.end });
    /* Once the format bar is in place: on a phone it docks over the foot
     * of the map, and the node must not be under it. */
    r.typed = true;
    placeFormatBar();
    emit('editor:rename', { path: path, state: 'start' });
    return true;
  }

  /* Text the node carries from outside its quoted words (paragraphs, a
   * quote, a table, code written in another editor) is not written in the
   * field, but it stays in sight under it while the words are written. */
  function keepProse(span) {
    var parts = Array.prototype.filter.call(span.children, function (n) {
      return n.classList && (n.classList.contains('md-p') || n.classList.contains('md-quote') ||
        n.classList.contains('md-table') || n.classList.contains('md-code'));
    });
    if (!parts.length) return null;
    var holder = h('div', { class: 'mv-edit-prose' });
    parts.forEach(function (n, i) {
      if (i) holder.appendChild(document.createElement('br'));
      holder.appendChild(n.cloneNode(true));
    });
    var block = span.closest('.mv-body') || span;
    block.parentNode.insertBefore(holder, block.nextSibling);
    return holder;
  }

  function makeField(el, text, hint, which) {
    el.classList.add('mv-edit', 'mv-edit--' + which);
    el.classList.remove('mv-text--empty');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-multiline', which === 'body' ? 'true' : 'false');
    el.setAttribute('aria-label', hint);
    el.setAttribute('data-placeholder', hint);
    el.setAttribute('autocapitalize', 'sentences');
    el.setAttribute('enterkeyhint', which === 'body' ? 'enter' : 'done');
    setField(el, text);
    fieldHistories.set(el, ns.util.typingHistory({
      read: function () {
        var at = caretOffsets(el);
        var whole = readField(el);
        if (!at) at = { start: whole.length, end: whole.length };
        return { text: whole, start: at.start, end: at.end, caret: at.start === at.end ? at.start : -1 };
      },
      write: function (state) {
        setField(el, state.text);
        if (document.activeElement === el) chooseRange(el, state.start, state.end);
        if (renaming) {
          renaming.typed = true;
          placeFormatBarSoon();
        }
      }
    }));
    el.addEventListener('keydown', onFieldKey);
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('input', onFieldInput);
    el.addEventListener('paste', onPaste);
    el.addEventListener('drop', onFieldDrop);
    el.addEventListener('blur', onFieldBlur);
    el.addEventListener('focus', onFieldFocus);
  }

  /* Each open field's own undo (see util.typingHistory: the browser's would
   * take back one letter per Ctrl+Z here). */
  var fieldHistories = new WeakMap();
  function historyOf(el) { return el ? fieldHistories.get(el) || null : null; }

  function unmakeField(f) {
    var el = f.el;
    fieldHistories.delete(el);
    el.removeEventListener('keydown', onFieldKey);
    el.removeEventListener('beforeinput', onBeforeInput);
    el.removeEventListener('input', onFieldInput);
    el.removeEventListener('paste', onPaste);
    el.removeEventListener('drop', onFieldDrop);
    el.removeEventListener('blur', onFieldBlur);
    el.removeEventListener('focus', onFieldFocus);
    ['contenteditable', 'spellcheck', 'role', 'aria-multiline', 'aria-label', 'data-placeholder', 'autocapitalize', 'enterkeyhint']
      .forEach(function (a) { el.removeAttribute(a); });
    if (f.prose && f.prose.parentNode) f.prose.parentNode.removeChild(f.prose);
    if (f.made) {
      if (f.made.parentNode) f.made.parentNode.removeChild(f.made);
      return;
    }
    el.className = f.cls;
    /* The view's own markup put back as it was: made by doc.inlineHtml,
     * which escapes every word, never by this file. */
    el.innerHTML = f.html;
  }

  function focusField(opts) {
    if (!renaming) return false;
    opts = opts || {};
    var el = opts.field === 'body' ? renaming.body.el : renaming.title.el;
    renaming.field = fieldName(el);
    try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    var len = readField(el).length;
    if (opts.selectAll) chooseRange(el, 0, len);
    else if (typeof opts.start === 'number') chooseRange(el, Math.min(opts.start, len), Math.min(typeof opts.end === 'number' ? opts.end : opts.start, len));
    else chooseRange(el, len);
    resetScroll();
    return true;
  }

  /* The map's own surfaces are not scroll boxes, but a browser keeping a
   * caret in sight will scroll any overflow box it finds: the layer would
   * slide out from under the camera. Put back, and the camera moves instead. */
  function resetScroll() {
    [view && view.el, stage].forEach(function (box) {
      if (box && (box.scrollTop || box.scrollLeft)) { box.scrollTop = 0; box.scrollLeft = 0; }
    });
  }

  /* The values the fields hold, and whether they differ from what opened. */
  function valuesOf(r) {
    var title = readField(r.title.el).replace(/\s+/g, ' ').trim();
    var body = D().sanitizeNote(readField(r.body.el));
    return {
      title: title,
      body: body,
      titleChanged: title !== String(r.title.start || '').replace(/\s+/g, ' ').trim(),
      bodyChanged: body !== D().sanitizeNote(r.body.start || '')
    };
  }

  /* Where the node is now: the same words from the root (an edit elsewhere
   * may have moved it), else the same path if it is still a node. */
  function pathNow(r) {
    var c = cur();
    if (!c || c.projectId !== r.projectId || c.mapId !== r.mapId) return null;
    if (r.key !== undefined && c.keys) {
      if (c.keys[r.path] === r.key) return r.path;
      for (var p in c.keys) if (c.keys[p] === r.key) return p;
    }
    return c.state.byPath[r.path] ? r.path : null;
  }

  /* The body first, so the line is written against a document that already
   * has it: emptying the line then promotes the words (doc.rename). */
  function writeLine(state, path, v, r) {
    var Dc = D();
    var st = state;
    var out = null;
    if (v.bodyChanged) {
      out = Dc.setBody(st, path, v.body);
      if (out) st = Dc.parse(out.text);
    }
    if (v.titleChanged || (v.bodyChanged && !v.title)) {
      var named = Dc.rename(st, path, v.title);
      if (named) out = named;
    }
    /* Who wrote it: the person's words on the AI's, or the AI's words taken
     * into the person's (a completion taken with Tab), make it mixed. */
    if (out && Dc.byAfterEdit) {
      var was = Dc.byAt(state, path);
      var by = Dc.byAfterEdit(was, !!(r && r.aiWords));
      if (by && by !== was) out = carryBy(out, path, by);
    }
    return out;
  }

  /* An edit with the node at `path` (the same path after it) marked `by`. */
  function carryBy(out, path, by) {
    var Dc = D();
    var marked = Dc.setBy(Dc.parse(out.text), path, by);
    if (!marked) return out;
    var next = { text: marked.text };
    if (out.anchorLine !== undefined) next.anchorLine = out.anchorLine;
    if (out.selectPath !== undefined) next.selectPath = out.selectPath;
    return next;
  }

  /* What a node becomes when the AI's words go into it: still the AI's if
   * it was, else mixed. */
  function byWithAi(state, path) {
    return D().byAt(state, path) === 'ai' ? 'ai' : 'mixed';
  }

  /* Puts the box back as the view drew it; the view rebuilds it from the
   * tree at its next render. */
  function teardown(r) {
    unmakeField(r.title);
    unmakeField(r.body);
    r.el.classList.remove('mv-node--editing');
    if (r.narrowed) r.el.style.removeProperty('max-width');
    if (view) view.invalidate(r.path);
  }

  /* save: write what changed as one step ('rename'); else drop it. Returns
   * whether a step was written. */
  function finishRename(save, opts) {
    opts = opts || {};
    var r = renaming;
    if (!r || r.done) return false;
    r.done = true;
    renaming = null;
    var v = valuesOf(r);
    var hadFocus = r.el.contains(document.activeElement);
    teardown(r);
    hideFormatBar();
    var wrote = false;
    if (save && (v.titleChanged || v.bodyChanged) && editable()) {
      var path = pathNow(r);
      if (path !== null) {
        var result = writeLine(cur().state, path, v, r);
        if (result) wrote = renameWithMap(result, path, r, v.titleChanged);
        /* Written at reading size and wrapped to the screen, the node is
         * now drawn at its own width: all of it is brought into sight. */
        if (wrote && view && r.narrowed) view.ensureVisible(selected() === null ? path : selected(), { animate: false });
      }
    }
    /* Escape on a node just added: the add is taken back (if it is still
     * the last step), not left behind as a 'New node'. */
    if (!save && opts.withdraw && r.born && editable()) {
      var sw = store();
      if (sw && typeof sw.withdraw === 'function') sw.withdraw(r.born);
    }
    if (hadFocus && opts.focus !== false) focusMap();
    emit('editor:rename', { path: r.path, state: 'end', saved: wrote });
    placeToolbar();
    return wrote;
  }

  /* The map is named after its primary node (its root, or the first of
   * several): a new name written there renames the map too, in the same
   * undo step. The sidebar does the other way round. */
  function renameWithMap(result, path, r, titled) {
    var c = cur();
    var st = store();
    var Dc = D();
    var map = st && st.map ? st.map(c.projectId, c.mapId) : null;
    var name = titled && map && path === Dc.primaryPath(c.state) ? Dc.primaryName(Dc.parse(result.text)) : '';
    if (!name || name === map.name || typeof st.renameMap !== 'function') {
      return apply(result, 'editor.label.rename', { select: path, join: r.born });
    }
    var wrote = false;
    transaction('editor.label.rename', function () {
      wrote = apply(result, 'editor.label.rename', { select: path });
      if (wrote) st.renameMap(c.projectId, c.mapId, name);
    });
    return wrote;
  }

  function cancelRename() { return finishRename(false, { withdraw: true }); }

  /* The keyboard stays on the map after writing, so Enter, Tab and the
   * arrows go on working.
   * On a touch screen that focus comes back after a name typed on the
   * on-screen keyboard, which the browser counts as keyboard use: the map's
   * :focus-visible frame would go round the whole screen after every name.
   * So when the last thing the person did outside a text field was a finger
   * or a pen, the map is marked data-quiet-focus (map.css drops the frame;
   * the selected node already shows where the keys go). The first key
   * pressed outside a text field - a real keyboard on a tablet - or the
   * focus leaving the map takes the mark off, and the frame is back. */
  var lastPointer = '';
  function unquiet() { if (view && view.el) view.el.removeAttribute('data-quiet-focus'); }
  document.addEventListener('pointerdown', function (event) { lastPointer = event.pointerType || 'mouse'; }, true);
  document.addEventListener('keydown', function (event) {
    if (ns.util.isTextField(event.target)) return;
    if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
    lastPointer = '';
    unquiet();
  }, true);
  function focusMap() {
    var a = document.activeElement;
    if (!view || !view.el) return;
    if (a && a !== document.body && a.isConnected && !(view.el.contains(a))) return;
    if (lastPointer === 'touch' || lastPointer === 'pen') {
      view.el.setAttribute('data-quiet-focus', '');
      if (!view.el.__mrQuiet) {
        view.el.__mrQuiet = true;
        view.el.addEventListener('focusout', function (event) {
          if (!event.relatedTarget || !view.el.contains(event.relatedTarget)) unquiet();
        });
      }
    }
    try { view.el.focus({ preventScroll: true }); } catch (err) { /* not focusable */ }
  }

  function isRenaming() { return !!renaming; }

  function renamingInfo() {
    if (!renaming) return null;
    return { path: renaming.path, field: fieldName(currentField()) };
  }

  /* What is being typed, for what completes it (ai-ui.js): the field, its
   * words, and the caret. */
  function typingInfo() {
    if (!renaming || renaming.done) return null;
    var el = currentField();
    if (!el) return null;
    var at = caretOffsets(el);
    var whole = readField(el);
    if (!at) at = { start: whole.length, end: whole.length };
    return { path: renaming.path, field: fieldName(el), el: el, text: whole, start: at.start, end: at.end };
  }

  /* Words put where the caret is, as if typed (one step of the field's own
   * undo). opts.ai: they are the AI's (a completion taken): the node will be
   * marked mixed when the writing is put down. */
  function insertText(text, opts) {
    if (!renaming || renaming.done) return false;
    var el = currentField();
    if (!el || !text) return false;
    insertPlain(el, String(text));
    if (opts && opts.ai) renaming.aiWords = true;
    renaming.typed = true;
    placeFormatBarSoon();
    return true;
  }

  /* ---------------------------------------------------------------- ids and mentions */

  /* Where a [[Map#id]] or [[#id]] leads: the node that carries the id, in the
   * map named (the one shown when no map is given). A map with no such node
   * is opened all the same, and the node's absence said. */
  function jumpTo(pid, mid, id) {
    var st = store();
    var m = st && st.map(pid, mid);
    if (!m) return false;
    if (renaming) finishRename(true, { focus: false });
    var c = cur();
    var here = !!c && c.projectId === pid && c.mapId === mid;
    if (!id) return here ? true : !!S().open(pid, mid);
    var path = D().pathOfId(here ? c.state : D().parse(m.text), id);
    if (path === null) {
      if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.noNode'));
      if (!here) S().open(pid, mid);
      return false;
    }
    S().open(pid, mid, { select: path });
    return true;
  }

  /* The id of a node of a map of the project, written on it first if it has
   * none (one step, and in the other map's text when it is not the one shown). */
  function idFor(pid, mid, path) {
    var st = store();
    var m = st && st.map(pid, mid);
    if (!m || readOnly()) return null;
    var c = cur();
    var here = !!c && c.projectId === pid && c.mapId === mid;
    var got = D().ensureId(here ? c.state : D().parse(m.text), path);
    if (!got) return null;
    if (!got.result) return got.id;
    var wrote = here ? apply({ text: got.result.text }, 'editor.label.tag', { select: false }) : st.setMapText(pid, mid, got.result.text);
    return wrote ? got.id : null;
  }

  /* The words that mention a node ([[Map#id|its words]], [[#id|...]] in its
   * own map) or, with no path, a map ([[Map]]). null when it cannot be
   * written (a map name with brackets in it, or no id could be given). */
  function referenceTo(pid, mid, path) {
    var st = store();
    var m = st && st.map(pid, mid);
    var c = cur();
    if (!m || !c) return null;
    var here = c.projectId === pid && c.mapId === mid;
    var name = String(m.name || '').trim();
    if (!here && (/[\[\]|\n]/.test(name) || /#[a-z0-9]{4,12}$/i.test(name))) return null;
    if (path === null || path === undefined) return here ? null : '[[' + name + ']]';
    var state = here ? c.state : D().parse(m.text);
    var entry = D().entryAt(state, path);
    if (!entry) return null;
    var words = D().plainText(entry).replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (words.length > 40) words = words.slice(0, 39) + '\u2026';
    var id = idFor(pid, mid, path);
    if (!id) return null;
    return '[[' + (here ? '' : name) + '#' + id + (words ? '|' + words : '') + ']]';
  }

  /* `count` characters before the caret replaced by `text` (the '@' that
   * asked for a mention becomes the mention). */
  function replaceBefore(count, text, caret) {
    if (!renaming || renaming.done) return false;
    var el = currentField();
    var ty = typingInfo();
    if (!el || !ty) return false;
    var hist = historyOf(el);
    if (hist) hist.record();
    /* `caret`: where the words go when the field has lost its caret (a panel
     * took the focus); else where it is now. */
    var end = typeof caret === 'number' ? Math.min(caret, ty.text.length) : ty.end;
    var from = Math.max(0, (typeof caret === 'number' ? end : ty.start) - Math.max(0, count));
    setField(el, ty.text.slice(0, from) + String(text) + ty.text.slice(end));
    try { el.focus({ preventScroll: true }); } catch (err) { /* gone */ }
    chooseRange(el, from + String(text).length);
    renaming.typed = true;
    placeFormatBarSoon();
    return true;
  }

  /* The words of a node's title replaced (its pictures stay), as one step.
   * opts.ai: the words are the AI's (an icon it chose): who wrote it follows. */
  function setTitle(path, title, label, opts) {
    if (!editable()) return false;
    var c = cur();
    if (path === undefined) path = selected();
    if (path === null || !c || !c.state.byPath[path]) return false;
    var out = D().rename(c.state, path, String(title));
    if (!out) return false;
    if (opts && opts.ai) out = carryBy(out, path, byWithAi(c.state, path));
    return apply(out, label || 'editor.label.rename', { select: path });
  }

  /* The words under a node and/or its title set in one step (what a
   * description of its picture fills in). A missing field is left as it is. */
  function setTexts(path, texts, label, opts) {
    if (!editable()) return false;
    var c = cur();
    var Dc = D();
    if (path === undefined) path = selected();
    if (path === null || !c || !c.state.byPath[path] || !texts) return false;
    var st = c.state;
    var out = null;
    if (texts.body !== undefined && texts.body !== null) {
      out = Dc.setBody(st, path, String(texts.body));
      if (out) st = Dc.parse(out.text);
    }
    if (texts.title !== undefined && texts.title !== null) {
      var named = Dc.rename(st, path, String(texts.title));
      if (named) out = named;
    }
    if (!out) return false;
    if (opts && opts.ai) out = carryBy(out, path, byWithAi(c.state, path));
    return apply({ text: out.text }, label || 'editor.label.rename', { select: path });
  }

  /* Several children made at once, in the order given, each with its title:
   * one edit, so one Undo takes them all back. Returns how many were made.
   * opts.by: each new child marked as written by 'ai' (or 'mixed'). */
  function addChildren(path, titles, label, opts) {
    if (!editable()) return 0;
    var c = cur();
    var Dc = D();
    if (path === undefined) path = selected();
    if (path === null || !c || !c.state.byPath[path]) return 0;
    var state = c.state;
    var result = null;
    var made = 0;
    var by = opts && opts.by;
    (titles || []).forEach(function (title) {
      var next = Dc.addChild(state, path, String(title));
      if (!next) return;
      state = Dc.parse(next.text);
      if (by && next.anchorLine !== undefined) {
        var e = Dc.findByLine(state, next.anchorLine);
        var marked = e ? Dc.setBy(state, e.path, by) : null;
        if (marked) { next = { text: marked.text, anchorLine: next.anchorLine }; state = Dc.parse(marked.text); }
      }
      result = next;
      made++;
    });
    if (!result || !made) return 0;
    var select = opts && opts.selectNew && result.anchorLine !== undefined ? Dc.findByLine(state, result.anchorLine) : null;
    if (!apply({ text: result.text }, label || 'editor.label.addChild', { select: select ? select.path : path })) return 0;
    return made;
  }

  /* A tree of titles ([{title, children}]) added under `path` - or, with
   * path null, as a new top of the map - each marked `by`: one edit, one
   * Undo. Returns how many nodes were made. */
  function addOutline(path, nodes, label, opts) {
    if (!editable()) return 0;
    var c = cur();
    if (!c) return 0;
    if (path !== null && path !== undefined && !c.state.byPath[path]) return 0;
    var got = D().addOutline(c.state, path === undefined ? null : path, nodes, opts && opts.by, opts && opts.max);
    if (!got) return 0;
    var o = typeof path === 'string' ? { select: path } : {};
    if (!apply({ text: got.result.text }, label || 'editor.label.addChild', o)) return 0;
    return got.made;
  }

  /* ---------------------------------------------------------------- putting the writing down and picking it up */

  /* Where the writing is, so it can be picked up again after a change to
   * the document under it. */
  function writingMark() {
    if (!renaming) return null;
    var el = currentField();
    var at = caretOffsets(el);
    return { path: renaming.path, key: renaming.key, field: fieldName(el), start: at ? at.start : null, end: at ? at.end : null };
  }

  function resumeWriting(mark) {
    if (!mark || !editable()) return false;
    var c = cur();
    var path = mark.path;
    if (mark.key !== undefined && c.keys && c.keys[path] !== mark.key) {
      for (var p in c.keys) if (c.keys[p] === mark.key) { path = p; break; }
    }
    if (!c.state.byPath[path]) return false;
    return startRename(path, { field: mark.field, start: mark.start === null ? undefined : mark.start, end: mark.end === null ? undefined : mark.end });
  }

  /* A change to the node's document made from the format bar: what was
   * typed and the change are one step, and the writing goes on where it
   * was. make(state, path) returns a doc edit; then(path), when given, runs
   * inside the same transaction once the edit is written. */
  function formatNode(make, label, then) {
    if (!renaming || !editable()) return false;
    var mark = writingMark();
    var r = renaming;
    r.done = true;
    renaming = null;
    var v = valuesOf(r);
    teardown(r);
    var wrote = false;
    var path = pathNow(r);
    if (path !== null) {
      /* Worked out as one edit: the rename, then the change made on the
       * document the rename produced. */
      var Dc = D();
      var state = cur().state;
      var named = v.titleChanged || v.bodyChanged ? writeLine(state, path, v) : null;
      var res = make(named ? Dc.parse(named.text) : state, path);
      var final = res || named;
      var stepLabel = res ? (label || 'editor.label.format') : 'editor.label.rename';
      if (final) {
        if (res && typeof then === 'function') {
          transaction(stepLabel, function () {
            wrote = apply(final, stepLabel, { select: path });
            if (wrote) then(path);
          }, { from: { selected: path }, to: { selected: path } });
        } else {
          wrote = apply(final, stepLabel, { select: path });
        }
      }
      mark.path = path;
      if (cur() && cur().keys) mark.key = cur().keys[path];
    }
    resumeWriting(mark);
    return wrote;
  }

  /* Before something takes the focus for a while (a file dialog, a
   * drawing): what was typed is saved now, and the writing is picked up
   * again by whoever asked, if they want it. */
  function suspendWriting() {
    if (!renaming) return null;
    var mark = writingMark();
    finishRename(true, { focus: false });
    if (mark && cur() && cur().keys && cur().state.byPath[mark.path]) mark.key = cur().keys[mark.path];
    return mark;
  }

  /* ---------------------------------------------------------------- field events */

  var MARK_KEYS = { b: 'bold', i: 'italic', u: 'underline' };

  function onFieldKey(e) {
    if (!renaming) return;
    if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
    var el = e.currentTarget;
    var inBody = el === renaming.body.el;
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;
    var lower = key && key.length === 1 ? key.toLowerCase() : key;
    var handled = true;
    var undoing = ns.util.undoKey ? ns.util.undoKey(e) : null;

    if (undoing) {
      var hist = historyOf(el);
      if (hist) { if (undoing === 'undo') hist.undo(); else hist.redo(); }
    } else if (key === 'Escape') {
      cancelRename();
    } else if (key === 'Enter') {
      /* In the words under the title Enter breaks the line (and goes on
       * with a list); Ctrl/Cmd+Enter is done, from either field. */
      if (mod && !e.altKey) finishRename(true);
      else if (inBody && e.shiftKey) insertPlain(el, '\n');
      else if (inBody) bodyEnter(el);
      else if (e.shiftKey) moveToField('body', true);
      else finishRename(true);
    } else if (key === 'Tab' && !mod && !e.altKey && !e.shiftKey && ns.aiui && typeof ns.aiui.take === 'function' && ns.aiui.take(e)) {
      /* A suggestion was showing, and Tab took it (ai-ui.js). */
    } else if (key === 'Tab' && !mod && !e.altKey && inBody && onListLine(el) && (bodyIndent(el, e.shiftKey ? -1 : 1) || !e.shiftKey)) {
      /* Tab and Shift+Tab nest a list item and bring it out; a Shift+Tab
       * with nowhere to go goes on to the title, as it always did. */
    } else if (key === 'Tab' && !mod && !e.altKey) {
      if (e.shiftKey) {
        moveToField(inBody ? 'line' : 'body', false);
      } else {
        var path = renaming.path;
        var r = renaming;
        finishRename(true, { focus: false });
        var at = pathNow(r);
        add('child', at !== null ? at : path);
      }
    } else if (mod && !e.altKey && MARK_KEYS[lower] && !e.shiftKey) {
      applyMark(MARK_KEYS[lower]);
    } else if (mod && e.shiftKey && !e.altKey && lower === 'x') {
      applyMark('strike');
    } else if (mod && !e.altKey && (key === '\\' || e.code === 'Backslash')) {
      applyMark('clear');
    } else if (mod && e.altKey && !altGraph(e) && !inBody && /^Digit[0-6]$/.test(e.code || '')) {
      var n = Number(e.code.slice(5));
      setSize(n === 0 ? null : 'h' + n);
    } else if (key === 'F10' && e.altKey && !mod) {
      focusFormatBar();
    } else if (key === 'ArrowDown' && !inBody && !mod && !e.shiftKey && !e.altKey) {
      moveToField('body', true);
    } else if (key === 'ArrowUp' && inBody && !mod && !e.shiftKey && !e.altKey && atFirstLine(el)) {
      moveToField('line', false);
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    /* Typing stays in the field. A modified key goes on to the app (Ctrl+S
     * saves, Ctrl+K opens the palette): its dispatcher only acts on the
     * bindings meant to work inside a text field. */
    if (!mod) e.stopPropagation();
  }

  /* AltGr is Ctrl+Alt on Windows: AltGr+7 is how a German keyboard types
   * '{', which must not become a heading size. */
  function altGraph(e) {
    try { return !!(e.getModifierState && e.getModifierState('AltGraph')); } catch (err) { return false; }
  }

  function atFirstLine(el) {
    var at = caretOffsets(el);
    if (!at) return true;
    return readField(el).slice(0, at.start).indexOf('\n') < 0;
  }

  function moveToField(which, toStart) {
    if (!renaming) return;
    var el = which === 'body' ? renaming.body.el : renaming.title.el;
    renaming.field = which;
    renaming.held++;
    try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    renaming.held--;
    var len = readField(el).length;
    chooseRange(el, toStart ? 0 : len);
    placeFormatBar();
  }

  /* The browser's own formatting and line building never reach the field:
   * Enter is handled above, and what a virtual keyboard sends without a
   * keydown (Android) is caught here. */
  function onBeforeInput(e) {
    if (!renaming) return;
    var type = e.inputType || '';
    var el = e.currentTarget;
    if (/^format/.test(type)) { e.preventDefault(); return; }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      e.preventDefault();
      if (el !== renaming.body.el) finishRename(true);
      else if (type === 'insertLineBreak') insertPlain(el, '\n');
      else bodyEnter(el);
      return;
    }
    if (type === 'insertFromDrop' || type === 'insertFromPasteAsQuotation') { e.preventDefault(); return; }
    var hist = historyOf(el);
    if (!hist) return;
    if (type === 'historyUndo' || type === 'historyRedo') {
      e.preventDefault();
      if (type === 'historyUndo') hist.undo(); else hist.redo();
      return;
    }
    hist.before(type);
  }

  function onFieldInput(e) {
    if (!renaming) return;
    var hist = historyOf(e.currentTarget);
    if (hist) hist.after();
    normalize(e.currentTarget);
    resetScroll();
    renaming.typed = true;
    placeFormatBarSoon();
    emit('editor:typed', { path: renaming.path, field: fieldName(e.currentTarget) });
  }

  /* Words typed past the edge of the free map (the stage less the chrome
   * floating over it: the docked format bar and the thumb bar on a phone,
   * a keyboard iOS lays over the page): the camera follows (at once - the
   * keyboard is driving). The whole node is kept in sight when it fits,
   * else the caret. */
  function keepCaretInView() {
    if (!renaming || !renaming.typed || !view) return;
    renaming.typed = false;
    var box = freeBox();
    var margin = cssPx(formatBar, '--bar-margin', 8);
    var range = rangeIn(currentField());
    var r = range ? range.getBoundingClientRect() : null;
    if (!r || (!r.width && !r.height)) r = currentField().getBoundingClientRect();
    /* Measured where the node comes to rest: a node just added is still
     * flying in from its parent, and its drawn box is not where it lands. */
    var drawn = renaming.el.getBoundingClientRect();
    var laid = view.rect(renaming.path) || drawn;
    var ox = laid.left - drawn.left;
    var oy = laid.top - drawn.top;
    r = { left: r.left + ox, right: r.right + ox, top: r.top + oy, bottom: r.bottom + oy };
    if (drawn.width <= box.right - box.left - 2 * margin && drawn.height <= box.bottom - box.top - 2 * margin) {
      r = { left: laid.left, right: laid.left + drawn.width, top: laid.top, bottom: laid.top + drawn.height };
    }
    var dx = 0;
    var dy = 0;
    if (r.right > box.right - margin) dx = box.right - margin - r.right;
    else if (r.left < box.left + margin) dx = box.left + margin - r.left;
    if (r.bottom > box.bottom - margin) dy = box.bottom - margin - r.bottom;
    else if (r.top < box.top + margin) dy = box.top + margin - r.top;
    if (!dx && !dy) return;
    var c = view.camera();
    view.setCamera({ x: c.x + dx, y: c.y + dy, k: c.k });
  }

  /* The part of the stage the map can be seen in, in window pixels. */
  function freeBox() {
    var b = stageBox();
    var ins = chromeInsets();
    return { left: b.left + ins.left, right: b.right - ins.right, top: b.top + ins.top, bottom: b.bottom - ins.bottom };
  }

  /* A node written at reading size on a narrow screen would grow past its
   * edge (a long name at 16 px is wider than a phone): while it is being
   * written it wraps at the width the screen has for it. */
  function fitWidth(r) {
    var k = view.camera().k;
    var box = freeBox();
    var margin = cssPx(formatBar, '--bar-margin', 8);
    var room = (box.right - box.left - 2 * margin) / (k || 1);
    var natural = parseFloat(getComputedStyle(r.el).maxWidth);
    if (room > 0 && (!(natural > 0) || natural > room)) {
      r.el.style.maxWidth = Math.floor(room) + 'px';
      r.narrowed = true;
    }
  }

  /* Words arrive as words: the title takes one line, the text under it its
   * lines. A picture on the clipboard is a file for the media module. */
  function onPaste(e) {
    if (!renaming || !e.clipboardData) return;
    var el = e.currentTarget;
    var files = Array.prototype.slice.call(e.clipboardData.files || []);
    if (files.length) {
      e.preventDefault();
      e.stopPropagation();
      handFiles(files);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    var text = e.clipboardData.getData('text/plain') || '';
    text = String(text).replace(/\r\n?/g, '\n');
    if (el === renaming.title.el) text = text.replace(/\s+/g, ' ');
    else text = text.replace(/[\t ]+/g, ' ').replace(/\n{2,}/g, '\n');
    insertPlain(el, text);
  }

  /* Pictures pasted on the words go to the media module, which puts them in
   * this node's field; the writing is picked up when it is done (or
   * cancelled). Without the media module they are simply not taken. */
  function handFiles(files) {
    if (!ns.media || typeof ns.media.addFiles !== 'function') return;
    var mark = suspendWriting();
    if (!mark) return;
    var back = function () { resumeWriting(mark); };
    try {
      Promise.resolve(ns.media.addFiles(files, { path: mark.path, field: mark.field })).then(back, back);
    } catch (err) { back(); }
  }

  function onFieldDrop(e) {
    e.preventDefault();
    var dropped = e.dataTransfer ? Array.prototype.slice.call(e.dataTransfer.files || []) : [];
    if (dropped.length) {
      /* Files go on to the app's drop handling (media puts pictures into
       * the node under the pointer - this one - and imports the rest).
       * What was typed is written first, so that edit lands on it. */
      if (renaming) finishRename(true, { focus: false });
      return;
    }
    e.stopPropagation();
    var text = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (text && renaming) insertPlain(e.currentTarget, renaming && e.currentTarget === renaming.title.el ? text.replace(/\s+/g, ' ') : text);
  }

  function onFieldFocus(e) {
    if (!renaming) return;
    renaming.field = fieldName(e.currentTarget);
    placeFormatBarSoon();
  }

  /* Leaving the box saves; leaving one field for the other does not, nor
   * does the window losing focus (the page being left is handled by the
   * 'flush' the app sends), nor a format menu taking the keyboard for a
   * moment (held). */
  function onFieldBlur(e) {
    var r = renaming;
    if (!r || r.done || r.held > 0) return;
    var to = e.relatedTarget;
    if (to === r.title.el || to === r.body.el) return;
    if (to && formatBar && formatBar.contains(to)) return;
    if (!to && !document.hasFocus()) return;
    finishRename(true, { focus: false });
  }

  /* A press anywhere else ends the writing before whatever it pressed acts
   * (Safari moves no focus to a pressed button, and an undo pressed while
   * writing must not run against a document the rename has not reached). */
  function onDocPointerDown(e) {
    var r = renaming;
    if (!r || r.done) return;
    var target = e.target;
    if (!target || !target.closest) return;
    if (r.el.contains(target)) return;
    if (formatBar && formatBar.contains(target)) return;
    if (r.held > 0 && target.closest('#layers')) return;
    finishRename(true, { focus: false });
  }

  /* A press inside the node being written, but not on a field (its padding,
   * a picture), and the mouse events a browser makes up after a tap, must
   * not move the focus to the map: that would end the writing the tap just
   * started. */
  function onDocMouseDown(e) {
    var r = renaming;
    if (!r || r.done || !e.target || !r.el.contains(e.target)) return;
    if (r.title.el.contains(e.target) || r.body.el.contains(e.target)) return;
    e.preventDefault();
  }

  /* ---------------------------------------------------------------- marks and formats */

  function applyMark(name) {
    if (!renaming) return false;
    var el = fieldOfRange() || currentField();
    var r = rangeIn(el);
    if (!r) return false;
    var text = readField(el);
    var at = offsetsOf(el, r);
    if (name !== 'clear' && at.end <= at.start) return false;
    var Dc = D();
    var next;
    if (name === 'clear') next = Dc.clearMarks(text, at.start, at.end);
    else if (name === 'strike') next = toggleStrike(text, at.start, at.end);
    else next = Dc.toggleMark(text, at.start, at.end, name);
    if (!next || next.text === text) return false;
    var hist = historyOf(el);
    if (hist) hist.record();
    setField(el, next.text);
    chooseRange(el, next.start, next.end);
    formatHidden = false;
    placeFormatBar();
    return true;
  }

  function setSize(size) {
    return formatNode(function (state, path) {
      var Dc = D();
      if (size === 'caption') return Dc.roleAt(state, path) === 'caption' ? Dc.setRole(state, path, null) : Dc.setRole(state, path, 'caption');
      return Dc.setTitleSize(state, path, size);
    });
  }

  function setBodyRole(role) {
    return formatNode(function (state, path) {
      return D().setBodyRole(state, path, role === 'paragraph' ? null : role);
    });
  }

  function placePicture(kind, where) {
    var field = renaming ? fieldName(currentField()) : 'line';
    return formatNode(function (state, path) {
      return D().setImagePosition(state, path, where, field, kind === 'draw' ? D().DRAW : D().PHOTO);
    });
  }

  /* The picture out of the box and its file into the trash, in one step. */
  function takePictureOut(kind) {
    if (!renaming) return false;
    var Dc = D();
    var field = fieldName(currentField());
    var k = kind === 'draw' ? Dc.DRAW : Dc.PHOTO;
    var st = store();
    var label = kind === 'draw' ? 'editor.label.drawingOut' : 'store.label.takePictureOut';
    var gone = null;
    var owner = '';
    return formatNode(function (state, path) {
      gone = Dc.lastImagePath(state, path, field, k);
      owner = Dc.plainText(state.byPath[path]);
      return Dc.removeImage(state, path, field, k);
    }, label, function (path) {
      /* The text has lost the picture; its file goes to the trash in the
       * same transaction, so the two are one step. */
      var c = cur();
      if (gone && c && st && typeof st.trashFigure === 'function') {
        st.trashFigure(c.projectId, c.mapId, { path: gone, ownerPath: path, field: field, owner: owner });
      }
    });
  }

  /* The drawing out from the format bar: asked first (media.askDrawingOut),
   * the writing held while the question is open (its focus is not leaving
   * the node), and taken up again where it was when the answer is Cancel. */
  function askThenTakeDrawingOut() {
    var M = ns.media;
    if (!renaming) return false;
    if (!M || typeof M.askDrawingOut !== 'function') return takePictureOut('draw');
    var r = renaming;
    var mark = writingMark();
    r.held++;
    M.askDrawingOut().then(function (ok) { return ok; }, function () { return false; }).then(function (ok) {
      r.held = Math.max(0, r.held - 1);
      if (renaming !== r || r.done) return;
      if (ok) takePictureOut('draw');
      else focusField({ field: mark.field, start: mark.start === null ? undefined : mark.start, end: mark.end === null ? undefined : mark.end });
    });
    return true;
  }

  function addPicture() {
    if (!renaming || !ns.media || typeof ns.media.pickImages !== 'function') return false;
    var mark = suspendWriting();
    if (!mark) return false;
    var back = function () { resumeWriting(mark); };
    try {
      Promise.resolve(ns.media.pickImages({ path: mark.path, field: mark.field })).then(back, back);
    } catch (err) { back(); }
    return true;
  }

  function addDrawing() {
    if (!renaming) return false;
    var mark = suspendWriting();
    if (!mark) return false;
    return mediaCommand('media.draw', { source: 'editor', path: mark.path, field: mark.field });
  }

  /* ================================================================ the node toolbar */

  function stageBox() { return stage.getBoundingClientRect(); }

  function chromeInsets() {
    try {
      if (ns.shell && typeof ns.shell.insets === 'function') return ns.shell.insets();
    } catch (err) { /* no shell */ }
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  function preventFocusSteal(el) {
    /* The map keeps the keyboard: pressing a bar button must not take the
     * focus (or, while writing, the caret) away from where it is. */
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button') && e.button <= 0) e.preventDefault();
    });
    el.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('button')) e.preventDefault();
    });
  }

  function cmdButton(id, icon, extra) {
    var C = ns.commands;
    var cmd = C ? C.get(id) : null;
    var b = ns.ui.button({
      icon: icon,
      label: C ? C.title(id, { source: 'toolbar' }) : id,
      shortcut: cmd && cmd.keys && cmd.keys.length ? cmd.keys : null,
      command: id,
      cls: extra || null,
      onClick: function (e) {
        if (C) C.run(id, { source: 'toolbar', event: e, anchor: b });
        placeToolbar();
      }
    });
    return b;
  }

  function grip() {
    var g = h('span', { class: 'bar-grip', 'aria-hidden': 'true' });
    g.appendChild(ns.ui.icon('drag-grip'));
    return g;
  }

  function buildToolbar() {
    toolbar = h('div', {
      class: 'node-toolbar capsule glass',
      role: 'toolbar',
      'aria-label': t('editor.toolbar'),
      'data-i18n-aria-label': 'editor.toolbar',
      hidden: true
    });
    var g = grip();
    toolbar.appendChild(g);
    /* On a root, two ways to grow it: a branch on its left, one on its
     * right (in place of 'add a child'). */
    tb.left = cmdButton('node.addLeft', 'branch-left');
    tb.right = cmdButton('node.addRight', 'branch-right');
    tb.child = cmdButton('node.addChild', 'child');
    tb.sibling = cmdButton('node.addSibling', 'sibling');
    tb.rename = cmdButton('node.rename', 'rename');
    tb.color = cmdButton('node.color', 'color', 'node-toolbar__color');
    tb.color.setAttribute('aria-haspopup', 'dialog');
    tb.color.setAttribute('aria-expanded', 'false');
    tb.color.textContent = '';
    tb.color.appendChild(h('span', { class: 'chip', 'aria-hidden': 'true' }));
    tb.note = cmdButton('node.note', 'note');
    tb.edgeNote = cmdButton('node.edgeNote', 'edge-note');
    tb.image = cmdButton('media.image', 'image');
    tb.draw = cmdButton('media.draw', 'draw');
    tb.task = cmdButton('node.task', 'task');
    tb.link = cmdButton('node.openLink', 'link');
    tb.ai = cmdButton('ai.menu', 'sparkles');
    tb.more = ns.ui.button({ icon: 'more', label: t('editor.cmd.more'), cls: 'btn--more', onClick: function () { openMore(tb.more); } });
    tb.more.setAttribute('aria-haspopup', 'menu');
    tb.more.setAttribute('aria-expanded', 'false');
    ['left', 'right', 'child', 'sibling', 'rename', 'color', 'note', 'edgeNote', 'image', 'draw', 'task', 'link', 'ai', 'more'].forEach(function (k) {
      toolbar.appendChild(tb[k]);
    });
    preventFocusSteal(toolbar);
    floaters.appendChild(toolbar);
    if (ns.float) {
      ns.float.attach(toolbar, g);
      ns.float.onAnchor(toolbar, placeToolbar);
    }
    if (ns.ui.roving) tb.roving = ns.ui.roving(toolbar);
  }

  function setShown(b, on) { if (b && b.hidden === on) b.hidden = !on; }
  function setEnabled(b, on) {
    if (!b) return;
    if (on) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
  }

  /* The buttons follow the selection, whatever the geometry says. */
  function updateToolbar() {
    if (!toolbar) return;
    var C = ns.commands;
    var path = selected();
    var ctx = { source: 'toolbar' };
    ['left', 'right', 'child', 'sibling', 'rename', 'color', 'note', 'edgeNote', 'image', 'draw', 'task', 'link', 'ai'].forEach(function (k) {
      var b = tb[k];
      var id = b.getAttribute('data-command');
      if (!C.has(id)) return;
      setEnabled(b, C.enabled(id, ctx));
      var label = C.title(id, ctx);
      if (b.getAttribute('aria-label') !== label) {
        b.setAttribute('aria-label', label);
        ns.ui.tooltip(b, label, (C.get(id) || {}).keys);
      }
    });
    setShown(tb.link, linksOf(path).length > 0);
    /* The AI button is there only once the person has switched the feature on. */
    setShown(tb.ai, C.has('ai.menu') && C.enabled('ai.menu', ctx));
    /* On a root: a branch on the left, one on the right. On the one root
     * Enter adds a child, which those buttons do. */
    var root = treeRoot(path);
    setShown(tb.left, root);
    setShown(tb.right, root);
    setShown(tb.child, !root);
    setShown(tb.sibling, !loneRoot(path));
    setShown(tb.task, canBeTask(path));
    if (tb.task) tb.task.setAttribute('aria-pressed', String(!!(entryOf(path) && entryOf(path).task !== null && entryOf(path).task !== undefined)));
    setShown(tb.image, C.has('media.image'));
    setShown(tb.draw, C.has('media.draw'));
    var hex = colorOf(path);
    if (hex) tb.color.style.setProperty('--chip', hex);
    if (tb.roving) tb.roving.refresh();
  }

  function hideToolbar() {
    if (toolbar && !toolbar.hidden) toolbar.hidden = true;
  }

  function toolbarWanted() {
    if (!toolbar || !view || readOnly() || compact()) return false;
    if (renaming || dragging || gesture !== 'idle') return false;
    if (ns.notes && ns.notes.isOpen && ns.notes.isOpen()) return false;
    /* The node's menu is open: one layer of chrome at a time. */
    if (contextHandle) return false;
    return hasSel();
  }

  /* Above the node, else below, else on the roomier side; never over its
   * words; centred on it and clamped inside the stage, clear of the top
   * capsules and the zoom bar floating over it. Of the sides that fit, the one covering
   * less of the other nodes wins (above on a tie): a capsule over the
   * sibling just above would take the very node a hand reaches for next.
   * When every place near the node would hide another one (a dense map
   * seen whole), the bar docks to the stage edge nearer the node, centred
   * like a contextual bar; the node's selection halo says whose bar it is.
   * A bar moved by hand stays where the hand left it until another node is
   * chosen. */
  function placeToolbar() {
    if (!toolbar) return;
    if (!toolbarWanted()) { hideToolbar(); return; }
    var path = selected();
    var rect = view.rect(path);
    var box = stageBox();
    if (!rect || rect.bottom < box.top || rect.top > box.bottom || rect.right < box.left || rect.left > box.right) {
      hideToolbar();
      return;
    }
    /* The states are asked when something they depend on changed, not on
     * every frame of a camera glide. */
    if (toolbarDirty || toolbar.hidden || toolbarShownFor !== path) {
      toolbarDirty = false;
      updateToolbar();
    }
    toolbar.toggleAttribute('data-instant', lastInput === 'key' || toolbarShownFor === path);
    if (toolbar.hidden) toolbar.hidden = false;
    toolbarShownFor = path;
    if (ns.float && ns.float.moved(toolbar)) return;
    var p = barPosition(toolbar, rect, box, true, path, true);
    toolbar.style.left = p.left + 'px';
    toolbar.style.top = p.top + 'px';
    toolbar.setAttribute('data-side', p.side);
    toolbar.toggleAttribute('data-docked', !!p.docked);
    toolbar.style.setProperty('--origin-x', Math.round(p.originX) + 'px');
  }

  /* How many rows of nodes a bar may be moved past to find a place that
   * hides none of them. */
  var HOPS = 3;
  /* How far a bar may reach into another node's box and still be said to
   * leave it free: a pixel, the rounding of a box laid out at a fractional
   * zoom. Anything more takes some of the box's clicks. */
  var SLIVER = 1;

  /* avoid: the path of the node the bar is for, when the bar should keep
   * off the other nodes (null: no such care). dock: the node toolbar, which
   * may also stand beside the node and, when no place near it is free,
   * leave it for the stage edge; the format bar stays by the words being
   * written, where the eye is. */
  function barPosition(el, rect, box, noOverlap, avoid, dock) {
    var ins = chromeInsets();
    var margin = cssPx(el, '--bar-margin', 8);
    var gap = cssPx(el, '--bar-gap', 8);
    var size = drawnSize(el);
    var w = size.w;
    var hgt = size.h;
    var minTop = Math.max(margin, ins.top);
    var maxBottom = box.height - Math.max(margin, ins.bottom);
    var left = rect.left - box.left + rect.width / 2 - w / 2;
    left = Math.max(margin, Math.min(left, box.width - w - margin));
    /* The first place above and below the node, kept inside the band
     * between the top capsules and the chrome at the foot: a node standing
     * beside a capsule (a map panned under it, a panel opened over a
     * fitted map) has its bar moved further from it, never onto the
     * capsule. Moved away from the node, so never over its words. */
    var above = Math.min(rect.top - box.top - hgt - gap, maxBottom - hgt);
    var below = Math.max(rect.bottom - box.top + gap, minTop);
    var side;
    var top;
    var docked = false;
    var fitsAbove = above >= minTop;
    var fitsBelow = below + hgt <= maxBottom;
    var careful = avoid !== null && avoid !== undefined && !!view && !!view.nodesIn;
    var best = careful ? leastCovering() : null;
    if (careful && dock && (!best || best.count)) best = atEdge() || best;
    if (best) { left = best.left; top = best.top; side = best.side; docked = !!best.docked; }
    else if (fitsAbove) { top = above; side = 'top'; }
    else if (fitsBelow) { top = below; side = 'bottom'; }
    else if (noOverlap) {
      var roomAbove = rect.top - box.top;
      var roomBelow = box.bottom - rect.bottom;
      if (roomAbove >= roomBelow) { top = above; side = 'top'; } else { top = below; side = 'bottom'; }
    } else {
      top = Math.max(minTop, Math.min(above, maxBottom - hgt));
      side = 'top';
    }
    var originX = rect.left - box.left + rect.width / 2 - left;
    return { left: Math.round(left), top: Math.round(top), side: side, docked: docked, originX: Math.max(0, Math.min(w, originX)) };

    /* In a dense map the node above and the node below are both a bar's
     * height away: centred over the node the bar hides a sibling and takes
     * its clicks. So a few places are weighed - above and below, centred or
     * lined up with either end of the node, (for the toolbar, sides)
     * beside it, and, when the first row above or below meets other nodes,
     * further out past them, a row at a time. A place that hides no other
     * node wins over one that hides even a corner of one; then the one
     * nearer the node; ties go to the earlier, more usual place. */
    function leastCovering() {
      var nodeLeft = rect.left - box.left;
      var nodeRight = rect.right - box.left;
      /* Centred, lined up with either end of the node, and half a bar
       * further out either way (still over the node's own column). */
      var lefts = [left, nodeLeft, nodeRight - w, nodeLeft - w / 2, nodeRight - w / 2];
      var seen = {};
      lefts = lefts.map(function (l) { return Math.round(Math.max(margin, Math.min(l, box.width - w - margin))); })
        .filter(function (l) { if (seen[l]) return false; seen[l] = true; return true; });
      var mids = [];
      if (dock) {
        var mid = rect.top - box.top + rect.height / 2 - hgt / 2;
        mid = Math.max(minTop, Math.min(mid, maxBottom - hgt));
        if (nodeRight + gap + w <= box.width - margin) mids.push({ left: nodeRight + gap, top: mid, side: 'right' });
        if (nodeLeft - gap - w >= margin) mids.push({ left: nodeLeft - gap - w, top: mid, side: 'left' });
      }
      /* The nodes near any of the places, found once (a big map is
       * thousands of nodes, and the format bar asks on every key typed):
       * the band of the stage the bar's places could take. */
      var x0 = Math.min.apply(null, lefts);
      var x1 = Math.max.apply(null, lefts) + w;
      mids.forEach(function (c) { x0 = Math.min(x0, c.left); x1 = Math.max(x1, c.left + w); });
      var near = view.nodesIn({ left: box.left + x0, top: box.top + minTop, right: box.left + x1, bottom: box.top + maxBottom })
        .filter(function (r) { return r.path !== avoid; })
        /* The capsules count as much as a node, without a node's pixel of
         * slack: a bar reaching onto one is drawn under it (and a banner
         * hangs below the band the insets give). */
        .concat(chromeBoxes(box).map(function (c) {
          return { left: box.left + c.left - SLIVER, top: box.top + c.top - SLIVER, right: box.left + c.right + SLIVER, bottom: box.top + c.bottom + SLIVER };
        }));
      var list = [];
      var add = function (c, extra) {
        /* Weighed where it will be drawn: whole pixels. */
        c.left = Math.round(c.left);
        c.top = Math.round(c.top);
        var hit = coverage(near, box, c.left, c.top, w, hgt);
        c.count = hit.count;
        c.score = (hit.count ? 1e6 + hit.count * 1e5 + hit.area : 0) + extra * 20 + list.length;
        list.push(c);
        return hit;
      };
      lefts.forEach(function (l) {
        if (fitsAbove) {
          var top = above;
          for (var i = 0; i <= HOPS && top >= minTop; i++) {
            var hit = add({ left: l, top: top, side: 'top' }, above - top);
            if (!hit.count) break;
            top = hit.top - gap - hgt;
          }
        }
        if (fitsBelow) {
          var bt = below;
          for (var j = 0; j <= HOPS && bt + hgt <= maxBottom; j++) {
            var hitB = add({ left: l, top: bt, side: 'bottom' }, bt - below);
            if (!hitB.count) break;
            bt = hitB.bottom + gap;
          }
        }
      });
      mids.forEach(function (c) { add(c, 0); });
      var pick = null;
      for (var k = 0; k < list.length; k++) if (!pick || list[k].score < pick.score) pick = list[k];
      return pick;
    }

    /* Nowhere near the node is free: the bar docks to the stage edge
     * nearer the node, centred like a contextual bar. At that edge the row
     * just inside the chrome (under the top capsules, above the zoom bar)
     * is tried before the chrome's own row, between its capsules. A row
     * whose middle leaves every node (the chosen one included) and every
     * capsule free wins; when no middle is free, the row where the bar
     * slides least along the edge to find room. The far edge, a screen
     * away from the node, only when the near one has no room at all. Null
     * when neither has: then the place near the node hiding the least
     * stays. */
    function atEdge() {
      var chrome = chromeBoxes(box);
      var lo = Math.ceil(Math.max(margin, ins.left));
      var hi = Math.floor(box.width - Math.max(margin, ins.right) - w);
      if (hi < lo) return null;
      var own = { left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top, slack: 0 };
      var want = (lo + hi) / 2;
      var mid = rect.top - box.top + rect.height / 2;
      var edges = mid - minTop <= maxBottom - mid ? ['top', 'bottom'] : ['bottom', 'top'];
      for (var e = 0; e < edges.length; e++) {
        var pick = alongEdge(edges[e]);
        if (pick) return pick;
      }
      return null;

      function alongEdge(edge) {
        var inside = edge === 'top' ? minTop : maxBottom - hgt;
        var ys = [inside];
        var row = chromeRow(chrome, edge, edge === 'top' ? minTop : maxBottom, hgt);
        if (row !== null) {
          row = Math.max(margin, Math.min(row, box.height - margin - hgt));
          if (Math.abs(row - inside) >= 1) ys.push(row);
        }
        var best = null;
        for (var i = 0; i < ys.length; i++) {
          var y = Math.round(ys[i]);
          if (y < margin - 0.5 || y + hgt > box.height - margin + 0.5) continue;
          var walls = view.nodesIn({ left: box.left, top: box.top + y, right: box.left + box.width, bottom: box.top + y + hgt })
            .filter(function (r) { return r.path !== avoid; })
            .map(function (r) { return { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top, slack: SLIVER }; })
            .concat([own], chrome);
          var x = freeLeft(walls, y, lo, hi, want);
          if (x === null) continue;
          var slide = Math.abs(x - want);
          if (!best || slide < best.slide) best = { left: x, top: y, side: edge, docked: true, count: 0, slide: slide };
          if (slide <= 1) break;
        }
        return best;
      }
    }

    /* The left nearest to `want`, within lo..hi, at which a bar in the row
     * at y meets none of the walls (each allowed its slack), or null. */
    function freeLeft(walls, y, lo, hi, want) {
      var shut = [];
      walls.forEach(function (r) {
        var s = r.slack || 0;
        if (Math.min(y + hgt, r.bottom - s) - Math.max(y, r.top + s) <= 0) return;
        /* A bar at x meets the wall when x is strictly between these. */
        shut.push([Math.floor(r.left + s - w), Math.ceil(r.right - s)]);
      });
      shut.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [];
      shut.forEach(function (iv) {
        var last = merged[merged.length - 1];
        if (last && iv[0] < last[1]) last[1] = Math.max(last[1], iv[1]);
        else merged.push(iv.slice());
      });
      var open = function (x) {
        if (x < lo || x > hi) return false;
        for (var k = 0; k < merged.length; k++) if (x > merged[k][0] && x < merged[k][1]) return false;
        return true;
      };
      var target = Math.round(Math.max(lo, Math.min(want, hi)));
      var tries = [target, lo, hi];
      merged.forEach(function (iv) { tries.push(iv[0], iv[1]); });
      var pick = null;
      tries.forEach(function (x) {
        if (open(x) && (pick === null || Math.abs(x - want) < Math.abs(pick - want))) pick = x;
      });
      return pick;
    }
  }

  /* The bar's own size, whole pixels rounded up (offsetWidth rounds to
   * the nearest, and half a pixel more would reach into a neighbour), and
   * free of the scale it grows in with. */
  function drawnSize(el) {
    var cs = getComputedStyle(el);
    var w = parseFloat(cs.width);
    var hh = parseFloat(cs.height);
    if (cs.boxSizing !== 'border-box' || !(w > 0) || !(hh > 0)) return { w: el.offsetWidth, h: el.offsetHeight };
    return { w: Math.ceil(w - 0.01), h: Math.ceil(hh - 0.01) };
  }

  /* What floats over the stage and takes clicks there (the top bar's slots
   * and capsules, a banner under them, the zoom bar, the thumb bar), in
   * stage px: a docked bar keeps off all of it. */
  function chromeBoxes(box) {
    var out = [];
    var els = document.querySelectorAll('#topbar .topbar__slot, #topbar .topbar__slot > *, #banners > *, #zoombar, #thumbbar');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hidden || !el.getClientRects().length) continue;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom) continue;
      out.push({ left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top, slack: 0 });
    }
    return out;
  }

  /* The top of a bar standing in the chrome's own row at that edge (lined
   * up with the capsules' middle), or null when no capsule floats there. */
  function chromeRow(chrome, edge, limit, hgt) {
    var sum = 0;
    var n = 0;
    chrome.forEach(function (c) {
      if (edge === 'top' ? c.bottom > limit + 1 : c.top < limit - 1) return;
      sum += (c.top + c.bottom) / 2;
      n++;
    });
    return n ? sum / n - hgt / 2 : null;
  }

  /* How many of the nodes near a bar placed there would be hidden (a
   * sliver at the edge of a box does not count), how much of them, and how
   * far up and down the hidden ones reach - where to try next. The place is
   * in stage px, the nodes in window px. */
  function coverage(near, box, left, top, w, hh) {
    var out = { count: 0, area: 0, top: Infinity, bottom: -Infinity };
    var x = box.left + left;
    var y = box.top + top;
    for (var i = 0; i < near.length; i++) {
      var r = near[i];
      var ox = Math.min(x + w, r.right - SLIVER) - Math.max(x, r.left + SLIVER);
      if (ox <= 0) continue;
      var oy = Math.min(y + hh, r.bottom - SLIVER) - Math.max(y, r.top + SLIVER);
      if (oy <= 0) continue;
      out.count++;
      out.area += ox * oy;
      if (r.top < out.top) out.top = r.top;
      if (r.bottom > out.bottom) out.bottom = r.bottom;
    }
    out.top -= box.top;
    out.bottom -= box.top;
    return out;
  }

  /* ---------------------------------------------------------------- menus: more, context */

  function item(id, opts) {
    var C = ns.commands;
    var cmd = C.get(id);
    if (!cmd) return null;
    opts = opts || {};
    var ctx = { source: 'menu', anchor: opts.anchor || null, point: opts.point || null };
    if (opts.hideDisabled && !C.enabled(id, ctx)) return null;
    return {
      label: opts.label || C.title(id, ctx),
      icon: opts.icon || cmd.icon,
      shortcut: cmd.keys && cmd.keys.length ? cmd.keys : null,
      danger: !!opts.danger,
      checked: opts.checked,
      disabled: !C.enabled(id, ctx),
      onSelect: function () { C.run(id, ctx); }
    };
  }

  /* The picture picked on this node, if any (view.pickImage). */
  function pickedOn(path) {
    if (!view || typeof view.picked !== 'function' || path === null || path === undefined) return null;
    var p = view.picked();
    return p && p.path === String(path) ? p : null;
  }

  function removePicture(path, pic) {
    if (!editable() || !ns.media || typeof ns.media.takePictureOut !== 'function') return false;
    var kind = pic.kind === 'draw' ? 'draw' : 'photo';
    /* ask: a whole drawing is confirmed first (media.askDrawingOut); a
     * picture goes at once, with its Undo toast. */
    Promise.resolve(ns.media.takePictureOut(path, pic.field, kind, pic.file || pic.path, { ask: true })).then(function (ok) {
      if (ok && view && typeof view.pickImage === 'function') view.pickImage(null);
    });
    return true;
  }

  /* What can be taken off a node besides the node itself: each of its
   * pictures and drawings (by name when there are several of a kind), its
   * note and the note on the link that reaches it. Each is one step with
   * Undo; pictures and drawings go to the project's trash. */
  function removalItems(path) {
    if (readOnly() || path === null || path === undefined) return [];
    var out = [];
    var M = ns.media;
    var pics = M && typeof M.picturesOf === 'function' ? M.picturesOf(path) : [];
    var many = { draw: 0, photo: 0 };
    pics.forEach(function (p) { many[p.kind]++; });
    pics.forEach(function (p) {
      var draw = p.kind === 'draw';
      var key = draw ? 'editor.cmd.removeDrawing' : 'editor.cmd.removePicture';
      out.push({
        label: many[p.kind] > 1 ? t(key + 'Named', { name: p.name }) : t(key),
        icon: draw ? 'draw-off' : 'image-off', danger: true,
        onSelect: function () { removePicture(path, p); }
      });
    });
    var e = entryOf(path);
    var N = ns.notes;
    if (e && e.notes && e.notes.node && N && typeof N.remove === 'function') {
      out.push({ label: t('editor.cmd.deleteNote'), icon: 'trash', danger: true, onSelect: function () { N.remove(path, 'node'); } });
    }
    if (e && e.notes && e.notes.edge && N && typeof N.remove === 'function') {
      out.push({ label: t('editor.cmd.deleteEdgeNote'), icon: 'trash', danger: true, onSelect: function () { N.remove(path, 'edge'); } });
    }
    return out;
  }

  function moreItems(anchor) {
    var path = selected();
    var e = entryOf(path);
    var list = [
      loneRoot(path) ? null : item('node.addSiblingBefore'),
      loneRoot(path) ? null : '-',
      item('node.indent'), item('node.outdent'), item('node.moveUp'), item('node.moveDown'),
      item('node.sideLeft', { hideDisabled: true }), item('node.sideRight', { hideDisabled: true }),
      item('node.mention', { hideDisabled: true }), item('node.mentionedBy', { hideDisabled: true }), item('node.detach', { hideDisabled: true }), item('node.attach', { hideDisabled: true }), item('node.tidy', { hideDisabled: true }),
      '-',
      hasKids(path) ? item('node.fold', { label: view && view.isFolded(path) ? t('editor.cmd.unfoldIt') : t('editor.cmd.foldIt'), icon: view && view.isFolded(path) ? 'unfold' : 'fold' }) : null,
      item('node.dice', { checked: !!prefGet('diceColors', false) }),
      canBeTask(path) ? item('node.task', { label: e && e.task !== null && e.task !== undefined ? t('editor.cmd.taskOff') : t('editor.cmd.taskOn') }) : null,
      item('node.copyBranch', { anchor: anchor }),
      treeRoot(path) ? item('map.splitBranches', { hideDisabled: true }) : item('node.toMap', { hideDisabled: true }),
      '-'
    ].concat(removalItems(path), [
      item('node.delete', { danger: true })
    ]);
    return list;
  }

  function openMore(anchor) {
    if (!hasSel()) return;
    ns.ui.menu(anchor, moreItems(anchor), { align: 'end', label: t('editor.cmd.menu'), title: t('editor.cmd.menu') });
  }

  /* The AI's entries are in a node's menu once something of it is switched on. */
  function aiOn() { var C = ns.commands; return !!C && C.has('ai.menu') && C.enabled('ai.menu', { source: 'menu' }); }

  function nodeMenuItems(path, point) {
    var e = entryOf(path);
    var ro = readOnly();
    var folded = view && view.isFolded(path);
    var links = linksOf(path);
    var linkItems = links.map(function (l) {
      return { label: t('editor.cmd.openLinkTo', { text: l.text || l.href }), icon: l.kind === 'map' ? 'map' : 'external', onSelect: function () { openLink(l.href, l.kind); } };
    });
    var fold = hasKids(path) ? item('node.fold', { label: folded ? t('editor.cmd.unfoldIt') : t('editor.cmd.foldIt'), icon: folded ? 'unfold' : 'fold' }) : null;
    if (ro) {
      return [].concat(linkItems, [
        linkItems.length ? '-' : null,
        fold,
        e && e.notes && e.notes.node ? item('node.note') : null
      ]);
    }
    var root = treeRoot(path);
    return [
      root ? item('node.addLeft') : item('node.addChild'),
      root ? item('node.addRight') : null,
      loneRoot(path) ? null : item('node.addSibling'), loneRoot(path) ? null : item('node.addSiblingBefore'),
      item('node.rename'),
      '-',
      item('node.color', { point: point }), item('node.note'), item('node.edgeNote', { hideDisabled: true }),
      canBeTask(path) ? item('node.task', { label: e && e.task !== null && e.task !== undefined ? t('editor.cmd.taskOff') : t('editor.cmd.taskOn') }) : null,
      aiOn() ? item('ai.branches', { hideDisabled: true }) : null, aiOn() ? item('ai.emoji', { hideDisabled: true }) : null,
      aiOn() ? item('ai.images', { hideDisabled: true }) : null, aiOn() ? item('ai.describe', { hideDisabled: true }) : null
    ].concat(linkItems.length ? ['-'].concat(linkItems) : [], [
      '-',
      fold, item('node.indent'), item('node.outdent'), item('node.moveUp'), item('node.moveDown'),
      item('node.sideLeft', { hideDisabled: true }), item('node.sideRight', { hideDisabled: true }),
      item('node.copyBranch', { point: point }),
      treeRoot(path) ? item('map.splitBranches', { hideDisabled: true }) : item('node.toMap', { hideDisabled: true }),
      '-'
    ], removalItems(path), [
      item('node.delete', { danger: true })
    ]);
  }

  function backgroundItems() {
    if (!cur()) return [];
    /* Its own row, not node.addSibling: a node may still be selected while
     * the empty map is pressed, and Enter would add beside it. */
    return [
      readOnly() ? null : { label: t('editor.cmd.addRoot'), icon: 'plus', onSelect: function () { add('root'); } },
      !readOnly() ? item('map.tidy') : null,
      '-',
      item('node.foldAll'), item('node.unfoldAll')
    ];
  }

  function openContext(d) {
    if (!cur()) return;
    if (renaming) finishRename(true, { focus: false });
    closeContext();
    var items;
    var title = '';
    if (d.path !== null && d.path !== undefined && entryOf(d.path)) {
      if (selected() !== d.path) S().select(d.path, { reveal: false });
      items = nodeMenuItems(d.path, { x: d.x, y: d.y });
      /* On a phone the menu is a sheet: its header names the node. */
      title = D().plainText(entryOf(d.path)) || '';
    } else {
      items = backgroundItems();
    }
    if (!items.filter(function (x) { return x && x !== '-'; }).length) return;
    /* A long press opens the menu under the finger that is still down; the
     * click the browser makes when it lifts must not choose the row it
     * lands on. */
    if (d.pointerType === 'touch' || d.pointerType === 'pen') swallowNextClick();
    contextHandle = ns.ui.contextMenu({ x: d.x, y: d.y }, items, {
      label: t('editor.cmd.menu'),
      title: title,
      onClose: function () { contextHandle = null; placeToolbar(); }
    });
    placeToolbar();
  }

  function swallowNextClick() {
    var done = false;
    function kill(e) {
      if (done) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      finish();
    }
    function finish() {
      done = true;
      document.removeEventListener('click', kill, true);
      document.removeEventListener('pointerdown', finish, true);
    }
    document.addEventListener('click', kill, true);
    /* The next touch is a choice of its own. */
    document.addEventListener('pointerdown', finish, true);
    setTimeout(finish, 1500);
  }

  function closeContext() {
    if (contextHandle && typeof contextHandle.close === 'function') {
      var hnd = contextHandle;
      contextHandle = null;
      hnd.close({ restore: false });
    }
  }

  /* ================================================================ lists in the words */

  /* The words under a title may hold lists: '- ', '1. ', '- [ ] ' at the
   * start of a line, nested by indent (the file keeps them inside the
   * quoted text, so they stay words; ns.doc draws them). These work on the
   * plain string and two offsets, like the marks, so the unit suite can
   * drive them without a field. Each returns {text, start, end} or null
   * (nothing to do: the key does what it did before). */
  var LIST_HEAD_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

  function linesOf(text) {
    var out = [];
    var at = 0;
    text.split('\n').forEach(function (l) { out.push({ start: at, text: l }); at += l.length + 1; });
    return out;
  }

  function lineIndexAt(lines, pos) {
    for (var i = lines.length - 1; i > 0; i--) if (pos >= lines[i].start) return i;
    return 0;
  }

  function indentOf(head) {
    var col = 0;
    for (var i = 0; i < head.length; i++) col += head.charAt(i) === '\t' ? 4 - (col % 4) : 1;
    return col;
  }

  function itemOf(line) {
    var m = LIST_HEAD_RE.exec(line);
    if (!m) return null;
    var indent = indentOf(m[1]);
    return {
      head: m[0], indent: indent,
      kind: m[6] ? 'check' : (m[3] ? 'number' : 'bullet'),
      number: m[3] ? Number(m[3]) : null, delim: m[4] || '', bullet: m[2] || '-',
      box: m[6] ? m[6].charAt(1) : null,
      content: indent + (m[2] || m[3] + m[4]).length + Math.min(m[5].length, 4)
    };
  }

  /* The lines rebuilt, each start and end offset carried along: a caret
   * inside a head that changed lands after the new head (a choice that
   * starts at the start of a line still starts there). */
  function rebuild(lines, heads, start, end) {
    var out = [];
    var map = function (pos, from) {
      var i = lineIndexAt(lines, pos);
      var col = pos - lines[i].start;
      var h = heads[i];
      var base = 0;
      for (var k = 0; k < i; k++) base += (heads[k] ? heads[k].now.length + lines[k].text.length - heads[k].was.length : lines[k].text.length) + 1;
      if (!h || (from && col === 0)) return base + col;
      return base + (col >= h.was.length ? col - h.was.length + h.now.length : h.now.length);
    };
    for (var i = 0; i < lines.length; i++) {
      var h = heads[i];
      out.push(h ? h.now + lines[i].text.slice(h.was.length) : lines[i].text);
    }
    return { text: out.join('\n'), start: map(start, start !== end), end: map(end) };
  }

  /* Enter on a list item: the next item, the same kind, one number on, an
   * empty box for a task. Enter on an empty item ends the list there (a
   * nested one steps out a level first), as every editor does. */
  function listEnter(text, start, end) {
    var lines = linesOf(text);
    var i = lineIndexAt(lines, start);
    var it = itemOf(lines[i].text);
    if (!it || start - lines[i].start < it.head.length) return null;
    if (!lines[i].text.slice(it.head.length).trim() && start === end) {
      if (it.indent > 0) return listIndent(text, start, end, -1);
      var heads = {};
      heads[i] = { was: lines[i].text, now: '' };
      return rebuild(lines, heads, lines[i].start, lines[i].start);
    }
    var lead = it.head.slice(0, it.head.length - it.head.replace(/^[ \t]*/, '').length);
    var head = lead + (it.kind === 'number' || it.number !== null ? (it.number + 1) + it.delim : it.bullet) + ' ' + (it.box !== null ? '[ ] ' : '');
    var next = text.slice(0, start) + '\n' + head + text.slice(end);
    var caret = start + 1 + head.length;
    return { text: next, start: caret, end: caret };
  }

  /* Tab (dir 1) nests the items the choice touches under the item above
   * them; Shift+Tab (dir -1) brings them out a level. The first item has
   * nothing to nest under and stays. */
  function listIndent(text, start, end, dir) {
    var lines = linesOf(text);
    var from = lineIndexAt(lines, start);
    var to = lineIndexAt(lines, end);
    var heads = {};
    var changed = false;
    var any = false;
    for (var i = from; i <= to; i++) {
      var it = itemOf(lines[i].text);
      if (!it) continue;
      any = true;
      var want = -1;
      for (var k = i - 1; k >= 0 && want < 0; k--) {
        var above = itemOf(heads[k] ? heads[k].now + lines[k].text.slice(heads[k].was.length) : lines[k].text);
        if (!above) { if (!lines[k].text.trim() || /^[ \t]/.test(lines[k].text)) continue; break; }
        if (dir > 0 && above.indent <= it.indent) want = above.content > it.indent ? above.content : -2;
        if (dir < 0 && above.indent < it.indent) want = above.indent;
      }
      if (dir < 0 && want === -1 && it.indent > 0) want = 0;
      if (want < 0) continue;
      var bare = it.head.replace(/^[ \t]*/, '');
      heads[i] = { was: it.head, now: new Array(want + 1).join(' ') + bare };
      changed = true;
    }
    if (!changed) return any && dir > 0 ? { text: text, start: start, end: end } : null;
    return rebuild(lines, heads, start, end);
  }

  /* A list button: the lines the choice touches become items of that kind
   * (numbered on from 1), or stop being items when they all already are. */
  function listToggle(text, start, end, kind) {
    var lines = linesOf(text);
    var from = lineIndexAt(lines, start);
    var to = lineIndexAt(lines, end);
    if (to > from && end === lines[to].start) to--;
    var all = true;
    for (var i = from; i <= to; i++) {
      if (!lines[i].text.trim() && to > from) continue;
      var it = itemOf(lines[i].text);
      if (!it || it.kind !== kind) all = false;
    }
    var heads = {};
    var n = 1;
    for (var j = from; j <= to; j++) {
      if (!lines[j].text.trim() && to > from) continue;
      var cur = itemOf(lines[j].text);
      var lead = cur ? cur.head.slice(0, cur.head.length - cur.head.replace(/^[ \t]*/, '').length) : (lines[j].text.match(/^[ \t]*/) || [''])[0];
      var was = cur ? cur.head : lead;
      var now = lead;
      if (!all) {
        if (kind === 'number') now += (n++) + '. ';
        else if (kind === 'check') now += '- [' + (cur && cur.box && cur.box !== ' ' ? 'x' : ' ') + '] ';
        else now += '- ';
      }
      heads[j] = { was: was, now: now };
    }
    return rebuild(lines, heads, start, end);
  }

  /* Which kind of item the caret's line is, for the buttons' pressed state. */
  function listKindAt(text, pos) {
    var lines = linesOf(text);
    var it = itemOf(lines[lineIndexAt(lines, pos)].text);
    return it ? it.kind : null;
  }

  function onListLine(el) {
    var at = caretOffsets(el);
    if (!at) return false;
    var lines = linesOf(readField(el));
    return !!itemOf(lines[lineIndexAt(lines, at.start)].text);
  }

  /* One of the three applied to the field, as one step of its own undo. */
  function writeList(el, next) {
    if (!next) return false;
    var text = readField(el);
    if (next.text !== text) {
      var hist = historyOf(el);
      if (hist) hist.record();
      setField(el, next.text);
    }
    chooseRange(el, next.start, next.end);
    if (renaming) {
      renaming.typed = true;
      placeFormatBarSoon();
    }
    return true;
  }

  function bodyEnter(el) {
    var at = caretOffsets(el) || { start: readField(el).length, end: readField(el).length };
    if (!writeList(el, listEnter(readField(el), at.start, at.end))) insertPlain(el, '\n');
  }

  function bodyIndent(el, dir) {
    var at = caretOffsets(el);
    return !!at && writeList(el, listIndent(readField(el), at.start, at.end, dir));
  }

  /* A list button pressed: in the words under the title (the caret moves
   * there first when it was in the title, at the end of the words). */
  function applyList(kind) {
    if (!renaming) return false;
    var el = renaming.body.el;
    if (currentField() !== el) moveToField('body', false);
    var at = caretOffsets(el);
    var text = readField(el);
    if (!at) at = { start: text.length, end: text.length };
    var done = writeList(el, listToggle(text, at.start, at.end, kind));
    formatHidden = false;
    placeFormatBar();
    return done;
  }

  /* ================================================================ the format bar */

  function fmtButton(name, icon, label, onClick, extra) {
    var b = ns.ui.button({ icon: icon, label: label, cls: extra || null, onClick: onClick });
    b.setAttribute('data-format', name);
    fb[name] = b;
    return b;
  }

  function buildFormatBar() {
    formatBar = h('div', {
      class: 'format-bar capsule glass',
      role: 'toolbar',
      'aria-label': t('editor.formatBar'),
      'data-i18n-aria-label': 'editor.formatBar',
      hidden: true
    });
    var g = grip();
    formatBar.appendChild(g);
    fmtButton('size', 'h-size', t('editor.fmt.size'), function () { openSizeMenu(fb.size); }, 'format-bar__menu');
    fmtButton('role', 'text', t('editor.fmt.role'), function () { openRoleMenu(fb.role); }, 'format-bar__menu');
    fb.size.setAttribute('aria-haspopup', 'menu');
    fb.role.setAttribute('aria-haspopup', 'menu');
    formatBar.appendChild(fb.size);
    formatBar.appendChild(fb.role);
    formatBar.appendChild(h('span', { class: 'bar-sep', 'aria-hidden': 'true' }));
    [['bold', 'bold', 'editor.fmt.bold', ['Mod+B']], ['italic', 'italic', 'editor.fmt.italic', ['Mod+I']],
      ['underline', 'underline', 'editor.fmt.underline', ['Mod+U']], ['strike', 'strike', 'editor.fmt.strike', ['Mod+Shift+X']],
      ['clear', 'clear-format', 'editor.fmt.clear', ['Mod+\\']]].forEach(function (m) {
      var b = fmtButton(m[0], m[1], t(m[2]), function () { applyMark(m[0]); });
      b.setAttribute('aria-pressed', 'false');
      if (m[0] === 'clear') b.removeAttribute('aria-pressed');
      ns.ui.tooltip(b, t(m[2]), m[3]);
      formatBar.appendChild(b);
    });
    formatBar.appendChild(h('span', { class: 'bar-sep', 'aria-hidden': 'true' }));
    [['listBullet', 'list', 'editor.fmt.listBullet', 'bullet'], ['listNumber', 'list-number', 'editor.fmt.listNumber', 'number'],
      ['listCheck', 'list-check', 'editor.fmt.listCheck', 'check']].forEach(function (m) {
      var b = fmtButton(m[0], m[1], t(m[2]), function () { applyList(m[3]); });
      b.setAttribute('aria-pressed', 'false');
      ns.ui.tooltip(b, t(m[2]));
      formatBar.appendChild(b);
    });
    formatBar.appendChild(h('span', { class: 'bar-sep', 'aria-hidden': 'true' }));
    fmtButton('picture', 'image', t('editor.fmt.picture'), function () { openPictureMenu(fb.picture); }, 'format-bar__menu');
    fb.picture.setAttribute('aria-haspopup', 'menu');
    formatBar.appendChild(fb.picture);
    fmtButton('done', 'check', t('editor.fmt.done'), function () { finishRename(true); });
    ns.ui.tooltip(fb.done, t('editor.fmt.done'), ['Mod+Enter']);
    formatBar.appendChild(fb.done);
    fmtButton('hide', 'close', t('editor.fmt.hide'), function () {
      formatHidden = true;
      hideFormatBar();
    }, 'format-bar__hide');
    formatBar.appendChild(fb.hide);
    preventFocusSteal(formatBar);
    formatBar.addEventListener('keydown', onFormatBarKey);
    formatBar.addEventListener('focusout', onFormatBarFocusOut);
    if (ns.ui.roving) fb.roving = ns.ui.roving(formatBar);
    floaters.appendChild(formatBar);
    if (ns.float) {
      ns.float.attach(formatBar, g);
      ns.float.onAnchor(formatBar, placeFormatBar);
    }
  }

  /* A menu opened from the bar takes the keyboard for a moment: the writing
   * is held (a blur then is not leaving), and given back when the menu
   * closes without a choice. */
  function holdFor(open) {
    if (!renaming) return;
    var r = renaming;
    var mark = writingMark();
    r.held++;
    var released = false;
    function release(chosen) {
      if (released) return;
      released = true;
      r.held = Math.max(0, r.held - 1);
      if (!chosen && renaming === r && !r.done) focusField({ field: mark.field, start: mark.start === null ? undefined : mark.start, end: mark.end === null ? undefined : mark.end });
    }
    open(release);
  }

  /* A panel of another module (the mention list) takes the keyboard while
   * the words are being written: the writing is held, so the blur is not
   * leaving; the returned release(refocus) gives it back (refocus: with the
   * caret where it was) or, with nothing to give back to, does nothing. */
  function holdWriting() {
    var r = renaming;
    if (!r || r.done) return function () {};
    var mark = writingMark();
    var released = false;
    r.held++;
    return function (refocus) {
      if (released) return;
      released = true;
      r.held = Math.max(0, r.held - 1);
      if (refocus && renaming === r && !r.done && mark) focusField({ field: mark.field, start: mark.start === null ? undefined : mark.start, end: mark.end === null ? undefined : mark.end });
    };
  }

  function menuOf(anchor, items, label, release) {
    var picked = false;
    var wrapped = items.map(function (it) {
      if (!it || it === '-' || it.heading) return it;
      var fn = it.onSelect;
      return Object.assign({}, it, {
        onSelect: function () {
          picked = true;
          release(true);
          if (fn) fn();
        }
      });
    });
    ns.ui.menu(anchor, wrapped, { label: label, title: label, onClose: function () { if (!picked) setTimeout(function () { release(false); }, 0); } });
  }

  function openSizeMenu(anchor) {
    if (!renaming) return;
    var c = cur();
    var Dc = D();
    var size = Dc.titleSizeAt(c.state, renaming.path);
    var caption = Dc.roleAt(c.state, renaming.path) === 'caption';
    var items = [{ label: t('editor.fmt.normal'), checked: !size && !caption, radio: true, onSelect: function () { setSize(null); } }];
    for (var n = 1; n <= 6; n++) {
      (function (k) {
        items.push({ label: t('editor.fmt.h', { n: k }), checked: size === 'h' + k, radio: true, kbd: ns.commands ? ns.commands.keysLabel('Mod+Alt+' + k) : '', onSelect: function () { setSize(size === 'h' + k ? null : 'h' + k); } });
      })(n);
    }
    items.push('-');
    items.push({ label: t('editor.fmt.caption'), checked: caption, onSelect: function () { setSize('caption'); } });
    holdFor(function (release) { menuOf(anchor, items, t('editor.fmt.size'), release); });
  }

  function openRoleMenu(anchor) {
    if (!renaming) return;
    var role = D().bodyRoleAt(cur().state, renaming.path) || 'paragraph';
    var items = ['paragraph', 'title', 'subtitle', 'caption'].map(function (r) {
      return { label: t('editor.fmt.' + r), checked: role === r, radio: true, onSelect: function () { setBodyRole(role === r && r !== 'paragraph' ? 'paragraph' : r); } };
    });
    holdFor(function (release) { menuOf(anchor, items, t('editor.fmt.role'), release); });
  }

  function pictureItems() {
    if (!renaming) return [];
    var Dc = D();
    var c = cur();
    var path = renaming.path;
    var field = fieldName(currentField());
    var items = [];
    if (ns.media && typeof ns.media.pickImages === 'function') items.push({ label: t('editor.fmt.addPicture'), icon: 'image', onSelect: addPicture });
    if (ns.commands && ns.commands.has('media.draw')) items.push({ label: t('editor.fmt.draw'), icon: 'draw', onSelect: addDrawing });
    [['photo', Dc.PHOTO, 'picture'], ['draw', Dc.DRAW, 'drawing']].forEach(function (k) {
      var has = !!Dc.imagesIn(c.state, path, field, k[1]);
      if (!has) return;
      var place = Dc.imagePositionAt(c.state, path, field, k[1]);
      items.push('-');
      ['Left', 'Right', 'Above'].forEach(function (side) {
        var where = side.toLowerCase();
        items.push({
          label: t('editor.fmt.' + k[2] + side),
          icon: (k[0] === 'photo' ? 'image-' : 'draw-') + where,
          checked: place === where,
          disabled: !place,
          onSelect: function () { placePicture(k[0], where); }
        });
      });
      items.push({ label: t(k[0] === 'photo' ? 'editor.fmt.pictureOut' : 'editor.fmt.drawingOut'), icon: k[0] === 'photo' ? 'image-off' : 'draw-off', danger: true, onSelect: function () { if (k[0] === 'draw') askThenTakeDrawingOut(); else takePictureOut(k[0]); } });
    });
    return items;
  }

  function openPictureMenu(anchor) {
    var items = pictureItems();
    if (!items.length) return;
    holdFor(function (release) { menuOf(anchor, items, t('editor.fmt.picture'), release); });
  }

  function hideFormatBar() {
    if (formatBar && !formatBar.hidden) formatBar.hidden = true;
  }

  /* Alt+F10 from a field takes the keyboard to the bar (the arrows move
   * along it), Escape brings it back to the words where they were. */
  function focusFormatBar() {
    if (!renaming || !formatBar) return false;
    formatHidden = false;
    placeFormatBar();
    var first = Array.prototype.filter.call(formatBar.querySelectorAll('.btn'), function (b) {
      return !b.hidden && b.getAttribute('aria-disabled') !== 'true' && b.getClientRects().length;
    })[0];
    if (!first) return false;
    renaming.barMark = writingMark();
    try { first.focus({ preventScroll: true }); } catch (err) { return false; }
    return true;
  }

  /* Tab, like Escape, goes back to the words: the bar is one stop of the
   * writing, and a Tab out of it would drop the keyboard on the page with
   * the node still open, where the next key edits the map. */
  function onFormatBarKey(e) {
    if (!renaming) return;
    if (e.key !== 'Escape' && !(e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey)) return;
    e.preventDefault();
    e.stopPropagation();
    var m = renaming.barMark || {};
    focusField({ field: m.field, start: m.start === null ? undefined : m.start, end: m.end === null ? undefined : m.end });
  }

  /* The keyboard leaving the bar for somewhere that is not the node is
   * leaving the writing. */
  function onFormatBarFocusOut(e) {
    var r = renaming;
    if (!r || r.done || r.held > 0) return;
    var to = e.relatedTarget;
    if (!to || formatBar.contains(to) || r.el.contains(to)) return;
    finishRename(true, { focus: false });
  }

  function updateFormatBar(el, at) {
    var Dc = D();
    var c = cur();
    var path = renaming.path;
    var inBody = el === renaming.body.el;
    var text = readField(el);
    var chosen = !!at && at.end > at.start;
    var marks = chosen ? Dc.markState(text, at.start, at.end) : {};
    marks.strike = chosen && strikeState(text, at.start, at.end);
    ['bold', 'italic', 'underline', 'strike'].forEach(function (m) {
      setEnabled(fb[m], chosen);
      fb[m].setAttribute('aria-pressed', String(!!(chosen && marks[m])));
    });
    setEnabled(fb.clear, !!at);
    var listKind = inBody && at ? listKindAt(text, at.start) : null;
    [['listBullet', 'bullet'], ['listNumber', 'number'], ['listCheck', 'check']].forEach(function (m) {
      fb[m[0]].setAttribute('aria-pressed', String(listKind === m[1]));
    });
    setShown(fb.size, !inBody);
    setShown(fb.role, inBody);
    if (!inBody) {
      var size = Dc.titleSizeAt(c.state, path);
      var caption = Dc.roleAt(c.state, path) === 'caption';
      var name = size ? t('editor.fmt.h', { n: size.slice(1) }) : (caption ? t('editor.fmt.caption') : t('editor.fmt.normal'));
      fb.size.setAttribute('aria-label', t('editor.fmt.sizeIs', { size: name }));
      fb.size.setAttribute('data-value', size || (caption ? 'caption' : ''));
    } else {
      var role = Dc.bodyRoleAt(c.state, path) || 'paragraph';
      fb.role.setAttribute('aria-label', t('editor.fmt.roleIs', { role: t('editor.fmt.' + role) }));
    }
    setShown(fb.picture, pictureItems().length > 0);
    setShown(fb.hide, !compact());
    if (fb.roving) fb.roving.refresh();
  }

  /* The bar is the box's, not the choice's: there for as long as the node
   * is being written in, over the chosen words when there are some, over
   * the field when not. On a phone it docks above the keyboard instead. */
  function placeFormatBar() {
    if (!formatBar) return;
    if (!renaming || readOnly() || (gesture !== 'idle' && !compact())) { hideFormatBar(); return; }
    var el = currentField();
    if (!el || !el.isConnected) { hideFormatBar(); return; }
    var range = rangeIn(el);
    var at = range ? offsetsOf(el, range) : null;
    if (range && !range.collapsed) formatHidden = false;
    if (formatHidden) { hideFormatBar(); keepCaretInView(); return; }
    updateFormatBar(el, at);
    var docked = compact();
    formatBar.toggleAttribute('data-docked', docked);
    formatBar.toggleAttribute('data-instant', lastInput === 'key' || !formatBar.hidden);
    if (formatBar.hidden) formatBar.hidden = false;
    keepCaretInView();
    if (docked) {
      formatBar.style.left = '';
      formatBar.style.top = '';
      return;
    }
    if (ns.float && ns.float.moved(formatBar)) return;
    var rect = range && !range.collapsed ? range.getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) rect = el.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) rect = view.rect(renaming.path);
    if (!rect) return;
    var anchorRect = rect;
    /* Over the whole node rather than the field, so the bar never sits on
     * the other field's words. */
    var nodeRect = renaming.el.getBoundingClientRect();
    if (nodeRect && nodeRect.width) anchorRect = { left: rect.left, right: rect.right, width: rect.width, top: nodeRect.top, bottom: nodeRect.bottom, height: nodeRect.height };
    var fbox = stageBox();
    var editing = renaming.path;
    var p = barPosition(formatBar, anchorRect, fbox, false, editing);
    formatBar.style.left = p.left + 'px';
    formatBar.style.top = p.top + 'px';
    formatBar.setAttribute('data-side', p.side);
  }

  var placeFormatBarSoon = function () { placeFormatBar(); };

  function placeBars() {
    placeToolbar();
    placeFormatBar();
  }

  /* ================================================================ drag and drop */

  function onDragStart(d) {
    if (readOnly() || !entryOf(d.path) || !view) return;
    if (renaming) finishRename(true, { focus: false });
    closeContext();
    if (ns.colorpicker && ns.colorpicker.isOpen && ns.colorpicker.isOpen()) ns.colorpicker.close();
    var ghost = d.wire && typeof view.threadGhost === 'function'
      ? view.threadGhost(d.path, d.wire, { x: d.x, y: d.y }, {})
      : view.dragGhost(d.path, { x: d.x, y: d.y }, {
        onTarget: function (target) { if (dragging && dragging.ghost === ghost) { dragging.target = target; judge(target); } }
      });
    dragging = { path: d.path, ghost: ghost, target: null, popEsc: null, judged: null, ok: false, wire: d.wire || null };
    hideToolbar();
    if (ns.ui && ns.ui.escape) {
      dragging.popEsc = ns.ui.escape.push(function () { cancelDrag(); });
    }
    /* A little tick under the finger says the node came off the map. */
    if (d.pointerType === 'touch' && /Android/i.test(navigator.userAgent || '') && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(10); } catch (err) { /* not allowed here */ }
    }
    document.documentElement.setAttribute('data-node-drag', '');
  }

  /* Asked once per place the pointer reaches, not once per move: planning a
   * move reads the document. */
  function judge(target) {
    if (!dragging) return false;
    var key = target ? target.path + '|' + target.where + '|' + (target.side || '') : '';
    if (dragging.judged !== key) {
      var c = cur();
      dragging.judged = key;
      if (dragging.wire) {
        /* A thread: plugged into a node (or taken in), or let go in the open
         * to detach. Over the parent it already hangs from, nothing to say. */
        var w = dragging.wire;
        if (!target || !c || target.where === 'same') dragging.ok = false;
        else if (target.where === 'free') dragging.ok = w === 'in' && !treeRoot(dragging.path);
        else dragging.ok = w === 'in' ? D().canMoveTo(c.state, dragging.path, target.path, 'child') : D().canMoveTo(c.state, target.path, dragging.path, 'child');
        var no = !!target && target.where === 'child' && !dragging.ok;
        document.documentElement.toggleAttribute('data-drop-refused', no);
        if (dragging.ghost.refuse) dragging.ghost.refuse(no);
        return dragging.ok;
      }
      if (target && target.where === 'free') dragging.ok = canPlace(dragging.path);
      else dragging.ok = !!target && !!c && (D().canMoveTo(c.state, dragging.path, target.path, target.where) || onlySide(dragging.path, target.side));
      document.documentElement.toggleAttribute('data-drop-refused', !!target && !dragging.ok);
      if (dragging.ghost.refuse) dragging.ghost.refuse(!!target && !dragging.ok);
    }
    return dragging.ok;
  }

  function onDragMove(d) {
    if (!dragging) return;
    dragging.target = dragging.ghost.move(d.x, d.y);
    judge(dragging.target);
  }

  function endDrag() {
    var dr = dragging;
    dragging = null;
    if (dr && dr.popEsc) dr.popEsc();
    document.documentElement.removeAttribute('data-node-drag');
    document.documentElement.removeAttribute('data-drop-refused');
    return dr;
  }

  function onDragEnd(d) {
    var dr = dragging;
    if (!dr) return;
    if (d.cancelled) {
      dr.ghost.cancel();
      endDrag();
      placeToolbar();
      return;
    }
    var target = dr.ghost.target ? dr.ghost.target() : dr.target;
    var ok = judge(target);
    if (ok) dr.ghost.drop(); else dr.ghost.cancel();
    endDrag();
    if (dr.wire) {
      endWire(dr, target, ok);
    } else if (ok && target.where === 'free') {
      placeFree(dr.path, target.x, target.y);
    } else if (ok) {
      if (!moveBranch(dr.path, target.path, target.where, target.side) && ns.ui && ns.ui.toast) ns.ui.toast(t('editor.nothingThere'));
    } else if (target && target.where !== 'free' && ns.ui && ns.ui.toast) {
      ns.ui.toast(t('editor.refused'));
    }
    placeToolbar();
  }

  /* A thread let go: plugged into a node (the pulled branch becomes its
   * child), a node taken in (it becomes a child of the pulled one), or the
   * open (the branch is detached where it stands). One edit each. */
  function endWire(dr, target, ok) {
    if (!target || target.where === 'same') return;
    if (!ok) { if (ns.ui && ns.ui.toast && target.where === 'child') ns.ui.toast(t('editor.refused')); return; }
    if (target.where === 'free') { detach(dr.path); return; }
    var moved = dr.wire === 'in'
      ? moveBranch(dr.path, target.path, 'child', target.side, 'editor.label.attach')
      : moveBranch(target.path, dr.path, 'child', target.side, 'editor.label.attach');
    if (!moved && ns.ui && ns.ui.toast) ns.ui.toast(t('editor.nothingThere'));
  }

  function cancelDrag() {
    if (!dragging) return;
    var dr = dragging;
    dr.ghost.cancel();
    endDrag();
    if (view && typeof view.cancelGesture === 'function') view.cancelGesture();
    placeToolbar();
  }

  /* ================================================================ commands */

  function sel(ctx, controlKey) { return hasSel() && keyAllowed(ctx, controlKey); }
  function edit(ctx, controlKey) { return editable() && sel(ctx, controlKey); }

  function register() {
    var C = ns.commands;
    if (!C) return;
    C.register({
      id: 'node.addChild', label: 'editor.cmd.addChild', group: 'node', icon: 'child', keys: ['Tab'],
      keywords: t('editor.kw.addChild'), help: 'editor.help.addChild',
      when: function (ctx) { return edit(ctx, true); },
      run: function () { return add('child'); }
    });
    /* The two sides listed left first everywhere (toolbar, thumb bar, menus,
     * help, palette), as they lie on the screen. */
    C.register({
      id: 'node.addLeft', label: 'editor.cmd.addLeft', group: 'node', icon: 'branch-left', keys: ['Alt+Shift+ArrowLeft'],
      keywords: t('editor.kw.side'), help: 'editor.help.addSide',
      when: function (ctx) { return edit(ctx, false) && treeRoot(selected()); },
      run: function () { return add('left'); }
    });
    C.register({
      id: 'node.addRight', label: 'editor.cmd.addRight', group: 'node', icon: 'branch-right', keys: ['Alt+Shift+ArrowRight'],
      keywords: t('editor.kw.side'), help: 'editor.help.addSide',
      when: function (ctx) { return edit(ctx, false) && treeRoot(selected()); },
      run: function () { return add('right'); }
    });
    C.register({
      id: 'node.addSibling', label: 'editor.cmd.addSibling', group: 'node', icon: 'sibling', keys: ['Enter'],
      keywords: t('editor.kw.addSibling'), help: 'editor.help.addSibling',
      title: function () {
        if (loneRoot(selected())) return t('editor.cmd.addChild');
        return hasSel() || !cur() ? t('editor.cmd.addSibling') : t('editor.cmd.addRoot');
      },
      when: function (ctx) { return editable() && keyAllowed(ctx, true); },
      run: function () { return add(hasSel() ? (loneRoot(selected()) ? 'child' : 'sibling') : 'root'); }
    });
    C.register({
      id: 'node.addSiblingBefore', label: 'editor.cmd.addSiblingBefore', group: 'node', icon: 'sibling', keys: ['Shift+Enter'],
      keywords: t('editor.kw.addSibling'), help: 'editor.help.addSiblingBefore',
      when: function (ctx) { return editable() && keyAllowed(ctx, true); },
      run: function () { return add(hasSel() ? (loneRoot(selected()) ? 'child' : 'before') : 'root'); }
    });
    C.register({
      id: 'node.rename', label: 'editor.cmd.rename', group: 'node', icon: 'rename', keys: ['F2'],
      keywords: t('editor.kw.rename'), help: 'editor.help.rename',
      when: function (ctx) { return edit(ctx, false); },
      run: function () { return startRename(selected()); }
    });
    C.register({
      id: 'node.delete', label: 'editor.cmd.delete', group: 'node', icon: 'trash', keys: ['Delete', 'Backspace'],
      keywords: t('editor.kw.delete'), help: 'editor.help.delete',
      /* From a key the root still answers (with the toast that says why);
       * in a menu or the palette the entry is simply off. */
      when: function (ctx) { return edit(ctx, false) && (selected() !== '' || (!!ctx && ctx.source === 'key')); },
      run: function (ctx) {
        /* A picture picked on the selected node (a click on it, a ring
         * round it): Delete and Backspace take that picture out, not the
         * branch. Menus name the branch, so they always delete it. */
        var pick = ctx && ctx.source === 'key' ? pickedOn(selected()) : null;
        if (pick) return removePicture(selected(), pick);
        return remove(selected());
      }
    });
    C.register({
      id: 'node.indent', label: 'editor.cmd.indent', group: 'node', icon: 'indent', keys: ['Alt+ArrowRight'],
      keywords: t('editor.kw.move'), help: 'editor.help.indent',
      when: function (ctx) { return keyAllowed(ctx, false) && canShift('indent'); },
      run: function () { return shift('indent'); }
    });
    C.register({
      id: 'node.outdent', label: 'editor.cmd.outdent', group: 'node', icon: 'outdent', keys: ['Shift+Tab', 'Alt+ArrowLeft'],
      keywords: t('editor.kw.move'), help: 'editor.help.outdent',
      when: function (ctx) {
        var tabKey = ctx && ctx.event && ctx.event.key === 'Tab';
        return keyAllowed(ctx, tabKey) && canShift('outdent');
      },
      run: function () { return shift('outdent'); }
    });
    C.register({
      id: 'node.moveUp', label: 'editor.cmd.moveUp', group: 'node', icon: 'up', keys: ['Alt+ArrowUp'],
      keywords: t('editor.kw.move'), help: 'editor.help.move', repeat: true,
      when: function (ctx) { return keyAllowed(ctx, false) && canShift('up'); },
      run: function () { return shift('up'); }
    });
    C.register({
      id: 'node.moveDown', label: 'editor.cmd.moveDown', group: 'node', icon: 'down', keys: ['Alt+ArrowDown'],
      keywords: t('editor.kw.move'), help: 'editor.help.move', repeat: true,
      when: function (ctx) { return keyAllowed(ctx, false) && canShift('down'); },
      run: function () { return shift('down'); }
    });
    C.register({
      id: 'node.sideLeft', label: 'editor.cmd.sideLeft', group: 'node', icon: 'arrow-left',
      keywords: t('editor.kw.side'), help: 'editor.help.side',
      when: function (ctx) { return edit(ctx, false) && firstLevel(selected()) && sideOf(selected()) !== 'left'; },
      run: function () { return moveSide(selected(), 'left'); }
    });
    C.register({
      id: 'node.sideRight', label: 'editor.cmd.sideRight', group: 'node', icon: 'arrow-right',
      keywords: t('editor.kw.side'), help: 'editor.help.side',
      when: function (ctx) { return edit(ctx, false) && firstLevel(selected()) && sideOf(selected()) !== 'right'; },
      run: function () { return moveSide(selected(), 'right'); }
    });
    C.register({
      id: 'node.tidy', label: 'editor.cmd.tidy', group: 'node', icon: 'fit',
      keywords: t('editor.kw.move'), help: 'editor.help.tidy',
      when: function (ctx) { return edit(ctx, false) && hasPlaced(selected()); },
      run: function () { return tidy(selected()); }
    });
    C.register({
      id: 'map.tidy', label: 'editor.cmd.tidyMap', group: 'map', icon: 'tidy',
      keywords: t('editor.kw.move'), help: 'editor.help.tidy',
      when: function () { return editable(); },
      run: function () { return tidy(null); }
    });
    C.register({
      id: 'node.detach', label: 'editor.cmd.detach', group: 'node', icon: 'external',
      keywords: t('editor.kw.move'), help: 'editor.help.detach',
      when: function (ctx) { return edit(ctx, false) && !treeRoot(selected()); },
      run: function () { return detach(selected()); }
    });
    C.register({
      id: 'node.attach', label: 'editor.cmd.attach', group: 'node', icon: 'link',
      keywords: t('editor.kw.move'), help: 'editor.help.detach',
      when: function (ctx) { return edit(ctx, false) && !loneRoot(selected()); },
      run: function () { return startAttach(selected()); }
    });
    C.register({
      id: 'node.fold', label: 'editor.cmd.fold', group: 'node', icon: 'fold', keys: ['Space'],
      keywords: t('editor.kw.fold'), help: 'editor.help.fold',
      title: function () { var p = selected(); return view && p !== null && view.isFolded(p) ? t('editor.cmd.unfoldIt') : t('editor.cmd.foldIt'); },
      when: function (ctx) { return sel(ctx, true) && hasKids(selected()); },
      run: function () { return toggleFold(selected()); }
    });
    C.register({
      id: 'node.foldAll', label: 'editor.cmd.foldAll', group: 'map', icon: 'fold',
      keywords: t('editor.kw.fold'), help: 'editor.help.fold',
      when: function () { return !!cur() && !!view; },
      run: foldAll
    });
    C.register({
      id: 'node.unfoldAll', label: 'editor.cmd.unfoldAll', group: 'map', icon: 'unfold',
      keywords: t('editor.kw.fold'), help: 'editor.help.fold',
      when: function () { return !!cur() && !!view; },
      run: unfoldAll
    });
    C.register({
      id: 'node.color', label: 'editor.cmd.color', group: 'node', icon: 'color',
      keywords: t('editor.kw.color'), help: 'editor.help.color',
      when: function (ctx) { return edit(ctx, false) && !!ns.colorpicker; },
      run: function (ctx) {
        var anchor = ctx && ctx.anchor ? ctx.anchor : (ctx && ctx.point ? { left: ctx.point.x, top: ctx.point.y, right: ctx.point.x, bottom: ctx.point.y } : (toolbar && !toolbar.hidden ? tb.color : null));
        return openColor(anchor, selected());
      }
    });
    C.register({
      id: 'node.dice', label: 'editor.cmd.dice', group: 'node', icon: 'dice',
      keywords: t('editor.kw.dice'), help: 'editor.help.dice',
      checked: function () { return !!prefGet('diceColors', false); },
      when: function () { return !readOnly(); },
      run: function () {
        if (ns.prefs) ns.prefs.set('diceColors', !prefGet('diceColors', false));
        return true;
      }
    });
    C.register({
      id: 'node.note', label: 'editor.cmd.note', group: 'node', icon: 'note',
      keywords: t('editor.kw.note'), help: 'editor.help.note',
      when: function (ctx) {
        if (!sel(ctx, false) || !ns.notes) return false;
        if (!readOnly()) return true;
        var e = entryOf(selected());
        return !!(e && e.notes && e.notes.node);
      },
      run: function () { return ns.notes.open(selected(), 'node'); }
    });
    C.register({
      id: 'node.edgeNote', label: 'editor.cmd.edgeNote', group: 'node', icon: 'edge-note',
      keywords: t('editor.kw.note'), help: 'editor.help.edgeNote',
      when: function (ctx) {
        if (!sel(ctx, false) || !ns.notes || !hasIncomingEdge(selected())) return false;
        if (!readOnly()) return true;
        var e = entryOf(selected());
        return !!(e && e.notes && e.notes.edge);
      },
      run: function () { return ns.notes.open(selected(), 'edge'); }
    });
    C.register({
      id: 'node.task', label: 'editor.cmd.task', group: 'node', icon: 'task',
      keywords: t('editor.kw.task'), help: 'editor.help.task',
      title: function () { var e = entryOf(selected()); return e && e.task !== null && e.task !== undefined ? t('editor.cmd.taskOff') : t('editor.cmd.taskOn'); },
      checked: function () { var e = entryOf(selected()); return !!(e && e.task !== null && e.task !== undefined); },
      when: function (ctx) { return edit(ctx, false) && canBeTask(selected()); },
      run: function () {
        var e = entryOf(selected());
        return setTask(selected(), !(e && e.task !== null && e.task !== undefined));
      }
    });
    C.register({
      id: 'node.openLink', label: 'editor.cmd.openLink', group: 'node', icon: 'link',
      keywords: t('editor.kw.link'), help: 'editor.help.openLink',
      when: function (ctx) { return sel(ctx, false) && linksOf(selected()).length > 0; },
      run: function (ctx) { return openLinks(selected(), ctx && ctx.anchor); }
    });
    C.register({
      id: 'node.toMap', label: 'editor.cmd.toMap', group: 'node', icon: 'map',
      keywords: t('editor.kw.toMap'), help: 'editor.help.toMap',
      when: function (ctx) { return edit(ctx, false) && !treeRoot(selected()); },
      run: function () { return toMaps([selected()]); }
    });
    C.register({
      id: 'map.splitBranches', label: 'editor.cmd.splitMap', group: 'map', icon: 'map',
      keywords: t('editor.kw.toMap'), help: 'editor.help.splitMap',
      when: function () { return editable() && !!cur() && firstLevelPaths().length > 0; },
      run: function () {
        var list = firstLevelPaths();
        if (!list.length) { if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.splitNothing')); return false; }
        return toMaps(list);
      }
    });
    C.register({
      id: 'node.copyBranch', label: 'editor.cmd.copyBranch', group: 'node', icon: 'copy',
      keywords: t('editor.kw.copy'), help: 'editor.help.copyBranch',
      when: function (ctx) { return edit(ctx, false); },
      run: function (ctx) {
        var anchor = ctx && ctx.anchor ? ctx.anchor : (ctx && ctx.point ? { left: ctx.point.x, top: ctx.point.y, right: ctx.point.x, bottom: ctx.point.y } : null);
        return copyBranch(selected(), anchor);
      }
    });
    C.register({
      id: 'node.menu', label: 'editor.cmd.menu', group: 'node', icon: 'more', keys: ['Shift+F10', 'ContextMenu'],
      help: 'editor.help.menu', showInPalette: false,
      when: function (ctx) { return sel(ctx, false); },
      run: function () {
        var a = nodeAnchor(selected());
        openContext({ path: selected(), x: a.left + 8, y: a.bottom });
        return true;
      }
    });
    C.register({
      id: 'node.deselect', label: 'editor.cmd.deselect', group: 'navigate', icon: 'close', keys: ['Escape'],
      help: 'editor.help.deselect', showInPalette: false,
      when: function (ctx) { return hasSel() && keyAllowed(ctx, true); },
      run: function () { S().select(null); return true; }
    });
    [['up', 'ArrowUp', 'chevron-up'], ['down', 'ArrowDown', 'chevron-down'], ['left', 'ArrowLeft', 'chevron-left'], ['right', 'ArrowRight', 'chevron-right']].forEach(function (a) {
      C.register({
        id: 'navigate.' + a[0], label: 'editor.cmd.' + a[0], group: 'navigate', icon: a[2], keys: [a[1]], repeat: true,
        help: 'editor.help.navigate', showInPalette: false, showInHelp: a[0] === 'up',
        when: function (ctx) { return !!cur() && !!view && keyAllowed(ctx, true) && view.visiblePaths().length > 0; },
        run: function () { return go(a[0]); }
      });
    });
    C.register({
      id: 'navigate.first', label: 'editor.cmd.first', group: 'navigate', icon: 'up', keys: ['Home'], showInPalette: false, showInHelp: false,
      when: function (ctx) { return sel(ctx, true); },
      run: function () { return goEnd(false); }
    });
    C.register({
      id: 'navigate.last', label: 'editor.cmd.last', group: 'navigate', icon: 'down', keys: ['End'], showInPalette: false, showInHelp: false,
      when: function (ctx) { return sel(ctx, true); },
      run: function () { return goEnd(true); }
    });
  }

  /* ================================================================ copy and paste on the map */

  /* With the keys on the map and a node chosen, Ctrl+C puts its branch on
   * the clipboard as the Markdown the file holds, and Ctrl+V writes the
   * Markdown (or plain lines) on the clipboard as its children, as one
   * step. Pictures on the clipboard are the media module's. */
  function mapHasKeys() {
    if (!view || !view.el || renaming || dragging) return false;
    if (document.activeElement !== view.el) return false;
    return !(ns.ui && typeof ns.ui.isOpen === 'function' && ns.ui.isOpen());
  }

  function onMapCopy(e) {
    if (e.defaultPrevented || !e.clipboardData || !mapHasKeys()) return;
    var c = cur();
    var path = selected();
    if (!c || path === null || !c.state.byPath[path]) return;
    var taken = D().extractBranch(c.state, path);
    if (!taken) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', taken.fragment.text.replace(/\s+$/, '') + '\n');
    if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.copiedMd', { label: taken.fragment.label || placeholder() }));
  }

  function onMapPaste(e) {
    if (e.defaultPrevented || !e.clipboardData || !mapHasKeys() || !editable()) return;
    var files = e.clipboardData.files;
    if (files && files.length) return;
    var text = e.clipboardData.getData('text/plain');
    if (!text || !text.trim()) return;
    var c = cur();
    var path = selected();
    if (!c || path === null || !c.state.byPath[path]) return;
    e.preventDefault();
    var res = pasteUnder(c.state, path, text);
    if (res) apply(res, 'editor.label.paste', { select: res.selectPath });
  }

  /* Each top branch of the pasted text, in order, as the last children of
   * the node. Words with no Markdown shape are a list, a line a node. */
  function pasteUnder(state, path, text) {
    var Dc = D();
    /* A copied branch brings its ids: those that already name a node of this map are taken off. */
    var clean = Dc.normalizeText(Dc.stripIds(String(text).replace(/\r\n?/g, '\n'), Dc.idsOf(state)));
    var piece = Dc.parse(clean);
    var frags = piece.flat.filter(function (e) {
      var up = Dc.parentPath(e.path);
      return up === null || up === undefined || !piece.byPath[up];
    }).map(function (e) { return Dc.extractBranch(piece, e.path).fragment; });
    if (!frags.length) {
      frags = clean.split('\n').map(function (l) { return l.trim(); }).filter(Boolean)
        .map(function (l) { return { text: '- ' + l, kind: 'bullet', indent: 0 }; });
    }
    var now = state;
    var result = null;
    var first = null;
    var count = 0;
    for (var i = 0; i < frags.length; i++) {
      var r = Dc.insertBranch(now, path, Infinity, frags[i]);
      if (!r) continue;
      count++;
      result = r;
      if (first === null && typeof r.anchorLine === 'number') first = r.anchorLine;
      now = Dc.parse(r.text);
    }
    if (!result) return null;
    var made = first !== null ? Dc.findByLine(now, first) : null;
    /* A first-level branch copied deeper keeps no 'left' marker: the
     * pasted nodes (the last children of the node) and all under them. */
    var pasted = (now.byPath[path] ? now.byPath[path].children : []).slice(-count)
      .map(function (e) { return e.path; });
    var tidy = pasted.length ? Dc.dropStraySides(now, pasted) : null;
    return { text: tidy ? tidy.text : result.text, anchorLine: first, selectPath: made ? made.path : path };
  }

  /* ================================================================ wiring */

  var placeSoon = null;

  function dirty() { toolbarDirty = true; }

  function onSelection() {
    dirty();
    var path = selected();
    if (toolbar && ns.float && path !== toolbarShownFor) ns.float.anchor(toolbar);
    if (renaming && renaming.path !== path && !renaming.done) {
      /* The selection moved away from the node being written (a search, a
       * click elsewhere that did not blur first): the writing ends saved. */
      finishRename(true, { focus: false });
    }
    if (ns.colorpicker && ns.colorpicker.isOpen && ns.colorpicker.isOpen() && ns.colorpicker.owner && ns.colorpicker.owner() !== 'editor:' + path) {
      ns.colorpicker.close();
    }
    if (path === null) toolbarShownFor = null;
    placeSoon();
  }

  /* The text changed under the editor: the writing goes on if its node is
   * still drawn, and ends saved where it now is if the node was rebuilt. */
  function onDocChanged(d) {
    dirty();
    if (renaming && !renaming.done) {
      if (!renaming.el.isConnected || !renaming.title.el.isConnected) finishRename(true, { focus: false });
    }
    placeSoon();
  }

  function onFlush() {
    /* The page is being left or saved: what is typed goes into the map now,
     * and the writing goes on. */
    if (renaming && !renaming.done) {
      var mark = writingMark();
      var focused = renaming.el.contains(document.activeElement);
      finishRename(true, { focus: false });
      if (focused && document.visibilityState !== 'hidden') resumeWriting(mark);
    }
  }

  /* A letter typed with a node chosen and the map holding the keys starts
   * writing that node's name over its old one, the way a cell takes what
   * is typed into it: a person who has just made a map and starts typing
   * expects the words to land somewhere, not to vanish. Space (fold) and ?
   * (help) keep their own meaning; a key with Ctrl, Alt or Cmd is a
   * shortcut (AltGr, which types characters, is not). */
  function onMapType(e) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (!view || e.target !== view.el) return;
    var altGr = !!(e.getModifierState && e.getModifierState('AltGraph'));
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
    var ch = e.key;
    if (typeof ch !== 'string' || Array.from(ch).length !== 1 || ch === ' ' || ch === '?') return;
    if (/[\u0000-\u001f\u007f]/.test(ch)) return;
    if (renaming || !editable() || !hasSel() || panelOpen()) return;
    if (ns.commands && ns.commands.isStoodDown && ns.commands.isStoodDown()) return;
    e.preventDefault();
    e.stopPropagation();
    if (!startRename(selected(), { selectAll: true })) return;
    var el = renaming ? renaming.title.el : null;
    if (el && document.activeElement === el) insertPlain(el, ch);
  }

  function trackInput() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') lastInput = 'key';
    }, true);
    document.addEventListener('pointerdown', function (e) {
      lastInput = 'pointer';
      onDocPointerDown(e);
    }, true);
    document.addEventListener('mousedown', onDocMouseDown, true);
  }

  function init() {
    if (ready) return;
    var session = S();
    if (!session || !session.view || !ns.doc || !ns.ui || !ns.util) return;
    view = session.view;
    stage = document.getElementById('stage');
    floaters = document.getElementById('floaters') || stage;
    if (!stage) return;
    ready = true;
    placeSoon = ns.util.throttleFrame(placeBars);
    placeFormatBarSoon = ns.util.throttleFrame(placeFormatBar);
    register();
    buildToolbar();
    buildFormatBar();
    trackInput();
    document.addEventListener('keydown', onMapType, true);
    document.addEventListener('copy', onMapCopy);
    document.addEventListener('paste', onMapPaste);

    view.on('activate', function (d) {
      if (readOnly() || !entryOf(d.path)) return;
      startRename(d.path);
    });
    view.on('context', openContext);
    view.on('task', function (d) { toggleTask(d.path); });
    view.on('bodytask', function (d) { toggleBodyTask(d.path, d.index); });
    view.on('select', function (d) { if (linking) attachTo(d.path); });
    view.on('background', function () { if (linking) endAttach(); });
    view.on('grip', function () { if (ns.ui && ns.ui.toast) ns.ui.toast(t('editor.moveHint')); });
    view.on('wire', function (d) { if (ns.ui && ns.ui.toast) ns.ui.toast(t(d.wire === 'in' ? 'editor.wireInHint' : 'editor.wireOutHint')); });
    view.on('link', function (d) {
      if (renaming) return;
      openLink(d.href, d.kind, d.node);
    });
    view.on('image', function (d) {
      if (renaming) return;
      openViewer(d.image);
    });
    view.on('dragstart', onDragStart);
    view.on('dragmove', onDragMove);
    view.on('dragend', onDragEnd);
    view.on('gesture', function (d) {
      gesture = d && d.state ? d.state : 'idle';
      if (gesture === 'drag') closeContext();
      if (gesture !== 'idle') {
        hideToolbar();
        if (!compact()) hideFormatBar();
      } else {
        placeBars();
      }
    });
    view.on('camera', function () { placeSoon(); });
    view.on('render', function () { placeSoon(); });

    var bus = ns.bus;
    if (bus) {
      bus.on('selection', onSelection);
      bus.on('doc:changed', onDocChanged);
      bus.on('map:opened', function () {
        if (renaming) finishRename(false, { focus: false });
        if (dragging) cancelDrag();
        toolbarShownFor = null;
        placeSoon();
      });
      bus.on('map:closed', function () {
        if (renaming) finishRename(false, { focus: false });
        hideToolbar();
        hideFormatBar();
      });
      bus.on('flush', onFlush);
      bus.on('tabs:yield', onFlush);
      bus.on('layout', function () { placeSoon(); });
      bus.on('prefs', function (d) {
        dirty();
        if (d && d.key === 'mode' && d.value === 'view') {
          if (renaming) finishRename(true, { focus: false });
          if (dragging) cancelDrag();
        }
        placeSoon();
      });
      bus.on('tabs', function () { dirty(); if (readOnly() && renaming) finishRename(true, { focus: false }); placeSoon(); });
      bus.on('commands', function () { dirty(); placeSoon(); });
      bus.on('notes', function () { dirty(); placeSoon(); });
      bus.on('lang', function () {
        dirty();
        if (tb.more) {
          tb.more.setAttribute('aria-label', t('editor.cmd.more'));
          ns.ui.tooltip(tb.more, t('editor.cmd.more'));
        }
        Object.keys(fb).forEach(function (k) {
          var key = { bold: 'editor.fmt.bold', italic: 'editor.fmt.italic', underline: 'editor.fmt.underline', strike: 'editor.fmt.strike', clear: 'editor.fmt.clear', picture: 'editor.fmt.picture', done: 'editor.fmt.done', hide: 'editor.fmt.hide', size: 'editor.fmt.size', role: 'editor.fmt.role', listBullet: 'editor.fmt.listBullet', listNumber: 'editor.fmt.listNumber', listCheck: 'editor.fmt.listCheck' }[k];
          if (key && fb[k]) { fb[k].setAttribute('aria-label', t(key)); ns.ui.tooltip(fb[k], t(key)); }
        });
        placeSoon();
      });
    }
    /* A keyboard coming up (or the window shrinking under it) covers the
     * foot of the map: the node being written moves up with the bars. */
    function onViewportResize() {
      if (renaming) renaming.typed = true;
      placeSoon();
    }
    window.addEventListener('resize', onViewportResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportResize);
    document.addEventListener('selectionchange', function () { if (renaming) placeFormatBarSoon(); });
    if (view.el) view.el.addEventListener('scroll', resetScroll);
    stage.addEventListener('scroll', resetScroll);
    watchChrome();
    placeBars();
  }

  /* The toolbar is placed clear of the capsules floating over the stage;
   * when one of them changes size (the save state's words, a banner
   * coming), the bar is placed again so it never ends up under one. */
  function watchChrome() {
    if (typeof ResizeObserver !== 'function') return;
    /* Placed at once: the observer runs after layout and before the frame
     * is painted, so no frame shows the bar under a capsule that grew. */
    var ro = new ResizeObserver(function () {
      if (toolbar && !toolbar.hidden) placeBars();
    });
    /* The capsules themselves too, as chromeBoxes measures them: a slot can
     * keep its size while the capsule in it grows ("Saved at 17:01"). */
    var els = document.querySelectorAll('#topbar .topbar__slot, #topbar .topbar__slot > *, #banners, #zoombar');
    for (var i = 0; i < els.length; i++) ro.observe(els[i]);
  }

  ns.editor = {
    init: init,
    startRename: startRename,
    finishRename: finishRename,
    cancelRename: cancelRename,
    isRenaming: isRenaming,
    renaming: renamingInfo,
    typing: typingInfo,
    canAct: function (ctx) { return edit(ctx, true); },
    insertText: insertText,
    addChildren: addChildren,
    addOutline: addOutline,
    setTitle: setTitle,
    placeFree: placeFree,
    setTexts: setTexts,
    add: add,
    remove: remove,
    moveBranch: moveBranch,
    jumpTo: jumpTo,
    idFor: idFor,
    referenceTo: referenceTo,
    replaceBefore: replaceBefore,
    holdWriting: holdWriting,
    moveSide: moveSide,
    paint: paint,
    openColor: openColor,
    toggleTask: toggleTask,
    setTask: setTask,
    openLink: openLink,
    foldAll: foldAll,
    unfoldAll: unfoldAll,
    suspendWriting: suspendWriting,
    resumeWriting: resumeWriting,
    applyMark: applyMark,
    placeBars: placeBars,
    toggleStrike: toggleStrike,
    listEnter: listEnter,
    listIndent: listIndent,
    listToggle: listToggle,
    applyList: applyList,
    readField: readField,
    get toolbar() { return toolbar; },
    get formatBar() { return formatBar; }
  };
})(window.MindRoot);
