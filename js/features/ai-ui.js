/* MindRoot - AI assistance, what the person sees (ns.aiui).
 *
 * Settings -> AI (section()): the provider, the model, the key and where it
 * is kept, one switch per feature, a test, and what was sent last. Nothing
 * here talks to the network by itself: it is all ns.ai (features/ai.js),
 * which does nothing until a feature is switched on and a key is given.
 *
 * Complete as you type (the 'complete' switch): after a pause at the end of
 * the title or the words of the node being written, a small card under the
 * field offers how it might go on; Tab takes it (editor.js hands Tab to take()
 * first), any other key, Escape or leaving the field drops it. Only the
 * words of the node, its parents, its siblings and its sub-branches are sent.
 *
 * Suggest branches (the 'branches' switch, command ai.branches, Mod+.): a
 * panel lists titles for the selected node, each with a tick; the ticked ones
 * are added as children in one step (one Undo takes them all back), "Another
 * round" asks for different ones.
 *
 *   section() -> element        the Settings block
 *   take(event) -> bool         Tab, when a suggestion is showing: taken
 *   contextFor(path, extra)     the words sent about a node (pure reading)
 *   errorText(err)              a failure, in words
 *   openBranches(path)          the panel
 *   hide()                      drops a suggestion showing
 *
 * Ghost suggestions (the 'ghost' switch): the same completion, written
 * faintly right after the caret instead of in a card; and, after a pause on a
 * selected node, up to three faint branches beside it on the map. Tab takes
 * the words, or the first branch (as a child marked as the AI's); a click
 * takes the branch clicked; any other key, Escape or a new selection drops
 * them. Each pause sends what a completion or a branch suggestion sends.
 *
 * Who wrote each node (the 'labels' switch, on to begin with, nothing sent):
 * html[data-ai-labels] (html[data-ai-writing] while a node is written into:
 * the labels step back) and the words of the three labels as custom
 * properties; map.css draws them from the node's mv-by-* class (doc.js 'by').
 * Branches, icons and descriptions taken from the AI mark the node: 'ai' for
 * a node it made, 'mixed' for the person's node it wrote into.
 * Bus heard: 'editor:typed' {path, field}, 'editor:rename' {state},
 * 'selection', 'view', 'layout', 'map:rendered', 'map:opened', 'prefs', 'lang'. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var DELAY = 700;           // ms of quiet before a completion is asked for
  var MIN_CHARS = 3;
  var ERROR_QUIET = 60000;   // one word about a failure at most this often

  ns.i18n.add({
    en: {
      'ai.window': 'AI assistant',
      'ai.settingsOpen': 'Open AI settings',
      'ai.privacyShort': 'Off until you switch a feature on and give a key. Only the words of a node and its neighbours are ever sent.',
      'ai.line.off': 'Both features are off.',
      'ai.line.nokey': 'On, but there is no key yet.',
      'ai.line.locked': 'On, but the key is locked.',
      'ai.line.nobase': 'On, but the address is not valid.',
      'ai.line.ready': 'Ready: {provider}, {model}.',
      'ai.saveCheck': 'Save and check',
      'ai.unlockTitle': 'The key is locked',
      'ai.loadModels': 'Load the models',
      'ai.loading': 'Loading…',
      'ai.modelsLoaded': '{n} models available: choose one below.',
      'ai.modelsNone': 'The provider listed no models you can use. Type a model name.',
      'ai.modelDefault': 'Default ({model})',
      'ai.modelOther': 'Another name…',
      'ai.modelPickHint': 'What the provider offers. A smaller model answers faster and costs less.',
      'ai.testBadModel': 'The connection works, but the model "{model}" is not available to you. Choose another one.',
      'ai.emoji': 'Suggest an icon',
      'ai.emojiHint': 'Ask for an emoji that fits the selected node and put it in front of its title.',
      'ai.images': 'Illustrate with pictures',
      'ai.imagesHint': 'Ask for three pictures made for the selected node, and keep the one you like. Made by OpenAI from a description you can read and change; each round costs a few cents on your account.',
      'ai.imagesNeedOpenAI': 'Pictures are made by OpenAI: choose OpenAI as the provider.',
      'ai.imageModel': 'Picture model',
      'ai.imageModelHint': 'Left empty, {model} is used. If your account is refused, try another picture model it can use.',
      'ai.menu': 'AI',
      'ai.cmd.menu': 'AI for this node',
      'ai.cmd.settings': 'AI settings…',
      'ai.offImages': 'Switch “Illustrate with pictures” on in the AI assistant window.',
      'ai.cmd.emoji': 'Suggest an icon',
      'ai.cmd.images': 'Illustrate with pictures',
      'ai.help.emoji': 'Ask the AI for emoji that fit the selected node and put the one you choose in front of its title. Switch it on in the AI assistant window.',
      'ai.help.images': 'Ask OpenAI for three pictures for the selected node and keep the one you choose. Switch it on in the AI assistant window.',
      'ai.kw.emoji': 'ai emoji icon symbol sparkles',
      'ai.kw.images': 'ai picture image illustration generate openai sparkles',
      'ai.label.icon': 'put an icon on the node',
      'ai.label.noIcon': 'take the icon off the node',
      'ai.emoji.title': 'Icon for “{node}”',
      'ai.emoji.hint': 'Choose one: it goes in front of the title.',
      'ai.emoji.none': 'No emoji came back. Try another round.',
      'ai.emoji.remove': 'No icon',
      'ai.images.title': 'Pictures for “{node}”',
      'ai.images.describe': 'Describe the picture',
      'ai.images.go': 'Make 3 pictures',
      'ai.images.more': 'Make 3 more',
      'ai.images.use': 'Use this one',
      'ai.images.busy': 'Drawing… this takes a little while.',
      'ai.images.hint': 'Only this description is sent to OpenAI.',
      'ai.images.pick': 'Picture {n}',
      'ai.images.added': 'Picture added to the node.',
      'ai.images.failed': 'The picture could not be added.',
      'ai.images.said': 'The provider said: {text}',
      'ai.images.style': 'Simple, friendly flat illustration, no text, plain light background, centred.',
      'ai.images.default': 'Illustration for the mind-map node “{node}”{where}.',
      'ai.images.where': ', part of “{path}”',
      'ai.describe': 'Describe pictures',
      'ai.describeHint': 'Ask what a picture in the selected node shows, and put a title and a description on the node. The picture itself, reduced, goes to the provider, only when you ask.',
      'ai.outline': 'Let it read the whole map',
      'ai.outlineHint': 'Branch suggestions also get the titles of every node of this map (never other maps), so ideas fit the whole and do not repeat other branches.',
      'ai.outlineBodies': 'Include the words under the nodes',
      'ai.outlineBodiesHint': 'Also sends what is written under each node, so suggestions understand the content, not just the titles: about 400 characters for the node and its surroundings, 160 for the others, up to some 14,000 in all. More is sent, and it costs a little more.',
      'ai.cmd.describe': 'Describe the picture',
      'ai.help.describe': 'Ask the AI what a picture in the selected node shows and add a title and a description. The picture goes to the provider only when you ask.',
      'ai.kw.describe': 'ai describe picture image alt text caption vision sparkles',
      'ai.label.describe': 'describe the picture',
      'ai.describe.title': 'Describe the picture in “{node}”',
      'ai.describe.nopic': 'This node has no picture to describe.',
      'ai.describe.sent': 'The picture itself, reduced to 1024 px, is sent to {provider} when you press the button.',
      'ai.describe.go': 'Describe the picture',
      'ai.describe.again': 'Describe it again',
      'ai.describe.busy': 'Looking…',
      'ai.describe.titleField': 'Title',
      'ai.describe.textField': 'Description',
      'ai.describe.useTitle': 'Use as the title of the node',
      'ai.describe.useText': 'Add to the words under the title',
      'ai.describe.apply': 'Add to the node',
      'ai.describe.which': 'Picture {n}',
      'ai.describe.lang': 'Language of the description',
      'ai.branches.lang': 'Language of the titles',
      'ai.describe.unreadable': 'That picture could not be read.',
      'ai.offDescribe': 'Switch “Describe pictures” on in the AI assistant window.',
      'ai.lang': 'Language of the answers',
      'ai.langHint': 'Automatic follows the words of the node. Choose one to have suggestions, completions and descriptions always written in it.',
      'ai.lang.auto': 'Same as the node\'s words',
      'ai.lang.app': 'Same as the app',
      'ai.title': 'AI assistance',
      'ai.intro': 'Off until you switch a feature on and give a key. Then, only when a feature runs, the words of the node and of the nodes round it (its parents, siblings and sub-branches) go to the provider you choose - never the whole map, a file or a picture.',
      'ai.provider': 'Provider',
      'ai.provider.anthropic': 'Anthropic',
      'ai.provider.openai': 'OpenAI',
      'ai.provider.custom': 'Other',
      'ai.model': 'Model',
      'ai.modelHint': 'Left empty, {model} is used.',
      'ai.base': 'Address',
      'ai.baseHint': 'Any OpenAI-compatible address, ending like .../v1 (a model on your own machine, as http://localhost:11434/v1, included).',
      'ai.baseBad': 'Use https://..., or http://localhost... for this machine.',
      'ai.key': 'Key',
      'ai.keyPlaceholder': 'Paste the key here',
      'ai.keyMode': 'Keep it',
      'ai.keyMode.session': 'This session only',
      'ai.keyMode.device': 'On this device',
      'ai.keyMode.locked': 'Locked with a passphrase',
      'ai.keyHint.session': 'Gone when the tab closes. Safest.',
      'ai.keyHint.device': 'Stays in this browser. Pages you open from files on this computer share that storage and could read it: use a key with a spending limit.',
      'ai.keyHint.locked': 'Kept encrypted; you type the passphrase once each time MindRoot opens.',
      'ai.passphrase': 'Passphrase',
      'ai.save': 'Save the key',
      'ai.forget': 'Forget the key',
      'ai.unlock': 'Unlock',
      'ai.keyState.none': 'No key yet.',
      'ai.keyState.session': 'Key kept for this session.',
      'ai.keyState.device': 'Key kept on this device.',
      'ai.keyState.locked': 'Key kept, locked: type the passphrase.',
      'ai.keyState.ready': 'Key ready.',
      'ai.keySaved': 'Key saved.',
      'ai.keyMemory': 'Key kept in memory only: this browser would not store it.',
      'ai.keyShort': 'Choose a passphrase of at least 4 characters.',
      'ai.wrongPass': 'That passphrase does not open it.',
      'ai.features': 'Features',
      'ai.complete': 'Complete as you type',
      'ai.completeHint': 'A pause at the end of a title or of the words of a node offers how it might go on. Tab takes it.',
      'ai.branches': 'Suggest branches',
      'ai.branchesHint': 'Ask for sub-branches of the selected node (the button with the sparkles, or Ctrl+.).',
      'ai.test': 'Test the connection',
      'ai.testing': 'Asking…',
      'ai.testOk': 'It works ({ms} ms).',
      'ai.stats': 'Requests this session: {n}.',
      'ai.statsLast': ' Last: {kind}, {chars} characters sent.',
      'ai.needKey': 'Give a key to use it.',
      'ai.err.nokey': 'No key: give one in the AI assistant window.',
      'ai.err.locked': 'The key is locked: type its passphrase in the AI assistant window.',
      'ai.err.auth': 'The provider refused the key.',
      'ai.err.rate': 'The provider says too many requests; try again in a moment.',
      'ai.err.model': 'The provider does not know that model: check it in Settings, AI.',
      'ai.err.network': 'Could not reach the provider.',
      'ai.err.timeout': 'The provider took too long.',
      'ai.err.limit': 'Too many requests for now; they open again in a minute.',
      'ai.err.bad': 'The provider could not answer.',
      'ai.cmd.branches': 'Suggest branches',
      'ai.help.branches': 'Ask the AI for sub-branches of the selected node and add the ones you tick. Switch it on in Settings, AI.',
      'ai.kw.branches': 'ai ideas expand brainstorm sparkles suggest children',
      'ai.kw.open': 'ai assistant key model provider anthropic openai settings sparkles',
      'ai.help.open': 'Open the AI assistant window: provider, key, model and the two features.',
      'ai.label.addBranches': 'add suggested branches',
      'ai.pill.tab': 'Tab',
      'ai.pill.aria': 'Suggestion: {text}. Press Tab to take it.',
      'ai.panel.title': 'Branches for “{node}”',
      'ai.panel.busy': 'Thinking…',
      'ai.panel.retry': 'Try again',
      'ai.panel.add': 'Add {n}',
      'ai.panel.addOne': 'Add 1',
      'ai.panel.again': 'Another round',
      'ai.panel.none': 'Nothing to suggest. Try another round.',
      'ai.panel.added': '{n} branches added.',
      'ai.panel.hint': 'Tick the ones to add.',
      'ai.offEmoji': 'Switch “Suggest an icon” on in the AI assistant window.',
      'ai.off': 'Switch “Suggest branches” on in the AI assistant window.',
      'ai.costNotice': 'Every feature that sends something spends tokens on your own account with the provider, and the cost may be high. MindRoot does not know it: check it with your provider.',
      'ai.ghost': 'Ghost suggestions',
      'ai.ghostHint': 'Faint words after the caret while you write, and faint branches beside the selected node after a pause. Tab takes them; any other key leaves them. Each pause sends the words of the node and its neighbours.',
      'ai.chat': 'Chat with the AI',
      'ai.chatHint': 'A conversation of its own that can turn an idea, a project, a book or an exam into a map, or add branches to the selected node. Only what you write in it is sent. Chats are kept in this browser: bookmark the ones you want to keep, delete the others.',
      'ai.chatMap': 'Let the chat read the open map',
      'ai.chatMapHint': 'The titles of the open map go with each message, the selected node marked, so answers fit it.',
      'ai.chatScope': 'What the chat can read',
      'ai.chatScope.node': 'The selected node',
      'ai.chatScope.map': 'The open map',
      'ai.chatScope.project': 'The whole project',
      'ai.chatScopeHint.node': 'Only the title of the selected node goes with each message.',
      'ai.chatScopeHint.map': 'The open map goes with each message, whole, as its Markdown, with the selected node said, so answers fit it and the chat can change it.',
      'ai.chatScopeHint.project': 'Every map of the open project goes with each message, whole, as its Markdown (the open map first), so answers can join them up and the chat can change them. More is sent, and it costs more.',
      'ai.chatBoards': 'The boards of the maps it reads',
      'ai.chatBoards.off': 'Not read',
      'ai.chatBoards.text': 'Their text',
      'ai.chatBoards.pictures': 'Text and pictures',
      'ai.chatBoardsHint.off': 'The boards stay out of the chat.',
      'ai.chatBoardsHint.text': 'What is written on a board with the text tool goes with each message. Drawings by hand are not read.',
      'ai.chatBoardsHint.pictures': 'The text, and up to four pages of the boards as pictures, with each message: the AI sees the drawings too. Pictures use many more tokens, with every message, and the cost may be high.',
      'ai.guide': 'With another AI',
      'ai.guideHint': 'To have another AI (any chat assistant) make a whole MindRoot project from your documents: give it this guide and the documents, save the JSON it writes as a file, and import it (the sidebar, Import).',
      'ai.copyGuide': 'Copy the guide for another AI',
      'ai.guideCopied': 'Guide copied.',
      'ai.guideFailed': 'This browser would not copy it.',
      'ai.readProjects': 'Projects the chat can read from anywhere',
      'ai.readProjectsHint': 'Every map of a ticked project goes with each message of any chat, whole, whichever project is open, and the chat can change it. Never the pictures; 30,000 characters a map and 160,000 in all, the rest left out and said.',
      'ai.onMap': 'On the map',
      'ai.labels': 'Show who wrote each node',
      'ai.labelsHint': 'A small label on each node: AI, Mixed (the AI\'s words and yours) or Human. Nothing is sent; it is kept in the map as a hidden marker.',
      'ai.by.ai': 'AI',
      'ai.by.mixed': 'Mixed',
      'ai.by.human': 'Human',
      'ai.label.ghostBranch': 'add a suggested branch',
      'ai.sprouts.aria': 'Suggested branches for “{node}”. Press Tab to add “{first}”.',
      'ai.sprout.take': 'Add “{title}”',
      'ai.cmd.chat': 'Chat with the AI'
    },
    it: {
      'ai.window': 'Assistente AI',
      'ai.settingsOpen': 'Apri le impostazioni AI',
      'ai.privacyShort': 'Spento finché non attivi una funzione e dai una chiave. Si inviano solo le parole di un nodo e dei suoi vicini.',
      'ai.line.off': 'Le due funzioni sono spente.',
      'ai.line.nokey': 'Accesa, ma manca ancora la chiave.',
      'ai.line.locked': 'Accesa, ma la chiave è bloccata.',
      'ai.line.nobase': 'Accesa, ma l\'indirizzo non è valido.',
      'ai.line.ready': 'Pronta: {provider}, {model}.',
      'ai.saveCheck': 'Salva e controlla',
      'ai.unlockTitle': 'La chiave è bloccata',
      'ai.loadModels': 'Carica i modelli',
      'ai.loading': 'Carico…',
      'ai.modelsLoaded': '{n} modelli disponibili: scegline uno qui sotto.',
      'ai.modelsNone': 'Il servizio non ha elencato modelli utilizzabili. Scrivi il nome di un modello.',
      'ai.modelDefault': 'Predefinito ({model})',
      'ai.modelOther': 'Un altro nome…',
      'ai.modelPickHint': 'Quelli che offre il servizio. Un modello più piccolo risponde prima e costa meno.',
      'ai.testBadModel': 'La connessione funziona, ma il modello «{model}» non è disponibile per te. Scegline un altro.',
      'ai.emoji': 'Suggerisci un\'icona',
      'ai.emojiHint': 'Chiede un\'emoji adatta al nodo selezionato e la mette davanti al suo titolo.',
      'ai.images': 'Illustra con immagini',
      'ai.imagesHint': 'Chiede tre immagini fatte per il nodo selezionato, e tieni quella che ti piace. Le fa OpenAI da una descrizione che puoi leggere e cambiare; ogni giro costa pochi centesimi sul tuo conto.',
      'ai.imagesNeedOpenAI': 'Le immagini le fa OpenAI: scegli OpenAI come servizio.',
      'ai.imageModel': 'Modello delle immagini',
      'ai.imageModelHint': 'Se resta vuoto si usa {model}. Se il tuo conto viene rifiutato, prova un altro modello di immagini che può usare.',
      'ai.menu': 'AI',
      'ai.cmd.menu': 'AI per questo nodo',
      'ai.cmd.settings': 'Impostazioni AI…',
      'ai.offImages': 'Attiva «Illustra con immagini» nella finestra dell\'assistente AI.',
      'ai.cmd.emoji': 'Suggerisci un\'icona',
      'ai.cmd.images': 'Illustra con immagini',
      'ai.help.emoji': 'Chiede all\'AI emoji adatte al nodo selezionato e mette quella che scegli davanti al titolo. Si attiva nella finestra dell\'assistente AI.',
      'ai.help.images': 'Chiede a OpenAI tre immagini per il nodo selezionato e tiene quella che scegli. Si attiva nella finestra dell\'assistente AI.',
      'ai.kw.emoji': 'ai emoji icona simbolo scintille',
      'ai.kw.images': 'ai immagine illustrazione genera openai scintille',
      'ai.label.icon': 'metti un\'icona sul nodo',
      'ai.label.noIcon': 'togli l\'icona dal nodo',
      'ai.emoji.title': 'Icona per «{node}»',
      'ai.emoji.hint': 'Scegline una: va davanti al titolo.',
      'ai.emoji.none': 'Non è tornata nessuna emoji. Prova un altro giro.',
      'ai.emoji.remove': 'Nessuna icona',
      'ai.images.title': 'Immagini per «{node}»',
      'ai.images.describe': 'Descrivi l\'immagine',
      'ai.images.go': 'Fai 3 immagini',
      'ai.images.more': 'Falle 3 di nuovo',
      'ai.images.use': 'Usa questa',
      'ai.images.busy': 'Disegno… ci vuole un po\'.',
      'ai.images.hint': 'A OpenAI va solo questa descrizione.',
      'ai.images.pick': 'Immagine {n}',
      'ai.images.added': 'Immagine aggiunta al nodo.',
      'ai.images.failed': 'Non è stato possibile aggiungere l\'immagine.',
      'ai.images.said': 'Il servizio ha detto: {text}',
      'ai.images.style': 'Illustrazione semplice e amichevole, stile piatto, senza testo, sfondo chiaro uniforme, al centro.',
      'ai.images.default': 'Illustrazione per il nodo della mappa «{node}»{where}.',
      'ai.images.where': ', parte di «{path}»',
      'ai.describe': 'Descrivi le immagini',
      'ai.describeHint': 'Chiede cosa mostra un\'immagine nel nodo selezionato e mette un titolo e una descrizione sul nodo. L\'immagine stessa, ridotta, va al servizio, solo quando lo chiedi.',
      'ai.outline': 'Fagli leggere tutta la mappa',
      'ai.outlineHint': 'I suggerimenti di rami ricevono anche i titoli di ogni nodo di questa mappa (mai altre mappe), così le idee stanno nel quadro e non ripetono altri rami.',
      'ai.outlineBodies': 'Includi i testi sotto i nodi',
      'ai.outlineBodiesHint': 'Invia anche quello che è scritto sotto ogni nodo, così i suggerimenti capiscono il contenuto e non solo i titoli: circa 400 caratteri per il nodo e i suoi dintorni, 160 per gli altri, al massimo circa 14.000 in tutto. Si invia di più e costa un po\' di più.',
      'ai.cmd.describe': 'Descrivi l\'immagine',
      'ai.help.describe': 'Chiede all\'AI cosa mostra un\'immagine nel nodo selezionato e aggiunge un titolo e una descrizione. L\'immagine va al servizio solo quando lo chiedi.',
      'ai.kw.describe': 'ai descrivi immagine foto testo alternativo didascalia visione scintille',
      'ai.label.describe': 'descrivi l\'immagine',
      'ai.describe.title': 'Descrivi l\'immagine in «{node}»',
      'ai.describe.nopic': 'Questo nodo non ha un\'immagine da descrivere.',
      'ai.describe.sent': 'L\'immagine stessa, ridotta a 1024 px, va a {provider} quando premi il pulsante.',
      'ai.describe.go': 'Descrivi l\'immagine',
      'ai.describe.again': 'Descrivila di nuovo',
      'ai.describe.busy': 'Guardo…',
      'ai.describe.titleField': 'Titolo',
      'ai.describe.textField': 'Descrizione',
      'ai.describe.useTitle': 'Usa come titolo del nodo',
      'ai.describe.useText': 'Aggiungi alle parole sotto il titolo',
      'ai.describe.apply': 'Aggiungi al nodo',
      'ai.describe.which': 'Immagine {n}',
      'ai.describe.lang': 'Lingua della descrizione',
      'ai.branches.lang': 'Lingua dei titoli',
      'ai.describe.unreadable': 'Non è stato possibile leggere quell\'immagine.',
      'ai.offDescribe': 'Attiva «Descrivi le immagini» nella finestra dell\'assistente AI.',
      'ai.lang': 'Lingua delle risposte',
      'ai.langHint': 'Automatica segue le parole del nodo. Scegline una per avere suggerimenti, completamenti e descrizioni sempre scritti in quella.',
      'ai.lang.auto': 'Come le parole del nodo',
      'ai.lang.app': 'Come l\'app',
      'ai.title': 'Assistente AI',
      'ai.intro': 'Spento finché non attivi una funzione e dai una chiave. Poi, solo quando una funzione lavora, le parole del nodo e dei nodi intorno (genitori, fratelli e sotto-rami) vanno al servizio che scegli: mai l\'intera mappa, un file o un\'immagine.',
      'ai.provider': 'Servizio',
      'ai.provider.anthropic': 'Anthropic',
      'ai.provider.openai': 'OpenAI',
      'ai.provider.custom': 'Altro',
      'ai.model': 'Modello',
      'ai.modelHint': 'Se resta vuoto si usa {model}.',
      'ai.base': 'Indirizzo',
      'ai.baseHint': 'Un indirizzo compatibile con OpenAI, che finisce come .../v1 (anche un modello sul tuo computer, come http://localhost:11434/v1).',
      'ai.baseBad': 'Usa https://..., oppure http://localhost... per questo computer.',
      'ai.key': 'Chiave',
      'ai.keyPlaceholder': 'Incolla qui la chiave',
      'ai.keyMode': 'Conservala',
      'ai.keyMode.session': 'Solo per questa sessione',
      'ai.keyMode.device': 'Su questo dispositivo',
      'ai.keyMode.locked': 'Bloccata da una password',
      'ai.keyHint.session': 'Sparisce quando chiudi la scheda. La più sicura.',
      'ai.keyHint.device': 'Resta in questo browser. Le pagine aperte da file su questo computer condividono quella memoria e potrebbero leggerla: usa una chiave con un limite di spesa.',
      'ai.keyHint.locked': 'Conservata cifrata; scrivi la password una volta ogni volta che MindRoot si apre.',
      'ai.passphrase': 'Password',
      'ai.save': 'Salva la chiave',
      'ai.forget': 'Dimentica la chiave',
      'ai.unlock': 'Sblocca',
      'ai.keyState.none': 'Ancora nessuna chiave.',
      'ai.keyState.session': 'Chiave conservata per questa sessione.',
      'ai.keyState.device': 'Chiave conservata su questo dispositivo.',
      'ai.keyState.locked': 'Chiave conservata, bloccata: scrivi la password.',
      'ai.keyState.ready': 'Chiave pronta.',
      'ai.keySaved': 'Chiave salvata.',
      'ai.keyMemory': 'Chiave tenuta solo in memoria: questo browser non la conserva.',
      'ai.keyShort': 'Scegli una password di almeno 4 caratteri.',
      'ai.wrongPass': 'Quella password non la apre.',
      'ai.features': 'Funzioni',
      'ai.complete': 'Completa mentre scrivi',
      'ai.completeHint': 'Una pausa alla fine di un titolo o delle parole di un nodo propone come potrebbe continuare. Tab lo accetta.',
      'ai.branches': 'Suggerisci rami',
      'ai.branchesHint': 'Chiede sotto-rami del nodo selezionato (il pulsante con le scintille, o Ctrl+.).',
      'ai.test': 'Prova la connessione',
      'ai.testing': 'Chiedo…',
      'ai.testOk': 'Funziona ({ms} ms).',
      'ai.stats': 'Richieste in questa sessione: {n}.',
      'ai.statsLast': ' Ultima: {kind}, {chars} caratteri inviati.',
      'ai.needKey': 'Dai una chiave per usarla.',
      'ai.err.nokey': 'Nessuna chiave: dalla nella finestra dell\'assistente AI.',
      'ai.err.locked': 'La chiave è bloccata: scrivi la sua password nella finestra dell\'assistente AI.',
      'ai.err.auth': 'Il servizio ha rifiutato la chiave.',
      'ai.err.rate': 'Il servizio dice che le richieste sono troppe; riprova tra poco.',
      'ai.err.model': 'Il servizio non conosce quel modello: controllalo in Impostazioni, AI.',
      'ai.err.network': 'Non riesco a raggiungere il servizio.',
      'ai.err.timeout': 'Il servizio ha impiegato troppo.',
      'ai.err.limit': 'Troppe richieste per ora; riaprono tra un minuto.',
      'ai.err.bad': 'Il servizio non ha saputo rispondere.',
      'ai.cmd.branches': 'Suggerisci rami',
      'ai.help.branches': 'Chiede all\'AI sotto-rami del nodo selezionato e aggiunge quelli che spunti. Si attiva in Impostazioni, AI.',
      'ai.kw.branches': 'ai idee espandi brainstorming scintille suggerisci figli',
      'ai.kw.open': 'ai assistente chiave modello servizio anthropic openai impostazioni scintille',
      'ai.help.open': 'Apre la finestra dell\'assistente AI: servizio, chiave, modello e le due funzioni.',
      'ai.label.addBranches': 'aggiungi i rami suggeriti',
      'ai.pill.tab': 'Tab',
      'ai.pill.aria': 'Suggerimento: {text}. Premi Tab per accettarlo.',
      'ai.panel.title': 'Rami per «{node}»',
      'ai.panel.busy': 'Ci penso…',
      'ai.panel.retry': 'Riprova',
      'ai.panel.add': 'Aggiungi {n}',
      'ai.panel.addOne': 'Aggiungi 1',
      'ai.panel.again': 'Un altro giro',
      'ai.panel.none': 'Niente da suggerire. Prova un altro giro.',
      'ai.panel.added': '{n} rami aggiunti.',
      'ai.panel.hint': 'Spunta quelli da aggiungere.',
      'ai.offEmoji': 'Attiva «Suggerisci un\'icona» nella finestra dell\'assistente AI.',
      'ai.off': 'Attiva «Suggerisci rami» nella finestra dell\'assistente AI.',
      'ai.costNotice': 'Ogni funzione che invia qualcosa consuma token sul tuo account presso il servizio, e i costi potrebbero essere alti. MindRoot non li conosce: verificali con il tuo servizio.',
      'ai.ghost': 'Suggerimenti in trasparenza',
      'ai.ghostHint': 'Parole tenui dopo il cursore mentre scrivi, e rami tenui accanto al nodo selezionato dopo una pausa. Tab li accetta; qualsiasi altro tasto li lascia. Ogni pausa invia le parole del nodo e dei suoi vicini.',
      'ai.chat': 'Chatta con l\'AI',
      'ai.chatHint': 'Una conversazione a parte che può trasformare un\'idea, un progetto, un libro o un esame in una mappa, o aggiungere rami al nodo selezionato. Si invia solo quello che scrivi lì. Le chat restano in questo browser: metti tra i segnalibri quelle da tenere, elimina le altre.',
      'ai.chatMap': 'Fai leggere alla chat la mappa aperta',
      'ai.chatMapHint': 'I titoli della mappa aperta vanno con ogni messaggio, con il nodo selezionato segnato, così le risposte ci stanno dentro.',
      'ai.chatScope': 'Cosa può leggere la chat',
      'ai.chatScope.node': 'Il nodo selezionato',
      'ai.chatScope.map': 'La mappa aperta',
      'ai.chatScope.project': 'Tutto il progetto',
      'ai.chatScopeHint.node': 'Con ogni messaggio va solo il titolo del nodo selezionato.',
      'ai.chatScopeHint.map': 'La mappa aperta va con ogni messaggio, intera, come Markdown, con il nodo selezionato indicato, così le risposte ci stanno dentro e la chat può cambiarla.',
      'ai.chatScopeHint.project': 'Tutte le mappe del progetto aperto vanno con ogni messaggio, intere, come Markdown (prima la mappa aperta), così le risposte possono collegarle e la chat può cambiarle. Si invia di più e costa di più.',
      'ai.chatBoards': 'Le lavagne delle mappe che legge',
      'ai.chatBoards.off': 'Non lette',
      'ai.chatBoards.text': 'Il loro testo',
      'ai.chatBoards.pictures': 'Testo e immagini',
      'ai.chatBoardsHint.off': 'Le lavagne restano fuori dalla chat.',
      'ai.chatBoardsHint.text': 'Quello che è scritto su una lavagna con lo strumento testo va con ogni messaggio. I disegni a mano non si leggono.',
      'ai.chatBoardsHint.pictures': 'Il testo, e fino a quattro pagine delle lavagne come immagini, con ogni messaggio: l\'AI vede anche i disegni. Le immagini consumano molti più token, a ogni messaggio, e i costi potrebbero essere alti.',
      'ai.guide': 'Con un\'altra AI',
      'ai.guideHint': 'Per far creare a un\'altra AI (qualsiasi assistente in chat) un progetto MindRoot intero dai tuoi documenti: dalle questa guida e i documenti, salva come file il JSON che scrive e importalo (barra laterale, Importa).',
      'ai.copyGuide': 'Copia la guida per un\'altra AI',
      'ai.guideCopied': 'Guida copiata.',
      'ai.guideFailed': 'Questo browser non ha voluto copiarla.',
      'ai.readProjects': 'Progetti che la chat può leggere da ovunque',
      'ai.readProjectsHint': 'Tutte le mappe di un progetto spuntato vanno con ogni messaggio di qualsiasi chat, intere, qualunque progetto sia aperto, e la chat può cambiarle. Mai le immagini; 30.000 caratteri per mappa e 160.000 in tutto, il resto si lascia fuori e si dice.',
      'ai.onMap': 'Sulla mappa',
      'ai.labels': 'Mostra chi ha scritto ogni nodo',
      'ai.labelsHint': 'Una piccola etichetta su ogni nodo: AI, Misto (parole dell\'AI e tue) o Umano. Non si invia nulla; resta nella mappa come segno nascosto.',
      'ai.by.ai': 'AI',
      'ai.by.mixed': 'Misto',
      'ai.by.human': 'Umano',
      'ai.label.ghostBranch': 'aggiungi un ramo suggerito',
      'ai.sprouts.aria': 'Rami suggeriti per «{node}». Premi Tab per aggiungere «{first}».',
      'ai.sprout.take': 'Aggiungi «{title}»',
      'ai.cmd.chat': 'Chatta con l\'AI'
    }
  });

  function t(key, vars) { return ns.i18n.t(key, vars); }
  function h() { return ns.util.h.apply(null, arguments); }
  function prefs() { return ns.prefs; }
  function AI() { return ns.ai; }

  /* What is shown while the model works: a small glass sphere with light
   * circling in it and a sparkle at its heart, the words of what is being
   * done, and placeholder lines that shimmer where the answer will go. All
   * of it is decoration (aria-hidden) but the words, which are the status;
   * the panel's rim circles too while this is in it (ai.css). */
  function busyView(words) {
    var orb = h('div', { class: 'ai-orb', 'aria-hidden': 'true' },
      h('span', { class: 'ai-orb__blob ai-orb__blob--a' }),
      h('span', { class: 'ai-orb__blob ai-orb__blob--b' }),
      h('span', { class: 'ai-orb__blob ai-orb__blob--c' }),
      h('span', { class: 'ai-orb__ring' }),
      h('span', { class: 'ai-orb__spark' }, ns.ui.icon('sparkles')));
    var lines = h('div', { class: 'ai-skel', 'aria-hidden': 'true' },
      h('span', { class: 'ai-skel__line' }), h('span', { class: 'ai-skel__line' }), h('span', { class: 'ai-skel__line' }));
    return h('div', { class: 'ai-busy' }, orb, h('p', { class: 'ai-panel__busy', role: 'status', text: words }), lines);
  }

  /* ---------------------------------------------------------------- errors */

  var lastErrorAt = 0;

  function errorText(err) {
    var code = err && err.code;
    var key = 'ai.err.' + code;
    return ns.i18n.has && !ns.i18n.has(key) ? t('ai.err.bad') : t(key);
  }

  /* A failure while the person is typing is said once in a while, never at
   * every pause. */
  function quietError(err) {
    if (!err || err.code === 'aborted') return;
    var now = Date.now();
    if (now - lastErrorAt < ERROR_QUIET) return;
    lastErrorAt = now;
    if (ns.ui && ns.ui.toast) ns.ui.toast(errorText(err), { kind: 'error' });
  }

  /* ---------------------------------------------------------------- what is sent */

  function clip(text, n) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    return text.length > n ? text.slice(0, n - 1) + '…' : text;
  }

  /* A node's words as plain text (no marks, no picture markup): what is shown in
   * a panel's title and what is sent. */
  function plain(state, path) {
    var e = state && state.byPath ? state.byPath[path] : null;
    return e ? ns.doc.plainText(e) : '';
  }

  /* The choice of language for a request: automatic, the app's, or one of the
   * list; `value` is the preference's own ('' automatic). */
  function languageSelect(id, value) {
    var sel = h('select', { class: 'select ai-select', id: id });
    sel.appendChild(h('option', { value: '', text: t('ai.lang.auto') }));
    sel.appendChild(h('option', { value: 'app', text: t('ai.lang.app') }));
    AI().LANGUAGES.forEach(function (l) { sel.appendChild(h('option', { value: l.id, text: l.label })); });
    sel.value = value;
    if (sel.value !== value) sel.value = '';
    return sel;
  }

  function parentOf(path) {
    if (path === null || path === undefined || path === '') return null;
    var i = path.lastIndexOf('.');
    return i < 0 ? '' : path.slice(0, i);
  }

  /* The words about a node that may be sent: its parents (nearest six), its
   * siblings, its sub-branches, the words under it, the map's name. The text
   * being typed is added by the caller (it is not in the map yet). */
  function contextFor(path, extra) {
    var S = ns.session;
    var D = ns.doc;
    var c = S && typeof S.current === 'function' ? S.current() : null;
    var out = {};
    if (!c || !c.state || !D) return Object.assign(out, extra || {});
    var state = c.state;
    var entry = state.byPath[path];
    var ancestors = [];
    var p = parentOf(path);
    while (p !== null && ancestors.length < 6) {
      if (state.byPath[p]) ancestors.unshift(clip(plain(state, p), 80));
      p = parentOf(p);
    }
    out.ancestors = ancestors.filter(Boolean);
    var par = parentOf(path);
    var parent = par !== null ? state.byPath[par] : null;
    if (parent && parent.children) {
      out.siblings = parent.children.filter(function (e) { return e.path !== path; }).slice(0, 12).map(function (e) { return clip(plain(state, e.path), 60); }).filter(Boolean);
    } else out.siblings = [];
    out.children = entry && entry.children ? entry.children.slice(0, 20).map(function (e) { return clip(plain(state, e.path), 60); }).filter(Boolean) : [];
    out.body = clip(D.bodyFor(state, path), 500);
    out.node = clip(plain(state, path), 120);
    try {
      var m = ns.store && ns.store.map ? ns.store.map(c.projectId, c.mapId) : null;
      if (m && m.name) out.map = clip(m.name, 80);
    } catch (err) { /* no name */ }
    if (extra && extra.withOutline && AI() && AI().settings().outline) {
      out.outline = outlineOf(state, path);
      out.outlineBodies = !!AI().settings().outlineBodies;
    }
    return Object.assign(out, extra || {});
  }

  /* The titles of the whole open map, indented, the node being worked on
   * marked with an arrow; never another map. With the second switch
   * (outlineBodies) the words written under a node follow its title, on a
   * line of their own starting with '-': in full near the node (400
   * characters), shortened elsewhere (160). Long maps are cut to what is
   * near the node (the top levels, and its parents, siblings and children),
   * and the words of the far nodes go first. */
  function outlineOf(state, path) {
    var D = ns.doc;
    var bodies = !!(AI() && AI().settings().outlineBodies);
    var LINES = 250;
    var CHARS = bodies ? 14000 : 6000;
    var near = Object.create(null);
    function mark(p) { if (p !== null && p !== undefined && state.byPath[p]) near[p] = true; }
    var p = path;
    while (p !== null) { mark(p); p = parentOf(p); }
    var par = parentOf(path);
    var parent = par !== null ? state.byPath[par] : null;
    if (parent && parent.children) parent.children.forEach(function (e) { mark(e.path); });
    var self = state.byPath[path];
    if (self && self.children) self.children.forEach(function (e) { mark(e.path); });
    function make(keep, words) {
      var out = [];
      state.flat.forEach(function (e) {
        var depth = e.path === '' ? 0 : String(e.path).split('.').length;
        if (!keep(e, depth)) return;
        var title = clip(plain(state, e.path), 60);
        if (!title) return;
        var pad = new Array(depth + 1).join('  ');
        out.push((e.path === path ? '→ ' : '  ') + pad + title);
        if (bodies && words(e)) {
          var text = String(D.bodyFor(state, e.path) || '').replace(/\s+/g, ' ').trim();
          if (text) out.push('    ' + pad + '- ' + clip(text, words(e)));
        }
      });
      return out;
    }
    function everywhere() { return true; }
    function all400(e) { return near[e.path] ? 400 : 160; }
    function onlyNear(e) { return near[e.path] ? 400 : 0; }
    var all = make(everywhere, all400);
    var text = all.join('\n');
    if (all.length > LINES || text.length > CHARS) {
      all = make(everywhere, onlyNear);
      text = all.join('\n');
    }
    if (all.length > LINES || text.length > CHARS) {
      all = make(function (e, depth) { return depth <= 2 || near[e.path]; }, onlyNear);
      text = all.join('\n');
      if (all.length > LINES || text.length > CHARS) {
        all = all.slice(0, LINES);
        text = all.join('\n').slice(0, CHARS);
      }
      text += '\n  …';
    }
    return text;
  }

  /* ---------------------------------------------------------------- the window: AI assistant */

  /* The models the provider offered, kept while the window lives: who asked
   * (the provider and whether a key was there) decides if they still hold. */
  var models = { provider: '', list: null, loading: false };

  function modelsHold() {
    var s = AI().settings();
    return !!models.list && models.provider === s.provider + '|' + (s.provider === 'custom' ? s.baseUrl : '');
  }

  function statusLine() {
    var s = AI().settings();
    var st = AI().status();
    if (!s.complete && !s.branches && !s.emoji && !s.images && !s.describe && !s.ghost && !s.chat) return t('ai.line.off');
    if (st.state === 'nokey') return t('ai.line.nokey');
    if (st.state === 'locked') return t('ai.line.locked');
    if (st.state === 'nobase') return t('ai.line.nobase');
    return t('ai.line.ready', { provider: t('ai.provider.' + s.provider), model: AI().modelOf() || '?' });
  }

  /* The form, painted into `host` and again at every change (the focus found
   * again by id). */
  function panel(host) {
    var keyDraft = { mode: null, text: '', pass: '' };
    var note = { text: '', kind: '' };
    var other = false;        // "Another name…" chosen in the model list

    function say(text, kind) { note.text = text || ''; note.kind = kind || ''; paint(); }
    function set(patch) { prefs().set('ai', patch); }

    function field(id, label, hint, control, extra) {
      var box = h('div', { class: 'ai-field' });
      box.appendChild(h('label', { class: 'ai-field__label', for: id, id: id + '-label', text: label }));
      if (control) {
        /* The control named by the label: an input, a select or a group of
         * choices; a wrapper round one holds the control with that id inside. */
        var named = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) || control.getAttribute('role') === 'radiogroup';
        if (named && !control.id) control.id = id;
        if (control.getAttribute('role') === 'radiogroup') { control.removeAttribute('aria-label'); control.setAttribute('aria-labelledby', id + '-label'); }
        box.appendChild(control);
      }
      if (extra) box.appendChild(extra);
      if (hint) box.appendChild(h('p', { class: 'ai-field__hint', text: hint }));
      return box;
    }

    function seg(name, options, value, onPick) {
      var group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name });
      options.forEach(function (o) {
        var b = h('button', { type: 'button', class: 'seg__opt', role: 'radio', 'data-value': o.value, 'aria-checked': String(o.value === value), tabindex: o.value === value ? '0' : '-1' }, h('span', { text: o.label }));
        b.addEventListener('click', function () { if (o.value !== value) onPick(o.value); });
        group.appendChild(b);
      });
      return group;
    }

    function switchRow(id, label, hint, key) {
      var sw = h('button', { type: 'button', class: 'switch', role: 'switch', id: id, 'aria-checked': String(!!AI().settings()[key]), 'aria-labelledby': id + '-label' });
      sw.addEventListener('click', function () {
        var patch = {};
        patch[key] = sw.getAttribute('aria-checked') !== 'true';
        set(patch);
        paint();
      });
      return h('div', { class: 'ai-switch' },
        h('div', { class: 'ai-switch__text' },
          h('label', { class: 'ai-field__label', id: id + '-label', for: id, text: label }),
          h('p', { class: 'ai-field__hint', text: hint })),
        sw);
    }

    function keyLine() {
      var s = AI().settings();
      var ks = AI().keyState();
      if (ks === 'none') return t('ai.keyState.none');
      if (ks === 'locked') return t('ai.keyState.locked');
      return t('ai.keyState.' + (s.keyMode === 'device' ? 'device' : (s.keyMode === 'locked' ? 'ready' : 'session')));
    }

    function loadModels() {
      if (AI().keyState() === 'none' && AI().settings().provider !== 'custom') { say(t('ai.needKey'), 'error'); return Promise.resolve(); }
      var s = AI().settings();
      models.loading = true;
      paint();
      return AI().listModels().then(function (list) {
        models.loading = false;
        models.provider = s.provider + '|' + (s.provider === 'custom' ? s.baseUrl : '');
        models.list = list;
        other = false;
        say(list.length ? t('ai.modelsLoaded', { n: list.length }) : t('ai.modelsNone'), list.length ? 'ok' : 'warn');
      }, function (err) {
        models.loading = false;
        say(errorText(err), 'error');
      });
    }

    /* The model: a list once the provider has been asked, a name to type
     * until then (or when the one wanted is not in the list). */
    function modelControl(s) {
      var def = AI().PROVIDERS[s.provider].model;
      if (modelsHold() && models.list.length) {
        var inList = !s.model || models.list.some(function (m) { return m.id === s.model; });
        var pick = h('select', { class: 'select ai-select', id: 'ai-model-pick' });
        var defaultOffered = !def || models.list.some(function (m) { return m.id === def; });
        pick.appendChild(h('option', { value: '', text: t('ai.modelDefault', { model: def || '-' }), disabled: defaultOffered ? null : true }));
        models.list.forEach(function (m) {
          pick.appendChild(h('option', { value: m.id, text: m.label !== m.id ? m.label + ' (' + m.id + ')' : m.id }));
        });
        pick.appendChild(h('option', { value: '__other', text: t('ai.modelOther') }));
        pick.value = (!inList || other) ? '__other' : (s.model || (defaultOffered ? '' : ''));
        pick.addEventListener('change', function () {
          if (pick.value === '__other') { other = true; paint(); return; }
          other = false;
          set({ model: pick.value });
          paint();
        });
        var wrap = h('div', { class: 'ai-model' }, pick);
        if (!inList || other) {
          var typed = h('input', { class: 'input', id: 'ai-model', type: 'text', value: s.model, placeholder: def || 'model', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('ai.model') });
          typed.addEventListener('change', function () { set({ model: typed.value.trim() }); paint(); });
          wrap.appendChild(typed);
        }
        return wrap;
      }
      var input = h('input', { class: 'input', id: 'ai-model', type: 'text', value: s.model, placeholder: def || 'model', autocomplete: 'off', spellcheck: 'false' });
      input.addEventListener('change', function () { set({ model: input.value.trim() }); paint(); });
      return h('div', { class: 'ai-model' }, input,
        ns.ui.button({ label: models.loading ? t('ai.loading') : t('ai.loadModels'), kind: 'text', id: 'ai-load', onClick: loadModels }));
    }

    /* The nearest ancestor that scrolls, to keep where the person was
     * reading when the form is painted again. */
    function scroller() {
      for (var el = host.parentNode; el && el.nodeType === 1; el = el.parentNode) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      }
      return null;
    }

    function paint() {
      var s = AI().settings();
      var ks = AI().keyState();
      var focus = host.contains(document.activeElement) ? document.activeElement.id : '';
      var sc = scroller();
      var top = sc ? sc.scrollTop : 0;
      host.textContent = '';
      var form = h('div', { class: 'ai-form' });
      host.appendChild(form);
      form.appendChild(h('p', { class: 'ai-form__intro', text: t('ai.intro') }));
      form.appendChild(h('p', { class: 'ai-form__intro ai-form__cost', id: 'ai-cost', text: t('ai.costNotice') }));

      /* provider (and the address of "Other") */
      form.appendChild(field('ai-provider', t('ai.provider'), null, seg(t('ai.provider'), ['anthropic', 'openai', 'custom'].map(function (p) { return { value: p, label: t('ai.provider.' + p) }; }), s.provider, function (v) { set({ provider: v, model: '' }); models.list = null; other = false; paint(); })));
      if (s.provider === 'custom') {
        var base = h('input', { class: 'input', id: 'ai-base', type: 'url', value: s.baseUrl, placeholder: 'https://…/v1', autocomplete: 'off', spellcheck: 'false' });
        base.addEventListener('change', function () { set({ baseUrl: base.value.trim() }); models.list = null; paint(); });
        form.appendChild(field('ai-base', t('ai.base'), s.baseUrl && !AI().validBase(s.baseUrl) ? t('ai.baseBad') : t('ai.baseHint'), base));
      }

      /* the key: pasted, saved, and the models asked for at once */
      var mode = keyDraft.mode || s.keyMode;
      var keyBox = h('input', { class: 'input', id: 'ai-key', type: 'password', value: keyDraft.text, placeholder: t('ai.keyPlaceholder'), autocomplete: 'off', spellcheck: 'false', 'data-lpignore': 'true' });
      keyBox.addEventListener('input', function () { keyDraft.text = keyBox.value; });
      keyBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } });
      var saveBtn = ns.ui.button({ label: t('ai.saveCheck'), kind: 'primary', id: 'ai-save', onClick: function () {
        if (!keyDraft.text.trim()) { keyBox.focus(); return; }
        AI().setKey(keyDraft.text, mode, keyDraft.pass).then(function (r) {
          set({ keyMode: mode });
          keyDraft = { mode: null, text: '', pass: '' };
          if (r.kept === 'memory') note = { text: t('ai.keyMemory'), kind: 'warn' };
          else note = { text: t('ai.keySaved'), kind: 'ok' };
          return loadModels();
        }, function (err) { say(err && err.code === 'bad' ? t('ai.keyShort') : errorText(err), 'error'); });
      } });
      form.appendChild(field('ai-key', t('ai.key'), keyLine(), h('div', { class: 'ai-row' }, keyBox, saveBtn)));
      form.appendChild(field('ai-keymode', t('ai.keyMode'), t('ai.keyHint.' + mode), seg(t('ai.keyMode'), ['session', 'device', 'locked'].map(function (m) { return { value: m, label: t('ai.keyMode.' + m) }; }), mode, function (v) { keyDraft.mode = v; paint(); })));
      if (mode === 'locked') {
        var pass = h('input', { class: 'input', id: 'ai-pass', type: 'password', value: keyDraft.pass, autocomplete: 'off', spellcheck: 'false', placeholder: t('ai.passphrase') });
        pass.addEventListener('input', function () { keyDraft.pass = pass.value; });
        form.appendChild(field('ai-pass', t('ai.passphrase'), null, pass));
      }
      if (ks === 'locked') {
        var unlockPass = h('input', { class: 'input', id: 'ai-unlock-pass', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: t('ai.passphrase') });
        var go = function () {
          AI().unlock(unlockPass.value).then(function () { note = { text: t('ai.keyState.ready'), kind: 'ok' }; return loadModels(); }, function () { say(t('ai.wrongPass'), 'error'); });
        };
        unlockPass.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        form.appendChild(field('ai-unlock-pass', t('ai.unlockTitle'), null, h('div', { class: 'ai-row' }, unlockPass, ns.ui.button({ label: t('ai.unlock'), kind: 'primary', id: 'ai-unlock', onClick: go }))));
      }
      if (ks !== 'none') {
        form.appendChild(h('div', { class: 'ai-row ai-row--end' }, ns.ui.button({ label: t('ai.forget'), kind: 'text', id: 'ai-forget', onClick: function () { AI().clearKey(); models.list = null; note = { text: '', kind: '' }; paint(); } })));
      }

      /* the model */
      form.appendChild(field('ai-model', t('ai.model'), modelsHold() && models.list.length ? t('ai.modelPickHint') : t('ai.modelHint', { model: AI().PROVIDERS[s.provider].model || '-' }), modelControl(s)));

      /* the language of what it writes */
      var langSel = languageSelect('ai-lang', s.lang);
      langSel.addEventListener('change', function () { set({ lang: langSel.value }); paint(); });
      form.appendChild(field('ai-lang', t('ai.lang'), t('ai.langHint'), langSel));

      /* the features */
      form.appendChild(h('h4', { class: 'ai-form__sub', text: t('ai.features') }));
      form.appendChild(switchRow('ai-complete', t('ai.complete'), t('ai.completeHint'), 'complete'));
      form.appendChild(switchRow('ai-ghost', t('ai.ghost'), t('ai.ghostHint'), 'ghost'));
      form.appendChild(switchRow('ai-chat', t('ai.chat'), t('ai.chatHint'), 'chat'));
      if (s.chat) {
        /* What the chat may read where it is opened, and which projects it may read from anywhere. */
        var scope = seg(t('ai.chatScope'), ['node', 'map', 'project'].map(function (v) { return { value: v, label: t('ai.chatScope.' + v) }; }), s.chatScope, function (v) {
          set({ chatScope: v, chatMap: v !== 'node' });
          paint();
        });
        form.appendChild(field('ai-chat-scope', t('ai.chatScope'), t('ai.chatScopeHint.' + s.chatScope), scope));
        var boards = seg(t('ai.chatBoards'), ['off', 'text', 'pictures'].map(function (v) { return { value: v, label: t('ai.chatBoards.' + v) }; }), s.chatBoards, function (v) { set({ chatBoards: v }); paint(); });
        form.appendChild(field('ai-chat-boards', t('ai.chatBoards'), t('ai.chatBoardsHint.' + s.chatBoards), boards));
        var projects = ns.store && ns.store.projects ? ns.store.projects() : [];
        if (projects.length) {
          var on = {};
          s.readProjects.forEach(function (id) { on[id] = true; });
          var list = h('div', { class: 'ai-projects', role: 'group', 'aria-labelledby': 'ai-read-projects-label' });
          projects.forEach(function (p) {
            var id = 'ai-read-' + p.id;
            var box = h('input', { type: 'checkbox', id: id, 'data-project': p.id });
            box.checked = !!on[p.id];
            box.addEventListener('change', function () {
              var next = {};
              AI().settings().readProjects.forEach(function (k) { next[k] = true; });
              if (box.checked) next[p.id] = true; else delete next[p.id];
              set({ readProjects: next });
              paint();
            });
            list.appendChild(h('label', { class: 'ai-panel__item', for: id }, box, h('span', { text: p.name || '' })));
          });
          var box2 = h('div', { class: 'ai-field' },
            h('span', { class: 'ai-field__label', id: 'ai-read-projects-label', text: t('ai.readProjects') }),
            list,
            h('p', { class: 'ai-field__hint', text: t('ai.readProjectsHint') }));
          form.appendChild(box2);
        }
      }
      /* Another AI can write a whole project too: the guide to give it. */
      var guide = ns.ui.button({ label: t('ai.copyGuide'), kind: 'text', icon: 'copy', id: 'ai-copy-guide', onClick: function () {
        var text = AI().formatGuide();
        var ok = function () { say(t('ai.guideCopied'), 'ok'); };
        try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, function () { say(t('ai.guideFailed'), 'error'); }); return; } } catch (err) { /* below */ }
        say(t('ai.guideFailed'), 'error');
      } });
      form.appendChild(field('ai-copy-guide', t('ai.guide'), t('ai.guideHint'), h('div', { class: 'ai-row' }, guide)));
      form.appendChild(switchRow('ai-branches', t('ai.branches'), t('ai.branchesHint'), 'branches'));
      if (s.branches) form.appendChild(switchRow('ai-outline', t('ai.outline'), t('ai.outlineHint'), 'outline'));
      if (s.branches && s.outline) form.appendChild(switchRow('ai-outline-bodies', t('ai.outlineBodies'), t('ai.outlineBodiesHint'), 'outlineBodies'));
      form.appendChild(switchRow('ai-emoji', t('ai.emoji'), t('ai.emojiHint'), 'emoji'));
      var imagesRow = switchRow('ai-images', t('ai.images'), s.provider === 'openai' ? t('ai.imagesHint') : t('ai.imagesNeedOpenAI'), 'images');
      if (s.provider !== 'openai') imagesRow.querySelector('button.switch').disabled = true;
      form.appendChild(imagesRow);
      form.appendChild(switchRow('ai-describe', t('ai.describe'), t('ai.describeHint'), 'describe'));
      if (s.images && s.provider === 'openai') {
        var imModel = h('input', { class: 'input', id: 'ai-image-model', type: 'text', value: s.imageModel, placeholder: AI().imageModel(), autocomplete: 'off', spellcheck: 'false' });
        imModel.addEventListener('change', function () { set({ imageModel: imModel.value.trim() }); paint(); });
        form.appendChild(field('ai-image-model', t('ai.imageModel'), t('ai.imageModelHint', { model: 'gpt-image-1' }), imModel));
      }

      /* what the map shows (nothing sent) */
      form.appendChild(h('h4', { class: 'ai-form__sub', text: t('ai.onMap') }));
      form.appendChild(switchRow('ai-labels', t('ai.labels'), t('ai.labelsHint'), 'labels'));

      /* a test of the whole path, and what has gone out */
      var test = ns.ui.button({ label: t('ai.test'), kind: 'text', id: 'ai-test', onClick: function () {
        if (AI().keyState() === 'none' && AI().settings().provider !== 'custom') { say(t('ai.needKey'), 'error'); return; }
        say(t('ai.testing'), '');
        AI().test().then(function (r) {
          if (r.models) { models.provider = s.provider + '|' + (s.provider === 'custom' ? s.baseUrl : ''); models.list = r.models; }
          if (r.modelOk) say(t('ai.testOk', { ms: r.ms }) + (r.models ? ' ' + t('ai.modelsLoaded', { n: r.models.length }) : ''), 'ok');
          else say(t('ai.testBadModel', { model: AI().modelOf() }), 'warn');
        }, function (err) { say(errorText(err), 'error'); });
      } });
      form.appendChild(h('div', { class: 'ai-row' }, test));
      form.appendChild(h('p', { class: 'ai-field__hint ai-form__note', id: 'ai-note', role: 'status', 'aria-live': 'polite', 'data-kind': note.kind, text: note.text }));
      var st = AI().stats();
      form.appendChild(h('p', { class: 'ai-field__hint ai-form__stats', id: 'ai-stats', text: t('ai.stats', { n: st.requests }) + (st.sent ? t('ai.statsLast', { kind: st.sent.kind, chars: st.sent.chars }) : '') }));

      if (focus) {
        var again = document.getElementById(focus);
        if (again) { try { again.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
      }
      var sc2 = scroller();
      if (sc2) sc2.scrollTop = top;
    }

    paint();
    return { paint: paint };
  }

  var config = null;

  /* The window of its own (the sparkles in the top bar, Ctrl+Shift+A). */
  function openConfig() {
    if (config && config.handle && config.handle.isOpen()) { config.handle.close('again'); return true; }
    var body = h('div', { class: 'ai-config__body' });
    var handle = ns.ui.sheet({
      title: t('ai.window'), body: body, desktop: 'center', cls: 'ai-config', detents: ['content', 0.92],
      onClose: function () { config = null; }
    });
    config = { handle: handle };
    panel(body);
    return true;
  }

  /* Settings -> AI: only what it is now and the door to the window. */
  function section() {
    var sec = h('section', { class: 'ws-section ai-set', 'aria-labelledby': 'set-ai' }, h('h3', { class: 'ws-section__title', id: 'set-ai', text: t('ai.title') }));
    var open = ns.ui.button({ label: t('ai.settingsOpen'), kind: 'primary', id: 'ai-open', icon: 'sparkles', onClick: function () {
      if (ns.settings && ns.settings.close) ns.settings.close();
      setTimeout(openConfig, 0);
    } });
    sec.appendChild(h('div', { class: 'ws-set' },
      h('div', { class: 'ws-set__text' },
        h('span', { class: 'ws-set__label', text: t('ai.window') }),
        h('p', { class: 'ws-set__hint', id: 'ai-status-line', text: statusLine() }),
        h('p', { class: 'ws-set__hint', text: t('ai.privacyShort') })),
      open));
    return sec;
  }

  /* ---------------------------------------------------------------- complete as you type */

  var comp = { timer: 0, ctl: null, pill: null, ghost: null, sug: '', asked: '' };

  function ghostEl() {
    if (comp.ghost) return comp.ghost;
    comp.ghost = h('div', { class: 'ai-inline', role: 'status', hidden: true });
    document.body.appendChild(comp.ghost);
    return comp.ghost;
  }

  /* The words written faintly right after the caret, in the field's own type
   * at the map's zoom; a small Tab mark at their end. */
  function showInline(ty, sug) {
    var el = ghostEl();
    el.textContent = '';
    el.setAttribute('aria-label', t('ai.pill.aria', { text: sug }));
    el.appendChild(h('span', { class: 'ai-inline__text', text: sug }));
    el.appendChild(h('kbd', { class: 'ai-inline__key', text: t('ai.pill.tab') }));
    var field = ty.el;
    var cs = getComputedStyle(field);
    var fr = field.getBoundingClientRect();
    var scale = field.offsetHeight ? fr.height / field.offsetHeight : 1;
    var caret = null;
    try {
      var sel = window.getSelection();
      if (sel && sel.rangeCount) {
        var rg = sel.getRangeAt(0).cloneRange();
        rg.collapse(false);
        var rects = rg.getClientRects();
        caret = rects.length ? rects[rects.length - 1] : rg.getBoundingClientRect();
        if (caret && !caret.height) caret = null;
      }
    } catch (err) { caret = null; }
    var lineH = caret ? caret.height : parseFloat(cs.lineHeight) * scale || fr.height;
    var left = caret ? caret.right : fr.right;
    var top = caret ? caret.top : fr.bottom - lineH;
    el.style.font = cs.font;
    el.style.fontSize = (parseFloat(cs.fontSize) * scale) + 'px';
    el.style.lineHeight = lineH + 'px';
    el.style.letterSpacing = cs.letterSpacing;
    el.style.color = cs.color;
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.maxWidth = Math.max(40, window.innerWidth - left - 8) + 'px';
    el.hidden = false;
    comp.sug = sug;
  }

  function useGhost() { return !!AI() && AI().enabled('ghost'); }

  function pillEl() {
    if (comp.pill) return comp.pill;
    comp.pill = h('div', { class: 'ai-ghost', role: 'status', hidden: true });
    document.body.appendChild(comp.pill);
    return comp.pill;
  }

  function hide() {
    clearTimeout(comp.timer);
    comp.timer = 0;
    if (comp.ctl) { try { comp.ctl.abort(); } catch (err) { /* gone */ } comp.ctl = null; }
    comp.sug = '';
    if (comp.pill) comp.pill.hidden = true;
    if (comp.ghost) comp.ghost.hidden = true;
  }

  function show(ty, sug) {
    var el = pillEl();
    el.textContent = '';
    el.setAttribute('aria-label', t('ai.pill.aria', { text: sug }));
    el.appendChild(h('kbd', { class: 'ai-ghost__key', text: t('ai.pill.tab') }));
    el.appendChild(h('span', { class: 'ai-ghost__text', text: sug.replace(/^\s+/, '') }));
    el.hidden = false;
    var r = ty.el.getBoundingClientRect();
    var w = el.offsetWidth;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var top = Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    comp.sug = sug;
  }

  function atEnd(ty) { return !!ty && ty.start === ty.end && ty.start === ty.text.length; }

  function typed() {
    hide();
    if (!AI() || !ns.editor || !(AI().enabled('complete') || AI().enabled('ghost'))) return;
    var ty = ns.editor.typing();
    if (!atEnd(ty) || ty.text.trim().length < MIN_CHARS) return;
    comp.timer = setTimeout(function () {
      comp.timer = 0;
      var now = ns.editor.typing();
      if (!atEnd(now) || now.text !== ty.text || now.path !== ty.path) return;
      var ctl = new AbortController();
      comp.ctl = ctl;
      var ctx = contextFor(now.path, { field: now.field === 'body' ? 'body' : 'title', typed: now.text, signal: ctl.signal });
      AI().complete(ctx).then(function (sug) {
        if (ctl.signal.aborted || comp.ctl !== ctl) return;
        comp.ctl = null;
        var cur = ns.editor.typing();
        if (!sug || !atEnd(cur) || cur.text !== now.text || cur.path !== now.path) return;
        if (useGhost()) showInline(cur, sug); else show(cur, sug);
      }, function (err) {
        if (comp.ctl === ctl) comp.ctl = null;
        quietError(err);
      });
    }, DELAY);
  }

  /* Tab, with a suggestion showing: the words are put where the caret is. */
  function take(e) {
    var showing = (comp.pill && !comp.pill.hidden) || (comp.ghost && !comp.ghost.hidden);
    if (!comp.sug || !showing) return false;
    var sug = comp.sug;
    e.preventDefault();
    e.stopPropagation();
    hide();
    return !!ns.editor.insertText(sug, { ai: true });
  }

  /* ---------------------------------------------------------------- suggest branches */

  /* A feature that cannot run says why - and the window where it is put right
   * opens - instead of simply not being there. */
  function explainOff(feature) {
    var s = AI().settings();
    var st = AI().status();
    var why;
    if (!s[feature]) why = t({ branches: 'ai.off', emoji: 'ai.offEmoji', images: 'ai.offImages', describe: 'ai.offDescribe' }[feature] || 'ai.off');
    else if (feature === 'images' && s.provider !== 'openai') why = t('ai.imagesNeedOpenAI');
    else if (st.state === 'nokey') why = t('ai.err.nokey');
    else if (st.state === 'locked') why = t('ai.err.locked');
    else if (st.state === 'nobase') why = t('ai.baseBad');
    else why = t('ai.off');
    if (ns.ui && ns.ui.toast) ns.ui.toast(why);
    setTimeout(openConfig, 0);
    return false;
  }

  function openBranches(path) {
    var S = ns.session;
    if (path === undefined || path === null) path = S && S.selected ? S.selected() : null;
    if (!AI() || !AI().enabled('branches')) return explainOff('branches');
    var ed = ns.editor;
    var c = S && S.current ? S.current() : null;
    if (path === null || path === undefined || !c || !c.state.byPath[path] || !ed) return false;
    var base = contextFor(path, { count: 5, withOutline: true });
    var node = base.node || '';
    var st = { items: [], on: {}, loading: true, error: '', avoid: [], ctl: null, lang: AI().settings().lang };
    var body = h('div', { class: 'ai-panel' });
    var handle = ns.ui.sheet({
      title: t('ai.panel.title', { node: clip(node, 40) }), body: body, desktop: 'center', cls: 'ai-sheet', detents: ['content', 0.8],
      onClose: function () { if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } } }
    });

    function ask() {
      if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } }
      var ctl = new AbortController();
      st.ctl = ctl;
      st.loading = true;
      st.error = '';
      paint();
      AI().suggestBranches(Object.assign({}, contextFor(path, { count: 5, avoid: st.avoid.slice(-12), signal: ctl.signal, withOutline: true, lang: st.lang }))).then(function (list) {
        if (ctl.signal.aborted) return;
        st.loading = false;
        st.items = list;
        st.on = {};
        list.forEach(function (x) { st.on[x] = true; });
        st.avoid = st.avoid.concat(list);
        paint();
      }, function (err) {
        if (ctl.signal.aborted || (err && err.code === 'aborted')) return;
        st.loading = false;
        st.items = [];
        st.error = errorText(err);
        paint();
      });
    }

    function chosen() { return st.items.filter(function (x) { return st.on[x]; }); }

    /* The language of the titles: the one in use is selected; another one asks again. */
    function langRow() {
      var sel = languageSelect('ai-branch-lang', st.lang);
      sel.addEventListener('change', function () { st.lang = sel.value; st.avoid = []; ask(); });
      return h('div', { class: 'ai-field' }, h('label', { class: 'ai-field__label', for: 'ai-branch-lang', text: t('ai.branches.lang') }), sel);
    }

    function paint() {
      var focus = body.contains(document.activeElement) ? document.activeElement.getAttribute('data-ai') : '';
      body.textContent = '';
      if (st.loading) {
        body.appendChild(busyView(t('ai.panel.busy')));
        return;
      }
      if (st.error) {
        body.appendChild(langRow());
        body.appendChild(h('p', { class: 'ai-panel__error', role: 'alert', text: st.error }));
        var again2 = ns.ui.button({ label: t('ai.panel.retry'), kind: 'primary', onClick: ask });
        again2.setAttribute('data-ai', 'again');
        body.appendChild(h('div', { class: 'ai-panel__actions' }, again2));
        return;
      }
      if (!st.items.length) {
        body.appendChild(langRow());
        body.appendChild(h('p', { class: 'ai-panel__empty', text: t('ai.panel.none') }));
        var retry = ns.ui.button({ label: t('ai.panel.again'), kind: 'primary', onClick: ask });
        retry.setAttribute('data-ai', 'again');
        body.appendChild(h('div', { class: 'ai-panel__actions' }, retry));
        return;
      }
      body.appendChild(langRow());
      body.appendChild(h('p', { class: 'ws-set__hint', text: t('ai.panel.hint') }));
      var list = h('ul', { class: 'ai-panel__list' });
      st.items.forEach(function (title, i) {
        var box = h('input', { type: 'checkbox', id: 'ai-pick-' + i, 'data-ai': 'pick-' + i });
        box.checked = !!st.on[title];
        box.addEventListener('change', function () { st.on[title] = box.checked; syncAdd(); });
        list.appendChild(h('li', null, h('label', { class: 'ai-panel__item', for: 'ai-pick-' + i }, box, h('span', { text: title }))));
      });
      body.appendChild(list);
      var add = ns.ui.button({ label: '', kind: 'primary', onClick: function () {
        var picked = chosen();
        if (!picked.length) return;
        var made = ed.addChildren(path, picked, 'ai.label.addBranches', { by: 'ai' });
        handle.close('done');
        if (made && ns.ui.toast) ns.ui.toast(t('ai.panel.added', { n: made }));
      } });
      add.setAttribute('data-ai', 'add');
      var again = ns.ui.button({ label: t('ai.panel.again'), kind: 'text', onClick: ask });
      again.setAttribute('data-ai', 'again');
      body.appendChild(h('div', { class: 'ai-panel__actions' }, add, again));
      function syncAdd() {
        var n = chosen().length;
        add.textContent = n === 1 ? t('ai.panel.addOne') : t('ai.panel.add', { n: n });
        add.disabled = !n;
      }
      syncAdd();
      if (focus) {
        var back = body.querySelector('[data-ai="' + focus + '"]');
        if (back) back.focus();
      }
    }

    ask();
    return true;
  }

  /* ---------------------------------------------------------------- an icon for a node */

  var ICON_LEAD = /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)\s*/u;

  /* The title without the icon it starts with, if any. */
  function stripIcon(title) { return String(title || '').replace(ICON_LEAD, ''); }
  function hasIcon(title) { return ICON_LEAD.test(String(title || '')); }

  function node(path) {
    var S = ns.session;
    var c = S && S.current ? S.current() : null;
    if (path === undefined || path === null) path = S && S.selected ? S.selected() : null;
    if (path === null || path === undefined || !c || !c.state || !c.state.byPath[path]) return null;
    return { path: path, state: c.state };
  }

  function openEmoji(path) {
    var n = node(path);
    if (!AI() || !AI().enabled('emoji')) return explainOff('emoji');
    if (!ns.editor || !n) return false;
    path = n.path;
    var title = plain(n.state, path);
    var st = { items: [], loading: true, error: '', avoid: [], ctl: null };
    var body = h('div', { class: 'ai-panel' });
    var handle = ns.ui.sheet({
      title: t('ai.emoji.title', { node: clip(title, 40) }), body: body, desktop: 'center', cls: 'ai-sheet', detents: ['content', 0.6],
      onClose: function () { if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } } }
    });

    function ask() {
      if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } }
      var ctl = new AbortController();
      st.ctl = ctl;
      st.loading = true;
      st.error = '';
      paint();
      AI().suggestEmoji(contextFor(path, { signal: ctl.signal })).then(function (list) {
        if (ctl.signal.aborted) return;
        st.loading = false;
        st.items = list.filter(function (x) { return st.avoid.indexOf(x) < 0; });
        st.avoid = st.avoid.concat(st.items);
        paint();
      }, function (err) {
        if (ctl.signal.aborted || (err && err.code === 'aborted')) return;
        st.loading = false;
        st.error = errorText(err);
        paint();
      });
    }

    function put(icon) {
      var plain = stripIcon(ns.doc.titleFor(node(path).state, path));
      var next = icon ? icon + ' ' + plain : plain;
      var ok = ns.editor.setTitle(path, next, icon ? 'ai.label.icon' : 'ai.label.noIcon', icon ? { ai: true } : null);
      handle.close('done');
      return ok;
    }

    function paint() {
      body.textContent = '';
      if (st.loading) { body.appendChild(busyView(t('ai.panel.busy'))); return; }
      if (st.error) {
        var retry = ns.ui.button({ label: t('ai.panel.retry'), kind: 'primary', onClick: ask });
        retry.setAttribute('data-ai', 'again');
        body.appendChild(h('p', { class: 'ai-panel__error', role: 'alert', text: st.error }));
        body.appendChild(h('div', { class: 'ai-panel__actions' }, retry));
        return;
      }
      if (!st.items.length) body.appendChild(h('p', { class: 'ai-panel__empty', text: t('ai.emoji.none') }));
      else {
        body.appendChild(h('p', { class: 'ws-set__hint', text: t('ai.emoji.hint') }));
        var grid = h('div', { class: 'ai-emoji', role: 'group', 'aria-label': t('ai.emoji.title', { node: clip(title, 40) }) });
        st.items.forEach(function (e) {
          var b = h('button', { type: 'button', class: 'ai-emoji__btn', 'data-emoji': e, 'aria-label': e, text: e });
          b.addEventListener('click', function () { put(e); });
          grid.appendChild(b);
        });
        body.appendChild(grid);
      }
      var actions = h('div', { class: 'ai-panel__actions' });
      var again = ns.ui.button({ label: t('ai.panel.again'), kind: st.items.length ? 'text' : 'primary', onClick: ask });
      again.setAttribute('data-ai', 'again');
      actions.appendChild(again);
      if (hasIcon(ns.doc.titleFor(node(path).state, path))) {
        var none = ns.ui.button({ label: t('ai.emoji.remove'), kind: 'text', onClick: function () { put(''); } });
        none.setAttribute('data-ai', 'remove');
        actions.appendChild(none);
      }
      body.appendChild(actions);
    }

    ask();
    return true;
  }

  /* ---------------------------------------------------------------- pictures for a node */

  function b64File(pic, name) {
    var bin = atob(pic.b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var ext = pic.mime === 'image/jpeg' ? 'jpg' : (pic.mime === 'image/webp' ? 'webp' : 'png');
    return new File([bytes], name + '.' + ext, { type: pic.mime });
  }

  function defaultDescription(path) {
    var c = contextFor(path);
    var where = c.ancestors && c.ancestors.length ? t('ai.images.where', { path: c.ancestors.slice(-2).join(' > ') }) : '';
    return t('ai.images.default', { node: c.node || '', where: where }) + ' ' + t('ai.images.style');
  }

  function openImages(path) {
    var n = node(path);
    if (!AI() || !AI().enabled('images')) return explainOff('images');
    if (!n) return false;
    path = n.path;
    var title = plain(n.state, path);
    var st = { pics: [], pick: -1, loading: false, error: '', said: '', ctl: null, text: defaultDescription(path) };
    var body = h('div', { class: 'ai-panel ai-pics' });
    var handle = ns.ui.sheet({
      title: t('ai.images.title', { node: clip(title, 40) }), body: body, desktop: 'center', cls: 'ai-sheet', detents: ['content', 0.92],
      onClose: function () { if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } } }
    });

    function make() {
      if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } }
      var ctl = new AbortController();
      st.ctl = ctl;
      st.loading = true;
      st.error = '';
      st.said = '';
      st.pick = -1;
      paint();
      AI().generateImages({ prompt: st.text, n: 3, signal: ctl.signal }).then(function (list) {
        if (ctl.signal.aborted) return;
        st.loading = false;
        st.pics = list;
        paint();
      }, function (err) {
        if (ctl.signal.aborted || (err && err.code === 'aborted')) return;
        st.loading = false;
        st.pics = [];
        st.error = errorText(err);
        /* A refusal says why in the provider's own words: shown, never hidden. */
        st.said = err && err.message && err.code !== 'aborted' && /^(auth|bad|model|rate)$/.test(err.code) && err.message.length > 6 ? err.message : '';
        paint();
      });
    }

    function use() {
      var pic = st.pics[st.pick];
      if (!pic || !ns.media || typeof ns.media.addFiles !== 'function') { if (ns.ui.toast) ns.ui.toast(t('ai.images.failed'), { kind: 'error' }); return; }
      var file = b64File(pic, 'illustration');
      handle.close('done');
      ns.media.addFiles([file], { path: path, field: 'line' }).then(function (r) {
        if (ns.ui.toast) ns.ui.toast(r && r.added ? t('ai.images.added') : t('ai.images.failed'), r && r.added ? undefined : { kind: 'error' });
      }, function () { if (ns.ui.toast) ns.ui.toast(t('ai.images.failed'), { kind: 'error' }); });
    }

    function paint() {
      var focus = body.contains(document.activeElement) ? document.activeElement.getAttribute('data-ai') : '';
      body.textContent = '';
      var box = h('textarea', { class: 'input ai-pics__text', id: 'ai-images-text', rows: '4', 'aria-label': t('ai.images.describe'), maxlength: '1000' });
      box.value = st.text;
      box.disabled = st.loading;
      box.addEventListener('input', function () { st.text = box.value; });
      body.appendChild(h('label', { class: 'ai-field__label', for: 'ai-images-text', text: t('ai.images.describe') }));
      body.appendChild(box);
      body.appendChild(h('p', { class: 'ai-field__hint', text: t('ai.images.hint') }));
      if (st.loading) {
        body.appendChild(busyView(t('ai.images.busy')));
        return;
      }
      if (st.error) {
        body.appendChild(h('p', { class: 'ai-panel__error', role: 'alert', text: st.error }));
        if (st.said) body.appendChild(h('p', { class: 'ai-field__hint', text: t('ai.images.said', { text: clip(st.said, 300) }) }));
      }
      if (st.pics.length) {
        var row = h('div', { class: 'ai-pics__row', role: 'radiogroup', 'aria-label': t('ai.images.title', { node: clip(title, 40) }) });
        st.pics.forEach(function (pic, i) {
          var b = h('button', { type: 'button', class: 'ai-pic', role: 'radio', 'aria-checked': String(i === st.pick), 'data-pic': String(i), 'aria-label': t('ai.images.pick', { n: i + 1 }) });
          b.appendChild(h('img', { src: 'data:' + pic.mime + ';base64,' + pic.b64, alt: '', draggable: 'false' }));
          b.addEventListener('click', function () { st.pick = i; paint(); });
          b.addEventListener('dblclick', function () { st.pick = i; use(); });
          row.appendChild(b);
        });
        body.appendChild(row);
      }
      var actions = h('div', { class: 'ai-panel__actions' });
      if (st.pics.length) {
        var useBtn = ns.ui.button({ label: t('ai.images.use'), kind: 'primary', onClick: use });
        useBtn.setAttribute('data-ai', 'use');
        useBtn.disabled = st.pick < 0;
        actions.appendChild(useBtn);
      }
      var go = ns.ui.button({ label: st.pics.length ? t('ai.images.more') : t('ai.images.go'), kind: st.pics.length ? 'text' : 'primary', onClick: make });
      go.setAttribute('data-ai', 'make');
      actions.appendChild(go);
      body.appendChild(actions);
      if (focus) {
        var back = body.querySelector('[data-ai="' + focus + '"]');
        if (back && !back.disabled) back.focus();
      }
    }

    paint();
    return true;
  }

  /* ---------------------------------------------------------------- what a picture shows */

  function photosOf(path) {
    var M = ns.media;
    var list = M && typeof M.picturesOf === 'function' ? M.picturesOf(path) : [];
    return list.filter(function (p) { return p.kind === 'photo'; });
  }

  /* A picture of the project, reduced to at most `max` px on its longest side
   * and as JPEG (white behind what is see-through): what is sent, and shown
   * in the panel. */
  function reducedPicture(dataUrl, max) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onerror = function () { reject(new Error('unreadable')); };
      img.onload = function () {
        var w = img.naturalWidth || 1;
        var hh = img.naturalHeight || 1;
        var f = Math.min(1, max / Math.max(w, hh));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * f));
        cv.height = Math.max(1, Math.round(hh * f));
        var g = cv.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, cv.width, cv.height);
        try { g.drawImage(img, 0, 0, cv.width, cv.height); } catch (err) { reject(err); return; }
        var url = cv.toDataURL('image/jpeg', 0.85);
        resolve({ mime: 'image/jpeg', b64: url.slice(url.indexOf(',') + 1), url: url });
      };
      img.src = dataUrl;
    });
  }

  function openDescribe(path) {
    var n = node(path);
    if (!AI() || !AI().enabled('describe')) return explainOff('describe');
    if (!n) return false;
    path = n.path;
    var pics = photosOf(path);
    if (!pics.length) { if (ns.ui && ns.ui.toast) ns.ui.toast(t('ai.describe.nopic')); return false; }
    var D = ns.doc;
    var cur = ns.session.current();
    var title = plain(n.state, path);
    var st = { which: 0, shown: null, loading: false, error: '', result: null, ctl: null, useTitle: !title.trim(), useText: true, lang: AI().settings().lang };
    var body = h('div', { class: 'ai-panel ai-desc' });
    var handle = ns.ui.sheet({
      title: t('ai.describe.title', { node: clip(title || ' ', 40) }), body: body, desktop: 'center', cls: 'ai-sheet', detents: ['content', 0.92],
      onClose: function () { if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } } }
    });

    function load() {
      st.shown = null;
      st.result = null;
      return ns.storage.assetDataURL(ns.store, cur.projectId, pics[st.which].path).then(function (url) {
        if (!url) throw new Error('unreadable');
        return reducedPicture(url, 1024);
      }).then(function (red) { st.shown = red; paint(); }, function () { st.error = t('ai.describe.unreadable'); paint(); });
    }

    function ask() {
      if (!st.shown) return;
      if (st.ctl) { try { st.ctl.abort(); } catch (err) { /* gone */ } }
      var ctl = new AbortController();
      st.ctl = ctl;
      st.loading = true;
      st.error = '';
      paint();
      AI().describeImage({ mime: st.shown.mime, b64: st.shown.b64, ctx: contextFor(path, { lang: st.lang }), signal: ctl.signal }).then(function (r) {
        if (ctl.signal.aborted) return;
        st.loading = false;
        st.result = r;
        paint();
      }, function (err) {
        if (ctl.signal.aborted || (err && err.code === 'aborted')) return;
        st.loading = false;
        st.error = errorText(err);
        paint();
      });
    }

    function apply() {
      var titleBox = body.querySelector('#ai-desc-title');
      var textBox = body.querySelector('#ai-desc-text');
      var now = node(path);
      if (!now) { handle.close('gone'); return; }
      var texts = {};
      if (st.useTitle && titleBox && titleBox.value.trim()) texts.title = titleBox.value.trim();
      if (st.useText && textBox && textBox.value.trim()) {
        var old = D.bodyFor(now.state, path);
        texts.body = old && old.trim() ? old + '\n' + textBox.value.trim() : textBox.value.trim();
      }
      var ok = Object.keys(texts).length ? ns.editor.setTexts(path, texts, 'ai.label.describe', { ai: true }) : false;
      handle.close('done');
      return ok;
    }

    function paint() {
      var focus = body.contains(document.activeElement) ? document.activeElement.id : '';
      body.textContent = '';
      if (pics.length > 1) {
        var which = h('div', { class: 'ai-field', role: 'group' });
        var row = h('div', { class: 'ai-row' });
        pics.forEach(function (p, i) {
          var b = ns.ui.button({ label: t('ai.describe.which', { n: i + 1 }), kind: i === st.which ? 'primary' : 'text', onClick: function () { if (st.which !== i) { st.which = i; st.error = ''; load(); } } });
          row.appendChild(b);
        });
        which.appendChild(row);
        body.appendChild(which);
      }
      if (st.shown) body.appendChild(h('img', { class: 'ai-desc__pic', src: st.shown.url, alt: '' }));
      body.appendChild(h('p', { class: 'ai-field__hint', text: t('ai.describe.sent', { provider: t('ai.provider.' + AI().settings().provider) }) }));
      var dl = languageSelect('ai-desc-lang', st.lang);
      dl.disabled = st.loading;
      dl.addEventListener('change', function () { st.lang = dl.value; });
      body.appendChild(h('div', { class: 'ai-field' }, h('label', { class: 'ai-field__label', for: 'ai-desc-lang', text: t('ai.describe.lang') }), dl));
      if (st.loading) { body.appendChild(busyView(t('ai.describe.busy'))); return; }
      if (st.error) body.appendChild(h('p', { class: 'ai-panel__error', role: 'alert', text: st.error }));
      if (st.result) {
        var tb = h('input', { class: 'input', id: 'ai-desc-title', type: 'text', maxlength: '120' });
        tb.value = st.result.title;
        var xb = h('textarea', { class: 'input ai-pics__text', id: 'ai-desc-text', rows: '4', maxlength: '600' });
        xb.value = st.result.text;
        body.appendChild(h('div', { class: 'ai-field' }, h('label', { class: 'ai-field__label', for: 'ai-desc-title', text: t('ai.describe.titleField') }), tb));
        body.appendChild(h('div', { class: 'ai-field' }, h('label', { class: 'ai-field__label', for: 'ai-desc-text', text: t('ai.describe.textField') }), xb));
        var c1 = h('input', { type: 'checkbox', id: 'ai-desc-use-title' });
        c1.checked = st.useTitle;
        c1.addEventListener('change', function () { st.useTitle = c1.checked; });
        var c2 = h('input', { type: 'checkbox', id: 'ai-desc-use-text' });
        c2.checked = st.useText;
        c2.addEventListener('change', function () { st.useText = c2.checked; });
        body.appendChild(h('label', { class: 'ai-panel__item', for: 'ai-desc-use-title' }, c1, h('span', { text: t('ai.describe.useTitle') })));
        body.appendChild(h('label', { class: 'ai-panel__item', for: 'ai-desc-use-text' }, c2, h('span', { text: t('ai.describe.useText') })));
      }
      var actions = h('div', { class: 'ai-panel__actions' });
      if (st.result) {
        var add = ns.ui.button({ label: t('ai.describe.apply'), kind: 'primary', id: 'ai-desc-apply', onClick: apply });
        actions.appendChild(add);
      }
      var go = ns.ui.button({ label: st.result ? t('ai.describe.again') : t('ai.describe.go'), kind: st.result ? 'text' : 'primary', id: 'ai-desc-go', onClick: ask });
      go.disabled = !st.shown;
      actions.appendChild(go);
      body.appendChild(actions);
      if (focus) { var back = document.getElementById(focus); if (back && !back.disabled) { try { back.focus({ preventScroll: true }); } catch (err) { /* gone */ } } }
    }

    paint();
    load();
    return true;
  }

  /* ---------------------------------------------------------------- ghost branches */

  var SPROUT_DELAY = 900;    // ms a node stays selected before branches are asked for
  var SPROUTS = 3;
  var sp = { timer: 0, ctl: null, path: null, key: '', items: [], el: null, cache: new Map() };

  function sproutsEl() {
    if (sp.el) return sp.el;
    sp.el = h('div', { class: 'ai-sprouts', role: 'group', hidden: true });
    document.body.appendChild(sp.el);
    return sp.el;
  }

  function sproutsShowing() { return !!sp.el && !sp.el.hidden && sp.items.length > 0; }

  function hideSprouts(keep) {
    clearTimeout(sp.timer);
    sp.timer = 0;
    if (sp.ctl) { try { sp.ctl.abort(); } catch (err) { /* gone */ } sp.ctl = null; }
    if (!keep) { sp.items = []; sp.path = null; sp.key = ''; }
    if (sp.el) sp.el.hidden = true;
  }

  /* What the node is now, as a key: a suggestion holds while its node, its
   * words and its branches stay the same. */
  function sproutKey(path) {
    var c = ns.session && ns.session.current ? ns.session.current() : null;
    if (!c || !c.state || !c.state.byPath[path]) return '';
    var e = c.state.byPath[path];
    var kids = (e.children || []).map(function (k) { return plain(c.state, k.path); }).join('|');
    return c.projectId + '/' + c.mapId + '/' + path + '/' + plain(c.state, path) + '/' + kids;
  }

  function quietMap() {
    if (!ns.session || !ns.session.view || !ns.editor) return false;
    if (ns.editor.isRenaming()) return false;
    if (ns.ui && typeof ns.ui.isOpen === 'function' && ns.ui.isOpen()) return false;
    if (ns.session.readOnly && ns.session.readOnly()) return false;
    return true;
  }

  function scheduleSprouts() {
    hideSprouts();
    if (!AI() || !AI().enabled('ghost') || !ns.session) return;
    var path = ns.session.selected ? ns.session.selected() : null;
    if (path === null || path === undefined) return;
    sp.timer = setTimeout(function () {
      sp.timer = 0;
      if (!quietMap() || ns.session.selected() !== path) return;
      var key = sproutKey(path);
      if (!key) return;
      sp.path = path;
      sp.key = key;
      if (sp.cache.has(key)) { sp.items = sp.cache.get(key).slice(); placeSprouts(); return; }
      var ctl = new AbortController();
      sp.ctl = ctl;
      AI().suggestBranches(contextFor(path, { count: SPROUTS, signal: ctl.signal, withOutline: true })).then(function (list) {
        if (ctl.signal.aborted || sp.ctl !== ctl) return;
        sp.ctl = null;
        list = list.slice(0, SPROUTS);
        if (sp.cache.size > 60) sp.cache.delete(sp.cache.keys().next().value);
        sp.cache.set(key, list);
        if (ns.session.selected() !== path || sproutKey(path) !== key || !quietMap()) return;
        sp.items = list.slice();
        placeSprouts();
      }, function (err) {
        if (sp.ctl === ctl) sp.ctl = null;
        quietError(err);
      });
    }, SPROUT_DELAY);
  }

  /* The faint branches beside their node, on the side its children grow,
   * each one joined to it by a faint thread; drawn again wherever the node
   * moves (pan, zoom, layout). */
  function placeSprouts() {
    var el = sproutsEl();
    var view = ns.session && ns.session.view;
    if (!sp.items.length || !view || sp.path === null || !quietMap() || ns.session.selected() !== sp.path) { el.hidden = true; return; }
    var r = view.rect(sp.path);
    var stage = view.el ? view.el.getBoundingClientRect() : null;
    if (!r || !stage || r.right < stage.left || r.left > stage.right || r.bottom < stage.top || r.top > stage.bottom) { el.hidden = true; return; }
    var node = view.nodeEl ? view.nodeEl(sp.path) : null;
    var left = !!(node && node.classList.contains('mv-node--left'));
    var title = clip(plain(ns.session.current().state, sp.path), 40);
    /* Built again only when what is offered changes: a pan or a zoom only
     * moves it (its entrance does not play again at every frame). */
    var sig = (left ? 'l' : 'r') + '\u0001' + sp.path + '\u0001' + sp.items.join('\u0001');
    var list = el.querySelector('.ai-sprouts__list');
    var wires = el.querySelector('.ai-sprouts__wires');
    if (el.getAttribute('data-sig') !== sig || !list || !wires) {
    el.textContent = '';
    el.setAttribute('data-sig', sig);
    el.setAttribute('aria-label', t('ai.sprouts.aria', { node: title, first: sp.items[0] }));
    el.setAttribute('data-side', left ? 'left' : 'right');
    list = h('div', { class: 'ai-sprouts__list' });
    sp.items.forEach(function (item, i) {
      var b = h('button', { type: 'button', class: 'ai-sprout', tabindex: '-1', 'data-i': String(i), 'aria-label': t('ai.sprout.take', { title: item }) },
        h('span', { class: 'ai-sprout__text', text: item }),
        i === 0 ? h('kbd', { class: 'ai-sprout__key', text: t('ai.pill.tab') }) : null);
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); takeSprout(i); });
      list.appendChild(b);
    });
    wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wires.setAttribute('class', 'ai-sprouts__wires');
    wires.setAttribute('aria-hidden', 'true');
    el.appendChild(wires);
    el.appendChild(list);
    }
    el.hidden = false;
    while (wires.firstChild) wires.removeChild(wires.firstChild);
    var gap = 52;      /* past the node's thread handles */
    var w = list.offsetWidth;
    var hh = list.offsetHeight;
    var x = left ? r.left - gap - w : r.right + gap;
    var y = r.top + r.height / 2 - hh / 2;
    x = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    /* Clear of the node's own toolbar: above it when it stands under the
     * node, under it when it stands above. */
    var bar = document.querySelector('.node-toolbar');
    if (bar && !bar.hidden && bar.offsetParent !== null) {
      var b = bar.getBoundingClientRect();
      var meets = x < b.right && x + w > b.left && y < b.bottom + 6 && y + hh > b.top - 6;
      if (meets) y = b.top >= r.top + r.height / 2 ? b.top - hh - 8 : b.bottom + 8;
    }
    y = Math.max(4, Math.min(y, window.innerHeight - hh - 4));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    /* The threads, in the box's own coordinates: from the node's edge to the
     * near edge of each branch. */
    var ox = left ? r.left - x : r.right - x;
    var oy = r.top + r.height / 2 - y;
    var minX = Math.min(0, ox);
    var maxX = Math.max(w, ox);
    wires.setAttribute('viewBox', minX + ' ' + Math.min(0, oy) + ' ' + (maxX - minX) + ' ' + (Math.max(hh, oy) - Math.min(0, oy) || 1));
    wires.style.left = minX + 'px';
    wires.style.top = Math.min(0, oy) + 'px';
    wires.style.width = (maxX - minX) + 'px';
    wires.style.height = (Math.max(hh, oy) - Math.min(0, oy) || 1) + 'px';
    Array.prototype.forEach.call(list.children, function (b) {
      var by = b.offsetTop + b.offsetHeight / 2;
      var bx = left ? b.offsetLeft + b.offsetWidth : b.offsetLeft;
      var mid = (ox + bx) / 2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + ox + ' ' + oy + ' C' + mid + ' ' + oy + ' ' + mid + ' ' + by + ' ' + bx + ' ' + by);
      wires.appendChild(path);
    });
  }

  /* The branch taken becomes a child of its node, marked as the AI's; the
   * node stays selected and the other branches stay on offer. */
  function takeSprout(i) {
    if (!sproutsShowing() || !ns.editor) return false;
    var title = sp.items[i];
    var path = sp.path;
    if (!title || path === null) return false;
    var rest = sp.items.filter(function (x, k) { return k !== i; });
    var made = ns.editor.addChildren(path, [title], 'ai.label.ghostBranch', { by: 'ai' });
    if (!made) return false;
    sp.items = rest;
    var key = sproutKey(path);
    if (key) { sp.key = key; if (rest.length) sp.cache.set(key, rest.slice()); }
    if (!rest.length) hideSprouts();
    return true;
  }

  /* Tab on the map with branches on offer: the first is taken, before Tab
   * would add an empty child. Escape drops them (and goes on). */
  function onSproutKey(e) {
    if (!sproutsShowing()) return;
    if (e.key === 'Escape') { hideSprouts(); return; }
    if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (ns.util.isTextField(e.target)) return;
    if (!ns.editor || !ns.editor.canAct({ source: 'key', target: e.target, event: e })) return;
    if (ns.session.selected() !== sp.path) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    takeSprout(0);
  }

  /* ---------------------------------------------------------------- who wrote each node */

  function applyLabels() {
    var root = document.documentElement;
    var on = !!AI() && AI().settings().labels;
    if (on) {
      root.setAttribute('data-ai-labels', '');
      root.style.setProperty('--by-label-ai', JSON.stringify(t('ai.by.ai')));
      root.style.setProperty('--by-label-mixed', JSON.stringify(t('ai.by.mixed')));
      root.style.setProperty('--by-label-human', JSON.stringify(t('ai.by.human')));
    } else {
      root.removeAttribute('data-ai-labels');
    }
  }

  /* ---------------------------------------------------------------- wiring */

  /* The sparkles on the node bar: what the AI can do for this node, as a
   * menu; a single thing is simply done. */
  function nodeMenu(anchor) {
    var items = [];
    if (AI().enabled('branches')) items.push({ label: t('ai.cmd.branches'), icon: 'child', onSelect: function () { openBranches(); } });
    if (AI().enabled('emoji')) items.push({ label: t('ai.cmd.emoji'), icon: 'sparkles', onSelect: function () { openEmoji(); } });
    if (AI().enabled('images')) items.push({ label: t('ai.cmd.images'), icon: 'image', onSelect: function () { openImages(); } });
    if (AI().enabled('describe') && photosOf(ns.session.selected()).length) items.push({ label: t('ai.cmd.describe'), icon: 'image', onSelect: function () { openDescribe(); } });
    if (AI().enabled('chat') && ns.aichat) items.push({ label: t('ai.cmd.chat'), icon: 'sparkles', onSelect: function () { ns.aichat.open(); } });
    if (!items.length) return false;
    if (items.length === 1 || !anchor || !ns.ui.menu) { items[0].onSelect(); return true; }
    items.push('-');
    items.push({ label: t('ai.cmd.settings'), icon: 'sparkles', onSelect: function () { openConfig(); } });
    ns.ui.menu(anchor, items, { align: 'end', label: t('ai.cmd.menu'), title: t('ai.cmd.menu') });
    return true;
  }

  function register() {
    var C = ns.commands;
    if (!C || C.has('ai.branches')) return;
    C.register({
      id: 'ai.open', label: 'ai.window', group: 'app', icon: 'sparkles', keys: ['Mod+Shift+A'],
      keywords: t('ai.kw.open'), help: 'ai.help.open', global: true,
      run: function () { return openConfig(); }
    });
    function nodeOk(ctx) { return !!ns.editor && ns.editor.canAct(ctx) && ns.session.selected() !== null; }
    function describes() { return !!AI() && AI().enabled('describe') && photosOf(ns.session.selected()).length > 0; }
    C.register({
      id: 'ai.describe', label: 'ai.cmd.describe', group: 'node', icon: 'image',
      keywords: t('ai.kw.describe'), help: 'ai.help.describe',
      when: function (ctx) { return nodeOk(ctx) && photosOf(ns.session.selected()).length > 0; },
      run: function () { return openDescribe(); }
    });
    C.register({
      id: 'ai.menu', label: 'ai.cmd.menu', group: 'node', icon: 'sparkles', showInPalette: false, showInHelp: false,
      when: function (ctx) { return !!AI() && nodeOk(ctx) && (AI().enabled('branches') || AI().enabled('emoji') || AI().enabled('images') || describes() || AI().enabled('chat')); },
      run: function (ctx) { return nodeMenu(ctx && ctx.anchor); }
    });
    C.register({
      id: 'ai.emoji', label: 'ai.cmd.emoji', group: 'node', icon: 'sparkles',
      keywords: t('ai.kw.emoji'), help: 'ai.help.emoji',
      when: function (ctx) { return !!AI() && nodeOk(ctx); },
      run: function () { return openEmoji(); }
    });
    C.register({
      id: 'ai.images', label: 'ai.cmd.images', group: 'node', icon: 'sparkles',
      keywords: t('ai.kw.images'), help: 'ai.help.images',
      when: function (ctx) { return !!AI() && nodeOk(ctx); },
      run: function () { return openImages(); }
    });
    C.register({
      id: 'ai.branches', label: 'ai.cmd.branches', group: 'node', icon: 'sparkles', keys: ['Mod+.'],
      keywords: t('ai.kw.branches'), help: 'ai.help.branches',
      when: function (ctx) { return !!AI() && nodeOk(ctx); },
      run: function () { return openBranches(); }
    });
  }

  function init() {
    register();
    if (ns.bus) {
      ns.bus.on('editor:typed', typed);
      ns.bus.on('editor:rename', function (d) { if (!d || d.state === 'end' || d.state === 'start') hide(); });
      ns.bus.on('prefs', function (d) { if (d && d.key === 'ai') { hide(); hideSprouts(); applyLabels(); } });
      ns.bus.on('lang', applyLabels);
      ns.bus.on('selection', function () {
        /* The same node selected again (a branch just taken keeps it): what is on offer stays. */
        if (sp.items.length && ns.session.selected() === sp.path) return;
        scheduleSprouts();
      });
      ns.bus.on('editor:rename', function (d) {
        if (d && d.state === 'start') hideSprouts(true);
        /* The labels step back while a node is written into (map.css). */
        if (d && d.state === 'start') document.documentElement.setAttribute('data-ai-writing', '');
        else if (d && d.state === 'end') document.documentElement.removeAttribute('data-ai-writing');
      });
      ns.bus.on('map:opened', function () { hideSprouts(); });
      ns.bus.on('map:closed', function () { hideSprouts(); });
      var again = ns.util.throttleFrame ? ns.util.throttleFrame(function () { if (sp.items.length) placeSprouts(); }) : function () { if (sp.items.length) placeSprouts(); };
      ns.bus.on('view', again);
      ns.bus.on('layout', again);
      ns.bus.on('map:rendered', function () {
        if (!sp.items.length || sp.path === null) return;
        /* The node changed under them (its words, a branch taken): those
         * still fitting stay, else they are asked for again. */
        var key = sproutKey(sp.path);
        if (key && key === sp.key) { placeSprouts(); return; }
        if (key && sp.cache.has(key)) { sp.key = key; sp.items = sp.cache.get(key).slice(); placeSprouts(); return; }
        scheduleSprouts();
      });
    }
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', onSproutKey, true);
    applyLabels();
  }

  ns.aiui = {
    init: init,
    section: section,
    take: take,
    hide: hide,
    contextFor: contextFor,
    errorText: errorText,
    openBranches: openBranches,
    openConfig: openConfig,
    openEmoji: openEmoji,
    openImages: openImages,
    openDescribe: openDescribe,
    outlineOf: outlineOf,
    stripIcon: stripIcon,
    panel: panel,
    busyView: busyView,
    reducedPicture: reducedPicture,
    languageSelect: languageSelect,
    applyLabels: applyLabels,
    takeSprout: takeSprout,
    sprouts: function () { return sproutsShowing() ? { path: sp.path, items: sp.items.slice() } : null; },
    suggestion: function () { return comp.sug; }
  };
})(window.MindRoot);
