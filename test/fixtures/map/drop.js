/* MindRoot - a drag held over a node (tests only).
 *
 * A dragged node let go over another only moves, unless it rested there
 * for a moment first (mapview's DWELL): then it goes into that node, before
 * it or after it. A suite that drops onto a node waits for that moment,
 * the chip under the copy saying so, instead of a guessed time. */
'use strict';

async function decided(page, timeout) {
  await page.waitForFunction(function () {
    var c = document.querySelector('.mv-drop-chip');
    return !c || c.hidden || !/^(Hold still|Fermati)/.test(c.textContent);
  }, null, { timeout: timeout || 4000, polling: 30 });
}

module.exports = { decided: decided };
