# AGENTS.md — Itinera

Handover notes for the coding agent that continues this project on the owner's machine.
Read all of this file before you change code.

## 1. What Itinera is

Itinera is a web app that reads a Google Maps Timeline export and shows it as linked,
interactive views for geovisual analytics. It is like the popular "upload your timeline,
see an animation" sites, but it is for data exploration: linked charts, maps, sliders,
sparklines and a playback animation that give insight.

The owner's brief (keep to it):

- All processing happens in the browser. No data leaves the page. There is no server.
- Linked charts, interactive maps, sliders, sparklines and animation.
- Support more than one timeline (more than one device). The user can combine them, or
  show each device with its own symbology.
- Stack: React and Vite, with MapLibre GL, D3, three.js, anime.js and Turf. It was plain JS
  at first. The owner moved it to React and Vite, and Python is not part of the toolchain.
- Be creative. Avoid generic dashboard design.

The owner is a geovisual analytics researcher. Correct cartography and honest encodings
are more important than decoration.

## 2. Hard constraints

The product is a static site: `npm run build` writes `dist/` (an `index.html` plus hashed
assets). It is hosted on GitHub Pages or Netlify. `base: './'` in `vite.config.js` makes it
work under a sub-path.

The build puts a **Content-Security-Policy** meta tag into `dist/index.html` (the `csp()`
plugin in `vite.config.js`), so the browser enforces the privacy promise. If you break these
rules, the page is blocked:

- Scripts load **only** from the site itself (`script-src 'self'`). All libraries are
  bundled from npm. There are no CDN scripts and no inline scripts: the build fails if
  `index.html` gets an inline `<script>`. Do not use `eval` or `new Function`.
- Styles: the bundled CSS, inline styles (React `style` props and D3 attributes need
  `'unsafe-inline'`), and Google Fonts (`fonts.googleapis.com`, files from `fonts.gstatic.com`).
- The only allowed connection is the optional CARTO street tiles (`*.basemaps.cartocdn.com`).
  There are no other `fetch` calls, remote images or trackers. The world outline and the town
  list are bundled as JS chunks (so no `connect-src 'self'` is needed).
- MapLibre's worker needs `worker-src blob:`.
- If a new feature really needs another host, add it to `CSP` in `vite.config.js` and say so
  in the README.
- The dev server (`npm run dev`) has **no** CSP, because hot reload needs inline scripts. Always
  check policy questions with the built site: `npm test` serves `dist/` over http, fails on any
  policy violation, and checks that a `fetch` to another site is blocked.
- `localStorage` works but can be empty. Always wrap it in `try/catch`.
- Export uses a Blob download link (`itinera-selection.geojson`).
- Theme: the viewer can set `data-theme="light|dark"` on `<html>`. The page also follows
  `prefers-color-scheme`. `applyTheme()` in `src/theme.js` writes `data-dark="1|0"` and the
  store's `dark` field. All JS colour code reads `isDark()` or `cssv()`.
- Keep the safe-area CSS (`src/styles.css`) and the viewport meta tag (`index.html`).

## 3. Repository layout

```
package.json          pinned versions (React and Vite; the map, chart and 3D libraries) and npm scripts
vite.config.js        React plugin, the 'virtual:gazetteer' module (GeoNames towns >= 15,000), the CSP plugin
index.html            Vite entry: head, fonts, #root
src/main.jsx          applies the theme, renders <App/> in StrictMode
src/styles.css        all CSS (theme variables, layout, views)
src/store.js          the app state: getState/setState/subscribe/useStore, toast(). Small: the landing uses it
src/actions.js        everything that changes the analysis: loading, rebuildAll, refresh/recompute,
                      setFilter, devices (hide, join, recolour, remove, combine), places, export
src/playback.js       the playback clock (outside React state): togglePlay, stopPlay, seek, onClock, useClock
src/theme.js          applyTheme(), useThemeWatch()
src/tip.jsx           the shared tooltip: showTip(ev, jsx), hideTip(), <Tip/>
src/hooks.js          useWidth() (ResizeObserver), reducedMotion()
src/testHook.js       window.__itinera, for the browser tests (loaded with the workspace)
src/lib/util.js       constants (MIN, HOUR, DAY), hav, bisect, formatting, localFields
src/lib/parse.js      file readers, detectAndParse(), loadFiles(), readEntries()
src/lib/build.js      finalize(): stays and trips from raw records; combinedRaw(), joinRaws()
src/lib/geo.js        loadGeo() (world outline and gazetteer chunks), countryAt(), nearTown()
src/lib/colors.js     MODES, INKS_L/INKS_D, HOUR_STOPS, isDark, cssv, inkOf, modeColor, hourColor, trackColor
src/lib/analytics.js  buildContext() (places, roles), markDuplicates(), passes(), compute(), togetherness(), headAt()
src/lib/sample.js     makeSample(): synthetic Lisbon year, emitted in three real export formats
src/lib/marey.js      mareyData(): rows and segments for the place timetable (pure)
src/map/mapView.jsx   MapLibre map (imperative): layers, tooltips, framing, the map side of playback
src/cube/cube.jsx     space-time cube (three.js, imperative)
src/marey/marey.jsx   place timetable, a Marey chart (canvas and D3, imperative)
src/components/       React views: App, Landing (+ hero), Workspace (top bar, KPIs), Stage (map, cube and
                      timetable hosts, layers, legend), Side (filters, rhythm, modes, places), Time (player,
                      timeline, calendar), Seg
tests/common.mjs      Playwright helpers: static server for dist/, software WebGL flags, sample loading
tests/smoke.mjs       loads the sample, checks key numbers and the policy, exits 1 on failure
tests/shots.mjs       screenshots of the main states into tests/out/
```

`src/lib/` is plain JS with no React and no app state: every analytics function takes the
state `st` as a parameter. Keep it that way. It is the part that must stay correct.

The landing page loads only React, anime.js and the store. `Workspace.jsx` (with MapLibre,
three.js, D3 and Turf) and `actions.js` are loaded on demand with `lazy()` and `import()`. Do not
import them from `App.jsx`, `Landing.jsx`, `store.js` or `main.jsx`, or the landing bundle grows
from about 100 kB to about 500 kB (gzip).

## 4. Set up, build and test

```bash
npm install
npx playwright install chromium   # once, for the tests
npm run dev                       # dev server with hot reload (no CSP)
npm run build                     # dist/ = the site to publish
npm run preview                   # serve dist/ locally
npm test                          # build + tests/smoke.mjs against dist/ (with the CSP)
npm run shots                     # build + screenshots, light and dark, into tests/out/
```

- Node 22 (Vite 8 needs `^20.19` or `>=22.12`).
- Headless WebGL is software rendered (SwiftShader). It is slow. MapLibre start-up takes
  about 4 s there. On a real GPU it is fast. Do not tune performance from headless timings.
- `page.waitForFunction` builds its check with `eval`, which the policy blocks. The tests poll
  with `page.evaluate` (`waitFor()` in `tests/common.mjs`).
- In a sandbox without internet, Google Fonts fails. That error is harmless. The font stack
  falls back to system fonts, and the tests ignore it.
- After a visual change, run `npm run shots` and **look at the PNG files**. Many faults in
  this project are visual only (see section 9).
- Set `CHROME=/path/to/chrome` to use a specific browser binary.

## 5. Architecture

### Data flow

```
files -> loadFiles() -> detectAndParse() -> raw sources  (points P{t,lat,lon,acc,off}, visits[], trips[])
      -> finalize(raw, id) -> source {id,name,kind,files,raw,T,LA,LO,OF,visits,trips,t0,t1,derivedVisits,derivedTrips,colorIdx}
      -> state.sources   (combined mode: state.merged = finalize(combinedRaw(visible), 1000, {merge:true}))
      -> buildContext(st) -> state.ctx  (places, home/work, day/month/week indices, coverage, moving intervals)
      -> compute(st)      -> state.res  (filtered aggregates for every view)
      -> React components, the map controller and the cube read the state
```

- `T, LA, LO` are `Float64Array`, and `OF` is `Int16Array`: the UTC offset in minutes for each
  record. All "local" values (hour, day, weekday) use the offset of the record, not the
  browser time zone. This is necessary for trips that cross time zones (Barcelona in the sample).
  Records with no offset in the file (`Records.json`, GPX times in `Z`) take one from
  `offsetGuide()`: the nearest record with an offset from any loaded source, within 36 h and then
  within 30 days. Only then is the browser's time zone used. `src.offNearby` and `src.offBrowser`
  count the two cases, and the source's tooltip reports them. Sources that used the browser zone
  are rebuilt when a later file brings offsets. The smoke test checks this on any machine.
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
  `rolePeriods()` picks, for each local month, the place with the most night hours
  (00:00–06:00), with Google `HOME` visits weighted 1.5×. It merges short detours and gaps
  between the same home, and it never bridges long gaps. The result is
  `ctx.homes = [{place, t0, t1, labelled}]`, with `homeAt(t, ctx)`, `ctx.homeByDay`,
  `ctx.homeSet`, and `ctx.home` for the latest home. Every home-based value (time at home,
  farthest from home, the cube, "Home area") uses the home of that time. Work uses the same
  `rolePeriods()` with weekday 09:00–17:00 hours (`ctx.works`, `ctx.workSet`). Hours-only
  work periods need at least 2 months. Inferred roles show "inferred" or "?" in the UI.
- Several devices, one person: `markDuplicates(st, ctx)` marks `dup = true` on stays and trips
  that overlap a higher-ranked device (ranked by days with records). A trip is dropped only if
  the higher-ranked device was also moving. Person-level aggregates in `compute()` (KPIs, monthly
  series, far-from-home, modes, place times, flows) skip `dup` items. The map, the cube and
  `res.V`/`res.T` keep them all. It runs again when a device is hidden or shown.
- Device co-location (`togetherness()`) is computed once per set of visible devices, in
  `rebuildAll()` and `toggleHidden()`, and kept in `state.pairs`.
- Unnamed places are labelled with `nearTown()`: the nearest GeoNames town within 30 km, from
  the bundled gazetteer, with no network. The user can rename places. Names are kept in
  `localStorage['itinera-names']` and keyed by rounded coordinates. `buildContext()` mutates
  `ctx.places[i].label`, so a rename bumps `state.labels` to re-render.
- `buildContext()` and `markDuplicates()` write `place`, `from`, `to` and `dup` onto the stay and
  trip objects in place. That is why the big data stays out of React state and is only read
  by components.

### State and React

- `store.js` holds one state object. `setState(patch)` replaces it (never mutates it) and
  notifies subscribers. Components select single fields with `useStore(s => s.field)`, so they
  re-render only when that field changes. Use `getState()` inside handlers and effects.
- **Filters are immutable.** `state.filter = {t0, t1, hours, dows, modes, place}`. Always build a new
  filter with new Sets through `setFilter(patch, from)` in `actions.js`. Mutating a Set in
  place is a silent bug: nothing re-renders.
- `refresh(from)` merges calls into one `compute()` per animation frame and records `from` in
  `state.from`. The timeline does not redraw when `from` is `'timeline'` (so a brush drag is
  not cut off) and only moves its brush when `from` is `'calendar'`.
- `passes(st, item, except, isTrip)` applies all filters except the one named, in the
  crossfilter style: each view ignores its own filter, so its context stays visible. The
  timeline and calendar ignore time. The rhythm grid ignores hours and days. The mode bars
  ignore modes. The place list uses all filters.
- The map, the cube, the timeline brush and the playback markers are **imperative** (MapLibre,
  three.js, D3). Each is created once in an effect on a ref, subscribes to the store (and to
  the clock), updates only what changed since its last call, and has a real cleanup
  (`map.remove()`, `renderer.dispose()`). `npm run dev` runs StrictMode, which mounts every
  effect twice, so a missing cleanup shows up as two maps or leaked WebGL contexts.
- Tooltip content is JSX, so React escapes all file text. There is no `innerHTML` with file text.

### Map (`src/map/mapView.jsx`)

The style is built in code. It has a background (water), a graticule, land and borders from
the bundled topojson. There are no glyphs or symbol layers, because they need the network.
The data layers are `heat`, `ellipse-*`, `trails`, `trails-fl` (flights, dashed), `trails-jump`,
`flows`, `places`, `place-hl`, one `tail-<id>` line-gradient layer per device, and `heads`. The
filters are MapLibre expressions made by `baseFilter()`. `sync()` compares the new state with
the last one: new `ctx` → `setMapData()`; new `res`, colours, layers or visibility →
`updateMap()`; theme → `restyleMap()`. The optional CARTO street tiles fail without internet.
`streetsFailed()` then shows a toast. That is expected.

MapLibre follows window resizes only, so `createMap()` also puts a `ResizeObserver` on the map
container. Without it, a panel that changes size after load (a late web-font load changes the
bar heights) left a stale canvas, and the smoke test's `mapViewKept` failed about half the time.

`M.bounds` is the map view the user chose. A hidden map (cube view) reports a 400×300 fallback
canvas, so the cube floor and view switches use `viewBounds()` and `restoreView()`, never a bare
`map.getBounds()`. `setView()` queues the map resize before the state change, so the map is
resized before the cube reads its bounds.

### Playback (`src/playback.js`)

The clock changes every frame, so it is not React state. `state.playing`, `state.session`,
`state.speed`, `state.skip` and `state.follow` are. `speedRate(v)` is a log scale from 5 min/s to
60 days/s. "Skip time at places" jumps across the gaps between moving intervals
(`ctx.moving`). Each frame, `onClock` subscribers update the device heads, the fading tails, the
progressive reveal of trails (throttled to 140 ms), the timeline playhead, the current cell in
the calendar and rhythm grid, and the cube clock plane. Only the clock text re-renders
(`useClock()`).

### Space-time cube (`src/cube/cube.jsx`)

The floor is the current map view (web mercator, longest side = 100 units). The height is
the selected time range (72 units). Trips are `LineSegments` with vertex colours and a
ground shadow. Stays are an `InstancedMesh` of cylinders. Place names and time ticks are
HTML labels projected each frame, in a box above the canvas. The time labels go on the vertical
edge that is leftmost on screen, and a label that would overlap one already placed is hidden
(`placeLabels()`). The caption is a strip above the plot. The module renders on demand only
(on OrbitControls `change`, clock updates or rebuilds). `createCube(el, lblBox, setCaption)` is
called the first time the cube is shown and returns `{build, schedule, setClock, show, destroy}`.
It must fail gracefully when there is no WebGL. three.js is pinned at 0.147 because r152 and
later change colour management, which shifts every colour.

### Place timetable (`src/lib/marey.js`, `src/marey/marey.jsx`)

A Marey chart (after Marey's 1885 Paris–Lyon train timetable). The rows are places. Stays are bars on
their row, and trips are straight lines from the start row to the end row, so the slope shows the
speed between places. Round trips (the same row at both ends) are small arches that point away
from home. A dashed line has an end with no known place.

- Rows: the Home and Work *role rows* first (a stay at the home of that time, `homeAt()`, goes on
  Home, so moving house keeps one row; in months with no known home, any place in `ctx.homeSet`
  counts), then the places with most time, fitted to the panel height. They are ordered by their
  median distance from the home of the time of each stay. The rest share one "Other places" row.
  A trip end with no stay (`from`/`to` = −1, for example a watch run) snaps to the nearest place
  within 300 m before it falls back to "Other places".
- Layout `state.mareyLayout`: `'days'` stacks every day on one 24-hour axis (segments are split
  at local midnight, each at low alpha, so routines add up to dense bundles). `'calendar'` keeps real
  time over the selected range. Both use local time (each record's own offset, and the offset at
  the arrival time for the arrival end).
- Filters: `'days'` ignores its own hours filter (`passes(st, it, 'rhythm')` plus the weekday
  filter by hand), and its brush sets `filter.hours` (snapped to whole hours) with `from = 'marey'`.
  `update()` skips the rebuild for its own brush, because a rebuild mid-drag would cut the drag off.
  `'calendar'` uses every filter and has no brush (the timeline sets its range).
- Drawing: a base canvas, with **one stroke per segment**. One path per colour would be composited
  once, and overlapping days would not add up. An overlay canvas holds playback (the current day
  drawn in full up to the clock, and a "now" line). An SVG holds the axis and brush. Row labels and
  the caption are React (`MareyHost` in `Stage.jsx`, through `setMeta`), so file text is escaped.
  Colours are cached per build (`cssv()` is slow).
- Split view shows the map beside the secondary view opened last (`state.second`, `'cube'` or
  `'marey'`). Use `showing(st, v)` from `store.js`, never `view !== 'map'`.

### Sample data (`src/lib/sample.js`)

A seeded, synthetic year in Lisbon from 6 Jan 2025 to 27 Feb 2026. It has commutes,
lunches, gym, runs, weekend market, beach and Sintra trips, Porto by train (17 to 21 Apr
2025), Barcelona by air in CET (10 to 15 Sep 2025), Coimbra at Christmas, and a phone gap
from 3 to 11 Nov 2025. It emits:

- `Timeline.json` (Android, "Pixel phone", the whole period; the phone stays home during runs).
- `Records.json` and `Settings.json` ("Work phone", weekdays 07:00–20:00 until 31 Jul 2025; left
  at the office during some lunches).
- `runs.gpx` ("Running watch", runs from 1 Mar 2025).

The sample goes through the real parsers. Keep it that way. It is the regression test for
the parsers. Expected result: 3 sources, 30 places, Home and Work found, 2 countries,
9,889 km, "Pixel phone and Work phone together 98% of the time".

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
  that both themes work. A component that uses colours selects `state.dark`, so it re-renders
  after a theme change. The map restyles and the cube rebuilds from the same field.
- Accessibility: segment buttons use `aria-pressed`, and rows can be used with the keyboard.
  Keep it so. Respect `prefers-reduced-motion` (anime.js and the hero animation already do).

## 7. Conventions

- Modern JS (ES2022) with JSX, 2-space indent, semicolons, single quotes. React function
  components and hooks. No TypeScript, no CSS framework and no state library.
- Keep functions near the view that they serve. Pure data and analytics code goes in
  `src/lib/` and takes the state as a parameter.
- Time values are UTC milliseconds. Use `MIN`, `HOUR`, `DAY`. Local fields come from `localFields()`.
- d3 inside React: use `selectAll` to reach an element that d3 made (brush parts, axes).
  `selection.select` copies the parent's datum onto the child.
- Keep the DOM ids and class names that the CSS and the tests use (`#sampleBtn`, `#app`, `#busy`,
  `.kpi .n`, `#together`, `#viewSeg button[data-v=…]`, `.mode-row[data-k=…]`, `#fileInput`, `#marey`,
  `#mareySeg button[data-v=…]`, `.mrow[data-k=…]`).
- After each change: `npm test`. After a visual change: also `npm run shots`, and look at the images.

## 8. Status

Rewritten in React and Vite in Sep 2026. The rewrite kept the logic of the plain-JS version.
A parity probe compared the two builds on the sample in seven states (no filter, a time range,
one mode, a rhythm selection, one place, a hidden device, combined mode): every aggregate was
identical, and the screenshots matched in both themes. The rewrite also fixed a bug that the
plain-JS version had: dragging the timeline brush crashed in d3-brush (`gBrush.select('.overlay')`
copied the group's datum over the overlay's `{type}`; it is `selectAll` now). The smoke test now
drags the brush.

Work that is done and tested with the sample (headless Chromium):
loading and parsing (including a `.zip` through the file input), stay and trip detection,
places and roles, KPIs with sparklines, timeline with brush and coverage rows, calendar heatmap
(quantile colours), weekly rhythm with drag selection, mode bars, place list with weekly
sparklines and details, filter chips, sources bar (recolour, rename, hide, join, remove),
device co-location, combined mode, map layers and tooltips, playback (clock, playhead, current
cells, tails, heads), split view, and the cube in its first version. The place timetable (Sep 2026):
both layouts, the hours brush (the smoke test drags it), tooltips, playback, split view, both
themes (`7_timetable`, `8_timetable_week`, `9_split_timetable` in the shots). It was also probed with
the ten-year file: `mareyData()` takes well under 100 ms, and drawing and hover are fine.

Tested with a real ten-year Android `Timeline.json` from the owner, before and after the rewrite
(loads without errors, outline map at world scale, brushing works). It is
in `data_sample/`, which is git-ignored personal data: test with it only in local probes, and
never commit, publish or quote it. Dark mode has been checked in screenshots.

Work that is not tested yet: other real export files (Takeout zip, iPhone JSON, the older
Semantic Location History), export, the layer toggles, mobile layout.

## 9. Known issues and next tasks (in priority order)

1. **Cube framing.** Done (Sep 2026): `fitCamera()` projects the 8 box corners and moves the
   camera until they fill about 85% of the view. In the wide cube view it is limited by height.
2. **Cube caption.** Done: a strip above the plot (`.cube-cap`, `.cube-plot`), as in the timetable.
   In cube view the legend sits under the plot too.
3. **Cube time labels.** Done: `placeLabels()` puts them on the vertical edge that is leftmost on
   screen, re-chosen each frame, with a halo.
4. **Cube clipping.** Checked, not reproduced: the plane signs are right (each plane keeps the
   inside) and `localClippingEnabled` is on. Look again only if it shows in a turned view.
5. **Cube place labels overlap.** Done: labels are placed in order (time, then places by rank),
   and one that would overlap a placed label is hidden. Up to 10 places are labelled.
6. **Cube stays.** Improved: wider columns, and trips drawn fainter when the span is long
   (`tripAlpha`, down to 0.28; the caption says so). A "stays only" toggle is still an option.
7. **Calendar with many years.** Fixed (Sep 2026): each year block has its own label band
   (`blockH = 7 * cs + 38`), so the year no longer overlaps the months above and the last block
   is not clipped. The panel opens at the latest year and scrolls; about two years fit. A way to
   jump to a year (for example, from the timeline axis) could help with ten-year files.
8. **Timeline axis.** Fixed: the svg may overflow into the panel's padding, and a tick label that
   would still not fit is hidden, not clipped ("2017" shows in full, a clipped "Ma" is hidden).
9. **Cube at world scale.** With ten years and two continents, local trips collapse to dots.
   Consider a default floor of the home area, or a log-time axis.
10. **Progressive reveal in playback** looks as if nothing changes when the routes repeat.
    Consider a short "recent trips" highlight in addition to the tail.
11. **Load time.** About 1 s of JS work for the sample. `makeSample()` takes about 0.7 s. For
    large Records.json files (hundreds of MB), move parsing and `finalize()` into a Web Worker
    (Vite supports `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`;
    the policy needs `worker-src 'self' blob:` for it).
12. **Test real exports.** Android is done. iPhone, Records.json and Semantic Location
    History are still needed. Add samples to `tests/fixtures/` only if the owner agrees.
    They are personal location data. Never commit real location data to a public repository.
13. **Street-level place names (optional).** The owner wants more context. Online reverse
    geocoding would send coordinates off the device, so it must be opt-in and needs a new
    `connect-src` host in the CSP. Tell the user what is sent before the first request.
14. Mobile layout (narrow screens) is not checked. The CSS has a breakpoint that stacks the views.
15. **Brushing a ten-year export** recomputes all views on each brush frame: about 150 ms per
    step in headless Chromium, of which `compute()` is 40–100 ms. Check it on a real GPU first. If
    it lags, compute only the cheap views while the brush moves and the rest on `end`, or memoise
    the calendar cells and set only their opacity.
16. The workspace chunk and `actions.js` are about 510 kB and 860 kB before gzip (MapLibre,
    three.js, Turf). The cube could be split further with a dynamic `import()` of `cube.jsx`.
17. **Sports logs as a second device** (a watch or Strava GPX next to a phone timeline). This is in
    scope, and the sample models it ("Running watch"). Three small fixes remain (the time-zone one
    is done: see `offsetGuide()`):
    - Group the GPX files of one import into one source. Now each file becomes its own device
      (`parseGPX()`), so a bulk export of 600 activities shows 600 devices.
    - Map Strava's type names in `modeGroup()`: "Ride", "VirtualRide" and "EBikeRide" fall
      through to `other` (and so do "Swim", "Ski" and "Row"). Old exports use number codes
      (1 = ride, 9 = run).
    - `markDuplicates()` ranks devices by days covered, so a carried phone outranks the watch and
      the watch run is marked `dup`. Prefer the denser track where they overlap. Combined mode
      has the same issue: its 20 s merge can keep the phone point, because GPX points have no
      accuracy (−1).

    A full sports mode is **out of scope for now** (owner's decision, Sep 2026). That covers
    FIT and TCX files, elevation, heart rate, cadence and power, sport KPIs, a sport palette,
    and trip-only sources. The present stay detection turns a track session into a "stay" and
    café stops into places. `inferMode()` classes a run over about 9.4 km/h as cycling and a
    road ride over about 21.6 km/h as road. `thinPath()` keeps at most 400 vertices per trip.
    Revisit these only if a sports mode is taken on.
18. **A lone file with no offsets** (only `Records.json`, or only a GPX) still uses the browser's
    time zone, because there is no other source to borrow from. Real `Records.json` files often
    come with the Semantic Location History, which has offsets. A time-zone lookup from the
    coordinates would need a bundled time-zone map (several MB), so it is not planned.
19. **Place timetable at ten years.** Stacked days work, but many rows saturate and the trips
    become a haze. Brushing a period on the timeline helps. Consider an alpha from the density
    (for example, render the counts into a buffer and map them through a ramp), or a default that
    stacks only the latest year. The rows could also offer "order by travel adjacency" as an
    option.

## 10. Publishing

GitHub Pages (`.github/workflows/pages.yml`) or Netlify (`netlify.toml`). Both run
`npm run build` (after `npm ci`) and serve `dist/`. Do not publish Claude artifacts to test.
Test locally with `npm test` and `npm run shots`.

GitHub Pages must use **Settings → Pages → Source: GitHub Actions**. With "Deploy from a branch",
GitHub's own Jekyll build also runs on every push and publishes the raw repository. Its
`index.html` loads `/src/main.jsx`, so the site is blank and has no CSP, and it finishes after the
workflow, so it wins. In Sep 2026 the site was in this state. To check: `gh api
repos/danylaksono/itinera/pages` must show `"build_type":"workflow"`, and the live page must load
`assets/index-*.js`, not `/src/main.jsx`.

Before you push, check:

- `npm test` passes, and the screenshots in both themes look correct.
- `dist/index.html` has the CSP meta tag and no inline scripts, and no script comes from
  another host.
