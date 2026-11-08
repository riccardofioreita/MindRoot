/* MindRoot - a deterministic map of any length for the performance checks
 * (tests only): sections with paragraphs, lists three deep, notes, bodies,
 * colours, sizes, pictures, to-dos, numbered items, links, map links, code
 * fences and tables - the mix a big real map has, not 5,000 plain bullets. */
(function () {
  'use strict';

  function bigMap(target) {
    var lines = ['<!-- board: assets/board.ink.svg | 1,2,3,4 -->', '', '# Root <!-- color: #2f7d5a branch -->', ''];
    var s = 0;
    while (lines.length < target) {
      lines.push('## Section ' + s + (s % 3 === 0 ? ' <!-- title: h3 -->' : ''), '');
      lines.push('A paragraph about section ' + s + ' with **bold**, a [link](https://example.com/' + s + ') and `code`.', '');
      for (var i = 0; i < 12 && lines.length < target; i++) {
        lines.push('- Item ' + s + '.' + i + ' with *some* words ![](assets/p' + i + '.png)' + (i % 4 === 0 ? ' <!-- color: #c2703d -->' : ''));
        if (i % 3 === 0) lines.push('  - > text: The body of item ' + i + ' over', '    > two lines with ==marks==');
        if (i % 5 === 0) lines.push('  - > note: a note on ' + i);
        for (var j = 0; j < 3; j++) {
          lines.push('  - [' + (j % 2 ? 'x' : ' ') + '] Child ' + j + ' of ' + i + ' and [[Map ' + j + ']]');
          lines.push('    1. Grandchild ' + j + ' <u>under</u> ~~gone~~');
        }
      }
      lines.push('');
      if (s % 4 === 0) lines.push('```js', 'const x = ' + s + ';', '# not a heading', '```', '');
      if (s % 5 === 0) lines.push('| a | b |', '| - | - |', '| 1 | 2 |', '');
      s++;
    }
    return lines.slice(0, target).join('\n') + '\n';
  }

  window.DocBigMap = bigMap;
})();
