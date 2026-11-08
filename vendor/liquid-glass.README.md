# liquid-glass (vanilla)

A framework-free port of [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) (MIT, Copyright 2025 Max Rovensky); the `shader` displacement map is adapted from [shuding/liquid-glass](https://github.com/shuding/liquid-glass).
Same engine as the original: an SVG filter with per-channel displacement (chromatic aberration), four refraction modes, blur and saturation, edges that follow the mouse, and elasticity.

## Files

- `liquid-glass.iife.js`: the library, for a plain `<script>` tag (it sets `window.LiquidGlass`).
- `liquid-glass.LICENSE`: the original MIT licence, which must stay with any derived copy.

## How MindRoot uses it

Only as an optional decoration of the top bar and the welcome card. MindRoot loads the script on demand (see `ns.glass` in `js/core/ui.js`) and only when the "Liquid glass effect" setting is on, in a Chromium browser with a mouse, and without reduced motion, reduced transparency or high contrast. Everywhere else the plain CSS design is used and this file is never fetched.

## Usage

```js
const glass = LiquidGlass.create("#card", { cornerRadius: 32, padding: "24px" })
glass.update({ mode: "shader", displacementScale: 90 })
glass.destroy()
```

`create(target, options)` wraps the element (a selector or a node) and moves it inside the glass; `destroy()` puts it back where it was.
`LiquidGlass.createAll(selector, options)` does the same for several elements.

### Positioning

- **In the flow** (the default): the glass behaves like an `inline-block`. Pass `rootStyle` to change that (for example `{ display: "block", width: "100%" }`).
- **Fixed or absolute**: pass `rootStyle: { position: "fixed", top: "50%", left: "50%" }` and `baseTransform: "translate(-50%, -50%)"`. The positioning is copied onto every layer, as in the original.

## Options

The options of the React version, with the same defaults:

| Option | Default | Notes |
| --- | --- | --- |
| `displacementScale` | `70` | strength of the refraction |
| `blurAmount` | `0.0625` | blur (frosting) |
| `saturation` | `140` | |
| `aberrationIntensity` | `2` | chromatic aberration |
| `elasticity` | `0.15` | 0 means rigid |
| `cornerRadius` | `999` | px |
| `padding` | `"24px 32px"` | |
| `overLight` | `false` | for light backgrounds |
| `mode` | `"standard"` | `standard`, `polar`, `prominent`, `shader` |
| `mouseContainer` | the glass itself | element or selector whose mouse movements are followed |
| `globalMousePos`, `mouseOffset` | | manual control of the mouse position (both are needed) |
| `onClick` | | enables the pointer cursor and the hover and press effects |

Added compared with the React version: `className`, `rootStyle`, `contentStyle`, `baseTransform` (they replace `className`/`style` and the Tailwind classes of the original).

## Compatibility

As with the original: the full effect only in Chromium. Safari shows no visible distortion. Firefox gets blur and edges only (the SVG filter is turned off).

## Differences from the original

- No React and no Tailwind: every style is inline.
- Sizes are read from the layout (not from the transformed rectangle), so elasticity does not feed back into the centre computation.
- The `shader` mode caps its map at about 400k pixels and rebuilds it (debounced) on resize.
- Releasing the mouse outside the glass still clears the "pressed" state.
- The SVG filter is created once and updated in place; `feImage` has no duplicate ids.

## Technical note

The layers with `mix-blend-mode` (edges, hover, overLight) must sit **outside** the stacking context that holds the glass. Otherwise Chromium isolates the group and `backdrop-filter` no longer sees the background, and the effect disappears. That is why the DOM is laid out as in the original: the glass stack on its own, with the blend layers as its siblings.
