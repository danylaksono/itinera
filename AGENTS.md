# AGENTS.md — Itinera

Handover notes for the coding agent that continues this project on the owner's machine.
Read all of this file before you change code.

## 1. What Itinera is

Itinera is a web app that reads a Google Maps Timeline export and shows it as linked,
interactive views for geovisual analytics. It is like the popular "upload your timeline,
see an animation" sites, but it is for data exploration: linked charts, maps, sliders,
sparklines and a playback animation that give insight.

The owner's original brief (keep to it):

- All processing happens in the browser. No data leaves the page. There is no server.
- Linked charts, interactive maps, sliders, sparklines and animation.
- Support more than one timeline (more than one device). The user can combine them, or
  show each device with its own symbology.
- Stack: plain JS, MapLibre GL, D3, three.js, anime.js, Turf.
- Be creative. Avoid generic dashboard design.

The owner is a geovisual analytics researcher. Correct cartography and honest encodings
are more important than decoration.

## 2. Hard constraints

The final product is **one self-contained HTML file** (`dist/itinera.html`). The owner
publishes it as a Claude artifact, so it must obey these rules. If you break them, the
page publishes but does not work:

- External scripts can load **only** from `https://cdn.jsdelivr.net/npm/`,
  `https://cdnjs.cloudflare.com`, `https://cdn.tailwindcss.com`, `https://code.jquery.com`.
  Use exact pinned versions of UMD builds.
- External stylesheets can load only from `https://fonts.googleapis.com` (font files from
  `fonts.gstatic.com`). All other CSS must be inline. The MapLibre CSS is inlined by the build.
- No other network requests: no remote tiles, no remote images, no `fetch` to other sites.
  The world basemap is embedded (world-atlas `countries-50m`, about 0.75 MB).
- The file must stay under 16 MB.
- `localStorage` works but can be empty. Always wrap it in `try/catch`.
- Downloads: use `await window.claude?.use?.('downloads')` then `dl.save({ filename, data })`.
  The allowlist includes `.json` but not `.geojson`, so export GeoJSON with a `.json` name.
  Keep the Blob-link fallback for when the capability is `null` (for example, a local file).
- Theme: the viewer can set `data-theme="light|dark"` on `<html>`. The page also follows
  `prefers-color-scheme`. `applyTheme()` in `g_main.js` writes `data-dark="1|0"`, and all
  JS colour code reads `isDark()`.
- Keep the safe-area CSS and the viewport meta tag in `template.html`.

## 3. Repository layout

```
package.json        pinned library versions (dev dependencies) and npm scripts
build.py            assembles src/ into dist/itinera.html (prod) or dist/itinera.test.html (test)
src/template.html   all HTML and CSS; placeholders /*MAPLIBRE_CSS*/ <!--SCRIPTS--> /*WORLD*/ /*GAZ*/ /*APP*/
tools/gazetteer.js  prints the compact town list (GeoNames, population >= 15,000) that build.py inlines as GAZ
src/a_data.js       utilities, file parsers, stay and trip detection, finalize(), file loading
src/b_analytics.js  global state S, colours, places and roles, filters, compute(), co-location
src/c_map.js        MapLibre map, layers, tooltips, legend, playback engine
src/d_charts.js     KPIs, timeline, calendar, weekly rhythm, modes, places, filter chips, sources bar
src/e_cube.js       space-time cube (three.js), exposed as the Cube module
src/f_sample.js     makeSample(): synthetic Lisbon year, emitted in three real export formats
src/g_main.js       refresh loop, ingest, busy overlay, export, theme, landing hero, UI bindings
tests/common.py     Playwright helpers (software WebGL flags, sample loading)
tests/smoke.py      loads the sample, checks key numbers, exits 1 on failure
tests/shots.py      screenshots of the main states into tests/out/
```

There is no bundler and no module system. The build concatenates `src/a_*.js` to `src/g_*.js`
**in file-name order** into one `<script>`. All files share one top-level scope, and
`a_data.js` begins with `'use strict'`. A new file needs a letter prefix in the correct order.
A later file can call functions from an earlier file at load time. An earlier file can call
functions from a later file only at run time (for example, `d_charts.js` calls `refresh()`).

## 4. Set up, build and test

```bash
npm install                                  # libraries go to node_modules; only the build uses them
pip install playwright && python3 -m playwright install chromium
npm run check                                # node --check on every src file
npm run build:test                           # dist/itinera.test.html (loads libs from ../node_modules)
npm test                                     # check + test build + tests/smoke.py
npm run shots                                # screenshots, light and dark, into tests/out/
npm run build                                # dist/itinera.html (CDN scripts) = the file to publish
```

- To open the test build by hand, serve the project root (`python3 -m http.server`) and
  open `/dist/itinera.test.html`. Some browsers block `file://` script loads.
- Headless WebGL is software rendered (SwiftShader). It is slow. MapLibre start-up takes
  about 4 s there. On a real GPU it is fast. Do not tune performance from headless timings.
- In a sandbox without internet, Google Fonts fails with a 403 error. That error is
  harmless. The font stack falls back to system fonts.
- After a visual change, run `npm run shots` and **look at the PNG files**. Many faults in
  this project are visual only (see section 9).
- Set `CHROME=/path/to/chrome` to use a specific browser binary.

## 5. Architecture

### Data flow

```
files -> loadFiles() -> detectAndParse() -> raw sources  (points P{t,lat,lon,acc,off}, visits[], trips[])
      -> finalize(raw, id) -> source {id,name,kind,files,raw,T,LA,LO,OF,visits,trips,t0,t1,derivedVisits,derivedTrips,colorIdx}
      -> S.sources[]   (combined mode: S.merged = finalize(combinedRaw(visible), 1000, {merge:true}))
      -> buildContext() -> S.ctx  (places, home/work, day/month/week indices, coverage, moving intervals)
      -> compute()      -> S.res  (filtered aggregates for every view)
      -> render*() and updateMap() and Cube
```

- `T, LA, LO` are `Float64Array`, and `OF` is `Int16Array`: the UTC offset in minutes for each
  record. All "local" values (hour, day, weekday) use the offset of the record, not the
  browser time zone. This is necessary for trips that cross time zones (Barcelona in the sample).
- A visit (stay) has `{t0,t1,lat,lon,pid,name,type,off,src,dur,place, day,hod,h,dow,mon,wk}`.
- A trip has `{t0,t1,lat0,lon0,lat1,lon1,dist,dur,mode,rawMode,inferred,path:[[t,lat,lon]...],off,src,from,to, day,hod,h,dow,mon,wk}`.
  `mode` is one of `walk, cycle, road, transit, flight, other` (see `modeGroup()` and `MODES`).
  Flights get a great-circle path and a dashed line.
- If a source has no stays, `detectStays()` finds them (150 m, 15 min, split at record gaps
  over 6 h). If it has no trips, `finalize()` makes trips from records outside stays (split at
  gaps over 20 min), plus straight visit-to-visit jumps. GPX `<trk><type>` sets the mode.
- `finalize()` drops "trips" of over 2 h at under 1 km/h. They are gaps in the record, and
  `src.gapTrips` counts them. Real exports have many of these, and they flattened the rhythm.
- Places: stays are clustered by `placeId`, or on a 160 m grid. Home changes over time.
  `homePeriods()` picks, for each local month, the place with the most night hours
  (00:00–06:00), with Google `HOME` visits weighted 1.5×. It merges short detours and gaps
  between the same home, and it never bridges long gaps. The result is
  `ctx.homes = [{place, t0, t1, labelled}]`, with `homeAt(t)`, `ctx.homeByDay`,
  `ctx.homeSet`, and `ctx.home` for the latest home. Every home-based value (time at home,
  farthest from home, the cube, "Home area") uses the home of that time. Work is still one
  place: the Google `WORK` label, or else the place with the most weekday time from 09:00
  to 17:00. Inferred roles show "inferred" or "?" in the UI.
- Unnamed places are labelled with `nearTown()`: the nearest GeoNames town within 30 km,
  from the inlined `GAZ`, with no network. The user can rename places. Names are kept in
  `localStorage['itinera-names']` and keyed by rounded coordinates.
- `M.bounds` in `c_map.js` is the map view the user chose. A hidden map (cube view) reports a
  400×300 fallback canvas, so the cube floor and view switches use `viewBounds()` and
  `restoreView()`, never a bare `map.getBounds()`.

### Supported inputs (`detectAndParse`)

- Android on-device `Timeline.json` (`semanticSegments`, `rawSignals`, `userLocationProfile`).
- iPhone `location-history.json` (an array; `geo:` strings; `durationMinutesOffsetFromStartTime`).
- Takeout `Records.json`. It is split into one source per `deviceTag`. `Settings.json`
  (`deviceSettings`) gives the device names, so it is read first.
- Older monthly Semantic Location History files. All the files go into one source.
- GPX tracks, simple GeoJSON (points with time; lines with `coordTimes`).
- A Takeout `.zip` (JSZip) and a dropped folder (`readEntries`).

### Linked filtering

`S.filter = {t0, t1, hours, dows, modes, place}`. `passes(item, except, isTrip)` applies all
filters except the one named, in the crossfilter style: each view ignores its own filter,
so its context stays visible. The timeline and calendar ignore time. The rhythm grid ignores
hours and days. The mode bars ignore modes. The place list uses all filters.

`refresh(from)` merges calls into one per animation frame. When `from` is `'timeline'` or
`'calendar'`, it does not redraw the timeline, so a brush drag is not interrupted. All other
sources redraw everything. Call `refresh()` after each state change. Do not call the render
functions in a chain.

### Map (`c_map.js`)

The style is built in code. It has a background (water), a graticule, land and borders from
the embedded topojson. There are no glyphs or symbol layers, because they need the network.
The data layers are `heat`, `ellipse-*`, `trails`, `trails-fl` (flights, dashed), `flows`,
`places`, `place-hl`, one `tail-<id>` line-gradient layer per device, and `heads`. The
filters are MapLibre expressions made by `baseFilter()`. The optional CARTO street tiles
fail in the published page. `streetsFailed()` then shows a toast. That is expected.

### Playback

`S.play = {on, session, clock, speed, skip, follow}`. `speedRate(v)` is a log scale from
5 min/s to 60 days/s. "Skip time at places" jumps across the gaps between moving intervals
(`S.ctx.moving`). Each frame updates the device heads, the fading tails, the progressive
reveal of trails (throttled to 140 ms), the timeline playhead, the current cell in the
calendar and rhythm grid, and the cube clock plane.

### Space-time cube (`e_cube.js`)

The floor is the current map view (web mercator, longest side = 100 units). The height is
the selected time range (72 units). Trips are `LineSegments` with vertex colours and a
ground shadow. Stays are an `InstancedMesh` of cylinders. Place names and time ticks are
HTML labels projected each frame. The module renders on demand only (on OrbitControls
`change`, clock updates or rebuilds). API: `init, build, schedule, setClock, show, rebuild`.
It must fail gracefully when there is no WebGL or three.js.

### Sample data (`f_sample.js`)

A seeded, synthetic year in Lisbon from 6 Jan 2025 to 27 Feb 2026. It has commutes,
lunches, gym, runs, weekend market, beach and Sintra trips, Porto by train (17 to 21 Apr
2025), Barcelona by air in CET (10 to 15 Sep 2025), Coimbra at Christmas, and a phone gap
from 3 to 11 Nov 2025. It emits:

- `Timeline.json` (Android, "Pixel phone", the whole period; the phone stays home during runs).
- `Records.json` and `Settings.json` ("Work phone", weekdays 07:00–20:00 until 31 Jul 2025; left
  at the office during some lunches).
- `runs.gpx` ("Running watch", runs from 1 Mar 2025).

The sample goes through the real parsers. Keep it that way. It is the regression test for
the parsers. Expected result: 3 sources, about 30 places, Home and Work found, 2 countries,
"Pixel phone and Work phone together 98% of the time".

## 6. Design rules

- The concept is a cool "survey paper" palette. Device colours are historic map inks
  (madder, Prussian blue, viridian, ochre, violet, sepia) in `INKS_L` and `INKS_D`.
  The travel-mode palette is in `MODES`, and the time-of-day palette is in `HOUR_STOPS`.
  The one bold element is the map traces and the playback comet. Keep the rest quiet.
- The font is Archivo (variable width). Use condensed numerals for the KPIs and the
  expanded width for the wordmark.
- Avoid these clichés: cream with terracotta, near-black with an acid accent, "broadsheet"
  hairlines, SaaS card grids, ALL-CAPS eyebrow labels, middle-dot metadata strings, mono
  data labels, "→" in buttons.
- UI copy is in sentence case and plain English. Use en-GB number and date formats. Say
  "inferred" or "estimated" when a value is not in the source data.
- All colours come from CSS variables (`cssv('--ink')` and similar) or the ink arrays, so
  that both themes work. After a theme change, `onThemeChange()` restyles the map,
  redraws the charts and rebuilds the cube.
- Accessibility: segment buttons use `aria-pressed`, and rows can be used with the keyboard.
  Keep it so. Respect `prefers-reduced-motion` (anime.js and the hero animation already do).

## 7. Conventions

- Plain ES2020, 2-space indent, semicolons, single quotes. No framework and no bundler.
- Keep functions near the view that they serve. Do not add a new global unless many files need it.
- Time values are UTC milliseconds. Use `MIN`, `HOUR`, `DAY`. Local fields come from `localFields()`.
- Escape all user and file text with `esc()` before you put it in `innerHTML`. Do not use `esc()` with `textContent`.
- After each change: `npm test`. After a visual change: also `npm run shots`, and look at the images.

## 8. Status

Work that is done and tested with the sample (headless Chromium):
loading and parsing, stay and trip detection, places and roles, KPIs with sparklines, timeline
with brush and coverage rows, calendar heatmap (quantile colours), weekly rhythm with drag
selection, mode bars, place list with weekly sparklines and details, filter chips, sources
bar (recolour, rename, hide, join, remove), device co-location, map layers and tooltips,
playback (clock, playhead, current cells, tails, heads), split view, and the cube in its
first version.

Tested with a real ten-year Android `Timeline.json` from the owner. It is in `data_sample/`,
which is git-ignored personal data: test with it only in local probes, and never commit,
publish or quote it. Dark mode has been checked in screenshots.

Work that is not tested yet: other real export files (Takeout zip, iPhone JSON, the older
Semantic Location History), combined mode, export, the layer toggles, mobile layout.

## 9. Known issues and next tasks (in priority order)

1. **Cube framing.** `fitCamera()` now fits the box. Check it again in the narrow split panel.
2. **Cube caption.** The caption overlaps the lines. Give `.cube-cap` a panel background, or
   move it to a strip under the canvas.
3. **Cube time labels.** The tick labels on the back-left edge are off-screen or hidden.
   Make sure that they show in the default view.
4. **Cube clipping.** Some trip lines go outside the box, although the six clipping planes
   are set. Check the plane signs and `renderer.localClippingEnabled`, or clip the segments
   on the CPU in `build()`.
5. **Cube place labels overlap** (for example "Home" and "Rato climbing gym"). Add simple
   collision avoidance (drop the lower-ranked label).
6. **Cube stays** are hard to see among many trips at the one-year scale. Consider thicker
   columns, trips drawn with less opacity when the time span is long, or a "stays only" toggle.
7. **Calendar with many years.** A ten-year export shows about 3 cramped years. The year
   label overlaps the month axis of the year above, and the last block is clipped.
8. **Timeline axis.** The first tick label is clipped (for example "017").
9. **Cube at world scale.** With ten years and two continents, local trips collapse to dots.
   Consider a default floor of the home area, or a log-time axis.
10. **KPI meaning in separate mode.** "Distance travelled" adds all devices together, so two
    phones carried together count the same trip twice. "Time at home" mixes devices. Choose
    one: show the value of the primary or selected device, or label the value "sum of
    devices" and point to combined mode. Make the choice clear in the UI.
11. **Progressive reveal in playback** looks as if nothing changes when the routes repeat.
    Consider a short "recent trips" highlight in addition to the tail.
12. **Load time.** About 1 s of JS work for the sample. `makeSample()` takes about 0.7 s.
    `togetherness()` runs on every `renderSources`/`renderTogether` call. Cache it per
    source set. For large Records.json files (hundreds of MB), move parsing and
    `finalize()` into a Web Worker, if the worker can be created from a Blob under the
    artifact CSP (test that first).
13. **MapLibre workers under the artifact CSP.** A test artifact was published. The owner
    thinks land and trails appear, but that is not confirmed. On GitHub Pages or Netlify
    this does not apply.
14. **Test real exports.** Android is done. iPhone, Records.json and Semantic Location
    History are still needed. Add samples to `tests/fixtures/` only if the owner agrees.
    They are personal location data. Never commit real location data to a public repository.
17. **Work over time.** Work is still one place. Use the same monthly method as for home,
    with weekday office hours.
18. **Street-level place names (optional).** The owner wants more context. Online reverse
    geocoding would send coordinates off the device, so it must be opt-in and only on the
    hosted build (the artifact CSP blocks it). Tell the user what is sent before the first request.
15. Small clean-up: `parseRecords()` makes the default name with a `' ·'` string that it
    then replaces. Simplify it.
16. Mobile layout (narrow screens) is not checked. The CSS has a breakpoint that stacks the views.

## 10. Publishing

The page is published in two ways:

- **Claude artifact.** Publish `dist/itinera.html` with the `downloads` capability declared.
  Claude Code can do this with the Artifact tool.
- **GitHub Pages or Netlify.** Use `.github/workflows/pages.yml` or `netlify.toml`. Both run
  `npm ci && python3 build.py prod` and serve `dist/`, and the build writes `dist/index.html`.

Before you publish, check:

- `npm run build` finishes and the file is under 16 MB.
- `dist/itinera.html` has no `node_modules` paths and no script hosts other than those in section 2.
- `npm test` passes, and the screenshots in both themes look correct.
