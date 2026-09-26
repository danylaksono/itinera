/* Load the sample, print the key numbers, fail on page errors. Run: npm test (builds first). */
import JSZip from 'jszip';
import { serve, launch, attachLogs, loadSample, waitFor, loaded } from './common.mjs';

const site = await serve();
const b = await launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [], workers = [];
attachLogs(pg, logs);
pg.on('worker', w => workers.push(w.url())); // the file reader runs in a worker (src/fileWorker.js)
await loadSample(pg, site.url);

const r = await pg.evaluate(() => {
  const s = window.__itinera.store, ctx = s.ctx;
  return {
    sources: s.sources.map(x => ({ name: x.name, records: x.T.length, stays: x.visits.length, trips: x.trips.length, derived: x.derivedVisits })),
    places: ctx.places.length, home: ctx.places[ctx.home]?.label, work: ctx.places[ctx.work]?.label,
    kpi: s.res.kpi, kpiText: [...document.querySelectorAll('.kpi .n')].map(e => e.textContent),
    together: document.querySelector('#together').textContent,
    // Records.json and GPX have no UTC offsets: they must borrow Lisbon's (0 or +60 min) from the phone, whatever the browser's time zone
    offsets: s.sources.filter(x => x.kind !== 'android').map(x => ({ name: x.name, nearby: x.offNearby, browser: x.offBrowser, lisbon: x.OF.every(o => o === 0 || o === 60) }))
  };
});
// the cube floor must be the map view from before the switch, not the hidden map's fallback canvas.
// First wait until the map has settled (a late web-font load can resize the panels and nudge it).
let before = null;
for (let k = 0; k < 20; k++) {
  const b1 = await pg.evaluate('window.__itinera.map.getBounds().toArray().flat()');
  if (before && b1.every((v, i) => Math.abs(v - before[i]) < 1e-9)) break;
  before = b1; await pg.waitForTimeout(500);
}
await pg.click('#viewSeg button[data-v=cube]'); await pg.waitForTimeout(1500);
const after = await pg.evaluate('window.__itinera.viewBounds()');
r.cubeFloorOk = before.every((v, i) => Math.abs(v - after[i]) < 1e-6);
r.cubeDrawn = await pg.evaluate('!!document.querySelector("#cube canvas") && document.querySelector("#cubeCap").textContent.includes("shown")');
// the floor around home: every period in one local frame, with trips drawn
await pg.click('#floorSeg button[data-v=home]');
await waitFor(pg, 'document.querySelector("#cubeCap").textContent.includes("around the home")', 30000);
r.cubeHome = await pg.evaluate('/\\((\\d[\\d,]*) shown/.exec(document.querySelector("#cubeCap").textContent)?.[1]');
await pg.click('#floorSeg button[data-v=map]'); await pg.waitForTimeout(1500);
await pg.click('#viewSeg button[data-v=map]'); await pg.waitForTimeout(1000);
const back = await pg.evaluate('window.__itinera.map.getBounds().toArray().flat()');
r.mapViewKept = before.every((v, i) => Math.abs(v - back[i]) < 1e-3);
// the built-in world outline is on the map (it loads after the map is made)
r.landDrawn = await pg.evaluate("(m => (m.getSource('land').serialize().data.features?.length ?? 0) > 0 && m.getSource('borders').serialize().data.type !== 'FeatureCollection')(window.__itinera.map)");
// trails drawn = the MapLibre worker runs under the page's policy
r.trailsRendered = await pg.evaluate("window.__itinera.map.queryRenderedFeatures({ layers: ['trails'] }).length > 0");
// bundled trips (schematic): bundles replace the single trips, and switch back
await pg.click('#layersBtn'); await pg.click('#bundleChk'); await pg.click('#layersBtn');
await pg.waitForTimeout(600); await waitFor(pg, 'window.__itinera.store.bundleInfo && document.querySelector("#busy").hidden', 60000);
r.bundles = await pg.evaluate("(m => ({ info: window.__itinera.store.bundleInfo, on: m.getLayoutProperty('bundles', 'visibility') === 'visible' && m.getLayoutProperty('trails', 'visibility') === 'none' }))(window.__itinera.map)");
await pg.click('#layersBtn'); await pg.click('#bundleChk'); await pg.click('#layersBtn'); await pg.waitForTimeout(800);
r.bundlesOff = await pg.evaluate("window.__itinera.map.getLayoutProperty('bundles', 'visibility') === 'none' && window.__itinera.map.getLayoutProperty('trails', 'visibility') === 'visible'");
// a filter from one view reaches the others: select a travel mode
await pg.click('.mode-row[data-k=walk]');
await pg.waitForTimeout(500);
r.modeFilter = await pg.evaluate(() => { const s = window.__itinera.store; return s.filter.modes?.has('walk') && s.res.T.every(t => t.mode === 'walk') && !!document.querySelector('.chip'); });
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
r.escapeClears = await pg.evaluate('window.__itinera.store.filter.modes === null');
// a real brush drag on the timeline sets the time filter
const box = await pg.evaluate(() => { const o = document.querySelector('#timeline .overlay').getBoundingClientRect(); return { x: o.x, y: o.y, w: o.width, h: o.height }; });
await pg.mouse.move(box.x + box.w * 0.5, box.y + box.h / 2); await pg.mouse.down();
for (let i = 1; i <= 10; i++) await pg.mouse.move(box.x + box.w * (0.5 + i * 0.01), box.y + box.h / 2);
await pg.mouse.up(); await pg.waitForTimeout(800);
r.brushFilter = await pg.evaluate('window.__itinera.store.filter.t0 != null && !!document.querySelector(".chip")');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
// the place timetable: Home and Work rows, trips drawn, and a real drag over the hours sets the hours filter only
await pg.click('#viewSeg button[data-v=marey]'); await waitFor(pg, 'document.querySelectorAll("#marey .mrow").length > 3', 30000);
r.marey = await pg.evaluate(() => {
  const rows = [...document.querySelectorAll('#marey .mrow')].map(e => e.dataset.k);
  const d = window.__itinera.mareyData('days', 17);
  return { rows: rows.length, home: rows[0] === 'home', work: rows.includes('work'), trips: d.segs.filter(s => s.kind === 't').length, runs: d.segs.filter(s => s.loop && s.item.src === window.__itinera.store.sources.find(x => x.name === 'Running watch').id).length };
});
const mb = await pg.evaluate(() => { const o = document.querySelector('#marey .overlay').getBoundingClientRect(); return { x: o.x, y: o.y, w: o.width, h: o.height }; });
await pg.mouse.move(mb.x + mb.w * (7 / 24) + 3, mb.y + mb.h / 2); await pg.mouse.down();
for (let i = 1; i <= 8; i++) await pg.mouse.move(mb.x + mb.w * ((7 + i * 0.24) / 24), mb.y + mb.h / 2);
await pg.mouse.up(); await pg.waitForTimeout(800);
r.mareyBrush = await pg.evaluate(() => { const f = window.__itinera.store.filter; return f.hours ? [...f.hours].sort((a, b) => a - b).join(',') : null; });
r.mareyBrushOk = r.mareyBrush === '7,8' && await pg.evaluate('window.__itinera.store.filter.dows === null && !!document.querySelector("#marey .brush .selection").getAttribute("width")');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
// selecting a row filters to that place but keeps every row (the chart ignores its own place filter for rows)
await pg.click('#marey .mrow[data-k=work]'); await pg.waitForTimeout(1500);
r.mareyPlace = await pg.evaluate(() => ({ place: window.__itinera.store.filter.place != null, rows: document.querySelectorAll('#marey .mrow').length }));
// the selected place's details: links that open another site only on click, and an offline basemap by default
r.placeLinks = await pg.evaluate(() => [...document.querySelectorAll('.place[aria-expanded="true"] .place-links a')].filter(a => a.target === '_blank' && /noopener/.test(a.rel)).length === 2 && window.__itinera.store.basemap === 'outline');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
await pg.click('#viewSeg button[data-v=map]'); await pg.waitForTimeout(1000);
// a Takeout-style .zip through the real file input: the zip reader works under the policy
const zip = new JSZip();
const t0 = Date.UTC(2025, 5, 1, 7);
const pts = Array.from({ length: 40 }, (_, i) => `<trkpt lat="${(38.72 + i * 0.001).toFixed(5)}" lon="${(-9.16 + i * 0.001).toFixed(5)}"><time>${new Date(t0 + i * 30000).toISOString()}</time></trkpt>`).join('');
zip.file('Takeout/Fitness/ride.gpx', `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Zip ride</name></metadata><trk><type>cycling</type><trkseg>${pts}</trkseg></trk></gpx>`);
await pg.setInputFiles('#fileInput', { name: 'takeout.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
await pg.waitForTimeout(500);
await waitFor(pg, loaded);
r.zipOk = await pg.evaluate("window.__itinera.store.sources.some(s => s.name === 'Zip ride')");
r.fileWorker = workers.some(u => /fileWorker/.test(u));

console.log(JSON.stringify(r, null, 1));
const errs = logs.filter(l => l.startsWith('PAGEERROR') || l.startsWith('error'));
for (const l of logs) console.log(l);
// privacy: the page's policy must stop a request to any other site (this logs one expected error)
const blocked = await pg.evaluate("fetch('https://example.com/').then(() => false, () => true)");
console.log('request to another site blocked:', blocked);
const ok = !errs.length && r.home === 'Home' && r.work === 'Work' && r.kpi.countries === 2 && r.places === 30
  && r.sources.length === 3 && r.cubeFloorOk && r.cubeDrawn && +String(r.cubeHome).replace(',', '') > 1000 && r.mapViewKept && r.landDrawn && r.trailsRendered && r.modeFilter && r.escapeClears && r.brushFilter && r.bundles.on && r.bundles.info.bundled > 20 && r.bundlesOff && r.zipOk && r.fileWorker
  && r.marey.home && r.marey.work && r.marey.trips > 1000 && r.marey.runs > 0 && r.mareyBrushOk && r.mareyPlace.place && r.mareyPlace.rows > 5 && r.placeLinks && blocked
  && r.together.includes('98%') && r.offsets.length === 2 && r.offsets.every(o => o.lisbon && !o.browser && o.nearby > 0)
  // one person: phone trips (9,328 km) + watch runs (553 km); the work phone's copies are not added
  && Math.abs(r.kpi.dist / 1000 - 9881) < 100 && r.kpiText.slice(0, 3).every(t => t !== '0');
await b.close(); site.close();
console.log('SMOKE', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
