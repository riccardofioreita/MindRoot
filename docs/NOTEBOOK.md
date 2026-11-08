# Notebooks: the board and node drawings become notebooks

This file is the contract for notebooks; `docs/ARCHITECTURE.md` stays the contract for everything else.

## What the person gets

1. **The map's board is a second view of the map**, not a side window. A segmented control **Map | Board** sits in the top bar, to the left of the search button (on phones in the top capsule). Shortcut `Mod+Shift+L`. The chosen view is remembered per map (`store.setMapView`). In the Board view the notebook fills the stage where the map was; the sidebar, top bar and undo stay.
2. **Node drawings are notebooks too**, with all the same features, but they keep opening in the viewer with its three placements (beside the map, full, card) as today. Only node drawings have those placements; the board is always the full-stage view.
3. **Every notebook has its own settings** (a sheet opened from the notebook toolbar):
   - **Mode:** Infinite (default: unbounded canvases, the paper pattern tiles forever, one canvas shown at a time; see 7) or Pages (fixed-size pages stacked vertically).
   - **Paper** (one for the whole notebook), from the catalogue below, or an imported SVG/PNG/JPG background.
   - **Size** (pages mode): A3, A4, A5, A6, B5, Letter, Legal, square, 16:9, 4:3, iPad, custom in mm; portrait or landscape.
   - **Background colour:** `Automatic` (default, follows the app theme: light paper in the light theme, dark paper in the dark theme) or a chosen colour.
   - **Applies to** (infinite mode): `Whole notebook` or `This canvas (n)`. On a canvas, the paper and the background chosen are that canvas's own; the others keep the notebook's. A catalogue paper only (a picture is the notebook's). `Use the notebook's` gives the canvas's own up. Pages mode has one paper for all its pages (a canvas's own look is kept in the file, ignored there, and back when the notebook is infinite again).
   - **What a new notebook starts on** is an app setting (Settings, *Notebooks*: paper and background, prefs `notebook`); a notebook keeps its own once it is written.
4. **Ink adapts.** The default ink colour is the semantic colour `ink`: dark on light paper, light on dark paper. Every other colour is literal.
5. **Pages** (pages mode): continuous vertical scrolling; a GoodNotes-style **page rail at the side** (a slim scrollbar with page ticks and a "page n of N" bubble while scrolling; tapping it opens page thumbnails) where pages are added, duplicated, deleted (to the project trash, restorable), and reordered by dragging. On phones the thumbnails open in a bottom sheet.
6. **Export, at the person's choice:** PDF of the whole notebook (every page at its own size, through the browser's print engine, offline, vector) or PNG of the current page; in infinite mode a PDF with one page per canvas, each cropped to its drawn area (empty canvases left out; when all are empty, the first), or a PNG of the canvas shown (its drawn area). Paper light/dark choice, light by default.
7. **Canvases** (infinite mode): an infinite notebook holds several unbounded canvases, managed exactly like pages - the thumbnails (opened from the notebook's Canvases button or the rail; a bottom sheet on phones), add, duplicate, delete (to the project trash, restorable where it stood), reorder by dragging, one undo step each. Only one canvas is shown at a time; they never stack. A tap on a thumbnail, Page Down / Page Up on the sheet, or the side rail switches canvas. The rail shows from two canvases on: one equal stretch per canvas with the handle on the canvas shown and the "n / N" bubble; a press on a stretch shows that canvas, dragging the handle walks the canvases under it, a swipe along the rail off the handle shows the next canvas (down) or the one before (up), a tap on the handle opens the thumbnails; with the keyboard the arrows, Home and End. Each canvas remembers its own camera (pan and zoom) for the session and in the per-map view state, with the canvas shown last, so the notebook reopens (also after a reload) on the canvas left, under its camera; a camera recalled from an earlier opening that would show none of the drawing (another screen) gives way to a fit.

## Paper catalogue (grouped by field)

| Group | Papers |
| --- | --- |
| Basic | Blank, Dots, Grid 4 mm / 5 mm / 10 mm, Narrow / normal / wide ruled, Ruled with margin |
| School | Year 1 and Year 2 lines (the Italian primary-school rulings A and B), Cornell, Two columns (languages) |
| Maths and science | Millimetre graph, Semi-log, Log-log, Polar, Isometric, Honeycomb, Cartesian axes |
| Music | Music staff, Grand staff (piano), Guitar tab |
| Design | 8 pt grid, Phone wireframe, Browser wireframe, Storyboard |
| Planning | Weekly planner, To-do list |
| Calligraphy | Slanted guide lines |
| Import | SVG, PNG or JPG as background (stored in the notebook folder) |

The labels are the English ones of `js/features/paper.js`; it carries the Italian ones too.

PDF backgrounds are out of scope (they would need pdf.js); a later lazy-loaded addition.

## Files

A notebook is a folder in the project's files:

```
assets/<slug>.book/
  book.json
  001.ink.svg
  002.ink.svg
  background.svg          (only when a background was imported; or .png/.jpg)
```

`book.json`:

```json
{
  "mindroot": "book", "version": 1,
  "mode": "infinite",
  "paper": { "type": "dots" },
  "size": { "id": "a4", "w": 210, "h": 297, "orientation": "portrait" },
  "background": "auto",
  "backgroundImage": null,
  "pages": [ { "file": "001.ink.svg" }, { "file": "002.ink.svg" } ],
  "looks": { "002.ink.svg": { "paper": { "type": "grid-10" }, "background": "#f6f0e1" } }
}
```

- `looks` (optional): a canvas's own paper and/or background, by page file; whatever a canvas leaves out is the notebook's. Kept apart from `pages` so that adding, moving, copying (the copy keeps it) and deleting canvases never loses it; an entry of a canvas that is gone is dropped, unless the canvas is in the trash (`trashed`). `paper.type: "image"` is never a canvas's paper.

- Sizes in millimetres; on screen 1 mm = 96/25.4 px.
- In infinite mode each canvas is a page file exactly like a page: `book.json` keeps `"mode": "infinite"` with its `pages[]`, in canvas order, so the format is the same in both modes (a notebook made before canvases, with one page or with pages kept from pages mode, opens with each page as a canvas; a lone `*.ink.svg` is one canvas). Switching modes keeps every page: each canvas becomes a page (its drawing moved onto the page when it lay outside it) and each page a canvas.
- The Markdown points at the **first page file**: a node drawing is `![](assets/x.book/001.ink.svg)`, the board marker is `<!-- board: assets/<map>-board.book/001.ink.svg -->` (a board made by an earlier version may be `<map>-lavagna.book`: the marker names the folder, so it opens as it is). So Obsidian and any Markdown viewer show the cover where it belongs. When pages are reordered so that another page becomes first, the reference in the Markdown is rewritten in the same undo step.
- Every page file is a self-contained `.ink.svg` (the scene in `<metadata id="mindroot-ink">`, as today), drawn with the light paper and literal colours so it reads correctly anywhere; the semantic ink colour and the automatic background are marked with classes (`mr-ink`, `mr-sheet`) so the app can show them themed.
- An empty notebook is never written. A new notebook (a node's drawing, a map's board) exists only from its first stroke: settings, pages added, moved or removed before it are held by the view (and for the next opening of the same drawing or board in the session) and become part of the step the first stroke makes. A picture chosen as the paper is content and writes at once. A node notebook closed with nothing on any page (every stroke erased, or one written empty by an earlier version) goes to the trash as one step, with an Undo toast.
- Old drawings: a lone `*.ink.svg` or `*.excalidraw.svg` opens as a one-page notebook with default settings; the first change that needs `book.json` (settings, a second page) moves it into a `.book/` folder and rewrites the reference (one undo step). Nothing is converted just by opening.
- Folder files ride with ZIP/JSON export and import unchanged (they are ordinary project files); trash entries for deleted pages hold the page file.

## Modules

- `js/features/paper.js` (`ns.paper`): the catalogue, page sizes, pattern rendering, theme colours, background import. Pure functions returning SVG markup; no app state.
  - `CATALOG` `[{ group, id, label, params }]`, `SIZES` `[{ id, w, h, label }]`, `MM` (px per mm)
  - `pageSize(size)` → `{ w, h }` px, honouring orientation and custom sizes
  - `patternSvg(paper, { w, h, x, y, theme, colors })` → SVG fragment string drawing the paper over a rectangle in page px (for infinite mode the caller asks for the visible rectangle; patterns are anchored to the origin so tiles line up)
  - `colors(theme, background)` → `{ sheet, line, strongLine, margin, ink }`
  - `themeSvg(svgText, theme, background)` → page SVG text with `mr-ink` / `mr-sheet` recoloured for display
  - `importBackground(file)` → `Promise<{ name, type, bytes, w, h }>` (SVG sanitised: no scripts, no external references, no event attributes)
- `js/features/notebook.js` (`ns.notebook`): model, storage glue, the notebook view (pages, rail, thumbnails, settings sheet, export), hosting one `ns.ink` editor per page (lazy: only the page being drawn on is a live editor; the others are rendered SVG).
  - `open(host, { projectId, mapId, ref, kind: 'board'|'node', nodePath, readOnly, onClose })` → view `{ close(), flush(), isDirty(), page(), goTo(n) }` (in infinite mode `page()` is the canvas shown and `goTo(n)` shows canvas n)
  - `read(projectId, ref)` → `Promise<book>`; `write(...)` through the store (one labelled undo step per gesture pause per page, keyed `ink:<file>`)
  - `exportPdf(book, opts)`, `exportPng(book, page, opts)` (`page` is a page or a canvas); each canvas is exported on its own paper
  - `setCanvasLook(n, {paper | background | reset})`, `model.lookOf(meta, file)`, `model.metaFor(meta, file)` (the notebook as a canvas sees it), `model.appLook()` (what new notebooks start on)
  - The canvas shown and the cameras of an infinite notebook's canvases live in the per-map view state: `store.setMapView(pid, mapId, { notebooks: { '<folder or lone file>': { at: '<page file>', cams: { '<page file>': { x, y, k } } } } })`, outside the history, bounded by the store (40 notebooks a map, 200 cameras a notebook); notebook.js reads and writes its own entry whole: a moment after the camera rests or a canvas is shown, and at once when the app hands everything over (the bus 'flush': Mod+S, the page hidden or going away), so a reload right after a switch finds it.
  - On an infinite board the rail lies over the drawing (the canvas runs to the edge): only a narrow band round its line and its handle takes a press, the rest of its strip is drawing surface.
- `js/features/ink.js`: gains page bounds (pages mode: draw clipped to the page, rulers off), the paper layer underneath (from `ns.paper`), the semantic `ink` colour, background colour, and an option to use a toolbar shared by several page editors.
- `js/features/media.js`: node drawings open `ns.notebook` inside the viewer (three placements unchanged); the board no longer opens in the viewer.
- Board view switch: the top-bar segmented control, `Mod+Shift+L`, and the stage swap (map ↔ notebook) belong to `js/features/notebook.js` (it registers the `view.board` command and mounts into `#stage`); `js/app.js` / `js/core/ui.js` only expose the slot.

## Laser pointer

The pen has a laser mode (`js/features/ink.js`): the button beside the pen in the wide layout (it takes the pen with the laser on) or Ink | Laser in the pen's options (both layouts). With it on, a pen gesture records screen points in a trail drawn on a layer of its own above the sheet (`.ink__laser`, an SVG with a glow, a core and a dot); points older than 700 ms fall off, so the trail fades from behind and is gone within a second of the pen lifting. Nothing is ever made of it: no element, no draft, nothing dirty, no undo step, nothing saved. Another tool, read-only and closing the editor turn it off. The state lives in the editor only (`data-laser` on the editor's root); it is not a preference.
