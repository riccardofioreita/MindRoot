/* MindRoot - the event bus modules talk through.
 *
 * Synchronous on purpose: a 'drop' listener must read the DataTransfer
 * inside the browser's own event, and a 'selection' listener runs before
 * the next frame paints. Handlers run in the order they were added, on a
 * copy of the list, so one that unsubscribes while being called does not
 * make the next one skip. A handler that throws does not stop the others:
 * its error is rethrown on a fresh task, where it still reaches the console
 * (and fails a test) without breaking the emit in progress. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var handlers = Object.create(null);

  function on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.on(' + type + '): a function');
    (handlers[type] || (handlers[type] = [])).push(fn);
    var done = false;
    return function off() {
      if (done) return;
      done = true;
      var list = handlers[type];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  function once(type, fn) {
    var off = on(type, function (detail) {
      off();
      fn(detail);
    });
    return off;
  }

  function emit(type, detail) {
    var list = handlers[type];
    if (!list || !list.length) return 0;
    list = list.slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](detail, type);
      } catch (err) {
        setTimeout(function () { throw err; }, 0);
      }
    }
    return list.length;
  }

  function count(type) { return handlers[type] ? handlers[type].length : 0; }

  ns.bus = { on: on, once: once, emit: emit, count: count };
})(window.MindRoot);
