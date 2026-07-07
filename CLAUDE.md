# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Japanese-language PWA quiz for learning world countries' positions and names on a blank map (白地図クイズ). Pure static site — vanilla JS, no build step, no package manager, no bundler, no tests. D3 and TopoJSON are pulled from CDN at runtime.

## Running / developing

Service Workers do not run over `file://`, so serve over HTTP:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

There is no build, lint, or test tooling. Edit the files and reload the browser.

**When changing any local asset, bump the cache version** `CACHE = "worldquiz-vN"` in `sw.js` — otherwise returning users keep the old cached files (the SW serves cache-first). Also add any new local file to the `LOCAL_ASSETS` array in `sw.js`, and any new CDN URL to both `CDN_ASSETS` (sw.js) and the `<script>` tags / fetch URL in the app.

## Architecture

Everything is driven by `app.js`, one IIFE holding a single `state` object. There is no framework and no routing — the UI is a stack of full-screen `<section>`/overlay elements in `index.html` that are shown/hidden by toggling their `hidden` attribute (see `showSetup`, `startQuiz`, `nextQuestion`, `endQuiz`).

**Data joins on ISO 3166-1 numeric country codes**, zero-padded to 3 digits (`pad3`). This is the linchpin connecting three sources:

- `countries-50m.json` (world-atlas, CDN) → GeoJSON features whose `f.id` is the numeric code. These are the map polygons. (The higher-detail 50m data is used so small island nations have polygons; drop to `countries-110m.json` for lighter borders.)
- `countries.js` → `window.COUNTRY_DATA[code]` = `{ ja, region }`. **Only countries present here are rendered and quizzed** — `buildFeatures` filters out any feature lacking a `COUNTRY_DATA` entry. So adding a country to the quiz = adding its padded numeric code to `countries.js`.
- `explanations.js` → `window.COUNTRY_INFO[code]` = `{ cap, note }`, used only by the explanation panel (解説モード) after each answer. Optional; missing entries degrade gracefully.

Region keys (`asia`, `europe`, `africa`, `north_america`, `south_america`, `oceania`, `other`) are defined in `countries.js` and labeled via `REGION_LABEL` in `app.js`; they drive both the region chips on the setup screen and pool filtering.

**Quiz flow:** setup screen collects `state.settings` (mode / region / count / explain) → `buildPool` filters features by region → `startQuiz` shuffles and slices to `count` → `nextQuestion` dispatches to one of two modes:

- **find** (`地図で探す`): show a name, user taps the country polygon (`onCountryClick`).
- **name** (`名前を選ぶ`): highlight a country, user picks from 4 choices — the correct one plus 3 distractors drawn from the same pool (`askName`).

Both converge on `finishTurn`, which either shows the explanation panel (when explain is on) or auto-advances after a delay.

**Map rendering** uses D3 `geoNaturalEarth1` projected onto an HTML `<canvas>` (`#map`) — there are no per-country DOM nodes. **The projection only changes when the map is re-framed** (fit/resize), so pan/zoom is pure `ctx`-transform work, never reprojection. `buildPaths()` reprojects every country once per fit into a **Path2D cache**: `paths` (id → Path2D), `landPath` (all countries in one Path2D for the batched fill/stroke), and `boundsMap` (id → projected bbox, for culling). It uses a **separate** `pathGen = d3.geoPath(projection)` so the `ctx`-bound `geoPath` (kept only for `centroid`/`bounds`/`area`) is never repointed at a Path2D. `buildPaths()` must be called after every `projection.fitExtent` — i.e. in `fitToFeatures` and `syncSizeNow`, the only two places the projection changes.

`render()` clears, applies `dpr`+zoom to the context, then: (1) fills/strokes the land — one `ctx.fill(landPath)`+`ctx.stroke(landPath)` near the world view, or per-country culled draws when `t.k > 1.2` (only countries whose `boundsMap` bbox meets the viewport, via `onScreen`); in 成績マップ mode (`state.paint`) it fills each country with its bucket color and strokes `landPath` once. (2) Overpaints the few "marked" countries (`state.marks`: id → `target`/`correct`/`wrong`/`hi`) opaquely on top. **Marked countries stay inside `landPath`** — the overpaint is opaque, so `landPath` never depends on `state.marks` and needs no per-answer rebuild. (3) Draws browse labels unscaled in screen space. **The per-country fill-color decision (mark > 成績マップ bucket > land) lives in one place, `countryFill(id)`, and the per-country fill+stroke in `drawCountry(id, strokeW)`** — used by both the culled `render()` passes and `blit()`'s exposed-ring draw so the two can't diverge. (The batched `landPath` fill/stroke near the world view is the only non-`drawCountry` land path, and it's plain land color with marks overpainted on top.) `d3.zoom` stores the transform in `state.transform`; the name-mode pulse is a `requestAnimationFrame` loop (`startPulse`/`stopPulse`, cheap because culling kicks in when zoomed). Colors come from the CSS `:root` tokens via `readColors()`. Backing-store `dpr` is capped at 2 (`deviceRatio()`) so 3x phones don't render 2.25× the pixels for no visible gain. `fitToFeatures` reframes the projection to a set of features; `focusFeature` zoom-pans to a single country.

**Gesture blitting (`blit`)**: re-rendering all polygons every frame of a pan/pinch was the mobile bottleneck, so during a gesture the last sharp frame is *transformed*, not redrawn. On zoom `"start"` (with `sourceEvent`), `captureSnap()` copies the live canvas into an offscreen buffer plus the transform it was taken at (`snap.t0`); the live canvas is always sharp there because every gesture ends with a `render()`. The zoom handler blits while `gesturing` (`!!ev.sourceEvent || fling.raf` — fling steps are programmatic, so `fling.raf` is the tell) and `snap` is valid; otherwise it does a full `render()`. `blit()` maps the snapshot to the live view with `r = t.k/t0.k`, `offset = t − r·t0` (derivation in the code). Because the snapshot only holds what was on screen when it was taken, panning/pinch-out reveals areas that were captured off-screen; leaving them blank until the gesture ends was a visible ~2 s lag, so `blit()` also **live-draws the exposed region every frame**. It computes the snapshot's on-screen coverage rect R: if R fully covers the viewport (px guard) it just transfers; if coverage drops below 50% (fast fling / big pinch-out) it re-anchors with a sharp `render()` + fresh `captureSnap()` for that one frame; otherwise it transfers, then draws `viewport − R` (an `evenodd` `Path2D` clip of the viewport ⊕ R) using the same `drawCountry`/`onScreen` code `render()` uses — so revealed land, mastery paint, and answer marks all match exactly. The gesture always terminates on a sharp `render()`: `startFling()` renders when it declines to glide, and the fling loop renders once the glide settles. `snap` is nulled whenever the backing store resizes (`resizeCanvas`/`syncSizeNow`). Accepted artifacts (cleared by the next `render`): pinch scaling is momentarily soft, and browse labels aren't drawn in the exposed ring (they stretch with the map inside R and reappear on the next `render`).

**Click hit-testing** (`featureAt`, used by find mode and browse) has no DOM targets. It is pixel-exact: it tests the pointer against the **same cached Path2D** objects `render()` draws, under the *same* `dpr`+zoom transform, with `ctx.isPointInPath(paths.get(id), mx*dpr, my*dpr)` (backing-store px). A near-miss fallback strokes each path with a fat pen (`lineWidth = 16/t.k`, a constant ~8 CSS px) and uses `ctx.isPointInStroke`, picking the smallest-area country so tiny islands beat big neighbours. This deliberately avoids `projection.invert` + `d3.geoContains`, whose iterative inverse and great-circle edges disagree with the rendered straight-segment borders by a pixel or two (that mismatch was a real off-by-a-bit tap bug).

**Regions** come in two layers: the 7 coarse continents live in `countries.js` (`region` field), while finer sub-regions (東南アジア, 東ヨーロッパ, 北アフリカ, カリブ, …) are defined in `app.js` as `SUBREGIONS` — keyed by sets of ISO numeric codes so `countries.js` stays untouched. `inRegion(f, r)` resolves either layer; the setup screen groups the chips by continent.

**Browse/study mode** (`state.browsing`, mode `browse`) is a non-quiz view: `startBrowse` shows the region's map with country-name labels drawn on the canvas (`buildLabels` precomputes centroids/widths per fit; `render()` draws them unscaled in screen space, hiding labels for countries too small at the current zoom). Tapping a country (`showBrowseDetail`) reuses the explanation panel to show capital + blurb.

**Offline:** `sw.js` caches the app shell + CDN libs on install (local assets must all succeed; CDN cached best-effort), then serves cache-first with a navigation fallback to `index.html`.

## Notes

- `countries.js` and `explanations.js` are marked "auto-generated" from `gen_countries.py` / `gen_icons.py`, but those generator scripts are **not in the repo** — edit the `.js` data files directly.
- Deploy target is GitHub Pages with `index.html` at repo root (see README).
- The map uses `countries-50m.json`. To trade detail for a smaller download, swap it for `countries-110m.json` in both `app.js` (`WORLD_URL`) and `sw.js` (note: 110m omits polygons for several small island nations, which would then not render).
