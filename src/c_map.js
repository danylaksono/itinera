/* ================================================================
   Part C: map (MapLibre) and playback
   ================================================================ */
let map = null, mapReady = false;
const M = { tailSrcs: new Set(), lastReveal: 0, bounds: null, quiet: false };
/* The view the user chose. A hidden map (cube view) reports a 400x300 fallback
   canvas, and a view switch changes the canvas size, so neither is kept here. */
function viewBounds() {
  if (mapReady && !M.bounds && map.getContainer().clientWidth > 0) M.bounds = map.getBounds();
  return M.bounds;
}
function restoreView() {
  if (!mapReady || !M.bounds || !map.getContainer().clientWidth) return;
  M.quiet = true; map.fitBounds(M.bounds, { duration: 0 }); M.quiet = false;
}

function graticule() {
  const f = [];
  for (let lo = -180; lo <= 180; lo += 10) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: d3.range(-80, 81, 2).map(la => [lo, la]) } });
  for (let la = -80; la <= 80; la += 10) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: d3.range(-180, 181, 2).map(lo => [lo, la]) } });
  return { type: 'FeatureCollection', features: f };
}
function heatRamp() {
  const c = isDark() ? ['rgba(0,0,0,0)', '#1F2C33', '#31464F', '#4E6B77', '#86A2AC'] : ['rgba(0,0,0,0)', '#CAD4CC', '#8A9F9B', '#415C68', '#15222B'];
  return ['interpolate', ['linear'], ['heatmap-density'], 0, c[0], 0.12, c[1], 0.35, c[2], 0.65, c[3], 1, c[4]];
}
// Natural Earth 1:50m coastlines are too coarse at city scale (Lisbon's estuary, for example),
// so water fades into land colour above zoom 7 instead of drawing a false shoreline.
const waterColor = () => ['interpolate', ['linear'], ['zoom'], 6, cssv('--water'), 8, cssv('--land')];
function initMap() {
  initWorld();
  const empty = { type: 'FeatureCollection', features: [] };
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        land: { type: 'geojson', data: WORLD ? WORLD.land : empty, attribution: 'Natural Earth, GeoNames' },
        borders: { type: 'geojson', data: WORLD ? WORLD.borders : empty },
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
  map.on('load', () => {
    const add = (id, extra = {}) => map.addSource(id, { type: 'geojson', data: empty, ...extra });
    add('heat'); add('trails'); add('flows'); add('ellipse'); add('places'); add('heads');
    map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', maxzoom: 17, paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 9, 1, 15, 2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 9, 10, 14, 18, 17, 26],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.72, 13, 0.3], 'heatmap-color': heatRamp()
    } });
    map.addLayer({ id: 'ellipse-fill', type: 'fill', source: 'ellipse', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 } });
    map.addLayer({ id: 'ellipse-line', type: 'line', source: 'ellipse', paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-dasharray': [3, 2] } });
    const tw = ['interpolate', ['linear'], ['zoom'], 3, 0.7, 10, 1.3, 14, 2.2, 17, 3.5];
    map.addLayer({ id: 'trails', type: 'line', source: 'trails', filter: ['==', ['get', 'src'], -999], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#888', 'line-width': tw, 'line-opacity': 0.62 } });
    map.addLayer({ id: 'trails-fl', type: 'line', source: 'trails', filter: ['==', ['get', 'src'], -999], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#888', 'line-width': 1.3, 'line-opacity': 0.7, 'line-dasharray': [2, 2.5] } });
    map.addLayer({ id: 'trails-jump', type: 'line', source: 'trails', filter: ['==', ['get', 'src'], -999], paint: { 'line-color': '#888', 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [0.5, 2.5] } });
    map.addLayer({ id: 'flows', type: 'line', source: 'flows', layout: { 'line-cap': 'round' }, paint: { 'line-color': cssv('--ink'), 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['get', 'n'], 1, 0.8, 20, 3, 200, 8] } });
    map.addLayer({ id: 'places', type: 'circle', source: 'places', paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'hrs']], 0, 2.5, 5, 5, 40, 14, 120, 24],
      'circle-color': cssv('--panel-2'), 'circle-opacity': 0.9,
      'circle-stroke-color': cssv('--ink'), 'circle-stroke-width': ['case', ['has', 'role'], 2.2, 1]
    } });
    map.addLayer({ id: 'place-hl', type: 'circle', source: 'places', filter: ['==', ['get', 'i'], -1], paint: {
      'circle-radius': ['+', 6, ['interpolate', ['linear'], ['sqrt', ['get', 'hrs']], 0, 2.5, 5, 5, 40, 14, 120, 24]],
      'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssv('--ink'), 'circle-stroke-width': 2
    } });
    map.addLayer({ id: 'heads', type: 'circle', source: 'heads', paint: {
      'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': cssv('--paper'), 'circle-stroke-width': 2.5,
      'circle-opacity': ['case', ['get', 'stale'], 0.35, 1]
    } });
    mapReady = true;
    bindMapEvents();
    if (S.ctx) { setMapData(); updateMap(); fitHome(false); }
  });
  map.on('error', e => {
    if (e && e.sourceId === 'streets' || (e?.error?.message || '').includes('cartocdn')) streetsFailed();
  });
}
function bindMapEvents() {
  const tip = $('#tip');
  let hoverPlace = null;
  map.on('mousemove', 'places', e => {
    const f = e.features[0]; if (!f) return;
    map.getCanvas().style.cursor = 'pointer';
    hoverPlace = f.properties.i;
    const p = S.ctx.places[f.properties.i];
    showTip(e.originalEvent, `<b>${esc(p.label)}</b>${p.role && !p.label.startsWith(p.role) ? ` <span class="m">${p.role}${p.inferredRole ? ' (inferred)' : ''}</span>` : ''}<br>${fmtDur(f.properties.hrs * HOUR)} in ${f.properties.n} visit${f.properties.n === 1 ? '' : 's'}${p.country ? `<br><span class="m">${p.town ? 'Near ' + esc(p.town) + ', ' : ''}${esc(p.country)}</span>` : ''}`);
    highlightPlace(p.i, 'map');
  });
  map.on('mouseleave', 'places', () => { map.getCanvas().style.cursor = ''; hoverPlace = null; hideTip(); highlightPlace(null, 'map'); });
  map.on('click', 'places', e => { const f = e.features[0]; if (f) selectPlace(f.properties.i, false); });
  const trailHover = e => {
    if (hoverPlace != null) return;
    const f = e.features[0]; if (!f) return;
    const p = f.properties;
    const lt = fmtLocal(p.t0, p.off), lt1 = fmtLocal(p.t1, p.off);
    const from = p.from >= 0 ? S.ctx.places[p.from]?.label : null, to = p.to >= 0 ? S.ctx.places[p.to]?.label : null;
    const src = srcById(p.src);
    showTip(e.originalEvent, `<b>${MODES[MODE_IDX[p.mode]].label}</b>${p.inf ? ' <span class="m">(inferred)</span>' : ''}, ${fmtKm(p.dist)} km${p.jump ? '<br><span class="m">No route recorded, drawn as a straight line</span>' : ''}<br>${lt.date}, ${lt.time}–${lt1.time}${from || to ? `<br>${esc(from || '?')} to ${esc(to || '?')}` : ''}${S.mode === 'separate' && src ? `<br><span class="m">${esc(src.name)}</span>` : ''}`);
    map.getCanvas().style.cursor = 'default';
  };
  map.on('mousemove', 'trails', trailHover);
  map.on('mousemove', 'trails-fl', trailHover);
  map.on('mousemove', 'trails-jump', trailHover);
  map.on('mouseleave', 'trails', () => { if (hoverPlace == null) hideTip(); });
  map.on('mouseleave', 'trails-fl', () => { if (hoverPlace == null) hideTip(); });
  map.on('mouseleave', 'trails-jump', () => { if (hoverPlace == null) hideTip(); });
  map.on('moveend', () => {
    if (!M.quiet && map.getContainer().clientWidth > 0) M.bounds = map.getBounds();
    if (S.view !== 'map') Cube.schedule();
  });
}
function showTip(ev, html) {
  const tip = $('#tip'); tip.innerHTML = html; tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { $('#tip').style.display = 'none'; }

/* static data (changes only when sources change) */
function setMapData() {
  if (!mapReady || !S.ctx) return;
  const srcs = activeSources();
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
  // tails: one line-gradient source per visible device
  for (const id of M.tailSrcs) { if (map.getLayer('tail-' + id)) map.removeLayer('tail-' + id); if (map.getSource('tail-' + id)) map.removeSource('tail-' + id); }
  M.tailSrcs.clear();
  for (const s of srcs) {
    map.addSource('tail-' + s.id, { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'tail-' + s.id, type: 'line', source: 'tail-' + s.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 4, 'line-gradient': tailGradient(s) } }, 'heads');
    M.tailSrcs.add(s.id);
  }
}
function tailGradient(s) {
  const c = trackColor(s);
  const rgb = d3.rgb(c);
  return ['interpolate', ['linear'], ['line-progress'], 0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`, 0.6, `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`, 1, c];
}
function trackColor(s) { return S.mode === 'combined' ? cssv('--ink') : inkOf(s); }
function colorExpr() {
  if (S.colorBy === 'mode') return ['match', ['get', 'mode'], ...MODES.flatMap(m => [m.k, modeColor(m.k)]), modeColor('other')];
  if (S.colorBy === 'hour') { const st = isDark() ? HOUR_STOPS_D : HOUR_STOPS; return ['interpolate', ['linear'], ['get', 'hod'], ...st.flat()]; }
  const srcs = activeSources();
  if (S.mode === 'combined' || !srcs.length) return cssv('--ink');
  return ['match', ['get', 'src'], ...srcs.flatMap(s => [s.id, inkOf(s)]), cssv('--ink')];
}
function baseFilter(kind) {
  const f = S.filter, a = ['all'];
  a.push(['in', ['get', 'src'], ['literal', visibleSources().map(s => s.id)]]);
  if (kind === 'heat') { if (f.t0 != null) { a.push(['>=', ['get', 't'], f.t0]); a.push(['<=', ['get', 't'], f.t1]); } }
  else if (f.t0 != null) { a.push(['<=', ['get', 't0'], f.t1]); a.push(['>=', ['get', 't1'], f.t0]); }
  if (f.hours) a.push(['in', ['get', 'h'], ['literal', [...f.hours]]]);
  if (f.dows) a.push(['in', ['get', 'dow'], ['literal', [...f.dows]]]);
  if (kind === 'trail') {
    if (f.modes) a.push(['in', ['get', 'mode'], ['literal', [...f.modes]]]);
    if (f.place != null) a.push(['any', ['==', ['get', 'from'], f.place], ['==', ['get', 'to'], f.place]]);
  }
  if (S.play.session && S.play.clock != null) a.push(['<=', ['get', kind === 'heat' ? 't' : 't0'], S.play.clock]);
  return a;
}
function applyMapFilters() {
  if (!mapReady) return;
  const tf = baseFilter('trail');
  map.setFilter('trails', [...tf, ['==', ['get', 'fl'], 0], ['==', ['get', 'jump'], 0]]);
  map.setFilter('trails-jump', [...tf, ['==', ['get', 'jump'], 1]]);
  map.setFilter('trails-fl', [...tf, ['==', ['get', 'fl'], 1]]);
  map.setFilter('heat', baseFilter('heat'));
}
function updateMap() {
  if (!mapReady || !S.res || !S.ctx) return;
  const ctx = S.ctx, res = S.res;
  applyMapFilters();
  const ce = colorExpr();
  map.setPaintProperty('trails', 'line-color', ce);
  map.setPaintProperty('trails-fl', 'line-color', ce);
  map.setPaintProperty('trails-jump', 'line-color', ce);
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
  const ef = res.ellipses.map(e => ({ ...e, properties: { ...e.properties, color: S.mode === 'combined' ? cssv('--ink') : inkOf(srcById(e.properties.src)) } }));
  map.getSource('ellipse').setData({ type: 'FeatureCollection', features: ef });
  // visibility
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('trails', S.layers.trails); vis('trails-fl', S.layers.trails); vis('trails-jump', S.layers.trails);
  vis('heat', S.layers.heat); vis('places', S.layers.places); vis('place-hl', S.layers.places);
  vis('flows', S.layers.flows); vis('ellipse-fill', S.layers.ellipse); vis('ellipse-line', S.layers.ellipse);
  map.setFilter('place-hl', ['==', ['get', 'i'], S.filter.place ?? -1]);
  renderLegend();
}
function restyleMap() {
  if (!mapReady) return;
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
  for (const s of activeSources()) if (map.getLayer('tail-' + s.id)) map.setPaintProperty('tail-' + s.id, 'line-gradient', tailGradient(s));
  if (map.getSource('streets')) { map.removeLayer('streets'); map.removeSource('streets'); setStreets(S.layers.streets); }
}
function highlightPlace(i, from) {
  if (mapReady) map.setFilter('place-hl', ['==', ['get', 'i'], i ?? S.filter.place ?? -1]);
  if (from !== 'list') $$('#places .place').forEach(el => el.classList.toggle('hl', +el.dataset.i === i));
}
let streetsTimer = null;
function setStreets(on) {
  if (!mapReady) return;
  if (!on) { if (map.getLayer('streets')) map.setLayoutProperty('streets', 'visibility', 'none'); return; }
  if (!map.getSource('streets')) {
    const style = isDark() ? 'dark_all' : 'light_all';
    map.addSource('streets', { type: 'raster', tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors © CARTO',
      tiles: ['a', 'b', 'c'].map(s => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`) });
    map.addLayer({ id: 'streets', type: 'raster', source: 'streets', paint: { 'raster-opacity': 0.9 } }, 'heat');
    let loaded = false;
    const ok = e => { if (e.sourceId === 'streets' && e.tile) { loaded = true; map.off('sourcedata', ok); } };
    map.on('sourcedata', ok);
    clearTimeout(streetsTimer);
    streetsTimer = setTimeout(() => { if (!loaded && S.layers.streets) streetsFailed(); }, 6000);
  } else map.setLayoutProperty('streets', 'visibility', 'visible');
}
let streetsWarned = false;
function streetsFailed() {
  if (streetsWarned) return; streetsWarned = true;
  toast('Street tiles did not load. This page blocks online requests, so the map uses the built-in outline map. To use street tiles, save the page and open it from your own web server.', 9000);
}
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function boundsOf(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [lo, la] of pts) { a = Math.min(a, lo); b = Math.min(b, la); c = Math.max(c, lo); d = Math.max(d, la); }
  return [[a, b], [c, d]];
}
function fitHome(animate = true) {
  if (!mapReady || !S.ctx) return;
  const pl = S.ctx.places.slice().sort((a, b) => b.dur - a.dur);
  if (!pl.length) return fitAll(animate);
  const tot = pl.reduce((a, p) => a + p.dur, 0);
  const h = S.ctx.homes.length ? (homeAt(playRange()[1]) >= 0 ? homeAt(playRange()[1]) : S.ctx.home) : -1;
  const home = S.ctx.places[h] || pl[0]; const sel = [];
  let acc = 0;
  for (const p of pl) { if (hav(home.lat, home.lon, p.lat, p.lon) > 60000) continue; sel.push([p.lon, p.lat]); acc += p.dur; if (acc > tot * 0.8 && sel.length > 3) break; }
  fitTo(boundsOf(sel), 60, 14, animate);
}
function fitAll(animate = true) {
  if (!mapReady || !S.ctx) return;
  const pts = [];
  for (const s of visibleSources()) for (let i = 0; i < s.T.length; i += Math.max(1, Math.floor(s.T.length / 4000))) pts.push([s.LO[i], s.LA[i]]);
  for (const p of S.ctx.places) pts.push([p.lon, p.lat]);
  if (!pts.length) return;
  fitTo(boundsOf(pts), 50, 13, animate);
}
function fitTo(b, padding, maxZoom, animate) {
  if (!map.getContainer().clientWidth) { M.bounds = new maplibregl.LngLatBounds(b); Cube.schedule(); return; } // cube view: the floor follows
  map.fitBounds(b, { padding, maxZoom, duration: animate ? 900 : 0 });
}

function renderLegend() {
  const el = $('#legend'); let h = '';
  if (S.colorBy === 'device') {
    if (S.mode === 'combined') h = `<span><i style="background:${cssv('--ink')}"></i>All devices, combined</span>`;
    else h = visibleSources().map(s => `<span><i style="background:${inkOf(s)}"></i>${esc(s.name)}</span>`).join('');
  } else if (S.colorBy === 'mode') {
    const used = new Set(S.res?.modes.filter(m => m.n).map(m => m.k));
    h = MODES.filter(m => used.has(m.k)).map(m => `<span><i style="background:${modeColor(m.k)}"></i>${m.label}</span>`).join('');
  } else {
    const st = (isDark() ? HOUR_STOPS_D : HOUR_STOPS).map(([h, c]) => `${c} ${h / 24 * 100}%`).join(',');
    h = `<span>Start time</span><span>0h <i class="ramp" style="background:linear-gradient(90deg,${st})"></i> 24h</span>`;
  }
  if (S.layers.trails && S.colorBy !== 'mode') h += `<span><i style="background:repeating-linear-gradient(90deg,${cssv('--ink-2')} 0 4px,transparent 4px 7px)"></i>Flight</span>`;
  if (S.layers.trails && S.res?.T.some(t => t.mode !== 'flight' && t.path.length <= 2)) h += `<span><i style="height:2px;background:repeating-linear-gradient(90deg,${cssv('--ink-2')} 0 1.5px,transparent 1.5px 5px)"></i>No route recorded</span>`;
  if (S.layers.places) h += `<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="${cssv('--panel-2')}" stroke="${cssv('--ink')}" stroke-width="1"/></svg>Place (size = time)</span>`;
  el.innerHTML = h;
}

/* ================= playback ================= */
const speedRate = v => 5 * MIN * Math.pow((60 * DAY) / (5 * MIN), v / 100); // data ms per second
function fmtRate(r) {
  if (r >= 1.5 * DAY) return `${Math.round(r / DAY)} days per second`;
  if (r >= 0.95 * DAY) return `1 day per second`;
  if (r >= 1.5 * HOUR) return `${Math.round(r / HOUR)} hours per second`;
  if (r >= 0.95 * HOUR) return `1 hour per second`;
  return `${Math.round(r / MIN)} min per second`;
}
function playRange() { const f = S.filter, c = S.ctx; return [f.t0 ?? c.t0, f.t1 ?? c.t1]; }
function headAt(s, t) {
  const T = s.T, n = T.length; if (!n) return null;
  const i = bisect(T, t);
  if (i === 0 || i >= n) return null;
  const a = i - 1, dt = T[i] - T[a];
  const f = dt ? (t - T[a]) / dt : 0;
  const stale = Math.min(t - T[a], T[i] - t) > 60 * MIN && hav(s.LA[a], s.LO[a], s.LA[i], s.LO[i]) > 200;
  return { lat: s.LA[a] + (s.LA[i] - s.LA[a]) * f, lon: s.LO[a] + (s.LO[i] - s.LO[a]) * f, stale, i };
}
let rafId = null, lastTs = 0;
function togglePlay(force) {
  const on = force ?? !S.play.on;
  if (!S.ctx) return;
  S.play.on = on;
  $('#playIcon').setAttribute('d', on ? 'M3 1.5h3v11H3zM8 1.5h3v11H8z' : 'M3 1.5v11l9-5.5z');
  $('#playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (on) {
    const [a, b] = playRange();
    if (!S.play.session || S.play.clock == null || S.play.clock >= b || S.play.clock < a) S.play.clock = a;
    S.play.session = true;
    lastTs = performance.now();
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick);
  } else cancelAnimationFrame(rafId);
}
function stopPlay() {
  togglePlay(false);
  S.play.session = false; S.play.clock = null;
  clearPlayLayers(); applyMapFilters(); drawPlayhead(); updateClock(); Cube.setClock(null);
  markCurrent(null);
}
function clearPlayLayers() {
  if (!mapReady) return;
  const empty = { type: 'FeatureCollection', features: [] };
  map.getSource('heads')?.setData(empty);
  for (const id of M.tailSrcs) map.getSource('tail-' + id)?.setData(empty);
}
function tick(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
  const rate = speedRate(S.play.speed);
  const [a, b] = playRange();
  let c = S.play.clock + rate * dt;
  if (S.play.skip) {
    const ms = S.ctx.movingStarts, mv = S.ctx.moving;
    const k = bisect(ms, c + 1) - 1;
    const inside = k >= 0 && c <= mv[k][1];
    if (!inside && k + 1 < ms.length) {
      const nxt = ms[k + 1];
      if (nxt - c > rate * 0.35) c = Math.max(c, nxt - rate * 0.3);
    }
  }
  if (c >= b) { c = b; S.play.clock = c; drawFrame(true); togglePlay(false); return; }
  S.play.clock = c;
  drawFrame(false);
  rafId = requestAnimationFrame(tick);
}
function drawFrame(force) {
  const c = S.play.clock;
  if (mapReady && c != null) {
    const rate = speedRate(S.play.speed);
    const span = clamp(rate * 1.6, 25 * MIN, 5 * DAY);
    const heads = [];
    let follow = null;
    for (const s of visibleSources()) {
      const h = headAt(s, c);
      const src = map.getSource('tail-' + s.id);
      if (!h) { src?.setData({ type: 'FeatureCollection', features: [] }); continue; }
      heads.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { color: trackColor(s), stale: h.stale } });
      if (!follow && !h.stale) follow = h;
      const i0 = bisect(s.T, c - span);
      const co = [];
      const step = Math.max(1, Math.floor((h.i - i0) / 500));
      for (let i = i0; i < h.i; i += step) co.push([s.LO[i], s.LA[i]]);
      co.push([h.lon, h.lat]);
      if (co.length >= 2) src?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: co }, properties: {} });
      else src?.setData({ type: 'FeatureCollection', features: [] });
    }
    map.getSource('heads').setData({ type: 'FeatureCollection', features: heads });
    if (S.play.follow && follow) {
      const cen = map.getCenter();
      map.jumpTo({ center: [cen.lng + (follow.lon - cen.lng) * 0.08, cen.lat + (follow.lat - cen.lat) * 0.08] });
    }
    const now = performance.now();
    if (force || now - M.lastReveal > 140) { M.lastReveal = now; applyMapFilters(); }
  }
  updateClock(); drawPlayhead(); Cube.setClock(c);
  markCurrent(c);
}
function updateClock() {
  const el = $('#clock');
  const c = S.play.clock;
  if (c == null) {
    if (!S.ctx) { el.textContent = '—'; return; }
    const [a, b] = playRange();
    const off = offNear(a);
    el.innerHTML = `${fmtDay(Math.floor((a + off * MIN) / DAY))} <small>to ${fmtDay(Math.floor((b + off * MIN) / DAY))}</small>`;
    return;
  }
  const off = offNear(c);
  const f = fmtLocal(c, off);
  el.innerHTML = `${f.date} <small>${f.time}</small>`;
}
function offNear(t) {
  const s = activeSources()[0]; if (!s || !s.T.length) return browserOff(t);
  return s.OF[Math.min(s.T.length - 1, bisect(s.T, t))];
}
