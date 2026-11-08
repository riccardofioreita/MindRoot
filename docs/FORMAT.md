# MindRoot data formats

This is the specification of every file MindRoot reads and writes: the Markdown of a map, the project folder, notebooks and their pages, the JSON and ZIP exports, and the PNG that carries its map. It is written so that a person can edit the files by hand and a developer can write a program that reads and writes them the way MindRoot does.

Everything here is taken from the code, and the code is the final word when the two disagree. The sources are `js/model/doc.js` (the Markdown), `js/model/store.js` (the records), `js/model/archive.js` (folders, ZIP, JSON, PNG import), `js/model/storage.js` (bytes and names), `js/features/notebook.js` (notebooks), `js/features/ink.js` (page files), `js/features/paper.js` (papers and sizes) and `js/features/export.js` (exports).

Conventions used below:

- **must** is a rule MindRoot relies on; **reads** describes what MindRoot accepts; **writes** describes what MindRoot produces. A compatible writer should produce what MindRoot writes; a compatible reader should accept what MindRoot reads.
- Paths inside a project use forward slashes and are relative to the project folder (`assets/photo.jpg`).
- "Column" means a CommonMark column: a tab advances to the next multiple of four.
- Times in files are ISO 8601 strings in UTC (`2026-10-07T09:30:00.000Z`) unless the table says "ms", which means milliseconds since 1970-01-01 UTC as a JSON number.

Contents:

1. [Overview](#1-overview)
2. [The map: MindRoot's Markdown](#2-the-map-mindroots-markdown)
3. [The project folder (`.interneuron`)](#3-the-project-folder-interneuron)
4. [Notebooks (`.book` folders)](#4-notebooks-book-folders)
5. [Page files (`.ink.svg`)](#5-page-files-inksvg)
6. [JSON exports and backups](#6-json-exports-and-backups)
7. [ZIP exports and backups](#7-zip-exports-and-backups)
8. [The PNG that carries its map](#8-the-png-that-carries-its-map)
9. [Other exports](#9-other-exports)
10. [File naming rules](#10-file-naming-rules)
11. [What stays inside the browser](#11-what-stays-inside-the-browser)
12. [Versions and compatibility](#12-versions-and-compatibility)
13. [A whole project, worked through](#13-a-whole-project-worked-through)

---

## 1. Overview

```
workspace                         every project in the browser (IndexedDB 'mindroot2')
  project  = <name>.interneuron/  a folder when exported
    interneuron.json              the project's name, description and map order
    <map>.md                      one Markdown file per map
    assets/                       pictures and notebooks the maps name
      photo.jpg
      sketch.book/                a notebook: book.json + one .ink.svg per page
    templates/                    files a template project hands to new projects
    snapshots/                    timed and manual copies of maps, + snapshots.json
    trash/                        what was deleted, + trash.json
```

- A **map** is one Markdown file. Its text is the single source of truth: the tree, colours, sides, notes, pictures and the board are all in it.
- A **project** is a folder of maps and the files they use. It is the unit of export, import and backup.
- A **notebook** is a folder of SVG pages with a small `book.json`. The map names its first page, so any Markdown viewer shows a cover.
- A **page file** is an ordinary SVG that also carries its editable drawing as JSON.

Nothing in the formats depends on the browser: a project folder written by hand, with no `interneuron.json` and no `assets/`, is a valid project of its `.md` files.

---

## 2. The map: MindRoot's Markdown

The dialect is a plain Markdown outline plus a few end-of-line markers of its own. A map opens in any Markdown reader as an ordinary outline; everything MindRoot adds is either standard Markdown (lists, quotes, pictures) or an HTML comment, which every Markdown reader hides.

### 2.1 Text

- UTF-8. Line endings are read as `\n`; `\r\n` and `\r` are turned into `\n` when the text is read, so a map stored by MindRoot always has `\n` line endings.
- A byte-order mark at the start of the file belongs to the file and stays on its first line, whatever edits move the first line.
- MindRoot writes a new map as `# <name>\n`.

### 2.2 Front matter

If the first line (after a byte-order mark) is `---`, the lines up to the next line that is exactly `---` or `...` (trailing spaces allowed) are YAML front matter.

- MindRoot reads only flat `key: value` lines (keys of letters, digits, `_` and `-`; one pair of matching quotes around the value is removed). Nested YAML is skipped.
- The only key MindRoot uses is `title`: when a map has several top-level nodes (section 2.5), it is the text of the synthetic root.
- Front matter is never drawn and never rewritten: every byte stays as written. When MindRoot adds a board marker (section 2.13), it goes after the front matter.

### 2.3 Which lines are nodes

A **node** is one of:

| Line | Rule | Example |
| --- | --- | --- |
| ATX heading | 0 to 3 spaces of indent, 1 to 6 `#`, then a space, a tab or the end of the line | `## Vegetables` |
| List item | any indent, a marker `-`, `*`, `+`, or 1 to 9 digits followed by `.` or `)`, then spaces or tabs | `- Tomatoes`, `1. First`, `3) Third` |

A heading or list item is **not** a node when:

- its words are empty once the end-of-line markers (section 2.8) are peeled off: `#` alone, `- ` alone, `- <!-- color: #c2703d -->`. An empty heading still closes the sections deeper than it; what hangs under an empty item hangs from the node above it;
- it is a thematic break: three or more `-`, `*` or `_` with optional spaces (`---`, `* * *`);
- it is a quoted child (`- > note: ...`, section 2.10);
- it is inside a fenced code block (` ``` ` or `~~~`, three or more) or inside a multi-line `<!-- ... -->` comment;
- it is a numbered item that would interrupt a paragraph without starting at 1 (CommonMark's rule: `2019. a year` straight after a line of text is more of that text);
- it is an empty item straight after a paragraph line (also CommonMark's rule);
- it is indented four or more columns past the content column of the list it would continue (that is indented code).

Everything else is **text** (section 2.11).

### 2.4 Nesting

The tree is built in one pass over the lines with two stacks: the headings above the line, by level, and the list items the line is inside, by content column.

- **Headings** nest by level: a heading's parent is the nearest heading above it with a smaller level. A heading closes every open list.
- **List items** nest by **content column**, as CommonMark does: an item is a child of the nearest open item whose content column is at most the new item's marker column. The content column is where the item's words start: the column after the marker and the spaces that follow it; if there are no words, no spaces, or more than four spaces, it is one column past the marker. So `- a` has content column 2 and `1. a` has content column 3: a child of a numbered item is indented three spaces, a child of a bullet two.
- A list item with no open item above it is a child of the nearest heading above it, or a top-level node if there is none.
- An item indented more than three columns past its container's content column is not an item at all.
- Tabs count to the next multiple of four, so a tab-indented list nests exactly like a space-indented one.

MindRoot writes children of a bullet at the parent's content column (two spaces under `- `, three under `1. `), and a new sibling at the column of the sibling it lands before (or, when it is the last, of the node it follows).

### 2.5 Roots and paths

- A map with **one** top-level node: that node is the root of the tree.
- A map with **several** top-level nodes (for example two `#` headings, or a list with no heading): a synthetic root holds them. It has no line in the file; its text is the front matter `title`, or empty.
- Every node with no node above it is a **tree root**; its children are the **first-level branches** (the ones a `side` marker is about).
- A **path** names a node inside one parse: `''` is the single root, `'0'`, `'1'`, ... its children, `'0.2'` the third child of the first, and so on. With a synthetic root, the top-level nodes are `'0'`, `'1'`, ... Paths change with every edit; they are never stored in a map file (they appear in trash records as hints only, section 3.6).

### 2.6 Ordered lists

- A marker is 1 to 9 digits and `.` or `)`. The delimiter is kept as written.
- The numbers shown follow CommonMark: the first item of a run shows its own number and every following item of the run, same indent and same delimiter with nothing but blank lines between, counts on from it (`1. 1. 1.` shows 1, 2, 3).
- MindRoot writes a new sibling with the next number after the item it follows, and keeps the existing numbers otherwise. When an edit would leave a numbered item straight after a paragraph (where it would be read as text), MindRoot inserts a blank line before it.

### 2.7 Task boxes

- `[ ]`, `[x]` or `[X]` followed by a space or tab, right after a list marker, is a task box: `- [ ] Buy seeds`, `- [x] Order soil`. Headings have no task box.
- The box belongs to the marker, not to the words: renaming the node never removes it. Ticking writes `[x]`, unticking `[ ]`.
- MindRoot writes a new sibling of a task as a task (`- [ ] `).

### 2.8 End-of-line markers

Markers are HTML comments at the **end of a node's line**. Every Markdown reader hides them, and they move with the line.

| Marker | Values | Meaning | Applies to |
| --- | --- | --- | --- |
| `<!-- title: hN -->` | `h1` ... `h6` | the node's words are drawn at the size of that heading level | any node |
| `<!-- role: caption -->` | `caption` | the node is a caption: its pictures stand above its words | any node |
| `<!-- image: above -->` | `above` | the node's photos stand above its words | any node with a photo on its line |
| `<!-- draw: above -->` | `above` | the node's drawings stand above its words | any node with a drawing on its line |
| `<!-- markmap: fold -->` | `fold` | the node starts folded when the map opens | any node with children |
| `<!-- markmap: foldAll -->` | `foldAll` | the node and everything under it start folded | any node |
| `<!-- side: left -->` | `left` (others reserved) | the first-level branch grows on the left of its tree root | first-level branches only |
| `<!-- at: x,y -->` | two integers (may be negative) | where the node was put by hand: the middle of its box, from the middle of its parent's box (a top-level node of a map with several: on the map), in map units | any node but the single root of a map |
| `<!-- id: n3k9a1 -->` | 4 to 12 letters or digits (the app writes `n` and five) | a name for the node that survives edits and moves, given the first time something points at it with `[[Map#id]]`; unique in its map (the first of a repeated id is the one found); a copied branch gets none of the originals' | any node |
| `<!-- by: ai -->` / `<!-- by: mixed -->` | `ai` or `mixed` (others are no marker) | who wrote the node: `ai`, made by the AI assistance and not changed since; `mixed`, the AI's words and the person's together. No marker: the person alone. Written by the app when a node is added from the AI (suggested branches, a ghost branch, the chat) or when the person writes into one or takes the AI's words into theirs; shown as a small label on the map when Settings asks for it | any node |
| `<!-- color: #rrggbb -->` | `#rgb` or `#rrggbb` | the node's own colour | any node |
| `<!-- color: #rrggbb branch -->` | as above, then `branch` | the colour is also handed down to the node's descendants | any node |

Reading rules:

- Markers are peeled off **from the right**, one comment at a time, in any order and with any spacing between them. Peeling stops at the first comment from the right that is not a marker; that comment and everything left of it are the node's words.
- Keys, values and the word `branch` are case-insensitive. Spaces inside the comment are free: `<!--color:#C2703D-->` is read.
- A comment escaped as `\<!--` is never a marker; it is words the person typed.
- On a heading, CommonMark's optional closing `#` run (`## Title ##`) is kept with the markers and is not part of the words.
- **Legacy spellings.** `<!-- role: title -->` is read as `<!-- title: h2 -->` and `<!-- role: subtitle -->` as `<!-- title: h3 -->` (older files wrote sizes that way); when both a `title` marker and an old role are present, the `title` marker wins. A `<!-- side: X -->` with a word other than `left` (a later version might use `up` or `down`) is drawn on the right and written back unchanged.
- A `side` marker on a node that is not a first-level branch has no effect. MindRoot removes a `left` marker from a node that a move took off the first level (an unknown side word is left alone).
- An `at` marker on the single root of a map has no effect (it is taken off when an edit leaves the map with one root). On any other node it takes the node out of the automatic layout of its siblings (they close up), keeps it on its parent at that offset, takes its whole branch with it, and its children that have no `at` of their own grow on the side it stands on (the left when its middle is left of its parent's; a `side` marker on it is then not read). Map units are the units the map is laid out in: the root of a map in a column has the left edge of its box at x 0.
- A marker anywhere other than the end of the line is ordinary text (and hidden by the renderer like any comment).

Writing rules:

- When MindRoot changes any marker of a line, it rewrites all of that line's markers in the **canonical order**: `title`, `role`, `image`, `draw`, `fold`, `side`, `at`, `color`, each preceded by one space. Lines whose markers it does not touch keep their bytes, whatever their order.
- Colours are written as lowercase six-digit hex.
- `side: left` is the only side MindRoot writes; a branch on the right has no marker.
- `at` is written on a node dragged and let go anywhere that is not a node to drop onto (it stays on its parent). For a top-level node of a map with several, every top-level node gets its place at once, so none of the others moves. A node hung on another parent (dropped onto a node, Tab, Shift+Tab, "Attach to") loses its `at`; reordering among its siblings keeps it. "Detach" makes a branch a top-level node with its place on the map. "Put the branch back in order" removes the `at` of a branch, "Put the whole map back in order" every one.
- A size (`title`) and the `caption` role exclude each other: setting one removes the other.
- Setting the `caption` role also writes `image: above` and/or `draw: above` when the line has photos and/or drawings.
- `image: above` and `draw: above` are removed when the last picture of that kind leaves the line.

### 2.9 Colours

- A node's drawn colour is, in order: its own `color`; else the nearest ancestor colour marked `branch`; else the automatic palette colour of its branch.
- The automatic colour belongs to a branch: the root and each first-level node start a branch (with a synthetic root, each top-level node and each of its children); deeper nodes share their parent's branch. Branches are numbered in document order starting at -1 for the root, and branch `n` takes palette entry `(n + 1) mod 7` of `#2f7d5a`, `#c2703d`, `#3b6ea5`, `#b4485f`, `#5f8a3f`, `#a8843f`, `#4a7f8a`.
- What MindRoot writes: a colour picked by hand is written without `branch` (its existing children keep theirs), unless the node already had a `branch` colour; with the "random colours" setting each new node gets a `branch` colour; a new node deeper than the first level whose inherited colour would differ from the node it was made from gets that node's colour without `branch`.

### 2.10 Quoted children: notes, edge notes and words under a node

A list item whose words start with `>` and a keyword is not a node but a quoted child of a node:

```markdown
- Tomatoes
  - > note: Water every morning
  - > edge: since May
  - > text: Three plants
    > by the south wall
```

| Keyword | Legacy keyword | What it is |
| --- | --- | --- |
| `note` | `nota` | a note on the node (a card opened from the node) |
| `edge` | `arco` | a note on the line that reaches the node from its parent |
| `text` | (none) | the node's own words, drawn under its title on the map (its "body") |

- Pattern: optional indent, a bullet `-`, `*` or `+`, spaces, `>`, optional spaces, the keyword (case-insensitive), optional spaces, `:`, then the first line of the text.
- **Continuation lines**: each following line of the form `<indent>> more` (optional space after `>`) whose indent is deeper than the bullet's indent is another line of the same text. A line that is just `>` (or `> ` ) is a blank line between paragraphs.
- **Owner**: a quoted child belongs to the node above it in the file, whatever its indent. Past text that a top-level list item owns from outside its item (section 2.11), it belongs to that item.
- Only the **first** quoted child of each keyword counts for a node; later ones stay in the file as they are.
- Each line of a note is single-line text; blank lines at either end are dropped and runs of blank lines become one.
- **Lists.** A line after the first that is a list item (`- `, `* `, `+ `, `1. ` or `1) `, optionally followed by a task box `[ ]` / `[x]`) keeps the spaces in front of it, which nest it as CommonMark nests list items (a child is indented to the content column of the item above: two spaces under `- `, three under `1. `); tabs count to the next multiple of four, and at most 24 columns are kept. Every other line is folded flat as before. In the body, such lines are drawn as a list: bullets, numbers counted on from the first item of a run, and task boxes that are ticked on the map (`[ ]` <-> `[x]` on that line, nothing else changed). An indented plain line right after an item is more of that item. The lines stay quoted text, so they are never nodes; any Markdown reader shows them as a list inside the quote:

  ```markdown
  - Groceries
    - > text: For Saturday
      > - milk
      >   - organic
      > - [x] bread
      > 1. first
      > 2. second
  ```
- Text inside fenced code is never a note.
- **Body markers**: the `text` child may carry markers at the end of its first line, peeled the same way: `<!-- role: title -->`, `<!-- role: subtitle -->` or `<!-- role: caption -->` (how the words are styled), `<!-- image: above -->` and `<!-- draw: above -->` (for pictures inside the body). MindRoot writes them in the order role, image, draw.
- The body may hold pictures the same way a node's line does (section 2.12).
- **Writing**: a new quoted child is written as `- > <keyword>: <first line>` at the owner's content column (column 0 under a heading), directly under the owner's line and any text lines that run straight on from it, before every child. Continuation lines are written as `> line`, aligned under the bullet's words. MindRoot always writes the English keywords; a legacy keyword is replaced by the English one when that note is rewritten.

### 2.11 Text that is not a node

Paragraphs, quotes, fenced code, tables, lazy continuation lines and comments that are not on a node's line are **text**. Text rides with a node:

- it belongs to the innermost list item it is inside, else to the heading it is under;
- after a list has closed, where no heading is above it, it belongs to the last top-level node (it is outside that item's content column, and MindRoot remembers where that outside part starts so that a new child is inserted before it);
- text before the first node belongs to no node (an introduction); it is never drawn and never moved.

Text moves and is deleted with its node, and is drawn in the node's body after the `text:` words: paragraphs keep their line breaks, quotes are marked, code keeps its indentation, a table is drawn one row per line. Lines made only of comments, front matter, the board line and setext underlines are hidden.

### 2.12 Node titles and inline Markdown

A node's words are the rest of its line after the marker (and task box), with the end-of-line markers peeled off. Inline syntax MindRoot draws:

| Syntax | Drawn as |
| --- | --- |
| `**bold**`, `__bold__` | bold |
| `*italic*`, `_italic_` | italic (CommonMark flanking rules: `snake_case_name` stays plain) |
| `<u>underlined</u>` | underlined |
| `~~strike~~` | struck through |
| `==mark==` | highlighted |
| `` `code` `` | code |
| `[words](url)`, `<https://...>`, bare `https://...` | a link (only `http:`, `https:`, `mailto:` and relative destinations become links) |
| `[[Map name]]`, `[[Map name\|shown words]]` | a link to another map of the project, by name |
| `[[Map name#id\|shown words]]` | a link to the node of that map that carries `<!-- id: id -->`; clicking opens the map and selects the node. The `#id` is read when it is 4 to 12 letters or digits at the end of the name, so a map named `C#sharp` cannot be linked by name alone here |
| `[[#id\|shown words]]` | the same, to a node of the map the link is written in |
| `<br>` | a line break |
| `![alt](path)`, `<img src="path">` | a picture (section 2.12.1) |
| `&amp;`, `&#233;`, `&hellip;` | decoded (numeric references, and a fixed list of common named ones; other names stay as written) |
| anything else, including raw HTML | shown as the text it is |

A title is a single line. When MindRoot writes a title typed in the app, it escapes with a backslash anything that would change what the line is: a leading `#`, `- `, `* `, `+ `, `> `, a fence, a rule, a task box, a leading `1. ` (written `1\. `), a trailing `#` run on a heading (written `\#`), and a trailing comment that would be read as a marker (written `\<!--`). The rename box shows the title with these backslashes removed.

#### 2.12.1 Pictures

- A picture is `![alt](destination)` (CommonMark destination: `<with spaces>` in angle brackets, or a run with balanced parentheses, optionally followed by a `"title"`) or an HTML `<img src="...">`. A destination with spaces written without angle brackets is also read.
- **Photo or drawing** is decided by the path alone: a path ending in `.ink.svg` or `.excalidraw.svg` (case-insensitive, ignoring `?query` and `#fragment`) is a **drawing**; anything else is a **photo**.
- **Placement** on a node's line (or in its body): pictures before the words stand on the **left**, pictures after the words on the **right**; pictures in the middle of the words are part of the words. Photos and drawings are grouped separately: each kind sits on its own side. `<!-- image: above -->` / `<!-- draw: above -->` put that kind above the words (they are written at the head of the line). A line with only pictures and no words is a picture node.
- **Paths** are relative to the project folder (`assets/rose.jpg`). MindRoot also finds `./assets/rose.jpg` and percent-encoded paths (`assets/my%20rose.jpg` for `assets/my rose.jpg`). A destination with a URL scheme (`https:`, `data:`) is not a project file.
- **Writing**: MindRoot writes `![](assets/<name>)` with an empty alt text, in angle brackets when the path holds spaces, parentheses or `<` `>`. A new picture goes beside the others of its kind; a kind the line has none of starts on the left. A picture added with no node selected becomes a node of its own under a new top-level heading named with the localized word for "Images".
- A node's **drawing** is the first page of a notebook: `![](assets/tomatoes.book/001.ink.svg)` (section 4). An older single-file drawing (`![](assets/sketch.ink.svg)`, `![](assets/sketch.excalidraw.svg)`) is still a drawing.

### 2.13 The board marker

The map's board (one notebook for the whole map) is named by a comment on a line of its own:

```markdown
<!-- board: assets/garden-board.book/001.ink.svg -->
```

- Pattern: optional indent, `<!--`, optional spaces, `board`, `:`, the path, optionally ` | x,y,w,h` (four integers, the first two may be negative), optional spaces, `-->`, nothing else on the line. The path may not contain `>`.
- The first such line outside fenced code is the board; later ones are ignored.
- `x,y,w,h` is a placement older files may carry for a board window. MindRoot does not use it, keeps it, and writes it back when it rewrites the marker.
- **Writing**: MindRoot writes the marker on the first line of the file (after front matter), followed by one blank line. It names the first page of the board's notebook, `assets/<map slug>-board.book/001.ink.svg` for a new board. Boards made by earlier builds may name `<map>-lavagna.book`; they keep that folder name.
- The board line is never drawn as a node or as text.

### 2.14 Folds

- `<!-- markmap: fold -->` and `<!-- markmap: foldAll -->` (a spelling that comes from markmap) say how a map looks when it first opens.
- Folding and unfolding in the app does **not** write markers: the fold state is kept per map in the browser (section 11). Once a person has folded a map by hand, the browser's state wins over the markers; a map never folded by hand follows its markers.
- MindRoot keeps existing fold markers when it rewrites a line's markers. The only map MindRoot writes with a fold marker is its welcome sample.

### 2.15 What is preserved

An edit rewrites only the lines it is about. Every other line keeps its bytes. The exceptions, each made so that CommonMark still reads the file the same way:

- a blank line inserted before a numbered item that would otherwise continue the paragraph above it, and blank lines around a new heading or a new item written next to text or before a heading;
- a paragraph that a top-level item owns from outside its item is re-indented into the item when that item moves;
- siblings written at two different columns are aligned when a move would otherwise nest one under the other;
- a moved or re-levelled branch has its indentation (and, between heading and list form, its markers) rewritten;
- markers of a line are rewritten in canonical order when any of them changes (section 2.8).

An edit that adds or moves nodes is checked by parsing the result; if a node would land somewhere other than intended, the edit is refused rather than written.

### 2.16 What MindRoot writes for new nodes

| Action | Written |
| --- | --- |
| New map | `# <name>` |
| Child of a heading of level 1 to 5 that has no list children | a heading one level deeper, after a blank line: `## <title>` |
| Child of a heading of level 6, or of a heading whose first child is a list item | a list item: `- <title>` (or the next number) |
| Child of a list item | a list item at the parent's content column |
| Sibling | the same kind as the node, at its level or column, with the next number for a numbered item, `[ ] ` for a task, and the node's `side` marker for a first-level branch |
| A node with no words | the localized word for "untitled" |

---

## 3. The project folder (`.interneuron`)

```
garden.interneuron/
  interneuron.json
  garden.md
  garden-2.md
  assets/
  templates/
  files/
  snapshots/
    snapshots.json
    garden--2026-10-07-0930.md
  trash/
    trash.json
    2026-10-07-0941-herbs.md
```

| Path | Required | What it is |
| --- | --- | --- |
| `interneuron.json` | no | project metadata and map order (3.1) |
| `*.md`, `*.markdown` at the top | at least one map, or maps listed in `interneuron.json` | one map each (3.2) |
| `assets/` | no | pictures and notebooks named by the maps (3.3) |
| `templates/` | no | files a template project gives to projects made from it (3.3) |
| any other file or folder | no | kept as a project file under its path (3.3) |
| `files/` | no | where MindRoot writes a project file whose path would clash with a reserved one (3.3) |
| `snapshots/` | no | copies of maps (3.5) |
| `trash/` | no | deleted things (3.6) |

Reading ignores hidden files and folders (a path segment starting with `.`), system litter (such as `__MACOSX/`, `.DS_Store`, `Thumbs.db`) and any path containing `..` or a drive letter.

### 3.1 `interneuron.json`

Written with two-space indentation and a final newline.

| Field | Type | Written | Read |
| --- | --- | --- | --- |
| `mindroot` | string | `"project"` | ignored |
| `version` | number | `1` | ignored |
| `name` | string | the project's name, exactly | used if a non-empty string; else the folder name without `.interneuron`, else the first map's name |
| `description` | string | the description (at most 500 characters) | used if a string |
| `isTemplate` | boolean | whether the project is a template | `true` when truthy |
| `createdAt`, `updatedAt` | ISO string | yes | ISO string or ms; otherwise the time of the import |
| `maps` | array | one entry per map, in the project's order | entries naming a file that is not in the folder are skipped |
| `maps[].file` | string | the map's file name in the folder (`garden.md`) | matched exactly |
| `maps[].name` | string | the map's name, exactly (accents, capitals, punctuation) | used if a non-empty string; else the file name without `.md` |
| `maps[].createdAt`, `maps[].updatedAt` | ISO string | yes | as above |

Unknown fields are ignored. A folder without `interneuron.json` is a project of its `.md` files.

### 3.2 Map files

- One `.md` per map at the top of the folder. Map order: the order of `interneuron.json`'s `maps`, then every top-level `.md` or `.markdown` it does not list, sorted by name (case- and accent-insensitive).
- File names are derived from map names (section 10); the exact name lives in `interneuron.json`.

### 3.3 Project files: `assets/`, `templates/` and the rest

- Every file of the folder that is not `interneuron.json`, not a top-level `.md`/`.markdown` and not under `snapshots/` or `trash/` is a **project file**, kept with its path and its bytes. Maps refer to them by path (section 2.12.1).
- `assets/` holds pictures (`assets/rose.jpg`), single-file drawings (`assets/sketch.ink.svg`, `assets/old.excalidraw.svg`) and notebook folders (`assets/tomatoes.book/...`, section 4).
- `templates/`: when a new project is made from a template project, the template's `templates/` files come with it.
- A project file whose path would clash with a reserved one (named `interneuron.json`, a `.md` at the top, or under `snapshots/` or `trash/`) can only come from a foreign or hand-made import; MindRoot writes it as `files/<its path>` so that its bytes still reach the backup.
- Project files are deduplicated by content inside the browser; in a folder each path is simply a file.

### 3.4 Map and file life cycle

- A file no map names any more stays in the project (the images panel lists it as unused) until it is sent to the trash.
- Deleting a branch, a map or a picture records in its trash entry (3.6) the files it named; those that nothing else in the project names leave the project's files with it, the others stay.

### 3.5 `snapshots/`

A snapshot (shown in the app as a "copy") is a map's whole text at a moment.

- File: `snapshots/<map file name without .md>--YYYY-MM-DD-HHMM.md`, the time in the **local** time zone of the machine that wrote it. A second copy of the same map in the same minute gets `-2`, `-3`, ... before `.md` (`garden--2026-10-07-0930-2.md`), which is read back as the same minute.
- The prefix before `--` says which map the copy belongs to; a copy whose prefix matches no map is skipped on import.
- `snapshots/snapshots.json`: an array, newest first, written with two-space indentation:

| Field | Type | Meaning |
| --- | --- | --- |
| `file` | string | the file name inside `snapshots/` |
| `kind` | `"auto"` or `"manual"` | taken by the clock, or by hand |
| `label` | string | the note given to a manual copy (at most 300 characters), or `""` |
| `when` | ISO string | the exact time |

- On import the time comes from `snapshots.json` (exact), or from the file name (to the minute, local time) when the index is missing. `kind` defaults to `auto`.
- The app keeps the last 24 clock copies per map and never prunes manual ones.

### 3.6 `trash/`

Every deleted thing is a line in `trash/trash.json` plus one or more files beside it. `trash.json` is an array in the project's trash order (newest first), written with two-space indentation. Every line has:

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | string | `branch`, `figure`, `asset`, `map`, `note` or `snapshot` |
| `label` | string | what the trash list shows |
| `when` | ISO string | when it was deleted |
| `file` | string | the main file of the entry, inside `trash/` |

Then, by kind:

| Kind | `file` holds | Other fields |
| --- | --- | --- |
| `branch` (a branch cut from a map) | the branch's lines as Markdown, `<YYYY-MM-DD-HHMM>-<slug of label>.md` | `map` (the map's file name, or its name), `mapName`, `shape` `{kind: "heading"\|"bullet"\|"text", level, indent, label}`, `origin` `{parent: path or null, index, lineage: [words of each ancestor, root first]}`, `assets` `{path in the text: file in trash/}` |
| `figure` (a picture taken off a node) | the picture's bytes, under its own file name | `from` (its project path), `owner` (the node's words), `map`, `mapName`, `ownerPath` (the node's path when it was deleted), `field` (`"line"` or `"body"`), and for a notebook `assets` `{project path: file in trash/}` with the folder's other files |
| `asset` (a file sent to the trash from the images panel, or a notebook page) | the file's bytes | `from`, `owner`, and for a whole notebook `assets` as above |
| `map` (a deleted map) | the map's text, `<slug of name>.md` | `name`, `index` (its place in the map list), `createdAt` (ISO), `assets` (files only it used), `snapshots` `[{file, kind, label, when}]` (its copies, files `<map file>--<stamp>.md` in `trash/`) |
| `note` (a deleted note) | the note's text, `<stamp>-<slug of label>.md` | `map`, `mapName`, `owner`, `ownerPath`, `noteKind` (`"node"` or `"edge"`) |
| `snapshot` (a deleted copy) | the copy's text, `<slug of map name>--<stamp of the copy>.md` | `map`, `mapName`, `snapshotKind` (`"auto"` or `"manual"`), `note` (the copy's label), `taken` (ISO time the copy was taken) |

- File names inside `trash/` are unique case-insensitively (`-2`, `-3` before the extension, before both halves of `.ink.svg`).
- **Reading**: a line without `kind` comes from older files, written before the trash held anything but pictures: it is a picture, its `label` is the words of the node it hung from, and in a one-map project it goes back onto that node. A file in `trash/` that no line names is a loose file and is restored into `assets/` under its own name. Lines whose files are missing are skipped.
- **Restoring** puts a branch back under the same parent if it is still there under the same ancestors, else under a node with the same words, else at the end of the map; a picture back on its node; a notebook back whole, in a free folder name if its own was taken meanwhile (`sketch-2.book`).

---

## 4. Notebooks (`.book` folders)

A notebook is a folder of project files:

```
assets/tomatoes.book/
  book.json
  001.ink.svg
  002.ink.svg
  background.png        only when a picture was chosen as the paper
```

The map names the **first page** (`![](assets/tomatoes.book/001.ink.svg)` on a node, or the board marker), so any Markdown viewer shows the cover. When the page order changes so that another page comes first, MindRoot rewrites every reference to the notebook in the project's maps in the same step.

### 4.1 `book.json`

Written with two-space indentation and a final newline, keys in this order:

```json
{
  "mindroot": "book",
  "version": 1,
  "mode": "infinite",
  "paper": { "type": "dots" },
  "size": { "id": "a4", "w": 210, "h": 297, "orientation": "portrait" },
  "background": "auto",
  "backgroundImage": null,
  "pages": [ { "file": "001.ink.svg" }, { "file": "002.ink.svg" } ]
}
```

| Field | Type | Values | Default when missing or invalid |
| --- | --- | --- | --- |
| `mindroot` | string | `"book"`; a different value makes the file unreadable | `"book"` |
| `version` | number | `1`; a higher number makes the file unreadable | `1` |
| `mode` | string | `"infinite"` (unbounded canvases, one shown at a time) or `"pages"` (fixed-size pages stacked vertically) | `"infinite"` |
| `paper` | object | `{type, ...overrides}`, section 4.2 | `{"type": "dots"}` |
| `size` | object | `{id, w, h, orientation}`, section 4.3 (used in pages mode) | A4 portrait |
| `background` | string | `"auto"` (light paper in the light theme, dark paper in the dark theme) or a `#rrggbb` colour | `"auto"` |
| `backgroundImage` | object or null | `{file, type, w, h}`, section 4.4 | `null` |
| `pages` | array | `[{file}]` in page (or canvas) order; `file` is a name directly in the folder ending in `.ink.svg` or `.excalidraw.svg` | `[{"file": "001.ink.svg"}]` |
| `trashed` | array, optional | `[{file, at}]`: pages now in the project's trash and the 0-based position each had, so a restore puts it back there (at most 200 kept) | absent |

Reading rules:

- A page name must be at most 120 characters, contain no `/`, `\` or NUL, and end with `.ink.svg` or `.excalidraw.svg`; duplicates are dropped.
- Pages listed but missing from the folder are dropped. Drawing files in the folder that `pages` does not list are added: at their `trashed` position when known, else at the end in natural name order.
- With no `book.json`, or one that cannot be read (bad JSON, wrong `mindroot`, higher `version`), the notebook opens with default settings and the folder's drawing files in name order; for an unreadable one the app says it cannot read the notebook.
- The same file format serves both modes: in infinite mode each page file is one canvas. Switching modes keeps every page.

### 4.2 Papers

`paper.type` is one of the ids below. Any parameter of that paper may be overridden with a positive number (lengths in millimetres unless the name ends in `Px`); out-of-range values are clamped (lengths 0.5 to 1000 mm, `ray` 1 to 90, `slant` 15 to 90, `every` 1 to 64 whole, `lines` 1 to 20 whole, `stepPx` 2 to 512, `slantStep` 2 to 100, `decade` 5 to 1000). MindRoot writes only the overrides that differ from the defaults. An unknown type is drawn as `blank`.

| Group | `type` | Default parameters |
| --- | --- | --- |
| Basic | `blank` | none |
| | `dots` | `step: 5` |
| | `grid-4`, `grid-5`, `grid-10` | `step: 4` / `5` / `10` |
| | `ruled-narrow` | `step: 6.35, top: 22, bottom: 12` |
| | `ruled` | `step: 7.1, top: 22, bottom: 12` |
| | `ruled-wide` | `step: 8.7, top: 22, bottom: 12` |
| | `ruled-margin` | `step: 7.1, top: 22, bottom: 12, margin: 25` |
| School | `school-1` | `band: 10, gap: 5, top: 20, bottom: 12` |
| | `school-2` | `ascender: 5, body: 4, descender: 4, top: 20, bottom: 12` |
| | `cornell` | `step: 7.1, header: 25, cue: 63.5, summary: 50.8` |
| | `two-columns` | `step: 7.1, header: 25` |
| Maths and science | `millimetre` | `margin: 10` |
| | `semilog` | `decade: 90, step: 2, margin: 10, label: 6` |
| | `log-log` | `decade: 90, margin: 10, label: 6` |
| | `polar` | `ring: 5, ray: 15, margin: 14` |
| | `isometric`, `honeycomb` | `side: 5` |
| | `cartesian` | `step: 5, tick: 10, margin: 10` |
| Music | `staff` | `space: 2.25, period: 22, top: 20, bottom: 15, side: 15` |
| | `grand-staff` | `space: 2.25, between: 11, period: 46, top: 20, bottom: 15, side: 15, left: 22` |
| | `guitar-tab` | `space: 3, period: 27, top: 20, bottom: 15, side: 15` |
| Design | `grid-8pt` | `stepPx: 8, every: 8` |
| | `wireframe-phone` | `margin: 12, gap: 10, label: 8` |
| | `wireframe-browser` | `margin: 12, gap: 10, label: 8, toolbar: 9` |
| | `storyboard` | `margin: 12, gap: 8, lines: 3, step: 6` |
| Planning | `weekly` | `margin: 10, header: 16, gap: 4, step: 7` |
| | `todo` | `margin: 15, header: 28, step: 9, box: 4.4` |
| Calligraphy | `calligraphy` | `xHeight: 5, ascender: 7.5, descender: 7.5, gap: 5, slant: 55, slantStep: 8, top: 20, bottom: 12, side: 12` |
| Import | `image` | none; requires `backgroundImage` (without it the paper falls back to `dots`) |

`cornell`, `two-columns`, `wireframe-phone`, `wireframe-browser`, `storyboard`, `weekly` and `todo` repeat in page-sized cells on an infinite canvas; the others run on for ever.

### 4.3 Sizes

`size.id` is one of the ids below; a known id always takes its own dimensions (a hand-edited `w`/`h` cannot make an A4 that is not A4). `custom` takes `w` and `h` in millimetres, clamped to 20 to 2000. `orientation` is `"portrait"` or `"landscape"`; `w` and `h` are written already swapped for it (in landscape `w` is the longer side). Lengths are rounded to two decimals.

| `id` | w x h (mm) | Default orientation |
| --- | --- | --- |
| `a3` | 297 x 420 | portrait |
| `a4` | 210 x 297 | portrait |
| `a5` | 148 x 210 | portrait |
| `a6` | 105 x 148 | portrait |
| `b5` | 176 x 250 | portrait |
| `letter` | 215.9 x 279.4 | portrait |
| `legal` | 215.9 x 355.6 | portrait |
| `square` | 210 x 210 | portrait |
| `wide` (16:9) | 338.67 x 190.5 | landscape |
| `standard` (4:3) | 254 x 190.5 | landscape |
| `ipad` | 157.8 x 227 | portrait |
| `custom` | `w` x `h` | from `w` and `h` |

On screen and in page files, 1 mm = 96 / 25.4 px: an A4 page is 793.7 x 1122.52 px.

### 4.4 A picture as the paper

| Field | Type | Rule |
| --- | --- | --- |
| `file` | string | `background.svg`, `background.png`, `background.jpg` or `background.jpeg`, a file in the notebook folder |
| `type` | string | derived from the extension on read (`image/svg+xml`, `image/png`, `image/jpeg`) |
| `w`, `h` | number | the picture's size in px, 1 to 20000 (default 800 x 600) |

The original picture is kept whole in the folder (an SVG is sanitised first: no scripts, no external references, no event attributes). Each page file carries a lighter copy of it as a data URL, so the page reads on its own. On a page the picture is shown whole, centred; on an infinite canvas it repeats at its own size from the origin. Imported pictures are limited to 20000 px a side and 50 megapixels.

### 4.5 Names, references and older drawings

- Folder: `assets/<slug>.book`. A node's notebook takes the slug of the node's words (or the localized word for "notebook"); a board takes `<slug of the map name>-board`. If the folder exists (or a trashed file sits in it), `-2`, `-3`, ... is added before `.book`.
- Pages: `001.ink.svg`, `002.ink.svg`, ... (three digits at least). A new page takes the number after the highest one found in the folder, in `book.json` or among the folder's pages in the trash, so a restored page never collides.
- **Nothing is written until the first stroke.** A notebook (folder, `book.json`, first page and the reference in the map) comes into existence in the same undo step as its first stroke.
- **Single-file drawings**: a reference to a lone `*.ink.svg` or `*.excalidraw.svg` (not inside a `.book` folder) opens as a one-page infinite notebook with default settings and is not converted by opening. The first change that needs `book.json` (a setting, a second page) moves it into a new folder named after it and rewrites the references in the maps, in one step. An older `.excalidraw.svg` moves at its first stroke (it cannot be written back) and becomes the locked background of the new first page; the original file stays where it was.
- The whole folder moves as one thing: sending a notebook to the trash, restoring it, copying a branch with it, and exporting it.

---

## 5. Page files (`.ink.svg`)

Every page of a notebook (and every single-file drawing MindRoot makes) is a self-contained SVG that shows the drawing anywhere (an `<img>`, Obsidian, a browser) and carries the editable scene inside.

### 5.1 Structure

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 793.7 1122.52" width="793.7" height="1122.52" data-mindroot-ink="1">
  <metadata id="mindroot-ink">{"v":1,"elements":[...],"page":{"w":793.7,"h":1122.52}}</metadata>
  <g class="mr-paper" aria-hidden="true" pointer-events="none"> ... the paper ... </g>
  <image id="mindroot-ink-bg" x="0" y="0" width="..." height="..." preserveAspectRatio="none" href="data:image/svg+xml;base64,..."/>
  <path d="..." fill="#15171c" class="mr-ink"/>
  ...
</svg>
```

(Shown indented; the file is written on one line.)

In order:

1. The root `<svg>`: `xmlns`, `viewBox`, `width`, `height` and `data-mindroot-ink="1"` (`"2"` when the drawing holds a picture).
   - On a **page** (pages mode), the viewBox is the page: `0 0 <w> <h>` in px.
   - On an **infinite canvas**, the viewBox is the drawing's bounding box with 16 px of margin, rounded outwards to whole pixels; an empty canvas is `0 0 320 200`.
2. `<metadata id="mindroot-ink">`: the scene as JSON (5.2), with `&`, `<` and `>` escaped as XML entities (quotes are not escaped).
3. The paper: either the paper of `ns.paper` drawn over the whole viewBox for print (a `<g class="mr-paper" aria-hidden="true" pointer-events="none">` whose sheet is a `rect.mr-sheet` and whose lines carry `mr-line`, `mr-strong`, `mr-margin` and `mr-text`), or, with no paper, a single `<rect class="mr-sheet" fill="#fbfaf7">` (or the chosen background colour). A picture used as the paper follows as an element with class `mr-image`.
4. Optional `<image id="mindroot-ink-bg">`: a locked background picture as a data URL (an old drawing kept behind the new one).
5. The elements, in drawing order (5.3); a picture is an `<image id="mrimg-<id>">` holding its bytes.

The file is always written on the **light** paper with literal colours, so it reads correctly anywhere. Characters XML 1.0 forbids (control characters other than tab, LF and CR, U+FFFE, U+FFFF, lone surrogates) are removed.

### 5.2 The scene (`<metadata id="mindroot-ink">`)

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | number | format version: `1`, or `2` when the drawing holds a picture (`image`, 5.3), so a build that does not know pictures opens it read-only instead of saving it back without them; a later one is shown, never edited |
| `elements` | array | the elements, in drawing order (5.3) |
| `page` | `{w, h}`, optional | present for a bounded page: its size in px |
| `background` | `{x, y, w, h}`, optional | where the locked background picture (`#mindroot-ink-bg`) sits; the picture itself is the `href` of that `<image>` and must be an image data URL |

Numbers are rounded: coordinates and sizes to 2 decimals, opacity, thinning, smoothing, streamline and pressure to 3.

### 5.3 Elements

Every element has `id` (1 to 64 of `A-Z a-z 0-9 _ -`; anything else, or a repeated id, gets a fresh one on read) and `type`. `color` is either the word `"ink"` (the semantic ink, 5.4) or a lowercase `#rrggbb`; anything else reads as `"ink"`. Coordinates are in px of the canvas (the page's own px on a page).

| `type` | Fields (as written) | Read limits |
| --- | --- | --- |
| `stroke` (freehand) | `pen`, `color`, `size`, `opacity`, `thinning`, `smoothing`, `streamline`, `cap`, `blend`, `sim`, `points` | `pen`: `pen`, `pencil`, `marker`, `brush` or `highlighter` (else `pen`); `size` 0.1 to 400 (diameter at mid pressure); `opacity` 0.02 to 1; `thinning` -1 to 1; `smoothing` and `streamline` 0 to 1; `cap` boolean (default true); `blend` `"normal"` or `"multiply"`; `sim` boolean (pressure simulated from speed); `points` 1 to 200000 of `[x, y, pressure]` (pressure 0 to 1, default 0.5), written as `[x, y]` when `sim` is true |
| `line`, `arrow` | `points`, `color`, `width` | `points`: exactly two `[x, y]`; `width` 0.1 to 200 (default 4) |
| `rect`, `ellipse`, `diamond` | `x`, `y`, `w`, `h`, `color`, `width`, `fill` | negative `w`/`h` are normalised; `fill` `"none"`, `"soft"` (20 % opacity) or `"solid"` |
| `image` | `x`, `y`, `w`, `h`, `locked` (only when true) | a picture on the sheet. Its bytes are **not** in the scene: they are the `href` of the `<image id="mrimg-<id>" class="mr-pic" preserveAspectRatio="none">` that carries the element's id, written once, which must be a PNG, JPEG, GIF, WebP or SVG data URL (14 million characters at most; a missing, external or other `href` drops the element); `w`, `h` greater than 0, held to 20000; a locked picture cannot be selected, moved or erased. Pictures are written first, behind the ink already there, and the eraser never takes them |
| `text` | `x`, `y`, `text`, `size`, `color`, `w`, `h` | `text` at most 20000 characters and not blank; `size` 2 to 512 (default 24); `w`, `h` the box measured where it was written, kept so it lays out the same everywhere |

Missing numbers of a stroke take the defaults of its pen:

| `pen` | size | opacity | thinning | smoothing | streamline | cap | blend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pen` | 3 | 1 | 0.6 | 0.5 | 0.5 | true | normal |
| `pencil` | 2 | 0.72 | 0.3 | 0.35 | 0.3 | true | normal |
| `marker` | 10 | 0.6 | 0 | 0.6 | 0.55 | true | normal |
| `brush` | 14 | 0.95 | 0.8 | 0.6 | 0.45 | true | normal |
| `highlighter` | 20 | 0.4 | 0 | 0.6 | 0.6 | false | multiply |

A stroke is drawn as a filled outline computed from its points with the perfect-freehand algorithm (as reimplemented in `js/features/ink.js`); the outline in the SVG is a rendering, the points in the metadata are the truth. Elements that fail these checks are dropped on read; the rest of the drawing still opens.

### 5.4 Classes for theming

- `mr-ink`: an element drawn in the semantic ink. In the file it is the light paper's ink `#15171c`; in the dark theme the app shows it light (`#e4e6ea`).
- `mr-sheet`: the sheet (light paper `#fbfaf7`; dark sheet `#1c1e22` on screen).
- `mr-line`, `mr-strong`, `mr-margin`, `mr-text`: the paper's ordinary lines, stronger lines, margin line and printed labels.
- `mr-image`: a picture used as the paper.
- `mr-paper`: the group holding the paper.

Every other colour is literal and never changes with the theme.

### 5.5 Reading older and foreign SVG

| What the file is | How it opens |
| --- | --- |
| Ours, `v: 1` | edited normally |
| Ours, `v` higher than 1 | shown as a picture, view only: never written over |
| Ours, with a scene that cannot be read | the picture is kept as a locked background of a new drawing |
| Ours, but rejected by the XML parser | the scene is read from the raw text and saved again whole |
| Any other SVG (for example an older `.excalidraw.svg`) | the picture becomes the locked background of a new drawing |
| A file from before the semantic ink (no `page` and no `mr-sheet`/`mr-ink` anywhere) | the old default colours `#1f2328` and `#4a4f57` are read as `"ink"` |

---

## 6. JSON exports and backups

One JSON file holds whole projects for programs: the store's own records, plus the bytes of every file in base64. It is lossless.

### 6.1 Project JSON

From the project menu, "Export as JSON". File name: `<slug of project name>-YYYY-MM-DD-HHMM.json` (local time).

```json
{
  "mindroot": "project",
  "version": 1,
  "exportedAt": 1791365400000,
  "id": "p...",
  "name": "Garden",
  "description": "",
  "isTemplate": false,
  "createdAt": 1791360000000,
  "updatedAt": 1791365000000,
  "maps": [ ... ],
  "files": { "assets/rose.jpg": { "asset": "a3f1...", "type": "image/jpeg", "size": 48213, "modified": 1791362000000 } },
  "trash": [ ... ],
  "snapshots": [ ... ],
  "assets": [ { "id": "a3f1...", "type": "image/jpeg", "data": "<base64>" } ]
}
```

### 6.2 Workspace JSON

From the sidebar, every project at once. File name: `mindroot-workspace-YYYY-MM-DD-HHMM.json`.

```json
{
  "mindroot": "workspace",
  "version": 1,
  "exportedAt": 1791365400000,
  "projects": [ { "id": "...", "name": "...", "maps": [], "files": {}, "trash": [], "snapshots": [] } ],
  "assets": [ { "id": "...", "type": "...", "data": "<base64>" } ]
}
```

Both are written with two-space indentation. `assets` holds each set of bytes once, however many paths or trash entries point at it.

### 6.3 Records

All times in these records are **ms** numbers.

**Project**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | unique in the workspace; replaced by a fresh id on import |
| `name` | string | 1 to 120 characters, whitespace collapsed |
| `description` | string | at most 500 characters |
| `isTemplate` | boolean | |
| `createdAt`, `updatedAt` | ms | |
| `maps` | array of map | in the sidebar's order |
| `files` | object | project path to file reference |
| `trash` | array of trash entry | newest first |
| `snapshots` | array of snapshot | |

**Map**: `{id, name, text, createdAt, updatedAt}`; `text` is the map's Markdown (section 2) with `\n` line endings.

**File reference**: `{asset, type, size, modified}`: `asset` is the id of the bytes (inside MindRoot, `a` + 56 hex digits of the SHA-256 of the bytes + 8 hex digits of a hash of the media type); `type` the media type; `size` in bytes; `modified` ms. Keys of `files` are cleaned paths (section 10.4).

**Snapshot**: `{id, mapId, when, kind, label, text}`; `kind` is `"auto"` or `"manual"`.

**Trash entry**: `{id, kind, deletedAt, label, ...}`, then by kind:

| `kind` | Fields |
| --- | --- |
| `branch` | `mapId`, `mapName`, `fragment` `{text, kind: "heading"\|"bullet"\|"text", level, indent, label}`, `origin` `{parent, index, lineage}`, `files` (project path to file reference: the files that left with it) |
| `figure` | `path`, `file` (file reference or null), `owner`, `ownerPath`, `field` (`"line"` or `"body"`), `mapId`, `mapName`, optional `files` (the rest of a notebook folder) |
| `asset` | `path`, `file`, `owner`, optional `files` (the rest of a notebook folder) |
| `note` | `text`, `noteKind` (`"node"` or `"edge"`), `owner`, `ownerPath`, `mapId`, `mapName` |
| `map` | `index`, `map` (a map record), `files`, `snapshots` (the map's copies) |
| `snapshot` | `mapName`, `snapshot` (a snapshot record) |

### 6.4 Reading JSON

- A JSON with `"mindroot": "workspace"` brings in its `projects`; one with `"mindroot": "project"`, or any object with a `maps` array, is one project. Anything else is refused with a message; a JSON written by IPE (it has an `ipe` key) is refused with a message saying so.
- `version` is not checked; unknown fields are ignored.
- Every record is checked and made whole: missing ids get fresh ones, duplicate ids are renamed, names are cleaned, invalid trash entries are dropped, unknown trash kinds are dropped.
- `assets[]` entries need `id` and `data` (base64); `type` (or `mime`, or a type guessed from `name`) gives the media type. The bytes are stored by content, and every reference is rewritten to the id they got, so an id in a file can never overwrite other bytes.
- An import always adds beside what is there; nothing is replaced. Imported projects get fresh ids, and a project whose name the workspace already has gets ` (2)`, ` (3)`, ... after it. Everything brought in at once is one undo step.

---

## 7. ZIP exports and backups

- **Project ZIP** (project menu, "Export as ZIP"): `<slug>.interneuron.zip`, holding the folder `<slug>.interneuron/` (section 3).
- **Backup** (Settings, "Back up everything"): `mindroot-YYYY-MM-DD-HHMM.zip`, holding one `.interneuron` folder per project in sidebar order; a second project with the same slug gets `-2`.
- Entries are stored without compression, with their modification dates; file names are UTF-8.

Reading a ZIP:

- Every `.interneuron` folder at the top of the ZIP is a project, whatever the ZIP is called; anything beside them is left out and named in the message.
- A ZIP named `<name>.interneuron.zip` whose files sit at its root (the folder zipped from inside) is read as that folder.
- Entries whose paths climb out (`..`), name a drive, or are system litter are refused and named in the message.
- Other inputs: a `.md` or `.markdown` file becomes a map in the open project (or a project of its own when none is open); its pictures do not come with it. A folder picked or dropped is read like a ZIP: `.interneuron` folders are projects, and on request a plain folder of `.md` files is read as one project.

---

## 8. The PNG that carries its map

A PNG exported by MindRoot carries the map's Markdown, so dropping it back on MindRoot gives the map back.

- Chunk: `iTXt`, inserted right after `IHDR`.
- Keyword: `mindroot-markdown` (Latin-1), then a NUL byte, compression flag `0`, compression method `0`, an empty language tag and NUL, an empty translated keyword and NUL, then the text in UTF-8.
- The text is the map's Markdown as the export options leave it: notes included unless "Include the notes" is off; drawing pictures and the board marker removed unless "Include the drawings" is on (a line left with nothing but its marker goes too).
- The CRC is the standard PNG CRC-32 over the chunk type and data.

Reading: chunks are walked until `IEND`; the first `iTXt`, `tEXt` (Latin-1) or `zTXt` whose keyword is `mindroot-markdown` and whose CRC is correct gives the text (compressed `iTXt` and `zTXt` are inflated). The map is named after the file, without `.png` (and without a further `.mindroot`).

---

## 9. Other exports

| Export | File | Content |
| --- | --- | --- |
| SVG | `<map name>.svg` | the whole map drawn as native SVG (paths, `<text>`, `<image>` with data URLs), Montserrat embedded as an `@font-face` data URL; no `foreignObject` |
| PNG | `<map name>.png` | the SVG rasterised at 2x (less for very large maps), plus the chunk of section 8 |
| PDF | through the browser's print dialog | one page cut to the map, longest side between 297 and 5080 mm, vector |
| Markdown | `<map name>.md` | the map's text, without notes and/or drawings when asked |
| Notebook PDF / PNG | from the notebook's Export | every page at its own size (pages mode), or a page per canvas cut to its drawing (infinite mode); PNG of the page or canvas in view |

Map export file names keep the map's name, minus what file systems refuse (section 10.3).

---

## 10. File naming rules

### 10.1 Slugs

Used for map files, project folders, assets, notebook folders and trash files:

1. Unicode NFD, combining marks removed, back to NFC, lower case.
2. Every run of characters that are not letters or digits (any script) becomes `-`.
3. Leading and trailing `-` removed.
4. Cut to 60 characters, trailing `-` removed again.

`Città di Mélisande` becomes `citta-di-melisande`; `東京 2024` becomes `東京-2024`. When nothing is left, a fallback is used: `map` for a map file, `project` for a project folder, `branch` or `note` for trash files, and the localized words for "image", "drawing" or "notebook" for assets.

### 10.2 Unique names

- In a folder being written (maps, `snapshots/`, `trash/`, projects in a backup), names are unique **case-insensitively** (as on Windows and macOS): the second one gets `-2`, then `-3`, before the extension, and before both halves of a drawing's double extension (`sketch-2.ink.svg`).
- In a project's files, a new asset that would take a used path gets `-2`, `-3`, ... the same way (`assets/rose-2.jpg`); a new notebook folder gets `-2.book`, `-3.book`.
- Asset names: `assets/<slug of the original name><extension in lower case>`; an extension that is not 1 to 8 letters or digits is replaced by one from the media type (`.png` by default). Drawings keep their double extension.

### 10.3 Export file names

Map exports use the map's name as it is, with characters file systems refuse (`< > : " / \ | ? *`, control characters) replaced by spaces, spaces collapsed, leading dots and trailing dots and spaces removed, cut to 80 characters; a name left empty or equal to a Windows device name (`con`, `prn`, `aux`, `nul`, `com1`..., `lpt1`...) falls back to its slug, then to `mindroot`.

### 10.4 Paths inside a project

A project path is cleaned before it is stored: backslashes become `/`, leading slashes, `.` and empty segments are dropped. A path is refused if it contains `..`, a NUL, ends with `/`, or starts with a URL scheme (`https:`, `c:`).

### 10.5 Time stamps in names

`YYYY-MM-DD-HHMM` in the local time zone of the machine that wrote the file. The exact time, in UTC, is always in the JSON beside it (`snapshots.json`, `trash.json`).

---

## 11. What stays inside the browser

Not part of any file, never exported:

- the IndexedDB database `mindroot2` (version 1) with three object stores: `projects` (one project record per key `id`, files as references), `blobs` (`{id, blob, type, size, name, createdAt}`, one record per content) and `kv` (`workspace`: project order and what is open; `views`: per-map view state);
- the per-map view state: folds (as keys of node words from the root, so they survive edits), the camera, whether the map or its board is shown, and each notebook's canvas and cameras;
- preferences, in `localStorage` under keys starting with `mindroot2:`;
- the undo history (at most 300 steps, for the session).


---

## 12. Versions and compatibility

| Format | Marker | Current | A newer version is |
| --- | --- | --- | --- |
| Map Markdown | none | the outline dialect with its markers | read; unknown comments are text, an unknown `side` word is kept |
| `interneuron.json` | `"mindroot": "project", "version": 1` | 1 | read (the version is not checked; unknown fields ignored) |
| Project / workspace JSON | `"mindroot": "project"` / `"workspace"`, `"version": 1` | 1 | read (not checked; unknown fields ignored) |
| `book.json` | `"mindroot": "book", "version": 1` | 1 | not read: the notebook opens with default settings and its page files |
| Page file | `data-mindroot-ink="1"`, scene `"v": 1` | 1 | shown as a picture, view only, never written over |
| PNG chunk | keyword `mindroot-markdown` | (none) | |

Promises:

- **Older files open**: maps, `.interneuron` folders, ZIP and JSON exports in the older form, `.excalidraw.svg` drawings, legacy note keywords, legacy roles and trash lines without a kind. The automated tests read real exports in that form (`test/fixtures/data/old-exports.js`).
- **A map is never rewritten just by opening it.** The one exception is a map that an earlier build drew with "grows on both sides": the first time it opens, the sides that layout drew are written as `side` markers, in one undo step.
- **Lines MindRoot does not edit keep their bytes** (section 2.15).
- **A file from a later version is never silently overwritten**: page files of a newer format open view only.

---

## 13. A whole project, worked through

A project "Garden" with one map, a node drawing, a photo, a board and one deleted branch, exported as `garden.interneuron.zip`:

```
garden.interneuron/
  interneuron.json
  garden.md
  assets/
    rose.jpg
    tomatoes.book/
      book.json
      001.ink.svg
    garden-board.book/
      book.json
      001.ink.svg
  snapshots/
    snapshots.json
    garden--2026-10-07-0930.md
  trash/
    trash.json
    2026-10-07-0941-herbs.md
```

`interneuron.json`:

```json
{
  "mindroot": "project",
  "version": 1,
  "name": "Garden",
  "description": "What grows where",
  "isTemplate": false,
  "createdAt": "2026-10-07T07:00:00.000Z",
  "updatedAt": "2026-10-07T07:45:00.000Z",
  "maps": [
    {
      "file": "garden.md",
      "name": "Garden",
      "createdAt": "2026-10-07T07:00:00.000Z",
      "updatedAt": "2026-10-07T07:45:00.000Z"
    }
  ]
}
```

`garden.md` (written by MindRoot's own edits):

```markdown
<!-- board: assets/garden-board.book/001.ink.svg -->

# Garden

## Vegetables <!-- color: #c2703d branch -->
- > text: Raised beds
  > by the wall

### ![](assets/tomatoes.book/001.ink.svg) Tomatoes
- > edge: since May
- > note: Water every morning

#### Cherry
- [ ] Stake them
- [x] Order seeds

## ![](assets/rose.jpg) Flowers <!-- title: h3 --> <!-- side: left -->
```

What it means:

- `Garden` is the root. `Vegetables` and `Flowers` are first-level branches; `Flowers` grows on the left, `Vegetables` on the right.
- `Vegetables` is orange (`#c2703d`) and, because of `branch`, so is everything under it. `Flowers` takes the automatic colour of the second branch.
- `Vegetables` has two lines of words under it. `Tomatoes` has a note and a note on the line from `Vegetables`, and its drawing (the notebook `tomatoes.book`) stands on the left of its words.
- `Cherry` has two tasks, one done.
- `Flowers` has a photo on its left and is drawn at the size of a level-3 heading.
- The map's board is the notebook `garden-board.book`.

`assets/tomatoes.book/book.json`:

```json
{
  "mindroot": "book",
  "version": 1,
  "mode": "pages",
  "paper": {
    "type": "grid-5"
  },
  "size": {
    "id": "a5",
    "w": 148,
    "h": 210,
    "orientation": "portrait"
  },
  "background": "auto",
  "backgroundImage": null,
  "pages": [
    {
      "file": "001.ink.svg"
    }
  ]
}
```

`assets/tomatoes.book/001.ink.svg` (one stroke in the semantic ink, the 5 mm grid elided):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 559.37 793.7" width="559.37" height="793.7" data-mindroot-ink="1"><metadata id="mindroot-ink">{"v":1,"elements":[{"id":"k3x9a1","type":"stroke","pen":"pen","color":"ink","size":3,"opacity":1,"thinning":0.6,"smoothing":0.5,"streamline":0.5,"cap":true,"blend":"normal","sim":true,"points":[[120,200],[140,206.5],[171.25,214]]}],"page":{"w":559.37,"h":793.7}}</metadata><g class="mr-paper" aria-hidden="true" pointer-events="none"><rect class="mr-sheet" x="0" y="0" width="559.37" height="793.7" fill="#fbfaf7"/>...</g><path d="M120.4 198.6..." fill="#15171c" class="mr-ink"/></svg>
```

`snapshots/snapshots.json`:

```json
[
  {
    "file": "garden--2026-10-07-0930.md",
    "kind": "auto",
    "label": "",
    "when": "2026-10-07T07:30:12.000Z"
  }
]
```

(The file name says 09:30: the machine that wrote it was two hours ahead of UTC.)

`trash/trash.json`, with `trash/2026-10-07-0941-herbs.md` holding the branch's lines (`## Herbs <!-- side: left -->`):

```json
[
  {
    "kind": "branch",
    "label": "Herbs",
    "when": "2026-10-07T07:41:03.000Z",
    "file": "2026-10-07-0941-herbs.md",
    "map": "garden.md",
    "mapName": "Garden",
    "shape": {
      "kind": "heading",
      "level": 2,
      "indent": 0,
      "label": "Herbs"
    },
    "origin": {
      "parent": "",
      "index": 2,
      "lineage": [
        "Garden"
      ]
    },
    "assets": {}
  }
]
```

To build this project by hand, the minimum is the folder with `garden.md`; MindRoot fills in the rest (names from file names, times from the import, default notebook settings) the first time it reads it.
