/* MindRoot - helpers for the paper suites: read back what ns.paper drew.
 *
 * The suites check geometry with numbers, so they parse the SVG fragment
 * and turn every path into plain segments (horizontal, vertical, straight)
 * and circles, keeping the class (the colour role) and the opacity of the
 * path they came from. Only the commands paper.js writes are understood:
 * M H V L C A Z, absolute. */
window.PaperTest = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function parse(fragment) {
    var doc = new DOMParser().parseFromString('<svg xmlns="' + SVG_NS + '">' + fragment + '</svg>', 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('not XML: ' + fragment.slice(0, 200));
    return doc.documentElement;
  }

  function tokens(d) {
    return String(d).match(/[MHVLCAZ]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || [];
  }

  /* Every path of the fragment as {cls, opacity, width, segs, circles,
   * fill}. A circle is two half arcs with the same radius. */
  function paths(fragment) {
    var root = typeof fragment === 'string' ? parse(fragment) : fragment;
    var out = [];
    var els = root.getElementsByTagName('path');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.parentNode && el.parentNode.localName === 'pattern') continue;
      var tk = tokens(el.getAttribute('d'));
      var segs = [];
      var circles = [];
      var x = 0;
      var y = 0;
      var sx = 0;
      var sy = 0;
      var j = 0;
      var cmd = null;
      var arcStart = null;
      function num() { return parseFloat(tk[j++]); }
      while (j < tk.length) {
        if (/[A-Za-z]/.test(tk[j])) cmd = tk[j++];
        if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; arcStart = null; }
        else if (cmd === 'H') { var nx = num(); segs.push({ kind: 'h', x1: x, y1: y, x2: nx, y2: y }); x = nx; }
        else if (cmd === 'V') { var ny = num(); segs.push({ kind: 'v', x1: x, y1: y, x2: x, y2: ny }); y = ny; }
        else if (cmd === 'L') { var lx = num(); var ly = num(); segs.push({ kind: 'l', x1: x, y1: y, x2: lx, y2: ly }); x = lx; y = ly; }
        else if (cmd === 'C') { num(); num(); num(); num(); x = num(); y = num(); segs.push({ kind: 'c' }); }
        else if (cmd === 'A') {
          var rx = num(); num(); num(); num(); num(); var ax = num(); var ay = num();
          if (arcStart && Math.abs(ax - arcStart.x) < 0.02 && Math.abs(ay - arcStart.y) < 0.02) {
            circles.push({ cx: (arcStart.x + arcStart.mx) / 2, cy: ay, r: rx });
            arcStart = null;
          } else if (!arcStart && Math.abs(ay - y) < 0.02 && Math.abs(Math.abs(ax - x) - 2 * rx) < 0.05) {
            arcStart = { x: x, y: y, mx: ax };
          } else {
            segs.push({ kind: 'a' });
          }
          x = ax; y = ay;
        } else if (cmd === 'Z') { x = sx; y = sy; cmd = null; }
        else { j++; }
      }
      out.push({
        cls: el.getAttribute('class'),
        stroke: el.getAttribute('stroke'),
        fill: el.getAttribute('fill'),
        opacity: parseFloat(el.getAttribute('stroke-opacity') || el.getAttribute('fill-opacity') || '1'),
        width: parseFloat(el.getAttribute('stroke-width') || '0'),
        segs: segs,
        circles: circles,
        filled: el.getAttribute('fill') !== 'none'
      });
    }
    return out;
  }

  /* Segments of one kind, optionally of one class. */
  function segs(fragment, kind, cls) {
    var out = [];
    paths(fragment).forEach(function (p) {
      if (cls && p.cls !== cls) return;
      if (p.filled) return;
      p.segs.forEach(function (s) { if (!kind || s.kind === kind) { s.cls = p.cls; s.opacity = p.opacity; s.width = p.width; out.push(s); } });
    });
    return out;
  }

  function uniqueSorted(values, tol) {
    tol = tol || 0.02;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var out = [];
    v.forEach(function (x) { if (!out.length || Math.abs(x - out[out.length - 1]) > tol) out.push(x); });
    return out;
  }

  function diffs(values) {
    var out = [];
    for (var i = 1; i < values.length; i++) out.push(values[i] - values[i - 1]);
    return out;
  }

  function allNear(values, want, tol) {
    tol = tol == null ? 0.02 : tol;
    for (var i = 0; i < values.length; i++) if (Math.abs(values[i] - want) > tol) return false;
    return values.length > 0;
  }

  function texts(fragment) {
    var root = typeof fragment === 'string' ? parse(fragment) : fragment;
    return Array.prototype.map.call(root.getElementsByTagName('text'), function (t) {
      return { text: t.textContent, x: parseFloat(t.getAttribute('x')), y: parseFloat(t.getAttribute('y')) };
    });
  }

  function decodes(svg) {
    var img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return img.decode().then(function () { return { ok: true, w: img.naturalWidth, h: img.naturalHeight }; }, function () { return { ok: false }; });
  }

  return { parse: parse, paths: paths, segs: segs, uniqueSorted: uniqueSorted, diffs: diffs, allNear: allNear, texts: texts, decodes: decodes };
})();
