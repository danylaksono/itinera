# Itinera

Itinera reads a Google Maps Timeline export and turns it into linked views for exploring
your own movement: a map, a space-time cube, a calendar, a weekly rhythm grid, travel-mode
bars, a ranked list of places and a playback animation. Select something in one view and
the others filter to match.

**Your data never leaves your browser.** Itinera is a static site with no server and no
upload. Files are read with the browser's File API. When you close the tab, the data is
gone. The page carries a Content-Security-Policy, so the browser itself blocks any attempt
to send data elsewhere. Scripts load only from the site itself. The only other requests it
allows are the font and the optional online basemaps (see [Deploy](#deploy)).

## What you can do

- **Map.** Trips are coloured by device, travel mode or time of day. Places are sized by
  the time spent there. Optional layers show record density, flows between places and a
  standard deviational ellipse of your activity space. Flights follow great circles and are
  dashed. Where no route was recorded between two stays, the trip is a thin dotted straight
  line, so it doesn't look like a real track.
- **Space-time cube.** The floor is the current map view and time runs up the height.
  Stays are columns and trips are lines. Drag to orbit, and use split view to see the cube
  next to the map.
- **Timeline and calendar.** Distance per day, distance from home, and which days each
  device has records. Brush the timeline or select calendar days to filter every other view.
- **Weekly rhythm.** Average minutes on the move for each hour of the week, averaged over
  days that have records. Drag across cells to filter by hour and weekday.
- **Places.** Places are ranked by time spent and have weekly sparklines. An unnamed place
  is labelled with the nearest town, for example "Place 12, Leeds". The town comes from a
  gazetteer built into the page, so there is no online lookup. You can rename any place.
  Names are stored only in your browser.
- **Home changes over time.** Each month, home is the place with the most nights
  (00:00–06:00). Visits that Google labels as home count extra. A month or two away between
  stays at the same home counts as travel, not a move. A long gap in the data leaves home
  unknown and is never bridged. "Time at home" and "farthest from home" use the home of the
  time, and months with no known home are left out. Work changes over time in the same way,
  from weekday hours between 09:00 and 17:00 and Google's work labels. Office hours alone
  must cover at least two months.
- **Playback.** Moving heads with fading tails. The speed runs from 5 minutes to 60 days
  per second, and there is an option to skip the time spent at places.
- **More than one device.** Load files from several phones, a watch or GPX tracks. Show
  each device in its own colour, or combine them into one history with duplicate records
  removed. Itinera reports how often two devices were together. The totals describe one
  person. Where devices overlap in time, the device that covers the most days counts. A trip
  from another device is dropped only if the main device was also moving then, so a phone
  left at home does not cancel a run recorded by a watch.
- **Export** the current selection of places and trips as GeoJSON.

All local times use the UTC offset stored with each record, so trips across time zones
fall on the correct hour and weekday.

## Supported files

| Source | File |
| --- | --- |
| Android (Timeline stored on the phone) | `Timeline.json` |
| iPhone (Google Maps) | `location-history.json` |
| Google Takeout, before 2024 | `Records.json` (split per device, named from `Settings.json`) and the monthly `Semantic Location History` files |
| Other | GPX tracks, simple GeoJSON (points with a time, or lines with `coordTimes`), a Takeout `.zip`, or a whole folder |

### Getting your export

- **Android:** open Settings › Location › Location services › Timeline and select
  *Export Timeline data*.
- **iPhone:** in Google Maps, open Settings › Personal content and select
  *Export Timeline data*.
- **Older Takeout archive:** drop the `.zip` or the unzipped folder.

If a file has no stays or trips, Itinera finds them in the raw records: stays within
150 m for at least 15 minutes, and travel mode estimated from speed. Every estimated
value is labelled "inferred" or "estimated".

## Try it

Open the page and select **Explore sample data**. The sample is a made-up year in Lisbon
from two phones and a running watch. It is generated in the page and parsed by the same
readers as real files.

## Build

You need Node.js 22. Itinera is a React app built with Vite.

```bash
npm install
npm run dev          # development server with hot reload
npm run build        # writes the site to dist/
npm run preview      # serves dist/ locally
```

The build bundles every library from npm at pinned versions: React, MapLibre GL, D3,
three.js, anime.js, Turf, topojson-client and JSZip. There are no CDN scripts. It also
bundles, as chunks that load only after you open data:

- the world outline map (Natural Earth, via `world-atlas`);
- a gazetteer of towns with over 15,000 people, from GeoNames via `all-the-cities`. It is
  made at build time in `vite.config.js`.

The landing page loads only React and the animation library. The map, the charts and the
cube load when you open data.

## Deploy

The output in `dist/` is a static site, so any static host works.

**GitHub Pages.** The workflow in `.github/workflows/pages.yml` builds and deploys on each
push to `main`. In the repository, open Settings › Pages and set *Source* to
*GitHub Actions*.

**Netlify.** `netlify.toml` sets the build command (`npm run build`), Node 22 and the
publish directory (`dist`). Connect the repository and deploy. For a one-off
deploy, drag the `dist` folder onto Netlify Drop instead.

The basemap is the built-in outline map by default, so the page makes no requests after it
loads. Under *Layers › Basemap* you can choose an online one: street tiles from CARTO
(`*.basemaps.cartocdn.com`), or streets and labels, or a detailed map with shops and places, from
OpenFreeMap (`tiles.openfreemap.org`). Those requests show that server which map area you are
viewing, but none of your location data. They help you recognise a place yourself, without
reverse geocoding.

A place's details also have *Open in Google Maps* and *OpenStreetMap* links. They open a new tab
at that place's coordinates, and nothing is sent until you click one.

## Tests

```bash
npx playwright install chromium   # once
npm test             # build, then a headless smoke test on the sample
npm run shots        # screenshots of the main views, light and dark, into tests/out/
```

The smoke test serves the built site over http, so its security policy applies as on a real
host. It loads the sample and checks the key numbers: 3 devices, 30 places, home and work
found, 2 countries, "98% together", and a distance within 100 km of the true 9,881 km.
It also checks that:

- the cube draws, and the cube floor and the map view survive a change of view;
- trails render, which proves the map worker runs under the policy;
- selecting a travel mode filters the other views, and Escape clears it;
- a `.zip` loads through the file input;
- a request to another site is blocked.

Any policy violation fails the test. Headless runs use software WebGL, so they are slow.

## Project layout

```
index.html          Vite entry
vite.config.js      build: React, the gazetteer module, the security policy
src/main.jsx        entry: theme, <App/>
src/store.js        app state
src/actions.js      loading, analysis updates, filters, devices, export
src/playback.js     playback clock
src/lib/            parsers, stay and trip detection, places and roles, linked filtering,
                    aggregates, colours, the synthetic sample (plain JS, no React)
src/map/            MapLibre map
src/cube/           space-time cube (three.js)
src/components/     React views
tests/              Playwright smoke test and screenshots
```

`AGENTS.md` has the architecture notes and the list of open work.

## Data credits

- Country outlines: [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- Town names: [GeoNames](https://www.geonames.org/) (CC BY 4.0).

## Status

The Android `Timeline.json` reader has been tested with a real ten-year export. The iPhone,
Records.json, Semantic Location History and Takeout `.zip` readers have been tested only
with the synthetic sample so far. Please open an issue if a real export does not load.
Don't attach your file, because it is personal location data.

## Licence

MIT, see [LICENSE](LICENSE). The GeoNames town data is CC BY 4.0 and needs the credit above.
