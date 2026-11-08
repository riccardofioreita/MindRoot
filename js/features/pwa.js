/* MindRoot - the installable web app, over http(s) only.
 *
 * From file:// none of this applies: a page opened from disk cannot have a
 * service worker, and a <link rel="manifest"> there only produces console
 * errors. So the manifest link is injected from here, and only on http(s);
 * index.html carries none.
 *
 * Over http(s): the service worker (sw.js, cache-first) is registered after
 * the page has loaded, so it never competes with the first paint. When a new
 * version takes over an open page, a banner offers to reload: the page keeps
 * the old code in memory until then (reloading by itself could cost an edit
 * in progress), and a banner, unlike a toast, stays until it is answered,
 * whatever toasts come after it. After the first real change to the
 * workspace, persistent storage is requested, so the browser does not evict
 * the maps under disk pressure. An install command appears when the browser
 * offers one, and files opened with the installed app (file_handlers) arrive
 * on the bus as 'launch' {files}. */

window.MindRoot = window.MindRoot || {};
(function (ns) {
  'use strict';

  var started = false;
  var installEvent = null;
  var registration = null;
  var persistAsked = false;

  function t(key, vars) { return ns.i18n.t(key, vars); }

  ns.i18n.add({
    en: {
      'pwa.update': 'A new version of MindRoot is ready.',
      'pwa.reload': 'Reload',
      'pwa.install': 'Install MindRoot',
      'pwa.kw.install': 'install app home screen desktop offline'
    },
    it: {
      'pwa.update': 'È pronta una nuova versione di MindRoot.',
      'pwa.reload': 'Ricarica',
      'pwa.install': 'Installa MindRoot',
      'pwa.kw.install': 'installa app schermata home desktop offline'
    }
  });

  function isHttp() { return /^https?:$/.test(location.protocol); }

  function injectManifest() {
    if (document.querySelector('link[rel="manifest"]')) return;
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }

  function reload() { location.reload(); }

  function announceUpdate() {
    if (!ns.ui) return;
    ns.ui.banner('pwa-update', {
      kind: 'info',
      icon: 'reload',
      text: t('pwa.update'),
      actions: [{ label: t('pwa.reload'), kind: 'primary', run: reload }]
    });
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    /* The first install also takes control of the page (clients.claim):
     * that is not news. Only a controller replacing another one is. */
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      announceUpdate();
    });
    return navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      registration = reg;
      return reg;
    }, function (err) {
      if (window.console) console.warn('MindRoot: the service worker did not register', err);
      return null;
    });
  }

  /* Store changes that are not the person editing: loading, moving between
   * maps, history bookkeeping, the clock's copies. */
  var NOT_EDITS = { init: 1, load: 1, ui: 1, 'history:changed': 1, snapshot: 1 };

  /* After the first change that is the person's own, ask the browser to
   * keep the data. Not during boot (the first-run sample map is seeded
   * then) and not before the person has touched the page at all: Firefox
   * answers persist() with a permission prompt, which has to follow
   * something they did. Called with every store change; asks once. */
  function onStoreChange(change) {
    var type = change && change.type;
    if (persistAsked || !ns.booted || !type || NOT_EDITS[type]) return false;
    var activation = navigator.userActivation;
    if (activation && !activation.hasBeenActive) return false;
    persistAsked = true;
    requestPersist();
    return true;
  }

  function requestPersist() {
    if (ns.storage && typeof ns.storage.persist === 'function') {
      try {
        var p = ns.storage.persist();
        if (p && typeof p.catch === 'function') p.catch(function () { /* refused: the settings sheet shows it */ });
      } catch (err) { /* nothing to do */ }
    }
  }

  function installSupport() {
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      installEvent = event;
      if (ns.shell) ns.shell.refresh();
    });
    window.addEventListener('appinstalled', function () {
      installEvent = null;
      requestPersist();
      if (ns.shell) ns.shell.refresh();
    });
    if (ns.commands) {
      ns.commands.register({
        id: 'app.install',
        label: 'pwa.install',
        group: 'app',
        icon: 'download',
        keywords: t('pwa.kw.install'),
        when: function () { return !!installEvent; },
        run: function () {
          var event = installEvent;
          installEvent = null;
          if (!event) return false;
          event.prompt();
          return event.userChoice.then(function () { if (ns.shell) ns.shell.refresh(); });
        }
      });
    }
  }

  function launchFiles() {
    if (!('launchQueue' in window) || !window.launchQueue || typeof window.launchQueue.setConsumer !== 'function') return;
    window.launchQueue.setConsumer(function (params) {
      if (!params || !params.files || !params.files.length) return;
      Promise.all(params.files.map(function (handle) { return handle.getFile(); })).then(function (files) {
        return (ns.ready || Promise.resolve()).then(function () {
          if (ns.bus) ns.bus.emit('launch', { files: files });
        });
      }).catch(function (err) { if (window.console) console.warn('MindRoot: could not read the opened files', err); });
    });
  }

  function init() {
    if (started) return;
    started = true;
    if (!isHttp()) return;
    injectManifest();
    if (ns.bus) ns.bus.on('store', onStoreChange);
    installSupport();
    launchFiles();
    if (document.readyState === 'complete') registerWorker();
    else window.addEventListener('load', registerWorker, { once: true });
  }

  ns.pwa = {
    init: init,
    isHttp: isHttp,
    onStoreChange: onStoreChange,
    announceUpdate: announceUpdate,
    canInstall: function canInstall() { return !!installEvent; },
    registration: function getRegistration() { return registration; }
  };
})(window.MindRoot);
