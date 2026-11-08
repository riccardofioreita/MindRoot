/* MindRoot - the inline renderer: what a node's words become as HTML, and
 * why nothing in a .md file can run in the page. Plus the mark buttons'
 * string functions (toggleMark, markState, clearMarks). */
(function () {
  'use strict';

  var doc = window.DocT.doc;
  var html = doc.inlineHtml;

  function repeat(s, n) { return new Array(n + 1).join(s); }

  /* Render into a detached element (never into the document) and look at
   * what the browser actually built from the string. */
  function build(markup) {
    var tpl = document.createElement('template');
    tpl.innerHTML = markup;
    return tpl.content;
  }

  function dangerous(fragment) {
    var bad = [];
    var all = fragment.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var tag = el.tagName.toLowerCase();
      if (['strong', 'em', 'u', 'del', 'mark', 'code', 'a', 'br', 'span'].indexOf(tag) < 0) bad.push('<' + tag + '>');
      for (var k = 0; k < el.attributes.length; k++) {
        var name = el.attributes[k].name;
        var value = el.attributes[k].value;
        if (/^on/i.test(name) || name === 'style' || name === 'src') bad.push(tag + '@' + name);
        if (name === 'href' && /^\s*(javascript|data|vbscript|file):/i.test(value.replace(/[\u0000- ]/g, ''))) bad.push('href=' + value);
      }
    }
    return bad;
  }

  T.test('the whitelist', function () {
    T.eq(html('**b** *i* _i_ <u>u</u> ~~s~~ ==m== `c`'),
      '<strong>b</strong> <em>i</em> <em>i</em> <u>u</u> <del>s</del> <mark>m</mark> <code>c</code>', 'marks');
    T.eq(html('a\nb<br>c<br/>d<BR />e'), 'a<br>b<br>c<br>d<br>e', 'line breaks');
    T.eq(html('[site](https://example.com "Title")'),
      '<a class="md-link" href="https://example.com" title="Title" target="_blank" rel="noopener noreferrer">site</a>', 'a link');
    T.eq(html('[[Other map]] and [[Map|shown]]'),
      '<a class="md-map" href="#" data-map="Other map">Other map</a> and <a class="md-map" href="#" data-map="Map">shown</a>', 'map links');
    T.eq(html('[m](mailto:a@b.c) [r](other.md) [h](#top)'),
      '<a class="md-link" href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">m</a> ' +
      '<a class="md-link" href="other.md" target="_blank" rel="noopener noreferrer">r</a> ' +
      '<a class="md-link" href="#top" target="_blank" rel="noopener noreferrer">h</a>', 'mailto and relative links');
    T.eq(html('see https://example.com/a_b_c.'), 'see <a class="md-link" href="https://example.com/a_b_c" target="_blank" rel="noopener noreferrer">https://example.com/a_b_c</a>.', 'a bare address, without the full stop');
    T.eq(html('<https://example.com>'), '<a class="md-link" href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>', 'an autolink');
    T.eq(html('**[bold link](https://a.b)**'), '<strong><a class="md-link" href="https://a.b" target="_blank" rel="noopener noreferrer">bold link</a></strong>', 'a link inside a mark');
    T.eq(html('[*it* **b**](https://a.b)'), '<a class="md-link" href="https://a.b" target="_blank" rel="noopener noreferrer"><em>it</em> <strong>b</strong></a>', 'marks inside a link');
  });

  T.test('CommonMark emphasis', function () {
    T.eq(html('***x***'), '<em><strong>x</strong></em>', '***x***');
    T.eq(html('snake_case_name'), 'snake_case_name', 'underscores inside words are letters');
    T.eq(html('2*3*4'), '2<em>3</em>4', 'stars inside words are marks');
    T.eq(html('**bold'), '**bold', 'an unclosed mark is text');
    T.eq(html('*a **b** c*'), '<em>a <strong>b</strong> c</em>', 'nesting');
    T.eq(html('**a *b** c*'), '<em><em>a <em>b</em></em> c</em>', 'crossing runs pair the CommonMark way, never crossing tags');
    T.eq(html('* not a list'), '* not a list', 'a lone star');
    T.eq(html('~single~ ~~~triple~~~'), '~single~ ~~~triple~~~', 'only ~~ strikes');
    T.eq(html('a = b == c'), 'a = b == c', 'equals signs that mark nothing');
    T.eq(html('<u>open'), '&lt;u&gt;open', 'an unclosed <u> is text');
    T.eq(html('</u>close'), '&lt;/u&gt;close', 'and so is a stray </u>');
    T.eq(html('<u>a **b</u> c**'), '<u>a **b</u> c**', 'a mark cannot cross <u>');
    T.eq(html('\\*not\\* \\_em\\_'), '*not* _em_', 'backslash escapes');
    T.eq(html('`**not bold**` and ``a ` b``'), '<code>**not bold**</code> and <code>a ` b</code>', 'code spans are literal');
    T.eq(html('a &amp; b &lt; &copy; &#169; &#x41; &bogus; &constructor;'), 'a &amp; b &lt; © © A &amp;bogus; &amp;constructor;', 'entities');
  });

  T.test('nothing runs', function () {
    var attacks = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x](java\tscript:alert(1))',
      '[x]( javascript:alert(1))',
      '[x](&#106;avascript:alert(1))',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](vbscript:msgbox)',
      '[x](file:///etc/passwd)',
      '<javascript:alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '[x](https://a.b" onmouseover="alert(1))',
      '[[x" onclick="alert(1)]]',
      '![x](y" onerror="alert(1))',
      '<u onclick=alert(1)>x</u>',
      '<b style="background:url(javascript:alert(1))">x</b>',
      '<!-- x --><script>alert(1)</script>',
      '`<script>` <style>body{}</style>',
      '"><script>alert(1)</script>',
      '<<script>alert(1)//<</script>'
    ];
    attacks.forEach(function (a) {
      var out = html(a);
      T.same(dangerous(build(out)), [], a);
      T.ok(!/<script|<img|<iframe|<svg|<style|<b[\s>]/i.test(out), 'no raw tag from ' + a);
    });
    T.eq(html('[x](javascript:alert(1))'), 'x', 'a refused link keeps its words');
    T.eq(html('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;', 'other HTML shows as text');
    T.eq(html('<img src="assets/a.png" alt="the cat">'), 'the cat', 'a picture in the words is its alt text');
    T.eq(html('![alt **text**](assets/a.png)'), 'alt text', 'markdown pictures too, never an <img>');
    T.same(doc.linksOf(doc.parse('# [x](javascript:alert(1)) [y](https://ok.org)\n'), ''), [{ href: 'https://ok.org', text: 'y', kind: 'url' }], 'refused links are not links');
  });

  T.test('hostile input stays fast', function () {
    var cases = [
      repeat('*', 20000), repeat('_a', 10000), repeat('**a ', 5000), repeat('[', 10000) + repeat(']', 10000),
      repeat('[a](', 5000), repeat('![', 10000), repeat('`', 9999), repeat('``a', 5000), repeat('<u>', 5000),
      repeat('[[', 10000), repeat('&#', 10000), repeat('*a_', 10000), repeat('~~', 10000), repeat('<!--', 5000),
      repeat('***x***', 3000), repeat('https://a.b/(', 2000), repeat('\\', 20001), repeat('<img ', 4000)
    ];
    cases.forEach(function (c, i) {
      var t0 = performance.now();
      var out = html(c);
      var text = doc.inlineText(c);
      var ms = performance.now() - t0;
      T.ok(typeof out === 'string' && typeof text === 'string' && ms < 400, 'case ' + i + ' in ' + Math.round(ms) + ' ms');
    });
  });

  T.test('inlineText: plain words', function () {
    T.eq(doc.inlineText('**b** _i_ [link](https://a.b) [[Map|shown]] `c` <u>u</u> <!-- hidden -->'), 'b i link shown c u ', 'marks gone');
    T.eq(doc.inlineText('a\\*b &amp; c'), 'a*b & c', 'escapes and entities decoded');
    T.eq(doc.inlineText('<img src="x.png" alt="pic">'), 'pic', 'a picture is its alt text');
  });

  T.test('toggleMark and markState (the format bar)', function () {
    function sel(text, a, b, name) {
      var r = doc.toggleMark(text, a, b, name);
      return r.text + ' [' + r.text.slice(r.start, r.end) + ']';
    }
    T.eq(sel('a word here', 2, 6, 'bold'), 'a **word** here [word]', 'bold on');
    T.eq(sel('a **word** here', 0, 15, 'bold'), '**a **word** here** [a **word** here]', 'a choice wider than the marks wraps it');
    T.eq(sel('a **word** here', 2, 10, 'bold'), 'a word here [word]', 'a choice that includes the stars');
    T.eq(sel('***x***', 3, 4, 'bold'), '*x* [x]', 'bold off keeps italic');
    T.eq(sel('***x***', 3, 4, 'italic'), '**x** [x]', 'italic off keeps bold');
    T.eq(sel('x', 5, -3, 'italic'), '*x* [x]', 'offsets are clamped and ordered');
    T.same(doc.markState('a **b** c', 4, 5), { bold: true, italic: false, underline: false }, 'bold lit');
    T.same(doc.markState('a *b* c', 3, 4), { bold: false, italic: true, underline: false }, 'italic lit');
    T.same(doc.markState('plain', 0, 5), { bold: false, italic: false, underline: false }, 'nothing lit');
  });

  T.test('clearMarks takes pairs off, not letters (bug fixed)', function () {
    function clear(text, a, b) {
      var r = doc.clearMarks(text, a, b);
      return r.text + ' [' + r.text.slice(r.start, r.end) + ']';
    }
    /* The previous clearMarks deleted every * and _ in the choice. */
    T.eq(clear('snake_case_name', 0, 15), 'snake_case_name [snake_case_name]', 'underscores in words stay');
    T.eq(clear('a **bold** b', 4, 8), 'a bold b [bold]', 'the word inside the marks');
    T.eq(clear('a **bold** b', 2, 10), 'a bold b [bold]', 'the word with its marks');
    T.eq(clear('***x***', 3, 4), 'x [x]', 'bold and italic together');
    T.eq(clear('<u>under</u> ~~gone~~ ==hi==', 0, 27), 'under gone hi [under gone hi]', 'underline, strike, highlight');
    T.eq(clear('**a** b **c**', 6, 7), '**a** b **c** [b]', 'plain text between marks is left alone');
    T.eq(clear('x **bold** y', 5, 5), 'x bold y [bold]', 'a caret inside a mark clears it and selects the words');
    T.eq(clear('2 * 3 * 4', 0, 9), '2 * 3 * 4 [2 * 3 * 4]', 'a lone star is not a mark');
    T.eq(clear('[**l**](https://a.b)', 0, 20), '[l](https://a.b) [[l](https://a.b)]', 'marks inside a link');
  });
})();
