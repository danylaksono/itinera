/* MapLibre map: layers, tooltips and the map side of playback. Imperative: createMap() builds it on a
   container, subscribes to the store and the clock, and returns a cleanup. The style is built in code
   (no glyphs or symbol layers, which need the network). */
import maplibregl from 'maplibre-gl';
import { range, rgb } from 'd3';
import { MIN, HOUR, DAY, hav, bisect, clamp, fmtKm, fmtDur, fmtLocal } from '../lib/util.js';
import { MODES, MODE_IDX, cssv, isDark, inkOf, modeColor, hourStops, trackColor } from '../lib/colors.js';
import { WORLD } from '../lib/geo.js';
import { activeSources, visibleSources, srcById, homeAt, playRange, headAt } from '../lib/analytics.js';
import { getState, setState, subscribe, toast } from '../store.js';
import { getClock, onClock, speedRate } from '../playback.js';
import { showTip, hideTip } from '../tip.jsx';
import { selectPlace } from '../actions.js';

let map = null, ready = false;
const M = { tailSrcs: new Set(), lastReveal: 0, bounds: null, quiet: false, fitted: false, world: false, streetsTimer: null, streetsWarned: false };
export const getMap = () => map;
export const mapReady = () => ready;
const empty = () => ({ type: 'FeatureCollection', features: [] });

/* The view the user chose. A hidden map (cube view) reports a 400x300 fallback
   canvas, and a view switch changes the canvas size, so neither is kept here. */
export function viewBounds() {
  if (ready && !M.bounds && map.getContainer().clientWidth > 0) M.bounds = map.getBounds();
  return M.bounds;
}
export function restoreView() {
  if (!ready || !M.bounds || !map.getContainer().clientWidth) return;
  M.quiet = true; map.fitBounds(M.bounds, { duration: 0 }); M.quiet = false;
}
/* switch map / split / cube / place timetable, keeping the chosen map view.
   Split shows the map beside the secondary view opened last. */
export function setView(v) {
  viewBounds();
  // queued before the state change, so the map resizes before the cube (which reads its bounds) builds
  requestAnimationFrame(() => { if (map) { map.resize(); restoreView(); } });
  setState(v === 'cube' || v === 'marey' ? { view: v, second: v } : { view: v });
}

function graticule() {
  const f = [];
  for (let lo = -180; lo <= 180; lo += 10) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: range(-80, 81, 2).map(la => [lo, la]) } });
  for (let la = -80; la <= 80; la += 10) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: range(-180, 181, 2).map(lo => [lo, la]) } });
  return { type: 'FeatureCollection', features: f };
}
function heatRamp() {
  const c = isDark() ? ['rgba(0,0,0,0)', '#1F2C33', '#31464F', '#4E6B77', '#86A2AC'] : ['rgba(0,0,0,0)', '#CAD4CC', '#8A9F9B', '#415C68', '#15222B'];
  return ['interpolate', ['linear'], ['heatmap-density'], 0, c[0], 0.12, c[1], 0.35, c[2], 0.65, c[3], 1, c[4]];
}
// Natural Earth 1:50m coastlines are too coarse at city scale (Lisbon's estuary, for example),
// so water fades into land colour above zoom 7 instead of drawing a false shoreline.
const waterColor = () => ['interpolate', ['linear'], ['zoom'], 6, cssv('--water'), 8, cssv('--land')];

export function createMap(container) {
  M.bounds = null; M.fitted = false; M.world = false; M.tailSrcs.clear();
  map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        land: { type: 'geojson', data: WORLD ? WORLD.land : empty(), attribution: 'Natural Earth, GeoNames' },
        borders: { type: 'geojson', data: WORLD ? WORLD.borders : empty() },
        grat: { type: 'geojson', data: graticule() }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': waterColor() } },
        { id: 'grat', type: 'line', source: 'grat', paint: { 'line-color': cssv('--border-map'), 'line-opacity': 0.35, 'line-width': 0.5 } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': cssv('--land') } },
        { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': cssv('--border-map'), 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 9, 1.2] } }
      ]
    },
    center: [0, 30], zoom: 1.4, attributionControl: false, dragRotate: false, pitchWithRotate: false, maxPitch: 0
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.touchZoomRotate.disableRotation();
  const m = map;
  let prev = null, unsub = null, unclock = null;
  m.on('load', () => {
    const add = id => m.addSource(id, { type: 'geojson', data: empty() });
    add('heat'); add('trails'); add('flows'); add('ellipse'); add('places'); add('heads');
    m.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', maxzoom: 17, paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 9, 1, 15, 2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 9, 10, 14, 18, 17, 26],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.72, 13, 0.3], 'heatmap-color': heatRamp()
    } });
    m.addLayer({ id: 'ellipse-fill', type: 'fill', source: 'ellipse', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 } });
    m.addLayer({ id: 'ellipse-line', type: 'line', source: 'ellipse', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-dasharray': [3, 2] } });
    const tw = ['interpolate', ['linear'], ['zoom'], 3, 0.7, 10, 1.3, 14, 2.2, 17, 3.5];
    m.addLayer({ id: 'trails', type: 'line', source: 'trails', filter: ['==', ['get', 'src'], -999], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#888', 'line-width': tw, 'line-opacity': 0.62 } });
    m.addLayer({ id: 'trails-fl', type: 'line', source: 'trails', filter: ['==', ['get', 'src'], -999], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#888', 'line-width': 1.3, 'line-opacity': 0.7, 'line-dasharray': [2, 2.5] } });
    m.addLayer({ id: 'trails-jump', type: 'line', source: 'trails', filter: ['==', ['get', 'src'], -999], paint: { 'line-color': '#888', 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [0.5, 2.5] } });
    m.addLayer({ id: 'flows', type: 'line', source: 'flows', layout: { 'line-cap': 'round' }, paint: { 'line-color': cssv('--ink'), 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['get', 'n'], 1, 0.8, 20, 3, 200, 8] } });
    m.addLayer({ id: 'places', type: 'circle', source: 'places', paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'hrs']], 0, 2.5, 5, 5, 40, 14, 120, 24],
      'circle-color': cssv('--panel-2'), 'circle-opacity': 0.9,
      'circle-stroke-color': cssv('--ink'), 'circle-stroke-width': ['case', ['has', 'role'], 2.2, 1]
    } });
    m.addLayer({ id: 'place-hl', type: 'circle', source: 'places', filter: ['==', ['get', 'i'], -1], paint: {
      'circle-radius': ['+', 6, ['interpolate', ['linear'], ['sqrt', ['get', 'hrs']], 0, 2.5, 5, 5, 40, 14, 120, 24]],
      'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssv('--ink'), 'circle-stroke-width': 2
    } });
    m.addLayer({ id: 'heads', type: 'circle', source: 'heads', paint: {
      'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': cssv('--paper'), 'circle-stroke-width': 2.5,
      'circle-opacity': ['case', ['get', 'stale'], 0.35, 1]
    } });
    ready = true;
    bindMapEvents(m);
    sync();
    unsub = subscribe(sync);
    unclock = onClock(drawFrame);
    if (getClock() != null) drawFrame(getClock(), true);
  });
  m.on('error', e => {
    if (e && e.sourceId === 'streets' || (e?.error?.message || '').includes('cartocdn')) streetsFailed();
  });

  /* apply what changed in the store since the last call */
  function sync() {
    const st = getState(), p = prev || {};
    prev = st;
    // the world outline loads with the first data (lib/geo.js), usually after the map is made
    if (!M.world && WORLD) { M.world = true; m.getSource('land').setData(WORLD.land); m.getSource('borders').setData(WORLD.borders); }
    if (!st.ctx) return;
    if (st.dark !== p.dark && p.dark !== undefined) restyleMap(st);
    if (st.ctx !== p.ctx || st.merged !== p.merged) setMapData(st);
    else if (st.sources !== p.sources) restyleTails(st);
    if (st.res !== p.res || st.colorBy !== p.colorBy || st.layers !== p.layers || st.hidden !== p.hidden || st.dark !== p.dark || st.sources !== p.sources) updateMap(st);
    if (st.hlPlace !== p.hlPlace || st.filter.place !== p.filter?.place) m.setFilter('place-hl', ['==', ['get', 'i'], st.hlPlace ?? st.filter.place ?? -1]);
    if (st.layers.streets !== p.layers?.streets) setStreets(st, st.layers.streets);
    if (!M.fitted) { M.fitted = true; fitHome(false); }
  }
  return () => {
    unsub?.(); unclock?.();
    clearTimeout(M.streetsTimer);
    ready = false; map = null;
    m.remove();
  };
}

function bindMapEvents(m) {
  let hoverPlace = null;
  m.on('mousemove', 'places', e => {
    const f = e.features[0]; if (!f) return;
    const st = getState();
    m.getCanvas().style.cursor = 'pointer';
    hoverPlace = f.properties.i;
    const p = st.ctx.places[f.properties.i];
    showTip(e.originalEvent, <>
      <b>{p.label}</b>{p.role && !p.label.startsWith(p.role) && <> <span className="m">{p.role}{p.inferredRole ? ' (inferred)' : ''}</span></>}<br />
      {fmtDur(f.properties.hrs * HOUR)} in {f.properties.n} visit{f.properties.n === 1 ? '' : 's'}
      {p.country && <><br /><span className="m">{p.town ? 'Near ' + p.town + ', ' : ''}{p.country}</span></>}
    </>);
    if (st.hlPlace !== p.i) setState({ hlPlace: p.i });
  });
  m.on('mouseleave', 'places', () => { m.getCanvas().style.cursor = ''; hoverPlace = null; hideTip(); setState({ hlPlace: null }); });
  m.on('click', 'places', e => { const f = e.features[0]; if (f) selectPlace(f.properties.i, false); });
  const trailHover = e => {
    if (hoverPlace != null) return;
    const f = e.features[0]; if (!f) return;
    const st = getState(), p = f.properties;
    const lt = fmtLocal(p.t0, p.off), lt1 = fmtLocal(p.t1, p.off);
    const from = p.from >= 0 ? st.ctx.places[p.from]?.label : null, to = p.to >= 0 ? st.ctx.places[p.to]?.label : null;
    const src = srcById(st, p.src);
    showTip(e.originalEvent, <>
      <b>{MODES[MODE_IDX[p.mode]].label}</b>{p.inf ? <> <span className="m">(inferred)</span></> : null}, {fmtKm(p.dist)} km
      {p.jump ? <><br /><span className="m">No route recorded, drawn as a straight line</span></> : null}<br />
      {lt.date}, {lt.time}–{lt1.time}
      {(from || to) && <><br />{from || '?'} to {to || '?'}</>}
      {st.mode === 'separate' && src && <><br /><span className="m">{src.name}</span></>}
    </>);
    m.getCanvas().style.cursor = 'default';
  };
  for (const id of ['trails', 'trails-fl', 'trails-jump']) {
    m.on('mousemove', id, trailHover);
    m.on('mouseleave', id, () => { if (hoverPlace == null) hideTip(); });
  }
  m.on('moveend', () => {
    if (!M.quiet && m.getContainer().clientWidth > 0) M.bounds = m.getBounds();
    moveListeners.forEach(f => f());
  });
}
/* the cube follows the map view */
const moveListeners = new Set();
export function onMapMove(f) { moveListeners.add(f); return () => moveListeners.delete(f); }

/* static data (changes only when sources change) */
function setMapData(st) {
  const srcs = activeSources(st);
  // heat: sampled records
  const total = srcs.reduce((a, s) => a + s.T.length, 0);
  const stride = Math.max(1, Math.ceil(total / 180000));
  const hf = [];
  for (const s of srcs) {
    for (let i = 0; i < s.T.length; i += stride) {
      const L = s.T[i] + s.OF[i] * MIN;
      hf.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.LO[i], s.LA[i]] }, properties: { t: s.T[i], src: s.id, h: Math.floor((((L % DAY) + DAY) % DAY) / HOUR), dow: (Math.floor(L / DAY) + 3) % 7 } });
    }
  }
  map.getSource('heat').setData({ type: 'FeatureCollection', features: hf });
  const tf = [];
  for (const s of srcs) for (const t of s.trips) {
    if (t.path.length < 2) continue;
    tf.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.path.map(p => [p[2], p[1]]) },
      properties: { src: t.src, mode: t.mode, hod: t.hod, h: t.h, dow: t.dow, t0: t.t0, t1: t.t1, off: t.off, from: t.from, to: t.to, dist: t.dist, fl: t.mode === 'flight' ? 1 : 0, inf: t.inferred ? 1 : 0, jump: t.mode !== 'flight' && t.path.length <= 2 ? 1 : 0 } });
  }
  map.getSource('trails').setData({ type: 'FeatureCollection', features: tf });
  // tails: one line-gradient source per device
  for (const id of M.tailSrcs) { if (map.getLayer('tail-' + id)) map.removeLayer('tail-' + id); if (map.getSource('tail-' + id)) map.removeSource('tail-' + id); }
  M.tailSrcs.clear();
  for (const s of srcs) {
    map.addSource('tail-' + s.id, { type: 'geojson', lineMetrics: true, data: empty() });
    map.addLayer({ id: 'tail-' + s.id, type: 'line', source: 'tail-' + s.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 4, 'line-gradient': tailGradient(st, s) } }, 'heads');
    M.tailSrcs.add(s.id);
  }
}
function tailGradient(st, s) {
  const c = trackColor(st, s);
  const k = rgb(c);
  return ['interpolate', ['linear'], ['line-progress'], 0, `rgba(${k.r},${k.g},${k.b},0)`, 0.6, `rgba(${k.r},${k.g},${k.b},0.55)`, 1, c];
}
function restyleTails(st) {
  for (const s of activeSources(st)) if (map.getLayer('tail-' + s.id)) map.setPaintProperty('tail-' + s.id, 'line-gradient', tailGradient(st, s));
}
function colorExpr(st) {
  if (st.colorBy === 'mode') return ['match', ['get', 'mode'], ...MODES.flatMap(m => [m.k, modeColor(m.k)]), modeColor('other')];
  if (st.colorBy === 'hour') return ['interpolate', ['linear'], ['get', 'hod'], ...hourStops().flat()];
  const srcs = activeSources(st);
  if (st.mode === 'combined' || !srcs.length) return cssv('--ink');
  return ['match', ['get', 'src'], ...srcs.flatMap(s => [s.id, inkOf(s)]), cssv('--ink')];
}
function baseFilter(st, kind) {
  const f = st.filter, a = ['all'];
  a.push(['in', ['get', 'src'], ['literal', visibleSources(st).map(s => s.id)]]);
  if (kind === 'heat') { if (f.t0 != null) { a.push(['>=', ['get', 't'], f.t0]); a.push(['<=', ['get', 't'], f.t1]); } }
  else if (f.t0 != null) { a.push(['<=', ['get', 't0'], f.t1]); a.push(['>=', ['get', 't1'], f.t0]); }
  if (f.hours) a.push(['in', ['get', 'h'], ['literal', [...f.hours]]]);
  if (f.dows) a.push(['in', ['get', 'dow'], ['literal', [...f.dows]]]);
  if (kind === 'trail') {
    if (f.modes) a.push(['in', ['get', 'mode'], ['literal', [...f.modes]]]);
    if (f.place != null) a.push(['any', ['==', ['get', 'from'], f.place], ['==', ['get', 'to'], f.place]]);
  }
  const c = getClock();
  if (st.session && c != null) a.push(['<=', ['get', kind === 'heat' ? 't' : 't0'], c]);
  return a;
}
function applyMapFilters(st) {
  if (!ready) return;
  const tf = baseFilter(st, 'trail');
  map.setFilter('trails', [...tf, ['==', ['get', 'fl'], 0], ['==', ['get', 'jump'], 0]]);
  map.setFilter('trails-jump', [...tf, ['==', ['get', 'jump'], 1]]);
  map.setFilter('trails-fl', [...tf, ['==', ['get', 'fl'], 1]]);
  map.setFilter('heat', baseFilter(st, 'heat'));
}
function updateMap(st) {
  if (!st.res) return;
  const ctx = st.ctx, res = st.res;
  applyMapFilters(st);
  const ce = colorExpr(st);
  for (const id of ['trails', 'trails-fl', 'trails-jump']) map.setPaintProperty(id, 'line-color', ce);
  // places
  const pf = res.places.map(o => {
    const p = ctx.places[o.i];
    const props = { i: o.i, hrs: o.dur / HOUR, n: o.n };
    if (p.role) props.role = p.role;
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: props };
  }).sort((a, b) => b.properties.hrs - a.properties.hrs);
  map.getSource('places').setData({ type: 'FeatureCollection', features: pf });
  // flows as gentle arcs
  const ff = res.flows.map(fl => {
    const a = ctx.places[fl.a], b = ctx.places[fl.b];
    const mx = (a.lon + b.lon) / 2, my = (a.lat + b.lat) / 2, dx = b.lon - a.lon, dy = b.lat - a.lat;
    const cx = mx - dy * 0.22, cy = my + dx * 0.22, co = [];
    for (let k = 0; k <= 24; k++) { const u = k / 24; co.push([(1 - u) ** 2 * a.lon + 2 * (1 - u) * u * cx + u * u * b.lon, (1 - u) ** 2 * a.lat + 2 * (1 - u) * u * cy + u * u * b.lat]); }
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: co }, properties: { n: fl.n } };
  });
  map.getSource('flows').setData({ type: 'FeatureCollection', features: ff });
  const ef = res.ellipses.map(e => ({ ...e, properties: { ...e.properties, color: st.mode === 'combined' ? cssv('--ink') : inkOf(srcById(st, e.properties.src)) } }));
  map.getSource('ellipse').setData({ type: 'FeatureCollection', features: ef });
  // visibility
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  const L = st.layers;
  vis('trails', L.trails); vis('trails-fl', L.trails); vis('trails-jump', L.trails);
  vis('heat', L.heat); vis('places', L.places); vis('place-hl', L.places);
  vis('flows', L.flows); vis('ellipse-fill', L.ellipse); vis('ellipse-line', L.ellipse);
  map.setFilter('place-hl', ['==', ['get', 'i'], st.hlPlace ?? st.filter.place ?? -1]);
}
function restyleMap(st) {
  map.setPaintProperty('bg', 'background-color', waterColor());
  map.setPaintProperty('land', 'fill-color', cssv('--land'));
  map.setPaintProperty('borders', 'line-color', cssv('--border-map'));
  map.setPaintProperty('grat', 'line-color', cssv('--border-map'));
  map.setPaintProperty('heat', 'heatmap-color', heatRamp());
  map.setPaintProperty('places', 'circle-color', cssv('--panel-2'));
  map.setPaintProperty('places', 'circle-stroke-color', cssv('--ink'));
  map.setPaintProperty('place-hl', 'circle-stroke-color', cssv('--ink'));
  map.setPaintProperty('flows', 'line-color', cssv('--ink'));
  map.setPaintProperty('heads', 'circle-stroke-color', cssv('--paper'));
  restyleTails(st);
  if (map.getSource('streets')) { map.removeLayer('streets'); map.removeSource('streets'); setStreets(st, st.layers.streets); }
}

/* ---------- optional online street tiles ---------- */
function setStreets(st, on) {
  if (!on) { if (map.getLayer('streets')) map.setLayoutProperty('streets', 'visibility', 'none'); return; }
  if (!map.getSource('streets')) {
    const style = isDark() ? 'dark_all' : 'light_all';
    map.addSource('streets', { type: 'raster', tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors © CARTO',
      tiles: ['a', 'b', 'c'].map(s => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`) });
    map.addLayer({ id: 'streets', type: 'raster', source: 'streets', paint: { 'raster-opacity': 0.9 } }, 'heat');
    let loaded = false;
    const m = map;
    const ok = e => { if (e.sourceId === 'streets' && e.tile) { loaded = true; m.off('sourcedata', ok); } };
    m.on('sourcedata', ok);
    clearTimeout(M.streetsTimer);
    M.streetsTimer = setTimeout(() => { if (!loaded && getState().layers.streets) streetsFailed(); }, 6000);
  } else map.setLayoutProperty('streets', 'visibility', 'visible');
}
function streetsFailed() {
  if (M.streetsWarned) return; M.streetsWarned = true;
  toast('Street tiles did not load. Check your internet connection. The built-in outline map still works offline.', 9000);
}

/* ---------- framing ---------- */
export function boundsOf(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [lo, la] of pts) { a = Math.min(a, lo); b = Math.min(b, la); c = Math.max(c, lo); d = Math.max(d, la); }
  return [[a, b], [c, d]];
}
export function fitHome(animate = true) {
  const st = getState();
  if (!ready || !st.ctx) return;
  const pl = st.ctx.places.slice().sort((a, b) => b.dur - a.dur);
  if (!pl.length) return fitAll(animate);
  const tot = pl.reduce((a, p) => a + p.dur, 0);
  const now = homeAt(playRange(st)[1], st.ctx);
  const h = st.ctx.homes.length ? (now >= 0 ? now : st.ctx.home) : -1;
  const home = st.ctx.places[h] || pl[0]; const sel = [];
  let acc = 0;
  for (const p of pl) { if (hav(home.lat, home.lon, p.lat, p.lon) > 60000) continue; sel.push([p.lon, p.lat]); acc += p.dur; if (acc > tot * 0.8 && sel.length > 3) break; }
  fitTo(boundsOf(sel), 60, 14, animate);
}
export function fitAll(animate = true) {
  const st = getState();
  if (!ready || !st.ctx) return;
  const pts = [];
  for (const s of visibleSources(st)) for (let i = 0; i < s.T.length; i += Math.max(1, Math.floor(s.T.length / 4000))) pts.push([s.LO[i], s.LA[i]]);
  for (const p of st.ctx.places) pts.push([p.lon, p.lat]);
  if (!pts.length) return;
  fitTo(boundsOf(pts), 50, 13, animate);
}
function fitTo(b, padding, maxZoom, animate) {
  if (!map.getContainer().clientWidth) { M.bounds = new maplibregl.LngLatBounds(b); moveListeners.forEach(f => f()); return; } // cube view: the floor follows
  map.fitBounds(b, { padding, maxZoom, duration: animate ? 900 : 0 });
}
export function flyTo(lon, lat) {
  if (ready) map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13), duration: 800 });
}

/* ---------- playback: heads, fading tails, progressive reveal ---------- */
function drawFrame(c, force) {
  if (!ready) return;
  const st = getState();
  if (c == null) {
    map.getSource('heads')?.setData(empty());
    for (const id of M.tailSrcs) map.getSource('tail-' + id)?.setData(empty());
    applyMapFilters(st);
    return;
  }
  const rate = speedRate(st.speed);
  const span = clamp(rate * 1.6, 25 * MIN, 5 * DAY);
  const heads = [];
  let follow = null;
  for (const s of visibleSources(st)) {
    const h = headAt(s, c);
    const src = map.getSource('tail-' + s.id);
    if (!h) { src?.setData(empty()); continue; }
    heads.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { color: trackColor(st, s), stale: h.stale } });
    if (!follow && !h.stale) follow = h;
    const i0 = bisect(s.T, c - span);
    const co = [];
    const step = Math.max(1, Math.floor((h.i - i0) / 500));
    for (let i = i0; i < h.i; i += step) co.push([s.LO[i], s.LA[i]]);
    co.push([h.lon, h.lat]);
    if (co.length >= 2) src?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: co }, properties: {} });
    else src?.setData(empty());
  }
  map.getSource('heads').setData({ type: 'FeatureCollection', features: heads });
  if (st.follow && follow) {
    const cen = map.getCenter();
    map.jumpTo({ center: [cen.lng + (follow.lon - cen.lng) * 0.08, cen.lat + (follow.lat - cen.lat) * 0.08] });
  }
  const now = performance.now();
  if (force || now - M.lastReveal > 140) { M.lastReveal = now; applyMapFilters(st); }
}
