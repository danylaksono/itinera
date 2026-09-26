/* App actions: loading, rebuilding the analysis, device and place operations, export. */
import { HOUR, sleep } from './lib/util.js';
import { INKS_L } from './lib/colors.js';
import { loadFiles } from './lib/parse.js';
import { finalize, combinedRaw, joinRaws, offsetGuide } from './lib/build.js';
import { loadGeo } from './lib/geo.js';
import { makeSample } from './lib/sample.js';
import { buildContext, compute, markDuplicates, togetherness, srcById, defaultLabel, saveName } from './lib/analytics.js';
import { getState, setState, NO_FILTER, toast } from './store.js';
import { stopPlay, togglePlay } from './playback.js';
import { fitAll, flyTo } from './map/mapView.jsx';

let nextSrcId = 0;
export { stopPlay, togglePlay };

/* Recompute the aggregates once per animation frame. `from` names the view that caused it. */
let pending = null, waiters = [];
export function refresh(from = 'all') {
  if (pending) { if (pending !== from) pending = 'all'; return; }
  pending = from;
  requestAnimationFrame(() => { const f = pending; pending = null; recompute(f); });
}
export function recompute(from = 'all') {
  const st = getState();
  if (!st.ctx) return;
  setState({ res: compute(st), from });
  const w = waiters; waiters = []; w.forEach(r => r());
}
/* resolves after the pending recompute (tests use it) */
export const settle = () => pending ? new Promise(r => waiters.push(r)) : Promise.resolve();

/* Filters are replaced, never mutated. patch = null clears all filters. */
export function setFilter(patch, from = 'all') {
  const filter = patch ? { ...getState().filter, ...patch } : NO_FILTER;
  const extra = {};
  if (!patch || ('place' in patch && patch.place == null)) extra.openPlace = null;
  setState({ filter, ...extra });
  refresh(from);
}

/* ---------- busy overlay ---------- */
export const busyStep = (step, sub = '') => setState({ busy: { step, sub } });
export async function busy(step, fn) {
  const was = !!getState().busy;
  busyStep(step);
  await sleep(40);
  try { return await fn(); } finally { if (!was) setState({ busy: null }); }
}
function showError(msg) {
  if (getState().screen === 'landing') setState({ landErr: msg });
  else toast(msg, 9000);
}

/* device co-location, cached per set of visible devices */
function pairsFor(st) {
  const vis = st.sources.filter(s => !st.hidden.has(s.id));
  if (st.mode !== 'separate' || vis.length < 2) return [];
  const pairs = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) { const r = togetherness(vis[i], vis[j]); if (r) pairs.push([vis[i].id, vis[j].id, r]); }
  return pairs.sort((a, b) => b[2].hours - a[2].hours);
}

/* ---------- building ---------- */
export async function rebuildAll() {
  await busy('Updating the analysis', async () => {
    const st0 = getState();
    const wasPlaying = st0.playing;
    if (st0.session) stopPlay();
    let merged = null;
    if (st0.mode === 'combined') {
      const vis = st0.sources.filter(s => !st0.hidden.has(s.id));
      busyStep('Combining devices', `${vis.length} sources, removing duplicate records`);
      await sleep(20);
      merged = finalize(combinedRaw(vis), 1000, { merge: true });
      merged.name = 'All devices'; merged.colorIdx = 0;
    }
    busyStep('Finding places and routines');
    await sleep(20);
    await loadGeo();
    const st = { ...getState(), merged };
    const ctx = buildContext(st);
    const filter = st.filter.place != null && st.filter.place >= ctx.places.length ? { ...st.filter, place: null } : st.filter;
    setState({ merged, ctx, filter, pairs: pairsFor(st), labels: st.labels + 1 });
    recompute('all');
    if (wasPlaying) togglePlay(true);
  });
}
async function ingest(raws) {
  const first = !getState().sources.length;
  const sources = [...getState().sources];
  // UTC offsets for records without one come from any source that has them (see offsetGuide)
  const guide = offsetGuide([...sources.map(s => s.raw), ...raws]);
  // sources loaded earlier that fell back to the browser time zone may now have offsets nearby
  for (let k = 0; k < sources.length; k++) {
    const o = sources[k]; if (!o.offBrowser) continue;
    const s = finalize(o.raw, o.id, { guide });
    s.name = o.name; s.colorIdx = o.colorIdx;
    sources[k] = s;
  }
  for (const r of raws) {
    busyStep(`Building ${r.name}`, `${(r.P.t.length + r.visits.length + r.trips.length).toLocaleString('en-GB')} records, stays and trips`);
    await sleep(15);
    const s = finalize(r, nextSrcId++, { guide });
    if (!s.T.length && !s.visits.length) continue;
    const used = new Set(sources.map(o => o.colorIdx));
    let k = 0; while (used.has(k) && k < INKS_L.length) k++;
    s.colorIdx = k % INKS_L.length;
    sources.push(s);
  }
  if (!sources.length) { showError('The files have no usable location records.'); return; }
  setState({ sources, screen: 'app' });
  await rebuildAll();
  if (!first) fitAll(true);
}
/* Reading and parsing run in a worker (src/fileWorker.js), so a large file does not freeze the page.
   If the worker cannot start (an old browser, or a policy that blocks it), the same code runs here. */
function readFiles(files) {
  let w;
  try { w = new Worker(new URL('./fileWorker.js', import.meta.url), { type: 'module' }); }
  catch (e) { return loadFiles(files, busyStep); }
  return new Promise((resolve, reject) => {
    let started = false;
    w.onmessage = ({ data: m }) => {
      started = true;
      if (m.type === 'step') { busyStep(m.step, m.sub); return; }
      w.terminate();
      if (m.type === 'done') resolve(m); else reject(new Error(m.message));
    };
    w.onerror = e => {
      e.preventDefault(); w.terminate();
      if (started) reject(new Error(e.message || 'the file reader stopped.'));
      else loadFiles(files, busyStep).then(resolve, reject); // the worker did not load
    };
    w.postMessage({ files: [...files] });
  });
}
export async function handleFiles(files) {
  if (!files || !files.length) return;
  setState({ landErr: '' });
  busyStep('Reading files');
  try {
    const { raws, errors, skipped } = await readFiles(files);
    if (!raws.length) {
      showError(errors.length ? errors.join(' ') : `No location data was found${skipped ? ` in ${files.length} file${files.length === 1 ? '' : 's'}` : ''}. Load Timeline.json, location-history.json, Records.json, Semantic Location History files, GPX tracks or a Takeout .zip.`);
      return;
    }
    await ingest(raws);
    if (errors.length) toast(`Some files were skipped. ${errors.slice(0, 3).join(' ')}`, 9000);
  } catch (e) {
    console.error(e);
    showError(`The files could not be read. ${e.message || ''}`);
  } finally { setState({ busy: null }); }
}
export async function loadSample() {
  busyStep('Making a sample year', 'Two phones and a running watch');
  await sleep(40);
  try { await ingest(makeSample()); } catch (e) { console.error(e); showError('The sample could not be built. ' + (e.message || '')); }
  finally { setState({ busy: null }); }
}

/* ---------- devices ---------- */
export function setMode(v) {
  const st = getState();
  if (v === st.mode) return;
  let colorBy = st.colorBy;
  if (v === 'combined' && colorBy === 'device') colorBy = 'mode';
  if (v === 'separate' && colorBy === 'mode' && st.sources.length > 1) colorBy = 'device';
  setState({ mode: v, colorBy, filter: { ...st.filter, place: null }, openPlace: null });
  return rebuildAll();
}
export function recolour(s) {
  const st = getState();
  const used = new Set(st.sources.map(o => o.colorIdx));
  let k = s.colorIdx; for (let n = 0; n < INKS_L.length; n++) { k = (k + 1) % INKS_L.length; if (!used.has(k)) break; }
  s.colorIdx = k;
  setState({ sources: [...st.sources] });
  recompute('all');
}
export function renameSource(s, name) { s.name = name; setState({ sources: [...getState().sources] }); }
export async function toggleHidden(id) {
  const st = getState();
  const hidden = new Set(st.hidden);
  if (hidden.has(id)) hidden.delete(id);
  else {
    if (st.sources.filter(o => !hidden.has(o.id)).length <= 1) { toast('At least one device must stay visible.'); return; }
    hidden.add(id);
  }
  setState({ hidden });
  if (st.mode === 'combined') return rebuildAll();
  const s2 = getState();
  markDuplicates(s2, s2.ctx);
  setState({ pairs: pairsFor(s2) });
  refresh('sources');
}
export async function joinSources(s, o) {
  await busy(`Joining ${s.name} and ${o.name}`, async () => {
    const joined = finalize(joinRaws(s.raw, o.raw), s.id, { guide: offsetGuide(getState().sources.map(x => x.raw)) });
    joined.name = s.name;
    joined.colorIdx = s.colorIdx;
    const st = getState(), hidden = new Set(st.hidden);
    hidden.delete(o.id);
    setState({ sources: st.sources.filter(x => x !== o).map(x => x === s ? joined : x), hidden });
  });
  return rebuildAll();
}
export function removeSource(s) {
  const st = getState(), hidden = new Set(st.hidden);
  hidden.delete(s.id);
  const sources = st.sources.filter(x => x !== s);
  if (!sources.length) { location.reload(); return; }
  setState({ sources, hidden });
  return rebuildAll();
}

/* ---------- filters and places ---------- */
export function setTimeRange(t0, t1, from) {
  const c = getState().ctx;
  if (t0 == null || (t0 <= c.t0 && t1 >= c.t1)) setFilter({ t0: null, t1: null }, from);
  else setFilter({ t0, t1 }, from);
}
export function selectPlace(i, fly) {
  const st = getState();
  if (st.filter.place === i) { setFilter({ place: null }, 'places'); return; }
  setState({ openPlace: i });
  setFilter({ place: i }, 'places');
  if (fly) { const p = st.ctx.places[i]; flyTo(p.lon, p.lat); }
}
export function renamePlace(key, value) {
  const st = getState();
  const p = st.ctx.places.find(q => q.key === key); if (!p) return;
  const v = value.trim();
  if ((p.custom || '') === v) return;
  saveName(p.key, v); p.custom = v || null;
  p.label = defaultLabel(p);
  setState({ labels: st.labels + 1 });
}

/* ---------- export ---------- */
export function exportSelection() {
  const st = getState();
  if (!st.res) return;
  const ctx = st.ctx, res = st.res;
  const feats = [];
  for (const o of res.places) {
    const p = ctx.places[o.i];
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lon.toFixed(6), +p.lat.toFixed(6)] }, properties: { kind: 'place', name: p.label, role: p.role, country: p.country, hours: +(o.dur / HOUR).toFixed(2), visits: o.n, first: new Date(o.first).toISOString(), last: new Date(o.last).toISOString() } });
  }
  for (const t of res.T) {
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.path.map(p => [+p[2].toFixed(6), +p[1].toFixed(6)]) }, properties: { kind: 'trip', device: srcById(st, t.src)?.name, mode: t.mode, mode_inferred: !!t.inferred, start: new Date(t.t0).toISOString(), end: new Date(t.t1).toISOString(), utc_offset_min: t.off, km: +(t.dist / 1000).toFixed(3), from: ctx.places[t.from]?.label ?? null, to: ctx.places[t.to]?.label ?? null } });
  }
  const data = JSON.stringify({ type: 'FeatureCollection', features: feats });
  try {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'itinera-selection.geojson'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast('The browser did not allow the download.'); }
}
