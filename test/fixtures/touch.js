/* MindRoot - touch gestures for the e2e suites that are timed by the hand,
 * not by when the test runner manages to deliver them.
 *
 * A double tap sent as two taps "60 ms apart" is only that on an idle
 * machine: every Input.dispatchTouchEvent waits for the page to take the
 * event, so on a loaded runner the second tap can reach the browser 400 ms
 * or more after the first, and the browser stamps each event with the time
 * it got it. The app times double taps by the events' own timestamps (as it
 * should: a busy main thread must not turn a double tap into two taps), so
 * that late second tap is rightly two taps, and the suite flakes.
 *
 * Here every event carries the time the finger was there, on its own
 * clock: the clock starts a little in the past, so no event claims to come
 * from the future (the app ignores such a stamp and takes its own time),
 * and only after a pause longer than that, so it never runs back before the
 * events of the gesture before it. */
'use strict';

var PAST = 0.25;          // s: how far back the gesture's clock starts
var HOLD = 0.03;          // s: a finger down this long is a tap
var BETWEEN = 0.06;       // s: from the first lift to the second touch

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function send(cdp, type, points, at) {
  return cdp.send('Input.dispatchTouchEvent', {
    type: type,
    timestamp: at,
    touchPoints: points.map(function (p) { return { x: p[0], y: p[1], id: p[2] || 1 }; })
  });
}

/* Two taps, at a and then b ([x, y]; b defaults to a), HOLD down each and
 * BETWEEN apart by the events' own clock, whatever the runner's load. */
async function doubleTap(cdp, a, b) {
  b = b || a;
  await sleep(PAST * 1000 + 50);
  var t0 = Date.now() / 1000 - PAST;
  await send(cdp, 'touchStart', [[a[0], a[1], 1]], t0);
  await send(cdp, 'touchEnd', [], t0 + HOLD);
  await send(cdp, 'touchStart', [[b[0], b[1], 1]], t0 + HOLD + BETWEEN);
  await send(cdp, 'touchEnd', [], t0 + HOLD * 2 + BETWEEN);
}

/* A finger from a to b in n moves, one every 16 ms (as a screen reports
 * them) on the hand's clock, lifted at speed 4 ms after the last move.
 * Each event is sent once its time has come and stamped with that time,
 * however late the runner delivers it: a quick stroke stays a quick stroke
 * on any machine (sent unstamped, a stroke is as fast as the runner's
 * load happens to make it). */
var MOVE = 0.016;
async function swipe(cdp, a, b, n, id) {
  id = id || 1;
  await sleep(50);
  var t0 = Date.now() / 1000;
  async function at(t) {
    var wait = (t - Date.now() / 1000) * 1000;
    if (wait > 0) await sleep(wait);
  }
  await send(cdp, 'touchStart', [[a[0], a[1], id]], t0);
  for (var i = 1; i <= n; i++) {
    var t = t0 + i * MOVE;
    await at(t);
    await send(cdp, 'touchMove', [[a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, id]], t);
  }
  var end = t0 + n * MOVE + 0.004;
  await at(end);
  await send(cdp, 'touchEnd', [], end);
}

/* One tap at a ([x, y]), down HOLD by its own clock, starting now: sent
 * at once, with no wait for the page to look still first (page.tap waits
 * for the target to stop moving, which can be longer than the moment that
 * matters right after a gesture). */
async function tap(cdp, a, id) {
  id = id || 1;
  var t0 = Date.now() / 1000;
  await send(cdp, 'touchStart', [[a[0], a[1], id]], t0);
  var wait = (t0 + HOLD - Date.now() / 1000) * 1000;
  if (wait > 0) await sleep(wait);
  await send(cdp, 'touchEnd', [], Math.max(t0 + HOLD, Date.now() / 1000));
}

module.exports = { doubleTap: doubleTap, swipe: swipe, tap: tap, HOLD: HOLD, BETWEEN: BETWEEN, MOVE: MOVE };
