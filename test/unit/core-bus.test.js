/* core-bus: order, unsubscribe, once, isolation of a throwing handler. */
(function () {
  'use strict';
  var B = window.MindRoot.bus;

  T.test('handlers run in order with detail and type', function () {
    var seen = [];
    var off1 = B.on('a', function (d, type) { seen.push('1:' + d.v + ':' + type); });
    var off2 = B.on('a', function (d) { seen.push('2:' + d.v); });
    T.eq(B.emit('a', { v: 7 }), 2, 'emit returns the number of handlers');
    T.same(seen, ['1:7:a', '2:7'], 'order and arguments');
    off1();
    off1();
    B.emit('a', { v: 8 });
    T.same(seen, ['1:7:a', '2:7', '2:8'], 'off removes, twice is harmless');
    off2();
    T.eq(B.emit('a', {}), 0, 'nobody left');
    T.eq(B.emit('nobody'), 0, 'unknown type');
  });

  T.test('unsubscribing during an emit does not skip the next handler', function () {
    var seen = [];
    var offA = B.on('b', function () { seen.push('a'); offA(); });
    B.on('b', function () { seen.push('b'); });
    B.emit('b');
    B.emit('b');
    T.same(seen, ['a', 'b', 'b'], 'b ran both times, a once');
  });

  T.test('once', function () {
    var n = 0;
    B.once('c', function () { n++; });
    B.emit('c');
    B.emit('c');
    T.eq(n, 1, 'once');
    var off = B.once('c', function () { n++; });
    off();
    B.emit('c');
    T.eq(n, 1, 'once can be cancelled');
  });

  T.test('a throwing handler does not stop the others and is rethrown later', function () {
    var orig = window.setTimeout;
    var deferred = [];
    window.setTimeout = function (fn) { deferred.push(fn); return 0; };
    var after = false;
    try {
      B.on('d', function () { throw new Error('boom'); });
      B.on('d', function () { after = true; });
      B.emit('d');
    } finally {
      window.setTimeout = orig;
    }
    T.ok(after, 'the next handler still ran');
    T.eq(deferred.length, 1, 'the error was scheduled');
    T.throws(deferred[0], 'and is rethrown on its own task');
  });

  T.test('on refuses a non-function', function () {
    T.throws(function () { B.on('e', null); }, 'throws');
    T.eq(B.count('e'), 0, 'nothing registered');
  });
})();
