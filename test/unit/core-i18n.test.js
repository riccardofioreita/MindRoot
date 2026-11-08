/* core-i18n: lookup and fallback, placeholders, plurals, language choice,
 * persistence, the 'lang' event and static markup translation. */
(function () {
  'use strict';
  var ns = window.MindRoot;
  var I = ns.i18n;

  I.add({
    en: { 'x.hello': 'Hello, {name}', 'x.only': 'Only English', 'x.maps.one': '{n} map', 'x.maps.other': '{n} maps', 'x.items.zero': 'Nothing', 'x.items.one': 'One item', 'x.items.other': '{n} items' },
    it: { 'x.hello': 'Ciao, {name}', 'x.maps.one': '{n} mappa', 'x.maps.other': '{n} mappe' }
  });

  T.test('init picks the explicit language, else prefs, else English', function () {
    T.eq(I.init('it-IT'), 'it', 'it-IT -> it');
    T.eq(document.documentElement.lang, 'it', 'html lang');
    T.eq(I.init('en-GB'), 'en', 'en-GB -> en');
    T.eq(I.init('fr'), I.init(), 'unknown explicit falls through to the defaults');
    ns.prefs.set('lang', 'it');
    T.eq(I.init(), 'it', 'prefs when no explicit or query language');
    ns.prefs.set('lang', null);
    T.eq(I.init(), 'en', 'English otherwise, whatever the browser says');
  });

  T.test('t: current language, then English, then the key', function () {
    I.init('it');
    T.eq(I.t('x.hello', { name: 'Ada' }), 'Ciao, Ada', 'italian with a placeholder');
    T.eq(I.t('x.only'), 'Only English', 'falls back to English');
    T.eq(I.t('x.nope'), 'x.nope', 'missing key gives the key');
    T.eq(I.t('x.hello', {}), 'Ciao, {name}', 'unknown placeholders stay visible');
    T.eq(I.t('x.hello', { name: '<b>' }), 'Ciao, <b>', 'no escaping here: callers put it in textContent');
    I.init('en');
    T.eq(I.t('x.hello', { name: 'Ada' }), 'Hello, Ada', 'english');
    T.ok(I.has('x.only') && !I.has('x.nope'), 'has');
  });

  T.test('plural with Intl.PluralRules and formatted counts', function () {
    I.init('en');
    T.eq(I.plural('x.maps', 1), '1 map', 'one');
    T.eq(I.plural('x.maps', 2), '2 maps', 'other');
    T.eq(I.plural('x.maps', 1284), '1,284 maps', 'english grouping');
    T.eq(I.plural('x.items', 0), 'Nothing', 'zero form when the module wrote one');
    T.eq(I.plural('x.maps', 0), '0 maps', 'other for zero otherwise');
    I.init('it');
    T.eq(I.plural('x.maps', 1), '1 mappa', 'italian one');
    T.eq(I.plural('x.maps', 1284), '1284 mappe'.replace('1284', I.number(1284)), 'italian grouping');
    /* Whether a four-digit number is grouped is the browser's data (CLDR's minimum grouping digits), not ours:
     * it is whatever Intl says; from five digits the dot is certain. */
    T.eq(I.number(1284), new Intl.NumberFormat('it').format(1284), 'italian numbers are the browser\'s own');
    T.eq(I.number(12840), '12.840', 'italian thousands separator');
    I.init('en');
  });

  T.test('setLang persists, emits once and retranslates markup', function () {
    I.init('en');
    var events = [];
    var off = ns.bus.on('lang', function (d) { events.push(d.value); });
    var host = document.createElement('div');
    host.innerHTML = '<span data-i18n="x.maps.one"></span><button data-i18n-aria-label="x.only" data-i18n-title="x.only"></button><input data-i18n-placeholder="x.only">';
    document.body.appendChild(host);
    I.setLang('it');
    T.eq(I.lang(), 'it', 'switched');
    T.eq(ns.prefs.get('lang'), 'it', 'persisted');
    T.same(events, ['it'], 'one lang event');
    T.eq(host.querySelector('span').textContent, '{n} mappa', 'data-i18n text');
    T.eq(host.querySelector('button').getAttribute('aria-label'), 'Only English', 'aria-label');
    T.eq(host.querySelector('button').getAttribute('title'), 'Only English', 'title');
    T.eq(host.querySelector('input').getAttribute('placeholder'), 'Only English', 'placeholder');
    I.setLang('it');
    T.eq(events.length, 1, 'no event when nothing changed');
    I.setLang('xx');
    T.eq(I.lang(), 'it', 'unknown language ignored');
    I.setLang('en');
    off();
    host.remove();
    ns.prefs.set('lang', null);
  });

  T.test('list', function () {
    I.init('en');
    T.eq(I.list(['a', 'b', 'c']), 'a, b, and c', 'english');
    I.init('it');
    T.eq(I.list(['a', 'b', 'c']), 'a, b e c', 'italian');
    I.init('en');
  });

})();
