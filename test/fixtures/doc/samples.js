/* MindRoot - sample maps for the doc suites (tests only).
 *
 * Shipped as a script and not as .md files because a page opened from
 * file:// cannot fetch its neighbours. Each one is a real kind of file the
 * model has to read: earlier welcome map, the whole dialect at
 * once, an Obsidian note with front matter, code, a table and paragraphs, a
 * list-only outline, numbered lists, and the trash suite's sample. */
(function () {
  'use strict';

  function join(lines) { return lines.join('\n'); }

  window.DocSamples = {
    welcome: join([
      '# Welcome to MindRoot',
      '',
      '- Projects and maps',
      '  - > text: A project holds several maps, the way a .interneuron folder holds several .md files. The list on the left has them all.',
      '  - New project: the + above the list',
      '  - New map: the menu of a project, or the row under its maps',
      '  - Ctrl+K finds any map, and any command',
      '- Writing on the map',
      '  - Tab adds a child, Enter a sibling',
      '  - F2 or a double tap writes on a node',
      '  - Del sends a branch to the trash',
      '- Nothing is lost',
      '  - Every change can be undone',
      '    - > text: Ctrl+Z and Ctrl+Shift+Z, or the arrows in the bar. Undoing takes you back to the map it happened on.',
      '  - The trash keeps branches, pictures, maps and copies',
      '    - > text: Each one goes back where it was, alone or many at once.',
      '  - A copy of each map is taken every hour',
      '- Files',
      '  - Everything is kept in this browser',
      '  - Export a project as a ZIP of its .interneuron folder, or as JSON',
      '  - Import a .interneuron folder or its ZIP, a JSON, or a loose .md',
      ''
    ]),

    /* Everything the dialect has (docs/FORMAT.md). */
    kitchen: join([
      '<!-- board: assets/kyc.excalidraw.svg | 320,180,640,480 -->',
      '',
      '# Root <!-- color: #aabbcc branch -->',
      '',
      '## WHAT IT DOES <!-- title: h2 --> <!-- color: #c2703d -->',
      '- > text: It is the verification process',
      '  > on two lines',
      '',
      '- ![](assets/a.png) one <!-- title: h2 -->',
      '  - > text: ![](assets/b.png) words <!-- role: caption --> <!-- image: above -->',
      '    > and a second line',
      '  - > note: reminder',
      '  - > edge: depends',
      '  - [ ] ![](assets/f.png) task ![](assets/d.excalidraw.svg) <!-- draw: above --> <!-- color: #2f7d5a -->',
      '1. first',
      '2. second',
      ''
    ]),

    obsidian: join([
      '---',
      'title: Field notes',
      'tags: [a, b]',
      '---',
      'An introduction nobody owns.',
      '',
      '# Field notes',
      '',
      'The root has a paragraph',
      'over two lines.',
      '',
      '## Code',
      '',
      '```js',
      '# not a heading',
      '- not a bullet',
      '',
      'const x = 1;',
      '```',
      '',
      '## Table',
      '',
      '| Name | Value |',
      '| ---- | ----: |',
      '| a    | **1** |',
      '| b    | 2     |',
      '',
      '## Lists',
      '',
      '- one',
      '  continued lazily',
      '- two',
      '',
      '  A paragraph inside two.',
      '',
      '  ```',
      '  code in two',
      '  ```',
      '- three [link](https://example.com) and [[Other map]]',
      '',
      '> A quote under Lists.',
      '',
      '<!-- a comment -->',
      '',
      '### Deeper',
      '',
      '* star item',
      '+ plus item',
      ''
    ]),

    listOnly: join([
      '- alpha',
      '  - a1',
      '  - a2',
      '- beta',
      '  - b1',
      '- gamma',
      ''
    ]),

    ordered: join([
      '# Steps',
      '',
      '1. first',
      '   - detail',
      '2. second',
      '   1. sub one',
      '   2. sub two',
      '3) third',
      '10. tenth',
      ''
    ]),

    trash: join([
      '# Root', '',
      '## Chapter', '', '### Section', '', '- s1', '- s2', '  - s2a', '',
      '## Lists', '',
      '- one', '  - one a', '  - one b',
      '- two <!-- color: #c2703d -->', '  - > text: words below', '  - two a', '- three', '',
      '## Another chapter', '', '1. first', '2. second', '   - [x] done', ''
    ])
  };
})();
