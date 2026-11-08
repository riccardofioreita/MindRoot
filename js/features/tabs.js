/* MindRoot - one tab at a time.
 *
 * Every tab of the same database reads the same projects, and each project
 * is written as a whole record: two tabs editing at once would overwrite
 * each other's work, the last one to save winning. So one tab holds the
 * data and the others only show it. The first tab to open is the one that
 * holds it; a second tab of the same database is read-only (the store
 * accepts no change, storage writes nothing), says so in a banner, and
 * offers "Use here": the other tab is asked to let go - it saves what it has,
 * becomes read-only itself and says so - and this one reloads, to start from
 * what was just saved rather than from what it read minutes ago. Modules
 * holding edits the store has not seen yet hear the bus event 'tabs:yield'
 * ({ to, waitUntil(promise) }) and hand them over first; an asynchronous
 * hand-over (a drawing's bytes being stored) passes its promise to
 * waitUntil and is waited for, up to HANDOVER_WAIT.
 *
 * Who holds the data is a Web Lock named 'mindroot2:<database>' (held for
 * the life of the tab, released by the browser when the tab goes away, so a
 * crashed tab never keeps it). Where Web Locks are missing, the tabs agree
 * over the BroadcastChannel 'mindroot2' instead: a new tab says hello, the
 * tab holding the data answers, and two tabs starting at the same moment
 * settle it by who started first. Both work on file:// in Chromium. A page
 * whose storage is only in memory (private window) shares nothing with
 * other tabs and is never read-only. */
window.MindRoot = window.MindRoot || {};

(function (ns) {
  'use strict';

  var CHANNEL = 'mindroot2';
  var HELLO_WAIT = 300;
  /* How long a tab letting go waits for modules still handing edits over
   * (a drawing being written), and - longer, since the letting go also
   * writes - how long the tab asking waits before taking the lock anyway. */
  var HANDOVER_WAIT = 2500;
  var YIELD_WAIT = 5000;

  var STRINGS = {
    en: {
      'tabs.busy': 'MindRoot is open in another tab, which keeps your maps. This one shows them without saving any change.',
      'tabs.yielded': 'You are now working in another tab. This one shows your maps without saving any change.',
      'tabs.closed': 'The tab that kept your maps was closed. Use this one to keep working.',
      'tabs.taking': 'Asking the other tab to let go of your maps',
      'tabs.useHere': 'Use here',
      'tabs.cmd.useHere': 'Use MindRoot in this tab',
      'tabs.kw.useHere': 'tab read-only other window edit take over'
    },
    it: {
      'tabs.busy': "MindRoot è aperto in un'altra scheda, che conserva le tue mappe. Questa le mostra senza salvare nessuna modifica.",
      'tabs.yielded': "Ora stai lavorando in un'altra scheda. Questa mostra le tue mappe senza salvare nessuna modifica.",
      'tabs.closed': 'La scheda che conservava le tue mappe è stata chiusa. Usa questa per continuare a lavorare.',
      'tabs.taking': "Chiedo all'altra scheda di lasciare le tue mappe",
      'tabs.useHere': 'Usa qui',
      'tabs.cmd.useHere': 'Usa MindRoot in questa scheda',
      'tabs.kw.useHere': 'scheda sola lettura altra finestra modifica prendi'
    }
  };
  if (ns.i18n && typeof ns.i18n.add === 'function') ns.i18n.add(STRINGS);

  function t(key, vars) {
    return ns.i18n && typeof ns.i18n.t === 'function' ? ns.i18n.t(key, vars) : (STRINGS.en[key] || key);
  }

  var me = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), at: Date.now() };
  var mode = 'none';
  var readOnly = false;
  var reason = null;
  var channel = null;
  var releaseLock = null;
  var starting = null;
  var decided = false;
  var deciding = null;
  var waiting = [];
  var taking = false;
  var yielding = false;
  var TEXTS = { busy: 'tabs.busy', yielded: 'tabs.yielded', closed: 'tabs.closed' };

  function dbName() {
    return ns.storage && typeof ns.storage.databaseName === 'function' ? ns.storage.databaseName() : 'mindroot2';
  }

  function lockName() { return 'mindroot2:' + dbName(); }

  function locks() {
    try {
      return navigator.locks && typeof navigator.locks.request === 'function' ? navigator.locks : null;
    } catch (err) {
      return null;
    }
  }

  function post(msg) {
    if (!channel) return;
    msg.app = 'mindroot2';
    msg.db = dbName();
    msg.from = me.id;
    msg.at = me.at;
    try { channel.postMessage(msg); } catch (err) { /* the channel closed with the page */ }
  }

  /* Who started first wins a tie between two tabs that both think they
   * hold the data (channel mode only: a lock cannot be held twice). */
  function older(a, b) { return a.at < b.at || (a.at === b.at && a.from < b.from); }

  /* ---------- the state, and everyone who needs to know it ---------- */

  function showBanner() {
    if (!ns.ui || typeof ns.ui.banner !== 'function') return;
    if (taking) {
      ns.ui.banner('tabs', { kind: 'info', text: t('tabs.taking'), actions: [], dismissable: false });
      return;
    }
    ns.ui.banner('tabs', {
      kind: 'warning',
      icon: 'lock',
      text: t(TEXTS[reason] || TEXTS.busy),
      actions: [{ label: t('tabs.useHere'), kind: 'primary', run: useHere }]
    });
  }

  function setReadOnly(flag, why) {
    readOnly = !!flag;
    reason = readOnly ? why || 'busy' : null;
    if (ns.storage && typeof ns.storage.setReadOnly === 'function') ns.storage.setReadOnly(readOnly);
    if (ns.store && typeof ns.store.setReadOnly === 'function') ns.store.setReadOnly(readOnly);
    if (readOnly) showBanner();
    else if (ns.ui && typeof ns.ui.clearBanner === 'function') ns.ui.clearBanner('tabs');
    if (ns.bus) ns.bus.emit('tabs', { readOnly: readOnly, reason: reason, mode: mode });
  }

  /* ---------- Web Locks ---------- */

  /* Resolves true once the lock is held (until releaseLock() or until
   * another tab steals it), false when it could not be had. */
  function holdLock(options) {
    return new Promise(function (resolve) {
      var granted = false;
      var request;
      try {
        request = locks().request(lockName(), options || {}, function (lock) {
          if (!lock) { resolve(false); return undefined; }
          granted = true;
          resolve(true);
          return new Promise(function (release) { releaseLock = release; });
        });
      } catch (err) {
        resolve(false);
        return;
      }
      request.then(function () { /* let go of on purpose */ }, function () {
        if (!granted) { resolve(false); return; }
        /* Stolen: another tab took over without waiting for an answer. */
        releaseLock = null;
        if (!readOnly) setReadOnly(true, 'yielded');
      });
    });
  }

  function holdLockWithin(ms) {
    if (typeof AbortController !== 'function') return holdLock({});
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return holdLock({ signal: controller.signal }).then(function (got) {
      clearTimeout(timer);
      return got;
    });
  }

  function letGo() {
    var release = releaseLock;
    releaseLock = null;
    if (release) release();
  }

  /* ---------- BroadcastChannel ---------- */

  function askAround() {
    return new Promise(function (resolve) {
      deciding = { answered: false, rivals: [] };
      post({ type: 'hello' });
      setTimeout(function () {
        var d = deciding;
        deciding = null;
        if (d.answered) { resolve(false); return; }
        var mine = { at: me.at, from: me.id };
        resolve(!d.rivals.some(function (r) { return older(r, mine); }));
      }, HELLO_WAIT);
    });
  }

  function settle(answer) {
    var list = waiting;
    waiting = [];
    list.forEach(function (fn) { fn(answer); });
  }

  function waitForAnswer(ms) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        resolve(value);
      }
      waiting.push(finish);
      setTimeout(function () { finish(false); }, ms);
    });
  }

  function onMessage(event) {
    var msg = event && event.data;
    if (!msg || msg.app !== 'mindroot2' || msg.db !== dbName() || msg.from === me.id) return;
    if (msg.type === 'yield') {
      if (decided && !readOnly) yieldTo(msg.from);
    } else if (msg.type === 'yielded') {
      if (msg.to === me.id) settle(true);
    } else if (msg.type === 'bye') {
      /* The tab holding the data closed: the way is free (the banner says
       * so; the data here may be older than what it saved, so this tab
       * still reloads before writing). */
      settle(true);
      if (readOnly && !taking) { reason = 'closed'; showBanner(); }
    } else if (mode === 'channel') {
      if (msg.type === 'hello') {
        if (deciding) deciding.rivals.push({ at: msg.at, from: msg.from });
        else if (decided && !readOnly) post({ type: 'here', to: msg.from });
      } else if (msg.type === 'here') {
        if (deciding) deciding.answered = true;
        else if (decided && !readOnly && older({ at: msg.at, from: msg.from }, { at: me.at, from: me.id })) yieldTo(null, 'busy');
      }
    }
  }

  /* ---------- letting go, and taking over ---------- */

  /* Another tab asked. Modules holding edits not yet in the store (a
   * debounced Markdown panel, a drawing being made) hear 'tabs:yield' and
   * hand them over. Handing over may take a moment - a drawing's bytes are
   * hashed and written before the store learns its path - so the event
   * carries waitUntil(promise): the store keeps taking changes until every
   * promise given has settled, or HANDOVER_WAIT has passed. Then the store
   * stops taking changes, so nothing typed afterwards can slip in after the
   * last write; then everything pending is written, storage stops writing,
   * and the lock goes. */
  function handOver(requester) {
    var waits = [];
    var detail = {
      to: requester || null,
      waitUntil: function waitUntil(promise) { waits.push(Promise.resolve(promise)); }
    };
    if (ns.bus) ns.bus.emit('tabs:yield', detail);
    if (!waits.length) return Promise.resolve();
    var all = Promise.all(waits.map(function (w) { return w.catch(function () { /* handed over what it could */ }); }));
    return Promise.race([all, new Promise(function (resolve) { setTimeout(resolve, HANDOVER_WAIT); })]);
  }

  async function yieldTo(requester, why) {
    if (readOnly || yielding) return;
    yielding = true;
    try {
      await handOver(requester);
      if (ns.store && typeof ns.store.setReadOnly === 'function') ns.store.setReadOnly(true);
      try { if (ns.storage && typeof ns.storage.flush === 'function') await ns.storage.flush(); } catch (err) { /* saved what could be */ }
      setReadOnly(true, why || 'yielded');
      letGo();
      if (requester) post({ type: 'yielded', to: requester });
    } finally {
      yielding = false;
    }
  }

  function reload() { window.location.reload(); }

  /* "Use here": the tab holding the data is asked to save and let go; if it
   * does not answer in a few seconds (frozen in the background), the lock is
   * taken anyway. Then this tab reloads, and opens holding the data. */
  async function useHere() {
    if (!readOnly || taking) return false;
    taking = true;
    showBanner();
    post({ type: 'yield' });
    if (mode === 'locks') {
      var got = await holdLockWithin(YIELD_WAIT);
      if (!got) got = await holdLock({ steal: true });
      letGo();
    } else if (mode === 'channel') {
      await waitForAnswer(YIELD_WAIT);
    }
    ns.tabs.reload();
    return true;
  }

  /* ---------- start ---------- */

  function registerCommand() {
    if (!ns.commands || typeof ns.commands.register !== 'function') return;
    ns.commands.register({
      id: 'tabs.useHere',
      label: 'tabs.cmd.useHere',
      group: 'app',
      icon: 'lock',
      keywords: t('tabs.kw.useHere'),
      when: function () { return readOnly; },
      run: function () { return useHere(); },
      showInHelp: false
    });
  }

  async function start() {
    registerCommand();
    try {
      if (typeof BroadcastChannel === 'function') {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = onMessage;
      }
    } catch (err) {
      channel = null;
    }
    window.addEventListener('pagehide', function () { if (decided && !readOnly && mode !== 'none') post({ type: 'bye' }); });
    var memoryOnly = ns.storage && typeof ns.storage.available === 'function' && !ns.storage.available();
    if (memoryOnly) {
      mode = 'none';
    } else if (locks()) {
      mode = 'locks';
      if (!(await holdLock({ ifAvailable: true }))) readOnly = true;
    } else if (channel) {
      mode = 'channel';
      if (!(await askAround())) readOnly = true;
    }
    decided = true;
    setReadOnly(readOnly, 'busy');
    if (!readOnly && mode === 'channel') post({ type: 'here' });
    return state();
  }

  /* Decides once whether this tab holds the data; app.js awaits it before
   * anything opens a map. */
  function init() {
    if (!starting) starting = start();
    return starting;
  }

  function state() { return { readOnly: readOnly, reason: reason, mode: mode }; }

  ns.tabs = {
    init: init,
    readOnly: function isReadOnly() { return readOnly; },
    state: state,
    mode: function currentMode() { return mode; },
    useHere: useHere,
    reload: reload,
    HANDOVER_WAIT: HANDOVER_WAIT
  };
})(window.MindRoot);
