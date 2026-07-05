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

- `countries-110m.json` (world-atlas, CDN) → GeoJSON features whose `f.id` is the numeric code. These are the map polygons.
- `countries.js` → `window.COUNTRY_DATA[code]` = `{ ja, region }`. **Only countries present here are rendered and quizzed** — `buildFeatures` filters out any feature lacking a `COUNTRY_DATA` entry. So adding a country to the quiz = adding its padded numeric code to `countries.js`.
- `explanations.js` → `window.COUNTRY_INFO[code]` = `{ cap, note }`, used only by the explanation panel (解説モード) after each answer. Optional; missing entries degrade gracefully.

Region keys (`asia`, `europe`, `africa`, `north_america`, `south_america`, `oceania`, `other`) are defined in `countries.js` and labeled via `REGION_LABEL` in `app.js`; they drive both the region chips on the setup screen and pool filtering.

**Quiz flow:** setup screen collects `state.settings` (mode / region / count / explain) → `buildPool` filters features by region → `startQuiz` shuffles and slices to `count` → `nextQuestion` dispatches to one of two modes:

- **find** (`地図で探す`): show a name, user taps the country polygon (`onCountryClick`).
- **name** (`名前を選ぶ`): highlight a country, user picks from 4 choices — the correct one plus 3 distractors drawn from the same pool (`askName`).

Both converge on `finishTurn`, which either shows the explanation panel (when explain is on) or auto-advances after a delay.

**Map rendering** uses D3 `geoNaturalEarth1` projected onto an HTML `<canvas>` (`#map`), redrawn every frame by `render()` — there are no per-country DOM nodes. `d3.zoom` on the canvas stores the transform in `state.transform`; `render()` clears, applies `dpr`+zoom to the context, batches all unmarked countries into one fill/stroke, then draws the few "marked" countries (`state.marks`: id → `target`/`correct`/`wrong`) on top. Country colors are pulled from the CSS `:root` tokens once via `readColors()` (single source of truth). The name-mode pulse is a `requestAnimationFrame` loop (`startPulse`/`stopPulse`); strokes are skipped while `state.panning` for cheaper drag frames. `fitToFeatures` reframes the projection to a set of features (whole world for "all", the region's polygons otherwise); `focusFeature` zoom-pans to a single country.

**Click hit-testing** (`featureAt`, used by find mode and browse) has no DOM targets. It is pixel-exact: for each feature it rebuilds the path under the *same* `dpr`+zoom transform used by `render()` and tests the pointer with `ctx.isPointInPath(mx*dpr, my*dpr)` (backing-store px). This deliberately avoids `projection.invert` + `d3.geoContains`, whose iterative inverse and great-circle edges disagree with the rendered straight-segment borders by a pixel or two (that mismatch was a real off-by-a-bit tap bug).

**Regions** come in two layers: the 7 coarse continents live in `countries.js` (`region` field), while finer sub-regions (東南アジア, 東ヨーロッパ, 北アフリカ, カリブ, …) are defined in `app.js` as `SUBREGIONS` — keyed by sets of ISO numeric codes so `countries.js` stays untouched. `inRegion(f, r)` resolves either layer; the setup screen groups the chips by continent.

**Browse/study mode** (`state.browsing`, mode `browse`) is a non-quiz view: `startBrowse` shows the region's map with country-name labels drawn on the canvas (`buildLabels` precomputes centroids/widths per fit; `render()` draws them unscaled in screen space, hiding labels for countries too small at the current zoom). Tapping a country (`showBrowseDetail`) reuses the explanation panel to show capital + blurb.

**Offline:** `sw.js` caches the app shell + CDN libs on install (local assets must all succeed; CDN cached best-effort), then serves cache-first with a navigation fallback to `index.html`.

## Notes

- `countries.js` and `explanations.js` are marked "auto-generated" from `gen_countries.py` / `gen_icons.py`, but those generator scripts are **not in the repo** — edit the `.js` data files directly.
- Deploy target is GitHub Pages with `index.html` at repo root (see README).
- To increase border detail, swap `countries-110m.json` for `countries-50m.json` in both `app.js` (`WORLD_URL`) and `sw.js`.
