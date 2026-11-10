#!/usr/bin/env node
/* MindRoot - install the `mindroot` skill for an AI coding agent: the skill
 * that turns a codebase or a file into MindRoot maps.
 *
 *     node tools/skill.js             into ~/.claude/skills/mindroot (every project of yours)
 *     node tools/skill.js <dir>       into <dir>, e.g. another/project/.claude/skills/mindroot
 *     node tools/skill.js --list      prints what would be copied
 *
 * The skill lives in .claude/skills/mindroot/ of this repository, where an
 * agent working here finds it as it is. Somewhere else it needs MindRoot's
 * parser beside its validator, so this copies three files: SKILL.md,
 * validate.js and js/model/doc.js (as doc.js). Run it again after an update
 * of MindRoot: the files are written over. Node built-ins only. */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var FILES = [
  ['.claude/skills/mindroot/SKILL.md', 'SKILL.md'],
  ['.claude/skills/mindroot/validate.js', 'validate.js'],
  ['js/model/doc.js', 'doc.js']
];

function install(dest) {
  fs.mkdirSync(dest, { recursive: true });
  return FILES.map(function (pair) {
    fs.copyFileSync(path.join(ROOT, pair[0]), path.join(dest, pair[1]));
    return pair[1];
  });
}

module.exports = { install: install, FILES: FILES };

if (require.main === module) {
  var arg = process.argv[2];
  if (arg === '--list') {
    console.log(FILES.map(function (pair) { return pair[0] + ' -> ' + pair[1]; }).join('\n'));
  } else {
    var dest = path.resolve(arg || path.join(os.homedir(), '.claude', 'skills', 'mindroot'));
    install(dest);
    console.log('The mindroot skill is in ' + dest + ' (' + FILES.length + ' files).');
  }
}
