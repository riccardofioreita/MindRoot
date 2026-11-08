/* MindRoot - the map view: draws the tree, owns the camera, the folds and
 * the selection halo, and says what is under a pointer.
 *
 * Replaces markmap + d3. One view lives in the stage element:
 *
 *   div.mv (role tree; touch-action none; the gesture surface)
 *     div.mv-layer           the one CSS-transformed layer: translate(x, y) scale(k)
 *       svg.mv-under         halo, links and stubs, and the knobs' outer
 *                            targets (beneath the words, so a word always
 *                            wins over a knob target around it)
 *       div.mv-nodes         per drawn node a div.mv-pos (its place: left,
 *                            top, an opacity, and a scale only while it
 *                            grows in or folds away) holding the
 *                            div.mv-node (its content); HTML text, never
 *                            foreignObject on screen
 *       svg.mv-over          fold knobs (above the words: a knob sits on the
 *                            box edge, and takes the box's side padding near
 *                            it, never its words)
 *       div.mv-overlay       edge-note dots / cards, the drop line
 *     div.mv-shield          the grabbing cursor while a pointer pans
 *   (the lifted copy of a dragged node, div.mv-node.mv-ghost, lives on body)
 *
 * Why a bare div.mv-pos around each node: moving a node is one inline style
 * on an element no rule matches. Written on the content element itself (its
 * branch colour, its type rules) the same write restyles it and its
 * children, which is what a 2,000-node map's first paint was paying for.
 * The place is left/top, not a translate: a transform per node is a
 * compositing node per node, and every frame that repainted anything (each
 * key typed into a name) re-sorted thousands of them. And each .mv-pos
 * contains its own layout (map.css), so a node that grows as it is typed
 * into lays out alone, not with every other node on the map.
 *
 * A node div, div.mv-node[data-path][role=treeitem]:
 *   div.mv-title    the line: span.mv-pics--left, span.mv-task[role=
 *                   checkbox], span.mv-num, span.mv-text (the doc's safe
 *                   inline HTML), button.mv-note-dot, span.mv-pics--right;
 *                   with pictures above the words it holds
 *                   span.mv-pics--above and then a div.mv-line of the above
 *   div.mv-body     the same shape around span.mv-body-text (mv-role--*)
 *   div.mv-card--node  the note, when every note is open
 * Pictures are img.mv-img[data-src = the original path][data-kind]. Classes,
 * not :has(): mv-d0..3 (depth), mv-h1..6 (title size), mv-caption,
 * mv-node--row / col / pair / trio (room for pictures), mv-by-ai / -mixed /
 * -human (who wrote it; the label is map.css's), mv-node--left, --done,
 * --selected, --leaving, --dragging, --drop. The editor may write into a
 * node (rename); the view notices the size change by itself, and
 * view.invalidate(path) has it rebuilt from the tree at the next render.
 *
 * Stubs and links at rest are one SVG path per colour (every stub, and every
 * link whose two ends share that colour); a link between two colours is a
 * path of its own with its gradient. While a layout change plays, the nodes
 * in motion draw on paths of their own, merged back when they land.
 *
 * render(tree): reconcile node divs keyed by path. An element whose content
 * did not change is kept; one whose content moved follows it (an insert
 * shifts its siblings, a drag moves a branch, an indent changes only its
 * type size), so an edit recreates nothing it does not have to - and the
 * folds and the selection follow their nodes the same way. Then measure what
 * changed with offsetWidth/offsetHeight (layout px, blind to the zoom), lay
 * out with ns.layout (pure), and place. Places animate FLIP-style in JS, one
 * frame loop moving boxes, links, stubs, knobs, gradients and the halo
 * together (220 ms, --ease-out; new nodes grow out of their parent, removed
 * ones fold back into it), interruptible from wherever they are, instant
 * under reduced motion or in a hidden tab, and nothing ever waits for them:
 * geometry, hit-testing and the promise are about the final places. The
 * promise resolves once laid out, after the web font is in (capped) and the
 * pictures have decoded (capped); late fonts, pictures and any size change
 * made from outside (the editor typing in a node) re-lay the map by
 * themselves (ResizeObserver). view.settled() resolves once every motion
 * (layout, camera, fling) has landed.
 *
 * The camera is x, y, k with k in [0.1, 4]: where the camera rests. A
 * re-render keeps the selected node still on screen by moving the camera at
 * once, while the drawing lags it by that much and catches up over the same
 * 220 ms as the nodes. So every camera write - a pan, a fit, ensureVisible,
 * setCamera - composes with a layout that is still playing instead of
 * fighting it, and camera(), rect(), pathAt() and the events all speak of
 * where things land. Gestures come from ns.gestures. fit() is owed until
 * there is something measured to fit and a stage with a size, then paid: no
 * fitting to the previous map's box, hidden tabs included. Folded subtrees
 * are not rendered at all, and keyboard navigation helpers (visiblePaths,
 * neighbor) only see what is drawn.
 *
 * What the view decides on its own: the camera, the fit on double tap of the
 * background, the frame after a change of layout. What it only reports,
 * for its owner to apply: a knob ('knob' - call view.fold), selection
 * ('select', 'background' - call view.select), 'activate' (double click/tap
 * on a node: rename, never a zoom), 'context', 'note', 'link', 'task',
 * 'image', and the node drag ('dragstart' / 'dragmove' / 'dragend', only
 * offered when someone listens to 'dragstart'; view.dragGhost draws the
 * lifted copy).
 *
 *   create(stage, {resolveImage(path) -> url|Promise<url>|null}) -> view
 *   view.render(tree, {animate = true, keepCamera, fit, folds}) -> Promise
 *       the first render after create() or clear() fits the map unless the
 *       camera was given (setCamera / fit) or keepCamera; later renders keep
 *       the selected node (else the root) where it is on screen; folds, when
 *       given, are the fold set of this tree (else the current folds follow
 *       their nodes to their new paths)
 *   view.clear()                       forget the map (another one opens)
 *   view.setOptions({balance, branchText, notesOpen, readOnly}), options()
 *       balance: the legacy layout of a map the old 'both sides' setting
 *       drew and whose sides are not written yet (see layout.js); every
 *       other map grows where its side markers say
 *   view.select(path|null, {reveal, animate}), selected()
 *   view.pickImage({path, file, kind, field, index} | null), picked()
 *       a picture of a node picked (a click on it): a ring on it, and
 *       'pick' {picked} when that changes; a click elsewhere, another node
 *       selected or the picture gone let it go
 *   view.fold(path, bool?, {deep}), isFolded, setFolded(Set), folded(),
 *       unfoldTo(path); a first render with no folds given takes the
 *       file's <!-- markmap: fold / foldAll --> markers
 *   view.fit({animate, padding, insets, maxScale}), ensureVisible(path,
 *       {animate, toolbar}), center(path, {animate}), zoomBy(f, {x, y}
 *       client, {animate}), zoomTo(k), camera(), setCamera({x, y, k}),
 *       setInsets({top, right, bottom, left}) (else ns.shell.insets())
 *   view.nodeEl(path), rect(path) (client DOMRect), edgeMidpoint(path),
 *       pathAt(x, y), dropTarget(x, y, dragged) -> {path, where: 'before' |
 *       'after' | 'child', side: 'left' | 'right' | null (the side a drop
 *       that lands as a first-level branch grows on)}, dragGhost(path,
 *       {x, y}) -> {move(x, y) -> target, drop() -> target, cancel(), target()},
 *       threadGhost(path, 'in' | 'out', {x, y}) -> the same, for a thread
 *       pulled from the selected node ('in': off its parent, to plug into
 *       another node or let go in the open; 'out': to take another node in)
 *   view.geometry() (export), visiblePaths(), neighbor(path, dir)
 *   view.setImageResolver(fn), forgetImage(path?) (the bytes behind a
 *       picture path changed: ask again), invalidate(path?), settled(),
 *       gesture(), cancelGesture()
 *   view.on(type, fn) -> off, off(type, fn), destroy(), el
 * Events: select {path, x, y}, background {x, y}, activate {path}, context
 * {path|null, x, y, pointerType}, knob {path, deep, folded: the state the
 * knob asks for}, fold {path, folded, deep, folds} (any change of the fold
 * set, for persistence; {path: null, remapped: true, folds} when an edit
 * moved folded nodes to new paths or removed them), note {path, kind:
 * 'node'|'edge'}, link {path, href, kind: 'url'|'map', node: the id a
 * [[Map#id]] link names, else ''}, task {path},
 * bodytask {path, index} (a task box in the words under a title), grip
 * {path} (the move grip tapped, not pulled: pulled, it is a drag), wire
 * {path, wire: 'in'|'out'} (a thread handle tapped; pulled, dragstart carries
 * the same wire), image
 * {path, image: {path, kind}}, dragstart / dragmove / dragend {path, x, y,
 * cancelled}, gesture {state: pan|pinch|drag|wheel|momentum|settle|idle}
 * (the map is moving under the hand: hide floating bars; a press or a tap
 * is not a gesture), camera {x, y, k} (also 'view' on ns.bus, once a
 * frame), render {count}. */
window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var MIN_K = 0.1;
  var MAX_K = 4;
  var FIT_MAX = 1;            // a small map is shown at its own size, not blown up
  var READ_MIN = 8;           // px: a first view whose smallest titles would be smaller is unreadable...
  var FLUSH_PAUSE = 350;      // ms: on a big map, a name typed into a node lays the map out again after this pause...
  var FLUSH_LATEST = 1500;    // ms: ...or this long after the first key, whichever comes first
  var READ_AT = 11;           // px: ...and opens at this size instead, framed on the root
  var FIT_PAD = 32;           // px around a fitted map
  var REVEAL_PAD = 24;        // px kept between a revealed node and the edge
  var REVEAL_TOP = 56;        // room for the node toolbar above a revealed node
  var REVEAL_MS = 150;        // keyboard selection: the camera follows in 150 ms or less
  var KEEP = 64;              // px of the map a pan can never push off the stage
  var KNOB_R = 6;
  var KNOB_HIT = { fine: 9, coarse: 11 };   // radius on screen: 18 / 22 px targets
  var PAD_X = 12;             // a box's side padding (map.css --mv-pad-x): as far into a box as a knob reaches
  var HALO_PAD = 4;
  var STUB_DROP = 1;          // the stub's centre line sits 1px under the title
  var ENTER_SCALE = 0.96;
  var ANIM_LIMIT = 800;       // more moving nodes than this simply land
  var FONT_WAIT = 1500;
  var IMAGE_WAIT = 3000;
  var BOX_MARGIN = 160;       // room around the bounds for knob targets, halo and motion
  var EDGE_ZONE = 48;         // auto-pan while dragging near the stage edge
  var EDGE_SPEED = 0.8;       // px per ms at the very edge
  var DWELL = 500;            // ms held still over a node before a drop there means 'onto it'
  var LAYOUT_GAPS = { gapX: 72, gapY: 12, cousinGap: 24 };
  var DUR_MAP = 220;
  var DUR_CAMERA = 280;
  var instances = 0;

  var STRINGS = {
    en: {
      'mapview.label': 'Mind map',
      'mapview.keys': 'Arrows move between nodes, Enter and Tab add, F2 writes. Escape lets go of the node, then Tab leaves the map.',
      'mapview.note': 'Note: {text}',
      'mapview.edgeNote': 'Note on the link: {text}',
      'mapview.drop.left': 'A branch on the left of {name}',
      'mapview.drop.right': 'A branch on the right of {name}',
      'mapview.drop.child': 'Inside {name}',
      'mapview.drop.before': 'Before {name}',
      'mapview.drop.after': 'After {name}',
      'mapview.drop.place': 'Place it here',
      'mapview.drop.hold': 'Hold still to hang it on {name}',
      'mapview.drop.refused': 'Not here',
      'mapview.thread.in': 'Plug into {name}',
      'mapview.thread.out': 'Take in {name}',
      'mapview.thread.same': 'Already hangs from {name}',
      'mapview.thread.free': 'Let go to detach it',
      'mapview.thread.hintIn': 'Plug the thread into a node',
      'mapview.thread.hintOut': 'Reach a node to take it in',
      'mapview.task': 'Done',
      'mapview.photo': 'Picture',
      'mapview.drawing': 'Drawing',
      'mapview.missing': 'Missing picture: {path}'
    },
    it: {
      'mapview.label': 'Mappa mentale',
      'mapview.keys': 'Le frecce passano da un nodo all\'altro, Invio e Tab aggiungono, F2 scrive. Esc lascia il nodo, poi Tab esce dalla mappa.',
      'mapview.note': 'Nota: {text}',
      'mapview.edgeNote': 'Nota sul collegamento: {text}',
      'mapview.drop.left': 'Un ramo a sinistra di {name}',
      'mapview.drop.right': 'Un ramo a destra di {name}',
      'mapview.drop.child': 'Dentro {name}',
      'mapview.drop.before': 'Prima di {name}',
      'mapview.drop.after': 'Dopo {name}',
      'mapview.drop.place': 'Mettilo qui',
      'mapview.drop.hold': 'Fermati per attaccarlo a {name}',
      'mapview.drop.refused': 'Non qui',
      'mapview.thread.in': 'Collega a {name}',
      'mapview.thread.out': 'Prendi {name}',
      'mapview.thread.same': 'È già collegato a {name}',
      'mapview.thread.free': 'Rilascia per scollegarlo',
      'mapview.thread.hintIn': 'Collega il filo a un nodo',
      'mapview.thread.hintOut': 'Raggiungi un nodo per prenderlo',
      'mapview.task': 'Fatto',
      'mapview.photo': 'Immagine',
      'mapview.drawing': 'Disegno',
      'mapview.missing': 'Immagine mancante: {path}'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    if (ns.i18n && typeof ns.i18n.t === 'function') return ns.i18n.t(key, vars);
    var text = STRINGS.en[key] || key;
    return text.replace(/\{(\w+)\}/g, function (all, name) {
      return vars && vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : all;
    });
  }

  /* ---------- small helpers ---------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function escapeHtml(text) {
    if (ns.util && ns.util.escapeHtml) return ns.util.escapeHtml(text);
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function div(cls) {
    var el = document.createElement('div');
    if (cls) el.className = cls;
    return el;
  }

  function svg(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function media(q) {
    try { return window.matchMedia ? window.matchMedia(q) : null; } catch (err) { return null; }
  }

  function reducedMotion() {
    if (ns.util && typeof ns.util.reducedMotion === 'function') return ns.util.reducedMotion();
    if (document.documentElement.getAttribute('data-motion') === 'reduce') return true;
    var m = media('(prefers-reduced-motion: reduce)');
    return !!(m && m.matches);
  }

  function coarse() {
    var m = media('(pointer: coarse)');
    return !!(m && m.matches);
  }

  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (ns.util && ns.util.isTextField) return ns.util.isTextField(el);
    var tag = el.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || !!el.isContentEditable;
  }

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* Two decimals are plenty for a path on a map, and keep the strings short. */
  function f(v) { return String(Math.round(v * 100) / 100); }

  function isLocalUrl(src) { return /^(data:|blob:)/i.test(String(src || '')); }

  /* A node's colour goes into a style and an SVG stroke: only a hex colour
   * ever does (a value like url(...) there would be a request, and the map
   * makes none). Anything else is the branch's palette colour. */
  function safeColor(v) {
    var c = v && typeof v.color === 'string' ? v.color.trim() : '';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
    if (ns.colors && typeof ns.colors.paletteFor === 'function') {
      var p = String(ns.colors.paletteFor(v ? v.branchIndex : -1) || '');
      if (/^#[0-9a-f]{6}$/i.test(p)) return p.toLowerCase();
    }
    return '#2f7d5a';
  }

  function pathKey(path) { return path === '' ? 'r' : 'p' + String(path).replace(/\./g, '-'); }

  /* The parent a path names, from the path alone ('0.1' -> '0', '0' -> ''):
   * it answers for a path the new tree no longer has. */
  function pathParent(path) {
    if (path === '' || path === null || path === undefined) return null;
    var i = path.lastIndexOf('.');
    return i < 0 ? '' : path.slice(0, i);
  }

  function isInside(path, ancestor) {
    if (path === null || ancestor === null || path === undefined || ancestor === undefined) return false;
    if (ancestor === '') return path !== '';
    return path.length > ancestor.length && path.indexOf(ancestor + '.') === 0;
  }

  /* The motion tokens of motion.css, read once (and again when reduced
   * motion is switched): reading a computed style in the middle of a render
   * would make the browser restyle everything just written. */
  function motionTokens() {
    var g = ns.gestures;
    var style = getComputedStyle(document.documentElement);
    var outCss = style.getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23, 1, 0.32, 1)';
    return {
      outCss: outCss,
      map: g.duration(style.getPropertyValue('--dur-map'), DUR_MAP),
      camera: g.duration(style.getPropertyValue('--dur-camera'), DUR_CAMERA),
      out: g.easing(outCss),
      inOut: g.easing(style.getPropertyValue('--ease-in-out') || 'cubic-bezier(0.77, 0, 0.175, 1)')
    };
  }

  /* ---------- node content ---------- */

  function picsOf(images, imageAbove, drawAbove) {
    var groups = { photo: null, draw: null };
    for (var i = 0; i < (images || []).length; i++) {
      var im = images[i];
      var kind = im.kind === 'draw' ? 'draw' : 'photo';
      var g = groups[kind] || (groups[kind] = { kind: kind, side: im.side === 'right' ? 'right' : 'left', items: [] });
      g.items.push({ image: im, index: i });
    }
    if (groups.photo && imageAbove) groups.photo.side = 'above';
    if (groups.draw && drawAbove) groups.draw.side = 'above';
    return [groups.photo, groups.draw].filter(Boolean);
  }

  /* The room a box gets for its pictures: one picture beside the words
   * takes a row (480), two a pair (720), three or more a trio (960), a
   * picture over the words a column (240). Counted by picture, not by
   * kind: two drawings beside the words (two notebooks on one node) are
   * 450 px of pictures, and a row would leave the words a column one
   * letter wide. Kept as named widths so the export can match. */
  function roomOf(groups) {
    var beside = 0;
    var above = false;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].side === 'above') above = true; else beside += groups[i].items.length;
    }
    if (beside >= 3) return 4;
    if (beside === 2) return 3;
    if (beside === 1) return 2;
    return above ? 1 : 0;
  }

  var ROOMS = ['', 'mv-node--col', 'mv-node--row', 'mv-node--pair', 'mv-node--trio'];
  var BODY_ROLES = { title: true, subtitle: true, paragraph: true, caption: true };

  function picsHtml(groups, field, which) {
    var out = '';
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (group.side !== which) continue;
      out += '<span class="mv-pics mv-pics--' + group.kind + ' mv-pics--' + group.side + '">';
      for (var i = 0; i < group.items.length; i++) {
        var im = group.items[i].image;
        out += '<img class="mv-img" draggable="false" decoding="async" data-kind="' + group.kind + '" data-field="' + field +
          '" data-i="' + group.items[i].index + '" alt="' + escapeHtml(im.alt || '') + '">';
      }
      out += '</span>';
    }
    return out;
  }

  /* A box is its pictures standing above (a block of their own), then one
   * flex line: pictures on the left, the words, pictures on the right. The
   * line never wraps, so words beside a picture shrink and wrap beside it
   * instead of dropping under it; the order is the DOM's, not CSS order.
   * With nothing above, the box is the line itself; with nothing beside the
   * words either (most nodes), it is a plain block: fewer elements and no
   * flex layout is what a 2,000-node map pays less for. */
  function boxHtml(cls, groups, field, inner, beside) {
    var left = picsHtml(groups, field, 'left');
    var right = picsHtml(groups, field, 'right');
    var line = left + inner + right;
    var above = picsHtml(groups, field, 'above');
    if (!above) return '<div class="' + cls + (beside || left || right ? ' mv-line' : '') + '">' + line + '</div>';
    return '<div class="' + cls + '">' + above + '<div class="mv-line">' + line + '</div></div>';
  }

  function depthClass(v) { return 'mv-d' + Math.min(Math.max(v.depth || 0, 0), 3); }

  function imagesSig(images) {
    var out = '';
    for (var i = 0; i < (images || []).length; i++) out += images[i].path + '|' + images[i].kind + '|' + images[i].side + '|' + (images[i].alt || '') + ';';
    return out;
  }

  /* Everything inside a node box but its depth; colour and side are not
   * here either, they are set without a re-measure. */
  function contentSig(v, o) {
    var b = v.body;
    var notes = v.notes || {};
    return [
      v.html, v.titleSize || '', v.role || '', v.kind || '', v.ordered === null || v.ordered === undefined ? '' : v.ordered,
      v.task ? (v.task.checked ? 'x' : 'o') + (o.readOnly ? 'r' : '') : '',
      imagesSig(v.images), v.imageAbove ? 1 : 0, v.drawAbove ? 1 : 0,
      b ? [b.html, b.role || '', imagesSig(b.images), b.imageAbove ? 1 : 0, b.drawAbove ? 1 : 0].join('\u0002') : '',
      notes.node ? 'n' + (o.notesOpen ? notes.node : '') : '',
      v.by || ''
    ].join('\u0001');
  }

  /* Everything that changes what a node box looks like or how big it is.
   * The depth is in front of the content: two boxes with the same words at
   * two depths share their content signature, and an indent restyles the
   * element it already has. */
  function signature(v, o) { return depthClass(v) + '\u0003' + contentSig(v, o); }

  function classOf(v) {
    var body = v.body;
    var room = Math.max(roomOf(picsOf(v.images, v.imageAbove, v.drawAbove)), body ? roomOf(picsOf(body.images, body.imageAbove, body.drawAbove)) : 0);
    var cls = 'mv-node ' + depthClass(v);
    if (v.titleSize && /^h[1-6]$/.test(v.titleSize)) cls += ' mv-' + v.titleSize;
    if (v.role === 'caption') cls += ' mv-caption';
    if (v.kind === 'heading') cls += ' mv-heading';
    if (v.task && v.task.checked) cls += ' mv-node--done';
    /* Who wrote it (doc.js 'by'): the label is drawn by map.css alone, on
     * the corner, outside the flow, so it costs no measure. */
    if (v.by === 'ai' || v.by === 'mixed' || v.by === 'human') cls += ' mv-by-' + v.by;
    if (ROOMS[room]) cls += ' ' + ROOMS[room];
    return cls;
  }

  function contentHtml(v, o) {
    var titleGroups = picsOf(v.images, v.imageAbove, v.drawAbove);
    var body = v.body;
    var bodyGroups = body ? picsOf(body.images, body.imageAbove, body.drawAbove) : [];
    var inner = '';
    var beside = false;
    if (v.task) {
      inner += '<span class="mv-task" role="checkbox" aria-checked="' + (v.task.checked ? 'true' : 'false') + '"' +
        (o.readOnly ? ' aria-disabled="true"' : '') + '></span>';
      beside = true;
    }
    if (v.ordered !== null && v.ordered !== undefined) {
      inner += '<span class="mv-num">' + escapeHtml(String(v.ordered)) + '.</span>';
      beside = true;
    }
    var empty = !v.html && !titleGroups.length;
    inner += '<span class="mv-text' + (empty ? ' mv-text--empty' : '') + '">' + (v.html || '') + '</span>';
    if (v.notes && v.notes.node) {
      inner += '<button type="button" class="mv-note-dot" tabindex="-1"></button>';
      beside = true;
    }
    var html = boxHtml('mv-title', titleGroups, 't', inner, beside);
    if (body) {
      html += boxHtml('mv-body' + (BODY_ROLES[body.role] ? ' mv-role--' + body.role : ''), bodyGroups, 'b',
        '<span class="mv-body-text">' + (body.html || '') + '</span>', false);
    }
    if (o.notesOpen && v.notes && v.notes.node) {
      html += '<div class="mv-card mv-card--node">' + escapeHtml(v.notes.node).replace(/\n/g, '<br>') + '</div>';
    }
    return { cls: classOf(v), html: html };
  }

  /* ---------- folds through an edit ---------- */

  /* Where each fold goes when the tree changes under it. moves maps the
   * path of every node that was drawn to its path in the new tree (null:
   * gone). A fold rides with the nearest drawn node at or above it - itself,
   * or the folded node that hid it - keeping its place under that node; a
   * fold whose node is gone goes with it; a fold nothing is known about
   * stays where it is. exists(path) says the new tree has a node with
   * children there. Pure, for the unit suite. */
  function carryFolds(folded, moves, exists) {
    var out = new Set();
    var list = [];
    if (folded && typeof folded.forEach === 'function') folded.forEach(function (p) { list.push(String(p)); });
    list.forEach(function (p) {
      var segs = p === '' ? [] : p.split('.');
      for (var n = segs.length; n >= 0; n--) {
        var at = segs.slice(0, n).join('.');
        if (!moves.has(at)) continue;
        var to = moves.get(at);
        if (to === null || to === undefined) return;
        var rest = segs.slice(n).join('.');
        var q = rest ? (to === '' ? rest : to + '.' + rest) : to;
        if (exists(q)) out.add(q);
        return;
      }
      if (exists(p)) out.add(p);
    });
    return out;
  }

  function sameSet(a, b) {
    if (a.size !== b.size) return false;
    var same = true;
    a.forEach(function (x) { if (!b.has(x)) same = false; });
    return same;
  }

  /* ---------- the view ---------- */

  function create(stage, settings) {
    settings = settings || {};
    var id = 'mv' + (++instances);
    var opts = { balance: false, branchText: false, notesOpen: false, readOnly: false };

    var root = div('mv');
    root.id = id;
    /* A Tab stop once it holds nodes (finish). */
    root.tabIndex = -1;
    root.setAttribute('role', 'tree');
    root.setAttribute('aria-label', t('mapview.label'));
    /* Tab and Shift+Tab edit the map while a node is chosen: how to leave
     * it is said where a screen reader announces the tree. */
    root.setAttribute('aria-description', t('mapview.keys'));
    var layer = div('mv-layer');
    var under = svg('svg', { class: 'mv-under', 'aria-hidden': 'true', focusable: 'false' });
    var defs = svg('defs', {});
    var haloRect = svg('rect', { class: 'mv-halo', rx: 6, ry: 6 });
    haloRect.style.display = 'none';
    var gLinks = svg('g', { class: 'mv-links' });
    var gHits = svg('g', { class: 'mv-hits' });
    under.appendChild(defs);
    under.appendChild(haloRect);
    under.appendChild(gLinks);
    under.appendChild(gHits);
    var nodesBox = div('mv-nodes');
    var over = svg('svg', { class: 'mv-over', 'aria-hidden': 'true', focusable: 'false' });
    var gKnobs = svg('g', { class: 'mv-knobs' });
    over.appendChild(gKnobs);
    var overlay = div('mv-overlay');
    var dropLine = div('mv-drop-line');
    dropLine.hidden = true;
    overlay.appendChild(dropLine);
    /* Where a dragged branch will hang: the link it will grow from, dashed,
     * and, dropped into a node, the place it takes among the children. */
    var dropLink = svg('path', { class: 'mv-drop-link' });
    dropLink.style.display = 'none';
    under.appendChild(dropLink);
    var dropSlot = div('mv-drop-slot');
    dropSlot.hidden = true;
    overlay.appendChild(dropSlot);
    /* The move grip of the selected node: it says a branch can be picked up
     * and put anywhere, and pulling it does. Drawn at one size on screen
     * whatever the zoom, at the node's outer top corner. */
    var grip = div('mv-grip');
    var GRIP = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 30 : 22;
    grip.hidden = true;
    grip.setAttribute('aria-hidden', 'true');
    grip.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-move"></use></svg>';
    overlay.appendChild(grip);
    /* The two threads of the selected node: 'in' sits on the thread that
     * holds it to its parent (pulled, that thread comes off and is plugged
     * into another node, or let go in the open to detach); 'out' pulls a
     * new thread from the node to another node, which becomes its child. */
    var wires = {};
    ['in', 'out'].forEach(function (w) {
      var el = div('mv-wire mv-wire--' + w);
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('data-wire', w);
      el.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-thread"></use></svg>';
      overlay.appendChild(el);
      wires[w] = el;
    });
    layer.appendChild(under);
    layer.appendChild(nodesBox);
    layer.appendChild(over);
    layer.appendChild(overlay);
    root.appendChild(layer);
    /* The grabbing hand while panning, on a pane of its own: set on the
     * root, an inherited cursor would restyle every node at the start and
     * the end of each pan. */
    var shield = div('mv-shield');
    shield.hidden = true;
    root.appendChild(shield);
    stage.insertBefore(root, stage.firstChild);

    var tree = null;
    var index = new Map();          // path -> {view, parent, pos, size}
    var recs = new Map();           // path -> live record
    var leaving = new Set();        // records folding back into their parent
    var geo = null;                 // the last layout
    var linkTo = new Map();         // child path -> layout link
    var cam = { x: 0, y: 0, k: 1 }; // where the camera rests: what everything reads and writes
    var lag = { x: 0, y: 0 };       // map px the drawing still trails the camera by
    var size = { w: 0, h: 0 };
    var rectCache = null;
    var folds = new Set();
    var foldsGiven = false;
    var selected = null;
    var listeners = Object.create(null);
    var gen = 0;
    var pending = 0;                // updates not yet laid out (fonts, pictures)
    var flight = null;
    var camMotion = null;
    var owed = [];                  // fits asked for before there was anything to fit
    var cameraGiven = false;        // the owner placed the camera: no automatic fit
    var waiting = null;             // an update waiting for the stage to be displayed
    var imageUrls = new Map();      // asset path -> url | null | Promise
    var imageGen = 0;
    var resolver = settings.resolveImage || null;
    var insets = null;
    var ghost = null;
    var dirty = new Set();
    var flushTimer = 0;
    var flushCost = 0;              // ms the last re-layout for changed sizes took
    var flushSince = 0;             // when the sizes waiting for a re-layout started changing
    var viewFrame = 0;
    var knobHit = coarse() ? KNOB_HIT.coarse : KNOB_HIT.fine;
    var hitR = { under: knobHit, over: KNOB_R };   // knob target radii in map px, for the current zoom
    var buckets = new Map();        // colour -> the path of every stub and plain link in it
    var idleWaiters = [];
    var tokens = null;
    var reported = 'idle';
    var destroyed = false;

    function tokensNow() {
      var rm = reducedMotion();
      if (!tokens || tokens.reduced !== rm) {
        tokens = motionTokens();
        tokens.reduced = rm;
      }
      return tokens;
    }

    /* ---------- events ---------- */

    function on(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
      return function off() { offEvent(type, fn); };
    }

    function offEvent(type, fn) {
      var list = listeners[type];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }

    function hasListener(type) { return !!(listeners[type] && listeners[type].length); }

    /* One listener that throws does not silence the others; the error still
     * surfaces (asynchronously) so it is never swallowed. */
    function emit(type, detail) {
      var list = listeners[type];
      if (!list || !list.length) return;
      list.slice().forEach(function (fn) {
        try { fn(detail); } catch (err) { setTimeout(function () { throw err; }); }
      });
    }

    /* ---------- the tree ---------- */

    function reindex() {
      index = new Map();
      if (!tree) return;
      (function walk(v, parent) {
        var kids = v.children || [];
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          index.set(k.path, { view: k, parent: v.path === null || v.path === undefined ? null : v.path, pos: i + 1, size: kids.length });
          walk(k, k.path);
        }
      })(tree, null);
      if (tree.path !== null && tree.path !== undefined) index.set(tree.path, { view: tree, parent: null, pos: 1, size: 1 });
    }

    function seedFolds() {
      (function walk(v, all) {
        var kids = v.children || [];
        var here = all || v.fold === 'foldAll';
        if (v.path !== null && v.path !== undefined && kids.length && (here || v.fold === 'fold')) folds.add(v.path);
        for (var i = 0; i < kids.length; i++) walk(kids[i], here);
      })(tree, false);
    }

    /* Every real node, in document order. */
    function allViews() {
      var out = [];
      if (!tree) return out;
      (function walk(v) {
        if (v.path !== null && v.path !== undefined) out.push(v);
        var kids = v.children || [];
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
      })(tree);
      return out;
    }

    function visibleSet() {
      var out = new Set();
      if (!tree) return out;
      (function walk(v) {
        var real = v.path !== null && v.path !== undefined;
        if (real) out.add(v);
        if (real && folds.has(v.path)) return;
        var kids = v.children || [];
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
      })(tree);
      return out;
    }

    function parentOf(path) {
      var info = index.get(path);
      return info ? info.parent : null;
    }

    function hasKids(path) {
      var info = index.get(path);
      return !!(info && info.view.children && info.view.children.length);
    }

    /* ---------- records: one per drawn node ---------- */

    function makeRec(path) {
      return {
        path: path, el: null, pos: null, title: null, sig: null, csig: null, view: null,
        w: 0, h: 0, base: 0, x: 0, y: 0, sx: 0, sy: 0, op: 1, sc: 1,
        side: null, hasKids: false, hub: false, folded: false, parentRec: null,
        color: null, fresh: true, dirty: true, leaving: false, moving: false, anim: false,
        knob: null, hit: null, glink: null, grad: null, dyn: null, dot: null,
        aria: '', cls: '', enterFrom: null, built: false, drawn: null
      };
    }

    /* New nodes are made from one HTML string, parsed once: on a first
     * render of 2,000 nodes that is one parse instead of 2,000. They start
     * transparent until they have a place (opacity, not visibility: that one
     * is inherited, and lifting it would restyle everything inside). */
    function build(list) {
      var html = '';
      var contents = new Array(list.length);
      var arias = new Array(list.length);
      for (var i = 0; i < list.length; i++) {
        var c = contents[i] = contentHtml(list[i].view, opts);
        var a = arias[i] = ariaOf(list[i].path, list[i].view);
        /* The branch colour is in the first style too: set afterwards, an
         * inherited custom property would restyle every element inside. */
        list[i].color = safeColor(list[i].view);
        html += '<div class="mv-pos" style="opacity:0"><div class="' + c.cls + (list[i].path === selected ? ' mv-node--selected' : '') +
          '" style="--branch:' + list[i].color + '"' + ariaHtml(list[i].path, a) + '>' + c.html + '</div></div>';
      }
      /* Safe to parse: the words are the doc's own inline HTML (escaped,
       * then a whitelist let back in), everything else here is escaped, a
       * number, a class of ours or a checked hex colour. */
      var tpl = document.createElement('template');
      tpl.innerHTML = html;
      var els = Array.prototype.slice.call(tpl.content.children);
      nodesBox.appendChild(tpl.content);
      for (var k = 0; k < list.length; k++) {
        var r = list[k];
        r.pos = els[k];
        r.el = els[k].firstChild;
        r.el.__mvRec = r;
        r.cls = contents[k].cls;
        r.aria = arias[k].key;
        r.domPath = r.path;
        r.built = true;
        filled(r, r.view, contents[k].html);
        if (ro) ro.observe(r.el);
      }
    }

    function decorate(r, cls) {
      return cls + (r.side === 'left' ? ' mv-node--left' : '') + (r.path === selected ? ' mv-node--selected' : '');
    }

    function fill(r, v) {
      var c = contentHtml(v, opts);
      r.cls = c.cls;
      r.el.className = decorate(r, c.cls);
      r.el.innerHTML = c.html;
      filled(r, v, c.html);
    }

    /* The same words at another depth (an indent, an outdent, a branch
     * dragged to another level): only the type size changes, so only the
     * class does; the element, its pictures and its place stay. */
    function restyle(r, v) {
      var cls = classOf(v);
      if (cls !== r.cls) {
        r.cls = cls;
        r.el.className = decorate(r, cls);
      }
      r.dirty = true;
    }

    /* What a node needs once its markup is in: links kept out of the tab
     * order (the map has one tab stop), pictures asked for. */
    function filled(r, v, html) {
      r.title = r.el.firstChild;
      r.dirty = true;
      r.pics = hasPictures(v);
      if (html.indexOf('<a') >= 0) {
        var anchors = r.el.querySelectorAll('a');
        for (var a = 0; a < anchors.length; a++) {
          anchors[a].setAttribute('tabindex', '-1');
          anchors[a].setAttribute('draggable', 'false');
        }
      }
      if (!r.pics) return;
      var imgs = r.el.querySelectorAll('img.mv-img');
      for (var i = 0; i < imgs.length; i++) {
        var list = imgs[i].getAttribute('data-field') === 'b' ? (v.body && v.body.images) : v.images;
        var im = list ? list[+imgs[i].getAttribute('data-i')] : null;
        if (im) loadImage(imgs[i], im);
      }
    }

    function hasPictures(v) {
      return !!((v.images && v.images.length) || (v.body && v.body.images && v.body.images.length));
    }

    function labelKey(r) {
      var notes = (r.view && r.view.notes) || {};
      return (ns.i18n && ns.i18n.lang ? ns.i18n.lang() : '') + '\u0001' + (notes.node || '') + '\u0001' + (notes.edge || '');
    }

    function label(r) {
      var v = r.view;
      if (!v) return;
      r.labelled = labelKey(r);
      var dot = v.notes && v.notes.node ? r.el.querySelector('.mv-note-dot') : null;
      if (dot) {
        dot.setAttribute('aria-label', t('mapview.note', { text: v.notes.node }));
        dot.title = v.notes.node;
      }
      var task = v.task ? r.el.querySelector('.mv-task') : null;
      if (task) task.setAttribute('aria-label', t('mapview.task'));
      var imgs = r.pics ? r.el.querySelectorAll('img.mv-img') : [];
      for (var i = 0; i < imgs.length; i++) labelPicture(imgs[i]);
      /* A note on the link arriving at a node is said with the node: the
       * dot on the curve is a pointer target only (a tree may hold tree
       * items and nothing else). */
      var edge = v.notes && v.notes.edge;
      if (edge) r.el.setAttribute('aria-description', t('mapview.edgeNote', { text: edge }));
      else r.el.removeAttribute('aria-description');
      if (r.dot) {
        r.dot.setAttribute('aria-label', t('mapview.edgeNote', { text: edge || '' }));
        r.dot.title = edge || '';
      }
    }

    function labelPicture(img) {
      if (img.getAttribute('data-broken') === 'true') {
        img.alt = t('mapview.missing', { path: img.getAttribute('data-src') || '' });
        img.removeAttribute('aria-label');
        return;
      }
      var alt = img.__mvAlt === undefined ? (img.getAttribute('alt') || '') : img.__mvAlt;
      img.alt = alt;
      if (alt) img.removeAttribute('aria-label');
      else img.setAttribute('aria-label', t(img.getAttribute('data-kind') === 'draw' ? 'mapview.drawing' : 'mapview.photo'));
    }

    /* Matches the drawn nodes to the new tree, over every node of it (also
     * the ones a fold hides: a drawn node may have moved under one). In
     * turn: the same content at the same path; the same content elsewhere
     * (a sibling shifted by an insert, a branch moved by a drag), preferring
     * one under the same parent; the same words at another depth (an
     * indent: only the type size changes); and only then an element at the
     * same path refilled. The folds and the selection follow the nodes they
     * belong to (carry: the tree changed; not when the caller gave the
     * folds of the new tree). Then what a fold hides is let go, what is
     * left over folds away, and what is missing is made. */
    function reconcile(views, carry) {
      var pool = [];
      recs.forEach(function (r) { pool.push(r); });
      leaving.forEach(function (r) { pool.push(r); });
      var byPath = new Map();
      pool.forEach(function (r) { if (!byPath.has(r.path) || !r.leaving) byPath.set(r.path, r); });
      var n = views.length;
      var sigs = new Array(n);
      var csigs = new Array(n);
      var i;
      for (i = 0; i < n; i++) {
        csigs[i] = contentSig(views[i], opts);
        sigs[i] = depthClass(views[i]) + '\u0003' + csigs[i];
      }
      var chosen = new Array(n);
      var claimed = new Set();
      for (i = 0; i < n; i++) {
        var same = byPath.get(views[i].path);
        if (same && same.sig === sigs[i] && !claimed.has(same)) { chosen[i] = same; claimed.add(same); }
      }
      function matchBy(keyOf, keys) {
        var by = new Map();
        pool.forEach(function (r) {
          var key = keyOf(r);
          if (claimed.has(r) || key === null || key === undefined) return;
          var list = by.get(key);
          if (!list) by.set(key, list = []);
          list.push(r);
        });
        if (!by.size) return;
        for (var j = 0; j < n; j++) {
          if (chosen[j]) continue;
          var cands = by.get(keys[j]);
          if (!cands || !cands.length) continue;
          var parent = pathParent(views[j].path);
          var pick = -1;
          for (var c = 0; c < cands.length; c++) {
            if (claimed.has(cands[c])) continue;
            if (pick < 0) pick = c;
            if (pathParent(cands[c].path) === parent) { pick = c; break; }
          }
          if (pick >= 0) {
            chosen[j] = cands[pick];
            claimed.add(cands[pick]);
            cands.splice(pick, 1);
          }
        }
      }
      matchBy(function (r) { return r.sig; }, sigs);
      matchBy(function (r) { return r.csig; }, csigs);
      for (i = 0; i < n; i++) {
        if (chosen[i]) continue;
        var old = byPath.get(views[i].path);
        if (old && !claimed.has(old)) { chosen[i] = old; claimed.add(old); }
      }

      /* Where every drawn node went; the folds and the selection go along. */
      var remapped = false;
      if (carry) {
        var moves = new Map();
        recs.forEach(function (r, p) { moves.set(p, null); });
        for (i = 0; i < n; i++) {
          var c0 = chosen[i];
          if (c0 && !c0.leaving && recs.get(c0.path) === c0) moves.set(c0.path, views[i].path);
        }
        if (folds.size) {
          var nextFolds = carryFolds(folds, moves, hasKids);
          if (!sameSet(nextFolds, folds)) { folds = nextFolds; remapped = true; }
        }
        /* A selected node that is gone takes the selection with it, rather
         * than leaving the halo on whatever took its path. */
        if (selected !== null && moves.has(selected)) selected = moves.get(selected);
      }

      var shown = visibleSet();
      var next = new Map();
      var used = new Set();
      var created = [];
      var changed = [];
      var order = [];
      var orderViews = [];
      var orderIdx = [];
      for (i = 0; i < n; i++) {
        var v = views[i];
        if (!shown.has(v)) continue;
        var r = chosen[i];
        if (!r) {
          r = makeRec(v.path);
          created.push(r);
        }
        if (r.leaving) {
          r.leaving = false;
          leaving.delete(r);
          r.el.classList.remove('mv-node--leaving');
          r.el.removeAttribute('aria-hidden');
        }
        used.add(r);
        r.path = v.path;
        r.view = v;
        order.push(r);
        orderViews.push(v);
        orderIdx.push(i);
        next.set(v.path, r);
      }
      if (created.length) build(created);
      for (var q = 0; q < order.length; q++) {
        var rr = order[q];
        var vv = orderViews[q];
        var at = orderIdx[q];
        if (rr.sig !== sigs[at]) {
          if (!rr.built) {
            if (rr.csig !== null && rr.csig === csigs[at]) restyle(rr, vv);
            else fill(rr, vv);
          }
          rr.sig = sigs[at];
          rr.csig = csigs[at];
          changed.push(rr);
          rr.labelled = null;
        }
        rr.built = false;
        if (rr.domPath !== vv.path) {
          rr.domPath = vv.path;
          rr.el.setAttribute('data-path', vv.path);
          rr.el.id = id + '-' + pathKey(vv.path);
        }
        if (vv.path === selected || rr.el.classList.contains('mv-node--selected')) rr.el.classList.toggle('mv-node--selected', vv.path === selected);
        if (rr.labelled !== labelKey(rr)) label(rr);
      }
      pool.forEach(function (r) {
        if (used.has(r) || r.leaving) return;
        r.leaving = true;
        r.el.classList.add('mv-node--leaving');
        r.el.classList.remove('mv-node--selected');
        r.el.setAttribute('aria-hidden', 'true');
        r.el.removeAttribute('id');
        r.domPath = null;
        leaving.add(r);
      });
      recs = next;
      return { created: created, filled: changed, remapped: remapped };
    }

    function measure() {
      var list = [];
      recs.forEach(function (r) { if (r.dirty) list.push(r); });
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var w = r.el.offsetWidth;
        var h = r.el.offsetHeight;
        /* The title's offset is from the bare positioned box around the
         * node, whose corner is the node's. */
        var base = r.title ? r.title.offsetTop + r.title.offsetHeight + STUB_DROP : h;
        r.w = w;
        r.h = h;
        r.base = Math.min(base, h);
        if (!r.fs && r.title) r.fs = parseFloat(getComputedStyle(r.title).fontSize) || 0;
        r.dirty = false;
      }
      return list.length;
    }

    function removeRec(r) {
      if (r.pos && r.pos.parentNode) r.pos.parentNode.removeChild(r.pos);
      if (ro && r.el) ro.unobserve(r.el);
      ['knob', 'hit', 'glink', 'grad', 'dyn', 'dot'].forEach(function (k) {
        if (r[k] && r[k].parentNode) r[k].parentNode.removeChild(r[k]);
        r[k] = null;
      });
      r.drawn = null;
      r.anim = false;
      leaving.delete(r);
    }

    /* ---------- pictures ---------- */

    /* Only data: and blob: sources are ever loaded: anything else goes
     * through the resolver (IndexedDB assets, in the app). With no URL the
     * picture shows as missing; nothing is fetched from the network. What
     * the resolver answered is remembered per path until the map changes
     * (clear), the resolver changes, or someone says the bytes behind a
     * path changed (forgetImage, invalidate). */
    function loadImage(img, im) {
      var path = im.path || im.src || '';
      img.setAttribute('data-src', path);
      img.__mvAlt = img.getAttribute('alt') || '';
      img.addEventListener('load', function () { remeasureSoon(img); });
      img.addEventListener('error', function () {
        if (!img.getAttribute('src')) return;
        broken(img);
        remeasureSoon(img);
      });
      resolveInto(img, path);
    }

    function resolveInto(img, path) {
      var token = img.__mvToken = (img.__mvToken || 0) + 1;
      img.__mvJob = null;
      if (isLocalUrl(path)) { show(img, path); return; }
      var known = imageUrls.get(path);
      if (typeof known === 'string') { show(img, known); return; }
      if (known === null || !resolver) { broken(img); return; }
      var job = known || ask(path);
      img.__mvJob = job.then(function (url) {
        if (img.__mvToken !== token || img.getAttribute('data-src') !== path) return;
        if (url) show(img, url);
        else { broken(img); remeasureSoon(img); }
      });
    }

    function ask(path) {
      var mine = imageGen;
      var fn = resolver;
      var job = Promise.resolve().then(function () { return fn(path); }).then(function (url) {
        var ok = typeof url === 'string' && isLocalUrl(url) ? url : null;
        if (mine === imageGen && imageUrls.get(path) === job) imageUrls.set(path, ok);
        return ok;
      }, function () {
        if (mine === imageGen && imageUrls.get(path) === job) imageUrls.set(path, null);
        return null;
      });
      imageUrls.set(path, job);
      return job;
    }

    function show(img, url) {
      var wasBroken = img.getAttribute('data-broken') === 'true';
      if (wasBroken) {
        img.removeAttribute('data-broken');
        labelPicture(img);
      }
      if (img.getAttribute('src') !== url) img.src = url;
    }

    function broken(img) {
      img.removeAttribute('src');
      img.setAttribute('data-broken', 'true');
      labelPicture(img);
    }

    /* The bytes behind a picture path changed (a drawing saved again, an
     * asset added after it was found missing), or with no path, behind any:
     * forget what the resolver said and ask again for every picture showing
     * it. Resolves once they have been asked. */
    function forgetImage(path) {
      var all = path === undefined || path === null;
      if (all) { imageUrls = new Map(); imageGen++; } else imageUrls.delete(String(path));
      var jobs = [];
      var imgs = nodesBox.querySelectorAll('img.mv-img[data-src]');
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].getAttribute('data-src');
        if (!src || isLocalUrl(src) || (!all && src !== String(path))) continue;
        var node = imgs[i].closest('.mv-node');
        if (node && node.__mvRec && node.__mvRec.leaving) continue;
        resolveInto(imgs[i], src);
        if (imgs[i].__mvJob) jobs.push(imgs[i].__mvJob);
      }
      return Promise.all(jobs).then(function () { return undefined; });
    }

    function forgetPicturesOf(v) {
      if (!v) return;
      var list = (v.images || []).concat(v.body && v.body.images ? v.body.images : []);
      list.forEach(function (im) {
        var p = im.path || im.src;
        if (p && !isLocalUrl(p)) imageUrls.delete(p);
      });
    }

    function pendingImages(list) {
      var jobs = [];
      list.forEach(function (r) {
        if (r.leaving || !r.pics) return;
        var imgs = r.el.querySelectorAll('img.mv-img');
        for (var i = 0; i < imgs.length; i++) {
          var img = imgs[i];
          if (img.getAttribute('data-broken') === 'true') continue;
          if (img.__mvJob) jobs.push(img.__mvJob.then(waitImage.bind(null, img)));
          else if (img.getAttribute('src') && !img.complete) jobs.push(waitImage(img));
        }
      });
      return jobs;
    }

    function waitImage(img) {
      if (!img.getAttribute('src') || img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }

    function remeasureSoon(el) {
      var node = el.closest ? el.closest('.mv-node') : null;
      var r = node && node.__mvRec;
      if (!r || r.leaving) return;
      r.dirty = true;
      dirty.add(r);
      scheduleFlush();
    }

    /* Size changes nobody announced (a picture decoded, a font arrived, the
     * editor typing into a node): measure again and re-lay the map in place,
     * once for everything that changed within a frame. */
    function scheduleFlush() {
      /* On a big map a re-layout costs more than a frame. While a name is
       * typed into a node, the map waits for a pause in the typing (or at
       * most FLUSH_LATEST after the first key) and catches up in one go: a
       * re-layout behind every few keys would land on one of them and make
       * that key late, and the map would shift under the words being
       * written. The node itself grows as it is typed into. */
      var a = document.activeElement;
      var typing = !!(a && a.isContentEditable && root.contains(a));
      if (!typing || flushCost <= 8) {
        if (!flushTimer) flushTimer = setTimeout(flushDirty, 16);
        return;
      }
      var now = performance.now();
      if (flushTimer) clearTimeout(flushTimer);
      else flushSince = now;
      var wait = Math.max(0, Math.min(FLUSH_PAUSE, flushSince + FLUSH_LATEST - now));
      flushTimer = setTimeout(flushDirty, wait);
    }

    function flushDirty() {
      flushTimer = 0;
      if (destroyed || !geo || !tree || waiting) { dirty.clear(); checkIdle(); return; }
      var any = false;
      dirty.forEach(function (r) { if (recs.get(r.path) === r) { r.dirty = true; any = true; } });
      dirty.clear();
      if (!any || !live()) { checkIdle(); return; }
      var t0 = performance.now();
      var before = sizesOf();
      measure();
      if (!sameSizes(before)) relayout({ animate: !!flight, keepCamera: false });
      flushCost = performance.now() - t0;
      checkIdle();
    }

    function sizesOf() {
      var out = new Map();
      recs.forEach(function (r, p) { out.set(p, r.w + 'x' + r.h + 'x' + r.base); });
      return out;
    }

    function sameSizes(before) {
      var same = true;
      recs.forEach(function (r, p) { if (before.get(p) !== r.w + 'x' + r.h + 'x' + r.base) same = false; });
      return same;
    }

    /* ---------- layout and placing ---------- */

    function live() { return root.isConnected && root.getClientRects().length > 0; }

    function fontsLoading() {
      try { return !!(document.fonts && document.fonts.status === 'loading'); } catch (err) { return false; }
    }

    function runLayout(treeOf) {
      var sizes = new Map();
      recs.forEach(function (r, p) { sizes.set(p, { w: r.w, h: r.h, base: r.base }); });
      return ns.layout.layout(treeOf || tree, sizes, {
        balance: opts.balance, folded: folds,
        gapX: LAYOUT_GAPS.gapX, gapY: LAYOUT_GAPS.gapY, cousinGap: LAYOUT_GAPS.cousinGap,
        knob: KNOB_R + 2
      });
    }

    function anchorPath(u) {
      if (u.anchor !== undefined && u.anchor !== null && recs.has(u.anchor)) return u.anchor;
      if (selected !== null && recs.has(selected)) return selected;
      return geo && geo.order.length && recs.has(geo.order[0]) ? geo.order[0] : null;
    }

    /* What stays put on screen through a change: the selected node (else
     * the one asked for, else the root). Held by its element, not its path:
     * an insert above it gives it a new path, and its element follows it. */
    function anchorOf(u) {
      if (u.keepCamera || !geo) return null;
      var a = anchorPath(u);
      var ar = a !== null ? recs.get(a) : null;
      /* Its laid-out place, not where a running animation has it: the
       * answer must not depend on timing. */
      return ar && !ar.fresh ? { rec: ar, x: ar.x, y: ar.y } : null;
    }

    /* The single entry point for every change: the tree, folds, options,
     * sizes. Synchronous whenever it can be (the font is in), so the caller
     * can select or ask for geometry on the next line. */
    function update(u) {
      var my = ++gen;
      var anchor = anchorOf(u);
      var done = reconcile(allViews(), !!u.carry);
      if (done.remapped) emit('fold', { path: null, folded: null, deep: false, folds: folded(), remapped: true });
      if (!live()) {
        return new Promise(function (resolve) {
          var prev = waiting;
          waiting = { u: u, resolve: function () { if (prev) prev.resolve(); resolve(); } };
        });
      }
      /* Laying the new text out is what starts a web font loading; if it
       * did, measuring now would measure the fallback face. */
      if (done.filled.length) void root.offsetWidth;
      var job;
      if (fontsLoading()) {
        job = Promise.race([document.fonts.ready, delay(FONT_WAIT)]).then(function () {
          if (my !== gen || destroyed) return;
          return finish(u, anchor, my, done.filled);
        });
      } else {
        job = finish(u, anchor, my, done.filled);
      }
      pending++;
      var settle = function () { pending--; checkIdle(); };
      job.then(settle, settle);
      return job;
    }

    function finish(u, anchor, my, filled) {
      measure();
      /* What laying this map out costs, known before the first key is typed
       * into it (see scheduleFlush). */
      var t0 = performance.now();
      apply(runLayout(), u, anchor);
      flushCost = performance.now() - t0;
      root.tabIndex = recs.size ? 0 : -1;
      payOwed();
      if (!promoted) promoteWhenIdle();
      if (picked) paintPick();
      emit('render', { count: recs.size });
      var jobs = pendingImages(filled);
      if (!jobs.length) return Promise.resolve();
      return Promise.race([Promise.all(jobs), delay(IMAGE_WAIT)]).then(function () {
        if (my !== gen || destroyed) return;
        filled.forEach(function (r) { if (!r.leaving && recs.get(r.path) === r && r.pics) r.dirty = true; });
        var before = sizesOf();
        measure();
        if (!sameSizes(before)) relayout({ animate: !!flight, keepCamera: false });
      });
    }

    /* Layout again from the current measurements (sizes changed, nothing
     * else): no reconcile, no waiting. Nothing animates for a size change,
     * except that a layout still playing carries on from where it got to
     * rather than jumping to its end. */
    function relayout(u) {
      var anchor = anchorOf(u);
      apply(runLayout(), u, anchor);
      payOwed();
    }

    function apply(g, u, anchor) {
      stopFlight();
      var prev = geo;
      var whole = u.reframe && prev && prev.order.length ? wholeInView(prev.bounds) : false;
      geo = g;
      linkTo = new Map();
      for (var l = 0; l < g.links.length; l++) linkTo.set(g.links[l].to, g.links[l]);
      var m = tokensNow();
      var animate = !!(u.animate && prev && prev.order.length && !reducedMotion() && !document.hidden && m.map > 1);

      /* The anchor stays where it is on screen: the camera moves by the
       * anchor's move at once, and the drawing lags it by as much, catching
       * up as the nodes travel (or at once, with nothing to animate). */
      var held = anchor && !anchor.rec.leaving && recs.get(anchor.rec.path) === anchor.rec ? g.nodes[anchor.rec.path] : null;
      var next = { x: cam.x, y: cam.y, k: cam.k };
      if (held) {
        var dx = (held.x - anchor.x) * cam.k;
        var dy = (held.y - anchor.y) * cam.k;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          next.x -= dx;
          next.y -= dy;
          lag = { x: lag.x + dx / cam.k, y: lag.y + dy / cam.k };
        }
      }
      if (!animate) lag = { x: 0, y: 0 };

      var items = [];
      var fresh = new Set();
      recs.forEach(function (r) { if (r.fresh) fresh.add(r); });
      recs.forEach(function (r, path) {
        var n = g.nodes[path];
        var side = n.side;
        if (side !== r.side) {
          r.side = side;
          if (side === 'left' || r.el.classList.contains('mv-node--left')) r.el.classList.toggle('mv-node--left', side === 'left');
        }
        r.x = n.x;
        r.y = n.y;
        r.hasKids = n.hasKids;
        r.hub = !!n.hub;
        r.folded = n.folded;
        r.parentRec = n.parent !== null ? recs.get(n.parent) || null : null;
        var color = safeColor(r.view);
        if (color !== r.color) {
          r.color = color;
          r.el.style.setProperty('--branch', color);
        }
        aria(r);
        if (fresh.has(r)) {
          r.fresh = false;
          var from = animate ? enterFrom(r, fresh) : null;
          r.enterFrom = from;
          if (from) items.push({ r: r, x0: from.x, y0: from.y, x1: n.x, y1: n.y, o0: 0, o1: 1, s0: ENTER_SCALE, s1: 1 });
          else place(r, n.x, n.y, 1, 1);
        } else if (r.sx !== n.x || r.sy !== n.y || r.op !== 1 || r.sc !== 1) {
          if (animate) items.push({ r: r, x0: r.sx, y0: r.sy, x1: n.x, y1: n.y, o0: r.op, o1: 1, s0: r.sc, s1: 1 });
          else place(r, n.x, n.y, 1, 1);
        }
      });
      leaving.forEach(function (r) {
        var to = animate ? exitTo(r, g) : null;
        if (to) items.push({ r: r, x0: r.sx, y0: r.sy, x1: to.x, y1: to.y, o0: r.op, o1: 0, s0: r.sc, s1: ENTER_SCALE });
        else if (animate && r.op > 0) items.push({ r: r, x0: r.sx, y0: r.sy, x1: r.sx, y1: r.sy, o0: r.op, o1: 0, s0: r.sc, s1: 1 });
        else removeRec(r);
      });
      recs.forEach(function (r) { r.enterFrom = null; });
      var sel = selected !== null ? recs.get(selected) : null;
      if (sel) root.setAttribute('aria-activedescendant', sel.el.id);
      else root.removeAttribute('aria-activedescendant');

      if (items.length > ANIM_LIMIT) {
        items.forEach(function (it) { if (it.o1 === 0) removeRec(it.r); else place(it.r, it.x1, it.y1, 1, 1); });
        items = [];
        lag = { x: 0, y: 0 };
      }
      sizeBoxes(prev && items.length ? union(prev.bounds, g.bounds) : g.bounds);
      if (next.x !== cam.x || next.y !== cam.y) setCam(next, 'layout');
      else writeLayer();
      if (items.length || lag.x || lag.y) {
        fly(items, u.collapse ? m.map * 0.75 : m.map, m.out, g);
      } else {
        drawAll();
      }
      if (!held && !cameraGiven && !u.keepCamera && (!prev || !prev.order.length) && g.order.length) owed.push({ opts: { readable: true }, resolve: null });
      if (u.fit && g.order.length) owed.push({ opts: { animate: false }, resolve: null });
      if (u.reframe) reframe(whole);
    }

    function stubEnd(r, x, y) {
      return { x: r.side === 'left' ? x : x + r.w, y: y + r.base };
    }

    function enterFrom(r, fresh) {
      /* Out of the nearest ancestor that was already on screen (or is
       * itself arriving: then out of where it arrives from). */
      var p = r.parentRec;
      while (p) {
        if (!fresh.has(p)) {
          var end = stubEnd(p, p.sx, p.sy);
          return { x: r.side === 'left' ? end.x - r.w : end.x, y: end.y - r.base };
        }
        if (p.enterFrom) {
          var e = stubEnd(p, p.enterFrom.x, p.enterFrom.y);
          return { x: r.side === 'left' ? e.x - r.w : e.x, y: e.y - r.base };
        }
        p = p.parentRec;
      }
      return null;
    }

    function exitTo(r, g) {
      var p = r.parentRec;
      while (p) {
        if (!p.leaving && recs.get(p.path) === p && g.nodes[p.path]) {
          var n = g.nodes[p.path];
          var end = stubEnd(p, n.x, n.y);
          return { x: r.side === 'left' ? end.x - r.w : end.x, y: end.y - r.base };
        }
        p = p.parentRec;
      }
      return null;
    }

    function union(a, b) {
      if (!a || !a.w) return b;
      if (!b || !b.w) return a;
      var x0 = Math.min(a.x, b.x);
      var y0 = Math.min(a.y, b.y);
      return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    }

    function sizeBoxes(b) {
      var x = Math.floor((b ? b.x : 0) - BOX_MARGIN);
      var y = Math.floor((b ? b.y : 0) - BOX_MARGIN);
      var w = Math.ceil((b ? b.w : 0) + 2 * BOX_MARGIN);
      var h = Math.ceil((b ? b.h : 0) + 2 * BOX_MARGIN);
      [under, over].forEach(function (s) {
        s.style.left = x + 'px';
        s.style.top = y + 'px';
        s.style.width = w + 'px';
        s.style.height = h + 'px';
        s.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
      });
    }

    /* The tree-item facts of a node, all known from the tree and the
     * folds before any layout: written into the markup of a new node, and
     * onto an existing one only when one of them changed. */
    function ariaOf(path, v) {
      var info = index.get(path) || { pos: 1, size: 1 };
      var kids = !!(v.children && v.children.length);
      var a = {
        level: (v.depth || 0) + (tree && (tree.path === null || tree.path === undefined) ? 0 : 1),
        pos: info.pos, size: info.size,
        expanded: kids ? (folds.has(path) ? 'false' : 'true') : null,
        selected: path === selected ? 'true' : 'false'
      };
      a.key = a.level + '|' + a.pos + '|' + a.size + '|' + a.expanded + '|' + a.selected;
      return a;
    }

    function ariaHtml(path, a) {
      return ' id="' + id + '-' + escapeHtml(pathKey(path)) + '" data-path="' + escapeHtml(path) + '" role="treeitem" aria-level="' + a.level +
        '" aria-posinset="' + a.pos + '" aria-setsize="' + a.size + '" aria-selected="' + a.selected + '"' +
        (a.expanded ? ' aria-expanded="' + a.expanded + '"' : '');
    }

    function aria(r) {
      var a = ariaOf(r.path, r.view);
      if (a.key === r.aria) return;
      r.aria = a.key;
      var el = r.el;
      el.setAttribute('role', 'treeitem');
      el.setAttribute('aria-level', String(a.level));
      el.setAttribute('aria-posinset', String(a.pos));
      el.setAttribute('aria-setsize', String(a.size));
      el.setAttribute('aria-selected', a.selected);
      if (a.expanded) el.setAttribute('aria-expanded', a.expanded);
      else el.removeAttribute('aria-expanded');
    }

    function place(r, x, y, op, sc) {
      r.sx = x;
      r.sy = y;
      r.op = op;
      r.sc = sc;
      writeNode(r);
    }

    /* A growing or shrinking node scales about the middle of the side its
     * parent is on, folded into one translate so the positioned box needs
     * no transform-origin of its own. */
    function writeNode(r) {
      var x = r.sx;
      var y = r.sy;
      if (r.sc !== 1) {
        x += (r.side === 'left' ? r.w : 0) * (1 - r.sc);
        y += (r.h / 2) * (1 - r.sc);
      }
      r.pos.style.left = x + 'px';
      r.pos.style.top = y + 'px';
      var tr = r.sc !== 1 ? 'scale(' + r.sc + ')' : '';
      if (r.pos.style.transform !== tr) r.pos.style.transform = tr;
      r.pos.style.opacity = r.op === 1 ? '' : String(r.op);
    }

    /* One frame loop moves everything: the boxes, and in the same frame the
     * stubs, links, knobs, gradients, dots and the halo that hang off them,
     * so a curve never trails behind its node; and the lag of the drawing
     * behind the camera shrinks with them. */
    function fly(items, ms, ease, g) {
      var lag0 = { x: lag.x, y: lag.y };
      for (var i = 0; i < items.length; i++) items[i].r.moving = true;
      markAnim(true);
      drawAll();
      flight = ns.gestures.animate(ms, ease, function (p) {
        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          var r = it.r;
          r.sx = it.x0 + (it.x1 - it.x0) * p;
          r.sy = it.y0 + (it.y1 - it.y0) * p;
          r.op = it.o0 + (it.o1 - it.o0) * p;
          r.sc = it.s0 + (it.s1 - it.s0) * p;
          writeNode(r);
        }
        lag = { x: lag0.x * (1 - p), y: lag0.y * (1 - p) };
        writeLayer();
        drawMoving();
      }, function (complete) {
        for (var j = 0; j < items.length; j++) items[j].r.moving = false;
        markAnim(false);
        flight = null;
        /* Stopped by a newer layout: everything stays where it got to,
         * the lag included, and that layout carries on from there. */
        if (!complete) return;
        for (var k = 0; k < items.length; k++) {
          var r = items[k].r;
          if (r.leaving) removeRec(r);
          else { r.sx = items[k].x1; r.sy = items[k].y1; r.op = 1; r.sc = 1; writeNode(r); }
        }
        lag = { x: 0, y: 0 };
        writeLayer();
        drawAll();
        sizeBoxes(g.bounds);
        checkIdle();
      });
    }

    function stopFlight() {
      if (flight) flight.stop();
      flight = null;
    }

    /* Which records draw on paths of their own while a flight plays: the
     * ones moving, and the ones whose link hangs from a moving parent. */
    function markAnim(on) {
      var mark = function (r) {
        var a = on && (r.leaving || r.moving || !!(r.parentRec && r.parentRec.moving));
        if (a === r.anim) return;
        r.anim = a;
        r.drawn = null;
        if (!a && r.dyn) { if (r.dyn.parentNode) r.dyn.parentNode.removeChild(r.dyn); r.dyn = null; }
      };
      recs.forEach(mark);
      leaving.forEach(mark);
    }

    /* ---------- the SVG underlay and overlay ---------- */

    var gradCounter = 0;
    function gradId(r) { return id + '-g-' + (r.gradSeq || (r.gradSeq = ++gradCounter)); }

    function stops(from, to) {
      if (ns.colors && typeof ns.colors.fadeStops === 'function') return ns.colors.fadeStops(from, to);
      var mid = ns.colors && typeof ns.colors.mixLinear === 'function' ? ns.colors.mixLinear(from, to, 0.5) : mixLocal(from, to);
      return [{ offset: 0, color: from }, { offset: 0.24, color: from }, { offset: 0.5, color: mid }, { offset: 0.76, color: to }, { offset: 1, color: to }];
    }

    /* The stub as drawn now: under the title, the width of the box, scaled
     * with the box about the middle of its parent's side. */
    function stubOf(r) {
      var sc = r.sc;
      var w = r.w * sc;
      var x1 = r.side === 'left' ? r.sx + r.w - w : r.sx;
      return { x1: x1, x2: x1 + w, y: r.sy + r.h / 2 + (r.base - r.h / 2) * sc };
    }

    function stubD(s) { return 'M' + f(s.x1) + ',' + f(s.y) + 'H' + f(s.x2); }

    /* From the parent's stub end on the child's side to the child's stub
     * start (mirrored on the left side of the root). */
    function linkEnds(r) {
      var p = r.parentRec;
      if (!p) return null;
      var a = stubOf(p);
      var b = stubOf(r);
      /* A branch of a root put by hand above or below its line leaves from
       * the root's circle and comes down on its own line under it. */
      if (p.hub && b.x1 < a.x2 && b.x2 > a.x1) {
        var cx = (a.x1 + a.x2) / 2;
        var tx = Math.max(b.x1, Math.min(b.x2, cx));
        if (Math.abs(tx - cx) < 1) tx = cx + 1 <= b.x2 ? cx + 1 : cx - 1;
        return { x1: cx, y1: a.y, x2: tx, y2: b.y };
      }
      /* A child put by hand above or below its parent's line leaves from the
       * point of that line over it, not from its end: no link doubles back. */
      return r.side === 'left'
        ? { x1: Math.max(a.x1, Math.min(a.x2, b.x2)), y1: a.y, x2: b.x2, y2: b.y }
        : { x1: Math.min(a.x2, Math.max(a.x1, b.x1)), y1: a.y, x2: b.x1, y2: b.y };
    }

    function knobAt(r) {
      var s = stubOf(r);
      return { x: r.hub ? (s.x1 + s.x2) / 2 : r.side === 'left' ? s.x1 : s.x2, y: s.y };
    }

    var LINK = svg('path', { class: 'mv-link' });
    var KNOB = svg('g', { class: 'mv-knob' });
    KNOB.appendChild(svg('circle', { class: 'mv-knob-tap' }));
    KNOB.appendChild(svg('circle', { class: 'mv-knob-dot', r: KNOB_R }));
    var HIT = svg('circle', { class: 'mv-knob-hit' });

    /* Every stub, and every link whose two ends share a colour, in one path
     * per colour: a 2,000-node map draws its lines with a handful of
     * elements. Records in flight draw on their own paths meanwhile. */
    function drawStatic() {
      var parts = new Map();
      recs.forEach(function (r) {
        if (r.anim) return;
        var d = stubD(stubOf(r));
        var l = linkEnds(r);
        if (l && r.parentRec.color === r.color) d += ns.layout.linkPath(l.x1, l.y1, l.x2, l.y2);
        var list = parts.get(r.color);
        if (!list) parts.set(r.color, list = []);
        list.push(d);
      });
      parts.forEach(function (list, color) {
        var el = buckets.get(color);
        if (!el) {
          el = LINK.cloneNode(false);
          el.setAttribute('stroke', color);
          gLinks.insertBefore(el, gLinks.firstChild);
          buckets.set(color, el);
        }
        var d = list.join('');
        if (el.__d !== d) { el.setAttribute('d', d); el.__d = d; }
      });
      buckets.forEach(function (el, color) {
        if (parts.has(color)) return;
        if (el.parentNode) el.parentNode.removeChild(el);
        buckets.delete(color);
      });
    }

    /* Everything a record's own elements are drawn from; when it has not
     * changed since the last draw there is nothing to write. */
    function drawKey(r) {
      var p = r.parentRec;
      var notes = r.view && r.view.notes;
      return r.sx + ',' + r.sy + ',' + r.sc + ',' + r.w + ',' + r.h + ',' + r.base + ',' + r.op + ',' + r.color + ',' + r.side + ',' +
        r.hasKids + ',' + r.hub + ',' + r.folded + ',' + r.path + ',' + r.anim + ',' + r.leaving + ',' +
        (p ? p.sx + ',' + p.sy + ',' + p.sc + ',' + p.w + ',' + p.h + ',' + p.base + ',' + p.color : '-') + ',' +
        (notes && notes.edge ? notes.edge : '') + ',' + opts.notesOpen;
    }

    function drawRec(r) {
      var key = drawKey(r);
      if (key === r.drawn) return;
      r.drawn = key;
      var op = r.op === 1 ? null : String(Math.round(r.op * 1000) / 1000);
      var l = linkEnds(r);
      var p = r.parentRec;

      if (r.hasKids) {
        if (!r.knob) {
          r.knob = KNOB.cloneNode(true);
          r.knob.firstChild.setAttribute('r', hitR.over);
          gKnobs.appendChild(r.knob);
        }
        var kc = knobAt(r);
        r.knob.setAttribute('data-path', r.path);
        r.knob.setAttribute('transform', 'translate(' + f(kc.x) + ',' + f(kc.y) + ')');
        if (r.knob.__c !== r.color) { r.knob.style.setProperty('--branch', r.color); r.knob.__c = r.color; }
        if (r.knob.__f !== !!r.folded) { r.knob.classList.toggle('is-folded', !!r.folded); r.knob.__f = !!r.folded; }
        if (r.knob.__gone !== r.leaving) { r.knob.classList.toggle('is-leaving', r.leaving); r.knob.__gone = r.leaving; }
        setOpacity(r.knob, op);
        /* The outer target, under the words: a knob folding away takes no
         * taps. */
        if (r.leaving) {
          if (r.hit) { if (r.hit.parentNode) r.hit.parentNode.removeChild(r.hit); r.hit = null; }
        } else {
          if (!r.hit) {
            r.hit = HIT.cloneNode(false);
            r.hit.setAttribute('r', hitR.under);
            gHits.appendChild(r.hit);
          }
          r.hit.setAttribute('data-path', r.path);
          r.hit.setAttribute('cx', f(kc.x));
          r.hit.setAttribute('cy', f(kc.y));
        }
      } else {
        if (r.knob) { if (r.knob.parentNode) r.knob.parentNode.removeChild(r.knob); r.knob = null; }
        if (r.hit) { if (r.hit.parentNode) r.hit.parentNode.removeChild(r.hit); r.hit = null; }
      }

      var fade = !!(l && p.color && r.color && p.color !== r.color);
      if (fade) {
        if (!r.glink) {
          r.glink = LINK.cloneNode(false);
          gLinks.appendChild(r.glink);
        }
        if (!r.grad || r.grad.__from !== p.color || r.grad.__to !== r.color) {
          if (r.grad && r.grad.parentNode) r.grad.parentNode.removeChild(r.grad);
          r.grad = svg('linearGradient', { id: gradId(r), gradientUnits: 'userSpaceOnUse' });
          var list = stops(p.color, r.color);
          for (var s = 0; s < list.length; s++) r.grad.appendChild(svg('stop', { offset: list[s].offset, 'stop-color': list[s].color }));
          r.grad.__from = p.color;
          r.grad.__to = r.color;
          defs.appendChild(r.grad);
        }
        r.grad.setAttribute('x1', f(l.x1));
        r.grad.setAttribute('y1', f(l.y1));
        r.grad.setAttribute('x2', f(l.x2));
        r.grad.setAttribute('y2', f(l.y2));
        var ref = 'url(#' + r.grad.id + ')';
        if (r.glink.__c !== ref) { r.glink.setAttribute('stroke', ref); r.glink.__c = ref; }
        r.glink.setAttribute('d', ns.layout.linkPath(l.x1, l.y1, l.x2, l.y2));
        setOpacity(r.glink, op);
      } else {
        if (r.glink) { if (r.glink.parentNode) r.glink.parentNode.removeChild(r.glink); r.glink = null; }
        if (r.grad) { if (r.grad.parentNode) r.grad.parentNode.removeChild(r.grad); r.grad = null; }
      }

      if (r.anim) {
        if (!r.dyn) {
          r.dyn = LINK.cloneNode(false);
          gLinks.appendChild(r.dyn);
        }
        if (r.dyn.__c !== r.color) { r.dyn.setAttribute('stroke', r.color); r.dyn.__c = r.color; }
        r.dyn.setAttribute('d', stubD(stubOf(r)) + (l && !fade ? ns.layout.linkPath(l.x1, l.y1, l.x2, l.y2) : ''));
        setOpacity(r.dyn, op);
      } else if (r.dyn) {
        if (r.dyn.parentNode) r.dyn.parentNode.removeChild(r.dyn);
        r.dyn = null;
      }

      var edge = r.view && r.view.notes ? r.view.notes.edge : null;
      if (edge && l) {
        if (!r.dot) {
          r.dot = document.createElement('button');
          r.dot.type = 'button';
          r.dot.tabIndex = -1;
          r.dot.setAttribute('aria-hidden', 'true');
          overlay.appendChild(r.dot);
          label(r);
        }
        var card = opts.notesOpen;
        var cls = (card ? 'mv-card mv-card--edge' : 'mv-edge-dot') + (r.leaving ? ' is-leaving' : '');
        if (r.dot.className !== cls) r.dot.className = cls;
        if (card && r.dot.__text !== edge) { r.dot.textContent = edge; r.dot.__text = edge; }
        if (!card && r.dot.__text) { r.dot.textContent = ''; r.dot.__text = ''; }
        if (r.dot.__label !== edge) { r.dot.__label = edge; label(r); }
        r.dot.setAttribute('data-path', r.path);
        var mid = ns.layout.linkMidpoint(l.x1, l.y1, l.x2, l.y2);
        r.dot.style.transform = 'translate(' + f(mid.x) + 'px,' + f(mid.y) + 'px)';
        r.dot.style.opacity = op === null ? '' : op;
      } else if (r.dot) {
        if (r.dot.parentNode) r.dot.parentNode.removeChild(r.dot);
        r.dot = null;
      }
    }

    function setOpacity(node, op) {
      if (op === null) { if (node.__op) { node.removeAttribute('opacity'); node.__op = null; } }
      else if (node.__op !== op) { node.setAttribute('opacity', op); node.__op = op; }
    }

    function drawAll() {
      drawStatic();
      recs.forEach(drawRec);
      leaving.forEach(drawRec);
      drawHalo();
    }

    function drawMoving() {
      recs.forEach(function (r) { if (r.anim) drawRec(r); });
      leaving.forEach(drawRec);
      var s = selected !== null ? recs.get(selected) : null;
      if (s && s.anim) drawHalo();
    }

    function drawGrip() {
      var r = selected !== null ? recs.get(selected) : null;
      var lone = !!tree && !tree.synthetic && tree.path === selected;
      if (!r || r.fresh || opts.readOnly || lone || !hasListener('dragstart')) {
        if (!grip.hidden) grip.hidden = true;
        wires.in.hidden = true;
        wires.out.hidden = true;
        return;
      }
      /* Beside the node on its outer side, clear of the halo: in the middle
       * of a leaf, above the knob of a node with children (the toolbar
       * floats above or below the node, never beside it). */
      var outLeft = r.side === 'left';
      var half = GRIP / 2 / cam.k;
      var x = outLeft ? r.sx - HALO_PAD - half - 4 / cam.k : r.sx + r.w + HALO_PAD + half + 4 / cam.k;
      var y = r.sy + r.h / 2;
      if (r.hasKids && !(tree && tree.path === r.path)) y = Math.min(y, r.sy + r.base - half - 6 / cam.k);
      grip.classList.toggle('mv-grip--left', outLeft);
      grip.style.transform = 'translate(' + f(x) + 'px,' + f(y) + 'px) scale(' + f(1 / cam.k) + ') translate(-50%,-50%)';
      if (grip.hidden) grip.hidden = false;
      /* The threads: 'out' under the grip (below the knob of a node that
       * has branches), 'in' on the inner side, on the line the parent's
       * thread arrives at. */
      var gn = geo && geo.nodes[r.path];
      var yOut = r.hasKids && !(tree && tree.path === r.path) ? r.sy + r.base + (GRIP / 2 + 8) / cam.k : y + (GRIP + 4) / cam.k;
      placeWire(wires.out, x, yOut);
      if (gn && gn.parent !== null && gn.parent !== undefined) {
        var xIn = outLeft ? r.sx + r.w + HALO_PAD + half + 4 / cam.k : r.sx - HALO_PAD - half - 4 / cam.k;
        placeWire(wires.in, xIn, r.sy + r.base);
      } else if (!wires.in.hidden) wires.in.hidden = true;
    }

    function placeWire(el, x, y) {
      el.style.transform = 'translate(' + f(x) + 'px,' + f(y) + 'px) scale(' + f(1 / cam.k) + ') translate(-50%,-50%)';
      if (el.hidden) el.hidden = false;
    }

    function drawHalo() {
      drawGrip();
      var r = selected !== null ? recs.get(selected) : null;
      if (!r || r.fresh) { haloRect.style.display = 'none'; return; }
      haloRect.style.display = '';
      haloRect.setAttribute('x', f(r.sx - HALO_PAD));
      haloRect.setAttribute('y', f(r.sy - HALO_PAD));
      haloRect.setAttribute('width', r.w + 2 * HALO_PAD);
      haloRect.setAttribute('height', r.h + 2 * HALO_PAD);
    }

    /* ---------- the camera ---------- */

    function writeLayer() {
      var x = cam.x + lag.x * cam.k;
      var y = cam.y + lag.y * cam.k;
      layer.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + cam.k + ')';
      if (!grip.hidden) drawGrip();
    }

    function setCam(c, source) {
      cam = { x: c.x, y: c.y, k: c.k };
      writeLayer();
      if (source !== 'layout' && source !== 'internal') cameraGiven = true;
      if (ghost) ghost.refresh();
      announce();
    }

    /* 'view' on the bus and 'camera' on the view, at most once a frame (and
     * from a timeout when there are no frames, in a hidden tab). */
    function announce() {
      if (viewFrame) return;
      var fire = function () {
        if (!viewFrame) return;
        clearTimeout(viewFrame.timer);
        if (viewFrame.raf) cancelAnimationFrame(viewFrame.raf);
        viewFrame = 0;
        if (destroyed) return;
        var c = { x: cam.x, y: cam.y, k: cam.k };
        sizeHits();
        emit('camera', c);
        if (ns.bus && typeof ns.bus.emit === 'function') ns.bus.emit('view', c);
      };
      viewFrame = { raf: requestAnimationFrame(fire), timer: setTimeout(fire, 50) };
    }

    function getRect() {
      if (!rectCache) rectCache = root.getBoundingClientRect();
      return rectCache;
    }

    function freshRect() {
      rectCache = null;
      return getRect();
    }

    function stopCamera() {
      if (camMotion) { camMotion.stop(); camMotion = null; }
    }

    /* The nearest camera that keeps k in range and at least KEEP px of the
     * map on the stage (all of it, when it is smaller than that). */
    function constrain(c) {
      var k = clamp(c.k, MIN_K, MAX_K);
      var b = geo && geo.bounds;
      if (!b || !geo.order.length || !size.w || !size.h) return { x: c.x, y: c.y, k: k };
      var keepX = Math.min(KEEP, size.w / 2, b.w * k);
      var keepY = Math.min(KEEP, size.h / 2, b.h * k);
      var minX = keepX - (b.x + b.w) * k;
      var maxX = size.w - keepX - b.x * k;
      var minY = keepY - (b.y + b.h) * k;
      var maxY = size.h - keepY - b.y * k;
      return { x: clamp(c.x, minX, maxX), y: clamp(c.y, minY, maxY), k: k };
    }

    function moveCamera(to, ms, ease) {
      stopCamera();
      if (!(ms > 1) || reducedMotion() || document.hidden) {
        setCam(to, 'api');
        if (gestures.mode() === 'idle') settleRaster();
        checkIdle();
        return Promise.resolve();
      }
      var from = { x: cam.x, y: cam.y, k: cam.k };
      var lk0 = Math.log(from.k);
      var lk1 = Math.log(to.k);
      promote();
      return new Promise(function (resolve) {
        var motionRef = ns.gestures.animate(ms, ease, function (p) {
          if (p >= 1) { setCam(to, 'api'); return; }
          var k = Math.exp(lk0 + (lk1 - lk0) * p);
          /* The straight path between two cameras of different scale makes
           * the content swing; interpolating the point at the stage centre
           * keeps it on a line. */
          var cx = size.w / 2;
          var cy = size.h / 2;
          var ax = (cx - from.x) / from.k;
          var ay = (cy - from.y) / from.k;
          var bx = (cx - to.x) / to.k;
          var by = (cy - to.y) / to.k;
          var mx = ax + (bx - ax) * p;
          var my = ay + (by - ay) * p;
          setCam({ x: cx - mx * k, y: cy - my * k, k: k }, 'api');
        }, function () {
          if (camMotion === motionRef) camMotion = null;
          if (!camMotion && gestures.mode() === 'idle') settleRaster();
          resolve();
          checkIdle();
        });
        if (motionRef.running()) camMotion = motionRef;
      });
    }

    function stageInsets(o) {
      var src = (o && o.insets) || insets;
      if (!src && ns.shell && typeof ns.shell.insets === 'function') {
        try { src = ns.shell.insets(); } catch (err) { src = null; }
      }
      src = src || {};
      return { top: +src.top || 0, right: +src.right || 0, bottom: +src.bottom || 0, left: +src.left || 0 };
    }

    function ready() { return !!(geo && geo.order.length && size.w > 0 && size.h > 0 && !waiting); }

    function fit(o) {
      o = o || {};
      cameraGiven = true;
      if (!ready()) {
        return new Promise(function (resolve) { owed.push({ opts: o, resolve: resolve }); });
      }
      var b = geo.bounds;
      var ins = stageInsets(o);
      var pad = o.padding === undefined ? FIT_PAD : +o.padding || 0;
      var aw = Math.max(1, size.w - ins.left - ins.right - 2 * pad);
      var ah = Math.max(1, size.h - ins.top - ins.bottom - 2 * pad);
      var k = clamp(Math.min(aw / Math.max(b.w, 1), ah / Math.max(b.h, 1)), MIN_K, Math.min(o.maxScale || FIT_MAX, MAX_K));
      /* The first view of a map (o.readable): a big map, or a phone, or a
       * browser zoomed to 200 %, would fit it at a size nobody can read.
       * Then it opens at a reading size around its root instead; Fit
       * (Mod+0, a double tap on the background) still shows all of it. */
      var small = o.readable ? smallestTitle() : 0;
      if (small > 0 && small * k < READ_MIN) return frameRoot(Math.min(READ_AT / small, FIT_MAX), ins, pad, o);
      var to = {
        x: ins.left + pad + (aw - b.w * k) / 2 - b.x * k,
        y: ins.top + pad + (ah - b.h * k) / 2 - b.y * k,
        k: k
      };
      var m = tokensNow();
      return moveCamera(to, o.animate ? m.camera : 0, m.inOut);
    }

    /* The size of the smallest titles drawn, before the camera's scale. */
    function smallestTitle() {
      var min = 0;
      recs.forEach(function (r) { if (r.fs > 0 && !r.leaving && (!min || r.fs < min)) min = r.fs; });
      return min;
    }

    /* The root at a given scale: in the middle of the free stage when the
     * map grows on both sides, or at its left edge when every branch grows
     * to the right, its first branches beside it. */
    function frameRoot(k, ins, pad, o) {
      var first = geo.order[0];
      var n = geo.nodes[first];
      var aw = Math.max(1, size.w - ins.left - ins.right - 2 * pad);
      var ah = Math.max(1, size.h - ins.top - ins.bottom - 2 * pad);
      var right = true;
      for (var i = 0; i < geo.order.length && right; i++) if (geo.nodes[geo.order[i]].side === 'left') right = false;
      var x = right ? ins.left + pad - n.x * k : ins.left + pad + aw / 2 - (n.x + n.w / 2) * k;
      var y = ins.top + pad + ah / 2 - (n.y + n.h / 2) * k;
      var m = tokensNow();
      return moveCamera({ x: x, y: y, k: k }, o.animate ? m.camera : 0, m.inOut);
    }

    /* Fits asked for too early are paid once there is a measured map on a
     * stage with a size - never on the previous map's box. */
    function payOwed() {
      if (!owed.length || !ready()) return;
      var list = owed;
      owed = [];
      var last = list[list.length - 1];
      var done = fit(last.opts);
      list.forEach(function (o) { if (o.resolve) done.then(o.resolve); });
    }

    /* Was the whole map inside the free part of the stage? */
    function wholeInView(b) {
      if (!b || !size.w || !size.h) return false;
      var ins = stageInsets();
      var k = cam.k;
      return cam.x + b.x * k >= ins.left - 0.5 && cam.x + (b.x + b.w) * k <= size.w - ins.right + 0.5 &&
        cam.y + b.y * k >= ins.top - 0.5 && cam.y + (b.y + b.h) * k <= size.h - ins.bottom + 0.5;
    }

    /* After a change of layout the map changes shape around the node
     * held still: if it now fits at this zoom it is slid fully into view;
     * if it does not, but all of it was in view before, it is fitted (never
     * zoomed in); otherwise the held node is what counts. */
    function reframe(whole) {
      if (!geo || !geo.order.length || !size.w || !size.h) return;
      var b = geo.bounds;
      var k = cam.k;
      var ins = stageInsets();
      var left = ins.left + FIT_PAD;
      var right = size.w - ins.right - FIT_PAD;
      var top = ins.top + FIT_PAD;
      var bottom = size.h - ins.bottom - FIT_PAD;
      var x0 = cam.x + b.x * k;
      var x1 = x0 + b.w * k;
      var y0 = cam.y + b.y * k;
      var y1 = y0 + b.h * k;
      var m = tokensNow();
      if (x1 - x0 <= right - left && y1 - y0 <= bottom - top) {
        var dx = x0 < left ? left - x0 : (x1 > right ? right - x1 : 0);
        var dy = y0 < top ? top - y0 : (y1 > bottom ? bottom - y1 : 0);
        if (dx || dy) moveCamera({ x: cam.x + dx, y: cam.y + dy, k: k }, m.camera, m.inOut);
        return;
      }
      if (whole) fit({ animate: true, maxScale: k });
    }

    function screenBox(path) {
      var n = geo && geo.nodes[path];
      if (!n) return null;
      return { x: cam.x + n.x * cam.k, y: cam.y + n.y * cam.k, w: n.w * cam.k, h: n.h * cam.k };
    }

    function ensureVisible(path, o) {
      o = o || {};
      var s = screenBox(path);
      if (!s || !size.w) return Promise.resolve(false);
      var ins = stageInsets(o);
      var pad = REVEAL_PAD;
      var left = ins.left + pad;
      var right = size.w - ins.right - pad;
      var top = ins.top + pad + (o.toolbar === false ? 0 : Math.min(REVEAL_TOP, size.h / 4));
      var bottom = size.h - ins.bottom - pad;
      var m0 = tokensNow();
      var ms = o.animate === false ? 0 : Math.min(REVEAL_MS, m0.camera);
      /* o.read (a node looked for and found): one drawn too small to read
       * is brought in at a reading size, in the middle of the free stage. */
      var rr = o.read ? recs.get(path) : null;
      if (rr && rr.fs > 0 && rr.fs * cam.k < READ_MIN && right > left && bottom > top) {
        var nr = geo.nodes[path];
        var kr = clamp(Math.min(READ_AT / rr.fs, FIT_MAX), MIN_K, MAX_K);
        return moveCamera({ x: (left + right) / 2 - (nr.x + nr.w / 2) * kr, y: (top + bottom) / 2 - (nr.y + nr.h / 2) * kr, k: kr }, ms, m0.inOut).then(function () { return true; });
      }
      /* A node bigger than the room (a long name or a picture on a phone):
       * panning alone would show one end of it, so the camera steps back
       * until all of it fits - unless the caller zoomed in on purpose
       * (o.zoom false: writing wants reading-size letters). */
      var f = Math.min((right - left) / Math.max(s.w, 1), (bottom - top) / Math.max(s.h, 1));
      if (o.zoom !== false && f < 1 && right > left && bottom > top) {
        var n = geo.nodes[path];
        var k2 = clamp(cam.k * f, MIN_K, MAX_K);
        var w2 = n.w * k2;
        var h2 = n.h * k2;
        var x2 = w2 <= right - left ? left + (right - left - w2) / 2 : left;
        var y2 = h2 <= bottom - top ? top + (bottom - top - h2) / 2 : top;
        return moveCamera({ x: x2 - n.x * k2, y: y2 - n.y * k2, k: k2 }, ms, m0.inOut).then(function () { return true; });
      }
      var dx = 0;
      var dy = 0;
      if (s.w > right - left || s.x < left) dx = left - s.x;
      else if (s.x + s.w > right) dx = right - (s.x + s.w);
      if (s.h > bottom - top || s.y < top) dy = top - s.y;
      else if (s.y + s.h > bottom) dy = bottom - (s.y + s.h);
      if (!dx && !dy) return Promise.resolve(true);
      var m = tokensNow();
      return moveCamera({ x: cam.x + dx, y: cam.y + dy, k: cam.k }, o.animate === false ? 0 : Math.min(REVEAL_MS, m.camera), m.out).then(function () { return true; });
    }

    function center(path, o) {
      o = o || {};
      var n = geo && geo.nodes[path];
      if (!n || !size.w) return Promise.resolve(false);
      var ins = stageInsets(o);
      var cx = ins.left + (size.w - ins.left - ins.right) / 2;
      var cy = ins.top + (size.h - ins.top - ins.bottom) / 2;
      var m = tokensNow();
      return moveCamera({ x: cx - (n.x + n.w / 2) * cam.k, y: cy - (n.y + n.h / 2) * cam.k, k: cam.k },
        o.animate === false ? 0 : m.camera, m.inOut).then(function () { return true; });
    }

    function zoomBy(factor, at, o) {
      var fct = +factor;
      if (!(fct > 0)) return Promise.resolve();
      var r = getRect();
      var px = at && isFinite(at.x) ? at.x - r.left : size.w / 2;
      var py = at && isFinite(at.y) ? at.y - r.top : size.h / 2;
      var k = clamp(cam.k * fct, MIN_K, MAX_K);
      var to = constrain(ns.gestures.zoomAround(cam, k, px, py));
      var m = tokensNow();
      return moveCamera(to, o && o.animate ? m.camera : 0, m.out);
    }

    function zoomTo(k, o) {
      var target = clamp(+k || 1, MIN_K, MAX_K);
      var to = constrain(ns.gestures.zoomAround(cam, target, size.w / 2, size.h / 2));
      var m = tokensNow();
      return moveCamera(to, o && o.animate ? m.camera : 0, m.out);
    }

    function camera() { return { x: cam.x, y: cam.y, k: cam.k }; }

    function setCamera(c) {
      if (!c) return;
      stopCamera();
      var k = clamp(+c.k || 1, MIN_K, MAX_K);
      var next = { x: isFinite(+c.x) ? +c.x : 0, y: isFinite(+c.y) ? +c.y : 0, k: k };
      cameraGiven = true;
      owed = owed.filter(function (o) { if (o.resolve) o.resolve(); return false; });
      setCam(geo && geo.order.length ? constrain(next) : next, 'api');
      if (gestures && gestures.mode() === 'idle') settleRaster();
      checkIdle();
    }

    /* ---------- selection ---------- */

    function select(path, o) {
      o = o || {};
      var next = path === undefined || path === null ? null : String(path);
      if (next !== selected) {
        var old = selected !== null ? recs.get(selected) : null;
        selected = next;
        if (picked && picked.path !== next) pickImage(null);
        if (old) { old.el.classList.remove('mv-node--selected'); aria(old); }
        var cur = next !== null ? recs.get(next) : null;
        if (cur) { cur.el.classList.add('mv-node--selected'); aria(cur); }
        if (cur && !cur.fresh) root.setAttribute('aria-activedescendant', cur.el.id);
        else root.removeAttribute('aria-activedescendant');
        drawHalo();
      }
      if (next !== null && o.reveal) {
        var hidden = !recs.has(next) && index.has(next);
        var go = function () { return ensureVisible(next, { animate: o.animate !== false }); };
        return hidden ? unfoldTo(next).then(go) : go();
      }
      return Promise.resolve(next !== null && recs.has(next));
    }

    function getSelected() { return selected; }

    /* ---------- a picture picked ----------
     * A click on a picture of a node picks that picture: a ring shows it,
     * and the owner (the editor) lets Delete take that picture out instead
     * of the branch. A click on the node's words, the background or another
     * node, a selection elsewhere and a re-render where the picture is no
     * longer there let it go. {path, file, kind, field, index} or null. */
    var picked = null;

    function pickedImg() {
      if (!picked) return null;
      var r = recs.get(picked.path);
      if (!r || r.leaving) return null;
      var list = r.el.querySelectorAll('img.mv-img');
      for (var i = 0; i < list.length; i++) {
        var im = list[i];
        if (im.getAttribute('data-src') === picked.file && (im.getAttribute('data-field') === 'b' ? 'body' : 'line') === picked.field) return im;
      }
      return null;
    }

    function paintPick() {
      var old = root.querySelectorAll('img.mv-img[data-picked]');
      for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-picked');
      if (!picked) return;
      var im = pickedImg();
      if (!im) {
        if (!recs.has(picked.path)) picked = null;
        return;
      }
      im.setAttribute('data-picked', '');
    }

    function pickImage(sel) {
      var next = sel && sel.path !== undefined && sel.path !== null && sel.file ? { path: String(sel.path), file: String(sel.file), kind: sel.kind === 'draw' ? 'draw' : 'photo', field: sel.field === 'body' ? 'body' : 'line', index: sel.index } : null;
      if (!next && !picked) return;
      picked = next;
      paintPick();
      emit('pick', { picked: picked ? Object.assign({}, picked) : null });
    }

    function getPicked() {
      if (picked && !pickedImg()) {
        /* Gone from the node (taken out, an undo, the Markdown panel). */
        picked = null;
        paintPick();
      }
      return picked ? Object.assign({}, picked) : null;
    }

    /* ---------- folds ---------- */

    function fold(path, value, o) {
      o = o || {};
      if (!index.has(path) || !hasKids(path)) return Promise.resolve(false);
      var want = value === undefined || value === null ? !folds.has(path) : !!value;
      var changed = false;
      function set(p) {
        if (!hasKids(p)) return;
        if (want && !folds.has(p)) { folds.add(p); changed = true; }
        if (!want && folds.has(p)) { folds.delete(p); changed = true; }
      }
      if (o.deep) {
        (function walk(v) {
          set(v.path);
          var kids = v.children || [];
          for (var i = 0; i < kids.length; i++) walk(kids[i]);
        })(index.get(path).view);
      } else set(path);
      foldsGiven = true;
      if (!changed) return Promise.resolve(false);
      emit('fold', { path: path, folded: want, deep: !!o.deep, folds: folded() });
      return update({ animate: o.animate !== false, anchor: path, collapse: want }).then(function () { return true; });
    }

    function isFolded(path) { return folds.has(path); }

    function folded() {
      var out = new Set();
      folds.forEach(function (p) { if (!tree || hasKids(p)) out.add(p); });
      return out;
    }

    /* The fold set of the tree on screen (to change it and the tree in one
     * update, render(tree, {folds}) instead). */
    function setFolded(set, o) {
      folds = new Set();
      if (set && typeof set.forEach === 'function') set.forEach(function (p) { folds.add(String(p)); });
      foldsGiven = true;
      if (!tree) return Promise.resolve();
      return update({ animate: !!(o && o.animate), keepCamera: !!(o && o.keepCamera) });
    }

    function unfoldTo(path) {
      if (!index.has(path)) return Promise.resolve(false);
      var changed = false;
      var p = parentOf(path);
      var anchor = null;
      while (p !== null && p !== undefined) {
        if (folds.has(p)) { folds.delete(p); changed = true; anchor = p; }
        p = parentOf(p);
      }
      if (!changed) return Promise.resolve(false);
      foldsGiven = true;
      emit('fold', { path: anchor, folded: false, deep: false, folds: folded() });
      return update({ animate: true, anchor: anchor }).then(function () { return true; });
    }

    /* ---------- rendering, options ---------- */

    /* A new way to find pictures (another project, storage now ready):
     * every picture that is not a data: or blob: URL is asked for again. */
    function setImageResolver(fn) {
      resolver = typeof fn === 'function' ? fn : null;
      return forgetImage();
    }

    /* The editor wrote into a node (an inline rename) and is done, or the
     * pictures behind it changed: the next render rebuilds it from the tree,
     * whatever the tree says, and asks for its pictures again. With no
     * path, every node. */
    function invalidate(path) {
      if (path === undefined || path === null) {
        recs.forEach(function (r) { r.sig = null; r.csig = null; });
        imageUrls = new Map();
        imageGen++;
        return;
      }
      var r = recs.get(String(path));
      if (!r) return;
      r.sig = null;
      r.csig = null;
      forgetPicturesOf(r.view);
    }

    function render(next, o) {
      o = o || {};
      var carry = !!tree;
      tree = next || null;
      reindex();
      if (o.folds && typeof o.folds.forEach === 'function') {
        folds = new Set();
        o.folds.forEach(function (p) { folds.add(String(p)); });
        foldsGiven = true;
        carry = false;
      } else if (!foldsGiven && tree) {
        seedFolds();
        foldsGiven = true;
      }
      return update({ animate: o.animate !== false, keepCamera: !!o.keepCamera, fit: !!o.fit, carry: carry });
    }

    /* A render waiting for a hidden stage has nothing left to draw: it
     * resolves now instead of running against the next map. */
    function dropWaiting() {
      if (!waiting) return;
      var job = waiting;
      waiting = null;
      job.resolve();
    }

    function clear() {
      stopFlight();
      stopCamera();
      dropWaiting();
      recs.forEach(removeRec);
      leaving.forEach(removeRec);
      buckets.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      buckets = new Map();
      recs = new Map();
      leaving = new Set();
      tree = null;
      index = new Map();
      geo = null;
      linkTo = new Map();
      selected = null;
      /* An empty tree is no Tab stop (the welcome card is in front of it). */
      root.tabIndex = -1;
      cameraGiven = false;
      foldsGiven = false;
      folds = new Set();
      owed = [];
      lag = { x: 0, y: 0 };
      imageUrls = new Map();
      imageGen++;
      dirty.clear();
      writeLayer();
      haloRect.style.display = 'none';
      root.removeAttribute('aria-activedescendant');
      checkIdle();
    }

    function setOptions(o) {
      o = o || {};
      var redo = false;
      var reshaped = false;
      if (o.balance !== undefined && !!o.balance !== opts.balance) {
        opts.balance = !!o.balance;
        redo = true;
        reshaped = true;
      }
      if (o.branchText !== undefined) {
        opts.branchText = !!o.branchText;
        root.classList.toggle('mv--branch-text', opts.branchText);
      }
      if (o.notesOpen !== undefined && !!o.notesOpen !== opts.notesOpen) {
        opts.notesOpen = !!o.notesOpen;
        root.classList.toggle('mv--notes-open', opts.notesOpen);
        redo = true;
      }
      if (o.readOnly !== undefined && !!o.readOnly !== opts.readOnly) {
        opts.readOnly = !!o.readOnly;
        root.classList.toggle('mv--readonly', opts.readOnly);
        if (opts.readOnly && gestures && gestures.mode() === 'drag') gestures.cancel();
        redo = true;
      }
      if (redo && tree) return update({ animate: true, reframe: reshaped });
      return Promise.resolve();
    }

    function options() {
      return { balance: opts.balance, branchText: opts.branchText, notesOpen: opts.notesOpen, readOnly: opts.readOnly };
    }

    /* Resolves once nothing moves: no layout playing, no camera glide,
     * fling or settle, no render waiting for fonts, pictures or a stage to
     * show on. A hand on the map (a pan, a pinch) counts as moving; a drag
     * of a node does not (it can last as long as it likes). */
    function busy() {
      if (flight || camMotion || waiting || pending > 0 || flushTimer) return true;
      var mode = gestures ? gestures.mode() : 'idle';
      return mode === 'pan' || mode === 'pinch' || mode === 'momentum' || mode === 'settle' || mode === 'wheel';
    }

    function settled() {
      if (destroyed || !busy()) return Promise.resolve();
      return new Promise(function (resolve) { idleWaiters.push(resolve); });
    }

    function checkIdle() {
      if (!idleWaiters.length || (busy() && !destroyed)) return;
      var list = idleWaiters;
      idleWaiters = [];
      list.forEach(function (fn) { fn(); });
    }

    /* ---------- hit-testing and geometry ---------- */

    /* A client point in map units where things land (the layout, the
     * camera at rest): what hit-testing answers about. */
    function toMap(clientX, clientY) {
      var r = getRect();
      return { x: (clientX - r.left - cam.x) / cam.k, y: (clientY - r.top - cam.y) / cam.k };
    }

    /* The same point among things as drawn this frame (a layout may still
     * be catching up with the camera): what the DOM under a press shows. */
    function toDrawn(clientX, clientY) {
      var r = getRect();
      return { x: (clientX - r.left - cam.x) / cam.k - lag.x, y: (clientY - r.top - cam.y) / cam.k - lag.y };
    }

    function pathAt(clientX, clientY) {
      if (!geo) return null;
      var p = toMap(clientX, clientY);
      for (var i = 0; i < geo.order.length; i++) {
        var n = geo.nodes[geo.order[i]];
        if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return geo.order[i];
      }
      return null;
    }

    /* Where a dragged node would land: on the upper third of a node, before
     * it; on the lower third, after it; in the middle, as its last child.
     * Rows are widened by half the sibling gap so the space between two
     * siblings still answers. Never into the dragged branch, never onto a
     * spot that would change nothing. */
    /* o.free: anywhere that is no place to drop onto (the empty map, the
     * dragged branch itself, a drop that would change nothing) answers as
     * a place of its own, where the branch is only moved. */
    function dropTarget(clientX, clientY, dragged, o) {
      var onto = nodeTarget(clientX, clientY, dragged);
      if (onto || !geo || !(o && o.free)) return onto;
      return { path: null, where: 'free', side: null };
    }

    function nodeTarget(clientX, clientY, dragged) {
      if (!geo) return null;
      var p = toMap(clientX, clientY);
      var half = LAYOUT_GAPS.gapY / 2;
      var hit = null;
      for (var i = 0; i < geo.order.length; i++) {
        var n = geo.nodes[geo.order[i]];
        if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y - half && p.y <= n.y + n.h + half) { hit = geo.order[i]; break; }
      }
      if (hit === null) return null;
      if (dragged !== undefined && dragged !== null && (hit === dragged || isInside(hit, dragged))) return null;
      var box = geo.nodes[hit];
      var rel = (p.y - (box.y - half)) / (box.h + 2 * half);
      var where = rel < 1 / 3 ? 'before' : (rel > 2 / 3 ? 'after' : 'child');
      if (where !== 'child' && index.has(hit) && tree && tree.path === hit) where = 'child';
      /* Where the drop lands as a first-level branch, the side it grows on:
       * onto a root, the half of the root under the pointer; beside a
       * first-level branch, that branch's side. Deeper, no side: a node
       * grows on its parent's. */
      var side = null;
      if (box.parent === null) {
        if (where === 'child') side = p.x < box.x + box.w / 2 ? 'left' : 'right';
      } else if (where !== 'child' && geo.nodes[box.parent] && geo.nodes[box.parent].parent === null) {
        side = box.side === 'left' ? 'left' : 'right';
      }
      /* A first-level branch taken to the other side is a move even when
       * its place among its siblings stays the same. */
      var dn = dragged !== undefined && dragged !== null ? geo.nodes[dragged] : null;
      var across = !!side && !!dn && dn.parent !== null && !!geo.nodes[dn.parent] && geo.nodes[dn.parent].parent === null &&
        (dn.side === 'left' ? 'left' : 'right') !== side;
      if (!across && dragged !== undefined && dragged !== null && index.has(dragged)) {
        var di = index.get(dragged);
        var hi = index.get(hit);
        if (hi && hi.parent === di.parent) {
          if (where === 'after' && hi.pos === di.pos - 1) return null;
          if (where === 'before' && hi.pos === di.pos + 1) return null;
        }
        if (where === 'child' && hit === di.parent && di.pos === di.size) return null;
      }
      return { path: hit, where: where, side: side };
    }

    function rect(path) {
      var s = screenBox(path);
      if (!s) return null;
      var r = getRect();
      return new DOMRect(r.left + s.x, r.top + s.y, s.w, s.h);
    }

    /* Where a node is drawn this frame, on screen (the lifted copy starts
     * there, and a cancelled drag flies back there). */
    function drawnRect(path) {
      var rec = recs.get(path);
      if (!rec) return null;
      var r = getRect();
      var k = cam.k;
      return new DOMRect(r.left + cam.x + (rec.sx + lag.x) * k, r.top + cam.y + (rec.sy + lag.y) * k, rec.w * k, rec.h * k);
    }

    function edgeMidpoint(path) {
      var l = linkTo.get(path);
      if (!l) return null;
      var m = ns.layout.linkMidpoint(l.x1, l.y1, l.x2, l.y2);
      var r = getRect();
      return { x: r.left + cam.x + m.x * cam.k, y: r.top + cam.y + m.y * cam.k };
    }

    function nodeEl(path) {
      var r = recs.get(path);
      return r ? r.el : null;
    }

    /* The laid-out map as plain data, for the export: the same numbers the
     * screen used, the same link formula, the same colours. */
    function geometry() {
      var out = { nodes: {}, links: [], knobs: [], stubs: [], bounds: geo ? Object.assign({}, geo.bounds) : { x: 0, y: 0, w: 0, h: 0 }, order: geo ? geo.order.slice() : [] };
      if (!geo) return out;
      geo.order.forEach(function (path) {
        var n = geo.nodes[path];
        var r = recs.get(path);
        var color = r ? r.color : null;
        out.nodes[path] = { x: n.x, y: n.y, w: n.w, h: n.h, base: n.base, side: n.side, depth: n.depth, parent: n.parent, hasKids: n.hasKids, hub: !!n.hub, folded: n.folded, color: color };
        out.stubs.push({ path: path, x1: n.x, x2: n.x + n.w, y: n.y + n.base, color: color });
        if (n.hasKids) out.knobs.push({ path: path, cx: n.hub ? n.x + n.w / 2 : n.side === 'left' ? n.x : n.x + n.w, cy: n.y + n.base, r: KNOB_R, folded: n.folded, color: color });
      });
      geo.links.forEach(function (l) {
        var a = out.nodes[l.from];
        var b = out.nodes[l.to];
        var from = a ? a.color : null;
        var to = b ? b.color : null;
        out.links.push({
          from: l.from, to: l.to, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, side: l.side,
          d: ns.layout.linkPath(l.x1, l.y1, l.x2, l.y2),
          colorFrom: from, colorTo: to,
          stops: from && to && from !== to ? stops(from, to) : null
        });
      });
      return out;
    }

    function visiblePaths() { return geo ? geo.order.slice() : []; }

    /* The drawn nodes whose box meets a box of the screen, as
     * [{path, left, top, right, bottom}] in screen pixels: one pass over the
     * laid-out boxes, without measuring anything (bars placed on every key
     * typed into a big map ask this). */
    function nodesIn(box) {
      var out = [];
      if (!geo || !box) return out;
      var r = getRect();
      var k = cam.k;
      var x0 = (box.left - r.left - cam.x) / k;
      var x1 = (box.right - r.left - cam.x) / k;
      var y0 = (box.top - r.top - cam.y) / k;
      var y1 = (box.bottom - r.top - cam.y) / k;
      for (var i = 0; i < geo.order.length; i++) {
        var n = geo.nodes[geo.order[i]];
        if (n.x >= x1 || n.x + n.w <= x0 || n.y >= y1 || n.y + n.h <= y0) continue;
        out.push({ path: geo.order[i], left: r.left + cam.x + n.x * k, top: r.top + cam.y + n.y * k, right: r.left + cam.x + (n.x + n.w) * k, bottom: r.top + cam.y + (n.y + n.h) * k });
      }
      return out;
    }

    /* Arrow keys over what is drawn. Left and right go to the parent and
     * the first child (mirrored on the left side of the root); up and
     * down go to the sibling on the same side, then to the nearest node of
     * the same depth on that side, above or below. */
    function neighbor(path, dir) {
      if (!geo || !geo.order.length) return null;
      if (path === null || path === undefined || !geo.nodes[path]) return geo.order[0];
      var n = geo.nodes[path];
      var kidsOf = function (side) {
        var out = [];
        for (var i = 0; i < geo.order.length; i++) {
          var c = geo.nodes[geo.order[i]];
          if (c.parent === path && (!side || c.side === side)) out.push(geo.order[i]);
        }
        return out;
      };
      if (dir === 'left' || dir === 'right') {
        var outward = n.side === 'left' ? 'left' : 'right';
        if (n.side === null || n.side === undefined) {
          var list = kidsOf(dir);
          return list.length ? list[0] : null;
        }
        if (dir === outward) {
          var k = kidsOf(null);
          return k.length ? k[0] : null;
        }
        return n.parent !== null && geo.nodes[n.parent] ? n.parent : null;
      }
      if (dir !== 'up' && dir !== 'down') return null;
      var sibs = [];
      for (var s = 0; s < geo.order.length; s++) {
        var o = geo.nodes[geo.order[s]];
        if (o.parent === n.parent && o.side === n.side) sibs.push(geo.order[s]);
      }
      var at = sibs.indexOf(path);
      var step = dir === 'up' ? -1 : 1;
      if (sibs[at + step] !== undefined) return sibs[at + step];
      var best = null;
      var bestD = Infinity;
      for (var q = 0; q < geo.order.length; q++) {
        var cp = geo.order[q];
        var c = geo.nodes[cp];
        if (cp === path || c.depth !== n.depth || c.side !== n.side) continue;
        var d = dir === 'up' ? n.y - (c.y + c.h) : c.y - (n.y + n.h);
        if (d < -0.5) continue;
        if (d < bestD) { bestD = d; best = cp; }
      }
      return best;
    }

    /* ---------- drag and drop of nodes ---------- */

    /* Near a stage edge the map pans by itself while something is carried
     * (a lifted node, a pulled thread). where() answers the pointer on
     * screen; update() is called at every move, stop() when it is over. */
    function edgePanner(where, after) {
      var pan = null;
      function edgeSpeed() {
        var rr = getRect();
        var last = where();
        var vx = 0;
        var vy = 0;
        var zone = Math.min(EDGE_ZONE, rr.width / 4, rr.height / 4);
        if (last.x < rr.left + zone) vx = (rr.left + zone - last.x) / zone;
        else if (last.x > rr.right - zone) vx = -(last.x - (rr.right - zone)) / zone;
        if (last.y < rr.top + zone) vy = (rr.top + zone - last.y) / zone;
        else if (last.y > rr.bottom - zone) vy = -(last.y - (rr.bottom - zone)) / zone;
        return { x: clamp(vx, -1, 1) * EDGE_SPEED, y: clamp(vy, -1, 1) * EDGE_SPEED };
      }
      return {
        update: function () {
          var v = edgeSpeed();
          if (!v.x && !v.y) { if (pan) { pan.stop(); pan = null; } return; }
          if (pan) return;
          var lastT = 0;
          pan = ns.gestures.frames(function (elapsed) {
            var dt = Math.min(48, elapsed - lastT);
            lastT = elapsed;
            var s = edgeSpeed();
            if (!s.x && !s.y) return false;
            setCam(constrain({ x: cam.x + s.x * dt, y: cam.y + s.y * dt, k: cam.k }), 'drag');
            if (after) after();
            return true;
          }, function () { pan = null; });
        },
        stop: function () { if (pan) { pan.stop(); pan = null; } }
      };
    }

    /* A lifted copy of the node that follows the pointer, held by the
     * point it was picked up by, above everything (it lives on the body, in
     * screen space), and the drop target lit under it. Near a stage edge the
     * map pans by itself. drop() returns the target ({path, where} or null).
     *
     *   div.mv-ghost-host   at the pointer: translate (the place) and, once
     *                       lifted, scale (about the pointer: the grabbed
     *                       point never slides away from the hand)
     *     div.mv-ghost      the copy, its grabbed point on the host's
     *                       corner, at the map's zoom */
    function dragGhost(path, at, o) {
      o = o || {};
      if (ghost) ghost.cancel();
      var r = recs.get(path);
      var box = drawnRect(path);
      if (!r || !box) return { move: function () { return null; }, drop: function () { return null; }, cancel: function () { return null; }, target: function () { return null; } };
      var clone = r.el.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('role');
      clone.removeAttribute('aria-selected');
      clone.removeAttribute('aria-expanded');
      clone.removeAttribute('aria-level');
      clone.removeAttribute('aria-posinset');
      clone.removeAttribute('aria-setsize');
      clone.removeAttribute('aria-description');
      clone.setAttribute('aria-hidden', 'true');
      clone.classList.remove('mv-node--selected', 'mv-node--leaving', 'mv-node--drop');
      clone.classList.add('mv-ghost');
      if (opts.branchText) clone.classList.add('mv-ghost--tint');
      var host = document.createElement('div');
      host.className = 'mv-ghost-host';
      host.setAttribute('aria-hidden', 'true');
      host.appendChild(clone);
      /* What letting go will do, in words, under the lifted copy. */
      var chip = document.createElement('div');
      chip.className = 'mv-drop-chip';
      chip.hidden = true;
      host.appendChild(chip);
      var refused = false;
      /* A node is a place to drop onto only once the copy has rested over
       * it a moment; before that, letting go only moves the branch. */
      var dwell = null;
      var dwellTimer = 0;
      /* The grabbed point in the node's own px: it stays the grabbed point
       * whatever the zoom does meanwhile (a wheel during the drag). */
      var k0 = cam.k;
      var grab = at ? { x: (at.x - box.left) / k0, y: (at.y - box.top) / k0 } : { x: box.width / 2 / k0, y: box.height / 2 / k0 };
      var last = at ? { x: at.x, y: at.y } : { x: box.left + grab.x * k0, y: box.top + grab.y * k0 };
      var target = null;
      var lit = null;
      var panner = edgePanner(function () { return last; });
      var done = false;
      document.body.appendChild(host);
      r.el.classList.add('mv-node--dragging');
      position();
      requestAnimationFrame(function () {
        if (done) return;
        host.classList.add('is-lifted');
        clone.classList.add('mv-ghost--lift');
      });

      function position() {
        host.style.translate = last.x + 'px ' + last.y + 'px';
        clone.style.transform = 'translate(' + (-grab.x * cam.k) + 'px,' + (-grab.y * cam.k) + 'px) scale(' + cam.k + ')';
        chip.style.transform = 'translate(' + (-grab.x * cam.k) + 'px,' + ((r.h - grab.y) * cam.k) + 'px)';
      }

      /* The middle of the lifted copy, in map units: where a root let go
       * on the empty map stands. */
      function freePoint() {
        var m = toMap(last.x + (r.w / 2 - grab.x) * cam.k, last.y + (r.h / 2 - grab.y) * cam.k);
        return { x: Math.round(m.x), y: Math.round(m.y) };
      }

      function nameOf(p) {
        var v = index.has(p) ? index.get(p).view : null;
        var words = v ? String(v.text || '').replace(/\s+/g, ' ').trim() : '';
        if (words.length > 28) words = words.slice(0, 27) + '\u2026';
        return '\u201c' + (words || '\u2026') + '\u201d';
      }

      function say(next) {
        var text = '';
        if (next && refused) text = t('mapview.drop.refused');
        else if (next && next.where === 'free' && next.over !== undefined) text = t('mapview.drop.hold', { name: nameOf(next.over) });
        else if (next && next.where === 'free') text = t('mapview.drop.place');
        else if (next && next.where === 'child') text = t(next.side ? 'mapview.drop.' + next.side : 'mapview.drop.child', { name: nameOf(next.path) });
        else if (next) text = t('mapview.drop.' + next.where, { name: nameOf(next.path) });
        chip.textContent = text;
        chip.hidden = !text;
        chip.classList.toggle('is-refused', !!next && refused);
      }

      /* The dashed link from the parent the branch will hang from, and in
       * a node the place after its last child on that side. */
      function preview(next) {
        dropLink.style.display = 'none';
        dropSlot.hidden = true;
        if (!next || refused) return;
        var me = geo.nodes[path];
        if (next.where === 'free') {
          /* Moved, it stays on its parent: the link follows the copy. */
          var pn0 = me && me.parent !== null ? geo.nodes[me.parent] : null;
          if (!pn0) return;
          var cx = pn0.x + pn0.w / 2;
          var leftOf = next.x < cx;
          var tx = leftOf ? next.x + me.w / 2 : next.x - me.w / 2;
          var fx = leftOf ? Math.max(pn0.x, Math.min(pn0.x + pn0.w, tx)) : Math.min(pn0.x + pn0.w, Math.max(pn0.x, tx));
          /* Over or under a root: from its circle, down onto the copy's line. */
          if (pn0.hub && next.x - me.w / 2 < pn0.x + pn0.w && next.x + me.w / 2 > pn0.x) {
            fx = cx;
            tx = Math.max(next.x - me.w / 2, Math.min(next.x + me.w / 2, cx));
            if (Math.abs(tx - fx) < 1) tx = fx + 1;
          }
          var ty = next.y - me.h / 2 + me.base;
          dropLink.setAttribute('d', ns.layout.linkPath(fx, pn0.y + pn0.base, tx, ty));
          dropLink.style.setProperty('--branch', recs.get(path) ? recs.get(path).color : '');
          dropLink.style.display = '';
          return;
        }
        var n = geo.nodes[next.path];
        if (!n || !me) return;
        var color = recs.get(next.path) ? recs.get(next.path).color : '';
        var from = null;
        var to = null;
        var side;
        if (next.where === 'child') {
          side = n.parent === null ? (next.side || 'right') : (n.side === 'left' ? 'left' : 'right');
          var tail = null;
          geo.order.forEach(function (q) {
            var k = geo.nodes[q];
            if (k.parent === next.path && q !== path && (k.side === 'left' ? 'left' : 'right') === side) tail = k;
          });
          var sx = side === 'left' ? n.x - LAYOUT_GAPS.gapX - me.w : n.x + n.w + LAYOUT_GAPS.gapX;
          var sy = tail && !n.folded ? tail.y + tail.h + LAYOUT_GAPS.gapY : n.y + n.base - me.base;
          dropSlot.style.width = me.w + 'px';
          dropSlot.style.height = me.h + 'px';
          dropSlot.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
          dropSlot.style.setProperty('--branch', color);
          dropSlot.hidden = false;
          from = { x: side === 'left' ? n.x : n.x + n.w, y: n.y + n.base };
          to = { x: side === 'left' ? sx + me.w : sx, y: sy + me.base };
        } else if (n.parent !== null && geo.nodes[n.parent]) {
          var pn = geo.nodes[n.parent];
          side = n.side === 'left' ? 'left' : 'right';
          var ly = next.where === 'before' ? n.y - LAYOUT_GAPS.gapY / 2 : n.y + n.h + LAYOUT_GAPS.gapY / 2;
          from = { x: side === 'left' ? pn.x : pn.x + pn.w, y: pn.y + pn.base };
          to = { x: side === 'left' ? n.x + n.w : n.x, y: ly };
          color = recs.get(n.parent) ? recs.get(n.parent).color : color;
        }
        if (!from) return;
        dropLink.setAttribute('d', ns.layout.linkPath(from.x, from.y, to.x, to.y));
        dropLink.style.setProperty('--branch', color);
        dropLink.style.display = '';
      }

      function highlight(next) {
        if (lit && (!next || lit !== recs.get(next.path) || next.where !== 'child')) {
          lit.el.classList.remove('mv-node--drop');
          lit.el.removeAttribute('data-drop-side');
          lit = null;
        }
        say(next);
        preview(next);
        /* Over a node the copy thins out, so the node it is about shows through. */
        clone.classList.toggle('mv-ghost--over', !!next && next.where !== 'free');
        if (!next || next.where === 'free') { dropLine.hidden = true; return; }
        var tr = recs.get(next.path);
        var n = geo.nodes[next.path];
        if (next.where === 'child') {
          dropLine.hidden = true;
          if (tr && lit !== tr) { tr.el.classList.add('mv-node--drop'); lit = tr; }
          /* Onto a root: the side the branch will grow on is marked. */
          if (tr) {
            if (next.side) tr.el.setAttribute('data-drop-side', next.side);
            else tr.el.removeAttribute('data-drop-side');
          }
          return;
        }
        var y = next.where === 'before' ? n.y - LAYOUT_GAPS.gapY / 2 : n.y + n.h + LAYOUT_GAPS.gapY / 2;
        dropLine.hidden = false;
        dropLine.classList.toggle('mv-drop-line--left', n.side === 'left');
        dropLine.style.width = n.w + 'px';
        dropLine.style.transform = 'translate(' + n.x + 'px,' + y + 'px)';
        dropLine.style.setProperty('--branch', tr ? tr.color : '');
      }

      function retarget() {
        var next = dropTarget(last.x, last.y, path, { free: true });
        if (next && next.where !== 'free') {
          if (!dwell || dwell.path !== next.path) {
            dwell = { path: next.path, at: Date.now(), ready: false };
            clearTimeout(dwellTimer);
            dwellTimer = setTimeout(function () {
              if (done || !dwell) return;
              dwell.ready = true;
              retarget();
              /* The place changed with no move: the owner hears it. */
              if (typeof o.onTarget === 'function') o.onTarget(target);
            }, DWELL);
          }
          if (!dwell.ready) next = { path: null, where: 'free', side: null, over: next.path };
        } else {
          dwell = null;
          clearTimeout(dwellTimer);
        }
        if (next && next.where === 'free') {
          var fp = freePoint();
          next.x = fp.x;
          next.y = fp.y;
        }
        var same = (next && target && next.path === target.path && next.where === target.where && next.side === target.side && next.over === target.over) || (!next && !target);
        target = next;
        if (!same) highlight(next);
        else if (next && next.where === 'free') preview(next);
      }

      function cleanup() {
        done = true;
        clearTimeout(dwellTimer);
        panner.stop();
        highlight(null);
        r.el.classList.remove('mv-node--dragging');
        if (ghost === api) ghost = null;
      }

      /* Dropped: the copy fades where it is (the node is about to be drawn
       * at its new place). Cancelled: it flies back onto the node, set down
       * as it goes. */
      function vanish(toBox) {
        var fade = !reducedMotion() && !document.hidden && typeof host.animate === 'function';
        if (!fade) { host.remove(); return; }
        var m = tokensNow();
        var here = last.x + 'px ' + last.y + 'px';
        var frames = toBox
          ? [{ translate: here, opacity: 1 }, { translate: (toBox.left + grab.x * cam.k) + 'px ' + (toBox.top + grab.y * cam.k) + 'px', opacity: 1 }]
          : [{ translate: here, opacity: 1 }, { translate: here, opacity: 0 }];
        host.classList.remove('is-lifted');
        clone.classList.remove('mv-ghost--lift');
        var anim = host.animate(frames, { duration: toBox ? m.map : m.map * 0.6, easing: m.outCss, fill: 'forwards' });
        var gone = function () { host.remove(); };
        anim.onfinish = gone;
        anim.oncancel = gone;
        setTimeout(gone, m.map + 200);
      }

      var api = {
        move: function move(x, y) {
          if (done) return null;
          last = { x: x, y: y };
          position();
          retarget();
          panner.update();
          return target;
        },
        drop: function drop() {
          if (done) return null;
          var out = target;
          cleanup();
          vanish(null);
          return out;
        },
        cancel: function cancel() {
          if (done) return null;
          cleanup();
          vanish(drawnRect(path));
          return null;
        },
        target: function current() { return target; },
        refresh: function refresh() { if (!done) { position(); retarget(); } },
        /* The owner's verdict on the place in hand (a move the model would
         * refuse): said in the chip, and the preview stands down. */
        refuse: function refuse(no) {
          if (done || refused === !!no) return;
          refused = !!no;
          say(target);
          preview(target);
        }
      };
      ghost = api;
      return api;
    }

    /* A thread pulled from the selected node, for as long as the pointer
     * is down. mode 'in': the thread that holds the node to its parent
     * comes off; its loose end follows the pointer; over another node it is
     * plugged there (the node becomes that node's child), in the open it
     * lets the node go (detach, where it stands). mode 'out': a new thread
     * from the node; over another node, that node becomes its child.
     * Targets: {path, where: 'child', side} (path is the node to plug into
     * for 'in', the node taken in for 'out'), {where: 'same'} (over the
     * parent it already hangs from: nothing to do), {where: 'free'} (the
     * open, 'in' only), or null. */
    function threadGhost(path, mode, at, o) {
      o = o || {};
      if (ghost) ghost.cancel();
      var n = geo && geo.nodes[path];
      var r = recs.get(path);
      var none = { move: function () { return null; }, drop: function () { return null; }, cancel: function () { return null; }, target: function () { return null; }, refuse: function () {}, refresh: function () {} };
      if (!n || !r) return none;
      var line = svg('path', { class: 'mv-thread' });
      var plug = svg('circle', { class: 'mv-thread-plug' });
      line.style.setProperty('--branch', r.color || '');
      plug.style.setProperty('--branch', r.color || '');
      under.appendChild(line);
      under.appendChild(plug);
      var chip = document.createElement('div');
      chip.className = 'mv-drop-chip mv-thread-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.hidden = true;
      document.body.appendChild(chip);
      var box = drawnRect(path);
      var last = at ? { x: at.x, y: at.y } : { x: box ? box.left + box.width / 2 : 0, y: box ? box.top + box.height / 2 : 0 };
      var target = null;
      var lit = null;
      var refused = false;
      var done = false;
      var panner = edgePanner(function () { return last; }, function () { draw(); retarget(); });

      function anchor(p) {
        var right;
        if (mode === 'in') right = n.side === 'left';
        else if (n.side === 'left') right = false;
        else if (n.side === 'right') right = true;
        else right = p.x >= n.x + n.w / 2;
        return { x: right ? n.x + n.w : n.x, y: n.y + n.base };
      }

      function draw() {
        var p = toMap(last.x, last.y);
        var a = anchor(p);
        line.setAttribute('d', ns.layout.linkPath(a.x, a.y, p.x, p.y));
        plug.setAttribute('cx', f(p.x));
        plug.setAttribute('cy', f(p.y));
        plug.setAttribute('r', f(5 / cam.k));
        chip.style.transform = 'translate(' + f(last.x + 14) + 'px,' + f(last.y + 18) + 'px)';
      }

      function nameOf(p) {
        var v = index.has(p) ? index.get(p).view : null;
        var words = v ? String(v.text || '').replace(/\s+/g, ' ').trim() : '';
        if (words.length > 28) words = words.slice(0, 27) + '\u2026';
        return '\u201c' + (words || '\u2026') + '\u201d';
      }

      function say() {
        var text = '';
        if (target && target.where === 'same') text = t('mapview.thread.same', { name: nameOf(target.path) });
        else if (target && refused) text = t('mapview.drop.refused');
        else if (target && target.where === 'free') text = t('mapview.thread.free');
        else if (target) text = t('mapview.thread.' + mode, { name: nameOf(target.path) });
        else text = t(mode === 'in' ? 'mapview.thread.hintIn' : 'mapview.thread.hintOut');
        chip.textContent = text;
        chip.hidden = false;
        chip.classList.toggle('is-refused', !!target && refused && target.where !== 'same');
        line.classList.toggle('is-refused', !!target && refused && target.where !== 'same');
        line.classList.toggle('is-free', !!target && target.where === 'free');
      }

      /* The nearest node to the loose end, within half a gap. */
      function hitAt() {
        var p = toMap(last.x, last.y);
        var half = LAYOUT_GAPS.gapY / 2;
        var best = null;
        var bestD = Infinity;
        for (var i = 0; i < geo.order.length; i++) {
          var q = geo.nodes[geo.order[i]];
          if (geo.order[i] === path || p.x < q.x || p.x > q.x + q.w) continue;
          var dy = Math.max(q.y - p.y, 0, p.y - (q.y + q.h));
          if (dy <= half && dy < bestD) { bestD = dy; best = geo.order[i]; }
        }
        return best;
      }

      function light(next) {
        var rec = next && next.where === 'child' ? recs.get(next.path) : null;
        if (lit && lit !== rec) {
          lit.el.classList.remove('mv-node--drop');
          lit.el.removeAttribute('data-drop-side');
          lit = null;
        }
        if (!rec) return;
        if (lit !== rec) { rec.el.classList.add('mv-node--drop'); lit = rec; }
        if (next.side && mode === 'in') rec.el.setAttribute('data-drop-side', next.side);
        else rec.el.removeAttribute('data-drop-side');
      }

      function retarget() {
        var hit = hitAt();
        var next = null;
        if (hit !== null) {
          var q = geo.nodes[hit];
          var p = toMap(last.x, last.y);
          var side = null;
          if (mode === 'in' && q.parent === null) side = p.x < q.x + q.w / 2 ? 'left' : 'right';
          if (mode === 'out' && n.parent === null) side = q.x + q.w / 2 < n.x + n.w / 2 ? 'left' : 'right';
          next = mode === 'in' && hit === n.parent ? { path: hit, where: 'same', side: null } : { path: hit, where: 'child', side: side };
        } else if (mode === 'in') {
          next = { path: null, where: 'free', side: null };
        }
        var same = (next && target && next.path === target.path && next.where === target.where && next.side === target.side) || (!next && !target);
        target = next;
        if (!same) { light(next); say(); }
      }

      function cleanup() {
        done = true;
        panner.stop();
        light(null);
        if (line.parentNode) line.parentNode.removeChild(line);
        if (plug.parentNode) plug.parentNode.removeChild(plug);
        chip.remove();
        if (ghost === api) ghost = null;
      }

      var api = {
        move: function move(x, y) {
          if (done) return null;
          last = { x: x, y: y };
          draw();
          retarget();
          panner.update();
          return target;
        },
        drop: function drop() {
          if (done) return null;
          var out = target;
          cleanup();
          return out;
        },
        cancel: function cancel() { if (!done) cleanup(); return null; },
        target: function current() { return target; },
        refresh: function refresh() { if (!done) { draw(); retarget(); } },
        refuse: function refuse(no) {
          if (done || refused === !!no) return;
          refused = !!no;
          say();
        }
      };
      ghost = api;
      draw();
      retarget();
      say();
      return api;
    }

    /* ---------- pointer intents ---------- */

    /* The knob nearest a press, by where knobs are drawn: knob targets may
     * overlap at a low zoom, and the nearest one is meant. */
    function nearestKnob(clientX, clientY) {
      var p = toDrawn(clientX, clientY);
      var best = null;
      var bestD = Infinity;
      recs.forEach(function (r) {
        if (!r.hasKids || !r.knob) return;
        var c = knobAt(r);
        var d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bestD) { bestD = d; best = r.path; }
      });
      return best !== null && bestD * cam.k <= knobHit + 1 ? best : null;
    }

    function classify(target, x, y) {
      var el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
      if (!el || !el.closest) return { kind: 'background', path: null, key: 'bg' };
      var knob = el.closest('.mv-knob, .mv-knob-hit');
      if (knob && (over.contains(knob) || under.contains(knob)) && !knob.classList.contains('is-leaving')) {
        var kp = isFinite(x) && isFinite(y) ? nearestKnob(x, y) : null;
        if (kp === null) kp = knob.getAttribute('data-path');
        return { kind: 'knob', path: kp, key: 'k:' + kp };
      }
      if (el.closest('.mv-grip') && overlay.contains(el) && selected !== null) return { kind: 'grip', path: selected, key: 'g:' + selected };
      var wire = el.closest('.mv-wire');
      if (wire && overlay.contains(wire) && selected !== null) return { kind: 'wire', wire: wire.getAttribute('data-wire'), path: selected, key: 'w:' + selected + ':' + wire.getAttribute('data-wire') };
      var dot = el.closest('.mv-edge-dot, .mv-card--edge');
      if (dot && overlay.contains(dot) && !dot.classList.contains('is-leaving')) {
        var dp = dot.getAttribute('data-path');
        return { kind: 'edgenote', path: dp, key: 'e:' + dp };
      }
      var node = el.closest('.mv-node');
      if (node && nodesBox.contains(node) && node.__mvRec && !node.__mvRec.leaving) {
        var path = node.__mvRec.path;
        var key = 'n:' + path;
        if (el.closest('.mv-note-dot, .mv-card--node')) return { kind: 'note', path: path, key: 'd:' + path };
        if (el.closest('.mv-task')) return { kind: 'task', path: path, key: 't:' + path };
        var box = el.closest('.md-check');
        if (box && node.contains(box)) return { kind: 'bodytask', path: path, key: 'c:' + path + ':' + box.getAttribute('data-i'), index: Number(box.getAttribute('data-i')) };
        var a = el.closest('a');
        if (a && node.contains(a)) {
          var isMap = a.classList.contains('md-map');
          return { kind: 'link', path: path, key: 'l:' + path, href: isMap ? a.getAttribute('data-map') : a.getAttribute('href'), linkKind: isMap ? 'map' : 'url', node: isMap ? a.getAttribute('data-node') || '' : '' };
        }
        var img = el.closest('img.mv-img');
        if (img) return { kind: 'image', path: path, key: key, image: { path: img.getAttribute('data-src'), kind: img.getAttribute('data-kind'), field: img.getAttribute('data-field') === 'b' ? 'body' : 'line', index: Number(img.getAttribute('data-i')) } };
        return { kind: 'node', path: path, key: key };
      }
      return { kind: 'background', path: null, key: 'bg' };
    }

    function onTap(info) {
      var at = { x: info.x, y: info.y };
      switch (info.kind) {
        case 'knob':
          /* A report, like a selection: the owner folds (view.fold), and
           * the view then says 'fold' for persistence. */
          emit('knob', { path: info.path, deep: !!(info.ctrlKey || info.metaKey), folded: !folds.has(info.path) });
          break;
        case 'note': emit('note', { path: info.path, kind: 'node' }); break;
        case 'edgenote': emit('note', { path: info.path, kind: 'edge' }); break;
        case 'task':
          if (opts.readOnly) emit('select', { path: info.path, x: at.x, y: at.y });
          else emit('task', { path: info.path });
          break;
        case 'bodytask':
          if (opts.readOnly) emit('select', { path: info.path, x: at.x, y: at.y });
          else emit('bodytask', { path: info.path, index: info.index });
          break;
        case 'link': emit('link', { path: info.path, href: info.href, kind: info.linkKind, node: info.node || '' }); break;
        case 'grip': emit('grip', { path: info.path }); break;
        case 'wire': emit('wire', { path: info.path, wire: info.wire }); break;
        case 'image':
          emit('select', { path: info.path, x: at.x, y: at.y });
          pickImage({ path: info.path, file: info.image.path, kind: info.image.kind, field: info.image.field, index: info.image.index });
          emit('image', { path: info.path, image: info.image });
          break;
        case 'node':
          pickImage(null);
          emit('select', { path: info.path, x: at.x, y: at.y });
          break;
        default:
          pickImage(null);
          emit('background', at);
      }
    }

    function onDoubleTap(info) {
      if (info.kind === 'background') { fit({ animate: true }); return; }
      /* Only the words: a double click on a picture, a link, a box or a
       * knob already did what its first click does (a picture opened in
       * the viewer), and writing on top of that is a second thing at once. */
      if (info.kind !== 'node') return;
      if (info.path !== null && info.path !== undefined) emit('activate', { path: info.path });
    }

    function onContext(info) {
      var path = info.kind === 'background' ? null : info.path;
      emit('context', { path: path === undefined ? null : path, x: info.x, y: info.y, pointerType: info.pointerType });
    }

    function ignore(e) {
      var target = e.target;
      if (isTextField(target)) return true;
      return !!(target && target.closest && target.closest('[data-mv-ignore]'));
    }

    /* What the hand is doing, as the owner hears it: the map moving under
     * it. A press, a tap or a long press is not a gesture (hiding the
     * floating bars on every press made them flash on every click). */
    var REPORTED = { pan: 'pan', pinch: 'pinch', drag: 'drag', wheel: 'wheel', momentum: 'momentum', settle: 'settle' };
    var MOVING = { pan: true, pinch: true, momentum: true, settle: true, wheel: true, drag: true };

    function setState(mode) {
      shield.hidden = mode !== 'pan';
      if (MOVING[mode]) promote();
      else if (mode === 'idle' && !camMotion) settleRaster();
      var state = REPORTED[mode] || 'idle';
      if (state !== reported) {
        reported = state;
        if (state === 'idle') root.removeAttribute('data-gesture');
        else root.setAttribute('data-gesture', state);
        emit('gesture', { state: state });
      }
      if (state === 'idle') checkIdle();
    }

    /* The transformed layer is promoted to its own compositor layer while
     * the hand is on the map, so a pan moves pixels instead of repainting
     * 2,000 nodes. Promotion and demotion each cost one full paint, so the
     * layer stays promoted afterwards as long as the zoom it was rasterised
     * at holds (pans after the first are free); once a zoom has ended it is
     * demoted, so the words are drawn sharp at the new scale, and promoted
     * again when the page is idle. */
    var promoted = false;
    var promotedK = 1;
    var idleJob = null;

    function promote() {
      cancelIdle();
      if (promoted) return;
      promoted = true;
      promotedK = cam.k;
      layer.style.willChange = 'transform';
    }

    function settleRaster() {
      if (promoted && Math.abs(cam.k - promotedK) > 1e-9) {
        promoted = false;
        layer.style.willChange = '';
      }
      if (!promoted) promoteWhenIdle();
    }

    function promoteWhenIdle() {
      if (idleJob || destroyed) return;
      var run = function () {
        idleJob = null;
        if (destroyed || (gestures && gestures.mode() !== 'idle') || camMotion) return;
        promote();
      };
      idleJob = typeof window.requestIdleCallback === 'function'
        ? { ric: window.requestIdleCallback(run, { timeout: 1500 }) }
        : { timer: setTimeout(run, 400) };
    }

    function cancelIdle() {
      if (!idleJob) return;
      if (idleJob.ric && window.cancelIdleCallback) window.cancelIdleCallback(idleJob.ric);
      if (idleJob.timer) clearTimeout(idleJob.timer);
      idleJob = null;
    }

    var gestures = ns.gestures.attach(root, {
      minK: MIN_K,
      maxK: MAX_K,
      camera: camera,
      setCamera: function (c, info) { setCam(c, info && info.source); },
      constrain: constrain,
      rect: getRect,
      classify: classify,
      ignore: ignore,
      canDrag: function (info) {
        return !opts.readOnly && hasListener('dragstart') && info.path !== null && info.path !== undefined &&
          (info.kind === 'node' || info.kind === 'image' || info.kind === 'link' || info.kind === 'task' || info.kind === 'bodytask' || info.kind === 'note' || info.kind === 'grip' || info.kind === 'wire');
      },
      tap: onTap,
      doubleTap: onDoubleTap,
      longPress: onContext,
      context: onContext,
      dragStart: function (info) {
        /* Lifted by its grip, the node is held by its middle. */
        var held = info.kind === 'grip' ? drawnRect(info.path) : null;
        if (info.kind === 'wire') emit('dragstart', { path: info.path, x: info.x, y: info.y, pointerType: info.pointerType, wire: info.wire });
        else if (held) emit('dragstart', { path: info.path, x: held.left + held.width / 2, y: held.top + held.height / 2, pointerType: info.pointerType });
        else emit('dragstart', { path: info.path, x: info.x, y: info.y, pointerType: info.pointerType });
        return true;
      },
      dragMove: function (info) { emit('dragmove', { path: info.path, x: info.x, y: info.y }); },
      dragEnd: function (info) {
        emit('dragend', { path: info.path, x: info.x, y: info.y, cancelled: !!info.cancelled });
        if (ghost) ghost.cancel();
      },
      state: setState,
      stop: stopCamera,
      reducedMotion: reducedMotion
    });

    /* The position of the stage is read here, at the start of a gesture, so
     * nothing has to read layout while the pointer moves. (Focus needs no
     * help: the map is focusable, so pressing it takes the keyboard away
     * from a text field the browser's own way, without a focus ring.) */
    function onPointerDown(e) {
      if (ignore(e)) return;
      freshRect();
    }
    function onWheelFirst() { if (gestures.mode() === 'idle') freshRect(); }
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('wheel', onWheelFirst, { capture: true, passive: true });

    /* ---------- watching the page ---------- */

    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(root);

    function onResize(entries) {
      var stageChanged = false;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.target === root) { stageChanged = true; continue; }
        var r = e.target.__mvRec;
        if (!r || r.leaving || r.fresh || recs.get(r.path) !== r) continue;
        var w = r.el.offsetWidth;
        var h = r.el.offsetHeight;
        if (w !== r.w || h !== r.h) { r.dirty = true; dirty.add(r); }
      }
      if (stageChanged) resized();
      if (dirty.size) scheduleFlush();
    }

    function resized() {
      rectCache = null;
      var w = root.clientWidth;
      var h = root.clientHeight;
      if (w === size.w && h === size.h) return;
      var old = size;
      size = { w: w, h: h };
      /* The point at the middle of the stage stays at the middle: a rotated
       * phone or a panel opening keeps what was being looked at. */
      if (old.w && old.h && w && h && geo && geo.order.length) setCam({ x: cam.x + (w - old.w) / 2, y: cam.y + (h - old.h) / 2, k: cam.k }, 'layout');
      if (waiting && live()) {
        var job = waiting;
        waiting = null;
        update(job.u).then(job.resolve, job.resolve);
        return;
      }
      payOwed();
    }

    function onWindowChange() { rectCache = null; }
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    var coarseQuery = media('(pointer: coarse)');
    function onPointerKind() {
      knobHit = coarse() ? KNOB_HIT.coarse : KNOB_HIT.fine;
      hitR = { under: -1, over: -1 };
      sizeHits();
    }

    /* A knob keeps its target size on screen at any zoom (22 px for a
     * finger): outside its box the whole circle (beneath the words, so it
     * never takes one), inside the box as far as the box's side padding.
     * Redone when the zoom has moved by a few percent, at most once a
     * frame. */
    function sizeHits() {
      var u = Math.max(knobHit / cam.k, KNOB_R + 2);
      var o = clamp(knobHit / cam.k, KNOB_R, PAD_X);
      if (Math.abs(u - hitR.under) < hitR.under * 0.05 && Math.abs(o - hitR.over) < 0.25) return;
      hitR = { under: u, over: o };
      var set = function (rec) {
        if (rec.hit) rec.hit.setAttribute('r', f(u));
        if (rec.knob) rec.knob.firstChild.setAttribute('r', f(o));
      };
      recs.forEach(set);
      leaving.forEach(set);
    }
    if (coarseQuery && coarseQuery.addEventListener) coarseQuery.addEventListener('change', onPointerKind);

    function onFonts() {
      recs.forEach(function (r) { r.dirty = true; dirty.add(r); });
      scheduleFlush();
    }
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts);

    var offLang = ns.bus && typeof ns.bus.on === 'function' ? ns.bus.on('lang', function () {
      root.setAttribute('aria-label', t('mapview.label'));
      root.setAttribute('aria-description', t('mapview.keys'));
      recs.forEach(label);
    }) : null;

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (ghost) ghost.cancel();
      gestures.destroy();
      stopFlight();
      stopCamera();
      dropWaiting();
      if (ro) ro.disconnect();
      cancelIdle();
      clearTimeout(flushTimer);
      if (viewFrame) { clearTimeout(viewFrame.timer); cancelAnimationFrame(viewFrame.raf); viewFrame = 0; }
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
      if (coarseQuery && coarseQuery.removeEventListener) coarseQuery.removeEventListener('change', onPointerKind);
      if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts);
      if (typeof offLang === 'function') offLang();
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('wheel', onWheelFirst, { capture: true, passive: true });
      if (root.parentNode) root.parentNode.removeChild(root);
      listeners = Object.create(null);
      checkIdle();
    }

    size = { w: root.clientWidth, h: root.clientHeight };
    setCam(cam, 'internal');

    var view = {
      el: root,
      render: render,
      clear: clear,
      setOptions: setOptions,
      options: options,
      select: select,
      selected: getSelected,
      pickImage: pickImage,
      picked: getPicked,
      fold: fold,
      isFolded: isFolded,
      setFolded: setFolded,
      folded: folded,
      unfoldTo: unfoldTo,
      fit: fit,
      ensureVisible: ensureVisible,
      center: center,
      zoomBy: zoomBy,
      zoomTo: zoomTo,
      camera: camera,
      setCamera: setCamera,
      setInsets: function setInsets(i) { insets = i || null; },
      setImageResolver: setImageResolver,
      forgetImage: forgetImage,
      invalidate: invalidate,
      settled: settled,
      nodeEl: nodeEl,
      rect: rect,
      nodesIn: nodesIn,
      edgeMidpoint: edgeMidpoint,
      pathAt: pathAt,
      dropTarget: dropTarget,
      dragGhost: dragGhost,
      threadGhost: threadGhost,
      geometry: geometry,
      /* The layout a tree would have with the sizes drawn now, without drawing it. */
      layoutOf: function (t) { return runLayout(t); },
      visiblePaths: visiblePaths,
      neighbor: neighbor,
      gesture: function gesture() { return REPORTED[gestures.mode()] || 'idle'; },
      cancelGesture: function cancelGesture() { gestures.cancel(); },
      on: on,
      off: offEvent,
      destroy: destroy
    };
    return view;
  }

  /* A linear-light mix for when ns.colors is not loaded (a bare test page):
   * the same gamma-2.2 formula as colors.mixLinear. */
  function mixLocal(a, b) {
    function rgb(hex) {
      var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
      if (!m) return null;
      var n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var x = rgb(a);
    var y = rgb(b);
    if (!x || !y) return a || b;
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.round(Math.pow((Math.pow(x[i] / 255, 2.2) + Math.pow(y[i] / 255, 2.2)) / 2, 1 / 2.2) * 255);
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  ns.mapview = {
    create: create,
    MIN_K: MIN_K,
    MAX_K: MAX_K,
    KNOB_R: KNOB_R,
    GAPS: LAYOUT_GAPS,
    signature: signature,
    contentSig: contentSig,
    contentHtml: contentHtml,
    carryFolds: carryFolds
  };
})(window.MindRoot);
