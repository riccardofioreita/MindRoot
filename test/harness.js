/* MindRoot - the in-page test harness.
 *
 * A unit suite is an ordinary page (test/unit/<name>.html) that loads the
 * app scripts it needs, this file, and its own <name>.test.js. It opens by
 * double-click as well as from test/run.js, and it writes its answer into
 * <pre id="out">: the verdict on the first line, then one line per check.
 *
 *   GREEN 42            every check passed (42 of them)
 *   RED 3 of 42         three checks failed
 *   CRASH <message>     the page itself broke before it could finish
 *
 * test/run.js reads the first line and nothing else, so a suite that never
 * reaches T.done() - a hung promise - is reported as a timeout, never green.
 *
 *   T.test('name', function () { ... })        sync or async (return a promise)
 *   T.eq(actual, expected, 'what')             strict equality
 *   T.same(actual, expected, 'what')           equal as JSON
 *   T.ok(value, 'what')                        truthy
 *   T.throws(fn, 'what')                       fn must throw
 *   T.run()                                    runs every test in order
 */

(function () {
  'use strict';

  var tests = [];
  var lines = [];
  var checks = 0;
  var failures = 0;
  var finished = false;
  var current = '';

  function show(value) {
    if (value === undefined) return 'undefined';
    try { return JSON.stringify(value); } catch (err) { return String(value); }
  }

  function paint(head) {
    var out = document.getElementById('out');
    if (!out) {
      out = document.createElement('pre');
      out.id = 'out';
      document.body.appendChild(out);
    }
    out.textContent = [head].concat(lines).join('\n');
  }

  function record(pass, what, expected, actual, detail) {
    checks++;
    var name = current + (what ? ' :: ' + what : '');
    if (pass) {
      lines.push('PASS  ' + name);
    } else {
      failures++;
      lines.push('FAIL  ' + name);
      if (detail !== undefined) lines.push('        ' + detail);
      else {
        lines.push('        expected: ' + show(expected));
        lines.push('        actual  : ' + show(actual));
      }
    }
  }

  function eq(actual, expected, what) { record(actual === expected, what, expected, actual); }
  function same(actual, expected, what) { record(show(actual) === show(expected), what, expected, actual); }
  function ok(value, what) { record(!!value, what, true, value); }
  function throws(fn, what) {
    var threw = false;
    try { fn(); } catch (err) { threw = true; }
    record(threw, what, 'a throw', 'no throw');
  }

  function crash(err) {
    if (finished) return;
    finished = true;
    paint('CRASH ' + (err && (err.stack || err.message) || err));
  }

  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* Waits for a condition rather than a fixed time: a suite that sleeps a
   * guessed number of milliseconds is slow when the guess is long and flaky
   * when it is short. */
  function until(cond, timeout, what) {
    var limit = Date.now() + (timeout || 4000);
    return new Promise(function (resolve, reject) {
      (function poll() {
        var value;
        try { value = cond(); } catch (err) { value = false; }
        if (value) return resolve(value);
        if (Date.now() > limit) return reject(new Error('timed out waiting for ' + (what || 'a condition')));
        setTimeout(poll, 16);
      })();
    });
  }

  function run() {
    paint('RUNNING');
    var i = 0;
    (function next() {
      if (finished) return;
      if (i >= tests.length) {
        finished = true;
        if (!checks) return paint('CRASH no checks ran');
        return paint(failures ? 'RED ' + failures + ' of ' + checks : 'GREEN ' + checks);
      }
      var t = tests[i++];
      current = t.name;
      var result;
      try { result = t.fn(); } catch (err) {
        record(false, 'threw', null, null, String(err && (err.stack || err)));
        return next();
      }
      Promise.resolve(result).then(next, function (err) {
        record(false, 'rejected', null, null, String(err && (err.stack || err)));
        next();
      });
    })();
  }

  window.addEventListener('error', function (event) { crash(event.error || event.message); });
  window.addEventListener('unhandledrejection', function (event) { crash(event.reason); });

  window.T = {
    test: test, eq: eq, same: same, ok: ok, throws: throws,
    sleep: sleep, until: until, run: run, crash: crash
  };
})();
