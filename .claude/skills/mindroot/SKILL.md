---
name: mindroot
description: Turn a codebase, a folder or a single file into MindRoot mind maps - Markdown outlines in MindRoot's dialect, as one map (.md) or a whole project folder (.interneuron) of linked maps, checked with MindRoot's own parser. Use when the person asks for a mind map, a MindRoot map or project, or to "map" a project, a folder, a file or a document.
---

# MindRoot maps from a project or a file

MindRoot (https://github.com/riccardofioreita/MindRoot) draws mind maps from plain Markdown. You write the Markdown; the person opens it in MindRoot. What you were asked to map is the argument of the skill: a file, a folder, several of them, or nothing at all (then it is the project you are in).

## 1. Ask what to make

Ask the person before you write anything, with your question tool when you have one, unless their request already says it:

- **A whole project** - a folder `<slug>.interneuron/` with an index map and one map per topic, linked to each other. Right for a codebase, a folder, a long document.
- **A single map** - one `.md` file. Right for one file or one small topic.

Put first, as the recommended choice, a single map when the source is one file of ordinary size, and a whole project otherwise. Ask nothing else: write in the language the person writes to you in, and write into the working directory unless they named a place. Never overwrite a file that is already there: take the next free name (`-2`, `-3`).

## 2. Read, then plan

Read the source itself - the code, the documents - not only the file names. Then decide the maps:

- **One map per topic.** A map holds at most about 60 nodes and 4 levels; what is larger becomes a map of its own.
- **A project starts with an index map**, named after the project: one branch per topic, each one a link to that topic's map.
- For code, good topics are the ones a newcomer asks about: what it is for, how it is laid out, the main flows, the data, how to run and test it. Name real files, functions and commands in the nodes.

## 3. Write the maps

```markdown
# Sign-in <!-- by: ai -->

## Flow <!-- by: ai -->
- > text: What happens from the form to the session,
  > in `src/auth/login.js`.
- Check the password <!-- by: ai -->
  - > text: `verify()` compares **hashes**, never the words.
    > - wrong three times: the account waits
    > - right: a session starts
  - > note: The delay is in `config/auth.json`.
- Start the session <!-- by: ai -->

## Related <!-- by: ai --> <!-- side: left -->
- [[Sessions]] <!-- by: ai -->
```

The rules that matter:

- **The first line is `# ` and the central title**, the only `#` heading of the map. Branches are `## ` headings; under them, `- ` list items.
- **A child is indented by two spaces** under a `- ` item (three under a numbered `1. ` item). A list item straight under a heading has no indent.
- **Titles are short**: at most 8 words, one line. What explains the node goes under it.
- **Document every node that is not obvious** with a quoted child, written straight under the node's line and before its children, at the indent a child would have:
  - `- > text: first line` - the words drawn under the node. Each further line is `> more`, aligned under the `>` of the first. It may hold a list (`> - item`).
  - `- > note: ...` - a side remark, opened from the node.
  - One `text` and one `note` per node: a second one is ignored.
- **Links**: `[[Map name]]` opens another map of the project, by its exact name. `[words](https://...)` is a web link.
- **Inline**: `**bold**` for key terms, `` `code` `` for names out of the source, `*italic*`, `==highlight==`. No HTML, no tables, no pictures, no fenced code.
- **Markers** are HTML comments at the very end of a node's line, one space before each:
  - `<!-- by: ai -->` on every node you write (MindRoot can show who wrote what);
  - `<!-- side: left -->` on a first-level branch that should grow on the left - put about half of them there when a map has four or more;
  - `<!-- color: #rrggbb branch -->` only when the person asks for colours: MindRoot colours the branches by itself.
- **Tasks**: `- [ ] to do`, `- [x] done`, for plans and check lists.
- A title that starts with `#`, `-`, `>` or a number and a dot would be read as something else: reword it.

Everything else MindRoot reads - boards, drawings, pictures, placed nodes, ids - is in the format's specification, `docs/FORMAT.md` of the MindRoot repository. Leave those alone unless the person asks.

## 4. The files

**A single map**: one file named after the map, as it is (`Sign-in.md`): MindRoot takes the map's name from the file name.

**A whole project**:

```
sign-in.interneuron/
  interneuron.json
  sign-in.md           the index map, first in the list
  sessions.md
```

- A file name is the **slug** of the map's name and `.md`: lower case, accents removed, every run of characters that are not letters or digits becomes `-`, none at either end, at most 60 characters. The folder is the slug of the project's name and `.interneuron`.
- `interneuron.json`, two-space indentation, every map in the order to show them, times in UTC as of now:

```json
{
  "mindroot": "project",
  "version": 1,
  "name": "Sign-in",
  "description": "How people sign in, from the form to the session",
  "isTemplate": false,
  "createdAt": "2026-10-07T07:00:00.000Z",
  "updatedAt": "2026-10-07T07:00:00.000Z",
  "maps": [
    { "file": "sign-in.md", "name": "Sign-in", "createdAt": "2026-10-07T07:00:00.000Z", "updatedAt": "2026-10-07T07:00:00.000Z" },
    { "file": "sessions.md", "name": "Sessions", "createdAt": "2026-10-07T07:00:00.000Z", "updatedAt": "2026-10-07T07:00:00.000Z" }
  ]
}
```

- A map's `name` is its central title, and the name `[[links]]` use.
- In the index map each topic is a node that is its link (`- [[Sessions]]`), with a `text` saying what is in it. In each topic map, the central node carries the way back: `- > note: Part of [[Sign-in]]`.

## 5. Check before you answer

Run the validator that sits beside this file on what you wrote, the folder or the file:

```bash
node <the folder of this skill>/validate.js sign-in.interneuron
```

It reads every map with MindRoot's own parser and prints `MINDROOT OK` or one line per finding. Fix every `ERROR` and every `WARN` you can, and run it again until it is clean. If it says the parser is missing, or there is no `node`, read your files again against the rules above and say that the check did not run.

## 6. Say what you made

In a few lines: the maps and what each holds, where the files are, and how to open them - drop the `.interneuron` folder, or the `.md` file, on MindRoot (or Projects > Import). If `zip` is there and the person wants one file to carry, `zip -r sign-in.interneuron.zip sign-in.interneuron` makes a project MindRoot imports as it is.
